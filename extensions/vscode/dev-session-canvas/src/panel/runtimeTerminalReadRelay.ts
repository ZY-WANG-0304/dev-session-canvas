import type {
  RuntimeSupervisorReadTerminalPageParams,
  RuntimeSupervisorCloseTerminalReadParams,
  RuntimeSupervisorCloseTerminalReadResult,
  RuntimeSupervisorTerminalReadOutcome
} from '../common/runtimeSupervisorProtocol';
import {
  normalizeTerminalStreamPage,
  normalizeTerminalStreamRead,
  takeTerminalStreamPage,
  type TerminalStreamPage,
  type TerminalStreamReadDescriptor
} from '../common/terminalStreamPaging';
import type { TerminalStreamAttachPayload } from '../common/terminalSessionStream';
import type { RuntimeSupervisorClient } from './runtimeSupervisorClient';

interface ReadBinding {
  client: RuntimeSupervisorClient;
  sessionId: string;
  authorityId: string;
  opening?: Promise<TerminalStreamReadDescriptor>;
  onReleased?: (result: RuntimeSupervisorCloseTerminalReadResult) => void;
  settlementMode?: 'final-application-v1';
  releasing?: Promise<RuntimeSupervisorCloseTerminalReadResult>;
  descriptor?: TerminalStreamReadDescriptor;
  pending: boolean;
  appliedRevision: number;
  sentRevision: number;
  acknowledged: boolean;
  completed?: TerminalStreamAttachPayload;
  remoteCompletion?: { sessionId: string; authorityId: string; revision: number; finalRevision?: number };
}

/** Keeps identities and one in-flight page, never a copy of the live journal. */
export class RuntimeTerminalReadRelay {
  private readonly reads = new Map<string, ReadBinding>();
  private readonly releasing = new Set<ReadBinding>();

  public async open(
    key: string,
    client: RuntimeSupervisorClient,
    sessionId: string,
    authorityId: string,
    consumerId: 'editor' | 'panel',
    onReleased?: (result: RuntimeSupervisorCloseTerminalReadResult) => void,
    settlementMode?: 'final-application-v1'
  ): Promise<TerminalStreamReadDescriptor | undefined> {
    const existing = this.reads.get(key)?.descriptor;
    if (existing?.sessionId === sessionId && existing.authorityId === authorityId && existing.settlementMode === settlementMode) {
      return existing;
    }
    this.close(key, undefined, 'reader-replaced');
    const binding: ReadBinding = { client, sessionId, authorityId, onReleased, settlementMode,
      pending: false, appliedRevision: 0, sentRevision: 0, acknowledged: false };
    this.reads.set(key, binding);
    try {
      binding.opening = client.openTerminalRead({ sessionId, authorityId, consumerId,
        ...(settlementMode ? { settlementMode } : {}) }).then(value => {
        const descriptor = normalizeTerminalStreamRead(value);
        if (!descriptor || descriptor.sessionId !== sessionId || descriptor.authorityId !== authorityId) {
          throw new Error('Invalid terminal read descriptor.');
        }
        binding.descriptor = descriptor;
        if (descriptor.settlementMode !== settlementMode) throw new Error('Terminal reader settlement was not negotiated.');
        return descriptor;
      });
      const descriptor = await binding.opening;
      if (this.reads.get(key) !== binding) {
        await this.release(binding, { kind: 'cancelled', reason: 'open-no-longer-current' });
        return undefined;
      }
      binding.appliedRevision = descriptor.checkpoint.revision;
      binding.sentRevision = descriptor.checkpoint.revision;
      return descriptor;
    } catch (error) {
      if (this.reads.get(key) === binding) {
        this.reads.delete(key);
      }
      void this.release(binding, { kind: 'cancelled', reason: 'open-failed' });
      throw error;
    }
  }

  public has(key: string, sessionId: string): boolean {
    const read = this.reads.get(key);
    return read?.descriptor?.sessionId === sessionId && read.acknowledged;
  }

  public complete(key: string, stream: TerminalStreamAttachPayload): void {
    const binding = this.reads.get(key);
    if (binding?.descriptor?.sessionId !== stream.sessionId ||
        binding.descriptor.authorityId !== stream.authorityId) {
      return;
    }
    if (!binding.acknowledged) {
      this.close(key);
      return;
    }
    if (stream.checkpoint.revision > binding.appliedRevision || stream.revision < binding.sentRevision) {
      throw new Error('Completed terminal stream does not cover its reader.');
    }
    // Shared only by already established readers; never used to open a new projection.
    binding.completed = stream;
  }

  public getCompleted(key: string): {
    sessionId: string; authorityId: string; revision: number; finalRevision?: number
  } | undefined {
    const binding = this.reads.get(key);
    const stream = binding?.remoteCompletion ?? binding?.completed;
    return stream && { sessionId: stream.sessionId, authorityId: stream.authorityId, revision: stream.revision,
      ...(binding?.settlementMode && binding.remoteCompletion?.finalRevision !== undefined
        ? { finalRevision: binding.remoteCompletion.finalRevision } : {}) };
  }

  public async completeRemote(key: string, head: {
    sessionId: string; authorityId: string; revision: number; finalRevision?: number
  }): Promise<void> {
    const binding = this.reads.get(key);
    if (!binding || binding.sessionId !== head.sessionId || binding.authorityId !== head.authorityId) {
      return;
    }
    if (!Number.isSafeInteger(head.revision) || head.revision < binding.sentRevision) {
      throw new Error('Completed terminal revision does not cover its reader.');
    }
    if (binding.settlementMode && (!Number.isSafeInteger(head.finalRevision) || head.finalRevision !== head.revision)) {
      this.close(key, undefined, 'terminal-final-state-unconfirmed');
      return;
    }
    if (binding.remoteCompletion && binding.remoteCompletion.revision !== head.revision) {
      throw new Error('Completed terminal revision cannot change.');
    }
    // Preserve even an in-flight open, but never create a reader for a completed session.
    binding.remoteCompletion = { ...head };
    await binding.opening?.catch(() => undefined);
    if (binding.descriptor && head.revision < Math.max(binding.descriptor.checkpoint.revision, binding.sentRevision)) {
      binding.remoteCompletion = undefined;
      throw new Error('Completed terminal revision does not cover its opened reader.');
    }
  }

  public getUnacknowledgedCompletedRead(key: string): TerminalStreamReadDescriptor | undefined {
    const binding = this.reads.get(key);
    return binding?.remoteCompletion && !binding.acknowledged && binding.descriptor
      ? { ...binding.descriptor, headRevision: binding.remoteCompletion.revision }
      : undefined;
  }

  public usesClient(client: RuntimeSupervisorClient): boolean {
    return [...this.reads.values(), ...this.releasing].some((binding) => binding.client === client);
  }

  public async read(
    key: string,
    params: RuntimeSupervisorReadTerminalPageParams
  ): Promise<TerminalStreamPage | undefined> {
    const binding = this.reads.get(key);
    if (!binding?.descriptor || binding.descriptor.readId !== params.readId ||
        binding.descriptor.sessionId !== params.sessionId || binding.descriptor.authorityId !== params.authorityId ||
        binding.pending || (params.afterRevision !== binding.appliedRevision && params.afterRevision !== binding.sentRevision)) {
      throw new Error('Invalid or concurrent terminal page request.');
    }
    // The first page request proves the Webview received and applied the checkpoint.
    binding.acknowledged = true;
    const readCompleted = (): TerminalStreamPage | undefined => {
      const stream = binding.completed;
      if (!stream || stream.sessionId !== params.sessionId || stream.authorityId !== params.authorityId ||
          params.afterRevision < stream.checkpoint.revision || params.afterRevision > stream.revision) {
        return undefined;
      }
      const events = takeTerminalStreamPage(stream.events, params.afterRevision - stream.checkpoint.revision);
      return { ...params, revision: events[events.length - 1]?.revision ?? params.afterRevision,
        headRevision: stream.revision, events };
    };
    binding.pending = true;
    try {
      let result = readCompleted();
      if (!result) {
        try {
          result = await binding.client.readTerminalPage(params);
        } catch (error) {
          result = readCompleted();
          if (!result) {
            throw error;
          }
        }
      }
      if (this.reads.get(key) !== binding) {
        return undefined;
      }
      const page = normalizeTerminalStreamPage(result);
      if (!page || page.sessionId !== params.sessionId || page.authorityId !== params.authorityId ||
          page.readId !== params.readId || page.afterRevision !== params.afterRevision) {
        throw new Error('Invalid terminal page response.');
      }
      binding.appliedRevision = params.afterRevision;
      binding.sentRevision = page.revision;
      return page;
    } finally {
      binding.pending = false;
    }
  }

  public async settle(key: string, params: RuntimeSupervisorCloseTerminalReadParams): Promise<RuntimeSupervisorCloseTerminalReadResult> {
    const binding = this.reads.get(key);
    const read = binding?.descriptor;
    if (!binding || !read || read.readId !== params.readId || read.sessionId !== params.sessionId ||
        read.authorityId !== params.authorityId) return { ok: true, settlement: 'unconfirmed' };
    if (params.outcome) {
      if (!binding.settlementMode || !read.settlementMode) throw new Error('Terminal reader settlement was not negotiated.');
      if (params.outcome.kind === 'applied' && (binding.pending ||
          binding.remoteCompletion?.finalRevision !== params.outcome.finalRevision ||
          binding.sentRevision < params.outcome.finalRevision)) {
        throw new Error('Terminal reader final revision is not fixed or has not been sent.');
      }
    }
    this.reads.delete(key);
    return this.release(binding, params.outcome, true);
  }

  public close(key: string, readId?: string, reason = 'reader-closed'): void {
    const binding = this.reads.get(key);
    if (binding && (!readId || binding.descriptor?.readId === readId)) {
      this.reads.delete(key);
      void this.release(binding, { kind: 'cancelled', reason });
    }
  }

  public closeMatching(predicate: (key: string) => boolean): void {
    for (const key of this.reads.keys()) {
      if (predicate(key)) {
        this.close(key);
      }
    }
  }

  private release(
    binding: ReadBinding, outcome?: RuntimeSupervisorTerminalReadOutcome, explicit = false
  ): Promise<RuntimeSupervisorCloseTerminalReadResult> {
    if (binding.releasing) return binding.releasing;
    this.releasing.add(binding);
    let finish!: (result: RuntimeSupervisorCloseTerminalReadResult) => void;
    binding.releasing = new Promise(resolve => { finish = resolve; });
    // Keep the client until a cancelled in-flight open has yielded its original descriptor.
    const send = async (): Promise<RuntimeSupervisorCloseTerminalReadResult> => {
      if (!binding.descriptor) await binding.opening?.catch(() => undefined);
      const descriptor = binding.descriptor;
      if (!descriptor) return { ok: true, settlement: 'unconfirmed' } as const;
      const result = await binding.client.closeTerminalRead({ sessionId: descriptor.sessionId,
        authorityId: descriptor.authorityId, readId: descriptor.readId,
        ...(descriptor.settlementMode && outcome ? { outcome } : {}) });
      if ((explicit && outcome) || descriptor.settlementMode) {
        return result?.settlement === 'recorded' || result?.settlement === 'duplicate'
          ? result : { ok: true, settlement: 'unconfirmed' } as const;
      }
      return result ?? { ok: true } as const;
    };
    void send().catch(() => ({ ok: true, settlement: 'unconfirmed' } as const)).then(result => {
      this.releasing.delete(binding);
      try { binding.onReleased?.(result); }
      catch (error) { console.error('Failed to release terminal reader reference:', error); }
      finish(result);
    });
    return binding.releasing;
  }
}
