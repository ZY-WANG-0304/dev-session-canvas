// Run with Node 22 from the repository root. No product or formal tests are edited.
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const original = await readFile('scripts/test/test-host-execution-owner-wiring.mjs', 'utf8');
const anchor = 'const testNameFilter = process.env.DEV_SESSION_CANVAS_HOST_TEST_FILTER;';
assert.equal(original.split(anchor).length, 2);
const cases = String.raw`
for (const kind of ['agent', 'terminal']) {
  for (const mode of ['probe', 'control']) {
    for (const outcome of ['saved', 'failed']) {
      test('delete persistence RCA ' + kind + ' ' + mode + ' ' + outcome, async () => {
        const f = await persistenceFixture({ candidate: true });
        const gate = deferred();
        const messages = [];
        const originalUpdate = f.host.context.workspaceState.update;
        f.host.context.workspaceState.update = async (...args) => {
          await gate.promise;
          if (outcome === 'failed') throw new Error('controlled original save failure');
          return originalUpdate(...args);
        };
        f.host.postMessage = message => messages.push(message);
        f.host.reconcileCanvasFileArtifacts = state => state;
        const { record, provider } = await f.started(kind);
        const id = record.nodeId;
        const stop = record.execution.requestStop.bind(record.execution);
        if (mode === 'control') record.execution.requestStop = async reason => {
          const result = await stop(reason);
          if (reason === 'host-delete' && result.kind === 'settled') await f.host.waitForNonNativeHostPersistence([record]);
          return result;
        };
        let deletionReturned = false;
        const deletion = f.host.deleteNode(id).then(() => { deletionReturned = true; });
        try {
          await until(f.clock, () => provider.messages.some(message => message.type === 'requestStop'), 'original delete stop');
          provider.process();
          provider.message({ type: 'resourceResult', resourceId: 'subject', operationId: 'subject-release', result: { kind: 'released' } });
          provider.seal(0); provider.release();
          await until(f.clock, () => record.execution.snapshot().retired && record.persistence.submitted, 'owner closed while original write held');
          assert.equal(record.persistence.result, undefined);
          assert.ok(f.host.state.nodes.some(node => node.id === id));
          if (mode === 'probe') {
            await completed(f.clock, deletion, 'premature original delete return');
            assert.match(messages.at(-1).payload.message, /persistence is pending/);
          } else {
            assert.equal(deletionReturned, false);
            assert.ok(!messages.some(message => message.type === 'host/error'));
          }
          gate.resolve();
          await until(f.clock, () => record.persistence.result !== undefined, 'original save outcome');
          assert.equal(record.persistence.result.kind, outcome);
          await completed(f.clock, deletion, 'delete after controlled write');
          assert.equal(f.host.state.nodes.some(node => node.id === id), !(mode === 'control' && outcome === 'saved'));
          if (mode === 'control' && outcome === 'failed') assert.match(messages.at(-1).payload.message, /persistence is failed/);
          if (mode === 'probe' && outcome === 'saved') {
            await completed(f.clock, f.host.deleteNode(id), 'explicit second delete after original save');
            assert.ok(!f.host.state.nodes.some(node => node.id === id));
          }
        } finally { gate.resolve(); record.tracker.dispose(); await f.cleanup(); }
      });
    }
  }
}
`;
const filename = 'scripts/test/.owned-delete-investigation-' + process.pid + '.mjs';
try {
  await writeFile(filename, original.replace(anchor, cases + '\n' + anchor));
  const result = spawnSync(process.execPath, [filename], {
    stdio: 'inherit', env: { ...process.env, DEV_SESSION_CANVAS_HOST_TEST_FILTER: '^delete persistence RCA ' }
  });
  assert.equal(result.status, 0, 'All controlled investigation cases must match their expected outcomes.');
} finally { await unlink(filename); }
