const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');
const { createHash } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');
const { activateVisibleExtension, expectedExecutionCandidateGeneration, waitForCommand } = require('./test-helpers.cjs');
const { resolveLegacyRuntimeSupervisorPaths, resolveSystemdUserRuntimeSupervisorPaths,
  resolveTerminalJournalSessionDirectory, SerializedTerminalStateTracker, TerminalSessionJournal,
  SERIALIZED_TERMINAL_CHECKPOINT_PROFILES } = require('./execution-capacity-runtime.cjs');
const format = require('./fixtures/execution-capacity-subject.cjs');

const scenario = process.env.DEV_SESSION_CANVAS_CAPACITY_SCENARIO;
const capacityPhase = process.env.DEV_SESSION_CANVAS_CAPACITY_PHASE;
const workload = format.capacityWorkload(Number(process.env.DEV_SESSION_CANVAS_CAPACITY_SESSIONS ?? 2));
const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const surface = 'panel';
const samples = [];
const resourceObservations = [];
const processes = new Map();
const subjects = [];
const stages = [];
const interactions = [];
const baselines = [];
let phase = 'initialization';
let stopped = false;
let aborted;
let sampler;
let samplerTimer;
let root;
let supervisor;
let baselineRss;
let started;
let hidden = false;
let currentStateResourceObservationCaptured = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rawCommand = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const command = async (name, ...args) => { check(); const value = await rawCommand(name, ...args); check(); return value; };
const snapshot = () => command('getDebugState');
const probe = () => command('captureWebviewProbe', surface, 3000);
const dom = action => command('performWebviewDomAction', action, surface, 5000);
const archive = (name, value) => fs.writeFile(path.join(artifacts,
  `${capacityPhase && !['detach-ready', 'reconnect-result'].includes(name) ? `${capacityPhase}-` : ''}${name}.json`),
`${JSON.stringify(value, null, 2)}\n`);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const getNode = (state, id) => state.state.nodes.find(node => node.id === id);
module.exports = { run };

function check() { if (aborted) throw aborted; }

async function poll(label, read, accept, timeoutMs = 30000) {
  const deadline = performance.now() + timeoutMs;
  let latest;
  while (performance.now() < deadline) {
    check();
    latest = await read();
    if (accept(latest)) return latest;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function setLiveScrollback(value, subject) {
  await command('clearHostMessages');
  await vscode.workspace.getConfiguration('terminal.integrated').update(
    'scrollback', value, vscode.ConfigurationTarget.Workspace);
  await poll(`host scrollback update ${value}`, () => command('getHostMessages'), messages =>
    messages.some(message => message.type === 'host/stateUpdated' &&
      message.payload?.runtime?.terminalScrollback === value));
  if (subject) {
    await poll(`runtime scrollback update ${value}`, () => command('getRuntimeSupervisorState'), state =>
      Object.values(state.registries ?? {}).some(entry => entry.registry?.sessions?.some(session =>
        session.sessionId === subject.metadata.runtimeSessionId && session.scrollback === value)));
  }
}

async function run() {
  assert(['color', 'size', 'compact'].includes(scenario));
  assert(artifacts && path.isAbsolute(process.env.DEV_SESSION_CANVAS_CAPACITY_SUBJECT_NODE));
  if (capacityPhase) {
    assert(['detach', 'reconnect', 'cleanup'].includes(capacityPhase));
    assert(scenario === 'color' && workload.sessionCount === 2, 'Only the fixed color two-session reconnect case is defined.');
  }
  started = performance.now();
  let deadline;
  let detached = false;
  try {
    const operation = capacityPhase === 'detach' ? prepareDetach : capacityPhase === 'reconnect' ? reconnect
      : capacityPhase === 'cleanup' ? prepareOwnedCleanup : scenario === 'compact' ? attachCompact : measure;
    await Promise.race([operation(), new Promise((_, reject) => {
      deadline = setTimeout(() => { aborted = new Error('A1 case exceeded the fixed 10 minute safety bound.'); reject(aborted); }, 600000);
    })]);
    detached = capacityPhase === 'detach';
  } catch (error) {
    aborted = error;
    await stopSampling();
    await archive('first-failure', { error: String(error), stack: error.stack, phase,
      automaticRetries: 0, stages, interactions, subjects: subjects.map(subject => subject.identity) });
    for (const name of ['getDebugState', 'getRuntimeSupervisorState', 'getDiagnosticEvents']) {
      try { await archive(`failure-${name}`, await rawCommand(name)); }
      catch (failure) { await archive(`failure-${name}-unavailable`, { error: String(failure) }); }
    }
    try { await archive('failure-webview-probe', await rawCommand('captureWebviewProbe', surface, 3000)); }
    catch (failure) { await archive('failure-webview-probe-unavailable', { error: String(failure) }); }
    throw error;
  } finally {
    clearTimeout(deadline);
    await stopSampling();
    if (subjects.length > 0 && !currentStateResourceObservationCaptured && capacityPhase !== 'cleanup') {
      try {
        await archiveCurrentStateResourceObservation();
      } catch (error) {
        const accountingFailure = !aborted;
        if (accountingFailure) aborted = error;
        await archive('current-state-resource-observation-failure', {
          error: String(error), stack: error.stack, subjectCount: subjects.length,
          workloadFailureAlreadyRecorded: !accountingFailure
        });
      }
    }
    await archive('resource-samples', { scope: 'Actual Extension Host and confirmed Linux processes; sample overhead included.',
      samplePeriodMs: 250, samples, baselines, resourceObservations, phases: summarize(samples), processes: [...processes.values()],
      limitations: ['RSS sums double-count shared pages.', 'Host heap is this isolate; RSS includes other threads.',
        'Renderer group includes workbench; it is not independently attributed Webview RSS.',
        'Unobserved role RSS is omitted from raw samples; budget aggregation uses zero only as an arithmetic placeholder, not an observed RSS value.',
        'Chromium reported heap can be shared or quantized; absent means unavailable.',
        'Supervisor/provider/subject heap is unavailable, not zero.',
        'The original Host test ring clones messages; periodic clearing does not remove its transient cost.',
        'No forced GC, profiler, heap-budget inference or peak claim between samples.'] });
    if (!detached) await cleanup();
    if (aborted) throw aborted;
  }
}

async function archiveCurrentStateResourceObservation() {
  // Allow the Webview write queue to publish the assembly receipt before taking
  // the one bounded diagnostics snapshot used by this capacity case.
  await sleep(250);
  const dump = await command('dumpHostDiagnostics');
  assert(dump?.executionPerformanceDiagnosticsPath,
    'Host diagnostics must expose the performance sample archive for current-state acceptance.');
  const diagnostics = JSON.parse(await fs.readFile(dump.executionPerformanceDiagnosticsPath, 'utf8'));
  const diagnosticEventsPath = path.join(path.dirname(dump.executionPerformanceDiagnosticsPath), 'diagnostic-events.json');
  const diagnosticEvents = JSON.parse(await fs.readFile(diagnosticEventsPath, 'utf8').catch(() => '[]'));
  const opened = (Array.isArray(diagnosticEvents) ? diagnosticEvents : [])
    .filter(event => event.kind === 'runtime/terminalPagedReadOpened' &&
      event.detail?.currentState === 'xterm-current-state-v1')
    .map(event => ({
      nodeId: event.detail.nodeId,
      executionSessionId: event.detail.sessionId,
      stateLength: event.detail.stateLength,
      checkpointRevision: event.detail.checkpointRevision,
      headRevision: event.detail.headRevision
    }));
  const samples = Array.isArray(diagnostics.samples) ? diagnostics.samples : [];
  const stateSamples = samples.filter(sample => sample.source === 'webview-terminal-drain' &&
    sample.reason === 'terminal-current-state-assembled' && typeof sample.nodeId === 'string');
  const latestByNode = new Map();
  for (const sample of stateSamples) latestByNode.set(sample.nodeId, sample);
  const observed = subjects.map(subject => latestByNode.get(subject.id)).filter(Boolean);
  assert.equal(observed.length, subjects.length,
    'Every capacity subject must report a complete current-state assembly sample.');
  for (const sample of observed) {
    assert(Number.isSafeInteger(sample.currentStateLength) && sample.currentStateLength > 0);
    assert(Number.isSafeInteger(sample.currentStateOffset) && sample.currentStateOffset === sample.currentStateLength);
    assert(Number.isSafeInteger(sample.currentStateChunkCount) && sample.currentStateChunkCount > 0);
    assert(Number.isSafeInteger(sample.currentStateAssemblyPeakCharacters) &&
      sample.currentStateAssemblyPeakCharacters >= sample.currentStateLength);
  }
  await archive('current-state-resource-observation', {
    scope: 'Current-state assembly accounting for the same real Electron capacity workload; no general RSS budget or state-length threshold.',
    sessionCount: subjects.length,
    observedSubjects: observed.map(sample => sample.nodeId),
    maxCurrentStateLength: Math.max(...observed.map(sample => sample.currentStateLength)),
    maxAssemblyPeakCharacters: Math.max(...observed.map(sample => sample.currentStateAssemblyPeakCharacters)),
    aggregateAssemblyPeakCharacters: observed.reduce((sum, sample) => sum + sample.currentStateAssemblyPeakCharacters, 0),
    supervisorCaptureObservations: opened,
    samples: observed.map(sample => ({
      nodeId: sample.nodeId,
      executionSessionId: sample.executionSessionId,
      currentStateLength: sample.currentStateLength,
      currentStateOffset: sample.currentStateOffset,
      currentStateChunkCount: sample.currentStateChunkCount,
      currentStateAssemblyPeakCharacters: sample.currentStateAssemblyPeakCharacters
    })),
    diagnosticSchema: diagnostics.summary ?? null,
    limitations: [
      'Supervisor capture is represented by the negotiated state length; no RSS inference is made from character counts.',
      'The assembly peak is the existing conservative UTF-16 estimate, not a process memory limit.',
      'Over-limit handling remains an explicit failure or compatibility fallback; this acceptance never truncates state.'
    ]
  });
  currentStateResourceObservationCaptured = true;
}

async function initialize({ reset }) {
  await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
  await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
  if (reset) await command('resetState');
  await openSurface();
  const hostReadyMs = performance.now() - started;
  await dom({ kind: 'configureCapacityCalibration', nodeId: 'calibration', enabled: true });
  assert.equal(vscode.workspace.getConfiguration('terminal.integrated').get('scrollback'), 100000);
  root = await vscodeRoot();
  await archive('environment', { scenario, workload, capacityPhase, pid: process.pid, vscodeRoot: root, versions: process.versions,
    vscode: vscode.version, executable: process.execPath, subjectExecutable: process.env.DEV_SESSION_CANVAS_CAPACITY_SUBJECT_NODE });
  return hostReadyMs;
}

async function confirmLiveIdentity(expected, label) {
  const current = await identity(expected.pid);
  assert(current && !['Z', 'X'].includes(current.state), `${label} must remain alive.`);
  assert.equal(current.startTicks, expected.startTicks, `${label} start identity changed.`);
  assert.equal(current.executable, expected.executable, `${label} executable changed.`);
  return current;
}

async function confirmRuntimeIdentities() {
  await confirmLiveIdentity(supervisor, 'Original Supervisor');
  const hello = await rpc(supervisor.socketPath, 'hello');
  assert.equal(hello.pid, supervisor.pid);
  const providers = [...processes.values()].filter(entry => entry.role === 'provider');
  assert.equal(providers.length, 2, 'Both original session providers must have confirmed identities.');
  for (const provider of providers) {
    let ancestor = await confirmLiveIdentity(provider, 'Original provider');
    while (ancestor && ancestor.pid !== supervisor.pid && ancestor.ppid > 1) ancestor = await identity(ancestor.ppid);
    assert.equal(ancestor?.pid, supervisor.pid, 'Provider identity must belong to the original Supervisor.');
  }
  for (const subject of subjects) {
    let ancestor = await confirmLiveIdentity(subject.identity, `Original subject ${subject.role}`);
    let provider;
    while (ancestor && ancestor.pid !== supervisor.pid && ancestor.ppid > 1) {
      provider ??= providers.find(entry => entry.pid === ancestor.pid && entry.startTicks === ancestor.startTicks);
      ancestor = await identity(ancestor.ppid);
    }
    assert.equal(ancestor?.pid, supervisor.pid, 'Subject must still belong to the original Supervisor.');
    assert(provider, 'Each subject must descend from a confirmed original provider.');
  }
  return hello;
}

function assertBindings(state, runtime) {
  for (const subject of subjects) {
    const node = getNode(state, subject.id);
    assert(node?.metadata?.terminal?.liveSession, 'The original node must retain its live binding.');
    const binding = runtime.bindings.find(entry => entry.nodeId === subject.id);
    assert(binding, 'The original runtime binding must be present.');
    for (const key of ['runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId']) {
      assert.equal(node.metadata.terminal[key], subject.metadata[key], `Original node ${key} changed.`);
      assert.equal(binding[key], subject.metadata[key], `Original runtime ${key} changed.`);
    }
    assert.equal(binding.kind, 'terminal');
  }
}

async function prepareDetach() {
  await initialize({ reset: true });
  startSampling();
  await idle(0);
  baselineRss = baselines[0].meanSumRss;
  await createSubject('a');
  await idle(1);
  await createSubject('b');
  await archiveCurrentStateResourceObservation();
  await idle(2);
  phase = 'detach-flush';
  const saved = await command('flushPersistedState');
  assert(saved.exists && saved.snapshot?.state);
  assert.equal(saved.lastError, undefined, 'The detach flush must succeed, not reuse an older persisted snapshot.');
  const runtime = await command('getRuntimeSupervisorState');
  assertBindings(saved.snapshot, runtime);
  assertBindings(await snapshot(), runtime);
  await stopSampling();
  await processSamples();
  await confirmRuntimeIdentities();
  check();
  await archive('detach-ready', { hostIdentity: await identity(process.pid), supervisor, subjects,
    processes: [...processes.values()], runtime, persisted: true,
    cleanupOwnership: 'Transferred to the outer runner after this phase succeeds; no reset is performed.' });
}

async function restoreOwnedState() {
  const saved = JSON.parse(await fs.readFile(path.join(artifacts, 'detach-ready.json'), 'utf8'));
  assert(saved.hostIdentity && saved.supervisor && saved.subjects?.length === 2 && Array.isArray(saved.processes));
  assert.deepEqual(saved.subjects.map(subject => subject.role), ['a', 'b']);
  const ownedUserData = path.resolve(artifacts, '..', 'user-data');
  for (const subject of saved.subjects) {
    assert(subject.identity && subject.reader && subject.paths && subject.metadata?.runtimeSessionId);
    assert(path.resolve(subject.metadata.runtimeStoragePath).startsWith(`${ownedUserData}${path.sep}`));
    assert.equal(subject.receiptPath, path.join(artifacts, `subject-${subject.role}.json`));
  }
  supervisor = saved.supervisor;
  subjects.push(...saved.subjects);
  for (const entry of saved.processes) processes.set(`${entry.pid}:${entry.startTicks}`, entry);
  return saved;
}

async function prepareOwnedCleanup() {
  phase = 'recover-cleanup-ownership';
  await restoreOwnedState();
  await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
  await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
}

async function reconnect() {
  phase = 'reconnect-identities';
  const saved = await restoreOwnedState();
  const oldHost = await identity(saved.hostIdentity.pid);
  assert(!oldHost || oldHost.startTicks !== saved.hostIdentity.startTicks || ['Z', 'X'].includes(oldHost.state),
    'The original Extension Host must exit before reconnect.');
  const hostIdentity = await identity(process.pid);
  assert(hostIdentity);
  await confirmRuntimeIdentities();
  const [a, b] = subjects;
  const receipt = await readReceipt(a);
  assert.equal(receipt.state, 'stage-complete');
  assert.equal(receipt.blocks, 2560);
  assertReceipt(receipt, 2560);
  const hostReadyMs = await initialize({ reset: false });
  const catchupDeadline = started + hostReadyMs + 30000;
  phase = 'reconnect-catchup';
  // Restored nodes can attach before the calibration probe is enabled. Preserve
  // the original Host descriptors before the sampler clears its message ring.
  const attached = await poll('original bindings and actual restored reader descriptors', async () => {
    const state = await snapshot();
    const runtime = await command('getRuntimeSupervisorState');
    const messages = await command('getHostMessages');
    const currentProbe = await probe();
    const readers = subjects.map(subject => {
      let reader = currentProbe.capacityCalibration?.readers.find(entry => entry.nodeId === subject.id);
      let evidenceSource = 'webview-calibration-probe';
      if (!reader) {
        const message = messages.findLast(entry => entry.type === 'host/executionSnapshot' &&
          entry.payload.nodeId === subject.id && entry.payload.terminalRead);
        if (message) reader = { nodeId: subject.id, ...message.payload.terminalRead };
        evidenceSource = 'original-host-executionSnapshot-descriptor';
      }
      return { before: subject.reader, after: reader, evidenceSource };
    });
    return { state, runtime, readers };
  }, value => subjects.every(subject => getNode(value.state, subject.id)?.metadata?.terminal?.liveSession &&
    value.runtime.bindings.some(entry => entry.nodeId === subject.id)) && value.readers.every(entry => entry.after),
  Math.max(0, catchupDeadline - performance.now()));
  assertBindings(attached.state, attached.runtime);
  const readers = attached.readers;
  for (const [index, subject] of subjects.entries()) {
    const reader = readers[index].after;
    assert.equal(reader.sessionId, subject.metadata.runtimeSessionId);
    assert.equal(reader.authorityId, subject.reader.authorityId);
    assert.notEqual(reader.readId, subject.reader.readId, 'A new Host must establish a new terminal reader.');
  }
  await archive('reader-identities', readers);
  startSampling();
  const mounted = await poll('restored terminals mounted and numbered output applied', probe,
    value => subjects.every(subject => value.nodes.some(entry => entry.nodeId === subject.id &&
      entry.terminalCols >= 78 && entry.terminalRows >= 3)) && value.nodes.some(entry => entry.nodeId === a.id &&
      entry.terminalBufferType === 'normal' && entry.terminalVisibleLines?.some(line => /^(\d{8}):x{69}$/.test(line))),
    Math.max(0, catchupDeadline - performance.now()));
  await archive('restored-terminal-dimensions', mounted.nodes.filter(entry => subjects.some(subject => subject.id === entry.nodeId)));
  const nonce = `reconnect_${process.pid}_${Date.now()}`;
  const interactionStartedMs = performance.now() - started;
  await dom({ kind: 'measureCapacityInteraction', nodeId: b.id, loadNodeId: a.id, nonce });
  const interaction = (await probe()).capacityCalibration.interaction;
  assert.equal(interaction?.nodeId, b.id);
  assert.equal(interaction.nonce, nonce);
  const overlap = interaction.loadLastBlockBefore > 0 &&
    interaction.loadLastBlockBefore <= interaction.loadLastBlockAfter && interaction.loadLastBlockAfter < 2560;
  interactions.push({ ...interaction, phase, peer: b.role, measuredWhileSurfaceVisible: true,
    targetBlocks: 2560, loadNotAtTargetBeforeInput: interaction.loadLastBlockBefore < 2560,
    catchupInteractionOverlapObserved: overlap });
  assert(interaction.applied && interaction.elapsedMs <= 1500, `Reconnected subject response exceeded observation bound: ${JSON.stringify(interaction)}`);
  const interactionFinishedMs = performance.now() - started;
  let lastSuffixError;
  try {
    await poll('complete retained xterm suffix after actual Host replacement', async () => {
      try { await dom({ kind: 'assertCapacityTerminalSuffix', nodeId: a.id, blocks: 2560 }); return true; }
      catch (error) {
        lastSuffixError = String(error);
        if (!/Capacity suffix pending/.test(lastSuffixError)) throw error;
        return false;
      }
    }, Boolean, Math.max(0, catchupDeadline - performance.now()));
  } catch (error) {
    await archive('catchup-observation', { hostReadyMs, elapsedMs: performance.now() - started,
      lastSuffixError, targetBlocks: 2560, catchupMs: 30000 });
    throw error;
  }
  const fullApplyMs = performance.now() - started;
  assert(fullApplyMs - hostReadyMs <= 30000, 'Restored bindings, reader and complete xterm suffix must settle within 30 seconds of Host ready.');
  await confirmRuntimeIdentities();
  await stopSampling();
  check();
  phase = 'reconnect-independent-journal-validation';
  const validation = await verifyJournal(a, receipt);
  assert.equal(validation.rejectionReason, 'color-state');
  await archive('independent-journal-validation', validation);
  await finishSubjects();
  await archive('reconnect-result', { pass: overlap, oldHostIdentity: saved.hostIdentity,
    oldHostAtReconnect: oldHost ?? null, hostIdentity, supervisor,
    readers, receipt, validation, interactions, timing: { hostReadyMs, fullApplyMs,
      catchupAfterHostReadyMs: fullApplyMs - hostReadyMs, interactionStartedMs, interactionFinishedMs },
    catchupInteractionOverlapObserved: overlap,
    overlapAcceptance: overlap ? 'covered' : 'not-covered; no product regression inferred from missed overlap alone',
    cleanupResult: 'See reconnect-cleanup.json; this result alone does not assert cleanup success.',
    scope: 'Actual two-session color Host detach/offline output/reconnect only; no Agent or other-platform claim.' });
  assert(overlap, 'Host reconnect interaction overlap was not covered: require 0 < before <= after < 2560; original content and cleanup evidence remain separate.');
}

async function finishSubjects() {
  phase = 'natural-cleanup';
  for (const subject of subjects) await dom({ kind: 'sendExecutionInput', nodeId: subject.id, data: 'finish\r' });
  await poll('all subjects naturally closed with no completed history', snapshot, state => subjects.every(subject => {
    const node = getNode(state, subject.id);
    return node?.status === 'closed' && node.metadata?.terminal?.terminalHistoryDiscarded === true &&
      node.metadata.terminal.lastExitCode === 0;
  }));
  for (const subject of subjects) {
    await poll('own subject reaped', () => identity(subject.identity.pid),
      value => !value || value.startTicks !== subject.identity.startTicks);
  }
}

async function attachCompact() {
  await initialize({ reset: true });
  // Keep the validated checkpoint below the production serialized-state cap;
  // subsequent updates still exercise the live scrollback event path.
  await setLiveScrollback(512);
  startSampling();
  await idle(0);
  baselineRss = baselines[0].meanSumRss;
  const a = await createSubject('a');
  const b = await createSubject('b');
  await archiveCurrentStateResourceObservation();
  const beforeReader = (await probe()).capacityCalibration.readers.find(reader => reader.nodeId === a.id);

  phase = 'dynamic-scrollback';
  await setLiveScrollback(768, a);
  const beforeResize = (await probe()).nodes.find(entry => entry.nodeId === a.id);
  let aNode = getNode(await snapshot(), a.id);
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: a.id, position: aNode.position,
    size: { width: aNode.size.width + 100, height: aNode.size.height + 60 } } }, surface);
  const resizedProbe = await poll('initial dynamic terminal resize', probe, value => {
    const node = value.nodes.find(entry => entry.nodeId === a.id);
    return node && (node.terminalCols !== beforeResize?.terminalCols || node.terminalRows !== beforeResize?.terminalRows)
      ? node : false;
  });
  const resized = resizedProbe.nodes.find(entry => entry.nodeId === a.id);

  phase = 'attach-output';
  for (const target of format.blocks) {
    await dom({ kind: 'sendExecutionInput', nodeId: a.id, data: `produce:${target}\r` });
    await poll(`compact source write ${target}`, () => readReceipt(a), value =>
      value.state === 'stage-complete' && value.blocks === target, 60000);
  }
  const firstOutput = await poll('compact source write', () => readReceipt(a), value =>
    value.state === 'stage-complete' && value.blocks === 2560, 60000);
  assertReceipt(firstOutput, 2560);
  const first = await checkpoint(a, 0);
  await archive('compact-checkpoint-before', { firstOutput, checkpoint: first });
  const firstManifestPath = path.join(
    resolveTerminalJournalSessionDirectory(a.paths.storageDir, a.metadata.runtimeSessionId),
    'manifest.json'
  );
  await archive('compact-manifest-initial', JSON.parse(await fs.readFile(firstManifestPath, 'utf8')));
  assert(first.checkpoint && first.checkpoint.revision === first.revision,
    'The first eligible checkpoint must cover the live journal head.');
  await poll('A terminal applied the compact source suffix', probe, value => {
    const node = value.nodes.find(entry => entry.nodeId === a.id);
    return Boolean(node?.terminalVisibleLines?.some(line => /^00002560:x{69}$/.test(line)));
  }, 30000);

  // The attached reader must consume a post-checkpoint response before C2 is
  // allowed to reclaim the prefix. This reader uses TerminalPagedProjection;
  // its page cursor is not reported through the live terminal-stream applied
  // ACK diagnostic, so the DOM response is the authoritative harness evidence.
  await command('clearDiagnosticEvents');
  await dom({ kind: 'measureCapacityInteraction',
    nodeId: a.id, loadNodeId: b.id, nonce: `compact-before-${Date.now()}` });
  const readerAdvancedInteraction = (await probe()).capacityCalibration.interaction;
  assert(readerAdvancedInteraction?.applied && readerAdvancedInteraction.nodeId === a.id,
    'The attached reader must consume a post-checkpoint response before compaction.');
  assert(readerAdvancedInteraction.nonce.startsWith('compact-before-'));
  assert(readerAdvancedInteraction.loadLastBlockAfter >= readerAdvancedInteraction.loadLastBlockBefore,
    'The post-checkpoint interaction must retain its source load observation.');

  // A paged reader proves a page was consumed when it requests the next page.
  // Add a tiny suffix so an idle reader whose C1 page ended at the head gets a
  // subsequent request and advances its retention cursor to C1.
  const retentionProbeBlocks = 1;
  await dom({ kind: 'sendExecutionInput', nodeId: a.id, data: `noise:${retentionProbeBlocks}\r` });
  const retentionProbeMarker = `DSC_A1_COMPACT_NOISE_DONE_${retentionProbeBlocks}`;
  await poll('retention probe output', probe, value => {
    const node = value.nodes.find(entry => entry.nodeId === a.id);
    return Boolean(node?.terminalVisibleLines?.some(line => line.includes(retentionProbeMarker)));
  }, 30000);
  await setLiveScrollback(1024, a);

  // The first checkpoint is initially gated by the attached paged reader's
  // retention cursor. Retry after the reader has consumed the checkpoint
  // suffix so the next promotion can exercise the two-checkpoint compact path.
  let firstPromotion;
  const firstPromotionDeadline = performance.now() + 30000;
  while (performance.now() < firstPromotionDeadline) {
    firstPromotion = await checkpoint(a, 0);
    const manifest = JSON.parse(await fs.readFile(firstManifestPath, 'utf8'));
    if (manifest.version === 2 && manifest.currentCheckpoint?.revision >= first.revision) break;
    await sleep(500);
  }
  await archive('compact-manifest-before', JSON.parse(await fs.readFile(firstManifestPath, 'utf8')));
  assert(firstPromotion?.checkpoint?.revision >= first.revision,
    `The first checkpoint was not committed after reader catch-up: ${JSON.stringify(firstPromotion)}`);
  const committedFirst = firstPromotion;

  phase = 'resize';
  aNode = getNode(await snapshot(), a.id);
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: a.id, position: aNode.position,
    size: { width: aNode.size.width + 140, height: aNode.size.height + 80 } } }, surface);
  const resizedAgainProbe = await poll('second dynamic terminal resize', probe, value => {
    const node = value.nodes.find(entry => entry.nodeId === a.id);
    return node && (node.terminalCols !== resized.terminalCols || node.terminalRows !== resized.terminalRows)
      ? node : false;
  });
  const resizedAgain = resizedAgainProbe.nodes.find(entry => entry.nodeId === a.id);
  const compactNoiseBlocks = Math.ceil((18 * 1024 ** 2) / 10240);
  await dom({ kind: 'sendExecutionInput', nodeId: a.id, data: `noise:${compactNoiseBlocks}\r` });
  await poll('compact noise output', () => command('getRuntimeSupervisorState'), state =>
    Object.values(state.registries ?? {}).some(entry => entry.registry?.sessions?.some(session =>
      session.sessionId === a.metadata.runtimeSessionId &&
      session.output?.includes(`DSC_A1_COMPACT_NOISE_DONE_${compactNoiseBlocks}`))), 60000);
  const compactNoiseMarker = `DSC_A1_COMPACT_NOISE_DONE_${compactNoiseBlocks}`;
  await poll('A terminal applied compact noise suffix', probe, value => {
    const node = value.nodes.find(entry => entry.nodeId === a.id);
    return Boolean(node?.terminalVisibleLines?.some(line => line.includes(compactNoiseMarker)));
  }, 60000);
  // Output pages do not carry a live applied-revision ACK. A bounded pair of
  // scrollback events after the flood gives the same reader a non-output
  // revision boundary, then restores the required final value for C2.
  await setLiveScrollback(1152, a);
  await setLiveScrollback(1024, a);
  // Give the journal and tracker time to drain the bounded post-checkpoint
  // workload before issuing the expensive checkpoint validation RPC.
  await sleep(1000);
  const checkpointDeadline = performance.now() + 60000;
  let second;
  while (performance.now() < checkpointDeadline) {
    second = await checkpoint(a, committedFirst.revision);
    if (second.revision > committedFirst.revision && second.checkpoint?.revision === second.revision &&
        second.checkpoint.scrollback === 1024) break;
    await sleep(1000);
  }
  const settledAfterCheckpointProbe = await poll('checkpoint geometry settle', probe, value => {
    const node = value.nodes.find(entry => entry.nodeId === a.id);
    return node && node.terminalCols === second?.checkpoint?.cols &&
      node.terminalRows === second?.checkpoint?.rows ? node : false;
  }, 30000);
  const settledAfterCheckpoint = settledAfterCheckpointProbe.nodes.find(entry => entry.nodeId === a.id);
  await archive('compact-checkpoint-attempt', { second, resizedAgain, settledAfterCheckpoint });
  assert(second && second.revision > committedFirst.revision && second.checkpoint?.revision === second.revision &&
    second.checkpoint.scrollback === 1024 && second.checkpoint.cols === settledAfterCheckpoint.terminalCols &&
    second.checkpoint.rows === settledAfterCheckpoint.terminalRows,
  `Live checkpoint promotion did not reach the dynamic terminal head: ${JSON.stringify(second)}`);
  await archive('compact-resize', { before: beforeResize, first: resized, after: resizedAgain, checkpoint: second });

  phase = 'compact-retention';
  const directory = resolveTerminalJournalSessionDirectory(a.paths.storageDir, a.metadata.runtimeSessionId);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  await archive('compact-manifest', manifest);
  assert(manifest.version === 2 && manifest.currentCheckpoint && manifest.previousCheckpoint,
    `Live compact must retain current and fallback checkpoint references: ${JSON.stringify({
      version: manifest.version,
      retainedStartRevision: manifest.retainedStartRevision,
      currentCheckpoint: manifest.currentCheckpoint,
      previousCheckpoint: manifest.previousCheckpoint
    })}`);
  assert(manifest.retainedStartRevision > 1, 'The second checkpoint must compact at least one old journal revision.');
  assert(manifest.currentCheckpoint.revision > committedFirst.checkpoint.revision &&
    manifest.currentCheckpoint.revision <= second.revision,
  'The compacted current checkpoint must be newer than the first committed generation and no newer than the observed head.');
  assert.equal(manifest.lastRevision, second.revision);
  const journal = await TerminalSessionJournal.open({ storageDir: a.paths.storageDir,
    sessionId: a.metadata.runtimeSessionId, authorityId: a.reader.authorityId,
    checkpointProfiles: SERIALIZED_TERMINAL_CHECKPOINT_PROFILES });
  const recoveryCandidates = await journal.getRecoveryCandidates();
  const currentCandidate = recoveryCandidates.find(candidate => candidate.source === 'current');
  const previousCandidate = recoveryCandidates.find(candidate => candidate.source === 'previous');
  assert(currentCandidate && previousCandidate, 'Compaction must preserve current and previous recovery candidates.');
  assert.equal(currentCandidate.checkpoint.revision, manifest.currentCheckpoint.revision);
  assert.equal(previousCandidate.checkpoint.revision, committedFirst.checkpoint.revision);
  const previousEvents = previousCandidate.events;
  const previousRevisions = previousEvents.map(event => event.revision);
  assert(previousRevisions.length > 0, 'The fallback candidate must expose the retained post-checkpoint events.');
  assert(previousRevisions.every((revision, index) => revision === committedFirst.revision + index + 1),
    'Retained journal revisions must remain contiguous after compaction.');
  assert(previousEvents.some(event => event.type === 'resize' && event.cols === second.checkpoint.cols &&
    event.rows === second.checkpoint.rows), 'The fallback candidate must retain the post-checkpoint resize.');
  assert(previousEvents.some(event => event.type === 'scrollback' && event.scrollback === second.checkpoint.scrollback),
    'The fallback candidate must retain the post-checkpoint scrollback update.');
  await archive('compact-recovery-candidates', {
    retainedStartRevision: manifest.retainedStartRevision,
    current: { checkpointRevision: currentCandidate.checkpoint.revision, eventCount: currentCandidate.events.length },
    previous: { checkpointRevision: previousCandidate.checkpoint.revision,
      eventCount: previousCandidate.events.length,
      firstRevision: previousRevisions[0], lastRevision: previousRevisions.at(-1),
      types: previousEvents.reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] ?? 0) + 1 }), {}) }
  });
  await command('clearHostMessages');
  await command('clearDiagnosticEvents');
  const afterAInteraction = await dom({ kind: 'measureCapacityInteraction',
    nodeId: a.id, loadNodeId: b.id, nonce: `compact-after-a-${Date.now()}` });
  const afterAProbe = (await probe()).capacityCalibration.interaction;
  assert(afterAProbe?.applied && afterAProbe.nodeId === a.id && afterAProbe.elapsedMs <= 1500,
    `A reader did not remain interactive after live compaction: ${JSON.stringify(afterAProbe)}`);
  const compactDiagnostics = await command('getDiagnosticEvents');
  assert(!compactDiagnostics.some(event => event.kind === 'runtime/terminalPagedReadFailed'),
    'The compacted reader must not report a paged read failure.');
  // A current-state/checkpoint restore may apply the Supervisor's canonical
  // geometry after the preceding ResizeObserver sample (for example 144x38
  // after an intermediate 143x38 fit). The post-compaction assertion must use
  // that final checkpoint geometry rather than the earlier transient sample.
  const finalGeometry = { cols: second.checkpoint.cols, rows: second.checkpoint.rows };
  const afterA = await poll('compacted terminal projection', probe, value => {
    const node = value.nodes.find(entry => entry.nodeId === a.id);
    return node && node.terminalCols === finalGeometry.cols && node.terminalRows === finalGeometry.rows &&
      node.terminalVisibleLines?.some(line => line === `DSC_A1_REPLY_${afterAProbe.nonce}`) ? node : false;
  });
  const afterBInteraction = await dom({ kind: 'measureCapacityInteraction',
    nodeId: b.id, loadNodeId: a.id, nonce: `compact-after-b-${Date.now()}` });
  const compactInteraction = (await probe()).capacityCalibration.interaction;
  assert(compactInteraction?.applied && compactInteraction.nodeId === b.id && compactInteraction.elapsedMs <= 1500,
    `Peer interaction after live compaction failed: ${JSON.stringify(compactInteraction)}`);
  const pageErrors = (await command('getHostMessages')).filter(message =>
    message.type === 'host/executionTerminalPage' && message.payload?.error);
  assert.deepEqual(pageErrors, [], 'The attached reader must not receive a page error after compaction.');
  await stopSampling();
  const afterReader = (await probe()).capacityCalibration.readers.find(reader => reader.nodeId === a.id);
  assert.deepEqual(afterReader, beforeReader, 'Live compaction must retain the attached reader identity.');
  await archive('compact-result', { firstOutput, first, second,
    manifest: { retainedStartRevision: manifest.retainedStartRevision,
      currentCheckpoint: manifest.currentCheckpoint, previousCheckpoint: manifest.previousCheckpoint },
    interactions: [readerAdvancedInteraction, afterAInteraction, afterBInteraction, compactInteraction],
    afterA, readers: { before: beforeReader, after: afterReader },
    scope: 'Actual two-session Linux Electron attach with output, dynamic scrollback, resize, live checkpoint promotion and reader retention.' });
  await setLiveScrollback(100000, a);
  await finishSubjects();
}

async function measure() {
  await initialize({ reset: true });
  startSampling();
  await idle(0);
  baselineRss = baselines[0].meanSumRss;
  const a = await createSubject('a');
  await idle(1);
  const b = await createSubject('b');
  await idle(2);
  const peers = [b];
  for (let index = 2; index < workload.sessionCount; index += 1) peers.push(await createSubject(`b${index}`));
  await archiveCurrentStateResourceObservation();
  if (workload.sessionCount === 10) await idle(10);
  const before = await checkpoint(a, 0);
  let previousCheckpoint = before.checkpointRevision;
  await archive('checkpoint-before', before);
  for (const blocks of format.blocks) {
    check();
    phase = `output-${blocks}`;
    const stage = { blocks, encodedBlockBytes: 10240, startedMs: performance.now() - started,
      checkpointBefore: previousCheckpoint, interactions: [] };
    const stageDeadline = performance.now() + 30000;
    stages.push(stage);
    const beforeRead = (await probe()).capacityCalibration.readers.find(reader => reader.nodeId === a.id);
    await dom({ kind: 'sendExecutionInput', nodeId: a.id, data: `produce:${blocks}\r` });
    if (blocks === 1280) {
      stage.surfaceBefore = surfaceState(await snapshot());
      hidden = true;
      await sampler;
      await vscode.commands.executeCommand('workbench.action.closePanel');
      stage.surfaceHidden = surfaceState(await poll('actual surface hidden', snapshot,
        state => state.sidebar?.canvasSurface === 'hidden', 5000));
      const hideStarted = performance.now();
      await sleep(5000);
      check();
      stage.sourceReceiptBeforeRestore = await readReceipt(a);
      await openSurface();
      stage.hideDurationMs = performance.now() - hideStarted;
      hidden = false;
      stage.surfaceRestored = surfaceState(await snapshot());
      phase = `restore-catchup-${blocks}`;
    }
    const interactionTargets = workload.sessionCount === 2 ? [b, b, b] : peers;
    for (const [index, peer] of interactionTargets.entries()) {
      const nonce = `${scenario}_${blocks}_${index}`;
      await dom({ kind: 'measureCapacityInteraction', nodeId: peer.id, loadNodeId: a.id, nonce });
      const value = (await probe()).capacityCalibration;
      assert.equal(value.interaction?.nonce, nonce);
      const sample = { ...value.interaction, peer: peer.role, phase, measuredWhileSurfaceVisible: true, targetBlocks: blocks,
        loadNotAtTargetBeforeInput: value.interaction.loadLastBlockBefore < blocks };
      interactions.push(sample);
      stage.interactions.push(sample);
      assert(sample.applied && sample.elapsedMs <= 1500, `Actual subject response exceeded observation bound: ${JSON.stringify(sample)}`);
      await sleep(200);
    }
    const receipt = await poll('successful fixed subject writes', () => readReceipt(a),
      value => value.state === 'stage-complete' && value.blocks === blocks, Math.max(0, stageDeadline - performance.now()));
    assertReceipt(receipt, blocks);
    const catchupStarted = performance.now();
    await poll('complete actual retained xterm suffix', async () => {
      try { await dom({ kind: 'assertCapacityTerminalSuffix', nodeId: a.id, blocks }); return true; }
      catch (error) { if (!/Capacity suffix pending/.test(String(error))) throw error; return false; }
    }, Boolean, Math.max(0, stageDeadline - performance.now()));
    stage.catchupAfterReceiptMs = performance.now() - catchupStarted;
    const current = await checkpoint(a, previousCheckpoint);
    previousCheckpoint = current.checkpointRevision;
    const repeated = await checkpoint(a, previousCheckpoint);
    assert.equal(repeated.checkpointRevision, previousCheckpoint, 'The stable oversized/color state must not advance its checkpoint.');
    assert(current.revision > current.checkpointRevision, 'Actual journal head must remain beyond the checkpoint.');
    stage.actualSupervisor = { ...current, repeated,
      rejectionReason: 'Not exposed by the existing Supervisor RPC; independently validated after resource measurement.' };
    const afterProbe = await probe();
    const afterRead = afterProbe.capacityCalibration.readers.find(reader => reader.nodeId === a.id);
    assert(beforeRead && afterRead);
    stage.reader = { before: beforeRead, after: afterRead, sameReader: beforeRead.readId === afterRead.readId,
      classification: blocks === 1280 ? (beforeRead.readId === afterRead.readId ? 'surface-hide-restore-retained-reader'
        : 'surface-hide-restore-new-reader') : 'visible-output' };
    stage.receipt = receipt;
    if (blocks === 1280) stage.catchupOverlapObserved = stage.sourceReceiptBeforeRestore.blocks === blocks &&
      stage.interactions.some(sample => sample.loadNotAtTargetBeforeInput);
    stage.finishedMs = performance.now() - started;
    await archive(`stage-${blocks}`, stage);
  }
  phase = 'final-idle';
  await sleep(1000);
  check();
  await stopSampling();
  const budgetObservation = observeBudgets();
  await archive('budget-observation', budgetObservation);
  const measurementEndedMs = performance.now() - started;
  phase = 'independent-journal-validation-not-measured';
  const validation = await verifyJournal(a, stages.at(-1).receipt);
  await archive('independent-journal-validation', { measurementEndedMs, ...validation });
  assert.equal(validation.rejectionReason, scenario === 'color' ? 'color-state' : 'serialized-state-too-large');
  await finishSubjects();
  await archive('calibration-result', { measurementAndContentPass: true, cleanupResult: 'See the separate cleanup.json result.',
    scenario, sessionCount: workload.sessionCount, stages, interactions, validation, budgetObservation,
    measurementEndedMs, scope: 'A1 fixed Terminal workload only. Does not close F-04, offline recovery, real Agent load or another platform.' });
  assert.equal(budgetObservation.pass, true, `Workload observation exceeded its predeclared budget: ${JSON.stringify(budgetObservation)}`);
}

async function openSurface() {
  check();
  await vscode.commands.executeCommand('devSessionCanvas.openCanvasInPanel');
  await command('waitForCanvasReady', surface, 20000);
}

function surfaceState(state) {
  return { lifecycle: state.surfaceLifecycle, mode: state.surfaceMode, ready: state.surfaceReady,
    canvasSurface: state.sidebar?.canvasSurface };
}

async function createSubject(role) {
  phase = `start-${role}`;
  await command('createNode', 'terminal');
  const pending = await poll(`${role} Terminal node created`, snapshot, value => {
    const node = value.state.nodes.find(candidate => candidate.kind === 'terminal' &&
      !subjects.some(subject => subject.id === candidate.id));
    return node ?? false;
  });
  const pendingNode = pending.state.nodes.find(candidate => candidate.kind === 'terminal' &&
    !subjects.some(subject => subject.id === candidate.id));
  // The embedded terminal waits for its first concrete size before acquiring a runtime.
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: pendingNode.id, position: pendingNode.position, size: { width: 900, height: 540 } } }, surface);
  const state = await poll(`real ${role} Terminal started sequentially`, snapshot,
    value => value.state.nodes.filter(node => node.kind === 'terminal' && node.metadata?.terminal?.liveSession).length === subjects.length + 1);
  const node = state.state.nodes.find(candidate => candidate.kind === 'terminal' && !subjects.some(subject => subject.id === candidate.id));
  assert(node);
  const metadata = node.metadata.terminal;
  assert.equal(metadata.persistenceMode, 'live-runtime');
  assert.match(metadata.runtimeStoragePath, new RegExp(expectedExecutionCandidateGeneration()));
  const ownedUserData = path.resolve(artifacts, '..', 'user-data');
  assert(path.resolve(metadata.runtimeStoragePath).startsWith(`${ownedUserData}${path.sep}`),
    'Only the isolated smoke workspace storage may be used.');
  const paths = metadata.runtimeBackend === 'systemd-user' ? resolveSystemdUserRuntimeSupervisorPaths(metadata.runtimeStoragePath)
    : resolveLegacyRuntimeSupervisorPaths(metadata.runtimeStoragePath);
  const hello = await rpc(paths.socketPath, 'hello');
  assert(hello.capabilities?.executionCandidateProfiles?.includes('linux-owner-v1-candidate'));
  const supervisorIdentity = await identity(hello.pid);
  assert(supervisorIdentity);
  if (supervisor) assert.equal(supervisor.pid, hello.pid, 'This case calibrates one shared Supervisor.');
  else supervisor = { ...supervisorIdentity, socketPath: paths.socketPath };
  const subject = { id: node.id, role, paths, metadata, receiptPath: path.join(artifacts, `subject-${role}.json`) };
  subjects.push(subject);
  const mounted = await poll('fixed actual terminal dimensions', probe, value => value.nodes.some(entry =>
    entry.nodeId === node.id && entry.terminalCols >= 78 && entry.terminalRows >= 3) &&
    value.capacityCalibration?.readers.some(reader => reader.nodeId === node.id));
  subject.reader = mounted.capacityCalibration.readers.find(reader => reader.nodeId === node.id);
  const fixture = path.join(__dirname, 'fixtures/execution-capacity-subject.cjs');
  const offlineInput = capacityPhase === 'detach' && role === 'a'
    ? ` ${quote(path.join(artifacts, 'offline-trigger.json'))}` : '';
  await dom({ kind: 'sendExecutionInput', nodeId: node.id,
    data: `stty -echo -onlcr; exec ${quote(process.env.DEV_SESSION_CANVAS_CAPACITY_SUBJECT_NODE)} ${quote(fixture)} ${role === 'a' ? 'a' : 'b'} ${scenario} ${quote(subject.receiptPath)}${offlineInput}\r` });
  const receipt = await poll('real raw PTY subject ready', () => readReceipt(subject), value => value.state === 'ready');
  const subjectIdentity = await identity(receipt.pid);
  assert(subjectIdentity);
  let ancestor = subjectIdentity;
  while (ancestor && ancestor.pid !== supervisor.pid && ancestor.ppid > 1) ancestor = await identity(ancestor.ppid);
  assert.equal(ancestor?.pid, supervisor.pid, 'The receipt PID must belong to the confirmed run-owned Supervisor.');
  subject.identity = subjectIdentity;
  await archive(`started-${role}`, { id: node.id, metadata, paths, hello, reader: subject.reader, identity: subject.identity });
  return subject;
}

async function readReceipt(subject) {
  try { return JSON.parse(await fs.readFile(subject.receiptPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

function assertReceipt(receipt, blocks) {
  const digest = createHash('sha256');
  const initial = format.sourcePrefix(receipt.nonce, scenario);
  digest.update(initial);
  for (let index = 1; index <= blocks; index += 1) digest.update(format.block(index));
  assert.equal(receipt.bytesWritten, Buffer.byteLength(initial) + blocks * 10240);
  assert.equal(receipt.sha256, digest.digest('hex'));
}

async function checkpoint(subject, previousRevision) {
  const result = await rpc(subject.paths.socketPath, 'getSessionCheckpoint', {
    sessionId: subject.metadata.runtimeSessionId, authorityId: subject.reader.authorityId,
    afterCheckpointRevision: previousRevision });
  assert.equal(result.sessionId, subject.metadata.runtimeSessionId);
  assert.equal(result.authorityId, subject.reader.authorityId);
  return { revision: result.revision, checkpointRevision: result.checkpoint?.revision ?? previousRevision,
    returnedCheckpointBytes: result.checkpoint ? Buffer.byteLength(result.checkpoint.serializedState.data) : 0,
    ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}) };
}

function rpc(socketPath, method, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    const finish = (error, value) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error(`Bound Supervisor ${method} timed out.`)), 10000);
    socket.once('error', error => finish(error));
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'request', id: 'a1-capacity', method, params })}\n`));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 2 * 1024 * 1024) return finish(new Error('Unexpected checkpoint RPC response size.'));
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(data.slice(0, end));
        assert(response.ok && response.id === 'a1-capacity', JSON.stringify(response.error));
        finish(undefined, response.result);
      } catch (error) { finish(error); }
    });
  });
}

async function verifyJournal(subject, receipt) {
  const directory = resolveTerminalJournalSessionDirectory(subject.paths.storageDir, subject.metadata.runtimeSessionId);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sessionId, subject.metadata.runtimeSessionId);
  assert.equal(manifest.authorityId, subject.reader.authorityId);
  assert.equal(manifest.retainedStartRevision ?? 1, 1, 'Fixed rejected-checkpoint input must retain the original source.');
  const tracker = new SerializedTerminalStateTracker(manifest.initialCols, manifest.initialRows,
    { scrollback: manifest.initialScrollback });
  const marker = Buffer.from(format.sourcePrefix(receipt.nonce, scenario) + format.row(1) + '\r\n');
  const digest = createHash('sha256');
  let carry = Buffer.alloc(0);
  let found = false;
  let bytes = 0;
  let revision = 0;
  let ptyLineEndingCarry = Buffer.alloc(0);
  const normalizePtyChunk = (chunk) => {
    const input = Buffer.concat([ptyLineEndingCarry, chunk]);
    let end = input.length;
    while (end > 0 && input[end - 1] === 0x0d) end -= 1;
    ptyLineEndingCarry = input.subarray(end);
    const output = [];
    for (let index = 0; index < end;) {
      if (input[index] !== 0x0d) {
        output.push(input[index]);
        index += 1;
        continue;
      }
      let runEnd = index + 1;
      while (runEnd < end && input[runEnd] === 0x0d) runEnd += 1;
      if (runEnd < end && input[runEnd] === 0x0a) {
        output.push(0x0d, 0x0a);
        index = runEnd + 1;
      } else {
        for (; index < runEnd; index += 1) output.push(0x0d);
      }
    }
    return Buffer.from(output);
  };
  try {
    for (const segment of manifest.segments) {
      assert.match(segment.file, /^segment-\d{16}\.ndjson$/);
      let segmentBytes = 0;
      const input = createReadStream(path.join(directory, segment.file), { highWaterMark: 65536 });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          check();
          segmentBytes += Buffer.byteLength(line) + 1;
          const event = JSON.parse(line);
          assert.equal(event.revision, revision + 1);
          assert.equal(event.sessionId, manifest.sessionId);
          assert.equal(event.authorityId, manifest.authorityId);
          revision = event.revision;
          if (event.type === 'output') {
            // PTY line discipline can duplicate CR before LF; receipts contain the
            // child bytes before that transport normalization.
            let data = normalizePtyChunk(Buffer.from(event.data));
            if (!found) {
              const search = Buffer.concat([carry, data]);
              const index = search.indexOf(marker);
              if (index < 0) { carry = search.subarray(Math.max(0, search.length - marker.length + 1)); data = Buffer.alloc(0); }
              else { found = true; data = search.subarray(index); carry = Buffer.alloc(0); }
            }
            if (found && bytes < receipt.bytesWritten) {
              const accepted = data.subarray(0, receipt.bytesWritten - bytes);
              digest.update(accepted);
              bytes += accepted.length;
            }
            tracker.write(event.data, { outputSequence: revision });
          } else if (event.type === 'resize') tracker.resize(event.cols, event.rows, { outputSequence: revision });
          else if (event.type === 'scrollback') await tracker.setScrollback(event.scrollback, { outputSequence: revision });
          else throw new Error(`Unexpected journal event ${event.type}`);
          await tracker.drain();
        }
      } finally { lines.close(); input.destroy(); }
      assert.equal(segmentBytes, segment.bytes);
    }
    assert(found, 'Actual successful-source marker must be in the retained journal.');
    assert.equal(revision, manifest.lastRevision);
    assert.equal(bytes, receipt.bytesWritten);
    const sha256 = digest.digest('hex');
    assert.equal(sha256, receipt.sha256);
    const result = await tracker.flushValidatedCheckpoint();
    assert.equal(result.eligible, false, 'Independent actual tracker must reject this fixed checkpoint input.');
    return { scope: 'Post-measurement independent replay of the actual journal with the production tracker/validator; not Supervisor self-report.',
      sourceBytes: bytes, sourceSha256: sha256, lastRevision: revision, initialCols: manifest.initialCols,
      initialRows: manifest.initialRows, initialScrollback: manifest.initialScrollback,
      rejectionReason: result.reason, productionJournalChecksumValidation: 'Not replaced by this source-content comparison.' };
  } finally { tracker.dispose(); }
}

async function identity(pid) {
  try {
    const text = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return { pid, ppid: Number(fields[1]), state: fields[0], startTicks: fields[19],
      executable: await fs.readlink(`/proc/${pid}/exe`).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      }) };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return undefined; throw error; }
}

async function vscodeRoot() {
  let current = await identity(process.pid);
  let candidate = current;
  while (current?.ppid > 1) {
    current = await identity(current.ppid);
    if (current?.executable === candidate.executable) candidate = current;
  }
  assert(candidate.pid !== process.pid, 'Require a confirmed separate VS Code ancestor.');
  return candidate;
}

async function processSamples() {
  const queue = [process.pid, root.pid, ...(supervisor ? [supervisor.pid] : []),
    ...subjects.flatMap(subject => subject.identity ? [subject.identity.pid] : [])];
  const visited = new Set();
  const rss = {};
  while (queue.length) {
    const pid = queue.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);
    const current = await identity(pid);
    if (!current) continue;
    if (pid === root.pid) assert.equal(current.startTicks, root.startTicks);
    if (pid === supervisor?.pid) assert.equal(current.startTicks, supervisor.startTicks);
    const expectedSubject = subjects.find(entry => entry.identity?.pid === pid);
    if (expectedSubject && current.startTicks !== expectedSubject.identity.startTicks) continue;
    const children = await fs.readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => '');
    queue.push(...children.trim().split(/\s+/).filter(Boolean).map(Number));
    const argv = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
    const subject = subjects.find(entry => entry.identity?.pid === pid && entry.identity.startTicks === current.startTicks);
    const role = pid === process.pid ? 'host' : pid === supervisor?.pid ? 'supervisor'
      : subject ? `subject-${subject.role}`
      : argv.some(arg => arg.endsWith('/dist/linux-execution-provider.js')) ? 'provider'
      : argv.some(arg => arg === '--type=renderer' || arg.startsWith('--type=renderer')) ? 'renderer-group'
      // Electron 39 may omit the renderer type switch from /proc/cmdline;
      // retain its same-executable utility/renderer descendants as one group.
      : current.executable === process.execPath ? 'renderer-group' : undefined;
    if (!role) continue;
    let statusReadError;
    const status = await fs.readFile(`/proc/${pid}/status`, 'utf8').catch(error => {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
      statusReadError = { code: error.code, message: error.message };
      return '';
    });
    const match = /^VmRSS:\s+(\d+) kB$/m.exec(status);
    if (!match) {
      const latest = await identity(pid);
      const classification = !latest ? 'gone-before-rss'
        : latest.startTicks !== current.startTicks || latest.executable !== current.executable ? 'identity-changed-before-rss'
        : ['Z', 'X'].includes(latest.state) ? 'exited-before-rss' : 'rss-unavailable-still-live';
      resourceObservations.push({ ms: performance.now() - started, phase, pid, role,
        classification, before: current, after: latest ?? null, statusReadError });
      if (classification !== 'rss-unavailable-still-live') continue;
      throw new Error(`RSS unavailable for confirmed live ${role} PID ${pid}${statusReadError ? ` (${statusReadError.code})` : ''}.`);
    }
    rss[role] = (rss[role] ?? 0) + Number(match[1]) * 1024;
    const key = `${pid}:${current.startTicks}`;
    processes.set(key, { ...current, role, firstSeenMs: processes.get(key)?.firstSeenMs ?? performance.now() - started,
      lastSeenMs: performance.now() - started });
  }
  assert(rss.host > 0, 'Require actual Host RSS.');
  // Some packaged Electron builds hide renderer descendants from this test
  // process tree; retain an absent observation rather than
  // manufacturing renderer RSS or blocking all other measurements.
  return rss;
}

function startSampling() {
  const tick = async () => {
    const tickStarted = performance.now();
    try {
      const rss = await processSamples();
      const host = process.memoryUsage();
      const sumRss = Object.values(rss).reduce((sum, value) => sum + value, 0);
      if (scenario !== 'compact') await command('clearHostMessages');
      // Keep the bounded output interaction trace intact for failure attribution;
      // idle/start phases can still clear the diagnostic ring to limit noise.
      if (scenario !== 'compact' && !phase.startsWith('output-')) await command('clearDiagnosticEvents');
      // Hidden surfaces cannot service a probe; never label stale values as current.
      const webview = hidden ? undefined : await probe();
      samples.push({ ms: tickStarted - started, phase, rss, sumRss, host,
        browserReportedHeapUsed: webview?.capacityCalibration?.browserReportedHeapUsed,
        sampleDurationMs: performance.now() - tickStarted });
      assert(samples.length <= 2401, 'Finite case sample bound.');
      if (capacityPhase && sumRss > 5 * 1024 ** 3) {
        throw new Error('Actual sampled total RSS exceeded the 5 GiB reconnect experiment safety bound (not a product memory budget).');
      }
      if (!capacityPhase && baselineRss !== undefined && sumRss - baselineRss > workload.rssGrowthSafetyBytes) {
        throw new Error(`Actual sampled RSS growth exceeded the ${workload.rssGrowthSafetyBytes} byte experiment safety bound (not a product memory budget).`);
      }
    } catch (error) { aborted ??= error; }
    if (!stopped && !aborted) samplerTimer = setTimeout(() => { sampler = tick(); }, Math.max(0, 250 - (performance.now() - tickStarted)));
  };
  sampler = tick();
}

async function stopSampling() { stopped = true; clearTimeout(samplerTimer); await sampler; }

async function idle(count) {
  phase = `idle-${count}`;
  await sleep(5000);
  check();
  const selected = samples.filter(sample => sample.phase === phase);
  assert(selected.length > 0);
  baselines.push({ liveSessions: count, sampleCount: selected.length,
    meanSumRss: selected.reduce((sum, sample) => sum + sample.sumRss, 0) / selected.length,
    resources: summarize(selected)[phase] });
}

function summarize(values) {
  const result = {};
  for (const sample of values) {
    const entry = result[sample.phase] ??= { sampleCount: 0, peakSumRss: 0, peakHostHeapUsed: 0, peakRss: {} };
    entry.sampleCount += 1;
    entry.peakSumRss = Math.max(entry.peakSumRss, sample.sumRss);
    entry.peakHostHeapUsed = Math.max(entry.peakHostHeapUsed, sample.host.heapUsed);
    for (const [role, value] of Object.entries(sample.rss)) entry.peakRss[role] = Math.max(entry.peakRss[role] ?? 0, value);
  }
  return result;
}

function observeBudgets() {
  const peaks = { supervisorRss: 0, hostRss: 0, rendererGroupRss: 0, providersRss: 0,
    subjectsRss: 0, totalRss: 0, hostHeapUsed: 0 };
  for (const sample of samples) {
    const current = { supervisorRss: sample.rss.supervisor ?? 0, hostRss: sample.rss.host,
      rendererGroupRss: sample.rss['renderer-group'] ?? 0, providersRss: sample.rss.provider ?? 0,
      subjectsRss: Object.entries(sample.rss).filter(([role]) => role.startsWith('subject-'))
        .reduce((sum, [, value]) => sum + value, 0), totalRss: sample.sumRss, hostHeapUsed: sample.host.heapUsed };
    for (const [key, value] of Object.entries(current)) peaks[key] = Math.max(peaks[key], value);
  }
  const failures = Object.entries(workload.observationBudgets ?? {}).filter(([key, limit]) => peaks[key] > limit)
    .map(([key, limit]) => ({ metric: key, limit, observed: peaks[key] }));
  if (workload.sessionCount === 10 && (!peaks.rendererGroupRss || !peaks.supervisorRss || !peaks.providersRss ||
    !samples.some(sample => Object.keys(sample.rss).filter(role => role.startsWith('subject-')).length === 10))) {
    failures.push({ metric: 'required-process-observations', error: 'Ten subjects and all measured roles must be observed, not assumed zero.' });
  }
  return { scope: 'Predeclared workload-specific observation budgets; not a general product SLA.',
    sessionCount: workload.sessionCount, limits: workload.observationBudgets ?? null, peaks, failures, pass: failures.length === 0 };
}

async function cleanup() {
  const results = [];
  let resetTimer;
  try {
    await Promise.race([rawCommand('resetState'), new Promise((_, reject) => {
      resetTimer = setTimeout(() => reject(new Error('Product cleanup exceeded 30 seconds.')), 30000);
    })]);
    results.push({ action: 'product-reset', pass: true });
  }
  catch (error) { results.push({ action: 'product-reset', error: String(error) }); }
  finally { clearTimeout(resetTimer); }
  const ownedByIdentity = new Map([...processes.values()]
    .filter(entry => entry.role.startsWith('subject-') || entry.role === 'provider')
    .map(entry => [`${entry.pid}:${entry.startTicks}`, entry]));
  for (const subject of subjects) {
    if (subject.identity) ownedByIdentity.set(`${subject.identity.pid}:${subject.identity.startTicks}`, subject.identity);
  }
  const owned = [...ownedByIdentity.values()];
  const settleDeadline = performance.now() + 5000;
  while (performance.now() < settleDeadline) {
    let live = false;
    for (const entry of owned) {
      const current = await identity(entry.pid);
      live ||= current?.startTicks === entry.startTicks && !['Z', 'X'].includes(current.state);
    }
    if (!live) break;
    await sleep(50);
  }
  for (const entry of owned) {
    const current = await identity(entry.pid);
    if (!current || current.startTicks !== entry.startTicks || ['Z', 'X'].includes(current.state)) continue;
    if (current.executable !== entry.executable) { results.push({ pid: entry.pid, action: 'changed-identity-no-signal' }); continue; }
    try {
      process.kill(entry.pid, 'SIGKILL');
      const deadline = performance.now() + 5000;
      let remaining;
      do {
        remaining = await identity(entry.pid);
        if (!remaining || remaining.startTicks !== entry.startTicks || ['Z', 'X'].includes(remaining.state)) break;
        await sleep(50);
      } while (performance.now() < deadline);
      if (remaining?.startTicks === entry.startTicks && !['Z', 'X'].includes(remaining.state)) {
        results.push({ pid: entry.pid, action: 'owned-live-resource-fallback-kill', error: 'Owned process remained live after SIGKILL.' });
      } else results.push({ pid: entry.pid, action: 'owned-live-resource-fallback-kill', stopped: true });
    }
    catch (error) { if (error.code !== 'ESRCH') results.push({ pid: entry.pid, error: String(error) }); }
  }
  if (supervisor) {
    const current = await identity(supervisor.pid);
    if (current?.startTicks === supervisor.startTicks && current.executable === supervisor.executable) {
      try {
        const state = await rawCommand('getRuntimeSupervisorState');
        assert.equal(state.bindings.length, 0, 'Do not terminate a Supervisor with remaining product bindings.');
        const hello = await rpc(supervisor.socketPath, 'hello');
        assert.equal(hello.pid, supervisor.pid);
        process.kill(supervisor.pid, 'SIGTERM');
        results.push({ pid: supervisor.pid, action: 'owned-isolated-idle-supervisor-SIGTERM' });
        const deadline = performance.now() + 5000;
        let remaining;
        do {
          remaining = await identity(supervisor.pid);
          if (!remaining || remaining.startTicks !== supervisor.startTicks || ['Z', 'X'].includes(remaining.state)) break;
          await sleep(50);
        } while (performance.now() < deadline);
        if (remaining?.startTicks === supervisor.startTicks && !['Z', 'X'].includes(remaining.state)) {
          if (remaining.executable === supervisor.executable) process.kill(supervisor.pid, 'SIGKILL');
          results.push({ pid: supervisor.pid, action: 'owned-supervisor-fallback', error: 'Supervisor did not stop after SIGTERM.' });
        } else results.push({ pid: supervisor.pid, action: 'owned-supervisor-stopped', pass: true });
      } catch (error) { results.push({ pid: supervisor.pid, action: 'supervisor-not-signalled', error: String(error) }); }
    }
  }
  const pass = results.every(result => !result.error && result.action !== 'owned-live-resource-fallback-kill' &&
    result.action !== 'changed-identity-no-signal');
  await archive('cleanup', { pass, results,
    scope: 'Only confirmed run-owned identities; VS Code lifecycle remains owned by the original runner.' });
  if (!aborted && !pass) throw new Error('A1 cleanup did not finish through the product path; evidence retained.');
}
