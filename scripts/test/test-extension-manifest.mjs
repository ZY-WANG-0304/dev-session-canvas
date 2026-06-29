import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'extensions', 'vscode', 'dev-session-canvas', 'package.json'), 'utf8'));

assert.deepEqual(
  manifest.categories,
  ['Visualization', 'AI', 'Machine Learning'],
  'Expected Marketplace categories to preserve search discoverability metadata.'
);
assert.deepEqual(
  manifest.keywords,
  ['multi-agent', 'canvas', 'ai workflow', 'terminal', 'session', 'agent', 'workbench', 'collaboration', 'dscanvas'],
  'Expected Marketplace keywords to preserve search discoverability metadata.'
);

const defaultSurface = manifest.contributes.configuration.properties['devSessionCanvas.canvas.defaultSurface'];
assert.equal(defaultSurface.default, 'panel');

const canvasLinkOpenMode =
  manifest.contributes.configuration.properties['devSessionCanvas.canvas.linkOpenMode'];
assert.ok(canvasLinkOpenMode, 'Expected canvas link open mode to be contributed as a configuration property.');
assert.deepEqual(
  canvasLinkOpenMode.enum,
  ['editorPreview', 'externalBrowser'],
  'Expected canvas link open mode to support VS Code editor preview and external browser modes.'
);
assert.equal(
  canvasLinkOpenMode.default,
  'editorPreview',
  'Expected canvas links to preserve VS Code editor preview behavior by default.'
);
assert.equal(canvasLinkOpenMode.scope, 'window');

const multiRootPresentationMode =
  manifest.contributes.configuration.properties['devSessionCanvas.canvas.multiRootPresentationMode'];
assert.ok(
  multiRootPresentationMode,
  'Expected multi-root presentation mode to be contributed as a configuration property.'
);
assert.deepEqual(
  multiRootPresentationMode.enum,
  ['rootGroups', 'paneGallery'],
  'Expected multi-root presentation mode to support root groups and pane gallery.'
);
assert.equal(
  multiRootPresentationMode.default,
  'rootGroups',
  'Expected multi-root workspaces to keep the existing root group canvas by default.'
);
assert.equal(multiRootPresentationMode.scope, 'window');

const enabledAttentionSignals =
  manifest.contributes.configuration.properties['devSessionCanvas.notifications.enabledAttentionSignals'];
assert.ok(enabledAttentionSignals, 'Expected enabledAttentionSignals to be contributed as a configuration property.');
assert.deepEqual(
  enabledAttentionSignals.items.enum,
  ['bel', 'osc9', 'osc777', 'agentAbnormalExit', 'codexAbnormalOutputText'],
  'Expected the attention allow-list to cover terminal signals, Agent abnormal exit, and Codex abnormal text.'
);
assert.deepEqual(
  enabledAttentionSignals.default,
  ['bel', 'osc9', 'osc777', 'agentAbnormalExit', 'codexAbnormalOutputText'],
  'Expected all current attention signals to stay enabled by default.'
);

const agentAbnormalOutputTextNotifications =
  manifest.contributes.configuration.properties['devSessionCanvas.notifications.agentAbnormalOutputTextNotifications'];
assert.ok(
  agentAbnormalOutputTextNotifications,
  'Expected Agent abnormal output text notifications to be contributed as a configuration property.'
);
assert.deepEqual(
  agentAbnormalOutputTextNotifications.enum,
  ['off', 'codex'],
  'Expected Agent abnormal output text notifications to remain explicit opt-in for Codex only.'
);
assert.equal(
  agentAbnormalOutputTextNotifications.default,
  'off',
  'Expected Agent abnormal output text notifications to remain disabled by default.'
);
assert.equal(agentAbnormalOutputTextNotifications.scope, 'window');

const noteMarkdownDroppedTitle =
  manifest.contributes.configuration.properties['devSessionCanvas.noteMarkdown.stripExtensionFromDroppedFileTitle'];
assert.ok(
  noteMarkdownDroppedTitle,
  'Expected dropped Markdown Note title extension stripping to be contributed as a configuration property.'
);
assert.equal(noteMarkdownDroppedTitle.type, 'boolean');
assert.equal(
  noteMarkdownDroppedTitle.default,
  false,
  'Expected dropped Markdown Note titles to preserve the file extension by default.'
);
assert.equal(noteMarkdownDroppedTitle.scope, 'window');

const panelViews = manifest.contributes.views.devSessionCanvasPanel;
assert.ok(Array.isArray(panelViews), 'Expected devSessionCanvasPanel views contribution.');
const canvasPanelView = panelViews.find((view) => view.id === 'devSessionCanvas.canvasPanel');
assert.ok(canvasPanelView, 'Expected panel route to contribute the main canvas WebviewView.');
assert.equal(canvasPanelView.type, 'webview');
assert.equal(
  canvasPanelView.when,
  "(config.devSessionCanvas.canvas.defaultSurface == 'panel' && !devSessionCanvas.canvas.panelVisibilityManaged) || devSessionCanvas.canvas.panelViewVisible",
  'Expected default panel configuration to make the native Panel tab available before extension activation.'
);

assert.ok(
  !manifest.activationEvents.includes('onStartupFinished'),
  'Panel placement bootstrap should not activate the extension or reveal the canvas on every VS Code startup.'
);

const sidebarViews = manifest.contributes.views.devSessionCanvas;
assert.ok(Array.isArray(sidebarViews), 'Expected devSessionCanvas sidebar views contribution.');
assert.deepEqual(
  sidebarViews
    .filter((view) => view.id === 'devSessionCanvas.sidebarNodes' || view.id === 'devSessionCanvas.sidebarSessions')
    .map((view) => ({ id: view.id, icon: view.icon })),
  [
    {
      id: 'devSessionCanvas.sidebarNodes',
      icon: 'images/dev-session-canvas-nodes-activitybar.svg'
    },
    {
      id: 'devSessionCanvas.sidebarSessions',
      icon: 'images/dev-session-canvas-sessions-activitybar.svg'
    }
  ],
  'Expected sidebar node and session history views to use dedicated section activitybar icons.'
);

const viewTitleMenus = manifest.contributes.menus['view/title'];
assert.ok(Array.isArray(viewTitleMenus), 'Expected view/title menu contributions.');
const createNodeTitleMenus = viewTitleMenus.filter((item) => item.command === 'devSessionCanvas.createNode');
assert.deepEqual(
  createNodeTitleMenus,
  [
    {
      command: 'devSessionCanvas.createNode',
      when: 'view == devSessionCanvas.sidebarNodes',
      group: 'navigation@99'
    }
  ],
  'Expected the create-node title action to live at the end of the Nodes sidebar section.'
);

const sidebarNodeListViewTitleMenus = viewTitleMenus.filter(
  (item) => typeof item.command === 'string' && item.when?.includes('view == devSessionCanvas.sidebarNodes')
);
assert.deepEqual(
  sidebarNodeListViewTitleMenus
    .filter((item) =>
      [
        'devSessionCanvas.addFolderToWorkspace',
        'devSessionCanvas.createWorktree',
        'devSessionCanvas.createNode'
      ].includes(item.command)
    )
    .map((item) => ({ command: item.command, group: item.group })),
  [
    {
      command: 'devSessionCanvas.addFolderToWorkspace',
      group: 'navigation@1'
    },
    {
      command: 'devSessionCanvas.createWorktree',
      group: 'navigation@2'
    },
    {
      command: 'devSessionCanvas.createNode',
      group: 'navigation@99'
    }
  ],
  'Expected Nodes sidebar title navigation to expose workspace-folder and worktree actions before create-node.'
);
assert.deepEqual(
  sidebarNodeListViewTitleMenus.filter((item) => item.command.startsWith('devSessionCanvas.setSidebarNodeList')),
  [
    {
      command: 'devSessionCanvas.setSidebarNodeListFlatView',
      when: 'view == devSessionCanvas.sidebarNodes && devSessionCanvas.sidebarNodeList.groupedView',
      group: '1_view@1'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListFlatViewChecked',
      when: 'view == devSessionCanvas.sidebarNodes && !devSessionCanvas.sidebarNodeList.groupedView',
      group: '1_view@1'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListGroupedViewChecked',
      when: 'view == devSessionCanvas.sidebarNodes && devSessionCanvas.sidebarNodeList.groupedView',
      group: '1_view@2'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListGroupedView',
      when: 'view == devSessionCanvas.sidebarNodes && !devSessionCanvas.sidebarNodeList.groupedView',
      group: '1_view@2'
    }
  ],
  'Expected sidebar node list view-mode commands to live in the native view title secondary menu.'
);
assert.ok(
  sidebarNodeListViewTitleMenus
    .filter((item) => item.command.startsWith('devSessionCanvas.setSidebarNodeList'))
    .every((item) => !String(item.group).startsWith('navigation')),
  'Expected sidebar node list view-mode commands to stay behind the native ... menu instead of inline title actions.'
);
assert.deepEqual(
  manifest.contributes.commands
    .filter((entry) => entry.command.startsWith('devSessionCanvas.setSidebarNodeList'))
    .map((entry) => ({ command: entry.command, title: entry.title })),
  [
    {
      command: 'devSessionCanvas.setSidebarNodeListFlatView',
      title: '%command.setSidebarNodeListFlatView.title%'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListFlatViewChecked',
      title: '%command.setSidebarNodeListFlatView.checkedTitle%'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListGroupedView',
      title: '%command.setSidebarNodeListGroupedView.title%'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListGroupedViewChecked',
      title: '%command.setSidebarNodeListGroupedView.checkedTitle%'
    }
  ],
  'Expected checked sidebar node list view-mode variants to use visible checkmark titles.'
);

const sidebarSessionHistoryViewTitleMenus = viewTitleMenus.filter(
  (item) => typeof item.command === 'string' && item.when?.includes('view == devSessionCanvas.sidebarSessions')
);
assert.deepEqual(
  sidebarSessionHistoryViewTitleMenus.filter((item) => item.command !== 'devSessionCanvas.refreshSessionHistory'),
  [
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryRootGrouping',
      when: 'view == devSessionCanvas.sidebarSessions && devSessionCanvas.sidebarSessionHistory.groupByWorkspaceRoot',
      group: '1_grouping@1'
    },
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryRootGrouping',
      when: 'view == devSessionCanvas.sidebarSessions && !devSessionCanvas.sidebarSessionHistory.groupByWorkspaceRoot',
      group: '1_grouping@1'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryProviderGrouping',
      when: 'view == devSessionCanvas.sidebarSessions && devSessionCanvas.sidebarSessionHistory.groupByProvider',
      group: '1_grouping@2'
    },
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryProviderGrouping',
      when: 'view == devSessionCanvas.sidebarSessions && !devSessionCanvas.sidebarSessionHistory.groupByProvider',
      group: '1_grouping@2'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryTimeGrouping',
      when: 'view == devSessionCanvas.sidebarSessions && devSessionCanvas.sidebarSessionHistory.groupByTime',
      group: '1_grouping@3'
    },
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryTimeGrouping',
      when: 'view == devSessionCanvas.sidebarSessions && !devSessionCanvas.sidebarSessionHistory.groupByTime',
      group: '1_grouping@3'
    }
  ],
  'Expected session history grouping toggles to live in the native view title secondary menu.'
);
assert.ok(
  sidebarSessionHistoryViewTitleMenus
    .filter((item) => item.command.includes('SidebarSessionHistory'))
    .every((item) => !String(item.group).startsWith('navigation')),
  'Expected session history grouping toggles to stay behind the native ... menu instead of inline title actions.'
);
assert.deepEqual(
  manifest.contributes.commands
    .filter((entry) => entry.command.includes('SidebarSessionHistory'))
    .map((entry) => ({ command: entry.command, title: entry.title })),
  [
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryRootGrouping',
      title: '%command.sidebarSessionHistoryRootGrouping.title%'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryRootGrouping',
      title: '%command.sidebarSessionHistoryRootGrouping.checkedTitle%'
    },
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryProviderGrouping',
      title: '%command.sidebarSessionHistoryProviderGrouping.title%'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryProviderGrouping',
      title: '%command.sidebarSessionHistoryProviderGrouping.checkedTitle%'
    },
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryTimeGrouping',
      title: '%command.sidebarSessionHistoryTimeGrouping.title%'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryTimeGrouping',
      title: '%command.sidebarSessionHistoryTimeGrouping.checkedTitle%'
    }
  ],
  'Expected checked session history grouping variants to use a visible checkmark title fallback.'
);

const commandPaletteMenus = manifest.contributes.menus.commandPalette;
assert.ok(Array.isArray(commandPaletteMenus), 'Expected commandPalette menu contributions.');
assert.deepEqual(
  manifest.contributes.commands
    .filter((entry) =>
      [
        'devSessionCanvas.addFolderToWorkspace',
        'devSessionCanvas.createWorktree',
        'devSessionCanvas.createWorktreeForRoot',
        'devSessionCanvas.removeFolderFromWorkspace',
        'devSessionCanvas.removeWorktreeFromWorkspace'
      ].includes(entry.command)
    )
    .map((entry) => ({ command: entry.command, icon: entry.icon })),
  [
    {
      command: 'devSessionCanvas.addFolderToWorkspace',
      icon: '$(new-folder)'
    },
    {
      command: 'devSessionCanvas.createWorktree',
      icon: '$(worktree)'
    },
    {
      command: 'devSessionCanvas.createWorktreeForRoot',
      icon: '$(worktree)'
    },
    {
      command: 'devSessionCanvas.removeFolderFromWorkspace',
      icon: '$(close)'
    },
    {
      command: 'devSessionCanvas.removeWorktreeFromWorkspace',
      icon: '$(trash)'
    }
  ],
  'Expected workspace and worktree commands to be contributed with stable Codicon entry points.'
);
assert.deepEqual(
  commandPaletteMenus.filter((item) =>
    [
      'devSessionCanvas.createWorktreeForRoot',
      'devSessionCanvas.removeFolderFromWorkspace',
      'devSessionCanvas.removeWorktreeFromWorkspace'
    ].includes(item.command)
  ),
  [
    {
      command: 'devSessionCanvas.createWorktreeForRoot',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.removeFolderFromWorkspace',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.removeWorktreeFromWorkspace',
      when: 'false'
    }
  ],
  'Expected folder-scoped sidebar webview commands to stay out of the global Command Palette.'
);
const groupCommandIds = ['devSessionCanvas.createEmptyGroup', 'devSessionCanvas.createGroupFromSelection'];
const contributedCommandIds = manifest.contributes.commands.map((entry) => entry.command);
const explorerExecutionCommandIds = [
  'devSessionCanvas.createTerminalFromExplorerResource',
  'devSessionCanvas.createAgentFromExplorerResource'
];
const explorerMarkdownNoteCommandId = 'devSessionCanvas.createNoteFromExplorerMarkdown';
for (const commandId of groupCommandIds) {
  assert.ok(contributedCommandIds.includes(commandId), `Expected ${commandId} to be contributed as a command.`);
  assert.ok(
    !commandPaletteMenus.some((item) => item.command === commandId && item.when === 'false'),
    `Expected ${commandId} to remain visible in the global Command Palette.`
  );
}
assert.deepEqual(
  manifest.contributes.commands
    .filter((entry) => groupCommandIds.includes(entry.command))
    .map((entry) => ({ command: entry.command, icon: entry.icon })),
  [
    {
      command: 'devSessionCanvas.createEmptyGroup',
      icon: '$(symbol-array)'
    },
    {
      command: 'devSessionCanvas.createGroupFromSelection',
      icon: '$(group-by-ref-type)'
    }
  ],
  'Expected group commands to use the confirmed Codicon entry points.'
);
assert.ok(
  !Array.isArray(manifest.contributes.keybindings) ||
    !manifest.contributes.keybindings.some((item) => groupCommandIds.includes(item.command)),
  'Expected group commands to avoid default keybindings in the first version.'
);
for (const commandId of explorerExecutionCommandIds) {
  assert.ok(contributedCommandIds.includes(commandId), `Expected ${commandId} to be contributed as a command.`);
}
assert.ok(
  contributedCommandIds.includes(explorerMarkdownNoteCommandId),
  `Expected ${explorerMarkdownNoteCommandId} to be contributed as a command.`
);
assert.deepEqual(
  manifest.contributes.commands
    .filter((entry) => [...explorerExecutionCommandIds, explorerMarkdownNoteCommandId].includes(entry.command))
    .map((entry) => ({ command: entry.command, icon: entry.icon })),
  [
    {
      command: 'devSessionCanvas.createTerminalFromExplorerResource',
      icon: '$(terminal)'
    },
    {
      command: 'devSessionCanvas.createAgentFromExplorerResource',
      icon: '$(hubot)'
    },
    {
      command: 'devSessionCanvas.createNoteFromExplorerMarkdown',
      icon: '$(markdown)'
    }
  ],
  'Expected Explorer resource commands to use the confirmed Codicon entry points.'
);
assert.deepEqual(
  manifest.contributes.menus['explorer/context']?.filter((item) =>
    [...explorerExecutionCommandIds, explorerMarkdownNoteCommandId].includes(item.command)
  ),
  [
    {
      command: 'devSessionCanvas.createTerminalFromExplorerResource',
      when: 'resourceScheme == file',
      group: 'devSessionCanvas@1'
    },
    {
      command: 'devSessionCanvas.createAgentFromExplorerResource',
      when: 'resourceScheme == file',
      group: 'devSessionCanvas@2'
    },
    {
      command: 'devSessionCanvas.createNoteFromExplorerMarkdown',
      when: 'resourceScheme == file && resourceExtname =~ /^\\.(md|markdown)$/i',
      group: 'devSessionCanvas@3'
    }
  ],
  'Expected Explorer context menu to expose cwd-scoped execution nodes and Markdown Note creation for file resources.'
);
assert.deepEqual(
  commandPaletteMenus.filter((item) => item.command.startsWith('devSessionCanvas.setSidebarNodeList')),
  [
    {
      command: 'devSessionCanvas.setSidebarNodeListFlatView',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListFlatViewChecked',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListGroupedView',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.setSidebarNodeListGroupedViewChecked',
      when: 'false'
    }
  ],
  'Expected internal sidebar node list view-mode variants to stay out of the global Command Palette.'
);
assert.deepEqual(
  commandPaletteMenus.filter((item) => item.command.includes('SidebarSessionHistory')),
  [
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryRootGrouping',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryRootGrouping',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryProviderGrouping',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryProviderGrouping',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.enableSidebarSessionHistoryTimeGrouping',
      when: 'false'
    },
    {
      command: 'devSessionCanvas.disableSidebarSessionHistoryTimeGrouping',
      when: 'false'
    }
  ],
  'Expected internal session history grouping variants to stay out of the global Command Palette.'
);

const nls = JSON.parse(await readFile(path.join(repoRoot, 'extensions', 'vscode', 'dev-session-canvas', 'package.nls.json'), 'utf8'));
assert.deepEqual(
  [
    nls['configuration.notifications.agentAbnormalOutputTextNotifications.description']?.length > 0,
    nls['configuration.notifications.agentAbnormalOutputTextNotifications.off.label']?.length > 0,
    nls['configuration.notifications.agentAbnormalOutputTextNotifications.codex.label']?.length > 0,
    nls['configuration.noteMarkdown.stripExtensionFromDroppedFileTitle.description']?.length > 0
  ],
  [true, true, true, true],
  'Expected restored configuration properties to keep their package.nls entries.'
);
assert.deepEqual(
  [
    nls['command.setSidebarNodeListFlatView.checkedTitle'],
    nls['command.setSidebarNodeListGroupedView.checkedTitle'],
    nls['command.sidebarSessionHistoryRootGrouping.checkedTitle'],
    nls['command.sidebarSessionHistoryProviderGrouping.checkedTitle'],
    nls['command.sidebarSessionHistoryTimeGrouping.checkedTitle']
  ],
  [
    '✓ 平铺视图',
    '✓ 分组视图',
    '✓ 按 Workspace Root 分组',
    '✓ 按 Provider 分组',
    '✓ 按时间分组'
  ],
  'Expected checked sidebar view/title menu variants to make the active state visible in popup menus.'
);

console.log('extension manifest tests passed');
