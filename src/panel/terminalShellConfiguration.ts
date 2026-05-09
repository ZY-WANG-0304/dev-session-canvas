import { accessSync, constants as fsConstants, readFileSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const NON_INTERACTIVE_TERMINAL_SHELL_NAMES = new Set(['false', 'git-shell', 'nologin']);
const WINDOWS_PATHEXT_FALLBACK = ['.com', '.exe', '.bat', '.cmd'];
const DETECTABLE_TERMINAL_SHELL_COMMANDS = [
  'bash',
  'zsh',
  'fish',
  'sh',
  'pwsh',
  'powershell',
  'cmd'
] as const;
const WINDOWS_WELL_KNOWN_SHELL_PATHS = [
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  'C:\\Windows\\System32\\cmd.exe'
] as const;
const TERMINAL_SHELL_DISPLAY_ORDER = ['bash', 'zsh', 'fish', 'sh', 'pwsh', 'powershell', 'cmd'] as const;

export const CONFIGURED_TERMINAL_SHELLS = ['default', ...DETECTABLE_TERMINAL_SHELL_COMMANDS] as const;

export type ConfiguredTerminalShell = (typeof CONFIGURED_TERMINAL_SHELLS)[number];

export type TerminalShellResolutionSource = 'path' | 'named-shell' | 'default-shell';

export interface ResolvedConfiguredTerminalShell {
  configuredPath: string;
  resolvedPath: string;
  resolutionSource: TerminalShellResolutionSource;
  configuredShell: ConfiguredTerminalShell;
}

export interface InspectedConfiguredTerminalShell extends ResolvedConfiguredTerminalShell {
  resolvedAvailablePath: string | undefined;
  isAvailable: boolean;
}

export interface ResolveConfiguredTerminalShellOptions {
  configuredShell?: unknown;
  configuredPath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  defaultShellPath?: string;
  cwd?: string;
}

export type DetectedTerminalShellSource =
  | 'default-shell'
  | 'etc-shells'
  | 'path-env'
  | 'windows-known-path';

export interface DetectedTerminalShell {
  shellName: string;
  label: string;
  detail: string;
  resolvedPath: string;
  source: DetectedTerminalShellSource;
  isDefault: boolean;
}

export interface DetectAvailableTerminalShellsOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  defaultShellPath?: string;
  etcShellsContent?: string;
}

export interface PersistedTerminalShellSelection {
  configuredShell: ConfiguredTerminalShell;
  configuredPath: string;
}

export type TerminalShellConfigurationScope = 'default' | 'global' | 'workspace';

export interface EffectiveTerminalShellConfiguration {
  configuredShell: ConfiguredTerminalShell;
  configuredPath: string;
  configurationScope: TerminalShellConfigurationScope;
}

export interface ResolveEffectiveTerminalShellConfigurationOptions {
  defaultConfiguredShell?: unknown;
  globalConfiguredShell?: unknown;
  workspaceConfiguredShell?: unknown;
  defaultConfiguredPath?: unknown;
  globalConfiguredPath?: unknown;
  workspaceConfiguredPath?: unknown;
  hasWorkspace?: boolean;
}

export interface TerminalShellSelectionCandidate {
  shellName?: string;
  resolvedPath?: string;
  useDefault?: boolean;
}

export function normalizeConfiguredTerminalShell(value: unknown): ConfiguredTerminalShell {
  switch (value) {
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'sh':
    case 'pwsh':
    case 'powershell':
    case 'cmd':
      return value;
    default:
      return 'default';
  }
}

export function normalizeConfiguredTerminalShellArgs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function buildPersistedTerminalShellSelection(
  selection: TerminalShellSelectionCandidate
): PersistedTerminalShellSelection | undefined {
  if (selection.useDefault) {
    return {
      configuredShell: 'default',
      configuredPath: ''
    };
  }

  const configuredPath = selection.resolvedPath?.trim() ?? '';
  if (!configuredPath) {
    return undefined;
  }

  return {
    // Preserve the logical shell type for display/manual fallback, but always
    // persist the exact path the user chose so duplicate shell names stay stable.
    configuredShell: normalizeConfiguredTerminalShell(selection.shellName),
    configuredPath
  };
}

export function resolveEffectiveTerminalShellConfiguration(
  options: ResolveEffectiveTerminalShellConfigurationOptions = {}
): EffectiveTerminalShellConfiguration {
  const defaultConfiguredShell = normalizeConfiguredTerminalShell(options.defaultConfiguredShell);
  const defaultConfiguredPath = normalizeConfiguredTerminalShellPath(options.defaultConfiguredPath);
  const hasWorkspace = options.hasWorkspace !== false;
  const hasWorkspaceOverride =
    hasWorkspace &&
    (typeof options.workspaceConfiguredShell !== 'undefined' ||
      typeof options.workspaceConfiguredPath !== 'undefined');

  if (hasWorkspaceOverride) {
    return {
      configuredShell:
        typeof options.workspaceConfiguredShell === 'undefined'
          ? defaultConfiguredShell
          : normalizeConfiguredTerminalShell(options.workspaceConfiguredShell),
      configuredPath:
        typeof options.workspaceConfiguredPath === 'undefined'
          ? defaultConfiguredPath
          : normalizeConfiguredTerminalShellPath(options.workspaceConfiguredPath),
      configurationScope: 'workspace'
    };
  }

  const hasGlobalOverride =
    typeof options.globalConfiguredShell !== 'undefined' ||
    typeof options.globalConfiguredPath !== 'undefined';
  if (hasGlobalOverride) {
    return {
      configuredShell:
        typeof options.globalConfiguredShell === 'undefined'
          ? defaultConfiguredShell
          : normalizeConfiguredTerminalShell(options.globalConfiguredShell),
      configuredPath:
        typeof options.globalConfiguredPath === 'undefined'
          ? defaultConfiguredPath
          : normalizeConfiguredTerminalShellPath(options.globalConfiguredPath),
      configurationScope: 'global'
    };
  }

  return {
    configuredShell: defaultConfiguredShell,
    configuredPath: defaultConfiguredPath,
    configurationScope: 'default'
  };
}

export function resolveDefaultTerminalShellPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  defaultShellPath?: string
): string {
  const normalizedDefaultShellPath = defaultShellPath?.trim();
  if (normalizedDefaultShellPath) {
    return normalizedDefaultShellPath;
  }

  if (platform === 'win32') {
    return env.ComSpec?.trim() || env.COMSPEC?.trim() || 'powershell.exe';
  }

  return env.SHELL?.trim() || '/bin/bash';
}

export function resolveNamedTerminalShellPath(
  shell: Exclude<ConfiguredTerminalShell, 'default'>,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== 'win32') {
    return shell;
  }

  switch (shell) {
    case 'pwsh':
      return 'pwsh.exe';
    case 'powershell':
      return 'powershell.exe';
    case 'cmd':
      return 'cmd.exe';
    default:
      return shell;
  }
}

function normalizeConfiguredTerminalShellPath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveConfiguredTerminalShell(
  options: ResolveConfiguredTerminalShellOptions = {}
): ResolvedConfiguredTerminalShell {
  const configuredPath = options.configuredPath?.trim() ?? '';
  const configuredShell = normalizeConfiguredTerminalShell(options.configuredShell);
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (configuredPath) {
    return {
      configuredPath,
      resolvedPath: configuredPath,
      resolutionSource: 'path',
      configuredShell
    };
  }

  if (configuredShell !== 'default') {
    return {
      configuredPath,
      resolvedPath: resolveConfiguredNamedTerminalShellPath(configuredShell, { platform, env }),
      resolutionSource: 'named-shell',
      configuredShell
    };
  }

  return {
    configuredPath,
    resolvedPath: resolveDefaultTerminalShellPath(platform, env, options.defaultShellPath),
    resolutionSource: 'default-shell',
    configuredShell
  };
}

export function inspectConfiguredTerminalShell(
  options: ResolveConfiguredTerminalShellOptions = {}
): InspectedConfiguredTerminalShell {
  const resolvedShell = resolveConfiguredTerminalShell(options);
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const resolvedAvailablePath = resolveTerminalShellCandidateSync(
    resolvedShell.resolvedPath,
    env,
    platform,
    options.cwd
  );
  return {
    ...resolvedShell,
    resolvedAvailablePath,
    isAvailable: Boolean(resolvedAvailablePath)
  };
}

export function resolveConfiguredNamedTerminalShellPath(
  shell: Exclude<ConfiguredTerminalShell, 'default'>,
  options: Pick<ResolveConfiguredTerminalShellOptions, 'platform' | 'env'> = {}
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const fallbackPath = resolveNamedTerminalShellPath(shell, platform);
  const resolvedFromPath = resolveCommandFromPathEnvSync(fallbackPath, env, platform);
  if (resolvedFromPath) {
    return resolvedFromPath;
  }

  if (platform === 'win32') {
    const matchingKnownPath = WINDOWS_WELL_KNOWN_SHELL_PATHS.find((candidatePath) => {
      return getShellNameFromPath(candidatePath, platform) === shell && isExecutableCandidateSync(candidatePath, platform);
    });
    return matchingKnownPath ?? fallbackPath;
  }

  const matchingEtcShell = readEtcShellCandidatesSync().find((candidatePath) => {
    return getShellNameFromPath(candidatePath, platform) === shell && isExecutableCandidateSync(candidatePath, platform);
  });
  return matchingEtcShell ?? fallbackPath;
}

export async function detectAvailableTerminalShells(
  options: DetectAvailableTerminalShellsOptions = {}
): Promise<DetectedTerminalShell[]> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const defaultShellPath = resolveDefaultTerminalShellPath(platform, env, options.defaultShellPath);
  const detectedShells = new Map<string, DetectedTerminalShell>();

  const addShellCandidate = async (
    candidatePath: string | undefined,
    source: DetectedTerminalShellSource,
    isDefault: boolean
  ): Promise<void> => {
    const normalizedCandidatePath = candidatePath?.trim();
    if (!normalizedCandidatePath) {
      return;
    }

    const resolvedCandidatePath = await normalizeResolvedShellCandidate(
      normalizedCandidatePath,
      env,
      platform
    );
    if (!resolvedCandidatePath) {
      return;
    }

    const key = normalizeDetectedShellKey(resolvedCandidatePath, platform);
    const existing = detectedShells.get(key);
    const nextShell = createDetectedTerminalShell(resolvedCandidatePath, source, isDefault, platform);
    if (!existing) {
      detectedShells.set(key, nextShell);
      return;
    }

    detectedShells.set(key, {
      ...existing,
      isDefault: existing.isDefault || isDefault,
      source: existing.source === 'default-shell' ? existing.source : nextShell.source
    });
  };

  await addShellCandidate(defaultShellPath, 'default-shell', true);

  if (platform === 'win32') {
    for (const candidatePath of WINDOWS_WELL_KNOWN_SHELL_PATHS) {
      await addShellCandidate(candidatePath, 'windows-known-path', false);
    }
  } else {
    for (const candidatePath of await readEtcShellCandidates(options.etcShellsContent)) {
      await addShellCandidate(candidatePath, 'etc-shells', false);
    }
  }

  for (const command of DETECTABLE_TERMINAL_SHELL_COMMANDS) {
    await addShellCandidate(await resolveCommandFromPathEnv(command, env, platform), 'path-env', false);
  }

  return Array.from(detectedShells.values()).sort(compareDetectedTerminalShells);
}

async function readEtcShellCandidates(etcShellsContent: string | undefined): Promise<string[]> {
  const content =
    typeof etcShellsContent === 'string'
      ? etcShellsContent
      : await fs
          .readFile('/etc/shells', 'utf8')
          .catch(() => '');

  return parseEtcShellCandidates(content);
}

function readEtcShellCandidatesSync(): string[] {
  try {
    return parseEtcShellCandidates(readFileSync('/etc/shells', 'utf8'));
  } catch {
    return [];
  }
}

function parseEtcShellCandidates(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter((line) => !NON_INTERACTIVE_TERMINAL_SHELL_NAMES.has(path.basename(line).toLowerCase()));
}

function createDetectedTerminalShell(
  resolvedPath: string,
  source: DetectedTerminalShellSource,
  isDefault: boolean,
  platform: NodeJS.Platform
): DetectedTerminalShell {
  const shellName = getShellNameFromPath(resolvedPath, platform);
  return {
    shellName,
    label: formatTerminalShellLabel(shellName),
    detail: resolvedPath,
    resolvedPath,
    source,
    isDefault
  };
}

function normalizeDetectedShellKey(shellPath: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? shellPath.toLowerCase() : shellPath;
}

function compareDetectedTerminalShells(left: DetectedTerminalShell, right: DetectedTerminalShell): number {
  if (left.isDefault !== right.isDefault) {
    return left.isDefault ? -1 : 1;
  }

  const leftOrder = TERMINAL_SHELL_DISPLAY_ORDER.indexOf(left.shellName as (typeof TERMINAL_SHELL_DISPLAY_ORDER)[number]);
  const rightOrder = TERMINAL_SHELL_DISPLAY_ORDER.indexOf(
    right.shellName as (typeof TERMINAL_SHELL_DISPLAY_ORDER)[number]
  );
  if (leftOrder !== rightOrder) {
    if (leftOrder === -1) {
      return 1;
    }
    if (rightOrder === -1) {
      return -1;
    }
    return leftOrder - rightOrder;
  }

  return left.detail.localeCompare(right.detail);
}

function formatTerminalShellLabel(shellName: string): string {
  switch (shellName) {
    case 'bash':
      return 'Bash';
    case 'zsh':
      return 'Zsh';
    case 'fish':
      return 'Fish';
    case 'sh':
      return 'sh';
    case 'pwsh':
      return 'PowerShell 7';
    case 'powershell':
      return 'Windows PowerShell';
    case 'cmd':
      return 'Command Prompt';
    default:
      return shellName;
  }
}

function getShellNameFromPath(shellPath: string, platform: NodeJS.Platform): string {
  const extension = platform === 'win32' ? path.extname(shellPath) : '';
  return path.basename(shellPath, extension).toLowerCase();
}

async function resolveCommandFromPathEnv(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  if (!command || path.isAbsolute(command) || isExplicitRelativePath(command)) {
    return undefined;
  }

  const pathValue = readPathEnv(env, platform);
  if (!pathValue) {
    return undefined;
  }

  const directories = pathValue.split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean);
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

function resolveCommandFromPathEnvSync(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string | undefined {
  if (!command || path.isAbsolute(command) || isExplicitRelativePath(command)) {
    return undefined;
  }

  const pathValue = readPathEnv(env, platform);
  if (!pathValue) {
    return undefined;
  }

  const directories = pathValue.split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean);
  const commandCandidates = buildPathCommandCandidates(command, env, platform);

  for (const directory of directories) {
    for (const commandCandidate of commandCandidates) {
      const candidatePath = path.join(directory, commandCandidate);
      if (isExecutableCandidateSync(candidatePath, platform)) {
        return candidatePath;
      }
    }
  }

  return undefined;
}

function readPathEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform !== 'win32') {
    return env.PATH?.trim() ?? '';
  }

  return env.PATH?.trim() || env.Path?.trim() || '';
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

function isExecutableCandidateSync(candidatePath: string, platform: NodeJS.Platform): boolean {
  if (!candidatePath) {
    return false;
  }

  try {
    accessSync(candidatePath, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function normalizeResolvedShellCandidate(
  candidatePath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  if (!path.isAbsolute(candidatePath) && !isExplicitRelativePath(candidatePath)) {
    const resolvedPathEnvCandidate = await resolveCommandFromPathEnv(candidatePath, env, platform);
    if (resolvedPathEnvCandidate) {
      return resolvedPathEnvCandidate;
    }
  }

  for (const executableCandidate of buildPreferredResolvedShellCandidates(candidatePath, env, platform)) {
    if (await isExecutableCandidate(executableCandidate, platform)) {
      return executableCandidate;
    }
  }

  return undefined;
}

function resolveTerminalShellCandidateSync(
  candidatePath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  cwd?: string
): string | undefined {
  if (!path.isAbsolute(candidatePath) && !isExplicitRelativePath(candidatePath)) {
    const resolvedPathEnvCandidate = resolveCommandFromPathEnvSync(candidatePath, env, platform);
    if (resolvedPathEnvCandidate) {
      return resolvedPathEnvCandidate;
    }
  }

  const resolvedCandidatePath = resolveShellCandidateAgainstWorkingDirectory(candidatePath, cwd);
  for (const executableCandidate of buildPreferredResolvedShellCandidates(resolvedCandidatePath, env, platform)) {
    if (isExecutableCandidateSync(executableCandidate, platform)) {
      return executableCandidate;
    }
  }

  return undefined;
}

function resolveShellCandidateAgainstWorkingDirectory(candidatePath: string, cwd?: string): string {
  if (!isExplicitRelativePath(candidatePath)) {
    return candidatePath;
  }

  const normalizedCwd = cwd?.trim();
  if (!normalizedCwd) {
    return candidatePath;
  }

  return path.resolve(normalizedCwd, candidatePath);
}

function buildPreferredResolvedShellCandidates(
  candidatePath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  if (platform !== 'win32') {
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

function buildPathCommandCandidates(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  return platform === 'win32' && path.extname(command)
    ? [command]
    : platform === 'win32'
      ? buildPreferredResolvedShellCandidates(command, env, platform)
      : [command];
}
