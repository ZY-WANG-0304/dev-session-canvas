const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const VIEW_IDS = {
  activityBarContainer: 'devSessionCanvas',
  sidebarTree: 'devSessionCanvas.sidebar'
};
const COMMAND_IDS = {
  openCanvas: 'devSessionCanvas.openCanvas',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testPerformWebviewDomAction: 'devSessionCanvas.__test.performWebviewDomAction',
  testDispatchWebviewMessage: 'devSessionCanvas.__test.dispatchWebviewMessage',
  testStartExecutionSession: 'devSessionCanvas.__test.startExecutionSession',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testResetState: 'devSessionCanvas.__test.resetState'
};

const specFilePath = process.env.DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_SPEC_FILE;
const readyFilePath = process.env.DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_READY_FILE;
const ackFilePath = process.env.DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_ACK_FILE;
const doneFilePath = process.env.DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_DONE_FILE;
const stateFilePath = process.env.DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_STATE_FILE;
const artifactDir = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;

module.exports = {
  run
};

async function run() {
  let stateMirror;
  try {
    const spec = await readRequiredJson(specFilePath, 'Marketplace media spec');
    const surface = spec.surface ?? 'panel';
    const mode = spec.mode === 'recording' ? 'recording' : 'frame';

    await activateExtension();
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
    await configureWorkbench(spec);

    await vscode.commands.executeCommand(COMMAND_IDS.openCanvas);
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, surface, 20000);
    await closeAuxiliaryBar();
    await clearNotifications();

    if (spec.persistedState) {
      await vscode.commands.executeCommand(COMMAND_IDS.testSetPersistedState, spec.persistedState);
    }

    await revealExtensionSidebar();
    await closeAuxiliaryBar();
    await clearNotifications();
    await delay(spec.settleDelayMs ?? 400);
    stateMirror = mode === 'recording' ? await startRecordingStateMirror(surface) : undefined;

    if (mode === 'recording') {
      await writeReadyFile({
        mode,
        frameName: spec.frameName ?? null,
        surface,
        selectedNodeId: spec.selectedNodeId ?? null,
        nodeCount: (await getDebugSnapshot())?.state?.nodes?.length ?? null
      });
      await waitForAck(ackFilePath, spec.captureTimeoutMs ?? 60000);
      await waitForCompletion(doneFilePath, spec.captureTimeoutMs ?? 60000);
    } else {
      for (const session of spec.sessions ?? []) {
        await runExecutionSession(session, surface);
      }

      for (const action of spec.domActions ?? []) {
        await performDomAction(action, surface, 5000);
      }
    }

    await revealExtensionSidebar();
    await closeAuxiliaryBar();
    await clearNotifications();

    if (mode !== 'recording' && spec.selectedNodeId) {
      await performDomAction(
        {
          kind: 'selectNode',
          nodeId: spec.selectedNodeId
        },
        surface,
        5000
      );
    }

    await delay(spec.postSetupDelayMs ?? 600);
    await clearNotifications();

    const probe = await vscode.commands.executeCommand(
      COMMAND_IDS.testCaptureWebviewProbe,
      surface,
      5000,
      0
    );

    if (typeof spec.expectedNodeCount === 'number') {
      assert.strictEqual(probe?.nodeCount, spec.expectedNodeCount, 'Marketplace media probe node count mismatch.');
    }

    if (artifactDir) {
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(
        path.join(artifactDir, 'marketplace-webview-probe.json'),
        `${JSON.stringify(probe, null, 2)}\n`,
        'utf8'
      );
    }

    if (mode !== 'recording') {
      await writeReadyFile({
        mode,
        frameName: spec.frameName ?? null,
        surface,
        selectedNodeId: spec.selectedNodeId ?? null,
        nodeCount: probe?.nodeCount ?? null
      });
      await waitForAck(ackFilePath, spec.captureTimeoutMs ?? 60000);
    }

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  } catch (error) {
    await writeFailureArtifacts(error);
    throw error;
  } finally {
    await stateMirror?.stop();
  }
}

async function activateExtension() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Missing extension ${EXTENSION_ID}.`);
  await extension.activate();
}

async function configureWorkbench(spec) {
  const codexCommand = requireEnv('DEV_SESSION_CANVAS_TEST_CODEX_COMMAND');
  const claudeCommand = requireEnv('DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND');
  const terminalCommand = requireEnv('DEV_SESSION_CANVAS_TEST_TERMINAL_COMMAND');
  const configuration = vscode.workspace.getConfiguration();

  if (spec?.theme) {
    await vscode.workspace
      .getConfiguration('workbench')
      .update('colorTheme', spec.theme, vscode.ConfigurationTarget.Global);
  }

  await vscode.workspace
    .getConfiguration('workbench')
    .update('panel.defaultLocation', 'bottom', vscode.ConfigurationTarget.Global);
  await vscode.workspace
    .getConfiguration('workbench')
    .update('panel.opensMaximized', 'always', vscode.ConfigurationTarget.Global);
  if (spec?.editorMinimapEnabled === false) {
    await vscode.workspace
      .getConfiguration('editor')
      .update('minimap.enabled', false, vscode.ConfigurationTarget.Global);
  }

  await configuration.update('devSessionCanvas.runtimePersistence.enabled', false, vscode.ConfigurationTarget.Global);
  await configuration.update('devSessionCanvas.agent.defaultProvider', 'codex', vscode.ConfigurationTarget.Global);
  await configuration.update('devSessionCanvas.agent.codexCommand', codexCommand, vscode.ConfigurationTarget.Global);
  await configuration.update('devSessionCanvas.agent.claudeCommand', claudeCommand, vscode.ConfigurationTarget.Global);
  await configuration.update('devSessionCanvas.terminal.shellPath', terminalCommand, vscode.ConfigurationTarget.Global);
}

async function runExecutionSession(session, surface) {
  const kind = session.kind;
  assert.ok(kind === 'agent' || kind === 'terminal', `Unsupported execution session kind: ${kind}`);

  await vscode.commands.executeCommand(
    COMMAND_IDS.testStartExecutionSession,
    kind,
    session.nodeId,
    session.cols ?? 56,
    session.rows ?? 12,
    kind === 'agent' ? session.provider ?? 'codex' : undefined,
    false
  );

  await waitForNode(
    session.nodeId,
    (node) => {
      if (!node) {
        return false;
      }

      if (kind === 'agent') {
        return Boolean(
          node.metadata?.agent?.liveSession &&
            (node.status === 'waiting-input' || node.status === 'running' || node.status === 'starting')
        );
      }

      return Boolean(node.metadata?.terminal?.liveSession && node.status === 'live');
    },
    session.startTimeoutMs ?? 20000,
    `${kind} session ${session.nodeId} startup`
  );

  for (const step of session.steps ?? []) {
    await dispatchExecutionInput(kind, session.nodeId, step.input, surface);

    if (typeof step.delayMs === 'number' && step.delayMs > 0) {
      await delay(step.delayMs);
    }

    if (step.expectOutput || step.expectStatus || typeof step.expectLiveSession === 'boolean') {
      await waitForNode(
        session.nodeId,
        (node) => doesNodeMatchStep(node, kind, step),
        step.timeoutMs ?? 15000,
        `${kind} session ${session.nodeId} step ${step.input}`
      );
    }
  }
}

async function runRecordingScript(steps, surface) {
  for (const step of steps) {
    switch (step?.kind) {
      case 'delay':
        await delay(step.ms ?? 0);
        break;
      case 'domAction':
        await performDomAction(step.action, surface, step.timeoutMs ?? 5000);
        break;
      case 'dispatchExecutionInput':
        await dispatchExecutionInput(step.executionKind, step.nodeId, step.input, surface);
        if (typeof step.delayMs === 'number' && step.delayMs > 0) {
          await delay(step.delayMs);
        }
        break;
      case 'waitForNodeCount':
        await waitForNodeCount(step.count, step.timeoutMs ?? 15000);
        break;
      case 'waitForNode': {
        await waitForNode(
          step.nodeId,
          (node) => doesNodeMatchExpectation(node, step),
          step.timeoutMs ?? 15000,
          step.label ?? `node ${step.nodeId}`
        );
        break;
      }
      default:
        throw new Error(`Unsupported Marketplace media recording step: ${JSON.stringify(step)}`);
    }
  }
}

function doesNodeMatchStep(node, kind, step) {
  if (!node) {
    return false;
  }

  const metadata = kind === 'agent' ? node.metadata?.agent : node.metadata?.terminal;
  if (!metadata) {
    return false;
  }

  if (typeof step.expectLiveSession === 'boolean' && metadata.liveSession !== step.expectLiveSession) {
    return false;
  }

  if (step.expectStatus && node.status !== step.expectStatus) {
    return false;
  }

  if (step.expectOutput && !String(metadata.recentOutput ?? '').includes(step.expectOutput)) {
    return false;
  }

  return true;
}

function doesNodeMatchExpectation(node, step) {
  if (!node) {
    return false;
  }

  if (step.nodeKind && node.kind !== step.nodeKind) {
    return false;
  }

  if (step.title && node.title !== step.title) {
    return false;
  }

  if (step.status && node.status !== step.status) {
    return false;
  }

  if (Array.isArray(step.statusOneOf) && step.statusOneOf.length > 0 && !step.statusOneOf.includes(node.status)) {
    return false;
  }

  if (typeof step.liveSession === 'boolean') {
    const metadata = node.kind === 'agent' ? node.metadata?.agent : node.metadata?.terminal;
    if (!metadata || metadata.liveSession !== step.liveSession) {
      return false;
    }
  }

  if (step.outputIncludes) {
    const metadata = node.kind === 'agent' ? node.metadata?.agent : node.metadata?.terminal;
    if (!metadata || !String(metadata.recentOutput ?? '').includes(step.outputIncludes)) {
      return false;
    }
  }

  return true;
}

async function dispatchExecutionInput(kind, nodeId, input, surface) {
  assert.ok(typeof input === 'string' && input.length > 0, 'Marketplace media execution step requires a non-empty input.');

  return vscode.commands.executeCommand(
    COMMAND_IDS.testDispatchWebviewMessage,
    {
      type: 'webview/executionInput',
      payload: {
        nodeId,
        kind,
        data: input.endsWith('\r') ? input : `${input}\r`
      }
    },
    surface
  );
}

async function waitForNode(nodeId, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = await getDebugSnapshot();

  while (Date.now() < deadline) {
    const node = findNodeById(lastSnapshot, nodeId);
    if (predicate(node, lastSnapshot)) {
      return lastSnapshot;
    }

    await delay(120);
    lastSnapshot = await getDebugSnapshot();
  }

  assert.fail(
    `Timed out waiting for ${label}. Last node snapshot: ${JSON.stringify(findNodeById(lastSnapshot, nodeId), null, 2)}`
  );
}

async function waitForNodeCount(count, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = await getDebugSnapshot();

  while (Date.now() < deadline) {
    if ((lastSnapshot?.state?.nodes?.length ?? 0) === count) {
      return lastSnapshot;
    }

    await delay(120);
    lastSnapshot = await getDebugSnapshot();
  }

  assert.fail(
    `Timed out waiting for node count ${count}. Last snapshot: ${JSON.stringify(lastSnapshot?.state?.nodes ?? [], null, 2)}`
  );
}

async function getDebugSnapshot() {
  return vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
}

async function performDomAction(action, surface, timeoutMs) {
  return vscode.commands.executeCommand(
    COMMAND_IDS.testPerformWebviewDomAction,
    action,
    surface,
    timeoutMs
  );
}

async function writeReadyFile(payload) {
  await fs.mkdir(path.dirname(readyFilePath), { recursive: true });
  await fs.writeFile(readyFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function startRecordingStateMirror(surface) {
  if (!stateFilePath) {
    return undefined;
  }

  let stopped = false;
  let activeWrite = Promise.resolve();

  const writeSnapshot = async () => {
    const [debugSnapshot, probeSnapshot] = await Promise.all([
      getDebugSnapshot(),
      captureProbeSnapshot(surface)
    ]);
    await atomicWriteJson(stateFilePath, {
      capturedAt: new Date().toISOString(),
      surface,
      debugSnapshot,
      probeSnapshot
    });
  };

  const enqueueWrite = () => {
    activeWrite = activeWrite
      .catch(() => {})
      .then(async () => {
        if (stopped) {
          return;
        }

        await writeSnapshot();
      });
    return activeWrite;
  };

  await enqueueWrite();
  const timer = setInterval(() => {
    void enqueueWrite();
  }, 250);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await activeWrite.catch(() => {});
      await writeSnapshot().catch(() => {});
    }
  };
}

async function captureProbeSnapshot(surface) {
  try {
    return await vscode.commands.executeCommand(
      COMMAND_IDS.testCaptureWebviewProbe,
      surface,
      2000,
      0
    );
  } catch {
    return null;
  }
}

function findNodeById(snapshot, nodeId) {
  return snapshot?.state?.nodes?.find((node) => node.id === nodeId);
}

async function revealExtensionSidebar() {
  const commands = [
    `workbench.view.extension.${VIEW_IDS.activityBarContainer}`,
    `${VIEW_IDS.sidebarTree}.focus`,
    'workbench.action.focusSideBar'
  ];

  for (const command of commands) {
    try {
      await vscode.commands.executeCommand(command);
    } catch {
      // Ignore individual command failures and continue with the next hint.
    }
  }
}

async function closeAuxiliaryBar() {
  try {
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  } catch {
    // Ignore when the current VS Code build does not expose the auxiliary bar command.
  }
}

async function clearNotifications() {
  const commands = ['notifications.clearAll', 'workbench.action.closeMessages'];

  for (const command of commands) {
    try {
      await vscode.commands.executeCommand(command);
    } catch {
      // Ignore when the current VS Code build does not expose the notification command.
    }
  }
}

function requireEnv(key) {
  const value = process.env[key]?.trim();
  assert.ok(value, `Missing required environment variable ${key}.`);
  return value;
}

async function waitForAck(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await delay(200);
    }
  }

  throw new Error(`Timed out waiting for Marketplace media capture ack: ${filePath}`);
}

async function waitForCompletion(filePath, timeoutMs) {
  if (!filePath) {
    throw new Error('Missing Marketplace media completion file path environment variable.');
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await delay(200);
    }
  }

  throw new Error(`Timed out waiting for Marketplace media automation completion: ${filePath}`);
}

async function readRequiredJson(filePath, label) {
  if (!filePath) {
    throw new Error(`Missing ${label} file path environment variable.`);
  }

  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeFailureArtifacts(error) {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, 'marketplace-media-failure.txt'),
    error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`,
    'utf8'
  );
}

async function atomicWriteJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
