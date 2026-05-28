import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

const defaultSurface = manifest.contributes.configuration.properties['devSessionCanvas.canvas.defaultSurface'];
assert.equal(defaultSurface.default, 'panel');

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

const commandPaletteMenus = manifest.contributes.menus.commandPalette;
assert.ok(Array.isArray(commandPaletteMenus), 'Expected commandPalette menu contributions.');
const groupCommandIds = ['devSessionCanvas.createEmptyGroup', 'devSessionCanvas.createGroupFromSelection'];
const contributedCommandIds = manifest.contributes.commands.map((entry) => entry.command);
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

const explorerResourceCommandIds = [
  'devSessionCanvas.createTerminalFromExplorerResource',
  'devSessionCanvas.createAgentFromExplorerResource'
];
for (const commandId of explorerResourceCommandIds) {
  assert.ok(contributedCommandIds.includes(commandId), `Expected ${commandId} to be contributed as a command.`);
}

const explorerContextMenus = manifest.contributes.menus['explorer/context'];
assert.ok(Array.isArray(explorerContextMenus), 'Expected explorer/context menu contributions.');
assert.deepEqual(
  explorerContextMenus.filter((item) => explorerResourceCommandIds.includes(item.command)),
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
    }
  ],
  'Expected Explorer resource commands to support file-scheme directories and files without explorerResourceIsFolder.'
);

console.log('extension manifest tests passed');
