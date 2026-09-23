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

function terminalWaitStatus(status) {
  if (!Number.isInteger(status) || status < 0 || status > 65535) return null;
  const signal = status & 127;
  if (signal === 0) return { kind: 'exited', exitCode: (status >> 8) & 255, rawStatus: status };
  // Darwin stopped/continued statuses are not a collected terminal result.
  if (signal <= 31 && status <= 255)
    return { kind: 'signaled', signalCode: signal, coreDumped: (status & 128) !== 0, rawStatus: status };
  return null;
}

function assessDarwinOwners(config, report, n, { fact, resource, scenario }) {
  const named = name => n.events.filter(event => event.name === name);
  const one = name => {
    const found = named(name);
    fact(found.length === 1, `one Darwin event: ${name}`);
    return found[0];
  };
  const before = (a, b) => fact(named(a).at(-1)?.ord < named(b)[0]?.ord, `${a} before ${b}`);
  const call = name => {
    const enters = named(`${name}-enter`), returns = named(`${name}-return`);
    fact(enters.length > 0 && enters.length === returns.length && returns.every((item, index) =>
      enters[index].ord < item.ord && (index === 0 || returns[index - 1].ord < enters[index].ord) &&
      (index === returns.length - 1 || item.value === -1 && item.error === 4)), `real ${name} sequence retries only EINTR`);
    return returns.at(-1);
  };
  const ids = n.resources.map(item => item.id);
  fact(new Set(ids).size === ids.length && ['spawn-actions', 'spawn-attrs', 'slave', 'low-fd-0'].every(id => ids.includes(id)) &&
    ids.every(id => ['spawn-actions', 'spawn-attrs', 'slave', 'low-fd-0', 'low-fd-1', 'low-fd-2'].includes(id)),
  'all actual spawn temporary owners have distinct known identities');
  for (const owner of n.resources) {
    const acquired = one(`${owner.id}-acquire-return`), acquireEnter = one(`${owner.id}-acquire-enter`);
    const released = one(`${owner.id}-release-return`), releaseEnter = one(`${owner.id}-release-enter`);
    fact(owner.acquired === true && acquired?.value === owner.value && acquired?.error === 0 &&
      acquireEnter?.ord < acquired?.ord && acquired?.ord < releaseEnter?.ord,
    `temporary owner acquired before release: ${owner.id}`);
    resource(owner.releaseCalls === 1 && owner.releaseReturned === true && owner.releaseResult === 0 &&
      owner.releaseError === 0 && releaseEnter?.value === owner.value && released?.value === 0 &&
      released?.error === 0 && released?.aux === owner.value && releaseEnter?.ord < released?.ord,
    `temporary owner released once: ${owner.id}`);
    fact(released?.ord < named('nonblock-enter')[0]?.ord, `spawn temporary owner settled before nonblock: ${owner.id}`);
  }
  const created = call('kqueue'), registerEnter = named('kqueue-register-enter')[0], registered = call('kqueue-register');
  const waited = call('kqueue-wait'), waitEnter = named('kqueue-wait-enter')[0], exit = one('kqueue-exit-event');
  const closeEnter = one('kqueue-close-enter'), closed = one('kqueue-close-return');
  fact(n.kqueueAcquired === true && Number.isInteger(n.kqueueFd) && n.kqueueFd >= 0 &&
    created?.value === n.kqueueFd && created?.error === 0, 'real owned kqueue acquired');
  scenario(n.kqueueRegistered === true && registerEnter?.value === n.kqueueFd && registerEnter?.aux === n.pid &&
    registered?.value === 0 && registered?.error === 0 && registered?.aux === n.kqueueFd,
  'real process exit filter registered successfully');
  scenario(n.kqueueWaitReturned === true && waitEnter?.value === n.kqueueFd && waited?.value === 1 &&
    waited?.error === 0 && waited?.aux === n.kqueueFd && exit?.value === n.pid &&
    n.kqueueExitEventValid === true && n.kqueueExitEvent.ident === n.pid && n.procFilter === -5 &&
    n.noteExitMask === 0x80000000 && n.eventErrorMask === 0x4000 && n.kqueueExitEvent.filter === n.procFilter &&
    exit?.error === n.kqueueExitEvent.flags && exit?.aux === n.kqueueExitEvent.fflags &&
    (n.kqueueExitEvent.flags & n.eventErrorMask) === 0 && (n.kqueueExitEvent.fflags & n.noteExitMask) !== 0,
  'real kevent identifies the owned process exit without EV_ERROR');
  resource(n.kqueueCloseCalls === 1 && n.kqueueCloseReturned === true && n.kqueueCloseError === 0 &&
    closeEnter?.value === n.kqueueFd && closed?.value === 0 && closed?.error === 0 && closed?.aux === n.kqueueFd,
  'owned kqueue closed once after its users return');
  for (const [a, b] of [['thread-started', 'kqueue-enter'],
    ['kqueue-return', 'kqueue-register-enter'], ['kqueue-register-return', 'kqueue-wait-enter'],
    ['kqueue-wait-return', 'kqueue-exit-event'], ['kqueue-exit-event', 'wait-enter'],
    ['wait-return', 'kqueue-close-enter'], ['kqueue-close-enter', 'kqueue-close-return'],
    ['kqueue-close-return', 'thread-finished']]) before(a, b);
  const gate = report.writeGate, gateNative = gate?.native;
  const gateEvents = report.events.filter(event => event.name === 'write-gate-ready');
  const permission = report.events.filter(event => event.name === 'write-permission');
  const ready = report.controlMessages.filter(message => message.type === 'ready');
  fact(gateEvents.length === 1 && permission.length === 1 && equal(gateEvents[0]?.gate, gate) &&
    equal(gate?.ready, ready[0]) && gateNative?.token === config.token && gateNative?.platform === 'darwin' &&
    gateNative?.pid === n.pid && gateNative?.master === n.master && gateNative?.kqueueFd === n.kqueueFd &&
    gateNative?.kqueueRegistered === true && equal(gateNative?.events, n.events.slice(0, gateNative?.events.length)) &&
    gateNative.events.some(event => event.name === 'kqueue-register-return' && event.value === 0 && event.error === 0) &&
    finiteTime(gateEvents[0]?.ms) && permission[0].ms >= gateEvents[0].ms,
  'output permission follows the same ready identity and actual registered kqueue snapshot');
  const beforeClose = report.beforeCloseNative;
  const closeNames = ['master-fgetfl-before', 'master-fstat', 'master-fgetfl-after', 'master-close-enter', 'master-close-return'];
  const closeFields = ['events', 'masterCloseCalls', 'masterCloseReturned', 'masterCloseError', 'masterFlagsBefore',
    'masterFlagsAfter', 'masterStatValid', 'masterStatDev', 'masterStatIno', 'masterStatRdev'];
  const stable = value => Object.fromEntries(Object.entries(value).filter(([key]) => !closeFields.includes(key)));
  fact(equal(n.events.slice(-5).map(event => event.name), closeNames) &&
    equal(beforeClose?.events, n.events.slice(0, -5)) && equal(stable(beforeClose), stable(n)) &&
    beforeClose.masterCloseCalls === 0 && beforeClose.masterCloseReturned === false &&
    beforeClose.masterCloseError === 0 && beforeClose.masterFlagsBefore === -1 && beforeClose.masterFlagsAfter === -1 &&
    beforeClose.masterStatValid === false,
  'all non-master owners are settled before the single final master close');
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
    fact(config.platform === 'darwin' && config.scenario === 'U1-0' && /^[a-f0-9]{32}$/.test(config.token), 'configured scenario and identity');
    fact(config.fixtureScenario === 'U1-0', 'explicit normal fixture mapping');
    fact(Number.isInteger(config.constants?.O_NONBLOCK) && config.constants.O_NONBLOCK > 0, 'saved Darwin nonblock constant');
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
      n.scenario === config.scenario && report.fixtureScenario === config.fixtureScenario, 'native and fixture identity');
    fact(report.loaded.path === config.binary && report.loaded.hash === config.binaryHash &&
      report.loaded.node === 'v22.23.2', 'loaded candidate identity');
    fact(report.loaded.platform === 'darwin' && n.platform === 'darwin' &&
      report.loaded.helper === config.helper && report.loaded.helperHash === config.helperHash &&
      report.loaded.executablePath === config.executablePath && n.helperPath === config.helper &&
      n.executablePath === config.executablePath && n.nonblockMask === config.constants.O_NONBLOCK,
    'actual Darwin helper and executable identities');
    resource(report.error === null, 'driver error');
    fact([...(observation.events ?? []), ...caller.events, ...report.events].every(event =>
      !event.name.includes('protocol-error') && !event.name.includes('send-error') &&
      !['caller-error', 'driver-error', 'control-error', 'caller-control', 'caller-stdout', 'caller-stderr',
        'observation-deadline'].includes(event.name)), 'diagnostic errors are not cleared by later success');
    const events = n.events;
    const named = name => events.filter(event => event.name === name);
    const one = name => { const found = named(name); fact(found.length === 1, `native event count: ${name}`); return found[0]; };
    const before = (first, second) => fact(named(first)[0]?.ord < named(second)[0]?.ord, `${first} before ${second}`);
    fact(!n.overflow && n.clockError === 0 && events.every((event, index) => event.ord === index + 1 &&
      /^\d+$/.test(event.monoNs) && BigInt(event.monoNs) > 0n &&
      (index === 0 || BigInt(event.monoNs) >= BigInt(events[index - 1].monoNs))), 'native ledger complete and ordered');
    const registered = one('owner-registered');
    fact(n.configured && n.spawnAttempted && n.masterAcquired && Number.isInteger(n.pid) && n.pid > 0 &&
      Number.isInteger(n.master) && n.master >= 0 && registered?.value === n.pid && registered?.aux === n.master,
    'spawn owners registered');
    const masterOpenEnter = one('master-open-enter'), masterOpened = one('master-open-return');
    fact(masterOpenEnter?.ord < masterOpened?.ord && masterOpened?.value === n.master &&
      masterOpened?.error === 0, 'real posix_openpt acquired the registered master');
    before('configured', 'master-open-enter'); before('master-open-return', 'spawn-enter');
    const spawnEnters = named('spawn-enter'), spawnReturns = named('spawn-return'), spawned = spawnReturns.at(-1);
    fact(spawnEnters.length > 0 && spawnEnters.length === spawnReturns.length && spawnReturns.every((item, index) =>
      spawnEnters[index].ord < item.ord && (index === 0 || spawnReturns[index - 1].ord < spawnEnters[index].ord) &&
      (index === spawnReturns.length - 1 || item.value === 4 && item.error === 4 && item.aux === -1)) &&
      spawned?.value === 0 && spawned?.aux === n.pid && spawned?.error === 0, 'real posix_spawn returned the owned child');
    before('configured', 'spawn-enter');
    fact(spawned?.ord < registered?.ord, 'successful spawn return before owner registration');
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
    fact(events.every(event => !event.name.startsWith('wait-poll-') && !event.name.startsWith('control-') &&
      !event.name.includes('skipped') && event.name !== 'first-wait-unconfirmed'),
    'normal Darwin baseline has no alternate waiter, process control or injection');
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
        (n.masterFlagsBefore & config.constants.O_NONBLOCK) !== 0 && named('nonblock-return')[0]?.value === 0,
      'normal path uses real nonblock');
      before('owner-registered', 'nonblock-enter'); before('nonblock-return', 'tsfn-create-enter');
      scenario(termination?.kind === 'exited' && termination.exitCode === 7, 'normal fixture exit 7');
      scenario(report.source === 'darwin-read-zero' && jsNamed('source-end').length === 1 &&
        jsNamed('read-return').at(-1)?.error === null && jsNamed('read-return').at(-1)?.count === 0,
      'actual Darwin read returns zero without an error');
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
    assessDarwinOwners(config, report, n, { fact, resource, scenario });
  } catch (error) {
    fact(false, `malformed case facts: ${error.message}`);
    resource(false, 'resource assessment incomplete');
    scenario(false, 'scenario assessment incomplete');
  }
  return result();
}

export async function verifySaved(directory, { buildDirectory, dependencyRoot } = {}) {
  const failures = [], results = [];
  const schedule = read(path.join(directory, 'schedule.json'));
  assert.equal(schedule.schema, 'macos-native-baseline-v1');
  assert.equal(schedule.platform, 'darwin');
  assert.equal(schedule.versions.node, '22.23.2');
  assert.deepEqual(schedule.budgets, budgets);
  assert(Number.isInteger(schedule.constants?.O_NONBLOCK) && schedule.constants.O_NONBLOCK > 0);
  const buildRoot = path.resolve(buildDirectory ?? schedule.buildDirectory);
  const deps = path.resolve(dependencyRoot ?? schedule.dependencyRoot);
  const manifestBytes = fs.readFileSync(path.join(buildRoot, 'manifest.json'));
  assert.equal(hash(manifestBytes), schedule.buildManifestHash, 'build manifest changed');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(hash(JSON.stringify(manifest.files)), manifest.sha256, 'build member list changed');
  for (const member of manifest.files) {
    assert(!path.isAbsolute(member.file) && !member.file.split(/[\\/]/).includes('..'), 'build member path');
    assert.equal(hash(fs.readFileSync(path.join(buildRoot, member.file))), member.sha256, `build member: ${member.file}`);
  }
  const build = read(path.join(buildRoot, 'build.json'));
  assert(manifest.files.some(member => member.file === 'build.json'), 'build record is a manifest member');
  assert.equal(build.status, 'built-and-load-verified');
  assert.equal(build.platform, 'darwin');
  assert.equal(build.binary.path, schedule.binary);
  assert.equal(build.binary.sha256, schedule.binaryHash);
  assert.equal(build.helper.path, schedule.helper);
  assert.equal(build.helper.sha256, schedule.helperHash);
  assert(Number.isInteger(build.helper.mode) && (build.helper.mode & 0o111) !== 0, 'built helper is executable');
  for (const [name, expected] of [['pty.node', schedule.binaryHash], ['spawn-helper', schedule.helperHash]]) {
    assert.equal(hash(fs.readFileSync(path.join(buildRoot, name))), expected, `saved Darwin binary: ${name}`);
    assert(manifest.files.some(member => member.file === name && member.sha256 === expected), `binary manifest identity: ${name}`);
  }
  const headless = require.resolve(path.join(deps, '@xterm/headless'));
  const names = ['diagnose-macos-native-baseline-v1.mjs', 'macos-native-baseline-roles-v1.mjs',
    'macos-native-baseline-verifier-v1.mjs', 'macos-native-baseline-v1.test.mjs',
    'build-macos-native-baseline-v1.mjs', 'macos-native-baseline-patch-v1.mjs', 'macos-native-baseline-support-v1.h',
    'macos-native-baseline-patch-v1.test.mjs', 'diagnose-native-failure-v1.mjs', 'native-failure-verifier-v1.mjs'];
  const trusted = new Map(names.map(name => [name, fileURLToPath(new URL(name, import.meta.url))]));
  trusted.set(path.basename(headless), headless);
  assert.equal(new Set(schedule.sources.map(source => source.source)).size, schedule.sources.length);
  assert.equal(new Set(schedule.sources.map(source => source.snapshot)).size, schedule.sources.length);
  assert.deepEqual(schedule.sources.map(source => source.snapshot).sort(), [...trusted.keys()].sort());
  for (const source of schedule.sources) {
    assert.equal(source.snapshot, path.basename(source.snapshot), 'snapshot must be a direct member');
    assert.equal(path.basename(source.source), source.snapshot, 'source basename binds its snapshot');
    if (hash(fs.readFileSync(path.join(directory, source.snapshot))) !== source.hash ||
      hash(fs.readFileSync(trusted.get(source.snapshot))) !== source.hash) failures.push(`source identity: ${source.snapshot}`);
  }
  const buildTools = ['build-macos-native-baseline-v1.mjs', 'macos-native-baseline-patch-v1.mjs', 'macos-native-baseline-support-v1.h'];
  assert.deepEqual(build.sources.tools.map(source => source.name).sort(), [...buildTools].sort());
  for (const name of buildTools) {
    const built = build.sources.tools.find(source => source.name === name);
    const saved = schedule.sources.find(source => source.snapshot === name);
    assert.equal(saved.hash, built.sha256, `scheduled source matches build: ${name}`);
    assert.equal(hash(fs.readFileSync(trusted.get(name))), built.sha256, `current source matches build: ${name}`);
    assert(manifest.files.some(member => member.file === `inputs/${name}` && member.sha256 === built.sha256),
      `source input is a build manifest member: ${name}`);
  }
  assert.deepEqual(schedule.entries.map(({ scenario, attempt }) => ({ scenario, attempt })),
    [1, 2, 3].map(attempt => ({ scenario: 'U1-0', attempt })));
  assert(schedule.entries.every(entry => /^[a-f0-9]{32}$/.test(entry.token)));
  assert.equal(new Set(schedule.entries.map(entry => entry.token)).size, 3);
  const { Terminal } = require(headless);
  const summary = read(path.join(directory, 'summary.json'));
  assert.equal(summary.length, 3);
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
    for (const key of ['binary', 'binaryHash', 'helper', 'helperHash', 'executablePath', 'platform',
      'buildDirectory', 'buildManifestHash', 'dependencyRoot']) assert.equal(config[key], schedule[key], `saved config: ${key}`);
    assert.deepEqual(config.constants, schedule.constants);
    assert.equal(config.fixtureScenario, 'U1-0');
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
  return { pass: failures.length === 0 && results.length === 3 && results.every(result => result.pass),
    executed: results.filter(result => result.status === 'executed').length,
    passed: results.filter(result => result.pass).length, failures, results };
}
