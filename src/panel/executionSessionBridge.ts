import * as path from 'path';

export type ExecutionSessionBackendKind = 'node-pty';
export const MISSING_NODE_PTY_ERROR_CODE = 'DEV_SESSION_CANVAS_NODE_PTY_MISSING';
export const INCOMPATIBLE_NODE_PTY_ERROR_CODE = 'DEV_SESSION_CANVAS_NODE_PTY_INCOMPATIBLE';

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

export interface ResolvedExecutionSessionSpawnSpec {
  file: string;
  args: string[] | string;
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
    args: string[] | string,
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

let nodePtyRuntimeCompatibilityVerified = false;

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
  const spawnSpec = resolveExecutionSessionSpawnSpec(spec);
  const pty = nodePty.spawn(spawnSpec.file, spawnSpec.args, {
    name: spec.terminalName ?? (process.platform === 'win32' ? 'xterm-color' : 'xterm-256color'),
    cols: spec.cols,
    rows: spec.rows,
    cwd: spec.cwd,
    env: spec.env,
    useConpty: process.platform === 'win32' ? true : undefined
  });

  return new NodePtyExecutionSessionProcess(pty);
}

export function resolveExecutionSessionSpawnSpec(
  spec: Pick<ExecutionSessionLaunchSpec, 'file' | 'args' | 'env'>,
  platform: NodeJS.Platform = process.platform
): ResolvedExecutionSessionSpawnSpec {
  const args = [...(spec.args ?? [])];
  if (!shouldUseWindowsBatchWrapper(spec.file, platform)) {
    return {
      file: spec.file,
      args
    };
  }

  return {
    file: resolveWindowsCommandShell(spec.env),
    // `cmd.exe` reparses `/c` arguments as shell syntax, so hand it one
    // pre-escaped command string instead of an argv-style token list.
    args: buildWindowsBatchShellArgs(spec.file, args)
  };
}

export function isMissingNodePtyDependencyError(error: unknown): boolean {
  return isRecord(error) && error.code === MISSING_NODE_PTY_ERROR_CODE;
}

export function isIncompatibleNodePtyRuntimeError(error: unknown): boolean {
  return isRecord(error) && error.code === INCOMPATIBLE_NODE_PTY_ERROR_CODE;
}

function loadNodePtyModule(): NodePtyModule {
  try {
    ensureNodePtyRuntimeCompatibility();
    ensureNodePtyHelperExecutable();
    return require('node-pty') as NodePtyModule;
  } catch (error) {
    if (isMissingRequiredModuleError(error, 'node-pty')) {
      throw createMissingNodePtyDependencyError();
    }

    throw error;
  }
}

function shouldUseWindowsBatchWrapper(file: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') {
    return false;
  }

  const extension = path.extname(file).toLowerCase();
  return extension === '.cmd' || extension === '.bat';
}

function resolveWindowsCommandShell(env: NodeJS.ProcessEnv): string {
  return (
    env.ComSpec?.trim() ||
    env.COMSPEC?.trim() ||
    process.env.ComSpec?.trim() ||
    process.env.COMSPEC?.trim() ||
    'cmd.exe'
  );
}

function buildWindowsBatchShellArgs(file: string, args: readonly string[]): string {
  const shellCommand = [escapeWindowsCmdCommand(file), ...args.map(escapeWindowsCmdArgument)].join(
    ' '
  );
  return `/d /s /c "${shellCommand}"`;
}

function escapeWindowsCmdCommand(value: string): string {
  return value.replace(WINDOWS_CMD_META_CHARS_REGEXP, '^$1');
}

function escapeWindowsCmdArgument(value: string): string {
  let normalizedValue = `${value}`;

  // Based on cross-spawn's Windows escaping, which follows cmd.exe's
  // backslash+quote parsing rules for command-line arguments.
  normalizedValue = normalizedValue.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  normalizedValue = normalizedValue.replace(/(?=(\\+?)?)\1$/, '$1$1');
  normalizedValue = `"${normalizedValue}"`;

  return normalizedValue.replace(WINDOWS_CMD_META_CHARS_REGEXP, '^$1');
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

function ensureNodePtyRuntimeCompatibility(): void {
  if (nodePtyRuntimeCompatibilityVerified) {
    return;
  }

  const childProcess = require('child_process') as typeof import('child_process');
  const nodePtyEntryPath = require.resolve('node-pty');
  const probeResult = childProcess.spawnSync(
    process.execPath,
    ['-e', "require(process.argv[1]);", nodePtyEntryPath],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      },
      encoding: 'utf8',
      stdio: 'pipe'
    }
  );

  if (probeResult.error) {
    throw createIncompatibleNodePtyRuntimeError(
      `兼容性探测启动失败：${probeResult.error.message}`
    );
  }

  if (probeResult.signal || probeResult.status !== 0) {
    const signal = probeResult.signal ? `signal ${probeResult.signal}` : undefined;
    const status =
      typeof probeResult.status === 'number' ? `exit code ${probeResult.status}` : undefined;
    const reason = [signal, status].filter(Boolean).join(', ');
    const output = sanitizeProbeOutput(probeResult.stderr || probeResult.stdout || '');
    throw createIncompatibleNodePtyRuntimeError(
      [reason || '兼容性探测失败', output].filter(Boolean).join('；')
    );
  }

  nodePtyRuntimeCompatibilityVerified = true;
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

function createIncompatibleNodePtyRuntimeError(details: string): Error & { code: string } {
  const suffix = details ? `（${details}）` : '';
  const error = new Error(
    `当前 node-pty 运行时与 VS Code 扩展宿主 ${process.version} 不兼容，已阻止加载以避免扩展宿主崩溃。请重新执行 npm install，或升级到兼容当前 VS Code 版本的依赖后重试。${suffix}`
  ) as Error & { code: string };
  error.name = 'IncompatibleNodePtyRuntimeError';
  error.code = INCOMPATIBLE_NODE_PTY_ERROR_CODE;
  return error;
}

function sanitizeProbeOutput(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const WINDOWS_CMD_META_CHARS_REGEXP = /([()\][%!^"`<>&|;, *?])/g;
