import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempDir = await mkdtemp(path.join(tmpdir(), 'dsc-output-scheduler-'));
try {
  const entry = path.join(tempDir, 'entry.ts');
  const outFile = path.join(tempDir, 'bundle.mjs');
  await writeFile(
    entry,
    `export { selectExecutionOutputSchedulerEntries, selectExecutionTerminalDrainEntries } from ${JSON.stringify(path.resolve('extensions/vscode/dev-session-canvas/src/common/executionOutputScheduler.ts'))};\nexport { TerminalProjectionRefreshScheduler, resolveTerminalProjectionRefreshDelayMs } from ${JSON.stringify(path.resolve('extensions/vscode/dev-session-canvas/src/common/terminalProjectionRefreshScheduler.ts'))};\n`,
    'utf8'
  );
  await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent'
  });
  const {
    TerminalProjectionRefreshScheduler,
    resolveTerminalProjectionRefreshDelayMs,
    selectExecutionOutputSchedulerEntries,
    selectExecutionTerminalDrainEntries
  } = await import(pathToFileURL(outFile).href);
  const entries = [
    { key: 'agent:old', kind: 'agent', nodeId: 'old', queuedAtMs: 1000 },
    { key: 'agent:current', kind: 'agent', nodeId: 'current', queuedAtMs: 1010 },
    { key: 'terminal:other', kind: 'terminal', nodeId: 'other', queuedAtMs: 1020 }
  ];
  const options = {
    maxPostsPerFlush: 2,
    inputPriorityWindowMs: 300,
    nonPriorityMaxDeferMs: 750
  };

  assert.deepEqual(
    selectExecutionOutputSchedulerEntries(entries, 1100, undefined, options).entries.map((entry) => entry.key),
    ['agent:old', 'agent:current'],
    '没有近期输入时，scheduler 应按入队时间正常推进输出。'
  );

  const prioritized = selectExecutionOutputSchedulerEntries(
    entries,
    1100,
    { kind: 'agent', nodeId: 'current', receivedAtMs: 1090 },
    options
  );
  assert.equal(prioritized.reason, 'input-priority');
  assert.deepEqual(
    prioritized.entries.map((entry) => entry.key),
    ['agent:current'],
    '近期输入窗口内应优先投递刚输入节点，并暂缓未超时的其他节点。'
  );

  const expired = selectExecutionOutputSchedulerEntries(
    entries,
    1800,
    { kind: 'agent', nodeId: 'current', receivedAtMs: 1750 },
    options
  );
  assert.equal(expired.reason, 'input-priority');
  assert.deepEqual(
    expired.entries.map((entry) => entry.key),
    ['agent:current', 'agent:old'],
    '非输入节点等待超过上限后，每轮至少释放一个，避免被持续输入饿死。'
  );

  const deferred = selectExecutionOutputSchedulerEntries(
    [entries[0], entries[2]],
    1100,
    { kind: 'agent', nodeId: 'current', receivedAtMs: 1090 },
    options
  );
  assert.equal(deferred.reason, 'input-window-deferred');
  assert.deepEqual(deferred.entries, []);

  const hostPriorityEntry = { key: 'agent:10', kind: 'agent', nodeId: '10', queuedAtMs: 800 };
  const pendingHostBackground = Array.from({ length: 9 }, (_value, index) => ({
    key: `agent:${index + 1}`,
    kind: 'agent',
    nodeId: String(index + 1),
    queuedAtMs: 0
  }));
  const hostFairnessOrder = [];
  for (let round = 0; pendingHostBackground.length > 0; round += 1) {
    const now = 800 + round * 16;
    hostPriorityEntry.queuedAtMs = now;
    const selected = selectExecutionOutputSchedulerEntries(
      [hostPriorityEntry, ...pendingHostBackground],
      now,
      { kind: 'agent', nodeId: '10', receivedAtMs: now },
      options
    );
    assert.equal(selected.entries[0].key, 'agent:10');
    const releasedBackground = selected.entries.find((entry) => entry.key !== 'agent:10');
    assert.ok(releasedBackground, 'Host 持续输入窗口内每轮必须释放一个已超时后台节点。');
    hostFairnessOrder.push(releasedBackground.key);
    pendingHostBackground.splice(
      pendingHostBackground.findIndex((entry) => entry.key === releasedBackground.key),
      1
    );
  }
  assert.deepEqual(
    hostFairnessOrder,
    Array.from({ length: 9 }, (_value, index) => `agent:${index + 1}`),
    'Host scheduler 必须按等待时间有界释放全部后台 Agent。'
  );

  const tenAgentDrainEntries = Array.from({ length: 10 }, (_value, index) => ({
    key: `agent:${index + 1}`,
    kind: 'agent',
    nodeId: String(index + 1),
    queuedAtMs: 0
  }));
  const drainOptions = {
    maxControllersPerDrain: 1,
    nonPriorityMaxDeferMs: 480
  };
  const inputPriority = { kind: 'agent', nodeId: '10', receivedAtMs: 100 };
  const inputOnly = selectExecutionTerminalDrainEntries(
    tenAgentDrainEntries,
    100,
    inputPriority,
    drainOptions
  );
  assert.equal(inputOnly.reason, 'input-priority');
  assert.deepEqual(inputOnly.entries.map((entry) => entry.key), ['agent:10']);

  const fairnessOrder = [];
  for (let round = 0; round < 9; round += 1) {
    const selected = selectExecutionTerminalDrainEntries(
      tenAgentDrainEntries,
      480 + round,
      { ...inputPriority, receivedAtMs: 480 + round },
      drainOptions
    );
    assert.equal(selected.reason, 'input-priority-fairness');
    assert.equal(selected.entries[0].key, 'agent:10');
    fairnessOrder.push(selected.entries[1].key);
    selected.entries[1].queuedAtMs = 480 + round;
  }
  assert.deepEqual(
    fairnessOrder,
    Array.from({ length: 9 }, (_value, index) => `agent:${index + 1}`),
    '持续输入时，等待达到上限的 9 个后台 controller 必须逐个获得 drain slot。'
  );

  const backgroundOnly = selectExecutionTerminalDrainEntries(
    tenAgentDrainEntries.slice(0, 9),
    100,
    inputPriority,
    drainOptions
  );
  assert.equal(backgroundOnly.reason, 'input-background');
  assert.deepEqual(backgroundOnly.entries.map((entry) => entry.key), ['agent:1']);

  let nextTimerId = 1;
  const scheduledTimers = [];
  const scheduleTimeout = (callback, delayMs) => {
    const timer = { id: nextTimerId, callback, delayMs, cancelled: false };
    nextTimerId += 1;
    scheduledTimers.push(timer);
    return timer;
  };
  const refreshScheduler = new TerminalProjectionRefreshScheduler({
    intervalMs: 10_000,
    spreadMs: 2_000,
    scheduleTimeout,
    cancelTimeout: (timer) => {
      timer.cancelled = true;
    }
  });
  let refreshCount = 0;
  assert.equal(refreshScheduler.schedule('agent:a:session-a', () => refreshCount += 1), true);
  assert.equal(refreshScheduler.schedule('agent:a:session-a', () => refreshCount += 1), false);
  assert.equal(refreshScheduler.schedule('agent:b:session-b', () => refreshCount += 1), true);
  assert.equal(scheduledTimers.length, 2, '同一 session 只能保留一个周期 refresh timer。');
  assert.equal(
    scheduledTimers[0].delayMs,
    resolveTerminalProjectionRefreshDelayMs('agent:a:session-a', 10_000, 2_000)
  );
  assert.ok(
    scheduledTimers.every((timer) => timer.delayMs >= 10_000 && timer.delayMs < 12_000),
    '周期 refresh 必须落在固定周期后的确定性错峰窗口内。'
  );

  refreshScheduler.clearMatching((key) => key.startsWith('agent:a:'));
  assert.equal(scheduledTimers[0].cancelled, true);
  scheduledTimers[0].callback();
  assert.equal(refreshCount, 0, '被 session replacement 清理的 stale timer 不得执行 refresh。');
  scheduledTimers[1].callback();
  assert.equal(refreshCount, 1, '未被清理的 session timer 必须正常执行。');
  assert.equal(refreshScheduler.has('agent:b:session-b'), false);

  let rescheduleAfterRefresh;
  assert.equal(
    refreshScheduler.schedule('terminal:c:session-c', () => {
      rescheduleAfterRefresh = () => refreshScheduler.schedule('terminal:c:session-c', () => undefined);
    }),
    true
  );
  scheduledTimers.at(-1).callback();
  refreshScheduler.dispose();
  assert.equal(
    rescheduleAfterRefresh(),
    false,
    'Host dispose 后，即使 in-flight refresh 完成也不得重新创建周期 timer。'
  );

  const source = await readFile('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8');
  assert.match(
    source,
    /source: 'host-input-received'[\s\S]*type: 'host\/executionInputAck'[\s\S]*hostAckPostEpochMs[\s\S]*pendingOutputLength/u,
    'Host 输入 ACK 必须绕过 output scheduler 直接投递，并携带 ACK post 与输出 scheduler 状态。'
  );
  assert.match(
    source,
    /this\.postExecutionOutput\(kind, nodeId, pendingOutput, \{ immediate: true \}\)/u,
    '生命周期边界的 output flush 必须保留 immediate 路径，避免退出前输出滞留在 scheduler。'
  );

  const webviewSource = await readFile('extensions/vscode/dev-session-canvas/src/webview/main.tsx', 'utf8');
  assert.match(
    webviewSource,
    /pendingExecutionTerminalDrainQueuedAtMs[\s\S]*selectExecutionTerminalDrainEntries[\s\S]*EXECUTION_TERMINAL_INPUT_NON_PRIORITY_MAX_DEFER_MS/u,
    'Webview 必须跟踪 controller 等待时间，并在持续输入期间执行有界公平选择。'
  );

  console.log('execution output scheduler tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
