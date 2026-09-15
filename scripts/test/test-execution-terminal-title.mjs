import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-terminal-title-'));

try {
  const outfile = path.join(tempDir, 'executionTerminalTitle.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/executionTerminalTitle.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const {
    EXECUTION_TERMINAL_TITLE_MAX_LENGTH,
    formatExecutionTerminalTitleReport,
    normalizeExecutionTerminalTitle,
    parseExecutionTerminalTitles,
    processExecutionTerminalTitleControls,
    redactExecutionTerminalTitleOutput,
    stripExecutionTerminalTitleMarkers
  } = createRequire(import.meta.url)(outfile);

  assert.deepEqual(parseExecutionTerminalTitles('\u001b]0;Terminal\u0007').titles, ['Terminal']);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b]2;Window title\u001b\\').titles, ['Window title']);
  assert.deepEqual(parseExecutionTerminalTitles('\u009d2;C1 title\u009c').titles, ['C1 title']);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b]1;ignored\u0007').titles, []);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b]2;\u0007').titles, ['']);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b[21t').events, [{ kind: 'query-title' }]);
  assert.deepEqual(parseExecutionTerminalTitles('\u009b21t').events, [{ kind: 'query-title' }]);
  assert.deepEqual(parseExecutionTerminalTitles('\u001b[20t').events, []);
  assert.deepEqual(
    parseExecutionTerminalTitles('\u001b]2;unterminated\u001b[21t').events,
    [],
    'an unterminated title must consume nested control bytes until its terminator instead of leaking payload'
  );

  assert.equal(normalizeExecutionTerminalTitle('  Build\n API  '), 'Build API');
  assert.equal(normalizeExecutionTerminalTitle('\u0000\u0007'), undefined);
  assert.equal(
    Array.from(normalizeExecutionTerminalTitle('x'.repeat(EXECUTION_TERMINAL_TITLE_MAX_LENGTH + 1)) ?? '').length,
    EXECUTION_TERMINAL_TITLE_MAX_LENGTH
  );
  assert.equal(formatExecutionTerminalTitleReport('Build\n API'), '\u001b]lBuild API\u001b\\');
  assert.equal(formatExecutionTerminalTitleReport(undefined), '\u001b]l\u001b\\');

  const splitChunks = ['\u001b', ']', '2', ';', 'Split title', '\u0007', 'visible'];
  let splitTitle;
  let splitCarryover = '';
  let splitRedactionState;
  let splitOutput = '';
  for (const chunk of splitChunks) {
    const processed = processExecutionTerminalTitleControls(
      chunk,
      splitTitle,
      splitCarryover,
      splitRedactionState
    );
    assert.notEqual(processed.terminalOutput, '');
    assert.equal(processed.terminalOutput.includes('Split title'), false);
    splitTitle = processed.terminalTitle;
    splitCarryover = processed.carryover;
    splitRedactionState = processed.redactionState;
    splitOutput += processed.terminalOutput;
  }
  assert.equal(splitTitle, 'Split title');
  assert.equal(stripExecutionTerminalTitleMarkers(splitOutput), 'visible');

  let everyCharacterTitle;
  let everyCharacterCarryover = '';
  let everyCharacterState;
  let everyCharacterOutput = '';
  for (const chunk of Array.from('\u001b]2;Every character\u001b\\tail')) {
    const processed = processExecutionTerminalTitleControls(
      chunk,
      everyCharacterTitle,
      everyCharacterCarryover,
      everyCharacterState
    );
    everyCharacterTitle = processed.terminalTitle;
    everyCharacterCarryover = processed.carryover;
    everyCharacterState = processed.redactionState;
    everyCharacterOutput += processed.terminalOutput;
  }
  assert.equal(everyCharacterTitle, 'Every character');
  assert.equal(stripExecutionTerminalTitleMarkers(everyCharacterOutput), 'tail');

  const ordered = processExecutionTerminalTitleControls(
    '\u001b]2;First title\u0007\u001b[21t\u001b]2;\u0007\u001b[21t',
    undefined
  );
  assert.equal(ordered.terminalTitle, undefined);
  assert.deepEqual(ordered.titleQueries, ['First title', undefined]);
  const queryBeforeSet = processExecutionTerminalTitleControls(
    '\u001b[21t\u001b]2;Next title\u0007',
    'Prior title'
  );
  assert.deepEqual(queryBeforeSet.titleQueries, ['Prior title']);
  assert.equal(queryBeforeSet.terminalTitle, 'Next title');

  const splitQueryFirst = processExecutionTerminalTitleControls('\u001b[2', 'Current');
  const splitQuerySecond = processExecutionTerminalTitleControls(
    '1t',
    splitQueryFirst.terminalTitle,
    splitQueryFirst.carryover,
    splitQueryFirst.redactionState
  );
  assert.deepEqual(splitQuerySecond.titleQueries, ['Current']);
  assert.equal(stripExecutionTerminalTitleMarkers(
    splitQueryFirst.terminalOutput + splitQuerySecond.terminalOutput
  ), '');

  const redacted = redactExecutionTerminalTitleOutput(
    'before\u001b]2;Sensitive title\u0007\u001b[21tafter'
  );
  assert.equal(stripExecutionTerminalTitleMarkers(redacted.output), 'beforeafter');
  assert.equal(redacted.output.includes('Sensitive title'), false);

  const splitRedactedStart = redactExecutionTerminalTitleOutput('before\u001b]2;Sensitive ');
  const splitRedactedEnd = redactExecutionTerminalTitleOutput(
    'title\u0007after',
    splitRedactedStart.state
  );
  assert.equal(stripExecutionTerminalTitleMarkers(splitRedactedStart.output + splitRedactedEnd.output), 'beforeafter');
  assert.equal(splitRedactedStart.output.includes('Sensitive'), false);
  assert.equal(splitRedactedEnd.output.includes('Sensitive'), false);

  const oversizedStart = redactExecutionTerminalTitleOutput(`\u001b]2;${'x'.repeat(600)}`);
  const oversizedEnd = redactExecutionTerminalTitleOutput(
    'still-sensitive\u0007visible',
    oversizedStart.state
  );
  assert.equal(stripExecutionTerminalTitleMarkers(oversizedStart.output + oversizedEnd.output), 'visible');
  assert.equal(oversizedEnd.output.includes('still-sensitive'), false);

  const oversizedControlsStart = redactExecutionTerminalTitleOutput(
    `\u001b]2;${'x'.repeat(600)}\n\u001b[31m`
  );
  const oversizedControlsEnd = redactExecutionTerminalTitleOutput(
    'still-sensitive\u001b\\visible',
    oversizedControlsStart.state
  );
  assert.equal(
    stripExecutionTerminalTitleMarkers(oversizedControlsStart.output + oversizedControlsEnd.output),
    'visible'
  );
  assert.equal(oversizedControlsEnd.output.includes('still-sensitive'), false);

  const oversizedSplitTerminatorStart = redactExecutionTerminalTitleOutput(
    `\u001b]2;${'x'.repeat(600)}\u001b`
  );
  const oversizedSplitTerminatorEnd = redactExecutionTerminalTitleOutput(
    '\\visible',
    oversizedSplitTerminatorStart.state
  );
  assert.equal(
    stripExecutionTerminalTitleMarkers(
      oversizedSplitTerminatorStart.output + oversizedSplitTerminatorEnd.output
    ),
    'visible'
  );

  const nonTitleChunks = ['prefix\u001b', ']', '1', ';ignored\u0007suffix', '\u001b[', '31mcolor'];
  let nonTitleCarryover = '';
  let nonTitleState;
  let nonTitleOutput = '';
  for (const chunk of nonTitleChunks) {
    const processed = processExecutionTerminalTitleControls(
      chunk,
      undefined,
      nonTitleCarryover,
      nonTitleState
    );
    nonTitleCarryover = processed.carryover;
    nonTitleState = processed.redactionState;
    nonTitleOutput += processed.terminalOutput;
  }
  assert.equal(
    stripExecutionTerminalTitleMarkers(nonTitleOutput),
    'prefix\u001b]1;ignored\u0007suffix\u001b[31mcolor'
  );

  const ordinaryEscFirst = processExecutionTerminalTitleControls('before\u001b');
  const ordinaryEscSecond = processExecutionTerminalTitleControls(
    '[31mred',
    undefined,
    ordinaryEscFirst.carryover,
    ordinaryEscFirst.redactionState
  );
  assert.equal(
    stripExecutionTerminalTitleMarkers(ordinaryEscFirst.terminalOutput + ordinaryEscSecond.terminalOutput),
    'before\u001b[31mred'
  );

  const oversizedTitle = parseExecutionTerminalTitles(`\u001b]2;${'x'.repeat(600)}`);
  assert.equal(oversizedTitle.carryover, '');
  assert.equal(oversizedTitle.discardingTitlePayload, true);

  console.log('execution terminal title tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
