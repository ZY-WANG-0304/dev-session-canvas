import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';
import { SourceCompletionModel } from './runtime-exit-contract-model.mjs';

// Controlled provider ordering, not evidence that an OS naturally emits late data.
const filename = path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
const source = await readFile(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const mainCalls = ast.statements.filter(node => ts.isExpressionStatement(node) && node.getText(ast).startsWith('void main()'));
assert.equal(mainCalls.length, 1);
const contents = source.slice(0, mainCalls[0].pos) + source.slice(mainCalls[0].end) +
  '\nexport { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker };';
const bundle = await esbuild.build({ stdin: { contents, resolveDir: path.dirname(filename), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty'] });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker } = module.exports;
const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-exit-admission-'));
const results = [];
let sequence = 0;
try {
  for (const kind of ['terminal', 'agent']) {
    for (const ordering of ['data-before-exit', 'exit-before-sync-data', 'exit-before-async-data']) {
      results.push(await verifyOrdering(kind, ordering));
    }
    results.push(await verifyStop(kind));
    if (kind === 'agent') results.push(await verifyStop(kind, 'claude'));
    results.push(await verifyDelete(kind));
    for (const ordering of ['process-tail-source', 'source-before-process', 'stop-process-tail-source']) {
      results.push(await verifySourceContract(kind, ordering));
    }
  }
  console.log(JSON.stringify({
    diagnostic: 'provider-exit-admission-contract',
    evidenceScope: 'Injected event ordering against the actual Supervisor; no platform reachability claim.',
    platform: process.platform,
    node: process.version,
    uv: process.versions.uv,
    supervisorSha256: createHash('sha256').update(source).digest('hex'),
    contractModelSha256: createHash('sha256').update(await readFile(
      new URL('./runtime-exit-contract-model.mjs', import.meta.url))).digest('hex'),
    results
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function fixture(kind, provider = 'codex', useSourceContract = false) {
  const sessionId = `admission-${++sequence}`;
  const storageDir = path.join(directory, sessionId);
  const tracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 100, initialOutputSequence: 0 });
  const journal = await TerminalSessionJournal.create({ storageDir, sessionId,
    initialCols: 80, initialRows: 24, initialScrollback: 100,
    checkpointProfiles: { 'xterm-serialize-v1': 'diagnostic' } });
  const server = new RuntimeSupervisorServer({ storageDir, registryPath: path.join(storageDir, 'registry.json') },
    'legacy-detached', 'best-effort');
  server.schedulePersist = () => {};
  server.scheduleIdleShutdownIfNeeded = () => {};
  const dataListeners = new Set();
  const exitListeners = new Set();
  const emitData = chunk => { for (const listener of [...dataListeners]) listener(chunk); };
  const emitExit = result => { for (const listener of [...exitListeners]) listener(result); };
  const contract = useSourceContract ? new SourceCompletionModel({
    onData: emitData, onFinal: result => emitExit(result.process)
  }) : undefined;
  const process = {
    backend: 'node-pty', pid: 0, processName: 'injected-provider', kills: 0, writes: [],
    onData(listener) { dataListeners.add(listener); return { dispose: () => dataListeners.delete(listener) }; },
    onExit(listener) { exitListeners.add(listener); return { dispose: () => exitListeners.delete(listener) }; },
    write(data) { this.writes.push(data); }, resize() {}, kill() { this.kills++; }
  };
  const session = { sessionId, kind, live: true, lifecycle: kind === 'agent' ? 'running' : 'live',
    output: '', outputSequence: 0, shellPath: 'injected-provider', cwd: directory, displayLabel: 'Admission diagnostic',
    launchMode: 'start', provider: kind === 'agent' ? provider : undefined,
    stopRequested: false, cols: 80, rows: 24, scrollback: 100,
    runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
    terminalAuthorityId: journal.getAuthorityId(), terminalJournal: journal, terminalStateTracker: tracker,
    terminalOperationChain: Promise.resolve(), terminalMutationAdmissionOpen: true, process,
    terminalCheckpoint: { version: 1, sessionId, authorityId: journal.getAuthorityId(), revision: 0,
      cols: 80, rows: 24, scrollback: 100, createdAtMs: 1, serializedState: tracker.getSerializedState() } };
  server.sessions.set(sessionId, session);
  const socket = { destroyed: false, messages: [], write(line) { this.messages.push(JSON.parse(line)); } };
  server.connections.add(socket);
  server.subscriptions.set(socket, new Map([[sessionId, 'terminal-stream-v1']]));
  server.bindSessionProcess(session);
  const trace = [];
  return { server, session, process, journal, tracker, socket, trace, contract,
    data(chunk) {
      trace.push({ event: 'data', chunk, listenerCount: dataListeners.size,
        admissionOpen: session.terminalMutationAdmissionOpen });
      if (contract) contract.data(chunk);
      else emitData(chunk);
    },
    exit(exitCode = 0) {
      trace.push({ event: 'exit', listenerCount: exitListeners.size });
      if (contract) contract.processExit({ exitCode });
      else emitExit({ exitCode });
    },
    sourceEnd() {
      assert(contract);
      trace.push({ event: 'source-end', kind: 'eof' });
      contract.sourceEnd({ kind: 'eof' });
    },
    async cleanup() {
      if (server.sessions.has(sessionId)) await server.deleteSession({ sessionId });
    }
  };
}

function gate(f) {
  let release;
  f.session.terminalOperationChain = new Promise(resolve => { release = resolve; });
  return release;
}

function finalOutput(f) {
  const finals = f.socket.messages.filter(message => message.event === 'sessionState' && message.payload.live === false);
  assert.equal(finals.length, 1, 'exactly one final snapshot');
  assert.equal(finals[0].payload.terminalRevision, f.session.outputSequence);
  return finals[0].payload.terminalStream.events.filter(event => event.type === 'output').map(event => event.data).join('');
}

async function verifyOrdering(kind, ordering) {
  const f = await fixture(kind);
  const release = gate(f);
  try {
    f.data('BEFORE\r\n');
    if (ordering === 'data-before-exit') f.data('TAIL\r\n');
    assert.equal(f.journal.getRevision(), 0, 'operations are queued behind the gate');
    f.exit();
    assert.equal(f.session.terminalMutationAdmissionOpen, false);
    if (ordering === 'exit-before-sync-data') f.data('TAIL\r\n');
    if (ordering === 'exit-before-async-data') {
      await new Promise(resolve => setImmediate(resolve));
      f.data('TAIL\r\n');
    }
    if (ordering !== 'data-before-exit') {
      assert.equal(f.trace.at(-1).listenerCount, 1, 'late callback reaches the still-subscribed admission guard');
    }
    release();
    await f.session.finalizationPromise;
    await f.session.terminalOperationChain;
    assert.equal(f.session.terminalJournalError, undefined);
    const expected = ordering === 'data-before-exit' ? 'BEFORE\r\nTAIL\r\n' : 'BEFORE\r\n';
    const output = finalOutput(f);
    assert.equal(output, expected, 'characterize the current provider boundary, not desired producer completeness');
    const revision = f.journal.getRevision();
    f.data('AFTER-FINAL\r\n');
    assert.equal(f.trace.at(-1).listenerCount, 0, 'finalization removes the data listener');
    assert.equal(f.journal.getRevision(), revision);
    return { kind, ordering, acceptedOutput: output, finalRevision: revision, trace: f.trace };
  } finally {
    release();
    await f.cleanup();
  }
}

async function verifyStop(kind, provider = 'codex') {
  const f = await fixture(kind, provider);
  const release = gate(f);
  try {
    f.data('BEFORE\r\n');
    f.server.stopSession({ sessionId: f.session.sessionId });
    assert.equal(f.session.terminalMutationAdmissionOpen, true, 'stop alone does not end output admission');
    f.data('AFTER-STOP\r\n');
    f.exit();
    release();
    await f.session.finalizationPromise;
    await f.session.terminalOperationChain;
    assert.equal(f.session.terminalJournalError, undefined);
    const output = finalOutput(f);
    assert.equal(output, 'BEFORE\r\nAFTER-STOP\r\n');
    assert.equal(f.process.kills, kind === 'terminal' || provider === 'claude' ? 1 : 0);
    assert.equal(f.process.writes.length, kind === 'agent' && provider === 'codex' ? 1 : 0);
    return { kind, provider: kind === 'agent' ? provider : undefined, ordering: 'stop-then-data-then-exit',
      acceptedOutput: output, killRequests: f.process.kills, inputRequests: f.process.writes.length,
      trace: f.trace };
  } finally {
    release();
    await f.cleanup();
  }
}

async function verifyDelete(kind) {
  const f = await fixture(kind);
  const release = gate(f);
  try {
    f.data('BEFORE\r\n');
    const deletion = f.server.deleteSession({ sessionId: f.session.sessionId });
    assert.equal(f.session.terminalMutationAdmissionOpen, false);
    f.data('AFTER-DELETE\r\n');
    assert.equal(f.trace.at(-1).listenerCount, 0, 'explicit deletion deliberately unsubscribes immediately');
    release();
    await deletion;
    assert.equal(f.session.terminalJournalError, undefined);
    const output = finalOutput(f);
    assert.equal(output, 'BEFORE\r\n', 'explicit cancellation still flushes previously accepted mutations');
    assert.equal(f.server.sessions.has(f.session.sessionId), false);
    assert.equal(f.process.kills, 1);
    return { kind, ordering: 'explicit-delete', acceptedOutput: output,
      interpretation: 'Intentional cancellation, not a natural-exit drain failure.', trace: f.trace };
  } finally {
    release();
    await f.cleanup();
  }
}

async function verifySourceContract(kind, ordering) {
  const f = await fixture(kind, 'codex', true);
  const release = gate(f);
  try {
    f.data('BEFORE\r\n');
    if (ordering.startsWith('stop-')) f.server.stopSession({ sessionId: f.session.sessionId });
    if (ordering === 'source-before-process') {
      f.data('TAIL\r\n');
      f.sourceEnd();
      assert.equal(f.session.finalizationPromise, undefined, 'source end cannot invent a process result');
      f.exit(7);
    } else {
      f.exit(7);
      assert.equal(f.session.terminalMutationAdmissionOpen, true, 'process result is not source completion');
      await new Promise(resolve => setImmediate(resolve));
      f.data('TAIL\r\n');
      assert.equal(f.session.finalizationPromise, undefined);
      f.sourceEnd();
    }
    assert.equal(f.session.terminalMutationAdmissionOpen, false);
    assert.equal(f.journal.getRevision(), 0, 'accepted operations remain behind the gate');
    release();
    await f.session.finalizationPromise;
    await f.session.terminalOperationChain;
    assert.equal(f.session.terminalJournalError, undefined);
    assert.equal(finalOutput(f), 'BEFORE\r\nTAIL\r\n');
    assert.equal(f.session.lastExitCode, 7, 'do not replace nonzero results with successful exits');
    assert.equal(f.contract.final.source.kind, 'eof');
    assert.throws(() => f.contract.data('AFTER-SOURCE'), /data after source end/);
    return { kind, ordering, candidate: 'injected-source-completion-model', exitCode: 7,
      acceptedOutput: finalOutput(f), finalRevision: f.journal.getRevision(), trace: f.trace,
      scope: 'Actual Supervisor with a model adapter; not native source proof or a production integration.' };
  } finally {
    release();
    await f.cleanup();
  }
}
