import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  TERMINAL_SESSION_STREAM_VERSION,
  cloneTerminalStreamEvent,
  normalizeTerminalStreamEvent,
  type TerminalStreamEvent,
  type TerminalStreamOutputEvent,
  type TerminalStreamResizeEvent,
  type TerminalStreamScrollbackEvent
} from '../common/terminalSessionStream';

const TERMINAL_JOURNAL_MANIFEST_VERSION = 1 as const;
const TERMINAL_JOURNAL_ROOT_DIRECTORY = 'terminal-journals';
const TERMINAL_JOURNAL_MANIFEST_FILE = 'manifest.json';
const TERMINAL_JOURNAL_SEGMENT_PATTERN = /^segment-(\d{16})\.ndjson$/u;
const TERMINAL_JOURNAL_GENESIS_CHECKSUM = '0'.repeat(64);
const DEFAULT_TERMINAL_JOURNAL_SEGMENT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TERMINAL_JOURNAL_FLUSH_DELAY_MS = 16;

interface TerminalJournalSegmentManifest {
  file: string;
  startRevision: number;
  endRevision: number;
  recordCount: number;
  bytes: number;
}

export interface TerminalJournalManifest {
  version: typeof TERMINAL_JOURNAL_MANIFEST_VERSION;
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
}

interface ScannedTerminalJournalSegment extends TerminalJournalSegmentManifest {
  recordByteEnds: number[];
}

interface ScannedTerminalJournal {
  events: TerminalStreamEvent[];
  segments: ScannedTerminalJournalSegment[];
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
}

export interface TerminalSessionJournalOpenOptions {
  storageDir: string;
  sessionId: string;
  authorityId?: string;
  segmentMaxBytes?: number;
  flushDelayMs?: number;
}

export class TerminalSessionJournal {
  private readonly sessionDirectory: string;
  private readonly manifestPath: string;
  private readonly segmentMaxBytes: number;
  private readonly flushDelayMs: number;
  private readonly events: TerminalStreamEvent[];
  private readonly segments: TerminalJournalSegmentManifest[];
  private readonly pendingWrites = new Map<string, string[]>();
  private writeChain: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | undefined;
  private writeError: Error | undefined;
  private lastRevision: number;
  private lastChecksum: string;
  private manifestWriteSequence = 0;

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
    options: { segmentMaxBytes?: number; flushDelayMs?: number } = {}
  ) {
    this.sessionDirectory = resolveTerminalJournalSessionDirectory(storageDir, sessionId);
    this.manifestPath = path.join(this.sessionDirectory, TERMINAL_JOURNAL_MANIFEST_FILE);
    this.segmentMaxBytes = normalizePositiveInteger(
      options.segmentMaxBytes,
      DEFAULT_TERMINAL_JOURNAL_SEGMENT_MAX_BYTES
    );
    this.flushDelayMs = normalizePositiveInteger(options.flushDelayMs, DEFAULT_TERMINAL_JOURNAL_FLUSH_DELAY_MS);
    this.events = events;
    this.segments = segments;
    this.lastRevision = lastRevision;
    this.lastChecksum = lastChecksum;
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
    await journal.writeManifest(journal.createManifestSnapshot());
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
      options
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
    let removeCount = 0;
    while (removeCount < this.events.length && this.events[removeCount].revision <= revision) {
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
    this.lastRevision = normalizedEvent.revision;
    this.lastChecksum = storedRecord.checksum;
    this.scheduleFlush();
    return cloneTerminalStreamEvent(normalizedEvent);
  }

  private selectSegment(revision: number, lineBytes: number): TerminalJournalSegmentManifest {
    const current = this.segments[this.segments.length - 1];
    if (current && (current.recordCount === 0 || current.bytes + lineBytes <= this.segmentMaxBytes)) {
      return current;
    }

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
    const manifestWithoutChecksum = {
      version: TERMINAL_JOURNAL_MANIFEST_VERSION,
      sessionId: this.sessionId,
      authorityId: this.authorityId,
      createdAtMs: this.createdAtMs,
      initialCols: this.initialCols,
      initialRows: this.initialRows,
      initialScrollback: this.initialScrollback,
      lastRevision: this.lastRevision,
      lastChecksum: this.lastChecksum,
      segments: this.segments.map(cloneSegmentManifest)
    };
    return {
      ...manifestWithoutChecksum,
      checksum: checksumJson(manifestWithoutChecksum)
    };
  }

  private async writeManifest(manifest: TerminalJournalManifest): Promise<void> {
    const writeSequence = ++this.manifestWriteSequence;
    const temporaryPath = `${this.manifestPath}.${process.pid}.${writeSequence}.tmp`;
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.promises.rename(temporaryPath, this.manifestPath);
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

  const fileNames = (await fs.promises.readdir(sessionDirectory))
    .filter((fileName) => TERMINAL_JOURNAL_SEGMENT_PATTERN.test(fileName))
    .sort();
  const scanned = await scanTerminalJournalSegments(
    sessionDirectory,
    sessionId,
    manifest.authorityId,
    fileNames,
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
    events: scanned.events
  };
}

async function scanTerminalJournalSegments(
  sessionDirectory: string,
  sessionId: string,
  authorityId: string,
  fileNames: readonly string[],
  allowIncompleteTail: boolean
): Promise<ScannedTerminalJournal> {
  const events: TerminalStreamEvent[] = [];
  const segments: ScannedTerminalJournalSegment[] = [];
  const checksums = [TERMINAL_JOURNAL_GENESIS_CHECKSUM];
  let expectedRevision = 1;
  let previousChecksum = TERMINAL_JOURNAL_GENESIS_CHECKSUM;
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
    checksums,
    incompleteTail
  };
}

function validateManifestPrefix(manifest: TerminalJournalManifest, scanned: ScannedTerminalJournal): void {
  if (manifest.lastRevision >= scanned.checksums.length) {
    throw new Error(`Terminal journal manifest tail mismatch for session ${manifest.sessionId}.`);
  }
  if (scanned.checksums[manifest.lastRevision] !== manifest.lastChecksum) {
    throw new Error(`Terminal journal manifest checksum mismatch for session ${manifest.sessionId}.`);
  }

  let expectedManifestRevision = 1;
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
  const manifestWithoutChecksum = {
    version: TERMINAL_JOURNAL_MANIFEST_VERSION,
    sessionId: manifest.sessionId,
    authorityId: manifest.authorityId,
    createdAtMs: manifest.createdAtMs,
    initialCols: manifest.initialCols,
    initialRows: manifest.initialRows,
    initialScrollback: manifest.initialScrollback,
    lastRevision: scanned.events.length,
    lastChecksum: scanned.checksums[scanned.events.length],
    segments: scanned.segments.map(({ recordByteEnds: _recordByteEnds, ...segment }) => segment)
  };
  return {
    ...manifestWithoutChecksum,
    checksum: checksumJson(manifestWithoutChecksum)
  };
}

async function writeTerminalJournalManifest(
  manifestPath: string,
  manifest: TerminalJournalManifest
): Promise<void> {
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await fs.promises.rename(temporaryPath, manifestPath);
}

export function resolveTerminalJournalSessionDirectory(storageDir: string, sessionId: string): string {
  const directoryName = createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
  return path.join(storageDir, TERMINAL_JOURNAL_ROOT_DIRECTORY, directoryName);
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
  if (!isRecord(value) || value.version !== TERMINAL_JOURNAL_MANIFEST_VERSION) {
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
  const manifestWithoutChecksum = {
    version: TERMINAL_JOURNAL_MANIFEST_VERSION,
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
  if (checksumJson(manifestWithoutChecksum) !== value.checksum) {
    return undefined;
  }
  return {
    ...manifestWithoutChecksum,
    checksum: value.checksum
  };
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

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
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
