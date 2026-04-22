import path from 'path';
import net from 'net';
import { spawn, spawnSync } from 'child_process';
import { existsSync, promises as fs, readFileSync, statSync } from 'fs';
import { chromium } from 'playwright';

import {
  buildVSCodeArgs,
  buildVSCodeChildEnv,
  ensureVSCodeExecutable,
  prepareRuntime
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const sharedRepoRoot = resolveSharedRepoRoot();
const vscodeTestCachePath = configureVSCodeTestCache(sharedRepoRoot);
const extensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'marketplace-media-tests.cjs');
const currentNodeBinDir = path.dirname(process.execPath);
const codexCommandPath = resolveMarketplaceCommand({
  envKey: 'DEV_SESSION_CANVAS_MARKETPLACE_CODEX_COMMAND',
  fallbackPaths: [],
  binName: 'codex'
});
const claudeCommandPath = resolveMarketplaceCommand({
  envKey: 'DEV_SESSION_CANVAS_MARKETPLACE_CLAUDE_COMMAND',
  fallbackPaths: [],
  binName: 'claude'
});
const terminalCommandPath = resolveMarketplaceCommand({
  envKey: 'DEV_SESSION_CANVAS_MARKETPLACE_TERMINAL_COMMAND',
  fallbackPaths: [process.env.SHELL?.trim(), '/bin/bash', '/bin/sh'].filter(Boolean),
  binName: 'bash'
});
const debugRoot = path.join(projectRoot, '.debug', 'marketplace-media');
const outputDir = path.join(projectRoot, 'images', 'marketplace');
const recordingPath = path.join(debugRoot, 'canvas-overview.mp4');
const videoPath = path.join(outputDir, 'canvas-overview.mp4');
const screenshotPath = path.join(outputDir, 'canvas-overview.png');
const gifPath = path.join(outputDir, 'canvas-overview.gif');
const nativeInputScriptPath = path.join(projectRoot, 'scripts', 'x11-native-input.py');
const interactionLogPath = path.join(debugRoot, 'artifacts', 'native-input-log.ndjson');
const DISPLAY_SIZE = { width: 1720, height: 1180 };
const WINDOW_TITLE_PATTERN = /(Extension Development Host|Visual Studio Code|Code - OSS)/i;
const CDP_HOST = '127.0.0.1';
const GIF_FPS = 8;
const GIF_WIDTH = 1180;
const SCREENSHOT_FROM_END_SECONDS = 0.2;
const READY_TIMEOUT_MS = 120000;
const TEST_EXIT_TIMEOUT_MS = 240000;
const CDP_CONNECT_TIMEOUT_MS = 30000;
const RECORDING_WARMUP_MS = 500;
const AGENT_STARTUP_TIMEOUT_MS = 45000;
const TERMINAL_STARTUP_TIMEOUT_MS = 15000;
const EXECUTION_COMPLETION_TIMEOUT_MS = 8000;
const EXECUTION_FALLBACK_HOLD_MS = 3000;
const FILE_ACTIVITY_TIMEOUT_MS = 15000;
const CANVAS_CREATION_POINT_RATIOS = {
  terminal: {
    x: 0.46,
    y: 0.22
  }
};
const RECORDING_LAYOUT_PRESET = {
  note: { x: -460, y: -200 },
  codeWorker: { x: -460, y: 360 },
  reviewer: { x: 140, y: 360 },
  terminal: { x: 140, y: -200 }
};
const CANVAS_CONTROL_OFFSETS = {
  x: 61,
  fitViewBottom: 37,
  gap: 32
};

async function main() {
  await prepareDirectories();
  ensureCommandAvailable('Xvfb', ['-help'], '缺少 Xvfb，无法生成真实 VS Code 素材。');
  ensureCommandAvailable('xwininfo', ['-version'], '缺少 xwininfo，无法定位 VS Code 窗口。');
  ensureCommandAvailable('ffmpeg', ['-version'], '缺少 ffmpeg，无法截图或合成 GIF。');
  ensureCommandAvailable('xsel', ['--help'], '缺少 xsel，无法通过原生 X11 剪贴板向真实终端粘贴任务输入。');

  runNodeCommand(['scripts/build.mjs'], '构建扩展 bundle 失败。');
  const cachedVSCodeExecutablePath = await findCachedVSCodeExecutablePath(vscodeTestCachePath);
  console.log(`Using VS Code test cache: ${vscodeTestCachePath}`);
  console.log(`Cached VS Code executable: ${cachedVSCodeExecutablePath ?? 'not found'}`);
  const vscodeExecutablePath = cachedVSCodeExecutablePath ?? (await ensureVSCodeExecutable(projectRoot));
  const display = await startXvfb();

  try {
    await recordMarketplaceSession({
      vscodeExecutablePath,
      display: display.display
    });
  } finally {
    await stopXvfb(display.process);
  }

  console.log(`Generated ${path.relative(projectRoot, screenshotPath)}`);
  console.log(`Generated ${path.relative(projectRoot, gifPath)}`);
  console.log(`Generated ${path.relative(projectRoot, videoPath)}`);
}

async function recordMarketplaceSession({ vscodeExecutablePath, display }) {
  const cdpPort = await findFreePort();
  const runtime = await prepareRuntime({
    debugRoot,
    runtimeDirName: 'dsc-marketplace-media-recording',
    userSettings: {
      'security.workspace.trust.enabled': false,
      'window.commandCenter': false,
      'editor.minimap.enabled': false,
      'workbench.colorTheme': 'Default Dark+',
      'workbench.panel.defaultLocation': 'bottom',
      'workbench.panel.opensMaximized': 'always'
    }
  });
  await hydrateMarketplaceProviderRuntime(runtime);
  const codexRuntimeCommandPath = await writeMarketplaceCommandShim({
    runtime,
    name: 'codex-runtime',
    targetCommand: codexCommandPath,
    prependPathEntries: [currentNodeBinDir]
  });

  const specPath = path.join(runtime.artifactsDir, 'recording-spec.json');
  const readyPath = path.join(runtime.artifactsDir, 'recording-ready.json');
  const ackPath = path.join(runtime.artifactsDir, 'recording-started.ack');
  const donePath = path.join(runtime.artifactsDir, 'recording-done.ack');
  const statePath = path.join(runtime.artifactsDir, 'recording-state.json');
  const controlPath = path.join(runtime.artifactsDir, 'recording-control.ndjson');
  await fs.writeFile(specPath, `${JSON.stringify(createRecordingSpec(), null, 2)}\n`, 'utf8');
  await fs.rm(readyPath, { force: true });
  await fs.rm(ackPath, { force: true });
  await fs.rm(donePath, { force: true });
  await fs.rm(statePath, { force: true });
  await fs.rm(controlPath, { force: true });
  await fs.rm(recordingPath, { force: true });

  const args = buildVSCodeArgs({
    workspacePath: projectRoot,
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath,
    userDataDir: runtime.userDataDir,
    extensionsDir: runtime.extensionsDir,
    disableWorkspaceTrust: true,
    disableExtensions: true,
    extraLaunchArgs: [
      '--new-window',
      '--force-device-scale-factor=1',
      `--remote-debugging-port=${cdpPort}`
    ]
  });
  const env = buildVSCodeChildEnv({
    ...runtime.environment,
    DISPLAY: display,
    DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_SPEC_FILE: specPath,
    DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_READY_FILE: readyPath,
    DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_ACK_FILE: ackPath,
    DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_DONE_FILE: donePath,
    DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_STATE_FILE: statePath,
    DEV_SESSION_CANVAS_MARKETPLACE_MEDIA_CONTROL_FILE: controlPath,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: codexRuntimeCommandPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: claudeCommandPath,
    DEV_SESSION_CANVAS_TEST_TERMINAL_COMMAND: terminalCommandPath,
    PATH: prependPathEntriesToPath([currentNodeBinDir], process.env.PATH),
    TERM: 'xterm-256color'
  });
  const child = spawn(vscodeExecutablePath, args, {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const devToolsEndpointPromise = waitForDevToolsEndpoint(child, READY_TIMEOUT_MS);
  mirrorChildOutput(child.stdout, process.stdout);
  mirrorChildOutput(child.stderr, process.stderr);

  let recorder;
  let browser;
  try {
    await waitForFileOrChildExit(child, readyPath, READY_TIMEOUT_MS);
    const geometry = await waitForVSCodeWindowGeometry(display, debugRoot);
    const devToolsEndpoint = await devToolsEndpointPromise;
    browser = await connectToVSCodeBrowser(devToolsEndpoint);
    await dumpCDPTopology(browser, path.join(runtime.artifactsDir, 'cdp-topology.json'));
    await dumpCDPTargets(browser, path.join(runtime.artifactsDir, 'cdp-targets.json')).catch(() => {});
    await dumpWorkbenchDiagnostics(browser, path.join(runtime.artifactsDir, 'workbench-diagnostics.json')).catch(() => {});
    const workbenchSurface = await waitForWorkbenchSurface(browser, runtime.artifactsDir);
    const canvasSurface = await waitForCanvasSurface(browser, runtime.artifactsDir).catch(() => undefined);
    console.log(`Canvas surface: ${canvasSurface?.description ?? 'unavailable'}`);
    await ensureOpeningViewport({
      display,
      canvasSurface,
      screenFrameBox: await getWorkbenchFrameScreenBox(workbenchSurface, geometry),
      stateFilePath: statePath
    });
    await delay(250);
    recorder = await startWindowRecorder(display, geometry, recordingPath);
    await delay(RECORDING_WARMUP_MS);
    await fs.writeFile(ackPath, 'recording\n', 'utf8');
    await runMarketplaceRecording({
      canvasSurface,
      workbenchSurface,
      display,
      windowGeometry: geometry,
      stateFilePath: statePath,
      controlFilePath: controlPath
    });
    await stopWindowRecorder(recorder);
    recorder = undefined;
    await fs.writeFile(donePath, 'done\n', 'utf8');
    await waitForChildExit(child, TEST_EXIT_TIMEOUT_MS);
  } catch (error) {
    child.kill('SIGTERM');
    await waitForChildExit(child, 5000).catch(() => {
      child.kill('SIGKILL');
    });
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await stopWindowRecorder(recorder);
  }

  await fs.access(recordingPath);
  await fs.copyFile(recordingPath, videoPath);
  composeGifFromVideo(recordingPath, gifPath);
  extractScreenshotFromVideo(recordingPath, screenshotPath);
}

async function prepareDirectories() {
  await fs.rm(debugRoot, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(vscodeTestCachePath, { recursive: true });
  await fs.rm(videoPath, { force: true });
  await fs.rm(screenshotPath, { force: true });
  await fs.rm(gifPath, { force: true });
  await fs.rm(interactionLogPath, { force: true });
}

function createRecordingSpec() {
  return {
    mode: 'recording',
    theme: 'Default Dark+',
    surface: 'panel',
    persistedState: createPersistedState([
      createNoteNode({
        id: 'note-1',
        title: '0.2.0 README 录制脚本',
        content: [
          '1. 初始页面只保留一个 Note 节点',
          '2. 右键创建并启动真实 Codex / Claude / Terminal',
          '3. 将两个 Agent 重命名为 Code Worker / Reviewer',
          '4. 在两个 Agent 之间补一条关系连线',
          '5. 让 Reviewer 写入 .debug/release-media-demo.md，展示单文件节点',
          '6. 给 Code Worker 输入：写一首打油诗'
        ].join('\n'),
        position: { x: 0, y: 0 },
        size: { width: 400, height: 350 }
      })
    ]),
    expectedNodeCount: 5,
    editorMinimapEnabled: false,
    settleDelayMs: 500,
    postSetupDelayMs: 700,
    captureTimeoutMs: TEST_EXIT_TIMEOUT_MS
  };
}

function createPersistedState(nodes) {
  return {
    version: 1,
    updatedAt: '2026-04-22T10:30:00.000Z',
    nodes
  };
}

function createNoteNode({ id, title, content, position, size }) {
  return {
    id,
    kind: 'note',
    title,
    status: 'ready',
    summary: content.split('\n')[0] ?? '',
    position,
    size,
    metadata: {
      note: {
        content
      }
    }
  };
}

async function runMarketplaceRecording({
  canvasSurface,
  workbenchSurface,
  display,
  windowGeometry,
  stateFilePath,
  controlFilePath
}) {
  const screenFrameBox = await getWorkbenchFrameScreenBox(workbenchSurface, windowGeometry);

  await delay(1200);
  let statePayload = await waitForRecordingState(
    stateFilePath,
    (payload) => {
      const noteNode = findNodeById(getRecordingNodes(payload), 'note-1');
      const probeNode = findProbeNodeById(payload, 'note-1');
      return Boolean(noteNode && probeNode && probeNode.renderedWidth > 0 && probeNode.renderedHeight > 0);
    },
    5000,
    'initial recording state'
  );

  const codeWorkerContextMenuPoint = {
    x: 140,
    y: Math.max(220, screenFrameBox.height - 220)
  };
  const codexContextAnchor = await clickCanvasPanePoint(display, screenFrameBox, codeWorkerContextMenuPoint, 'right', {
    canvasSurface
  });
  await delay(460);
  await clickContextMenuItem(display, screenFrameBox, codexContextAnchor, 'root', 'create-agent-default', {
    canvasSurface
  });
  statePayload = await waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findAgentNodeByProvider(getRecordingNodes(payload), 'codex')),
    10000,
    'Codex agent creation'
  );
  const codexNodeId = findAgentNodeByProvider(getRecordingNodes(statePayload), 'codex')?.id;
  if (!codexNodeId) {
    throw new Error('Failed to resolve the created Codex node from the recording state.');
  }

  const codexLiveOutcomePromise = waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findNodeById(getRecordingNodes(payload), codexNodeId)?.metadata?.agent?.liveSession),
    AGENT_STARTUP_TIMEOUT_MS,
    'Codex live session startup'
  ).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  );
  await delay(420);

  const reviewerContextMenuPoint = {
    x: Math.round(screenFrameBox.width * 0.42),
    y: Math.max(220, screenFrameBox.height - 220)
  };
  const claudeContextAnchor = await clickCanvasPanePoint(
    display,
    screenFrameBox,
    reviewerContextMenuPoint,
    'right',
    {
      canvasSurface
    }
  );
  await delay(420);
  await clickContextMenuItem(display, screenFrameBox, claudeContextAnchor, 'root', 'show-agent-providers', {
    canvasSurface
  });
  await delay(420);
  await clickContextMenuItem(display, screenFrameBox, claudeContextAnchor, 'provider', 'create-agent-claude', {
    canvasSurface
  });
  statePayload = await waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findAgentNodeByProvider(getRecordingNodes(payload), 'claude')),
    10000,
    'Claude node creation'
  );
  const claudeNodeId = findAgentNodeByProvider(getRecordingNodes(statePayload), 'claude')?.id;
  if (!claudeNodeId) {
    throw new Error('Failed to resolve the created Claude node from the recording state.');
  }
  const claudeLivePromise = waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findNodeById(getRecordingNodes(payload), claudeNodeId)?.metadata?.agent?.liveSession),
    AGENT_STARTUP_TIMEOUT_MS,
    'Claude live session startup'
  ).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error })
  );
  await delay(420);

  const terminalContextAnchor = await clickCanvasPanePoint(
    display,
    screenFrameBox,
    resolveCanvasCreationPoint(screenFrameBox, CANVAS_CREATION_POINT_RATIOS.terminal),
    'right',
    {
      canvasSurface
    }
  );
  await delay(420);
  await clickContextMenuItem(display, screenFrameBox, terminalContextAnchor, 'root', 'create-terminal', {
    canvasSurface
  });
  statePayload = await waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findFirstNodeByKind(getRecordingNodes(payload), 'terminal')),
    10000,
    'Terminal node creation'
  );
  const terminalNodeId = findFirstNodeByKind(getRecordingNodes(statePayload), 'terminal')?.id;
  if (!terminalNodeId) {
    throw new Error('Failed to resolve the created Terminal node from the recording state.');
  }

  const terminalLivePromise = waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findNodeById(getRecordingNodes(payload), terminalNodeId)?.metadata?.terminal?.liveSession),
    TERMINAL_STARTUP_TIMEOUT_MS,
    'Terminal live session startup'
  ).catch(() => undefined);
  await delay(480);

  if (canvasSurface?.verified) {
    await appendInteractionLog({
      type: 'phase',
      label: 'wait-node-count-start',
      count: 4
    });
    await waitForNodeCount(canvasSurface, 4, 12000).catch(() => undefined);
    await appendInteractionLog({
      type: 'phase',
      label: 'wait-node-count-end',
      count: 4
    });
    await delay(260);
    statePayload = (await readRecordingState(stateFilePath)) ?? statePayload;
  } else {
    await appendInteractionLog({
      type: 'phase',
      label: 'recording-state-node-count-start',
      count: 4
    });
    statePayload = await waitForRecordingState(
      stateFilePath,
      (payload) => getRecordingNodes(payload).length >= 4,
      5000,
      'all overview nodes'
    );
    await appendInteractionLog({
      type: 'phase',
      label: 'recording-state-node-count-end',
      count: 4
    });
  }
  statePayload = await applyRecordingLayoutPreset({
    controlFilePath,
    stateFilePath,
    positions: {
      'note-1': RECORDING_LAYOUT_PRESET.note,
      [codexNodeId]: RECORDING_LAYOUT_PRESET.codeWorker,
      [claudeNodeId]: RECORDING_LAYOUT_PRESET.reviewer,
      [terminalNodeId]: RECORDING_LAYOUT_PRESET.terminal
    }
  });
  await delay(260);
  await appendInteractionLog({
    type: 'phase',
    label: 'fit-view-overview-start'
  });
  statePayload = await fitCanvasToOverview({
    canvasSurface,
    display,
    screenFrameBox,
    stateFilePath,
    statePayload
  });
  await appendInteractionLog({
    type: 'phase',
    label: 'fit-view-overview-end'
  });
  await delay(700);
  await appendInteractionLog({
    type: 'phase',
    label: 'focus-node-start',
    nodeId: codexNodeId
  });
  statePayload = await focusNodeWithNativeDoubleClick({
    canvasSurface,
    display,
    screenFrameBox,
    stateFilePath,
    viewport: deriveFitViewViewportFromPayload(statePayload, screenFrameBox),
    node: findNodeById(getRecordingNodes(statePayload), codexNodeId)
  });
  await appendInteractionLog({
    type: 'phase',
    label: 'focus-node-end',
    nodeId: codexNodeId
  });
  await delay(950);
  statePayload = await waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findProbeNodeById(payload, codexNodeId)?.selected),
    5000,
    'Code Worker focus state'
  );
  statePayload = await renameNodeTitleWithNativeMouse({
    canvasSurface,
    page: workbenchSurface.page,
    display,
    screenFrameBox,
    controlFilePath,
    stateFilePath,
    viewport: deriveFocusViewportFromPayload(statePayload, screenFrameBox, codexNodeId),
    node: findNodeById(getRecordingNodes(statePayload), codexNodeId),
    nextTitle: 'Code Worker'
  });
  statePayload = await waitForRecordingState(
    stateFilePath,
    (payload) => findNodeById(getRecordingNodes(payload), codexNodeId)?.title === 'Code Worker',
    5000,
    'Code Worker title update'
  );
  await delay(400);
  const codexLiveOutcome = await codexLiveOutcomePromise;
  if (!codexLiveOutcome.ok) {
    throw codexLiveOutcome.error;
  }
  const claudeLiveOutcome = await claudeLivePromise;
  if (!claudeLiveOutcome.ok) {
    throw claudeLiveOutcome.error;
  }
  statePayload = (await readRecordingState(stateFilePath)) ?? statePayload;
  statePayload = await fitCanvasToOverview({
    canvasSurface,
    display,
    screenFrameBox,
    stateFilePath,
    statePayload
  });
  await delay(420);
  statePayload = await renameNodeTitleWithNativeMouse({
    canvasSurface,
    page: workbenchSurface.page,
    display,
    screenFrameBox,
    controlFilePath,
    stateFilePath,
    viewport: deriveFitViewViewportFromPayload(statePayload, screenFrameBox),
    node: findRequiredNode(getRecordingNodes(statePayload), claudeNodeId),
    nextTitle: 'Reviewer'
  });
  statePayload = await waitForRecordingState(
    stateFilePath,
    (payload) => findNodeById(getRecordingNodes(payload), claudeNodeId)?.title === 'Reviewer',
    5000,
    'Reviewer title update'
  );
  await delay(300);
  statePayload = await createManualEdgeBetweenNodes({
    controlFilePath,
    stateFilePath,
    sourceNodeId: codexNodeId,
    sourceAnchor: 'right',
    targetNodeId: claudeNodeId,
    targetAnchor: 'left'
  });
  await delay(380);
  const claudePrePromptOutput =
    findNodeById(getRecordingNodes(statePayload), claudeNodeId)?.metadata?.agent?.recentOutput ?? '';
  statePayload = await submitExecutionPromptViaRecordingControl({
    controlFilePath,
    stateFilePath,
    nodeId: claudeNodeId,
    executionKind: 'agent',
    prompt:
      '请创建 .debug/release-media-demo.md，写入一行 "release media demo"，完成后只回复 done',
    prePromptOutput: claudePrePromptOutput
  });
  const reviewerFileActivityPromise = synthesizeAgentFileActivity({
    controlFilePath,
    stateFilePath,
    ownerNodeId: claudeNodeId,
    accessMode: 'write',
    relativePath: '.debug/release-media-demo.md',
    filePath: path.join(projectRoot, '.debug', 'release-media-demo.md')
  });
  await delay(280);
  const prePromptOutput = findNodeById(getRecordingNodes(statePayload), codexNodeId)?.metadata?.agent?.recentOutput ?? '';
  statePayload = await submitExecutionPromptWithNativeMouse({
    canvasSurface,
    display,
    screenFrameBox,
    stateFilePath,
    viewport: deriveFitViewViewportFromPayload(statePayload, screenFrameBox),
    node: findRequiredNode(getRecordingNodes(statePayload), codexNodeId),
    probeNode: findProbeNodeById(statePayload, codexNodeId),
    prompt: '写一首打油诗',
    prePromptOutput
  });
  const completionPayload = await waitForRecordingState(
    stateFilePath,
    (payload) => {
      const node = findNodeById(getRecordingNodes(payload), codexNodeId);
      if (!node) {
        return false;
      }

      const recentOutput = String(node.metadata?.agent?.recentOutput ?? '');
      return (
        node.status === 'waiting-input' &&
        recentOutput !== prePromptOutput &&
        (recentOutput.trim().length >= 20 || /[\u4e00-\u9fff]/.test(recentOutput))
      );
    },
    EXECUTION_COMPLETION_TIMEOUT_MS,
    'Code Worker execution completion'
  ).catch(() => undefined);
  if (completionPayload) {
    statePayload = completionPayload;
    await delay(900);
  } else {
    await appendInteractionLog({
      type: 'execution-completion-fallback',
      nodeId: codexNodeId,
      reason: 'codex-output-not-stable'
    });
    await delay(EXECUTION_FALLBACK_HOLD_MS);
  }
  statePayload = await reviewerFileActivityPromise;
  await appendRecordingControlCommand(controlFilePath, {
    type: 'executeCommand',
    command: 'notifications.clearAll'
  });
  await appendRecordingControlCommand(controlFilePath, {
    type: 'executeCommand',
    command: 'workbench.action.closeMessages'
  });
  await delay(260);
  await delay(680);
  statePayload = await fitCanvasToOverview({
    canvasSurface,
    display,
    screenFrameBox,
    stateFilePath,
    statePayload
  });
  await terminalLivePromise;
  statePayload = (await readRecordingState(stateFilePath)) ?? statePayload;
  await fitCanvasToOverview({
    canvasSurface,
    display,
    screenFrameBox,
    stateFilePath
  });
  await delay(2400);
}

async function ensureOpeningViewport({ display, canvasSurface, screenFrameBox, stateFilePath, statePayload }) {
  let nextStatePayload = statePayload ?? (await readRecordingState(stateFilePath));
  for (let index = 0; index < 3; index += 1) {
    await clickCanvasControlButtonNative(display, screenFrameBox, 'zoom out', {
      canvasSurface
    });
    await delay(140);
    nextStatePayload = (await readRecordingState(stateFilePath)) ?? nextStatePayload;
  }

  return nextStatePayload;
}

async function waitForWorkbenchSurface(browser, artifactsDir) {
  const deadline = Date.now() + CDP_CONNECT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const candidate = await findWorkbenchSurface(browser);
    if (candidate) {
      return candidate;
    }

    await dumpWorkbenchDiagnostics(browser, path.join(artifactsDir, 'workbench-diagnostics.latest.json')).catch(() => {});
    await delay(250);
  }

  throw new Error('Timed out locating the Dev Session Canvas workbench iframe.');
}

async function findWorkbenchSurface(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!page.url().includes('workbench.html')) {
        continue;
      }

      const iframeLocator = page.locator('iframe.webview.ready').first();
      if ((await iframeLocator.count().catch(() => 0)) === 0) {
        continue;
      }

      const box = await iframeLocator.boundingBox().catch(() => null);
      if (!box || box.width < 400 || box.height < 300) {
        continue;
      }

      return {
        page,
        iframeLocator
      };
    }
  }

  return undefined;
}

async function getWorkbenchFrameScreenBox(workbenchSurface, windowGeometry) {
  const box = await getBoundingBox(workbenchSurface.iframeLocator);
  return {
    pageX: box.x,
    pageY: box.y,
    x: windowGeometry.x + box.x,
    y: windowGeometry.y + box.y,
    width: box.width,
    height: box.height
  };
}

async function fitCanvasToOverview({ display, canvasSurface, screenFrameBox, stateFilePath, statePayload }) {
  await appendInteractionLog({
    type: 'phase',
    label: 'fit-view-click-start'
  });
  await clickCanvasControlButtonNative(display, screenFrameBox, 'fit view', {
    canvasSurface
  });
  await appendInteractionLog({
    type: 'phase',
    label: 'fit-view-click-end'
  });
  await delay(220);
  return (await readRecordingState(stateFilePath)) ?? statePayload;
}

async function clickCanvasControlButtonNative(display, screenFrameBox, label, options = {}) {
  if (options.canvasSurface?.verified) {
    const exactPoint = await resolveScreenPointForLocator(
      options.canvasSurface,
      screenFrameBox,
      `.react-flow__controls-button[aria-label="${label}"]`
    ).catch(() => undefined);
    if (exactPoint) {
      await clickScreenPoint(display, exactPoint.x, exactPoint.y);
      return undefined;
    }
  }

  const candidatePoints = resolveCanvasControlCandidatePoints(screenFrameBox, label);
  for (const point of candidatePoints) {
    await clickScreenPoint(display, point.x, point.y);
    return undefined;
  }
}

function resolveCanvasControlPoint(screenFrameBox, label) {
  const controlX = screenFrameBox.x + CANVAS_CONTROL_OFFSETS.x;
  const fitViewY = screenFrameBox.y + screenFrameBox.height - CANVAS_CONTROL_OFFSETS.fitViewBottom;

  switch (label) {
    case 'zoom in':
      return { x: controlX, y: fitViewY - CANVAS_CONTROL_OFFSETS.gap * 2 };
    case 'zoom out':
      return { x: controlX, y: fitViewY - CANVAS_CONTROL_OFFSETS.gap };
    case 'fit view':
      return { x: controlX, y: fitViewY };
    default:
      throw new Error(`Unsupported canvas control label: ${label}`);
  }
}

function resolveCanvasControlCandidatePoints(screenFrameBox, label) {
  const point = resolveCanvasControlPoint(screenFrameBox, label);
  return createCandidatePoints(point, [
    [0, 0],
    [-6, 0],
    [6, 0],
    [0, -6],
    [0, 6],
    [-10, -6],
    [10, -6],
    [-10, 6],
    [10, 6]
  ]);
}

async function clickCanvasPanePoint(display, screenFrameBox, point, button = 'left', options = {}) {
  if (options.canvasSurface?.verified && button === 'right') {
    const blankPoints = await resolveCanvasBlankScreenCandidatePoints(
      options.canvasSurface,
      screenFrameBox,
      point
    ).catch(() => undefined);
    if (blankPoints) {
      for (const blankPoint of blankPoints) {
        await appendInteractionLog({
          type: 'context-menu-attempt',
          source: 'dom-blank-candidate',
          point: blankPoint
        });
        await clickScreenPoint(display, blankPoint.screenX, blankPoint.screenY, {
          button
        });
        const contextMenuVisible = await waitForCanvasContextMenuVisible(
          options.canvasSurface,
          700
        ).catch(() => false);
        await appendInteractionLog({
          type: 'context-menu-visible',
          source: 'dom-blank-candidate',
          point: blankPoint,
          visible: contextMenuVisible
        });
        if (contextMenuVisible) {
          return blankPoint;
        }
      }
    }

    const fallbackPoint = {
      x: point.x,
      y: point.y,
      screenX: screenFrameBox.x + point.x,
      screenY: screenFrameBox.y + point.y
    };
    await appendInteractionLog({
      type: 'context-menu-attempt',
      source: 'plain-fallback',
      point: fallbackPoint
    });
    await clickScreenPoint(display, fallbackPoint.screenX, fallbackPoint.screenY, {
      button
    });
    const plainFallbackVisible = await waitForCanvasContextMenuVisible(options.canvasSurface, 700).catch(() => false);
    await appendInteractionLog({
      type: 'context-menu-visible',
      source: 'plain-fallback',
      point: fallbackPoint,
      visible: plainFallbackVisible
    });
    if (plainFallbackVisible) {
      return fallbackPoint;
    }

    const plainFallbackPoints = resolveCanvasPaneFallbackCandidatePoints(screenFrameBox, point);
    for (const fallbackCandidate of plainFallbackPoints) {
      await appendInteractionLog({
        type: 'context-menu-attempt',
        source: 'plain-fallback-candidate',
        point: fallbackCandidate
      });
      await clickScreenPoint(display, fallbackCandidate.screenX, fallbackCandidate.screenY, {
        button
      });
      const contextMenuVisible = await waitForCanvasContextMenuVisible(
        options.canvasSurface,
        700
      ).catch(() => false);
      await appendInteractionLog({
        type: 'context-menu-visible',
        source: 'plain-fallback-candidate',
        point: fallbackCandidate,
        visible: contextMenuVisible
      });
      if (contextMenuVisible) {
        return fallbackCandidate;
      }
    }

    throw new Error('Failed to open the canvas context menu with native right click.');
  }

  await clickScreenPoint(display, screenFrameBox.x + point.x, screenFrameBox.y + point.y, {
    button
  });
  return {
    x: point.x,
    y: point.y,
    screenX: screenFrameBox.x + point.x,
    screenY: screenFrameBox.y + point.y
  };
}

async function clickContextMenuItem(display, screenFrameBox, anchorPoint, view, target, options = {}) {
  if (options.canvasSurface) {
    try {
      await clickCanvasContextMenuItem(options.canvasSurface, target);
      await appendInteractionLog({
        type: 'context-menu-item-click',
        strategy: 'dom-selector',
        view,
        target,
        anchorPoint
      });
      return;
    } catch {
      // Fall back to native screen coordinates when the DOM selector path is unavailable.
    }
  }

  if (options.canvasSurface?.verified) {
    const exactPoint = await resolveScreenPointForLocator(
      options.canvasSurface,
      screenFrameBox,
      resolveCanvasContextMenuItemSelector(target)
    ).catch(() => undefined);
    if (exactPoint) {
      await appendInteractionLog({
        type: 'context-menu-item-click',
        strategy: 'exact-locator',
        view,
        target,
        anchorPoint,
        point: exactPoint
      });
      await clickScreenPoint(display, exactPoint.x, exactPoint.y);
      return;
    }
  }

  const candidatePoints =
    view === 'provider'
      ? resolveProviderMenuItemCandidatePoints(screenFrameBox, anchorPoint, target)
      : resolveRootMenuItemCandidatePoints(screenFrameBox, anchorPoint, target);

  for (const point of candidatePoints) {
    await appendInteractionLog({
      type: 'context-menu-item-click',
      strategy: 'fallback-candidate',
      view,
      target,
      anchorPoint,
      point
    });
    await clickScreenPoint(display, screenFrameBox.x + point.x, screenFrameBox.y + point.y);
    return;
  }
}

function resolveRootMenuItemPoint(screenFrameBox, anchorPoint, target) {
  const menu = resolveContextMenuPosition(screenFrameBox, anchorPoint);

  switch (target) {
    case 'create-agent-default':
      return { x: menu.x + 96, y: menu.y + 60 };
    case 'show-agent-providers':
      return { x: menu.x + 244, y: menu.y + 60 };
    case 'create-terminal':
      return { x: menu.x + 124, y: menu.y + 132 };
    case 'create-note':
      return { x: menu.x + 124, y: menu.y + 172 };
    case 'dismiss':
      return { x: menu.x + 124, y: menu.y + 212 };
    default:
      throw new Error(`Unsupported root context menu target: ${target}`);
  }
}

function resolveRootMenuItemCandidatePoints(screenFrameBox, anchorPoint, target) {
  const point = resolveRootMenuItemPoint(screenFrameBox, anchorPoint, target);
  const offsets =
    target === 'show-agent-providers'
      ? [
          [0, 0],
          [-4, 0],
          [4, 0],
          [0, -4],
          [0, 4]
        ]
      : [
          [0, 0],
          [0, -6],
          [0, 6],
          [-8, 0],
          [8, 0]
        ];
  return createCandidatePoints(point, offsets);
}

function resolveProviderMenuItemPoint(screenFrameBox, anchorPoint, target) {
  const menu = resolveContextMenuPosition(screenFrameBox, anchorPoint);

  switch (target) {
    case 'create-agent-codex':
      return { x: menu.x + 124, y: menu.y + 72 };
    case 'create-agent-claude':
      return { x: menu.x + 124, y: menu.y + 112 };
    case 'back':
      return { x: menu.x + 18, y: menu.y + 18 };
    case 'dismiss':
      return { x: menu.x + 120, y: menu.y + 144 };
    default:
      throw new Error(`Unsupported provider context menu target: ${target}`);
  }
}

function resolveProviderMenuItemCandidatePoints(screenFrameBox, anchorPoint, target) {
  const point = resolveProviderMenuItemPoint(screenFrameBox, anchorPoint, target);
  const offsets =
    target === 'back'
      ? [
          [0, 0],
          [-4, 0],
          [4, 0],
          [0, -4],
          [0, 4]
        ]
      : [
          [0, 0],
          [0, -6],
          [0, 6],
          [-8, 0],
          [8, 0]
        ];
  return createCandidatePoints(point, offsets);
}

function resolveContextMenuPosition(screenFrameBox, anchorPoint) {
  return {
    x: Math.min(Math.max(12, anchorPoint.x), Math.max(12, screenFrameBox.width - 236)),
    y: Math.min(Math.max(12, anchorPoint.y), Math.max(12, screenFrameBox.height - 230))
  };
}

async function renameNodeTitleWithNativeMouse({
  canvasSurface,
  page,
  display,
  screenFrameBox,
  controlFilePath,
  stateFilePath,
  viewport,
  node,
  nextTitle
}) {
  const candidatePoints = [];
  if (canvasSurface?.verified) {
    const exactPoint = await resolveScreenPointForLocator(
      canvasSurface,
      screenFrameBox,
      `[data-node-id="${node.id}"] [data-probe-field="title"]`
    ).catch(() => undefined);
    if (exactPoint) {
      candidatePoints.push({
        ...exactPoint,
        strategy: 'exact-title-input'
      });
    }
  }

  const rect = projectNodeRectToScreen(node, viewport, screenFrameBox);
  const zoom = viewport.zoom;
  candidatePoints.push(
    ...resolveNodeTitleInputCandidatePoints(rect, zoom).map((point) => ({
      ...point,
      strategy: 'projected-title-input'
    }))
  );
  const maxNativeAttempts = controlFilePath ? Math.min(candidatePoints.length, 1) : candidatePoints.length;
  for (const point of candidatePoints.slice(0, maxNativeAttempts)) {
    await appendInteractionLog({
      type: 'node-title-click',
      nodeId: node.id,
      strategy: point.strategy ?? 'unknown',
      point: {
        x: point.x,
        y: point.y
      }
    });
    await clickScreenPoint(display, point.x, point.y);
    await delay(80);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText(nextTitle);
    await page.keyboard.press('Enter');
    const updatedPayload = await waitForRecordingState(
      stateFilePath,
      (payload) => findNodeById(getRecordingNodes(payload), node.id)?.title === nextTitle,
      1500,
      `${nextTitle} title update`
    ).catch(() => undefined);
    await appendInteractionLog({
      type: 'node-title-result',
      nodeId: node.id,
      strategy: point.strategy ?? 'unknown',
      updated: Boolean(updatedPayload)
    });
    if (updatedPayload) {
      await page.keyboard.press('Escape').catch(() => {});
      return updatedPayload;
    }
  }

  if (controlFilePath) {
    await appendInteractionLog({
      type: 'node-title-fallback',
      nodeId: node.id,
      strategy: 'recording-control'
    });
    await appendRecordingControlCommand(controlFilePath, {
      type: 'performDomAction',
      action: {
        kind: 'setNodeTextField',
        nodeId: node.id,
        field: 'title',
        value: nextTitle
      },
      timeoutMs: 5000
    });
    const updatedPayload = await waitForRecordingState(
      stateFilePath,
      (payload) => findNodeById(getRecordingNodes(payload), node.id)?.title === nextTitle,
      2500,
      `${nextTitle} title update`
    ).catch(() => undefined);
    if (updatedPayload) {
      await page.keyboard.press('Escape').catch(() => {});
      return updatedPayload;
    }
  }

  throw new Error(`Timed out waiting for ${nextTitle} title update after native title click attempts.`);
}

async function focusNodeWithNativeDoubleClick({
  canvasSurface,
  display,
  screenFrameBox,
  stateFilePath,
  viewport,
  node
}) {
  const candidatePoints = [];
  if (canvasSurface?.verified) {
    const precisePoints = await resolveNodeChromeScreenCandidatePoints(
      canvasSurface,
      screenFrameBox,
      node.id
    ).catch(() => []);
    candidatePoints.push(
      ...precisePoints.map((point) => ({
        ...point,
        strategy: 'exact-chrome-gap'
      }))
    );
  }

  const rect = projectNodeRectToScreen(node, viewport, screenFrameBox);
  const zoom = viewport.zoom;
  candidatePoints.push(
    ...resolveNodeChromeFocusCandidatePoints(rect, zoom).map((point) => ({
      ...point,
      strategy: 'projected-chrome-gap'
    }))
  );

  for (const point of candidatePoints) {
    await appendInteractionLog({
      type: 'node-focus-attempt',
      nodeId: node.id,
      strategy: point.strategy ?? 'unknown',
      point: {
        x: point.x,
        y: point.y
      }
    });
    await clickScreenPoint(display, point.x, point.y, {
      count: 2,
      moveDurationMs: 220
    });
    const focusedPayload = await waitForRecordingState(
      stateFilePath,
      (payload) => Boolean(findProbeNodeById(payload, node.id)?.selected),
      2500,
      `${node.id} focus selection`
    ).catch(() => undefined);
    await appendInteractionLog({
      type: 'node-focus-result',
      nodeId: node.id,
      strategy: point.strategy ?? 'unknown',
      focused: Boolean(focusedPayload)
    });
    if (focusedPayload) {
      return focusedPayload;
    }
  }

  throw new Error(`Timed out focusing ${node.id} with native double click.`);
}

async function submitExecutionPromptWithNativeMouse({
  canvasSurface,
  display,
  screenFrameBox,
  stateFilePath,
  viewport,
  node,
  probeNode,
  prompt,
  prePromptOutput
}) {
  const candidatePoints = [];
  const rect = projectNodeRectToScreen(node, viewport, screenFrameBox);
  const zoom = viewport.zoom;

  if (canvasSurface) {
    const exactPoint = await resolveScreenPointForLocator(
      canvasSurface,
      screenFrameBox,
      `[data-node-id="${node.id}"] .terminal-frame.is-live`
    ).catch(() => undefined);
    if (exactPoint) {
      candidatePoints.push({
        ...exactPoint,
        strategy: 'exact-terminal-frame'
      });
    }
  }

  if (
    probeNode &&
    typeof probeNode.terminalTextareaLeft === 'number' &&
    typeof probeNode.terminalTextareaTop === 'number'
  ) {
    candidatePoints.push({
      x: rect.x + probeNode.terminalTextareaLeft + 8,
      y: rect.y + probeNode.terminalTextareaTop + 8,
      strategy: 'probe-terminal-textarea'
    });
  }

  candidatePoints.push(
    ...resolveExecutionInputCandidatePoints(rect, zoom).map((point) => ({
      ...point,
      strategy: 'projected-terminal-frame'
    }))
  );
  for (const point of candidatePoints) {
    await appendInteractionLog({
      type: 'prompt-focus-attempt',
      nodeId: node.id,
      strategy: point.strategy ?? 'unknown',
      point: {
        x: point.x,
        y: point.y
      }
    });
    await clickScreenPoint(display, point.x, point.y);
    await delay(140);
    await pasteTextWithNativeClipboard(display, prompt);
    await delay(120);
    runNativeInput(display, ['key', '--combo', 'Shift+Insert']);
    await delay(180);
    runNativeInput(display, ['key', '--combo', 'Enter']);
    await delay(180);
    const submittedPayload = await waitForRecordingState(
      stateFilePath,
      (payload) => {
        const refreshedNode = findNodeById(getRecordingNodes(payload), node.id);
        if (!refreshedNode) {
          return false;
        }

        return (
          refreshedNode.status !== 'waiting-input' ||
          (refreshedNode.metadata?.agent?.recentOutput ?? '') !== prePromptOutput
        );
      },
      5000,
      `${node.id} prompt submission`
    ).catch(() => undefined);
    await appendInteractionLog({
      type: 'prompt-focus-result',
      nodeId: node.id,
      strategy: point.strategy ?? 'unknown',
      submitted: Boolean(submittedPayload)
    });
    if (submittedPayload) {
      return submittedPayload;
    }
  }

  throw new Error(`Timed out submitting prompt to ${node.id} after native input focus attempts.`);
}

async function submitExecutionPromptViaRecordingControl({
  controlFilePath,
  stateFilePath,
  nodeId,
  executionKind,
  prompt,
  prePromptOutput
}) {
  await appendInteractionLog({
    type: 'prompt-dispatch-start',
    nodeId,
    strategy: 'recording-control'
  });
  await appendRecordingControlCommand(controlFilePath, {
    type: 'dispatchWebviewMessage',
    message: {
      type: 'webview/executionInput',
      payload: {
        nodeId,
        kind: executionKind,
        data: prompt.endsWith('\r') ? prompt : `${prompt}\r`
      }
    }
  });

  const submittedPayload = await waitForRecordingState(
    stateFilePath,
    (payload) => {
      const refreshedNode = findNodeById(getRecordingNodes(payload), nodeId);
      if (!refreshedNode) {
        return false;
      }

      return (
        refreshedNode.status !== 'waiting-input' ||
        (refreshedNode.metadata?.agent?.recentOutput ?? '') !== prePromptOutput
      );
    },
    5000,
    `${nodeId} recording control prompt submission`
  );
  await appendInteractionLog({
    type: 'prompt-dispatch-end',
    nodeId,
    strategy: 'recording-control'
  });
  return submittedPayload;
}

async function createManualEdgeBetweenNodes({
  controlFilePath,
  stateFilePath,
  sourceNodeId,
  sourceAnchor,
  targetNodeId,
  targetAnchor
}) {
  await appendInteractionLog({
    type: 'manual-edge-create-start',
    strategy: 'recording-control',
    sourceNodeId,
    sourceAnchor,
    targetNodeId,
    targetAnchor
  });
  await appendRecordingControlCommand(controlFilePath, {
    type: 'dispatchWebviewMessage',
    message: {
      type: 'webview/createEdge',
      payload: {
        sourceNodeId,
        sourceAnchor,
        targetNodeId,
        targetAnchor
      }
    }
  });

  const createdPayload = await waitForRecordingState(
    stateFilePath,
    (payload) =>
      getRecordingEdges(payload).some(
        (edge) =>
          edge.owner === 'user' &&
          edge.sourceNodeId === sourceNodeId &&
          edge.targetNodeId === targetNodeId &&
          edge.sourceAnchor === sourceAnchor &&
          edge.targetAnchor === targetAnchor
      ),
    5000,
    `${sourceNodeId} -> ${targetNodeId} manual edge`
  );
  await appendInteractionLog({
    type: 'manual-edge-create-end',
    sourceNodeId,
    targetNodeId
  });
  return createdPayload;
}

async function applyRecordingLayoutPreset({ controlFilePath, stateFilePath, positions }) {
  const latestPayload = await waitForRecordingState(
    stateFilePath,
    (payload) => Object.keys(positions).every((nodeId) => Boolean(findNodeById(getRecordingNodes(payload), nodeId))),
    5000,
    'recording layout seed'
  );
  const nextState = buildRecordingLayoutState({
    state: latestPayload?.debugSnapshot?.state ?? {},
    positions
  });
  await appendInteractionLog({
    type: 'layout-preset-apply',
    positions: nextState.nodes?.map((node) => ({
      nodeId: node.id,
      position: node.position
    }))
  });
  await appendRecordingControlCommand(controlFilePath, {
    type: 'setPersistedState',
    state: nextState
  });
  return waitForRecordingState(
    stateFilePath,
    (payload) =>
      Object.entries(positions).every(([nodeId, position]) => {
        const node = findNodeById(getRecordingNodes(payload), nodeId);
        return Boolean(node && positionsMatch(node.position, position));
      }),
    5000,
    'recording layout preset'
  );
}

async function pasteTextWithNativeClipboard(display, text) {
  const result = spawnSync('xsel', ['--clipboard', '--input'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DISPLAY: display
    },
    encoding: 'utf8',
    input: text
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || 'Failed to write text to the X11 clipboard with xsel.');
  }
}

async function clickScreenPoint(display, x, y, options = {}) {
  runNativeInput(display, [
    'click',
    '--x',
    String(Math.round(x)),
    '--y',
    String(Math.round(y)),
    '--button',
    options.button ?? 'left',
    '--count',
    String(options.count ?? 1),
    '--move-duration-ms',
    String(options.moveDurationMs ?? 180),
    '--move-steps',
    String(options.moveSteps ?? 12),
    '--between-clicks-ms',
    String(options.betweenClicksMs ?? 80)
  ]);
  await delay(110);
}

function runNativeInput(display, args) {
  const result = spawnSync('python3', [nativeInputScriptPath, '--display', display, ...args], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || `Native X11 input helper failed with code ${result.status}.`
    );
  }
}

async function waitForRecordingState(stateFilePath, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload;

  while (Date.now() < deadline) {
    lastPayload = await readRecordingState(stateFilePath);
    if (lastPayload && (await predicate(lastPayload))) {
      return lastPayload;
    }

    await delay(180);
  }

  throw new Error(
    `Timed out waiting for ${label}. Last recording state: ${JSON.stringify(lastPayload ?? null, null, 2)}`
  );
}

async function readRecordingState(stateFilePath) {
  try {
    return JSON.parse(await fs.readFile(stateFilePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function getRecordingNodes(payload) {
  return payload?.debugSnapshot?.state?.nodes ?? [];
}

function getRecordingEdges(payload) {
  return payload?.debugSnapshot?.state?.edges ?? [];
}

function getRecordingProbe(payload) {
  return payload?.probeSnapshot ?? null;
}

function getRecordingProbeNodes(payload) {
  return getRecordingProbe(payload)?.nodes ?? [];
}

function findFirstNodeByKind(nodes, kind) {
  return nodes.find((node) => node.kind === kind);
}

function findAgentNodeByProvider(nodes, provider) {
  return nodes.find((node) => node.kind === 'agent' && node.metadata?.agent?.provider === provider);
}

function findOwnerFileNode(nodes, ownerNodeId, targetSuffix) {
  return nodes.find(
    (node) =>
      node.kind === 'file' &&
      node.metadata?.file?.ownerNodeIds?.includes(ownerNodeId) &&
      fileNodeContainsPath(node, targetSuffix)
  );
}

function findNodeById(nodes, nodeId) {
  return nodes.find((node) => node.id === nodeId);
}

function findRequiredNode(nodes, nodeId) {
  const node = findNodeById(nodes, nodeId);
  if (!node) {
    throw new Error(`Missing node ${nodeId} in the recording state.`);
  }

  return node;
}

function findProbeNodeById(payload, nodeId) {
  return getRecordingProbeNodes(payload).find((node) => node.nodeId === nodeId);
}

function filePathMatchesSuffix(relativePath, filePath, targetSuffix) {
  return (
    relativePath === targetSuffix ||
    relativePath.endsWith(`/${targetSuffix}`) ||
    filePath.endsWith(`/${targetSuffix}`)
  );
}

function fileNodeContainsPath(node, targetSuffix) {
  if (node.kind !== 'file') {
    return false;
  }

  const relativePath = node.metadata?.file?.relativePath ?? '';
  const filePath = node.metadata?.file?.filePath ?? '';
  return filePathMatchesSuffix(relativePath, filePath, targetSuffix);
}

async function synthesizeAgentFileActivity({
  controlFilePath,
  stateFilePath,
  ownerNodeId,
  accessMode,
  relativePath,
  filePath
}) {
  await delay(1800);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'release media demo\n', 'utf8');

  const latestPayload = await waitForRecordingState(
    stateFilePath,
    (payload) => Boolean(findNodeById(getRecordingNodes(payload), ownerNodeId)),
    5000,
    `${ownerNodeId} synthetic file activity seed`
  );
  const nextState = buildSyntheticFileActivityState({
    state: latestPayload?.debugSnapshot?.state ?? {},
    ownerNodeId,
    accessMode,
    relativePath,
    filePath
  });
  await appendRecordingControlCommand(controlFilePath, {
    type: 'setPersistedState',
    state: nextState
  });

  return waitForRecordingState(
    stateFilePath,
    (payload) => {
      const fileNode = findOwnerFileNode(getRecordingNodes(payload), ownerNodeId, 'release-media-demo.md');
      return Boolean(fileNode);
    },
    FILE_ACTIVITY_TIMEOUT_MS,
    `${ownerNodeId} synthetic file activity projection`
  );
}

function buildSyntheticFileActivityState({ state, ownerNodeId, accessMode, relativePath, filePath }) {
  const nextState = JSON.parse(JSON.stringify(state ?? {}));
  const fileReferenceId = `file-ref-${ownerNodeId}-release-media-demo`;

  nextState.version = 1;
  nextState.updatedAt = new Date().toISOString();
  nextState.nodes = (nextState.nodes ?? []).filter((node) => node.kind !== 'file' && node.kind !== 'file-list');
  nextState.edges = (nextState.edges ?? []).filter((edge) => edge.owner !== 'file-activity');
  nextState.fileReferences = (nextState.fileReferences ?? []).filter((reference) => reference.id !== fileReferenceId);
  nextState.fileReferences.push({
    id: fileReferenceId,
    filePath,
    relativePath,
    owners: [
      {
        nodeId: ownerNodeId,
        accessMode
      }
    ]
  });
  nextState.suppressedFileActivityEdgeIds = nextState.suppressedFileActivityEdgeIds ?? [];
  nextState.suppressedAutomaticFileArtifactNodeIds = nextState.suppressedAutomaticFileArtifactNodeIds ?? [];
  return nextState;
}

function buildRecordingLayoutState({ state, positions }) {
  const nextState = JSON.parse(JSON.stringify(state ?? {}));
  nextState.version = 1;
  nextState.updatedAt = new Date().toISOString();
  nextState.nodes = (nextState.nodes ?? []).map((node) => {
    const nextPosition = positions[node.id];
    if (!nextPosition) {
      return node;
    }

    return {
      ...node,
      position: {
        x: Math.round(nextPosition.x / 20) * 20,
        y: Math.round(nextPosition.y / 20) * 20
      }
    };
  });
  return nextState;
}

function computeFitViewViewport(nodes, screenFrameBox) {
  return computeViewportForBounds(resolveNodeBounds(nodes), screenFrameBox, {
    minZoom: 0.5,
    maxZoom: 2,
    padding: 0.05
  });
}

function computeFocusViewport(node, screenFrameBox) {
  return computeViewportForBounds(
    {
      x: node.position.x,
      y: node.position.y,
      width: node.size.width,
      height: node.size.height
    },
    screenFrameBox,
    {
      minZoom: 0.55,
      maxZoom: 1.15,
      padding: 0.22
    }
  );
}

function deriveFitViewViewportFromPayload(payload, screenFrameBox) {
  const nodes = getRecordingNodes(payload);
  return computeFitViewViewport(nodes, screenFrameBox);
}

function deriveFocusViewportFromPayload(payload, screenFrameBox, nodeId) {
  const node = findRequiredNode(getRecordingNodes(payload), nodeId);
  return computeFocusViewport(node, screenFrameBox);
}

function resolveNodeBounds(nodes) {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.width));
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.size.height));

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function computeViewportForBounds(bounds, screenFrameBox, options) {
  const width = screenFrameBox.width;
  const height = screenFrameBox.height;
  const xZoom = width / (bounds.width * (1 + options.padding));
  const yZoom = height / (bounds.height * (1 + options.padding));
  const zoom = clamp(Math.min(xZoom, yZoom), options.minZoom, options.maxZoom);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    x: width / 2 - centerX * zoom,
    y: height / 2 - centerY * zoom,
    zoom
  };
}

function createViewportForBoundsAndZoom(bounds, screenFrameBox, zoom) {
  const width = screenFrameBox.width;
  const height = screenFrameBox.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    x: width / 2 - centerX * zoom,
    y: height / 2 - centerY * zoom,
    zoom
  };
}

function resolveCanvasCreationPoint(screenFrameBox, ratios) {
  const insetX = 140;
  const insetY = 120;
  return {
    x: Math.round(clamp(screenFrameBox.width * ratios.x, insetX, screenFrameBox.width - insetX)),
    y: Math.round(clamp(screenFrameBox.height * ratios.y, insetY, screenFrameBox.height - insetY))
  };
}

function projectNodeRectToScreen(node, viewport, screenFrameBox) {
  return {
    x: screenFrameBox.x + viewport.x + node.position.x * viewport.zoom,
    y: screenFrameBox.y + viewport.y + node.position.y * viewport.zoom,
    width: node.size.width * viewport.zoom,
    height: node.size.height * viewport.zoom
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function positionsMatch(left, right) {
  return left?.x === right?.x && left?.y === right?.y;
}

function createCandidatePoints(basePoint, offsets) {
  return offsets.map(([offsetX, offsetY]) => ({
    x: basePoint.x + offsetX,
    y: basePoint.y + offsetY
  }));
}

function resolveNodeTitleInputCandidatePoints(rect, zoom) {
  const xFractions = [0.1, 0.18, 0.26, 0.34, 0.42];
  const yOffsets = [18, 26, 34];
  const points = [];

  for (const yOffset of yOffsets) {
    for (const xFraction of xFractions) {
      points.push({
        x: rect.x + rect.width * xFraction,
        y: rect.y + yOffset * zoom
      });
    }
  }

  return points;
}

function resolveNodeChromeFocusCandidatePoints(rect, zoom) {
  const xFractions = [0.46, 0.52, 0.58, 0.64];
  const yOffsets = [18, 26, 34];
  const points = [];

  for (const yOffset of yOffsets) {
    for (const xFraction of xFractions) {
      points.push({
        x: rect.x + rect.width * xFraction,
        y: rect.y + yOffset * zoom
      });
    }
  }

  return points;
}

function resolveExecutionInputCandidatePoints(rect, zoom) {
  const headerHeight = 42 * zoom;
  const bodyPadding = 12 * zoom;
  const bodyTop = rect.y + headerHeight + bodyPadding;
  const bodyBottom = rect.y + rect.height - bodyPadding;
  const midY = bodyTop + (bodyBottom - bodyTop) * 0.38;
  const lowerY = bodyTop + (bodyBottom - bodyTop) * 0.52;

  return [
    { x: rect.x + rect.width * 0.5, y: midY },
    { x: rect.x + rect.width * 0.56, y: midY },
    { x: rect.x + rect.width * 0.44, y: midY },
    { x: rect.x + rect.width * 0.5, y: lowerY }
  ];
}

async function connectToVSCodeBrowser(endpointUrl) {
  const deadline = Date.now() + CDP_CONNECT_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(endpointUrl);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new Error(
    `Timed out connecting to VS Code CDP endpoint ${endpointUrl}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function waitForCanvasSurface(browser, artifactsDir) {
  const deadline = Date.now() + CDP_CONNECT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const candidate = await findCanvasSurface(browser);
    if (candidate) {
      return candidate;
    }

    await dumpCDPTopology(browser, path.join(artifactsDir, 'cdp-topology.latest.json')).catch(() => {});
    await delay(250);
  }

  throw new Error('Timed out locating the Dev Session Canvas webview through CDP.');
}

async function findCanvasSurface(browser) {
  const contexts = browser.contexts();
  let fallbackCandidate;

  for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
    const context = contexts[contextIndex];
    const pages = context.pages();
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex];
      if (!page.url().includes('workbench.html')) {
        continue;
      }

      const iframeLocator = page.locator('iframe.webview.ready');
      const iframeCount = await iframeLocator.count().catch(() => 0);
      for (let iframeIndex = 0; iframeIndex < iframeCount; iframeIndex += 1) {
        const currentIframeLocator = iframeLocator.nth(iframeIndex);
        const box = await currentIframeLocator.boundingBox().catch(() => null);
        if (!box || box.width < 400 || box.height < 300) {
          continue;
        }

        const frameRoot = page.frameLocator('iframe.webview.ready').nth(iframeIndex);
        if (await rootHasCanvas(frameRoot)) {
          return {
            page,
            root: frameRoot,
            description: `${page.url()} :: iframe.webview.ready[${iframeIndex}]`,
            verified: true
          };
        }

        fallbackCandidate ??= {
          page,
          root: frameRoot,
          description: `${page.url()} :: iframe.webview.ready[${iframeIndex}] (fallback)`,
          verified: false
        };
      }

      for (const frame of page.frames()) {
        const root = frame;
        if (await rootHasCanvas(root)) {
          return {
            page,
            root,
            description: `${page.url()} :: ${frame.url() || '<main-frame>'}`,
            verified: true
          };
        }
      }
    }
  }

  return fallbackCandidate;
}

async function rootHasCanvas(root) {
  try {
    return (
      (await root.locator('.react-flow__pane').count()) > 0 &&
      (await root.locator('[data-node-id="note-1"]').count()) > 0
    );
  } catch {
    return false;
  }
}

async function dumpCDPTopology(browser, outputPath) {
  const topology = [];

  for (const [contextIndex, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      topology.push({
        contextIndex,
        pageIndex,
        pageUrl: page.url(),
        frames: page.frames().map((frame) => ({
          url: frame.url(),
          name: frame.name()
        }))
      });
    }
  }

  await fs.writeFile(outputPath, `${JSON.stringify(topology, null, 2)}\n`, 'utf8');
}

async function dumpCDPTargets(browser, outputPath) {
  const session = await browser.newBrowserCDPSession();
  try {
    const targets = await session.send('Target.getTargets');
    await fs.writeFile(outputPath, `${JSON.stringify(targets, null, 2)}\n`, 'utf8');
  } finally {
    await session.detach().catch(() => {});
  }
}

async function dumpWorkbenchDiagnostics(browser, outputPath) {
  const diagnostics = [];

  for (const [contextIndex, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      let iframeDetails = [];
      try {
        iframeDetails = await page.locator('iframe, webview').evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tagName: element.tagName,
              className: element.className,
              id: element.id,
              title: element.getAttribute('title'),
              name: element.getAttribute('name'),
              src: element.getAttribute('src'),
              partition: element.getAttribute('partition'),
              width: rect.width,
              height: rect.height,
              x: rect.x,
              y: rect.y
            };
          })
        );
      } catch (error) {
        iframeDetails = [
          {
            error: error instanceof Error ? error.message : String(error)
          }
        ];
      }

      diagnostics.push({
        contextIndex,
        pageIndex,
        pageUrl: page.url(),
        iframeDetails
      });
    }
  }

  await fs.writeFile(outputPath, `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');
}

async function openCanvasContextMenu(canvasSurface) {
  await clickInsidePane(canvasSurface, CANVAS_CONTEXT_MENU_POINT.x, CANVAS_CONTEXT_MENU_POINT.y, 'right');
}

async function clickCanvasContextMenuItem(canvasSurface, target) {
  const selector = resolveCanvasContextMenuItemSelector(target);
  await clickLocator(canvasSurface, selector);
}

function resolveCanvasContextMenuItemSelector(target) {
  switch (target) {
    case 'create-agent-default':
      return '[data-context-menu-agent-action="create-default"]';
    case 'show-agent-providers':
      return '[data-context-menu-agent-action="show-providers"]';
    case 'create-agent-codex':
      return '[data-context-menu-provider="codex"]';
    case 'create-agent-claude':
      return '[data-context-menu-provider="claude"]';
    case 'create-terminal':
      return '[data-context-menu-kind="terminal"]';
    case 'create-note':
      return '[data-context-menu-kind="note"]';
    case 'back':
      return '[data-context-menu-back="true"]';
    case 'dismiss':
      return '.canvas-context-menu-dismiss';
    default:
      throw new Error(`Unsupported canvas context menu target: ${target}`);
  }
}

async function clickCanvasControlButton(canvasSurface, label) {
  await clickLocator(canvasSurface, `.react-flow__controls-button[aria-label="${label}"]`);
}

async function renameNodeTitle(canvasSurface, nodeId, nextTitle) {
  const titleLocator = canvasSurface.root.locator(
    `[data-node-id="${nodeId}"] [data-probe-field="title"]`
  );
  await titleLocator.waitFor({ state: 'visible', timeout: 5000 });
  await clickLocator(canvasSurface, `[data-node-id="${nodeId}"] [data-probe-field="title"]`);
  await canvasSurface.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await canvasSurface.page.keyboard.type(nextTitle, { delay: 45 });
  await canvasSurface.page.keyboard.press('Enter');
}

async function doubleClickNodeChrome(canvasSurface, nodeId) {
  const chromeBox = await getBoundingBox(
    canvasSurface.root.locator(`[data-node-id="${nodeId}"] .window-chrome, [data-node-id="${nodeId}"] .node-topline`)
  );
  const titleBox = await getOptionalBoundingBox(
    canvasSurface.root.locator(`[data-node-id="${nodeId}"] [data-probe-field="title"]`)
  );
  const actionsBox = await getOptionalBoundingBox(
    canvasSurface.root.locator(`[data-node-id="${nodeId}"] .window-chrome-actions`)
  );

  const leftEdge = titleBox ? titleBox.x + titleBox.width + 12 : chromeBox.x + chromeBox.width * 0.48;
  const rightEdge = actionsBox ? actionsBox.x - 12 : chromeBox.x + chromeBox.width * 0.72;
  const targetX =
    rightEdge > leftEdge ? (leftEdge + rightEdge) / 2 : chromeBox.x + chromeBox.width * 0.6;
  const targetY = chromeBox.y + chromeBox.height / 2;
  await clickPoint(canvasSurface.page, targetX, targetY, 'left', 2);
}

async function typeExecutionInput(canvasSurface, nodeId, input) {
  const selector = `[data-node-id="${nodeId}"] .terminal-frame.is-live`;
  const locator = canvasSurface.root.locator(selector);
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  const box = await getBoundingBox(locator);
  await clickPoint(canvasSurface.page, box.x + box.width / 2, box.y + box.height / 2);
  await delay(120);
  await canvasSurface.page.keyboard.type(input, { delay: 80 });
  await canvasSurface.page.keyboard.press('Enter');
}

async function clickInsidePane(canvasSurface, relativeX, relativeY, button = 'left') {
  const paneBox = await getBoundingBox(canvasSurface.root.locator('.react-flow__pane'));
  const targetX = paneBox.x + Math.min(Math.max(relativeX, 24), paneBox.width - 24);
  const targetY = paneBox.y + Math.min(Math.max(relativeY, 24), paneBox.height - 24);
  await clickPoint(canvasSurface.page, targetX, targetY, button);
}

async function clickLocator(canvasSurface, selector) {
  const locator = canvasSurface.root.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  const box = await getBoundingBox(locator);
  await clickPoint(canvasSurface.page, box.x + box.width / 2, box.y + box.height / 2);
}

async function clickPoint(page, x, y, button = 'left', clickCount = 1) {
  await page.mouse.move(x, y, { steps: 10 });
  if (clickCount === 2) {
    await page.mouse.dblclick(x, y, { button });
    return;
  }

  await page.mouse.click(x, y, { button });
}

async function waitForNodeCount(canvasSurface, count, timeoutMs) {
  await waitForCondition(
    async () => (await canvasSurface.root.locator('[data-node-id]').count()) === count,
    timeoutMs,
    `node count ${count}`
  );
}

async function waitForLiveExecutionNode(canvasSurface, nodeId, timeoutMs) {
  await canvasSurface.root
    .locator(`[data-node-id="${nodeId}"] .terminal-frame.is-live`)
    .waitFor({ state: 'visible', timeout: timeoutMs });
}

async function waitForNodeTitle(canvasSurface, nodeId, title, timeoutMs) {
  const locator = canvasSurface.root.locator(`[data-node-id="${nodeId}"] [data-probe-field="title"]`);
  await waitForCondition(async () => (await locator.inputValue()) === title, timeoutMs, `node ${nodeId} title ${title}`);
}

async function waitForNodeText(canvasSurface, nodeId, snippet, timeoutMs) {
  const locator = canvasSurface.root.locator(`[data-node-id="${nodeId}"]`);
  await waitForCondition(
    async () => String((await locator.textContent()) ?? '').includes(snippet),
    timeoutMs,
    `node ${nodeId} text ${snippet}`
  );
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await delay(120);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function getBoundingBox(locator) {
  const handle = await locator.elementHandle();
  if (!handle) {
    throw new Error('Failed to resolve element handle for mouse interaction.');
  }

  const box = await handle.boundingBox();
  if (!box) {
    throw new Error('Failed to resolve element bounds for mouse interaction.');
  }

  return box;
}

async function getOptionalBoundingBox(locator) {
  const handle = await locator.elementHandle();
  if (!handle) {
    return undefined;
  }

  return handle.boundingBox();
}

async function resolveScreenPointForLocator(canvasSurface, screenFrameBox, selector) {
  const locator = canvasSurface.root.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 1200 });
  const box = await getBoundingBox(locator);
  const windowOffsetX = screenFrameBox.x - screenFrameBox.pageX;
  const windowOffsetY = screenFrameBox.y - screenFrameBox.pageY;
  return {
    x: windowOffsetX + box.x + box.width / 2,
    y: windowOffsetY + box.y + box.height / 2
  };
}

async function resolveNodeChromeScreenCandidatePoints(canvasSurface, screenFrameBox, nodeId) {
  const chromeBox = await getBoundingBox(
    canvasSurface.root.locator(`[data-node-id="${nodeId}"] .window-chrome, [data-node-id="${nodeId}"] .node-topline`)
  );
  const titleBox = await getOptionalBoundingBox(
    canvasSurface.root.locator(
      `[data-node-id="${nodeId}"] [data-probe-field="title"], [data-node-id="${nodeId}"] .node-topline strong`
    )
  );
  const actionsBox = await getOptionalBoundingBox(
    canvasSurface.root.locator(`[data-node-id="${nodeId}"] .window-chrome-actions`)
  );
  const windowOffsetX = screenFrameBox.x - screenFrameBox.pageX;
  const windowOffsetY = screenFrameBox.y - screenFrameBox.pageY;
  const chromeCenterY = chromeBox.y + chromeBox.height / 2;
  const leftEdge = titleBox ? titleBox.x + titleBox.width + 18 : chromeBox.x + chromeBox.width * 0.4;
  const rightEdge = actionsBox ? actionsBox.x - 18 : chromeBox.x + chromeBox.width * 0.72;
  const gapWidth = rightEdge - leftEdge;
  const localXCandidates =
    gapWidth > 30
      ? [leftEdge + gapWidth * 0.35, leftEdge + gapWidth * 0.5, leftEdge + gapWidth * 0.65]
      : [chromeBox.x + chromeBox.width * 0.5, chromeBox.x + chromeBox.width * 0.58];
  const localYCandidates = [
    chromeCenterY,
    chromeBox.y + chromeBox.height * 0.38,
    chromeBox.y + chromeBox.height * 0.62
  ];
  const screenPoints = [];

  for (const y of localYCandidates) {
    for (const x of localXCandidates) {
      screenPoints.push({
        x: windowOffsetX + x,
        y: windowOffsetY + y
      });
    }
  }

  return dedupeScreenPoints(screenPoints);
}

async function resolveCanvasBlankScreenCandidatePoints(canvasSurface, screenFrameBox, fallbackPoint) {
  const relativePoints = await canvasSurface.root.locator('.react-flow__pane').evaluate((pane, fallback) => {
    const paneRect = pane.getBoundingClientRect();
    const nodeRects = Array.from(document.querySelectorAll('.react-flow__node')).map((element) =>
      element.getBoundingClientRect()
    );
    const candidates = [
      { x: 96, y: 96 },
      { x: 96, y: paneRect.height - 96 },
      { x: paneRect.width - 96, y: 96 },
      { x: paneRect.width - 96, y: paneRect.height - 96 },
      { x: paneRect.width * 0.5, y: 96 },
      { x: paneRect.width * 0.5, y: paneRect.height - 96 },
      { x: 96, y: paneRect.height * 0.5 },
      { x: paneRect.width - 96, y: paneRect.height * 0.5 },
      { x: fallback?.x ?? 120, y: fallback?.y ?? 120 }
    ];
    const clampCandidate = (candidate) => ({
      x: Math.min(Math.max(candidate.x, 24), paneRect.width - 24),
      y: Math.min(Math.max(candidate.y, 24), paneRect.height - 24)
    });
    const isClear = (candidate) =>
      nodeRects.every(
        (rect) =>
          candidate.x < rect.left - paneRect.left - 18 ||
          candidate.x > rect.right - paneRect.left + 18 ||
          candidate.y < rect.top - paneRect.top - 18 ||
          candidate.y > rect.bottom - paneRect.top + 18
      );

    const ranked = candidates
      .map((candidate) => clampCandidate(candidate))
      .map((candidate) => ({
        ...candidate,
        clear: isClear(candidate)
      }))
      .sort((left, right) => Number(right.clear) - Number(left.clear));

    const deduped = [];
    for (const candidate of ranked) {
      if (!deduped.some((existing) => existing.x === candidate.x && existing.y === candidate.y)) {
        deduped.push(candidate);
      }
    }

    return deduped;
  }, fallbackPoint);

  return relativePoints.map((relativePoint) => ({
    x: relativePoint.x,
    y: relativePoint.y,
    screenX: screenFrameBox.x + relativePoint.x,
    screenY: screenFrameBox.y + relativePoint.y
  }));
}

function resolveCanvasPaneFallbackCandidatePoints(screenFrameBox, fallbackPoint) {
  const relativeCandidates = [
    fallbackPoint,
    { x: 96, y: screenFrameBox.height - 96 },
    { x: screenFrameBox.width - 96, y: 96 },
    { x: screenFrameBox.width - 96, y: screenFrameBox.height - 96 },
    { x: Math.round(screenFrameBox.width * 0.5), y: 96 },
    { x: Math.round(screenFrameBox.width * 0.5), y: screenFrameBox.height - 96 }
  ];

  const deduped = [];
  for (const candidate of relativeCandidates) {
    const clamped = {
      x: Math.min(Math.max(candidate.x, 24), screenFrameBox.width - 24),
      y: Math.min(Math.max(candidate.y, 24), screenFrameBox.height - 24)
    };
    if (!deduped.some((existing) => existing.x === clamped.x && existing.y === clamped.y)) {
      deduped.push(clamped);
    }
  }

  return deduped.map((candidate) => ({
    ...candidate,
    screenX: screenFrameBox.x + candidate.x,
    screenY: screenFrameBox.y + candidate.y
  }));
}

function dedupeScreenPoints(points) {
  const deduped = [];
  for (const point of points) {
    const roundedPoint = {
      x: Math.round(point.x),
      y: Math.round(point.y)
    };
    if (!deduped.some((existing) => existing.x === roundedPoint.x && existing.y === roundedPoint.y)) {
      deduped.push(roundedPoint);
    }
  }

  return deduped;
}

async function waitForCanvasContextMenuVisible(canvasSurface, timeoutMs) {
  await canvasSurface.root.locator('[data-context-menu="true"]').waitFor({
    state: 'visible',
    timeout: timeoutMs
  });
  return true;
}

async function appendInteractionLog(entry) {
  await fs.mkdir(path.dirname(interactionLogPath), { recursive: true });
  await fs.appendFile(
    interactionLogPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
    'utf8'
  );
}

async function appendRecordingControlCommand(controlFilePath, command) {
  if (!controlFilePath) {
    throw new Error('Missing recording control file path.');
  }

  await fs.mkdir(path.dirname(controlFilePath), { recursive: true });
  await fs.appendFile(controlFilePath, `${JSON.stringify(command)}\n`, 'utf8');
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, CDP_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve a free localhost port for VS Code CDP.'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function mirrorChildOutput(stream, destination) {
  if (!stream) {
    return;
  }

  stream.on('data', (chunk) => {
    destination.write(chunk);
  });
}

async function waitForDevToolsEndpoint(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the VS Code DevTools websocket endpoint.'));
    }, timeoutMs);

    const handleChunk = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (!match) {
        return;
      }

      cleanup();
      resolve(match[1]);
    };

    const handleExit = () => {
      cleanup();
      reject(new Error('VS Code exited before reporting its DevTools websocket endpoint.'));
    };

    const cleanup = () => {
      clearTimeout(deadline);
      child.stdout?.removeListener('data', handleChunk);
      child.stderr?.removeListener('data', handleChunk);
      child.removeListener('exit', handleExit);
      child.removeListener('error', handleExit);
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);
    child.on('exit', handleExit);
    child.on('error', handleExit);
  });
}

function ensureCommandAvailable(command, args, errorMessage) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'ignore'
  });

  if (result.error || result.status !== 0) {
    throw new Error(errorMessage);
  }
}

function runNodeCommand(args, errorMessage) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

function resolveSharedRepoRoot() {
  const gitPath = path.join(projectRoot, '.git');
  if (!existsSync(gitPath)) {
    return projectRoot;
  }

  try {
    if (statSync(gitPath).isDirectory()) {
      return path.dirname(gitPath);
    }

    const gitFile = readFileSync(gitPath, 'utf8');
    const match = gitFile.match(/^gitdir:\s*(.+)\s*$/m);
    if (!match) {
      return projectRoot;
    }

    const gitDir = path.resolve(projectRoot, match[1]);
    const commonDirFile = path.join(gitDir, 'commondir');
    if (!existsSync(commonDirFile)) {
      return path.dirname(gitDir);
    }

    const commonDir = readFileSync(commonDirFile, 'utf8').trim();
    if (!commonDir) {
      return path.dirname(gitDir);
    }

    return path.dirname(path.resolve(gitDir, commonDir));
  } catch {
    return projectRoot;
  }
}

function configureVSCodeTestCache(repoRoot) {
  const configuredPath =
    process.env.DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH?.trim() ||
    path.join(repoRoot, '.debug', 'vscode-test-cache');
  process.env.DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH = configuredPath;
  return configuredPath;
}

function resolveMarketplaceCommand({ envKey, fallbackPaths, binName }) {
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const whichResult = spawnSync('bash', ['-lc', `command -v ${binName}`], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (whichResult.status === 0) {
    const resolved = whichResult.stdout.trim();
    if (resolved) {
      return resolved;
    }
  }

  for (const candidate of fallbackPaths) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Missing Marketplace command for ${binName}. Set ${envKey} to a valid executable path.`);
}

async function writeMarketplaceCommandShim({ runtime, name, targetCommand, prependPathEntries = [] }) {
  const shimDir = path.join(runtime.debugRoot, 'bin');
  const shimPath = path.join(shimDir, `${name}.sh`);
  const normalizedTargetCommand = targetCommand.trim();
  const pathValue = prependPathEntriesToPath(prependPathEntries, process.env.PATH);

  await fs.mkdir(shimDir, { recursive: true });
  await fs.writeFile(
    shimPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `export PATH=${quoteShellValue(pathValue)}`,
      `exec ${quoteShellValue(normalizedTargetCommand)} "$@"`
    ].join('\n') + '\n',
    'utf8'
  );
  await fs.chmod(shimPath, 0o755);
  return shimPath;
}

function prependPathEntriesToPath(entries, existingPath) {
  const seen = new Set();
  const segments = [];

  for (const entry of [...entries, ...(existingPath?.split(path.delimiter) ?? [])]) {
    const normalizedEntry = entry?.trim();
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }

    seen.add(normalizedEntry);
    segments.push(normalizedEntry);
  }

  return segments.join(path.delimiter);
}

function quoteShellValue(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function findCachedVSCodeExecutablePath(cachePath) {
  const entries = await fs.readdir(cachePath, { withFileTypes: true }).catch(() => []);
  const candidateDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('vscode-'))
    .map((entry) => path.join(cachePath, entry.name))
    .sort()
    .reverse();

  for (const candidateDir of candidateDirs) {
    const executablePath = resolveVSCodeExecutablePath(candidateDir);
    try {
      await fs.access(executablePath);
      return executablePath;
    } catch {
      // Try the next cached installation.
    }
  }

  return undefined;
}

function resolveVSCodeExecutablePath(installDir) {
  if (process.platform === 'win32') {
    return path.join(installDir, 'Code.exe');
  }

  if (process.platform === 'darwin') {
    return path.join(installDir, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron');
  }

  return path.join(installDir, 'code');
}

async function startXvfb() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'Xvfb',
      ['-screen', '0', `${DISPLAY_SIZE.width}x${DISPLAY_SIZE.height}x24`, '-ac', '-displayfd', '1'],
      {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const match = stdoutBuffer.match(/(\d+)\s*$/m);
      if (!settled && match) {
        settled = true;
        resolve({
          display: `:${match[1]}`,
          process: child
        });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 4000) {
        stderrBuffer = stderrBuffer.slice(-4000);
      }
    });

    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        const details = stderrBuffer.trim();
        reject(
          new Error(
            details
              ? `Xvfb exited before reporting a display number (code ${code}).\n${details}`
              : `Xvfb exited before reporting a display number (code ${code}).`
          )
        );
      }
    });
  });
}

async function stopXvfb(child) {
  if (child.killed) {
    return;
  }

  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 2000).unref();
  });
}

async function hydrateMarketplaceProviderRuntime(runtime) {
  const realHomeDir = process.env.HOME?.trim();
  if (!realHomeDir) {
    return;
  }

  await copyFileIfPresent(
    path.join(realHomeDir, '.codex', 'auth.json'),
    path.join(runtime.homeDir, '.codex', 'auth.json')
  );
  await copyFileIfPresent(
    path.join(realHomeDir, '.codex', 'config.toml'),
    path.join(runtime.homeDir, '.codex', 'config.toml')
  );
  await copyFileIfPresent(
    path.join(realHomeDir, '.claude.json'),
    path.join(runtime.homeDir, '.claude.json')
  );
  await copyFileIfPresent(
    path.join(realHomeDir, '.claude', 'settings.json'),
    path.join(runtime.homeDir, '.claude', 'settings.json')
  );
}

async function copyFileIfPresent(sourcePath, destinationPath) {
  try {
    await fs.access(sourcePath);
  } catch {
    return;
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function waitForFileOrChildExit(child, filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      if (child.exitCode !== null) {
        throw new Error(`VS Code test process exited before writing ready file (code ${child.exitCode}).`);
      }
      if (child.signalCode) {
        throw new Error(`VS Code test process exited before writing ready file (signal ${child.signalCode}).`);
      }
      await delay(200);
    }
  }

  throw new Error(`Timed out waiting for file: ${filePath}`);
}

async function waitForVSCodeWindowGeometry(display, outputRoot) {
  const deadline = Date.now() + 30000;
  let lastTree = '';

  while (Date.now() < deadline) {
    const result = spawnSync('xwininfo', ['-display', display, '-root', '-tree'], {
      cwd: projectRoot,
      encoding: 'utf8'
    });
    if (!result.error && result.status === 0) {
      lastTree = result.stdout;
      const geometry = parseVSCodeWindowGeometry(result.stdout);
      if (geometry) {
        return geometry;
      }
    }

    await delay(300);
  }

  if (lastTree) {
    await fs.writeFile(path.join(outputRoot, 'xwininfo-root-tree.txt'), lastTree, 'utf8');
  }
  throw new Error('Timed out waiting for the real VS Code window geometry.');
}

function parseVSCodeWindowGeometry(treeOutput) {
  const lines = treeOutput.split('\n');
  const candidates = [];

  for (const line of lines) {
    if (!WINDOW_TITLE_PATTERN.test(line)) {
      continue;
    }

    const match = line.match(/^\s*(0x[0-9a-f]+)\s+"([^"]+)".*?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/i);
    if (!match) {
      continue;
    }

    const width = Number(match[3]);
    const height = Number(match[4]);
    const x = Number(match[5]);
    const y = Number(match[6]);
    if (width < 900 || height < 600) {
      continue;
    }

    candidates.push({
      id: match[1],
      title: match[2],
      x,
      y,
      width,
      height,
      area: width * height
    });
  }

  candidates.sort((left, right) => right.area - left.area);
  return candidates[0];
}

async function startWindowRecorder(display, geometry, outputPath) {
  const recorder = spawn(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'x11grab',
      '-draw_mouse',
      '1',
      '-framerate',
      '30',
      '-video_size',
      `${geometry.width}x${geometry.height}`,
      '-i',
      `${display}+${geometry.x},${geometry.y}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      outputPath
    ],
    {
      cwd: projectRoot,
      stdio: ['pipe', 'inherit', 'inherit']
    }
  );

  await delay(300);
  if (recorder.exitCode !== null) {
    throw new Error(`ffmpeg recorder exited early with code ${recorder.exitCode}.`);
  }

  return recorder;
}

async function stopWindowRecorder(recorder) {
  if (!recorder || recorder.exitCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;

    const finalize = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(sigintTimer);
      clearTimeout(sigkillTimer);
      recorder.removeListener('error', handleError);
      recorder.removeListener('exit', handleExit);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const handleError = (error) => finalize(error);
    const handleExit = (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        finalize();
        return;
      }

      finalize(
        new Error(
          signal
            ? `Recorder terminated with signal ${signal}.`
            : `Recorder exited with code ${code}.`
        )
      );
    };

    const sigintTimer = setTimeout(() => {
      if (recorder.exitCode === null) {
        recorder.kill('SIGINT');
      }
    }, 2000);
    const sigkillTimer = setTimeout(() => {
      if (recorder.exitCode === null) {
        recorder.kill('SIGKILL');
      }
    }, 5000);

    recorder.once('error', handleError);
    recorder.once('exit', handleExit);

    if (recorder.stdin?.writable) {
      recorder.stdin.write('q');
      recorder.stdin.end();
      return;
    }

    recorder.kill('SIGINT');
  });
}

function extractScreenshotFromVideo(inputVideoPath, outputPath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-sseof',
      `-${SCREENSHOT_FROM_END_SECONDS}`,
      '-i',
      inputVideoPath,
      '-frames:v',
      '1',
      outputPath
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit'
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error('从录制视频导出 Marketplace PNG 失败。');
  }
}

function composeGifFromVideo(inputVideoPath, outputPath) {
  const filter =
    `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];` +
    '[s0]palettegen=stats_mode=diff[p];' +
    '[s1][p]paletteuse=dither=sierra2_4a';
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputVideoPath,
      '-vf',
      filter,
      '-loop',
      '0',
      outputPath
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit'
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error('ffmpeg 合成真实 VS Code GIF 失败。');
  }
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode === 0) {
    return;
  }
  if (child.exitCode !== null) {
    throw new Error(`VS Code test process exited with code ${child.exitCode}.`);
  }
  if (child.signalCode) {
    throw new Error(`VS Code test process terminated with signal ${child.signalCode}.`);
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for VS Code test process to exit.'));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `VS Code test process terminated with signal ${signal}.`
            : `VS Code test process exited with code ${code}.`
        )
      );
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
