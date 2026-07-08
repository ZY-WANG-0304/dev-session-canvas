import type {
  CanvasGroupSummary,
  CanvasNodeKind,
  CanvasPrototypeState
} from '../common/protocol';
import { isWorkspaceRootCanvasGroupRole } from './canvasGroupFrameStyles';

export function isTemplateCompatibleNodeKind(value: CanvasNodeKind): value is 'agent' | 'terminal' | 'note' {
  return value === 'agent' || value === 'terminal' || value === 'note';
}

export function canCreateCanvasGroupFromSelection(
  state: CanvasPrototypeState | null,
  nodeIds: readonly string[],
  groupIds: readonly string[],
  targetParentGroupId?: string
): boolean {
  if (!state) {
    return false;
  }

  const selectedNodeIds = new Set(nodeIds);
  const selectedGroupIds = new Set(groupIds);
  const selectedNodes = state.nodes.filter(
    (node) => selectedNodeIds.has(node.id) && isTemplateCompatibleNodeKind(node.kind)
  );
  const selectedGroups = (state.groups ?? []).filter((group) => selectedGroupIds.has(group.id));
  if (selectedNodes.length + selectedGroups.length < 2) {
    return false;
  }

  const selectedParents = new Set<string | undefined>([
    ...selectedNodes.map((node) => node.groupId),
    ...selectedGroups.map((group) => group.parentGroupId)
  ]);
  if (selectedParents.size !== 1) {
    return false;
  }
  const selectedParentGroupId = selectedParents.values().next().value as string | undefined;
  if (targetParentGroupId !== selectedParentGroupId) {
    return false;
  }

  for (const group of selectedGroups) {
    const subtreeGroupIds = collectGroupSubtreeIdsForWebview(state.groups ?? [], group.id);
    for (const descendantGroupId of subtreeGroupIds) {
      if (descendantGroupId !== group.id && selectedGroupIds.has(descendantGroupId)) {
        return false;
      }
    }
    if (selectedNodes.some((node) => node.groupId && subtreeGroupIds.has(node.groupId))) {
      return false;
    }
  }

  return true;
}

export function resolveSelectedObjectParentGroupId(
  state: CanvasPrototypeState | null,
  nodeIds: readonly string[],
  groupIds: readonly string[]
): string | undefined {
  if (!state) {
    return undefined;
  }

  const selectedNodeIds = new Set(nodeIds);
  const selectedGroupIds = new Set(groupIds);
  const selectedNodes = state.nodes.filter(
    (node) => selectedNodeIds.has(node.id) && isTemplateCompatibleNodeKind(node.kind)
  );
  const selectedGroups = (state.groups ?? []).filter((group) => selectedGroupIds.has(group.id));
  const selectedParents = new Set<string | undefined>([
    ...selectedNodes.map((node) => node.groupId),
    ...selectedGroups.map((group) => group.parentGroupId)
  ]);

  return selectedParents.size === 1 ? selectedParents.values().next().value : undefined;
}

export function isCanvasGroupInsideTargetRoot(
  groups: readonly CanvasGroupSummary[],
  groupId: string,
  targetRootGroupId: string
): boolean {
  let current = groups.find((group) => group.id === groupId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.id === targetRootGroupId) {
      return true;
    }

    visited.add(current.id);
    current = current.parentGroupId ? groups.find((group) => group.id === current?.parentGroupId) : undefined;
  }
  return false;
}

export function canConnectCanvasEdgeEndpoints(
  state: CanvasPrototypeState | null,
  sourceNodeId: string,
  targetNodeId: string
): boolean {
  if (!state) {
    return false;
  }

  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
  const targetNode = state.nodes.find((node) => node.id === targetNodeId);
  if (!sourceNode || !targetNode) {
    return false;
  }

  const groups = state.groups ?? [];
  if (!groups.some((group) => isWorkspaceRootCanvasGroupRole(group.role))) {
    return true;
  }

  const sourceRootGroupId = resolveContainingWorkspaceRootGroupIdForWebview(groups, sourceNode.groupId);
  const targetRootGroupId = resolveContainingWorkspaceRootGroupIdForWebview(groups, targetNode.groupId);
  return Boolean(sourceRootGroupId && sourceRootGroupId === targetRootGroupId);
}

export function resolveContainingWorkspaceRootGroupIdForWebview(
  groups: readonly CanvasGroupSummary[],
  groupId?: string
): string | undefined {
  let current = groupId ? groups.find((group) => group.id === groupId) : undefined;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (isWorkspaceRootCanvasGroupRole(current.role)) {
      return current.id;
    }

    visited.add(current.id);
    current = current.parentGroupId ? groups.find((group) => group.id === current?.parentGroupId) : undefined;
  }
  return undefined;
}

export function collectGroupSubtreeIdsForWebview(groups: readonly CanvasGroupSummary[], groupId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const group of groups) {
    if (!group.parentGroupId) {
      continue;
    }

    childrenByParent.set(group.parentGroupId, [...(childrenByParent.get(group.parentGroupId) ?? []), group.id]);
  }

  const subtreeGroupIds = new Set<string>();
  const stack = [groupId];
  while (stack.length > 0) {
    const nextGroupId = stack.pop();
    if (!nextGroupId || subtreeGroupIds.has(nextGroupId)) {
      continue;
    }

    subtreeGroupIds.add(nextGroupId);
    for (const childGroupId of childrenByParent.get(nextGroupId) ?? []) {
      stack.push(childGroupId);
    }
  }

  return subtreeGroupIds;
}
