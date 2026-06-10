import assert from 'node:assert/strict';

import {
  countClaudeCodeSuspendOutputs,
  detectNewClaudeCodeSuspendOutput,
  isClaudeCodeSuspendOutput
} from '../../src/common/agentSuspendSignals.ts';

const plainSuspendOutput = 'Claude Code has been suspended. Run `fg` to bring Claude Code back.';
assert.equal(isClaudeCodeSuspendOutput(plainSuspendOutput), true);
assert.equal(countClaudeCodeSuspendOutputs(plainSuspendOutput), 1);

const ansiSuspendOutput = '\x1b[31mClaude Code has been suspended.\x1b[0m\r\nRun `fg` to bring Claude Code back.';
assert.equal(isClaudeCodeSuspendOutput(ansiSuspendOutput), true);
assert.equal(countClaudeCodeSuspendOutputs(`${plainSuspendOutput}\n${ansiSuspendOutput}`), 2);

assert.equal(
  isClaudeCodeSuspendOutput('Run `fg` to bring a shell job back.'),
  false,
  'Do not treat a generic shell job-control hint as a Claude Code suspend signal.'
);
assert.equal(
  isClaudeCodeSuspendOutput('Claude Code has been suspended.'),
  false,
  'Require the matching fg recovery hint so incidental text does not create a suspended state.'
);

assert.deepEqual(detectNewClaudeCodeSuspendOutput(plainSuspendOutput, 0, plainSuspendOutput), {
  detected: true,
  nextSeenCount: 1
});
assert.deepEqual(detectNewClaudeCodeSuspendOutput(plainSuspendOutput, 1, 'ordinary Claude output'), {
  detected: false,
  nextSeenCount: 1
});
assert.deepEqual(detectNewClaudeCodeSuspendOutput('new tail without old marker', 1, plainSuspendOutput), {
  detected: true,
  nextSeenCount: 0
});
assert.deepEqual(
  detectNewClaudeCodeSuspendOutput(
    'Claude Code has been suspended. Run `fg` to bring Claude Code back.',
    1,
    ' Run `fg` to bring Claude Code back.',
    'Claude Code has been suspended.'
  ),
  {
    detected: true,
    nextSeenCount: 1
  }
);
assert.deepEqual(detectNewClaudeCodeSuspendOutput('new tail without marker', 1, 'ordinary Claude output'), {
  detected: false,
  nextSeenCount: 0
});

console.log('agent suspend signal tests passed');
