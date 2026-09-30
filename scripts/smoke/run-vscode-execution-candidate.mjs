import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ensureVSCodeExecutable, launchPreparedVSCodeScenario, prepareMainSmokeHostExtension,
  prepareRuntime, resolveStagedSmokeTestPath, runInsideXvfb, shouldReRunInsideXvfb } from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const { values } = parseArgs({ options: { output: { type: 'string' }, mode: { type: 'string' } } });
assert.equal(process.platform, 'linux', 'This finite product acceptance requires Linux.');
assert(values.output, 'Specify a new --output evidence directory.');
assert(values.mode === undefined || ['live-runtime', 'snapshot-only'].includes(values.mode), 'Unknown mode.');
const modes = values.mode ? [values.mode] : ['live-runtime', 'snapshot-only'];
if (shouldReRunInsideXvfb()) process.exit(runInsideXvfb(fileURLToPath(import.meta.url), projectRoot));
const output = path.resolve(values.output);
await fs.mkdir(output);
const runId = randomUUID();
const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);
const dist = path.join(projectRoot, 'extensions/vscode/dev-session-canvas/dist');
const manifest = JSON.parse(await fs.readFile(path.join(dist,
  'native/linux-execution-candidate/linux-x64-glibc/manifest.json'), 'utf8'));
assert.equal(manifest.runtime.name, 'electron', 'Use the matching Electron candidate build, not a Node addon.');
assert.equal(manifest.profile, 'linux-owner-v1-candidate');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = {};
for (const file of ['extension.js', 'runtime-supervisor.js', 'linux-execution-provider.js', 'webview.js']) {
  sourceHashes[file] = hash(await fs.readFile(path.join(dist, file)));
}
for (const file of ['scripts/smoke/run-vscode-execution-candidate.mjs',
  'tests/vscode-smoke/execution-candidate-tests.cjs',
  'tests/vscode-smoke/fixtures/execution-candidate-subject.cjs']) {
  sourceHashes[file] = hash(await fs.readFile(path.join(projectRoot, file)));
}
await fs.writeFile(path.join(output, 'input.json'), `${JSON.stringify({
  schemaVersion: 1, scope: 'A2/A3 finite Linux two-mode real Terminal and actual Electron Webview; not A4/A5 closure',
  vscodeExecutablePath, subjectExecutable: process.execPath, subjectVersions: process.versions,
  assetManifest: manifest, sourceHashes, lineCount: 90000, scrollback: 100000,
  partialSelection: values.mode !== undefined,
  scenarios: modes.map(mode => ({ mode, surface: mode === 'live-runtime' ? 'editor' : 'panel' }))
}, null, 2)}\n`);

for (const [index, mode] of modes.entries()) {
  const debugRoot = path.join(output, mode);
  const runtime = await prepareRuntime({ projectRoot, debugRoot,
    runtimeDirName: `dsc-candidate-${runId}-${index}`,
    userSettings: { 'security.workspace.trust.enabled': false,
      'devSessionCanvas.runtimePersistence.enabled': mode === 'live-runtime',
      'devSessionCanvas.terminal.shell': 'default', 'devSessionCanvas.terminal.shellPath': '/bin/sh',
      'terminal.integrated.scrollback': 100000 } });
  const workspacePath = path.join(debugRoot, 'workspace');
  await fs.mkdir(workspacePath);
  const smokeHostRoot = await prepareMainSmokeHostExtension({ projectRoot, targetRoot: path.join(debugRoot, 'smoke-host') });
  try {
    for (const phase of ['complete', 'reopen']) {
      await launchPreparedVSCodeScenario({ projectRoot, runtime, vscodeExecutablePath, workspacePath,
        extensionDevelopmentPath: smokeHostRoot,
        extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'execution-candidate-tests.cjs'),
        disableExtensions: false, disableWorkspaceTrust: true,
        extensionTestsEnv: { DEV_SESSION_CANVAS_CANDIDATE_MODE: mode,
          DEV_SESSION_CANVAS_CANDIDATE_PHASE: phase,
          DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE: process.execPath } });
    }
  } catch (error) {
    await fs.writeFile(path.join(output, 'first-failure.json'), `${JSON.stringify({ mode, error: String(error) }, null, 2)}\n`);
    throw error;
  }
}
console.log(`Finite real Electron candidate acceptance passed: ${output}`);
