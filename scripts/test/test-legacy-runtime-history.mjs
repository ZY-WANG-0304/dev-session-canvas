import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const sourceRoot = path.resolve('extensions/vscode/dev-session-canvas/src');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-legacy-'));
const backendCode = await bundle('panel/runtimeHostBackend.ts');
const historyCode = await bundle('panel/legacyRuntimeHistory.ts');
let passed = 0;
const nativeSocketsAvailable = await new Promise(resolve => {
  const socket = net.createConnection(path.join(root, 'missing-socket'));
  socket.once('error', error => { socket.destroy(); resolve(error.code === 'ENOENT'); });
  socket.once('connect', () => { socket.destroy(); resolve(false); });
});

try {
  for (const slot of ['legacy-slot', 'legacy-slot-1']) {
    for (const kind of ['agent', 'terminal']) {
      await test(`unversioned detached ${slot} ${kind} permits only local restored history cleanup`, async () => {
        const f = await fixture({ detached: true, kind,
          baseStorageRelativePath: path.join('workspaceStorage', slot, 'devsessioncanvas.dev-session-canvas') });
        const before = await fs.stat(f.backend.paths.registryPath);
        assert.equal(await f.inspect(), 'detached-recovered-history');
        assert.equal(f.calls.length, 0);
        assert.equal(f.observation.scans, 2);
        assert.equal(f.observation.sockets, 2);
        assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
        const after = await fs.stat(f.backend.paths.registryPath);
        assert.equal(after.ino, before.ino);
        assert.equal(after.mtimeMs, before.mtimeMs);
        assert.equal(after.ctimeMs, before.ctimeMs);
      });
    }
  }

  const unversionedPath = path.join('workspaceStorage', 'legacy-slot', 'devsessioncanvas.dev-session-canvas');
  for (const options of [
    { detached: false },
    { baseStorageRelativePath: path.join('unrelatedStorage', 'legacy-slot', 'devsessioncanvas.dev-session-canvas') },
    { baseStorageRelativePath: path.join('workspaceStorage', 'legacy-slot', 'other-extension') },
    { baseStorageRelativePath: path.join('runtime-supervisor-generations', 'devsessioncanvas.dev-session-canvas') },
    { patch: { live: true } }, { patch: { lastExitMessageDescriptor: undefined } },
    { patch: { kind: 'terminal' } }, { patch: { runtimeBackend: 'systemd-user' } },
    { registry: { version: 1, sessions: [] } },
    { socketResult: 'connect' }, { socketResult: 'EACCES' },
    { processes: { 42: { error: 'EACCES' } } },
    { processes: backend => ({ 42: { argv: ['node', '/old-supervisor', '--storage-dir', backend.paths.storageDir] } }) }
  ]) {
    await test(`unversioned history retains layout and evidence protections: ${JSON.stringify(options)}`, async () => {
      const f = await fixture({ detached: true, baseStorageRelativePath: unversionedPath, ...options });
      assert.equal(await f.inspect(), undefined);
      assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
    });
  }

  await test('unversioned registry replacement still rejects history cleanup', async () => {
    const f = await fixture({ detached: true, baseStorageRelativePath: unversionedPath, onProcScan: async scan => {
      if (scan !== 2) return;
      const replacement = `${f.backend.paths.registryPath}.replacement`;
      await fs.writeFile(replacement, f.bytes);
      await fs.rename(replacement, f.backend.paths.registryPath);
    } });
    assert.equal(await f.inspect(), undefined);
    assert.equal(f.observation.scans, 2);
  });

  for (const generation of ['agent-provider-lifecycle-v1', 'terminal-stream-v1']) {
    for (const kind of ['agent', 'terminal']) {
      await test(`${generation} ${kind} permits stopped legacy history without changing any registry entry`, async () => {
        const f = await fixture({ generation, kind });
        const before = await fs.stat(f.backend.paths.registryPath);
        assert.equal(await f.inspect(), 'recorded-exit');
        assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
        const after = await fs.stat(f.backend.paths.registryPath);
        assert.equal(after.ino, before.ino);
        assert.equal(after.mtimeMs, before.mtimeMs);
        assert.equal(after.ctimeMs, before.ctimeMs);
        assert.equal(f.calls.length, 2);
        for (const call of f.calls) {
          assert.deepEqual(call.args.slice(0, 5), ['--user', 'show', '--all', '--no-pager', call.args[4]]);
          assert.match(call.args[4], /^--property=/);
          assert.equal(call.args.at(-1), f.backend.paths.unitName);
          assert.equal(call.options.timeout, 4000);
          assert.equal(call.options.maxBuffer, 16384);
        }
      });
    }
  }

  await test('a detached native generation cannot borrow the recovered legacy record rule', async () => {
    const f = await fixture({ detached: true, generation: 'terminal-exit-v1' });
    assert.equal(await f.inspect(), undefined);
    assert.equal(f.observation.scans, 0);
  });

  if (nativeSocketsAvailable) await test('a refused stale socket can qualify and remains untouched', async () => {
    const f = await fixture({ netOverride: net });
    await fs.mkdir(path.dirname(f.backend.paths.socketPath), { recursive: true });
    await fs.writeFile(f.backend.paths.socketPath, 'controlled stale socket path');
    assert.equal(await f.inspect(), 'recorded-exit');
    assert.equal(await fs.readFile(f.backend.paths.socketPath, 'utf8'), 'controlled stale socket path');
  });

  if (nativeSocketsAvailable) await test('a listening socket rejects cleanup and receives no protocol request', async () => {
    const f = await fixture({ netOverride: net });
    await fs.mkdir(path.dirname(f.backend.paths.socketPath), { recursive: true });
    const received = [];
    const connections = new Set();
    const server = net.createServer(socket => {
      connections.add(socket);
      socket.on('data', chunk => received.push(chunk));
      socket.on('close', () => connections.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(f.backend.paths.socketPath, resolve);
    });
    try {
      assert.equal(await f.inspect(), undefined);
      assert.deepEqual(received, []);
      assert.equal(f.calls.length, 1);
    } finally {
      for (const connection of connections) connection.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  });

  if (!nativeSocketsAvailable) console.log('SKIP: 2 native Unix socket cases; this environment rejects socket access.');
  for (const event of ['ECONNREFUSED', 'ENOENT', 'connect']) {
    await test(`controlled original socket ${event} is distinguished and closed`, async () => {
      let destroyed = 0;
      const f = await fixture({ netOverride: {
        createConnection(socketPath) {
          assert.equal(socketPath, f.backend.paths.socketPath);
          const socket = new EventEmitter();
          socket.destroy = () => { destroyed++; };
          queueMicrotask(() => event === 'connect' ? socket.emit('connect')
            : socket.emit('error', Object.assign(new Error(event), { code: event })));
          return socket;
        }
      } });
      assert.equal(await f.inspect(), event === 'connect' ? undefined : 'recorded-exit');
      assert.equal(destroyed, event === 'connect' ? 1 : 2);
    });
  }

  for (const options of [
    { platform: 'darwin' }, { platform: 'win32' }, { backendKind: 'legacy-detached' },
    { generation: 'terminal-exit-v1' }, { generation: 'terminal-exit-macos-v1' },
    { generation: 'terminal-exit-windows-v1' }, { generation: 'future-unknown' },
    { generation: 'agent-provider-lifecycle-v1', malformedShape: true }
  ]) {
    await test(`unsupported backend/platform/generation stays unknown: ${JSON.stringify(options)}`, async () => {
      const f = await fixture(options);
      assert.equal(await f.inspect(), undefined);
      assert.equal(f.calls.length, 0);
    });
  }

  for (const patch of [
    { live: true }, { lifecycle: 'running' }, { lifecycle: 'history-restored' },
    { lifecycle: 'stopping' }, { lifecycle: 'error' }, { lastExitCode: undefined },
    { lastExitCode: '0' }, { lastExitCode: 0.5 }, { kind: 'terminal' },
    { runtimeBackend: 'legacy-detached' }
  ]) {
    await test(`ambiguous target registry rejects cleanup: ${JSON.stringify(patch)}`, async () => {
      const f = await fixture({ patch });
      assert.equal(await f.inspect(), undefined);
      assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
    });
  }

  for (const [kind, patch] of [
    ['terminal', { live: true, lifecycle: 'live', lastExitCode: undefined }],
    ['agent', { live: true, lifecycle: 'waiting-input', lastExitCode: undefined }],
    ['terminal', { live: false, lifecycle: 'closed', lastExitCode: undefined }],
    ['agent', { live: false, lifecycle: 'stopped', lastExitCode: undefined }]
  ]) {
    await test(`fresh stopped control-group evidence permits ${kind} ${patch.lifecycle} without fabricating an exit`, async () => {
      const f = await fixture({ kind, patch, statePatch: { KillMode: 'control-group', SendSIGKILL: 'yes' } });
      const before = await fs.stat(f.backend.paths.registryPath);
      assert.equal(await f.inspect(), 'stopped-runtime');
      assert.equal(f.calls.length, 2);
      assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
      const after = await fs.stat(f.backend.paths.registryPath);
      assert.equal(after.ino, before.ino);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(after.ctimeMs, before.ctimeMs);
    });
  }

  for (const statePatch of [
    { KillMode: 'process' }, { KillMode: 'mixed' }, { KillMode: 'none' }, { KillMode: undefined },
    { SendSIGKILL: 'no' }, { SendSIGKILL: 'false' }, { SendSIGKILL: undefined },
    { ActiveState: 'active' }, { LoadState: 'not-found' }, { SubState: 'exited' },
    { ControlGroup: '/remaining-group' }, { Job: '1234' }
  ]) {
    await test(`lost runtime requires fresh full control-group stopping evidence: ${JSON.stringify(statePatch)}`, async () => {
      const f = await fixture({ kind: 'terminal', patch: { live: true, lifecycle: 'live', lastExitCode: undefined },
        statePatch: { KillMode: 'control-group', SendSIGKILL: 'yes', ...statePatch } });
      assert.equal(await f.inspect(), undefined);
      assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
    });
  }

  for (const patch of [
    { live: 'true' }, { live: undefined }, { lifecycle: 'future-unknown' },
    { lifecycle: 'waiting-input' }, { lastExitCode: '0' }, { lastExitCode: null }, { runtimeBackend: 'legacy-detached' }
  ]) {
    await test(`strong service evidence cannot excuse malformed terminal identity: ${JSON.stringify(patch)}`, async () => {
      const f = await fixture({ kind: 'terminal', patch: { live: true, lifecycle: 'live', lastExitCode: undefined, ...patch },
        statePatch: { KillMode: 'control-group', SendSIGKILL: 'yes' } });
      assert.equal(await f.inspect(), undefined);
    });
  }

  await test('recorded exits retain their original eligibility without the stronger stopping policy', async () => {
    const f = await fixture({ statePatch: { KillMode: 'process', SendSIGKILL: 'no' } });
    assert.equal(await f.inspect(), 'recorded-exit');
  });

  await test('control-group policy changes during the second observation reject lost runtime cleanup', async () => {
    const f = await fixture({ kind: 'terminal', patch: { live: true, lifecycle: 'live', lastExitCode: undefined },
      statePatch: { KillMode: 'control-group', SendSIGKILL: 'yes' },
      show: (state, call) => call === 2 ? state.replace('KillMode=control-group', 'KillMode=process') : state });
    assert.equal(await f.inspect(), undefined);
    assert.equal(f.calls.length, 2);
  });

  for (const registry of [
    { version: 2, sessions: [] }, { version: 1, sessions: [] }, { version: 1, sessions: {} },
    { version: 1, sessions: [target(), target()] }, null
  ]) {
    await test(`missing or ambiguous registry identity stays unknown: ${JSON.stringify(registry)}`, async () => {
      const f = await fixture({ registry });
      assert.equal(await f.inspect(), undefined);
    });
  }

  await test('malformed missing oversized and non-file registries stay unknown', async () => {
    const f = await fixture();
    await fs.writeFile(f.backend.paths.registryPath, '{');
    assert.equal(await f.inspect(), undefined);
    await fs.rm(f.backend.paths.registryPath);
    assert.equal(await f.inspect(), undefined);
    await fs.writeFile(f.backend.paths.registryPath, '');
    assert.equal(await f.inspect(), undefined);
    await fs.truncate(f.backend.paths.registryPath, 32 * 1024 * 1024 + 1);
    assert.equal(await f.inspect(), undefined);
    await fs.rm(f.backend.paths.registryPath);
    await fs.mkdir(f.backend.paths.registryPath);
    assert.equal(await f.inspect(), undefined);
  });

  await test('registry symlink and storage path alias stay unknown', async () => {
    const f = await fixture();
    const original = `${f.backend.paths.registryPath}.original`;
    await fs.rename(f.backend.paths.registryPath, original);
    await fs.symlink(original, f.backend.paths.registryPath);
    assert.equal(await f.inspect(), undefined);
    assert.equal(await fs.readFile(original, 'utf8'), f.bytes);
    f.backend.paths.storageDir += '/.';
    assert.equal(await f.inspect(), undefined);
  });

  for (const field of ['registryPath', 'socketPath', 'unitName', 'unitFilePath']) {
    await test(`foreign ${field} is not an original binding`, async () => {
      const f = await fixture();
      f.backend.paths[field] += '-foreign';
      assert.equal(await f.inspect(), undefined);
      assert.equal(f.calls.length, 0);
    });
  }

  for (const statePatch of [
    { LoadState: 'not-found' }, { ActiveState: 'active' }, { SubState: 'exited' },
    { ActiveState: 'failed' }, { MainPID: '1234' }, { ControlPID: '1234' },
    { ControlGroup: '/user.slice/remaining' }, { Job: '1234' }, { Id: 'unrelated.service' },
    { InvocationID: 'invalid' }, { StateChangeTimestampMonotonic: '' }, { MainPID: undefined }
  ]) {
    await test(`non-authoritative systemd state rejects cleanup: ${JSON.stringify(statePatch)}`, async () => {
      const f = await fixture({ statePatch });
      assert.equal(await f.inspect(), undefined);
    });
  }

  await test('systemd failure and malformed duplicate properties remain unknown', async () => {
    for (const show of [() => { throw new Error('controlled timeout or permission failure'); },
      state => `${state}\nMainPID=0\n`, () => 'malformed']) {
      const f = await fixture({ show });
      assert.equal(await f.inspect(), undefined);
    }
  });

  await test('an inactive service state transition during inspection rejects cleanup', async () => {
    const f = await fixture({ show: (state, call) => call === 1 ? state
      : state.replace('StateChangeTimestampMonotonic=100', 'StateChangeTimestampMonotonic=101') });
    assert.equal(await f.inspect(), undefined);
    assert.equal(f.calls.length, 2);
  });

  await test('registry replacement during the second systemd observation rejects cleanup', async () => {
    const f = await fixture({ show: async (state, call) => {
      if (call === 2) {
        const replacement = `${f.backend.paths.registryPath}.replacement`;
        await fs.writeFile(replacement, f.bytes);
        await fs.rename(replacement, f.backend.paths.registryPath);
      }
      return state;
    } });
    assert.equal(await f.inspect(), undefined);
    assert.equal(f.calls.length, 2);
  });

  await test('a registry stat change during reading rejects cleanup and closes its file', async () => {
    let closed = 0;
    const f = await fixture({ wrapHandle: handle => ({
      stat: (...args) => handle.stat(...args),
      async read(...args) {
        const result = await handle.read(...args);
        await fs.appendFile(f.backend.paths.registryPath, ' ');
        return result;
      },
      async close() { closed++; await handle.close(); }
    }) });
    assert.equal(await f.inspect(), undefined);
    assert.equal(closed, 1);
  });

  for (const code of ['EACCES', 'ETIMEDOUT', undefined]) {
    await test(`non-absence socket result ${code ?? 'deadline'} rejects and closes owned socket`, async () => {
      let destroyed = 0;
      const f = await fixture({ netOverride: {
        createConnection() {
          const socket = new EventEmitter();
          socket.destroy = () => { destroyed++; };
          if (code) queueMicrotask(() => socket.emit('error', Object.assign(new Error(code), { code })));
          return socket;
        }
      } });
      assert.equal(await f.inspect(), undefined);
      assert.equal(destroyed, 1);
    });
  }

  await test('systemctl test shim remains a read-only bounded show invocation', async () => {
    const f = await fixture({ env: { DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM: '/controlled-shim',
      DEV_SESSION_CANVAS_TEST_NODE_PATH: '/controlled-node' } });
    assert.equal(await f.inspect(), 'recorded-exit');
    assert.equal(f.calls[0].file, '/controlled-node');
    assert.deepEqual(f.calls[0].args.slice(0, 3), ['/controlled-shim', '--user', 'show']);
  });

  for (const generation of ['agent-provider-lifecycle-v1', 'terminal-stream-v1']) {
    for (const kind of ['agent', 'terminal']) {
      await test(`detached ${generation} ${kind} restored history leaves its registry and sibling unchanged`, async () => {
        const f = await fixture({ detached: true, generation, kind });
        const before = await fs.stat(f.backend.paths.registryPath);
        assert.equal(await f.inspect(), 'detached-recovered-history');
        assert.equal(f.calls.length, 0, 'detached cleanup does not query or start a service');
        assert.equal(f.observation.scans, 2);
        assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
        const after = await fs.stat(f.backend.paths.registryPath);
        assert.equal(after.ino, before.ino);
        assert.equal(after.mtimeMs, before.mtimeMs);
        assert.equal(after.ctimeMs, before.ctimeMs);
      });
    }
  }

  for (const patch of [
    { lastExitMessageDescriptor: undefined }, { lastExitMessageDescriptor: 'recoveredHistoryOnly' },
    { lastExitMessageDescriptor: { id: 'agentSessionEnded' } },
    { lastExitMessageDescriptor: { id: 'recoveredHistoryOnly', params: 'forged' } },
    { lastExitMessageDescriptor: { id: 'recoveredHistoryOnly', params: { count: 1 } } },
    { lastExitMessageDescriptor: undefined, lastExitMessage: 'The session supervisor did not retain the original live runtime.' },
    { live: true }, { lifecycle: 'waiting-input' }, { lifecycle: 'error' }, { kind: 'terminal' },
    { runtimeBackend: 'systemd-user' }, { runtimeGuarantee: 'strong' }, { lastExitSignal: {} }, { lastExitCode: '0' }
  ]) {
    await test(`detached target cannot borrow recovery or exit evidence: ${JSON.stringify(patch)}`, async () => {
      const f = await fixture({ detached: true, patch });
      assert.equal(await f.inspect(), undefined);
      assert.equal(await fs.readFile(f.backend.paths.registryPath, 'utf8'), f.bytes);
    });
  }

  await test('duplicate recovered detached target identities remain unknown', async () => {
    const duplicate = { ...target(), runtimeBackend: 'legacy-detached', lastExitCode: undefined,
      lastExitMessageDescriptor: { id: 'recoveredHistoryOnly' } };
    const f = await fixture({ detached: true, registry: { version: 1, sessions: [duplicate, duplicate] } });
    assert.equal(await f.inspect(), undefined);
  });

  for (const backendKind of ['legacy-detached', 'systemd-user']) {
    await test(`any same-storage ${backendKind} process prevents detached recovered cleanup`, async () => {
      const f = await fixture({ detached: true, processes: backend => ({ 42: {
        argv: ['node', '/old-launcher', '--storage-dir', backend.paths.storageDir, '--runtime-backend', backendKind]
      } }) });
      assert.equal(await f.inspect(), undefined);
      assert.equal(f.observation.scans, 1);
    });
  }

  for (const record of [{ error: 'EACCES' }, { rawCommand: Buffer.alloc(0) },
    { argv: ['node', '--storage-dir', 'relative'] }, { status: 'State:\tS\n' }]) {
    await test('ambiguous detached process evidence does not become recovery permission', async () => {
      const f = await fixture({ detached: true, processes: { 42: record } });
      assert.equal(await f.inspect(), undefined);
    });
  }

  await test('a late original-storage owner rejects detached recovery after registry inspection', async () => {
    const f = await fixture({ detached: true, processes: (backend, scan) => ({ 42: {
      argv: scan === 1 ? ['node', '/unrelated'] : ['node', '/old-supervisor', '--storage-dir', backend.paths.storageDir]
    } }) });
    assert.equal(await f.inspect(), undefined);
    assert.equal(f.observation.scans, 2);
  });

  for (const socketResult of ['connect', 'EACCES', 'timeout']) {
    await test(`detached socket ${socketResult} remains unknown and releases the probe`, async () => {
      const f = await fixture({ detached: true, socketResult });
      assert.equal(await f.inspect(), undefined);
      assert.equal(f.observation.socketCloses, 1);
    });
  }

  await test('detached recovery waits for its socket to close before advancing', async () => {
    let close;
    const gate = new Promise(resolve => { close = resolve; });
    const f = await fixture({ detached: true, socketCloseGate: gate });
    let settled = false;
    const inspecting = f.inspect().then(value => { settled = true; return value; });
    await until(() => f.observation.socketCloses > 0);
    assert.equal(settled, false);
    assert.equal(f.observation.scans, 1);
    close();
    assert.equal(await inspecting, 'detached-recovered-history');
  });

  await test('registry replacement during the second detached process scan rejects cleanup', async () => {
    const f = await fixture({ detached: true, onProcScan: async scan => {
      if (scan !== 2) return;
      const replacement = `${f.backend.paths.registryPath}.replacement`;
      await fs.writeFile(replacement, f.bytes);
      await fs.rename(replacement, f.backend.paths.registryPath);
    } });
    assert.equal(await f.inspect(), undefined);
  });

  await test('detached abort before inspection and during process reads cannot authorize cleanup', async () => {
    const controller = new AbortController();
    const f = await fixture({ detached: true, onProcRead: () => controller.abort() });
    assert.equal(await f.inspect(controller.signal), undefined);
    assert.equal(f.observation.procCloses, 1);
    const reads = f.observation.scans;
    assert.equal(await f.inspect(controller.signal), undefined);
    assert.equal(f.observation.scans, reads);
  });

  await test('detached abort during registry reading closes the owned file and rejects cleanup', async () => {
    const controller = new AbortController();
    let closed = 0;
    const f = await fixture({ detached: true, wrapHandle: handle => ({
      stat: (...args) => handle.stat(...args),
      async read(...args) { const result = await handle.read(...args); controller.abort(); return result; },
      async close() { closed++; await handle.close(); }
    }) });
    assert.equal(await f.inspect(controller.signal), undefined);
    assert.equal(closed, 1);
    assert.equal(f.observation.scans, 1);
  });

  await test('detached abort during a pending socket waits for release and rejects cleanup', async () => {
    const controller = new AbortController();
    const f = await fixture({ detached: true, socketResult: 'timeout' });
    const inspecting = f.inspect(controller.signal);
    await until(() => f.observation.sockets > 0);
    controller.abort();
    assert.equal(await inspecting, undefined);
    assert.equal(f.observation.socketCloses, 1);
  });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`legacy runtime history tests passed (${passed} cases)`);

function target(kind = 'agent') {
  return { sessionId: 'target-session', kind, runtimeBackend: 'systemd-user', live: false,
    lifecycle: kind === 'agent' ? 'stopped' : 'closed', lastExitCode: 0 };
}

async function fixture(options = {}) {
  const dir = await fs.mkdtemp(path.join(root, 'case-'));
  const env = { XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_STATE_HOME: path.join(dir, 'state'), ...options.env };
  const fakeProcess = { platform: 'linux', env, execPath: process.execPath, getuid: () => 1000, pid: 42 };
  const calls = [];
  const observation = { scans: 0, procCloses: 0, sockets: 0, socketCloses: 0 };
  let backend;
  function execFile() { throw new Error('Only the promisified read-only command is allowed.'); }
  execFile[promisify.custom] = async (file, args, execOptions) => {
    assert.equal(args.includes('show'), true);
    assert.equal(args.includes('start') || args.includes('stop') || args.includes('daemon-reload'), false);
    calls.push({ file, args, options: execOptions });
    const properties = { Id: backend.paths.unitName, LoadState: 'loaded', ActiveState: 'inactive', SubState: 'dead',
      MainPID: '0', ControlPID: '0', ControlGroup: '', Job: '', InvocationID: '',
      StateChangeTimestampMonotonic: '100', InactiveEnterTimestampMonotonic: '100', ...options.statePatch };
    let stdout = Object.entries(properties).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`).join('\n');
    if (options.show) stdout = await options.show(stdout, calls.length);
    return { stdout, stderr: '' };
  };
  const processes = () => typeof options.processes === 'function'
    ? options.processes(backend, observation.scans) : options.processes ?? { 42: { argv: ['node', '/unrelated'] } };
  const readonlyFs = { lstat: fs.lstat, realpath: fs.realpath,
    async readlink(file) { assert.equal(file, '/proc/self'); return '42'; },
    async readdir(file) {
      assert.equal(file, '/proc');
      observation.scans++;
      await options.onProcScan?.(observation.scans);
      return Object.keys(processes());
    },
    async open(...args) {
      if (args[0].startsWith('/proc/')) {
        assert.equal(args[1], 'r');
        const match = /^\/proc\/(\d+)\/(status|cmdline)$/.exec(args[0]);
        assert(match);
        const record = processes()[match[1]];
        if (record.error) throw Object.assign(new Error('controlled process read failure'), { code: record.error });
        const bytes = match[2] === 'status' ? Buffer.from(record.status ?? 'State:\tS\nUid:\t1000\t1000\t1000\t1000\n')
          : record.rawCommand ?? Buffer.from(`${(record.argv ?? ['node', '/unrelated']).join('\0')}\0`);
        return {
          async read(buffer, offset, length, position) {
            options.onProcRead?.();
            const count = Math.max(0, Math.min(length, bytes.length - position));
            bytes.copy(buffer, offset, position, position + count);
            return { bytesRead: count };
          },
          async close() { observation.procCloses++; }
        };
      }
      const handle = await fs.open(...args);
      return options.wrapHandle ? options.wrapHandle(handle) : handle;
    }
  };
  const guardedRequire = name => {
    if (name === 'vscode') return { ExtensionMode: { Test: 3 } };
    if (name === 'child_process') return { execFile, spawn() { throw new Error('No process startup is allowed.'); } };
    if (name === 'fs/promises') return readonlyFs;
    if (name === 'net') return options.netOverride ?? {
      createConnection() {
        observation.sockets++;
        const socket = new EventEmitter();
        socket.destroy = () => {
          observation.socketCloses++;
          void (options.socketCloseGate ?? Promise.resolve()).then(() => socket.emit('close'));
        };
        queueMicrotask(() => options.socketResult === 'connect' ? socket.emit('connect')
          : options.socketResult === 'timeout' ? undefined
          : socket.emit('error', Object.assign(new Error('controlled absence'), { code: options.socketResult ?? 'ENOENT' })));
        return socket;
      }
    };
    return require(name);
  };
  function load(code) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'process', code)(guardedRequire, module, module.exports, fakeProcess);
    return module.exports;
  }
  const generationDir = options.malformedShape ? 'unrelated-generations' : 'runtime-supervisor-generations';
  backend = load(backendCode).createRuntimeHostBackend(options.detached ? 'legacy-detached' : 'systemd-user', {
    baseStoragePath: path.join(dir, options.baseStorageRelativePath
      ?? path.join(generationDir, options.generation ?? 'agent-provider-lifecycle-v1')), extensionMode: 3
  });
  fakeProcess.platform = options.platform ?? 'linux';
  backend.kind = options.backendKind ?? (options.detached ? 'legacy-detached' : 'systemd-user');
  backend.startSupervisor = () => { throw new Error('History inspection cannot start a Supervisor.'); };
  await fs.mkdir(backend.paths.storageDir, { recursive: true });
  const kind = options.kind ?? 'agent';
  const registry = Object.hasOwn(options, 'registry') ? options.registry : { version: 1, sessions: [
    { ...target(kind), ...(options.detached ? { runtimeBackend: 'legacy-detached', lastExitCode: undefined,
      lastExitMessageDescriptor: { id: 'recoveredHistoryOnly' } } : {}), ...options.patch },
    { sessionId: 'unrelated-session', kind: 'agent', live: true, lifecycle: 'running', runtimeBackend: 'systemd-user' }
  ] };
  const bytes = JSON.stringify(registry);
  await fs.writeFile(backend.paths.registryPath, bytes);
  const inspectStoppedLegacyRuntimeSession = load(historyCode).inspectStoppedLegacyRuntimeSession;
  return { backend, calls, bytes, observation,
    inspect: signal => inspectStoppedLegacyRuntimeSession(backend, { sessionId: 'target-session', kind }, signal) };
}

async function bundle(relativePath) {
  const result = await esbuild.build({ entryPoints: [path.join(sourceRoot, relativePath)], bundle: true,
    format: 'cjs', platform: 'node', target: 'node18', external: ['vscode'], write: false });
  return result.outputFiles[0].text;
}

async function test(name, run) {
  try { await run(); passed++; }
  catch (error) { throw new Error(name, { cause: error }); }
}

async function until(condition) {
  for (let turn = 0; turn < 200; turn++) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert(condition(), 'controlled observation did not reach its expected boundary');
}
