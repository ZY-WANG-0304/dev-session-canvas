import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
};
const finiteTime = value => Number.isFinite(value) && value >= 0;

function terminalWaitStatus(status) {
  if (!Number.isInteger(status) || status < 0 || status > 65535) return null;
  const signal = status & 127;
  if (signal === 0) return { kind: 'exited', exitCode: (status >> 8) & 255, rawStatus: status };
  if (signal <= 64 && status <= 255)
    return { kind: 'signaled', signalCode: signal, coreDumped: (status & 128) !== 0, rawStatus: status };
  return null;
}

export function assessCase(config, observation, evidence) {
  const failures = [];
  const domains = { scenario: true, resource: true, evidence: true };
  let termination = null;
  const check = (domain, condition, reason) => {
    if (!condition) { domains[domain] = false; failures.push({ domain, reason }); }
    return Boolean(condition);
  };
  const scenario = (condition, reason) => check('scenario', condition, reason);
  const resource = (condition, reason) => check('resource', condition, reason);
  const fact = (condition, reason) => check('evidence', condition, reason);
  const result = () => ({
    pass: domains.scenario && domains.resource && domains.evidence,
    scenarioMatches: domains.scenario,
    resourcesSettled: domains.resource,
    evidenceSufficient: domains.evidence,
    safeToContinue: domains.resource && domains.evidence,
    termination,
    failures
  });
  try {
    fact(config?.scenario === 'U1-6' && config?.fixtureScenario === 'U1-6' &&
      /^[a-f0-9]{32}$/.test(config.token), 'fixed U1-6 identity');
    fact(observation?.token === config.token, 'observation token');
    const messages = observation?.messages ?? [];
    const after = messages.filter(item => item?.value?.type === 'after-await');
    const final = messages.filter(item => item?.value?.type === 'caller-final');
    fact(after.length === 1 && final.length === 1, 'one operation result and caller final');
    const awaited = after[0]?.value;
    const caller = final[0]?.value;
    fact(awaited?.token === config.token && caller?.token === config.token &&
      awaited?.result?.kind === 'result', 'caller result identity and kind');
    fact(finiteTime(after[0]?.ms) && finiteTime(awaited?.callerMs) && finiteTime(final[0]?.ms),
      'caller message timestamps');
    resource(caller?.closed?.code === 0 && caller.closed.signal === null,
      'driver closes without control termination');
    resource(observation?.callerExit?.code === 0 && observation.callerExit.signal === null &&
      observation?.callerClose?.code === 0 && observation.callerClose.signal === null,
    'caller exits and closes normally');
    fact(caller?.stdout === '' && caller?.stderr === '' &&
      ![...(caller?.events ?? []), ...(observation?.events ?? [])].some(item =>
        item?.name?.includes('error') || item?.name?.includes('deadline') || item?.name === 'driver-control'),
    'no protocol diagnostics or forced controls');
    const bytes = JSON.stringify(observation, null, 2) + '\n';
    fact(evidence?.error === null && evidence?.close?.code === 0 && evidence.close.signal === null &&
      finiteTime(evidence?.receipt?.ms) && evidence.receipt.value.bytes === Buffer.byteLength(bytes) &&
      evidence.receipt.value.hash === hash(bytes), 'independent evidence receipt');

    const report = awaited?.result?.report;
    const n = report?.native;
    if (!n) {
      scenario(false, 'U1-6 native report missing');
      resource(false, 'U1-6 owners cannot be settled without native facts');
      fact(false, 'native raw evidence missing');
      return result();
    }
    fact(report.token === config.token && report.scenario === 'U1-6' &&
      report.fixtureScenario === 'U1-6' && n.token === config.token && n.scenario === 'U1-6',
    'native and fixture identity');
    fact(report.loaded?.path === config.binary && report.loaded?.hash === config.binaryHash &&
      report.loaded?.platform === 'darwin', 'loaded candidate identity');
    resource(report.error === null, 'driver reports no internal error');
    const events = Array.isArray(n.events) ? n.events : [];
    const named = name => events.filter(item => item.name === name);
    const one = (name, domain = 'evidence') => {
      const found = named(name);
      check(domain, found.length === 1, `one native event: ${name}`);
      return found[0];
    };
    fact(events.length > 0 && events.every((item, index) => item.ord === index + 1 &&
      /^\d+$/.test(item.monoNs) && BigInt(item.monoNs) > 0n &&
      (index === 0 || BigInt(item.monoNs) >= BigInt(events[index - 1].monoNs))),
    'ordered native ledger');
    scenario(n.configured && n.spawnAttempted && n.masterAcquired && Number.isInteger(n.pid) && n.pid > 0 &&
      Number.isInteger(n.master) && n.master >= 0 && n.kqueueAcquired && n.kqueueFd >= 0 &&
      n.kqueueOwnerRegistered === true,
    'real child, master and kqueue owners established');
    const owner = one('owner-registered');
    scenario(owner?.value === n.pid && owner?.aux === n.master, 'child owner binds pid and master');
    const kq = one('kqueue-return');
    scenario(kq?.value === n.kqueueFd && kq.error === 0, 'kqueue returned a real fd');
    const regEnter = one('kqueue-register-enter');
    const injected = one('kqueue-register-failure', 'scenario');
    scenario(regEnter?.value === n.kqueueFd && regEnter?.aux === n.pid &&
      injected?.value === -1 && injected?.error === 'EIO' && injected?.aux === n.kqueueFd,
    'registration substitute records synthetic EIO');
    scenario(n.registerApiEntered === true && n.registrationCallInvoked === false &&
      n.registrationFailureInjected === true && n.registrationInFlight === false &&
      n.registrationResult === -1 && n.registrationError === 'EIO' &&
      n.kqueueRegistered === false && n.kqueueWaitReturned === false,
    'register failpoint entered before real API');
    scenario(named('kqueue-register-return').length === 0 && named('kqueue-wait-enter').length === 0 &&
      named('kqueue-wait-return').length === 0 && named('kqueue-exit-event').length === 0,
    'no real registration, wait or exit event after substitute');

    const controls = report.controlMessages ?? [];
    const ready = controls.filter(item => item.type === 'ready');
    const abort = controls.filter(item => item.type === 'abort');
    const ack = controls.filter(item => item.type === 'abort-ack');
    const written = controls.filter(item => item.type === 'written');
    scenario(ready.length === 1 && ready[0].token === config.token && ready[0].pid === n.pid &&
      ready[0].kqueueRegistered === false && ready[0].registrationFailureInjected === true,
    'fixture ready is bound to failed registration');
    resource(abort.length === 1 && ack.length === 1 && abort[0].token === config.token &&
      ack[0].token === config.token && abort[0].pid === n.pid && ack[0].pid === n.pid,
    'token and pid bound abort acknowledgement');
    scenario(written.length === 0 && report.permissionSent === false && report.readCalls === 0 &&
      report.parserAccepted === 0 && report.parserCompleted === 0 && report.rawBase64 === '' &&
      report.state === null && !controls.some(item => item.type === 'go'),
    'data gate remains closed after registration failure');
    const abortEvent = report.events?.find(item => item.name === 'abort-sent');
    const ackEvent = report.events?.find(item => item.name === 'abort-ack');
    resource(finiteTime(abortEvent?.ms) && finiteTime(ackEvent?.ms) && abortEvent.ms <= ackEvent.ms &&
      abortEvent.token === config.token && ackEvent.token === config.token &&
      abortEvent.pid === n.pid && ackEvent.pid === n.pid,
    'abort lifecycle is ordered and identified');
    const waitEnter = one('wait-enter', 'resource');
    const waitReturn = one('wait-return', 'resource');
    resource(n.waitpidCalls === 1 && n.waitConfirmed === true && n.waitPid === n.pid && n.waitError === 0 &&
      waitEnter?.thread === n.waitThreadId && waitReturn?.thread === n.waitThreadId &&
      waitEnter?.value === n.pid && waitReturn?.value === n.pid && waitReturn?.error === 0,
    'one waitpid by the owning wait thread');
    termination = terminalWaitStatus(n.waitStatus);
    resource(termination !== null && termination.kind === 'exited' && termination.exitCode === n.exitCode &&
      n.signalCode === 0, 'wait status is a terminal result');
    resource(named('wait-enter').length === 1 && named('wait-return').length === 1 &&
      named('wait-poll-enter').length === 0 && named('wait-poll-return').length === 0,
    'no competing or polling waiter');
    const kcloseEnter = one('kqueue-close-enter', 'resource');
    const kcloseReturn = one('kqueue-close-return', 'resource');
    resource(n.kqueueCloseCalls === 1 && n.kqueueCloseReturned === true && n.kqueueCloseError === 0 &&
      kcloseEnter?.thread === n.waitThreadId && kcloseReturn?.thread === n.waitThreadId &&
      kcloseReturn?.value === 0 && kcloseReturn?.error === 0 && kcloseReturn?.aux === n.kqueueFd,
    'kqueue closes once on the same wait thread');
    resource(waitReturn?.ord < kcloseEnter?.ord, 'waitpid terminal result precedes kqueue close');
    const resourceEvents = ['payload-allocated', 'notification-enter', 'notification-callback', 'payload-freed',
      'notification-return', 'tsfn-release-enter', 'tsfn-release-return', 'thread-finished', 'thread-joined',
      'tsfn-finalizer-enter', 'tsfn-finalized'];
    for (const name of resourceEvents) one(name, 'resource');
    resource(n.payloadAllocated && n.payloadFreed && n.notificationCallInvoked && n.notificationStatus === 0 &&
      n.notificationCallbackStatus === 0 && n.tsfnCreated && n.tsfnFinalized && n.tsfnCreateStatus === 0 &&
      n.tsfnReleaseStatus === 0 && n.threadStarted && n.threadFinished && n.threadJoined &&
      n.threadJoinError === 0 && n.threadJoinable === false,
    'payload, notification, TSFN and thread settle');
    const masterClose = one('master-close-return', 'resource');
    resource(n.masterCloseCalls === 1 && n.masterCloseReturned && n.masterCloseError === 0 &&
      masterClose?.value === 0 && masterClose?.error === 0 && masterClose?.aux === n.master,
    'master closes once after native owners settle');
    resource(kcloseReturn?.ord < named('payload-allocated')[0]?.ord &&
      named('tsfn-finalized')[0]?.ord < masterClose?.ord,
    'native close and finalizer order');
    fact(report.events?.some(item => item.name === 'master-close-request' && item.readPending === 0 &&
      item.parserPending === 0), 'master close sees no pending JS consumers');
    fact(!report.events?.some(item => item.name === 'read-enter' || item.name === 'parser-enter' ||
      item.name === 'parser-complete'), 'no output consumer work is reported');
  } catch (error) {
    fact(false, `malformed U1-6 evidence: ${error.message}`);
    resource(false, 'resource assessment incomplete');
    scenario(false, 'scenario assessment incomplete');
  }
  return result();
}

export function legacyReadyGate(snapshot) {
  return Boolean(snapshot?.ready && snapshot?.kqueueRegistered);
}
