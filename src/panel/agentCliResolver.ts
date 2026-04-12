import { execFile } from 'child_process';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import type { AgentProviderKind } from '../common/protocol';

const execFileAsync = promisify(execFile);
const POSIX_SHELL_PROBE_TIMEOUT_MS = 3000;
const WINDOWS_COMMAND_PROBE_TIMEOUT_MS = 3000;
const POSIX_FALLBACK_SHELLS = ['/bin/bash', '/bin/zsh', '/bin/sh'];
const WINDOWS_PATHEXT_FALLBACK = ['.com', '.exe', '.bat', '.cmd'];

export const AGENT_CLI_RESOLUTION_ERROR_CODE = 'DEV_SESSION_CANVAS_AGENT_CLI_RESOLUTION_FAILED';

export type AgentCliResolutionSource =
  | 'configured-absolute'
  | 'configured-relative'
  | 'cache'
  | 'path-env'
  | 'posix-login-shell'
  | 'windows-where'
  | 'windows-powershell';

export interface AgentCliResolutionCacheEntry {
  requestedCommand: string;
  resolvedCommand: string;
}

export interface ResolveAgentCliCommandOptions {
  provider: AgentProviderKind;
  label: string;
  requestedCommand: string;
  workspaceCwd?: string;
  env: NodeJS.ProcessEnv;
  cachedResolvedCommand?: string;
}

export interface ResolveAgentCliCommandResult {
  requestedCommand: string;
  resolvedCommand: string;
  source: AgentCliResolutionSource;
  attempts: string[];
}

export class AgentCliResolutionError extends Error {
  public readonly code = AGENT_CLI_RESOLUTION_ERROR_CODE;

  public constructor(
    public readonly label: string,
    public readonly requestedCommand: string,
    public readonly attempts: string[]
  ) {
    super(buildAgentCliResolutionErrorMessage(label, requestedCommand, attempts));
    this.name = 'AgentCliResolutionError';
  }
}

export function isAgentCliResolutionError(error: unknown): error is AgentCliResolutionError {
  return error instanceof AgentCliResolutionError || (isRecord(error) && error.code === AGENT_CLI_RESOLUTION_ERROR_CODE);
}

export async function resolveAgentCliCommand(
  options: ResolveAgentCliCommandOptions
): Promise<ResolveAgentCliCommandResult> {
  const requestedCommand = options.requestedCommand.trim();
  const attempts: string[] = [];

  if (!requestedCommand) {
    throw new AgentCliResolutionError(options.label, requestedCommand || '<empty>', ['配置值为空']);
  }

  const expandedConfiguredCommand = expandUserHome(requestedCommand, options.env);
  if (path.isAbsolute(expandedConfiguredCommand)) {
    attempts.push(`设置绝对路径: ${expandedConfiguredCommand}`);
    const resolvedAbsoluteCommand = await resolveExplicitCommandCandidate(expandedConfiguredCommand, options.env);
    if (resolvedAbsoluteCommand) {
      return {
        requestedCommand,
        resolvedCommand: resolvedAbsoluteCommand,
        source: 'configured-absolute',
        attempts
      };
    }
  }

  if (isExplicitRelativePath(expandedConfiguredCommand)) {
    const relativeCandidates = buildRelativePathCandidates(expandedConfiguredCommand, options.workspaceCwd, options.env);
    for (const candidate of relativeCandidates) {
      attempts.push(`设置相对路径: ${candidate}`);
      const resolvedRelativeCommand = await resolveExplicitCommandCandidate(candidate, options.env);
      if (resolvedRelativeCommand) {
        return {
          requestedCommand,
          resolvedCommand: resolvedRelativeCommand,
          source: 'configured-relative',
          attempts
        };
      }
    }
  }

  const cachedResolvedCommand = options.cachedResolvedCommand?.trim();
  if (cachedResolvedCommand) {
    attempts.push(`成功缓存: ${cachedResolvedCommand}`);
    if (await isExecutableCandidate(cachedResolvedCommand)) {
      return {
        requestedCommand,
        resolvedCommand: cachedResolvedCommand,
        source: 'cache',
        attempts
      };
    }
  }

  const envResolvedCommand = await resolveCommandFromPathEnv(expandedConfiguredCommand, options.env);
  attempts.push(`PATH 解析: ${expandedConfiguredCommand}`);
  if (envResolvedCommand) {
    return {
      requestedCommand,
      resolvedCommand: envResolvedCommand,
      source: 'path-env',
      attempts
    };
  }

  if (process.platform === 'win32') {
    const whereResolvedCommand = await resolveCommandViaWindowsWhere(expandedConfiguredCommand, options.env);
    attempts.push(`where.exe 探测: ${expandedConfiguredCommand}`);
    if (whereResolvedCommand) {
      return {
        requestedCommand,
        resolvedCommand: whereResolvedCommand,
        source: 'windows-where',
        attempts
      };
    }

    const powerShellResolvedCommand = await resolveCommandViaWindowsPowerShell(expandedConfiguredCommand, options.env);
    attempts.push(`Get-Command 探测: ${expandedConfiguredCommand}`);
    if (powerShellResolvedCommand) {
      return {
        requestedCommand,
        resolvedCommand: powerShellResolvedCommand,
        source: 'windows-powershell',
        attempts
      };
    }
  } else {
    const shellResolvedCommand = await resolveCommandViaPosixLoginShell(expandedConfiguredCommand, options.env);
    attempts.push(`登录 shell 探测: ${expandedConfiguredCommand}`);
    if (shellResolvedCommand) {
      return {
        requestedCommand,
        resolvedCommand: shellResolvedCommand,
        source: 'posix-login-shell',
        attempts
      };
    }
  }

  throw new AgentCliResolutionError(options.label, requestedCommand, attempts);
}

function buildAgentCliResolutionErrorMessage(
  label: string,
  requestedCommand: string,
  attempts: string[]
): string {
  const summary = attempts.length > 0 ? `已尝试：${attempts.join('；')}。` : '';
  const suffix =
    process.platform === 'win32'
      ? '请确认它已安装到当前执行宿主，并通过设置项显式指定 .exe / .cmd 路径，或让登录 shell / PATH 能解析到它。'
      : '请确认它已安装到当前执行宿主，并通过设置项显式指定命令路径，或让登录 shell / PATH 能解析到它。';
  return `没有找到 ${label} 命令 ${requestedCommand}。${summary}${suffix}`;
}

function buildRelativePathCandidates(
  requestedCommand: string,
  workspaceCwd: string | undefined,
  env: NodeJS.ProcessEnv
): string[] {
  const candidates = new Set<string>();
  if (workspaceCwd) {
    candidates.add(path.resolve(workspaceCwd, requestedCommand));
  }
  const processCwd = env.PWD?.trim();
  if (processCwd) {
    candidates.add(path.resolve(processCwd, requestedCommand));
  }
  candidates.add(path.resolve(requestedCommand));
  return Array.from(candidates);
}

function isExplicitRelativePath(command: string): boolean {
  if (!command) {
    return false;
  }

  return (
    command.startsWith(`.${path.sep}`) ||
    command.startsWith(`..${path.sep}`) ||
    command.startsWith('./') ||
    command.startsWith('../') ||
    command.includes('/') ||
    command.includes('\\')
  );
}

function expandUserHome(command: string, env: NodeJS.ProcessEnv): string {
  if (!command.startsWith('~')) {
    return command;
  }

  const homeDir = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!homeDir) {
    return command;
  }

  if (command === '~') {
    return homeDir;
  }

  if (command.startsWith('~/') || command.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, command.slice(2));
  }

  return command;
}

async function resolveCommandFromPathEnv(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  if (!command || path.isAbsolute(command) || isExplicitRelativePath(command)) {
    return undefined;
  }

  const pathValue = env.PATH?.trim();
  if (!pathValue) {
    return undefined;
  }

  const directories = pathValue.split(path.delimiter).filter(Boolean);
  const pathExts =
    process.platform === 'win32'
      ? readWindowsPathExt(env)
      : [''];

  for (const directory of directories) {
    for (const pathExt of pathExts) {
      const candidate = path.join(directory, `${command}${pathExt}`);
      if (await isExecutableCandidate(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function readWindowsPathExt(env: NodeJS.ProcessEnv): string[] {
  const pathExt = env.PATHEXT?.trim();
  const configured =
    pathExt && pathExt.length > 0
      ? pathExt
          .split(';')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : WINDOWS_PATHEXT_FALLBACK;
  const normalized = new Set<string>(configured);
  normalized.add('');
  return Array.from(normalized);
}

async function resolveCommandViaPosixLoginShell(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const shellCandidates = new Set<string>();
  const preferredShell = env.SHELL?.trim();
  if (preferredShell) {
    shellCandidates.add(preferredShell);
  }
  for (const shellPath of POSIX_FALLBACK_SHELLS) {
    shellCandidates.add(shellPath);
  }

  const quotedCommand = quotePosixShellArgument(command);
  for (const shellPath of shellCandidates) {
    try {
      const { stdout } = await execFileAsync(shellPath, ['-lc', `command -v -- ${quotedCommand}`], {
        env,
        encoding: 'utf8',
        timeout: POSIX_SHELL_PROBE_TIMEOUT_MS,
        windowsHide: true
      });
      const resolved = firstNonEmptyLine(stdout);
      if (!resolved) {
        continue;
      }
      const expandedResolved = expandUserHome(resolved, env);
      if (await isExecutableCandidate(expandedResolved)) {
        return expandedResolved;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function resolveCommandViaWindowsWhere(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('where.exe', [command], {
      env,
      encoding: 'utf8',
      timeout: WINDOWS_COMMAND_PROBE_TIMEOUT_MS,
      windowsHide: true
    });
    const resolved = firstNonEmptyLine(stdout);
    if (resolved && (await isExecutableCandidate(resolved))) {
      return resolved;
    }
  } catch {
    // Best effort only.
  }

  return undefined;
}

async function resolveCommandViaWindowsPowerShell(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const shellCandidates = ['pwsh.exe', 'powershell.exe'];
  for (const shellPath of shellCandidates) {
    try {
      const { stdout } = await execFileAsync(
        shellPath,
        ['-NoProfile', '-Command', `(Get-Command -Name ${quotePowerShellArgument(command)}).Source`],
        {
          env,
          encoding: 'utf8',
          timeout: WINDOWS_COMMAND_PROBE_TIMEOUT_MS,
          windowsHide: true
        }
      );
      const resolved = firstNonEmptyLine(stdout);
      if (resolved && (await isExecutableCandidate(resolved))) {
        return resolved;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function isExecutableCandidate(candidatePath: string): Promise<boolean> {
  if (!candidatePath) {
    return false;
  }

  try {
    await fs.access(candidatePath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExplicitCommandCandidate(
  candidatePath: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  for (const executableCandidate of buildExplicitCommandCandidates(candidatePath, env)) {
    if (await isExecutableCandidate(executableCandidate)) {
      return executableCandidate;
    }
  }

  return undefined;
}

function buildExplicitCommandCandidates(candidatePath: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') {
    return [candidatePath];
  }

  const candidates = new Set<string>([candidatePath]);
  if (path.extname(candidatePath)) {
    return Array.from(candidates);
  }

  for (const extension of readWindowsPathExt(env)) {
    if (!extension) {
      continue;
    }
    candidates.add(`${candidatePath}${extension}`);
  }

  return Array.from(candidates);
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function quotePosixShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quotePowerShellArgument(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
