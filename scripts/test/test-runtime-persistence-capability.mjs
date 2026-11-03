import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimePersistenceCapability.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(require, loaded, loaded.exports);
const { inspectRuntimePersistenceCapability: inspect, verifyRuntimePersistenceUnit: verify,
  runtimeLingerCommand, sameRuntimePersistenceTarget, shouldDeferRuntimePersistenceEnable } = loaded.exports;
const target = { uid: 1001, user: 'user;not-a-command', host: 'server', environmentKey: 'a'.repeat(64) };
const manager = '/user.slice/user-1001.slice/user@1001.service';
const unitName = 'dsc-example.service';
const controlGroup = `${manager}/app.slice/${unitName}`;
let passed = 0;

function fixture(changes = {}) {
  const calls = [];
  const dependencies = {
    platform: changes.platform ?? 'linux',
    async identify() {
      if (changes.identityError) throw new Error('identity');
      return { ...target, ...changes.target };
    },
    async run(file, args) {
      calls.push({ file, args });
      assert(!args.some(value => /^(?:enable-linger|disable-linger|start|stop|restart)$/.test(value)));
      if (changes.error) throw changes.error;
      if (file === '/usr/bin/loginctl') return changes.loginOutput ?? Object.entries({
        UID: '1001', Linger: 'yes', Service: 'user@1001.service', ...changes.user
      }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
      if (!args.includes('--user')) return Object.entries({
        Id: 'user@1001.service', ActiveState: 'active', MainPID: '200', ControlGroup: manager,
        ...changes.manager
      }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
      return Object.entries({
        Id: unitName, ActiveState: 'active', MainPID: '300', ControlGroup: controlGroup,
        InvocationID: 'b'.repeat(32), PartOf: '', BindsTo: '', RuntimeMaxUSec: 'infinity', KillMode: 'control-group',
        ...changes.unit
      }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
    },
    async readFile(filename) {
      if (changes.procError) throw new Error('proc unavailable');
      if (filename.endsWith('/status')) return `Uid:\t${changes.processUid ?? 1001}\t1001\t1001\t1001\n`;
      if (filename.endsWith('/cgroup')) return changes.cgroup ?? `0::${controlGroup}\n`;
      if (filename.endsWith('/stat')) {
        const fields = Array.from({ length: 20 }, () => '0');
        fields[19] = String(changes.startTime ? changes.startTime() : 900);
        return `300 (runtime supervisor) ${fields.join(' ')}`;
      }
      throw new Error(`Unexpected read: ${filename}`);
    },
    async readlink(filename) {
      const name = filename.split('/').at(-1);
      return `${name}:[${changes.namespaceMismatch && filename.includes('/200/') ? 2 : 1}]`;
    }
  };
  return { dependencies, calls };
}

async function check(changes, status, reason) {
  const harness = fixture(changes);
  const result = await inspect(harness.dependencies);
  assert.equal(result.status, status);
  assert.equal(result.reason, reason);
  passed += 1;
  return { ...harness, result };
}

const valid = await check({}, 'eligible');
assert.equal(valid.result.target.uid, 1001);
assert.deepEqual(valid.calls[0], { file: '/usr/bin/loginctl', args: [
  '--no-ask-password', 'show-user', '1001', '--property=UID', '--property=Linger', '--property=Service'
] });
await check({ user: { Linger: 'no' } }, 'blocked', 'linger-disabled');
for (const platform of ['darwin', 'win32']) {
  const result = await check({ platform }, 'unsupported', 'unsupported-platform');
  assert.equal(result.calls.length, 0);
}
for (const changes of [{ identityError: true }, { target: { uid: -1 } }, { target: { uid: 1.5 } },
  { target: { environmentKey: 'invalid' } }]) await check(changes, 'unknown', 'identity-unavailable');
for (const user of [{ UID: '1002' }, { UID: '01001' }, { Linger: 'maybe' }]) {
  await check({ user }, 'unknown', 'observation-failed');
}
for (const loginOutput of ['', 'UID=1001\nLinger=yes', 'UID=1001\nUID=1001\nLinger=yes\nService=user@1001.service',
  'UID=1001\nLinger=yes\nService=user@1001.service\nUnexpected=value']) {
  await check({ loginOutput }, 'unknown', 'observation-failed');
}
for (const code of ['ENOENT', 'EACCES', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']) {
  await check({ error: Object.assign(new Error('private data'), { code }) }, 'unknown', 'observation-failed');
}
for (const managerChange of [{ ActiveState: 'inactive' }, { Id: 'user@2.service' }, { ControlGroup: '/other' }]) {
  await check({ manager: managerChange }, 'blocked', 'manager-unavailable');
}
await check({ user: { Service: '' } }, 'blocked', 'manager-unavailable');
await check({ namespaceMismatch: true }, 'blocked', 'environment-mismatch');
await check({ processUid: 2 }, 'blocked', 'environment-mismatch');
await check({ procError: true }, 'unknown', 'observation-failed');

assert(await verify(valid.result, unitName, 300, valid.dependencies)); passed += 1;
for (const unit of [{ MainPID: '301' }, { Id: 'other.service' }, { ActiveState: 'inactive' },
  { ControlGroup: '/session.scope' }, { InvocationID: '' }, { PartOf: 'graphical-session.target' },
  { BindsTo: 'session.scope' }, { RuntimeMaxUSec: '5min' }, { KillMode: 'process' }]) {
  assert.equal(await verify(valid.result, unitName, 300, fixture({ unit }).dependencies), false); passed += 1;
}
assert.equal(await verify(valid.result, unitName, 300, fixture({ cgroup: '0::/session.scope' }).dependencies), false);
let startTime = 900;
assert.equal(await verify(valid.result, unitName, 300, fixture({ startTime: () => startTime++ }).dependencies), false);
assert.equal(await verify({ ...valid.result, status: 'blocked' }, unitName, 300, valid.dependencies), false);
assert.equal(await verify(valid.result, 'bad;command.service', 300, valid.dependencies), false);
assert.equal(runtimeLingerCommand(target), '/usr/bin/loginctl --no-ask-password enable-linger 1001');
assert.equal(runtimeLingerCommand(target, true), '/usr/bin/sudo /usr/bin/loginctl enable-linger 1001');
assert.equal(runtimeLingerCommand(target, false, 'disable'), '/usr/bin/loginctl --no-ask-password disable-linger 1001');
assert.equal(runtimeLingerCommand(target, true, 'disable'), '/usr/bin/sudo /usr/bin/loginctl disable-linger 1001');
assert.throws(() => runtimeLingerCommand({ ...target, uid: '1001;whoami' }, false, 'disable'));
assert.throws(() => runtimeLingerCommand({ ...target, uid: '1001;whoami' }));
assert(sameRuntimePersistenceTarget(target, { ...target }));
assert(!sameRuntimePersistenceTarget(target, { ...target, environmentKey: 'b'.repeat(64) }));
assert(shouldDeferRuntimePersistenceEnable(true, false, { status: 'blocked' }));
assert(shouldDeferRuntimePersistenceEnable(true, false, { status: 'unknown' }));
assert(!shouldDeferRuntimePersistenceEnable(true, true, { status: 'blocked' }));
assert(!shouldDeferRuntimePersistenceEnable(true, undefined, { status: 'blocked' }));
assert(!shouldDeferRuntimePersistenceEnable(false, true, { status: 'blocked' }));
assert(!shouldDeferRuntimePersistenceEnable(true, false, { status: 'eligible' }));
console.log(`Runtime persistence capability: ${passed + 15} checks passed; no real system commands executed.`);
