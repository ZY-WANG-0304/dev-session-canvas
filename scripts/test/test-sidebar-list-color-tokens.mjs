import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readText(path) {
  return normalizeNewlines(await readFile(path, 'utf8'));
}

function normalizeNewlines(source) {
  return source.replace(/\r\n?/g, '\n');
}

function extractCssRuleBody(source, selector) {
  const startMarker = `${selector} {`;
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Expected to find CSS rule ${selector}.`);

  const bodyStartIndex = startIndex + startMarker.length;
  const endIndex = source.indexOf('\n      }', bodyStartIndex);
  assert.notEqual(endIndex, -1, `Expected to find CSS rule end for ${selector}.`);

  return source.slice(bodyStartIndex, endIndex);
}

const designSystemSource = await readText('docs/UI.md');
const statusPresentationSource = await readText('extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts');
assert.match(
  designSystemSource,
  /Webview 自绘 sidebar 列表必须按 VSCode list 状态 token 成对绑定颜色/u,
  'Expected docs/UI.md to document the sidebar Webview list color-token contract.'
);

const sidebarListViews = [
  {
    path: 'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarTemplateView.ts',
    rowClass: 'template-row'
  },
  {
    path: 'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts',
    rowClass: 'node-row'
  },
  {
    path: 'extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarSessionHistoryView.ts',
    rowClass: 'session-row'
  }
];

for (const view of sidebarListViews) {
  const source = await readText(view.path);
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

const nodeListSource = await readText('extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts');
const nodeRowStyles = extractCssRuleBody(nodeListSource, '.node-row');
const sidebarStatusPillStyles = extractCssRuleBody(nodeListSource, '.status-pill');
const sidebarStatusToneFunction = statusPresentationSource.slice(
  statusPresentationSource.indexOf('export function canvasStatusToneClass'),
  statusPresentationSource.indexOf('export function humanizeCanvasNodeStatus')
);
assert.ok(
  sidebarStatusPillStyles.includes('--status-pill-bg: color-mix(in srgb, var(--status-pill-accent) 18%, transparent);'),
  'Sidebar node list status pills should share the main status pill background recipe.'
);
assert.ok(
  sidebarStatusPillStyles.includes('--status-pill-border: color-mix(in srgb, var(--status-pill-accent) 42%, var(--vscode-panel-border) 58%);'),
  'Sidebar node list status pills should share the main status pill border recipe.'
);
assert.match(
  sidebarStatusPillStyles,
  /border-radius:\s*6px;/u,
  'Sidebar node list status pills should use rounded-rectangle corners instead of a full pill radius.'
);
assert.doesNotMatch(
  nodeRowStyles,
  /--status-pill-(?:accent|bg|border|fg):/u,
  'Sidebar node list should define status pill variables on the pill element so tone classes drive matching colors.'
);
assert.ok(
  nodeListSource.includes("statusPill.className = 'status-pill ' + item.statusTone;"),
  'Sidebar node list should render node status as a status pill, not plain subtitle text.'
);
assert.match(
  nodeListSource,
  /localizeCanvasNodeStatus\(node\)[\s\S]*canvasNodeStatusToneClass\(node\)/u,
  'Sidebar node list should use the shared status descriptor and tone mapping.'
);
assert.doesNotMatch(
  nodeListSource,
  /function (?:humanizeNodeStatus|humanizeNoteStatus|humanizeStatus|statusToneClassForNode|statusToneClass)\(/u,
  'Sidebar node list should not keep local status text mapping names or tone mappings that can drift.'
);
assert.match(
  sidebarStatusToneFunction,
  /case 'resume-failed':\s*case 'error':\s*case 'missing':\s*case 'not-file':\s*case 'unsupported-extension':\s*case 'unreadable':\s*case 'dirty-conflict':\s*return 'tone-error';/u,
  'Sidebar Note file abnormal statuses should map to the error tone instead of falling back to idle.'
);
assert.match(
  statusPresentationSource,
  /case 'idle':\s*return localizedCanvasStatusLabel\('status\.idle'\);/u,
  'Sidebar node list should use the same idle status label id as the canvas.'
);
assert.match(
  statusPresentationSource,
  /contentSource\.status === 'ok'[\s\S]*?localizedCanvasStatusLabel\('status\.noteAssociatedFile'\)[\s\S]*?canvasStatusLabelDescriptor\(contentSource\.status\)/u,
  'Sidebar node list should label ok associated Markdown notes with the linked-file label id.'
);
assert.ok(
  statusPresentationSource.includes("localizedCanvasStatusLabel('status.notePlain')"),
  'Sidebar node list should label embedded ready notes with the plain Note label id.'
);

console.log('sidebar list color token tests passed');
