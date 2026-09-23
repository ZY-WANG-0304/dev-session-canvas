import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => { try { assert.deepEqual(left, right); return true; } catch { return false; } };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function assessCase(config, observation, evidence) {
  const failures = [];
  const check = (condition, reason) => { if (!condition) failures.push(reason); return Boolean(condition); };
  const messages = type => observation.messages.filter(item => item.value.type === type);
  const after = messages('after-await');
  const final = messages('caller-final');
  check(after.length === 1 && final.length === 1, 'one real after-await and caller final required');
  const awaited = after[0], caller = final[0]?.value;
  check(awaited?.value.token === config.token && caller?.token === config.token, 'caller identity');
  check(awaited?.ms <= 35000 && awaited?.value.callerMs <= 32000, 'after-await budgets');
  check(awaited?.value.result.kind === 'result', 'operation must return native report');
  const driverClosed = caller?.closed?.code === 0 && caller.closed.signal === null && caller.closed.ms <= 32000;
  check(driverClosed, 'direct driver exit and stdio close');
  const callerClosed = observation.callerExit?.code === 0 && observation.callerExit.signal === null &&
    observation.callerClose?.code === 0 && observation.callerClose.signal === null && observation.callerClose.ms <= 36000;
  check(callerClosed, 'direct caller exit and stdio close');
  check(caller?.exit?.code === 0 && caller.exit.signal === null, 'driver process exit separately observed');
  check(caller?.stdout === '' && caller?.stderr === '', 'unexpected driver diagnostics');
  check(!caller?.events.some(event => event.name.includes('deadline') || event.name === 'driver-control'), 'operation deadline/control');
  const resultEvent = caller?.events.find(event => event.name === 'driver-result');
  const awaitEvent = caller?.events.find(event => event.name === 'after-await');
  check(resultEvent?.ms <= 30000 && awaitEvent?.ms >= resultEvent?.ms, 'actual await continuation ordering');
  const bytes = JSON.stringify(observation, null, 2) + '\n';
  const saved = evidence.receipt?.ms <= 1000 && evidence.close?.ms <= 2000 &&
    evidence.close?.code === 0 && evidence.close.signal === null && evidence.error === null &&
    evidence.receipt.value.bytes === Buffer.byteLength(bytes) && evidence.receipt.value.hash === hash(bytes);
  check(saved, 'separate evidence phase content and budgets');
  const report = awaited?.value.result.report;
  const n = report?.native;
  if (!n) return { pass: false, safeToContinue: false, failures: [...failures, 'native raw facts missing'] };
  check(report.token === config.token && report.scenario === config.scenario && n.token === config.token &&
    n.scenario === config.scenario, 'native identity');
  check(report.loaded.path === config.binary && report.loaded.hash === config.binaryHash &&
    report.loaded.node === 'v22.23.2', 'loaded candidate identity');
  check(report.error === null, 'driver error');
  const events = n.events;
  const named = name => events.filter(event => event.name === name);
  const one = name => { const found = named(name); check(found.length === 1, `native event count: ${name}`); return found[0]; };
  const before = (first, second) => check(named(first)[0]?.ord < named(second)[0]?.ord, `${first} before ${second}`);
  check(!n.overflow && n.clockError === 0 && events.every((event, index) => event.ord === index + 1 &&
    /^\d+$/.test(event.monoNs) && BigInt(event.monoNs) > 0n &&
    (index === 0 || BigInt(event.monoNs) >= BigInt(events[index - 1].monoNs))), 'native ledger complete and ordered');
  const registered = one('owner-registered');
  check(n.configured && n.forkAttempted && n.masterAcquired && n.pid > 0 && n.master >= 0 &&
    registered?.value === n.pid && registered?.aux === n.master, 'fork owners registered');
  const fork = one('fork-return');
  check(fork?.value === n.pid && fork?.aux === n.master && fork?.error === 0, 'real fork returned owners');
  before('configured', 'fork-enter'); before('fork-enter', 'fork-return'); before('fork-return', 'owner-registered');
  const closeEnter = one('master-close-enter'), closeReturn = one('master-close-return');
  const nativeClose = n.masterCloseCalls === 1 && n.masterCloseReturned && n.masterCloseError === 0 &&
    closeEnter?.value === n.master && closeReturn?.value === 0 && closeReturn?.error === 0 && closeReturn?.aux === n.master;
  check(nativeClose, 'owner master close returned once');
  before('owner-registered', 'master-close-enter'); before('master-close-enter', 'master-close-return');
  for (const name of ['master-fgetfl-before', 'master-fstat', 'master-fgetfl-after']) {
    const event = one(name);
    check(event?.error === 0 && event?.aux === n.master, `read-only fd observation: ${name}`);
    before(name, 'master-close-enter');
  }
  check(n.masterStatValid && n.masterFlagsBefore >= 0 && n.masterFlagsBefore === n.masterFlagsAfter,
    'stable flags and valid owned master before close');
  const waitEvents = named('wait-return');
  const wait = waitEvents.at(-1);
  const rawStatus = wait?.aux;
  const waitValid = n.waitConfirmed && n.waitError === 0 && wait?.value === n.pid && wait.error === 0 &&
    Number.isInteger(rawStatus) && rawStatus >= 0 && waitEvents.length === named('wait-enter').length &&
    waitEvents.slice(0, -1).every(event => event.value === -1 && event.error === 4);
  check(waitValid, 'exclusive waitpid returned own child and raw status');
  check((rawStatus & 127) === n.signalCode && ((rawStatus & 127) === 0 ? (rawStatus >> 8) & 255 : 0) === n.exitCode,
    'raw wait status decode matches notification');
  let lifecycle = true;
  for (const [flag, event] of [['threadStarted', 'thread-started'], ['threadFinished', 'thread-finished'],
    ['threadJoined', 'thread-joined'], ['tsfnCreated', 'tsfn-create-return'], ['tsfnFinalized', 'tsfn-finalized'],
    ['payloadAllocated', 'payload-allocated'], ['payloadFreed', 'payload-freed']]) {
    lifecycle = check(n[flag] === true && named(event).length === 1, `native owner fact: ${flag}`) && lifecycle;
  }
  for (const [status, event] of [['tsfnCreateStatus', 'tsfn-create-return'], ['tsfnReleaseStatus', 'tsfn-release-return'],
    ['notificationStatus', 'notification-return'], ['notificationCallbackStatus', 'notification-callback']]) {
    const item = one(event);
    lifecycle = check(n[status] === 0 && item?.value === 0, `native successful status: ${status}`) && lifecycle;
  }
  check(n.threadJoinError === 0, 'thread join error');
  for (const [first, second] of [['tsfn-create-return', 'thread-started'], ['thread-started', 'wait-enter'],
    ['wait-return', 'payload-allocated'], ['payload-allocated', 'notification-enter'],
    ['notification-enter', 'notification-return'], ['payload-allocated', 'payload-freed'],
    ['notification-return', 'tsfn-release-enter'], ['tsfn-release-enter', 'tsfn-release-return'],
    ['tsfn-release-return', 'thread-finished'], ['thread-finished', 'thread-joined'],
    ['payload-freed', 'tsfn-finalized'], ['tsfn-finalizer-enter', 'thread-joined'], ['thread-joined', 'tsfn-finalized']]) before(first, second);
  check(equal(report.callback, { exitCode: n.exitCode, signalCode: n.signalCode }), 'JS callback agrees with raw wait');
  check(report.readPending === 0 && report.parserAccepted === report.parserCompleted, 'no owned operations pending');
  const raw = Buffer.from(report.rawBase64, 'base64');
  const jsNamed = name => report.events.filter(event => event.name === name);
  let readPending = 0, parserPending = 0, readDelivered = 0, parserBytes = 0;
  for (const event of report.events) {
    if (event.name === 'read-enter') readPending++;
    if (event.name === 'read-return') { readPending--; if (event.error === null) readDelivered += event.count; }
    if (event.name === 'parser-enter') { parserPending++; parserBytes += event.bytes; }
    if (event.name === 'parser-complete') parserPending--;
    check(readPending >= 0 && readPending <= 1 && parserPending >= 0 && parserPending <= 1, 'exclusive JS operation ordering');
    if (event.name === 'master-close-request') check(readPending === 0 && parserPending === 0 &&
      event.readPending === 0 && event.parserPending === 0, 'close follows owned operations');
  }
  check(readPending === 0 && parserPending === 0 && readDelivered === raw.length && parserBytes === raw.length &&
    jsNamed('read-enter').length === report.readCalls && jsNamed('parser-enter').length === report.parserAccepted &&
    jsNamed('parser-complete').length === report.parserCompleted, 'raw read/parser accounting');
  if (config.scenario === 'U1-0') {
    check(!n.creationFailed && n.nonblockCalled && n.nonblockResult === 0 && n.nonblockError === 0 &&
      (n.masterFlagsBefore & fs.constants.O_NONBLOCK) !== 0 && named('nonblock-return')[0]?.value === 0,
    'normal path uses real nonblock');
    before('owner-registered', 'nonblock-enter'); before('nonblock-return', 'tsfn-create-enter');
    check(n.controlCalls === 0 && named('control-enter').length === 0, 'normal path not terminated by control');
    check(n.exitCode === 7 && n.signalCode === 0 && rawStatus === 1792, 'normal fixture exit 7');
    check(report.source === 'linux-eio' && jsNamed('source-end').length === 1 &&
      jsNamed('read-return').at(-1)?.error === 'EIO', 'actual Linux source EIO');
    check(report.permissionSent && jsNamed('write-permission').length === 1, 'normal output permission');
    const ready = report.controlMessages.filter(message => message.type === 'ready');
    const written = report.controlMessages.filter(message => message.type === 'written');
    check(ready.length === 1 && ready[0].token === config.token && ready[0].pid === n.pid &&
      ready[0].stdinTTY && ready[0].stdoutTTY, 'private ready receipt');
    check(written.length === 1 && written[0].token === config.token && written[0].pid === n.pid &&
      written[0].bytes === config.expected.writtenBytes && written[0].hash === config.expected.writtenHash &&
      written[0].calls > 0 && written[0].intendedExitCode === 7, 'private writer completion');
    check(raw.length === config.expected.wireBytes && hash(raw) === config.expected.wireHash &&
      report.rawBase64 === config.expected.wireBase64, 'exact ONLCR terminal bytes');
    check(equal(report.state, config.expected.state) && report.state?.cursorX === 6 && report.state?.cursorY === 4,
      'complete terminal state and final cursor');
    check(jsNamed('master-close-request').length === 1 && jsNamed('final-state')[0]?.ms >= jsNamed('source-end')[0]?.ms &&
      jsNamed('master-close-request')[0]?.ms >= jsNamed('final-state')[0]?.ms, 'final state before native master close');
  } else {
    const skipped = one('nonblock-skipped');
    check(n.creationFailed && !n.nonblockCalled && n.nonblockResult === -1 && n.nonblockError === 5 &&
      skipped?.value === -1 && skipped?.error === 5 && named('nonblock-enter').length === 0 &&
      (n.masterFlagsBefore & fs.constants.O_NONBLOCK) === 0, 'synthetic EIO skips nonblock and preserves blocking fd');
    check(report.source === 'explicit-cancel/not-started' && report.readCalls === 0 &&
      report.parserAccepted === 0 && raw.length === 0 && report.state === null &&
      !report.permissionSent && report.controlMessages.every(message => message.type !== 'written'), 'cancel is not EOF or tail completion');
    const control = one('control-return');
    check(n.controlCalls === 1 && n.controlReturned && n.controlError === 0 && control?.value === 0 &&
      control?.error === 0 && control?.aux === 15, 'creator SIGTERM returned before waiter');
    before('owner-registered', 'nonblock-skipped'); before('nonblock-skipped', 'master-close-enter');
    before('master-close-return', 'control-enter'); before('control-enter', 'control-return');
    before('control-return', 'tsfn-create-enter');
    check(n.exitCode === 0 && [1, 15].includes(n.signalCode), 'partial fixture ended by hangup or requested termination');
  }
  const ownershipClear = driverClosed && callerClosed && nativeClose && waitValid && lifecycle &&
    n.threadJoinError === 0 && !n.overflow && n.clockError === 0 && report.error === null &&
    report.readPending === 0 && readPending === 0 && parserPending === 0 &&
    (config.scenario === 'U1-0' || n.controlReturned);
  const contentOnly = new Set(['normal fixture exit 7', 'actual Linux source EIO', 'normal output permission',
    'private ready receipt', 'private writer completion', 'exact ONLCR terminal bytes',
    'complete terminal state and final cursor']);
  return { pass: failures.length === 0,
    safeToContinue: Boolean(ownershipClear && saved && failures.every(reason => contentOnly.has(reason))), failures };
}

export async function verifySaved(directory) {
  const failures = [];
  const schedule = read(path.join(directory, 'schedule.json'));
  for (const source of schedule.sources) {
    if (hash(fs.readFileSync(path.join(directory, source.snapshot))) !== source.hash ||
      hash(fs.readFileSync(source.source)) !== source.hash) failures.push(`source identity: ${source.snapshot}`);
  }
  if (hash(fs.readFileSync(schedule.binary)) !== schedule.binaryHash) failures.push('candidate binary changed');
  const { fixtureBytes, terminalState } = await import('./diagnose-native-failure-v1.mjs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { Terminal } = require(path.join(schedule.dependencyRoot, '@xterm/headless'));
  const results = [];
  const summary = read(path.join(directory, 'summary.json'));
  let admitted = true;
  assert.equal(schedule.entries.length, 6);
  assert.equal(new Set(schedule.entries.map(entry => entry.token)).size, 6);
  for (const [index, entry] of schedule.entries.entries()) {
    assert.equal(entry.scenario, index < 3 ? 'U1-0' : 'U1-1');
    assert.equal(entry.attempt, index % 3 + 1);
    if (!admitted) {
      if (summary[index]?.status !== 'not-run') failures.push(`unsafe continued admission: ${index}`);
      results.push({ ...entry, status: 'not-run' });
      continue;
    }
    const base = path.join(directory, `${entry.scenario}-${entry.attempt}`);
    const config = read(path.join(base, 'config.json'));
    assert.equal(config.token, entry.token);
    assert.equal(config.scenario, entry.scenario);
    assert.equal(config.binaryHash, schedule.binaryHash);
    // Expected input is frozen before execution, then regenerated from the fixed contract.
    const written = Buffer.from(`\x1b[2J\x1b[H${entry.token.repeat(64)}\r\nTAIL:${entry.token}\r\n\x1b[5;7H`);
    assert.deepEqual(fixtureBytes(entry.token), written);
    const wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
    const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
    await new Promise(resolve => terminal.write(wire, resolve));
    assert.deepEqual(config.expected, { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
      wireHash: hash(wire), wireBase64: wire.toString('base64'), state: terminalState(terminal) });
    terminal.dispose();
    const rawBytes = fs.readFileSync(path.join(base, 'raw.json'));
    const evidence = read(path.join(base, 'evidence.json'));
    assert.equal(hash(rawBytes), evidence.receipt?.value.hash);
    const assessed = assessCase(config, JSON.parse(rawBytes), evidence);
    results.push({ ...entry, status: 'executed', ...assessed });
    if (!equal(results.at(-1), summary[index])) failures.push(`saved summary mismatch: ${index}`);
    if (!assessed.pass) failures.push(...assessed.failures.map(reason => `${entry.scenario}-${entry.attempt}: ${reason}`));
    admitted = assessed.safeToContinue;
  }
  return { pass: failures.length === 0 && results.length === 6 && results.every(result => result.pass),
    executed: results.filter(result => result.status === 'executed').length,
    passed: results.filter(result => result.pass).length, failures, results };
}
