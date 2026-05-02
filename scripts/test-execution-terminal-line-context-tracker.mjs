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

  const multilineTracker = new ExecutionTerminalLineContextTracker(20, 10, {
    cwd: '/repo',
    pathStyle: 'posix'
  });
  multilineTracker.write('ziyang@host:/repo$ ');
  multilineTracker.recordInput('cd /repo/subdir\r');
  multilineTracker.write('cd /repo/subdir\r\n');
  multilineTracker.write('ziyang@host:/repo/subdir$ ');
  multilineTracker.write("printf '%s\\n%s\\n' 'link-target.ts' '  2:8  export const two = 2;'\r\n");
  multilineTracker.write('link-target.ts\r\n  2:8  export const two = 2;\r\n');
  multilineTracker.write('ziyang@host:/repo/subdir$ ');

  await multilineTracker.getCwdForBufferLine(0);
  const bufferLines = readTrackerBufferLines(multilineTracker);
  const pathLineIndex = findLastBufferLineIndex(bufferLines, 'link-target.ts');
  const resultLineIndex = findLastBufferLineIndex(bufferLines, (line) => line.startsWith('  2:8'));
  assert.ok(pathLineIndex >= 0, 'expected multiline path line to be present in the buffer');
  assert.ok(resultLineIndex >= 0, 'expected multiline result line to be present in the buffer');
  assert.equal(await multilineTracker.getCwdForBufferLine(pathLineIndex), '/repo/subdir');
  assert.equal(await multilineTracker.getCwdForBufferLine(resultLineIndex), '/repo/subdir');
  multilineTracker.dispose();

  console.log('executionTerminalLineContextTracker tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function readTrackerBufferLines(tracker) {
  const terminal = tracker.terminal ?? tracker['terminal'];
  const lines = [];
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    const line = terminal.buffer.active.getLine(index);
    lines.push(line ? line.translateToString(true) : '');
  }
  return lines;
}

function findLastBufferLineIndex(lines, matcher) {
  const matches =
    typeof matcher === 'function' ? matcher : (line) => line === matcher;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (matches(lines[index])) {
      return index;
    }
  }

  return -1;
}
