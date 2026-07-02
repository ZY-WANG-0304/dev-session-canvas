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
  /private bindSessionProcess\([\s\S]*?session\.outputSequence \+= 1;[\s\S]*?this\.emitSessionOutput\(session, chunk\)[\s\S]*?private emitSessionOutput\([\s\S]*?outputSequence: session\.outputSequence/u,
  'runtime supervisor 必须为 sessionOutput 事件带上单调 outputSequence。'
);
assert.match(
  supervisorSource,
  /private toSnapshot\([\s\S]*?outputSequence: session\.outputSequence/u,
  'runtime supervisor snapshot 必须持久化 outputSequence，重启恢复后仍能返回单调 reset 边界。'
);
assert.match(
  managerSource,
  /createSupervisorExecutionSession\([\s\S]*?outputSequenceFloor[\s\S]*?sessionOutputSequence = Math\.max\(snapshotOutputSequence \?\? 0, outputSequenceFloor\)/u,
  'Host reattach live-runtime session 时必须用 metadata/session floor 防止 outputSequence 回退。'
);
assert.match(
  managerSource,
  /freshSupervisorSerializedTerminalState = cloneFreshSerializedTerminalState\([\s\S]*?snapshot\.serializedTerminalState,[\s\S]*?sessionOutputSequence[\s\S]*?canTrustSupervisorTerminalState =[\s\S]*?freshSupervisorSerializedTerminalState !== undefined \|\|[\s\S]*?sessionOutputSequence === 0 && snapshot\.output\.length === 0[\s\S]*?initialState: freshSupervisorSerializedTerminalState,[\s\S]*?initialOutput: freshSupervisorSerializedTerminalState \? snapshot\.output : undefined[\s\S]*?terminalStateTrusted: canTrustSupervisorTerminalState/u,
  'Host 重新附着 supervisor session 时只能用新鲜 serializedTerminalState 初始化可信 tracker，旧 supervisor raw tail 只能作为不可信 fallback。'
);
assert.match(
  managerSource,
  /canPreserveTrustedSupervisorSessionForSnapshot\([\s\S]*?freshSnapshotState === undefined[\s\S]*?session\?\.owner === 'supervisor'[\s\S]*?session\.terminalStateTrusted[\s\S]*?session\.runtimeSessionId === snapshot\.sessionId[\s\S]*?this\.resolveRuntimeStoragePath\(session\.runtimeStoragePath\) === runtimeStoragePath[\s\S]*?applyRuntimeSupervisorSnapshot\([\s\S]*?freshSupervisorSerializedTerminalState = cloneFreshSerializedTerminalState\([\s\S]*?preservedTrustedSupervisorSession = this\.canPreserveTrustedSupervisorSessionForSnapshot\([\s\S]*?existingSession,[\s\S]*?snapshot,[\s\S]*?runtimeStoragePath,[\s\S]*?freshSupervisorSerializedTerminalState[\s\S]*?this\.updateSupervisorExecutionSessionFromSnapshot\(session, snapshot, runtimeStoragePath\)[\s\S]*?this\.disposeManagedExecutionSession\(existingSession\)/u,
  'Host 收到当前 supervisor 的 transient stale sessionState 时必须保留同一 live runtime 的可信 tracker，不得降级成旧 raw-tail fallback。'
);
assert.match(
  managerSource,
  /postExecutionSnapshot\([\s\S]*?options\.executionSessionId === session\.sessionId[\s\S]*?options\.minOutputSequence > session\.outputSequence[\s\S]*?session\.outputSequence = options\.minOutputSequence/u,
  'Host 只能在同一 executionSessionId 下用 Webview minOutputSequence 对齐 snapshot reset 边界。'
);
assert.match(
  managerSource,
  /postExecutionSnapshot\([\s\S]*?const serializedTerminalState = session\?\.terminalStateTrusted[\s\S]*?const freshSerializedTerminalState =[\s\S]*?session\?\.terminalStateTrusted === false[\s\S]*?\? undefined[\s\S]*?: cloneFreshSerializedTerminalState\(serializedTerminalState, outputSequence\) \?\?[\s\S]*?cloneFreshSerializedTerminalState\(metadata\?\.serializedTerminalState, outputSequence\)/u,
  'Host 对不可信 supervisor raw-tail fallback 不得 flush、发送或用 metadata 回填 serializedTerminalState。'
);
assert.match(
  managerSource,
  /handleRuntimeSupervisorOutput\([\s\S]*?session\.buffer = appendTerminalBuffer\(session\.buffer, event\.chunk\);[\s\S]*?if \(session\.terminalStateTrusted\) \{[\s\S]*?session\.terminalStateTracker\.write\(event\.chunk/u,
  'Host 对不可信 supervisor session 不得继续把后续 output 写入同一个 raw-tail tracker，避免逐步把 fallback 提升为权威状态。'
);
assert.match(
  managerSource,
  /flushLiveExecutionState\([\s\S]*serializedTerminalState: getFreshExecutionSessionSerializedTerminalState\(session\)/u,
  'Host live execution metadata 不得持久化未 flush 且 outputSequence 落后的 serializedTerminalState。'
);
assert.match(
  managerSource,
  /function getFreshExecutionSessionSerializedTerminalState\([\s\S]*?if \(!session\.terminalStateTrusted\) \{[\s\S]*?return undefined;[\s\S]*?cloneFreshSerializedTerminalState\(session\.terminalStateTracker\.getSerializedState\(\), session\.outputSequence\)/u,
  'Host live execution metadata 必须把不可信 supervisor raw-tail tracker 排除在 authoritative serializedTerminalState 之外。'
);
assert.match(
  managerSource,
  /reconcileAgentNodesInArray\([\s\S]*serializedTerminalState: getFreshExecutionSessionSerializedTerminalState\(liveSession\)[\s\S]*function reconcileTerminalNodesInArray[\s\S]*serializedTerminalState: getFreshExecutionSessionSerializedTerminalState\(liveSession\)/u,
  'Host reconcile live sessions 时必须过滤 stale serializedTerminalState，避免 stateUpdated 或持久化路径重新传播旧快照。'
);
assert.match(
  managerSource,
  /applyCompletedRuntimeSupervisorSnapshot\([\s\S]*existingSession\?\.terminalStateTrusted === false[\s\S]*?cloneFreshSerializedTerminalState\(currentMetadata\.serializedTerminalState, outputSequence\)[\s\S]*?markExecutionNodeAsHistoryRestored\([\s\S]*existingSession\?\.terminalStateTrusted === false[\s\S]*?cloneFreshSerializedTerminalState\(currentMetadata\.serializedTerminalState, outputSequence\)/u,
  'Supervisor session 已知不可信时，完成/降级为历史结果也不得重新捡回此前由 raw tail 伪造的新鲜 metadata state。'
);
assert.match(
  managerSource,
  /normalizeMetadata\([\s\S]*serializedTerminalState: cloneFreshSerializedTerminalState\([\s\S]*normalizeSerializedTerminalState\(agent\.serializedTerminalState\),[\s\S]*normalizeExecutionOutputSequence\(agent\.outputSequence\)[\s\S]*serializedTerminalState: cloneFreshSerializedTerminalState\([\s\S]*normalizeSerializedTerminalState\(terminal\.serializedTerminalState\),[\s\S]*normalizeExecutionOutputSequence\(terminal\.outputSequence\)/u,
  '读取持久化 metadata 时必须丢弃缺少或不匹配 outputSequence 的 serializedTerminalState。'
);
assert.match(
  managerSource,
  /summarizeHostMessageDetail\([\s\S]*serializedTerminalStateOutputSequence[\s\S]*serializedTerminalStateLength[\s\S]*serializedTerminalStateFresh/u,
  'Host diagnostics 必须记录 serializedTerminalState 序号、长度与新鲜度，便于现场诊断 stale 快照。'
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
