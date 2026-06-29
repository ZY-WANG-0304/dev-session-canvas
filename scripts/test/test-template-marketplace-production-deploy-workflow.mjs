import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';

const workflowPath = '.github/workflows/template-marketplace-production-deploy.yml';
const workflowText = await readFile(workflowPath, 'utf8');
const workflow = yaml.load(workflowText);

const job = workflow.jobs?.['deploy-production'];
assert.ok(job, 'workflow must define the deploy-production job');
assert.deepEqual(Object.keys(workflow.jobs), ['deploy-production']);

assert.match(workflowText, /tags:\n\s+- 'deploy\/template-marketplace\/prod\/\*'/u, 'workflow must trigger from production deploy tags');
assert.match(
  workflowText,
  /group: template-marketplace-production-\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.deploy_tag \|\| github\.ref_name \}\}/u,
  'workflow must serialize runs per deploy tag'
);
assert.equal(workflow.permissions.contents, 'read', 'production deploy workflow only needs read access to repository contents');
assert.equal(job['timeout-minutes'], 90, 'production deploy should have a bounded timeout');
assert.equal(job.env.CLOUDFLARE_API_TOKEN, '${{ secrets.CLOUDFLARE_API_TOKEN }}');
assert.equal(job.env.CLOUDFLARE_ACCOUNT_ID, '${{ secrets.CLOUDFLARE_ACCOUNT_ID || vars.CLOUDFLARE_ACCOUNT_ID }}');
assert.equal(job.env.CLOUDFLARE_ZONE_NAME, 'dscanvas.dev');
assert.equal(job.env.MARKETPLACE_PRODUCTION_BASE_URL, "${{ vars.MARKETPLACE_PRODUCTION_BASE_URL || 'https://dscanvas.dev' }}");

const step = (name) => {
  const found = job.steps.find((entry) => entry.name === name);
  assert.ok(found, `workflow must define step: ${name}`);
  return found;
};

const metadataStep = step('Derive deploy metadata');
assert.equal(metadataStep.id, 'metadata');
assert.match(
  metadataStep.run,
  /\^deploy\/template-marketplace\/prod\/\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\\\.\[0-9\]\+\$/u,
  'workflow must reject non-production deploy tag names'
);
assert.match(metadataStep.run, /deployment-artifacts\/template-marketplace-production-\$\{deploy_suffix\}\.json/u);

const checkoutStep = step('Checkout deploy tag');
assert.equal(checkoutStep.uses, 'actions/checkout@v4');
assert.equal(checkoutStep.with.ref, 'refs/tags/${{ env.TRIGGER_TAG }}');
assert.equal(checkoutStep.with['fetch-depth'], 0);

const resolveStep = step('Resolve deploy ref');
assert.equal(resolveStep.id, 'ref');
assert.match(resolveStep.run, /git fetch --no-tags origin '\+refs\/heads\/main:refs\/remotes\/origin\/main'/u);
assert.match(resolveStep.run, /git merge-base --is-ancestor "\$deploy_ref" origin\/main/u, 'deploy tag must point to a commit contained in main');
assert.match(resolveStep.run, /echo "DEPLOY_GIT_SHA=\$deploy_ref" >> "\$GITHUB_ENV"/u);

const installStep = step('Install dependencies');
assert.equal(installStep.id, 'install');
assert.equal(installStep.run, 'npm ci');

const deploySecretsStep = step('Verify Cloudflare deploy secrets');
assert.equal(deploySecretsStep.id, 'verify_deploy_secrets');
assert.match(deploySecretsStep.run, /CLOUDFLARE_API_TOKEN/u);
assert.match(deploySecretsStep.run, /CLOUDFLARE_ACCOUNT_ID/u);

const workerSecretsStep = step('Verify production Worker runtime secrets');
assert.equal(workerSecretsStep.id, 'verify_worker_secrets');
assert.match(workerSecretsStep.run, /wrangler --cwd apps\/template-marketplace secret list --env production --format json/u);
assert.match(workerSecretsStep.run, /trap 'rm -f deployment-artifacts\/worker-secrets\.json' EXIT/u);
for (const secretName of [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'MARKETPLACE_SESSION_SECRET',
  'MARKETPLACE_TOKEN_SECRET',
  'MARKETPLACE_ADMIN_GITHUB_IDS'
]) {
  assert.match(workerSecretsStep.run, new RegExp(secretName, 'u'));
}
assert.match(workerSecretsStep.run, /rm -f deployment-artifacts\/worker-secrets\.json/u, 'workflow must not upload Worker secret names as artifacts');

const dnsStep = step('Ensure production DNS record');
assert.equal(dnsStep.id, 'ensure_dns');
assert.match(dnsStep.run, /\/zones\?name=\$\{encodeURIComponent\(zoneName\)\}/u);
assert.match(dnsStep.run, /\/dns_records\?name=\$\{encodeURIComponent\(hostname\)\}&per_page=100/u);
assert.match(dnsStep.run, /record\.proxied/u, 'workflow must require a proxied production DNS record');
assert.match(dnsStep.run, /Refusing to rewrite existing origin DNS/u, 'workflow must not rewrite existing non-proxied origin DNS automatically');
assert.match(dnsStep.run, /type: 'A'/u);
assert.match(dnsStep.run, /content: '192\.0\.2\.1'/u);
assert.match(dnsStep.run, /proxied: true/u);
assert.ok(
  job.steps.indexOf(dnsStep) < job.steps.indexOf(step('Run production smoke')),
  'workflow must ensure production DNS before smoke checks'
);

const playwrightStep = step('Install Playwright browsers');
assert.equal(playwrightStep.id, 'install_playwright');
assert.equal(playwrightStep.run, 'npx playwright install --with-deps chromium');
assert.ok(
  job.steps.indexOf(playwrightStep) < job.steps.indexOf(step('Run marketplace test suite')),
  'workflow must install Playwright browsers before running marketplace E2E tests'
);

assert.equal(step('Run marketplace test suite').run, 'npm run test:marketplace');
assert.equal(step('Run production config check').run, 'npm run test:marketplace-production-config');
assert.equal(step('Run production D1 migration').run, 'npm run -w @dev-session-canvas/template-marketplace db:migrate:production');
assert.equal(step('Verify production D1 data').run, 'npm run -w @dev-session-canvas/template-marketplace db:verify:production');

const deployStep = step('Deploy production Worker');
assert.equal(deployStep.id, 'deploy');
assert.equal(deployStep['continue-on-error'], true, 'deploy failures should still produce deployment artifacts');
assert.match(deployStep.run, /deploy:production --/u);
assert.match(deployStep.run, /--git-sha "\$DEPLOY_GIT_SHA"/u);
assert.match(deployStep.run, /--message "Template marketplace production deploy \$TRIGGER_TAG \(\$DEPLOY_GIT_SHA\)"/u);

const cloudflareStep = step('Capture Cloudflare deployment metadata');
assert.equal(cloudflareStep.id, 'cloudflare');
assert.equal(cloudflareStep.if, "always() && steps.deploy.outcome != 'skipped'");
assert.equal(cloudflareStep['continue-on-error'], true, 'metadata capture should not prevent manifest creation');
assert.match(cloudflareStep.run, /wrangler --cwd apps\/template-marketplace deployments list --env production --json/u);
assert.match(cloudflareStep.run, /wrangler --cwd apps\/template-marketplace versions list --env production --json/u);
assert.match(cloudflareStep.run, /deploymentMessage = `Template marketplace production deploy \$\{process\.env\.TRIGGER_TAG\} \(\$\{process\.env\.DEPLOY_GIT_SHA\}\)`/u);
assert.match(cloudflareStep.run, /annotations\?\.\['workers\/message'\] === deploymentMessage/u);
assert.match(cloudflareStep.run, /toSorted\(byCreatedDesc\)\[0\]/u, 'workflow must not assume Wrangler deployment list is newest first');
assert.doesNotMatch(cloudflareStep.run, /const deployment = deployments\[0\]/u, 'workflow must select the current deployment instead of the first listed deployment');
assert.match(cloudflareStep.run, /cloudflare_deployment_id=\$\{deployment\.id\}/u);
assert.match(cloudflareStep.run, /cloudflare_version_id=\$\{versionId\}/u);

const smokeStep = step('Run production smoke');
assert.equal(smokeStep.id, 'smoke');
assert.equal(smokeStep.if, "always() && steps.deploy.outcome != 'skipped'");
assert.equal(smokeStep['continue-on-error'], true, 'smoke failures should still be recorded in the deployment manifest');
assert.match(smokeStep.run, /GET \/api\/v1\/meta/u);
assert.match(smokeStep.run, /meta\.gitSha !== deployGitSha/u);
assert.match(smokeStep.run, /meta\.storageMode !== 'd1'/u);
assert.match(smokeStep.run, /githubOAuthConfigured/u);
assert.match(smokeStep.run, /vscodeAuthExchangeConfigured/u);
assert.match(smokeStep.run, /GET \/api\/v1\/templates/u);
assert.match(smokeStep.run, /GET \/templates/u);
assert.match(smokeStep.run, /production-smoke\.json/u);

const manifestStep = step('Write deployment manifest');
assert.equal(manifestStep.if, 'always()');
assert.match(manifestStep.run, /service: 'template-marketplace'/u);
assert.match(manifestStep.run, /environment: 'production'/u);
assert.match(manifestStep.run, /deployTag: process\.env\.TRIGGER_TAG/u);
assert.match(manifestStep.run, /cloudflareDeploymentId/u);
assert.match(manifestStep.run, /smoke: process\.env\.SMOKE_OUTCOME === 'success' \? 'passed' : 'failed'/u);
assert.doesNotMatch(manifestStep.run, /worker-secrets\.json/u, 'deployment manifest must not include Worker secret inventory');

const uploadStep = step('Upload deployment artifacts');
assert.equal(uploadStep.if, 'always()');
assert.equal(uploadStep.uses, 'actions/upload-artifact@v4');
assert.equal(uploadStep.with.path, 'deployment-artifacts/');
assert.equal(uploadStep.with.overwrite, true);
assert.match(uploadStep.with.name, /template-marketplace-production-deployment-/u);

const failStep = step('Fail production deploy when required checks failed');
assert.equal(
  failStep.if,
  "always() && (steps.deploy.outcome != 'success' || steps.cloudflare.outcome != 'success' || steps.smoke.outcome != 'success')",
  'workflow must fail if deploy, Cloudflare metadata capture, or production smoke fails'
);

console.log('template marketplace production deploy workflow tests passed');
