import * as fs from 'fs';
import * as path from 'path';

export interface ExecutionImagePasteCacheCleanupOptions {
  cacheRootPath: string;
  shouldDeleteFile: (params: {
    fileName: string;
    mtimeMs: number;
    nowMs: number;
  }) => { shouldDelete: boolean };
  nowMs?: number;
  maxFilesDeleted?: number;
  maxEntriesScanned?: number;
  maxDurationMs?: number;
}

export interface ExecutionImagePasteCacheCleanupResult {
  cacheRootExists: boolean;
  scannedEntries: number;
  scannedDirectories: number;
  deletedFiles: number;
  deletedBytes: number;
  failedDeletes: number;
  retainedFiles: number;
  budgetExhausted: boolean;
  errors: string[];
}

export function cleanupExecutionImagePasteCache(
  options: ExecutionImagePasteCacheCleanupOptions
): ExecutionImagePasteCacheCleanupResult {
  const cacheRootPath = path.resolve(options.cacheRootPath);
  const nowMs = options.nowMs ?? Date.now();
  const maxFilesDeleted = options.maxFilesDeleted ?? 50;
  const maxEntriesScanned = options.maxEntriesScanned ?? 500;
  const maxDurationMs = options.maxDurationMs ?? 150;
  const startedAtMs = Date.now();
  const result: ExecutionImagePasteCacheCleanupResult = {
    cacheRootExists: false,
    scannedEntries: 0,
    scannedDirectories: 0,
    deletedFiles: 0,
    deletedBytes: 0,
    failedDeletes: 0,
    retainedFiles: 0,
    budgetExhausted: false,
    errors: []
  };

  if (!fs.existsSync(cacheRootPath)) {
    return result;
  }
  result.cacheRootExists = true;

  const pendingDirectories = [cacheRootPath];
  while (pendingDirectories.length > 0) {
    if (isExecutionImagePasteCacheCleanupBudgetExhausted(result, {
      startedAtMs,
      maxDurationMs,
      maxEntriesScanned,
      maxFilesDeleted
    })) {
      result.budgetExhausted = true;
      break;
    }

    const directoryPath = pendingDirectories.shift();
    if (!directoryPath) {
      break;
    }
    result.scannedDirectories += 1;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch (error) {
      pushExecutionImagePasteCacheCleanupError(result, directoryPath, error);
      continue;
    }

    for (const entry of entries) {
      if (isExecutionImagePasteCacheCleanupBudgetExhausted(result, {
        startedAtMs,
        maxDurationMs,
        maxEntriesScanned,
        maxFilesDeleted
      })) {
        result.budgetExhausted = true;
        break;
      }

      result.scannedEntries += 1;
      const entryPath = path.join(directoryPath, entry.name);
      if (!isPathInsideExecutionImagePasteCacheRoot(cacheRootPath, entryPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(entryPath);
      } catch (error) {
        pushExecutionImagePasteCacheCleanupError(result, entryPath, error);
        continue;
      }

      const decision = options.shouldDeleteFile({
        fileName: entry.name,
        mtimeMs: stat.mtimeMs,
        nowMs
      });

      if (!decision.shouldDelete) {
        result.retainedFiles += 1;
        continue;
      }

      try {
        fs.rmSync(entryPath, { force: true });
        result.deletedFiles += 1;
        result.deletedBytes += stat.size;
      } catch (error) {
        result.failedDeletes += 1;
        pushExecutionImagePasteCacheCleanupError(result, entryPath, error);
      }
    }
  }

  return result;
}

function isExecutionImagePasteCacheCleanupBudgetExhausted(
  result: Pick<ExecutionImagePasteCacheCleanupResult, 'scannedEntries' | 'deletedFiles'>,
  limits: {
    startedAtMs: number;
    maxDurationMs: number;
    maxEntriesScanned: number;
    maxFilesDeleted: number;
  }
): boolean {
  return (
    result.deletedFiles >= limits.maxFilesDeleted ||
    result.scannedEntries >= limits.maxEntriesScanned ||
    Date.now() - limits.startedAtMs >= limits.maxDurationMs
  );
}

function isPathInsideExecutionImagePasteCacheRoot(cacheRootPath: string, candidatePath: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === cacheRootPath || resolvedCandidate.startsWith(`${cacheRootPath}${path.sep}`);
}

function pushExecutionImagePasteCacheCleanupError(
  result: Pick<ExecutionImagePasteCacheCleanupResult, 'errors'>,
  targetPath: string,
  error: unknown
): void {
  if (result.errors.length >= 5) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(`${targetPath}: ${message}`);
}
