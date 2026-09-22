// Finite admission model diagnostics only. No native process, PTY, or product
// component is loaded by this entry point.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_SCHEMA, OwnerQuarantineModel, RESOURCE_KINDS, SLOT_CAPACITY, UNKNOWN_THRESHOLD } from './runtime-owner-quarantine-model-v1.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const MODEL = fileURLToPath(new URL('./runtime-owner-quarantine-model-v1.mjs', import.meta.url));
const SCHEMA = 'runtime-owner-quarantine-evidence-v1';
const scope = 'D4 finite owner-quarantine model only; no native process, PTY, Host, Supervisor, Webview, or production acceptance.';
const clone = (value) => structuredClone(value);
const json = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const filesUnder = (directory, prefix = '') => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
  return entry.isDirectory() ? filesUnder(path.join(directory, entry.name), relative) : [relative];
}).sort();
const writeManifest = (directory) => json(path.join(directory, 'manifest.json'), {
  algorithm: 'sha256', files: Object.fromEntries(filesUnder(directory).filter((name) => name !== 'manifest.json')
    .map((name) => [name, sha256(fs.readFileSync(path.join(directory, name)))])),
});

const BASE_SCHEDULE = Object.freeze([
  ['D4-01', 'A/B 原子预留后 C 因容量拒绝，零资源失败归还槽位'],
  ['D4-02', 'A unknown 触发熔断，B 继续服务与结算，C 拒绝'],
  ['D4-03', 'A/B 同时 unknown 仍占满两个槽位，C 拒绝'],
  ['D4-04', '同 operation 迟到完整释放后显式重新准入'],
  ['D4-05', '重复释放幂等，冲突参数拒绝且 dispatch 不增加'],
  ['D4-06', '旧 generation 与跨 execution 回执不能释放新 owner'],
  ['D4-07', '重连/换代/重试不清除旧 unknown 占槽'],
  ['D4-08', '部分释放仍 unknown，陌生 identity 没有操作权'],
].map(([id, title]) => Object.freeze({ id, title })));
// The model is platform-neutral, but D4 is scheduled once for each supported
// native platform so the later native matrix cannot silently omit one side.
export const SCHEDULE = Object.freeze(['linux', 'darwin', 'win32'].flatMap((platform) => BASE_SCHEDULE.map((entry) => Object.freeze({
  ...entry, baseId: entry.id, platform, id: `${entry.id}-${platform}`,
}))));

const allocation = (id, label) => `${id}/${label}`;
const identity = (executionId, generation = 'generation-1') => ({ executionId, generation });
const owner = (id, label, generation = 'generation-1') => ({ allocationId: allocation(id, label), identity: identity(`${id}/${label}`, generation) });

function runScenario(entry) {
  const trace = [];
  const model = new OwnerQuarantineModel({ emit: (event) => trace.push(event) });
  const A = owner(entry.id, 'A');
  const B = owner(entry.id, 'B');
  const C = owner(entry.id, 'C');
  const admit = (value, resources = RESOURCE_KINDS) => model.admit({ allocationId: value.allocationId,
    executionId: value.identity.executionId, generation: value.identity.generation, resources });
  const scenarioId = entry.baseId ?? entry.id;
  switch (scenarioId) {
    case 'D4-01': {
      admit(A);
      model.createFailed(A.allocationId, { resourceKinds: ['pipe'], error: 'injected-partial-create' });
      admit(B);
      admit(C); // capacity rejection occurs before any native-create request.
      model.createFailed(B.allocationId, { resourceKinds: [], error: 'injected-create-before-resource' });
      break;
    }
    case 'D4-02': {
      admit(A); admit(B);
      model.markUnknown(A.allocationId, 'release-observation-deadline');
      model.data(B.allocationId, 2);
      model.settle(B.allocationId, 'fresh-output-settled');
      admit(C);
      break;
    }
    case 'D4-03': {
      admit(A); admit(B);
      model.markUnknown(A.allocationId, 'owner-a-unknown');
      model.markUnknown(B.allocationId, 'owner-b-unknown');
      admit(C);
      break;
    }
    case 'D4-04': {
      admit(A); admit(B);
      const op = `${entry.id}/A/release-1`;
      model.requestRelease({ allocationId: A.allocationId, identity: A.identity, operationId: op, params: { reason: 'late-proof' } });
      model.markUnknown(A.allocationId, 'observation-deadline');
      for (const resourceKind of RESOURCE_KINDS) model.releaseResource({ allocationId: A.allocationId, identity: A.identity, operationId: op, resourceKind, late: true });
      admit(C); // explicit reopen is required after a late unknown.
      model.reopenAdmission();
      admit(C);
      break;
    }
    case 'D4-05': {
      admit(A);
      const op = `${entry.id}/A/release-1`;
      model.requestRelease({ allocationId: A.allocationId, identity: A.identity, operationId: op, params: { reason: 'normal' } });
      model.requestRelease({ allocationId: A.allocationId, identity: A.identity, operationId: op, params: { reason: 'normal' } });
      model.requestRelease({ allocationId: A.allocationId, identity: A.identity, operationId: op, params: { reason: 'different' } });
      for (const resourceKind of RESOURCE_KINDS) model.releaseResource({ allocationId: A.allocationId, identity: A.identity, operationId: op, resourceKind });
      break;
    }
    case 'D4-06': {
      admit(A);
      model.reconnect('generation-2');
      const B2 = owner(entry.id, 'B', 'generation-2');
      admit(B2);
      const op = `${entry.id}/B/old-release`;
      model.requestRelease({ allocationId: B2.allocationId, identity: identity(B2.identity.executionId, 'generation-1'), operationId: op, params: { reason: 'stale' } });
      const currentOp = `${entry.id}/B/current-release`;
      model.requestRelease({ allocationId: B2.allocationId, identity: B2.identity, operationId: currentOp, params: { reason: 'current' } });
      model.releaseResource({ allocationId: B2.allocationId, identity: B2.identity, operationId: currentOp, resourceKind: 'pipe' });
      model.releaseResource({ allocationId: B2.allocationId, identity: B2.identity, operationId: currentOp, resourceKind: 'waiter' });
      model.releaseResource({ allocationId: B2.allocationId, identity: B2.identity, operationId: currentOp, resourceKind: 'process' });
      break;
    }
    case 'D4-07': {
      admit(A);
      model.markUnknown(A.allocationId, 'lost-generation-1-receipt');
      model.reconnect('generation-2');
      const retry = owner(entry.id, 'retry', 'generation-2');
      admit(retry);
      break;
    }
    case 'D4-08': {
      admit(A);
      const op = `${entry.id}/A/release-1`;
      model.requestRelease({ allocationId: A.allocationId, identity: A.identity, operationId: op, params: { reason: 'partial' } });
      model.releaseResource({ allocationId: A.allocationId, identity: A.identity, operationId: op, resourceKind: 'pipe' });
      model.markUnknown(A.allocationId, 'waiter-and-process-unconfirmed');
      model.requestRelease({ allocationId: A.allocationId, identity: identity('stranger'), operationId: `${entry.id}/stranger/release`, params: { reason: 'forged' } });
      break;
    }
    default: throw new Error(`unknown case ${entry.id}`);
  }
  return { trace, snapshot: model.snapshot() };
}

function eventTypes(trace) { return trace.map((event) => event.event); }
function events(trace, type) { return trace.filter((event) => event.event === type); }

// This validator deliberately reconstructs state from the event stream. The
// model snapshot is compared only as a second integrity check.
export function validateCase(entry, trace, snapshot) {
  const errors = [];
  const state = new Map();
  const releases = new Map();
  let nativeCreateRequests = 0;
  let admissionBlocked = false;
  const reject = (message) => errors.push(message);
  if (!Array.isArray(trace) || trace.length === 0) reject('trace is empty');
  for (let index = 0; index < (trace?.length ?? 0); index += 1) {
    const item = trace[index];
    if (item?.sequence !== index + 1) reject(`trace sequence ${index + 1} is not contiguous`);
    const detail = item?.detail ?? {};
    const id = detail.allocationId;
    switch (item?.event) {
      case 'admitted':
        if (state.has(id)) reject(`duplicate admission ${id}`);
        if ([...state.values()].filter((value) => value.status !== 'released').length >= SLOT_CAPACITY) reject(`admission over capacity ${id}`);
        const resourceKinds = Array.isArray(detail.resources) ? detail.resources : RESOURCE_KINDS;
        state.set(id, { executionId: detail.identity?.executionId, generation: detail.identity?.generation, status: 'active', resources: new Map(resourceKinds.map((kind) => [kind, 'retained'])) });
        break;
      case 'native-create-request':
        nativeCreateRequests += 1;
        if (!state.has(id)) reject(`create request without admission ${id}`);
        if (detail.requestNumber !== nativeCreateRequests) reject(`create request counter mismatch ${id}`);
        break;
      case 'native-create-returned':
        if (!state.has(id)) reject(`create return without admission ${id}`);
        else if (Array.isArray(detail.resourceKinds)) state.get(id).resources = new Map(detail.resourceKinds.map((kind) => [kind, 'retained']));
        break;
      case 'create-failed-no-resource':
        if (!state.has(id)) reject(`no-resource failure without admission ${id}`);
        state.delete(id);
        break;
      case 'create-failed-partial':
        if (!state.has(id)) reject(`partial failure without admission ${id}`);
        else {
          state.get(id).status = 'partial-create';
          if (Array.isArray(detail.retained)) state.get(id).resources = new Map(detail.retained.map((kind) => [kind, 'retained']));
        }
        break;
      case 'owner-data':
      case 'owner-settlement':
        if (!state.has(id) || state.get(id).status === 'released') reject(`activity for invalid owner ${id}`);
        break;
      case 'owner-unknown':
        if (!state.has(id) || state.get(id).status === 'released') reject(`unknown for invalid owner ${id}`);
        else { state.get(id).status = 'unknown'; admissionBlocked = true; }
        break;
      case 'generation-updated':
        if (!Array.isArray(detail.retainedAllocations) || detail.retainedAllocations.some((value) => !state.has(value))) reject('generation update dropped an owner');
        break;
      case 'release-requested':
        if (!state.has(id)) reject(`release request for missing owner ${id}`);
        else {
          state.get(id).status = 'release-in-flight';
          releases.set(detail.operationId, { allocationId: id, identity: clone(state.get(id)), resources: new Map() });
        }
        break;
      case 'release-reused':
        if (!releases.has(detail.operationId)) reject(`release reuse without original ${detail.operationId}`);
        break;
      case 'release-resource': {
        const release = releases.get(detail.operationId);
        if (!release || release.allocationId !== id) reject(`resource release for wrong operation ${detail.operationId}`);
        else if (release.resources.has(detail.resourceKind) && release.resources.get(detail.resourceKind) !== detail.result) reject(`conflicting resource result ${detail.resourceKind}`);
        else if (release) {
          release.resources.set(detail.resourceKind, detail.result);
          const current = state.get(id);
          if (!current) reject(`resource release after owner removal ${id}`);
          else current.resources.set(detail.resourceKind, detail.result);
        }
        break;
      }
      case 'owner-released':
        if (!state.has(id)) reject(`release of missing owner ${id}`);
        else state.get(id).status = 'released';
        break;
      case 'admission-reopened':
        if ([...state.values()].some((value) => value.status === 'unknown')) reject('reopened while unknown owner remained');
        admissionBlocked = false;
        break;
      case 'rejected':
        break;
      default:
        reject(`unexpected event ${item?.event}`);
    }
  }
  const expected = {
    'D4-01': () => {
      if (nativeCreateRequests !== 2) reject('D4-01 expected two native-create requests');
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'capacity')) reject('D4-01 missing capacity rejection');
      if (!events(trace, 'create-failed-partial').length) reject('D4-01 missing partial-create slot retention');
      if (!events(trace, 'create-failed-no-resource').length) reject('D4-01 missing zero-resource slot return');
    },
    'D4-02': () => {
      if (!events(trace, 'owner-unknown').some((event) => event.detail.allocationId.endsWith('/A'))) reject('D4-02 missing A unknown');
      if (!events(trace, 'owner-data').some((event) => event.detail.allocationId.endsWith('/B'))) reject('D4-02 missing B data');
      if (!events(trace, 'owner-settlement').some((event) => event.detail.allocationId.endsWith('/B'))) reject('D4-02 missing B settlement');
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'unknown-quarantine')) reject('D4-02 missing C quarantine rejection');
    },
    'D4-03': () => {
      if (events(trace, 'owner-unknown').length !== 2) reject('D4-03 expected two unknown owners');
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'unknown-quarantine')) reject('D4-03 missing quarantine rejection');
    },
    'D4-04': () => {
      if (!events(trace, 'owner-released').some((event) => event.detail.late === true)) reject('D4-04 missing late full release');
      if (!events(trace, 'admission-reopened').length) reject('D4-04 missing explicit reopen');
      if (events(trace, 'admitted').filter((event) => event.detail.allocationId.endsWith('/C')).length !== 1) reject('D4-04 C was not admitted once');
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'unknown-quarantine')) reject('D4-04 missing pre-reopen rejection');
    },
    'D4-05': () => {
      if (events(trace, 'release-requested').length !== 1) reject('D4-05 dispatched release more than once');
      if (events(trace, 'release-reused').length !== 1) reject('D4-05 missing one release reuse');
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'conflicting-release')) reject('D4-05 missing conflicting release rejection');
    },
    'D4-06': () => {
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'identity-mismatch')) reject('D4-06 missing stale identity rejection');
      if (!events(trace, 'owner-released').some((event) => event.detail.allocationId.endsWith('/B'))) reject('D4-06 current B was not released');
      const finalA = [...state.entries()].find(([id]) => id.endsWith('/A'))?.[1];
      if (!finalA || finalA.status !== 'active') reject('D4-06 stale receipt changed A');
    },
    'D4-07': () => {
      if (!events(trace, 'generation-updated').length) reject('D4-07 missing generation update');
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'unknown-quarantine')) reject('D4-07 retry unexpectedly bypassed quarantine');
      const Astate = [...state.entries()].find(([id]) => id.endsWith('/A'))?.[1];
      if (!Astate || Astate.status !== 'unknown') reject('D4-07 old unknown owner was cleared');
    },
    'D4-08': () => {
      if (!events(trace, 'release-resource').some((event) => event.detail.resourceKind === 'pipe' && event.detail.result === 'released')) reject('D4-08 missing pipe release');
      if (!events(trace, 'owner-unknown').length) reject('D4-08 missing partial unknown');
      if (!events(trace, 'rejected').some((event) => event.detail.reason === 'identity-mismatch')) reject('D4-08 stranger gained operation access');
      const Astate = [...state.entries()].find(([id]) => id.endsWith('/A'))?.[1];
      if (!Astate || Astate.status !== 'unknown') reject('D4-08 partial release returned slot');
    },
  }[entry.baseId ?? entry.id];
  expected?.();
  const snapshotSummary = snapshot && {
    occupied: snapshot.occupied,
    unknownCount: snapshot.unknownCount,
    nativeCreateRequests: snapshot.nativeCreateRequests,
    admissionBlocked: snapshot.admissionBlocked,
    owners: snapshot.owners.map((value) => ({ allocationId: value.allocationId, status: value.status })),
  };
  const replaySummary = {
    occupied: [...state.values()].filter((value) => value.status !== 'released').length,
    unknownCount: [...state.values()].filter((value) => value.status === 'unknown').length,
    nativeCreateRequests,
    admissionBlocked,
    owners: [...state.entries()].map(([allocationId, value]) => ({ allocationId, status: value.status })),
  };
  if (JSON.stringify(snapshotSummary) !== JSON.stringify(replaySummary)) reject('model snapshot differs from independent replay');
  return { id: entry.id, baseId: entry.baseId ?? entry.id, platform: entry.platform ?? null,
    status: errors.length ? 'evidence-error' : 'control-pass', pass: errors.length === 0, errors,
    native: false, nativeProcesses: 0, raw: { occupied: replaySummary.occupied, unknown: replaySummary.unknownCount, nativeCreateRequests },
    eventCount: trace.length };
}

function sourceHashes() {
  return Object.fromEntries([ENTRY, MODEL].map((file) => [path.basename(file), sha256(fs.readFileSync(file))]));
}

function readTrace(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function checkManifest(directory, errors) {
  try {
    const saved = readJSON(path.join(directory, 'manifest.json'));
    const actual = filesUnder(directory).filter((value) => value !== 'manifest.json');
    for (const name of actual) {
      if (saved.files?.[name] !== sha256(fs.readFileSync(path.join(directory, name)))) errors.push(`manifest hash mismatch: ${name}`);
    }
    for (const name of Object.keys(saved.files ?? {})) if (!fs.existsSync(path.join(directory, name))) errors.push(`manifest lists missing file: ${name}`);
    if (JSON.stringify(Object.keys(saved.files ?? {}).sort()) !== JSON.stringify(actual)) errors.push('manifest file set mismatch');
  } catch (error) { errors.push(`manifest: ${error.message}`); }
}

export function verifySaved(directory) {
  const errors = [];
  checkManifest(directory, errors);
  let environment;
  try {
    environment = readJSON(path.join(directory, 'environment.json'));
    if (environment.schema !== SCHEMA || environment.modelSchema !== MODEL_SCHEMA || environment.capacity !== SLOT_CAPACITY || environment.unknownThreshold !== UNKNOWN_THRESHOLD || environment.nativeProcesses !== 0) errors.push('frozen finite-model environment mismatch');
    if (JSON.stringify(environment.sourceHashes) !== JSON.stringify(sourceHashes())) errors.push('source hash mismatch against current validator');
    for (const file of [ENTRY, MODEL]) {
      const name = path.basename(file);
      const saved = path.join(directory, 'sources', name);
      if (!fs.existsSync(saved) || sha256(fs.readFileSync(saved)) !== environment.sourceHashes?.[name]) errors.push(`source snapshot mismatch: ${name}`);
    }
  } catch (error) { errors.push(`environment/source: ${error.message}`); }
  let schedule;
  try {
    schedule = readJSON(path.join(directory, 'schedule.json'));
    if (JSON.stringify(schedule) !== JSON.stringify(SCHEDULE)) errors.push('frozen schedule mismatch');
  } catch (error) { errors.push(`schedule: ${error.message}`); schedule = SCHEDULE; }
  const cases = SCHEDULE.map((entry) => {
    try {
      const root = path.join(directory, entry.id);
      const trace = readJSON(path.join(root, 'trace.json'));
      const snapshot = readJSON(path.join(root, 'snapshot.json'));
      const result = validateCase(entry, trace, snapshot);
      const saved = readJSON(path.join(root, 'assessment.json'));
      if (JSON.stringify(saved) !== JSON.stringify(result)) result.errors.push('saved assessment differs from independent event derivation');
      if (result.errors.length) result.status = 'evidence-error';
      return result;
    } catch (error) { return { id: entry.id, status: 'evidence-error', pass: false, errors: [String(error)] }; }
  });
  try {
    const savedSummary = readJSON(path.join(directory, 'summary.json'));
    const expectedSummary = { schema: SCHEMA, modelSchema: MODEL_SCHEMA, scope, count: cases.length, capacity: SLOT_CAPACITY,
      unknownThreshold: UNKNOWN_THRESHOLD, native: false, nativeProcesses: 0, pass: cases.every((entry) => entry.status === 'control-pass'), cases };
    if (JSON.stringify(savedSummary) !== JSON.stringify(expectedSummary)) errors.push('saved summary differs from independent case verification');
  } catch (error) { errors.push(`summary: ${error.message}`); }
  return { schema: SCHEMA, checked: cases.length, pass: errors.length === 0 && cases.every((entry) => entry.status === 'control-pass'), errors, cases, nativeProcesses: 0 };
}

function runMatrix(directory) {
  if (fs.existsSync(directory)) throw new Error(`Refusing to overwrite evidence: ${directory}`);
  fs.mkdirSync(directory, { recursive: false });
  fs.mkdirSync(path.join(directory, 'sources'));
  const hashes = sourceHashes();
  for (const file of [ENTRY, MODEL]) fs.copyFileSync(file, path.join(directory, 'sources', path.basename(file)), fs.constants.COPYFILE_EXCL);
  json(path.join(directory, 'schedule.json'), SCHEDULE);
  json(path.join(directory, 'environment.json'), { schema: SCHEMA, modelSchema: MODEL_SCHEMA, scope, capacity: SLOT_CAPACITY,
    unknownThreshold: UNKNOWN_THRESHOLD, nativeProcesses: 0, native: false, platform: process.platform, arch: process.arch,
    node: process.version, release: os.release(), sourceHashes: hashes, sourceCommit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    github: { sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null },
    createdAt: new Date().toISOString() });
  const results = [];
  for (const entry of SCHEDULE) {
    const root = path.join(directory, entry.id);
    fs.mkdirSync(root);
    const run = runScenario(entry);
    json(path.join(root, 'trace.json'), run.trace);
    json(path.join(root, 'snapshot.json'), run.snapshot);
    const result = validateCase(entry, run.trace, run.snapshot);
    json(path.join(root, 'assessment.json'), result);
    writeManifest(root);
    results.push(result);
    process.stdout.write(`${entry.id}: ${result.status}\n`);
  }
  const summary = { schema: SCHEMA, modelSchema: MODEL_SCHEMA, scope, count: results.length, capacity: SLOT_CAPACITY,
    unknownThreshold: UNKNOWN_THRESHOLD, native: false, nativeProcesses: 0, pass: results.every((entry) => entry.status === 'control-pass'), cases: results };
  json(path.join(directory, 'summary.json'), summary);
  writeManifest(directory);
  const verification = verifySaved(directory);
  process.stdout.write(`${JSON.stringify({ output: directory, pass: verification.pass, checked: verification.checked })}\n`);
  return verification;
}

function selfTest() {
  const root = path.resolve(process.env.DSC_OWNER_QUARANTINE_SELFTEST_EVIDENCE ?? path.join(os.tmpdir(), `dsc-owner-quarantine-v1-selftest-${randomUUID()}`));
  const assertions = [];
  const check = (name, condition) => { assertions.push({ name, pass: Boolean(condition) }); assert.ok(condition, name); };
  fs.mkdirSync(root, { recursive: false });
  try {
    const outputs = SCHEDULE.map((entry) => ({ entry, ...runScenario(entry) }));
    for (const output of outputs) check(`${output.entry.id} validates`, validateCase(output.entry, output.trace, output.snapshot).pass);
    const duplicate = outputs.find((value) => value.entry.baseId === 'D4-05');
    check('duplicate release dispatch is one', events(duplicate.trace, 'release-requested').length === 1 && events(duplicate.trace, 'release-reused').length === 1);
    const forged = outputs.find((value) => value.entry.baseId === 'D4-02');
    const forgedTrace = forged.trace.map((event) => event.event === 'owner-unknown' ? { ...event, detail: { ...event.detail, allocationId: `${forged.entry.id}/B` } } : event);
    check('independent validator rejects forged owner identity', !validateCase(forged.entry, forgedTrace, forged.snapshot).pass);
    const missing = outputs.find((value) => value.entry.baseId === 'D4-04');
    check('independent validator rejects missing explicit reopen', !validateCase(missing.entry, missing.trace.filter((event) => event.event !== 'admission-reopened'), missing.snapshot).pass);
    json(path.join(root, 'self-test.json'), { schema: SCHEMA, synthetic: true, nativeProcesses: 0, pass: true, assertions });
    writeManifest(root);
    process.stdout.write(`self-test: ${assertions.length}/${assertions.length} passed; finite model only\n`);
  } catch (error) {
    try { json(path.join(root, 'self-test.json'), { schema: SCHEMA, synthetic: true, nativeProcesses: 0, pass: false, assertions, error: String(error.stack ?? error) }); writeManifest(root); } catch {}
    throw error;
  }
}

const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === '--self-test') selfTest();
  else if (args.length === 2 && args[0] === '--output') process.exitCode = runMatrix(path.resolve(args[1])).pass ? 0 : 1;
  else if (args.length === 2 && args[0] === '--verify-saved') {
    const result = verifySaved(path.resolve(args[1]));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.pass ? 0 : 1;
  } else throw new Error('Usage: --self-test | --output NEW_DIRECTORY | --verify-saved DIRECTORY');
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}
