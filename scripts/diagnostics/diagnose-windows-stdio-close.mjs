// Independent Windows standard-handle controls; no PTY or production module is loaded.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardProcess, PROCESS_GUARD_BUDGETS } from './diagnostic-process-guard-v2.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(ENTRY), '../..');
const SOURCE = 'scripts/diagnostics/windows-stdio-close-control.c';
const GUARD_SOURCE = 'scripts/diagnostics/diagnostic-process-guard-v2.mjs';
const FROZEN_GUARD_LF_HASH = 'efb430fc16d1c673cf0ad88fc7b2df2d3649c60922b9cf0288ec7d146f241ade';
const INPUTS = [
  'scripts/diagnostics/diagnose-windows-stdio-close.mjs', SOURCE,
  'scripts/diagnostics/diagnostic-process-guard-v2.mjs',
  '.github/workflows/runtime-windows-stdio-close.yml',
  'docs/design-docs/runtime-execution-lifecycle-contract.md',
];
const SETTINGS = Object.freeze({ ...PROCESS_GUARD_BUDGETS, holdMs: 100, fixtureTtlMs: 3000,
  maxLineBytes: 512, buildTimeoutMs: 120000, channelCleanupMs: 100 });
const SCHEDULE = ['close-wait', 'keep-open', 'close-exit'].flatMap((mode) => [1, 2, 3]
  .map((iteration) => ({ id: `${mode}-${iteration}`, mode, iteration })));
const SCHEMA = 'windows-stdio-close-evidence-v1';
const NATIVE_OPERATIONS = new Set(['control-read', 'command-frame', 'command-fields', 'command-identity',
  'stdio-owner', 'stdout-type', 'stderr-type', 'stdout-marker', 'stderr-marker', 'written-record',
  'stdout-write', 'stderr-write', 'marker-short-write', 'closed-record', 'stdout-set', 'stdout-close',
  'stderr-set', 'stderr-close', 'keep-open-command', 'challenge-order', 'pong-record', 'exit-permission',
  'exiting-record', 'command-type']);
const EXECUTABLE = 'build/windows-stdio-close-control.exe';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lfHash = (bytes) => hash(bytes.toString('utf8').replace(/\r\n/g, '\n'));
const nonce = () => randomBytes(16).toString('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const snapshotPath = (root, relative) => path.join(root, 'sources', relative);
const expectedMarker = (name, runId) => Buffer.from(`${name}:${runId}\n`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const decimal = (value) => { assert.equal(typeof value, 'string'); assert.match(value, /^\d+$/); return BigInt(value); };
const boundedInteger = (value) => {
  const number = Number(decimal(value));
  assert(Number.isSafeInteger(number) && number >= 0);
  return number;
};
const windowsPath = (value) => path.win32.normalize(value).toLowerCase();

function filesUnder(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert(!entry.isSymbolicLink(), `Evidence symlink: ${entry.name}`);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(path.join(directory, entry.name), name) : [name];
  }).sort();
}

function seal(directory) {
  writeJSON(path.join(directory, 'manifest.json'), { algorithm: 'sha256', files: Object.fromEntries(
    filesUnder(directory).filter((file) => file !== 'manifest.json')
      .map((file) => [file, hash(fs.readFileSync(path.join(directory, file)))])) });
}

function checkManifest(directory, errors) {
  try {
    const saved = readJSON(path.join(directory, 'manifest.json'));
    const actual = filesUnder(directory).filter((file) => file !== 'manifest.json');
    if (saved.algorithm !== 'sha256' || !same(Object.keys(saved.files).sort(), actual)) errors.push('Manifest exact inventory mismatch');
    for (const [file, digest] of Object.entries(saved.files)) {
      if (path.isAbsolute(file) || file.split('/').includes('..') || file.includes('\\')) {
        errors.push(`Unsafe manifest path: ${file}`); continue;
      }
      try { if (hash(fs.readFileSync(path.join(directory, file))) !== digest) errors.push(`Hash mismatch: ${file}`); }
      catch (error) { errors.push(`${file}: ${error.message}`); }
    }
  } catch (error) { errors.push(`Manifest: ${error.message}`); }
}

function recorder(file) {
  let sequence = 0;
  fs.writeFileSync(file, '', { flag: 'wx' });
  return (event) => {
    const value = { ...event, sequence: ++sequence, observedNs: String(process.hrtime.bigint()) };
    fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
    return value;
  };
}

function readTrace(file, errors) {
  try {
    const events = fs.readFileSync(file, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
    let previous = -1n;
    for (const [index, event] of events.entries()) {
      if (event.sequence !== index + 1) errors.push(`Trace sequence mismatch: ${path.basename(file)}:${index + 1}`);
      const time = decimal(event.observedNs);
      if (time < previous) errors.push(`Trace clock regression: ${path.basename(file)}:${index + 1}`);
      previous = time;
    }
    return events;
  } catch (error) { errors.push(`Trace: ${path.basename(file)}: ${error.message}`); return []; }
}

function splitWire(line) {
  assert.equal(typeof line, 'string');
  assert(Buffer.byteLength(line, 'utf8') <= SETTINGS.maxLineBytes, 'Wire line too long');
  assert.match(line, /^[\x20-\x7e\t]+\n$/, 'Wire must be one bounded ASCII LF line');
  const fields = line.slice(0, -1).split('\t');
  assert.equal(fields[0], 'DSCG07/1');
  assert.match(fields[2] ?? '', /^[a-f0-9]{32}$/);
  return fields;
}

function parseNative(line) {
  const fields = splitWire(line);
  assert(fields.length >= 7, 'Incomplete native prefix');
  const [version, type, runId, sequence, pid, qpc, frequency, ...rest] = fields;
  const message = { version, type, runId, sequence: boundedInteger(sequence), pid: boundedInteger(pid), qpc, frequency };
  assert(message.sequence > 0 && message.pid > 0 && decimal(frequency) > 0n);
  decimal(qpc);
  const lengths = { HELLO: 1, WRITTEN: 5, CLOSED: 8, PONG: 2, EXITING: 2, ERROR: 2 };
  assert.equal(rest.length, lengths[type], `Unknown native type or field count: ${type}`);
  if (type === 'HELLO') {
    assert(['close-wait', 'keep-open', 'close-exit'].includes(rest[0])); message.mode = rest[0];
  } else if (type === 'WRITTEN') {
    [message.outBytes, message.errBytes, message.outType, message.errType, message.distinct] = rest.map(boundedInteger);
  } else if (type === 'CLOSED') {
    [message.outSetOK, message.outSetErr, message.outCloseOK, message.outCloseErr,
      message.errSetOK, message.errSetErr, message.errCloseOK, message.errCloseErr] = rest.map(boundedInteger);
    for (const key of ['outSetOK', 'outCloseOK', 'errSetOK', 'errCloseOK']) assert([0, 1].includes(message[key]));
  } else if (type === 'PONG' || type === 'EXITING') {
    assert(['1', '2'].includes(rest[0])); assert.match(rest[1], /^[a-f0-9]{32}$/);
    message.phase = Number(rest[0]); message.token = rest[1];
    if (type === 'EXITING') assert.equal(message.phase, 2);
  } else {
    assert(NATIVE_OPERATIONS.has(rest[0]), 'Unknown native operation');
    message.operation = rest[0]; message.error = boundedInteger(rest[1]);
  }
  return message;
}

function parseControl(line) {
  const fields = splitWire(line);
  assert.equal(fields.length, 5);
  const [, type, runId, phase, token] = fields;
  assert(['PING', 'EXIT'].includes(type)); assert(['1', '2'].includes(phase));
  assert.match(token, /^[a-f0-9]{32}$/);
  if (type === 'EXIT') assert.equal(phase, '2');
  return { type, runId, phase: Number(phase), token };
}

function successfulClose(message) {
  return message?.type === 'CLOSED' && ['outSet', 'outClose', 'errSet', 'errClose']
    .every((prefix) => message[`${prefix}OK`] === 1 && message[`${prefix}Err`] === 0);
}

async function runController(directory) {
  const config = readJSON(path.join(directory, 'config.json'));
  const append = recorder(path.join(directory, 'trace.ndjson'));
  const events = [];
  const output = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  for (const name of ['stdout.bin', 'stderr.bin', 'native-control.bin', 'control-sent.bin']) {
    fs.writeFileSync(path.join(directory, name), '', { flag: 'wx' });
  }
  let child;
  let channel;
  let server;
  const sockets = new Set();
  let nativeSequence = 0;
  let nativeQpc = -1n;
  let nativeFrequency;
  let guardStart;
  let guardReturned = false;
  let exited = false;
  let deadline = false;
  let failed = false;
  let holdTimer;
  let firstPong;
  let token1;
  let token2;
  let permissionSent = false;
  let pending = false;
  const record = (event) => {
    const value = append(event); events.push(value);
    if (event.type === 'guard-start') guardStart = value;
    if (event.type === 'guard-deadline') deadline = true;
    if (event.type === 'child-exit') exited = true;
    if (event.type === 'guard-returned') {
      guardReturned = true;
      writeJSON(path.join(directory, 'guard-result.json'), event.result);
    }
    if (!pending) { pending = true; queueMicrotask(() => { pending = false; advance(); }); }
    return value;
  };
  const fail = (reason) => { if (!failed) { failed = true; record({ type: 'protocol-failure', reason }); } };
  const possibleCloseExitTransport = (error) => config.mode === 'close-exit' && ['EPIPE', 'ECONNRESET'].includes(error?.code);
  const live = () => guardStart && !failed && !guardReturned && !deadline && !exited
    && process.hrtime.bigint() - BigInt(guardStart.t0Ns) < 1000_000_000n;
  const send = (type, phase, token) => {
    if (!live()) { fail('Control requested after boundary'); return; }
    if (!channel || channel.destroyed) {
      if (config.mode === 'close-exit') {
        record({ type: 'control-unavailable', phase, token, reason: 'peer-channel-already-closed' }); return;
      }
      fail('Control requested without channel'); return;
    }
    const line = `DSCG07/1\t${type}\t${config.runId}\t${phase}\t${token}\n`;
    const command = parseControl(line);
    fs.appendFileSync(path.join(directory, 'control-sent.bin'), line);
    record({ type: 'control-sent', line, command });
    channel.write(line, (error) => {
      record({ type: 'control-flushed', command, error: error ? String(error) : null, code: error?.code ?? null });
      if (error && !possibleCloseExitTransport(error)) fail('Control write failed');
    });
  };
  const ownedSourcesClosed = () => ['stdout', 'stderr'].every((name) =>
    events.some((event) => event.type === 'capture-end' && event.stream === name && !event.afterLocalDestroy)
    && events.some((event) => event.type === 'capture-close' && event.stream === name && !event.afterLocalDestroy)
    && output[name].equals(expectedMarker(name, config.runId)))
    && events.some((event) => event.type === 'native-message' && successfulClose(event.message));
  function advance() {
    if (config.mode === 'keep-open' || !live() || !ownedSourcesClosed()) return;
    if (!token1) { token1 = nonce(); record({ type: 'challenge-created', phase: 1, token: token1 }); send('PING', 1, token1); return; }
    if (!firstPong || token2) return;
    const holdEnd = BigInt(firstPong.observedNs) + BigInt(SETTINGS.holdMs) * 1_000_000n;
    const now = process.hrtime.bigint();
    if (now < holdEnd) {
      if (!holdTimer) holdTimer = setTimeout(() => { holdTimer = undefined; advance(); }, Math.ceil(Number(holdEnd - now) / 1e6));
      return;
    }
    token2 = nonce(); record({ type: 'hold-complete', firstPongSequence: firstPong.sequence });
    record({ type: 'challenge-created', phase: 2, token: token2 }); send('PING', 2, token2);
  }
  record({ type: 'controller-start', config });
  try {
    const actualHash = hash(fs.readFileSync(config.executable));
    record({ type: 'executable-observed', path: config.executable, sha256: actualHash });
    assert.equal(actualHash, config.executableHash, 'Executable changed before spawn');
    server = net.createServer((candidate) => {
      sockets.add(candidate);
      candidate.on('close', () => sockets.delete(candidate));
      candidate.on('error', (error) => {
        record({ type: 'control-error', error: String(error), code: error.code ?? null });
        if (!possibleCloseExitTransport(error)) fail('Control channel error');
      });
      if (channel) { record({ type: 'duplicate-connection' }); fail('Duplicate native connection'); candidate.destroy(); return; }
      channel = candidate;
      record({ type: 'control-connected' });
      let buffered = Buffer.alloc(0);
      candidate.on('data', (bytes) => {
        fs.appendFileSync(path.join(directory, 'native-control.bin'), bytes);
        buffered = Buffer.concat([buffered, bytes]);
        for (;;) {
          const end = buffered.indexOf(10);
          if (end < 0) {
            if (buffered.length >= SETTINGS.maxLineBytes) { fail('Unterminated native line too long'); candidate.destroy(); }
            break;
          }
          const lineBytes = buffered.subarray(0, end + 1); buffered = buffered.subarray(end + 1);
          const line = lineBytes.toString('ascii');
          try {
            assert(lineBytes.every((value) => value < 128), 'Non-ASCII native bytes');
            const message = parseNative(line);
            assert.equal(message.runId, config.runId); assert.equal(message.pid, child?.pid);
            assert.equal(message.sequence, ++nativeSequence);
            assert(decimal(message.qpc) >= nativeQpc); nativeQpc = decimal(message.qpc);
            if (nativeFrequency === undefined) nativeFrequency = message.frequency;
            assert.equal(message.frequency, nativeFrequency);
            if (message.sequence === 1) { assert.equal(message.type, 'HELLO'); assert.equal(message.mode, config.mode); }
            const observed = record({ type: 'native-message', line, message });
            if (message.type === 'ERROR') fail(`Native error: ${message.operation}/${message.error}`);
            if (message.type === 'PONG') {
              if (message.phase === 1 && message.token === token1 && !firstPong && live()) firstPong = observed;
              else if (message.phase === 2 && message.token === token2 && firstPong && !permissionSent && live()) {
                permissionSent = true; send('EXIT', 2, token2);
              } else fail('Unexpected, duplicate or late pong');
            }
          } catch (error) { record({ type: 'invalid-native-message', line, error: String(error) }); fail('Invalid native protocol'); candidate.destroy(); }
        }
      });
      candidate.on('end', () => record({ type: 'control-end' }));
      candidate.on('close', () => {
        if (buffered.length) fail('Partial native message at channel close');
        record({ type: 'control-close' });
      });
    });
    server.on('error', (error) => { record({ type: 'control-server-error', error: String(error) }); fail('Control listener failed'); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.pipeName, resolve); });
    record({ type: 'control-listening', pipeName: config.pipeName });
    await guardProcess({ command: config.executable,
      args: ['--pipe', config.pipeName, '--run', config.runId, '--mode', config.mode],
      spawnOptions: { windowsHide: true }, record,
      capture: (name, bytes) => { output[name] = Buffer.concat([output[name], bytes]); fs.appendFileSync(path.join(directory, `${name}.bin`), bytes); },
      onSpawn: (created) => { child = created; },
    });
    record({ type: 'controller-guard-observed' });
  } catch (error) { record({ type: 'controller-error', error: String(error) }); failed = true; }
  clearTimeout(holdTimer);
  if (server) {
    const start = process.hrtime.bigint();
    while (channel && !channel.destroyed && process.hrtime.bigint() - start < BigInt(SETTINGS.channelCleanupMs) * 1_000_000n) await delay(5);
    for (const socket of sockets) if (!socket.destroyed) {
      record({ type: 'control-local-destroy', incomplete: true }); socket.destroy();
    }
    let serverClosed = false;
    server.close(() => { serverClosed = true; record({ type: 'control-server-closed' }); });
    server.unref();
    const cleanupEnd = process.hrtime.bigint() + BigInt(SETTINGS.channelCleanupMs) * 1_000_000n;
    while (!serverClosed && process.hrtime.bigint() < cleanupEnd) await delay(5);
    if (!serverClosed) record({ type: 'control-server-close-incomplete' });
  }
  await delay(20);
  record({ type: 'controller-finished' });
}

function outerController(directory) {
  const record = recorder(path.join(directory, 'outer.ndjson'));
  for (const name of ['stdout', 'stderr']) fs.writeFileSync(path.join(directory, `outer-${name}.bin`), '', { flag: 'wx' });
  const t0 = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - t0) / 1e6;
  const emit = (type, fields = {}) => record({ type, atMs: elapsed(), ...fields });
  let child;
  let exit = null;
  let returned = false;
  let timedOut = false;
  let cutoff;
  let final;
  const captures = {};
  emit('outer-start', { t0Ns: String(t0), cutoffMs: SETTINGS.outerCutoffMs, observationMs: SETTINGS.outerObservationMs });
  return new Promise((resolve) => {
    const finish = (reason) => {
      if (returned) return;
      returned = true; clearTimeout(cutoff); clearTimeout(final);
      const result = { reason, exit, timedOut, returnedAtMs: elapsed(), captures };
      emit('outer-returned', { result }); writeJSON(path.join(directory, 'outer-result.json'), result); resolve(result);
    };
    const terminate = () => {
      if (returned || timedOut) return;
      if (elapsed() < SETTINGS.outerCutoffMs) { cutoff = setTimeout(terminate, Math.ceil(SETTINGS.outerCutoffMs - elapsed())); return; }
      timedOut = true; emit('outer-cutoff');
      if (!exit) {
        emit('outer-termination-request', { target: 'owned-controller-handle' });
        try { emit('outer-termination-returned', { value: child.kill('SIGKILL') }); }
        catch (error) { emit('outer-termination-threw', { error: String(error) }); }
      }
    };
    const completed = () => {
      if (!timedOut && elapsed() >= SETTINGS.outerCutoffMs) terminate();
      if (exit && Object.values(captures).every((state) => state.close)) finish('exit-and-capture-close');
    };
    try { child = spawn(process.execPath, [ENTRY, '--controller', directory], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (error) { emit('outer-spawn-threw', { error: String(error) }); finish('spawn-threw'); return; }
    emit('outer-spawn-returned', { pid: child.pid ?? null });
    for (const name of ['stdout', 'stderr']) {
      const stream = child[name];
      captures[name] = { end: false, close: false, locallyDestroyed: false, error: null };
      stream.on('data', (bytes) => { fs.appendFileSync(path.join(directory, `outer-${name}.bin`), bytes); emit('outer-data', { stream: name, bytes: bytes.length }); });
      stream.on('end', () => { if (!captures[name].locallyDestroyed) captures[name].end = true; emit('outer-end', { stream: name }); });
      stream.on('close', () => { captures[name].close = true; emit('outer-close', { stream: name }); completed(); });
      stream.on('error', (error) => { captures[name].error = String(error); emit('outer-error', { stream: name, error: String(error) }); });
    }
    child.on('exit', (code, signal) => { exit = { code, signal }; emit('outer-child-exit', exit); completed(); });
    child.on('error', (error) => emit('outer-child-error', { error: String(error) }));
    cutoff = setTimeout(terminate, Math.max(0, SETTINGS.outerCutoffMs - elapsed()));
    final = setTimeout(() => {
      terminate();
      for (const [name, state] of Object.entries(captures)) if (!state.close) {
        state.locallyDestroyed = true; emit('outer-local-destroy', { stream: name, incomplete: true });
        child[name].destroy(); child[name].unref?.();
      }
      child.unref(); finish('absolute-outer-budget');
    }, Math.max(0, SETTINGS.outerCutoffMs + SETTINGS.outerObservationMs - SETTINGS.settlementReserveMs - elapsed()));
  });
}

function assessCase(config, trace, result, outerTrace, outer, bytes) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const all = (type) => trace.filter((event) => event.type === type);
  const one = (type) => { const found = all(type); check(found.length === 1, `Exactly one ${type}`); return found[0]; };
  const before = (a, b) => Boolean(a && b && a.sequence < b.sequence && decimal(a.observedNs) <= decimal(b.observedNs));
  const start = one('guard-start');
  const returned = one('guard-returned');
  const spawnAttempt = one('spawn-attempt');
  const spawned = one('spawn-returned');
  const exit = one('child-exit');
  one('child-spawn'); one('controller-finished');
  const controller = one('controller-start');
  check(same(controller?.config, config), 'Controller config matches frozen case');
  check(same(start?.budgets, PROCESS_GUARD_BUDGETS), 'Unchanged guard budgets');
  check(same(returned?.result, result), 'Saved first result matches raw guard return');
  check(spawnAttempt?.synthetic === false, 'Actual ChildProcess, not synthetic spawn');
  check(spawnAttempt?.command === config.executable, 'Spawn uses recorded executable');
  check(same(spawnAttempt?.args, ['--pipe', config.pipeName, '--run', config.runId, '--mode', config.mode]), 'Exact native arguments');
  const binary = one('executable-observed');
  check(binary?.path === config.executable && binary.sha256 === config.executableHash, 'Actual executable byte fingerprint before spawn');
  const listening = one('control-listening');
  check(listening?.pipeName === config.pipeName && before(listening, start), 'Private listener ready before spawn budget');
  one('control-connected'); one('control-server-closed');
  check(before(exit, returned), 'Guard does not return before actual owned-child exit');
  check(same(result?.exit, exit ? { code: exit.code, signal: exit.signal } : null), 'First process outcome matches raw exit');
  check(result?.spawnError === null, 'No unexpected spawn failure');
  check(result?.returnedAtMs >= 0 && result.returnedAtMs <= 2000 && returned?.atMs >= 0 && returned.atMs <= 2000, 'Guard result uses frozen 2000 ms budget');
  if (start && returned) {
    const delta = decimal(returned.observedNs) - decimal(start.t0Ns);
    check(delta >= 0n && delta <= 2000_000_000n, 'Independent raw guard observation inside 2000 ms');
    check(decimal(start.t0Ns) <= decimal(start.observedNs), 'Guard t0 cannot be after start observation');
  }
  const invalidTypes = ['protocol-failure', 'invalid-native-message', 'duplicate-connection', 'control-server-error',
    'controller-error', 'capture-error', 'spawn-hook-error', 'deadline-hook-error', 'control-local-destroy', 'control-server-close-incomplete'];
  check(!trace.some((event) => invalidTypes.includes(event.type)), 'No hidden protocol/capture/controller failure or forced channel cleanup');
  const transportErrors = [...all('control-error'), ...all('control-flushed').filter((event) => event.error)];
  check(transportErrors.every((event) => config.mode === 'close-exit' && ['EPIPE', 'ECONNRESET'].includes(event.code)), 'Only close-exit peer termination transport errors may be expected');
  const prior = trace.filter((event) => event.sequence < (returned?.sequence ?? 0));
  const endings = {};
  let truncated = false;
  let allEnded = true;
  let captureError = false;
  for (const name of ['stdout', 'stderr']) {
    const events = prior.filter((event) => event.stream === name);
    const end = events.find((event) => event.type === 'capture-end' && !event.afterLocalDestroy);
    const close = events.find((event) => event.type === 'capture-close');
    const local = events.some((event) => event.type === 'capture-local-destroy');
    const error = events.filter((event) => event.type === 'capture-error').at(-1)?.error ?? null;
    const count = events.filter((event) => event.type === 'capture-data').reduce((sum, event) => sum + event.bytes, 0);
    endings[name] = { end, close };
    allEnded &&= Boolean(end); truncated ||= local; captureError ||= Boolean(error);
    check(same(result?.streams?.[name], { endObserved: Boolean(end), closeObserved: Boolean(close), localDestroyed: local, bytes: count, error }), `${name} first capture state independently derived`);
    const allBytes = all('capture-data').filter((event) => event.stream === name).reduce((sum, event) => sum + event.bytes, 0);
    check(bytes[name].length === allBytes && bytes[name].equals(expectedMarker(name, config.runId)), `${name} exact marker and byte accounting`);
  }
  const deadline = all('guard-deadline')[0];
  check(result?.childCloseObserved === prior.some((event) => event.type === 'child-close'), 'Child close independently derived');
  const integrity = captureError ? 'error' : truncated ? 'truncated' : deadline ? 'deadline-incomplete' : allEnded ? 'complete' : 'unknown';
  check(result?.captureIntegrity === integrity, 'Capture integrity independently derived, deadline is not complete');
  const nativeEvents = all('native-message');
  const native = [];
  let previousQpc = -1n;
  let frequency;
  for (const [index, event] of nativeEvents.entries()) {
    try {
      const message = parseNative(event.line); native.push({ event, message });
      check(same(message, event.message), 'Native parsed message matches raw wire');
      check(message.sequence === index + 1 && message.runId === config.runId && message.pid === spawned?.pid, 'Native sequence and directly owned identity');
      check(decimal(message.qpc) >= previousQpc, 'Native QPC does not regress'); previousQpc = decimal(message.qpc);
      if (frequency === undefined) frequency = message.frequency;
      check(message.frequency === frequency, 'Native QPC frequency remains fixed');
    } catch (error) { errors.push(`Native wire: ${error.message}`); }
  }
  check(bytes.native.equals(Buffer.from(nativeEvents.map((event) => event.line).join(''))), 'All native wire bytes persisted and parsed without omissions');
  const nativeOf = (type) => native.filter((entry) => entry.message.type === type);
  check(native[0]?.message.type === 'HELLO' && nativeOf('HELLO').length === 1 && native[0]?.message.mode === config.mode, 'Native hello authenticates case mode');
  const written = nativeOf('WRITTEN');
  check(written.length === 1 && written[0].message.outBytes === 40 && written[0].message.errBytes === 40
    && written[0].message.outType === 3 && written[0].message.errType === 3 && written[0].message.distinct === 1, 'Native writes and owned distinct pipe types');
  check(!nativeOf('ERROR').length, 'No native error or fixture TTL failure');
  const closes = nativeOf('CLOSED');
  const pongs = nativeOf('PONG');
  const commands = [];
  for (const event of all('control-sent')) {
    try { const command = parseControl(event.line); check(same(command, event.command), 'Control command matches raw wire'); check(command.runId === config.runId, 'Control identity'); commands.push({ event, command }); }
    catch (error) { errors.push(`Control wire: ${error.message}`); }
  }
  check(bytes.sent.equals(Buffer.from(all('control-sent').map((event) => event.line).join(''))), 'All control wire bytes persisted');
  const pings = commands.filter((entry) => entry.command.type === 'PING');
  const permits = commands.filter((entry) => entry.command.type === 'EXIT');
  const creations = all('challenge-created');
  const unavailable = all('control-unavailable');
  check(creations.length === pings.length + unavailable.length, 'Every challenge has a recorded command or already-closed peer channel');
  check(!unavailable.length || (config.mode === 'close-exit' && unavailable.length === 1 && !commands.length), 'Unavailable channel only belongs to a close-exit challenge attempt');
  const sourceGate = (event) => Boolean(event && closes.length === 1 && successfulClose(closes[0].message)
    && before(closes[0].event, event) && ['stdout', 'stderr'].every((name) => before(endings[name].end, event) && before(endings[name].close, event)));
  for (const [index, ping] of pings.entries()) {
    const created = creations[index];
    check(created?.phase === ping.command.phase && created.token === ping.command.token && before(created, ping.event), 'Fresh challenge event matches actual command');
    check(sourceGate(created), 'Fresh challenge created after independently observed dual EOF/close and native receipt');
    check(before(ping.event, returned) && before(ping.event, exit), 'Challenge occurs before guard return and child exit notification');
    if (start) check(decimal(ping.event.observedNs) - decimal(start.t0Ns) < 1000_000_000n, 'No challenge after absolute deadline');
  }
  for (const event of unavailable) {
    check(event.phase === 1 && event.token === creations[0]?.token && before(creations[0], event)
      && sourceGate(creations[0]) && event.reason === 'peer-channel-already-closed', 'Unavailable peer attempt still requires complete source preconditions');
    if (start) check(decimal(event.observedNs) - decimal(start.t0Ns) < 1000_000_000n, 'No unavailable-peer challenge after deadline');
  }
  let preconditionEstablished = false;
  let rejection = null;
  if (config.mode === 'close-wait') {
    check(same(native.map((entry) => entry.message.type), ['HELLO', 'WRITTEN', 'CLOSED', 'PONG', 'PONG', 'EXITING']), 'Exact close-wait native sequence');
    check(closes.length === 1 && successfulClose(closes[0].message), 'Both native owners closed once successfully');
    check(pings.length === 2 && pongs.length === 2 && permits.length === 1, 'Two fresh responses before exactly one exit permission');
    const [ping1, ping2] = pings; const [pong1, pong2] = pongs; const permit = permits[0];
    const matched = [0, 1].every((index) => pings[index] && pongs[index]
      && pings[index].command.phase === index + 1 && pongs[index].message.phase === index + 1
      && pings[index].command.token === pongs[index].message.token && before(pings[index].event, pongs[index].event));
    check(matched, 'Fresh tokens prove post-EOF subject responses');
    check(ping1 && ping2 && ping1.command.token !== ping2.command.token, 'Second challenge is different');
    const held = Boolean(pong1 && creations[1] && decimal(creations[1].observedNs) - decimal(pong1.event.observedNs) >= 100_000_000n);
    check(held && before(pong1?.event, ping2?.event), 'Second challenge generated after absolute 100 ms hold');
    const exiting = nativeOf('EXITING')[0];
    check(permit?.command.phase === 2 && permit.command.token === ping2?.command.token
      && before(pong2?.event, permit?.event) && before(permit?.event, exiting?.event)
      && exiting?.message.token === ping2?.command.token && before(permit?.event, exit), 'Exit strictly follows second response and matching permit');
    for (const event of [pong1?.event, pong2?.event, permit?.event]) if (event && start) {
      check(decimal(event.observedNs) - decimal(start.t0Ns) < 1000_000_000n, 'Handshake and permission complete before deadline');
    }
    preconditionEstablished = Boolean(matched && held && sourceGate(creations[0]) && sourceGate(creations[1])
      && before(pong2?.event, permit?.event) && before(permit?.event, exit));
    check(preconditionEstablished, 'Positive live-after-EOF precondition established');
  } else if (config.mode === 'keep-open') {
    rejection = 'stdio-remained-open-until-deadline';
    check(same(native.map((entry) => entry.message.type), ['HELLO', 'WRITTEN']), 'Keep-open native startup succeeds without close or pong');
    check(!commands.length && !creations.length, 'Keep-open cannot enter post-EOF challenge');
    check(all('guard-deadline').length === 1 && deadline?.atMs >= 1000 && deadline.atMs <= 2000, 'Keep-open reaches original deadline');
    if (start && deadline) check(decimal(deadline.observedNs) - decimal(start.t0Ns) >= 1000_000_000n, 'Deadline raw clock is not early');
    for (const name of ['stdout', 'stderr']) check(before(deadline, endings[name].end) && before(deadline, endings[name].close), `${name} held through deadline`);
    check(before(deadline, exit), 'Actual child remains until deadline intervention');
    check(all('termination-request').length === 1 && all('termination-returned').length === 1
      && all('termination-returned')[0].value === true && !all('termination-threw').length, 'Guard termination uses owned ChildProcess and is accepted');
    check(result?.kind === 'deadline-exceeded' && result.deadlineExceeded === true && result.captureIntegrity === 'deadline-incomplete', 'Keep-open raw deadline and incomplete capture preserved');
  } else {
    rejection = 'closed-and-exited-without-post-eof-response';
    check(same(native.map((entry) => entry.message.type), ['HELLO', 'WRITTEN', 'CLOSED']), 'Close-exit closes successfully and gives no pong');
    check(closes.length === 1 && successfulClose(closes[0].message), 'Negative close-exit actually closes both native owners');
    check(!pongs.length && !permits.length && pings.length <= 1, 'No independent subject response or exit permission');
    if (transportErrors.length || unavailable.length) {
      check(closes.length === 1 && successfulClose(closes[0].message) && allEnded && !captureError && !truncated
        && exit?.code === 0 && exit.signal === null && !nativeOf('ERROR').length, 'Expected close-exit transport observation requires complete native trajectory and natural exit');
    }
  }
  if (config.mode !== 'keep-open') {
    check(!deadline && !all('termination-request').length && !all('capture-local-destroy').length, 'Natural controls have no timeout, forced termination or capture truncation');
    check(result?.kind === 'natural-exit' && result.deadlineExceeded === false && result.captureIntegrity === 'complete', 'Natural raw outcome preserved independently of target precondition');
    check(exit?.code === 0 && exit.signal === null, 'Natural exit zero, no signal');
  }
  // A partially matching handshake cannot claim an established target precondition.
  preconditionEstablished &&= errors.length === 0;
  const outerStart = outerTrace.filter((event) => event.type === 'outer-start');
  const outerReturn = outerTrace.filter((event) => event.type === 'outer-returned');
  const outerExit = outerTrace.filter((event) => event.type === 'outer-child-exit');
  check(outerStart.length === 1 && outerReturn.length === 1 && outerExit.length === 1, 'Independent outer lifecycle present once');
  check(same(outerReturn[0]?.result, outer) && same(outer?.exit, { code: 0, signal: null }), 'Saved outer result is natural exit zero');
  check(outerExit[0]?.code === 0 && outerExit[0]?.signal === null && outer.timedOut === false, 'Actual outer process naturally exits');
  check(before(outerExit[0], outerReturn[0]), 'Outer return follows actual controller exit');
  check(!outerTrace.some((event) => ['outer-cutoff', 'outer-local-destroy', 'outer-error', 'outer-child-error', 'outer-spawn-threw'].includes(event.type)), 'Outer cutoff or capture failure not hidden');
  if (outerStart[0] && outerReturn[0]) {
    const delta = decimal(outerReturn[0].observedNs) - decimal(outerStart[0].t0Ns);
    check(delta >= 0n && delta < 5000_000_000n && outer.returnedAtMs < 5000, 'Outer natural completion does not use observation grace');
  }
  for (const name of ['stdout', 'stderr']) {
    const priorOuter = outerTrace.filter((event) => event.sequence < (outerReturn[0]?.sequence ?? 0));
    const end = priorOuter.find((event) => event.type === 'outer-end' && event.stream === name);
    const close = priorOuter.find((event) => event.type === 'outer-close' && event.stream === name);
    const locallyDestroyed = priorOuter.some((event) => event.type === 'outer-local-destroy' && event.stream === name);
    const error = priorOuter.filter((event) => event.type === 'outer-error' && event.stream === name).at(-1)?.error ?? null;
    check(Boolean(end && close && end.sequence < close.sequence), `${name} raw outer end and close precede return`);
    check(same(outer?.captures?.[name], { end: Boolean(end), close: Boolean(close), locallyDestroyed, error }), `${name} outer capture state independently derived`);
    check(!locallyDestroyed && !error, `${name} outer capture is complete without cancellation`);
    const total = outerTrace.filter((event) => event.type === 'outer-data' && event.stream === name).reduce((sum, event) => sum + event.bytes, 0);
    check(bytes[`outer-${name}`].length === total, `${name} outer bytes match trace`);
  }
  return { id: config.id, status: errors.length ? 'control-failure' : 'control-pass', errors,
    preconditionEstablished, rejection, rawOutcome: result?.kind ?? 'missing', captureIntegrity: result?.captureIntegrity ?? 'missing', synthetic: false, pty: false };
}

function verifyCase(root, entry, build, compareSaved = true) {
  const directory = path.join(root, 'cases', entry.id);
  const evidenceErrors = [];
  checkManifest(directory, evidenceErrors);
  const get = (name, fallback) => { try { return readJSON(path.join(directory, name)); } catch (error) { evidenceErrors.push(`${name}: ${error.message}`); return fallback; } };
  const config = get('config.json', entry);
  for (const [key, expected] of Object.entries(entry)) if (config[key] !== expected) evidenceErrors.push(`Schedule mismatch: ${key}`);
  if (!same(config.settings, SETTINGS) || !/^[a-f0-9]{32}$/.test(config.runId ?? '')
    || config.pipeName !== `\\\\.\\pipe\\dsc-g07-${config.runId}`) evidenceErrors.push('Invalid frozen parameters or private pipe identity');
  if (config.executableHash !== (build?.binaryHash ?? null) || typeof config.executable !== 'string'
    || windowsPath(config.executable ?? '') !== windowsPath(build?.outputAbsolute ?? '')) evidenceErrors.push('Case executable not bound to actual build');
  if (fs.existsSync(path.join(directory, 'not-run.json'))) {
    return { id: entry.id, status: 'not-run', preconditionEstablished: false, actualCreated: 0,
      reason: get('not-run.json', null), evidenceErrors };
  }
  const trace = readTrace(path.join(directory, 'trace.ndjson'), evidenceErrors);
  const outer = readTrace(path.join(directory, 'outer.ndjson'), evidenceErrors);
  const bytes = {};
  for (const [key, filename] of Object.entries({ stdout: 'stdout.bin', stderr: 'stderr.bin', native: 'native-control.bin', sent: 'control-sent.bin',
    'outer-stdout': 'outer-stdout.bin', 'outer-stderr': 'outer-stderr.bin' })) {
    try { bytes[key] = fs.readFileSync(path.join(directory, filename)); }
    catch (error) { evidenceErrors.push(`${filename}: ${error.message}`); bytes[key] = Buffer.alloc(0); }
  }
  let assessed;
  try { assessed = assessCase({ ...config, ...entry }, trace, get('guard-result.json', null), outer, get('outer-result.json', null), bytes); }
  catch (error) { assessed = { id: entry.id, status: 'control-failure', errors: [`Assessment: ${error.message}`], preconditionEstablished: false }; }
  if (compareSaved && !same(get('assessment.json', null), assessed)) evidenceErrors.push('Saved assessment differs from independent raw derivation');
  return { ...assessed, preconditionEstablished: !evidenceErrors.length && assessed.preconditionEstablished,
    actualCreated: trace.filter((event) => event.type === 'child-spawn').length,
    evidenceErrors, status: evidenceErrors.length ? 'evidence-error' : assessed.status };
}

function verifySaved(root, allowSynthetic = false) {
  const errors = [];
  checkManifest(root, errors);
  let environment;
  let build;
  try {
    assert.deepEqual(readJSON(path.join(root, 'schedule.json')), SCHEDULE);
    environment = readJSON(path.join(root, 'environment.json'));
    build = readJSON(path.join(root, 'build.json'));
    assert.equal(environment.schema, SCHEMA); assert.deepEqual(environment.settings, SETTINGS);
    assert.equal(environment.pty, false);
    assert.equal(environment.guardLfHash, FROZEN_GUARD_LF_HASH, 'Guard is the frozen d173c099 implementation');
    assert.match(environment.sourceCommit, /^[a-f0-9]{40}$/);
    assert.equal(typeof environment.gitStatus, 'string');
    if (environment.githubSha) assert.equal(environment.githubSha, environment.sourceCommit);
    if (environment.synthetic) assert(allowSynthetic, 'Synthetic archive cannot be accepted as Windows native evidence');
    else { assert.equal(environment.platform, 'win32'); assert.equal(environment.arch, 'x64'); assert.equal(environment.node, '22.23.2'); }
    assert.deepEqual(Object.keys(environment.sources).sort(), [...INPUTS].sort());
    for (const relative of INPUTS) {
      const bytes = fs.readFileSync(snapshotPath(root, relative));
      assert.equal(hash(bytes), environment.sources[relative], `Source snapshot digest: ${relative}`);
      if (relative === GUARD_SOURCE) assert.equal(lfHash(bytes), FROZEN_GUARD_LF_HASH, 'Actual archived guard LF fingerprint');
      if (!environment.synthetic) {
        const committed = execFileSync('git', ['show', `${environment.sourceCommit}:${relative}`], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
        assert.equal(lfHash(bytes), lfHash(committed), `Source differs from frozen Git input: ${relative}`);
      }
      if (relative.endsWith('/diagnose-windows-stdio-close.mjs') || relative.endsWith('/diagnostic-process-guard-v2.mjs')) {
        assert.equal(lfHash(bytes), lfHash(fs.readFileSync(path.join(ROOT, relative))), `Independent validator source mismatch: ${relative}`);
      }
    }
    assert.equal(build.output, EXECUTABLE);
    assert.equal(build.sourceHash, environment.sources[SOURCE]);
    assert.equal(build.synthetic, environment.synthetic);
    if (build.error) errors.push(`Compilation/setup failed: ${build.error}`);
    else {
      assert.equal(hash(fs.readFileSync(path.join(root, EXECUTABLE))), build.binaryHash, 'Compiled EXE digest');
      assert.equal(build.command.status, 0); assert.equal(build.command.signal, null); assert.equal(build.command.error, null);
      if (!environment.synthetic) {
        assert(build.compiler.path && /^[a-f0-9]{64}$/.test(build.compiler.sha256));
        assert.equal(build.command.file, build.compiler.path);
        assert(build.command.args.includes('/W4') && build.command.args.includes('/WX') && build.command.args.includes('/O2') && build.command.args.includes('/TC'));
        assert(build.command.args.includes(build.sourceAbsolute));
        assert(build.command.args.includes(`/Fe:${build.outputAbsolute}`));
        assert.equal(build.sdkEnvironment.CL, null); assert.equal(build.sdkEnvironment._CL_, null);
      }
    }
  } catch (error) { errors.push(`Input/build metadata: ${error.message}`); }
  // Per-case failures never short-circuit the frozen nine-case schedule.
  const cases = SCHEDULE.map((entry) => {
    try { return verifyCase(root, entry, build); }
    catch (error) { return { id: entry.id, status: 'evidence-error', preconditionEstablished: false, evidenceErrors: [String(error)] }; }
  });
  const synthetic = environment?.synthetic === true;
  return { schema: SCHEMA, scope: synthetic ? 'Synthetic verifier self-test only, not native process evidence' : 'Windows G07 process controls only; no PTY or product acceptance',
    checked: cases.length, actualCreated: synthetic ? 0 : cases.reduce((sum, entry) => sum + (entry.actualCreated ?? 0), 0), synthetic, pty: false,
    pass: errors.length === 0 && cases.every((entry) => entry.status === 'control-pass'), errors, cases };
}

function snapshotInputs(root, synthetic = false) {
  const sources = {};
  for (const relative of INPUTS) {
    const original = path.join(ROOT, relative);
    const bytes = fs.existsSync(original) ? fs.readFileSync(original) : Buffer.from(`Synthetic missing input: ${relative}\n`);
    if (!synthetic) assert(fs.existsSync(original), `Missing input: ${relative}`);
    const destination = snapshotPath(root, relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx' }); sources[relative] = hash(bytes);
  }
  const environment = { schema: SCHEMA, synthetic, pty: false, settings: SETTINGS, sources,
    guardLfHash: lfHash(fs.readFileSync(snapshotPath(root, GUARD_SOURCE))),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    gitStatus: execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }),
    githubSha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    platform: process.platform, arch: process.arch, node: process.versions.node, versions: process.versions,
    osRelease: os.release(), osVersion: os.version(), image: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
    execPath: process.execPath, createdAt: new Date().toISOString() };
  writeJSON(path.join(root, 'environment.json'), environment); return environment;
}

function syncCommand(file, args, cwd) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: SETTINGS.buildTimeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return { file, args, cwd, timeoutMs: SETTINGS.buildTimeoutMs, status: result.status, signal: result.signal,
    error: result.error ? String(result.error) : null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function compile(root, environment) {
  const build = { synthetic: false, output: EXECUTABLE, outputAbsolute: path.join(root, EXECUTABLE),
    sourceAbsolute: snapshotPath(root, SOURCE), sourceHash: environment.sources[SOURCE] };
  try {
    assert.equal(process.platform, 'win32', 'Native capture requires Windows');
    assert.equal(process.arch, 'x64', 'Frozen matrix requires x64');
    assert.equal(process.versions.node, '22.23.2', 'Frozen matrix requires Node 22.23.2');
    build.locate = syncCommand('where.exe', ['cl.exe'], root);
    assert.equal(build.locate.status, 0, 'Cannot locate MSVC');
    const compiler = fs.realpathSync(build.locate.stdout.trim().split(/\r?\n/)[0]);
    build.compiler = { path: compiler, sha256: hash(fs.readFileSync(compiler)) };
    build.sdkEnvironment = Object.fromEntries(['WindowsSdkDir', 'WindowsSDKVersion', 'VCToolsInstallDir', 'VCToolsVersion', 'VSCMD_VER', 'INCLUDE', 'LIB', 'LIBPATH', 'PATH', 'CL', '_CL_']
      .map((key) => [key, process.env[key] || null]));
    assert(!build.sdkEnvironment.CL && !build.sdkEnvironment._CL_, 'Unexpected compiler option override');
    fs.mkdirSync(path.join(root, 'build'));
    build.command = syncCommand(compiler, ['/nologo', '/W4', '/WX', '/O2', '/TC', '/Bv', build.sourceAbsolute,
      `/Fe:${build.outputAbsolute}`, `/Fo:${path.join(root, 'build', 'windows-stdio-close-control.obj')}`], path.join(root, 'build'));
    assert.equal(build.command.status, 0, `Compilation failed: ${build.command.stderr || build.command.stdout}`);
    assert.equal(build.command.signal, null); assert.equal(build.command.error, null);
    build.binaryHash = hash(fs.readFileSync(build.outputAbsolute));
  } catch (error) { build.error = String(error.stack ?? error); }
  writeJSON(path.join(root, 'build.json'), build); return build;
}

function configFor(entry, build, runId = nonce()) {
  return { ...entry, runId, pipeName: `\\\\.\\pipe\\dsc-g07-${runId}`, settings: SETTINGS,
    executable: build.outputAbsolute ?? '', executableHash: build.binaryHash ?? null };
}

async function runMatrix(root) {
  fs.mkdirSync(root, { recursive: false });
  writeJSON(path.join(root, 'schedule.json'), SCHEDULE);
  const environment = snapshotInputs(root);
  const build = compile(root, environment);
  fs.mkdirSync(path.join(root, 'cases'));
  for (const entry of SCHEDULE) {
    const directory = path.join(root, 'cases', entry.id); fs.mkdirSync(directory);
    writeJSON(path.join(directory, 'config.json'), configFor(entry, build));
    if (build.error) writeJSON(path.join(directory, 'not-run.json'), { reason: 'Compilation/setup failed', error: build.error });
    else {
      try { await outerController(directory); await delay(30); }
      catch (error) { writeJSON(path.join(directory, 'collection-error.json'), { error: String(error.stack ?? error) }); }
      const traceErrors = [];
      const trace = readTrace(path.join(directory, 'trace.ndjson'), traceErrors);
      const outerTrace = readTrace(path.join(directory, 'outer.ndjson'), traceErrors);
      const get = (file, fallback) => { try { return readJSON(path.join(directory, file)); } catch { return fallback; } };
      const bytes = {};
      for (const [name, file] of Object.entries({ stdout: 'stdout.bin', stderr: 'stderr.bin', native: 'native-control.bin', sent: 'control-sent.bin', 'outer-stdout': 'outer-stdout.bin', 'outer-stderr': 'outer-stderr.bin' })) {
        try { bytes[name] = fs.readFileSync(path.join(directory, file)); } catch { bytes[name] = Buffer.alloc(0); }
      }
      let assessed;
      try { assessed = assessCase(get('config.json'), trace, get('guard-result.json', null), outerTrace, get('outer-result.json', null), bytes); }
      catch (error) { assessed = { id: entry.id, status: 'control-failure', errors: [`Assessment: ${error.message}`], preconditionEstablished: false }; }
      writeJSON(path.join(directory, 'assessment.json'), assessed);
      if (traceErrors.length) writeJSON(path.join(directory, 'collection-trace-errors.json'), traceErrors);
      process.stdout.write(`${entry.id}: ${assessed.status}, precondition=${assessed.preconditionEstablished}, raw=${assessed.rawOutcome ?? 'missing'}\n`);
    }
    seal(directory);
  }
  seal(root);
  const report = verifySaved(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function syntheticCase(root, entry, build) {
  const directory = path.join(root, 'cases', entry.id); fs.mkdirSync(directory);
  const config = configFor(entry, build);
  writeJSON(path.join(directory, 'config.json'), config);
  const trace = [];
  const nativeLines = [];
  const sentLines = [];
  const base = 1_000_000_000n;
  let nativeSequence = 0;
  const emit = (time, type, fields = {}) => {
    const event = { type, atMs: time, ...fields, sequence: trace.length + 1, observedNs: String(base + BigInt(Math.round(time * 1e6))) };
    trace.push(event); return event;
  };
  const native = (time, type, suffix) => {
    const line = `DSCG07/1\t${type}\t${config.runId}\t${++nativeSequence}\t100\t${1000 + nativeSequence}\t1000000\t${suffix}\n`;
    nativeLines.push(line); return emit(time, 'native-message', { line, message: parseNative(line) });
  };
  const command = (time, type, phase, token) => {
    const line = `DSCG07/1\t${type}\t${config.runId}\t${phase}\t${token}\n`;
    sentLines.push(line); emit(time, 'control-sent', { line, command: parseControl(line) });
    emit(time + 0.01, 'control-flushed', { command: parseControl(line), error: null });
  };
  emit(0, 'controller-start', { config });
  emit(0.1, 'executable-observed', { path: config.executable, sha256: config.executableHash });
  emit(0.2, 'control-listening', { pipeName: config.pipeName });
  emit(1, 'guard-start', { t0Ns: String(base), budgets: PROCESS_GUARD_BUDGETS });
  emit(2, 'spawn-attempt', { command: config.executable, args: ['--pipe', config.pipeName, '--run', config.runId, '--mode', config.mode], synthetic: false });
  emit(3, 'spawn-returned', { pid: 100 }); emit(4, 'child-spawn'); emit(5, 'control-connected');
  native(6, 'HELLO', config.mode); native(7, 'WRITTEN', '40\t40\t3\t3\t1');
  emit(8, 'capture-data', { stream: 'stdout', bytes: 40, afterReturn: false });
  emit(9, 'capture-data', { stream: 'stderr', bytes: 40, afterReturn: false });
  const end = (time) => {
    emit(time, 'capture-end', { stream: 'stdout', afterLocalDestroy: false, afterReturn: false });
    emit(time + 1, 'capture-close', { stream: 'stdout', afterLocalDestroy: false, afterReturn: false });
    emit(time + 2, 'capture-end', { stream: 'stderr', afterLocalDestroy: false, afterReturn: false });
    emit(time + 3, 'capture-close', { stream: 'stderr', afterLocalDestroy: false, afterReturn: false });
  };
  let finish;
  if (entry.mode === 'keep-open') {
    emit(1001, 'guard-deadline'); emit(1002, 'termination-request', { target: 'owned-child-handle', signal: 'SIGKILL' });
    emit(1003, 'termination-returned', { value: true });
    end(1010); finish = 1015;
  } else {
    native(10, 'CLOSED', '1\t0\t1\t0\t1\t0\t1\t0'); end(11);
    if (entry.mode === 'close-wait') {
      const a = nonce(); const b = nonce();
      emit(15, 'challenge-created', { phase: 1, token: a }); command(16, 'PING', 1, a);
      const first = native(20, 'PONG', `1\t${a}`);
      emit(120, 'hold-complete', { firstPongSequence: first.sequence });
      emit(121, 'challenge-created', { phase: 2, token: b }); command(122, 'PING', 2, b);
      native(125, 'PONG', `2\t${b}`); command(126, 'EXIT', 2, b);
      native(127, 'EXITING', `2\t${b}`); finish = 130;
    } else finish = 20;
  }
  const exit = entry.mode === 'keep-open' ? { code: null, signal: 'SIGKILL' } : { code: 0, signal: null };
  emit(finish, 'child-exit', { ...exit, afterReturn: false });
  const result = { kind: entry.mode === 'keep-open' ? 'deadline-exceeded' : 'natural-exit', reason: 'observed-exit-and-capture-close',
    returnedAtMs: finish + 1, deadlineExceeded: entry.mode === 'keep-open', exit, spawnError: null, childCloseObserved: false,
    streams: Object.fromEntries(['stdout', 'stderr'].map((name) => [name, { endObserved: true, closeObserved: true, localDestroyed: false, bytes: 40, error: null }])),
    captureIntegrity: entry.mode === 'keep-open' ? 'deadline-incomplete' : 'complete' };
  emit(finish + 1, 'guard-returned', { result }); emit(finish + 2, 'controller-guard-observed');
  emit(finish + 3, 'control-end'); emit(finish + 4, 'control-close'); emit(finish + 5, 'control-server-closed'); emit(finish + 6, 'controller-finished');
  const outerResult = { reason: 'exit-and-capture-close', exit: { code: 0, signal: null }, timedOut: false, returnedAtMs: finish + 50,
    captures: Object.fromEntries(['stdout', 'stderr'].map((name) => [name, { end: true, close: true, locallyDestroyed: false, error: null }])) };
  const outer = [
    { type: 'outer-start', t0Ns: String(base), cutoffMs: 5000, observationMs: 1000, atMs: 0 },
    { type: 'outer-end', stream: 'stdout', atMs: finish + 45 },
    { type: 'outer-close', stream: 'stdout', atMs: finish + 46 },
    { type: 'outer-end', stream: 'stderr', atMs: finish + 47 },
    { type: 'outer-close', stream: 'stderr', atMs: finish + 48 },
    { type: 'outer-child-exit', code: 0, signal: null, atMs: finish + 49 },
    { type: 'outer-returned', result: outerResult, atMs: finish + 50 },
  ].map((event, index) => ({ ...event, sequence: index + 1, observedNs: String(base + BigInt(Math.round(event.atMs * 1e6))) }));
  fs.writeFileSync(path.join(directory, 'trace.ndjson'), trace.map((event) => JSON.stringify(event)).join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'outer.ndjson'), outer.map((event) => JSON.stringify(event)).join('\n') + '\n');
  const bytes = { stdout: expectedMarker('stdout', config.runId), stderr: expectedMarker('stderr', config.runId),
    native: Buffer.from(nativeLines.join('')), sent: Buffer.from(sentLines.join('')), 'outer-stdout': Buffer.alloc(0), 'outer-stderr': Buffer.alloc(0) };
  for (const [key, filename] of Object.entries({ stdout: 'stdout.bin', stderr: 'stderr.bin', native: 'native-control.bin', sent: 'control-sent.bin', 'outer-stdout': 'outer-stdout.bin', 'outer-stderr': 'outer-stderr.bin' })) {
    fs.writeFileSync(path.join(directory, filename), bytes[key]);
  }
  writeJSON(path.join(directory, 'guard-result.json'), result); writeJSON(path.join(directory, 'outer-result.json'), outerResult);
  const assessment = assessCase(config, trace, result, outer, outerResult, bytes);
  writeJSON(path.join(directory, 'assessment.json'), assessment); seal(directory);
}

async function selfTest() {
  const root = path.resolve(process.env.DSC_STDIO_CLOSE_SELFTEST_EVIDENCE ?? path.join(os.tmpdir(), `dsc-stdio-close-selftest-${nonce()}`));
  fs.mkdirSync(root, { recursive: false });
  const assertions = [];
  const check = (name, value) => { assertions.push({ name, pass: Boolean(value) }); assert(value, name); };
  process.stdout.write(`Synthetic self-test evidence: ${root}\n`);
  try {
    const baseline = path.join(root, 'synthetic-baseline'); fs.mkdirSync(baseline);
    writeJSON(path.join(baseline, 'schedule.json'), SCHEDULE);
    const environment = snapshotInputs(baseline, true);
    fs.mkdirSync(path.join(baseline, 'build')); fs.mkdirSync(path.join(baseline, 'cases'));
    const binary = Buffer.from('Synthetic EXE bytes: not an executable, not native evidence\n');
    fs.writeFileSync(path.join(baseline, EXECUTABLE), binary);
    const build = { synthetic: true, output: EXECUTABLE, outputAbsolute: 'C:\\synthetic\\windows-stdio-close-control.exe',
      sourceHash: environment.sources[SOURCE], binaryHash: hash(binary), command: { status: 0, signal: null, error: null } };
    writeJSON(path.join(baseline, 'build.json'), build);
    for (const entry of SCHEDULE) syntheticCase(baseline, entry, build);
    seal(baseline);
    const positive = verifySaved(baseline, true);
    writeJSON(path.join(root, 'baseline-verification.json'), positive);
    check('All nine synthetic oracle fixtures are accepted only in explicit self-test scope', positive.pass && positive.checked === 9 && positive.actualCreated === 0 && positive.synthetic);
    check('Public verifier cannot promote synthetic archive to native evidence', !verifySaved(baseline).pass);
    const rehash = (directory) => { fs.unlinkSync(path.join(directory, 'manifest.json')); seal(directory); };
    const mutateTrace = (directory, transform) => {
      const file = path.join(directory, 'trace.ndjson');
      let trace = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
      trace = transform(trace).map((event, index) => ({ ...event, sequence: index + 1 }));
      fs.writeFileSync(file, trace.map((event) => JSON.stringify(event)).join('\n') + '\n');
    };
    const syncWireBytes = (directory) => {
      const trace = fs.readFileSync(path.join(directory, 'trace.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
      fs.writeFileSync(path.join(directory, 'native-control.bin'), trace.filter((event) => event.type === 'native-message').map((event) => event.line).join(''));
      fs.writeFileSync(path.join(directory, 'control-sent.bin'), trace.filter((event) => event.type === 'control-sent').map((event) => event.line).join(''));
    };
    const mutations = {
      'missing-one-eof': (dir) => mutateTrace(dir, (trace) => trace.filter((event) => event.type !== 'capture-end' || event.stream !== 'stderr')),
      'native-close-without-parent-eof': (dir) => mutateTrace(dir, (trace) => trace.filter((event) => event.type !== 'capture-end' && event.type !== 'capture-close')),
      'wrong-identity': (dir) => { const file = path.join(dir, 'config.json'); const config = readJSON(file); fs.writeFileSync(file, JSON.stringify({ ...config, runId: nonce() })); },
      'wrong-token': (dir) => {
        mutateTrace(dir, (trace) => trace.map((event) => {
          if (event.type !== 'native-message' || event.message.type !== 'PONG') return event;
          const fields = event.line.trimEnd().split('\t'); fields[8] = nonce();
          const line = fields.join('\t') + '\n'; return { ...event, line, message: parseNative(line) };
        }));
        syncWireBytes(dir);
      },
      'reused-challenge': (dir) => {
        mutateTrace(dir, (trace) => {
          const token = trace.find((event) => event.type === 'challenge-created').token;
          return trace.map((event) => {
            if (event.type === 'challenge-created' && event.phase === 2) return { ...event, token };
            if (event.type === 'control-sent' && event.command.phase === 2) {
              const fields = event.line.trimEnd().split('\t'); fields[4] = token;
              const line = fields.join('\t') + '\n'; return { ...event, line, command: parseControl(line) };
            }
            if (event.type === 'control-flushed' && event.command.phase === 2) return { ...event, command: { ...event.command, token } };
            if (event.type === 'native-message' && event.message.phase === 2) {
              const fields = event.line.trimEnd().split('\t'); fields[8] = token;
              const line = fields.join('\t') + '\n'; return { ...event, line, message: parseNative(line) };
            }
            return event;
          });
        });
        syncWireBytes(dir);
      },
      'hold-too-short': (dir) => {
        mutateTrace(dir, (trace) => trace.map((event) => {
          if (event.atMs < 120) return event;
          const changed = { ...event, atMs: event.atMs - 50, observedNs: String(BigInt(event.observedNs) - 50_000_000n) };
          if (event.type === 'guard-returned') changed.result = { ...event.result, returnedAtMs: event.result.returnedAtMs - 50 };
          return changed;
        }));
        const file = path.join(dir, 'guard-result.json'); const result = readJSON(file);
        fs.writeFileSync(file, JSON.stringify({ ...result, returnedAtMs: result.returnedAtMs - 50 }));
      },
      'guard-returned-before-exit': (dir) => mutateTrace(dir, (trace) => {
        const returned = trace.find((event) => event.type === 'guard-returned');
        const filtered = trace.filter((event) => event !== returned); filtered.splice(filtered.findIndex((event) => event.type === 'child-exit'), 0, returned); return filtered;
      }),
      'missing-pong': (dir) => mutateTrace(dir, (trace) => trace.filter((event) => event.type !== 'native-message' || event.message.type !== 'PONG')),
      'missing-exit': (dir) => mutateTrace(dir, (trace) => trace.filter((event) => event.type !== 'child-exit')),
      'missing-terminal': (dir) => mutateTrace(dir, (trace) => trace.filter((event) => event.type !== 'guard-returned')),
      'forged-result': (dir) => { const file = path.join(dir, 'assessment.json'); const assessment = readJSON(file); fs.writeFileSync(file, JSON.stringify({ ...assessment, preconditionEstablished: false })); },
    };
    const semanticReasons = { 'missing-one-eof': 'first capture state', 'native-close-without-parent-eof': 'first capture state',
      'wrong-identity': 'Controller config', 'wrong-token': 'Fresh tokens', 'reused-challenge': 'Second challenge is different',
      'hold-too-short': '100 ms hold', 'guard-returned-before-exit': 'before actual owned-child exit',
      'missing-pong': 'Two fresh responses', 'missing-exit': 'child-exit', 'missing-terminal': 'guard-returned' };
    const results = [];
    for (const [name, mutate] of Object.entries(mutations)) {
      const variant = path.join(root, name); fs.mkdirSync(variant); fs.mkdirSync(path.join(variant, 'cases'));
      const directory = path.join(variant, 'cases', SCHEDULE[0].id);
      fs.cpSync(path.join(baseline, 'cases', SCHEDULE[0].id), directory, { recursive: true });
      mutate(directory); rehash(directory);
      const report = verifyCase(variant, SCHEDULE[0], build);
      results.push({ name, report });
      check(`Rehashed mutation rejected independently: ${name}`, report.status !== 'control-pass'
        && !report.evidenceErrors.some((error) => error.includes('Hash mismatch'))
        && (name === 'forged-result' ? report.evidenceErrors.some((error) => error.includes('Saved assessment'))
          : report.errors.some((error) => error.includes(semanticReasons[name]))));
    }
    for (const [name, entry, mutate] of [
      ['late-exiting-notification', SCHEDULE[0], (dir) => mutateTrace(dir, (trace) => {
        const exiting = trace.find((event) => event.type === 'native-message' && event.message.type === 'EXITING');
        const output = trace.filter((event) => event !== exiting);
        output.splice(output.findIndex((event) => event.type === 'control-end'), 0, { ...exiting, atMs: 132.5, observedNs: '1132500000' });
        return output;
      })],
      ['close-exit-peer-reset', SCHEDULE[6], (dir) => mutateTrace(dir, (trace) => {
        const output = [...trace]; output.splice(output.findIndex((event) => event.type === 'child-exit'), 0,
          { type: 'control-error', code: 'ECONNRESET', error: 'Synthetic peer exit reset', atMs: 19, observedNs: '1019000000' }); return output;
      })],
    ]) {
      const variant = path.join(root, name); fs.mkdirSync(variant); fs.mkdirSync(path.join(variant, 'cases'));
      const directory = path.join(variant, 'cases', entry.id);
      fs.cpSync(path.join(baseline, 'cases', entry.id), directory, { recursive: true });
      mutate(directory); rehash(directory);
      const report = verifyCase(variant, entry, build); results.push({ name, report });
      check(`Independent cross-channel observation accepted: ${name}`, report.status === 'control-pass');
    }
    for (const [name, mutate] of Object.entries({
      'missing-exe': (dir) => fs.unlinkSync(path.join(dir, EXECUTABLE)),
      'changed-input-digest': (dir) => { const file = path.join(dir, 'environment.json'); const env = readJSON(file); env.sources[SOURCE] = '0'.repeat(64); fs.writeFileSync(file, JSON.stringify(env)); },
      'negative-masquerades-positive': (dir) => { const file = path.join(dir, 'cases', 'close-exit-1', 'assessment.json'); const saved = readJSON(file); fs.writeFileSync(file, JSON.stringify({ ...saved, preconditionEstablished: true })); rehash(path.dirname(file)); },
      'late-eof-upgrades-complete': (dir) => {
        const directory = path.join(dir, 'cases', 'keep-open-1'); const file = path.join(directory, 'guard-result.json');
        const result = { ...readJSON(file), captureIntegrity: 'complete' }; fs.writeFileSync(file, JSON.stringify(result));
        mutateTrace(directory, (trace) => trace.map((event) => event.type === 'guard-returned' ? { ...event, result } : event)); rehash(directory);
      },
      'missing-outer-end': (dir) => {
        const directory = path.join(dir, 'cases', SCHEDULE[0].id); const file = path.join(directory, 'outer.ndjson');
        const trace = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).filter((event) => event.type !== 'outer-end');
        fs.writeFileSync(file, trace.map((event, index) => JSON.stringify({ ...event, sequence: index + 1 })).join('\n') + '\n'); rehash(directory);
      },
      'outer-return-before-exit': (dir) => {
        const directory = path.join(dir, 'cases', SCHEDULE[0].id); const file = path.join(directory, 'outer.ndjson');
        const trace = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
        const exited = trace.find((event) => event.type === 'outer-child-exit');
        const changed = trace.filter((event) => event !== exited); changed.push({ ...exited, atMs: 181, observedNs: '1181000000' });
        fs.writeFileSync(file, changed.map((event, index) => JSON.stringify({ ...event, sequence: index + 1 })).join('\n') + '\n'); rehash(directory);
      },
      'unexpected-close-exit-transport': (dir) => {
        const directory = path.join(dir, 'cases', 'close-exit-1');
        mutateTrace(directory, (trace) => {
          const output = [...trace]; output.splice(output.findIndex((event) => event.type === 'child-exit'), 0,
            { type: 'control-error', code: 'EACCES', error: 'Synthetic non-peer error', atMs: 19, observedNs: '1019000000' }); return output;
        }); rehash(directory);
      },
    })) {
      const variant = path.join(root, name); fs.cpSync(baseline, variant, { recursive: true }); mutate(variant); rehash(variant);
      const report = verifySaved(variant, true); results.push({ name, report });
      const reason = { 'late-eof-upgrades-complete': 'Capture integrity', 'missing-outer-end': 'raw outer end',
        'outer-return-before-exit': 'Outer return follows', 'unexpected-close-exit-transport': 'Only close-exit peer termination' }[name];
      check(`Archive mutation rejected after rehash: ${name}`, !report.pass && report.checked === 9
        && (!reason || report.cases.some((entry) => entry.errors?.some((error) => error.includes(reason)))));
    }
    const corrupt = path.join(root, 'first-corrupt-last-semantic'); fs.cpSync(baseline, corrupt, { recursive: true });
    const firstDir = path.join(corrupt, 'cases', SCHEDULE[0].id); fs.writeFileSync(path.join(firstDir, 'trace.ndjson'), '{bad json\n'); rehash(firstDir);
    const lastDir = path.join(corrupt, 'cases', SCHEDULE.at(-1).id); mutations['missing-exit'](lastDir); rehash(lastDir); rehash(corrupt);
    const continued = verifySaved(corrupt, true); results.push({ name: 'first-corrupt-last-semantic', report: continued });
    check('Corrupt first case does not hide ninth semantic failure', continued.checked === 9 && continued.cases[0].status === 'evidence-error'
      && continued.cases.at(-1).errors.some((error) => error.includes('child-exit')));
    for (const invalid of ['DSCG07/1\tHELLO\tx\n', `DSCG07/1\tPING\t${nonce()}\t1\t${nonce()}\r\n`, `${'A'.repeat(513)}\n`]) {
      let rejected = false; try { parseControl(invalid); } catch { rejected = true; } check('Malformed, CR or oversized protocol input rejected', rejected);
    }
    const nativeError = parseNative(`DSCG07/1\tERROR\t${nonce()}\t1\t100\t1\t1000000\tstdout-close\t0\n`);
    check('Native lowercase fixed ERROR operation and zero Win32 error are preserved', nativeError.operation === 'stdout-close' && nativeError.error === 0);
    writeJSON(path.join(root, 'mutation-verification.json'), results);
    writeJSON(path.join(root, 'self-test.json'), { pass: true, synthetic: true, nativeProcesses: 0, assertions }); seal(root);
    process.stdout.write(`self-test: ${assertions.length}/${assertions.length}, synthetic only, no native processes\n`);
  } catch (error) {
    writeJSON(path.join(root, 'self-test.json'), { pass: false, synthetic: true, assertions, error: String(error.stack ?? error) }); seal(root); throw error;
  }
}

const [mode, argument, ...extra] = process.argv.slice(2);
try {
  if (extra.length) throw new Error('Unexpected arguments');
  if (mode === '--controller' && argument) await runController(path.resolve(argument));
  else if (mode === '--self-test' && !argument) await selfTest();
  else if (mode === '--output' && argument) process.exitCode = (await runMatrix(path.resolve(argument))).pass ? 0 : 1;
  else if (mode === '--verify-saved' && argument) {
    const report = verifySaved(path.resolve(argument)); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = report.pass ? 0 : 1;
  } else throw new Error('Usage: --self-test | --output NEW_DIRECTORY | --verify-saved DIRECTORY');
} catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }
