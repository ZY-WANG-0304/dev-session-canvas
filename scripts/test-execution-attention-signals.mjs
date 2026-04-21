import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-attention-signals-'));

try {
  const outfile = path.join(tempDir, 'executionAttentionSignals.cjs');

  await esbuild.build({
    entryPoints: [path.resolve('src/common/executionAttentionSignals.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    createExecutionAttentionSignalState,
    parseExecutionAttentionSignals
  } = require(outfile);

  const osc9 = parseExecutionAttentionSignals('\u001b]9;Build finished\u0007');
  assert.equal(osc9.notificationCount, 1);
  assert.equal(osc9.bellCount, 0);
  assert.deepEqual(osc9.signals, [
    {
      kind: 'osc9',
      rawMessage: 'Build finished',
      message: 'Build finished',
      presentation: 'notify'
    }
  ]);

  const osc777 = parseExecutionAttentionSignals('\u001b]777;notify;Need approval;Return to VS Code\u0007');
  assert.equal(osc777.notificationCount, 1);
  assert.deepEqual(osc777.signals, [
    {
      kind: 'osc777',
      rawMessage: 'notify;Need approval;Return to VS Code',
      message: 'Need approval - Return to VS Code',
      presentation: 'notify'
    }
  ]);

  const bell = parseExecutionAttentionSignals('\u0007');
  assert.equal(bell.notificationCount, 0);
  assert.equal(bell.bellCount, 1);
  assert.deepEqual(bell.signals, [
    {
      kind: 'bel',
      presentation: 'notify'
    }
  ]);

  const osc9Progress = parseExecutionAttentionSignals('\u001b]9;4;1;25\u0007');
  assert.equal(osc9Progress.notificationCount, 1);
  assert.equal(osc9Progress.signals[0].kind, 'osc9');
  assert.equal(osc9Progress.signals[0].presentation, 'ignore');

  const carryState = createExecutionAttentionSignalState();
  const firstHalf = parseExecutionAttentionSignals('\u001b]9;Need', carryState.carryover);
  carryState.carryover = firstHalf.carryover;
  assert.equal(firstHalf.notificationCount, 0);
  assert.equal(firstHalf.signals.length, 0);
  assert.notEqual(carryState.carryover, '');

  const secondHalf = parseExecutionAttentionSignals(' approval\u0007', carryState.carryover);
  carryState.carryover = secondHalf.carryover;
  assert.equal(secondHalf.notificationCount, 1);
  assert.deepEqual(secondHalf.signals, [
    {
      kind: 'osc9',
      rawMessage: 'Need approval',
      message: 'Need approval',
      presentation: 'notify'
    }
  ]);
  assert.equal(carryState.carryover, '');

  console.log('executionAttentionSignals tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
