import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';
import { chromium } from 'playwright';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-sidebar-node-list-'));

try {
  const outfile = path.join(tempDir, 'sidebar-node-list.cjs');
  await esbuild.build({
    stdin: {
      contents: "export { buildSidebarNodeListHtml } from './extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView';",
      resolveDir: process.cwd(),
      sourcefile: 'sidebar-node-list-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18',
    external: ['node-pty'],
    plugins: [
      {
        name: 'mock-vscode',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            loader: 'js',
            contents: `
              const path = require('node:path');
              class Disposable { dispose() {} }
              class EventEmitter { constructor() { this.event = () => new Disposable(); } fire() {} dispose() {} }
              const Uri = {
                joinPath(base, ...segments) {
                  const fsPath = path.join(base?.fsPath || '', ...segments);
                  return {
                    scheme: base?.scheme || 'file',
                    fsPath,
                    path: [base?.path || '', ...segments].filter(Boolean).join('/'),
                    query: '',
                    with(change) { return { ...this, ...change }; }
                  };
                }
              };
              module.exports = {
                Disposable,
                EventEmitter,
                Uri,
                commands: { executeCommand: async () => undefined },
                window: { showWarningMessage: async () => undefined }
              };
            `
          }));
        }
      }
    ]
  });

  const require = createRequire(import.meta.url);
  const { buildSidebarNodeListHtml } = require(outfile);
  const html = buildSidebarNodeListHtml(
    {
      cspSource: 'vscode-resource:',
      asWebviewUri(uri) {
        return `vscode-resource://${uri.fsPath || uri.path || 'resource'}`;
      }
    },
    {
      scheme: 'file',
      fsPath: process.cwd(),
      path: process.cwd(),
      query: '',
      with(change) {
        return { ...this, ...change };
      }
    }
  );

  const browser = await chromium.launch({ headless: true });
  try {
    await assertFlatViewPromotesAttentionRows(browser, html);
    await assertGroupedViewAddsAttentionSection(browser, html);
    await assertMultiRootFlatViewKeepsRootGroups(browser, html);
    await assertRootGroupsFollowWorkspaceOrder(browser, html);
    await assertWorkspaceFolderGroupActions(browser, html);
  } finally {
    await browser.close();
  }

  console.log('sidebar node list tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function assertFlatViewPromotesAttentionRows(browser, html) {
  const page = await createSidebarPage(browser, html);
  try {
    const snapshot = await renderSidebarState(page, {
      viewMode: 'flat',
      groups: [],
      items: [
        item('normal-a', { label: 'Normal A' }),
        item('attention-b', { label: 'Attention B', attentionPending: true }),
        item('normal-c', { label: 'Normal C' })
      ]
    });

    assert.deepEqual(
      snapshot.visibleItemIds,
      ['node/attention-b', 'node/normal-a', 'node/normal-c'],
      'Flat view should keep original row order except promoting attention rows ahead of non-attention rows.'
    );
    assert.deepEqual(snapshot.groupRows, [], 'Single-root flat view should not add virtual or real group rows.');
    assert.equal(snapshot.selectedId, 'node/attention-b', 'Initial selection should prefer the pending attention node.');
  } finally {
    await page.close();
  }
}

async function assertGroupedViewAddsAttentionSection(browser, html) {
  const page = await createSidebarPage(browser, html);
  try {
    const snapshot = await renderSidebarState(page, {
      viewMode: 'grouped',
      groups: [
        group('group-feature', 'Feature Work'),
        group('group-frontend', 'Frontend', { parentGroupId: 'group-feature' })
      ],
      items: [
        item('note-ungrouped', { label: 'Scratch Note' }),
        item('agent-attention', {
          label: 'Blocked Agent',
          attentionPending: true,
          groupPath: ['Feature Work', 'Frontend'],
          groupPathIds: ['group-feature', 'group-frontend']
        })
      ]
    });

    assert.deepEqual(
      snapshot.groupRows.map((row) => row.key),
      ['__attention__', '__ungrouped__', 'group-feature', 'group-frontend'],
      'Grouped view should render a top virtual attention section before regular and ungrouped sections.'
    );
    assert.equal(snapshot.groupRows[0]?.label, '待处理提醒');
    assert.equal(snapshot.groupRows[0]?.virtualKind, 'attention');
    assert.equal(snapshot.visibleItemIds[0], 'node/agent-attention');
    assert.equal(
      snapshot.visibleItemIds.filter((itemId) => itemId === 'node/agent-attention').length,
      2,
      'Attention nodes should appear in the virtual summary and remain visible at their original group location.'
    );
  } finally {
    await page.close();
  }
}

async function assertMultiRootFlatViewKeepsRootGroups(browser, html) {
  const page = await createSidebarPage(browser, html);
  try {
    const snapshot = await renderSidebarState(page, {
      viewMode: 'flat',
      groups: [
        group('workspace-root-frontend', 'Frontend', { role: 'workspace-root', workspaceRootPath: '/repo/frontend' }),
        group('workspace-root-backend', 'Backend', { role: 'workspace-root', workspaceRootPath: '/repo/backend' })
      ],
      items: [
        item('frontend-normal', {
          label: 'Frontend Terminal',
          groupPath: ['Frontend'],
          groupPathIds: ['workspace-root-frontend']
        }),
        item('backend-attention', {
          label: 'Backend Agent',
          attentionPending: true,
          groupPath: ['Backend'],
          groupPathIds: ['workspace-root-backend']
        }),
        item('backend-normal', {
          label: 'Backend Note',
          groupPath: ['Backend'],
          groupPathIds: ['workspace-root-backend']
        })
      ]
    });

    assert.deepEqual(
      snapshot.groupRows.map((row) => row.key),
      ['__attention__', 'workspace-root-frontend', 'workspace-root-backend'],
      'Multi-root flat view should keep root groups and place the virtual attention section before them.'
    );
    assert.equal(snapshot.viewRole, 'tree', 'Multi-root flat view with root grouping should use tree semantics.');
    assert.deepEqual(
      snapshot.visibleItemIds,
      ['node/backend-attention', 'node/frontend-normal', 'node/backend-attention', 'node/backend-normal'],
      'Multi-root flat view should show attention rows in the virtual section before root groups and keep root-local rows grouped.'
    );
  } finally {
    await page.close();
  }
}

async function assertRootGroupsFollowWorkspaceOrder(browser, html) {
  const page = await createSidebarPage(browser, html);
  try {
    const groups = [
      group('workspace-root-alpha', 'Alpha Root', {
        role: 'workspace-root',
        workspaceRootPath: '/repo/alpha',
        workspaceRootOrderIndex: 1
      }),
      group('workspace-root-zeta', 'Zeta Root', {
        role: 'workspace-root',
        workspaceRootPath: '/repo/zeta',
        workspaceRootOrderIndex: 0
      })
    ];
    const items = [
      item('alpha-note', {
        label: 'Alpha Note',
        groupPath: ['Alpha Root'],
        groupPathIds: ['workspace-root-alpha']
      }),
      item('zeta-note', {
        label: 'Zeta Note',
        groupPath: ['Zeta Root'],
        groupPathIds: ['workspace-root-zeta']
      })
    ];

    const groupedSnapshot = await renderSidebarState(page, {
      viewMode: 'grouped',
      groups,
      items
    });

    assert.deepEqual(
      groupedSnapshot.groupRows.map((row) => row.key),
      ['workspace-root-zeta', 'workspace-root-alpha'],
      'Grouped sidebar root groups should follow the workspace folder order instead of label order.'
    );

    const flatSnapshot = await renderSidebarState(page, {
      viewMode: 'flat',
      groups,
      items
    });

    assert.deepEqual(
      flatSnapshot.groupRows.map((row) => row.key),
      ['workspace-root-zeta', 'workspace-root-alpha'],
      'Flat multi-root sidebar root groups should follow the workspace folder order instead of label order.'
    );
    assert.deepEqual(
      flatSnapshot.visibleItemIds,
      ['node/zeta-note', 'node/alpha-note'],
      'Flat multi-root sidebar items should render under workspace-ordered root groups.'
    );
  } finally {
    await page.close();
  }
}

async function assertWorkspaceFolderGroupActions(browser, html) {
  const page = await createSidebarPage(browser, html);
  try {
    const rootPath = '/repo/frontend';
    const snapshot = await renderSidebarState(page, {
      viewMode: 'grouped',
      groups: [
        group('workspace-root-frontend', 'Frontend', {
          role: 'workspace-root',
          workspaceRootPath: rootPath,
          workspaceFolderKind: 'repository'
        }),
        group('workspace-root-scratch', 'Scratch', {
          role: 'workspace-root',
          workspaceRootPath: '/repo/scratch',
          workspaceFolderKind: 'folder'
        }),
        group('workspace-root-linked', 'Linked Worktree', {
          role: 'workspace-root',
          workspaceRootPath: '/repo/main.worktrees/linked',
          workspaceFolderKind: 'worktree'
        }),
        group('group-regular', 'Regular Group')
      ],
      items: [
        item('frontend-note', {
          label: 'Frontend Note',
          groupPath: ['Frontend'],
          groupPathIds: ['workspace-root-frontend'],
          nodeKind: 'note'
        }),
        item('regular-note', {
          label: 'Regular Note',
          groupPath: ['Regular Group'],
          groupPathIds: ['group-regular'],
          nodeKind: 'note'
        })
      ]
    });

    const rootGroupRow = snapshot.groupRows.find((row) => row.key === 'workspace-root-frontend');
    assert.deepEqual(
      rootGroupRow?.folderActionTypes,
      ['createWorktree', 'removeWorktree', 'removeFolder'],
      'Workspace-root group rows should expose folder and worktree actions.'
    );
    assert.equal(rootGroupRow?.folderKind, 'repository');
    assert.equal(rootGroupRow?.folderKindIconClass, 'codicon-repo');
    assert.equal(
      snapshot.groupRows.find((row) => row.key === 'workspace-root-scratch')?.folderKindIconClass,
      'codicon-folder'
    );
    assert.equal(
      snapshot.groupRows.find((row) => row.key === 'workspace-root-linked')?.folderKindIconClass,
      'codicon-worktree'
    );
    const folderGroupActionIcons = await page.$$eval(
      '[data-sidebar-node-group-key="workspace-root-frontend"] [data-sidebar-folder-action]',
      (actions) => actions.map((action) => action.getAttribute('data-sidebar-folder-action-icon'))
    );
    assert.deepEqual(
      folderGroupActionIcons,
      ['codicon-worktree', 'codicon-trash', 'codicon-close'],
      'Workspace-root group rows should use the dedicated worktree Codicon and separate remove icons.'
    );
    const regularGroupRow = snapshot.groupRows.find((row) => row.key === 'group-regular');
    assert.deepEqual(
      regularGroupRow?.folderActionTypes,
      [],
      'Regular user groups should not expose workspace-folder actions.'
    );

    await page.click('[data-sidebar-node-group-key="workspace-root-frontend"] [data-sidebar-folder-action="createWorktree"]');
    const createWorktreeMessage = await lastSidebarMessage(page, 'sidebarNodeList/createWorktreeForRoot');
    assert.deepEqual(createWorktreeMessage?.payload, {
      rootPath,
      groupId: 'workspace-root-frontend'
    });

    await page.click('[data-sidebar-node-group-key="workspace-root-frontend"] [data-sidebar-folder-action="removeFolder"]');
    const removeFolderMessage = await lastSidebarMessage(page, 'sidebarNodeList/removeFolderFromWorkspace');
    assert.deepEqual(removeFolderMessage?.payload, {
      rootPath,
      groupId: 'workspace-root-frontend'
    });

    await page.click('[data-sidebar-node-group-key="workspace-root-frontend"] [data-sidebar-folder-action="removeWorktree"]');
    const removeWorktreeMessage = await lastSidebarMessage(page, 'sidebarNodeList/removeWorktreeFromWorkspace');
    assert.deepEqual(removeWorktreeMessage?.payload, {
      rootPath,
      groupId: 'workspace-root-frontend'
    });
  } finally {
    await page.close();
  }
}

async function createSidebarPage(browser, html) {
  const page = await browser.newPage({ viewport: { width: 320, height: 600 } });
  const testHtml = html.replace(
    'const vscode = acquireVsCodeApi();',
    `
      window.__sidebarNodeListMessages = [];
      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          window.__sidebarNodeListMessages.push(message);
        }
      });
      const vscode = acquireVsCodeApi();`
  );
  await page.setContent(testHtml, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    window.__sidebarNodeListMessages.some((message) => message.type === 'sidebarNodeList/ready')
  );
  return page;
}

async function lastSidebarMessage(page, type) {
  return await page.evaluate((messageType) => {
    const matchingMessages = window.__sidebarNodeListMessages.filter((message) => message.type === messageType);
    return matchingMessages[matchingMessages.length - 1];
  }, type);
}

async function renderSidebarState(page, payload) {
  await page.evaluate((nextPayload) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'sidebarNodeList/state',
        payload: nextPayload
      }
    }));
  }, payload);
  await page.waitForFunction(() => document.querySelectorAll('[data-sidebar-node-item-id]').length > 0);

  return page.evaluate(() => {
    const list = document.getElementById('list');
    const rows = Array.from(document.querySelectorAll('[data-sidebar-node-item-id]'));
    const groupRows = Array.from(document.querySelectorAll('[data-sidebar-node-group-key]'));
    return {
      viewRole: list?.getAttribute('role') || '',
      selectedId: rows.find((row) => row.getAttribute('aria-selected') === 'true')?.getAttribute('data-sidebar-node-item-id'),
      visibleItemIds: rows.map((row) => row.getAttribute('data-sidebar-node-item-id')).filter(Boolean),
      groupRows: groupRows.map((row) => ({
        key: row.getAttribute('data-sidebar-node-group-key') || '',
        label: row.getAttribute('data-sidebar-node-group-label') || '',
        virtualKind: row.getAttribute('data-sidebar-node-group-virtual-kind') || undefined,
        folderKind: row.getAttribute('data-sidebar-workspace-folder-kind') || undefined,
        folderKindIconClass: row.getAttribute('data-sidebar-workspace-folder-kind-icon') || undefined,
        folderActionTypes: Array.from(row.querySelectorAll('[data-sidebar-folder-action]'))
          .map((action) => action.getAttribute('data-sidebar-folder-action'))
          .filter(Boolean),
        folderActionIconClasses: Array.from(row.querySelectorAll('[data-sidebar-folder-action]'))
          .map((action) => action.getAttribute('data-sidebar-folder-action-icon'))
          .filter(Boolean)
      }))
    };
  });
}

function item(id, options = {}) {
  return {
    id: `node/${id}`,
    nodeId: id,
    nodeKind: options.nodeKind || 'agent',
    groupPath: options.groupPath || [],
    groupPathIds: options.groupPathIds || [],
    label: options.label || id,
    description: options.description || '等待输入',
    tooltip: options.tooltip || options.label || id,
    status: options.status || 'Codex · 等待输入',
    statusLabel: options.statusLabel || '等待输入',
    statusTone: options.statusTone || 'tone-waiting',
    subtitlePrefix: options.subtitlePrefix,
    summary: options.summary || '',
    markerColor: options.markerColor || '#22c55e',
    attentionPending: options.attentionPending === true
  };
}

function group(id, title, options = {}) {
  return {
    id,
    title,
    position: { x: 0, y: 0 },
    size: { width: 720, height: 520 },
    parentGroupId: options.parentGroupId,
    role: options.role,
    workspaceRootPath: options.workspaceRootPath,
    workspaceRootOrderIndex: options.workspaceRootOrderIndex,
    workspaceFolderKind: options.workspaceFolderKind
  };
}
