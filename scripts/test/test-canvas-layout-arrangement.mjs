import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-canvas-layout-arrangement-'));

try {
  const outfile = path.join(tempDir, 'canvas-layout-arrangement.cjs');
  await esbuild.build({
    stdin: {
      contents: "export { arrangeCanvasLayout } from './src/common/canvasLayoutArrangement';",
      resolveDir: process.cwd(),
      sourcefile: 'canvas-layout-arrangement-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { arrangeCanvasLayout } = require(outfile);

  function note(id, position, extra = {}) {
    return {
      id,
      kind: 'note',
      title: id,
      status: 'ready',
      summary: '',
      position,
      size: { width: 120, height: 80 },
      metadata: { note: { content: '' } },
      ...extra
    };
  }

  function agent(id, position, extra = {}) {
    return {
      id,
      kind: 'agent',
      title: id,
      status: 'idle',
      summary: '',
      position,
      size: { width: 160, height: 120 },
      metadata: {
        agent: {
          backend: 'node-pty',
          shellPath: '/bin/bash',
          cwd: '/repo',
          persistenceMode: 'snapshot-only',
          attachmentState: 'history-restored',
          liveSession: false,
          attentionPending: false,
          lifecycle: 'idle',
          provider: 'codex',
          launchPreset: 'default',
          runtimeKind: 'pty-cli',
          resumeSupported: false,
          resumeStrategy: 'none'
        }
      },
      ...extra
    };
  }

  function terminal(id, position, extra = {}) {
    return {
      id,
      kind: 'terminal',
      title: id,
      status: 'idle',
      summary: '',
      position,
      size: { width: 180, height: 120 },
      metadata: {
        terminal: {
          backend: 'node-pty',
          shellPath: '/bin/bash',
          cwd: '/repo',
          persistenceMode: 'snapshot-only',
          attachmentState: 'history-restored',
          liveSession: false,
          attentionPending: false,
          lifecycle: 'idle'
        }
      },
      ...extra
    };
  }

  function fileNode(id, position, ownerNodeIds, extra = {}) {
    return {
      id,
      kind: 'file',
      title: id,
      status: 'linked',
      summary: '',
      position,
      size: { width: 140, height: 72 },
      metadata: { file: { fileId: id, filePath: `src/${id}.ts`, ownerNodeIds } },
      ...extra
    };
  }

  function group(id, position, size = { width: 360, height: 240 }, extra = {}) {
    return {
      id,
      title: id,
      position,
      size,
      ...extra
    };
  }

  function edge(id, sourceNodeId, targetNodeId, extra = {}) {
    return {
      id,
      sourceNodeId,
      targetNodeId,
      sourceAnchor: 'right',
      targetAnchor: 'left',
      arrowMode: 'forward',
      owner: 'user',
      ...extra
    };
  }

  function state(overrides = {}) {
    return {
      version: 1,
      updatedAt: '2026-06-17T00:00:00.000Z',
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

  function rect(object) {
    return {
      left: object.position.x,
      top: object.position.y,
      right: object.position.x + object.size.width,
      bottom: object.position.y + object.size.height
    };
  }

  function paddedOverlap(left, right, gap = 0) {
    return left.left < right.right + gap && left.right > right.left - gap && left.top < right.bottom + gap && left.bottom > right.top - gap;
  }

  function distance(left, right) {
    const leftCenter = { x: left.position.x + left.size.width / 2, y: left.position.y + left.size.height / 2 };
    const rightCenter = { x: right.position.x + right.size.width / 2, y: right.position.y + right.size.height / 2 };
    return Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
  }

  function centerX(item) {
    return item.position.x + item.size.width / 2;
  }

  function horizontalGap(left, right) {
    return right.position.x - (left.position.x + left.size.width);
  }

  function horizontallyBetweenEndpoints(candidate, left, right) {
    const start = left.position.x + left.size.width;
    const end = right.position.x;
    return candidate.position.x >= start && candidate.position.x + candidate.size.width <= end;
  }

  function byId(items, id) {
    const item = items.find((candidate) => candidate.id === id);
    assert.ok(item, `Expected ${id} to exist.`);
    return item;
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        note('note-a', { x: 0, y: 0 }),
        note('note-b', { x: 20, y: 20 }),
        note('note-c', { x: 40, y: 40 })
      ]
    }), '2026-06-17T01:00:00.000Z');

    for (let leftIndex = 0; leftIndex < arranged.nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < arranged.nodes.length; rightIndex += 1) {
        assert.equal(
          paddedOverlap(rect(arranged.nodes[leftIndex]), rect(arranged.nodes[rightIndex]), 40),
          false,
          '整理后同容器节点之间应消除重叠并留出可读间距。'
        );
      }
    }
    assert.equal(arranged.updatedAt, '2026-06-17T01:00:00.000Z');
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        agent('agent-a', { x: 0, y: 0 }),
        fileNode('file-a', { x: 12, y: 8 }, ['agent-a']),
        note('unrelated', { x: 24, y: 16 })
      ],
      edges: [edge('edge-agent-file', 'agent-a', 'file-a')],
      fileReferences: [
        {
          id: 'ref-file-a',
          filePath: 'src/file-a.ts',
          updatedAt: '2026-06-17T00:00:00.000Z',
          owners: [{ nodeId: 'agent-a', accessMode: 'read', updatedAt: '2026-06-17T00:00:00.000Z' }]
        }
      ]
    }));

    assert.ok(
      distance(byId(arranged.nodes, 'agent-a'), byId(arranged.nodes, 'file-a')) <
        distance(byId(arranged.nodes, 'agent-a'), byId(arranged.nodes, 'unrelated')),
      'Agent 与关联文件节点应比无关节点更靠近。'
    );
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        note('inside-a', { x: 0, y: 0 }, { groupId: 'group-inner' }),
        note('inside-b', { x: 12, y: 12 }, { groupId: 'group-inner' }),
        note('outside', { x: 16, y: 16 })
      ],
      groups: [group('group-inner', { x: -24, y: -52 }, { width: 240, height: 160 })]
    }));

    assert.equal(byId(arranged.nodes, 'inside-a').groupId, 'group-inner');
    assert.equal(byId(arranged.nodes, 'inside-b').groupId, 'group-inner');
    assert.equal(byId(arranged.nodes, 'outside').groupId, undefined);
    assert.equal(
      paddedOverlap(rect(byId(arranged.nodes, 'inside-a')), rect(byId(arranged.nodes, 'inside-b')), 40),
      false,
      '普通分组内部应单独整理并消除成员重叠。'
    );
    assert.equal(
      paddedOverlap(rect(byId(arranged.groups, 'group-inner')), rect(byId(arranged.nodes, 'outside')), 40),
      false,
      '普通分组在外层布局中应作为整体避让外部节点。'
    );
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        note('root-a-note-a', { x: 90, y: 90 }, { groupId: 'root-a' }),
        note('root-a-note-b', { x: 100, y: 100 }, { groupId: 'root-a' }),
        note('root-b-note-a', { x: 110, y: 110 }, { groupId: 'root-b' }),
        note('root-b-note-b', { x: 120, y: 120 }, { groupId: 'root-b' })
      ],
      groups: [
        group('root-a', { x: 0, y: 0 }, { width: 720, height: 520 }, { role: 'workspace-root', workspaceRootPath: '/repo/a' }),
        group('root-b', { x: 60, y: 60 }, { width: 720, height: 520 }, { role: 'workspace-root', workspaceRootPath: '/repo/b' })
      ]
    }));

    assert.equal(byId(arranged.nodes, 'root-a-note-a').groupId, 'root-a');
    assert.equal(byId(arranged.nodes, 'root-b-note-a').groupId, 'root-b');
    assert.equal(
      paddedOverlap(rect(byId(arranged.groups, 'root-a')), rect(byId(arranged.groups, 'root-b')), 40),
      false,
      'workspace root section 之间应避免重叠。'
    );
    assert.equal(
      paddedOverlap(rect(byId(arranged.nodes, 'root-a-note-a')), rect(byId(arranged.nodes, 'root-a-note-b')), 40),
      false,
      'root 内部对象也应单独整理。'
    );
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        note('solo-note', { x: 320, y: 240 }, { groupId: 'group-solo' })
      ],
      groups: [group('group-solo', { x: 10, y: 20 }, { width: 620, height: 420 })]
    }));

    const arrangedGroup = byId(arranged.groups, 'group-solo');
    const arrangedNote = byId(arranged.nodes, 'solo-note');
    assert.equal(arrangedNote.position.x, arrangedGroup.position.x + 24, '单成员普通分组应把成员整理到左侧内容内边距。');
    assert.equal(arrangedNote.position.y, arrangedGroup.position.y + 52, '单成员普通分组应把成员整理到标题下方内容内边距。');
    assert.ok(arrangedGroup.size.width < 300, '单成员普通分组整理后不应保留原有大宽度。');
    assert.ok(arrangedGroup.size.height < 220, '单成员普通分组整理后不应保留原有大高度。');
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        agent('agent-source', { x: 0, y: 0 }),
        terminal('terminal-side', { x: 10, y: 10 }),
        note('note-target', { x: 20, y: 20 })
      ],
      edges: [
        edge('edge-source-target', 'agent-source', 'note-target')
      ]
    }));

    const arrangedAgent = byId(arranged.nodes, 'agent-source');
    const arrangedTerminal = byId(arranged.nodes, 'terminal-side');
    const arrangedNote = byId(arranged.nodes, 'note-target');
    assert.ok(
      arrangedAgent.position.x < arrangedNote.position.x,
      '用户连线 source -> target 应推动 target 排到 source 右侧。'
    );
    assert.equal(
      horizontallyBetweenEndpoints(arrangedTerminal, arrangedAgent, arrangedNote),
      false,
      '只有弱关系的节点不应横向夹在用户连线端点之间。'
    );
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        agent('fanout-source', { x: 0, y: 0 }),
        terminal('fanout-terminal', { x: 10, y: 10 }),
        note('fanout-note', { x: 20, y: 20 })
      ],
      edges: [
        edge('edge-fanout-terminal', 'fanout-source', 'fanout-terminal'),
        edge('edge-fanout-note', 'fanout-source', 'fanout-note')
      ]
    }));

    assert.ok(
      Math.abs(centerX(byId(arranged.nodes, 'fanout-terminal')) - centerX(byId(arranged.nodes, 'fanout-note'))) < 1,
      '同一 source 连接的多个 target 应同列排列，减少多条连线相互跨越。'
    );
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        agent('chain-agent', { x: 0, y: 0 }),
        terminal('chain-terminal', { x: 10, y: 10 }),
        fileNode('chain-file', { x: 20, y: 20 }, ['chain-agent'])
      ],
      edges: [
        edge('edge-chain-agent-terminal', 'chain-agent', 'chain-terminal'),
        edge('edge-chain-terminal-file', 'chain-terminal', 'chain-file')
      ]
    }));

    const arrangedAgent = byId(arranged.nodes, 'chain-agent');
    const arrangedTerminal = byId(arranged.nodes, 'chain-terminal');
    const arrangedFile = byId(arranged.nodes, 'chain-file');
    assert.ok(
      arrangedAgent.position.x < arrangedTerminal.position.x && arrangedTerminal.position.x < arrangedFile.position.x,
      '用户连线链路应按 source -> target 顺序展开，避免链路端点跨越多个节点。'
    );
  }

  {
    const arranged = arrangeCanvasLayout(state({
      nodes: [
        agent('label-source', { x: 0, y: 0 }),
        note('label-target', { x: 10, y: 10 })
      ],
      edges: [
        edge('edge-with-long-label', 'label-source', 'label-target', {
          label: 'very long relationship label for regression'
        })
      ]
    }));

    assert.ok(
      horizontalGap(byId(arranged.nodes, 'label-source'), byId(arranged.nodes, 'label-target')) >= 240,
      '带长文案的连线应在端点之间预留更宽通道，避免 label 被节点挤压。'
    );
  }

  {
    const original = state({
      nodes: [
        agent('agent-a', { x: 0, y: 0 }, { groupId: 'group-a' }),
        terminal('terminal-a', { x: 20, y: 20 }, { groupId: 'group-a' }),
        fileNode('file-a', { x: 30, y: 30 }, ['agent-a'], { groupId: 'group-a' })
      ],
      edges: [edge('edge-a', 'agent-a', 'terminal-a')],
      groups: [group('group-a', { x: -24, y: -52 })]
    });
    const arranged = arrangeCanvasLayout(original);

    for (const originalNode of original.nodes) {
      const arrangedNode = byId(arranged.nodes, originalNode.id);
      assert.equal(arrangedNode.kind, originalNode.kind);
      assert.equal(arrangedNode.groupId, originalNode.groupId);
      assert.deepEqual(arrangedNode.metadata, originalNode.metadata);
    }
    assert.deepEqual(arranged.edges, original.edges, '整理不应改变连线端点或属性。');
    assert.deepEqual(arranged.fileReferences, original.fileReferences, '整理不应改变文件活动引用。');
  }

  console.log('canvas layout arrangement tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
