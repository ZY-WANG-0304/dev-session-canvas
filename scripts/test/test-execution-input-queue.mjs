import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-input-queue-'));

try {
  const outfile = path.join(tempDir, 'executionInputQueue.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/executionInputQueue.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { ExecutionInputQueue } = require(outfile);
  const queue = new ExecutionInputQueue();
  const writes = Array.from({ length: 128 }, (_value, index) => `input-${String(index).padStart(3, '0')}`);
  const completedWrites = [];
  let maxInFlight = 0;
  let maxPending = 0;

  const results = await Promise.all(writes.map((write, index) => queue.enqueue(async (state) => {
    maxInFlight = Math.max(maxInFlight, state.inFlightCount);
    maxPending = Math.max(maxPending, state.pendingCount);
    await delay(index % 3);
    completedWrites.push(write);
    return write;
  })));
  assert.deepEqual(results, writes, 'each caller should receive its own ordered write result.');
  assert.deepEqual(completedWrites, writes, 'rapid input must reach the PTY in exact submission order.');
  assert.equal(maxInFlight, 1, 'a session must have at most one in-flight input write.');
  assert.ok(maxPending > 1, 'the test must exercise queued input rather than serial submission.');
  assert.equal(queue.getPendingCount(), 0);
  assert.equal(queue.getInFlightCount(), 0);

  const recoveryQueue = new ExecutionInputQueue();
  const recoveryOrder = [];
  const rejected = recoveryQueue.enqueue(() => {
    throw new Error('intentional input write failure');
  });
  const next = recoveryQueue.enqueue(() => {
    recoveryOrder.push('next-input');
    return 'next-input';
  });
  await assert.rejects(rejected, /intentional input write failure/u);
  assert.equal(await next, 'next-input', 'a failed input must not block the next queued control byte.');
  assert.deepEqual(recoveryOrder, ['next-input']);
  assert.equal(recoveryQueue.getPendingCount(), 0);
  assert.equal(recoveryQueue.getInFlightCount(), 0);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
