import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const sourceRef = process.argv.includes('--current') ? 'working-tree' : 'e07fd17601b2639456dfd4807c1b83905067c8b1';
const sourceDirectory = 'extensions/vscode/dev-session-canvas/src';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsc-host-admission-'));
const stores = [];
const releases = [];
const results = [];
const watchdog = setTimeout(() => { throw new Error('Host admission probe exceeded 45 seconds'); }, 45000);
const invalidSnapshot = /Invalid shared Canvas snapshot; refusing to overwrite it/;
const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};
const vscodeStub = `class Disposable { dispose() {} }
class EventEmitter { event = () => new Disposable(); fire() {} dispose() {} }
class ThemeIcon { constructor(id) { this.id = id; } }
module.exports = { Disposable, EventEmitter, ThemeIcon, TreeItem: class {},
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  l10n: { t: message => message }, env: { appName: 'Isolated probe' },
  workspace: { isTrusted: true, workspaceFolders: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback, inspect: () => undefined }) },
  window: { showErrorMessage: async () => undefined },
  Uri: { file: fsPath => ({ fsPath, path: fsPath, scheme: 'file' }) } };`;
const processStub = `function blocked() { throw new Error('Process/PTY creation forbidden in admission probe'); }
module.exports = { spawn: blocked, spawnSync: blocked, fork: blocked, exec: blocked,
  execSync: blocked, execFile: blocked, execFileSync: blocked };`;

try {
  if (sourceRef !== 'working-tree') {
    const archive = execFileSync('git', ['archive', sourceRef, sourceDirectory, 'packages/attention-protocol/src'], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', temporary], { input: archive });
  }
  const root = sourceRef === 'working-tree' ? process.cwd() : temporary;
  const bundled = await esbuild.build({
    stdin: { contents: `
      export { CanvasPanelManager } from './${sourceDirectory}/panel/CanvasPanelManager';
      export { SharedRootCanvasStore } from './${sourceDirectory}/panel/sharedRootCanvasStore';
      export { SharedRootCanvasParticipants } from './${sourceDirectory}/panel/sharedRootCanvasParticipants';`,
    resolveDir: root, sourcefile: 'host-admission-counterexamples.ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node18',
    nodePaths: [path.join(process.cwd(), 'node_modules')],
    plugins: [{ name: 'isolated-host-boundaries', setup(build) {
      build.onResolve({ filter: /^(vscode|node-pty|(?:node:)?child_process)$/ }, args => ({ path: args.path, namespace: 'boundary' }));
      build.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ loader: 'js',
        contents: args.path === 'vscode' ? vscodeStub : processStub }));
    } }]
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), loaded, loaded.exports, path.join(temporary, 'probe.cjs'), temporary);
  const { CanvasPanelManager, SharedRootCanvasStore, SharedRootCanvasParticipants } = loaded.exports;

  function makeHost(sharedStores = new Map()) {
    const calls = [];
    const operations = [];
    const boundaryError = new Error('Isolated RPC boundary reached');
    const node = { id: 'terminal-fixture', kind: 'terminal', title: 'fixture', status: 'running', summary: '',
      position: { x: 0, y: 0 }, size: { width: 640, height: 360 }, metadata: { terminal: {
        persistenceMode: 'live-runtime', attachmentState: 'reattaching', liveSession: true,
        runtimeSessionId: 'isolated-session', runtimeBackend: 'legacy-detached', runtimeStoragePath: temporary
      } } };
    const host = Object.create(CanvasPanelManager.prototype);
    Object.assign(host, {
      state: { version: 1, updatedAt: '', nodes: [node], groups: [], edges: [], nextGroupSequence: 1 },
      appliedStartupConfiguration: { runtimePersistenceEnabled: true }, sharedRootCanvasStores: sharedStores,
      agentSessions: new Map(), terminalSessions: new Map(), runtimeSupervisorClients: new Map(),
      executionSessionOperationTokens: new Map(), runtimeSupervisorEventAdmissionOpen: true,
      resolveExecutionNodeRuntimeRoot: () => temporary,
      getRuntimeHostBackend: () => ({ kind: 'legacy-detached' }),
      getRuntimeSupervisorClientForKind: async () => { calls.push('client'); return {}; },
      requestRuntimeSupervisorSessionAttach: async (_client, sessionId, isCurrent) => {
        assert.equal(sessionId, 'isolated-session');
        assert.equal(isCurrent(), true);
        calls.push('attach-rpc');
        throw boundaryError;
      },
      reconcilePendingRuntimeReplacements: async () => {},
      retireLegacyRuntimeSupervisorClientIfUnused() {},
      markExecutionNodeAsHistoryRestored() {}, recordDiagnosticEvent() {}, postExecutionSnapshot() {},
      trackRuntimeSupervisorOperation: operation => { operations.push(operation); }
    });
    return { host, node, calls, operations, boundaryError };
  }

  async function check(name, work) {
    await work();
    results.push(name);
    console.log(`PASS ${name}`);
  }

  await check('delayed legacy registration rejects v2 but UI attach still reaches RPC boundary', async () => {
    const fixture = makeHost();
    const filename = path.join(temporary, 'canvas-state.json');
    await writeFile(filename, JSON.stringify({ version: 1, runtimePersistenceEnabled: true, state: fixture.host.state }), { mode: 0o600 });
    const barrier = deferred();
    const entered = deferred();
    releases.push(barrier.resolve);
    const originalRegister = SharedRootCanvasParticipants.prototype.register;
    SharedRootCanvasParticipants.prototype.register = async function () {
      entered.resolve();
      await barrier.promise;
      return originalRegister.call(this);
    };
    let store;
    try {
      store = new SharedRootCanvasStore(filename, structuredClone(fixture.host.state), () => {}, () => {});
      stores.push(store);
    } finally {
      SharedRootCanvasParticipants.prototype.register = originalRegister;
    }
    const readyRejected = assert.rejects(store.ready, invalidSnapshot);
    fixture.host.sharedRootCanvasStores.set(temporary, store);
    await entered.promise;
    assert.deepEqual(await readdir(`${filename}.participants`).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    }), []);
    const envelope = JSON.parse(await readFile(filename, 'utf8'));
    const converted = JSON.stringify({ ...envelope, version: 2, lockProtocol: 'os-file-v1' });
    await writeFile(`${filename}.tmp`, converted);
    await rename(`${filename}.tmp`, filename);
    barrier.resolve();
    await readyRejected;
    await assert.rejects(fixture.host.restoreLiveRuntimeSessions(), invalidSnapshot);
    assert.deepEqual(fixture.calls, []);
    fixture.host.attachExecutionSession('terminal', fixture.node.id);
    assert.equal(fixture.operations.length, 1);
    await assert.rejects(fixture.operations[0], error => error === fixture.boundaryError);
    assert.deepEqual(fixture.calls, ['client', 'attach-rpc']);
    let mutationCalled = false;
    await assert.rejects(store.mutate(fixture.node.id, async () => { mutationCalled = true; }), invalidSnapshot);
    assert.equal(mutationCalled, false);
    assert.equal(await readFile(filename, 'utf8'), converted);
  });

  await check('closed event admission blocks the same UI attach path', async () => {
    const fixture = makeHost();
    fixture.host.runtimeSupervisorEventAdmissionOpen = false;
    fixture.host.attachExecutionSession('terminal', fixture.node.id);
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.operations, []);
  });

  for (const missingRoot of [false, true]) {
    await check(`${missingRoot ? 'missing root in nonempty' : 'empty'} store map lets mutation run`, async () => {
      const otherStore = { mutate: () => assert.fail('Unrelated root must not be used') };
      const fixture = makeHost(missingRoot ? new Map([['other-root', otherStore]]) : new Map());
      let called = false;
      await fixture.host.withSharedExecutionMutation(fixture.node.id, async () => { called = true; });
      assert.equal(called, true);
    });
  }

  await check('present rejecting store blocks mutation instead of executing work', async () => {
    const denied = new Error('Preparation not admitted');
    const fixture = makeHost(new Map([[temporary, { mutate: async () => { throw denied; } }]]));
    let called = false;
    await assert.rejects(fixture.host.withSharedExecutionMutation(fixture.node.id, async () => { called = true; }), error => error === denied);
    assert.equal(called, false);
  });

  await check('empty store map lets automatic restore reach RPC boundary', async () => {
    const fixture = makeHost();
    await assert.rejects(fixture.host.restoreLiveRuntimeSessions(), error => error === fixture.boundaryError);
    assert.deepEqual(fixture.calls, ['client', 'attach-rpc']);
  });

  await check('pending ready blocks automatic restore until ready resolves', async () => {
    const barrier = deferred();
    let readyRead = false;
    const fixture = makeHost(new Map([[temporary, { get ready() { readyRead = true; return barrier.promise; } }]]));
    const restoring = fixture.host.restoreLiveRuntimeSessions();
    const rejected = assert.rejects(restoring, error => error === fixture.boundaryError);
    assert.equal(readyRead, true);
    assert.deepEqual(fixture.calls, []);
    barrier.resolve();
    await rejected;
    assert.deepEqual(fixture.calls, ['client', 'attach-rpc']);
  });

  for (const present of [false, true]) {
    await check(`${present ? 'present' : 'empty'} store map selects ${present ? 'shared departure' : 'ordinary non-preserving boundary'} on mode switch`, async () => {
      const fixture = makeHost(present ? new Map([[temporary, {}]]) : new Map());
      const reached = new Error('Mode switch branch observed');
      const branches = [];
      Object.assign(fixture.host, {
        readStartupConfiguration: () => ({ runtimePersistenceEnabled: false }),
        captureModeSwitchRuntimeBindings() {}, flushSharedRootCanvasStores: async () => {},
        leaveSharedCanvasesForModeSwitch: async () => { branches.push('shared'); throw reached; },
        prepareForHostBoundary: async options => {
          assert.equal(options.preserveLiveRuntime, false);
          assert.equal(options.preserveRootRuntimeBindings, false);
          branches.push('ordinary');
          throw reached;
        }
      });
      await assert.rejects(fixture.host.cleanupRuntimePersistenceModeSwitch(), error => error === reached);
      assert.deepEqual(branches, [present ? 'shared' : 'ordinary']);
    });
  }

  const hashes = {};
  for (const basename of ['CanvasPanelManager', 'sharedRootCanvasStore', 'sharedRootCanvasParticipants']) {
    hashes[basename] = createHash('sha256').update(await readFile(path.join(root, sourceDirectory, 'panel', `${basename}.ts`))).digest('hex');
  }
  console.log(JSON.stringify({ sourceRef, hashes, node: process.version, platform: process.platform,
    passed: results.length, productValidated: false,
    scope: 'Real methods with controlled registration; VS Code shell and runtime RPC boundaries stubbed. No real stop or Electron migration tested.' }, null, 2));
} finally {
  for (const release of releases) release();
  await Promise.allSettled(stores.map(store => store.ready));
  for (const store of stores) store.dispose();
  await rm(temporary, { recursive: true, force: true });
  clearTimeout(watchdog);
}
