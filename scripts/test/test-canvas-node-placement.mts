import assert from 'node:assert/strict';

import {
  CANVAS_FORK_LAYER_GAP,
  CANVAS_NODE_PLACEMENT_PADDING,
  canvasPlacementRectsOverlap,
  createCanvasPlacementRect,
  resolveAlignedNonOverlappingNodePosition,
  resolvePointerNodePlacementReference,
  resolveForkEdgeAnchors,
  resolveForkLayerNodePosition,
  resolveNearbyNonOverlappingNodePosition
} from '../../extensions/vscode/dev-session-canvas/src/common/canvasNodePlacement.ts';

const source = {
  position: { x: 200, y: 200 },
  size: { width: 560, height: 430 }
};
const targetSize = { width: 560, height: 430 };

function node(position: { x: number; y: number }, size = targetSize, id = 'node') {
  return { id, position, size };
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
    assert.deepEqual(
      children.map((child) => child.position.y),
      [200, 680, -280],
      '向右 Fork 应按中心、最近正槽、最近负槽的顺序展开。'
    );
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

const smallSize = { width: 200, height: 120 };
function aligned(occupiedNodes: ReturnType<typeof node>[], anchor: { x: number; y: number }, size = smallSize,
  creationAnchor?: { position: { x: number; y: number }; zoom: number }) {
  const before = structuredClone(occupiedNodes);
  const position = resolveAlignedNonOverlappingNodePosition({ occupiedNodes, targetSize: size, anchor, creationAnchor });
  assert.deepEqual(occupiedNodes, before, '创建对齐不能修改旧节点的位置或尺寸。');
  assert.equal(occupiedNodes.some((occupied) => overlaps(node(position, size), occupied)), false,
    '所有创建结果必须保留安全间距。');
  return position;
}

assert.deepEqual(aligned([], { x: 13, y: -31 }), { x: 20, y: -40 }, '空画布不应额外向右下偏移。');
assert.deepEqual(aligned([node({ x: 0, y: 0 }, smallSize)], { x: 900, y: 800 }), { x: 900, y: 800 });
assert.deepEqual(aligned([node({ x: 7, y: 13 }, smallSize)], { x: 260, y: 40 }), { x: 260, y: 40 },
  '没有 P 的旧消息不能触发矩形边缘吸附。');

const referenceNode = node({ x: 7, y: 13 }, smallSize, 'a');
for (const [direction, points] of [
  ['right', [{ x: 208, y: 13 }, { x: 367, y: 133 }]],
  ['down', [{ x: 7, y: 134 }, { x: 207, y: 293 }]],
  ['left', [{ x: 6, y: 13 }, { x: -153, y: 133 }]],
  ['up', [{ x: 7, y: 12 }, { x: 207, y: -147 }]]
] as const) {
  for (const position of points) {
    const creationAnchor = { position, zoom: 1 };
    assert.equal(resolvePointerNodePlacementReference([referenceNode], creationAnchor)?.direction, direction);
    for (const size of [smallSize, targetSize, { width: 731, height: 317 }]) {
      const result = aligned([referenceNode], { x: 9999, y: 9999 }, size, creationAnchor);
      assert.deepEqual(result, {
        x: direction === 'right' ? 247 : direction === 'left' ? 7 - size.width - 40 : 7,
        y: direction === 'down' ? 173 : direction === 'up' ? 13 - size.height - 40 : 13
      }, '相同区域不同 P、不同尺寸 B，选择相同方向和对齐边。');
    }
  }
}

for (const zoom of [0.25, 0.5, 1, 2, 4]) {
  assert.equal(resolvePointerNodePlacementReference([referenceNode], {
    position: { x: 207 + 160 / zoom, y: 50 }, zoom
  })?.direction, 'right');
  assert.equal(resolvePointerNodePlacementReference([referenceNode], {
    position: { x: 207 + 160 / zoom + 0.01, y: 50 }, zoom
  }), undefined, '缩放后仍只命中屏幕 160px 范围。');
}
for (const position of [{ x: 208, y: 134 }, { x: 6, y: 12 }, { x: 50, y: 50 }, { x: 207, y: 50 }]) {
  assert.equal(resolvePointerNodePlacementReference([referenceNode], { position, zoom: 1 }), undefined,
    '斜角、内部和边缘本身不触发对齐。');
}
assert.deepEqual(aligned([], { x: 9999, y: 9999 }, smallSize, { position: { x: 600, y: 400 }, zoom: 1 }),
  { x: 500, y: 340 }, '未命中区域时以原 P 为中心。');
assert.deepEqual(aligned([referenceNode], { x: 9999, y: 9999 }, smallSize,
  { position: { x: 600, y: 400 }, zoom: 1 }), { x: 500, y: 340 });

{
  const other = node({ x: 400, y: 13 }, smallSize, 'd');
  const creationAnchor = { position: { x: 270, y: 50 }, zoom: 1 };
  for (const nodes of [[referenceNode, other], [other, referenceNode]]) {
    assert.equal(resolvePointerNodePlacementReference(nodes, creationAnchor)?.node.id, 'a');
  }
  const tied = node(referenceNode.position, smallSize, 'b');
  assert.equal(resolvePointerNodePlacementReference([tied, referenceNode], creationAnchor)?.node.id, 'a');
  assert.equal(resolvePointerNodePlacementReference([other, referenceNode], {
    position: { x: 303.5, y: 50 }, zoom: 1
  })?.direction, 'right', '不同方向同距时按右、下、左、上选择。');
}

for (const [direction, pointer, blockers, expected] of [
  ['right', { x: 220, y: 20 }, [node({ x: 260, y: 100 }, smallSize), node({ x: 510, y: 90 }, smallSize)], { x: 750, y: 13 }],
  ['left', { x: 0, y: 20 }, [node({ x: -230, y: 100 }, smallSize), node({ x: -470, y: 90 }, smallSize)], { x: -710, y: 13 }],
  ['down', { x: 20, y: 140 }, [node({ x: 100, y: 200 }, smallSize), node({ x: 90, y: 380 }, smallSize)], { x: 7, y: 540 }],
  ['up', { x: 20, y: 0 }, [node({ x: 100, y: -180 }, smallSize), node({ x: 90, y: -350 }, smallSize)], { x: 7, y: -510 }]
] as const) {
  for (const obstacles of [blockers, [...blockers].reverse()]) {
    const creationAnchor = { position: pointer, zoom: 1 };
    assert.equal(resolvePointerNodePlacementReference([referenceNode, ...obstacles], creationAnchor)?.direction, direction);
    assert.deepEqual(aligned([referenceNode, ...obstacles], pointer, smallSize, creationAnchor), expected,
      '越过不同高度的多个障碍仍保持原方向，且不依赖节点顺序。');
  }
}

for (const size of [smallSize, targetSize, { width: 731, height: 317 }]) {
  const occupied: ReturnType<typeof node>[] = [];
  for (let index = 0; index < 20; index += 1) {
    const creationAnchor = { position: { x: size.width + 10, y: 20 }, zoom: 1 };
    const position = aligned(occupied, { x: 0, y: 0 }, size, index === 0 ? undefined : creationAnchor);
    assert.equal(position.y, 0, '连续创建应沿右侧保持一行。');
    occupied.push(node(position, size, `node-${index}`));
  }
}

{
  const occupied = [node({ x: -5000, y: -5000 }, { width: 10007, height: 10013 })];
  aligned(occupied, { x: 0, y: 0 });
}

{
  const occupied = [
    node({ x: -517, y: 113 }, { width: 731, height: 317 }),
    node({ x: 811, y: -343 }, targetSize)
  ];
  for (let index = 0; index < 40; index += 1) {
    const size = { width: 180 + index * 37 % 600, height: 100 + index * 53 % 400 };
    const anchor = { x: index * 113 % 1200 - 600, y: index * 157 % 1200 - 600 };
    occupied.push(node(aligned(occupied, anchor, size), size));
  }
}

console.log('canvas node placement tests passed');
