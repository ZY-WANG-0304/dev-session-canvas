import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { RuntimeHostBackendKind } from '../common/protocol';
import type { RuntimeOwnerDescriptorV1 } from '../common/runtimeRootOwnership';

interface Participant { token: string; port: number }
export interface SharedCanvasPendingDeletionEntry { operationId: string; nodeIds: string[] }
export type SharedCanvasPendingDeletionListener = (
  sourceToken: string,
  operationId: string,
  nodeIds: readonly string[] | undefined
) => void;

const MAX_PENDING_DELETION_MESSAGE_BYTES = 1024 * 1024;

export interface SharedRuntimeTakeoverCandidate {
  pid: number;
  runtimeBackend: RuntimeHostBackendKind;
  runtimeStoragePath: string;
  runtimeOwner: RuntimeOwnerDescriptorV1;
}
export interface SharedRuntimeTakeover {
  pids: number[];
  finish: (committed: boolean) => void;
}
export type AcceptSharedRuntimeTakeover = (candidates: SharedRuntimeTakeoverCandidate[]) => Promise<SharedRuntimeTakeover>;

/** Only the holder of root admission can advance cleanup or acknowledge a joining Host. */
export class SharedRootCanvasDeparture {
  readonly id = randomUUID();
  preserved = false;
  stage: 'preparing' | 'settling' | 'idle' | 'finished' = 'preparing';
  candidates: SharedRuntimeTakeoverCandidate[] = [];
  readonly handoffs = new Map<string, number[]>();

  beginSettlement(): boolean {
    if (this.preserved) return false;
    if (this.stage !== 'preparing' && this.stage !== 'settling') throw new Error('Shared Canvas cleanup already settled.');
    this.stage = 'settling';
    return true;
  }

  settle(candidates: SharedRuntimeTakeoverCandidate[]): void {
    if (this.stage !== 'settling') throw new Error('Shared Canvas cleanup has not entered settlement.');
    this.candidates = candidates;
    this.stage = 'idle';
  }
}
const close = (server: net.Server): Promise<void> => new Promise((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve()));

/** An applied enabled Host registers independently of its Supervisor connections and readers. */
export class SharedRootCanvasParticipants {
  readonly ready: Promise<void>;
  private readonly token = randomUUID();
  private readonly directory: string;
  private listener?: net.Server;
  private retired = false;
  private disposed = false;
  private port = 0;
  private departure?: SharedRootCanvasDeparture;
  private readonly sockets = new Set<net.Socket>();
  // One authenticated full-duplex channel per participant in this root. Deletion operations never enter the canvas snapshot.
  private readonly pendingChannels = new Map<string, net.Socket>();
  private readonly pendingChannelPeers = new Map<string, Participant>();
  private readonly pendingChannelDirections = new Map<string, 'incoming' | 'outgoing'>();
  private readonly pendingChannelReconnects = new Set<string>();
  private readonly pendingDeletionOperations = new Map<string, string[]>();
  private readonly remotePendingDeletionOperations = new Map<string, Map<string, string[]>>();
  private readonly remotePendingDeletionRevisions = new Map<string, number>();
  private pendingDeletionRevision = 0;

  constructor(
    private readonly filename: string,
    private readonly acceptTakeover?: AcceptSharedRuntimeTakeover,
    private readonly onPendingDeletionChanged?: SharedCanvasPendingDeletionListener
  ) {
    this.directory = `${filename}.participants`;
    this.ready = this.register();
  }

  get admissionPort(): number {
    const identity = process.platform === 'win32' ? this.filename.toLowerCase() : this.filename;
    return 10000 + createHash('sha256').update(identity).digest().readUInt32BE(0) % 10000;
  }

  async withAdmission<T>(work: () => Promise<T>, held = new Set<number>()): Promise<T> {
    await this.ready;
    if (this.retired || this.disposed) throw new Error('This Host has left the shared Canvas.');
    if (held.has(this.admissionPort)) return work();
    const lease = await this.acquireAdmission();
    held.add(this.admissionPort);
    try {
      if (this.retired || this.disposed) throw new Error('This Host has left the shared Canvas.');
      return await work();
    } finally { held.delete(this.admissionPort); await close(lease); }
  }

  async depart<T>(work: (last: boolean, departure: SharedRootCanvasDeparture) => Promise<T>, held?: Set<number>): Promise<T> {
    return this.withAdmission(async () => {
      const others = await this.livePeers();
      const departure = this.departure = new SharedRootCanvasDeparture();
      try {
        const result = await work(others.length === 0, departure);
        this.retired = true;
        this.removeOwnRecord();
        return result;
      } finally { departure.stage = 'finished'; this.departure = undefined; }
    }, held);
  }

  async transferredPids(departure: SharedRootCanvasDeparture): Promise<Set<number>> {
    const peers = await this.livePeers();
    return new Set(peers.flatMap(peer => departure.handoffs.get(peer.token) ?? []));
  }

  publishPendingDeletionOperation(operationId: string, nodeIds: readonly string[] | undefined): void {
    if (nodeIds?.length) this.pendingDeletionOperations.set(operationId, [...new Set(nodeIds)]);
    else this.pendingDeletionOperations.delete(operationId);
    const revision = ++this.pendingDeletionRevision;
    this.broadcastPendingDeletionMessage({
      type: 'pending-update',
      revision,
      operationId,
      nodeIds: nodeIds?.length ? [...new Set(nodeIds)] : null
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const token of this.remotePendingDeletionOperations.keys()) this.clearRemotePendingDeletionOperations(token);
    this.pendingChannels.clear();
    this.pendingChannelDirections.clear();
    this.pendingChannelPeers.clear();
    for (const socket of this.sockets) socket.destroy();
    if (this.listener?.listening) this.listener.close();
    this.removeOwnRecord();
  }

  private removeOwnRecord(): void {
    try { fs.unlinkSync(path.join(this.directory, `${this.token}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  private async register(): Promise<void> {
    const server = net.createServer(socket => this.serve(socket));
    const first = createHash('sha256').update(this.token).digest().readUInt32BE(0) % 5000;
    let port = 0;
    for (let attempt = 0; attempt < 5000; attempt++) {
      port = 60000 + (first + attempt) % 5000;
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
            server.removeListener('error', reject); resolve();
          });
        });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt === 4999) throw error;
      }
    }
    this.listener = server;
    this.port = port;
    let lease: net.Server | undefined;
    let peers: Participant[] = [];
    try { lease = await this.acquireAdmission(async () => this.tryJoin()); }
    catch (error) { server.close(); throw error; }
    try {
      if (this.disposed) return;
      if (lease) { await this.livePeers(); this.writeRecord({ token: this.token, port }); }
      peers = await this.livePeers();
    } catch (error) {
      server.close(); throw error;
    } finally {
      if (lease) await close(lease);
      if (this.disposed && server.listening) server.close();
    }
    if (!this.disposed) {
      try {
        await Promise.all(peers.map(async peer => {
          try { await this.connectPendingChannel(peer); }
          catch { await this.reconnectPendingChannel(peer); }
        }));
      }
      catch (error) {
        try { this.dispose(); } catch { /* Keep the subscription error as the startup result. */ }
        throw error;
      }
    }
  }

  private writeRecord(participant: Participant): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `${participant.token}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(participant), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, path.join(this.directory, `${participant.token}.json`));
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  private serve(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => {
      this.sockets.delete(socket);
      for (const [token, channel] of this.pendingChannels) {
        if (channel !== socket) continue;
        this.handlePendingChannelClosed(token, socket);
      }
    });
    socket.on('error', () => socket.destroy());
    socket.setTimeout(5000, () => socket.destroy());
    socket.write(`${this.token}\n`);
    let input = '';
    let processing = false;
    const receiveInitialRequest = (chunk: Buffer): void => {
      input += chunk.toString();
      if (Buffer.byteLength(input, 'utf8') > MAX_PENDING_DELETION_MESSAGE_BYTES || processing) {
        socket.destroy(); return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      processing = true;
      socket.removeListener('data', receiveInitialRequest);
      const requestLine = input.slice(0, newline);
      if (input.slice(newline + 1).trim()) { socket.destroy(); return; }
      void (async () => {
        const request = JSON.parse(requestLine) as {
          type?: string;
          target: string;
          peer: Participant;
          departure?: string;
          pids?: number[];
          revision?: number;
          operations?: SharedCanvasPendingDeletionEntry[];
        };
        const peer = request.peer;
        if (request.target !== this.token || !peer || !/^[a-f0-9-]{36}$/.test(peer.token) ||
            !Number.isInteger(peer.port) || peer.port < 60000 || peer.port >= 65000) throw new Error('Invalid joining participant.');
        if (!await this.isAlive(peer) || socket.destroyed) throw new Error('Joining participant is unconfirmed.');
        if (request.type === 'pending-subscribe') {
          if (this.disposed || this.retired || !this.isRegisteredParticipant(peer)) {
            throw new Error('Joining Host is not an active shared Canvas participant.');
          }
          this.replaceRemotePendingDeletionOperations(peer.token, request.revision, request.operations);
          this.attachPendingChannel(peer, socket, 'incoming');
          socket.write(`${JSON.stringify({
            type: 'pending-snapshot',
            revision: this.pendingDeletionRevision,
            operations: this.pendingDeletionSnapshot()
          })}\n`);
          return;
        }
        const departure = this.departure;
        if (!departure || this.disposed || this.retired) return { status: 'wait' };
        if (request.departure !== undefined) {
          if (request.departure !== departure.id || departure.stage !== 'idle' || !Array.isArray(request.pids) ||
              !request.pids.length || request.pids.some(pid => !departure.candidates.some(candidate => candidate.pid === pid))) {
            throw new Error('Invalid shared Runtime handoff confirmation.');
          }
          this.writeRecord(peer);
          departure.handoffs.set(peer.token, request.pids);
          return { status: 'admitted' };
        }
        if (departure.stage === 'preparing') {
          this.writeRecord(peer);
          departure.preserved = true;
          return { status: 'admitted' };
        }
        if (departure.stage === 'idle' && departure.candidates.length) {
          return { status: 'offer', departure: departure.id, candidates: departure.candidates };
        }
        return { status: 'wait' };
      })().then(response => {
        if (socket.destroyed) return;
        if (response !== undefined) socket.end(`${JSON.stringify(response)}\n`);
      }, () => socket.destroy());
    };
    socket.on('data', receiveInitialRequest);
  }

  private isRegisteredParticipant(peer: Participant): boolean {
    const recordPath = path.join(this.directory, `${peer.token}.json`);
    try {
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Participant;
      return record.token === peer.token && record.port === peer.port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private pendingDeletionSnapshot(): SharedCanvasPendingDeletionEntry[] {
    return [...this.pendingDeletionOperations].map(([operationId, nodeIds]) => ({ operationId, nodeIds: [...nodeIds] }));
  }

  private replaceRemotePendingDeletionOperations(
    sourceToken: string,
    revision: number | undefined,
    operations: SharedCanvasPendingDeletionEntry[] | undefined
  ): void {
    if (!Number.isSafeInteger(revision) || revision! < 0 || !Array.isArray(operations)) {
      throw new Error('Invalid shared Canvas pending deletion snapshot.');
    }
    const currentRevision = this.remotePendingDeletionRevisions.get(sourceToken) ?? -1;
    if (revision! < currentRevision) return;
    const next = new Map<string, string[]>();
    for (const entry of operations) {
      if (!entry || typeof entry.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(entry.operationId) ||
          !Array.isArray(entry.nodeIds) || entry.nodeIds.some(nodeId => typeof nodeId !== 'string') ||
          entry.nodeIds.length === 0 || next.has(entry.operationId)) {
        throw new Error('Invalid shared Canvas pending deletion operation.');
      }
      next.set(entry.operationId, [...new Set(entry.nodeIds)]);
    }
    const previous = this.remotePendingDeletionOperations.get(sourceToken) ?? new Map<string, string[]>();
    for (const operationId of new Set([...previous.keys(), ...next.keys()])) {
      const before = previous.get(operationId);
      const after = next.get(operationId);
      if (JSON.stringify(before) !== JSON.stringify(after)) this.onPendingDeletionChanged?.(sourceToken, operationId, after);
    }
    if (next.size) this.remotePendingDeletionOperations.set(sourceToken, next);
    else this.remotePendingDeletionOperations.delete(sourceToken);
    this.remotePendingDeletionRevisions.set(sourceToken, revision!);
  }

  private applyRemotePendingDeletionUpdate(
    sourceToken: string,
    revision: number,
    operationId: string,
    nodeIds: string[] | null
  ): void {
    if (!Number.isSafeInteger(revision) || revision < 0 || !/^[a-f0-9-]{36}$/.test(operationId) ||
        (nodeIds !== null && (!Array.isArray(nodeIds) || nodeIds.some(nodeId => typeof nodeId !== 'string')))) {
      throw new Error('Invalid shared Canvas pending deletion update.');
    }
    if (revision <= (this.remotePendingDeletionRevisions.get(sourceToken) ?? -1)) return;
    const operations = this.remotePendingDeletionOperations.get(sourceToken) ?? new Map<string, string[]>();
    this.remotePendingDeletionRevisions.set(sourceToken, revision);
    if (nodeIds?.length) {
      const next = [...new Set(nodeIds)];
      operations.set(operationId, next);
      this.remotePendingDeletionOperations.set(sourceToken, operations);
      this.onPendingDeletionChanged?.(sourceToken, operationId, next);
    } else {
      operations.delete(operationId);
      if (operations.size) this.remotePendingDeletionOperations.set(sourceToken, operations);
      else this.remotePendingDeletionOperations.delete(sourceToken);
      this.onPendingDeletionChanged?.(sourceToken, operationId, undefined);
    }
  }

  private clearRemotePendingDeletionOperations(sourceToken: string): void {
    const operations = this.remotePendingDeletionOperations.get(sourceToken);
    if (operations) for (const operationId of operations.keys()) {
      this.onPendingDeletionChanged?.(sourceToken, operationId, undefined);
    }
    this.remotePendingDeletionOperations.delete(sourceToken);
    this.remotePendingDeletionRevisions.delete(sourceToken);
  }

  private attachPendingChannel(
    peer: Participant,
    socket: net.Socket,
    direction: 'incoming' | 'outgoing',
    initialInput = ''
  ): void {
    const previous = this.pendingChannels.get(peer.token);
    this.pendingChannels.set(peer.token, socket);
    this.pendingChannelPeers.set(peer.token, peer);
    this.pendingChannelDirections.set(peer.token, direction);
    if (previous && previous !== socket) previous.destroy();
    socket.setTimeout(0);
    let input = initialInput;
    const receivePendingMessages = (chunk?: Buffer): void => {
      if (chunk) input += chunk.toString();
      if (Buffer.byteLength(input, 'utf8') > MAX_PENDING_DELETION_MESSAGE_BYTES) { socket.destroy(); return; }
      let newline = input.indexOf('\n');
      while (newline >= 0) {
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        try {
          const message = JSON.parse(line) as {
            type: string;
            revision?: number;
            operationId?: string;
            nodeIds?: string[] | null;
            operations?: SharedCanvasPendingDeletionEntry[];
          };
          if (message.type === 'pending-state') {
            this.replaceRemotePendingDeletionOperations(peer.token, message.revision, message.operations);
          } else if (message.type === 'pending-update' && typeof message.operationId === 'string' &&
              (message.nodeIds === null || Array.isArray(message.nodeIds))) {
            this.applyRemotePendingDeletionUpdate(peer.token, message.revision ?? -1, message.operationId, message.nodeIds);
          } else {
            throw new Error('Invalid shared Canvas pending deletion message.');
          }
        } catch {
          socket.destroy(); return;
        }
        newline = input.indexOf('\n');
      }
    };
    socket.on('data', receivePendingMessages);
    if (initialInput) receivePendingMessages();
  }

  private broadcastPendingDeletionMessage(message: {
    type: 'pending-update'; revision: number; operationId: string; nodeIds: string[] | null;
  }): void {
    const encoded = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(encoded, 'utf8') > MAX_PENDING_DELETION_MESSAGE_BYTES) return;
    for (const socket of this.pendingChannels.values()) {
      if (!socket.destroyed) socket.write(encoded);
    }
  }

  private sendPendingDeletionSnapshot(socket: net.Socket): void {
    const encoded = `${JSON.stringify({
      type: 'pending-state',
      revision: this.pendingDeletionRevision,
      operations: this.pendingDeletionSnapshot()
    })}\n`;
    if (Buffer.byteLength(encoded, 'utf8') <= MAX_PENDING_DELETION_MESSAGE_BYTES && !socket.destroyed) socket.write(encoded);
  }

  private async connectPendingChannel(peer: Participant): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: peer.port });
      this.sockets.add(socket);
      let input = '';
      let authenticated = false;
      let subscribed = false;
      let settled = false;
      const fail = (error?: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error); else resolve();
      };
      socket.setTimeout(5000, () => fail(new Error('Shared Canvas pending deletion subscription timed out.')));
      socket.on('error', error => {
        if (!subscribed) fail(error);
      });
      socket.on('close', () => {
        this.sockets.delete(socket);
        this.handlePendingChannelClosed(peer.token, socket);
        if (!subscribed && !settled) fail(new Error('Shared Canvas pending deletion subscription closed before its snapshot.'));
      });
      const receiveBootstrap = (chunk: Buffer): void => {
        input += chunk.toString();
        if (Buffer.byteLength(input, 'utf8') > MAX_PENDING_DELETION_MESSAGE_BYTES) { fail(new Error('Invalid shared Canvas pending deletion response.')); return; }
        if (!authenticated) {
          const newline = input.indexOf('\n');
          if (newline < 0) return;
          if (input.slice(0, newline) !== peer.token) { fail(new Error('Shared Canvas participant identity changed.')); return; }
          authenticated = true;
          input = input.slice(newline + 1);
          socket.write(`${JSON.stringify({
            type: 'pending-subscribe',
            target: peer.token,
            peer: { token: this.token, port: this.port },
            revision: this.pendingDeletionRevision,
            operations: this.pendingDeletionSnapshot()
          })}\n`);
        }
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        try {
          const response = JSON.parse(line) as {
            type: string; revision?: number; operations?: SharedCanvasPendingDeletionEntry[];
          };
          if (response.type !== 'pending-snapshot') throw new Error('Invalid shared Canvas pending deletion snapshot.');
          this.replaceRemotePendingDeletionOperations(peer.token, response.revision, response.operations);
          subscribed = true;
          settled = true;
          socket.setTimeout(0);
          socket.removeListener('data', receiveBootstrap);
          this.attachPendingChannel(peer, socket, 'outgoing', input);
          this.sendPendingDeletionSnapshot(socket);
          resolve();
        } catch (error) {
          fail(error as Error);
        }
      };
      socket.on('data', receiveBootstrap);
    });
  }

  private handlePendingChannelClosed(peerToken: string, socket: net.Socket): void {
    if (this.pendingChannels.get(peerToken) !== socket) return;
    this.pendingChannels.delete(peerToken);
    const direction = this.pendingChannelDirections.get(peerToken);
    this.pendingChannelDirections.delete(peerToken);
    const peer = this.pendingChannelPeers.get(peerToken);
    if (this.disposed || this.retired || !peer) {
      this.pendingChannelPeers.delete(peerToken);
      this.clearRemotePendingDeletionOperations(peerToken);
      return;
    }
    if (direction === 'outgoing') {
      void this.reconnectPendingChannel(peer);
    } else {
      void this.clearPendingOperationsIfPeerLeft(peer);
    }
  }

  private async clearPendingOperationsIfPeerLeft(peer: Participant): Promise<void> {
    try {
      if (!this.isRegisteredParticipant(peer)) {
        this.pendingChannelPeers.delete(peer.token);
        this.clearRemotePendingDeletionOperations(peer.token);
        return;
      }
      if (await this.isAlive(peer)) return;
      this.removePeerRecord(peer);
      this.pendingChannelPeers.delete(peer.token);
      this.clearRemotePendingDeletionOperations(peer.token);
    } catch {
      // ECONNRESET/EPIPE and probe timeouts do not prove the peer is gone; retain its locks.
    }
  }

  private async reconnectPendingChannel(peer: Participant): Promise<void> {
    if (this.pendingChannelReconnects.has(peer.token)) return;
    this.pendingChannelReconnects.add(peer.token);
    let retryDelay = 250;
    try {
      while (!this.disposed && !this.retired && !this.pendingChannels.has(peer.token)) {
        try {
          if (!this.isRegisteredParticipant(peer)) {
            this.pendingChannelPeers.delete(peer.token);
            this.clearRemotePendingDeletionOperations(peer.token);
            return;
          }
          if (!(await this.isAlive(peer))) {
            this.removePeerRecord(peer);
            this.pendingChannelPeers.delete(peer.token);
            this.clearRemotePendingDeletionOperations(peer.token);
            return;
          }
          await this.connectPendingChannel(peer);
          return;
        } catch {
          // Keep the peer's pending IDs locked until absence is confirmed by its record and listener.
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 2000);
        }
      }
    } finally {
      this.pendingChannelReconnects.delete(peer.token);
    }
  }

  private removePeerRecord(peer: Participant): void {
    const recordPath = path.join(this.directory, `${peer.token}.json`);
    try {
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Participant;
      if (record.token === peer.token && record.port === peer.port) fs.unlinkSync(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async tryJoin(): Promise<boolean> {
    let peers: Participant[];
    try { peers = await this.livePeers(); }
    catch (error) {
      // Discovery has no cleanup authority; a reset is still unknown, so retry admission without pruning.
      if (['ECONNRESET', 'EPIPE'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
      throw error;
    }
    for (const peer of peers) {
      const response = await this.request(peer);
      if (response.status === 'admitted') return true;
      if (response.status !== 'offer' || !this.acceptTakeover) continue;
      const takeover = await this.acceptTakeover(response.candidates!);
      let committed = false;
      try {
        if (!takeover.pids.length) continue;
        committed = (await this.request(peer, response.departure, takeover.pids)).status === 'admitted';
        if (committed) return true;
      } finally { takeover.finish(committed); }
    }
    return false;
  }

  private request(peer: Participant, departure?: string, pids?: number[]): Promise<{
    status: 'wait' | 'admitted' | 'offer'; departure?: string; candidates?: SharedRuntimeTakeoverCandidate[];
  }> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: peer.port });
      let input = '';
      let authenticated = false;
      const finish = (error?: Error): void => { socket.destroy(); if (error) reject(error); };
      socket.setTimeout(5000, () => finish(new Error('Shared Canvas handoff timed out.')));
      socket.on('error', error => {
        // A coordinator can leave between discovery and negotiation. Retry without pruning its record.
        if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          socket.destroy(); resolve({ status: 'wait' });
        } else finish(error);
      });
      socket.on('data', chunk => {
        input += chunk.toString();
        if (input.length > 65536) { finish(new Error('Invalid shared Canvas handoff response.')); return; }
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        if (!authenticated) {
          if (input.slice(0, newline) !== peer.token) { finish(new Error('Shared Canvas handoff identity changed.')); return; }
          authenticated = true; input = input.slice(newline + 1);
          socket.write(`${JSON.stringify({ target: peer.token, peer: { token: this.token, port: this.port }, departure, pids })}\n`);
        }
        if (!input.includes('\n')) return;
        try { resolve(JSON.parse(input.trim())); socket.destroy(); }
        catch (error) { finish(error as Error); }
      });
      socket.on('end', () => { resolve({ status: 'wait' }); socket.destroy(); });
    });
  }

  private async livePeers(): Promise<Participant[]> {
    let files: string[];
    try { files = fs.readdirSync(this.directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const live: Participant[] = [];
    for (const file of files) {
      // A crash before atomic admission publication can leave only this non-member staging file.
      if (/^[a-f0-9-]{36}\.tmp$/.test(file)) continue;
      if (file === `${this.token}.json`) continue;
      const recordPath = path.join(this.directory, file);
      let participant: Participant;
      try { participant = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Participant; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (!/^[a-f0-9-]{36}$/.test(participant.token) || file !== `${participant.token}.json` ||
          !Number.isInteger(participant.port) || participant.port < 60000 || participant.port >= 65000) {
        throw new Error('Invalid shared Canvas participant record.');
      }
      let alive: boolean;
      try { alive = await this.isAlive(participant); }
      catch (error) {
        // An ordinary dispose may withdraw the record while this probe is in flight.
        if (['ECONNRESET', 'EPIPE'].includes((error as NodeJS.ErrnoException).code ?? '') && !fs.existsSync(recordPath)) continue;
        throw error;
      }
      if (alive) live.push(participant);
      else {
        try { fs.unlinkSync(recordPath); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    return live;
  }

  private isAlive(participant: Participant): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: participant.port });
      let received = '';
      let done = false;
      const finish = (alive?: boolean, error?: Error): void => {
        if (done) return;
        done = true;
        socket.destroy();
        if (error) reject(error); else resolve(alive!);
      };
      socket.setTimeout(1000, () => finish(undefined, new Error('Shared Canvas participation probe timed out.')));
      socket.on('data', chunk => {
        received += chunk.toString();
        if (received.length > 128) finish(undefined, new Error('Unexpected shared Canvas participation response.'));
        else if (received.includes('\n')) received === `${participant.token}\n` ? finish(true)
          : finish(undefined, new Error('Shared Canvas participation identity changed.'));
      });
      socket.on('end', () => received === `${participant.token}\n` ? finish(true)
        : finish(undefined, new Error('Shared Canvas participation identity changed.')));
      socket.on('error', error => (error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
        ? finish(false) : finish(undefined, error));
    });
  }

  private async acquireAdmission(): Promise<net.Server>;
  private async acquireAdmission(join: () => Promise<boolean>): Promise<net.Server | undefined>;
  private async acquireAdmission(join?: () => Promise<boolean>): Promise<net.Server | undefined> {
    const port = this.admissionPort;
    const deadline = Date.now() + 90000;
    for (;;) {
      const lease = net.createServer(socket => socket.destroy());
      try {
        await new Promise<void>((resolve, reject) => {
          lease.once('error', reject);
          lease.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
            lease.removeListener('error', reject); resolve();
          });
        });
        return lease;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || Date.now() >= deadline) throw error;
        if (this.disposed) throw new Error('Shared Canvas participant is disposed.');
        if (join && await join()) return undefined;
        await new Promise(resolve => setTimeout(resolve, join ? 50 : 10));
      }
    }
  }
}
