import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainWebviewStyles = await readFile('src/webview/styles.css', 'utf8');
const mainWebviewSource = await readFile('src/webview/main.tsx', 'utf8');
const notifierSidebarSource = await readFile(
  'extensions/vscode/dev-session-canvas-notifier/src/sidebarView.ts',
  'utf8'
);

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

const statusToneFunction = extractCssRange(mainWebviewSource, 'function statusToneClass', 'function humanizeFileAccessMode');
const noteStatusFunction = extractCssRange(mainWebviewSource, 'function humanizeNoteStatus', 'function humanizeStatus');
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
  noteStatusFunction,
  /contentSource\?\.kind === 'markdown-file' && contentSource\.status === 'ok'[\s\S]*?return '已关联文件';/u,
  'Associated Markdown notes with ok source status should display as linked-file notes.'
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

const currentBadgeMatch = notifierSidebarSource.match(/\.setup-badge\.current\s*\{(?<body>[\s\S]*?)\n\s*\}/u);
assert.ok(currentBadgeMatch?.groups?.body, 'Expected notifier current setup badge styles.');
const currentBadgeBody = currentBadgeMatch.groups.body;
assert.match(
  currentBadgeBody,
  /background:\s*var\(--vscode-badge-background\);/u,
  'Current setup badge should keep badge background semantics.'
);
assert.match(
  currentBadgeBody,
  /color:\s*var\(--vscode-badge-foreground\);/u,
  'Current setup badge should keep badge foreground semantics.'
);
assert.doesNotMatch(
  currentBadgeBody,
  /background:\s*var\(--vscode-testing-iconPassed\)/u,
  'Current setup badge should not use testing icon foreground as its background.'
);
assert.doesNotMatch(
  currentBadgeBody,
  /color:\s*var\(--vscode-button-foreground\)/u,
  'Current setup badge should not pair badge background with button foreground.'
);

console.log('theme color token tests passed');
