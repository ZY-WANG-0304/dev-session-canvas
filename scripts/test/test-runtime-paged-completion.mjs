import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

const filename = path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
const source = await readFile(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const mainCalls = ast.statements.filter(node => ts.isExpressionStatement(node) && node.getText(ast).startsWith('void main()'));
assert.equal(mainCalls.length, 1);
const contents = source.slice(0, mainCalls[0].pos) + source.slice(mainCalls[0].end) +
  '\nexport { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker, resolveTerminalJournalSessionDirectory };';
const bundle = await esbuild.build({ stdin: { contents, resolveDir: path.dirname(filename), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty'] });
const module = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker,
  resolveTerminalJournalSessionDirectory } = module.exports;
const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-paged-completion-'));
let sequence = 0;
try {
  for (const kind of ['terminal', 'agent']) {
    for (const disconnect of [false, true]) await verifyReaders(kind, disconnect);
    await verifyNoReaders(kind);
  }
  await verifyMixedSubscribers();
  await verifyForcedDelete();
  await verifyLegacyRecordWithoutJournal();
  console.log('runtime paged completion: no full aggregation, late first page, two sockets, retirement, disk cleanup and legacy compatibility passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function fixture(kind, modes = ['terminal-stream-paged-completion', 'terminal-stream-paged-completion']) {
  const sessionId = `completion-${++sequence}`;
  const storageDir = path.join(directory, sessionId);
  const tracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 100, initialOutputSequence: 0 });
  const journal = await TerminalSessionJournal.create({ storageDir, sessionId,
    initialCols: 80, initialRows: 24, initialScrollback: 100,
    checkpointProfiles: { 'xterm-serialize-v1': 'test' } });
  const server = new RuntimeSupervisorServer({ storageDir, registryPath: path.join(storageDir, 'registry.json') },
    'legacy-detached', 'best-effort');
  server.schedulePersist = () => {};
  server.scheduleIdleShutdownIfNeeded = () => {};
  const session = { sessionId, kind, live: true, lifecycle: kind === 'agent' ? 'running' : 'live',
    output: '', outputSequence: 0, shellPath: '/bin/sh', cwd: '/project', displayLabel: 'Completion fixture',
    launchMode: 'start', stopRequested: false, cols: 80, rows: 24, scrollback: 100,
    runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
    terminalAuthorityId: journal.getAuthorityId(), terminalJournal: journal, terminalStateTracker: tracker,
    terminalOperationChain: Promise.resolve(), terminalMutationAdmissionOpen: true,
    terminalCheckpoint: { version: 1, sessionId, authorityId: journal.getAuthorityId(), revision: 0,
      cols: 80, rows: 24, scrollback: 100, createdAtMs: 1, serializedState: tracker.getSerializedState() } };
  server.sessions.set(sessionId, session);
  const sockets = modes.map(mode => {
    const socket = { destroyed: false, messages: [], write(line) { this.messages.push(JSON.parse(line)); } };
    server.connections.add(socket);
    server.subscriptions.set(socket, new Map([[sessionId, mode]]));
    server.terminalReads.set(socket, new Map());
    return socket;
  });
  const fullProjection = server.buildTerminalStreamAttachPayload.bind(server);
  server.buildTerminalStreamAttachPayload = () => assert.fail('New completion path must never aggregate full journal');
  return { server, session, tracker, journal, sockets, storageDir, fullProjection,
    identity: { sessionId, authorityId: journal.getAuthorityId() } };
}

function appendOutput(f, count = 300) {
  const chunks = [];
  for (let index = 0; index < count; index++) {
    const chunk = `ROW ${index} ${'x'.repeat(4096)}\r\n\x1b[31m`;
    const event = f.journal.appendOutput(chunk);
    f.tracker.write(chunk, { outputSequence: event.revision });
    f.session.outputSequence = event.revision;
    f.session.output = chunk;
    chunks.push(chunk);
  }
  return chunks.join('');
}

async function verifyReaders(kind, disconnect) {
  const f = await fixture(kind);
  const { server, session, identity, sockets, journal } = f;
  const readers = [];
  for (const socket of sockets) readers.push(await server.openTerminalRead(socket, { ...identity, consumerId: 'editor' }));
  await assert.rejects(server.deleteSession({ sessionId: session.sessionId, preserveTerminalReads: true }), /Only ended/u);
  assert.equal(session.terminalMutationAdmissionOpen, true, 'invalid retirement must not stop live input');
  const expected = appendOutput(f);
  await server.finalizeSession(session.sessionId, 0);
  for (const socket of sockets) {
    const final = socket.messages.at(-1).payload;
    assert.equal(final.live, false);
    assert.equal(final.terminalStreamPaged, true);
    assert.equal(final.terminalStream, undefined);
    assert.equal(final.serializedTerminalState, undefined);
    assert.equal(final.output, '');
    assert.equal(final.terminalRevision, journal.getRevision());
    assert.ok(Buffer.byteLength(JSON.stringify(final)) < 1500);
  }
  // Retirement before either first read must preserve both socket-bound identities.
  await server.deleteSession({ sessionId: session.sessionId, preserveTerminalReads: true });
  await server.deleteSession({ sessionId: session.sessionId, preserveTerminalReads: true });
  await assert.rejects(server.attachSession(sockets[0], { sessionId: session.sessionId, terminalStreamMode: 'paged-until-exit' }), /not found/u);
  await assert.rejects(async () => server.openTerminalRead(sockets[0], { ...identity, consumerId: 'panel' }), /not found/u);
  await server.persistRegistry();
  assert.deepEqual(JSON.parse(await readFile(path.join(f.storageDir, 'registry.json'), 'utf8')).sessions, []);
  const journalDir = resolveTerminalJournalSessionDirectory(f.storageDir, session.sessionId);
  assert.ok((await stat(journalDir)).isDirectory());
  for (let index = 0; index < sockets.length; index++) {
    let revision = readers[index].checkpoint.revision;
    const chunks = [];
    let pages = 0;
    while (revision < journal.getRevision()) {
      const page = await server.readTerminalPage(sockets[index], { ...identity, readId: readers[index].readId, afterRevision: revision });
      assert.equal(page.afterRevision, revision);
      assert.equal(page.events[0].revision, revision + 1);
      assert.ok(Buffer.byteLength(JSON.stringify(page.events)) <= 256 * 1024);
      chunks.push(...page.events.map(event => event.data));
      revision = page.revision;
      pages++;
    }
    assert.equal(chunks.join(''), expected, 'both readers must receive all exact bytes after retirement');
    assert.ok(pages > 1);
    if (index === 1 && disconnect) {
      server.cleanupSocket(sockets[index]);
      await session.terminalOperationChain;
    } else {
      await server.closeTerminalRead(sockets[index], readers[index]);
      await server.closeTerminalRead(sockets[index], readers[index]);
    }
    if (index === 0) assert.ok((await stat(journalDir)).isDirectory(), 'the slower socket still owns its source');
  }
  assert.equal(server.sessions.has(session.sessionId), false);
  await assert.rejects(stat(journalDir), { code: 'ENOENT' });
  console.log('paged completion', { kind, disconnect, bytes: expected.length, finalRevision: session.outputSequence });
}

async function verifyNoReaders(kind) {
  const f = await fixture(kind);
  appendOutput(f, 2);
  f.session.stopRequested = true;
  await f.server.finalizeSession(f.session.sessionId, 0);
  const attached = await f.server.attachSession(f.sockets[0], { sessionId: f.session.sessionId,
    deferSubscription: true, terminalStreamMode: 'paged-until-exit' });
  assert.equal(attached.terminalStreamPaged, true);
  assert.equal(attached.terminalStream, undefined, 'offline completion attach must not collect history');
  await f.server.subscribeSession(f.sockets[0], { ...f.identity, afterRevision: attached.terminalRevision,
    terminalStreamMode: 'paged-until-exit' });
  assert.equal(f.sockets[0].messages.at(-1).payload.output, '');
  await f.server.deleteSession({ sessionId: f.session.sessionId, preserveTerminalReads: true });
  assert.equal(f.server.sessions.size, 0);
  await assert.rejects(stat(resolveTerminalJournalSessionDirectory(f.storageDir, f.session.sessionId)), { code: 'ENOENT' });
}

async function verifyMixedSubscribers() {
  const f = await fixture('terminal', ['terminal-stream-paged-completion', 'terminal-stream-paged']);
  const expected = appendOutput(f, 3);
  let fullBuilds = 0;
  f.server.buildTerminalStreamAttachPayload = async session => { fullBuilds++; return f.fullProjection(session); };
  await f.server.finalizeSession(f.session.sessionId, 0);
  assert.equal(fullBuilds, 1);
  const [current, legacy] = f.sockets.map(socket => socket.messages.at(-1).payload);
  assert.equal(current.terminalStreamPaged, true);
  assert.equal(current.terminalStream, undefined);
  assert.equal(legacy.terminalStream.events.map(event => event.data).join(''), expected);
  await f.server.deleteSession({ sessionId: f.session.sessionId, preserveTerminalReads: true });
  assert.equal(fullBuilds, 1, 'graceful cleanup must not build another legacy final snapshot');
}

async function verifyForcedDelete() {
  const f = await fixture('terminal');
  const reader = await f.server.openTerminalRead(f.sockets[0], { ...f.identity, consumerId: 'editor' });
  appendOutput(f, 2);
  await f.server.finalizeSession(f.session.sessionId, 0);
  await f.server.deleteSession({ sessionId: f.session.sessionId, preserveTerminalReads: true });
  await f.server.deleteSession({ sessionId: f.session.sessionId });
  await assert.rejects(async () => f.server.readTerminalPage(f.sockets[0], { ...reader, afterRevision: 0 }), /not found/u);
  assert.equal(f.server.terminalReads.get(f.sockets[0]).size, 0);
}

async function verifyLegacyRecordWithoutJournal() {
  const f = await fixture('terminal');
  await f.server.deleteSession({ sessionId: f.session.sessionId });
  const snapshot = { sessionId: 'legacy-without-journal', kind: 'terminal', live: false, lifecycle: 'closed',
    output: 'LEGACY OUTPUT\r\n', outputSequence: 1, cols: 80, rows: 24, scrollback: 100,
    shellPath: '/bin/sh', cwd: '/project', displayLabel: 'Legacy', launchMode: 'start',
    runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort' };
  const restored = await f.server.normalizeRecoveredSession(snapshot);
  f.server.sessions.set(restored.sessionId, restored);
  f.server.buildTerminalStreamAttachPayload = f.fullProjection;
  const attached = await f.server.attachSession(f.sockets[0], {
    sessionId: restored.sessionId, deferSubscription: true, terminalStreamMode: 'paged-until-exit'
  });
  assert.equal(attached.terminalStreamPaged, undefined, 'old records without a journal cannot offer a reader');
  assert.equal(attached.terminalAuthorityId, undefined);
  assert.equal(attached.output, snapshot.output, 'legacy fallback remains available for Host completion');
  await f.server.deleteSession({ sessionId: restored.sessionId });
}
