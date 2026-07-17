import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareDebugMainOnlyExtension } from '../shared/prepare-debug-main-only-extension.mjs';

const workspaceFolder = '${workspaceFolder}';
const localRepoRoot = '${input:devSessionCanvas.localRepoRoot}';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainExtensionRoot = path.join(repoRoot, 'extensions', 'vscode', 'dev-session-canvas');
const launchJsonPath = path.join(repoRoot, '.vscode', 'launch.json');
const tasksJsonPath = path.join(repoRoot, '.vscode', 'tasks.json');
const launchJson = JSON.parse(await readFile(launchJsonPath, 'utf8'));
const tasksJson = JSON.parse(await readFile(tasksJsonPath, 'utf8'));

function getConfiguration(name) {
  const match = launchJson.configurations.find((configuration) => configuration.name === name);
  assert.ok(match, `Missing launch configuration: ${name}`);
  return match;
}

function getTask(label) {
  const match = tasksJson.tasks.find((task) => task.label === label);
  assert.ok(match, `Missing VS Code task: ${label}`);
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
const mainExtensionPath = `${workspaceFolder}/extensions/vscode/dev-session-canvas`;
const notifierExtensionPath = `${workspaceFolder}/extensions/vscode/dev-session-canvas-notifier`;

const runMainOnly = getConfiguration('Run Dev Session Canvas (Main Only)');
assert.equal(runMainOnly.preLaunchTask, 'build debug main-only extension');
assertArgsContain(runMainOnly, [
  '--profile=Dev Session Canvas Extension Debug',
  `--extensionDevelopmentPath=${mainOnlyExtensionPath}`
]);
assert.deepEqual(runMainOnly.sourceMapPathOverrides, {
  '../src/*': `${workspaceFolder}/extensions/vscode/dev-session-canvas/src/*`,
  '../../../../../packages/*': `${workspaceFolder}/packages/*`,
  '../../../../../node_modules/*': `${workspaceFolder}/node_modules/*`,
  '../../../node_modules/*': `${workspaceFolder}/node_modules/*`
});

const runLocalNotifier = getConfiguration('Run Dev Session Canvas + Notifier (Local Window)');
assert.equal(runLocalNotifier.preLaunchTask, 'build extension + notifier');
assertArgsContain(runLocalNotifier, [
  '--profile=Dev Session Canvas Notifier Extension Debug',
  `--extensionDevelopmentPath=${mainExtensionPath}`,
  `--extensionDevelopmentPath=${notifierExtensionPath}`
]);

const runRemoteNotifier = getConfiguration('Run Dev Session Canvas + Notifier (Remote Window)');
assert.equal(runRemoteNotifier.preLaunchTask, 'build extension');
assertArgsContain(runRemoteNotifier, [
  '--profile=Dev Session Canvas Notifier Extension Debug',
  `--extensionDevelopmentPath=${mainExtensionPath}`,
  `--extensionDevelopmentPath=${localRepoRoot}/extensions/vscode/dev-session-canvas-notifier`
]);
assert.equal(runRemoteNotifier.args.some((argument) => argument.startsWith('--remote=')), false);

assert.deepEqual(
  launchJson.inputs.map((input) => input.id),
  ['devSessionCanvas.localRepoRoot'],
  'Expected the remote notifier config to be the only remaining prompt-driven entry.'
);

const installDependenciesTask = getTask('install dependencies');
assert.equal(installDependenciesTask.command, 'node');
assert.deepEqual(installDependenciesTask.args, ['scripts/shared/ensure-node-dependencies.mjs']);

const buildExtensionTask = getTask('build extension');
assert.equal(buildExtensionTask.dependsOrder, 'sequence');
assert.deepEqual(buildExtensionTask.dependsOn, ['install dependencies']);

const buildNotifierTask = getTask('build notifier');
assert.equal(buildNotifierTask.dependsOrder, 'sequence');
assert.deepEqual(buildNotifierTask.dependsOn, ['install dependencies']);

const preparedOutputDir = path.join(repoRoot, '.debug', 'test-vscode-extension-main-only');
await prepareDebugMainOnlyExtension({ outputDir: preparedOutputDir });
const sourceManifest = JSON.parse(await readFile(path.join(mainExtensionRoot, 'package.json'), 'utf8'));
const preparedManifest = JSON.parse(await readFile(path.join(preparedOutputDir, 'package.json'), 'utf8'));

assert.equal(preparedManifest.name, sourceManifest.name);
assert.equal(preparedManifest.main, sourceManifest.main);
assert.equal('extensionDependencies' in preparedManifest, false);
assert.equal('extensionPack' in preparedManifest, false);
await access(path.join(preparedOutputDir, 'scripts', 'runtime', 'claude-file-event-hook.cjs'));
await access(path.join(preparedOutputDir, 'scripts', 'runtime', 'agent-lifecycle-hook.cjs'));

await rm(preparedOutputDir, { recursive: true, force: true });

console.log('debug launch configuration tests passed');
