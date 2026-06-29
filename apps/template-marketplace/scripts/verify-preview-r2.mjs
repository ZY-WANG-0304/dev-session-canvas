import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  appRootDir,
  assertLocalObjectsMatchExpected,
  calculateFileDigest,
  previewR2BucketName,
  previewTemplateObjects
} from './preview-r2-objects.mjs';

assertLocalObjectsMatchExpected();

const tempDir = mkdtempSync(join(tmpdir(), 'template-marketplace-r2-'));

try {
  for (const object of previewTemplateObjects) {
    const outputFile = join(tempDir, object.key.replace(/[^a-zA-Z0-9.-]/g, '_'));
    runWrangler(['r2', 'object', 'get', `${previewR2BucketName}/${object.key}`, '--file', outputFile, '--remote']);
    const actual = calculateFileDigest(outputFile);
    if (actual.sha256 !== object.sha256 || actual.sizeBytes !== object.sizeBytes) {
      throw new Error(
        `Remote object ${object.key} does not match expected digest. ` +
          `Expected ${object.sizeBytes}/${object.sha256}, got ${actual.sizeBytes}/${actual.sha256}.`
      );
    }
    console.log(`verified ${object.key} ${actual.sizeBytes} ${actual.sha256}`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
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
