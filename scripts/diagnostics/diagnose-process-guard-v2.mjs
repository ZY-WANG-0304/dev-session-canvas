import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { guardProcess, PROCESS_GUARD_BUDGETS as BUDGETS } from './diagnostic-process-guard-v2.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const GUARD = fileURLToPath(new URL('./diagnostic-process-guard-v2.mjs', import.meta.url));
const CASES = ['G01', 'G02', 'G03', 'G04', 'G05', 'G06a', 'G06b', 'G07'];
const SCHEDULE = CASES.flatMap((scenario) => [1, 2, 3].map((run) => ({
  id: `${scenario}-${run}`, scenario, run, synthetic: scenario.startsWith('G06'),
})));
const HELPER_TTL_MS = 3000;
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const normalizedHash = (buffer) => hash(buffer.toString('utf8').replace(/\r\n/g, '\n'));
const json = (name, value) => fs.writeFileSync(name, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const readJSON = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recorder(name) {
  let sequence = 0;
  fs.writeFileSync(name, '', { flag: 'wx' });
  return (event) => {
    const value = { ...event, sequence: ++sequence, observedNs: String(process.hrtime.bigint()) };
    fs.appendFileSync(name, `${JSON.stringify(value)}\n`);
    return value;
  };
}

function filesUnder(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(path.join(directory, entry.name), relative) : [relative];
  }).sort();
}

function manifest(directory) {
  json(path.join(directory, 'manifest.json'), {
    algorithm: 'sha256',
    files: Object.fromEntries(filesUnder(directory).filter((name) => name !== 'manifest.json')
      .map((name) => [name, hash(fs.readFileSync(path.join(directory, name)))])),
  });
}

function syntheticChild(behavior) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.unref = () => {};
  child.kill = () => {
    if (behavior === 'throw') throw new Error('synthetic kill failure');
    return false;
  };
  return child;
}

async function runHelper(config) {
  const started = process.hrtime.bigint();
  const socket = net.createConnection({ host: '127.0.0.1', port: config.controlPort });
  let input = '';
  let heartbeat;
  let finished = false;
  const send = (type, fields = {}) => {
    if (!socket.destroyed) socket.write(`${JSON.stringify({ nonce: config.nonce, type, ...fields })}\n`);
  };
  const finish = (reason) => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    clearTimeout(ttl);
    try { fs.writeSync(1, `helper-finished:${config.nonce}\n`); } catch {}
    send('complete', { reason, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6 });
    socket.end();
    if (process.connected) process.disconnect();
  };
  const ttl = setTimeout(() => finish('ttl'), HELPER_TTL_MS);
  socket.on('connect', () => {
    fs.writeSync(1, `helper-holds-stdout:${config.nonce}\n`);
    fs.writeSync(2, `helper-holds-stderr:${config.nonce}\n`);
    send('ready', { pid: process.pid, ttlMs: HELPER_TTL_MS, startedNs: String(started) });
  });
  socket.on('data', (buffer) => {
    input += buffer.toString();
    for (;;) {
      const newline = input.indexOf('\n');
      if (newline < 0) break;
      const message = JSON.parse(input.slice(0, newline));
      input = input.slice(newline + 1);
      if (message.nonce !== config.nonce) continue;
      if (message.type === 'armed' && !heartbeat) {
        heartbeat = setInterval(() => send('heartbeat'), 40);
        process.send?.({ nonce: config.nonce, type: 'ready' });
      } else if (message.type === 'ping') {
        send('pong', { token: message.token });
      } else if (message.type === 'stop') {
        finish('cooperative-stop');
      }
    }
  });
  process.on('disconnect', () => send('parent-ipc-disconnected'));
  socket.on('error', () => finish('control-error'));
  socket.on('close', () => finish('control-closed'));
}

async function runFixture(configFile) {
  const config = readJSON(configFile);
  if (config.scenario === 'G04') {
    const helper = spawn(process.execPath, [ENTRY, '--helper', configFile], {
      stdio: ['ignore', 1, 2, 'ipc'], detached: process.platform === 'win32',
    });
    helper.on('error', (error) => { fs.writeSync(2, String(error)); process.exitCode = 71; });
    helper.on('message', (message) => {
      if (message.nonce !== config.nonce || message.type !== 'ready') return;
      fs.writeSync(1, `driver-ready:${config.nonce}\n`);
      helper.disconnect();
      helper.unref();
    });
    return;
  }
  fs.writeSync(1, `stdout:${config.nonce}\n`);
  fs.writeSync(2, `stderr:${config.nonce}\n`);
  if (config.scenario === 'G05') {
    setInterval(() => {}, 1000);
  } else if (config.scenario === 'G07') {
    fs.closeSync(1);
    fs.closeSync(2);
    setTimeout(() => { process.exitCode = 0; }, 250);
  } else {
    process.exitCode = config.scenario === 'G02' ? 7 : 0;
  }
}

async function runController(directory) {
  const config = readJSON(path.join(directory, 'config.json'));
  const write = recorder(path.join(directory, 'trace.ndjson'));
  const trace = [];
  const helperEvents = [];
  let socket;
  let server;
  let postExitToken;
  const record = (event) => {
    const value = write(event);
    trace.push(value);
    if (value.type === 'guard-returned') json(path.join(directory, 'first-result.json'), value.result);
    if (value.type === 'child-exit' && config.scenario === 'G04') {
      postExitToken = randomUUID();
      sendHelper('ping', { token: postExitToken });
    }
    return value;
  };
  const sendHelper = (type, fields = {}) => {
    const available = Boolean(socket && !socket.destroyed);
    record({ type: 'helper-control', action: type, available, ...fields });
    if (available) socket.write(`${JSON.stringify({ nonce: config.nonce, type, ...fields })}\n`);
  };
  for (const name of ['stdout', 'stderr']) fs.writeFileSync(path.join(directory, `${name}.bin`), '', { flag: 'wx' });
  record({ type: 'controller-start', config });
  if (config.scenario === 'G04') {
    server = net.createServer((candidate) => {
      let input = '';
      candidate.on('error', (error) => record({ type: 'helper-channel-error', error: String(error) }));
      candidate.on('data', (buffer) => {
        input += buffer.toString();
        if (input.length > 65536) { candidate.destroy(); return; }
        for (;;) {
          const newline = input.indexOf('\n');
          if (newline < 0) break;
          let message;
          try { message = JSON.parse(input.slice(0, newline)); }
          catch { record({ type: 'helper-invalid-message' }); candidate.destroy(); return; }
          input = input.slice(newline + 1);
          if (message.nonce !== config.nonce) { record({ type: 'helper-auth-rejected' }); candidate.destroy(); return; }
          if (socket && socket !== candidate) { record({ type: 'helper-duplicate-connection' }); candidate.destroy(); return; }
          socket = candidate;
          const event = record({ type: 'helper-message', message });
          helperEvents.push(event);
          if (message.type === 'ready') sendHelper('armed');
        }
      });
      candidate.on('close', () => record({ type: 'helper-channel-close' }));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    config.controlPort = server.address().port;
  }
  json(path.join(directory, 'fixture-config.json'), config);
  const fixtureFile = path.join(directory, 'fixture-config.json');
  const command = config.scenario === 'G03' ? path.join(directory, `missing-executable-${config.nonce}`) : process.execPath;
  const result = await guardProcess({
    command, args: config.scenario === 'G03' ? [] : [ENTRY, '--fixture', fixtureFile],
    spawnImpl: config.synthetic ? () => syntheticChild(config.scenario === 'G06a' ? 'throw' : 'false') : undefined,
    record,
    capture: (name, data) => fs.appendFileSync(path.join(directory, `${name}.bin`), data),
    onDeadline: () => { if (config.scenario === 'G04') sendHelper('stop'); },
  });
  record({ type: 'controller-guard-observed', kind: result.kind });
  if (server) {
    const guardStart = trace.find((event) => event.type === 'guard-start');
    const observationEnd = BigInt(guardStart.t0Ns) + 3500_000_000n;
    while (!helperEvents.some((event) => event.message.type === 'complete') && process.hrtime.bigint() < observationEnd) await delay(20);
    record({ type: 'helper-observation-ended', completionReceived: helperEvents.some((event) => event.message.type === 'complete') });
    if (socket && !socket.destroyed) {
      record({ type: 'helper-channel-local-destroy', incomplete: !helperEvents.some((event) => event.message.type === 'complete') });
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
  // Let close events caused by our local capture destruction become append-only evidence.
  await delay(20);
  json(path.join(directory, 'helper-observations.json'), {
    applicable: config.scenario === 'G04', events: helperEvents, postExitToken: postExitToken ?? null,
    osExit: 'unobserved', cleanup: config.scenario === 'G04' ? 'os-exit-unknown' : 'not-applicable',
  });
  record({ type: 'controller-finished' });
}

function outerController(directory) {
  const record = recorder(path.join(directory, 'outer.ndjson'));
  for (const name of ['outer-stdout.bin', 'outer-stderr.bin']) fs.writeFileSync(path.join(directory, name), '', { flag: 'wx' });
  const t0 = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - t0) / 1e6;
  const emit = (type, fields = {}) => record({ type, atMs: elapsed(), ...fields });
  let child;
  let exit = null;
  let timedOut = false;
  let returned = false;
  let cutoff;
  let final;
  const captures = {};
  emit('outer-start', { t0Ns: String(t0), cutoffMs: BUDGETS.outerCutoffMs, observationMs: BUDGETS.outerObservationMs });
  return new Promise((resolve) => {
    const finish = (reason) => {
      if (returned) return;
      returned = true;
      clearTimeout(cutoff);
      clearTimeout(final);
      const result = { reason, exit, timedOut, returnedAtMs: elapsed(), captures };
      emit('outer-returned', { result });
      json(path.join(directory, 'outer-result.json'), result);
      resolve(result);
    };
    const completed = () => {
      if (!timedOut && elapsed() >= BUDGETS.outerCutoffMs) terminate();
      if (exit && Object.values(captures).every((state) => state.close)) finish('exit-and-capture-close');
    };
    const terminate = () => {
      if (returned) return;
      if (elapsed() < BUDGETS.outerCutoffMs) { cutoff = setTimeout(terminate, Math.ceil(BUDGETS.outerCutoffMs - elapsed())); return; }
      timedOut = true;
      emit('outer-cutoff');
      if (!exit) {
        emit('outer-termination-request', { target: 'owned-controller-handle', signal: 'SIGKILL' });
        try { emit('outer-termination-returned', { value: child.kill('SIGKILL') }); }
        catch (error) { emit('outer-termination-threw', { error: String(error) }); }
      }
    };
    try { child = spawn(process.execPath, [ENTRY, '--controller', directory], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { emit('outer-spawn-threw', { error: String(error) }); finish('spawn-threw'); return; }
    emit('outer-spawn-returned', { pid: child.pid });
    for (const name of ['stdout', 'stderr']) {
      captures[name] = { end: false, close: false, locallyDestroyed: false };
      child[name].on('data', (data) => fs.appendFileSync(path.join(directory, `outer-${name}.bin`), data));
      child[name].on('end', () => { if (!captures[name].locallyDestroyed) captures[name].end = true; emit('outer-capture-end', { stream: name, afterLocalDestroy: captures[name].locallyDestroyed }); });
      child[name].on('close', () => { captures[name].close = true; emit('outer-capture-close', { stream: name, afterLocalDestroy: captures[name].locallyDestroyed }); completed(); });
      child[name].on('error', (error) => emit('outer-capture-error', { stream: name, error: String(error) }));
    }
    child.on('exit', (code, signal) => { exit = { code, signal }; emit('outer-child-exit', exit); completed(); });
    child.on('close', (code, signal) => emit('outer-child-close', { code, signal }));
    child.on('error', (error) => emit('outer-child-error', { error: String(error) }));
    cutoff = setTimeout(terminate, Math.max(0, BUDGETS.outerCutoffMs - elapsed()));
    final = setTimeout(() => {
      terminate();
      for (const name of ['stdout', 'stderr']) {
        if (!captures[name].close) {
          captures[name].locallyDestroyed = true;
          emit('outer-capture-local-destroy', { stream: name, incomplete: true });
          child[name].destroy();
          child[name].unref?.();
        }
      }
      child.unref();
      finish('absolute-outer-budget');
    }, Math.max(0, BUDGETS.outerCutoffMs + BUDGETS.outerObservationMs - BUDGETS.settlementReserveMs - elapsed()));
  });
}

function assessCase(config, trace, result, outer, helper, stdout, stderr) {
  const errors = [];
  const preconditions = [];
  const check = (value, message) => { if (!value) errors.push(message); };
  const events = (type) => trace.filter((event) => event.type === type);
  const first = (type) => events(type)[0];
  const returned = first('guard-returned');
  const exit = first('child-exit');
  const deadline = first('guard-deadline');
  const start = first('guard-start');
  check(events('guard-start').length === 1, 'exactly one guard start');
  check(first('controller-start')?.config?.id === config.id && first('controller-start')?.config?.nonce === config.nonce, 'controller identity matches immutable case config');
  check(events('spawn-attempt').length === 1, 'exactly one spawn attempt');
  check(events('guard-returned').length === 1, 'exactly one immutable guard result');
  check(JSON.stringify(returned?.result) === JSON.stringify(result), 'saved first result equals raw returned result');
  check(start && JSON.stringify(start.budgets) === JSON.stringify(BUDGETS), 'frozen guard budgets');
  check(result?.returnedAtMs >= 0 && result.returnedAtMs <= 2000 && returned?.atMs <= 2000, 'guard returned inside absolute 2000 ms');
  check(start && returned && BigInt(returned.observedNs) - BigInt(start.t0Ns) <= 2000_000_000n, 'raw monotonic observation independently proves 2000 ms return');
  check(outer?.exit?.code === 0 && outer.exit.signal === null && outer.timedOut === false && outer.returnedAtMs <= 6000, 'independent controller finished inside outer budget');
  check(first('controller-finished'), 'controller completed evidence collection');
  check(first('spawn-attempt')?.synthetic === config.synthetic, 'real/synthetic source classification');
  const prior = trace.filter((event) => event.sequence < (returned?.sequence ?? 0));
  check(result?.childCloseObserved === prior.some((event) => event.type === 'child-close'), 'child close is distinct from exit and capture close');
  let captureError = false;
  let truncated = false;
  let allEnded = true;
  for (const name of ['stdout', 'stderr']) {
    const local = prior.some((event) => event.type === 'capture-local-destroy' && event.stream === name);
    const ended = prior.some((event) => event.type === 'capture-end' && event.stream === name && !event.afterLocalDestroy);
    const closed = prior.some((event) => event.type === 'capture-close' && event.stream === name);
    const bytes = prior.filter((event) => event.type === 'capture-data' && event.stream === name).reduce((sum, event) => sum + event.bytes, 0);
    const error = prior.filter((event) => event.type === 'capture-error' && event.stream === name).at(-1)?.error ?? null;
    captureError ||= Boolean(error);
    truncated ||= local;
    allEnded &&= ended;
    check(result?.streams?.[name]?.localDestroyed === local, `${name} local truncation derived from events`);
    check(result?.streams?.[name]?.endObserved === ended, `${name} real EOF derived separately from close`);
    check(result?.streams?.[name]?.closeObserved === closed, `${name} capture close derived from events`);
    check(result?.streams?.[name]?.bytes === bytes, `${name} captured byte count before return`);
    check(result?.streams?.[name]?.error === error, `${name} capture error preserved independently of OS exit`);
    const allBytes = events('capture-data').filter((event) => event.stream === name).reduce((sum, event) => sum + event.bytes, 0);
    check((name === 'stdout' ? stdout : stderr).length === allBytes, `${name} persisted bytes equal full trace`);
  }
  check(result?.captureIntegrity === (captureError ? 'error' : truncated ? 'truncated' : deadline ? 'deadline-incomplete' : allEnded ? 'complete' : 'unknown'), 'capture integrity independently derived from end/error/cancellation/deadline');
  check(!events('capture-error').length && !events('spawn-hook-error').length && !events('deadline-hook-error').length, 'no hidden capture or hook failures');
  const timeoutCase = ['G04', 'G05', 'G06a', 'G06b'].includes(config.scenario);
  check(timeoutCase ? Boolean(deadline && deadline.atMs >= 1000 && deadline.atMs <= 2000) : !deadline, 'deadline classification and absolute timing');
  if (deadline && start) check(BigInt(deadline.observedNs) - BigInt(start.t0Ns) >= 1000_000_000n, 'deadline not before absolute monotonic 1000 ms');
  check(result?.kind === (timeoutCase ? 'deadline-exceeded' : config.scenario === 'G03' ? 'spawn-error' : 'natural-exit'), 'raw outcome preserves expected failure');
  check(result?.deadlineExceeded === timeoutCase, 'deadline flag matches independently expected outcome');
  if (config.scenario === 'G03') {
    check(events('child-error').some((event) => event.spawnError) && !exit, 'spawn failure is not OS process exit');
    check(result?.exit === null && Boolean(result?.spawnError), 'spawn failure result preserves unknown exit');
  } else if (!config.synthetic) {
    check(events('child-spawn').length === 1, 'actual child spawn observed');
    check(exit, 'actual directly owned child exit observed');
    check(JSON.stringify(result?.exit) === JSON.stringify(exit ? { code: exit.code, signal: exit.signal } : null), 'first result process exit matches preceding evidence');
    if (config.scenario !== 'G05') check(exit?.code === (config.scenario === 'G02' ? 7 : 0) && exit?.signal === null, 'natural OS exit code');
    if (['G01', 'G02', 'G07'].includes(config.scenario)) {
      check(stdout.includes(`stdout:${config.nonce}`) && stderr.includes(`stderr:${config.nonce}`), 'deterministic output markers');
      for (const name of ['stdout', 'stderr']) check(result?.streams?.[name]?.endObserved && !result.streams[name].localDestroyed, `${name} natural source end`);
    }
  }
  if (config.scenario === 'G04') {
    const ready = events('helper-message').find((event) => event.message.type === 'ready');
    const ping = events('helper-control').find((event) => event.action === 'ping');
    const pong = events('helper-message').find((event) => event.message.type === 'pong' && event.message.token === ping?.token);
    const before = (a, b) => a && b && BigInt(a.observedNs) < BigInt(b.observedNs);
    if (!before(ready, exit) || !before(exit, deadline) || !before(exit, ping) || !before(ping, pong) || !before(pong, deadline)) preconditions.push('helper ready, driver exit and authenticated post-exit pong must precede deadline');
    if (!start || ![ready, exit, pong].every((event) => event && BigInt(event.observedNs) - BigInt(start.t0Ns) < 1000_000_000n)) preconditions.push('G04 setup must complete within absolute 1000 ms, not just before a delayed timer callback');
    if (trace.some((event) => ['capture-end', 'capture-close'].includes(event.type) && event.sequence < (deadline?.sequence ?? 0))) preconditions.push('helper must hold both inherited captures through deadline');
    if (!stdout.includes(`helper-holds-stdout:${config.nonce}`) || !stderr.includes(`helper-holds-stderr:${config.nonce}`)) preconditions.push('both inherited output handles must carry helper markers');
    check(events('termination-request').length === 0, 'already exited driver is not killed and helper PID confers no control rights');
    const completion = events('helper-message').find((event) => event.message.type === 'complete');
    check(completion?.message.reason === 'cooperative-stop' && completion.message.elapsedMs <= HELPER_TTL_MS, 'helper cooperative completion receipt inside TTL');
    check(helper?.osExit === 'unobserved' && helper?.cleanup === 'os-exit-unknown', 'helper completion receipt is not OS exit proof');
    check(JSON.stringify(helper?.events) === JSON.stringify(events('helper-message')), 'helper observations match append-only trace');
    check(events('helper-message').every((event) => event.message.nonce === config.nonce), 'helper private nonce authentication');
  }
  if (config.scenario === 'G05') {
    check(deadline && exit?.sequence > deadline.sequence, 'driver still running at deadline');
    check(events('termination-request').length === 1 && first('termination-returned')?.value === true, 'direct handle termination requested and accepted');
  }
  if (config.synthetic) {
    check(!exit && !first('child-close'), 'synthetic missing OS exit and child close remain missing');
    check(events('termination-request').length === 1, 'synthetic kill attempted once');
    check(config.scenario === 'G06a' ? events('termination-threw').length === 1 : first('termination-returned')?.value === false, 'synthetic termination failure type');
    check(result?.reason === 'absolute-return-budget' && result?.exit === null, 'synthetic noncompletion returned independently of close');
    for (const name of ['stdout', 'stderr']) check(result?.streams?.[name]?.localDestroyed && !result.streams[name].endObserved, `${name} synthetic truncation is not EOF`);
  }
  if (config.scenario === 'G07') {
    for (const name of ['stdout', 'stderr']) {
      const end = events('capture-end').find((event) => event.stream === name);
      const close = events('capture-close').find((event) => event.stream === name);
      check(end && close && end.sequence < (exit?.sequence ?? 0) && close.sequence < (exit?.sequence ?? 0), `${name} real end and stream close precede process exit`);
    }
    check(exit && returned && exit.sequence < returned.sequence, 'stdio-only completion does not return before exit');
  }
  return { id: config.id, status: preconditions.length ? 'precondition-failure' : errors.length ? 'control-failure' : 'control-pass', errors, preconditions,
    rawOutcome: result?.kind ?? 'missing', synthetic: config.synthetic, pty: false };
}

function checkManifest(directory, errors) {
  try {
    const saved = readJSON(path.join(directory, 'manifest.json'));
    const actual = filesUnder(directory).filter((name) => name !== 'manifest.json');
    if (saved.algorithm !== 'sha256' || JSON.stringify(Object.keys(saved.files).sort()) !== JSON.stringify(actual)) errors.push('manifest exact file inventory mismatch');
    for (const [name, expected] of Object.entries(saved.files)) {
      if (path.isAbsolute(name) || name.split('/').includes('..')) { errors.push(`unsafe manifest path: ${name}`); continue; }
      try { if (hash(fs.readFileSync(path.join(directory, name))) !== expected) errors.push(`hash mismatch: ${name}`); }
      catch (error) { errors.push(`manifest read: ${name}: ${error.message}`); }
    }
  } catch (error) { errors.push(`manifest: ${error.message}`); }
}

function readTrace(file, errors) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    const trace = lines.map((line) => JSON.parse(line));
    let previous = -1n;
    for (const [index, event] of trace.entries()) {
      if (event.sequence !== index + 1) errors.push(`trace sequence mismatch at ${index + 1}`);
      const observed = BigInt(event.observedNs);
      if (observed < previous) errors.push(`trace monotonic clock regression at ${index + 1}`);
      previous = observed;
    }
    return trace;
  } catch (error) { errors.push(`trace: ${path.basename(file)}: ${error.message}`); return []; }
}

function verifyCase(root, entry, compareSaved = true) {
  const directory = path.join(root, entry.id);
  const evidenceErrors = [];
  checkManifest(directory, evidenceErrors);
  const trace = readTrace(path.join(directory, 'trace.ndjson'), evidenceErrors);
  const outerTrace = readTrace(path.join(directory, 'outer.ndjson'), evidenceErrors);
  const read = (name, fallback) => { try { return readJSON(path.join(directory, name)); } catch (error) { evidenceErrors.push(`${name}: ${error.message}`); return fallback; } };
  const config = read('config.json', { ...entry });
  for (const [key, expected] of Object.entries(entry)) if (config[key] !== expected) evidenceErrors.push(`schedule config mismatch: ${key}`);
  if (JSON.stringify(config.budgets) !== JSON.stringify(BUDGETS) || config.helperTtlMs !== HELPER_TTL_MS || typeof config.nonce !== 'string' || config.nonce.length < 16) evidenceErrors.push('frozen case parameters or nonce missing');
  const result = read('first-result.json', null);
  const outer = read('outer-result.json', null);
  const helper = read('helper-observations.json', null);
  const savedOuter = outerTrace.filter((event) => event.type === 'outer-returned');
  if (savedOuter.length !== 1 || JSON.stringify(savedOuter[0]?.result) !== JSON.stringify(outer)) evidenceErrors.push('outer first result does not match raw trace');
  const outerExit = outerTrace.find((event) => event.type === 'outer-child-exit');
  if (JSON.stringify(outer?.exit) !== JSON.stringify(outerExit ? { code: outerExit.code, signal: outerExit.signal } : null)) evidenceErrors.push('outer exit not independently evidenced');
  if (outerTrace.some((event) => event.type === 'outer-cutoff') !== outer?.timedOut) evidenceErrors.push('outer timeout not independently evidenced');
  const outerStart = outerTrace.find((event) => event.type === 'outer-start');
  if (!outerStart || !savedOuter[0] || BigInt(savedOuter[0].observedNs) - BigInt(outerStart.t0Ns) > 6000_000_000n) evidenceErrors.push('outer return exceeds raw absolute 6000 ms');
  if (outerStart && savedOuter[0] && !outer?.timedOut && BigInt(savedOuter[0].observedNs) - BigInt(outerStart.t0Ns) >= 5000_000_000n) evidenceErrors.push('outer natural completion cannot consume post-cutoff observation budget');
  for (const event of outerTrace.filter((value) => value.type === 'outer-cutoff')) {
    if (!outerStart || BigInt(event.observedNs) - BigInt(outerStart.t0Ns) < 5000_000_000n) evidenceErrors.push('outer cutoff before raw absolute 5000 ms');
  }
  const output = (name) => { try { return fs.readFileSync(path.join(directory, `${name}.bin`)); } catch (error) { evidenceErrors.push(`${name}: ${error.message}`); return Buffer.alloc(0); } };
  const assessed = assessCase({ ...config, ...entry }, trace, result, outer, helper, output('stdout'), output('stderr'));
  if (compareSaved) {
    const saved = read('assessment.json', null);
    if (JSON.stringify(saved) !== JSON.stringify(assessed)) evidenceErrors.push('saved assessment differs from independent event derivation');
  }
  return { ...assessed, evidenceErrors, status: evidenceErrors.length ? 'evidence-error' : assessed.status };
}

function verifySaved(root) {
  const errors = [];
  checkManifest(root, errors);
  try { if (JSON.stringify(readJSON(path.join(root, 'schedule.json'))) !== JSON.stringify(SCHEDULE)) errors.push('full frozen schedule mismatch'); }
  catch (error) { errors.push(`schedule: ${error.message}`); }
  try {
    const environment = readJSON(path.join(root, 'environment.json'));
    if (JSON.stringify(environment.budgets) !== JSON.stringify(BUDGETS) || environment.helperTtlMs !== HELPER_TTL_MS || environment.pty !== false) errors.push('frozen environment mismatch');
    if (!['linux', 'darwin', 'win32'].includes(environment.platform) || !/^v\d+\.\d+\.\d+/.test(environment.node)
      || !/^[a-f0-9]{40}$/.test(environment.sourceCommit) || typeof environment.gitStatus !== 'string'
      || !environment.arch || !environment.release || !environment.execPath) errors.push('runtime/platform/source environment metadata missing');
    if (environment.githubSha && environment.githubSha !== environment.sourceCommit) errors.push('runner commit differs from actual source commit');
    for (const name of [path.basename(ENTRY), path.basename(GUARD)]) {
      const source = fs.readFileSync(path.join(root, 'sources', name));
      if (hash(source) !== environment.sourceHashes?.[name]) errors.push(`source snapshot hash mismatch: ${name}`);
      if (normalizedHash(source) !== normalizedHash(fs.readFileSync(path.join(path.dirname(ENTRY), name)))) errors.push(`source snapshot differs from current independent validator: ${name}`);
    }
  } catch (error) { errors.push(`environment/source: ${error.message}`); }
  // Never short-circuit: a corrupt first case must not hide any later case.
  const cases = SCHEDULE.map((entry) => {
    try { return verifyCase(root, entry); }
    catch (error) { return { id: entry.id, status: 'evidence-error', evidenceErrors: [String(error)] }; }
  });
  return { schema: 'diagnostic-process-guard-v2', checked: cases.length, pass: errors.length === 0 && cases.every((entry) => entry.status === 'control-pass'), errors, cases };
}

async function produceCase(root, entry) {
  const directory = path.join(root, entry.id);
  fs.mkdirSync(directory);
  json(path.join(directory, 'config.json'), { ...entry, nonce: randomUUID(), budgets: BUDGETS, helperTtlMs: HELPER_TTL_MS });
  await outerController(directory);
  await delay(30);
  const errors = [];
  const trace = readTrace(path.join(directory, 'trace.ndjson'), errors);
  const get = (name, fallback) => { try { return readJSON(path.join(directory, name)); } catch { return fallback; } };
  const bytes = (name) => { try { return fs.readFileSync(path.join(directory, `${name}.bin`)); } catch { return Buffer.alloc(0); } };
  const assessment = assessCase(get('config.json', entry), trace, get('first-result.json', null), get('outer-result.json', null), get('helper-observations.json', null), bytes('stdout'), bytes('stderr'));
  json(path.join(directory, 'assessment.json'), assessment);
  manifest(directory);
  return assessment;
}

async function runMatrix(root) {
  fs.mkdirSync(root, { recursive: false });
  fs.mkdirSync(path.join(root, 'sources'));
  const sourceHashes = {};
  for (const source of [ENTRY, GUARD]) {
    const contents = fs.readFileSync(source);
    sourceHashes[path.basename(source)] = hash(contents);
    fs.writeFileSync(path.join(root, 'sources', path.basename(source)), contents, { flag: 'wx' });
  }
  json(path.join(root, 'schedule.json'), SCHEDULE);
  json(path.join(root, 'environment.json'), {
    schema: 'diagnostic-process-guard-v2', platform: process.platform, arch: process.arch,
    node: process.version, versions: process.versions, release: os.release(), execPath: process.execPath,
    budgets: BUDGETS, helperTtlMs: HELPER_TTL_MS, pty: false, sourceHashes,
    createdAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.dirname(ENTRY), encoding: 'utf8' }).trim(),
    gitStatus: execFileSync('git', ['status', '--short'], { cwd: path.dirname(ENTRY), encoding: 'utf8' }), githubSha: process.env.GITHUB_SHA ?? null,
    scope: 'diagnostic guard controls, not PTY/native/Host/Agent evidence',
  });
  for (const entry of SCHEDULE) {
    const assessment = await produceCase(root, entry);
    process.stdout.write(`${entry.id}: ${assessment.status} (${assessment.rawOutcome})\n`);
  }
  const cases = SCHEDULE.map((entry) => verifyCase(root, entry));
  const summary = { schema: 'diagnostic-process-guard-v2', count: cases.length, realControls: 18, syntheticControls: 6, pty: false,
    pass: cases.every((entry) => entry.status === 'control-pass'), cases };
  json(path.join(root, 'summary.json'), summary);
  manifest(root);
  const verification = verifySaved(root);
  process.stdout.write(`${JSON.stringify({ output: root, pass: verification.pass, checked: verification.checked })}\n`);
  return verification;
}

async function selfTest() {
  const root = path.resolve(process.env.DSC_PROCESS_GUARD_SELFTEST_EVIDENCE
    ?? path.join(os.tmpdir(), `dsc-process-guard-v2-selftest-${randomUUID()}`));
  fs.mkdirSync(root, { recursive: false });
  fs.mkdirSync(path.join(root, 'sources'));
  for (const source of [ENTRY, GUARD]) fs.copyFileSync(source, path.join(root, 'sources', path.basename(source)), fs.constants.COPYFILE_EXCL);
  const assertions = [];
  const recordAssertion = (name, value) => { assertions.push({ name, pass: Boolean(value) }); assert.ok(value, name); };
  process.stdout.write(`self-test evidence: ${root}\n`);
  try {
    for (const behavior of ['throw', 'false']) {
      const child = syntheticChild(behavior);
      const trace = [];
      const write = recorder(path.join(root, `kill-${behavior}.ndjson`));
      const result = await guardProcess({ command: 'synthetic', spawnImpl: () => child, record: (event) => { trace.push(event); write(event); } });
      const first = JSON.stringify(result);
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
      await delay(10);
      recordAssertion(`${behavior}: bounded one-time failure despite late exit`, result.kind === 'deadline-exceeded' && result.returnedAtMs <= 2000 && trace.filter((event) => event.type === 'guard-returned').length === 1 && JSON.stringify(result) === first);
      recordAssertion(`${behavior}: local close is not EOF`, result.streams.stdout.localDestroyed && !result.streams.stdout.endObserved);
      recordAssertion(`${behavior}: no reset of deadline`, trace.find((event) => event.type === 'guard-deadline').atMs >= 1000);
    }
    const child = syntheticChild('false');
    const trace = [];
    const natural = guardProcess({ command: 'synthetic', spawnImpl: () => child, record: (event) => trace.push(event), onSpawn: () => {
      setTimeout(() => { child.stdout.end(); child.stderr.end(); child.stdout.destroy(); child.stderr.destroy(); }, 10);
      setTimeout(() => { child.emit('exit', 7, null); child.emit('close', 7, null); }, 40);
    } });
    const result = await natural;
    recordAssertion('stdio closure alone does not settle process exit', result.kind === 'natural-exit' && result.exit.code === 7 && result.returnedAtMs >= 35);
    recordAssertion('single settlement with duplicate close', trace.filter((event) => event.type === 'guard-returned').length === 1);
    const thrown = await guardProcess({ command: 'synthetic', spawnImpl: () => { throw new Error('spawn failed synchronously'); } });
    recordAssertion('synchronous spawn failure does not invent process exit', thrown.kind === 'spawn-error' && thrown.exit === null);
    const broken = syntheticChild('false');
    const incomplete = await guardProcess({ command: 'synthetic', spawnImpl: () => broken, onSpawn: () => {
      setTimeout(() => {
        broken.stdout.destroy(new Error('synthetic capture failure'));
        broken.stderr.end();
        broken.stderr.destroy();
        broken.emit('exit', 0, null);
      }, 10);
    } });
    recordAssertion('capture failure is not complete natural output', incomplete.kind === 'natural-exit' && incomplete.captureIntegrity === 'error' && incomplete.streams.stdout.error.includes('synthetic capture failure'));
    const overdue = syntheticChild('false');
    const endedAfterDeadline = await guardProcess({ command: 'synthetic', spawnImpl: () => overdue, onSpawn: () => {
      setTimeout(() => {
        overdue.stdout.end();
        overdue.stderr.end();
        overdue.emit('exit', 0, null);
        overdue.emit('close', 0, null);
      }, 1050);
    } });
    recordAssertion('real EOF after deadline does not promote an incomplete diagnostic', endedAfterDeadline.kind === 'deadline-exceeded'
      && endedAfterDeadline.captureIntegrity === 'deadline-incomplete'
      && endedAfterDeadline.streams.stdout.endObserved && endedAfterDeadline.streams.stderr.endObserved
      && !endedAfterDeadline.streams.stdout.localDestroyed && !endedAfterDeadline.streams.stderr.localDestroyed);
    const corrupt = path.join(root, 'corrupt-first-archive');
    fs.mkdirSync(corrupt);
    for (const entry of SCHEDULE) fs.mkdirSync(path.join(corrupt, entry.id));
    fs.writeFileSync(path.join(corrupt, SCHEDULE[0].id, 'trace.ndjson'), '{bad json\n', { flag: 'wx' });
    json(path.join(corrupt, SCHEDULE[0].id, 'manifest.json'), { algorithm: 'sha256', files: { 'trace.ndjson': 'wrong-hash' } });
    const verified = verifySaved(corrupt);
    json(path.join(root, 'corruption-verification.json'), verified);
    recordAssertion('corrupt first evidence does not stop all 24 scheduled checks', verified.checked === 24 && verified.cases.at(-1).id === 'G07-3' && verified.cases.every((entry) => entry.status === 'evidence-error'));
    recordAssertion('validator rejects hash mismatch and malformed trace independently', verified.cases[0].evidenceErrors.some((error) => error.includes('hash mismatch')) && verified.cases[0].evidenceErrors.some((error) => error.includes('trace:')));
    recordAssertion('validator rejects missing manifests', verified.cases[1].evidenceErrors.some((error) => error.includes('manifest:')));
    const baseline = path.join(root, 'validator-control-fixtures');
    fs.mkdirSync(baseline);
    await produceCase(baseline, SCHEDULE[0]);
    await produceCase(baseline, SCHEDULE.at(-1));
    recordAssertion('validator accepts actual G01 and G07 self-test fixtures', verifyCase(baseline, SCHEDULE[0]).status === 'control-pass' && verifyCase(baseline, SCHEDULE.at(-1)).status === 'control-pass');
    const replaceJSON = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    const mutateTrace = (directory, mutate) => {
      const file = path.join(directory, 'trace.ndjson');
      const events = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
      fs.writeFileSync(file, mutate(events).map((event) => JSON.stringify(event)).join('\n') + '\n');
    };
    const rehash = (directory) => { fs.unlinkSync(path.join(directory, 'manifest.json')); manifest(directory); };
    const mutations = {
      'missing-exit': (directory) => mutateTrace(directory, (events) => events.filter((event) => event.type !== 'child-exit').map((event, index) => ({ ...event, sequence: index + 1 }))),
      'missing-end': (directory) => mutateTrace(directory, (events) => events.filter((event) => event.type !== 'capture-end').map((event, index) => ({ ...event, sequence: index + 1 }))),
      'wrong-nonce': (directory) => { const file = path.join(directory, 'config.json'); replaceJSON(file, { ...readJSON(file), nonce: randomUUID() }); },
      'wrong-sequence': (directory) => mutateTrace(directory, (events) => events.map((event, index) => index === 1 ? { ...event, sequence: 999 } : event)),
      'forged-result-clock': (directory) => {
        const file = path.join(directory, 'first-result.json');
        const modified = { ...readJSON(file), returnedAtMs: 2500 };
        replaceJSON(file, modified);
        mutateTrace(directory, (events) => events.map((event) => event.type === 'guard-returned' ? { ...event, result: modified } : event));
      },
      'forged-raw-clock': (directory) => mutateTrace(directory, (events) => events.map((event) => event.type === 'guard-returned'
        ? { ...event, observedNs: String(BigInt(events.find((value) => value.type === 'guard-start').t0Ns) + 2500_000_000n) } : event)),
      'missing-first-result': (directory) => fs.unlinkSync(path.join(directory, 'first-result.json')),
      'missing-terminal': (directory) => mutateTrace(directory, (events) => events.filter((event) => event.type !== 'guard-returned' && event.type !== 'controller-finished').map((event, index) => ({ ...event, sequence: index + 1 }))),
      'forged-pass': (directory) => {
        mutateTrace(directory, (events) => events.filter((event) => event.type !== 'child-exit').map((event, index) => ({ ...event, sequence: index + 1 })));
        const file = path.join(directory, 'assessment.json');
        replaceJSON(file, { ...readJSON(file), status: 'control-pass', pass: true, errors: [] });
      },
    };
    const mutationResults = [];
    for (const [name, mutate] of Object.entries(mutations)) {
      const variant = path.join(root, `mutation-${name}`);
      fs.mkdirSync(variant);
      const directory = path.join(variant, SCHEDULE[0].id);
      fs.cpSync(path.join(baseline, SCHEDULE[0].id), directory, { recursive: true, errorOnExist: true });
      mutate(directory);
      rehash(directory);
      const verifiedCase = verifyCase(variant, SCHEDULE[0]);
      mutationResults.push({ name, verification: verifiedCase });
      recordAssertion(`rehash cannot hide semantic mutation: ${name}`, verifiedCase.status !== 'control-pass' && !verifiedCase.evidenceErrors.some((error) => error.includes('hash mismatch')));
    }
    fs.cpSync(path.join(baseline, SCHEDULE.at(-1).id), path.join(corrupt, SCHEDULE.at(-1).id), { recursive: true });
    mutations['missing-exit'](path.join(corrupt, SCHEDULE.at(-1).id));
    rehash(path.join(corrupt, SCHEDULE.at(-1).id));
    const continued = verifySaved(corrupt);
    recordAssertion('first parse failure does not hide last semantic failure', continued.checked === 24 && continued.cases.at(-1).errors.some((error) => error.includes('exit')));
    json(path.join(root, 'mutation-verification.json'), mutationResults);
    json(path.join(root, 'self-test.json'), { pass: true, assertions });
    manifest(root);
    process.stdout.write(`self-test: ${assertions.length}/${assertions.length} passed\n`);
  } catch (error) {
    json(path.join(root, 'self-test.json'), { pass: false, assertions, error: String(error) });
    manifest(root);
    throw error;
  }
}

const [mode, argument, ...extra] = process.argv.slice(2);
try {
  if (extra.length) throw new Error('unexpected arguments');
  if (mode === '--fixture' && argument) await runFixture(argument);
  else if (mode === '--helper' && argument) await runHelper(readJSON(argument));
  else if (mode === '--controller' && argument) await runController(argument);
  else if (mode === '--output' && argument) process.exitCode = (await runMatrix(path.resolve(argument))).pass ? 0 : 1;
  else if (mode === '--verify-saved' && argument) {
    const result = verifySaved(path.resolve(argument));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.pass ? 0 : 1;
  } else if (mode === '--self-test' && !argument) await selfTest();
  else throw new Error('usage: --self-test | --output NEW_DIRECTORY | --verify-saved DIRECTORY');
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}
