import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('extensions/vscode/dev-session-canvas-notifier/src/sidebarView.ts', 'utf8');

assert.match(
  source,
  /resolveSectionContent\(section, snapshot, ctx\)/u,
  '各 section 的正文内容应先收口成统一的 section content 模型。'
);
assert.match(
  source,
  /renderSectionContentBody\(content\)/u,
  '统一的 section content 模型应通过通用 Markdown body renderer 输出。'
);
assert.match(
  source,
  /markdown:\s*buildStatusSummaryMarkdown\(snapshot\),\s*\n\s*markdownClassName:\s*'is-prominent',\s*\n\s*actionsMarkdown:\s*buildStatusActionsMarkdown\(\)/u,
  '概览 section 的摘要与调试通知标题都应以 Markdown 文档字段提供。'
);
assert.match(
  source,
  /calloutHeadingMarkdown:\s*buildStatusResultHeadingMarkdown\(\)/u,
  '概览 section 的调试结果标题也应以 Markdown 文档字段提供。'
);
assert.match(
  source,
  /markdown:\s*snapshot\.notes\.length > 0 \? buildNotesMarkdown\(snapshot\.notes\) : '暂无注意事项。',\s*\n\s*markdownClassName:\s*'is-flush-list'/u,
  '注意事项 section 应直接返回 Markdown 文档内容，并把根列表收口为 0 级缩进。'
);
assert.match(
  source,
  /markdown:\s*buildPlatformGuideMarkdown\(snapshot, guide, guide\.statusLabel === '当前平台'\)/u,
  '平台 section 应直接返回 Markdown 文档内容。'
);
assert.match(
  source,
  /markdown:\s*buildAgentGuideMarkdown\(guide\)/u,
  'Agent section 应直接返回 Markdown 文档内容。'
);
assert.match(
  source,
  /function renderSectionCallout\(callout: SidebarSectionCallout\): string \{\s*const toneClassName = callout\.tone === 'warning' \? ' warning' : '';\s*return `\s*<div class="status-card\$\{toneClassName\}">\s*<div class="status-card-body">\s*\$\{callout\.iconSvg\}\s*\$\{renderMarkdownPreview\(callout\.markdown, callout\.markdownClassName\)\}/u,
  '概览状态卡应让图标与 Markdown 文案保持同一层级。'
);
assert.match(
  source,
  /function buildStatusSummaryMarkdown\(snapshot: NotifierEnvironmentSnapshot\): string \{\s*return \[\s*'### 当前环境'/u,
  '概览摘要 Markdown 应先给出“当前环境”标题。'
);
assert.match(
  source,
  /function buildStatusActionsMarkdown\(\): string \{\s*return '### 调试通知';/u,
  '调试按钮区域前应有“调试通知”标题。'
);
assert.match(
  source,
  /function buildStatusResultHeadingMarkdown\(\): string \{\s*return '### 调试结果';/u,
  '调试结果区域前应有“调试结果”标题。'
);
assert.match(
  source,
  /function buildNotesMarkdown\(notes: string\[\]\): string \{\s*return buildBulletListMarkdown\(notes\);/u,
  '注意事项 section 应通过 Markdown 列表而不是手写 ul\/li 生成内容。'
);
assert.doesNotMatch(
  source,
  /function buildNotesSectionContent[\s\S]*?<div class="content">/u,
  'section 内容构造函数不应再手写 HTML 片段。'
);
assert.match(
  source,
  /\.sidebar-markdown > ul,\s*\n\s*\.sidebar-markdown > ol\s*\{\s*\n\s*padding-left:\s*12px;/u,
  '一级 Markdown 列表应比嵌套列表更浅，避免看起来像第二层。'
);
assert.match(
  source,
  /\.sidebar-markdown\.is-flush-list > ul,\s*\n\s*\.sidebar-markdown\.is-flush-list > ol\s*\{\s*\n\s*padding-left:\s*0;/u,
  '注意事项 section 的根列表应允许退到 0 级缩进。'
);
assert.match(
  source,
  /\.sidebar-markdown ul ul,\s*\n\s*\.sidebar-markdown ul ol,\s*\n\s*\.sidebar-markdown ol ul,\s*\n\s*\.sidebar-markdown ol ol\s*\{\s*\n\s*padding-left:\s*16px;/u,
  '嵌套 Markdown 列表应继续保留更深的缩进层级。'
);
assert.match(
  source,
  /\.sidebar-markdown pre\s*\{\s*\n\s*margin:\s*8px 0 0 0;\s*\n\s*padding:\s*10px 12px;/u,
  'sidebar 代码块应按标准 Markdown pre 结构样式化。'
);
assert.doesNotMatch(source, /snippet-block/u, 'sidebar 代码块不应继续使用自定义 snippet-block 结构。');
assert.doesNotMatch(source, /notes-list/u, 'notifier sidebar 不应继续依赖旧的 notes-list 手写列表结构。');
assert.doesNotMatch(source, /hint-list/u, 'notifier sidebar 不应继续依赖旧的 hint-list 手写列表结构。');

console.log('notifier sidebar view source tests passed');
