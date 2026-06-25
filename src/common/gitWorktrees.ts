export interface GitWorktreeListEntry {
  worktreePath: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export function parseGitWorktreeListPorcelain(output: string): GitWorktreeListEntry[] {
  const entries: GitWorktreeListEntry[] = [];
  let current: GitWorktreeListEntry | undefined;

  const pushCurrent = () => {
    if (current?.worktreePath) {
      entries.push(current);
    }
    current = undefined;
  };

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (!line) {
      pushCurrent();
      continue;
    }

    const separatorIndex = line.indexOf(' ');
    const key = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';

    if (key === 'worktree') {
      pushCurrent();
      current = {
        worktreePath: value,
        detached: false,
        bare: false,
        locked: false,
        prunable: false
      };
      continue;
    }

    if (!current) {
      continue;
    }

    switch (key) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branch = stripGitHeadsPrefix(value);
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'locked':
        current.locked = true;
        break;
      case 'prunable':
        current.prunable = true;
        break;
    }
  }

  pushCurrent();
  return entries;
}

export function formatGitWorktreeListEntryRef(entry: Pick<GitWorktreeListEntry, 'branch' | 'detached' | 'head'>): string {
  if (entry.branch) {
    return entry.branch;
  }
  if (entry.detached) {
    return entry.head ? `detached ${entry.head.slice(0, 12)}` : 'detached HEAD';
  }
  return entry.head ? entry.head.slice(0, 12) : 'unknown ref';
}

function stripGitHeadsPrefix(value: string): string {
  return value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value;
}
