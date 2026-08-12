import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
  COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC,
  COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION,
  createCompletedTerminalHistoryArchiveId,
  normalizeCompletedTerminalHistoryArchiveDescriptor,
  type CompletedTerminalHistoryArchiveDescriptor
} from '../common/terminalHistoryArchive';
import {
  TERMINAL_SESSION_STREAM_VERSION,
  normalizeTerminalStreamAttachPayload,
  normalizeTerminalStreamAttachPayloadAsync,
  type TerminalStreamCheckpoint,
  type TerminalStreamEvent,
  type TerminalStreamAttachPayload
} from '../common/terminalSessionStream';
import {
  RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MAX_CREDIT_BYTES,
  RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MIN_CREDIT_BYTES,
  type RuntimeSupervisorOpenTerminalProjectionResult,
  type RuntimeSupervisorReadTerminalProjectionResult,
  type RuntimeSupervisorTerminalProjectionCheckpointDescriptor,
  type RuntimeSupervisorTerminalProjectionChunk
} from '../common/runtimeSupervisorProtocol';

export const COMPLETED_TERMINAL_HISTORY_ARCHIVE_ROOT_DIRECTORY = 'completed-terminal-history';
const COMPLETED_TERMINAL_HISTORY_ARCHIVE_BLOB_DIRECTORY = 'blobs';
const COMPLETED_TERMINAL_HISTORY_ARCHIVE_PAYLOAD_FILE = 'payload.json';
const COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_FILE = 'projection.ndjson';
const ARCHIVE_PROJECTION_RECORD_MAX_CHARS = 32 * 1024;
const ARCHIVE_PROJECTION_LINE_MAX_BYTES = 256 * 1024;
const ARCHIVE_PROJECTION_CHECKPOINT_DATA_MAX_CHARS = 5 * 1024 * 1024;
const ARCHIVE_PROJECTION_SERIALIZED_STATE_FORMAT = 'xterm-serialize-v1';
const ARCHIVE_MATERIALIZATION_BATCH_BYTES = 128 * 1024;
const ARCHIVE_MATERIALIZATION_TEXT_BUFFER_MAX_CHARS = 16 * 1024;

export type CompletedTerminalHistoryArchiveErrorCode =
  | 'invalid-payload'
  | 'invalid-descriptor'
  | 'archive-not-found'
  | 'archive-corrupt'
  | 'archive-io';

export class CompletedTerminalHistoryArchiveError extends Error {
  public constructor(
    public readonly code: CompletedTerminalHistoryArchiveErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'CompletedTerminalHistoryArchiveError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

interface PreparedCompletedTerminalHistoryArchive {
  descriptor: CompletedTerminalHistoryArchiveDescriptor;
  bytes: Buffer;
  projectionBytes: Buffer;
}

export interface CompletedTerminalHistoryArchiveProjectionRead {
  /** Credit granted to the source for this exact pull. */
  creditBytes: number;
  result: RuntimeSupervisorReadTerminalProjectionResult;
}

/**
 * One-shot fixed projection source. `open()` is intentionally lazy: the Store
 * calls it only after the global archive write admission has been granted.
 */
export interface CompletedTerminalHistoryArchiveProjectionSource {
  open(): Promise<RuntimeSupervisorOpenTerminalProjectionResult>;
  read(
    opened: RuntimeSupervisorOpenTerminalProjectionResult
  ): AsyncIterable<CompletedTerminalHistoryArchiveProjectionRead>;
  /** Releases a server-side projection when validation or durable commit fails. */
  cancel?(opened: RuntimeSupervisorOpenTerminalProjectionResult): Promise<void>;
}

export interface CompletedTerminalHistoryArchiveProjectionHeader {
  kind: 'header';
  codec: typeof COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC;
  archiveId: string;
  sha256: string;
  byteLength: number;
  sessionId: string;
  authorityId: string;
  finalRevision: number;
  checkpoint: Omit<TerminalStreamCheckpoint, 'serializedState'> & {
    serializedState: Omit<TerminalStreamCheckpoint['serializedState'], 'data'>;
    checkpointDataLength: number;
  };
}

export type CompletedTerminalHistoryArchiveProjectionRecord =
  | CompletedTerminalHistoryArchiveProjectionHeader
  | {
      kind: 'checkpoint';
      dataOffset: number;
      data: string;
      complete: boolean;
    }
  | {
      kind: 'output';
      revision: number;
      createdAtMs: number;
      dataOffset: number;
      data: string;
      complete: boolean;
    }
  | {
      kind: 'resize';
      revision: number;
      createdAtMs: number;
      cols: number;
      rows: number;
      complete: true;
    }
  | {
      kind: 'scrollback';
      revision: number;
      createdAtMs: number;
      scrollback: number;
      complete: true;
    }
  | { kind: 'done' };

export class CompletedTerminalHistoryArchiveStore {
  private readonly archiveRootPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(extensionStoragePath: string) {
    if (!extensionStoragePath.trim()) {
      throw new TypeError('Completed terminal history archive storage path must not be empty.');
    }
    this.archiveRootPath = path.join(
      path.normalize(extensionStoragePath),
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_ROOT_DIRECTORY,
      `v${COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION}`
    );
  }

  /** Pure path projection; constructing a store and inspecting descriptors never opens a blob. */
  public getArchiveRootPath(): string {
    return this.archiveRootPath;
  }

  /** Computes the immutable ref without creating directories or reading archive storage. */
  public describe(payload: TerminalStreamAttachPayload): CompletedTerminalHistoryArchiveDescriptor {
    return this.describeCanonical(payload);
  }

  /**
   * Computes only the canonical content address. Migration checks use this
   * form so they do not materialize a second projection sidecar for every
   * comparison; `write()` remains the operation that prepares the sidecar.
   */
  public describeCanonical(payloadValue: TerminalStreamAttachPayload): CompletedTerminalHistoryArchiveDescriptor {
    const payload = normalizeTerminalStreamAttachPayload(payloadValue);
    if (!payload) {
      throw new CompletedTerminalHistoryArchiveError(
        'invalid-payload',
        'Completed terminal history archive payload is invalid.'
      );
    }
    const bytes = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      version: COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION,
      archiveId: createCompletedTerminalHistoryArchiveId(sha256),
      codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
      sessionId: payload.sessionId,
      authorityId: payload.authorityId,
      finalRevision: payload.revision,
      byteLength: bytes.byteLength,
      sha256
    };
  }

  /**
   * Asynchronous canonical descriptor calculation for migration scans. It
   * keeps the synchronous `describe()` API for existing callers while giving
   * Host code a path that yields before walking a large terminal history.
   */
  public async describeAsync(
    payloadValue: TerminalStreamAttachPayload
  ): Promise<CompletedTerminalHistoryArchiveDescriptor> {
    await yieldArchiveMaterialization();
    const payload = await normalizeTerminalStreamAttachPayloadAsync(payloadValue);
    if (!payload) {
      throw new CompletedTerminalHistoryArchiveError(
        'invalid-payload',
        'Completed terminal history archive payload is invalid.'
      );
    }
    const bytes = await buildCanonicalPayloadBytes(payload);
    const sha256 = await hashArchiveBytes(bytes);
    return {
      version: COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION,
      archiveId: createCompletedTerminalHistoryArchiveId(sha256),
      codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
      sessionId: payload.sessionId,
      authorityId: payload.authorityId,
      finalRevision: payload.revision,
      byteLength: bytes.byteLength,
      sha256
    };
  }

  /** Resolves a validated ref without checking whether its blob exists. */
  public resolveArchiveFilePath(descriptorValue: unknown): string {
    const descriptor = requireDescriptor(descriptorValue);
    return this.resolveArchiveFilePathForDescriptor(descriptor);
  }

  /** Resolves the optional bounded projection sidecar without opening it. */
  public resolveArchiveProjectionFilePath(descriptorValue: unknown): string | undefined {
    const descriptor = requireDescriptor(descriptorValue);
    if (descriptor.projectionCodec !== COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC) {
      return undefined;
    }
    return this.resolveArchiveProjectionFilePathForDescriptor(descriptor);
  }

  public async write(
    payload: TerminalStreamAttachPayload
  ): Promise<CompletedTerminalHistoryArchiveDescriptor> {
    return this.enqueueWrite(async () => {
      const prepared = await this.prepare(payload);
      return this.commitPreparedArchive(prepared);
    });
  }

  /**
   * Archives a fixed Supervisor projection without materializing its complete
   * checkpoint, event array, canonical JSON, or sidecar in memory.
   */
  public async writeProjectionStream(
    source: CompletedTerminalHistoryArchiveProjectionSource
  ): Promise<CompletedTerminalHistoryArchiveDescriptor> {
    if (!source || typeof source.open !== 'function' || typeof source.read !== 'function') {
      throw new CompletedTerminalHistoryArchiveError(
        'invalid-payload',
        'Completed terminal history projection source is invalid.'
      );
    }
    return this.enqueueWrite(async () => {
      let opened: RuntimeSupervisorOpenTerminalProjectionResult | undefined;
      let committed = false;
      try {
        opened = await source.open();
        const descriptor = await this.materializeAndCommitProjectionStream(
          opened,
          source.read(opened)
        );
        committed = true;
        return descriptor;
      } catch (error) {
        if (error instanceof CompletedTerminalHistoryArchiveError) {
          throw error;
        }
        throw new CompletedTerminalHistoryArchiveError(
          'archive-io',
          'Could not archive the completed terminal history projection.',
          error
        );
      } finally {
        if (!committed && opened && source.cancel) {
          await source.cancel(opened).catch(() => undefined);
        }
      }
    });
  }

  public async read(descriptorValue: unknown): Promise<TerminalStreamAttachPayload> {
    const descriptor = requireDescriptor(descriptorValue);
    const archiveFilePath = this.resolveArchiveFilePathForDescriptor(descriptor);
    const bytes = await readArchiveFile(archiveFilePath, descriptor, 'archive-not-found');
    return verifyArchiveBytes(bytes, descriptor);
  }

  /**
   * Verifies an existing bounded sidecar without rebuilding it. Older refs
   * without a sidecar are upgraded from the canonical blob exactly once.
   */
  public async ensureProjectionSidecar(
    descriptorValue: unknown
  ): Promise<CompletedTerminalHistoryArchiveDescriptor> {
    const descriptor = requireDescriptor(descriptorValue);
    if (descriptor.projectionCodec === COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC) {
      const archiveFilePath = this.resolveArchiveFilePathForDescriptor(descriptor);
      const projectionFilePath = this.resolveArchiveProjectionFilePathForDescriptor(descriptor);
      if (await verifyExistingProjectionSidecar(
        archiveFilePath,
        projectionFilePath,
        descriptor
      )) {
        return descriptor;
      }
    }
    const payload = await this.read(descriptor);
    return this.write(payload);
  }

  /**
   * Opens a line-oriented reader for a newly written archive projection. The
   * reader owns one file descriptor and must be closed on cancellation.
   */
  public async openProjection(
    descriptorValue: unknown
  ): Promise<CompletedTerminalHistoryArchiveProjectionReader> {
    const descriptor = requireDescriptor(descriptorValue);
    if (descriptor.projectionCodec !== COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive ${descriptor.archiveId} has no bounded projection sidecar.`
      );
    }
    const projectionFilePath = this.resolveArchiveProjectionFilePathForDescriptor(descriptor);
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(projectionFilePath, 'r');
      return new CompletedTerminalHistoryArchiveProjectionReader(handle, descriptor);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (isFileNotFoundError(error)) {
        throw new CompletedTerminalHistoryArchiveError(
          'archive-not-found',
          `Completed terminal history archive projection ${descriptor.archiveId} does not exist.`,
          error
        );
      }
      throw new CompletedTerminalHistoryArchiveError(
        'archive-io',
        `Could not open completed terminal history archive projection ${descriptor.archiveId}.`,
        error
      );
    }
  }

  private async prepare(
    payloadValue: TerminalStreamAttachPayload
  ): Promise<PreparedCompletedTerminalHistoryArchive> {
    // Archive finalization runs on the extension Host. Always yield before the
    // first payload walk, then yield between bounded materialization batches.
    await yieldArchiveMaterialization();
    const payload = await normalizeTerminalStreamAttachPayloadAsync(payloadValue);
    if (!payload) {
      throw new CompletedTerminalHistoryArchiveError(
        'invalid-payload',
        'Completed terminal history archive payload is invalid.'
      );
    }

    const bytes = await buildCanonicalPayloadBytes(payload);
    const sha256 = await hashArchiveBytes(bytes);
    const descriptorBase: CompletedTerminalHistoryArchiveDescriptor = {
      version: COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION,
      archiveId: createCompletedTerminalHistoryArchiveId(sha256),
      codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
      sessionId: payload.sessionId,
      authorityId: payload.authorityId,
      finalRevision: payload.revision,
      byteLength: bytes.byteLength,
      sha256
    };
    const projectionBytes = await buildProjectionBytes(payload, descriptorBase);
    const projectionSha256 = await hashArchiveBytes(projectionBytes);
    const descriptor: CompletedTerminalHistoryArchiveDescriptor = {
      ...descriptorBase,
      projectionCodec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC,
      projectionByteLength: projectionBytes.byteLength,
      projectionSha256
    };

    return { descriptor, bytes, projectionBytes };
  }

  private async materializeAndCommitProjectionStream(
    openedValue: RuntimeSupervisorOpenTerminalProjectionResult,
    reads: AsyncIterable<CompletedTerminalHistoryArchiveProjectionRead>
  ): Promise<CompletedTerminalHistoryArchiveDescriptor> {
    const opened = normalizeFixedProjectionOpenResult(openedValue);
    if (!reads || typeof reads[Symbol.asyncIterator] !== 'function') {
      throw invalidProjectionStream('The completed terminal history projection reader is invalid.');
    }

    await fs.promises.mkdir(this.archiveRootPath, { recursive: true, mode: 0o700 });
    const stagingDirectoryPath = path.join(
      this.archiveRootPath,
      `.${process.pid}.${randomUUID()}.tmp`
    );
    const stagingArchiveFilePath = path.join(
      stagingDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PAYLOAD_FILE
    );
    const stagingProjectionBodyPath = path.join(stagingDirectoryPath, 'projection.body.ndjson');
    const stagingProjectionFilePath = path.join(
      stagingDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_FILE
    );
    let canonicalWriter: BoundedArchiveFileWriter | undefined;
    let projectionBodyWriter: BoundedArchiveFileWriter | undefined;
    let projectionWriter: BoundedArchiveFileWriter | undefined;
    try {
      await fs.promises.mkdir(stagingDirectoryPath, { mode: 0o700 });
      canonicalWriter = await BoundedArchiveFileWriter.open(stagingArchiveFilePath);
      projectionBodyWriter = await BoundedArchiveFileWriter.open(stagingProjectionBodyPath);
      const materializer = new FixedProjectionArchiveMaterializer(
        opened,
        canonicalWriter,
        projectionBodyWriter
      );
      await materializer.initialize();
      for await (const read of reads) {
        await materializer.append(read);
      }
      await materializer.finish();

      const canonicalSeal = await canonicalWriter.seal();
      canonicalWriter = undefined;
      await projectionBodyWriter.seal();
      projectionBodyWriter = undefined;
      const descriptorBase: CompletedTerminalHistoryArchiveDescriptor = {
        version: COMPLETED_TERMINAL_HISTORY_ARCHIVE_VERSION,
        archiveId: createCompletedTerminalHistoryArchiveId(canonicalSeal.sha256),
        codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_CODEC,
        sessionId: opened.sessionId,
        authorityId: opened.authorityId,
        finalRevision: opened.targetRevision,
        byteLength: canonicalSeal.byteLength,
        sha256: canonicalSeal.sha256
      };

      projectionWriter = await BoundedArchiveFileWriter.open(stagingProjectionFilePath);
      await projectionWriter.appendRecord(
        createProjectionHeader(opened, descriptorBase, materializer.checkpointDataLength)
      );
      await appendFileToArchiveWriter(stagingProjectionBodyPath, projectionWriter);
      const projectionSeal = await projectionWriter.seal();
      projectionWriter = undefined;
      const descriptor: CompletedTerminalHistoryArchiveDescriptor = {
        ...descriptorBase,
        projectionCodec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC,
        projectionByteLength: projectionSeal.byteLength,
        projectionSha256: projectionSeal.sha256
      };

      await fs.promises.rm(stagingProjectionBodyPath, { force: true });
      await verifyArchiveFileChecksum(stagingArchiveFilePath, descriptor, 'archive-corrupt');
      await verifyProjectionFile(stagingProjectionFilePath, descriptor);
      await fsyncDirectory(stagingDirectoryPath);
      return await this.commitStagedProjectionArchive(stagingDirectoryPath, descriptor);
    } finally {
      await Promise.all([
        canonicalWriter?.close().catch(() => undefined),
        projectionBodyWriter?.close().catch(() => undefined),
        projectionWriter?.close().catch(() => undefined)
      ]);
      await fs.promises.rm(stagingDirectoryPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async commitStagedProjectionArchive(
    stagingDirectoryPath: string,
    descriptor: CompletedTerminalHistoryArchiveDescriptor
  ): Promise<CompletedTerminalHistoryArchiveDescriptor> {
    const archiveDirectoryPath = this.resolveArchiveDirectoryPath(descriptor);
    const archiveFilePath = path.join(
      archiveDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PAYLOAD_FILE
    );
    const archiveProjectionFilePath = path.join(
      archiveDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_FILE
    );
    const stagingProjectionFilePath = path.join(
      stagingDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_FILE
    );
    const shardDirectoryPath = path.dirname(archiveDirectoryPath);
    await fs.promises.mkdir(shardDirectoryPath, { recursive: true, mode: 0o700 });
    if (await verifyExistingArchive(archiveFilePath, archiveProjectionFilePath, descriptor)) {
      return descriptor;
    }
    if (await verifyCanonicalArchive(archiveFilePath, descriptor)) {
      await installProjectionSidecarFromFile(
        stagingProjectionFilePath,
        archiveProjectionFilePath,
        descriptor
      );
      return descriptor;
    }

    try {
      await fs.promises.rename(stagingDirectoryPath, archiveDirectoryPath);
    } catch (error) {
      if (await verifyExistingArchive(archiveFilePath, archiveProjectionFilePath, descriptor)) {
        return descriptor;
      }
      if (await verifyCanonicalArchive(archiveFilePath, descriptor)) {
        await installProjectionSidecarFromFile(
          stagingProjectionFilePath,
          archiveProjectionFilePath,
          descriptor
        );
        return descriptor;
      }
      throw error;
    }

    await fsyncDirectory(shardDirectoryPath);
    await verifyArchiveFileChecksum(archiveFilePath, descriptor, 'archive-corrupt');
    await verifyProjectionFile(archiveProjectionFilePath, descriptor);
    return descriptor;
  }

  private async enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.writeChain.then(operation, operation);
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private async commitPreparedArchive(
    prepared: PreparedCompletedTerminalHistoryArchive
  ): Promise<CompletedTerminalHistoryArchiveDescriptor> {
    const descriptor = prepared.descriptor;
    const archiveDirectoryPath = this.resolveArchiveDirectoryPath(descriptor);
    const archiveFilePath = path.join(archiveDirectoryPath, COMPLETED_TERMINAL_HISTORY_ARCHIVE_PAYLOAD_FILE);
    const archiveProjectionFilePath = path.join(
      archiveDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_FILE
    );
    const shardDirectoryPath = path.dirname(archiveDirectoryPath);
    const temporaryDirectoryPath = path.join(
      shardDirectoryPath,
      `.${descriptor.archiveId}.${process.pid}.${randomUUID()}.tmp`
    );
    const temporaryFilePath = path.join(
      temporaryDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PAYLOAD_FILE
    );
    const temporaryProjectionFilePath = path.join(
      temporaryDirectoryPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_FILE
    );
    let temporaryDirectoryCreated = false;
    try {
      await fs.promises.mkdir(shardDirectoryPath, { recursive: true, mode: 0o700 });
      if (await verifyExistingArchive(archiveFilePath, archiveProjectionFilePath, descriptor)) {
        return descriptor;
      }
      if (
        descriptor.projectionCodec === COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC &&
        await verifyCanonicalArchive(archiveFilePath, descriptor)
      ) {
        await installProjectionSidecar(
          archiveProjectionFilePath,
          prepared.projectionBytes,
          descriptor
        );
        return descriptor;
      }

      await fs.promises.mkdir(temporaryDirectoryPath, { mode: 0o700 });
      temporaryDirectoryCreated = true;
      await writeDurableFile(temporaryFilePath, prepared.bytes);
      await writeDurableFile(temporaryProjectionFilePath, prepared.projectionBytes);

      await verifyArchiveFileChecksum(temporaryFilePath, descriptor, 'archive-corrupt');
      await fsyncDirectory(temporaryDirectoryPath);

      if (await verifyExistingArchive(archiveFilePath, archiveProjectionFilePath, descriptor)) {
        return descriptor;
      }
      if (
        descriptor.projectionCodec === COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC &&
        await verifyCanonicalArchive(archiveFilePath, descriptor)
      ) {
        await installProjectionSidecar(
          archiveProjectionFilePath,
          prepared.projectionBytes,
          descriptor
        );
        return descriptor;
      }

      try {
        await fs.promises.rename(temporaryDirectoryPath, archiveDirectoryPath);
        temporaryDirectoryCreated = false;
      } catch (error) {
        if (await verifyExistingArchive(archiveFilePath, archiveProjectionFilePath, descriptor)) {
          return descriptor;
        }
        if (
          descriptor.projectionCodec === COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC &&
          await verifyCanonicalArchive(archiveFilePath, descriptor)
        ) {
          await installProjectionSidecar(
            archiveProjectionFilePath,
            prepared.projectionBytes,
            descriptor
          );
          return descriptor;
        }
        throw error;
      }

      await fsyncDirectory(shardDirectoryPath);
      await verifyArchiveFileChecksum(archiveFilePath, descriptor, 'archive-corrupt');
      await verifyProjectionFile(archiveProjectionFilePath, descriptor);
      return descriptor;
    } catch (error) {
      if (error instanceof CompletedTerminalHistoryArchiveError) {
        throw error;
      }
      throw new CompletedTerminalHistoryArchiveError(
        'archive-io',
        `Could not commit completed terminal history archive ${descriptor.archiveId}.`,
        error
      );
    } finally {
      if (temporaryDirectoryCreated) {
        await fs.promises.rm(temporaryDirectoryPath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private resolveArchiveDirectoryPath(descriptor: CompletedTerminalHistoryArchiveDescriptor): string {
    return path.join(
      this.archiveRootPath,
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_BLOB_DIRECTORY,
      descriptor.sha256.slice(0, 2),
      descriptor.archiveId
    );
  }

  private resolveArchiveFilePathForDescriptor(
    descriptor: CompletedTerminalHistoryArchiveDescriptor
  ): string {
    return path.join(
      this.resolveArchiveDirectoryPath(descriptor),
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PAYLOAD_FILE
    );
  }

  private resolveArchiveProjectionFilePathForDescriptor(
    descriptor: CompletedTerminalHistoryArchiveDescriptor
  ): string {
    return path.join(
      this.resolveArchiveDirectoryPath(descriptor),
      COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_FILE
    );
  }
}

interface NormalizedFixedProjectionOpenResult {
  supervisorInstanceId?: string;
  projectionId: string;
  sessionId: string;
  authorityId: string;
  targetRevision: number;
  follow: false;
  checkpoint: RuntimeSupervisorTerminalProjectionCheckpointDescriptor;
}

interface CurrentStreamingOutput {
  revision: number;
  createdAtMs: number;
  offset: number;
  dataLength: number;
  lastCodeUnit?: number;
  sidecar: ProjectionDataRecordBuffer;
}

class FixedProjectionArchiveMaterializer {
  private checkpointComplete = false;
  private checkpointLastCodeUnit: number | undefined;
  private readonly checkpointSidecar: ProjectionDataRecordBuffer;
  private nextRevision: number;
  private currentOutput: CurrentStreamingOutput | undefined;
  private eventCount = 0;
  private terminalDone = false;
  private initialized = false;

  public checkpointDataLength = 0;

  public constructor(
    private readonly opened: NormalizedFixedProjectionOpenResult,
    private readonly canonicalWriter: BoundedArchiveFileWriter,
    projectionBodyWriter: BoundedArchiveFileWriter
  ) {
    this.nextRevision = opened.checkpoint.revision + 1;
    this.checkpointSidecar = new ProjectionDataRecordBuffer(
      (dataOffset, data, complete) => projectionBodyWriter.appendRecord({
        kind: 'checkpoint',
        dataOffset,
        data,
        complete
      })
    );
    this.projectionBodyWriter = projectionBodyWriter;
  }

  private readonly projectionBodyWriter: BoundedArchiveFileWriter;

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    const checkpoint = this.opened.checkpoint;
    await this.canonicalWriter.appendLiteral('{"version":');
    await this.canonicalWriter.appendValue(TERMINAL_SESSION_STREAM_VERSION);
    await this.canonicalWriter.appendLiteral(',"sessionId":');
    await this.canonicalWriter.appendString(this.opened.sessionId);
    await this.canonicalWriter.appendLiteral(',"authorityId":');
    await this.canonicalWriter.appendString(this.opened.authorityId);
    await this.canonicalWriter.appendLiteral(',"revision":');
    await this.canonicalWriter.appendValue(this.opened.targetRevision);
    await this.canonicalWriter.appendLiteral(',"checkpoint":{"version":');
    await this.canonicalWriter.appendValue(TERMINAL_SESSION_STREAM_VERSION);
    await this.canonicalWriter.appendLiteral(',"sessionId":');
    await this.canonicalWriter.appendString(this.opened.sessionId);
    await this.canonicalWriter.appendLiteral(',"authorityId":');
    await this.canonicalWriter.appendString(this.opened.authorityId);
    await this.canonicalWriter.appendLiteral(',"revision":');
    await this.canonicalWriter.appendValue(checkpoint.revision);
    await this.canonicalWriter.appendLiteral(',"cols":');
    await this.canonicalWriter.appendValue(checkpoint.cols);
    await this.canonicalWriter.appendLiteral(',"rows":');
    await this.canonicalWriter.appendValue(checkpoint.rows);
    await this.canonicalWriter.appendLiteral(',"scrollback":');
    await this.canonicalWriter.appendValue(checkpoint.scrollback);
    await this.canonicalWriter.appendLiteral(',"createdAtMs":');
    await this.canonicalWriter.appendValue(checkpoint.createdAtMs);
    await this.canonicalWriter.appendLiteral(',"serializedState":{"format":');
    await this.canonicalWriter.appendString(checkpoint.serializedState.format);
    await this.canonicalWriter.appendLiteral(',"data":"');
  }

  public async append(readValue: CompletedTerminalHistoryArchiveProjectionRead): Promise<void> {
    if (!this.initialized) {
      throw invalidProjectionStream('The completed terminal history projection writer was not initialized.');
    }
    if (this.terminalDone) {
      throw invalidProjectionStream('The completed terminal history projection emitted data after done.');
    }
    const { result, chunk } = normalizeProjectionStreamRead(readValue, this.opened);
    if (!chunk) {
      if (!result.done) {
        throw invalidProjectionStream('An empty completed terminal history projection response was not done.');
      }
      await this.completeStream();
      return;
    }
    if (result.done && !chunk.complete) {
      throw invalidProjectionStream('The completed terminal history projection ended inside a data chunk.');
    }

    if (chunk.kind === 'checkpoint') {
      await this.appendCheckpoint(chunk);
    } else if (chunk.kind === 'output') {
      await this.appendOutput(chunk);
    } else {
      await this.appendMetadata(chunk);
    }
    if (result.done) {
      await this.completeStream();
    }
  }

  public async finish(): Promise<void> {
    if (!this.terminalDone) {
      throw invalidProjectionStream('The completed terminal history projection ended before done.');
    }
    this.assertCompleteBarrier();
  }

  private async appendCheckpoint(
    chunk: Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'checkpoint' }>
  ): Promise<void> {
    if (
      this.checkpointComplete ||
      this.currentOutput ||
      this.eventCount > 0 ||
      chunk.dataOffset !== this.checkpointDataLength ||
      (!chunk.data && !chunk.complete)
    ) {
      throw invalidProjectionStream('Completed terminal history checkpoint chunks are not contiguous.');
    }
    if (
      this.checkpointDataLength + chunk.data.length >
      ARCHIVE_PROJECTION_CHECKPOINT_DATA_MAX_CHARS
    ) {
      throw invalidProjectionStream('Completed terminal history checkpoint data exceeds the supported size.');
    }
    assertStreamingTextBoundary(this.checkpointLastCodeUnit, chunk.data, 'checkpoint');
    await this.canonicalWriter.appendStringFragment(chunk.data);
    await this.checkpointSidecar.append(chunk.data, chunk.complete);
    if (chunk.data) {
      this.checkpointDataLength += chunk.data.length;
      this.checkpointLastCodeUnit = chunk.data.charCodeAt(chunk.data.length - 1);
    }
    if (!chunk.complete) {
      return;
    }

    this.checkpointComplete = true;
    const serializedState = this.opened.checkpoint.serializedState;
    await this.canonicalWriter.appendLiteral('"');
    if (serializedState.viewportY !== undefined) {
      await this.canonicalWriter.appendLiteral(',"viewportY":');
      await this.canonicalWriter.appendValue(serializedState.viewportY);
    }
    // The in-memory assembler has always promoted this identity field even if
    // an older open descriptor omitted it; keep the canonical bytes identical.
    await this.canonicalWriter.appendLiteral(',"outputSequence":');
    await this.canonicalWriter.appendValue(this.opened.checkpoint.revision);
    await this.canonicalWriter.appendLiteral('}},"events":[');
  }

  private async appendOutput(
    chunk: Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'output' }>
  ): Promise<void> {
    if (!this.checkpointComplete || (!chunk.data && !chunk.complete)) {
      throw invalidProjectionStream('Completed terminal history output arrived outside an event boundary.');
    }
    if (!this.currentOutput) {
      if (chunk.revision !== this.nextRevision || chunk.dataOffset !== 0) {
        throw invalidProjectionStream('Completed terminal history output did not start at the next revision.');
      }
      if (this.eventCount > 0) {
        await this.canonicalWriter.appendLiteral(',');
      }
      await this.canonicalWriter.appendLiteral('{"type":"output","revision":');
      await this.canonicalWriter.appendValue(chunk.revision);
      await this.canonicalWriter.appendLiteral(',"createdAtMs":');
      await this.canonicalWriter.appendValue(chunk.createdAtMs);
      await this.canonicalWriter.appendLiteral(',"data":"');
      this.currentOutput = {
        revision: chunk.revision,
        createdAtMs: chunk.createdAtMs,
        offset: 0,
        dataLength: 0,
        sidecar: new ProjectionDataRecordBuffer(
          (dataOffset, data, complete) => this.projectionBodyWriter.appendRecord({
            kind: 'output',
            revision: chunk.revision,
            createdAtMs: chunk.createdAtMs,
            dataOffset,
            data,
            complete
          })
        )
      };
    } else if (
      chunk.revision !== this.currentOutput.revision ||
      chunk.createdAtMs !== this.currentOutput.createdAtMs ||
      chunk.dataOffset !== this.currentOutput.offset
    ) {
      throw invalidProjectionStream('Completed terminal history output chunks are not contiguous.');
    }

    const output = this.currentOutput;
    assertStreamingTextBoundary(output.lastCodeUnit, chunk.data, 'output');
    if (chunk.complete && output.dataLength + chunk.data.length === 0) {
      throw invalidProjectionStream('A completed terminal history output event cannot be empty.');
    }
    await this.canonicalWriter.appendStringFragment(chunk.data);
    await output.sidecar.append(chunk.data, chunk.complete);
    output.offset += chunk.data.length;
    output.dataLength += chunk.data.length;
    if (chunk.data) {
      output.lastCodeUnit = chunk.data.charCodeAt(chunk.data.length - 1);
    }
    if (!chunk.complete) {
      return;
    }

    await this.canonicalWriter.appendLiteral('"}');
    this.eventCount += 1;
    this.nextRevision = output.revision + 1;
    this.currentOutput = undefined;
  }

  private async appendMetadata(
    chunk:
      | Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'resize' }>
      | Extract<RuntimeSupervisorTerminalProjectionChunk, { kind: 'scrollback' }>
  ): Promise<void> {
    if (!this.checkpointComplete || this.currentOutput || chunk.revision !== this.nextRevision) {
      throw invalidProjectionStream('Completed terminal history metadata is not revision-contiguous.');
    }
    if (this.eventCount > 0) {
      await this.canonicalWriter.appendLiteral(',');
    }
    if (chunk.kind === 'resize') {
      await this.canonicalWriter.appendLiteral('{"type":"resize","revision":');
      await this.canonicalWriter.appendValue(chunk.revision);
      await this.canonicalWriter.appendLiteral(',"createdAtMs":');
      await this.canonicalWriter.appendValue(chunk.createdAtMs);
      await this.canonicalWriter.appendLiteral(',"cols":');
      await this.canonicalWriter.appendValue(chunk.cols);
      await this.canonicalWriter.appendLiteral(',"rows":');
      await this.canonicalWriter.appendValue(chunk.rows);
      await this.canonicalWriter.appendLiteral('}');
    } else {
      await this.canonicalWriter.appendLiteral('{"type":"scrollback","revision":');
      await this.canonicalWriter.appendValue(chunk.revision);
      await this.canonicalWriter.appendLiteral(',"createdAtMs":');
      await this.canonicalWriter.appendValue(chunk.createdAtMs);
      await this.canonicalWriter.appendLiteral(',"scrollback":');
      await this.canonicalWriter.appendValue(chunk.scrollback);
      await this.canonicalWriter.appendLiteral('}');
    }
    await this.projectionBodyWriter.appendRecord(chunk);
    this.eventCount += 1;
    this.nextRevision = chunk.revision + 1;
  }

  private async completeStream(): Promise<void> {
    this.assertCompleteBarrier();
    await this.canonicalWriter.appendLiteral(']}\n');
    await this.projectionBodyWriter.appendRecord({ kind: 'done' });
    this.terminalDone = true;
  }

  private assertCompleteBarrier(): void {
    if (
      !this.checkpointComplete ||
      this.currentOutput ||
      this.nextRevision !== this.opened.targetRevision + 1
    ) {
      throw invalidProjectionStream(
        'The completed terminal history projection does not cover its final revision.'
      );
    }
  }
}

class ProjectionDataRecordBuffer {
  private pending = '';
  private writtenOffset = 0;
  private complete = false;

  public constructor(
    private readonly writeRecord: (
      dataOffset: number,
      data: string,
      complete: boolean
    ) => Promise<void>
  ) {}

  public async append(data: string, complete: boolean): Promise<void> {
    if (this.complete) {
      throw invalidProjectionStream('Completed terminal history projection data continued after completion.');
    }
    this.pending += data;
    while (this.pending.length > ARCHIVE_PROJECTION_RECORD_MAX_CHARS) {
      let end = ARCHIVE_PROJECTION_RECORD_MAX_CHARS;
      if (splitsUtf16SurrogatePair(this.pending, end)) {
        end -= 1;
      }
      const part = this.pending.slice(0, end);
      await this.writeRecord(this.writtenOffset, part, false);
      this.writtenOffset += part.length;
      this.pending = this.pending.slice(end);
    }
    if (!complete) {
      return;
    }
    await this.writeRecord(this.writtenOffset, this.pending, true);
    this.writtenOffset += this.pending.length;
    this.pending = '';
    this.complete = true;
  }
}

interface ArchiveFileSeal {
  byteLength: number;
  sha256: string;
}

class BoundedArchiveFileWriter {
  private readonly hash = createHash('sha256');
  private readonly pendingParts: Buffer[] = [];
  private pendingBytes = 0;
  private totalBytes = 0;
  private closed = false;
  private sealed: ArchiveFileSeal | undefined;

  private constructor(private readonly handle: fs.promises.FileHandle) {}

  public static async open(filePath: string): Promise<BoundedArchiveFileWriter> {
    return new BoundedArchiveFileWriter(await fs.promises.open(filePath, 'wx', 0o600));
  }

  public async appendLiteral(value: string): Promise<void> {
    await this.appendBuffer(Buffer.from(value, 'utf8'));
  }

  public async appendValue(value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw invalidProjectionStream('Completed terminal history projection contains an unsupported JSON value.');
    }
    await this.appendLiteral(serialized);
  }

  public async appendString(value: string): Promise<void> {
    await this.appendLiteral('"');
    await this.appendStringFragment(value);
    await this.appendLiteral('"');
  }

  /** Appends JSON string content without opening or closing quote characters. */
  public async appendStringFragment(value: string): Promise<void> {
    let textStart = 0;
    const flushText = async (end: number): Promise<void> => {
      if (end <= textStart) {
        return;
      }
      await this.appendLiteral(value.slice(textStart, end));
      textStart = end;
    };
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      let escape: string | undefined;
      if (code === 0x22) {
        escape = '\\"';
      } else if (code === 0x5c) {
        escape = '\\\\';
      } else if (code === 0x08) {
        escape = '\\b';
      } else if (code === 0x09) {
        escape = '\\t';
      } else if (code === 0x0a) {
        escape = '\\n';
      } else if (code === 0x0c) {
        escape = '\\f';
      } else if (code === 0x0d) {
        escape = '\\r';
      } else if (code < 0x20) {
        escape = `\\u${code.toString(16).padStart(4, '0')}`;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = index + 1 < value.length ? value.charCodeAt(index + 1) : undefined;
        if (next === undefined || next < 0xdc00 || next > 0xdfff) {
          escape = `\\u${code.toString(16).padStart(4, '0')}`;
        } else {
          index += 1;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        escape = `\\u${code.toString(16).padStart(4, '0')}`;
      }

      if (escape !== undefined) {
        await flushText(index);
        await this.appendLiteral(escape);
        textStart = index + 1;
      } else if (index + 1 - textStart >= ARCHIVE_MATERIALIZATION_TEXT_BUFFER_MAX_CHARS) {
        await flushText(index + 1);
      }
    }
    await flushText(value.length);
  }

  public async appendRecord(record: object): Promise<void> {
    const value = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(value, 'utf8') > ARCHIVE_PROJECTION_LINE_MAX_BYTES) {
      throw invalidProjectionStream('Completed terminal history projection record exceeds the line-size bound.');
    }
    await this.appendLiteral(value);
  }

  public async appendBuffer(value: Buffer): Promise<void> {
    this.ensureOpen();
    let offset = 0;
    while (offset < value.byteLength) {
      const available = ARCHIVE_MATERIALIZATION_BATCH_BYTES - this.pendingBytes;
      const length = Math.min(available, value.byteLength - offset);
      this.pendingParts.push(value.subarray(offset, offset + length));
      this.pendingBytes += length;
      offset += length;
      if (this.pendingBytes >= ARCHIVE_MATERIALIZATION_BATCH_BYTES) {
        await this.flush();
      }
    }
  }

  public async seal(): Promise<ArchiveFileSeal> {
    if (this.sealed) {
      return this.sealed;
    }
    this.ensureOpen();
    await this.flush();
    await this.handle.sync();
    await this.handle.close();
    this.closed = true;
    this.sealed = {
      byteLength: this.totalBytes,
      sha256: this.hash.digest('hex')
    };
    return this.sealed;
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.pendingParts.length = 0;
    this.pendingBytes = 0;
    await this.handle.close();
  }

  private async flush(): Promise<void> {
    if (this.pendingBytes === 0) {
      return;
    }
    const bytes = Buffer.concat(this.pendingParts, this.pendingBytes);
    this.pendingParts.length = 0;
    this.pendingBytes = 0;
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await this.handle.write(bytes, offset, bytes.byteLength - offset, null);
      if (result.bytesWritten <= 0) {
        throw new Error('Completed terminal history archive write made no progress.');
      }
      offset += result.bytesWritten;
    }
    this.hash.update(bytes);
    this.totalBytes += bytes.byteLength;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Completed terminal history archive writer is closed.');
    }
  }
}

function normalizeFixedProjectionOpenResult(
  value: RuntimeSupervisorOpenTerminalProjectionResult
): NormalizedFixedProjectionOpenResult {
  const checkpoint = value?.checkpoint;
  const serializedState = checkpoint?.serializedState;
  if (
    !value ||
    !isStreamingIdentity(value.projectionId) ||
    !isStreamingIdentity(value.sessionId) ||
    !isStreamingIdentity(value.authorityId) ||
    !isProjectionRevision(value.targetRevision) ||
    value.follow !== false ||
    (value.supervisorInstanceId !== undefined &&
      !isStreamingIdentity(value.supervisorInstanceId)) ||
    !checkpoint ||
    checkpoint.version !== TERMINAL_SESSION_STREAM_VERSION ||
    checkpoint.sessionId !== value.sessionId ||
    checkpoint.authorityId !== value.authorityId ||
    !isProjectionRevision(checkpoint.revision) ||
    checkpoint.revision > value.targetRevision ||
    !isSafeProjectionDimension(checkpoint.cols, 2) ||
    !isSafeProjectionDimension(checkpoint.rows, 1) ||
    !isProjectionRevision(checkpoint.scrollback) ||
    !isProjectionTimestamp(checkpoint.createdAtMs) ||
    !isProjectionRecordObject(serializedState) ||
    !hasOnlyProjectionKeys(
      serializedState,
      ['format', 'viewportY', 'outputSequence'],
      ['format']
    ) ||
    serializedState.format !== ARCHIVE_PROJECTION_SERIALIZED_STATE_FORMAT ||
    (serializedState.viewportY !== undefined &&
      !isProjectionRevision(serializedState.viewportY)) ||
    (serializedState.outputSequence !== undefined &&
      serializedState.outputSequence !== checkpoint.revision)
  ) {
    throw invalidProjectionStream('Completed terminal history projection open metadata is invalid.');
  }
  return {
    ...(value.supervisorInstanceId === undefined
      ? {}
      : { supervisorInstanceId: value.supervisorInstanceId }),
    projectionId: value.projectionId,
    sessionId: value.sessionId,
    authorityId: value.authorityId,
    targetRevision: value.targetRevision,
    follow: false,
    checkpoint: {
      version: TERMINAL_SESSION_STREAM_VERSION,
      sessionId: value.sessionId,
      authorityId: value.authorityId,
      revision: checkpoint.revision,
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      scrollback: checkpoint.scrollback,
      createdAtMs: checkpoint.createdAtMs,
      serializedState: {
        format: ARCHIVE_PROJECTION_SERIALIZED_STATE_FORMAT,
        ...(serializedState.viewportY === undefined
          ? {}
          : { viewportY: serializedState.viewportY }),
        outputSequence: checkpoint.revision
      }
    }
  };
}

function normalizeProjectionStreamRead(
  value: CompletedTerminalHistoryArchiveProjectionRead,
  opened: NormalizedFixedProjectionOpenResult
): {
  result: RuntimeSupervisorReadTerminalProjectionResult;
  chunk: RuntimeSupervisorTerminalProjectionChunk | undefined;
} {
  const creditBytes = value?.creditBytes;
  const result = value?.result;
  if (
    !Number.isSafeInteger(creditBytes) ||
    creditBytes < RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MIN_CREDIT_BYTES ||
    creditBytes > RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MAX_CREDIT_BYTES ||
    !result ||
    result.projectionId !== opened.projectionId ||
    result.sessionId !== opened.sessionId ||
    result.authorityId !== opened.authorityId ||
    result.targetRevision !== opened.targetRevision ||
    (opened.supervisorInstanceId !== undefined &&
      result.supervisorInstanceId !== opened.supervisorInstanceId) ||
    typeof result.done !== 'boolean' ||
    result.live === true ||
    !Number.isSafeInteger(result.payloadBytes) ||
    result.payloadBytes < 0 ||
    result.payloadBytes > creditBytes
  ) {
    throw invalidProjectionStream('Completed terminal history projection response identity or credit is invalid.');
  }
  const chunk = normalizeStreamingProjectionChunk(result.chunk);
  if (result.chunk !== undefined && !chunk) {
    throw invalidProjectionStream('Completed terminal history projection chunk is invalid.');
  }
  const serializedChunk = chunk === undefined ? undefined : JSON.stringify(chunk);
  const payloadBytes = serializedChunk === undefined
    ? 0
    : Buffer.byteLength(serializedChunk, 'utf8');
  if (result.payloadBytes !== payloadBytes) {
    throw invalidProjectionStream('Completed terminal history projection payload byte count is invalid.');
  }
  if (!chunk) {
    if (result.chunkChecksum !== undefined || result.payloadBytes !== 0) {
      throw invalidProjectionStream('An empty completed terminal history projection response has payload metadata.');
    }
  } else if (
    typeof result.chunkChecksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(result.chunkChecksum) ||
    createHash('sha256').update(serializedChunk!, 'utf8').digest('hex') !== result.chunkChecksum
  ) {
    throw invalidProjectionStream('Completed terminal history projection chunk checksum is invalid.');
  }
  return { result, chunk };
}

function normalizeStreamingProjectionChunk(
  value: RuntimeSupervisorTerminalProjectionChunk | undefined
): RuntimeSupervisorTerminalProjectionChunk | undefined {
  if (!value || typeof value !== 'object' || typeof value.kind !== 'string') {
    return undefined;
  }
  if (value.kind === 'checkpoint') {
    return isProjectionDataOffset(value.dataOffset) &&
      typeof value.data === 'string' &&
      value.data.length <= RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MAX_CREDIT_BYTES &&
      typeof value.complete === 'boolean'
      ? {
          kind: 'checkpoint',
          dataOffset: value.dataOffset,
          data: value.data,
          complete: value.complete
        }
      : undefined;
  }
  if (
    !isProjectionEventRevision(value.revision, Number.MAX_SAFE_INTEGER) ||
    !isProjectionTimestamp(value.createdAtMs)
  ) {
    return undefined;
  }
  if (value.kind === 'output') {
    return isProjectionDataOffset(value.dataOffset) &&
      typeof value.data === 'string' &&
      value.data.length <= RUNTIME_SUPERVISOR_TERMINAL_PROJECTION_MAX_CREDIT_BYTES &&
      typeof value.complete === 'boolean'
      ? {
          kind: 'output',
          revision: value.revision,
          createdAtMs: value.createdAtMs,
          dataOffset: value.dataOffset,
          data: value.data,
          complete: value.complete
        }
      : undefined;
  }
  if (value.kind === 'resize') {
    return isSafeProjectionDimension(value.cols, 2) &&
      isSafeProjectionDimension(value.rows, 1) &&
      value.complete === true
      ? {
          kind: 'resize',
          revision: value.revision,
          createdAtMs: value.createdAtMs,
          cols: value.cols,
          rows: value.rows,
          complete: true
        }
      : undefined;
  }
  if (value.kind === 'scrollback') {
    return isProjectionRevision(value.scrollback) && value.complete === true
      ? {
          kind: 'scrollback',
          revision: value.revision,
          createdAtMs: value.createdAtMs,
          scrollback: value.scrollback,
          complete: true
        }
      : undefined;
  }
  return undefined;
}

function createProjectionHeader(
  opened: NormalizedFixedProjectionOpenResult,
  descriptor: CompletedTerminalHistoryArchiveDescriptor,
  checkpointDataLength: number
): CompletedTerminalHistoryArchiveProjectionHeader {
  return {
    kind: 'header',
    codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC,
    archiveId: descriptor.archiveId,
    sha256: descriptor.sha256,
    byteLength: descriptor.byteLength,
    sessionId: opened.sessionId,
    authorityId: opened.authorityId,
    finalRevision: opened.targetRevision,
    checkpoint: {
      version: TERMINAL_SESSION_STREAM_VERSION,
      sessionId: opened.sessionId,
      authorityId: opened.authorityId,
      revision: opened.checkpoint.revision,
      cols: opened.checkpoint.cols,
      rows: opened.checkpoint.rows,
      scrollback: opened.checkpoint.scrollback,
      createdAtMs: opened.checkpoint.createdAtMs,
      serializedState: {
        format: ARCHIVE_PROJECTION_SERIALIZED_STATE_FORMAT,
        ...(opened.checkpoint.serializedState.viewportY === undefined
          ? {}
          : { viewportY: opened.checkpoint.serializedState.viewportY }),
        outputSequence: opened.checkpoint.revision
      },
      checkpointDataLength
    }
  };
}

async function appendFileToArchiveWriter(
  filePath: string,
  writer: BoundedArchiveFileWriter
): Promise<void> {
  const handle = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  let offset = 0;
  try {
    while (true) {
      const result = await handle.read(buffer, 0, buffer.byteLength, offset);
      if (result.bytesRead === 0) {
        return;
      }
      offset += result.bytesRead;
      // The writer can retain a subarray until its next bounded flush; copy
      // before this reusable read buffer is mutated by the following pull.
      await writer.appendBuffer(Buffer.from(buffer.subarray(0, result.bytesRead)));
    }
  } finally {
    await handle.close();
  }
}

function assertStreamingTextBoundary(
  previousCodeUnit: number | undefined,
  next: string,
  label: string
): void {
  if (
    previousCodeUnit !== undefined &&
    next.length > 0 &&
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    next.charCodeAt(0) >= 0xdc00 &&
    next.charCodeAt(0) <= 0xdfff
  ) {
    throw invalidProjectionStream(`Completed terminal history ${label} chunks split a UTF-16 pair.`);
  }
}

function isStreamingIdentity(value: unknown): value is string {
  return typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 256;
}

function isSafeProjectionDimension(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function invalidProjectionStream(message: string, cause?: unknown): CompletedTerminalHistoryArchiveError {
  return new CompletedTerminalHistoryArchiveError('invalid-payload', message, cause);
}

/** A transport-neutral open result consumed by ExecutionProjectionCoordinator. */
export interface CompletedTerminalHistoryArchiveProjectionOpenResult {
  projectionId: string;
  supervisorInstanceId: string;
  sessionId: string;
  authorityId: string;
  targetRevision: number;
  checkpoint: {
    version: number;
    sessionId: string;
    authorityId: string;
    revision: number;
    cols: number;
    rows: number;
    scrollback: number;
    createdAtMs: number;
    serializedState: Record<string, unknown>;
  };
}

export interface CompletedTerminalHistoryArchiveProjectionReadResult {
  projectionId: string;
  supervisorInstanceId: string;
  sessionId: string;
  authorityId: string;
  targetRevision: number;
  payloadBytes: number;
  chunkChecksum?: string;
  chunk?: Record<string, unknown>;
  done: boolean;
  live?: boolean;
}

/**
 * Reads the optional sidecar one bounded NDJSON record at a time.  It never
 * parses the canonical payload blob and keeps at most one record plus one
 * credit-sized chunk in memory.
 */
export class CompletedTerminalHistoryArchiveProjectionReader {
  private readonly projectionId = randomUUID();
  private readonly supervisorInstanceId: string;
  private readonly hash = createHash('sha256');
  private pendingBytes = Buffer.alloc(0);
  private readBuffer = Buffer.alloc(64 * 1024);
  private fileOffset = 0;
  private bytesRead = 0;
  private header: CompletedTerminalHistoryArchiveProjectionHeader | undefined;
  private checkpointComplete = false;
  private checkpointOffset = 0;
  private nextRevision = 0;
  private outputRevision: number | undefined;
  private outputCreatedAtMs: number | undefined;
  private outputOffset = 0;
  private pendingRecord:
    | Exclude<CompletedTerminalHistoryArchiveProjectionRecord, CompletedTerminalHistoryArchiveProjectionHeader | { kind: 'done' }>
    | undefined;
  private pendingRecordOffset = 0;
  private operationChain: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private handleClosed = false;
  private verified = false;

  public constructor(
    private readonly handle: fs.promises.FileHandle,
    private readonly descriptor: CompletedTerminalHistoryArchiveDescriptor
  ) {
    this.supervisorInstanceId = `archive:${descriptor.archiveId}`;
  }

  public open(): Promise<CompletedTerminalHistoryArchiveProjectionOpenResult> {
    return this.enqueueOperation(async () => {
      this.ensureOpen();
      try {
        return await this.openInternal();
      } catch (error) {
        await this.closeHandle();
        throw this.normalizeReadError(error);
      }
    });
  }

  public read(creditBytes: number): Promise<CompletedTerminalHistoryArchiveProjectionReadResult> {
    return this.enqueueOperation(async () => {
      this.ensureOpen();
      try {
        return await this.readInternal(creditBytes);
      } catch (error) {
        await this.closeHandle();
        throw this.normalizeReadError(error);
      }
    });
  }

  public close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    // Mark the reader closed immediately so already queued operations fail
    // without touching the handle. The actual close waits for an active read.
    this.closed = true;
    const closePromise = this.operationChain.then(
      () => this.closeHandle(),
      () => this.closeHandle()
    );
    this.closePromise = closePromise;
    this.operationChain = closePromise.then(
      () => undefined,
      () => undefined
    );
    return closePromise;
  }

  private async openInternal(): Promise<CompletedTerminalHistoryArchiveProjectionOpenResult> {
    if (this.header) {
      return this.toOpenResult(this.header);
    }
    const record = await this.readRecord();
    if (!record || record.kind !== 'header') {
      throw this.corrupt('projection header is missing');
    }
    validateProjectionHeader(record, this.descriptor);
    this.header = record;
    this.nextRevision = record.checkpoint.revision + 1;
    return this.toOpenResult(record);
  }

  private async readInternal(
    creditBytes: number
  ): Promise<CompletedTerminalHistoryArchiveProjectionReadResult> {
    if (!Number.isSafeInteger(creditBytes) || creditBytes < 256 || creditBytes > 64 * 1024) {
      throw this.corrupt('projection credit is outside the supported range');
    }
    if (!this.header) {
      await this.openInternal();
    }
    if (this.verified) {
      return this.emptyDoneResult();
    }

    if (!this.pendingRecord) {
      const record = await this.readRecord();
      if (!record || record.kind === 'done') {
        if (!record) {
          throw this.corrupt('projection ended without a done marker');
        }
        validateProjectionDoneRecord(record, this.descriptor);
        this.assertCompleteProjection();
        await this.verifySidecarIntegrity();
        this.verified = true;
        const result = this.emptyDoneResult();
        await this.closeHandle();
        return result;
      }
      if (record.kind === 'header') {
        throw this.corrupt('projection contains a second header');
      }
      this.validateAndSetPendingRecord(record);
    }

    const chunk = this.takeCreditChunk(creditBytes);
    const serializedChunk = JSON.stringify(chunk);
    const payloadBytes = Buffer.byteLength(serializedChunk, 'utf8');
    if (payloadBytes > creditBytes) {
      throw this.corrupt('projection chunk exceeds supplied credit');
    }
    return {
      projectionId: this.projectionId,
      supervisorInstanceId: this.supervisorInstanceId,
      sessionId: this.descriptor.sessionId,
      authorityId: this.descriptor.authorityId,
      targetRevision: this.descriptor.finalRevision,
      payloadBytes,
      chunkChecksum: createHash('sha256').update(serializedChunk, 'utf8').digest('hex'),
      chunk,
      done: false
    };
  }

  private validateAndSetPendingRecord(
    record: Exclude<CompletedTerminalHistoryArchiveProjectionRecord, CompletedTerminalHistoryArchiveProjectionHeader | { kind: 'done' }>
  ): void {
    validateProjectionStreamRecord(record, this.descriptor);
    if (record.kind === 'checkpoint') {
      if (this.checkpointComplete || record.dataOffset !== this.checkpointOffset) {
        throw this.corrupt('checkpoint records are not contiguous');
      }
      const nextCheckpointOffset = record.dataOffset + record.data.length;
      const expectedCheckpointLength = this.header!.checkpoint.checkpointDataLength;
      if (
        nextCheckpointOffset > expectedCheckpointLength ||
        (record.complete && nextCheckpointOffset !== expectedCheckpointLength)
      ) {
        throw this.corrupt('checkpoint completion does not match its declared data length');
      }
    } else if (!this.checkpointComplete) {
      throw this.corrupt('terminal event arrived before checkpoint completion');
    } else if (this.outputRevision !== undefined && record.kind !== 'output') {
      throw this.corrupt('an incomplete output record was interrupted by another event');
    } else if (record.kind === 'output') {
      if (this.outputRevision === undefined) {
        if (record.revision !== this.nextRevision || record.dataOffset !== 0) {
          throw this.corrupt('output records are not contiguous with the checkpoint');
        }
        this.outputRevision = record.revision;
        this.outputCreatedAtMs = record.createdAtMs;
        this.outputOffset = 0;
      } else if (
        record.revision !== this.outputRevision ||
        record.createdAtMs !== this.outputCreatedAtMs ||
        record.dataOffset !== this.outputOffset
      ) {
        throw this.corrupt('output records are not contiguous');
      }
    } else if (record.revision !== this.nextRevision) {
      throw this.corrupt('metadata revision is not contiguous with the stream');
    }
    this.pendingRecord = record;
    this.pendingRecordOffset = 0;
  }

  private takeCreditChunk(creditBytes: number): Record<string, unknown> {
    const record = this.pendingRecord!;
    if (record.kind === 'resize' || record.kind === 'scrollback') {
      this.pendingRecord = undefined;
      this.nextRevision = record.revision + 1;
      return record;
    }

    const remaining = record.data.slice(this.pendingRecordOffset);
    if (remaining.length === 0) {
      this.pendingRecord = undefined;
      if (record.kind === 'checkpoint') {
        this.checkpointOffset = record.dataOffset;
        this.checkpointComplete = record.complete;
      } else if (record.kind === 'output') {
        this.outputRevision = undefined;
        this.outputCreatedAtMs = undefined;
        this.outputOffset = 0;
        this.nextRevision = record.revision + 1;
      }
      return {
        kind: record.kind,
        ...(record.kind === 'checkpoint'
          ? { dataOffset: record.dataOffset, data: '', complete: record.complete }
          : {
              revision: record.revision,
              createdAtMs: record.createdAtMs,
              dataOffset: record.dataOffset,
              data: '',
              complete: record.complete
            })
      };
    }
    const maxUnits = Math.max(1, Math.min(remaining.length || 1, creditBytes));
    let lower = 1;
    let upper = maxUnits;
    let bestEnd = 0;
    while (lower <= upper) {
      const candidate = Math.floor((lower + upper) / 2);
      let end = candidate;
      if (splitsUtf16SurrogatePair(remaining, end)) {
        end -= 1;
      }
      if (end <= 0) {
        lower = candidate + 1;
        continue;
      }
      const candidateChunk = {
        kind: record.kind,
        ...(record.kind === 'checkpoint'
          ? { dataOffset: record.dataOffset + this.pendingRecordOffset, data: remaining.slice(0, end), complete: false }
          : {
              revision: record.revision,
              createdAtMs: record.createdAtMs,
              dataOffset: record.dataOffset + this.pendingRecordOffset,
              data: remaining.slice(0, end),
              complete: false
            })
      };
      if (Buffer.byteLength(JSON.stringify(candidateChunk), 'utf8') <= creditBytes) {
        bestEnd = end;
        lower = candidate + 1;
      } else {
        upper = candidate - 1;
      }
    }
    if (bestEnd === 0) {
      throw this.corrupt('projection credit cannot fit one Unicode code point');
    }

    const nextOffset = this.pendingRecordOffset + bestEnd;
    const complete = record.complete && nextOffset === record.data.length;
    const chunk: Record<string, unknown> = {
      kind: record.kind,
      ...(record.kind === 'checkpoint'
        ? { dataOffset: record.dataOffset + this.pendingRecordOffset, data: remaining.slice(0, bestEnd), complete }
        : {
            revision: record.revision,
            createdAtMs: record.createdAtMs,
            dataOffset: record.dataOffset + this.pendingRecordOffset,
            data: remaining.slice(0, bestEnd),
            complete
          })
    };
    this.pendingRecordOffset = nextOffset;
    if (nextOffset >= record.data.length) {
      if (record.kind === 'checkpoint') {
        this.checkpointOffset = record.dataOffset + record.data.length;
        if (record.complete) {
          this.checkpointComplete = true;
        }
      } else if (record.kind === 'output') {
        this.outputOffset = record.dataOffset + record.data.length;
        if (record.complete) {
          this.nextRevision = record.revision + 1;
          this.outputRevision = undefined;
          this.outputCreatedAtMs = undefined;
          this.outputOffset = 0;
        }
      }
      this.pendingRecord = undefined;
    }
    return chunk;
  }

  private async readRecord(): Promise<CompletedTerminalHistoryArchiveProjectionRecord | undefined> {
    const line = await this.readLine();
    if (!line) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw this.corrupt('projection contains invalid JSON', error);
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as { kind?: unknown }).kind !== 'string'
    ) {
      throw this.corrupt('projection record is not an object');
    }
    return parsed as CompletedTerminalHistoryArchiveProjectionRecord;
  }

  private async readLine(): Promise<string | undefined> {
    while (true) {
      const newline = this.pendingBytes.indexOf(0x0a);
      if (newline >= 0) {
        const lineBytes = this.pendingBytes.subarray(0, newline + 1);
        this.pendingBytes = this.pendingBytes.subarray(newline + 1);
        this.hash.update(lineBytes);
        this.bytesRead += lineBytes.byteLength;
        if (lineBytes.byteLength > ARCHIVE_PROJECTION_LINE_MAX_BYTES) {
          throw this.corrupt('projection record exceeds the line-size bound');
        }
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(lineBytes.subarray(0, -1));
        } catch (error) {
          throw this.corrupt('projection record is not valid UTF-8', error);
        }
      }
      const { bytesRead } = await this.handle.read(this.readBuffer, 0, this.readBuffer.byteLength, this.fileOffset);
      if (bytesRead === 0) {
        if (this.pendingBytes.length === 0) {
          return undefined;
        }
        throw this.corrupt('projection ended in the middle of a record');
      }
      this.fileOffset += bytesRead;
      this.pendingBytes = Buffer.concat([this.pendingBytes, this.readBuffer.subarray(0, bytesRead)]);
      if (this.pendingBytes.byteLength > ARCHIVE_PROJECTION_LINE_MAX_BYTES) {
        throw this.corrupt('projection record exceeds the line-size bound');
      }
    }
  }

  private assertCompleteProjection(): void {
    if (
      !this.header ||
      !this.checkpointComplete ||
      this.checkpointOffset !== this.header.checkpoint.checkpointDataLength ||
      this.outputRevision !== undefined ||
      this.outputCreatedAtMs !== undefined ||
      this.outputOffset !== 0 ||
      this.nextRevision !== this.header.finalRevision + 1
    ) {
      throw this.corrupt('projection done marker arrived before the revision barrier');
    }
  }

  private async verifySidecarIntegrity(): Promise<void> {
    if (
      this.bytesRead !== this.descriptor.projectionByteLength ||
      this.hash.digest('hex') !== this.descriptor.projectionSha256
    ) {
      throw this.corrupt('projection checksum or byte length does not match its descriptor');
    }
    if (
      this.pendingBytes.byteLength !== 0 ||
      this.fileOffset !== this.descriptor.projectionByteLength
    ) {
      throw this.corrupt('projection contains bytes after its done marker');
    }
    const probe = Buffer.alloc(1);
    const { bytesRead } = await this.handle.read(
      probe,
      0,
      probe.byteLength,
      this.descriptor.projectionByteLength
    );
    if (bytesRead !== 0) {
      throw this.corrupt('projection contains bytes after its declared byte length');
    }
  }

  private emptyDoneResult(): CompletedTerminalHistoryArchiveProjectionReadResult {
    return {
      projectionId: this.projectionId,
      supervisorInstanceId: this.supervisorInstanceId,
      sessionId: this.descriptor.sessionId,
      authorityId: this.descriptor.authorityId,
      targetRevision: this.descriptor.finalRevision,
      payloadBytes: 0,
      done: true,
      live: false
    };
  }

  private toOpenResult(
    header: CompletedTerminalHistoryArchiveProjectionHeader
  ): CompletedTerminalHistoryArchiveProjectionOpenResult {
    return {
      projectionId: this.projectionId,
      supervisorInstanceId: this.supervisorInstanceId,
      sessionId: header.sessionId,
      authorityId: header.authorityId,
      targetRevision: header.finalRevision,
      checkpoint: {
        version: header.checkpoint.version,
        sessionId: header.checkpoint.sessionId,
        authorityId: header.checkpoint.authorityId,
        revision: header.checkpoint.revision,
        cols: header.checkpoint.cols,
        rows: header.checkpoint.rows,
        scrollback: header.checkpoint.scrollback,
        createdAtMs: header.checkpoint.createdAtMs,
        serializedState: header.checkpoint.serializedState
      }
    };
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationChain.then(operation, operation);
    this.operationChain = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private async closeHandle(): Promise<void> {
    this.closed = true;
    if (this.handleClosed) {
      return;
    }
    this.handleClosed = true;
    await this.handle.close().catch(() => undefined);
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-io',
        `Completed terminal history archive projection ${this.descriptor.archiveId} is closed.`
      );
    }
  }

  private normalizeReadError(error: unknown): CompletedTerminalHistoryArchiveError {
    if (error instanceof CompletedTerminalHistoryArchiveError) {
      return error;
    }
    return new CompletedTerminalHistoryArchiveError(
      'archive-io',
      `Could not read completed terminal history archive projection ${this.descriptor.archiveId}.`,
      error
    );
  }

  private corrupt(detail: string, cause?: unknown): CompletedTerminalHistoryArchiveError {
    return new CompletedTerminalHistoryArchiveError(
      'archive-corrupt',
      `Completed terminal history archive projection ${this.descriptor.archiveId} ${detail}.`,
      cause
    );
  }
}

/**
 * Unions one immutable archive tree into another without replacing any
 * already-committed target entry.
 */
export function mergeCompletedTerminalHistoryArchiveDirectories(
  sourceArchiveRootPath: string,
  targetArchiveRootPath: string
): void {
  const normalizedSourcePath = path.normalize(sourceArchiveRootPath);
  const normalizedTargetPath = path.normalize(targetArchiveRootPath);
  if (normalizedSourcePath === normalizedTargetPath) {
    return;
  }

  const sourceStats = fs.lstatSync(normalizedSourcePath);
  if (!sourceStats.isDirectory()) {
    throw createArchiveMergeConflict('', 'source archive root is not a directory');
  }
  ensureArchiveMergeDirectory(normalizedTargetPath, '');
  mergeArchiveDirectoryEntries(normalizedSourcePath, normalizedTargetPath, '');
}

function mergeArchiveDirectoryEntries(
  sourceDirectoryPath: string,
  targetDirectoryPath: string,
  relativeDirectoryPath: string
): void {
  const entries = fs.readdirSync(sourceDirectoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    // A process crash may leave an uncommitted private directory behind.
    if (entry.isDirectory() && entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
      continue;
    }

    const relativePath = relativeDirectoryPath
      ? path.join(relativeDirectoryPath, entry.name)
      : entry.name;
    const sourcePath = path.join(sourceDirectoryPath, entry.name);
    const targetPath = path.join(targetDirectoryPath, entry.name);
    if (entry.isDirectory()) {
      ensureArchiveMergeDirectory(targetPath, relativePath);
      mergeArchiveDirectoryEntries(sourcePath, targetPath, relativePath);
      continue;
    }
    if (!entry.isFile()) {
      throw createArchiveMergeConflict(relativePath, 'source entry is not a regular file or directory');
    }

    mergeArchiveFile(sourcePath, targetPath, relativePath);
  }
}

function ensureArchiveMergeDirectory(directoryPath: string, relativePath: string): void {
  try {
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory()) {
      throw createArchiveMergeConflict(relativePath, 'target entry conflicts with a source directory');
    }
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error;
    }
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  }
}

function mergeArchiveFile(sourcePath: string, targetPath: string, relativePath: string): void {
  try {
    const targetStats = fs.lstatSync(targetPath);
    if (!targetStats.isFile()) {
      throw createArchiveMergeConflict(relativePath, 'target entry conflicts with a source file');
    }
    if (!archiveFilesMatch(sourcePath, targetPath)) {
      throw createArchiveMergeConflict(relativePath, 'source and target file contents differ');
    }
    return;
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  }

  let didCopy = false;
  try {
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    didCopy = true;
  } catch (error) {
    if (getErrorCode(error) !== 'EEXIST') {
      throw error;
    }
  }
  if (!didCopy && !archiveFilesMatch(sourcePath, targetPath)) {
    throw createArchiveMergeConflict(relativePath, 'existing target file contents differ from the source');
  }
}

interface ArchiveByteAccumulator {
  parts: Buffer[];
  byteLength: number;
  bytesSinceYield: number;
  pendingTextParts: string[];
  pendingTextChars: number;
}

/**
 * Serializes a normalized attach payload without asking JSON.stringify to
 * walk a multi-megabyte checkpoint or output string in one Host turn.
 */
class CompletedTerminalHistoryArchiveJsonWriter {
  private readonly accumulator: ArchiveByteAccumulator = {
    parts: [],
    byteLength: 0,
    bytesSinceYield: 0,
    pendingTextParts: [],
    pendingTextChars: 0
  };

  public appendLiteral(value: string): void {
    appendArchiveText(this.accumulator, value);
  }

  public appendValue(value: unknown): void {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError('Archive JSON writer received an unsupported value.');
    }
    this.appendLiteral(serialized);
  }

  public async appendString(value: string): Promise<void> {
    this.appendLiteral('"');
    let textStart = 0;
    const flushText = async (end: number): Promise<void> => {
      if (end <= textStart) {
        return;
      }
      this.appendLiteral(value.slice(textStart, end));
      textStart = end;
      await this.yieldIfNeeded();
    };

    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      let escape: string | undefined;
      if (code === 0x22) {
        escape = '\\"';
      } else if (code === 0x5c) {
        escape = '\\\\';
      } else if (code === 0x08) {
        escape = '\\b';
      } else if (code === 0x09) {
        escape = '\\t';
      } else if (code === 0x0a) {
        escape = '\\n';
      } else if (code === 0x0c) {
        escape = '\\f';
      } else if (code === 0x0d) {
        escape = '\\r';
      } else if (code < 0x20) {
        escape = `\\u${code.toString(16).padStart(4, '0')}`;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = index + 1 < value.length ? value.charCodeAt(index + 1) : undefined;
        if (next === undefined || next < 0xdc00 || next > 0xdfff) {
          escape = `\\u${code.toString(16).padStart(4, '0')}`;
        } else {
          // Keep a valid UTF-16 pair together when slicing the source string.
          index += 1;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        escape = `\\u${code.toString(16).padStart(4, '0')}`;
      }

      if (escape !== undefined) {
        await flushText(index);
        this.appendLiteral(escape);
        textStart = index + 1;
        await this.yieldIfNeeded();
      } else if (index + 1 - textStart >= ARCHIVE_MATERIALIZATION_TEXT_BUFFER_MAX_CHARS) {
        await flushText(index + 1);
      }
    }
    await flushText(value.length);
    this.appendLiteral('"');
    await this.yieldIfNeeded();
  }

  public get shouldYield(): boolean {
    return this.accumulator.bytesSinceYield >= ARCHIVE_MATERIALIZATION_BATCH_BYTES;
  }

  public async yieldIfNeeded(force = false): Promise<void> {
    if (force || this.shouldYield) {
      flushArchiveText(this.accumulator);
    }
    if (!force && !this.shouldYield) {
      return;
    }
    this.accumulator.bytesSinceYield = 0;
    await yieldArchiveMaterialization();
  }

  public async finish(): Promise<Buffer> {
    await this.yieldIfNeeded(true);
    return finishArchiveAccumulator(this.accumulator);
  }
}

async function buildCanonicalPayloadBytes(payload: TerminalStreamAttachPayload): Promise<Buffer> {
  const writer = new CompletedTerminalHistoryArchiveJsonWriter();
  writer.appendLiteral('{"version":');
  writer.appendValue(payload.version);
  writer.appendLiteral(',"sessionId":');
  await writer.appendString(payload.sessionId);
  writer.appendLiteral(',"authorityId":');
  await writer.appendString(payload.authorityId);
  writer.appendLiteral(',"revision":');
  writer.appendValue(payload.revision);
  writer.appendLiteral(',"checkpoint":{"version":');
  writer.appendValue(payload.checkpoint.version);
  writer.appendLiteral(',"sessionId":');
  await writer.appendString(payload.checkpoint.sessionId);
  writer.appendLiteral(',"authorityId":');
  await writer.appendString(payload.checkpoint.authorityId);
  writer.appendLiteral(',"revision":');
  writer.appendValue(payload.checkpoint.revision);
  writer.appendLiteral(',"cols":');
  writer.appendValue(payload.checkpoint.cols);
  writer.appendLiteral(',"rows":');
  writer.appendValue(payload.checkpoint.rows);
  writer.appendLiteral(',"scrollback":');
  writer.appendValue(payload.checkpoint.scrollback);
  writer.appendLiteral(',"createdAtMs":');
  writer.appendValue(payload.checkpoint.createdAtMs);
  writer.appendLiteral(',"serializedState":{"format":');
  await writer.appendString(payload.checkpoint.serializedState.format);
  writer.appendLiteral(',"data":');
  await writer.appendString(payload.checkpoint.serializedState.data);
  if (payload.checkpoint.serializedState.viewportY !== undefined) {
    writer.appendLiteral(',"viewportY":');
    writer.appendValue(payload.checkpoint.serializedState.viewportY);
  }
  if (payload.checkpoint.serializedState.outputSequence !== undefined) {
    writer.appendLiteral(',"outputSequence":');
    writer.appendValue(payload.checkpoint.serializedState.outputSequence);
  }
  writer.appendLiteral('}},"events":[');
  for (let index = 0; index < payload.events.length; index += 1) {
    if (index > 0) {
      writer.appendLiteral(',');
    }
    const event = payload.events[index];
    writer.appendLiteral('{"type":');
    await writer.appendString(event.type);
    writer.appendLiteral(',"revision":');
    writer.appendValue(event.revision);
    writer.appendLiteral(',"createdAtMs":');
    writer.appendValue(event.createdAtMs);
    if (event.type === 'output') {
      writer.appendLiteral(',"data":');
      await writer.appendString(event.data);
    } else if (event.type === 'resize') {
      writer.appendLiteral(',"cols":');
      writer.appendValue(event.cols);
      writer.appendLiteral(',"rows":');
      writer.appendValue(event.rows);
    } else {
      writer.appendLiteral(',"scrollback":');
      writer.appendValue(event.scrollback);
    }
    writer.appendLiteral('}');
    if (writer.shouldYield) {
      await writer.yieldIfNeeded();
    }
  }
  writer.appendLiteral(']}\n');
  return writer.finish();
}

async function buildProjectionBytes(
  payload: TerminalStreamAttachPayload,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): Promise<Buffer> {
  const accumulator: ArchiveByteAccumulator = {
    parts: [],
    byteLength: 0,
    bytesSinceYield: 0,
    pendingTextParts: [],
    pendingTextChars: 0
  };
  const checkpoint = payload.checkpoint;
  const { data: checkpointData, ...serializedState } = checkpoint.serializedState;
  const header: CompletedTerminalHistoryArchiveProjectionHeader = {
    kind: 'header',
    codec: COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC,
    archiveId: descriptor.archiveId,
    sha256: descriptor.sha256,
    byteLength: descriptor.byteLength,
    sessionId: payload.sessionId,
    authorityId: payload.authorityId,
    finalRevision: payload.revision,
    checkpoint: {
      version: checkpoint.version,
      sessionId: checkpoint.sessionId,
      authorityId: checkpoint.authorityId,
      revision: checkpoint.revision,
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      scrollback: checkpoint.scrollback,
      createdAtMs: checkpoint.createdAtMs,
      serializedState,
      checkpointDataLength: checkpointData.length
    }
  };
  appendProjectionRecord(accumulator, header);
  await yieldProjectionMaterializationIfNeeded(accumulator);
  await appendProjectionDataRecords(accumulator, checkpointData, (dataOffset, data, complete) => ({
    kind: 'checkpoint',
    dataOffset,
    data,
    complete
  }));
  for (const event of payload.events) {
    if (event.type === 'output') {
      await appendProjectionDataRecords(accumulator, event.data, (dataOffset, data, complete) => ({
        kind: 'output',
        revision: event.revision,
        createdAtMs: event.createdAtMs,
        dataOffset,
        data,
        complete
      }));
    } else if (event.type === 'resize') {
      appendProjectionRecord(accumulator, {
        kind: 'resize',
        revision: event.revision,
        createdAtMs: event.createdAtMs,
        cols: event.cols,
        rows: event.rows,
        complete: true
      });
      await yieldProjectionMaterializationIfNeeded(accumulator);
    } else {
      appendProjectionRecord(accumulator, {
        kind: 'scrollback',
        revision: event.revision,
        createdAtMs: event.createdAtMs,
        scrollback: event.scrollback,
        complete: true
      });
      await yieldProjectionMaterializationIfNeeded(accumulator);
    }
  }
  appendProjectionRecord(accumulator, { kind: 'done' });
  await yieldProjectionMaterializationIfNeeded(accumulator, true);
  return finishArchiveAccumulator(accumulator);
}

async function appendProjectionDataRecords<T extends { dataOffset: number; data: string; complete: boolean }>(
  accumulator: ArchiveByteAccumulator,
  data: string,
  createRecord: (dataOffset: number, data: string, complete: boolean) => T
): Promise<void> {
  if (data.length === 0) {
    appendProjectionRecord(accumulator, createRecord(0, '', true));
    await yieldProjectionMaterializationIfNeeded(accumulator);
    return;
  }
  let offset = 0;
  while (offset < data.length) {
    let end = Math.min(data.length, offset + ARCHIVE_PROJECTION_RECORD_MAX_CHARS);
    if (end < data.length && splitsUtf16SurrogatePair(data, end)) {
      end -= 1;
    }
    if (end <= offset) {
      end = Math.min(data.length, offset + 1);
    }
    const complete = end === data.length;
    appendProjectionRecord(accumulator, createRecord(offset, data.slice(offset, end), complete));
    await yieldProjectionMaterializationIfNeeded(accumulator);
    offset = end;
  }
}

function appendProjectionRecord(accumulator: ArchiveByteAccumulator, record: object): void {
  appendArchiveText(accumulator, `${JSON.stringify(record)}\n`);
}

function appendArchiveText(accumulator: ArchiveByteAccumulator, value: string): void {
  let offset = 0;
  while (offset < value.length) {
    if (accumulator.pendingTextChars >= ARCHIVE_MATERIALIZATION_TEXT_BUFFER_MAX_CHARS) {
      flushArchiveText(accumulator);
    }
    const available = ARCHIVE_MATERIALIZATION_TEXT_BUFFER_MAX_CHARS - accumulator.pendingTextChars;
    let end = Math.min(value.length, offset + available);
    if (end < value.length && splitsUtf16SurrogatePair(value, end)) {
      end -= 1;
    }
    if (end <= offset) {
      flushArchiveText(accumulator);
      continue;
    }
    const part = value.slice(offset, end);
    accumulator.pendingTextParts.push(part);
    accumulator.pendingTextChars += part.length;
    offset = end;
  }
}

function flushArchiveText(accumulator: ArchiveByteAccumulator): void {
  if (accumulator.pendingTextChars === 0) {
    return;
  }
  const text = accumulator.pendingTextParts.join('');
  accumulator.pendingTextParts = [];
  accumulator.pendingTextChars = 0;
  appendArchiveBuffer(accumulator, Buffer.from(text, 'utf8'));
}

function appendArchiveBuffer(accumulator: ArchiveByteAccumulator, part: Buffer): void {
  accumulator.parts.push(part);
  accumulator.byteLength += part.byteLength;
  accumulator.bytesSinceYield += part.byteLength;
}

async function finishArchiveAccumulator(accumulator: ArchiveByteAccumulator): Promise<Buffer> {
  flushArchiveText(accumulator);
  const bytes = Buffer.allocUnsafe(accumulator.byteLength);
  let targetOffset = 0;
  let copiedSinceYield = 0;
  for (const part of accumulator.parts) {
    part.copy(bytes, targetOffset);
    targetOffset += part.byteLength;
    copiedSinceYield += part.byteLength;
    if (copiedSinceYield >= ARCHIVE_MATERIALIZATION_BATCH_BYTES) {
      copiedSinceYield = 0;
      await yieldArchiveMaterialization();
    }
  }
  return bytes;
}

async function yieldProjectionMaterializationIfNeeded(
  accumulator: ArchiveByteAccumulator,
  force = false
): Promise<void> {
  if (force || accumulator.bytesSinceYield >= ARCHIVE_MATERIALIZATION_BATCH_BYTES) {
    flushArchiveText(accumulator);
  }
  if (!force && accumulator.bytesSinceYield < ARCHIVE_MATERIALIZATION_BATCH_BYTES) {
    return;
  }
  accumulator.bytesSinceYield = 0;
  await yieldArchiveMaterialization();
}

function validateProjectionHeader(
  header: CompletedTerminalHistoryArchiveProjectionHeader,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): void {
  const checkpoint = header.checkpoint;
  const serializedState = checkpoint && checkpoint.serializedState;
  if (
    !hasOnlyProjectionKeys(header, [
      'kind',
      'codec',
      'archiveId',
      'sha256',
      'byteLength',
      'sessionId',
      'authorityId',
      'finalRevision',
      'checkpoint'
    ]) ||
    header.kind !== 'header' ||
    header.codec !== COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC ||
    header.archiveId !== descriptor.archiveId ||
    header.sha256 !== descriptor.sha256 ||
    header.byteLength !== descriptor.byteLength ||
    header.sessionId !== descriptor.sessionId ||
    header.authorityId !== descriptor.authorityId ||
    header.finalRevision !== descriptor.finalRevision ||
    !isProjectionRecordObject(checkpoint) ||
    !hasOnlyProjectionKeys(checkpoint, [
      'version',
      'sessionId',
      'authorityId',
      'revision',
      'cols',
      'rows',
      'scrollback',
      'createdAtMs',
      'serializedState',
      'checkpointDataLength'
    ]) ||
    checkpoint.version !== TERMINAL_SESSION_STREAM_VERSION ||
    checkpoint.sessionId !== descriptor.sessionId ||
    checkpoint.authorityId !== descriptor.authorityId ||
    !isProjectionRevision(checkpoint.revision) ||
    checkpoint.revision > descriptor.finalRevision ||
    !isProjectionDimension(checkpoint.cols, 2) ||
    !isProjectionDimension(checkpoint.rows, 1) ||
    !isProjectionRevision(checkpoint.scrollback) ||
    !isProjectionTimestamp(checkpoint.createdAtMs) ||
    !isProjectionRecordObject(serializedState) ||
    !hasOnlyProjectionKeys(
      serializedState,
      ['format', 'viewportY', 'outputSequence'],
      ['format', 'outputSequence']
    ) ||
    serializedState.format !== ARCHIVE_PROJECTION_SERIALIZED_STATE_FORMAT ||
    (
      serializedState.viewportY !== undefined &&
      !isProjectionDimension(serializedState.viewportY, 0)
    ) ||
    serializedState.outputSequence !== checkpoint.revision ||
    !Number.isSafeInteger(checkpoint.checkpointDataLength) ||
    checkpoint.checkpointDataLength < 0 ||
    checkpoint.checkpointDataLength > ARCHIVE_PROJECTION_CHECKPOINT_DATA_MAX_CHARS
  ) {
    throw new CompletedTerminalHistoryArchiveError(
      'archive-corrupt',
      `Completed terminal history archive projection ${descriptor.archiveId} has an invalid header.`
    );
  }
}

function validateProjectionStreamRecord(
  record: Exclude<
    CompletedTerminalHistoryArchiveProjectionRecord,
    CompletedTerminalHistoryArchiveProjectionHeader | { kind: 'done' }
  >,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): void {
  if (record.kind === 'checkpoint') {
    if (
      !hasOnlyProjectionKeys(record, ['kind', 'dataOffset', 'data', 'complete']) ||
      !isProjectionDataOffset(record.dataOffset) ||
      typeof record.data !== 'string' ||
      record.data.length > ARCHIVE_PROJECTION_RECORD_MAX_CHARS ||
      typeof record.complete !== 'boolean' ||
      (!record.complete && record.data.length === 0) ||
      !Number.isSafeInteger(record.dataOffset + record.data.length)
    ) {
      throw createCorruptProjectionRecordError(descriptor, 'checkpoint');
    }
    return;
  }

  if (record.kind === 'output') {
    if (
      !hasOnlyProjectionKeys(record, [
        'kind',
        'revision',
        'createdAtMs',
        'dataOffset',
        'data',
        'complete'
      ]) ||
      !isProjectionEventRevision(record.revision, descriptor.finalRevision) ||
      !isProjectionTimestamp(record.createdAtMs) ||
      !isProjectionDataOffset(record.dataOffset) ||
      typeof record.data !== 'string' ||
      record.data.length === 0 ||
      record.data.length > ARCHIVE_PROJECTION_RECORD_MAX_CHARS ||
      typeof record.complete !== 'boolean' ||
      !Number.isSafeInteger(record.dataOffset + record.data.length)
    ) {
      throw createCorruptProjectionRecordError(descriptor, 'output');
    }
    return;
  }

  if (record.kind === 'resize') {
    if (
      !hasOnlyProjectionKeys(record, [
        'kind',
        'revision',
        'createdAtMs',
        'cols',
        'rows',
        'complete'
      ]) ||
      !isProjectionEventRevision(record.revision, descriptor.finalRevision) ||
      !isProjectionTimestamp(record.createdAtMs) ||
      !isProjectionDimension(record.cols, 2) ||
      !isProjectionDimension(record.rows, 1) ||
      record.complete !== true
    ) {
      throw createCorruptProjectionRecordError(descriptor, 'resize');
    }
    return;
  }

  if (record.kind === 'scrollback') {
    if (
      !hasOnlyProjectionKeys(record, [
        'kind',
        'revision',
        'createdAtMs',
        'scrollback',
        'complete'
      ]) ||
      !isProjectionEventRevision(record.revision, descriptor.finalRevision) ||
      !isProjectionTimestamp(record.createdAtMs) ||
      !isProjectionRevision(record.scrollback) ||
      record.complete !== true
    ) {
      throw createCorruptProjectionRecordError(descriptor, 'scrollback');
    }
    return;
  }

  throw createCorruptProjectionRecordError(descriptor, 'unknown');
}

function validateProjectionDoneRecord(
  record: Extract<CompletedTerminalHistoryArchiveProjectionRecord, { kind: 'done' }>,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): void {
  if (!hasOnlyProjectionKeys(record, ['kind'])) {
    throw createCorruptProjectionRecordError(descriptor, 'done');
  }
}

function createCorruptProjectionRecordError(
  descriptor: CompletedTerminalHistoryArchiveDescriptor,
  kind: string
): CompletedTerminalHistoryArchiveError {
  return new CompletedTerminalHistoryArchiveError(
    'archive-corrupt',
    `Completed terminal history archive projection ${descriptor.archiveId} has an invalid ${kind} record.`
  );
}

function hasOnlyProjectionKeys(
  value: object,
  expectedKeys: readonly string[],
  requiredKeys: readonly string[] = expectedKeys
): boolean {
  const keys = Object.keys(value);
  return (
    keys.every((key) => expectedKeys.includes(key)) &&
    requiredKeys.every((key) => keys.includes(key))
  );
}

function isProjectionRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProjectionRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isProjectionEventRevision(value: unknown, finalRevision: number): value is number {
  return isProjectionRevision(value) && value > 0 && value <= finalRevision;
}

function isProjectionDataOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isProjectionTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isProjectionDimension(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

async function verifyProjectionFile(
  projectionFilePath: string,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): Promise<void> {
  if (descriptor.projectionCodec !== COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC) {
    return;
  }
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(projectionFilePath, 'r');
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== descriptor.projectionByteLength) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive projection ${descriptor.archiveId} has an unexpected byte length.`
      );
    }
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < stats.size) {
      const length = Math.min(buffer.byteLength, stats.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead === 0) {
        throw new CompletedTerminalHistoryArchiveError(
          'archive-corrupt',
          `Completed terminal history archive projection ${descriptor.archiveId} ended before its declared byte length.`
        );
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const checksum = hash.digest('hex');
    if (checksum !== descriptor.projectionSha256) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive projection ${descriptor.archiveId} checksum does not match its descriptor.`
      );
    }
  } catch (error) {
    if (error instanceof CompletedTerminalHistoryArchiveError) {
      throw error;
    }
    if (isFileNotFoundError(error)) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-not-found',
        `Completed terminal history archive projection ${descriptor.archiveId} does not exist.`,
        error
      );
    }
    throw new CompletedTerminalHistoryArchiveError(
      'archive-io',
      `Could not verify completed terminal history archive projection ${descriptor.archiveId}.`,
      error
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function archiveFilesMatch(leftPath: string, rightPath: string): boolean {
  const leftStats = fs.statSync(leftPath);
  const rightStats = fs.statSync(rightPath);
  if (!leftStats.isFile() || !rightStats.isFile() || leftStats.size !== rightStats.size) {
    return false;
  }

  const chunkBytes = 64 * 1024;
  const leftBuffer = Buffer.allocUnsafe(Math.min(chunkBytes, Math.max(1, leftStats.size)));
  const rightBuffer = Buffer.allocUnsafe(leftBuffer.byteLength);
  let leftFd: number | undefined;
  let rightFd: number | undefined;
  try {
    leftFd = fs.openSync(leftPath, 'r');
    rightFd = fs.openSync(rightPath, 'r');
    let offset = 0;
    while (offset < leftStats.size) {
      const bytesToRead = Math.min(leftBuffer.byteLength, leftStats.size - offset);
      const leftBytesRead = fs.readSync(leftFd, leftBuffer, 0, bytesToRead, offset);
      const rightBytesRead = fs.readSync(rightFd, rightBuffer, 0, bytesToRead, offset);
      if (
        leftBytesRead !== bytesToRead ||
        rightBytesRead !== bytesToRead ||
        !leftBuffer.subarray(0, bytesToRead).equals(rightBuffer.subarray(0, bytesToRead))
      ) {
        return false;
      }
      offset += bytesToRead;
    }
    return true;
  } finally {
    if (rightFd !== undefined) {
      try {
        fs.closeSync(rightFd);
      } catch {
        // Preserve the original comparison/IO error while still attempting
        // to release the other descriptor below.
      }
    }
    if (leftFd !== undefined) {
      try {
        fs.closeSync(leftFd);
      } catch {
        // See the right descriptor cleanup above.
      }
    }
  }
}

function createArchiveMergeConflict(relativePath: string, detail: string): CompletedTerminalHistoryArchiveError {
  const entryLabel = relativePath || '.';
  return new CompletedTerminalHistoryArchiveError(
    'archive-corrupt',
    `Completed terminal history archive merge conflict at ${entryLabel}: ${detail}.`
  );
}

function requireDescriptor(value: unknown): CompletedTerminalHistoryArchiveDescriptor {
  const descriptor = normalizeCompletedTerminalHistoryArchiveDescriptor(value);
  if (!descriptor) {
    throw new CompletedTerminalHistoryArchiveError(
      'invalid-descriptor',
      'Completed terminal history archive descriptor is invalid.'
    );
  }
  return descriptor;
}

async function verifyExistingArchive(
  archiveFilePath: string,
  archiveProjectionFilePath: string,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): Promise<boolean> {
  try {
    await verifyArchiveFileChecksum(archiveFilePath, descriptor, 'archive-corrupt');
    if (descriptor.projectionCodec === COMPLETED_TERMINAL_HISTORY_ARCHIVE_PROJECTION_CODEC) {
      await verifyProjectionFile(archiveProjectionFilePath, descriptor);
    }
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Fast reload-path validation for a descriptor that already has a sidecar.
 * The canonical blob remains the durable fallback, but parsing it here would
 * defeat the bounded projection transport and reintroduce reload HOL blocking.
 */
async function verifyExistingProjectionSidecar(
  archiveFilePath: string,
  archiveProjectionFilePath: string,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(archiveFilePath);
    if (!stats.isFile() || stats.size !== descriptor.byteLength) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive ${descriptor.archiveId} has an unexpected byte length.`
      );
    }
    await verifyProjectionFile(archiveProjectionFilePath, descriptor);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function verifyCanonicalArchive(
  archiveFilePath: string,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): Promise<boolean> {
  try {
    await verifyArchiveFileChecksum(archiveFilePath, descriptor, 'archive-corrupt');
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function installProjectionSidecar(
  projectionFilePath: string,
  bytes: Buffer,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): Promise<void> {
  const temporaryPath = `${projectionFilePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeDurableFile(temporaryPath, bytes);
    try {
      await fs.promises.rename(temporaryPath, projectionFilePath);
    } catch (error) {
      if (getErrorCode(error) !== 'EEXIST') {
        throw error;
      }
    }
    await fsyncDirectory(path.dirname(projectionFilePath));
    await verifyProjectionFile(projectionFilePath, descriptor);
  } catch (error) {
    if (error instanceof CompletedTerminalHistoryArchiveError) {
      throw error;
    }
    throw new CompletedTerminalHistoryArchiveError(
      'archive-io',
      `Could not install completed terminal history archive projection ${descriptor.archiveId}.`,
      error
    );
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function installProjectionSidecarFromFile(
  stagedProjectionFilePath: string,
  projectionFilePath: string,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): Promise<void> {
  try {
    try {
      // Both paths live below the archive root, so a hard link provides an
      // atomic, exclusive publication without copying the sidecar into RAM.
      await fs.promises.link(stagedProjectionFilePath, projectionFilePath);
    } catch (error) {
      if (getErrorCode(error) !== 'EEXIST') {
        throw error;
      }
    }
    await fsyncDirectory(path.dirname(projectionFilePath));
    await verifyProjectionFile(projectionFilePath, descriptor);
  } catch (error) {
    if (error instanceof CompletedTerminalHistoryArchiveError) {
      throw error;
    }
    throw new CompletedTerminalHistoryArchiveError(
      'archive-io',
      `Could not install completed terminal history archive projection ${descriptor.archiveId}.`,
      error
    );
  }
}

function splitsUtf16SurrogatePair(data: string, offset: number): boolean {
  if (offset <= 0 || offset >= data.length) {
    return false;
  }
  const previous = data.charCodeAt(offset - 1);
  const next = data.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

async function hashArchiveBytes(bytes: Buffer): Promise<string> {
  const hash = createHash('sha256');
  for (let offset = 0; offset < bytes.byteLength; offset += ARCHIVE_MATERIALIZATION_BATCH_BYTES) {
    const end = Math.min(bytes.byteLength, offset + ARCHIVE_MATERIALIZATION_BATCH_BYTES);
    hash.update(bytes.subarray(offset, end));
    if (end < bytes.byteLength) {
      await yieldArchiveMaterialization();
    }
  }
  return hash.digest('hex');
}

function yieldArchiveMaterialization(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function readArchiveFile(
  archiveFilePath: string,
  descriptor: CompletedTerminalHistoryArchiveDescriptor,
  missingCode: 'archive-not-found' | 'archive-corrupt'
): Promise<Buffer> {
  try {
    const stats = await fs.promises.stat(archiveFilePath);
    if (!stats.isFile() || stats.size !== descriptor.byteLength) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive ${descriptor.archiveId} has an unexpected byte length.`
      );
    }
    return await fs.promises.readFile(archiveFilePath);
  } catch (error) {
    if (error instanceof CompletedTerminalHistoryArchiveError) {
      throw error;
    }
    if (isFileNotFoundError(error)) {
      throw new CompletedTerminalHistoryArchiveError(
        missingCode,
        `Completed terminal history archive ${descriptor.archiveId} does not exist.`,
        error
      );
    }
    throw new CompletedTerminalHistoryArchiveError(
      'archive-io',
      `Could not read completed terminal history archive ${descriptor.archiveId}.`,
      error
    );
  }
}

async function verifyArchiveFileChecksum(
  archiveFilePath: string,
  descriptor: CompletedTerminalHistoryArchiveDescriptor,
  missingCode: 'archive-not-found' | 'archive-corrupt'
): Promise<void> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(archiveFilePath, 'r');
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== descriptor.byteLength) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive ${descriptor.archiveId} has an unexpected byte length.`
      );
    }

    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < descriptor.byteLength) {
      const length = Math.min(buffer.byteLength, descriptor.byteLength - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead === 0) {
        throw new CompletedTerminalHistoryArchiveError(
          'archive-corrupt',
          `Completed terminal history archive ${descriptor.archiveId} ended before its declared byte length.`
        );
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const finalStats = await handle.stat();
    if (!finalStats.isFile() || finalStats.size !== descriptor.byteLength) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive ${descriptor.archiveId} changed while it was being verified.`
      );
    }
    if (hash.digest('hex') !== descriptor.sha256) {
      throw new CompletedTerminalHistoryArchiveError(
        'archive-corrupt',
        `Completed terminal history archive ${descriptor.archiveId} checksum does not match its descriptor.`
      );
    }
  } catch (error) {
    if (error instanceof CompletedTerminalHistoryArchiveError) {
      throw error;
    }
    if (isFileNotFoundError(error)) {
      throw new CompletedTerminalHistoryArchiveError(
        missingCode,
        `Completed terminal history archive ${descriptor.archiveId} does not exist.`,
        error
      );
    }
    throw new CompletedTerminalHistoryArchiveError(
      'archive-io',
      `Could not verify completed terminal history archive ${descriptor.archiveId}.`,
      error
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function verifyArchiveBytes(
  bytes: Buffer,
  descriptor: CompletedTerminalHistoryArchiveDescriptor
): TerminalStreamAttachPayload {
  if (bytes.byteLength !== descriptor.byteLength) {
    throw new CompletedTerminalHistoryArchiveError(
      'archive-corrupt',
      `Completed terminal history archive ${descriptor.archiveId} has an unexpected byte length.`
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== descriptor.sha256) {
    throw new CompletedTerminalHistoryArchiveError(
      'archive-corrupt',
      `Completed terminal history archive ${descriptor.archiveId} checksum does not match its descriptor.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new CompletedTerminalHistoryArchiveError(
      'archive-corrupt',
      `Completed terminal history archive ${descriptor.archiveId} is not valid UTF-8 JSON.`,
      error
    );
  }
  const payload = normalizeTerminalStreamAttachPayload(parsed);
  if (!payload) {
    throw new CompletedTerminalHistoryArchiveError(
      'archive-corrupt',
      `Completed terminal history archive ${descriptor.archiveId} payload is invalid.`
    );
  }
  if (
    payload.sessionId !== descriptor.sessionId ||
    payload.authorityId !== descriptor.authorityId ||
    payload.revision !== descriptor.finalRevision
  ) {
    throw new CompletedTerminalHistoryArchiveError(
      'archive-corrupt',
      `Completed terminal history archive ${descriptor.archiveId} identity or final revision does not match its descriptor.`
    );
  }
  return payload;
}

async function writeDurableFile(filePath: string, bytes: Buffer): Promise<void> {
  const handle = await fs.promises.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
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
    const code = getErrorCode(error);
    if (process.platform === 'win32' && (code === 'EINVAL' || code === 'ENOTSUP' || code === 'EPERM')) {
      return;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof CompletedTerminalHistoryArchiveError) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return error.code === 'archive-not-found' ||
      (error.code === 'archive-corrupt' && getErrorCode(cause) === 'ENOENT');
  }
  return getErrorCode(error) === 'ENOENT';
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
