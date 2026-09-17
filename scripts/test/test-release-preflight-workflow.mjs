import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';

const workflowPath = '.github/workflows/release-preflight.yml';
const workflowText = await readFile(workflowPath, 'utf8');
const workflow = yaml.load(workflowText);
const job = workflow.jobs['verify-release-contract'];

assert.ok(job, 'release preflight workflow must define a release-contract verification job');
assert.match(workflowText, /^name: Release Preflight$/mu);
assert.match(workflowText, /pull_request:/u);
assert.doesNotMatch(workflowText, /^\s+paths:/mu, 'the required check must run on every PR, including non-release PRs');
assert.equal(job.if, '${{ github.event.pull_request.draft == false }}');
assert.equal(job['timeout-minutes'], 90);

const checkoutStep = job.steps.find((entry) => entry.name === 'Checkout PR merge result');
assert.ok(checkoutStep, 'workflow must validate the pull request merge result');
assert.equal(checkoutStep.uses, 'actions/checkout@v4');

const resolveStep = job.steps.find((entry) => entry.name === 'Resolve release contract version');
assert.ok(resolveStep, 'workflow must resolve the version from the changed release contract');
assert.match(resolveStep.run, /exactly one docs\/release-contracts\/vX\.Y\.Z\.md/u);
assert.match(resolveStep.run, /origin\/\$\{\{ github\.base_ref \}\}\.\.\.HEAD/u);
assert.match(resolveStep.run, /echo "is_release=false"/u);

const verifyStep = job.steps.find((entry) => entry.name === 'Verify release contract');
assert.ok(verifyStep, 'workflow must run the full release verification');
assert.equal(verifyStep.if, "steps.contract.outputs.is_release == 'true'");
assert.equal(verifyStep.run, 'npm run release:verify -- --version "${{ steps.contract.outputs.version }}"');

console.log('release-preflight workflow tests passed');
