import * as path from 'path';
import { fileURLToPath } from 'url';

import { Terminal as HeadlessTerminal } from '@xterm/headless';

import type { ExecutionTerminalPathStyle } from '../common/executionTerminalLinks';
import { DEFAULT_TERMINAL_SCROLLBACK, normalizeTerminalScrollback } from '../common/terminalScrollback';

const OSC7_PREFIX = '\u001b]7;';
const OSC_BEL_TERMINATOR = '\u0007';
const OSC_ST_TERMINATOR = '\u001b\\';
const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';
const MAX_REPLAY_SEGMENT_CHARS = 200_000;

interface ExecutionTerminalLineContextTrackerOptions {
  cwd: string;
  pathStyle: ExecutionTerminalPathStyle;
  userHome?: string;
  scrollback?: number;
  initialOutput?: string;
}

interface ReplaySegment {
  data: string;
  cwd: string;
}

export class ExecutionTerminalLineContextTracker {
  private readonly pathStyle: ExecutionTerminalPathStyle;
  private readonly userHome?: string;
  private terminal: HeadlessTerminal;
  private scrollback: number;
  private disposed = false;
  private currentCwd: string;
  private previousCwd: string | undefined;
  private readonly directoryStack: string[] = [];
  private readonly replaySegments: ReplaySegment[] = [];
  private replaySegmentChars = 0;
  private readonly lineCwds: string[] = [];
  private pendingInputLine = '';
  private pendingOsc7Chunk = '';
  private operationChain: Promise<void> = Promise.resolve();
  private readonly disposedSignal = createDeferred<void>();

  public constructor(cols: number, rows: number, options: ExecutionTerminalLineContextTrackerOptions) {
    this.pathStyle = options.pathStyle;
    this.userHome = options.userHome?.trim() || undefined;
    this.scrollback = normalizeTerminalScrollback(options.scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    this.currentCwd = options.cwd;
    this.terminal = this.createTerminal(cols, rows, this.scrollback);
    if (options.initialOutput) {
      this.write(options.initialOutput);
    }
  }

  public write(chunk: string): void {
    if (!chunk || this.disposed) {
      return;
    }

    this.enqueueOperation(() => this.writeInternal(chunk));
  }

  public recordInput(data: string): void {
    if (!data || this.disposed) {
      return;
    }

    this.enqueueOperation(() => {
      this.recordInputInternal(data);
    });
  }

  public resize(cols: number, rows: number): void {
    if (this.disposed) {
      return;
    }

    this.enqueueOperation(async () => {
      if (this.disposed) {
        return;
      }

      if (this.terminal.cols === cols && this.terminal.rows === rows) {
        return;
      }

      await this.rebuild(cols, rows, this.scrollback);
    });
  }

  public async setScrollback(scrollback: number): Promise<void> {
    if (this.disposed) {
      await this.awaitPendingOperations();
      return;
    }

    const normalizedScrollback = normalizeTerminalScrollback(scrollback, DEFAULT_TERMINAL_SCROLLBACK);
    if (normalizedScrollback === this.scrollback) {
      await this.awaitPendingOperations();
      return;
    }

    this.enqueueOperation(async () => {
      if (this.disposed) {
        return;
      }

      await this.rebuild(this.terminal.cols, this.terminal.rows, normalizedScrollback);
    });
    await this.awaitPendingOperations();
  }

  public async getCwdForBufferLine(bufferStartLine: number): Promise<string | undefined> {
    await this.awaitPendingOperations();
    return this.lineCwds[bufferStartLine] ?? this.currentCwd;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposedSignal.resolve();
    this.terminal.dispose();
  }

  private enqueueOperation(operation: () => Promise<void> | void): void {
    this.operationChain = this.operationChain
      .then(async () => {
        if (this.disposed) {
          return;
        }

        await operation();
      })
      .catch(() => {});
  }

  private async awaitPendingOperations(): Promise<void> {
    await Promise.race([this.operationChain, this.disposedSignal.promise]);
  }

  private async writeInternal(chunk: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    const segments = this.extractReplaySegments(chunk);
    for (const segment of segments) {
      if (this.disposed) {
        return;
      }

      if (!segment.data) {
        continue;
      }

      this.replaySegments.push(segment);
      this.replaySegmentChars += segment.data.length;
      this.trimReplaySegments();
      await this.writeSegment(segment);
    }
  }

  private recordInputInternal(data: string): void {
    if (this.disposed) {
      return;
    }

    const normalized = stripTerminalInputControlSequences(data);
    for (const char of normalized) {
      if (char === '\r' || char === '\n') {
        this.applyPendingInputLine();
        continue;
      }

      if (char === '\u007f' || char === '\b') {
        this.pendingInputLine = this.pendingInputLine.slice(0, -1);
        continue;
      }

      if (char >= ' ') {
        this.pendingInputLine += char;
      }
    }
  }

  private applyPendingInputLine(): void {
    const line = this.pendingInputLine.trim();
    this.pendingInputLine = '';
    if (!line) {
      return;
    }

    const clause = extractTrackedShellClause(line);
    if (!clause) {
      return;
    }

    if (clause.command === 'popd') {
      const nextCwd = this.directoryStack.pop();
      if (!nextCwd) {
        return;
      }

      this.previousCwd = this.currentCwd;
      this.currentCwd = nextCwd;
      return;
    }

    const resolvedPath = resolveTrackedDirectoryArgument(
      clause.argument,
      this.currentCwd,
      this.pathStyle,
      this.userHome,
      this.previousCwd
    );
    if (!resolvedPath) {
      return;
    }

    if (clause.command === 'pushd') {
      this.directoryStack.push(this.currentCwd);
    }

    this.previousCwd = this.currentCwd;
    this.currentCwd = resolvedPath;
  }

  private extractReplaySegments(chunk: string): ReplaySegment[] {
    const combined = `${this.pendingOsc7Chunk}${chunk}`;
    this.pendingOsc7Chunk = '';

    const segments: ReplaySegment[] = [];
    let cursor = 0;
    while (cursor < combined.length) {
      const markerStart = combined.indexOf(OSC7_PREFIX, cursor);
      if (markerStart < 0) {
        segments.push({
          data: combined.slice(cursor),
          cwd: this.currentCwd
        });
        break;
      }

      if (markerStart > cursor) {
        segments.push({
          data: combined.slice(cursor, markerStart),
          cwd: this.currentCwd
        });
      }

      const markerPayloadStart = markerStart + OSC7_PREFIX.length;
      const markerTerminator = findOscTerminator(combined, markerPayloadStart);
      if (!markerTerminator) {
        this.pendingOsc7Chunk = combined.slice(markerStart);
        break;
      }

      const nextCwd = parseOsc7WorkingDirectory(combined.slice(markerPayloadStart, markerTerminator.index));
      if (nextCwd) {
        this.previousCwd = this.currentCwd;
        this.currentCwd = nextCwd;
      }
      cursor = markerTerminator.nextIndex;
    }

    return segments.filter((segment) => segment.data.length > 0);
  }

  private trimReplaySegments(): void {
    while (this.replaySegmentChars > MAX_REPLAY_SEGMENT_CHARS && this.replaySegments.length > 1) {
      const dropped = this.replaySegments.shift();
      if (!dropped) {
        break;
      }

      this.replaySegmentChars -= dropped.data.length;
    }
  }

  private async writeSegment(segment: ReplaySegment): Promise<void> {
    if (this.disposed) {
      return;
    }

    const terminal = this.terminal;
    const previousLength = terminal.buffer.active.length;
    const previousBaseY = terminal.buffer.active.baseY;
    const previousCursorLine = previousBaseY + terminal.buffer.active.cursorY;
    await Promise.race([
      new Promise<void>((resolve) => {
        terminal.write(segment.data, () => resolve());
      }),
      this.disposedSignal.promise
    ]);

    if (this.disposed || terminal !== this.terminal) {
      return;
    }

    const nextLength = terminal.buffer.active.length;
    const nextBaseY = terminal.buffer.active.baseY;
    const nextCursorLine = nextBaseY + terminal.buffer.active.cursorY;
    const lengthGrowth = Math.max(0, nextLength - previousLength);
    const trimmedLines = Math.max(0, nextBaseY - previousBaseY - lengthGrowth);
    if (trimmedLines > 0) {
      this.lineCwds.splice(0, trimmedLines);
    }

    while (this.lineCwds.length < nextLength) {
      this.lineCwds.push(segment.cwd);
    }
    while (this.lineCwds.length > nextLength) {
      this.lineCwds.shift();
    }

    if (nextLength === 0) {
      return;
    }

    // xterm keeps trailing blank rows in the buffer, so writes can update lines
    // well before buffer.length - 1 after a cwd change or resize. Track the span
    // between the pre-write and post-write cursor rows instead of assuming tail writes.
    const touchedStartLine = Math.max(0, Math.min(nextLength - 1, previousCursorLine - trimmedLines));
    const touchedEndLine = Math.max(touchedStartLine, Math.min(nextLength - 1, nextCursorLine));
    for (let lineIndex = touchedStartLine; lineIndex <= touchedEndLine; lineIndex += 1) {
      this.lineCwds[lineIndex] = segment.cwd;
    }
  }

  private async rebuild(cols: number, rows: number, scrollback: number): Promise<void> {
    if (this.disposed) {
      return;
    }

    const previousTerminal = this.terminal;
    previousTerminal.dispose();
    const nextTerminal = this.createTerminal(cols, rows, scrollback);
    if (this.disposed) {
      nextTerminal.dispose();
      return;
    }

    this.terminal = nextTerminal;
    this.scrollback = scrollback;
    this.lineCwds.length = 0;
    for (const segment of this.replaySegments) {
      if (this.disposed || this.terminal !== nextTerminal) {
        return;
      }

      await this.writeSegment(segment);
    }
  }

  private createTerminal(cols: number, rows: number, scrollback: number): HeadlessTerminal {
    return new HeadlessTerminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback
    });
  }
}

function stripTerminalInputControlSequences(value: string): string {
  return value
    .replace(new RegExp(escapeRegExp(BRACKETED_PASTE_START), 'g'), '')
    .replace(new RegExp(escapeRegExp(BRACKETED_PASTE_END), 'g'), '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001bO./g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTrackedShellClause(
  commandLine: string
): { command: 'cd' | 'pushd' | 'popd'; argument?: string } | undefined {
  const firstClause = readFirstShellClause(commandLine).trim();
  if (!firstClause) {
    return undefined;
  }

  if (firstClause === 'popd') {
    return {
      command: 'popd'
    };
  }

  const match = firstClause.match(/^(cd|pushd)(?:\s+(?<argument>.+))?$/);
  if (!match) {
    return undefined;
  }

  return {
    command: match[1] === 'pushd' ? 'pushd' : 'cd',
    argument: match.groups?.argument?.trim()
  };
}

function readFirstShellClause(commandLine: string): string {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === '\\') {
        index += 1;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    const nextChar = commandLine[index + 1];
    if (char === ';' || char === '|') {
      return commandLine.slice(0, index);
    }
    if (char === '&' && nextChar === '&') {
      return commandLine.slice(0, index);
    }
  }

  return commandLine;
}

function resolveTrackedDirectoryArgument(
  rawArgument: string | undefined,
  currentCwd: string,
  style: ExecutionTerminalPathStyle,
  userHome: string | undefined,
  previousCwd: string | undefined
): string | undefined {
  const normalizedArgument = unquoteTrackedDirectoryArgument(rawArgument);
  if (!normalizedArgument || normalizedArgument === '~') {
    return userHome ?? currentCwd;
  }

  if (normalizedArgument === '-') {
    return previousCwd;
  }

  const expandedArgument =
    normalizedArgument.startsWith('~/') || normalizedArgument.startsWith('~\\')
      ? userHome
        ? joinTrackedPath(style, userHome, normalizedArgument.slice(2))
        : undefined
      : normalizedArgument;
  if (!expandedArgument) {
    return undefined;
  }

  if (isAbsoluteTrackedPath(style, expandedArgument)) {
    return normalizeTrackedPath(style, expandedArgument);
  }

  return joinTrackedPath(style, currentCwd, expandedArgument);
}

function unquoteTrackedDirectoryArgument(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function normalizeTrackedPath(style: ExecutionTerminalPathStyle, value: string): string {
  return style === 'windows' ? path.win32.normalize(value) : path.posix.normalize(value);
}

function joinTrackedPath(style: ExecutionTerminalPathStyle, basePath: string, nextPath: string): string {
  return style === 'windows'
    ? path.win32.normalize(path.win32.join(basePath, nextPath))
    : path.posix.normalize(path.posix.join(basePath, nextPath));
}

function isAbsoluteTrackedPath(style: ExecutionTerminalPathStyle, value: string): boolean {
  return style === 'windows'
    ? path.win32.isAbsolute(value) || value.startsWith('\\\\')
    : path.posix.isAbsolute(value);
}

function findOscTerminator(
  value: string,
  startIndex: number
): { index: number; nextIndex: number } | undefined {
  const belIndex = value.indexOf(OSC_BEL_TERMINATOR, startIndex);
  const stIndex = value.indexOf(OSC_ST_TERMINATOR, startIndex);
  if (belIndex < 0 && stIndex < 0) {
    return undefined;
  }

  if (belIndex >= 0 && (stIndex < 0 || belIndex < stIndex)) {
    return {
      index: belIndex,
      nextIndex: belIndex + OSC_BEL_TERMINATOR.length
    };
  }

  return {
    index: stIndex,
    nextIndex: stIndex + OSC_ST_TERMINATOR.length
  };
}

function parseOsc7WorkingDirectory(value: string): string | undefined {
  try {
    return fileURLToPath(value.trim());
  } catch {
    return undefined;
  }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve
  };
}
