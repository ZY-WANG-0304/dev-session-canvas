import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-attention-signals-'));

try {
  const signalsOutfile = path.join(tempDir, 'executionAttentionSignals.cjs');
  const heuristicsOutfile = path.join(tempDir, 'agentActivityHeuristics.cjs');

  await esbuild.build({
    entryPoints: [path.resolve('src/common/executionAttentionSignals.ts')],
    bundle: true,
    format: 'cjs',
    outfile: signalsOutfile,
    platform: 'node',
    target: 'node18'
  });
  await esbuild.build({
    entryPoints: [path.resolve('src/common/agentActivityHeuristics.ts')],
    bundle: true,
    format: 'cjs',
    outfile: heuristicsOutfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    createExecutionAttentionSignalState,
    filterEnabledExecutionAttentionSignals,
    isExecutionAttentionSignalEnabled,
    normalizeEnabledExecutionAttentionSignalKinds,
    parseExecutionAttentionSignals
  } = require(signalsOutfile);
  const {
    createAgentActivityHeuristicState,
    extractAgentAbnormalStreamInterruptionMessage,
    recordAgentOutputHeuristics,
    resetAgentAbnormalStreamInterruptionHeuristics,
    resetAgentActivityHeuristics,
    normalizeAgentAbnormalStreamInterruptionSignature
  } = require(heuristicsOutfile);

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

  assert.deepEqual(
    normalizeEnabledExecutionAttentionSignalKinds(undefined),
    ['bel', 'osc9', 'osc777', 'agentAbnormalExit', 'codexAbnormalOutputText'],
    'Missing enabled attention signal config should preserve the default signal set.'
  );
  assert.deepEqual(
    normalizeEnabledExecutionAttentionSignalKinds([
      'codexAbnormalOutputText',
      'osc9',
      'invalid',
      'osc9',
      'bel',
      'agentAbnormalExit'
    ]),
    ['bel', 'osc9', 'agentAbnormalExit', 'codexAbnormalOutputText'],
    'Configured attention signals should ignore invalid entries, dedupe values, and keep stable order.'
  );
  assert.deepEqual(
    normalizeEnabledExecutionAttentionSignalKinds([]),
    [],
    'An empty enabled attention signal config should disable all attention.'
  );
  assert.deepEqual(
    filterEnabledExecutionAttentionSignals(
      [...bell.signals, ...osc9.signals, ...osc777.signals],
      ['osc9', 'osc777']
    ).map((signal) => signal.kind),
    ['osc9', 'osc777'],
    'Disabled BEL signals should be removed before product attention is generated.'
  );
  assert.equal(
    isExecutionAttentionSignalEnabled(['agentAbnormalExit'], 'agentAbnormalExit'),
    true,
    'Agent abnormal-exit attention should be configurable by the shared allow-list.'
  );
  assert.equal(
    isExecutionAttentionSignalEnabled(['agentAbnormalExit'], 'codexAbnormalOutputText'),
    false,
    'Codex abnormal text attention should be suppressible independently from Agent abnormal exits.'
  );

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

  const codexStreamInterruption = extractAgentAbnormalStreamInterruptionMessage(
    'Read README.md\n■ stream disconnected before completion: stream closed before response.completed\n'
  );
  assert.equal(
    codexStreamInterruption,
    '■ stream disconnected before completion: stream closed before response.completed'
  );
  assert.equal(
    normalizeAgentAbnormalStreamInterruptionSignature(codexStreamInterruption),
    '■ stream disconnected before completion: stream closed before response.completed'
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      'Claude stream disconnected before completion.\n',
      'claude'
    ),
    undefined
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      'stream disconnected before completion\n',
      'codex'
    ),
    undefined
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      'stream closed before response.completed\n',
      'codex'
    ),
    undefined
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      'connection closed before completion\n',
      'codex'
    ),
    undefined
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      'Claude stream finished normally.\nevent: message_stop\ndata: {"type":"message_stop"}\n'
    ),
    undefined
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage('normal provider output\n> '),
    undefined
  );

  const heuristicState = createAgentActivityHeuristicState();
  const staleStreamLine =
    'Read README.md\n■ stream disconnected before completion: stream closed before response.completed\n';
  const firstStreamSnapshot = recordAgentOutputHeuristics(
    heuristicState,
    staleStreamLine,
    staleStreamLine,
    'codex',
    100
  );
  assert.equal(firstStreamSnapshot.sawAbnormalStreamInterruption, true);
  resetAgentActivityHeuristics(heuristicState, staleStreamLine);
  const staleBufferWithNextTurn = `${staleStreamLine}> next prompt\n`;
  const nextTurnSnapshot = recordAgentOutputHeuristics(
    heuristicState,
    '> next prompt\n',
    staleBufferWithNextTurn,
    'codex',
    200
  );
  assert.equal(nextTurnSnapshot.sawAbnormalStreamInterruption, false);

  const attachedSupervisorState = createAgentActivityHeuristicState();
  resetAgentAbnormalStreamInterruptionHeuristics(attachedSupervisorState, staleStreamLine);
  const supervisorAttachSnapshot = recordAgentOutputHeuristics(
    attachedSupervisorState,
    '> resumed output\n',
    `${staleStreamLine}> resumed output\n`,
    'codex',
    300
  );
  assert.equal(supervisorAttachSnapshot.sawAbnormalStreamInterruption, false);

  console.log('executionAttentionSignals tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
