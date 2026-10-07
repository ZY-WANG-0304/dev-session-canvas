import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';
import cliHelpers from '../../tests/vscode-smoke/agent-candidate-cli.cjs';
import { assertInstalledCandidateSelection } from '../smoke/installed-execution-candidate.mjs';

const source = await readFile('.github/workflows/runtime-exit-integrity-native.yml', 'utf8');
const workflow = yaml.load(source);
const input = workflow.on.workflow_dispatch.inputs.real_agents;
assert.equal(input.type, 'boolean');
assert.equal(input.default, false);
const platformInput = workflow.on.workflow_dispatch.inputs.real_agent_platform;
assert.equal(platformInput.type, 'choice');
assert.equal(platformInput.default, 'linux');
assert.deepEqual(platformInput.options, ['linux', 'macos', 'windows']);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.equal(workflow.env, undefined, 'Credentials must not enter workflow-wide environment.');
assert.deepEqual(workflow.concurrency, { group: 'runtime-exit-native-${{ github.ref }}', 'cancel-in-progress': false });
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch', 'push']);
assert.deepEqual(workflow.on.push.branches, ['runtime-exit-integrity-platform-runners', 'runtime-exit-integrity-platform-runners-agent']);

const baseline = workflow.jobs['native-node-pty'];
const acceptance = workflow.jobs['real-agent-linux'];
assert.equal(baseline.if, "github.event_name != 'workflow_dispatch' || !inputs.real_agents");
assert.equal(acceptance.if, "github.event_name == 'workflow_dispatch' && inputs.real_agents && inputs.real_agent_platform == 'linux'");
assert.deepEqual(baseline.strategy.matrix.os, ['ubuntu-latest', 'macos-latest', 'windows-latest']);
assert.equal(acceptance['runs-on'], 'ubuntu-22.04');
assert.equal(acceptance.environment, undefined, 'Repository secret acceptance has no Environment dependency.');
assert.equal(acceptance.strategy, undefined, 'Real Agent acceptance must not fan out into a matrix.');
assert.equal(acceptance.env, undefined, 'Preparation must not inherit the Agent credential.');
assert.equal(acceptance['timeout-minutes'], 40);
assert.deepEqual(acceptance.concurrency, { group: 'runtime-real-agent-acceptance', 'cancel-in-progress': false });
for (const platform of ['macos', 'windows']) {
  const caller = workflow.jobs[`real-agent-${platform}`];
  assert.equal(caller.if, `github.event_name == 'workflow_dispatch' && inputs.real_agents && inputs.real_agent_platform == '${platform}'`);
  assert.equal(caller.uses, `./.github/workflows/runtime-real-agent-${platform}.yml`, 'The reusable workflow must use this same source ref.');
  assert.deepEqual(caller.secrets, { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY }}' });
  for (const field of ['env', 'strategy', 'steps', 'concurrency', 'runs-on', 'with']) assert.equal(caller[field], undefined);
}
assert.notEqual(workflow.concurrency.group, acceptance.concurrency.group,
  'A caller must not hold the same concurrency group that its callee awaits.');
assert.deepEqual(Object.keys(workflow.jobs), ['native-node-pty', 'real-agent-linux', 'real-agent-macos', 'real-agent-windows']);
for (const eventName of ['push', 'workflow_dispatch']) {
  for (const realAgents of [false, true]) {
    for (const platform of platformInput.options) {
      const selected = Object.entries(workflow.jobs).filter(([, job]) =>
        new Function('github', 'inputs', `return (${job.if});`)(
          { event_name: eventName }, { real_agents: realAgents, real_agent_platform: platform })).map(([id]) => id);
      assert.deepEqual(selected, [eventName === 'workflow_dispatch' && realAgents ? `real-agent-${platform}` : 'native-node-pty']);
    }
  }
}

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
const credentialSteps = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
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
for (const candidate of acceptance.steps.filter(candidate => candidate.run && process.platform !== 'win32')) {
  const syntax = spawnSync('bash', ['-n'], { input: candidate.run, encoding: 'utf8' });
  assert.equal(syntax.status, 0, `Invalid shell syntax in ${candidate.name}: ${syntax.stderr}`);
}

const macWorkflow = yaml.load(await readFile('.github/workflows/runtime-real-agent-macos.yml', 'utf8'));
assert.deepEqual(Object.keys(macWorkflow.on), ['workflow_dispatch', 'workflow_call'], 'Real Agent runs require manual dispatch or the selected reusable call.');
assert.deepEqual(macWorkflow.on.workflow_call, { secrets: { DEEPSEEK_API_KEY: { required: true } } });
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
  'Install fixed real Agent CLIs']) {
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
assert.deepEqual(macRun, { ...run, run: run.run.replace(
  '".debug/agent-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"', '"$RUNNER_TEMP/dsc-agent"') },
  'Only the raw working path changes to fit the Darwin Unix socket limit.');
assert.ok(Buffer.byteLength('/Users/runner/work/_temp/dsc-agent/claude-snapshot-only-natural/user-data/1.11-main.sock') < 104);
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
for (const candidate of macAcceptance.steps.filter(candidate => candidate.run && process.platform !== 'win32')) {
  const syntax = spawnSync('bash', ['-n'], { input: candidate.run, encoding: 'utf8' });
  assert.equal(syntax.status, 0, `Invalid shell syntax in macOS ${candidate.name}: ${syntax.stderr}`);
}

const windowsWorkflow = yaml.load(await readFile('.github/workflows/runtime-real-agent-windows.yml', 'utf8'));
assert.deepEqual(Object.keys(windowsWorkflow.on), ['workflow_dispatch', 'workflow_call'], 'Windows real Agent runs require manual dispatch or the selected reusable call.');
assert.deepEqual(windowsWorkflow.on.workflow_call, { secrets: { DEEPSEEK_API_KEY: { required: true } } });
assert.deepEqual(windowsWorkflow.permissions, { contents: 'read' });
assert.equal(windowsWorkflow.env, undefined);
assert.deepEqual(windowsWorkflow.concurrency, acceptance.concurrency, 'All real Agent platforms share one finite acceptance lane.');
assert.deepEqual(Object.keys(windowsWorkflow.jobs), ['real-agent-windows']);
const windowsAcceptance = windowsWorkflow.jobs['real-agent-windows'];
assert.equal(windowsAcceptance['runs-on'], 'windows-latest');
assert.equal(windowsAcceptance['timeout-minutes'], 40);
for (const field of ['if', 'environment', 'strategy', 'env']) assert.equal(windowsAcceptance[field], undefined);
const windowsStep = name => {
  const found = windowsAcceptance.steps.find(candidate => candidate.name === name);
  assert.ok(found, `Missing Windows acceptance step: ${name}`);
  return found;
};
for (const name of ['Checkout acceptance source', 'Setup fixed Agent Node.js', 'Install locked dependencies',
  'Install fixed real Agent CLIs']) {
  assert.deepEqual(windowsStep(name), step(name), `Windows must preserve the shared ${name} contract.`);
}
assert.deepEqual(windowsStep('Setup x64 compiler environment'), {
  name: 'Setup x64 compiler environment', uses: 'ilammy/msvc-dev-cmd@v1', with: { arch: 'x64' }
});
const windowsChecks = windowsStep('Check real Agent workflow contract');
for (const file of ['test-agent-candidate-deepseek', 'test-agent-candidate-ci-report',
  'test-runtime-agent-ci-workflow', 'test-agent-candidate-process-observer',
  'test-agent-candidate-windows-observer', 'test-agent-candidate-cli']) {
  assert.ok(windowsChecks.run.includes(`node scripts/test/${file}.mjs\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`));
}
const windowsVSCode = windowsStep('Prepare fixed VS Code');
assert.match(windowsVSCode.run, /version: '1\.117\.0', platform: 'win32-x64-archive'/u);
assert.match(windowsVSCode.run, /DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/u);
const windowsBuild = windowsStep('Build fixed Electron execution candidate');
assert.equal(windowsBuild.shell, 'pwsh');
assert.match(windowsBuild.run, /assert\.equal\(process\.versions\.electron, "39\.8\.7"\)/u);
assert.match(windowsBuild.run, /assert\.equal\(process\.versions\.node, "22\.22\.1"\)/u);
assert.match(windowsBuild.run, /assert\.equal\(process\.versions\.modules, "140"\)/u);
assert.match(windowsBuild.run, /af6712ab16c436b9288ece2f0173924c74008446346bda3457d07b769f402eda/u);
assert.match(windowsBuild.run, /ee92beea67d0f12ef058adc52d0f5344e1005153c9487d0f4d63cab91111421a/u);
assert.match(windowsBuild.run, /win-x64\/node\.lib/u);
assert.match(windowsBuild.run, /ELECTRON_RUN_AS_NODE: '1'/u);
assert.doesNotMatch(windowsBuild.run, /& \$env:DEV_SESSION_CANVAS_VSCODE_EXECUTABLE|\$env:ELECTRON_RUN_AS_NODE =/u);
assert.match(windowsBuild.run, /'--node-lib', path\.join\(process\.env\.RUNNER_TEMP, 'agent-electron-node\.lib'\)/u);
assert.match(windowsBuild.run, /'--delay-load-hook', path\.join\(path\.dirname\(process\.execPath\)/u);
assert.match(windowsBuild.run, /--execution-profile=windows-owner-v1-candidate --execution-assets \$assets/u);
const electronScript = windowsBuild.run.match(/@'\n([\s\S]+?)\n'@ \| node --input-type=module/u)?.[1];
assert.ok(electronScript, 'Windows Electron startup must explicitly wait for both GUI-executable processes.');
const runElectronBuild = new Function('spawnSync', 'assert', 'path', 'process', electronScript.replace(/^import .+;\n/gmu, ''));
const buildEnvironment = { RUNNER_TEMP: 'C:\\temp', GITHUB_WORKSPACE: 'D:\\project', DEV_SESSION_CANVAS_VSCODE_EXECUTABLE: 'C:\\Code.exe' };
for (const failureAt of [-1, 0, 1]) {
  const calls = [];
  const invoke = () => runElectronBuild((executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: calls.length - 1 === failureAt ? 19 : 0, signal: null };
  }, assert, path.win32, { env: buildEnvironment, execPath: 'C:\\node\\node.exe' });
  if (failureAt === -1) invoke();
  else assert.throws(invoke, assert.AssertionError);
  assert.equal(calls.length, failureAt === 0 ? 1 : 2);
  assert.equal(calls[0].args[0], '-e');
  for (const call of calls) {
    assert.equal(call.executable, buildEnvironment.DEV_SESSION_CANVAS_VSCODE_EXECUTABLE);
    assert.equal(call.options.stdio, 'inherit');
    assert.deepEqual(call.options.env, { ...buildEnvironment, ELECTRON_RUN_AS_NODE: '1' });
  }
  if (calls[1]) {
    assert.deepEqual(calls[1].args.slice(0, 2), ['scripts/build/windows-execution-candidate-assets.mjs', 'build']);
    assert.ok(calls[1].args.includes('C:\\temp\\agent-native-assets'));
  }
}
const spawnFailure = new Error('controlled Electron spawn failure');
assert.throws(() => runElectronBuild(() => ({ error: spawnFailure }), assert, path.win32,
  { env: buildEnvironment, execPath: 'C:\\node\\node.exe' }), error => error === spawnFailure);
assert.equal(buildEnvironment.ELECTRON_RUN_AS_NODE, undefined, 'The Electron flag must not leak into the ordinary build process.');
const windowsRun = windowsStep('Run finite real Agent acceptance');
assert.equal(windowsRun.id, 'real_agents');
assert.deepEqual(windowsRun.env, run.env);
assert.equal(windowsRun.if, undefined);
assert.equal(windowsRun['continue-on-error'], undefined);
assert.match(windowsRun.run, /run-vscode-agent-candidate\.mjs --backend=deepseek --ci-report agent-ci-report --output \$output \*> \$log/u);
assert.match(windowsRun.run, /if \(\$LASTEXITCODE -ne 0\) \{[\s\S]*exit 1/u);
assert.doesNotMatch(windowsRun.run, /GITHUB_OUTPUT|report_ready|Get-Content|\bcat\b|\btee\b|\$env:DEEPSEEK_API_KEY/u);
assert.deepEqual(windowsAcceptance.steps.filter(candidate => JSON.stringify(candidate).includes('secrets.')), [windowsRun]);
for (const preparation of windowsAcceptance.steps.slice(0, windowsAcceptance.steps.indexOf(windowsRun))) {
  assert.equal(preparation.env, undefined, `Windows preparation cannot receive credential environment: ${preparation.name}`);
  assert.doesNotMatch(JSON.stringify(preparation), /DEEPSEEK_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|secrets\./u);
}
const windowsUpload = windowsStep('Upload sanitized real Agent report');
assert.deepEqual(windowsAcceptance.steps.slice(windowsAcceptance.steps.indexOf(windowsRun) + 1), [windowsUpload]);
assert.deepEqual(windowsUpload, { ...upload, with: { ...upload.with,
  name: 'runtime-real-agent-windows-${{ github.run_id }}-${{ github.run_attempt }}' } });
assert.deepEqual(windowsAcceptance.steps.filter(candidate => candidate.uses?.startsWith('actions/upload-artifact@')), [windowsUpload]);
if (process.platform === 'win32') {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  for (const candidate of windowsAcceptance.steps.filter(candidate => candidate.run)) {
    const parse = "$errors = $null; [void][Management.Automation.Language.Parser]::ParseInput($env:DSC_WORKFLOW_RUN, [ref]$null, [ref]$errors); if ($errors.Count -ne 0) { $errors | Out-String | Write-Error; exit 1 }";
    const syntax = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(parse, 'utf16le').toString('base64')], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, DSC_WORKFLOW_RUN: candidate.run }
    });
    assert.equal(syntax.status, 0, `Invalid Windows PowerShell syntax in ${candidate.name}: ${syntax.stderr}`);
  }
}

const production = yaml.load(await readFile('.github/workflows/runtime-production-acceptance.yml', 'utf8'));
assert.deepEqual(Object.keys(production.on), ['workflow_dispatch'],
  'After branch-only registration, final acceptance must run only on explicit dispatch.');
assert.deepEqual(production.permissions, { contents: 'read' });
assert.equal(production.env, undefined);
const productionInputs = production.on.workflow_dispatch.inputs;
assert.deepEqual(Object.keys(productionInputs), ['reuse_package_run', 'reuse_native_run', 'platform', 'agent_scenarios', 'installed_mode', 'skip_installed', 'installed_evidence_run', 'agent_reload_only']);
assert.equal(productionInputs.reuse_package_run.default, '');
assert.equal(productionInputs.reuse_native_run.default, '');
assert.equal(productionInputs.agent_scenarios.default, '');
assert.equal(productionInputs.skip_installed.default, false);
assert.equal(productionInputs.installed_evidence_run.default, '');
assert.equal(productionInputs.agent_reload_only.type, 'boolean');
assert.equal(productionInputs.agent_reload_only.default, false);
assert.equal(productionInputs.platform.default, 'all');
assert.equal(productionInputs.installed_mode.default, 'all');
assert.deepEqual(productionInputs.installed_mode.options, ['all', 'live-runtime']);
assert.deepEqual(productionInputs.platform.options, ['all', 'linux', 'macos', 'windows']);
const inputJob = production.jobs.input;
assert.deepEqual(inputJob.permissions, { contents: 'read', actions: 'read' });
assert.equal(inputJob.steps[0].with['fetch-depth'], 0);
const inputStep = inputJob.steps.find(candidate => candidate.id === 'selection');
assert.equal(inputStep.env.DSC_AGENT_RELOAD_ONLY, '${{ inputs.agent_reload_only }}');
assert(!inputStep.run.includes('${{'), 'Dispatch values must enter through environment, never shell interpolation.');
const selectionScript = inputStep.run.split("node --input-type=module <<'NODE'\n")[1].split('\nNODE')[0]
  .replace(/^import .*;\n/gm, '');
const evaluateSelection = new Function('assert', 'fs', 'execFileSync', 'cli', 'fetch', 'process',
  `return (async () => { ${selectionScript} })();`);
const platforms = [{ os: 'ubuntu-22.04', platform: 'linux' }, { os: 'macos-15', platform: 'macos' },
  { os: 'windows-2025', platform: 'windows' }];
async function selection({ values = {}, changed = [], packageSuccess = true, installedPlatforms = ['linux'],
  installedMode = 'all', sourcePath = '.github/workflows/runtime-production-acceptance.yml', repository = 'owner/repo',
  evidencePlatforms = ['linux'], evidenceMode = 'live-runtime', evidencePath = sourcePath, evidenceRepository = repository } = {}) {
  const env = { DSC_REUSE_RUN: '', DSC_NATIVE_RUN: '', DSC_PLATFORM: 'all', DSC_SCENARIOS: '', DSC_SKIP_INSTALLED: 'false',
    DSC_INSTALLED_MODE: 'all', DSC_INSTALLED_EVIDENCE_RUN: '', DSC_AGENT_RELOAD_ONLY: 'false',
    GITHUB_SHA: 'b'.repeat(40), GITHUB_RUN_ID: '999', GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_OUTPUT: '/controlled-output', GH_TOKEN: 'controlled-token', ...values };
  let output = '', requests = 0;
  await evaluateSelection(assert, { async appendFile(file, text) { assert.equal(file, env.GITHUB_OUTPUT); output += text; } },
    (command, args, options) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['diff', '--no-renames', '--name-only', '-z', 'a'.repeat(40), 'b'.repeat(40)]);
      assert.equal(options.encoding, 'utf8');
      return changed.join('\0');
    }, cliHelpers, async (url, options) => {
      requests++;
      assert.equal(options.headers.authorization, 'Bearer controlled-token');
      const separateEvidence = url.startsWith('https://api.github.com/repos/owner/repo/actions/runs/456');
      assert(separateEvidence || url.startsWith('https://api.github.com/repos/owner/repo/actions/runs/123'));
      const passedPlatforms = separateEvidence ? evidencePlatforms : installedPlatforms;
      const passedMode = separateEvidence ? evidenceMode : installedMode;
      return { ok: true, async json() {
        return url.includes('/jobs?') ? { jobs: [{ name: 'package', conclusion: packageSuccess ? 'success' : 'failure' },
          ...platforms.filter(item => passedPlatforms.includes(item.platform)).map(item => ({
            name: `product (${item.os}, ${item.platform})`, steps: [{
              name: passedMode === 'all' ? 'Installed Terminal and Webview final acceptance'
                : 'Installed Runtime Terminal and Webview affected acceptance', conclusion: 'success' }] }))] }
          : { path: separateEvidence ? evidencePath : sourcePath,
            head_repository: { full_name: separateEvidence ? evidenceRepository : repository },
            head_sha: (separateEvidence ? 'c' : 'a').repeat(40) };
      } };
    }, { env });
  return { values: Object.fromEntries(output.trim().split('\n').map(line => {
    const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
  })), requests };
}
const normalSelection = await selection();
assert.equal(normalSelection.requests, 0);
assert.equal(normalSelection.values.package_run, '999');
assert.equal(normalSelection.values.package_commit, 'b'.repeat(40));
assert.deepEqual(JSON.parse(normalSelection.values.matrix), { include: platforms });
const replayValues = { DSC_REUSE_RUN: '123', DSC_PLATFORM: 'linux', DSC_SCENARIOS: 'codex-snapshot-only-stop',
  DSC_SKIP_INSTALLED: 'true' };
const replay = await selection({ values: replayValues,
  changed: ['ARCHITECTURE.md', 'docs/design-docs/current.md', 'scripts/smoke/run-vscode-agent-candidate.mjs',
    'scripts/test/test-runtime-agent-ci-workflow.mjs', 'tests/vscode-smoke/agent-candidate-cli.cjs',
    '.github/workflows/runtime-production-acceptance.yml'] });
assert.equal(replay.requests, 2);
assert.equal(replay.values.package_run, '123');
assert.equal(replay.values.package_commit, 'a'.repeat(40));
assert.deepEqual(JSON.parse(replay.values.matrix), { include: [platforms[0]] });
const nativeOnly = await selection({ values: { DSC_NATIVE_RUN: '123', DSC_PLATFORM: 'linux',
  DSC_SCENARIOS: 'codex-live-runtime-natural' }, changed: ['extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts'] });
assert.equal(nativeOnly.values.package_run, '999');
assert.equal(nativeOnly.values.package_commit, 'b'.repeat(40));
assert.equal(nativeOnly.values.native_run, '123');
assert.equal(nativeOnly.values.native_commit, 'a'.repeat(40));
assert.equal(normalSelection.values.native_run, '999');
assert.equal(normalSelection.values.native_commit, 'b'.repeat(40));
await assert.rejects(selection({ values: { DSC_NATIVE_RUN: '123', DSC_REUSE_RUN: '123' } }), /not both/);
await assert.rejects(selection({ values: { DSC_NATIVE_RUN: '123', DSC_SKIP_INSTALLED: 'true' } }), /whole-package reuse/);
await assert.rejects(selection({ values: { DSC_NATIVE_RUN: '123' }, packageSuccess: false }), /must have succeeded/);
await assert.rejects(selection({ values: replayValues, installedMode: 'live-runtime' }), /original passed installed step/);
await selection({ values: { ...replayValues, DSC_INSTALLED_MODE: 'live-runtime' }, installedMode: 'live-runtime' });
const separateValues = { ...replayValues, DSC_INSTALLED_MODE: 'live-runtime', DSC_INSTALLED_EVIDENCE_RUN: '456' };
const separate = await selection({ values: separateValues, installedPlatforms: [] });
assert.equal(separate.requests, 4);
assert.equal(separate.values.installed_evidence_commit, 'c'.repeat(40));
assert.equal(separate.values.package_commit, 'a'.repeat(40));
const reloadOnlyValues = { ...separateValues, DSC_AGENT_RELOAD_ONLY: 'true', DSC_SCENARIOS: '' };
for (const platform of ['macos', 'windows']) {
  const reloadOnly = await selection({ values: { ...reloadOnlyValues, DSC_PLATFORM: platform },
    installedPlatforms: [], evidencePlatforms: [platform] });
  assert.equal(reloadOnly.requests, 4);
  assert.equal(reloadOnly.values.package_run, '123');
  assert.equal(reloadOnly.values.installed_evidence_commit, 'c'.repeat(40));
  assert.deepEqual(JSON.parse(reloadOnly.values.matrix), { include: platforms.filter(item => item.platform === platform) });
}
for (const changes of [{ DSC_AGENT_RELOAD_ONLY: 'other' }, { DSC_REUSE_RUN: '' },
  { DSC_SKIP_INSTALLED: 'false' }, { DSC_INSTALLED_EVIDENCE_RUN: '' },
  { DSC_SCENARIOS: 'codex-live-runtime-natural' }]) {
  await assert.rejects(selection({ values: { ...reloadOnlyValues, ...changes } }));
}
await assert.rejects(selection({ values: reloadOnlyValues, evidencePlatforms: [] }), /original passed installed step/);
await assert.rejects(selection({ values: reloadOnlyValues, changed: ['extensions/vscode/dev-session-canvas/src/extension.ts'] }), /not product inputs/);
await assert.rejects(selection({ values: reloadOnlyValues, packageSuccess: false }), /must have succeeded/);
await assert.rejects(selection({ values: separateValues, evidencePlatforms: [] }), /original passed installed step/);
await assert.rejects(selection({ values: { ...separateValues, DSC_INSTALLED_MODE: 'all' } }), /original passed installed step/);
await assert.rejects(selection({ values: separateValues, evidencePath: 'wrong-workflow.yml' }));
await assert.rejects(selection({ values: separateValues, evidenceRepository: 'another/repo' }));
for (const changes of [{ DSC_SKIP_INSTALLED: 'false' }, { DSC_REUSE_RUN: '' },
  { DSC_INSTALLED_EVIDENCE_RUN: '456\n' }, { DSC_INSTALLED_EVIDENCE_RUN: '999' }]) {
  await assert.rejects(selection({ values: { ...separateValues, ...changes } }));
}
await assert.rejects(selection({ values: { DSC_INSTALLED_MODE: 'live-runtime' } }), /Partial acceptance/);
for (const file of ['extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts',
  'scripts/build/build.mjs', 'scripts/native/linux-owner.cc', 'package-lock.json',
  'extensions/vscode/dev-session-canvas/package.json', 'scripts/release/package-vsix.mjs']) {
  await assert.rejects(selection({ values: replayValues, changed: [file] }), /not product inputs/);
}
await assert.rejects(selection({ values: replayValues, packageSuccess: false }), /must have succeeded/);
await assert.rejects(selection({ values: replayValues, installedPlatforms: [] }), /original passed installed step/);
await assert.rejects(selection({ values: { ...replayValues, DSC_PLATFORM: 'all' } }), /original passed installed step/);
await assert.rejects(selection({ values: replayValues, sourcePath: 'another-workflow.yml' }));
await assert.rejects(selection({ values: replayValues, repository: 'another/repo' }));
for (const values of [{ DSC_REUSE_RUN: '1;echo injected' }, { DSC_REUSE_RUN: '123\n' },
  { DSC_REUSE_RUN: '999' }, { DSC_PLATFORM: 'linux' }, { DSC_SKIP_INSTALLED: 'true' },
  { DSC_SCENARIOS: 'codex-snapshot-only-stop' }, { DSC_PLATFORM: 'other' },
  { DSC_REUSE_RUN: '123', DSC_SCENARIOS: 'not-a-scenario' }]) {
  await assert.rejects(selection({ values }));
}
assert.equal(production.jobs['native-assets'].uses, './.github/workflows/runtime-execution-assets.yml');
assert.equal(production.jobs['native-assets'].needs, 'input');
assert.equal(production.jobs['native-assets'].if, "inputs.reuse_package_run == '' && inputs.reuse_native_run == ''");
assert.deepEqual(production.jobs['native-assets'].with, { input_ref: '${{ github.sha }}' });
assert.deepEqual(production.jobs.package.needs, ['input', 'native-assets']);
assert.match(production.jobs.package.if, /always\(\).*needs\.input\.result == 'success'.*inputs\.reuse_package_run == ''.*needs\.native-assets\.result == 'success'.*inputs\.reuse_native_run != ''.*needs\.native-assets\.result == 'skipped'/);
assert.deepEqual(production.jobs.package.permissions, { contents: 'read', actions: 'read' });
assert.deepEqual(production.jobs.package.steps.find(step => step.uses === 'actions/download-artifact@v4').with, {
  pattern: 'execution-native-*-${{ needs.input.outputs.native_run }}', 'merge-multiple': true,
  path: 'native-archives', 'run-id': '${{ needs.input.outputs.native_run }}', 'github-token': '${{ github.token }}'
});
const assembleNative = production.jobs.package.steps.find(step => step.name === 'Assemble source-verified production assets');
assert.equal(assembleNative.env.DSC_NATIVE_COMMIT, '${{ needs.input.outputs.native_commit }}');
assert.match(assembleNative.run, /assemble-execution-distribution-assets\.mjs.*--input-sha "\$DSC_NATIVE_COMMIT"/);
assert.match(production.jobs.package.steps.find(step => step.name === 'Build and package through normal defaults').run,
  /nativeAssets: \{ run: process\.env\.DSC_NATIVE_RUN, inputCommit: process\.env\.DSC_NATIVE_COMMIT \}/);
const finalProduct = production.jobs.product;
assert.deepEqual(finalProduct.needs, ['input', 'package']);
assert.match(finalProduct.if, /always\(\).*needs\.input\.result == 'success'.*needs\.package\.result == 'success'.*inputs\.reuse_package_run != ''.*needs\.package\.result == 'skipped'/);
assert.deepEqual(finalProduct.permissions, { contents: 'read', actions: 'read' });
assert.equal(finalProduct.strategy['max-parallel'], 1, 'Real Agent final platforms run in one finite lane.');
assert.equal(finalProduct.strategy.matrix, '${{ fromJSON(needs.input.outputs.matrix) }}');
assert.equal(finalProduct.env, undefined);
const preserveBytes = finalProduct.steps.find(candidate => candidate.name === 'Preserve source bytes on Windows checkout');
assert.deepEqual(preserveBytes, { name: 'Preserve source bytes on Windows checkout',
  if: "runner.os == 'Windows'", shell: 'pwsh', run: 'git config --global core.autocrlf false' });
assert(finalProduct.steps.indexOf(preserveBytes) < finalProduct.steps.findIndex(candidate => candidate.uses === 'actions/checkout@v4'),
  'Installed native source hashes must see the same bytes as the asset producer.');
const finalSecretStep = finalProduct.steps.find(candidate => candidate.id === 'real_agents');
assert.equal(finalSecretStep.if, '${{ !inputs.agent_reload_only }}');
assert.deepEqual(finalSecretStep.env, { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY }}',
  DSC_AGENT_SCENARIOS: '${{ inputs.agent_scenarios }}' });
assert.equal(finalSecretStep['continue-on-error'], undefined);
assert.match(finalSecretStep.run, /> "\$RUNNER_TEMP\/agent-candidate\.log" 2>&1/u);
assert.match(finalSecretStep.run, /--scenarios "\$DSC_AGENT_SCENARIOS"/u);
assert(!finalSecretStep.run.includes('${{'));
assert.doesNotMatch(finalSecretStep.run, /\bcat\b|set -x|tee|\$DEEPSEEK_API_KEY/u);
const reloadSecretStep = finalProduct.steps.find(candidate => candidate.id === 'real_agent_reload');
assert.deepEqual(reloadSecretStep.env, { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY }}' });
assert.equal(reloadSecretStep['continue-on-error'], undefined);
const reloadCondition = new Function('inputs', 'steps', 'runner', 'always', 'cancelled', 'success',
  `return (${reloadSecretStep.if.slice(3, -2)});`);
function canRunReload({ reloadOnly = true, skipInstalled = true, os = 'Windows', successful = true,
  cancelled = false, outcomes = {} } = {}) {
  const defaults = { package_identity: 'success', installed_identity: 'success', agent_clis: 'success',
    windows_reload_identity: os === 'Windows' ? 'success' : 'skipped', installed: 'skipped',
    installed_runtime: 'skipped', real_agents: reloadOnly ? 'skipped' : 'success' };
  const steps = Object.fromEntries(Object.entries({ ...defaults, ...outcomes }).map(([id, outcome]) => [id, { outcome }]));
  return reloadCondition({ agent_reload_only: reloadOnly, skip_installed: skipInstalled }, steps, { os },
    () => true, () => cancelled, () => successful);
}
assert(canRunReload(), 'Reload-only must not require re-running the fixed Agent matrix or installed workload.');
assert(canRunReload({ os: 'macOS' }));
for (const id of ['package_identity', 'installed_identity', 'agent_clis', 'windows_reload_identity']) {
  for (const outcome of ['failure', 'skipped', 'cancelled']) {
    assert.equal(canRunReload({ outcomes: { [id]: outcome } }), false, `${id} ${outcome} must block Windows reload credentials.`);
  }
}
assert.equal(canRunReload({ successful: false }), false, 'Reload-only cannot bypass a failed preceding step.');
assert.equal(canRunReload({ cancelled: true }), false);
assert.equal(canRunReload({ skipInstalled: false }), false);
assert.equal(canRunReload({ reloadOnly: false }), false, 'Normal skip-installed selection must retain its prior no-reload behavior.');
assert(canRunReload({ reloadOnly: false, skipInstalled: false, successful: false,
  outcomes: { installed_runtime: 'success', real_agents: 'failure' } }),
  'Normal reload remains independent of a fixed Agent matrix failure after installed acceptance succeeds.');
assert.equal(canRunReload({ reloadOnly: false, skipInstalled: false,
  outcomes: { installed_runtime: 'failure' } }), false);
const windowsReloadIdentity = finalProduct.steps.find(candidate => candidate.id === 'windows_reload_identity');
assert.equal(windowsReloadIdentity.if, "${{ inputs.agent_reload_only && runner.os == 'Windows' }}");
assert.equal(windowsReloadIdentity.run, 'node scripts/test/test-agent-candidate-windows-observer.mjs');
assert.equal(windowsReloadIdentity.env, undefined);
assert.equal(windowsReloadIdentity['continue-on-error'], undefined);
assert(finalProduct.steps.indexOf(windowsReloadIdentity) < finalProduct.steps.indexOf(finalSecretStep));
assert(finalProduct.steps.indexOf(windowsReloadIdentity) < finalProduct.steps.indexOf(reloadSecretStep));
assert.equal(finalProduct.steps.find(candidate => candidate.id === 'agent_clis').run,
  'npm install --global --no-audit --no-fund @openai/codex@0.157.1 @anthropic-ai/claude-code@2.1.280');
assert.match(reloadSecretStep.run, /run-vscode-agent-runtime-reload-candidate\.mjs/u);
assert.match(reloadSecretStep.run, /--installed-vsix production-package\/product\.vsix/u);
assert.doesNotMatch(reloadSecretStep.run, /\bcat\b|set -x|tee|\$DEEPSEEK_API_KEY/u);
assert.deepEqual(finalProduct.steps.filter(candidate => JSON.stringify(candidate).includes('secrets.')),
  [finalSecretStep, reloadSecretStep]);
assert.equal(finalProduct.steps.filter(candidate => candidate.run).at(-1), reloadSecretStep);
const reloadUpload = finalProduct.steps.find(candidate => candidate.name === 'Upload live Agent Reload evidence');
assert.equal(reloadUpload.uses, 'actions/upload-artifact@v4');
assert.equal(reloadUpload.with['if-no-files-found'], 'error');
assert.match(reloadUpload.with.name, /runtime-production-agent-reload-/u);
assert.match(reloadUpload.with.path, /dsc-agent-reload/u);
const afterSecret = finalProduct.steps.slice(finalProduct.steps.indexOf(reloadSecretStep) + 1);
assert.equal(afterSecret.length, 2);
assert.equal(afterSecret[0], reloadUpload);
assert.equal(afterSecret[1].uses, 'actions/upload-artifact@v4');
assert.equal(afterSecret[1].with.path, 'agent-ci-report/');
assert.equal(afterSecret[1].if, "always() && steps.real_agents.outputs.report_ready == 'true'");
assert.match(finalProduct.steps.find(candidate => candidate.id === 'installed').run, /--installed-vsix production-package\/product\.vsix/u);
assert.equal(finalProduct.steps.find(candidate => candidate.id === 'installed').if,
  "${{ !inputs.skip_installed && inputs.installed_mode == 'all' }}");
assert.equal(finalProduct.steps.find(candidate => candidate.id === 'installed_runtime').if,
  "${{ !inputs.skip_installed && inputs.installed_mode == 'live-runtime' }}");
assert.match(finalProduct.steps.find(candidate => candidate.id === 'installed_runtime').run, /--mode=live-runtime/);
for (const stepId of ['installed', 'installed_runtime']) {
  const command = finalProduct.steps.find(candidate => candidate.id === stepId).run;
  const mode = /--mode=([^\s]+)/u.exec(command)?.[1];
  const vsix = /--installed-vsix\s+([^\s]+)/u.exec(command)?.[1];
  assert.equal(vsix, 'production-package/product.vsix');
  for (const platform of ['linux', 'darwin', 'win32']) {
    assertInstalledCandidateSelection({ 'installed-vsix': vsix, mode }, platform, 'x64');
  }
}
const download = finalProduct.steps.find(candidate => candidate.uses === 'actions/download-artifact@v4');
assert.deepEqual(download.with, { name: 'runtime-production-package-${{ needs.input.outputs.package_run }}',
  path: 'production-package', 'run-id': '${{ needs.input.outputs.package_run }}', 'github-token': '${{ github.token }}' });
const verifyPackage = finalProduct.steps.find(candidate => candidate.name === 'Verify package identity and use its exact application bytes');
assert.equal(verifyPackage.id, 'package_identity');
assert.match(verifyPackage.run, /assert\.equal\(receipt\.inputCommit, process\.env\.DSC_PACKAGE_COMMIT\)/);
assert.match(verifyPackage.run, /assert\.equal\(receipt\.sha256, createHash\('sha256'\)\.update\(bytes\)\.digest\('hex'\)\)/);
assert.match(verifyPackage.run, /reuse-receipt\.json/);
const installedDownload = finalProduct.steps.find(candidate => candidate.name === 'Download passed installed package identity');
assert.equal(installedDownload.if, "inputs.installed_evidence_run != ''");
assert.deepEqual(installedDownload.with, {
  name: 'runtime-production-input-${{ matrix.platform }}-${{ inputs.installed_evidence_run }}',
  path: 'installed-evidence', 'run-id': '${{ inputs.installed_evidence_run }}', 'github-token': '${{ github.token }}'
});
const installedIdentity = finalProduct.steps.find(candidate => candidate.name === 'Verify installed evidence uses this exact package');
assert.equal(installedIdentity.id, 'installed_identity');
assert.equal(installedIdentity.if, installedDownload.if);
assert(finalProduct.steps.indexOf(installedIdentity) < finalProduct.steps.indexOf(finalSecretStep));
const identityScript = installedIdentity.run.split("node --input-type=module <<'NODE'\n")[1].split('\nNODE')[0]
  .replace(/^import .*;\n/gm, '');
const evaluateInstalledIdentity = new Function('assert', 'fs', 'process', `return (async () => { ${identityScript} })();`);
const packageReceipt = { inputCommit: 'a'.repeat(40), sha256: 'd'.repeat(64), name: 'dev-session-canvas', version: '0.25.0' };
const samePackageEvidence = { ...packageReceipt, packageRun: '123', harnessCommit: 'c'.repeat(40) };
async function verifyInstalledIdentity(original = packageReceipt, evidence = samePackageEvidence) {
  const files = { 'production-package/receipt.json': packageReceipt,
    'installed-evidence/receipt.json': original, 'installed-evidence/reuse-receipt.json': evidence };
  await evaluateInstalledIdentity(assert, { async readFile(file) { return JSON.stringify(files[file]); } },
    { env: { DSC_PACKAGE_RUN: '123', DSC_INSTALLED_EVIDENCE_COMMIT: 'c'.repeat(40) } });
}
await verifyInstalledIdentity();
for (const mutation of [{ inputCommit: 'e'.repeat(40) }, { sha256: 'f'.repeat(64) },
  { packageRun: '124' }, { harnessCommit: 'e'.repeat(40) }]) {
  await assert.rejects(verifyInstalledIdentity(packageReceipt, { ...samePackageEvidence, ...mutation }));
}
await assert.rejects(verifyInstalledIdentity({ ...packageReceipt, sha256: 'f'.repeat(64) }));
await assert.rejects(verifyInstalledIdentity(null, null));
for (const job of [inputJob, production.jobs.package, finalProduct]) {
  assert.equal(job.steps.find(candidate => candidate.uses === 'actions/checkout@v4').with.ref, '${{ github.sha }}');
  for (const candidate of job.steps.filter(candidate => candidate.run)) {
    if (process.platform !== 'win32') {
      const syntax = spawnSync('bash', ['-n'], { input: candidate.run, encoding: 'utf8' });
      assert.equal(syntax.status, 0, `Invalid final acceptance shell in ${candidate.name}: ${syntax.stderr}`);
    }
  }
}
assert.match(production.jobs.package.steps.find(candidate => candidate.name === 'Build and package through normal defaults').run,
  /npm run build\n\s*npm run package:vsix/u);
assert.doesNotMatch(JSON.stringify(production), /--development-comparison|--execution-profile=stock|--execution-admission=/u);

console.log(`runtime real Agent CI workflow contract tests passed for Linux, macOS and Windows plus the fixed production package lane; native shell syntax: ${process.platform === 'win32' ? 'PowerShell' : 'Bash'}`);
