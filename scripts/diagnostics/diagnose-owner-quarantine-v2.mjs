// D4 v2 is a deterministic N2/Q1 model. No PTY, native release or production imports.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { OwnerQuarantineModelV2 } from './runtime-owner-quarantine-model-v2.mjs';
import { SCHEDULE, makeFixtures } from './owner-quarantine-fixtures-v2.mjs';
import { deriveCase, verifyCase } from './owner-quarantine-oracle-v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = ['runtime-owner-quarantine-model-v2.mjs', 'owner-quarantine-oracle-v2.mjs',
  'diagnose-owner-quarantine-v2.mjs', 'owner-quarantine-fixtures-v2.mjs'];
const CASE_FILES = ['commands.json', 'expectations.json', 'evidence.json', 'assessment.json'];
const NEGATIVE_FILES = ['commands.json', 'expectations.json', 'evidence.json', 'forged-assessment.json', 'expected.json', 'actual.json', 'manifest.json'];
const SAVED_VARIANTS = [['bad-root-manifest', 16], ['null-root-manifest', 16], ['bad-first-case-json', 15], ['rehashed-semantic-first-case', 15]];
const SCOPE = 'D4 v2 deterministic finite model only: N=2, Q=1; 16 cases once; zero native/PTY tests and zero real concurrency. failureDomainId is a logical label, not OS isolation.';
const copy = (value) => structuredClone(value);
const bytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => isDeepStrictEqual(a, b);
const errorText = (error) => `${error.name}: ${error.message}`;
const write = (directory, name, value) => fs.writeFileSync(path.join(directory, name), value, { flag: 'wx' });
const writeJSON = (directory, name, value) => write(directory, name, bytes(value));
const directory = (name) => fs.mkdirSync(name, { recursive: false });
const safeRelative = (name) => typeof name === 'string' && name.length > 0 && !name.includes('\\')
  && !path.posix.isAbsolute(name) && name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
function readRegular(root, name) {
  if (!safeRelative(name)) throw new Error('unsafe relative path');
  const parts = name.split('/');
  let target = root;
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i]);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error(`not an ordinary path: ${name}`);
  }
  return fs.readFileSync(target);
}
function inventory(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`symlink in inventory: ${name}`);
    if (entry.isDirectory()) return inventory(root, name);
    if (!entry.isFile()) throw new Error(`non-file in inventory: ${name}`);
    return [name];
  }).sort();
}
function manifest(root, identity, paths = inventory(root).filter((name) => name !== 'manifest.json')) {
  return { schema: 'owner-quarantine-manifest-v2', ...identity, files: paths.map((name) => {
    const data = readRegular(root, name); return { path: name, size: data.length, sha256: digest(data) };
  }) };
}
function sealDirectory(root, identity) { writeJSON(root, 'manifest.json', manifest(root, identity)); }
function checkManifest(root, identity, expectedPaths) {
  const errors = [];
  let value;
  let parsed = false;
  try { value = JSON.parse(readRegular(root, 'manifest.json')); parsed = true; }
  catch (error) { errors.push({ code: 'manifest-read', path: 'manifest.json', detail: errorText(error) }); }
  if (parsed && (!value || typeof value !== 'object' || Array.isArray(value))) {
    errors.push({ code: 'manifest-shape', path: 'manifest.json' });
  } else if (parsed) {
    if (!same(Object.keys(value).sort(), ['schema', ...Object.keys(identity), 'files'].sort())
      || value.schema !== 'owner-quarantine-manifest-v2' || Object.keys(identity).some((key) => !same(value[key], identity[key]))) {
      errors.push({ code: 'manifest-identity', path: 'manifest.json' });
    }
    if (!Array.isArray(value.files) || !same(value.files.map((entry) => entry?.path), expectedPaths)) {
      errors.push({ code: 'manifest-inventory', path: 'manifest.json' });
    }
    const seen = new Set();
    for (const entry of Array.isArray(value.files) ? value.files : []) {
      if (!entry || !same(Object.keys(entry).sort(), ['path', 'sha256', 'size']) || !safeRelative(entry.path)
        || seen.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        errors.push({ code: 'manifest-entry', path: entry?.path ?? 'manifest.json' }); continue;
      }
      seen.add(entry.path);
      try {
        const data = readRegular(root, entry.path);
        if (data.length !== entry.size || digest(data) !== entry.sha256) errors.push({ code: 'manifest-content', path: entry.path });
      } catch (error) { errors.push({ code: 'manifest-file', path: entry.path, detail: errorText(error) }); }
    }
  }
  try {
    if (!same(inventory(root), [...expectedPaths, 'manifest.json'].sort())) errors.push({ code: 'directory-inventory', path: '/' });
  } catch (error) { errors.push({ code: 'directory-inventory', path: '/', detail: errorText(error) }); }
  return errors;
}
function matrixPaths() {
  return ['environment.json', 'schedule.json', 'run-report.json', ...SOURCES.map((name) => `sources/${name}`),
    ...SCHEDULE.flatMap((entry) => [...CASE_FILES, 'manifest.json'].map((name) => `cases/${entry.id}/${name}`))].sort();
}
function sourceInfo() {
  return SOURCES.map((name) => {
    const data = fs.readFileSync(path.join(HERE, name));
    return { path: name, size: data.length, sha256: digest(data), normalizedSha256: digest(data.toString('utf8').replace(/\r\n/g, '\n')) };
  });
}
function environment(runId) {
  let gitHead = null; let gitStatus = null; let gitError = null;
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim();
    gitStatus = execFileSync('git', ['status', '--short'], { cwd: HERE, encoding: 'utf8' });
  } catch (error) { gitError = errorText(error); }
  return { schema: 'owner-quarantine-environment-v2', runId, scope: SCOPE, node: process.version,
    nodeExecutable: process.execPath, platform: process.platform, arch: process.arch, osRelease: os.release(),
    gitHead, gitStatus, gitError, sourceBasis: 'Exact archived working-tree bytes; may include uncommitted files.', sources: sourceInfo() };
}
function summarize(runId, assessments) {
  return { schema: 'owner-quarantine-run-v2', runId, scope: SCOPE, scheduled: 16, attempted: assessments.length,
    verified: assessments.filter((item) => item.pass).length, checks: assessments.reduce((n, item) => n + item.checks, 0),
    commands: assessments.reduce((n, item) => n + item.commands, 0), modelRejections: assessments.reduce((n, item) => n + item.modelRejections, 0),
    pass: assessments.length === 16 && assessments.every((item) => item.pass), assessments };
}
function runMatrix(root, runId) {
  directory(root); directory(path.join(root, 'sources')); directory(path.join(root, 'cases'));
  writeJSON(root, 'environment.json', environment(runId)); writeJSON(root, 'schedule.json', SCHEDULE);
  for (const name of SOURCES) write(root, `sources/${name}`, fs.readFileSync(path.join(HERE, name)));
  const cases = [];
  for (const fixture of makeFixtures(runId)) {
    const caseRoot = path.join(root, 'cases', fixture.entry.id); directory(caseRoot);
    // Freeze raw input before invoking the model; expectations remain separate.
    writeJSON(caseRoot, 'commands.json', fixture.commands); writeJSON(caseRoot, 'expectations.json', fixture.expectations);
    const model = new OwnerQuarantineModelV2(fixture.context);
    const steps = fixture.commands.map((command) => {
      const recorded = copy(command);
      try { return { command: recorded, ...model.applyCommand(copy(command)) }; }
      catch (error) { return { command: recorded, error: { name: error.name, message: error.message }, ledger: model.snapshot() }; }
    });
    const evidence = { schema: 'owner-quarantine-evidence-v2', entry: fixture.entry, context: fixture.context, steps, final: model.snapshot() };
    const assessment = verifyCase(fixture, evidence);
    writeJSON(caseRoot, 'evidence.json', evidence); writeJSON(caseRoot, 'assessment.json', assessment);
    sealDirectory(caseRoot, { runId, caseId: fixture.entry.id });
    cases.push({ fixture, evidence, assessment });
  }
  const report = summarize(runId, cases.map((item) => item.assessment));
  writeJSON(root, 'run-report.json', report); sealDirectory(root, { runId, kind: 'matrix' });
  return { report, cases };
}

export function verifySavedMatrix(root) {
  const rootErrors = [];
  const read = (base, name, errors) => {
    try { return JSON.parse(readRegular(base, name)); }
    catch (error) { errors.push({ code: 'file-read', path: name, detail: errorText(error) }); return null; }
  };
  const env = read(root, 'environment.json', rootErrors);
  const runId = typeof env?.runId === 'string' && /^[A-Za-z0-9._:/-]{1,180}$/.test(env.runId) ? env.runId : 'unavailable-run-id';
  if (env?.schema !== 'owner-quarantine-environment-v2' || runId === 'unavailable-run-id' || env?.scope !== SCOPE) rootErrors.push({ code: 'environment-identity', path: 'environment.json' });
  rootErrors.push(...checkManifest(root, { runId, kind: 'matrix' }, matrixPaths()));
  if (!same(read(root, 'schedule.json', rootErrors), SCHEDULE)) rootErrors.push({ code: 'schedule-content', path: 'schedule.json' });
  const archivedSources = [];
  for (const name of SOURCES) {
    try {
      const data = readRegular(root, `sources/${name}`);
      const normalized = data.toString('utf8').replace(/\r\n/g, '\n');
      const trusted = fs.readFileSync(path.join(HERE, name), 'utf8').replace(/\r\n/g, '\n');
      if (normalized !== trusted) rootErrors.push({ code: 'source-mismatch', path: `sources/${name}` });
      archivedSources.push({ path: name, size: data.length, sha256: digest(data), normalizedSha256: digest(normalized) });
    } catch (error) { rootErrors.push({ code: 'source-read', path: `sources/${name}`, detail: errorText(error) }); }
  }
  if (!same(env?.sources, archivedSources)) rootErrors.push({ code: 'source-record', path: 'environment.json' });
  const cases = [];
  // Never gate case traversal on a root manifest or earlier case being valid.
  for (const fixture of makeFixtures(runId)) {
    const caseRoot = path.join(root, 'cases', fixture.entry.id);
    const errors = checkManifest(caseRoot, { runId, caseId: fixture.entry.id }, CASE_FILES.slice().sort());
    const commands = read(caseRoot, 'commands.json', errors); const expectations = read(caseRoot, 'expectations.json', errors);
    if (!same(commands, fixture.commands)) errors.push({ code: 'trusted-command-mismatch', path: 'commands.json' });
    if (!same(expectations, fixture.expectations)) errors.push({ code: 'trusted-expectation-mismatch', path: 'expectations.json' });
    const evidence = read(caseRoot, 'evidence.json', errors);
    const assessment = verifyCase(fixture, evidence);
    errors.push(...assessment.errors);
    if (!same(read(caseRoot, 'assessment.json', errors), assessment)) errors.push({ code: 'assessment-content', path: 'assessment.json' });
    cases.push({ caseId: fixture.entry.id, attempted: true, verified: errors.length === 0, errors, assessment });
  }
  const expectedReport = summarize(runId, cases.map((item) => item.assessment));
  if (!same(read(root, 'run-report.json', rootErrors), expectedReport)) rootErrors.push({ code: 'run-report-content', path: 'run-report.json' });
  return { schema: 'owner-quarantine-saved-verification-v2', runId, scope: SCOPE, attempted: cases.length,
    verified: cases.filter((item) => item.verified).length, pass: rootErrors.length === 0 && cases.every((item) => item.verified), rootErrors, cases };
}

function renumber(evidence) {
  let sequence = 0;
  for (const step of evidence.steps) for (const event of step.events) {
    event.eventSeq = ++sequence; event.commandId = step.command.commandId;
  }
}
function mutateEventFootprint(evidence, start, event, mode) {
  // Give event attacks their own altered ledgers as well as freshly numbered
  // events. Reused/rejected events legitimately have no domain-state footprint.
  for (const step of evidence.steps.slice(start)) {
    const state = step.ledger; const detail = event.details;
    const owner = state.owners.find((item) => item.allocationId === event.owner?.allocationId);
    const operationId = detail.operationId ?? detail.createOperationId;
    const operation = state.operations.find((item) => item.operationId === operationId);
    const resource = state.resources.find((item) => item.resourceId === detail.resourceId);
    const use = state.uses.find((item) => item.tokenId === detail.tokenId);
    const removing = mode === 'delete';
    switch (event.type) {
      case 'reserve':
        if (removing) {
          state.owners = state.owners.filter((item) => item.allocationId !== event.owner.allocationId);
          for (const field of ['resources', 'uses', 'operations', 'unknowns', 'receipts']) state[field] = state[field].filter((item) => item.owner.allocationId !== event.owner.allocationId);
        } else if (owner) state.owners.push(copy(owner));
        break;
      case 'dispatch-create':
        state.createDispatches += removing ? -1 : 1;
        if (operation) { operation.dispatchCount = removing ? 0 : 2; if (removing) operation.phase = 'reserved'; }
        break;
      case 'acquire':
        if (removing) {
          state.resources = state.resources.filter((item) => item.resourceId !== detail.resourceId);
          state.uses = state.uses.filter((item) => item.resourceId !== detail.resourceId);
          state.receipts = state.receipts.filter((item) => item.resourceId !== detail.resourceId);
          if (owner) owner.resourceIds = owner.resourceIds.filter((id) => id !== detail.resourceId);
          for (const op of state.operations) op.resourceIds = op.resourceIds.filter((id) => id !== detail.resourceId);
        } else if (resource) state.resources.push(copy(resource));
        break;
      case 'report-create': if (operation && removing) { operation.outcome = null; operation.phase = 'dispatched'; } break;
      case 'seal-create': if (operation && removing) { operation.phase = 'reported'; operation.resourceIds = []; } break;
      case 'begin-use':
        if (removing) state.uses = state.uses.filter((item) => item.tokenId !== detail.tokenId);
        else if (use) state.uses.push(copy(use));
        break;
      case 'end-use': if (use && removing) { use.state = 'in-flight'; use.endedBy = null; use.applied = false; } break;
      case 'request-release':
        if (removing) { state.operations = state.operations.filter((item) => item.operationId !== detail.operationId); if (owner) owner.releaseOperationId = null; }
        else if (operation) state.operations.push(copy(operation));
        break;
      case 'dispatch-release':
        state.releaseDispatches += removing ? -1 : 1;
        if (operation) { operation.dispatchCount = removing ? 0 : 2; if (removing) { operation.phase = 'queued'; operation.resourceIds = []; } }
        break;
      case 'release-evidence': {
        const receipt = state.receipts.find((item) => item.receiptId === detail.receiptId);
        if (removing) { state.receipts = state.receipts.filter((item) => item.receiptId !== detail.receiptId); if (resource) resource.releaseState = 'retained'; }
        else if (receipt) state.receipts.push(copy(receipt));
        break;
      }
      case 'unknown-observed': {
        const item = state.unknowns.find((value) => value.owner.allocationId === event.owner.allocationId && same(value.subject, detail.subject));
        if (removing) state.unknowns = state.unknowns.filter((value) => value !== item);
        else if (item) state.unknowns.push(copy(item));
        break;
      }
      case 'unknown-resolved': {
        const item = state.unknowns.find((value) => value.owner.allocationId === event.owner.allocationId && same(value.subject, detail.subject));
        if (item && removing) item.resolvedBy = null;
        break;
      }
      case 'release-completed': if (operation && removing) { operation.phase = 'dispatched'; operation.outcome = null; } break;
      case 'slot-returned': if (owner && removing) { owner.slotHeld = true; owner.returnedBy = null; } break;
      case 'advance-generation':
        if (removing) { state.currentGeneration = detail.previous; state.generations = state.generations.filter((item) => item !== detail.next); }
        else state.generations.push(detail.next);
        break;
      case 'reopen': if (removing) state.admissionBlocked = true; break;
    }
    state.occupied = state.owners.filter((item) => item.slotHeld).length;
    state.unknownCount = new Set(state.unknowns.filter((item) => item.resolvedBy === null).map((item) => item.owner.allocationId)).size;
  }
}
function semanticMutations(cases) {
  const mutations = [];
  const add = (name, base, change, expectedCode = 'ledger-semantic') => {
    const evidence = copy(base.evidence); change(evidence); renumber(evidence);
    // Persist a refreshed final snapshot and attacker-authored green assessment.
    evidence.final = copy(evidence.steps.at(-1).ledger);
    mutations.push({ name, fixture: base.fixture, evidence, expectedCode });
  };
  const representatives = new Map();
  for (const base of cases) base.evidence.steps.forEach((step, stepIndex) => step.events.forEach((event, eventIndex) => {
    if (!representatives.has(event.type)) representatives.set(event.type, { base, stepIndex, eventIndex });
  }));
  for (const [type, { base, stepIndex, eventIndex }] of representatives) {
    add(`delete-${type}`, base, (e) => {
      const [event] = e.steps[stepIndex].events.splice(eventIndex, 1); mutateEventFootprint(e, stepIndex, event, 'delete');
    }, 'event-semantic');
    add(`duplicate-${type}`, base, (e) => {
      const event = copy(e.steps[stepIndex].events[eventIndex]); e.steps[stepIndex].events.splice(eventIndex, 0, event);
      mutateEventFootprint(e, stepIndex, event, 'duplicate');
    }, 'event-semantic');
    add(`reorder-${type}`, base, (e) => {
      const step = e.steps[stepIndex];
      if (step.events.length > 1) {
        const other = (eventIndex + 1) % step.events.length;
        [step.events[eventIndex], step.events[other]] = [step.events[other], step.events[eventIndex]];
      } else {
        const other = e.steps[stepIndex + 1] ?? e.steps[stepIndex - 1];
        [step.events[eventIndex], other.events[0]] = [other.events[0], step.events[eventIndex]];
        [step.ledger, other.ledger] = [other.ledger, step.ledger];
      }
    }, 'event-semantic');
  }
  const get = (id) => cases.find((base) => base.fixture.entry.id === id);
  for (const field of ['runId', 'caseId', 'failureDomainId', 'executionId', 'ownerGeneration', 'allocationId']) {
    add(`identity-${field}`, get('D4v2-09'), (e) => {
      const step = e.steps.find((item) => item.command.kind === 'release-evidence' && item.result.status === 'accepted');
      step.events[0].owner[field] = `forged-${field}`;
      for (const later of e.steps.slice(e.steps.indexOf(step))) {
        const receipt = later.ledger.receipts.find((item) => item.receiptId === step.command.args.receiptId);
        if (receipt) receipt.owner[field] = `forged-${field}`;
      }
    }, 'event-semantic');
  }
  for (const field of ['resourceId', 'resourceKind', 'operationId', 'receiptId']) {
    add(`receipt-${field}`, get('D4v2-09'), (e) => {
      const step = e.steps.find((item) => item.command.kind === 'release-evidence' && item.result.status === 'accepted');
      step.events[0].details[field] = `forged-${field}`;
      const receipt = step.ledger.receipts.find((item) => item.receiptId === step.command.args.receiptId);
      receipt[field] = `forged-${field}`;
    }, 'event-semantic');
  }
  add('changed-release-params', get('D4v2-12'), (e) => {
    for (const step of e.steps) {
      for (const op of step.ledger.operations.filter((item) => item.type === 'release')) op.params = { reason: 'forged' };
      for (const event of step.events.filter((item) => ['request-release', 'request-release-reused'].includes(item.type))) event.details.params = { reason: 'forged' };
    }
  });
  add('drop-old-generation-owner', get('D4v2-11'), (e) => {
    for (const step of e.steps.filter((item) => item.ledger.currentGeneration === 'generation-2')) {
      step.ledger.owners = []; step.ledger.operations = []; step.ledger.unknowns = []; step.ledger.occupied = 0; step.ledger.unknownCount = 0;
    }
  });
  add('forged-occupancy', get('D4v2-02'), (e) => { e.steps.at(-1).ledger.occupied = 0; });
  add('aliased-unknown-record', get('D4v2-05'), (e) => {
    const ledger = e.steps.at(-1).ledger;
    ledger.unknowns[1] = copy(ledger.unknowns[0]); ledger.unknownCount = 1;
  });
  add('forged-reopen', get('D4v2-05'), (e) => {
    e.steps.at(-1).ledger.admissionBlocked = false;
    e.steps.at(-1).result = { status: 'accepted', reason: null, value: {} };
    e.steps.at(-1).events[0] = { ...e.steps.at(-1).events[0], type: 'reopen', owner: null, details: { expectedGeneration: 'generation-1' } };
  });
  add('forged-released', get('D4v2-07'), (e) => {
    const state = e.steps.at(-1).ledger;
    state.resources.forEach((item) => { item.releaseState = 'released'; });
    state.unknowns.forEach((item) => { item.resolvedBy = e.steps.at(-1).command.commandId; });
    state.owners.forEach((item) => { item.slotHeld = false; item.returnedBy = e.steps.at(-1).command.commandId; });
    state.operations.filter((item) => item.type === 'release').forEach((item) => { item.phase = 'complete'; item.outcome = 'released'; });
    state.unknownCount = 0; state.occupied = 0;
  });
  add('erase-first-unknown', get('D4v2-08'), (e) => {
    for (const step of e.steps) for (const item of step.ledger.unknowns) item.first = { commandId: step.command.commandId, reason: 'new-first' };
  });
  add('create-report-resolves-unknown', get('D4v2-02'), (e) => {
    const step = e.steps.find((item) => item.command.kind === 'report-create' && item.result.status === 'accepted');
    const unknown = step.ledger.unknowns.find((item) => item.subject.id === step.command.args.createOperationId);
    unknown.resolvedBy = step.command.commandId;
    step.ledger.unknownCount = new Set(step.ledger.unknowns.filter((item) => item.resolvedBy === null).map((item) => item.owner.allocationId)).size;
  });
  add('create-report-returns-slot', get('D4v2-02'), (e) => {
    const step = e.steps.find((item) => item.command.kind === 'report-create' && item.result.status === 'accepted');
    const owner = step.ledger.owners.find((item) => item.allocationId === step.command.args.owner.allocationId);
    owner.slotHeld = false; owner.returnedBy = step.command.commandId;
    step.ledger.occupied = step.ledger.owners.filter((item) => item.slotHeld).length;
  });
  add('use-end-resolves-other-token', get('D4v2-06'), (e) => {
    const step = e.steps.find((item) => item.command.kind === 'end-use' && item.result.status === 'accepted');
    const other = step.ledger.unknowns.find((item) => item.subject.kind === 'use' && item.resolvedBy === null);
    other.resolvedBy = step.command.commandId; step.ledger.unknownCount = 0;
  });
  add('use-end-returns-slot', get('D4v2-06'), (e) => {
    const step = e.steps.findLast((item) => item.command.kind === 'end-use' && item.result.status === 'accepted');
    const owner = step.ledger.owners.find((item) => item.allocationId === step.command.args.owner.allocationId);
    owner.slotHeld = false; owner.returnedBy = step.command.commandId;
    step.ledger.occupied = step.ledger.owners.filter((item) => item.slotHeld).length;
  });
  for (const [kind, caseId] of [['create', 'D4v2-02'], ['use', 'D4v2-06']]) {
    add(`${kind}-late-proof-erases-first`, get(caseId), (e) => {
      for (const step of e.steps) {
        for (const item of step.ledger.unknowns.filter((item) => item.subject.kind === kind && item.resolvedBy !== null)) {
          item.first = { commandId: item.resolvedBy, reason: 'late-proof-replaces-first' };
        }
        for (const event of step.events.filter((event) => event.type === 'unknown-resolved' && event.details.subject.kind === kind)) {
          event.details.first = { commandId: event.details.resolvedBy, reason: 'late-proof-replaces-first' };
        }
      }
    });
    add(`${kind}-late-proof-reopens-admission`, get(caseId), (e) => {
      const step = e.steps.find((item) => item.ledger.unknowns.some((unknown) => unknown.subject.kind === kind)
        && item.ledger.unknownCount === 0 && item.ledger.admissionBlocked);
      step.ledger.admissionBlocked = false;
    });
  }
  add('fake-batch-application', get('D4v2-04'), (e) => {
    for (const step of e.steps) for (const item of step.ledger.uses) { item.applied = true; item.batchId = 'forged-batch'; }
  });
  add('rejected-command-mutates-generation', get('D4v2-15'), (e) => { e.steps.at(-1).ledger.currentGeneration = 'generation-forged'; });
  add('pending-create-loses-acquisition', get('D4v2-03'), (e) => {
    const step = e.steps.find((item) => item.result.reason === 'acquisition-set-mismatch');
    step.ledger.resources = []; step.ledger.owners[0].resourceIds = [];
  });
  add('drop-terminal-tombstone', get('D4v2-14'), (e) => { e.steps.at(-1).ledger.owners = e.steps.at(-1).ledger.owners.filter((owner) => owner.slotHeld); });
  // Mutate every field family, not only the summary counters.
  for (const [field, value] of [['domains', []], ['generations', []], ['capacity', 3], ['unknownThreshold', 2],
    ['createDispatches', 999], ['releaseDispatches', 999], ['uses', []], ['receipts', []]]) {
    add(`snapshot-${field}`, get('D4v2-06'), (e) => { e.steps.at(-1).ledger[field] = copy(value); });
  }
  add('wrong-command-envelope', get('D4v2-01'), (e) => { e.steps[0].command.runId = 'wrong-run'; }, 'command-semantic');
  return { mutations, eventTypes: [...representatives.keys()].sort() };
}

function cloneArchive(source, target, replacements = new Map(), rehash = false) {
  directory(target);
  const paths = inventory(source);
  const created = new Set(['']);
  for (const name of paths) {
    if (rehash && (name === 'manifest.json' || name.endsWith('/manifest.json'))) continue;
    const parent = path.posix.dirname(name);
    if (parent !== '.' && !created.has(parent)) {
      let prefix = '';
      for (const part of parent.split('/')) {
        prefix = prefix ? `${prefix}/${part}` : part;
        if (!created.has(prefix)) { directory(path.join(target, prefix)); created.add(prefix); }
      }
    }
    write(target, name, replacements.has(name) ? replacements.get(name) : readRegular(source, name));
  }
  if (rehash) {
    const runId = JSON.parse(readRegular(target, 'environment.json')).runId;
    for (const entry of SCHEDULE) sealDirectory(path.join(target, 'cases', entry.id), { runId, caseId: entry.id });
    sealDirectory(target, { runId, kind: 'matrix' });
  }
}
function runSelfTest(root, runId) {
  directory(root);
  const matrixRoot = path.join(root, 'matrix'); const positive = runMatrix(matrixRoot, runId);
  const positiveVerification = verifySavedMatrix(matrixRoot);
  writeJSON(root, 'positive-verification.json', positiveVerification);
  const negativeRoot = path.join(root, 'semantic-negatives'); directory(negativeRoot);
  const { mutations, eventTypes } = semanticMutations(positive.cases);
  const negativeReports = [];
  for (const item of mutations) {
    const target = path.join(negativeRoot, item.name); directory(target);
    const actual = verifyCase(item.fixture, item.evidence);
    const forgedAssessment = { ...actual, pass: true, errors: [] };
    writeJSON(target, 'commands.json', item.fixture.commands); writeJSON(target, 'expectations.json', item.fixture.expectations);
    writeJSON(target, 'evidence.json', item.evidence); writeJSON(target, 'forged-assessment.json', forgedAssessment);
    writeJSON(target, 'expected.json', { name: item.name, caseId: item.fixture.entry.id, code: item.expectedCode, mustReject: true });
    writeJSON(target, 'actual.json', actual);
    sealDirectory(target, { runId, kind: 'semantic-negative', name: item.name });
    negativeReports.push({ name: item.name, caseId: item.fixture.entry.id, expectedCode: item.expectedCode,
      pass: !actual.pass && actual.errors.some((error) => error.code === item.expectedCode), errors: actual.errors });
  }
  const savedRoot = path.join(root, 'saved-negatives'); directory(savedRoot);
  const first = positive.cases[0];
  const changed = copy(first.evidence); changed.steps.at(-1).ledger.occupied = 0; changed.final = copy(changed.steps.at(-1).ledger);
  const savedSpecs = [
    { name: 'bad-root-manifest', replace: new Map([['manifest.json', Buffer.from('{broken-json')]]), rehash: false, verified: 16, semantic: false },
    { name: 'null-root-manifest', replace: new Map([['manifest.json', Buffer.from('null\n')]]), rehash: false, verified: 16, semantic: false },
    { name: 'bad-first-case-json', replace: new Map([[`cases/${first.fixture.entry.id}/evidence.json`, Buffer.from('{broken-json')]]), rehash: false, verified: 15, semantic: false },
    { name: 'rehashed-semantic-first-case', replace: new Map([[`cases/${first.fixture.entry.id}/evidence.json`, bytes(changed)]]), rehash: true, verified: 15, semantic: true },
  ];
  const savedReports = [];
  for (const spec of savedSpecs) {
    const target = path.join(savedRoot, spec.name); cloneArchive(matrixRoot, target, spec.replace, spec.rehash);
    const actual = verifySavedMatrix(target);
    const pass = !actual.pass && actual.attempted === 16 && actual.verified === spec.verified && actual.cases.at(-1).verified
      && (spec.verified === 16 || !actual.cases[0].verified)
      && (!spec.semantic || actual.cases[0].errors.some((error) => error.code === 'ledger-semantic'));
    writeJSON(savedRoot, `${spec.name}-verification.json`, actual);
    savedReports.push({ name: spec.name, pass, expectedAttempted: 16, expectedVerified: spec.verified,
      actualAttempted: actual.attempted, actualVerified: actual.verified, validLastCase: actual.cases.at(-1).verified });
  }
  const report = { schema: 'owner-quarantine-self-test-v2', runId, scope: SCOPE, positive: positive.report,
    eventTypes, semanticNegatives: negativeReports, savedNegatives: savedReports,
    pass: positive.report.pass && positiveVerification.pass && negativeReports.every((item) => item.pass) && savedReports.every((item) => item.pass) };
  writeJSON(root, 'self-test-report.json', report); sealDirectory(root, { runId, kind: 'self-test' });
  return report;
}
export function verifySaved(root) {
  if (!fs.existsSync(path.join(root, 'self-test-report.json'))) return verifySavedMatrix(root);
  const matrix = verifySavedMatrix(path.join(root, 'matrix'));
  const fixtures = makeFixtures(matrix.runId);
  const cases = fixtures.map((fixture) => ({ fixture, evidence: deriveCase(fixture) }));
  const { mutations, eventTypes } = semanticMutations(cases);
  const matrixFiles = [...matrixPaths(), 'manifest.json'];
  const expectedPaths = ['positive-verification.json', 'self-test-report.json',
    ...matrixFiles.map((name) => `matrix/${name}`),
    ...mutations.flatMap((item) => NEGATIVE_FILES.map((name) => `semantic-negatives/${item.name}/${name}`)),
    ...SAVED_VARIANTS.flatMap(([name]) => [...matrixFiles.map((file) => `saved-negatives/${name}/${file}`), `saved-negatives/${name}-verification.json`])].sort();
  const errors = checkManifest(root, { runId: matrix.runId, kind: 'self-test' }, expectedPaths);
  try {
    if (!same(JSON.parse(readRegular(root, 'positive-verification.json')), matrix)) errors.push({ code: 'positive-verification-content' });
  } catch (error) { errors.push({ code: 'positive-verification-read', detail: errorText(error) }); }
  let report;
  try {
    report = JSON.parse(readRegular(root, 'self-test-report.json'));
    if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('invalid self-test report shape');
  } catch (error) { errors.push({ code: 'self-test-report-read', detail: errorText(error) }); report = {}; }
  if (report.schema !== 'owner-quarantine-self-test-v2' || report.runId !== matrix.runId || report.scope !== SCOPE
    || !same(report.eventTypes, eventTypes) || report.pass !== true) errors.push({ code: 'self-test-catalog' });
  let verifiedNegatives = 0;
  const negativeReports = [];
  for (const expected of mutations) {
    try {
      const base = `semantic-negatives/${expected.name}`;
      errors.push(...checkManifest(path.join(root, base), { runId: matrix.runId, kind: 'semantic-negative', name: expected.name },
        NEGATIVE_FILES.filter((name) => name !== 'manifest.json').sort()).map((error) => ({ ...error, negative: expected.name })));
      const actualEvidence = JSON.parse(readRegular(root, `${base}/evidence.json`));
      if (!same(actualEvidence, expected.evidence)) throw new Error('negative fixture differs from trusted mutation');
      const actual = verifyCase(expected.fixture, actualEvidence);
      if (actual.pass || !actual.errors.some((error) => error.code === expected.expectedCode)) throw new Error('semantic negative was not rejected');
      if (!same(JSON.parse(readRegular(root, `${base}/actual.json`)), actual)) throw new Error('negative assessment differs');
      for (const [name, value] of [['commands.json', expected.fixture.commands], ['expectations.json', expected.fixture.expectations],
        ['expected.json', { name: expected.name, caseId: expected.fixture.entry.id, code: expected.expectedCode, mustReject: true }],
        ['forged-assessment.json', { ...actual, pass: true, errors: [] }]]) {
        if (!same(JSON.parse(readRegular(root, `${base}/${name}`)), value)) throw new Error(`negative sidecar differs: ${name}`);
      }
      negativeReports.push({ name: expected.name, caseId: expected.fixture.entry.id, expectedCode: expected.expectedCode, pass: true, errors: actual.errors });
      verifiedNegatives++;
    } catch (error) { errors.push({ code: 'negative-verification', name: expected.name, detail: errorText(error) }); }
  }
  if (!same(report.semanticNegatives, negativeReports)) errors.push({ code: 'self-test-negative-report' });
  if (!same(report.positive, summarize(matrix.runId, cases.map((item) => verifyCase(item.fixture, item.evidence))))) errors.push({ code: 'self-test-positive-report' });
  const saved = [];
  const savedReports = [];
  for (const [name, count] of SAVED_VARIANTS) {
    const actual = verifySavedMatrix(path.join(root, 'saved-negatives', name));
    try {
      if (!same(JSON.parse(readRegular(root, `saved-negatives/${name}-verification.json`)), actual)) errors.push({ code: 'saved-negative-report-content', name });
    } catch (error) { errors.push({ code: 'saved-negative-report-read', name, detail: errorText(error) }); }
    const pass = !actual.pass && actual.attempted === 16 && actual.verified === count && actual.cases.at(-1).verified;
    if (!pass) errors.push({ code: 'saved-negative-verification', name });
    saved.push({ name, pass, attempted: actual.attempted, verified: actual.verified });
    savedReports.push({ name, pass, expectedAttempted: 16, expectedVerified: count, actualAttempted: actual.attempted,
      actualVerified: actual.verified, validLastCase: actual.cases.at(-1).verified });
  }
  if (!same(report.savedNegatives, savedReports)) errors.push({ code: 'self-test-saved-report' });
  return { schema: 'owner-quarantine-self-test-saved-verification-v2', pass: errors.length === 0 && matrix.pass,
    errors, attempted: matrix.attempted, verified: matrix.verified, verifiedNegatives, saved, matrix };
}

function main(args) {
  if (args.length === 2 && args[0] === '--verify-saved') {
    const report = verifySaved(path.resolve(args[1]));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = report.pass ? 0 : 1; return;
  }
  const selfTest = args[0] === '--self-test';
  const values = selfTest ? args.slice(1) : args;
  if (values.length !== 2 || values[0] !== '--output') throw new Error('usage: --self-test --output NEW_DIRECTORY | --output NEW_DIRECTORY | --verify-saved DIRECTORY');
  const output = path.resolve(values[1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) throw new Error('output directory already exists; preserve evidence and use a new directory');
  const runId = `D4v2-${randomUUID()}`;
  const report = selfTest ? runSelfTest(output, runId) : runMatrix(output, runId).report;
  const positive = selfTest ? report.positive : report;
  process.stdout.write(`${JSON.stringify({ output, runId, pass: report.pass, scope: SCOPE, cases: positive.attempted,
    verified: positive.verified, commands: positive.commands, modelRejections: positive.modelRejections, checks: positive.checks,
    semanticNegatives: report.semanticNegatives?.length ?? null, eventTypes: report.eventTypes?.length ?? null,
    savedNegatives: report.savedNegatives?.length ?? null, sources: sourceInfo() }, null, 2)}\n`);
  process.exitCode = report.pass ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
}
