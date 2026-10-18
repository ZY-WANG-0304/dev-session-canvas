import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {downloadAndUnzipVSCode} from '@vscode/test-electron';
import request from '@vscode/test-electron/out/request.js';

const transportCodes = new Set(['ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN']);
export function isTransientDownloadError(error) {
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isTransientDownloadError);
  return error instanceof request.TimeoutError || transportCodes.has(error?.code);
}

export async function downloadFixedVSCode({ version, cachePath, deadline, record },
  { download = downloadAndUnzipVSCode, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  assert(/^\d+\.\d+\.\d+$/u.test(version), 'The host download requires one fixed release version');
  assert(cachePath && Number.isFinite(deadline) && deadline > now(), 'The original host download deadline is required');
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert(now() < deadline, 'Fixed host download infrastructure deadline exhausted');
    const observed = { attempt, version, startedAt: now(), deadline, status: 'running' };
    attempts.push(observed);
    await record?.({ schemaVersion: 1, version, deadline, status: 'running', attempts });
    try {
      const executable = await download({ version, cachePath, timeout: Math.min(30000, deadline - now()),
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
  const executable = await downloadFixedVSCode({ version: values.version, cachePath: values.cache,
    deadline: Number(values.deadline), record: async result => {
      await fs.writeFile(values.evidence, `${JSON.stringify(result, null, 2)}\n`);
      console.error(JSON.stringify({ kind: 'fixed-host-download', ...result }));
    } });
  await fs.writeFile(values.output, `${executable}\n`, { flag: 'wx' });
}
