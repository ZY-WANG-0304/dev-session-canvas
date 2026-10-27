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
  const { ExecutionFlowRecorder, FLOW_STAGES, FLOW_DURATION_BUCKETS_MS, FLOW_PENDING_LIMIT, normalizeFlowSnapshot,
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
      recorder.record({ stage, messageType: 'host/stateDelta', bytes: 30 });
    }
    now += 1000;
  }
  snapshot = recorder.snapshot();
  assert.equal(snapshot.seconds.length, 120 * FLOW_STAGES.length * 3);
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

  // Pending observations are censored at the stop/deadline, never completed durations.
  now = 0;
  recorder.start('pending', 100);
  now = 10;
  const pendingToken = recorder.begin({ stage: 'page-host', nodeId: 'node', requestId: 'slow',
    sessionId: 'session', afterRevision: 3, data: 'PRIVATE-BODY', success: true, durationMs: 999 });
  const doneToken = recorder.begin({ stage: 'input-write', nodeId: 'node', sequence: 2 });
  now = 25;
  recorder.finish(doneToken, { stage: 'input-write', success: false });
  now = 60;
  recorder.stop();
  const stopped = recorder.snapshot();
  assert.deepEqual(stopped.pendingSpans, [{ stage: 'page-host', atMs: 10, nodeId: 'node',
    requestId: 'slow', sessionId: 'session', afterRevision: 3, status: 'pending', elapsedMs: 50 }]);
  assert.equal(stopped.seconds.length, 1);
  assert.equal(stopped.seconds[0].stage, 'input-write');
  assert.equal(stopped.seconds[0].totalDurationMs, 15);
  now = 200;
  recorder.finish(pendingToken, { stage: 'page-host', success: true });
  assert.deepEqual(recorder.snapshot(), stopped, 'late finish cannot erase a pending observation');
  assert.deepEqual(normalizeFlowSnapshot(stopped), stopped);
  const { pendingSpans, droppedPendingSpans, ...legacy } = stopped;
  assert.deepEqual(normalizeFlowSnapshot(legacy), legacy, 'missing pending fields remain unknown, not empty');
  const pendingDirty = { ...stopped, pendingSpans: [{ ...pendingSpans[0], data: 'PRIVATE-BODY', success: true, durationMs: 999 }] };
  assert.deepEqual(normalizeFlowSnapshot(pendingDirty), stopped);
  for (const overrides of [{ status: 'completed' }, { elapsedMs: NaN }, { elapsedMs: -1 },
    { elapsedMs: 61 }, { atMs: 61 }, { stage: 'unknown' }]) {
    assert.equal(normalizeFlowSnapshot({ ...stopped, pendingSpans: [{ ...pendingSpans[0], ...overrides }] }), undefined);
  }
  assert.equal(normalizeFlowSnapshot({ ...stopped, pendingSpans: Array(FLOW_PENDING_LIMIT + 1).fill(pendingSpans[0]) }), undefined);
  assert.equal(normalizeFlowSnapshot({ ...stopped, droppedPendingSpans: -1 }), undefined);
  assert.equal(normalizeFlowSnapshot({ ...stopped, droppedPendingSpans: 0.5 }), undefined);
  assert.deepEqual(parseWebviewMessage({ type: 'webview/executionFlowSnapshot',
    payload: { requestId: 'pending-export', snapshot: stopped } }).payload.snapshot, stopped);
  stopped.pendingSpans[0].elapsedMs = 0;
  assert.equal(recorder.snapshot().pendingSpans[0].elapsedMs, 50, 'pending exports are independent copies');
  recorder.start('expired', 100);
  now = 220;
  const expired = recorder.begin({ stage: 'page-roundtrip', requestId: 'deadline' });
  now = 400;
  recorder.finish(expired, { stage: 'page-roundtrip' });
  assert.equal(recorder.snapshot().pendingSpans[0].elapsedMs, 80, 'natural expiry seals at deadline before late finish');
  recorder.stop();
  now = 500;
  assert.equal(recorder.snapshot().pendingSpans[0].elapsedMs, 80, 'late stop cannot extend the deadline');
  recorder.start('new-trace');
  recorder.finish(expired, { stage: 'page-roundtrip' });
  assert.deepEqual(recorder.snapshot().pendingSpans, []);
  assert.deepEqual(recorder.snapshot().details, []);
  const capacity = Array.from({ length: FLOW_PENDING_LIMIT }, (_, index) =>
    recorder.begin({ stage: 'page-host', requestId: `bounded:${index}` }));
  const overflow = recorder.begin({ stage: 'input-write', nodeId: 'overflow' });
  assert.ok(overflow, 'capacity cannot disable normal completed tracing');
  assert.equal(recorder.snapshot().droppedPendingSpans, 1);
  assert.equal(recorder.snapshot().pendingSpans.length, FLOW_PENDING_LIMIT);
  recorder.finish(capacity[0], { stage: 'page-host' });
  recorder.begin({ stage: 'page-host', requestId: 'replacement' });
  recorder.finish(overflow, { stage: 'input-write' });
  assert.equal(recorder.snapshot().pendingSpans.length, FLOW_PENDING_LIMIT);
  assert.equal(recorder.snapshot().details.length, 2);
  assert.equal(recorder.snapshot().droppedPendingSpans, 1);
  recorder.start('sync-deadline', 10);
  recorder.measureSync({ stage: 'state-build' }, () => { now += 20; });
  assert.equal(recorder.snapshot().pendingSpans[0].elapsedMs, 10);
  assert.equal(recorder.snapshot().details.length, 0);
  console.log('PASS pending: manual stop/deadline, late completion/restart, capacity, privacy and legacy protocol');

  // Exercise the production Host methods, with only VS Code and transport boundaries replaced.
  const filename = path.join(root, 'panel/CanvasPanelManager.ts');
  const source = await readFile(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
  const methods = ['postMessageWithDeliveryResult', 'collectExecutionFlowTrace', 'readExecutionTerminalPage', 'writeExecutionInput', 'postState', 'handleWebviewMessage', 'handleActiveWebviewMessage']
    .map(name => declaration.members.find(member => member.name?.getText(ast) === name).getText(ast)).join('\n');
  const harnessFile = path.join(directory, 'host.cjs');
  await esbuild.build({ stdin: { contents: `
    import { randomUUID } from 'node:crypto';
    import { CanvasDisplayPublisher } from './common/canvasDisplayUpdates';
    import { parseWebviewMessage } from './common/protocol';
    const extractWebviewMessageLifecycle = message => message.lifecycle;
    const hasInvalidWebviewLifecycle = () => false;
    const summarizeWebviewLifecycleIdentity = value => value;
    import { ExecutionFlowRecorder, FLOW_DURATION_BUCKETS_MS } from './common/executionFlowDiagnostics';
    const formatUnknownError = String;
    export class Harness {
      executionFlow = new ExecutionFlowRecorder();
      canvasDisplayPublishers = new Map(); pendingCanvasDisplayCatchup = new Set();
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
  assert.equal(host.executionFlow.snapshot().pendingSpans[0].stage, 'message-roundtrip', 'message-post must not finish its receipt span');
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
  let hostClock = 0;
  const slowHost = new Harness();
  slowHost.executionFlow = new ExecutionFlowRecorder(() => hostClock);
  slowHost.executionFlow.start('slow-host');
  let resolvePage, resolveInput;
  slowHost.terminalReadRelay = { read: () => new Promise(resolve => { resolvePage = resolve; }) };
  slowHost.writeExecutionInputUntraced = () => new Promise(resolve => { resolveInput = resolve; });
  slowHost.postMessage = message => {
    if (message.type === 'host/executionFlowCollect') slowHost.flowCollections.get(message.payload.requestId).resolve(undefined);
  };
  hostClock = 10;
  const reading = slowHost.readExecutionTerminalPage('panel', payload);
  const writing = slowHost.writeExecutionInput('agent', 'n', 'PRIVATE-INPUT', { sequence: 4 });
  hostClock = 75;
  const slowExport = await slowHost.collectExecutionFlowTrace();
  assert.deepEqual(slowExport.host.pendingSpans.map(s => [s.stage, s.elapsedMs]), [['page-host', 65], ['input-write', 65]]);
  assert.equal(slowExport.host.pendingSpans[0].requestId, payload.requestId);
  assert.equal(slowExport.host.pendingSpans[0].sessionId, 's');
  assert.equal(slowExport.host.details.some(s => s.stage === 'page-host'), false);
  assert.equal(JSON.stringify(slowExport).includes('PRIVATE-INPUT'), false);
  const savedExport = JSON.stringify(slowExport);
  hostClock = 100;
  resolvePage(page);
  await reading;
  assert.deepEqual(slowHost.executionFlow.snapshot(), slowExport.host);
  slowHost.executionFlow.start('restarted-host');
  resolveInput(true);
  await writing;
  assert.equal(JSON.stringify(slowExport), savedExport);
  assert.deepEqual(slowHost.executionFlow.snapshot().pendingSpans, []);
  assert.deepEqual(slowHost.executionFlow.snapshot().details, []);
  console.log('PASS actual Host: export unresolved page/input with identity; late completions preserve stop and restart');
  console.log('PASS actual Host: disabled transport, bounded receipt sampling, page/input tracing and capture isolation');

  const stateStages = ['state-options-build', 'state-options-set', 'state-canvas-build',
    'state-runtime-build', 'state-sidebar-notify'];
  const makeStateHost = ({ active = true, failing, interactive = true, freezeAt } = {}) => {
    let clock = 0;
    const actual = new Harness();
    actual.executionFlow = new ExecutionFlowRecorder(() => {
      assert.ok(active, 'inactive state diagnostics must not read the timer');
      return clock;
    });
    if (active) actual.executionFlow.start('state-trace');
    const calls = [];
    const failure = new Error('controlled state operation failure');
    const values = { options: { enableScripts: true }, canvas: { nodes: [], body: 'PRIVATE-CANVAS' }, runtime: { body: 'PRIVATE-RUNTIME' } };
    const work = (stage, duration, value) => {
      calls.push(stage); clock += duration;
      if (stage === freezeAt) actual.executionFlow.stop();
      if (stage === failing) throw failure;
      return value;
    };
    const webview = { set options(value) {
      assert.equal(value, values.options);
      work('state-options-set', 3);
    } };
    actual.isInteractiveSurface = () => interactive;
    actual.getSurfaceMessageWebview = () => webview;
    actual.getWebviewOptions = () => work('state-options-build', 2, values.options);
    actual.prepareCanvasStateForWebview = target => {
      assert.equal(target, interactive ? webview : undefined);
      return work('state-canvas-build', 5, values.canvas);
    };
    actual.getRuntimeContext = target => {
      assert.equal(target, interactive ? webview : undefined);
      return work('state-runtime-build', 7, values.runtime);
    };
    actual.postMessageWithDeliveryResult = message => {
      assert.deepEqual(message.payload.state, values.canvas);
      assert.equal(message.payload.runtime, values.runtime);
      work('post', 13);
    };
    actual.sendExecutionFlowStart = () => calls.push('bootstrap-trace-start');
    actual.notifySidebarStateChanged = () => work('state-sidebar-notify', 11);
    return { actual, calls, failure };
  };
  const order = [...stateStages.slice(0, 4), 'post', stateStages[4]];
  const activeState = makeStateHost();
  activeState.actual.postState('host/stateUpdated', { reason: 'runtime-supervisor-live-snapshot' });
  assert.deepEqual(activeState.calls, order);
  const stateTrace = activeState.actual.executionFlow.snapshot();
  assert.deepEqual(stateTrace.details.map(s => [s.stage, s.durationMs]), [
    ['state-options-build', 2], ['state-options-set', 3], ['state-canvas-build', 5],
    ['state-runtime-build', 7], ['state-build', 17], ['state-diff', 0], ['state-sidebar-notify', 11]
  ], 'state-build retains its original boundary and excludes message submission/sidebar work');
  for (const sample of stateTrace.details) {
    assert.equal(sample.requestId, 'state:1');
    assert.equal(sample.reason, 'runtime-supervisor-live-snapshot');
    assert.equal(sample.messageType, 'host/stateUpdated');
  }
  assert.equal(JSON.stringify(stateTrace).includes('PRIVATE-'), false);
  assert.deepEqual(normalizeFlowSnapshot(stateTrace), stateTrace);
  for (const stage of stateStages) {
    const aggregate = stateTrace.seconds.find(s => s.stage === stage);
    assert.equal(aggregate.count, 1);
    assert.equal(aggregate.failures, 0);
    assert.equal(aggregate.messageType, 'host/stateUpdated');
  }
  const inactiveState = makeStateHost({ active: false });
  inactiveState.actual.postState('host/stateUpdated');
  assert.deepEqual(inactiveState.calls, order);
  assert.equal(inactiveState.actual.executionFlow.snapshot(), undefined);
  assert.equal(inactiveState.actual.flowMessageSequence, 0);
  for (const active of [false, true]) for (const failing of stateStages) {
    const f = makeStateHost({ active, failing });
    assert.throws(() => f.actual.postState('host/stateUpdated'), error => error === f.failure);
    assert.deepEqual(f.calls, order.slice(0, order.indexOf(failing) + 1), 'failure preserves original stop point');
    if (active) {
      const last = f.actual.executionFlow.snapshot().details.at(-1);
      assert.equal(last.stage, failing);
      assert.equal(last.success, false);
    }
  }
  const hidden = makeStateHost({ interactive: false });
  hidden.actual.postState('host/stateUpdated');
  assert.deepEqual(hidden.calls, order.slice(2).filter(stage => stage !== 'post'));
  assert.ok(hidden.actual.executionFlow.snapshot().details.every(s => !s.stage.startsWith('state-options-')));
  const bootstrap = makeStateHost();
  bootstrap.actual.postState('host/bootstrap');
  assert.deepEqual(bootstrap.calls, [...order.slice(0, -1), 'bootstrap-trace-start', 'state-sidebar-notify']);
  const frozen = makeStateHost({ freezeAt: 'state-canvas-build' });
  frozen.actual.postState('host/stateUpdated');
  assert.deepEqual(frozen.calls, order, 'freezing diagnostics must not stop state publication');
  assert.deepEqual(frozen.actual.executionFlow.snapshot().details.map(s => s.stage), stateStages.slice(0, 2));
  const displayHost = new Harness();
  displayHost.state = {version:1,updatedAt:'now',nodes:[],edges:[],groups:[],nextGroupSequence:1,fileReferences:[],suppressedFileActivityEdgeIds:[],suppressedAutomaticFileArtifactNodeIds:[]};
  displayHost.surfaceLifecycle={panel:{bootstrapAck:false}};
  displayHost.shouldQueueUntilBootstrapAck=(_surface,m)=>m.type!=='host/bootstrap'&&!displayHost.surfaceLifecycle.panel.bootstrapAck;
  displayHost.getWebviewOptions=()=>({});
  displayHost.prepareCanvasStateForWebview=()=>displayHost.state;
  displayHost.getRuntimeContext=()=>({workspaceTrusted:true});
  let sidebarNotifies=0;
  displayHost.notifySidebarStateChanged=()=>sidebarNotifies++;
  displayHost.isCurrentWebviewMessage=()=>true;
  for(const method of ['flushPendingBootstrapHostMessages','flushTerminalAvailableNotifications','attachLocalExecutionsToSurface','postWorkspaceRootFocusGroupMessageForCurrentLifecycle','postCanvasTemplateCatalogToActiveWebview'])displayHost[method]=()=>{};
  for(let i=0;i<80;i++){displayHost.state.nextGroupSequence=i+1;displayHost.postState('host/stateUpdated');}
  assert.equal(displayHost.sent.length,0,'state catchup must not be subject to the 50-message bootstrap queue');
  assert.equal(displayHost.pendingCanvasDisplayCatchup.size,1);
  displayHost.handleWebviewMessage('panel',{type:'webview/bootstrapAck'});
  assert.equal(displayHost.sent.length,1);assert.equal(displayHost.sent[0].payload.state.nextGroupSequence,80);
  assert.equal(displayHost.sent[0].type,'host/stateUpdated');assert.equal(displayHost.pendingCanvasDisplayCatchup.size,0);
  displayHost.postState('host/stateUpdated');assert.equal(displayHost.sent.length,1);
  displayHost.state.nextGroupSequence=81;displayHost.postState('host/stateUpdated');
  assert.equal(displayHost.sent.at(-1).type,'host/stateDelta');assert.equal(sidebarNotifies,83);
  displayHost.handleActiveWebviewMessage('panel',{type:'webview/requestCanvasState'});
  assert.equal(displayHost.sent.at(-1).type,'host/stateUpdated','explicit gap recovery always sends full state');
  console.log('PASS actual Host canvas transport: bootstrap catchup, no silent queue truncation, empty suppression, sidebar independence, explicit resync');

  console.log('PASS actual Host state stages: exact timing boundaries, correlation, payload identity, inactive mode, errors, bootstrap and freeze');

} finally {
  await rm(directory, { recursive: true, force: true });
}

await import('./test-state-configuration-reuse.mjs');

await import("./test-configuration-echo-probe.mjs");

await import('./test-canvas-display-updates.mjs');
