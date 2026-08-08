import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-terminal-title-'));

try {
  const titleOutfile = path.join(tempDir, 'agentTerminalTitleActivity.cjs');
  const executionTitleOutfile = path.join(tempDir, 'executionTerminalTitle.cjs');
  const heuristicOutfile = path.join(tempDir, 'agentActivityHeuristics.cjs');
  const lifecycleOutfile = path.join(tempDir, 'agentProviderLifecycle.cjs');
  await Promise.all([
    bundle('extensions/vscode/dev-session-canvas/src/common/agentTerminalTitleActivity.ts', titleOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/common/executionTerminalTitle.ts', executionTitleOutfile),
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
    EXECUTION_TERMINAL_TITLE_MAX_LENGTH,
    formatExecutionTerminalTitleReport,
    normalizeExecutionTerminalTitle,
    parseExecutionTerminalTitles,
    processExecutionTerminalTitleControls,
    redactExecutionTerminalTitleOutput
  } = require(executionTitleOutfile);
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
  assert.deepEqual(parseExecutionTerminalTitles('\u001b]0;Terminal\u0007').titles, ['Terminal']);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b]2;\u0007').titles, ['']);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b[21t').events, [{ kind: 'query-title' }]);
  assert.deepEqual(parseExecutionTerminalTitles('\u009b21t').events, [{ kind: 'query-title' }]);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b[20t').events, []);
  assert.deepEqual(
    parseExecutionTerminalTitles('\u001b]2;unterminated\u001b[21t').events,
    [{ kind: 'query-title' }]
  );
  assert.equal(normalizeExecutionTerminalTitle('  Build\n API  '), 'Build API');
  assert.equal(normalizeExecutionTerminalTitle(''), undefined);
  assert.equal(normalizeExecutionTerminalTitle('\u0000\u0007'), undefined);
  assert.equal(
    Array.from(normalizeExecutionTerminalTitle('x'.repeat(EXECUTION_TERMINAL_TITLE_MAX_LENGTH + 1)) ?? '').length,
    EXECUTION_TERMINAL_TITLE_MAX_LENGTH
  );

  const splitTitle = parseAgentTerminalTitles('\u001b]0;⠋ Co');
  assert.notEqual(splitTitle.carryover, '');
  assert.deepEqual(parseAgentTerminalTitles('dex\u0007', splitTitle.carryover).titles, ['⠋ Codex']);
  const splitOscIntroducer = parseAgentTerminalTitles('\u001b');
  assert.equal(splitOscIntroducer.carryover, '\u001b');
  assert.deepEqual(
    parseAgentTerminalTitles(']0;⠋ Codex\u0007', splitOscIntroducer.carryover).titles,
    ['⠋ Codex']
  );
  const splitStringTerminator = parseAgentTerminalTitles('\u001b]2;⠐ Claude\u001b');
  assert.notEqual(splitStringTerminator.carryover, '');
  assert.deepEqual(parseAgentTerminalTitles('\\', splitStringTerminator.carryover).titles, ['⠐ Claude']);
  const splitTitleQuery = parseExecutionTerminalTitles('\u001b[2');
  assert.equal(splitTitleQuery.carryover, '\u001b[2');
  assert.deepEqual(
    parseExecutionTerminalTitles('1t', splitTitleQuery.carryover).events,
    [{ kind: 'query-title' }]
  );

  const orderedTitleControls = processExecutionTerminalTitleControls(
    '\u001b]2;First title\u0007\u001b[21t\u001b]2;\u0007\u001b[21t',
    undefined
  );
  assert.equal(orderedTitleControls.terminalTitle, undefined);
  assert.deepEqual(orderedTitleControls.titleQueries, ['First title', undefined]);
  assert.equal(formatExecutionTerminalTitleReport('Build\n API'), '\u001b]lBuild API\u001b\\');
  assert.equal(formatExecutionTerminalTitleReport(undefined), '\u001b]l\u001b\\');
  const queryBeforeSet = processExecutionTerminalTitleControls('\u001b[21t\u001b]2;Next title\u0007', 'Prior title');
  assert.deepEqual(queryBeforeSet.titleQueries, ['Prior title']);
  assert.equal(queryBeforeSet.terminalTitle, 'Next title');

  const redactedTitleOutput = redactExecutionTerminalTitleOutput(
    'before\u001b]2;Sensitive title\u0007\u001b[21tafter'
  );
  assert.equal(redactedTitleOutput.output, 'before\u0000\u001b[21tafter');
  assert.equal(redactedTitleOutput.output.includes('Sensitive title'), false);
  const splitRedactedTitleStart = redactExecutionTerminalTitleOutput('before\u001b]2;Sensitive ');
  assert.equal(splitRedactedTitleStart.output, 'before\u0000');
  const splitRedactedTitleEnd = redactExecutionTerminalTitleOutput(
    'title\u0007after',
    splitRedactedTitleStart.state
  );
  assert.equal(splitRedactedTitleEnd.output, '\u0000after');
  assert.equal(splitRedactedTitleEnd.output.includes('Sensitive title'), false);
  const oversizedRedactedTitle = redactExecutionTerminalTitleOutput(`\u001b]2;${'x'.repeat(600)}`);
  assert.equal(oversizedRedactedTitle.output, '\u0000');
  const oversizedRedactedTitleEnd = redactExecutionTerminalTitleOutput(
    'still-sensitive\u0007visible',
    oversizedRedactedTitle.state
  );
  assert.equal(oversizedRedactedTitleEnd.output, '\u0000visible');

  const splitRedactedControlChunks = ['\u001b', ']', '2', ';', 'Sensitive title', '\u0007', '\u001b[21t'];
  let splitRedactedControlTitle;
  let splitRedactedControlCarryover = '';
  let splitRedactedControlState;
  let splitRedactedControlOutput = '';
  let splitRedactedControlQueries = [];
  for (const chunk of splitRedactedControlChunks) {
    const processed = processExecutionTerminalTitleControls(
      chunk,
      splitRedactedControlTitle,
      splitRedactedControlCarryover,
      splitRedactedControlState
    );
    assert.notEqual(
      processed.terminalOutput,
      '',
      'Every non-empty PTY chunk, including a split OSC 0/2 introducer, must remain journalable.'
    );
    assert.equal(processed.terminalOutput.includes('Sensitive title'), false);
    splitRedactedControlTitle = processed.terminalTitle;
    splitRedactedControlCarryover = processed.carryover;
    splitRedactedControlState = processed.redactionState;
    splitRedactedControlOutput += processed.terminalOutput;
    splitRedactedControlQueries = splitRedactedControlQueries.concat(processed.titleQueries);
  }
  assert.equal(splitRedactedControlTitle, 'Sensitive title');
  assert.deepEqual(splitRedactedControlQueries, ['Sensitive title']);
  assert.equal(splitRedactedControlOutput.includes('Sensitive title'), false);
  assert.match(splitRedactedControlOutput, /\u001b\[21t/u);

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
  const chunkedTitleState = createAgentActivityHeuristicState();
  assert.equal(
    recordAgentOutputHeuristics(chunkedTitleState, '\u001b', '', 'claude', 200).sawTerminalTitleActivity,
    false
  );
  assert.equal(
    recordAgentOutputHeuristics(chunkedTitleState, ']0;⠂ Claude\u0007', '', 'claude', 210)
      .sawTerminalTitleActivity,
    false
  );
  assert.equal(
    recordAgentOutputHeuristics(chunkedTitleState, '\u001b', '', 'claude', 220).sawTerminalTitleActivity,
    false
  );
  assert.equal(
    recordAgentOutputHeuristics(chunkedTitleState, ']0;⠐ Claude\u0007', '', 'claude', 230)
      .sawTerminalTitleActivity,
    true,
    'Two title frames split after ESC must still form activity evidence.'
  );
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
