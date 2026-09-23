// Linux U1-0/U1-5 roles; native v4, fixture and writer remain frozen.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { budgets, terminalState } from './diagnose-native-failure-v1.mjs';

const script = fileURLToPath(import.meta.url);
const fixtureScript = fileURLToPath(new URL('./diagnose-native-failure-v1.mjs', import.meta.url));
const require = createRequire(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = message => new Promise((resolve, reject) => process.send(message,
  error => error ? reject(error) : resolve()));
const errorFact = error => ({ name: error.name, message: error.message, code: error.code ?? null });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function validateConfig(config) {
  assert(['U1-0', 'U1-5'].includes(config.scenario));
  assert.equal(config.nativeScenario, 'U1-0');
  assert.equal(config.fixtureScenario, 'U1-0');
  assert.equal(config.releaseOperationId, `${config.token}:master-close:1`);
  assert.deepEqual(config.releaseBudgets, { observation: 100, unknownObservation: 1000, hold: 100 });
}

function closeSucceeded(snapshot) {
  const entered = snapshot?.events?.filter(event => event.name === 'master-close-enter') ?? [];
  const returned = snapshot?.events?.filter(event => event.name === 'master-close-return') ?? [];
  return snapshot?.masterAcquired === true && snapshot.masterCloseCalls === 1
    && snapshot.masterCloseReturned === true && snapshot.masterCloseError === 0
    && entered.length === 1 && returned.length === 1 && entered[0].value === snapshot.master
    && returned[0].value === 0 && returned[0].error === 0 && returned[0].aux === snapshot.master
    && entered[0].ord < returned[0].ord;
}

async function driver(config) {
  validateConfig(config);
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const operationId = config.releaseOperationId;
  const report = { token: config.token, scenario: config.scenario, nativeScenario: config.nativeScenario,
    events: [], controlMessages: [],
    loaded: { path: config.binary, hash: hash(fs.readFileSync(config.binary)), node: process.version },
    readCalls: 0, readPending: 0, parserAccepted: 0, parserCompleted: 0, permissionSent: false,
    source: null, native: null, state: null, callback: null, rawBase64: '', error: null,
    creationError: null, pollWaitCalls: 0, fixtureScenario: config.fixtureScenario, firstWaitObservation: null,
    release: { operationId, ready: null, requestMs: null, audit: null, receipt: null, receiptPermitMs: null } };
  const mark = (name, detail = {}) => {
    const ms = elapsed();
    report.events.push({ name, ms, ...detail });
    return ms;
  };
  const bytes = [];
  const sockets = new Set();
  let terminal, native, child, failure = null;
  const fail = error => { failure ??= error; };
  const guard = (allowFailure = false) => {
    if (failure && !allowFailure) throw failure;
    if (elapsed() >= 29000) throw new Error('Driver operation remains unconfirmed after 29 seconds');
  };
  const waitFor = async (predicate, allowFailure = false) => {
    for (;;) {
      guard(allowFailure);
      if (predicate()) return;
      await sleep(2);
    }
  };
  const sendChecked = async (message, allowFailure = false) => {
    let completed = false, error = null;
    send(message).then(() => { completed = true; }, reason => { error = reason; completed = true; });
    await waitFor(() => completed, allowFailure);
    if (error) throw error;
  };
  const onMessage = message => {
    try {
      assert.equal(message?.token, config.token);
      assert.equal(message.operationId, operationId);
      if (message.type === 'release-request') {
        assert(report.release.ready, 'Release requested before readiness');
        assert.equal(report.release.requestMs, null, 'Duplicate release request');
        report.release.requestMs = mark('release-request', { operationId });
      } else if (message.type === 'receipt-permit') {
        assert.equal(config.scenario, 'U1-5');
        assert(report.release.audit, 'Receipt permitted before actual close audit');
        assert.equal(report.release.receiptPermitMs, null, 'Duplicate receipt permit');
        assert.equal(report.release.receipt, null, 'Receipt already sent');
        report.release.receiptPermitMs = mark('receipt-permit', { operationId });
      } else throw new Error(`Unexpected driver message: ${message.type}`);
    } catch (error) { mark('protocol-error', errorFact(error)); fail(error); }
  };
  const onDisconnect = () => fail(new Error('Caller disconnected before driver settlement'));
  process.on('message', onMessage);
  process.on('disconnect', onDisconnect);
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', error => { mark('control-error', errorFact(error)); fail(error); });
    let pending = '';
    socket.on('data', data => {
      try {
        pending += data;
        for (let end; (end = pending.indexOf('\n')) >= 0;) {
          const message = JSON.parse(pending.slice(0, end));
          pending = pending.slice(end + 1);
          report.controlMessages.push(message);
          mark('control-message', { type: message.type });
          assert.equal(message.token, config.token);
          assert.equal(message.pid, child.pid);
          if (message.type === 'ready') {
            assert(!report.permissionSent, 'Duplicate fixture readiness');
            report.permissionSent = true;
            mark('write-permission');
            socket.write(JSON.stringify({ type: 'go', token: config.token }) + '\n');
          } else assert.equal(message.type, 'written');
        }
      } catch (error) { mark('control-error', errorFact(error)); fail(error); }
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    guard();
    native = require(config.binary);
    assert.equal(report.loaded.hash, config.binaryHash);
    native.failureConfigure(config.token, config.nativeScenario);
    const input = { token: config.token, scenario: config.fixtureScenario, port: server.address().port };
    mark('fork-call');
    child = native.fork(process.execPath, [fixtureScript, '--fixture', JSON.stringify(input)],
      Object.entries({ ...process.env, TERM: 'xterm-256color' }).map(([key, value]) => `${key}=${value}`),
      config.cwd, 80, 24, -1, -1, true, '', (exitCode, signalCode) => {
        if (report.callback !== null) { fail(new Error('Duplicate exit callback')); return; }
        report.callback = { exitCode, signalCode };
        mark('exit-callback', report.callback);
      });
    mark('fork-return', { fd: child.fd, pid: child.pid });
    report.initialNative = native.failureSnapshot();
    await sendChecked({ type: 'driver-started', token: config.token, operationId, snapshot: report.initialNative });
    const { Terminal } = require(path.join(config.dependencyRoot, '@xterm/headless'));
    terminal = new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
    for (;;) {
      guard();
      const buffer = Buffer.alloc(4096);
      report.readCalls++;
      report.readPending++;
      mark('read-enter');
      const result = await new Promise(resolve => fs.read(child.fd, buffer, 0, buffer.length, null,
        (error, count) => resolve({ error, count })));
      report.readPending--;
      mark('read-return', { error: result.error?.code ?? null, count: result.count ?? null });
      guard();
      if (result.error?.code === 'EAGAIN' || result.error?.code === 'EWOULDBLOCK') { await sleep(2); continue; }
      if (result.error || result.count === 0) {
        report.source = result.error?.code === 'EIO' ? 'linux-eio' : result.error ? 'read-error' : 'zero-read';
        report.sourceError = result.error ? errorFact(result.error) : null;
        mark('source-end', { source: report.source });
        break;
      }
      const received = Buffer.from(buffer.subarray(0, result.count));
      bytes.push(received);
      report.parserAccepted++;
      mark('parser-enter', { bytes: received.length });
      await new Promise(resolve => terminal.write(received, resolve));
      report.parserCompleted++;
      mark('parser-complete');
    }
    report.state = terminalState(terminal);
    mark('final-state');
    await waitFor(() => {
      report.native = native.failureSnapshot();
      return report.native.tsfnFinalized && report.native.threadJoined && report.native.waitConfirmed;
    });
    await waitFor(() => report.controlMessages.some(message => message.type === 'written'));
    const readyNative = native.failureSnapshot();
    assert.equal(report.source, 'linux-eio');
    assert.equal(report.readPending, 0);
    assert.equal(report.parserAccepted, report.parserCompleted);
    assert.deepEqual(report.state, config.expected.state);
    assert.equal(Buffer.concat(bytes).toString('base64'), config.expected.wireBase64);
    assert.deepEqual(report.callback, { exitCode: 7, signalCode: 0 });
    const written = report.controlMessages.filter(message => message.type === 'written');
    assert.equal(written.length, 1);
    assert.equal(written[0].bytes, config.expected.writtenBytes);
    assert.equal(written[0].hash, config.expected.writtenHash);
    assert.equal(written[0].intendedExitCode, 7);
    for (const field of ['waitConfirmed', 'threadFinished', 'threadJoined', 'payloadFreed', 'tsfnFinalized', 'notificationCallInvoked'])
      assert.equal(readyNative[field], true, field);
    for (const field of ['threadJoinable', 'notificationFailureInjected', 'overflow', 'masterCloseReturned'])
      assert.equal(readyNative[field], false, field);
    for (const field of ['waitError', 'signalCode', 'tsfnReleaseStatus', 'notificationStatus', 'notificationCallbackStatus',
      'threadJoinError', 'clockError', 'masterCloseCalls', 'masterCloseError']) assert.equal(readyNative[field], 0, field);
    assert.equal(readyNative.exitCode, 7);
    report.release.ready = { ms: mark('release-ready', { operationId }), native: readyNative,
      readPending: report.readPending, parserPending: report.parserAccepted - report.parserCompleted,
      source: report.source, writtenReceipts: written.length };
    await sendChecked({ type: 'release-ready', token: config.token, operationId, ready: report.release.ready });
    await waitFor(() => report.release.requestMs !== null);
    mark('master-close-request', { operationId, readPending: report.readPending,
      parserPending: report.parserAccepted - report.parserCompleted });
    const snapshot = native.failureCloseMaster(config.token);
    report.release.audit = { ms: mark('release-audit', { operationId }), native: snapshot };
    await sendChecked({ type: 'release-audit', token: config.token, operationId, snapshot });
    if (config.scenario === 'U1-5') await waitFor(() => report.release.receiptPermitMs !== null);
    guard();
    report.release.receipt = { ms: mark('release-receipt', { operationId }), native: snapshot };
    await sendChecked({ type: 'release-receipt', token: config.token, operationId, snapshot });
    assert(closeSucceeded(snapshot), 'Actual master close did not succeed');
    guard();
    mark('native-settled');
  } catch (error) {
    report.error = errorFact(error);
    mark('driver-error', report.error);
  } finally {
    report.native = native?.failureSnapshot() ?? null;
    report.rawBase64 = Buffer.concat(bytes).toString('base64');
    terminal?.dispose();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    mark('control-closed');
    process.off('message', onMessage);
    process.off('disconnect', onDisconnect);
    await sendChecked({ type: 'driver-result', token: config.token, operationId, report }, true);
    process.disconnect();
  }
}

async function caller(config) {
  validateConfig(config);
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const operationId = config.releaseOperationId;
  const events = [];
  const mark = (name, detail = {}, ms = elapsed()) => events.push({ name, ms, ...detail });
  const release = { operationId, r0: null, deadlineMs: null, audit: null, receipt: null,
    first: null, current: 'not-started', currentMs: null };
  const child = spawn(process.execPath, [script, '--driver', config.configPath],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '', exit = null, closed = null, settled = false;
  let releaseTimer = null, readyReceived = false, receiptPermitted = false, protocolFailed = false, initialNative = null;
  let complete;
  const operation = new Promise(resolve => { complete = value => { if (!settled) { settled = true; resolve(value); } }; });
  let closeResolve;
  const close = new Promise(resolve => { closeResolve = resolve; });
  const fail = error => {
    if (protocolFailed) return;
    protocolFailed = true;
    clearTimeout(releaseTimer);
    mark('protocol-error', errorFact(error));
    complete({ kind: 'protocol-error', error: errorFact(error) });
  };
  const notify = message => { send(message).catch(fail); };
  const forward = message => {
    try { child.send(message, error => { if (error) fail(error); }); }
    catch (error) { fail(error); }
  };
  const assertNativeIdentity = snapshot => {
    assert(initialNative, 'Native identity was not established');
    assert.equal(snapshot?.token, config.token);
    assert.equal(snapshot.scenario, config.nativeScenario);
    assert.equal(snapshot.pid, initialNative.pid);
    assert.equal(snapshot.master, initialNative.master);
  };
  const freezeFirst = (disposition, ms, receipt) => {
    if (release.first !== null) return;
    release.first = Object.freeze({ disposition, ms, receipt });
    release.current = disposition;
    release.currentMs = ms;
    clearTimeout(releaseTimer);
    mark('release-observation', { token: config.token, operationId, disposition }, ms);
    notify({ type: 'release-observation', token: config.token, operationId, callerMs: ms, first: release.first });
  };
  const advanceDeadline = ms => {
    if (release.r0 !== null && release.first === null && ms >= release.deadlineMs)
      freezeFirst('observation-unknown', ms, null);
  };
  const onReleaseDeadline = () => {
    if (protocolFailed) return;
    const ms = elapsed();
    advanceDeadline(ms);
    if (release.first === null) releaseTimer = setTimeout(onReleaseDeadline, Math.max(1, release.deadlineMs - ms));
  };
  const onPermit = message => {
    const ms = elapsed();
    mark(message?.type ?? 'invalid-message', { token: message?.token, operationId: message?.operationId }, ms);
    if (protocolFailed) return;
    try {
      assert.equal(message?.token, config.token);
      assert.equal(message.operationId, operationId);
      assert(!settled, 'Permission after operation settlement');
      if (message.type === 'release-permit') {
        assert(readyReceived, 'Release permitted before readiness');
        assert.equal(release.r0, null, 'Duplicate release permit');
        release.r0 = elapsed();
        release.deadlineMs = release.r0 + config.releaseBudgets.observation;
        release.current = 'pending'; release.currentMs = release.r0;
        mark('release-request', { token: config.token, operationId, r0: release.r0 }, release.r0);
        releaseTimer = setTimeout(onReleaseDeadline, config.releaseBudgets.observation);
        forward({ type: 'release-request', token: config.token, operationId });
      } else if (message.type === 'receipt-permit') {
        advanceDeadline(ms);
        assert.equal(config.scenario, 'U1-5');
        assert.equal(release.first?.disposition, 'observation-unknown');
        assert.equal(release.receipt, null, 'Receipt already received');
        assert(!receiptPermitted, 'Duplicate receipt permit');
        receiptPermitted = true;
        forward({ type: 'receipt-permit', token: config.token, operationId });
      } else throw new Error(`Unexpected caller message: ${message.type}`);
    } catch (error) { fail(error); }
  };
  const onDisconnect = () => fail(new Error('Observer disconnected before caller settlement'));
  process.on('message', onPermit);
  process.on('disconnect', onDisconnect);
  child.stdout.on('data', data => { stdout = (stdout + data).slice(0, 65536); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(0, 65536); });
  child.on('error', error => { mark('driver-spawn-error', errorFact(error)); complete({ kind: 'spawn-error' }); });
  child.on('message', message => {
    const ms = elapsed();
    mark(message?.type ?? 'invalid-message', { token: message?.token, operationId: message?.operationId }, ms);
    if (protocolFailed) return;
    try {
      if (message?.type === 'release-receipt') advanceDeadline(ms);
      assert.equal(message?.token, config.token);
      assert.equal(message.operationId, operationId);
      if (message.type === 'driver-started') {
        assert.equal(initialNative, null, 'Duplicate driver identity');
        assert.equal(message.snapshot?.token, config.token);
        assert.equal(message.snapshot.scenario, config.nativeScenario);
        initialNative = message.snapshot;
        notify({ ...message, callerMs: ms });
      } else if (message.type === 'release-ready') {
        assert(!readyReceived, 'Duplicate release readiness');
        assert.equal(release.r0, null);
        assertNativeIdentity(message.ready?.native);
        readyReceived = true;
        notify({ ...message, callerMs: ms });
      } else if (message.type === 'release-audit') {
        assert.notEqual(release.r0, null, 'Audit before release request');
        assert.equal(release.audit, null, 'Duplicate release audit');
        assertNativeIdentity(message.snapshot);
        release.audit = { ms, value: message };
        notify({ type: 'release-audit-observed', token: config.token, operationId, callerMs: ms, audit: message });
      } else if (message.type === 'release-receipt') {
        assert.notEqual(release.r0, null, 'Receipt before release request');
        assert.equal(release.receipt, null, 'Duplicate release receipt');
        assert(release.audit, 'Receipt without preceding audit');
        assertNativeIdentity(message.snapshot);
        if (config.scenario === 'U1-5') assert(receiptPermitted, 'Receipt arrived before permission');
        assert.deepEqual(message.snapshot, release.audit.value.snapshot);
        release.receipt = { ms, value: message };
        const disposition = closeSucceeded(message.snapshot) ? 'released' : 'release-failed';
        freezeFirst(disposition, ms, message);
        release.current = disposition; release.currentMs = ms;
        mark('release-receipt-observed', { token: config.token, operationId, current: disposition }, ms);
        notify({ type: 'release-receipt-observed', token: config.token, operationId, callerMs: ms,
          first: release.first, current: release.current, currentMs: release.currentMs, receipt: message });
      } else if (message.type === 'driver-result') {
        if (message.report.error === null) assert(release.receipt, 'Successful driver result before receipt');
        complete({ kind: 'result', report: message.report });
      } else throw new Error(`Unexpected driver message: ${message.type}`);
    } catch (error) { fail(error); }
  });
  child.on('exit', (code, signal) => { exit = { code, signal }; mark('driver-exit', exit); });
  child.on('close', (code, signal) => {
    closed = { code, signal, ms: elapsed() };
    mark('driver-close', closed);
    complete({ kind: 'driver-closed-without-result' });
    closeResolve();
  });
  const deadline = setTimeout(() => {
    mark('operation-deadline');
    complete({ kind: 'deadline' });
    mark('driver-control', { signal: 'SIGTERM', returned: child.kill('SIGTERM') });
  }, budgets.operation);
  const kill = setTimeout(() => {
    if (!closed) mark('driver-control', { signal: 'SIGKILL', returned: child.kill('SIGKILL') });
  }, budgets.caller - 1000);
  let budgetResolve;
  const exhausted = new Promise(resolve => { budgetResolve = resolve; });
  const total = setTimeout(budgetResolve, budgets.caller);
  const result = await operation;
  mark('after-await', { resultKind: result.kind });
  await send({ type: 'after-await', token: config.token, operationId, callerMs: elapsed(), result });
  await Promise.race([close, exhausted]);
  clearTimeout(deadline); clearTimeout(kill); clearTimeout(total); clearTimeout(releaseTimer);
  process.off('message', onPermit);
  process.off('disconnect', onDisconnect);
  await send({ type: 'caller-final', token: config.token, operationId, events, stdout, stderr, exit, closed, release });
  process.disconnect();
  if (!closed) process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const { values } = parseArgs({ options: { caller: { type: 'string' }, driver: { type: 'string' } } });
  try {
    assert.equal(process.platform, 'linux');
    assert.equal(process.version, 'v22.23.2');
    if (values.caller) await caller(read(values.caller));
    else if (values.driver) await driver(read(values.driver));
    else throw new Error('Specify --caller or --driver');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
