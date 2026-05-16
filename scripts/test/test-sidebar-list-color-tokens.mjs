import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const designSystemSource = await readFile('docs/UI.md', 'utf8');
assert.match(
  designSystemSource,
  /Webview 自绘 sidebar 列表必须按 VSCode list 状态 token 成对绑定颜色/u,
  'Expected docs/UI.md to document the sidebar Webview list color-token contract.'
);

const sidebarListViews = [
  {
    path: 'src/sidebar/CanvasSidebarTemplateView.ts',
    rowClass: 'template-row'
  },
  {
    path: 'src/sidebar/CanvasSidebarNodeListView.ts',
    rowClass: 'node-row'
  },
  {
    path: 'src/sidebar/CanvasSidebarSessionHistoryView.ts',
    rowClass: 'session-row'
  }
];

for (const view of sidebarListViews) {
  const source = await readFile(view.path, 'utf8');
  assert.ok(
    source.includes('--fg: var(--vscode-foreground, var(--vscode-sideBar-foreground));'),
    `${view.path} should not use sideBar.foreground as the only sidebar list foreground.`
  );
  assert.ok(
    source.includes('--list-hover-fg: var(--vscode-list-hoverForeground, var(--fg));'),
    `${view.path} should pair list hover background with list hover foreground.`
  );
  assert.ok(
    source.includes('--list-active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));'),
    `${view.path} should pair active list selection background with foreground.`
  );
  assert.ok(
    source.includes('--list-inactive: var(--vscode-list-inactiveSelectionBackground, color-mix(in srgb, var(--focus) 10%, transparent));'),
    `${view.path} should use inactive list selection background for retained selection.`
  );
  assert.ok(
    source.includes('--list-inactive-fg: var(--vscode-list-inactiveSelectionForeground, var(--fg));'),
    `${view.path} should pair inactive list selection background with foreground.`
  );
  assert.ok(
    source.includes(`.${view.rowClass}.is-selected {`) &&
      source.includes('--row-fg: var(--list-inactive-fg);') &&
      source.includes(`.${view.rowClass}.is-selected:focus,`),
    `${view.path} should distinguish inactive retained selection from focused active selection.`
  );
}

console.log('sidebar list color token tests passed');
