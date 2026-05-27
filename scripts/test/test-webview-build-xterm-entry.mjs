import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-webview-xterm-entry-'));

try {
  const buildScriptContents = await readFile('scripts/build/build.mjs', 'utf8');
  assert.match(
    buildScriptContents,
    /@xterm\/xterm\/lib\/xterm\.js/u,
    'Expected the Webview build to pin @xterm/xterm to the CommonJS browser entry.'
  );

  const entryFile = path.join(tempDir, 'xterm-decrqm-probe.js');
  const outfile = path.join(tempDir, 'xterm-decrqm-probe.bundle.js');

  await writeFile(
    entryFile,
    [
      "import { Terminal } from '@xterm/xterm';",
      '',
      "const terminal = new Terminal({ cols: 80, rows: 24, cursorBlink: true });",
      "let data = '';",
      'terminal.onData((chunk) => {',
      '  data += chunk;',
      '});',
      '',
      "terminal.write('\\x1b[?12$p', () => {",
      "  if (data !== '\\x1b[?12;1$y') {",
      "    throw new Error(`Unexpected DECRQM response: ${JSON.stringify(data)}`);",
      '  }',
      "  console.log('xterm DECRQM probe passed');",
      '});',
      ''
    ].join('\n'),
    'utf8'
  );

  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    minify: true,
    nodePaths: [path.resolve('node_modules')],
    format: 'iife',
    outfile,
    platform: 'browser',
    target: 'es2020',
    plugins: [
      {
        name: 'xterm-browser-main-entry',
        setup(build) {
          build.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({
            path: require.resolve('@xterm/xterm/lib/xterm.js')
          }));
        }
      }
    ]
  });

  const result = spawnSync(process.execPath, [outfile], {
    encoding: 'utf8'
  });

  assert.equal(
    result.status,
    0,
    `Expected bundled xterm DECRQM probe to pass.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(result.stdout, /xterm DECRQM probe passed/u);

  console.log('webview xterm entry build tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
