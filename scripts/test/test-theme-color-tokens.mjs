import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainWebviewStyles = await readFile('src/webview/styles.css', 'utf8');
const notifierSidebarSource = await readFile(
  'extensions/vscode/dev-session-canvas-notifier/src/sidebarView.ts',
  'utf8'
);

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
