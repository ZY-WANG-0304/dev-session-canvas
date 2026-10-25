import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-flow-'));
const root = path.resolve('extensions/vscode/dev-session-canvas/src');
const require = createRequire(import.meta.url);
try {
  const outfile = path.join(directory, 'flow.cjs');
  await esbuild.build({ stdin: { contents: `
    export * from './common/executionFlowDiagnostics';
    export { parseWebviewMessage } from './common/protocol';
    export { normalizeTerminalStreamPage } from './common/terminalStreamPaging';`,
    resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs' });
  const { ExecutionFlowRecorder, FLOW_STAGES, FLOW_DURATION_BUCKETS_MS, normalizeFlowSnapshot,
    normalizeFlowSample, parseWebviewMessage, normalizeTerminalStreamPage } = require(outfile);
  let now = 0;
  const recorder = new ExecutionFlowRecorder(() => now);
  recorder.record({ stage: 'page-apply', bytes: 10 });
  assert.equal(recorder.begin(), undefined);
  assert.equal(recorder.snapshot(), undefined);
  recorder.start('trace');
  const old = recorder.begin();
  for (let index = 0; index < 200; index++) {
    now = index;
    recorder.record({ stage: 'page-apply', nodeId: 'n', durationMs: 5, bytes: 10, data: 'SECRET' });
  }
  let snapshot = recorder.snapshot();
  assert.equal(snapshot.details.length, 64);
  assert.equal(snapshot.droppedDetails, 136);
  assert.equal(snapshot.seconds[0].count, 200);
  assert.equal(snapshot.seconds[0].bytes, 2000);
  assert.equal(snapshot.seconds[0].totalDurationMs, 1000);
  assert.equal(snapshot.seconds[0].durationBuckets[2], 200);
  assert.equal(snapshot.groups[0].count, 200);
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
  snapshot.seconds[0].count = 0;
  assert.equal(recorder.snapshot().seconds[0].count, 200, 'exports do not mutate stored data');
  now = 120000;
  recorder.record({ stage: 'page-apply' });
  assert.equal(recorder.active, false);
  assert.equal(recorder.snapshot().elapsedMs, 120000);
  assert.equal(recorder.snapshot().seconds[0].count, 200);
  recorder.start('next', 500);
  recorder.finish(old, { stage: 'page-apply' });
  assert.equal(recorder.snapshot().details.length, 0, 'late completion does not contaminate new trace');
  now += 50;
  recorder.stop();
  now += 100;
  assert.equal(recorder.snapshot().elapsedMs, 50);
  assert.equal(recorder.remainingMs, 0);
  recorder.record({ stage: 'page-apply' });
  assert.equal(recorder.snapshot().details.length, 0);

  recorder.start('bounds', 999999);
  for (let second = 0; second < 120; second++) {
    for (const stage of FLOW_STAGES) {
      recorder.record({ stage, nodeId: `node:${second}:${stage}`, durationMs: second,
        messageType: 'host/stateUpdated', bytes: 10 });
      recorder.record({ stage, messageType: 'host/executionTerminalPage', bytes: 20 });
    }
    now += 1000;
  }
  snapshot = recorder.snapshot();
  assert.equal(snapshot.seconds.length, 120 * FLOW_STAGES.length * 2);
  assert.equal(snapshot.groups.length, 128);
  assert.ok(snapshot.droppedNodeGroups > 0);
  assert.equal(snapshot.details.length, 64 * FLOW_STAGES.length);
  assert.equal(snapshot.seconds.filter(s => s.messageType === 'host/stateUpdated').reduce((n, s) => n + s.bytes, 0),
    120 * FLOW_STAGES.length * 10);
  assert.deepEqual(normalizeFlowSnapshot(snapshot), snapshot);
  const dirty = { ...snapshot, body: 'SECRET', details: [{ stage: 'page-queue', atMs: 0, body: 'SECRET', durationMs: NaN }] };
  const clean = normalizeFlowSnapshot(dirty);
  assert.equal(JSON.stringify(clean).includes('SECRET'), false);
  assert.equal(clean.details[0].durationMs, undefined);
  assert.equal(normalizeFlowSample({ stage: 'unknown', atMs: 0 }), undefined);
  assert.equal(normalizeFlowSnapshot({ ...snapshot, elapsedMs: Infinity }), undefined);
  assert.equal(normalizeFlowSnapshot({ ...snapshot, groups: Array(129).fill(snapshot.groups[0]) }), undefined);
  assert.equal(normalizeFlowSnapshot({ ...snapshot, seconds: [{ ...snapshot.seconds[0], second: 120 }] }), undefined);
  assert.equal(normalizeFlowSnapshot({ ...snapshot, traceId: 'x'.repeat(257) }), undefined);
  const report = { type: 'webview/executionFlowSnapshot', payload: { requestId: 'collect', snapshot: dirty } };
  assert.deepEqual(parseWebviewMessage(report).payload.snapshot, clean);
  assert.equal(parseWebviewMessage({ ...report, payload: { requestId: 'collect', snapshot: {} } }), null);
  const receipt = { type: 'webview/executionFlowReceipt', payload: { requestId: 'r', traceId: 't', processingMs: 3 } };
  assert.deepEqual(parseWebviewMessage(receipt), receipt);
  assert.equal(parseWebviewMessage({ ...receipt, payload: { ...receipt.payload, processingMs: -1 } }), null);
  assert.equal(parseWebviewMessage({ ...receipt, payload: { ...receipt.payload, processingMs: NaN } }), null);
  const page = { readId: 'r', sessionId: 's', authorityId: 'a', afterRevision: 0, revision: 1,
    headRevision: 1, events: [{ type: 'output', revision: 1, createdAtMs: 1, data: 'data' }] };
  assert.equal(normalizeTerminalStreamPage(page).diagnostics, undefined);
  const timing = { queueMs: 10, readMs: 2, totalMs: 13 };
  assert.deepEqual(normalizeTerminalStreamPage({ ...page, diagnostics: timing }).diagnostics, timing);
  assert.equal(normalizeTerminalStreamPage({ ...page, diagnostics: true }).diagnostics, undefined);
  assert.equal(normalizeTerminalStreamPage({ ...page, diagnostics: { ...timing, readMs: NaN } }).diagnostics, undefined);
  assert.equal(FLOW_DURATION_BUCKETS_MS.length + 1, snapshot.seconds[0].durationBuckets.length);
  console.log('PASS recorder: inactive/freeze/reset, full-window aggregation, bounds, privacy and optional protocol');

  // Exercise the production Host methods, with only VS Code and transport boundaries replaced.
  const filename = path.join(root, 'panel/CanvasPanelManager.ts');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
  const methods = ['postMessageWithDeliveryResult', 'collectExecutionFlowTrace', 'readExecutionTerminalPage', 'writeExecutionInput']
    .map(name => declaration.members.find(member => member.name?.getText(ast) === name).getText(ast)).join('\n');
  const harnessFile = path.join(directory, 'host.cjs');
  await esbuild.build({ stdin: { contents: `
    import { randomUUID } from 'node:crypto';
    import { ExecutionFlowRecorder, FLOW_DURATION_BUCKETS_MS } from './common/executionFlowDiagnostics';
    const formatUnknownError = String;
    export class Harness {
      executionFlow = new ExecutionFlowRecorder();
      activeSurface = 'panel'; flowSurfaceFrames = new Map(); flowReceipts = new Map(); flowReceiptLastAt = new Map(); flowCollections = new Map();
      flowMessageSequence = 0; sent = []; posted = [];
      isInteractiveSurface(surface) { return surface === 'panel'; }
      getSurfaceMessageWebview() { return { postMessage: message => { this.sent.push(message); return Promise.resolve(true); } }; }
      getSurfaceLifecycleIdentity() { return { frameId: 'frame' }; }
      withSurfaceLifecycle(surface, message) { return message; }
      shouldQueueUntilBootstrapAck() { return false; }
      recordHostMessage() {} recordDiagnosticEvent() {}
      postMessage(message) { this.posted.push(message); }
      ${methods}
    }`, resolveDir: root, loader: 'ts' }, outfile: harnessFile, bundle: true, platform: 'node', format: 'cjs' });
  const { Harness } = require(harnessFile);
  const host = new Harness();
  const stateMessage = { type: 'host/stateUpdated', payload: { secret: 'PRIVATE-CANVAS' } };
  await host.postMessageWithDeliveryResult(stateMessage);
  assert.equal(host.sent[0], stateMessage, 'disabled diagnostics preserve exact transport message');
  host.executionFlow.start('host-trace');
  await host.postMessageWithDeliveryResult(stateMessage, 'panel', 'runtime-supervisor-live-snapshot');
  await host.postMessageWithDeliveryResult(stateMessage);
  assert.equal(host.sent[1].flowTrace.receipt, true);
  assert.equal(host.sent[2].flowTrace.receipt, false);
  assert.equal(host.flowReceipts.size, 1);
  host.flowReceipts.clear();
  await host.postMessageWithDeliveryResult(stateMessage);
  assert.equal(host.sent[3].flowTrace.receipt, false, 'rate limit also applies after receipt');
  assert.equal(JSON.stringify(host.executionFlow.snapshot()).includes('PRIVATE-CANVAS'), false);
  assert.equal(host.executionFlow.snapshot().seconds[0].messageType, 'host/stateUpdated');
  let receivedParams;
  host.terminalReadRelay = { read: async (_key, params) => { receivedParams = params; return { ...page, diagnostics: timing }; } };
  const payload = { nodeId: 'n', kind: 'agent', executionSessionId: 's', authorityId: 'a', readId: 'r', requestId: 'page-request', afterRevision: 0 };
  await host.readExecutionTerminalPage('panel', payload);
  assert.equal(receivedParams.diagnostics, true);
  let event = host.executionFlow.snapshot().details.find(s => s.stage === 'page-host');
  assert.equal(event.requestId, 'page-request');
  assert.equal(event.supervisorQueueMs, 10);
  assert.equal(event.success, true);
  host.writeExecutionInputUntraced = async () => false;
  assert.equal(await host.writeExecutionInput('agent', 'n', 'PRIVATE-INPUT', { sequence: 7 }), false);
  event = host.executionFlow.snapshot().details.find(s => s.stage === 'input-write');
  assert.equal(event.success, false);
  assert.equal(event.sequence, 7);
  assert.equal(JSON.stringify(host.executionFlow.snapshot()).includes('PRIVATE-INPUT'), false);
  host.postMessage = message => {
    if (message.type === 'host/executionFlowCollect') {
      host.executionFlow.start('next-host-trace');
      host.flowCollections.get(message.payload.requestId).resolve(undefined);
    }
  };
  const collected = await host.collectExecutionFlowTrace();
  assert.equal(collected.host.traceId, 'host-trace', 'restart while collecting must not change exported Host trace');
  assert.equal(collected.surfaces[0].status, 'not-participating');
  host.executionFlow.stop();
  await host.readExecutionTerminalPage('panel', payload);
  assert.equal(receivedParams.diagnostics, undefined, 'inactive Host uses the original Supervisor request');
  console.log('PASS actual Host: disabled transport, bounded receipt sampling, page/input tracing and capture isolation');
} finally {
  await rm(directory, { recursive: true, force: true });
}
