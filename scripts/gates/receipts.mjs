import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { taskKey } from './catalog.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  const json = JSON.stringify(value);
  assert(json !== undefined, 'Receipts cannot contain undefined values');
  return json;
}
export const objectDigest = value => digest(canonicalJSON(value));
export const fileDigest = async file => digest(await fs.readFile(file));
export const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temporary, file);
}
export function assertSHA(value, label = 'inputSHA') {
  assert.match(value ?? '', /^[a-f0-9]{40}$/, `${label} must be a complete immutable SHA`);
}
export function assertDigest(value, label) {
  assert.match(value ?? '', /^[a-f0-9]{64}$/, `${label} must be SHA256`);
}
export function assertRecord(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}
export function validatePlan(plan) {
  assertRecord(plan, 'plan');
  assert.equal(plan.schemaVersion, 1, 'Unknown gate plan schema');
  assert(['pr', 'release-pr', 'release-tag', 'channel-retry', 'diagnostic', 'observational'].includes(plan.mode));
  assertSHA(plan.inputSHA); assertSHA(plan.headSHA, 'headSHA'); assertSHA(plan.baseSHA, 'baseSHA');
  for (const label of ['policyDigest', 'catalogDigest', 'environmentDigest', 'budgetDigest']) assertDigest(plan[label], label);
  assertRecord(plan.run, 'run');
  assert.match(String(plan.run.id), /^(?:local-[a-zA-Z0-9-]+|[1-9]\d*)$/);
  assert(Number.isSafeInteger(plan.run.attempt) && plan.run.attempt >= 1);
  assertSHA(plan.run.headSHA, 'run headSHA');
  assert(Array.isArray(plan.tasks) && plan.tasks.length > 0, 'Empty gate plans are forbidden');
  const keys = new Set();
  for (const task of plan.tasks) {
    assertRecord(task, 'task');
    for (const name of ['job', 'id', 'variant']) assert.equal(typeof task[name], 'string');
    assert(!keys.has(taskKey(task)), `Duplicate task ${taskKey(task)}`); keys.add(taskKey(task));
    assert.equal(typeof task.required, 'boolean');
    assert(Array.isArray(task.stages) && task.stages.length && new Set(task.stages).size === task.stages.length);
    assert(task.stages.every(stage => ['prepare', 'build', 'load', 'action', 'assert', 'cleanup', 'host-exit'].includes(stage)));
    assert(Number.isSafeInteger(task.timeoutMs) && task.timeoutMs > 0, 'Every task needs a frozen deadline budget');
  }
  if (['pr', 'release-pr', 'release-tag'].includes(plan.mode)) assert(plan.tasks.some(task => task.required));
  if (['release-pr', 'release-tag', 'channel-retry'].includes(plan.mode)) assert.match(plan.version ?? '', /^\d+\.\d+\.\d+$/);
  return plan;
}

export function producerFor(plan, job, variant, env = process.env) {
  return { runID: String(plan.run.id), attempt: plan.run.attempt, job, variant,
    repository: env.GITHUB_REPOSITORY || 'local', jobName: `Gate ${job} (${variant})` };
}
export function newTaskReceipt(plan, task, env = process.env) {
  return { schemaVersion: 1, planDigest: objectDigest(plan), inputSHA: plan.inputSHA,
    taskID: task.id, job: task.job, variant: task.variant,
    environmentDigest: plan.environmentDigest, producer: producerFor(plan, task.job, task.variant, env),
    status: 'not-run', startedAt: null, completedAt: null, deadline: null,
    stages: Object.fromEntries(task.stages.map(stage => [stage, { status: 'not-run' }])),
    consumed: [], evidence: [], failures: [] };
}
export function validateTaskReceipt(receipt, plan, task) {
  assertRecord(receipt, 'task receipt');
  assert.equal(receipt.schemaVersion, 1, 'Unknown task receipt schema');
  assert.equal(receipt.planDigest, objectDigest(plan), 'Receipt belongs to another plan');
  assert.equal(receipt.inputSHA, plan.inputSHA, 'Receipt input differs');
  assert.equal(receipt.environmentDigest, plan.environmentDigest, 'Receipt environment differs');
  assert.equal(receipt.taskID, task.id); assert.equal(receipt.job, task.job); assert.equal(receipt.variant, task.variant);
  assertRecord(receipt.producer, 'producer');
  assert.equal(receipt.producer.runID, String(plan.run.id)); assert.equal(receipt.producer.attempt, plan.run.attempt);
  assert.equal(receipt.producer.job, task.job); assert.equal(receipt.producer.variant, task.variant);
  assert.equal(receipt.producer.jobName, `Gate ${task.job} (${task.variant})`);
  assert.equal(typeof receipt.producer.repository, 'string');
  assert(['passed', 'failed', 'cancelled', 'not-run'].includes(receipt.status), 'Unknown task result');
  assertRecord(receipt.stages, 'stages');
  assert.deepEqual(Object.keys(receipt.stages).sort(), [...task.stages].sort(), 'Stages cannot be changed after execution');
  for (const result of Object.values(receipt.stages)) {
    assertRecord(result, 'stage');
    assert(['passed', 'failed', 'cancelled', 'not-run'].includes(result.status), 'Unknown stage result');
  }
  if (receipt.status === 'passed') {
    assert(Object.values(receipt.stages).every(result => result.status === 'passed'), 'A failed/missing stage cannot pass');
    assert(Number.isFinite(Date.parse(receipt.startedAt)) && Number.isFinite(Date.parse(receipt.completedAt)));
    assert(Number.isFinite(receipt.deadline) && receipt.deadline - Date.parse(receipt.startedAt) <= task.timeoutMs + 2
      && Date.parse(receipt.completedAt) <= receipt.deadline,
      'Task completed after its original deadline');
    for (const stage of Object.values(receipt.stages)) {
      assert(Number.isFinite(Date.parse(stage.startedAt)) && Number.isFinite(Date.parse(stage.completedAt)),
        'A passing stage requires actual start/completion timestamps');
      assert(Date.parse(stage.startedAt) >= Date.parse(receipt.startedAt)
        && Date.parse(stage.completedAt) >= Date.parse(stage.startedAt)
        && Date.parse(stage.completedAt) <= Date.parse(receipt.completedAt));
    }
  }
  assert(Array.isArray(receipt.consumed) && Array.isArray(receipt.evidence) && Array.isArray(receipt.failures));
  if (receipt.status === 'passed') assert.equal(receipt.failures.length, 0, 'Successful receipts cannot erase failures');
  return receipt;
}

export function validatePackageReceipt(receipt, plan) {
  assertRecord(receipt, 'package receipt'); assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.inputSHA, plan.inputSHA); assert.equal(receipt.planDigest, objectDigest(plan));
  assert.equal(receipt.profile, 'platform');
  assert.deepEqual(receipt.admission, { executions: null, starting: 1, pending: 2 });
  assert.equal(receipt.production, true); assert.equal(receipt.readmeRef, plan.inputSHA);
  assert.equal(receipt.environmentDigest, plan.environmentDigest);
  assert.deepEqual(receipt.buildCount, { main: 1, notifier: 1 });
  assert.equal(receipt.npmHooksStripped, true);
  for (const label of ['sourceDigest', 'lockDigest', 'nativeSetDigest']) assertDigest(receipt[label], label);
  assertRecord(receipt.producer, 'package producer');
  assert.equal(receipt.producer.runID, String(plan.run.id)); assert.equal(receipt.producer.attempt, plan.run.attempt);
  assert.equal(receipt.producer.job, 'package-clean'); assert.equal(receipt.producer.variant, 'default');
  assert.equal(receipt.producer.jobName, 'Gate package-clean (default)');
  assert(Array.isArray(receipt.packages));
  assert.equal(receipt.packages.length, 2, 'A release candidate is exactly two packages');
  const expected = ['devsessioncanvas.dev-session-canvas', 'devsessioncanvas.dev-session-canvas-notifier'];
  assert.deepEqual(receipt.packages.map(pkg => pkg.id).sort(), expected.sort());
  for (const pkg of receipt.packages) {
    assert.equal(pkg.version, plan.version);
    assert.equal(pkg.path, pkg.id.endsWith('-notifier') ? 'notifier.vsix' : 'main.vsix');
    assertDigest(pkg.sha256, 'package hash');
    assertDigest(pkg.payloadDigest, 'package payload hash');
    assert(Number.isSafeInteger(pkg.size) && pkg.size > 0);
  }
  return receipt;
}
export async function verifyPackageFiles(receipt, plan, directory) {
  validatePackageReceipt(receipt, plan);
  for (const pkg of receipt.packages) {
    const file = path.join(directory, pkg.path);
    const stat = await fs.lstat(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Package path must be a regular file');
    assert.equal(stat.size, pkg.size, 'Package size changed');
    assert.equal(await fileDigest(file), pkg.sha256, 'Package bytes changed');
  }
  return receipt;
}
