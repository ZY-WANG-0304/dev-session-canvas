import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-projection-coordinator-'));

try {
  const bundlePath = path.join(tempDir, 'executionProjectionCoordinator.cjs');
  await esbuild.build({
    entryPoints: [
      path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionProjectionCoordinator.ts')
    ],
    bundle: true,
    format: 'cjs',
    outfile: bundlePath,
    platform: 'node',
    target: 'node18'
  });
  const require = createRequire(import.meta.url);
  const {
    ExecutionProjectionCoordinator,
    classifyExecutionProjectionLiveEvent
  } = require(bundlePath);

  testLiveEventClassification(classifyExecutionProjectionLiveEvent);
  await testTransportCacheAndAckGate(ExecutionProjectionCoordinator);
  await testNonzeroCheckpointAckBase(ExecutionProjectionCoordinator);
  await testTerminalChunkWaitsForAck(ExecutionProjectionCoordinator);
  await testIncompleteDoneFailsClosed(ExecutionProjectionCoordinator);
  await testTerminalDoneAckMustReachTarget(ExecutionProjectionCoordinator);
  await testInvalidOpenReleasesProjection(ExecutionProjectionCoordinator);
  await testInvalidReadReleasesProjection(ExecutionProjectionCoordinator);
  await testRegressingFollowTargetFailsClosed(ExecutionProjectionCoordinator);
  await testStaleLifecycleCancelsQueuedAndOpenedJobs(ExecutionProjectionCoordinator);
  await testSurfaceLifecycleCancellationIsExact(ExecutionProjectionCoordinator);
  await testAdmissionPriorityAndOpenBounds(ExecutionProjectionCoordinator);
  await testAdmissionFairnessUnderContinuousSelectedPressure(ExecutionProjectionCoordinator);
  await testSourceKeyGenerationReplacement(ExecutionProjectionCoordinator);
  await testTransportAcquisitionReplacementDoesNotOpenStaleJob(ExecutionProjectionCoordinator);
  await testExactKeyReplacementSurvivesStaleAsyncWork(ExecutionProjectionCoordinator);
  await testAdmissionContinuesAfterTerminalAck(ExecutionProjectionCoordinator);
  await testAdmissionContinuesAfterOpenFailure(ExecutionProjectionCoordinator);
  await testBackgroundEventuallyProgresses(ExecutionProjectionCoordinator);
  await testReadConcurrencyIsBounded(ExecutionProjectionCoordinator);

  console.log('execution projection coordinator tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function testLiveEventClassification(classifyLiveEvent) {
  for (let revision = 1; revision <= 513; revision += 1) {
    assert.deepEqual(
      classifyLiveEvent({
        ready: false,
        latestTargetRevision: 0,
        eventRevision: revision
      }),
      { action: 'ignore', liveTailFloor: 0 },
      'a restoring surface must ignore shared-socket observations and let its follow stream hydrate them'
    );
  }
  assert.deepEqual(
    classifyLiveEvent({
      ready: true,
      latestTargetRevision: 512,
      lastLiveRevision: 512,
      eventRevision: 512
    }),
    { action: 'ignore', liveTailFloor: 512 },
    'a ready surface must ignore duplicate revisions at or below its final target'
  );
  assert.deepEqual(
    classifyLiveEvent({
      ready: true,
      latestTargetRevision: 512,
      lastLiveRevision: 512,
      eventRevision: 513
    }),
    { action: 'deliver', liveTailFloor: 512 },
    'the first event after the ready barrier must be delivered'
  );
  assert.deepEqual(
    classifyLiveEvent({
      ready: true,
      latestTargetRevision: 512,
      lastLiveRevision: 513,
      eventRevision: 515
    }),
    { action: 'gap', liveTailFloor: 513, expectedRevision: 514 },
    'a ready surface must fail closed on a live-tail gap'
  );
}

async function testTransportCacheAndAckGate(Coordinator) {
  const events = [];
  const transportA = createTransport('a');
  const transportB = createTransport('b');
  transportA.openResult = {
    projectionId: 'projection-1',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  transportA.readResults.push(
    createChunkResult('session-1', 'authority-1', 'projection-1', 0, {
      kind: 'checkpoint',
      dataOffset: 0,
      data: 'history',
      complete: true
    }),
    createDoneResult('session-1', 'authority-1', 'projection-1', 0)
  );
  let transportLookups = 0;
  let coordinator;
  coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => {
      transportLookups += 1;
      return transportLookups === 1 ? transportA : transportB;
    },
    onState: (job, state) => events.push(['state', job.nodeId, state]),
    onChunk: (job, result, sequence) => events.push(['chunk', job.nodeId, sequence, result.projectionId]),
    onReady: (job, revision, live) => events.push(['ready', job.nodeId, revision, live]),
    onFailed: (job, error) => events.push(['failed', job.nodeId, error.message])
  });
  const job = coordinator.enqueue(createRequest('node-1', 'selected'));
  await flush();
  assert.equal(job.phase, 'restoring');
  assert.equal(transportA.openCalls.length, 1);

  assert.equal(
    coordinator.requestCredit('panel', 'node-1', 'terminal', 'controller-node-1', 'projection-1', 1024),
    true
  );
  await flush();
  assert.equal(transportA.readCalls.length, 1, 'one credit grant must admit one read');
  assert.equal(transportB.readCalls.length, 0, 'the projection must keep its opening socket');
  await flush();
  assert.equal(transportA.readCalls.length, 1, 'a second pull must wait for the Webview ACK');

  assert.equal(
    coordinator.acknowledgeChunk(
      'panel',
      lifecycle(),
      'node-1',
      'terminal',
      'controller-node-1',
      'projection-1',
      1,
      0,
      1024
    ),
    true
  );
  await flush();
  assert.equal(transportA.readCalls.length, 2, 'the ACK must admit the next pull');
  assert.equal(transportB.readCalls.length, 0);
  assert.deepEqual(events.at(-1), ['ready', 'node-1', 0, true]);

  coordinator.cancel(job.sourceKey);
  await flush();
  assert.equal(transportA.cancelCalls.length, 1, 'sourceKey cancel must use the cached opening transport');
  assert.equal(transportB.cancelCalls.length, 0);
  assert.equal(coordinator.getJob('panel', lifecycle(), 'node-1', 'controller-node-1', 'terminal'), undefined);
}

async function testInvalidOpenReleasesProjection(Coordinator) {
  const transport = createTransport('mismatch');
  transport.openResult = {
    projectionId: 'projection-leaked-unless-cancelled',
    supervisorInstanceId: 'different-supervisor',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 1,
    checkpoint: { revision: 0 }
  };
  const failures = [];
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: (job, error) => failures.push([job.key, error.message])
  });
  const job = coordinator.enqueue(createRequest('node-mismatch', 'visible'));
  await flush();
  assert.equal(transport.cancelCalls.length, 1, 'identity rejection must release the opened server pin');
  assert.equal(transport.cancelCalls[0].projectionId, 'projection-leaked-unless-cancelled');
  assert.equal(failures.length, 1);
  assert.equal(coordinator.getJob('panel', lifecycle(), 'node-mismatch', 'controller-node-mismatch', 'terminal'), undefined);
  assert.equal(job.phase, 'failed');
}

async function testTerminalChunkWaitsForAck(Coordinator) {
  const transport = createTransport('done-chunk');
  transport.openResult = {
    projectionId: 'projection-done-chunk',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  const terminalChunk = {
    kind: 'checkpoint',
    dataOffset: 0,
    data: '',
    complete: true
  };
  transport.readResults.push({
    ...createChunkResult('session-1', 'authority-1', 'projection-done-chunk', 0, terminalChunk),
    done: true
  });
  const ready = [];
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: (job, revision, live) => ready.push([job.nodeId, revision, live]),
    onFailed: () => undefined
  });
  coordinator.enqueue(createRequest('node-done-chunk', 'selected'));
  await flush();
  assert.equal(
    coordinator.requestCredit(
      'panel',
      'node-done-chunk',
      'terminal',
      'controller-node-done-chunk',
      'projection-done-chunk',
      1024
    ),
    true
  );
  await flush();
  assert.deepEqual(ready, [], 'a data-bearing done response is not ready before xterm applies it');
  assert.equal(
    coordinator.acknowledgeChunk(
      'panel',
      lifecycle(),
      'node-done-chunk',
      'terminal',
      'controller-node-done-chunk',
      'projection-done-chunk',
      1,
      0,
      1024
    ),
    true
  );
  await flush();
  assert.deepEqual(ready, [['node-done-chunk', 0, false]]);
  assert.equal(transport.readCalls.length, 1, 'ACKing a terminal chunk must not schedule another read');
}

async function testIncompleteDoneFailsClosed(Coordinator) {
  const transport = createTransport('incomplete-done');
  transport.openResult = {
    projectionId: 'projection-incomplete-done',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 2,
    checkpoint: { revision: 0 }
  };
  transport.readResults.push(
    createDoneResult('session-1', 'authority-1', 'projection-incomplete-done', 2)
  );
  const ready = [];
  const failures = [];
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: (...args) => ready.push(args),
    onFailed: (job, error) => failures.push([job.nodeId, error.message])
  });
  const job = coordinator.enqueue(createRequest('node-incomplete-done', 'selected'));
  await flush();
  assert.equal(
    coordinator.requestCredit(
      'panel',
      'node-incomplete-done',
      'terminal',
      'controller-node-incomplete-done',
      'projection-incomplete-done',
      1024
    ),
    true
  );
  await flush();
  assert.deepEqual(ready, [], 'an empty done marker cannot manufacture an unapplied revision barrier');
  assert.equal(failures.length, 1);
  assert.equal(job.phase, 'failed');
  assert.equal(transport.cancelCalls.length, 1, 'fail-closed completion must release the server pin');
}

async function testTerminalDoneAckMustReachTarget(Coordinator) {
  const transport = createTransport('terminal-done-ack-floor');
  transport.openResult = {
    projectionId: 'projection-terminal-done-ack-floor',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 1,
    checkpoint: { revision: 0 }
  };
  transport.readResults.push({
    ...createChunkResult('session-1', 'authority-1', 'projection-terminal-done-ack-floor', 1, {
      kind: 'output',
      revision: 1,
      createdAtMs: 1,
      dataOffset: 0,
      data: 'final',
      complete: true
    }),
    done: true
  });
  const ready = [];
  const failures = [];
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: (...args) => ready.push(args),
    onFailed: (job, error) => failures.push([job.nodeId, error.message])
  });
  const job = coordinator.enqueue(createRequest('node-terminal-done-ack-floor', 'selected'));
  await flush();
  assert.equal(
    coordinator.requestCredit(
      'panel',
      'node-terminal-done-ack-floor',
      'terminal',
      'controller-node-terminal-done-ack-floor',
      'projection-terminal-done-ack-floor',
      1024
    ),
    true
  );
  await flush();
  assert.equal(
    coordinator.acknowledgeChunk(
      'panel',
      lifecycle(),
      'node-terminal-done-ack-floor',
      'terminal',
      'controller-node-terminal-done-ack-floor',
      'projection-terminal-done-ack-floor',
      1,
      0,
      1024
    ),
    false,
    'a terminal chunk ACK below its target must fail closed instead of publishing ready'
  );
  await flush();
  assert.deepEqual(ready, []);
  assert.equal(failures.length, 1);
  assert.equal(job.phase, 'failed');
  assert.equal(transport.cancelCalls.length, 1);
}

async function testNonzeroCheckpointAckBase(Coordinator) {
  const transport = createTransport('nonzero-checkpoint');
  transport.openResult = {
    projectionId: 'projection-nonzero-checkpoint',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 8,
    checkpoint: { revision: 7 }
  };
  transport.readResults.push(
    createChunkResult('session-1', 'authority-1', 'projection-nonzero-checkpoint', 8, {
      kind: 'checkpoint',
      dataOffset: 0,
      data: 'checkpoint-at-seven',
      complete: true
    })
  );
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  const job = coordinator.enqueue(createRequest('node-nonzero-checkpoint', 'selected'));
  await flush();
  assert.equal(job.appliedRevision, 7, 'the checkpoint revision is the initial ACK floor');
  assert.equal(
    coordinator.requestCredit(
      'panel',
      'node-nonzero-checkpoint',
      'terminal',
      'controller-node-nonzero-checkpoint',
      'projection-nonzero-checkpoint',
      1024
    ),
    true
  );
  await flush();
  assert.equal(transport.readCalls.length, 1);
  assert.equal(
    coordinator.acknowledgeChunk(
      'panel',
      lifecycle(),
      'node-nonzero-checkpoint',
      'terminal',
      'controller-node-nonzero-checkpoint',
      'projection-nonzero-checkpoint',
      1,
      0,
      1024
    ),
    false,
    'an ACK below the pinned checkpoint must be rejected'
  );
  assert.equal(
    coordinator.acknowledgeChunk(
      'panel',
      lifecycle(),
      'node-nonzero-checkpoint',
      'terminal',
      'controller-node-nonzero-checkpoint',
      'projection-nonzero-checkpoint',
      1,
      7,
      1024
    ),
    true,
    'the first checkpoint chunk must be ACKable at the checkpoint revision'
  );
  coordinator.cancel(job.key);
}

async function testStaleLifecycleCancelsQueuedAndOpenedJobs(Coordinator) {
  let current = false;
  const queuedTransport = createTransport('queued-stale');
  const queuedCoordinator = new Coordinator({
    isCurrent: () => current,
    getTransport: async () => queuedTransport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  queuedCoordinator.enqueue(createRequest('node-queued-stale', 'background'));
  await flush();
  assert.equal(queuedTransport.openCalls.length, 0);
  assert.equal(
    queuedCoordinator.getJob('panel', lifecycle(), 'node-queued-stale', 'controller-node-queued-stale', 'terminal'),
    undefined,
    'a stale queued job must not remain in the scheduler map'
  );

  let resolveOpen;
  current = true;
  const openedTransport = createTransport('opened-stale');
  openedTransport.open = () => {
    openedTransport.openCalls.push({});
    return new Promise((resolve) => {
      resolveOpen = resolve;
    });
  };
  const openedCoordinator = new Coordinator({
    isCurrent: () => current,
    getTransport: async () => openedTransport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  openedCoordinator.enqueue(createRequest('node-opened-stale', 'selected'));
  await flush();
  assert.equal(openedTransport.openCalls.length, 1);
  current = false;
  resolveOpen({
    projectionId: 'projection-opened-stale',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 1,
    checkpoint: { revision: 0 }
  });
  await flush();
  assert.equal(openedTransport.cancelCalls.length, 1);
  assert.equal(
    openedCoordinator.getJob('panel', lifecycle(), 'node-opened-stale', 'controller-node-opened-stale', 'terminal'),
    undefined,
    'a stale opening job must be removed after its pin is cancelled'
  );
}

async function testInvalidReadReleasesProjection(Coordinator) {
  const transport = createTransport('invalid-read');
  transport.readResults.push({
    projectionId: 'projection-1',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'different-session',
    authorityId: 'authority-1',
    targetRevision: 1,
    payloadBytes: 0,
    done: true,
    live: true
  });
  const failures = [];
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: (job, error) => failures.push([job.nodeId, error.message])
  });
  const job = coordinator.enqueue(createRequest('node-invalid-read', 'selected'));
  await flush();
  assert.equal(
    coordinator.requestCredit(
      'panel',
      'node-invalid-read',
      'terminal',
      'controller-node-invalid-read',
      'projection-1',
      1024
    ),
    true
  );
  await flush();
  assert.equal(failures.length, 1);
  assert.equal(transport.cancelCalls.length, 1, 'read identity failure must release the projection pin');
  assert.equal(coordinator.getJob('panel', lifecycle(), 'node-invalid-read', 'controller-node-invalid-read', 'terminal'), undefined);
  assert.equal(job.phase, 'failed');
}

async function testRegressingFollowTargetFailsClosed(Coordinator) {
  const transport = createTransport('regressing-follow-target');
  transport.openResult = {
    projectionId: 'projection-regressing-follow-target',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 1,
    checkpoint: { revision: 0 }
  };
  transport.readResults.push(
    createChunkResult('session-1', 'authority-1', 'projection-regressing-follow-target', 3, {
      kind: 'output',
      revision: 1,
      createdAtMs: 1,
      dataOffset: 0,
      data: 'first',
      complete: true
    }),
    createChunkResult('session-1', 'authority-1', 'projection-regressing-follow-target', 2, {
      kind: 'output',
      revision: 2,
      createdAtMs: 2,
      dataOffset: 0,
      data: 'second',
      complete: true
    })
  );
  const failures = [];
  const targetAdvances = [];
  const callbackOrder = [];
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onTargetAdvanced: (_job, targetRevision) => {
      targetAdvances.push(targetRevision);
      callbackOrder.push(`target:${targetRevision}`);
    },
    onChunk: () => callbackOrder.push('chunk'),
    onReady: () => undefined,
    onFailed: (_job, error) => failures.push(error.message)
  });
  const job = coordinator.enqueue(createRequest('node-regressing-follow-target', 'selected'));
  await flush();
  assert.equal(
    coordinator.requestCredit(
      'panel',
      job.nodeId,
      job.kind,
      job.controllerGeneration,
      job.projectionId,
      1024
    ),
    true
  );
  await flush();
  assert.equal(job.latestTargetRevision, 3, 'the coordinator must retain the highest accepted follow target');
  assert.deepEqual(
    targetAdvances,
    [3],
    'each accepted follow-target growth must be published to the surface owner'
  );
  assert.deepEqual(
    callbackOrder,
    ['target:3', 'chunk'],
    'the owner must advance its duplicate-filter watermark before receiving the corresponding chunk'
  );
  assert.equal(
    coordinator.acknowledgeChunk(
      job.surface,
      job.lifecycle,
      job.nodeId,
      job.kind,
      job.controllerGeneration,
      job.projectionId,
      1,
      1,
      1024
    ),
    true
  );
  await flush();
  assert.equal(job.phase, 'failed');
  assert.equal(failures.length, 1, 'a target regression must fail closed');
  assert.equal(transport.cancelCalls.length, 1, 'a target regression must release the projection pin');
}

async function testSurfaceLifecycleCancellationIsExact(Coordinator) {
  const transport = createTransport('surface-lifecycle');
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  const currentLifecycle = lifecycle();
  const oldFrameLifecycle = { ...currentLifecycle, frameId: 'old-frame' };
  const missingFrameLifecycle = { ...currentLifecycle, frameId: undefined };
  coordinator.enqueue(createRequest('surface-current', 'visible', currentLifecycle));
  coordinator.enqueue(createRequest('surface-old-frame', 'visible', oldFrameLifecycle));
  coordinator.enqueue(createRequest('surface-missing-frame', 'visible', missingFrameLifecycle));
  await flush();
  coordinator.cancelForSurface('panel', currentLifecycle);
  await flush();
  assert.ok(
    coordinator.getJob('panel', currentLifecycle, 'surface-current', 'controller-surface-current', 'terminal'),
    'the exact current lifecycle must remain scheduled'
  );
  assert.equal(
    coordinator.getJob('panel', oldFrameLifecycle, 'surface-old-frame', 'controller-surface-old-frame', 'terminal'),
    undefined
  );
  assert.equal(
    coordinator.getJob(
      'panel',
      missingFrameLifecycle,
      'surface-missing-frame',
      'controller-surface-missing-frame',
      'terminal'
    ),
    undefined,
    'an omitted frame id must not wildcard-match the current frame'
  );
  assert.equal(transport.cancelCalls.length, 2);
  coordinator.cancelAll();
}

async function testReadConcurrencyIsBounded(Coordinator) {
  const transport = createTransport('concurrency');
  const pendingReads = [];
  transport.read = (params) => {
    transport.readCalls.push(params);
    return new Promise((resolve) => pendingReads.push(resolve));
  };
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => transport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  const jobs = [
    coordinator.enqueue(createRequest('node-read-1', 'selected')),
    coordinator.enqueue(createRequest('node-read-2', 'visible')),
    coordinator.enqueue(createRequest('node-read-3', 'background'))
  ];
  await flush();
  assert.equal(transport.openCalls.length, 3);
  for (const [index, nodeId] of ['node-read-1', 'node-read-2', 'node-read-3'].entries()) {
    assert.equal(
      coordinator.requestCredit('panel', nodeId, 'terminal', `controller-${nodeId}`, `projection-${index + 1}`, 1024),
      true
    );
  }
  await flush();
  assert.equal(transport.readCalls.length, 2, 'the scheduler must cap concurrent reads at two');
  assert.equal(pendingReads.length, 2);
  for (const job of jobs) {
    coordinator.cancel(job.key);
  }
}

async function testAdmissionPriorityAndOpenBounds(Coordinator) {
  const overflowTransport = createTransport('open-overflow');
  const overflowOrder = [];
  const overflowCoordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async (job) => {
      overflowOrder.push(job.nodeId);
      return overflowTransport;
    },
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  for (const [nodeId, priority] of [
    ['background-1', 'background'],
    ['visible-1', 'visible'],
    ['selected-1', 'selected'],
    ['background-2', 'background'],
    ['visible-2', 'visible'],
    ['selected-2', 'selected']
  ]) {
    overflowCoordinator.enqueue(createRequest(nodeId, priority));
  }
  await flush();
  assert.deepEqual(
    overflowOrder,
    ['selected-1', 'selected-2', 'visible-1', 'visible-2', 'background-1'],
    'selected and visible jobs must win admission while one selected overflow slot is available'
  );
  assert.equal(overflowTransport.openCalls.length, 5, 'selected admission may exceed the base open cap by exactly one');
  assert.equal(
    overflowCoordinator.getJob('panel', lifecycle(), 'background-2', 'controller-background-2', 'terminal').phase,
    'queued'
  );
  overflowCoordinator.cancelAll();

  const baseTransport = createTransport('open-base');
  const baseCoordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => baseTransport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  for (let index = 1; index <= 5; index += 1) {
    baseCoordinator.enqueue(createRequest(`base-background-${index}`, 'background'));
  }
  await flush();
  assert.equal(baseTransport.openCalls.length, 4, 'without a queued selected job the base open cap must remain four');
  assert.equal(
    baseCoordinator.getJob(
      'panel',
      lifecycle(),
      'base-background-5',
      'controller-base-background-5',
      'terminal'
    ).phase,
    'queued'
  );
  baseCoordinator.cancelAll();
}

async function testAdmissionFairnessUnderContinuousSelectedPressure(Coordinator) {
  const openOrder = [];
  const transports = new Map();
  const selectedJobs = [];
  for (let index = 1; index <= 12; index += 1) {
    const nodeId = `pressure-selected-${index}`;
    const transport = createTransport(nodeId);
    transport.open = async (params) => {
      transport.openCalls.push(params);
      openOrder.push(nodeId);
      return {
        projectionId: `projection-${nodeId}`,
        supervisorInstanceId: 'supervisor-1',
        sessionId: 'session-1',
        authorityId: 'authority-1',
        targetRevision: 0,
        checkpoint: { revision: 0 }
      };
    };
    transports.set(nodeId, transport);
    selectedJobs.push({ nodeId, priority: 'selected' });
  }
  const backgroundNodeId = 'pressure-background';
  const backgroundTransport = createTransport(backgroundNodeId);
  backgroundTransport.open = async (params) => {
    backgroundTransport.openCalls.push(params);
    openOrder.push(backgroundNodeId);
    return {
      projectionId: `projection-${backgroundNodeId}`,
      supervisorInstanceId: 'supervisor-1',
      sessionId: 'session-1',
      authorityId: 'authority-1',
      targetRevision: 0,
      checkpoint: { revision: 0 }
    };
  };
  transports.set(backgroundNodeId, backgroundTransport);

  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async (job) => transports.get(job.nodeId),
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  const jobs = selectedJobs.map(({ nodeId, priority }) =>
    coordinator.enqueue(createRequest(nodeId, priority))
  );
  const backgroundJob = coordinator.enqueue(createRequest(backgroundNodeId, 'background'));

  await flush();
  assert.equal(
    openOrder.length,
    5,
    'the first admission wave should fill the four base slots plus one selected overflow slot'
  );
  assert.ok(
    openOrder.every((nodeId) => nodeId.startsWith('pressure-selected-')),
    `selected jobs should fill the first wave, got ${openOrder.join(', ')}`
  );

  // Keep replacing each freed slot while selected work remains queued. A
  // strict selected-first scheduler would never reach the background job.
  for (const job of jobs.slice(0, 5)) {
    coordinator.cancel(job.key);
    await flush();
    if (openOrder.includes(backgroundNodeId)) {
      break;
    }
  }

  assert.ok(
    openOrder.includes(backgroundNodeId),
    `background admission starved while selected jobs stayed queued: ${openOrder.join(', ')}`
  );
  const backgroundIndex = openOrder.indexOf(backgroundNodeId);
  assert.ok(
    backgroundIndex < 10,
    `background should enter within one weighted admission cycle, got index ${backgroundIndex}`
  );
  assert.equal(backgroundJob.phase, 'restoring');
  coordinator.cancelAll();
  await flush();
}

async function testSourceKeyGenerationReplacement(Coordinator) {
  const oldTransport = createTransport('old-generation');
  oldTransport.openResult = {
    projectionId: 'projection-old-generation',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  const newTransport = createTransport('new-generation');
  newTransport.openResult = {
    projectionId: 'projection-new-generation',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  const sourceKey = 'panel:terminal:generation-replacement';
  const oldRequest = createRequest('generation-replacement', 'selected');
  oldRequest.controllerGeneration = 'controller-old';
  oldRequest.sourceKey = sourceKey;
  const newRequest = createRequest('generation-replacement', 'selected');
  newRequest.controllerGeneration = 'controller-new';
  newRequest.sourceKey = sourceKey;
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async (job) => job.controllerGeneration === 'controller-old' ? oldTransport : newTransport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });

  const oldJob = coordinator.enqueue(oldRequest);
  await flush();
  assert.equal(oldJob.phase, 'restoring');
  assert.equal(oldTransport.openCalls.length, 1);

  const newJob = coordinator.enqueue(newRequest);
  await flush();
  assert.equal(oldTransport.cancelCalls.length, 1, 'replacing a source must cancel the old projection pin');
  assert.equal(oldTransport.cancelCalls[0].projectionId, 'projection-old-generation');
  assert.equal(
    coordinator.getJob('panel', lifecycle(), 'generation-replacement', 'controller-old', 'terminal'),
    undefined,
    'the old controller generation must not remain in the scheduler map'
  );
  assert.equal(newJob.phase, 'restoring');
  assert.equal(newTransport.openCalls.length, 1);

  coordinator.cancel(sourceKey);
  await flush();
  assert.equal(newTransport.cancelCalls.length, 1, 'source-key cancellation must cancel the replacement generation');
  assert.equal(
    coordinator.getJob('panel', lifecycle(), 'generation-replacement', 'controller-new', 'terminal'),
    undefined,
    'source-key cancellation must leave no replacement generation behind'
  );
}

async function testExactKeyReplacementSurvivesStaleAsyncWork(Coordinator) {
  let resolveOldOpen;
  const oldOpenTransport = createTransport('stale-open');
  oldOpenTransport.open = (params) => {
    oldOpenTransport.openCalls.push(params);
    return new Promise((resolve) => {
      resolveOldOpen = resolve;
    });
  };
  const replacementOpenTransport = createTransport('replacement-after-open');
  replacementOpenTransport.openResult = {
    projectionId: 'projection-replacement-after-open',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  let openTransportLookup = 0;
  const openCoordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => ++openTransportLookup === 1 ? oldOpenTransport : replacementOpenTransport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  const exactRequest = createRequest('exact-key-replacement', 'selected');
  const staleOpeningJob = openCoordinator.enqueue(exactRequest);
  await flush();
  assert.equal(staleOpeningJob.phase, 'opening');
  const replacementAfterOpen = openCoordinator.enqueue(exactRequest);
  await flush();
  assert.equal(replacementAfterOpen.phase, 'restoring');

  resolveOldOpen({
    projectionId: 'projection-stale-open',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  });
  await flush();
  assert.equal(oldOpenTransport.cancelCalls.length, 1, 'a stale open completion must release its own pin');
  assert.equal(
    openCoordinator.getJob(
      'panel',
      lifecycle(),
      'exact-key-replacement',
      'controller-exact-key-replacement',
      'terminal'
    ),
    replacementAfterOpen,
    'a stale open completion must not delete the exact-key replacement'
  );
  openCoordinator.cancelAll();
  await flush();

  let resolveOldRead;
  const oldReadTransport = createTransport('stale-read');
  oldReadTransport.openResult = {
    projectionId: 'projection-stale-read',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  oldReadTransport.read = (params) => {
    oldReadTransport.readCalls.push(params);
    return new Promise((resolve) => {
      resolveOldRead = resolve;
    });
  };
  const replacementReadTransport = createTransport('replacement-after-read');
  replacementReadTransport.openResult = {
    projectionId: 'projection-replacement-after-read',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  let readTransportLookup = 0;
  const readCoordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => ++readTransportLookup === 1 ? oldReadTransport : replacementReadTransport,
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  const staleReadingJob = readCoordinator.enqueue(exactRequest);
  await flush();
  assert.equal(
    readCoordinator.requestCredit(
      'panel',
      'exact-key-replacement',
      'terminal',
      'controller-exact-key-replacement',
      'projection-stale-read',
      1024
    ),
    true
  );
  await flush();
  assert.equal(staleReadingJob.readInFlight, true);
  const replacementAfterRead = readCoordinator.enqueue(exactRequest);
  await flush();
  assert.equal(replacementAfterRead.phase, 'restoring');

  resolveOldRead(createDoneResult('session-1', 'authority-1', 'projection-stale-read', 0));
  await flush();
  assert.equal(
    readCoordinator.getJob(
      'panel',
      lifecycle(),
      'exact-key-replacement',
      'controller-exact-key-replacement',
      'terminal'
    ),
    replacementAfterRead,
    'a stale read completion must not delete the exact-key replacement'
  );
  assert.ok(oldReadTransport.cancelCalls.length >= 1, 'the stale read transport must release its own pin');
  readCoordinator.cancelAll();
  await flush();
}

async function testTransportAcquisitionReplacementDoesNotOpenStaleJob(Coordinator) {
  let resolveStaleTransport;
  const staleTransport = createTransport('stale-transport-acquisition');
  const replacementTransport = createTransport('replacement-transport-acquisition');
  replacementTransport.openResult = {
    projectionId: 'projection-replacement-transport-acquisition',
    supervisorInstanceId: 'supervisor-1',
    sessionId: 'session-1',
    authorityId: 'authority-1',
    targetRevision: 0,
    checkpoint: { revision: 0 }
  };
  let lookupCount = 0;
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async () => {
      lookupCount += 1;
      if (lookupCount === 1) {
        return new Promise((resolve) => {
          resolveStaleTransport = resolve;
        });
      }
      return replacementTransport;
    },
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  const request = createRequest('transport-acquisition-replacement', 'selected');
  const staleJob = coordinator.enqueue(request);
  await flush();
  assert.equal(staleJob.phase, 'opening');

  const replacementJob = coordinator.enqueue(request);
  await flush();
  assert.equal(replacementJob.phase, 'restoring');

  resolveStaleTransport(staleTransport);
  await flush();
  assert.equal(
    staleTransport.openCalls.length,
    0,
    'a transport resolved after replacement must not open a stale reader or server pin'
  );
  assert.equal(
    staleTransport.closeCalls.length,
    1,
    'a stale locally acquired transport must be closed without touching the replacement'
  );
  assert.equal(
    coordinator.getJob(
      'panel',
      lifecycle(),
      'transport-acquisition-replacement',
      'controller-transport-acquisition-replacement',
      'terminal'
    ),
    replacementJob
  );
  assert.equal(replacementTransport.cancelCalls.length, 0);
  coordinator.cancelAll();
  await flush();
}

async function testAdmissionContinuesAfterTerminalAck(Coordinator) {
  const transports = new Map();
  for (let index = 1; index <= 5; index += 1) {
    const nodeId = `ack-admission-${index}`;
    const transport = createTransport(nodeId);
    transport.openResult = {
      projectionId: `projection-${nodeId}`,
      supervisorInstanceId: 'supervisor-1',
      sessionId: 'session-1',
      authorityId: 'authority-1',
      targetRevision: 0,
      checkpoint: { revision: 0 }
    };
    transports.set(nodeId, transport);
  }
  transports.get('ack-admission-1').readResults.push({
    ...createChunkResult('session-1', 'authority-1', 'projection-ack-admission-1', 0, {
      kind: 'checkpoint',
      dataOffset: 0,
      data: '',
      complete: true
    }),
    done: true
  });
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async (job) => transports.get(job.nodeId),
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: () => undefined
  });
  for (let index = 1; index <= 5; index += 1) {
    coordinator.enqueue(createRequest(`ack-admission-${index}`, 'background'));
  }
  await flush();
  assert.equal(
    transports.get('ack-admission-5').openCalls.length,
    0,
    'the fifth background projection should initially wait behind the base cap'
  );
  assert.equal(
    coordinator.requestCredit(
      'panel',
      'ack-admission-1',
      'terminal',
      'controller-ack-admission-1',
      'projection-ack-admission-1',
      1024
    ),
    true
  );
  await flush();
  assert.equal(
    coordinator.acknowledgeChunk(
      'panel',
      lifecycle(),
      'ack-admission-1',
      'terminal',
      'controller-ack-admission-1',
      'projection-ack-admission-1',
      1,
      0,
      1024
    ),
    true
  );
  await flush();
  assert.equal(
    transports.get('ack-admission-5').openCalls.length,
    1,
    'ACKing the terminal chunk must immediately admit the next queued projection'
  );
  coordinator.cancelAll();
  await flush();
}

async function testAdmissionContinuesAfterOpenFailure(Coordinator) {
  let rejectFirstOpen;
  const transports = new Map();
  for (let index = 1; index <= 5; index += 1) {
    const nodeId = `failure-admission-${index}`;
    const transport = createTransport(nodeId);
    transport.openResult = {
      projectionId: `projection-${nodeId}`,
      supervisorInstanceId: 'supervisor-1',
      sessionId: 'session-1',
      authorityId: 'authority-1',
      targetRevision: 0,
      checkpoint: { revision: 0 }
    };
    transports.set(nodeId, transport);
  }
  const firstTransport = transports.get('failure-admission-1');
  firstTransport.open = (params) => {
    firstTransport.openCalls.push(params);
    return new Promise((_resolve, reject) => {
      rejectFirstOpen = reject;
    });
  };
  const failures = [];
  const coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async (job) => transports.get(job.nodeId),
    onState: () => undefined,
    onChunk: () => undefined,
    onReady: () => undefined,
    onFailed: (job, error) => failures.push([job.nodeId, error.message])
  });
  for (let index = 1; index <= 5; index += 1) {
    coordinator.enqueue(createRequest(`failure-admission-${index}`, 'background'));
  }
  await flush();
  assert.equal(transports.get('failure-admission-5').openCalls.length, 0);

  rejectFirstOpen(new Error('synthetic open failure'));
  await flush();
  assert.deepEqual(failures, [['failure-admission-1', 'synthetic open failure']]);
  assert.equal(
    firstTransport.closeCalls.length,
    1,
    'an open failure without a projection id must close its transport before the next admission'
  );
  assert.equal(
    transports.get('failure-admission-5').openCalls.length,
    1,
    'an open failure must release its admission slot without an external scheduler event'
  );
  coordinator.cancelAll();
  await flush();
}

async function testBackgroundEventuallyProgresses(Coordinator) {
  const readOrder = [];
  const transports = new Map();
  for (const nodeId of ['fair-selected', 'fair-visible', 'fair-background']) {
    const transport = createTransport(nodeId);
    transport.openResult = {
      projectionId: `projection-${nodeId}`,
      supervisorInstanceId: 'supervisor-1',
      sessionId: 'session-1',
      authorityId: 'authority-1',
      targetRevision: 1,
      checkpoint: { revision: 0 }
    };
    transport.read = async (params) => {
      transport.readCalls.push(params);
      readOrder.push(nodeId);
      return createChunkResult('session-1', 'authority-1', params.projectionId, 1, {
        kind: 'output',
        revision: 1,
        createdAtMs: 1,
        dataOffset: 0,
        data: nodeId,
        complete: true
      });
    };
    transports.set(nodeId, transport);
  }
  let coordinator;
  coordinator = new Coordinator({
    isCurrent: () => true,
    getTransport: async (job) => transports.get(job.nodeId),
    onState: () => undefined,
    onChunk: (job, _result, sequence) => {
      if (readOrder.length >= 24) {
        return;
      }
      coordinator.acknowledgeChunk(
        job.surface,
        job.lifecycle,
        job.nodeId,
        job.kind,
        job.controllerGeneration,
        job.projectionId,
        sequence,
        job.appliedRevision,
        1024
      );
    },
    onReady: () => undefined,
    onFailed: () => undefined
  });
  for (const [nodeId, priority] of [
    ['fair-selected', 'selected'],
    ['fair-visible', 'visible'],
    ['fair-background', 'background']
  ]) {
    coordinator.enqueue(createRequest(nodeId, priority));
  }
  await flush();
  for (const nodeId of ['fair-selected', 'fair-visible', 'fair-background']) {
    assert.equal(
      coordinator.requestCredit(
        'panel',
        nodeId,
        'terminal',
        `controller-${nodeId}`,
        `projection-${nodeId}`,
        1024
      ),
      true
    );
  }
  await flush();
  const firstBackgroundRead = readOrder.indexOf('fair-background');
  assert.ok(firstBackgroundRead >= 0, 'background projection must eventually receive a chunk read');
  assert.ok(
    firstBackgroundRead < 12,
    `background projection should progress within one weighted scheduling cycle, got ${readOrder.join(', ')}`
  );
  coordinator.cancelAll();
}

function createTransport(label) {
  const transport = {
    label,
    openCalls: [],
    readCalls: [],
    cancelCalls: [],
    closeCalls: [],
    readResults: [],
    openResult: undefined,
    open: async (params) => {
      transport.openCalls.push(params);
      return transport.openResult ?? {
        projectionId: `projection-${transport.openCalls.length}`,
        supervisorInstanceId: 'supervisor-1',
        sessionId: 'session-1',
        authorityId: 'authority-1',
        targetRevision: 1,
        checkpoint: { revision: 0 }
      };
    },
    read: async (params) => {
      transport.readCalls.push(params);
      const result = transport.readResults.shift();
      if (!result) {
        return createDoneResult('session-1', 'authority-1', params.projectionId, 1);
      }
      return result;
    },
    cancel: async (params) => {
      transport.cancelCalls.push(params);
      return { cancelled: true };
    },
    close: async () => {
      transport.closeCalls.push(true);
    }
  };
  return transport;
}

function createRequest(nodeId, priority, requestLifecycle = lifecycle()) {
  return {
    surface: 'panel',
    lifecycle: requestLifecycle,
    nodeId,
    kind: 'terminal',
    controllerGeneration: `controller-${nodeId}`,
    sessionId: 'session-1',
    supervisorInstanceId: 'supervisor-1',
    sourceKey: `panel:terminal:${nodeId}`,
    priority
  };
}

function lifecycle() {
  return {
    surface: 'panel',
    mode: 'active',
    generation: 'lifecycle-1',
    frameId: 'frame-1'
  };
}

function createChunkResult(sessionId, authorityId, projectionId, targetRevision, chunk) {
  return {
    projectionId,
    supervisorInstanceId: 'supervisor-1',
    sessionId,
    authorityId,
    targetRevision,
    payloadBytes: Buffer.byteLength(JSON.stringify(chunk), 'utf8'),
    chunkChecksum: '0'.repeat(64),
    chunk,
    done: false
  };
}

function createDoneResult(sessionId, authorityId, projectionId, targetRevision) {
  return {
    projectionId,
    supervisorInstanceId: 'supervisor-1',
    sessionId,
    authorityId,
    targetRevision,
    payloadBytes: 0,
    done: true,
    live: true
  };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
