import { constants as fsConstants, type Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { AgentProviderKind } from '../common/protocol';
import { resolveAgentCliCommand } from './agentCliResolver';

export type AgentCliCandidateSource =
  | 'configured'
  | 'default-command'
  | 'path-env'
  | 'login-shell'
  | 'extension-bundled'
  | 'common-location';

export interface AgentCliCandidate {
  provider: AgentProviderKind;
  command: string;
  source: AgentCliCandidateSource;
  resolvedPath?: string;
  extensionRoot?: string;
}

export interface DiscoverAgentCliCandidatesOptions {
  provider: AgentProviderKind;
  configuredCommand: string;
  env: NodeJS.ProcessEnv;
  workspaceCwd?: string;
  extensionRoots?: readonly string[];
  homeDir?: string;
  maxExtensionScanDepth?: number;
}

const DEFAULT_EXTENSION_SCAN_DEPTH = 5;
const SIDEBAR_CONFIG_DESCRIPTION_MAX_LENGTH = 64;

export function getAgentCliDefaultCommand(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'claude' : 'codex';
}

export function getAgentCliDisplayName(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

export function shortenMiddle(value: string, maxLength = SIDEBAR_CONFIG_DESCRIPTION_MAX_LENGTH): string {
  const normalizedValue = value.trim();
  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  if (maxLength <= 5) {
    return normalizedValue.slice(0, maxLength);
  }

  const ellipsis = '...';
  const sideLength = Math.floor((maxLength - ellipsis.length) / 2);
  const rightLength = maxLength - ellipsis.length - sideLength;
  return `${normalizedValue.slice(0, sideLength)}${ellipsis}${normalizedValue.slice(-rightLength)}`;
}

export function buildDefaultAgentCliExtensionSearchRoots(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir()
): string[] {
  const roots = new Set<string>();
  const home = homeDir.trim();
  if (home) {
    for (const relativePath of [
      '.vscode/extensions',
      '.vscode-server/extensions',
      '.cursor/extensions',
      '.cursor-server/extensions',
      '.windsurf/extensions',
      '.windsurf-server/extensions'
    ]) {
      roots.add(path.join(home, relativePath));
    }
  }

  const userProfile = env.USERPROFILE?.trim();
  if (userProfile) {
    roots.add(path.join(userProfile, '.vscode', 'extensions'));
    roots.add(path.join(userProfile, '.cursor', 'extensions'));
    roots.add(path.join(userProfile, '.windsurf', 'extensions'));
  }

  return Array.from(roots);
}

export async function discoverAgentCliCandidates(
  options: DiscoverAgentCliCandidatesOptions
): Promise<AgentCliCandidate[]> {
  const provider = options.provider;
  const defaultCommand = getAgentCliDefaultCommand(provider);
  const configuredCommand = options.configuredCommand.trim() || defaultCommand;
  const candidates: AgentCliCandidate[] = [];

  addAgentCliCandidate(candidates, {
    provider,
    command: configuredCommand,
    source: 'configured',
    resolvedPath: await resolveExplicitAgentCliPath(configuredCommand, options.env)
  });

  if (!agentCliCommandsEqual(configuredCommand, defaultCommand)) {
    addAgentCliCandidate(candidates, {
      provider,
      command: defaultCommand,
      source: 'default-command'
    });
  }

  for (const resolvedPath of await findAgentCliPathEnvironmentCandidates(defaultCommand, options.env)) {
    addAgentCliCandidate(candidates, {
      provider,
      command: resolvedPath,
      source: 'path-env',
      resolvedPath
    });
  }

  const loginShellCandidate = await resolveAgentCliViaResolver({
    provider,
    command: defaultCommand,
    env: options.env,
    workspaceCwd: options.workspaceCwd
  });
  if (loginShellCandidate) {
    addAgentCliCandidate(candidates, loginShellCandidate);
  }

  const extensionRoots = [
    ...(options.extensionRoots ?? []),
    ...buildDefaultAgentCliExtensionSearchRoots(options.env, options.homeDir)
  ];
  for (const candidate of await findExtensionBundledAgentCliCandidates(provider, extensionRoots, {
    maxDepth: options.maxExtensionScanDepth ?? DEFAULT_EXTENSION_SCAN_DEPTH
  })) {
    addAgentCliCandidate(candidates, candidate);
  }

  for (const resolvedPath of await findCommonAgentCliLocationCandidates(defaultCommand, options.env, options.homeDir)) {
    addAgentCliCandidate(candidates, {
      provider,
      command: resolvedPath,
      source: 'common-location',
      resolvedPath
    });
  }

  return candidates;
}

async function resolveAgentCliViaResolver(options: {
  provider: AgentProviderKind;
  command: string;
  env: NodeJS.ProcessEnv;
  workspaceCwd?: string;
}): Promise<AgentCliCandidate | undefined> {
  try {
    const resolution = await resolveAgentCliCommand({
      provider: options.provider,
      label: getAgentCliDisplayName(options.provider),
      requestedCommand: options.command,
      workspaceCwd: options.workspaceCwd,
      env: options.env
    });
    return {
      provider: options.provider,
      command: resolution.resolvedCommand,
      source: resolution.source === 'posix-login-shell' ? 'login-shell' : 'path-env',
      resolvedPath: resolution.resolvedCommand
    };
  } catch {
    return undefined;
  }
}

async function resolveExplicitAgentCliPath(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const expandedCommand = expandUserHome(command, env);
  if (!path.isAbsolute(expandedCommand) && !isExplicitRelativePath(expandedCommand)) {
    return undefined;
  }

  for (const candidate of buildExecutablePathCandidates(expandedCommand, env)) {
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function findAgentCliPathEnvironmentCandidates(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const pathValue = readEnvironmentValueCaseInsensitive(env, 'PATH');
  if (!pathValue) {
    return [];
  }

  const candidates: string[] = [];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const candidate of buildExecutablePathCandidates(path.join(directory, command), env)) {
      if (await isExecutableFile(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  return dedupePaths(candidates);
}

async function findCommonAgentCliLocationCandidates(
  command: string,
  env: NodeJS.ProcessEnv,
  homeDir = os.homedir()
): Promise<string[]> {
  const candidatePaths = new Set<string>();
  const home = homeDir.trim();
  if (home) {
    for (const relativePath of [
      ['.local', 'bin', command],
      ['.volta', 'bin', command],
      ['.npm-global', 'bin', command],
      ['.bun', 'bin', command]
    ]) {
      candidatePaths.add(path.join(home, ...relativePath));
    }

    for (const nvmCandidate of await findNvmAgentCliCandidates(home, command, env)) {
      candidatePaths.add(nvmCandidate);
    }
  }

  if (process.platform === 'win32') {
    const appData = env.APPDATA?.trim();
    if (appData) {
      candidatePaths.add(path.join(appData, 'npm', command));
    }
  } else {
    candidatePaths.add(path.join('/opt/homebrew/bin', command));
    candidatePaths.add(path.join('/usr/local/bin', command));
    candidatePaths.add(path.join('/usr/bin', command));
  }

  const resolvedPaths: string[] = [];
  for (const candidatePath of candidatePaths) {
    for (const candidate of buildExecutablePathCandidates(candidatePath, env)) {
      if (await isExecutableFile(candidate)) {
        resolvedPaths.push(candidate);
      }
    }
  }

  return dedupePaths(resolvedPaths);
}

async function findNvmAgentCliCandidates(
  homeDir: string,
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const versionsDir = path.join(homeDir, '.nvm', 'versions', 'node');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(versionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const commandPath = path.join(versionsDir, entry.name, 'bin', command);
    for (const candidate of buildExecutablePathCandidates(commandPath, env)) {
      if (await isExecutableFile(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

async function findExtensionBundledAgentCliCandidates(
  provider: AgentProviderKind,
  roots: readonly string[],
  options: { maxDepth: number }
): Promise<AgentCliCandidate[]> {
  const candidates: AgentCliCandidate[] = [];
  const uniqueRoots = dedupePaths(await expandAgentCliExtensionRoots(provider, roots));

  for (const root of uniqueRoots) {
    for (const resolvedPath of await findExecutableNamed(root, getAgentCliDefaultCommand(provider), options.maxDepth)) {
      candidates.push({
        provider,
        command: resolvedPath,
        source: 'extension-bundled',
        resolvedPath,
        extensionRoot: root
      });
    }
  }

  return candidates;
}

async function expandAgentCliExtensionRoots(
  provider: AgentProviderKind,
  roots: readonly string[]
): Promise<string[]> {
  const expandedRoots: string[] = [];
  for (const root of roots) {
    if (isLikelyAgentCliExtensionRoot(provider, root)) {
      expandedRoots.push(root);
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const childRoot = path.join(root, entry.name);
      if (isLikelyAgentCliExtensionRoot(provider, childRoot)) {
        expandedRoots.push(childRoot);
      }
    }
  }

  return expandedRoots;
}

async function findExecutableNamed(root: string, command: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth && !shouldSkipExtensionScanDirectory(entry.name)) {
          queue.push({ directory: entryPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile() || !isAgentCliExecutableFileName(entry.name, command)) {
        continue;
      }

      if (await isExecutableFile(entryPath)) {
        found.push(entryPath);
      }
    }
  }

  return dedupePaths(found);
}

function shouldSkipExtensionScanDirectory(name: string): boolean {
  return ['node_modules', 'webview', 'media', 'images', 'resources/walkthrough'].includes(name.toLowerCase());
}

function isLikelyAgentCliExtensionRoot(provider: AgentProviderKind, root: string): boolean {
  const normalizedRoot = root.toLowerCase();
  return provider === 'claude'
    ? normalizedRoot.includes('claude') || normalizedRoot.includes('anthropic')
    : normalizedRoot.includes('codex') || normalizedRoot.includes('chatgpt') || normalizedRoot.includes('openai');
}

function isAgentCliExecutableFileName(fileName: string, command: string): boolean {
  const normalizedFileName = fileName.toLowerCase();
  const normalizedCommand = command.toLowerCase();
  return (
    normalizedFileName === normalizedCommand ||
    normalizedFileName === `${normalizedCommand}.exe` ||
    normalizedFileName === `${normalizedCommand}.cmd` ||
    normalizedFileName === `${normalizedCommand}.bat`
  );
}

function buildExecutablePathCandidates(commandPath: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') {
    return [commandPath];
  }

  if (path.extname(commandPath)) {
    return [commandPath];
  }

  return readWindowsPathExt(env).map((extension) => `${commandPath}${extension}`);
}

function readWindowsPathExt(env: NodeJS.ProcessEnv): string[] {
  const configuredPathExt = readEnvironmentValueCaseInsensitive(env, 'PATHEXT')?.trim();
  const pathExts = configuredPathExt ? configuredPathExt.split(path.delimiter) : ['.COM', '.EXE', '.BAT', '.CMD'];
  return pathExts.map((extension) => extension.trim()).filter(Boolean);
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate);
    if (!stats.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function addAgentCliCandidate(candidates: AgentCliCandidate[], candidate: AgentCliCandidate): void {
  if (!candidate.command.trim()) {
    return;
  }

  const duplicate = candidates.some((existing) => agentCliCommandsEqual(existing.command, candidate.command));
  if (duplicate) {
    return;
  }

  candidates.push(candidate);
}

function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const candidatePath of paths) {
    const normalizedPath = process.platform === 'win32' ? candidatePath.toLowerCase() : candidatePath;
    if (seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);
    deduped.push(candidatePath);
  }
  return deduped;
}

function agentCliCommandsEqual(left: string, right: string): boolean {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
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

function isExplicitRelativePath(command: string): boolean {
  return command.startsWith('./') || command.startsWith('../') || command.includes('/') || command.includes('\\');
}

function readEnvironmentValueCaseInsensitive(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return env[key] ?? Object.entries(env).find(([envKey]) => envKey.toLowerCase() === key.toLowerCase())?.[1];
}
