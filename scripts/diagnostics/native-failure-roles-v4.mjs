// Linux U1-0/U1-3 roles; fixture and writer remain frozen v1.
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
function makeTerminal(dependencyRoot) {
  const { Terminal } = require(path.join(dependencyRoot, '@xterm/headless'));
  return new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
}

async function driver(config) {
  const started = performance.now();
  const report = { token: config.token, scenario: config.scenario, events: [], controlMessages: [],
    loaded: { path: config.binary, hash: hash(fs.readFileSync(config.binary)), node: process.version },
    readCalls: 0, readPending: 0, parserAccepted: 0, parserCompleted: 0, permissionSent: false,
    source: null, native: null, state: null, callback: null, rawBase64: '', error: null,
    creationError: null, pollWaitCalls: 0, fixtureScenario: config.fixtureScenario, firstWaitObservation: null };
  const mark = (name, detail = {}) => report.events.push({ name, ms: performance.now() - started, ...detail });
  const bytes = [];
  const sockets = new Set();
  let terminal, native, child;
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', error => mark('control-error', errorFact(error)));
    let pending = '';
    socket.on('data', data => {
      pending += data;
      for (let end; (end = pending.indexOf('\n')) >= 0;) {
        const message = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        report.controlMessages.push(message);
        mark('control-message', { type: message.type });
        assert.equal(message.token, config.token);
        assert.equal(message.pid, child.pid);
        if (message.type === 'ready' && ['U1-0', 'U1-3'].includes(config.scenario)) {
          assert(!report.permissionSent);
          report.permissionSent = true;
          mark('write-permission');
          socket.write(JSON.stringify({ type: 'go', token: config.token }) + '\n');
        }
      }
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    native = require(config.binary);
    assert.equal(report.loaded.hash, config.binaryHash);
    native.failureConfigure(config.token, config.scenario);
    assert.equal(config.fixtureScenario, 'U1-0');
    const input = { token: config.token, scenario: config.fixtureScenario, port: server.address().port };
    mark('fork-call');
    child = native.fork(process.execPath, [fixtureScript, '--fixture', JSON.stringify(input)],
      Object.entries({ ...process.env, TERM: 'xterm-256color' }).map(([key, value]) => `${key}=${value}`),
      config.cwd, 80, 24, -1, -1, true, '', (exitCode, signalCode) => {
        assert.equal(report.callback, null);
        report.callback = { exitCode, signalCode };
        mark('exit-callback', report.callback);
      });
    mark('fork-return', { fd: child.fd, pid: child.pid });
    report.initialNative = native.failureSnapshot();
    await send({ type: 'driver-started', token: config.token, snapshot: report.initialNative });
    if (config.scenario === 'U1-3') {
      let snapshot = report.initialNative;
      while (snapshot.firstAttempt === null) {
        if (performance.now() - started > 29000) throw new Error('First wait result missing');
        await sleep(2);
        snapshot = native.failureSnapshot();
      }
      report.firstWaitObservation = { firstAttempt: snapshot.firstAttempt,
        currentWaitConfirmed: snapshot.waitConfirmed, exitCode: snapshot.exitCode, signalCode: snapshot.signalCode };
      mark('initial-wait-result', { snapshot: report.firstWaitObservation });
      await send({ type: 'initial-wait-result', token: config.token, snapshot: report.firstWaitObservation });
    }
    {
      terminal = makeTerminal(config.dependencyRoot);
      for (;;) {
        const buffer = Buffer.alloc(4096);
        report.readCalls++;
        report.readPending++;
        mark('read-enter');
        const result = await new Promise(resolve => fs.read(child.fd, buffer, 0, buffer.length, null,
          (error, count) => resolve({ error, count })));
        report.readPending--;
        mark('read-return', { error: result.error?.code ?? null, count: result.count ?? null });
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
      assert.equal(report.readPending, 0);
      assert.equal(report.parserAccepted, report.parserCompleted);
      mark('master-close-request', { readPending: report.readPending,
        parserPending: report.parserAccepted - report.parserCompleted });
      native.failureCloseMaster(config.token);
    }
    for (;;) {
      report.native = native.failureSnapshot();
      if (report.native.tsfnFinalized && report.native.threadJoined && report.native.waitConfirmed) break;
      if (performance.now() - started > 29000) throw new Error('Native ownership remains unconfirmed');
      await sleep(2);
    }
    {
      while (!report.controlMessages.some(message => message.type === 'written')) {
        if (performance.now() - started > 29000) throw new Error('Private writer receipt missing');
        await sleep(2);
      }
    }
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
    await send({ type: 'driver-result', token: config.token, report });
    process.disconnect();
  }
}

async function caller(config) {
  const started = performance.now();
  const events = [];
  const mark = (name, detail = {}) => events.push({ name, ms: performance.now() - started, ...detail });
  const child = spawn(process.execPath, [script, '--driver', config.configPath],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '', exit = null, closed = null, settled = false;
  let complete;
  const operation = new Promise(resolve => { complete = value => { if (!settled) { settled = true; resolve(value); } }; });
  let closeResolve;
  const close = new Promise(resolve => { closeResolve = resolve; });
  child.stdout.on('data', data => { stdout = (stdout + data).slice(0, 65536); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(0, 65536); });
  child.on('error', error => { mark('driver-spawn-error', errorFact(error)); complete({ kind: 'spawn-error' }); });
  child.on('message', message => {
    mark(message.type, { token: message.token });
    if (message.type === 'driver-started' || message.type === 'initial-wait-result') process.send({ ...message, callerMs: performance.now() - started });
    if (message.type === 'driver-result') complete({ kind: 'result', report: message.report });
  });
  child.on('exit', (code, signal) => { exit = { code, signal }; mark('driver-exit', exit); });
  child.on('close', (code, signal) => {
    closed = { code, signal, ms: performance.now() - started };
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
  await send({ type: 'after-await', token: config.token, callerMs: performance.now() - started, result });
  await Promise.race([close, exhausted]);
  clearTimeout(deadline); clearTimeout(kill); clearTimeout(total);
  await send({ type: 'caller-final', token: config.token, events, stdout, stderr, exit, closed });
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
