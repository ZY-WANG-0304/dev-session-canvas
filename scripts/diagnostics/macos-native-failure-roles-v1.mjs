import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const script = path.resolve(process.argv[1]);
const fixtureScript = path.resolve(new URL('./macos-native-failure-fixture-process-v1.mjs', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function driver(config) {
  assert.equal(config.platform, 'darwin');
  assert.equal(config.scenario, 'U1-6');
  const started = performance.now();
  const mark = (name, detail = {}) => report.events.push({ name, ms: performance.now() - started, ...detail });
  const report = { token: config.token, scenario: config.scenario, fixtureScenario: 'U1-6', events: [],
    controlMessages: [], loaded: { path: config.binary, hash: hash(fs.readFileSync(config.binary)), node: process.version },
    readCalls: 0, readPending: 0, parserAccepted: 0, parserCompleted: 0, permissionSent: false,
    source: null, native: null, state: null, callback: null, rawBase64: '', error: null };
  const sockets = new Set();
  let native, child, readySocket, readyMessage;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let pending = '';
    socket.on('data', data => {
      pending += data;
      for (let end; (end = pending.indexOf('\n')) >= 0;) {
        const message = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
        assert.equal(message.token, config.token); assert.equal(message.pid, child.pid);
        report.controlMessages.push(message); mark('control-message', { type: message.type });
        if (message.type === 'ready') { assert.equal(readyMessage, undefined); readyMessage = message; readySocket = socket; }
        if (message.type === 'abort-ack') mark('abort-ack', message);
      }
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    native = require(config.binary);
    native.failureConfigure(config.token, config.scenario);
    child = native.fork(process.execPath, [fixtureScript, '--config-json', JSON.stringify({
      token: config.token, scenario: config.scenario, port: server.address().port
    })], process.env, config.cwd, 80, 24, -1, -1, true, config.helper,
    (exitCode, signalCode) => { assert.equal(report.callback, null); report.callback = { exitCode, signalCode }; mark('exit-callback', report.callback); });
    report.initialNative = native.failureSnapshot();
    await new Promise((resolve, reject) => process.send({ type: 'driver-started', token: config.token,
      snapshot: report.initialNative }, error => error ? reject(error) : resolve()));
    for (;;) {
      const snapshot = native.failureSnapshot();
      if (readyMessage && snapshot.registrationFailureInjected && !snapshot.registrationInFlight) break;
      if (performance.now() - started > (config.driverBudgetMs ?? 29000)) throw new Error('U1-6 registration substitute not ready');
      await sleep(2);
    }
    assert(readySocket); assert.equal(report.permissionSent, false); mark('abort-sent', { token: config.token, pid: child.pid });
    readySocket.write(JSON.stringify({ type: 'abort', token: config.token, pid: child.pid }) + '\n');
    while (!report.controlMessages.some(message => message.type === 'abort-ack')) {
      if (performance.now() - started > (config.driverBudgetMs ?? 29000)) throw new Error('U1-6 abort acknowledgement missing');
      await sleep(2);
    }
    const ack = report.controlMessages.find(message => message.type === 'abort-ack');
    assert.equal(ack.token, config.token); assert.equal(ack.pid, child.pid); mark('abort-ack-observed', ack);
    for (;;) {
      report.native = native.failureSnapshot();
      if (report.native.waitConfirmed && report.native.kqueueCloseReturned && report.native.tsfnFinalized && report.native.threadJoined) break;
      if (performance.now() - started > (config.driverBudgetMs ?? 29000)) throw new Error('U1-6 native owners remain unresolved');
      await sleep(2);
    }
    assert.equal(report.permissionSent, false); assert.equal(report.readCalls, 0);
    mark('master-close-request', { readPending: 0, parserPending: 0 });
    native.failureCloseMaster(config.token); report.native = native.failureSnapshot(); mark('native-settled');
  } catch (error) { report.error = { name: error.name, message: error.message, code: error.code ?? null }; mark('driver-error', report.error); }
  finally {
    report.native = native?.failureSnapshot() ?? null;
    for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => process.send({ type: 'driver-result', token: config.token, report }, resolve));
    process.disconnect();
  }
}

async function caller(config) {
  const child = spawn(process.execPath, [script, '--driver', config.configPath], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume();
  child.on('message', message => process.send(message));
  await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  process.disconnect();
}

const { values } = parseArgs({ options: { caller: { type: 'string' }, driver: { type: 'string' }, 'config-json': { type: 'string' } } });
try {
  if (values['config-json']) await (async () => {
    const config = JSON.parse(values['config-json']);
    await runFixture(config);
  })();
  else if (values.driver) await driver(JSON.parse(fs.readFileSync(values.driver, 'utf8')));
  else if (values.caller) await caller(JSON.parse(fs.readFileSync(values.caller, 'utf8')));
  else throw new Error('Specify --caller, --driver or --config-json');
} catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }

async function runFixture(config) {
  const fixture = await import('./macos-native-failure-fixture-process-v1.mjs');
  await fixture.runFixture(config);
}
