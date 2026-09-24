import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { budgets } from './diagnose-native-failure-v1.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
};
const finiteTime = value => Number.isFinite(value) && value >= 0;

function terminalWaitStatus(status) {
  if (!Number.isInteger(status) || status < 0 || status > 65535) return null;
  const signal = status & 127;
  if (signal === 0) return { kind: 'exited', exitCode: (status >> 8) & 255, rawStatus: status };
  if (signal <= 31 && status <= 255)
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
    fact(config?.platform === 'darwin' && config?.scenario === 'U1-6' && config?.fixtureScenario === 'U1-6' &&
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
    fact(finiteTime(after[0]?.ms) && after[0].ms <= budgets.afterAwait && finiteTime(awaited?.callerMs) &&
      awaited.callerMs <= budgets.caller && finiteTime(final[0]?.ms) && final[0].ms >= after[0].ms,
    'caller message timestamps and frozen budgets');
    resource(caller?.closed?.code === 0 && caller.closed.signal === null,
      'driver closes without control termination');
    resource(caller?.exit?.code === 0 && caller.exit.signal === null, 'driver exit separately observed');
    fact(finiteTime(caller?.closed?.ms) && caller.closed.ms <= budgets.caller,
      'driver stdio close budget');
    resource(observation?.callerExit?.code === 0 && observation.callerExit.signal === null &&
      observation?.callerClose?.code === 0 && observation.callerClose.signal === null,
    'caller exits and closes normally');
    fact(finiteTime(observation?.callerExit?.ms) && finiteTime(observation?.callerClose?.ms) &&
      observation.callerExit.ms <= observation.callerClose.ms && observation.callerClose.ms <= budgets.observation,
    'caller exit and stdio close budget');
    const resultEvents = caller?.events?.filter(item => item.name === 'driver-result') ?? [];
    const awaitEvents = caller?.events?.filter(item => item.name === 'after-await') ?? [];
    fact(resultEvents.length === 1 && awaitEvents.length === 1 && finiteTime(resultEvents[0]?.ms) &&
      resultEvents[0].ms <= budgets.operation && finiteTime(awaitEvents[0]?.ms) &&
      resultEvents[0].ms <= awaitEvents[0].ms && awaitEvents[0].ms <= awaited?.callerMs,
    'real caller await continuation within operation budget');
    fact(caller?.stdout === '' && caller?.stderr === '' &&
      ![...(caller?.events ?? []), ...(observation?.events ?? [])].some(item =>
        item?.name?.includes('error') || item?.name?.includes('deadline') || item?.name?.endsWith('-control') ||
        ['caller-stdout', 'caller-stderr'].includes(item?.name)),
    'no protocol diagnostics or forced controls');
    const bytes = JSON.stringify(observation, null, 2) + '\n';
    fact(evidence?.error === null && evidence?.close?.code === 0 && evidence.close.signal === null &&
      finiteTime(evidence?.receipt?.ms) && evidence.receipt.ms <= budgets.writer &&
      finiteTime(evidence?.close?.ms) && evidence.receipt.ms <= evidence.close.ms && evidence.close.ms <= budgets.writerObservation &&
      evidence.receipt.value.bytes === Buffer.byteLength(bytes) &&
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
      report.loaded?.platform === 'darwin' && report.loaded?.node === 'v22.23.2' && n.platform === 'darwin',
    'loaded candidate identity');
    resource(report.error === null, 'driver reports no internal error');
    fact(!report.events?.some(item => item.name.includes('error') || item.name.includes('deadline')),
      'driver protocol diagnostics remain failures');
    const events = Array.isArray(n.events) ? n.events : [];
    const named = name => events.filter(item => item.name === name);
    const one = (name, domain = 'evidence') => {
      const found = named(name);
      check(domain, found.length === 1, `one native event: ${name}`);
      return found[0];
    };
    const before = (a, b, domain = 'resource') => check(domain,
      named(a).at(-1)?.ord < named(b)[0]?.ord, `${a} before ${b}`);
    fact(n.overflow === false && n.clockError === 0 && events.length > 0 && events.every((item, index) => item.ord === index + 1 &&
      /^\d+$/.test(item.monoNs) && BigInt(item.monoNs) > 0n &&
      (index === 0 || BigInt(item.monoNs) >= BigInt(events[index - 1].monoNs))),
    'ordered native ledger');
    resource(n.configured && n.spawnAttempted && n.masterAcquired && Number.isInteger(n.pid) && n.pid > 0 &&
      Number.isInteger(n.master) && n.master >= 0 && n.kqueueAcquired && Number.isInteger(n.kqueueFd) && n.kqueueFd >= 0 &&
      n.kqueueOwnerRegistered === true,
    'real child, master and kqueue owners established');
    const owner = one('owner-registered');
    resource(owner?.value === n.pid && owner?.aux === n.master, 'child owner binds pid and master');
    const masterOpen = one('master-open-return', 'resource'), spawn = one('spawn-return', 'resource');
    resource(masterOpen?.value === n.master && masterOpen.error === 0 && spawn?.value === 0 &&
      spawn.error === 0 && spawn.aux === n.pid, 'actual master acquisition and posix_spawn result');
    before('master-open-return', 'spawn-return'); before('spawn-return', 'owner-registered');
    const kqReturns = named('kqueue-return'), kqEnters = named('kqueue-enter'), kq = kqReturns.at(-1);
    resource(kqEnters.length > 0 && kqEnters.length === kqReturns.length && kqReturns.every((item, index) =>
      kqEnters[index].ord < item.ord && (index === 0 || kqReturns[index - 1].ord < kqEnters[index].ord) &&
      (index === kqReturns.length - 1 || item.value === -1 && item.error === 4)) &&
      kq?.value === n.kqueueFd && kq.error === 0, 'kqueue returned a real fd, retrying only EINTR');
    const kqOwner = one('kqueue-owner-registered', 'resource');
    resource(kqOwner?.value === n.kqueueFd && kqOwner?.aux === n.pid && kqOwner?.error === 0,
      'kqueue owner is explicitly registered');
    before('kqueue-return', 'kqueue-owner-registered'); before('kqueue-owner-registered', 'kqueue-register-enter');
    resource(typeof n.waitThreadId === 'string' && n.waitThreadId.length > 0 &&
      ['thread-started', 'kqueue-enter', 'kqueue-return', 'kqueue-owner-registered', 'kqueue-register-enter',
        'kqueue-register-failure'].every(name => named(name).every(item => item.thread === n.waitThreadId)),
    'actual wait thread owns kqueue and injection');
    const regEnter = one('kqueue-register-enter');
    const injected = one('kqueue-register-failure', 'scenario');
    scenario(regEnter?.value === n.kqueueFd && regEnter?.aux === n.pid &&
      injected?.value === -1 && injected?.error === 5 && injected?.aux === n.kqueueFd &&
      regEnter?.ord < injected?.ord,
    'registration substitute records synthetic EIO');
    scenario(n.registerApiEntered === true && n.registrationCallInvoked === false &&
      n.registrationFailureInjected === true && n.registrationInFlight === false &&
      n.registrationResult === -1 && n.registrationError === 5 && n.registrationErrorSource === 'native-substitute' &&
      n.kqueueRegistered === false && n.kqueueWaitReturned === false,
    'register failpoint entered before real API');
    scenario(named('kqueue-register-return').length === 0 && named('kqueue-wait-enter').length === 0 &&
      named('kqueue-wait-return').length === 0 && named('kqueue-exit-event').length === 0,
    'no real registration, wait or exit event after substitute');
    resource(n.registrationInFlight === false, 'registration has no in-flight use');

    const controls = report.controlMessages ?? [];
    const ready = controls.filter(item => item.type === 'ready');
    const abort = controls.filter(item => item.type === 'abort');
    const ack = controls.filter(item => item.type === 'abort-ack');
    const written = controls.filter(item => item.type === 'written');
    fact(ready.length === 1 && ready[0].token === config.token && ready[0].pid === n.pid &&
      ready[0].stdinTTY === true && ready[0].stdoutTTY === true, 'fixture ready binds the actual child');
    const gate = report.writeGate, gateEvents = report.events?.filter(item => item.name === 'write-gate-ready') ?? [];
    const gateNative = gate?.native;
    fact(gateEvents.length === 1 && equal(gateEvents[0].gate, gate) && equal(gate?.ready, ready[0]) &&
      gateNative?.token === config.token && gateNative?.pid === n.pid && gateNative?.master === n.master &&
      gateNative?.kqueueFd === n.kqueueFd && Array.isArray(gateNative?.events) && gateNative.events.length > 0 &&
      equal(gateNative.events, events.slice(0, gateNative.events.length)),
    'abort gate uses an actual same-child native prefix, not fixture claims');
    scenario(gateNative?.registrationFailureInjected === true &&
      gateNative.registrationInFlight === false && gateNative.registrationCallInvoked === false &&
      gateNative.kqueueOwnerRegistered === true && gateNative.kqueueRegistered === false &&
      gateNative.registrationResult === -1 && gateNative.registrationError === 5 &&
      gateNative.registrationErrorSource === 'native-substitute' && gateNative.masterCloseCalls === 0 &&
      gateNative.events.some(item => item.name === 'kqueue-register-failure'),
    'abort follows the registration substitute without opening the data gate');
    resource(abort.length === 1 && ack.length === 1 && abort[0].token === config.token &&
      ack[0].token === config.token && abort[0].pid === n.pid && ack[0].pid === n.pid,
    'token and pid bound abort acknowledgement');
    scenario(written.length === 0 && report.permissionSent === false && report.readCalls === 0 &&
      report.parserAccepted === 0 && report.parserCompleted === 0 && report.rawBase64 === '' &&
      report.state === null && !controls.some(item => item.type === 'go'),
    'data gate remains closed after registration failure');
    const abortEvents = report.events?.filter(item => item.name === 'abort-sent') ?? [];
    const ackEvents = report.events?.filter(item => item.name === 'abort-ack') ?? [];
    const abortEvent = abortEvents[0], ackEvent = ackEvents[0];
    resource(abortEvents.length === 1 && ackEvents.length === 1, 'abort and acknowledgement are single-use');
    resource(finiteTime(abortEvent?.ms) && finiteTime(ackEvent?.ms) && abortEvent.ms <= ackEvent.ms &&
      abortEvent.token === config.token && ackEvent.token === config.token &&
      abortEvent.pid === n.pid && ackEvent.pid === n.pid && finiteTime(gateEvents[0]?.ms) &&
      gateEvents[0].ms <= abortEvent.ms && controls.indexOf(ready[0]) < controls.indexOf(abort[0]) &&
      controls.indexOf(abort[0]) < controls.indexOf(ack[0]),
    'abort lifecycle is ordered and identified');
    const waitEnter = one('wait-enter', 'resource');
    const waitReturn = one('wait-return', 'resource');
    resource(n.waitpidCalls === 1 && n.waitConfirmed === true && n.waitPid === n.pid && n.waitError === 0 &&
      waitEnter?.thread === n.waitThreadId && waitReturn?.thread === n.waitThreadId &&
      waitEnter?.value === n.pid && waitEnter?.aux === 0 && waitEnter?.error === 0 &&
      waitEnter.ord < waitReturn?.ord && waitReturn?.value === n.pid && waitReturn?.error === 0 &&
      waitReturn.aux === n.waitStatus,
    'one waitpid by the owning wait thread');
    if (waitReturn?.value === n.pid && waitReturn?.error === 0 && n.waitConfirmed === true)
      termination = terminalWaitStatus(waitReturn.aux);
    const exitCode = termination?.kind === 'exited' ? termination.exitCode : 0;
    const signalCode = termination?.kind === 'signaled' ? termination.signalCode : 0;
    resource(termination !== null && n.exitCode === exitCode && n.signalCode === signalCode,
      'raw wait status is a terminal result');
    scenario(termination?.kind === 'exited' && termination.exitCode === 0,
      'controlled abort fixture exits zero; other terminal results do not imply a resource leak');
    resource(named('wait-enter').length === 1 && named('wait-return').length === 1 &&
      named('wait-poll-enter').length === 0 && named('wait-poll-return').length === 0,
    'no competing or polling waiter');
    before('kqueue-register-enter', 'wait-enter');
    scenario(injected?.ord < waitEnter?.ord, 'substitute returned before the reaper waited');
    const kcloseEnter = one('kqueue-close-enter', 'resource');
    const kcloseReturn = one('kqueue-close-return', 'resource');
    resource(n.kqueueCloseCalls === 1 && n.kqueueCloseReturned === true && n.kqueueCloseError === 0 &&
      kcloseEnter?.thread === n.waitThreadId && kcloseReturn?.thread === n.waitThreadId &&
      kcloseEnter?.value === n.kqueueFd && kcloseEnter?.ord < kcloseReturn?.ord &&
      kcloseReturn?.value === 0 && kcloseReturn?.error === 0 && kcloseReturn?.aux === n.kqueueFd,
    'kqueue closes once on the same wait thread');
    resource(waitReturn?.ord < kcloseEnter?.ord, 'waitpid terminal result precedes kqueue close');
    const resourceEvents = ['thread-started', 'tsfn-create-enter', 'tsfn-create-return',
      'payload-allocated', 'notification-enter', 'notification-callback', 'payload-freed',
      'notification-return', 'tsfn-release-enter', 'tsfn-release-return', 'thread-finished', 'thread-joined',
      'tsfn-finalizer-enter', 'tsfn-finalized'];
    for (const name of resourceEvents) one(name, 'resource');
    resource(n.payloadAllocated && n.payloadFreed && n.notificationCallInvoked && n.notificationStatus === 0 &&
      n.notificationCallbackStatus === 0 && n.tsfnCreated && n.tsfnFinalized && n.tsfnCreateStatus === 0 &&
      n.tsfnReleaseStatus === 0 && n.threadStarted && n.threadFinished && n.threadJoined &&
      n.threadJoinError === 0 && n.threadJoinable === false,
    'payload, notification, TSFN and thread settle');
    for (const name of ['tsfn-create-return', 'notification-return', 'notification-callback', 'tsfn-release-return']) {
      resource(named(name)[0]?.value === 0 && named(name)[0]?.error === 0, `successful actual ${name}`);
    }
    for (const [a, b] of [['tsfn-create-enter', 'tsfn-create-return'], ['tsfn-create-return', 'thread-started'],
      ['thread-started', 'kqueue-enter'], ['kqueue-close-return', 'payload-allocated'],
      ['payload-allocated', 'notification-enter'], ['notification-enter', 'notification-return'],
      ['notification-enter', 'notification-callback'], ['notification-callback', 'payload-freed'],
      ['notification-return', 'tsfn-release-enter'], ['tsfn-release-enter', 'tsfn-release-return'],
      ['tsfn-release-return', 'thread-finished'], ['thread-finished', 'thread-joined'],
      ['tsfn-finalizer-enter', 'thread-joined'], ['payload-freed', 'tsfn-finalizer-enter'],
      ['thread-joined', 'tsfn-finalized'], ['tsfn-finalized', 'master-close-enter']]) before(a, b);
    const callbackEvents = report.events?.filter(item => item.name === 'exit-callback') ?? [];
    resource(report.callback?.exitCode === exitCode && report.callback?.signalCode === signalCode &&
      callbackEvents.length === 1 && callbackEvents[0].exitCode === exitCode && callbackEvents[0].signalCode === signalCode,
    'consumer receives the same wait result');
    const owners = n.resources;
    resource(Array.isArray(owners) && ['spawn-actions', 'spawn-attrs', 'slave', 'low-fd-0'].every(id => owners.some(o => o.id === id)) &&
      new Set(owners.map(o => o.id)).size === owners.length, 'spawn temporary ownership is accounted for');
    for (const o of owners ?? []) {
      const acquired = one(`${o.id}-acquire-return`, 'resource'), closed = one(`${o.id}-release-return`, 'resource');
      resource(o.acquired === true && o.releaseCalls === 1 && o.releaseReturned === true && o.releaseResult === 0 &&
        o.releaseError === 0 && acquired?.value === o.value && acquired?.error === 0 && closed?.value === 0 &&
        closed?.error === 0 && closed?.aux === o.value && acquired?.ord < closed?.ord &&
        closed?.ord < named('thread-started')[0]?.ord, `temporary owner settled: ${o.id}`);
    }
    const masterEnter = one('master-close-enter', 'resource');
    const masterClose = one('master-close-return', 'resource');
    resource(n.masterCloseCalls === 1 && n.masterCloseReturned && n.masterCloseError === 0 &&
      masterEnter?.value === n.master && masterEnter?.ord < masterClose?.ord &&
      masterClose?.value === 0 && masterClose?.error === 0 && masterClose?.aux === n.master,
    'master closes once after native owners settle');
    resource(kcloseReturn?.ord < named('payload-allocated')[0]?.ord &&
      named('tsfn-finalized')[0]?.ord < masterClose?.ord,
    'native close and finalizer order');
    const closeRequests = report.events?.filter(item => item.name === 'master-close-request') ?? [];
    resource(closeRequests.length === 1 && report.readPending === 0 && closeRequests[0]?.readPending === 0 &&
      closeRequests[0]?.parserPending === 0 && finiteTime(closeRequests[0]?.ms) &&
      ackEvent?.ms <= closeRequests[0]?.ms && callbackEvents[0]?.ms <= closeRequests[0]?.ms,
    'master close follows acknowledgement and consumer completion');
    const beforeClose = report.beforeCloseNative;
    const closeFields = ['events', 'masterCloseCalls', 'masterCloseReturned', 'masterCloseError', 'masterFlagsBefore',
      'masterFlagsAfter', 'masterStatValid', 'masterStatDev', 'masterStatIno', 'masterStatRdev'];
    const stable = snapshot => Object.fromEntries(Object.entries(snapshot ?? {}).filter(([key]) => !closeFields.includes(key)));
    fact(equal(events.slice(-5).map(item => item.name), ['master-fgetfl-before', 'master-fstat', 'master-fgetfl-after',
      'master-close-enter', 'master-close-return']) && equal(beforeClose?.events, events.slice(0, -5)) &&
      equal(stable(beforeClose), stable(n)) && beforeClose.masterCloseCalls === 0 && beforeClose.masterCloseReturned === false,
    'pre-close snapshot settles non-master owners before final close');
    scenario(!report.events?.some(item => ['write-permission', 'read-enter', 'read-return', 'parser-enter',
      'parser-complete'].includes(item.name)), 'reported data activity is gate leakage, not missing evidence');
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
