import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { assertFormalEnvironment, resolvePlan, validateFrozenPlan } from './resolve-plan.mjs';
import { assertCheckout, markNotRun, taskFileName } from './run-task.mjs';
import { runProcess } from './process.mjs';
import { dependencyInstallArgs, dependencyProfileForTasks, npmLogEnvironment } from './dependency-install.mjs';
import { digest, objectDigest, readJSON, validateTaskReceipt, verifyPackageFiles, writeJSON } from './receipts.mjs';
import { environmentPolicy, infrastructureBudgets, installedTargets, jobDependencies, nativeTargets, taskKey } from './catalog.mjs';
import { loadReceipts } from './verify-result.mjs';
import { ensureNodeToolchain } from './node-toolchain.mjs';
import { withinDeadline } from './deadline.mjs';
import { collectEvidence } from './evidence.mjs';

export async function preserveAndRetireLocalCheckout({ privateRoot, checkout, output, inputSHA,
  original, plan, deadline = Date.now() + infrastructureBudgets.evidence + infrastructureBudgets.cleanup }) {
  let preservation = 'not-run', cleanup = 'not-run', failure;
  try {
    assert(!original?.unsettled, 'Local actions have not settled; concurrent evidence copy and checkout cleanup refused');
    preservation = 'failed';
    const roots = [
      { directory: path.join(checkout, 'gate-results'), prefix: 'gate-results', optional: true },
      { directory: path.join(checkout, 'gate-transfer/native-archive'), prefix: 'gate-transfer/native-archive', optional: true },
      { directory: path.join(checkout, 'gate-transfer/release-candidate'), prefix: 'gate-transfer/release-candidate', optional: true },
      { directory: path.join(checkout, 'gate-plan'), prefix: 'gate-plan', optional: true }
    ];
    if (await Promise.all(roots.map(root => fs.stat(root.directory).catch(error => {
      if (error.code === 'ENOENT') return null; throw error;
    }))).then(entries => entries.some(Boolean))) {
      await collectEvidence({ roots, output: path.join(output, 'preserved'),
        identity: { inputSHA, mode: plan?.mode ?? 'local', source: 'local-process' },
        deadline: Math.min(deadline, Date.now() + infrastructureBudgets.evidence) });
    }
    preservation = 'passed'; cleanup = 'failed';
    await withinDeadline('Local isolated checkout retirement',
      Math.min(deadline, Date.now() + infrastructureBudgets.cleanup), () => fs.rm(privateRoot, { recursive: true, force: true }));
    cleanup = 'passed';
  } catch (error) { failure = error; }
  const result = { schemaVersion: 1, inputSHA, preservation, cleanup,
    preservedCheckout: cleanup !== 'passed' ? privateRoot : null, sourceMode: 'isolated-checkout',
    failure: failure?.message ?? null, unsettled: original?.unsettled === true || failure?.unsettled === true };
  await writeJSON(path.join(output, 'local-cleanup.json'), result);
  if (failure) throw failure;
  return result;
}

export function localStageGraph(plan) {
  validateFrozenPlan(plan);
  const graph = [];
  for (const job of Object.keys(jobDependencies)) {
    for (const variant of new Set(plan.tasks.filter(task => task.job === job).map(task => task.variant))) {
      graph.push({ job, variant, needs: jobDependencies[job],
        tasks: plan.tasks.filter(task => task.job === job && task.variant === variant) });
    }
  }
  assert.equal(graph.reduce((sum, stage) => sum + stage.tasks.length, 0), plan.tasks.length);
  return graph;
}

// Build the actual merge tree in the private clone. Changing origin/main to the
// requested head would falsely make a PR-head checkout look like a main check.
export function freezeLocalInput(checkout, { mode, ref, base, head, originMain }) {
  const git = args => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 }).trim();
  for (const sha of [ref, base, head, originMain]) assert.match(sha, /^[a-f0-9]{40}$/u);
  git(['cat-file', '-e', `${ref}^{commit}`]);
  git(['update-ref', 'refs/remotes/origin/main', originMain]);
  if (!['pr', 'release-pr'].includes(mode) || ref === originMain && head === ref) return ref;
  const parents = git(['show', '-s', '--format=%P', ref]).split(' ');
  if (ref !== head && parents.length === 2) {
    assert.deepEqual(parents, [base, head], 'Declared merge input has different parents');
    return ref;
  }
  assert.equal(ref, head, 'Specify a real PR head or its matching pre-merge result');
  assert.equal(base, originMain, 'Regenerate local PR input from the latest fetched origin/main');
  // Git 2.34 (still present on supported local systems) has no write-tree
  // merge-tree mode. Use the actual index merge in this private clone instead;
  // conflicts must fail before any candidate commit can be created.
  git(['checkout', '--detach', base]);
  try {
    execFileSync('git', ['-c', 'user.name=Local CI', '-c', 'user.email=local-ci@invalid',
      'merge', '--no-ff', '--no-commit', '--no-stat', head], {
      cwd: checkout, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000
    });
  } catch (error) {
    const conflicts = git(['diff', '--name-only', '--diff-filter=U']);
    if (conflicts) throw new Error(`Local pre-merge input has unresolved conflicts: ${conflicts}`, { cause: error });
    throw error;
  }
  const tree = git(['write-tree']);
  const input = execFileSync('git', ['commit-tree', tree, '-p', base, '-p', head], {
    cwd: checkout, encoding: 'utf8', input: '本地 CI 预合并输入\n',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Local CI', GIT_COMMITTER_NAME: 'Local CI',
      GIT_AUTHOR_EMAIL: 'local-ci@invalid', GIT_COMMITTER_EMAIL: 'local-ci@invalid' }
  }).trim();
  git(['reset', '--hard', input]);
  assert.equal(git(['show', '-s', '--format=%P', input]), `${base} ${head}`,
    'Local merge input must retain both declared parents');
  return input;
}

export function unavailableDependency(stage, receipts) {
  for (const job of stage.needs) {
    const expected = stage.plan.tasks.filter(task => task.job === job
      && (job !== 'native-assets' || task.id === 'native-load'));
    if (!expected.length || expected.some(task => receipts.get(taskKey(task))?.status !== 'passed')) {
      return `Required ${job} inputs are missing or failed`;
    }
  }
  return null;
}

function isolatedEnvironment(privateRoot, planFile) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:GITHUB_|GH_|VSCODE_|DEV_SESSION_CANVAS_|DSC_NOTIFICATION_)/u.test(key)
      || /(?:TOKEN|PASSWORD|SECRET|PAT)$/iu.test(key)) delete env[key];
  }
  return { ...env, HOME: path.join(privateRoot, 'home'), USERPROFILE: path.join(privateRoot, 'home'),
    XDG_CONFIG_HOME: path.join(privateRoot, 'config'), XDG_CACHE_HOME: path.join(privateRoot, 'cache'),
    TMPDIR: path.join(privateRoot, 'tmp'), TMP: path.join(privateRoot, 'tmp'), TEMP: path.join(privateRoot, 'tmp'),
    NPM_CONFIG_USERCONFIG: path.join(privateRoot, 'user.npmrc'), npm_config_userconfig: path.join(privateRoot, 'user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(privateRoot, 'global.npmrc'), npm_config_globalconfig: path.join(privateRoot, 'global.npmrc'),
    NPM_CONFIG_CACHE: path.join(privateRoot, 'cache/npm'), npm_config_cache: path.join(privateRoot, 'cache/npm'),
    PLAYWRIGHT_BROWSERS_PATH: path.join(privateRoot, 'cache/playwright'),
    DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH: path.join(privateRoot, 'cache/vscode'),
    DEV_SESSION_CANVAS_GATE_PLAN: planFile };
}

async function localEvidence(plan, receipts, stages, resultsRoot, output) {
  // These are local archives, with the hash of their actual ZIP bytes. No
  // invented Actions job/artifact IDs or publishable acceptance are produced.
  const archives = [];
  for (const stage of stages) {
    const selected = receipts.filter(receipt => receipt.job === stage.job && receipt.variant === stage.variant);
    if (!selected.length) continue;
    const zip = new JSZip();
    for (const receipt of selected) zip.file(`${taskFileName(receipt.taskID)}.task.json`, JSON.stringify(receipt));
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const name = `local-${stage.job}-${stage.variant}.zip`;
    await fs.writeFile(path.join(output, name), bytes, { flag: 'wx' });
    archives.push({ name, sha256: digest(bytes), execution: stage,
      receiptDigests: selected.map(objectDigest), source: 'local-process' });
  }
  const passed = [], failed = [], notRun = [], calibration = [], errors = [];
  const actual = new Map();
  for (const receipt of receipts) {
    const key = `${receipt.job}/${receipt.variant}/${receipt.taskID}`;
    if (actual.has(key)) errors.push({ key, reason: 'Duplicate actual task receipt' });
    actual.set(key, receipt);
    if (!plan.tasks.some(task => taskKey(task) === key)) errors.push({ key, reason: 'Unplanned local task' });
  }
  for (const task of plan.tasks) {
    const key = taskKey(task), receipt = actual.get(key);
    if (!receipt || receipt.status === 'not-run') { notRun.push({ key, reason: receipt?.failures?.[0]?.reason ?? 'Missing receipt' }); continue; }
    try {
      validateTaskReceipt(receipt, plan, task);
      assert.equal(receipt.producer.repository, 'local');
      const stage = stages.find(entry => entry.job === task.job && entry.variant === task.variant);
      assert(stage && !stage.cancelled && !stage.timedOut && stage.cleanup?.status === 'passed', 'Local executor failed or was cancelled');
      if (receipt.status === 'passed') passed.push(key);
      else if (task.calibration && !task.required && receipt.status === 'failed'
        && receipt.stages.prepare.status === 'passed' && receipt.stages.cleanup.status === 'passed'
        && actual.get(`native-assets/${task.variant}/native-load`)?.status === 'passed') {
        calibration.push({ key, failures: receipt.failures });
      } else failed.push({ key, reason: receipt.status, failures: receipt.failures });
    } catch (error) { failed.push({ key, reason: error.message }); }
  }
  if (plan.tasks.some(task => task.job === 'package-clean')) {
    try {
      const candidate = path.resolve(resultsRoot, '../gate-transfer/release-candidate');
      const packageReceipt = await readJSON(path.join(candidate, 'package-receipt.json'));
      await verifyPackageFiles(packageReceipt, plan, candidate);
      for (const task of plan.tasks.filter(task => ['packaged-host', 'installed-pair'].includes(task.job))) {
        assert(actual.get(taskKey(task))?.consumed.some(item => item.kind === 'package-receipt'
          && item.sha256 === objectDigest(packageReceipt)), 'Consumer used a different candidate pair');
      }
    } catch (error) { errors.push({ key: 'package-clean', reason: error.message }); }
  }
  return { schemaVersion: 1, mode: plan.mode, inputSHA: plan.inputSHA, planDigest: objectDigest(plan),
    source: 'local-process', acceptance: false, status: !failed.length && !notRun.length && !errors.length ? 'passed' : 'failed',
    required: plan.tasks.filter(task => task.required).map(taskKey), actual: [...actual.keys()],
    passed, failed, notRun, calibration, errors, archives,
    firstFailure: errors[0] ?? failed[0] ?? notRun[0] ?? null };
}

export async function runLocalCLI(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { mode: { type: 'string', default: 'pr' }, plan: { type: 'string' },
    ref: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' }, version: { type: 'string' },
    'trigger-tag': { type: 'string' }, output: { type: 'string' }, case: { type: 'string' },
    payload: { type: 'string', default: 'source' }, reason: { type: 'string' },
    diagnose: { type: 'boolean' }, full: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('ci:verify -- --mode pr|release-pr|release-tag [--full] [--plan <file>] [--ref <40位SHA> --base <SHA>] [--output <目录>]\n'
      + 'ci:diagnose -- --case <case> --payload source|packaged --reason <原因> --ref <SHA> [--output <目录>]\n'
      + '本地使用冻结输入和同一任务图；外平台缺失明确记 not-run。完整跨平台验收由 Actions 执行。');
    return;
  }
  assertFormalEnvironment();
  assert.equal(process.versions.node, environmentPolicy.node, 'Use the fixed gate Node version');
  const root = process.cwd(), mode = values.diagnose ? 'diagnostic' : values.mode;
  assert(['pr', 'release-pr', 'release-tag', 'diagnostic'].includes(mode), 'This local runner cannot deliver channels');
  const diagnostic = mode === 'diagnostic' ? { case: values.case, payload: values.payload, reason: values.reason } : undefined;
  assert(diagnostic || !values.case && !values.reason, 'Formal verification rejects case selection');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const originMain = git(['rev-parse', 'origin/main']);
  const suppliedPlan = values.plan ? validateFrozenPlan(await readJSON(values.plan)) : undefined;
  const ref = values.ref ?? suppliedPlan?.inputSHA ?? git(['rev-parse', 'HEAD']);
  const head = values.head ?? suppliedPlan?.headSHA ?? ref;
  const base = values.base ?? suppliedPlan?.baseSHA ?? (ref === originMain ? git(['rev-parse', `${ref}^1`]) : originMain);
  const output = values.output ? path.resolve(values.output) : await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-gate-evidence-'));
  assert(output !== root && !output.startsWith(`${root}${path.sep}`), 'Evidence must be outside the source checkout');
  await fs.mkdir(output, { recursive: true });
  assert.equal((await fs.readdir(output)).length, 0, 'Evidence output must be fresh');
  console.log(`本地 CI 证据：${output}`);
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-local-gate-'));
  const checkout = path.join(privateRoot, 'repo');
  let inputSHA = ref, plan, failure, unsettled = false;
  const observeSettlement = result => {
    // A cancelled outer runner cannot establish that its detached Host children
    // stopped. Preserve the checkout until their original scopes are observable.
    unsettled ||= result.timedOut || result.cancelled || result.residualGroup || result.drainTimedOut
      || result.cleanup?.status !== 'passed' || Boolean(result.pid && !result.exited);
    return result;
  };
  try {
    execFileSync('git', ['clone', '--no-hardlinks', '--no-checkout', root, checkout], { stdio: 'pipe' });
    inputSHA = freezeLocalInput(checkout, { mode, ref, base, head, originMain });
    execFileSync('git', ['checkout', '--detach', inputSHA], { cwd: checkout, stdio: 'pipe' });
    plan = suppliedPlan ?? await resolvePlan({ root: checkout,
      mode, inputSHA, baseSHA: base, headSHA: head, version: values.version, triggerTag: values['trigger-tag'],
      run: { id: `local-${randomUUID()}`, attempt: 1, headSHA: inputSHA }, diagnostic, full: Boolean(values.full), env: {} });
    assert.equal(plan.inputSHA, inputSHA); assert.equal(plan.headSHA, head); assert.equal(plan.baseSHA, base);
    assert(String(plan.run.id).startsWith('local-'), 'Local execution cannot impersonate an Actions attempt');
    assert(mode === 'pr' ? ['pr', 'release-pr'].includes(plan.mode) : plan.mode === mode, 'Supplied plan mode differs');
    if (diagnostic) assert.deepEqual(plan.diagnostic, diagnostic, 'Supplied diagnostic selection differs');
    assertCheckout(plan, checkout);
    const planFile = path.join(checkout, 'gate-plan/gate-plan.json');
    await writeJSON(planFile, plan); await writeJSON(path.join(output, 'gate-plan.json'), plan);
    for (const directory of ['home', 'config', 'cache', 'tmp']) await fs.mkdir(path.join(privateRoot, directory));
    for (const name of ['user.npmrc', 'global.npmrc']) await fs.writeFile(path.join(privateRoot, name), '');
    const env = npmLogEnvironment(isolatedEnvironment(privateRoot, planFile), path.join(output, 'npm-debug'));
    const npmEntry = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules' : '../lib/node_modules', 'npm/bin/npm-cli.js');
    assert((await fs.stat(npmEntry)).isFile(), 'The fixed Node distribution must supply npm');
    const dependencyProfile = dependencyProfileForTasks(plan.tasks);
    const installArgs = dependencyInstallArgs(dependencyProfile);
    const install = observeSettlement(await runProcess(process.execPath, [npmEntry, ...installArgs], {
      cwd: checkout, env, deadline: Date.now() + infrastructureBudgets.install, logPath: path.join(output, 'install.log') }));
    await writeJSON(path.join(output, 'install.json'), { ...install, profile: dependencyProfile, args: installArgs });
    const receipts = new Map(), stages = [], resultsRoot = path.join(checkout, 'gate-results');
    let browserPreparation, nativeExecutable, nativeFailure;
    for (const stage of localStageGraph(plan)) {
      let unavailable = unsettled ? 'Original local executor has not settled; further checkout use refused'
        : install.status !== 'passed' ? 'Locked dependency installation failed'
        : unavailableDependency({ ...stage, plan }, receipts);
      const target = (stage.job === 'installed-pair' ? installedTargets : nativeTargets).find(target => target.variant === stage.variant);
      if (['native-assets', 'installed-pair'].includes(stage.job)
        && (target.platform !== process.platform || target.arch !== process.arch)) unavailable = 'Foreign native runner unavailable on this machine';
      if (stage.job === 'webview-visual' && process.env.ImageOS !== 'ubuntu22') unavailable = 'Fixed Ubuntu22.04 visual runner unavailable locally';
      if (!unavailable && stage.job === 'native-assets' && !nativeExecutable && !nativeFailure) {
        try { nativeExecutable = await ensureNodeToolchain(environmentPolicy.nativeNode, path.join(privateRoot, 'toolchains'),
          Date.now() + infrastructureBudgets.download); }
        catch (error) { nativeFailure = error.message; }
      }
      if (stage.job === 'native-assets' && nativeFailure) unavailable = nativeFailure;
      if (!unavailable && ['regression', 'webview-function', 'webview-visual', 'marketplace-browser'].includes(stage.job)) {
        if (!browserPreparation) {
          browserPreparation = observeSettlement(await runProcess(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium'], {
            cwd: checkout, env, deadline: Date.now() + infrastructureBudgets.download, logPath: path.join(output, 'browser-install.log') }));
          await writeJSON(path.join(output, 'browser-install.json'), browserPreparation);
        }
        if (browserPreparation.status !== 'passed') unavailable = 'Fixed browser acquisition failed';
      }
      if (unavailable) {
        for (const task of stage.tasks) receipts.set(taskKey(task), await markNotRun(plan, task, resultsRoot, unavailable));
        stages.push({ job: stage.job, variant: stage.variant, status: 'not-run', reason: unavailable });
        continue;
      }
      const command = ['scripts/gates/run-stage.mjs', '--plan', planFile, '--job', stage.job, '--variant', stage.variant, '--output', 'gate-results'];
      if (['webview-function', 'webview-visual', 'marketplace-browser'].includes(stage.job)) command.push('--browser-input', 'gate-transfer/browser-bundle');
      if (['source-host', 'marketplace-host'].includes(stage.job)) command.push('--source-input', 'gate-transfer/source-bundle');
      if (['packaged-host', 'installed-pair'].includes(stage.job)) command.push('--candidate', 'gate-transfer/release-candidate');
      if (['source-build', 'package-clean'].includes(stage.job)) command.push('--archives', 'gate-transfer/native-archive');
      if (stage.job === 'native-assets') command.push('--assets', path.join(privateRoot, 'native', stage.variant));
      const executable = stage.job === 'native-assets' ? nativeExecutable : process.execPath;
      const stageEnv = { ...env, PATH: `${path.dirname(executable)}${path.delimiter}${env.PATH ?? ''}` };
      const observed = observeSettlement(await runProcess(executable, command, { cwd: checkout, env: stageEnv,
        deadline: Date.now() + stage.tasks.reduce((sum, task) => sum + task.timeoutMs, 0) + infrastructureBudgets.evidence,
        logPath: path.join(output, `${stage.job}-${stage.variant}.log`) }));
      stages.push({ job: stage.job, variant: stage.variant, ...observed });
      for (const receipt of await loadReceipts(resultsRoot)) {
        receipts.set(`${receipt.job}/${receipt.variant}/${receipt.taskID}`, receipt);
        unsettled ||= receipt.failures.some(failure => /did not settle|has not settled|cleanup refused/u.test(failure.reason));
      }
    }
    const result = await localEvidence(plan, await loadReceipts(resultsRoot), stages, resultsRoot, output);
    await writeJSON(path.join(output, mode === 'diagnostic' ? 'diagnostic-result.json' : 'gate-result.json'), result);
    if (result.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    failure = error;
    await writeJSON(path.join(output, 'local-failure.json'), { schemaVersion: 1, inputSHA, acceptance: false, reason: error.message });
  } finally {
    try {
      await preserveAndRetireLocalCheckout({ privateRoot, checkout, output, inputSHA, plan,
        original: { unsettled: unsettled || failure?.unsettled === true } });
    } catch (error) {
      failure ??= error;
      const resultFile = path.join(output, mode === 'diagnostic' ? 'diagnostic-result.json' : 'gate-result.json');
      const result = await readJSON(resultFile).catch(failure => { if (failure.code === 'ENOENT') return null; throw failure; });
      if (result) { result.status = 'failed'; result.errors.push({ key: 'local-cleanup', reason: error.message }); await writeJSON(resultFile, result); }
    }
  }
  if (failure) throw failure;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runLocalCLI().catch(error => { console.error(error.message); process.exitCode = 1; });
}
