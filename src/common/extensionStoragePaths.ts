import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE_STORAGE_DIRNAME = 'workspaceStorage';
const INDEXED_WORKSPACE_SLOT_PATTERN = /^(.*)-([1-9]\d*)$/;
const RECOVERABLE_STATE_RELATIVE_PATHS = [
  'canvas-state.json',
  path.join('runtime-supervisor', 'registry.json'),
  'agent-runtime'
] as const;

export interface ExtensionStoragePathResolution {
  currentPath: string;
  resolvedPath: string;
  recoveryReason?: 'workspace-storage-slot-fallback';
}

export function resolvePreferredExtensionStoragePath(
  currentPath: string,
  options: {
    pathExists?: (candidatePath: string) => boolean;
  } = {}
): ExtensionStoragePathResolution {
  const normalizedCurrentPath = path.normalize(currentPath);
  const pathExists = options.pathExists ?? fs.existsSync;

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

  const match = workspaceSlotName.match(INDEXED_WORKSPACE_SLOT_PATTERN);
  const canonicalWorkspaceSlotName = match?.[1]?.trim();
  if (!canonicalWorkspaceSlotName) {
    return {
      currentPath: normalizedCurrentPath,
      resolvedPath: normalizedCurrentPath
    };
  }

  const candidatePath = path.join(
    workspaceStorageDir,
    canonicalWorkspaceSlotName,
    path.basename(normalizedCurrentPath)
  );
  if (!hasRecoverableState(candidatePath, pathExists)) {
    return {
      currentPath: normalizedCurrentPath,
      resolvedPath: normalizedCurrentPath
    };
  }

  return {
    currentPath: normalizedCurrentPath,
    resolvedPath: candidatePath,
    recoveryReason: 'workspace-storage-slot-fallback'
  };
}

function hasRecoverableState(basePath: string, pathExists: (candidatePath: string) => boolean): boolean {
  return RECOVERABLE_STATE_RELATIVE_PATHS.some((relativePath) => pathExists(path.join(basePath, relativePath)));
}
