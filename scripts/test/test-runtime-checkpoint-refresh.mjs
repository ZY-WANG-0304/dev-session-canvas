import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';
import ts from 'typescript';

const sourceRoot = path.resolve('extensions/vscode/dev-session-canvas/src');
const managerPath = path.join(sourceRoot, 'panel/CanvasPanelManager.ts');
const managerSource = await readFile(managerPath, 'utf8');
const managerAst = ts.createSourceFile(managerPath, managerSource, ts.ScriptTarget.Latest, true);
const managerClass = managerAst.statements.find((node) =>
  ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager'
);
const method = managerClass?.members.find((node) =>
  ts.isMethodDeclaration(node) && node.name.getText(managerAst) === 'performExecutionTerminalProjectionRefresh'
);
assert.ok(method, 'Exercise the production Host refresh method, not a copied implementation.');
const bundle = await esbuild.build({
  stdin: {
    contents: `
      import {
        mergeTerminalStreamCheckpoint,
        mergeTerminalStreamProjectionWithLiveTail,
        cloneTerminalStreamAttachPayload,
        normalizeTerminalStreamAttachPayload,
        normalizeTerminalStreamRevision
      } from './common/terminalSessionStream';
      const normalizeRuntimeHostBackendKind = (value: string) => value;
      class RefreshHarness { ${method.getText(managerAst)} }
      export { RefreshHarness, mergeTerminalStreamCheckpoint };
    `,
    resolveDir: sourceRoot,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: 'node18'
});
const compiled = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
  compiled, compiled.exports, createRequire(import.meta.url)
);
const { RefreshHarness, mergeTerminalStreamCheckpoint: mergeCheckpoint } = compiled.exports;

const original = stream();
const before = structuredClone(original);
const merged = mergeCheckpoint(checkpoint(4), original);
assert.equal(merged.revision, 6);
assert.equal(merged.checkpoint.revision, 4);
assert.deepEqual(merged.events, original.events.slice(3));
assert.deepEqual(original, before, 'Merging must not mutate the existing recovery source.');
assert.notEqual(merged.events[0], original.events[3]);
assert.deepEqual(mergeCheckpoint(checkpoint(6), original).events, []);
const controls = {
  ...stream(),
  events: [output(2), output(3), output(4),
    { type: 'resize', revision: 5, createdAtMs: 5, cols: 101, rows: 37 },
    { type: 'scrollback', revision: 6, createdAtMs: 6, scrollback: 10000 }]
};
assert.deepEqual(mergeCheckpoint(checkpoint(4), controls).events, controls.events.slice(3));
for (const invalid of [
  checkpoint(0), checkpoint(7),
  { ...checkpoint(3), authorityId: 'another-owner' },
  { ...checkpoint(3), sessionId: 'another-session' },
  { ...checkpoint(3), serializedState: { ...checkpoint(3).serializedState, outputSequence: 2 } },
  null
]) {
  assert.equal(mergeCheckpoint(invalid, original), undefined);
}
assert.equal(mergeCheckpoint(checkpoint(4), { ...original, events: original.events.slice(1) }), undefined);
assert.equal(mergeCheckpoint(checkpoint(4), { ...original, events: [...original.events, original.events.at(-1)] }), undefined);

// An unchanged checkpoint must not even walk the Host suffix.
{
  const session = createSession();
  const previous = session.terminalStream;
  Object.defineProperty(previous, 'events', {
    get() { throw new Error('Unchanged refresh traversed the journal suffix.'); }
  });
  const harness = createHarness(session, () => ({ ...result(), revision: 100 }));
  await harness.performExecutionTerminalProjectionRefresh('terminal', 'node', session);
  assert.equal(session.terminalStream, previous);
  assert.equal(session.outputSequence, 6);
  assert.equal(harness.calls.checkpoint.length, 1);
  assert.equal(harness.calls.snapshot, 0);
  assert.deepEqual(harness.calls.checkpoint[0], {
    sessionId: 'session', authorityId: 'authority', afterCheckpointRevision: 1
  });
}

{
  const session = createSession();
  const harness = createHarness(session, () => {
    session.terminalStream.events.push(output(7));
    session.terminalStream.revision = 7;
    session.outputSequence = 7;
    return result(checkpoint(4));
  });
  await harness.performExecutionTerminalProjectionRefresh('terminal', 'node', session);
  assert.equal(session.terminalStream.checkpoint.revision, 4);
  assert.equal(session.terminalStream.revision, 7);
  assert.equal(session.outputSequence, 7);
  assert.deepEqual(session.terminalStream.events.map((event) => event.revision), [5, 6, 7]);
  assert.equal(harness.calls.snapshot, 0);
}

for (const invalidResponse of [
  { ...result(), sessionId: 'other' },
  { ...result(), authorityId: 'other' },
  { ...result(), revision: -1 },
  { ...result(), revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...result(checkpoint(4)), revision: 3 },
  { ...result(checkpoint(7)), revision: 7 },
  result(checkpoint(0)),
  result({ ...checkpoint(4), authorityId: 'other' })
]) {
  const session = createSession();
  const previous = session.terminalStream;
  const harness = createHarness(session, () => invalidResponse);
  await harness.performExecutionTerminalProjectionRefresh('terminal', 'node', session);
  assert.equal(session.terminalStream, previous);
  assert.equal(session.outputSequence, 6);
  assert.equal(harness.calls.snapshot, 0, 'Rejected checkpoint must not trigger a full-suffix fallback.');
  assert.equal(harness.diagnostics.at(-1).event, 'runtime/terminalProjectionRefreshRejected');
}

for (const replacement of ['new-session', 'unhealthy', 'deleted']) {
  const session = createSession();
  const previous = session.terminalStream;
  const harness = createHarness(session, () => {
    if (replacement === 'new-session') harness.sessions.set('node', createSession());
    if (replacement === 'unhealthy') session.terminalStreamHealthy = false;
    if (replacement === 'deleted') harness.sessions.delete('node');
    return result(checkpoint(4));
  });
  await harness.performExecutionTerminalProjectionRefresh('terminal', 'node', session);
  assert.equal(session.terminalStream, previous, 'Stale responses must not replace terminal state.');
}

{
  const session = createSession();
  const previous = session.terminalStream;
  const harness = createHarness(session, () => { throw new Error('disconnected'); });
  await assert.rejects(harness.performExecutionTerminalProjectionRefresh('terminal', 'node', session), /disconnected/u);
  assert.equal(session.terminalStream, previous);
  assert.equal(harness.calls.snapshot, 0);
}

{
  const session = createSession();
  const harness = createHarness(session, () => result(), false);
  await harness.performExecutionTerminalProjectionRefresh('terminal', 'node', session);
  assert.equal(harness.calls.checkpoint.length, 0);
  assert.equal(harness.calls.snapshot, 1, 'Old Supervisor must retain its existing snapshot path.');
  assert.equal(session.terminalStream.checkpoint.revision, 4);
  assert.deepEqual(session.terminalStream.events.map((event) => event.revision), [5, 6]);
}

console.log('runtime checkpoint refresh tests passed (merge, Host routing, unchanged fast path, stale replies, legacy fallback)');

function createHarness(session, query, supported = true) {
  const harness = new RefreshHarness();
  harness.sessions = new Map([['node', session]]);
  harness.calls = { checkpoint: [], snapshot: 0 };
  harness.diagnostics = [];
  harness.getExecutionSessions = () => harness.sessions;
  harness.recordDiagnosticEvent = (event, details) => harness.diagnostics.push({ event, ...details });
  harness.getRuntimeSupervisorClientForKind = async () => ({
    supportsTerminalCheckpointRefresh: () => supported,
    supportsTerminalProjectionSnapshot: () => true,
    getSessionCheckpoint: async (params) => {
      harness.calls.checkpoint.push(params);
      return query();
    },
    getSessionSnapshot: async () => {
      harness.calls.snapshot += 1;
      return {
        kind: 'terminal',
        sessionId: 'session',
        terminalAuthorityId: 'authority',
        terminalRevision: 6,
        terminalStream: mergeCheckpoint(checkpoint(4), stream())
      };
    }
  });
  return harness;
}

function createSession() {
  return {
    owner: 'supervisor',
    runtimeSessionId: 'session',
    runtimeBackend: 'legacy-detached',
    terminalAuthorityId: 'authority',
    terminalStreamHealthy: true,
    outputSequence: 6,
    terminalStream: stream()
  };
}

function result(value) {
  return { sessionId: 'session', authorityId: 'authority', revision: 6, ...(value ? { checkpoint: value } : {}) };
}

function stream() {
  return {
    version: 1, sessionId: 'session', authorityId: 'authority', revision: 6,
    checkpoint: checkpoint(1),
    events: [2, 3, 4, 5, 6].map(output)
  };
}

function output(revision) {
  return { type: 'output', revision, createdAtMs: revision, data: `event-${revision}` };
}

function checkpoint(revision) {
  return {
    version: 1, sessionId: 'session', authorityId: 'authority', revision,
    cols: 80, rows: 24, scrollback: 1000, createdAtMs: revision,
    serializedState: { format: 'xterm-serialize-v1', outputSequence: revision, data: `checkpoint-${revision}` }
  };
}
