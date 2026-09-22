import { isDeepStrictEqual } from 'node:util';

// This reference reducer uses arrays and validates trusted commands before any
// mutation. It deliberately imports no model implementation or model helpers.
export const ORACLE_SCHEMA = 'owner-quarantine-oracle-v2';
const fields = ['runId', 'caseId', 'failureDomainId', 'executionId', 'ownerGeneration', 'allocationId'];
const argumentFields = {
  reserve: ['owner', 'createOperationId'],
  'dispatch-create': ['owner', 'createOperationId'],
  acquire: ['owner', 'createOperationId', 'resourceId', 'resourceKind'],
  'report-create': ['owner', 'createOperationId', 'outcome'],
  'seal-create': ['owner', 'createOperationId', 'resourceIds'],
  'begin-use': ['owner', 'resourceId', 'resourceKind', 'tokenId', 'useKind', 'batchId'],
  'end-use': ['owner', 'resourceId', 'resourceKind', 'tokenId'],
  'request-release': ['owner', 'operationId', 'params'],
  'dispatch-release': ['owner', 'operationId', 'resourceIds'],
  'release-evidence': ['owner', 'operationId', 'resourceId', 'resourceKind', 'receiptId', 'result'],
  'observe-unknown': ['owner', 'subject', 'reason'],
  'advance-generation': ['previous', 'next'],
  reopen: ['expectedGeneration'],
};
const copy = (value) => structuredClone(value);
const same = (a, b) => isDeepStrictEqual(a, b);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, names) {
  return record(value) && Object.keys(value).length === names.length
    && names.every((name) => Object.hasOwn(value, name));
}
function identifier(value) {
  if (typeof value !== 'string' || !value.length || value.length > 180) return false;
  for (const char of value) if (!'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:/-'.includes(char)) return false;
  return true;
}
function jsonValue(value) {
  if (value === null) return true;
  if (['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return Object.keys(value).length === value.length && value.every(jsonValue);
  return Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every((key) => jsonValue(value[key]));
}
function normalize(value) {
  if (typeof value === 'number' && value === 0) return 0;
  if (Array.isArray(value)) return value.map(normalize);
  if (!record(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) Object.defineProperty(result, key, { value: normalize(value[key]), enumerable: true, writable: true, configurable: true });
  return result;
}
const by = (rows, name, value) => rows.find((row) => row[name] === value);
const refValid = (ref) => exact(ref, fields) && fields.every((name) => identifier(ref[name]));
const identityMatches = (a, b) => fields.every((name) => a[name] === b[name]);
const listMatches = (list, expected) => Array.isArray(list) && list.every(identifier)
  && new Set(list).size === list.length && same(list.slice().sort(), expected);

function initial(context) {
  return { schema: 'runtime-owner-quarantine-model-v2', runId: context.runId, caseId: context.caseId,
    capacity: 2, unknownThreshold: 1, domains: context.domains.slice().sort(), currentGeneration: 'generation-1',
    generations: ['generation-1'], admissionBlocked: false, createDispatches: 0, releaseDispatches: 0,
    owners: [], resources: [], uses: [], operations: [], unknowns: [], receipts: [] };
}
function snapshot(state) {
  const result = copy(state);
  result.occupied = state.owners.filter((owner) => owner.slotHeld).length;
  result.unknownCount = new Set(state.unknowns.filter((item) => !item.resolvedBy).map((item) => item.owner.allocationId)).size;
  for (const [name, field] of [['owners', 'allocationId'], ['resources', 'resourceId'], ['uses', 'tokenId'],
    ['operations', 'operationId'], ['unknowns', 'key'], ['receipts', 'receiptId']]) {
    const ids = result[name].map((item) => item[field]).sort();
    result[name] = ids.map((id) => result[name].find((item) => item[field] === id));
  }
  return result;
}
function findTargets(s, a) {
  const owner = record(a.owner) ? by(s.owners, 'allocationId', a.owner.allocationId) : undefined;
  return { owner,
    creation: owner && by(s.operations, 'operationId', owner.createOperationId),
    operation: by(s.operations, 'operationId', a.operationId ?? a.createOperationId),
    resource: by(s.resources, 'resourceId', a.resourceId),
    use: by(s.uses, 'tokenId', a.tokenId),
    receipt: by(s.receipts, 'receiptId', a.receiptId) };
}
function unresolvedSubject(s, owner, subject) {
  if (subject.kind === 'create' || subject.kind === 'release') {
    const item = by(s.operations, 'operationId', subject.id);
    return Boolean(item && item.type === subject.kind && identityMatches(item.owner, owner.identity)
      && item.phase !== (subject.kind === 'create' ? 'settled' : 'complete'));
  }
  if (subject.kind === 'use') {
    const item = by(s.uses, 'tokenId', subject.id);
    return Boolean(item && identityMatches(item.owner, owner.identity) && item.state === 'in-flight');
  }
  const item = by(s.resources, 'resourceId', subject.id);
  return Boolean(item && identityMatches(item.owner, owner.identity) && item.releaseState !== 'released');
}
function reasonFor(s, command, t) {
  const { kind, args: a } = command;
  const { owner, creation, operation, resource, use, receipt } = t;
  if (!['reserve', 'advance-generation', 'reopen'].includes(kind)) {
    if (!refValid(a.owner)) return 'invalid-identity';
    if (a.owner.runId !== s.runId || a.owner.caseId !== s.caseId) return 'identity-mismatch';
    if (!owner) return 'unknown-allocation';
    if (!identityMatches(owner.identity, a.owner)) return 'identity-mismatch';
  }
  if (!Object.hasOwn(argumentFields, kind)) return 'unknown-command';
  if (!exact(a, argumentFields[kind])) return 'invalid-arguments';
  if (kind === 'reserve') {
    if (!refValid(a.owner)) return 'invalid-identity';
    if (a.owner.runId !== s.runId || a.owner.caseId !== s.caseId) return 'identity-mismatch';
    if (!s.domains.includes(a.owner.failureDomainId)) return 'unknown-domain';
    if (a.owner.ownerGeneration !== s.currentGeneration) return 'generation-mismatch';
    if (owner) return 'allocation-exists';
    if (!identifier(a.createOperationId) || operation) return 'operation-id-used';
    if (s.admissionBlocked) return 'unknown-quarantine';
    if (s.owners.filter((item) => item.slotHeld).length >= 2) return 'capacity';
  }
  if (kind === 'advance-generation' && (a.previous !== s.currentGeneration || !identifier(a.next) || s.generations.includes(a.next))) return 'invalid-generation';
  if (kind === 'reopen') {
    if (a.expectedGeneration !== s.currentGeneration) return 'generation-mismatch';
    if (s.unknowns.some((item) => item.resolvedBy === null)) return 'unknown-still-retained';
  }
  if (['dispatch-create', 'acquire', 'report-create', 'seal-create', 'dispatch-release', 'release-evidence'].includes(kind)) {
    const type = ['dispatch-release', 'release-evidence'].includes(kind) ? 'release' : 'create';
    if (!operation || operation.type !== type || !identityMatches(operation.owner, owner.identity)) return 'operation-mismatch';
  }
  if (kind === 'dispatch-create' && creation.phase !== 'reserved') return 'create-not-reserved';
  if (kind === 'acquire') {
    if (!['dispatched', 'reported'].includes(creation.phase)) return 'create-not-open';
    if (!identifier(a.resourceId) || !['pipe', 'waiter', 'process'].includes(a.resourceKind)) return 'invalid-resource';
    if (resource) return 'resource-id-used';
  }
  if (kind === 'report-create') {
    if (!['success', 'failed'].includes(a.outcome)) return 'invalid-create-outcome';
    if (creation.dispatchCount !== 1) return 'create-not-dispatched';
    if (creation.outcome !== null && creation.outcome !== a.outcome) return 'conflicting-create-result';
    if (creation.outcome === null && a.outcome === 'success' && !owner.resourceIds.length) return 'zero-resource-success-unsupported';
  }
  if (kind === 'seal-create') {
    if (creation.phase !== 'reported') return 'create-not-reported';
    if (!listMatches(a.resourceIds, owner.resourceIds)) return 'acquisition-set-mismatch';
  }
  if (['begin-use', 'end-use', 'release-evidence'].includes(kind)) {
    if (!resource || !identityMatches(resource.owner, owner.identity) || resource.resourceKind !== a.resourceKind) return 'resource-mismatch';
  }
  if (kind === 'begin-use') {
    if (!owner.slotHeld || resource.releaseState === 'released' || owner.releaseOperationId !== null) return 'use-not-admitted';
    if (!identifier(a.tokenId) || use) return 'token-id-used';
    if (!['io', 'data-application'].includes(a.useKind)
      || (a.useKind === 'io' ? a.batchId !== null : !identifier(a.batchId))) return 'invalid-use';
    if (a.batchId !== null && s.uses.some((item) => item.batchId === a.batchId)) return 'batch-id-used';
  }
  if (kind === 'end-use') {
    if (!use || !identityMatches(use.owner, owner.identity) || use.resourceId !== a.resourceId || use.resourceKind !== a.resourceKind) return 'token-mismatch';
    if (use.state !== 'in-flight') return 'token-already-ended';
  }
  if (kind === 'request-release') {
    if (!identifier(a.operationId) || !record(a.params) || !jsonValue(a.params)) return 'invalid-release-request';
    if (operation) {
      if (operation.type !== 'release' || !identityMatches(operation.owner, owner.identity)) return 'operation-id-used';
      if (!same(normalize(operation.params), normalize(a.params))) return 'conflicting-release';
    } else {
      if (!owner.slotHeld) return 'owner-released';
      if (owner.releaseOperationId !== null) return 'conflicting-release';
    }
  }
  if (kind === 'dispatch-release') {
    if (operation.phase !== 'queued') return 'release-not-queued';
    if (creation.phase !== 'settled') return 'create-not-sealed';
    if (s.uses.some((item) => identityMatches(item.owner, owner.identity) && item.state === 'in-flight')) return 'uses-in-flight';
    if (!owner.resourceIds.length || !listMatches(a.resourceIds, owner.resourceIds)) return 'release-set-mismatch';
  }
  if (kind === 'release-evidence') {
    if (operation.dispatchCount !== 1 || !operation.resourceIds.includes(a.resourceId)) return 'release-not-dispatched';
    if (!identifier(a.receiptId) || !['released', 'unconfirmed'].includes(a.result)) return 'invalid-receipt';
    const proposed = { receiptId: a.receiptId, owner: a.owner, operationId: a.operationId, resourceId: a.resourceId, resourceKind: a.resourceKind, result: a.result };
    if (receipt && !same(receipt, proposed)) return 'receipt-conflict';
    if (!receipt && resource.releaseState === 'released' && a.result !== 'released') return 'resource-already-released';
  }
  if (kind === 'observe-unknown') {
    if (!exact(a.subject, ['kind', 'id']) || !identifier(a.subject.id) || !identifier(a.reason)
      || !['create', 'release', 'use', 'resource'].includes(a.subject.kind)) return 'invalid-subject';
    if (!owner.slotHeld || !unresolvedSubject(s, owner, a.subject)) return 'subject-settled';
    const old = s.unknowns.find((item) => identityMatches(item.owner, owner.identity) && same(item.subject, a.subject));
    if (old?.resolvedBy) return 'subject-settled';
  }
  return null;
}

function reduceAccepted(s, command, t, emit) {
  const { kind, args: a, commandId } = command;
  const { owner, creation, operation, resource, use, receipt } = t;
  const details = copy(a); delete details.owner;
  const result = { status: 'accepted', reason: null, value: {} };
  const normalEvent = () => emit(kind, a.owner ?? null, details);
  const operationResult = (op) => ({ operationId: op.operationId, phase: op.phase, outcome: op.outcome, dispatchCount: op.dispatchCount });
  const mark = (subject, reason) => {
    const prior = s.unknowns.find((item) => same(item.owner, a.owner) && same(item.subject, subject));
    if (prior) { emit('unknown-reused', a.owner, { subject, first: prior.first }); return 'reused'; }
    s.unknowns.push({ key: JSON.stringify([a.owner.allocationId, subject.kind, subject.id]), owner: copy(a.owner),
      subject: copy(subject), first: { commandId, reason }, resolvedBy: null });
    s.admissionBlocked = true;
    emit('unknown-observed', a.owner, { subject, reason });
    return 'accepted';
  };
  switch (kind) {
    case 'reserve':
      s.owners.push({ allocationId: a.owner.allocationId, identity: copy(a.owner), slotHeld: true, returnedBy: null,
        createOperationId: a.createOperationId, releaseOperationId: null, resourceIds: [] });
      s.operations.push({ operationId: a.createOperationId, type: 'create', owner: copy(a.owner), phase: 'reserved',
        dispatchCount: 0, outcome: null, params: null, resourceIds: [] }); break;
    case 'advance-generation': s.currentGeneration = a.next; s.generations.push(a.next); break;
    case 'reopen': s.admissionBlocked = false; break;
    case 'dispatch-create': creation.phase = 'dispatched'; creation.dispatchCount = 1; s.createDispatches++; break;
    case 'acquire':
      s.resources.push({ resourceId: a.resourceId, resourceKind: a.resourceKind, owner: copy(a.owner), acquiredBy: commandId, releaseState: 'retained' });
      owner.resourceIds.push(a.resourceId); owner.resourceIds.sort(); break;
    case 'report-create':
      if (creation.outcome !== null) { result.status = 'reused'; emit('report-create-reused', a.owner, details); return result; }
      creation.phase = 'reported'; creation.outcome = a.outcome; break;
    case 'seal-create': creation.phase = 'settled'; creation.resourceIds = owner.resourceIds.slice(); break;
    case 'begin-use':
      s.uses.push({ tokenId: a.tokenId, owner: copy(a.owner), resourceId: a.resourceId, resourceKind: a.resourceKind,
        useKind: a.useKind, batchId: a.batchId, state: 'in-flight', startedBy: commandId, endedBy: null, applied: false }); break;
    case 'end-use':
      use.state = 'ended'; use.endedBy = commandId; use.applied = use.useKind === 'data-application';
      emit(kind, a.owner, { resourceId: a.resourceId, resourceKind: a.resourceKind, tokenId: a.tokenId, batchId: use.batchId, applied: use.applied }); return result;
    case 'request-release':
      if (operation) {
        result.status = 'reused'; result.value = operationResult(operation); emit('request-release-reused', a.owner, details); return result;
      }
      owner.releaseOperationId = a.operationId;
      s.operations.push({ operationId: a.operationId, type: 'release', owner: copy(a.owner), phase: 'queued', dispatchCount: 0,
        outcome: null, params: normalize(a.params), resourceIds: [] });
      result.value = operationResult(s.operations.at(-1)); break;
    case 'dispatch-release':
      operation.phase = 'dispatched'; operation.dispatchCount = 1; operation.resourceIds = owner.resourceIds.slice(); s.releaseDispatches++; break;
    case 'release-evidence':
      if (receipt) { result.status = 'reused'; emit('release-evidence-reused', a.owner, details); return result; }
      s.receipts.push({ receiptId: a.receiptId, owner: copy(a.owner), operationId: a.operationId,
        resourceId: a.resourceId, resourceKind: a.resourceKind, result: a.result });
      resource.releaseState = a.result; normalEvent();
      if (a.result === 'unconfirmed') mark({ kind: 'resource', id: a.resourceId }, 'release-unconfirmed');
      return result;
    case 'observe-unknown': result.status = mark(a.subject, a.reason); return result;
  }
  normalEvent();
  return result;
}

function settle(s, commandId, emit) {
  // Completion is derived from obligations, never from the recorded SUT phase.
  for (const op of s.operations.filter((item) => item.type === 'release' && item.phase !== 'complete')) {
    const owner = by(s.owners, 'allocationId', op.owner.allocationId);
    const create = by(s.operations, 'operationId', owner.createOperationId);
    if (create.phase !== 'settled' || s.uses.some((item) => same(item.owner, op.owner) && item.state !== 'ended')) continue;
    const emptyFailure = create.outcome === 'failed' && owner.resourceIds.length === 0;
    const resourceProofs = owner.resourceIds.length > 0 && op.phase === 'dispatched'
      && owner.resourceIds.every((id) => by(s.resources, 'resourceId', id).releaseState === 'released');
    if (!emptyFailure && !resourceProofs) continue;
    op.phase = 'complete'; op.outcome = emptyFailure ? 'not-required' : 'released';
    emit('release-completed', op.owner, { operationId: op.operationId, outcome: op.outcome, dispatchCount: op.dispatchCount });
  }
  for (const item of s.unknowns.filter((entry) => entry.resolvedBy === null)) {
    const owner = by(s.owners, 'allocationId', item.owner.allocationId);
    if (unresolvedSubject(s, owner, item.subject)) continue;
    item.resolvedBy = commandId;
    emit('unknown-resolved', item.owner, { subject: item.subject, first: item.first, resolvedBy: commandId });
  }
  for (const owner of s.owners.filter((item) => item.slotHeld)) {
    const create = by(s.operations, 'operationId', owner.createOperationId);
    const release = by(s.operations, 'operationId', owner.releaseOperationId);
    if (create.phase !== 'settled' || s.unknowns.some((item) => same(item.owner, owner.identity) && item.resolvedBy === null)
      || s.uses.some((item) => same(item.owner, owner.identity) && item.state !== 'ended')) continue;
    const failedEmpty = create.outcome === 'failed' && owner.resourceIds.length === 0 && (!release || release.outcome === 'not-required');
    if (!failedEmpty && !(release?.phase === 'complete' && release.outcome === 'released')) continue;
    owner.slotHeld = false; owner.returnedBy = commandId;
    emit('slot-returned', owner.identity, { createOperationId: owner.createOperationId, releaseOperationId: owner.releaseOperationId });
  }
}

export function deriveCase(fixture) {
  const state = initial(fixture.context);
  let eventSequence = 0;
  const commandIds = new Set();
  const steps = fixture.commands.map((command, index) => {
    if (!exact(command, ['schema', 'runId', 'caseId', 'commandId', 'commandSeq', 'kind', 'args'])
      || command.schema !== 'runtime-owner-quarantine-command-v2' || command.runId !== state.runId || command.caseId !== state.caseId
      || command.commandSeq !== index + 1 || !identifier(command.commandId) || commandIds.has(command.commandId)
      || typeof command.kind !== 'string' || !record(command.args) || !jsonValue(command.args)) throw new Error(`invalid trusted command ${index}`);
    commandIds.add(command.commandId);
    const events = [];
    const emit = (type, owner, details) => events.push({ schema: 'runtime-owner-quarantine-event-v2', runId: state.runId,
      caseId: state.caseId, commandId: command.commandId, eventSeq: ++eventSequence, type, owner: copy(owner), details: copy(details) });
    const targets = findTargets(state, command.args);
    const reason = reasonFor(state, command, targets);
    let result;
    if (reason) {
      result = { status: 'rejected', reason, value: null };
      emit('command-rejected', command.args.owner ?? null, { kind: command.kind, args: command.args, reason });
    } else {
      result = reduceAccepted(state, command, targets, emit);
      settle(state, command.commandId, emit);
    }
    return { command: copy(command), result, events, ledger: snapshot(state) };
  });
  return { schema: 'owner-quarantine-evidence-v2', entry: copy(fixture.entry), context: copy(fixture.context), steps, final: snapshot(state) };
}

export function verifyCase(fixture, evidence) {
  const expected = deriveCase(fixture);
  const errors = [];
  let checks = 0;
  const check = (condition, code, path) => { checks++; if (!condition) errors.push({ code, path }); };
  check(exact(evidence, ['schema', 'entry', 'context', 'steps', 'final']), 'evidence-shape', '/');
  for (const key of ['schema', 'entry', 'context']) check(same(evidence?.[key], expected[key]), 'evidence-identity', `/${key}`);
  check(Array.isArray(evidence?.steps) && evidence.steps.length === expected.steps.length, 'schedule-length', '/steps');
  for (let index = 0; index < expected.steps.length; index++) {
    const actual = evidence?.steps?.[index]; const trusted = expected.steps[index];
    check(exact(actual, ['command', 'result', 'events', 'ledger']), 'step-shape', `/steps/${index}`);
    check(same(actual?.command, trusted.command), 'command-semantic', `/steps/${index}/command`);
    check(same(actual?.result, trusted.result), 'result-semantic', `/steps/${index}/result`);
    check(same(actual?.events, trusted.events), 'event-semantic', `/steps/${index}/events`);
    check(same(actual?.ledger, trusted.ledger), 'ledger-semantic', `/steps/${index}/ledger`);
    check(same({ commandId: trusted.command.commandId, status: trusted.result.status, reason: trusted.result.reason }, fixture.expectations[index]),
      'fixture-expectation', `/expectations/${index}`);
  }
  check(fixture.expectations.length === expected.steps.length, 'fixture-expectation', '/expectations');
  check(same(evidence?.final, expected.final), 'final-semantic', '/final');
  return { schema: ORACLE_SCHEMA, caseId: fixture.entry.id, pass: errors.length === 0, checks,
    commands: expected.steps.length, modelRejections: expected.steps.filter((step) => step.result.status === 'rejected').length, errors };
}
