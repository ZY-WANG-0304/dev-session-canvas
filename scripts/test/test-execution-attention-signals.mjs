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
    '■ stream disconnected before completion: stream closed before response.completed',
    'A Codex square-marker stream-disconnected line at the output tail should be classified as final failure text.'
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
      'Reconnecting... 1/5 (23m 57s · esc to interrupt)\n└ Stream disconnected before completion: stream closed before response.completed\n',
      'codex'
    ),
    undefined
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      '■ stream disconnected before completion: stream closed before response.completed\nstill running\n',
      'codex'
    ),
    undefined,
    'A square-marker final error line should not notify if later non-prompt output follows it.'
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      '■ {"error":{"message":"Internal server error"}}\n› Write tests for @filename\n',
      'codex'
    ),
    '■ {"error":{"message":"Internal server error"}}',
    'A tail prompt after the square-marker error is part of the Codex input area and should not hide the final error.'
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      '■ stream disconnected before completion: stream closed before response.completed\n›继续\ngpt-5.4 xhigh · ~/ZeroInput\n',
      'codex'
    ),
    '■ stream disconnected before completion: stream closed before response.completed',
    'Codex prompt text without a separating space and the TUI footer should not hide the final stream error.'
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
      '■ {"error":{"message":"Internal server error"}}\n',
      'codex'
    ),
    '■ {"error":{"message":"Internal server error"}}'
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      '{"error":{"message":"Internal server error"}}\n',
      'codex'
    ),
    undefined,
    'A Codex final error text must use the TUI square-marker style.'
  );
  assert.equal(
    normalizeAgentAbnormalStreamInterruptionSignature('■ {"error":{"message":"Internal server error"}}'),
    '■ {"error":{"message":"internal server error"}}'
  );
  assert.equal(
    extractAgentAbnormalStreamInterruptionMessage(
      '■ {"error":{"message":"Internal server error"}}\n',
      'claude'
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
  const finalStreamLine =
    'Read README.md\n■ stream disconnected before completion: stream closed before response.completed\n';
  const firstStreamSnapshot = recordAgentOutputHeuristics(
    heuristicState,
    finalStreamLine,
    finalStreamLine,
    'codex',
    100
  );
  assert.equal(
    firstStreamSnapshot.sawAbnormalStreamInterruption,
    true,
    'A square-marker Codex stream-disconnected line at the tail should notify as final failure text.'
  );

  const nonTailStreamState = createAgentActivityHeuristicState();
  const nonTailStreamOutput = `${finalStreamLine}still running\n`;
  const nonTailStreamSnapshot = recordAgentOutputHeuristics(
    nonTailStreamState,
    nonTailStreamOutput,
    nonTailStreamOutput,
    'codex',
    125
  );
  assert.equal(
    nonTailStreamSnapshot.sawAbnormalStreamInterruption,
    false,
    'A square-marker Codex stream-disconnected line should not notify once non-prompt output follows it.'
  );

  const codexChromeTailState = createAgentActivityHeuristicState();
  const codexChromeTailOutput = `${finalStreamLine}›继续\ngpt-5.4 xhigh · ~/ZeroInput\n`;
  const codexChromeTailSnapshot = recordAgentOutputHeuristics(
    codexChromeTailState,
    codexChromeTailOutput,
    codexChromeTailOutput,
    'codex',
    150
  );
  assert.equal(
    codexChromeTailSnapshot.sawAbnormalStreamInterruption,
    true,
    'Codex input prompt text and footer chrome after the final error should still notify.'
  );

  const reconnectingStreamState = createAgentActivityHeuristicState();
  const reconnectingStreamChunk =
    'Reconnecting... 1/5 (23m 57s · esc to interrupt)\n└ Stream disconnected before completion: stream closed before response.completed\n';
  const reconnectingStreamSnapshot = recordAgentOutputHeuristics(
    reconnectingStreamState,
    reconnectingStreamChunk,
    reconnectingStreamChunk,
    'codex',
    175
  );
  assert.equal(
    reconnectingStreamSnapshot.sawAbnormalStreamInterruption,
    false,
    'Codex Reconnecting tree output should be treated as still-running retry progress, not a final failure.'
  );
  resetAgentActivityHeuristics(heuristicState, finalStreamLine);
  const staleBufferWithNextTurn = `${finalStreamLine}> next prompt\n`;
  const nextTurnSnapshot = recordAgentOutputHeuristics(
    heuristicState,
    '> next prompt\n',
    staleBufferWithNextTurn,
    'codex',
    200
  );
  assert.equal(nextTurnSnapshot.sawAbnormalStreamInterruption, false);

  const attachedSupervisorState = createAgentActivityHeuristicState();
  resetAgentAbnormalStreamInterruptionHeuristics(attachedSupervisorState, finalStreamLine);
  const supervisorAttachSnapshot = recordAgentOutputHeuristics(
    attachedSupervisorState,
    '> resumed output\n',
    `${finalStreamLine}> resumed output\n`,
    'codex',
    300
  );
  assert.equal(supervisorAttachSnapshot.sawAbnormalStreamInterruption, false);

  const internalServerState = createAgentActivityHeuristicState();
  const internalServerLine = '■ {"error":{"message":"Internal server error"}}\n';
  const internalServerSnapshot = recordAgentOutputHeuristics(
    internalServerState,
    internalServerLine,
    internalServerLine,
    'codex',
    400
  );
  assert.equal(
    internalServerSnapshot.sawAbnormalStreamInterruption,
    true,
    'A Codex internal-server-error JSON line should notify as a final abnormal output style.'
  );

  console.log('executionAttentionSignals tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
