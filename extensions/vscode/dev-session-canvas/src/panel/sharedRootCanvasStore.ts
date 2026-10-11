import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { CanvasPrototypeState } from '../common/protocol';
import { SharedRootCanvasParticipants } from './sharedRootCanvasParticipants';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const collections = new Set(['nodes', 'groups', 'edges', 'fileReferences', 'owners']);
const localExecutionFields = ['pendingLaunch', 'recentOutput', 'serializedTerminalState', 'terminalStream',
  'outputSequence', 'terminalTitle', 'lastRuntimeError'];

export function sharedCanvasState(state: CanvasPrototypeState): CanvasPrototypeState {
  const result = JSON.parse(JSON.stringify(state)) as CanvasPrototypeState;
  for (const node of result.nodes) {
    if (node.kind !== 'agent' && node.kind !== 'terminal') continue;
    const metadata = node.metadata?.[node.kind];
    if (metadata) for (const field of localExecutionFields) delete (metadata as unknown as Record<string, unknown>)[field];
    // Output summaries belong to each Host's independently consumed terminal projection.
    node.summary = '';
  }
  return result;
}

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const object = (value: Json | undefined): value is { [key: string]: Json } =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function merge(base: Json | undefined, next: Json | undefined, current: Json | undefined, key = ''): Json | undefined {
  if (equal(base, next)) return current;
  if (next === undefined) return undefined;
  if (collections.has(key) && Array.isArray(base) && Array.isArray(next) && Array.isArray(current)) {
    const index = (items: Json[]) => new Map(items.map(item => [(item as { id?: string; nodeId?: string }).id ??
      (item as { nodeId: string }).nodeId, item]));
    const before = index(base), after = index(next), latest = index(current);
    for (const [id, old] of before) {
      if (!after.has(id)) latest.delete(id);
      else if (latest.has(id)) latest.set(id, merge(old, after.get(id), latest.get(id))!);
      // An edit against an object deleted by another window cannot recreate it.
    }
    for (const [id, value] of after) if (!before.has(id)) {
      if (!latest.has(id)) latest.set(id, value);
      else if (!equal(latest.get(id), value)) throw new Error(`Conflicting shared Canvas object identity: ${id}`);
    }
    return [...latest.values()];
  }
  if (key.startsWith('suppressed') && Array.isArray(base) && Array.isArray(next) && Array.isArray(current)) {
    const result = new Set(current);
    for (const value of base) if (!next.includes(value)) result.delete(value);
    for (const value of next) if (!base.includes(value)) result.add(value);
    return [...result];
  }
  if (key === 'nextGroupSequence' && typeof current === 'number' && typeof next === 'number') {
    return Math.max(current, next);
  }
  if (key === 'position' || key === 'size') return next;
  if (object(base) && object(next) && object(current)) {
    const result = { ...current };
    for (const name of new Set([...Object.keys(base), ...Object.keys(next)])) {
      const value = merge(base[name], next[name], current[name], name);
      if (value === undefined) delete result[name]; else result[name] = value;
    }
    return result;
  }
  return next;
}

export function mergeSharedCanvasState(base: CanvasPrototypeState, next: CanvasPrototypeState,
  current: CanvasPrototypeState): CanvasPrototypeState {
  const result = merge(base as unknown as Json, next as unknown as Json, current as unknown as Json) as unknown as CanvasPrototypeState;
  const ids = new Set(result.nodes.map(node => node.id));
  const groups = new Set(result.groups.map(group => group.id));
  result.edges = result.edges.filter(edge => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId));
  result.nodes = result.nodes.map(node => node.groupId && !groups.has(node.groupId) ? { ...node, groupId: undefined } : node);
  return result;
}

interface Snapshot { version: 1; state: CanvasPrototypeState; sharedRevision?: string; [key: string]: unknown }
interface Pending { base: CanvasPrototypeState; next: CanvasPrototypeState }

/** A root's disk state is committed under a short, OS-owned cross-process lease. */
export class SharedRootCanvasStore {
  private local: CanvasPrototypeState;
  private confirmed: CanvasPrototypeState;
  private readonly pending: Pending[] = [];
  private tail: Promise<void> = Promise.resolve();
  private failure?: Error;
  private revision?: string;
  private closed = false;
  private readonly filename: string;
  private readonly changed: () => void;
  private readonly participants: SharedRootCanvasParticipants;

  constructor(filename: string, initial: CanvasPrototypeState,
    private readonly onState: (state: CanvasPrototypeState) => void,
    private readonly onError: (error: Error) => void) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.filename = path.join(fs.realpathSync(path.dirname(filename)), path.basename(filename));
    const snapshot = this.read();
    this.confirmed = sharedCanvasState(snapshot?.state ?? initial);
    this.local = sharedCanvasState(initial);
    this.revision = snapshot?.sharedRevision;
    this.participants = new SharedRootCanvasParticipants(this.filename);
    this.tail = this.participants.ready.catch(error => { this.failure = error; this.onError(error); });
    this.changed = () => {
      if (this.closed) return;
      try { this.observe(this.read()); }
      catch (error) { this.onError(error as Error); }
    };
    fs.watchFile(this.filename, { interval: 100, persistent: false }, this.changed);
    // Loading the page and opening its subscription are separate reads; a peer may commit between them.
    queueMicrotask(() => {
      if (this.closed) return;
      try { this.observe(snapshot, true); }
      catch (error) { this.onError(error as Error); }
    });
  }

  publish(state: CanvasPrototypeState): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Shared Canvas subscription is closed.'));
    if (this.failure) return Promise.reject(this.failure);
    const next = sharedCanvasState(state);
    const base = this.local;
    this.local = next;
    if (this.revision && equal({ ...base, updatedAt: '' }, { ...next, updatedAt: '' })) return this.flush();
    const item = { base, next };
    this.pending.push(item);
    const operation = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      const lease = await this.acquireLease();
      try {
        const snapshot = this.read();
        const current = sharedCanvasState(snapshot?.state ?? this.confirmed);
        const unseenRemoteChange = !equal({ ...current, updatedAt: '' }, { ...this.confirmed, updatedAt: '' });
        const merged = mergeSharedCanvasState(item.base, item.next, current);
        merged.updatedAt = new Date().toISOString();
        const revision = randomUUID();
        const committed: Snapshot = { ...snapshot, version: 1, runtimePersistenceEnabled: true,
          state: merged, sharedRevision: revision, writtenAt: merged.updatedAt };
        const temporary = `${this.filename}.${randomUUID()}.tmp`;
        try {
          fs.writeFileSync(temporary, JSON.stringify(committed), { mode: 0o600, flag: 'wx' });
          fs.renameSync(temporary, this.filename);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        this.pending.splice(this.pending.indexOf(item), 1);
        this.observe(committed, true, unseenRemoteChange);
      } finally { await new Promise<void>((resolve, reject) => lease.close(error => error ? reject(error) : resolve())); }
    });
    this.tail = operation.catch(error => { this.failure = error; this.onError(error); });
    return operation;
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }

  async mutate<T>(nodeId: string, work: (current: CanvasPrototypeState) => Promise<T>): Promise<T> {
    await this.flush();
    if (this.closed) throw new Error('Shared Canvas subscription is closed.');
    return this.participants.withAdmission(async () => {
      const lease = await this.acquireLease(nodeId);
      try {
        const snapshot = this.read();
        if (!snapshot) throw new Error('The shared Canvas disappeared before the execution mutation.');
        this.observe(snapshot);
        try { return await work(snapshot.state); }
        finally { await this.flush(); }
      } finally { await new Promise<void>((resolve, reject) => lease.close(error => error ? reject(error) : resolve())); }
    });
  }

  get admissionPort(): number { return this.participants.admissionPort; }

  async depart<T>(work: (last: boolean, current: CanvasPrototypeState) => Promise<T>, held?: Set<number>): Promise<T> {
    await this.flush();
    return this.participants.depart(async last => {
      const snapshot = this.read();
      this.observe(snapshot);
      return work(last, snapshot?.state ?? this.confirmed);
    }, held);
  }

  dispose(): void {
    this.closed = true;
    fs.unwatchFile(this.filename, this.changed);
    this.participants.dispose();
  }

  private read(): Snapshot | undefined {
    if (!fs.existsSync(this.filename)) return undefined;
    const snapshot = JSON.parse(fs.readFileSync(this.filename, 'utf8')) as Snapshot;
    if (snapshot.version !== 1 || snapshot.state?.version !== 1 ||
        !['nodes', 'edges', 'groups', 'fileReferences'].every(key => Array.isArray((snapshot.state as unknown as Record<string, unknown>)[key]))) {
      throw new Error('Invalid shared Canvas snapshot; refusing to overwrite it.');
    }
    return snapshot;
  }

  private observe(snapshot: Snapshot | undefined, force = false, notify = true): void {
    if (!snapshot || (!force && snapshot.sharedRevision === this.revision)) return;
    this.revision = snapshot.sharedRevision;
    this.confirmed = sharedCanvasState(snapshot.state);
    let projected = this.confirmed;
    for (const item of this.pending) projected = mergeSharedCanvasState(item.base, item.next, projected);
    const changed = !equal({ ...this.local, updatedAt: '' }, { ...projected, updatedAt: '' });
    this.local = projected;
    if (!this.closed && changed && notify) this.onState(projected);
  }

  private async acquireLease(nodeId?: string): Promise<net.Server> {
    // A collision serializes unrelated roots conservatively; no data travels through this listener.
    const identity = process.platform === 'win32' ? this.filename.toLowerCase() : this.filename;
    // Separate ranges prevent a node operation's lease from colliding with a nested root commit.
    const port = (nodeId === undefined ? 20000 : 40000) +
      createHash('sha256').update(nodeId === undefined ? identity : `${identity}\0${nodeId}`).digest().readUInt32BE(0) % 20000;
    const deadline = Date.now() + 5000;
    for (;;) {
      const lease = net.createServer(socket => socket.destroy());
      try {
        await new Promise<void>((resolve, reject) => {
          lease.once('error', reject);
          lease.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
            lease.removeListener('error', reject);
            resolve();
          });
        });
        return lease;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || Date.now() >= deadline) {
          throw new Error(`Could not acquire shared Canvas commit lease: ${(error as Error).message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
}
