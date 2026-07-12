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
  /private async resizeSession\([\s\S]*?appendResize\(params\.cols, params\.rows\)[\s\S]*?outputSequence: terminalEvent\?\.revision[\s\S]*?private async updateSessionScrollback\([\s\S]*?appendScrollback\(scrollback\)[\s\S]*?outputSequence: terminalEvent\?\.revision/u,
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
  /terminalProjectionMode === 'legacy-read-only' \|\|[\s\S]*?canPreserveTerminalStream \|\|[\s\S]*?freshSnapshotState === undefined && session\.terminalStateTrusted/u,
  '同一 authority 的 sessionState 必须保留现有 Host live queue，不能因 fresh checkpoint 到达而替换并丢弃 pending output。'
);
assert.doesNotMatch(
  managerSource,
  /session\.outputSequence = options\.minOutputSequence|markOutputSequence\(session\.outputSequence\)/u,
  'Host 不得用 Webview minOutputSequence 无数据推进任何 terminal 内容 sequence。'
);
assert.match(
  managerSource,
  /pendingTerminalStartRevision = session\.outputSequence;[\s\S]*?pendingTerminalEndRevision = session\.outputSequence[\s\S]*?terminalStartRevision: session\.pendingTerminalStartRevision[\s\S]*?terminalRevision: session\.pendingTerminalEndRevision/u,
  'Host 合并相邻 output 时必须保留 authoritative revision 起止范围。'
);
assert.match(
  managerSource,
  /pendingOutputStartSequence = session\.outputSequence;[\s\S]*?pendingOutputEndSequence = session\.outputSequence[\s\S]*?outputStartSequence: session\.pendingOutputStartSequence[\s\S]*?outputSequence: session\.pendingOutputEndSequence/u,
  'Host 必须为 local 与 authority output 都保留连续 sequence 起止范围。'
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
  managerSource,
  /supportsTerminalSessionStream\(\)[\s\S]*?deferSubscription: true[\s\S]*?terminalProjectionMode: terminalStreamSupported \? 'terminal-stream-v1' : 'legacy-read-only'/u,
  '旧 Supervisor attach 必须按 capability 分流，不能发送未知的 deferred stream 协议。'
);
assert.match(
  managerSource,
  /subscribeRuntimeSupervisorTerminalStream[\s\S]*?!client\.supportsTerminalSessionStream\(\)[\s\S]*?client\.subscribeSession/u,
  'Host 发送 subscribeSession 前必须再次检查 terminal stream capability。'
);
assert.match(
  managerSource,
  /legacySupervisorCreateRejected[\s\S]*?retireLegacyRuntimeSupervisorClientIfUnused/u,
  '旧 Supervisor 必须拒绝创建新 session，并在没有旧 live session 时进入安全退役。'
);
assert.match(
  managerSource,
  /retireLegacyRuntimeSupervisorClientIfUnused[\s\S]*?client\.hasPendingRequests\(\)/u,
  '旧 Supervisor client 有未完成 RPC 时不得退役，避免终态事件抢先中断 stop/delete 响应。'
);
assert.match(
  managerSource,
  /deleteRuntimeSupervisorSessionStrict[\s\S]*?finally \{[\s\S]*?retireLegacyRuntimeSupervisorClientIfUnused/u,
  '严格删除 RPC 的所有完成路径都必须在请求 settled 后重新检查旧 Supervisor 退役。'
);
assert.match(
  managerSource,
  /const completedTerminalStream = getCompleteRuntimeSupervisorTerminalStream\(snapshot\);[\s\S]*?options\.historyOnUnavailable && !completedTerminalStream[\s\S]*?applyCompletedRuntimeSupervisorSnapshot/u,
  'Host 重连到已结束但 terminal stream 完整的 Supervisor session 时必须先持久化权威终态，不能降级为 history tail。'
);
assert.match(
  managerSource,
  /private async subscribeRuntimeSupervisorTerminalStream\([\s\S]*?if \(!snapshot\.live\) \{\s*return;\s*\}/u,
  'Host 完成离线终态收敛后不得再订阅已删除的 Supervisor session。'
);
assert.match(
  managerSource,
  /runtime-supervisor-completed-snapshot'[\s\S]*?requireRootLocalDurability: true[\s\S]*?deleteRuntimeSupervisorSessionStrict/u,
  'completed stream 必须在主快照和实际 root-local 加载源都 durable 后才能删除 Supervisor journal。'
);
assert.match(
  managerSource,
  /STORAGE_KEYS\.canvasState,[\s\S]*?stripExecutionTerminalRecoveryPayloadsFromCanvasState\(normalizedWorkspaceState\)/u,
  '大体积 terminal recovery payload 只写磁盘快照，不得复制进 workspaceState。'
);
assert.match(
  managerSource,
  /finally \{\s*options\.onSettled\?\.\(\);\s*\}[\s\S]*?onSettled: \(\) => this\.retireLegacyRuntimeSupervisorClientIfUnused/u,
  '旧 Supervisor attach 无论成功、失败或被忽略，都必须在 settled 边界重新检查 client 退役条件。'
);
assert.match(
  managerSource,
  /const legacyReadOnly = session\.terminalProjectionMode === 'legacy-read-only';[\s\S]*?if \(!legacyReadOnly\) \{[\s\S]*?this\.queueExecutionOutput/u,
  '旧 Supervisor raw output 只能更新只读 tail，不能进入可交互 xterm output 队列。'
);
assert.match(
  managerSource,
  /revision-regression[\s\S]*?terminalAppliedRevisionRejected[\s\S]*?terminalAppliedRevisionAccepted[\s\S]*?client\.ackSessionRevision[\s\S]*?consumerId: surface/u,
  'Host 必须按 surface 单调校验 Webview applied revision，并以独立 consumer 向声明 capability 的 Supervisor 转发。'
);
assert.match(
  managerSource,
  /EXECUTION_TERMINAL_PROJECTION_CACHE_REFRESH_INTERVAL_MS[\s\S]*?checkpoint\.revision < currentStream\.revision[\s\S]*?refreshExecutionTerminalProjection[\s\S]*?scheduleExecutionTerminalProjectionRefresh/u,
  'Host 必须周期刷新有增量的 authority cache，并在成功或失败后继续调度。'
);
assert.match(
  managerSource,
  /terminalProjectionRefreshScheduler\.dispose[\s\S]*?clearExecutionTerminalProjectionRefreshTimers[\s\S]*?terminalProjectionRefreshScheduler\.clearMatching/u,
  'Host 必须在 session replacement/dispose 时清理周期 refresh timer。'
);
assert.match(
  protocolSource,
  /outputStartSequence\?: number;\s*outputSequence\?: number;\s*terminalAuthorityId\?: string;\s*terminalStartRevision\?: number;\s*terminalRevision\?: number;/u,
  'Host/Webview output 协议必须同时携带通用 sequence range 与 authority revision range。'
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
assert.match(
  webviewSource,
  /restoreExecutionTerminalSnapshot\([\s\S]*?markTerminalRevisionApplied\(terminalStream\.authorityId, terminalStream\.revision,[\s\S]*?immediate: true/u,
  'snapshot applied ACK 必须等 checkpoint 和 replay 全部写入 xterm 后再推进 target revision。'
);
assert.match(
  webviewSource,
  /pendingOutputBoundaries[\s\S]*?terminal\.write\(chunk, done\)[\s\S]*?markTerminalRevisionApplied\(outputAuthorityId, completedRevision\)/u,
  'live output applied ACK 必须等对应 Host output 边界的 xterm write callback 完成。'
);
assert.match(
  webviewSource,
  /discardPendingOutputCoveredBySequence\(snapshotSequence,[\s\S]*?boundary\.outputStartSequence[\s\S]*?boundary\.outputSequence/u,
  'Webview 必须按 local snapshot 覆盖 sequence 对账 pending output。'
);
assert.match(
  webviewSource,
  /outputStartSequence !== currentLocalOutputSequence \+ 1[\s\S]*?postAttachSnapshotRequest\(\);[\s\S]*?currentLocalOutputSequence = outputSequence/u,
  'Webview 必须拒绝 local output sequence gap，并请求新的权威 Host snapshot。'
);
assert.match(
  webviewSource,
  /terminal\.resize\(terminalEvent\.cols, terminalEvent\.rows\)[\s\S]*?done\(\);[\s\S]*?markTerminalRevisionApplied\(detail\.authorityId, terminalEvent\.revision\)/u,
  'resize/scrollback applied ACK 必须在前序 write 后实际应用控制事件。'
);

console.log('execution output sequence tests passed');
