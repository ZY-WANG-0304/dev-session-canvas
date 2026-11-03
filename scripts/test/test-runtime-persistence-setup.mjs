import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/runtimePersistenceSetup.ts')],
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false
});
const target = { uid: 1001, user: 'alice', host: 'remote', environmentKey: 'a'.repeat(64) };
const blocked = { status: 'blocked', reason: 'linger-disabled', target };
let passed = 0;

function fixture(options = {}) {
  const calls = { terminals: [], warnings: [], copies: [], information: [], commands: [], reports: [], inspected: 0 };
  const workspace = { isTrusted: options.trusted ?? true };
  const vscode = {
    workspace,
    l10n: { t: (message, parameters = {}) => message.replace(/\{([^}]+)\}/g, (_, key) => parameters[key] ?? `{${key}}`) },
    env: { remoteName: options.remoteName, clipboard: { async writeText(text) { calls.copies.push(text); } } },
    commands: { async executeCommand(...args) { calls.commands.push(args); return options.executeCommand?.(...args); } },
    window: {
      async showQuickPick() { assert.fail('Background persistence must not open a searchable picker.'); },
      async showInputBox() { assert.fail('Background persistence has no free-text input.'); },
      async showWarningMessage(message, settings, confirm) {
        calls.warnings.push({ message, settings });
        if (options.revokeTrust) workspace.isTrusted = false;
        return options.confirm === false ? undefined : confirm;
      },
      async showInformationMessage(message, configuration, ...items) {
        assert(!configuration?.modal, 'Only execution confirmation may use a modal.');
        assert.equal(items.length, 0);
        calls.information.push({ message, configuration });
      },
      createOutputChannel(name) {
        calls.outputName = name;
        return { clear() { calls.reports.length = 0; }, appendLine(text) { calls.reports.push(text); },
          show() { calls.reportShown = true; }, dispose() { calls.outputDisposed = true; } };
      },
      createTerminal(configuration) {
        assert(workspace.isTrusted);
        calls.terminals.push(configuration);
        return { show() { calls.shown = true; } };
      }
    }
  };
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'process', outputFiles[0].text)(
    name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports, { ...process, platform: 'linux' });
  const controller = new loaded.exports.RuntimePersistenceSetup(() => {}, async () => {
    calls.inspected += 1;
    return options.observe ? options.observe(calls.inspected) : options.observation ?? blocked;
  }, () => options.configuration ?? { requested: false, applied: false });
  return { controller, calls, workspace, vscode };
}

const opened = fixture();
await opened.controller.show();
assert(opened.calls.commands.some(args => args[0] === 'workbench.action.openWalkthrough'
  && args[1] === 'devsessioncanvas.dev-session-canvas#runtimePersistence' && args[2] === false));
assert.equal(opened.calls.warnings.length, 0);
assert.equal(opened.calls.terminals.length, 0);
assert(opened.calls.commands.some(args => args[1] === 'devSessionCanvas.runtimePersistence.checkResult' && args[2] === 'needs-setup'),
  'Opening the guide automatically checks after the page loads.');
assert.equal(opened.calls.commands[0][0], 'workbench.action.openWalkthrough');
assert.equal(opened.calls.reportShown, undefined, 'An expected setup state should not open Output automatically.');
assert(opened.calls.commands.some(args => args[0] === 'setContext' && args[2] === 'needs-setup'));
passed += 1;

for (const options of [{ action: 'enable', confirm: false }, { action: 'sudo', confirm: false },
  { action: 'enable', trusted: false }, { action: 'enable', revokeTrust: true }]) {
  const harness = fixture(options);
  await harness.controller.perform(options.action);
  assert.equal(harness.calls.terminals.length, 0); passed += 1;
}
const copy = fixture();
await copy.controller.perform('copy');
assert.deepEqual(copy.calls.copies, ['/usr/bin/loginctl --no-ask-password enable-linger 1001']);
assert.equal(copy.calls.terminals.length, 0); passed += 1;
for (const action of ['enable', 'sudo']) {
  const harness = fixture();
  await harness.controller.perform(action);
  assert.equal(harness.calls.inspected, 2);
  assert.equal(harness.calls.terminals.length, 1);
  const terminal = harness.calls.terminals[0];
  assert.equal(terminal.shellPath, '/bin/sh');
  assert.deepEqual(terminal.shellArgs, ['-c', action === 'sudo'
    ? '/usr/bin/sudo /usr/bin/loginctl enable-linger 1001'
    : '/usr/bin/loginctl --no-ask-password enable-linger 1001']);
  assert(terminal.strictEnv);
  assert.equal(terminal.cwd, '/');
  assert.equal(terminal.env.BASH_ENV, undefined);
  assert(harness.calls.shown);
  assert.match(harness.calls.warnings[0].settings.detail, /remote.*alice.*1001/s);
  assert.match(harness.calls.warnings[0].settings.detail, /uninstalling/);
  assert.equal(harness.calls.warnings[0].message, 'Enable linger for this account?');
  assert.equal(harness.controller.state.status, 'blocked', 'Dispatch must not claim success');
  passed += 1;
}
for (const action of ['enable', 'sudo']) for (const next of [
  { ...blocked, target: { ...target, uid: 2 } },
  { ...blocked, target: { ...target, environmentKey: 'b'.repeat(64) } },
  { ...blocked, target: { ...target, host: 'different-host' } },
  { status: 'unknown', reason: 'observation-failed' },
  { ...blocked, status: 'unknown' },
  { status: 'eligible', target }
]) {
  const harness = fixture({ observe: count => count === 1 ? blocked : next });
  await harness.controller.perform(action);
  assert.equal(harness.calls.terminals.length, 0); passed += 1;
}
for (const action of ['enable', 'sudo', 'copy']) for (const observation of [{ status: 'eligible', target }, { status: 'unknown', reason: 'observation-failed', target },
  { status: 'unsupported', reason: 'unsupported-platform' }, { status: 'blocked', reason: 'environment-mismatch', target }]) {
  const harness = fixture({ observation });
  await harness.controller.perform(action);
  assert.equal(harness.calls.terminals.length, 0);
  assert.equal(harness.calls.copies.length, 0);
  assert.equal(harness.calls.warnings.length, 0);
  assert(!harness.calls.reports.join('').includes('enable-linger'));
  passed += 1;
}
const dedup = fixture();
await dedup.controller.checkAndNotify();
await dedup.controller.checkAndNotify();
assert.equal(dedup.calls.warnings.length, 1); passed += 1;
assert(!dedup.calls.commands.some(args => args[0] === 'workbench.action.openWalkthrough'
  || args[1] === 'devSessionCanvas.runtimePersistence.checkResult'), 'Background checks must not advance the guide.');
await assert.rejects(() => dedup.controller.requireEligible()); passed += 1;
const untrusted = fixture({ trusted: false });
await untrusted.controller.show();
assert.equal(untrusted.calls.inspected, 0); passed += 1;
const refreshed = fixture({ observe: count => count === 1 ? blocked : { status: 'eligible', target } });
await refreshed.controller.show();
await refreshed.controller.perform('check');
assert.equal(refreshed.controller.state.status, 'eligible');
assert.equal(refreshed.calls.terminals.length, 0); passed += 1;

const report = fixture();
await report.controller.perform('check');
assert.equal(report.calls.outputName, 'Background persistence');
assert(report.calls.reportShown);
assert.match(report.calls.reports[0], /Host: remote/);
assert.match(report.calls.reports[0], /Account: alice \(UID 1001\)/);
assert.match(report.calls.reports[0], /Linger is disabled/);
assert.match(report.calls.reports[0], /\/usr\/bin\/loginctl --no-ask-password enable-linger 1001/);
assert.match(report.calls.reports[0], /only after confirmation/);
assert.equal(report.calls.terminals.length, 0);
await report.controller.perform('check');
assert.equal(report.calls.reports.length, 1);
report.controller.dispose();
assert(report.calls.outputDisposed);
await report.controller.perform('enable');
assert.equal(report.calls.terminals.length, 0); passed += 1;

assert.match(refreshed.calls.reports[0], /Environment ready/);
assert(refreshed.calls.commands.some(args => args[0] === 'setContext' && args[2] === 'eligible')); passed += 1;

for (const [observation, step, result] of [
  [blocked, 'enable', 'needs-setup'],
  [{ status: 'eligible', target }, 'configuration', 'needs-configuration'],
  [{ status: 'unknown', reason: 'observation-failed' }, 'enable', 'unknown'],
  [{ status: 'unsupported', reason: 'unsupported-platform' }, 'enable', 'unsupported'],
  [{ status: 'blocked', reason: 'manager-unavailable', target }, 'enable', 'blocked'],
  [{ status: 'blocked', reason: 'linger-disabled' }, 'enable', 'blocked'],
  [{ ...blocked, status: 'unknown' }, 'enable', 'unknown']
]) {
  const harness = fixture({ observation });
  await harness.controller.perform('check');
  assert.deepEqual(harness.calls.commands.filter(args => args[0] === 'workbench.action.openWalkthrough'), [[
    'workbench.action.openWalkthrough', {
      category: 'devsessioncanvas.dev-session-canvas#runtimePersistence',
      step
    }, false
  ]], `A completed check must select ${step}.`);
  assert.equal(harness.calls.terminals.length, 0, 'Moving to another guide step must not execute it.');
  assert.equal(harness.calls.warnings.length, 0);
  assert(harness.calls.reportShown);
  assert(harness.calls.commands.some(args => args[0] === 'setContext'
    && args[1] === 'devSessionCanvas.runtimePersistence.checkResult'
    && args[2] === result));
  passed += 1;
}

for (const requested of [false, true]) for (const applied of [false, true]) {
  for (const action of ['check', 'reload']) {
    const configuration = { requested, applied };
    const harness = fixture({ observation: { status: 'eligible', target }, configuration });
    const result = await harness.controller.perform(action);
    const step = !requested ? 'configuration' : !applied ? 'apply' : 'verifyApplied';
    const checkResult = !requested ? 'needs-configuration' : !applied ? 'needs-reload' : 'ready';
    assert.equal(harness.calls.commands.at(-1)[1].step, step);
    assert(harness.calls.commands.some(args => args[1] === 'devSessionCanvas.runtimePersistence.checkResult'
      && args[2] === checkResult));
    assert.equal(result, action === 'reload' && requested && !applied ? 'reload-required' : undefined);
    assert.equal(harness.calls.reports[0].includes('Setup verified for this window.'), requested && applied);
    assert(harness.calls.reports[0].includes(`Runtime Persistence setting: ${requested ? 'enabled' : 'disabled'}.`));
    assert(harness.calls.reports[0].includes(`Current window: Runtime Persistence is ${applied ? '' : 'not '}applied.`));
    assert.deepEqual(configuration, { requested, applied }, 'Checking or requesting reload must not change configuration.');
    assert.equal(harness.calls.terminals.length, 0);
    assert.equal(harness.calls.warnings.length, 0);
    passed += 1;
  }
}
for (const observation of [blocked, { status: 'unknown', reason: 'observation-failed' }]) {
  const harness = fixture({ observation, configuration: { requested: true, applied: true } });
  assert.equal(await harness.controller.perform('reload'), undefined);
  assert(!harness.calls.commands.some(args => args[1] === 'devSessionCanvas.runtimePersistence.checkResult' && args[2] === 'ready'));
  passed += 1;
}
const settings = fixture();
await settings.controller.perform('settings');
assert.deepEqual(settings.calls.commands, [['workbench.action.openSettings', '@id:devSessionCanvas.runtimePersistence.enabled']]);
assert.equal(settings.calls.inspected, 0);
assert.equal(settings.calls.terminals.length, 0);
for (const action of ['settings', 'reload']) {
  const harness = fixture({ trusted: false });
  assert.equal(await harness.controller.perform(action), undefined);
  assert.equal(harness.calls.commands.length, 0);
  passed += 1;
}
passed += 1;

const changingConfiguration = { requested: true, applied: false };
const settingRace = fixture({ observation: { status: 'eligible', target }, configuration: changingConfiguration,
  executeCommand: (command, key) => {
    if (key === 'devSessionCanvas.runtimePersistence.checkResult') changingConfiguration.requested = false;
  } });
assert.equal(await settingRace.controller.perform('reload'), undefined);
assert(!settingRace.calls.commands.some(args => args[0] === 'workbench.action.openWalkthrough'));
passed += 1;

const concurrent = fixture();
await Promise.all([concurrent.controller.perform('enable'), concurrent.controller.perform('sudo')]);
assert.equal(concurrent.calls.terminals.length, 1); passed += 1;

for (const interruption of ['none', 'dispose', 'revoke-trust', 'new-state']) {
  let releaseContext;
  const contextUpdate = new Promise(resolve => { releaseContext = resolve; });
  const harness = fixture({ executeCommand: command => command === 'setContext' ? contextUpdate : undefined });
  const checking = harness.controller.perform('check');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.commands.filter(args => args[0] === 'workbench.action.openWalkthrough').length, 0,
    'Step visibility must be updated before selecting a step.');
  if (interruption === 'dispose') harness.controller.dispose();
  if (interruption === 'revoke-trust') harness.workspace.isTrusted = false;
  if (interruption === 'new-state') harness.controller.markUnitUnverified(blocked);
  releaseContext();
  await checking;
  assert.equal(harness.calls.commands.filter(args => args[0] === 'workbench.action.openWalkthrough').length,
    interruption === 'none' ? 1 : 0, 'A stale or cancelled check must not move the guide.');
  assert.equal(harness.calls.terminals.length, 0);
  passed += 1;
}

const lostTrust = fixture({ observe: () => { lostTrust.workspace.isTrusted = false; return blocked; } });
await lostTrust.controller.perform('enable');
assert.equal(lostTrust.calls.terminals.length, 0);
assert.equal(lostTrust.calls.warnings.length, 0); passed += 1;

const container = fixture({ remoteName: 'dev-container' });
await container.controller.perform('enable');
assert.equal(container.calls.inspected, 0);
assert.equal(container.calls.terminals.length, 0); passed += 1;

const manager = readFileSync('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8');
const disableOpened = fixture();
await disableOpened.controller.perform('disable-guide');
assert.deepEqual(disableOpened.calls.commands[0], ['workbench.action.openWalkthrough',
  'devsessioncanvas.dev-session-canvas#runtimePersistenceDisable', false]);
assert.equal(disableOpened.calls.commands.at(-1)[1].step, 'verifyDisabled');
assert.equal(disableOpened.calls.reportShown, undefined);
assert.equal(disableOpened.calls.inspected, 0);
passed += 1;

for (const direction of ['enable', 'disable']) for (const requested of [false, true]) for (const applied of [false, true]) {
  const harness = fixture({ observation: { status: 'eligible', target }, configuration: { requested, applied } });
  assert.equal(await harness.controller.show(direction), undefined, 'Opening never requests reload.');
  assert.equal(harness.calls.inspected, direction === 'enable' ? 1 : 0);
  assert.equal(harness.calls.commands.at(-1)[1].step, direction === 'enable'
    ? !requested ? 'configuration' : !applied ? 'apply' : 'verifyApplied'
    : requested ? 'disableConfiguration' : applied ? 'disableApply' : 'verifyDisabled');
  assert.equal(harness.calls.reportShown, undefined);
  assert.equal(harness.calls.terminals.length, 0);
  assert.equal(harness.calls.warnings.length, 0);
  passed += 1;
}
for (const observation of [{ status: 'unknown', reason: 'observation-failed' }, { status: 'blocked', reason: 'manager-unavailable' }]) {
  const harness = fixture({ observation });
  await harness.controller.show();
  assert.equal(harness.calls.commands.at(-1)[1].step, 'enable');
  assert.equal(harness.calls.reportShown, true, 'Automatic check failures must expose diagnostics.');
  assert(!harness.calls.commands.some(args => args[2] === 'ready' || args[2] === 'needs-configuration'));
  assert.equal(harness.calls.terminals.length, 0);
  passed += 1;
}
for (const direction of ['enable', 'disable']) for (const interruption of ['none', 'dispose', 'trust']) {
  let releasePage;
  const pageReady = new Promise(resolve => { releasePage = resolve; });
  const harness = fixture({ executeCommand: (command, argument) =>
    command === 'workbench.action.openWalkthrough' && typeof argument === 'string' ? pageReady : undefined });
  const opening = harness.controller.show(direction);
  await harness.controller.show(direction);
  await harness.controller.perform('enable');
  await harness.controller.perform('disable-guide');
  assert.equal(harness.calls.commands.length, 1, 'Opening and command actions share a single in-flight guard.');
  assert.equal(harness.calls.inspected, 0, 'Automatic completion must wait for the guide to load.');
  if (interruption === 'dispose') harness.controller.dispose();
  if (interruption === 'trust') harness.workspace.isTrusted = false;
  releasePage();
  await opening;
  assert.equal(harness.calls.reports.length, interruption === 'none' ? 1 : 0);
  assert.equal(harness.calls.terminals.length, 0);
  passed += 1;
}

for (const requested of [false, true]) for (const applied of [false, true]) {
  for (const action of ['check-disable', 'reload-disable']) for (const remoteName of [undefined, 'dev-container']) {
    const configuration = { requested, applied };
    const harness = fixture({ configuration, remoteName, observe: () => assert.fail('Closing must not inspect or require system eligibility.') });
    const result = await harness.controller.perform(action);
    assert.equal(result, action === 'reload-disable' && !requested && applied ? 'disable-reload-required' : undefined);
    assert.deepEqual(harness.calls.commands.at(-1), ['workbench.action.openWalkthrough', {
      category: 'devsessioncanvas.dev-session-canvas#runtimePersistenceDisable',
      step: requested ? 'disableConfiguration' : applied ? 'disableApply' : 'verifyDisabled'
    }, false]);
    assert(harness.calls.commands.some(args => args[1] === 'devSessionCanvas.runtimePersistence.disableCheckResult'
      && args[2] === (requested ? 'needs-configuration' : applied ? 'needs-reload' : 'disabled')));
    assert.equal(harness.calls.reports[0].includes('Runtime Persistence is off in this window.'), !requested && !applied);
    assert.match(harness.calls.reports[0], /Cancelling reload does not undo/);
    assert.match(harness.calls.reports[0], /last enabled window explicitly turning off/);
    assert(!harness.calls.commands.some(args => args[1] === 'devSessionCanvas.runtimePersistence.checkResult'));
    assert.equal(harness.calls.inspected, 0);
    assert.equal(harness.calls.terminals.length, 0);
    assert.deepEqual(configuration, { requested, applied });
    passed += 1;
  }
}
for (const interruption of ['configuration', 'trust', 'dispose']) {
  const configuration = { requested: false, applied: true };
  const harness = fixture({ configuration, executeCommand: (command, key) => {
    if (key !== 'devSessionCanvas.runtimePersistence.disableCheckResult') return;
    if (interruption === 'configuration') configuration.requested = true;
    if (interruption === 'trust') harness.workspace.isTrusted = false;
    if (interruption === 'dispose') harness.controller.dispose();
  } });
  assert.equal(await harness.controller.perform('reload-disable'), undefined);
  assert(!harness.calls.commands.some(args => args[0] === 'workbench.action.openWalkthrough'));
  passed += 1;
}
for (const action of ['disable-guide', 'check-disable', 'reload-disable', 'review-linger-rollback']) {
  const harness = fixture({ trusted: false });
  await harness.controller.perform(action);
  assert.equal(harness.calls.commands.length, 0);
  assert.equal(harness.calls.inspected, 0);
  passed += 1;
}
for (const configuration of [{ requested: true, applied: true }, { requested: false, applied: true }, { requested: true, applied: false }]) {
  const harness = fixture({ configuration });
  await harness.controller.perform('review-linger-rollback');
  assert.equal(harness.calls.inspected, 0, 'Manual system rollback requires this window to be off first.');
  assert(!harness.calls.reports.join('').includes('disable-linger'));
  passed += 1;
}
for (const observation of [{ status: 'eligible', target }, blocked,
  { status: 'unknown', reason: 'observation-failed', target }, { status: 'blocked', reason: 'environment-mismatch', target },
  { status: 'unsupported', reason: 'unsupported-platform' }]) {
  const harness = fixture({ observation });
  await harness.controller.perform('review-linger-rollback');
  const report = harness.calls.reports[0];
  assert.match(report, /cannot verify that other windows/);
  assert.equal(report.includes('disable-linger'), observation.status === 'eligible');
  if (observation.status === 'eligible') {
    assert.match(report, /Host: remote/);
    assert.match(report, /Account: alice \(UID 1001\)/);
    assert.match(report, /\/usr\/bin\/loginctl --no-ask-password disable-linger 1001/);
    assert.match(report, /\/usr\/bin\/sudo \/usr\/bin\/loginctl disable-linger 1001/);
  }
  if (observation === blocked) assert.match(report, /already disabled/);
  assert.equal(harness.calls.terminals.length, 0);
  assert.equal(harness.calls.copies.length, 0);
  assert.equal(harness.calls.warnings.length, 0);
  passed += 1;
}
const rollbackConfiguration = { requested: false, applied: false };
const rollbackRace = fixture({ configuration: rollbackConfiguration, observe: () => {
  rollbackConfiguration.requested = true;
  return { status: 'eligible', target };
} });
await rollbackRace.controller.perform('review-linger-rollback');
assert.equal(rollbackRace.calls.reports.length, 0);
passed += 1;

const ast = ts.createSourceFile('CanvasPanelManager.ts', manager, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'CanvasPanelManager');
const methods = ['openRuntimePersistenceGuide', 'configureRuntimePersistence', 'notifyReloadRequiredConfigurationChanged'].map(name =>
  declaration.members.find(member => member.name?.getText(ast) === name).getText(ast)).join('\n');
const harnessSource = ts.transpile(`class ManagerHarness { ${methods} }`, { target: ts.ScriptTarget.ES2022 });
assert.match(readFileSync('extensions/vscode/dev-session-canvas/src/extension.ts', 'utf8'),
  /registerCommand\(context, COMMAND_IDS\.openRuntimePersistenceGuide, \(\) => panelManager\.openRuntimePersistenceGuide\(\)\)/);
for (const requested of [false, true]) for (const applied of [false, true]) for (const observation of [
  blocked, { status: 'eligible', target }, { status: 'unknown', reason: 'observation-failed' },
  { status: 'unsupported', reason: 'unsupported-platform' }
]) {
  const configuration = { requested, applied };
  const harness = fixture({ configuration, observation });
  const ManagerHarness = new Function('vscode', harnessSource + '\nreturn ManagerHarness;')(harness.vscode);
  const instance = new ManagerHarness();
  Object.assign(instance, {
    runtimePersistenceSetup: harness.controller,
    isRuntimePersistenceEnabled: () => configuration.applied,
    readStartupConfiguration: () => ({ runtimePersistenceEnabled: configuration.requested }),
    notifyReloadRequiredConfigurationChanged: () => assert.fail('Opening a sidebar guide must not request reload or cleanup.')
  });
  const click = instance.openRuntimePersistenceGuide.bind(instance);
  const assertDirection = async expectedDirection => {
    const inspected = harness.calls.inspected;
    await click();
    assert.equal(harness.calls.commands.at(-1)[1].category,
      'devsessioncanvas.dev-session-canvas#' + (expectedDirection === 'disable' ? 'runtimePersistenceDisable' : 'runtimePersistence'));
    if (expectedDirection === 'disable') assert.equal(harness.calls.inspected, inspected, 'Turning off must not depend on system eligibility.');
    assert.equal(harness.calls.terminals.length, 0);
    assert.equal(harness.calls.warnings.length, 0);
    assert(!harness.calls.commands.some(args => args[0] === 'workbench.action.reloadWindow'));
  };
  await assertDirection(applied ? 'disable' : 'enable');
  configuration.applied = !applied;
  await assertDirection(applied ? 'enable' : 'disable');
  assert.equal(configuration.requested, requested, 'A reused click handler must read the latest actual mode without changing intent.');
  configuration.applied = true;
  await instance.configureRuntimePersistence();
  assert.equal(harness.calls.commands.at(-1)[1].category, 'devsessioncanvas.dev-session-canvas#runtimePersistence',
    'Explicit configure/repair must remain an enable guide even while applied.');
  harness.workspace.isTrusted = false;
  const commands = harness.calls.commands.length;
  await click();
  assert.equal(harness.calls.commands.length, commands, 'Restricted Mode must retain the existing guide guard.');
  passed += 1;
}
for (const scenario of ['cancel', 'confirm', 'cleanup-fails', 'check-only', 'already-applied', 'disabled', 'untrusted', 'superseded', 'capability-lost']) {
  const calls = [];
  const harnessVscode = {
    workspace: { isTrusted: scenario !== 'untrusted' },
    l10n: { t: (message, parameters = {}) => message.replace(/\{([^}]+)\}/g, (_, key) => parameters[key] ?? `{${key}}`) },
    window: {
      async showWarningMessage(message, confirm) {
        calls.push(['warning', message]);
        return scenario === 'cancel' ? undefined : confirm;
      },
      async showErrorMessage(message) { calls.push(['error', message]); }
    },
    commands: { async executeCommand(command) { calls.push([command]); } }
  };
  const ManagerHarness = new Function('vscode', 'isTestHarnessMode', 'formatLocalizedList', 'formatUnknownError',
    harnessSource + '\nreturn ManagerHarness;')(harnessVscode, () => false, labels => labels.join(', '), error => error.message);
  const instance = new ManagerHarness();
  Object.assign(instance, {
    context: { extensionMode: 1 },
    runtimePersistenceSetup: { state: { status: 'eligible' }, async perform() {
      return scenario === 'superseded' || scenario === 'check-only' ? undefined : 'reload-required';
    } },
    isRuntimePersistenceEnabled: () => scenario === 'already-applied',
    readStartupConfiguration: () => ({ runtimePersistenceEnabled: scenario !== 'disabled' }),
    requiresLoginIndependentPersistence: () => true,
    async requireRuntimePersistenceCapability() {
      calls.push(['capability']);
      if (scenario === 'capability-lost') throw new Error('Prerequisite lost');
    },
    async cleanupRuntimePersistenceModeSwitch() {
      calls.push(['cleanup']);
      if (scenario === 'cleanup-fails') throw new Error('Cleanup failed');
    }
  });
  await instance.configureRuntimePersistence(scenario === 'check-only' ? 'check' : 'reload');
  if (['cancel', 'confirm', 'cleanup-fails'].includes(scenario)) {
    assert.match(calls.find(call => call[0] === 'warning')[1], /Current Canvas sessions and content will not be retained/);
    assert.equal(calls.some(call => call[0] === 'cleanup'), scenario !== 'cancel');
  } else assert(!calls.some(call => call[0] === 'warning' || call[0] === 'cleanup'));
  assert.equal(calls.some(call => call[0] === 'workbench.action.reloadWindow'), scenario === 'confirm');
  if (scenario === 'confirm') assert.deepEqual(calls.map(call => call[0]), ['capability', 'warning', 'cleanup', 'workbench.action.reloadWindow']);
  if (scenario === 'cleanup-fails') assert(calls.some(call => call[0] === 'error'));
  passed += 1;
}
for (const scenario of ['confirm', 'cancel', 'cleanup-fails', 'request-changed', 'trust-lost', 'cleanup-changed', 'already-off', 're-enabled', 'superseded']) {
  const calls = [];
  let requested = scenario === 're-enabled';
  const harnessVscode = {
    workspace: { isTrusted: true },
    l10n: { t: (message, parameters = {}) => message.replace(/\{([^}]+)\}/g, (_, key) => parameters[key] ?? `{${key}}`) },
    window: {
      async showWarningMessage(message, confirm) {
        calls.push(['warning', message]);
        if (scenario === 'request-changed') requested = true;
        if (scenario === 'trust-lost') harnessVscode.workspace.isTrusted = false;
        return scenario === 'cancel' ? undefined : confirm;
      },
      async showErrorMessage(message) { calls.push(['error', message]); }
    },
    commands: { async executeCommand(command) { calls.push([command]); } }
  };
  const ManagerHarness = new Function('vscode', 'isTestHarnessMode', 'formatLocalizedList', 'formatUnknownError',
    harnessSource + '\nreturn ManagerHarness;')(harnessVscode, () => false, labels => labels.join(', '), error => error.message);
  const instance = new ManagerHarness();
  Object.assign(instance, {
    context: { extensionMode: 1 },
    runtimePersistenceSetup: { state: { status: 'unknown' }, async perform() {
      return scenario === 'superseded' ? undefined : 'disable-reload-required';
    } },
    isRuntimePersistenceEnabled: () => scenario !== 'already-off',
    readStartupConfiguration: () => ({ runtimePersistenceEnabled: requested }),
    requiresLoginIndependentPersistence: () => true,
    async requireRuntimePersistenceCapability() { assert.fail('Closing must not require system eligibility.'); },
    async cleanupRuntimePersistenceModeSwitch() {
      calls.push(['cleanup']);
      if (scenario === 'cleanup-fails') throw new Error('Cleanup failed');
      if (scenario === 'cleanup-changed') requested = true;
    }
  });
  await instance.configureRuntimePersistence('reload-disable');
  if (['already-off', 're-enabled', 'superseded'].includes(scenario)) assert.equal(calls.length, 0);
  else {
    assert.match(calls[0][1], /only when the last enabled window explicitly disables persistence/);
    assert.match(calls[0][1], /Cancelling reload does not undo/);
  }
  assert.equal(calls.some(call => call[0] === 'cleanup'), ['confirm', 'cleanup-fails', 'cleanup-changed'].includes(scenario));
  assert.equal(calls.some(call => call[0] === 'workbench.action.reloadWindow'), scenario === 'confirm');
  if (scenario === 'cancel') assert.equal(requested, false, 'Cancelling reload must not silently revert the saved setting.');
  if (scenario === 'cleanup-fails') assert(calls.some(call => call[0] === 'error'));
  passed += 1;
}
for (const name of ['startAgentSessionWithSupervisorCore', 'startTerminalSessionWithSupervisorCore']) {
  const body = manager.slice(manager.indexOf(`private async ${name}(`));
  assert(body.indexOf('requireRuntimePersistenceCapability()') < body.indexOf('prepareExecutionCandidateReplacement('));
  assert(body.indexOf('requireRuntimePersistenceUnit(') < body.indexOf('prepareExecutionCandidateReplacement('));
  passed += 1;
}
console.log(`Runtime persistence setup: ${passed} checks passed; no real terminal or settings changes.`);
