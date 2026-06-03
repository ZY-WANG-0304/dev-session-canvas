export interface ExecutionWorkspaceFolderLabelSource {
  name: string;
  path: string;
}

interface NormalizedExecutionPath {
  raw: string;
  normalized: string;
  comparable: string;
  caseInsensitive: boolean;
}

export function formatExecutionCwdLabel(
  cwd: string | undefined,
  workspaceFolders: readonly ExecutionWorkspaceFolderLabelSource[] | undefined
): string {
  const normalizedCwd = normalizeExecutionPath(cwd);
  if (!normalizedCwd) {
    return 'cwd 未知';
  }

  const normalizedFolders = (workspaceFolders ?? [])
    .map((folder) => ({
      folder,
      normalizedPath: normalizeExecutionPath(folder.path)
    }))
    .filter((entry): entry is { folder: ExecutionWorkspaceFolderLabelSource; normalizedPath: NormalizedExecutionPath } =>
      Boolean(entry.normalizedPath)
    )
    .sort((left, right) => right.normalizedPath.normalized.length - left.normalizedPath.normalized.length);

  for (const entry of normalizedFolders) {
    const relativePath = resolveRelativeExecutionPath(normalizedCwd, entry.normalizedPath);
    if (relativePath === undefined) {
      continue;
    }

    const workspaceLabel = sanitizeWorkspaceFolderName(entry.folder.name) || basenameOfNormalizedPath(entry.normalizedPath.normalized);
    if (!relativePath) {
      return appendDirectoryIndicator(workspaceLabel || entry.normalizedPath.normalized);
    }

    return appendDirectoryIndicator(
      normalizedFolders.length > 1 && workspaceLabel
        ? `${workspaceLabel}/${relativePath}`
        : relativePath
    );
  }

  return appendDirectoryIndicator(basenameOfNormalizedPath(normalizedCwd.normalized) || normalizedCwd.raw);
}

export function formatExecutionCwdTooltip(cwd: string | undefined, fallbackLabel?: string): string {
  const normalizedCwd = normalizeExecutionPath(cwd);
  if (!normalizedCwd) {
    return fallbackLabel?.trim() || 'cwd 未知';
  }

  return appendDirectoryIndicator(normalizedCwd.normalized);
}

function appendDirectoryIndicator(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith('/') || trimmed.endsWith('\\')) {
    return trimmed;
  }

  return `${trimmed}/`;
}

function normalizeExecutionPath(value: string | undefined): NormalizedExecutionPath | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }

  const caseInsensitive = /^[A-Za-z]:[\\/]/u.test(raw) || raw.includes('\\');
  const slashNormalized = raw.replace(/\\/g, '/');
  const normalized = trimTrailingSeparators(slashNormalized);
  return {
    raw,
    normalized,
    comparable: caseInsensitive ? normalized.toLowerCase() : normalized,
    caseInsensitive
  };
}

function trimTrailingSeparators(value: string): string {
  if (/^[A-Za-z]:\/$/u.test(value) || value === '/') {
    return value;
  }

  return value.replace(/\/+$/u, '') || value;
}

function resolveRelativeExecutionPath(
  cwd: NormalizedExecutionPath,
  workspaceFolderPath: NormalizedExecutionPath
): string | undefined {
  const useCaseInsensitive = cwd.caseInsensitive || workspaceFolderPath.caseInsensitive;
  const cwdComparable = useCaseInsensitive ? cwd.normalized.toLowerCase() : cwd.comparable;
  const workspaceComparable = useCaseInsensitive ? workspaceFolderPath.normalized.toLowerCase() : workspaceFolderPath.comparable;

  if (cwdComparable === workspaceComparable) {
    return '';
  }

  const workspacePrefix = workspaceComparable.endsWith('/') ? workspaceComparable : `${workspaceComparable}/`;
  if (!cwdComparable.startsWith(workspacePrefix)) {
    return undefined;
  }

  return cwd.normalized.slice(workspaceFolderPath.normalized.length).replace(/^\/+/, '');
}

function sanitizeWorkspaceFolderName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
}

function basenameOfNormalizedPath(value: string): string {
  const trimmed = trimTrailingSeparators(value);
  const parts = trimmed.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}
