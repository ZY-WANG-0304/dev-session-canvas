import type { RuntimeSupervisorReadTerminalPageParams } from '../common/runtimeSupervisorProtocol';
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
  onReleased?: () => void;
  descriptor?: TerminalStreamReadDescriptor;
  pending: boolean;
  appliedRevision: number;
  sentRevision: number;
  acknowledged: boolean;
  completed?: TerminalStreamAttachPayload;
  remoteCompletion?: { sessionId: string; authorityId: string; revision: number };
}

/** Keeps identities and one in-flight page, never a copy of the live journal. */
export class RuntimeTerminalReadRelay {
  private readonly reads = new Map<string, ReadBinding>();

  public async open(
    key: string,
    client: RuntimeSupervisorClient,
    sessionId: string,
    authorityId: string,
    consumerId: 'editor' | 'panel',
    onReleased?: () => void
  ): Promise<TerminalStreamReadDescriptor | undefined> {
    const existing = this.reads.get(key)?.descriptor;
    if (existing?.sessionId === sessionId && existing.authorityId === authorityId) {
      return existing;
    }
    this.close(key);
    const binding: ReadBinding = { client, sessionId, authorityId, onReleased,
      pending: false, appliedRevision: 0, sentRevision: 0, acknowledged: false };
    this.reads.set(key, binding);
    try {
      binding.opening = client.openTerminalRead({ sessionId, authorityId, consumerId });
      const descriptor = normalizeTerminalStreamRead(await binding.opening);
      if (!descriptor || descriptor.sessionId !== sessionId || descriptor.authorityId !== authorityId) {
        throw new Error('Invalid terminal read descriptor.');
      }
      binding.descriptor = descriptor;
      if (this.reads.get(key) !== binding) {
        this.release(binding);
        return undefined;
      }
      binding.appliedRevision = descriptor.checkpoint.revision;
      binding.sentRevision = descriptor.checkpoint.revision;
      return descriptor;
    } catch (error) {
      if (this.reads.get(key) === binding) {
        this.reads.delete(key);
      }
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

  public getCompleted(key: string): Pick<TerminalStreamAttachPayload, 'sessionId' | 'authorityId' | 'revision'> | undefined {
    const binding = this.reads.get(key);
    const stream = binding?.remoteCompletion ?? binding?.completed;
    return stream && { sessionId: stream.sessionId, authorityId: stream.authorityId, revision: stream.revision };
  }

  public async completeRemote(key: string, head: { sessionId: string; authorityId: string; revision: number }): Promise<void> {
    const binding = this.reads.get(key);
    if (!binding || binding.sessionId !== head.sessionId || binding.authorityId !== head.authorityId) {
      return;
    }
    if (!Number.isSafeInteger(head.revision) || head.revision < binding.sentRevision) {
      throw new Error('Completed terminal revision does not cover its reader.');
    }
    // Preserve even an in-flight open, but never create a reader for a completed session.
    binding.remoteCompletion = head;
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
    return [...this.reads.values()].some((binding) => binding.client === client);
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

  public close(key: string, readId?: string): void {
    const binding = this.reads.get(key);
    if (binding && (!readId || binding.descriptor?.readId === readId)) {
      this.reads.delete(key);
      this.release(binding);
    }
  }

  public closeMatching(predicate: (key: string) => boolean): void {
    for (const key of this.reads.keys()) {
      if (predicate(key)) {
        this.close(key);
      }
    }
  }

  private release(binding: ReadBinding): void {
    if (binding.descriptor) {
      void binding.client.closeTerminalRead(binding.descriptor).catch(() => undefined).finally(binding.onReleased);
    }
  }
}
