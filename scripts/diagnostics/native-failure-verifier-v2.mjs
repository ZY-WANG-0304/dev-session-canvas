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
const binaryHash = 'aff95d1e0fa53e2cf124cc28f77637e0c0d9e9a1ceb5b2df7e30bbe6b40dec4d';
const require = createRequire(import.meta.url);

function terminalWaitStatus(status) {
  if (!Number.isInteger(status) || status < 0 || status > 65535) return null;
  const signal = status & 127;
  if (signal === 0) return { kind: 'exited', exitCode: (status >> 8) & 255, rawStatus: status };
  // Linux stopped/continued statuses are not a collected terminal result.
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
  const fact = (condition, reason) => check('evidence', condition, reason);
  const resource = (condition, reason) => check('resource', condition, reason);
  const scenario = (condition, reason) => check('scenario', condition, reason);
  const result = () => ({ pass: domains.scenario && domains.resource && domains.evidence,
    scenarioMatches: domains.scenario, resourcesSettled: domains.resource, evidenceSufficient: domains.evidence,
    safeToContinue: domains.resource && domains.evidence, termination, failures });
  try {
    fact(['U1-0', 'U1-1'].includes(config.scenario) && /^[a-f0-9]{32}$/.test(config.token), 'configured scenario and identity');
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
      n.scenario === config.scenario, 'native identity');
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
    const waits = named('wait-return'), wait = waits.at(-1), status = wait?.aux;
    const waitedOwn = n.waitConfirmed && n.waitError === 0 && wait?.value === n.pid && wait.error === 0 &&
      waits.length === named('wait-enter').length && waits.slice(0, -1).every(event => event.value === -1 && event.error === 4);
    resource(waitedOwn, 'exclusive waitpid returned own child');
    if (waitedOwn) termination = terminalWaitStatus(status);
    resource(termination !== null, 'own wait status is a terminal result');
    if (termination) {
      const decoded = termination.kind === 'exited' ? { exitCode: termination.exitCode, signalCode: 0 } :
        { exitCode: 0, signalCode: termination.signalCode };
      fact(equal(decoded, { exitCode: n.exitCode, signalCode: n.signalCode }) && equal(report.callback, decoded),
        'raw wait status decode matches notification and callback');
      scenario(termination.kind !== 'exited' || ![124, 125].includes(termination.exitCode), 'fixture safety or control failure');
    }
    for (const [flag, event] of [['threadStarted', 'thread-started'], ['threadFinished', 'thread-finished'],
      ['threadJoined', 'thread-joined'], ['tsfnCreated', 'tsfn-create-return'], ['tsfnFinalized', 'tsfn-finalized'],
      ['payloadAllocated', 'payload-allocated'], ['payloadFreed', 'payload-freed']]) {
      resource(n[flag] === true && named(event).length === 1, `native owner fact: ${flag}`);
    }
    for (const [field, event] of [['tsfnCreateStatus', 'tsfn-create-return'], ['tsfnReleaseStatus', 'tsfn-release-return'],
      ['notificationStatus', 'notification-return'], ['notificationCallbackStatus', 'notification-callback']]) {
      const item = one(event);
      resource(n[field] === 0 && item?.value === 0, `native successful status: ${field}`);
    }
    resource(n.threadJoinError === 0, 'thread join error');
    for (const [first, second] of [['tsfn-create-return', 'thread-started'], ['thread-started', 'wait-enter'],
      ['payload-allocated', 'notification-enter'], ['notification-enter', 'notification-return'],
      ['payload-allocated', 'payload-freed'], ['notification-return', 'tsfn-release-enter'],
      ['tsfn-release-enter', 'tsfn-release-return'], ['tsfn-release-return', 'thread-finished'],
      ['thread-finished', 'thread-joined'], ['payload-freed', 'tsfn-finalized'],
      ['tsfn-finalizer-enter', 'thread-joined'], ['thread-joined', 'tsfn-finalized']]) before(first, second);
    fact(wait?.ord < named('payload-allocated')[0]?.ord, 'terminal wait return before payload allocation');
    resource(report.readPending === 0 && report.parserAccepted === report.parserCompleted, 'no owned operations pending');
    const raw = Buffer.from(report.rawBase64, 'base64');
    fact(raw.toString('base64') === report.rawBase64, 'canonical raw bytes');
    const jsNamed = name => report.events.filter(event => event.name === name);
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
    if (config.scenario === 'U1-0') {
      scenario(!n.creationFailed && n.nonblockCalled && n.nonblockResult === 0 && n.nonblockError === 0 &&
        (n.masterFlagsBefore & fs.constants.O_NONBLOCK) !== 0 && named('nonblock-return')[0]?.value === 0,
      'normal path uses real nonblock');
      before('owner-registered', 'nonblock-enter'); before('nonblock-return', 'tsfn-create-enter');
      scenario(n.controlCalls === 0 && named('control-enter').length === 0, 'normal path not terminated by control');
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
    } else if (config.scenario === 'U1-1') {
      const skipped = one('nonblock-skipped');
      scenario(n.creationFailed && !n.nonblockCalled && n.nonblockResult === -1 && n.nonblockError === 5 &&
        skipped?.value === -1 && skipped?.error === 5 && named('nonblock-enter').length === 0 &&
        (n.masterFlagsBefore & fs.constants.O_NONBLOCK) === 0, 'synthetic EIO skips nonblock and preserves blocking fd');
      scenario(report.source === 'explicit-cancel/not-started' && report.readCalls === 0 && report.parserAccepted === 0 &&
        raw.length === 0 && report.state === null && !report.permissionSent && jsNamed('write-permission').length === 0 &&
        report.controlMessages.every(message => message.type !== 'written'), 'cancel is not EOF or tail completion');
      const controlEnter = one('control-enter'), control = one('control-return');
      resource(n.controlCalls === 1 && n.controlReturned && n.controlError === 0 && control?.value === 0 &&
        control?.error === 0 && control?.aux === 15 && controlEnter?.value === n.pid && controlEnter?.aux === 15,
      'creator SIGTERM returned before waiter');
      before('owner-registered', 'nonblock-skipped'); before('nonblock-skipped', 'master-close-enter');
      before('master-close-return', 'control-enter'); before('control-enter', 'control-return');
      before('control-return', 'tsfn-create-enter');
    }
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
  assert.equal(schedule.schema, 'linux-native-failure-v2');
  assert.equal(schedule.platform, 'linux');
  assert.equal(schedule.versions.node, '22.23.2');
  assert.deepEqual(schedule.budgets, budgets);
  assert.equal(schedule.binaryHash, binaryHash);
  assert.equal(hash(fs.readFileSync(schedule.binary)), binaryHash, 'candidate binary changed');
  const headless = require.resolve(path.join(schedule.dependencyRoot, '@xterm/headless'));
  const requiredSources = ['diagnose-native-failure-v2.mjs', 'native-failure-verifier-v2.mjs',
    'diagnose-native-failure-v1.mjs', 'native-failure-verifier-v1.mjs'].map(name => fileURLToPath(new URL(name, import.meta.url)));
  requiredSources.push(headless);
  assert.equal(new Set(schedule.sources.map(source => source.source)).size, schedule.sources.length);
  assert.equal(new Set(schedule.sources.map(source => source.snapshot)).size, schedule.sources.length);
  assert(requiredSources.every(source => schedule.sources.some(item => item.source === source)), 'required source identity missing');
  for (const source of schedule.sources) {
    assert.equal(source.snapshot, path.basename(source.snapshot), 'snapshot must be a direct member');
    if (hash(fs.readFileSync(path.join(directory, source.snapshot))) !== source.hash ||
      hash(fs.readFileSync(source.source)) !== source.hash) failures.push(`source identity: ${source.snapshot}`);
  }
  const expectedEntries = [{ scenario: 'U1-0', attempt: 1 }, ...[1, 2, 3].map(attempt => ({ scenario: 'U1-1', attempt }))];
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
    assert.equal(config.binary, schedule.binary);
    assert.equal(config.binaryHash, schedule.binaryHash);
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
