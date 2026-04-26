import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-terminal-line-context-'));

try {
  const outfile = path.join(tempDir, 'executionTerminalLineContextTracker.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/panel/executionTerminalLineContextTracker.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { ExecutionTerminalLineContextTracker } = require(outfile);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((arg) => (arg instanceof Error ? arg.stack ?? arg.message : String(arg))).join(' '));
  };

  try {
    for (let index = 0; index < 100; index += 1) {
      const tracker = new ExecutionTerminalLineContextTracker(80, 24, {
        cwd: '/tmp/dev-session-canvas',
        pathStyle: 'posix',
        initialOutput: 'boot\r\n'
      });

      tracker.write(`line-${index}\r\n`);
      tracker.recordInput('cd /tmp\r');
      tracker.dispose();

      await Promise.race([
        Promise.all([tracker.getCwdForBufferLine(0), tracker.setScrollback(5000)]),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('disposed tracker operations did not settle in time')), 200);
        })
      ]);
    }
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, []);
  console.log('executionTerminalLineContextTracker tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
