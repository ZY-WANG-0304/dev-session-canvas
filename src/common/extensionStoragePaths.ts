import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE_STORAGE_DIRNAME = 'workspaceStorage';
const INDEXED_WORKSPACE_SLOT_PATTERN = /^(.*)-([1-9]\d*)$/;
const SNAPSHOT_RELATIVE_PATH = 'canvas-state.json';
const RECOVERABLE_STATE_RELATIVE_PATHS = [
  SNAPSHOT_RELATIVE_PATH,
  path.join('runtime-supervisor', 'registry.json'),
  'agent-runtime'
] as const;

interface WorkspaceStorageSlotIdentity {
  name: string;
  canonicalName: string;
  slotIndex: number;
}

interface PersistedCanvasSnapshotLike {
  version?: unknown;
  writtenAt?: unknown;
  stateHash?: unknown;
  state?: unknown;
  activeSurface?: unknown;
}

export interface ExtensionStoragePathResolution {
  currentPath: string;
  resolvedPath: string;
  recoveryReason?: 'workspace-storage-slot-fallback';
}

export interface ExtensionStorageSnapshotMetadata {
  exists: boolean;
  writtenAt?: string;
  stateUpdatedAt?: string;
  effectiveTimestamp?: string;
  effectiveTimestampMs?: number;
  stateHash?: string;
}

export interface ExtensionStorageSlotCandidate {
  path: string;
  slotName: string;
  canonicalSlotName: string;
  slotIndex: number;
  isCurrent: boolean;
  hasRecoverableState: boolean;
  snapshot: ExtensionStorageSnapshotMetadata;
}

export interface ExtensionStorageRecoverySourceSelection {
  currentPath: string;
  writePath: string;
  sourcePath: string;
  recoveryReason?: 'workspace-storage-slot-fallback';
  selectionBasis: 'current-slot' | 'freshest-snapshot' | 'recoverable-state-fallback';
  migrationRequired: boolean;
  currentCandidate: ExtensionStorageSlotCandidate;
  sourceCandidate: ExtensionStorageSlotCandidate;
  candidates: ExtensionStorageSlotCandidate[];
}

export interface RegisteredSingleFolderStorageSlot {
  folderPath: string;
  storagePath: string;
  recordedAt?: string;
  snapshot: ExtensionStorageSnapshotMetadata;
}

export interface SelectSingleFolderForkSourceOptions {
  workspaceFolderPaths: readonly string[];
  currentStorage: ExtensionStorageRecoverySourceSelection;
  currentWorkspaceStateAvailable?: boolean;
  registeredSlots: readonly RegisteredSingleFolderStorageSlot[];
}

interface ExtensionStoragePathResolutionOptions {
  pathExists?: (candidatePath: string) => boolean;
  listDirectoryEntries?: (directoryPath: string) => readonly string[];
  readTextFile?: (filePath: string) => string;
  recordedAt?: string;
}

type PathModuleLike = typeof path.posix | typeof path.win32;

export function resolvePreferredExtensionStoragePath(
  currentPath: string,
  options: ExtensionStoragePathResolutionOptions = {}
): ExtensionStoragePathResolution {
  const selection = selectPreferredExtensionStorageRecoverySource(currentPath, options);
  return {
    currentPath: selection.currentPath,
    resolvedPath: selection.sourcePath,
    recoveryReason: selection.recoveryReason
  };
}

export function selectPreferredExtensionStorageRecoverySource(
  currentPath: string,
  options: ExtensionStoragePathResolutionOptions = {}
): ExtensionStorageRecoverySourceSelection {
  const pathModule = resolveExtensionStoragePathModule(currentPath);
  const candidates = collectExtensionStorageSlotCandidates(currentPath, options);
  const normalizedCurrentPath = normalizeExtensionStoragePath(currentPath, pathModule);
  const currentCandidate =
    candidates.find((candidate) => candidate.isCurrent) ?? createStandaloneCurrentCandidate(normalizedCurrentPath, options);
  const recoverableCandidates = candidates.filter((candidate) => candidate.hasRecoverableState);
  const recoverableCandidatesByFreshness = recoverableCandidates
    .filter((candidate) => candidate.snapshot.effectiveTimestampMs !== undefined)
    .sort((left, right) => compareCandidatesByFreshness(left, right, currentCandidate));

  let selectedCandidate = currentCandidate;
  let selectionBasis: ExtensionStorageRecoverySourceSelection['selectionBasis'] = 'current-slot';

  if (recoverableCandidatesByFreshness.length > 0) {
    const freshestCandidate = recoverableCandidatesByFreshness[0];
    const currentHasComparableSnapshot = currentCandidate.snapshot.effectiveTimestampMs !== undefined;
    const currentHasSnapshotFile = currentCandidate.snapshot.exists;

    if (freshestCandidate.path === currentCandidate.path) {
      selectedCandidate = currentCandidate;
      selectionBasis = 'current-slot';
    } else if (!currentCandidate.hasRecoverableState) {
      selectedCandidate = freshestCandidate;
      selectionBasis = 'freshest-snapshot';
    } else if (currentHasComparableSnapshot) {
      selectedCandidate = freshestCandidate;
      selectionBasis = 'freshest-snapshot';
    } else if (!currentHasSnapshotFile) {
      selectedCandidate = freshestCandidate;
      selectionBasis = 'freshest-snapshot';
    }
  }

  if (
    selectedCandidate.path === currentCandidate.path &&
    !currentCandidate.hasRecoverableState &&
    recoverableCandidates.length > 0
  ) {
    selectedCandidate = recoverableCandidates
      .slice()
      .sort((left, right) => compareCandidatesByFallbackPreference(left, right, currentCandidate))[0];
    selectionBasis =
      selectedCandidate.path === currentCandidate.path ? 'current-slot' : 'recoverable-state-fallback';
  }

  return {
    currentPath: normalizedCurrentPath,
    writePath: normalizedCurrentPath,
    sourcePath: selectedCandidate.path,
    recoveryReason:
      selectedCandidate.path === currentCandidate.path ? undefined : 'workspace-storage-slot-fallback',
    selectionBasis,
    migrationRequired: selectedCandidate.path !== currentCandidate.path,
    currentCandidate,
    sourceCandidate: selectedCandidate,
    candidates
  };
}

export function createRegisteredSingleFolderStorageSlot(
  folderPath: string,
  storagePath: string,
  options: ExtensionStoragePathResolutionOptions = {}
): RegisteredSingleFolderStorageSlot | undefined {
  const pathModule = resolveExtensionStoragePathModule(storagePath);
  const normalizedFolderPath = normalizeWorkspaceFolderPathForStorageFork(folderPath);
  const normalizedStoragePath = normalizeExtensionStoragePath(storagePath, pathModule);
  if (!normalizedFolderPath || !normalizedStoragePath) {
    return undefined;
  }

  const hasRecordedAtOption = Object.prototype.hasOwnProperty.call(options, 'recordedAt');
  const recordedAt = hasRecordedAtOption
    ? normalizeTimestamp(options.recordedAt)
    : new Date().toISOString();

  return {
    folderPath: normalizedFolderPath,
    storagePath: normalizedStoragePath,
    ...(recordedAt ? { recordedAt } : {}),
    snapshot: readPersistedCanvasSnapshotMetadata(normalizedStoragePath, {
      pathModule,
      pathExists: options.pathExists ?? fs.existsSync,
      readTextFile: options.readTextFile ?? readTextFileSync
    })
  };
}

export function selectSingleFolderForkSourceForWorkspace(
  options: SelectSingleFolderForkSourceOptions
): RegisteredSingleFolderStorageSlot | undefined {
  if (
    options.workspaceFolderPaths.length <= 1 ||
    options.currentWorkspaceStateAvailable === true ||
    currentStorageHasRecoverableState(options.currentStorage)
  ) {
    return undefined;
  }

  const currentStoragePath = normalizeStoragePathForForkComparison(options.currentStorage.writePath);
  const workspaceFolderKeys = new Set(
    options.workspaceFolderPaths
      .map((folderPath) => normalizeWorkspaceFolderPathForStorageFork(folderPath))
      .filter((folderPath): folderPath is string => Boolean(folderPath))
  );
  const candidates = options.registeredSlots.filter((slot) => {
    const folderKey = normalizeWorkspaceFolderPathForStorageFork(slot.folderPath);
    const storageKey = normalizeStoragePathForForkComparison(slot.storagePath);
    return (
      folderKey !== undefined &&
      storageKey !== '' &&
      workspaceFolderKeys.has(folderKey) &&
      storageKey !== currentStoragePath &&
      slot.snapshot.exists
    );
  });
  if (candidates.length === 0) {
    return undefined;
  }

  const candidatesWithComparableRecordedAt = candidates.filter((candidate) =>
    parseTimestampMs(candidate.recordedAt) !== undefined
  );
  if (candidatesWithComparableRecordedAt.length !== candidates.length) {
    return undefined;
  }

  const sortedCandidates = candidatesWithComparableRecordedAt.slice().sort((left, right) => {
    const rightRecordedAt = parseTimestampMs(right.recordedAt) ?? Number.NEGATIVE_INFINITY;
    const leftRecordedAt = parseTimestampMs(left.recordedAt) ?? Number.NEGATIVE_INFINITY;
    if (rightRecordedAt !== leftRecordedAt) {
      return rightRecordedAt - leftRecordedAt;
    }

    return normalizeStoragePathForForkComparison(left.storagePath).localeCompare(
      normalizeStoragePathForForkComparison(right.storagePath)
    );
  });

  const first = sortedCandidates[0];
  const second = sortedCandidates[1];
  if (
    first &&
    second &&
    parseTimestampMs(first.recordedAt) === parseTimestampMs(second.recordedAt)
  ) {
    return undefined;
  }

  if (first?.snapshot.effectiveTimestampMs === undefined) {
    return undefined;
  }

  return first;
}

export function collectExtensionStorageSlotCandidates(
  currentPath: string,
  options: ExtensionStoragePathResolutionOptions = {}
): ExtensionStorageSlotCandidate[] {
  const pathModule = resolveExtensionStoragePathModule(currentPath);
  const normalizedCurrentPath = normalizeExtensionStoragePath(currentPath, pathModule);
  const pathExists = options.pathExists ?? fs.existsSync;
  const listDirectoryEntries = options.listDirectoryEntries ?? listDirectoryNames;
  const readTextFile = options.readTextFile ?? readTextFileSync;

  const workspaceSlotDir = pathModule.dirname(normalizedCurrentPath);
  const workspaceSlotName = pathModule.basename(workspaceSlotDir);
  const workspaceStorageDir = pathModule.dirname(workspaceSlotDir);
  const currentWorkspaceSlot = parseWorkspaceStorageSlotName(workspaceSlotName);
  if (
    pathModule.basename(workspaceStorageDir) !== WORKSPACE_STORAGE_DIRNAME ||
    currentWorkspaceSlot === undefined
  ) {
    return [createStandaloneCurrentCandidate(normalizedCurrentPath, options)];
  }

  const slotCandidates = new Map<string, WorkspaceStorageSlotIdentity>();
  slotCandidates.set(currentWorkspaceSlot.name, currentWorkspaceSlot);

  if (currentWorkspaceSlot.slotIndex !== 0) {
    const canonicalWorkspaceSlot = parseWorkspaceStorageSlotName(currentWorkspaceSlot.canonicalName);
    if (canonicalWorkspaceSlot) {
      slotCandidates.set(canonicalWorkspaceSlot.name, canonicalWorkspaceSlot);
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
    slotCandidates.set(candidateWorkspaceSlot.name, candidateWorkspaceSlot);
  }

  const extensionStorageDirName = pathModule.basename(normalizedCurrentPath);
  return Array.from(slotCandidates.values())
    .map((slotIdentity) => {
      const candidatePath = pathModule.join(workspaceStorageDir, slotIdentity.name, extensionStorageDirName);
      return buildSlotCandidate(candidatePath, slotIdentity, currentWorkspaceSlot, {
        pathModule,
        pathExists,
        readTextFile
      });
    })
    .sort((left, right) => compareCandidatesByEnumerationOrder(left, right, currentWorkspaceSlot.slotIndex));
}

function createStandaloneCurrentCandidate(
  currentPath: string,
  options: ExtensionStoragePathResolutionOptions
): ExtensionStorageSlotCandidate {
  const pathModule = resolveExtensionStoragePathModule(currentPath);
  const pathExists = options.pathExists ?? fs.existsSync;
  const readTextFile = options.readTextFile ?? readTextFileSync;
  const slotName = pathModule.basename(pathModule.dirname(currentPath));
  const slotIdentity = parseWorkspaceStorageSlotName(slotName) ?? {
    name: slotName,
    canonicalName: slotName,
    slotIndex: 0
  };
  return buildSlotCandidate(currentPath, slotIdentity, slotIdentity, {
    pathModule,
    pathExists,
    readTextFile
  });
}

function buildSlotCandidate(
  candidatePath: string,
  slotIdentity: WorkspaceStorageSlotIdentity,
  currentWorkspaceSlot: WorkspaceStorageSlotIdentity,
  options: {
    pathModule: PathModuleLike;
    pathExists: (candidatePath: string) => boolean;
    readTextFile: (filePath: string) => string;
  }
): ExtensionStorageSlotCandidate {
  return {
    path: normalizeExtensionStoragePath(candidatePath, options.pathModule),
    slotName: slotIdentity.name,
    canonicalSlotName: slotIdentity.canonicalName,
    slotIndex: slotIdentity.slotIndex,
    isCurrent:
      slotIdentity.name === currentWorkspaceSlot.name &&
      slotIdentity.slotIndex === currentWorkspaceSlot.slotIndex,
    hasRecoverableState: hasRecoverableState(candidatePath, options.pathModule, options.pathExists),
    snapshot: readPersistedCanvasSnapshotMetadata(candidatePath, options)
  };
}

function readPersistedCanvasSnapshotMetadata(
  basePath: string,
  options: {
    pathModule: PathModuleLike;
    pathExists: (candidatePath: string) => boolean;
    readTextFile: (filePath: string) => string;
  }
): ExtensionStorageSnapshotMetadata {
  const snapshotPath = options.pathModule.join(basePath, SNAPSHOT_RELATIVE_PATH);
  if (!options.pathExists(snapshotPath)) {
    return {
      exists: false
    };
  }

  try {
    const rawSnapshot = options.readTextFile(snapshotPath);
    const parsedSnapshot = JSON.parse(rawSnapshot) as PersistedCanvasSnapshotLike;
    if (!parsedSnapshot || typeof parsedSnapshot !== 'object') {
      return {
        exists: true
      };
    }

    const writtenAt = normalizeTimestamp(parsedSnapshot.writtenAt);
    const stateUpdatedAt =
      isRecord(parsedSnapshot.state) && typeof parsedSnapshot.state.updatedAt === 'string'
        ? normalizeTimestamp(parsedSnapshot.state.updatedAt)
        : undefined;
    const effectiveTimestamp = writtenAt ?? stateUpdatedAt;
    return {
      exists: true,
      writtenAt,
      stateUpdatedAt,
      effectiveTimestamp,
      effectiveTimestampMs: parseTimestampMs(effectiveTimestamp),
      stateHash:
        typeof parsedSnapshot.stateHash === 'string' && parsedSnapshot.stateHash.trim()
          ? parsedSnapshot.stateHash.trim()
          : buildStateHash(parsedSnapshot.state)
    };
  } catch {
    return {
      exists: true
    };
  }
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

function compareCandidatesByEnumerationOrder(
  left: ExtensionStorageSlotCandidate,
  right: ExtensionStorageSlotCandidate,
  currentSlotIndex: number
): number {
  if (left.isCurrent !== right.isCurrent) {
    return left.isCurrent ? -1 : 1;
  }

  const distanceDifference =
    Math.abs(left.slotIndex - currentSlotIndex) - Math.abs(right.slotIndex - currentSlotIndex);
  if (distanceDifference !== 0) {
    return distanceDifference;
  }

  const slotIndexDifference = left.slotIndex - right.slotIndex;
  if (slotIndexDifference !== 0) {
    return slotIndexDifference;
  }

  return left.slotName.localeCompare(right.slotName);
}

function compareCandidatesByFreshness(
  left: ExtensionStorageSlotCandidate,
  right: ExtensionStorageSlotCandidate,
  currentCandidate: ExtensionStorageSlotCandidate
): number {
  const rightTimestamp = right.snapshot.effectiveTimestampMs ?? Number.NEGATIVE_INFINITY;
  const leftTimestamp = left.snapshot.effectiveTimestampMs ?? Number.NEGATIVE_INFINITY;
  if (rightTimestamp !== leftTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  if (left.path === currentCandidate.path || right.path === currentCandidate.path) {
    if (left.path === currentCandidate.path && right.path !== currentCandidate.path) {
      return -1;
    }
    if (right.path === currentCandidate.path && left.path !== currentCandidate.path) {
      return 1;
    }
  }

  return compareCandidatesByFallbackPreference(left, right, currentCandidate);
}

function compareCandidatesByFallbackPreference(
  left: ExtensionStorageSlotCandidate,
  right: ExtensionStorageSlotCandidate,
  currentCandidate: ExtensionStorageSlotCandidate
): number {
  if (left.path === currentCandidate.path || right.path === currentCandidate.path) {
    if (left.path === currentCandidate.path && right.path !== currentCandidate.path) {
      return -1;
    }
    if (right.path === currentCandidate.path && left.path !== currentCandidate.path) {
      return 1;
    }
  }

  const distanceDifference =
    Math.abs(left.slotIndex - currentCandidate.slotIndex) -
    Math.abs(right.slotIndex - currentCandidate.slotIndex);
  if (distanceDifference !== 0) {
    return distanceDifference;
  }

  const slotIndexDifference = left.slotIndex - right.slotIndex;
  if (slotIndexDifference !== 0) {
    return slotIndexDifference;
  }

  return left.slotName.localeCompare(right.slotName);
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

function hasRecoverableState(
  basePath: string,
  pathModule: PathModuleLike,
  pathExists: (candidatePath: string) => boolean
): boolean {
  return RECOVERABLE_STATE_RELATIVE_PATHS.some((relativePath) => pathExists(pathModule.join(basePath, relativePath)));
}

function currentStorageHasRecoverableState(selection: ExtensionStorageRecoverySourceSelection): boolean {
  return selection.currentCandidate.hasRecoverableState || selection.sourceCandidate.hasRecoverableState;
}

function normalizeWorkspaceFolderPathForStorageFork(folderPath: string): string | undefined {
  const trimmedPath = folderPath.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const pathModule = resolveExtensionStoragePathModule(trimmedPath);
  const normalizedPath = pathModule.resolve(trimmedPath);
  return pathModule === path.win32 ? normalizedPath.toLowerCase() : normalizedPath;
}

function normalizeStoragePathForForkComparison(storagePath: string): string {
  const pathModule = resolveExtensionStoragePathModule(storagePath);
  const normalizedPath = normalizeExtensionStoragePath(storagePath, pathModule);
  return pathModule === path.win32 ? normalizedPath.toLowerCase() : normalizedPath;
}

function resolveExtensionStoragePathModule(candidatePath: string): PathModuleLike {
  const normalizedCandidatePath = candidatePath.trim();
  if (
    normalizedCandidatePath.startsWith('\\') ||
    /^[A-Za-z]:/u.test(normalizedCandidatePath) ||
    normalizedCandidatePath.includes('\\')
  ) {
    return path.win32;
  }
  if (normalizedCandidatePath.startsWith('/') || normalizedCandidatePath.includes('/')) {
    return path.posix;
  }
  return process.platform === 'win32' ? path.win32 : path.posix;
}

function normalizeExtensionStoragePath(candidatePath: string, pathModule: PathModuleLike): string {
  return pathModule.normalize(candidatePath);
}

function listDirectoryNames(directoryPath: string): readonly string[] {
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function readTextFileSync(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  return Number.isFinite(Date.parse(trimmedValue)) ? trimmedValue : undefined;
}

function parseTimestampMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

function buildStateHash(state: unknown): string | undefined {
  try {
    return createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
