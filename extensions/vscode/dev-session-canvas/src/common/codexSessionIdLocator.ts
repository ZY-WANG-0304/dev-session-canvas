import { StringDecoder } from 'string_decoder';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Codex currently does not expose a standard machine-readable interface for retrieving the
// fresh-start session id. The host therefore combines two signals:
// 1) startup-time scanning of Codex-owned session files as an early heuristic;
// 2) stop-time parsing of the CLI's own `codex resume <session-id>` hint as a later supplement/check.
// Claude can instead confirm a known candidate session id by checking for its transcript file under
// the provider's project state directory, and still uses the stop-time `claude --resume ...` hint as
// a later correction/check. Callers must still treat a miss or ambiguity as "cannot auto-resume"
// rather than silently guessing.

const POLL_INTERVAL_MS = 200;
const DEFAULT_TIMEOUT_MS = 2600;
const FIRST_LINE_READ_CHUNK_BYTES = 4096;
const FIRST_LINE_MAX_BYTES = 64 * 1024;
const CODEX_CANDIDATE_WINDOW_MS = 20_000;
const CODEX_RESUME_HINT_PATTERN = /\bcodex\s+resume\s+([0-9a-f][0-9a-f-]{31,})\b/gi;
const CLAUDE_RESUME_HINT_PATTERN = /\bclaude\s+--resume\s+([0-9a-z][0-9a-z-]{15,})\b/gi;

interface CodexSessionMeta {
  sessionId: string;
  cwd: string;
  payloadTimestampMs: number | null;
  recordTimestampMs: number | null;
}

function extractResumeSessionIdFromOutput(output: string, pattern: RegExp): string | null {
  const normalizedOutput = output.replace(/\r/g, '\n');
  let matchedSessionId: string | null = null;

  pattern.lastIndex = 0;
  for (const match of normalizedOutput.matchAll(pattern)) {
    const sessionId = match[1]?.trim();
    if (sessionId) {
      matchedSessionId = sessionId;
    }
  }

  return matchedSessionId;
}

export function extractCodexResumeSessionId(output: string): string | null {
  return extractResumeSessionIdFromOutput(output, CODEX_RESUME_HINT_PATTERN);
}

export function extractClaudeResumeSessionId(output: string): string | null {
  return extractResumeSessionIdFromOutput(output, CLAUDE_RESUME_HINT_PATTERN);
}

export interface LocateCodexSessionIdOptions {
  cwd: string;
  startedAtMs: number;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
}

export interface LocateClaudeSessionIdOptions {
  cwd: string;
  sessionId: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function resolveHomeDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
}

function toDateDirectoryParts(timestampMs: number): [string, string, string] {
  const date = new Date(timestampMs);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return [year, month, day];
}

async function wait(durationMs: number): Promise<void> {
  await new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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
    const sessionCwd = typeof parsed.payload?.cwd === 'string' ? path.resolve(parsed.payload.cwd) : null;
    const payloadTimestampMs = parseTimestampMs(parsed.payload?.timestamp);
    const recordTimestampMs = parseTimestampMs(parsed.timestamp);

    if (
      sessionId.length === 0 ||
      !sessionCwd ||
      (payloadTimestampMs === null && recordTimestampMs === null)
    ) {
      return null;
    }

    return {
      sessionId,
      cwd: sessionCwd,
      payloadTimestampMs,
      recordTimestampMs
    };
  } catch {
    return null;
  }
}

function resolveCodexSessionTimestampMs(meta: CodexSessionMeta, startedAtMs: number): number {
  const candidates = [meta.payloadTimestampMs, meta.recordTimestampMs].filter(
    (value): value is number => typeof value === 'number'
  );

  if (candidates.length === 0) {
    return startedAtMs;
  }

  return candidates.sort(
    (left, right) => Math.abs(left - startedAtMs) - Math.abs(right - startedAtMs)
  )[0];
}

function toClaudeProjectDirectoryName(cwd: string): string {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]+/g, '-');
}

async function findCodexSessionIdOnce(
  cwd: string,
  startedAtMs: number,
  env: NodeJS.ProcessEnv,
  nowMs: number
): Promise<string | null> {
  const codexSessionsDir = path.join(resolveHomeDirectory(env), '.codex', 'sessions');
  const resolvedCwd = path.resolve(cwd);
  const dateCandidates = new Set<string>();

  for (const timestamp of [
    startedAtMs,
    startedAtMs - 24 * 60 * 60 * 1000,
    nowMs,
    nowMs - 24 * 60 * 60 * 1000
  ]) {
    const [year, month, day] = toDateDirectoryParts(timestamp);
    dateCandidates.add(path.join(codexSessionsDir, year, month, day));
  }

  const files = (
    await Promise.all(
      Array.from(dateCandidates).map(async (directory) => {
        const directoryFiles = await listFiles(directory);
        return directoryFiles.filter((filePath) => path.basename(filePath).startsWith('rollout-'));
      })
    )
  ).flat();

  if (files.length === 0) {
    return null;
  }

  const matchingSessionIds = new Set<string>();
  for (const filePath of files) {
    // eslint-disable-next-line no-await-in-loop
    const firstLine = await readFirstLine(filePath);
    if (!firstLine) {
      continue;
    }

    const parsed = parseCodexSessionMeta(firstLine);
    if (!parsed || parsed.cwd !== resolvedCwd) {
      continue;
    }

    const timestampMs = resolveCodexSessionTimestampMs(parsed, startedAtMs);
    if (Math.abs(timestampMs - startedAtMs) > CODEX_CANDIDATE_WINDOW_MS) {
      continue;
    }

    matchingSessionIds.add(parsed.sessionId);
    if (matchingSessionIds.size > 1) {
      return null;
    }
  }

  const [sessionId] = Array.from(matchingSessionIds);
  return sessionId ?? null;
}

async function findClaudeSessionIdOnce(
  cwd: string,
  sessionId: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const claudeProjectsDir = path.join(resolveHomeDirectory(env), '.claude', 'projects');
  const sessionFileName = `${sessionId}.jsonl`;
  const expectedProjectDirectory = path.join(
    claudeProjectsDir,
    toClaudeProjectDirectoryName(cwd)
  );
  const directCandidate = path.join(expectedProjectDirectory, sessionFileName);
  if (await fileExists(directCandidate)) {
    return sessionId;
  }

  const projectDirectories = await listDirectories(claudeProjectsDir);
  for (const projectDirectory of projectDirectories) {
    if (projectDirectory === expectedProjectDirectory) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(path.join(projectDirectory, sessionFileName))) {
      return sessionId;
    }
  }

  return null;
}

export async function locateCodexSessionId(
  options: LocateCodexSessionIdOptions
): Promise<string | null> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const detected = await findCodexSessionIdOnce(
      options.cwd,
      options.startedAtMs,
      env,
      options.nowMs ?? Date.now()
    );
    if (detected) {
      return detected;
    }

    if (Date.now() > deadline) {
      return null;
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(POLL_INTERVAL_MS);
  }
}

export async function locateClaudeSessionId(
  options: LocateClaudeSessionIdOptions
): Promise<string | null> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const candidateSessionId = options.sessionId.trim();
  if (candidateSessionId.length === 0) {
    return null;
  }

  while (true) {
    const detected = await findClaudeSessionIdOnce(options.cwd, candidateSessionId, env);
    if (detected) {
      return detected;
    }

    if (Date.now() > deadline) {
      return null;
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(POLL_INTERVAL_MS);
  }
}
