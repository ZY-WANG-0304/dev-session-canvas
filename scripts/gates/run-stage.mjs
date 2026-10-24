import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { environmentPolicy, infrastructureBudgets } from './catalog.mjs';
import { assertFormalEnvironment, validateFrozenPlan } from './resolve-plan.mjs';
import { executeTask, markNotRun, assertCheckout, resultPath } from './run-task.mjs';
import { fileDigest, objectDigest, readJSON, producerFor, verifyPackageFiles, writeJSON } from './receipts.mjs';
import { npmCommand, nodeCommand, runProcess } from './process.mjs';
import { treeHashes, buildReleaseCandidate } from '../release/build-release-candidate.mjs';
import { collectHostEvidence } from '../smoke/host-evidence.mjs';
import { smokeHostContract } from '../smoke/smoke-catalog.mjs';
import { retireFormalSmokeRuntimes } from '../smoke/vscode-smoke-runner.mjs';
import { assembleExecutionDistributionAssets } from '../build/assemble-execution-distribution-assets.mjs';
import { validateReleasePreflight } from '../release/release-preflight.mjs';
import { fileURLToPath } from 'node:url';

export async function runStage() {
const { values } = parseArgs({ options: { plan: { type: 'string' }, job: { type: 'string' }, variant: { type: 'string' },
  output: { type: 'string' }, 'browser-input': { type: 'string' }, 'source-input': { type: 'string' },
  candidate: { type: 'string' }, archives: { type: 'string' }, assets: { type: 'string' },
  part: { type: 'string' } } });
assert(values.plan && values.job && values.output, 'Stage requires --plan --job --output');
const plan = validateFrozenPlan(await readJSON(values.plan));
assertFormalEnvironment();
assertCheckout(plan);
const variant = values.variant ?? 'default'; const job = values.job; const output = path.resolve(values.output);
const tasks = plan.tasks.filter(task => task.job === job && task.variant === variant
  && (!values.part || task.id === `native-${values.part}`));
assert(!values.part || job === 'native-assets' && ['load','operation'].includes(values.part), 'Only native has separate load/operation steps');
assert(tasks.length, `Stage ${job}/${variant} is not in the immutable plan`);
const nodeVersion = job === 'native-assets' ? environmentPolicy.nativeNode : environmentPolicy.node;
assert.equal(process.versions.node, nodeVersion, 'Formal stage must run the frozen Node version');
await fs.mkdir(path.join(output, job, variant), { recursive: true });
await writeJSON(path.join(output, job, variant, 'environment.json'), { schemaVersion: 1,
  node: process.versions, platform: process.platform, arch: process.arch,
  runnerImage: { os: process.env.ImageOS ?? null, version: process.env.ImageVersion ?? null },
  environmentDigest: plan.environmentDigest });
let stopGroup = false, failed = false;
const sourceReceiptFile = values['source-input'] && path.join(path.resolve(values['source-input']), 'source-build-receipt.json');
const browserReceiptFile = values['browser-input'] && path.join(path.resolve(values['browser-input']), 'browser-build-receipt.json');
const packageReceiptFile = values.candidate && path.join(path.resolve(values.candidate), 'package-receipt.json');
const consumed = [];
for (const [kind, file] of [['source-build', sourceReceiptFile], ['frontend-build', browserReceiptFile], ['package-receipt', packageReceiptFile]]) {
  if (!file) continue;
  const receipt = await readJSON(file);
  assert.equal(receipt.inputSHA, plan.inputSHA); assert.equal(receipt.planDigest, objectDigest(plan));
  consumed.push({ kind, sha256: objectDigest(receipt) });
}
if (packageReceiptFile) await verifyPackageFiles(await readJSON(packageReceiptFile), plan, values.candidate);

async function checkedBuildInput(directory, receiptFile, paths) {
  const receipt = await readJSON(receiptFile);
  assert.equal(receipt.inputSHA, plan.inputSHA); assert.equal(receipt.planDigest, objectDigest(plan));
  if (receiptFile === browserReceiptFile) assert.equal(receipt.production, true, 'Browser checks require the production bundle');
  for (const relative of paths) {
    const expected = receipt.trees[relative]; assert(expected, `Build output is missing ${relative}`);
    assert.deepEqual(await treeHashes(path.join(directory, relative)), expected, 'Consumed build artifact bytes changed');
  }
}
if (sourceReceiptFile) {
  await checkedBuildInput(values['source-input'], sourceReceiptFile, ['main-dist', 'notifier-dist']);
  for (const [from, to] of [['main-dist', 'extensions/vscode/dev-session-canvas/dist'],
    ['notifier-dist', 'extensions/vscode/dev-session-canvas-notifier/dist']]) {
    await fs.rm(to, { recursive: true, force: true }); await fs.cp(path.join(values['source-input'], from), to, { recursive: true });
  }
}
if (browserReceiptFile) await checkedBuildInput(values['browser-input'], browserReceiptFile, ['main', 'marketplace']);

async function inputContract() {
  const root = await readJSON('package.json'); const lock = await readJSON('package-lock.json');
  for (const file of ['extensions/vscode/dev-session-canvas/package.json', 'extensions/vscode/dev-session-canvas-notifier/package.json']) {
    const manifest = await readJSON(file); assert.equal(manifest.version, root.version);
    assert.equal(lock.packages[path.dirname(file)]?.version, manifest.version, 'Workspace lock version differs');
  }
  assert.equal(lock.packages[''].version, root.version); assert.equal(root.version, plan.version);
  if (['release-pr', 'release-tag'].includes(plan.mode)) validateReleasePreflight({ projectRoot: process.cwd(), version: plan.version });
  return { manifestVersions: 'consistent', releaseContract: plan.mode.startsWith('release-') ? 'validated' : 'not-applicable' };
}
const childCommand = async (file, args, destination, deadline,signal) => {
  const result = await runProcess(file, args, { deadline,signal,logPath: path.join(destination, `${randomUUID()}.log`) });
  assert.equal(result.status, 'passed', `Build/process stage failed: ${JSON.stringify(result)}`);
  return result;
};
async function sourceBuild(deadline,signal) {
  assert(values.archives, 'Source build requires same-run checked native archives');
  const privateRoot = path.join(output, job, variant); const assets = path.join(privateRoot, 'native-set');
  assembleExecutionDistributionAssets({ source: values.archives, output: assets, inputCommit: plan.inputSHA });
  await childCommand(process.execPath, ['scripts/build/build.mjs', '--execution-assets-set', assets], privateRoot, deadline,signal);
  await childCommand(process.execPath, ['extensions/vscode/dev-session-canvas-notifier/scripts/build.mjs'], privateRoot, deadline,signal);
  const bundle = path.resolve('gate-transfer/source-bundle'); await fs.mkdir(bundle, { recursive: true });
  const trees = {};
  for (const [source, target] of [['extensions/vscode/dev-session-canvas/dist', 'main-dist'],
    ['extensions/vscode/dev-session-canvas-notifier/dist', 'notifier-dist']]) {
    await fs.cp(source, path.join(bundle, target), { recursive: true }); trees[target] = await treeHashes(source);
  }
  const receipt = { schemaVersion: 1, planDigest: objectDigest(plan), inputSHA: plan.inputSHA,
    nativeSetDigest: objectDigest(await treeHashes(assets)), trees, producer: producerFor(plan, job, variant),
    production: false, buildCount: { main: 1, notifier: 1 } };
  await writeJSON(path.join(bundle, 'source-build-receipt.json'), receipt); return receipt;
}

const abort = new AbortController();
process.once('SIGTERM', () => abort.abort(new Error('Stage cancelled')));
process.once('SIGINT', () => abort.abort(new Error('Stage interrupted')));
for (const task of tasks) {
  if (stopGroup) { await markNotRun(plan, task, output, 'Previous fixture cleanup is unconfirmed; Host group stopped'); continue; }
  const base = { plan, task, output, consumed, signal: abort.signal };
  let config = {};
  if (job === 'input-contract') config = { assertResult: inputContract };
  else if (job === 'regression') config = { command: npmCommand(['run', task.id]) };
  else if (job === 'frontend-build') {
    const bundle = path.resolve('gate-transfer/browser-bundle');
    config = { command: nodeCommand(['scripts/build/build-browser-assets.mjs', '--output', bundle, '--production']),
      assertResult: async () => {
        const trees = { main: await treeHashes(path.join(bundle, 'main')), marketplace: await treeHashes(path.join(bundle, 'marketplace')) };
        assert(trees.main.some(file => file.path === 'webview.js')); assert(trees.marketplace.some(file => file.path === 'index.html'));
        const receipt = { schemaVersion: 1, planDigest: objectDigest(plan), inputSHA: plan.inputSHA, production: true,
          trees, producer: producerFor(plan, job, variant) };
        await writeJSON(path.join(bundle, 'browser-build-receipt.json'), receipt); return receipt;
      } };
  } else if (job === 'webview-function' || job === 'webview-visual') {
    assert(browserReceiptFile, 'Browser checks must consume frontend-build');
    const env = { ...process.env, DEV_SESSION_CANVAS_BROWSER_ASSETS: path.resolve(values['browser-input'], 'main') };
    config = { env, command: task.id.startsWith('test:') ? npmCommand(['run', task.id])
      : nodeCommand(['scripts/gates/run-browser-tests.mjs', '--kind', job === 'webview-visual' ? 'visual' : 'functional',
        '--output', path.join(output, job, variant, task.id)]) };
  } else if (job === 'marketplace-browser') {
    assert(browserReceiptFile, 'Marketplace browser checks must consume frontend-build');
    config = { command: nodeCommand(['scripts/test/test-template-marketplace-publish-page.mjs']),
      env: { ...process.env, DEV_SESSION_CANVAS_MARKETPLACE_BROWSER_ASSETS: path.resolve(values['browser-input'], 'marketplace') } };
  } else if (job === 'native-assets') {
    assert(values.assets, 'Native stage requires its private asset path');
    if (task.id === 'native-load') config = { command: nodeCommand(['scripts/build/build-execution-distribution-assets.mjs',
      '--target', variant, '--output', values.assets, '--artifacts', path.resolve('gate-transfer/native-archive')]),
      assertResult: async () => {
        const summary = await readJSON(path.join('gate-transfer/native-archive', `${variant}-summary.json`));
        assert.equal(summary.inputCommit, plan.inputSHA); assert.equal(summary.nativeLoaded, true);
        assert.equal(summary.executionApiCalled, false); assert.equal(summary.productValidated, false);
        assert.equal(summary.archiveSha256, await fileDigest(path.join('gate-transfer/native-archive', `${variant}.tar.gz`)));
        return summary;
      } };
    else config = { prepare: async () => {
      const load = await readJSON(path.join(output,job,variant,'native-load.task.json'));
      assert.equal(load.status,'passed','Native operation requires its exact target load');
      assert.equal(load.inputSHA,plan.inputSHA); assert.equal(load.planDigest,objectDigest(plan));
    }, command: nodeCommand(['scripts/smoke/run-native-operation.mjs', '--assets', values.assets,
      '--output', path.join(output, job, variant, 'operation')]),
      assertResult: async (_result, taskReceipt) => { const receipt = await readJSON(path.join(output, job, variant, 'operation/native-operation.json'));
        assert.equal(receipt.status, 'passed'); assert.equal(receipt.executionApiCalled, true); assert.equal(receipt.cases.length, 2);
        assert(Number.isFinite(Date.parse(receipt.actionCompletedAt)) && Date.parse(receipt.actionCompletedAt) <= taskReceipt.workDeadline,
          'Native action borrowed cleanup time');
        return receipt; },
      cleanup: async () => { const receipt = await readJSON(path.join(output, job, variant, 'operation/native-operation.json'));
        assert.equal(receipt.cleanup.kind, 'settled');
        assert(Date.parse(receipt.cleanupCompletedAt) >= Date.parse(receipt.cleanupStartedAt)
          && Date.parse(receipt.cleanupCompletedAt) <= receipt.cleanupDeadline, 'Native cleanup deadline is unconfirmed');
        return receipt.cleanup; } };
  } else if (job === 'source-build') config = { action: sourceBuild,
    assertResult: async result => { assert.equal(result.inputSHA, plan.inputSHA); return { source: objectDigest(result) }; } };
  else if (job === 'package-clean') {
    if (task.id === 'package-clean') {
      const candidate = path.resolve('gate-transfer/release-candidate');
      config = { embeddedCleanup: true,
        action: (deadline,signal) => buildReleaseCandidate({ plan, output: candidate, archives: values.archives, deadline,
          cleanupDeadline: deadline + task.budgets.cleanupMs, signal }),
        assertResult: async (receipt, taskReceipt) => {
          const result = await readJSON(path.join(candidate, 'clean-checkout-result.json'));
          assert(Number.isFinite(Date.parse(result.actionCompletedAt)) && Date.parse(result.actionCompletedAt) <= taskReceipt.workDeadline,
            'Candidate business completion borrowed cleanup time');
          return verifyPackageFiles(receipt, plan, candidate);
        },
        cleanup: async () => { const result = await readJSON(path.join(candidate, 'clean-checkout-result.json'));
          assert.equal(result.cleanup, 'passed');
          assert(Date.parse(result.cleanupCompletedAt) >= Date.parse(result.cleanupStartedAt)
            && Date.parse(result.cleanupCompletedAt) <= result.cleanupDeadline, 'Candidate cleanup deadline is unconfirmed');
          return result; } };
    } else config = { command: nodeCommand(['scripts/test/test-package-vsix-file-list.mjs',
      '--candidate', path.resolve('gate-transfer/release-candidate')]) };
  } else if (job === 'source-host' || job === 'packaged-host' || job === 'marketplace-host') {
    const hostEvidenceRoot = path.join(output, job, variant, task.id.replaceAll('/', '--'), 'hosts');
    const nonce = randomUUID(); await fs.mkdir(hostEvidenceRoot, { recursive: true });
    const contract = smokeHostContract(task.suite ?? task.id);
    contract.vscode = environmentPolicy.vscode;
    for (const subject of contract.subjects) subject.sha256 = await fileDigest(path.join('tests/vscode-smoke', subject.testFile));
    const env = { ...process.env, DEV_SESSION_CANVAS_GATE_PLAN: path.resolve(values.plan),
      DEV_SESSION_CANVAS_GATE_HOST_RECEIPTS: hostEvidenceRoot, DEV_SESSION_CANVAS_GATE_RUN_NONCE: nonce,
      DEV_SESSION_CANVAS_GATE_CASE_ID: contract.caseID,
      DEV_SESSION_CANVAS_VSCODE_VERSION: environmentPolicy.vscode,
      DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT: path.join(output, job, variant, 'scene') };
    let args;
    if (job === 'packaged-host') {
      assert(packageReceiptFile); args = ['scripts/smoke/run-vscode-vsix-smoke.mjs', '--plan', values.plan,
        '--main-vsix', path.join(values.candidate, 'main.vsix'), '--notifier-vsix', path.join(values.candidate, 'notifier.vsix'),
        '--package-receipt', packageReceiptFile, '--scenario', task.suite];
    } else if (job === 'marketplace-host') {
      assert(sourceReceiptFile);
      const marketplaceRunners = {
        'marketplace-host': 'run-template-marketplace-vscode-e2e.mjs',
        'marketplace-preview': 'run-template-marketplace-vscode-local-preview-e2e.mjs'
      };
      assert(marketplaceRunners[task.id], 'Unknown Marketplace Host task');
      args = [`scripts/smoke/${marketplaceRunners[task.id]}`];
    }
    else {
      assert(sourceReceiptFile);
      const auxiliary = { 'notifier-companion': 'run-vscode-notifier-smoke.mjs',
        'notifier-locale': 'run-vscode-notifier-locale-smoke.mjs', 'ui-copy-locale': 'run-vscode-ui-copy-locale-smoke.mjs' };
      args = auxiliary[task.suite] ? [`scripts/smoke/${auxiliary[task.suite]}`]
        : ['scripts/smoke/run-vscode-smoke.mjs', '--plan', values.plan, '--scenario', task.suite];
      if (plan.mode === 'diagnostic' && !auxiliary[task.suite]) args.push('--diagnostic');
    }
    let observed;
    config = { env, command: nodeCommand(args),
      assertResult: async (_result,_receipt,phase,deadline) => {
        if(phase==='host-exit') {
          const retirement = await retireFormalSmokeRuntimes(hostEvidenceRoot, nonce,
            { contract, fixtureRoot: env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT, deadline });
          return retirement;
        }
        observed ??= await collectHostEvidence(hostEvidenceRoot,nonce,{contract,observeExit:false});return observed;
      },
      cleanup: async () => { const cleanupEvidence = await collectHostEvidence(hostEvidenceRoot, nonce, { contract,requireActions: false,observeExit:false });
        return { hosts: cleanupEvidence.results.length, exits: cleanupEvidence.exits, cleanup: 'passed' }; } };
  } else if (job === 'installed-pair') {
    assert(packageReceiptFile);
    const destination = path.join(output, job, variant, 'installed');
    config = { command: nodeCommand(['scripts/smoke/run-installed-pair.mjs', '--plan', values.plan,
      '--candidate', values.candidate, '--output', destination]),
      assertResult: async (_result,_taskReceipt,phase) => {
        const receipt = await readJSON(path.join(destination, 'installed-pair.json'));
        if(phase==='host-exit'){assert.equal(receipt.hostExit,'passed');return {hostExit:receipt.hostExit};}
        assert.equal(receipt.status, 'passed'); assert.equal(receipt.productTestMode, false);
        assert(Number.isFinite(Date.parse(receipt.actionCompletedAt))
          && Date.parse(receipt.actionCompletedAt)<=_taskReceipt.workDeadline,
        'Installed business completion exceeded its original work deadline');
        assert.equal(receipt.packageReceiptDigest, objectDigest(await readJSON(packageReceiptFile)));
        return receipt;
      }, cleanup: async () => { const receipt = await readJSON(path.join(destination, 'installed-pair.json'));
        assert.equal(receipt.cleanup, 'passed'); return { cleanup: receipt.cleanup }; } };
  } else throw new Error(`Unknown stage ${job}`);
  const receipt = await executeTask({ ...base, ...config });
  if (receipt.status !== 'passed') failed = true; // Calibration is a result policy, never an erased process failure.
  if (receipt.stages.cleanup?.status === 'failed') stopGroup = true;
  // Native operation may execute only after this exact target's load passed.
  if (task.id === 'native-load' && receipt.status !== 'passed') stopGroup = true;
}
if (packageReceiptFile) await verifyPackageFiles(await readJSON(packageReceiptFile), plan, values.candidate);
if (failed) process.exitCode = 1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) await runStage();
