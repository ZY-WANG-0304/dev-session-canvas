export interface WorkspaceFolderLabelSource {
  name: string;
  path: string;
}

export interface ResolvedWorkspaceFolderLabel extends WorkspaceFolderLabelSource {
  label: string;
}

interface NormalizedWorkspaceFolderLabelEntry {
  folder: WorkspaceFolderLabelSource;
  index: number;
  sanitizedName: string;
  normalizedPath: string;
  pathSegments: string[];
}

export function resolveWorkspaceFolderLabels(
  workspaceFolders: readonly WorkspaceFolderLabelSource[] | undefined
): ResolvedWorkspaceFolderLabel[] {
  const entries = (workspaceFolders ?? [])
    .map((folder, index) => {
      const sanitizedName = sanitizeWorkspaceFolderName(folder.name);
      const normalizedPath = normalizeWorkspaceFolderPathForLabel(folder.path);
      return {
        folder,
        index,
        sanitizedName,
        normalizedPath,
        pathSegments: splitWorkspaceFolderPathSegments(normalizedPath)
      } satisfies NormalizedWorkspaceFolderLabelEntry;
    })
    .filter((entry) => entry.normalizedPath.length > 0);

  const labelsByIndex = new Map<number, string>();
  const entriesByName = new Map<string, NormalizedWorkspaceFolderLabelEntry[]>();

  for (const entry of entries) {
    const baseName = entry.sanitizedName || basenameOfNormalizedWorkspaceFolderPath(entry.normalizedPath);
    const groupKey = baseName.toLocaleLowerCase();
    const group = entriesByName.get(groupKey) ?? [];
    group.push(entry);
    entriesByName.set(groupKey, group);
  }

  for (const group of entriesByName.values()) {
    const baseName = group[0]
      ? group[0].sanitizedName || basenameOfNormalizedWorkspaceFolderPath(group[0].normalizedPath)
      : '';
    if (group.length === 1) {
      const entry = group[0];
      if (entry) {
        labelsByIndex.set(entry.index, baseName || entry.normalizedPath);
      }
      continue;
    }

    const usedLabels = new Set<string>();
    for (const entry of group) {
      let label = buildDisambiguatedWorkspaceFolderLabel(baseName, entry, group);
      const duplicateBase = label;
      let duplicateIndex = 2;
      while (usedLabels.has(label.toLocaleLowerCase())) {
        label = `${duplicateBase} #${duplicateIndex}`;
        duplicateIndex += 1;
      }
      usedLabels.add(label.toLocaleLowerCase());
      labelsByIndex.set(entry.index, label);
    }
  }

  return (workspaceFolders ?? []).map((folder, index) => ({
    ...folder,
    label:
      labelsByIndex.get(index) ??
      (sanitizeWorkspaceFolderName(folder.name) ||
        basenameOfNormalizedWorkspaceFolderPath(normalizeWorkspaceFolderPathForLabel(folder.path)) ||
        folder.path)
  }));
}

export function getWorkspaceFolderDisplayLabel(
  workspaceFolder: WorkspaceFolderLabelSource,
  workspaceFolders: readonly WorkspaceFolderLabelSource[] | undefined
): string {
  const labels = resolveWorkspaceFolderLabels(workspaceFolders);
  const normalizedTargetPath = normalizeWorkspaceFolderPathForLabel(workspaceFolder.path);
  const matched = labels.find((candidate) =>
    candidate.name === workspaceFolder.name &&
    normalizeWorkspaceFolderPathForLabel(candidate.path) === normalizedTargetPath
  );
  return (
    matched?.label ??
    (sanitizeWorkspaceFolderName(workspaceFolder.name) ||
      basenameOfNormalizedWorkspaceFolderPath(workspaceFolder.path) ||
      workspaceFolder.path)
  );
}

function buildDisambiguatedWorkspaceFolderLabel(
  baseName: string,
  entry: NormalizedWorkspaceFolderLabelEntry,
  group: readonly NormalizedWorkspaceFolderLabelEntry[]
): string {
  const maxDepth = Math.max(...group.map((candidate) => candidate.pathSegments.length), 1);
  for (let depth = 2; depth <= maxDepth; depth += 1) {
    const suffix = lastPathSegments(entry.pathSegments, depth).join('/');
    const candidateLabel = suffix || baseName || entry.normalizedPath;
    const candidateKey = candidateLabel.toLocaleLowerCase();
    const isUnique = group.every((other) => {
      if (other.index === entry.index) {
        return true;
      }
      return lastPathSegments(other.pathSegments, depth).join('/').toLocaleLowerCase() !== candidateKey;
    });
    if (isUnique) {
      return candidateLabel;
    }
  }

  return entry.normalizedPath || baseName || `workspace-${entry.index + 1}`;
}

function lastPathSegments(segments: readonly string[], depth: number): string[] {
  return segments.slice(Math.max(0, segments.length - depth));
}

function sanitizeWorkspaceFolderName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
}

function normalizeWorkspaceFolderPathForLabel(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return '';
  }
  return trimTrailingSeparators(raw.replace(/\\/g, '/'));
}

function splitWorkspaceFolderPathSegments(value: string): string[] {
  const normalized = normalizeWorkspaceFolderPathForLabel(value);
  if (!normalized) {
    return [];
  }

  if (/^[A-Za-z]:\/?$/u.test(normalized)) {
    return [normalized];
  }

  return normalized.split('/').filter(Boolean);
}

function basenameOfNormalizedWorkspaceFolderPath(value: string): string {
  const normalized = normalizeWorkspaceFolderPathForLabel(value);
  const segments = splitWorkspaceFolderPathSegments(normalized);
  return segments[segments.length - 1] ?? normalized;
}

function trimTrailingSeparators(value: string): string {
  if (/^[A-Za-z]:\/$/u.test(value) || value === '/') {
    return value;
  }

  return value.replace(/\/+$/u, '') || value;
}
