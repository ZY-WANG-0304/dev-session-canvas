import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir } from 'node:fs/promises';
import * as net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createLifecycleHost } from './linux-lifecycle-host.mjs';

export async function runRuntimeLifecycleScenario(context) {
  const label = 'runtime-natural';
  const hosts = [];
  const sockets = new Map();
  const listeners = new Map();
  const requests = [];
  const disposedSessions = new WeakSet();
  let socketDirectory;
  let server;
  let shutdown;
  let acquisitions = 0;
  let forbidAcquisitions = false;
  let launcherAttempts = 0;

  function recordSocket(socket) {
    if (sockets.has(socket)) return socket;
    const record = { closed: false };
    sockets.set(socket, record);
    socket.once('close', () => { record.closed = true; });
    return socket;
  }

  const observedNet = {
    ...net,
    createServer(onConnection) {
      context.assertActive();
      assert.equal(typeof onConnection, 'function');
      const listener = net.createServer(socket => {
        recordSocket(socket);
        onConnection(socket);
      });
      const record = { closed: false };
      listeners.set(listener, record);
      listener.once('close', () => { record.closed = true; });
      return listener;
    },
    createConnection(...args) {
      context.assertActive();
      return recordSocket(net.createConnection(...args));
    }
  };
  const mocks = { net: observedNet, 'node:net': observedNet };

  function releaseHostConnections(fixture) {
    fixture.host.terminalReadRelay.closeMatching(() => true);
    for (const client of fixture.host.runtimeSupervisorClients.values()) client.dispose();
    for (const kind of ['terminal', 'agent']) {
      const sessions = fixture.host.getExecutionSessions(kind);
      for (const [nodeId, session] of sessions) {
        if (disposedSessions.has(session)) continue;
        fixture.host.clearExecutionTerminalProjectionRefreshTimers(kind, nodeId);
        fixture.host.disposeManagedExecutionSession(session);
        disposedSessions.add(session);
      }
    }
  }

  context.addCleanup(async () => {
    const errors = [];
    for (const fixture of hosts) {
      try { releaseHostConnections(fixture); } catch (error) { errors.push(error); }
    }
    for (const socket of sockets.keys()) {
      try { if (!socket.destroyed) socket.destroy(); } catch (error) { errors.push(error); }
    }
    if (server && !shutdown) {
      try { shutdown = await server.prepareForShutdown('S12 original runtime cleanup.'); }
      catch (error) { errors.push(error); }
    }
    await observeClosed(sockets, listeners);
    assert.ok([...sockets.values()].every(record => record.closed), 'Every original client/server socket must close');
    assert.ok([...listeners.values()].every(record => record.closed), 'The original listener must close');
    if (server?.shutdownBoundary?.keepAlive &&
        server.executionOwner.list().every(execution => execution.snapshot().settled)) {
      clearInterval(server.shutdownBoundary.keepAlive);
      server.shutdownBoundary.keepAlive = undefined;
    }
    if (socketDirectory) await rmdir(socketDirectory);
    if (errors.length > 0) throw new AggregateError(errors, 'Original runtime fixture cleanup failed');
  }, 22000);

  context.assertActive();
  socketDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsc-s12-'));
  context.assertActive();
  const baseStoragePath = path.join(context.directory, 'runtime-storage');
  const paths = {
    storageDir: path.join(baseStoragePath, 'supervisor'),
    registryPath: path.join(baseStoragePath, 'supervisor', 'registry.json'),
    socketPath: path.join(socketDirectory, 'runtime.sock'),
    socketLocation: 'runtime-private', runtimeDir: socketDirectory
  };
  const backend = {
    kind: 'legacy-detached', guarantee: 'best-effort', label: 'S12 original local endpoint', paths,
    async startSupervisor() {
      launcherAttempts++;
      assert.fail('S12 cannot launch or restart a detached Supervisor.');
    }
  };
  const { RuntimeSupervisorServer } = await context.load(
    'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts', { mocks });
  const options = context.ownerOptions('live-runtime');
  server = new RuntimeSupervisorServer(paths, backend.kind, backend.guarantee, {
    ...options,
    createTransport(identity) {
      assert.equal(forbidAcquisitions, false, 'Restore and completed reopen cannot acquire another execution');
      assert.equal(acquisitions, 0, 'This scenario has exactly one execution subject');
      acquisitions++;
      return options.createTransport(identity);
    }
  });
  context.trackOwner(server.executionOwner);
  // The actual shutdown boundary is exercised; daemon process.exit is not part of this in-process sample.
  server.scheduleIdleShutdownIfNeeded = () => {};
  const handleRequest = server.handleRequest.bind(server);
  server.handleRequest = (socket, request) => {
    requests.push({ method: request.method, sessionId: request.params?.sessionId });
    return handleRequest(socket, request);
  };
  context.assertActive();
  await context.before(server.start(), 'Runtime original listener start');
  assert.equal(server.server.listening, true);

  async function host() {
    context.assertActive();
    const fixture = await createLifecycleHost(context, { label, runtimePersistenceEnabled: true, mocks });
    hosts.push(fixture);
    fixture.forbidAcquisitions();
    Object.assign(fixture.host, {
      preferredRuntimeHostBackendKind: backend.kind,
      getRuntimeHostBaseStoragePath: () => baseStoragePath,
      getRuntimeHostBackend(kind, storagePath) {
        assert.equal(kind, backend.kind);
        if (storagePath !== undefined) assert.equal(path.resolve(storagePath), baseStoragePath);
        return backend;
      },
      getRuntimeSupervisorScriptPath: () => '/s12-forbidden-supervisor',
      getRuntimeSupervisorLauncherScriptPath: () => '/s12-forbidden-launcher'
    });
    return fixture;
  }

  const first = await host();
  const nodeId = first.nodeId;
  await context.before(first.host.persistState({ workspaceStateMode: 'full', requireRootLocalDurability: true }),
    'Runtime initial canvas save');
  await context.before(first.host.startTerminalSession(nodeId, 107, 33), 'Runtime actual Host start');
  const managed = first.host.terminalSessions.get(nodeId);
  assert.equal(managed?.owner, 'supervisor');
  const sessionId = managed.runtimeSessionId;
  const session = server.sessions.get(sessionId);
  assert.ok(session?.ownedExecution);
  const execution = session.ownedExecution;
  context.trackExecution(execution);
  forbidAcquisitions = true;
  const identity = execution.identity;
  assert.equal(session.process, undefined);
  assert.equal(acquisitions, 1);
  assert.equal(first.acquisitions, 0);
  await context.until(() => context.output(execution).includes('READY:107x33'), 'Runtime original subject ready');
  await write(first, `nonce:${context.nonce}\n`);
  await context.until(() => context.output(execution).includes(`HASH:${context.expectedHash}`), 'Runtime original nonce');
  first.host.resizeExecutionSession('terminal', nodeId, 119, 41);
  await context.until(() => first.host.terminalSessions.get(nodeId)?.cols === 119 &&
    first.host.terminalSessions.get(nodeId)?.rows === 41, 'Runtime Host resize committed');
  await write(first, 'size\n');
  await context.until(() => context.output(execution).includes('SIZE:119x41'), 'Runtime actual terminal dimensions');
  assert.equal(execution.snapshot().adapter.process, undefined);
  assert.equal(execution.snapshot().adapter.source, undefined);
  const originalSocket = [...first.host.runtimeSupervisorClients.values()][0]?.socket;
  assert.ok(originalSocket && sockets.has(originalSocket));
  const detached = await context.before(first.host.prepareForDeactivation(), 'Runtime original Host deactivation', 22000);
  assert.equal(detached.kind, 'settled');
  assert.equal(detached.remoteDetach.kind, 'settled');
  await context.until(() => sockets.get(originalSocket)?.closed && server.connections.size === 0,
    'Runtime original client and accepted socket detached');
  assert.equal(execution.snapshot().stopRequested, false);
  assert.equal(execution.snapshot().adapter.process, undefined);
  assert.strictEqual(server.sessions.get(sessionId)?.ownedExecution, execution);
  assert.equal(first.host.runtimeSupervisorClients.size, 0);
  const liveDisk = await readCanvas(first);
  assert.equal(liveDisk.workspace.runtimeSessionId, sessionId);
  assert.equal(liveDisk.workspace.runtimeStoragePath, baseStoragePath);
  assert.equal(liveDisk.workspace.liveSession, true);
  assert.deepEqual(liveDisk.root, liveDisk.workspace);
  releaseHostConnections(first);

  const second = await host();
  second.host.state = second.host.loadReconciledState();
  assert.equal(metadata(second).runtimeSessionId, sessionId);
  await context.before(second.host.restoreLiveRuntimeSessions(), 'Runtime new Host actual live restoration');
  assert.equal(second.host.terminalSessions.get(nodeId)?.runtimeSessionId, sessionId);
  assert.strictEqual(server.sessions.get(sessionId)?.ownedExecution, execution);
  assert.deepEqual(execution.identity, identity);
  assert.equal(execution.snapshot().stopRequested, false);
  assert.equal(acquisitions, 1);
  assert.equal(second.acquisitions, 0);
  const secondNonce = createHash('sha256').update(`${context.nonce}-reattached`).digest('hex').slice(0, 32);
  assert.notEqual(secondNonce, context.nonce);
  const secondHash = createHash('sha256').update(secondNonce).digest('hex');
  await write(second, `nonce:${secondNonce}\n`);
  await context.until(() => context.output(execution).includes(`HASH:${secondHash}`), 'Runtime reattached subject computes new input');
  await write(second, 'finish\n');
  await context.until(() => execution.snapshot().retired && !server.sessions.has(sessionId) &&
    !second.host.terminalSessions.has(nodeId), 'Runtime natural Host completion and automatic deletion', 16000);
  const final = execution.snapshot();
  assert.equal(final.adapter.process.kind, 'exited');
  assert.equal(final.adapter.process.exitCode, 7);
  assert.equal(final.adapter.source.kind, 'eof');
  assert.equal(final.adapter.acceptedThrough, final.adapter.consumedThrough);
  assert.equal(final.terminal.kind, 'applied');
  assert.equal(final.readerOutcome, 'settled');
  for (const resourceId of ['provider-control', 'pty-master', 'pty-child', 'pty-source']) {
    assert.equal(final.adapter.resources[resourceId]?.first?.kind, 'released');
    assert.equal(final.adapter.resources[resourceId]?.current?.kind, 'released');
  }
  const written = await context.verifyWritten(label, execution);
  assert.equal(requests.filter(request => request.method === 'createSession').length, 1);
  assert.equal(requests.filter(request => request.method === 'deleteSession' && request.sessionId === sessionId).length, 1);
  assert.equal(requests.some(request => request.method === 'stopSession'), false);
  const completedDisk = await readCanvas(second);
  assertEmptyMetadata(completedDisk.workspace);
  assertEmptyMetadata(completedDisk.root);
  assertEmptyMetadata(metadata(second));

  const third = await host();
  third.host.state = third.host.loadReconciledState();
  assertEmptyMetadata(metadata(third));
  const socketsBeforeReopen = sockets.size;
  await context.before(third.host.restoreLiveRuntimeSessions(), 'Runtime completed node restore');
  const beforeAttach = third.posted.length;
  third.host.attachExecutionSession('terminal', nodeId);
  await context.until(() => third.posted.slice(beforeAttach).some(message => message.type === 'host/executionSnapshot'),
    'Runtime completed node attachment');
  const attachment = third.posted.slice(beforeAttach).find(message => message.type === 'host/executionSnapshot').payload;
  assert.equal(attachment.liveSession, false);
  assert.equal(attachment.executionSessionId, undefined);
  assert.equal(attachment.output, '');
  assert.equal(attachment.serializedTerminalState, undefined);
  assert.equal(attachment.terminalStream, undefined);
  assert.equal(attachment.terminalRead, undefined);
  assert.equal(sockets.size, socketsBeforeReopen);
  assert.equal(acquisitions, 1);
  assert.equal(third.acquisitions, 0);
  assert.equal(launcherAttempts, 0);
  for (const fixture of hosts) {
    assert.equal(fixture.diagnostics.some(event => ['runtime/sessionStateHandlerFailed',
      'runtime/completedSessionCleanupFailed'].includes(event.name)), false);
  }

  shutdown = await context.before(server.prepareForShutdown('S12 completed runtime normal shutdown.'),
    'Runtime actual normal shutdown and strict registry flush', 22000);
  assert.equal(shutdown.kind, 'settled');
  for (const domain of ['execution', 'readers', 'registry', 'server', 'sockets']) assert.equal(shutdown.domains[domain], 'settled');
  await context.until(() => [...sockets.values()].every(record => record.closed) &&
    [...listeners.values()].every(record => record.closed), 'Runtime original listener and all sockets closed');
  const registry = JSON.parse(await readFile(paths.registryPath, 'utf8'));
  assert.deepEqual(registry, { version: 1, sessions: [] });
  assert.equal(server.persistTimer, undefined);
  assert.equal(server.server.listening, false);
  assert.equal(server.connections.size, 0);
  return {
    actualClientSocket: true, actualWebview: false, daemonIdleExit: 'not-exercised',
    identity, detached, originalExecutionPreserved: true, secondNonceComputed: true,
    process: final.adapter.process, source: final.adapter.source, terminal: final.terminal,
    acceptedThrough: final.adapter.acceptedThrough, consumedThrough: final.adapter.consumedThrough,
    resources: final.adapter.resources, readerOutcome: final.readerOutcome, retired: final.retired, written,
    liveDisk, completedDisk, reopened: attachment, acquisitions, launcherAttempts, requests, shutdown, registry,
    sockets: { total: sockets.size, closed: [...sockets.values()].filter(record => record.closed).length },
    listeners: { total: listeners.size, closed: [...listeners.values()].filter(record => record.closed).length },
    diagnostics: hosts.map(fixture => fixture.diagnostics)
  };

  async function write(fixture, data) {
    assert.equal(await context.before(fixture.host.writeExecutionInput('terminal', fixture.nodeId, data),
      'Runtime actual Host input'), true);
  }

  function metadata(fixture) {
    return fixture.host.state.nodes.find(node => node.id === fixture.nodeId).metadata.terminal;
  }

  async function readCanvas(fixture) {
    const workspaceFile = fixture.host.getPersistedCanvasSnapshotPath();
    const rootFile = fixture.host.getRootLocalCanvasSnapshotPath(context.directory);
    const select = state => state.state.nodes.find(node => node.id === fixture.nodeId).metadata.terminal;
    return { workspaceFile, rootFile,
      workspace: select(JSON.parse(await readFile(workspaceFile, 'utf8'))),
      root: select(JSON.parse(await readFile(rootFile, 'utf8'))) };
  }
}

function assertEmptyMetadata(metadata) {
  assert.equal(metadata.liveSession, false);
  assert.equal(metadata.terminalHistoryDiscarded, true);
  for (const key of ['runtimeSessionId', 'runtimeStoragePath', 'pendingLaunch', 'recentOutput',
    'serializedTerminalState', 'terminalStream', 'outputSequence']) assert.equal(metadata[key], undefined, key);
}

async function observeClosed(sockets, listeners) {
  const deadline = performance.now() + 1000;
  while (([...sockets.values(), ...listeners.values()].some(record => !record.closed)) && performance.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
