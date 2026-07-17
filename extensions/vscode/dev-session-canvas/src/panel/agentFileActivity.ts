import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentProviderKind, CanvasFileActivityAccessMode } from '../common/protocol';

const AGENT_FILE_EVENT_STREAM_ENV_KEY = 'DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH';
const FAKE_AGENT_PROVIDER_FILE_EVENTS_ENV_KEY = 'DEV_SESSION_CANVAS_FAKE_AGENT_FILE_EVENT_STREAM_PATH';
const AGENT_LIFECYCLE_HOOK_RELATIVE_PATH = path.join(
  'scripts',
  'runtime',
  'agent-lifecycle-hook.cjs'
);
const FILE_ACTIVITY_DRAIN_MAX_WAIT_MS = 1000;
const FILE_ACTIVITY_DRAIN_POLL_INTERVAL_MS = 50;
const FILE_ACTIVITY_DRAIN_SETTLE_WINDOW_MS = 200;

export interface AgentFileActivityEvent {
  path: string;
  accessMode: CanvasFileActivityAccessMode;
  timestamp: string;
}

export interface AgentFileActivitySession {
  configureLaunch(args: string[], env: NodeJS.ProcessEnv, cwd: string): string[];
  isProviderLifecycleEnabled(): boolean;
  getProviderLifecycleFallbackReason(): string | undefined;
  start(onEvent: (event: AgentFileActivityEvent) => void): void;
  dispose(): Promise<void>;
}

interface AgentFileActivitySessionParams {
  provider: AgentProviderKind;
  command: string;
  extensionRootPath: string;
  storageRootPath: string;
  fileActivityEnabled: boolean;
}

interface ParsedAgentFileActivityEvent {
  path: string;
  accessMode: CanvasFileActivityAccessMode;
  timestamp: string;
}

export function createAgentFileActivitySession(
  params: AgentFileActivitySessionParams
): AgentFileActivitySession {
  if (looksLikeFakeAgentProviderCommand(params.command)) {
    return createNdjsonFileActivitySession({
      mode: 'fake-provider',
      storageRootPath: params.storageRootPath,
      fileActivityEnabled: params.fileActivityEnabled
    });
  }

  if (params.provider === 'claude') {
    return createNdjsonFileActivitySession({
      mode: 'claude',
      storageRootPath: params.storageRootPath,
      extensionRootPath: params.extensionRootPath,
      fileActivityEnabled: params.fileActivityEnabled
    });
  }

  return createCodexRuntimeIntegrationSession(params);
}

export function looksLikeFakeAgentProviderCommand(command: string): boolean {
  const basename = path.basename(command).toLowerCase();
  return basename.includes('fake-agent-provider') || basename.includes('fake-codex-provider') || basename.includes('fake-claude-provider');
}

function createNdjsonFileActivitySession(params: {
  mode: 'claude' | 'fake-provider';
  storageRootPath: string;
  extensionRootPath?: string;
  fileActivityEnabled: boolean;
}): AgentFileActivitySession {
  const sessionRootPath = path.join(params.storageRootPath, randomUUID());
  fs.mkdirSync(sessionRootPath, { recursive: true });
  const eventStreamPath = path.join(sessionRootPath, 'events.ndjson');
  fs.writeFileSync(eventStreamPath, '', 'utf8');

  const disposer = params.fileActivityEnabled
    ? new NdjsonFileActivityWatcher(eventStreamPath)
    : undefined;
  let lifecycleEnabled = false;
  let lifecycleFallbackReason: string | undefined;

  return {
    configureLaunch(args, env, cwd) {
      if (params.mode === 'fake-provider') {
        if (params.fileActivityEnabled) {
          env[FAKE_AGENT_PROVIDER_FILE_EVENTS_ENV_KEY] = eventStreamPath;
        }
        lifecycleEnabled = false;
        lifecycleFallbackReason = 'fake-provider';
        return [...args];
      }

      const extensionRootPath = params.extensionRootPath;
      if (!extensionRootPath) {
        lifecycleEnabled = false;
        lifecycleFallbackReason = 'missing-extension-root';
        return [...args];
      }

      const mergedSettings = prepareClaudeGeneratedSettings({
        args,
        cwd,
        extensionRootPath,
        sessionRootPath,
        includeFileActivityHook: params.fileActivityEnabled
      });
      lifecycleEnabled = mergedSettings.lifecycleEnabled;
      lifecycleFallbackReason = mergedSettings.fallbackReason;
      if (params.fileActivityEnabled && mergedSettings.lifecycleEnabled) {
        env[AGENT_FILE_EVENT_STREAM_ENV_KEY] = eventStreamPath;
      }
      return mergedSettings.args;
    },
    isProviderLifecycleEnabled: () => lifecycleEnabled,
    getProviderLifecycleFallbackReason: () => lifecycleFallbackReason,
    start(onEvent) {
      disposer?.start(onEvent);
    },
    async dispose() {
      await disposer?.dispose();
      try {
        fs.rmSync(sessionRootPath, { recursive: true, force: true });
      } catch {
        // Best effort cleanup only.
      }
    }
  };
}

function createCodexRuntimeIntegrationSession(
  params: AgentFileActivitySessionParams
): AgentFileActivitySession {
  let lifecycleEnabled = false;
  let lifecycleFallbackReason: string | undefined;

  return {
    configureLaunch(args, env) {
      const conflictReason = findCodexNotifyConflict(args, env);
      if (conflictReason) {
        lifecycleEnabled = false;
        lifecycleFallbackReason = conflictReason;
        return [...args];
      }

      const hookScriptPath = path.join(
        params.extensionRootPath,
        AGENT_LIFECYCLE_HOOK_RELATIVE_PATH
      );
      if (!isRegularFile(hookScriptPath)) {
        lifecycleEnabled = false;
        lifecycleFallbackReason = 'agent-lifecycle-hook-missing';
        return [...args];
      }
      const notifyCommand = JSON.stringify([process.execPath, hookScriptPath, 'codex']);
      lifecycleEnabled = true;
      lifecycleFallbackReason = undefined;
      return ['-c', `notify=${notifyCommand}`, ...args];
    },
    isProviderLifecycleEnabled: () => lifecycleEnabled,
    getProviderLifecycleFallbackReason: () => lifecycleFallbackReason,
    start: () => {},
    dispose: async () => {}
  };
}

function prepareClaudeGeneratedSettings(params: {
  args: string[];
  cwd: string;
  extensionRootPath: string;
  sessionRootPath: string;
  includeFileActivityHook: boolean;
}): { args: string[]; lifecycleEnabled: boolean; fallbackReason?: string } {
  const extracted = extractClaudeAdditionalSettings(params.args);
  if (!extracted.ok) {
    return {
      args: [...params.args],
      lifecycleEnabled: false,
      fallbackReason: extracted.reason
    };
  }

  const baseSettings = extracted.value
    ? readClaudeAdditionalSettings(extracted.value, params.cwd)
    : {};
  if (!baseSettings || (baseSettings.hooks !== undefined && !isRecord(baseSettings.hooks))) {
    return {
      args: [...params.args],
      lifecycleEnabled: false,
      fallbackReason: 'claude-additional-settings-unreadable'
    };
  }
  const baseHooks = baseSettings.hooks as Record<string, unknown> | undefined;
  const generatedHookNames = [
    'UserPromptSubmit',
    'Stop',
    'StopFailure',
    ...(params.includeFileActivityHook ? ['PostToolUse'] : [])
  ];
  if (generatedHookNames.some((name) => baseHooks?.[name] !== undefined && !Array.isArray(baseHooks[name]))) {
    return {
      args: [...params.args],
      lifecycleEnabled: false,
      fallbackReason: 'claude-additional-settings-hooks-invalid'
    };
  }

  const lifecycleHookScriptPath = path.join(
    params.extensionRootPath,
    AGENT_LIFECYCLE_HOOK_RELATIVE_PATH
  );
  if (!isRegularFile(lifecycleHookScriptPath)) {
    return {
      args: [...params.args],
      lifecycleEnabled: false,
      fallbackReason: 'agent-lifecycle-hook-missing'
    };
  }
  const lifecycleHookCommand = (eventName: string): string =>
    `${shellQuote(process.execPath)} ${shellQuote(lifecycleHookScriptPath)} claude ${eventName}`;
  const hooks = { ...baseHooks };
  hooks.UserPromptSubmit = appendClaudeCommandHook(
    hooks.UserPromptSubmit,
    lifecycleHookCommand('UserPromptSubmit')
  );
  hooks.Stop = appendClaudeCommandHook(hooks.Stop, lifecycleHookCommand('Stop'));
  hooks.StopFailure = appendClaudeCommandHook(
    hooks.StopFailure,
    lifecycleHookCommand('StopFailure')
  );

  if (params.includeFileActivityHook) {
    const fileHookScriptPath = path.join(
      params.extensionRootPath,
      'scripts',
      'runtime',
      'claude-file-event-hook.cjs'
    );
    hooks.PostToolUse = appendClaudeCommandHook(
      hooks.PostToolUse,
      `${shellQuote(process.execPath)} ${shellQuote(fileHookScriptPath)}`,
      'Read|Edit|MultiEdit|Write'
    );
  }

  const settingsPath = path.join(params.sessionRootPath, 'claude-runtime-settings.json');
  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify({ ...baseSettings, hooks }, null, 2)}\n`,
    'utf8'
  );
  return {
    args: [...extracted.argsWithoutSettings, '--settings', settingsPath],
    lifecycleEnabled: true
  };
}

function isRegularFile(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function appendClaudeCommandHook(
  existing: unknown,
  command: string,
  matcher?: string
): unknown[] {
  const existingHooks = Array.isArray(existing) ? [...existing] : [];
  return [
    ...existingHooks,
    {
      ...(matcher ? { matcher } : {}),
      hooks: [
        {
          type: 'command',
          command
        }
      ]
    }
  ];
}

function extractClaudeAdditionalSettings(args: readonly string[]):
  | { ok: true; argsWithoutSettings: string[]; value?: string }
  | { ok: false; reason: string } {
  const argsWithoutSettings: string[] = [];
  let value: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--settings') {
      const next = args[index + 1];
      if (!next) {
        return { ok: false, reason: 'claude-settings-value-missing' };
      }
      value = next;
      index += 1;
      continue;
    }
    if (token.startsWith('--settings=')) {
      const inlineValue = token.slice('--settings='.length);
      if (!inlineValue) {
        return { ok: false, reason: 'claude-settings-value-missing' };
      }
      value = inlineValue;
      continue;
    }
    argsWithoutSettings.push(token);
  }

  return { ok: true, argsWithoutSettings, value };
}

function readClaudeAdditionalSettings(value: string, cwd: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = trimmed.startsWith('{')
      ? JSON.parse(trimmed)
      : JSON.parse(fs.readFileSync(path.resolve(cwd, trimmed), 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function findCodexNotifyConflict(args: readonly string[], env: NodeJS.ProcessEnv): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-c' || token === '--config') {
      if (isCodexNotifyOverride(args[index + 1])) {
        return 'codex-cli-notify-conflict';
      }
      index += 1;
      continue;
    }
    if (
      (token.startsWith('-c') && isCodexNotifyOverride(token.slice(2))) ||
      (token.startsWith('--config=') && isCodexNotifyOverride(token.slice('--config='.length)))
    ) {
      return 'codex-cli-notify-conflict';
    }
  }

  const codexHome = resolveCodexHome(env);
  if (!codexHome) {
    return 'codex-home-unavailable';
  }
  const candidatePaths = [path.join(codexHome, 'config.toml')];
  const profile = extractCodexProfile(args);
  if (profile) {
    if (!isSafeCodexProfileName(profile)) {
      return 'codex-profile-unreadable';
    }
    candidatePaths.push(path.join(codexHome, `${profile}.config.toml`));
  }

  for (const candidatePath of candidatePaths) {
    try {
      const content = fs.readFileSync(candidatePath, 'utf8');
      if (/^\s*notify\s*=/mu.test(content)) {
        return 'codex-user-notify-conflict';
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return 'codex-config-unreadable';
      }
    }
  }

  return undefined;
}

function isCodexNotifyOverride(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const separatorIndex = value.indexOf('=');
  return separatorIndex >= 0 && value.slice(0, separatorIndex).trim() === 'notify';
}

function extractCodexProfile(args: readonly string[]): string | undefined {
  let profile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-p' || token === '--profile') {
      profile = args[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--profile=')) {
      profile = token.slice('--profile='.length);
    }
  }
  return profile?.trim() || undefined;
}

function isSafeCodexProfileName(value: string): boolean {
  return value.length <= 128 && !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..';
}

function resolveCodexHome(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.CODEX_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  const resolvedHome = home || os.homedir();
  return resolvedHome ? path.join(path.resolve(resolvedHome), '.codex') : undefined;
}

class NdjsonFileActivityWatcher {
  private offset = 0;
  private remainder = '';
  private watcher: fs.FSWatcher | undefined;
  private pollingTimer: NodeJS.Timeout | undefined;
  private onEvent: ((event: AgentFileActivityEvent) => void) | undefined;
  private disposePromise: Promise<void> | undefined;
  private closed = false;

  public constructor(private readonly eventStreamPath: string) {}

  public start(onEvent: (event: AgentFileActivityEvent) => void): void {
    this.onEvent = onEvent;
    this.flush();

    try {
      this.watcher = fs.watch(this.eventStreamPath, () => {
        this.flush();
      });
    } catch {
      // Fall back to polling below if native watch is unavailable.
    }

    this.pollingTimer = setInterval(() => {
      this.flush();
    }, 250);
  }

  public dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposePromise = this.disposeInternal();
    }

    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    await this.drainPendingEvents();
    this.closed = true;
  }

  private async drainPendingEvents(): Promise<void> {
    let lastObservedSize = this.getEventStreamSize();
    let stableSince = Date.now();
    const deadline = Date.now() + FILE_ACTIVITY_DRAIN_MAX_WAIT_MS;

    this.flush();

    while (Date.now() < deadline) {
      await delay(FILE_ACTIVITY_DRAIN_POLL_INTERVAL_MS);

      const currentSize = this.getEventStreamSize();
      if (currentSize === undefined) {
        break;
      }

      if (currentSize !== lastObservedSize) {
        lastObservedSize = currentSize;
        stableSince = Date.now();
      }

      this.flush();

      if (Date.now() - stableSince >= FILE_ACTIVITY_DRAIN_SETTLE_WINDOW_MS) {
        break;
      }
    }

    this.flush();
  }

  private flush(): void {
    if (this.closed || !this.onEvent || !fs.existsSync(this.eventStreamPath)) {
      return;
    }

    let content: string;
    try {
      content = fs.readFileSync(this.eventStreamPath, 'utf8');
    } catch {
      return;
    }

    if (this.offset > content.length) {
      this.offset = 0;
      this.remainder = '';
    }

    const chunk = content.slice(this.offset);
    if (!chunk) {
      return;
    }

    this.offset = content.length;
    const combined = `${this.remainder}${chunk}`;
    const lines = combined.split(/\r?\n/);
    this.remainder = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = parseAgentFileActivityEvent(line);
      if (!parsed) {
        continue;
      }

      this.onEvent(parsed);
    }
  }

  private getEventStreamSize(): number | undefined {
    try {
      return fs.statSync(this.eventStreamPath).size;
    } catch {
      return undefined;
    }
  }
}

function parseAgentFileActivityEvent(line: string): ParsedAgentFileActivityEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.path !== 'string' ||
    (parsed.accessMode !== 'read' && parsed.accessMode !== 'write' && parsed.accessMode !== 'read-write')
  ) {
    return null;
  }

  return {
    path: parsed.path,
    accessMode: parsed.accessMode,
    timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString()
  };
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    return quoteWindowsCommandArgument(value);
  }
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function quoteWindowsCommandArgument(value: string): string {
  let result = '"';
  let backslashCount = 0;
  for (const character of value) {
    if (character === '\\') {
      backslashCount += 1;
      continue;
    }
    if (character === '"') {
      result += `${'\\'.repeat(backslashCount * 2 + 1)}"`;
      backslashCount = 0;
      continue;
    }
    result += `${'\\'.repeat(backslashCount)}${character}`;
    backslashCount = 0;
  }
  return `${result}${'\\'.repeat(backslashCount * 2)}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
