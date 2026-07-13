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
    SERIALIZED_TERMINAL_STATE_FORMAT,
    SerializedTerminalStateTracker,
    cloneSerializedTerminalState,
    normalizeSerializedTerminalState
  } = require(outfile);

  const tracker = new SerializedTerminalStateTracker(40, 8);
  tracker.write('alpha\r\n');
  tracker.write('beta\r\n');
  let state = await tracker.flush();
  assert.equal(state.format, SERIALIZED_TERMINAL_STATE_FORMAT);
  assert.match(state.data, /alpha/u);
  assert.match(state.data, /beta/u);

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
  assert.match(state.data, /before-scrollback/u, 'setScrollback should drain pending writes before rebuilding.');
  assert.equal(state.outputSequence, 7, 'setScrollback should advance the shared terminal revision after rebuilding.');
  tracker.dispose();

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

  const disposedTracker = new SerializedTerminalStateTracker(20, 5);
  disposedTracker.write('pending-before-dispose\r\n');
  disposedTracker.dispose();
  await disposedTracker.flush();

  console.log('serializedTerminalStateTracker tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
