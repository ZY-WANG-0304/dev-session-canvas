// Fixed Linux U1-0/U1-1 slice. Not a general process supervisor.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assessCase, verifySaved } from './native-failure-verifier-v1.mjs';

const script = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
export const budgets = Object.freeze({ operation: 30000, caller: 32000, afterAwait: 35000,
  observation: 36000, fixture: 20000, writer: 1000, writerObservation: 2000 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = message => new Promise((resolve, reject) => process.send(message,
  error => error ? reject(error) : resolve()));
const errorFact = error => ({ name: error.name, message: error.message, code: error.code ?? null });
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function fixtureBytes(token) {
  assert.match(token, /^[a-f0-9]{32}$/);
  return Buffer.from(`\x1b[2J\x1b[H${token.repeat(64)}\r\nTAIL:${token}\r\n\x1b[5;7H`);
}

export function terminalState(terminal) {
  const buffer = terminal.buffer.active;
  const lines = Array.from({ length: buffer.length }, (_, index) => {
    const line = buffer.getLine(index);
    return { wrapped: line.isWrapped, cells: Array.from({ length: line.length }, (_, column) => {
      const cell = line.getCell(column);
      return [cell.getChars(), cell.getWidth(), cell.getCode(), cell.getFgColorMode(),
        cell.getFgColor(), cell.getBgColorMode(), cell.getBgColor(), cell.isBold(), cell.isItalic(),
        cell.isUnderline(), cell.isDim(), cell.isInverse(), cell.isBlink(), cell.isInvisible(),
        cell.isStrikethrough(), cell.isOverline()];
    }) };
  });
  return { cols: terminal.cols, rows: terminal.rows, type: buffer.type, length: buffer.length,
    cursorX: buffer.cursorX, cursorY: buffer.cursorY, baseY: buffer.baseY,
    viewportY: buffer.viewportY, modes: terminal.modes, lines };
}

function makeTerminal(dependencyRoot) {
  const { Terminal } = require(path.join(dependencyRoot, '@xterm/headless'));
  return new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
}

async function expectedInput(token, dependencyRoot) {
  const written = fixtureBytes(token);
  const wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
  const terminal = makeTerminal(dependencyRoot);
  await new Promise(resolve => terminal.write(wire, resolve));
  const state = terminalState(terminal);
  terminal.dispose();
  return { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
    wireHash: hash(wire), wireBase64: wire.toString('base64'), state };
}

async function fixture(config) {
  const safety = setTimeout(() => process.exit(124), budgets.fixture);
  const socket = net.connect(config.port, '127.0.0.1');
  socket.on('error', () => process.exit(125));
  socket.once('connect', () => socket.write(JSON.stringify({ type: 'ready', token: config.token,
    pid: process.pid, stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY) }) + '\n'));
  let pending = '';
  socket.on('data', data => {
    pending += data;
    const end = pending.indexOf('\n');
    if (end < 0) return;
    const permission = JSON.parse(pending.slice(0, end));
    assert.deepEqual(permission, { type: 'go', token: config.token });
    assert.equal(config.scenario, 'U1-0');
    socket.removeAllListeners('data');
    const bytes = fixtureBytes(config.token);
    let written = 0, calls = 0;
    while (written < bytes.length) {
      const count = fs.writeSync(1, bytes, written, bytes.length - written);
      assert(count > 0);
      written += count;
      calls++;
    }
    socket.end(JSON.stringify({ type: 'written', token: config.token, pid: process.pid,
      bytes: written, hash: hash(bytes), calls, intendedExitCode: 7 }) + '\n', () => {
      clearTimeout(safety);
      process.exitCode = 7;
    });
  });
}

async function driver(config) {
  const started = performance.now();
  const report = { token: config.token, scenario: config.scenario, events: [], controlMessages: [],
    loaded: { path: config.binary, hash: hash(fs.readFileSync(config.binary)), node: process.version },
    readCalls: 0, readPending: 0, parserAccepted: 0, parserCompleted: 0, permissionSent: false,
    source: null, native: null, state: null, callback: null, rawBase64: '', error: null };
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
        if (message.type === 'ready' && config.scenario === 'U1-0') {
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
    native.failureConfigure(config.token, config.scenario);
    const input = { token: config.token, scenario: config.scenario, port: server.address().port };
    mark('fork-call');
    child = native.fork(process.execPath, [script, '--fixture', JSON.stringify(input)],
      Object.entries({ ...process.env, TERM: 'xterm-256color' }).map(([key, value]) => `${key}=${value}`),
      config.cwd, 80, 24, -1, -1, true, '', (exitCode, signalCode) => {
        assert.equal(report.callback, null);
        report.callback = { exitCode, signalCode };
        mark('exit-callback', report.callback);
      });
    mark('fork-return', { fd: child.fd, pid: child.pid });
    report.initialNative = native.failureSnapshot();
    await send({ type: 'driver-started', token: config.token, snapshot: report.initialNative });
    if (config.scenario === 'U1-0') {
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
    } else {
      report.source = 'explicit-cancel/not-started';
      mark('source-cancel', { source: report.source });
    }
    for (;;) {
      report.native = native.failureSnapshot();
      if (report.native.tsfnFinalized && report.native.threadJoined) break;
      if (performance.now() - started > 29000) throw new Error('Native ownership remains unconfirmed');
      await sleep(2);
    }
    if (config.scenario === 'U1-0') {
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
    if (message.type === 'driver-started') process.send({ ...message, callerMs: performance.now() - started });
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

async function observe(config) {
  const started = performance.now();
  const observation = { token: config.token, messages: [], events: [], callerExit: null, callerClose: null };
  const mark = (name, detail = {}) => observation.events.push({ name, ms: performance.now() - started, ...detail });
  const child = spawn(process.execPath, [script, '--caller', config.configPath],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', data => mark('caller-stdout', { data: String(data).slice(0, 65536) }));
  child.stderr.on('data', data => mark('caller-stderr', { data: String(data).slice(0, 65536) }));
  child.on('message', value => observation.messages.push({ ms: performance.now() - started, value }));
  child.on('error', error => mark('caller-error', errorFact(error)));
  child.on('exit', (code, signal) => { observation.callerExit = { code, signal, ms: performance.now() - started }; });
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  child.on('close', (code, signal) => {
    observation.callerClose = { code, signal, ms: performance.now() - started };
    resolveDone();
  });
  const control = setTimeout(() => mark('caller-control', { signal: 'SIGTERM', returned: child.kill('SIGTERM') }), budgets.afterAwait);
  const deadline = setTimeout(() => {
    mark('observation-deadline');
    mark('caller-control', { signal: 'SIGKILL', returned: child.kill('SIGKILL') });
    resolveDone();
  }, budgets.observation);
  await done;
  clearTimeout(control); clearTimeout(deadline);
  return observation;
}

async function persist(file, record) {
  const started = performance.now();
  const child = spawn(process.execPath, [script, '--writer', file], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let receipt = null, close = null, error = null;
  child.stderr.resume();
  child.on('error', cause => { error = errorFact(cause); });
  child.on('message', value => { receipt = { ms: performance.now() - started, value }; });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  child.on('close', (code, signal) => { close = { code, signal, ms: performance.now() - started }; finish(); });
  child.send(record, cause => { if (cause) error = errorFact(cause); });
  const work = setTimeout(() => child.kill('SIGTERM'), budgets.writer);
  const total = setTimeout(() => { child.kill('SIGKILL'); finish(); }, budgets.writerObservation);
  await done;
  clearTimeout(work); clearTimeout(total);
  return { receipt, close, error };
}

async function schedule(values) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.version, 'v22.23.2');
  const output = path.resolve(values.output);
  assert(!fs.existsSync(output), 'Evidence directory must be new');
  const binary = path.resolve(values.binary);
  const dependencyRoot = path.resolve(values['dependency-root']);
  assert.equal(require(path.join(dependencyRoot, 'node-pty/package.json')).version, '1.2.0-beta.12');
  fs.mkdirSync(output, { recursive: true });
  const entries = ['U1-0', 'U1-1'].flatMap(scenario => Array.from({ length: 3 }, (_, index) =>
    ({ scenario, attempt: index + 1, token: randomBytes(16).toString('hex') })));
  save(path.join(output, 'schedule.json'), { platform: process.platform, arch: process.arch,
    kernel: os.release(), versions: process.versions, binary, binaryHash: hash(fs.readFileSync(binary)),
    dependencyRoot, budgets, entries, notScheduled: ['Linux U1-2..5', 'macOS U1-0..7', 'Windows W1'],
    sources: [script, fileURLToPath(new URL('./native-failure-verifier-v1.mjs', import.meta.url)),
      require.resolve(path.join(dependencyRoot, '@xterm/headless'))].map(source => {
      const snapshot = path.basename(source);
      fs.copyFileSync(source, path.join(output, snapshot));
      return { source, snapshot, hash: hash(fs.readFileSync(source)) };
    }) });
  const results = [];
  let admitted = true;
  for (const entry of entries) {
    if (!admitted) { results.push({ ...entry, status: 'not-run', reason: 'Previous ownership or evidence unconfirmed' }); continue; }
    const directory = path.join(output, `${entry.scenario}-${entry.attempt}`);
    fs.mkdirSync(directory);
    const configPath = path.join(directory, 'config.json');
    const config = { ...entry, binary, binaryHash: hash(fs.readFileSync(binary)), dependencyRoot,
      cwd: process.cwd(), configPath, expected: await expectedInput(entry.token, dependencyRoot) };
    save(configPath, config);
    const observation = await observe(config);
    const evidence = await persist(path.join(directory, 'raw.json'), observation);
    save(path.join(directory, 'evidence.json'), evidence);
    const assessment = assessCase(config, observation, evidence);
    results.push({ ...entry, status: 'executed', ...assessment });
    admitted = assessment.safeToContinue;
    console.log(JSON.stringify(results.at(-1)));
  }
  save(path.join(output, 'summary.json'), results);
  const verification = await verifySaved(output);
  console.log(JSON.stringify({ output, ...verification }));
  if (!verification.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const { values } = parseArgs({ options: { output: { type: 'string' }, binary: { type: 'string' },
    'dependency-root': { type: 'string' }, fixture: { type: 'string' }, driver: { type: 'string' },
    caller: { type: 'string' }, writer: { type: 'string' }, 'verify-saved': { type: 'string' } } });
  try {
    if (values.fixture) await fixture(JSON.parse(values.fixture));
    else if (values.driver) await driver(read(values.driver));
    else if (values.caller) await caller(read(values.caller));
    else if (values.writer) process.once('message', record => {
      const bytes = JSON.stringify(record, null, 2) + '\n';
      fs.writeFileSync(values.writer, bytes, { flag: 'wx' });
      process.send({ bytes: Buffer.byteLength(bytes), hash: hash(bytes) }, () => process.disconnect());
    });
    else if (values['verify-saved']) {
      const result = await verifySaved(path.resolve(values['verify-saved']));
      console.log(JSON.stringify(result));
      if (!result.pass) process.exitCode = 1;
    } else await schedule(values);
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
