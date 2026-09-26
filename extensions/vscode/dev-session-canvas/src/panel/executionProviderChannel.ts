import { Socket } from 'node:net';

import {
  assertExecutionIdentity,
  EXECUTION_INTERACTION_LIMITS,
  encodeOutputFrame,
  OutputCreditWindow,
  parseParentMessage,
  parseProviderMessage,
  sameExecutionIdentity,
  S1_LIMITS,
  type ExecutionIdentity,
  type OutputFrame,
  type ParentMessage,
  type ProviderMessage,
  type SourceDisposition
} from '../common/executionLifecycle';

export type ExecutionProviderCommand = Exclude<ParentMessage, { type: 'accepted' | 'consumed' | 'sourceEndAccepted' }>;
type InteractionCommand = Extract<ExecutionProviderCommand, { type: 'input' | 'resize' }>;
type LifecycleCommand = Exclude<ExecutionProviderCommand, InteractionCommand>;

export interface ExecutionProviderChannelOptions {
  interactionV1?: true;
  onCommand(command: ExecutionProviderCommand): void;
  onFault(reason: string): void;
  onOwnerLost(): void;
}

interface ControlSend {
  readonly message: ProviderMessage;
  resolve(): void;
  reject(error: Error): void;
}

export function createExecutionProviderChannel(
  identity: ExecutionIdentity,
  options: ExecutionProviderChannelOptions
): ExecutionProviderChannel {
  return new ExecutionProviderChannel(identity, options);
}

class ExecutionProviderChannel {
  private readonly identity: ExecutionIdentity;
  private readonly output: Socket;
  private readonly credit: OutputCreditWindow;
  private readonly retained = new Map<number, Uint8Array>();
  private readonly commands = new Map<string, LifecycleCommand>();
  private readonly interactions = new Map<number, InteractionCommand>();
  private readonly respondingInteractions = new Set<number>();
  private lastInteractionId = 0;
  private pendingInputBytes = 0;
  private readonly normal: ControlSend[] = [];
  private readonly urgent: ControlSend[] = [];
  private inFlightSend?: ControlSend;
  private rejectWrite?: (error: Error) => void;
  private activeWrite?: Promise<void>;
  private readyTask?: Promise<void>;
  private endTask?: Promise<void>;
  private closeTask?: Promise<void>;
  private disposition?: SourceDisposition;
  private expectedFinalFrameId?: number;
  private sourceEndAccepted = false;
  private stateChanged?: Promise<void>;
  private signalStateChanged?: () => void;
  private readySent = false;
  private started = false;
  private ending = false;
  private ended = false;
  private closing = false;
  private closed = false;
  private ownerLost = false;
  private socketClosing = false;
  private socketClosed = false;
  private disconnectRequested = false;
  private disconnected = false;
  private failure?: Error;

  public constructor(identity: ExecutionIdentity, private readonly options: ExecutionProviderChannelOptions) {
    if (process.platform !== 'linux' || typeof process.send !== 'function' || !process.connected) {
      throw new Error('Execution provider channel requires a connected Linux Node IPC child.');
    }
    assertExecutionIdentity(identity);
    this.identity = Object.freeze({ ...identity });
    this.credit = new OutputCreditWindow(this.identity);
    this.output = new Socket({ fd: 4, readable: false, writable: true });
    this.output.on('error', this.onOutputError);
    this.output.on('close', this.onOutputClose);
    process.on('message', this.onMessage);
    process.on('disconnect', this.onDisconnect);
    process.on('error', this.onIpcError);
  }

  public ready(): Promise<void> {
    if (this.readyTask) {
      return this.readyTask;
    }
    if (this.failure || this.closing) {
      return Promise.reject(this.failure ?? new Error('Provider channel is closing.'));
    }
    this.readyTask = this.enqueue(parseProviderMessage({
      type: 'ready', identity: this.identity, capabilities: ['execution-lifecycle-v1',
        ...(this.options.interactionV1 ? ['terminal-interaction-v1'] : [])]
    })).then(() => {
      this.readySent = true;
      this.notify();
    });
    return this.readyTask;
  }

  public send(value: ProviderMessage): Promise<void> {
    try {
      this.assertOpen();
      if (!this.readyTask) {
        throw new Error('Provider must announce readiness before sending facts.');
      }
      const message = parseProviderMessage(value);
      this.assertIdentity(message.identity);
      if (message.type === 'ready' || message.type === 'sourceEnd') {
        throw new Error('Use ready() or end() for lifecycle boundaries.');
      }
      if ((message.type === 'resourceAcquired' || message.type === 'resourceResult') &&
          message.resourceId === 'provider-control') {
        throw new Error('Provider cannot claim parent control resources.');
      }
      if (message.type === 'operationObservation' &&
          !Array.from(this.commands.values()).some((command) => command.operationId === message.operationId)) {
        throw new Error('Observation does not belong to a received operation.');
      }
      if (message.type === 'interactionObservation') {
        const command = this.interactions.get(message.interactionId);
        if (!command || this.respondingInteractions.has(message.interactionId)) {
          throw new Error('Observation does not belong to a pending interaction.');
        }
        const result = message.result;
        if ((command.type === 'input' && result.kind === 'resized') ||
          (command.type === 'resize' && (result.kind === 'written' || 'writtenBytes' in result)) ||
          (command.type === 'input' && 'writtenBytes' in result && result.writtenBytes !== undefined &&
            result.writtenBytes > Buffer.byteLength(command.data, 'utf8')) ||
          (command.type === 'input' && result.kind === 'written' &&
            result.writtenBytes !== Buffer.byteLength(command.data, 'utf8'))) {
          throw new Error('Interaction observation does not match the received input.');
        }
        this.respondingInteractions.add(message.interactionId);
        return this.enqueue(message).then(() => {
          this.interactions.delete(message.interactionId);
          this.respondingInteractions.delete(message.interactionId);
          if (command.type === 'input') this.pendingInputBytes -= Buffer.byteLength(command.data, 'utf8');
          this.notify();
        });
      }
      return this.enqueue(message);
    } catch (error) {
      this.fail('Invalid provider control operation.');
      return Promise.reject(error);
    }
  }

  public write(text: string): Promise<void> {
    if (this.activeWrite) {
      return Promise.reject(new Error('Only one provider write may be in flight.'));
    }
    try {
      this.assertOpen();
      if (!this.started || this.ending) {
        throw new Error('Output is only writable after start and before end.');
      }
      const frame: OutputFrame = Object.freeze({
        version: 1, identity: this.identity, frameId: this.credit.snapshot().sentThrough + 1, text
      });
      const byteLength = encodeOutputFrame(frame).byteLength;
      const task = this.writeFrame(frame, byteLength);
      this.activeWrite = task;
      const settled = () => {
        if (this.activeWrite === task) {
          this.activeWrite = undefined;
        }
        this.notify();
      };
      void task.then(settled, settled);
      return task;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  public end(disposition: SourceDisposition): Promise<void> {
    try {
      const message = parseProviderMessage({
        type: 'sourceEnd', identity: this.identity, finalFrameId: 0, disposition
      });
      if (message.type !== 'sourceEnd') {
        throw new Error('Invalid source disposition.');
      }
      if (this.endTask) {
        if (JSON.stringify(this.disposition) !== JSON.stringify(message.disposition)) {
          throw new Error('Source end cannot change its disposition.');
        }
        return this.endTask;
      }
      this.assertOpen();
      if (!this.started) {
        throw new Error('Source cannot end before start.');
      }
      this.ending = true;
      this.disposition = message.disposition;
      this.endTask = this.finishOutput(message.disposition);
      return this.endTask;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  public close(): Promise<void> {
    if (this.closeTask) {
      return this.closeTask;
    }
    if (!this.endTask && !this.failure) {
      return Promise.reject(new Error('Orderly close requires source end first.'));
    }
    this.closeTask = this.finishClose();
    return this.closeTask;
  }

  public snapshot(): Readonly<ReturnType<OutputCreditWindow['snapshot']> & {
    retainedFrames: number;
    retainedBytes: number;
    readySent: boolean;
    started: boolean;
    ending: boolean;
    ended: boolean;
    closed: boolean;
    ownerLost: boolean;
    writeInFlight: boolean;
    sendInFlight: boolean;
    queuedNormal: number;
    queuedUrgent: number;
    pendingInteractions: number;
    pendingInputBytes: number;
    firstFault?: string;
  }> {
    return Object.freeze({
      ...this.credit.snapshot(),
      retainedFrames: this.retained.size,
      retainedBytes: Array.from(this.retained.values()).reduce((sum, bytes) => sum + bytes.byteLength, 0),
      readySent: this.readySent,
      started: this.started,
      ending: this.ending,
      ended: this.ended,
      closed: this.closed,
      ownerLost: this.ownerLost,
      writeInFlight: this.activeWrite !== undefined,
      sendInFlight: this.inFlightSend !== undefined,
      queuedNormal: this.normal.length,
      queuedUrgent: this.urgent.length,
      pendingInteractions: this.interactions.size,
      pendingInputBytes: this.pendingInputBytes,
      ...(this.failure ? { firstFault: this.failure.message } : {})
    });
  }

  private async writeFrame(frame: OutputFrame, byteLength: number): Promise<void> {
    while (true) {
      this.assertHealthy();
      const budget = this.credit.snapshot();
      if (budget.pendingFrames < S1_LIMITS.pendingFrames &&
          budget.pendingBytes + byteLength <= S1_LIMITS.pendingBytes) {
        break;
      }
      await this.changed();
    }
    const encoded = this.credit.reserve(frame);
    this.retained.set(frame.frameId, encoded);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) {
          return;
        }
        settled = true;
        this.rejectWrite = undefined;
        if (error) {
          this.fail('Provider output write failed.');
          reject(error);
        } else {
          resolve();
        }
        this.notify();
      };
      this.rejectWrite = finish;
      try {
        this.output.write(encoded, finish);
      } catch {
        finish(new Error('Provider output write failed.'));
      }
    });
  }

  private async finishOutput(disposition: SourceDisposition): Promise<void> {
    if (this.activeWrite) {
      await this.activeWrite;
    }
    while (true) {
      this.assertHealthy();
      const window = this.credit.snapshot();
      if (window.acceptedThrough === window.sentThrough) {
        // The parent may acknowledge delivery before the local send callback runs.
        this.expectedFinalFrameId = window.sentThrough;
        await this.enqueue(parseProviderMessage({
          type: 'sourceEnd', identity: this.identity, finalFrameId: window.sentThrough, disposition
        }));
        while (!this.sourceEndAccepted) {
          this.assertHealthy();
          await this.changed();
        }
        this.assertHealthy();
        this.ended = true;
        this.notify();
        return;
      }
      await this.changed();
    }
  }

  private async finishClose(): Promise<void> {
    if (!this.failure) {
      try {
        await this.endTask;
        while (!this.failure && (this.inFlightSend || this.normal.length > 0 || this.urgent.length > 0 || this.interactions.size > 0)) {
          await this.changed();
        }
      } catch {
        this.fail('Provider source end failed before close.');
      }
    }
    this.socketClosing = true;
    if (this.failure) {
      this.output.destroy();
    } else if (!this.socketClosed) {
      this.output.end(() => this.output.destroy());
    }
    while (!this.socketClosed) {
      await this.changed();
    }
    // Closing the output does not cancel controls received while its tail was settling.
    while (!this.failure && (this.inFlightSend || this.normal.length > 0 || this.urgent.length > 0 || this.interactions.size > 0)) {
      await this.changed();
    }
    this.closing = true;
    this.disconnectRequested = true;
    if (process.connected) {
      try {
        process.disconnect();
      } catch {
        this.fail('Provider IPC disconnect failed.');
        throw this.failure;
      }
    }
    while (!this.disconnected) {
      await this.changed();
    }
    this.closed = true;
    process.removeListener('message', this.onMessage);
    process.removeListener('disconnect', this.onDisconnect);
    process.removeListener('error', this.onIpcError);
    this.notify();
  }

  private enqueue(message: ProviderMessage): Promise<void> {
    if (this.failure || this.disconnected) {
      return Promise.reject(this.failure ?? new Error('Provider IPC is disconnected.'));
    }
    const command = message.type === 'operationObservation'
      ? Array.from(this.commands.values()).find((entry) => entry.operationId === message.operationId)
      : undefined;
    const urgent = message.type === 'sourceEnd' || message.type === 'processResult' ||
      message.type === 'resourceAcquired' || message.type === 'resourceResult' ||
      (command !== undefined && command.type !== 'start') ||
      (message.type === 'operationObservation' &&
        ['failed', 'unconfirmed', 'rejected-before-acquire'].includes(message.result.kind));
    const queue = urgent ? this.urgent : this.normal;
    const limit = urgent ? S1_LIMITS.urgentSlots : S1_LIMITS.normalSlots;
    if (queue.length >= limit) {
      this.fail('Provider control queue exhausted.');
      return Promise.reject(this.failure);
    }
    const task = new Promise<void>((resolve, reject) => {
      queue.push({ message, resolve, reject });
    });
    this.pump();
    return task;
  }

  private pump(): void {
    if (this.failure || this.inFlightSend) {
      return;
    }
    const entry = this.urgent.shift() ?? this.normal.shift();
    if (!entry) {
      this.notify();
      return;
    }
    this.inFlightSend = entry;
    const finish = (error: Error | null) => {
      if (this.inFlightSend !== entry) {
        return;
      }
      this.inFlightSend = undefined;
      if (error) {
        entry.reject(new Error('Provider IPC send failed.'));
        this.fail('Provider IPC send failed.');
      } else {
        entry.resolve();
        this.pump();
      }
      this.notify();
    };
    try {
      if (!process.send || !process.connected) {
        finish(new Error('Provider IPC is disconnected.'));
      } else {
        process.send(entry.message, finish);
      }
    } catch {
      finish(new Error('Provider IPC send failed.'));
    }
  }

  private readonly onMessage = (value: unknown): void => {
    if (this.failure || this.closed) {
      return;
    }
    try {
      const message = parseParentMessage(value);
      this.assertIdentity(message.identity);
      if (message.type === 'sourceEndAccepted') {
        if (this.expectedFinalFrameId === undefined || message.finalFrameId !== this.expectedFinalFrameId) {
          throw new Error('Source confirmation does not match the requested source end.');
        }
        this.sourceEndAccepted = true;
        this.notify();
        return;
      }
      if (message.type === 'accepted' || message.type === 'consumed') {
        this.credit.acknowledge(message);
        if (message.type === 'accepted') {
          for (const frameId of this.retained.keys()) {
            if (frameId <= message.throughFrameId) {
              this.retained.delete(frameId);
            }
          }
        }
        this.notify();
        return;
      }
      if (!this.readyTask || this.closing) {
        throw new Error('Command arrived outside the provider command lifecycle.');
      }
      if (message.type === 'input' || message.type === 'resize') {
        const bytes = message.type === 'input' ? Buffer.byteLength(message.data, 'utf8') : 0;
        if (!this.options.interactionV1 || !this.started || message.interactionId <= this.lastInteractionId ||
          this.interactions.size >= EXECUTION_INTERACTION_LIMITS.pendingOperations ||
          this.pendingInputBytes + bytes > EXECUTION_INTERACTION_LIMITS.pendingInputBytes) {
          throw new Error('Interaction capability, sequence or pending budget is invalid.');
        }
        this.lastInteractionId = message.interactionId;
        this.interactions.set(message.interactionId, message);
        this.pendingInputBytes += bytes;
        this.options.onCommand(message);
        return;
      }
      if (!('operationId' in message)) {
        throw new Error('Provider command lacks an operation id.');
      }
      if (message.type !== 'start' && !this.started) {
        throw new Error('Provider control command arrived before start.');
      }
      const key = message.type === 'requestStop' ? `${message.type}:${message.mode}` : message.type;
      const previous = this.commands.get(key);
      if (previous) {
        if (!sameCommand(previous, message)) {
          throw new Error('Conflicting repeated provider command.');
        }
        return;
      }
      if (Array.from(this.commands.values()).some((command) => command.operationId === message.operationId)) {
        throw new Error('Operation id is already bound to a different command.');
      }
      if (message.type === 'start') {
        this.started = true;
      }
      this.commands.set(key, message);
      this.options.onCommand(message);
    } catch {
      this.fail('Invalid parent command or command callback failure.');
    }
  };

  private readonly onDisconnect = (): void => {
    this.disconnected = true;
    if (!this.disconnectRequested && !this.closed) {
      this.ownerLost = true;
      this.fail('Provider owner IPC disconnected.');
      try {
        this.options.onOwnerLost();
      } catch {
        this.fail('Owner-loss callback failed.');
      }
    }
    this.notify();
  };

  private readonly onIpcError = (): void => {
    this.fail('Provider IPC channel failed.');
  };

  private readonly onOutputError = (): void => {
    this.fail('Provider output channel failed.');
  };

  private readonly onOutputClose = (): void => {
    this.socketClosed = true;
    if (!this.socketClosing && !this.failure) {
      this.fail('Provider output closed before orderly shutdown.');
    }
    this.notify();
  };

  private fail(reason: string): void {
    if (this.failure) {
      return;
    }
    const failure = new Error(reason);
    this.failure = failure;
    this.rejectWrite?.(failure);
    this.inFlightSend?.reject(failure);
    this.inFlightSend = undefined;
    for (const queue of [this.normal, this.urgent]) {
      for (const entry of queue.splice(0)) {
        entry.reject(failure);
      }
    }
    this.output.destroy();
    this.notify();
    try {
      this.options.onFault(reason);
    } catch {
      // The channel is already failed; backend cleanup remains the caller's responsibility.
    }
  }

  private assertIdentity(identity: ExecutionIdentity): void {
    if (!sameExecutionIdentity(this.identity, identity)) {
      throw new Error('Provider message belongs to a different execution.');
    }
  }

  private assertHealthy(): void {
    if (this.failure) {
      throw this.failure;
    }
  }

  private assertOpen(): void {
    this.assertHealthy();
    if (this.closing || this.closed) {
      throw new Error('Provider channel is closing.');
    }
  }

  private changed(): Promise<void> {
    if (!this.stateChanged) {
      this.stateChanged = new Promise<void>((resolve) => {
        this.signalStateChanged = resolve;
      });
    }
    return this.stateChanged;
  }

  private notify(): void {
    const resolve = this.signalStateChanged;
    this.stateChanged = undefined;
    this.signalStateChanged = undefined;
    resolve?.();
  }
}

function sameCommand(left: LifecycleCommand, right: LifecycleCommand): boolean {
  if (left.type !== right.type || left.operationId !== right.operationId) {
    return false;
  }
  if (left.type === 'start' && right.type === 'start') {
    const before = left.spec;
    const after = right.spec;
    const environmentKeys = Object.keys(before.env ?? {});
    return before.file === after.file && before.cwd === after.cwd &&
      before.cols === after.cols && before.rows === after.rows && before.stopStrategy === after.stopStrategy &&
      before.args.length === after.args.length && before.args.every((arg, index) => arg === after.args[index]) &&
      environmentKeys.length === Object.keys(after.env ?? {}).length &&
      environmentKeys.every((key) => before.env?.[key] === after.env?.[key]);
  }
  if (left.type === 'requestStop' && right.type === 'requestStop') {
    return left.mode === right.mode;
  }
  return left.type === 'cancelOutput' && right.type === 'cancelOutput' && left.reason === right.reason;
}
