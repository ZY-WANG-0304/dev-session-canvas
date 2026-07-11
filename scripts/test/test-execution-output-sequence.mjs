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
  /terminalEvent = session\.terminalJournal\?\.appendOutput\(chunk\);[\s\S]*?session\.outputSequence = terminalEvent\?\.revision[\s\S]*?session\.terminalStateTracker\.write\(chunk,[\s\S]*?outputSequence: session\.outputSequence[\s\S]*?this\.emitSessionOutput\(session, chunk, terminalEvent\)/u,
  'runtime supervisor 必须先由 journal 分配 output revision，再更新 tracker 和广播。'
);
assert.match(
  supervisorSource,
  /private resizeSession\([\s\S]*?appendResize\(params\.cols, params\.rows\)[\s\S]*?outputSequence: terminalEvent\?\.revision[\s\S]*?private async updateSessionScrollback\([\s\S]*?appendScrollback\(scrollback\)[\s\S]*?outputSequence: terminalEvent\?\.revision/u,
  'output、resize 与 scrollback 必须共用 supervisor journal revision。'
);
assert.match(
  managerSource,
  /sessionOutputSequence = hasAuthoritativeTerminalStream[\s\S]*?\? terminalStream\.revision[\s\S]*?: Math\.max\(snapshotOutputSequence \?\? 0, outputSequenceFloor\)/u,
  '新 authority session 必须直接采用 supervisor revision；metadata floor 只保留给 legacy session。'
);
assert.match(
  managerSource,
  /terminalAuthorityId: hasAuthoritativeTerminalStream \? terminalStream\.authorityId : undefined,[\s\S]*?terminalStreamHealthy: hasAuthoritativeTerminalStream[\s\S]*?terminalStateTrusted: canTrustSupervisorTerminalState/u,
  'Host 必须把 authority stream 与 legacy Host tracker 的信任状态分开。'
);
assert.match(
  managerSource,
  /canPreserveTerminalStream \|\| \(freshSnapshotState === undefined && session\.terminalStateTrusted\)/u,
  '同一 authority 的 sessionState 必须保留现有 Host live queue，不能因 fresh checkpoint 到达而替换并丢弃 pending output。'
);
assert.match(
  managerSource,
  /options\.minOutputSequence > session\.outputSequence[\s\S]*?!\(session\.owner === 'supervisor' && session\.terminalStreamHealthy\)[\s\S]*?session\.outputSequence = options\.minOutputSequence/u,
  'Host 不得用 Webview minOutputSequence 推进 authoritative supervisor revision。'
);
assert.match(
  managerSource,
  /pendingTerminalStartRevision = session\.outputSequence;[\s\S]*?pendingTerminalEndRevision = session\.outputSequence[\s\S]*?terminalStartRevision: session\.pendingTerminalStartRevision[\s\S]*?terminalRevision: session\.pendingTerminalEndRevision/u,
  'Host 合并相邻 output 时必须保留 authoritative revision 起止范围。'
);
assert.match(
  managerSource,
  /this\.flushExecutionOutputImmediately\(binding\.kind, binding\.nodeId\);[\s\S]*?session\.outputSequence = event\.revision[\s\S]*?type: 'host\/executionTerminalEvent'/u,
  'Host 必须在发送 resize/scrollback 前立即发送此前排队的 output。'
);
assert.match(
  managerSource,
  /runtime\/terminalStreamGap[\s\S]*?type: 'host\/executionTerminalEvent'[\s\S]*?allowAttachedTerminalStreamRecovery: true/u,
  'Host 检测到 authority/revision gap 后必须让 Webview fail closed，并从 supervisor 重新附着。'
);
assert.match(
  managerSource,
  /supportsTerminalProjectionSnapshot\(\)[\s\S]*?client\.getSessionSnapshot\([\s\S]*?mergeTerminalStreamProjectionWithLiveTail\(freshStream, currentStream\)/u,
  '健康 authority projection attach 必须刷新 Supervisor checkpoint，并无损合并刷新期间到达 Host 的连续尾部事件。'
);
assert.match(
  protocolSource,
  /terminalAuthorityId\?: string;\s*terminalStartRevision\?: number;\s*terminalRevision\?: number;/u,
  'Host/Webview output 协议必须携带 authority 与连续 revision range。'
);
assert.match(
  webviewSource,
  /terminalStartRevision !== currentTerminalRevision \+ 1[\s\S]*?postAttachSnapshotRequest\(\);[\s\S]*?currentTerminalRevision = terminalRevision/u,
  'Webview 必须拒绝 authoritative output revision gap。'
);
assert.match(
  webviewSource,
  /Snapshots create projections; they do not replace a healthy live backlog/u,
  'Webview 不得再把 snapshot 用作健康 live backlog replacement。'
);
assert.doesNotMatch(
  webviewSource,
  /resetBacklogForSnapshot|pendingSnapshotReset|deferred-output-budget-reset/u,
  'Webview 不得保留会丢弃增量内容的 snapshot reset 路径。'
);
assert.match(
  webviewSource,
  /while \(index < events\.length\)[\s\S]*?outputBatch \+= outputEvent\.data;[\s\S]*?terminal\.write\(outputBatch/u,
  'Webview snapshot hydrate 必须批量回放连续 output，不能为每个 revision 单独调度一次 xterm write。'
);
assert.match(
  webviewSource,
  /activationPriorityIndex[\s\S]*?activationPriorityIndex >= 0 \? activationPriorityIndex : inputNodeIndex/u,
  '新激活主 Pane 的 snapshot hydrate 优先级必须高于旧的最近输入节点。'
);

console.log('execution output sequence tests passed');
