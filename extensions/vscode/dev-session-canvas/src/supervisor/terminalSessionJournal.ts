import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  TERMINAL_SESSION_STREAM_VERSION,
  cloneTerminalStreamCheckpoint,
  cloneTerminalStreamEvent,
  normalizeTerminalStreamCheckpoint,
  normalizeTerminalStreamEvent,
  type TerminalStreamCheckpoint,
  type TerminalStreamEvent,
  type TerminalStreamOutputEvent,
  type TerminalStreamResizeEvent,
  type TerminalStreamScrollbackEvent
} from '../common/terminalSessionStream';

const TERMINAL_JOURNAL_MANIFEST_VERSION_V1 = 1 as const;
const TERMINAL_JOURNAL_MANIFEST_VERSION_V2 = 2 as const;
const TERMINAL_JOURNAL_CHECKPOINT_ENVELOPE_VERSION = 1 as const;
const TERMINAL_JOURNAL_ROOT_DIRECTORY = 'terminal-journals';
const TERMINAL_JOURNAL_MANIFEST_FILE = 'manifest.json';
const TERMINAL_JOURNAL_SEGMENT_PATTERN = /^segment-(\d{16})\.ndjson$/u;
const TERMINAL_JOURNAL_CHECKPOINT_PATTERN = /^checkpoint-(\d{16})-([a-f0-9-]+)\.json$/u;
const TERMINAL_JOURNAL_GENESIS_CHECKSUM = '0'.repeat(64);
const DEFAULT_TERMINAL_JOURNAL_SEGMENT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TERMINAL_JOURNAL_FLUSH_DELAY_MS = 16;
const DEFAULT_TERMINAL_JOURNAL_COMPACTION_MIN_BYTES = 16 * 1024 * 1024;
const TERMINAL_JOURNAL_RECENT_OUTPUT_LIMIT = 6000;
const MAX_TERMINAL_JOURNAL_METADATA_MANIFEST_BYTES = 1024 * 1024;
const MAX_TERMINAL_JOURNAL_METADATA_SEGMENT_COUNT = 8192;
const TEST_RECOVERY_MAX_JOURNAL_BYTES_ENV = 'DEV_SESSION_CANVAS_TEST_RUNTIME_SUPERVISOR_MAX_RECOVERY_JOURNAL_BYTES';

interface TerminalJournalSegmentManifest {
  file: string;
  startRevision: number;
  endRevision: number;
  recordCount: number;
  bytes: number;
}

interface TerminalJournalManifestBase {
  sessionId: string;
  authorityId: string;
  createdAtMs: number;
  initialCols: number;
  initialRows: number;
  initialScrollback: number;
  lastRevision: number;
  lastChecksum: string;
  segments: TerminalJournalSegmentManifest[];
  checksum: string;
}

export interface TerminalJournalManifestV1 extends TerminalJournalManifestBase {
  version: typeof TERMINAL_JOURNAL_MANIFEST_VERSION_V1;
}

interface TerminalJournalCheckpointReference {
  file: string;
  revision: number;
  journalChecksum: string;
  codecId: string;
  producerProfile: string;
  envelopeChecksum: string;
}

export interface TerminalJournalManifestV2 extends TerminalJournalManifestBase {
  version: typeof TERMINAL_JOURNAL_MANIFEST_VERSION_V2;
  retainedStartRevision: number;
  retainedPreviousChecksum: string;
  currentCheckpoint: TerminalJournalCheckpointReference;
  previousCheckpoint?: TerminalJournalCheckpointReference;
  recentOutput: string;
}

export type TerminalJournalManifest = TerminalJournalManifestV1 | TerminalJournalManifestV2;

/**
 * A bounded startup-time description of a persisted terminal Journal. It deliberately excludes
 * terminal events and checkpoint payloads so a dead PTY cannot trigger a transcript replay.
 */
export interface TerminalSessionJournalMetadata {
  sessionId: string;
  authorityId: string;
  version: 1 | 2;
  lastRevision: number;
  retainedStartRevision: number;
  segmentCount: number;
  segmentBytes: number;
  manifestBytes: number;
}

interface TerminalJournalCheckpointEnvelope {
  version: typeof TERMINAL_JOURNAL_CHECKPOINT_ENVELOPE_VERSION;
  sessionId: string;
  authorityId: string;
  revision: number;
  journalChecksum: string;
  codecId: string;
  producerProfile: string;
  outputTail: string;
  checkpoint: TerminalStreamCheckpoint;
  checksum: string;
}

interface StoredTerminalJournalCheckpoint {
  checkpoint: TerminalStreamCheckpoint;
  outputTail: string;
}

interface StoredTerminalJournalRecordBase {
  version: typeof TERMINAL_SESSION_STREAM_VERSION;
  sessionId: string;
  authorityId: string;
  previousChecksum: string;
  checksum: string;
}

type StoredTerminalJournalRecord = TerminalStreamEvent & StoredTerminalJournalRecordBase;

interface VerifiedTerminalJournal {
  manifest: TerminalJournalManifest;
  events: TerminalStreamEvent[];
  baseRevision: number;
  checksums: string[];
}

interface ScannedTerminalJournalSegment extends TerminalJournalSegmentManifest {
  recordByteEnds: number[];
}

interface ScannedTerminalJournal {
  events: TerminalStreamEvent[];
  segments: ScannedTerminalJournalSegment[];
  baseRevision: number;
  checksums: string[];
  incompleteTail?: {
    path: string;
    retainedBytes: number;
  };
}

export interface TerminalSessionJournalCreateOptions {
  storageDir: string;
  sessionId: string;
  authorityId?: string;
  initialCols: number;
  initialRows: number;
  initialScrollback: number;
  segmentMaxBytes?: number;
  flushDelayMs?: number;
  compactionMinBytes?: number;
  checkpointProfiles?: Readonly<Record<string, string>>;
}

export interface TerminalSessionJournalOpenOptions {
  storageDir: string;
  sessionId: string;
  authorityId?: string;
  segmentMaxBytes?: number;
  flushDelayMs?: number;
  compactionMinBytes?: number;
  checkpointProfiles?: Readonly<Record<string, string>>;
}

export interface TerminalJournalRecoveryCandidate {
  source: 'current' | 'previous' | 'genesis';
  checkpoint?: TerminalStreamCheckpoint;
  outputTail: string;
  events: TerminalStreamEvent[];
}

export interface TerminalJournalCheckpointCommitOptions {
  /** Keep every event after this revision even when an older checkpoint covers it. */
  retainAfterRevision?: number;
  /** Bypass the capacity gate; checkpoint validity remains the caller's responsibility. */
  force?: boolean;
}

export interface TerminalJournalCheckpointCommitResult {
  committed: boolean;
  compactedBytes: number;
  compactedSegments: number;
  retainedStartRevision: number;
  reason?: 'below-threshold' | 'not-newer' | 'no-usable-fallback';
}

export interface TerminalSessionJournalProjectionPin {
  readonly id: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly checkpoint: TerminalStreamCheckpoint;
  readonly targetRevision: number;
  /** Extend a still-open projection to a newer journal head without replacing its checkpoint. */
  extendTargetRevision(targetRevision: number): void;
  readEvent(revision: number): TerminalStreamEvent | undefined;
  release(): void;
}

export class TerminalSessionJournal {
  private readonly sessionDirectory: string;
  private readonly manifestPath: string;
  private readonly segmentMaxBytes: number;
  private readonly flushDelayMs: number;
  private readonly compactionMinBytes: number;
  private readonly checkpointProfiles: Readonly<Record<string, string>>;
  private readonly events: TerminalStreamEvent[];
  private readonly segments: TerminalJournalSegmentManifest[];
  private readonly pendingWrites = new Map<string, string[]>();
  private writeChain: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | undefined;
  private writeError: Error | undefined;
  private lastRevision: number;
  private lastChecksum: string;
  private manifestVersion: 1 | 2;
  private retainedStartRevision: number;
  private retainedPreviousChecksum: string;
  private currentCheckpoint: TerminalJournalCheckpointReference | undefined;
  private previousCheckpoint: TerminalJournalCheckpointReference | undefined;
  private recentOutput: string;
  private startNewSegmentOnAppend: boolean;
  private manifestWriteSequence = 0;
  private checkpointCommitInProgress = false;
  private readonly projectionPins = new Map<string, number>();

  private constructor(
    private readonly storageDir: string,
    private readonly sessionId: string,
    private readonly authorityId: string,
    private readonly createdAtMs: number,
    private readonly initialCols: number,
    private readonly initialRows: number,
    private readonly initialScrollback: number,
    events: TerminalStreamEvent[],
    segments: TerminalJournalSegmentManifest[],
    lastRevision: number,
    lastChecksum: string,
    options: {
      segmentMaxBytes?: number;
      flushDelayMs?: number;
      compactionMinBytes?: number;
      checkpointProfiles?: Readonly<Record<string, string>>;
      manifest?: TerminalJournalManifest;
    } = {}
  ) {
    this.sessionDirectory = resolveTerminalJournalSessionDirectory(storageDir, sessionId);
    this.manifestPath = path.join(this.sessionDirectory, TERMINAL_JOURNAL_MANIFEST_FILE);
    this.segmentMaxBytes = normalizePositiveInteger(
      options.segmentMaxBytes,
      DEFAULT_TERMINAL_JOURNAL_SEGMENT_MAX_BYTES
    );
    this.flushDelayMs = normalizePositiveInteger(options.flushDelayMs, DEFAULT_TERMINAL_JOURNAL_FLUSH_DELAY_MS);
    this.compactionMinBytes = normalizeNonNegativeInteger(
      options.compactionMinBytes,
      DEFAULT_TERMINAL_JOURNAL_COMPACTION_MIN_BYTES
    );
    this.checkpointProfiles = normalizeCheckpointProfiles(options.checkpointProfiles);
    this.events = events;
    this.segments = segments;
    this.lastRevision = lastRevision;
    this.lastChecksum = lastChecksum;
    const manifest = options.manifest;
    this.manifestVersion = manifest?.version ?? TERMINAL_JOURNAL_MANIFEST_VERSION_V1;
    this.retainedStartRevision = manifest?.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
      ? manifest.retainedStartRevision
      : 1;
    this.retainedPreviousChecksum = manifest?.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
      ? manifest.retainedPreviousChecksum
      : TERMINAL_JOURNAL_GENESIS_CHECKSUM;
    this.currentCheckpoint = manifest?.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
      ? cloneCheckpointReference(manifest.currentCheckpoint)
      : undefined;
    this.previousCheckpoint = manifest?.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2 && manifest.previousCheckpoint
      ? cloneCheckpointReference(manifest.previousCheckpoint)
      : undefined;
    this.recentOutput = manifest?.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
      ? manifest.recentOutput
      : events.reduce(
          (tail, event) => event.type === 'output' ? appendRecentOutput(tail, event.data) : tail,
          ''
        );
    const tailSegment = this.segments[this.segments.length - 1];
    this.startNewSegmentOnAppend = Boolean(
      this.currentCheckpoint &&
      this.currentCheckpoint.revision === this.lastRevision &&
      !(tailSegment?.recordCount === 0 && tailSegment.startRevision === this.lastRevision + 1)
    );
  }

  public static async create(options: TerminalSessionJournalCreateOptions): Promise<TerminalSessionJournal> {
    const authorityId = options.authorityId?.trim() || randomUUID();
    const sessionDirectory = resolveTerminalJournalSessionDirectory(options.storageDir, options.sessionId);
    const manifestPath = path.join(sessionDirectory, TERMINAL_JOURNAL_MANIFEST_FILE);
    await fs.promises.mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(manifestPath)) {
      throw new Error(`Terminal journal already exists for session ${options.sessionId}.`);
    }

    const journal = new TerminalSessionJournal(
      options.storageDir,
      options.sessionId,
      authorityId,
      Date.now(),
      options.initialCols,
      options.initialRows,
      options.initialScrollback,
      [],
      [],
      0,
      TERMINAL_JOURNAL_GENESIS_CHECKSUM,
      options
    );
    await journal.writeManifest(journal.createManifestSnapshot(), true);
    return journal;
  }

  public static async open(options: TerminalSessionJournalOpenOptions): Promise<TerminalSessionJournal> {
    const verified = await loadTerminalSessionJournal(
      options.storageDir,
      options.sessionId,
      options.authorityId,
      { repairStaleTail: true }
    );
    return new TerminalSessionJournal(
      options.storageDir,
      verified.manifest.sessionId,
      verified.manifest.authorityId,
      verified.manifest.createdAtMs,
      verified.manifest.initialCols,
      verified.manifest.initialRows,
      verified.manifest.initialScrollback,
      verified.events,
      verified.manifest.segments.map(cloneSegmentManifest),
      verified.manifest.lastRevision,
      verified.manifest.lastChecksum,
      { ...options, manifest: verified.manifest }
    );
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getAuthorityId(): string {
    return this.authorityId;
  }

  public getRevision(): number {
    return this.lastRevision;
  }

  public getRetainedStartRevision(): number {
    return this.retainedStartRevision;
  }

  public shouldCommitCheckpoint(revision: number): boolean {
    if (
      !Number.isSafeInteger(revision) ||
      revision !== this.lastRevision ||
      revision <= (this.currentCheckpoint?.revision ?? -1)
    ) {
      return false;
    }
    return this.getCheckpointPromotionBytes(revision) >= this.compactionMinBytes;
  }

  public async commitCheckpoint(
    checkpoint: TerminalStreamCheckpoint,
    options: TerminalJournalCheckpointCommitOptions = {}
  ): Promise<TerminalJournalCheckpointCommitResult> {
    const normalizedCheckpoint = normalizeTerminalStreamCheckpoint(checkpoint);
    if (
      !normalizedCheckpoint ||
      normalizedCheckpoint.sessionId !== this.sessionId ||
      normalizedCheckpoint.authorityId !== this.authorityId
    ) {
      throw new Error(`Invalid terminal journal checkpoint for session ${this.sessionId}.`);
    }
    const producerProfile = this.checkpointProfiles[normalizedCheckpoint.serializedState.format];
    if (!isCheckpointProfileComponent(producerProfile)) {
      throw new Error(
        `No terminal journal checkpoint producer profile is registered for codec ${normalizedCheckpoint.serializedState.format}.`
      );
    }
    if (normalizedCheckpoint.revision !== this.lastRevision) {
      throw new Error(
        `Terminal journal checkpoint revision ${normalizedCheckpoint.revision} is not the current head ${this.lastRevision}.`
      );
    }
    if (
      options.retainAfterRevision !== undefined &&
      (!Number.isSafeInteger(options.retainAfterRevision) || options.retainAfterRevision < 0)
    ) {
      throw new Error(`Invalid terminal journal retention revision ${options.retainAfterRevision}.`);
    }
    if (normalizedCheckpoint.revision <= (this.currentCheckpoint?.revision ?? -1)) {
      return {
        committed: false,
        compactedBytes: 0,
        compactedSegments: 0,
        retainedStartRevision: this.retainedStartRevision,
        reason: 'not-newer'
      };
    }

    const promotionBytes = this.getCheckpointPromotionBytes(
      normalizedCheckpoint.revision,
      options.retainAfterRevision
    );
    if (!options.force && promotionBytes < this.compactionMinBytes) {
      return {
        committed: false,
        compactedBytes: 0,
        compactedSegments: 0,
        retainedStartRevision: this.retainedStartRevision,
        reason: 'below-threshold'
      };
    }

    if (this.checkpointCommitInProgress) {
      throw new Error(`Terminal journal checkpoint commit is already in progress for session ${this.sessionId}.`);
    }
    this.checkpointCommitInProgress = true;
    try {
      await this.flush();
      let result: TerminalJournalCheckpointCommitResult | undefined;
      this.writeChain = this.writeChain
        .then(async () => {
          result = await this.commitCheckpointOnWriteChain(normalizedCheckpoint, options);
        })
        .catch((error) => {
          this.writeError = error instanceof Error ? error : new Error(String(error));
        });
      await this.writeChain;
      this.throwIfWriteFailed();
      if (!result) {
        throw new Error(`Terminal journal checkpoint commit did not complete for session ${this.sessionId}.`);
      }
      return result;
    } finally {
      this.checkpointCommitInProgress = false;
    }
  }

  public async getRecoveryCandidates(): Promise<TerminalJournalRecoveryCandidate[]> {
    await this.flush();
    const verified = await verifyTerminalSessionJournal(this.storageDir, this.sessionId, this.authorityId);
    const candidates: TerminalJournalRecoveryCandidate[] = [];
    if (verified.manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2) {
      const references: Array<{
        source: 'current' | 'previous';
        reference: TerminalJournalCheckpointReference | undefined;
      }> = [
        { source: 'current', reference: verified.manifest.currentCheckpoint },
        { source: 'previous', reference: verified.manifest.previousCheckpoint }
      ];
      for (const { source, reference } of references) {
        if (
          !reference ||
          reference.revision < verified.baseRevision ||
          this.checkpointProfiles[reference.codecId] !== reference.producerProfile
        ) {
          continue;
        }
        const checksum = checksumAtScannedRevision(verified, reference.revision);
        if (checksum !== reference.journalChecksum) {
          continue;
        }
        const storedCheckpoint = await readTerminalJournalCheckpoint(
          this.sessionDirectory,
          this.sessionId,
          this.authorityId,
          reference
        );
        if (!storedCheckpoint) {
          continue;
        }
        candidates.push({
          source,
          checkpoint: cloneTerminalStreamCheckpoint(storedCheckpoint.checkpoint),
          outputTail: storedCheckpoint.outputTail,
          events: verified.events
            .filter((event) => event.revision > storedCheckpoint.checkpoint.revision)
            .map(cloneTerminalStreamEvent)
        });
      }
    }
    if (verified.manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V1 || verified.manifest.retainedStartRevision === 1) {
      candidates.push({
        source: 'genesis',
        outputTail: '',
        events: verified.events.map(cloneTerminalStreamEvent)
      });
    }
    return candidates;
  }

  public async getRecoveryCheckpoints(): Promise<TerminalStreamCheckpoint[]> {
    const candidates = await this.getRecoveryCandidates();
    return candidates.flatMap((candidate) =>
      candidate.checkpoint ? [cloneTerminalStreamCheckpoint(candidate.checkpoint)] : []
    );
  }

  public getInitialTerminalState(): { cols: number; rows: number; scrollback: number } {
    return {
      cols: this.initialCols,
      rows: this.initialRows,
      scrollback: this.initialScrollback
    };
  }

  public appendOutput(data: string): TerminalStreamOutputEvent {
    if (!data) {
      throw new Error('Terminal journal output records must not be empty.');
    }
    return this.appendEvent({
      type: 'output',
      data
    }) as TerminalStreamOutputEvent;
  }

  public appendResize(cols: number, rows: number): TerminalStreamResizeEvent {
    return this.appendEvent({
      type: 'resize',
      cols,
      rows
    }) as TerminalStreamResizeEvent;
  }

  public appendScrollback(scrollback: number): TerminalStreamScrollbackEvent {
    return this.appendEvent({
      type: 'scrollback',
      scrollback
    }) as TerminalStreamScrollbackEvent;
  }

  public pinProjection(
    checkpoint: TerminalStreamCheckpoint,
    targetRevision: number
  ): TerminalSessionJournalProjectionPin {
    const normalizedCheckpoint = normalizeTerminalStreamCheckpoint(checkpoint);
    if (
      !normalizedCheckpoint ||
      normalizedCheckpoint.sessionId !== this.sessionId ||
      normalizedCheckpoint.authorityId !== this.authorityId
    ) {
      throw new Error(`Invalid terminal projection checkpoint for session ${this.sessionId}.`);
    }
    if (
      !Number.isSafeInteger(targetRevision) ||
      targetRevision < normalizedCheckpoint.revision ||
      targetRevision > this.lastRevision
    ) {
      throw new Error(`Invalid terminal projection target revision ${targetRevision}.`);
    }

    const firstRequiredRevision = normalizedCheckpoint.revision + 1;
    const firstRetainedRevision = this.events[0]?.revision ?? this.lastRevision + 1;
    if (firstRequiredRevision <= targetRevision && firstRequiredRevision < firstRetainedRevision) {
      throw new Error(
        `Terminal projection events before revision ${firstRetainedRevision} are not retained in memory.`
      );
    }

    const id = randomUUID();
    const checkpointCopy = cloneTerminalStreamCheckpoint(normalizedCheckpoint);
    let pinnedTargetRevision = targetRevision;
    this.projectionPins.set(id, normalizedCheckpoint.revision);
    let released = false;
    return Object.freeze({
      id,
      sessionId: this.sessionId,
      authorityId: this.authorityId,
      checkpoint: checkpointCopy,
      get targetRevision(): number {
        return pinnedTargetRevision;
      },
      extendTargetRevision: (nextTargetRevision: number): void => {
        if (released || !this.projectionPins.has(id)) {
          throw new Error(`Terminal projection ${id} is no longer pinned.`);
        }
        if (
          !Number.isSafeInteger(nextTargetRevision) ||
          nextTargetRevision < pinnedTargetRevision ||
          nextTargetRevision > this.lastRevision
        ) {
          throw new Error(`Invalid terminal projection target revision ${nextTargetRevision}.`);
        }
        const firstRequiredRevision = normalizedCheckpoint.revision + 1;
        const firstRetainedRevision = this.events[0]?.revision ?? this.lastRevision + 1;
        if (firstRequiredRevision <= nextTargetRevision && firstRequiredRevision < firstRetainedRevision) {
          throw new Error(
            `Terminal projection events before revision ${firstRetainedRevision} are not retained in memory.`
          );
        }
        pinnedTargetRevision = nextTargetRevision;
      },
      readEvent: (revision: number): TerminalStreamEvent | undefined => {
        if (released || !this.projectionPins.has(id)) {
          throw new Error(`Terminal projection ${id} is no longer pinned.`);
        }
        if (
          !Number.isSafeInteger(revision) ||
          revision <= normalizedCheckpoint.revision ||
          revision > pinnedTargetRevision
        ) {
          throw new Error(`Invalid terminal projection event revision ${revision}.`);
        }
        const firstRevision = this.events[0]?.revision ?? this.lastRevision + 1;
        const event = this.events[revision - firstRevision];
        if (!event || event.revision !== revision) {
          throw new Error(`Terminal projection event revision ${revision} is not retained in memory.`);
        }
        return cloneTerminalStreamEvent(event);
      },
      release: (): void => {
        if (released) {
          return;
        }
        released = true;
        this.projectionPins.delete(id);
      }
    });
  }

  public getPinnedProjectionRetentionRevision(): number | undefined {
    let retentionRevision: number | undefined;
    for (const revision of this.projectionPins.values()) {
      retentionRevision = retentionRevision === undefined
        ? revision
        : Math.min(retentionRevision, revision);
    }
    return retentionRevision;
  }

  public getEventsAfter(revision: number): TerminalStreamEvent[] {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.lastRevision) {
      throw new Error(`Invalid terminal journal revision ${revision}.`);
    }
    const firstRetainedRevision = this.events[0]?.revision ?? this.lastRevision + 1;
    if (revision + 1 < firstRetainedRevision) {
      throw new Error(
        `Terminal journal events before revision ${firstRetainedRevision} are not retained in memory.`
      );
    }
    return this.events.filter((event) => event.revision > revision).map(cloneTerminalStreamEvent);
  }

  public releaseMemoryThrough(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      return;
    }
    const pinnedRevision = this.getPinnedProjectionRetentionRevision();
    const releaseRevision = pinnedRevision === undefined ? revision : Math.min(revision, pinnedRevision);
    let removeCount = 0;
    while (removeCount < this.events.length && this.events[removeCount].revision <= releaseRevision) {
      removeCount += 1;
    }
    if (removeCount > 0) {
      this.events.splice(0, removeCount);
    }
  }

  public async flush(): Promise<void> {
    this.clearFlushTimer();
    while (this.pendingWrites.size > 0) {
      this.enqueuePendingWrites();
      await this.writeChain;
      this.throwIfWriteFailed();
    }
    await this.writeChain;
    this.throwIfWriteFailed();
  }

  public async readAllEvents(): Promise<TerminalStreamEvent[]> {
    await this.flush();
    const verified = await verifyTerminalSessionJournal(this.storageDir, this.sessionId, this.authorityId);
    return verified.events;
  }

  public async delete(): Promise<void> {
    this.projectionPins.clear();
    this.clearFlushTimer();
    await this.flush().catch(() => undefined);
    await fs.promises.rm(this.sessionDirectory, { recursive: true, force: true });
  }

  private appendEvent(
    event:
      | Omit<TerminalStreamOutputEvent, 'revision' | 'createdAtMs'>
      | Omit<TerminalStreamResizeEvent, 'revision' | 'createdAtMs'>
      | Omit<TerminalStreamScrollbackEvent, 'revision' | 'createdAtMs'>
  ): TerminalStreamEvent {
    this.throwIfWriteFailed();
    if (this.checkpointCommitInProgress) {
      throw new Error(`Terminal journal append raced with checkpoint commit for session ${this.sessionId}.`);
    }
    const normalizedEvent = normalizeTerminalStreamEvent({
      ...event,
      revision: this.lastRevision + 1,
      createdAtMs: Date.now()
    });
    if (!normalizedEvent) {
      throw new Error('Invalid terminal journal event.');
    }

    const storedRecord = createStoredTerminalJournalRecord(
      this.sessionId,
      this.authorityId,
      this.lastChecksum,
      normalizedEvent
    );
    const line = `${JSON.stringify(storedRecord)}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const segment = this.selectSegment(normalizedEvent.revision, lineBytes);
    segment.endRevision = normalizedEvent.revision;
    segment.recordCount += 1;
    segment.bytes += lineBytes;
    const pending = this.pendingWrites.get(segment.file) ?? [];
    pending.push(line);
    this.pendingWrites.set(segment.file, pending);

    this.events.push(cloneTerminalStreamEvent(normalizedEvent));
    if (normalizedEvent.type === 'output') {
      this.recentOutput = appendRecentOutput(this.recentOutput, normalizedEvent.data);
    }
    this.lastRevision = normalizedEvent.revision;
    this.lastChecksum = storedRecord.checksum;
    this.scheduleFlush();
    return cloneTerminalStreamEvent(normalizedEvent);
  }

  private selectSegment(revision: number, lineBytes: number): TerminalJournalSegmentManifest {
    const current = this.segments[this.segments.length - 1];
    if (
      !this.startNewSegmentOnAppend &&
      current &&
      (current.recordCount === 0 || current.bytes + lineBytes <= this.segmentMaxBytes)
    ) {
      return current;
    }

    this.startNewSegmentOnAppend = false;

    const segment: TerminalJournalSegmentManifest = {
      file: createSegmentFileName(revision),
      startRevision: revision,
      endRevision: revision - 1,
      recordCount: 0,
      bytes: 0
    };
    this.segments.push(segment);
    return segment;
  }

  private getCheckpointPromotionBytes(revision: number, retainAfterRevision?: number): number {
    const coveredRevision = this.currentCheckpoint?.revision ?? revision;
    const pinnedRevision = this.getPinnedProjectionRetentionRevision();
    const retentionRevision = retainAfterRevision === undefined
      ? pinnedRevision
      : pinnedRevision === undefined
        ? retainAfterRevision
        : Math.min(retainAfterRevision, pinnedRevision);
    const removableThrough = Math.min(coveredRevision, retentionRevision ?? coveredRevision);
    return this.segments.reduce(
      (total, segment) => total + (segment.endRevision <= removableThrough ? segment.bytes : 0),
      0
    );
  }

  private async commitCheckpointOnWriteChain(
    checkpoint: TerminalStreamCheckpoint,
    options: TerminalJournalCheckpointCommitOptions
  ): Promise<TerminalJournalCheckpointCommitResult> {
    if (checkpoint.revision !== this.lastRevision || this.pendingWrites.size > 0) {
      throw new Error(`Terminal journal head changed during checkpoint commit for session ${this.sessionId}.`);
    }
    await syncTerminalJournalSegments(this.sessionDirectory, this.segments);
    const verified = await verifyTerminalSessionJournal(this.storageDir, this.sessionId, this.authorityId);
    if (
      verified.manifest.lastRevision !== this.lastRevision ||
      verified.manifest.lastChecksum !== this.lastChecksum
    ) {
      throw new Error(`Terminal journal changed while verifying checkpoint commit for session ${this.sessionId}.`);
    }

    let previousCheckpoint: TerminalJournalCheckpointReference | undefined;
    if (this.currentCheckpoint) {
      const manifestCurrent = verified.manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
        ? verified.manifest.currentCheckpoint
        : undefined;
      const manifestPrevious = verified.manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
        ? verified.manifest.previousCheckpoint
        : undefined;
      if (
        !manifestCurrent ||
        !sameCheckpointReference(manifestCurrent, this.currentCheckpoint) ||
        !sameOptionalCheckpointReference(manifestPrevious, this.previousCheckpoint)
      ) {
        throw new Error(`Terminal journal current checkpoint changed for session ${this.sessionId}.`);
      }

      for (const fallbackCheckpoint of [this.currentCheckpoint, this.previousCheckpoint]) {
        if (!fallbackCheckpoint) {
          continue;
        }
        const fallbackSupported =
          this.checkpointProfiles[fallbackCheckpoint.codecId] === fallbackCheckpoint.producerProfile;
        const fallbackAnchored =
          checksumAtScannedRevision(verified, fallbackCheckpoint.revision) === fallbackCheckpoint.journalChecksum;
        const fallbackReadable = fallbackSupported && fallbackAnchored
          ? await readTerminalJournalCheckpoint(
              this.sessionDirectory,
              this.sessionId,
              this.authorityId,
              fallbackCheckpoint
            )
          : undefined;
        if (fallbackReadable) {
          previousCheckpoint = cloneCheckpointReference(fallbackCheckpoint);
          break;
        }
      }
    }

    if (!previousCheckpoint && verified.baseRevision !== 0) {
      return {
        committed: false,
        compactedBytes: 0,
        compactedSegments: 0,
        retainedStartRevision: this.retainedStartRevision,
        reason: 'no-usable-fallback'
      };
    }

    const reference = await writeTerminalJournalCheckpoint(
      this.sessionDirectory,
      this.sessionId,
      this.authorityId,
      this.lastChecksum,
      this.checkpointProfiles,
      this.recentOutput,
      checkpoint
    );

    const pinnedRevision = this.getPinnedProjectionRetentionRevision();
    const retentionRevision = options.retainAfterRevision === undefined
      ? pinnedRevision
      : pinnedRevision === undefined
        ? options.retainAfterRevision
        : Math.min(options.retainAfterRevision, pinnedRevision);
    const removalLimit = previousCheckpoint
      ? Math.min(previousCheckpoint.revision, retentionRevision ?? previousCheckpoint.revision)
      : -1;
    let removeCount = 0;
    while (
      removeCount < this.segments.length &&
      this.segments[removeCount].endRevision <= removalLimit
    ) {
      removeCount += 1;
    }
    const removedSegments = this.segments.slice(0, removeCount).map(cloneSegmentManifest);
    const retainedSegments = this.segments.slice(removeCount).map(cloneSegmentManifest);
    const removedThroughRevision = removedSegments.at(-1)?.endRevision;
    const compactedAnchor = removedThroughRevision === undefined
      ? undefined
      : checksumAtScannedRevision(verified, removedThroughRevision);
    if (removedThroughRevision !== undefined && !compactedAnchor) {
      throw new Error(`Could not anchor terminal journal compaction at revision ${removedThroughRevision}.`);
    }
    const retainedPreviousChecksum = compactedAnchor ?? this.retainedPreviousChecksum;
    const retainedStartRevision = retainedSegments[0]?.startRevision ?? this.lastRevision + 1;
    const manifest = createTerminalJournalManifestV2({
      sessionId: this.sessionId,
      authorityId: this.authorityId,
      createdAtMs: this.createdAtMs,
      initialCols: this.initialCols,
      initialRows: this.initialRows,
      initialScrollback: this.initialScrollback,
      lastRevision: this.lastRevision,
      lastChecksum: this.lastChecksum,
      retainedStartRevision,
      retainedPreviousChecksum,
      currentCheckpoint: reference,
      previousCheckpoint,
      recentOutput: this.recentOutput,
      segments: retainedSegments
    });

    await this.writeManifest(manifest, true);

    this.manifestVersion = TERMINAL_JOURNAL_MANIFEST_VERSION_V2;
    this.currentCheckpoint = cloneCheckpointReference(reference);
    this.previousCheckpoint = previousCheckpoint;
    this.retainedStartRevision = retainedStartRevision;
    this.retainedPreviousChecksum = retainedPreviousChecksum;
    this.segments.splice(0, removeCount);
    if (removedThroughRevision !== undefined) {
      let eventRemoveCount = 0;
      while (
        eventRemoveCount < this.events.length &&
        this.events[eventRemoveCount].revision <= removedThroughRevision
      ) {
        eventRemoveCount += 1;
      }
      this.events.splice(0, eventRemoveCount);
    }
    const tailSegment = this.segments[this.segments.length - 1];
    this.startNewSegmentOnAppend = !(
      tailSegment?.recordCount === 0 && tailSegment.startRevision === this.lastRevision + 1
    );

    await cleanupUnreferencedJournalFiles(
      this.sessionDirectory,
      this.segments,
      [this.currentCheckpoint, this.previousCheckpoint]
    );
    return {
      committed: true,
      compactedBytes: removedSegments.reduce((total, segment) => total + segment.bytes, 0),
      compactedSegments: removedSegments.length,
      retainedStartRevision: this.retainedStartRevision
    };
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.enqueuePendingWrites();
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) {
      return;
    }
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private enqueuePendingWrites(): void {
    if (this.writeError || this.pendingWrites.size === 0) {
      return;
    }

    const writes = Array.from(this.pendingWrites.entries()).map(([file, lines]) => ({
      file,
      data: lines.join('')
    }));
    this.pendingWrites.clear();
    const manifest = this.createManifestSnapshot();
    this.writeChain = this.writeChain
      .then(async () => {
        for (const write of writes) {
          await fs.promises.appendFile(path.join(this.sessionDirectory, write.file), write.data, {
            encoding: 'utf8',
            mode: 0o600
          });
        }
        await this.writeManifest(manifest);
      })
      .catch((error) => {
        this.writeError = error instanceof Error ? error : new Error(String(error));
      });
  }

  private createManifestSnapshot(): TerminalJournalManifest {
    if (
      this.manifestVersion === TERMINAL_JOURNAL_MANIFEST_VERSION_V2 &&
      this.currentCheckpoint
    ) {
      return createTerminalJournalManifestV2({
        sessionId: this.sessionId,
        authorityId: this.authorityId,
        createdAtMs: this.createdAtMs,
        initialCols: this.initialCols,
        initialRows: this.initialRows,
        initialScrollback: this.initialScrollback,
        lastRevision: this.lastRevision,
        lastChecksum: this.lastChecksum,
        retainedStartRevision: this.retainedStartRevision,
        retainedPreviousChecksum: this.retainedPreviousChecksum,
        currentCheckpoint: this.currentCheckpoint,
        previousCheckpoint: this.previousCheckpoint,
        recentOutput: this.recentOutput,
        segments: this.segments
      });
    }
    return createTerminalJournalManifestV1({
      sessionId: this.sessionId,
      authorityId: this.authorityId,
      createdAtMs: this.createdAtMs,
      initialCols: this.initialCols,
      initialRows: this.initialRows,
      initialScrollback: this.initialScrollback,
      lastRevision: this.lastRevision,
      lastChecksum: this.lastChecksum,
      segments: this.segments
    });
  }

  private async writeManifest(manifest: TerminalJournalManifest, durable = false): Promise<void> {
    const writeSequence = ++this.manifestWriteSequence;
    const temporaryPath = `${this.manifestPath}.${process.pid}.${writeSequence}.tmp`;
    await writeFileWithOptionalSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, durable);
    await fs.promises.rename(temporaryPath, this.manifestPath);
    if (durable) {
      await fsyncDirectory(this.sessionDirectory);
    }
  }

  private throwIfWriteFailed(): void {
    if (this.writeError) {
      throw this.writeError;
    }
  }
}

export async function verifyTerminalSessionJournal(
  storageDir: string,
  sessionId: string,
  expectedAuthorityId?: string
): Promise<VerifiedTerminalJournal> {
  return loadTerminalSessionJournal(storageDir, sessionId, expectedAuthorityId, {
    repairStaleTail: false
  });
}

async function loadTerminalSessionJournal(
  storageDir: string,
  sessionId: string,
  expectedAuthorityId: string | undefined,
  options: { repairStaleTail: boolean }
): Promise<VerifiedTerminalJournal> {
  const sessionDirectory = resolveTerminalJournalSessionDirectory(storageDir, sessionId);
  const manifestPath = path.join(sessionDirectory, TERMINAL_JOURNAL_MANIFEST_FILE);
  const manifest = normalizeManifest(JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')));
  if (!manifest || manifest.sessionId !== sessionId) {
    throw new Error(`Invalid terminal journal manifest for session ${sessionId}.`);
  }
  if (expectedAuthorityId && manifest.authorityId !== expectedAuthorityId) {
    throw new Error(`Terminal journal authority mismatch for session ${sessionId}.`);
  }

  const retainedStartRevision = manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
    ? manifest.retainedStartRevision
    : 1;
  const retainedPreviousChecksum = manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
    ? manifest.retainedPreviousChecksum
    : TERMINAL_JOURNAL_GENESIS_CHECKSUM;
  const fileNames = (await fs.promises.readdir(sessionDirectory))
    .filter((fileName) => TERMINAL_JOURNAL_SEGMENT_PATTERN.test(fileName))
    .filter((fileName) => getSegmentStartRevision(fileName) >= retainedStartRevision)
    .sort();
  const scanned = await scanTerminalJournalSegments(
    sessionDirectory,
    sessionId,
    manifest.authorityId,
    fileNames,
    retainedStartRevision,
    retainedPreviousChecksum,
    options.repairStaleTail
  );
  validateManifestPrefix(manifest, scanned);

  const repairedManifest = createManifestFromScan(manifest, scanned);
  const manifestIsCurrent = JSON.stringify(manifest) === JSON.stringify(repairedManifest);
  if (!manifestIsCurrent || scanned.incompleteTail) {
    if (!options.repairStaleTail) {
      throw new Error(`Terminal journal segment manifest mismatch for session ${sessionId}.`);
    }
    if (scanned.incompleteTail) {
      await fs.promises.truncate(scanned.incompleteTail.path, scanned.incompleteTail.retainedBytes);
    }
    await writeTerminalJournalManifest(manifestPath, repairedManifest);
  }

  return {
    manifest: repairedManifest,
    events: scanned.events,
    baseRevision: scanned.baseRevision,
    checksums: [...scanned.checksums]
  };
}

async function scanTerminalJournalSegments(
  sessionDirectory: string,
  sessionId: string,
  authorityId: string,
  fileNames: readonly string[],
  retainedStartRevision: number,
  retainedPreviousChecksum: string,
  allowIncompleteTail: boolean
): Promise<ScannedTerminalJournal> {
  const testRecoveryByteBudget = readTestRecoveryJournalByteBudget();
  let scannedBytes = 0;
  const events: TerminalStreamEvent[] = [];
  const segments: ScannedTerminalJournalSegment[] = [];
  const baseRevision = retainedStartRevision - 1;
  const checksums = [retainedPreviousChecksum];
  let expectedRevision = retainedStartRevision;
  let previousChecksum = retainedPreviousChecksum;
  let incompleteTail: ScannedTerminalJournal['incompleteTail'];
  for (let segmentIndex = 0; segmentIndex < fileNames.length; segmentIndex += 1) {
    const file = fileNames[segmentIndex];
    const match = TERMINAL_JOURNAL_SEGMENT_PATTERN.exec(file);
    const fileStartRevision = match ? Number.parseInt(match[1], 10) : Number.NaN;
    if (!Number.isSafeInteger(fileStartRevision) || fileStartRevision !== expectedRevision) {
      throw new Error(`Terminal journal segment ${file} starts at an unexpected revision.`);
    }

    const segmentPath = path.join(sessionDirectory, file);
    const fileBuffer = await fs.promises.readFile(segmentPath);
    let retainedBuffer = fileBuffer;
    if (fileBuffer.length > 0 && fileBuffer[fileBuffer.length - 1] !== 0x0a) {
      if (!allowIncompleteTail || segmentIndex !== fileNames.length - 1) {
        throw new Error(`Terminal journal segment ${file} has an incomplete final record.`);
      }
      const lastNewlineIndex = fileBuffer.lastIndexOf(0x0a);
      const retainedBytes = lastNewlineIndex < 0 ? 0 : lastNewlineIndex + 1;
      retainedBuffer = fileBuffer.subarray(0, retainedBytes);
      incompleteTail = {
        path: segmentPath,
        retainedBytes
      };
    }

    scannedBytes += retainedBuffer.length;
    if (testRecoveryByteBudget !== undefined && scannedBytes > testRecoveryByteBudget) {
      throw new Error(
        `Test recovery journal byte budget exceeded for session ${sessionId}: ${scannedBytes} > ${testRecoveryByteBudget}.`
      );
    }

    const data = retainedBuffer.toString('utf8');
    const lines = data ? data.slice(0, -1).split('\n') : [];
    const recordByteEnds: number[] = [];
    let segmentBytes = 0;
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Terminal journal record at revision ${expectedRevision} is not valid JSON.`);
      }
      const record = normalizeStoredTerminalJournalRecord(parsed);
      if (
        !record ||
        record.sessionId !== sessionId ||
        record.authorityId !== authorityId ||
        record.revision !== expectedRevision ||
        record.previousChecksum !== previousChecksum ||
        record.checksum !== checksumStoredTerminalJournalRecord(record)
      ) {
        throw new Error(`Terminal journal checksum or revision mismatch at revision ${expectedRevision}.`);
      }
      events.push(cloneTerminalStreamEvent(record));
      previousChecksum = record.checksum;
      checksums.push(record.checksum);
      segmentBytes += Buffer.byteLength(`${line}\n`, 'utf8');
      recordByteEnds.push(segmentBytes);
      expectedRevision += 1;
    }

    segments.push({
      file,
      startRevision: fileStartRevision,
      endRevision: lines.length > 0 ? expectedRevision - 1 : fileStartRevision - 1,
      recordCount: lines.length,
      bytes: retainedBuffer.length,
      recordByteEnds
    });
  }

  return {
    events,
    segments,
    baseRevision,
    checksums,
    incompleteTail
  };
}

function readTestRecoveryJournalByteBudget(): number | undefined {
  const rawValue = process.env[TEST_RECOVERY_MAX_JOURNAL_BYTES_ENV]?.trim();
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function validateManifestPrefix(manifest: TerminalJournalManifest, scanned: ScannedTerminalJournal): void {
  const lastChecksumIndex = manifest.lastRevision - scanned.baseRevision;
  if (lastChecksumIndex < 0 || lastChecksumIndex >= scanned.checksums.length) {
    throw new Error(`Terminal journal manifest tail mismatch for session ${manifest.sessionId}.`);
  }
  if (scanned.checksums[lastChecksumIndex] !== manifest.lastChecksum) {
    throw new Error(`Terminal journal manifest checksum mismatch for session ${manifest.sessionId}.`);
  }

  let expectedManifestRevision = scanned.baseRevision + 1;
  for (let index = 0; index < manifest.segments.length; index += 1) {
    const manifestSegment = manifest.segments[index];
    const scannedSegment = scanned.segments[index];
    if (
      !scannedSegment ||
      scannedSegment.file !== manifestSegment.file ||
      manifestSegment.startRevision !== expectedManifestRevision ||
      manifestSegment.recordCount > scannedSegment.recordCount
    ) {
      throw new Error(`Terminal journal segment manifest mismatch for session ${manifest.sessionId}.`);
    }

    const expectedEndRevision = manifestSegment.startRevision + manifestSegment.recordCount - 1;
    const expectedBytes =
      manifestSegment.recordCount === 0
        ? 0
        : scannedSegment.recordByteEnds[manifestSegment.recordCount - 1];
    if (manifestSegment.endRevision !== expectedEndRevision || manifestSegment.bytes !== expectedBytes) {
      throw new Error(`Terminal journal segment ${manifestSegment.file} manifest prefix mismatch.`);
    }
    expectedManifestRevision += manifestSegment.recordCount;
    if (manifestSegment.recordCount === 0 && index !== manifest.segments.length - 1) {
      throw new Error(`Terminal journal segment ${manifestSegment.file} is unexpectedly empty.`);
    }
  }

  if (manifest.lastRevision !== expectedManifestRevision - 1) {
    throw new Error(`Terminal journal manifest revision mismatch for session ${manifest.sessionId}.`);
  }
}

function createManifestFromScan(
  manifest: TerminalJournalManifest,
  scanned: ScannedTerminalJournal
): TerminalJournalManifest {
  const recentOutput = manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
    ? scanned.events.reduce(
        (tail, event) =>
          event.revision > manifest.lastRevision && event.type === 'output'
            ? appendRecentOutput(tail, event.data)
            : tail,
        manifest.recentOutput
      )
    : undefined;
  const manifestWithoutChecksum = {
    sessionId: manifest.sessionId,
    authorityId: manifest.authorityId,
    createdAtMs: manifest.createdAtMs,
    initialCols: manifest.initialCols,
    initialRows: manifest.initialRows,
    initialScrollback: manifest.initialScrollback,
    lastRevision: scanned.baseRevision + scanned.events.length,
    lastChecksum: scanned.checksums[scanned.events.length],
    segments: scanned.segments.map(({ recordByteEnds: _recordByteEnds, ...segment }) => segment)
  };
  return manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2
    ? createTerminalJournalManifestV2({
        ...manifestWithoutChecksum,
        retainedStartRevision: manifest.retainedStartRevision,
        retainedPreviousChecksum: manifest.retainedPreviousChecksum,
        currentCheckpoint: manifest.currentCheckpoint,
        previousCheckpoint: manifest.previousCheckpoint,
        recentOutput: recentOutput ?? ''
      })
    : createTerminalJournalManifestV1(manifestWithoutChecksum);
}

async function writeTerminalJournalManifest(
  manifestPath: string,
  manifest: TerminalJournalManifest
): Promise<void> {
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFileWithOptionalSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, true);
  await fs.promises.rename(temporaryPath, manifestPath);
  await fsyncDirectory(path.dirname(manifestPath));
}

export function resolveTerminalJournalSessionDirectory(storageDir: string, sessionId: string): string {
  const directoryName = createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
  return path.join(storageDir, TERMINAL_JOURNAL_ROOT_DIRECTORY, directoryName);
}

/**
 * Reads only the manifest plus filesystem metadata. Recovery uses this to retain an audit trail
 * for a dead PTY without parsing or retaining its unbounded event stream.
 */
export async function readTerminalSessionJournalMetadata(
  storageDir: string,
  sessionId: string,
  expectedAuthorityId?: string
): Promise<TerminalSessionJournalMetadata> {
  const sessionDirectory = resolveTerminalJournalSessionDirectory(storageDir, sessionId);
  const manifestPath = path.join(sessionDirectory, TERMINAL_JOURNAL_MANIFEST_FILE);
  const manifestStats = await fs.promises.stat(manifestPath);
  if (manifestStats.size > MAX_TERMINAL_JOURNAL_METADATA_MANIFEST_BYTES) {
    throw new Error(
      `Terminal journal manifest exceeds the ${MAX_TERMINAL_JOURNAL_METADATA_MANIFEST_BYTES}-byte recovery metadata budget for session ${sessionId}.`
    );
  }

  const manifest = normalizeManifest(JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')));
  if (!manifest || manifest.sessionId !== sessionId) {
    throw new Error(`Invalid terminal journal manifest for session ${sessionId}.`);
  }
  if (expectedAuthorityId && manifest.authorityId !== expectedAuthorityId) {
    throw new Error(`Terminal journal authority mismatch for session ${sessionId}.`);
  }
  if (manifest.segments.length > MAX_TERMINAL_JOURNAL_METADATA_SEGMENT_COUNT) {
    throw new Error(
      `Terminal journal segment count exceeds the ${MAX_TERMINAL_JOURNAL_METADATA_SEGMENT_COUNT}-segment recovery metadata budget for session ${sessionId}.`
    );
  }

  let segmentBytes = 0;
  for (const segment of manifest.segments) {
    const stats = await fs.promises.stat(path.join(sessionDirectory, segment.file));
    if (!stats.isFile()) {
      throw new Error(`Terminal journal segment ${segment.file} is not a regular file.`);
    }
    segmentBytes += stats.size;
  }

  return {
    sessionId: manifest.sessionId,
    authorityId: manifest.authorityId,
    version: manifest.version,
    lastRevision: manifest.lastRevision,
    retainedStartRevision:
      manifest.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V2 ? manifest.retainedStartRevision : 1,
    segmentCount: manifest.segments.length,
    segmentBytes,
    manifestBytes: manifestStats.size
  };
}

function createStoredTerminalJournalRecord(
  sessionId: string,
  authorityId: string,
  previousChecksum: string,
  event: TerminalStreamEvent
): StoredTerminalJournalRecord {
  const recordWithoutChecksum = {
    version: TERMINAL_SESSION_STREAM_VERSION,
    sessionId,
    authorityId,
    previousChecksum,
    ...event
  };
  return {
    ...recordWithoutChecksum,
    checksum: checksumJson(recordWithoutChecksum)
  } as StoredTerminalJournalRecord;
}

function normalizeStoredTerminalJournalRecord(value: unknown): StoredTerminalJournalRecord | undefined {
  if (!isRecord(value) || value.version !== TERMINAL_SESSION_STREAM_VERSION) {
    return undefined;
  }
  const event = normalizeTerminalStreamEvent(value);
  if (
    !event ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    typeof value.authorityId !== 'string' ||
    !value.authorityId ||
    !isChecksum(value.previousChecksum) ||
    !isChecksum(value.checksum)
  ) {
    return undefined;
  }
  return {
    version: TERMINAL_SESSION_STREAM_VERSION,
    sessionId: value.sessionId,
    authorityId: value.authorityId,
    previousChecksum: value.previousChecksum,
    checksum: value.checksum,
    ...event
  } as StoredTerminalJournalRecord;
}

function checksumStoredTerminalJournalRecord(record: StoredTerminalJournalRecord): string {
  const { checksum: _checksum, ...recordWithoutChecksum } = record;
  return checksumJson(recordWithoutChecksum);
}

function normalizeManifest(value: unknown): TerminalJournalManifest | undefined {
  if (
    !isRecord(value) ||
    (value.version !== TERMINAL_JOURNAL_MANIFEST_VERSION_V1 &&
      value.version !== TERMINAL_JOURNAL_MANIFEST_VERSION_V2)
  ) {
    return undefined;
  }
  if (
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    typeof value.authorityId !== 'string' ||
    !value.authorityId ||
    !isNonNegativeInteger(value.createdAtMs) ||
    !isPositiveInteger(value.initialCols) ||
    !isPositiveInteger(value.initialRows) ||
    !isNonNegativeInteger(value.initialScrollback) ||
    !isNonNegativeInteger(value.lastRevision) ||
    !isChecksum(value.lastChecksum) ||
    !Array.isArray(value.segments) ||
    !isChecksum(value.checksum)
  ) {
    return undefined;
  }
  const segments = value.segments.map(normalizeSegmentManifest);
  if (segments.some((segment) => !segment)) {
    return undefined;
  }
  const common = {
    sessionId: value.sessionId,
    authorityId: value.authorityId,
    createdAtMs: value.createdAtMs,
    initialCols: value.initialCols,
    initialRows: value.initialRows,
    initialScrollback: value.initialScrollback,
    lastRevision: value.lastRevision,
    lastChecksum: value.lastChecksum,
    segments: segments as TerminalJournalSegmentManifest[]
  };
  if (value.version === TERMINAL_JOURNAL_MANIFEST_VERSION_V1) {
    const manifest = createTerminalJournalManifestV1(common);
    return manifest.checksum === value.checksum ? manifest : undefined;
  }

  const currentCheckpoint = normalizeCheckpointReference(value.currentCheckpoint);
  const previousCheckpoint = value.previousCheckpoint === undefined
    ? undefined
    : normalizeCheckpointReference(value.previousCheckpoint);
  if (
    !isPositiveInteger(value.retainedStartRevision) ||
    !isChecksum(value.retainedPreviousChecksum) ||
    !currentCheckpoint ||
    (value.previousCheckpoint !== undefined && !previousCheckpoint) ||
    typeof value.recentOutput !== 'string' ||
    value.recentOutput.length > TERMINAL_JOURNAL_RECENT_OUTPUT_LIMIT ||
    value.retainedStartRevision > value.lastRevision + 1 ||
    currentCheckpoint.revision > value.lastRevision ||
    (previousCheckpoint && previousCheckpoint.revision >= currentCheckpoint.revision) ||
    (!previousCheckpoint && value.retainedStartRevision !== 1) ||
    (previousCheckpoint && value.retainedStartRevision - 1 > previousCheckpoint.revision)
  ) {
    return undefined;
  }
  const manifest = createTerminalJournalManifestV2({
    ...common,
    retainedStartRevision: value.retainedStartRevision,
    retainedPreviousChecksum: value.retainedPreviousChecksum,
    currentCheckpoint,
    previousCheckpoint,
    recentOutput: value.recentOutput
  });
  return manifest.checksum === value.checksum ? manifest : undefined;
}

function createTerminalJournalManifestV1(
  fields: Omit<TerminalJournalManifestV1, 'version' | 'checksum'>
): TerminalJournalManifestV1 {
  const manifestWithoutChecksum = {
    version: TERMINAL_JOURNAL_MANIFEST_VERSION_V1,
    sessionId: fields.sessionId,
    authorityId: fields.authorityId,
    createdAtMs: fields.createdAtMs,
    initialCols: fields.initialCols,
    initialRows: fields.initialRows,
    initialScrollback: fields.initialScrollback,
    lastRevision: fields.lastRevision,
    lastChecksum: fields.lastChecksum,
    segments: fields.segments.map(cloneSegmentManifest)
  };
  return {
    ...manifestWithoutChecksum,
    checksum: checksumJson(manifestWithoutChecksum)
  };
}

function createTerminalJournalManifestV2(
  fields: Omit<TerminalJournalManifestV2, 'version' | 'checksum'>
): TerminalJournalManifestV2 {
  const manifestWithoutChecksum = {
    version: TERMINAL_JOURNAL_MANIFEST_VERSION_V2,
    sessionId: fields.sessionId,
    authorityId: fields.authorityId,
    createdAtMs: fields.createdAtMs,
    initialCols: fields.initialCols,
    initialRows: fields.initialRows,
    initialScrollback: fields.initialScrollback,
    lastRevision: fields.lastRevision,
    lastChecksum: fields.lastChecksum,
    retainedStartRevision: fields.retainedStartRevision,
    retainedPreviousChecksum: fields.retainedPreviousChecksum,
    currentCheckpoint: cloneCheckpointReference(fields.currentCheckpoint),
    ...(fields.previousCheckpoint
      ? { previousCheckpoint: cloneCheckpointReference(fields.previousCheckpoint) }
      : {}),
    recentOutput: fields.recentOutput,
    segments: fields.segments.map(cloneSegmentManifest)
  };
  return {
    ...manifestWithoutChecksum,
    checksum: checksumJson(manifestWithoutChecksum)
  };
}

function normalizeCheckpointReference(value: unknown): TerminalJournalCheckpointReference | undefined {
  if (
    !isRecord(value) ||
    typeof value.file !== 'string' ||
    !TERMINAL_JOURNAL_CHECKPOINT_PATTERN.test(value.file) ||
    !isNonNegativeInteger(value.revision) ||
    !isChecksum(value.journalChecksum) ||
    !isCheckpointProfileComponent(value.codecId) ||
    !isCheckpointProfileComponent(value.producerProfile) ||
    !isChecksum(value.envelopeChecksum)
  ) {
    return undefined;
  }
  const match = TERMINAL_JOURNAL_CHECKPOINT_PATTERN.exec(value.file);
  if (!match || Number.parseInt(match[1], 10) !== value.revision) {
    return undefined;
  }
  return {
    file: value.file,
    revision: value.revision,
    journalChecksum: value.journalChecksum,
    codecId: value.codecId,
    producerProfile: value.producerProfile,
    envelopeChecksum: value.envelopeChecksum
  };
}

function cloneCheckpointReference(
  reference: TerminalJournalCheckpointReference
): TerminalJournalCheckpointReference {
  return { ...reference };
}

function sameCheckpointReference(
  left: TerminalJournalCheckpointReference,
  right: TerminalJournalCheckpointReference
): boolean {
  return (
    left.file === right.file &&
    left.revision === right.revision &&
    left.journalChecksum === right.journalChecksum &&
    left.codecId === right.codecId &&
    left.producerProfile === right.producerProfile &&
    left.envelopeChecksum === right.envelopeChecksum
  );
}

function sameOptionalCheckpointReference(
  left: TerminalJournalCheckpointReference | undefined,
  right: TerminalJournalCheckpointReference | undefined
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : sameCheckpointReference(left, right);
}

async function writeTerminalJournalCheckpoint(
  sessionDirectory: string,
  sessionId: string,
  authorityId: string,
  journalChecksum: string,
  checkpointProfiles: Readonly<Record<string, string>>,
  outputTail: string,
  checkpoint: TerminalStreamCheckpoint
): Promise<TerminalJournalCheckpointReference> {
  const checkpointCopy = cloneTerminalStreamCheckpoint(checkpoint);
  const codecId = checkpointCopy.serializedState.format;
  const producerProfile = checkpointProfiles[codecId];
  if (!isCheckpointProfileComponent(producerProfile)) {
    throw new Error(`No terminal journal checkpoint producer profile is registered for codec ${codecId}.`);
  }
  const envelopeWithoutChecksum = {
    version: TERMINAL_JOURNAL_CHECKPOINT_ENVELOPE_VERSION,
    sessionId,
    authorityId,
    revision: checkpointCopy.revision,
    journalChecksum,
    codecId,
    producerProfile,
    outputTail,
    checkpoint: checkpointCopy
  };
  const envelope: TerminalJournalCheckpointEnvelope = {
    ...envelopeWithoutChecksum,
    checksum: checksumJson(envelopeWithoutChecksum)
  };
  const file = `checkpoint-${String(checkpointCopy.revision).padStart(16, '0')}-${randomUUID()}.json`;
  const finalPath = path.join(sessionDirectory, file);
  const temporaryPath = `${finalPath}.${process.pid}.tmp`;
  await writeFileWithOptionalSync(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, true);
  await fs.promises.rename(temporaryPath, finalPath);
  await fsyncDirectory(sessionDirectory);

  const reference = {
    file,
    revision: checkpointCopy.revision,
    journalChecksum,
    codecId,
    producerProfile,
    envelopeChecksum: envelope.checksum
  };
  const verified = await readTerminalJournalCheckpoint(
    sessionDirectory,
    sessionId,
    authorityId,
    reference
  );
  if (!verified) {
    throw new Error(`Could not verify terminal journal checkpoint ${file}.`);
  }
  return reference;
}

async function readTerminalJournalCheckpoint(
  sessionDirectory: string,
  sessionId: string,
  authorityId: string,
  reference: TerminalJournalCheckpointReference
): Promise<StoredTerminalJournalCheckpoint | undefined> {
  try {
    const value: unknown = JSON.parse(
      await fs.promises.readFile(path.join(sessionDirectory, reference.file), 'utf8')
    );
    if (
      !isRecord(value) ||
      value.version !== TERMINAL_JOURNAL_CHECKPOINT_ENVELOPE_VERSION ||
      value.sessionId !== sessionId ||
      value.authorityId !== authorityId ||
      value.revision !== reference.revision ||
      value.journalChecksum !== reference.journalChecksum ||
      value.codecId !== reference.codecId ||
      value.producerProfile !== reference.producerProfile ||
      value.checksum !== reference.envelopeChecksum ||
      typeof value.outputTail !== 'string' ||
      value.outputTail.length > TERMINAL_JOURNAL_RECENT_OUTPUT_LIMIT ||
      !isChecksum(value.journalChecksum) ||
      !isCheckpointProfileComponent(value.codecId) ||
      !isCheckpointProfileComponent(value.producerProfile) ||
      !isChecksum(value.checksum)
    ) {
      return undefined;
    }
    const checkpoint = normalizeTerminalStreamCheckpoint(value.checkpoint);
    if (
      !checkpoint ||
      checkpoint.sessionId !== sessionId ||
      checkpoint.authorityId !== authorityId ||
      checkpoint.revision !== reference.revision ||
      checkpoint.serializedState.format !== reference.codecId
    ) {
      return undefined;
    }
    const envelopeWithoutChecksum = {
      version: TERMINAL_JOURNAL_CHECKPOINT_ENVELOPE_VERSION,
      sessionId,
      authorityId,
      revision: reference.revision,
      journalChecksum: reference.journalChecksum,
      codecId: reference.codecId,
      producerProfile: reference.producerProfile,
      outputTail: value.outputTail,
      checkpoint
    };
    return checksumJson(envelopeWithoutChecksum) === value.checksum
      ? { checkpoint, outputTail: value.outputTail }
      : undefined;
  } catch {
    return undefined;
  }
}

async function syncTerminalJournalSegments(
  sessionDirectory: string,
  segments: readonly TerminalJournalSegmentManifest[]
): Promise<void> {
  for (const segment of segments) {
    const handle = await fs.promises.open(path.join(sessionDirectory, segment.file), 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

async function cleanupUnreferencedJournalFiles(
  sessionDirectory: string,
  retainedSegments: readonly TerminalJournalSegmentManifest[],
  retainedCheckpoints: readonly (TerminalJournalCheckpointReference | undefined)[]
): Promise<void> {
  const retainedFiles = new Set([
    ...retainedSegments.map((segment) => segment.file),
    ...retainedCheckpoints.flatMap((checkpoint) => checkpoint ? [checkpoint.file] : [])
  ]);
  const fileNames = await fs.promises.readdir(sessionDirectory).catch(() => []);
  await Promise.all(fileNames.map(async (fileName) => {
    if (
      retainedFiles.has(fileName) ||
      (!TERMINAL_JOURNAL_SEGMENT_PATTERN.test(fileName) &&
        !TERMINAL_JOURNAL_CHECKPOINT_PATTERN.test(fileName))
    ) {
      return;
    }
    await fs.promises.rm(path.join(sessionDirectory, fileName), { force: true }).catch(() => undefined);
  }));
}

function checksumAtScannedRevision(
  journal: Pick<VerifiedTerminalJournal, 'baseRevision' | 'checksums'>,
  revision: number
): string | undefined {
  const index = revision - journal.baseRevision;
  return index >= 0 ? journal.checksums[index] : undefined;
}

function getSegmentStartRevision(fileName: string): number {
  const match = TERMINAL_JOURNAL_SEGMENT_PATTERN.exec(fileName);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

async function writeFileWithOptionalSync(filePath: string, data: string, durable: boolean): Promise<void> {
  if (!durable) {
    await fs.promises.writeFile(filePath, data, { encoding: 'utf8', mode: 0o600 });
    return;
  }
  const handle = await fs.promises.open(filePath, 'w', 0o600);
  try {
    await handle.writeFile(data, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(directoryPath: string): Promise<void> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(directoryPath, 'r');
    await handle.sync();
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
    if (process.platform === 'win32' && (code === 'EINVAL' || code === 'ENOTSUP' || code === 'EPERM')) {
      return;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function normalizeSegmentManifest(value: unknown): TerminalJournalSegmentManifest | undefined {
  if (
    !isRecord(value) ||
    typeof value.file !== 'string' ||
    !TERMINAL_JOURNAL_SEGMENT_PATTERN.test(value.file) ||
    !isPositiveInteger(value.startRevision) ||
    !isNonNegativeInteger(value.endRevision) ||
    !isNonNegativeInteger(value.recordCount) ||
    !isNonNegativeInteger(value.bytes)
  ) {
    return undefined;
  }
  return {
    file: value.file,
    startRevision: value.startRevision,
    endRevision: value.endRevision,
    recordCount: value.recordCount,
    bytes: value.bytes
  };
}

function cloneSegmentManifest(segment: TerminalJournalSegmentManifest): TerminalJournalSegmentManifest {
  return { ...segment };
}

function createSegmentFileName(startRevision: number): string {
  return `segment-${String(startRevision).padStart(16, '0')}.ndjson`;
}

function checksumJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function appendRecentOutput(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length > TERMINAL_JOURNAL_RECENT_OUTPUT_LIMIT
    ? combined.slice(-TERMINAL_JOURNAL_RECENT_OUTPUT_LIMIT)
    : combined;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return isNonNegativeInteger(value) ? value : fallback;
}

function normalizeCheckpointProfiles(
  value: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> {
  const profiles: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [codecId, producerProfile] of Object.entries(value ?? {})) {
    if (isCheckpointProfileComponent(codecId) && isCheckpointProfileComponent(producerProfile)) {
      profiles[codecId] = producerProfile;
    }
  }
  return Object.freeze(profiles);
}

function isCheckpointProfileComponent(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value
  );
}

function isChecksum(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
