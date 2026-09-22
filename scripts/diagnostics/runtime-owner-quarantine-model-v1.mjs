// Deterministic owner-quarantine model. It does not create native resources.
import { isDeepStrictEqual } from 'node:util';

export const MODEL_SCHEMA = 'runtime-owner-quarantine-model-v1';
export const SLOT_CAPACITY = 2;
export const UNKNOWN_THRESHOLD = 1;
export const RESOURCE_KINDS = Object.freeze(['pipe', 'waiter', 'process']);

const clone = (value) => structuredClone(value);
const identityOf = ({ executionId, generation }) => ({ executionId, generation });

export class OwnerQuarantineModel {
  constructor({
    capacity = SLOT_CAPACITY,
    unknownThreshold = UNKNOWN_THRESHOLD,
    generation = 'generation-1',
    emit = () => {},
  } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('invalid capacity');
    if (!Number.isSafeInteger(unknownThreshold) || unknownThreshold < 1) throw new Error('invalid unknown threshold');
    this.capacity = capacity;
    this.unknownThreshold = unknownThreshold;
    this.generation = generation;
    this.emitSink = emit;
    this.sequence = 0;
    this.nativeCreateRequests = 0;
    this.admissionBlocked = false;
    this.owners = new Map();
    this.operations = new Map();
  }

  emit(event, detail = {}) {
    const value = { sequence: ++this.sequence, event, detail: clone(detail) };
    this.emitSink(value);
    return value;
  }

  activeOwners() {
    return [...this.owners.values()].filter((owner) => owner.status !== 'released');
  }

  unknownOwners() {
    return this.activeOwners().filter((owner) => owner.status === 'unknown');
  }

  ownerByIdentity(identity) {
    if (!identity || typeof identity.executionId !== 'string' || typeof identity.generation !== 'string') return null;
    return [...this.owners.values()].find((owner) => owner.executionId === identity.executionId && owner.generation === identity.generation) ?? null;
  }

  ownerByAllocation(allocationId) {
    return this.owners.get(allocationId) ?? null;
  }

  reject(reason, detail = {}) {
    return this.emit('rejected', { reason, ...detail });
  }

  // Admission reserves a slot before the operation that could obtain a resource.
  admit({ executionId, generation = this.generation, allocationId = `${executionId}/allocation-1`, resources = RESOURCE_KINDS } = {}) {
    const identity = { executionId, generation };
    const existing = this.ownerByAllocation(allocationId);
    if (existing) return this.reject('allocation-exists', { allocationId });
    if (typeof executionId !== 'string' || !executionId || typeof generation !== 'string' || !generation) {
      return this.reject('invalid-identity', { identity });
    }
    if (generation !== this.generation) return this.reject('generation-mismatch', { identity, currentGeneration: this.generation });
    if (this.admissionBlocked || this.unknownOwners().length >= this.unknownThreshold) {
      return this.reject('unknown-quarantine', { identity, unknownCount: this.unknownOwners().length });
    }
    if (this.activeOwners().length >= this.capacity) {
      return this.reject('capacity', { identity, capacity: this.capacity });
    }
    if (!Array.isArray(resources) || resources.some((kind) => !RESOURCE_KINDS.includes(kind))) {
      return this.reject('invalid-resources', { identity });
    }
    const owner = {
      allocationId,
      ...identity,
      status: 'active',
      resources: [...new Set(resources)].map((kind) => ({ kind, state: 'retained' })),
      release: null,
      nativeCreateStarted: false,
      nativeCreateReturned: false,
      dataEvents: 0,
      settlementEvents: 0,
      reconnects: 0,
    };
    // The slot is visible before the native create request is emitted.
    this.owners.set(allocationId, owner);
    this.nativeCreateRequests += 1;
    owner.nativeCreateStarted = true;
    this.emit('admitted', { allocationId, identity, resources: owner.resources.map((resource) => resource.kind),
      capacity: this.capacity, occupied: this.activeOwners().length });
    this.emit('native-create-request', { allocationId, identity, requestNumber: this.nativeCreateRequests });
    return clone(owner);
  }

  createReturned(allocationId, { resourceKinds = null } = {}) {
    const owner = this.ownerByAllocation(allocationId);
    if (!owner) return this.reject('unknown-allocation', { allocationId });
    if (owner.status === 'released') return this.reject('released-owner', { allocationId });
    if (!owner.nativeCreateStarted || owner.nativeCreateReturned) return this.reject('invalid-create-return', { allocationId });
    owner.nativeCreateReturned = true;
    if (resourceKinds) {
      if (!Array.isArray(resourceKinds) || resourceKinds.some((kind) => !RESOURCE_KINDS.includes(kind))) return this.reject('invalid-resources', { allocationId });
      owner.resources = [...new Set(resourceKinds)].map((kind) => ({ kind, state: 'retained' }));
    }
    this.emit('native-create-returned', { allocationId, resourceKinds: owner.resources.map((resource) => resource.kind) });
    return clone(owner);
  }

  createFailed(allocationId, { resourceKinds = [], error = 'create-failed' } = {}) {
    const owner = this.ownerByAllocation(allocationId);
    if (!owner) return this.reject('unknown-allocation', { allocationId });
    if (!Array.isArray(resourceKinds) || resourceKinds.some((kind) => !RESOURCE_KINDS.includes(kind))) return this.reject('invalid-resources', { allocationId });
    owner.nativeCreateReturned = true;
    owner.resources = [...new Set(resourceKinds)].map((kind) => ({ kind, state: 'retained' }));
    if (owner.resources.length === 0) {
      this.owners.delete(allocationId);
      this.emit('create-failed-no-resource', { allocationId, error, slotReturned: true });
      return { kind: 'slot-returned', allocationId };
    }
    owner.status = 'partial-create';
    this.emit('create-failed-partial', { allocationId, error, retained: owner.resources.map((resource) => resource.kind), slotReturned: false });
    return clone(owner);
  }

  data(allocationId, count = 1) {
    const owner = this.ownerByAllocation(allocationId);
    if (!owner || owner.status === 'released') return this.reject('data-owner-invalid', { allocationId });
    if (!Number.isSafeInteger(count) || count < 1) return this.reject('invalid-data-count', { allocationId });
    owner.dataEvents += count;
    this.emit('owner-data', { allocationId, count, total: owner.dataEvents });
    return owner.dataEvents;
  }

  settle(allocationId, detail = 'settled') {
    const owner = this.ownerByAllocation(allocationId);
    if (!owner || owner.status === 'released') return this.reject('settlement-owner-invalid', { allocationId });
    owner.settlementEvents += 1;
    this.emit('owner-settlement', { allocationId, detail, count: owner.settlementEvents });
    return owner.settlementEvents;
  }

  markUnknown(allocationId, reason = 'observation-deadline') {
    const owner = this.ownerByAllocation(allocationId);
    if (!owner) return this.reject('unknown-allocation', { allocationId });
    if (owner.status === 'released') return this.reject('released-owner', { allocationId });
    if (owner.status === 'unknown' && owner.unknownReason === reason) return this.emit('unknown-reused', { allocationId, reason });
    owner.status = 'unknown';
    owner.unknownReason = reason;
    this.admissionBlocked = true;
    this.emit('owner-unknown', { allocationId, reason, unknownCount: this.unknownOwners().length, threshold: this.unknownThreshold });
    return clone(owner);
  }

  reconnect(generation) {
    if (typeof generation !== 'string' || !generation || generation === this.generation) return this.reject('invalid-generation', { generation });
    const previous = this.generation;
    this.generation = generation;
    for (const owner of this.activeOwners()) owner.reconnects += 1;
    // Deliberately retain owners and admission state across reconnect.
    this.emit('generation-updated', { previous, generation, retainedAllocations: this.activeOwners().map((owner) => owner.allocationId) });
    return generation;
  }

  requestRelease({ allocationId, identity, operationId, params = {} } = {}) {
    const owner = this.ownerByAllocation(allocationId);
    if (!owner) return this.reject('unknown-allocation', { allocationId, operationId });
    if (!isDeepStrictEqual(identity, identityOf(owner))) return this.reject('identity-mismatch', { allocationId, operationId, expected: identityOf(owner), received: identity });
    if (owner.status === 'released') return this.reject('released-owner', { allocationId, operationId });
    if (!operationId) return this.reject('invalid-operation', { allocationId });
    if (owner.release) {
      if (owner.release.operationId !== operationId || !isDeepStrictEqual(owner.release.params, params)) {
        return this.reject('conflicting-release', { allocationId, operationId });
      }
      this.emit('release-reused', { allocationId, operationId, dispatchCount: owner.release.dispatchCount });
      return clone(owner.release);
    }
    owner.release = { operationId, params: clone(params), dispatchCount: 1, outcome: 'pending', resources: {} };
    owner.status = 'release-in-flight';
    this.operations.set(operationId, { allocationId, identity: identityOf(owner), params: clone(params) });
    this.emit('release-requested', { allocationId, operationId, params: clone(params), dispatchCount: 1 });
    return clone(owner.release);
  }

  releaseResource({ allocationId, identity, operationId, resourceKind, result = 'released', late = false } = {}) {
    const owner = this.ownerByAllocation(allocationId);
    if (!owner) return this.reject('unknown-allocation', { allocationId, operationId, resourceKind });
    if (!isDeepStrictEqual(identity, identityOf(owner))) return this.reject('identity-mismatch', { allocationId, operationId, resourceKind });
    if (!owner.release || owner.release.operationId !== operationId) return this.reject('operation-mismatch', { allocationId, operationId, resourceKind });
    if (!['released', 'unknown'].includes(result)) return this.reject('invalid-resource-result', { allocationId, operationId, resourceKind, result });
    const resource = owner.resources.find((item) => item.kind === resourceKind);
    if (!resource) return this.reject('resource-mismatch', { allocationId, operationId, resourceKind });
    const previous = owner.release.resources[resourceKind];
    if (previous && previous !== result) return this.reject('conflicting-resource-result', { allocationId, operationId, resourceKind });
    if (previous) return this.emit('release-resource-reused', { allocationId, operationId, resourceKind, result, late });
    owner.release.resources[resourceKind] = result;
    resource.state = result === 'released' ? 'released' : 'unknown';
    this.emit('release-resource', { allocationId, operationId, resourceKind, result, late });
    if (result !== 'released') {
      owner.status = 'unknown';
      owner.unknownReason = owner.unknownReason ?? 'resource-release-unknown';
      this.admissionBlocked = true;
    }
    const complete = owner.resources.length > 0 && owner.resources.every((item) => owner.release.resources[item.kind] === 'released');
    if (complete) {
      owner.status = 'released';
      owner.release.outcome = 'released';
      this.emit('owner-released', { allocationId, operationId, late, slotReturned: true });
      // Releasing a late unknown owner does not reopen admission implicitly.
      // A separate, auditable reopen action is required before new work.
    }
    return clone(owner);
  }

  reopenAdmission() {
    if (this.unknownOwners().length > 0) return this.reject('unknown-still-retained', { unknownCount: this.unknownOwners().length });
    this.admissionBlocked = false;
    this.emit('admission-reopened', { explicit: true });
    return true;
  }

  snapshot() {
    return clone({ schema: MODEL_SCHEMA, capacity: this.capacity, unknownThreshold: this.unknownThreshold,
      generation: this.generation, admissionBlocked: this.admissionBlocked, nativeCreateRequests: this.nativeCreateRequests,
      occupied: this.activeOwners().length, unknownCount: this.unknownOwners().length,
      owners: [...this.owners.values()], operations: [...this.operations.values()] });
  }
}

export function createModel(options = {}) {
  const trace = [];
  const model = new OwnerQuarantineModel({ ...options, emit: (event) => trace.push(event) });
  return { model, trace };
}
