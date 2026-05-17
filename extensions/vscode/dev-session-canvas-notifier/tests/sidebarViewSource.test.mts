import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('extensions/vscode/dev-session-canvas-notifier/src/sidebarView.ts', 'utf8');

assert.match(
  source,
  /<ul class="notes-list is-outdented">/u,
  '注意事项 section 的无序列表应降低一级缩进。'
);
assert.match(
  source,
  /renderHintList\(guide\.hints,\s*\{\s*listClassName:\s*'is-outdented'\s*\}\)/u,
  'Codex / Claude Code section 的提示列表应降低一级缩进。'
);
assert.match(
  source,
  /<h3 class="setup-name">\$\{escapeHtml\(req\.name\)\}<\/h3>/u,
  '安装项名称应使用标题语义渲染。'
);
assert.match(
  source,
  /<h3 class="platform-option-title">\$\{escapeHtml\(section\.title\)\}<\/h3>/u,
  'macOS 参考路径中的 terminal-notifier / osascript 应渲染为明显标题。'
);
assert.match(
  source,
  /\.hint-list\.is-outdented,\s*\n\s*\.notes-list\.is-outdented\s*\{\s*\n\s*padding-left:\s*14px;/u,
  '降低一级缩进的列表应有独立 CSS 规则。'
);

console.log('notifier sidebar view source tests passed');
