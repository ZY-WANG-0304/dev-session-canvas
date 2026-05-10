#!/usr/bin/env node

/**
 * recording-session.mjs — AI 驱动录制的工具脚本
 *
 * 用法:
 *   node scripts/recording-session.mjs start          — 启动录制环境（后台）
 *   node scripts/recording-session.mjs screenshot     — 截取当前画面
 *   node scripts/recording-session.mjs locate <selector> [--frame canvas|workbench]  — 定位元素返回屏幕坐标
 *   node scripts/recording-session.mjs click <x> <y> [--right] [--double]
 *   node scripts/recording-session.mjs key <combo>    — 按键（Return, Escape, Ctrl+A, Shift+Insert）
 *   node scripts/recording-session.mjs paste <text>   — 剪贴板粘贴
 *   node scripts/recording-session.mjs command <cmd> [json_args]
 *   node scripts/recording-session.mjs dispatch <json_message>
 *   node scripts/recording-session.mjs state          — 读取画布状态
 *   node scripts/recording-session.mjs gif-frame <label> [durationMs]
 *   node scripts/recording-session.mjs stop           — 停止录制，生成媒体文件
 */

import path from 'path';
import net from 'net';
import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, openSync, promises as fs } from 'fs';
import { chromium } from 'playwright';

const projectRoot = process.cwd();
const debugRoot = path.join(projectRoot, '.debug', 'marketplace-media');
const sessionFile = path.join(debugRoot, 'recording-session.json');
const outputDir = path.join(projectRoot, 'images', 'marketplace');
const nativeInputScriptPath = path.join(projectRoot, 'scripts', 'x11-native-input.py');
const GIF_WIDTH = 1180;
const clipDir = path.join(debugRoot, 'clips');

function readSession() {
  if (!existsSync(sessionFile)) {
    throw new Error('录制会话未启动。请先运行: node scripts/recording-session.mjs start');
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
  await fs.mkdir(debugRoot, { recursive: true });
  const logPath = path.join(debugRoot, 'session-output.log');
  console.log('启动交互录制环境...');

  const child = spawn('bash', ['-c', `exec ${process.execPath} scripts/generate-marketplace-media.mjs > "${logPath}" 2>&1`], {
    cwd: projectRoot,
    env: { ...process.env, RECORDING_INTERACTIVE: '1' },
    stdio: 'ignore',
    detached: true
  });
  child.unref();

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (existsSync(sessionFile)) {
      await delay(500);
      console.log('✓ 录制环境就绪');
      console.log(`  日志: ${logPath}`);
      return;
    }
    await delay(1000);
  }
  throw new Error('启动超时，查看日志: ' + logPath);
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
          const iframes = await page.locator('iframe.webview.ready').all();
          for (const iframe of iframes) {
            const box = await iframe.boundingBox().catch(() => null);
            if (!box || box.width < 400 || box.height < 300) continue;
            const frameLocator = page.frameLocator('iframe.webview.ready').first();
            const loc = frameLocator.locator(selector).first();
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
  const nativeArgs = ['click', '--x', String(x), '--y', String(y)];
  if (args.includes('--right')) nativeArgs.push('--button', 'right');
  if (args.includes('--double')) nativeArgs.push('--count', '2');
  nativeArgs.push('--move-duration-ms', '150');
  runNative(session.display, nativeArgs);
  await delay(110);
}

async function cmdKey(args) {
  const session = readSession();
  runNative(session.display, ['key', '--combo', args[0]]);
}

async function cmdPaste(args) {
  const session = readSession();
  const text = args.join(' ');
  spawnSync('xsel', ['--clipboard', '--input'], {
    input: text,
    env: { ...process.env, DISPLAY: session.display },
    stdio: ['pipe', 'ignore', 'ignore']
  });
  await delay(100);
  runNative(session.display, ['key', '--combo', 'Shift+Insert']);
}

async function cmdCommand(args) {
  const session = readSession();
  const cmd = { type: 'executeCommand', command: args[0] };
  if (args.length > 1) {
    try { cmd.args = JSON.parse(args.slice(1).join(' ')); } catch { cmd.args = args.slice(1); }
  }
  await fs.appendFile(session.controlPath, JSON.stringify(cmd) + '\n', 'utf8');
  await delay(300);
}

async function cmdDispatch(args) {
  const session = readSession();
  const message = JSON.parse(args.join(' '));
  await fs.appendFile(session.controlPath, JSON.stringify({ type: 'dispatchWebviewMessage', message }) + '\n', 'utf8');
  await delay(300);
}

async function cmdState() {
  const session = readSession();
  const raw = await fs.readFile(session.statePath, 'utf8').catch(() => '{}');
  const state = JSON.parse(raw);
  const nodes = state?.debugSnapshot?.state?.nodes ?? [];
  const edges = state?.debugSnapshot?.state?.edges ?? [];
  console.log(`nodes: ${nodes.length}, edges: ${edges.length}`);
  for (const n of nodes) {
    console.log(`  ${n.kind.padEnd(10)} ${(n.title ?? '').padEnd(25)} ${n.id.slice(0, 35)}`);
  }
  for (const e of edges) {
    console.log(`  edge: ${e.sourceNodeId.slice(0, 20)} → ${e.targetNodeId.slice(0, 20)} [${e.label ?? ''}] color=${e.color ?? '-'}`);
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

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { process.kill(session.childPid, 0); } catch { break; }
    await delay(500);
  }

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

function runNative(display, args) {
  const r = spawnSync('python3', [nativeInputScriptPath, ...args], {
    env: { ...process.env, DISPLAY: display },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  });
  if (r.status !== 0) throw new Error(`Native input failed: ${r.stderr?.toString()?.slice(-200)}`);
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

  const concatListPath = path.join(clipDir, 'concat-list.txt');
  const concatContent = clips.map(f => `file '${path.join(clipDir, f)}'`).join('\n');
  await fs.writeFile(concatListPath, concatContent + '\n', 'utf8');

  const mp4Path = path.join(outputDir, 'canvas-overview.mp4');
  const result = spawnSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-c', 'copy', mp4Path
  ], { stdio: 'ignore', timeout: 30000 });

  if (result.status === 0) {
    console.log(`✓ MP4: ${mp4Path} (${clips.length} clips)`);
  } else {
    throw new Error('ffmpeg concat failed');
  }
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
  console.error('用法: node scripts/recording-session.mjs <command>');
  console.error('命令: start, screenshot, click, key, paste, command, dispatch, state, gif-frame, stop');
  process.exit(1);
}

commands[cmd]().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
