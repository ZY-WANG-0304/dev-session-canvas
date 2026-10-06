import {
  normalizeTerminalStreamPage,
  normalizeTerminalStreamRead,
  type TerminalStreamPage,
  type TerminalStreamReadDescriptor
} from '../common/terminalStreamPaging';
import type { TerminalStreamEvent } from '../common/terminalSessionStream';
import type { RuntimeSupervisorTerminalReadOutcome } from '../common/runtimeSupervisorProtocol';

export interface TerminalPagedProjectionCallbacks {
  request: (read: TerminalStreamReadDescriptor, afterRevision: number, requestId: string, stateOffset?: number) => void;
  close: (read: TerminalStreamReadDescriptor, outcome?: RuntimeSupervisorTerminalReadOutcome) => void;
  checkpoint: (read: TerminalStreamReadDescriptor, current: () => boolean, done: (applied?: boolean) => void) => void;
  currentStateProgress?: (read: TerminalStreamReadDescriptor, offset: number, chunkCount: number,
    assemblyPeakCharacters: number) => void;
  currentState?: (read: TerminalStreamReadDescriptor, state: unknown,
    current: () => boolean, done: (applied?: boolean) => void) => void;
  events: (events: TerminalStreamEvent[], revision: number, current: () => boolean,
    done: (applied?: boolean) => void) => void;
  exit: (message: string) => void;
  error?: (message: string) => void;
}

export class TerminalPagedProjection {
  private read: TerminalStreamReadDescriptor | undefined;
  private revision = 0;
  private headRevision = 0;
  private busy = false;
  private requestId: string | undefined;
  private requestSequence = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private completed = false;
  private finalRevision: number | undefined;
  private closed = false;
  private exitMessage: string | undefined;
  private stateChunks: string[] | undefined;
  private stateOffset = 0;
  private stateChunkCount = 0;
  private stateImportPendingConfirmation = false;

  public constructor(private readonly callbacks: TerminalPagedProjectionCallbacks) {}

  public get active(): boolean { return this.read !== undefined; }

  public start(value: unknown): boolean {
    const read = normalizeTerminalStreamRead(value);
    if (!read) {
      return false;
    }
    if (this.read?.readId === read.readId) {
      this.available(read.sessionId, read.authorityId, read.headRevision);
      return true;
    }
    this.stop('reader-replaced');
    this.read = read;
    this.revision = read.checkpoint.revision;
    this.headRevision = read.headRevision;
    if (read.currentState) {
      if (!this.callbacks.currentState) {
        this.stop('current-state-import-unavailable');
        return false;
      }
      this.stateChunks = [];
      this.stateChunkCount = 0;
      this.pull(true);
      return true;
    }
    this.busy = true;
    this.callbacks.checkpoint(read, () => this.read === read, (applied = true) => {
      if (this.read !== read) {
        return;
      }
      if (!applied) {
        if (read.settlementMode) this.stop('checkpoint-write-failed-or-cancelled');
        return;
      }
      this.busy = false;
      this.finishExit();
      // Also confirm an empty checkpoint and discover output after the open cut.
      this.pull(true);
    });
    return true;
  }

  public available(sessionId: string, authorityId: string, revision: number, completed = false, finalRevision?: number): void {
    if (this.read?.sessionId !== sessionId || this.read.authorityId !== authorityId ||
        !Number.isSafeInteger(revision) || revision < 0) {
      return;
    }
    if (this.read.settlementMode && finalRevision !== undefined) {
      if (!Number.isSafeInteger(finalRevision) || finalRevision < Math.max(this.revision, this.headRevision, revision) ||
          (this.finalRevision !== undefined && this.finalRevision !== finalRevision)) {
        this.stop('conflicting-final-revision');
        return;
      }
      this.finalRevision = finalRevision;
    }
    this.headRevision = Math.max(this.headRevision, revision, this.finalRevision ?? 0);
    this.completed ||= completed;
    this.pull();
    this.finishExit();
  }

  public accept(readId: string, requestId: string, value: TerminalStreamPage | undefined, closedError?: string): void {
    const read = this.read;
    if (!read || read.readId !== readId || this.requestId !== requestId) {
      return;
    }
    if (closedError !== undefined) {
      this.stop('terminal-reader-closed');
      (this.callbacks.error ?? this.callbacks.exit)(closedError);
      return;
    }
    this.requestId = undefined;
    const page = normalizeTerminalStreamPage(value);
    if (!page || page.readId !== read.readId || page.sessionId !== read.sessionId ||
        page.authorityId !== read.authorityId || page.afterRevision !== this.revision) {
      if (this.stateChunks) {
        this.stop('invalid-current-state-page');
        return;
      }
      this.busy = false;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.pull(true);
      }, 250);
      return;
    }
    if (read.settlementMode && this.finalRevision !== undefined && page.headRevision > this.finalRevision) {
      this.stop('page-exceeds-final-revision');
      return;
    }
    this.headRevision = Math.max(this.headRevision, page.headRevision);
    if (this.stateChunks) {
      const chunk = page.stateChunk;
      if (!read.currentState || !chunk || chunk.offset !== this.stateOffset || !chunk.data.length ||
          chunk.offset + chunk.data.length > read.currentState.length || page.events.length !== 0 ||
          page.revision !== read.checkpoint.revision) {
        this.stop('invalid-current-state-page');
        return;
      }
      this.stateChunks.push(chunk.data);
      this.stateOffset += chunk.data.length;
      this.stateChunkCount += 1;
      if (this.stateOffset === read.currentState.length) {
        // JSON.parse(join(...)) temporarily retains both representations; expose
        // that bounded estimate so production evidence does not confuse chunk
        // size with the full receiver assembly cost.
        this.callbacks.currentStateProgress?.(read, this.stateOffset, this.stateChunkCount,
          this.stateOffset * 2);
      }
      if (this.stateOffset < read.currentState.length) {
        this.busy = false;
        this.pull(true);
        return;
      }
      let state: unknown;
      try { state = JSON.parse(this.stateChunks.join('')); }
      catch { this.stop('invalid-current-state-json'); return; }
      this.stateChunks = undefined;
      try {
        this.callbacks.currentState!(read, state, () => this.read === read, (applied = true) => {
          if (this.read !== read) return;
          if (!applied) { this.stop('current-state-import-failed-or-cancelled'); return; }
          // Only a normal page request acknowledges the imported state to the producer.
          this.stateImportPendingConfirmation = true;
          this.busy = false;
          this.pull(true);
        });
      } catch { this.stop('current-state-import-failed-or-cancelled'); }
      return;
    }
    if (page.stateChunk) { this.stop('unexpected-current-state-page'); return; }
    this.callbacks.events(page.events, page.revision, () => this.read === read, (applied = true) => {
      if (this.read !== read) {
        return;
      }
      if (!applied) {
        if (read.settlementMode) this.stop('page-write-failed-or-cancelled');
        return;
      }
      this.revision = page.revision;
      this.stateImportPendingConfirmation = false;
      this.busy = false;
      this.finishExit();
      this.pull();
    });
  }

  public showExit(message: string, sessionId?: string): void {
    if (this.read && (!sessionId || sessionId === this.read.sessionId)) {
      this.exitMessage = message;
      this.finishExit();
    }
  }

  public stop(reason = 'projection-stopped'): void {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.read && !this.closed) {
      this.callbacks.close(this.read, this.read.settlementMode ? { kind: 'cancelled', reason } : undefined);
    }
    this.read = undefined;
    this.requestId = undefined;
    this.busy = false;
    this.completed = false;
    this.finalRevision = undefined;
    this.closed = false;
    this.exitMessage = undefined;
    this.stateChunks = undefined;
    this.stateOffset = 0;
    this.stateChunkCount = 0;
    this.stateImportPendingConfirmation = false;
  }

  private pull(force = false): void {
    if (!this.read || this.closed || this.busy || this.retryTimer !== undefined || (!force && this.revision >= this.headRevision)) {
      return;
    }
    this.busy = true;
    this.requestId = `${this.read.readId}:${++this.requestSequence}`;
    this.callbacks.request(this.read, this.revision, this.requestId,
      this.stateChunks ? this.stateOffset : undefined);
  }

  private finishExit(): void {
    if (this.stateChunks || this.stateImportPendingConfirmation) return;
    if (this.read?.settlementMode) {
      if (this.finalRevision === undefined || this.busy || this.revision !== this.finalRevision) return;
      if (!this.closed) {
        this.closed = true;
        this.callbacks.close(this.read, { kind: 'applied', finalRevision: this.finalRevision });
      }
      if (this.exitMessage !== undefined) {
        const message = this.exitMessage;
        this.exitMessage = undefined;
        this.callbacks.exit(message);
      }
      return;
    }
    if (this.completed && !this.busy && this.revision >= this.headRevision && this.exitMessage !== undefined) {
      const message = this.exitMessage;
      this.exitMessage = undefined;
      if (this.read && !this.closed) {
        this.closed = true;
        this.callbacks.close(this.read);
      }
      this.callbacks.exit(message);
    }
  }
}
