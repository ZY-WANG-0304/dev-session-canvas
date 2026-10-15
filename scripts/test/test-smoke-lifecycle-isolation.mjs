import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

// Execute the actual manager and its protocol methods; only VS Code and payload I/O are boundaries.
const bundled = await esbuild.build({
  stdin: { contents: `
    export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
    export { RuntimeTerminalReadRelay } from './extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay';
    export { TerminalAvailableNotifications } from './extensions/vscode/dev-session-canvas/src/panel/terminalAvailableNotifications';
  `, resolveDir: process.cwd(), sourcefile: 'smoke-lifecycle-isolation-entry.ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['node-pty'],
  plugins: [{ name: 'vscode-boundary', setup(build) {
    build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'boundary' }));
    build.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({ contents: `
      class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
      module.exports = { EventEmitter, ExtensionMode: { Production: 1, Test: 3 },
        l10n: { t: text => text }, workspace: { isTrusted: true }, window: {} };
    `, loader: 'js' }));
  } }]
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { CanvasPanelManager, RuntimeTerminalReadRelay, TerminalAvailableNotifications } = loaded.exports;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(surface) {
  const host = Object.create(CanvasPanelManager.prototype);
  const frames = Object.fromEntries(['editor', 'panel'].map(key => [key, host.createLifecycleRaceFakeWebview(`real-${key}`)]));
  const runtime = { workspaceTrusted: true, surfaceLocation: surface, workspaceFolders: [],
    defaultAgentProvider: 'codex', agentLaunchDefaults: {}, strongTerminalAttentionReminderMode: 'off' };
  Object.assign(host, {
    context: { extensionMode: 3 }, activeSurface: surface, canvasTemplateInitialized: true,
    state: { nodes: [], groups: [], edges: [] },
    editorPanel: { webview: frames.editor.webview, visible: true },
    panelView: { webview: frames.panel.webview, visible: true },
    surfaceMode: { editor: 'active', panel: 'active' }, surfaceReady: { editor: false, panel: false },
    surfaceLifecycle: { editor: { generation: 7, mode: 'active', ready: false, bootstrapAck: false },
      panel: { generation: 9, mode: 'active', ready: false, bootstrapAck: false } },
    surfaceMessageWebview: { editor: frames.editor.webview, panel: frames.panel.webview },
    renderedWebviewLifecycle: new WeakMap(), pendingBootstrapHostMessages: {},
    pendingWebviewProbeRequests: new Map(), pendingWebviewDomActionRequests: new Map(),
    pendingWorkspaceRootFocusReplay: {}, pendingVisibilityRestore: { editor: false, panel: false },
    pendingVisibilityRestoreFocus: {}, lastVisibleCanvasCenterBySurface: { panel: { x: 5, y: 6 } },
    diagnosticHostMessages: [], testHostMessages: [], testDiagnosticEvents: [],
    terminalReadRelay: new RuntimeTerminalReadRelay(), terminalAvailableNotifications: new TerminalAvailableNotifications(),
    getWebviewOptions: () => ({}), prepareCanvasStateForWebview: () => structuredClone(host.state),
    getRuntimeContext: () => structuredClone(runtime), notifySidebarStateChanged() {},
    getCanvasTemplateCatalog: async () => ({ templates: [], issues: [] }),
    reconcileDefaultCanvasTemplateId: async () => undefined
  });
  for (const key of ['editor', 'panel']) host.renderedWebviewLifecycle.set(frames[key].webview, host.getSurfaceLifecycleIdentity(key));
  const lifecycle = { ...host.getSurfaceLifecycleIdentity(surface), frameId: `real-${surface}-frame` };
  const send = (type, payload) => host.handleWebviewMessage(surface,
    { type, lifecycle, ...(payload === undefined ? {} : { payload }) }, frames[surface].webview);
  const ready = async () => {
    send('webview/ready'); await tick();
    assert(frames[surface].postedMessages.some(message => message.type === 'host/bootstrap'), 'Original ready must produce real bootstrap');
    send('webview/bootstrapAck'); await tick();
  };
  return { host, frames, lifecycle, send, ready };
}

function assertFake(result) {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'boolean') assert.equal(value, key !== 'gatedMessageDeliveredBeforeAck', key);
  }
  assert.equal(result.surface, 'panel');
  assert.equal(result.competingWebviewPostedTypes.includes('host/bootstrap'), false);
}

async function protectResponsibilities(f) {
  const { host } = f;
  let released = 0;
  // A live panel reader must never be cancelled by diagnostic fake panel renders.
  const descriptor = { readId: 'retained-read', sessionId: 'retained-session', authorityId: 'retained-authority', headRevision: 0,
    checkpoint: { version: 1, sessionId: 'retained-session', authorityId: 'retained-authority', revision: 0,
      cols: 80, rows: 24, scrollback: 1000, createdAtMs: 1,
      serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 0 } } };
  await host.terminalReadRelay.open('panel:terminal:retained', {
    openTerminalRead: async () => descriptor,
    closeTerminalRead: async () => { released++; return { settlement: 'recorded' }; }
  }, 'retained-session', 'retained-authority', 'panel');
  host.terminalAvailableNotifications.offer('panel:terminal:retained', {
    nodeId: 'retained', kind: 'terminal', executionSessionId: 'retained-session', authorityId: 'retained-authority', revision: 0
  }, () => true, true);
  const focus = { groupId: 'retained-focus', expiresAtMs: Date.now() + 60000 };
  host.pendingWorkspaceRootFocusReplay.editor = focus;
  const queued = [{ type: 'host/themeChanged' }];
  host.pendingBootstrapHostMessages.editor = queued;
  const pendingProbe = { surface: 'editor', timeout: setTimeout(() => {}, 60000), reject() { throw new Error('Real probe cancelled'); } };
  const pendingDom = { surface: 'editor', timeout: setTimeout(() => {}, 60000), reject() { throw new Error('Real DOM action cancelled'); } };
  host.pendingWebviewProbeRequests.set('retained-probe', pendingProbe);
  host.pendingWebviewDomActionRequests.set('retained-dom', pendingDom);
  const panelProbe = { ...pendingProbe, surface: 'panel' }, panelDom = { ...pendingDom, surface: 'panel' };
  host.pendingWebviewProbeRequests.set('retained-panel-probe', panelProbe);
  host.pendingWebviewDomActionRequests.set('retained-panel-dom', panelDom);
  const localReaders = new Map(['editor', 'panel'].map(surface => [surface,
    { pendingPublications: new Set(), outcome: undefined }]));
  host.nonNativeExecutionOwner = { options: { capabilities: ['terminal-local-settlement-v1'] } };
  host.nonNativeHostExecutions = new Map([['retained', { localReaders, readerAdmissionClosed: true,
    execution: { identity: { executionId: 'retained-execution' }, settleReaders() { throw new Error('Real readers cancelled'); } } }]]);
  host.recordDiagnosticEvent('retained/event'); host.recordHostMessage('editor', { type: 'host/themeChanged' }, true);
  return {
    check() {
      assert.equal(released, 0, 'Diagnostic must not close real terminal reader');
      assert.equal(host.terminalAvailableNotifications.size, 1, 'Diagnostic must not clear real notifications');
      assert.equal(host.pendingWorkspaceRootFocusReplay.editor, focus, 'Diagnostic must preserve focus replay');
      assert.equal(host.pendingBootstrapHostMessages.editor, queued, 'Diagnostic must preserve exact queue');
      assert.equal(host.pendingWebviewProbeRequests.get('retained-probe'), pendingProbe);
      assert.equal(host.pendingWebviewDomActionRequests.get('retained-dom'), pendingDom);
      assert.equal(host.pendingWebviewProbeRequests.get('retained-panel-probe'), panelProbe);
      assert.equal(host.pendingWebviewDomActionRequests.get('retained-panel-dom'), panelDom);
      assert([...localReaders.values()].every(reader => reader.outcome === undefined), 'Real local readers must remain unsettled');
      assert(host.testDiagnosticEvents.some(event => event.kind === 'retained/event'));
      assert(host.testHostMessages.some(message => message.type === 'host/themeChanged'));
    },
    cleanup() { clearTimeout(pendingProbe.timeout); clearTimeout(pendingDom.timeout); }
  };
}

const originalWait = CanvasPanelManager.prototype.waitForLifecycleRaceTemplateCatalogPost;
for (const surface of ['editor', 'panel']) {
  for (const timing of ['during', 'before', 'after']) {
    const f = fixture(surface), reached = deferred(), release = deferred();
    if (timing === 'before') await f.ready();
    CanvasPanelManager.prototype.waitForLifecycleRaceTemplateCatalogPost = async function (...args) {
      const result = await originalWait.apply(this, args);
      reached.resolve(); await release.promise; return result;
    };
    const diagnostic = f.host.runWebviewLifecycleRaceDiagnosticsForTest();
    try {
      await reached.promise;
      if (timing === 'during') await f.ready();
      f.host.recordDiagnosticEvent('real/during-diagnostic');
      release.resolve(); const result = await diagnostic; assertFake(result);
      if (timing === 'after') await f.ready();
      assert.equal(f.host.activeSurface, surface);
      assert.equal(f.host.surfaceMessageWebview[surface], f.frames[surface].webview);
      assert.deepEqual(f.host.getSurfaceLifecycleIdentity(surface), f.lifecycle);
      assert.equal(f.host.surfaceReady[surface], true);
      assert.equal(f.host.surfaceLifecycle[surface].bootstrapAck, true);
      if (timing === 'during') assert(f.host.testDiagnosticEvents.some(event => event.kind === 'real/during-diagnostic'), 'Real diagnostic event must survive');
      assert(f.host.testDiagnosticEvents.every(event => event.detail?.lifecycle?.frameId?.startsWith('frame-lifecycle-race') !== true));
      f.send('webview/updateViewportCenter', { visibleCenter: { x: 88, y: 99 } });
      assert.deepEqual(f.host.lastVisibleCanvasCenterBySurface[surface], { x: 88, y: 99 });
      console.info(`ok: real ${surface} ready ${timing} fake lifecycle diagnostics`);
    } finally { release.resolve(); await diagnostic.catch(() => {}); CanvasPanelManager.prototype.waitForLifecycleRaceTemplateCatalogPost = originalWait; }
  }
}
for (const fail of [false, true]) {
  const f = fixture('editor'); const protectedState = await protectResponsibilities(f);
  CanvasPanelManager.prototype.waitForLifecycleRaceTemplateCatalogPost = async function (...args) {
    if (fail) throw new Error('Controlled diagnostic failure');
    return originalWait.apply(this, args);
  };
  try {
    if (fail) await assert.rejects(f.host.runWebviewLifecycleRaceDiagnosticsForTest(), /Controlled diagnostic failure/);
    else assertFake(await f.host.runWebviewLifecycleRaceDiagnosticsForTest());
    protectedState.check(); console.info(`ok: real responsibilities preserved on diagnostic ${fail ? 'failure' : 'success'}`);
  } finally { protectedState.cleanup(); CanvasPanelManager.prototype.waitForLifecycleRaceTemplateCatalogPost = originalWait; }
}
const missing = fixture('editor');
assertFake(await missing.host.runWebviewLifecycleRaceDiagnosticsForTest());
assert.equal(missing.host.surfaceReady.editor, false, 'Diagnostics must never invent real ready');
assert.equal(missing.frames.editor.postedMessages.length, 0);
console.info('ok: absent real ready remains absent');
missing.host.context.extensionMode = 1;
await assert.rejects(missing.host.runWebviewLifecycleRaceDiagnosticsForTest(), /仅在测试模式/);
console.info('ok: production mode diagnostic guard');
