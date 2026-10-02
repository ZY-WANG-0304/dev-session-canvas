import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const [binaryArgument, legacyNodeArgument] = process.argv.slice(2);
assert(binaryArgument && legacyNodeArgument,
  'Specify the newly built addon and an explicit Node 16.17.1 executable.');
assert.equal(process.platform, 'linux');
assert(Number(process.versions.node.split('.')[0]) >= 22, 'The controller must support real Node abstract sockets.');
const binary = await realpath(binaryArgument);
const legacyNode = await realpath(legacyNodeArgument);
const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-native-namespace-'));
const bundle = path.join(directory, 'namespace.cjs');
const workers = [];
await esbuild.build({
  entryPoints: ['extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorNamespace.ts'],
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle, target: 'node16'
});

async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000);
  })]); } finally { clearTimeout(timer); }
}

async function worker(storage, mode, executable = process.execPath) {
  const child = fork(path.resolve('scripts/test/fixtures/linux-execution-namespace.cjs'),
    [bundle, binary, storage, mode], { execPath: executable, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const pending = new Map();
  let nextId = 0;
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message.ready) resolve(message);
      else pending.get(message.id)?.(message);
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Namespace worker exited before ready: ${stderr}`)));
  });
  const subject = { child, exited, async send(command, value) {
    const id = ++nextId;
    const response = new Promise(resolve => pending.set(id, resolve));
    child.send({ id, command, value });
    try { return await bounded(response, `${mode} ${command}: ${stderr}`); }
    finally { pending.delete(id); }
  }, async finish() {
    if (child.exitCode === null && child.signalCode === null) child.send({ command: 'finish' });
    assert.deepEqual(await bounded(exited, 'unreferenced namespace worker exit'), { code: 0, signal: null });
  } };
  workers.push(subject);
  const started = await bounded(ready, 'namespace worker ready');
  assert.equal(started.node, executable === legacyNode ? '16.17.1' : process.versions.node);
  return subject;
}

async function fixture(name) {
  const storage = path.join(directory, name);
  await mkdir(storage);
  const alias = `${storage}-alias`;
  await symlink(storage, alias);
  return { storage, alias };
}

try {
  const nativeFirst = await fixture('native-first');
  const native = await worker(nativeFirst.alias, 'native', legacyNode);
  for (const invalid of ['', 'dsc-runtime-owner-' + '0'.repeat(64), '\0dsc-runtime-owner-' + 'z'.repeat(64),
    '\0dsc-runtime-owner-' + '0'.repeat(65)]) {
    assert.equal((await native.send('invalid', invalid)).ok, false);
  }
  assert.equal((await native.send('claim')).ok, true, 'Actual Node16 must obtain the native claim.');
  const inspection = await native.send('inspect');
  assert.equal(inspection.ok, true);
  assert.equal(inspection.result.closeOnExec, true);
  assert.equal((await native.send('claim')).ok, false, 'The native authority is one-shot.');
  assert.equal((await native.send('configure')).ok, false, 'A namespace authority must not acquire a PTY.');
  const modernContender = await worker(nativeFirst.storage, 'modern');
  const blocked = await modernContender.send('claim');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'EADDRINUSE', 'Native and net.Server must claim the exact same abstract bytes.');
  await native.finish();
  assert.equal((await modernContender.send('claim')).ok, true, 'Original authority exit releases the native claim.');
  await modernContender.finish();

  const modernFirst = await fixture('modern-first');
  const modern = await worker(modernFirst.alias, 'modern');
  assert.equal((await modern.send('claim')).ok, true);
  const nativeContender = await worker(modernFirst.storage, 'native', legacyNode);
  const nativeBlocked = await nativeContender.send('claim');
  assert.equal(nativeBlocked.ok, false);
  assert.match(nativeBlocked.message, /Address already in use/);
  await modern.finish();
  assert.equal((await nativeContender.send('claim')).ok, true,
    'Failed native bind must close its fd and permit a later real claim.');
  await nativeContender.finish();

  const configuredFixture = await fixture('configured');
  const configured = await worker(configuredFixture.storage, 'native', legacyNode);
  assert.equal((await configured.send('configure')).ok, true);
  assert.equal((await configured.send('claim')).ok, false, 'A configured provider cannot become a namespace authority.');
  const independent = await worker(configuredFixture.alias, 'modern');
  assert.equal((await independent.send('claim')).ok, true);
  await independent.finish();
  await configured.finish();
  console.log('Linux native namespace passed (actual Node16/current Node bidirectional exclusion, canonical alias, CLOEXEC, one-shot and exit release; no PTY).');
} finally {
  for (const subject of workers) {
    if (subject.child.exitCode === null && subject.child.signalCode === null) {
      subject.child.kill('SIGKILL');
      await bounded(subject.exited, 'failed fixture cleanup');
    }
  }
  await rm(directory, { recursive: true, force: true });
}
