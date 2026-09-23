import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgets, fixtureBytes, terminalState } from './diagnose-native-failure-v1.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => { try { assert.deepEqual(left, right); return true; } catch { return false; } };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const finiteTime = value => Number.isFinite(value) && value >= 0;
const require = createRequire(import.meta.url);
export const releaseBudgets = { observation: 100, unknownObservation: 1000, hold: 100 };

function terminalWaitStatus(status) {
  if (!Number.isInteger(status) || status < 0 || status > 65535) return null;
  const signal = status & 127;
  if (signal === 0) return { kind: 'exited', exitCode: (status >> 8) & 255, rawStatus: status };
  // Linux stopped/continued statuses are not a collected terminal result.
  if (signal <= 64 && status <= 255)
    return { kind: 'signaled', signalCode: signal, coreDumped: (status & 128) !== 0, rawStatus: status };
  return null;
}

function assessRelease(config, observation, report, caller, native, { fact, resource, scenario }) {
  const operationId = config.releaseOperationId;
  const identity = value => value?.token === config.token && value?.operationId === operationId;
  const events = (items, name) => items.filter(item => item.name === name);
  const oneEvent = (items, name) => {
    const found = events(items, name);
    fact(found.length === 1 && finiteTime(found[0]?.ms), `one timed release event: ${name}`);
    return found[0];
  };
  const oneMessage = type => {
    const found = observation.messages.filter(item => item.value.type === type);
    fact(found.length === 1 && finiteTime(found[0]?.ms) && finiteTime(found[0]?.value.callerMs) &&
      identity(found[0]?.value), `one identified release message: ${type}`);
    return found[0];
  };
  const failedEvent = item => item.name.includes('protocol-error') || item.name.includes('send-error') ||
    item.name === 'caller-error' || item.name === 'driver-error' || item.name === 'driver-spawn-error' ||
    item.name.endsWith('-control') || item.name.includes('deadline') ||
    ['caller-stdout', 'caller-stderr', 'control-error'].includes(item.name);
  fact([observation.events, caller.events, report.events].every(items => !items.some(failedEvent)),
    'release protocol errors and abnormal controls remain sticky');
  const driver = report.release, consumer = caller.release;
  fact(driver?.operationId === operationId && consumer?.operationId === operationId, 'single release operation identity');
  const readyMessage = oneMessage('release-ready'), auditMessage = oneMessage('release-audit-observed');
  const firstMessage = oneMessage('release-observation'), receiptMessage = oneMessage('release-receipt-observed');
  const permit = oneEvent(observation.events, 'release-permit');
  fact(identity(permit) && readyMessage.ms <= permit.ms, 'observer starts release only after ready');
  const ready = driver.ready;
  fact(equal(readyMessage.value.ready, ready), 'forwarded ready matches driver snapshot');
  fact(ready?.readPending === 0 && ready?.parserPending === 0 && ready?.writtenReceipts === 1 &&
    ready?.source === report.source, 'release readiness includes completed reads, parser and writer receipt');
  const readyNative = ready.native;
  const closeEvents = ['master-fgetfl-before', 'master-fstat', 'master-fgetfl-after', 'master-close-enter', 'master-close-return'];
  fact(equal(native.events.slice(-5).map(item => item.name), closeEvents) &&
    equal(readyNative.events, native.events.slice(0, -5)), 'ready native ledger is the final pre-close prefix');
  const closeFields = ['events', 'masterCloseCalls', 'masterCloseReturned', 'masterCloseError', 'masterFlagsBefore',
    'masterFlagsAfter', 'masterStatValid', 'masterStatDev', 'masterStatIno', 'masterStatRdev'];
  const stableOwners = value => Object.fromEntries(Object.entries(value).filter(([key]) => !closeFields.includes(key)));
  fact(equal(stableOwners(readyNative), stableOwners(native)) && readyNative.masterCloseCalls === 0 &&
    readyNative.masterCloseReturned === false && readyNative.masterCloseError === 0 &&
    readyNative.masterFlagsBefore === -1 && readyNative.masterFlagsAfter === -1 && readyNative.masterStatValid === false &&
    ['masterStatDev', 'masterStatIno', 'masterStatRdev'].every(key => readyNative[key] === '0'),
  'all non-master owners settled before the only close begins');
  const driverReady = oneEvent(report.events, 'release-ready');
  const driverRequest = oneEvent(report.events, 'release-request');
  const driverAudit = oneEvent(report.events, 'release-audit');
  const driverReceipt = oneEvent(report.events, 'release-receipt');
  const closeRequest = oneEvent(report.events, 'master-close-request');
  fact([driverReady, driverRequest, driverAudit, driverReceipt, closeRequest].every(item => item.operationId === operationId) &&
    driverReady.ms === ready.ms && driverRequest.ms === driver.requestMs && driverAudit.ms === driver.audit.ms &&
    driverReceipt.ms === driver.receipt.ms && ready.ms <= driver.requestMs && driver.requestMs <= closeRequest.ms &&
    closeRequest.ms <= driver.audit.ms && driver.audit.ms <= driver.receipt.ms,
  'driver release request, close, audit and receipt remain ordered on its clock');
  fact(report.events.filter(item => ['source-end', 'final-state', 'parser-complete', 'exit-callback'].includes(item.name))
    .every(item => item.ms <= ready.ms) && report.events.some(item =>
      item.name === 'control-message' && item.type === 'written' && item.ms <= ready.ms),
  'release ready follows source, final state, callback and successful writer receipt');
  fact(equal(driver.audit.native, native) && equal(driver.receipt.native, native),
    'audit and receipt preserve the same final native close facts');
  const callerReady = oneEvent(caller.events, 'release-ready');
  const callerPermit = oneEvent(caller.events, 'release-permit');
  const callerRequest = oneEvent(caller.events, 'release-request');
  const callerAudit = oneEvent(caller.events, 'release-audit');
  const callerReceipt = oneEvent(caller.events, 'release-receipt');
  const callerFirst = oneEvent(caller.events, 'release-observation');
  const callerCurrent = oneEvent(caller.events, 'release-receipt-observed');
  fact([callerReady, callerPermit, callerRequest, callerAudit, callerReceipt, callerFirst, callerCurrent].every(identity),
    'caller release events keep the same token and operation');
  fact(finiteTime(consumer.r0) && consumer.deadlineMs === consumer.r0 + releaseBudgets.observation &&
    callerRequest.r0 === consumer.r0 && callerReady.ms === readyMessage.value.callerMs &&
    readyMessage.value.callerMs <= callerPermit.ms && callerPermit.ms <= consumer.r0 &&
    consumer.r0 === callerRequest.ms && callerRequest.ms <= consumer.audit.ms && consumer.audit.ms <= consumer.receipt.ms,
  'caller starts one pending release and a fixed local deadline');
  fact(consumer.audit?.value.type === 'release-audit' && identity(consumer.audit?.value) &&
    equal(consumer.audit?.value.snapshot, native) && equal(auditMessage.value.audit, consumer.audit?.value) &&
    finiteTime(consumer.audit?.ms) && callerAudit.ms === consumer.audit.ms &&
    consumer.audit.ms === auditMessage.value.callerMs,
  'independently received audit binds the actual close without replacing its receipt');
  fact(consumer.receipt?.value.type === 'release-receipt' && identity(consumer.receipt?.value) &&
    equal(consumer.receipt?.value.snapshot, native) && equal(receiptMessage.value.receipt, consumer.receipt?.value) &&
    finiteTime(consumer.receipt?.ms) && callerReceipt.ms === consumer.receipt.ms &&
    consumer.receipt.ms === receiptMessage.value.callerMs,
  'receipt consumption is separately timed and bound to the same close');
  const first = consumer.first;
  fact(equal(firstMessage.value.first, first) && equal(receiptMessage.value.first, first) &&
    finiteTime(first?.ms) && first.ms >= consumer.r0 && first.ms <= consumer.receipt.ms &&
    first.ms === firstMessage.value.callerMs && callerFirst.ms === first.ms &&
    callerFirst.disposition === first.disposition,
  'immutable first observation survives the later receipt');
  fact(consumer.current === 'released' && consumer.currentMs === consumer.receipt.ms &&
    receiptMessage.value.current === consumer.current && receiptMessage.value.currentMs === consumer.currentMs &&
    callerCurrent.current === consumer.current && callerCurrent.ms === consumer.currentMs,
  'current release proof comes from consuming the receipt');
  resource(native.masterCloseCalls === 1 && native.masterCloseReturned && native.masterCloseError === 0,
    'late proof never repeats or conceals a failed actual close');
  if (first.disposition === 'released') {
    fact(equal(first.receipt, consumer.receipt.value) && first.ms === consumer.receipt.ms,
      'first released observation contains its actual receipt');
  } else {
    fact(first.disposition === 'observation-unknown' && first.receipt === null && first.ms <= consumer.receipt.ms,
      'first unknown carries no audit or premature receipt');
  }
  const finalResult = oneEvent(caller.events, 'driver-result');
  const awaited = observation.messages.find(item => item.value.type === 'after-await');
  fact(callerFirst.ms <= finalResult.ms && callerCurrent.ms <= finalResult.ms &&
    firstMessage.ms <= receiptMessage.ms && receiptMessage.ms <= awaited.ms &&
    [readyMessage, auditMessage, firstMessage, receiptMessage].every(item => item.value.callerMs <= finalResult.ms &&
      observation.messages.indexOf(item) < observation.messages.indexOf(awaited)),
  'operation result follows all independently received release facts');
  const observerReceiptPermits = events(observation.events, 'receipt-permit');
  const callerReceiptPermits = events(caller.events, 'receipt-permit');
  const driverReceiptPermits = events(report.events, 'receipt-permit');
  if (config.scenario === 'U1-5') {
    const observerPermit = oneEvent(observation.events, 'receipt-permit');
    const forwardedPermit = oneEvent(caller.events, 'receipt-permit');
    const receivedPermit = oneEvent(report.events, 'receipt-permit');
    fact(identity(observerPermit) && identity(forwardedPermit) && receivedPermit.operationId === operationId &&
      driver.receiptPermitMs === receivedPermit.ms && driver.audit.ms <= receivedPermit.ms &&
      receivedPermit.ms <= driver.receipt.ms && firstMessage.ms <= observerPermit.ms &&
      observerPermit.ms <= receiptMessage.ms && first.ms <= forwardedPermit.ms &&
      forwardedPermit.ms <= consumer.receipt.ms,
    'held receipt is released only by the identified observer permit');
    scenario(consumer.audit.ms < consumer.deadlineMs, 'actual close audit arrives before the observation deadline');
    scenario(first.disposition === 'observation-unknown' && first.ms - consumer.r0 >= releaseBudgets.observation &&
      first.ms - consumer.r0 <= releaseBudgets.unknownObservation,
    'held path first reports unknown within the caller observation window');
    scenario(firstMessage.ms >= permit.ms && firstMessage.ms - permit.ms <= releaseBudgets.unknownObservation,
      'observer independently receives unknown within its own release window');
    scenario(observerPermit.ms - firstMessage.ms >= releaseBudgets.hold,
      'observer holds the received unknown for the full independent budget');
  } else {
    fact(observerReceiptPermits.length === 0 && callerReceiptPermits.length === 0 && driverReceiptPermits.length === 0 &&
      driver.receiptPermitMs === null, 'normal control uses no held receipt permission');
    scenario(first.disposition === 'released' && first.ms - consumer.r0 < releaseBudgets.observation,
      'normal control consumes its first release receipt before deadline');
  }
}

export function assessCase(config, observation, evidence) {
  const failures = [];
  const domains = { scenario: true, resource: true, evidence: true };
  let termination = null;
  const check = (domain, condition, reason) => {
    if (!condition) { domains[domain] = false; failures.push({ domain, reason }); }
    return Boolean(condition);
  };
  const fact = (condition, reason) => check('evidence', condition, reason);
  const resource = (condition, reason) => check('resource', condition, reason);
  const scenario = (condition, reason) => check('scenario', condition, reason);
  const result = () => ({ pass: domains.scenario && domains.resource && domains.evidence,
    scenarioMatches: domains.scenario, resourcesSettled: domains.resource, evidenceSufficient: domains.evidence,
    safeToContinue: domains.resource && domains.evidence, termination, failures });
  try {
    fact(['U1-0', 'U1-5'].includes(config.scenario) && /^[a-f0-9]{32}$/.test(config.token), 'configured scenario and identity');
    fact(config.fixtureScenario === 'U1-0' && config.nativeScenario === 'U1-0', 'explicit normal native and fixture mappings');
    fact(config.releaseOperationId === `${config.token}:master-close:1` && equal(config.releaseBudgets, releaseBudgets),
      'fixed release identity and observation budgets');
    fact(observation.token === config.token, 'observation identity');
    const messages = type => observation.messages.filter(item => item.value.type === type);
    const after = messages('after-await'), final = messages('caller-final');
    fact(after.length === 1 && final.length === 1, 'one real after-await and caller final required');
    const awaited = after[0], caller = final[0]?.value;
    fact(awaited?.value.token === config.token && caller?.token === config.token, 'caller identity');
    fact(finiteTime(awaited?.ms) && awaited.ms <= budgets.afterAwait && finiteTime(awaited?.value.callerMs) &&
      awaited.value.callerMs <= budgets.caller, 'after-await budgets');
    fact(awaited?.value.result?.kind === 'result', 'operation must return native report');
    resource(caller?.closed?.code === 0 && caller.closed.signal === null, 'direct driver exit and stdio close');
    fact(finiteTime(caller?.closed?.ms) && caller.closed.ms <= budgets.caller, 'driver close budget');
    resource(observation.callerExit?.code === 0 && observation.callerExit.signal === null &&
      observation.callerClose?.code === 0 && observation.callerClose.signal === null, 'direct caller exit and stdio close');
    fact(finiteTime(observation.callerClose?.ms) && observation.callerClose.ms <= budgets.observation, 'caller close budget');
    resource(caller?.exit?.code === 0 && caller.exit.signal === null, 'driver process exit separately observed');
    fact(caller?.stdout === '' && caller?.stderr === '', 'unexpected driver diagnostics');
    fact(!caller?.events.some(event => event.name.includes('deadline') || event.name === 'driver-control'), 'operation deadline/control');
    const resultEvent = caller?.events.find(event => event.name === 'driver-result');
    const awaitEvent = caller?.events.find(event => event.name === 'after-await');
    fact(finiteTime(resultEvent?.ms) && resultEvent.ms <= budgets.operation && finiteTime(awaitEvent?.ms) &&
      awaitEvent.ms >= resultEvent.ms, 'actual await continuation ordering');
    const bytes = JSON.stringify(observation, null, 2) + '\n';
    fact(finiteTime(evidence.receipt?.ms) && evidence.receipt.ms <= budgets.writer && finiteTime(evidence.close?.ms) &&
      evidence.close.ms <= budgets.writerObservation && evidence.close.code === 0 && evidence.close.signal === null &&
      evidence.error === null && evidence.receipt.value.bytes === Buffer.byteLength(bytes) && evidence.receipt.value.hash === hash(bytes),
    'separate evidence phase content and budgets');
    const report = awaited?.value.result?.report;
    const n = report?.native;
    if (!n) {
      fact(false, 'native raw facts missing'); resource(false, 'native owners unconfirmed');
      scenario(false, 'native scenario not established'); return result();
    }
    fact(report.token === config.token && report.scenario === config.scenario && n.token === config.token &&
      n.scenario === config.nativeScenario && report.nativeScenario === config.nativeScenario &&
      report.fixtureScenario === config.fixtureScenario, 'native and fixture identity');
    fact(report.loaded.path === config.binary && report.loaded.hash === config.binaryHash &&
      report.loaded.node === 'v22.23.2', 'loaded candidate identity');
    resource(report.error === null, 'driver error');
    const events = n.events;
    const named = name => events.filter(event => event.name === name);
    const one = name => { const found = named(name); fact(found.length === 1, `native event count: ${name}`); return found[0]; };
    const before = (first, second) => fact(named(first)[0]?.ord < named(second)[0]?.ord, `${first} before ${second}`);
    fact(!n.overflow && n.clockError === 0 && events.every((event, index) => event.ord === index + 1 &&
      /^\d+$/.test(event.monoNs) && BigInt(event.monoNs) > 0n &&
      (index === 0 || BigInt(event.monoNs) >= BigInt(events[index - 1].monoNs))), 'native ledger complete and ordered');
    const registered = one('owner-registered');
    fact(n.configured && n.forkAttempted && n.masterAcquired && Number.isInteger(n.pid) && n.pid > 0 &&
      Number.isInteger(n.master) && n.master >= 0 && registered?.value === n.pid && registered?.aux === n.master,
    'fork owners registered');
    const fork = one('fork-return');
    fact(fork?.value === n.pid && fork?.aux === n.master && fork?.error === 0, 'real fork returned owners');
    before('configured', 'fork-enter'); before('fork-enter', 'fork-return'); before('fork-return', 'owner-registered');
    const closeEnter = one('master-close-enter'), closeReturn = one('master-close-return');
    resource(n.masterCloseCalls === 1 && n.masterCloseReturned && n.masterCloseError === 0 &&
      closeEnter?.value === n.master && closeReturn?.value === 0 && closeReturn?.error === 0 && closeReturn?.aux === n.master,
    'owner master close returned once');
    before('owner-registered', 'master-close-enter'); before('master-close-enter', 'master-close-return');
    for (const name of ['master-fgetfl-before', 'master-fstat', 'master-fgetfl-after']) {
      const event = one(name);
      fact(event?.error === 0 && event?.aux === n.master, `read-only fd observation: ${name}`);
      before(name, 'master-close-enter');
    }
    fact(n.masterStatValid && n.masterFlagsBefore >= 0 && n.masterFlagsBefore === n.masterFlagsAfter,
      'stable flags and valid owned master before close');
    const enters = named('wait-enter'), waits = named('wait-return'), wait = waits.at(-1);
    let waitSequence = enters.length > 0 && enters.length === waits.length;
    for (const [index, returned] of waits.entries()) {
      const entered = enters[index];
      waitSequence = waitSequence && entered?.value === n.pid && entered.error === 0 && entered.aux === 0 &&
        entered.ord < returned.ord && (index === 0 || waits[index - 1].ord < entered.ord);
      if (index < waits.length - 1)
        waitSequence = waitSequence && returned.value === -1 && returned.error === 4 && returned.aux === 0;
    }
    resource(waitSequence && n.waitConfirmed && n.waitError === 0 &&
      wait?.value === n.pid && wait.error === 0, 'exclusive real wait returned own terminal child');
    if (waitSequence && n.waitConfirmed && n.waitError === 0 && wait?.value === n.pid && wait.error === 0)
      termination = terminalWaitStatus(wait.aux);
    resource(termination !== null, 'own wait status is a terminal result');
    if (termination) {
      const decoded = termination.kind === 'exited' ? { exitCode: termination.exitCode, signalCode: 0 } :
        { exitCode: 0, signalCode: termination.signalCode };
      fact(equal(decoded, { exitCode: n.exitCode, signalCode: n.signalCode }), 'raw wait status decode matches native facts');
      fact(equal(report.callback, decoded), 'raw wait status decode matches notification and callback');
      scenario(termination.kind !== 'exited' || ![124, 125].includes(termination.exitCode), 'fixture safety or control failure');
    }
    for (const [flag, event] of [['tsfnCreated', 'tsfn-create-return'], ['tsfnFinalized', 'tsfn-finalized']])
      resource(n[flag] === true && named(event).length === 1, `native owner fact: ${flag}`);
    for (const [field, event] of [['tsfnCreateStatus', 'tsfn-create-return'], ['tsfnReleaseStatus', 'tsfn-release-return']]) {
      const item = one(event);
      resource(n[field] === 0 && item?.value === 0, `native successful status: ${field}`);
    }
    one('tsfn-create-enter'); one('tsfn-release-enter'); one('tsfn-finalizer-enter');
    before('tsfn-create-enter', 'tsfn-create-return');
    before('tsfn-create-return', 'tsfn-release-enter');
    before('tsfn-release-enter', 'tsfn-release-return');
    before('tsfn-finalizer-enter', 'tsfn-finalized');
    resource(n.threadJoinError === 0 && n.threadJoinable === false, 'no join error or joinable thread remains');
    scenario(report.creationError === null && n.threadConstructCalled && n.threadConstructReturned &&
      !n.threadFailureInjected && !n.threadStartFailed && n.threadStartError === 0, 'one real thread construction succeeds');
    for (const name of ['thread-construction-enter', 'thread-construction-return']) one(name);
    before('tsfn-create-return', 'thread-construction-enter');
    before('thread-construction-enter', 'thread-construction-return');
    before('thread-construction-enter', 'thread-started');
    fact(named('thread-construction-return')[0]?.value === 0, 'thread constructor returned successfully');
    fact(report.pollWaitCalls === 0 && n.pollWaitCalls === 0 && !n.pollWaitStopped && !n.pollWaitInFlight &&
      n.pollWaitDisposition === 'not-started' && named('wait-poll-enter').length === 0 &&
      named('wait-poll-return').length === 0 && named('wait-poll-limit').length === 0 &&
      named('wait-poll-rejected').length === 0 &&
      report.events.every(event => !event.name.startsWith('poll-wait-')), 'same waiter has no polling fallback');
    for (const name of ['thread-construction-skipped', 'thread-start-error', 'thread-not-joinable'])
      fact(named(name).length === 0, `no alternate thread path: ${name}`);
    for (const [flag, event] of [['threadStarted', 'thread-started'], ['threadFinished', 'thread-finished'],
      ['threadJoined', 'thread-joined'], ['payloadAllocated', 'payload-allocated'], ['payloadFreed', 'payload-freed']])
      resource(n[flag] === true && named(event).length === 1, `native owner fact: ${flag}`);
    fact(named('notification-env-unavailable').length === 0, 'no actual unavailable environment');
    fact(n.notificationFailureInjected === false && n.notificationCallInvoked === true &&
      named('notification-call-skipped').length === 0, 'control uses real notification without injection');
    one('notification-enter');
    for (const [field, event] of [['notificationStatus', 'notification-return'], ['notificationCallbackStatus', 'notification-callback']]) {
      const item = one(event);
      resource(n[field] === 0 && item?.value === 0, `native successful status: ${field}`);
    }
    for (const [first, second] of [['payload-allocated', 'notification-enter'],
      ['notification-enter', 'notification-return'], ['notification-enter', 'notification-callback'],
      ['notification-callback', 'payload-freed'], ['notification-return', 'tsfn-release-enter']]) before(first, second);
    for (const [first, second] of [['thread-started', 'wait-enter'], ['payload-allocated', 'payload-freed'],
      ['tsfn-release-return', 'thread-finished'], ['thread-finished', 'thread-joined'],
      ['payload-freed', 'tsfn-finalized'], ['tsfn-finalizer-enter', 'thread-joined'],
      ['thread-joined', 'tsfn-finalized']]) before(first, second);
    fact(wait?.ord < named('payload-allocated')[0]?.ord, 'terminal wait return before payload allocation');
    resource(report.readPending === 0 && report.parserAccepted === report.parserCompleted, 'no owned operations pending');
    const raw = Buffer.from(report.rawBase64, 'base64');
    fact(raw.toString('base64') === report.rawBase64, 'canonical raw bytes');
    const jsNamed = name => report.events.filter(event => event.name === name);
    const callbacks = jsNamed('exit-callback');
    fact(callbacks.length === 1 && equal({ exitCode: callbacks[0]?.exitCode, signalCode: callbacks[0]?.signalCode },
      report.callback), 'one real JS exit callback agrees with terminal notification');
    fact(n.firstAttempt === null && report.firstWaitObservation === null &&
      report.initialNative?.firstAttempt === null && named('first-wait-unconfirmed').length === 0 &&
      jsNamed('initial-wait-result').length === 0 && messages('initial-wait-result').length === 0 &&
      caller.events.every(event => event.name !== 'initial-wait-result'),
    'both scenarios exclude earlier wait-failure injection and reports');
    let readPending = 0, parserPending = 0, readDelivered = 0, parserBytes = 0;
    for (const event of report.events) {
      if (event.name === 'read-enter') readPending++;
      if (event.name === 'read-return') { readPending--; if (event.error === null) readDelivered += event.count; }
      if (event.name === 'parser-enter') { parserPending++; parserBytes += event.bytes; }
      if (event.name === 'parser-complete') parserPending--;
      resource(readPending >= 0 && readPending <= 1 && parserPending >= 0 && parserPending <= 1, 'exclusive JS operation ordering');
      if (event.name === 'master-close-request') resource(readPending === 0 && parserPending === 0 &&
        event.readPending === 0 && event.parserPending === 0, 'close follows owned operations');
    }
    resource(readPending === 0 && parserPending === 0, 'all JS operations returned');
    fact(readDelivered === raw.length && parserBytes === raw.length && jsNamed('read-enter').length === report.readCalls &&
      jsNamed('parser-enter').length === report.parserAccepted && jsNamed('parser-complete').length === report.parserCompleted,
    'raw read/parser accounting');
    {
      scenario(!n.creationFailed && n.nonblockCalled && n.nonblockResult === 0 && n.nonblockError === 0 &&
        (n.masterFlagsBefore & fs.constants.O_NONBLOCK) !== 0 && named('nonblock-return')[0]?.value === 0,
      'normal path uses real nonblock');
      before('owner-registered', 'nonblock-enter'); before('nonblock-return', 'tsfn-create-enter');
      fact(n.controlCalls === 0 && !n.controlReturned && n.controlError === 0 && named('control-enter').length === 0 &&
        named('control-return').length === 0, 'normal path not terminated by control');
      scenario(termination?.kind === 'exited' && termination.exitCode === 7, 'normal fixture exit 7');
      scenario(report.source === 'linux-eio' && jsNamed('source-end').length === 1 &&
        jsNamed('read-return').at(-1)?.error === 'EIO', 'actual Linux source EIO');
      scenario(report.permissionSent && jsNamed('write-permission').length === 1, 'normal output permission');
      const ready = report.controlMessages.filter(message => message.type === 'ready');
      const written = report.controlMessages.filter(message => message.type === 'written');
      scenario(ready.length === 1 && ready[0].token === config.token && ready[0].pid === n.pid &&
        ready[0].stdinTTY && ready[0].stdoutTTY, 'private ready receipt');
      scenario(written.length === 1 && written[0].token === config.token && written[0].pid === n.pid &&
        written[0].bytes === config.expected.writtenBytes && written[0].hash === config.expected.writtenHash &&
        written[0].calls > 0 && written[0].intendedExitCode === 7, 'private writer completion');
      scenario(raw.length === config.expected.wireBytes && hash(raw) === config.expected.wireHash &&
        report.rawBase64 === config.expected.wireBase64, 'exact ONLCR terminal bytes');
      scenario(equal(report.state, config.expected.state) && report.state?.cursorX === 6 && report.state?.cursorY === 4,
        'complete terminal state and final cursor');
      fact(jsNamed('master-close-request').length === 1 && jsNamed('final-state')[0]?.ms >= jsNamed('source-end')[0]?.ms &&
        jsNamed('master-close-request')[0]?.ms >= jsNamed('final-state')[0]?.ms, 'final state before native master close');

    }
    assessRelease(config, observation, report, caller, n, { fact, resource, scenario });
  } catch (error) {
    fact(false, `malformed case facts: ${error.message}`);
    resource(false, 'resource assessment incomplete');
    scenario(false, 'scenario assessment incomplete');
  }
  return result();
}

export async function verifySaved(directory) {
  const failures = [], results = [];
  const schedule = read(path.join(directory, 'schedule.json'));
  assert.equal(schedule.schema, 'linux-native-failure-v6');
  assert.equal(schedule.platform, 'linux');
  assert.equal(schedule.versions.node, '22.23.2');
  assert.deepEqual(schedule.budgets, budgets);
  assert.deepEqual(schedule.releaseBudgets, releaseBudgets);
  assert.equal(schedule.binaryHash, '6e96a9dcd2a06b05cfe09d7bc98e6782838db3a326dd277ab47b0a60260f8217');
  assert.equal(hash(fs.readFileSync(schedule.binary)), schedule.binaryHash, 'candidate binary changed');
  const manifestBytes = fs.readFileSync(path.join(schedule.buildDirectory, 'manifest.json'));
  assert.equal(hash(manifestBytes), schedule.buildManifestHash, 'build manifest changed');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(hash(JSON.stringify(manifest.files)), manifest.sha256, 'build member list changed');
  for (const member of manifest.files) {
    assert(!path.isAbsolute(member.file) && !member.file.split(/[\\/]/).includes('..'), 'build member path');
    assert.equal(hash(fs.readFileSync(path.join(schedule.buildDirectory, member.file))), member.sha256, `build member: ${member.file}`);
  }
  const build = read(path.join(schedule.buildDirectory, 'build.json'));
  assert(manifest.files.some(member => member.file === 'build.json'), 'build record is a manifest member');
  assert.equal(build.status, 'built-and-load-verified');
  assert.equal(build.binary.path, schedule.binary);
  assert.equal(build.binary.sha256, schedule.binaryHash);
  assert(manifest.files.some(member => member.file === 'pty.node' && member.sha256 === schedule.binaryHash), 'binary is a build manifest member');
  const headless = require.resolve(path.join(schedule.dependencyRoot, '@xterm/headless'));
  const requiredSources = ['diagnose-native-failure-v6.mjs', 'native-failure-verifier-v6.mjs', 'native-failure-v6.test.mjs',
    'native-failure-roles-v6.mjs', 'diagnose-native-failure-v1.mjs', 'native-failure-verifier-v1.mjs',
    'build-native-failure-v4.mjs', 'unix-native-failure-patch-v4.mjs', 'unix-native-failure-support-v4.h',
    'native-notification-failure-patch-v4.test.mjs'].map(name => fileURLToPath(new URL(name, import.meta.url)));
  requiredSources.push(headless);
  assert.equal(new Set(schedule.sources.map(source => source.source)).size, schedule.sources.length);
  assert.equal(new Set(schedule.sources.map(source => source.snapshot)).size, schedule.sources.length);
  assert(requiredSources.every(source => schedule.sources.some(item => item.source === source)), 'required source identity missing');
  for (const source of schedule.sources) {
    assert.equal(source.snapshot, path.basename(source.snapshot), 'snapshot must be a direct member');
    if (hash(fs.readFileSync(path.join(directory, source.snapshot))) !== source.hash ||
      hash(fs.readFileSync(source.source)) !== source.hash) failures.push(`source identity: ${source.snapshot}`);
  }
  const buildTools = ['build-native-failure-v4.mjs', 'unix-native-failure-patch-v4.mjs', 'unix-native-failure-support-v4.h'];
  assert.deepEqual(build.sources.tools.map(source => source.name).sort(), [...buildTools].sort());
  for (const name of buildTools) {
    const built = build.sources.tools.find(source => source.name === name);
    const current = fileURLToPath(new URL(name, import.meta.url));
    const saved = schedule.sources.find(source => source.source === current);
    assert.equal(saved?.hash, built.sha256, `scheduled source matches build: ${name}`);
    assert.equal(hash(fs.readFileSync(current)), built.sha256, `current source matches build: ${name}`);
    assert.equal(hash(fs.readFileSync(path.join(directory, saved.snapshot))), built.sha256, `saved source matches build: ${name}`);
    assert(manifest.files.some(member => member.file === `inputs/${name}` && member.sha256 === built.sha256),
      `source input is a build manifest member: ${name}`);
  }
  const expectedEntries = [{ scenario: 'U1-0', attempt: 1 }, ...[1, 2, 3].map(attempt => ({ scenario: 'U1-5', attempt }))];
  assert.deepEqual(schedule.entries.map(({ scenario, attempt }) => ({ scenario, attempt })), expectedEntries);
  assert(schedule.entries.every(entry => /^[a-f0-9]{32}$/.test(entry.token)));
  assert.equal(new Set(schedule.entries.map(entry => entry.token)).size, 4);
  const { Terminal } = require(headless);
  const summary = read(path.join(directory, 'summary.json'));
  assert.equal(summary.length, 4);
  let admitted = true;
  for (const [index, entry] of schedule.entries.entries()) {
    if (!admitted) {
      const skipped = summary[index];
      assert.equal(skipped?.status, 'not-run', `unsafe continued admission: ${index}`);
      assert(typeof skipped.reason === 'string' && skipped.reason.length > 0, 'not-run reason');
      const expected = { ...entry, status: 'not-run', reason: skipped.reason };
      assert.deepEqual(skipped, expected);
      results.push(expected);
      continue;
    }
    const base = path.join(directory, `${entry.scenario}-${entry.attempt}`);
    const config = read(path.join(base, 'config.json'));
    for (const key of ['token', 'scenario', 'attempt']) assert.equal(config[key], entry[key]);
    assert.equal(config.fixtureScenario, 'U1-0');
    assert.equal(config.nativeScenario, 'U1-0');
    assert.equal(config.releaseOperationId, `${config.token}:master-close:1`);
    assert.deepEqual(config.releaseBudgets, releaseBudgets);
    assert.equal(config.binary, schedule.binary);
    assert.equal(config.binaryHash, schedule.binaryHash);
    assert.equal(config.buildDirectory, schedule.buildDirectory);
    assert.equal(config.buildManifestHash, schedule.buildManifestHash);
    assert.equal(config.dependencyRoot, schedule.dependencyRoot);
    const written = Buffer.from(`\x1b[2J\x1b[H${entry.token.repeat(64)}\r\nTAIL:${entry.token}\r\n\x1b[5;7H`);
    assert.deepEqual(fixtureBytes(entry.token), written);
    const wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
    const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
    try {
      await new Promise(resolve => terminal.write(wire, resolve));
      assert.deepEqual(config.expected, { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
        wireHash: hash(wire), wireBase64: wire.toString('base64'), state: terminalState(terminal) });
    } finally { terminal.dispose(); }
    const raw = fs.readFileSync(path.join(base, 'raw.json'));
    const evidence = read(path.join(base, 'evidence.json'));
    assert.equal(hash(raw), evidence.receipt?.value.hash);
    assert.equal(raw.length, evidence.receipt?.value.bytes);
    const assessed = assessCase(config, JSON.parse(raw), evidence);
    results.push({ ...entry, status: 'executed', ...assessed });
    if (!equal(results.at(-1), summary[index])) failures.push(`saved summary mismatch: ${index}`);
    if (!assessed.pass) failures.push(...assessed.failures.map(({ domain, reason }) => `${entry.scenario}-${entry.attempt} [${domain}]: ${reason}`));
    admitted = assessed.safeToContinue;
  }
  return { pass: failures.length === 0 && results.length === 4 && results.every(result => result.pass),
    executed: results.filter(result => result.status === 'executed').length,
    passed: results.filter(result => result.pass).length, failures, results };
}
