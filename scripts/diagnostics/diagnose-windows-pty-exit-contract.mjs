import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import vm from 'node:vm';

// Runs installed Windows lifecycle JavaScript, not Windows native ConPTY.
const require = createRequire(import.meta.url);
const packagePath = require.resolve('node-pty/package.json');
const packageDirectory = path.dirname(packagePath);
const libDirectory = path.join(packageDirectory, 'lib');
const packageInfo = JSON.parse(readFileSync(packagePath, 'utf8'));

class Clock {
  time = 0;
  nextId = 1;
  timers = new Map();

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { time: this.time + delay, callback });
    return id;
  };

  clearTimeout = (id) => this.timers.delete(id);

  advance(duration) {
    const target = this.time + duration;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.time <= target)
        .sort((left, right) => left[1].time - right[1].time || left[0] - right[0])[0];
      if (!next) break;
      this.time = next[1].time;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
  }
}

function fixture({ useConptyDll = false } = {}) {
  const clock = new Clock();
  const trace = [];
  const record = (event, details = {}) => trace.push({ atMs: clock.time, event, ...details });
  let notifyNativeExit;
  let signalWorkerReady;

  class Socket extends EventEmitter {
    readable = true;
    destroyed = false;
    paused = false;
    pending = '';
    decoder = new StringDecoder('utf8');

    setEncoding(encoding) { this.decoder = new StringDecoder(encoding); }
    connect() { clock.setTimeout(() => this.emit('connect'), 0); }
    write() { return !this.destroyed; }
    pause() { this.paused = true; }
    resume() {
      this.paused = false;
      if (this.pending && !this.destroyed) {
        const pending = this.pending;
        this.pending = '';
        this.emit('data', pending);
      }
    }
    deliver(bytes) {
      if (this.destroyed) {
        record('delivery-after-destroy', { bytes: bytes.length });
        return;
      }
      const text = this.decoder.write(bytes);
      if (this.paused) this.pending += text;
      else if (text) this.emit('data', text);
    }
    remoteEnd() {
      assert.equal(this.destroyed, false);
      assert.equal(this.paused, false);
      const text = this.decoder.end();
      if (text) this.emit('data', text);
      this.emit('end');
      this.destroy();
    }
    destroy() {
      if (this.destroyed) return;
      record('socket-destroy', {
        pendingCharacters: this.pending.length,
        decoderPendingBytes: this.decoder.lastNeed ? this.decoder.lastTotal - this.decoder.lastNeed : 0
      });
      this.destroyed = true;
      this.emit('close');
    }
  }

  const native = {
    startProcess: () => ({ fd: -1, pty: 1, conout: 'diagnostic-out', conin: 'diagnostic-in' }),
    connect: (_pty, _command, _cwd, _env, _dll, onExit) => {
      notifyNativeExit = onExit;
      return { pid: 12345 };
    }
  };
  const overrides = {
    fs: { openSync: () => -1 },
    net: { Socket },
    './utils': { assign: Object.assign, loadNativeModule: () => ({ module: native }) },
    './windowsConoutConnection': {
      ConoutConnection: class {
        onReady(listener) { signalWorkerReady = listener; }
        connectSocket(socket) { socket.connect(); }
      }
    }
  };
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const filename = path.join(libDirectory, `${name}.js`);
    const module = { exports: {} };
    const localRequire = createRequire(filename);
    const controlledRequire = (specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === './windowsPtyAgent') return load('windowsPtyAgent');
      return localRequire(specifier);
    };
    const context = vm.createContext({
      console, process, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
    });
    const wrapper = new vm.Script(
      `(function(require,module,exports,__dirname,__filename){${readFileSync(filename, 'utf8')}\n})`,
      { filename }
    ).runInContext(context);
    wrapper(controlledRequire, module, module.exports, libDirectory, filename);
    cache.set(name, module.exports);
    return module.exports;
  }

  const { WindowsTerminal } = load('windowsTerminal');
  const terminal = new WindowsTerminal('cmd.exe', [], { env: {}, useConptyDll });
  const socket = terminal._socket;
  let output = '';
  let ended = false;
  const exits = [];
  terminal.onData((data) => { output += data; record('onData', { text: data }); });
  terminal.onExit((event) => { exits.push(event.exitCode); record('onExit', { exitCode: event.exitCode }); });
  socket.on('end', () => { ended = true; record('socket-end'); });
  signalWorkerReady();
  clock.advance(0);
  return {
    clock, terminal, socket,
    data: (text) => socket.deliver(Buffer.isBuffer(text) ? text : Buffer.from(text)),
    exit: () => { record('native-process-exit'); notifyNativeExit(0); },
    summary: () => ({ output, ended, exits, destroyed: socket.destroyed, trace })
  };
}

function runControlledCases() {
  const results = [];
  function run(name, exercise, expected) {
    const run = fixture(expected.options);
    run.data('HEAD\n');
    exercise(run);
    const summary = run.summary();
    assert.equal(summary.output, expected.output, name);
    assert.equal(summary.ended, expected.ended, name);
    assert.equal(summary.destroyed, expected.destroyed, name);
    assert.deepEqual(summary.exits, expected.exits, name);
    results.push({ name, ...summary });
  }

  run('natural-eof-control', (run) => {
    run.exit(); run.data('TAIL\n'); run.socket.remoteEnd();
  }, { output: 'HEAD\nTAIL\n', ended: true, destroyed: true, exits: [0] });
  run('late-delivery-after-inactivity-timeout', (run) => {
    run.exit(); run.clock.advance(1001); run.data('TAIL\n');
  }, { output: 'HEAD\n', ended: false, destroyed: true, exits: [0] });
  run('received-data-resets-inactivity-timeout', (run) => {
    run.exit(); run.clock.advance(999); run.data('TAIL\n'); run.clock.advance(999);
    assert.equal(run.socket.destroyed, false);
    run.socket.remoteEnd();
  }, { output: 'HEAD\nTAIL\n', ended: true, destroyed: true, exits: [0] });
  run('paused-readable-buffer-discarded', (run) => {
    run.terminal.pause(); run.data('TAIL\n'); run.exit(); run.clock.advance(1000);
    assert.equal(run.socket.pending, 'TAIL\n');
  }, { output: 'HEAD\n', ended: false, destroyed: true, exits: [0] });
  run('split-utf8-control', (run) => {
    run.exit(); run.data(Buffer.from([0xe4, 0xb8])); run.clock.advance(999);
    run.data(Buffer.from([0xad])); run.socket.remoteEnd();
  }, { output: 'HEAD\n\u4e2d', ended: true, destroyed: true, exits: [0] });
  run('split-utf8-does-not-reset-data-timer-until-decoded', (run) => {
    run.exit(); run.clock.advance(999); run.data(Buffer.from([0xe4, 0xb8]));
    run.clock.advance(2); run.data(Buffer.from([0xad]));
  }, { output: 'HEAD\n', ended: false, destroyed: true, exits: [0] });
  run('dll-branch-has-no-native-exit-inactivity-timer', (run) => {
    run.exit(); run.clock.advance(2000); run.data('TAIL\n'); run.socket.remoteEnd();
  }, {
    options: { useConptyDll: true },
    output: 'HEAD\nTAIL\n', ended: true, destroyed: true, exits: [0]
  });
  return results;
}

async function runRealSocketControl() {
  const { WindowsPtyAgent } = require(path.join(libDirectory, 'windowsPtyAgent.js'));
  const server = net.createServer();
  let reader;
  let writer;
  let agent;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    reader = net.createConnection(server.address().port, '127.0.0.1');
    const connected = once(reader, 'connect');
    [writer] = await once(server, 'connection');
    await connected;
    reader.setEncoding('utf8');
    let output = '';
    let ended = false;
    reader.on('data', (data) => { output += data; });
    reader.on('end', () => { ended = true; });
    const initialData = once(reader, 'data');
    writer.write('HEAD\n');
    await initialData;
    reader.pause();
    writer.write('TAIL\n');
    // A temporary readable listener can resume the socket when removed.
    const bufferDeadline = Date.now() + 2000;
    while (reader.readableLength < 5 && Date.now() < bufferDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const bufferedCharacters = reader.readableLength;
    assert.equal(bufferedCharacters, 5);
    agent = Object.create(WindowsPtyAgent.prototype);
    agent._useConptyDll = false;
    agent._inSocket = { readable: true };
    agent._outSocket = reader;
    const closed = once(reader, 'close');
    const start = Date.now();
    agent._$onProcessExit(0);
    await closed;
    assert.equal(output, 'HEAD\n');
    assert.equal(ended, false);
    assert.equal(reader.destroyed, true);
    return {
      transport: 'local-TCP-not-ConPTY', bufferedCharacters, output, ended,
      destroyed: reader.destroyed, exitCode: agent.exitCode,
      closeAfterNativeExitMs: Date.now() - start
    };
  } finally {
    clearTimeout(agent?._closeTimeout);
    reader?.destroy();
    writer?.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

const deadline = setTimeout(() => {
  console.error('Diagnostic exceeded its 15-second safety deadline');
  process.exit(1);
}, 15000);
try {
  const result = {
    scope: 'installed-Windows-JavaScript-contract-only; not-Windows-native-ConPTY-validation',
    platform: process.platform,
    node: process.version,
    nodePtyVersion: packageInfo.version,
    sources: ['windowsTerminal.js', 'windowsPtyAgent.js', 'windowsConoutConnection.js'].map((name) => ({
      path: path.join(libDirectory, name),
      sha256: createHash('sha256').update(readFileSync(path.join(libDirectory, name))).digest('hex')
    })),
    controlledCases: runControlledCases(),
    realSocketControl: await runRealSocketControl(),
    selfChecksPassed: true
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(deadline);
}
