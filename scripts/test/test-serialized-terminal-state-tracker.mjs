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
    entryPoints: [path.resolve('src/common/serializedTerminalState.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { SERIALIZED_TERMINAL_STATE_FORMAT, SerializedTerminalStateTracker } = require(outfile);

  const tracker = new SerializedTerminalStateTracker(40, 8);
  tracker.write('alpha\r\n');
  tracker.write('beta\r\n');
  let state = await tracker.flush();
  assert.equal(state.format, SERIALIZED_TERMINAL_STATE_FORMAT);
  assert.match(state.data, /alpha/u);
  assert.match(state.data, /beta/u);

  tracker.write(`${Array.from({ length: 200 }, (_, index) => `line-${String(index).padStart(3, '0')}`).join('\r\n')}\r\n`);
  state = await tracker.flush();
  assert.match(state.data, /line-199/u, 'flush should include batched multi-chunk writes.');

  tracker.write('before-resize\r\n');
  tracker.resize(50, 12);
  state = await tracker.flush();
  assert.match(state.data, /before-resize/u, 'resize should drain pending writes before changing dimensions.');

  tracker.write('before-scrollback\r\n');
  await tracker.setScrollback(2000);
  state = await tracker.flush();
  assert.match(state.data, /before-scrollback/u, 'setScrollback should drain pending writes before rebuilding.');
  tracker.dispose();

  const disposedTracker = new SerializedTerminalStateTracker(20, 5);
  disposedTracker.write('pending-before-dispose\r\n');
  disposedTracker.dispose();
  await disposedTracker.flush();

  console.log('serializedTerminalStateTracker tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
