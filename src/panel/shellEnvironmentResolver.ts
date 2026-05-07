import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const POSIX_SHELL_ENV_TIMEOUT_MS = 10000;
const POSIX_FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh'];
const NON_INTERACTIVE_SHELL_NAMES = new Set(['false', 'git-shell', 'nologin']);
const EXCLUDED_SHELL_ENV_KEYS = new Set([
  'COLORTERM',
  'COLUMNS',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_RUN_AS_NODE',
  'HOME',
  'LINES',
  'OLDPWD',
  'PATH_TRANSLATED',
  'PS1',
  'PS2',
  'PWD',
  'RPROMPT',
  'SHLVL',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'VSCODE_RESOLVING_ENVIRONMENT',
  '_'
]);
const EXCLUDED_SHELL_ENV_PREFIXES = ['BASH_FUNC_', 'ELECTRON_', 'VSCODE_', 'XPC_', '__CF'];

export type ShellEnvironmentPatchSource = 'none' | 'posix-login-shell';
export type ShellEnvironmentPatchSkipReason =
  | 'windows'
  | 'launched-from-cli'
  | 'shell-not-found'
  | 'shell-resolution-failed';

export interface ResolvedShellEnvironmentPatch {
  envPatch: NodeJS.ProcessEnv;
  source: ShellEnvironmentPatchSource;
  shellPath?: string;
  appliedKeys: string[];
  skippedReason?: ShellEnvironmentPatchSkipReason;
  error?: string;
}

export interface ResolveShellEnvironmentPatchOptions {
  env: NodeJS.ProcessEnv;
  processExecPath?: string;
  platform?: NodeJS.Platform;
  shellPath?: string;
  timeoutMs?: number;
}

export async function resolveShellEnvironmentPatch(
  options: ResolveShellEnvironmentPatchOptions
): Promise<ResolvedShellEnvironmentPatch> {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    return emptyShellEnvironmentPatch('windows');
  }

  if (options.env.VSCODE_CLI === '1') {
    return emptyShellEnvironmentPatch('launched-from-cli');
  }

  const shellPath = options.shellPath?.trim() || (await resolvePosixShellPath(options.env));
  if (!shellPath) {
    return emptyShellEnvironmentPatch('shell-not-found');
  }

  try {
    const shellEnv = await resolvePosixShellEnvironment({
      env: options.env,
      processExecPath: options.processExecPath ?? process.execPath,
      shellPath,
      timeoutMs: options.timeoutMs ?? POSIX_SHELL_ENV_TIMEOUT_MS
    });
    const envPatch = buildControlledShellEnvironmentPatch(options.env, shellEnv);
    const appliedKeys = Object.keys(envPatch).sort((left, right) => left.localeCompare(right));
    return {
      envPatch,
      source: 'posix-login-shell',
      shellPath,
      appliedKeys
    };
  } catch (error) {
    return {
      ...emptyShellEnvironmentPatch('shell-resolution-failed'),
      shellPath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function buildControlledShellEnvironmentPatch(
  baseEnv: NodeJS.ProcessEnv,
  shellEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const envPatch: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value !== 'string') {
      continue;
    }

    if (!shouldIncludeShellEnvironmentKey(key, value, baseEnv[key])) {
      continue;
    }

    envPatch[key] = value;
  }

  return envPatch;
}

export function applyShellEnvironmentPatch(
  baseEnv: NodeJS.ProcessEnv,
  envPatch: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...envPatch
  };

  if (typeof envPatch.PATH === 'string' && typeof baseEnv.PATH === 'string') {
    nextEnv.PATH = mergePathEnvironmentValue(baseEnv.PATH, envPatch.PATH, platform);
  }

  return nextEnv;
}

function shouldIncludeShellEnvironmentKey(key: string, value: string, previousValue: string | undefined): boolean {
  if (!key || value === previousValue) {
    return false;
  }

  if (EXCLUDED_SHELL_ENV_KEYS.has(key)) {
    return false;
  }

  for (const prefix of EXCLUDED_SHELL_ENV_PREFIXES) {
    if (key.startsWith(prefix)) {
      return false;
    }
  }

  return true;
}

function mergePathEnvironmentValue(
  basePathValue: string,
  shellPathValue: string,
  platform: NodeJS.Platform
): string {
  const delimiter = platform === 'win32' ? ';' : ':';
  const shellEntries = splitPathEntries(shellPathValue, delimiter);
  const shellSeen = new Set(shellEntries.map((entry) => normalizePathEntry(entry, platform)));
  const preservedEntries = splitPathEntries(basePathValue, delimiter).filter(
    (entry) => !shellSeen.has(normalizePathEntry(entry, platform))
  );
  return [...preservedEntries, ...shellEntries].join(delimiter);
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
    if (!shellPath) {
      continue;
    }
    const shellName = path.basename(shellPath).toLowerCase();
    if (NON_INTERACTIVE_SHELL_NAMES.has(shellName)) {
      continue;
    }
    if (await isExecutableCandidate(shellPath)) {
      return shellPath;
    }
  }

  return undefined;
}

async function resolvePosixShellEnvironment(options: {
  env: NodeJS.ProcessEnv;
  processExecPath: string;
  shellPath: string;
  timeoutMs: number;
}): Promise<NodeJS.ProcessEnv> {
  const mark = randomUUID().replace(/-/g, '').slice(0, 12);
  const extractor = new RegExp(`${mark}([\\s\\S]*?)${mark}`);
  const shellName = path.basename(options.shellPath).toLowerCase();
  const shellCommand = `'${escapePosixSingleQuoted(options.processExecPath)}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
  const shellArgs = shellName === 'tcsh' || shellName === 'csh' ? ['-ic', shellCommand] : ['-i', '-l', '-c', shellCommand];
  const childEnv: NodeJS.ProcessEnv = {
    ...options.env,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    VSCODE_RESOLVING_ENVIRONMENT: '1'
  };

  const child = spawn(options.shellPath, shellArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  return await new Promise<NodeJS.ProcessEnv>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('登录 shell 环境解析超时。'));
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      const match = stdout.match(extractor);
      if (!match?.[1]) {
        reject(
          new Error(
            stderr || `登录 shell 没有返回可解析的环境快照（exit=${code ?? 'unknown'}, signal=${signal ?? 'none'}）。`
          )
        );
        return;
      }

      try {
        const parsed = JSON.parse(match[1]) as NodeJS.ProcessEnv;
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function emptyShellEnvironmentPatch(skipReason: ShellEnvironmentPatchSkipReason): ResolvedShellEnvironmentPatch {
  return {
    envPatch: {},
    source: 'none',
    appliedKeys: [],
    skippedReason: skipReason
  };
}

function escapePosixSingleQuoted(value: string): string {
  return value.replace(/'/g, `'"'"'`);
}

async function isExecutableCandidate(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
