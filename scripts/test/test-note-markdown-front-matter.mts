import assert from 'node:assert/strict';

import { parseNoteMarkdownFrontMatter } from '../../extensions/vscode/dev-session-canvas/src/webview/noteMarkdownFrontMatter.ts';

function run(): void {
  const frontMatterBlock = ['---', 'title: Note 与 Markdown 文件关联', 'domains:', '  - VSCode 集成域', '  - 画布', '---', ''].join('\n');
  const body = ['# 正文标题', '', '- [ ] 保留正文'].join('\n');
  const parsed = parseNoteMarkdownFrontMatter(`${frontMatterBlock}${body}`);
  assert.equal(parsed.kind, 'valid', '合法 front matter 应被识别。');
  assert.equal(parsed.body, body, '合法 front matter 应从预览 body 中剥离。');
  assert.equal(parsed.lineOffset, 6, '行号 offset 应等于被隐藏的 front matter 行数。');
  assert.equal(parsed.rawBlock, frontMatterBlock, 'rawBlock 应保留原始 front matter 供复制。');
  assert.deepEqual(
    parsed.entries,
    [
      { key: 'title', value: 'Note 与 Markdown 文件关联' },
      { key: 'domains', value: 'VSCode 集成域 +1', title: 'VSCode 集成域, 画布' }
    ],
    'metadata entries 应维持当前 popover 摘要格式。'
  );

  const dotted = parseNoteMarkdownFrontMatter(['---', 'title: dotted', '...', '# Body'].join('\n'));
  assert.equal(dotted.kind, 'valid', 'front matter 应支持 ... 作为结束分隔符。');
  assert.equal(dotted.body, '# Body');
  assert.equal(dotted.lineOffset, 3);

  const missingEnd = ['---', 'title: missing end', '# Body'].join('\n');
  const invalidMissingEnd = parseNoteMarkdownFrontMatter(missingEnd);
  assert.equal(invalidMissingEnd.kind, 'invalid', '缺少结束分隔符应进入 invalid 状态。');
  assert.equal(invalidMissingEnd.body, missingEnd, 'invalid front matter 不应隐藏原文。');
  assert.equal(invalidMissingEnd.error, 'YAML metadata 缺少结束分隔符。');

  const blockScalar = [
    '---',
    'title: Block scalar',
    'description: |',
    '  第一段',
    '  ---',
    '  第二段',
    '---',
    '# Body'
  ].join('\n');
  const parsedBlockScalar = parseNoteMarkdownFrontMatter(blockScalar);
  assert.equal(parsedBlockScalar.kind, 'valid', '缩进的 --- 属于 YAML block scalar 内容，不应结束 front matter。');
  assert.equal(parsedBlockScalar.body, '# Body');
  assert.equal(parsedBlockScalar.lineOffset, 7);
  assert.deepEqual(
    parsedBlockScalar.entries.find((entry) => entry.key === 'description'),
    { key: 'description', value: '第一段\n---\n第二段\n' }
  );

  const topLevelArray = ['---', '- tag', '---', '# Body'].join('\n');
  const invalidTopLevelArray = parseNoteMarkdownFrontMatter(topLevelArray);
  assert.equal(invalidTopLevelArray.kind, 'invalid', '顶层非 key/value 对象应进入 invalid 状态。');
  assert.equal(invalidTopLevelArray.body, topLevelArray, '顶层非对象时不应隐藏原文。');
  assert.equal(invalidTopLevelArray.error, 'YAML metadata 需要使用 key/value 对象。');

  const emptyFrontMatter = parseNoteMarkdownFrontMatter(['---', '---', '# Body'].join('\n'));
  assert.equal(emptyFrontMatter.kind, 'valid', '空 front matter 仍是合法 metadata。');
  assert.deepEqual(emptyFrontMatter.entries, []);

  const leadingSpaceOpening = [' ---', 'title: not metadata', '---', '# Body'].join('\n');
  const none = parseNoteMarkdownFrontMatter(leadingSpaceOpening);
  assert.equal(none.kind, 'none', '首行带前导空格的 --- 不应被识别为 front matter。');
  assert.equal(none.body, leadingSpaceOpening);
}

run();
console.log('note markdown front matter tests passed');
