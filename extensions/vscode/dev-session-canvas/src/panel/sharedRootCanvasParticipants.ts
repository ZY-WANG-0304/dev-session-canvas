import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

interface Participant { token: string; port: number }
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

  constructor(private readonly filename: string) {
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

  async depart<T>(work: (last: boolean) => Promise<T>, held?: Set<number>): Promise<T> {
    return this.withAdmission(async () => {
      const others = await this.livePeers();
      const result = await work(others.length === 0);
      this.retired = true;
      this.removeOwnRecord();
      return result;
    }, held);
  }

  dispose(): void {
    this.disposed = true;
    if (this.listener?.listening) this.listener.close();
    this.removeOwnRecord();
  }

  private removeOwnRecord(): void {
    try { fs.unlinkSync(path.join(this.directory, `${this.token}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  private async register(): Promise<void> {
    const server = net.createServer(socket => { socket.end(`${this.token}\n`); });
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
    let lease: net.Server;
    try { lease = await this.acquireAdmission(); }
    catch (error) { server.close(); throw error; }
    try {
      if (this.disposed) return;
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      await this.livePeers();
      const temporary = path.join(this.directory, `${this.token}.tmp`);
      try {
        fs.writeFileSync(temporary, JSON.stringify({ token: this.token, port }), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, path.join(this.directory, `${this.token}.json`));
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    } catch (error) {
      server.close(); throw error;
    } finally {
      await close(lease);
      if (this.disposed && server.listening) server.close();
    }
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
      if (await this.isAlive(participant)) live.push(participant);
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
      });
      socket.on('end', () => received === `${participant.token}\n` ? finish(true)
        : finish(undefined, new Error('Shared Canvas participation identity changed.')));
      socket.on('error', error => (error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
        ? finish(false) : finish(undefined, error));
    });
  }

  private async acquireAdmission(): Promise<net.Server> {
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
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
}
