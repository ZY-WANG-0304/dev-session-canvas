import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { RuntimeHostBackendKind } from '../common/protocol';
import type { RuntimeOwnerDescriptorV1 } from '../common/runtimeRootOwnership';

interface Participant { token: string; port: number }
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

  constructor(private readonly filename: string, private readonly acceptTakeover?: AcceptSharedRuntimeTakeover) {
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

  dispose(): void {
    this.disposed = true;
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
    try { lease = await this.acquireAdmission(async () => this.tryJoin()); }
    catch (error) { server.close(); throw error; }
    try {
      if (this.disposed) return;
      if (lease) { await this.livePeers(); this.writeRecord({ token: this.token, port }); }
    } catch (error) {
      server.close(); throw error;
    } finally {
      if (lease) await close(lease);
      if (this.disposed && server.listening) server.close();
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
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(5000, () => socket.destroy());
    socket.write(`${this.token}\n`);
    let input = '';
    let processing = false;
    socket.on('data', chunk => {
      input += chunk.toString();
      if (input.length > 65536 || processing) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      processing = true;
      void (async () => {
        const request = JSON.parse(input.trim()) as { target: string; peer: Participant; departure?: string; pids?: number[] };
        const peer = request.peer;
        if (request.target !== this.token || !peer || !/^[a-f0-9-]{36}$/.test(peer.token) ||
            !Number.isInteger(peer.port) || peer.port < 60000 || peer.port >= 65000) throw new Error('Invalid joining participant.');
        if (!await this.isAlive(peer) || socket.destroyed) throw new Error('Joining participant is unconfirmed.');
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
      })().then(response => { if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`); }, () => socket.destroy());
    });
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
