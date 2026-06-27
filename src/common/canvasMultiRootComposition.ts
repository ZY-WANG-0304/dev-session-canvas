import { createHash } from 'crypto';
import * as path from 'path';

import type {
  CanvasEdgeSummary,
  CanvasFileReferenceSummary,
  CanvasGroupSummary,
  CanvasNodeFootprint,
  CanvasNodePosition,
  CanvasNodeSummary,
  CanvasPrototypeState
} from './protocol';

const ROOT_NAMESPACE_PREFIX = 'workspace-root';
const ROOT_SECTION_CONTENT_INSET = 80;
const ROOT_SECTION_MIN_WIDTH = 720;
const ROOT_SECTION_MIN_HEIGHT = 520;
const ROOT_SECTION_HORIZONTAL_GAP = 220;
const ROOT_SECTION_VERTICAL_GAP = 160;
const ROOT_SECTION_COLUMNS = 2;
const OVERLAY_GROUP_MIN_WIDTH = 180;
const OVERLAY_GROUP_MIN_HEIGHT = 96;

export interface CanvasMultiRootWorkspaceFolder {
  name: string;
  path: string;
}

export interface CanvasMultiRootOverlayRoot {
  rootPath: string;
  position: CanvasNodePosition;
  size?: CanvasNodeFootprint;
  parentGroupId?: string;
}

export interface CanvasMultiRootOverlayGroup {
  id: string;
  title: string;
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
  parentGroupId?: string;
}

export interface CanvasMultiRootOverlay {
  version: 1;
  roots: CanvasMultiRootOverlayRoot[];
  groups?: CanvasMultiRootOverlayGroup[];
}

export interface CanvasRootLocalStateSnapshot {
  rootPath: string;
  state: CanvasPrototypeState;
}

export interface CanvasNamespacedObjectIdParts {
  namespaceId: string;
  localId: string;
}

export interface ComposeMultiRootCanvasStateOptions {
  workspaceFolders: readonly CanvasMultiRootWorkspaceFolder[];
  rootStates: readonly CanvasRootLocalStateSnapshot[];
  overlay?: CanvasMultiRootOverlay;
  newRootPlacement?: CanvasMultiRootNewRootPlacement;
  now?: string;
}

export interface CanvasMultiRootNewRootPlacement {
  rootPaths: readonly string[];
  preferredCenter?: CanvasNodePosition;
}

export interface DecomposeMultiRootCanvasStateOptions {
  composedState: CanvasPrototypeState;
  workspaceFolders: readonly CanvasMultiRootWorkspaceFolder[];
  previousRootStates: readonly CanvasRootLocalStateSnapshot[];
  now?: string;
}

export interface DecomposeMultiRootCanvasStateResult {
  rootStates: CanvasRootLocalStateSnapshot[];
  overlay: CanvasMultiRootOverlay;
}

interface RootCompositionContext {
  folder: CanvasMultiRootWorkspaceFolder;
  rootId: string;
  groupId: string;
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
  state: CanvasPrototypeState;
}

interface CanvasRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RootSectionMeasurement {
  folder: CanvasMultiRootWorkspaceFolder;
  rootId: string;
  groupId: string;
  size: CanvasNodeFootprint;
  state: CanvasPrototypeState;
  overlayRoot?: CanvasMultiRootOverlayRoot;
}

export function createWorkspaceRootSectionId(rootPath: string): string {
  return `${ROOT_NAMESPACE_PREFIX}-${hashWorkspaceRootPath(rootPath)}`;
}

export function namespaceCanvasObjectId(rootPath: string, objectId: string): string {
  return `${createWorkspaceRootSectionId(rootPath)}:${objectId}`;
}

export function denamespaceCanvasObjectId(rootPath: string, objectId: string): string | undefined {
  const prefix = `${createWorkspaceRootSectionId(rootPath)}:`;
  return objectId.startsWith(prefix) ? objectId.slice(prefix.length) : undefined;
}

export function splitNamespacedCanvasObjectId(objectId: string): CanvasNamespacedObjectIdParts | undefined {
  const separatorIndex = objectId.indexOf(':');
  if (separatorIndex <= 0) {
    return undefined;
  }

  const namespaceId = objectId.slice(0, separatorIndex);
  const localId = objectId.slice(separatorIndex + 1);
  if (!namespaceId.startsWith(`${ROOT_NAMESPACE_PREFIX}-`) || !localId) {
    return undefined;
  }

  return { namespaceId, localId };
}

export function isWorkspaceRootGroup(group: Pick<CanvasGroupSummary, 'role'> | undefined): boolean {
  return group?.role === 'workspace-root';
}

export function resolveWorkspaceRootPathForGroup(group: Pick<CanvasGroupSummary, 'workspaceRootPath'>): string | undefined {
  return normalizeRootPath(group.workspaceRootPath);
}

export function getWorkspaceRootSectionContentInset(): number {
  return ROOT_SECTION_CONTENT_INSET;
}

export function translateRootLocalCanvasPositionToComposed(
  position: CanvasNodePosition,
  rootGroup: Pick<CanvasGroupSummary, 'position'>
): CanvasNodePosition {
  return translatePosition(position, rootGroup.position, ROOT_SECTION_CONTENT_INSET);
}

export function translateComposedCanvasPositionToRootLocal(
  position: CanvasNodePosition,
  rootGroup: Pick<CanvasGroupSummary, 'position'>
): CanvasNodePosition {
  return subtractRootOffset(position, rootGroup.position);
}

export function composeRootLocalCanvasStateIntoComposed(
  composedState: CanvasPrototypeState,
  rootLocalState: CanvasPrototypeState,
  rootGroup: CanvasGroupSummary
): CanvasPrototypeState {
  const rootPath = resolveWorkspaceRootPathForGroup(rootGroup);
  if (!rootPath) {
    return cloneState(composedState);
  }
  const safeRootLocalState = sanitizeRootLocalCanvasState(rootPath, rootLocalState);

  const namespacedNodes = safeRootLocalState.nodes.map((node) => ({
    ...node,
    id: namespaceCanvasObjectId(rootPath, node.id),
    position: translateRootLocalCanvasPositionToComposed(node.position, rootGroup),
    groupId: node.groupId ? namespaceCanvasObjectId(rootPath, node.groupId) : rootGroup.id,
    metadata: cloneJsonValue(node.metadata)
  }));
  const namespacedGroups = (safeRootLocalState.groups ?? []).map((group) => ({
    ...group,
    id: namespaceCanvasObjectId(rootPath, group.id),
    position: translateRootLocalCanvasPositionToComposed(group.position, rootGroup),
    parentGroupId: group.parentGroupId ? namespaceCanvasObjectId(rootPath, group.parentGroupId) : rootGroup.id,
    role: undefined,
    workspaceRootPath: undefined
  }));
  const rootNodeIds = new Set(safeRootLocalState.nodes.map((node) => node.id));
  const namespacedEdges = (safeRootLocalState.edges ?? [])
    .filter((edge) => rootNodeIds.has(edge.sourceNodeId) && rootNodeIds.has(edge.targetNodeId))
    .map((edge) => ({
      ...edge,
      id: namespaceCanvasObjectId(rootPath, edge.id),
      sourceNodeId: namespaceCanvasObjectId(rootPath, edge.sourceNodeId),
      targetNodeId: namespaceCanvasObjectId(rootPath, edge.targetNodeId)
    }));
  const namespacedFileReferences = (safeRootLocalState.fileReferences ?? [])
    .map((reference) => ({
      ...reference,
      id: namespaceCanvasObjectId(rootPath, reference.id),
      owners: reference.owners
        .filter((owner) => rootNodeIds.has(owner.nodeId))
        .map((owner) => ({
          ...owner,
          nodeId: namespaceCanvasObjectId(rootPath, owner.nodeId)
        }))
    }))
    .filter((reference) => reference.owners.length > 0);

  const currentRootNodeIds = collectWorkspaceRootOwnedNodeIds(
    composedState,
    rootPath,
    rootGroup.id
  );

  return {
    ...composedState,
    updatedAt: safeRootLocalState.updatedAt,
    nodes: [
      ...composedState.nodes.filter((node) => !currentRootNodeIds.has(node.id)),
      ...namespacedNodes
    ],
    groups: [
      ...(composedState.groups ?? []).filter((group) =>
        (isWorkspaceRootGroup(group) && group.id !== rootGroup.id) ||
        (!isWorkspaceRootGroup(group) && !isGroupOwnedByWorkspaceRoot(composedState.groups ?? [], group, rootPath, rootGroup.id))
      ),
      rootGroup,
      ...namespacedGroups
    ],
    edges: [
      ...(composedState.edges ?? []).filter((edge) =>
        !currentRootNodeIds.has(edge.sourceNodeId) && !currentRootNodeIds.has(edge.targetNodeId)
      ),
      ...namespacedEdges
    ],
    nextGroupSequence: Math.max(composedState.nextGroupSequence ?? 1, safeRootLocalState.nextGroupSequence ?? 1),
    fileReferences: [
      ...(composedState.fileReferences ?? []).filter((reference) =>
        !reference.owners.some((owner) => currentRootNodeIds.has(owner.nodeId))
      ),
      ...namespacedFileReferences
    ],
    suppressedFileActivityEdgeIds: uniqueStrings([
      ...(composedState.suppressedFileActivityEdgeIds ?? []).filter(
        (edgeId) => !isFileActivityArtifactObjectOwnedByWorkspaceRoot(rootPath, rootGroup.id, edgeId)
      ),
      ...(safeRootLocalState.suppressedFileActivityEdgeIds ?? []).map((edgeId) => namespaceCanvasObjectId(rootPath, edgeId))
    ]),
    suppressedAutomaticFileArtifactNodeIds: uniqueStrings([
      ...(composedState.suppressedAutomaticFileArtifactNodeIds ?? []).filter(
        (nodeId) => !isFileActivityArtifactObjectOwnedByWorkspaceRoot(rootPath, rootGroup.id, nodeId)
      ),
      ...(safeRootLocalState.suppressedAutomaticFileArtifactNodeIds ?? []).map((nodeId) => namespaceCanvasObjectId(rootPath, nodeId))
    ])
  };
}

export function decomposeComposedCanvasStateForWorkspaceRoot(
  composedState: CanvasPrototypeState,
  rootGroup: CanvasGroupSummary,
  now = new Date().toISOString()
): CanvasPrototypeState {
  const rootPath = resolveWorkspaceRootPathForGroup(rootGroup);
  if (!rootPath) {
    return cloneState(composedState);
  }

  return decomposeRootState({
    composedState,
    folder: {
      name: path.basename(rootPath) || rootPath,
      path: rootPath
    },
    previousState: createEmptyCanvasState(now),
    rootGroupId: rootGroup.id,
    rootPosition: roundPosition(rootGroup.position),
    now
  });
}

export function composeMultiRootCanvasState(options: ComposeMultiRootCanvasStateOptions): CanvasPrototypeState {
  const folders = normalizeWorkspaceFolders(options.workspaceFolders);
  if (folders.length === 0) {
    return createEmptyCanvasState(options.now);
  }

  const stateByRootPath = new Map<string, CanvasPrototypeState>();
  for (const entry of options.rootStates) {
    const rootPath = normalizeRootPath(entry.rootPath);
    if (rootPath) {
      stateByRootPath.set(rootPath, entry.state);
    }
  }

  const rootMeasurements = folders.map((folder) => {
    const state = sanitizeRootLocalCanvasState(
      folder.path,
      cloneState(stateByRootPath.get(folder.path) ?? createEmptyCanvasState(options.now)),
      options.now
    );
    const rootId = createWorkspaceRootSectionId(folder.path);
    const overlayRoot = options.overlay?.roots.find((root) => normalizeRootPath(root.rootPath) === folder.path);
    const naturalSize = measureRootSectionSize(state);
    const size = normalizeRootSectionSize(maxRootSectionSize(overlayRoot?.size, naturalSize));
    return {
      folder,
      rootId,
      groupId: rootId,
      size,
      state,
      overlayRoot
    };
  });
  const defaultGridSize = rootMeasurements.reduce(
    (current, measurement) => ({
      width: Math.max(current.width, measurement.size.width),
      height: Math.max(current.height, measurement.size.height)
    }),
    { width: ROOT_SECTION_MIN_WIDTH, height: ROOT_SECTION_MIN_HEIGHT }
  );
  const contexts = displaceOverlappingRootSections(resolveRootSectionPlacements(
    rootMeasurements,
    defaultGridSize,
    options.newRootPlacement
  ));

  const overlayGroups = normalizeOverlayGroups(options.overlay?.groups ?? []).filter((group) =>
    !contexts.some((context) => group.id === context.rootId || group.id.startsWith(`${context.rootId}:`))
  );
  const nodes = contexts.flatMap((context) => composeRootNodes(context));
  const groups = [
    ...overlayGroups.map((group) => ({ ...group })),
    ...contexts.flatMap((context) => composeRootGroups(context, overlayGroups, options.overlay))
  ];
  const edges = contexts.flatMap((context) => composeRootEdges(context));
  const fileReferences = contexts.flatMap((context) => composeRootFileReferences(context));
  const updatedAt = maxStateUpdatedAt(contexts.map((context) => context.state), options.now);

  return {
    version: 1,
    updatedAt,
    nodes,
    edges,
    groups,
    nextGroupSequence: Math.max(
      readNextGroupSequence(overlayGroups),
      ...contexts.map((context) => context.state.nextGroupSequence ?? 1)
    ),
    fileReferences,
    suppressedFileActivityEdgeIds: uniqueStrings(
      contexts.flatMap((context) =>
        (context.state.suppressedFileActivityEdgeIds ?? []).map((edgeId) => namespaceCanvasObjectId(context.folder.path, edgeId))
      )
    ),
    suppressedAutomaticFileArtifactNodeIds: uniqueStrings(
      contexts.flatMap((context) =>
        (context.state.suppressedAutomaticFileArtifactNodeIds ?? []).map((nodeId) => namespaceCanvasObjectId(context.folder.path, nodeId))
      )
    )
  };
}

export function decomposeMultiRootCanvasState(
  options: DecomposeMultiRootCanvasStateOptions
): DecomposeMultiRootCanvasStateResult {
  const now = options.now ?? new Date().toISOString();
  const folders = normalizeWorkspaceFolders(options.workspaceFolders);
  const previousStatesByRootPath = new Map<string, CanvasPrototypeState>();
  for (const entry of options.previousRootStates) {
    const rootPath = normalizeRootPath(entry.rootPath);
    if (rootPath) {
      previousStatesByRootPath.set(rootPath, cloneState(entry.state));
    }
  }
  const rootGroupsByPath = new Map<string, CanvasGroupSummary>();
  for (const group of options.composedState.groups ?? []) {
    if (!isWorkspaceRootGroup(group)) {
      continue;
    }
    const rootPath = resolveWorkspaceRootPathForGroup(group);
    if (rootPath) {
      rootGroupsByPath.set(rootPath, group);
    }
  }

  const overlayGroups = collectOverlayGroups(options.composedState.groups ?? []);
  const overlayGroupIds = new Set(overlayGroups.map((group) => group.id));

  const rootStates = folders.map((folder, index) => {
    const rootGroup = rootGroupsByPath.get(folder.path);
    const rootPosition = roundPosition(rootGroup?.position ?? defaultRootSectionPosition(index));
    const previousState = previousStatesByRootPath.get(folder.path) ?? createEmptyCanvasState(now);
    return {
      rootPath: folder.path,
      state: decomposeRootState({
        composedState: options.composedState,
        folder,
        previousState,
        rootGroupId: rootGroup?.id ?? createWorkspaceRootSectionId(folder.path),
        rootPosition,
        now
      })
    } satisfies CanvasRootLocalStateSnapshot;
  });

  const overlay: CanvasMultiRootOverlay = {
    version: 1,
    roots: folders.map((folder, index) => {
      const group = rootGroupsByPath.get(folder.path);
      return {
        rootPath: folder.path,
        position: roundPosition(group?.position ?? defaultRootSectionPosition(index)),
        size: group ? normalizeRootSectionSize(group.size) : undefined,
        parentGroupId: group?.parentGroupId && overlayGroupIds.has(group.parentGroupId) ? group.parentGroupId : undefined
      };
    }),
    groups: overlayGroups
  };

  return { rootStates, overlay };
}

export function normalizeCanvasMultiRootOverlay(value: unknown): CanvasMultiRootOverlay | undefined {
  if (!isRecord(value) || !Array.isArray(value.roots)) {
    return undefined;
  }

  const groups = normalizeOverlayGroups(value.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const roots = value.roots.flatMap((root): CanvasMultiRootOverlayRoot[] => {
    if (!isRecord(root)) {
      return [];
    }
    const rootPath = normalizeRootPath(root.rootPath);
    if (!rootPath || !isCanvasNodePositionLike(root.position)) {
      return [];
    }
    return [
      {
        rootPath,
        position: roundPosition(root.position),
        size: isCanvasNodeFootprintLike(root.size) ? normalizeRootSectionSize(root.size) : undefined,
        parentGroupId:
          typeof root.parentGroupId === 'string' && groupIds.has(root.parentGroupId)
            ? root.parentGroupId
            : undefined
      }
    ];
  });

  return {
    version: 1,
    roots,
    groups
  };
}

export function createEmptyCanvasState(now = new Date().toISOString()): CanvasPrototypeState {
  return {
    version: 1,
    updatedAt: now,
    nodes: [],
    edges: [],
    groups: [],
    nextGroupSequence: 1,
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  };
}

export function sanitizeRootLocalCanvasState(
  rootPath: string,
  state: CanvasPrototypeState,
  now = state.updatedAt
): CanvasPrototypeState {
  const normalizedRootPath = normalizeRootPath(rootPath);
  if (!normalizedRootPath) {
    return cloneState(state);
  }

  let nextState = cloneState(state);
  for (let pass = 0; pass < Math.max(1, (state.groups ?? []).length + 1); pass += 1) {
    const rootWrapperGroup = findRootLocalWrapperGroup(normalizedRootPath, nextState.groups ?? []);
    if (!rootWrapperGroup) {
      return nextState;
    }
    nextState = decomposeRootState({
      composedState: nextState,
      folder: {
        name: path.basename(normalizedRootPath) || normalizedRootPath,
        path: normalizedRootPath
      },
      previousState: createEmptyCanvasState(now),
      rootGroupId: rootWrapperGroup.id,
      rootPosition: roundPosition(rootWrapperGroup.position),
      now
    });
  }

  return nextState;
}

function findRootLocalWrapperGroup(
  normalizedRootPath: string,
  groups: readonly CanvasGroupSummary[]
): CanvasGroupSummary | undefined {
  const expectedRootGroupId = createWorkspaceRootSectionId(normalizedRootPath);
  return groups.find((group) =>
    group.id === expectedRootGroupId ||
    denamespaceCanvasObjectId(normalizedRootPath, group.id) === expectedRootGroupId ||
    (isWorkspaceRootGroup(group) && resolveWorkspaceRootPathForGroup(group) === normalizedRootPath)
  );
}

function composeRootNodes(context: RootCompositionContext): CanvasNodeSummary[] {
  return context.state.nodes.map((node) => ({
    ...node,
    id: namespaceCanvasObjectId(context.folder.path, node.id),
    position: translatePosition(node.position, context.position, ROOT_SECTION_CONTENT_INSET),
    groupId: node.groupId
      ? namespaceCanvasObjectId(context.folder.path, node.groupId)
      : context.groupId,
    metadata: cloneJsonValue(node.metadata)
  }));
}

function composeRootGroups(
  context: RootCompositionContext,
  overlayGroups: readonly CanvasMultiRootOverlayGroup[],
  overlay?: CanvasMultiRootOverlay
): CanvasGroupSummary[] {
  const overlayRoot = overlay?.roots.find((root) => normalizeRootPath(root.rootPath) === context.folder.path);
  const overlayGroupIds = new Set(overlayGroups.map((group) => group.id));
  const rootGroup: CanvasGroupSummary = {
    id: context.groupId,
    title: context.folder.name,
    position: context.position,
    size: context.size,
    parentGroupId: overlayRoot?.parentGroupId && overlayGroupIds.has(overlayRoot.parentGroupId)
      ? overlayRoot.parentGroupId
      : undefined,
    role: 'workspace-root',
    workspaceRootPath: context.folder.path
  };
  const userGroups = context.state.groups.map((group) => ({
    ...group,
    id: namespaceCanvasObjectId(context.folder.path, group.id),
    position: translatePosition(group.position, context.position, ROOT_SECTION_CONTENT_INSET),
    parentGroupId: group.parentGroupId
      ? namespaceCanvasObjectId(context.folder.path, group.parentGroupId)
      : context.groupId,
    role: undefined,
    workspaceRootPath: undefined
  }));
  return [rootGroup, ...userGroups];
}

function composeRootEdges(context: RootCompositionContext): CanvasEdgeSummary[] {
  const nodeIds = new Set(context.state.nodes.map((node) => node.id));
  return context.state.edges
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
    .map((edge) => ({
      ...edge,
      id: namespaceCanvasObjectId(context.folder.path, edge.id),
      sourceNodeId: namespaceCanvasObjectId(context.folder.path, edge.sourceNodeId),
      targetNodeId: namespaceCanvasObjectId(context.folder.path, edge.targetNodeId)
    }));
}

function composeRootFileReferences(context: RootCompositionContext): CanvasFileReferenceSummary[] {
  const nodeIds = new Set(context.state.nodes.map((node) => node.id));
  return (context.state.fileReferences ?? []).map((reference) => ({
    ...reference,
    id: namespaceCanvasObjectId(context.folder.path, reference.id),
    owners: reference.owners
      .filter((owner) => nodeIds.has(owner.nodeId))
      .map((owner) => ({
        ...owner,
        nodeId: namespaceCanvasObjectId(context.folder.path, owner.nodeId)
      }))
  })).filter((reference) => reference.owners.length > 0);
}

function decomposeRootState(options: {
  composedState: CanvasPrototypeState;
  folder: CanvasMultiRootWorkspaceFolder;
  previousState: CanvasPrototypeState;
  rootGroupId: string;
  rootPosition: CanvasNodePosition;
  now: string;
}): CanvasPrototypeState {
  const { composedState, folder, previousState, rootGroupId, rootPosition, now } = options;
  const composedGroups = composedState.groups ?? [];
  const localGroupIdByComposedId = new Map<string, string>();
  const groups = (composedState.groups ?? []).flatMap((group): CanvasGroupSummary[] => {
    if (isWorkspaceRootGroup(group) || group.id === rootGroupId) {
      return [];
    }
    const localId = denamespaceCanvasObjectId(folder.path, group.id) ?? group.id;
    const belongsToRoot = doesGroupBelongToRoot(composedGroups, group, folder.path, rootGroupId);
    if (!belongsToRoot) {
      return [];
    }
    localGroupIdByComposedId.set(group.id, localId);
    const localParentGroupId = group.parentGroupId === rootGroupId
      ? undefined
      : group.parentGroupId
        ? denamespaceCanvasObjectId(folder.path, group.parentGroupId) ?? group.parentGroupId
        : undefined;
    return [
      {
        ...group,
        id: localId,
        position: subtractRootOffset(group.position, rootPosition),
        parentGroupId: localParentGroupId,
        role: undefined,
        workspaceRootPath: undefined
      }
    ];
  });
  const localGroupIds = new Set(groups.map((group) => group.id));
  const localNodeIdByComposedId = new Map<string, string>();

  const nodes = composedState.nodes.flatMap((node): CanvasNodeSummary[] => {
    const localId = denamespaceCanvasObjectId(folder.path, node.id) ?? node.id;
    const belongsToRoot =
      denamespaceCanvasObjectId(folder.path, node.id) !== undefined ||
      node.groupId === rootGroupId ||
      Boolean(node.groupId && localGroupIdByComposedId.has(node.groupId));
    if (!belongsToRoot) {
      return [];
    }
    localNodeIdByComposedId.set(node.id, localId);
    const localGroupId = node.groupId === rootGroupId
      ? undefined
      : node.groupId
        ? denamespaceCanvasObjectId(folder.path, node.groupId) ?? node.groupId
        : undefined;
    return [
      {
        ...node,
        id: localId,
        position: subtractRootOffset(node.position, rootPosition),
        groupId: localGroupId && localGroupIds.has(localGroupId) ? localGroupId : undefined,
        metadata: cloneJsonValue(node.metadata)
      }
    ];
  });
  const localNodeIds = new Set(nodes.map((node) => node.id));

  const edges = composedState.edges.flatMap((edge): CanvasEdgeSummary[] => {
    const localId = denamespaceCanvasObjectId(folder.path, edge.id) ?? edge.id;
    const sourceNodeId = localNodeIdByComposedId.get(edge.sourceNodeId);
    const targetNodeId = localNodeIdByComposedId.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId || !localNodeIds.has(sourceNodeId) || !localNodeIds.has(targetNodeId)) {
      return [];
    }
    return [
      {
        ...edge,
        id: localId,
        sourceNodeId,
        targetNodeId
      }
    ];
  });

  const fileReferences = (composedState.fileReferences ?? []).flatMap((reference): CanvasFileReferenceSummary[] => {
    const localId = denamespaceCanvasObjectId(folder.path, reference.id) ?? reference.id;
    const owners = reference.owners.flatMap((owner) => {
      const nodeId = denamespaceCanvasObjectId(folder.path, owner.nodeId);
      return nodeId && localNodeIds.has(nodeId) ? [{ ...owner, nodeId }] : [];
    });
    return owners.length > 0 ? [{ ...reference, id: localId, owners }] : [];
  });

  const nextGroupSequence = Math.max(previousState.nextGroupSequence ?? 1, readNextGroupSequence(groups));
  return {
    ...previousState,
    version: 1,
    updatedAt: now,
    nodes,
    edges,
    groups,
    nextGroupSequence,
    fileReferences,
    suppressedFileActivityEdgeIds: (composedState.suppressedFileActivityEdgeIds ?? [])
      .flatMap((edgeId) => {
        const localEdgeId = denamespaceCanvasObjectId(folder.path, edgeId);
        return localEdgeId ? [localEdgeId] : [];
      }),
    suppressedAutomaticFileArtifactNodeIds: (composedState.suppressedAutomaticFileArtifactNodeIds ?? [])
      .flatMap((nodeId) => {
        const localNodeId = denamespaceCanvasObjectId(folder.path, nodeId);
        return localNodeId ? [localNodeId] : [];
      })
  };
}

function doesGroupBelongToRoot(
  groups: readonly CanvasGroupSummary[],
  group: CanvasGroupSummary,
  rootPath: string,
  rootGroupId: string
): boolean {
  if (denamespaceCanvasObjectId(rootPath, group.id) !== undefined || group.parentGroupId === rootGroupId) {
    return true;
  }

  const visited = new Set<string>();
  let parentGroupId = group.parentGroupId;
  while (parentGroupId && !visited.has(parentGroupId)) {
    if (parentGroupId === rootGroupId) {
      return true;
    }
    visited.add(parentGroupId);
    const parentGroup = groups.find((candidate) => candidate.id === parentGroupId);
    if (!parentGroup || isWorkspaceRootGroup(parentGroup)) {
      return false;
    }
    if (denamespaceCanvasObjectId(rootPath, parentGroup.id) !== undefined) {
      return true;
    }
    parentGroupId = parentGroup.parentGroupId;
  }
  return false;
}

function isNodeOwnedByWorkspaceRoot(
  node: CanvasNodeSummary,
  groups: readonly CanvasGroupSummary[],
  rootPath: string,
  rootGroupId: string
): boolean {
  return (
    denamespaceCanvasObjectId(rootPath, node.id) !== undefined ||
    node.groupId === rootGroupId ||
    Boolean(node.groupId && resolveContainingWorkspaceRootGroupId(groups, node.groupId) === rootGroupId)
  );
}

export function collectWorkspaceRootOwnedNodeIds(
  state: CanvasPrototypeState,
  rootPath: string,
  rootGroupId: string
): Set<string> {
  const groups = state.groups ?? [];
  const nodeIds = new Set(
    state.nodes
      .filter((node) => isNodeOwnedByWorkspaceRoot(node, groups, rootPath, rootGroupId))
      .map((node) => node.id)
  );
  for (const node of state.nodes) {
    if (
      (node.kind === 'file' || node.kind === 'file-list') &&
      isFileActivityArtifactObjectOwnedByWorkspaceRoot(rootPath, rootGroupId, node.id)
    ) {
      nodeIds.add(node.id);
    }
  }
  for (const reference of state.fileReferences ?? []) {
    const rootOwnerNodeIds = reference.owners
      .map((owner) => owner.nodeId)
      .filter((nodeId) => nodeIds.has(nodeId));
    if (rootOwnerNodeIds.length === 0) {
      continue;
    }

    nodeIds.add(buildAutomaticFileNodeIdForReferenceId(reference.id));
    nodeIds.add(buildLegacyAutomaticFileNodeIdForReferenceId(reference.id));
    if (rootOwnerNodeIds.length > 1) {
      nodeIds.add(buildSharedFileListNodeIdForReferenceOwnerIds(rootOwnerNodeIds));
      nodeIds.add('file-list-shared');
      continue;
    }

    const [ownerNodeId] = rootOwnerNodeIds;
    if (ownerNodeId) {
      nodeIds.add(buildAgentFileListNodeIdForOwnerId(ownerNodeId));
      nodeIds.add(buildLegacyAgentFileListNodeIdForOwnerId(ownerNodeId));
    }
  }
  return nodeIds;
}

function buildAutomaticFileNodeIdForReferenceId(referenceId: string): string {
  const namespacedId = splitNamespacedCanvasObjectId(referenceId);
  return namespacedId
    ? `${namespacedId.namespaceId}:file-${namespacedId.localId}`
    : `file-${referenceId}`;
}

function buildLegacyAutomaticFileNodeIdForReferenceId(referenceId: string): string {
  return `file-${referenceId}`;
}

function buildAgentFileListNodeIdForOwnerId(ownerNodeId: string): string {
  const namespacedId = splitNamespacedCanvasObjectId(ownerNodeId);
  return namespacedId
    ? `${namespacedId.namespaceId}:file-list-agent-${namespacedId.localId}`
    : `file-list-agent-${ownerNodeId}`;
}

function buildLegacyAgentFileListNodeIdForOwnerId(ownerNodeId: string): string {
  return `file-list-agent-${ownerNodeId}`;
}

function buildSharedFileListNodeIdForReferenceOwnerIds(ownerNodeIds: readonly string[]): string {
  const namespaceId = resolveSingleCanvasNamespaceId(ownerNodeIds);
  return namespaceId ? `${namespaceId}:file-list-shared` : 'file-list-shared';
}

function isFileActivityArtifactObjectOwnedByWorkspaceRoot(
  rootPath: string,
  rootGroupId: string,
  objectId: string
): boolean {
  return (
    denamespaceCanvasObjectId(rootPath, objectId) !== undefined ||
    resolveLegacyAutomaticFileArtifactNamespaceId(objectId) === rootGroupId ||
    objectId === 'file-list-shared'
  );
}

function resolveLegacyAutomaticFileArtifactNamespaceId(objectId: string): string | undefined {
  for (const prefix of ['file-', 'file-list-agent-']) {
    if (!objectId.startsWith(prefix)) {
      continue;
    }
    const remainder = objectId.slice(prefix.length);
    const separatorIndex = remainder.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const namespaceId = remainder.slice(0, separatorIndex);
    if (namespaceId.startsWith(`${ROOT_NAMESPACE_PREFIX}-`)) {
      return namespaceId;
    }
  }
  return undefined;
}

function resolveSingleCanvasNamespaceId(objectIds: readonly string[]): string | undefined {
  let namespaceId: string | undefined;
  for (const objectId of objectIds) {
    const parts = splitNamespacedCanvasObjectId(objectId);
    if (!parts) {
      return undefined;
    }
    if (!namespaceId) {
      namespaceId = parts.namespaceId;
      continue;
    }
    if (namespaceId !== parts.namespaceId) {
      return undefined;
    }
  }
  return namespaceId;
}

function isGroupOwnedByWorkspaceRoot(
  groups: readonly CanvasGroupSummary[],
  group: CanvasGroupSummary,
  rootPath: string,
  rootGroupId: string
): boolean {
  return (
    denamespaceCanvasObjectId(rootPath, group.id) !== undefined ||
    group.parentGroupId === rootGroupId ||
    Boolean(group.parentGroupId && resolveContainingWorkspaceRootGroupId(groups, group.parentGroupId) === rootGroupId)
  );
}

function collectOverlayGroups(groups: readonly CanvasGroupSummary[]): CanvasMultiRootOverlayGroup[] {
  const overlayGroupIds = new Set(
    groups
      .filter((group) =>
        !isWorkspaceRootGroup(group) &&
        !resolveContainingWorkspaceRootGroupId(groups, group.id) &&
        !isNamespacedWorkspaceRootObjectId(groups, group.id)
      )
      .map((group) => group.id)
  );

  return groups
    .filter((group) => overlayGroupIds.has(group.id))
    .map((group) => ({
      id: group.id,
      title: group.title,
      position: roundPosition(group.position),
      size: normalizeOverlayGroupSize(group.size),
      parentGroupId:
        group.parentGroupId && overlayGroupIds.has(group.parentGroupId)
          ? group.parentGroupId
          : undefined
    }));
}

function isNamespacedWorkspaceRootObjectId(groups: readonly CanvasGroupSummary[], objectId: string): boolean {
  return groups.some((group) => isWorkspaceRootGroup(group) && objectId.startsWith(`${group.id}:`));
}

function resolveContainingWorkspaceRootGroupId(
  groups: readonly CanvasGroupSummary[],
  groupId?: string
): string | undefined {
  let currentGroup = groupId ? groups.find((group) => group.id === groupId) : undefined;
  const visited = new Set<string>();
  while (currentGroup && !visited.has(currentGroup.id)) {
    if (isWorkspaceRootGroup(currentGroup)) {
      return currentGroup.id;
    }
    visited.add(currentGroup.id);
    currentGroup = currentGroup.parentGroupId
      ? groups.find((group) => group.id === currentGroup?.parentGroupId)
      : undefined;
  }
  return undefined;
}

function normalizeOverlayGroups(value: unknown): CanvasMultiRootOverlayGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const groups = value.flatMap((group, index): CanvasMultiRootOverlayGroup[] => {
    if (!isRecord(group) || typeof group.id !== 'string') {
      return [];
    }
    return [{
      id: group.id,
      title: typeof group.title === 'string' && group.title.trim() ? group.title.trim() : `Group ${index + 1}`,
      position: isCanvasNodePositionLike(group.position) ? roundPosition(group.position) : { x: 0, y: 0 },
      size: isCanvasNodeFootprintLike(group.size)
        ? normalizeOverlayGroupSize(group.size)
        : { width: OVERLAY_GROUP_MIN_WIDTH, height: OVERLAY_GROUP_MIN_HEIGHT },
      parentGroupId: typeof group.parentGroupId === 'string' ? group.parentGroupId : undefined
    }];
  });
  const groupIds = new Set(groups.map((group) => group.id));
  return groups.map((group) => ({
    ...group,
    parentGroupId:
      group.parentGroupId && groupIds.has(group.parentGroupId) && !wouldCreateOverlayGroupCycle(groups, group.id, group.parentGroupId)
        ? group.parentGroupId
        : undefined
  }));
}

function wouldCreateOverlayGroupCycle(
  groups: readonly Pick<CanvasMultiRootOverlayGroup, 'id' | 'parentGroupId'>[],
  groupId: string,
  parentGroupId: string
): boolean {
  let currentParentId: string | undefined = parentGroupId;
  const visited = new Set<string>();
  while (currentParentId) {
    if (currentParentId === groupId || visited.has(currentParentId)) {
      return true;
    }
    visited.add(currentParentId);
    currentParentId = groups.find((group) => group.id === currentParentId)?.parentGroupId;
  }
  return false;
}

function measureRootSectionSize(state: CanvasPrototypeState): CanvasNodeFootprint {
  const rects = [
    ...state.nodes.map((node) => rectFromPositionAndSize(node.position, node.size)),
    ...state.groups.map((group) => rectFromPositionAndSize(group.position, group.size))
  ];
  if (rects.length === 0) {
    return { width: ROOT_SECTION_MIN_WIDTH, height: ROOT_SECTION_MIN_HEIGHT };
  }
  const bounds = rects.reduce((current, rect) => ({
    left: Math.min(current.left, rect.left),
    top: Math.min(current.top, rect.top),
    right: Math.max(current.right, rect.right),
    bottom: Math.max(current.bottom, rect.bottom)
  }), rects[0]);
  return normalizeRootSectionSize({
    width: bounds.right - Math.min(0, bounds.left) + ROOT_SECTION_CONTENT_INSET * 2,
    height: bounds.bottom - Math.min(0, bounds.top) + ROOT_SECTION_CONTENT_INSET * 2
  });
}

function normalizeRootSectionSize(size: CanvasNodeFootprint): CanvasNodeFootprint {
  return {
    width: Math.max(ROOT_SECTION_MIN_WIDTH, Math.round(size.width)),
    height: Math.max(ROOT_SECTION_MIN_HEIGHT, Math.round(size.height))
  };
}

function normalizeOverlayGroupSize(size: CanvasNodeFootprint): CanvasNodeFootprint {
  return {
    width: Math.max(OVERLAY_GROUP_MIN_WIDTH, Math.round(size.width)),
    height: Math.max(OVERLAY_GROUP_MIN_HEIGHT, Math.round(size.height))
  };
}

function resolveRootSectionPlacements(
  measurements: readonly RootSectionMeasurement[],
  defaultGridSize: CanvasNodeFootprint,
  newRootPlacement?: CanvasMultiRootNewRootPlacement
): RootCompositionContext[] {
  const newRootPaths = normalizeNewRootPlacementRootPaths(newRootPlacement?.rootPaths ?? []);
  const initialContexts = measurements.map((measurement, index) => ({
    folder: measurement.folder,
    rootId: measurement.rootId,
    groupId: measurement.groupId,
    position: roundPosition(measurement.overlayRoot?.position ?? defaultRootSectionPosition(index, defaultGridSize)),
    size: measurement.size,
    state: measurement.state
  }));
  const preferredCenter = newRootPlacement?.preferredCenter;
  if (!preferredCenter || newRootPaths.size === 0) {
    return initialContexts;
  }

  const resolvedContexts = new Map<string, RootCompositionContext>();
  const occupiedRects: CanvasRect[] = [];
  for (let index = 0; index < measurements.length; index += 1) {
    const measurement = measurements[index];
    const context = initialContexts[index];
    if (!measurement || !context) {
      continue;
    }
    const isNewRoot = !measurement.overlayRoot && newRootPaths.has(measurement.folder.path);
    if (isNewRoot) {
      continue;
    }

    resolvedContexts.set(measurement.folder.path, context);
    occupiedRects.push(rectFromPositionAndSize(context.position, context.size));
  }

  for (let index = 0; index < measurements.length; index += 1) {
    const measurement = measurements[index];
    const context = initialContexts[index];
    if (!measurement || !context || resolvedContexts.has(measurement.folder.path)) {
      continue;
    }

    const nextContext = {
      ...context,
      position: resolveClosestFreeRootSectionPosition(
        context.size,
        preferredCenter,
        occupiedRects,
        context.position
      )
    };
    resolvedContexts.set(measurement.folder.path, nextContext);
    occupiedRects.push(rectFromPositionAndSize(nextContext.position, nextContext.size));
  }

  return initialContexts.map((context) => resolvedContexts.get(context.folder.path) ?? context);
}

function normalizeNewRootPlacementRootPaths(rootPaths: readonly string[]): Set<string> {
  return new Set(rootPaths.flatMap((rootPath) => {
    const normalizedRootPath = normalizeRootPath(rootPath);
    return normalizedRootPath ? [normalizedRootPath] : [];
  }));
}

function resolveClosestFreeRootSectionPosition(
  size: CanvasNodeFootprint,
  preferredCenter: CanvasNodePosition,
  occupiedRects: readonly CanvasRect[],
  fallbackPosition: CanvasNodePosition
): CanvasNodePosition {
  if (occupiedRects.length === 0) {
    return roundPosition({
      x: preferredCenter.x - Math.round(size.width / 2),
      y: preferredCenter.y - Math.round(size.height / 2)
    });
  }

  const anchorPosition = roundPosition({
    x: preferredCenter.x - Math.round(size.width / 2),
    y: preferredCenter.y - Math.round(size.height / 2)
  });
  const candidates = buildRootSectionPlacementCandidates(anchorPosition, size, occupiedRects)
    .sort((left, right) => compareRootSectionPlacementCandidates(left, right, size, preferredCenter));
  for (const candidate of candidates) {
    if (!rootSectionPlacementCollides(size, candidate, occupiedRects)) {
      return candidate;
    }
  }

  return resolveFallbackRootSectionPlacement(size, preferredCenter, occupiedRects, fallbackPosition);
}

function buildRootSectionPlacementCandidates(
  anchorPosition: CanvasNodePosition,
  size: CanvasNodeFootprint,
  occupiedRects: readonly CanvasRect[]
): CanvasNodePosition[] {
  const candidates: CanvasNodePosition[] = [anchorPosition];
  const horizontalStep = Math.max(1, size.width + ROOT_SECTION_HORIZONTAL_GAP);
  const verticalStep = Math.max(1, size.height + ROOT_SECTION_VERTICAL_GAP);
  const maxRing = Math.max(6, occupiedRects.length + 4);

  for (const rect of occupiedRects) {
    candidates.push(
      { x: rect.right + ROOT_SECTION_HORIZONTAL_GAP, y: anchorPosition.y },
      { x: rect.left - ROOT_SECTION_HORIZONTAL_GAP - size.width, y: anchorPosition.y },
      { x: anchorPosition.x, y: rect.bottom + ROOT_SECTION_VERTICAL_GAP },
      { x: anchorPosition.x, y: rect.top - ROOT_SECTION_VERTICAL_GAP - size.height },
      { x: rect.right + ROOT_SECTION_HORIZONTAL_GAP, y: rect.top },
      { x: rect.right + ROOT_SECTION_HORIZONTAL_GAP, y: rect.bottom - size.height },
      { x: rect.left - ROOT_SECTION_HORIZONTAL_GAP - size.width, y: rect.top },
      { x: rect.left - ROOT_SECTION_HORIZONTAL_GAP - size.width, y: rect.bottom - size.height },
      { x: rect.left, y: rect.bottom + ROOT_SECTION_VERTICAL_GAP },
      { x: rect.right - size.width, y: rect.bottom + ROOT_SECTION_VERTICAL_GAP },
      { x: rect.left, y: rect.top - ROOT_SECTION_VERTICAL_GAP - size.height },
      { x: rect.right - size.width, y: rect.top - ROOT_SECTION_VERTICAL_GAP - size.height }
    );
  }

  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      candidates.push(
        { x: anchorPosition.x + dx * horizontalStep, y: anchorPosition.y - ring * verticalStep },
        { x: anchorPosition.x + dx * horizontalStep, y: anchorPosition.y + ring * verticalStep }
      );
    }
    for (let dy = -ring + 1; dy <= ring - 1; dy += 1) {
      candidates.push(
        { x: anchorPosition.x - ring * horizontalStep, y: anchorPosition.y + dy * verticalStep },
        { x: anchorPosition.x + ring * horizontalStep, y: anchorPosition.y + dy * verticalStep }
      );
    }
  }

  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const rounded = roundPosition(candidate);
    const key = `${rounded.x}:${rounded.y}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [rounded];
  });
}

function compareRootSectionPlacementCandidates(
  left: CanvasNodePosition,
  right: CanvasNodePosition,
  size: CanvasNodeFootprint,
  preferredCenter: CanvasNodePosition
): number {
  const leftDistance = squaredDistance(rectCenterPoint(rectFromPositionAndSize(left, size)), preferredCenter);
  const rightDistance = squaredDistance(rectCenterPoint(rectFromPositionAndSize(right, size)), preferredCenter);
  return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
}

function squaredDistance(left: CanvasNodePosition, right: CanvasNodePosition): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function rootSectionPlacementCollides(
  size: CanvasNodeFootprint,
  position: CanvasNodePosition,
  occupiedRects: readonly CanvasRect[]
): boolean {
  const rect = rectFromPositionAndSize(position, size);
  return occupiedRects.some((occupiedRect) =>
    rectsIntersect(rect, expandRootSectionPlacementBlockingRect(occupiedRect))
  );
}

function expandRootSectionPlacementBlockingRect(rect: CanvasRect): CanvasRect {
  return {
    left: rect.left - ROOT_SECTION_HORIZONTAL_GAP,
    top: rect.top - ROOT_SECTION_VERTICAL_GAP,
    right: rect.right + ROOT_SECTION_HORIZONTAL_GAP,
    bottom: rect.bottom + ROOT_SECTION_VERTICAL_GAP
  };
}

function resolveFallbackRootSectionPlacement(
  size: CanvasNodeFootprint,
  preferredCenter: CanvasNodePosition,
  occupiedRects: readonly CanvasRect[],
  fallbackPosition: CanvasNodePosition
): CanvasNodePosition {
  const bounds = boundingRectForRects(occupiedRects);
  if (!bounds) {
    return roundPosition(fallbackPosition);
  }

  return roundPosition({
    x: bounds.right + ROOT_SECTION_HORIZONTAL_GAP,
    y: preferredCenter.y - Math.round(size.height / 2)
  });
}

function displaceOverlappingRootSections(contexts: readonly RootCompositionContext[]): RootCompositionContext[] {
  const placed: RootCompositionContext[] = [];
  for (const context of contexts) {
    let next = { ...context, position: roundPosition(context.position) };
    for (let pass = 0; pass < Math.max(1, contexts.length + placed.length + 1); pass += 1) {
      const overlap = placed.find((candidate) =>
        rectsIntersect(
          rectFromPositionAndSize(next.position, next.size),
          rectFromPositionAndSize(candidate.position, candidate.size)
        )
      );
      if (!overlap) {
        break;
      }
      const overlapRect = rectFromPositionAndSize(overlap.position, overlap.size);
      next = {
        ...next,
        position: {
          x: Math.max(next.position.x, overlapRect.right + ROOT_SECTION_HORIZONTAL_GAP),
          y: next.position.y
        }
      };
    }
    placed.push(next);
  }
  return placed;
}

function rectsIntersect(left: CanvasRect, right: CanvasRect): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function maxRootSectionSize(
  overlaySize: CanvasNodeFootprint | undefined,
  naturalSize: CanvasNodeFootprint
): CanvasNodeFootprint {
  if (!overlaySize) {
    return naturalSize;
  }

  return {
    width: Math.max(overlaySize.width, naturalSize.width),
    height: Math.max(overlaySize.height, naturalSize.height)
  };
}

function defaultRootSectionPosition(index: number, size: CanvasNodeFootprint = { width: ROOT_SECTION_MIN_WIDTH, height: ROOT_SECTION_MIN_HEIGHT }): CanvasNodePosition {
  const column = index % ROOT_SECTION_COLUMNS;
  const row = Math.floor(index / ROOT_SECTION_COLUMNS);
  return {
    x: column * (size.width + ROOT_SECTION_HORIZONTAL_GAP),
    y: row * (size.height + ROOT_SECTION_VERTICAL_GAP)
  };
}

function translatePosition(position: CanvasNodePosition, rootPosition: CanvasNodePosition, inset: number): CanvasNodePosition {
  return {
    x: Math.round(rootPosition.x + inset + position.x),
    y: Math.round(rootPosition.y + inset + position.y)
  };
}

function subtractRootOffset(position: CanvasNodePosition, rootPosition: CanvasNodePosition): CanvasNodePosition {
  return {
    x: Math.round(position.x - rootPosition.x - ROOT_SECTION_CONTENT_INSET),
    y: Math.round(position.y - rootPosition.y - ROOT_SECTION_CONTENT_INSET)
  };
}

function rectFromPositionAndSize(position: CanvasNodePosition, size: CanvasNodeFootprint): CanvasRect {
  return {
    left: position.x,
    top: position.y,
    right: position.x + size.width,
    bottom: position.y + size.height
  };
}

function boundingRectForRects(rects: readonly CanvasRect[]): CanvasRect | undefined {
  const [firstRect, ...restRects] = rects;
  if (!firstRect) {
    return undefined;
  }

  return restRects.reduce((current, rect) => ({
    left: Math.min(current.left, rect.left),
    top: Math.min(current.top, rect.top),
    right: Math.max(current.right, rect.right),
    bottom: Math.max(current.bottom, rect.bottom)
  }), firstRect);
}

function rectCenterPoint(rect: CanvasRect): CanvasNodePosition {
  return {
    x: Math.round((rect.left + rect.right) / 2),
    y: Math.round((rect.top + rect.bottom) / 2)
  };
}

function hashWorkspaceRootPath(rootPath: string): string {
  return createHash('sha256').update(normalizeRootPath(rootPath) ?? rootPath).digest('hex').slice(0, 16);
}

function normalizeWorkspaceFolders(folders: readonly CanvasMultiRootWorkspaceFolder[]): CanvasMultiRootWorkspaceFolder[] {
  const seen = new Set<string>();
  const normalized: CanvasMultiRootWorkspaceFolder[] = [];
  for (const folder of folders) {
    const rootPath = normalizeRootPath(folder.path);
    if (!rootPath || seen.has(rootPath)) {
      continue;
    }
    seen.add(rootPath);
    normalized.push({
      name: folder.name || path.basename(rootPath) || rootPath,
      path: rootPath
    });
  }
  return normalized;
}

function normalizeRootPath(rootPath: unknown): string | undefined {
  if (typeof rootPath !== 'string') {
    return undefined;
  }
  const trimmed = rootPath.trim();
  if (!trimmed) {
    return undefined;
  }
  const resolved = path.resolve(trimmed);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function readNextGroupSequence(groups: readonly Pick<CanvasGroupSummary, 'id'>[]): number {
  const maxSequence = groups.reduce((currentMax, group) => {
    const match = group.id.match(/^group-([1-9]\d*)(?:-.+)?$/u);
    if (!match) {
      return currentMax;
    }
    const parsedValue = Number.parseInt(match[1], 10);
    return Number.isFinite(parsedValue) ? Math.max(currentMax, parsedValue) : currentMax;
  }, 0);
  return maxSequence + 1;
}

function maxStateUpdatedAt(states: readonly CanvasPrototypeState[], fallback = new Date().toISOString()): string {
  const timestamps = states
    .map((state) => Date.parse(state.updatedAt))
    .filter((timestamp) => Number.isFinite(timestamp));
  if (timestamps.length === 0) {
    return fallback;
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function roundPosition(position: CanvasNodePosition): CanvasNodePosition {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y)
  };
}

function isCanvasNodePositionLike(value: unknown): value is CanvasNodePosition {
  return isRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y);
}

function isCanvasNodeFootprintLike(value: unknown): value is CanvasNodeFootprint {
  return isRecord(value) && typeof value.width === 'number' && Number.isFinite(value.width) && typeof value.height === 'number' && Number.isFinite(value.height);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneState(state: CanvasPrototypeState): CanvasPrototypeState {
  return cloneJsonValue(state);
}

function cloneJsonValue<T>(value: T): T {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? value : JSON.parse(serialized) as T;
}
