import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import {
  decodeNativeServerFrame,
  isNativeEvent,
  isNativeRequest,
  MAX_NATIVE_FRAME_BYTES,
  type NativeEvent,
  type NativeOperation,
  type NativeResult,
  type NativeTarget
} from '../../../../packages/attention-protocol/src/native.ts';

const id = () => randomBytes(32).toString('hex');
const unknown = (): NativeResult => ({
  status: 'unknown',
  code: 'receipt-unavailable'
});
interface Pending {
  complete: (value: NativeResult) => void;
  timer: ReturnType<typeof setTimeout>;
}
export interface NativeClientOptions {
  workspaceId: string;
  focus: (target: NativeTarget) => Promise<'focused' | 'stale' | 'offline'>;
  active: (targets: NativeTarget[]) => Promise<string[]>;
  runtimeDirectory?: string;
  timeoutMs?: number;
}
/** One instance per UI extension activation. Never reuse an ID after extension reload. */
export class NativeNotifierClient {
  readonly sourceInstanceId = id();
  private socket?: Socket;
  private credential = '';
  private connecting?: Promise<boolean>;
  private readonly pending = new Map<string, Pending>();
  private readonly events = new Map<string, NativeEvent>();
  private readonly submitted = new Set<string>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private closed = false;
  private revision = 0;
  private maintaining = false;
  constructor(private readonly options: NativeClientOptions) {
    this.heartbeat = setInterval(() => {
      void this.maintain();
    }, 10000);
    this.heartbeat.unref();
  }
  dispose(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.disconnect();
  }
  private disconnect(): void {
    this.socket?.destroy();
    this.socket = undefined;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.complete(unknown());
    }
    this.pending.clear();
  }
  private async credentials(): Promise<{ credential: string; socket: string }> {
    const directory =
      this.options.runtimeDirectory ??
      join(homedir(), '.dsc-notifier', 'runtime');
    for (const path of [dirname(directory), directory]) {
      const stat = await fs.lstat(path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0
      )
        throw new Error('unsafe-runtime');
    }
    const handle = await fs.open(
      join(directory, 'credential'),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    let credential: string;
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 ||
        stat.size !== 64
      )
        throw new Error('unsafe-credential');
      const bytes = Buffer.alloc(65);
      const { bytesRead } = await handle.read(bytes, 0, 65, 0);
      credential = bytes.subarray(0, bytesRead).toString('utf8');
      if (!/^[a-f0-9]{64}$/.test(credential))
        throw new Error('invalid-credential');
    } finally {
      await handle.close();
    }
    const socket = join(directory, 'notifier.sock');
    const stat = await fs.lstat(socket);
    if (
      !stat.isSocket() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error('unsafe-socket');
    return { credential, socket };
  }
  private async ensureConnected(): Promise<boolean> {
    if (this.closed) return false;
    if (this.connecting) return this.connecting;
    if (this.socket && !this.socket.destroyed) return true;
    this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }
  private async connect(): Promise<boolean> {
    try {
      const location = await this.credentials();
      if (this.closed) return false;
      this.credential = location.credential;
      const socket = createConnection(location.socket);
      this.socket = socket;
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        let offset = 0;
        while (offset < chunk.length) {
          const newline = chunk.indexOf(10, offset);
          const end = newline < 0 ? chunk.length : newline + 1;
          if (buffer.length + end - offset > MAX_NATIVE_FRAME_BYTES) {
            socket.destroy();
            return;
          }
          buffer = Buffer.concat([buffer, chunk.subarray(offset, end)]);
          offset = end;
          if (newline < 0) break;
          const message = decodeNativeServerFrame(buffer);
          buffer = Buffer.alloc(0);
          if (!message) {
            socket.destroy();
            return;
          }
          if (message.type === 'receipt') {
            const pending = this.pending.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(message.requestId);
              pending.complete(message.result);
            }
          } else {
            void this.focus(message.focusRequestId, message.target, socket);
          }
        }
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        if (this.socket === socket) this.disconnect();
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error('connect-timeout'));
        }, this.options.timeoutMs ?? 5000);
        socket.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once('error', () => {
          clearTimeout(timer);
          reject(new Error('connect-failed'));
        });
      });
      const result = await this.request({
        type: 'register',
        workspaceId: this.options.workspaceId,
        capabilities: ['focus-node']
      });
      if (result.status !== 'accepted') {
        this.disconnect();
        return false;
      }
      // Only already-submitted records participate in reconnect sync. No history re-alert.
      await this.sync();
      return this.socket === socket && !socket.destroyed;
    } catch {
      this.disconnect();
      return false;
    }
  }
  private request(operation: NativeOperation): Promise<NativeResult> {
    const socket = this.socket;
    if (!socket || socket.destroyed)
      return Promise.resolve({ status: 'rejected', code: 'not-connected' });
    const request = {
      version: 2 as const,
      requestId: id(),
      credential: this.credential,
      sourceInstanceId: this.sourceInstanceId,
      operation
    };
    const bytes = Buffer.from(JSON.stringify(request) + '\n');
    if (
      !isNativeRequest(request, Date.now()) ||
      bytes.length > MAX_NATIVE_FRAME_BYTES ||
      this.pending.size >= 64
    )
      return Promise.resolve({ status: 'rejected', code: 'invalid-request' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.disconnect();
      }, this.options.timeoutMs ?? 5000);
      this.pending.set(request.requestId, { complete: resolve, timer });
      // Once write is attempted, failure is unknown even when no receipt arrives.
      try {
        socket.write(bytes, (error) => {
          if (error && this.socket === socket) this.disconnect();
        });
      } catch {
        this.disconnect();
      }
    });
  }
  async publish(event: NativeEvent): Promise<NativeResult> {
    if (
      !isNativeEvent(event, Date.now()) ||
      event.workspaceId !== this.options.workspaceId
    )
      return { status: 'rejected', code: 'invalid-event' };
    for (const [key, value] of this.events) {
      if (value.expiresAt <= Date.now()) {
        this.events.delete(key);
        this.submitted.delete(key);
        this.revision++;
      }
    }
    const existing = this.events.get(event.eventId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event))
      return { status: 'rejected', code: 'event-conflict' };
    if (!existing && this.events.size >= 256)
      return { status: 'rejected', code: 'source-capacity' };
    this.events.set(event.eventId, event);
    this.revision++;
    if (!(await this.ensureConnected()))
      return this.submitted.has(event.eventId)
        ? unknown()
        : { status: 'rejected', code: 'app-unavailable' };
    // Never retry publish after an ambiguous send; query cannot authorise fallback.
    if (this.submitted.has(event.eventId)) {
      const result = await this.request({
        type: 'query',
        eventId: event.eventId
      });
      return result.status === 'accepted' &&
        result.eventState !== 'absent' &&
        result.eventState !== undefined
        ? result
        : unknown();
    }
    this.submitted.add(event.eventId);
    this.revision++;
    const result = await this.request({ type: 'publish', event });
    if (result.status === 'rejected') {
      this.submitted.delete(event.eventId);
      this.events.delete(event.eventId);
      this.revision++;
    }
    return result;
  }
  private async ideDeadline<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('ide-timeout')),
            this.options.timeoutMs ?? 5000
          );
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async focus(
    focusRequestId: string,
    target: NativeTarget,
    socket: Socket
  ): Promise<void> {
    const event = this.events.get(target.eventId);
    let result: 'focused' | 'stale' | 'offline' = 'stale';
    if (
      event &&
      event.expiresAt > Date.now() &&
      Object.entries(target).every(
        ([key, value]) => event[key as keyof NativeEvent] === value
      )
    ) {
      try {
        result = await this.ideDeadline(this.options.focus(target));
      } catch {
        result = 'offline';
      }
    }
    // A response from an old connection must not be correlated on its replacement.
    if (this.socket === socket && !socket.destroyed)
      await this.request({ type: 'focusResult', focusRequestId, result });
  }
  private async sync(): Promise<void> {
    const revision = this.revision;
    const events = [...this.events.values()].filter((e) =>
      this.submitted.has(e.eventId)
    );
    let active: string[];
    try {
      active = await this.ideDeadline(
        this.options.active(events.map(targetOf))
      );
    } catch {
      return;
    }
    // A publish during the remote validation must not be withdrawn by an older snapshot.
    if (revision !== this.revision) return;
    if (
      !Array.isArray(active) ||
      active.length > 256 ||
      active.some((id) => !events.some((e) => e.eventId === id))
    )
      return;
    const eventIds = events
      .filter((e) => e.expiresAt > Date.now() && active.includes(e.eventId))
      .map((e) => e.eventId);
    await this.request({ type: 'sync', eventIds });
  }
  private async maintain(): Promise<void> {
    if (this.closed || this.maintaining || this.submitted.size === 0) return;
    this.maintaining = true;
    try {
      if (await this.ensureConnected()) {
        await this.request({
          type: 'register',
          workspaceId: this.options.workspaceId,
          capabilities: ['focus-node']
        });
        await this.sync();
      }
    } finally {
      this.maintaining = false;
    }
  }
}
export function targetOf(event: NativeEvent): NativeTarget {
  const { eventId, workspaceId, canvasId, nodeId, executionGeneration } = event;
  return { eventId, workspaceId, canvasId, nodeId, executionGeneration };
}
