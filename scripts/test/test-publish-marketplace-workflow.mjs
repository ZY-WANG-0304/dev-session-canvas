import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

const workflowPath = '.github/workflows/publish-marketplace-release.yml';
const workflowText = await readFile(workflowPath, 'utf8');
const workflow = yaml.load(workflowText);
const job = (name) => {
  const found = workflow.jobs[name];
  assert.ok(found, `workflow must define job: ${name}`);
  return found;
};
const step = (jobName, name) => {
  const found = job(jobName).steps.find((entry) => entry.name === name);
  assert.ok(found, `workflow job ${jobName} must define step: ${name}`);
  return found;
};

const prepareJob = job('prepare');
const openVsxJob = job('publish-open-vsx');
const visualStudioJob = job('publish-visual-studio');
const finalizeJob = job('finalize');

assert.deepEqual(Object.keys(workflow.jobs), ['prepare', 'publish-open-vsx', 'publish-visual-studio', 'finalize']);
assert.match(
  workflowText,
  /concurrency:\n\s+group: marketplace-release-/u,
  'workflow must keep release concurrency at workflow level'
);

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

const detectAssetsStep = step('prepare', 'Detect existing GitHub Release assets');
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

const downloadAssetsStep = step('prepare', 'Download existing GitHub Release assets');
assert.equal(downloadAssetsStep.if, "steps.existing_assets.outputs.mode == 'reuse'");
assert.match(downloadAssetsStep.run, /gh release download "\$final_tag"/u);
assert.match(downloadAssetsStep.run, /mv "\$tmpdir\/\$notifier_name" "\$notifier_vsix"/u);

const validateAssetsStep = step('prepare', 'Validate existing GitHub Release assets');
assert.equal(validateAssetsStep.id, 'validate_existing_assets');
assert.equal(validateAssetsStep.if, "steps.existing_assets.outputs.mode == 'reuse'");
assert.equal(
  validateAssetsStep.run,
  'npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --skip-package --package-only',
  'existing Release assets must be checksum-validated before marketplace reruns'
);

assert.equal(
  step('prepare', 'Package release artifacts').if,
  "steps.existing_assets.outputs.mode == 'package'",
  'workflow must not repackage once a complete GitHub Release asset batch exists'
);
assert.equal(
  step('prepare', 'Create or update GitHub Release assets').if,
  "steps.existing_assets.outputs.mode == 'package'",
  'workflow must not clobber VSIX Release assets on reruns that reuse an existing batch'
);
assert.equal(step('prepare', 'Create final release tag').id, 'final_tag');

const releaseNotesStep = step('prepare', 'Write GitHub release notes');
assert.match(releaseNotesStep.run, /node scripts\/release\/write-github-release-notes\.mjs/u);
assert.doesNotMatch(releaseNotesStep.run, /This release publishes Dev Session Canvas/u);
assert.ok(workflowText.includes('Update GitHub Release notes for reused assets'));

const artifactNamePattern = /\bname:\s+(prepared-release|marketplace-result-open-vsx|marketplace-result-visual-studio|marketplace-release)-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/gu;
const artifactNames = [...workflowText.matchAll(artifactNamePattern)].map((match) => match[1]);
assert.deepEqual(
  artifactNames,
  [
    'prepared-release',
    'prepared-release',
    'marketplace-result-open-vsx',
    'prepared-release',
    'marketplace-result-visual-studio',
    'prepared-release',
    'marketplace-result-open-vsx',
    'marketplace-result-visual-studio',
    'marketplace-release'
  ],
  'all upload/download artifact names must include run_attempt so GitHub reruns do not collide with previous attempts'
);
assert.doesNotMatch(
  workflowText,
  /\bname:\s+(prepared-release|marketplace-result-open-vsx|marketplace-result-visual-studio|marketplace-release)-\$\{\{ github\.run_id \}\}(?!-\$\{\{ github\.run_attempt \}\})/u,
  'artifact names must not use run_id alone'
);

assert.deepEqual(openVsxJob.needs, 'prepare');
assert.deepEqual(visualStudioJob.needs, 'prepare');
assert.notDeepEqual(openVsxJob.needs, ['publish-visual-studio']);
assert.notDeepEqual(visualStudioJob.needs, ['publish-open-vsx']);
assert.equal(openVsxJob.outputs.status, "${{ steps.publish.outputs.status || steps.verify_secret.outputs.status || '1' }}");
assert.equal(visualStudioJob.outputs.status, "${{ steps.publish.outputs.status || steps.verify_secret.outputs.status || '1' }}");

const openVsxMarketplaceStep = step('publish-open-vsx', 'Publish and verify Open VSX');
assert.equal(openVsxMarketplaceStep.id, 'publish');
assert.match(openVsxMarketplaceStep.run, /--target open-vsx --no-create-final-tag/u);
assert.match(openVsxMarketplaceStep.run, /echo "status=\$status" >> "\$GITHUB_OUTPUT"/u);

const visualStudioMarketplaceStep = step('publish-visual-studio', 'Publish and verify Visual Studio Marketplace');
assert.equal(visualStudioMarketplaceStep.id, 'publish');
assert.match(visualStudioMarketplaceStep.run, /--target visual-studio --no-create-final-tag/u);
assert.match(visualStudioMarketplaceStep.run, /echo "status=\$status" >> "\$GITHUB_OUTPUT"/u);

assert.deepEqual(finalizeJob.needs, ['prepare', 'publish-open-vsx', 'publish-visual-studio']);
assert.equal(finalizeJob.if, "always() && needs.prepare.result == 'success'");

const mergeStep = step('finalize', 'Merge marketplace manifests');
assert.match(mergeStep.run, /find marketplace-results\/open-vsx -type f -name "release-manifest-\$version\.json"/u);
assert.match(mergeStep.run, /marketplaceComplete = openStatus === "0" && visualStatus === "0"/u);
assert.match(mergeStep.run, /manifest.status = marketplaceComplete \? "complete" : "publish-failed"/u);
assert.match(mergeStep.run, /manifest.selectedTargets = \["visual-studio", "open-vsx"\]/u);

const updateReleaseStep = step('finalize', 'Update GitHub Release manifest and notes');
assert.match(updateReleaseStep.run, /write-github-release-notes\.mjs/u);
assert.match(updateReleaseStep.run, /--method PATCH "repos\/\{owner\}\/\{repo\}\/releases\/\$release_id"/u);
assert.match(updateReleaseStep.run, /gh release upload "\$final_tag" "\$manifest_path" --clobber/u);

const deleteTagStep = step('finalize', 'Delete temporary publish tag');
assert.equal(
  deleteTagStep.if,
  "env.OPEN_VSX_STATUS == '0' && env.VISUAL_STUDIO_STATUS == '0' && env.OPEN_VSX_RESULT == 'success' && env.VISUAL_STUDIO_RESULT == 'success'",
  'temporary tag must only be deleted when both marketplace targets succeeded'
);

const failStep = step('finalize', 'Fail when marketplace publish failed');
assert.equal(
  failStep.if,
  "env.OPEN_VSX_STATUS != '0' || env.VISUAL_STUDIO_STATUS != '0' || env.OPEN_VSX_RESULT != 'success' || env.VISUAL_STUDIO_RESULT != 'success'",
  'workflow must fail if either marketplace target failed, after uploading final Release state'
);

const notesTempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-release-notes-'));
try {
  const currentVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
  const notesManifestPath = path.join(notesTempDir, 'manifest.json');
  const notesOutputPath = path.join(notesTempDir, 'notes.md');
  await writeFile(
    notesManifestPath,
    `${JSON.stringify(
      {
        version: currentVersion,
        releaseRef: '0123456789abcdef0123456789abcdef01234567',
        triggerTag: `publish/v${currentVersion}`,
        finalTag: `v${currentVersion}`,
        githubRelease: {
          status: 'assets-uploaded'
        },
        tags: {
          triggerTagStatus: 'kept'
        },
        marketplaces: {
          visualStudio: {
            main: {
              status: 'publish-failed',
              version: currentVersion
            },
            notifier: {
              status: 'pending-verification',
              version: currentVersion
            }
          },
          openVsx: {
            main: {
              status: 'verified',
              version: currentVersion
            },
            notifier: {
              status: 'verified',
              version: currentVersion
            }
          }
        },
        artifacts: [
          {
            extension: 'main',
            path: `dev-session-canvas-${currentVersion}.vsix`,
            sha256: 'main-sha'
          },
          {
            extension: 'notifier',
            path: `extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-${currentVersion}.vsix`,
            sha256: 'notifier-sha'
          }
        ]
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  const notesResult = spawnSync(
    process.execPath,
    [
      'scripts/release/write-github-release-notes.mjs',
      '--version',
      currentVersion,
      '--manifest',
      notesManifestPath,
      '--output',
      notesOutputPath
    ],
    { encoding: 'utf8' }
  );
  assert.equal(notesResult.status, 0, notesResult.stderr || notesResult.stdout);
  const notes = await readFile(notesOutputPath, 'utf8');
  assert.match(notes, /## 版本亮点/u);
  assert.match(notes, /## 渠道状态/u);
  assert.match(notes, /## 残余风险/u);
  assert.match(notes, /Visual Studio Marketplace\/main=publish-failed/u);
  assert.match(notes, /Release ref/u);
} finally {
  await rm(notesTempDir, { recursive: true, force: true });
}

console.log('publish-marketplace workflow tests passed');
