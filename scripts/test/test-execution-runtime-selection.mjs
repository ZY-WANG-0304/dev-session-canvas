import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import esbuild from 'esbuild';
import ts from 'typescript';
import { resolveExecutionBuildSelection } from '../build/build.mjs';
import { LINUX_EXECUTION_EXPORTS, NODE_PTY_UNIX_SHA256 } from '../build/linux-execution-provider-patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const extensionFile = path.join(root, 'extensions/vscode/dev-session-canvas/src/extension.ts');
const extensionSource = fs.readFileSync(extensionFile, 'utf8');
const ast = ts.createSourceFile(extensionFile, extensionSource, ts.ScriptTarget.Latest, true);
const require = createRequire(import.meta.url);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-execution-selection-'));
const profile = 'linux-owner-v1-candidate';
const digest = value => createHash('sha256').update(value).digest('hex');
const binary = Buffer.alloc(64);
binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
binary.writeUInt16LE(3, 16);
binary.writeUInt16LE(62, 18);
const manifest = { schemaVersion: 1, profile, platform: 'linux', arch: 'x64',
  libc: { name: 'glibc', version: '2.35' },
  runtime: { name: 'node', version: '22.23.2', node: '22.23.2', modules: '127', napi: '10' },
  binary: { file: 'execution-owner.node', sha256: digest(binary) }, exports: [...LINUX_EXECUTION_EXPORTS],
  sources: {
    ownerSha256: digest(fs.readFileSync(path.join(root, 'extensions/vscode/dev-session-canvas/native/linux-execution-owner.h'))),
    patchSha256: digest(fs.readFileSync(path.join(root, 'scripts/build/linux-execution-provider-patch.mjs'))),
    nodePtySha256: NODE_PTY_UNIX_SHA256, patchedSha256: '1'.repeat(64), headersSha256: '2'.repeat(64),
    nodeAddonApiSha256: '3'.repeat(64)
  }, verification: { compiled: true, nativeLoaded: false, nativeCalls: false, productValidated: false } };
const source = path.join(temporary, 'assets');
const dist = path.join(temporary, 'dist');
fs.mkdirSync(source);
fs.mkdirSync(dist);
fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(source, 'execution-owner.node'), binary);
fs.writeFileSync(path.join(dist, 'retained.txt'), 'unchanged');
const candidateArgs = source => [`--execution-profile=${profile}`, `--execution-assets=${source}`];
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };

async function activationFixture(compiledProfile, factoryError) {
  const observed = { factory: [], constructors: [] };
  const ownerOptions = Object.freeze({ kind: 'linux-provider', profile, profileMode: 'snapshot-only' });
  const stop = new Error('Captured real activate constructor boundary.');
  const modules = new Map();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === './panel/executionRuntimeSelection' || (!specifier.startsWith('.') && specifier !== 'vscode')) continue;
    const bindings = statement.importClause.namedBindings;
    const exports = bindings && ts.isNamedImports(bindings)
      ? bindings.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text)
      : [];
    modules.set(specifier, exports.map(name => name === 'CanvasPanelManager'
      ? `export class CanvasPanelManager { constructor(...args) { globalThis.observed.constructors.push(args); throw globalThis.stop; } }`
      : `export const ${name} = undefined;`).join('\n'));
  }
  modules.set('vscode', 'module.exports = {};');
  const result = await esbuild.build({ entryPoints: [extensionFile], bundle: true, write: false, platform: 'node',
    format: 'cjs', define: { __DEV_SESSION_CANVAS_EXECUTION_PROFILE__: JSON.stringify(compiledProfile) ?? 'undefined' },
    plugins: [{ name: 'activation-boundaries', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.importer === extensionFile && modules.has(args.path)) return { path: args.path, namespace: 'activation' };
        if (args.path === './linuxExecutionOwnerFactory') return { path: 'owner-factory', namespace: 'activation' };
      });
      build.onLoad({ filter: /.*/, namespace: 'activation' }, args => ({ contents: args.path === 'owner-factory'
        ? `export function createLinuxExecutionOwnerOptions(options) {
            globalThis.observed.factory.push(options);
            if (globalThis.factoryError) throw globalThis.factoryError;
            return globalThis.ownerOptions;
          }`
        : modules.get(args.path), loader: 'js' }));
    } }] });
  const context = { module: { exports: {} }, require, observed, ownerOptions, stop, factoryError, TextEncoder, TextDecoder,
    process: { env: { DEV_SESSION_CANVAS_EXECUTION_PROFILE: profile } } };
  vm.runInNewContext(result.outputFiles[0].text, context);
  const extensionContext = { extensionUri: { fsPath: '/controlled/extension' }, extensionMode: 1 };
  return { observed, ownerOptions, stop, extensionContext, activate: () => context.module.exports.activate(extensionContext) };
}

try {
  await test('ordinary and production builds remain stock with no asset lookup', async () => {
    assert.deepEqual(await resolveExecutionBuildSelection([], '/missing/dist'), {});
    assert.deepEqual(await resolveExecutionBuildSelection(['--production'], '/missing/dist'), {});
    assert.deepEqual(await resolveExecutionBuildSelection(['--watch'], '/missing/dist'), {});
  });
  await test('explicit build selection accepts offline Node and Electron manifests without loading native', async () => {
    assert.deepEqual(await resolveExecutionBuildSelection(candidateArgs(source), dist), { profile, source });
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest,
      runtime: { ...manifest.runtime, name: 'electron', version: '37.0.0' } }));
    assert.deepEqual(await resolveExecutionBuildSelection(candidateArgs(source), dist), { profile, source });
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  });
  await test('unpaired unknown watch and invalid asset inputs reject before clearing dist', async () => {
    for (const args of [[`--execution-profile=${profile}`], [`--execution-assets=${source}`],
      ['--execution-profile=other', `--execution-assets=${source}`], [...candidateArgs(source), '--watch'],
      candidateArgs(path.join(temporary, 'missing')), ['--unknown']]) {
      await assert.rejects(resolveExecutionBuildSelection(args, dist));
    }
    fs.writeFileSync(path.join(source, 'execution-owner.node'), Buffer.from('changed'));
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(source), dist), /hash/);
    fs.writeFileSync(path.join(source, 'execution-owner.node'), binary);
    assert.equal(fs.readFileSync(path.join(dist, 'retained.txt'), 'utf8'), 'unchanged');
  });
  await test('asset sources inside the cleared dist including aliases reject', async () => {
    const inside = path.join(dist, 'assets');
    fs.cpSync(source, inside, { recursive: true });
    const alias = path.join(temporary, 'dist-alias');
    fs.symlinkSync(dist, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(inside), dist), /outside/);
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(path.join(alias, 'assets')), dist), /outside/);
    await assert.rejects(resolveExecutionBuildSelection(candidateArgs(dist), dist), /outside/);
    assert.equal(fs.readFileSync(path.join(dist, 'retained.txt'), 'utf8'), 'unchanged');
  });
  await test('real ordinary activate stays stock despite candidate-looking environment', async () => {
    const f = await activationFixture(undefined);
    assert.throws(f.activate, error => error === f.stop);
    assert.equal(f.observed.factory.length, 0);
    assert.equal(f.observed.constructors.length, 1);
    const args = f.observed.constructors[0];
    assert.strictEqual(args[0], f.extensionContext);
    assert.equal(args[1], undefined);
    assert.equal(args[2], undefined);
  });
  await test('real candidate activate prepares local snapshot owner and passes same profile to Runtime routing', async () => {
    const f = await activationFixture(profile);
    assert.throws(f.activate, error => error === f.stop);
    assert.equal(f.observed.factory.length, 1);
    assert.equal(f.observed.factory[0].extensionRoot, '/controlled/extension');
    assert.equal(f.observed.factory[0].mode, 'snapshot-only');
    assert.strictEqual(f.observed.constructors[0][0], f.extensionContext);
    assert.strictEqual(f.observed.constructors[0][1], f.ownerOptions);
    assert.equal(f.observed.constructors[0][2], profile);
  });
  await test('unknown compiled profile and rejected assets never construct a stock manager', async () => {
    const unknown = await activationFixture('unsupported');
    assert.throws(unknown.activate, /Unknown compiled/);
    assert.equal(unknown.observed.factory.length, 0);
    assert.equal(unknown.observed.constructors.length, 0);
    const error = new Error('Linux candidate runtime mismatch: modules.');
    const invalid = await activationFixture(profile, error);
    assert.throws(invalid.activate, received => received === error);
    assert.equal(invalid.observed.factory.length, 1);
    assert.equal(invalid.observed.constructors.length, 0);
  });
  console.log(`Execution runtime selection: ${passed}/${passed} pure cases passed (real activate entry, controlled constructor/factory, no native).`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
