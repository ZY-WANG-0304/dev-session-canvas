export const CONFIGURED_TERMINAL_SHELLS = [
  'default',
  'bash',
  'zsh',
  'fish',
  'sh',
  'pwsh',
  'powershell',
  'cmd'
] as const;

export type ConfiguredTerminalShell = (typeof CONFIGURED_TERMINAL_SHELLS)[number];

export type TerminalShellResolutionSource = 'path' | 'named-shell' | 'default-shell';

export interface ResolvedConfiguredTerminalShell {
  configuredShell: ConfiguredTerminalShell;
  configuredPath: string;
  resolvedPath: string;
  resolutionSource: TerminalShellResolutionSource;
}

export interface ResolveConfiguredTerminalShellOptions {
  configuredShell?: unknown;
  configuredPath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
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

export function resolveDefaultTerminalShellPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
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

export function resolveConfiguredTerminalShell(
  options: ResolveConfiguredTerminalShellOptions = {}
): ResolvedConfiguredTerminalShell {
  const configuredPath = options.configuredPath?.trim() ?? '';
  const configuredShell = normalizeConfiguredTerminalShell(options.configuredShell);
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (configuredPath) {
    return {
      configuredShell,
      configuredPath,
      resolvedPath: configuredPath,
      resolutionSource: 'path'
    };
  }

  if (configuredShell !== 'default') {
    return {
      configuredShell,
      configuredPath,
      resolvedPath: resolveNamedTerminalShellPath(configuredShell, platform),
      resolutionSource: 'named-shell'
    };
  }

  return {
    configuredShell,
    configuredPath,
    resolvedPath: resolveDefaultTerminalShellPath(platform, env),
    resolutionSource: 'default-shell'
  };
}
