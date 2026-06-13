import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';

const workflowPath = '.github/workflows/publish-marketplace-release.yml';
const workflowText = await readFile(workflowPath, 'utf8');
const workflow = yaml.load(workflowText);
const steps = workflow.jobs.publish.steps;
const step = (name) => {
  const found = steps.find((entry) => entry.name === name);
  assert.ok(found, `workflow must define step: ${name}`);
  return found;
};

const safeLookup = 'local_ref="$(git rev-parse --verify --quiet "$final_tag^{}" 2>/dev/null || true)"';
const unsafeLookup = 'local_ref="$(git rev-parse "$final_tag^{}" 2>/dev/null || true)"';

assert.ok(
  workflowText.includes(safeLookup),
  'final tag lookup must stay silent and empty when the tag is absent'
);
assert.ok(
  !workflowText.includes(unsafeLookup),
  'plain git rev-parse writes unresolved revisions to stdout for absent tags'
);
assert.match(
  workflowText,
  /if \[\[ -z "\$local_ref" \]\]; then\n\s+git tag "\$final_tag" "\$release_ref"/u,
  'workflow must create the final tag when the optional lookup is empty'
);

const missingTagName = `workflow-missing-final-tag-${process.pid}-${Date.now()}`;
const missingTagProbe = spawnSync(
  'bash',
  [
    '-lc',
    `set -euo pipefail
final_tag=${missingTagName}
release_ref="$(git rev-parse HEAD)"
local_ref="$(git rev-parse --verify --quiet "$final_tag^{}" 2>/dev/null || true)"
if [[ -n "$local_ref" && "$local_ref" != "$release_ref" ]]; then
  echo "unexpected mismatch: $local_ref" >&2
  exit 42
fi
if [[ -z "$local_ref" ]]; then
  echo "missing-final-tag-ok"
fi`
  ],
  { encoding: 'utf8' }
);
assert.equal(missingTagProbe.status, 0, missingTagProbe.stderr || missingTagProbe.stdout);
assert.match(missingTagProbe.stdout, /missing-final-tag-ok/u);

const detectAssetsStep = step('Detect existing GitHub Release assets');
assert.equal(detectAssetsStep.id, 'existing_assets');
assert.match(
  detectAssetsStep.run,
  /gh api "repos\/\{owner\}\/\{repo\}\/releases\/tags\/\$final_tag" > "\$release_json"/u,
  'workflow must inspect an existing GitHub Release before packaging'
);
assert.match(
  detectAssetsStep.run,
  /echo "mode=reuse" >> "\$GITHUB_OUTPUT"/u,
  'workflow must mark complete existing Release assets for reuse'
);
assert.match(
  detectAssetsStep.run,
  /echo "mode=package" >> "\$GITHUB_OUTPUT"/u,
  'workflow must only package when no GitHub Release exists yet'
);
assert.match(
  detectAssetsStep.run,
  /Refusing to repackage or clobber release assets for an existing release/u,
  'workflow must fail instead of repackaging over an incomplete existing Release'
);

const downloadAssetsStep = step('Download existing GitHub Release assets');
assert.equal(downloadAssetsStep.if, "steps.existing_assets.outputs.mode == 'reuse'");
assert.match(
  downloadAssetsStep.run,
  /gh release download "\$final_tag"/u,
  'reruns must download the existing Release assets'
);
assert.match(
  downloadAssetsStep.run,
  /mv "\$tmpdir\/\$notifier_name" "\$notifier_vsix"/u,
  'downloaded notifier asset basename must be restored to its nested local VSIX path'
);

const validateAssetsStep = step('Validate existing GitHub Release assets');
assert.equal(validateAssetsStep.id, 'validate_existing_assets');
assert.equal(validateAssetsStep.if, "steps.existing_assets.outputs.mode == 'reuse'");
assert.equal(
  validateAssetsStep.run,
  'npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --skip-package --package-only',
  'existing Release assets must be checksum-validated before marketplace reruns'
);

const packageStep = step('Package release artifacts');
assert.equal(
  packageStep.if,
  "steps.existing_assets.outputs.mode == 'package'",
  'workflow must not repackage once a complete GitHub Release asset batch exists'
);

const releaseAssetsStep = step('Create or update GitHub Release assets');
assert.equal(
  releaseAssetsStep.if,
  "steps.existing_assets.outputs.mode == 'package'",
  'workflow must not clobber VSIX Release assets on reruns that reuse an existing batch'
);

const finalTagStep = step('Create final release tag');
assert.equal(
  finalTagStep.id,
  'final_tag',
  'final tag step must expose its outcome for safe final manifest uploads'
);

const finalManifestStep = step('Upload final release manifest');
assert.match(
  finalManifestStep.if,
  /steps\.validate_existing_assets\.outcome == 'success'/u,
  'final manifest upload must still run after reusing and validating existing assets'
);
assert.match(
  finalManifestStep.if,
  /steps\.final_tag\.outcome == 'success'/u,
  'final manifest upload must not run if the final tag was not created or verified'
);

console.log('publish-marketplace workflow tests passed');
