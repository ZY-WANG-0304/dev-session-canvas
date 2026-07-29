import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-terminal-session-journal-'));
const checkpointProfiles = {
  'xterm-serialize-v1': 'test-xterm-serialize-profile-v1'
};

function createCheckpoint(sessionId, authorityId, revision, label = `revision-${revision}`) {
  return {
    version: 1,
    sessionId,
    authorityId,
    revision,
    cols: 80,
    rows: 24,
    scrollback: 1000,
    createdAtMs: Date.now(),
    serializedState: {
      format: 'xterm-serialize-v1',
      data: label,
      outputSequence: revision
    }
  };
}

async function readManifest(sessionDirectory) {
  return JSON.parse(await readFile(path.join(sessionDirectory, 'manifest.json'), 'utf8'));
}

async function generationFallbackCommit(journal, sessionId, authorityId, revision) {
  return journal.commitCheckpoint(createCheckpoint(sessionId, authorityId, revision), { force: true });
}

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
    readTerminalSessionJournalMetadata,
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

  const recoveryMetadata = await readTerminalSessionJournalMetadata(storageDir, sessionId, authorityId);
  assert.deepEqual(
    recoveryMetadata,
    {
      sessionId,
      authorityId,
      version: 1,
      lastRevision: 4,
      retainedStartRevision: 1,
      segmentCount: verified.manifest.segments.length,
      segmentBytes: verified.manifest.segments.reduce((total, segment) => total + segment.bytes, 0),
      manifestBytes: (await fs.promises.stat(
        path.join(resolveTerminalJournalSessionDirectory(storageDir, sessionId), 'manifest.json')
      )).size
    },
    'recovery metadata must describe a V1 Journal without exposing parsed events.'
  );

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
  await assert.rejects(
    repairedIncompleteTail.commitCheckpoint(createCheckpoint(sessionId, authorityId, 5), { force: true }),
    /No terminal journal checkpoint producer profile is registered/u,
    'checkpoint commit must require an explicit codec-to-producer-profile mapping.'
  );
  await repairedIncompleteTail.flush();

  const generationSessionId = 'journal-generation-test-session';
  const generationAuthorityId = 'journal-generation-test-authority';
  const generationJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: generationSessionId,
    authorityId: generationAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    flushDelayMs: 60_000,
    compactionMinBytes: 1024 * 1024,
    checkpointProfiles
  });
  for (let revision = 1; revision <= 4; revision += 1) {
    generationJournal.appendOutput(`generation-${revision}\r\n`);
  }
  await generationJournal.flush();
  assert.equal(
    generationJournal.shouldCommitCheckpoint(4),
    false,
    'the production capacity gate must avoid promoting a small journal.'
  );
  assert.deepEqual(
    await generationJournal.commitCheckpoint(
      createCheckpoint(generationSessionId, generationAuthorityId, 4)
    ),
    {
      committed: false,
      compactedBytes: 0,
      compactedSegments: 0,
      retainedStartRevision: 1,
      reason: 'below-threshold'
    }
  );

  const firstPromotion = await generationJournal.commitCheckpoint(
    createCheckpoint(generationSessionId, generationAuthorityId, 4),
    { force: true }
  );
  assert.equal(firstPromotion.committed, true);
  assert.equal(firstPromotion.compactedSegments, 0, 'the first promotion must preserve the genesis journal.');
  assert.equal(generationJournal.getRetainedStartRevision(), 1);
  assert.deepEqual(
    (await generationJournal.getRecoveryCandidates()).map((candidate) => candidate.source),
    ['current', 'genesis'],
    'the first checkpoint must retain a full-journal fallback.'
  );

  for (let revision = 5; revision <= 8; revision += 1) {
    generationJournal.appendOutput(`generation-${revision}\r\n`);
  }
  await generationJournal.flush();
  const generationDirectory = resolveTerminalJournalSessionDirectory(storageDir, generationSessionId);
  const preCompactionSegments = (await readdir(generationDirectory))
    .filter((file) => file.endsWith('.ndjson'))
    .sort();
  const preCompactionSegmentCopies = new Map(
    await Promise.all(preCompactionSegments.map(async (file) => [file, await readFile(path.join(generationDirectory, file))]))
  );
  const secondPromotion = await generationJournal.commitCheckpoint(
    createCheckpoint(generationSessionId, generationAuthorityId, 8),
    { force: true, retainAfterRevision: 4 }
  );
  assert.equal(secondPromotion.committed, true);
  assert.ok(secondPromotion.compactedSegments > 0, 'the second promotion may reclaim covered complete segments.');
  assert.equal(generationJournal.getRetainedStartRevision(), 5);
  assert.deepEqual(
    (await generationJournal.getRecoveryCandidates()).map((candidate) => candidate.source),
    ['current', 'previous'],
    'after prefix reclamation only the current and previous recovery chains remain.'
  );
  assert.deepEqual(
    (await generationJournal.getRecoveryCandidates())[1].events.map((event) => event.revision),
    [5, 6, 7, 8]
  );
  const generationCandidates = await generationJournal.getRecoveryCandidates();
  assert.match(generationCandidates[0].outputTail, /generation-8/u);
  assert.match(generationCandidates[1].outputTail, /generation-4/u);
  assert.doesNotMatch(
    generationCandidates[1].outputTail,
    /generation-5/u,
    'each immutable checkpoint must retain the advisory raw-output tail from its own revision.'
  );

  const manifestAtRevisionEight = await readFile(path.join(generationDirectory, 'manifest.json'), 'utf8');
  generationJournal.appendOutput('complete-v2-stale-tail\r\n');
  await generationJournal.flush();
  await writeFile(path.join(generationDirectory, 'manifest.json'), manifestAtRevisionEight, 'utf8');
  const repairedV2Tail = await TerminalSessionJournal.open({
    storageDir,
    sessionId: generationSessionId,
    authorityId: generationAuthorityId,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  assert.equal(repairedV2Tail.getRevision(), 9, 'v2 open must recover a complete stale-manifest tail.');

  const manifestAtRevisionNine = await readFile(path.join(generationDirectory, 'manifest.json'), 'utf8');
  repairedV2Tail.appendOutput('incomplete-v2-tail\r\n');
  await repairedV2Tail.flush();
  await writeFile(path.join(generationDirectory, 'manifest.json'), manifestAtRevisionNine, 'utf8');
  const v2TailFiles = (await readdir(generationDirectory)).filter((file) => file.endsWith('.ndjson')).sort();
  const v2TailPath = path.join(generationDirectory, v2TailFiles.at(-1));
  const completeV2Tail = await readFile(v2TailPath);
  await writeFile(v2TailPath, completeV2Tail.subarray(0, completeV2Tail.length - 7));
  const repairedIncompleteV2Tail = await TerminalSessionJournal.open({
    storageDir,
    sessionId: generationSessionId,
    authorityId: generationAuthorityId,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  assert.equal(repairedIncompleteV2Tail.getRevision(), 9);

  const manifestAfterV2Repair = await readManifest(generationDirectory);
  const removedPrefixFile = preCompactionSegments.find(
    (file) => !manifestAfterV2Repair.segments.some((segment) => segment.file === file)
  );
  assert.ok(removedPrefixFile, 'the test must have a compacted prefix segment to restore as an orphan.');
  await writeFile(
    path.join(generationDirectory, removedPrefixFile),
    preCompactionSegmentCopies.get(removedPrefixFile)
  );
  const reopenedWithPostManifestOrphan = await TerminalSessionJournal.open({
    storageDir,
    sessionId: generationSessionId,
    authorityId: generationAuthorityId,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  assert.equal(
    reopenedWithPostManifestOrphan.getRevision(),
    9,
    'segments left behind after the manifest rename must not re-enter the retained chain.'
  );

  const currentCheckpointPath = path.join(generationDirectory, manifestAfterV2Repair.currentCheckpoint.file);
  await writeFile(currentCheckpointPath, '{"corrupt":true}\n', 'utf8');
  const previousFallback = await reopenedWithPostManifestOrphan.getRecoveryCandidates();
  assert.deepEqual(previousFallback.map((candidate) => candidate.source), ['previous']);
  assert.deepEqual(previousFallback[0].events.map((event) => event.revision), [5, 6, 7, 8, 9]);
  await writeFile(
    path.join(generationDirectory, manifestAfterV2Repair.previousCheckpoint.file),
    '{"corrupt":true}\n',
    'utf8'
  );
  assert.deepEqual(
    await reopenedWithPostManifestOrphan.getRecoveryCandidates(),
    [],
    'when the retained prefix is gone and both checkpoint generations are invalid, recovery must fail closed.'
  );

  const genesisFallbackSessionId = 'journal-genesis-fallback-session';
  const genesisFallbackAuthorityId = 'journal-genesis-fallback-authority';
  const genesisFallbackJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: genesisFallbackSessionId,
    authorityId: genesisFallbackAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  genesisFallbackJournal.appendOutput('genesis-fallback\r\n');
  await genesisFallbackJournal.flush();
  await generationFallbackCommit(genesisFallbackJournal, genesisFallbackSessionId, genesisFallbackAuthorityId, 1);
  const genesisFallbackDirectory = resolveTerminalJournalSessionDirectory(storageDir, genesisFallbackSessionId);
  const genesisFallbackManifest = await readManifest(genesisFallbackDirectory);
  await writeFile(
    path.join(genesisFallbackDirectory, genesisFallbackManifest.currentCheckpoint.file),
    '{"corrupt":true}\n',
    'utf8'
  );
  const genesisFallback = await genesisFallbackJournal.getRecoveryCandidates();
  assert.deepEqual(genesisFallback.map((candidate) => candidate.source), ['genesis']);
  assert.deepEqual(genesisFallback[0].events.map((event) => event.revision), [1]);

  const resetSessionId = 'journal-invalid-previous-reset-session';
  const resetAuthorityId = 'journal-invalid-previous-reset-authority';
  const resetJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: resetSessionId,
    authorityId: resetAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  resetJournal.appendOutput('reset-1\r\n');
  resetJournal.appendOutput('reset-2\r\n');
  await resetJournal.flush();
  await generationFallbackCommit(resetJournal, resetSessionId, resetAuthorityId, 2);
  const resetDirectory = resolveTerminalJournalSessionDirectory(storageDir, resetSessionId);
  const resetFirstManifest = await readManifest(resetDirectory);
  await writeFile(
    path.join(resetDirectory, resetFirstManifest.currentCheckpoint.file),
    '{"corrupt":true}\n',
    'utf8'
  );
  resetJournal.appendOutput('reset-3\r\n');
  resetJournal.appendOutput('reset-4\r\n');
  await resetJournal.flush();
  const resetPromotion = await generationFallbackCommit(resetJournal, resetSessionId, resetAuthorityId, 4);
  assert.equal(resetPromotion.compactedSegments, 0);
  const resetManifest = await readManifest(resetDirectory);
  assert.equal(resetManifest.retainedStartRevision, 1);
  assert.equal(resetManifest.previousCheckpoint, undefined);
  assert.deepEqual(
    (await resetJournal.getRecoveryCandidates()).map((candidate) => candidate.source),
    ['current', 'genesis'],
    'a corrupt old current must make the next promotion behave like a first generation.'
  );

  const carriedFallbackSessionId = 'journal-carried-previous-fallback-session';
  const carriedFallbackAuthorityId = 'journal-carried-previous-fallback-authority';
  const carriedFallbackJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: carriedFallbackSessionId,
    authorityId: carriedFallbackAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  for (let revision = 1; revision <= 4; revision += 1) {
    carriedFallbackJournal.appendOutput(`carried-fallback-${revision}\r\n`);
  }
  await carriedFallbackJournal.flush();
  await generationFallbackCommit(
    carriedFallbackJournal,
    carriedFallbackSessionId,
    carriedFallbackAuthorityId,
    4
  );
  for (let revision = 5; revision <= 8; revision += 1) {
    carriedFallbackJournal.appendOutput(`carried-fallback-${revision}\r\n`);
  }
  await carriedFallbackJournal.flush();
  await carriedFallbackJournal.commitCheckpoint(
    createCheckpoint(carriedFallbackSessionId, carriedFallbackAuthorityId, 8),
    { force: true, retainAfterRevision: 4 }
  );
  const carriedFallbackDirectory = resolveTerminalJournalSessionDirectory(
    storageDir,
    carriedFallbackSessionId
  );
  const carriedFallbackManifestAtEight = await readManifest(carriedFallbackDirectory);
  assert.ok(
    carriedFallbackManifestAtEight.retainedStartRevision > 1,
    'the regression setup must remove the genesis journal prefix.'
  );
  await writeFile(
    path.join(carriedFallbackDirectory, carriedFallbackManifestAtEight.currentCheckpoint.file),
    '{"corrupt":true}\n',
    'utf8'
  );
  for (let revision = 9; revision <= 12; revision += 1) {
    carriedFallbackJournal.appendOutput(`carried-fallback-${revision}\r\n`);
  }
  await carriedFallbackJournal.flush();
  const carriedFallbackPromotion = await generationFallbackCommit(
    carriedFallbackJournal,
    carriedFallbackSessionId,
    carriedFallbackAuthorityId,
    12
  );
  assert.equal(carriedFallbackPromotion.compactedSegments, 0);
  const carriedFallbackManifestAtTwelve = await readManifest(carriedFallbackDirectory);
  assert.equal(
    carriedFallbackManifestAtTwelve.previousCheckpoint.file,
    carriedFallbackManifestAtEight.previousCheckpoint.file,
    'a corrupt current must not discard the older usable fallback after genesis compaction.'
  );
  assert.equal(
    carriedFallbackManifestAtTwelve.retainedStartRevision,
    carriedFallbackManifestAtEight.retainedStartRevision
  );
  await writeFile(
    path.join(carriedFallbackDirectory, carriedFallbackManifestAtTwelve.currentCheckpoint.file),
    '{"corrupt":true}\n',
    'utf8'
  );
  const carriedPreviousFallback = await carriedFallbackJournal.getRecoveryCandidates();
  assert.deepEqual(carriedPreviousFallback.map((candidate) => candidate.source), ['previous']);
  assert.deepEqual(
    carriedPreviousFallback[0].events.map((event) => event.revision),
    [5, 6, 7, 8, 9, 10, 11, 12]
  );

  const durableSessionId = 'journal-durable-segment-barrier-session';
  const durableAuthorityId = 'journal-durable-segment-barrier-authority';
  const durableJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: durableSessionId,
    authorityId: durableAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  durableJournal.appendOutput('durable-1\r\n');
  await durableJournal.flush();
  const originalOpen = fs.promises.open;
  let syncedJournalSegments = 0;
  fs.promises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.ndjson')) {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => {
        syncedJournalSegments += 1;
        return originalSync();
      };
    }
    return handle;
  };
  try {
    await generationFallbackCommit(durableJournal, durableSessionId, durableAuthorityId, 1);
  } finally {
    fs.promises.open = originalOpen;
  }
  assert.ok(
    syncedJournalSegments > 0,
    'checkpoint manifest durability must be preceded by fsync of its retained journal segments.'
  );
  durableJournal.appendOutput('durable-2\r\n');
  await durableJournal.flush();
  const concurrentCommit = generationFallbackCommit(durableJournal, durableSessionId, durableAuthorityId, 2);
  assert.throws(
    () => durableJournal.appendOutput('must-not-race\r\n'),
    /append raced with checkpoint commit/u,
    'the journal API must fail fast instead of letting append change the head during a checkpoint transaction.'
  );
  await concurrentCommit;

  const corruptionSessionId = 'journal-pre-compact-corruption-session';
  const corruptionAuthorityId = 'journal-pre-compact-corruption-authority';
  const corruptionJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: corruptionSessionId,
    authorityId: corruptionAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  corruptionJournal.appendOutput('corruption-1\r\n');
  corruptionJournal.appendOutput('corruption-2\r\n');
  await corruptionJournal.flush();
  await generationFallbackCommit(corruptionJournal, corruptionSessionId, corruptionAuthorityId, 2);
  const corruptionDirectory = resolveTerminalJournalSessionDirectory(storageDir, corruptionSessionId);
  const corruptionManifestBefore = await readManifest(corruptionDirectory);
  const corruptedSegmentPath = path.join(corruptionDirectory, corruptionManifestBefore.segments[0].file);
  const uncorruptedSegment = await readFile(corruptedSegmentPath, 'utf8');
  await writeFile(corruptedSegmentPath, uncorruptedSegment.replace('corruption-1', 'CORRUPTION-1'), 'utf8');
  corruptionJournal.appendOutput('corruption-3\r\n');
  await corruptionJournal.flush();
  await assert.rejects(
    generationFallbackCommit(corruptionJournal, corruptionSessionId, corruptionAuthorityId, 3),
    /checksum or revision mismatch/u,
    'checkpoint promotion must verify the full journal chain before deleting any prefix.'
  );
  const corruptionManifestAfter = await readManifest(corruptionDirectory);
  assert.equal(corruptionManifestAfter.retainedStartRevision, 1);
  assert.equal(
    corruptionManifestAfter.currentCheckpoint.file,
    corruptionManifestBefore.currentCheckpoint.file,
    'failed verification must leave the old manifest generation authoritative.'
  );

  const profileSessionId = 'journal-checkpoint-profile-session';
  const profileAuthorityId = 'journal-checkpoint-profile-authority';
  const profileV1 = { 'xterm-serialize-v1': 'test-producer-profile-v1' };
  const profileV2 = { 'xterm-serialize-v1': 'test-producer-profile-v2' };
  const profileJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: profileSessionId,
    authorityId: profileAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles: profileV1
  });
  profileJournal.appendOutput('profile-1\r\n');
  profileJournal.appendOutput('profile-2\r\n');
  await profileJournal.flush();
  await generationFallbackCommit(profileJournal, profileSessionId, profileAuthorityId, 2);
  const futureProfileJournal = await TerminalSessionJournal.open({
    storageDir,
    sessionId: profileSessionId,
    authorityId: profileAuthorityId,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles: profileV2
  });
  futureProfileJournal.appendOutput('profile-3\r\n');
  futureProfileJournal.appendOutput('profile-4\r\n');
  await futureProfileJournal.flush();
  await futureProfileJournal.commitCheckpoint(
    createCheckpoint(profileSessionId, profileAuthorityId, 4),
    { force: true, retainAfterRevision: 2 }
  );
  const profileDirectory = resolveTerminalJournalSessionDirectory(storageDir, profileSessionId);
  const profileResetManifest = await readManifest(profileDirectory);
  assert.equal(profileResetManifest.retainedStartRevision, 1);
  assert.equal(
    profileResetManifest.previousCheckpoint,
    undefined,
    'an incompatible old current must reset the generation and retain the full journal.'
  );
  const supportedProfileJournal = await TerminalSessionJournal.open({
    storageDir,
    sessionId: profileSessionId,
    authorityId: profileAuthorityId,
    segmentMaxBytes: 420,
    checkpointProfiles: profileV1
  });
  const profileFallback = await supportedProfileJournal.getRecoveryCandidates();
  assert.deepEqual(
    profileFallback.map((candidate) => candidate.source),
    ['genesis'],
    'a reader that cannot use the new profile must retain the full-journal fallback during migration.'
  );
  assert.deepEqual(profileFallback[0].events.map((event) => event.revision), [1, 2, 3, 4]);

  futureProfileJournal.appendOutput('profile-5\r\n');
  futureProfileJournal.appendOutput('profile-6\r\n');
  await futureProfileJournal.flush();
  await futureProfileJournal.commitCheckpoint(
    createCheckpoint(profileSessionId, profileAuthorityId, 6),
    { force: true }
  );
  const migratedProfileManifest = await readManifest(profileDirectory);
  assert.equal(migratedProfileManifest.previousCheckpoint.producerProfile, profileV2['xterm-serialize-v1']);
  assert.ok(migratedProfileManifest.retainedStartRevision > 1);
  await writeFile(
    path.join(profileDirectory, migratedProfileManifest.currentCheckpoint.file),
    '{"corrupt":true}\n',
    'utf8'
  );
  const migratedProfileJournal = await TerminalSessionJournal.open({
    storageDir,
    sessionId: profileSessionId,
    authorityId: profileAuthorityId,
    segmentMaxBytes: 420,
    checkpointProfiles: profileV2
  });
  const migratedProfileFallback = await migratedProfileJournal.getRecoveryCandidates();
  assert.deepEqual(migratedProfileFallback.map((candidate) => candidate.source), ['previous']);
  assert.deepEqual(migratedProfileFallback[0].events.map((event) => event.revision), [5, 6]);

  const profileV3 = { 'xterm-serialize-v1': 'test-producer-profile-v3' };
  const incompatibleCompactedProfileJournal = await TerminalSessionJournal.open({
    storageDir,
    sessionId: profileSessionId,
    authorityId: profileAuthorityId,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles: profileV3
  });
  incompatibleCompactedProfileJournal.appendOutput('profile-7\r\n');
  incompatibleCompactedProfileJournal.appendOutput('profile-8\r\n');
  await incompatibleCompactedProfileJournal.flush();
  const incompatibleProfileManifestBefore = await readManifest(profileDirectory);
  assert.deepEqual(
    await incompatibleCompactedProfileJournal.commitCheckpoint(
      createCheckpoint(profileSessionId, profileAuthorityId, 8),
      { force: true }
    ),
    {
      committed: false,
      compactedBytes: 0,
      compactedSegments: 0,
      retainedStartRevision: incompatibleProfileManifestBefore.retainedStartRevision,
      reason: 'no-usable-fallback'
    },
    'a profile migration must not reset generations after the genesis prefix has been compacted.'
  );
  incompatibleCompactedProfileJournal.appendOutput('profile-9\r\n');
  await incompatibleCompactedProfileJournal.flush();
  const incompatibleProfileManifestAfter = await readManifest(profileDirectory);
  assert.equal(
    incompatibleProfileManifestAfter.currentCheckpoint.file,
    incompatibleProfileManifestBefore.currentCheckpoint.file
  );
  assert.equal(
    incompatibleProfileManifestAfter.previousCheckpoint.file,
    incompatibleProfileManifestBefore.previousCheckpoint.file
  );
  assert.equal(
    incompatibleProfileManifestAfter.retainedStartRevision,
    incompatibleProfileManifestBefore.retainedStartRevision
  );
  const preservedProfileFallbackJournal = await TerminalSessionJournal.open({
    storageDir,
    sessionId: profileSessionId,
    authorityId: profileAuthorityId,
    segmentMaxBytes: 420,
    checkpointProfiles: profileV2
  });
  const preservedProfileFallback = await preservedProfileFallbackJournal.getRecoveryCandidates();
  assert.deepEqual(preservedProfileFallback.map((candidate) => candidate.source), ['previous']);
  assert.deepEqual(
    preservedProfileFallback[0].events.map((event) => event.revision),
    [5, 6, 7, 8, 9],
    'a rejected profile migration must keep appending to the retained lossless journal.'
  );

  const emptyTailSessionId = 'journal-empty-sealed-tail-session';
  const emptyTailAuthorityId = 'journal-empty-sealed-tail-authority';
  const emptyTailJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: emptyTailSessionId,
    authorityId: emptyTailAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  emptyTailJournal.appendOutput('empty-tail-1\r\n');
  await emptyTailJournal.flush();
  await generationFallbackCommit(emptyTailJournal, emptyTailSessionId, emptyTailAuthorityId, 1);
  const emptyTailDirectory = resolveTerminalJournalSessionDirectory(storageDir, emptyTailSessionId);
  const manifestAtEmptyTailCheckpoint = await readFile(path.join(emptyTailDirectory, 'manifest.json'), 'utf8');
  emptyTailJournal.appendOutput('incomplete-empty-tail-2\r\n');
  await emptyTailJournal.flush();
  await writeFile(path.join(emptyTailDirectory, 'manifest.json'), manifestAtEmptyTailCheckpoint, 'utf8');
  const emptyTailFiles = (await readdir(emptyTailDirectory)).filter((file) => file.endsWith('.ndjson')).sort();
  const emptyTailPath = path.join(emptyTailDirectory, emptyTailFiles.at(-1));
  const emptyTailRecord = await readFile(emptyTailPath);
  await writeFile(emptyTailPath, emptyTailRecord.subarray(0, 5));
  const repairedEmptyTail = await TerminalSessionJournal.open({
    storageDir,
    sessionId: emptyTailSessionId,
    authorityId: emptyTailAuthorityId,
    segmentMaxBytes: 420,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  assert.equal(repairedEmptyTail.getRevision(), 1);
  repairedEmptyTail.appendOutput('replacement-empty-tail-2\r\n');
  await repairedEmptyTail.flush();
  assert.deepEqual(
    (await repairedEmptyTail.readAllEvents()).map((event) => event.revision),
    [1, 2],
    'an empty repaired suffix segment must be reused instead of creating a duplicate segment name.'
  );

  const orphanSessionId = 'journal-pre-manifest-orphan-session';
  const orphanAuthorityId = 'journal-pre-manifest-orphan-authority';
  const orphanJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: orphanSessionId,
    authorityId: orphanAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  orphanJournal.appendOutput('orphan-safe\r\n');
  await orphanJournal.flush();
  const orphanDirectory = resolveTerminalJournalSessionDirectory(storageDir, orphanSessionId);
  const originalRename = fs.promises.rename;
  let rejectedManifestRename = false;
  fs.promises.rename = async (oldPath, newPath) => {
    if (!rejectedManifestRename && newPath === path.join(orphanDirectory, 'manifest.json')) {
      rejectedManifestRename = true;
      throw new Error('injected manifest rename failure');
    }
    return originalRename(oldPath, newPath);
  };
  try {
    await assert.rejects(
      generationFallbackCommit(orphanJournal, orphanSessionId, orphanAuthorityId, 1),
      /injected manifest rename failure/u
    );
  } finally {
    fs.promises.rename = originalRename;
  }
  assert.equal(rejectedManifestRename, true);
  assert.equal(
    (await readdir(orphanDirectory)).filter((file) => file.startsWith('checkpoint-')).length,
    1,
    'a checkpoint completed before manifest rename should remain only as an orphan.'
  );
  const reopenedV1WithOrphan = await TerminalSessionJournal.open({
    storageDir,
    sessionId: orphanSessionId,
    authorityId: orphanAuthorityId,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  assert.deepEqual(
    (await reopenedV1WithOrphan.getRecoveryCandidates()).map((candidate) => candidate.source),
    ['genesis'],
    'a checkpoint orphan created before manifest rename must not become authoritative.'
  );

  const boundarySessionId = 'journal-whole-segment-boundary-session';
  const boundaryAuthorityId = 'journal-whole-segment-boundary-authority';
  const boundaryJournal = await TerminalSessionJournal.create({
    storageDir,
    sessionId: boundarySessionId,
    authorityId: boundaryAuthorityId,
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000,
    segmentMaxBytes: 1200,
    compactionMinBytes: 0,
    checkpointProfiles
  });
  for (let revision = 1; revision <= 8; revision += 1) {
    boundaryJournal.appendOutput(`boundary-${revision}\r\n`);
  }
  await boundaryJournal.flush();
  await generationFallbackCommit(boundaryJournal, boundarySessionId, boundaryAuthorityId, 8);
  const boundaryDirectory = resolveTerminalJournalSessionDirectory(storageDir, boundarySessionId);
  const boundaryManifestBefore = await readManifest(boundaryDirectory);
  const multiRecordSegment = boundaryManifestBefore.segments.find((segment) => segment.recordCount > 1);
  assert.ok(multiRecordSegment, 'the boundary test needs a segment containing multiple records.');
  const multiRecordBytes = await readFile(path.join(boundaryDirectory, multiRecordSegment.file));
  boundaryJournal.appendOutput('boundary-9\r\n');
  await boundaryJournal.flush();
  await boundaryJournal.commitCheckpoint(
    createCheckpoint(boundarySessionId, boundaryAuthorityId, 9),
    { force: true, retainAfterRevision: multiRecordSegment.startRevision }
  );
  const boundaryManifestAfter = await readManifest(boundaryDirectory);
  assert.equal(
    boundaryManifestAfter.retainedStartRevision,
    multiRecordSegment.startRevision,
    'retention inside a segment must keep that segment from its original start revision.'
  );
  assert.deepEqual(
    await readFile(path.join(boundaryDirectory, multiRecordSegment.file)),
    multiRecordBytes,
    'compaction must never truncate a retained segment in the middle of a record chain.'
  );

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
