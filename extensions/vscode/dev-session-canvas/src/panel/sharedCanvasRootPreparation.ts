import { AsyncLocalStorage } from 'async_hooks';
import * as path from 'path';

export type SharedCanvasRootPhase = 'unprepared' | 'preparing' | 'ready' | 'failed';

export interface SharedCanvasRootTicket {
  readonly root: string;
  readonly generation: number;
  readonly opaque: unique symbol;
}

export interface SharedCanvasPreparedRoot<Value> {
  readonly value: Value;
  release(): Promise<void>;
}

export interface SharedCanvasRootContext {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

type FailureCode = 'invalid-root' | 'unknown-ticket' | 'unprepared' | 'retired' | 'closed' | 'self-drain' | 'self-prepare';

export class SharedCanvasRootPreparationError extends Error {
  constructor(readonly code: FailureCode) {
    super(`Shared Canvas root preparation failed (${code}).`);
    this.name = 'SharedCanvasRootPreparationError';
  }
}

export class SharedCanvasRootReleaseError extends Error {
  constructor(readonly errors: readonly unknown[]) {
    super('Shared Canvas root release was not confirmed.');
    this.name = 'SharedCanvasRootReleaseError';
  }
}

interface Entry<Value> {
  ticket: SharedCanvasRootTicket;
  phase: SharedCanvasRootPhase;
  controller: AbortController;
  preparation?: Promise<void>;
  resource?: SharedCanvasPreparedRoot<Value>;
  failure?: unknown;
  retired: boolean;
  active: number;
  idle?: () => void;
  retirement?: Promise<void>;
}

interface Operation<Value> { entry: Entry<Value>; active: boolean; preparing?: boolean }

export class SharedCanvasRootPreparations<Value> {
  private readonly roots = new Map<string, Entry<Value>>();
  private readonly tickets = new WeakMap<SharedCanvasRootTicket, Entry<Value>>();
  private readonly operations = new AsyncLocalStorage<readonly Operation<Value>[]>();
  private nextGeneration = 0;
  private closed = false;
  private closing?: Promise<void>;

  register(root: string): SharedCanvasRootTicket {
    if (this.closed) throw new SharedCanvasRootPreparationError('closed');
    if (!path.isAbsolute(root) || path.normalize(root) !== root) {
      throw new SharedCanvasRootPreparationError('invalid-root');
    }
    const existing = this.roots.get(root);
    if (existing) {
      if (existing.retired) throw new SharedCanvasRootPreparationError('retired');
      return existing.ticket;
    }
    const ticket = Object.freeze({ root, generation: ++this.nextGeneration }) as SharedCanvasRootTicket;
    const entry: Entry<Value> = { ticket, phase: 'unprepared', controller: new AbortController(), retired: false, active: 0 };
    this.roots.set(root, entry);
    this.tickets.set(ticket, entry);
    return ticket;
  }

  phase(ticket: SharedCanvasRootTicket): SharedCanvasRootPhase {
    return this.entry(ticket).phase;
  }

  isReady(ticket: SharedCanvasRootTicket): boolean {
    const entry = this.tickets.get(ticket);
    return Boolean(entry && this.current(entry) && entry.phase === 'ready');
  }

  prepare(ticket: SharedCanvasRootTicket,
    factory: (context: SharedCanvasRootContext) => Promise<SharedCanvasPreparedRoot<Value>>): Promise<void> {
    const entry = this.entry(ticket);
    this.assertCurrent(entry);
    this.assertNoSelfPreparation(entry);
    if (entry.preparation) return entry.preparation;
    entry.phase = 'preparing';
    entry.preparation = Promise.resolve().then(async () => {
      const operation = { entry, active: true, preparing: true };
      try {
        this.assertCurrent(entry);
        entry.resource = await this.operations.run([...(this.operations.getStore() ?? []), operation],
          () => factory(this.context(entry)));
        this.assertCurrent(entry);
        entry.phase = 'ready';
      } catch (error) {
        entry.phase = 'failed';
        entry.failure = error;
        entry.controller.abort(error);
        throw error;
      } finally {
        operation.active = false;
      }
    });
    void entry.preparation.catch(() => undefined);
    return entry.preparation;
  }

  async withReady<Result>(ticket: SharedCanvasRootTicket,
    work: (value: Value, context: SharedCanvasRootContext) => Promise<Result>): Promise<Result> {
    const entry = this.entry(ticket);
    this.assertCurrent(entry);
    this.assertNoSelfPreparation(entry);
    if (!entry.preparation) throw new SharedCanvasRootPreparationError('unprepared');
    await entry.preparation;
    this.assertCurrent(entry);
    if (entry.phase !== 'ready' || !entry.resource) throw entry.failure;
    entry.active++;
    const operation = { entry, active: true };
    try {
      return await this.operations.run([...(this.operations.getStore() ?? []), operation],
        () => work(entry.resource!.value, this.context(entry)));
    } finally {
      operation.active = false;
      entry.active--;
      if (entry.active === 0) {
        const idle = entry.idle;
        entry.idle = undefined;
        idle?.();
      }
    }
  }

  retire(ticket: SharedCanvasRootTicket): Promise<void> {
    const entry = this.entry(ticket);
    this.assertNoSelfDrain(entry);
    if (entry.retirement) return entry.retirement;
    entry.retired = true;
    entry.phase = 'failed';
    entry.failure = new SharedCanvasRootPreparationError('retired');
    entry.retirement = Promise.resolve().then(async () => {
      await entry.preparation?.catch(() => undefined);
      if (entry.active > 0) await new Promise<void>(resolve => { entry.idle = resolve; });
      if (entry.resource) {
        const operation = { entry, active: true };
        try {
          await this.operations.run([...(this.operations.getStore() ?? []), operation], () => entry.resource!.release());
          entry.resource = undefined;
        } finally {
          operation.active = false;
        }
      }
      this.roots.delete(entry.ticket.root);
    });
    void entry.retirement.catch(() => undefined);
    entry.controller.abort(entry.failure);
    return entry.retirement;
  }

  close(): Promise<void> {
    for (const entry of this.roots.values()) this.assertNoSelfDrain(entry);
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.resolve().then(async () => {
      const settled = await Promise.allSettled([...this.roots.values()].map(entry => this.retire(entry.ticket)));
      const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new SharedCanvasRootReleaseError(errors);
    });
    void this.closing.catch(() => undefined);
    for (const entry of this.roots.values()) this.retire(entry.ticket);
    return this.closing;
  }

  private entry(ticket: SharedCanvasRootTicket): Entry<Value> {
    const entry = this.tickets.get(ticket);
    if (!entry) throw new SharedCanvasRootPreparationError('unknown-ticket');
    return entry;
  }

  private current(entry: Entry<Value>): boolean {
    return !this.closed && !entry.retired && this.roots.get(entry.ticket.root) === entry;
  }

  private assertCurrent(entry: Entry<Value>): void {
    if (!this.current(entry)) throw new SharedCanvasRootPreparationError('retired');
  }

  private assertNoSelfDrain(entry: Entry<Value>): void {
    if (this.operations.getStore()?.some(operation => operation.active && operation.entry === entry)) {
      throw new SharedCanvasRootPreparationError('self-drain');
    }
  }

  private assertNoSelfPreparation(entry: Entry<Value>): void {
    if (this.operations.getStore()?.some(operation => operation.active && operation.preparing && operation.entry === entry)) {
      throw new SharedCanvasRootPreparationError('self-prepare');
    }
  }

  private context(entry: Entry<Value>): SharedCanvasRootContext {
    return Object.freeze({ signal: entry.controller.signal,
      isCurrent: () => this.current(entry) && entry.phase !== 'failed' });
  }
}
