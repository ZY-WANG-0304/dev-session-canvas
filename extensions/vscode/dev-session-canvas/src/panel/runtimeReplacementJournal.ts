import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  ExecutionNodeKind,
  PendingExecutionLaunch,
  RuntimeHostBackendKind
} from '../common/protocol';
import { isRuntimeOwnerDescriptor, type RuntimeOwnerDescriptorV1 } from '../common/runtimeRootOwnership';

export type RuntimeReplacementPhase =
  | 'prepared'
  | 'create-may-have-been-submitted'
  | 'not-acquired'
  | 'bound'
  | 'quarantined';

export interface RuntimeReplacementBindingV1 {
  sessionId: string;
  backendKind: RuntimeHostBackendKind;
  runtimeStoragePath: string;
  runtimeOwner?: RuntimeOwnerDescriptorV1 | null;
  status: string;
  attachmentState?: string;
  lifecycle?: string;
}

export interface RuntimeReplacementOriginalNodeV1 {
  status?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeReplacementOperationV1 {
  version: 1;
  operationId: string;
  rootPath: string;
  localNodeId: string;
  nodeId: string;
  kind: ExecutionNodeKind;
  originalNode?: RuntimeReplacementOriginalNodeV1;
  originalBinding?: RuntimeReplacementBindingV1;
  targetBinding: RuntimeReplacementBindingV1;
  reservedSessionId: string;
  launchMode: PendingExecutionLaunch;
  providerResume?: {
    strategy?: string;
    sessionId?: string;
    storagePath?: string;
  };
  stop: 'confirmed' | 'unconfirmed';
  evidence: string;
  phase: RuntimeReplacementPhase;
  /** A successful snapshot application confirmed that the reserved binding exists. */
  boundConfirmed?: boolean;
  createdAt: string;
  updatedAt: string;
  reason?: string;
}

export class RuntimeReplacementJournalError extends Error {
  constructor(readonly recordPath: string, reason: string) {
    super(`Runtime replacement journal is invalid at ${recordPath}: ${reason}`);
  }
}

export interface RuntimeReplacementNodeIdentity {
  rootPath: string;
  nodeId: string;
  kind: ExecutionNodeKind;
}

/**
 * The responsibility observed when a deletion started. Cleanup may remove a record
 * only while all present fields still match; a phase advance is a new responsibility
 * and must be settled (or retained) instead of being deleted by the old observation.
 */
export interface RuntimeReplacementExpectation {
  operationId: string;
  phase?: RuntimeReplacementPhase;
  updatedAt?: string;
}

function directoryPath(globalStoragePath: string): string {
  return path.join(globalStoragePath, 'runtime-replacements-v1');
}

function fileName(identity: RuntimeReplacementNodeIdentity): string {
  return `${createHash('sha256').update(JSON.stringify([
    path.resolve(identity.rootPath), identity.nodeId, identity.kind
  ])).digest('hex')}.json`;
}

function recordPath(globalStoragePath: string, identity: RuntimeReplacementNodeIdentity): string {
  return path.join(directoryPath(globalStoragePath), fileName(identity));
}

const RUNTIME_REPLACEMENT_LOCK_TIMEOUT_MS = (() => {
  const configured = Number(process.env.DSC_RUNTIME_REPLACEMENT_LOCK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 5_000;
})();

interface RuntimeReplacementLockOwner {
  pid: number;
  token: string;
  createdAtMs: number;
}

type RuntimeReplacementLockObservation =
  | { state: 'absent' }
  | { state: 'held'; generation: string; reclaimable: boolean };

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isSafePid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function lockGeneration(owner: RuntimeReplacementLockOwner): string {
  return generationForToken(owner.token);
}

function generationForToken(token: string): string {
  return `owner-${createHash('sha256').update(token).digest('hex')}`;
}

async function observeRuntimeReplacementLock(
  lockPath: string
): Promise<RuntimeReplacementLockObservation> {
  let stats;
  try {
    stats = await fs.stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    throw error;
  }
  let owner: RuntimeReplacementLockOwner | undefined;
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Partial<RuntimeReplacementLockOwner>;
    if (isSafePid(parsed.pid) && isString(parsed.token)) {
      owner = {
        pid: parsed.pid,
        token: parsed.token,
        createdAtMs: typeof parsed.createdAtMs === 'number' && Number.isFinite(parsed.createdAtMs)
          ? parsed.createdAtMs
          : stats.mtimeMs
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    owner = undefined;
  }
  if (!owner) {
    // A malformed lock cannot prove whether its creator is still alive. Fail closed:
    // an age heuristic would allow a live writer that was paused between the exclusive
    // create and publishing its owner to lose the lock and enter the critical section.
    return {
      state: 'held',
      generation: `malformed-${stats.ino}-${Math.trunc(stats.mtimeMs)}-${stats.size}`,
      reclaimable: false
    };
  }
  return {
    state: 'held',
    generation: lockGeneration(owner),
    // Age alone never proves that the owner stopped. Only a provably dead PID is
    // reclaimable; a reused PID leaves the lock held, which fails conservatively.
    reclaimable: owner.pid !== process.pid && !isProcessAlive(owner.pid)
  };
}

/**
 * Reclaims a lock whose owner PID is provably dead. The generation-scoped marker
 * is created with `wx`, so only one reclaimer acts on a given observation. The
 * lock is re-read under that marker before removal; a successor that acquired the
 * reclaimed path is therefore never removed by a stale observation.
 *
 * A marker is never reclaimed automatically. Removing it by observation would move
 * the same "check then delete a recreated path" race to the marker itself. If a
 * reclaimer dies while holding the marker, the record fails closed until the
 * leftover marker is removed manually.
 */
async function reclaimDeadRuntimeReplacementLock(
  lockPath: string, observation: Extract<RuntimeReplacementLockObservation, { state: 'held' }>
): Promise<void> {
  const markerPath = `${lockPath}.reclaim-${observation.generation}`;
  let marker;
  try {
    marker = await fs.open(markerPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  try {
    try {
      await marker.writeFile(JSON.stringify({
        pid: process.pid, token: randomUUID(), createdAtMs: Date.now()
      }));
      await marker.sync();
    } finally {
      await marker.close();
    }
  } catch (error) {
    // This marker was just created exclusively and is never reclaimed by others,
    // so a failed publish can safely remove its own path instead of wedging.
    await fs.rm(markerPath, { force: true }).catch(() => undefined);
    throw error;
  }
  try {
    const current = await observeRuntimeReplacementLock(lockPath);
    if (current.state !== 'held' || !current.reclaimable
      || current.generation !== observation.generation) return;
    await fs.rm(lockPath, { force: true });
  } finally {
    await fs.rm(markerPath, { force: true }).catch(() => undefined);
  }
}

async function withRuntimeReplacementLock<T>(recordFile: string, work: () => Promise<T>): Promise<T> {
  const lockPath = `${recordFile}.lock`;
  const deadline = Date.now() + RUNTIME_REPLACEMENT_LOCK_TIMEOUT_MS;
  const token = randomUUID();
  for (;;) {
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const observation = await observeRuntimeReplacementLock(lockPath);
      if (observation.state === 'held' && observation.reclaimable) {
        await reclaimDeadRuntimeReplacementLock(lockPath, observation);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Runtime replacement journal remained locked: ${recordFile}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10 + Math.floor(Math.random() * 10)));
      continue;
    }
    try {
      try {
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAtMs: Date.now() }));
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        // The exclusive create published an empty lock that no other process may
        // reclaim. Remove only our own just-created path on a failed owner write.
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      // Defense in depth: never enter the critical section unless the path still
      // publishes this holder's identity.
      const held = await observeRuntimeReplacementLock(lockPath);
      if (held.state !== 'held' || held.generation !== generationForToken(token)) {
        await new Promise(resolve => setTimeout(resolve, 10 + Math.floor(Math.random() * 10)));
        continue;
      }
      return await work();
    } finally {
      try {
        const owner = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { token?: unknown };
        if (owner.token === token) await fs.rm(lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // An unknown successor lock is never removed by a stale owner. It will
          // either be released by its owner or reclaimed by the stale-lock check.
        }
      }
    }
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateOriginalNode(value: unknown, recordFile: string): asserts value is RuntimeReplacementOriginalNodeV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeReplacementJournalError(recordFile, 'original node is not an object');
  }
  const originalNode = value as Partial<RuntimeReplacementOriginalNodeV1>;
  if (originalNode.status !== undefined && typeof originalNode.status !== 'string') {
    throw new RuntimeReplacementJournalError(recordFile, 'original node status is invalid');
  }
  if (originalNode.summary !== undefined && typeof originalNode.summary !== 'string') {
    throw new RuntimeReplacementJournalError(recordFile, 'original node summary is invalid');
  }
  if (originalNode.metadata !== undefined
    && (!originalNode.metadata || typeof originalNode.metadata !== 'object' || Array.isArray(originalNode.metadata))) {
    throw new RuntimeReplacementJournalError(recordFile, 'original node metadata is invalid');
  }
}

function validateBinding(value: unknown, recordFile: string): asserts value is RuntimeReplacementBindingV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeReplacementJournalError(recordFile, 'binding is not an object');
  }
  const binding = value as Partial<RuntimeReplacementBindingV1>;
  if (!isString(binding.sessionId) || !isString(binding.runtimeStoragePath) || !isString(binding.status)) {
    throw new RuntimeReplacementJournalError(recordFile, 'binding identity is incomplete');
  }
  if (binding.backendKind !== 'systemd-user' && binding.backendKind !== 'legacy-detached') {
    throw new RuntimeReplacementJournalError(recordFile, 'binding backend is invalid');
  }
  if (binding.runtimeOwner !== undefined && binding.runtimeOwner !== null
    && !isRuntimeOwnerDescriptor(binding.runtimeOwner)) {
    throw new RuntimeReplacementJournalError(recordFile, 'binding owner is invalid');
  }
  if (binding.attachmentState !== undefined && typeof binding.attachmentState !== 'string') {
    throw new RuntimeReplacementJournalError(recordFile, 'binding attachment state is invalid');
  }
  if (binding.lifecycle !== undefined && typeof binding.lifecycle !== 'string') {
    throw new RuntimeReplacementJournalError(recordFile, 'binding lifecycle is invalid');
  }
}

export function validateRuntimeReplacement(value: unknown, sourcePath: string): RuntimeReplacementOperationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeReplacementJournalError(sourcePath, 'record is not an object');
  }
  const record = value as Partial<RuntimeReplacementOperationV1>;
  if (record.version !== 1 || !isString(record.operationId) || !isString(record.rootPath)
    || !isString(record.localNodeId) || !isString(record.nodeId)
    || (record.kind !== 'agent' && record.kind !== 'terminal')
    || !isString(record.reservedSessionId)
    || (record.launchMode !== 'start' && record.launchMode !== 'resume')
    || (record.stop !== 'confirmed' && record.stop !== 'unconfirmed')
    || !isString(record.evidence)
    || !['prepared', 'create-may-have-been-submitted', 'not-acquired', 'bound', 'quarantined']
      .includes(record.phase ?? '')
    || !isString(record.createdAt) || !isString(record.updatedAt)) {
    throw new RuntimeReplacementJournalError(sourcePath, 'record identity or phase is incomplete');
  }
  if (record.boundConfirmed !== undefined && typeof record.boundConfirmed !== 'boolean') {
    throw new RuntimeReplacementJournalError(sourcePath, 'bound confirmation is invalid');
  }
  if (record.originalNode !== undefined) validateOriginalNode(record.originalNode, sourcePath);
  if (record.originalBinding !== undefined) validateBinding(record.originalBinding, sourcePath);
  validateBinding(record.targetBinding, sourcePath);
  if (record.targetBinding.sessionId !== record.reservedSessionId) {
    throw new RuntimeReplacementJournalError(sourcePath, 'reserved session does not match target binding');
  }
  if (record.providerResume !== undefined) {
    if (!record.providerResume || typeof record.providerResume !== 'object'
      || [record.providerResume.strategy, record.providerResume.sessionId, record.providerResume.storagePath]
        .some(value => value !== undefined && typeof value !== 'string')) {
      throw new RuntimeReplacementJournalError(sourcePath, 'provider resume reference is invalid');
    }
  }
  if (record.reason !== undefined && typeof record.reason !== 'string') {
    throw new RuntimeReplacementJournalError(sourcePath, 'reason is invalid');
  }
  return record as RuntimeReplacementOperationV1;
}

export async function readRuntimeReplacement(
  globalStoragePath: string,
  identity: RuntimeReplacementNodeIdentity
): Promise<RuntimeReplacementOperationV1 | undefined> {
  const file = recordPath(globalStoragePath, identity);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return validateRuntimeReplacement(JSON.parse(raw), file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof RuntimeReplacementJournalError) throw error;
    if (error instanceof SyntaxError) throw new RuntimeReplacementJournalError(file, 'JSON is invalid');
    throw error;
  }
}

export async function writeRuntimeReplacement(
  globalStoragePath: string,
  operation: RuntimeReplacementOperationV1
): Promise<string> {
  const directory = directoryPath(globalStoragePath);
  const file = recordPath(globalStoragePath, {
    rootPath: operation.rootPath, nodeId: operation.localNodeId, kind: operation.kind
  });
  const validated = validateRuntimeReplacement(operation, file);
  const temporary = path.join(directory, `.${path.basename(file, '.json')}-${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return withRuntimeReplacementLock(file, async () => {
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return file;
  });
}

export async function removeRuntimeReplacement(
  globalStoragePath: string,
  identity: RuntimeReplacementNodeIdentity
): Promise<void> {
  const file = recordPath(globalStoragePath, identity);
  await fs.mkdir(directoryPath(globalStoragePath), { recursive: true, mode: 0o700 });
  await withRuntimeReplacementLock(file, () => fs.rm(file, { force: true }));
}

export async function removeRuntimeReplacementIfCurrent(
  globalStoragePath: string,
  identity: RuntimeReplacementNodeIdentity,
  expectation: RuntimeReplacementExpectation | string
): Promise<'removed' | 'absent' | 'changed'> {
  const file = recordPath(globalStoragePath, identity);
  const expected = typeof expectation === 'string' ? { operationId: expectation } : expectation;
  await fs.mkdir(directoryPath(globalStoragePath), { recursive: true, mode: 0o700 });
  return withRuntimeReplacementLock(file, async () => {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
      throw error;
    }
    let current: RuntimeReplacementOperationV1;
    try {
      current = validateRuntimeReplacement(JSON.parse(raw), file);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new RuntimeReplacementJournalError(file, 'JSON is invalid');
      }
      throw error;
    }
    if (current.operationId !== expected.operationId) return 'changed';
    if (expected.phase !== undefined && current.phase !== expected.phase) return 'changed';
    if (expected.updatedAt !== undefined && current.updatedAt !== expected.updatedAt) return 'changed';
    await fs.rm(file, { force: true });
    return 'removed';
  });
}

/** True when a journal phase may have caused the reserved execution to exist. */
export function runtimeReplacementPhaseMayHaveAcquiredRuntime(phase: RuntimeReplacementPhase): boolean {
  return phase === 'create-may-have-been-submitted' || phase === 'quarantined' || phase === 'bound';
}

export async function listRuntimeReplacements(
  globalStoragePath: string
): Promise<RuntimeReplacementOperationV1[]> {
  const directory = directoryPath(globalStoragePath);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: RuntimeReplacementOperationV1[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(directory, entry.name);
    let raw: string;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    try { records.push(validateRuntimeReplacement(JSON.parse(raw), file)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new RuntimeReplacementJournalError(file, 'JSON is invalid');
      throw error;
    }
  }
  return records;
}

export function createRuntimeReplacementOperation(params: {
  rootPath: string;
  localNodeId: string;
  nodeId: string;
  kind: ExecutionNodeKind;
  originalNode?: RuntimeReplacementOriginalNodeV1;
  originalBinding?: RuntimeReplacementBindingV1;
  targetBinding: RuntimeReplacementBindingV1;
  reservedSessionId: string;
  launchMode: PendingExecutionLaunch;
  providerResume?: RuntimeReplacementOperationV1['providerResume'];
  stop: RuntimeReplacementOperationV1['stop'];
  evidence: string;
  reason?: string;
}): RuntimeReplacementOperationV1 {
  const now = new Date().toISOString();
  return {
    version: 1,
    operationId: randomUUID(),
    rootPath: params.rootPath,
    localNodeId: params.localNodeId,
    nodeId: params.nodeId,
    kind: params.kind,
    ...(params.originalNode ? { originalNode: params.originalNode } : {}),
    ...(params.originalBinding ? { originalBinding: params.originalBinding } : {}),
    targetBinding: params.targetBinding,
    reservedSessionId: params.reservedSessionId,
    launchMode: params.launchMode,
    ...(params.providerResume ? { providerResume: params.providerResume } : {}),
    stop: params.stop,
    evidence: params.evidence,
    phase: 'prepared',
    createdAt: now,
    updatedAt: now,
    ...(params.reason ? { reason: params.reason } : {})
  };
}
