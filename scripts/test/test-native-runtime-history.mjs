import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const result = await esbuild.build({ stdin: { contents: `
  export { inspectRetiredNativeRuntimeNamespace } from './extensions/vscode/dev-session-canvas/src/panel/nativeRuntimeHistory';
  export { acquireRuntimeSupervisorNamespace } from './extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace';
  export { resolveLegacyRuntimeSupervisorPathsFromStorageDir } from './extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths';
`, resolveDir: process.cwd(), sourcefile: 'native-history-test.ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
const code = result.outputFiles[0].text;
const storageDir = '/history/runtime-supervisor-generations/terminal-exit-v1/runtime-supervisor';
const ordinary = { status: 'State:\tS (sleeping)\nUid:\t1000\t1000\t1000\t1000\n',
  argv: ['node', '/any/path/supervisor.js'] };
let passed = 0;
const turns = async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function load(boundaries, processObject) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', code)(name => boundaries[name] ?? require(name),
    module, module.exports, processObject);
  return module.exports;
}
function fixture(options = {}) {
  const effects = { claims: 0, closes: 0, sockets: 0, socketCloses: 0, fileCloses: 0, scans: 0 };
  const fakeProcess = { platform: options.platform ?? 'linux', versions: { node: options.node ?? '24.18.1' },
    pid: 42, getuid: () => 1000, env: {} };
  let closeClaim;
  const api = load({
    'fs/promises': {
      async realpath(value) {
        if (options.realpathError?.[value]) throw Object.assign(new Error('controlled path failure'), { code: options.realpathError[value] });
        return options.aliases?.[value] ?? value;
      },
      async readlink(file) { assert.equal(file, '/proc/self'); return options.selfPid ?? '42'; },
      async readdir(file) { assert.equal(file, '/proc'); effects.scans++; return options.entries ?? Object.keys(options.processes ?? { 42: ordinary }); },
      async open(file, mode) {
        assert.equal(mode, 'r');
        const match = /^\/proc\/(\d+)\/(status|cmdline)$/.exec(file);
        assert(match, `Only process evidence may be read: ${file}`);
        const record = (options.processes ?? { 42: ordinary })[match[1]] ?? ordinary;
        if (record.error) throw Object.assign(new Error('controlled process read failure'), { code: record.error });
        const bytes = match[2] === 'status' ? Buffer.from(record.status ?? ordinary.status)
          : record.rawCommand ?? Buffer.from(`${(record.argv ?? ordinary.argv).join('\0')}\0`);
        return {
          async read(buffer, offset, length, position) {
            options.onRead?.(file);
            const count = Math.max(0, Math.min(length, bytes.length - position));
            bytes.copy(buffer, offset, position, position + count);
            return { bytesRead: count };
          },
          async close() { effects.fileCloses++; }
        };
      }
    },
    net: {
      createServer() {
        const server = new EventEmitter();
        server.listen = (address, callback) => {
          assert.match(address, /^\0dsc-runtime-owner-[a-f0-9]{64}$/);
          effects.claims++;
          void (options.claimGate?.promise ?? Promise.resolve()).then(() => options.claimError
            ? server.emit('error', Object.assign(new Error('controlled claim failure'), { code: options.claimError })) : callback());
        };
        server.unref = () => {};
        server.close = callback => {
          effects.closes++;
          closeClaim = () => callback(options.closeError ? new Error('controlled claim close failure') : undefined);
          if (!options.delayClaimClose) queueMicrotask(closeClaim);
        };
        return server;
      },
      createConnection(socketPath) {
        assert.equal(socketPath, backend.paths.socketPath);
        effects.sockets++;
        const socket = new EventEmitter();
        socket.destroy = () => {
          effects.socketCloses++;
          void (options.socketCloseGate?.promise ?? Promise.resolve()).then(() => socket.emit('close'));
        };
        queueMicrotask(() => options.socketResult === 'connect' ? socket.emit('connect')
          : options.socketResult === 'timeout' ? undefined
          : socket.emit('error', Object.assign(new Error('controlled socket result'), { code: options.socketResult ?? 'ENOENT' })));
        return socket;
      }
    }
  }, fakeProcess);
  const backend = { kind: options.backendKind ?? 'legacy-detached', paths: api.resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir),
    startSupervisor() { assert.fail('Inspection must never start a Supervisor.'); } };
  if (options.pathPatch) Object.assign(backend.paths, options.pathPatch);
  return { effects, inspect: signal => api.inspectRetiredNativeRuntimeNamespace(backend, signal), closeClaim: () => closeClaim() };
}
async function test(name, run) {
  try { await run(); passed++; }
  catch (error) { throw new Error(name, { cause: error }); }
}

for (const socketResult of ['ENOENT', 'ECONNREFUSED']) await test(`${socketResult} with an unoccupied namespace releases its observation`, async () => {
  const f = fixture({ socketResult });
  assert.equal(await f.inspect(), 'native-owner-absent');
  assert.equal(f.effects.closes, 1);
  assert.equal(f.effects.sockets, 2);
  assert.equal(f.effects.socketCloses, 2);
});
for (const claimError of ['EADDRINUSE', 'EPERM']) await test(`claim ${claimError} never proves absence`, async () => {
  const f = fixture({ claimError });
  assert.equal(await f.inspect(), undefined);
  assert.equal(f.effects.closes, 0);
  assert.equal(f.effects.scans, 0);
});
for (const socketResult of ['connect', 'EACCES', 'timeout']) await test(`socket ${socketResult} remains unknown and releases the claim`, async () => {
  const f = fixture({ socketResult });
  assert.equal(await f.inspect(), undefined);
  assert.equal(f.effects.closes, 1);
});
for (const argv of [
  ['node', '/old/launcher.js', '--storage-dir', storageDir],
  ['node', '/old/supervisor.js', '--storage-dir', '/storage-alias'],
  ['anything', '--storage-dir', 'relative'], ['anything', '--storage-dir'],
  ['anything', '--storage-dir', '/missing'], ['anything', `--storage-dir=${storageDir}`],
  ['anything', '--storage-dir', '/sibling', '--storage-dir', '/sibling']
]) await test(`pre-claim owner or ambiguous storage argv rejects: ${argv[1]}`, async () => {
  const f = fixture({ processes: { 42: { ...ordinary, argv } }, aliases: { '/storage-alias': storageDir },
    realpathError: { '/missing': 'ENOENT' } });
  assert.equal(await f.inspect(), undefined);
  assert.equal(f.effects.closes, 1);
});
await test('a canonical sibling storage and an unrelated user do not block the original namespace', async () => {
  const f = fixture({ processes: {
    42: { ...ordinary, argv: ['anything', '--storage-dir', '/sibling'] },
    43: { status: 'State:\tS\nUid:\t2000\t2000\t2000\t2000\n', argv: ['anything', '--storage-dir', storageDir] }
  } });
  assert.equal(await f.inspect(), 'native-owner-absent');
});
for (const record of [
  { error: 'EACCES' }, { status: 'State:\tS\n' }, { rawCommand: Buffer.alloc(0) },
  { status: 'State:\tS\nUid:\t999999999999999999999\t2000\t2000\t2000\n' },
  { rawCommand: Buffer.from('unterminated') }, { rawCommand: Buffer.from([0]) },
  { rawCommand: Buffer.alloc(65537, 1) },
  { status: 'State:\tS\nUid:\t2000\t1000\t2000\t2000\n', argv: ['anything', '--storage-dir', storageDir] }
]) await test('unreadable malformed empty or oversized same-user evidence remains unknown', async () => {
  const f = fixture({ processes: { 42: { ...ordinary, ...record } } });
  assert.equal(await f.inspect(), undefined);
  assert.equal(f.effects.closes, 1);
});
await test('a raced exited PID and confirmed empty zombie do not imply a remaining Supervisor', async () => {
  const f = fixture({ processes: { 42: { error: 'ENOENT' },
    43: { status: 'State:\tZ (zombie)\nUid:\t1000\t1000\t1000\t1000\n', rawCommand: Buffer.alloc(0) } } });
  assert.equal(await f.inspect(), 'native-owner-absent');
});
for (const options of [
  { node: '20.7.0' }, { node: 'invalid' }, { platform: 'darwin' }, { backendKind: 'systemd-user' },
  { pathPatch: { storageDir: '/other-generation/runtime-supervisor' } }, { pathPatch: { socketPath: '/foreign' } }
]) await test('unsupported environment or binding cannot acquire an observation', async () => {
  const f = fixture(options);
  assert.equal(await f.inspect(), undefined);
  assert.equal(f.effects.claims, 0);
});
for (const options of [{ selfPid: 'different' }, { entries: Array.from({ length: 8193 }, (_, i) => String(i + 1)) }]) {
  await test('ambiguous proc visibility or entry limit remains unknown', async () => {
    const f = fixture(options);
    assert.equal(await f.inspect(), undefined);
    assert.equal(f.effects.closes, 1);
  });
}
await test('a total process byte budget is enforced without ignoring the remaining entries', async () => {
  const status = 'State:\tS\nUid:\t2000\t2000\t2000\t2000\n' + 'x'.repeat(65400);
  const f = fixture({ processes: Object.fromEntries(Array.from({ length: 130 }, (_, i) => [String(i + 1), { status }])) });
  assert.equal(await f.inspect(), undefined);
  assert.equal(f.effects.closes, 1);
});
await test('claim close completion is required before reporting positive evidence', async () => {
  const f = fixture({ delayClaimClose: true });
  let settled = false;
  const operation = f.inspect().then(value => { settled = true; return value; });
  for (let turn = 0; turn < 20 && !f.effects.closes; turn++) await turns();
  assert.equal(f.effects.closes, 1);
  assert.equal(settled, false);
  f.closeClaim();
  assert.equal(await operation, 'native-owner-absent');
});
await test('failed claim close cannot be reported as successful cleanup', async () => {
  const f = fixture({ closeError: true });
  assert.equal(await f.inspect(), undefined);
});
await test('socket close completes before process inspection or claim release', async () => {
  const socketCloseGate = deferred();
  const f = fixture({ socketCloseGate });
  const operation = f.inspect();
  for (let turn = 0; turn < 20 && !f.effects.socketCloses; turn++) await turns();
  assert.equal(f.effects.socketCloses, 1);
  assert.equal(f.effects.scans, 0);
  assert.equal(f.effects.closes, 0);
  socketCloseGate.resolve();
  assert.equal(await operation, 'native-owner-absent');
});
await test('an aborted late claim acquisition is still released without inspecting a new owner', async () => {
  const claimGate = deferred();
  const controller = new AbortController();
  const f = fixture({ claimGate });
  const operation = f.inspect(controller.signal);
  await turns();
  assert.equal(f.effects.claims, 1);
  controller.abort();
  claimGate.resolve();
  assert.equal(await operation, undefined);
  assert.equal(f.effects.closes, 1);
  assert.equal(f.effects.sockets, 0);
});
await test('abort during proc reading closes the original file and claim', async () => {
  const controller = new AbortController();
  const f = fixture({ onRead: () => controller.abort() });
  assert.equal(await f.inspect(controller.signal), undefined);
  assert.equal(f.effects.fileCloses, 1);
  assert.equal(f.effects.closes, 1);
});
await test('a changed canonical storage path cannot authorize the original binding', async () => {
  const aliases = {};
  const f = fixture({ aliases, onRead: () => { aliases[storageDir] = '/replacement-storage'; } });
  assert.equal(await f.inspect(), undefined);
  assert.equal(f.effects.closes, 1);
});

const probe = net.createServer();
const nativeAvailable = await new Promise(resolve => {
  probe.once('error', () => resolve(false));
  probe.listen(`\0dsc-native-history-probe-${process.pid}`, () => probe.close(() => resolve(true)));
});
if (nativeAvailable && process.platform === 'linux') {
  await test('actual namespace claims exclude a competitor and explicit close permits reacquisition', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-native-history-'));
    const api = load({}, process);
    let first;
    let second;
    try {
      first = await api.acquireRuntimeSupervisorNamespace(directory);
      await assert.rejects(api.acquireRuntimeSupervisorNamespace(directory), { code: 'EADDRINUSE' });
      await new Promise((resolve, reject) => first.close(error => error ? reject(error) : resolve()));
      first = undefined;
      second = await api.acquireRuntimeSupervisorNamespace(directory);
    } finally {
      for (const owner of [first, second]) if (owner) await new Promise(resolve => owner.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
} else console.log('SKIP: native abstract-socket claim cycle is unavailable in this environment.');

console.log(`native runtime history tests passed (${passed} cases)`);
