import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { environmentPolicy, infrastructureBudgets, evidenceLimits, policyVersion, taskCatalog, taskKey, nativeTargets, installedTargets, diagnosticTasks } from './catalog.mjs';
import { smokeCatalog } from '../smoke/smoke-catalog.mjs';
import { assertSHA, objectDigest, readJSON, validatePlan, writeJSON } from './receipts.mjs';
import { smokeBudgets, smokeBudgetInventory, verifySmokeBudgetSources } from '../smoke/smoke-budget.mjs';
import { readSmokeImplementationMap, smokeImplementationFile } from './smoke-implementation.mjs';

export const classificationRules = Object.freeze({
  documentation: ['docs/exec-plans/', 'docs/design-docs/', 'docs/references/', 'docs/workflows/',
    'docs/product-specs/', 'docs/generated/'],
  documentationFiles: ['AGENTS.md', 'ARCHITECTURE.md', 'docs/WORKFLOW.md', 'docs/PLANS.md',
    'docs/DESIGN.md', 'docs/UI.md', 'docs/FRONTEND.md', 'docs/PRODUCT_SENSE.md',
    'docs/QUALITY_SCORE.md', 'docs/RELIABILITY.md', 'docs/SECURITY.md'],
  functional: /^(extensions\/|packages\/|apps\/|scripts\/|tests\/|\.github\/|package(?:-lock)?\.json$|playwright\.config)/,
  artifact: /(?:^README|^CHANGELOG|^LICENSE|^PRIVACY|package(?:-lock)?\.json$|\.vscodeignore$|(?:^|\/)(?:images|resources|l10n)\/|scripts\/(?:build|release|gates)\/|\.github\/|^docs\/release-contracts\/)/
});
export function assertFormalEnvironment(env = process.env) {
  for (const key of Object.keys(env)) {
    if (env[key] === '' || env[key] === undefined) continue;
    if (/^DEV_SESSION_CANVAS_(?:SMOKE_SCENARIO(?:_FILTER)?$|SMOKE_SKIP|SKIP_SMOKE|EXECUTION_PROFILE|EXECUTION_ADMISSION|EXECUTION_ASSETS_SET|TEST_|RELEASE_TEST|RELEASE_MARKETPLACE|RUNTIME_HOST_BACKEND_OVERRIDE|VSCE_BASE_|VSCE_README|VSCODE_EXECUTABLE)/.test(key)) {
      throw new Error(`Formal gate rejects diagnostic/build override ${key}`);
    }
  }
  for (const key of ['NODE_OPTIONS', 'PW_TEST_GREP', 'PLAYWRIGHT_GREP', 'CI_GATE_FILTER', 'PWDEBUG',
    'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']) {
    if (env[key]) throw new Error(`Formal gate rejects ${key}`);
  }
}
export function classifyChanges(paths) {
  let functional = false, artifact = false;
  for (const file of paths) {
    assert.equal(typeof file, 'string'); assert(file && !file.startsWith('/') && !file.split('/').includes('..'));
    if (file.startsWith('docs/release-contracts/')) { functional = artifact = true; continue; }
    if (classificationRules.documentationFiles.includes(file)
      || classificationRules.documentation.some(prefix => file.startsWith(prefix))) continue;
    if (classificationRules.functional.test(file)) functional = true;
    if (classificationRules.artifact.test(file)) artifact = functional = true;
    if (!classificationRules.functional.test(file) && !classificationRules.artifact.test(file)) artifact = functional = true;
  }
  return { functional, artifact };
}
const policyData = () => ({ version: policyVersion, classification: {
  ...classificationRules, functional: classificationRules.functional.source, artifact: classificationRules.artifact.source
}, environment: environmentPolicy, budgets: infrastructureBudgets, evidenceLimits,
  browserCatalogue:JSON.parse(readFileSync(new URL('./browser-catalog.json',import.meta.url),'utf8')) });

export function freezeTasks(scope, diagnostic) {
  const catalog = taskCatalog(scope);
  if (diagnostic) for (const suite of smokeCatalog.filter(item => item.diagnosticOnly)) {
    catalog.push({ job: 'source-host', id: `smoke/${suite.id}`, variant: suite.variant, suite: suite.id,
      hostGroup: suite.group, stages: ['prepare', 'action', 'assert', 'cleanup', 'host-exit'], required: true });
  }
  return (diagnostic ? diagnosticTasks(catalog, diagnostic) : catalog).map(task => {
    const host = task.stages.includes('host-exit');
    const business = task.suite ? smokeBudgets[task.suite] : task.job === 'marketplace-host' ? smokeBudgets[task.id]
      : host ? 180000 : undefined;
    if (task.suite || task.job === 'marketplace-host') assert(Number.isSafeInteger(business) && business > 0,
      `No bounded suite inventory: ${task.suite ?? task.id}`);
    const timeoutMs = host ? infrastructureBudgets.hostStartup + business
      + infrastructureBudgets.hostExit + infrastructureBudgets.cleanup + infrastructureBudgets.evidence
      : task.id === 'package-clean' ? 1500000 : task.id === 'native-load' ? 1200000
        : task.id === 'native-operation' ? 180000 : task.job === 'regression' ? 300000
          : task.id === 'webview-functional' ? 3600000 : 600000;
    const cleanupMs = task.stages.includes('cleanup') ? infrastructureBudgets.cleanup : 0;
    const hostExitMs = host ? infrastructureBudgets.hostExit : 0;
    const evidenceMs = infrastructureBudgets.evidence;
    return { ...task, timeoutMs, budgets: { workMs: timeoutMs-cleanupMs-hostExitMs-evidenceMs,
      cleanupMs,hostExitMs,evidenceMs }, budgetGroup: taskKey(task),
      environment: task.job === 'native-assets' ? { ...environmentPolicy, node: environmentPolicy.nativeNode }
        : environmentPolicy };
  });
}
export function buildPlan({ mode, inputSHA, headSHA = inputSHA, baseSHA, version,
  changedPaths, run = { id: `local-${randomUUID()}`, attempt: 1, headSHA: inputSHA }, catalogDelta = [], diagnostic, full = false }) {
  assert(['pr', 'release-pr', 'release-tag', 'channel-retry', 'diagnostic', 'observational'].includes(mode));
  assertSHA(inputSHA); assertSHA(headSHA); assertSHA(baseSHA);
  assert(Array.isArray(changedPaths));
  assert(mode === 'diagnostic' || diagnostic === undefined, 'Formal mode cannot carry a diagnostic selection');
  assert.equal(typeof full, 'boolean');
  assert(!full || mode === 'pr', 'Only ordinary validation can request the broader full regression scope');
  const scope = mode === 'diagnostic' ? { functional: true, artifact: diagnostic?.payload === 'packaged', release: false }
    : ['release-pr', 'release-tag'].includes(mode) ? { functional: true, artifact: true, release: true }
      : full ? { functional: true, artifact: true, release: false }
        : { ...classifyChanges(changedPaths), release: false };
  const tasks = freezeTasks(scope, mode === 'diagnostic' ? diagnostic : undefined);
  if (mode === 'diagnostic') assert(diagnostic, 'A diagnostic plan requires an explicit selection');
  const plan = { schemaVersion: 1, mode, inputSHA, baseSHA, headSHA, version, run, full,
    policyVersion, policyDigest: objectDigest(policyData()),
    catalogDigest: objectDigest({ tasks: freezeTasks({ functional: true, artifact: true, release: true }),
      smokeImplementation: readSmokeImplementationMap() }),
    environmentDigest: objectDigest(environmentPolicy), budgetDigest: objectDigest({ infrastructureBudgets, smokeBudgetInventory }),
    scope, changedPaths: [...changedPaths].sort(), catalogDelta, tasks,
    ...(diagnostic ? { diagnostic } : {}) };
  return validatePlan(plan);
}
export function validateFrozenPlan(plan) {
  validatePlan(plan);
  const expected = buildPlan(plan);
  for (const field of ['policyVersion', 'policyDigest', 'catalogDigest', 'environmentDigest', 'budgetDigest', 'scope', 'tasks']) {
    assert.deepEqual(plan[field], expected[field], `Frozen plan ${field} differs from actual policy/catalogue`);
  }
  return plan;
}
export async function resolvePlan({ root = process.cwd(), mode = 'pr', inputSHA, baseSHA, headSHA,
  version, run, triggerTag, env = process.env, diagnostic, full = false }) {
  if (!['diagnostic', 'observational'].includes(mode)) assertFormalEnvironment(env);
  verifySmokeBudgetSources();
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  inputSHA ??= git(['rev-parse', 'HEAD']); baseSHA ??= git(['rev-parse', 'origin/main']); headSHA ??= inputSHA;
  for (const sha of [inputSHA, baseSHA, headSHA]) assertSHA(sha);
  assert.equal(git(['rev-parse', 'HEAD']), inputSHA, 'Checkout must be the frozen input');
  const parents = git(['show', '-s', '--format=%P', inputSHA]).split(' ');
  if (env.GITHUB_EVENT_NAME === 'pull_request' || ['pr','release-pr'].includes(mode) && headSHA !== inputSHA) {
    if (env.GITHUB_EVENT_NAME === 'pull_request') assert.equal(git(['rev-parse', `origin/${env.GITHUB_BASE_REF || 'main'}`]), baseSHA, 'Target branch advanced; regenerate the merge input');
    assert.deepEqual(parents, [baseSHA,headSHA],
      'PR validation requires the declared base/head pre-merge result');
  } else if (['pr','release-pr'].includes(mode)) {
    // A local head checkout is useful diagnostic input, but does not prove the
    // latest PR merge. Formal head==input is reserved for merged-main checks.
    assert.equal(git(['rev-parse', 'origin/main']), inputSHA, 'PR head alone is not a formal pre-merge input');
    execFileSync('git', ['merge-base', '--is-ancestor', baseSHA, inputSHA], { cwd: root });
  }
  const changedPaths = git(['diff', '--name-only', '--no-renames', baseSHA, inputSHA]).split('\n').filter(Boolean);
  const manifests = ['package.json', 'extensions/vscode/dev-session-canvas/package.json',
    'extensions/vscode/dev-session-canvas-notifier/package.json'];
  const current = await Promise.all(manifests.map(file => readJSON(path.join(root, file))));
  for (const item of current) assert.equal(item.version, current[0].version, 'Workspace extension versions differ');
  version ??= current[0].version;
  assert.equal(version, current[0].version, 'Requested version differs from immutable input');
  const contractChanges = changedPaths.filter(file => /^docs\/release-contracts\/v\d+\.\d+\.\d+\.md$/.test(file));
  const versionChanged = manifests.some((file, index) => {
    const previous = JSON.parse(git(['show', `${baseSHA}:${file}`]));
    return previous.version !== current[index].version;
  });
  if (mode === 'pr' && (versionChanged || contractChanges.length)) mode = 'release-pr';
  if (mode === 'release-pr') {
    assert.equal(contractChanges.length, 1, 'Release PR must change exactly one release contract');
    assert.equal(contractChanges[0], `docs/release-contracts/v${version}.md`);
    assert((await fs.stat(path.join(root, contractChanges[0]))).isFile(), 'Deleted release contract cannot downgrade the gate');
  }
  if (mode === 'release-tag') {
    const tag = triggerTag ?? env.GITHUB_REF_NAME;
    assert.equal(tag, `publish/v${version}`, 'Final validation requires the publish tag');
    assert.equal(git(['rev-parse', `${tag}^{commit}`]), inputSHA);
    execFileSync('git', ['merge-base', '--is-ancestor', inputSHA, 'origin/main'], { cwd: root });
  }
  const catalogFiles = ['scripts/gates/catalog.mjs', 'scripts/smoke/smoke-catalog.mjs',
    'scripts/gates/browser-catalog.json', smokeImplementationFile, 'scripts/smoke/remote-ssh-extension-inputs.json'];
  const catalogDelta = [];
  for (const file of catalogFiles) {
    let previous = null;
    try { previous = git(['show', `${baseSHA}:${file}`]); } catch { /* First implementation. */ }
    const contents = await fs.readFile(path.join(root, file), 'utf8');
    if (previous !== contents.trim()) catalogDelta.push({ file, baseDigest: previous === null ? null : objectDigest(previous),
      inputDigest: objectDigest(contents.trim()), reviewRequired: true });
  }
  return buildPlan({ mode, inputSHA, headSHA, baseSHA, version, changedPaths, catalogDelta, run, diagnostic,
    full: mode === 'pr' && full });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { mode: { type: 'string' }, sha: { type: 'string' },
    base: { type: 'string' }, head: { type: 'string' }, version: { type: 'string' }, output: { type: 'string' },
    'run-head': { type: 'string' }, 'trigger-tag': { type: 'string' } } });
  assert(values.output, 'Specify --output for the frozen plan');
  const plan = await resolvePlan({ mode: values.mode, inputSHA: values.sha, baseSHA: values.base,
    headSHA: values.head, version: values.version, triggerTag: values['trigger-tag'], run: process.env.GITHUB_RUN_ID ? {
      id: process.env.GITHUB_RUN_ID, attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      headSHA: values['run-head'] ?? process.env.GITHUB_SHA
    } : undefined });
  await writeJSON(values.output, plan);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,
    `mode=${plan.mode}\nversion=${plan.version}\ninput_sha=${plan.inputSHA}\nfunctional=${plan.scope.functional}\nartifact=${plan.scope.artifact}\nplan_digest=${objectDigest(plan)}\n`
    + Object.entries(planJobs(plan)).map(([job,data])=>`${job.replaceAll('-','_')}=${JSON.stringify(data)}\n`).join(''));
  console.log(JSON.stringify({ mode: plan.mode, scope: plan.scope, tasks: plan.tasks.length, catalogDelta: plan.catalogDelta }));
}

export function planJobs(plan) {
  const jobs = {};
  for (const task of plan.tasks) (jobs[task.job] ??= new Map()).set(task.variant,
    [...(jobs[task.job].get(task.variant) ?? []), task]);
  return Object.fromEntries(Object.entries(jobs).map(([job,variants]) => [job,{ include: [...variants].map(([variant,tasks]) => {
    const minutes = Math.ceil((tasks.reduce((total,task)=>total+task.timeoutMs,0)
      + infrastructureBudgets.install + infrastructureBudgets.download * 2 + infrastructureBudgets.evidence) / 60000);
    assert(minutes <= 360, `Job ${job}/${variant} exceeds the CI ceiling; split its cases rather than truncate the plan`);
    const target = (job === 'installed-pair' ? installedTargets : nativeTargets).find(item=>item.variant===variant);
    return { variant, timeout: minutes, ...(target ? target : { runner:'ubuntu-22.04' }) };
  }) }]));
}
