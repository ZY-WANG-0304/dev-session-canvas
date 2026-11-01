import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { observationPolicy } from './observation-policy.mjs';
import { githubAPI } from './merge-control.mjs';
import { readJSON, writeJSON } from './receipts.mjs';

export function summarizeObservations({ plan, result, receipts = [], logs = '', history = [] }) {
  const observed = plan?.selectionResult?.observations ?? [];
  return observed.map(entry => {
    const receipt = receipts.find(item => `${item.job}/${item.variant}/${item.taskID}` === entry.key);
    const status = receipt?.status ?? 'not-run';
    const ownFailures = JSON.stringify(receipt?.failures ?? []);
    const matched = status === 'failed' && entry.failurePatterns.some(pattern => new RegExp(pattern, 'i').test(ownFailures + '\n' + (logs[entry.key] ?? '')));
    // One first attempt per run/case is the denominator. Reruns remain visible
    // but do not erase the first failure or inflate the sample count.
    const first = new Map();
    for (const report of history) if (report.attempt === 1) {
      const sample = report.observations.find(item => item.key === entry.key);
      if (sample && ['passed', 'failed'].includes(sample.status)) first.set(report.runID, sample.status);
    }
    if (plan.run.attempt === 1 && ['passed', 'failed'].includes(status)) first.set(String(plan.run.id), status);
    return { id: entry.id, key: entry.key, status, classification: status === 'failed' ? matched ? 'registered-intermittent' : 'needs-triage' : status,
      owner: entry.owner, tracking: entry.tracking, evidence: entry.evidence, reviewAfter: entry.reviewAfter,
      firstAttempts: { failures: [...first.values()].filter(value => value === 'failed').length, samples: first.size },
      failures: receipt?.failures ?? [], infrastructureIncomplete: Boolean(result?.errors?.length || !receipt) };
  });
}
export async function readObservationHistory({ repository, api = githubAPI(repository), token = process.env.GH_TOKEN, currentRun }) {
  const history = [];
  const runs = await api('actions/workflows/ci-observations.yml/runs?per_page=20');
  for (const run of runs.workflow_runs.filter(run => run.id !== Number(currentRun) && run.status === 'completed'
    || run.id === Number(currentRun) && run.run_attempt > 1)) {
    // History is informational. It is never used to authorize a merge or to
    // manufacture a current passing test. Verify artifact identity and digest.
    const artifacts = await api(`actions/runs/${run.id}/artifacts?per_page=100`);
    for (const artifact of artifacts.artifacts.filter(item => item.name === `ci-observation-report-${run.id}-1` && !item.expired)) {
      const response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      assert(response.ok); const bytes = Buffer.from(await response.arrayBuffer());
      const { digest } = await import('./receipts.mjs');
      assert.equal(artifact.digest, `sha256:${digest(bytes)}`);
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(bytes), member = zip.file('observation-report.json');
      assert(member); const report = JSON.parse(await member.async('string'));
      assert.equal(report.runID, String(run.id)); assert.equal(report.attempt, 1);
      assert.equal(report.headSHA, run.head_sha); assert.equal(report.repository, repository);
      history.push(report);
    }
  }
  return history;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, result: { type: 'string' }, receipts: { type: 'string' }, output: { type: 'string' } } });
  let plan, result, history = [], historyError;
  try { plan = await readJSON(values.plan); } catch { /* Resolve may itself fail. */ }
  try { result = await readJSON(values.result); } catch { /* Show missing evidence honestly. */ }
  const { loadReceipts } = await import('./verify-result.mjs');
  let receipts = [];
  try { receipts = await loadReceipts(values.receipts); } catch { /* Infrastructure failure, not a product pass. */ }
  const logs = {};
  for (const entry of plan?.selectionResult?.observations ?? []) {
    const folder = path.join(values.receipts, `gate-${entry.job}-${entry.variant}-${plan.run.id}-${plan.run.attempt}`);
    const visit = async directory => { for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.name.endsWith('.log') && (await fs.stat(file)).size <= 2 * 1024 ** 2) logs[entry.key] = (logs[entry.key] ?? '') + await fs.readFile(file, 'utf8');
    } };
    try { await visit(folder); } catch { /* Report unknown signature when logs are absent. */ }
  }
  try { history = await readObservationHistory({ repository: process.env.GITHUB_REPOSITORY, currentRun: process.env.GITHUB_RUN_ID }); }
  catch (error) { historyError = error.message; }
  const report = { schemaVersion: 1, kind: 'nonblocking-observation', repository: process.env.GITHUB_REPOSITORY,
    runID: process.env.GITHUB_RUN_ID, attempt: Number(process.env.GITHUB_RUN_ATTEMPT), headSHA: plan?.run.headSHA ?? process.env.GITHUB_SHA,
    observations: summarizeObservations({ plan, result, receipts, logs, history }),
    infrastructure: plan && result ? result.status : 'incomplete', historyError: historyError ?? null,
    registered: observationPolicy.entries.map(entry => ({ id: entry.id, owner: entry.owner, tracking: entry.tracking })) };
  await writeJSON(path.join(values.output, 'observation-report.json'), report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## 非阻塞稳定性观察', '', '此结果不进入合并等待链；失败和未运行不表示通过。', '',
      '| 检查 | 本轮状态 | 分类 | 首轮失败/样本 | 跟踪 |', '| --- | --- | --- | --- | --- |'];
    for (const item of report.observations) lines.push(`| ${item.id} | ${item.status} | ${item.classification} | ${item.firstAttempts.failures}/${item.firstAttempts.samples} | ${item.owner} · ${item.tracking} |`);
    if (!report.observations.length) lines.push('', `未取得可报告样本；基础设施状态：${report.infrastructure}。`);
    if (historyError) lines.push('', '历史样本获取不完整，本轮数据保留，频率不代表完整历史。');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}
