#!/usr/bin/env node

/**
 * recording-session.mjs — AI 驱动录制的工具脚本
 *
 * 用法:
 *   node scripts/media/recording-session.mjs start [--scenario four-root-attention]
 *   node scripts/media/recording-session.mjs screenshot     — 截取当前画面
 *   node scripts/media/recording-session.mjs locate <selector> [--frame canvas|workbench]  — 定位元素返回屏幕坐标
 *   node scripts/media/recording-session.mjs click <x> <y> [--right] [--double]
 *   node scripts/media/recording-session.mjs key <combo>    — 按键（Return, Escape, Ctrl+A, Shift+Insert）
 *   node scripts/media/recording-session.mjs paste <text>   — 剪贴板粘贴
 *   node scripts/media/recording-session.mjs command <cmd> [json_args] — legacy test-host only
 *   node scripts/media/recording-session.mjs dispatch <json_message>   — legacy test-host only
 *   node scripts/media/recording-session.mjs state          — 读取画布状态
 *   node scripts/media/recording-session.mjs checkpoint <frame-id> --take rootGroups|paneGallery
 *   node scripts/media/recording-session.mjs record-start [--take rootGroups|paneGallery --scene <label>]
 *   node scripts/media/recording-session.mjs record-sequence --take <take> --scene <label> --actions <json>
 *   node scripts/media/recording-session.mjs record-stop
 *   node scripts/media/recording-session.mjs close          — 关闭宿主，不导出媒体
 *   node scripts/media/recording-session.mjs stop           — 兼容旧流程：关闭并导出旧媒体
 */

import path from 'path';
import net from 'net';
import os from 'os';
import { createHash } from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { createWriteStream, existsSync, readFileSync, writeFileSync, readdirSync, promises as fs } from 'fs';
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

import {
  buildVSCodeChildEnv,
  ensureVSCodeExecutable,
  prepareRuntime
} from '../smoke/vscode-smoke-runner.mjs';
import { prepareDebugMainOnlyExtension } from '../shared/prepare-debug-main-only-extension.mjs';

const projectRoot = process.cwd();
const debugRoot = path.join(projectRoot, '.debug', 'marketplace-media');
const runtimeDebugRoot = path.join(debugRoot, 'runtime');
const sessionFile = path.join(debugRoot, 'recording-session.json');
const outputDir = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas', 'images', 'marketplace');
const nativeInputScriptPath = path.join(projectRoot, 'scripts', 'media', 'x11-native-input.py');
const GIF_WIDTH = 1180;
const clipDir = path.join(debugRoot, 'clips');
const providerBinDir = path.join(debugRoot, 'provider-bin');
const sourceDir = path.join(debugRoot, 'sources');
const checkpointDir = path.join(debugRoot, 'checkpoints');
const DISPLAY_SIZE = { width: 1720, height: 1180 };
const WINDOW_TITLE_PATTERN = /(Extension Development Host|Visual Studio Code|Code - OSS)/i;
const CDP_HOST = '127.0.0.1';
const START_TIMEOUT_MS = 180000;
const CANVAS_READY_TIMEOUT_MS = 60000;
const RECORDING_READY_TIMEOUT_MS = 15000;
const RECORDING_READY_POLL_INTERVAL_MS = 50;
const OPEN_CANVAS_IN_PANEL_COMMAND_TITLES = [
  'Dev Session Canvas: Open Canvas in Panel',
  'Dev Session Canvas: 在面板打开画布'
];
const ACTIVITY_BAR_CANVAS_SELECTORS = [
  '.activitybar [aria-label*="Dev Session Canvas"]',
  '.activitybar [aria-label*="Session Canvas" i]',
  '.activitybar [title*="Dev Session Canvas"]',
  '.activitybar [title*="Session Canvas" i]',
  '.activitybar [id*="devSessionCanvas"]',
  '.activitybar [class*="devSessionCanvas"]'
];
const SIDEBAR_OPEN_CANVAS_BUTTON_SELECTOR = 'button[data-action="openCanvas"]';
const SIDEBAR_OPEN_CANVAS_WORKBENCH_SELECTORS = [
  '.sidebar .monaco-list-row:has-text("Open Canvas")',
  '.sidebar .monaco-list-row[aria-label="Open Canvas"]',
  '.sidebar .monaco-list-row:has-text("打开画布")'
];
const FOUR_ROOT_SCENARIO = 'four-root-attention';
const FOUR_ROOT_SCENARIO_ROOT = path.join(
  '/tmp',
  'dev-session-canvas-marketplace-media',
  FOUR_ROOT_SCENARIO
);
export const CODEX_RECORDING_COMMAND = [
  'codex',
  `-c 'check_for_update_on_startup=false'`,
  `-c 'tui.theme="catppuccin-mocha"'`,
  `-c 'tui.notifications=["agent-turn-complete"]'`,
  `-c 'tui.notification_method="osc9"'`,
  `-c 'tui.notification_condition="always"'`
].join(' ');
export const CODEX_RELEASE_RECORDING_COMMAND = [
  'codex',
  `-c 'check_for_update_on_startup=false'`,
  `-c 'tui.theme="catppuccin-mocha"'`
].join(' ');
export const CLAUDE_RECORDING_COMMAND = 'claude --safe-mode';
export const FOUR_ROOT_DEFINITIONS = [
  {
    name: 'payments-api',
    kind: 'agent',
    id: 'agent-contract-review',
    title: 'Contract Review',
    provider: 'codex',
    launchPreset: 'custom',
    customLaunchCommand: CODEX_RECORDING_COMMAND,
    shellPath: 'codex',
    lastBackendLabel: 'Codex'
  },
  {
    name: 'storefront',
    kind: 'agent',
    id: 'agent-ui-builder',
    title: 'UI Builder',
    provider: 'claude',
    launchPreset: 'custom',
    customLaunchCommand: CLAUDE_RECORDING_COMMAND,
    shellPath: 'claude',
    lastBackendLabel: 'Claude Code'
  },
  {
    name: 'design-system',
    kind: 'agent',
    id: 'agent-component-audit',
    title: 'Component Audit',
    provider: 'claude',
    launchPreset: 'custom',
    customLaunchCommand: CLAUDE_RECORDING_COMMAND,
    shellPath: 'claude',
    lastBackendLabel: 'Claude Code'
  },
  {
    name: 'release-tools',
    kind: 'agent',
    id: 'agent-release-validation',
    title: 'Release Validation',
    provider: 'codex',
    launchPreset: 'custom',
    customLaunchCommand: CODEX_RELEASE_RECORDING_COMMAND,
    shellPath: 'codex',
    lastBackendLabel: 'Codex'
  }
];

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

async function cmdStart(args = []) {
  const scenario = readOption(args, '--scenario');
  if (scenario && scenario !== FOUR_ROOT_SCENARIO) {
    throw new Error(`不支持的录制场景: ${scenario}`);
  }
  const archivedEvidenceDir = await archiveExistingRecordingEvidence();
  await clearActiveRecordingEvidence();
  const logPath = path.join(debugRoot, 'marketplace-media-session-output.log');
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
  if (scenario) {
    ensureCommandAvailable('codex', ['--version'], '缺少真实 Codex CLI，无法录制正式四 root 场景。');
    ensureCommandAvailable('claude', ['--version'], '缺少真实 Claude Code CLI，无法录制正式四 root 场景。');
  }
  runNodeCommand(['scripts/build/build.mjs'], '构建扩展 bundle 失败。');

  const runtime = await prepareRuntime({
    debugRoot: runtimeDebugRoot,
    runtimeDirName: 'dsc-marketplace-media-recording',
    userSettings: {
      'security.workspace.trust.enabled': false,
      'window.commandCenter': false,
      'editor.minimap.enabled': false,
      'workbench.colorTheme': 'Default Dark Modern',
      'workbench.panel.defaultLocation': 'bottom',
      'workbench.panel.opensMaximized': 'always',
      'devSessionCanvas.canvas.defaultSurface': 'panel',
      'devSessionCanvas.files.enabled': scenario ? false : true,
      'devSessionCanvas.files.presentationMode': 'nodes',
      'devSessionCanvas.fileNode.displayStyle': 'minimal',
      'devSessionCanvas.files.nodeDisplayMode': 'icon-path',
      ...(scenario
        ? {
            'workbench.startupEditor': 'none',
            'window.zoomLevel': -1,
            'devSessionCanvas.runtimePersistence.enabled': false,
            'devSessionCanvas.agent.defaultProvider': 'claude',
            'devSessionCanvas.canvas.multiRootPresentationMode': 'rootGroups',
            'devSessionCanvas.notifications.enabledAttentionSignals': ['osc9'],
            'devSessionCanvas.notifications.attentionSignalBridge': 'none',
            'devSessionCanvas.notifications.strongTerminalAttentionReminder': 'both'
          }
        : {})
    }
  });
  const realProviderConfiguration = scenario
    ? await prepareRealProviderConfiguration(runtime)
    : undefined;
  const realProviderEnvironment = scenario
    ? buildRealProviderEnvironment(runtime.environment, realProviderConfiguration)
    : undefined;
  const providerPreflight = scenario ? verifyRealProviders(realProviderEnvironment) : undefined;
  const scenarioContext = scenario
    ? await prepareFourRootScenario(runtime, providerPreflight)
    : undefined;
  const providerBinPath = scenario ? undefined : await prepareRecordingProviderBin();
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
      workspacePath: scenarioContext?.workspaceFile ?? projectRoot,
      extensionDevelopmentPath,
      userDataDir: runtime.userDataDir,
      extensionsDir: runtime.extensionsDir,
      cdpPort
    });
    if (scenarioContext) {
      args.push('--locale=en');
    }
    const env = buildRecordingChildEnv({
      runtimeEnvironment: runtime.environment,
      realProviderEnvironment,
      display: display.display,
      scenarioContext,
      providerBinPath
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
    await openCanvasInPanel(display.display, geometry, browser, scenario);
    await waitForCanvasReady(browser, CANVAS_READY_TIMEOUT_MS);
    await closeAuxiliaryBarIfVisible(display.display, geometry, browser);

    await fs.writeFile(sessionFile, `${JSON.stringify({
      mode: 'real-extension-host',
      scenario: scenario ?? null,
      take: scenario ? 'rootGroups' : null,
      presentationMode: scenario ? 'rootGroups' : null,
      theme: 'Default Dark Modern',
      workspaceFile: scenarioContext?.workspaceFile ?? null,
      workspaceFolders: scenarioContext?.roots ?? [{ name: path.basename(projectRoot), path: projectRoot }],
      triggerDir: scenarioContext?.triggerDir ?? null,
      providerMode: scenarioContext ? 'real-system-cli' : 'legacy-fixture',
      providers: scenarioContext?.providers ?? [],
      providerPreflight: scenarioContext?.providerPreflight ?? null,
      archivedEvidenceDir,
      userSettingsPath: path.join(runtime.userDataDir, 'User', 'settings.json'),
      startedAt: new Date().toISOString(),
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

async function openCanvasInPanel(display, geometry, browser, scenario) {
  const page = await waitForWorkbenchPage(browser, 30000);
  await delay(1500);
  if (scenario === FOUR_ROOT_SCENARIO) {
    const activityBarBox = await waitForWorkbenchElementBox(page, ACTIVITY_BAR_CANVAS_SELECTORS, 5000);
    let revealed = false;
    if (activityBarBox) {
      nativeClickBox(display, geometry, activityBarBox);
      await delay(1500);
      revealed = true;
    } else {
      revealed = await revealCanvasSidebarViaCommandPalette(display, geometry, page);
    }
    if (!revealed) {
      throw new Error('无法显示 Dev Session Canvas sidebar。');
    }
    runNativeOnDisplay(display, [
      'click',
      '--x', String(geometry.x + 157),
      '--y', String(geometry.y + 423),
      '--window-id', geometry.id,
      '--move-duration-ms', '150'
    ]);
    await delay(1800);
    return;
  }
  const openedViaSidebar = await openCanvasInPanelViaSidebar(display, geometry, page);
  if (openedViaSidebar) {
    return;
  }
  const revealedViaCommand = await revealCanvasSidebarViaCommandPalette(display, geometry, page);
  if (revealedViaCommand && await clickOpenCanvasSidebarAction(display, geometry, page)) {
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

  return clickOpenCanvasSidebarAction(display, geometry, page);
}

async function clickOpenCanvasSidebarAction(display, geometry, page) {
  const openCanvasButtonBox =
    (await waitForWorkbenchElementBox(page, SIDEBAR_OPEN_CANVAS_WORKBENCH_SELECTORS, 5000)) ??
    (await waitForWebviewElementBox(page, SIDEBAR_OPEN_CANVAS_BUTTON_SELECTOR, 5000));
  if (!openCanvasButtonBox) {
    return false;
  }

  nativeClickBox(display, geometry, openCanvasButtonBox);
  await delay(1800);
  return true;
}

async function revealCanvasSidebarViaCommandPalette(display, geometry, page) {
  runNativeOnDisplay(display, ['key', '--combo', 'Ctrl+Shift+P', '--window-id', geometry.id]);
  await delay(500);
  const title = 'View: Show Dev Session Canvas';
  setClipboardText(display, title);
  runNativeOnDisplay(display, ['key', '--combo', 'Shift+Insert', '--window-id', geometry.id]);
  const matched = await waitForCommandPaletteMatch(page, title, 5000);
  if (!matched) {
    runNativeOnDisplay(display, ['key', '--combo', 'Escape', '--window-id', geometry.id]);
    return false;
  }
  runNativeOnDisplay(display, ['key', '--combo', 'Return', '--window-id', geometry.id]);
  await delay(1500);
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
  let matchedTitle;
  for (const title of OPEN_CANVAS_IN_PANEL_COMMAND_TITLES) {
    runNativeOnDisplay(display, ['key', '--combo', 'Ctrl+A', '--window-id', geometry.id]);
    setClipboardText(display, title);
    runNativeOnDisplay(display, ['key', '--combo', 'Shift+Insert', '--window-id', geometry.id]);
    if (await waitForCommandPaletteMatch(page, title, 5000)) {
      matchedTitle = title;
      break;
    }
  }
  if (!matchedTitle) {
    throw new Error(`Command Palette did not list ${OPEN_CANVAS_IN_PANEL_COMMAND_TITLES.join(' or ')}.`);
  }
  runNativeOnDisplay(display, ['key', '--combo', 'Return', '--window-id', geometry.id]);
  await delay(1500);
}

async function waitForCommandPaletteMatch(page, title, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await page.locator('.quick-input-widget .monaco-list-row')
      .filter({ hasText: title })
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false) || await page
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

async function closeAuxiliaryBarIfVisible(display, geometry, browser) {
  const page = await waitForWorkbenchPage(browser, 5000);
  const auxiliaryBar = page.locator('.part.auxiliarybar, .auxiliarybar').first();
  const box = await auxiliaryBar.boundingBox().catch(() => null);
  if (!isUsableBox(box) || box.width < 80) {
    return;
  }
  runNativeOnDisplay(display, [
    'click',
    '--x',
    String(geometry.x + box.x + box.width - 22),
    '--y',
    String(geometry.y + box.y + 14),
    '--window-id',
    geometry.id,
    '--move-duration-ms',
    '120'
  ]);
  await delay(700);
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
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) {
        continue;
      }
      const locator = frame.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 300 }).catch(() => false);
      if (!visible) {
        continue;
      }
      const box = await locator.boundingBox().catch(() => null);
      if (isUsableBox(box)) {
        return box;
      }
    }
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
  const candidates = [];
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!page.url().includes('workbench.html')) {
        continue;
      }
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) {
          continue;
        }
        const canvasShell = frame.locator('.canvas-shell, .react-flow').first();
        const hasCanvasShell = await canvasShell.count().then((count) => count > 0).catch(() => false);
        if (hasCanvasShell) {
          const frameElement = await frame.frameElement().catch(() => null);
          const box = await frameElement?.boundingBox().catch(() => null);
          const viewport = await frame
            .evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
            .catch(() => ({ width: 0, height: 0 }));
          const nodeCount = await frame.locator('[data-node-id][data-node-kind]').count().catch(() => 0);
          const area = (box?.width ?? viewport.width) * (box?.height ?? viewport.height);
          candidates.push({ page, frame, box, area, nodeCount });
        }
      }
    }
  }
  candidates.sort((left, right) => right.nodeCount - left.nodeCount || right.area - left.area);
  if (candidates[0]) {
    return candidates[0];
  }
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!page.url().includes('workbench.html')) {
        continue;
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

async function cmdMove(args) {
  const session = readSession();
  const x = parseFloat(args[0]);
  const y = parseFloat(args[1]);
  runNative(session.display, [
    'move',
    '--x', String(x),
    '--y', String(y),
    '--window-id', session.geometry.id,
    '--move-duration-ms', '150'
  ]);
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

async function cmdCheckpoint(args) {
  const session = readSession();
  const frameId = args[0];
  const take = readOption(args, '--take') ?? session.take;
  if (!frameId || !/^[a-z0-9-]+$/u.test(frameId)) {
    throw new Error('checkpoint 需要 kebab-case Frame ID。');
  }
  if (take !== 'rootGroups' && take !== 'paneGallery') {
    throw new Error('checkpoint --take 必须是 rootGroups 或 paneGallery。');
  }
  const takeDir = path.join(checkpointDir, take);
  await fs.mkdir(takeDir, { recursive: true });
  const imagePath = path.join(takeDir, `${frameId}.png`);
  captureFrame(session.display, session.geometry, imagePath);
  const snapshot = await captureCheckpointDomState(session);
  const metadataPath = path.join(takeDir, `${frameId}.json`);
  const metadata = {
    version: 1,
    scenario: session.scenario,
    take,
    presentationMode: session.presentationMode,
    frameId,
    stateId: frameId,
    imagePath,
    capturedAt: new Date().toISOString(),
    geometry: session.geometry,
    theme: session.theme,
    workspaceFile: session.workspaceFile,
    snapshot
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  updateSession({
    checkpoints: [
      ...(session.checkpoints ?? []).filter((entry) => !(entry.take === take && entry.frameId === frameId)),
      { take, frameId, imagePath, metadataPath, capturedAt: metadata.capturedAt }
    ]
  });
  console.log(`${take}/${frameId}: ${imagePath}`);
}

async function captureCheckpointDomState(session) {
  const browser = await chromium.connectOverCDP(session.cdpEndpoint);
  try {
    const canvasFrame = await waitForCanvasReady(browser, 5000);
    const domSnapshot = await canvasFrame.frame.evaluate(() => ({
        presentationMode: document.querySelector('.canvas-shell.is-pane-gallery') ? 'paneGallery' : 'rootGroups',
        roots: Array.from(document.querySelectorAll('[data-root-watermark-label], .pane-gallery-root-title')).map(
          (element) => element.textContent?.trim() ?? ''
        ),
        nodes: Array.from(document.querySelectorAll('[data-node-id][data-node-kind]')).map((element) => ({
          id: element.getAttribute('data-node-id'),
          kind: element.getAttribute('data-node-kind'),
          title:
            element.querySelector('.window-title strong, .node-topline strong')?.textContent?.trim() ?? '',
          status: element.querySelector('.execution-status-pill, [data-execution-status]')?.textContent?.trim() ?? '',
          attention: element.querySelector('[data-execution-attention-pending="true"]') !== null
        })),
        paneGalleryLayout: document.querySelector('.pane-gallery')?.getAttribute('data-pane-gallery-layout') ?? null
      }));
    if (domSnapshot.nodes.length > 0) {
      return domSnapshot;
    }
    return capturePersistedCheckpointState(session, 'Canvas webview DOM target unavailable through CDP.');
  } catch (error) {
    return capturePersistedCheckpointState(
      session,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await browser.close();
  }
}

async function capturePersistedCheckpointState(session, domUnavailable) {
  const persisted = await readPersistedCanvasState(session).catch(() => undefined);
  return {
    presentationMode: session.presentationMode,
    domUnavailable,
    roots: (session.workspaceFolders ?? []).map((root) => root.name),
    nodes: (persisted?.nodes ?? []).map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      status: node.status,
      attention:
        node.metadata?.agent?.attentionPending === true || node.metadata?.terminal?.attentionPending === true
    })),
    paneGalleryLayout: null
  };
}

async function cmdSetMode(args) {
  const mode = args[0];
  if (mode !== 'rootGroups' && mode !== 'paneGallery') {
    throw new Error('set-mode 只接受 rootGroups 或 paneGallery。');
  }
  const session = readSession();
  if (!session.userSettingsPath) {
    throw new Error('当前 session 没有可写的 settings 路径。');
  }
  const settings = JSON.parse(await fs.readFile(session.userSettingsPath, 'utf8'));
  settings['devSessionCanvas.canvas.multiRootPresentationMode'] = mode;
  const tempPath = `${session.userSettingsPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, session.userSettingsPath);

  await delay(2500);
  updateSession({ take: mode, presentationMode: mode, modeChangedAt: new Date().toISOString() });
  console.log(`presentation mode requested: ${mode}`);
}

async function cmdTrigger(args) {
  const triggerName = args[0];
  const session = readSession();
  if (!triggerName || !/^[a-z0-9-]+$/u.test(triggerName)) {
    throw new Error('trigger 需要 kebab-case 名称。');
  }
  if (!session.triggerDir) {
    throw new Error('当前 session 没有 deterministic trigger 目录。');
  }
  const triggerPath = path.join(session.triggerDir, triggerName);
  await fs.writeFile(triggerPath, `${new Date().toISOString()}\n`, 'utf8');
  updateSession({
    triggers: [...(session.triggers ?? []), { name: triggerName, path: triggerPath, triggeredAt: new Date().toISOString() }]
  });
  console.log(triggerPath);
}

async function cmdRecordStart(args = []) {
  const session = readSession();
  if (session.currentClipPid) {
    console.error('已有片段在录制中，请先 record-stop');
    process.exit(1);
  }
  await fs.mkdir(clipDir, { recursive: true });
  const clipCount = (session.clipCount ?? 0) + 1;
  const take = readOption(args, '--take') ?? session.take;
  const scene = readOption(args, '--scene');
  if (take && take !== 'rootGroups' && take !== 'paneGallery') {
    throw new Error('record-start --take 必须是 rootGroups 或 paneGallery。');
  }
  if (scene && !/^[a-z0-9-]+$/u.test(scene)) {
    throw new Error('record-start --scene 需要 kebab-case 名称。');
  }
  const clipPath = take && scene
    ? path.join(sourceDir, take, `${scene}.mp4`)
    : path.join(clipDir, `clip-${String(clipCount).padStart(3, '0')}.mp4`);
  const progressPath = `${clipPath}.progress`;
  await fs.mkdir(path.dirname(clipPath), { recursive: true });
  await fs.rm(progressPath, { force: true });
  const startedAt = new Date().toISOString();
  const child = spawn('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-stats_period', '0.1', '-progress', progressPath, '-nostats',
    '-f', 'x11grab', '-framerate', '30',
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
  try {
    await waitForFfmpegFirstFrame({
      readProgress: () => readProgressFile(progressPath),
      isProcessRunning: () => child.exitCode === null,
      timeoutMs: RECORDING_READY_TIMEOUT_MS,
      pollIntervalMs: RECORDING_READY_POLL_INTERVAL_MS
    });
  } catch (error) {
    try { process.kill(child.pid, 'SIGINT'); } catch {}
    await delay(500);
    await fs.rm(progressPath, { force: true });
    throw new Error(`${error.message} Progress: ${progressPath}`);
  }
  updateSession({
    currentClipPid: child.pid,
    currentClipPath: clipPath,
    currentClipProgressPath: progressPath,
    currentClipMeta: {
      take: take ?? null,
      scene: scene ?? `clip-${String(clipCount).padStart(3, '0')}`,
      presentationMode: session.presentationMode ?? null,
      startedAt,
      geometry: session.geometry,
      theme: session.theme,
      workspaceFile: session.workspaceFile
    },
    clipCount
  });
  console.log(`recording clip #${clipCount}: ${clipPath}`);
}

export function parseFfmpegProgress(value) {
  let frame = 0;
  let progress = null;
  for (const line of String(value ?? '').split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key === 'frame') {
      const parsedFrame = Number(rawValue);
      if (Number.isFinite(parsedFrame)) {
        frame = Math.max(frame, parsedFrame);
      }
    } else if (key === 'progress') {
      progress = rawValue;
    }
  }
  return { frame, progress };
}

export async function waitForFfmpegFirstFrame({
  readProgress,
  isProcessRunning,
  timeoutMs = RECORDING_READY_TIMEOUT_MS,
  pollIntervalMs = RECORDING_READY_POLL_INTERVAL_MS,
  now = Date.now,
  sleep = delay
}) {
  const startedAt = now();
  while (true) {
    const progress = parseFfmpegProgress(await readProgress());
    if (progress.frame >= 1) {
      return progress;
    }
    if (!isProcessRunning()) {
      throw new Error('ffmpeg exited before recording its first frame.');
    }
    if (now() - startedAt >= timeoutMs) {
      throw new Error(`ffmpeg did not record a frame within ${timeoutMs}ms.`);
    }
    await sleep(pollIntervalMs);
  }
}

async function readProgressFile(progressPath) {
  try {
    return await fs.readFile(progressPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function cmdRecordSequence(args = []) {
  const actions = validateRecordingActions(JSON.parse(readOption(args, '--actions') ?? 'null'));
  await cmdRecordStart(args);
  try {
    const session = readSession();
    for (const action of actions) {
      if (action.type === 'wait') {
        await delay(action.ms);
        continue;
      }
      if (action.type === 'click') {
        const nativeArgs = [
          'click',
          '--x', String(action.x),
          '--y', String(action.y),
          '--window-id', session.geometry.id,
          '--move-duration-ms', String(action.moveDurationMs ?? 150)
        ];
        if (action.double) {
          nativeArgs.push('--count', '2');
        }
        runNative(session.display, nativeArgs);
        await delay(action.afterMs ?? 150);
        continue;
      }
      if (action.type === 'move') {
        runNative(session.display, [
          'move',
          '--x', String(action.x),
          '--y', String(action.y),
          '--window-id', session.geometry.id,
          '--move-duration-ms', String(action.moveDurationMs ?? 150)
        ]);
        await delay(action.afterMs ?? 150);
        continue;
      }
      if (action.type === 'paste') {
        setClipboardText(session.display, action.text);
        await delay(100);
        runNative(session.display, ['key', '--combo', 'Shift+Insert', '--window-id', session.geometry.id]);
        await delay(action.afterMs ?? 100);
        continue;
      }
      runNative(session.display, ['key', '--combo', action.combo, '--window-id', session.geometry.id]);
      await delay(action.afterMs ?? 100);
    }
  } finally {
    await cmdRecordStop();
  }
}

export function validateRecordingActions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) {
    throw new Error('record-sequence --actions 必须是 1-40 项 action 数组。');
  }
  for (const [index, action] of value.entries()) {
    if (!action || typeof action !== 'object') {
      throw new Error(`record-sequence action[${index}] 必须是对象。`);
    }
    if (action.type === 'wait') {
      if (!Number.isFinite(action.ms) || action.ms < 0 || action.ms > 10000) {
        throw new Error(`record-sequence action[${index}].ms 必须在 0-10000 之间。`);
      }
      continue;
    }
    if (action.type === 'click' || action.type === 'move') {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) {
        throw new Error(`record-sequence action[${index}] 需要有限的 x/y。`);
      }
      continue;
    }
    if (action.type === 'paste') {
      if (typeof action.text !== 'string' || action.text.length > 1000) {
        throw new Error(`record-sequence action[${index}].text 必须是最多 1000 字符的字符串。`);
      }
      continue;
    }
    if (action.type === 'key') {
      if (typeof action.combo !== 'string' || !/^[A-Za-z0-9+_-]+$/u.test(action.combo)) {
        throw new Error(`record-sequence action[${index}].combo 无效。`);
      }
      continue;
    }
    throw new Error(`record-sequence action[${index}].type 不受支持。`);
  }
  return value;
}

async function cmdRecordStop() {
  const session = readSession();
  if (!session.currentClipPid) {
    console.error('没有正在录制的片段');
    process.exit(1);
  }
  try { process.kill(session.currentClipPid, 'SIGINT'); } catch {}
  await delay(1500);
  const endedAt = new Date().toISOString();
  const clip = {
    ...(session.currentClipMeta ?? {}),
    path: session.currentClipPath,
    endedAt,
    probe: probeVideoFile(session.currentClipPath)
  };
  await fs.rm(session.currentClipProgressPath, { force: true });
  updateSession({
    currentClipPid: null,
    currentClipPath: null,
    currentClipProgressPath: null,
    currentClipMeta: null,
    clips: [...(session.clips ?? []), clip]
  });
  console.log('clip stopped');
}

async function cmdClose() {
  const session = readSession();
  if (session.closedAt) {
    console.log('✓ 录制宿主已关闭，无需重复停止');
    return;
  }
  if (session.currentClipPid) {
    throw new Error('仍有片段在录制中；请先运行 record-stop，避免丢失 clip metadata。');
  }
  await closeRecordingHost(session);
  updateSession({ closedAt: new Date().toISOString(), closedWithoutExport: true });
  console.log('✓ 录制宿主已关闭，未导出或覆盖正式媒体资产');
}

async function cmdStop() {
  const session = readSession();

  // Stop any active clip
  if (session.currentClipPid) {
    try { process.kill(session.currentClipPid, 'SIGINT'); } catch {}
    await delay(1500);
  }

  await closeRecordingHost(session);
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

async function closeRecordingHost(session) {
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function buildRealProviderEnvironment(
  runtimeEnvironment,
  {
    processEnvironment = process.env,
    homeDir = os.homedir(),
    codexHome = processEnvironment.CODEX_HOME ?? path.join(homeDir, '.codex'),
    claudeConfigDir = processEnvironment.CLAUDE_CONFIG_DIR ?? path.join(homeDir, '.claude')
  } = {}
) {
  return {
    ...processEnvironment,
    ...runtimeEnvironment,
    PATH: runtimeEnvironment.PATH ?? processEnvironment.PATH ?? '',
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeConfigDir
  };
}

async function prepareRealProviderConfiguration(runtime) {
  const configRoot = path.join(runtime.debugRoot, 'real-provider-config');
  const codexHome = path.join(configRoot, 'codex');
  const claudeConfigDir = path.join(configRoot, 'claude');
  const actualHome = os.homedir();
  const actualCodexHome = process.env.CODEX_HOME ?? path.join(actualHome, '.codex');
  const actualClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(actualHome, '.claude');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.mkdir(claudeConfigDir, { recursive: true });

  await linkRequiredProviderFile(
    path.join(actualCodexHome, 'auth.json'),
    path.join(codexHome, 'auth.json'),
    '找不到真实 Codex 认证文件。'
  );
  await linkOptionalProviderFile(
    path.join(actualCodexHome, 'config.toml'),
    path.join(codexHome, 'config.toml')
  );
  await linkRequiredProviderFile(
    path.join(actualClaudeConfigDir, 'settings.json'),
    path.join(claudeConfigDir, 'settings.json'),
    '找不到真实 Claude Code 配置文件。'
  );
  const userClaudeState = await readJsonFile(path.join(actualHome, '.claude.json'));
  const trustedProjectPath = projectRoot.includes('.worktrees')
    ? projectRoot.slice(0, projectRoot.indexOf('.worktrees'))
    : projectRoot;
  const trustedProject = userClaudeState?.projects?.[trustedProjectPath];
  await fs.writeFile(
    path.join(claudeConfigDir, '.claude.json'),
    `${JSON.stringify({
      hasCompletedOnboarding: true,
      theme: 'dark-ansi',
      installMethod: 'native',
      lastOnboardingVersion: '2.1.209',
      autoUpdates: false,
      preferredNotifChannel: 'terminal_bell',
      customApiKeyResponses: userClaudeState?.customApiKeyResponses ?? {},
      projects: trustedProject?.hasTrustDialogAccepted === true
        ? {
            [trustedProjectPath]: {
              hasTrustDialogAccepted: true,
              hasClaudeMdExternalIncludesApproved: false,
              hasClaudeMdExternalIncludesWarningShown: true,
              projectOnboardingSeenCount: 1,
              allowedTools: [],
              mcpContextUris: [],
              mcpServers: {},
              enabledMcpjsonServers: [],
              disabledMcpjsonServers: []
            }
          }
        : {}
    }, null, 2)}\n`,
    'utf8'
  );
  return { codexHome, claudeConfigDir };
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

async function linkRequiredProviderFile(sourcePath, targetPath, errorMessage) {
  if (!existsSync(sourcePath)) {
    throw new Error(errorMessage);
  }
  await linkOptionalProviderFile(sourcePath, targetPath);
}

async function linkOptionalProviderFile(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) {
    return;
  }
  await fs.rm(targetPath, { force: true });
  await fs.symlink(sourcePath, targetPath);
}

export function buildRecordingChildEnv({
  runtimeEnvironment,
  realProviderEnvironment,
  display,
  scenarioContext,
  providerBinPath
}) {
  const base = {
    ...runtimeEnvironment,
    DISPLAY: display,
    TERM: 'xterm-256color'
  };

  if (scenarioContext) {
    const environment = buildVSCodeChildEnv({
      ...base,
      COLORTERM: 'truecolor',
      PATH: realProviderEnvironment.PATH,
      CODEX_HOME: realProviderEnvironment.CODEX_HOME,
      CLAUDE_CONFIG_DIR: realProviderEnvironment.CLAUDE_CONFIG_DIR
    });
    delete environment.NO_COLOR;
    // Keep the inherited CLI PATH instead of replacing it with the login shell's older Node toolchain.
    environment.VSCODE_CLI = '1';
    return environment;
  }

  const inheritedPath = runtimeEnvironment.PATH ?? process.env.PATH ?? '';
  return buildVSCodeChildEnv({
    ...base,
    PATH: providerBinPath
      ? `${providerBinPath}${path.delimiter}${inheritedPath}`
      : inheritedPath
  });
}

function verifyRealProviders(environment) {
  const codexVersion = readCommandOutput('codex', ['--version'], environment, '无法读取真实 Codex CLI 版本。');
  const claudeVersion = readCommandOutput('claude', ['--version'], environment, '无法读取真实 Claude Code CLI 版本。');
  const codexAuth = spawnSync('codex', ['login', 'status'], {
    env: environment,
    encoding: 'utf8',
    timeout: 15000
  });
  if (codexAuth.error || codexAuth.status !== 0) {
    throw new Error('真实 Codex CLI 当前未登录，无法开始正式录制。');
  }
  const claudeAuth = spawnSync('claude', ['auth', 'status'], {
    env: environment,
    encoding: 'utf8',
    timeout: 15000
  });
  if (
    claudeAuth.error ||
    claudeAuth.status !== 0 ||
    !/"loggedIn"\s*:\s*true/u.test(claudeAuth.stdout ?? '')
  ) {
    throw new Error('真实 Claude Code CLI 当前未登录，无法开始正式录制。');
  }

  return {
    codex: { version: codexVersion, authenticated: true },
    claude: { version: claudeVersion, authenticated: true }
  };
}

function readCommandOutput(command, args, environment, errorMessage) {
  const result = spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    timeout: 15000
  });
  if (result.error || result.status !== 0) {
    throw new Error(errorMessage);
  }
  return result.stdout.trim().split(/\r?\n/u)[0];
}

async function archiveExistingRecordingEvidence() {
  const entries = [
    'sources',
    'checkpoints',
    'pair-manifest.json',
    'composite',
    'review',
    'contact-sheets',
    'previews'
  ].filter((entry) => existsSync(path.join(debugRoot, entry)));
  if (entries.length === 0) {
    return null;
  }

  const archiveDir = path.join(
    debugRoot,
    'archive',
    new Date().toISOString().replace(/[:.]/gu, '-')
  );
  await fs.mkdir(archiveDir, { recursive: true });
  for (const entry of entries) {
    await fs.cp(path.join(debugRoot, entry), path.join(archiveDir, entry), { recursive: true });
  }
  await fs.writeFile(
    path.join(archiveDir, 'archive-metadata.json'),
    `${JSON.stringify({ archivedAt: new Date().toISOString(), entries }, null, 2)}\n`,
    'utf8'
  );
  return archiveDir;
}

async function clearActiveRecordingEvidence() {
  for (const entry of [
    'sources',
    'checkpoints',
    'pair-manifest.json',
    'composite',
    'review',
    'contact-sheets',
    'previews'
  ]) {
    await fs.rm(path.join(debugRoot, entry), { recursive: true, force: true });
  }
}

async function prepareFourRootScenario(runtime, providerPreflight) {
  const scenarioRoot = FOUR_ROOT_SCENARIO_ROOT;
  const workspaceRoot = path.join(scenarioRoot, 'workspace');
  const triggerDir = path.join(scenarioRoot, 'triggers');
  const roots = [];
  await fs.rm(scenarioRoot, { recursive: true, force: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(triggerDir, { recursive: true });

  for (const definition of FOUR_ROOT_DEFINITIONS) {
    const rootPath = path.join(workspaceRoot, definition.name);
    await fs.mkdir(rootPath, { recursive: true });
    await fs.writeFile(
      path.join(rootPath, 'README.md'),
      `# ${definition.name}\n\nDisposable Marketplace recording workspace for real provider sessions.\n`,
      'utf8'
    );
    if (definition.name === 'release-tools') {
      const testScriptPath = path.join(rootPath, 'run-e2e.sh');
      const triggerPath = path.join(triggerDir, 'e2e-complete');
      const script = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo "E2E checkout suite | 42 checks"',
        'echo "Running browser, API, and retry-policy scenarios..."',
        `while [[ ! -f ${shellQuote(triggerPath)} ]]; do sleep 0.1; done`,
        'echo "PASS checkout retry flows | 42 passed | exit code 0"',
        'exit 0',
        ''
      ].join('\n');
      await fs.writeFile(testScriptPath, script, { encoding: 'utf8', mode: 0o755 });
      await fs.chmod(testScriptPath, 0o755);
    }
    roots.push({ name: definition.name, path: rootPath });
  }

  const workspaceFile = path.join(scenarioRoot, 'dev-session-canvas-promo.code-workspace');
  await fs.writeFile(
    workspaceFile,
    `${JSON.stringify({
      folders: roots.map((root) => ({ name: root.name, path: root.path })),
      settings: {}
    }, null, 2)}\n`,
    'utf8'
  );

  const rootLocalStorage = path.join(
    runtime.userDataDir,
    'User',
    'globalStorage',
    'devsessioncanvas.dev-session-canvas',
    'root-local-canvas'
  );
  for (const [index, definition] of FOUR_ROOT_DEFINITIONS.entries()) {
    const root = roots[index];
    const snapshotPath = path.join(rootLocalStorage, createRootLocalStorageKey(root.path), 'canvas-state.json');
    const snapshot = createScenarioRootSnapshot(definition, root.path);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  const providers = FOUR_ROOT_DEFINITIONS
    .filter((definition) => definition.kind === 'agent')
    .map((definition) => ({
      root: definition.name,
      nodeId: definition.id,
      provider: definition.provider,
      shellPath: definition.shellPath,
      launchPreset: definition.launchPreset,
      lastBackendLabel: definition.lastBackendLabel
    }));
  await fs.writeFile(
    path.join(scenarioRoot, 'scenario-metadata.json'),
    `${JSON.stringify({
      version: 1,
      scenario: FOUR_ROOT_SCENARIO,
      workspaceFile,
      roots,
      triggerDir,
      providerMode: 'real-system-cli',
      providers,
      providerPreflight,
      createdAt: new Date().toISOString()
    }, null, 2)}\n`,
    'utf8'
  );
  return { workspaceFile, roots, triggerDir, providers, providerPreflight };
}

function createScenarioRootSnapshot(definition, rootPath) {
  const now = new Date().toISOString();
  const commonNode = {
    id: definition.id,
    kind: definition.kind,
    title: definition.title,
    status: 'idle',
    summary: definition.kind === 'agent' ? 'Agent session is ready to start.' : 'Terminal is ready to start.',
    position: { x: 0, y: 0 },
    size: { width: 560, height: 430 }
  };
  const metadata = definition.kind === 'agent'
    ? {
        agent: {
          backend: 'node-pty',
          lifecycle: 'idle',
          provider: definition.provider,
          launchPreset: definition.launchPreset,
          customLaunchCommand: definition.customLaunchCommand,
          runtimeKind: 'pty-cli',
          resumeSupported: false,
          resumeStrategy: 'none',
          shellPath: definition.shellPath,
          cwd: rootPath,
          persistenceMode: 'snapshot-only',
          attachmentState: 'history-restored',
          liveSession: false,
          lastCols: 76,
          lastRows: 22,
          attentionPending: false,
          lastBackendLabel: definition.lastBackendLabel
        }
      }
    : {
        terminal: {
          backend: 'node-pty',
          lifecycle: 'idle',
          shellPath: '/usr/bin/bash',
          cwd: rootPath,
          persistenceMode: 'snapshot-only',
          attachmentState: 'history-restored',
          liveSession: false,
          lastCols: 76,
          lastRows: 22,
          attentionPending: false
        }
      };
  const state = {
    version: 1,
    updatedAt: now,
    nodes: [{ ...commonNode, metadata }],
    edges: [],
    groups: [],
    nextGroupSequence: 1,
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  };
  return {
    version: 1,
    state,
    activeSurface: 'panel',
    defaultSurface: 'panel',
    runtimePersistenceEnabled: false,
    filesFeatureEnabled: false,
    writtenAt: now,
    stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex')
  };
}

function createRootLocalStorageKey(rootPath) {
  return createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 24);
}

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

function probeVideoFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return undefined;
  }
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames:format=duration',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) {
    return undefined;
  }
  const parsed = JSON.parse(result.stdout || '{}');
  const stream = parsed.streams?.[0] ?? {};
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    frameCount: Number.isFinite(Number(stream.nb_frames)) ? Number(stream.nb_frames) : undefined,
    durationSeconds: Number.isFinite(Number(parsed.format?.duration)) ? Number(parsed.format.duration) : undefined
  };
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

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...args] = argv;
  const commands = {
    start: () => cmdStart(args),
    screenshot: cmdScreenshot,
    locate: () => cmdLocate(args),
    click: () => cmdClick(args),
    move: () => cmdMove(args),
    key: () => cmdKey(args),
    paste: () => cmdPaste(args),
    command: () => cmdCommand(args),
    dispatch: () => cmdDispatch(args),
    state: cmdState,
    'gif-frame': () => cmdGifFrame(args),
    checkpoint: () => cmdCheckpoint(args),
    'set-mode': () => cmdSetMode(args),
    trigger: () => cmdTrigger(args),
    'record-start': () => cmdRecordStart(args),
    'record-sequence': () => cmdRecordSequence(args),
    'record-stop': cmdRecordStop,
    close: cmdClose,
    stop: cmdStop
  };

  if (!cmd || !commands[cmd]) {
    throw new Error(
      '用法: node scripts/media/recording-session.mjs <command>\n' +
      '命令: start, screenshot, locate, click, move, key, paste, state, checkpoint, set-mode, trigger, record-start, record-sequence, record-stop, gif-frame, close, stop'
    );
  }
  await commands[cmd]();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
