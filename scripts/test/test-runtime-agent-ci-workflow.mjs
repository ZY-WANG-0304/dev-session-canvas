import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';

const source = await readFile('.github/workflows/runtime-exit-integrity-native.yml', 'utf8');
const workflow = yaml.load(source);
const input = workflow.on.workflow_dispatch.inputs.real_agents;
assert.equal(input.type, 'boolean');
assert.equal(input.default, false);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.equal(workflow.env, undefined, 'Credentials must not enter workflow-wide environment.');

const baseline = workflow.jobs['native-node-pty'];
const acceptance = workflow.jobs['real-agent-linux'];
assert.equal(baseline.if, "github.event_name != 'workflow_dispatch' || !inputs.real_agents");
assert.equal(acceptance.if, "github.event_name == 'workflow_dispatch' && inputs.real_agents");
assert.deepEqual(baseline.strategy.matrix.os, ['ubuntu-latest', 'macos-latest', 'windows-latest']);
assert.equal(acceptance['runs-on'], 'ubuntu-22.04');
assert.equal(acceptance.environment, undefined, 'Repository secret acceptance has no Environment dependency.');
assert.equal(acceptance.strategy, undefined, 'Real Agent acceptance must not fan out into a matrix.');
assert.equal(acceptance.env, undefined, 'Preparation must not inherit the Agent credential.');
assert.equal(acceptance['timeout-minutes'], 40);
assert.deepEqual(acceptance.concurrency, { group: 'runtime-real-agent-acceptance', 'cancel-in-progress': false });

const step = name => {
  const found = acceptance.steps.find(candidate => candidate.name === name);
  assert.ok(found, `Missing acceptance step: ${name}`);
  return found;
};
const checkout = step('Checkout acceptance source');
assert.equal(checkout.uses, 'actions/checkout@v4');
assert.equal(checkout.with['persist-credentials'], false);
assert.equal(checkout.with.ref, undefined, 'Manual dispatch must test its selected branch.');
assert.equal(step('Setup fixed Agent Node.js').with['node-version'], '25.6.0');
assert.equal(step('Install locked dependencies').run, 'npm ci --no-audit --no-fund');
const cliInstall = step('Install fixed real Agent CLIs');
assert.match(cliInstall.run, /@openai\/codex@0\.157\.1\b/u);
assert.match(cliInstall.run, /@anthropic-ai\/claude-code@2\.1\.280\b/u);
const linuxDependencies = step('Install Linux desktop and sandbox dependencies');
assert.match(linuxDependencies.run, /\bxvfb\b/u);
assert.match(linuxDependencies.run, /\bbubblewrap\b/u);
assert.match(linuxDependencies.run, /\blibgtk-3-0\b/u);
assert.match(linuxDependencies.run, /\blibasound2\b/u);
assert.doesNotMatch(linuxDependencies.run, /t64/u);
assert.match(linuxDependencies.run, /bwrap --unshare-user --ro-bind \/ \/ \/usr\/bin\/true/u);
assert.doesNotMatch(linuxDependencies.run, /sysctl|apparmor_restrict|disable.*(?:apparmor|sandbox)/iu);
const vscode = step('Prepare fixed VS Code');
assert.match(vscode.run, /version: '1\.117\.0'/u);
assert.match(vscode.run, /platform: 'linux-x64'/u);
assert.match(vscode.run, /DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/u);
const build = step('Build fixed Electron execution candidate');
assert.match(build.run, /assert\.equal\(process\.versions\.electron, "39\.8\.7"\)/u);
assert.match(build.run, /assert\.equal\(process\.versions\.node, "22\.22\.1"\)/u);
assert.match(build.run, /assert\.equal\(process\.versions\.modules, "140"\)/u);
assert.match(build.run, /af6712ab16c436b9288ece2f0173924c74008446346bda3457d07b769f402eda/u);
assert.match(build.run, /ELECTRON_RUN_AS_NODE=1 .*linux-execution-candidate-assets\.mjs build/u);
assert.match(build.run, /--execution-profile=linux-owner-v1-candidate --execution-assets/u);

const run = step('Run finite real Agent acceptance');
assert.equal(run.id, 'real_agents');
assert.deepEqual(run.env, { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY }}' });
assert.equal(run.if, undefined, 'Missing credentials must fail inside the runner, not skip acceptance.');
assert.equal(run['continue-on-error'], undefined);
assert.match(run.run, /run-vscode-agent-candidate\.mjs --backend=deepseek --ci-report agent-ci-report --output/u);
assert.match(run.run, /\.debug\/agent-ci-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/u);
assert.match(run.run, /umask 077/u);
assert.match(run.run, /> "\$RUNNER_TEMP\/agent-candidate\.log" 2>&1/u);
assert.match(run.run, /else\n\s+echo 'Real Agent acceptance failed; sanitized report: agent-ci-report\/' >&2\n\s+exit 1/u);
assert.doesNotMatch(run.run, /GITHUB_OUTPUT|report_ready/u,
  'Only the runner may publish report readiness after writing the sanitized report.');
assert.doesNotMatch(run.run, /\bcat\b|set -x|tee|\$DEEPSEEK_API_KEY/u,
  'The acceptance step must not expose raw output or credential values in Actions logs.');
assert.equal(acceptance.steps.filter(candidate => candidate.run).at(-1), run,
  'Only artifact upload may follow the credential-bearing acceptance step.');
const credentialSteps = Object.values(workflow.jobs).flatMap(job => job.steps)
  .filter(candidate => JSON.stringify(candidate).includes('secrets.'));
assert.deepEqual(credentialSteps, [run], 'The repository credential is available only during acceptance.');
for (const preparation of [cliInstall, vscode, build, linuxDependencies]) {
  assert.ok(acceptance.steps.indexOf(preparation) < acceptance.steps.indexOf(run));
}
const upload = step('Upload sanitized real Agent report');
assert.equal(upload.if, "always() && steps.real_agents.outputs.report_ready == 'true'");
assert.equal(upload.uses, 'actions/upload-artifact@v4');
assert.equal(upload.with.path, 'agent-ci-report/');
assert.equal(upload.with['if-no-files-found'], 'error', 'A missing sanitized report must not pass silently.');
assert.equal(upload.with['include-hidden-files'], undefined);
assert.deepEqual(acceptance.steps.filter(candidate => candidate.uses?.startsWith('actions/upload-artifact@')), [upload]);
assert.doesNotMatch(JSON.stringify(upload.with), /\.debug|HOME|provider|auth/u,
  'Raw output, temporary credentials and home directories must not be uploaded.');
for (const candidate of acceptance.steps.filter(candidate => candidate.run)) {
  const syntax = spawnSync('bash', ['-n'], { input: candidate.run, encoding: 'utf8' });
  assert.equal(syntax.status, 0, `Invalid shell syntax in ${candidate.name}: ${syntax.stderr}`);
}

const macWorkflow = yaml.load(await readFile('.github/workflows/runtime-real-agent-macos.yml', 'utf8'));
assert.deepEqual(Object.keys(macWorkflow.on), ['workflow_dispatch'], 'Real Agent runs require explicit manual dispatch.');
assert.deepEqual(macWorkflow.permissions, { contents: 'read' });
assert.equal(macWorkflow.env, undefined, 'Credentials must not enter workflow-wide environment.');
assert.deepEqual(macWorkflow.concurrency, acceptance.concurrency, 'Linux and macOS share one finite acceptance lane.');
assert.deepEqual(Object.keys(macWorkflow.jobs), ['real-agent-macos']);
const macAcceptance = macWorkflow.jobs['real-agent-macos'];
assert.equal(macAcceptance['runs-on'], 'macos-latest');
assert.equal(macAcceptance['timeout-minutes'], 40);
assert.equal(macAcceptance.if, undefined);
assert.equal(macAcceptance.environment, undefined);
assert.equal(macAcceptance.strategy, undefined, 'Real Agent acceptance must not fan out into a matrix.');
assert.equal(macAcceptance.env, undefined, 'Preparation must not inherit the Agent credential.');
const macStep = name => {
  const found = macAcceptance.steps.find(candidate => candidate.name === name);
  assert.ok(found, `Missing macOS acceptance step: ${name}`);
  return found;
};
for (const name of ['Checkout acceptance source', 'Setup fixed Agent Node.js', 'Install locked dependencies',
  'Install fixed real Agent CLIs', 'Run finite real Agent acceptance']) {
  assert.deepEqual(macStep(name), step(name), `macOS must preserve the shared ${name} contract.`);
}
const python = macStep('Setup fixed process observer Python');
assert.equal(python.uses, 'actions/setup-python@v5');
assert.equal(python.with['python-version'], '3.12.10');
const observer = macStep('Prepare isolated process observer');
assert.match(observer.run, /python -m venv "\$RUNNER_TEMP\/agent-observer"/u);
assert.match(observer.run, /"\$RUNNER_TEMP\/agent-observer\/bin\/python" -m pip install --only-binary=:all: --require-hashes --requirement scripts\/test\/fixtures\/darwin-agent-observer-requirements\.txt/u);
assert.match(observer.run, /echo "DEV_SESSION_CANVAS_AGENT_OBSERVER_PYTHON=\$RUNNER_TEMP\/agent-observer\/bin\/python" >> "\$GITHUB_ENV"/u);
const requirements = await readFile('scripts/test/fixtures/darwin-agent-observer-requirements.txt', 'utf8');
assert.deepEqual(requirements.trim().split(/\s+/u), [
  'psutil==7.0.0',
  '--hash=sha256:101d71dc322e3cffd7cea0650b09b3d08b8e7c4109dd6809fe452dfd00e58b25',
  '--hash=sha256:39db632f6bb862eeccf56660871433e111b6ea58f2caea825571951d4b6aa3da'
], 'The observer accepts only the fixed macOS x64 and arm64 psutil wheels.');
const macChecks = macStep('Check real Agent workflow contract');
assert.match(macChecks.run, /node scripts\/test\/test-runtime-agent-ci-workflow\.mjs/u);
assert.match(macChecks.run, /node scripts\/test\/test-agent-candidate-process-observer\.mjs/u);
assert.match(macChecks.run, /"\$DEV_SESSION_CANVAS_AGENT_OBSERVER_PYTHON" -B scripts\/test\/test-agent-candidate-process-observer\.py/u);
assert.ok(macAcceptance.steps.indexOf(python) < macAcceptance.steps.indexOf(observer));
assert.ok(macAcceptance.steps.indexOf(observer) < macAcceptance.steps.indexOf(macChecks));
const macVSCode = macStep('Prepare fixed VS Code');
assert.match(macVSCode.run, /version: '1\.117\.0'/u);
assert.match(macVSCode.run, /platform: process\.arch === 'arm64' \? 'darwin-arm64' : 'darwin'/u);
assert.match(macVSCode.run, /DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/u);
const macBuild = macStep('Build fixed Electron execution candidate');
assert.match(macBuild.run, /assert\.equal\(process\.versions\.electron, "39\.8\.7"\)/u);
assert.match(macBuild.run, /assert\.equal\(process\.versions\.node, "22\.22\.1"\)/u);
assert.match(macBuild.run, /assert\.equal\(process\.versions\.modules, "140"\)/u);
assert.match(macBuild.run, /af6712ab16c436b9288ece2f0173924c74008446346bda3457d07b769f402eda/u);
assert.match(macBuild.run, /ELECTRON_RUN_AS_NODE=1 .*macos-execution-candidate-assets\.mjs build/u);
assert.match(macBuild.run, /--execution-profile=macos-owner-v1-candidate --execution-assets/u);
const macRun = macStep('Run finite real Agent acceptance');
assert.deepEqual(macAcceptance.steps.filter(candidate => JSON.stringify(candidate).includes('secrets.')), [macRun]);
for (const preparation of macAcceptance.steps.slice(0, macAcceptance.steps.indexOf(macRun))) {
  assert.equal(preparation.env, undefined, `Preparation cannot receive credential environment: ${preparation.name}`);
  assert.doesNotMatch(JSON.stringify(preparation), /DEEPSEEK_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|secrets\./u);
}
const macUpload = macStep('Upload sanitized real Agent report');
assert.deepEqual(macAcceptance.steps.slice(macAcceptance.steps.indexOf(macRun) + 1), [macUpload],
  'Only sanitized report upload may follow credential-bearing acceptance.');
assert.deepEqual(macUpload, { ...upload, with: { ...upload.with,
  name: 'runtime-real-agent-macos-${{ github.run_id }}-${{ github.run_attempt }}' } });
assert.deepEqual(macAcceptance.steps.filter(candidate => candidate.uses?.startsWith('actions/upload-artifact@')), [macUpload],
  'Raw Agent output, temporary credentials and home directories must never be uploaded.');
for (const candidate of macAcceptance.steps.filter(candidate => candidate.run)) {
  const syntax = spawnSync('bash', ['-n'], { input: candidate.run, encoding: 'utf8' });
  assert.equal(syntax.status, 0, `Invalid shell syntax in macOS ${candidate.name}: ${syntax.stderr}`);
}

console.log('runtime real Agent CI workflow contract tests passed for Linux and macOS');
