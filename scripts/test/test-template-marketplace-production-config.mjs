import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wranglerConfig = await readFile('apps/template-marketplace/wrangler.toml', 'utf8');
const appPackageJson = JSON.parse(await readFile('apps/template-marketplace/package.json', 'utf8'));
const rootPackageJson = JSON.parse(await readFile('package.json', 'utf8'));

assert.match(wranglerConfig, /^\[env\.preview\]$/m, 'Expected an explicit preview environment.');
assert.match(wranglerConfig, /^\[env\.production\]$/m, 'Expected an explicit production environment.');

const productionEnvBlock = extractBlock(wranglerConfig, '[env.production]');
assert.match(productionEnvBlock, /name = "dscanvas-template-marketplace-production"/u);
assert.match(productionEnvBlock, /workers_dev = false/u);
assert.match(productionEnvBlock, /preview_urls = false/u);
assert.match(productionEnvBlock, /dscanvas\.dev\/templates\*/u);
assert.match(productionEnvBlock, /dscanvas\.dev\/api\/\*/u);
assert.match(wranglerConfig, /\[version_metadata\]\s+binding = "VERSION_METADATA"/u);
assert.match(wranglerConfig, /\[env\.preview\.version_metadata\]\s+binding = "VERSION_METADATA"/u);
assert.match(wranglerConfig, /\[env\.production\.version_metadata\]\s+binding = "VERSION_METADATA"/u);

const productionD1Block = extractBlock(wranglerConfig, '[[env.production.d1_databases]]');
assert.match(productionD1Block, /binding = "MARKETPLACE_DB"/u);
assert.match(productionD1Block, /database_name = "template_marketplace_production"/u);
assert.doesNotMatch(productionD1Block, /template_marketplace_preview/u);
assert.doesNotMatch(productionD1Block, /0944dc87-a603-4a59-8a59-b75ab3a796c5/u);

const productionR2Block = extractBlock(wranglerConfig, '[[env.production.r2_buckets]]');
assert.match(productionR2Block, /binding = "TEMPLATE_BUCKET"/u);
assert.match(productionR2Block, /bucket_name = "template-marketplace-production"/u);
assert.doesNotMatch(productionR2Block, /template-marketplace-preview/u);

assert.equal(appPackageJson.scripts['db:migrate:production'], 'wrangler d1 execute template_marketplace_production --remote --env production --file=./migrations/0001_marketplace_core.sql');
assert.match(appPackageJson.scripts['db:verify:production'], /template_marketplace_production/u);
assert.match(appPackageJson.scripts['db:verify:production'], /--env production/u);
assert.equal(appPackageJson.scripts['deploy:preview'], 'npm run build && node scripts/deploy-with-metadata.mjs');
assert.equal(appPackageJson.scripts['deploy:production'], 'npm run build && node scripts/deploy-with-metadata.mjs --env production');
assert.equal(rootPackageJson.scripts['deploy:marketplace:production'], 'npm run -w @dev-session-canvas/template-marketplace deploy:production');
assert.equal(appPackageJson.scripts['db:seed:production'], undefined, 'Production must not have a seed script.');

const deployMetadataScript = await readFile('apps/template-marketplace/scripts/deploy-with-metadata.mjs', 'utf8');
assert.match(deployMetadataScript, /MARKETPLACE_GIT_SHA:/u);
assert.match(deployMetadataScript, /GITHUB_SHA/u);
assert.match(deployMetadataScript, /--keep-vars/u);
assert.match(deployMetadataScript, /run\('git', \['rev-parse', 'HEAD'\]/u);

console.log('template marketplace production config tests passed');

function extractBlock(source, header) {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `Missing TOML block ${header}.`);
  const next = source.slice(start + header.length).search(/\n\[/u);
  return next === -1
    ? source.slice(start)
    : source.slice(start, start + header.length + next);
}
