import assert from 'node:assert/strict';

import {
  CANVAS_FORK_LAYER_GAP,
  CANVAS_NODE_PLACEMENT_PADDING,
  canvasPlacementRectsOverlap,
  createCanvasPlacementRect,
  resolveForkEdgeAnchors,
  resolveForkLayerNodePosition,
  resolveNearbyNonOverlappingNodePosition
} from '../../extensions/vscode/dev-session-canvas/src/common/canvasNodePlacement.ts';

const source = {
  position: { x: 200, y: 200 },
  size: { width: 560, height: 430 }
};
const targetSize = { width: 560, height: 430 };

function node(position: { x: number; y: number }, size = targetSize) {
  return { position, size };
}

function overlaps(
  left: { position: { x: number; y: number }; size: { width: number; height: number } },
  right: { position: { x: number; y: number }; size: { width: number; height: number } }
): boolean {
  return canvasPlacementRectsOverlap(
    createCanvasPlacementRect(left.position, left.size),
    createCanvasPlacementRect(right.position, right.size),
    CANVAS_NODE_PLACEMENT_PADDING
  );
}

for (const [direction, expectedPosition, expectedAnchors] of [
  [
    'up',
    { x: 200, y: -300 },
    { sourceAnchor: 'top', targetAnchor: 'bottom' }
  ],
  [
    'down',
    { x: 200, y: 720 },
    { sourceAnchor: 'bottom', targetAnchor: 'top' }
  ],
  [
    'right',
    { x: 840, y: 200 },
    { sourceAnchor: 'right', targetAnchor: 'left' }
  ]
] as const) {
  const position = resolveForkLayerNodePosition({
    occupiedNodes: [source],
    sourceNode: source,
    targetSize,
    direction
  });
  assert.deepEqual(position, expectedPosition, `${direction} 应落在来源节点对应方向。`);
  assert.deepEqual(resolveForkEdgeAnchors(direction), expectedAnchors);
  assert.equal(overlaps(node(position), source), false);
}

for (const direction of ['up', 'down', 'right'] as const) {
  const occupied = [source];
  const children = [];
  for (let index = 0; index < 3; index += 1) {
    const position = resolveForkLayerNodePosition({
      occupiedNodes: occupied,
      sourceNode: source,
      targetSize,
      direction
    });
    const child = node(position);
    children.push(child);
    occupied.push(child);
  }

  for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
      assert.equal(overlaps(children[leftIndex], children[rightIndex]), false);
    }
  }
  if (direction === 'right') {
    assert.equal(new Set(children.map((child) => child.position.x)).size, 1);
  } else {
    assert.equal(new Set(children.map((child) => child.position.y)).size, 1);
  }
}

{
  const firstUp = resolveForkLayerNodePosition({
    occupiedNodes: [source],
    sourceNode: source,
    targetSize,
    direction: 'up'
  });
  const obstacle = node(firstUp, { width: 2400, height: 430 });
  const fallback = resolveForkLayerNodePosition({
    occupiedNodes: [source, obstacle],
    sourceNode: source,
    targetSize,
    direction: 'up'
  });
  assert.equal(fallback.y, firstUp.y, '超大障碍 fallback 仍应留在同一层级线。');
  assert.equal(overlaps(node(fallback), obstacle), false);
}

{
  const existing = [
    node({ x: 0, y: 0 }, { width: 200, height: 120 }),
    node({ x: 240, y: 0 }, { width: 200, height: 120 })
  ];
  const position = resolveNearbyNonOverlappingNodePosition({
    occupiedNodes: existing,
    targetSize: { width: 180, height: 100 },
    anchor: { x: 0, y: 0 }
  });
  assert.equal(existing.some((candidate) => overlaps(node(position, { width: 180, height: 100 }), candidate)), false);
}

assert.equal(CANVAS_FORK_LAYER_GAP, 80);
console.log('canvas node placement tests passed');
