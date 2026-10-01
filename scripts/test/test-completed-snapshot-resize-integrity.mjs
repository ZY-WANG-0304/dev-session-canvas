import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
const bundled = await esbuild.build({
  stdin: {
    contents: `
      export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { SerializedTerminalStateTracker } from './extensions/vscode/dev-session-canvas/src/common/serializedTerminalState';
    `,
    resolveDir: process.cwd(), sourcefile: 'completed-snapshot-resize-integrity.ts'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'],
  plugins: [{
    name: 'host-boundaries-only',
    setup(build) {
      build.onResolve({ filter: /^(vscode|node-pty|(?:node:)?child_process)$/ }, args => ({
        path: args.path, namespace: 'host-boundary'
      }));
      build.onLoad({ filter: /.*/, namespace: 'host-boundary' }, args => ({
        loader: 'js', contents: args.path === 'vscode' ? `
          class Disposable { dispose() {} }
          class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
          class ThemeIcon { constructor(id) { this.id = id; } }
          class TreeItem {}
          module.exports = {
            Disposable, EventEmitter, ThemeIcon, TreeItem,
            ExtensionMode: { Production: 1, Development: 2, Test: 3 },
            TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
            l10n: { t: message => message },
            env: { appName: 'VS Code Test', shell: '/controlled/shell' },
            workspace: { isTrusted: true, workspaceFolders: [],
              getConfiguration: () => ({ get: (_key, fallback) => fallback, inspect: () => undefined }) },
            window: { showErrorMessage: async () => undefined },
            Uri: { file: fsPath => ({ fsPath, path: fsPath, scheme: 'file' }) }
          };
        ` : `
          function blocked() { throw new Error('Native process creation is forbidden in the snapshot resize test'); }
          module.exports = { spawn: blocked, spawnSync: blocked, fork: blocked,
            exec: blocked, execSync: blocked, execFile: blocked, execFileSync: blocked };
        `
      }));
    }
  }]
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
  require, loaded, loaded.exports,
  path.resolve('scripts/test/completed-snapshot-resize-integrity.cjs'), path.resolve('scripts/test')
);
const { CanvasPanelManager, SerializedTerminalStateTracker } = loaded.exports;
const originalGeometry = { cols: 66, rows: 21 };
const pageGeometry = { cols: 96, rows: 30 };
const scrollback = 100;
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));

function projection(terminal) {
  const buffer = terminal.buffer.active;
  const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '');
  return {
    geometry: { cols: terminal.cols, rows: terminal.rows, baseY: buffer.baseY,
      cursorX: buffer.cursorX, cursorY: buffer.cursorY, viewportY: buffer.viewportY, bufferType: buffer.type,
      absoluteCursorY: buffer.baseY + buffer.cursorY, visibleCursorY: buffer.baseY + buffer.cursorY - buffer.viewportY },
    lines,
    visibleLines: Array.from({ length: terminal.rows }, (_, index) => lines[buffer.viewportY + index] ?? '')
  };
}

async function hydrate(metadata, resize) {
  const terminal = new Terminal({ cols: metadata.lastCols, rows: metadata.lastRows, scrollback, allowProposedApi: true });
  try {
    await write(terminal, metadata.serializedTerminalState.data);
    if (metadata.serializedTerminalState.viewportY !== undefined) {
      terminal.scrollToLine(metadata.serializedTerminalState.viewportY);
    }
    if (resize) terminal.resize(resize.cols, resize.rows);
    return projection(terminal);
  } finally { terminal.dispose(); }
}

const tracker = new SerializedTerminalStateTracker(originalGeometry.cols, originalGeometry.rows, { scrollback });
let savedTerminal;
try {
  tracker.write(Array.from({ length: 40 }, (_, index) =>
    `line-${String(index).padStart(2, '0')}: ${'x'.repeat(45)}`).join('\r\n') + '\r\nFINAL\x1b[8A',
  { outputSequence: 1 });
  savedTerminal = await tracker.flush();
} finally { tracker.dispose(); }

function makeHost(kind, { pendingLaunch, empty = false, withoutSnapshot = false } = {}) {
  const metadata = {
    lifecycle: kind === 'agent' ? 'stopped' : 'closed', persistenceMode: 'snapshot-only',
    attachmentState: 'history-restored', liveSession: false, pendingLaunch,
    lastCols: originalGeometry.cols, lastRows: originalGeometry.rows, outputSequence: 1,
    serializedTerminalState: withoutSnapshot ? undefined : { ...savedTerminal, ...(empty ? { data: '', viewportY: 0 } : {}) }
  };
  const node = { id: `${kind}-1`, kind, status: metadata.lifecycle, title: 'Controlled snapshot',
    summary: 'Completed', position: { x: 0, y: 0 }, metadata: { [kind]: metadata } };
  const host = Object.create(CanvasPanelManager.prototype);
  const saved = [];
  Object.assign(host, {
    nonNativeHostExecutions: new Map(), agentSessions: new Map(), terminalSessions: new Map(),
    state: { nodes: [node], edges: [], groups: [] },
    persistState() { saved.push(structuredClone(host.state)); }, postState() {}
  });
  return { host, node, metadata, saved,
    current: () => host.state.nodes[0].metadata[kind],
    resize: () => host.resizeExecutionSession(kind, node.id, pageGeometry.cols, pageGeometry.rows) };
}

test('the fixed scrollback fixture distinguishes wrong geometry from hydrate-then-resize', { timeout: 5000 }, async () => {
  const { metadata } = makeHost('terminal');
  const expected = await hydrate(metadata, pageGeometry);
  const mislabeled = await hydrate({ ...metadata, lastCols: pageGeometry.cols, lastRows: pageGeometry.rows });
  assert.equal(expected.geometry.absoluteCursorY, mislabeled.geometry.absoluteCursorY);
  assert.deepEqual(expected.lines.filter(Boolean), mislabeled.lines.filter(Boolean));
  assert.notDeepEqual(expected.geometry, mislabeled.geometry);
  assert.notDeepEqual(expected.visibleLines, mislabeled.visibleLines);
  console.log(JSON.stringify({ fixture: 'completed-snapshot-resize', expected: expected.geometry,
    mislabeled: mislabeled.geometry, nonEmptyTextEqual: true, absoluteCursorEqual: true, visibleEqual: false }));
});

for (const kind of ['terminal', 'agent']) {
  for (const pendingLaunch of [undefined, 'start', ...(kind === 'agent' ? ['resume'] : [])]) {
    test(`${kind} completed snapshot keeps its restoration geometry with pending ${pendingLaunch ?? 'none'}`,
      { timeout: 5000 }, async () => {
        const f = makeHost(kind, { pendingLaunch });
        const expected = await hydrate(f.metadata, pageGeometry);
        f.resize();
        const current = f.current();
        assert.deepEqual(current.serializedTerminalState, f.metadata.serializedTerminalState,
          'A page-only resize must not replace the completed snapshot.');
        const restored = await hydrate(current, pageGeometry);
        assert.deepEqual(restored.geometry, expected.geometry,
          'The retained snapshot must restore at its original geometry before fitting the current page.');
        assert.deepEqual(restored.visibleLines, expected.visibleLines);
        assert.deepEqual({ cols: current.lastCols, rows: current.lastRows }, originalGeometry);
        assert.equal(current.pendingLaunch, pendingLaunch);
      });
  }

  test(`${kind} empty completed snapshot also retains its geometry`, () => {
    const f = makeHost(kind, { empty: true });
    f.resize();
    assert.equal(f.current().serializedTerminalState.data, '');
    assert.deepEqual({ cols: f.current().lastCols, rows: f.current().lastRows }, originalGeometry);
  });

  test(`${kind} pending candidate replacement receives page dimensions without relabeling the old snapshot`, () => {
    const f = makeHost(kind, { pendingLaunch: kind === 'agent' ? 'resume' : 'start' });
    const start = { submitted: false, settled: false, originalMetadata: f.metadata, currentMetadata: f.metadata };
    f.host.candidateRuntimeStarts = new Map([[`${kind}:${f.node.id}`, start]]);
    f.resize();
    assert.deepEqual(start.viewport, pageGeometry, 'The new execution still needs the current page dimensions.');
    assert.deepEqual(f.current().serializedTerminalState, f.metadata.serializedTerminalState);
    assert.deepEqual({ cols: f.current().lastCols, rows: f.current().lastRows }, originalGeometry);
    assert.equal(start.currentMetadata, f.metadata, 'A viewport observation must not replace the original snapshot binding.');
  });

  for (const boundary of ['submitted', 'replaced-metadata']) {
    test(`${kind} saved snapshot resize cannot advance a ${boundary} candidate start`, () => {
      const f = makeHost(kind, { pendingLaunch: 'start' });
      const start = { submitted: boundary === 'submitted',
        currentMetadata: boundary === 'replaced-metadata' ? { ...f.metadata } : f.metadata };
      f.host.candidateRuntimeStarts = new Map([[`${kind}:${f.node.id}`, start]]);
      f.resize();
      assert.equal(start.viewport, undefined);
      assert.equal(f.current(), f.metadata);
      assert.equal(f.saved.length, 0);
    });
  }

  test(`${kind} a new node without a saved snapshot still accepts page dimensions`, () => {
    const f = makeHost(kind, { withoutSnapshot: true, pendingLaunch: 'start' });
    f.resize();
    assert.deepEqual({ cols: f.current().lastCols, rows: f.current().lastRows }, pageGeometry);
    assert.equal(f.current().serializedTerminalState, undefined);
    assert.equal(f.saved.length, 1);
  });
}
