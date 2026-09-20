import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';
import ts from 'typescript';

const { values } = parseArgs({ options: {
  mode: { type: 'string', default: 'supervisor' },
  runs: { type: 'string', default: '3' },
  output: { type: 'string' },
  'self-test': { type: 'boolean', default: false },
  'data-delay-ms': { type: 'string', default: '0' },
  'writer-receipt': { type: 'boolean', default: false },
  'probe-after-end': { type: 'boolean', default: false },
  'probe-before-destroy': { type: 'boolean', default: false },
  'pause-near-exit-ms': { type: 'string', default: '0' }
} });
assert.ok(['bare', 'supervisor'].includes(values.mode));
const runs = integer(values.runs, 1, 30);
const dataDelayMs = integer(values['data-delay-ms'], 0, 100);
const pauseNearExitMs = integer(values['pause-near-exit-ms'], 0, 1000);
const lineCount = 90000;
const prefix = 'DSC_COMPLETED_STREAM_';
if (values['self-test']) {
  selfTest();
  console.log('Diagnostic analyzer self-test passed.');
  process.exit(0);
}
assert.equal(process.platform, 'linux', 'This diagnostic uses the Linux PTY EOF path.');
const root = path.resolve(import.meta.dirname, '../..');
const outputDir = values.output ? path.resolve(values.output)
  : path.join(root, '.debug', `terminal-tail-${values.mode}-${Date.now()}`);
assert.equal(fs.existsSync(outputDir), false, `Refusing to overwrite evidence: ${outputDir}`);
fs.mkdirSync(outputDir, { recursive: true });
const require = createRequire(import.meta.url);
const pty = require('node-pty');
const native = require('node-pty/lib/utils').loadNativeModule('pty').module;
const { Terminal } = require('@xterm/headless');
const originalSpawn = pty.spawn;
const originalFork = native.fork;
let spawning;
const observed = [];

// Instrument only this diagnostic process. Production sources and dependency files stay untouched.
native.fork = function (...args) {
  const trace = spawning;
  const callback = args.at(-1);
  args[args.length - 1] = (...exitArgs) => {
    trace.mark('native-exit', { exitCode: exitArgs[0], signal: exitArgs[1] });
    callback(...exitArgs);
  };
  return originalFork.apply(this, args);
};
pty.spawn = function (...args) {
  const trace = createTrace();
  spawning = trace;
  const terminal = originalSpawn.apply(this, args);
  spawning = undefined;
  trace.terminal = terminal;
  trace.pid = terminal.pid;
  observed.push(trace);
  const socket = terminal._socket;
  const destroy = socket.destroy;
  socket.destroy = function (...destroyArgs) {
    trace.mark('socket-destroy', { stack: new Error().stack, readableLength: socket.readableLength });
    if (values['probe-before-destroy'] && !trace.destroyProbe && !socket.destroyed) {
      // Snapshot queued chunks without read(), which would emit data into business listeners.
      const buffered = Array.from(socket.readableBuffer ?? []).map(chunk => Buffer.from(chunk));
      const residual = [];
      const buffer = Buffer.alloc(65536);
      for (let attempt = 0; attempt < 256; attempt++) {
        try {
          const count = fs.readSync(terminal._fd, buffer, 0, buffer.length, null);
          trace.mark('pre-destroy-read', { count });
          if (!count) break;
          residual.push(Buffer.from(buffer.subarray(0, count)));
        } catch (error) {
          trace.mark('pre-destroy-read-error', { code: error.code });
          break;
        }
      }
      trace.destroyProbe = { buffered: Buffer.concat(buffered), residual: Buffer.concat(residual) };
    }
    return destroy.apply(this, destroyArgs);
  };
  socket.prependListener('error', error => trace.mark('socket-error', { code: error.code, message: error.message }));
  socket.prependListener('end', () => {
    trace.mark('socket-end');
    if (values['probe-after-end']) {
      // Observe bytes still available at EOF, without feeding them to the business consumer.
      const buffer = Buffer.alloc(65536);
      for (let attempt = 0; attempt < 256; attempt++) {
        try {
          const count = fs.readSync(terminal._fd, buffer, 0, buffer.length, null);
          trace.mark('post-end-read', { count });
          if (!count) break;
          trace.residual.push(Buffer.from(buffer.subarray(0, count)));
        } catch (error) {
          trace.mark('post-end-read-error', { code: error.code });
          break;
        }
      }
    }
  });
  socket.prependListener('close', () => trace.mark('socket-close'));
  const registerData = terminal.onData;
  const registerExit = terminal.onExit;
  registerData(chunk => {
    trace.raw.push(chunk);
    trace.bytes += Buffer.byteLength(chunk);
    trace.dataEvents.push({ ms: elapsed(trace), bytes: Buffer.byteLength(chunk), totalBytes: trace.bytes });
    const boundary = trace.tail + chunk;
    trace.tail = boundary.slice(-100);
    if (pauseNearExitMs && !trace.paused && boundary.includes('DSC_COMPLETED_STREAM_89800_')) {
      trace.paused = true;
      trace.mark('injected-read-pause', { durationMs: pauseNearExitMs });
      terminal.pause();
      trace.resumeTimer = setTimeout(() => { trace.mark('injected-read-resume'); terminal.resume(); }, pauseNearExitMs);
    }
    if (dataDelayMs) block(dataDelayMs);
  });
  trace.exit = new Promise(resolve => registerExit(event => {
    trace.mark('pty-exit', event);
    clearTimeout(trace.resumeTimer);
    trace.exited = true;
    resolve(event);
  }));
  Object.defineProperty(terminal, 'onData', { value: listener => registerData(chunk => {
    trace.forwarded.push(chunk);
    return listener(chunk);
  }) });
  Object.defineProperty(terminal, 'onExit', { value: listener => registerExit(event => {
    trace.mark('bridge-exit', event);
    return listener(event);
  }) });
  return terminal;
};

const runtime = values.mode === 'supervisor' ? await loadSupervisor() : undefined;
const results = [];
try {
  fs.writeFileSync(path.join(outputDir, 'environment.json'), JSON.stringify({
    node: process.version, versions: process.versions, executable: process.execPath, pid: process.pid,
    platform: process.platform, arch: process.arch,
    kernel: os.release(), ptyVersion: require('node-pty/package.json').version,
    mode: values.mode, runs, dataDelayMs, writerReceipt: values['writer-receipt'],
    probeAfterEnd: values['probe-after-end'], probeBeforeDestroy: values['probe-before-destroy'], pauseNearExitMs, lineCount
  }, null, 2));
  for (let run = 1; run <= runs; run++) {
    const dir = path.join(outputDir, `run-${run}`);
    assert.equal(fs.existsSync(dir), false, `Refusing to overwrite evidence: ${dir}`);
    fs.mkdirSync(dir);
    const summary = await diagnose(run, dir);
    results.push(summary);
    console.log(JSON.stringify(summary));
    observed.length = 0;
  }
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(results, null, 2));
  console.log(`Diagnostic evidence: ${outputDir}`);
} finally {
  pty.spawn = originalSpawn;
  native.fork = originalFork;
  for (const trace of observed) if (!trace.exited) trace.terminal.kill();
}

async function diagnose(run, dir) {
  let server;
  let session;
  let socket;
  let reader;
  let terminal;
  let final;
  const receiptPath = path.join(dir, 'writer-receipt.txt');
  const launchSpec = { file: '/bin/bash', args: ['--noprofile', '--norc', '-i'],
    cols: 96, rows: 28, cwd: dir, env: { ...process.env, PS1: '', PROMPT_COMMAND: '', HISTFILE: '/dev/null' },
    terminalName: 'xterm-256color' };
  try {
    if (runtime) {
      const storageDir = path.join(dir, 'storage');
      fs.mkdirSync(storageDir);
      server = new runtime.RuntimeSupervisorServer({ storageDir, registryPath: path.join(storageDir, 'registry.json') },
        'legacy-detached', 'best-effort');
      server.scheduleIdleShutdownIfNeeded = () => {};
      socket = new EventEmitter();
      Object.assign(socket, { destroyed: false, writableNeedDrain: false, write(line) {
        const message = JSON.parse(line);
        if (message.event === 'sessionState' && !message.payload.live) final = message.payload;
        return true;
      } });
      server.connections.add(socket);
      server.subscriptions.set(socket, new Map());
      server.terminalReads.set(socket, new Map());
      const snapshot = await server.createSession(socket, { kind: 'terminal', sessionId: `tail-${run}`,
        displayLabel: 'Tail diagnosis', launchMode: 'start', scrollback: 100000,
        terminalStreamMode: 'paged-until-exit', launchSpec });
      session = server.sessions.get(snapshot.sessionId);
      terminal = session.process;
      reader = await server.openTerminalRead(socket, { sessionId: session.sessionId,
        authorityId: session.terminalAuthorityId, consumerId: 'editor' });
    } else {
      terminal = pty.spawn(launchSpec.file, launchSpec.args, { ...launchSpec, name: launchSpec.terminalName });
    }
    const trace = observed.at(-1);
    const timeout = setTimeout(() => { trace.mark('diagnostic-timeout'); trace.terminal.kill(); }, 90000);
    const command = `i=1; ${values['writer-receipt'] ? 'failed=0; ' : ''}while [ "$i" -le ${lineCount} ]; do ` +
      `printf 'DSC_COMPLETED_STREAM_%05d_%032d\\r\\n' "$i" 0${values['writer-receipt'] ? ' || failed=1' : ''}; i=$((i+1)); done; ` +
      (values['writer-receipt'] ? `printf '%s:%s\\n' "$i" "$failed" > ${quote(receiptPath)}; ` : '') + 'exit\r';
    trace.mark('input', { command });
    terminal.write(command);
    try {
      await trace.exit;
      if (session) await session.finalizationPromise;
    } finally {
      clearTimeout(timeout);
    }
    const raw = trace.raw.join('');
    const forwarded = trace.forwarded.join('');
    const summary = { run, mode: values.mode, raw: inspect(raw), forwarded: runtime ? inspect(forwarded) : undefined,
      events: trace.dataEvents.length, exitEvents: trace.events };
    if (values['probe-after-end']) {
      const residual = Buffer.concat(trace.residual);
      summary.residualBytes = residual.length;
      summary.rawPlusResidual = inspect(raw + residual.toString('utf8'));
      fs.writeFileSync(path.join(dir, 'post-end-residual.txt'), residual);
    }
    if (trace.destroyProbe) {
      const { buffered, residual } = trace.destroyProbe;
      summary.destroyProbe = { bufferedBytes: buffered.length, residualBytes: residual.length,
        rawPlusPending: inspect(raw + buffered.toString('utf8') + residual.toString('utf8')) };
      fs.writeFileSync(path.join(dir, 'buffered-at-destroy.txt'), buffered);
      fs.writeFileSync(path.join(dir, 'residual-at-destroy.txt'), residual);
    }
    fs.writeFileSync(path.join(dir, 'raw.txt'), raw);
    fs.writeFileSync(path.join(dir, 'trace.json'), JSON.stringify({ pid: trace.pid, events: trace.events, data: trace.dataEvents }, null, 2));
    if (runtime) {
      await session.terminalJournal.flush();
      const journal = await session.terminalJournal.getEventsAfter(0);
      const text = journal.filter(event => event.type === 'output').map(event => event.data).join('');
      summary.journal = { ...inspect(text), revision: session.terminalJournal.getRevision() };
      summary.rawEqualsForwarded = raw === forwarded;
      summary.forwardedEqualsJournal = forwarded === text;
      fs.writeFileSync(path.join(dir, 'journal-output.txt'), text);
      fs.writeFileSync(path.join(dir, 'final.json'), JSON.stringify(final, null, 2));
      assert.ok(final && !final.live, 'must observe production final-state publication');
      const pages = [];
      let revision = reader.checkpoint.revision;
      const replay = new Terminal({ cols: reader.checkpoint.cols, rows: reader.checkpoint.rows, scrollback: 100000, allowProposedApi: true });
      await new Promise(resolve => replay.write(reader.checkpoint.serializedState.data, resolve));
      const pagedText = [];
      while (revision < final.terminalRevision) {
        const page = await server.readTerminalPage(socket, { ...reader, afterRevision: revision });
        assert.ok(page.revision > revision, 'page must advance');
        assert.equal(page.events[0].revision, revision + 1);
        for (const event of page.events) {
          if (event.type === 'output') {
            pagedText.push(event.data);
          } else if (event.type === 'resize') replay.resize(event.cols, event.rows);
        }
        const pageOutput = page.events.filter(event => event.type === 'output').map(event => event.data).join('');
        await new Promise(resolve => replay.write(pageOutput, resolve));
        pages.push({ after: revision, revision: page.revision, head: page.headRevision, bytes: Buffer.byteLength(pageOutput) });
        revision = page.revision;
      }
      const lines = [];
      for (let index = 0; index < replay.buffer.active.length; index++) {
        lines.push(replay.buffer.active.getLine(index).translateToString(true));
      }
      summary.page = { ...inspect(pagedText.join('')), revision, checkpointRevision: reader.checkpoint.revision };
      summary.xterm = inspect(lines.join('\n'));
      summary.journalEqualsPage = text === pagedText.join('');
      fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(pages, null, 2));
      fs.writeFileSync(path.join(dir, 'xterm.txt'), lines.join('\n'));
      replay.dispose();
    }
    if (values['writer-receipt']) summary.writerReceipt = fs.readFileSync(receiptPath, 'utf8').trim();
    // Exit status reports whether collection succeeded, not whether the output was complete.
    summary.outcome = summary.raw.complete ? 'complete' : 'raw-output-incomplete';
    if (runtime && (!summary.rawEqualsForwarded || !summary.forwardedEqualsJournal || !summary.journalEqualsPage)) {
      summary.outcome = 'downstream-mismatch';
    }
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    // Keep the journal on disk as evidence; only stop handles and timers owned by this fixture.
    if (server) {
      if (server.persistTimer) clearTimeout(server.persistTimer);
      await server.persistRegistryChain;
      for (const current of server.sessions.values()) server.disposeSession(current, { terminateProcess: current.live });
      if (server.persistTimer) clearTimeout(server.persistTimer);
    }
  }
}

async function loadSupervisor() {
  const filename = path.join(root, 'extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const calls = ast.statements.filter(node => ts.isExpressionStatement(node) && node.getText(ast).startsWith('void main()'));
  assert.equal(calls.length, 1);
  const contents = source.slice(0, calls[0].pos) + source.slice(calls[0].end) + '\nexport { RuntimeSupervisorServer };';
  const bundle = await esbuild.build({ stdin: { contents, resolveDir: path.dirname(filename), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['node-pty'] });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

function createTrace() {
  const trace = { start: performance.now(), raw: [], forwarded: [], residual: [], dataEvents: [], events: [], bytes: 0, tail: '' };
  trace.mark = (event, detail = {}) => trace.events.push({ event, ms: elapsed(trace), bytes: trace.bytes, ...detail });
  return trace;
}

function inspect(text) {
  // Readline can put a bracketed-paste control sequence before the first output line.
  const lines = [...text.matchAll(/DSC_COMPLETED_STREAM_\d{5}_[0-9]*/g)].map(match => match[0]);
  const complete = lines.filter(line => /^DSC_COMPLETED_STREAM_\d{5}_0{32}$/.test(line));
  const mismatch = lines.findIndex((line, index) => line !== `${prefix}${String(index + 1).padStart(5, '0')}_${'0'.repeat(32)}`);
  return { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'),
    lines: lines.length, completeLines: complete.length, firstMismatch: mismatch < 0 ? undefined : mismatch + 1,
    tail: lines.slice(-3), complete: lines.length === lineCount && mismatch === -1 };
}

function elapsed(trace) { return Math.round((performance.now() - trace.start) * 1000) / 1000; }
function block(ms) { const until = performance.now() + ms; while (performance.now() < until) {} }
function integer(value, min, max) { const result = Number(value); assert.ok(Number.isInteger(result) && result >= min && result <= max); return result; }
function quote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }

function selfTest() {
  const lines = Array.from({ length: lineCount }, (_, index) => `${prefix}${String(index + 1).padStart(5, '0')}_${'0'.repeat(32)}`);
  const complete = lines.join('\r\r\n');
  assert.equal(inspect(complete).complete, true);
  assert.equal(inspect(`printf 'DSC_COMPLETED_STREAM_%05d_%032d'\r\n\x1b[?2004l${complete}`).complete, true);
  assert.equal(inspect(complete.slice(0, -1)).complete, false);
  assert.equal(inspect(lines.slice(0, -1).join('\n')).lines, lineCount - 1);
  assert.equal(inspect(complete + lines.at(-1)).complete, false);
  assert.equal(inspect(lines[1] + '\n' + lines[0]).firstMismatch, 1);
  assert.equal(inspect('DSC_COMPLETED_STREAM_00001_').completeLines, 0);
  assert.equal(quote("a'b"), "'a'\\''b'");
}
