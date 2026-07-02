import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainWebviewStyles = await readText('extensions/vscode/dev-session-canvas/src/webview/styles.css');
const mainWebviewSource = await readText('extensions/vscode/dev-session-canvas/src/webview/main.tsx');
const designSystemSource = await readText('docs/UI.md');
const multiRootDesignSource = await readText('docs/design-docs/canvas-multi-root-workspace-support.md');
const multiRootSpecSource = await readText('docs/product-specs/canvas-multi-root-workspace-support.md');
const statusPresentationSource = await readText('extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts');
const notifierSidebarSource = await readText('extensions/vscode/dev-session-canvas-notifier/src/sidebarView.ts');

async function readText(path) {
  return normalizeNewlines(await readFile(path, 'utf8'));
}

function normalizeNewlines(source) {
  return source.replace(/\r\n?/g, '\n');
}

function extractCssRange(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find CSS marker ${startMarker}.`);

  const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);
  assert.notEqual(endIndex, -1, `Expected to find CSS marker ${endMarker}.`);

  return source.slice(startIndex, endIndex);
}

function extractCssRuleBody(source, selector) {
  const startMarker = `${selector} {`;
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find CSS rule ${selector}.`);

  const bodyStartIndex = startIndex + startMarker.length;
  const endIndex = source.indexOf('\n}', bodyStartIndex);
  assert.notEqual(endIndex, -1, `Expected to find CSS rule end for ${selector}.`);

  return source.slice(bodyStartIndex, endIndex);
}

assert.match(
  mainWebviewStyles,
  /--restricted-banner-fg:\s*var\(--vscode-inputValidation-warningForeground,\s*var\(--vscode-editor-foreground\)\);/u,
  'Restricted banner text should use warning foreground with editor foreground fallback.'
);
assert.match(
  mainWebviewStyles,
  /--vscode-inputValidation-warningBackground/u,
  'Restricted banner should use VS Code warning validation background before fixed warning colors.'
);
assert.doesNotMatch(
  mainWebviewStyles,
  /rgba\(245,\s*158,\s*11/u,
  'Restricted banner should not use fixed amber rgba colors.'
);
assert.doesNotMatch(
  mainWebviewStyles,
  /#fcd34d/iu,
  'Restricted banner title should not use a fixed light-yellow text color.'
);
assert.match(
  mainWebviewStyles,
  /\.agent-bubble\.state-error\s*\{[\s\S]*?--vscode-errorForeground/u,
  'Agent error bubble border should derive from VS Code error foreground.'
);
assert.doesNotMatch(
  mainWebviewStyles,
  /rgba\(248,\s*113,\s*113/u,
  'Agent error bubble border should not use a fixed red rgba color.'
);

const statusBaseStyles = extractCssRange(
  mainWebviewStyles,
  '.status-pill,\n.node-overview-status',
  '.node-overview-status {'
);
const overviewStatusStyles = extractCssRange(
  mainWebviewStyles,
  '.node-overview-status {',
  '.canvas-shell.is-overview-mode'
);
const statusPillStyles = extractCssRange(mainWebviewStyles, '.status-pill {', '.tone-starting');
const statusToneStyles = extractCssRange(mainWebviewStyles, '.tone-starting', '.session-body');
const idleToneStyles = extractCssRuleBody(mainWebviewStyles, '.tone-idle');
const errorToneStyles = extractCssRuleBody(mainWebviewStyles, '.tone-error');
assert.match(
  statusBaseStyles,
  /--status-pill-fg:\s*var\(--status-pill-accent\);/u,
  'Status pill text should use the status accent rather than ordinary body text color.'
);
assert.match(
  statusBaseStyles,
  /--status-pill-bg:\s*color-mix\(in srgb,\s*var\(--status-pill-accent\)\s*18%,\s*transparent\);/u,
  'Overview and ordinary status pills should share the same status background recipe.'
);
assert.match(
  statusBaseStyles,
  /--status-pill-border:\s*color-mix\(in srgb,\s*var\(--status-pill-accent\)\s*42%,\s*var\(--vscode-panel-border\)\s*58%\);/u,
  'Overview and ordinary status pills should share the same status border recipe.'
);
assert.match(
  statusToneStyles,
  /--status-pill-accent:\s*var\(--vscode-debugIcon-startForeground,\s*var\(--vscode-debugIcon-restartForeground,\s*var\(--vscode-focusBorder\)\)\);/u,
  'Running status pill should derive its accent from VS Code debug start/restart tokens.'
);
assert.match(
  statusToneStyles,
  /--status-pill-accent:\s*var\(--vscode-debugIcon-startForeground,\s*var\(--vscode-focusBorder\)\);/u,
  'Starting status pill should derive its accent from VS Code debug start token.'
);
assert.match(
  statusToneStyles,
  /--status-pill-accent:\s*var\(--vscode-debugIcon-pauseForeground,\s*var\(--vscode-focusBorder\)\);/u,
  'Waiting status pill should derive its accent from VS Code debug pause token.'
);
assert.match(
  statusToneStyles,
  /--vscode-debugView-exceptionLabelForeground/u,
  'Error status pill should derive its foreground from VS Code debug exception label token.'
);
assert.doesNotMatch(
  `${statusBaseStyles}\n${statusPillStyles}\n${statusToneStyles}`,
  /#[0-9A-Fa-f]{3,8}/u,
  'Status pills should not use fixed hex colors for text, background, or border.'
);
assert.doesNotMatch(
  idleToneStyles,
  /--status-pill-(?:bg|border):/u,
  'Idle status should use the shared status background and border recipe.'
);
assert.doesNotMatch(
  errorToneStyles,
  /--status-pill-(?:bg|border):/u,
  'Error status should use the shared status background and border recipe.'
);
assert.match(
  overviewStatusStyles,
  /border:\s*calc\(1px \* var\(--canvas-overview-title-scale,\s*1\)\)\s*solid\s*var\(--status-pill-border\);/u,
  'Overview status should reuse status pill border tokens.'
);
assert.match(
  overviewStatusStyles,
  /background:\s*var\(--status-pill-bg\);/u,
  'Overview status should reuse status pill background token.'
);
assert.match(
  overviewStatusStyles,
  /color:\s*var\(--status-pill-fg\);/u,
  'Overview status text and dot should reuse status pill foreground token.'
);
assert.match(
  designSystemSource,
  /backgroundColor:\s*"status accent mixed at 18% with transparent"[\s\S]*borderColor:\s*"status accent mixed at 42% with panel border"/u,
  'docs/UI.md should keep the status pill recipe aligned with implementation.'
);
assert.match(
  designSystemSource,
  /`Agent` \/ `Terminal` 标题栏状态胶囊、概览态执行节点状态胶囊、sidebar 节点列表中的状态胶囊都应复用同一套状态 accent、背景和边框推导规则/u,
  'docs/UI.md should require all status pill surfaces to share the same color system.'
);
assert.match(
  designSystemSource,
  /关联 Markdown 的 `contentSource\.status = ok` 展示为 `已关联文件`，普通内嵌 `ready` 展示为 `普通笔记`/u,
  'docs/UI.md should document the shared Note status label mapping.'
);

const statusToneFunction = extractCssRange(
  statusPresentationSource,
  'export function canvasStatusToneClass',
  'export function humanizeCanvasNodeStatus'
);
const noteStatusFunction = extractCssRange(
  statusPresentationSource,
  'function humanizeNoteStatus',
  'export function humanizeCanvasStatus'
);
assert.match(
  mainWebviewSource,
  /canvasStatusToneClass as statusToneClass[\s\S]*humanizeCanvasNodeStatus[\s\S]*humanizeCanvasStatus as humanizeStatus/u,
  'Main webview should use the shared canvas node status presentation mapping.'
);
assert.doesNotMatch(
  mainWebviewSource,
  /function (?:humanizeCanvasNodeStatus|humanizeNoteStatus|humanizeStatus|statusToneClass)\(/u,
  'Main webview should not keep local status text or tone mappings that can drift.'
);
assert.match(
  statusToneFunction,
  /case 'launching':\s*case 'starting':\s*return 'tone-starting';/u,
  'Launching and starting statuses should map to debug start tone.'
);
assert.match(
  statusToneFunction,
  /case 'resuming':\s*case 'reattaching':\s*return 'tone-resuming';/u,
  'Resuming and reattaching statuses should map to debug restart tone.'
);
assert.match(
  statusToneFunction,
  /case 'live':\s*case 'waiting-input':\s*case 'resume-ready':\s*return 'tone-waiting';/u,
  'Live and waiting statuses should map to debug pause tone.'
);
assert.match(
  statusToneFunction,
  /case 'history-restored':\s*return 'tone-history';/u,
  'History restored status should map to debug step-back tone.'
);
assert.match(
  statusToneFunction,
  /case 'resume-failed':\s*case 'error':\s*case 'missing':\s*case 'not-file':\s*case 'unsupported-extension':\s*case 'unreadable':\s*case 'dirty-conflict':\s*return 'tone-error';/u,
  'Note file abnormal statuses should map to the error tone instead of falling back to idle.'
);
assert.match(
  noteStatusFunction,
  /contentSource\?\.kind === 'markdown-file'[\s\S]*?contentSource\.status === 'ok' \? '已关联文件' : humanizeCanvasStatus\(contentSource\.status\)/u,
  'Associated Markdown notes should use their content source status as the presentation source of truth.'
);
assert.match(
  noteStatusFunction,
  /node\.status === 'ready'[\s\S]*?return '普通笔记';/u,
  'Embedded ready notes should display as ordinary notes.'
);

const fileAccessStyles = extractCssRange(mainWebviewStyles, '.file-access-badge', '.file-list-tree');
assert.match(
  fileAccessStyles,
  /--file-access-fg:\s*var\(--vscode-editor-foreground\);/u,
  'File access badges should use theme foreground as their default readable text color.'
);
assert.match(
  fileAccessStyles,
  /--file-access-accent:\s*var\(--vscode-notificationsInfoIcon-foreground,\s*var\(--vscode-focusBorder\)\);/u,
  'Read access badge should derive its accent from VS Code info/focus tokens.'
);
assert.doesNotMatch(
  fileAccessStyles,
  /#[0-9A-Fa-f]{3,8}/u,
  'File access badges and indicators should not use fixed hex colors.'
);

const paneGalleryRunningScanlineKeyframes = extractCssRange(
  mainWebviewStyles,
  '@keyframes pane-gallery-root-running-scanline',
  '@media (prefers-reduced-motion: reduce)'
);
const paneGalleryRunningScanlineRule = extractCssRuleBody(
  mainWebviewStyles,
  '.pane-gallery-root-header.is-pane-gallery-root-running-scanline'
);
const paneGalleryRunningScanlineLayerRule = extractCssRuleBody(
  mainWebviewStyles,
  '.pane-gallery-root-header.is-pane-gallery-root-running-scanline::after'
);
assert.doesNotMatch(
  paneGalleryRunningScanlineKeyframes,
  /opacity:\s*0\b/u,
  'Pane Gallery root running scanline should not fade out between animation loops.'
);
assert.match(
  paneGalleryRunningScanlineKeyframes,
  /0%\s*\{[\s\S]*opacity:\s*var\(--pane-gallery-root-running-scanline-opacity\);[\s\S]*100%\s*\{[\s\S]*opacity:\s*var\(--pane-gallery-root-running-scanline-opacity\);/u,
  'Pane Gallery root running scanline should keep the moving segment visible at both loop boundaries.'
);
assert.match(
  paneGalleryRunningScanlineRule,
  /--pane-gallery-root-running-scanline-travel:\s*100%;/u,
  'Pane Gallery root running scanline should keep its original travel distance.'
);
assert.match(
  paneGalleryRunningScanlineLayerRule,
  /left:\s*-28px;[\s\S]*width:\s*calc\(100% \+ 56px\);[\s\S]*opacity:\s*var\(--pane-gallery-root-running-scanline-opacity\);[\s\S]*animation:\s*pane-gallery-root-running-scanline 3s cubic-bezier\(0\.45, 0, 0\.25, 1\) infinite;/u,
  'Pane Gallery root running scanline layer should start outside the header, fully leave it, and keep the original timing curve.'
);
assert.match(
  multiRootDesignSource,
  /两次扫描之间不保留空档/u,
  'Multi-root design doc should record the continuous Pane Gallery root running scanline behavior.'
);
assert.match(
  multiRootSpecSource,
  /两次扫描之间不保留空档/u,
  'Multi-root product spec should record the continuous Pane Gallery root running scanline behavior.'
);

assert.match(
  notifierSidebarSource,
  /background:\s*var\(--vscode-sideBar-background,\s*var\(--vscode-editor-background\)\);/u,
  'Notifier sidebar body should explicitly use the VS Code sidebar background.'
);
assert.match(
  notifierSidebarSource,
  /--notifier-sidebar-border:\s*var\(\s*--vscode-sideBarSectionHeader-border,\s*var\(--vscode-widget-border,\s*var\(--vscode-panel-border,\s*transparent\)\)\s*\);/u,
  'Notifier sidebar separators should have a sidebar border fallback chain.'
);

const sidebarMarkdownMatch = notifierSidebarSource.match(/\.sidebar-markdown\s*\{(?<body>[\s\S]*?)\n\s*\}/u);
assert.ok(sidebarMarkdownMatch?.groups?.body, 'Expected notifier sidebar markdown base styles.');
const sidebarMarkdownBody = sidebarMarkdownMatch.groups.body;
assert.match(
  sidebarMarkdownBody,
  /color:\s*var\(--vscode-descriptionForeground\);/u,
  'Notifier markdown preview base should use VS Code description foreground semantics.'
);
assert.match(
  sidebarMarkdownBody,
  /font-size:\s*12px;/u,
  'Notifier markdown preview base should keep compact sidebar body typography.'
);
const prominentMarkdownMatch = notifierSidebarSource.match(/\.sidebar-markdown\.is-prominent\s*\{(?<body>[\s\S]*?)\n\s*\}/u);
assert.ok(prominentMarkdownMatch?.groups?.body, 'Expected notifier prominent markdown styles.');
const prominentMarkdownBody = prominentMarkdownMatch.groups.body;
assert.match(
  prominentMarkdownBody,
  /color:\s*var\(--vscode-foreground,\s*var\(--vscode-sideBar-foreground,\s*var\(--vscode-editor-foreground\)\)\);/u,
  'Prominent notifier markdown should promote summary text back to VS Code foreground semantics.'
);

console.log('theme color token tests passed');
