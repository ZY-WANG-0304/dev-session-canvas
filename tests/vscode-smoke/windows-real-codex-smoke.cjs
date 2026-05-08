const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testGetHostMessages: 'devSessionCanvas.__test.getHostMessages',
  testClearHostMessages: 'devSessionCanvas.__test.clearHostMessages',
  testGetDiagnosticEvents: 'devSessionCanvas.__test.getDiagnosticEvents',
  testClearDiagnosticEvents: 'devSessionCanvas.__test.clearDiagnosticEvents',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testResetState: 'devSessionCanvas.__test.resetState'
};

const artifactDir = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const defaultCodexCommand =
  process.env.DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_DEFAULT_COMMAND?.trim() || 'codex';
const explicitCodexCommand =
  process.env.DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_EXPLICIT_COMMAND?.trim() || '';
const terminalShellSettingsTarget = hasWorkspaceSettingsTarget()
  ? vscode.ConfigurationTarget.Workspace
  : vscode.ConfigurationTarget.Global;
const gitBashCandidates = [
  process.env.DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_GIT_BASH_PATH?.trim(),
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
].filter(Boolean);
const msys2BashCandidates = [
  process.env.DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_MSYS2_BASH_PATH?.trim(),
  'C:\\msys64\\usr\\bin\\bash.exe'
].filter(Boolean);
const msys2ShCandidates = [
  process.env.DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_MSYS2_SH_PATH?.trim(),
  'C:\\msys64\\usr\\bin\\sh.exe'
].filter(Boolean);

let lastSnapshot;
let lastHostMessages;
let lastDiagnosticEvents;
let lastWebviewProbe;
let scenarioResults = [];

module.exports = {
  run
};

async function run() {
  try {
    await runSmoke();
  } catch (error) {
    await writeFailureArtifacts(error);
    throw error;
  }
}

async function runSmoke() {
  await activateVisibleExtension(vscode, EXTENSION_ID);
  await waitForCommand(vscode, COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await waitForCommand(vscode, COMMAND_IDS.testResetState);

  const configuration = vscode.workspace.getConfiguration();
  const originalCodexCommand = configuration.inspect('devSessionCanvas.agent.codexCommand');
  const originalRuntimePersistence = configuration.inspect('devSessionCanvas.runtimePersistence.enabled');
  const originalTerminalShell = configuration.inspect('devSessionCanvas.terminal.shell');
  const originalTerminalShellPath = configuration.inspect('devSessionCanvas.terminal.shellPath');

  try {
    const scenarios = await buildScenarios();

    scenarioResults = [];
    for (const scenario of scenarios) {
      const result = await runScenario(scenario);
      scenarioResults.push(result);
    }

    await writeSuccessArtifacts();

    const failed = scenarioResults.filter((result) => result.nonEmptyVisibleLines.length === 0);
    assert.deepStrictEqual(
      failed,
      [],
      `Expected real Codex smoke to render visible terminal lines. Failed scenarios: ${JSON.stringify(failed, null, 2)}`
    );
  } finally {
    await restoreGlobalSetting('devSessionCanvas.agent.codexCommand', originalCodexCommand);
    await restoreGlobalSetting('devSessionCanvas.runtimePersistence.enabled', originalRuntimePersistence);
    await restoreScopedSetting('devSessionCanvas.terminal.shell', originalTerminalShell);
    await restoreScopedSetting('devSessionCanvas.terminal.shellPath', originalTerminalShellPath);
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  }
}

async function runScenario(scenario) {
  const configuration = vscode.workspace.getConfiguration();
  await configuration.update('devSessionCanvas.agent.codexCommand', scenario.command, vscode.ConfigurationTarget.Global);
  await configuration.update('devSessionCanvas.runtimePersistence.enabled', false, vscode.ConfigurationTarget.Global);
  await configuration.update('devSessionCanvas.terminal.shell', scenario.terminalShell, terminalShellSettingsTarget);
  await configuration.update('devSessionCanvas.terminal.shellPath', scenario.terminalShellPath, terminalShellSettingsTarget);

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
  await sleep(250);
  await clearHostMessages();
  await clearDiagnosticEvents();

  await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, 'agent', 'codex');

  const createdSnapshot = await waitForSnapshot(
    (snapshot) => snapshot.state.nodes.filter((node) => node.kind === 'agent').length === 1,
    15000
  );
  const agentNode = createdSnapshot.state.nodes.find((node) => node.kind === 'agent');
  assert.ok(agentNode, `Expected ${scenario.name} to create one agent node.`);

  const observed = await waitForAgentObservation(agentNode.id, 20000);
  const resolvedEvent = observed.diagnosticEvents.find(
    (event) => event.kind === 'agentCli/commandResolved' && event.detail?.provider === 'codex'
  );
  const result = {
    scenario: scenario.name,
    configuredCommand: scenario.command,
    configuredTerminalShell: scenario.terminalShell,
    configuredTerminalShellPath: scenario.terminalShellPath || null,
    agentNodeId: agentNode.id,
    status: observed.node?.status ?? null,
    summary: observed.node?.summary ?? null,
    resolvedCommand: resolvedEvent?.detail?.resolvedCommand ?? null,
    resolutionSource: resolvedEvent?.detail?.source ?? null,
    terminalShellSetting: observed.snapshot.configuration?.terminalShellSetting ?? null,
    terminalShellPath: observed.snapshot.configuration?.terminalShellPath ?? null,
    terminalShellPathOverride: observed.snapshot.configuration?.terminalShellPathOverride ?? null,
    terminalShellResolutionSource: observed.snapshot.configuration?.terminalShellResolutionSource ?? null,
    shellEnvSource: null,
    shellEnvShellFamily: null,
    shellEnvShellPath: null,
    shellEnvAppliedKeys: [],
    shellEnvSkippedReason: null,
    shellEnvError: null,
    hostExecutionOutputCount: observed.hostExecutionOutputCount,
    hostExecutionSnapshotCount: observed.hostExecutionSnapshotCount,
    hostErrorMessages: observed.hostErrorMessages,
    overlayTitle: observed.probeNode?.overlayTitle ?? null,
    overlayMessage: observed.probeNode?.overlayMessage ?? null,
    terminalVisibleLines: observed.terminalVisibleLines,
    nonEmptyVisibleLines: observed.nonEmptyVisibleLines
  };
  const shellEnvResolvedEvent = findLastDiagnosticEvent(
    observed.diagnosticEvents,
    (event) => event.kind === 'executionEnvironment/shellEnvPatchResolved'
  );
  const shellEnvFailedEvent = findLastDiagnosticEvent(
    observed.diagnosticEvents,
    (event) => event.kind === 'executionEnvironment/shellEnvPatchFailed'
  );
  const shellEnvSkippedEvent = findLastDiagnosticEvent(
    observed.diagnosticEvents,
    (event) => event.kind === 'executionEnvironment/shellEnvPatchSkipped'
  );

  result.shellEnvSource =
    shellEnvResolvedEvent?.detail?.source ??
    shellEnvFailedEvent?.detail?.source ??
    shellEnvSkippedEvent?.detail?.source ??
    observed.snapshot.configuration?.executionShellEnvPatchSource ??
    null;
  result.shellEnvShellFamily =
    shellEnvResolvedEvent?.detail?.shellFamily ??
    shellEnvFailedEvent?.detail?.shellFamily ??
    shellEnvSkippedEvent?.detail?.shellFamily ??
    observed.snapshot.configuration?.executionShellEnvPatchShellFamily ??
    null;
  result.shellEnvShellPath =
    shellEnvResolvedEvent?.detail?.shellPath ??
    shellEnvFailedEvent?.detail?.shellPath ??
    shellEnvSkippedEvent?.detail?.shellPath ??
    observed.snapshot.configuration?.executionShellEnvPatchShellPath ??
    null;
  result.shellEnvAppliedKeys = Array.isArray(shellEnvResolvedEvent?.detail?.appliedKeys)
    ? shellEnvResolvedEvent.detail.appliedKeys
    : Array.isArray(observed.snapshot.configuration?.executionShellEnvPatchAppliedKeys)
      ? observed.snapshot.configuration.executionShellEnvPatchAppliedKeys
      : [];
  result.shellEnvSkippedReason =
    shellEnvFailedEvent?.detail?.skippedReason ??
    shellEnvSkippedEvent?.detail?.skippedReason ??
    observed.snapshot.configuration?.executionShellEnvPatchSkipReason ??
    null;
  result.shellEnvError =
    shellEnvFailedEvent?.detail?.error ??
    observed.snapshot.configuration?.executionShellEnvPatchError ??
    null;

  if (artifactDir) {
    const scenarioArtifactDir = path.join(artifactDir, scenario.name);
    await fs.mkdir(scenarioArtifactDir, { recursive: true });
    await fs.writeFile(path.join(scenarioArtifactDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await fs.writeFile(
      path.join(scenarioArtifactDir, 'snapshot.json'),
      `${JSON.stringify(observed.snapshot, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      path.join(scenarioArtifactDir, 'host-messages.json'),
      `${JSON.stringify(observed.hostMessages, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      path.join(scenarioArtifactDir, 'diagnostic-events.json'),
      `${JSON.stringify(observed.diagnosticEvents, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      path.join(scenarioArtifactDir, 'webview-probe.json'),
      `${JSON.stringify(observed.probe, null, 2)}\n`,
      'utf8'
    );
  }

  assertScenarioResult(scenario, result);
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  return result;
}

async function waitForAgentObservation(nodeId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastObservation;

  while (Date.now() < deadline) {
    const snapshot = await getDebugSnapshot();
    const hostMessages = await getHostMessages();
    const diagnosticEvents = await getDiagnosticEvents();
    const probe = await captureWebviewProbe('panel', 2000);
    const node = snapshot.state.nodes.find((currentNode) => currentNode.id === nodeId);
    const probeNode = probe.nodes.find((currentNode) => currentNode.nodeId === nodeId);
    const terminalVisibleLines = Array.isArray(probeNode?.terminalVisibleLines) ? probeNode.terminalVisibleLines : [];
    const nonEmptyVisibleLines = terminalVisibleLines.filter((line) => typeof line === 'string' && line.trim().length > 0);
    const hostExecutionOutputCount = hostMessages.filter(
      (message) => message.type === 'host/executionOutput' && message.payload?.nodeId === nodeId
    ).length;
    const hostExecutionSnapshotCount = hostMessages.filter(
      (message) => message.type === 'host/executionSnapshot' && message.payload?.nodeId === nodeId
    ).length;
    const hostErrorMessages = hostMessages
      .filter((message) => message.type === 'host/error')
      .map((message) => message.payload?.message)
      .filter((message) => typeof message === 'string');

    lastObservation = {
      snapshot,
      hostMessages,
      diagnosticEvents,
      probe,
      node,
      probeNode,
      terminalVisibleLines,
      nonEmptyVisibleLines,
      hostExecutionOutputCount,
      hostExecutionSnapshotCount,
      hostErrorMessages
    };

    const terminalRendered = nonEmptyVisibleLines.length > 0;
    const terminalErrored =
      node?.status === 'error' || node?.status === 'resume-failed' || node?.status === 'stopped';
    if (terminalRendered || terminalErrored) {
      return lastObservation;
    }

    await sleep(250);
  }

  return lastObservation;
}

async function getDebugSnapshot() {
  lastSnapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
  return lastSnapshot;
}

async function getHostMessages() {
  lastHostMessages = await vscode.commands.executeCommand(COMMAND_IDS.testGetHostMessages);
  return lastHostMessages;
}

async function clearHostMessages() {
  return vscode.commands.executeCommand(COMMAND_IDS.testClearHostMessages);
}

async function getDiagnosticEvents() {
  lastDiagnosticEvents = await vscode.commands.executeCommand(COMMAND_IDS.testGetDiagnosticEvents);
  return lastDiagnosticEvents;
}

async function clearDiagnosticEvents() {
  return vscode.commands.executeCommand(COMMAND_IDS.testClearDiagnosticEvents);
}

async function captureWebviewProbe(surface, timeoutMs, delayMs = 0) {
  lastWebviewProbe = await vscode.commands.executeCommand(
    COMMAND_IDS.testCaptureWebviewProbe,
    surface,
    timeoutMs,
    delayMs
  );
  return lastWebviewProbe;
}

async function waitForSnapshot(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await getDebugSnapshot();
  while (Date.now() < deadline) {
    if (predicate(snapshot)) {
      return snapshot;
    }

    await sleep(100);
    snapshot = await getDebugSnapshot();
  }

  assert.fail(`Timed out while waiting for snapshot. Last snapshot: ${JSON.stringify(snapshot)}`);
}

async function writeSuccessArtifacts() {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, 'scenario-results.json'),
    `${JSON.stringify(scenarioResults, null, 2)}\n`,
    'utf8'
  );
}

async function writeFailureArtifacts(error) {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, 'failure-error.txt'), formatError(error), 'utf8');
  await fs.writeFile(
    path.join(artifactDir, 'failure-scenario-results.json'),
    `${JSON.stringify(scenarioResults, null, 2)}\n`,
    'utf8'
  );

  if (lastSnapshot !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-snapshot.json'),
      `${JSON.stringify(lastSnapshot, null, 2)}\n`,
      'utf8'
    );
  }

  if (lastHostMessages !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-host-messages.json'),
      `${JSON.stringify(lastHostMessages, null, 2)}\n`,
      'utf8'
    );
  }

  if (lastDiagnosticEvents !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-diagnostic-events.json'),
      `${JSON.stringify(lastDiagnosticEvents, null, 2)}\n`,
      'utf8'
    );
  }

  if (lastWebviewProbe !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-webview-probe.json'),
      `${JSON.stringify(lastWebviewProbe, null, 2)}\n`,
      'utf8'
    );
  }
}

function sleep(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}

async function buildScenarios() {
  const scenarios = [
    {
      name: 'default-codex-command',
      command: defaultCodexCommand,
      terminalShell: 'default',
      terminalShellPath: '',
      expectedShellSource: 'windows-shell',
      expectedTerminalShellSetting: null,
      expectedTerminalShellResolutionSource: 'default-shell'
    }
  ];

  if (explicitCodexCommand) {
    scenarios.push({
      name: 'explicit-codex-cmd',
      command: explicitCodexCommand,
      terminalShell: 'default',
      terminalShellPath: '',
      expectedShellSource: 'windows-shell',
      expectedTerminalShellSetting: null,
      expectedTerminalShellResolutionSource: 'default-shell'
    });
  }

  scenarios.push({
    name: 'powershell-shell',
    command: defaultCodexCommand,
    terminalShell: 'powershell',
    terminalShellPath: '',
    expectedShellSource: 'windows-shell',
    expectedShellFamily: 'powershell',
    expectedTerminalShellSetting: 'powershell',
    expectedTerminalShellPath: 'powershell.exe',
    expectedTerminalShellResolutionSource: 'named-shell'
  });

  scenarios.push({
    name: 'cmd-shell',
    command: defaultCodexCommand,
    terminalShell: 'cmd',
    terminalShellPath: '',
    expectedShellSource: 'windows-shell',
    expectedShellFamily: 'cmd',
    expectedTerminalShellSetting: 'cmd',
    expectedTerminalShellPath: 'cmd.exe',
    expectedTerminalShellResolutionSource: 'named-shell'
  });

  const gitBashPath = await resolveFirstExistingPath(gitBashCandidates);
  if (gitBashPath) {
    scenarios.push({
      name: 'git-bash-shell',
      command: defaultCodexCommand,
      terminalShell: 'bash',
      terminalShellPath: gitBashPath,
      expectedShellSource: 'windows-shell',
      expectedShellFamily: 'posix',
      expectedTerminalShellSetting: 'bash',
      expectedTerminalShellPath: gitBashPath,
      expectedTerminalShellResolutionSource: 'path'
    });
  }

  const msys2BashPath = await resolveFirstExistingPath(msys2BashCandidates);
  if (msys2BashPath) {
    scenarios.push({
      name: 'msys2-bash-shell',
      command: defaultCodexCommand,
      terminalShell: 'bash',
      terminalShellPath: msys2BashPath,
      expectedShellSource: 'windows-shell',
      expectedShellFamily: 'posix',
      expectedTerminalShellSetting: 'bash',
      expectedTerminalShellPath: msys2BashPath,
      expectedTerminalShellResolutionSource: 'path'
    });
  }

  const msys2ShPath = await resolveFirstExistingPath(msys2ShCandidates);
  if (msys2ShPath) {
    scenarios.push({
      name: 'msys2-sh-shell',
      command: defaultCodexCommand,
      terminalShell: 'sh',
      terminalShellPath: msys2ShPath,
      expectedShellSource: 'windows-shell',
      expectedShellFamily: 'posix',
      expectedTerminalShellSetting: 'sh',
      expectedTerminalShellPath: msys2ShPath,
      expectedTerminalShellResolutionSource: 'path'
    });
  }

  return scenarios;
}

function assertScenarioResult(scenario, result) {
  assert.ok(result.resolvedCommand, `Expected ${scenario.name} to resolve a Codex command.`);
  assert.ok(
    result.nonEmptyVisibleLines.length > 0,
    `Expected ${scenario.name} to render visible terminal output. Result: ${JSON.stringify(result, null, 2)}`
  );
  assert.strictEqual(
    result.shellEnvSource,
    scenario.expectedShellSource,
    `Expected ${scenario.name} to resolve shell env patch source ${scenario.expectedShellSource}. Result: ${JSON.stringify(result, null, 2)}`
  );
  assert.strictEqual(
    normalizeShellPath(result.shellEnvShellPath),
    normalizeShellPath(result.terminalShellPath),
    `Expected ${scenario.name} to bind shell env patch to the same terminal shell path. Result: ${JSON.stringify(result, null, 2)}`
  );
  assert.strictEqual(
    result.terminalShellSetting,
    scenario.expectedTerminalShellSetting,
    `Expected ${scenario.name} terminal shell setting to match the scenario. Result: ${JSON.stringify(result, null, 2)}`
  );
  assert.strictEqual(
    result.terminalShellResolutionSource,
    scenario.expectedTerminalShellResolutionSource,
    `Expected ${scenario.name} terminal shell resolution source to match the scenario. Result: ${JSON.stringify(result, null, 2)}`
  );
  assert.strictEqual(
    result.shellEnvSkippedReason,
    null,
    `Expected ${scenario.name} not to skip shell env patch resolution. Result: ${JSON.stringify(result, null, 2)}`
  );
  assert.strictEqual(
    result.shellEnvError,
    null,
    `Expected ${scenario.name} not to report shell env patch resolution errors. Result: ${JSON.stringify(result, null, 2)}`
  );

  if (scenario.expectedShellFamily) {
    assert.strictEqual(
      result.shellEnvShellFamily,
      scenario.expectedShellFamily,
      `Expected ${scenario.name} shell family to match. Result: ${JSON.stringify(result, null, 2)}`
    );
  }

  if (scenario.expectedTerminalShellPath) {
    assert.strictEqual(
      normalizeShellPath(result.terminalShellPath),
      normalizeShellPath(scenario.expectedTerminalShellPath),
      `Expected ${scenario.name} terminal shell path to match. Result: ${JSON.stringify(result, null, 2)}`
    );
  }
}

function findLastDiagnosticEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) {
      return events[index];
    }
  }

  return undefined;
}

async function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep walking the candidate list until we find a real shell path.
    }
  }

  return undefined;
}

function normalizeShellPath(shellPath) {
  return String(shellPath || '').trim().toLowerCase();
}

function hasWorkspaceSettingsTarget() {
  return Boolean(vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0);
}

function getWorkspaceScopedConfigurationValue(inspection) {
  return typeof inspection?.workspaceFolderValue !== 'undefined'
    ? inspection.workspaceFolderValue
    : inspection?.workspaceValue;
}

async function restoreGlobalSetting(settingKey, inspection) {
  const configuration = vscode.workspace.getConfiguration();
  await configuration.update(settingKey, inspection?.globalValue, vscode.ConfigurationTarget.Global);
}

async function restoreScopedSetting(settingKey, inspection) {
  const configuration = vscode.workspace.getConfiguration();
  await restoreGlobalSetting(settingKey, inspection);
  if (hasWorkspaceSettingsTarget()) {
    await configuration.update(settingKey, getWorkspaceScopedConfigurationValue(inspection), vscode.ConfigurationTarget.Workspace);
  }
}
