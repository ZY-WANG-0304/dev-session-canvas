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
    `export { selectExecutionOutputSchedulerEntries } from ${JSON.stringify(path.resolve('extensions/vscode/dev-session-canvas/src/common/executionOutputScheduler.ts'))};\n`,
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
  const { selectExecutionOutputSchedulerEntries } = await import(pathToFileURL(outFile).href);
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

  console.log('execution output scheduler tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
