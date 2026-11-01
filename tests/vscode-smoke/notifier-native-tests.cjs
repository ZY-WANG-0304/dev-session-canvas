// Opt-in desktop acceptance: real shell OSC 9 -> companion -> installed native app -> OS click.
// Requires isolated user data/workspace. A driver touches trigger/finish in the evidence directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const main = 'devSessionCanvas.__test.';
const call = (command, ...args) =>
  vscode.commands.executeCommand(command, ...args);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports.run = async () => {
  const directory = process.env.DSC_NATIVE_ACCEPTANCE_DIR;
  assert.ok(
    directory && process.env.DEV_SESSION_CANVAS_NATIVE_NOTIFIER === '1',
    'explicit isolated acceptance environment required'
  );
  fs.mkdirSync(directory, { recursive: true });
  const save = (name, data) =>
    fs.writeFileSync(
      path.join(directory, name + '.json'),
      JSON.stringify(data, null, 2)
    );
  const until = async (check, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await delay(100);
    }
    throw new Error('acceptance wait timed out');
  };
  try {
    await vscode.extensions
      .getExtension('devsessioncanvas.dev-session-canvas')
      .activate();
    await vscode.extensions
      .getExtension('devsessioncanvas.dev-session-canvas-notifier')
      .activate();
    await call(main + 'resetState');
    await call('devSessionCanvas.openCanvasInEditor');
    await call(main + 'waitForCanvasReady', 'editor', 20000);
    await call(main + 'createNode', 'terminal', undefined, {
      titleOverride: '同名通知节点'
    });
    const ready = await until(async () => {
      const s = await call(main + 'getDebugState');
      return s.state.nodes.some(
        (n) => n.kind === 'terminal' && n.status === 'live'
      )
        ? s
        : undefined;
    });
    const node = ready.state.nodes.find((n) => n.kind === 'terminal');
    save('ready', {
      nodeId: node.id,
      version: vscode.version,
      remote: vscode.env.remoteName ?? null,
      workspace: vscode.workspace.name
    });
    await until(() => fs.existsSync(path.join(directory, 'trigger')), 600000);
    await call('devSessionCanvasNotifier.__test.clearPostedNotifications');
    await call(main + 'clearHostMessages');
    const label = process.env.DSC_NATIVE_ACCEPTANCE_LABEL ?? 'A';
    await call(main + 'dispatchWebviewMessage', {
      type: 'webview/executionInput',
      payload: {
        nodeId: node.id,
        kind: 'terminal',
        data: `printf '\\033]9;DSCanvas 原生来源 ${label}\\007'\r`
      }
    });
    const posted = await until(async () => {
      const records = await call(
        'devSessionCanvasNotifier.__test.getPostedNotifications'
      );
      return records.find((r) => r.result.backend === 'native-client');
    });
    assert.equal(posted.result.status, 'posted');
    const event = posted.request.nativeEvent;
    assert.ok(event);
    const target = {
      eventId: event.eventId,
      workspaceId: event.workspaceId,
      canvasId: event.canvasId,
      nodeId: event.nodeId,
      executionGeneration: event.executionGeneration
    };
    assert.equal(
      await call('devSessionCanvas.__internal.focusNativeAttention', {
        ...target,
        executionGeneration: 'stale'
      }),
      false
    );
    const before = await call(main + 'getDebugState');
    save('posted', {
      nodeId: node.id,
      eventId: event.eventId,
      result: posted.result
    });
    await until(async () => {
      const events = await call(main + 'getDiagnosticEvents');
      return events.some(
        (e) =>
          e.kind === 'execution/nativeAttentionFocused' &&
          e.detail?.eventId === event.eventId
      );
    }, 600000);
    const after = await call(main + 'getDebugState');
    const messages = await call(main + 'getHostMessages');
    assert.equal(
      after.state.nodes.find((n) => n.id === node.id).metadata.terminal
        .attentionPending,
      true
    );
    assert.deepEqual(after.state.selectedNodeIds, before.state.selectedNodeIds);
    assert.ok(
      messages.some(
        (m) => m.type === 'host/centerNode' && m.payload.nodeId === node.id
      )
    );
    assert.ok(
      !messages.some(
        (m) => m.type === 'host/focusNode' && m.payload.nodeId === node.id
      )
    );
    await until(() => vscode.window.state.focused, 5000);
    save('clicked', {
      eventId: event.eventId,
      nodeId: node.id,
      attentionPending: true,
      selectionUnchanged: true,
      centerOnly: true,
      windowFocused: true
    });
    await until(() => fs.existsSync(path.join(directory, 'finish')), 600000);
    // The user's selection is the acknowledgement; sync must later withdraw the system notification.
    await call(main + 'dispatchWebviewMessage', {
      type: 'webview/selectNode',
      payload: { nodeId: node.id }
    });
    assert.equal(
      (await call(main + 'getDebugState')).state.nodes.find(
        (n) => n.id === node.id
      ).metadata.terminal.attentionPending,
      false
    );
    assert.equal(
      await call('devSessionCanvas.__internal.focusNativeAttention', target),
      false
    );
    save('completed', { staleRejected: true, acknowledged: true });
    await delay(11000);
    await call(main + 'resetState');
  } catch (error) {
    try {
      save('failure', {
        error: String(error),
        snapshot: await call(main + 'getDebugState'),
        diagnostics: await call(main + 'getDiagnosticEvents')
      });
    } catch {}
    throw error;
  }
};
