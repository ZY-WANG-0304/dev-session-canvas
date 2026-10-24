import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const folder = new URL('./', import.meta.url);
const root = new URL('../../../../', folder);
const family = 'DSC Screenshot CJK';
const cjk = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/gu;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let fixture;

async function* sourceFiles(url) {
  for (const entry of await readdir(url, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
    if (entry.isDirectory()) yield* sourceFiles(child);
    else if (/\.(ts|tsx|json|mjs|html)$/.test(entry.name)) yield child;
  }
}

async function readFixture() {
  const manifest = JSON.parse(await readFile(new URL('provenance.json', folder), 'utf8'));
  const bytes = await readFile(new URL('cjk-regular.woff', folder));
  const text = await readFile(new URL('characters.txt', folder), 'utf8');
  assert.equal(digest(bytes), manifest.files['cjk-regular.woff'].sha256, 'CJK font digest mismatch');
  assert.equal(digest(text), manifest.characters_sha256, 'CJK character manifest digest mismatch');
  const supported = new Set(manifest.codepoints);
  const characters = text.trim();
  for (const character of characters) assert(supported.has(character.codePointAt(0)), `Missing CJK glyph: ${character}`);
  const coverage = new Set(characters);
  for (const source of manifest.source_roots) {
    const url = new URL(source, root);
    const files = /\.[a-z]+$/.test(source) ? [url] : sourceFiles(new URL(source + '/', root));
    for await (const file of files) {
      for (const character of (await readFile(file, 'utf8')).match(cjk) ?? []) {
        assert(coverage.has(character), `CJK fixture does not cover ${character} in ${file.pathname}; regenerate the local subset`);
      }
    }
  }
  const ranges = [...characters].map(c => `U+${c.codePointAt(0).toString(16)}`).join(',');
  return { characters, css: `@font-face { font-family: '${family}'; font-weight: 400; src: url(data:font/woff;base64,${bytes.toString('base64')}) format('woff'); unicode-range: ${ranges}; }` };
}

export async function applyLocalCjkFont(page) {
  if (process.platform !== 'linux') return;
  fixture ??= readFixture();
  const { characters, css } = await fixture;
  const hasFont = await page.evaluate(family =>
    [...document.fonts].some(font => font.family.replaceAll('"', '').replaceAll("'", '') === family), family);
  if (!hasFont) {
    await page.addStyleTag({ content: css });
    await page.evaluate(async ({ family, characters }) => {
      const loaded = await document.fonts.load(`400 16px "${family}"`, characters);
      if (loaded.length !== 1 || loaded[0].status !== 'loaded') throw new Error('Local CJK font did not load');
    }, { family, characters });
  }
  await page.evaluate(family => {
    const style = getComputedStyle(document.body);
    for (const [name, fallback] of [
      ['--vscode-font-family', style.fontFamily || 'sans-serif'],
      ['--vscode-editor-font-family', "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"]
    ]) {
      const previous = style.getPropertyValue(name).trim() || fallback;
      if (!previous.includes(family)) document.body.style.setProperty(name, `'${family}', ${previous}`);
    }
  }, family);
}
