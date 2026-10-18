import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { buildPlan, validateFrozenPlan, classifyChanges, assertFormalEnvironment, planJobs } from '../gates/resolve-plan.mjs';
import { aggregateResults } from '../gates/verify-result.mjs';
import { newTaskReceipt, objectDigest, verifyPackageFiles, validateTaskReceipt, readJSON } from '../gates/receipts.mjs';
import { executeTask, resultPath, taskEvidencePath } from '../gates/run-task.mjs';
import { runProcess,processGroupExists } from '../gates/process.mjs';
import JSZip from 'jszip';
import {collectGitHubProvenance,inspectArtifactArchive} from '../gates/github-provenance.mjs';
import { requestBytes } from '../release/channel-client.mjs';
import {validateAcceptance} from '../gates/check-acceptance.mjs';
import {digest} from '../gates/receipts.mjs';
import {verifyInstrumentation} from '../smoke/package-instrumentation.mjs';
import {readNotificationInvocation} from '../smoke/notification-receiver.mjs';
import { verifyBrowserReport } from '../gates/run-browser-tests.mjs';
import { selectSmokeSuites, smokeCatalog } from '../smoke/smoke-catalog.mjs';
import { collectHostEvidence } from '../smoke/host-evidence.mjs';
import { withinDeadline } from '../gates/deadline.mjs';
import { runNativeOperation, retireNativeResources } from '../smoke/run-native-operation.mjs';
import { NativeTerminalObserver } from '../smoke/native-terminal-observer.mjs';
import { readSmokeImplementationMap, validateSmokeImplementationMap, verifySmokeImplementationSources } from '../gates/smoke-implementation.mjs';
import { inspectVsix, retireCandidateCheckout } from '../release/build-release-candidate.mjs';
import { extractVsixDist } from '../release/vsix-file-list.mjs';
import { ensureExtensionFixtureInputs, verifyExtensionFixture, validateExtensionFixtureInput } from '../smoke/extension-fixture-inputs.mjs';
import { assertEvidencePath, collectEvidence, evidenceLimits, verifyEvidenceManifest } from '../gates/evidence.mjs';
import { preserveAndRetireLocalCheckout } from '../gates/run-local.mjs';
const { readRuntimeSessions, runtimeIsRetired, verifyOriginalLocalRetirement }=createRequire(import.meta.url)('../../tests/vscode-smoke/gate-runtime-state.cjs');
const sha='a'.repeat(40), base='b'.repeat(40), hash='c'.repeat(64);
function fixture({mode='pr',changedPaths=['docs/design-docs/example.md']}={}) {
  const plan=buildPlan({mode,inputSHA:sha,baseSHA:base,headSHA:sha,version:'0.26.1',changedPaths,
    run:{id:'12345',attempt:2,headSHA:sha}});
  const receipts=plan.tasks.map(task=>{
    const r=newTaskReceipt(plan,task,{GITHUB_REPOSITORY:'test/repo'});const start=Date.now()-20,completed=start+10;
    r.status='passed';r.startedAt=new Date(start).toISOString();r.completedAt=new Date(completed).toISOString();r.deadline=start+task.timeoutMs;
    r.stages=Object.fromEntries(task.stages.map(stage=>[stage,{status:'passed',startedAt:r.startedAt,completedAt:r.completedAt}]));return r;
  });
  const jobs=[...new Set(receipts.map(r=>r.producer.jobName))].map((name,i)=>({id:i+1,name,status:'completed',conclusion:'success',steps:[]}));
  const artifacts=jobs.map(job=>{const selected=receipts.filter(r=>r.producer.jobName===job.name);const r=selected[0];return {
    id:job.id+100,name:`gate-${r.job}-${r.variant}-${plan.run.id}-${plan.run.attempt}`,expired:false,
    runID:plan.run.id,attempt:plan.run.attempt,headSHA:sha,jobID:job.id,archiveHash:hash,receiptDigests:selected.map(objectDigest)};});
  const packageReceipt=plan.scope.artifact?{schemaVersion:1,inputSHA:sha,planDigest:objectDigest(plan),profile:'platform',production:true,
    admission:{executions:null,starting:1,pending:2},readmeRef:sha,sourceDigest:hash,lockDigest:hash,nativeSetDigest:hash,
    environmentDigest:plan.environmentDigest,buildCount:{main:1,notifier:1},npmHooksStripped:true,
    producer:{...receipts.find(r=>r.job==='package-clean').producer},packages:['dev-session-canvas','dev-session-canvas-notifier'].map((name,i)=>({
      id:`devsessioncanvas.${name}`,version:plan.version,path:i?'notifier.vsix':'main.vsix',size:7,sha256:hash,payloadDigest:hash}))}:undefined;
  if(packageReceipt) {
    const job=jobs.find(j=>j.name==='Gate package-clean (default)');
    artifacts.push({id:999,name:`gate-transfer-candidate-${plan.run.id}-${plan.run.attempt}`,expired:false,runID:plan.run.id,
      attempt:plan.run.attempt,headSHA:sha,jobID:job.id,archiveHash:hash,receiptDigests:[objectDigest(packageReceipt)]});
    for(const receipt of receipts.filter(r=>['packaged-host','installed-pair'].includes(r.job)))
      receipt.consumed.push({kind:'package-receipt',sha256:objectDigest(packageReceipt)});
  }
  const provenance={schemaVersion:1,repository:'test/repo',runID:plan.run.id,attempt:2,headSHA:sha,jobs,artifacts};
  const refresh=()=>{for(const artifact of artifacts){if(artifact.name.startsWith('gate-transfer-'))artifact.receiptDigests=[objectDigest(packageReceipt)];
    else artifact.receiptDigests=receipts.filter(r=>`gate-${r.job}-${r.variant}-${plan.run.id}-${plan.run.attempt}`===artifact.name).map(objectDigest);}};
  refresh();return {plan,receipts,provenance,packageReceipt,refresh};
}
const rejects=f=>{const result=aggregateResults(f);assert.equal(result.result.status,'failed');assert.equal(result.acceptance,null);return result;};
test('production ZIP inspection keeps localization and source/debug exclusions independently of staging', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-production-list-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'notifier.vsix');
  const zip = new JSZip();
  zip.file('extension/package.json', JSON.stringify({ publisher: 'devsessioncanvas', name: 'dev-session-canvas-notifier',
    version: '0.26.1', main: './dist/extension.js' }));
  for (const relative of ['dist/extension.js', 'images/icon.png', 'images/activitybar.svg', 'package.nls.json',
    'package.nls.zh-cn.json', 'l10n/bundle.l10n.zh-cn.json', 'readme.md', 'changelog.md'])
    zip.file(`extension/${relative}`, 'original runtime payload');
  const write = () => zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }).then(bytes => fs.writeFile(file, bytes));
  const inspect = () => inspectVsix(file, 'devsessioncanvas.dev-session-canvas-notifier', '0.26.1');
  await write(); assert((await inspect()).extensionFiles.some(entry => entry.path === 'dist/extension.js'));
  for (const forbidden of ['src/hidden.js', 'docs/internal.md', 'apps/source.js', 'packages/source.js',
    'node_modules/node-pty/scripts/build.js', 'node_modules/node-pty/node_modules/node-addon-api/index.js',
    'dist/extension.js.map', 'dist/native/debug.pdb']) {
    zip.file(`extension/${forbidden}`, 'must not ship'); await write();
    await assert.rejects(inspect, /non-runtime sources|debug payload/u); zip.remove(`extension/${forbidden}`);
  }
  zip.remove('extension/package.nls.zh-cn.json'); await write();
  await assert.rejects(inspect, /missing package.nls.zh-cn.json/u);
});
test('candidate dist extraction preserves original bytes and executable metadata and rejects ZIP path sanitization', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-candidate-dist-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'main.vsix'), dist = path.join(root, 'dist');
  const zip = new JSZip();
  const helper = Buffer.from([0, 255, 2, 253]);
  zip.file('extension/dist/extension.js', 'original production bundle');
  zip.file('extension/dist/native/spawn-helper', helper, { unixPermissions: 0o100755 });
  const original = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }); await fs.writeFile(file, original);
  await extractVsixDist(file, dist);
  assert.equal(await fs.readFile(path.join(dist, 'extension.js'), 'utf8'), 'original production bundle');
  assert.deepEqual(await fs.readFile(path.join(dist, 'native/spawn-helper')), helper);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dist, 'native/spawn-helper'))).mode & 0o777, 0o755);
  assert.deepEqual(await fs.readFile(file), original);
  await assert.rejects(() => extractVsixDist(file, dist), /private empty destination/u);
  for (const [index, unsafe] of ['extension/dist/../../outside.txt', 'extension/dist/C:redirect',
    'extension/dist/..\\outside.txt'].entries()) {
    const bad = new JSZip(); bad.file('extension/dist/extension.js', 'runtime'); bad.file(unsafe, 'outside must remain absent');
    await fs.writeFile(file, await bad.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    await assert.rejects(() => extractVsixDist(file, path.join(root, `unsafe-${index}`)), /Unsafe VSIX path/u);
  }
  const symlink = new JSZip(); symlink.file('extension/dist/link', '../outside.txt', { unixPermissions: 0o120777 });
  await fs.writeFile(file, await symlink.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
  await assert.rejects(() => extractVsixDist(file, path.join(root, 'redirected')), /symbolic links/u);
  assert.equal(await fs.stat(path.join(root, 'outside.txt')).catch(() => null), null);
});
test('artifact filenames preserve exact task IDs with portable, distinct names', () => {
  const ids = ['test:agent-cli-selection', 'smoke/execution-stop/agent', 'test%3Aagent-cli-selection', 'test/agent-cli-selection'];
  const names = ids.map(id => path.basename(resultPath('/unused', { job: 'regression', variant: 'shard-3', id })));
  assert.equal(new Set(names).size, ids.length);
  for (let i = 0; i < names.length; i++) {
    assert(!/[":<>|?*\\/]/u.test(names[i]), 'Artifact members must work on Windows');
    assert.equal(decodeURIComponent(names[i].slice(0, -'.task.json'.length)), ids[i]);
  }
});
test('task evidence paths are serialized portably by the producer while unsafe receipt paths still fail', () => {
  for (const pathAPI of [path.posix, path.win32]) {
    const root = pathAPI.resolve('gate-results');
    const file = pathAPI.join(root, 'native-assets', 'win32-arm64', 'native-operation.log');
    const relative = taskEvidencePath(root, file, pathAPI);
    assert.equal(relative, 'native-assets/win32-arm64/native-operation.log');
    assertEvidencePath(relative);
  }
  for (const unsafe of ['native-assets\\win32-arm64\\native-operation.log', '../outside.log', '/absolute.log'])
    assert.throws(() => assertEvidencePath(unsafe), /Unsafe evidence path/u);
});
test('bounded evidence retains exact structured failure inputs and log sections without copying cache or SSH keys', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-evidence-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), output = path.join(root, 'retained');
  const inputs = {
    'hosts/original.host.json': '{"pid":123,"startTicks":"456","action":"failed"}',
    'scene/case/artifacts/failure-probe.json': '{"cols":92,"rows":28,"generation":7}',
    'scene/case/artifacts/control.json': '{"phase":"verify","expectedSessionId":"original"}',
    'scene/case/owned.code-workspace': '{"folders":[{"path":"fixture-root"}]}',
    'scene/case/user-data/User/settings.json': '{"devSessionCanvas.runtimePersistence.enabled":true}',
    'scene/case/remote-ssh-fixture/sshd/sshd.log': 'Original sshd failure',
    'scene/case/remote-ssh-fixture/sshd/id_ed25519': 'PRIVATE_KEY_MUST_NOT_BE_EXPORTED',
    'scene/case/smoke-host/node_modules/huge.dat': 'DEPENDENCY_MUST_NOT_BE_EXPORTED',
    'scene/case/cache/huge.dat': 'CACHE_MUST_NOT_BE_EXPORTED',
    'scene/case/smoke-host/package.json': '{"main":"./wrapper.js"}'
  };
  for (const [name, content] of Object.entries(inputs)) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true }); await fs.writeFile(path.join(source, name), content);
  }
  const log = Buffer.concat([Buffer.alloc(evidenceLimits.logHeadBytes, 'H'),
    Buffer.alloc(3 * 1024 ** 2, 'M'), Buffer.alloc(evidenceLimits.logBytes, 'T')]);
  await fs.writeFile(path.join(source, 'original.log'), log);
  const identity = { inputSHA: sha, job: 'source-host', variant: 'original', runID: '12345', attempt: 2 };
  const manifest = await collectEvidence({ roots: [{ directory: source }], output, identity });
  await verifyEvidenceManifest(output, { identity });
  for (const name of ['hosts/original.host.json', 'scene/case/artifacts/failure-probe.json',
    'scene/case/artifacts/control.json', 'scene/case/owned.code-workspace'])
    assert.equal(await fs.readFile(path.join(output, name), 'utf8'), inputs[name]);
  assert(!manifest.files.some(file => /node_modules|cache\/|id_ed25519$/u.test(file.path)));
  const record = manifest.files.find(file => file.path === 'original.log');
  assert.equal(record.sourceSha256, digest(log)); assert.equal(record.originalSize, log.length);
  assert.equal(record.retention, 'log-sections');
  const retained = await fs.readFile(path.join(output, 'original.log'));
  assert(retained.subarray(0, evidenceLimits.logHeadBytes).equals(log.subarray(0, evidenceLimits.logHeadBytes)));
  assert(retained.subarray(-(evidenceLimits.logBytes - evidenceLimits.logHeadBytes))
    .equals(log.subarray(-(evidenceLimits.logBytes - evidenceLimits.logHeadBytes))));
  await fs.appendFile(path.join(output, 'hosts/original.host.json'), 'tamper');
  await assert.rejects(() => verifyEvidenceManifest(output), /strictly equal|bytes changed/u);
});
test('evidence cannot silently truncate structured failures, follow redirected inputs or pass expired collection', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-evidence-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, make, options, pattern] of [
    ['oversize', async dir => fs.writeFile(path.join(dir, 'failure-probe.json'), '{"observation":"unabridged"}'),
      { limits: { ...evidenceLimits, memberBytes: 8 } }, /Non-log evidence/u],
    ['redirected', async dir => fs.symlink(path.join(root, 'private'), path.join(dir, 'probe.json')), {}, /Redirected evidence/u],
    ['expired', async dir => fs.writeFile(path.join(dir, 'receipt.json'), '{}'), { deadline: Date.now() - 1 }, /deadline exhausted/u]
  ]) {
    const source = path.join(root, `${name}-source`), output = path.join(root, name); await fs.mkdir(source); await make(source);
    await assert.rejects(() => collectEvidence({ roots: [{ directory: source }], output, identity: { inputSHA: sha }, ...options }), pattern);
    assert.equal((await readJSON(path.join(output, 'evidence-manifest.json'))).status, 'failed');
    await assert.rejects(() => verifyEvidenceManifest(output), /Evidence collection failed/u);
    assert((await fs.stat(source)).isDirectory(), 'Collection failure must leave original inputs intact');
  }
});
test('local checkout retirement refuses active work and preserves a settled failure before deleting its private scope', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-local-retirement-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const privateRoot = path.join(root, 'private'), checkout = path.join(privateRoot, 'repo');
  const output = path.join(root, 'output'); await fs.mkdir(output); await fs.mkdir(path.join(checkout, 'gate-results/failed'), { recursive: true });
  await fs.writeFile(path.join(checkout, 'gate-results/failed/actual.task.json'), '{"status":"failed"}');
  const args = { privateRoot, checkout, output, inputSHA: sha };
  await assert.rejects(() => preserveAndRetireLocalCheckout({ ...args, original: { unsettled: true } }), /concurrent evidence copy/u);
  assert.equal((await readJSON(path.join(output, 'local-cleanup.json'))).preservation, 'not-run');
  assert((await fs.stat(checkout)).isDirectory());
  await preserveAndRetireLocalCheckout({ ...args, original: new Error('Settled action failed') });
  assert.equal(await fs.readFile(path.join(output, 'preserved/gate-results/failed/actual.task.json'), 'utf8'), '{"status":"failed"}');
  await assert.rejects(() => fs.stat(checkout), { code: 'ENOENT' });
  assert.equal((await readJSON(path.join(output, 'local-cleanup.json'))).cleanup, 'passed');
});
test('fixed Remote SSH inputs reject floating versions, suppliers and empty sets', async () => {
  const inputs = JSON.parse(await fs.readFile(new URL('../smoke/remote-ssh-extension-inputs.json', import.meta.url), 'utf8'));
  assert.deepEqual(inputs.map(input => input.id), ['ms-vscode-remote.remote-ssh', 'ms-vscode-remote.remote-ssh-edit', 'ms-vscode.remote-explorer']);
  for (const input of inputs) validateExtensionFixtureInput(input);
  for (const change of [{ version: 'latest' }, { url: inputs[0].url.replace('/0.128.0/', '/latest/') },
    { id: '../fixture' }, { sha256: 'unchecked' }, { url: inputs[0].url.replace('https:', 'http:') }]) {
    assert.throws(() => validateExtensionFixtureInput({ ...inputs[0], ...change }));
  }
  await assert.rejects(() => ensureExtensionFixtureInputs([], '/unused', Date.now() + 1000), /cannot be empty/);
});
test('fixed extension cache verifies original bytes and manifest before any install', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-fixed-extension-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const zip = new JSZip();
  zip.file('extension/package.json', JSON.stringify({ publisher: 'ms-vscode-remote', name: 'remote-ssh', version: '0.128.0' }));
  zip.file('extension/main.js', 'Original fixture payload.');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const input = { id: 'ms-vscode-remote.remote-ssh', version: '0.128.0', sha256: digest(bytes),
    url: 'https://ms-vscode-remote.gallery.vsassets.io/_apis/public/gallery/publisher/ms-vscode-remote/extension/remote-ssh/0.128.0/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage' };
  const file = path.join(cache, `${input.id}-${input.version}-${input.sha256.slice(0, 16)}.vsix`);
  await fs.writeFile(file, bytes);
  assert.deepEqual(await ensureExtensionFixtureInputs([input], cache, Date.now() + 5000), [file]);
  assert.deepEqual(await fs.readFile(file), bytes);
  const wrongVersion = { ...input, version: '0.129.0', url: input.url.replace('/0.128.0/', '/0.129.0/') };
  await assert.rejects(() => verifyExtensionFixture(bytes, wrongVersion), /version differs/);
  const wrongID = { ...input, id: 'ms-vscode-remote.remote-ssh-edit', url: input.url.replace('/remote-ssh/', '/remote-ssh-edit/') };
  await assert.rejects(() => verifyExtensionFixture(bytes, wrongID));
  await fs.appendFile(file, 'corruption');
  await assert.rejects(() => ensureExtensionFixtureInputs([input], cache, Date.now() + 5000), /bytes changed/);
  assert((await fs.readFile(file)).includes(Buffer.from('corruption')), 'A failed cache must not silently replace the evidence');
});
test('actual Host cleanup observes an already retired graph without a competing reset, and clears a nonempty fixture once', async () => {
  const source = await fs.readFile(new URL('../../tests/vscode-smoke/gate-host-entry.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function cleanupOwnedFixtures()');
  const end = source.indexOf('\nexports.runWrapped', start);
  const cleanupSource = source.slice(start, end);
  for (const initialNodes of [[], [{ id: 'note', kind: 'note' }]]) {
    let nodes = structuredClone(initialNodes), resets = 0, captured = false, retired = false;
    const state = () => ({ state: { nodes }, localExecutions: [] });
    const runtime = { pendingRuntimeSupervisorOperationCount: 0, bindings: [],
      registries: { 'legacy-detached': { exists: false } }, observedRootSupervisorProcesses: [] };
    const command = async name => {
      if (name.endsWith('getDebugState')) return state();
      if (name.endsWith('getRuntimeSupervisorState')) return runtime;
      if (name.endsWith('getDiagnosticEvents')) return [];
      if (name.endsWith('resetState')) { resets++; assert(nodes.length, 'Empty reset would overlap the original mode departure'); nodes = []; return; }
      throw new Error(`Unexpected cleanup command ${name}`);
    };
    const context = vm.createContext({ assert, process: { env: { DEV_SESSION_CANVAS_GATE_STORAGE_ROOT: '/private/fixture' } },
      vscode: { extensions: { getExtension: () => ({ activate: async () => {} }) },
        commands: { getCommands: async () => ['devSessionCanvas.__test.getDebugState'], executeCommand: command } },
      runtimeIsRetired, verifyOriginalLocalRetirement,
      bounded: async (_label, read, predicate) => { const value = await read(); assert(predicate(value)); return value; },
      require: name => {
        if (name === './gate-supervisor-cleanup.cjs') return {
          capturePrivateSupervisors: async () => { captured = true; return { original: 'private-scope' }; },
          retirePrivateSupervisors: async (value, scope) => { assert(runtimeIsRetired(value)); assert(captured); assert.equal(scope.original, 'private-scope'); retired = true; return []; }
        };
        if (name === './reset-canvas.cjs') return { resetCanvasAfterFinalPersistence: async ({ reset, getSnapshot }) => {
          await reset(); assert.equal((await getSnapshot()).state.nodes.length, 0);
        } };
        throw new Error(`Unexpected cleanup dependency ${name}`);
      } });
    const actual = await vm.runInContext(`${cleanupSource}\ncleanupOwnedFixtures()`, context);
    assert.equal(actual.resetRequired, initialNodes.length > 0);
    assert.equal(resets, initialNodes.length ? 1 : 0); assert(captured && retired);
  }
});
test('smoke migration resolves actual registered helpers and causal steps without claiming unimplemented gaps', async () => {
  const result = await verifySmokeImplementationSources();
  assert.equal(result.designDestinations, 152);
  assert.equal(result.mappedDestinations, 137);
  assert.equal(result.unimplemented.length, 15);
  assert.equal(result.reviewedAssertionReplacements, 16);
  assert.equal(result.scope, 'implementation-traceability-not-execution-acceptance');
});
test('smoke migration rejects missing destinations, invented coverage and focused promotion', () => {
  const original = readSmokeImplementationMap();
  for (const mutate of [map => map.cases.pop(), map => map.cases.push(structuredClone(map.cases[0])),
    map => { map.cases.find(item => item.status === 'not-implemented').status = 'implemented-unverified'; },
    map => { map.cases[0].destinations[0].suite = 'invented'; },
    map => { map.cases[0].destinations[0].step = 'not-an-executed-step'; },
    map => { map.cases.find(item => item.id === 'runtime-recovery/legacy-binding').destinations[0].diagnosticOnly = false; },
    map => { map.routes[0].destinations.pop(); },
    map => { map.cases[0].status = 'verified'; }]) {
    const map = structuredClone(original); mutate(map); assert.throws(() => validateSmokeImplementationMap(map));
  }
});
test('smoke migration rejects helpers that exist but are unreachable from the declared case', async () => {
  const map = readSmokeImplementationMap();
  const item = map.cases.find(value => value.id === 'execution-start/auto-start');
  item.destinations[0].helper = 'runIndependentMissingLink';
  await assert.rejects(() => verifySmokeImplementationSources(map), /Unreachable helper/);
  item.destinations[0].helper = 'runHelperThatDoesNotExist';
  await assert.rejects(() => verifySmokeImplementationSources(map), /Missing helper/);
});
test('smoke migration detects a removed actual registration or causal completion boundary', async () => {
  const sources = new Map();
  for (const entry of smokeCatalog) {
    const file = `tests/vscode-smoke/${entry.testFile}`;
    if (!sources.has(file)) sources.set(file, await fs.readFile(new URL(`../../${file}`, import.meta.url), 'utf8'));
  }
  const subject = 'tests/vscode-smoke/extension-tests.cjs';
  const text = sources.get(subject);
  const registration = text.indexOf('const independentCaseFunctions =');
  await assert.rejects(() => verifySmokeImplementationSources(undefined, { readSource: file => file === subject
    ? text.slice(0, registration) + text.slice(registration).replace('runIndependentAutoStart,', '') : sources.get(file) }), /Unregistered independent helper/);
  await assert.rejects(() => verifySmokeImplementationSources(undefined, { readSource: file => file === subject
    ? text.replace("await stepBoundary('interrupt-and-flush','passed');", '') : sources.get(file) }), /Missing actual step boundary/);
});
test('formal plan retains foundation, independent cases, causal combinations and candidate pair',()=>{
  const docs=fixture();assert.equal(docs.plan.scope.functional,false);assert(docs.plan.tasks.some(t=>t.id==='webview-functional'));
  const code=fixture({changedPaths:['extensions/vscode/dev-session-canvas/src/panel/x.ts']});assert(code.plan.scope.functional);
  assert.deepEqual(code.plan.tasks.filter(t=>t.job==='source-host'&&t.suite&&!t.suite.startsWith('notifier')&&t.suite!=='ui-copy-locale').map(t=>t.suite),
    smokeCatalog.filter(item=>!item.diagnosticOnly).map(item=>item.id));
  assert.deepEqual(smokeCatalog.filter(item=>item.kind==='legacy-suite'&&!item.diagnosticOnly).map(item=>item.id),
    ['owned-canvas-reconciliation','snapshot-only-manual-recovery','restricted','runtime-checkpoint-refresh',
      'legacy-supervisor-upgrade','real-reopen','multi-root-real-reopen','single-to-multi-root-real-reopen',
      'two-window-shared-runtime','systemd-user-real-reopen','systemd-fallback-real-reopen',
      'remote-ssh-real-reopen-exit','remote-ssh-real-reopen-retain']);
  const release=fixture({mode:'release-pr'});
  assert.deepEqual(release.plan.tasks.filter(t=>t.job==='packaged-host').map(t=>t.suite),smokeCatalog.filter(item=>item.packaged).map(item=>item.id));
  assert.deepEqual(smokeCatalog.filter(item=>item.kind==='legacy-suite'&&item.packaged).map(item=>item.id),
    ['owned-canvas-reconciliation','snapshot-only-manual-recovery']);
  assert.equal(release.plan.tasks.filter(t=>t.id==='native-operation'&&t.required).length,6);
  assert.equal(release.plan.tasks.filter(t=>t.job==='installed-pair').length,3);assert(planJobs(release.plan)['source-host'].include.length>=19);
  assert.deepEqual(release.plan.tasks.filter(t=>t.job==='marketplace-host').map(t=>[t.id,t.variant]),
    [['marketplace-host','default'],['marketplace-preview','local-preview']]);
  assert.deepEqual(classifyChanges(['unknown/config']),{functional:true,artifact:true});
  assert.throws(()=>validateFrozenPlan({...release.plan,tasks:release.plan.tasks.slice(1)}));
  assert.throws(()=>validateFrozenPlan({...release.plan,scope:{functional:false,artifact:false,release:false}}));
});
test('passing aggregate requires actual receipt set, producer and same candidate pair',()=>{
  assert(aggregateResults(fixture()).acceptance);assert(aggregateResults(fixture({mode:'release-pr'})).acceptance);
});
for(const [name,mutate]of Object.entries({
  missing:f=>f.receipts.pop(),duplicate:f=>f.receipts.push(f.receipts[0]),wrongSHA:f=>{f.receipts[0].inputSHA=base;},
  wrongPlan:f=>{f.receipts[0].planDigest=hash;},wrongVariant:f=>{f.receipts[0].variant='unknown';},
  cancelled:f=>{f.receipts[0].status='cancelled';},cleanup:f=>{const r=f.receipts.find(r=>r.stages.cleanup);r.stages.cleanup.status='failed';},
  jobCancelled:f=>{f.provenance.jobs[0].conclusion='cancelled';},fakeJob:f=>{f.provenance.jobs[0].name='self-reported-success';},
  wrongArtifactProducer:f=>{f.provenance.artifacts[0].jobID=12345;},wrongAttempt:f=>{f.provenance.artifacts[0].attempt=1;},
  receiptNotDownloaded:f=>{f.provenance.artifacts[0].receiptDigests=[];},unknownSchema:f=>{f.receipts[0].schemaVersion=9;},
  emptyEvidence:f=>{f.receipts[0].stages.assert.completedAt=null;},erasedFailure:f=>{f.receipts[0].failures.push({reason:'original error'});},
  packageVersion:f=>{f.packageReceipt.packages[0].version='0.0.1';},consumerPair:f=>{f.receipts.find(r=>r.job==='installed-pair').consumed=[];},
  candidateProducer:f=>{f.provenance.artifacts.find(a=>a.name.startsWith('gate-transfer-candidate')).jobID=321;},
  inflatedDeadline:f=>{f.receipts[0].deadline+=1000;}
}))test(`reject ${name}`,()=>{const f=fixture({mode:'release-pr'});mutate(f);if(name!=='receiptNotDownloaded')f.refresh();rejects(f);});
test('native calibration admits only observed action failure with successful load and cleanup',()=>{
  const f=fixture({changedPaths:['packages/attention-protocol/src/index.ts']});
  const operation=f.receipts.find(r=>r.taskID==='native-operation');operation.status='failed';operation.stages.action.status='failed';
  operation.failures.push({stage:'action',reason:'Actual geometry mismatch'});
  const job=f.provenance.jobs.find(j=>j.name===operation.producer.jobName);job.conclusion='failure';
  job.steps=[{name:'Build and load native input',conclusion:'success'},{name:'Upload load input before operations',conclusion:'success'},
    {name:'Operate original native provider',conclusion:'failure'},{name:'Preserve stage evidence',conclusion:'success'}];
  f.refresh();assert(aggregateResults(f).acceptance);assert.equal(aggregateResults(f).result.calibration.length,1);
  operation.stages.cleanup.status='failed';f.refresh();rejects(f);
});
test('formal overrides, unknown and empty suite selections fail',()=>{
  for(const key of ['DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER','DEV_SESSION_CANVAS_EXECUTION_PROFILE',
    'DEV_SESSION_CANVAS_RELEASE_TEST_MODE','DEV_SESSION_CANVAS_TEST_CODEX_COMMAND','NODE_OPTIONS','PWDEBUG'])
    assert.throws(()=>assertFormalEnvironment({[key]:'1'}));
  assert.throws(()=>selectSmokeSuites({scenario:'unknown'}));assert.throws(()=>selectSmokeSuites({scenario:'runtime-completed-no-history'}));
  const runtime = selectSmokeSuites({payload:'packaged',group:'runtime-products'});
  assert.deepEqual(runtime.map(item => item.id), smokeCatalog.filter(item => item.packaged
    && !item.diagnosticOnly && item.packagedGroup === 'runtime-products').map(item => item.id));
  assert(runtime.some(item => item.id === 'snapshot-only-manual-recovery'));
});
test('runtime cleanup rejects live sessions, unreadable shape, bindings and pending operations',()=>{
  const make=()=>({pendingRuntimeSupervisorOperationCount:0,bindings:[],registries:{legacy:{exists:true,registry:{sessions:[]},
    entries:[{exists:true,registry:{sessions:[]}}]}}});
  const state=make();assert(runtimeIsRetired(state));state.registries.legacy.entries[0].registry.sessions.push({sessionId:'original'});
  assert(!runtimeIsRetired(state));assert.equal(readRuntimeSessions(state).length,1);
  for(const entry of [{exists:true,entries:[{exists:true,sessions:[]}]},{exists:true,error:'read failure'},{exists:true,entries:[{exists:true,registry:{}}]}])
    assert.throws(()=>runtimeIsRetired({...make(),registries:{legacy:entry}}));
  assert(!runtimeIsRetired({...make(),bindings:[{runtimeSessionId:'original'}]}));
  assert(!runtimeIsRetired({...make(),pendingRuntimeSupervisorOperationCount:1}));
});
test('actual browser set rejects skip, retried, empty, extra and expected-failed cases',()=>{
  const report={schemaVersion:1,status:'passed',expected:[{id:'case'}],results:[{id:'case',status:'passed',expectedStatus:'passed',retry:0}]};
  const expected=[{id:'case'}];assert.equal(verifyBrowserReport(report,expected).count,1);
  for(const mutate of [r=>{r.results[0].status='skipped';},r=>{r.results[0].retry=1;},r=>{r.results=[];},
    r=>{r.expected=[];},r=>{r.results[0].expectedStatus='failed';}]){const r=structuredClone(report);mutate(r);assert.throws(()=>verifyBrowserReport(r,expected));}
  assert.throws(()=>verifyBrowserReport(report,[{id:'case'},{id:'missing-registration'}]));
});
test('bounded process reports timeout, cancellation and partial output without passing',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dsc-gate-process-'));
  try{
    const timed=await runProcess(process.execPath,['-e',"process.stdout.write('started\\n');setInterval(()=>{},1000)"],{
      deadline:Date.now()+350,logPath:path.join(temp,'timeout.log'),quiet:true,terminationGraceMs:100});
    assert.equal(timed.status,'failed');assert(timed.timedOut);assert.equal(timed.cleanup.status,'passed');
    assert.match(await fs.readFile(path.join(temp,'timeout.log'),'utf8'),/started/);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100);
    const cancelled=await runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{deadline:Date.now()+3000,signal:controller.signal,quiet:true});
    clearTimeout(timer);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cleanup.status,'passed');
    const missing=await runProcess(path.join(temp,'missing'),[],{deadline:Date.now()+1000,quiet:true});assert.equal(missing.status,'failed');
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('task preserves original action error and additional cleanup failure',async()=>{
  const f=fixture();const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dsc-gate-task-'));
  const task={...f.plan.tasks[0],stages:['prepare','action','assert','cleanup'],timeoutMs:1000,
    budgets:{workMs:700,cleanupMs:200,hostExitMs:0,evidenceMs:100}};
  try{const r=await executeTask({plan:f.plan,task,output:temp,action:async()=>{throw new Error('original failure');},
    cleanup:async()=>{throw new Error('cleanup failure');}});assert.equal(r.status,'failed');assert.equal(r.failures.length,2);
    assert.match(r.failures[0].reason,/original failure/);assert.match(r.failures[1].reason,/cleanup failure/);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('acceptance checks complete results independently of the reusable workflow conclusion',()=>{
  const f=fixture();const {result,acceptance}=aggregateResults(f);
  validateAcceptance({plan:f.plan,result,acceptance,provenance:f.provenance,inputSHA:sha,baseSHA:base,headSHA:sha});
  for(const mutate of [r=>{r.status='failed';},r=>{r.actual.pop();},r=>{r.notRun.push('missing');}]){
    const changed=structuredClone(result);mutate(changed);assert.throws(()=>validateAcceptance({plan:f.plan,result:changed,acceptance,provenance:f.provenance}));
  }
  const changed=structuredClone(acceptance);changed.producer.attempt=1;
  assert.throws(()=>validateAcceptance({plan:f.plan,result,acceptance:changed,provenance:f.provenance}));
});
test('native input provenance ignores unrelated running jobs and binds actual ZIP bytes and upload ID',async()=>{
  const f=fixture({changedPaths:['packages/a.ts']});const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dsc-zip-source-'));
  const zip=new JSZip();zip.file('native-load.task.json',JSON.stringify(f.receipts.find(r=>r.taskID==='native-load')));
  const bytes=await zip.generateAsync({type:'nodebuffer'});const name=`gate-native-load-linux-x64-glibc-${f.plan.run.id}-${f.plan.run.attempt}`;
  const jobs=[{id:1,name:'Validation / Gate native-assets (linux-x64-glibc)',status:'completed',conclusion:'failure'},
    {id:2,name:'Validation / Gate regression (shard-1)',status:'in_progress',conclusion:null}];
  const artifacts=[{id:100,name,expired:false,digest:`sha256:${digest(bytes)}`,workflow_run:{id:12345,head_sha:sha}},
    {id:101,name:`gate-regression-shard-1-${f.plan.run.id}-${f.plan.run.attempt}`,expired:false,workflow_run:{id:12345,head_sha:sha}}];
  const api=async route=>route.includes('/jobs?')?{jobs}:route.endsWith('/12345')?{id:12345,run_attempt:2,head_sha:sha}:{artifacts};
  try{
    const provenance=await collectGitHubProvenance(f.plan,{repository:'test/repo',output:temp,scope:'native-load',api,
      log:async()=> 'Artifact ID is 100',download:async()=>bytes});
    assert.equal(provenance.artifacts.length,1);assert.equal(provenance.artifacts[0].archiveHash,digest(bytes));
    assert.equal(provenance.artifacts[0].jobID,1);
    await assert.rejects(()=>collectGitHubProvenance(f.plan,{repository:'test/repo',output:path.join(temp,'wrong-id'),scope:'native-load',api,
      log:async()=> 'Artifact ID is 1001',download:async()=>bytes}),/bind artifact ID/);
    const traversal=new JSZip();traversal.file('/outside','x');
    await assert.rejects(()=>inspectArtifactArchive(traversal.generateAsync({type:'nodebuffer'}),path.join(temp,'unsafe')));
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('GitHub HTTP provenance binds raw ANSI upload logs and original ZIP bytes without forwarding redirect credentials', async t => {
  const f=fixture({changedPaths:['packages/a.ts']});
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dsc-http-provenance-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const zip=new JSZip();zip.file('native-load.task.json',JSON.stringify(f.receipts.find(r=>r.taskID==='native-load')));
  const archive=await zip.generateAsync({type:'nodebuffer'});
  const artifact={id:100,name:`gate-native-load-linux-x64-glibc-${f.plan.run.id}-${f.plan.run.attempt}`,
    expired:false,digest:`sha256:${digest(archive)}`,workflow_run:{id:12345,head_sha:sha}};
  const jobs=[{id:1,name:'Validation / Gate native-assets (linux-x64-glibc)',status:'completed',conclusion:'failure'}];
  const redirectedHeaders=[];let fault;
  const downloads=http.createServer((req,res)=>{
    redirectedHeaders.push(req.headers);
    if(req.url==='/logs')res.end(Buffer.from(`\u001b[32mUploaded artifact successfully\u001b[0m\nArtifact ID is ${fault==='upload-id'?1001:100}\n`));
    else if(req.url==='/zip')res.end(archive);
    else {res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>downloads.listen(0,'127.0.0.1',resolve));
  t.after(()=>{downloads.closeAllConnections();return new Promise(resolve=>downloads.close(resolve));});
  const downloadURL=`http://127.0.0.1:${downloads.address().port}`;
  const apiHeaders=[];
  const server=http.createServer((req,res)=>{
    apiHeaders.push(req.headers);
    if(req.url==='/repos/test/repo/actions/runs/12345')
      res.end(JSON.stringify({id:12345,head_sha:fault==='run-head'?base:sha,run_attempt:fault==='attempt'?3:2}));
    else if(req.url.includes('/attempts/2/jobs?'))res.end(JSON.stringify({jobs}));
    else if(req.url.includes('/12345/artifacts?'))
      res.end(JSON.stringify({artifacts:[fault==='zip-digest'?{...artifact,digest:`sha256:${hash}`} : artifact]}));
    else if(req.url==='/repos/test/repo/actions/jobs/1/logs'||req.url==='/repos/test/repo/actions/artifacts/100/zip') {
      res.statusCode=302;res.setHeader('Location',`${downloadURL}/${req.url.endsWith('/logs')?'logs':'zip'}`);res.end();
    } else {res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const options={repository:'test/repo',scope:'native-load',token:'fixture-read-only-token',
    apiURL:`http://127.0.0.1:${server.address().port}`};
  const collected=await collectGitHubProvenance(f.plan,{...options,output:path.join(temp,'valid')});
  assert.equal(collected.artifacts.length,1);assert.equal(collected.artifacts[0].jobID,1);
  assert.equal(collected.artifacts[0].archiveHash,digest(archive));
  assert.equal(collected.artifacts[0].receiptDigests[0],objectDigest(f.receipts.find(r=>r.taskID==='native-load')));
  assert(apiHeaders.length>0&&apiHeaders.every(headers=>headers.authorization==='Bearer fixture-read-only-token'));
  assert(redirectedHeaders.length===2&&redirectedHeaders.every(headers=>headers.authorization===undefined));
  for(const [kind,pattern]of [['upload-id',/bind artifact ID/u],['zip-digest',/Downloaded archive differs/u],
    ['run-head',/strictly equal/u],['attempt',/Run attempt changed/u]]) {
    fault=kind;
    await assert.rejects(()=>collectGitHubProvenance(f.plan,{...options,output:path.join(temp,kind)}),pattern);
  }
});
test('provenance HTTP size and absolute deadline failures cannot become successful evidence', async t => {
  const server=http.createServer((req,res)=>{
    if(req.url==='/oversize')res.end(Buffer.alloc(1024,'x'));
    else if(req.url==='/redirect'){res.statusCode=302;res.setHeader('Location','/delayed');res.end();}
    else {const timer=setTimeout(()=>res.end('too late'),500);timer.unref();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const baseURL=`http://127.0.0.1:${server.address().port}`;
  await assert.rejects(()=>requestBytes(`${baseURL}/oversize`,{deadline:Date.now()+2000,maxBytes:8}),/bounded artifact size/u);
  await assert.rejects(()=>requestBytes(`${baseURL}/redirect`,{deadline:Date.now()+100}),/deadline exceeded/u);
  const f=fixture();let queried=false;
  await assert.rejects(()=>collectGitHubProvenance(f.plan,{repository:'test/repo',output:'/unused',deadline:Date.now()-1,
    request:async()=>{queried=true;return Buffer.from('{}');}}),/original deadline exhausted/u);
  assert.equal(queried,false,'An expired collection may not acquire fresh query time');
});
test('packaged instrumentation forbids unexpected payload changes and notifier substitution',()=>{
  const input={beforeMain:[{path:'dist/extension.js',sha256:hash},{path:'package.json',sha256:hash}],beforeNotifier:[{path:'dist/extension.js',sha256:hash}],
    afterMain:[{path:'dist/extension.js',sha256:hash},{path:'package.json',sha256:'d'.repeat(64)},{path:'extension.js',sha256:hash}],
    afterNotifier:[{path:'dist/extension.js',sha256:hash}],beforeManifest:{main:'./dist/extension.js',extensionDependencies:['companion']},
    afterManifest:{main:'./extension.js'}};
  assert.equal(verifyInstrumentation(input).length,2);
  const changed=structuredClone(input);changed.afterMain[0].sha256='d'.repeat(64);assert.throws(()=>verifyInstrumentation(changed));
  const notifier=structuredClone(input);notifier.afterNotifier[0].sha256='d'.repeat(64);assert.throws(()=>verifyInstrumentation(notifier));
});
test('notification receivers validate actual OS invocation rather than product test backend',()=>{
  assert.equal(readNotificationInvocation({args:['--action=view=View Node','--wait','title','message']},'linux').message,'message');
  assert.throws(()=>readNotificationInvocation({args:['title','message']},'linux'));
  assert.equal(readNotificationInvocation({args:['-title','title','-message','message','-open','vscode://notifier/focus']},'darwin').callback,'vscode://notifier/focus');
  assert.throws(()=>readNotificationInvocation({args:['-EncodedCommand',Buffer.from('exit 0','utf16le').toString('base64')]},'win32'));
});
test('deadline abort waits for action retirement before fixture cleanup',async()=>{
  const f=fixture(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'dsc-settlement-'));let retired=false,cleaned=false;
  const task={...f.plan.tasks[0],stages:['prepare','action','assert','cleanup'],timeoutMs:1000,
    budgets:{workMs:150,cleanupMs:700,hostExitMs:0,evidenceMs:150}};
  try{
    const receipt=await executeTask({plan:f.plan,task,output:temp,action:async(_deadline,signal)=>{
      await new Promise(resolve=>signal.addEventListener('abort',()=>setTimeout(resolve,50),{once:true}));retired=true;
    },cleanup:async()=>{assert(retired,'Cleanup raced the original action');cleaned=true;}});
    assert.equal(receipt.status,'failed');assert(cleaned);assert.equal(receipt.stages.cleanup.status,'passed');
    assert.match(receipt.failures[0].reason,/action deadline/);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('a successful parent with a residual process group still fails and retires its child',async()=>{
  if(process.platform==='win32')return;
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dsc-residual-'));
  try{
    const code="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',\"setInterval(()=>{},1000)\"],{stdio:'ignore'});child.unref();setTimeout(()=>process.exit(0),100);";
    const result=await runProcess(process.execPath,['-e',code],{deadline:Date.now()+3000,quiet:true,terminationGraceMs:100});
    assert.equal(result.status,'failed');assert(result.residualGroup);assert.equal(result.code,0);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('Host business completion cannot borrow cleanup time or omit its actual timestamp', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-host-deadline-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const start = Date.now() - 1000;
  const receipt = { schemaVersion: 1, nonce: 'original', caseID: 'notifier-companion', testFile: 'notifier-companion-tests.cjs',
    subjectHash: hash, role: 'main', host: { pid: process.pid, platform: process.platform, startTime: 'original-start' },
    environment: { vscode: '1.142.0', platform: process.platform }, action: 'passed', assert: 'passed', cleanup: 'passed', failures: [],
    cleanupStartedAt: new Date(start+100).toISOString(), cleanupCompletedAt: new Date(start+200).toISOString(),
    startedAt: new Date(start).toISOString(), deadline: start + 100, cleanupDeadline: start + 900,
    actionCompletedAt: new Date(start + 50).toISOString(), completedAt: new Date(start + 200).toISOString() };
  const contract = { caseID: receipt.caseID, vscode: '1.142.0', subjects: [
    { testFile: receipt.testFile, sha256: hash, roles: ['main'] }] };
  const check = value => fs.writeFile(path.join(temp, 'original.host.json'), JSON.stringify(value))
    .then(() => collectHostEvidence(temp, 'original', { contract, observeExit: false }));
  await check(receipt);
  await assert.rejects(() => check({ ...receipt, actionCompletedAt: new Date(start + 101).toISOString() }), /work deadline/);
  const missing = { ...receipt }; delete missing.actionCompletedAt;
  await assert.rejects(() => check(missing), /work deadline/);
});
test('original retirement requires this saved execution and its visible reader evidence', () => {
  const original = { identity: { executionId: 'original', generation: 'generation' }, nodeId: 'node', kind: 'terminal', persistence: {} };
  const state = { localExecutions: [], state: { nodes: [{ id: 'node', kind: 'terminal' }] }, activeSurface: 'editor',
    surfaceLifecycle: { editor: { ready: true, terminalLocalSettlementV1: true } } };
  const saved = { kind: 'execution/localFinalPersistence', detail: { executionId: 'original', generation: 'generation', result: { kind: 'saved' } } };
  const reader = { kind: 'execution/localTerminalReaderSettled', detail: { executionSessionId: 'original', kind: 'terminal', nodeId: 'node', outcome: { kind: 'applied' } } };
  assert.equal(verifyOriginalLocalRetirement([original], state, [saved, reader])[0].readerWasRequired, true);
  assert.throws(() => verifyOriginalLocalRetirement([original], state, [saved]), /reader/);
  assert.throws(() => verifyOriginalLocalRetirement([original], state, [reader]), /save/);
  assert.throws(() => verifyOriginalLocalRetirement([original], state, [saved, { ...reader, detail: { ...reader.detail, outcome: { kind: 'lost' } } }]), /reader/);
  assert.throws(() => verifyOriginalLocalRetirement([original], { ...state, localExecutions: [original] }, [saved, reader]), /reserved/);
});
test('bounded installed operation expires before cleanup and preserves cooperative settlement', async () => {
  let retired = false;
  await assert.rejects(() => withinDeadline('Public operation', Date.now() + 30, async signal => {
    await new Promise(resolve => signal.addEventListener('abort', () => setTimeout(resolve, 30), { once: true }));
    retired = true;
  }, { settlementDeadline: Date.now() + 300 }), error => /deadline/.test(error.message) && !error.unsettled);
  assert(retired);
});
test('native terminal observation recognizes ConPTY OSC and cursor output without accepting a title or command echo', async t => {
  const terminal = new NativeTerminalObserver(80, 24);
  t.after(() => terminal.dispose());
  let sequence=0;
  const consume = text => terminal.consume([{ sequence: ++sequence, text }]);
  const marker='GATE_IO_9896';
  const prompt=`D:\\a\\dev-session-canvas\\dev-session-canvas\\gate-results\\native-assets\\win32-x64\\operation>`;
  await consume(`\u001b[1t\u001b[c\u001b[?1004h\u001b[?9001h\u001b[?7l\u001b[?7hMicrosoft Windows\r\n`
    + `\u001b]0;Administrator: cmd.exe\u001b\\\r\n${prompt}\u001b[4;11Hecho ${marker}\r\n`);
  assert.equal(terminal.hasExactLine(marker),false,'Wrapped echoed input is not the independent response');
  await consume(`\u001b]0;Administrator: cmd.exe - echo ${marker}`);
  assert.equal(terminal.hasExactLine(marker),false,'An incomplete OSC title cannot become output');
  await consume(`\u001b\\${marker.slice(0,7)}`);
  assert.equal(terminal.hasExactLine(marker),false,'A partial response cannot pass');
  await consume(`${marker.slice(7)}\r\n\u001b]0;Administrator: cmd.exe\u001b\\\r\n${prompt}`);
  assert.equal(terminal.hasExactLine(marker),true);
  assert.equal(terminal.flushFinal({ lastDataSequence:sequence }),sequence);
  assert.throws(()=>terminal.flushFinal({ lastDataSequence:sequence+1 }),/sealed output/u);
  await assert.rejects(()=>terminal.consume([{ sequence:sequence+2,text:'foreign' }]),/original ordered output/u);
});
test('native terminal exact responses reject wrapped suffixes and require actual geometry output', async t => {
  const terminal = new NativeTerminalObserver(12,5);t.after(()=>terminal.dispose());
  const marker='GATE_IO_1';
  await terminal.consume([{sequence:1,text:`echo        ${marker}\r\n`}]);
  assert.equal(terminal.hasExactLine(marker),false,'A marker wrapped onto its own visual row remains part of the echo');
  terminal.resize(113,37);
  await terminal.consume([{sequence:2,text:'\u001b[2J\u001b[H\u001b]0;GATE_GEOMETRY=113,37\u0007GATE_GEOMETRY=80,24\r\n'}]);
  assert.equal(terminal.hasExactLine('GATE_GEOMETRY=113,37'),false);
  await terminal.consume([{sequence:3,text:'\u001b[32mGATE_GEOMETRY=113,37\u001b[0m\r\n'}]);
  assert.equal(terminal.hasExactLine('GATE_GEOMETRY=113,37'),true);
  await terminal.consume([{sequence:4,text:'\u001b[2J\u001b[HX'+marker+'\r\n'}]);
  assert.equal(terminal.hasExactLine(marker),false);
});
test('native setup failure still records its original error and independent cleanup', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-native-setup-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await assert.rejects(() => runNativeOperation({ assets: path.join(temp, 'wrong-target'), output: path.join(temp, 'result') }), /actual target/);
  const receipt = JSON.parse(await fs.readFile(path.join(temp, 'result/native-operation.json')));
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.executionApiCalled, false);
  assert.equal(receipt.cleanup.kind, 'settled'); assert.equal(receipt.failures[0].stage, 'prepare');
});

for (const lateAction of [false, true]) test(`child-owned cleanup ${lateAction ? 'cannot hide late business' : 'may finish inside its separate reserve'}`, async t => {
  const f = fixture(), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-child-cleanup-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const actualFile = path.join(temp, 'actual.json');
  const task = { ...f.plan.tasks[0], stages: ['prepare', 'action', 'assert', 'cleanup'], timeoutMs: 2700,
    budgets: { workMs: 1200, cleanupMs: 1000, hostExitMs: 0, evidenceMs: 500 } };
  const code = `const fs=require('node:fs');
    const work=Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE);
    const cleanup=Number(process.env.DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE);
    const record=()=>{const actionCompletedAt=Date.now();
      setTimeout(()=>fs.writeFileSync(${JSON.stringify(actualFile)},JSON.stringify({work,cleanup,actionCompletedAt,cleanupCompletedAt:Date.now()})),
        Math.max(1,work+180-Date.now()));};
    ${lateAction ? 'setTimeout(record,Math.max(1,work+80-Date.now()));' : 'record();'}`;
  const receipt = await executeTask({ plan: f.plan, task, output: temp,
    command: { file: process.execPath, args: ['-e', code] },
    assertResult: async (_result, r) => {
      const actual = JSON.parse(await fs.readFile(actualFile));
      assert.equal(actual.work, r.workDeadline);
      assert(actual.actionCompletedAt <= r.workDeadline, 'Business borrowed cleanup time');
    },
    cleanup: async () => {
      const actual = JSON.parse(await fs.readFile(actualFile));
      assert(actual.cleanupCompletedAt > actual.work, 'Fixture must exercise the separate cleanup reserve');
      assert(actual.cleanupCompletedAt <= actual.cleanup); return actual;
    } });
  assert.equal(receipt.stages.action.status, 'passed', 'Outer process must allow observed child cleanup to finish');
  assert.equal(receipt.stages.cleanup.status, 'passed');
  assert.equal(receipt.status, lateAction ? 'failed' : 'passed');
  if (lateAction) assert.match(receipt.failures[0].reason, /borrowed cleanup/);
});

test('an unsettled native operation refuses reader settlement and owner cleanup', async () => {
  const calls = [], original = Object.assign(new Error('Original Stop did not settle'), { unsettled: true });
  const owner = { list: () => [{ settleReaders: () => calls.push('reader') }],
    close: async () => { calls.push('close'); return { kind: 'settled' }; } };
  await assert.rejects(() => retireNativeResources(owner, original, Date.now() + 1000), /concurrent cleanup refused/);
  assert.deepEqual(calls, []); assert.match(original.message, /Stop did not settle/);
});

test('task refuses parallel fixture cleanup after an embedded operation reports unsettled work', async t => {
  const f = fixture(), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-unsettled-cleanup-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  let cleaned = false;
  const task = { ...f.plan.tasks[0], stages: ['prepare', 'action', 'assert', 'cleanup'], timeoutMs: 1500,
    budgets: { workMs: 800, cleanupMs: 500, hostExitMs: 0, evidenceMs: 200 } };
  const receipt = await executeTask({ plan: f.plan, task, output: temp, embeddedCleanup: true,
    action: async () => { throw Object.assign(new Error('Original native operation remains pending'), { unsettled: true }); },
    cleanup: async () => { cleaned = true; } });
  assert.equal(receipt.status, 'failed'); assert.equal(cleaned, false);
  assert.equal(receipt.stages.cleanup.status, 'not-run');
  assert.match(receipt.failures[0].reason, /remains pending/);
  assert(receipt.failures.some(failure => /concurrent cleanup refused/.test(failure.reason)));
});

for (const lateAction of [false, true]) test(`embedded build ${lateAction ? 'rejects late business despite settled cleanup' : 'preserves its separate checkout retirement reserve'}`, async t => {
  const f = fixture(), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-build-cleanup-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const task = { ...f.plan.tasks[0], stages: ['prepare', 'build', 'assert', 'cleanup'], timeoutMs: 1500,
    budgets: { workMs: 500, cleanupMs: 800, hostExitMs: 0, evidenceMs: 200 } };
  let actual;
  const receipt = await executeTask({ plan: f.plan, task, output: temp, embeddedCleanup: true,
    action: async deadline => {
      if (lateAction) await new Promise(resolve => setTimeout(resolve, Math.max(1, deadline + 30 - Date.now())));
      const actionCompletedAt = Date.now();
      await new Promise(resolve => setTimeout(resolve, Math.max(1, deadline + 120 - Date.now())));
      actual = { deadline, actionCompletedAt, cleanupCompletedAt: Date.now() };
      return actual;
    },
    assertResult: async (result, r) => {
      assert.equal(result.deadline, r.workDeadline);
      assert(result.actionCompletedAt <= r.workDeadline, 'Build business borrowed checkout cleanup time');
    },
    cleanup: async () => {
      assert(actual.cleanupCompletedAt > actual.deadline);
      assert(actual.cleanupCompletedAt <= actual.deadline + task.budgets.cleanupMs);
    } });
  assert.equal(receipt.stages.build.status, 'passed');
  assert.equal(receipt.stages.cleanup.status, 'passed');
  assert.equal(receipt.status, lateAction ? 'failed' : 'passed');
  if (lateAction) assert.match(receipt.failures[0].reason, /borrowed checkout cleanup/);
});

test('clean checkout retirement preserves an unsettled original action and refuses concurrent deletion', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-checkout-retirement-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'partial-payload'); await fs.writeFile(file, 'original');
  const original = Object.assign(new Error('Original build is still running'), { unsettled: true });
  await assert.rejects(() => retireCandidateCheckout(temp, original, Date.now() + 1000), /concurrent checkout cleanup refused/);
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
  const deadline = Date.now() + 1000;
  const actual = await retireCandidateCheckout(temp, new Error('Settled build failed'), deadline);
  assert(Date.parse(actual.cleanupCompletedAt) <= deadline);
  assert.equal(await fs.stat(temp).catch(() => null), null);
});
