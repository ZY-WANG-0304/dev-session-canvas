const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Attach before the suite creates its Webviews. Late CDP attachment to an
// existing VSCode OOP iframe can miss its nested content frame permanently.
let browser;
async function initializeNativeFileInput(deadline) {
  assert(!browser, 'Native file input is already initialized.');
  const remaining = () => {
    assert(Date.now() < deadline, 'Native input initialization exceeded the original activation budget.');
    return deadline - Date.now();
  };
  const driverPath = process.env.DEV_SESSION_CANVAS_SMOKE_PLAYWRIGHT;
  const profile = process.env.DEV_SESSION_CANVAS_SMOKE_USER_DATA_DIR;
  assert(driverPath && profile, 'Native file input requires the smoke runner and its private profile.');
  const { chromium } = require(driverPath);
  remaining();
  const [port, endpoint] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
  assert(/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535
    && /^\/devtools\/browser\/[\w-]+$/.test(endpoint), 'Invalid private DevTools endpoint.');
  browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${endpoint}`, { timeout: remaining() });
  try { remaining(); } catch (error) { await closeNativeFileInput(); throw error; }
}

async function closeNativeFileInput() {
  const current = browser;
  browser = undefined;
  // A connectOverCDP client disconnects without closing the target browser.
  if (current) await current.close();
}

async function nativeFileClick({ action, surface, deadline, signal, requireUnfocused = false }) {
  let target, timer, closing;
  const remaining = () => {
    assert(!signal?.aborted && Date.now() < deadline, 'Native file click exceeded its original budget.');
    return deadline - Date.now();
  };
  const disconnect = () => {
    // Closing a connectOverCDP client disconnects it; it does not close VSCode.
    if (browser) closing ??= closeNativeFileInput();
    return closing;
  };
  const abort = () => { void disconnect()?.catch(() => {}); };
  try {
    remaining();
    timer = setTimeout(abort, remaining());
    signal?.addEventListener('abort', abort, { once: true });
    assert(browser?.isConnected(), 'Native file input must attach before Webview creation.');
    let matches = [], frames = [];
    const selector = `[data-node-id=${JSON.stringify(action.nodeId)}] [data-file-entry-path=${JSON.stringify(action.filePath)}]`;
    // CDP may return before existing out-of-process frames finish attaching.
    // Discovery shares the original click deadline, including this bounded poll.
    while (!matches.length) {
      remaining();
      frames = [];
      for (const page of browser.contexts().flatMap(context => context.pages())) {
        for (const frame of page.frames()) {
          remaining();
          const identity = await frame.evaluate(() => window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__);
          remaining();
          frames.push({ url: frame.url(), identity });
          if (identity?.surface !== surface || identity?.mode !== 'active') continue;
          const entries = frame.locator(selector);
          for (const entry of await entries.all()) {
            remaining();
            if (await entry.isVisible()) matches.push(entry);
          }
        }
      }
      assert(matches.length <= 1, `Native file click requires exactly one visible surface/node/file target: ${JSON.stringify({ surface, frames })}`);
      if (!matches.length) await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining())));
    }
    remaining();
    target = await matches[0].elementHandle({ timeout: remaining() });
    assert(target, 'Native file click target disappeared.');
    remaining();
    const before = await target.evaluate(element => {
      const events = [];
      const listener = event => events.push({ type: event.type, trusted: event.isTrusted, button: event.button,
        ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey });
      for (const type of ['pointerdown', 'mousedown', 'click']) element.addEventListener(type, listener, true);
      element.__dscNativeClick = { events, listener };
      return { documentFocus: document.hasFocus() };
    });
    if (requireUnfocused) assert.equal(before.documentFocus, false, 'Native regression requires editor focus before input.');
    // ElementHandle keeps the original target pinned. Normal Playwright input
    // checks stability, visibility, enabled state and hit targets across frames.
    // No force, DOM dispatch, focus(), or retry after a business click.
    await target.click({ button: 'left', modifiers: [], timeout: remaining() });
    remaining();
    const events = await target.evaluate(element => element.__dscNativeClick.events);
    remaining();
    assert.deepEqual(events.map(event => event.type), ['pointerdown', 'mousedown', 'click']);
    assert(events.every(event => event.trusted && event.button === 0 && !event.ctrl && !event.meta && !event.alt && !event.shift),
      'Expected one trusted plain left-click on the original file entry.');
    return { surface, nodeId: action.nodeId, filePath: action.filePath, before, events };
  } finally {
    // On timeout, disconnect first so pending actionability work cannot click later.
    if (signal?.aborted || Date.now() >= deadline) await disconnect();
    else if (target) {
      await target.evaluate(element => {
        const evidence = element.__dscNativeClick;
        if (!evidence) return;
        for (const type of ['pointerdown', 'mousedown', 'click']) element.removeEventListener(type, evidence.listener, true);
        delete element.__dscNativeClick;
      }).catch(() => {}); // A product navigation may already have retired the frame.
    }
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

module.exports = { initializeNativeFileInput, nativeFileClick, closeNativeFileInput };
