const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  testGetWebviewHtmlSnapshot: 'devSessionCanvas.__test.getWebviewHtmlSnapshot',
  testGetSidebarSummaryItems: 'devSessionCanvas.__test.getSidebarSummaryItems',
  testGetSidebarTemplateItems: 'devSessionCanvas.__test.getSidebarTemplateItems',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCaptureWebviewProbe: 'devSessionCanvas.__test.captureWebviewProbe',
  testSetPersistedState: 'devSessionCanvas.__test.setPersistedState',
  testResetState: 'devSessionCanvas.__test.resetState'
};

const EXPECTED_COPY_BY_LOCALE = {
  en: {
    envLanguage: 'en',
    webviewLocale: 'en',
    manifestCommandTitle: 'Dev Session Canvas: Create Node',
    manifestSummaryViewTitle: 'Overview',
    sidebarWorkspaceTrustLabel: 'Workspace Trust',
    sidebarTrustedDescription: 'Trusted',
    templateBuiltinLocation: 'Built-in',
    standbyHeading: 'The main canvas is currently running in workbench view',
    standbySwitch: 'Switch to editor area',
    agentOverlayTitle: 'Agent not started yet',
    terminalOverlayTitle: 'Terminal not started yet',
    idleStatus: 'Not started'
  },
  'zh-cn': {
    envLanguage: 'zh-cn',
    webviewLocale: 'zh-CN',
    manifestCommandTitle: 'Dev Session Canvas: 创建节点',
    manifestSummaryViewTitle: '概览',
    sidebarWorkspaceTrustLabel: '工作区信任',
    sidebarTrustedDescription: '已信任',
    templateBuiltinLocation: '内置',
    standbyHeading: '当前主画布正在工作台视图中运行',
    standbySwitch: '切换到编辑区',
    agentOverlayTitle: 'Agent 尚未启动',
    terminalOverlayTitle: '终端尚未启动',
    idleStatus: '未启动'
  }
};

const artifactDir = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
let lastWebviewProbe;

module.exports = {
  run
};

async function run() {
  const locale = normalizeExpectedLocale(process.env.DEV_SESSION_CANVAS_EXPECTED_LOCALE);
  const expected = EXPECTED_COPY_BY_LOCALE[locale];

  try {
    const extension = await activateVisibleExtension(vscode, EXTENSION_ID);
    await waitForCommand(vscode, COMMAND_IDS.testResetState);
    await vscode.commands.executeCommand(COMMAND_IDS.testResetState);

    assert.strictEqual(
      vscode.env.language.toLowerCase(),
      expected.envLanguage,
      `Expected VS Code to start with ${expected.envLanguage} locale.`
    );

    await verifyLocalizedManifest(extension, expected);
    await verifyLocalizedHostRuntime(expected);
    await verifyLocalizedWebviewRuntime(expected);

    console.log(`UI copy locale assertions passed for ${locale}.`);
  } catch (error) {
    await writeFailureArtifacts(error);
    throw error;
  }
}

async function verifyLocalizedManifest(extension, expected) {
  const commands = extension.packageJSON?.contributes?.commands;
  assert.ok(Array.isArray(commands), 'Expected extension manifest to contribute commands.');
  const createNodeCommand = commands.find((command) => command.command === 'devSessionCanvas.createNode');
  assert.strictEqual(
    getManifestLocalizedValue(createNodeCommand?.title),
    expected.manifestCommandTitle,
    'Expected VS Code package.nls command title to match the active locale.'
  );

  const sidebarViews = extension.packageJSON?.contributes?.views?.devSessionCanvas;
  assert.ok(Array.isArray(sidebarViews), 'Expected extension manifest to contribute sidebar views.');
  const summaryView = sidebarViews.find((view) => view.id === 'devSessionCanvas.sidebar');
  assert.strictEqual(
    getManifestLocalizedValue(summaryView?.name),
    expected.manifestSummaryViewTitle,
    'Expected VS Code package.nls view title to match the active locale.'
  );
}

async function verifyLocalizedHostRuntime(expected) {
  const sidebarSummaryItems = await vscode.commands.executeCommand(COMMAND_IDS.testGetSidebarSummaryItems);
  const workspaceTrustItem = Array.isArray(sidebarSummaryItems)
    ? sidebarSummaryItems.find((item) => item?.id === 'summary/workspace-trust')
    : undefined;
  assert.strictEqual(workspaceTrustItem?.label, expected.sidebarWorkspaceTrustLabel);
  assert.strictEqual(workspaceTrustItem?.description, expected.sidebarTrustedDescription);

  const templateItems = await vscode.commands.executeCommand(COMMAND_IDS.testGetSidebarTemplateItems);
  const builtinTemplate = Array.isArray(templateItems)
    ? templateItems.find((item) => item?.sourceKind === 'builtin')
    : undefined;
  assert.ok(builtinTemplate, 'Expected at least one built-in template sidebar item.');
  assert.strictEqual(builtinTemplate.locationLabel, expected.templateBuiltinLocation);

  const webviewHtmlSnapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetWebviewHtmlSnapshot);
  assert.strictEqual(webviewHtmlSnapshot?.locale, expected.webviewLocale);
  assert.strictEqual(webviewHtmlSnapshot?.standbyHeading, expected.standbyHeading);
  assert.strictEqual(webviewHtmlSnapshot?.standbySwitch, expected.standbySwitch);
  assert.ok(
    typeof webviewHtmlSnapshot?.standbyDescription === 'string' && webviewHtmlSnapshot.standbyDescription.length > 20,
    'Expected standby HTML description to be localized and non-empty.'
  );
  assert.ok(
    typeof webviewHtmlSnapshot?.standbyOpenDefault === 'string' && webviewHtmlSnapshot.standbyOpenDefault.length > 0,
    'Expected standby HTML default action to be localized and non-empty.'
  );
}

async function verifyLocalizedWebviewRuntime(expected) {
  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  const agentNodeId = 'locale-smoke-agent';
  const terminalNodeId = 'locale-smoke-terminal';
  await vscode.commands.executeCommand(COMMAND_IDS.testSetPersistedState, {
    version: 1,
    updatedAt: '2026-07-03T00:00:00.000Z',
    nodes: [
      {
        id: agentNodeId,
        kind: 'agent',
        title: 'Locale Smoke Agent',
        status: 'idle',
        summary: '',
        position: { x: 120, y: 120 },
        size: { width: 560, height: 430 },
        metadata: {
          agent: {
            provider: 'codex',
            lifecycle: 'idle',
            liveSession: false
          }
        }
      },
      {
        id: terminalNodeId,
        kind: 'terminal',
        title: 'Locale Smoke Terminal',
        status: 'idle',
        summary: '',
        position: { x: 740, y: 120 },
        size: { width: 540, height: 420 },
        metadata: {
          terminal: {
            lifecycle: 'idle',
            liveSession: false
          }
        }
      }
    ],
    edges: [],
    groups: [],
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  });

  const probe = await waitForWebviewProbe(
    (currentProbe) => {
      const agentProbe = currentProbe.nodes.find((node) => node.nodeId === agentNodeId);
      const terminalProbe = currentProbe.nodes.find((node) => node.nodeId === terminalNodeId);

      return Boolean(
        currentProbe.hasCanvasShell &&
          currentProbe.hasReactFlow &&
          agentProbe?.overlayTitle === expected.agentOverlayTitle &&
          agentProbe?.statusText === expected.idleStatus &&
          terminalProbe?.overlayTitle === expected.terminalOverlayTitle &&
          terminalProbe?.statusText === expected.idleStatus
      );
    },
    15000
  );

  const agentProbe = probe.nodes.find((node) => node.nodeId === agentNodeId);
  const terminalProbe = probe.nodes.find((node) => node.nodeId === terminalNodeId);
  assert.strictEqual(agentProbe?.overlayTitle, expected.agentOverlayTitle);
  assert.strictEqual(agentProbe?.statusText, expected.idleStatus);
  assert.strictEqual(terminalProbe?.overlayTitle, expected.terminalOverlayTitle);
  assert.strictEqual(terminalProbe?.statusText, expected.idleStatus);
}

async function waitForWebviewProbe(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe;
  let lastProbeError;

  while (Date.now() < deadline) {
    try {
      lastProbe = await captureWebviewProbe('editor', Math.min(5000, Math.max(500, deadline - Date.now())));
      lastProbeError = undefined;
      if (predicate(lastProbe)) {
        return lastProbe;
      }
    } catch (error) {
      lastProbeError = error;
    }

    await sleep(100);
  }

  assert.fail(
    `Timed out waiting for localized Webview probe. Last probe: ${JSON.stringify(lastProbe ?? null)}. Last error: ${lastProbeError ? formatError(lastProbeError) : '<none>'}`
  );
}

async function captureWebviewProbe(surface, timeoutMs) {
  const probe = await vscode.commands.executeCommand(COMMAND_IDS.testCaptureWebviewProbe, surface, timeoutMs);
  lastWebviewProbe = probe;
  return probe;
}

function normalizeExpectedLocale(value) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'en' || normalized === 'zh-cn') {
    return normalized;
  }
  throw new Error(`DEV_SESSION_CANVAS_EXPECTED_LOCALE must be "en" or "zh-cn", got ${value ?? '<unset>'}.`);
}

function getManifestLocalizedValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value.value === 'string') {
    return value.value;
  }
  return value;
}

async function writeFailureArtifacts(error) {
  if (!artifactDir) {
    return;
  }

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, 'failure-error.txt'), formatError(error), 'utf8');
  if (lastWebviewProbe !== undefined) {
    await fs.writeFile(
      path.join(artifactDir, 'failure-webview-probe.json'),
      `${JSON.stringify(lastWebviewProbe, null, 2)}\n`,
      'utf8'
    );
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
