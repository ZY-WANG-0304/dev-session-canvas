// Trusted input schedules. Expected decisions are never passed to the model.
export const FIXTURE_SCHEMA = 'owner-quarantine-fixtures-v2';
export const DOMAINS = Object.freeze(['domain-shared', 'domain-a', 'domain-b']);
const TITLES = [
  'Reserve before create and return only a proven empty failed allocation',
  'Pending creation without acquisitions still occupies a slot',
  'Partial creation failure cannot erase an acquired resource',
  'Quarantined A does not forbid modeled B data application and release',
  'Two admitted unknown owners remain two, despite threshold one',
  'All use tokens must end before the single owner release dispatch',
  'Partial release and unknown obligations prevent slot return and reopen',
  'Late same-operation resource proof preserves first unknown and requires reopen',
  'Every owner, resource and operation identity is checked independently',
  'Old generation receipts settle only their original owner',
  'Generation and domain changes cannot reset the unknown ledger',
  'Pending and completed release requests reuse one logical operation',
  'Exact duplicate receipts are inert and conflicting receipts are rejected',
  'Terminal allocations, resources and operations retain tombstones',
  'Invalid commands have no domain-state side effects',
  'Unsettled creation, use and release remain occupied and quarantined',
];
export const SCHEDULE = Object.freeze(TITLES.map((title, index) => Object.freeze({
  id: `D4v2-${String(index + 1).padStart(2, '0')}`, title,
})));

export function makeFixture(entry, runId) {
  if (!SCHEDULE.some((item) => item.id === entry.id)) throw new Error('unknown fixture');
  const commands = [];
  const expectations = [];
  const ref = (label, ownerGeneration = 'generation-1', failureDomainId = 'domain-shared') => ({
    runId, caseId: entry.id, failureDomainId, executionId: `${entry.id}/execution-${label}`,
    ownerGeneration, allocationId: `${entry.id}/${label}`,
  });
  const A = ref('A'); const B = ref('B'); const C = ref('C');
  const createId = (owner) => `${owner.allocationId}/create`;
  const releaseId = (owner) => `${owner.allocationId}/release`;
  const resourceId = (owner, kind) => `${owner.allocationId}/${kind}`;
  const kinds = ['pipe', 'waiter', 'process'];
  const add = (kind, args, status = 'accepted', reason = null) => {
    const commandSeq = commands.length + 1;
    const commandId = `${entry.id}/command-${String(commandSeq).padStart(3, '0')}`;
    commands.push({ schema: 'runtime-owner-quarantine-command-v2', runId, caseId: entry.id, commandId, commandSeq, kind, args: structuredClone(args) });
    expectations.push({ commandId, status, reason });
  };
  const reject = (kind, args, reason) => add(kind, args, 'rejected', reason);
  const reserve = (owner) => add('reserve', { owner, createOperationId: createId(owner) });
  const dispatchCreate = (owner) => add('dispatch-create', { owner, createOperationId: createId(owner) });
  const acquire = (owner, kind) => add('acquire', { owner, createOperationId: createId(owner), resourceId: resourceId(owner, kind), resourceKind: kind });
  const report = (owner, outcome) => add('report-create', { owner, createOperationId: createId(owner), outcome });
  const seal = (owner, resources = kinds) => add('seal-create', { owner, createOperationId: createId(owner), resourceIds: resources.map((kind) => resourceId(owner, kind)) });
  const ready = (owner, resources = kinds) => {
    reserve(owner); dispatchCreate(owner); resources.forEach((kind) => acquire(owner, kind)); report(owner, 'success'); seal(owner, resources);
  };
  const request = (owner, params = { reason: 'normal' }) => add('request-release', { owner, operationId: releaseId(owner), params });
  const dispatchRelease = (owner, resources = kinds) => add('dispatch-release', { owner, operationId: releaseId(owner), resourceIds: resources.map((kind) => resourceId(owner, kind)) });
  const receipt = (owner, kind, result = 'released', label = kind) => ({ owner, operationId: releaseId(owner),
    resourceId: resourceId(owner, kind), resourceKind: kind, receiptId: `${owner.allocationId}/receipt-${label}`, result });
  const release = (owner, resources = kinds) => { request(owner); dispatchRelease(owner, resources); resources.forEach((kind) => add('release-evidence', receipt(owner, kind))); };
  const unknown = (owner, kind, subjectId, reason = 'observation-deadline') => add('observe-unknown', { owner, subject: { kind, id: subjectId }, reason });
  const use = (owner, label, useKind = 'io') => ({ owner, resourceId: resourceId(owner, 'pipe'), resourceKind: 'pipe',
    tokenId: `${owner.allocationId}/use-${label}`, useKind, batchId: useKind === 'data-application' ? `${owner.allocationId}/batch-${label}` : null });
  const end = ({ owner, resourceId, resourceKind, tokenId }) => ({ owner, resourceId, resourceKind, tokenId });
  switch (entry.id) {
    case 'D4v2-01':
      reserve(A); dispatchCreate(A); acquire(A, 'pipe'); report(A, 'failed'); seal(A, ['pipe']);
      reserve(B); dispatchCreate(B); reject('reserve', { owner: C, createOperationId: createId(C) }, 'capacity');
      report(B, 'failed'); seal(B, []); reserve(C); break;
    case 'D4v2-02':
      reserve(A); dispatchCreate(A); request(A);
      reject('dispatch-release', { owner: A, operationId: releaseId(A), resourceIds: [] }, 'create-not-sealed');
      reject('seal-create', { owner: A, createOperationId: createId(A), resourceIds: [] }, 'create-not-reported');
      reserve(B); reject('reserve', { owner: C, createOperationId: createId(C) }, 'capacity');
      unknown(A, 'create', createId(A)); break;
    case 'D4v2-03':
      reserve(A); dispatchCreate(A); acquire(A, 'pipe'); report(A, 'failed');
      reject('seal-create', { owner: A, createOperationId: createId(A), resourceIds: [] }, 'acquisition-set-mismatch');
      seal(A, ['pipe']); release(A, ['pipe']); break;
    case 'D4v2-04': {
      ready(A); ready(B); unknown(A, 'resource', resourceId(A, 'pipe'));
      const token = use(B, 'fresh', 'data-application'); add('begin-use', token); add('end-use', end(token)); release(B);
      reject('reserve', { owner: C, createOperationId: createId(C) }, 'unknown-quarantine'); break;
    }
    case 'D4v2-05': {
      const collisionA = { ...A, allocationId: `${entry.id}/a/resource/x` };
      const collisionB = { ...B, allocationId: `${entry.id}/a` };
      for (const [owner, pipeId] of [[collisionA, 'y'], [collisionB, 'x/resource/y']]) {
        reserve(owner); dispatchCreate(owner);
        add('acquire', { owner, createOperationId: createId(owner), resourceId: pipeId, resourceKind: 'pipe' });
        acquire(owner, 'waiter'); acquire(owner, 'process'); report(owner, 'success');
        add('seal-create', { owner, createOperationId: createId(owner), resourceIds: [pipeId, resourceId(owner, 'waiter'), resourceId(owner, 'process')] });
      }
      unknown(collisionA, 'resource', 'y'); unknown(collisionB, 'resource', 'x/resource/y');
      reject('reserve', { owner: C, createOperationId: createId(C) }, 'unknown-quarantine');
      reject('reopen', { expectedGeneration: 'generation-1' }, 'unknown-still-retained'); break;
    }
    case 'D4v2-06': {
      ready(A); const first = use(A, '1'); const second = use(A, '2');
      add('begin-use', first); add('begin-use', second); request(A);
      const dispatch = { owner: A, operationId: releaseId(A), resourceIds: kinds.map((kind) => resourceId(A, kind)) };
      reject('dispatch-release', dispatch, 'uses-in-flight');
      reject('end-use', { ...end(first), tokenId: `${A.allocationId}/stranger-token` }, 'token-mismatch');
      add('end-use', end(first)); reject('end-use', end(first), 'token-already-ended'); reject('dispatch-release', dispatch, 'uses-in-flight');
      add('end-use', end(second)); dispatchRelease(A); kinds.forEach((kind) => add('release-evidence', receipt(A, kind))); break;
    }
    case 'D4v2-07':
      ready(A); request(A); dispatchRelease(A); add('release-evidence', receipt(A, 'pipe'));
      add('release-evidence', receipt(A, 'waiter', 'unconfirmed')); unknown(A, 'release', releaseId(A));
      reject('reopen', { expectedGeneration: 'generation-1' }, 'unknown-still-retained');
      reject('reserve', { owner: B, createOperationId: createId(B) }, 'unknown-quarantine'); break;
    case 'D4v2-08':
      ready(A); ready(B); request(A); dispatchRelease(A); add('release-evidence', receipt(A, 'pipe', 'unconfirmed', 'pipe-first'));
      unknown(A, 'release', releaseId(A)); add('release-evidence', receipt(A, 'waiter')); add('release-evidence', receipt(A, 'process'));
      add('observe-unknown', { owner: A, subject: { kind: 'release', id: releaseId(A) }, reason: 'second-deadline' }, 'reused');
      add('release-evidence', receipt(A, 'pipe', 'released', 'pipe-late'));
      reject('reserve', { owner: C, createOperationId: createId(C) }, 'unknown-quarantine');
      add('reopen', { expectedGeneration: 'generation-1' }); reserve(C); break;
    case 'D4v2-09': {
      ready(A); ready(B); request(A); dispatchRelease(A); request(B); dispatchRelease(B);
      const original = receipt(A, 'pipe');
      for (const field of ['runId', 'caseId', 'failureDomainId', 'executionId', 'ownerGeneration']) {
        reject('release-evidence', { ...original, owner: { ...A, [field]: `wrong-${field}` } }, 'identity-mismatch');
      }
      reject('release-evidence', { ...original, owner: { ...A, allocationId: B.allocationId } }, 'identity-mismatch');
      reject('release-evidence', { ...original, resourceId: resourceId(B, 'pipe') }, 'resource-mismatch');
      reject('release-evidence', { ...original, resourceKind: 'waiter' }, 'resource-mismatch');
      reject('release-evidence', { ...original, operationId: releaseId(B) }, 'operation-mismatch');
      kinds.forEach((kind) => add('release-evidence', receipt(A, kind)));
      kinds.forEach((kind) => add('release-evidence', receipt(B, kind))); break;
    }
    case 'D4v2-10': {
      ready(A); request(A); dispatchRelease(A); add('advance-generation', { previous: 'generation-1', next: 'generation-2' });
      const B2 = ref('B', 'generation-2'); ready(B2); request(B2); dispatchRelease(B2);
      reject('release-evidence', { ...receipt(B2, 'pipe'), owner: { ...B2, ownerGeneration: 'generation-1' } }, 'identity-mismatch');
      reject('release-evidence', { ...receipt(A, 'pipe'), operationId: releaseId(B2) }, 'operation-mismatch');
      kinds.forEach((kind) => add('release-evidence', receipt(A, kind)));
      kinds.forEach((kind) => add('release-evidence', receipt(B2, kind))); break;
    }
    case 'D4v2-11': {
      reserve(A); dispatchCreate(A); unknown(A, 'create', createId(A));
      add('advance-generation', { previous: 'generation-1', next: 'generation-2' });
      const retry = ref('retry', 'generation-2', 'domain-b');
      reject('reserve', { owner: retry, createOperationId: createId(retry) }, 'unknown-quarantine');
      reject('reserve', { owner: ref('A', 'generation-2'), createOperationId: `${createId(A)}-new` }, 'allocation-exists');
      reject('reopen', { expectedGeneration: 'generation-2' }, 'unknown-still-retained'); break;
    }
    case 'D4v2-12': {
      ready(A); ready(B); const params = { reason: 'normal', detail: { first: 1, second: ['x', true] } }; request(A, params);
      add('request-release', { owner: A, operationId: releaseId(A), params: { detail: { second: ['x', true], first: 1 }, reason: 'normal' } }, 'reused');
      reject('request-release', { owner: A, operationId: releaseId(A), params: { reason: 'changed' } }, 'conflicting-release');
      reject('request-release', { owner: B, operationId: releaseId(A), params }, 'operation-id-used');
      reject('request-release', { owner: A, operationId: `${releaseId(A)}-retry`, params }, 'conflicting-release');
      reject('request-release', { owner: A, operationId: createId(A), params }, 'operation-id-used');
      dispatchRelease(A); kinds.forEach((kind) => add('release-evidence', receipt(A, kind)));
      add('request-release', { owner: A, operationId: releaseId(A), params }, 'reused');
      reject('request-release', { owner: A, operationId: `${releaseId(A)}-after`, params }, 'owner-released'); break;
    }
    case 'D4v2-13': {
      ready(A); request(A); dispatchRelease(A); const first = receipt(A, 'pipe', 'unconfirmed', 'first');
      add('release-evidence', first); add('release-evidence', first, 'reused');
      reject('release-evidence', { ...first, result: 'released' }, 'receipt-conflict');
      const late = receipt(A, 'pipe', 'released', 'late'); add('release-evidence', late);
      reject('release-evidence', receipt(A, 'pipe', 'unconfirmed', 'reverse'), 'resource-already-released');
      add('release-evidence', late, 'reused'); add('release-evidence', receipt(A, 'waiter')); add('release-evidence', receipt(A, 'process')); break;
    }
    case 'D4v2-14': {
      reserve(A); dispatchCreate(A); request(A); report(A, 'failed'); seal(A, []);
      reject('reserve', { owner: A, createOperationId: createId(A) }, 'allocation-exists');
      add('advance-generation', { previous: 'generation-1', next: 'generation-2' });
      const A2 = ref('A', 'generation-2'); const B2 = ref('B', 'generation-2'); const C2 = ref('C', 'generation-2');
      reject('reserve', { owner: A2, createOperationId: `${createId(A)}-new` }, 'allocation-exists');
      reject('reserve', { owner: B2, createOperationId: createId(A) }, 'operation-id-used');
      ready(B2); release(B2); reserve(C2); dispatchCreate(C2);
      reject('acquire', { owner: C2, createOperationId: createId(C2), resourceId: resourceId(B2, 'pipe'), resourceKind: 'pipe' }, 'resource-id-used');
      reject('request-release', { owner: C2, operationId: releaseId(B2), params: { reason: 'normal' } }, 'operation-id-used');
      add('release-evidence', receipt(B2, 'pipe'), 'reused'); break;
    }
    case 'D4v2-15': {
      const invalidOwner = { ...A }; delete invalidOwner.executionId;
      reject('reserve', { owner: invalidOwner, createOperationId: createId(A) }, 'invalid-identity'); reserve(A);
      reject('report-create', { owner: A, createOperationId: createId(A), outcome: 'failed' }, 'create-not-dispatched');
      dispatchCreate(A);
      reject('report-create', { owner: A, createOperationId: createId(A), outcome: 'success' }, 'zero-resource-success-unsupported');
      reject('acquire', { owner: A, createOperationId: createId(A), resourceId: resourceId(A, 'pipe'), resourceKind: 'unknown-kind' }, 'invalid-resource');
      acquire(A, 'pipe');
      reject('report-create', { owner: A, createOperationId: createId(A), outcome: 'maybe' }, 'invalid-create-outcome');
      reject('seal-create', { owner: A, createOperationId: createId(A), resourceIds: [] }, 'create-not-reported'); report(A, 'failed');
      add('report-create', { owner: A, createOperationId: createId(A), outcome: 'failed' }, 'reused');
      reject('report-create', { owner: A, createOperationId: createId(A), outcome: 'success' }, 'conflicting-create-result');
      reject('seal-create', { owner: A, createOperationId: createId(A), resourceIds: [resourceId(A, 'pipe'), resourceId(A, 'pipe')] }, 'acquisition-set-mismatch'); seal(A, ['pipe']);
      reject('begin-use', { ...use(A, 'invalid'), useKind: 'mystery' }, 'invalid-use');
      reject('request-release', { owner: A, operationId: releaseId(A), params: [] }, 'invalid-release-request');
      reject('observe-unknown', { owner: A, subject: { kind: 'mystery', id: createId(A) }, reason: 'deadline' }, 'invalid-subject');
      reject('advance-generation', { previous: 'wrong-generation', next: 'generation-2' }, 'invalid-generation');
      reject('reopen', { expectedGeneration: 'wrong-generation' }, 'generation-mismatch');
      reject('end-use', { ...end(use(A, 'missing')), unexpected: true }, 'invalid-arguments'); break;
    }
    case 'D4v2-16': {
      reserve(A); dispatchCreate(A); ready(B); const token = use(B, 'held'); add('begin-use', token); request(B);
      unknown(A, 'create', createId(A)); unknown(B, 'use', token.tokenId); unknown(B, 'release', releaseId(B)); unknown(B, 'resource', resourceId(B, 'pipe'));
      reject('dispatch-release', { owner: B, operationId: releaseId(B), resourceIds: kinds.map((kind) => resourceId(B, kind)) }, 'uses-in-flight');
      reject('reserve', { owner: C, createOperationId: createId(C) }, 'unknown-quarantine');
      reject('reopen', { expectedGeneration: 'generation-1' }, 'unknown-still-retained'); break;
    }
  }
  return { schema: FIXTURE_SCHEMA, entry: structuredClone(entry), context: { runId, caseId: entry.id, domains: [...DOMAINS] }, commands, expectations };
}

export function makeFixtures(runId) { return SCHEDULE.map((entry) => makeFixture(entry, runId)); }
