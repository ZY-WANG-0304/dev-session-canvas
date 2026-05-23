import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-canvas-node-groups-'));

try {
  const outfile = path.join(tempDir, 'canvas-node-groups.cjs');
  const exportedHelpers = [
    'createEmptyCanvasGroup',
    'createGroupFromSelection',
    'moveNode',
    'moveGroup',
    'resizeGroup',
    'ungroupCanvasGroup',
    'deleteCanvasNode',
    'deleteCanvasGroupKeepMembers',
    'isEmptyCanvasGroup',
    'preserveRepairTargetClusterWhileAvoidingSiblings',
    'finalizeCanvasGroupState',
    'normalizeState'
  ];

  await esbuild.build({
    stdin: {
      contents: `export { ${exportedHelpers.join(', ')} } from './src/panel/CanvasPanelManager';`,
      resolveDir: process.cwd(),
      sourcefile: 'canvas-node-groups-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18',
    external: ['node-pty'],
    plugins: [
      {
        name: 'mock-vscode',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            loader: 'js',
            contents: `
              class Disposable { dispose() {} }
              class EventEmitter { constructor() { this.event = () => new Disposable(); } fire() {} dispose() {} }
              class ThemeIcon { constructor(id) { this.id = id; } }
              class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
              const Uri = {
                file: (fsPath) => ({ fsPath, path: fsPath, scheme: 'file', with(change) { return { ...this, ...change }; } }),
                joinPath: (base, ...segments) => ({ fsPath: [base?.fsPath, ...segments].filter(Boolean).join('/'), path: [base?.path, ...segments].filter(Boolean).join('/'), scheme: base?.scheme ?? 'file' }),
                parse: (value) => ({ fsPath: value, path: value, scheme: String(value).split(':', 1)[0], with(change) { return { ...this, ...change }; } })
              };
              module.exports = {
                Disposable,
                EventEmitter,
                ThemeIcon,
                TreeItem,
                TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
                Uri,
                ViewColumn: { One: 1, Beside: -2 },
                commands: { executeCommand: async () => undefined, registerCommand: () => new Disposable() },
                env: { appName: 'VS Code Test', remoteName: undefined, shell: '/bin/bash' },
                window: {
                  showInformationMessage: async () => undefined,
                  showWarningMessage: async () => undefined,
                  showErrorMessage: async () => undefined,
                  registerTreeDataProvider: () => new Disposable(),
                  registerWebviewViewProvider: () => new Disposable(),
                  createOutputChannel: () => ({ appendLine() {}, dispose() {} })
                },
                workspace: {
                  isTrusted: true,
                  workspaceFolders: [],
                  getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
                  onDidChangeConfiguration: () => new Disposable(),
                  fs: { writeFile: async () => undefined, readFile: async () => new Uint8Array(), createDirectory: async () => undefined }
                }
              };
            `
          }));
        }
      },
      {
        name: 'export-group-helpers',
        setup(build) {
          build.onLoad({ filter: /src\/panel\/CanvasPanelManager\.ts$/ }, async (args) => {
            const fs = await import('node:fs/promises');
            let contents = await fs.readFile(args.path, 'utf8');
            for (const helper of exportedHelpers) {
              contents = contents.replace(`function ${helper}(`, `export function ${helper}(`);
            }
            return { contents, loader: 'ts' };
          });
        }
      }
    ]
  });

  const require = createRequire(import.meta.url);
  const {
    createEmptyCanvasGroup,
    createGroupFromSelection,
    moveNode,
    moveGroup,
    resizeGroup,
    ungroupCanvasGroup,
    deleteCanvasNode,
    deleteCanvasGroupKeepMembers,
    isEmptyCanvasGroup,
    preserveRepairTargetClusterWhileAvoidingSiblings,
    finalizeCanvasGroupState,
    normalizeState
  } = require(outfile);

  const note = (id, position, extra = {}) => ({
    id,
    kind: 'note',
    title: id,
    status: 'ready',
    summary: '',
    position,
    size: { width: 120, height: 80 },
    metadata: { note: { content: '' } },
    ...extra
  });
  const agent = (id, position, extra = {}) => ({
    id,
    kind: 'agent',
    title: id,
    status: 'idle',
    summary: '',
    position,
    size: { width: 160, height: 120 },
    metadata: { agent: { provider: 'codex' } },
    ...extra
  });
  const fileNode = (id, position, extra = {}) => ({
    id,
    kind: 'file',
    title: id,
    status: 'linked',
    summary: '',
    position,
    size: { width: 120, height: 80 },
    metadata: { file: { fileId: id, filePath: `src/${id}.ts`, ownerNodeIds: [], accessMode: 'read' } },
    ...extra
  });
  const group = (id, position, size, extra = {}) => ({
    id,
    title: id,
    position,
    size,
    ...extra
  });
  const state = (overrides = {}) => ({
    version: 1,
    updatedAt: '2026-05-22T00:00:00.000Z',
    nodes: [],
    edges: [],
    groups: [],
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: [],
    nextGroupSequence: 1,
    ...overrides
  });

  let nextState = createEmptyCanvasGroup(state(), { x: 41.4, y: 59.6 }, { width: 10, height: 20 });
  assert.match(nextState.groups[0].id, /^group-1-/u);
  assert.strictEqual(nextState.groups[0].title, 'Group 1');
  assert.deepStrictEqual(nextState.groups[0].position, { x: 41, y: 60 });
  assert.deepStrictEqual(nextState.groups[0].size, { width: 180, height: 96 });

  nextState = createEmptyCanvasGroup({ ...nextState, groups: [{ ...nextState.groups[0], title: 'Renamed' }] }, { x: 400, y: 40 });
  assert.strictEqual(nextState.groups[1].title, 'Group 2');

  nextState = {
    ...nextState,
    groups: nextState.groups.filter((candidate) => candidate.title !== 'Group 2')
  };
  nextState = createEmptyCanvasGroup(nextState, { x: 760, y: 40 });
  assert.strictEqual(nextState.groups.at(-1).title, 'Group 3');

  const pinnedCreateState = createEmptyCanvasGroup(
    state({ groups: [group('group-existing', { x: 100, y: 100 }, { width: 220, height: 180 })] }),
    { x: 150, y: 120 },
    { width: 220, height: 180 }
  );
  const pinnedGroup = pinnedCreateState.groups.find((candidate) => candidate.title === 'Group 1');
  const displacedExistingGroup = pinnedCreateState.groups.find((candidate) => candidate.id === 'group-existing');
  assert.deepStrictEqual(pinnedGroup.position, { x: 150, y: 120 });
  assert.ok(!rectsOverlapForTest(rectForTestGroup(pinnedGroup), rectForTestGroup(displacedExistingGroup)));

  const groupedSelection = createGroupFromSelection(
    state({
      nodes: [
        note('note-a', { x: 20, y: 20 }),
        agent('agent-a', { x: 220, y: 20 })
      ]
    }),
    ['note-a', 'agent-a'],
    []
  );
  assert.strictEqual(groupedSelection.groups.length, 1);
  assert.strictEqual(groupedSelection.groups[0].title, 'Group 1');
  assert.strictEqual(groupedSelection.nodes.find((candidate) => candidate.id === 'note-a').groupId, groupedSelection.groups[0].id);
  assert.strictEqual(groupedSelection.nodes.find((candidate) => candidate.id === 'agent-a').groupId, groupedSelection.groups[0].id);

  const crossParentSelection = createGroupFromSelection(
    state({
      nodes: [
        note('note-a', { x: 20, y: 20 }, { groupId: 'group-parent' }),
        note('note-b', { x: 220, y: 20 })
      ],
      groups: [group('group-parent', { x: 0, y: 0 }, { width: 360, height: 240 })]
    }),
    ['note-a', 'note-b'],
    []
  );
  assert.strictEqual(crossParentSelection.groups.length, 1);
  assert.strictEqual(crossParentSelection.nodes.find((candidate) => candidate.id === 'note-b').groupId, undefined);

  const groupedByPointer = moveNode(
    state({
      nodes: [note('note-1', { x: 320, y: 20 })],
      groups: [group('group-target', { x: 0, y: 0 }, { width: 200, height: 160 })]
    }),
    'note-1',
    { x: 240, y: 20 },
    { x: 100, y: 80 }
  );
  assert.strictEqual(groupedByPointer.nodes[0].groupId, 'group-target');
  assert.ok(groupedByPointer.groups[0].size.width >= 240 + 120 + 28);

  const ungroupedByPointer = moveNode(groupedByPointer, 'note-1', { x: 500, y: 20 }, { x: 500, y: 20 });
  assert.strictEqual(ungroupedByPointer.nodes[0].groupId, undefined);

  const multiMovedByPrimaryPointer = moveNode(
    state({
      nodes: [
        note('moved-1', { x: 420, y: 80 }),
        note('moved-2', { x: 700, y: 80 })
      ],
      groups: [group('group-target', { x: 0, y: 0 }, { width: 260, height: 200 })]
    }),
    'moved-1',
    { x: 90, y: 80 },
    { x: 120, y: 110 },
    [{ id: 'moved-2', position: { x: 370, y: 80 }, pointerPosition: { x: 900, y: 900 } }]
  );
  assert.strictEqual(multiMovedByPrimaryPointer.nodes.find((candidate) => candidate.id === 'moved-1').groupId, 'group-target');
  assert.strictEqual(multiMovedByPrimaryPointer.nodes.find((candidate) => candidate.id === 'moved-2').groupId, 'group-target');
  assert.ok(multiMovedByPrimaryPointer.groups[0].size.width >= 370 + 120 + 28);

  const movedIntoOccupiedGroup = moveNode(
    state({
      nodes: [
        note('existing-1', { x: 90, y: 80 }, { groupId: 'group-target' }),
        note('moved-1', { x: 420, y: 80 }),
        note('moved-2', { x: 560, y: 80 })
      ],
      groups: [group('group-target', { x: 0, y: 0 }, { width: 620, height: 280 })]
    }),
    'moved-1',
    { x: 90, y: 80 },
    { x: 120, y: 110 },
    [{ id: 'moved-2', position: { x: 230, y: 80 }, pointerPosition: { x: 260, y: 110 } }]
  );
  assert.strictEqual(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-1').groupId, 'group-target');
  assert.strictEqual(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-2').groupId, 'group-target');
  assert.strictEqual(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-1').position.y, 184);
  assert.strictEqual(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-2').position.y, 184);
  assert.strictEqual(
    movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-2').position.x -
      movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-1').position.x,
    140
  );

  const overlappingMovedNodesPreserveOverlap = moveNode(
    state({
      nodes: [
        note('existing-1', { x: 90, y: 80 }, { groupId: 'group-target' }),
        note('moved-1', { x: 420, y: 80 }),
        note('moved-2', { x: 460, y: 100 })
      ],
      groups: [group('group-target', { x: 0, y: 0 }, { width: 620, height: 300 })]
    }),
    'moved-1',
    { x: 90, y: 80 },
    { x: 120, y: 110 },
    [{ id: 'moved-2', position: { x: 130, y: 100 }, pointerPosition: { x: 160, y: 130 } }]
  );
  assert.deepStrictEqual(overlappingMovedNodesPreserveOverlap.nodes.find((candidate) => candidate.id === 'moved-1').position, { x: 90, y: 184 });
  assert.deepStrictEqual(overlappingMovedNodesPreserveOverlap.nodes.find((candidate) => candidate.id === 'moved-2').position, { x: 130, y: 204 });

  const repairedTargetsPreservePairwiseRelations = preserveRepairTargetClusterWhileAvoidingSiblings(
    [
      note('repair-a', { x: 90, y: 80 }),
      note('repair-b', { x: 230, y: 80 }),
      note('repair-c', { x: 130, y: 100 })
    ],
    [note('existing-1', { x: 90, y: 80 })],
    { left: 0, top: 0, right: 620, bottom: 320 }
  );
  const repairedA = repairedTargetsPreservePairwiseRelations.find((candidate) => candidate.id === 'repair-a');
  const repairedB = repairedTargetsPreservePairwiseRelations.find((candidate) => candidate.id === 'repair-b');
  const repairedC = repairedTargetsPreservePairwiseRelations.find((candidate) => candidate.id === 'repair-c');
  assert.strictEqual(repairedB.position.x - repairedA.position.x, 140);
  assert.strictEqual(repairedB.position.y - repairedA.position.y, 0);
  assert.strictEqual(repairedC.position.x - repairedA.position.x, 40);
  assert.strictEqual(repairedC.position.y - repairedA.position.y, 20);
  assert.ok(rectsOverlapForTest(rectForTestNode(repairedA), rectForTestNode(repairedC)));
  assert.ok(!rectsOverlapForTest(rectForTestNode(repairedA), rectForTestNode(repairedB)));
  assert.ok(rectsOverlapForTest(rectForTestNode(repairedB), rectForTestNode(repairedC)));

  const movedTree = moveGroup(
    state({
      nodes: [note('note-child', { x: 90, y: 90 }, { groupId: 'group-child' })],
      groups: [
        group('group-parent', { x: 0, y: 0 }, { width: 260, height: 220 }),
        group('group-child', { x: 50, y: 50 }, { width: 180, height: 140 }, { parentGroupId: 'group-parent' })
      ]
    }),
    'group-parent',
    { x: 100, y: 90 },
    { x: 900, y: 900 }
  );
  assert.deepStrictEqual(movedTree.groups.find((candidate) => candidate.id === 'group-parent').position, { x: 100, y: 90 });
  assert.deepStrictEqual(movedTree.groups.find((candidate) => candidate.id === 'group-child').position, { x: 150, y: 140 });
  assert.deepStrictEqual(movedTree.nodes.find((candidate) => candidate.id === 'note-child').position, { x: 190, y: 180 });

  const resizedToAdopt = resizeGroup(
    state({
      groups: [
        group('group-parent', { x: 0, y: 0 }, { width: 220, height: 180 }),
        group('group-child', { x: 280, y: 40 }, { width: 120, height: 90 })
      ]
    }),
    'group-parent',
    { x: 0, y: 0 },
    { width: 430, height: 180 }
  );
  assert.strictEqual(resizedToAdopt.groups.find((candidate) => candidate.id === 'group-child').parentGroupId, 'group-parent');

  const resizedToRelease = resizeGroup(resizedToAdopt, 'group-parent', { x: 0, y: 0 }, { width: 220, height: 160 });
  assert.strictEqual(resizedToRelease.groups.find((candidate) => candidate.id === 'group-child').parentGroupId, undefined);

  const resizedWithContainmentAndCollision = resizeGroup(
    state({
      groups: [
        group('group-parent', { x: 0, y: 0 }, { width: 220, height: 180 }),
        group('group-contained', { x: 250, y: 50 }, { width: 100, height: 80 }),
        group('group-crossing', { x: 380, y: 50 }, { width: 100, height: 80 })
      ]
    }),
    'group-parent',
    { x: 0, y: 0 },
    { width: 430, height: 180 }
  );
  const resizedPinnedGroup = resizedWithContainmentAndCollision.groups.find((candidate) => candidate.id === 'group-parent');
  const containedAfterResize = resizedWithContainmentAndCollision.groups.find((candidate) => candidate.id === 'group-contained');
  const crossingAfterResize = resizedWithContainmentAndCollision.groups.find((candidate) => candidate.id === 'group-crossing');
  assert.deepStrictEqual(resizedPinnedGroup.position, { x: 0, y: 0 });
  assert.deepStrictEqual(resizedPinnedGroup.size, { width: 430, height: 180 });
  assert.strictEqual(containedAfterResize.parentGroupId, 'group-parent');
  assert.strictEqual(crossingAfterResize.parentGroupId, undefined);
  assert.ok(!rectsOverlapForTest(rectForTestGroup(resizedPinnedGroup), rectForTestGroup(crossingAfterResize)));

  const resizedBoundaryInsideChild = resizeGroup(
    state({
      groups: [
        group('group-parent', { x: 0, y: 0 }, { width: 300, height: 220 }),
        group('group-child', { x: 40, y: 40 }, { width: 200, height: 140 }, { parentGroupId: 'group-parent' })
      ]
    }),
    'group-parent',
    { x: 80, y: 70 },
    { width: 120, height: 96 }
  );
  const resizedInsideParent = resizedBoundaryInsideChild.groups.find((candidate) => candidate.id === 'group-parent');
  const releasedChildAfterResize = resizedBoundaryInsideChild.groups.find((candidate) => candidate.id === 'group-child');
  assert.deepStrictEqual(resizedInsideParent.position, { x: 80, y: 70 });
  assert.deepStrictEqual(resizedInsideParent.size, { width: 180, height: 96 });
  assert.strictEqual(releasedChildAfterResize.parentGroupId, undefined);
  assert.ok(!rectsOverlapForTest(rectForTestGroup(resizedInsideParent), rectForTestGroup(releasedChildAfterResize)));

  const spreadInsertedGroupBetweenSiblings = createEmptyCanvasGroup(
    state({
      groups: [
        group('group-left', { x: 0, y: 0 }, { width: 180, height: 120 }),
        group('group-right', { x: 260, y: 0 }, { width: 180, height: 120 })
      ]
    }),
    { x: 130, y: 0 },
    { width: 180, height: 120 }
  );
  const insertedMiddleGroup = spreadInsertedGroupBetweenSiblings.groups.find((candidate) => candidate.title === 'Group 1');
  const spreadLeftGroup = spreadInsertedGroupBetweenSiblings.groups.find((candidate) => candidate.id === 'group-left');
  const spreadRightGroup = spreadInsertedGroupBetweenSiblings.groups.find((candidate) => candidate.id === 'group-right');
  assert.deepStrictEqual(insertedMiddleGroup.position, { x: 130, y: 0 });
  assert.ok(spreadLeftGroup.position.x < 0);
  assert.ok(spreadRightGroup.position.x > 260);
  assert.ok(!rectsOverlapForTest(rectForTestGroup(insertedMiddleGroup), rectForTestGroup(spreadLeftGroup)));
  assert.ok(!rectsOverlapForTest(rectForTestGroup(insertedMiddleGroup), rectForTestGroup(spreadRightGroup)));
  assert.ok(!rectsOverlapForTest(rectForTestGroup(spreadLeftGroup), rectForTestGroup(spreadRightGroup)));

  const spreadInsertedGroupVerticallyBetweenSiblings = createEmptyCanvasGroup(
    state({
      groups: [
        group('group-top', { x: 0, y: 0 }, { width: 180, height: 120 }),
        group('group-bottom', { x: 0, y: 200 }, { width: 180, height: 120 })
      ]
    }),
    { x: 0, y: 100 },
    { width: 180, height: 120 }
  );
  const insertedVerticalMiddleGroup = spreadInsertedGroupVerticallyBetweenSiblings.groups.find((candidate) => candidate.title === 'Group 1');
  const spreadTopGroup = spreadInsertedGroupVerticallyBetweenSiblings.groups.find((candidate) => candidate.id === 'group-top');
  const spreadBottomGroup = spreadInsertedGroupVerticallyBetweenSiblings.groups.find((candidate) => candidate.id === 'group-bottom');
  assert.deepStrictEqual(insertedVerticalMiddleGroup.position, { x: 0, y: 100 });
  assert.ok(spreadTopGroup.position.y < 0);
  assert.ok(spreadBottomGroup.position.y > 200);
  assert.ok(!rectsOverlapForTest(rectForTestGroup(insertedVerticalMiddleGroup), rectForTestGroup(spreadTopGroup)));
  assert.ok(!rectsOverlapForTest(rectForTestGroup(insertedVerticalMiddleGroup), rectForTestGroup(spreadBottomGroup)));
  assert.ok(!rectsOverlapForTest(rectForTestGroup(spreadTopGroup), rectForTestGroup(spreadBottomGroup)));

  const ungrouped = ungroupCanvasGroup(
    state({
      nodes: [note('note-1', { x: 20, y: 20 }, { groupId: 'group-parent' })],
      groups: [
        group('group-parent', { x: 0, y: 0 }, { width: 260, height: 220 }),
        group('group-child', { x: 40, y: 40 }, { width: 120, height: 100 }, { parentGroupId: 'group-parent' })
      ]
    }),
    'group-parent'
  );
  assert.deepStrictEqual(ungrouped.groups.map((candidate) => candidate.id), ['group-child']);
  assert.strictEqual(ungrouped.groups[0].parentGroupId, undefined);
  assert.strictEqual(ungrouped.nodes[0].groupId, undefined);

  const emptyGroupState = state({
    nodes: [note('note-outside', { x: 360, y: 20 })],
    groups: [group('group-empty', { x: 0, y: 0 }, { width: 260, height: 220 })]
  });
  assert.strictEqual(isEmptyCanvasGroup(emptyGroupState, 'group-empty'), true);
  const deletedEmptyGroup = deleteCanvasGroupKeepMembers(emptyGroupState, 'group-empty');
  assert.deepStrictEqual(deletedEmptyGroup.groups, []);
  assert.deepStrictEqual(deletedEmptyGroup.nodes.map((candidate) => candidate.id), ['note-outside']);

  const groupWithDirectNodeState = state({
    nodes: [note('note-child', { x: 40, y: 40 }, { groupId: 'group-parent' })],
    groups: [group('group-parent', { x: 0, y: 0 }, { width: 260, height: 220 })]
  });
  assert.strictEqual(isEmptyCanvasGroup(groupWithDirectNodeState, 'group-parent'), false);

  const groupWithChildGroupState = state({
    groups: [
      group('group-parent', { x: 0, y: 0 }, { width: 260, height: 220 }),
      group('group-child', { x: 40, y: 40 }, { width: 120, height: 100 }, { parentGroupId: 'group-parent' })
    ]
  });
  assert.strictEqual(isEmptyCanvasGroup(groupWithChildGroupState, 'group-parent'), false);

  const normalized = normalizeState(
    state({
      nodes: [agent('agent-1', { x: 0, y: 0 }, { groupId: 'group-valid' }), fileNode('file-1', { x: 200, y: 0 }, { groupId: 'group-valid' })],
      groups: [group('group-valid', { x: 0, y: 0 }, { width: 360, height: 240 })]
    }),
    'codex',
    { enabled: false, presentationMode: 'nodes', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' }
  );
  assert.strictEqual(normalized.nodes.find((candidate) => candidate.id === 'agent-1').groupId, 'group-valid');
  assert.strictEqual(normalized.nodes.find((candidate) => candidate.id === 'file-1').groupId, undefined);

  const deleted = deleteCanvasNode(
    state({
      nodes: [note('note-1', { x: 0, y: 0 }, { groupId: 'group-1' })],
      groups: [group('group-1', { x: 0, y: 0 }, { width: 360, height: 240 })],
      edges: [{ id: 'edge-1', sourceNodeId: 'note-1', targetNodeId: 'note-1', sourceAnchor: 'right', targetAnchor: 'left', arrowMode: 'none', owner: 'user' }]
    }),
    'note-1'
  );
  assert.deepStrictEqual(deleted.nodes, []);
  assert.deepStrictEqual(deleted.edges, []);
  assert.deepStrictEqual(deleted.groups.map((candidate) => candidate.id), ['group-1']);

  const finalized = finalizeCanvasGroupState(
    state({
      nodes: [note('note-1', { x: 100, y: 100 }, { groupId: 'missing-group' })],
      groups: []
    })
  );
  assert.strictEqual(finalized.nodes[0].groupId, undefined);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function rectForTestNode(node) {
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + node.size.width,
    bottom: node.position.y + node.size.height
  };
}

function rectForTestGroup(group) {
  return {
    left: group.position.x,
    top: group.position.y,
    right: group.position.x + group.size.width,
    bottom: group.position.y + group.size.height
  };
}

function rectsOverlapForTest(left, right) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}
