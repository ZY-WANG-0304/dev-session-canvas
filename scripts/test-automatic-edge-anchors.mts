import assert from 'node:assert/strict';

import { resolveHorizontalCanvasEdgeAnchors } from '../src/common/protocol.ts';

function run(): void {
  assert.deepStrictEqual(
    resolveHorizontalCanvasEdgeAnchors(
      {
        position: { x: 100, y: 120 },
        size: { width: 220, height: 84 }
      },
      {
        position: { x: 480, y: 140 },
        size: { width: 560, height: 430 }
      }
    ),
    {
      sourceAnchor: 'right',
      targetAnchor: 'left'
    },
    '当源节点位于目标节点左侧时，应优先使用右 -> 左锚点。'
  );

  assert.deepStrictEqual(
    resolveHorizontalCanvasEdgeAnchors(
      {
        position: { x: 720, y: 220 },
        size: { width: 560, height: 430 }
      },
      {
        position: { x: 240, y: 260 },
        size: { width: 220, height: 84 }
      }
    ),
    {
      sourceAnchor: 'left',
      targetAnchor: 'right'
    },
    '当源节点位于目标节点右侧时，应优先使用左 -> 右锚点。'
  );

  assert.deepStrictEqual(
    resolveHorizontalCanvasEdgeAnchors(
      {
        position: { x: 0, y: 0 },
        size: { width: 560, height: 430 }
      },
      {
        position: { x: 170, y: 240 },
        size: { width: 220, height: 84 }
      }
    ),
    {
      sourceAnchor: 'right',
      targetAnchor: 'left'
    },
    '当左右方案距离相同或接近时，应稳定回退到右 -> 左锚点。'
  );
}

run();
