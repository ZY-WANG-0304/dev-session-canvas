import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    'updateGroupTitle',
    'preserveRepairTargetClusterWhileAvoidingSiblings',
    'finalizeCanvasGroupState',
    'applyCanvasTemplateToState',
    'createNextState',
    'normalizeState',
    'createBranchAgentUserEdge',
    'createUserCanvasEdge',
    'updateCanvasEdge',
    'recordAgentFileActivity',
    'removeAgentFileReferences',
    'rebuildCanvasFileArtifacts'
  ];

  await esbuild.build({
    stdin: {
      contents: `export { ${exportedHelpers.join(', ')} } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';`,
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
                l10n: {
                  t: (message, args) => typeof args === 'object' && args
                    ? Object.entries(args).reduce(
                        (value, [key, arg]) => value.split('{' + key + '}').join(String(arg)),
                        message
                      )
                    : message
                },
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
    updateGroupTitle,
    preserveRepairTargetClusterWhileAvoidingSiblings,
    finalizeCanvasGroupState,
    applyCanvasTemplateToState,
    createNextState,
    normalizeState,
    createBranchAgentUserEdge,
    createUserCanvasEdge,
    updateCanvasEdge,
    recordAgentFileActivity,
    removeAgentFileReferences,
    rebuildCanvasFileArtifacts
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
  assertMemberInsetsForTest(groupedSelection.groups[0], groupedSelection.nodes.filter((candidate) => candidate.groupId === groupedSelection.groups[0].id));

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

  const nestedEmptyGroup = createEmptyCanvasGroup(
    state({
      groups: [group('group-parent', { x: 0, y: 0 }, { width: 500, height: 420 })]
    }),
    { x: 120, y: 120 },
    { width: 200, height: 140 },
    'group-parent'
  );
  const nestedCreatedGroup = nestedEmptyGroup.groups.find((candidate) => candidate.title === 'Group 1');
  assert.strictEqual(nestedCreatedGroup.parentGroupId, 'group-parent');

  const nestedSelectionGroup = createGroupFromSelection(
    state({
      nodes: [
        note('note-a', { x: 80, y: 96 }, { groupId: 'group-parent' }),
        note('note-b', { x: 240, y: 96 }, { groupId: 'group-parent' })
      ],
      groups: [group('group-parent', { x: 0, y: 0 }, { width: 620, height: 420 })]
    }),
    ['note-a', 'note-b'],
    [],
    'group-parent'
  );
  const nestedSelectionCreatedGroup = nestedSelectionGroup.groups.find((candidate) => candidate.title === 'Group 1');
  assert.strictEqual(nestedSelectionCreatedGroup.parentGroupId, 'group-parent');
  assert.strictEqual(nestedSelectionGroup.nodes.find((candidate) => candidate.id === 'note-a').groupId, nestedSelectionCreatedGroup.id);
  assert.strictEqual(nestedSelectionGroup.nodes.find((candidate) => candidate.id === 'note-b').groupId, nestedSelectionCreatedGroup.id);

  const groupedPeerGroups = createGroupFromSelection(
    state({
      groups: [
        group('group-a', { x: 80, y: 96 }, { width: 160, height: 120 }),
        group('group-b', { x: 320, y: 96 }, { width: 180, height: 140 })
      ]
    }),
    [],
    ['group-a', 'group-b']
  );
  const createdPeerParentGroup = groupedPeerGroups.groups.find((candidate) => candidate.title === 'Group 1');
  assert.ok(createdPeerParentGroup, 'Expected peer group selection to create a parent group.');
  assert.strictEqual(groupedPeerGroups.groups.find((candidate) => candidate.id === 'group-a').parentGroupId, createdPeerParentGroup.id);
  assert.strictEqual(groupedPeerGroups.groups.find((candidate) => candidate.id === 'group-b').parentGroupId, createdPeerParentGroup.id);

  const mismatchedContextSelection = createGroupFromSelection(
    state({
      nodes: [
        note('note-a', { x: 80, y: 96 }),
        note('note-b', { x: 240, y: 96 })
      ],
      groups: [group('group-parent', { x: 0, y: 0 }, { width: 620, height: 420 })]
    }),
    ['note-a', 'note-b'],
    [],
    'group-parent'
  );
  assert.strictEqual(mismatchedContextSelection.groups.length, 1);
  assert.strictEqual(mismatchedContextSelection.nodes.find((candidate) => candidate.id === 'note-a').groupId, undefined);

  const createdNodeInGroup = createNextState(
    state({
      groups: [group('group-parent', { x: 120, y: 120 }, { width: 360, height: 240 })]
    }),
    'note',
    'codex',
    'default',
    undefined,
    { x: 130, y: 156 },
    'group-parent'
  );
  const manuallyCreatedMember = createdNodeInGroup.nodes.at(-1);
  const expandedCreationTarget = createdNodeInGroup.groups.find((candidate) => candidate.id === 'group-parent');
  assert.strictEqual(manuallyCreatedMember.groupId, 'group-parent');
  assert.ok(rectContainsRectForTest(rectForTestGroup(expandedCreationTarget), rectForTestNode(manuallyCreatedMember)));
  assertMemberInsetsForTest(expandedCreationTarget, [manuallyCreatedMember]);

  const createdAcrossGroupBoundary = createNextState(
    state({
      nodes: [note('cross-group-blocker', { x: 130, y: 156 }, { groupId: 'another-group' })],
      groups: [group('group-parent', { x: 120, y: 120 }, { width: 360, height: 240 })]
    }),
    'note',
    'codex',
    'default',
    undefined,
    { x: 130, y: 156 },
    'group-parent'
  );
  const crossGroupCreatedNode = createdAcrossGroupBoundary.nodes.at(-1);
  const crossGroupBlocker = createdAcrossGroupBoundary.nodes.find((candidate) => candidate.id === 'cross-group-blocker');
  assert.ok(
    !rectsOverlapForTest(rectForTestNode(crossGroupCreatedNode), rectForTestNode(crossGroupBlocker)),
    'Generated nodes must avoid existing nodes even when their group ids differ.'
  );

  const forkLayerSourcePosition = { x: 220, y: 400 };
  let forkLayerState = state({
    nodes: [agent('fork-layer-source', forkLayerSourcePosition, {
      size: { width: 560, height: 430 },
      groupId: 'fork-layer-group'
    })],
    groups: [
      group('fork-layer-group', { x: 0, y: 0 }, { width: 1000, height: 1000 }),
      group('fork-layer-blocker', { x: 0, y: -324 }, { width: 1000, height: 300 })
    ]
  });
  for (let index = 0; index < 3; index += 1) {
    forkLayerState = createNextState(
      forkLayerState,
      'agent',
      'codex',
      'default',
      undefined,
      undefined,
      undefined,
      undefined,
      { kind: 'fork-layer', sourceNodeId: 'fork-layer-source', direction: 'up' }
    );
  }
  const forkLayerChildren = forkLayerState.nodes.filter((candidate) => candidate.id !== 'fork-layer-source');
  assert.ok(
    forkLayerChildren.every((candidate) => candidate.groupId === 'fork-layer-group'),
    'Fork children should inherit the source ordinary group.'
  );
  assert.deepStrictEqual(
    forkLayerState.nodes.find((candidate) => candidate.id === 'fork-layer-source').position,
    forkLayerSourcePosition,
    'Growing the inherited group for Fork children must not move the source node.'
  );
  const repairedForkLayerGroup = forkLayerState.groups.find((candidate) => candidate.id === 'fork-layer-group');
  const displacedForkLayerBlocker = forkLayerState.groups.find((candidate) => candidate.id === 'fork-layer-blocker');
  assert.ok(
    !rectsOverlapForTest(rectForTestGroup(repairedForkLayerGroup), rectForTestGroup(displacedForkLayerBlocker)),
    'Pinned Fork groups should remain legal by displacing the conflicting sibling.'
  );
  assert.notDeepStrictEqual(displacedForkLayerBlocker.position, { x: 0, y: -324 });
  assert.strictEqual(new Set(forkLayerChildren.map((candidate) => candidate.position.y)).size, 1);
  for (let leftIndex = 0; leftIndex < forkLayerChildren.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < forkLayerChildren.length; rightIndex += 1) {
      assert.ok(
        !rectsOverlapForTest(
          rectForTestNode(forkLayerChildren[leftIndex]),
          rectForTestNode(forkLayerChildren[rightIndex])
        ),
        'Fork children created from one source should share a layer without overlapping.'
      );
    }
  }
  const expandedForkLayerGroup = forkLayerState.groups.find((candidate) => candidate.id === 'fork-layer-group');
  const movedForkChild = forkLayerChildren[0];
  const movedForkChildState = moveNode(
    forkLayerState,
    movedForkChild.id,
    {
      x: expandedForkLayerGroup.position.x + expandedForkLayerGroup.size.width + 500,
      y: expandedForkLayerGroup.position.y
    }
  );
  assert.strictEqual(
    movedForkChildState.nodes.find((candidate) => candidate.id === movedForkChild.id).groupId,
    undefined,
    'Users should still be able to drag an inherited Fork child out of its ordinary group.'
  );

  const nestedForkSourcePosition = { x: 320, y: 500 };
  const nestedForkState = createNextState(
    state({
      nodes: [agent('nested-fork-source', nestedForkSourcePosition, {
        size: { width: 560, height: 430 },
        groupId: 'nested-fork-group'
      })],
      groups: [
        group('nested-fork-parent', { x: 0, y: 0 }, { width: 1200, height: 1200 }),
        group('nested-fork-group', { x: 100, y: 100 }, { width: 1000, height: 1000 }, {
          parentGroupId: 'nested-fork-parent'
        }),
        group('nested-parent-blocker', { x: 0, y: -324 }, { width: 1200, height: 300 })
      ]
    }),
    'agent',
    'codex',
    'default',
    undefined,
    undefined,
    undefined,
    undefined,
    { kind: 'fork-layer', sourceNodeId: 'nested-fork-source', direction: 'up' }
  );
  assert.strictEqual(
    nestedForkState.nodes.at(-1).groupId,
    'nested-fork-group',
    'Nested Fork children should inherit the source direct group.'
  );
  assert.deepStrictEqual(
    nestedForkState.nodes.find((candidate) => candidate.id === 'nested-fork-source').position,
    nestedForkSourcePosition,
    'Repairing an expanded ancestor chain must not move the nested Fork source.'
  );
  const repairedNestedForkParent = nestedForkState.groups.find((candidate) => candidate.id === 'nested-fork-parent');
  const displacedNestedParentBlocker = nestedForkState.groups.find((candidate) => candidate.id === 'nested-parent-blocker');
  assert.ok(
    !rectsOverlapForTest(rectForTestGroup(repairedNestedForkParent), rectForTestGroup(displacedNestedParentBlocker)),
    'Pinned Fork ancestor chains should displace conflicting root-level siblings.'
  );
  assert.notDeepStrictEqual(displacedNestedParentBlocker.position, { x: 0, y: -324 });

  const forwardParentTemplateApply = applyCanvasTemplateToState(
    state(),
    {
      id: 'forward-parent-groups',
      name: 'Forward Parent Groups',
      category: 'user',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      groups: [
        {
          title: 'Child',
          position: { x: 40, y: 60 },
          size: { width: 280, height: 180 },
          parentGroupIndex: 1
        },
        {
          title: 'Parent',
          position: { x: 0, y: 0 },
          size: { width: 380, height: 300 }
        }
      ],
      nodes: [
        {
          kind: 'note',
          title: 'Nested Note',
          position: { x: 80, y: 120 },
          size: { width: 120, height: 80 },
          groupIndex: 0,
          metadata: { note: { content: '' } }
        }
      ],
      edges: []
    },
    {
      resolvedAgentProviders: new Map()
    }
  ).state;
  const materializedParent = forwardParentTemplateApply.groups.find((candidate) => candidate.title === 'Parent');
  const materializedChild = forwardParentTemplateApply.groups.find((candidate) => candidate.title === 'Child');
  assert.ok(materializedParent, 'Expected forward-parent template to materialize parent group.');
  assert.ok(materializedChild, 'Expected forward-parent template to materialize child group.');
  assert.strictEqual(materializedChild.parentGroupId, materializedParent.id);
  assert.strictEqual(forwardParentTemplateApply.nodes[0].groupId, materializedChild.id);

  const cyclicParentTemplateApply = applyCanvasTemplateToState(
    state(),
    {
      id: 'cyclic-parent-groups',
      name: 'Cyclic Parent Groups',
      category: 'user',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      groups: [
        {
          title: 'Cycle A',
          position: { x: 0, y: 0 },
          size: { width: 380, height: 300 },
          parentGroupIndex: 1
        },
        {
          title: 'Cycle B',
          position: { x: 40, y: 60 },
          size: { width: 280, height: 180 },
          parentGroupIndex: 0
        }
      ],
      nodes: [
        {
          kind: 'note',
          title: 'Cycle Note',
          position: { x: 80, y: 120 },
          size: { width: 120, height: 80 },
          groupIndex: 0,
          metadata: { note: { content: '' } }
        }
      ],
      edges: []
    },
    {
      resolvedAgentProviders: new Map()
    }
  ).state;
  const materializedCycleA = cyclicParentTemplateApply.groups.find((candidate) => candidate.title === 'Cycle A');
  const materializedCycleB = cyclicParentTemplateApply.groups.find((candidate) => candidate.title === 'Cycle B');
  assert.ok(materializedCycleA, 'Expected cyclic-parent template to materialize group A.');
  assert.ok(materializedCycleB, 'Expected cyclic-parent template to materialize group B.');
  assert.strictEqual(materializedCycleA.parentGroupId, materializedCycleB.id);
  assert.strictEqual(materializedCycleB.parentGroupId, undefined);
  assert.strictEqual(cyclicParentTemplateApply.nodes[0].groupId, materializedCycleA.id);

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
  assert.ok(groupedByPointer.groups[0].size.width >= 240 + 120 + 24);

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
  assert.ok(multiMovedByPrimaryPointer.groups[0].size.width >= 370 + 120 + 24);

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
  assert.ok(!rectsOverlapForTest(
    rectForTestNode(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'existing-1')),
    rectForTestNode(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-1'))
  ));
  assert.ok(!rectsOverlapForTest(
    rectForTestNode(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'existing-1')),
    rectForTestNode(movedIntoOccupiedGroup.nodes.find((candidate) => candidate.id === 'moved-2'))
  ));

  const movedIntoOccupiedGroupAfterExpansion = moveNode(
    state({
      nodes: [
        note('existing-1', { x: 90, y: 80 }, { groupId: 'group-target' }),
        note('moved-1', { x: 420, y: 80 })
      ],
      groups: [group('group-target', { x: 0, y: 0 }, { width: 180, height: 140 })]
    }),
    'moved-1',
    { x: 90, y: 80 },
    { x: 120, y: 110 }
  );
  assert.strictEqual(movedIntoOccupiedGroupAfterExpansion.nodes.find((candidate) => candidate.id === 'moved-1').groupId, 'group-target');
  assert.ok(!rectsOverlapForTest(
    rectForTestNode(movedIntoOccupiedGroupAfterExpansion.nodes.find((candidate) => candidate.id === 'existing-1')),
    rectForTestNode(movedIntoOccupiedGroupAfterExpansion.nodes.find((candidate) => candidate.id === 'moved-1'))
  ));
  assert.notDeepStrictEqual(
    movedIntoOccupiedGroupAfterExpansion.nodes.find((candidate) => candidate.id === 'moved-1').position,
    { x: 90, y: 80 }
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
      nodes: [note('note-child', { x: 90, y: 112 }, { groupId: 'group-child' })],
      groups: [
        group('group-parent', { x: 0, y: 0 }, { width: 300, height: 280 }),
        group('group-child', { x: 50, y: 56 }, { width: 180, height: 180 }, { parentGroupId: 'group-parent' })
      ]
    }),
    'group-parent',
    { x: 100, y: 90 },
    { x: 900, y: 900 }
  );
  assert.deepStrictEqual(movedTree.groups.find((candidate) => candidate.id === 'group-parent').position, { x: 100, y: 90 });
  assert.deepStrictEqual(movedTree.groups.find((candidate) => candidate.id === 'group-child').position, { x: 150, y: 146 });
  assert.deepStrictEqual(movedTree.nodes.find((candidate) => candidate.id === 'note-child').position, { x: 190, y: 202 });

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
      nodes: [
        note('note-contained', { x: 260, y: 60 }),
        note('note-crossing', { x: 380, y: 120 }),
        fileNode('file-contained', { x: 260, y: 60 })
      ],
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
  const containedNoteAfterResize = resizedWithContainmentAndCollision.nodes.find((candidate) => candidate.id === 'note-contained');
  const crossingNoteAfterResize = resizedWithContainmentAndCollision.nodes.find((candidate) => candidate.id === 'note-crossing');
  const containedFileAfterResize = resizedWithContainmentAndCollision.nodes.find((candidate) => candidate.id === 'file-contained');
  assert.deepStrictEqual(resizedPinnedGroup.position, { x: 0, y: -2 });
  assert.deepStrictEqual(resizedPinnedGroup.size, { width: 430, height: 182 });
  assert.strictEqual(containedAfterResize.parentGroupId, 'group-parent');
  assert.strictEqual(crossingAfterResize.parentGroupId, undefined);
  assert.strictEqual(containedNoteAfterResize.groupId, 'group-parent');
  assert.strictEqual(crossingNoteAfterResize.groupId, undefined);
  assert.strictEqual(containedFileAfterResize.groupId, undefined);
  assert.ok(!rectsOverlapForTest(rectForTestGroup(resizedPinnedGroup), rectForTestGroup(crossingAfterResize)));

  const fileActivityOwnerGroupState = state({
    nodes: [
      agent('agent-owned', { x: 100, y: 100 }, { groupId: 'group-owner-a' }),
      agent('agent-shared', { x: 1460, y: 100 }, { groupId: 'group-owner-b' })
    ],
    groups: [
      group('group-owner-a', { x: 40, y: 40 }, { width: 900, height: 340 }),
      group('group-owner-b', { x: 1400, y: 40 }, { width: 900, height: 340 })
    ],
    fileReferences: [
      {
        id: 'file-owned',
        filePath: '/repo/src/owned.ts',
        relativePath: 'src/owned.ts',
        updatedAt: '2026-06-08T00:00:00.000Z',
        owners: [
          { nodeId: 'agent-owned', accessMode: 'write', updatedAt: '2026-06-08T00:00:00.000Z' }
        ]
      },
      {
        id: 'file-shared',
        filePath: '/repo/src/shared.ts',
        relativePath: 'src/shared.ts',
        updatedAt: '2026-06-08T00:00:00.000Z',
        owners: [
          { nodeId: 'agent-owned', accessMode: 'write', updatedAt: '2026-06-08T00:00:00.000Z' },
          { nodeId: 'agent-shared', accessMode: 'read', updatedAt: '2026-06-08T00:00:00.000Z' }
        ]
      }
    ]
  });
  const ownerGroupedFileNodes = rebuildCanvasFileArtifacts(fileActivityOwnerGroupState, {
    view: { enabled: true, presentationMode: 'nodes', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  assert.strictEqual(
    ownerGroupedFileNodes.nodes.find((candidate) => candidate.id === 'file-file-owned').groupId,
    'group-owner-a',
    'Single-owner file artifacts should join the owner Agent group.'
  );
  assert.strictEqual(
    ownerGroupedFileNodes.nodes.find((candidate) => candidate.id === 'file-file-shared').groupId,
    undefined,
    'Shared file artifacts owned by Agents in sibling groups should fall back to the nearest common parent.'
  );

  const ownerGroupedFileLists = rebuildCanvasFileArtifacts(fileActivityOwnerGroupState, {
    view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  assert.strictEqual(
    ownerGroupedFileLists.nodes.find((candidate) => candidate.id === 'file-list-agent-agent-owned').groupId,
    'group-owner-a',
    'Agent file-list artifacts should join the owner Agent group.'
  );
  assert.strictEqual(
    ownerGroupedFileLists.nodes.find((candidate) => candidate.id === 'file-list-shared').groupId,
    undefined,
    'Shared file-list artifacts should use the nearest common parent of all owner Agents.'
  );

  const commonParentFileListState = rebuildCanvasFileArtifacts(
    state({
      nodes: [
        agent('agent-left', { x: 120, y: 140 }, { groupId: 'group-left' }),
        agent('agent-right', { x: 680, y: 140 }, { groupId: 'group-right' })
      ],
      groups: [
        group('group-phase', { x: 40, y: 40 }, { width: 1120, height: 520 }),
        group('group-left', { x: 80, y: 100 }, { width: 420, height: 320 }, { parentGroupId: 'group-phase' }),
        group('group-right', { x: 640, y: 100 }, { width: 420, height: 320 }, { parentGroupId: 'group-phase' })
      ],
      fileReferences: [
        {
          id: 'file-common-parent',
          filePath: '/repo/src/common-parent.ts',
          relativePath: 'src/common-parent.ts',
          updatedAt: '2026-06-08T00:00:00.000Z',
          owners: [
            { nodeId: 'agent-left', accessMode: 'write', updatedAt: '2026-06-08T00:00:00.000Z' },
            { nodeId: 'agent-right', accessMode: 'read', updatedAt: '2026-06-08T00:00:00.000Z' }
          ]
        }
      ]
    }),
    {
      view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
      preserveAutomaticFileNodeSizes: true
    }
  );
  assert.strictEqual(
    commonParentFileListState.nodes.find((candidate) => candidate.id === 'file-list-shared').groupId,
    'group-phase',
    'Shared file-list artifacts should join the nearest common parent when owner Agents are in nested sibling groups.'
  );

  const movedOwnerAgentState = rebuildCanvasFileArtifacts(
    moveNode(
      ownerGroupedFileLists,
      'agent-owned',
      {
        x: ownerGroupedFileLists.groups.find((candidate) => candidate.id === 'group-owner-b').position.x + 60,
        y: ownerGroupedFileLists.groups.find((candidate) => candidate.id === 'group-owner-b').position.y + 220
      },
      {
        x: ownerGroupedFileLists.groups.find((candidate) => candidate.id === 'group-owner-b').position.x + 80,
        y: ownerGroupedFileLists.groups.find((candidate) => candidate.id === 'group-owner-b').position.y + 240
      }
    ),
    {
      view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
      preserveAutomaticFileNodeSizes: true
    }
  );
  assert.strictEqual(movedOwnerAgentState.nodes.find((candidate) => candidate.id === 'agent-owned').groupId, 'group-owner-b');
  assert.strictEqual(
    movedOwnerAgentState.nodes.find((candidate) => candidate.id === 'file-list-agent-agent-owned').groupId,
    'group-owner-b',
    'When an Agent moves to a new group, its automatic file-list should follow the owner-derived group.'
  );

  const multiSelectedAgentAndFileListMoveState = rebuildCanvasFileArtifacts(
    moveNode(
      ownerGroupedFileLists,
      'agent-owned',
      { x: 1660, y: 260 },
      { x: 1680, y: 280 },
      [
        {
          id: 'file-list-agent-agent-owned',
          position: { x: 1880, y: 260 }
        }
      ]
    ),
    {
      view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
      preserveAutomaticFileNodeSizes: true
    }
  );
  const oldOwnerGroupAfterMultiMove = multiSelectedAgentAndFileListMoveState.groups.find((candidate) => candidate.id === 'group-owner-a');
  const newOwnerGroupAfterMultiMove = multiSelectedAgentAndFileListMoveState.groups.find((candidate) => candidate.id === 'group-owner-b');
  const multiMovedAgent = multiSelectedAgentAndFileListMoveState.nodes.find((candidate) => candidate.id === 'agent-owned');
  const multiMovedFileList = multiSelectedAgentAndFileListMoveState.nodes.find((candidate) => candidate.id === 'file-list-agent-agent-owned');
  assert.strictEqual(multiMovedAgent.groupId, 'group-owner-b');
  assert.strictEqual(
    multiMovedFileList.groupId,
    'group-owner-b',
    'Multi-select moving an owner Agent with its file-list should regroup the file-list before group repair.'
  );
  assert.deepStrictEqual(
    oldOwnerGroupAfterMultiMove.position,
    ownerGroupedFileLists.groups.find((candidate) => candidate.id === 'group-owner-a').position,
    'The old owner group should not move while repairing a file-list that followed its owner.'
  );
  assert.deepStrictEqual(
    oldOwnerGroupAfterMultiMove.size,
    ownerGroupedFileLists.groups.find((candidate) => candidate.id === 'group-owner-a').size,
    'The old owner group should not expand to contain the stale file-list position from the same drag batch.'
  );
  assert.ok(
    rectContainsRectForTest(rectForTestGroup(newOwnerGroupAfterMultiMove), rectForTestNode(multiMovedFileList)),
    'The new owner group should expand to contain the moved owner-derived file-list.'
  );

  const draggedFileListState = rebuildCanvasFileArtifacts(
    moveNode(
      ownerGroupedFileLists,
      'file-list-agent-agent-owned',
      { x: 1460, y: 260 },
      { x: 1480, y: 280 }
    ),
    {
      view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
      preserveAutomaticFileNodeSizes: true
    }
  );
  const draggedFileList = draggedFileListState.nodes.find((candidate) => candidate.id === 'file-list-agent-agent-owned');
  assert.deepStrictEqual(draggedFileList.position, { x: 1460, y: 260 });
  assert.strictEqual(
    draggedFileList.groupId,
    'group-owner-a',
    'Dragging a file-list changes its position but not its owner-derived group.'
  );
  const draggedFileListSecondPass = rebuildCanvasFileArtifacts(draggedFileListState, {
    view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  assert.deepStrictEqual(
    draggedFileListSecondPass.groups.map((candidate) => ({
      id: candidate.id,
      parentGroupId: candidate.parentGroupId,
      position: candidate.position,
      size: candidate.size
    })),
    draggedFileListState.groups.map((candidate) => ({
      id: candidate.id,
      parentGroupId: candidate.parentGroupId,
      position: candidate.position,
      size: candidate.size
    })),
    'Repeated file artifact rebuilds should not keep changing group boundaries.'
  );
  const resizedOwnerArtifactGroupState = resizeGroup(
    ownerGroupedFileLists,
    'group-owner-a',
    { x: 40, y: 40 },
    { width: 260, height: 220 }
  );
  const resizedOwnerArtifactGroup = resizedOwnerArtifactGroupState.groups.find((candidate) => candidate.id === 'group-owner-a');
  const retainedOwnerFileList = resizedOwnerArtifactGroupState.nodes.find((candidate) => candidate.id === 'file-list-agent-agent-owned');
  assert.strictEqual(retainedOwnerFileList.groupId, 'group-owner-a');
  assert.ok(
    rectContainsRectForTest(rectForTestGroup(resizedOwnerArtifactGroup), rectForTestNode(retainedOwnerFileList)),
    'Resizing an owner group should expand back to contain owner-derived file-lists instead of releasing them.'
  );
  const ownerDeletedFileArtifactsState = rebuildCanvasFileArtifacts(
    removeAgentFileReferences(
      {
        ...ownerGroupedFileLists,
        nodes: ownerGroupedFileLists.nodes.filter((node) => node.id !== 'agent-owned')
      },
      'agent-owned'
    ),
    {
      view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
      preserveAutomaticFileNodeSizes: true
    }
  );
  assert.ok(
    !ownerDeletedFileArtifactsState.nodes.some((candidate) => candidate.id === 'file-list-agent-agent-owned'),
    'Deleting an owner Agent should remove its automatic file-list instead of leaving an orphan group member.'
  );

  const resizedBoundaryInsideChild = resizeGroup(
    state({
      nodes: [note('note-child', { x: 40, y: 40 }, { groupId: 'group-parent' })],
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
  const releasedNoteAfterResize = resizedBoundaryInsideChild.nodes.find((candidate) => candidate.id === 'note-child');
  assert.deepStrictEqual(resizedInsideParent.position, { x: 80, y: 70 });
  assert.deepStrictEqual(resizedInsideParent.size, { width: 180, height: 96 });
  assert.strictEqual(releasedChildAfterResize.parentGroupId, undefined);
  assert.strictEqual(releasedNoteAfterResize.groupId, undefined);
  assert.ok(!rectsOverlapForTest(rectForTestGroup(resizedInsideParent), rectForTestGroup(releasedChildAfterResize)));

  const workspaceRootGroup = group('workspace-root-abc', { x: 20, y: 30 }, { width: 720, height: 520 }, {
    role: 'workspace-root',
    workspaceRootPath: '/repo/frontend'
  });
  const workspaceRootState = state({
    nodes: [
      note('root-note', { x: 100, y: 140 }, { groupId: 'workspace-root-abc' }),
      note('regular-note', { x: 420, y: 180 }, { groupId: 'regular-child' })
    ],
    groups: [
      workspaceRootGroup,
      group('regular-child', { x: 360, y: 120 }, { width: 220, height: 180 }, { parentGroupId: 'workspace-root-abc' }),
      group('workspace-root-def', { x: 840, y: 30 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: '/repo/backend'
      }),
      group('other-root-child', { x: 940, y: 120 }, { width: 220, height: 180 }, { parentGroupId: 'workspace-root-def' })
    ]
  });
  const sameRootEdgeState = createUserCanvasEdge(workspaceRootState, {
    id: 'edge-same-root',
    sourceNodeId: 'root-note',
    targetNodeId: 'regular-note',
    sourceAnchor: 'right',
    targetAnchor: 'left',
    arrowMode: 'forward',
    owner: 'user'
  });
  assert.ok(
    sameRootEdgeState.edges.some((candidate) => candidate.id === 'edge-same-root'),
    'Edges between nodes inside the same workspace root should still be accepted.'
  );
  const branchEdgeState = createBranchAgentUserEdge(
    state({
      nodes: [
        agent('fork-source-agent', { x: 100, y: 120 }, { size: { width: 420, height: 320 } }),
        agent('fork-target-agent', { x: 600, y: 120 }, { size: { width: 420, height: 320 } })
      ]
    }),
    agent('fork-source-agent', { x: 100, y: 120 }, { size: { width: 420, height: 320 } }),
    agent('fork-target-agent', { x: 600, y: 120 }, { size: { width: 420, height: 320 } })
  );
  const branchEdge = branchEdgeState.edges.find(
    (candidate) =>
      candidate.sourceNodeId === 'fork-source-agent' &&
      candidate.targetNodeId === 'fork-target-agent'
  );
  assert.ok(branchEdge, 'Agent Fork should create a user edge from source Agent to forked Agent.');
  assert.strictEqual(branchEdge.owner, 'user');
  assert.strictEqual(branchEdge.arrowMode, 'forward');
  assert.strictEqual(branchEdge.sourceAnchor, 'right');
  assert.strictEqual(branchEdge.targetAnchor, 'left');
  assert.strictEqual(branchEdge.label, 'fork');
  const upwardBranchEdge = createBranchAgentUserEdge(
    branchEdgeState,
    branchEdgeState.nodes.find((candidate) => candidate.id === 'fork-source-agent'),
    branchEdgeState.nodes.find((candidate) => candidate.id === 'fork-target-agent'),
    'up'
  ).edges.at(-1);
  assert.strictEqual(upwardBranchEdge.sourceAnchor, 'top');
  assert.strictEqual(upwardBranchEdge.targetAnchor, 'bottom');
  const downwardBranchEdge = createBranchAgentUserEdge(
    branchEdgeState,
    branchEdgeState.nodes.find((candidate) => candidate.id === 'fork-source-agent'),
    branchEdgeState.nodes.find((candidate) => candidate.id === 'fork-target-agent'),
    'down'
  ).edges.at(-1);
  assert.strictEqual(downwardBranchEdge.sourceAnchor, 'bottom');
  assert.strictEqual(downwardBranchEdge.targetAnchor, 'top');
  const workspaceRootEdgeState = {
    ...workspaceRootState,
    nodes: [
      ...workspaceRootState.nodes,
      note('backend-note', { x: 980, y: 160 }, { groupId: 'workspace-root-def' })
    ]
  };
  const rejectedCrossRootEdgeState = createUserCanvasEdge(workspaceRootEdgeState, {
    id: 'edge-cross-root',
    sourceNodeId: 'root-note',
    targetNodeId: 'backend-note',
    sourceAnchor: 'right',
    targetAnchor: 'left',
    arrowMode: 'forward',
    owner: 'user'
  });
  assert.strictEqual(
    rejectedCrossRootEdgeState,
    workspaceRootEdgeState,
    'Cross-root edges must be rejected because multi-root overlay does not persist edge content.'
  );
  const rejectedCrossRootReconnectState = updateCanvasEdge(
    {
      ...workspaceRootEdgeState,
      edges: [
        {
          id: 'edge-same-root',
          sourceNodeId: 'root-note',
          targetNodeId: 'regular-note',
          sourceAnchor: 'right',
          targetAnchor: 'left',
          arrowMode: 'forward',
          owner: 'user'
        }
      ]
    },
    'edge-same-root',
    {
      targetNodeId: 'backend-note'
    }
  );
  assert.strictEqual(
    rejectedCrossRootReconnectState.edges[0].targetNodeId,
    'regular-note',
    'Reconnect must not turn an existing root-local edge into a cross-root edge.'
  );
  const renamedWorkspaceRoot = updateGroupTitle(workspaceRootState, 'workspace-root-abc', 'Renamed Root');
  assert.strictEqual(
    renamedWorkspaceRoot.groups.find((candidate) => candidate.id === 'workspace-root-abc').title,
    'workspace-root-abc',
    'Workspace root sections must not be renamed like regular user groups.'
  );
  const ungroupedWorkspaceRoot = ungroupCanvasGroup(workspaceRootState, 'workspace-root-abc');
  assert.strictEqual(ungroupedWorkspaceRoot, workspaceRootState, 'Workspace root sections must not be ungrouped.');
  const resizedWorkspaceRoot = resizeGroup(
    workspaceRootState,
    'workspace-root-abc',
    { x: 40, y: 50 },
    { width: 760, height: 540 }
  );
  const resizedWorkspaceRootGroup = resizedWorkspaceRoot.groups.find((candidate) => candidate.id === 'workspace-root-abc');
  assert.deepStrictEqual(
    resizedWorkspaceRoot.nodes.find((candidate) => candidate.id === 'root-note').position,
    { x: 100, y: 140 },
    'Resizing a workspace root section must keep root-local content in place and expand the root boundary when needed.'
  );
  assert.ok(
    resizedWorkspaceRoot.groups.find((candidate) => candidate.id === 'regular-child').position.y <= 120,
    'Regular child groups may still expand to contain their own direct members.'
  );
  assert.ok(rectContainsRectForTest(rectForTestGroup(resizedWorkspaceRootGroup), rectForTestNode(resizedWorkspaceRoot.nodes.find((candidate) => candidate.id === 'root-note'))));
  assert.ok(rectContainsRectForTest(rectForTestGroup(resizedWorkspaceRootGroup), rectForTestGroup(resizedWorkspaceRoot.groups.find((candidate) => candidate.id === 'regular-child'))));
  const resizedWorkspaceRootAgainstMembers = resizeGroup(
    workspaceRootState,
    'workspace-root-abc',
    { x: 120, y: 120 },
    { width: 180, height: 96 }
  );
  const resizedWorkspaceRootAgainstMembersGroup = resizedWorkspaceRootAgainstMembers.groups.find((candidate) => candidate.id === 'workspace-root-abc');
  const resizedWorkspaceRootAgainstMembersRect = rectForTestGroup(resizedWorkspaceRootAgainstMembersGroup);
  const resizedWorkspaceRootAgainstMembersNodeRect = rectForTestNode(resizedWorkspaceRootAgainstMembers.nodes.find((candidate) => candidate.id === 'root-note'));
  assert.ok(
    resizedWorkspaceRootAgainstMembersNodeRect.top - resizedWorkspaceRootAgainstMembersRect.top >= 80,
    'Workspace root resize must keep direct nodes below the root section body chrome.'
  );
  assert.ok(
    resizedWorkspaceRootAgainstMembersNodeRect.left - resizedWorkspaceRootAgainstMembersRect.left >= 80,
    'Workspace root resize must keep direct nodes inside the root section content inset.'
  );
  const movedWithinOwnRoot = moveNode(
    workspaceRootState,
    'root-note',
    { x: 940, y: 140 },
    { x: 970, y: 170 }
  );
  assert.notStrictEqual(
    movedWithinOwnRoot.nodes.find((candidate) => candidate.id === 'root-note').groupId,
    'other-root-child',
    'Nodes must not be reparented from a root section into a regular group while crossing root boundaries.'
  );
  assert.strictEqual(movedWithinOwnRoot.nodes.find((candidate) => candidate.id === 'root-note').groupId, 'workspace-root-abc');
  assert.ok(rectContainsRectForTest(
    rectForTestGroup(movedWithinOwnRoot.groups.find((candidate) => candidate.id === 'workspace-root-abc')),
    rectForTestNode(movedWithinOwnRoot.nodes.find((candidate) => candidate.id === 'root-note'))
  ));
  const movedRootLocalGroupBeyondBoundary = moveGroup(
    workspaceRootState,
    'regular-child',
    { x: 900, y: 120 },
    { x: 930, y: 150 }
  );
  assert.strictEqual(
    movedRootLocalGroupBeyondBoundary.groups.find((candidate) => candidate.id === 'regular-child').parentGroupId,
    'workspace-root-abc',
    'Root-local groups must stay inside their original workspace root when moved beyond the current root boundary.'
  );
  assert.ok(rectContainsRectForTest(
    rectForTestGroup(movedRootLocalGroupBeyondBoundary.groups.find((candidate) => candidate.id === 'workspace-root-abc')),
    rectForTestGroup(movedRootLocalGroupBeyondBoundary.groups.find((candidate) => candidate.id === 'regular-child'))
  ));
  assert.ok(!rectsOverlapForTest(
    rectForTestGroup(movedRootLocalGroupBeyondBoundary.groups.find((candidate) => candidate.id === 'workspace-root-abc')),
    rectForTestGroup(movedRootLocalGroupBeyondBoundary.groups.find((candidate) => candidate.id === 'workspace-root-def'))
  ));

  const repairedWorkspaceRoots = finalizeCanvasGroupState(state({
    groups: [
      group('workspace-root-left', { x: 0, y: 0 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: '/repo/left'
      }),
      group('workspace-root-right', { x: 320, y: 0 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: '/repo/right'
      })
    ]
  }));
  assert.ok(!rectsOverlapForTest(
    rectForTestGroup(repairedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-left')),
    rectForTestGroup(repairedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-right'))
  ));

  const repairedVisuallyNestedWorkspaceRoots = finalizeCanvasGroupState(state({
    groups: [
      group('workspace-root-outer', { x: 0, y: 0 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: '/repo/outer'
      }),
      group('workspace-root-inner', { x: 120, y: 120 }, { width: 360, height: 240 }, {
        role: 'workspace-root',
        workspaceRootPath: '/repo/inner'
      })
    ]
  }));
  assert.ok(!rectsOverlapForTest(
    rectForTestGroup(repairedVisuallyNestedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-outer')),
    rectForTestGroup(repairedVisuallyNestedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-inner'))
  ), 'Workspace root siblings must not stay visually nested unless an actual parentGroupId relationship exists.');

  const repairedWorkspaceRootAndPlainGroup = finalizeCanvasGroupState(state({
    groups: [
      group('workspace-root-a', { x: 0, y: 0 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: '/repo/a'
      }),
      group('plain-group', { x: 120, y: 120 }, { width: 360, height: 240 })
    ]
  }));
  assert.ok(!rectsOverlapForTest(
    rectForTestGroup(repairedWorkspaceRootAndPlainGroup.groups.find((candidate) => candidate.id === 'workspace-root-a')),
    rectForTestGroup(repairedWorkspaceRootAndPlainGroup.groups.find((candidate) => candidate.id === 'plain-group'))
  ), 'Workspace root sections must not visually contain unrelated regular groups at the same parent level.');

  const movedWorkspaceRootAsWhole = moveGroup(
    workspaceRootState,
    'workspace-root-abc',
    { x: 840, y: 30 },
    { x: 900, y: 90 }
  );
  assert.deepStrictEqual(
    movedWorkspaceRootAsWhole.groups.find((candidate) => candidate.id === 'workspace-root-abc').position,
    { x: 840, y: 30 },
    'Dragging a workspace root section should preserve the root section as the pinned user intent.'
  );
  assert.ok(rectContainsRectForTest(
    rectForTestGroup(movedWorkspaceRootAsWhole.groups.find((candidate) => candidate.id === 'workspace-root-abc')),
    rectForTestNode(movedWorkspaceRootAsWhole.nodes.find((candidate) => candidate.id === 'root-note'))
  ));
  assert.ok(!rectsOverlapForTest(
    rectForTestGroup(movedWorkspaceRootAsWhole.groups.find((candidate) => candidate.id === 'workspace-root-abc')),
    rectForTestGroup(movedWorkspaceRootAsWhole.groups.find((candidate) => candidate.id === 'workspace-root-def'))
  ));

  const groupedWorkspaceRoots = createGroupFromSelection(
    state({
      groups: [
        group('workspace-root-a', { x: 0, y: 0 }, { width: 720, height: 520 }, {
          role: 'workspace-root',
          workspaceRootPath: '/repo/a'
        }),
        group('workspace-root-b', { x: 900, y: 0 }, { width: 720, height: 520 }, {
          role: 'workspace-root',
          workspaceRootPath: '/repo/b'
        })
      ]
    }),
    [],
    ['workspace-root-a', 'workspace-root-b']
  );
  const workspaceRootParentGroup = groupedWorkspaceRoots.groups.find((candidate) => candidate.title === 'Group 1');
  assert.ok(workspaceRootParentGroup, 'Expected selected root sections to create a workspace-level parent group.');
  assert.strictEqual(groupedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-a').parentGroupId, workspaceRootParentGroup.id);
  assert.strictEqual(groupedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-b').parentGroupId, workspaceRootParentGroup.id);
  assert.ok(rectContainsRectForTest(rectForTestGroup(workspaceRootParentGroup), rectForTestGroup(groupedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-a'))));
  assert.ok(rectContainsRectForTest(rectForTestGroup(workspaceRootParentGroup), rectForTestGroup(groupedWorkspaceRoots.groups.find((candidate) => candidate.id === 'workspace-root-b'))));

  const rejectedRootAndDescendantSelection = createGroupFromSelection(
    workspaceRootState,
    [],
    ['workspace-root-abc', 'regular-child']
  );
  assert.strictEqual(
    rejectedRootAndDescendantSelection.groups.length,
    workspaceRootState.groups.length,
    'A workspace root section must not be grouped together with one of its descendants.'
  );
  const frontendRootPath = '/repo/frontend';
  const backendRootPath = '/repo/backend';
  const namespacedFrontendRootId = rootSectionId(frontendRootPath);
  const namespacedBackendRootId = rootSectionId(backendRootPath);
  const frontendAgentOneId = `${namespacedFrontendRootId}:agent-1`;
  const frontendAgentTwoId = `${namespacedFrontendRootId}:agent-2`;
  const backendAgentOneId = `${namespacedBackendRootId}:agent-1`;
  const crossRootSharedFileActivityState = state({
    nodes: [
      agent(frontendAgentOneId, { x: 100, y: 140 }, { groupId: namespacedFrontendRootId }),
      agent(backendAgentOneId, { x: 900, y: 140 }, { groupId: namespacedBackendRootId })
    ],
    groups: [
      group(namespacedFrontendRootId, { x: 20, y: 30 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: frontendRootPath
      }),
      group(namespacedBackendRootId, { x: 840, y: 30 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: backendRootPath
      })
    ],
    fileReferences: [
      {
        id: 'cross-root-shared',
        filePath: '/repo/shared.ts',
        relativePath: 'shared.ts',
        updatedAt: '2026-06-04T00:00:00.000Z',
        owners: [
          { nodeId: frontendAgentOneId, accessMode: 'write', updatedAt: '2026-06-04T00:00:00.000Z' },
          { nodeId: backendAgentOneId, accessMode: 'read', updatedAt: '2026-06-04T00:00:00.000Z' }
        ]
      }
    ]
  });
  const reconciledCrossRootFileLists = rebuildCanvasFileArtifacts(crossRootSharedFileActivityState, {
    view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  assert.ok(
    reconciledCrossRootFileLists.nodes.some((candidate) => candidate.id === `${namespacedFrontendRootId}:file-list-agent-agent-1`),
    'Cross-root file activity should keep a frontend-scoped file-list instead of merging roots.'
  );
  assert.ok(
    reconciledCrossRootFileLists.nodes.some((candidate) => candidate.id === `${namespacedBackendRootId}:file-list-agent-agent-1`),
    'Cross-root file activity should keep a backend-scoped file-list instead of merging roots.'
  );
  assert.ok(
    !reconciledCrossRootFileLists.nodes.some((candidate) => candidate.id === 'file-list-shared' || candidate.id.endsWith(':file-list-shared')),
    'Cross-root owners must not create one shared file-list artifact in the current version.'
  );

  const fileActivityRootState = state({
    nodes: [
      agent(frontendAgentOneId, { x: 100, y: 140 }, { groupId: `${namespacedFrontendRootId}:group-agent-one` }),
      agent(frontendAgentTwoId, { x: 760, y: 140 }, { groupId: `${namespacedFrontendRootId}:group-agent-two` }),
      agent(backendAgentOneId, { x: 900, y: 140 }, { groupId: namespacedBackendRootId })
    ],
    groups: [
      group(namespacedFrontendRootId, { x: 20, y: 30 }, { width: 1600, height: 720 }, {
        role: 'workspace-root',
        workspaceRootPath: frontendRootPath
      }),
      group(namespacedBackendRootId, { x: 840, y: 30 }, { width: 720, height: 520 }, {
        role: 'workspace-root',
        workspaceRootPath: backendRootPath
      }),
      group(`${namespacedFrontendRootId}:group-agent-one`, { x: 80, y: 100 }, { width: 420, height: 340 }, { parentGroupId: namespacedFrontendRootId }),
      group(`${namespacedFrontendRootId}:group-agent-two`, { x: 720, y: 100 }, { width: 420, height: 340 }, { parentGroupId: namespacedFrontendRootId })
    ],
    fileReferences: [
      {
        id: `${namespacedFrontendRootId}:file-ref-1`,
        filePath: '/repo/frontend/src/a.ts',
        relativePath: 'src/a.ts',
        updatedAt: '2026-06-04T00:00:00.000Z',
        owners: [
          { nodeId: frontendAgentOneId, accessMode: 'write', updatedAt: '2026-06-04T00:00:00.000Z' }
        ]
      },
      {
        id: `${namespacedFrontendRootId}:file-ref-shared`,
        filePath: '/repo/frontend/src/shared.ts',
        relativePath: 'src/shared.ts',
        updatedAt: '2026-06-04T00:00:00.000Z',
        owners: [
          { nodeId: frontendAgentOneId, accessMode: 'write', updatedAt: '2026-06-04T00:00:00.000Z' },
          { nodeId: frontendAgentTwoId, accessMode: 'read', updatedAt: '2026-06-04T00:00:00.000Z' }
        ]
      },
      {
        id: `${namespacedBackendRootId}:file-ref-1`,
        filePath: '/repo/backend/src/a.ts',
        relativePath: 'src/a.ts',
        updatedAt: '2026-06-04T00:00:00.000Z',
        owners: [
          { nodeId: backendAgentOneId, accessMode: 'write', updatedAt: '2026-06-04T00:00:00.000Z' }
        ]
      }
    ],
    suppressedAutomaticFileArtifactNodeIds: [`${namespacedFrontendRootId}:file-ref-suppressed`]
  });
  const reconciledFileNodeArtifacts = rebuildCanvasFileArtifacts(fileActivityRootState, {
    view: { enabled: true, presentationMode: 'nodes', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  const frontendFileNode = reconciledFileNodeArtifacts.nodes.find((candidate) => candidate.id === `${namespacedFrontendRootId}:file-file-ref-1`);
  const backendFileNode = reconciledFileNodeArtifacts.nodes.find((candidate) => candidate.id === `${namespacedBackendRootId}:file-file-ref-1`);
  assert.ok(frontendFileNode, 'Namespaced file references should rebuild as root-local automatic file nodes.');
  assert.ok(backendFileNode, 'Each root should rebuild its own automatic file nodes.');
  assert.strictEqual(frontendFileNode.groupId, `${namespacedFrontendRootId}:group-agent-one`);
  assert.strictEqual(backendFileNode.groupId, namespacedBackendRootId);
  assert.strictEqual(
    reconciledFileNodeArtifacts.nodes.find((candidate) => candidate.id === `${namespacedFrontendRootId}:file-file-ref-shared`).groupId,
    namespacedFrontendRootId,
    'Multi-owner file artifacts should use the nearest common parent inside the owner root.'
  );
  assert.ok(reconciledFileNodeArtifacts.edges.some((candidate) =>
    candidate.id === `${namespacedFrontendRootId}:agent-1::file-file-ref-1`
  ));
  const reconciledFileListArtifacts = rebuildCanvasFileArtifacts(fileActivityRootState, {
    view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  assert.ok(
    reconciledFileListArtifacts.nodes.some((candidate) => candidate.id === `${namespacedFrontendRootId}:file-list-shared` && candidate.groupId === namespacedFrontendRootId),
    'Shared file-list artifacts must use the root namespace so different roots never collide.'
  );
  assert.ok(
    reconciledFileListArtifacts.nodes.some((candidate) => candidate.id === `${namespacedFrontendRootId}:file-list-agent-agent-1` && candidate.groupId === `${namespacedFrontendRootId}:group-agent-one`),
    'Single-owner namespaced file-list artifacts should join the owner Agent group.'
  );
  const regroupedFrontendAgentState = rebuildCanvasFileArtifacts(
    {
      ...reconciledFileListArtifacts,
      nodes: reconciledFileListArtifacts.nodes.map((node) =>
        node.id === frontendAgentOneId
          ? { ...node, groupId: `${namespacedFrontendRootId}:group-agent-two` }
          : node
      )
    },
    {
      view: { enabled: true, presentationMode: 'lists', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
      preserveAutomaticFileNodeSizes: true
    }
  );
  assert.ok(
    regroupedFrontendAgentState.nodes.some((candidate) => candidate.id === `${namespacedFrontendRootId}:file-list-agent-agent-1` && candidate.groupId === `${namespacedFrontendRootId}:group-agent-two`),
    'Root-scoped rebuilds must replace stale auto file-lists that previously belonged to a nested owner group.'
  );
  assert.ok(!reconciledFileListArtifacts.nodes.some((candidate) => candidate.id === 'file-list-shared'));
  assert.deepStrictEqual(
    reconciledFileListArtifacts.suppressedAutomaticFileArtifactNodeIds,
    [],
    'Root-local suppression ids that do not match rebuilt artifact ids should be pruned in composed state.'
  );
  const liveFilePath = '/repo/frontend/src/live.ts';
  const liveFileReferenceId = fileReferenceId(liveFilePath);
  const liveFileActivityState = recordAgentFileActivity(
    state({
      nodes: [
        agent(frontendAgentOneId, { x: 100, y: 140 }, { groupId: namespacedFrontendRootId })
      ],
      groups: [
        group(namespacedFrontendRootId, { x: 20, y: 30 }, { width: 720, height: 520 }, {
          role: 'workspace-root',
          workspaceRootPath: frontendRootPath
        })
      ]
    }),
    {
      nodeId: frontendAgentOneId,
      path: liveFilePath,
      relativePath: 'src/live.ts',
      accessMode: 'write',
      timestamp: '2026-06-04T00:00:00.000Z'
    }
  );
  assert.ok(
    liveFileActivityState.fileReferences.some((reference) => reference.id === `${namespacedFrontendRootId}:${liveFileReferenceId}`),
    'Live file activity from a namespaced owner must create a namespaced file reference.'
  );
  const reconciledLiveFileArtifacts = rebuildCanvasFileArtifacts(liveFileActivityState, {
    view: { enabled: true, presentationMode: 'nodes', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  assert.ok(
    reconciledLiveFileArtifacts.nodes.some((candidate) => candidate.id === `${namespacedFrontendRootId}:file-${liveFileReferenceId}`),
    'Live file activity must rebuild automatic file nodes with the owner root namespace.'
  );
  assert.ok(
    !reconciledLiveFileArtifacts.nodes.some((candidate) => candidate.id === `file-${liveFileReferenceId}`),
    'Live file activity must not leave unnamespaced automatic file nodes in multi-root state.'
  );

  const migratedLiveFileActivityState = recordAgentFileActivity(
    state({
      nodes: [
        agent(frontendAgentOneId, { x: 100, y: 140 }, { groupId: namespacedFrontendRootId })
      ],
      groups: [
        group(namespacedFrontendRootId, { x: 20, y: 30 }, { width: 720, height: 520 }, {
          role: 'workspace-root',
          workspaceRootPath: frontendRootPath
        })
      ],
      fileReferences: [
        {
          id: liveFileReferenceId,
          filePath: liveFilePath,
          relativePath: 'src/live.ts',
          updatedAt: '2026-06-04T00:00:00.000Z',
          owners: [
            { nodeId: frontendAgentOneId, accessMode: 'read', updatedAt: '2026-06-04T00:00:00.000Z' }
          ]
        }
      ],
      suppressedAutomaticFileArtifactNodeIds: [`${namespacedFrontendRootId}:file-${liveFileReferenceId}`]
    }),
    {
      nodeId: frontendAgentOneId,
      path: liveFilePath,
      relativePath: 'src/live.ts',
      accessMode: 'write',
      timestamp: '2026-06-04T00:10:00.000Z'
    }
  );
  assert.ok(
    migratedLiveFileActivityState.fileReferences.some((reference) => reference.id === `${namespacedFrontendRootId}:${liveFileReferenceId}`),
    'Legacy unnamespaced file references with a namespaced owner should migrate into the owner root namespace.'
  );
  assert.ok(
    !migratedLiveFileActivityState.fileReferences.some((reference) => reference.id === liveFileReferenceId),
    'Migrated live file activity should not retain the stale unnamespaced file reference for the same root.'
  );
  const reconciledMigratedLiveFileArtifacts = rebuildCanvasFileArtifacts(migratedLiveFileActivityState, {
    view: { enabled: true, presentationMode: 'nodes', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
    preserveAutomaticFileNodeSizes: true
  });
  assert.deepStrictEqual(
    reconciledMigratedLiveFileArtifacts.suppressedAutomaticFileArtifactNodeIds,
    [`${namespacedFrontendRootId}:file-${liveFileReferenceId}`],
    'Namespaced suppression ids for live file activity should survive root-scoped artifact rebuild.'
  );
  const rootScopedGeometryRepairState = rebuildCanvasFileArtifacts(
    state({
      nodes: [
        agent('scoped-agent', { x: 80, y: 120 }, { groupId: 'workspace-root-target' }),
        note('scoped-wide-note', { x: 1080, y: 120 }, { groupId: 'workspace-root-target' }),
        note('fixed-root-note', { x: 980, y: 120 }, { groupId: 'workspace-root-fixed' }),
        note('fixed-root-overlap-note', { x: 980, y: 120 }, { groupId: 'workspace-root-fixed' }),
        note('fixed-overlay-note', { x: 0, y: 980 }),
        note('fixed-overlay-overlap-note', { x: 30, y: 760 }, { groupId: 'fixed-overlay-group' })
      ],
      groups: [
        group('workspace-root-target', { x: 0, y: 0 }, { width: 920, height: 520 }, {
          role: 'workspace-root',
          workspaceRootPath: '/repo/scoped-target'
        }),
        group('workspace-root-fixed', { x: 900, y: 0 }, { width: 720, height: 520 }, {
          role: 'workspace-root',
          workspaceRootPath: '/repo/scoped-fixed'
        }),
        group('fixed-root-overlap-group', { x: 960, y: 80 }, { width: 220, height: 180 }, {
          parentGroupId: 'workspace-root-fixed'
        }),
        group('fixed-overlay-group', { x: 0, y: 700 }, { width: 360, height: 240 }),
        group('fixed-overlay-overlap-group', { x: 20, y: 730 }, { width: 220, height: 180 }, {
          parentGroupId: 'fixed-overlay-group'
        })
      ],
      fileReferences: [
        {
          id: 'workspace-root-target:file-ref-scoped',
          filePath: '/repo/scoped-target/src/scoped.ts',
          relativePath: 'src/scoped.ts',
          updatedAt: '2026-07-02T00:00:00.000Z',
          owners: [
            { nodeId: 'scoped-agent', accessMode: 'write', updatedAt: '2026-07-02T00:00:00.000Z' }
          ]
        }
      ]
    }),
    {
      view: { enabled: true, presentationMode: 'nodes', includeGlobs: [], excludeGlobs: [], displayStyle: 'card', nodeDisplayMode: 'icon-path', pathDisplayMode: 'basename' },
      preserveAutomaticFileNodeSizes: true,
      geometryRepairOptions: { repairTargetGroupIds: ['workspace-root-target'] }
    }
  );
  const repairedScopedTargetRoot = rootScopedGeometryRepairState.groups.find((candidate) => candidate.id === 'workspace-root-target');
  const unchangedFixedRoot = rootScopedGeometryRepairState.groups.find((candidate) => candidate.id === 'workspace-root-fixed');
  const unchangedFixedRootOverlapGroup = rootScopedGeometryRepairState.groups.find((candidate) => candidate.id === 'fixed-root-overlap-group');
  const unchangedOverlayGroup = rootScopedGeometryRepairState.groups.find((candidate) => candidate.id === 'fixed-overlay-group');
  const unchangedOverlayOverlapGroup = rootScopedGeometryRepairState.groups.find((candidate) => candidate.id === 'fixed-overlay-overlap-group');
  assert.deepStrictEqual(
    unchangedFixedRoot.position,
    { x: 900, y: 0 },
    'Scoped file-artifact reconciliation must not move non-target workspace roots.'
  );
  assert.deepStrictEqual(
    unchangedFixedRoot.size,
    { width: 720, height: 520 },
    'Scoped file-artifact reconciliation must not resize non-target workspace roots.'
  );
  assert.deepStrictEqual(
    unchangedFixedRootOverlapGroup.position,
    { x: 960, y: 80 },
    'Scoped file-artifact reconciliation must not repair existing non-target root child overlaps.'
  );
  assert.deepStrictEqual(
    unchangedFixedRootOverlapGroup.size,
    { width: 220, height: 180 },
    'Scoped file-artifact reconciliation must not resize existing non-target root child groups.'
  );
  assert.deepStrictEqual(
    rootScopedGeometryRepairState.nodes.find((candidate) => candidate.id === 'fixed-root-note').position,
    { x: 980, y: 120 },
    'Scoped file-artifact reconciliation must not move non-target root subtrees.'
  );
  assert.deepStrictEqual(
    rootScopedGeometryRepairState.nodes.find((candidate) => candidate.id === 'fixed-root-overlap-note').position,
    { x: 980, y: 120 },
    'Scoped file-artifact reconciliation must leave non-target root node/group overlaps untouched.'
  );
  assert.deepStrictEqual(
    unchangedOverlayGroup.position,
    { x: 0, y: 700 },
    'Scoped file-artifact reconciliation must not move workspace-level overlay groups.'
  );
  assert.deepStrictEqual(
    unchangedOverlayGroup.size,
    { width: 360, height: 240 },
    'Scoped file-artifact reconciliation must not resize workspace-level overlay groups.'
  );
  assert.deepStrictEqual(
    unchangedOverlayOverlapGroup.position,
    { x: 20, y: 730 },
    'Scoped file-artifact reconciliation must not repair existing workspace-level overlay child overlaps.'
  );
  assert.deepStrictEqual(
    unchangedOverlayOverlapGroup.size,
    { width: 220, height: 180 },
    'Scoped file-artifact reconciliation must not resize existing workspace-level overlay child groups.'
  );
  assert.deepStrictEqual(
    rootScopedGeometryRepairState.nodes.find((candidate) => candidate.id === 'fixed-overlay-note').position,
    { x: 0, y: 980 },
    'Scoped file-artifact reconciliation must not move workspace-level overlay nodes.'
  );
  assert.deepStrictEqual(
    rootScopedGeometryRepairState.nodes.find((candidate) => candidate.id === 'fixed-overlay-overlap-note').position,
    { x: 30, y: 760 },
    'Scoped file-artifact reconciliation must leave workspace-level overlay node/group overlaps untouched.'
  );
  assert.ok(
    rootScopedGeometryRepairState.nodes.some((candidate) => candidate.id === 'workspace-root-target:file-file-ref-scoped'),
    'Regression must include the file-artifact rebuild path before scoped geometry repair.'
  );
  assert.notDeepStrictEqual(
    repairedScopedTargetRoot.position,
    { x: 0, y: 0 },
    'When the target root collides after artifact reconciliation, only the target root subtree should translate.'
  );
  assert.ok(!rectsOverlapForTest(
    rectForTestGroup(repairedScopedTargetRoot),
    rectForTestGroup(unchangedFixedRoot)
  ), 'Scoped file-artifact reconciliation should leave workspace root siblings non-overlapping.');

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
  assert.strictEqual(normalized.nodes.find((candidate) => candidate.id === 'file-1').groupId, 'group-valid');

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

function rootSectionId(rootPath) {
  const normalizedPath = path.resolve(rootPath);
  return `workspace-root-${createHash('sha256').update(normalizedPath).digest('hex').slice(0, 16)}`;
}

function fileReferenceId(filePath) {
  return createHash('sha256').update(path.normalize(filePath)).digest('hex').slice(0, 16);
}

function rectsOverlapForTest(left, right) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function rectContainsRectForTest(outer, inner) {
  return outer.left <= inner.left && outer.right >= inner.right && outer.top <= inner.top && outer.bottom >= inner.bottom;
}

function assertMemberInsetsForTest(group, members) {
  const memberRect = members.map((member) => rectForTestNode(member)).reduce(
    (current, rect) => ({
      left: Math.min(current.left, rect.left),
      top: Math.min(current.top, rect.top),
      right: Math.max(current.right, rect.right),
      bottom: Math.max(current.bottom, rect.bottom)
    }),
    rectForTestNode(members[0])
  );
  const groupRect = rectForTestGroup(group);
  assert.ok(memberRect.left - groupRect.left >= 24);
  assert.ok(memberRect.top - groupRect.top >= 52);
  assert.ok(groupRect.right - memberRect.right >= 24);
  assert.ok(groupRect.bottom - memberRect.bottom >= 24);
}
