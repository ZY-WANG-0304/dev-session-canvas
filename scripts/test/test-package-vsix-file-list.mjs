import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveCommand,
  resolveVsceEntry,
  stageMainPackageFiles
} from '../release/package-vsix.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainExtensionRoot = path.join(repoRoot, 'extensions', 'vscode', 'dev-session-canvas');
const vsceEntry = resolveVsceEntry(repoRoot);

assert.ok(
  vsceEntry,
  'Local @vscode/vsce executable was not found. Run npm install in the repository root first.'
);

const packageJson = JSON.parse(
  readFileSync(path.join(mainExtensionRoot, 'package.json'), 'utf8')
);
const stageRoot = mkdtempSync(path.join(os.tmpdir(), 'dsc-main-vsix-list-'));

try {
  stageMainPackageFiles(stageRoot, packageJson, 'README.marketplace.md');

  const command = resolveCommand(vsceEntry, ['ls']);
  const result = spawnSync(command.file, command.args, {
    cwd: stageRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsVerbatimArguments: command.windowsVerbatimArguments
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packagedFiles = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);

  for (const expectedFile of [
    'package.nls.json',
    'package.nls.zh-cn.json',
    'l10n/bundle.l10n.zh-cn.json'
  ]) {
    assert.ok(
      packagedFiles.includes(expectedFile),
      `Expected VSIX file list to include localization resource ${expectedFile}.`
    );
  }

  const forbiddenPrefixes = [
    'apps/',
    'packages/',
    'src/',
    'docs/',
    '../',
    '../../../',
    'node_modules/node-pty/binding.gyp',
    'node_modules/node-pty/src/',
    'node_modules/node-pty/scripts/',
    'node_modules/node-pty/typings/',
    'node_modules/node-pty/third_party/',
    'node_modules/node-pty/prebuilds/win32-x64/conpty.pdb',
    'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.pdb',
    'node_modules/node-pty/prebuilds/win32-arm64/conpty.pdb',
    'node_modules/node-pty/prebuilds/win32-arm64/conpty_console_list.pdb',
    'node_modules/node-pty/node_modules/node-addon-api/'
  ];
  const forbiddenFiles = packagedFiles.filter((file) =>
    forbiddenPrefixes.some((prefix) => file.startsWith(prefix))
  );

  assert.deepEqual(
    forbiddenFiles,
    [],
    `VSIX file list contains non-runtime source directories:\n${forbiddenFiles.join('\n')}`
  );

  console.log('package-vsix file-list tests passed');
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}
