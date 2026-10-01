import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
let active;
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/windowsExecutionProvider.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18', write: false,
  plugins: [{ name: 'controlled-windows-channel', setup(build) {
    build.onResolve({ filter: /^\.\/executionProviderChannel$/ }, () => ({ path: 'controlled-channel', external: true }));
  } }]
});
const module = { exports: {} };
new Function('require', 'module', 'exports', 'process', 'setTimeout', outputFiles[0].text)(
  name => name === 'controlled-channel' ? { createExecutionProviderChannel: (...args) => active.channel(...args) } : require(name),
  module, module.exports, { ...process, platform: 'win32' },
  (callback, delay) => { assert.equal(delay, 5); active.timers.push(callback); }
);
const { runWindowsExecutionProvider } = module.exports;
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  const identity = { executionId: 'windows-core-subject', generation: 'first-generation' };
  const token = JSON.stringify([identity.executionId, identity.generation]);
  const state = {
    token, busy: false, ownerAcquired: false, ownerReleased: false,
    processAcquired: false, processReleased: true, processState: 'not-started', pid: null, exitCode: null,
    waitError: 0, closeRequested: false, closeCalled: false, closeReturned: false,
    connectAttempted: false, connected: false, releaseAttempted: false, releaseResult: 0, resizeResult: 0, error: null
  };
  const source = deferred(), pipesClosed = deferred(), done = deferred();
  let handlers, consume, inputClosed = false, outputEnded = false;
  const messages = [], writes = [], events = [], inputs = [], timers = [];
  const settlePipes = () => { if (inputClosed && outputEnded) pipesClosed.resolve({ input: true, source: true }); };
  const binding = {
    async executionStart(received) {
      assert.equal(received, token);
      state.ownerAcquired = true;
      events.push('native-start');
      if (options.failStart) throw new Error('controlled partial start failure');
      return { conin: 'controlled-in', conout: 'controlled-out' };
    },
    async executionConnect(received, commandLine) {
      assert.equal(received, token);
      assert.equal(commandLine, 'controlled-command-line');
      Object.assign(state, { processAcquired: true, processReleased: false, processState: 'pending',
        connected: true, connectAttempted: true, releaseAttempted: true, pid: 345 });
      events.push('native-connect');
      if (options.failConnect) throw new Error('controlled partial connect failure');
      return { pid: 345 };
    },
    executionPollWait(received) { assert.equal(received, token); events.push('poll'); return { ...state }; },
    executionSnapshot(received) { assert.equal(received, token); return { ...state }; },
    async executionResize(received, cols, rows) {
      assert.equal(received, token);
      assert.deepEqual([cols, rows], [101, 37]);
      events.push('resize-start');
      await options.resizeGate?.promise;
      events.push('resize-end');
      return { kind: 'resized' };
    },
    async executionClose(received) {
      assert.equal(received, token);
      assert.equal(state.closeRequested, false, 'only the original owner may close, once');
      state.closeRequested = true;
      events.push('close-request');
      await options.resizeGate?.promise;
      Object.assign(state, { closeCalled: true, closeReturned: true, ownerReleased: !options.closeUnknown });
      events.push('close-return');
      return { kind: options.closeUnknown ? 'unknown' : 'closed' };
    }
  };
  const pipes = {
    acquired: { input: true, source: true }, ready: Promise.resolve(), closed: pipesClosed.promise,
    output(callback) { consume = callback; return source.promise; },
    async write(bytes) { inputs.push(Buffer.from(bytes)); await options.inputGate?.promise; },
    closeInput() { inputClosed = true; settlePipes(); },
    cancel(reason) {
      events.push('cancel-output');
      if (!outputEnded) { outputEnded = true; source.resolve({ kind: 'interrupted', reason }); settlePipes(); }
    }
  };
  const h = {
    identity, state, messages, writes, events, inputs, timers, binding,
    channel(received, value) {
      assert.deepEqual(received, identity);
      handlers = value;
      return {
        ready: async () => {},
        send: async message => {
          if (message.type === 'resourceResult') assert(messages.some(entry => entry.type === 'resourceAcquired' && entry.resourceId === message.resourceId));
          messages.push(message);
        },
        write(text) {
          assert(writes.every(entry => entry.resolved), 'only one owned output transfer may be active');
          const waiter = deferred();
          const entry = { text, resolved: false, resolve() { entry.resolved = true; waiter.resolve(); } };
          writes.push(entry);
          return waiter.promise;
        },
        async end(disposition) { assert(writes.every(entry => entry.resolved)); events.push('source-handoff'); h.source = disposition; },
        async close() { events.push('channel-close'); }
      };
    },
    command(command) { handlers.onCommand({ identity, ...command }); },
    async begin(stopStrategy = 'hangup') {
      h.command({ type: 'start', operationId: 'start', spec: {
        file: 'controlled.exe', args: [], cwd: 'C:\\owned', cols: 80, rows: 24, stopStrategy
      } });
      await flush();
    },
    output(bytes) { return consume(bytes); },
    end(disposition = { kind: 'eof' }) {
      outputEnded = true;
      source.resolve(disposition);
      settlePipes();
    },
    async exit(code = 0) {
      Object.assign(state, { processState: 'exited', exitCode: code, processReleased: true });
      for (const callback of timers.splice(0)) callback();
      await flush();
    },
    async result() {
      let timeout;
      try { return await Promise.race([done.promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Controlled provider did not settle')), 1000); })]); }
      finally { clearTimeout(timeout); }
    }
  };
  active = h;
  runWindowsExecutionProvider({ identity, binding, workerPath: '/verified-worker.js',
    commandLine: () => 'controlled-command-line', createPipes: () => pipes }).then(done.resolve, done.reject);
  return h;
}

{
  const h = harness();
  await h.begin();
  const first = h.output(Buffer.from([0xe4, 0xb8]));
  await first;
  assert.equal(h.writes.length, 0, 'UTF-8 incomplete bytes remain owned by decoder');
  const second = h.output(Buffer.from([0xad, 0x0d, 0x0a]));
  await flush();
  assert.equal(h.writes[0].text, '\u4e2d\r\n');
  await h.exit(7);
  assert(h.messages.some(message => message.type === 'processResult' && message.result.exitCode === 7),
    'process observation must advance while output awaits credit');
  assert(!h.events.includes('close-request'));
  h.writes[0].resolve();
  await second;
  h.end();
  const result = await h.result();
  assert.equal(result.kind, 'closed');
  assert.equal(result.resourcesSettled, true);
  assert.equal(result.source.kind, 'eof');
  assert(h.events.indexOf('source-handoff') < h.events.indexOf('close-request'));
  assert.equal(h.messages.filter(message => message.type === 'resourceResult' && message.result.kind === 'released').length, 4);
}

{
  const inputGate = deferred(), resizeGate = deferred();
  const h = harness({ inputGate, resizeGate });
  await h.begin('interrupt-then-hangup');
  h.command({ type: 'input', interactionId: 1, data: 'typed' });
  h.command({ type: 'resize', interactionId: 2, cols: 101, rows: 37 });
  await flush();
  assert(h.events.includes('resize-start'), 'resize is not blocked behind stdin');
  h.command({ type: 'requestStop', operationId: 'graceful', mode: 'graceful' });
  await flush();
  assert.equal(h.inputs.length, 1, 'ETX must not overtake an in-flight input write');
  inputGate.resolve();
  await flush();
  assert.equal(h.inputs[1][0], 3);
  h.command({ type: 'requestStop', operationId: 'force', mode: 'force' });
  await flush();
  assert(h.events.includes('close-request'));
  assert(!h.events.includes('close-return'));
  assert(!h.events.includes('cancel-output'), 'hangup keeps the output reader active');
  resizeGate.resolve();
  await h.exit();
  h.end();
  const result = await h.result();
  assert.equal(result.kind, 'closed');
  assert.equal(result.source.kind, 'eof');
  assert(h.events.indexOf('resize-end') < h.events.indexOf('close-return'));
  assert.equal(h.events.filter(event => event === 'close-request').length, 1);
}

{
  const h = harness();
  await h.begin();
  h.command({ type: 'cancelOutput', operationId: 'cancel', reason: 'explicit-cancel' });
  await h.exit();
  const result = await h.result();
  assert.equal(result.source.kind, 'interrupted');
  assert.equal(result.resourcesSettled, true);
}

{
  const h = harness({ failStart: true });
  await h.begin();
  const result = await h.result();
  assert.equal(result.kind, 'failed');
  assert.equal(result.resourcesSettled, true);
  assert.equal(result.source.kind, 'unknown');
  assert(h.messages.some(message => message.type === 'resourceAcquired' && message.resourceId === 'conpty-owner'));
  assert(!h.messages.some(message => message.type === 'resourceAcquired' && message.resourceId === 'conpty-process'));
}

{
  const h = harness({ failConnect: true });
  await h.begin();
  await h.exit();
  const result = await h.result();
  assert.equal(result.kind, 'failed');
  assert.equal(result.resourcesSettled, true);
  assert(h.messages.some(message => message.type === 'resourceAcquired' && message.resourceId === 'conpty-process'));
  assert.equal(h.events.filter(event => event === 'close-request').length, 1);
}

{
  const h = harness({ closeUnknown: true });
  await h.begin();
  await h.exit();
  h.end();
  const result = await h.result();
  assert.equal(result.kind, 'failed');
  assert.equal(result.resourcesSettled, false);
  assert(h.messages.some(message => message.type === 'resourceResult' && message.resourceId === 'conpty-owner'
    && message.result.kind === 'unknown'));
}

console.log('Windows execution provider core: 6 controlled cases passed; no Windows native calls.');
