import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

let fixtureScript;
let xtermCss;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import { Terminal } from '@xterm/xterm';
        import { preserveExecutionLinkOnSelectionRedraw } from './extensions/vscode/dev-session-canvas/src/webview/executionTerminalSelectionLinkRendering';
        window.startFixture = async (underline) => {
          const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
          terminal.open(document.getElementById('terminal'));
          const original = terminal._core._renderService.handleSelectionChanged;
          const dispose = preserveExecutionLinkOnSelectionRedraw(terminal);
          const calls = { hover: 0, open: 0 };
          terminal.registerLinkProvider({ provideLinks(line, callback) {
            callback(line === 1 ? [{ text: 'link-target', range: { start: { x: 1, y: 1 }, end: { x: 11, y: 1 } },
              decorations: { underline, pointerCursor: true }, hover() { calls.hover += 1; }, activate() { calls.open += 1; } }] : undefined);
          } });
          await new Promise(resolve => terminal.write('link-target\\r\\nselection-target', resolve));
          window.fixture = { terminal, dispose, original, calls };
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        };`,
      resolveDir: process.cwd()
    },
    bundle: true, write: false, format: 'iife', platform: 'browser'
  });
  fixtureScript = result.outputFiles[0].text;
  xtermCss = await readFile('node_modules/@xterm/xterm/css/xterm.css', 'utf8');
});

async function openFixture(page, underline = true) {
  await page.setContent('<div id="terminal" style="width:500px;height:160px"></div>');
  await page.addStyleTag({ content: xtermCss });
  await page.addScriptTag({ content: fixtureScript });
  await page.evaluate(value => window.startFixture(value), underline);
  const row = await page.locator('.xterm-rows > div').first().boundingBox();
  await page.mouse.move(row.x + 20, row.y + row.height / 2);
  await expect.poll(() => page.evaluate(() => window.fixture.terminal._core.linkifier.currentLink?.link.text)).toBe('link-target');
}

async function underlineText(page) {
  return page.locator('.xterm-rows').evaluate(rows => Array.from(rows.querySelectorAll('span'))
    .filter(span => span.style.textDecoration.includes('underline')).map(span => span.textContent).join(''));
}

async function changeSelection(page, clear = false) {
  // clearSelection/select queue SelectionService's real draw before this frame callback.
  await page.evaluate(async clearSelection => {
    const terminal = window.fixture.terminal;
    if (clearSelection) terminal.clearSelection();
    else terminal.select(0, 1, 'selection-target'.length);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }, clear);
}

test('active terminal link stays underlined after selection draw and clear', async ({ page }) => {
  await openFixture(page);
  await expect.poll(() => underlineText(page)).toBe('link-target');
  const calls = await page.evaluate(() => ({ ...window.fixture.calls }));
  await changeSelection(page);
  expect(await page.evaluate(() => window.fixture.terminal.getSelection())).toBe('selection-target');
  expect(await underlineText(page)).toBe('link-target');
  await changeSelection(page, true);
  expect(await underlineText(page)).toBe('link-target');
  expect(await page.evaluate(() => window.fixture.calls)).toEqual(calls);
});

test('selection redraw respects disabled link underline', async ({ page }) => {
  await openFixture(page, false);
  await changeSelection(page);
  expect(await underlineText(page)).toBe('');
});

test('selection redraw does not revive a link after the pointer leaves', async ({ page }) => {
  await openFixture(page);
  await expect.poll(() => underlineText(page)).toBe('link-target');
  await page.mouse.move(800, 300);
  await changeSelection(page);
  expect(await underlineText(page)).toBe('');
});

test('selection link rendering adapter restores the original method on dispose', async ({ page }) => {
  await openFixture(page);
  expect(await page.evaluate(() => {
    const { terminal, dispose, original } = window.fixture;
    dispose();
    return terminal._core._renderService.handleSelectionChanged === original;
  })).toBe(true);
});
