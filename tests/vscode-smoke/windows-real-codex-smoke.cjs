const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');

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
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Missing extension ${EXTENSION_ID}.`);
  await extension.activate();

  const scenarios = [
    {
      name: 'default-codex-command',
      command: defaultCodexCommand
    }
  ];
  if (explicitCodexCommand) {
    scenarios.push({
      name: 'explicit-codex-cmd',
      command: explicitCodexCommand
    });
  }

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
}

async function runScenario(scenario) {
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.agent.codexCommand', scenario.command, vscode.ConfigurationTarget.Global);
  await vscode.workspace
    .getConfiguration()
    .update('devSessionCanvas.runtimePersistence.enabled', false, vscode.ConfigurationTarget.Global);

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);
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
    agentNodeId: agentNode.id,
    status: observed.node?.status ?? null,
    summary: observed.node?.summary ?? null,
    resolvedCommand: resolvedEvent?.detail?.resolvedCommand ?? null,
    resolutionSource: resolvedEvent?.detail?.source ?? null,
    hostExecutionOutputCount: observed.hostExecutionOutputCount,
    hostExecutionSnapshotCount: observed.hostExecutionSnapshotCount,
    hostErrorMessages: observed.hostErrorMessages,
    overlayTitle: observed.probeNode?.overlayTitle ?? null,
    overlayMessage: observed.probeNode?.overlayMessage ?? null,
    terminalVisibleLines: observed.terminalVisibleLines,
    nonEmptyVisibleLines: observed.nonEmptyVisibleLines
  };

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
