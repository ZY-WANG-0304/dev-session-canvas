import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

export const SERIALIZE_PATCH_ID = 'bold-dim-v1';
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(projectRoot, 'extensions/vscode/dev-session-canvas/package.json'));
const sourceHashes = {
  'addon/src/SerializeAddon.ts': 'a1ed69d294d0e013aafb4e70c9a9a66c36550a410946eddb03a47d66b92a0405',
  'xterm/src/browser/Types.ts': '4f3599b7d08e6ba29b25d7d9e6543ea3b797e9585cf9e692d6fa10c60f5eee6b',
  'xterm/src/common/Color.ts': 'ca962c9f8acb904437205b68b2a2820a692d24278634ec38923ccf3776b0c232'
};
const hash = data => createHash('sha256').update(data).digest('hex');

export function patchSerializeAddonSource(source) {
  assert.equal(hash(source), sourceHashes['addon/src/SerializeAddon.ts'], 'Unexpected upstream SerializeAddon source.');
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, 'Expected one fixed SerializeAddon patch anchor.');
    source = source.replace(before, after);
  };
  replace('          if (cell.isBold() !== oldCell.isBold()) { sgrSeq.push(cell.isBold() ? 1 : 22); }',
    `          if ((!cell.isBold() && oldCell.isBold()) || (!cell.isDim() && oldCell.isDim())) {
            sgrSeq.push(22);
            if (cell.isBold()) { sgrSeq.push(1); }
            if (cell.isDim()) { sgrSeq.push(2); }
          } else {
            if (cell.isBold() !== oldCell.isBold()) { sgrSeq.push(1); }
            if (cell.isDim() !== oldCell.isDim()) { sgrSeq.push(2); }
          }`);
  replace('          if (cell.isDim() !== oldCell.isDim()) { sgrSeq.push(cell.isDim() ? 2 : 22); }\n', '');
  replace('export class SerializeAddon implements ITerminalAddon , ISerializeApi {',
    `export class SerializeAddon implements ITerminalAddon , ISerializeApi {\n  public static readonly devSessionCanvasPatch = '${SERIALIZE_PATCH_ID}';`);
  return source;
}

export async function ensureXtermSerializePatch() {
  const addonRoot = path.dirname(require.resolve('@xterm/addon-serialize/package.json'));
  const xtermRoot = path.dirname(require.resolve('@xterm/xterm/package.json'));
  assert.equal(require('@xterm/addon-serialize/package.json').version, '0.14.0');
  assert.equal(require('@xterm/xterm/package.json').version, '6.0.0');
  assert.equal(require('@xterm/headless/package.json').version, '6.0.0');
  assert.equal(esbuildVersion, '0.25.12');
  const originals = new Map();
  for (const [name, expected] of Object.entries(sourceHashes)) {
    const [owner, ...parts] = name.split('/');
    const file = path.join(owner === 'addon' ? addonRoot : xtermRoot, ...parts);
    const source = await fs.readFile(file, 'utf8');
    assert.equal(hash(source), expected, `Unexpected pinned serializer build input: ${name}`);
    originals.set(file, source);
  }
  const source = originals.get(path.join(addonRoot, 'src/SerializeAddon.ts'));
  const patched = patchSerializeAddonSource(source);
  const outputs = [];
  for (const [format, filename] of [['cjs', 'addon-serialize.js'], ['esm', 'addon-serialize.mjs']]) {
    const result = await build({ stdin: { contents: patched, resolveDir: addonRoot,
      sourcefile: 'src/SerializeAddon.ts', loader: 'ts' },
    bundle: true, write: false, format, platform: format === 'cjs' ? 'node' : 'neutral', target: 'es2020',
    nodePaths: [path.join(xtermRoot, 'src')], outfile: path.join(addonRoot, 'lib', filename),
    sourcemap: 'linked', sourcesContent: true, metafile: true, logLevel: 'silent' });
    assert.deepEqual(Object.keys(result.metafile.inputs).map(file => path.resolve(file)).sort(), [...originals.keys()].sort(),
      'The serializer patch may only compile the three pinned source inputs.');
    outputs.push(...result.outputFiles);
  }
  // Rebuild from untouched upstream sources, never by patching an already generated bundle.
  let changed = 0;
  for (const output of outputs) {
    const existing = await fs.readFile(output.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (existing && hash(existing) === hash(output.contents)) continue;
    await fs.writeFile(output.path, output.contents);
    changed += 1;
  }
  return { patchId: SERIALIZE_PATCH_ID, changed, files: outputs.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await ensureXtermSerializePatch();
  console.log(`xterm serialize ${result.patchId}: ${result.files} verified outputs, ${result.changed} updated.`);
}
