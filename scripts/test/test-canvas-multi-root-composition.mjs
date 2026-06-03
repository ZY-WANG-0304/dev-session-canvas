import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-canvas-multi-root-composition-'));

try {
  const outfile = path.join(tempDir, 'canvas-multi-root-composition.cjs');
  await esbuild.build({
    stdin: {
      contents: `export * from './src/common/canvasMultiRootComposition';`,
      resolveDir: process.cwd(),
      sourcefile: 'canvas-multi-root-composition-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    composeRootLocalCanvasStateIntoComposed,
    composeMultiRootCanvasState,
    decomposeMultiRootCanvasState,
    createWorkspaceRootSectionId,
    namespaceCanvasObjectId,
    isWorkspaceRootGroup,
    sanitizeRootLocalCanvasState
  } = require(outfile);

  const frontendRoot = path.join(tempDir, 'frontend');
  const backendRoot = path.join(tempDir, 'backend');
  const folders = [
    { name: 'frontend', path: frontendRoot },
    { name: 'backend', path: backendRoot }
  ];
  const frontendState = state({
    nodes: [note('note-1', { x: 20, y: 30 }, { groupId: 'group-1' })],
    groups: [group('group-1', { x: 0, y: 0 }, { width: 360, height: 240 })],
    edges: [],
    nextGroupSequence: 2
  });
  const backendState = state({
    nodes: [note('note-1', { x: 40, y: 50 })],
    groups: [],
    edges: [],
    nextGroupSequence: 1
  });

  const composed = composeMultiRootCanvasState({
    workspaceFolders: folders,
    rootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    overlay: {
      version: 1,
      roots: [
        { rootPath: frontendRoot, position: { x: 100, y: 200 }, size: { width: 900, height: 700 } },
        { rootPath: backendRoot, position: { x: 1200, y: 200 } }
      ]
    },
    now: '2026-06-04T00:00:00.000Z'
  });

  const frontendRootGroupId = createWorkspaceRootSectionId(frontendRoot);
  const backendRootGroupId = createWorkspaceRootSectionId(backendRoot);
  assert.ok(composed.groups.find((candidate) => candidate.id === frontendRootGroupId && isWorkspaceRootGroup(candidate)));
  assert.ok(composed.groups.find((candidate) => candidate.id === backendRootGroupId && isWorkspaceRootGroup(candidate)));
  assert.equal(composed.nodes.length, 2);
  assert.notEqual(composed.nodes[0].id, composed.nodes[1].id, '同名 root-local node id 必须命名空间化避免冲突。');

  const frontendComposedNode = composed.nodes.find((candidate) => candidate.id === namespaceCanvasObjectId(frontendRoot, 'note-1'));
  assert.deepEqual(frontendComposedNode.position, { x: 200, y: 310 });
  assert.equal(frontendComposedNode.groupId, namespaceCanvasObjectId(frontendRoot, 'group-1'));
  const frontendComposedGroup = composed.groups.find((candidate) => candidate.id === namespaceCanvasObjectId(frontendRoot, 'group-1'));
  assert.equal(frontendComposedGroup.parentGroupId, frontendRootGroupId);

  const pollutedFrontendRootLocalState = state({
    nodes: [
      note('note-polluted', { x: 180, y: 220 }, { groupId: frontendRootGroupId }),
      note('note-polluted-grouped', { x: 260, y: 260 }, { groupId: 'group-polluted' })
    ],
    groups: [
      group(frontendRootGroupId, { x: 100, y: 200 }, { width: 900, height: 700 }, {
        role: 'workspace-root',
        workspaceRootPath: frontendRoot
      }),
      group('group-polluted', { x: 240, y: 240 }, { width: 360, height: 240 }, { parentGroupId: frontendRootGroupId })
    ]
  });
  const sanitizedFrontendRootLocalState = sanitizeRootLocalCanvasState(frontendRoot, pollutedFrontendRootLocalState);
  assert.ok(!sanitizedFrontendRootLocalState.groups.some((candidate) => candidate.id === frontendRootGroupId || candidate.role === 'workspace-root'));
  assert.deepEqual(sanitizedFrontendRootLocalState.nodes.find((candidate) => candidate.id === 'note-polluted').position, { x: 0, y: -60 });
  assert.equal(sanitizedFrontendRootLocalState.nodes.find((candidate) => candidate.id === 'note-polluted').groupId, undefined);
  assert.deepEqual(sanitizedFrontendRootLocalState.groups.find((candidate) => candidate.id === 'group-polluted').position, { x: 60, y: -40 });
  assert.equal(sanitizedFrontendRootLocalState.groups.find((candidate) => candidate.id === 'group-polluted').parentGroupId, undefined);

  const composedWithoutOverlay = composeMultiRootCanvasState({
    workspaceFolders: folders,
    rootStates: [
      {
        rootPath: frontendRoot,
        state: state({
          nodes: [note('large-note', { x: 20, y: 30 }, { size: { width: 1200, height: 220 } })]
        })
      },
      { rootPath: backendRoot, state: backendState }
    ],
    now: '2026-06-04T00:30:00.000Z'
  });
  assert.ok(
    !rectsOverlap(
      rectForGroup(composedWithoutOverlay.groups.find((candidate) => candidate.id === frontendRootGroupId)),
      rectForGroup(composedWithoutOverlay.groups.find((candidate) => candidate.id === backendRootGroupId))
    ),
    '没有 overlay 时，默认 root 铺排必须按本轮最大 root section 尺寸计算，避免不同自然尺寸的 root section 重叠。'
  );

  const movedRootDelta = { x: 300, y: 300 };
  const movedRootState = {
    ...composed,
    groups: composed.groups.map((candidate) =>
      candidate.id === frontendRootGroupId
        ? { ...candidate, position: { x: candidate.position.x + movedRootDelta.x, y: candidate.position.y + movedRootDelta.y } }
        : candidate.id.startsWith(`${frontendRootGroupId}:`)
          ? { ...candidate, position: { x: candidate.position.x + movedRootDelta.x, y: candidate.position.y + movedRootDelta.y } }
        : candidate
    ),
    nodes: composed.nodes.map((candidate) =>
      candidate.id.startsWith(`${frontendRootGroupId}:`)
        ? { ...candidate, position: { x: candidate.position.x + movedRootDelta.x, y: candidate.position.y + movedRootDelta.y } }
        : candidate
    )
  };
  const decomposedAfterRootMove = decomposeMultiRootCanvasState({
    composedState: movedRootState,
    workspaceFolders: folders,
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    now: '2026-06-04T01:00:00.000Z'
  });
  const frontendAfterRootMove = decomposedAfterRootMove.rootStates.find((entry) => entry.rootPath === path.resolve(frontendRoot)).state;
  assert.deepEqual(frontendAfterRootMove.nodes[0].position, { x: 20, y: 30 }, '移动 root section 及其子树只改变 multi-root overlay，不改写 root-local 节点坐标。');
  assert.deepEqual(decomposedAfterRootMove.overlay.roots.find((root) => root.rootPath === path.resolve(frontendRoot)).position, { x: 400, y: 500 });

  const composedWithWorkspaceGroup = composeMultiRootCanvasState({
    workspaceFolders: folders,
    rootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    overlay: {
      version: 1,
      groups: [
        {
          id: 'group-workspace-roots',
          title: 'Workspace roots',
          position: { x: 40, y: 120 },
          size: { width: 1600, height: 760 }
        }
      ],
      roots: [
        { rootPath: frontendRoot, position: { x: 100, y: 200 }, size: { width: 900, height: 700 }, parentGroupId: 'group-workspace-roots' },
        { rootPath: backendRoot, position: { x: 1200, y: 200 }, parentGroupId: 'group-workspace-roots' }
      ]
    }
  });
  assert.equal(composedWithWorkspaceGroup.groups.find((candidate) => candidate.id === frontendRootGroupId).parentGroupId, 'group-workspace-roots');
  assert.equal(composedWithWorkspaceGroup.groups.find((candidate) => candidate.id === backendRootGroupId).parentGroupId, 'group-workspace-roots');
  const decomposedWithWorkspaceGroup = decomposeMultiRootCanvasState({
    composedState: composedWithWorkspaceGroup,
    workspaceFolders: folders,
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    now: '2026-06-04T01:30:00.000Z'
  });
  assert.equal(decomposedWithWorkspaceGroup.overlay.groups.length, 1);
  assert.equal(decomposedWithWorkspaceGroup.overlay.groups[0].id, 'group-workspace-roots');
  assert.equal(decomposedWithWorkspaceGroup.overlay.roots.find((root) => root.rootPath === path.resolve(frontendRoot)).parentGroupId, 'group-workspace-roots');
  assert.ok(
    !decomposedWithWorkspaceGroup.rootStates
      .flatMap((entry) => entry.state.groups)
      .some((candidate) => candidate.id === 'group-workspace-roots'),
    '包含多个 root 的外层普通分组必须只保存在 multi-root overlay 中。'
  );

  const createdLocalNode = note('note-created', { x: 300, y: 420 }, { groupId: frontendRootGroupId });
  const decomposedAfterCreate = decomposeMultiRootCanvasState({
    composedState: {
      ...composed,
      nodes: [...composed.nodes, createdLocalNode]
    },
    workspaceFolders: folders,
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    now: '2026-06-04T03:00:00.000Z'
  });
  const frontendAfterCreate = decomposedAfterCreate.rootStates.find((entry) => entry.rootPath === path.resolve(frontendRoot)).state;
  assert.ok(frontendAfterCreate.nodes.some((candidate) => candidate.id === 'note-created'));
  assert.deepEqual(frontendAfterCreate.nodes.find((candidate) => candidate.id === 'note-created').position, { x: 120, y: 140 });

  const composedAfterRootLocalReplacement = composeRootLocalCanvasStateIntoComposed(
    {
      ...composed,
      edges: [
        ...composed.edges,
        {
          id: 'edge-cross-root',
          sourceNodeId: namespaceCanvasObjectId(frontendRoot, 'note-1'),
          targetNodeId: namespaceCanvasObjectId(backendRoot, 'note-1'),
          sourceAnchor: 'right',
          targetAnchor: 'left',
          arrowMode: 'forward',
          owner: 'user'
        }
      ]
    },
    state({
      nodes: [note('note-created-via-helper', { x: 16, y: 24 })],
      groups: [],
      edges: []
    }),
    composed.groups.find((candidate) => candidate.id === frontendRootGroupId)
  );
  assert.ok(composedAfterRootLocalReplacement.nodes.some((candidate) => candidate.id === namespaceCanvasObjectId(frontendRoot, 'note-created-via-helper')));
  assert.ok(!composedAfterRootLocalReplacement.nodes.some((candidate) => candidate.id === namespaceCanvasObjectId(frontendRoot, 'note-1')));
  assert.ok(
    !composedAfterRootLocalReplacement.edges.some((candidate) => candidate.id === 'edge-cross-root'),
    '替换 root-local 子图时，连接到旧 root-local 节点的跨 root 边不能残留。'
  );

  console.log('canvas multi-root composition tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function state(overrides = {}) {
  return {
    version: 1,
    updatedAt: '2026-06-04T00:00:00.000Z',
    nodes: [],
    edges: [],
    groups: [],
    nextGroupSequence: 1,
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: [],
    ...overrides
  };
}

function note(id, position, options = {}) {
  return {
    id,
    kind: 'note',
    title: id,
    status: 'ready',
    summary: '',
    position,
    size: options.size ?? { width: 320, height: 220 },
    groupId: options.groupId,
    metadata: { note: { content: '' } }
  };
}

function group(id, position, size, options = {}) {
  return {
    id,
    title: id,
    position,
    size,
    parentGroupId: options.parentGroupId,
    role: options.role,
    workspaceRootPath: options.workspaceRootPath
  };
}

function rectForGroup(group) {
  return {
    left: group.position.x,
    top: group.position.y,
    right: group.position.x + group.size.width,
    bottom: group.position.y + group.size.height
  };
}

function rectsOverlap(left, right) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}
