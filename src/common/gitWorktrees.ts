export interface GitWorktreeListEntry {
  worktreePath: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface GitWorktreeRepositoryCandidate {
  gitCommonDir: string;
  isLinkedWorktree: boolean;
  isRepositoryRoot: boolean;
  workspaceFolderIndex: number;
}

export interface GitWorktreeRepositoryCandidateGroup<T extends GitWorktreeRepositoryCandidate> {
  repositoryKey: string;
  primary: T;
  members: T[];
  firstWorkspaceFolderIndex: number;
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

export function groupGitWorktreeRepositoryCandidates<T extends GitWorktreeRepositoryCandidate>(
  candidates: readonly T[],
  normalizeRepositoryKey: (filePath: string) => string = (filePath) => filePath
): GitWorktreeRepositoryCandidateGroup<T>[] {
  const groups: GitWorktreeRepositoryCandidateGroup<T>[] = [];
  const groupByRepositoryKey = new Map<string, GitWorktreeRepositoryCandidateGroup<T>>();

  for (const candidate of candidates) {
    const repositoryKey = normalizeRepositoryKey(candidate.gitCommonDir);
    const existingGroup = groupByRepositoryKey.get(repositoryKey);
    if (!existingGroup) {
      const group = {
        repositoryKey,
        primary: candidate,
        members: [candidate],
        firstWorkspaceFolderIndex: candidate.workspaceFolderIndex
      };
      groupByRepositoryKey.set(repositoryKey, group);
      groups.push(group);
      continue;
    }

    existingGroup.members.push(candidate);
    existingGroup.firstWorkspaceFolderIndex = Math.min(
      existingGroup.firstWorkspaceFolderIndex,
      candidate.workspaceFolderIndex
    );
    if (shouldPreferGitWorktreeRepositoryCandidate(candidate, existingGroup.primary)) {
      existingGroup.primary = candidate;
    }
  }

  return groups.sort((a, b) => a.firstWorkspaceFolderIndex - b.firstWorkspaceFolderIndex);
}

function stripGitHeadsPrefix(value: string): string {
  return value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value;
}

function shouldPreferGitWorktreeRepositoryCandidate(
  candidate: GitWorktreeRepositoryCandidate,
  current: GitWorktreeRepositoryCandidate
): boolean {
  if (candidate.isRepositoryRoot !== current.isRepositoryRoot) {
    return candidate.isRepositoryRoot;
  }
  if (candidate.isLinkedWorktree !== current.isLinkedWorktree) {
    return !candidate.isLinkedWorktree;
  }
  return candidate.workspaceFolderIndex < current.workspaceFolderIndex;
}
