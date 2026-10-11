const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="title" style="height:40px">Node title</div><div id="term" style="height:300px;width:700px"></div>');
    await page.addStyleTag({ path: 'node_modules/@xterm/xterm/css/xterm.css' });
    await page.addScriptTag({ path: 'node_modules/@xterm/xterm/lib/xterm.js' });
    await page.evaluate(async () => {
      window.samples = [];
      window.terminal = new Terminal({ cols: 66, rows: 21 });
      terminal.open(document.querySelector('#term'));
      terminal.onData(input => samples.push(input));
      await new Promise(resolve => terminal.write('\x1b[?1003h\x1b[?1006h', resolve));
    });
    const screen = await page.locator('.xterm-screen').boundingBox();
    await page.mouse.move(screen.x + 30, screen.y + 30);
    const inside = await page.evaluate(() => samples.splice(0));
    assert.ok(inside.some(input => /^\x1b\[<35;/.test(input)));
    await page.mouse.move(30, 20);
    assert.deepEqual(await page.evaluate(() => samples.splice(0)), []);
    await page.mouse.move(50, 20);
    assert.deepEqual(await page.evaluate(() => samples.splice(0)), []);
    console.log('Real xterm: terminal mouse move reports; independent title mouse moves do not report.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
