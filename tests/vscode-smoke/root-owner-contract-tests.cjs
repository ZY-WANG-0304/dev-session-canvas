const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { assertCase, assertContained } = require('./root-owner-contract.cjs');

const identity = pid => ({ pid, startTicks: String(pid * 100), executable: '/fixture/node', state: 'S', ppid: 2 });
const interaction = sessionId => ({ applied: true, marker: 'DSC_ROOT_REPLY_abcd-1234', sessionId });

function fixture() {
  const roots = { a: '/fixture/a', b: '/fixture/b', c: '/fixture/c' };
  const subject = (key, pid, sessionId) => {
    const runtimeOwner = { schema: 1, environmentKey: 'a'.repeat(64), userStorageScopeKey: 'b'.repeat(64),
      root: { kind: 'folder', pathPolicy: 'canvas-path-v1', normalizedPath: roots[key] },
      generation: 'terminal-root-owner-linux-v1' };
    return { binding: { runtimeBackend: 'legacy-detached', runtimeOwner, runtimeStoragePath: `/fixture/storage/${key}`,
      runtimeSessionId: sessionId }, hello: { pid, runtimeOwner }, supervisor: identity(pid),
      socketPath: `/fixture/sockets/${key}`, provider: identity(pid + 100), identity: identity(pid + 200),
      reader: { authorityId: `authority-${sessionId}`, readId: `reader-${sessionId}`, sessionId },
      interaction: interaction(sessionId) };
  };
  const single = { roots, workspaceRoots: [roots.a], globalStorage: '/fixture/global', host: identity(10),
    subject: subject('a', 1000, 'a1') };
  const multi = { roots, workspaceRoots: Object.values(roots), globalStorage: single.globalStorage, host: identity(11),
    subjects: [subject('a', 1000, 'a2'), subject('b', 2000, 'b1'), subject('c', 3000, 'c1')] };
  multi.subjects[0].provider = identity(1101);
  multi.subjects[0].identity = identity(1201);
  multi.resources = { owners: multi.subjects.map(value => ({ identity: value.supervisor, rssBytes: 4096, sameIdentity: true })) };
  const reopened = { workspaceRoots: [roots.a], globalStorage: single.globalStorage, host: identity(12),
    subjects: structuredClone([single.subject, multi.subjects[0]]) };
  for (const value of reopened.subjects) value.reader.readId += '-new-host';
  const closed = { originalHostExited: true, peerInteraction: interaction('a1'),
    persistenceOrder: 'surviving-multi-saved-after-original-host-exit-before-reopen',
    isolatedInteractions: [interaction('b1'), interaction('c1')],
    isolatedChecks: structuredClone(multi.subjects.slice(1).map(value => ({
      supervisor: value.supervisor, provider: value.provider, identity: value.identity }))) };
  return [single, multi, reopened, closed];
}

const negativeCases = [
  ['same Extension Host', ([single, multi]) => { multi.host = single.host; }],
  ['different globalStorage', ([, multi]) => { multi.globalStorage += '-different'; }],
  ['different workspace', ([, multi]) => { multi.workspaceRoots.pop(); }],
  ['not three roots', ([, multi]) => { multi.subjects.pop(); }],
  ['A only attaches first session', ([single, multi]) => { multi.subjects[0].binding.runtimeSessionId = single.subject.binding.runtimeSessionId; }],
  ['A changes owner', ([, multi]) => { multi.subjects[0].binding.runtimeOwner.userStorageScopeKey = 'c'.repeat(64); }],
  ['A changes storage', ([, multi]) => { multi.subjects[0].binding.runtimeStoragePath += '-different'; }],
  ['A changes backend', ([, multi]) => { multi.subjects[0].binding.runtimeBackend += '-different'; }],
  ['A changes PID', ([, multi]) => { multi.subjects[0].supervisor.pid++; }],
  ['A changes endpoint', ([, multi]) => { multi.subjects[0].socketPath += '-different'; }],
  ['B uses A owner', ([, multi]) => { multi.subjects[1].binding.runtimeOwner = multi.subjects[0].binding.runtimeOwner; }],
  ['B uses A PID', ([, multi]) => { multi.subjects[1].supervisor = multi.subjects[0].supervisor; multi.subjects[1].hello.pid = multi.subjects[0].hello.pid; }],
  ['B uses A endpoint', ([, multi]) => { multi.subjects[1].socketPath = multi.subjects[0].socketPath; }],
  ['B uses A storage', ([, multi]) => { multi.subjects[1].binding.runtimeStoragePath = multi.subjects[0].binding.runtimeStoragePath; }],
  ['C changes environment', ([, multi]) => { multi.subjects[2].binding.runtimeOwner.environmentKey = 'c'.repeat(64); }],
  ['C changes user scope', ([, multi]) => { multi.subjects[2].binding.runtimeOwner.userStorageScopeKey = 'c'.repeat(64); }],
  ['owner field omitted', ([single]) => { delete single.subject.binding.runtimeOwner.generation; }],
  ['hello owner mismatch', ([single]) => { single.subject.hello.runtimeOwner = {}; }],
  ['hello PID mismatch', ([single]) => { single.subject.hello.pid++; }],
  ['reader session mismatch', ([single]) => { single.subject.reader.sessionId = 'other'; }],
  ['old Host still live', ([,,, closed]) => { closed.originalHostExited = false; }],
  ['surviving-window save order absent', ([,,, closed]) => { delete closed.persistenceOrder; }],
  ['peer interaction missing', ([,,, closed]) => { closed.peerInteraction.applied = false; }],
  ['peer marker invalid', ([,,, closed]) => { closed.peerInteraction.marker = 'ping abcd-1234'; }],
  ['peer interacts wrong session', ([,,, closed]) => { closed.peerInteraction.sessionId = 'b1'; }],
  ['isolation interaction missing', ([,,, closed]) => { closed.isolatedInteractions.pop(); }],
  ['isolation PID replaced', ([,,, closed]) => { closed.isolatedChecks[0].supervisor.pid++; }],
  ['reopened Host reused', ([single,, reopened]) => { reopened.host = single.host; }],
  ['reopened session lost', ([,, reopened]) => { reopened.subjects.pop(); }],
  ['restored binding changed', ([,, reopened]) => { reopened.subjects[0].binding.runtimeStoragePath += '-new'; }],
  ['restored authority changed', ([,, reopened]) => { reopened.subjects[0].reader.authorityId += '-new'; }],
  ['restored reader reused', ([single,, reopened]) => { reopened.subjects[0].reader.readId = single.subject.reader.readId; }],
  ['restored subject replaced', ([,, reopened]) => { reopened.subjects[0].identity.pid++; }],
  ['restored provider replaced', ([,, reopened]) => { reopened.subjects[0].provider.startTicks += '1'; }],
  ['restored owner replaced', ([,, reopened]) => { reopened.subjects[0].supervisor.executable += '-different'; }],
  ['RSS absent', ([, multi]) => { delete multi.resources.owners[0].rssBytes; }],
  ['RSS zero', ([, multi]) => { multi.resources.owners[0].rssBytes = 0; }],
  ['RSS identity unknown', ([, multi]) => { multi.resources.owners[0].sameIdentity = false; }],
  ['RSS belongs to another process', ([, multi]) => { multi.resources.owners[0].identity = identity(9999); }]
];

async function main() {
  assertCase(...fixture());
  for (const [name, mutate] of negativeCases) {
    const values = fixture();
    mutate(values);
    assert.throws(() => assertCase(...values), undefined, name);
  }
  assertContained('/fixture/user-data', '/fixture/user-data/owned');
  for (const value of ['/fixture/user-data', '/fixture/user-data-elsewhere/owner', '/fixture/user-data/../outside']) {
    assert.throws(() => assertContained('/fixture/user-data', value));
  }
  const projectRoot = path.resolve(__dirname, '../..');
  const { parseRootOwnerSelection, prepareRootOwnerDriver } = await import(pathToFileURL(
    path.join(projectRoot, 'scripts/smoke/run-vscode-root-owner-candidate.mjs')));
  const args = ['--output', '/fixture/output', '--installed-vsix', '/fixture/candidate.vsix'];
  assert.equal(parseRootOwnerSelection(args, 'linux', 'x64').output, '/fixture/output');
  for (const [platform, arch] of [['darwin', 'x64'], ['linux', 'arm64'], ['win32', 'x64']]) {
    assert.throws(() => parseRootOwnerSelection(args, platform, arch));
  }
  assert.throws(() => parseRootOwnerSelection([], 'linux', 'x64'));
  assert.throws(() => parseRootOwnerSelection([...args, '--automatic-retry'], 'linux', 'x64'));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'root-owner-controlled-'));
  try {
    const runtime = { extensionsDir: path.join(temporary, 'extensions'), artifactsDir: path.join(temporary, 'artifacts') };
    await fs.mkdir(runtime.extensionsDir); await fs.mkdir(runtime.artifactsDir);
    const staged = await prepareRootOwnerDriver({ projectRoot, runtime, input: { schemaVersion: 1 } });
    const stagedRoot = path.join(runtime.extensionsDir, 'devsessioncanvas-tests.root-owner-driver-0.0.0');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedRoot, 'package.json'), 'utf8'));
    assert.equal(manifest.main, './tests/vscode-smoke/root-owner-driver.cjs');
    assert.deepEqual(manifest.activationEvents, ['onStartupFinished']);
    assert.equal(manifest.publisher, 'devsessioncanvas-tests');
    const helpers = require(path.join(stagedRoot, 'tests/vscode-smoke/root-owner-runtime-paths.cjs'));
    for (const name of ['resolveLegacyRuntimeSupervisorPaths', 'resolveSystemdUserRuntimeSupervisorPaths',
      'resolveRuntimeRootOwnerGlobalStoragePath', 'assertRuntimeOwnerDescriptor']) assert.equal(typeof helpers[name], 'function');
    assert.match(staged.sourceHashes['staged-root-owner-runtime-paths.cjs'], /^[a-f0-9]{64}$/);
    assert.equal(staged.expectation.extensionsDir, await fs.realpath(runtime.extensionsDir));
    await runSubject(temporary);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  console.log(`Root-owner controlled contract cases passed (${negativeCases.length} rejection cases, staging, selection, real stdin subject); no native VS Code execution claim.`);
}

async function runSubject(temporary) {
  const receiptPath = path.join(temporary, 'subject.json'), nonce = 'abcd-1234';
  const inputPath = path.join(temporary, 'stdin.txt'), outputPath = path.join(temporary, 'stdout.txt');
  const errorPath = path.join(temporary, 'stderr.txt');
  await fs.writeFile(inputPath, `ping ${nonce}\nexit\n`, { flag: 'wx' });
  const input = await fs.open(inputPath, 'r'), output = await fs.open(outputPath, 'wx'), errors = await fs.open(errorPath, 'wx');
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'root-owner-subject.cjs'), receiptPath, nonce],
      { stdio: [input.fd, output.fd, errors.fd] });
    const exit = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Owned stdin fixture timed out.')); }, 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    assert.deepEqual(await exit, { code: 0, signal: null }, await fs.readFile(errorPath, 'utf8'));
    assert.equal(await fs.readFile(outputPath, 'utf8'), `DSC_ROOT_READY_${nonce}\nDSC_ROOT_REPLY_${nonce}\n`);
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    assert.equal(receipt.pid, child.pid); assert.equal(receipt.nonce, nonce); assert.equal(receipt.state, 'ready');
  } finally { await input.close(); await output.close(); await errors.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
