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

export type AgentCliResolutionAttemptId =
  | 'raw'
  | 'empty-configured-value'
  | 'configured-absolute'
  | 'configured-relative'
  | 'cache'
  | 'path-env'
  | 'windows-where'
  | 'windows-powershell'
  | 'posix-login-shell';

export interface AgentCliResolutionAttemptDescriptor {
  id: AgentCliResolutionAttemptId;
  value?: string;
}

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
  attemptDescriptors: AgentCliResolutionAttemptDescriptor[];
}

export class AgentCliResolutionError extends Error {
  public readonly code = AGENT_CLI_RESOLUTION_ERROR_CODE;
  public readonly attemptDescriptors: AgentCliResolutionAttemptDescriptor[];

  public constructor(
    public readonly label: string,
    public readonly requestedCommand: string,
    public readonly attempts: string[],
    attemptDescriptors?: readonly AgentCliResolutionAttemptDescriptor[]
  ) {
    super(buildAgentCliResolutionErrorMessage(label, requestedCommand, attempts));
    this.name = 'AgentCliResolutionError';
    this.attemptDescriptors = attemptDescriptors
      ? [...attemptDescriptors]
      : attempts.map((attempt) => ({ id: 'raw', value: attempt }));
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
  const attemptDescriptors: AgentCliResolutionAttemptDescriptor[] = [];
  const pushAttempt = (descriptor: AgentCliResolutionAttemptDescriptor): void => {
    attemptDescriptors.push(descriptor);
    attempts.push(formatAgentCliResolutionAttemptDescriptor(descriptor));
  };

  if (!requestedCommand) {
    const descriptor: AgentCliResolutionAttemptDescriptor = { id: 'empty-configured-value' };
    throw new AgentCliResolutionError(
      options.label,
      requestedCommand || '<empty>',
      [formatAgentCliResolutionAttemptDescriptor(descriptor)],
      [descriptor]
    );
  }

  const expandedConfiguredCommand = expandUserHome(requestedCommand, options.env);
  if (path.isAbsolute(expandedConfiguredCommand)) {
    pushAttempt({ id: 'configured-absolute', value: expandedConfiguredCommand });
    const resolvedAbsoluteCommand = await resolveExplicitCommandCandidate(expandedConfiguredCommand, options.env);
    if (resolvedAbsoluteCommand) {
      return {
        requestedCommand,
        resolvedCommand: resolvedAbsoluteCommand,
        source: 'configured-absolute',
        attempts,
        attemptDescriptors
      };
    }
  }

  if (isExplicitRelativePath(expandedConfiguredCommand)) {
    const relativeCandidates = buildRelativePathCandidates(expandedConfiguredCommand, options.workspaceCwd, options.env);
    for (const candidate of relativeCandidates) {
      pushAttempt({ id: 'configured-relative', value: candidate });
      const resolvedRelativeCommand = await resolveExplicitCommandCandidate(candidate, options.env);
      if (resolvedRelativeCommand) {
        return {
          requestedCommand,
          resolvedCommand: resolvedRelativeCommand,
          source: 'configured-relative',
          attempts,
          attemptDescriptors
        };
      }
    }
  }

  const cachedResolvedCommand = options.cachedResolvedCommand?.trim();
  if (cachedResolvedCommand) {
    pushAttempt({ id: 'cache', value: cachedResolvedCommand });
    const normalizedCachedResolvedCommand = await normalizeResolvedCommandCandidate(
      cachedResolvedCommand,
      options.env
    );
    if (normalizedCachedResolvedCommand) {
      return {
        requestedCommand,
        resolvedCommand: normalizedCachedResolvedCommand,
        source: 'cache',
        attempts,
        attemptDescriptors
      };
    }
  }

  const envResolvedCommand = await resolveCommandFromPathEnv(expandedConfiguredCommand, options.env);
  pushAttempt({ id: 'path-env', value: expandedConfiguredCommand });
  if (envResolvedCommand) {
    return {
      requestedCommand,
      resolvedCommand: envResolvedCommand,
      source: 'path-env',
      attempts,
      attemptDescriptors
    };
  }

  if (process.platform === 'win32') {
    const whereResolvedCommand = await resolveCommandViaWindowsWhere(expandedConfiguredCommand, options.env);
    pushAttempt({ id: 'windows-where', value: expandedConfiguredCommand });
    if (whereResolvedCommand) {
      return {
        requestedCommand,
        resolvedCommand: whereResolvedCommand,
        source: 'windows-where',
        attempts,
        attemptDescriptors
      };
    }

    const powerShellResolvedCommand = await resolveCommandViaWindowsPowerShell(expandedConfiguredCommand, options.env);
    pushAttempt({ id: 'windows-powershell', value: expandedConfiguredCommand });
    if (powerShellResolvedCommand) {
      return {
        requestedCommand,
        resolvedCommand: powerShellResolvedCommand,
        source: 'windows-powershell',
        attempts,
        attemptDescriptors
      };
    }
  } else {
    const shellResolvedCommand = await resolveCommandViaPosixLoginShell(expandedConfiguredCommand, options.env);
    pushAttempt({ id: 'posix-login-shell', value: expandedConfiguredCommand });
    if (shellResolvedCommand) {
      return {
        requestedCommand,
        resolvedCommand: shellResolvedCommand,
        source: 'posix-login-shell',
        attempts,
        attemptDescriptors
      };
    }
  }

  throw new AgentCliResolutionError(options.label, requestedCommand, attempts, attemptDescriptors);
}

export function formatAgentCliResolutionAttemptDescriptor(
  descriptor: AgentCliResolutionAttemptDescriptor
): string {
  const value = descriptor.value ?? '';
  switch (descriptor.id) {
    case 'empty-configured-value':
      return 'Empty configured value';
    case 'configured-absolute':
      return `Configured absolute path: ${value}`;
    case 'configured-relative':
      return `Configured relative path: ${value}`;
    case 'cache':
      return `Cached resolution: ${value}`;
    case 'path-env':
      return `PATH lookup: ${value}`;
    case 'windows-where':
      return `where.exe probe: ${value}`;
    case 'windows-powershell':
      return `Get-Command probe: ${value}`;
    case 'posix-login-shell':
      return `Login shell probe: ${value}`;
    case 'raw':
    default:
      return value;
  }
}

function buildAgentCliResolutionErrorMessage(
  label: string,
  requestedCommand: string,
  attempts: string[]
): string {
  const summary = attempts.length > 0 ? `Tried: ${attempts.join('; ')}. ` : '';
  const suffix =
    process.platform === 'win32'
      ? 'Make sure it is installed in the current execution host, configure the .exe / .cmd path explicitly in settings, or make it available to the login shell / PATH.'
      : 'Make sure it is installed in the current execution host, configure the command path explicitly in settings, or make it available to the login shell / PATH.';
  return `Could not find ${label} command ${requestedCommand}. ${summary}${suffix}`;
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

export function isExplicitRelativePath(command: string): boolean {
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

  const pathValue = readPathEnvironmentValue(env);
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
  const pathExt = readEnvironmentValueCaseInsensitive(env, 'PATHEXT')?.trim();
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

function readPathEnvironmentValue(env: NodeJS.ProcessEnv): string | undefined {
  return readEnvironmentValueCaseInsensitive(env, 'PATH')?.trim();
}

function readEnvironmentValueCaseInsensitive(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (typeof env[key] === 'string') {
    return env[key] as string;
  }

  if (process.platform !== 'win32') {
    return undefined;
  }

  const normalizedKey = key.toLowerCase();
  const matchedKey = Object.keys(env).find((candidateKey) => candidateKey.toLowerCase() === normalizedKey);
  const value = matchedKey ? env[matchedKey] : undefined;
  return typeof value === 'string' ? value : undefined;
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
    if (resolved) {
      const normalizedResolved = await normalizeResolvedCommandCandidate(resolved, env);
      if (normalizedResolved) {
        return normalizedResolved;
      }
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
      if (resolved) {
        const normalizedResolved = await normalizeResolvedCommandCandidate(resolved, env);
        if (normalizedResolved) {
          return normalizedResolved;
        }
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

async function normalizeResolvedCommandCandidate(
  candidatePath: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  for (const executableCandidate of buildPreferredResolvedCommandCandidates(candidatePath, env)) {
    if (await isExecutableCandidate(executableCandidate)) {
      return executableCandidate;
    }
  }

  return undefined;
}

async function resolveExplicitCommandCandidate(
  candidatePath: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  return normalizeResolvedCommandCandidate(candidatePath, env);
}

function buildPreferredResolvedCommandCandidates(candidatePath: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') {
    return [candidatePath];
  }

  const candidates = new Set<string>();
  if (path.extname(candidatePath)) {
    candidates.add(candidatePath);
    return Array.from(candidates);
  }

  for (const extension of readWindowsPathExt(env)) {
    if (!extension) {
      continue;
    }
    candidates.add(`${candidatePath}${extension}`);
  }

  candidates.add(candidatePath);

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
