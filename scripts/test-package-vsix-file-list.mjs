import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCommand, resolveVsceEntry } from './package-vsix.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vsceEntry = resolveVsceEntry(repoRoot);

assert.ok(
  vsceEntry,
  'Local @vscode/vsce executable was not found. Run npm install in the repository root first.'
);

const command = resolveCommand(vsceEntry, ['ls']);
const result = spawnSync(command.file, command.args, {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  windowsVerbatimArguments: command.windowsVerbatimArguments
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const packagedFiles = result.stdout
  .split(/\r?\n/u)
  .map((line) => line.trim().replace(/\\/g, '/'))
  .filter(Boolean);

const forbiddenPrefixes = ['apps/', 'packages/', 'src/', 'docs/'];
const forbiddenFiles = packagedFiles.filter((file) =>
  forbiddenPrefixes.some((prefix) => file.startsWith(prefix))
);

assert.deepEqual(
  forbiddenFiles,
  [],
  `VSIX file list contains non-runtime source directories:\n${forbiddenFiles.join('\n')}`
);

console.log('package-vsix file-list tests passed');
