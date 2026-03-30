export type ExecutionSessionBackendKind = 'node-pty';
export const MISSING_NODE_PTY_ERROR_CODE = 'OPENCOVE_NODE_PTY_MISSING';

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

interface NodePtyLike {
  readonly pid: number;
  readonly process: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (chunk: string) => void): DisposableLike;
  onExit(
    listener: (event: { exitCode: number; signal: number | string | undefined }) => void
  ): DisposableLike;
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
      useConpty?: boolean;
    }
  ): NodePtyLike;
}

class NodePtyExecutionSessionProcess implements ExecutionSessionProcess {
  public readonly backend: ExecutionSessionBackendKind = 'node-pty';

  public constructor(private readonly pty: NodePtyLike) {}

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
  const nodePty = loadNodePtyModule();
  const pty = nodePty.spawn(spec.file, [...(spec.args ?? [])], {
    name: spec.terminalName ?? (process.platform === 'win32' ? 'xterm-color' : 'xterm-256color'),
    cols: spec.cols,
    rows: spec.rows,
    cwd: spec.cwd,
    env: spec.env,
    useConpty: process.platform === 'win32' ? true : undefined
  });

  return new NodePtyExecutionSessionProcess(pty);
}

export function isMissingNodePtyDependencyError(error: unknown): boolean {
  return isRecord(error) && error.code === MISSING_NODE_PTY_ERROR_CODE;
}

function loadNodePtyModule(): NodePtyModule {
  try {
    ensureNodePtyHelperExecutable();
    return require('node-pty') as NodePtyModule;
  } catch (error) {
    if (isMissingRequiredModuleError(error, 'node-pty')) {
      throw createMissingNodePtyDependencyError();
    }

    throw error;
  }
}

function isMissingRequiredModuleError(error: unknown, moduleName: string): boolean {
  if (!isRecord(error) || error.code !== 'MODULE_NOT_FOUND') {
    return false;
  }

  return (
    typeof error.message === 'string' &&
    error.message.includes(`Cannot find module '${moduleName}'`)
  );
}

function createMissingNodePtyDependencyError(): Error & { code: string } {
  const error = new Error(
    '缺少 node-pty 运行时依赖，请在仓库根目录执行 npm install 后重试。'
  ) as Error & { code: string };
  error.name = 'MissingNodePtyDependencyError';
  error.code = MISSING_NODE_PTY_ERROR_CODE;
  return error;
}

function ensureNodePtyHelperExecutable(): void {
  if (process.platform === 'win32') {
    return;
  }

  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const packageJsonPath = require.resolve('node-pty/package.json');
    const packageRoot = path.dirname(packageJsonPath);
    const helperCandidates = [
      path.join(packageRoot, 'build', 'Release', 'spawn-helper'),
      path.join(packageRoot, 'build', 'Debug', 'spawn-helper'),
      path.join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    ];

    for (const helperPath of helperCandidates) {
      if (!fs.existsSync(helperPath)) {
        continue;
      }

      const currentMode = fs.statSync(helperPath).mode & 0o777;
      if ((currentMode & 0o111) !== 0) {
        continue;
      }

      fs.chmodSync(helperPath, currentMode | 0o755);
    }
  } catch {
    // Best effort only. If permission repair still fails, node-pty will surface the spawn error.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
