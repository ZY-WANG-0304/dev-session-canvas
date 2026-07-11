import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-terminal-session-journal-'));

try {
  const outfile = path.join(tempDir, 'terminalSessionJournal.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    TerminalSessionJournal,
    resolveTerminalJournalSessionDirectory,
    verifyTerminalSessionJournal
  } = require(outfile);

  const storageDir = path.join(tempDir, 'runtime-storage');
  const sessionId = 'journal-test-session';
  const authorityId = 'journal-test-authority';
  const journal = await TerminalSessionJournal.create({
    storageDir,
    sessionId,
    authorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    flushDelayMs: 60_000
  });

  const first = journal.appendOutput('\u001b[2Jalpha\r\n');
  const second = journal.appendResize(100, 32);
  const third = journal.appendScrollback(2000);
  const fourth = journal.appendOutput('omega\r\n');
  assert.deepEqual(
    [first.revision, second.revision, third.revision, fourth.revision],
    [1, 2, 3, 4],
    'output, resize and scrollback must share one contiguous authority revision.'
  );
  await journal.flush();

  const verified = await verifyTerminalSessionJournal(storageDir, sessionId, authorityId);
  assert.equal(verified.manifest.lastRevision, 4);
  assert.equal(verified.events.length, 4);
  assert.deepEqual(verified.events.map((event) => event.type), ['output', 'resize', 'scrollback', 'output']);
  assert.ok(verified.manifest.segments.length >= 2, 'small test segments should force rotation.');

  journal.releaseMemoryThrough(2);
  assert.deepEqual(
    journal.getEventsAfter(2).map((event) => event.revision),
    [3, 4],
    'checkpoint cache may release memory without deleting persisted journal records.'
  );
  assert.equal((await journal.readAllEvents()).length, 4, 'all persisted events must remain after memory release.');

  const reopened = await TerminalSessionJournal.open({
    storageDir,
    sessionId,
    authorityId,
    segmentMaxBytes: 420
  });
  assert.equal(reopened.getRevision(), 4);
  assert.equal((await reopened.readAllEvents()).length, 4);

  const sessionDirectory = resolveTerminalJournalSessionDirectory(storageDir, sessionId);
  const manifestPath = path.join(sessionDirectory, 'manifest.json');
  const manifestAtRevisionFour = await readFile(manifestPath, 'utf8');
  reopened.appendOutput('after-stale-manifest\r\n');
  await reopened.flush();
  await writeFile(manifestPath, manifestAtRevisionFour, 'utf8');
  await assert.rejects(
    verifyTerminalSessionJournal(storageDir, sessionId, authorityId),
    /segment manifest mismatch/u,
    'strict verification must expose a segment tail that is newer than its manifest.'
  );
  const repairedStaleManifest = await TerminalSessionJournal.open({
    storageDir,
    sessionId,
    authorityId,
    segmentMaxBytes: 420
  });
  assert.equal(repairedStaleManifest.getRevision(), 5, 'open should recover a complete checksummed tail.');
  assert.equal((await verifyTerminalSessionJournal(storageDir, sessionId, authorityId)).events.length, 5);

  const manifestAtRevisionFive = await readFile(manifestPath, 'utf8');
  repairedStaleManifest.appendOutput('incomplete-crash-tail\r\n');
  await repairedStaleManifest.flush();
  await writeFile(manifestPath, manifestAtRevisionFive, 'utf8');
  const crashSegmentFiles = (await readdir(sessionDirectory)).filter((file) => file.endsWith('.ndjson')).sort();
  const crashTailPath = path.join(sessionDirectory, crashSegmentFiles.at(-1));
  const completeCrashTail = await readFile(crashTailPath);
  await writeFile(crashTailPath, completeCrashTail.subarray(0, completeCrashTail.length - 5));
  const repairedIncompleteTail = await TerminalSessionJournal.open({
    storageDir,
    sessionId,
    authorityId,
    segmentMaxBytes: 420
  });
  assert.equal(
    repairedIncompleteTail.getRevision(),
    5,
    'open may truncate only the final incomplete record and must retain the verified prefix.'
  );
  assert.equal((await verifyTerminalSessionJournal(storageDir, sessionId, authorityId)).events.length, 5);

  const segmentFiles = (await readdir(sessionDirectory)).filter((file) => file.endsWith('.ndjson')).sort();
  const firstSegmentPath = path.join(sessionDirectory, segmentFiles[0]);
  const originalFirstSegment = await readFile(firstSegmentPath, 'utf8');
  await writeFile(firstSegmentPath, originalFirstSegment.replace('alpha', 'ALPHA'), 'utf8');
  await assert.rejects(
    verifyTerminalSessionJournal(storageDir, sessionId, authorityId),
    /byte count mismatch|checksum or revision mismatch/u,
    'journal verification must fail closed when a persisted record is changed.'
  );

  console.log('terminalSessionJournal tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
