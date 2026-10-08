const assert = require('node:assert/strict');

// The caller freezes the expected nodes: no restart or ID reuse during cleanup.
async function resetCanvasAfterFinalPersistence({
  reset, getSnapshot, getDiagnosticEvents, expectedExecutions, timeoutMs = 20000,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const deadline = now() + timeoutMs;
  const checkDeadline = () => assert.ok(now() < deadline, 'Timed out completing reset and final persistence.');
  const nodeKeys = snapshot => snapshot.state.nodes.map(node => `${node.kind}:${node.id}`).sort();
  const expectedKeys = expectedExecutions.map(node => `${node.kind}:${node.id}`);
  const before = nodeKeys(await getSnapshot());
  const previousResults = await getDiagnosticEvents();
  let pendingKey;
  let pendingError;
  checkDeadline();
  try {
    await reset();
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0].replace(/^Error: /, '');
    const match = /^Local final snapshot persistence is pending: ((?:agent|terminal):\S+)$/.exec(message);
    if (!match || !expectedKeys.includes(match[1])) throw error;
    pendingKey = match[1];
    pendingError = error;
    console.log(`[reset-fixture] Rejected while final persistence is pending for ${match[1]}.`);
  }
  checkDeadline();
  if (pendingError) {
    // A result observed before a pending rejection cannot belong to that pending save.
    const previousIdentities = new Set(previousResults.filter(event => event.kind === 'execution/localFinalPersistence'
      && `${event.detail?.kind}:${event.detail?.nodeId}` === pendingKey)
      .map(event => `${event.detail.executionId}:${event.detail.generation}`));
    assert.deepEqual(nodeKeys(await getSnapshot()), before, 'Pending reset must preserve the original nodes.');
    for (;;) {
      checkDeadline();
      const events = await getDiagnosticEvents();
      const settlements = [];
      let complete = true;
      for (const key of expectedKeys) {
        const results = events.filter(event => event.kind === 'execution/localFinalPersistence'
          && `${event.detail?.kind}:${event.detail?.nodeId}` === key
          && (key !== pendingKey || !previousIdentities.has(`${event.detail.executionId}:${event.detail.generation}`)))
          .map(event => event.detail);
        const identities = new Set(results.map(detail => `${detail.executionId}:${detail.generation}`));
        assert.ok(identities.size <= 1, `Conflicting final persistence identities for ${key}.`);
        if (results.length === 0) { complete = false; continue; }
        for (const detail of results) {
          assert.ok(typeof detail.executionId === 'string' && detail.executionId.length > 0
            && typeof detail.generation === 'string' && detail.generation.length > 0,
          `Missing final persistence identity for ${key}.`);
          assert.ok(detail.result?.kind === 'saved' || detail.result?.kind === 'not-required',
            `Final persistence did not succeed for ${key}: ${JSON.stringify(detail.result)}`);
          assert.equal(detail.submitted, detail.result.kind === 'saved', `Invalid final persistence submission for ${key}.`);
          settlements.push(detail);
        }
      }
      checkDeadline();
      if (complete) {
        console.log(`[reset-fixture] Original final persistence settled: ${JSON.stringify(settlements)}`);
        break;
      }
      await sleep(Math.min(100, deadline - now()));
    }
    assert.deepEqual(nodeKeys(await getSnapshot()), before, 'Final persistence must not replace the pending reset nodes.');
    checkDeadline();
    // One new operation, authorized by all original saves. Any second failure is terminal.
    await reset();
  }
  const snapshot = await getSnapshot();
  checkDeadline();
  assert.equal(snapshot.state.nodes.length, 0, 'A completed reset must leave an empty canvas.');
  console.log(`[reset-fixture] Empty canvas confirmed after ${pendingError ? 2 : 1} reset call(s).`);
  return snapshot;
}

module.exports = { resetCanvasAfterFinalPersistence };
