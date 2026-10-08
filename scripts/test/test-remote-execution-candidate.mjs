import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { parseRemoteSelection, remoteInstallCommand, remoteCandidateModes,
  prepareRemoteRootOwnerHelper } from '../smoke/run-vscode-remote-execution-candidate.mjs';
import { belongsToFixtureServer } from '../smoke/vscode-remote-ssh-fixture.mjs';
import remote from '../../tests/vscode-smoke/remote-execution-candidate.cjs';

assert.equal(parseRemoteSelection(['--probe', '--output', '/new']).probe, true);
assert.equal(parseRemoteSelection(['--installed-vsix', '/fixed.vsix', '--output', '/new'])['installed-vsix'], '/fixed.vsix');
assert.equal(parseRemoteSelection(['--root-owner', '--installed-vsix', '/fixed.vsix', '--output', '/new'])['root-owner'], true);
assert.deepEqual(remoteCandidateModes({ 'root-owner': true }), ['live-runtime']);
assert.deepEqual(remoteCandidateModes({}), ['live-runtime', 'snapshot-only']);
for (const args of [[], ['--output', '/new'], ['--probe', '--installed-vsix', '/fixed.vsix', '--output', '/new'],
  ['--probe', '--output', ' '], ['--installed-vsix', ' ', '--output', '/new'], ['--probe', '--output', '/new', '--retry'],
  ['--probe', '--root-owner', '--output', '/new']]) {
  assert.throws(() => parseRemoteSelection(args));
}

const control = { schemaVersion: 1, phase: 'probe', serverRoot: '/private/server',
  workspacePath: '/private/workspace', artifactsDir: '/private/artifacts', remoteAuthority: 'ssh-remote+dsc-test',
  vscodeVersion: '1.117.0', vscodeCommit: 'a'.repeat(40) };
const nodeBytes = Buffer.from('controlled server node');
const host = { remoteName: 'ssh-remote', platform: 'linux', arch: 'x64',
  versions: { node: '22.22.1', modules: '127', napi: '10' }, glibc: '2.35',
  vscodeVersion: control.vscodeVersion, serverCommit: control.vscodeCommit,
  executable: '/private/server/bin/server/node', executableSha256: createHash('sha256').update(nodeBytes).digest('hex'),
  workspacePath: control.workspacePath, workspaces: [{ scheme: 'file', authority: '', path: control.workspacePath }] };
remote.assertRemoteHost(host, control);
remote.assertRemoteHost({ ...host, workspaces: [{ ...host.workspaces[0], scheme: 'vscode-remote', authority: control.remoteAuthority }] }, control);
const rootHost = { ...host, environmentKey: 'a'.repeat(64), environmentSample: 'before-product-test' };
remote.assertRemoteHost(rootHost, { ...control, rootOwner: true });
for (const change of [{ environmentKey: undefined }, { environmentKey: 'unknown' }, { environmentSample: 'after-webview' }]) {
  assert.throws(() => remote.assertRemoteHost({ ...rootHost, ...change }, { ...control, rootOwner: true }));
}
const rootProbe = { ...rootHost, pid: 41, productPresent: false, productActive: false };
remote.assertRemoteEnvironmentStable(rootProbe, { ...rootHost, pid: 42 });
for (const change of [{ pid: 41 }, { environmentKey: 'b'.repeat(64) }, { environmentKey: undefined },
  { environmentSample: 'after-webview' }]) {
  assert.throws(() => remote.assertRemoteEnvironmentStable(rootProbe, { ...rootHost, pid: 42, ...change }));
}
assert.throws(() => remote.assertRemoteEnvironmentStable({ ...rootProbe, productActive: true }, { ...rootHost, pid: 42 }));
for (const change of [{ remoteName: undefined }, { platform: 'darwin' }, { arch: 'arm64' },
  { versions: { ...host.versions, electron: '39.8.7' } }, { serverCommit: 'b'.repeat(40) },
  { executable: '/private/server-other/node' }, { workspacePath: '/wrong' }, { glibc: undefined },
  { workspaces: [{ scheme: 'vscode-remote', authority: 'ssh-remote+another' }] },
  { workspaces: [{ scheme: 'file', authority: 'another' }] }, { workspaces: [] }]) {
  assert.throws(() => remote.assertRemoteHost({ ...host, ...change }, control));
}

const fixture = { remoteAgentDir: control.serverRoot, sshPath: '/usr/bin/ssh',
  sshConfigPath: '/private/ssh/config', hostAlias: 'dsc-test' };
const install = remoteInstallCommand(fixture, host.executable, { vsixPath: "/fixed/a'b.vsix" }, '/private/server/extensions');
assert.equal(install.file, '/usr/bin/ssh');
assert.deepEqual(install.args.slice(0, 3), ['-F', fixture.sshConfigPath, fixture.hostAlias]);
assert(install.args[3].includes("'/fixed/a'\\''b.vsix'"));
assert(install.args[3].includes("'--do-not-include-pack-dependencies'"));
assert.throws(() => remoteInstallCommand(fixture, '/user/server/node', { vsixPath: '/fixed.vsix' }, '/private/extensions'));
assert(belongsToFixtureServer(['/private/server/bin/node'], '/private/server'));
assert(belongsToFixtureServer(['--user-data-dir=/private/client'], '/private/client'));
assert(!belongsToFixtureServer(['/private/server-other/node'], '/private/server'));
assert(!belongsToFixtureServer(['echo /private/server/bin/node'], '/private/server'));
assert(!belongsToFixtureServer(['--user-data-dir=/private/client-other'], '/private/client'));

for (const mode of ['live-runtime', 'snapshot-only']) {
  const detail = { nodeId: 'node-a', ...(mode === 'live-runtime' ? { sessionId: 'execution-a' } : { executionSessionId: 'execution-a' }) };
  const completed = { pass: true, mode, id: 'node-a', executionId: 'execution-a', events: [
    { kind: 'runtime/terminalSourceDisposition', detail: { ...detail, sourceDisposition: { kind: 'eof' }, finalRevision: 12 } },
    { kind: mode === 'live-runtime' ? 'runtime/terminalReadSettled' : 'execution/localTerminalReaderSettled',
      detail: { ...detail, outcome: { kind: 'applied', [mode === 'live-runtime' ? 'finalRevision' : 'finalOutputSequence']: 12 } } }
  ] };
  assert.deepEqual(remote.assertRemoteCompletion(completed, mode), { sourceDisposition: 'eof', finalRevision: 12, applied: true });
  for (const change of [copy => { copy.events[0].detail.sourceDisposition = { kind: 'interrupted' }; },
    copy => { copy.events[0].detail.sourceDisposition = 'eof'; },
    copy => { copy.events[0].detail.finalRevision = 13; }, copy => { copy.events[1].detail.outcome.kind = 'cancelled'; },
    copy => { copy.executionId = 'other'; }, copy => { copy.events.length = 0; }]) {
    const copy = structuredClone(completed); change(copy);
    assert.throws(() => remote.assertRemoteCompletion(copy, mode));
  }
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-remote-controlled-'));
try {
  const runtime = { platform: 'linux', arch: 'x64', versions: { node: '22.22.1', modules: '127', napi: '10' },
    report: { getReport: () => ({ header: { glibcVersionRuntime: '2.35' } }) }, checks: [] };
  const validator = path.join(temporary, 'frozen-validator.cjs');
  const validatorBytes = Buffer.from(`module.exports = runtime => ({
    assertExecutionAssetRuntime(build, napi) { runtime.checks.push(['runtime', build.name, napi, runtime.versions.node]); },
    assertMinimumExecutionLibraryVersion(actual, minimum) { runtime.checks.push(['glibc', actual, minimum]); }
  });\n`);
  await fs.writeFile(validator, validatorBytes, { flag: 'wx' });
  const expected = { runtimeName: 'node', manifest: { schemaVersion: 2, platform: 'linux', arch: 'x64',
    profile: 'linux-owner-v1-candidate', runtime: { name: 'node' },
    requirements: { napi: 10, linux: { libc: 'glibc', glibcMinimum: '2.28' } } },
    runtimeValidation: { file: validator, sha256: createHash('sha256').update(validatorBytes).digest('hex') } };
  await remote.assertRemoteInstalledRuntime(runtime, expected);
  assert.deepEqual(runtime.checks, [['runtime', 'node', 10, '22.22.1'], ['glibc', '2.35', '2.28']]);
  for (const runtimeValidation of [undefined, { ...expected.runtimeValidation, file: 'relative.cjs' },
    { ...expected.runtimeValidation, sha256: '0'.repeat(64) }]) {
    await assert.rejects(remote.assertRemoteInstalledRuntime(runtime, { ...expected, runtimeValidation }), /validator/i);
  }
  await assert.rejects(remote.assertRemoteInstalledRuntime({ ...runtime, versions: { ...runtime.versions, electron: '39.8.7' } }, expected),
    /non-Electron/);
  await remote.assertRemoteInstalledRuntime(runtime, { runtimeName: 'node', manifest: { schemaVersion: 1,
    platform: 'linux', arch: 'x64', runtime: { name: 'node', version: '22.22.1', ...runtime.versions },
    libc: { name: 'glibc', version: '2.35' } } });
  await fs.mkdir(path.join(temporary, 'tests/vscode-smoke'), { recursive: true });
  const helper = await prepareRemoteRootOwnerHelper(process.cwd(), temporary);
  assert.match(helper.sha256, /^[a-f0-9]{64}$/);
  assert.match(helper.sourceHashes['extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment.ts'], /^[a-f0-9]{64}$/);
  const api = createRequire(import.meta.url)(path.join(temporary, 'tests/vscode-smoke/candidate-root-ownership.cjs'));
  for (const name of ['readRuntimeExecutionEnvironment', 'parseRuntimeOwnerDescriptor', 'resolveRuntimeRootOwnerGlobalStoragePath']) {
    assert.equal(typeof api[name], 'function');
  }
} finally { await fs.rm(temporary, { recursive: true, force: true }); }

const wrapperSource = await fs.readFile('tests/vscode-smoke/remote-execution-candidate-tests.cjs', 'utf8');
for (const { phase, rootOwner } of [false, true].flatMap(rootOwner =>
  ['probe', 'complete', 'reopen'].map(phase => ({ phase, rootOwner })))) {
  let productCalls = 0, checkedRuntime = 0, sampledEnvironment = 0;
  const writes = new Map();
  const fixtureControl = { ...control, phase, rootOwner, mode: phase === 'probe' ? undefined : 'live-runtime',
    expectationPath: '/private/expected.json' };
  const runtime = { env: phase === 'probe' ? {} : { DEV_SESSION_CANVAS_REMOTE_CANDIDATE_CONTROL_FILE: '/private/control.json' },
    platform: host.platform, arch: host.arch, versions: host.versions, execPath: host.executable, pid: 42,
    report: { getReport: () => ({ header: { glibcVersionRuntime: host.glibc } }) } };
  const mocks = {
    'node:assert/strict': assert, 'node:path': path, 'node:crypto': { createHash },
    'node:fs': { createReadStream: async function* () { yield nodeBytes; } },
    'node:fs/promises': { async realpath(file) { return file; },
      async readFile(file) {
        if (file === '/private/driver/remote-control.json') return JSON.stringify({ schemaVersion: 1, controlFile: '/private/control.json' });
        if (file === '/private/control.json') return JSON.stringify(fixtureControl);
        if (file.endsWith('/product.json')) return JSON.stringify({ commit: host.serverCommit, serverDataFolderName: 'bin' });
        if (file === fixtureControl.expectationPath) return JSON.stringify({ runtimeName: 'node', manifest: { runtime: host.versions } });
        assert.fail(`Unexpected read ${file}`);
      },
      async writeFile(file, bytes) { assert(!writes.has(file)); writes.set(file, JSON.parse(bytes)); } },
    vscode: { version: host.vscodeVersion, env: { remoteName: host.remoteName },
      workspace: { workspaceFolders: [{ uri: { ...host.workspaces[0], fsPath: host.workspacePath } }] },
      extensions: { getExtension: () => phase === 'probe' ? undefined : { isActive: false } } },
    './remote-execution-candidate.cjs': { ...remote, async assertRemoteInstalledRuntime(actual, expected) {
      assert.equal(actual, runtime); assert.equal(expected.runtimeName, 'node'); checkedRuntime++;
    } },
    './candidate-root-ownership.cjs': { async readRuntimeExecutionEnvironment() {
      assert.equal(productCalls, 0); sampledEnvironment++;
      return { environmentKey: rootHost.environmentKey, userIdentity: 'controlled-user' };
    } },
    './execution-candidate-tests.cjs': { async run() {
      productCalls++; assert.equal(runtime.env.DEV_SESSION_CANVAS_CANDIDATE_PHASE, phase);
      assert.equal(runtime.env.DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE, host.executable);
      assert.equal(runtime.env.DEV_SESSION_CANVAS_SMOKE_TEST_MODE, '1');
      assert.equal(runtime.env.DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION, fixtureControl.expectationPath);
      assert.equal(runtime.env.DEV_SESSION_CANVAS_ROOT_OWNER_ACCEPTANCE, rootOwner ? '1' : '');
    } }
  };
  const context = { module: { exports: {} }, __dirname: '/private/driver/tests/vscode-smoke', process: runtime, require: name => {
    assert(Object.hasOwn(mocks, name), `Unexpected require ${name}`); return mocks[name];
  } };
  vm.runInNewContext(wrapperSource, context);
  await context.module.exports.run();
  assert(writes.has(`/private/artifacts/${phase}-remote-host.json`));
  assert.equal(productCalls, phase === 'probe' ? 0 : 1);
  assert.equal(checkedRuntime, productCalls);
  assert.equal(sampledEnvironment, rootOwner ? 1 : 0);
  const actualHost = writes.get(`/private/artifacts/${phase}-remote-host.json`);
  assert.equal(actualHost.environmentKey, rootOwner ? rootHost.environmentKey : undefined);
  runtime.env.DEV_SESSION_CANVAS_REMOTE_CANDIDATE_CONTROL_FILE = '/another/control.json';
  await assert.rejects(context.module.exports.run(), /bindings must agree/);
}
console.log('Remote selection, root-only modes, actual-host environment, frozen schema2 validator, helper staging, wrapper, EOF/applied and cleanup checks passed (controlled; no native execution).');
