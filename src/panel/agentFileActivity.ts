import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { AgentProviderKind, CanvasFileActivityAccessMode } from '../common/protocol';

const AGENT_FILE_EVENT_STREAM_ENV_KEY = 'DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH';
const FAKE_AGENT_PROVIDER_FILE_EVENTS_ENV_KEY = 'DEV_SESSION_CANVAS_FAKE_AGENT_FILE_EVENT_STREAM_PATH';

export interface AgentFileActivityEvent {
  path: string;
  accessMode: CanvasFileActivityAccessMode;
  timestamp: string;
}

export interface AgentFileActivitySession {
  extraArgs: string[];
  extraEnv: NodeJS.ProcessEnv;
  start(onEvent: (event: AgentFileActivityEvent) => void): void;
  dispose(): void;
}

interface AgentFileActivitySessionParams {
  provider: AgentProviderKind;
  command: string;
  extensionRootPath: string;
  storageRootPath: string;
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
      storageRootPath: params.storageRootPath
    });
  }

  if (params.provider === 'claude') {
    return createNdjsonFileActivitySession({
      mode: 'claude',
      storageRootPath: params.storageRootPath,
      extensionRootPath: params.extensionRootPath
    });
  }

  return {
    extraArgs: [],
    extraEnv: {},
    start: () => {},
    dispose: () => {}
  };
}

function looksLikeFakeAgentProviderCommand(command: string): boolean {
  const basename = path.basename(command).toLowerCase();
  return basename.includes('fake-agent-provider') || basename.includes('fake-codex-provider') || basename.includes('fake-claude-provider');
}

function createNdjsonFileActivitySession(params: {
  mode: 'claude' | 'fake-provider';
  storageRootPath: string;
  extensionRootPath?: string;
}): AgentFileActivitySession {
  const sessionRootPath = path.join(params.storageRootPath, randomUUID());
  fs.mkdirSync(sessionRootPath, { recursive: true });
  const eventStreamPath = path.join(sessionRootPath, 'events.ndjson');
  fs.writeFileSync(eventStreamPath, '', 'utf8');

  const disposer = new NdjsonFileActivityWatcher(eventStreamPath);
  const extraArgs: string[] = [];
  const extraEnv: NodeJS.ProcessEnv = {};

  if (params.mode === 'fake-provider') {
    extraEnv[FAKE_AGENT_PROVIDER_FILE_EVENTS_ENV_KEY] = eventStreamPath;
  }

  if (params.mode === 'claude') {
    const extensionRootPath = params.extensionRootPath;
    if (!extensionRootPath) {
      throw new Error('Claude 文件活动会话缺少 extension root。');
    }

    const hookScriptPath = path.join(extensionRootPath, 'scripts', 'claude-file-event-hook.cjs');
    const settingsPath = path.join(sessionRootPath, 'claude-file-activity-settings.json');
    const hookCommand = `${shellQuote(process.execPath)} ${shellQuote(hookScriptPath)}`;
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Read|Edit|MultiEdit|Write',
            hooks: [
              {
                type: 'command',
                command: hookCommand
              }
            ]
          }
        ]
      }
    };

    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    extraArgs.push('--settings', settingsPath);
    extraEnv[AGENT_FILE_EVENT_STREAM_ENV_KEY] = eventStreamPath;
  }

  return {
    extraArgs,
    extraEnv,
    start(onEvent) {
      disposer.start(onEvent);
    },
    dispose() {
      disposer.dispose();
      try {
        fs.rmSync(sessionRootPath, { recursive: true, force: true });
      } catch {
        // Best effort cleanup only.
      }
    }
  };
}

class NdjsonFileActivityWatcher {
  private offset = 0;
  private remainder = '';
  private watcher: fs.FSWatcher | undefined;
  private pollingTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  public constructor(private readonly eventStreamPath: string) {}

  public start(onEvent: (event: AgentFileActivityEvent) => void): void {
    this.flush(onEvent);

    try {
      this.watcher = fs.watch(this.eventStreamPath, () => {
        this.flush(onEvent);
      });
    } catch {
      // Fall back to polling below if native watch is unavailable.
    }

    this.pollingTimer = setInterval(() => {
      this.flush(onEvent);
    }, 250);
  }

  public dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    this.watcher = undefined;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  private flush(onEvent: (event: AgentFileActivityEvent) => void): void {
    if (this.disposed || !fs.existsSync(this.eventStreamPath)) {
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

      onEvent(parsed);
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
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
