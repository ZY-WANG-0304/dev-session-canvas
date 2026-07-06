import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('extensions/vscode/dev-session-canvas-notifier/src/sidebarView.ts', 'utf8');

assert.match(
  source,
  /resolveSectionContent\(section, snapshot, ctx\)/u,
  'Each section should first resolve through the shared section content model.'
);
assert.match(
  source,
  /renderSectionContentBody\(content\)/u,
  'The shared section content model should render through the common Markdown body renderer.'
);
assert.match(
  source,
  /markdown:\s*buildStatusSummaryMarkdown\(snapshot, ctx\),\s*\n\s*markdownClassName:\s*'is-prominent',\s*\n\s*actionsMarkdown:\s*buildStatusActionsMarkdown\(ctx\)/u,
  'Status summary and test-notification heading should remain Markdown document fields and use localized copy.'
);
assert.match(
  source,
  /calloutHeadingMarkdown:\s*buildStatusResultHeadingMarkdown\(ctx\)/u,
  'The status result heading should remain a Markdown document field and use localized copy.'
);
assert.match(
  source,
  /markdown:\s*snapshot\.notes\.length > 0 \? buildNotesMarkdown\(snapshot\.notes\) : ctx\.localize\('No notes yet\.'\),\s*\n\s*markdownClassName:\s*'is-flush-list'/u,
  'Notes should render Markdown content while the empty state comes from localized copy.'
);
assert.match(
  source,
  /markdown:\s*buildPlatformGuideMarkdown\(snapshot, guide, guide\.platformLabel === snapshot\.platformLabel, ctx\)/u,
  'Platform sections should return Markdown document content and determine the current platform from stable labels.'
);
assert.match(
  source,
  /markdown:\s*buildAgentGuideMarkdown\(guide, ctx\)/u,
  'Agent sections should return Markdown document content with localized surrounding copy.'
);
assert.match(
  source,
  /<html lang="\$\{notifierHtmlLang\(ctx\.locale\)\}">/u,
  'Notifier sidebar HTML lang should follow the resolved locale instead of being hard-coded to zh-CN.'
);
assert.match(
  source,
  /label:\s*ctx\.localize\('Send Test Notification'\)/u,
  'The send-test-notification button label should be localized.'
);
assert.match(
  source,
  /label:\s*ctx\.localize\('View Diagnostic Log'\)/u,
  'The diagnostic-output button label should be localized.'
);
assert.match(
  source,
  /function renderSectionCallout\(callout: SidebarSectionCallout\): string \{\s*const toneClassName = callout\.tone === 'warning' \? ' warning' : '';\s*return `\s*<div class="status-card\$\{toneClassName\}">\s*<div class="status-card-body">\s*\$\{callout\.iconSvg\}\s*\$\{renderMarkdownPreview\(callout\.markdown, callout\.markdownClassName\)\}/u,
  'Status cards should keep the icon and Markdown copy at the same level.'
);
assert.match(
  source,
  /function buildStatusSummaryMarkdown\(snapshot: NotifierEnvironmentSnapshot, ctx: SectionRenderContext\): string \{\s*return \[\s*`### \$\{ctx\.localize\('Current environment'\)\}`/u,
  'The status summary Markdown should start with a localized Current environment heading.'
);
assert.match(
  source,
  /function buildStatusActionsMarkdown\(ctx: SectionRenderContext\): string \{\s*return `### \$\{ctx\.localize\('Test notification'\)\}`;/u,
  'The debug button area should have a localized Test notification heading.'
);
assert.match(
  source,
  /function buildStatusResultHeadingMarkdown\(ctx: SectionRenderContext\): string \{\s*return `### \$\{ctx\.localize\('Test result'\)\}`;/u,
  'The debug result area should have a localized Test result heading.'
);
assert.match(
  source,
  /function buildNotesMarkdown\(notes: string\[\]\): string \{\s*return buildBulletListMarkdown\(notes\);/u,
  'The notes section should be generated as a Markdown list rather than handwritten ul/li HTML.'
);
assert.doesNotMatch(
  source,
  /function buildNotesSectionContent[\s\S]*?<div class="content">/u,
  'Section content builders should not handwrite HTML fragments.'
);
assert.match(
  source,
  /\.sidebar-markdown > ul,\s*\n\s*\.sidebar-markdown > ol\s*\{\s*\n\s*padding-left:\s*12px;/u,
  'Top-level Markdown lists should use a shallower indent than nested lists.'
);
assert.match(
  source,
  /\.sidebar-markdown\.is-flush-list > ul,\s*\n\s*\.sidebar-markdown\.is-flush-list > ol\s*\{\s*\n\s*padding-left:\s*0;/u,
  'The notes section root list should be able to flush to zero indent.'
);
assert.match(
  source,
  /\.sidebar-markdown ul ul,\s*\n\s*\.sidebar-markdown ul ol,\s*\n\s*\.sidebar-markdown ol ul,\s*\n\s*\.sidebar-markdown ol ol\s*\{\s*\n\s*padding-left:\s*16px;/u,
  'Nested Markdown lists should keep a deeper indentation level.'
);
assert.match(
  source,
  /\.sidebar-markdown pre\s*\{\s*\n\s*margin:\s*8px 0 0 0;\s*\n\s*padding:\s*10px 12px;/u,
  'Sidebar code blocks should use the standard Markdown pre structure.'
);
assert.doesNotMatch(source, /snippet-block/u, 'Sidebar code blocks should not use the old custom snippet-block structure.');
assert.doesNotMatch(source, /notes-list/u, 'Notifier sidebar should not depend on the old notes-list handwritten list structure.');
assert.doesNotMatch(source, /hint-list/u, 'Notifier sidebar should not depend on the old hint-list handwritten list structure.');

console.log('notifier sidebar view source tests passed');
