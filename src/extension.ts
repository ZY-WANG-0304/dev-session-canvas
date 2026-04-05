import * as vscode from 'vscode';

import { COMMAND_ID_ALIASES, VIEW_IDS } from './common/extensionIdentity';
import type { CanvasNodeKind } from './common/protocol';
import { CanvasPanelManager } from './panel/CanvasPanelManager';
import { CanvasSidebarView } from './sidebar/CanvasSidebarView';

export function activate(context: vscode.ExtensionContext): void {
  const panelManager = new CanvasPanelManager(context);
  const sidebarView = new CanvasSidebarView(panelManager);

  context.subscriptions.push(
    sidebarView,
    vscode.window.registerTreeDataProvider(VIEW_IDS.sidebarTree, sidebarView)
  );

  registerCommandAliases(context, COMMAND_ID_ALIASES.openCanvas, async () => {
    await panelManager.revealOrCreate();
  });

  registerCommandAliases(context, COMMAND_ID_ALIASES.openCanvasInEditor, async () => {
    await panelManager.revealInEditor();
  });

  registerCommandAliases(context, COMMAND_ID_ALIASES.openCanvasInPanel, async () => {
    await panelManager.revealInPanel();
  });

  registerCommandAliases(context, COMMAND_ID_ALIASES.createNode, async () => {
    const targetKind = await promptCreateNodeKind(panelManager.getSidebarState().creatableKinds);
    if (!targetKind) {
      return;
    }

    await panelManager.revealOrCreate();
    panelManager.createNode(targetKind);
  });

  registerCommandAliases(context, COMMAND_ID_ALIASES.resetCanvasState, async () => {
    const confirmed = await vscode.window.showWarningMessage(
      '重置会清空当前 workspace 绑定的画布对象，并终止运行中的 Agent / Terminal 会话。',
      { modal: true },
      '继续重置'
    );
    if (confirmed !== '继续重置') {
      return;
    }

    panelManager.resetState();
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CanvasPanelManager.panelViewType, panelManager),
    vscode.window.registerWebviewPanelSerializer(CanvasPanelManager.viewType, panelManager)
  );
}

export function deactivate(): void {}

function registerCommandAliases(
  context: vscode.ExtensionContext,
  commandIds: readonly string[],
  handler: () => Promise<void>
): void {
  for (const commandId of commandIds) {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
  }
}

async function promptCreateNodeKind(creatableKinds: CanvasNodeKind[]): Promise<CanvasNodeKind | undefined> {
  const picked = await vscode.window.showQuickPick(
    creatableKinds.map((kind) => ({
      label: humanizeNodeKind(kind),
      description: describeNodeKind(kind),
      nodeKind: kind
    })),
    {
      placeHolder: '选择要创建的对象类型'
    }
  );

  return picked?.nodeKind;
}

function humanizeNodeKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'terminal':
      return 'Terminal';
    case 'task':
      return 'Task';
    case 'note':
      return 'Note';
  }
}

function describeNodeKind(kind: CanvasNodeKind): string {
  switch (kind) {
    case 'agent':
      return '画布中的 Codex / Claude Code 会话窗口';
    case 'terminal':
      return '画布中的嵌入式终端窗口';
    case 'task':
      return '可编辑的任务节点';
    case 'note':
      return '可编辑的笔记节点';
  }
}
