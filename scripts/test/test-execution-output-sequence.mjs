import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [supervisorSource, managerSource, protocolSource, webviewSource] = await Promise.all([
  readFile('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts', 'utf8'),
  readFile('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8'),
  readFile('extensions/vscode/dev-session-canvas/src/common/protocol.ts', 'utf8'),
  readFile('extensions/vscode/dev-session-canvas/src/webview/main.tsx', 'utf8')
]);

assert.match(
  supervisorSource,
  /private emitSessionOutput\([\s\S]*?session\.outputSequence \+= 1;[\s\S]*?outputSequence: session\.outputSequence/u,
  'runtime supervisor 必须为 sessionOutput 事件带上单调 outputSequence。'
);
assert.match(
  supervisorSource,
  /private toSnapshot\([\s\S]*?outputSequence: session\.outputSequence/u,
  'runtime supervisor snapshot 必须持久化 outputSequence，重启恢复后仍能返回单调 reset 边界。'
);
assert.match(
  managerSource,
  /createSupervisorExecutionSession\([\s\S]*?outputSequenceFloor[\s\S]*?Math\.max\(snapshotOutputSequence, outputSequenceFloor\)/u,
  'Host reattach live-runtime session 时必须用 metadata/session floor 防止 outputSequence 回退。'
);
assert.match(
  managerSource,
  /postExecutionSnapshot\([\s\S]*?options\.executionSessionId === session\.sessionId[\s\S]*?options\.minOutputSequence > session\.outputSequence[\s\S]*?session\.outputSequence = options\.minOutputSequence/u,
  'Host 只能在同一 executionSessionId 下用 Webview minOutputSequence 对齐 snapshot reset 边界。'
);
assert.match(
  protocolSource,
  /executionSessionId\?: string;\s*minOutputSequence\?: number;/u,
  'attachExecutionSession 协议必须保留 session id 与最小 outputSequence。'
);
assert.match(
  webviewSource,
  /type: 'webview\/attachExecutionSession'[\s\S]*?executionSessionId: pendingSnapshotResetExecutionSessionId[\s\S]*?minOutputSequence: pendingSnapshotResetAfterSequence/u,
  'Webview snapshot reset request 必须把同一 session 的最小 reset 边界传回 Host。'
);

console.log('execution output sequence tests passed');
