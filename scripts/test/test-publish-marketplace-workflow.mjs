import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';

const workflowPath = '.github/workflows/publish-marketplace-release.yml';
const workflowText = await readFile(workflowPath, 'utf8');
yaml.load(workflowText);

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

console.log('publish-marketplace workflow tests passed');
