// 只用于定位生产模式切换边界；没有产品验收回执。
// 从仓库根目录执行：node docs/references/release-gate-redesign/implementation/runtime-mode-switch-reproduction.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const cwd = process.cwd();
const vscodeStub = String.raw`class Disposable { dispose() {} }
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
};`;
const processStub = String.raw`function blocked() {
  throw new Error('Native process creation is forbidden in the Host deactivation test');
}
module.exports = { spawn: blocked, spawnSync: blocked, fork: blocked,
  exec: blocked, execSync: blocked, execFile: blocked, execFileSync: blocked };`;

const bundled = await esbuild.build({
  stdin: {
    contents: `
      export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
      export { RuntimeSupervisorClient } from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
      export { TerminalAvailableNotifications } from './extensions/vscode/dev-session-canvas/src/panel/terminalAvailableNotifications';
      export { RuntimeTerminalReadRelay } from './extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay';
      export { namespaceCanvasObjectId } from './extensions/vscode/dev-session-canvas/src/common/canvasMultiRootComposition';
      export { createRuntimeOwnerDescriptor, resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerBaseStoragePath }
        from './extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership';
      export { workspace as vscodeWorkspace } from 'vscode';
    `,
    resolveDir: cwd,
    sourcefile: 'runtime-host-deactivation-integrity.ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['node-pty'],
  plugins: [{
    name: 'host-boundaries-only',
    setup(build) {
      build.onResolve({ filter: /^(vscode|node-pty|(?:node:)?child_process)$/ }, args => ({
        path: args.path,
        namespace: 'host-boundary'
      }));
      build.onLoad({ filter: /.*/, namespace: 'host-boundary' }, args => ({
        loader: 'js',
        contents: args.path === 'vscode' ? vscodeStub : processStub
      }));
    }
  }]
});

const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
  createRequire(path.join(cwd, 'package.json')), loaded, loaded.exports,
  path.resolve('scripts/test/runtime-host-deactivation-integrity.cjs'), path.resolve('scripts/test')
);
const { CanvasPanelManager, RuntimeSupervisorClient, TerminalAvailableNotifications,
  RuntimeTerminalReadRelay, namespaceCanvasObjectId, vscodeWorkspace, createRuntimeOwnerDescriptor,
  resolveRootRuntimeSupervisorGeneration, resolveRuntimeRootOwnerBaseStoragePath } = loaded.exports;

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeSession() {
  return {
    owner: 'supervisor',
    sessionId: 'session-1',
    runtimeSessionId: 'session-1',
    runtimeBackend: 'legacy-detached',
    runtimeGuarantee: 'best-effort',
    runtimeStoragePath: '/controlled/runtime',
    terminalProjectionMode: 'legacy-interactive',
    lifecycleStatus: 'running',
    displayLabel: 'controlled',
    shellPath: '/controlled/shell',
    cwd: '/controlled',
    cols: 119,
    rows: 41,
    buffer: 'live output',
    outputSequence: 2,
    pendingOutput: '',
    terminalTitle: undefined,
    stopRequested: false,
    terminalStateTrusted: false,
    terminalStateTracker: { dispose() {}, flush: async () => undefined },
    lineContextTracker: { dispose() {}, resize() {}, write() {} },
    syncTimer: undefined,
    syncDueAtMs: undefined,
    reconnectTimer: undefined,
    lifecycleTimer: undefined,
    outputFlushTimer: undefined,
    terminalStreamPaged: false
  };
}

function makeHost() {
  const session = makeSession();
  const terminalSessions = new Map([['terminal-1', session]]);
  const persisted = [];
  const diagnostics = [];
  const remoteCalls = [];
  const node = {
    id: 'terminal-1',
    kind: 'terminal',
    title: 'Controlled terminal',
    position: { x: 1, y: 2 },
    size: { width: 640, height: 360 },
    status: 'running',
    summary: 'running',
    metadata: {
      terminal: {
        persistenceMode: 'live-runtime',
        attachmentState: 'attached-live',
        liveSession: true,
        runtimeBackend: 'legacy-detached',
        runtimeSessionId: 'session-1',
        runtimeStoragePath: '/controlled/runtime',
        lastCols: 107,
        lastRows: 33
      }
    }
  };
  const host = Object.create(CanvasPanelManager.prototype);
  host.terminalAvailableNotifications = new TerminalAvailableNotifications();
  Object.assign(host, {
    context: { extensionMode: 3, extensionUri: { fsPath: cwd } },
    appliedStartupConfiguration: { runtimePersistenceEnabled: false },
    rawExtensionStoragePath: path.join(cwd, 'controlled-workspace-slot'),
    resolveRuntimeCreationTarget: async rootPath => ({ rootPath, runtimeStoragePath: '/controlled/runtime' }),
    state: { version: 1, nodes: [node], edges: [], groups: [] },
    activeSurface: 'editor',
    agentSessions: new Map(),
    terminalSessions,
    runtimeSessionBindings: new Map([['terminal:session-1:/controlled/runtime:legacy-detached', {
      kind: 'terminal', nodeId: 'terminal-1', runtimeSessionId: 'session-1'
    }]]),
    runtimeSupervisorClients: new Map(),
    preferredRootRuntimeBackends: new Map(),
    runtimeSupervisorEventAdmissionOpen: true,
    runtimeSupervisorClientEpochs: new Map(),
    pendingRuntimeSupervisorOperations: new Set(),
    nonNativeHostExecutions: new Map(),
    terminalProjectionRefreshScheduler: { clearMatching() {} },
    terminalReadRelay: { closeMatching() {}, usesClient: () => false },
    scheduledExecutionOutputPosts: new Map(),
    pendingTerminalInitialInputs: new Map(),
    pendingWorkspaceStateUpdate: Promise.resolve(),
    hasActiveExecutionSessions: () => terminalSessions.size > 0,
    getExecutionSessions: kind => kind === 'terminal' ? terminalSessions : host.agentSessions,
    persistState: options => {
      persisted.push({ options, state: structuredClone(host.state) });
      return Promise.resolve();
    },
    postState() {},
    flushDeferredCanvasStatePersist: async () => undefined,
    waitForPendingWorkspaceStateUpdates: async () => undefined,
    clearPendingTerminalInitialInputs() {},
    clearExecutionTerminalProjectionRefreshTimers() {},
    clearScheduledExecutionOutputPost() {},
    recordDiagnosticEvent: (name, details) => diagnostics.push({ name, details }),
    postMessage() {},
    stopSession() { remoteCalls.push('stop'); },
    deleteSession() { remoteCalls.push('delete'); }
  });
  // Keep the direct map reference used by the test fixture and the Host methods aligned.
  host.runtimeSessionBindings = new Map([[
    host.buildRuntimeSessionBindingKey('terminal', 'session-1', '/controlled/runtime', 'legacy-detached'),
    { kind: 'terminal', nodeId: 'terminal-1', runtimeSessionId: 'session-1' }
  ]]);
  return { host, session, persisted, diagnostics, remoteCalls, node };
}

const results=[];
for (const shared of [false,true]) for (const entry of ['simulateRuntimeReloadForTest','prepareForDeactivation']) {
  const f=makeHost(),callback=deferred();
  const events=[],published=[],snapshot=structuredClone(f.host.state);
  f.host.isRuntimePersistenceEnabled=()=>true;
  f.host.readStartupConfiguration=()=>({runtimePersistenceEnabled:false});
  f.host.getExecutionCandidateProfile=()=>({profile:'controlled-production-candidate'});
  f.host.getExecutionCandidateScheduler=()=>({now:()=>Date.now(),scheduleDeadline:(limit,fire)=>{const timer=setTimeout(fire,Math.max(1,limit-Date.now()));return ()=>clearTimeout(timer);}});
  f.host.nonNativeExecutionOwner=undefined;
  f.host.flushAllExecutionSessionStatesForHostBoundary=async()=>{};
  f.host.invalidateAllExecutionSessionOperations=()=>{};
  f.host.getCanvasPersistenceWorkspaceFolders=()=>[{path:'/controlled/root-a'}];
  f.host.captureSharedSupervisorProcesses=async()=>new Set();
  f.host.applySharedRootCanvasState=()=>{};
  if(shared) f.host.sharedRootCanvasStores=new Map([['/controlled/root-a',{
    admissionPort:32000,flush:async()=>{},
    depart:async(action)=>action(true,f.host.state,{beginSettlement:()=>true,settle:()=>{},preserved:false}),
    publish:async(state)=>published.push(state)
  }]]);
  f.host.collectPersistedLiveRuntimeSessions=()=>[{kind:'terminal',sessionId:'session-1',runtimeStoragePath:'/controlled/runtime',runtimeOwner:{root:{normalizedPath:'/controlled/root-a'}}}];
  f.host.deleteRuntimeSupervisorSessions=async sessions=>{
    events.push({stage:'delete-original-sessions',ids:sessions.map(value=>value.sessionId),admission:f.host.runtimeSupervisorEventAdmissionOpen});
    f.host.trackRuntimeSupervisorStateCallback(callback.promise);
    events.push({stage:'state-callback-admitted-during-delete',pending:f.host.pendingRuntimeSupervisorStateCallbacks.size});
  };
  let firstError;
  try{await f.host[entry]();}catch(error){firstError=error;}
  assert.match(firstError?.message??'',/Runtime session updates are still pending/);
  assert.equal(f.host.runtimeSupervisorEventAdmissionOpen,true,'The production mode-switch path runs before permanent admission closes');
  assert.deepEqual(f.host.state,snapshot,'A refused boundary must not clear the original graph');
  assert.equal(f.host.terminalSessions.get('terminal-1'),f.session);
  assert.equal(published.length,0);
  callback.resolve();await Promise.allSettled([...f.host.pendingRuntimeSupervisorStateCallbacks]);
  let repeatedError;
  try{await f.host[entry]();}catch(error){repeatedError=error;}
  assert.equal(repeatedError,firstError,'The stored mode-switch failure is not automatically retried');
  results.push({shared,entry,firstError:firstError.message,repeatedError:repeatedError.message,admission:f.host.runtimeSupervisorEventAdmissionOpen,
    nodes:f.host.state.nodes.length,bindings:f.host.runtimeSessionBindings.size,pendingCallbacks:f.host.pendingRuntimeSupervisorStateCallbacks.size,events,
    scope:'Production CanvasPanelManager methods; controlled store and delete continuation; no real PTY or Electron; acceptance false'});
}
console.log(JSON.stringify({acceptance:false,status:'reproduced-production-mode-switch-path',results},null,2));
