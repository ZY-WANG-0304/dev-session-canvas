import { spawnSync } from 'node:child_process';

import { appRootDir, assertLocalObjectsMatchExpected, previewR2BucketName, previewTemplateObjects } from './preview-r2-objects.mjs';

assertLocalObjectsMatchExpected();

for (const object of previewTemplateObjects) {
  runWrangler(['r2', 'object', 'delete', `${previewR2BucketName}/${object.key}`, '--remote']);
  runWrangler([
    'r2',
    'object',
    'put',
    `${previewR2BucketName}/${object.key}`,
    '--file',
    object.file,
    '--content-type',
    object.contentType,
    '--remote',
    '--force'
  ]);
}

function runWrangler(args) {
  const result = spawnSync('wrangler', args, {
    cwd: appRootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}
