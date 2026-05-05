import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareDebugMainOnlyExtension } from './prepare-debug-main-only-extension.mjs';

const workspaceFolder = '${workspaceFolder}';
const localRepoRoot = '${input:devSessionCanvas.localRepoRoot}';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchJsonPath = path.join(repoRoot, '.vscode', 'launch.json');
const launchJson = JSON.parse(await readFile(launchJsonPath, 'utf8'));

function getConfiguration(name) {
  const match = launchJson.configurations.find((configuration) => configuration.name === name);
  assert.ok(match, `Missing launch configuration: ${name}`);
  return match;
}

function assertArgsContain(configuration, expectedArgs) {
  for (const expectedArg of expectedArgs) {
    assert.ok(
      configuration.args.includes(expectedArg),
      `Expected ${configuration.name} to include launch arg: ${expectedArg}`
    );
  }
}

assert.deepEqual(
  launchJson.configurations.map((configuration) => configuration.name),
  [
    'Run Dev Session Canvas (Main Only)',
    'Run Dev Session Canvas + Notifier (Local Window)',
    'Run Dev Session Canvas + Notifier (Remote Window)'
  ],
  'Expected launch configurations to be reduced to the three supported debug scenarios.'
);

const mainOnlyExtensionPath = `${workspaceFolder}/.debug/vscode-extension-main-only`;
const notifierExtensionPath = `${workspaceFolder}/extensions/vscode/dev-session-canvas-notifier`;

const runMainOnly = getConfiguration('Run Dev Session Canvas (Main Only)');
assert.equal(runMainOnly.preLaunchTask, 'build debug main-only extension');
assertArgsContain(runMainOnly, [
  '--profile=Dev Session Canvas Extension Debug',
  `--extensionDevelopmentPath=${mainOnlyExtensionPath}`
]);
assert.deepEqual(runMainOnly.sourceMapPathOverrides, {
  '../src/*': `${workspaceFolder}/src/*`,
  '../packages/*': `${workspaceFolder}/packages/*`,
  '../node_modules/*': `${workspaceFolder}/node_modules/*`
});

const runLocalNotifier = getConfiguration('Run Dev Session Canvas + Notifier (Local Window)');
assert.equal(runLocalNotifier.preLaunchTask, 'build extension + notifier');
assertArgsContain(runLocalNotifier, [
  '--profile=Dev Session Canvas Notifier Extension Debug',
  `--extensionDevelopmentPath=${workspaceFolder}`,
  `--extensionDevelopmentPath=${notifierExtensionPath}`
]);

const runRemoteNotifier = getConfiguration('Run Dev Session Canvas + Notifier (Remote Window)');
assert.equal(runRemoteNotifier.preLaunchTask, 'build extension');
assertArgsContain(runRemoteNotifier, [
  '--profile=Dev Session Canvas Notifier Extension Debug',
  `--extensionDevelopmentPath=${workspaceFolder}`,
  `--extensionDevelopmentPath=${localRepoRoot}/extensions/vscode/dev-session-canvas-notifier`
]);
assert.equal(runRemoteNotifier.args.some((argument) => argument.startsWith('--remote=')), false);

assert.deepEqual(
  launchJson.inputs.map((input) => input.id),
  ['devSessionCanvas.localRepoRoot'],
  'Expected the remote notifier config to be the only remaining prompt-driven entry.'
);

const preparedOutputDir = path.join(repoRoot, '.debug', 'test-vscode-extension-main-only');
await prepareDebugMainOnlyExtension({ sourceRoot: repoRoot, outputDir: preparedOutputDir });
const sourceManifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const preparedManifest = JSON.parse(await readFile(path.join(preparedOutputDir, 'package.json'), 'utf8'));

assert.equal(preparedManifest.name, sourceManifest.name);
assert.equal(preparedManifest.main, sourceManifest.main);
assert.equal('extensionDependencies' in preparedManifest, false);

await rm(preparedOutputDir, { recursive: true, force: true });

console.log('debug launch configuration tests passed');
