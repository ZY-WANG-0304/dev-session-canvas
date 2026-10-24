import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
import { runProcess } from '../gates/process.mjs';
import request from '@vscode/test-electron/out/request.js';

const transportCodes = new Set(['ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN']);
export function isTransientDownloadError(error) {
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isTransientDownloadError);
  return error instanceof request.TimeoutError || transportCodes.has(error?.code);
}

function restoreAttemptError(value) {
  assert(value && typeof value.message === 'string', 'Invalid download attempt error');
  const error = Array.isArray(value.causes)
    ? new AggregateError(value.causes.map(restoreAttemptError), value.message)
    : value.timeout ? new request.TimeoutError(0) : new Error(value.message);
  error.message = value.message;
  if (typeof value.name === 'string') error.name = value.name;
  if (typeof value.stack === 'string') error.stack = value.stack;
  if (typeof value.code === 'string') error.code = value.code;
  return error;
}

export async function downloadVSCodeAttempt({ version, cachePath, timeout, deadline, signal }) {
  assert(Number.isFinite(deadline) && deadline > Date.now(), 'The original download deadline is required');
  signal?.throwIfAborted();
  await fs.mkdir(cachePath, { recursive: true });
  const directory = await fs.mkdtemp(path.join(cachePath, 'download-attempt-'));
  const resultFile = path.join(directory, 'result.json');
  try {
    const observed = await runProcess(process.execPath, ['--unhandled-rejections=throw',
      fileURLToPath(new URL('./download-vscode-attempt.mjs', import.meta.url)),
      '--version', version, '--cache', path.resolve(cachePath), '--timeout', String(timeout),
      '--deadline', String(deadline), '--result', path.resolve(resultFile)],
    { deadline, signal, terminationGraceMs: 1000 });
    let result;
    try { result = JSON.parse(await fs.readFile(resultFile, 'utf8')); }
    catch (cause) {
      const error = new Error('Download attempt exited without a readable result', { cause });
      error.downloadProcess = observed;
      throw error;
    }
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.pid, observed.pid, 'Download result must belong to the original worker');
    if (observed.status === 'passed' && result.status === 'passed') {
      assert(typeof result.executable === 'string' && result.executable.length > 0);
      return result.executable;
    }
    // A recorded transport failure may leave an extractor to retire. Recovery
    // is permitted only after runProcess has confirmed that retirement.
    const recoverableExit = observed.code === 1 && !observed.signal && !observed.timedOut
      && !observed.cancelled && !observed.error && observed.exited && !observed.drainTimedOut
      && observed.cleanup.status === 'passed' && result.status === 'failed'
      && ['caught', 'uncaughtException', 'unhandledRejection'].includes(result.source);
    const error = recoverableExit ? restoreAttemptError(result.error)
      : new Error('Download attempt failed exit/deadline/cleanup verification');
    error.downloadProcess = observed;
    error.downloadSource = result.source;
    error.downloadFailure = result.error ?? null;
    throw error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function downloadFixedVSCode({ version, cachePath, deadline, record },
  { download = downloadVSCodeAttempt, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  assert(/^\d+\.\d+\.\d+$/u.test(version), 'The host download requires one fixed release version');
  assert(cachePath && Number.isFinite(deadline) && deadline > now(), 'The original host download deadline is required');
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (now() >= deadline) {
      const error = new Error('Fixed host download infrastructure deadline exhausted');
      await record?.({ schemaVersion: 1, version, deadline, status: 'failed', attempts,
        error: { name: error.name, message: error.message } });
      throw error;
    }
    const observed = { attempt, version, startedAt: now(), deadline, status: 'running' };
    attempts.push(observed);
    await record?.({ schemaVersion: 1, version, deadline, status: 'running', attempts });
    try {
      const executable = await download({ version, cachePath, deadline, timeout: Math.min(30000, deadline - now()),
        reporter: {
          report(progress) {
            assert(now() <= deadline, 'Fixed host download infrastructure deadline exhausted');
            // The pinned library retries extraction/checksum errors too. Own
            // recovery here so only a classified transport error can retry,
            // and an internal attempt cannot escape the three-attempt limit.
            if (progress.stage === 'retrying') throw progress.error;
          },
          error(error) { throw error; }
        } });
      assert(now() <= deadline, 'Fixed host download infrastructure deadline exhausted');
      observed.status = 'passed'; observed.completedAt = now();
      await record?.({ schemaVersion: 1, version, deadline, status: 'passed', attempts });
      return executable;
    } catch (error) {
      observed.status = 'failed'; observed.completedAt = now();
      observed.transient = isTransientDownloadError(error);
      if (error.downloadProcess) observed.process = error.downloadProcess;
      if (error.downloadSource) observed.source = error.downloadSource;
      if (error.downloadFailure) observed.workerError = error.downloadFailure;
      observed.error = { name: error?.name ?? typeof error, code: error?.code ?? null,
        message: error?.message ?? String(error),
        ...(error instanceof AggregateError ? { causes: error.errors.map(item => ({ code: item.code, message: item.message })) } : {}) };
      const retry = observed.transient && attempt < 3 && now() + 250 * attempt < deadline;
      await record?.({ schemaVersion: 1, version, deadline, status: retry ? 'retrying' : 'failed', attempts });
      if (!retry) throw error;
      // This is infrastructure recovery before any product action. The failed
      // request remains in evidence; neither the version nor deadline changes.
      await sleep(250 * attempt);
    }
  }
  throw new Error('Fixed host download attempts exhausted');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { version: { type: 'string' }, cache: { type: 'string' },
    output: { type: 'string' }, deadline: { type: 'string' }, evidence: { type: 'string' } } });
  assert(values.version && values.cache && values.output && values.evidence, 'Fixed VS Code download arguments required');
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const executable = await downloadFixedVSCode({ version: values.version, cachePath: values.cache,
      deadline: Number(values.deadline), record: async result => {
        await fs.writeFile(values.evidence, `${JSON.stringify(result, null, 2)}\n`);
        console.error(JSON.stringify({ kind: 'fixed-host-download', ...result }));
      } }, { download: input => downloadVSCodeAttempt({ ...input, signal: controller.signal }) });
    await fs.writeFile(values.output, `${executable}\n`, { flag: 'wx' });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}
