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
  const utilityRoot = path.join(tempDir, 'utility');
  const normalizedFrontendRoot = normalizeRootPathForTest(frontendRoot);
  const normalizedBackendRoot = normalizeRootPathForTest(backendRoot);
  const normalizedUtilityRoot = normalizeRootPathForTest(utilityRoot);
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

  const composedAfterAddingFolder = composeMultiRootCanvasState({
    workspaceFolders: [
      ...folders,
      { name: 'utility', path: utilityRoot }
    ],
    rootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState },
      { rootPath: utilityRoot, state: state() }
    ],
    overlay: {
      version: 1,
      roots: [
        { rootPath: frontendRoot, position: { x: 100, y: 200 }, size: { width: 900, height: 700 } },
        { rootPath: backendRoot, position: { x: 1200, y: 200 } }
      ]
    },
    newRootPlacement: {
      rootPaths: [utilityRoot],
      preferredCenter: { x: 1540, y: 460 }
    },
    now: '2026-06-04T00:45:00.000Z'
  });
  const utilityRootGroupId = createWorkspaceRootSectionId(utilityRoot);
  const addedUtilityRootGroup = composedAfterAddingFolder.groups.find((candidate) => candidate.id === utilityRootGroupId);
  assert.ok(addedUtilityRootGroup, 'Add Folder to Workspace 后新增 root 必须出现在 composed canvas 中。');
  assert.notDeepEqual(
    addedUtilityRootGroup.position,
    { x: 1880, y: 0 },
    '新增 root 不应继续使用远离当前视口的默认 index 网格位置。'
  );
  assert.ok(
    Math.abs(rectCenterX(rectForGroup(addedUtilityRootGroup)) - 1540) <= 900,
    '新增 root 应放在接近用户当前可见中心的最近可用槽位。'
  );
  for (const existingRootGroupId of [frontendRootGroupId, backendRootGroupId]) {
    assert.ok(
      !rectsOverlap(rectForGroup(addedUtilityRootGroup), rectForGroup(composedAfterAddingFolder.groups.find((candidate) => candidate.id === existingRootGroupId))),
      '新增 root 的视口附近落点仍必须避开已有 root section。'
    );
  }
  const decomposedAfterAddingFolder = decomposeMultiRootCanvasState({
    composedState: composedAfterAddingFolder,
    workspaceFolders: [
      ...folders,
      { name: 'utility', path: utilityRoot }
    ],
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState },
      { rootPath: utilityRoot, state: state() }
    ],
    now: '2026-06-04T00:50:00.000Z'
  });
  assert.deepEqual(
    decomposedAfterAddingFolder.overlay.roots.find((root) => root.rootPath === normalizedUtilityRoot).position,
    addedUtilityRootGroup.position,
    '新增 root 的自动落点必须进入 multi-root overlay，重载后保持同一位置。'
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
  const frontendAfterRootMove = decomposedAfterRootMove.rootStates.find((entry) => entry.rootPath === normalizedFrontendRoot).state;
  assert.deepEqual(frontendAfterRootMove.nodes[0].position, { x: 20, y: 30 }, '移动 root section 及其子树只改变 multi-root overlay，不改写 root-local 节点坐标。');
  assert.deepEqual(decomposedAfterRootMove.overlay.roots.find((root) => root.rootPath === normalizedFrontendRoot).position, { x: 400, y: 500 });

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
  assert.equal(decomposedWithWorkspaceGroup.overlay.roots.find((root) => root.rootPath === normalizedFrontendRoot).parentGroupId, 'group-workspace-roots');
  assert.ok(
    !decomposedWithWorkspaceGroup.rootStates
      .flatMap((entry) => entry.state.groups)
      .some((candidate) => candidate.id === 'group-workspace-roots'),
    '包含多个 root 的外层普通分组必须只保存在 multi-root overlay 中。'
  );

  const frontendAutomaticFileNodeId = namespaceCanvasObjectId(frontendRoot, 'file-ref-1');
  const frontendAutomaticFileEdgeId = namespaceCanvasObjectId(frontendRoot, 'note-1::file-ref-1');
  const backendAutomaticFileNodeId = namespaceCanvasObjectId(backendRoot, 'file-ref-1');
  const backendAutomaticFileEdgeId = namespaceCanvasObjectId(backendRoot, 'note-1::file-ref-1');
  const decomposedFileActivitySuppressions = decomposeMultiRootCanvasState({
    composedState: {
      ...composed,
      suppressedFileActivityEdgeIds: [frontendAutomaticFileEdgeId, backendAutomaticFileEdgeId],
      suppressedAutomaticFileArtifactNodeIds: [frontendAutomaticFileNodeId, backendAutomaticFileNodeId]
    },
    workspaceFolders: folders,
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    now: '2026-06-04T02:00:00.000Z'
  });
  const frontendSuppressionsAfterRoundTrip = decomposedFileActivitySuppressions.rootStates.find((entry) => entry.rootPath === normalizedFrontendRoot).state;
  const backendSuppressionsAfterRoundTrip = decomposedFileActivitySuppressions.rootStates.find((entry) => entry.rootPath === normalizedBackendRoot).state;
  assert.deepEqual(frontendSuppressionsAfterRoundTrip.suppressedFileActivityEdgeIds, ['note-1::file-ref-1']);
  assert.deepEqual(frontendSuppressionsAfterRoundTrip.suppressedAutomaticFileArtifactNodeIds, ['file-ref-1']);
  assert.deepEqual(backendSuppressionsAfterRoundTrip.suppressedFileActivityEdgeIds, ['note-1::file-ref-1']);
  assert.deepEqual(backendSuppressionsAfterRoundTrip.suppressedAutomaticFileArtifactNodeIds, ['file-ref-1']);

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
  const frontendAfterCreate = decomposedAfterCreate.rootStates.find((entry) => entry.rootPath === normalizedFrontendRoot).state;
  assert.ok(frontendAfterCreate.nodes.some((candidate) => candidate.id === 'note-created'));
  assert.deepEqual(frontendAfterCreate.nodes.find((candidate) => candidate.id === 'note-created').position, { x: 120, y: 140 });

  const rootResizeBaseComposed = composeMultiRootCanvasState({
    workspaceFolders: folders,
    rootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    overlay: {
      version: 1,
      roots: [
        { rootPath: frontendRoot, position: { x: 100, y: 200 }, size: { width: 900, height: 700 } },
        { rootPath: backendRoot, position: { x: 1200, y: 200 }, size: { width: 720, height: 520 } }
      ]
    },
    now: '2026-06-04T03:30:00.000Z'
  });
  verifyRootResizeRoundTripStability({
    label: 'right/bottom expansion',
    composedState: rootResizeBaseComposed,
    workspaceFolders: folders,
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    targetRootPath: frontendRoot,
    rootGroupId: frontendRootGroupId,
    resize: (rootGroup) => ({
      position: rootGroup.position,
      size: { width: rootGroup.size.width + 240, height: rootGroup.size.height + 160 }
    }),
    composeMultiRootCanvasState,
    decomposeMultiRootCanvasState
  });
  verifyRootResizeRoundTripStability({
    label: 'left/top expansion',
    composedState: rootResizeBaseComposed,
    workspaceFolders: folders,
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    targetRootPath: frontendRoot,
    rootGroupId: frontendRootGroupId,
    resize: (rootGroup) => ({
      position: { x: rootGroup.position.x - 180, y: rootGroup.position.y - 120 },
      size: { width: rootGroup.size.width + 180, height: rootGroup.size.height + 120 }
    }),
    composeMultiRootCanvasState,
    decomposeMultiRootCanvasState
  });
  verifyRootResizeRoundTripStability({
    label: 'left/top clamp to natural size',
    composedState: rootResizeBaseComposed,
    workspaceFolders: folders,
    previousRootStates: [
      { rootPath: frontendRoot, state: frontendState },
      { rootPath: backendRoot, state: backendState }
    ],
    targetRootPath: frontendRoot,
    rootGroupId: frontendRootGroupId,
    resize: (rootGroup) => ({
      position: { x: rootGroup.position.x + 420, y: rootGroup.position.y + 320 },
      size: { width: 180, height: 96 }
    }),
    composeMultiRootCanvasState,
    decomposeMultiRootCanvasState
  });

  const frontendComposedFileReference = {
    id: namespaceCanvasObjectId(frontendRoot, 'ref-1'),
    filePath: path.join(frontendRoot, 'src/a.ts'),
    relativePath: 'src/a.ts',
    updatedAt: '2026-06-04T00:00:00.000Z',
    owners: [
      {
        nodeId: namespaceCanvasObjectId(frontendRoot, 'note-1'),
        accessMode: 'write',
        updatedAt: '2026-06-04T00:00:00.000Z'
      }
    ]
  };
  const backendComposedFileReference = {
    id: namespaceCanvasObjectId(backendRoot, 'ref-1'),
    filePath: path.join(backendRoot, 'src/a.ts'),
    relativePath: 'src/a.ts',
    updatedAt: '2026-06-04T00:00:00.000Z',
    owners: [
      {
        nodeId: namespaceCanvasObjectId(backendRoot, 'note-1'),
        accessMode: 'write',
        updatedAt: '2026-06-04T00:00:00.000Z'
      }
    ]
  };
  const composedAfterRootLocalReplacement = composeRootLocalCanvasStateIntoComposed(
    {
      ...composed,
      fileReferences: [frontendComposedFileReference, backendComposedFileReference],
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
        },
        {
          id: frontendAutomaticFileEdgeId,
          sourceNodeId: namespaceCanvasObjectId(frontendRoot, 'note-1'),
          targetNodeId: frontendAutomaticFileNodeId,
          sourceAnchor: 'right',
          targetAnchor: 'left',
          arrowMode: 'forward',
          owner: 'file-activity'
        },
        {
          id: backendAutomaticFileEdgeId,
          sourceNodeId: namespaceCanvasObjectId(backendRoot, 'note-1'),
          targetNodeId: backendAutomaticFileNodeId,
          sourceAnchor: 'right',
          targetAnchor: 'left',
          arrowMode: 'forward',
          owner: 'file-activity'
        }
      ],
      suppressedFileActivityEdgeIds: [frontendAutomaticFileEdgeId, backendAutomaticFileEdgeId],
      suppressedAutomaticFileArtifactNodeIds: [frontendAutomaticFileNodeId, backendAutomaticFileNodeId]
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
  assert.ok(
    !composedAfterRootLocalReplacement.edges.some((candidate) => candidate.id === frontendAutomaticFileEdgeId),
    '替换 root-local 子图时，必须移除由该 root fileReferences 派生的旧 file-activity edge。'
  );
  assert.ok(
    !composedAfterRootLocalReplacement.fileReferences.some((candidate) => candidate.id === frontendComposedFileReference.id),
    '替换 root-local 子图时，必须移除该 root 的旧 fileReferences，避免下次重建出 stale 自动 artifact。'
  );
  assert.deepEqual(composedAfterRootLocalReplacement.suppressedFileActivityEdgeIds, [backendAutomaticFileEdgeId]);
  assert.deepEqual(composedAfterRootLocalReplacement.suppressedAutomaticFileArtifactNodeIds, [backendAutomaticFileNodeId]);

  console.log('canvas multi-root composition tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function verifyRootResizeRoundTripStability({
  label,
  composedState,
  workspaceFolders,
  previousRootStates,
  targetRootPath,
  rootGroupId,
  resize,
  composeMultiRootCanvasState,
  decomposeMultiRootCanvasState
}) {
  const normalizedTargetRootPath = normalizeRootPathForTest(targetRootPath);
  const beforeNodePositions = Object.fromEntries(
    composedState.nodes
      .filter((node) => node.id.startsWith(`${rootGroupId}:`))
      .map((node) => [node.id, node.position])
  );
  const rootGroup = composedState.groups.find((candidate) => candidate.id === rootGroupId);
  assert.ok(rootGroup, `${label}: target root group must exist.`);
  const resizedRootGeometry = resize(rootGroup);
  const resizedComposedState = {
    ...composedState,
    groups: composedState.groups.map((candidate) =>
      candidate.id === rootGroupId
        ? { ...candidate, ...resizedRootGeometry }
        : candidate
    )
  };
  const decomposed = decomposeMultiRootCanvasState({
    composedState: resizedComposedState,
    workspaceFolders,
    previousRootStates,
    now: '2026-06-04T03:45:00.000Z'
  });
  const recomposed = composeMultiRootCanvasState({
    workspaceFolders,
    rootStates: decomposed.rootStates,
    overlay: decomposed.overlay,
    now: '2026-06-04T03:46:00.000Z'
  });
  const secondDecomposed = decomposeMultiRootCanvasState({
    composedState: recomposed,
    workspaceFolders,
    previousRootStates: decomposed.rootStates,
    now: '2026-06-04T03:47:00.000Z'
  });
  const secondRecomposed = composeMultiRootCanvasState({
    workspaceFolders,
    rootStates: secondDecomposed.rootStates,
    overlay: secondDecomposed.overlay,
    now: '2026-06-04T03:48:00.000Z'
  });

  for (const [nodeId, position] of Object.entries(beforeNodePositions)) {
    const nextNode = recomposed.nodes.find((candidate) => candidate.id === nodeId);
    assert.ok(nextNode, `${label}: recomposed root-local node must exist.`);
    assert.deepEqual(nextNode.position, position, `${label}: root resize must keep composed node positions stable.`);
  }
  assert.deepEqual(
    secondRecomposed.groups.find((candidate) => candidate.id === rootGroupId),
    recomposed.groups.find((candidate) => candidate.id === rootGroupId),
    `${label}: root geometry must not drift after a second decompose/compose cycle.`
  );
  assert.deepEqual(
    secondRecomposed.nodes.filter((node) => node.id.startsWith(`${rootGroupId}:`)).map((node) => [node.id, node.position]),
    recomposed.nodes.filter((node) => node.id.startsWith(`${rootGroupId}:`)).map((node) => [node.id, node.position]),
    `${label}: root-local node positions must not drift after a second decompose/compose cycle.`
  );
  assert.deepEqual(
    secondDecomposed.overlay.roots.find((root) => root.rootPath === normalizedTargetRootPath),
    decomposed.overlay.roots.find((root) => root.rootPath === normalizedTargetRootPath),
    `${label}: persisted overlay root geometry must be stable.`
  );
}

function normalizeRootPathForTest(rootPath) {
  const resolved = path.resolve(rootPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
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

function rectCenterX(rect) {
  return (rect.left + rect.right) / 2;
}
