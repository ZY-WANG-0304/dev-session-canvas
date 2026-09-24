import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');

const event = (name, fields = {}) => ({ name, ...fields });

export const U16_TOKEN = '1234567890abcdef1234567890abcdef';
export const U16_PID = 4321;
export const U16_MASTER = 20;
export const U16_KQUEUE = 22;
export const U16_WAIT_THREAD = 'wait-thread-1';

function nativeEvents() {
  return [
    event('configured'),
    event('master-open-return', { value: U16_MASTER, error: 0 }),
    event('spawn-return', { value: U16_PID, error: 0, aux: U16_MASTER }),
    event('owner-registered', { value: U16_PID, aux: U16_MASTER }),
    event('kqueue-enter'),
    event('kqueue-return', { value: U16_KQUEUE, error: 0 }),
    event('kqueue-owner-registered', { value: U16_KQUEUE, aux: U16_PID }),
    event('kqueue-register-enter', { value: U16_KQUEUE, aux: U16_PID }),
    event('kqueue-register-failure', { value: -1, error: 'EIO', aux: U16_KQUEUE }),
    event('wait-enter', { value: U16_PID, thread: U16_WAIT_THREAD }),
    event('wait-return', { value: U16_PID, error: 0, aux: 1792, thread: U16_WAIT_THREAD }),
    event('kqueue-close-enter', { value: U16_KQUEUE, thread: U16_WAIT_THREAD }),
    event('kqueue-close-return', { value: 0, error: 0, aux: U16_KQUEUE, thread: U16_WAIT_THREAD }),
    event('payload-allocated', { thread: U16_WAIT_THREAD }),
    event('notification-enter', { thread: U16_WAIT_THREAD }),
    event('notification-callback', { value: 0, thread: U16_WAIT_THREAD }),
    event('payload-freed', { thread: U16_WAIT_THREAD }),
    event('notification-return', { value: 0, error: 0, thread: U16_WAIT_THREAD }),
    event('tsfn-release-enter', { thread: U16_WAIT_THREAD }),
    event('tsfn-release-return', { value: 0, error: 0, thread: U16_WAIT_THREAD }),
    event('thread-finished', { thread: U16_WAIT_THREAD }),
    event('thread-joined', { thread: U16_WAIT_THREAD }),
    event('tsfn-finalizer-enter', { thread: U16_WAIT_THREAD }),
    event('tsfn-finalized', { thread: U16_WAIT_THREAD }),
    event('master-close-enter', { value: U16_MASTER }),
    event('master-close-return', { value: 0, error: 0, aux: U16_MASTER })
  ].map((item, index) => ({ ...item, ord: index + 1, monoNs: String(1000000 + index) }));
}

function native() {
  return {
    token: U16_TOKEN,
    scenario: 'U1-6',
    configured: true,
    spawnAttempted: true,
    masterAcquired: true,
    pid: U16_PID,
    master: U16_MASTER,
    kqueueFd: U16_KQUEUE,
    kqueueAcquired: true,
    kqueueOwnerRegistered: true,
    kqueueRegistered: false,
    registerApiEntered: true,
    registrationCallInvoked: false,
    registrationFailureInjected: true,
    registrationInFlight: false,
    registrationResult: -1,
    registrationError: 'EIO',
    kqueueWaitReturned: false,
    waitThreadId: U16_WAIT_THREAD,
    waitpidCalls: 1,
    waitConfirmed: true,
    waitPid: U16_PID,
    waitError: 0,
    waitStatus: 1792,
    exitCode: 7,
    signalCode: 0,
    kqueueCloseCalls: 1,
    kqueueCloseReturned: true,
    kqueueCloseError: 0,
    payloadAllocated: true,
    payloadFreed: true,
    notificationCallInvoked: true,
    notificationStatus: 0,
    notificationCallbackStatus: 0,
    tsfnCreated: true,
    tsfnFinalized: true,
    tsfnCreateStatus: 0,
    tsfnReleaseStatus: 0,
    threadStarted: true,
    threadFinished: true,
    threadJoined: true,
    threadJoinError: 0,
    threadJoinable: false,
    masterCloseCalls: 1,
    masterCloseReturned: true,
    masterCloseError: 0,
    events: nativeEvents()
  };
}

function controlMessages() {
  return [
    { type: 'ready', token: U16_TOKEN, pid: U16_PID, kqueueRegistered: false, registrationFailureInjected: true },
    { type: 'abort', token: U16_TOKEN, pid: U16_PID },
    { type: 'abort-ack', token: U16_TOKEN, pid: U16_PID }
  ];
}

export function createU16Fixture() {
  const n = native();
  const report = {
    token: U16_TOKEN,
    scenario: 'U1-6',
    fixtureScenario: 'U1-6',
    native: n,
    loaded: { path: '/fixed/pty.node', hash: 'fixed-binary', node: 'v22.23.2', platform: 'darwin' },
    error: null,
    callback: { exitCode: 7, signalCode: 0 },
    permissionSent: false,
    readCalls: 0,
    parserAccepted: 0,
    parserCompleted: 0,
    readPending: 0,
    rawBase64: '',
    state: null,
    controlMessages: controlMessages(),
    events: [
      { name: 'write-gate-ready', ms: 1 },
      { name: 'abort-sent', ms: 2, token: U16_TOKEN, pid: U16_PID },
      { name: 'abort-ack', ms: 3, token: U16_TOKEN, pid: U16_PID },
      { name: 'exit-callback', ms: 4, exitCode: 7, signalCode: 0 },
      { name: 'master-close-request', ms: 5, readPending: 0, parserPending: 0 }
    ]
  };
  const config = {
    token: U16_TOKEN,
    scenario: 'U1-6',
    fixtureScenario: 'U1-6',
    binary: report.loaded.path,
    binaryHash: report.loaded.hash,
    platform: 'darwin',
    expected: {
      permissionSent: false,
      written: 0,
      readCalls: 0,
      parserAccepted: 0,
      parserCompleted: 0,
      state: null,
      rawBase64: ''
    }
  };
  const caller = {
    type: 'caller-final',
    token: U16_TOKEN,
    closed: { code: 0, signal: null, ms: 20 },
    exit: { code: 0, signal: null },
    stdout: '',
    stderr: '',
    events: [
      { name: 'driver-result', ms: 10 },
      { name: 'after-await', ms: 11 }
    ]
  };
  const observation = {
    token: U16_TOKEN,
    messages: [
      { ms: 12, value: { type: 'after-await', token: U16_TOKEN, callerMs: 11, result: { kind: 'result', report } } },
      { ms: 13, value: caller }
    ],
    callerExit: { code: 0, signal: null, ms: 14 },
    callerClose: { code: 0, signal: null, ms: 15 }
  };
  const evidenceBytes = JSON.stringify(observation, null, 2) + '\n';
  const evidence = {
    error: null,
    close: { code: 0, signal: null, ms: 16 },
    receipt: { ms: 17, value: { bytes: Buffer.byteLength(evidenceBytes), hash: hash(evidenceBytes) } }
  };
  return { config, observation, caller, report, native: n, evidence };
}

export function legacyReadyGate(snapshot) {
  return Boolean(snapshot?.ready && snapshot?.kqueueRegistered);
}
