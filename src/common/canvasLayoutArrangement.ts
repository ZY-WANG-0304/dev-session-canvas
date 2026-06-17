import {
  getWorkspaceRootSectionContentInset,
  isWorkspaceRootGroup
} from './canvasMultiRootComposition';
import type {
  CanvasEdgeSummary,
  CanvasGroupSummary,
  CanvasNodeFootprint,
  CanvasNodeKind,
  CanvasNodePosition,
  CanvasNodeSummary,
  CanvasPrototypeState
} from './protocol';

const NODE_GAP = 72;
const COMPONENT_GAP = 180;
const DEFAULT_COMPONENT_TARGET_WIDTH = 960;
const CANVAS_GROUP_PADDING = 24;
const CANVAS_GROUP_TITLE_HEIGHT = 28;
const MINIMUM_CANVAS_GROUP_SIZE: CanvasNodeFootprint = { width: 180, height: 96 };
const MINIMUM_WORKSPACE_ROOT_GROUP_SIZE: CanvasNodeFootprint = { width: 720, height: 520 };

const CANVAS_GROUP_MEMBER_INSETS = {
  left: CANVAS_GROUP_PADDING,
  top: CANVAS_GROUP_PADDING + CANVAS_GROUP_TITLE_HEIGHT,
  right: CANVAS_GROUP_PADDING,
  bottom: CANVAS_GROUP_PADDING
} as const;

const CANVAS_WORKSPACE_ROOT_GROUP_MEMBER_INSETS = {
  left: getWorkspaceRootSectionContentInset(),
  top: getWorkspaceRootSectionContentInset(),
  right: getWorkspaceRootSectionContentInset(),
  bottom: getWorkspaceRootSectionContentInset()
} as const;

interface CanvasRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CanvasRectInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type LayoutItemKind = 'node' | 'group';

interface LayoutItem {
  id: string;
  kind: LayoutItemKind;
  nodeKind?: CanvasNodeKind;
  role?: CanvasGroupSummary['role'];
  title: string;
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
}

interface LayoutComponent {
  id: string;
  items: LayoutItem[];
  originalRect: CanvasRect;
  width: number;
  height: number;
  relativePositions: Map<string, CanvasNodePosition>;
}

interface WeightedRelation {
  leftId: string;
  rightId: string;
  weight: number;
}

export function arrangeCanvasLayout(
  state: CanvasPrototypeState,
  now = new Date().toISOString()
): CanvasPrototypeState {
  const context = new LayoutContext(state);
  context.arrangeContainer(undefined);
  const nextState = context.toState(now);

  return geometryEqual(state, nextState) ? state : nextState;
}

class LayoutContext {
  private nodesById: Map<string, CanvasNodeSummary>;
  private groupsById: Map<string, CanvasGroupSummary>;

  public constructor(private readonly state: CanvasPrototypeState) {
    this.nodesById = new Map(state.nodes.map((node) => [node.id, { ...node }] as const));
    this.groupsById = new Map((state.groups ?? []).map((group) => [group.id, { ...group }] as const));
  }

  public arrangeContainer(groupId: string | undefined): void {
    for (const group of this.getDirectChildGroups(groupId)) {
      this.arrangeContainer(group.id);
    }

    const items = this.getDirectItems(groupId);
    if (items.length > 1) {
      this.applyContainerLayout(groupId, items);
    }

    if (groupId && items.length > 0) {
      this.resizeGroupToDirectMembers(groupId);
    }
  }

  public toState(updatedAt: string): CanvasPrototypeState {
    return {
      ...this.state,
      updatedAt,
      nodes: this.state.nodes.map((node) => this.nodesById.get(node.id) ?? node),
      groups: (this.state.groups ?? []).map((group) => this.groupsById.get(group.id) ?? group)
    };
  }

  private getDirectChildGroups(groupId: string | undefined): CanvasGroupSummary[] {
    return [...this.groupsById.values()]
      .filter((group) => group.parentGroupId === groupId)
      .sort(compareGroupsForLayout);
  }

  private getDirectItems(groupId: string | undefined): LayoutItem[] {
    const groups = this.getDirectChildGroups(groupId).map((group): LayoutItem => ({
      id: group.id,
      kind: 'group',
      role: group.role,
      title: group.title,
      position: group.position,
      size: group.size
    }));
    const nodes = [...this.nodesById.values()]
      .filter((node) => node.groupId === groupId)
      .sort(compareNodesForLayout)
      .map((node): LayoutItem => ({
        id: node.id,
        kind: 'node',
        nodeKind: node.kind,
        title: node.title,
        position: node.position,
        size: node.size
      }));

    return [...groups, ...nodes].sort(compareItemsByExistingPosition);
  }

  private applyContainerLayout(groupId: string | undefined, items: readonly LayoutItem[]): void {
    const origin = this.resolveContainerContentOrigin(groupId, items);
    const relations = this.collectRelationsForItems(items);
    const components = this.buildLayoutComponents(items, relations);
    const componentPositions = packComponents(components, origin);

    for (const component of components) {
      const componentPosition = componentPositions.get(component.id);
      if (!componentPosition) {
        continue;
      }

      for (const item of component.items) {
        const relativePosition = component.relativePositions.get(item.id);
        if (!relativePosition) {
          continue;
        }

        this.moveItem(item, {
          x: Math.round(componentPosition.x + relativePosition.x),
          y: Math.round(componentPosition.y + relativePosition.y)
        });
      }
    }
  }

  private resolveContainerContentOrigin(
    groupId: string | undefined,
    items: readonly LayoutItem[]
  ): CanvasNodePosition {
    const group = groupId ? this.groupsById.get(groupId) : undefined;
    if (group) {
      const insets = memberInsetsForGroup(group);
      return {
        x: Math.round(group.position.x + insets.left),
        y: Math.round(group.position.y + insets.top)
      };
    }

    const rect = boundingRectForRects(items.map((item) => rectForLayoutItem(item)));
    return {
      x: Math.round(rect?.left ?? 0),
      y: Math.round(rect?.top ?? 0)
    };
  }

  private collectRelationsForItems(items: readonly LayoutItem[]): WeightedRelation[] {
    const itemIds = new Set(items.map((item) => item.id));
    const itemByNodeId = this.mapDescendantNodesToDirectItems(items);
    const relations = new RelationAccumulator(items);

    for (const edge of this.state.edges ?? []) {
      const sourceItemId = itemByNodeId.get(edge.sourceNodeId);
      const targetItemId = itemByNodeId.get(edge.targetNodeId);
      if (sourceItemId && targetItemId && sourceItemId !== targetItemId) {
        relations.add(sourceItemId, targetItemId, edge.owner === 'file-activity' ? 6 : 8);
      }
    }

    for (const node of this.nodesById.values()) {
      const fileItemId = itemByNodeId.get(node.id);
      if (!fileItemId || !itemIds.has(fileItemId)) {
        continue;
      }

      for (const ownerNodeId of collectFileOwnerNodeIds(node)) {
        const ownerItemId = itemByNodeId.get(ownerNodeId);
        if (ownerItemId && ownerItemId !== fileItemId) {
          relations.add(ownerItemId, fileItemId, 10);
        }
      }
    }

    const filePathItemIds = this.collectFilePathItemIds(itemByNodeId);
    for (const reference of this.state.fileReferences ?? []) {
      const fileItemIds = filePathItemIds.get(reference.filePath) ?? [];
      for (const owner of reference.owners ?? []) {
        const ownerItemId = itemByNodeId.get(owner.nodeId);
        if (!ownerItemId) {
          continue;
        }

        for (const fileItemId of fileItemIds) {
          if (ownerItemId !== fileItemId) {
            relations.add(ownerItemId, fileItemId, 10);
          }
        }
      }
    }

    const cwdItems = this.collectExecutionCwdItemIds(itemByNodeId);
    for (const itemIdsForCwd of cwdItems.values()) {
      const uniqueItemIds = [...new Set(itemIdsForCwd)].sort();
      for (let leftIndex = 0; leftIndex < uniqueItemIds.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < uniqueItemIds.length; rightIndex += 1) {
          relations.add(uniqueItemIds[leftIndex], uniqueItemIds[rightIndex], 1);
        }
      }
    }

    return relations.values();
  }

  private mapDescendantNodesToDirectItems(items: readonly LayoutItem[]): Map<string, string> {
    const itemByNodeId = new Map<string, string>();
    for (const item of items) {
      if (item.kind === 'node') {
        itemByNodeId.set(item.id, item.id);
        continue;
      }

      for (const nodeId of this.collectDescendantNodeIds(item.id)) {
        itemByNodeId.set(nodeId, item.id);
      }
    }

    return itemByNodeId;
  }

  private collectDescendantNodeIds(groupId: string): string[] {
    const groupIds = this.collectGroupSubtreeIds(groupId);
    return [...this.nodesById.values()]
      .filter((node) => node.groupId && groupIds.has(node.groupId))
      .map((node) => node.id);
  }

  private collectGroupSubtreeIds(groupId: string): Set<string> {
    const groupIds = new Set<string>([groupId]);
    let didAdd = true;
    while (didAdd) {
      didAdd = false;
      for (const group of this.groupsById.values()) {
        if (group.parentGroupId && groupIds.has(group.parentGroupId) && !groupIds.has(group.id)) {
          groupIds.add(group.id);
          didAdd = true;
        }
      }
    }

    return groupIds;
  }

  private collectFilePathItemIds(itemByNodeId: ReadonlyMap<string, string>): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const node of this.nodesById.values()) {
      const itemId = itemByNodeId.get(node.id);
      if (!itemId) {
        continue;
      }

      const filePaths = collectFilePaths(node);
      for (const filePath of filePaths) {
        const itemIds = result.get(filePath) ?? [];
        itemIds.push(itemId);
        result.set(filePath, itemIds);
      }
    }

    return result;
  }

  private collectExecutionCwdItemIds(itemByNodeId: ReadonlyMap<string, string>): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const node of this.nodesById.values()) {
      const itemId = itemByNodeId.get(node.id);
      const cwd = node.metadata?.agent?.cwd ?? node.metadata?.terminal?.cwd;
      if (!itemId || typeof cwd !== 'string' || cwd.trim().length === 0) {
        continue;
      }

      const normalizedCwd = cwd.trim();
      const itemIds = result.get(normalizedCwd) ?? [];
      itemIds.push(itemId);
      result.set(normalizedCwd, itemIds);
    }

    return result;
  }

  private buildLayoutComponents(
    items: readonly LayoutItem[],
    relations: readonly WeightedRelation[]
  ): LayoutComponent[] {
    const itemById = new Map(items.map((item) => [item.id, item] as const));
    const adjacency = new Map(items.map((item) => [item.id, new Set<string>()] as const));
    for (const relation of relations) {
      adjacency.get(relation.leftId)?.add(relation.rightId);
      adjacency.get(relation.rightId)?.add(relation.leftId);
    }

    const visited = new Set<string>();
    const components: LayoutComponent[] = [];
    for (const item of items.slice().sort((left, right) => compareItemsForComponentOrder(left, right, relations))) {
      if (visited.has(item.id)) {
        continue;
      }

      const componentIds: string[] = [];
      const queue = [item.id];
      visited.add(item.id);
      while (queue.length > 0) {
        const currentId = queue.shift() as string;
        componentIds.push(currentId);
        for (const neighborId of adjacency.get(currentId) ?? []) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        }
      }

      const componentItems = componentIds
        .map((id) => itemById.get(id))
        .filter((candidate): candidate is LayoutItem => candidate !== undefined)
        .sort((left, right) => compareItemsForComponentOrder(left, right, relations));
      components.push(layoutComponent(componentItems, relations));
    }

    return components.sort(compareLayoutComponents);
  }

  private moveItem(item: LayoutItem, position: CanvasNodePosition): void {
    const delta = {
      x: Math.round(position.x - item.position.x),
      y: Math.round(position.y - item.position.y)
    };
    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    if (item.kind === 'node') {
      const node = this.nodesById.get(item.id);
      if (!node) {
        return;
      }
      this.nodesById.set(item.id, translateNode(node, delta));
      return;
    }

    this.translateGroupSubtree(item.id, delta);
  }

  private translateGroupSubtree(groupId: string, delta: CanvasNodePosition): void {
    const groupIds = this.collectGroupSubtreeIds(groupId);
    for (const currentGroupId of groupIds) {
      const group = this.groupsById.get(currentGroupId);
      if (group) {
        this.groupsById.set(currentGroupId, translateGroup(group, delta));
      }
    }

    for (const node of this.nodesById.values()) {
      if (node.groupId && groupIds.has(node.groupId)) {
        this.nodesById.set(node.id, translateNode(node, delta));
      }
    }
  }

  private resizeGroupToDirectMembers(groupId: string): void {
    const group = this.groupsById.get(groupId);
    if (!group) {
      return;
    }

    const memberRects = this.getDirectItems(groupId).map((item) => rectForLayoutItem(item));
    const memberRect = boundingRectForRects(memberRects);
    if (!memberRect) {
      return;
    }

    const insets = memberInsetsForGroup(group);
    const minimumSize = isWorkspaceRootGroup(group)
      ? MINIMUM_WORKSPACE_ROOT_GROUP_SIZE
      : MINIMUM_CANVAS_GROUP_SIZE;
    const nextSize = {
      width: Math.max(
        minimumSize.width,
        Math.round(memberRect.right - group.position.x + insets.right)
      ),
      height: Math.max(
        minimumSize.height,
        Math.round(memberRect.bottom - group.position.y + insets.bottom)
      )
    };

    if (group.size.width === nextSize.width && group.size.height === nextSize.height) {
      return;
    }

    this.groupsById.set(group.id, {
      ...group,
      size: nextSize
    });
  }
}

class RelationAccumulator {
  private readonly weights = new Map<string, WeightedRelation>();
  private readonly itemsById: Map<string, LayoutItem>;

  public constructor(items: readonly LayoutItem[]) {
    this.itemsById = new Map(items.map((item) => [item.id, item] as const));
  }

  public add(leftId: string, rightId: string, weight: number): void {
    if (leftId === rightId || !this.itemsById.has(leftId) || !this.itemsById.has(rightId)) {
      return;
    }

    const leftItem = this.itemsById.get(leftId);
    const rightItem = this.itemsById.get(rightId);
    if (leftItem?.role === 'workspace-root' && rightItem?.role === 'workspace-root') {
      return;
    }

    const [left, right] = leftId < rightId ? [leftId, rightId] : [rightId, leftId];
    const key = `${left}\u0000${right}`;
    const current = this.weights.get(key);
    this.weights.set(key, {
      leftId: left,
      rightId: right,
      weight: (current?.weight ?? 0) + weight
    });
  }

  public values(): WeightedRelation[] {
    return [...this.weights.values()];
  }
}

function layoutComponent(items: readonly LayoutItem[], relations: readonly WeightedRelation[]): LayoutComponent {
  const orderedItems = items.slice().sort((left, right) => compareItemsForComponentOrder(left, right, relations));
  const relativePositions = new Map<string, CanvasNodePosition>();
  const rowLimit = orderedItems.length <= 3 ? orderedItems.length : 3;
  const rows: LayoutItem[][] = [];
  for (let index = 0; index < orderedItems.length; index += rowLimit) {
    rows.push(orderedItems.slice(index, index + rowLimit));
  }

  let y = 0;
  let width = 0;
  for (const row of rows) {
    let x = 0;
    let rowHeight = 0;
    for (const item of row) {
      relativePositions.set(item.id, { x, y });
      x += item.size.width + NODE_GAP;
      rowHeight = Math.max(rowHeight, item.size.height);
    }
    width = Math.max(width, Math.max(0, x - NODE_GAP));
    y += rowHeight + NODE_GAP;
  }

  const height = Math.max(0, y - NODE_GAP);
  const originalRect = boundingRectForRects(orderedItems.map((item) => rectForLayoutItem(item))) ?? {
    left: 0,
    top: 0,
    right: width,
    bottom: height
  };

  return {
    id: orderedItems.map((item) => item.id).sort().join('\u0000'),
    items: orderedItems,
    originalRect,
    width,
    height,
    relativePositions
  };
}

function packComponents(
  components: readonly LayoutComponent[],
  origin: CanvasNodePosition
): Map<string, CanvasNodePosition> {
  const positions = new Map<string, CanvasNodePosition>();
  const totalArea = components.reduce((sum, component) => sum + component.width * component.height, 0);
  const targetWidth = Math.max(
    DEFAULT_COMPONENT_TARGET_WIDTH,
    Math.round(Math.sqrt(Math.max(1, totalArea)) * 1.4)
  );
  let x = origin.x;
  let y = origin.y;
  let rowHeight = 0;

  for (const component of components) {
    if (x > origin.x && x + component.width > origin.x + targetWidth) {
      x = origin.x;
      y += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }

    positions.set(component.id, { x: Math.round(x), y: Math.round(y) });
    x += component.width + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, component.height);
  }

  return positions;
}

function collectFileOwnerNodeIds(node: CanvasNodeSummary): string[] {
  return [
    ...(node.metadata?.file?.ownerNodeIds ?? []),
    ...(node.metadata?.fileList?.ownerNodeId ? [node.metadata.fileList.ownerNodeId] : []),
    ...(node.metadata?.fileList?.entries ?? []).flatMap((entry) => entry.ownerNodeIds)
  ];
}

function collectFilePaths(node: CanvasNodeSummary): string[] {
  return [
    ...(node.metadata?.file?.filePath ? [node.metadata.file.filePath] : []),
    ...(node.metadata?.fileList?.entries ?? []).map((entry) => entry.filePath)
  ].filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0);
}

function compareItemsForComponentOrder(
  left: LayoutItem,
  right: LayoutItem,
  relations: readonly WeightedRelation[]
): number {
  const leftWeight = relationWeightForItem(left.id, relations);
  const rightWeight = relationWeightForItem(right.id, relations);
  return (
    itemPriority(left) - itemPriority(right) ||
    rightWeight - leftWeight ||
    compareItemsByExistingPosition(left, right)
  );
}

function relationWeightForItem(itemId: string, relations: readonly WeightedRelation[]): number {
  return relations.reduce(
    (sum, relation) => sum + (relation.leftId === itemId || relation.rightId === itemId ? relation.weight : 0),
    0
  );
}

function itemPriority(item: LayoutItem): number {
  if (item.kind === 'group') {
    return item.role === 'workspace-root' ? 0 : 4;
  }

  switch (item.nodeKind) {
    case 'agent':
      return 1;
    case 'terminal':
      return 2;
    case 'file':
    case 'file-list':
      return 3;
    case 'note':
      return 5;
    default:
      return 9;
  }
}

function compareLayoutComponents(left: LayoutComponent, right: LayoutComponent): number {
  return (
    left.originalRect.top - right.originalRect.top ||
    left.originalRect.left - right.originalRect.left ||
    right.items.length - left.items.length ||
    left.id.localeCompare(right.id)
  );
}

function compareItemsByExistingPosition(left: LayoutItem, right: LayoutItem): number {
  return (
    left.position.y - right.position.y ||
    left.position.x - right.position.x ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function compareNodesForLayout(left: CanvasNodeSummary, right: CanvasNodeSummary): number {
  return (
    left.position.y - right.position.y ||
    left.position.x - right.position.x ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function compareGroupsForLayout(left: CanvasGroupSummary, right: CanvasGroupSummary): number {
  return (
    left.position.y - right.position.y ||
    left.position.x - right.position.x ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function memberInsetsForGroup(group: Pick<CanvasGroupSummary, 'role'>): CanvasRectInsets {
  return isWorkspaceRootGroup(group) ? CANVAS_WORKSPACE_ROOT_GROUP_MEMBER_INSETS : CANVAS_GROUP_MEMBER_INSETS;
}

function rectForLayoutItem(item: Pick<LayoutItem, 'position' | 'size'>): CanvasRect {
  return {
    left: item.position.x,
    top: item.position.y,
    right: item.position.x + item.size.width,
    bottom: item.position.y + item.size.height
  };
}

function boundingRectForRects(rects: readonly CanvasRect[]): CanvasRect | undefined {
  if (rects.length === 0) {
    return undefined;
  }

  return rects.reduce(
    (current, rect) => ({
      left: Math.min(current.left, rect.left),
      top: Math.min(current.top, rect.top),
      right: Math.max(current.right, rect.right),
      bottom: Math.max(current.bottom, rect.bottom)
    }),
    rects[0]
  );
}

function translateNode(node: CanvasNodeSummary, delta: CanvasNodePosition): CanvasNodeSummary {
  return {
    ...node,
    position: {
      x: Math.round(node.position.x + delta.x),
      y: Math.round(node.position.y + delta.y)
    }
  };
}

function translateGroup(group: CanvasGroupSummary, delta: CanvasNodePosition): CanvasGroupSummary {
  return {
    ...group,
    position: {
      x: Math.round(group.position.x + delta.x),
      y: Math.round(group.position.y + delta.y)
    }
  };
}

function geometryEqual(left: CanvasPrototypeState, right: CanvasPrototypeState): boolean {
  const rightNodes = new Map(right.nodes.map((node) => [node.id, node] as const));
  const rightGroups = new Map((right.groups ?? []).map((group) => [group.id, group] as const));

  return (
    left.nodes.every((node) => {
      const rightNode = rightNodes.get(node.id);
      return (
        rightNode !== undefined &&
        node.position.x === rightNode.position.x &&
        node.position.y === rightNode.position.y &&
        node.size.width === rightNode.size.width &&
        node.size.height === rightNode.size.height &&
        node.groupId === rightNode.groupId
      );
    }) &&
    (left.groups ?? []).every((group) => {
      const rightGroup = rightGroups.get(group.id);
      return (
        rightGroup !== undefined &&
        group.position.x === rightGroup.position.x &&
        group.position.y === rightGroup.position.y &&
        group.size.width === rightGroup.size.width &&
        group.size.height === rightGroup.size.height &&
        group.parentGroupId === rightGroup.parentGroupId
      );
    })
  );
}
