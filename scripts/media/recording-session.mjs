#!/usr/bin/env node

/**
 * recording-session.mjs — AI 驱动录制的工具脚本
 *
 * 用法:
 *   node scripts/media/recording-session.mjs start          — 启动录制环境（后台）
 *   node scripts/media/recording-session.mjs screenshot     — 截取当前画面
 *   node scripts/media/recording-session.mjs locate <selector> [--frame canvas|workbench]  — 定位元素返回屏幕坐标
 *   node scripts/media/recording-session.mjs click <x> <y> [--right] [--double]
 *   node scripts/media/recording-session.mjs key <combo>    — 按键（Return, Escape, Ctrl+A, Shift+Insert）
 *   node scripts/media/recording-session.mjs paste <text>   — 剪贴板粘贴
 *   node scripts/media/recording-session.mjs command <cmd> [json_args] — legacy test-host only
 *   node scripts/media/recording-session.mjs dispatch <json_message>   — legacy test-host only
 *   node scripts/media/recording-session.mjs state          — 读取画布状态
 *   node scripts/media/recording-session.mjs gif-frame <label> [durationMs]
 *   node scripts/media/recording-session.mjs stop           — 停止录制，生成媒体文件
 */

import path from 'path';
import net from 'net';
import { spawn, spawnSync } from 'child_process';
import { createWriteStream, existsSync, readFileSync, writeFileSync, readdirSync, promises as fs } from 'fs';
import { chromium } from 'playwright';

import {
  buildVSCodeChildEnv,
  ensureVSCodeExecutable,
  prepareRuntime
} from '../smoke/vscode-smoke-runner.mjs';
import { prepareDebugMainOnlyExtension } from '../shared/prepare-debug-main-only-extension.mjs';

const projectRoot = process.cwd();
const debugRoot = path.join(projectRoot, '.debug', 'marketplace-media');
const sessionFile = path.join(debugRoot, 'recording-session.json');
const outputDir = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas', 'images', 'marketplace');
const nativeInputScriptPath = path.join(projectRoot, 'scripts', 'media', 'x11-native-input.py');
const GIF_WIDTH = 1180;
const clipDir = path.join(debugRoot, 'clips');
const providerBinDir = path.join(debugRoot, 'provider-bin');
const DISPLAY_SIZE = { width: 1720, height: 1180 };
const WINDOW_TITLE_PATTERN = /(Extension Development Host|Visual Studio Code|Code - OSS)/i;
const CDP_HOST = '127.0.0.1';
const START_TIMEOUT_MS = 180000;
const CANVAS_READY_TIMEOUT_MS = 60000;
const OPEN_CANVAS_IN_PANEL_COMMAND_TITLE = 'Dev Session Canvas: 在面板打开画布';
const ACTIVITY_BAR_CANVAS_SELECTORS = [
  '.activitybar [aria-label*="Dev Session Canvas"]',
  '.activitybar [title*="Dev Session Canvas"]',
  '.activitybar [id*="devSessionCanvas"]',
  '.activitybar [class*="devSessionCanvas"]'
];
const SIDEBAR_OPEN_CANVAS_BUTTON_SELECTOR = 'button[data-action="openCanvas"]';

function readSession() {
  if (!existsSync(sessionFile)) {
    throw new Error('录制会话未启动。请先运行: node scripts/media/recording-session.mjs start');
  }
  return JSON.parse(readFileSync(sessionFile, 'utf8'));
}

function updateSession(patch) {
  const session = readSession();
  Object.assign(session, patch);
  writeFileSync(sessionFile, JSON.stringify(session, null, 2) + '\n', 'utf8');
  return session;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStart() {
  const logPath = path.join(projectRoot, '.debug', 'marketplace-media-session-output.log');
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.rm(logPath, { force: true });
  await fs.rm(sessionFile, { force: true });
  await fs.rm(clipDir, { recursive: true, force: true });
  await fs.rm(path.join(debugRoot, 'gif-storyboard'), { recursive: true, force: true });
  console.log('启动交互录制环境...');

  ensureCommandAvailable('Xvfb', ['-help'], '缺少 Xvfb，无法启动真实 VS Code 录制环境。');
  ensureCommandAvailable('which', ['xfwm4'], '缺少 xfwm4，无法在 Xvfb 中稳定摆放 VS Code 原生 modal。');
  ensureCommandAvailable('xwininfo', ['-version'], '缺少 xwininfo，无法定位 VS Code 窗口。');
  ensureCommandAvailable('ffmpeg', ['-version'], '缺少 ffmpeg，无法截图或录制。');
  ensureCommandAvailable('xsel', ['--help'], '缺少 xsel，无法通过 X11 剪贴板粘贴文本。');
  runNodeCommand(['scripts/build/build.mjs'], '构建扩展 bundle 失败。');

  const runtime = await prepareRuntime({
    debugRoot,
    runtimeDirName: 'dsc-marketplace-media-recording',
    userSettings: {
      'security.workspace.trust.enabled': false,
      'window.commandCenter': false,
      'editor.minimap.enabled': false,
      'workbench.colorTheme': 'Default Dark Modern',
      'workbench.panel.defaultLocation': 'bottom',
      'workbench.panel.opensMaximized': 'always',
      'devSessionCanvas.canvas.defaultSurface': 'panel',
      'devSessionCanvas.files.enabled': true,
      'devSessionCanvas.files.presentationMode': 'nodes',
      'devSessionCanvas.fileNode.displayStyle': 'minimal',
      'devSessionCanvas.files.nodeDisplayMode': 'icon-path'
    }
  });
  const providerBinPath = await prepareRecordingProviderBin();
  const extensionDevelopmentPath = await prepareDebugMainOnlyExtension({
    outputDir: path.join(runtime.debugRoot, 'extension-main-only')
  });
  const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);
  const screenshotDir = path.join(debugRoot, 'screenshots');
  const gifFrameDir = path.join(debugRoot, 'gif-storyboard', 'frames');
  const donePath = path.join(debugRoot, 'recording-done.ack');
  const statePath = path.join(debugRoot, 'recording-state.json');
  const controlPath = path.join(debugRoot, 'recording-control.ndjson');
  const logStream = createWriteStream(logPath, { flags: 'a' });
  let display;
  let windowManager;
  let child;
  let browser;
  let geometry;
  const writeLog = (chunk) => logStream.write(chunk);
  try {
    display = await startXvfb();
    windowManager = await startWindowManager(display.display);
    const cdpPort = await findFreePort();
    await fs.mkdir(screenshotDir, { recursive: true });
    await fs.mkdir(gifFrameDir, { recursive: true });
    await fs.rm(donePath, { force: true });
    await fs.rm(statePath, { force: true });
    await fs.rm(controlPath, { force: true });

    const args = buildRecordingVSCodeArgs({
      workspacePath: projectRoot,
      extensionDevelopmentPath,
      userDataDir: runtime.userDataDir,
      extensionsDir: runtime.extensionsDir,
      cdpPort
    });
    const env = buildVSCodeChildEnv({
      ...runtime.environment,
      DISPLAY: display.display,
      TERM: 'xterm-256color',
      PATH: `${providerBinPath}${path.delimiter}${runtime.environment.PATH ?? process.env.PATH ?? ''}`
    });
    child = spawn(vscodeExecutablePath, args, {
      cwd: projectRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    child.stdout?.on('data', writeLog);
    child.stderr?.on('data', writeLog);
    const devToolsEndpointPromise = waitForDevToolsEndpoint(child, START_TIMEOUT_MS);
    child.stdout?.unref?.();
    child.stderr?.unref?.();
    child.unref();

    const devToolsEndpoint = await devToolsEndpointPromise;
    browser = await connectToVSCodeBrowser(devToolsEndpoint);
    geometry = await waitForVSCodeWindowGeometry(display.display, debugRoot);
    await openCanvasInPanel(display.display, geometry, browser);
    await waitForCanvasReady(browser, CANVAS_READY_TIMEOUT_MS);

    await fs.writeFile(sessionFile, `${JSON.stringify({
      mode: 'real-extension-host',
      display: display.display,
      geometry,
      statePath,
      controlPath,
      donePath,
      cdpEndpoint: devToolsEndpoint,
      userDataDir: runtime.userDataDir,
      workspaceStorageRoot: path.join(runtime.userDataDir, 'User', 'workspaceStorage'),
      gifFrameDir,
      screenshotDir,
      childPid: child.pid,
      xvfbPid: display.process.pid,
      wmPid: windowManager.pid
    }, null, 2)}\n`, 'utf8');
    unrefChildProcess(display.process);
    unrefChildProcess(windowManager);
    console.log('✓ 真实 VS Code 录制环境就绪');
    console.log(`  日志: ${logPath}`);
  } catch (error) {
    if (geometry) {
      captureFrame(display.display, geometry, path.join(debugRoot, 'startup-failure.png'));
    }
    if (child?.pid) {
      terminateDetachedProcessGroup(child.pid);
    }
    if (windowManager?.pid) {
      terminateDetachedProcessGroup(windowManager.pid);
    }
    if (display?.process) {
      stopXvfb(display.process).catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    child?.stdout?.removeListener('data', writeLog);
    child?.stderr?.removeListener('data', writeLog);
    logStream.end();
  }
}

function buildRecordingVSCodeArgs({
  workspacePath,
  extensionDevelopmentPath,
  userDataDir,
  extensionsDir,
  cdpPort
}) {
  return [
    workspacePath,
    '--log=trace',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--new-window',
    '--force-device-scale-factor=1',
    '--force-disable-user-env',
    `--remote-debugging-port=${cdpPort}`,
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`
  ];
}

async function openCanvasInPanel(display, geometry, browser) {
  const page = await waitForWorkbenchPage(browser, 30000);
  await delay(1500);
  const openedViaSidebar = await openCanvasInPanelViaSidebar(display, geometry, page);
  if (openedViaSidebar) {
    return;
  }
  await openCanvasInPanelViaCommandPalette(display, geometry, page);
}

async function openCanvasInPanelViaSidebar(display, geometry, page) {
  const activityBarBox = await waitForWorkbenchElementBox(page, ACTIVITY_BAR_CANVAS_SELECTORS, 30000);
  if (!activityBarBox) {
    return false;
  }

  nativeClickBox(display, geometry, activityBarBox);
  await delay(1500);

  const openCanvasButtonBox = await waitForWebviewElementBox(
    page,
    SIDEBAR_OPEN_CANVAS_BUTTON_SELECTOR,
    30000
  );
  if (!openCanvasButtonBox) {
    return false;
  }

  nativeClickBox(display, geometry, openCanvasButtonBox);
  await delay(1800);
  return true;
}

async function openCanvasInPanelViaCommandPalette(display, geometry, page) {
  runNativeOnDisplay(display, [
    'click',
    '--x',
    String(geometry.x + Math.round(geometry.width / 2)),
    '--y',
    String(geometry.y + Math.round(geometry.height / 2)),
    '--window-id',
    geometry.id
  ]);
  await delay(250);
  runNativeOnDisplay(display, ['key', '--combo', 'Ctrl+Shift+P', '--window-id', geometry.id]);
  await delay(500);
  setClipboardText(display, OPEN_CANVAS_IN_PANEL_COMMAND_TITLE);
  runNativeOnDisplay(display, ['key', '--combo', 'Shift+Insert', '--window-id', geometry.id]);
  const hasCommandMatch = await waitForCommandPaletteMatch(page, OPEN_CANVAS_IN_PANEL_COMMAND_TITLE, 10000);
  if (!hasCommandMatch) {
    throw new Error(`Command Palette did not list ${OPEN_CANVAS_IN_PANEL_COMMAND_TITLE}.`);
  }
  runNativeOnDisplay(display, ['key', '--combo', 'Return', '--window-id', geometry.id]);
  await delay(1500);
}

async function waitForCommandPaletteMatch(page, title, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await page
      .locator(`.quick-input-widget [aria-label*="${cssStringEscape(title)}"], .quick-input-widget [title*="${cssStringEscape(title)}"]`)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (matched) {
      return true;
    }
    await delay(200);
  }
  return false;
}

async function waitForWorkbenchPage(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes('workbench.html')) {
          return page;
        }
      }
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for the VS Code workbench page.');
}

async function waitForWorkbenchElementBox(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) {
        continue;
      }
      const box = await locator.boundingBox().catch(() => null);
      if (isUsableBox(box)) {
        return box;
      }
    }
    await delay(250);
  }
  return undefined;
}

async function waitForWebviewElementBox(page, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const iframes = page.locator('iframe.webview.ready');
    const iframeCount = await iframes.count().catch(() => 0);
    for (let iframeIndex = 0; iframeIndex < iframeCount; iframeIndex += 1) {
      const iframe = iframes.nth(iframeIndex);
      const iframeBox = await iframe.boundingBox().catch(() => null);
      if (!isUsableBox(iframeBox)) {
        continue;
      }
      const frameLocator = page.frameLocator('iframe.webview.ready').nth(iframeIndex);
      const locator = frameLocator.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) {
        continue;
      }
      const box = await locator.boundingBox().catch(() => null);
      if (isUsableBox(box)) {
        return box;
      }
    }
    await delay(250);
  }
  return undefined;
}

function nativeClickBox(display, geometry, box) {
  runNativeOnDisplay(display, [
    'click',
    '--x',
    String(geometry.x + box.x + box.width / 2),
    '--y',
    String(geometry.y + box.y + box.height / 2),
    '--window-id',
    geometry.id,
    '--move-duration-ms',
    '150'
  ]);
}

function isUsableBox(box) {
  return Boolean(box && box.width > 1 && box.height > 1);
}

function cssStringEscape(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function waitForCanvasReady(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const canvasFrame = await findCanvasFrame(browser);
    if (canvasFrame) {
      return canvasFrame;
    }
    await delay(300);
  }
  throw new Error('Timed out waiting for Dev Session Canvas webview in real VS Code host.');
}

async function findCanvasFrame(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!page.url().includes('workbench.html')) {
        continue;
      }
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) {
          continue;
        }
        const hasCanvas = await frame
          .locator('.canvas-shell, .react-flow, [data-node-id][data-node-kind]')
          .first()
          .count()
          .then((count) => count > 0)
          .catch(() => false);
        if (hasCanvas) {
          const frameElement = await frame.frameElement().catch(() => null);
          const box = await frameElement?.boundingBox().catch(() => null);
          return { page, frame, box };
        }
      }
      const canvasIframe = await findVisibleCanvasIframe(page);
      if (canvasIframe) {
        return { page, frame: canvasIframe.frame, box: canvasIframe.box };
      }
    }
  }
  return undefined;
}

async function findVisibleCanvasIframe(page) {
  const candidates = [];
  const iframes = page.locator('iframe.webview.ready[src*="extensionId=devsessioncanvas.dev-session-canvas"]');
  const count = await iframes.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const iframe = iframes.nth(index);
    const box = await iframe.boundingBox().catch(() => null);
    if (!box || box.width < 500 || box.height < 400) {
      continue;
    }
    const frameElement = await iframe.elementHandle().catch(() => null);
    const frame = await frameElement?.contentFrame().catch(() => null);
    if (frame) {
      candidates.push({ frame, box, area: box.width * box.height });
    }
  }
  candidates.sort((left, right) => right.area - left.area);
  return candidates[0];
}

async function cmdScreenshot() {
  const session = readSession();
  const outputPath = path.join(session.screenshotDir, `screenshot-${Date.now()}.png`);
  captureFrame(session.display, session.geometry, outputPath);
  console.log(outputPath);
}

async function cmdLocate(args) {
  const session = readSession();
  const frameIdx = args.indexOf('--frame');
  const useCanvas = frameIdx >= 0 && args[frameIdx + 1] === 'canvas';
  const selectorParts = args.filter((a, i) => !a.startsWith('--') && (frameIdx < 0 || (i !== frameIdx && i !== frameIdx + 1)));
  const selector = selectorParts.join(' ');

  const browser = await chromium.connectOverCDP(session.cdpEndpoint);
  try {
    let element;
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.url().includes('workbench.html')) continue;

        if (useCanvas) {
          const canvasFrame = await waitForCanvasReady(browser, 5000);
          const loc = canvasFrame.frame.locator(selector).first();
          const visible = await loc.isVisible({ timeout: 2000 }).catch(() => false);
          if (visible) {
            const elBox = await loc.boundingBox();
            if (elBox) {
              element = {
                x: session.geometry.x + elBox.x + elBox.width / 2,
                y: session.geometry.y + elBox.y + elBox.height / 2,
                width: elBox.width,
                height: elBox.height
              };
            }
          }
        } else {
          const loc = page.locator(selector).first();
          const visible = await loc.isVisible({ timeout: 2000 }).catch(() => false);
          if (visible) {
            const elBox = await loc.boundingBox();
            if (elBox) {
              element = {
                x: session.geometry.x + elBox.x + elBox.width / 2,
                y: session.geometry.y + elBox.y + elBox.height / 2,
                width: elBox.width,
                height: elBox.height
              };
            }
          }
        }
      }
    }

    if (element) {
      console.log(JSON.stringify(element));
    } else {
      console.error(`未找到: ${selector}`);
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

async function cmdClick(args) {
  const session = readSession();
  const x = parseFloat(args[0]);
  const y = parseFloat(args[1]);
  const nativeArgs = ['click', '--x', String(x), '--y', String(y), '--window-id', session.geometry.id];
  if (args.includes('--right')) nativeArgs.push('--button', 'right');
  if (args.includes('--double')) nativeArgs.push('--count', '2');
  nativeArgs.push('--move-duration-ms', '150');
  runNative(session.display, nativeArgs);
  await delay(150);
}

async function cmdKey(args) {
  const session = readSession();
  runNative(session.display, ['key', '--combo', args[0], '--window-id', session.geometry.id]);
}

async function cmdPaste(args) {
  const session = readSession();
  const text = args.join(' ');
  setClipboardText(session.display, text);
  await delay(100);
  runNative(session.display, ['key', '--combo', 'Shift+Insert', '--window-id', session.geometry.id]);
}

async function cmdCommand(args) {
  const session = readSession();
  if (session.mode === 'real-extension-host') {
    throw new Error('真实录制环境不支持 command；除场景初始化外请使用 click/key/paste 模拟用户操作。');
  }
  const cmd = { type: 'executeCommand', command: args[0] };
  if (args.length > 1) {
    try { cmd.args = JSON.parse(args.slice(1).join(' ')); } catch { cmd.args = args.slice(1); }
  }
  await fs.appendFile(session.controlPath, JSON.stringify(cmd) + '\n', 'utf8');
  await delay(300);
}

async function cmdDispatch(args) {
  const session = readSession();
  if (session.mode === 'real-extension-host') {
    throw new Error('真实录制环境不支持 dispatch；除场景初始化外请使用 click/key/paste 模拟用户操作。');
  }
  const message = JSON.parse(args.join(' '));
  await fs.appendFile(session.controlPath, JSON.stringify({ type: 'dispatchWebviewMessage', message }) + '\n', 'utf8');
  await delay(300);
}

async function cmdState() {
  const session = readSession();
  const raw = await fs.readFile(session.statePath, 'utf8').catch(() => '{}');
  const state = JSON.parse(raw);
  const persistedSnapshot =
    session.mode === 'real-extension-host' ? await readPersistedCanvasState(session) : undefined;
  const domSnapshot =
    session.mode === 'real-extension-host' && !persistedSnapshot
      ? await captureCanvasDomSnapshot(session)
      : undefined;
  const nodes = state?.debugSnapshot?.state?.nodes ?? persistedSnapshot?.nodes ?? domSnapshot?.nodes ?? [];
  const edges = state?.debugSnapshot?.state?.edges ?? persistedSnapshot?.edges ?? domSnapshot?.edges ?? [];
  console.log(`nodes: ${nodes.length}, edges: ${edges.length}`);
  for (const n of nodes) {
    const kind = n.kind ?? n.nodeKind ?? '-';
    const title = n.title ?? n.chromeTitle ?? '';
    const id = n.id ?? n.nodeId ?? '';
    console.log(`  ${kind.padEnd(10)} ${title.padEnd(25)} ${id.slice(0, 35)}`);
  }
  for (const e of edges) {
    const sourceNodeId = e.sourceNodeId ?? e.source ?? '';
    const targetNodeId = e.targetNodeId ?? e.target ?? '';
    console.log(`  edge: ${sourceNodeId.slice(0, 20)} → ${targetNodeId.slice(0, 20)} [${e.label ?? ''}] color=${e.color ?? '-'}`);
  }
}

async function readPersistedCanvasState(session) {
  const workspaceStorageRoots = [
    session.workspaceStorageRoot,
    session.userDataDir ? path.join(session.userDataDir, 'User', 'workspaceStorage') : undefined,
    path.join(debugRoot, 'user-data', 'User', 'workspaceStorage')
  ].filter(Boolean);

  const candidates = [];
  for (const workspaceStorageRoot of workspaceStorageRoots) {
    const entries = await fs.readdir(workspaceStorageRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const filePath = path.join(
        workspaceStorageRoot,
        entry.name,
        'devsessioncanvas.dev-session-canvas',
        'canvas-state.json'
      );
      const stats = await fs.stat(filePath).catch(() => null);
      if (stats?.isFile()) {
        candidates.push({ filePath, mtimeMs: stats.mtimeMs });
      }
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    const raw = await fs.readFile(candidate.filePath, 'utf8').catch(() => '');
    if (!raw) {
      continue;
    }
    const parsed = JSON.parse(raw);
    const snapshot = parsed?.state;
    if (Array.isArray(snapshot?.nodes) && Array.isArray(snapshot?.edges)) {
      return snapshot;
    }
  }
  return undefined;
}

async function captureCanvasDomSnapshot(session) {
  const browser = await chromium.connectOverCDP(session.cdpEndpoint);
  try {
    const canvasFrame = await waitForCanvasReady(browser, 5000);
    const nodes = await canvasFrame.frame
      .locator('[data-node-id][data-node-kind]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          nodeId: element.dataset.nodeId ?? '',
          kind: element.dataset.nodeKind ?? '',
          chromeTitle:
            element.querySelector('.window-title strong, .node-topline strong, .file-node-copy strong, .file-list-title-text')?.textContent?.trim() ??
            ''
        }))
      );
    const edges = await canvasFrame.frame
      .locator('[data-edge-probe="true"][data-edge-id][data-edge-source][data-edge-target]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          edgeId: element.dataset.edgeId ?? '',
          sourceNodeId: element.dataset.edgeSource ?? '',
          targetNodeId: element.dataset.edgeTarget ?? '',
          label: element.dataset.edgeLabel ?? '',
          color: element.dataset.edgeColor ?? ''
        }))
      );
    return { nodes, edges };
  } finally {
    await browser.close();
  }
}

async function cmdGifFrame(args) {
  const session = readSession();
  const label = args[0] ?? 'frame';
  const frameCount = (session.gifFrameCount ?? 0) + 1;
  const fileName = `${String(frameCount).padStart(2, '0')}-${label}.png`;
  const framePath = path.join(session.gifFrameDir, fileName);
  captureFrame(session.display, session.geometry, framePath);
  updateSession({ gifFrameCount: frameCount });
  console.log(`GIF frame #${frameCount}: ${fileName}`);
}

async function cmdRecordStart() {
  const session = readSession();
  if (session.currentClipPid) {
    console.error('已有片段在录制中，请先 record-stop');
    process.exit(1);
  }
  await fs.mkdir(clipDir, { recursive: true });
  const clipCount = (session.clipCount ?? 0) + 1;
  const clipPath = path.join(clipDir, `clip-${String(clipCount).padStart(3, '0')}.mp4`);
  const child = spawn('ffmpeg', [
    '-y', '-f', 'x11grab', '-framerate', '30',
    '-video_size', `${session.geometry.width}x${session.geometry.height}`,
    '-i', `${session.display}+${session.geometry.x},${session.geometry.y}`,
    '-draw_mouse', '1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', clipPath
  ], {
    env: { ...process.env, DISPLAY: session.display },
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true
  });
  child.unref();
  updateSession({ currentClipPid: child.pid, currentClipPath: clipPath, clipCount });
  await delay(300);
  console.log(`recording clip #${clipCount}: ${clipPath}`);
}

async function cmdRecordStop() {
  const session = readSession();
  if (!session.currentClipPid) {
    console.error('没有正在录制的片段');
    process.exit(1);
  }
  try { process.kill(session.currentClipPid, 'SIGINT'); } catch {}
  await delay(1500);
  updateSession({ currentClipPid: null, currentClipPath: null });
  console.log('clip stopped');
}

async function cmdStop() {
  const session = readSession();

  // Stop any active clip
  if (session.currentClipPid) {
    try { process.kill(session.currentClipPid, 'SIGINT'); } catch {}
    await delay(1500);
  }

  await fs.writeFile(session.donePath, 'done\n', 'utf8');
  console.log('已发送停止信号...');

  if (session.childPid) {
    terminateDetachedProcessGroup(session.childPid);
  }
  if (session.wmPid) {
    terminateDetachedProcessGroup(session.wmPid);
  }
  if (session.xvfbPid) {
    terminateProcess(session.xvfbPid);
  }
  await waitForProcessExit(session.childPid, 15000).catch(() => {});
  await waitForProcessExit(session.xvfbPid, 5000).catch(() => {});
  await waitForProcessExit(session.wmPid, 5000).catch(() => {});
  await fs.mkdir(outputDir, { recursive: true });

  // Concatenate clips into MP4
  await concatClips().catch((e) => console.error('MP4:', e.message));

  // Compose GIF
  await composeGif(session).catch((e) => console.error('GIF:', e.message));

  // Copy last GIF frame as PNG
  const frames = readdirSync(session.gifFrameDir).filter(f => f.endsWith('.png')).sort();
  if (frames.length > 0) {
    const lastFrame = path.join(session.gifFrameDir, frames[frames.length - 1]);
    await fs.copyFile(lastFrame, path.join(outputDir, 'canvas-overview.png'));
    console.log(`✓ PNG: ${path.join(outputDir, 'canvas-overview.png')}`);
  }

  console.log('✓ 录制完成');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function prepareRecordingProviderBin() {
  await fs.mkdir(providerBinDir, { recursive: true });

  const fakeClaudeProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-claude-provider');
  const wrapperPath = path.join(providerBinDir, 'claude');
  const wrapper = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ -n "${DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH:-}" && -z "${DEV_SESSION_CANVAS_FAKE_AGENT_FILE_EVENT_STREAM_PATH:-}" ]]; then',
    '  export DEV_SESSION_CANVAS_FAKE_AGENT_FILE_EVENT_STREAM_PATH="${DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH}"',
    'fi',
    'export DEV_SESSION_CANVAS_FAKE_PROVIDER_HIDE_PID="${DEV_SESSION_CANVAS_FAKE_PROVIDER_HIDE_PID:-1}"',
    `exec ${shellQuote(fakeClaudeProviderPath)} "$@"`,
    ''
  ].join('\n');
  await fs.writeFile(wrapperPath, wrapper, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(wrapperPath, 0o755);

  return providerBinDir;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runNative(display, args) {
  runNativeOnDisplay(display, args);
}

function unrefChildProcess(child) {
  child.stdout?.unref?.();
  child.stderr?.unref?.();
  child.unref?.();
}

function runNativeOnDisplay(display, args) {
  const r = spawnSync('python3', [nativeInputScriptPath, ...args], {
    env: { ...process.env, DISPLAY: display },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  });
  if (r.status !== 0) throw new Error(`Native input failed: ${r.stderr?.toString()?.slice(-200)}`);
}

function setClipboardText(display, text) {
  const result = spawnSync('xsel', ['--clipboard', '--input'], {
    input: text,
    env: {
      ...process.env,
      DISPLAY: display,
      HOME: path.join(debugRoot, 'home'),
      XDG_CACHE_HOME: path.join(debugRoot, 'cache')
    },
    stdio: ['pipe', 'ignore', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error(`Clipboard write failed: ${result.stderr?.toString()?.slice(-200)}`);
  }
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

async function connectToVSCodeBrowser(endpointUrl) {
  const deadline = Date.now() + 30000;
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

async function waitForDevToolsEndpoint(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the VS Code DevTools websocket endpoint.'));
    }, timeoutMs);
    const handleChunk = (chunk) => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);
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

async function startXvfb() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'Xvfb',
      ['-screen', '0', `${DISPLAY_SIZE.width}x${DISPLAY_SIZE.height}x24`, '-ac', '-displayfd', '1'],
      {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
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

async function startWindowManager(display) {
  const child = spawn('xfwm4', ['--replace', '--sm-client-disable'], {
    cwd: projectRoot,
    env: { ...process.env, DISPLAY: display },
    stdio: 'ignore',
    detached: true
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      cleanup();
      resolve();
    }, 1200);
    const handleExit = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`xfwm4 exited before the recording window was ready (code ${code}).`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', handleExit);
      child.removeListener('error', handleExit);
    };
    child.once('exit', handleExit);
    child.once('error', handleExit);
  });
  return child;
}

async function stopXvfb(child) {
  if (!child || child.killed) {
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
  const candidates = [];
  for (const line of treeOutput.split('\n')) {
    if (!WINDOW_TITLE_PATTERN.test(line)) {
      continue;
    }
    const match = line.match(/^\s*(0x[0-9a-f]+)\s+"([^"]+)".*?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)(?:\s+\+(-?\d+)\+(-?\d+))?/i);
    if (!match) {
      continue;
    }
    const width = Number(match[3]);
    const height = Number(match[4]);
    if (width < 900 || height < 600) {
      continue;
    }
    candidates.push({
      id: match[1],
      title: match[2],
      x: Number(match[7] ?? match[5]),
      y: Number(match[8] ?? match[6]),
      width,
      height,
      area: width * height
    });
  }
  candidates.sort((left, right) => right.area - left.area);
  return candidates[0];
}

function terminateDetachedProcessGroup(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGTERM');
      return;
    } catch {
      // Fall back to the direct process id below.
    }
  }
  terminateProcess(pid);
}

function terminateProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process already exited.
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  if (!pid) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(300);
  }
}

function captureFrame(display, geometry, outputPath) {
  const r = spawnSync('ffmpeg', [
    '-y', '-f', 'x11grab',
    '-video_size', `${geometry.width}x${geometry.height}`,
    '-i', `${display}+${geometry.x},${geometry.y}`,
    '-frames:v', '1', '-draw_mouse', '1', outputPath
  ], {
    env: { ...process.env, DISPLAY: display },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  });
  if (r.status !== 0) throw new Error(`Screenshot failed`);
}

async function concatClips() {
  if (!existsSync(clipDir)) { console.log('No clips recorded'); return; }
  const clips = readdirSync(clipDir).filter(f => f.endsWith('.mp4')).sort();
  if (clips.length === 0) { console.log('No clips recorded'); return; }

  const usableClips = [];
  const skippedClips = [];
  for (const clip of clips) {
    const clipPath = path.join(clipDir, clip);
    if (await isUsableMp4Clip(clipPath)) {
      usableClips.push(clip);
    } else {
      skippedClips.push(clip);
    }
  }
  if (usableClips.length === 0) {
    throw new Error('no usable MP4 clips recorded');
  }
  if (skippedClips.length > 0) {
    console.log(`Skipping ${skippedClips.length} incomplete clip(s): ${skippedClips.join(', ')}`);
  }

  const concatListPath = path.join(clipDir, 'concat-list.txt');
  const concatContent = usableClips.map(f => `file '${path.join(clipDir, f)}'`).join('\n');
  await fs.writeFile(concatListPath, concatContent + '\n', 'utf8');

  const mp4Path = path.join(outputDir, 'canvas-overview.mp4');
  const result = spawnSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-c', 'copy', mp4Path
  ], { stdio: 'ignore', timeout: 30000 });

  if (result.status === 0) {
    console.log(`✓ MP4: ${mp4Path} (${usableClips.length} clips)`);
  } else {
    throw new Error('ffmpeg concat failed');
  }
}

async function isUsableMp4Clip(clipPath) {
  const stats = await fs.stat(clipPath).catch(() => null);
  if (!stats || stats.size < 1024) {
    return false;
  }

  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type',
    '-of', 'csv=p=0',
    clipPath
  ], { stdio: 'ignore', timeout: 10000 });
  if (result.error?.code === 'ENOENT') {
    return true;
  }
  return result.status === 0;
}

async function composeGif(session) {
  const gifFrameDir = session.gifFrameDir;
  const frames = readdirSync(gifFrameDir).filter(f => f.endsWith('.png')).sort();
  if (frames.length === 0) { console.log('No GIF frames captured'); return; }

  const manifestPath = path.join(path.dirname(gifFrameDir), 'concat-manifest.txt');
  const manifest = frames.map(f => `file '${path.join(gifFrameDir, f)}'\nduration 0.7`).join('\n');
  await fs.writeFile(manifestPath, manifest + '\n', 'utf8');

  const palettePath = path.join(path.dirname(gifFrameDir), 'palette.png');
  spawnSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', manifestPath,
    '-vf', `scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff`, palettePath
  ], { stdio: 'ignore', timeout: 30000 });

  const gifPath = path.join(outputDir, 'canvas-overview.gif');
  spawnSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', manifestPath, '-i', palettePath,
    '-lavfi', `scale=${GIF_WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
    gifPath
  ], { stdio: 'ignore', timeout: 30000 });
  console.log(`✓ GIF: ${gifPath}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

const commands = {
  start: cmdStart,
  screenshot: cmdScreenshot,
  locate: () => cmdLocate(args),
  click: () => cmdClick(args),
  key: () => cmdKey(args),
  paste: () => cmdPaste(args),
  command: () => cmdCommand(args),
  dispatch: () => cmdDispatch(args),
  state: cmdState,
  'gif-frame': () => cmdGifFrame(args),
  'record-start': cmdRecordStart,
  'record-stop': cmdRecordStop,
  stop: cmdStop
};

if (!cmd || !commands[cmd]) {
  console.error('用法: node scripts/media/recording-session.mjs <command>');
  console.error('命令: start, screenshot, locate, click, key, paste, state, record-start, record-stop, gif-frame, stop');
  process.exit(1);
}

commands[cmd]().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
