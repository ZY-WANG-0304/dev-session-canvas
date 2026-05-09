export type ExecutionTerminalClipboardPlatform = 'mac' | 'windows' | 'linux' | 'other';

export type ExecutionTerminalClipboardShortcutAction =
  | 'copy'
  | 'copyAndClearSelection'
  | 'paste'
  | 'passThrough'
  | 'noop';

export interface ExecutionTerminalClipboardKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ExecutionTerminalClipboardEnvironment {
  platform?: string;
  userAgent?: string;
}

export type ExecutionTerminalPastePreparation =
  | {
      kind: 'paste';
      text: string;
    }
  | {
      kind: 'confirm';
      text: string;
      lineCount: number;
    }
  | {
      kind: 'cancel';
    };

export function resolveExecutionTerminalClipboardShortcut(
  platform: ExecutionTerminalClipboardPlatform,
  event: ExecutionTerminalClipboardKeyEventLike,
  hasSelection: boolean
): ExecutionTerminalClipboardShortcutAction {
  if (event.altKey) {
    return 'passThrough';
  }

  const key = normalizeClipboardShortcutKey(event.key);
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const shift = event.shiftKey === true;

  if (platform === 'mac') {
    if (meta && !ctrl && !shift && key === 'c') {
      return hasSelection ? 'copy' : 'noop';
    }
    if (meta && !ctrl && !shift && key === 'v') {
      return 'paste';
    }
    return 'passThrough';
  }

  if (platform === 'windows') {
    if (ctrl && !meta && !shift && key === 'c') {
      return hasSelection ? 'copyAndClearSelection' : 'passThrough';
    }
    if (ctrl && !meta && shift && key === 'c') {
      return hasSelection ? 'copy' : 'noop';
    }
    if (ctrl && !meta && key === 'v') {
      return 'paste';
    }
    return 'passThrough';
  }

  if (platform === 'linux') {
    if (ctrl && !meta && shift && key === 'c') {
      return hasSelection ? 'copy' : 'noop';
    }
    if (ctrl && !meta && shift && key === 'v') {
      return 'paste';
    }
    return 'passThrough';
  }

  if ((meta || (ctrl && shift)) && key === 'c') {
    return hasSelection ? 'copy' : 'noop';
  }
  if ((meta || (ctrl && shift)) && key === 'v') {
    return 'paste';
  }
  return 'passThrough';
}

export function inferExecutionTerminalClipboardPlatform(
  environment: ExecutionTerminalClipboardEnvironment
): ExecutionTerminalClipboardPlatform {
  const platform = normalizePlatformText(environment.platform);
  const userAgent = normalizePlatformText(environment.userAgent);
  const combined = `${platform} ${userAgent}`;

  if (combined.includes('mac') || combined.includes('darwin')) {
    return 'mac';
  }
  if (combined.includes('win')) {
    return 'windows';
  }
  if (combined.includes('linux') || combined.includes('x11')) {
    return 'linux';
  }
  return 'other';
}

export function prepareExecutionTerminalPasteText(
  text: string,
  bracketedPasteMode: boolean
): ExecutionTerminalPastePreparation {
  if (text.length === 0) {
    return { kind: 'cancel' };
  }

  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length === 1 || bracketedPasteMode) {
    return {
      kind: 'paste',
      text
    };
  }

  if (lines.length === 2 && lines[1].trim().length === 0) {
    return {
      kind: 'paste',
      text: lines[0]
    };
  }

  return {
    kind: 'confirm',
    text,
    lineCount: lines.length
  };
}

function normalizeClipboardShortcutKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === 'keyc') {
    return 'c';
  }
  if (normalized === 'keyv') {
    return 'v';
  }
  return normalized;
}

function normalizePlatformText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
