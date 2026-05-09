import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type AgentSettingsFileKind = 'codex-config' | 'codex-auth' | 'claude-settings';

export interface AgentSettingsFileDescriptor {
  label: string;
  initialContent: string;
}

export interface ResolveAgentSettingsFilePathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
}

export const RESTRICTED_AGENT_SETTINGS_DIRECTORY_MODE = 0o700;
export const RESTRICTED_AGENT_SETTINGS_FILE_MODE = 0o600;

const CODEX_CONFIG_INITIAL_CONTENT = [
  '# Codex proxy/gateway configuration.',
  '# Fill base_url with your OpenAI-compatible proxy or gateway endpoint before using Codex.',
  '# Keep secrets in auth.json under the same Codex config directory.',
  '# Docs: https://developers.openai.com/codex/config-basic',
  '',
  'model_provider = "openai_compatible"',
  '# model = "gpt-5.5"',
  '# approval_policy = "on-request"',
  '# sandbox_mode = "workspace-write"',
  '',
  '[model_providers.openai_compatible]',
  'name = "OpenAI-compatible gateway"',
  'base_url = ""',
  'wire_api = "responses"',
  '# Uncomment env_key only if you prefer environment-variable auth over auth.json.',
  '# env_key = "OPENAI_API_KEY"',
  '',
  '[tui]',
  'notifications = true',
  'notification_method = "osc9"',
  'notification_condition = "always"',
  '',
  '# If you use official OpenAI login instead, switch to:',
  '# model_provider = "openai"',
  '# openai_base_url = "https://api.openai.com/v1"',
  ''
].join('\n');

const CODEX_AUTH_INITIAL_CONTENT = [
  '{',
  '  "_comment": "Replace OPENAI_API_KEY before using API-key auth. Keep this plaintext file private.",',
  '  "_auth_mode_hint": "Run `codex login` instead if you prefer browser login-managed credentials.",',
  '  "auth_mode": "apikey",',
  '  "OPENAI_API_KEY": ""',
  '}',
  ''
].join('\n');

const CLAUDE_SETTINGS_INITIAL_CONTENT = [
  '{',
  '  "$schema": "https://json.schemastore.org/claude-code-settings.json",',
  '  "_comment": "Fill ANTHROPIC_API_KEY for API-key auth. Fill ANTHROPIC_BASE_URL only when routing through a proxy or gateway.",',
  '  "preferredNotifChannel": "iterm2",',
  '  "env": {',
  '    "ANTHROPIC_API_KEY": null,',
  '    "ANTHROPIC_BASE_URL": ""',
  '  },',
  '  "permissions": {',
  '    "allow": [],',
  '    "deny": []',
  '  }',
  '}',
  ''
].join('\n');

export function getAgentSettingsFileDescriptor(kind: AgentSettingsFileKind): AgentSettingsFileDescriptor {
  switch (kind) {
    case 'codex-config':
      return {
        label: 'Codex config.toml',
        initialContent: CODEX_CONFIG_INITIAL_CONTENT
      };
    case 'codex-auth':
      return {
        label: 'Codex auth.json',
        initialContent: CODEX_AUTH_INITIAL_CONTENT
      };
    case 'claude-settings':
      return {
        label: 'Claude Code settings.json',
        initialContent: CLAUDE_SETTINGS_INITIAL_CONTENT
      };
  }
}

export function resolveAgentSettingsFilePath(
  kind: AgentSettingsFileKind,
  options: ResolveAgentSettingsFilePathOptions = {}
): string | undefined {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathApi = getPlatformPath(platform);
  const homeDir = resolveCurrentHostHomeDirectory(env, platform);

  if (!homeDir) {
    return undefined;
  }

  if (kind === 'codex-config' || kind === 'codex-auth') {
    const codexHome = resolveCodexHomeDirectory({
      env,
      homeDir,
      platform,
      cwd: options.cwd
    });
    return pathApi.join(codexHome, kind === 'codex-config' ? 'config.toml' : 'auth.json');
  }

  return pathApi.join(homeDir, '.claude', 'settings.json');
}

export function resolveCurrentHostHomeDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const preferredKeys = platform === 'win32' ? ['USERPROFILE', 'HOME'] : ['HOME', 'USERPROFILE'];
  for (const key of preferredKeys) {
    const value = readEnvironmentValue(env, key, platform);
    if (value) {
      return value;
    }
  }
  return os.homedir();
}

export async function getLocalAgentSettingsFileStatus(filePath: string): Promise<'file' | 'directory' | 'missing'> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory() ? 'directory' : 'file';
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return 'missing';
    }
    throw error;
  }
}

export async function createRestrictedLocalAgentSettingsFile(filePath: string, content: string): Promise<void> {
  const parentDir = path.dirname(filePath);

  await fs.mkdir(parentDir, { recursive: true, mode: RESTRICTED_AGENT_SETTINGS_DIRECTORY_MODE });
  await chmodIfPosix(parentDir, RESTRICTED_AGENT_SETTINGS_DIRECTORY_MODE);
  await fs.writeFile(filePath, Buffer.from(content, 'utf8'), {
    mode: RESTRICTED_AGENT_SETTINGS_FILE_MODE,
    flag: 'wx'
  });
  await chmodIfPosix(filePath, RESTRICTED_AGENT_SETTINGS_FILE_MODE);
}

export function isNodeFileAlreadyExistsError(error: unknown): boolean {
  return isNodeErrorWithCode(error, 'EEXIST');
}

function resolveCodexHomeDirectory(options: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
  cwd?: string;
}): string {
  const pathApi = getPlatformPath(options.platform);
  const configuredCodexHome = readEnvironmentValue(options.env, 'CODEX_HOME', options.platform);
  if (!configuredCodexHome) {
    return pathApi.join(options.homeDir, '.codex');
  }
  return resolveConfigDirectoryPath(configuredCodexHome, {
    homeDir: options.homeDir,
    cwd: options.cwd,
    platform: options.platform
  });
}

function resolveConfigDirectoryPath(
  configPath: string,
  options: {
    homeDir: string;
    cwd?: string;
    platform: NodeJS.Platform;
  }
): string {
  const pathApi = getPlatformPath(options.platform);
  if (configPath === '~') {
    return options.homeDir;
  }
  if (configPath.startsWith('~/') || configPath.startsWith('~\\')) {
    return pathApi.join(options.homeDir, configPath.slice(2));
  }
  if (pathApi.isAbsolute(configPath)) {
    return configPath;
  }
  return pathApi.resolve(options.cwd ?? process.cwd(), configPath);
}

function readEnvironmentValue(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform
): string | undefined {
  const exactValue = env[key]?.trim();
  if (exactValue) {
    return exactValue;
  }
  if (platform !== 'win32') {
    return undefined;
  }
  const normalizedKey = key.toLowerCase();
  const matchingKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === normalizedKey);
  return matchingKey ? env[matchingKey]?.trim() || undefined : undefined;
}

function getPlatformPath(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

async function chmodIfPosix(filePath: string, mode: number): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }

  try {
    await fs.chmod(filePath, mode);
  } catch {
    // Best effort only: some remote or mounted file systems may not support chmod.
  }
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return isNodeErrorWithCode(error, 'ENOENT');
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
