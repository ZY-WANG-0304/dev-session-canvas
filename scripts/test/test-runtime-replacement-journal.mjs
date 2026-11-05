import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

process.env.DSC_RUNTIME_REPLACEMENT_LOCK_TIMEOUT_MS = '300';

const bundled = await esbuild.build({
  stdin: {
    contents: `
      export {
        createRuntimeReplacementOperation,
        listRuntimeReplacements,
        readRuntimeReplacement,
        removeRuntimeReplacement,
        removeRuntimeReplacementIfCurrent,
        writeRuntimeReplacement,
        RuntimeReplacementJournalError
      } from './extensions/vscode/dev-session-canvas/src/panel/runtimeReplacementJournal';
    `,
    resolveDir: process.cwd(),
    sourcefile: 'runtime-replacement-journal-entry.ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node18'
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
  createRequire(import.meta.url), loaded, loaded.exports,
  path.resolve('scripts/test/runtime-replacement-journal.cjs'), path.resolve('scripts/test')
);
const {
  createRuntimeReplacementOperation,
  listRuntimeReplacements,
  readRuntimeReplacement,
  removeRuntimeReplacement,
  removeRuntimeReplacementIfCurrent,
  writeRuntimeReplacement,
  RuntimeReplacementJournalError
} = loaded.exports;

const root = await mkdtemp(path.join(os.tmpdir(), 'dsc-replacement-journal-'));
const identity = { rootPath: path.join(root, 'shared-root'), nodeId: 'agent-1', kind: 'agent' };

function operation() {
  return createRuntimeReplacementOperation({
    rootPath: identity.rootPath,
    localNodeId: identity.nodeId,
    kind: identity.kind,
    nodeId: 'workspace:shared-root:agent-1',
    originalNode: {
      status: 'history-restored',
      summary: 'Original provider history',
      metadata: { runtimeSessionId: 'original-session', liveSession: false }
    },
    originalBinding: {
      sessionId: 'original-session', backendKind: 'systemd-user',
      runtimeStoragePath: path.join(root, 'runtime'), status: 'history-restored',
      attachmentState: 'history-restored', lifecycle: 'stopped'
    },
    targetBinding: {
      sessionId: 'reserved-session', backendKind: 'systemd-user',
      runtimeStoragePath: path.join(root, 'runtime'), status: 'resuming',
      attachmentState: 'attached-live', lifecycle: 'resuming'
    },
    reservedSessionId: 'reserved-session',
    launchMode: 'resume',
    providerResume: { strategy: 'claude-native', sessionId: 'provider-session' },
    stop: 'unconfirmed',
    evidence: 'connection-unavailable-before-submit:socket-directory',
    reason: 'controlled test'
  });
}

try {
  assert.equal(await readRuntimeReplacement(root, identity), undefined);

  const created = operation();
  const file = await writeRuntimeReplacement(root, created);
  assert.equal(path.dirname(file), path.join(root, 'runtime-replacements-v1'));
  assert.deepEqual(await readRuntimeReplacement(root, identity), created);

  const list = await listRuntimeReplacements(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].operationId, created.operationId);
  assert.deepEqual(list[0].originalNode, created.originalNode);
  assert.equal(list[0].originalBinding?.sessionId, 'original-session');
  assert.equal(list[0].targetBinding.sessionId, 'reserved-session');

  const updated = { ...created, phase: 'create-may-have-been-submitted', updatedAt: new Date().toISOString() };
  await writeRuntimeReplacement(root, updated);
  assert.equal((await readRuntimeReplacement(root, identity))?.phase, 'create-may-have-been-submitted');
  assert.equal((await readdir(path.join(root, 'runtime-replacements-v1')))
    .filter(name => name.endsWith('.tmp')).length, 0, 'atomic writes leave no staging file');

  const notAcquired = { ...updated, phase: 'not-acquired', updatedAt: new Date().toISOString() };
  await writeRuntimeReplacement(root, notAcquired);
  assert.equal((await readRuntimeReplacement(root, identity))?.phase, 'not-acquired');
  const bound = { ...notAcquired, phase: 'bound', boundConfirmed: true, updatedAt: new Date().toISOString() };
  await writeRuntimeReplacement(root, bound);
  assert.equal((await readRuntimeReplacement(root, identity))?.boundConfirmed, true);

  const replacement = { ...operation(), operationId: 'new-operation' };
  await writeRuntimeReplacement(root, replacement);
  assert.equal(await removeRuntimeReplacementIfCurrent(root, identity, created.operationId), 'changed',
    'operation-scoped cleanup cannot delete a newer journal');
  assert.equal((await readRuntimeReplacement(root, identity))?.operationId, 'new-operation');
  assert.equal(await removeRuntimeReplacementIfCurrent(root, identity, replacement.operationId), 'removed');
  assert.equal(await removeRuntimeReplacementIfCurrent(root, identity, replacement.operationId), 'absent');
  await writeRuntimeReplacement(root, updated);

  const advanced = {
    ...updated,
    phase: 'create-may-have-been-submitted',
    updatedAt: new Date(Date.now() + 1_000).toISOString()
  };
  await writeRuntimeReplacement(root, advanced);
  assert.equal(await removeRuntimeReplacementIfCurrent(root, identity, {
    operationId: advanced.operationId, phase: 'prepared', updatedAt: advanced.updatedAt
  }), 'changed', 'a phase advance within the same operation is a new responsibility');
  assert.equal(await removeRuntimeReplacementIfCurrent(root, identity, {
    operationId: advanced.operationId, phase: advanced.phase, updatedAt: updated.updatedAt
  }), 'changed', 'a rewrite within the same phase is a new responsibility');
  assert.equal((await readRuntimeReplacement(root, identity))?.phase, 'create-may-have-been-submitted');
  assert.equal(await removeRuntimeReplacementIfCurrent(root, identity, {
    operationId: advanced.operationId, phase: advanced.phase, updatedAt: advanced.updatedAt
  }), 'removed');
  await writeRuntimeReplacement(root, advanced);

  const renamedIdentity = { ...identity, nodeId: 'agent-local-alias' };
  assert.equal(await readRuntimeReplacement(root, renamedIdentity), undefined,
    'the file key uses canonical root + root-local node ID + kind');

  const [recordFile] = await readdir(path.join(root, 'runtime-replacements-v1'));
  const recordPath = path.join(root, 'runtime-replacements-v1', recordFile);
  const validJson = JSON.parse(await readFile(recordPath, 'utf8'));
  await writeFile(recordPath, JSON.stringify({ ...validJson, phase: 'unknown-phase' }));
  await assert.rejects(readRuntimeReplacement(root, identity), RuntimeReplacementJournalError);

  await writeFile(recordPath, JSON.stringify({ ...validJson, originalNode: { status: 1 } }));
  await assert.rejects(readRuntimeReplacement(root, identity), /original node status is invalid/);

  await writeFile(recordPath, JSON.stringify(validJson));
  await removeRuntimeReplacement(root, identity);
  assert.equal(await readRuntimeReplacement(root, identity), undefined);
  assert.deepEqual(await listRuntimeReplacements(root), []);

  await writeRuntimeReplacement(root, operation());
  const journalDirectory = path.join(root, 'runtime-replacements-v1');
  const lockRecordPath = path.join(journalDirectory,
    (await readdir(journalDirectory)).find(name => name.endsWith('.json')));
  const lockPath = `${lockRecordPath}.lock`;

  await writeFile(lockPath, JSON.stringify({
    pid: process.pid, token: 'live-owner', createdAtMs: Date.now() - 86_400_000
  }));
  await assert.rejects(writeRuntimeReplacement(root, operation()), /remained locked/,
    'an old lock is never stolen from a live owner');
  await access(lockPath);
  await rm(lockPath);

  await writeFile(lockPath, JSON.stringify({
    pid: 2_147_483_000, token: 'dead-owner', createdAtMs: Date.now() - 86_400_000
  }));
  await writeRuntimeReplacement(root, operation());
  await assert.rejects(access(lockPath), { code: 'ENOENT' },
    'a provably dead owner lock is reclaimed and released');

  const deadToken = 'dead-owner-with-marker';
  await writeFile(lockPath, JSON.stringify({
    pid: 2_147_483_000, token: deadToken, createdAtMs: Date.now() - 86_400_000
  }));
  const markerPath = `${lockPath}.reclaim-owner-${createHash('sha256').update(deadToken).digest('hex')}`;
  await writeFile(markerPath, JSON.stringify({
    pid: process.pid, token: 'concurrent-reclaimer', createdAtMs: Date.now()
  }));
  await assert.rejects(writeRuntimeReplacement(root, operation()), /remained locked/,
    'one generation-scoped reclaimer excludes a concurrent double reclaim');
  await access(lockPath);
  await rm(markerPath);
  await writeRuntimeReplacement(root, operation());
  await assert.rejects(access(lockPath), { code: 'ENOENT' },
    'the reclaim marker is removed and the lock becomes available again');

  await writeFile(lockPath, '');
  const old = new Date(Date.now() - 86_400_000);
  await utimes(lockPath, old, old);
  await assert.rejects(writeRuntimeReplacement(root, operation()), /remained locked/,
    'a malformed lock is never reclaimed by age while its creator may still be alive');
  await access(lockPath);
  await rm(lockPath);

  const deadMarkerToken = 'dead-reclaimer-owner';
  await writeFile(lockPath, JSON.stringify({
    pid: 2_147_483_000, token: deadMarkerToken, createdAtMs: Date.now() - 86_400_000
  }));
  const deadMarkerPath = `${lockPath}.reclaim-owner-${createHash('sha256').update(deadMarkerToken).digest('hex')}`;
  await writeFile(deadMarkerPath, JSON.stringify({
    pid: 2_147_483_000, token: 'dead-reclaimer', createdAtMs: Date.now() - 86_400_000
  }));
  await utimes(deadMarkerPath, old, old);
  await assert.rejects(writeRuntimeReplacement(root, operation()), /remained locked/,
    'an abandoned reclaim marker fails closed instead of being removed by observation');
  await access(deadMarkerPath);
  await rm(deadMarkerPath);
  await writeRuntimeReplacement(root, operation());
  await assert.rejects(access(lockPath), { code: 'ENOENT' });

  console.log('Runtime replacement journal: 1/1 passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
