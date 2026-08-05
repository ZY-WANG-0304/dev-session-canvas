import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-terminal-title-'));

try {
  const titleOutfile = path.join(tempDir, 'agentTerminalTitleActivity.cjs');
  const heuristicOutfile = path.join(tempDir, 'agentActivityHeuristics.cjs');
  const lifecycleOutfile = path.join(tempDir, 'agentProviderLifecycle.cjs');
  await Promise.all([
    bundle('extensions/vscode/dev-session-canvas/src/common/agentTerminalTitleActivity.ts', titleOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts', heuristicOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/common/agentProviderLifecycle.ts', lifecycleOutfile)
  ]);

  const require = createRequire(import.meta.url);
  const {
    AGENT_TERMINAL_TITLE_FRAME_GAP_MS,
    createAgentTerminalTitleActivityState,
    parseAgentTerminalTitles,
    recordAgentTerminalTitleActivity
  } = require(titleOutfile);
  const {
    AGENT_WAITING_INPUT_QUIET_FALLBACK_MS,
    createAgentActivityHeuristicState,
    evaluateAgentWaitingInputTransition,
    recordAgentOutputHeuristics
  } = require(heuristicOutfile);
  const {
    createAgentProviderLifecycleState,
    recordAgentHeuristicRunning,
    recordAgentHeuristicWaitingInput,
    recordAgentSubmission
  } = require(lifecycleOutfile);

  assert.equal(AGENT_TERMINAL_TITLE_FRAME_GAP_MS, 2500);
  assert.deepEqual(parseAgentTerminalTitles('\u001b]0;⠋ Codex\u0007').titles, ['⠋ Codex']);
  assert.deepEqual(parseAgentTerminalTitles('\u001b]2;⠂ Claude\u001b\\').titles, ['⠂ Claude']);
  assert.deepEqual(parseAgentTerminalTitles('\u009d2;⠐ Claude\u009c').titles, ['⠐ Claude']);
  assert.deepEqual(parseAgentTerminalTitles('\u001b]1;ignored\u0007').titles, []);
  assert.deepEqual(parseAgentTerminalTitles('\u001b]0;bad\nvalue\u0007').titles, []);
  assert.equal(parseAgentTerminalTitles(`\u001b]0;${'x'.repeat(600)}`).carryover, '');

  const splitTitle = parseAgentTerminalTitles('\u001b]0;⠋ Co');
  assert.notEqual(splitTitle.carryover, '');
  assert.deepEqual(parseAgentTerminalTitles('dex\u0007', splitTitle.carryover).titles, ['⠋ Codex']);

  const codexTitleState = createAgentTerminalTitleActivityState();
  assert.equal(recordAgentTerminalTitleActivity(codexTitleState, 'codex', ['⠋ Codex'], 100), false);
  assert.equal(recordAgentTerminalTitleActivity(codexTitleState, 'codex', ['⠋ Codex'], 150), false);
  assert.equal(recordAgentTerminalTitleActivity(codexTitleState, 'codex', ['⠙ Codex'], 200), true);
  assert.equal(
    recordAgentTerminalTitleActivity(
      codexTitleState,
      'codex',
      ['⠹ Codex'],
      200 + AGENT_TERMINAL_TITLE_FRAME_GAP_MS + 1
    ),
    false
  );

  const claudeTitleState = createAgentTerminalTitleActivityState();
  assert.equal(recordAgentTerminalTitleActivity(claudeTitleState, 'claude', ['✳ Claude'], 100), false);
  assert.equal(recordAgentTerminalTitleActivity(claudeTitleState, 'claude', ['⠂ Claude'], 200), false);
  assert.equal(recordAgentTerminalTitleActivity(claudeTitleState, 'claude', ['⠐ Claude'], 1100), true);
  assert.equal(recordAgentTerminalTitleActivity(claudeTitleState, 'claude', ['⠋ Codex'], 1200), false);

  const heuristicState = createAgentActivityHeuristicState();
  heuristicState.lastActivityAtMs = 100;
  const firstTitle = recordAgentOutputHeuristics(heuristicState, '\u001b]0;⠋ Codex\u0007', '', 'codex', 200);
  assert.equal(firstTitle.sawTerminalTitleActivity, false);
  const secondTitle = recordAgentOutputHeuristics(
    heuristicState,
    '\u001b]0;⠙ Codex\u0007',
    '',
    'codex',
    300
  );
  assert.equal(secondTitle.sawTerminalTitleActivity, true);
  const titleWithoutAbnormalTextProvider = recordAgentOutputHeuristics(
    createAgentActivityHeuristicState(),
    '\u001b]0;⠋ Codex\u0007\u001b]0;⠙ Codex\u0007',
    '',
    undefined,
    400,
    'codex'
  );
  assert.equal(
    titleWithoutAbnormalTextProvider.sawTerminalTitleActivity,
    true,
    'Title activity must not depend on the optional abnormal-output text notification provider.'
  );
  assert.equal(
    evaluateAgentWaitingInputTransition(heuristicState, 300 + AGENT_WAITING_INPUT_QUIET_FALLBACK_MS - 1)
      .shouldTransition,
    false,
    'A confirmed title animation refreshes the shared quiet clock.'
  );
  assert.equal(
    evaluateAgentWaitingInputTransition(heuristicState, 300 + AGENT_WAITING_INPUT_QUIET_FALLBACK_MS).reason,
    'fallback'
  );

  const turn = createAgentProviderLifecycleState('codex', false);
  recordAgentSubmission(turn, 100);
  assert.equal(recordAgentHeuristicWaitingInput(turn).lifecycle, 'waiting-input');
  assert.equal(recordAgentHeuristicRunning(turn, 'terminal-title').lifecycle, 'running');
  assert.equal(turn.activitySource, 'terminal-title');
  const noTurn = createAgentProviderLifecycleState('claude', false);
  assert.equal(
    recordAgentHeuristicRunning(noTurn, 'terminal-title').accepted,
    false,
    'Title animation without an explicit submission must not create an active turn.'
  );

  console.log('agent terminal title activity tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function bundle(entryPoint, outfile) {
  return esbuild.build({
    entryPoints: [path.resolve(entryPoint)],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });
}
