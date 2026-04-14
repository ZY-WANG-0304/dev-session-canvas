import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE_STORAGE_DIRNAME = 'workspaceStorage';
const INDEXED_WORKSPACE_SLOT_PATTERN = /^(.*)-([1-9]\d*)$/;
const RECOVERABLE_STATE_RELATIVE_PATHS = [
  'canvas-state.json',
  path.join('runtime-supervisor', 'registry.json'),
  'agent-runtime'
] as const;

interface WorkspaceStorageSlotIdentity {
  name: string;
  canonicalName: string;
  slotIndex: number;
}

export interface ExtensionStoragePathResolution {
  currentPath: string;
  resolvedPath: string;
  recoveryReason?: 'workspace-storage-slot-fallback';
}

export function resolvePreferredExtensionStoragePath(
  currentPath: string,
  options: {
    pathExists?: (candidatePath: string) => boolean;
    listDirectoryEntries?: (directoryPath: string) => readonly string[];
  } = {}
): ExtensionStoragePathResolution {
  const normalizedCurrentPath = path.normalize(currentPath);
  const pathExists = options.pathExists ?? fs.existsSync;
  const listDirectoryEntries = options.listDirectoryEntries ?? listDirectoryNames;

  if (hasRecoverableState(normalizedCurrentPath, pathExists)) {
    return {
      currentPath: normalizedCurrentPath,
      resolvedPath: normalizedCurrentPath
    };
  }

  const workspaceSlotDir = path.dirname(normalizedCurrentPath);
  const workspaceSlotName = path.basename(workspaceSlotDir);
  const workspaceStorageDir = path.dirname(workspaceSlotDir);
  if (path.basename(workspaceStorageDir) !== WORKSPACE_STORAGE_DIRNAME) {
    return {
      currentPath: normalizedCurrentPath,
      resolvedPath: normalizedCurrentPath
    };
  }

  const currentWorkspaceSlot = parseWorkspaceStorageSlotName(workspaceSlotName);
  if (!currentWorkspaceSlot) {
    return {
      currentPath: normalizedCurrentPath,
      resolvedPath: normalizedCurrentPath
    };
  }

  const candidateWorkspaceSlots = collectWorkspaceStorageSlotCandidates(
    workspaceStorageDir,
    currentWorkspaceSlot,
    listDirectoryEntries
  );
  const extensionStorageDirName = path.basename(normalizedCurrentPath);

  for (const candidateWorkspaceSlot of candidateWorkspaceSlots) {
    const candidatePath = path.join(workspaceStorageDir, candidateWorkspaceSlot.name, extensionStorageDirName);
    if (!hasRecoverableState(candidatePath, pathExists)) {
      continue;
    }

    return {
      currentPath: normalizedCurrentPath,
      resolvedPath: candidatePath,
      recoveryReason: 'workspace-storage-slot-fallback'
    };
  }

  return {
    currentPath: normalizedCurrentPath,
    resolvedPath: normalizedCurrentPath
  };
}

function collectWorkspaceStorageSlotCandidates(
  workspaceStorageDir: string,
  currentWorkspaceSlot: WorkspaceStorageSlotIdentity,
  listDirectoryEntries: (directoryPath: string) => readonly string[]
): WorkspaceStorageSlotIdentity[] {
  const candidates = new Map<string, WorkspaceStorageSlotIdentity>();

  // Preserve the old direct fallback to the canonical slot even if directory listing fails.
  if (currentWorkspaceSlot.slotIndex !== 0) {
    const canonicalWorkspaceSlot = parseWorkspaceStorageSlotName(currentWorkspaceSlot.canonicalName);
    if (canonicalWorkspaceSlot) {
      candidates.set(canonicalWorkspaceSlot.name, canonicalWorkspaceSlot);
    }
  }

  for (const entryName of safelyListDirectoryEntries(workspaceStorageDir, listDirectoryEntries)) {
    const candidateWorkspaceSlot = parseWorkspaceStorageSlotName(entryName);
    if (!candidateWorkspaceSlot) {
      continue;
    }
    if (candidateWorkspaceSlot.canonicalName !== currentWorkspaceSlot.canonicalName) {
      continue;
    }
    if (candidateWorkspaceSlot.name === currentWorkspaceSlot.name) {
      continue;
    }
    candidates.set(candidateWorkspaceSlot.name, candidateWorkspaceSlot);
  }

  return Array.from(candidates.values()).sort((left, right) =>
    compareWorkspaceStorageSlotCandidates(left, right, currentWorkspaceSlot.slotIndex)
  );
}

function parseWorkspaceStorageSlotName(slotName: string): WorkspaceStorageSlotIdentity | undefined {
  const trimmedSlotName = slotName.trim();
  if (!trimmedSlotName) {
    return undefined;
  }

  const match = trimmedSlotName.match(INDEXED_WORKSPACE_SLOT_PATTERN);
  const canonicalName = match?.[1]?.trim();
  if (match && canonicalName) {
    return {
      name: trimmedSlotName,
      canonicalName,
      slotIndex: Number(match[2])
    };
  }

  return {
    name: trimmedSlotName,
    canonicalName: trimmedSlotName,
    slotIndex: 0
  };
}

function compareWorkspaceStorageSlotCandidates(
  left: WorkspaceStorageSlotIdentity,
  right: WorkspaceStorageSlotIdentity,
  currentSlotIndex: number
): number {
  const distanceDifference =
    Math.abs(left.slotIndex - currentSlotIndex) - Math.abs(right.slotIndex - currentSlotIndex);
  if (distanceDifference !== 0) {
    return distanceDifference;
  }

  const slotIndexDifference = left.slotIndex - right.slotIndex;
  if (slotIndexDifference !== 0) {
    return slotIndexDifference;
  }

  return left.name.localeCompare(right.name);
}

function safelyListDirectoryEntries(
  directoryPath: string,
  listDirectoryEntries: (directoryPath: string) => readonly string[]
): readonly string[] {
  try {
    return listDirectoryEntries(directoryPath);
  } catch {
    return [];
  }
}

function hasRecoverableState(basePath: string, pathExists: (candidatePath: string) => boolean): boolean {
  return RECOVERABLE_STATE_RELATIVE_PATHS.some((relativePath) => pathExists(path.join(basePath, relativePath)));
}

function listDirectoryNames(directoryPath: string): readonly string[] {
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
