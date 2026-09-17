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
  descriptor?: TerminalStreamReadDescriptor;
  pending: boolean;
  appliedRevision: number;
  sentRevision: number;
  acknowledged: boolean;
}

/** Keeps identities and one in-flight page, never a copy of the live journal. */
export class RuntimeTerminalReadRelay {
  private readonly reads = new Map<string, ReadBinding>();

  public async open(
    key: string,
    client: RuntimeSupervisorClient,
    sessionId: string,
    authorityId: string,
    consumerId: 'editor' | 'panel'
  ): Promise<TerminalStreamReadDescriptor | undefined> {
    const existing = this.reads.get(key)?.descriptor;
    if (existing?.sessionId === sessionId && existing.authorityId === authorityId) {
      return existing;
    }
    this.close(key);
    const binding: ReadBinding = { client, pending: false, appliedRevision: 0, sentRevision: 0, acknowledged: false };
    this.reads.set(key, binding);
    try {
      const descriptor = normalizeTerminalStreamRead(await client.openTerminalRead({ sessionId, authorityId, consumerId }));
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

  public async read(
    key: string,
    params: RuntimeSupervisorReadTerminalPageParams,
    completed: () => TerminalStreamAttachPayload | undefined
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
      const stream = completed();
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
      void binding.client.closeTerminalRead(binding.descriptor).catch(() => undefined);
    }
  }
}
