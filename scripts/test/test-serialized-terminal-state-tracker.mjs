import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-serialized-terminal-state-'));

try {
  const outfile = path.join(tempDir, 'serializedTerminalState.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    SERIALIZED_TERMINAL_CHECKPOINT_PRODUCER_PROFILE,
    SERIALIZED_TERMINAL_STATE_FORMAT,
    SerializedTerminalStateTracker,
    cloneSerializedTerminalState,
    normalizeSerializedTerminalState
  } = require(outfile);

  assert.match(SERIALIZED_TERMINAL_CHECKPOINT_PRODUCER_PROFILE, /xterm-headless@6\.0\.0/u);
  assert.match(SERIALIZED_TERMINAL_CHECKPOINT_PRODUCER_PROFILE, /addon-serialize@0\.14\.0/u);

  const tracker = new SerializedTerminalStateTracker(40, 8);
  tracker.write('alpha\r\n');
  tracker.write('beta\r\n');
  let state = await tracker.flush();
  assert.equal(state.format, SERIALIZED_TERMINAL_STATE_FORMAT);
  assert.match(state.data, /alpha/u);
  assert.match(state.data, /beta/u);

  const initialBottomSignature = tracker.getBottomScreenSignature();
  const initialBottomActivityToken = tracker.getBottomScreenActivityToken();
  tracker.write('\u001b[2D');
  await tracker.flush();
  assert.equal(
    tracker.getBottomScreenSignature(),
    initialBottomSignature,
    'Cursor-only movement must not look like bottom-screen activity.'
  );
  assert.equal(tracker.getBottomScreenActivityToken(), initialBottomActivityToken);
  tracker.write('\u001b[31mX\u001b[0m');
  await tracker.flush();
  const redBottomSignature = tracker.getBottomScreenSignature();
  assert.notEqual(redBottomSignature, initialBottomSignature);
  assert.notEqual(tracker.getBottomScreenActivityToken(), initialBottomActivityToken);
  tracker.write('\b\u001b[32mX\u001b[0m');
  await tracker.flush();
  assert.notEqual(
    tracker.getBottomScreenSignature(),
    redBottomSignature,
    'Style-only spinner frames must change the bottom-screen signature.'
  );

  tracker.write(`${Array.from({ length: 200 }, (_, index) => `line-${String(index).padStart(3, '0')}`).join('\r\n')}\r\n`, {
    outputSequence: 3
  });
  state = await tracker.flush();
  assert.match(state.data, /line-199/u, 'flush should include batched multi-chunk writes.');
  assert.equal(state.outputSequence, 3, 'flush should tag serialized terminal state with the latest output sequence.');

  const forcedFlushTracker = new SerializedTerminalStateTracker(40, 8, {
    scrollback: 5000
  });
  const forcedFlushSerializeAddon = forcedFlushTracker.serializeAddon;
  assert.ok(forcedFlushSerializeAddon, 'tracker tests should be able to observe the internal serialize boundary.');
  const originalForcedFlushSerialize = forcedFlushSerializeAddon.serialize.bind(forcedFlushSerializeAddon);
  let forcedFlushSerializeCount = 0;
  forcedFlushSerializeAddon.serialize = (...args) => {
    forcedFlushSerializeCount += 1;
    return originalForcedFlushSerialize(...args);
  };
  forcedFlushTracker.write(`${'f'.repeat(96 * 1024)}FORCED-FLUSH-END\r\n`, {
    outputSequence: 4
  });
  const forcedFlushState = await forcedFlushTracker.flush();
  assert.equal(
    forcedFlushSerializeCount,
    1,
    'a forced multi-chunk drain should serialize once after all pending writes and metadata settle.'
  );
  assert.match(forcedFlushState.data, /FORCED-FLUSH-END/u);
  assert.equal(forcedFlushState.outputSequence, 4);
  forcedFlushTracker.dispose();

  tracker.write('before-resize\r\n', {
    outputSequence: 4
  });
  tracker.resize(50, 12, {
    outputSequence: 5
  });
  state = await tracker.flush();
  assert.match(state.data, /before-resize/u, 'resize should drain pending writes before changing dimensions.');
  assert.equal(state.outputSequence, 5, 'resize should advance the shared terminal revision after draining writes.');

  tracker.write('before-scrollback\r\n', {
    outputSequence: 6
  });
  await tracker.setScrollback(2000, {
    outputSequence: 7
  });
  state = await tracker.flush();
  assert.match(state.data, /before-scrollback/u, 'setScrollback should drain pending writes before changing options.');
  assert.equal(state.outputSequence, 7, 'setScrollback should advance the shared terminal revision after changing options.');
  tracker.dispose();

  const scrollbackParserCarryTracker = new SerializedTerminalStateTracker(20, 5);
  scrollbackParserCarryTracker.write('\u001b[31', {
    outputSequence: 8
  });
  await scrollbackParserCarryTracker.setScrollback(2000, {
    outputSequence: 9
  });
  scrollbackParserCarryTracker.write('mRED\u001b[0m\r\n', {
    outputSequence: 10
  });
  const scrollbackParserCarryState = await scrollbackParserCarryTracker.flush();
  assert.match(
    scrollbackParserCarryState.data,
    /\u001b\[31mRED/u,
    'setScrollback should preserve an unfinished CSI so its suffix still applies the intended color.'
  );
  assert.doesNotMatch(
    scrollbackParserCarryState.data,
    /^mRED/u,
    'setScrollback must not turn the suffix of a split CSI into literal terminal output.'
  );
  assert.equal(scrollbackParserCarryState.outputSequence, 10);
  assert.equal(scrollbackParserCarryTracker.getScrollback(), 2000);
  scrollbackParserCarryTracker.dispose();

  const normalized = normalizeSerializedTerminalState({
    format: SERIALIZED_TERMINAL_STATE_FORMAT,
    data: 'normalized-data',
    outputSequence: 7
  });
  assert.equal(normalized.outputSequence, 7, 'normalization should preserve valid outputSequence metadata.');
  assert.equal(
    cloneSerializedTerminalState(normalized).outputSequence,
    7,
    'cloning should preserve outputSequence metadata.'
  );

  const staleTracker = new SerializedTerminalStateTracker(40, 8, {
    initialState: {
      format: SERIALIZED_TERMINAL_STATE_FORMAT,
      data: 'stale-only\r\n',
      outputSequence: 1
    },
    initialOutput: 'stale-only\r\nfresh-marker\r\n',
    initialOutputSequence: 2
  });
  const staleState = await staleTracker.flush();
  assert.doesNotMatch(
    staleState.data,
    /stale-only\\r\\n$/u,
    'mismatched initial serialized state should not be used as the authoritative restore source.'
  );
  assert.match(staleState.data, /fresh-marker/u, 'mismatched initial serialized state should replay raw output.');
  assert.equal(staleState.outputSequence, 2, 'raw output replay should carry the output sequence floor.');
  staleTracker.dispose();

  const legacyTracker = new SerializedTerminalStateTracker(40, 8, {
    initialState: {
      format: SERIALIZED_TERMINAL_STATE_FORMAT,
      data: 'legacy-state-only\r\n'
    },
    initialOutput: 'legacy-state-only\r\nlegacy-raw-marker\r\n',
    initialOutputSequence: 3
  });
  const legacyState = await legacyTracker.flush();
  assert.match(
    legacyState.data,
    /legacy-raw-marker/u,
    'legacy serialized state without outputSequence should replay raw output when raw output is available.'
  );
  assert.equal(legacyState.outputSequence, 3);
  legacyTracker.dispose();

  const trustedTracker = new SerializedTerminalStateTracker(40, 8, {
    initialState: {
      format: SERIALIZED_TERMINAL_STATE_FORMAT,
      data: 'trusted-state-marker\r\n',
      outputSequence: 4
    },
    initialOutput: 'raw-output-should-not-win\r\n',
    initialOutputSequence: 4
  });
  const trustedState = await trustedTracker.flush();
  assert.match(trustedState.data, /trusted-state-marker/u, 'matching outputSequence should trust serialized state.');
  assert.doesNotMatch(trustedState.data, /raw-output-should-not-win/u, 'trusted serialized state should skip raw replay.');
  assert.equal(trustedState.outputSequence, 4);
  trustedTracker.dispose();

  const markedTracker = new SerializedTerminalStateTracker(20, 5);
  markedTracker.markOutputSequence(9);
  assert.equal(
    markedTracker.getSerializedState().outputSequence,
    9,
    'markOutputSequence should update cached metadata without requiring a write.'
  );
  markedTracker.write('marked-output\r\n', {
    outputSequence: 8
  });
  const markedState = await markedTracker.flush();
  assert.equal(markedState.outputSequence, 9, 'outputSequence metadata should be monotonic.');
  markedTracker.dispose();

  const partialCsiTracker = new SerializedTerminalStateTracker(20, 5);
  partialCsiTracker.write('\u001b[31');
  let checkpoint = await partialCsiTracker.flushValidatedCheckpoint();
  assert.deepEqual(checkpoint, {
    eligible: false,
    reason: 'parser-not-ground'
  }, 'a checkpoint must not split an unfinished CSI sequence.');
  partialCsiTracker.write('mred\u001b[0m\r\n');
  checkpoint = await partialCsiTracker.flushValidatedCheckpoint();
  assert.equal(checkpoint.eligible, true, 'a completed CSI followed by a safe boundary should be eligible.');
  if (checkpoint.eligible) {
    assert.match(checkpoint.state.data, /red/u);
  }
  partialCsiTracker.dispose();

  const surrogateTracker = new SerializedTerminalStateTracker(20, 5);
  surrogateTracker.write('\ud83d');
  checkpoint = await surrogateTracker.flushValidatedCheckpoint();
  assert.deepEqual(checkpoint, {
    eligible: false,
    reason: 'utf16-decoder-carry'
  }, 'a checkpoint must not split a UTF-16 surrogate pair.');
  surrogateTracker.write('\ude00\r\n');
  checkpoint = await surrogateTracker.flushValidatedCheckpoint();
  assert.equal(checkpoint.eligible, true, 'the next safe revision should be eligible after the surrogate is completed.');
  if (checkpoint.eligible) {
    assert.match(checkpoint.state.data, /😀/u);
    assert.doesNotMatch(checkpoint.state.data, /\ufffd/u, 'surrogate completion must not introduce replacement characters.');
  }
  surrogateTracker.dispose();

  const safeCheckpointTracker = new SerializedTerminalStateTracker(20, 5);
  const validateSafeCheckpoint = safeCheckpointTracker.validateCheckpoint.bind(safeCheckpointTracker);
  let safeCheckpointValidationCount = 0;
  safeCheckpointTracker.validateCheckpoint = async (...args) => {
    safeCheckpointValidationCount += 1;
    return validateSafeCheckpoint(...args);
  };
  safeCheckpointTracker.write('safe-checkpoint\r\n', {
    outputSequence: 12
  });
  checkpoint = await safeCheckpointTracker.flushValidatedCheckpoint();
  assert.equal(checkpoint.eligible, true, 'a simple terminal state at a safe parser boundary should be eligible.');
  if (checkpoint.eligible) {
    assert.equal(checkpoint.state.outputSequence, 12);
    assert.match(checkpoint.state.data, /safe-checkpoint/u);
  }
  checkpoint = await safeCheckpointTracker.flushValidatedCheckpoint();
  assert.equal(checkpoint.eligible, true);
  assert.equal(
    safeCheckpointValidationCount,
    1,
    'repeated snapshots at the same terminal state should reuse the semantic validation result.'
  );
  safeCheckpointTracker.write('next-revision\r\n', {
    outputSequence: 13
  });
  checkpoint = await safeCheckpointTracker.flushValidatedCheckpoint();
  assert.equal(checkpoint.eligible, true);
  assert.equal(safeCheckpointValidationCount, 2, 'terminal mutations must invalidate the validation cache.');
  safeCheckpointTracker.dispose();

  const fullReplayTracker = new SerializedTerminalStateTracker(20, 5, {
    scrollback: 100,
    initialOutputSequence: 0
  });
  fullReplayTracker.write('equivalence-prefix\r\n', {
    outputSequence: 1
  });
  const equivalenceBase = await fullReplayTracker.flushValidatedCheckpoint();
  assert.equal(equivalenceBase.eligible, true);
  assert.ok(equivalenceBase.eligible);
  const checkpointReplayTracker = new SerializedTerminalStateTracker(20, 5, {
    scrollback: 100,
    initialState: equivalenceBase.state,
    initialOutputSequence: 1
  });
  for (const candidate of [fullReplayTracker, checkpointReplayTracker]) {
    candidate.write('\u001b[31mRED\u001b[0m\r\n', {
      outputSequence: 2
    });
    candidate.resize(24, 6, {
      outputSequence: 3
    });
    await candidate.setScrollback(200, {
      outputSequence: 4
    });
  }
  let fullReplayCheckpoint = await fullReplayTracker.flushValidatedCheckpoint();
  let checkpointReplayCheckpoint = await checkpointReplayTracker.flushValidatedCheckpoint();
  assert.equal(fullReplayCheckpoint.eligible, true);
  assert.equal(checkpointReplayCheckpoint.eligible, true);
  assert.ok(fullReplayCheckpoint.eligible && checkpointReplayCheckpoint.eligible);
  assert.deepEqual(
    checkpointReplayCheckpoint.state,
    fullReplayCheckpoint.state,
    'checkpoint plus journal tail must reach the same serialized state as full journal replay.'
  );
  fullReplayTracker.write('common-suffix\r\n', { outputSequence: 5 });
  checkpointReplayTracker.write('common-suffix\r\n', { outputSequence: 5 });
  fullReplayCheckpoint = await fullReplayTracker.flushValidatedCheckpoint();
  checkpointReplayCheckpoint = await checkpointReplayTracker.flushValidatedCheckpoint();
  assert.equal(fullReplayCheckpoint.eligible, true);
  assert.equal(checkpointReplayCheckpoint.eligible, true);
  assert.ok(fullReplayCheckpoint.eligible && checkpointReplayCheckpoint.eligible);
  assert.deepEqual(
    checkpointReplayCheckpoint.state,
    fullReplayCheckpoint.state,
    'equivalent checkpoint/full replay states must remain equivalent after a shared future suffix.'
  );
  fullReplayTracker.dispose();
  checkpointReplayTracker.dispose();

  const cursorBlinkTracker = new SerializedTerminalStateTracker(20, 5);
  cursorBlinkTracker.write('\u001b[?12h\u001b[0m');
  checkpoint = await cursorBlinkTracker.flushValidatedCheckpoint();
  assert.deepEqual(checkpoint, {
    eligible: false,
    reason: 'state-mismatch'
  }, 'a cursor-blink mode omitted by xterm serialization must reject compaction.');
  cursorBlinkTracker.dispose();

  const osc8Tracker = new SerializedTerminalStateTracker(40, 5);
  osc8Tracker.write('\u001b]8;;https://example.com\u0007linked\u001b]8;;\u0007\r\n');
  checkpoint = await osc8Tracker.flushValidatedCheckpoint();
  assert.deepEqual(checkpoint, {
    eligible: false,
    reason: 'osc8-state'
  }, 'OSC 8 metadata that xterm-serialize-v1 cannot preserve must reject compaction.');
  osc8Tracker.dispose();

  // Codex asks for the default colors at startup. A REPORT is not a palette mutation.
  const codexStartupColorQueryTracker = new SerializedTerminalStateTracker(40, 5);
  codexStartupColorQueryTracker.write(
    '\u001b]10;?\u001b\\\u001b]11;?\u001b\\',
    { outputSequence: 1 }
  );
  checkpoint = await codexStartupColorQueryTracker.flushValidatedCheckpoint();
  assert.equal(checkpoint.eligible, true, 'Codex OSC 10/11 REPORT queries must not reject checkpoints.');
  codexStartupColorQueryTracker.write('post-query output\r\n', {
    outputSequence: 2
  });
  checkpoint = await codexStartupColorQueryTracker.flushValidatedCheckpoint();
  assert.equal(checkpoint.eligible, true, 'a later safe boundary must remain eligible after color queries.');
  codexStartupColorQueryTracker.dispose();

  const colorStateTracker = new SerializedTerminalStateTracker(40, 5);
  colorStateTracker.write('\u001b]10;#ff0000\u0007');
  checkpoint = await colorStateTracker.flushValidatedCheckpoint();
  assert.deepEqual(checkpoint, {
    eligible: false,
    reason: 'color-state'
  }, 'OSC palette/default-color side effects are not represented by xterm serialization and must stay journal-backed.');
  colorStateTracker.write('\u001b]110\u0007');
  checkpoint = await colorStateTracker.flushValidatedCheckpoint();
  assert.deepEqual(checkpoint, {
    eligible: false,
    reason: 'color-state'
  }, 'resetting a color side effect cannot prove the renderer palette returned to the serialized default.');
  colorStateTracker.dispose();

  const failedWriteTracker = new SerializedTerminalStateTracker(20, 5);
  failedWriteTracker.terminal.write = () => {
    throw new Error('injected xterm write failure');
  };
  failedWriteTracker.write('must-not-be-trusted', {
    outputSequence: 14
  });
  await assert.rejects(
    failedWriteTracker.flushValidatedCheckpoint(),
    /injected xterm write failure/u,
    'a failed source hydrate/write must invalidate the tracker instead of producing an eligible empty checkpoint.'
  );
  await assert.rejects(
    failedWriteTracker.flush(),
    /injected xterm write failure/u,
    'ordinary flush must keep reporting a prior tracker operation failure.'
  );
  failedWriteTracker.dispose();

  const disposedTracker = new SerializedTerminalStateTracker(20, 5);
  disposedTracker.write('pending-before-dispose\r\n');
  disposedTracker.dispose();
  await disposedTracker.flush();

  console.log('serializedTerminalStateTracker tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
