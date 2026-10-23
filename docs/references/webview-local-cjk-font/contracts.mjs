import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, symlink, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from '/tmp/dsc335-deps/node_modules/playwright/index.mjs';
const repo = '/tmp/dsc335-deps';
const evidence = '/tmp/dsc335-woff-evidence';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.route(/^https?:/, route => route.abort());
  const { applyLocalCjkFont } = await import(pathToFileURL(`${repo}/tests/playwright/fixtures/screenshot-fonts/load.mjs`));
  await page.goto('about:blank');
  await applyLocalCjkFont(page);
  assert.equal(await page.evaluate(() => [...document.fonts].filter(font => font.status === 'loaded').length), 1);
  await page.evaluate(() => {
    document.body.style.setProperty('--vscode-font-family', "'Segoe UI', sans-serif");
    document.body.style.setProperty('--vscode-editor-font-family', 'monospace');
  });
  await applyLocalCjkFont(page);
  assert.deepEqual(await page.evaluate(() => ['--vscode-font-family', '--vscode-editor-font-family'].map(name => document.body.style.getPropertyValue(name))), ["'DSC Screenshot CJK', 'Segoe UI', sans-serif", "'DSC Screenshot CJK', monospace"]);
  await page.goto('about:blank?second-document');
  await applyLocalCjkFont(page);
  assert.equal(await page.evaluate(() => [...document.fonts].filter(font => font.status === 'loaded').length), 1);
  assert(!requests.some(url => /^https?:/.test(url)));
  console.log('PASS local load, theme reapply, fresh document, no HTTP downloads');
  for (const kind of ['font-digest', 'character-digest', 'missing-character']) {
    const temp = await mkdtemp(`${evidence}/contract-`);
    const fixture = `${temp}/tests/playwright/fixtures/screenshot-fonts`;
    await mkdir(`${temp}/tests/playwright/fixtures`, { recursive: true });
    await cp(`${repo}/tests/playwright/fixtures/screenshot-fonts`, fixture, { recursive: true });
    await symlink(`${repo}/extensions`, `${temp}/extensions`);
    const spec = `${temp}/tests/playwright/webview-harness.spec.mjs`;
    await cp(`${repo}/tests/playwright/webview-harness.spec.mjs`, spec);
    let pattern;
    if (kind === 'font-digest') {
      await writeFile(`${fixture}/cjk-regular.woff`, 'corrupt');
      pattern = /CJK font digest mismatch/;
    } else if (kind === 'character-digest') {
      await writeFile(`${fixture}/characters.txt`, 'corrupt');
      pattern = /CJK character manifest digest mismatch/;
    } else {
      await writeFile(spec, `${await readFile(spec, 'utf8')}\n// 龘\n`);
      pattern = /does not cover 龘/;
    }
    const loader = await import(pathToFileURL(`${fixture}/load.mjs`));
    await assert.rejects(() => loader.applyLocalCjkFont(page), pattern);
    console.log(`PASS rejects ${kind}`);
  }
} finally {
  await browser.close();
}
