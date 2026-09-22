// Finite logical owner ledger only. No native resources or production modules.
export const MODEL_SCHEMA = 'runtime-owner-quarantine-model-v2';
export const COMMAND_SCHEMA = 'runtime-owner-quarantine-command-v2';
export const EVENT_SCHEMA = 'runtime-owner-quarantine-event-v2';

const ID_FIELDS = ['runId', 'caseId', 'failureDomainId', 'executionId', 'ownerGeneration', 'allocationId'];
const KINDS = ['pipe', 'waiter', 'process'];
const clone = (value) => structuredClone(value);
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,180}$/.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const validJSON = (value) => value === null || typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value))
  || (Array.isArray(value) && Object.keys(value).length === value.length && value.every(validJSON))
  || (object(value) && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(validJSON));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const sorted = (map, field) => [...map.values()].map(clone).sort((a, b) => a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0);

class Rejection extends Error {}
const requireState = (condition, reason) => { if (!condition) throw new Rejection(reason); };

export class OwnerQuarantineModelV2 {
  constructor({ runId, caseId, domains = ['domain-shared', 'domain-a', 'domain-b'] }) {
    if (!id(runId) || !id(caseId) || !Array.isArray(domains) || !domains.length
      || !domains.every(id) || new Set(domains).size !== domains.length) throw new TypeError('invalid model context');
    this.state = {
      runId, caseId, domains: [...domains].sort(), currentGeneration: 'generation-1', generations: ['generation-1'],
      admissionBlocked: false, createDispatches: 0, releaseDispatches: 0,
      owners: new Map(), resources: new Map(), uses: new Map(), operations: new Map(), unknowns: new Map(), receipts: new Map(),
    };
    this.commandSequence = 0;
    this.commandIds = new Set();
    this.eventSequence = 0;
  }

  snapshot() {
    const s = this.state;
    const unresolved = [...s.unknowns.values()].filter((item) => item.resolvedBy === null);
    return clone({ schema: MODEL_SCHEMA, runId: s.runId, caseId: s.caseId, capacity: 2, unknownThreshold: 1,
      domains: s.domains, currentGeneration: s.currentGeneration, generations: s.generations,
      admissionBlocked: s.admissionBlocked, createDispatches: s.createDispatches, releaseDispatches: s.releaseDispatches,
      occupied: [...s.owners.values()].filter((owner) => owner.slotHeld).length,
      unknownCount: new Set(unresolved.map((item) => item.owner.allocationId)).size,
      owners: sorted(s.owners, 'allocationId'), resources: sorted(s.resources, 'resourceId'),
      uses: sorted(s.uses, 'tokenId'), operations: sorted(s.operations, 'operationId'),
      unknowns: sorted(s.unknowns, 'key'), receipts: sorted(s.receipts, 'receiptId') });
  }

  applyCommand(command) {
    const s = this.state;
    if (!keys(command, ['schema', 'runId', 'caseId', 'commandId', 'commandSeq', 'kind', 'args'])
      || command.schema !== COMMAND_SCHEMA || command.runId !== s.runId || command.caseId !== s.caseId
      || !id(command.commandId) || this.commandIds.has(command.commandId)
      || command.commandSeq !== this.commandSequence + 1 || typeof command.kind !== 'string'
      || !object(command.args) || !validJSON(command.args)) throw new TypeError('invalid command envelope');
    this.commandSequence = command.commandSeq;
    this.commandIds.add(command.commandId);
    const draft = structuredClone(s);
    const pendingEvents = [];
    const emit = (type, owner, details = {}) => pendingEvents.push({ type, owner: clone(owner), details: clone(details) });
    let result;
    try {
      result = this.transition(draft, command, emit);
      this.reconcile(draft, command.commandId, emit);
      this.state = draft;
    } catch (error) {
      if (!(error instanceof Rejection)) throw error;
      pendingEvents.length = 0;
      emit('command-rejected', command.args.owner ?? null, { kind: command.kind, args: command.args, reason: error.message });
      result = { status: 'rejected', reason: error.message, value: null };
    }
    const events = pendingEvents.map((event) => ({ schema: EVENT_SCHEMA, runId: s.runId, caseId: s.caseId,
      commandId: command.commandId, eventSeq: ++this.eventSequence, ...event }));
    return clone({ result, events, ledger: this.snapshot() });
  }

  target(s, ref) {
    requireState(keys(ref, ID_FIELDS) && ID_FIELDS.every((field) => id(ref[field])), 'invalid-identity');
    requireState(ref.runId === s.runId && ref.caseId === s.caseId, 'identity-mismatch');
    const owner = s.owners.get(ref.allocationId);
    requireState(owner, 'unknown-allocation');
    requireState(equal(owner.identity, ref), 'identity-mismatch');
    return owner;
  }

  operation(s, owner, operationId, type) {
    const operation = s.operations.get(operationId);
    requireState(operation && operation.type === type && equal(operation.owner, owner.identity), 'operation-mismatch');
    return operation;
  }

  resource(s, owner, resourceId, resourceKind) {
    const resource = s.resources.get(resourceId);
    requireState(resource && equal(resource.owner, owner.identity) && resource.resourceKind === resourceKind, 'resource-mismatch');
    return resource;
  }

  markUnknown(s, owner, subject, reason, commandId, emit) {
    const key = JSON.stringify([owner.allocationId, subject.kind, subject.id]);
    const old = s.unknowns.get(key);
    if (old) {
      requireState(old.resolvedBy === null, 'subject-settled');
      emit('unknown-reused', owner.identity, { subject, first: old.first });
      return true;
    }
    s.unknowns.set(key, { key, owner: clone(owner.identity), subject: clone(subject), first: { commandId, reason }, resolvedBy: null });
    s.admissionBlocked = true;
    emit('unknown-observed', owner.identity, { subject, reason });
    return false;
  }

  transition(s, command, emit) {
    const a = command.args;
    const accept = (value = {}) => ({ status: 'accepted', reason: null, value });
    const reuse = (value = {}) => ({ status: 'reused', reason: null, value });
    const shape = (fields) => requireState(keys(a, fields), 'invalid-arguments');
    const record = (type = command.kind, details = null, owner = a.owner ?? null) => {
      const values = details ?? Object.fromEntries(Object.entries(a).filter(([key]) => key !== 'owner'));
      emit(type, owner, values);
    };
    if (command.kind === 'advance-generation') {
      shape(['previous', 'next']);
      requireState(a.previous === s.currentGeneration && id(a.next) && !s.generations.includes(a.next), 'invalid-generation');
      s.currentGeneration = a.next; s.generations.push(a.next); record(); return accept();
    }
    if (command.kind === 'reopen') {
      shape(['expectedGeneration']);
      requireState(a.expectedGeneration === s.currentGeneration, 'generation-mismatch');
      requireState(![...s.unknowns.values()].some((item) => item.resolvedBy === null), 'unknown-still-retained');
      s.admissionBlocked = false; record(); return accept();
    }
    if (command.kind === 'reserve') {
      shape(['owner', 'createOperationId']);
      requireState(keys(a.owner, ID_FIELDS) && ID_FIELDS.every((field) => id(a.owner[field])), 'invalid-identity');
      requireState(a.owner.runId === s.runId && a.owner.caseId === s.caseId, 'identity-mismatch');
      requireState(s.domains.includes(a.owner.failureDomainId), 'unknown-domain');
      requireState(a.owner.ownerGeneration === s.currentGeneration, 'generation-mismatch');
      requireState(!s.owners.has(a.owner.allocationId), 'allocation-exists');
      requireState(id(a.createOperationId) && !s.operations.has(a.createOperationId), 'operation-id-used');
      requireState(!s.admissionBlocked, 'unknown-quarantine');
      requireState([...s.owners.values()].filter((owner) => owner.slotHeld).length < 2, 'capacity');
      const owner = { allocationId: a.owner.allocationId, identity: clone(a.owner), slotHeld: true, returnedBy: null,
        createOperationId: a.createOperationId, releaseOperationId: null, resourceIds: [] };
      s.owners.set(owner.allocationId, owner);
      s.operations.set(a.createOperationId, { operationId: a.createOperationId, type: 'create', owner: clone(a.owner),
        phase: 'reserved', dispatchCount: 0, outcome: null, params: null, resourceIds: [] });
      record(); return accept();
    }
    const owner = this.target(s, a.owner);
    const create = s.operations.get(owner.createOperationId);
    switch (command.kind) {
      case 'dispatch-create': {
        shape(['owner', 'createOperationId']);
        this.operation(s, owner, a.createOperationId, 'create');
        requireState(create.phase === 'reserved', 'create-not-reserved');
        create.phase = 'dispatched'; create.dispatchCount = 1; s.createDispatches += 1; record(); return accept();
      }
      case 'acquire': {
        shape(['owner', 'createOperationId', 'resourceId', 'resourceKind']);
        this.operation(s, owner, a.createOperationId, 'create');
        requireState(['dispatched', 'reported'].includes(create.phase), 'create-not-open');
        requireState(id(a.resourceId) && KINDS.includes(a.resourceKind), 'invalid-resource');
        requireState(!s.resources.has(a.resourceId), 'resource-id-used');
        s.resources.set(a.resourceId, { resourceId: a.resourceId, resourceKind: a.resourceKind,
          owner: clone(owner.identity), acquiredBy: command.commandId, releaseState: 'retained' });
        owner.resourceIds.push(a.resourceId); owner.resourceIds.sort(); record(); return accept();
      }
      case 'report-create': {
        shape(['owner', 'createOperationId', 'outcome']);
        this.operation(s, owner, a.createOperationId, 'create');
        requireState(['success', 'failed'].includes(a.outcome), 'invalid-create-outcome');
        requireState(create.dispatchCount === 1, 'create-not-dispatched');
        if (create.outcome !== null) {
          requireState(create.outcome === a.outcome, 'conflicting-create-result'); record('report-create-reused'); return reuse();
        }
        requireState(a.outcome !== 'success' || owner.resourceIds.length > 0, 'zero-resource-success-unsupported');
        create.outcome = a.outcome; create.phase = 'reported'; record(); return accept();
      }
      case 'seal-create': {
        shape(['owner', 'createOperationId', 'resourceIds']);
        this.operation(s, owner, a.createOperationId, 'create');
        requireState(create.phase === 'reported', 'create-not-reported');
        requireState(Array.isArray(a.resourceIds) && a.resourceIds.every(id)
          && new Set(a.resourceIds).size === a.resourceIds.length && equal([...a.resourceIds].sort(), owner.resourceIds), 'acquisition-set-mismatch');
        create.resourceIds = [...owner.resourceIds]; create.phase = 'settled'; record(); return accept();
      }
      case 'begin-use': {
        shape(['owner', 'resourceId', 'resourceKind', 'tokenId', 'useKind', 'batchId']);
        const resource = this.resource(s, owner, a.resourceId, a.resourceKind);
        requireState(owner.slotHeld && resource.releaseState !== 'released' && owner.releaseOperationId === null, 'use-not-admitted');
        requireState(id(a.tokenId) && !s.uses.has(a.tokenId), 'token-id-used');
        requireState(['io', 'data-application'].includes(a.useKind)
          && (a.useKind === 'io' ? a.batchId === null : id(a.batchId)), 'invalid-use');
        requireState(a.batchId === null || ![...s.uses.values()].some((use) => use.batchId === a.batchId), 'batch-id-used');
        s.uses.set(a.tokenId, { tokenId: a.tokenId, owner: clone(owner.identity), resourceId: a.resourceId,
          resourceKind: a.resourceKind, useKind: a.useKind, batchId: a.batchId, state: 'in-flight',
          startedBy: command.commandId, endedBy: null, applied: false });
        record(); return accept();
      }
      case 'end-use': {
        shape(['owner', 'resourceId', 'resourceKind', 'tokenId']);
        this.resource(s, owner, a.resourceId, a.resourceKind);
        const use = s.uses.get(a.tokenId);
        requireState(use && equal(use.owner, owner.identity) && use.resourceId === a.resourceId && use.resourceKind === a.resourceKind, 'token-mismatch');
        requireState(use.state === 'in-flight', 'token-already-ended');
        use.state = 'ended'; use.endedBy = command.commandId; use.applied = use.useKind === 'data-application';
        record('end-use', { resourceId: a.resourceId, resourceKind: a.resourceKind, tokenId: a.tokenId, batchId: use.batchId, applied: use.applied });
        return accept();
      }
      case 'request-release': {
        shape(['owner', 'operationId', 'params']);
        requireState(id(a.operationId) && object(a.params) && validJSON(a.params), 'invalid-release-request');
        const existing = s.operations.get(a.operationId);
        if (existing) {
          requireState(existing.type === 'release' && equal(existing.owner, owner.identity), 'operation-id-used');
          requireState(equal(existing.params, a.params), 'conflicting-release');
          record('request-release-reused');
          return reuse({ operationId: existing.operationId, phase: existing.phase, outcome: existing.outcome, dispatchCount: existing.dispatchCount });
        }
        requireState(owner.slotHeld, 'owner-released');
        requireState(owner.releaseOperationId === null, 'conflicting-release');
        owner.releaseOperationId = a.operationId;
        s.operations.set(a.operationId, { operationId: a.operationId, type: 'release', owner: clone(owner.identity),
          phase: 'queued', dispatchCount: 0, outcome: null, params: canonical(a.params), resourceIds: [] });
        record(); return accept({ operationId: a.operationId, phase: 'queued', outcome: null, dispatchCount: 0 });
      }
      case 'dispatch-release': {
        shape(['owner', 'operationId', 'resourceIds']);
        const operation = this.operation(s, owner, a.operationId, 'release');
        requireState(operation.phase === 'queued', 'release-not-queued');
        requireState(create.phase === 'settled', 'create-not-sealed');
        requireState(![...s.uses.values()].some((use) => equal(use.owner, owner.identity) && use.state === 'in-flight'), 'uses-in-flight');
        requireState(Array.isArray(a.resourceIds) && a.resourceIds.every(id) && new Set(a.resourceIds).size === a.resourceIds.length
          && equal([...a.resourceIds].sort(), owner.resourceIds) && owner.resourceIds.length > 0, 'release-set-mismatch');
        operation.phase = 'dispatched'; operation.dispatchCount = 1; operation.resourceIds = [...owner.resourceIds];
        s.releaseDispatches += 1; record(); return accept();
      }
      case 'release-evidence': {
        shape(['owner', 'operationId', 'resourceId', 'resourceKind', 'receiptId', 'result']);
        const operation = this.operation(s, owner, a.operationId, 'release');
        const resource = this.resource(s, owner, a.resourceId, a.resourceKind);
        requireState(operation.dispatchCount === 1 && operation.resourceIds.includes(a.resourceId), 'release-not-dispatched');
        requireState(id(a.receiptId) && ['released', 'unconfirmed'].includes(a.result), 'invalid-receipt');
        const receipt = { receiptId: a.receiptId, owner: clone(owner.identity), operationId: a.operationId,
          resourceId: a.resourceId, resourceKind: a.resourceKind, result: a.result };
        const previous = s.receipts.get(a.receiptId);
        if (previous) {
          requireState(equal(previous, receipt), 'receipt-conflict'); record('release-evidence-reused'); return reuse();
        }
        requireState(resource.releaseState !== 'released' || a.result === 'released', 'resource-already-released');
        s.receipts.set(a.receiptId, receipt); resource.releaseState = a.result; record();
        if (a.result === 'unconfirmed') this.markUnknown(s, owner, { kind: 'resource', id: a.resourceId }, 'release-unconfirmed', command.commandId, emit);
        return accept();
      }
      case 'observe-unknown': {
        shape(['owner', 'subject', 'reason']);
        requireState(keys(a.subject, ['kind', 'id']) && id(a.subject.id) && id(a.reason), 'invalid-subject');
        let pending = false;
        switch (a.subject.kind) {
          case 'create': pending = a.subject.id === create.operationId && create.phase !== 'settled'; break;
          case 'release': {
            const op = s.operations.get(a.subject.id);
            pending = op?.type === 'release' && equal(op.owner, owner.identity) && op.phase !== 'complete'; break;
          }
          case 'use': {
            const use = s.uses.get(a.subject.id);
            pending = use && equal(use.owner, owner.identity) && use.state === 'in-flight'; break;
          }
          case 'resource': {
            const resource = s.resources.get(a.subject.id);
            pending = resource && equal(resource.owner, owner.identity) && resource.releaseState !== 'released'; break;
          }
          default: throw new Rejection('invalid-subject');
        }
        requireState(pending && owner.slotHeld, 'subject-settled');
        return this.markUnknown(s, owner, a.subject, a.reason, command.commandId, emit) ? reuse() : accept();
      }
      default: throw new Rejection('unknown-command');
    }
  }

  reconcile(s, commandId, emit) {
    for (const owner of s.owners.values()) {
      const create = s.operations.get(owner.createOperationId);
      const release = s.operations.get(owner.releaseOperationId);
      const idle = ![...s.uses.values()].some((use) => equal(use.owner, owner.identity) && use.state === 'in-flight');
      if (release && release.phase !== 'complete' && create.phase === 'settled' && idle) {
        const noResources = create.outcome === 'failed' && owner.resourceIds.length === 0;
        const allReleased = owner.resourceIds.length > 0 && release.phase === 'dispatched'
          && release.resourceIds.every((resourceId) => s.resources.get(resourceId).releaseState === 'released');
        if (noResources || allReleased) {
          release.phase = 'complete'; release.outcome = noResources ? 'not-required' : 'released';
          emit('release-completed', owner.identity, { operationId: release.operationId, outcome: release.outcome, dispatchCount: release.dispatchCount });
        }
      }
    }
    for (const observation of s.unknowns.values()) {
      if (observation.resolvedBy !== null) continue;
      const { kind, id: subjectId } = observation.subject;
      const resolved = kind === 'create' ? s.operations.get(subjectId)?.phase === 'settled'
        : kind === 'release' ? s.operations.get(subjectId)?.phase === 'complete'
          : kind === 'use' ? s.uses.get(subjectId)?.state === 'ended' : s.resources.get(subjectId)?.releaseState === 'released';
      if (resolved) {
        observation.resolvedBy = commandId;
        emit('unknown-resolved', observation.owner, { subject: observation.subject, first: observation.first, resolvedBy: commandId });
      }
    }
    for (const owner of s.owners.values()) {
      if (!owner.slotHeld) continue;
      const create = s.operations.get(owner.createOperationId);
      const release = s.operations.get(owner.releaseOperationId);
      const known = ![...s.unknowns.values()].some((entry) => equal(entry.owner, owner.identity) && entry.resolvedBy === null);
      const idle = ![...s.uses.values()].some((use) => equal(use.owner, owner.identity) && use.state === 'in-flight');
      const zeroFailure = create.outcome === 'failed' && owner.resourceIds.length === 0 && (!release || release.outcome === 'not-required');
      const released = release?.phase === 'complete' && release.outcome === 'released';
      if (create.phase === 'settled' && known && idle && (zeroFailure || released)) {
        owner.slotHeld = false; owner.returnedBy = commandId;
        emit('slot-returned', owner.identity, { createOperationId: owner.createOperationId, releaseOperationId: owner.releaseOperationId });
      }
    }
  }
}
