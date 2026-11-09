import { AsyncLocalStorage } from 'async_hooks';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';
import type { SharedCanvasNativeLock, SharedCanvasNativeLockHandle } from './sharedCanvasNativeLock';

export type SharedCanvasLockScope = 'admission' | 'node' | 'commit';

export interface SharedCanvasLockResource {
  readonly canonicalSnapshotPath: string;
  readonly scope: SharedCanvasLockScope;
  readonly nodeId?: string;
}

export interface SharedCanvasLockOptions {
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
}

export interface SharedCanvasLockLease {
  readonly resourceKey: string;
  readonly operationId: string;
}

type FailureCode = 'invalid-resource' | 'reentrant-use' | 'lock-order' | 'queue-full' |
  'timeout' | 'cancelled' | 'native-failure' | 'release-failure';

export class SharedCanvasLockError extends Error {
  constructor(readonly code: FailureCode, readonly scope: SharedCanvasLockScope,
    readonly resourceDigest: string, readonly operationId: string, readonly waitedMs: number,
    readonly cause?: unknown) {
    super(`Shared Canvas ${scope} lock failed (${code}; resource=${resourceDigest}; operation=${operationId}).`);
    this.name = 'SharedCanvasLockError';
  }
}

export class SharedCanvasLockCleanupError extends Error {
  constructor(readonly cause: unknown, readonly releaseError: SharedCanvasLockError) {
    super('Shared Canvas work and lock cleanup both failed.');
    this.name = 'SharedCanvasLockCleanupError';
  }
}

interface Request {
  resource: SharedCanvasLockResource;
  key: string;
  operationId: string;
  startedAt: number;
  options: SharedCanvasLockOptions;
}

interface Owner { request: Request; active: boolean }
interface Waiter { grant(): void; cleanup(): void }
interface Queue { waiters: Waiter[] }

const ownership = new AsyncLocalStorage<readonly Owner[]>();
const ranks: Record<SharedCanvasLockScope, number> = { admission: 0, node: 1, commit: 2 };
const maximumRequests = 256;
const retryIntervalMs = 10;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function failure(request: Request, code: FailureCode, cause?: unknown): SharedCanvasLockError {
  return new SharedCanvasLockError(code, request.resource.scope, digest(request.key).slice(0, 16),
    request.operationId, Math.max(0, performance.now() - request.startedAt), cause);
}

function interrupted(request: Request): SharedCanvasLockError | undefined {
  if (request.options.signal?.aborted) return failure(request, 'cancelled', request.options.signal.reason);
  if (performance.now() >= request.options.deadlineMs) return failure(request, 'timeout');
  return undefined;
}

function check(request: Request): void {
  const error = interrupted(request);
  if (error) throw error;
}

function resourcePath(resource: SharedCanvasLockResource): string {
  const directory = path.join(path.dirname(resource.canonicalSnapshotPath), '.canvas-locks-v1');
  return resource.scope === 'node' ? path.join(directory, 'nodes', `${digest(resource.nodeId ?? '')}.lock`) :
    path.join(directory, `${resource.scope}.lock`);
}

async function prepareDirectory(request: Request): Promise<void> {
  const root = path.dirname(request.resource.canonicalSnapshotPath);
  if (await fs.realpath(root) !== root) throw failure(request, 'invalid-resource');
  const directories = [path.join(root, '.canvas-locks-v1')];
  if (request.resource.scope === 'node') directories.push(path.join(directories[0], 'nodes'));
  for (const directory of directories) {
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory ||
      (process.platform !== 'win32' && (stat.uid !== process.geteuid!() || (stat.mode & 0o022) !== 0))) {
      throw failure(request, 'invalid-resource');
    }
  }
}

async function retry(request: Request): Promise<void> {
  check(request);
  await new Promise<void>((resolve, reject) => {
    const signal = request.options.signal;
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(interrupted(request)); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); },
      Math.max(1, Math.min(retryIntervalMs, request.options.deadlineMs - performance.now())));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export class SharedCanvasLocks {
  private readonly queues = new Map<string, Queue>();
  private requestCount = 0;

  constructor(private readonly native: SharedCanvasNativeLock) {}

  async withLock<T>(resource: SharedCanvasLockResource, options: SharedCanvasLockOptions,
    work: (lease: SharedCanvasLockLease) => Promise<T>): Promise<T> {
    const request: Request = { resource: { ...resource }, options: { ...options }, key: resourcePath(resource),
      operationId: randomUUID(), startedAt: performance.now() };
    if (!path.isAbsolute(resource.canonicalSnapshotPath) || path.normalize(resource.canonicalSnapshotPath) !== resource.canonicalSnapshotPath ||
      !Object.prototype.hasOwnProperty.call(ranks, resource.scope) || !Number.isFinite(options.deadlineMs) ||
      (resource.scope === 'node' ? !resource.nodeId : resource.nodeId !== undefined)) {
      throw failure(request, 'invalid-resource');
    }
    const ancestors = (ownership.getStore() ?? []).filter(owner => owner.active);
    for (const owner of ancestors) {
      if (owner.request.key === request.key) throw failure(request, 'reentrant-use');
      const previousRank = ranks[owner.request.resource.scope];
      const rank = ranks[resource.scope];
      if (previousRank > rank || (previousRank === rank && (rank !== 0 ||
        Buffer.compare(Buffer.from(owner.request.key), Buffer.from(request.key)) >= 0))) {
        throw failure(request, 'lock-order');
      }
    }
    check(request);
    if (this.requestCount >= maximumRequests) throw failure(request, 'queue-full');
    this.requestCount++;
    let releaseQueue: (() => void) | undefined;
    let handle: SharedCanvasNativeLockHandle | undefined;
    let result: T | undefined;
    let failed = false;
    let error: unknown;
    let workStarted = false;
    let owner: Owner | undefined;
    try {
      releaseQueue = await this.enterQueue(request);
      check(request);
      await prepareDirectory(request);
      check(request);
      handle = await this.native.open(request.key);
      while (true) {
        check(request);
        const acquired = await this.native.tryAcquire(handle);
        check(request);
        if (acquired === 'acquired') break;
        if (acquired !== 'busy') throw new Error('Invalid shared Canvas native lock response.');
        await retry(request);
      }
      owner = { request, active: true };
      const lease = Object.freeze({ resourceKey: request.key, operationId: request.operationId });
      workStarted = true;
      result = await ownership.run([...ancestors, owner], () => work(lease));
    } catch (caught) {
      failed = true;
      error = workStarted || caught instanceof SharedCanvasLockError ? caught : failure(request, 'native-failure', caught);
    } finally {
      if (handle) {
        try { await this.native.close(handle); }
        catch (caught) {
          const releaseError = failure(request, 'release-failure', caught);
          error = failed ? new SharedCanvasLockCleanupError(error, releaseError) : releaseError;
          failed = true;
        }
      }
      if (owner) owner.active = false;
      releaseQueue?.();
      this.requestCount--;
    }
    if (failed) throw error;
    return result as T;
  }

  async withAdmissions<T>(canonicalSnapshotPaths: readonly string[], options: SharedCanvasLockOptions,
    work: (leases: ReadonlyMap<string, SharedCanvasLockLease>) => Promise<T>): Promise<T> {
    const acquisitionOptions = { ...options };
    const resources = new Map<string, SharedCanvasLockResource>();
    for (const canonicalSnapshotPath of canonicalSnapshotPaths) {
      const resource: SharedCanvasLockResource = { canonicalSnapshotPath, scope: 'admission' };
      resources.set(resourcePath(resource), resource);
    }
    const ordered = [...resources.entries()].sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    if (!ordered.length) {
      const request: Request = { resource: { canonicalSnapshotPath: '', scope: 'admission' },
        options: acquisitionOptions, key: 'empty-admissions', operationId: randomUUID(), startedAt: performance.now() };
      if (!Number.isFinite(acquisitionOptions.deadlineMs)) throw failure(request, 'invalid-resource');
      check(request);
      return work(new Map());
    }
    const leases = new Map<string, SharedCanvasLockLease>();
    const acquire = async (index: number): Promise<T> => {
      if (index === ordered.length) return work(new Map(leases));
      const [key, resource] = ordered[index];
      return this.withLock(resource, acquisitionOptions, async lease => {
        leases.set(key, lease);
        return acquire(index + 1);
      });
    };
    return acquire(0);
  }

  private async enterQueue(request: Request): Promise<() => void> {
    let queue = this.queues.get(request.key);
    if (queue) {
      const existing = queue;
      await new Promise<void>((resolve, reject) => {
        const signal = request.options.signal;
        const remove = (error: unknown) => {
          const index = existing.waiters.indexOf(waiter);
          if (index < 0) return;
          existing.waiters.splice(index, 1);
          waiter.cleanup();
          reject(error);
        };
        const abort = () => remove(failure(request, 'cancelled', signal?.reason));
        const timer = setTimeout(() => remove(failure(request, 'timeout')),
          Math.max(1, Math.min(2147483647, request.options.deadlineMs - performance.now())));
        const waiter: Waiter = { grant: resolve, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
        existing.waiters.push(waiter);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    } else {
      queue = { waiters: [] };
      this.queues.set(request.key, queue);
    }
    const current = queue;
    return () => {
      const next = current.waiters.shift();
      if (next) { next.cleanup(); next.grant(); }
      else this.queues.delete(request.key);
    };
  }
}
