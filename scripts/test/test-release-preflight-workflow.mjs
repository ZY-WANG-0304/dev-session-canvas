import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';

const workflowPath = '.github/workflows/release-preflight.yml';
const workflowText = await readFile(workflowPath, 'utf8');
const workflow = yaml.load(workflowText);
const job = workflow.jobs['verify-release-contract'];
const resolveJob = workflow.jobs['resolve-release-input'];
const assetsJob = workflow.jobs['native-assets'];

assert.ok(job, 'release preflight workflow must define a release-contract verification job');
assert.match(workflowText, /^name: Release Preflight$/mu);
assert.match(workflowText, /pull_request:/u);
assert.doesNotMatch(workflowText, /^\s+paths:/mu, 'the required check must run on every PR, including non-release PRs');
assert.equal(job.if, '${{ always() && github.event.pull_request.draft == false }}');
assert.deepEqual(job.needs, ['resolve-release-input', 'native-assets']);
assert.equal(resolveJob.if, '${{ github.event.pull_request.draft == false }}');
assert.equal(job['timeout-minutes'], 90);
assert.equal(job['runs-on'], 'ubuntu-22.04', 'release visual verification must retain the baseline OS');
assert.equal(job.env.PLAYWRIGHT_BROWSERS_PATH, '${{ github.workspace }}/.playwright-browsers');
assert.equal(job.env.DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_VSCODE_E2E_HOST_TMP_ROOT, '/tmp/tm-${{ github.run_id }}');

const checkoutStep = resolveJob.steps.find((entry) => entry.name === 'Checkout PR merge result');
assert.ok(checkoutStep, 'workflow must validate the pull request merge result');
assert.equal(checkoutStep.uses, 'actions/checkout@v4');

const resolveStep = resolveJob.steps.find((entry) => entry.name === 'Resolve release contract version');
assert.ok(resolveStep, 'workflow must resolve the version from the changed release contract');
assert.match(resolveStep.run, /exactly one docs\/release-contracts\/vX\.Y\.Z\.md/u);
assert.match(resolveStep.run, /origin\/\$\{\{ github\.base_ref \}\}\.\.\.HEAD/u);
assert.match(resolveStep.run, /echo "is_release=false"/u);

const verifyStep = job.steps.find((entry) => entry.name === 'Verify release contract');
assert.ok(verifyStep, 'workflow must run the full release verification');
assert.equal(verifyStep.if, "needs.resolve-release-input.outputs.is_release == 'true'");
assert.equal(verifyStep.run, 'npm run release:verify -- --version "${{ needs.resolve-release-input.outputs.version }}"');
const browserInstall = job.steps.find(entry => entry.name === 'Install release verification browser');
assert(browserInstall, 'release verification needs Chromium before the early marketplace browser tests');
assert.equal(browserInstall.if, verifyStep.if, 'non-release PRs must not install browsers');
assert.equal(browserInstall.run, 'npx --no-install playwright install --with-deps chromium');
const dependencies = job.steps.find(entry => entry.name === 'Install dependencies');
assert(dependencies);
assert.equal(dependencies.run, 'npm ci', 'browser installation must use the lockfile-installed Playwright CLI');
assert(job.steps.indexOf(dependencies) < job.steps.indexOf(browserInstall));
assert(job.steps.indexOf(browserInstall) < job.steps.indexOf(verifyStep));
assert.equal(assetsJob.uses, './.github/workflows/runtime-execution-assets.yml');
assert.equal(assetsJob.if, "needs.resolve-release-input.outputs.is_release == 'true'");
assert.equal(assetsJob.with.input_ref, '${{ needs.resolve-release-input.outputs.input_ref }}');
const assembly = job.steps.find(entry => entry.name === 'Assemble same-ref native runtime assets');
assert(assembly);
assert(job.steps.indexOf(assembly) < job.steps.indexOf(verifyStep));
assert.match(assembly.run, /DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/);
assert.match(assembly.run, /--input-sha "\$\{\{ needs.resolve-release-input.outputs.input_ref \}\}"/);
const prerequisites = job.steps[0];
assert.match(prerequisites.run, /needs.resolve-release-input.result/);
assert.match(prerequisites.run, /needs.native-assets.result/);
assert.doesNotMatch(workflowText, /secrets\.|workflow_run|run-id:/);

console.log('release-preflight workflow tests passed');
