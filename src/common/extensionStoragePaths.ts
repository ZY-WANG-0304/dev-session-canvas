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
const BUILTIN_GETTING_STARTED_TITLE = 'Dev Session Canvas \u4f7f\u7528\u6307\u5357';
const BUILTIN_GETTING_STARTED_CONTENT_MARKER =
  '\u8fd9\u4e2a\u6a21\u677f\u4e0d\u4f1a\u81ea\u52a8\u521b\u5efa Agent \u6216 Terminal';
const UNTITLED_WORKSPACE_META_NAME = 'Untitled (Workspace)';
const SNAPSHOT_EXECUTION_PATH_HINT_KEYS = ['cwd', 'runtimeStoragePath', 'resumeStoragePath'] as const;

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

interface WorkspaceStorageMetaLike {
  name?: unknown;
}

export interface ExtensionStoragePathResolution {
  currentPath: string;
  resolvedPath: string;
  recoveryReason?: 'workspace-storage-slot-fallback';
}

export interface ExtensionStorageSnapshotMetadata {
  exists: boolean;
  nodeCount?: number;
  writtenAt?: string;
  stateUpdatedAt?: string;
  effectiveTimestamp?: string;
  effectiveTimestampMs?: number;
  stateHash?: string;
  executionPathHints?: string[];
  executionStorageSlotHints?: string[];
  builtinGettingStartedOnly?: boolean;
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

export interface UntitledMultiRootWorkspaceStorageForkRoot {
  name: string;
  path?: string;
}

export interface UntitledMultiRootWorkspaceStorageForkCandidate {
  path: string;
  slotName: string;
  canonicalSlotName: string;
  slotIndex: number;
  workspaceName?: string;
  rootMatchIndex: number;
  rootMatchName: string;
  rootPathHintIndex: number;
  rootPathHintName: string;
  rootPathHintCount: number;
  rootPathHintMatchedRootIndexes: number[];
  isCurrent: boolean;
  hasRecoverableState: boolean;
  snapshot: ExtensionStorageSnapshotMetadata;
}

export interface UntitledMultiRootWorkspaceStorageForkSelection {
  currentPath: string;
  sourcePath: string;
  selectionBasis: 'first-root-name-match' | 'first-root-path-hint' | 'first-root-canonical-slot-family';
  migrationRequired: boolean;
  sourceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
  evidenceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
  currentCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
  candidates: UntitledMultiRootWorkspaceStorageForkCandidate[];
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

interface ExtensionStoragePathResolutionOptions {
  pathExists?: (candidatePath: string) => boolean;
  listDirectoryEntries?: (directoryPath: string) => readonly string[];
  readTextFile?: (filePath: string) => string;
}

export interface UntitledMultiRootWorkspaceStorageForkOptions extends ExtensionStoragePathResolutionOptions {
  workspaceFolders: readonly UntitledMultiRootWorkspaceStorageForkRoot[];
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

export function selectUntitledMultiRootWorkspaceStorageForkSource(
  currentPath: string,
  options: UntitledMultiRootWorkspaceStorageForkOptions
): UntitledMultiRootWorkspaceStorageForkSelection | undefined {
  const pathModule = resolveExtensionStoragePathModule(currentPath);
  const normalizedCurrentPath = normalizeExtensionStoragePath(currentPath, pathModule);
  const workspaceFolders = options.workspaceFolders
    .map((folder) => ({
      name: normalizeWorkspaceRootName(folder.name),
      path: normalizeWorkspaceRootPath(folder.path, pathModule)
    }))
    .filter((folder) => folder.name || folder.path);
  if (workspaceFolders.length < 2) {
    return undefined;
  }

  const workspaceSlotDir = pathModule.dirname(normalizedCurrentPath);
  const workspaceStorageDir = pathModule.dirname(workspaceSlotDir);
  if (pathModule.basename(workspaceStorageDir) !== WORKSPACE_STORAGE_DIRNAME) {
    return undefined;
  }

  const candidates = collectUntitledMultiRootWorkspaceStorageForkCandidates(
    normalizedCurrentPath,
    workspaceFolders,
    options,
    pathModule
  );
  const currentCandidate = candidates.find((candidate) => candidate.isCurrent);
  if (!currentCandidate || isMeaningfulUntitledMultiRootForkSnapshot(currentCandidate.snapshot)) {
    return undefined;
  }

  const recoverableSourceCandidates = candidates.filter(isRecoverableUntitledMultiRootForkSourceCandidate);
  let sourceSelection = selectUntitledMultiRootForkSourceFromEvidenceCandidates(
    recoverableSourceCandidates.filter((candidate) => candidate.rootMatchIndex === 0),
    recoverableSourceCandidates,
    'first-root-name-match'
  );

  if (!sourceSelection) {
    sourceSelection = selectUntitledMultiRootForkSourceFromEvidenceCandidates(
      recoverableSourceCandidates.filter(isFirstRootPathHintForkSourceCandidate),
      recoverableSourceCandidates,
      'first-root-path-hint'
    );
  }

  if (!sourceSelection) {
    return undefined;
  }

  const { sourceCandidate, evidenceCandidate, selectionBasis } = sourceSelection;
  return {
    currentPath: normalizedCurrentPath,
    sourcePath: sourceCandidate.path,
    selectionBasis,
    migrationRequired: sourceCandidate.path !== currentCandidate.path,
    sourceCandidate,
    evidenceCandidate,
    currentCandidate,
    candidates
  };
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

function collectUntitledMultiRootWorkspaceStorageForkCandidates(
  currentPath: string,
  workspaceFolders: readonly { name: string; path?: string }[],
  options: ExtensionStoragePathResolutionOptions,
  pathModule: PathModuleLike
): UntitledMultiRootWorkspaceStorageForkCandidate[] {
  const normalizedCurrentPath = normalizeExtensionStoragePath(currentPath, pathModule);
  const workspaceSlotDir = pathModule.dirname(normalizedCurrentPath);
  const currentSlotName = pathModule.basename(workspaceSlotDir);
  const currentSlotIdentity = parseWorkspaceStorageSlotName(currentSlotName) ?? {
    name: currentSlotName,
    canonicalName: currentSlotName,
    slotIndex: 0
  };
  const workspaceStorageDir = pathModule.dirname(workspaceSlotDir);
  const extensionStorageDirName = pathModule.basename(normalizedCurrentPath);
  const pathExists = options.pathExists ?? fs.existsSync;
  const listDirectoryEntries = options.listDirectoryEntries ?? listDirectoryNames;
  const readTextFile = options.readTextFile ?? readTextFileSync;
  const candidates: UntitledMultiRootWorkspaceStorageForkCandidate[] = [];

  for (const entryName of safelyListDirectoryEntries(workspaceStorageDir, listDirectoryEntries)) {
    const slotName = entryName.trim();
    if (!slotName) {
      continue;
    }

    const slotStoragePath = pathModule.join(workspaceStorageDir, slotName);
    const slotIdentity = parseWorkspaceStorageSlotName(slotName) ?? {
      name: slotName,
      canonicalName: slotName,
      slotIndex: 0
    };
    const candidatePath = pathModule.join(slotStoragePath, extensionStorageDirName);
    const meta = readWorkspaceStorageMeta(slotStoragePath, {
      pathModule,
      pathExists,
      readTextFile
    });
    const workspaceName = normalizeWorkspaceRootName(meta?.name);
    const rootMatchIndex = workspaceName ? workspaceFolders.findIndex((folder) => folder.name === workspaceName) : -1;
    const snapshot = readPersistedCanvasSnapshotMetadata(candidatePath, {
      pathModule,
      pathExists,
      readTextFile
    });
    const rootPathHint = matchWorkspaceRootPathHints(snapshot.executionPathHints, workspaceFolders, pathModule);
    candidates.push({
      path: normalizeExtensionStoragePath(candidatePath, pathModule),
      slotName: slotIdentity.name,
      canonicalSlotName: slotIdentity.canonicalName,
      slotIndex: slotIdentity.slotIndex,
      workspaceName: workspaceName || undefined,
      rootMatchIndex,
      rootMatchName: rootMatchIndex >= 0 ? workspaceFolders[rootMatchIndex]?.name ?? '' : '',
      rootPathHintIndex: rootPathHint.index,
      rootPathHintName: rootPathHint.name,
      rootPathHintCount: rootPathHint.count,
      rootPathHintMatchedRootIndexes: rootPathHint.matchedRootIndexes,
      isCurrent:
        slotIdentity.name === currentSlotIdentity.name &&
        slotIdentity.slotIndex === currentSlotIdentity.slotIndex,
      hasRecoverableState: hasRecoverableState(candidatePath, pathModule, pathExists),
      snapshot
    });
  }

  if (!candidates.some((candidate) => candidate.isCurrent)) {
    const snapshot = readPersistedCanvasSnapshotMetadata(normalizedCurrentPath, {
      pathModule,
      pathExists,
      readTextFile
    });
    const rootPathHint = matchWorkspaceRootPathHints(snapshot.executionPathHints, workspaceFolders, pathModule);
    candidates.push({
      path: normalizedCurrentPath,
      slotName: currentSlotIdentity.name,
      canonicalSlotName: currentSlotIdentity.canonicalName,
      slotIndex: currentSlotIdentity.slotIndex,
      workspaceName: undefined,
      rootMatchIndex: -1,
      rootMatchName: '',
      rootPathHintIndex: rootPathHint.index,
      rootPathHintName: rootPathHint.name,
      rootPathHintCount: rootPathHint.count,
      rootPathHintMatchedRootIndexes: rootPathHint.matchedRootIndexes,
      isCurrent: true,
      hasRecoverableState: hasRecoverableState(normalizedCurrentPath, pathModule, pathExists),
      snapshot
    });
  }

  return candidates.sort(compareUntitledMultiRootForkCandidatesForDiagnostics);
}

function selectUntitledMultiRootForkSourceFromEvidenceCandidates(
  evidenceCandidates: UntitledMultiRootWorkspaceStorageForkCandidate[],
  recoverableSourceCandidates: UntitledMultiRootWorkspaceStorageForkCandidate[],
  evidenceSelectionBasis: Exclude<
    UntitledMultiRootWorkspaceStorageForkSelection['selectionBasis'],
    'first-root-canonical-slot-family'
  >
): {
  sourceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
  evidenceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
  selectionBasis: UntitledMultiRootWorkspaceStorageForkSelection['selectionBasis'];
} | undefined {
  const selectedByFamily = new Map<
    string,
    {
      sourceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
      evidenceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
    }
  >();

  for (const evidenceCandidate of evidenceCandidates.sort(compareUntitledMultiRootForkCandidates)) {
    const sourceCandidate = selectPreferredUntitledMultiRootForkFamilyCandidate(
      evidenceCandidate,
      recoverableSourceCandidates
    );
    const familyKey = evidenceCandidate.canonicalSlotName;
    const existingSelection = selectedByFamily.get(familyKey);
    const nextSelection = {
      sourceCandidate,
      evidenceCandidate
    };
    if (
      !existingSelection ||
      compareUntitledMultiRootForkSourceSelections(nextSelection, existingSelection) < 0
    ) {
      selectedByFamily.set(familyKey, nextSelection);
    }
  }

  const selected = Array.from(selectedByFamily.values()).sort(compareUntitledMultiRootForkSourceSelections)[0];
  if (!selected) {
    return undefined;
  }

  return {
    ...selected,
    selectionBasis:
      selected.sourceCandidate.path === selected.evidenceCandidate.path
        ? evidenceSelectionBasis
        : 'first-root-canonical-slot-family'
  };
}

function selectPreferredUntitledMultiRootForkFamilyCandidate(
  evidenceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate,
  recoverableSourceCandidates: UntitledMultiRootWorkspaceStorageForkCandidate[]
): UntitledMultiRootWorkspaceStorageForkCandidate {
  // Indexed/copy snapshots can be stale; runtime path hints identify the canonical source slot.
  const familyCandidates = recoverableSourceCandidates
    .filter((candidate) => isUntitledMultiRootForkFamilyCandidate(candidate, evidenceCandidate))
    .sort((left, right) => compareUntitledMultiRootForkFamilyCandidates(left, right, evidenceCandidate));
  return familyCandidates[0] ?? evidenceCandidate;
}

function isUntitledMultiRootForkFamilyCandidate(
  candidate: UntitledMultiRootWorkspaceStorageForkCandidate,
  evidenceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate
): boolean {
  if (candidate.canonicalSlotName === evidenceCandidate.canonicalSlotName) {
    return true;
  }

  const evidenceStorageSlotHints = evidenceCandidate.snapshot.executionStorageSlotHints ?? [];
  return evidenceStorageSlotHints.includes(candidate.canonicalSlotName);
}

function readWorkspaceStorageMeta(
  slotStoragePath: string,
  options: {
    pathModule: PathModuleLike;
    pathExists: (candidatePath: string) => boolean;
    readTextFile: (filePath: string) => string;
  }
): { name?: string } | undefined {
  const metaPath = options.pathModule.join(slotStoragePath, 'meta.json');
  if (!options.pathExists(metaPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(options.readTextFile(metaPath)) as WorkspaceStorageMetaLike;
    if (!isRecord(parsed)) {
      return undefined;
    }

    return {
      name: normalizeWorkspaceRootName(parsed.name) || undefined
    };
  } catch {
    return undefined;
  }
}

function normalizeWorkspaceRootName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorkspaceRootPath(value: unknown, pathModule: PathModuleLike): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  return stripTrailingPathSeparators(pathModule.normalize(trimmedValue), pathModule);
}

function isMeaningfulUntitledMultiRootForkSnapshot(snapshot: ExtensionStorageSnapshotMetadata): boolean {
  if (!snapshot.exists || snapshot.nodeCount === 0) {
    return false;
  }

  if (snapshot.builtinGettingStartedOnly === true) {
    return false;
  }

  return true;
}

function isRecoverableUntitledMultiRootForkSourceCandidate(
  candidate: UntitledMultiRootWorkspaceStorageForkCandidate
): boolean {
  return (
    !candidate.isCurrent &&
    candidate.snapshot.exists &&
    candidate.snapshot.nodeCount !== undefined &&
    candidate.snapshot.nodeCount > 0 &&
    candidate.snapshot.builtinGettingStartedOnly !== true
  );
}

function isFirstRootPathHintForkSourceCandidate(
  candidate: UntitledMultiRootWorkspaceStorageForkCandidate
): boolean {
  return (
    (candidate.rootMatchIndex <= 0 && candidate.workspaceName !== UNTITLED_WORKSPACE_META_NAME) &&
    candidate.rootPathHintIndex === 0 &&
    candidate.rootPathHintMatchedRootIndexes.length === 1 &&
    candidate.rootPathHintMatchedRootIndexes[0] === 0
  );
}

function compareUntitledMultiRootForkCandidates(
  left: UntitledMultiRootWorkspaceStorageForkCandidate,
  right: UntitledMultiRootWorkspaceStorageForkCandidate
): number {
  const rootMatchDifference = left.rootMatchIndex - right.rootMatchIndex;
  if (rootMatchDifference !== 0) {
    return rootMatchDifference;
  }

  const rightTimestamp = right.snapshot.effectiveTimestampMs ?? Number.NEGATIVE_INFINITY;
  const leftTimestamp = left.snapshot.effectiveTimestampMs ?? Number.NEGATIVE_INFINITY;
  if (rightTimestamp !== leftTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return left.slotName.localeCompare(right.slotName);
}

function compareUntitledMultiRootForkFamilyCandidates(
  left: UntitledMultiRootWorkspaceStorageForkCandidate,
  right: UntitledMultiRootWorkspaceStorageForkCandidate,
  evidenceCandidate?: UntitledMultiRootWorkspaceStorageForkCandidate
): number {
  const evidenceStorageSlotHints = evidenceCandidate?.snapshot.executionStorageSlotHints ?? [];
  const leftIsReferencedByEvidence = evidenceStorageSlotHints.includes(left.canonicalSlotName);
  const rightIsReferencedByEvidence = evidenceStorageSlotHints.includes(right.canonicalSlotName);
  if (leftIsReferencedByEvidence !== rightIsReferencedByEvidence) {
    return leftIsReferencedByEvidence ? -1 : 1;
  }

  const slotIndexDifference = left.slotIndex - right.slotIndex;
  if (slotIndexDifference !== 0) {
    return slotIndexDifference;
  }

  return compareUntitledMultiRootForkCandidates(left, right);
}

function compareUntitledMultiRootForkSourceSelections(
  left: {
    sourceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
    evidenceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
  },
  right: {
    sourceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
    evidenceCandidate: UntitledMultiRootWorkspaceStorageForkCandidate;
  }
): number {
  const evidenceDifference = compareUntitledMultiRootForkCandidates(left.evidenceCandidate, right.evidenceCandidate);
  if (evidenceDifference !== 0) {
    return evidenceDifference;
  }

  return compareUntitledMultiRootForkCandidates(left.sourceCandidate, right.sourceCandidate);
}

function compareUntitledMultiRootForkCandidatesForDiagnostics(
  left: UntitledMultiRootWorkspaceStorageForkCandidate,
  right: UntitledMultiRootWorkspaceStorageForkCandidate
): number {
  if (left.isCurrent !== right.isCurrent) {
    return left.isCurrent ? -1 : 1;
  }

  const leftRootMatchIndex = left.rootMatchIndex >= 0 ? left.rootMatchIndex : Number.MAX_SAFE_INTEGER;
  const rightRootMatchIndex = right.rootMatchIndex >= 0 ? right.rootMatchIndex : Number.MAX_SAFE_INTEGER;
  if (leftRootMatchIndex !== rightRootMatchIndex) {
    return leftRootMatchIndex - rightRootMatchIndex;
  }

  return left.slotName.localeCompare(right.slotName);
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
    const stateNodeCount =
      isRecord(parsedSnapshot.state) && Array.isArray(parsedSnapshot.state.nodes)
        ? parsedSnapshot.state.nodes.length
        : undefined;
    const stateUpdatedAt =
      isRecord(parsedSnapshot.state) && typeof parsedSnapshot.state.updatedAt === 'string'
        ? normalizeTimestamp(parsedSnapshot.state.updatedAt)
        : undefined;
    const effectiveTimestamp = writtenAt ?? stateUpdatedAt;
    const executionHints = collectSnapshotExecutionHints(parsedSnapshot.state, options.pathModule);
    return {
      exists: true,
      nodeCount: stateNodeCount,
      writtenAt,
      stateUpdatedAt,
      effectiveTimestamp,
      effectiveTimestampMs: parseTimestampMs(effectiveTimestamp),
      stateHash:
        typeof parsedSnapshot.stateHash === 'string' && parsedSnapshot.stateHash.trim()
          ? parsedSnapshot.stateHash.trim()
          : buildStateHash(parsedSnapshot.state),
      executionPathHints: executionHints.pathHints,
      executionStorageSlotHints: executionHints.storageSlotHints,
      builtinGettingStartedOnly: isBuiltinGettingStartedOnlyCanvasState(parsedSnapshot.state)
    };
  } catch {
    return {
      exists: true
    };
  }
}

function collectSnapshotExecutionHints(
  state: unknown,
  pathModule: PathModuleLike
): {
  pathHints: string[];
  storageSlotHints: string[];
} {
  if (!isRecord(state) || !Array.isArray(state.nodes)) {
    return {
      pathHints: [],
      storageSlotHints: []
    };
  }

  const pathHints = new Set<string>();
  const storageSlotHints = new Set<string>();
  for (const node of state.nodes) {
    if (!isRecord(node) || !isRecord(node.metadata)) {
      continue;
    }

    collectExecutionMetadataHints(node.metadata.agent, pathHints, storageSlotHints, pathModule);
    collectExecutionMetadataHints(node.metadata.terminal, pathHints, storageSlotHints, pathModule);
  }

  return {
    pathHints: Array.from(pathHints).sort(),
    storageSlotHints: Array.from(storageSlotHints).sort()
  };
}

function collectExecutionMetadataHints(
  metadata: unknown,
  pathHints: Set<string>,
  storageSlotHints: Set<string>,
  pathModule: PathModuleLike
): void {
  if (!isRecord(metadata)) {
    return;
  }

  for (const key of SNAPSHOT_EXECUTION_PATH_HINT_KEYS) {
    addExecutionPathHint(metadata[key], pathHints, pathModule);
    if (key !== 'cwd') {
      addExecutionStorageSlotHint(metadata[key], storageSlotHints, pathModule);
    }
  }
}

function addExecutionPathHint(value: unknown, pathHints: Set<string>, pathModule: PathModuleLike): void {
  if (typeof value !== 'string') {
    return;
  }

  const normalizedPath = normalizeWorkspaceRootPath(value, pathModule);
  if (!normalizedPath || !pathModule.isAbsolute(normalizedPath)) {
    return;
  }

  pathHints.add(normalizedPath);
}

function addExecutionStorageSlotHint(
  value: unknown,
  storageSlotHints: Set<string>,
  pathModule: PathModuleLike
): void {
  if (typeof value !== 'string') {
    return;
  }

  const normalizedPath = normalizeWorkspaceRootPath(value, pathModule);
  if (!normalizedPath) {
    return;
  }

  const segments = normalizedPath.split(pathModule.sep).filter(Boolean);
  const workspaceStorageIndex = segments.lastIndexOf(WORKSPACE_STORAGE_DIRNAME);
  const slotName = workspaceStorageIndex >= 0 ? segments[workspaceStorageIndex + 1] : undefined;
  const slotIdentity = slotName ? parseWorkspaceStorageSlotName(slotName) : undefined;
  if (!slotIdentity) {
    return;
  }

  storageSlotHints.add(slotIdentity.canonicalName);
}

function matchWorkspaceRootPathHints(
  pathHints: readonly string[] | undefined,
  workspaceFolders: readonly { name: string; path?: string }[],
  pathModule: PathModuleLike
): { index: number; name: string; count: number; matchedRootIndexes: number[] } {
  const rootMatchCounts = new Map<number, number>();
  for (const pathHint of pathHints ?? []) {
    const matchedRootIndex = findContainingWorkspaceRootIndex(pathHint, workspaceFolders, pathModule);
    if (matchedRootIndex < 0) {
      continue;
    }

    rootMatchCounts.set(matchedRootIndex, (rootMatchCounts.get(matchedRootIndex) ?? 0) + 1);
  }

  const matchedRootIndexes = Array.from(rootMatchCounts.keys()).sort((left, right) => left - right);
  if (matchedRootIndexes.length === 0) {
    return {
      index: -1,
      name: '',
      count: 0,
      matchedRootIndexes
    };
  }

  const firstMatchedRootIndex = matchedRootIndexes[0] ?? -1;
  return {
    index: firstMatchedRootIndex,
    name: firstMatchedRootIndex >= 0 ? workspaceFolders[firstMatchedRootIndex]?.name ?? '' : '',
    count: Array.from(rootMatchCounts.values()).reduce((total, count) => total + count, 0),
    matchedRootIndexes
  };
}

function findContainingWorkspaceRootIndex(
  candidatePath: string,
  workspaceFolders: readonly { path?: string }[],
  pathModule: PathModuleLike
): number {
  const containingRoots = workspaceFolders
    .map((folder, index) => ({
      index,
      path: folder.path
    }))
    .filter((folder): folder is { index: number; path: string } => Boolean(folder.path))
    .filter((folder) => isPathEqualOrInside(candidatePath, folder.path, pathModule))
    .sort((left, right) => right.path.length - left.path.length);

  return containingRoots[0]?.index ?? -1;
}

function isPathEqualOrInside(candidatePath: string, rootPath: string, pathModule: PathModuleLike): boolean {
  const normalizedCandidatePath = stripTrailingPathSeparators(pathModule.normalize(candidatePath), pathModule);
  const normalizedRootPath = stripTrailingPathSeparators(pathModule.normalize(rootPath), pathModule);
  if (normalizedCandidatePath === normalizedRootPath) {
    return true;
  }

  const relativePath = pathModule.relative(normalizedRootPath, normalizedCandidatePath);
  return Boolean(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${pathModule.sep}`);
}

function stripTrailingPathSeparators(candidatePath: string, pathModule: PathModuleLike): string {
  let normalizedPath = candidatePath;
  while (normalizedPath.length > 1 && normalizedPath.endsWith(pathModule.sep)) {
    normalizedPath = normalizedPath.slice(0, -1);
  }
  return normalizedPath;
}

export function isBuiltinGettingStartedOnlyCanvasState(state: unknown): boolean {
  if (!isRecord(state) || !Array.isArray(state.nodes) || state.nodes.length !== 1) {
    return false;
  }

  const node = state.nodes[0];
  if (!isRecord(node) || node.kind !== 'note' || node.title !== BUILTIN_GETTING_STARTED_TITLE) {
    return false;
  }

  const noteMetadata = isRecord(node.metadata) && isRecord(node.metadata.note) ? node.metadata.note : undefined;
  const content = typeof noteMetadata?.content === 'string' ? noteMetadata.content : '';
  return content.includes(BUILTIN_GETTING_STARTED_CONTENT_MARKER);
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
