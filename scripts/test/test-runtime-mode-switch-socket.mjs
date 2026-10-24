import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import esbuild from 'esbuild';

// Production recovery and credit consumption; snapshot/UI delivery are explicit boundaries.
const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-mode-exit-'));
const processes = new Set();
let listener, server, client;
const sockets = new Set();
try {
  const runtimeBundle = await esbuild.build({
    stdin: {
      contents: `
 export {createExecutionSessionProcess} from './extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge';
 export {RuntimeSupervisorServer} from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain';
 export {RuntimeSupervisorClient} from './extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient';
 export {TerminalSessionJournal} from './extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal';
 export {SerializedTerminalStateTracker,SERIALIZED_TERMINAL_CHECKPOINT_PROFILES} from './extensions/vscode/dev-session-canvas/src/common/serializedTerminalState';`, resolveDir: process.cwd(), loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'], write: false
  });
  const require = createRequire(import.meta.url);
  const loaded = {
    exports: {}
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', runtimeBundle.outputFiles[0].text)(require, loaded, loaded.exports, path.resolve('scripts/test/runtime-restore-subscription.cjs'), path.resolve('scripts/test'));
  const modules = loaded.exports;
  const { CanvasPanelManager: Harness, ExecutionTerminalLineContextTracker } = await loadHost(directory);
  const paths = {
    storageDir: directory,
    socketPath: process.platform === 'win32'
      ? String.raw`\\.\pipe\dsc-mode-exit-${process.pid}-${path.basename(directory)}`
      : path.join(directory, 'runtime.sock'),
    registryPath: path.join(directory, 'registry.json'),
    socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage'
  };
  server = new modules.RuntimeSupervisorServer(paths, 'legacy-detached', 'best-effort');
  server.schedulePersist = () => {
  };
  server.scheduleIdleShutdownIfNeeded = () => {
  };
  listener = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    server.acceptSocket(socket);
  });
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(paths.socketPath, resolve);
  });
  const backend = {
    kind: 'legacy-detached', guarantee: 'best-effort', label: 'Controlled original runtime', paths, startSupervisor: async () => assert.fail('No external process may start')
  };
  for (const concurrentRestore of [false, true]) {
    const sessionId = concurrentRestore ? 'late-restore' : 'single-restore';
    const journal = await modules.TerminalSessionJournal.create({
      storageDir: directory, sessionId, initialCols: 80, initialRows: 24, initialScrollback: 1000, eventCacheMaxBytes: 0, checkpointProfiles: modules.SERIALIZED_TERMINAL_CHECKPOINT_PROFILES
    });
    const tracker = new modules.SerializedTerminalStateTracker(80, 24, {
      scrollback: 1000, initialOutputSequence: 0
    });
    const processHandle = modules.createExecutionSessionProcess({
      file: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', args: [], cols: 80, rows: 24, cwd: directory, env: process.env
    });
    processes.add(processHandle);
    let actualExit;
    const exited = new Promise(resolve => processHandle.onExit(event => {
      actualExit = event;
      resolve();
    }));
    const runtime = {
      sessionId, kind: 'terminal', live: true, lifecycle: 'live', launchMode: 'start', displayLabel: sessionId, runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort', shellPath: '/controlled-shell', cwd: directory, cols: 80, rows: 24, scrollback: 1000, output: '', outputSequence: 0, startedAtMs: Date.now(), terminalAuthorityId: journal.getAuthorityId(), terminalJournal: journal, terminalStateTracker: tracker, terminalOperationChain: Promise.resolve(), terminalMutationAdmissionOpen: true, terminalCheckpoint: {
        version: 1, sessionId, authorityId: journal.getAuthorityId(), revision: 0, cols: 80, rows: 24, scrollback: 1000, createdAtMs: Date.now(), serializedState: tracker.getSerializedState()
      }, process: processHandle
    };
    server.sessions.set(sessionId, runtime);
    server.bindSessionProcess(runtime);
    const host = Object.create(Harness.prototype);
    const diagnostics = [];
    const outcomes = [];
    const line = new ExecutionTerminalLineContextTracker(80, 24, {
      cwd: directory, pathStyle: 'posix', scrollback: 1000
    });
    const managed = {
      owner: 'supervisor', sessionId, runtimeSessionId: sessionId, runtimeBackend: 'legacy-detached', runtimeStoragePath: directory, terminalStreamPaged: true, terminalStreamHealthy: true, terminalAuthorityId: journal.getAuthorityId(), outputSequence: 0, terminalProjectionMode: 'terminal-stream-v1', terminalStateTrusted: false, cols: 80, rows: 24, buffer: '', pendingOutput: '', lifecycleStatus: 'live', lineContextTracker: line
    };
    const sessions = new Map([['node', managed]]);
    host.state = {
      nodes: [{
          id: 'node', kind: 'terminal', status: 'live', metadata: {
            terminal: {
              persistenceMode: 'live-runtime', attachmentState: 'reattaching', runtimeSessionId: sessionId, runtimeStoragePath: directory, runtimeBackend: 'legacy-detached'
            }
          }
        }]
    };
    host.runtimeSupervisorEventAdmissionOpen = true;
    host.executionSessionOperationTokens = new Map();
    host.runtimeSessionBindings = new Map();
    host.pendingRuntimeSupervisorOperations = new Set();
    host.resolveRuntimeStoragePath = p => p;
    host.buildRuntimeSessionBindingKey = (...parts) => JSON.stringify(parts);
    host.getExecutionSessions = () => sessions;
    host.bindRuntimeSession('node', 'terminal', sessionId, directory, 'legacy-detached');
    const key = host.buildRuntimeSessionBindingKey('terminal', sessionId, directory, 'legacy-detached');
    host.requireNode = () => host.state.nodes[0];
    host.getLiveRuntimeReconnectBlockReason = () => undefined;
    host.sharedRootCanvasStores = new Map();
    host.getRuntimeHostBackend = () => backend;
    host.retireLegacyRuntimeSupervisorClientIfUnused = () => {
    };
    host.runtimeSupervisorClients = new Map();
    host.markExecutionNodeAsHistoryRestored = () => assert.fail('Restore must not fail');
    for (const name of ['postState', 'postMessage', 'recordExecutionPerformanceDiagnostics', 'queueExecutionStateSync', 'clearExecutionTerminalProjectionRefreshTimers', 'flushExecutionOutputImmediately', 'reconnectPagedRuntimeSession', 'queueExecutionOutput', 'postTerminalAvailable'])
      host[name] = () => {
      };
    host.recordDiagnosticEvent = (name, detail) => diagnostics.push({
      name, detail
    });
    host.bridgeExecutionAttentionSignals = async () => {
    };
    let projectedLive = true;
    const saveGate = deferred();
    const saveEntered = deferred();
    let holdSave = false;
    let applyCount = 0;
    host.applyRuntimeSupervisorSnapshot = async (_id, _kind, snapshot) => {
      applyCount++;
      if (holdSave) { saveEntered.resolve(); await saveGate.promise; }
      host.state.nodes[0].metadata.terminal.attachmentState = 'attached-live';
      projectedLive = snapshot.live;
      managed.lifecycleStatus = snapshot.lifecycle;
      managed.outputSequence = snapshot.terminalRevision;
      managed.terminalStreamHealthy = true;
      if (!snapshot.live) {
        sessions.delete('node');
        host.runtimeSessionBindings.delete(key);
      }
    };
    host.postExecutionExitWithFinalSnapshot = async () => {
    };
    client = new modules.RuntimeSupervisorClient({
      backend, supervisorScriptPath: 'unused', onSessionTerminalBatch: async (batch, current) => {
        const operation = host.handleRuntimeSupervisorTerminalBatch('legacy-detached', directory, batch, current);
        host.trackRuntimeSupervisorStateCallback(operation.then(() => undefined), key);
        const outcome = await operation;
        outcomes.push({
          batchId: batch.batchId, revision: batch.revision, live: batch.snapshot?.live, outcome
        });
        return outcome;
      }
    });
    await client.ensureConnected({
      allowRestart: false
    });
    let restoreAcquisitions = 0;
    let subscriptionAcquisitions = 0;
    let subscribing = false;
    const subscribe = host.subscribeRuntimeSupervisorTerminalStream;
    host.subscribeRuntimeSupervisorTerminalStream = async (...args) => {
      subscribing = true;
      try { return await subscribe.apply(host, args); }
      finally { subscribing = false; }
    };
    let enteredFirst;
    let releaseFirst;
    const firstEntered = new Promise(resolve => enteredFirst = resolve);
    const firstGate = new Promise(resolve => releaseFirst = resolve);
    let releaseLate;
    const lateGate = new Promise(resolve => releaseLate = resolve);
    host.getRuntimeSupervisorClientForKind = async () => {
      if (subscribing) subscriptionAcquisitions++;
      else {
        restoreAcquisitions++;
        if (concurrentRestore && restoreAcquisitions === 1) {
          enteredFirst();
          await firstGate;
        } else if (concurrentRestore && restoreAcquisitions === 2) {
          // Only delay the duplicate recovery's client acquisition. The first
          // recovery's real subscription must finish before this request resumes.
          await lateGate;
        }
      }
      return client;
    };
    const firstRestore = host.restoreLiveRuntimeSessions();
    let secondRestore;
    if (concurrentRestore) {
      await firstEntered;
      secondRestore = host.restoreLiveRuntimeSessions();
      await Promise.resolve();
      releaseFirst();
    }
    await firstRestore;
    await until(() => outcomes.some(item => item.outcome === 'consumed') && !flow(server, sessionId)?.inFlight, 'first restore subscription consumed');
    assert.equal(actualExit, undefined, 'the original PTY must still be live before Stop');
    const firstRestoreSubscribed = Boolean(flow(server, sessionId));
    if (concurrentRestore) {
      releaseLate();
      await secondRestore;
    }
    const subscriptionExistsBeforeStop = Boolean(flow(server, sessionId));
    console.log(JSON.stringify({ concurrentRestore, restoreAcquisitions, subscriptionAcquisitions,
      firstRestoreSubscribed, subscriptionExistsBeforeStop }));
    assert.equal(firstRestoreSubscribed, true);
    assert.equal(subscriptionExistsBeforeStop, true, 'late recovery must preserve the established real subscription');
    assert.equal(restoreAcquisitions, 1, 'same-session recovery shares client acquisition');
    assert.equal(subscriptionAcquisitions, 1);
    const ignoredBeforeStop = diagnostics.filter(e => e.name === 'execution/operationIgnored');
    assert.equal(ignoredBeforeStop.length, 0);
    const marker = `RECOVERED-${sessionId}`;
    processHandle.write(process.platform === 'win32'
      ? `echo ${marker}\r` : `printf '${marker}\\n'\r`);
    await until(() => managed.buffer.includes(marker) && !flow(server, sessionId)?.inFlight, 'real PTY output consumed after recovery');
    // Use the actual Host boundary and real strict delete; only snapshot/UI persistence is controlled.
    const stateFile = path.join(directory, `${sessionId}-canvas.json`);
    Object.assign(host, {
      context: { extensionMode: 3 }, appliedStartupConfiguration: { runtimePersistenceEnabled: true },
      readStartupConfiguration: () => ({ runtimePersistenceEnabled: false }),
      getCanvasPersistenceWorkspaceFolders: () => [],
      getExecutionCandidateProfile: () => undefined,
      agentSessions: new Map(), terminalSessions: sessions,
      getRuntimeSupervisorClientForBackend: async () => client,
      prepareStoppedLegacyHistoryRetirement: async () => undefined,
      getSurfaceLifecycleIdentity: () => undefined,
      flushAllExecutionSessionStatesForHostBoundary: async () => {},
      clearSupervisorHostBoundaryTimers() {}, clearPendingTerminalInitialInputs() {},
      terminalProjectionRefreshScheduler: { clearMatching() {} },
      flushDeferredCanvasStatePersist: async () => {}, waitForPendingWorkspaceStateUpdates: async () => {},
      persistState: async () => writeFile(stateFile, JSON.stringify(host.state)),
      disposeRuntimeSupervisorClients() {},
      retireLegacyRuntimeSupervisorClientIfUnused() {}
    });
    const deleteEntered = deferred(), releaseDelete = deferred(), deleteConfirmed = deferred();
    const serverDelete = server.deleteSession.bind(server);
    server.deleteSession = async (...args) => {
      deleteEntered.resolve(); await releaseDelete.promise;
      return serverDelete(...args);
    };
    const strictDelete = client.deleteSessionStrict.bind(client);
    client.deleteSessionStrict = (...args) => {
      const observation = strictDelete(...args);
      void observation.first.then(result => deleteConfirmed.resolve(result));
      return observation;
    };
    let finished = false;
    const cleanup = host.cleanupRuntimePersistenceModeSwitch().then(() => { finished = true; });
    const settled = cleanup.then(() => undefined, error => error);
    try {
      await checkpoint(deleteEntered.promise, settled, 'delete dispatch');
      holdSave = true;
      processHandle.write(process.platform === 'win32' ? 'echo MODE-SWITCH-TAIL\r' : "printf 'MODE-SWITCH-TAIL\\n'\r");
      await until(() => managed.buffer.includes('MODE-SWITCH-TAIL') && !flow(server, sessionId)?.inFlight, 'tail output consumed');
      await server.emitFreshSessionState(runtime);
      await checkpoint(saveEntered.promise, settled, 'accepted save');
      releaseDelete.resolve();
      const deletionResult = await checkpoint(deleteConfirmed.promise, settled, 'delete confirmation');
      assert.equal(deletionResult.kind, 'legacy-acknowledged');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(finished, false, 'Real delete acknowledgement cannot bypass an accepted Host save');
      assert.equal(host.state.nodes.length, 1);
      saveGate.resolve();
      const failure = await settled;
      assert.equal(failure, undefined, failure?.stack);
      await until(() => actualExit !== undefined, 'original process really exits during mode switch');
      assert.equal(server.sessions.has(sessionId), false, 'the original Supervisor session is deleted');
      assert.equal(host.state.nodes.length, 0);
      assert.equal(host.pendingRuntimeSupervisorStateCallbacks.size, 0);
      assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).nodes.length, 0);
      assert.ok(outcomes.some(item => item.outcome === 'consumed'));
      console.log(JSON.stringify({ concurrentRestore, actualPtyExit: actualExit, deletionResult,
        supervisorSessionExists: server.sessions.has(sessionId), hostNodes: host.state.nodes.length,
        pendingCallbacks: host.pendingRuntimeSupervisorStateCallbacks.size, outcomes }));
    } finally {
      releaseDelete.resolve(); saveGate.resolve(); await settled;
      server.deleteSession = serverDelete;
    }
    processes.delete(processHandle);
    client.dispose();
    client = undefined;
    line.dispose();
    tracker.dispose();

  }
  console.log('actual Host mode-switch settlement with real socket/PTY and strict deletion passed');
}
finally {
  for (const processHandle of processes) {
    try {
      processHandle.kill();
    }
    catch {
    }
  }
  client?.dispose();
  for (const socket of sockets)
    socket.destroy();
  if (listener)
    await new Promise(resolve => listener.close(resolve));
  await rm(directory, {
    recursive: true, force: true
  });
}
function flow(server, id) {
  for (const entries of server.hostOutputSubscriptions.values())
    if (entries.has(id))
      return entries.get(id);
}
async function until(test, label) {
  const deadline = Date.now() + 5000;
  while (!test()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function loadHost(directory) {
  const outfile = path.join(directory, 'actual-host.cjs');
  await esbuild.build({
    stdin: {
      contents: `
 export { CanvasPanelManager } from './extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager';
 export { ExecutionTerminalLineContextTracker } from './extensions/vscode/dev-session-canvas/src/panel/executionTerminalLineContextTracker';
 `, resolveDir: process.cwd(), loader: 'ts'
    }, outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'],
    plugins: [{
        name: 'vscode-external-boundary', setup(build) {
          build.onResolve({
            filter: /^vscode$/
          }, () => ({
            path: 'vscode', namespace: 'test-vscode'
          }));
          build.onLoad({
            filter: /.*/, namespace: 'test-vscode'
          }, () => ({
            loader: 'js', contents: `
 module.exports = {
  EventEmitter: class {
   event = () => ({
    dispose() {
    }
   });
  },
  l10n: {
   t: value => value
  }, workspace: {
   isTrusted: true
  }, env: {
   shell: '/bin/sh'
  }
 };
 `
          }));
        }
      }]
  });
  return createRequire(import.meta.url)(outfile);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function checkpoint(reached, cleanup, label) {
  let timer;
  try {
    return await Promise.race([reached, cleanup.then(error => { throw error ?? new Error(`Cleanup completed before ${label}`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000); })]);
  } finally { clearTimeout(timer); }
}
