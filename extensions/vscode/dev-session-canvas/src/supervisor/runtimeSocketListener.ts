import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import * as net from 'net';

/** Owns the listener, including old accepted connections during endpoint repair. */
export class RuntimeSocketListener {
  private current?: net.Server;
  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;
  private closing?: Promise<void>;
  private opening?: Promise<void>;
  private identity?: Stats;
  private lastError?: string;
  private stopped = false;
  private readonly servers = new Map<net.Server, Promise<void>>();
  private readonly closingServers = new WeakSet<net.Server>();

  constructor(
    private readonly socketPath: string,
    private readonly prepareDirectory: () => Promise<void>,
    private readonly accept: (socket: net.Socket) => void,
    private readonly report: (error: unknown) => void,
    private readonly intervalMs = 1000
  ) {}

  async start(): Promise<void> {
    if (this.opening || this.stopped) throw new Error('Runtime listener has already started or closed.');
    await (this.opening = this.bind());
    if (this.stopped) return;
    this.timer = setInterval(() => {
      if (this.stopped || this.checking) return;
      const check = this.repair().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.lastError) this.report(error);
        this.lastError = message;
      });
      this.checking = check;
      void check.finally(() => { if (this.checking === check) this.checking = undefined; });
    }, this.intervalMs);
    this.timer.unref();
  }

  close(callback: (error?: Error) => void): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.closing ??= (async () => {
      await this.opening;
      await this.checking;
      if (this.current) await this.assertPathNotReplaced();
      const entries = [...this.servers];
      for (const [server] of entries) this.stopAccepting(server);
      await Promise.all(entries.map(([, closed]) => closed));
    })();
    void this.closing.then(() => callback(), error => callback(error instanceof Error ? error : new Error(String(error))));
  }

  private stopAccepting(server: net.Server): void {
    if (this.closingServers.has(server)) return;
    this.closingServers.add(server);
    // Node unlinks the old pathname here, before a replacement listener is bound.
    // Its accepted sockets stay open and remain part of the close promise.
    server.close();
  }

  private async pathStat(): Promise<Stats | undefined> {
    try { return await fs.lstat(this.socketPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async assertPathNotReplaced(): Promise<Stats | undefined> {
    const stat = await this.pathStat();
    if (stat && (!stat.isSocket() || stat.dev !== this.identity?.dev || stat.ino !== this.identity?.ino)) {
      throw new Error('Runtime Supervisor socket path was replaced; refusing to remove another object.');
    }
    return stat;
  }

  private async repair(): Promise<void> {
    if (this.stopped || await this.assertPathNotReplaced()) return;
    await this.prepareDirectory();
    if (this.stopped || await this.assertPathNotReplaced()) return;
    if (this.current) {
      this.stopAccepting(this.current);
      this.current = undefined;
    }
    if (!this.stopped) {
      await this.bind();
      this.lastError = undefined;
    }
  }

  private async bind(): Promise<void> {
    const server = net.createServer(socket => this.stopped ? socket.destroy() : this.accept(socket));
    const closed = new Promise<void>(resolve => server.once('close', () => {
      this.servers.delete(server);
      resolve();
    }));
    this.servers.set(server, closed);
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once('error', failed);
        server.listen(this.socketPath, () => {
          server.removeListener('error', failed);
          server.on('error', this.report);
          resolve();
        });
      });
      this.current = server;
      this.identity = await this.pathStat();
    } catch (error) {
      // Failed listen acquired no accepted sockets; do not retain an unclosable entry.
      this.servers.delete(server);
      server.close();
      throw error;
    }
  }
}
