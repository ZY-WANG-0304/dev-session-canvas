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
import { budgets } from './diagnose-native-failure-v1.mjs';

const script = fileURLToPath(import.meta.url);
const fixtureScript = fileURLToPath(new URL('./macos-native-failure-fixture-process-v1.mjs', import.meta.url));
const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = message => new Promise((resolve, reject) => process.send(message,
  error => error ? reject(error) : resolve()));
const errorFact = error => ({ name: error.name, message: error.message, code: error.code ?? null });

export function registrationGate(snapshot, ready, token, child) {
  return ready?.token === token && ready?.pid === child?.pid && ready.stdinTTY === true && ready.stdoutTTY === true &&
    snapshot?.token === token && snapshot.scenario === 'U1-6' && snapshot.pid === child.pid &&
    snapshot.master === child.fd && snapshot.masterAcquired === true && snapshot.masterCloseCalls === 0 &&
    snapshot.kqueueAcquired === true && snapshot.kqueueOwnerRegistered === true && snapshot.kqueueFd >= 0 &&
    snapshot.registerApiEntered === true && snapshot.registrationFailureInjected === true &&
    snapshot.registrationCallInvoked === false && snapshot.registrationInFlight === false &&
    snapshot.registrationResult === -1 && snapshot.registrationError === 5 &&
    snapshot.registrationErrorSource === 'native-substitute' && snapshot.kqueueRegistered === false &&
    snapshot.kqueueWaitReturned === false;
}

export async function driver(config, dependencies = {}) {
  const deps = { now: () => performance.now(), sleep, send, load: require,
    readFile: file => fs.readFileSync(file), createServer: callback => net.createServer(callback),
    execPath: process.execPath, env: process.env, platform: process.platform, version: process.version,
    disconnect: () => process.disconnect(), ...dependencies };
  const started = deps.now();
  const report = { token: config.token, scenario: config.scenario, fixtureScenario: config.fixtureScenario,
    events: [], controlMessages: [], loaded: { path: config.binary, node: deps.version, platform: deps.platform,
      helper: config.helper, executablePath: deps.execPath },
    readCalls: 0, readPending: 0, parserAccepted: 0, parserCompleted: 0, permissionSent: false,
    source: null, native: null, state: null, callback: null, rawBase64: '', error: null, creationError: null,
    writeGate: null, beforeCloseNative: null };
  const mark = (name, detail = {}) => report.events.push({ name, ms: deps.now() - started, ...detail });
  const sockets = new Set();
  let native, child, readySocket = null, readyMessage = null, controlError = null, server;
  const fail = (name, error) => { controlError ??= error; mark(name, errorFact(error)); };
  const checkpoint = message => {
    if (controlError) throw controlError;
    if (deps.now() - started > 29000) throw new Error(message);
  };
  try {
    assert.equal(config.platform, 'darwin'); assert.equal(deps.platform, 'darwin');
    assert.equal(config.scenario, 'U1-6'); assert.equal(config.fixtureScenario, 'U1-6');
    report.loaded.hash = hash(deps.readFile(config.binary));
    report.loaded.helperHash = hash(deps.readFile(config.helper));
    assert.equal(report.loaded.hash, config.binaryHash); assert.equal(report.loaded.helperHash, config.helperHash);
    server = deps.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', error => fail('control-error', error));
      let pending = '';
      socket.on('data', data => {
        try {
          pending += data;
          for (let end; (end = pending.indexOf('\n')) >= 0;) {
            const message = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
            assert.equal(message.token, config.token); assert.equal(message.pid, child?.pid);
            assert(['ready', 'abort-ack'].includes(message.type));
            if (message.type === 'ready') {
              assert.equal(readyMessage, null); assert(message.stdinTTY && message.stdoutTTY);
              readyMessage = message; readySocket = socket;
            } else {
              assert.equal(socket, readySocket);
              assert.equal(report.controlMessages.filter(item => item.type === 'abort').length, 1);
              assert.equal(report.controlMessages.filter(item => item.type === 'abort-ack').length, 0);
            }
            report.controlMessages.push(message); mark('control-message', { type: message.type });
            if (message.type === 'abort-ack') mark('abort-ack', message);
          }
        } catch (error) { fail('control-protocol-error', error); }
      });
    });
    server.on('error', error => fail('control-error', error));
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    native = deps.load(config.binary);
    native.failureConfigure(config.token, config.scenario);
    mark('pty-create-call');
    child = native.fork(deps.execPath, [fixtureScript, '--config-json', JSON.stringify({
      token: config.token, scenario: config.scenario, port: server.address().port
    })], Object.entries({ ...deps.env, TERM: 'xterm-256color' }).map(([key, value]) => `${key}=${value}`),
    config.cwd, 80, 24, -1, -1, true, config.helper, (exitCode, signalCode) => {
      try {
        assert.equal(report.callback, null); report.callback = { exitCode, signalCode };
        mark('exit-callback', report.callback);
      } catch (error) { fail('callback-error', error); }
    });
    mark('pty-create-return', { fd: child.fd, pid: child.pid });
    report.initialNative = native.failureSnapshot();
    await deps.send({ type: 'driver-started', token: config.token, snapshot: report.initialNative });
    for (;;) {
      checkpoint('U1-6 registration substitute not ready');
      const snapshot = native.failureSnapshot();
      if (registrationGate(snapshot, readyMessage, config.token, child)) {
        report.writeGate = { native: snapshot, ready: readyMessage };
        mark('write-gate-ready', { gate: report.writeGate }); break;
      }
      await deps.sleep(2);
    }
    const abort = { type: 'abort', token: config.token, pid: child.pid };
    report.controlMessages.push(abort); mark('abort-sent', abort);
    await new Promise((resolve, reject) => readySocket.write(JSON.stringify(abort) + '\n',
      error => error ? reject(error) : resolve()));
    while (!report.controlMessages.some(message => message.type === 'abort-ack')) {
      checkpoint('U1-6 abort acknowledgement missing'); await deps.sleep(2);
    }
    for (;;) {
      checkpoint('U1-6 native owners remain unresolved');
      report.native = native.failureSnapshot();
      if (report.native.waitConfirmed && report.native.kqueueCloseReturned && report.native.tsfnFinalized &&
          report.native.threadJoined && report.native.payloadFreed && report.callback) break;
      await deps.sleep(2);
    }
    report.beforeCloseNative = native.failureSnapshot();
    assert.equal(report.beforeCloseNative.masterCloseCalls, 0);
    mark('native-before-master-close');
    mark('master-close-request', { readPending: 0, parserPending: 0 });
    native.failureCloseMaster(config.token); report.native = native.failureSnapshot(); mark('native-settled');
  } catch (error) { report.error = errorFact(error); mark('driver-error', report.error); }
  finally {
    try { report.native = native?.failureSnapshot() ?? null; }
    catch (error) { report.error ??= errorFact(error); mark('snapshot-error', errorFact(error)); }
    for (const socket of sockets) socket.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    mark('control-closed');
    try { await deps.send({ type: 'driver-result', token: config.token, report }); }
    finally { deps.disconnect(); }
  }
  return report;
}

export async function caller(config, dependencies = {}) {
  const deps = { spawn, send, now: () => performance.now(), setTimeout, clearTimeout,
    disconnect: () => process.disconnect(), exit: code => process.exit(code), ...dependencies };
  const started = deps.now(), events = [];
  const mark = (name, detail = {}) => events.push({ name, ms: deps.now() - started, ...detail });
  const child = deps.spawn(process.execPath, [script, '--driver', config.configPath],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '', exit = null, closed = null, settled = false, complete, closeResolve;
  const operation = new Promise(resolve => { complete = value => { if (!settled) { settled = true; resolve(value); } }; });
  const close = new Promise(resolve => { closeResolve = resolve; });
  child.stdout.on('data', data => { stdout = (stdout + data).slice(0, 65536); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(0, 65536); });
  child.on('error', error => { mark('driver-spawn-error', errorFact(error)); complete({ kind: 'spawn-error' }); });
  child.on('message', message => {
    if (message?.token !== config.token || !['driver-started', 'driver-result'].includes(message?.type)) {
      mark('driver-protocol-error'); complete({ kind: 'protocol-error' }); return;
    }
    mark(message.type, { token: message.token });
    if (message.type === 'driver-started') deps.send({ ...message, callerMs: deps.now() - started })
      .catch(error => { mark('driver-send-error', errorFact(error)); complete({ kind: 'send-error' }); });
    if (message.type === 'driver-result') complete({ kind: 'result', report: message.report });
  });
  child.on('exit', (code, signal) => { exit = { code, signal }; mark('driver-exit', exit); });
  child.on('close', (code, signal) => {
    closed = { code, signal, ms: deps.now() - started }; mark('driver-close', closed);
    complete({ kind: 'driver-closed-without-result' }); closeResolve();
  });
  const deadline = deps.setTimeout(() => {
    mark('operation-deadline'); complete({ kind: 'deadline' });
    mark('driver-control', { signal: 'SIGTERM', returned: child.kill('SIGTERM') });
  }, budgets.operation);
  const kill = deps.setTimeout(() => {
    if (!closed) mark('driver-control', { signal: 'SIGKILL', returned: child.kill('SIGKILL') });
  }, budgets.caller - 1000);
  let budgetResolve;
  const exhausted = new Promise(resolve => { budgetResolve = resolve; });
  const total = deps.setTimeout(budgetResolve, budgets.caller);
  try {
    const result = await operation;
    mark('after-await', { resultKind: result.kind });
    await deps.send({ type: 'after-await', token: config.token, callerMs: deps.now() - started, result });
    await Promise.race([close, exhausted]);
    await deps.send({ type: 'caller-final', token: config.token, events, stdout, stderr, exit, closed });
  } finally {
    deps.clearTimeout(deadline); deps.clearTimeout(kill); deps.clearTimeout(total); deps.disconnect();
    if (!closed) deps.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const { values } = parseArgs({ options: { caller: { type: 'string' }, driver: { type: 'string' } } });
    assert.equal(process.platform, 'darwin'); assert.equal(process.version, 'v22.23.2');
    if (values.driver) await driver(JSON.parse(fs.readFileSync(values.driver, 'utf8')));
    else if (values.caller) await caller(JSON.parse(fs.readFileSync(values.caller, 'utf8')));
    else throw new Error('Specify --caller or --driver');
  } catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
