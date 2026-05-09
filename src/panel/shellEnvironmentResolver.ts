import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const SHELL_ENV_TIMEOUT_MS = 10000;
const POSIX_FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh'];
const WINDOWS_FALLBACK_SHELLS = ['pwsh.exe', 'powershell.exe', 'cmd.exe'];
const POSIX_STYLE_SHELL_NAMES = new Set(['bash', 'csh', 'fish', 'sh', 'tcsh', 'zsh']);
const WINDOWS_CMD_SHELL_NAMES = new Set(['cmd']);
const WINDOWS_POWERSHELL_NAMES = new Set(['powershell', 'pwsh']);
const NON_INTERACTIVE_SHELL_NAMES = new Set(['false', 'git-shell', 'nologin']);
const EXCLUDED_SHELL_ENV_KEYS = new Set([
  'CD',
  'COLORTERM',
  'COLUMNS',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_RUN_AS_NODE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LINES',
  'OLDPWD',
  'PATH_TRANSLATED',
  'PROMPT',
  'PS1',
  'PS2',
  'PWD',
  'RPROMPT',
  'SHLVL',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'USERPROFILE',
  'VSCODE_RESOLVING_ENVIRONMENT',
  '_'
]);
const EXCLUDED_SHELL_ENV_PREFIXES = ['BASH_FUNC_', 'ELECTRON_', 'VSCODE_', 'XPC_', '__CF'];

export type ShellEnvironmentPatchSource = 'none' | 'posix-login-shell' | 'powershell' | 'windows-shell';
export type ShellEnvironmentPatchFamily = 'cmd' | 'posix' | 'powershell' | 'unsupported';
export type ShellEnvironmentPatchTarget = 'agent' | 'terminal';
export type ShellEnvironmentProbeMode = 'interactive-login' | 'login';
export type ShellEnvironmentPatchSkipReason =
  | 'launched-from-cli'
  | 'shell-not-found'
  | 'shell-not-supported'
  | 'shell-resolution-failed';

export interface ResolvedShellEnvironmentPatch {
  envPatch: NodeJS.ProcessEnv;
  source: ShellEnvironmentPatchSource;
  shellPath?: string;
  shellFamily?: ShellEnvironmentPatchFamily;
  probeMode: ShellEnvironmentProbeMode;
  appliedKeys: string[];
  skippedReason?: ShellEnvironmentPatchSkipReason;
  error?: string;
}

export interface ResolveShellEnvironmentPatchOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  processExecPath?: string;
  platform?: NodeJS.Platform;
  shellPath?: string;
  timeoutMs?: number;
  probeMode?: ShellEnvironmentProbeMode;
}

export interface ApplyShellEnvironmentPatchOptions {
  prioritizedBasePathEntries?: string[];
}

interface SpawnCaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: Buffer;
  stdout: Buffer;
}

class UnsupportedShellEnvironmentResolverError extends Error {}

export async function resolveShellEnvironmentPatch(
  options: ResolveShellEnvironmentPatchOptions
): Promise<ResolvedShellEnvironmentPatch> {
  const platform = options.platform ?? process.platform;
  const probeMode = options.probeMode ?? 'interactive-login';
  if (options.env.VSCODE_CLI === '1') {
    return emptyShellEnvironmentPatch('launched-from-cli', probeMode);
  }

  const shellPath =
    options.shellPath?.trim() ||
    (platform === 'win32' ? await resolveWindowsShellPath(options.env) : await resolvePosixShellPath(options.env));
  if (!shellPath) {
    return emptyShellEnvironmentPatch('shell-not-found', probeMode);
  }

  const shellFamily = detectShellFamily(shellPath, platform);
  try {
    const shellEnv = await resolveShellEnvironment({
      cwd: options.cwd,
      env: options.env,
      platform,
      processExecPath: options.processExecPath ?? process.execPath,
      shellPath,
      timeoutMs: options.timeoutMs ?? SHELL_ENV_TIMEOUT_MS,
      shellFamily,
      probeMode
    });
    const envPatch = buildControlledShellEnvironmentPatch(options.env, shellEnv, platform);
    const appliedKeys = Object.keys(envPatch).sort((left, right) => left.localeCompare(right));
    return {
      envPatch,
      source: resolveShellEnvironmentPatchSource(platform, shellFamily),
      shellPath,
      shellFamily,
      probeMode,
      appliedKeys
    };
  } catch (error) {
    return {
      ...emptyShellEnvironmentPatch(
        error instanceof UnsupportedShellEnvironmentResolverError ? 'shell-not-supported' : 'shell-resolution-failed',
        probeMode
      ),
      shellPath,
      shellFamily,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function shouldResolveShellEnvironmentPatchForExecutionTarget(
  target: ShellEnvironmentPatchTarget,
  platform: NodeJS.Platform = process.platform,
  options: { terminalInheritEnv?: boolean } = {}
): boolean {
  if (target === 'agent') {
    return true;
  }

  if (platform === 'win32') {
    return false;
  }

  return options.terminalInheritEnv !== false;
}

export function buildControlledShellEnvironmentPatch(
  baseEnv: NodeJS.ProcessEnv,
  shellEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const envPatch: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value !== 'string') {
      continue;
    }

    const resolvedKey = resolveEnvironmentPatchKey(key, baseEnv, platform);
    if (!shouldIncludeShellEnvironmentKey(resolvedKey, value, readEnvironmentValue(baseEnv, resolvedKey, platform))) {
      continue;
    }

    setEnvironmentValue(envPatch, resolvedKey, value, platform);
  }

  return envPatch;
}

export function applyShellEnvironmentPatch(
  baseEnv: NodeJS.ProcessEnv,
  envPatch: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  options: ApplyShellEnvironmentPatchOptions = {}
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...baseEnv
  };

  for (const [key, value] of Object.entries(envPatch)) {
    if (typeof value !== 'string') {
      continue;
    }
    setEnvironmentValue(nextEnv, key, value, platform);
  }

  const basePathValue = readEnvironmentValue(baseEnv, 'PATH', platform);
  const shellPathValue = readEnvironmentValue(envPatch, 'PATH', platform);
  if (typeof basePathValue === 'string' && typeof shellPathValue === 'string') {
    setEnvironmentValue(
      nextEnv,
      'PATH',
      mergePathEnvironmentValue(basePathValue, shellPathValue, platform, options),
      platform
    );
  }

  return nextEnv;
}

function shouldIncludeShellEnvironmentKey(key: string, value: string, previousValue: string | undefined): boolean {
  if (!key || value === previousValue) {
    return false;
  }

  const normalizedKey = key.toUpperCase();
  if (EXCLUDED_SHELL_ENV_KEYS.has(normalizedKey)) {
    return false;
  }

  for (const prefix of EXCLUDED_SHELL_ENV_PREFIXES) {
    if (normalizedKey.startsWith(prefix)) {
      return false;
    }
  }

  return true;
}

function mergePathEnvironmentValue(
  basePathValue: string,
  shellPathValue: string,
  platform: NodeJS.Platform,
  options: ApplyShellEnvironmentPatchOptions
): string {
  const delimiter = platform === 'win32' ? ';' : ':';
  const prioritizedEntries = new Set(
    (options.prioritizedBasePathEntries ?? []).map((entry) => normalizePathEntry(entry, platform))
  );
  const shellEntries = splitPathEntries(shellPathValue, delimiter);
  const shellSeen = new Set(shellEntries.map((entry) => normalizePathEntry(entry, platform)));
  const prependedBaseEntries: string[] = [];
  const appendedBaseEntries: string[] = [];
  const baseOnlySeen = new Set<string>();
  for (const entry of splitPathEntries(basePathValue, delimiter)) {
    const normalizedEntry = normalizePathEntry(entry, platform);
    if (shellSeen.has(normalizedEntry) || baseOnlySeen.has(normalizedEntry)) {
      continue;
    }
    baseOnlySeen.add(normalizedEntry);
    if (prioritizedEntries.has(normalizedEntry)) {
      prependedBaseEntries.push(entry);
      continue;
    }
    appendedBaseEntries.push(entry);
  }

  return [...prependedBaseEntries, ...shellEntries, ...appendedBaseEntries].join(delimiter);
}

function splitPathEntries(value: string, delimiter: string): string[] {
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePathEntry(entry: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? entry.toLowerCase() : entry;
}

async function resolveShellEnvironment(options: {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  processExecPath: string;
  shellPath: string;
  timeoutMs: number;
  shellFamily: ShellEnvironmentPatchFamily;
  probeMode: ShellEnvironmentProbeMode;
}): Promise<NodeJS.ProcessEnv> {
  const shellFamily = options.shellFamily;
  if (shellFamily === 'powershell') {
    return resolvePowerShellEnvironment(options);
  }

  if (shellFamily === 'cmd') {
    if (options.platform !== 'win32') {
      throw new UnsupportedShellEnvironmentResolverError(`当前 shell 不支持环境解析：${options.shellPath}`);
    }
    return resolveWindowsCmdEnvironment(options);
  }

  if (shellFamily === 'posix') {
    return resolvePosixShellEnvironment(options);
  }

  throw new UnsupportedShellEnvironmentResolverError(`当前 shell 不支持环境解析：${options.shellPath}`);
}

function resolveShellEnvironmentPatchSource(
  platform: NodeJS.Platform,
  shellFamily: ShellEnvironmentPatchFamily
): ShellEnvironmentPatchSource {
  if (platform === 'win32') {
    return 'windows-shell';
  }

  return shellFamily === 'powershell' ? 'powershell' : 'posix-login-shell';
}

function detectShellFamily(
  shellPath: string,
  platform: NodeJS.Platform
): ShellEnvironmentPatchFamily {
  const extension = platform === 'win32' ? path.extname(shellPath) : '';
  const shellName = path.basename(shellPath, extension).toLowerCase();
  if (WINDOWS_POWERSHELL_NAMES.has(shellName)) {
    return 'powershell';
  }
  if (WINDOWS_CMD_SHELL_NAMES.has(shellName)) {
    return 'cmd';
  }
  if (POSIX_STYLE_SHELL_NAMES.has(shellName)) {
    return 'posix';
  }

  return platform === 'win32' ? 'unsupported' : 'posix';
}

async function resolvePosixShellPath(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const shellCandidates = new Set<string>();
  const preferredShell = env.SHELL?.trim();
  if (preferredShell) {
    shellCandidates.add(preferredShell);
  }
  for (const shellPath of POSIX_FALLBACK_SHELLS) {
    shellCandidates.add(shellPath);
  }

  for (const shellPath of shellCandidates) {
    const resolvedCandidate = await resolveShellExecutableCandidate(shellPath, 'linux', env);
    if (!resolvedCandidate) {
      continue;
    }
    const shellName = path.basename(resolvedCandidate).toLowerCase();
    if (NON_INTERACTIVE_SHELL_NAMES.has(shellName)) {
      continue;
    }
    return resolvedCandidate;
  }

  return undefined;
}

async function resolveWindowsShellPath(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const shellCandidates = new Set<string>();
  const commandShell = env.ComSpec?.trim() || env.COMSPEC?.trim();
  if (commandShell) {
    shellCandidates.add(commandShell);
  }
  for (const shellPath of WINDOWS_FALLBACK_SHELLS) {
    shellCandidates.add(shellPath);
  }

  for (const shellPath of shellCandidates) {
    const resolvedCandidate = await resolveShellExecutableCandidate(shellPath, 'win32', env);
    if (resolvedCandidate) {
      return resolvedCandidate;
    }
  }

  return undefined;
}

async function resolvePosixShellEnvironment(options: {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  processExecPath: string;
  shellPath: string;
  timeoutMs: number;
  probeMode: ShellEnvironmentProbeMode;
}): Promise<NodeJS.ProcessEnv> {
  const mark = randomUUID().replace(/-/g, '').slice(0, 12);
  const shellName = path.basename(options.shellPath).toLowerCase();
  const shellCommand = `'${escapePosixSingleQuoted(options.processExecPath)}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
  const shellArgs =
    shellName === 'tcsh' || shellName === 'csh'
      ? ['-ic', shellCommand]
      : options.probeMode === 'login'
        ? ['-l', '-c', shellCommand]
        : ['-i', '-l', '-c', shellCommand];
  const capture = await spawnAndCapture({
    file: options.shellPath,
    args: shellArgs,
    cwd: options.cwd,
    env: buildShellProbeEnvironment(options.env),
    timeoutMs: options.timeoutMs
  });
  const stdout = capture.stdout.toString('utf8');
  const stderr = capture.stderr.toString('utf8').trim();
  return parseMarkedJsonPayload({
    code: capture.code,
    signal: capture.signal,
    mark,
    stderr,
    stdout,
    failurePrefix: '登录 shell 没有返回可解析的环境快照'
  });
}

async function resolvePowerShellEnvironment(options: {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  shellPath: string;
  timeoutMs: number;
}): Promise<NodeJS.ProcessEnv> {
  const mark = randomUUID().replace(/-/g, '').slice(0, 12);
  const powerShellCommand = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$dscEnv = @{}',
    'Get-ChildItem Env: | ForEach-Object { $dscEnv[$_.Name] = $_.Value }',
    `Write-Output ('${mark}' + ($dscEnv | ConvertTo-Json -Compress) + '${mark}')`
  ].join('; ');
  const capture = await spawnAndCapture({
    file: options.shellPath,
    args: ['-NoLogo', '-Command', powerShellCommand],
    cwd: options.cwd,
    env: buildShellProbeEnvironment(options.env),
    timeoutMs: options.timeoutMs
  });
  const stdout = capture.stdout.toString('utf8');
  const stderr = capture.stderr.toString('utf8').trim();
  return parseMarkedJsonPayload({
    code: capture.code,
    signal: capture.signal,
    mark,
    stderr,
    stdout,
    failurePrefix: 'PowerShell 没有返回可解析的环境快照'
  });
}

async function resolveWindowsCmdEnvironment(options: {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  shellPath: string;
  timeoutMs: number;
}): Promise<NodeJS.ProcessEnv> {
  const capture = await spawnAndCapture({
    file: options.shellPath,
    args: ['/u', '/c', 'set'],
    cwd: options.cwd,
    env: buildShellProbeEnvironment(options.env),
    timeoutMs: options.timeoutMs
  });
  if (capture.code !== 0) {
    const stderr = capture.stderr.toString('utf8').trim();
    throw new Error(stderr || `cmd.exe 环境解析失败（exit=${capture.code ?? 'unknown'}, signal=${capture.signal ?? 'none'}）。`);
  }

  return parseWindowsSetEnvironmentOutput(capture.stdout.toString('utf16le'));
}

function parseMarkedJsonPayload(options: {
  code: number | null;
  failurePrefix: string;
  mark: string;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}): NodeJS.ProcessEnv {
  const extractor = new RegExp(`${options.mark}([\\s\\S]*?)${options.mark}`);
  const match = options.stdout.match(extractor);
  if (!match?.[1]) {
    throw new Error(
      options.stderr ||
        `${options.failurePrefix}（exit=${options.code ?? 'unknown'}, signal=${options.signal ?? 'none'}）。`
    );
  }

  try {
    return JSON.parse(match[1]) as NodeJS.ProcessEnv;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function parseWindowsSetEnvironmentOutput(stdout: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const normalizedOutput = stdout.replace(/^\uFEFF/, '');
  for (const line of normalizedOutput.split(/\r?\n/u)) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const value = line.slice(separatorIndex + 1);
    env[key] = value;
  }

  return env;
}

function buildShellProbeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    ELECTRON_RUN_AS_NODE: '1',
    VSCODE_RESOLVING_ENVIRONMENT: '1'
  };
}

async function spawnAndCapture(options: {
  file: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<SpawnCaptureResult> {
  const child = spawn(resolveSpawnFile(options.file, options.cwd), options.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: normalizeSpawnCwd(options.cwd),
    env: options.env,
    windowsHide: true
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  return await new Promise<SpawnCaptureResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('shell 环境解析超时。'));
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stderr: Buffer.concat(stderrChunks),
        stdout: Buffer.concat(stdoutChunks)
      });
    });
  });
}

function emptyShellEnvironmentPatch(
  skipReason: ShellEnvironmentPatchSkipReason,
  probeMode: ShellEnvironmentProbeMode = 'interactive-login'
): ResolvedShellEnvironmentPatch {
  return {
    envPatch: {},
    source: 'none',
    probeMode,
    appliedKeys: [],
    skippedReason: skipReason
  };
}

function normalizeSpawnCwd(cwd: string | undefined): string | undefined {
  const normalizedCwd = cwd?.trim();
  return normalizedCwd && normalizedCwd.length > 0 ? normalizedCwd : undefined;
}

function resolveSpawnFile(file: string, cwd: string | undefined): string {
  const normalizedCwd = normalizeSpawnCwd(cwd);
  if (!normalizedCwd || !isExplicitRelativePath(file)) {
    return file;
  }

  return path.resolve(normalizedCwd, file);
}

function escapePosixSingleQuoted(value: string): string {
  return value.replace(/'/g, `'"'"'`);
}

async function resolveShellExecutableCandidate(
  candidatePath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const normalizedCandidatePath = candidatePath.trim();
  if (!normalizedCandidatePath) {
    return undefined;
  }

  const shellName = path.basename(normalizedCandidatePath, platform === 'win32' ? path.extname(normalizedCandidatePath) : '');
  if (NON_INTERACTIVE_SHELL_NAMES.has(shellName.toLowerCase())) {
    return undefined;
  }

  if (path.isAbsolute(normalizedCandidatePath)) {
    return (await isExecutableCandidate(normalizedCandidatePath, platform)) ? normalizedCandidatePath : undefined;
  }

  if (isExplicitRelativePath(normalizedCandidatePath)) {
    const resolvedRelativePath = path.resolve(normalizedCandidatePath);
    return (await isExecutableCandidate(resolvedRelativePath, platform)) ? resolvedRelativePath : undefined;
  }

  return resolveCommandFromPathEnv(normalizedCandidatePath, env, platform);
}

async function resolveCommandFromPathEnv(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  const pathValue = readEnvironmentValue(env, 'PATH', platform)?.trim();
  if (!pathValue) {
    return undefined;
  }

  const directories = pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const commandCandidates = buildPathCommandCandidates(command, env, platform);
  for (const directory of directories) {
    for (const commandCandidate of commandCandidates) {
      const candidatePath = path.join(directory, commandCandidate);
      if (await isExecutableCandidate(candidatePath, platform)) {
        return candidatePath;
      }
    }
  }

  return undefined;
}

function buildPathCommandCandidates(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32' || path.extname(command)) {
    return [command];
  }

  const candidates = new Set<string>();
  for (const extension of readWindowsPathExt(env)) {
    if (!extension) {
      continue;
    }
    candidates.add(`${command}${extension}`);
  }
  candidates.add(command);
  return Array.from(candidates);
}

function readWindowsPathExt(env: NodeJS.ProcessEnv): string[] {
  const pathExt = readEnvironmentValue(env, 'PATHEXT', 'win32')?.trim();
  const configured =
    pathExt && pathExt.length > 0
      ? pathExt
          .split(';')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : ['.com', '.exe', '.bat', '.cmd'];
  const normalized = new Set<string>(configured);
  normalized.add('');
  return Array.from(normalized);
}

function resolveEnvironmentPatchKey(
  key: string,
  baseEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string {
  if (platform !== 'win32') {
    return key;
  }

  const existingKey = findEnvironmentKey(baseEnv, key, platform);
  if (existingKey) {
    return existingKey;
  }

  switch (key.toLowerCase()) {
    case 'path':
      return 'PATH';
    case 'pathext':
      return 'PATHEXT';
    case 'comspec':
      return 'ComSpec';
    default:
      return key;
  }
}

function readEnvironmentValue(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform
): string | undefined {
  const resolvedKey = findEnvironmentKey(env, key, platform);
  const value = resolvedKey ? env[resolvedKey] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function setEnvironmentValue(
  env: NodeJS.ProcessEnv,
  key: string,
  value: string,
  platform: NodeJS.Platform
): void {
  if (platform === 'win32') {
    for (const existingKey of Object.keys(env)) {
      if (existingKey.toLowerCase() === key.toLowerCase() && existingKey !== key) {
        delete env[existingKey];
      }
    }
  }

  env[key] = value;
}

function findEnvironmentKey(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== 'win32') {
    return Object.prototype.hasOwnProperty.call(env, key) ? key : undefined;
  }

  const normalizedKey = key.toLowerCase();
  return Object.keys(env).find((candidateKey) => candidateKey.toLowerCase() === normalizedKey);
}

function isExplicitRelativePath(command: string): boolean {
  return (
    command.startsWith(`.${path.sep}`) ||
    command.startsWith(`..${path.sep}`) ||
    command.startsWith('./') ||
    command.startsWith('../')
  );
}

async function isExecutableCandidate(candidatePath: string, platform: NodeJS.Platform): Promise<boolean> {
  if (!candidatePath) {
    return false;
  }

  try {
    await fs.access(candidatePath, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
