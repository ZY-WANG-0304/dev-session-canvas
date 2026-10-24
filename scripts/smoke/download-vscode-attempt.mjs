import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import request from '@vscode/test-electron/out/request.js';

let resultFile;
let completed = false;
let deadlineTimer;
function describeError(error) {
  return { name: error?.name ?? typeof error, message: error?.message ?? String(error),
    code: typeof error?.code === 'string' ? error.code : null,
    timeout: error instanceof request.TimeoutError,
    ...(typeof error?.stack === 'string' ? { stack: error.stack } : {}),
    ...(error instanceof AggregateError ? { causes: error.errors.map(describeError) } : {}) };
}
function finish(result, { deadlineExpired = false } = {}) {
  if (completed) return;
  completed = true;
  clearTimeout(deadlineTimer);
  try {
    assert(resultFile, 'Download attempt result path is required');
    fs.writeFileSync(resultFile, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, ...result })}\n`, { flag: 'wx' });
  } catch (error) {
    console.error('Could not preserve download attempt result:', error);
    result = { status: 'failed' };
  }
  // The worker owns a detached process group created by runProcess. This
  // watchdog still retires the extractor if the outer supervisor times out.
  if (deadlineExpired) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
      } else process.kill(-process.pid, 'SIGKILL');
    } catch (error) { console.error('Download deadline retirement failed:', error); }
  }
  // Never continue an attempt after an uncaught exception or rejection.
  process.exit(result.status === 'passed' ? 0 : 1);
}
function fail(error, source) {
  finish({ status: 'failed', source, error: describeError(error) });
}
process.once('uncaughtException', error => fail(error, 'uncaughtException'));
process.once('unhandledRejection', error => fail(error, 'unhandledRejection'));

try {
  const { values } = parseArgs({ options: {
    version: { type: 'string' }, cache: { type: 'string' }, timeout: { type: 'string' },
    deadline: { type: 'string' }, result: { type: 'string' }
  } });
  resultFile = values.result;
  const deadline = Number(values.deadline);
  const timeout = Number(values.timeout);
  assert(/^\d+\.\d+\.\d+$/u.test(values.version), 'The attempt requires a fixed release version');
  assert(values.cache && resultFile);
  assert(Number.isFinite(deadline) && deadline > Date.now() && deadline - Date.now() <= 0x7fffffff);
  assert(Number.isFinite(timeout) && timeout > 0 && timeout <= 30000);
  deadlineTimer = setTimeout(() => finish({ status: 'failed', source: 'deadline',
    error: describeError(new Error('Fixed host download infrastructure deadline exhausted')) },
  { deadlineExpired: true }), Math.max(1, deadline - Date.now()));
  const executable = await downloadAndUnzipVSCode({ version: values.version, cachePath: values.cache,
    timeout: Math.min(timeout, deadline - Date.now()), reporter: {
      report(progress) {
        assert(Date.now() <= deadline, 'Fixed host download infrastructure deadline exhausted');
        // Only the supervisor may retry. The library also retries checksum
        // and extraction errors, which must remain non-retryable here.
        if (progress.stage === 'retrying') throw progress.error;
      },
      error(error) { throw error; }
    } });
  assert(Date.now() <= deadline, 'Fixed host download infrastructure deadline exhausted');
  finish({ status: 'passed', executable });
} catch (error) { fail(error, 'caught'); }
