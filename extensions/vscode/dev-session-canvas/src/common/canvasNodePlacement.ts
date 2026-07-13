import type {
  CanvasEdgeAnchor,
  CanvasNodeFootprint,
  CanvasNodePosition,
  CanvasNodeSummary
} from './protocol';

export const CANVAS_NODE_PLACEMENT_PADDING = 40;
export const CANVAS_NODE_PLACEMENT_STEP_X = 120;
export const CANVAS_NODE_PLACEMENT_STEP_Y = 96;
export const CANVAS_NODE_PLACEMENT_SEARCH_RADIUS = 8;
export const CANVAS_POSITION_GRID_SIZE = 20;
export const CANVAS_FORK_LAYER_GAP = CANVAS_NODE_PLACEMENT_PADDING * 2;

export type CanvasNodePlacementPreference = 'left-up' | 'right-down';
export type CanvasForkPlacementDirection = 'up' | 'down' | 'right';

export interface CanvasPlacementRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type CanvasPlacementNode = Pick<CanvasNodeSummary, 'position' | 'size'>;

export function normalizeCanvasForkPlacementDirection(value: unknown): CanvasForkPlacementDirection {
  return value === 'down' || value === 'right' ? value : 'up';
}

export function snapCanvasPosition(position: CanvasNodePosition): CanvasNodePosition {
  return {
    x: snapCanvasCoordinate(position.x),
    y: snapCanvasCoordinate(position.y)
  };
}

export function createCanvasPlacementRect(
  position: CanvasNodePosition,
  footprint: CanvasNodeFootprint
): CanvasPlacementRect {
  return {
    left: position.x,
    top: position.y,
    right: position.x + footprint.width,
    bottom: position.y + footprint.height
  };
}

export function canvasPlacementRectsOverlap(
  left: CanvasPlacementRect,
  right: CanvasPlacementRect,
  padding = CANVAS_NODE_PLACEMENT_PADDING
): boolean {
  return (
    left.left < right.right + padding &&
    left.right > right.left - padding &&
    left.top < right.bottom + padding &&
    left.bottom > right.top - padding
  );
}

export function doesCanvasNodePlacementCollide(options: {
  occupiedNodes: readonly CanvasPlacementNode[];
  targetPosition: CanvasNodePosition;
  targetSize: CanvasNodeFootprint;
  padding?: number;
}): boolean {
  const targetRect = createCanvasPlacementRect(options.targetPosition, options.targetSize);
  return options.occupiedNodes.some((node) =>
    canvasPlacementRectsOverlap(
      targetRect,
      createCanvasPlacementRect(node.position, node.size),
      options.padding
    )
  );
}

export function resolveNearbyNonOverlappingNodePosition(options: {
  occupiedNodes: readonly CanvasPlacementNode[];
  targetSize: CanvasNodeFootprint;
  anchor: CanvasNodePosition;
  preference?: CanvasNodePlacementPreference;
  padding?: number;
}): CanvasNodePosition {
  const preference = options.preference ?? 'right-down';
  const normalizedAnchor = snapCanvasPosition(options.anchor);

  for (const candidate of buildNearbyPlacementCandidates(normalizedAnchor, preference)) {
    if (!doesCanvasNodePlacementCollide({
      occupiedNodes: options.occupiedNodes,
      targetPosition: candidate,
      targetSize: options.targetSize,
      padding: options.padding
    })) {
      return candidate;
    }
  }

  return fallbackNearbyPlacementPosition({
    occupiedNodes: options.occupiedNodes,
    targetSize: options.targetSize,
    normalizedAnchor,
    preference,
    padding: options.padding ?? CANVAS_NODE_PLACEMENT_PADDING
  });
}

export function buildNearbyPlacementCandidates(
  anchor: CanvasNodePosition,
  preference: CanvasNodePlacementPreference
): CanvasNodePosition[] {
  const offsets: Array<{ dx: number; dy: number; distance: number; backwardBias: number }> = [];

  for (let dx = -CANVAS_NODE_PLACEMENT_SEARCH_RADIUS; dx <= CANVAS_NODE_PLACEMENT_SEARCH_RADIUS; dx += 1) {
    for (let dy = -CANVAS_NODE_PLACEMENT_SEARCH_RADIUS; dy <= CANVAS_NODE_PLACEMENT_SEARCH_RADIUS; dy += 1) {
      offsets.push({
        dx,
        dy,
        distance: Math.abs(dx) + Math.abs(dy),
        backwardBias: (dx < 0 ? 1 : 0) + (dy < 0 ? 1 : 0)
      });
    }
  }

  offsets.sort((left, right) => {
    const preferredSign = preference === 'left-up' ? 'negative' : 'positive';
    const leftHorizontalRank = resolvePlacementAxisRank(left.dx, preferredSign);
    const rightHorizontalRank = resolvePlacementAxisRank(right.dx, preferredSign);
    const leftVerticalRank = resolvePlacementAxisRank(left.dy, preferredSign);
    const rightVerticalRank = resolvePlacementAxisRank(right.dy, preferredSign);
    const leftPreferenceRank = leftHorizontalRank + leftVerticalRank;
    const rightPreferenceRank = rightHorizontalRank + rightVerticalRank;

    if (leftPreferenceRank !== rightPreferenceRank) {
      return leftPreferenceRank - rightPreferenceRank;
    }
    if (leftHorizontalRank !== rightHorizontalRank) {
      return leftHorizontalRank - rightHorizontalRank;
    }
    if (leftVerticalRank !== rightVerticalRank) {
      return leftVerticalRank - rightVerticalRank;
    }
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    if (left.backwardBias !== right.backwardBias) {
      return left.backwardBias - right.backwardBias;
    }
    if (Math.abs(left.dy) !== Math.abs(right.dy)) {
      return Math.abs(left.dy) - Math.abs(right.dy);
    }
    if (Math.abs(left.dx) !== Math.abs(right.dx)) {
      return Math.abs(left.dx) - Math.abs(right.dx);
    }
    if (left.dy !== right.dy) {
      return left.dy - right.dy;
    }
    return left.dx - right.dx;
  });

  return offsets.map(({ dx, dy }) =>
    snapCanvasPosition({
      x: anchor.x + dx * CANVAS_NODE_PLACEMENT_STEP_X,
      y: anchor.y + dy * CANVAS_NODE_PLACEMENT_STEP_Y
    })
  );
}

export function resolveForkLayerNodePosition(options: {
  occupiedNodes: readonly CanvasPlacementNode[];
  sourceNode: CanvasPlacementNode;
  targetSize: CanvasNodeFootprint;
  direction: CanvasForkPlacementDirection;
  layerGap?: number;
  padding?: number;
}): CanvasNodePosition {
  const padding = options.padding ?? CANVAS_NODE_PLACEMENT_PADDING;
  const direction = normalizeCanvasForkPlacementDirection(options.direction);
  const basePosition = resolveForkLayerBasePosition(
    options.sourceNode,
    options.targetSize,
    direction,
    options.layerGap ?? CANVAS_FORK_LAYER_GAP
  );
  const slotStep = snapCanvasCoordinateUp(
    direction === 'right'
      ? options.targetSize.height + padding
      : options.targetSize.width + padding
  );
  const localSlotCount = options.occupiedNodes.length + 1;

  for (let slot = 0; slot <= localSlotCount; slot += 1) {
    const offsets = slot === 0 ? [0] : [slot * slotStep, -slot * slotStep];
    for (const offset of offsets) {
      const candidate = snapCanvasPosition(
        direction === 'right'
          ? { x: basePosition.x, y: basePosition.y + offset }
          : { x: basePosition.x + offset, y: basePosition.y }
      );
      if (!doesCanvasNodePlacementCollide({
        occupiedNodes: options.occupiedNodes,
        targetPosition: candidate,
        targetSize: options.targetSize,
        padding
      })) {
        return candidate;
      }
    }
  }

  const fallback = resolveForkLayerFallbackPosition(
    options.occupiedNodes,
    basePosition,
    direction,
    padding
  );
  if (doesCanvasNodePlacementCollide({
    occupiedNodes: options.occupiedNodes,
    targetPosition: fallback,
    targetSize: options.targetSize,
    padding
  })) {
    throw new Error('Fork layer placement fallback overlaps an occupied node.');
  }
  return fallback;
}

export function resolveForkEdgeAnchors(
  direction: CanvasForkPlacementDirection
): { sourceAnchor: CanvasEdgeAnchor; targetAnchor: CanvasEdgeAnchor } {
  switch (normalizeCanvasForkPlacementDirection(direction)) {
    case 'down':
      return { sourceAnchor: 'bottom', targetAnchor: 'top' };
    case 'right':
      return { sourceAnchor: 'right', targetAnchor: 'left' };
    case 'up':
      return { sourceAnchor: 'top', targetAnchor: 'bottom' };
  }
}

function snapCanvasCoordinate(value: number): number {
  return Math.round(value / CANVAS_POSITION_GRID_SIZE) * CANVAS_POSITION_GRID_SIZE;
}

function snapCanvasCoordinateUp(value: number): number {
  return Math.ceil(value / CANVAS_POSITION_GRID_SIZE) * CANVAS_POSITION_GRID_SIZE;
}

function resolvePlacementAxisRank(value: number, preferredSign: 'negative' | 'positive'): number {
  if (value === 0) {
    return 1;
  }
  const matchesPreferred = preferredSign === 'negative' ? value < 0 : value > 0;
  return matchesPreferred ? 0 : 2;
}

function fallbackNearbyPlacementPosition(options: {
  occupiedNodes: readonly CanvasPlacementNode[];
  targetSize: CanvasNodeFootprint;
  normalizedAnchor: CanvasNodePosition;
  preference: CanvasNodePlacementPreference;
  padding: number;
}): CanvasNodePosition {
  if (options.occupiedNodes.length === 0) {
    return options.normalizedAnchor;
  }

  const bounds = options.occupiedNodes.reduce(
    (current, node) => {
      const rect = createCanvasPlacementRect(node.position, node.size);
      return {
        maxRight: Math.max(current.maxRight, rect.right),
        minLeft: Math.min(current.minLeft, rect.left),
        minTop: Math.min(current.minTop, rect.top),
        maxBottom: Math.max(current.maxBottom, rect.bottom)
      };
    },
    {
      maxRight: Number.NEGATIVE_INFINITY,
      minLeft: Number.POSITIVE_INFINITY,
      minTop: Number.POSITIVE_INFINITY,
      maxBottom: Number.NEGATIVE_INFINITY
    }
  );

  if (options.preference === 'left-up') {
    return snapCanvasPosition({
      x: bounds.minLeft - options.targetSize.width - options.padding,
      y: Math.min(
        bounds.minTop - options.targetSize.height - options.padding,
        options.normalizedAnchor.y - Math.round(options.targetSize.height / 3)
      )
    });
  }

  return snapCanvasPosition({
    x: bounds.maxRight + options.padding,
    y: Math.max(
      bounds.maxBottom - Math.round(options.targetSize.height / 2),
      options.normalizedAnchor.y
    )
  });
}

function resolveForkLayerBasePosition(
  sourceNode: CanvasPlacementNode,
  targetSize: CanvasNodeFootprint,
  direction: CanvasForkPlacementDirection,
  layerGap: number
): CanvasNodePosition {
  const centeredX = sourceNode.position.x + (sourceNode.size.width - targetSize.width) / 2;
  const centeredY = sourceNode.position.y + (sourceNode.size.height - targetSize.height) / 2;
  switch (direction) {
    case 'down':
      return snapCanvasPosition({
        x: centeredX,
        y: sourceNode.position.y + sourceNode.size.height + layerGap
      });
    case 'right':
      return snapCanvasPosition({
        x: sourceNode.position.x + sourceNode.size.width + layerGap,
        y: centeredY
      });
    case 'up':
      return snapCanvasPosition({
        x: centeredX,
        y: sourceNode.position.y - targetSize.height - layerGap
      });
  }
}

function resolveForkLayerFallbackPosition(
  occupiedNodes: readonly CanvasPlacementNode[],
  basePosition: CanvasNodePosition,
  direction: CanvasForkPlacementDirection,
  padding: number
): CanvasNodePosition {
  if (occupiedNodes.length === 0) {
    return basePosition;
  }

  if (direction === 'right') {
    const maxBottom = Math.max(
      ...occupiedNodes.map((node) => node.position.y + node.size.height)
    );
    return {
      x: basePosition.x,
      y: snapCanvasCoordinateUp(maxBottom + padding)
    };
  }

  const maxRight = Math.max(
    ...occupiedNodes.map((node) => node.position.x + node.size.width)
  );
  return {
    x: snapCanvasCoordinateUp(maxRight + padding),
    y: basePosition.y
  };
}
