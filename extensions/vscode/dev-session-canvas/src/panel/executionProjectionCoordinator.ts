import type { ExecutionNodeKind, CanvasSurfaceLocation, WebviewLifecycleIdentity } from '../common/protocol';

/** The three admission classes used by the surface-local projection scheduler. */
export type ExecutionProjectionPriority = 'selected' | 'visible' | 'background';

export type ExecutionProjectionPhase =
  | 'queued'
  | 'opening'
  | 'restoring'
  | 'awaiting-ack'
  | 'ready'
  | 'failed';

export interface ExecutionProjectionIdentity {
  surface: CanvasSurfaceLocation;
  lifecycle: WebviewLifecycleIdentity;
  nodeId: string;
  kind: ExecutionNodeKind;
  controllerGeneration: string;
  sessionId: string;
  supervisorInstanceId: string;
  sourceKey: string;
}

export interface ExecutionProjectionOpenResult {
  projectionId: string;
  supervisorInstanceId?: string;
  sessionId: string;
  authorityId: string;
  targetRevision: number;
  checkpoint: unknown;
}

export interface ExecutionProjectionReadResult {
  projectionId: string;
  supervisorInstanceId?: string;
  sessionId: string;
  authorityId: string;
  targetRevision: number;
  payloadBytes: number;
  chunkChecksum?: string;
  chunk?: unknown;
  done: boolean;
  live?: boolean;
}

export interface ExecutionProjectionTransport {
  open(params: {
    sessionId: string;
    authorityId?: string;
    follow?: boolean;
  }): Promise<ExecutionProjectionOpenResult>;
  read(params: {
    projectionId: string;
    creditBytes: number;
  }): Promise<ExecutionProjectionReadResult>;
  cancel(params: { projectionId: string }): Promise<unknown>;
  /** Releases a locally opened source when open fails before a projection id exists. */
  close?: () => Promise<void>;
}

export interface ExecutionProjectionJob extends ExecutionProjectionIdentity {
  key: string;
  priority: ExecutionProjectionPriority;
  phase: ExecutionProjectionPhase;
  projectionId?: string;
  authorityId?: string;
  initialTargetRevision?: number;
  /** Highest target accepted from this projection; follow targets may only grow. */
  latestTargetRevision?: number;
  readyRevision?: number;
  nextSequence: number;
  awaitingSequence?: number;
  /** A data-bearing response can be terminal; readiness waits for its ACK. */
  awaitingDone?: boolean;
  awaitingLive?: boolean;
  awaitingTargetRevision?: number;
  appliedRevision: number;
  openedCheckpoint?: unknown;
  readInFlight: boolean;
  /** Credit granted by the Webview for the next pull. Zero means no pull is admitted. */
  creditBytes: number;
  queuedAtMs: number;
  lastServedAtMs: number;
  failureMessage?: string;
  /** Cached transport lets cancellation release a server pin after the Host record is removed. */
  transport?: ExecutionProjectionTransport;
}

export interface ExecutionProjectionCoordinatorCallbacks {
  /** Return false when the Webview frame/controller has already been replaced. */
  isCurrent: (job: ExecutionProjectionJob) => boolean;
  getTransport: (job: ExecutionProjectionJob) => Promise<ExecutionProjectionTransport>;
  onState: (job: ExecutionProjectionJob, state: ExecutionProjectionPhase, detail?: {
    projectionId?: string;
    authorityId?: string;
    targetRevision?: number;
    readyRevision?: number;
    checkpoint?: unknown;
    message?: string;
  }) => void;
  /** Publishes a validated follow-target advance before its chunk or ready callback. */
  onTargetAdvanced?: (job: ExecutionProjectionJob, targetRevision: number) => void;
  onChunk: (job: ExecutionProjectionJob, result: ExecutionProjectionReadResult, sequence: number) => void;
  onReady: (job: ExecutionProjectionJob, readyRevision: number, live: boolean) => void;
  onFailed: (job: ExecutionProjectionJob, error: Error) => void;
}

export type ExecutionProjectionLiveEventDecision =
  | { action: 'ignore'; liveTailFloor: number }
  | { action: 'deliver'; liveTailFloor: number }
  | { action: 'gap'; liveTailFloor: number; expectedRevision: number };

/**
 * Classifies an event observed on a multiplexed bulk socket. While a follow
 * projection is not ready, its credit-driven stream is the sole display
 * source; shared-socket events are redundant observations and must not queue.
 */
export function classifyExecutionProjectionLiveEvent(input: {
  ready: boolean;
  latestTargetRevision?: number;
  lastLiveRevision?: number;
  eventRevision: number;
}): ExecutionProjectionLiveEventDecision {
  const liveTailFloor = Math.max(
    input.latestTargetRevision ?? 0,
    input.lastLiveRevision ?? 0
  );
  if (!input.ready || input.eventRevision <= liveTailFloor) {
    return { action: 'ignore', liveTailFloor };
  }
  const expectedRevision = liveTailFloor + 1;
  if (input.eventRevision !== expectedRevision) {
    return { action: 'gap', liveTailFloor, expectedRevision };
  }
  return { action: 'deliver', liveTailFloor };
}

const MAX_OPEN_PROJECTIONS = 4;
const MAX_PRIORITY_OVERFLOW_PROJECTIONS = 1;
const MAX_IN_FLIGHT_READS = 2;
const MIN_PROJECTION_CREDIT_BYTES = 256;
const MAX_PROJECTION_CREDIT_BYTES = 64 * 1024;
const PRIORITY_PATTERN: ExecutionProjectionPriority[] = [
  'selected', 'selected', 'selected', 'selected', 'selected', 'selected', 'selected', 'selected',
  'visible', 'visible', 'visible',
  'background'
];

/**
 * Coordinates history transfer without letting a large terminal monopolize the Host event loop.
 * Opening/pinning is bounded; fairness is enforced at chunk boundaries, after Webview ACKs.
 */
export class ExecutionProjectionCoordinator {
  private readonly jobs = new Map<string, ExecutionProjectionJob>();
  private pumpScheduled = false;
  private disposed = false;
  private admissionPatternCursor = 0;
  private readPatternCursor = 0;
  private inFlightReads = 0;

  public constructor(private readonly callbacks: ExecutionProjectionCoordinatorCallbacks) {}

  public enqueue(request: Omit<ExecutionProjectionIdentity, 'sourceKey'> & {
    sourceKey: string;
    priority: ExecutionProjectionPriority;
  }): ExecutionProjectionJob {
    const key = this.getJobKey(request);
    // A remounted controller has a new generation/key but still owns the same
    // surface-local source. Retire every previous generation before replacing it.
    this.cancelSourceKey(request.sourceKey);
    const now = Date.now();
    const job: ExecutionProjectionJob = {
      ...request,
      key,
      phase: 'queued',
      nextSequence: 1,
      appliedRevision: 0,
      readInFlight: false,
      creditBytes: 0,
      queuedAtMs: now,
      lastServedAtMs: 0
    };
    this.jobs.set(key, job);
    this.callbacks.onState(job, 'queued');
    this.schedulePump();
    return job;
  }

  public updatePriority(
    surface: CanvasSurfaceLocation,
    lifecycle: WebviewLifecycleIdentity,
    nodeId: string,
    controllerGeneration: string,
    priority: ExecutionProjectionPriority
  ): void {
    const job = this.find(surface, lifecycle, nodeId, controllerGeneration);
    if (!job || !this.callbacks.isCurrent(job) || job.phase === 'failed' || job.phase === 'ready') {
      return;
    }
    job.priority = priority;
    this.schedulePump();
  }

  public acknowledgeChunk(
    surface: CanvasSurfaceLocation,
    lifecycle: WebviewLifecycleIdentity,
    nodeId: string,
    kind: ExecutionNodeKind,
    controllerGeneration: string,
    projectionId: string,
    sequence: number,
    appliedRevision: number,
    creditBytes: number
  ): boolean {
    const job = this.find(surface, lifecycle, nodeId, controllerGeneration, kind);
    if (
      !job ||
      !this.callbacks.isCurrent(job) ||
      job.phase !== 'awaiting-ack' ||
      job.projectionId !== projectionId ||
      job.awaitingSequence !== sequence ||
      !Number.isSafeInteger(appliedRevision) ||
      appliedRevision < job.appliedRevision ||
      !this.isValidCredit(creditBytes)
    ) {
      return false;
    }
    job.appliedRevision = appliedRevision;
    const completed = job.awaitingDone === true;
    const live = job.awaitingLive === true;
    const awaitingTargetRevision = job.awaitingTargetRevision;
    if (
      awaitingTargetRevision === undefined ||
      appliedRevision > awaitingTargetRevision ||
      (completed && appliedRevision < awaitingTargetRevision)
    ) {
      this.failJob(job, new Error('Terminal projection ACK did not prove the terminal revision barrier.'));
      return false;
    }
    job.awaitingDone = undefined;
    job.awaitingLive = undefined;
    job.awaitingTargetRevision = undefined;
    if (completed) {
      const readyRevision = Math.max(job.appliedRevision, job.initialTargetRevision ?? job.appliedRevision);
      job.readyRevision = readyRevision;
      job.awaitingSequence = undefined;
      job.phase = 'ready';
      this.schedulePump();
      this.callbacks.onReady(job, readyRevision, live);
      return true;
    }
    job.creditBytes = creditBytes;
    job.awaitingSequence = undefined;
    job.phase = 'restoring';
    this.schedulePump();
    return true;
  }

  /** Allows a Webview to explicitly grant the next pull; the coordinator still
   * enforces one read per ACK and caps the actual credit to its transport budget. */
  public requestCredit(
    surface: CanvasSurfaceLocation,
    nodeId: string,
    kind: ExecutionNodeKind,
    controllerGeneration: string,
    projectionId: string,
    creditBytes: number
  ): boolean {
    const job = Array.from(this.jobs.values()).find(
      (candidate) =>
        candidate.surface === surface &&
        candidate.nodeId === nodeId &&
        candidate.kind === kind &&
        candidate.controllerGeneration === controllerGeneration &&
        candidate.projectionId === projectionId
    );
    if (
      !job ||
      !this.callbacks.isCurrent(job) ||
      job.phase === 'failed' ||
      job.phase === 'ready' ||
      !this.isValidCredit(creditBytes)
    ) {
      return false;
    }
    // A credit request is only meaningful after the previous pull has
    // completed; this keeps one chunk in flight per projection.
    if (job.phase !== 'restoring' || job.readInFlight) {
      return false;
    }
    job.creditBytes = creditBytes;
    this.schedulePump();
    return true;
  }

  public cancel(key: string): void {
    // Host records use a compact surface/kind/node key, while coordinator jobs
    // also include lifecycle and controller generation. Accept either identity
    // so cancellation always releases the server-side projection pin.
    const exactJob = this.jobs.get(key);
    if (exactJob) {
      this.cancelJob(exactJob);
      this.schedulePump();
      return;
    }
    this.cancelSourceKey(key);
  }

  public cancelForSurface(surface: CanvasSurfaceLocation, lifecycle?: WebviewLifecycleIdentity): void {
    for (const [key, job] of this.jobs) {
      if (job.surface !== surface) {
        continue;
      }
      if (lifecycle && this.sameLifecycle(job.lifecycle, lifecycle)) {
        continue;
      }
      this.cancel(key);
    }
  }

  public cancelAll(): void {
    for (const key of Array.from(this.jobs.keys())) {
      this.cancel(key);
    }
  }

  public getJob(
    surface: CanvasSurfaceLocation,
    lifecycle: WebviewLifecycleIdentity,
    nodeId: string,
    controllerGeneration: string,
    kind?: ExecutionNodeKind
  ): ExecutionProjectionJob | undefined {
    return this.find(surface, lifecycle, nodeId, controllerGeneration, kind);
  }

  public getReadyJobs(sessionId: string, authorityId: string): ExecutionProjectionJob[] {
    return Array.from(this.jobs.values()).filter(
      (job) =>
        job.phase === 'ready' &&
        job.sessionId === sessionId &&
        job.authorityId === authorityId &&
        this.callbacks.isCurrent(job)
    );
  }

  public getJobsForSession(sessionId: string, authorityId?: string): ExecutionProjectionJob[] {
    return Array.from(this.jobs.values()).filter(
      (job) =>
        job.sessionId === sessionId &&
        (authorityId === undefined || job.authorityId === authorityId) &&
        this.callbacks.isCurrent(job)
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAll();
  }

  private getJobKey(request: Pick<ExecutionProjectionIdentity, 'surface' | 'lifecycle' | 'nodeId' | 'kind' | 'controllerGeneration'>): string {
    return [
      request.surface,
      request.lifecycle.mode,
      request.lifecycle.generation,
      request.lifecycle.frameId ?? '',
      request.kind,
      request.nodeId,
      request.controllerGeneration
    ].join(':');
  }

  private find(
    surface: CanvasSurfaceLocation,
    lifecycle: WebviewLifecycleIdentity,
    nodeId: string,
    controllerGeneration: string,
    kind?: ExecutionNodeKind
  ): ExecutionProjectionJob | undefined {
    if (kind) {
      return this.jobs.get(this.getJobKey({ surface, lifecycle, nodeId, kind, controllerGeneration }));
    }
    const key = this.getJobKey({ surface, lifecycle, nodeId, kind: 'agent', controllerGeneration });
    const agent = this.jobs.get(key);
    if (agent) {
      return agent;
    }
    const terminalKey = this.getJobKey({ surface, lifecycle, nodeId, kind: 'terminal', controllerGeneration });
    return this.jobs.get(terminalKey);
  }

  private sameLifecycle(left: WebviewLifecycleIdentity, right: WebviewLifecycleIdentity): boolean {
    return (
      left.surface === right.surface &&
      left.mode === right.mode &&
      left.generation === right.generation &&
      left.frameId === right.frameId
    );
  }

  private schedulePump(): void {
    if (this.disposed || this.pumpScheduled) {
      return;
    }
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.disposed) {
      return;
    }
    for (const [key, job] of this.jobs) {
      if (!this.callbacks.isCurrent(job)) {
        this.cancel(key);
      }
    }

    const openCount = Array.from(this.jobs.values()).filter(
      (job) => job.phase === 'opening' || job.phase === 'restoring' || job.phase === 'awaiting-ack'
    ).length;
    const openBudget = MAX_OPEN_PROJECTIONS + (this.hasSelectedQueuedJob() ? MAX_PRIORITY_OVERFLOW_PROJECTIONS : 0);
    const opening = Math.max(0, openBudget - openCount);
    for (const job of this.selectQueuedJobs(opening)) {
      void this.openJob(job);
    }

    while (this.inFlightReads < MAX_IN_FLIGHT_READS) {
      const next = this.selectReadableJob();
      if (!next) {
        break;
      }
      void this.readJob(next);
    }
  }

  private hasSelectedQueuedJob(): boolean {
    return Array.from(this.jobs.values()).some(
      (job) => job.phase === 'queued' && job.priority === 'selected'
    );
  }

  private selectQueuedJobs(limit: number): ExecutionProjectionJob[] {
    if (limit <= 0) {
      return [];
    }
    const queued = Array.from(this.jobs.values())
      .filter((job) => job.phase === 'queued')
      .sort((left, right) => left.queuedAtMs - right.queuedAtMs);
    const selected: ExecutionProjectionJob[] = [];
    while (selected.length < limit && queued.length > 0) {
      let candidateIndex = -1;
      for (let offset = 0; offset < PRIORITY_PATTERN.length; offset += 1) {
        const patternIndex = (this.admissionPatternCursor + offset) % PRIORITY_PATTERN.length;
        const priority = PRIORITY_PATTERN[patternIndex];
        candidateIndex = queued.findIndex((job) => job.priority === priority);
        if (candidateIndex >= 0) {
          this.admissionPatternCursor = (patternIndex + 1) % PRIORITY_PATTERN.length;
          break;
        }
      }
      if (candidateIndex < 0) {
        break;
      }
      selected.push(queued.splice(candidateIndex, 1)[0]);
    }
    return selected;
  }

  private selectReadableJob(): ExecutionProjectionJob | undefined {
    const readable = Array.from(this.jobs.values()).filter(
      (job) =>
        job.phase === 'restoring' &&
        !job.readInFlight &&
        job.projectionId !== undefined &&
        job.creditBytes > 0
    );
    if (readable.length === 0) {
      return undefined;
    }
    for (let offset = 0; offset < PRIORITY_PATTERN.length; offset += 1) {
      const index = (this.readPatternCursor + offset) % PRIORITY_PATTERN.length;
      const priority = PRIORITY_PATTERN[index];
      const candidates = readable
        .filter((job) => job.priority === priority)
        .sort((left, right) => left.lastServedAtMs - right.lastServedAtMs || left.queuedAtMs - right.queuedAtMs);
      if (candidates.length > 0) {
        this.readPatternCursor = (index + 1) % PRIORITY_PATTERN.length;
        return candidates[0];
      }
    }
    return readable.sort((left, right) => left.lastServedAtMs - right.lastServedAtMs)[0];
  }

  private async openJob(job: ExecutionProjectionJob): Promise<void> {
    if (job.phase !== 'queued') {
      return;
    }
    if (!this.callbacks.isCurrent(job)) {
      this.cancel(job.key);
      return;
    }
    job.phase = 'opening';
    this.callbacks.onState(job, 'opening');
    try {
      const transport = await this.callbacks.getTransport(job);
      job.transport = transport;
      // Cancellation can happen while transport acquisition is pending. Do
      // not open a reader/pin after that job (or this exact-key generation)
      // has already been replaced.
      if (this.jobs.get(job.key) !== job || !this.callbacks.isCurrent(job)) {
        await this.cancelProjection(job);
        if (this.jobs.get(job.key) === job) {
          this.jobs.delete(job.key);
        }
        this.schedulePump();
        return;
      }
      const opened = await transport.open({
        sessionId: job.sessionId,
        authorityId: job.authorityId,
        follow: true
      });
      // Keep any usable id on the old job before checking staleness. If the
      // generation changed while open was in flight, cleanup must target this
      // transport/id directly and never route through the shared source key.
      if (isValidProjectionId(opened?.projectionId)) {
        job.projectionId = opened.projectionId;
      }
      if (!this.callbacks.isCurrent(job) || this.jobs.get(job.key) !== job) {
        await this.cancelProjection(job);
        if (this.jobs.get(job.key) === job) {
          this.jobs.delete(job.key);
        }
        this.schedulePump();
        return;
      }
      const openedCheckpointRevision = readCheckpointRevision(opened?.checkpoint);
      if (
        !isValidProjectionOpenResult(opened) ||
        opened.sessionId !== job.sessionId ||
        (job.authorityId !== undefined && opened.authorityId !== job.authorityId) ||
        opened.supervisorInstanceId !== job.supervisorInstanceId ||
        openedCheckpointRevision === undefined ||
        opened.targetRevision < openedCheckpointRevision
      ) {
        throw new Error('Terminal projection opened for a different runtime identity.');
      }
      job.projectionId = opened.projectionId;
      job.authorityId = opened.authorityId;
      job.initialTargetRevision = opened.targetRevision;
      job.latestTargetRevision = opened.targetRevision;
      job.appliedRevision = openedCheckpointRevision;
      job.openedCheckpoint = opened.checkpoint;
      job.phase = 'restoring';
      this.callbacks.onState(job, 'restoring', {
        projectionId: opened.projectionId,
        authorityId: opened.authorityId,
        targetRevision: opened.targetRevision,
        checkpoint: opened.checkpoint
      });
      this.schedulePump();
    } catch (error) {
      if (this.jobs.get(job.key) !== job || !this.callbacks.isCurrent(job)) {
        // A cancelled/replaced opening can reject after its map entry is gone.
        // Release only the cached old transport; public key cancellation could
        // otherwise remove the replacement generation.
        await this.cancelProjection(job);
        if (this.jobs.get(job.key) === job) {
          this.jobs.delete(job.key);
        }
        this.schedulePump();
        return;
      }
      this.failJob(job, error);
    }
  }

  private async readJob(job: ExecutionProjectionJob): Promise<void> {
    if (job.phase !== 'restoring' || !job.projectionId || job.readInFlight) {
      return;
    }
    job.readInFlight = true;
    job.lastServedAtMs = Date.now();
    this.inFlightReads += 1;
    try {
      // A projection id is scoped to the bulk connection that opened it. Do
      // not replace the cached transport between reads, otherwise a shared
      // client reconnect can make the next pull target the wrong socket.
      const transport = job.transport ?? await this.callbacks.getTransport(job);
      job.transport = transport;
      const result = await transport.read({
        projectionId: job.projectionId,
        creditBytes: job.creditBytes
      });
      // Each grant admits one pull. The next read waits for a Webview ACK or
      // an explicit credit request, even when this response is terminal.
      job.creditBytes = 0;
      if (this.jobs.get(job.key) !== job || !this.callbacks.isCurrent(job)) {
        // A replacement may reuse the same exact key. Release only this stale
        // transport; routing through public cancel could delete the new job.
        await this.cancelProjection(job);
        return;
      }
      if (
        !isValidProjectionReadResult(result) ||
        result.projectionId !== job.projectionId ||
        result.supervisorInstanceId !== job.supervisorInstanceId ||
        result.sessionId !== job.sessionId ||
        (job.authorityId !== undefined && result.authorityId !== job.authorityId) ||
        (job.latestTargetRevision !== undefined && result.targetRevision < job.latestTargetRevision) ||
        (result.chunk !== undefined && result.live === true)
      ) {
        throw new Error('Terminal projection identity changed while reading.');
      }
      const previousTargetRevision = job.latestTargetRevision;
      job.latestTargetRevision = result.targetRevision;
      if (
        previousTargetRevision !== undefined &&
        result.targetRevision > previousTargetRevision
      ) {
        this.callbacks.onTargetAdvanced?.(job, result.targetRevision);
      }
      if (result.chunk !== undefined) {
        const sequence = job.nextSequence++;
        job.awaitingSequence = sequence;
        job.awaitingDone = result.done;
        job.awaitingLive = result.live === true;
        job.awaitingTargetRevision = result.targetRevision;
        job.phase = 'awaiting-ack';
        this.callbacks.onChunk(job, result, sequence);
      } else if (result.done) {
        if (job.appliedRevision !== result.targetRevision) {
          throw new Error('Terminal projection completed before its revision barrier was applied.');
        }
        const readyRevision = result.targetRevision;
        job.readyRevision = readyRevision;
        job.phase = 'ready';
        this.callbacks.onReady(job, readyRevision, result.live === true);
      } else {
        throw new Error('Terminal projection returned an empty non-terminal response.');
      }
    } catch (error) {
      this.failJob(job, error);
    } finally {
      job.readInFlight = false;
      this.inFlightReads = Math.max(0, this.inFlightReads - 1);
      this.schedulePump();
    }
  }

  private failJob(job: ExecutionProjectionJob, error: unknown): void {
    if (this.jobs.get(job.key) !== job) {
      return;
    }
    job.phase = 'failed';
    job.failureMessage = error instanceof Error ? error.message : String(error);
    job.readInFlight = false;
    // Remove this exact generation before callbacks can enqueue a replacement
    // under the same source key.
    this.jobs.delete(job.key);
    this.callbacks.onState(job, 'failed', { message: job.failureMessage });
    // Failed jobs have no useful scheduler state left. Remove the record and
    // release its server-side pin even when the failure callback also clears
    // the Host-side record. The cached transport belongs to this exact job,
    // so it cannot cancel a replacement generation.
    this.callbacks.onFailed(job, error instanceof Error ? error : new Error(job.failureMessage));
    if (job.transport) {
      void this.cancelProjection(job);
    }
    this.schedulePump();
  }

  private async cancelProjection(job: ExecutionProjectionJob): Promise<void> {
    const transport = job.transport;
    if (!transport) {
      return;
    }
    try {
      if (job.projectionId) {
        await transport.cancel({ projectionId: job.projectionId });
      } else {
        await transport.close?.();
      }
    } catch {
      // A disconnected Supervisor has already released the server-side pin.
    }
  }

  private cancelSourceKey(sourceKey: string): void {
    let cancelled = false;
    for (const job of Array.from(this.jobs.values())) {
      if (job.sourceKey !== sourceKey) {
        continue;
      }
      cancelled = this.cancelJob(job) || cancelled;
    }
    if (cancelled) {
      this.schedulePump();
    }
  }

  private cancelJob(job: ExecutionProjectionJob): boolean {
    if (this.jobs.get(job.key) !== job) {
      return false;
    }
    this.jobs.delete(job.key);
    if (job.transport) {
      void this.cancelProjection(job);
    }
    return true;
  }

  private isValidCredit(creditBytes: number): boolean {
    return (
      Number.isSafeInteger(creditBytes) &&
      creditBytes >= MIN_PROJECTION_CREDIT_BYTES &&
      creditBytes <= MAX_PROJECTION_CREDIT_BYTES
    );
  }
}

function isValidProjectionOpenResult(value: ExecutionProjectionOpenResult | undefined): value is ExecutionProjectionOpenResult {
  return Boolean(
    value &&
    isValidProjectionId(value.projectionId) &&
    isValidIdentity(value.supervisorInstanceId) &&
    isValidIdentity(value.sessionId) &&
    isValidIdentity(value.authorityId) &&
    isValidRevision(value.targetRevision) &&
    readCheckpointRevision(value.checkpoint) !== undefined
  );
}

function isValidProjectionReadResult(value: ExecutionProjectionReadResult | undefined): value is ExecutionProjectionReadResult {
  return Boolean(
    value &&
    isValidProjectionId(value.projectionId) &&
    isValidIdentity(value.supervisorInstanceId) &&
    isValidIdentity(value.sessionId) &&
    isValidIdentity(value.authorityId) &&
    isValidRevision(value.targetRevision) &&
    isValidRevision(value.payloadBytes) &&
    typeof value.done === 'boolean' &&
    (value.live === undefined || typeof value.live === 'boolean')
  );
}

function readCheckpointRevision(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || !('revision' in value)) {
    return undefined;
  }
  const revision = value.revision;
  return isValidRevision(revision) ? revision : undefined;
}

function isValidProjectionId(value: unknown): value is string {
  return isValidIdentity(value);
}

function isValidIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function isValidRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
