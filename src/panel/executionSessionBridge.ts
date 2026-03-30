import { spawn, type IPty } from 'node-pty';

export type ExecutionSessionBackendKind = 'node-pty';

export interface ExecutionSessionExitEvent {
  exitCode: number;
  signal?: string;
}

export interface DisposableLike {
  dispose(): void;
}

export interface ExecutionSessionLaunchSpec {
  file: string;
  args?: readonly string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
  terminalName?: string;
}

export interface ExecutionSessionProcess {
  readonly backend: ExecutionSessionBackendKind;
  readonly pid: number;
  readonly processName: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (chunk: string) => void): DisposableLike;
  onExit(listener: (event: ExecutionSessionExitEvent) => void): DisposableLike;
}

class NodePtyExecutionSessionProcess implements ExecutionSessionProcess {
  public readonly backend: ExecutionSessionBackendKind = 'node-pty';

  public constructor(private readonly pty: IPty) {}

  public get pid(): number {
    return this.pty.pid;
  }

  public get processName(): string {
    return this.pty.process;
  }

  public write(data: string): void {
    this.pty.write(data);
  }

  public resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  public kill(): void {
    this.pty.kill();
  }

  public onData(listener: (chunk: string) => void): DisposableLike {
    return this.pty.onData(listener);
  }

  public onExit(listener: (event: ExecutionSessionExitEvent) => void): DisposableLike {
    return this.pty.onExit((event) =>
      listener({
        exitCode: event.exitCode,
        signal: normalizeExecutionSessionExitSignal(event.signal)
      })
    );
  }
}

function normalizeExecutionSessionExitSignal(signal: number | string | undefined): string | undefined {
  if (typeof signal === 'number') {
    return signal > 0 ? String(signal) : undefined;
  }

  if (typeof signal === 'string') {
    const normalizedSignal = signal.trim();
    return normalizedSignal && normalizedSignal !== '0' ? normalizedSignal : undefined;
  }

  return undefined;
}

export function createExecutionSessionProcess(spec: ExecutionSessionLaunchSpec): ExecutionSessionProcess {
  const pty = spawn(spec.file, [...(spec.args ?? [])], {
    name: spec.terminalName ?? (process.platform === 'win32' ? 'xterm-color' : 'xterm-256color'),
    cols: spec.cols,
    rows: spec.rows,
    cwd: spec.cwd,
    env: spec.env,
    useConpty: process.platform === 'win32' ? true : undefined
  });

  return new NodePtyExecutionSessionProcess(pty);
}
