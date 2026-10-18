import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';
import { browserBuildConfig } from '../build/build-browser-assets.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-sidebar-codicon-'));

try {
  const config = browserBuildConfig({ output: tempDir });
  assert(config.entryPoints['sidebar-codicon'].endsWith('sidebar-codicon.css'));
  await esbuild.build(config);

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
  assert.match(
    bundledCss,
    /\.codicon-worktree/u,
    'Expected the bundled sidebar codicon CSS to include the dedicated worktree icon used by workspace-root actions.'
  );
  assert.match(
    bundledCss,
    /\.codicon-repo/u,
    'Expected the bundled sidebar codicon CSS to include the repository icon used by workspace folder rows.'
  );
  assert.match(
    bundledCss,
    /\.codicon-folder/u,
    'Expected the bundled sidebar codicon CSS to include the folder icon used by workspace folder rows.'
  );
  assert.match(bundledCss, /@font-face/u, 'Expected the bundled sidebar codicon CSS to contain a font-face declaration.');

  console.log('sidebar codicon bundle tests passed');
} finally {
  esbuild.stop();
  await rm(tempDir, { recursive: true, force: true });
}
