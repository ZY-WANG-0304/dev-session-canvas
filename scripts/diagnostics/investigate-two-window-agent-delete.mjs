import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Reuse the actual Supervisor and guarded non-native owner fixture without changing product code.
const fixturePath = 'scripts/test/test-supervisor-execution-owner-wiring.mjs';
let source = await readFile(fixturePath, 'utf8');
const checkAnchor = 'async function check(name, run) {\n';
const runAnchor = '\ntry {\n';
if (!source.includes(checkAnchor) || !source.includes(runAnchor)) {
  throw new Error('Supervisor fixture anchors changed; review the diagnostic adapter.');
}
source = source.replace(checkAnchor, `${checkAnchor}  if (!name.startsWith('delete investigation:')) return;\n`);
source = source.replace(runAnchor, `${runAnchor}${String.raw`
  for (const kind of ['agent', 'terminal']) {
    for (const mode of ['direct-credit', 'direct-paged', 'stopped-preserving-credit', 'direct-credit-retained-probe']) {
      await check('delete investigation: ' + kind + ' / ' + mode, async () => {
        const f = fixture(readerCapabilities);
        const { session, transport } = await f.create(kind);
        const owner = f.addSocket();
        const cancelHostOutput = f.server.cancelHostOutput.bind(f.server);
        if (mode === 'direct-credit-retained-probe') {
          // Diagnostic intervention only: retain the other socket's Host delivery path.
          f.server.cancelHostOutput = subscription => {
            if (subscription.socket !== owner) cancelHostOutput(subscription);
          };
        }
        const credit = mode !== 'direct-paged';
        const read = await openReader(f, session, 'editor', owner);
        const subscribed = await request(f, owner, 'subscribeSession', {
          sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
          afterRevision: 0, terminalStreamMode: 'paged-until-exit',
          ...(credit ? { hostOutputCredit: 'journal-pages-v1' } : {})
        });
        assert.equal(subscribed.ok, true, JSON.stringify(subscribed));
        async function acknowledge() {
          const batch = f.server.hostOutputSubscriptions.get(owner)?.get(session.sessionId)?.inFlight;
          if (!batch) return;
          const payload = owner.messages.find(message => message.event === 'sessionTerminalBatch' &&
            message.payload.batchId === batch.batchId).payload;
          assert.equal((await request(f, owner, 'ackTerminalBatch', {
            ...payload, outcome: 'consumed'
          })).ok, true);
        }
        await f.pump();
        await acknowledge();
        transport.output('shared owner tail');
        await f.until(() => session.terminalJournal.getRevision() === 1, 'tail journaled');
        await f.pump();
        await acknowledge();
        const before = owner.messages.length;
        let deleting;
        if (mode === 'stopped-preserving-credit') {
          await f.server.stopSession({ sessionId: session.sessionId });
          await finish(f, session, transport);
          const page = await request(f, owner, 'readTerminalPage', { ...read, afterRevision: 0 });
          assert.equal(page.ok, true);
          assertSettlement(await closeReader(f, read, { kind: 'applied', finalRevision: 1 }, owner), 'recorded');
          await f.until(() => owner.messages.slice(before).some(message =>
            message.event === 'sessionTerminalBatch' && message.payload.snapshot?.live === false), 'final owner batch');
          deleting = request(f, f.socket, 'deleteSession', { sessionId: session.sessionId, preserveTerminalReads: true });
          assert.equal((await deleting).ok, true);
          await acknowledge();
        } else {
          deleting = request(f, f.socket, 'deleteSession', { sessionId: session.sessionId });
          await f.until(() => transport.sent.some(message => message.type === 'requestStop'), 'delete stop request');
          await finish(f, session, transport);
          assert.equal((await deleting).ok, true);
          if (mode === 'direct-credit-retained-probe') {
            await f.until(() => owner.messages.slice(before).some(message =>
              message.event === 'sessionTerminalBatch' && message.payload.snapshot?.live === false), 'retained owner final batch');
            f.server.cancelHostOutput = cancelHostOutput;
            await acknowledge();
          }
        }
        await f.until(() => !f.server.sessions.has(session.sessionId), 'physical retirement');
        await f.pump();
        const finalEvents = owner.messages.slice(before).filter(message =>
          (message.event === 'sessionState' && message.payload.live === false) ||
          (message.event === 'sessionTerminalBatch' && message.payload.snapshot?.live === false));
        const finalCount = finalEvents.length;
        assert.equal(finalCount, mode === 'direct-credit' ? 0 : 1);
        assert.equal(session.live, false);
        assert.equal(session.lifecycle, kind === 'agent' ? 'stopped' : 'closed');
        console.log(JSON.stringify({ kind, mode, deleteAcknowledged: true, sessionRemoved: true,
          supervisorLifecycle: session.lifecycle, ownerFinalEvents: finalCount,
          ownerSubscriptionPresent: f.server.subscriptions.get(owner)?.has(session.sessionId) ?? false,
          readerCancelled: session.ownedReaderResults.cancelled,
          readerApplied: session.ownedReaderResults.applied }));
      });
    }
  }
`}`);
const directory = await mkdtemp(path.resolve('.delete-investigation-'));
try {
  const filename = path.join(directory, 'probe.mjs');
  await writeFile(filename, source);
  const result = spawnSync(process.execPath, [filename], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
