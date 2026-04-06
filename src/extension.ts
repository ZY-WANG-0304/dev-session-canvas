import * as vscode from 'vscode';

import { COMMAND_IDS, TEST_COMMAND_IDS, VIEW_IDS } from './common/extensionIdentity';
import { isCanvasNodeKind, isWebviewDomAction, type CanvasNodeKind } from './common/protocol';
import { CanvasPanelManager, type CanvasSurfaceLocation } from './panel/CanvasPanelManager';
import { CanvasSidebarView } from './sidebar/CanvasSidebarView';

export function activate(context: vscode.ExtensionContext): void {
  const panelManager = new CanvasPanelManager(context);
  const sidebarView = new CanvasSidebarView(panelManager);

  context.subscriptions.push(
    sidebarView,
    vscode.window.registerTreeDataProvider(VIEW_IDS.sidebarTree, sidebarView)
  );

  registerCommand(context, COMMAND_IDS.openCanvas, async () => {
    await panelManager.revealOrCreate();
  });

  registerCommand(context, COMMAND_IDS.openCanvasInEditor, async () => {
    await panelManager.revealInEditor();
  });

  registerCommand(context, COMMAND_IDS.openCanvasInPanel, async () => {
    await panelManager.revealInPanel();
  });

  registerCommand(context, COMMAND_IDS.createNode, async () => {
    const targetKind = await promptCreateNodeKind(panelManager.getSidebarState().creatableKinds);
    if (!targetKind) {
      return;
    }

    await panelManager.revealOrCreate();
    panelManager.createNode(targetKind);
  });

  registerCommand(context, COMMAND_IDS.resetCanvasState, async () => {
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

  registerTestCommands(context, panelManager);
}

export function deactivate(): void {}

function registerCommand(context: vscode.ExtensionContext, commandId: string, handler: () => Promise<void>): void {
  context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
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

function registerTestCommands(context: vscode.ExtensionContext, panelManager: CanvasPanelManager): void {
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getDebugState, () => panelManager.getDebugSnapshot()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getHostMessages, () => panelManager.getHostMessagesForTest()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.clearHostMessages, () => {
      panelManager.clearHostMessagesForTest();
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.getDiagnosticEvents, () => panelManager.getDiagnosticEventsForTest()),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.clearDiagnosticEvents, () => {
      panelManager.clearDiagnosticEventsForTest();
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.waitForCanvasReady, async (surface?: unknown, timeoutMs?: unknown) =>
      panelManager.waitForCanvasReady(
        parseCanvasSurfaceLocation(surface),
        typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000
      )
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.captureWebviewProbe, async (surface?: unknown, timeoutMs?: unknown) =>
      panelManager.captureWebviewProbeForTest(
        parseCanvasSurfaceLocation(surface),
        typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000
      )
    ),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.performWebviewDomAction,
      async (action?: unknown, surface?: unknown, timeoutMs?: unknown) => {
        if (!isWebviewDomAction(action)) {
          throw new Error('测试命令 devSessionCanvas.__test.performWebviewDomAction 需要有效的 DOM 动作。');
        }

        return panelManager.performWebviewDomActionForTest(
          action,
          parseCanvasSurfaceLocation(surface),
          typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 5000
        );
      }
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.reloadPersistedState, () => panelManager.reloadPersistedStateForTest()),
    vscode.commands.registerCommand(
      TEST_COMMAND_IDS.dispatchWebviewMessage,
      (message?: unknown, surface?: unknown) =>
        panelManager.dispatchWebviewMessageForTest(message, parseCanvasSurfaceLocation(surface))
    ),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.createNode, (kind?: unknown) => {
      if (!isCanvasNodeKind(kind)) {
        throw new Error('测试命令 devSessionCanvas.__test.createNode 需要有效的节点类型。');
      }

      panelManager.createNodeForTest(kind);
      return panelManager.getDebugSnapshot();
    }),
    vscode.commands.registerCommand(TEST_COMMAND_IDS.resetState, () => {
      panelManager.resetState();
      return panelManager.getDebugSnapshot();
    })
  );
}

function parseCanvasSurfaceLocation(value: unknown): CanvasSurfaceLocation | undefined {
  return value === 'editor' || value === 'panel' ? value : undefined;
}
