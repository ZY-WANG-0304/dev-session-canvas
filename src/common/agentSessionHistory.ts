import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Stats } from 'fs';
import * as readline from 'readline';
import { StringDecoder } from 'string_decoder';

import type { AgentProviderKind } from './protocol';

const FIRST_LINE_READ_CHUNK_BYTES = 4096;
const FIRST_LINE_MAX_BYTES = 64 * 1024;
const USER_INSTRUCTION_SCAN_MAX_LINES = 160;
const USER_INSTRUCTION_SCAN_MAX_BYTES = 256 * 1024;
const USER_INSTRUCTION_MAX_CHARS = 600;
const SYNTHETIC_USER_PROMPT_PREFIXES = ['# AGENTS.md instructions for ', '<environment_context>', '[SUGGESTION MODE:'];

export interface WorkspaceAgentSessionHistoryEntry {
  provider: AgentProviderKind;
  sessionId: string;
  cwd: string;
  createdAtMs: number;
  updatedAtMs: number;
  sourcePath: string;
  firstUserInstruction?: string;
}

export interface ListWorkspaceAgentSessionHistoryOptions {
  workspaceRoot: string;
  env?: NodeJS.ProcessEnv;
  maxEntries?: number;
}

interface CodexSessionMeta {
  sessionId: string;
  cwd: string;
  timestampMs: number;
}

function resolveHomeDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function readFirstLine(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, 'r');
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.allocUnsafe(FIRST_LINE_READ_CHUNK_BYTES);
    let bytesReadTotal = 0;
    let remainder = '';

    while (bytesReadTotal < FIRST_LINE_MAX_BYTES) {
      const bytesToRead = Math.min(buffer.length, FIRST_LINE_MAX_BYTES - bytesReadTotal);
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, null);
      if (bytesRead <= 0) {
        break;
      }

      bytesReadTotal += bytesRead;
      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      if (!chunk) {
        continue;
      }

      const merged = `${remainder}${chunk}`;
      const newlineIndex = merged.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = merged.slice(0, newlineIndex).trim();
        return line.length > 0 ? line : null;
      }

      remainder = merged;
    }

    if (bytesReadTotal >= FIRST_LINE_MAX_BYTES) {
      return null;
    }

    const finalLine = `${remainder}${decoder.end()}`.trim();
    return finalLine.length > 0 ? finalLine : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function parseCodexSessionMeta(firstLine: string): CodexSessionMeta | null {
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: unknown;
      timestamp?: unknown;
      payload?: {
        id?: unknown;
        cwd?: unknown;
        timestamp?: unknown;
      };
    };

    if (parsed.type !== 'session_meta') {
      return null;
    }

    const sessionId = typeof parsed.payload?.id === 'string' ? parsed.payload.id.trim() : '';
    const cwd = typeof parsed.payload?.cwd === 'string' ? path.resolve(parsed.payload.cwd) : '';
    const timestampMs = parseTimestampMs(parsed.payload?.timestamp) ?? parseTimestampMs(parsed.timestamp);

    if (!sessionId || !cwd || timestampMs === null) {
      return null;
    }

    return {
      sessionId,
      cwd,
      timestampMs
    };
  } catch {
    return null;
  }
}

function parseClaudeSessionCwd(firstLine: string | null): string | null {
  if (!firstLine) {
    return null;
  }

  try {
    const parsed = JSON.parse(firstLine) as {
      cwd?: unknown;
    };
    return typeof parsed.cwd === 'string' && parsed.cwd.trim().length > 0 ? path.resolve(parsed.cwd) : null;
  } catch {
    return null;
  }
}

function extractMessageContentText(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textParts: string[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        textParts.push(trimmed);
      }
      continue;
    }

    if (!item || typeof item !== 'object') {
      continue;
    }

    const text = 'text' in item && typeof item.text === 'string' ? item.text.trim() : '';
    if (text.length > 0) {
      textParts.push(text);
    }
  }

  if (textParts.length === 0) {
    return null;
  }

  return textParts.join('\n');
}

function extractCodexUserInstructionCandidate(record: unknown): string | null {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const parsed = record as {
    type?: unknown;
    payload?: {
      role?: unknown;
      content?: unknown;
    };
  };
  if (parsed.type !== 'response_item' || parsed.payload?.role !== 'user') {
    return null;
  }

  return extractMessageContentText(parsed.payload.content);
}

function extractClaudeUserInstructionCandidate(record: unknown): string | null {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const parsed = record as {
    message?: {
      role?: unknown;
      content?: unknown;
    };
  };
  if (parsed.message?.role !== 'user') {
    return null;
  }

  return extractMessageContentText(parsed.message.content);
}

function normalizeUserInstruction(text: string): string | null {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length <= USER_INSTRUCTION_MAX_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, USER_INSTRUCTION_MAX_CHARS - 1).trimEnd()}…`;
}

function looksLikeSyntheticUserInstruction(text: string): boolean {
  const firstLine = text.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine.length === 0) {
    return true;
  }

  return SYNTHETIC_USER_PROMPT_PREFIXES.some((prefix) => firstLine.startsWith(prefix));
}

async function readFirstUserInstruction(
  filePath: string,
  provider: AgentProviderKind
): Promise<string | undefined> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let scannedLines = 0;
  let scannedBytes = 0;

  try {
    for await (const rawLine of lines) {
      scannedLines += 1;
      scannedBytes += Buffer.byteLength(rawLine, 'utf8') + 1;
      if (scannedLines > USER_INSTRUCTION_SCAN_MAX_LINES || scannedBytes > USER_INSTRUCTION_SCAN_MAX_BYTES) {
        break;
      }

      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const candidate =
        provider === 'codex'
          ? extractCodexUserInstructionCandidate(parsed)
          : extractClaudeUserInstructionCandidate(parsed);
      const normalized = candidate ? normalizeUserInstruction(candidate) : null;
      if (!normalized || looksLikeSyntheticUserInstruction(normalized)) {
        continue;
      }

      return normalized;
    }
  } catch {
    return undefined;
  } finally {
    lines.close();
    stream.destroy();
  }

  return undefined;
}

function isPathInsideWorkspace(candidatePath: string, workspaceRoot: string): boolean {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  const relativePath = path.relative(resolvedWorkspaceRoot, resolvedCandidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resolveCreatedAtMs(stat: Stats): number {
  if (Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0) {
    return Math.round(stat.birthtimeMs);
  }

  return Math.round(stat.mtimeMs);
}

function mergeSessionEntry(
  entries: Map<string, WorkspaceAgentSessionHistoryEntry>,
  nextEntry: WorkspaceAgentSessionHistoryEntry
): void {
  const key = `${nextEntry.provider}:${nextEntry.sessionId}`;
  const existingEntry = entries.get(key);
  if (!existingEntry) {
    entries.set(key, nextEntry);
    return;
  }

  const updatedAtMs = Math.max(existingEntry.updatedAtMs, nextEntry.updatedAtMs);
  entries.set(key, {
    provider: nextEntry.provider,
    sessionId: nextEntry.sessionId,
    cwd: nextEntry.cwd,
    createdAtMs: Math.min(existingEntry.createdAtMs, nextEntry.createdAtMs),
    updatedAtMs,
    sourcePath: updatedAtMs === nextEntry.updatedAtMs ? nextEntry.sourcePath : existingEntry.sourcePath,
    firstUserInstruction: existingEntry.firstUserInstruction || nextEntry.firstUserInstruction
  });
}

async function collectCodexSessionHistory(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  entries: Map<string, WorkspaceAgentSessionHistoryEntry>
): Promise<void> {
  const codexSessionsDir = path.join(resolveHomeDirectory(env), '.codex', 'sessions');
  const yearDirectories = await listDirectories(codexSessionsDir);

  for (const yearDirectory of yearDirectories) {
    // eslint-disable-next-line no-await-in-loop
    const monthDirectories = await listDirectories(yearDirectory);
    for (const monthDirectory of monthDirectories) {
      // eslint-disable-next-line no-await-in-loop
      const dayDirectories = await listDirectories(monthDirectory);
      for (const dayDirectory of dayDirectories) {
        // eslint-disable-next-line no-await-in-loop
        const rolloutFiles = (await listFiles(dayDirectory)).filter((filePath) =>
          path.basename(filePath).startsWith('rollout-')
        );

        for (const filePath of rolloutFiles) {
          // eslint-disable-next-line no-await-in-loop
          const firstLine = await readFirstLine(filePath);
          const meta = firstLine ? parseCodexSessionMeta(firstLine) : null;
          if (!meta || !isPathInsideWorkspace(meta.cwd, workspaceRoot)) {
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const stat = await fs.stat(filePath).catch(() => null);
          if (!stat) {
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const firstUserInstruction = await readFirstUserInstruction(filePath, 'codex');

          mergeSessionEntry(entries, {
            provider: 'codex',
            sessionId: meta.sessionId,
            cwd: meta.cwd,
            createdAtMs: meta.timestampMs,
            updatedAtMs: Math.round(stat.mtimeMs),
            sourcePath: filePath,
            firstUserInstruction
          });
        }
      }
    }
  }
}

function toClaudeProjectDirectoryName(cwd: string): string {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]+/g, '-');
}

async function collectClaudeSessionHistory(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  entries: Map<string, WorkspaceAgentSessionHistoryEntry>
): Promise<void> {
  const claudeProjectsDir = path.join(resolveHomeDirectory(env), '.claude', 'projects');
  const workspaceDirectoryName = toClaudeProjectDirectoryName(workspaceRoot);
  const projectDirectories = await listDirectories(claudeProjectsDir);

  for (const projectDirectory of projectDirectories) {
    // eslint-disable-next-line no-await-in-loop
    const sessionFiles = (await listFiles(projectDirectory)).filter((filePath) => filePath.endsWith('.jsonl'));
    for (const filePath of sessionFiles) {
      const sessionId = path.basename(filePath, '.jsonl').trim();
      if (!sessionId) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const firstLine = await readFirstLine(filePath);
      const parsedCwd = parseClaudeSessionCwd(firstLine);
      const fallbackCwd = path.basename(projectDirectory) === workspaceDirectoryName ? path.resolve(workspaceRoot) : null;
      const cwd = parsedCwd ?? fallbackCwd;
      if (!cwd || !isPathInsideWorkspace(cwd, workspaceRoot)) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const firstUserInstruction = await readFirstUserInstruction(filePath, 'claude');

      mergeSessionEntry(entries, {
        provider: 'claude',
        sessionId,
        cwd,
        createdAtMs: resolveCreatedAtMs(stat),
        updatedAtMs: Math.round(stat.mtimeMs),
        sourcePath: filePath,
        firstUserInstruction
      });
    }
  }
}

export async function listWorkspaceAgentSessionHistory(
  options: ListWorkspaceAgentSessionHistoryOptions
): Promise<WorkspaceAgentSessionHistoryEntry[]> {
  const env = options.env ?? process.env;
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const dedupedEntries = new Map<string, WorkspaceAgentSessionHistoryEntry>();

  await collectCodexSessionHistory(workspaceRoot, env, dedupedEntries);
  await collectClaudeSessionHistory(workspaceRoot, env, dedupedEntries);

  const sortedEntries = Array.from(dedupedEntries.values()).sort((left, right) => {
    if (left.updatedAtMs !== right.updatedAtMs) {
      return right.updatedAtMs - left.updatedAtMs;
    }
    return left.provider.localeCompare(right.provider) || left.sessionId.localeCompare(right.sessionId);
  });

  const maxEntries = options.maxEntries && options.maxEntries > 0 ? Math.floor(options.maxEntries) : undefined;
  return maxEntries ? sortedEntries.slice(0, maxEntries) : sortedEntries;
}
