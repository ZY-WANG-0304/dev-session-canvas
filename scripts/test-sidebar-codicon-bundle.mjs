import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-sidebar-codicon-'));

try {
  const buildScriptContents = await readFile('scripts/build.mjs', 'utf8');
  assert.match(
    buildScriptContents,
    /sidebar-codicon\.css/,
    'Expected build.mjs to include the sidebar codicon bundled asset entry.'
  );

  await esbuild.build({
    entryPoints: {
      'sidebar-codicon': 'src/webview/sidebar-codicon.css'
    },
    bundle: true,
    format: 'iife',
    outdir: tempDir,
    entryNames: '[name]',
    platform: 'browser',
    target: 'es2020',
    loader: {
      '.ttf': 'file'
    }
  });

  const outputFiles = await readdir(tempDir);
  assert.ok(
    outputFiles.includes('sidebar-codicon.css'),
    'Expected the sidebar codicon bundle to emit sidebar-codicon.css.'
  );
  assert.ok(
    outputFiles.some((fileName) => /^codicon-.*\.ttf$/u.test(fileName)),
    'Expected the sidebar codicon bundle to emit a hashed codicon font asset.'
  );

  const bundledCss = await readFile(path.join(tempDir, 'sidebar-codicon.css'), 'utf8');
  assert.match(bundledCss, /\.codicon/u, 'Expected the bundled sidebar codicon CSS to contain codicon class rules.');
  assert.match(bundledCss, /@font-face/u, 'Expected the bundled sidebar codicon CSS to contain a font-face declaration.');

  console.log('sidebar codicon bundle tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
