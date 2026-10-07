import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const projectRoot = process.cwd();
const harnessPath = path.join(projectRoot, 'tests/vscode-smoke/execution-capacity-tests.cjs');
const require = createRequire(harnessPath);
const harnessSource = await fs.readFile(harnessPath, 'utf8');
const runnerSource = await fs.readFile(path.join(projectRoot, 'scripts/smoke/run-vscode-execution-candidate.mjs'), 'utf8');
const lifecycle = { surface: 'editor', generation: 3, frameId: 'new-editor' };
const beforeReads = ['a', 'b'].map(nodeId => ({ nodeId, readId: `old-${nodeId}`,
  sessionId: `session-${nodeId}`, authorityId: `authority-${nodeId}` }));
const afterReads = beforeReads.map(before => ({ nodeId: before.nodeId, lifecycle,
  descriptor: { readId: `new-${before.nodeId}`, sessionId: before.sessionId, authorityId: before.authorityId,
    checkpoint: { revision: before.nodeId === 'a' ? 3000 : 3 },
    currentState: { format: 'xterm-current-state-v1', length: before.nodeId === 'a' ? 24000 : 4000 } } }));
const assembly = read => ({ source: 'webview-terminal-drain', reason: 'terminal-current-state-assembled',
  nodeId: read.nodeId, executionSessionId: read.descriptor.sessionId,
  lifecycle: read.lifecycle, checkpointRevision: read.descriptor.checkpoint.revision,
  currentStateLength: read.descriptor.currentState.length, currentStateOffset: read.descriptor.currentState.length,
  currentStateChunkCount: Math.ceil(read.descriptor.currentState.length / 8192),
  currentStateAssemblyPeakCharacters: read.descriptor.currentState.length * 2 });
const message = read => ({ type: 'host/executionSnapshot', lifecycle: read.lifecycle,
  payload: { nodeId: read.nodeId, terminalRead: read.descriptor } });

function loadHarness({ samples = afterReads.map(assembly), messages = [afterReads.map(message)], command, setup = '' } = {}) {
  const archived = new Map();
  const calls = [];
  let clock = 0;
  let messageIndex = 0;
  const module = { exports: {} };
  const vscode = { commands: { executeCommand: async (name, ...args) => {
    const short = name.replace('devSessionCanvas.__test.', '');
    calls.push({ name: short, args });
    if (command) {
      const result = command(short, args);
      if (result !== undefined) return result;
    }
    if (short === 'getHostMessages') return messages[Math.min(messageIndex++, messages.length - 1)];
    if (short === 'dumpHostDiagnostics') return { executionPerformanceDiagnosticsPath: '/evidence/performance.json' };
    return undefined;
  } } };
  const fakeFs = { ...require('node:fs/promises'),
    readFile: async file => JSON.stringify(String(file).endsWith('performance.json') ? { samples } : []),
    writeFile: async (file, bytes) => { archived.set(path.basename(file), JSON.parse(bytes)); } };
  const runtimeRequire = name => name === 'vscode' ? vscode : name === 'node:fs/promises' ? fakeFs
    : name === 'node:perf_hooks' ? { performance: { now: () => ++clock } }
      : name === './execution-capacity-runtime.cjs' ? {} : require(name);
  vm.runInNewContext(`${harnessSource}
    subjects.push(...${JSON.stringify(beforeReads.map(read => ({ id: read.nodeId })))});
    ${setup}
    module.exports.test = { archiveCurrentStateResourceObservation, observeCurrentStateDescriptors, measureCurrentState, run,
      sampleOnce: async () => { startSampling(); stopped = true; await sampler; if (aborted) throw aborted; } };`, {
    module, require: runtimeRequire, process: { env: { DEV_SESSION_CANVAS_CAPACITY_SCENARIO: 'color',
      DEV_SESSION_CANVAS_CAPACITY_CURRENT_STATE: '1', DEV_SESSION_CANVAS_CAPACITY_SESSIONS: '2',
      DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR: '/evidence', DEV_SESSION_CANVAS_CAPACITY_SUBJECT_NODE: '/subject/node' },
      memoryUsage: () => ({ heapUsed: 1 }) },
    setTimeout: (callback, ms) => { if (ms < 600000) queueMicrotask(callback); return 0; }, clearTimeout: () => {},
    Buffer, console
  }, { filename: harnessPath });
  return { api: module.exports.test, archived, calls };
}

test('current-state runner selects a separate fixed two-session Linux workload', () => {
  const source = runnerSource.slice(runnerSource.indexOf('const capacitySelected ='), runnerSource.indexOf('const modes ='));
  const select = (values, platform = 'linux') => vm.runInNewContext(source, { values: { output: '/evidence', ...values },
    process: { platform }, assert, assertReaderIsolationSelection: () => {}, assertInstalledCandidateSelection: () => {} });
  select({ 'capacity-current-state': true });
  for (const addition of [{ mode: 'live-runtime' }, { 'capacity-calibration': true }, { 'capacity-reconnect': true },
    { 'capacity-attach-compact': true }, { 'capacity-sessions': '2' }, { 'reader-isolation': true },
    { 'installed-vsix': '/package.vsix' }]) {
    assert.throws(() => select({ 'capacity-current-state': true, ...addition }));
  }
  assert.throws(() => select({ 'capacity-current-state': true }, 'darwin'));
  assert.throws(() => select({ 'capacity-current-state': true }, 'win32'));
});

test('descriptor observation requires new readers but the original session and authority', async () => {
  const oldMessages = beforeReads.map(before => message({ nodeId: before.nodeId, lifecycle: { ...lifecycle, surface: 'panel' },
    descriptor: { ...before, currentState: { format: 'xterm-current-state-v1', length: 4000 } } }));
  const { api } = loadHarness({ messages: [oldMessages, [message(afterReads[0])], [message(afterReads[1])]] });
  const observed = await api.observeCurrentStateDescriptors(beforeReads, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(observed)), afterReads);
  for (const field of ['sessionId', 'authorityId']) {
    const changed = structuredClone(afterReads);
    changed[0].descriptor[field] = 'replacement';
    const failure = loadHarness({ messages: [changed.map(message)] });
    await assert.rejects(failure.api.observeCurrentStateDescriptors(beforeReads, 100));
  }
});

test('assembly accounting binds to the exact new surface lifecycle, revision and session', async () => {
  const { api, archived } = loadHarness();
  const result = await api.archiveCurrentStateResourceObservation({ expectedReads: afterReads });
  assert.equal(result.maxCurrentStateLength, 24000);
  assert.equal(result.samples[0].currentStateChunkCount, 3);
  assert.equal(archived.get('current-state-resource-observation.json').observedDescriptors[0].descriptor.readId, 'new-a');
  assert.equal(result.supervisorCaptureObservations.length, 0, 'Saved descriptors do not manufacture a capture-peak observation.');
  for (const mutate of [sample => { sample.lifecycle = { ...lifecycle, surface: 'panel' }; },
    sample => { sample.lifecycle = { ...lifecycle, generation: 2 }; },
    sample => { sample.lifecycle = { ...lifecycle, frameId: 'old-editor' }; },
    sample => { sample.checkpointRevision = 1; }, sample => { sample.executionSessionId = 'replacement'; },
    sample => { sample.currentStateLength = sample.currentStateOffset = 4000; },
    sample => { sample.currentStateOffset -= 1; }, sample => { sample.currentStateChunkCount = 1; }]) {
    const samples = afterReads.map(assembly);
    mutate(samples[0]);
    const failure = loadHarness({ samples });
    await assert.rejects(failure.api.archiveCurrentStateResourceObservation({ expectedReads: afterReads }));
    assert.equal(failure.archived.size, 0, 'Invalid or stale assembly evidence must not publish a passing observation.');
  }
});

test('finite entry preserves per-stage preparation budgets before one surface switch and natural cleanup', async () => {
  const events = afterReads.map(read => ({ kind: 'runtime/terminalReadSettled', detail: {
    readId: read.descriptor.readId, outcome: { kind: 'applied', finalRevision: 3001 }, settlement: 'recorded' } }));
  const setup = `
    subjects.length = 0;
    initialize = async () => {};
    startSampling = () => {};
    idle = async () => { baselines.push({ meanSumRss: 100 }); };
    createSubject = async role => {
      const subject = { id: role, reader: ${JSON.stringify(beforeReads)}.find(read => read.nodeId === role) };
      subjects.push(subject); return subject;
    };
    processSamples = async () => {};
    confirmRuntimeIdentities = async () => {};
    assertBindings = () => {};
    readReceipt = async () => command('testSourceReceipt');
    assertReceipt = (receipt, blocks) => assert.equal(receipt.blocks, blocks);
    finishSubjects = async () => { await command('testNaturalFinish'); };`;
  let produced = 0;
  const { api, archived, calls } = loadHarness({ setup, command: (name, args) => {
    if (name === 'performWebviewDomAction' && args[0].kind === 'sendExecutionInput') {
      produced = Number(/^produce:(\d+)\r$/.exec(args[0].data)?.[1]);
      return true;
    }
    if (name === 'testSourceReceipt') return { state: 'stage-complete', blocks: produced };
    if (name === 'getDebugState') return { state: { nodes: [] } };
    if (name === 'captureWebviewProbe') return { capacityCalibration: { interaction: {
      nonce: 'current_state_after_import', applied: true, elapsedMs: 10 } } };
    if (name === 'getDiagnosticEvents') return events;
    return undefined;
  } });
  await api.measureCurrentState();
  const inputs = calls.filter(call => call.name === 'performWebviewDomAction' && call.args[0].kind === 'sendExecutionInput');
  assert.deepEqual(inputs.map(call => call.args[0].data), ['produce:640\r', 'produce:1280\r', 'produce:2560\r']);
  assert.equal(calls.filter(call => call.name === 'devSessionCanvas.openCanvasInEditor').length, 1);
  const suffixes = calls.filter(call => call.name === 'performWebviewDomAction' && call.args[0].kind === 'assertCapacityTerminalSuffix');
  assert.deepEqual(suffixes.map(call => [call.args[0].blocks, call.args[1]]),
    [[640, 'panel'], [1280, 'panel'], [2560, 'panel'], [2560, 'editor']]);
  const preparation = archived.get('current-state-before.json').preparation;
  assert.deepEqual(preparation.map(stage => [stage.blocks, stage.preparationObservationMs]),
    [[640, 30000], [1280, 30000], [2560, 30000]]);
  const preparedActions = calls.filter(call => call.name === 'performWebviewDomAction' &&
    ['sendExecutionInput', 'assertCapacityTerminalSuffix'].includes(call.args[0].kind));
  assert.deepEqual(preparedActions.slice(0, 6).map(call => call.args[0].kind),
    ['sendExecutionInput', 'assertCapacityTerminalSuffix', 'sendExecutionInput',
      'assertCapacityTerminalSuffix', 'sendExecutionInput', 'assertCapacityTerminalSuffix']);
  assert.equal(archived.get('current-state-natural-completion.json').pass, true);
  assert.equal(archived.get('current-state-after.json').pass, undefined);
  assert.equal(archived.get('current-state-after.json').contentAndInteractionPass, true);
  assert.equal(archived.get('current-state-after.json').naturalCompletion, 'pending');
  assert.equal(archived.has('current-state-result.json'), false, 'Full acceptance is published only after outer product cleanup.');
  assert.equal(calls.filter(call => call.name === 'testNaturalFinish').length, 1);
  assert(archived.has('initial-current-state-resource-observation.json'));
  assert(archived.has('current-state-resource-observation.json'));
});

test('sampling clears fill rings but preserves new reader and natural settlement evidence', async () => {
  for (const phase of ['current-state-fill-640', 'current-state-fill-1280', 'current-state-fill-2560',
    'current-state-switch', 'current-state-import', 'current-state-interaction', 'natural-cleanup']) {
    const { api, calls } = loadHarness({ setup: `phase = ${JSON.stringify(phase)}; processSamples = async () => ({ host: 1 });` });
    await api.sampleOnce();
    const cleared = calls.filter(call => ['clearHostMessages', 'clearDiagnosticEvents'].includes(call.name)).map(call => call.name);
    assert.deepEqual(cleared, phase.startsWith('current-state-fill-') ? ['clearHostMessages', 'clearDiagnosticEvents'] : []);
  }
});

test('full finite result is published only after successful product cleanup', async () => {
  for (const cleanupFails of [false, true]) {
    const { api, archived, calls } = loadHarness({ setup: `
      measureCurrentState = async () => { await command('testAcceptanceFinished'); };
      cleanup = async () => { await command('testCleanupFinished'); ${cleanupFails ? "throw new Error('cleanup failed');" : ''} };` });
    if (cleanupFails) await assert.rejects(api.run(), /cleanup failed/);
    else await api.run();
    assert.equal(archived.has('current-state-result.json'), !cleanupFails);
    assert.deepEqual(calls.filter(call => call.name.startsWith('test')).map(call => call.name),
      ['testAcceptanceFinished', 'testCleanupFinished']);
  }
});
