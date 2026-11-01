import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ordinaryDocumentation, classifyImpact } from './scope-policy.mjs';
import { changedFiles, checkDocumentation } from './check-documentation.mjs';
import { assertSHA, digest, objectDigest, readJSON, writeJSON } from './receipts.mjs';

export const trustedPolicyPaths = ['scripts/gates/', '.github/workflows/release-preflight.yml', '.github/workflows/ci-validation.yml', '.github/workflows/ci-observations.yml'];
export const reuseLifetimeMs = 24 * 60 * 60 * 1000;
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export function assertMergeInput({ root, input, base, head }) {
  for (const sha of [input, base, head]) assertSHA(sha);
  assert.equal(git(root, ['rev-parse', 'HEAD']), input, 'Control checkout changed');
  if (input !== head) assert.deepEqual(git(root, ['show', '-s', '--format=%P', input]).split(' '), [base, head], 'Not the actual base/head merge');
  else git(root, ['merge-base', '--is-ancestor', base, input]);
}
export function policyUnchanged(root, base, input) {
  return git(root, ['diff', '--name-only', base, input, '--', ...trustedPolicyPaths]) === '';
}
function ensureCommit(root, sha) {
  assertSHA(sha);
  try { git(root, ['cat-file', '-e', `${sha}^{commit}`]); }
  catch { git(root, ['fetch', '--no-tags', 'origin', sha]); }
}
export function effectiveTree(root, sha) {
  assertSHA(sha);
  const records = execFileSync('git', ['ls-tree', '-r', '-z', sha], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  // Include modes/types/object IDs. A symlink named *.md is never inert prose.
  return records.filter(record => {
    const [metadata, file] = record.split('\t');
    return !metadata.startsWith('100644 blob ') || !ordinaryDocumentation(file);
  }).sort();
}
export function validateReuseCandidate({ root, current, previous, run, repository, pr, now = Date.now() }) {
  assert.equal(previous.mode, 'pr', 'Only ordinary PR results may be reused');
  assert.equal(current.mode, 'pr');
  assert.equal(previous.baseSHA, current.baseSHA, 'Target branch changed');
  assert.notEqual(previous.headSHA, current.headSHA, 'Reuse requires a prior head');
  git(root, ['merge-base', '--is-ancestor', previous.headSHA, current.headSHA]);
  assert.deepEqual(git(root, ['show', '-s', '--format=%P', previous.inputSHA]).split(' '), [previous.baseSHA, previous.headSHA]);
  assert.equal(run.event, 'pull_request'); assert.equal(run.path, '.github/workflows/release-preflight.yml');
  assert.equal(run.repository?.full_name, repository); assert.equal(run.head_repository?.full_name, repository);
  assert(run.pull_requests?.some(item => item.number === pr), 'Run is not from this PR');
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  assert.equal(run.head_sha, previous.run.headSHA); assert.equal(run.id, Number(previous.run.id));
  assert.equal(run.run_attempt, previous.run.attempt, 'Attempt changed');
  const completed = Date.parse(run.updated_at);
  assert(Number.isFinite(completed) && now >= completed && now - completed <= reuseLifetimeMs, 'Reuse evidence is stale');
  if (!policyUnchanged(root, current.baseSHA, current.inputSHA)) {
    // A PR changing the gate must first obtain its complete legacy acceptance.
    // A later prose-only update may reuse that exact, unchanged tested gate;
    // it must not reduce the required set using the new selector.
    assert.equal(previous.selection, undefined, 'Gate changes need a prior full execution');
    assert.equal(current.selection, undefined, 'Gate changes cannot self-select a reduced scope');
  }
  for (const key of ['policyDigest', 'catalogDigest', 'environmentDigest', 'budgetDigest']) assert.equal(previous[key], current[key], `${key} changed`);
  assert.deepEqual(previous.tasks, current.tasks, 'Required task selection changed');
  assert.deepEqual(effectiveTree(root, previous.inputSHA), effectiveTree(root, current.inputSHA), 'Effective inputs changed');
  const delta = changedFiles(root, previous.inputSHA, current.inputSHA);
  assert(delta.length && delta.every(ordinaryDocumentation), 'Not an ordinary documentation follow-up');
  return { previousInput: previous.inputSHA, previousHead: previous.headSHA, sourceRun: previous.run,
    effectiveInputDigest: digest(effectiveTree(root, current.inputSHA).join('\0')), documentationDelta: delta };
}
export function githubAPI(repository, token = process.env.GH_TOKEN) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository));
  return async route => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000)
    });
    assert(response.ok, `GitHub ${route}: ${response.status}`); return response.json();
  };
}
async function currentPlan({ root, input, base, head, run, selection }) {
  const { resolvePlan } = await import('./resolve-plan.mjs');
  return resolvePlan({ root, inputSHA: input, baseSHA: base, headSHA: head, run, selection });
}
async function assertCurrentPR(api, pr, base, head) {
  if (!pr) return;
  const current = await api(`pulls/${pr}`);
  assert.equal(current.state, 'open'); assert.equal(current.head.sha, head, 'PR head advanced');
  assert.equal(current.base.sha, base, 'Target branch advanced');
}
export async function prepareMerge({ root = process.cwd(), input, base, head, pr, repository, run,
  output, api = githubAPI(repository), checkAcceptance, now = Date.now() }) {
  assertMergeInput({ root, input, base, head }); await assertCurrentPR(api, pr, base, head);
  const paths = changedFiles(root, base, input), impact = classifyImpact(paths);
  const trusted = policyUnchanged(root, base, input);
  const selection = trusted ? 'affected' : undefined;
  const documentation = checkDocumentation({ root, paths, base });
  const control = { schemaVersion: 1, kind: 'merge-control', input, base, head, pr: pr ?? null, repository, run,
    route: 'execute', selection: selection ?? '', impact, documentation, reuse: null, reuseMisses: [] };
  if (trusted && impact.domains.every(domain => domain === 'documentation')) {
    // Check declared doc files are regular Git blobs before excluding them.
    const delta = git(root, ['diff', '--raw', base, input]);
    if (!/(?:120000|160000)/.test(delta)) control.route = 'documentation';
  }
  if (control.route === 'execute' && pr) {
    const plan = await currentPlan({ root, input, base, head, run, selection });
    if (plan.mode === 'pr') {
      try {
        // Find completed runs on this branch, never reuse a current incomplete
        // attempt or a successful lightweight/reuse-only run recursively.
        const current = await api(`pulls/${pr}`);
        const response = await api(`actions/workflows/release-preflight.yml/runs?event=pull_request&branch=${encodeURIComponent(current.head.ref)}&per_page=20`);
        for (const candidate of response.workflow_runs.filter(item => item.id !== Number(run.id) && item.status === 'completed' && item.conclusion === 'success').slice(0, 5)) {
          try {
            const source = await api(`actions/runs/${candidate.id}`);
            assert(source.head_sha !== run.headSHA && source.event === 'pull_request' && source.status === 'completed' && source.conclusion === 'success');
            assert(source.pull_requests?.some(item => item.number === pr));
            assert(now - Date.parse(source.updated_at) <= reuseLifetimeMs, 'Original run is stale');
            const checker = checkAcceptance ?? (await import('./check-acceptance.mjs')).checkGitHubAcceptance;
            const verified = await checker({ repository, run: { id: String(source.id), attempt: source.run_attempt, headSHA: source.head_sha },
              output: path.join(output, 'source', String(source.id)) });
            ensureCommit(root, verified.plan.inputSHA);
            const equivalence = validateReuseCandidate({ root, current: plan, previous: verified.plan, run: source, repository, pr, now });
            const checked = await readJSON(path.join(output, 'source', String(source.id), 'checked-acceptance.json'));
            control.route = 'reuse';
            control.reuse = { ...equivalence, artifactID: checked.artifactID, verifierJobID: checked.verifierJobID,
              acceptanceDigest: checked.acceptanceDigest, currentPlanDigest: objectDigest(plan) };
            break;
          } catch (error) { control.reuseMisses.push({ runID: candidate.id, reason: error.message }); }
        }
      } catch (error) { control.reuseMisses.push({ reason: error.message }); }
    }
  }
  await writeJSON(path.join(output, 'merge-control.json'), control); return control;
}
export async function verifyMerge({ root = process.cwd(), control, output, api = githubAPI(control.repository), checkAcceptance }) {
  assert.equal(control.kind, 'merge-control'); assertMergeInput({ root, input: control.input, base: control.base, head: control.head });
  await assertCurrentPR(api, control.pr, control.base, control.head);
  const paths = changedFiles(root, control.base, control.input), documentation = checkDocumentation({ root, paths, base: control.base });
  assert.deepEqual(control.impact, classifyImpact(paths));
  assert.equal(control.selection, policyUnchanged(root, control.base, control.input) ? 'affected' : '');
  let evidence;
  if (control.route === 'documentation') {
    assert(control.selection === 'affected' && paths.every(ordinaryDocumentation));
    assert(!/(?:120000|160000)/.test(git(root, ['diff', '--raw', control.base, control.input])));
    evidence = { execution: 'not-applicable', reason: 'ordinary-documentation-only' };
  } else {
    const checker = checkAcceptance ?? (await import('./check-acceptance.mjs')).checkGitHubAcceptance;
    const plan = await currentPlan({ root, input: control.input, base: control.base, head: control.head, run: control.run, selection: control.selection || undefined });
    if (control.route === 'reuse') {
      const source = await api(`actions/runs/${control.reuse.sourceRun.id}`);
      const verified = await checker({ repository: control.repository, run: control.reuse.sourceRun, output: path.join(output, 'verified-source') });
      ensureCommit(root, verified.plan.inputSHA);
      const equivalence = validateReuseCandidate({ root, current: plan, previous: verified.plan, run: source, repository: control.repository, pr: control.pr });
      const checked = await readJSON(path.join(output, 'verified-source', 'checked-acceptance.json'));
      assert.equal(checked.artifactID, control.reuse.artifactID); assert.equal(checked.verifierJobID, control.reuse.verifierJobID);
      assert.equal(checked.acceptanceDigest, control.reuse.acceptanceDigest);
      assert.equal(objectDigest(plan), control.reuse.currentPlanDigest);
      evidence = { execution: 'reused', ...equivalence, artifactID: checked.artifactID };
    } else {
      assert.equal(control.route, 'execute');
      const verified = await checker({ repository: control.repository, run: control.run, inputSHA: control.input,
        baseSHA: control.base, headSHA: control.head, output: path.join(output, 'executed') });
      assert.equal(objectDigest(verified.plan), objectDigest(plan)); evidence = { execution: 'executed', run: control.run, tasks: plan.tasks.length };
    }
  }
  const result = { schemaVersion: 1, kind: 'merge-verification', status: 'passed', input: control.input, base: control.base,
    head: control.head, run: control.run, documentation, evidence, observation: 'independent-check-not-awaited' };
  await writeJSON(path.join(output, 'merge-verification.json'), result); return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { command: { type: 'string' }, input: { type: 'string' }, base: { type: 'string' },
    head: { type: 'string' }, pr: { type: 'string' }, output: { type: 'string' }, control: { type: 'string' } } });
  const repository = process.env.GITHUB_REPOSITORY, api = githubAPI(repository);
  const actual = await api(`actions/runs/${process.env.GITHUB_RUN_ID}`);
  const run = { id: process.env.GITHUB_RUN_ID, attempt: Number(process.env.GITHUB_RUN_ATTEMPT), headSHA: actual.head_sha };
  assert(values.output);
  if (values.command === 'inspect') {
    assertMergeInput({ root: process.cwd(), ...values });
    const paths = changedFiles(process.cwd(), values.base, values.input);
    const lightweight = policyUnchanged(process.cwd(), values.base, values.input) && paths.every(ordinaryDocumentation)
      && !/(?:120000|160000)/.test(git(process.cwd(), ['diff', '--raw', values.base, values.input]));
    await fs.appendFile(process.env.GITHUB_OUTPUT, `dependencies=${!lightweight}\n`);
  } else if (values.command === 'prepare') {
    const result = await prepareMerge({ ...values, pr: values.pr ? Number(values.pr) : undefined, repository, run, api });
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `route=${result.route}\nselection=${result.selection}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## 合并验证计划\n\n执行方式：${result.route}；范围：${result.impact.domains.join(', ')}。\n\n${result.reuse ? `复用原 run ${result.reuse.sourceRun.id}，保留原执行身份。` : '当前输入独立验证；稳定性观察在独立检查中展示。'}\n`);
  } else {
    assert.equal(values.command, 'verify'); const control = await readJSON(values.control);
    assert.deepEqual(control.run, run, 'Control belongs to another run/attempt');
    await verifyMerge({ control, output: values.output, api });
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## 合并门禁通过\n\n当前 head：${control.head}；执行方式：${control.route}。\n\n非阻塞观察独立展示，未完成或失败不冒称通过。\n`);
  }
}
