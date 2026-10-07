import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parseRemoteSelection, remoteInstallCommand } from '../smoke/run-vscode-remote-execution-candidate.mjs';
import { belongsToFixtureServer } from '../smoke/vscode-remote-ssh-fixture.mjs';
import remote from '../../tests/vscode-smoke/remote-execution-candidate.cjs';

assert.equal(parseRemoteSelection(['--probe', '--output', '/new']).probe, true);
assert.equal(parseRemoteSelection(['--installed-vsix', '/fixed.vsix', '--output', '/new'])['installed-vsix'], '/fixed.vsix');
for (const args of [[], ['--output', '/new'], ['--probe', '--installed-vsix', '/fixed.vsix', '--output', '/new'],
  ['--probe', '--output', ' '], ['--installed-vsix', ' ', '--output', '/new'], ['--probe', '--output', '/new', '--retry']]) {
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

const wrapperSource = await fs.readFile('tests/vscode-smoke/remote-execution-candidate-tests.cjs', 'utf8');
for (const phase of ['probe', 'complete', 'reopen']) {
  let productCalls = 0, checkedRuntime = 0;
  const writes = new Map();
  const fixtureControl = { ...control, phase, mode: phase === 'probe' ? undefined : 'live-runtime',
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
    './remote-execution-candidate.cjs': remote,
    './installed-execution-candidate.cjs': { assertInstalledCandidateRuntime(actual, manifest, name) {
      assert.equal(actual, runtime); assert.equal(name, 'node'); checkedRuntime++;
    } },
    './execution-candidate-tests.cjs': { async run() {
      productCalls++; assert.equal(runtime.env.DEV_SESSION_CANVAS_CANDIDATE_PHASE, phase);
      assert.equal(runtime.env.DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE, host.executable);
      assert.equal(runtime.env.DEV_SESSION_CANVAS_SMOKE_TEST_MODE, '1');
      assert.equal(runtime.env.DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION, fixtureControl.expectationPath);
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
  runtime.env.DEV_SESSION_CANVAS_REMOTE_CANDIDATE_CONTROL_FILE = '/another/control.json';
  await assert.rejects(context.module.exports.run(), /bindings must agree/);
}
console.log('Remote candidate selection, actual-host identity, Node install, original wrapper, EOF/applied and cleanup scope checks passed (no native execution).');
