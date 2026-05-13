import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const previewR2BucketName = 'template-marketplace-preview';

export const previewTemplateObjects = [
  {
    key: 'templates/tmpl-getting-started/versions/1/template.json',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-getting-started/versions/1/template.json'),
    contentType: 'application/json',
    sha256: '031e1f491c5e7b4b39c3c2a84dcf2d81e9833bad6228e32fa8f710dfccc00a7e',
    sizeBytes: 1497
  },
  {
    key: 'templates/tmpl-review-loop/versions/1/template.json',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-review-loop/versions/1/template.json'),
    contentType: 'application/json',
    sha256: '005e90644dae8084a612d6a9d2e198508618eaa792648eb19bc56113cbcc4e92',
    sizeBytes: 1897
  },
  {
    key: 'templates/tmpl-release-readiness/versions/1/template.json',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-release-readiness/versions/1/template.json'),
    contentType: 'application/json',
    sha256: 'e63a9f3666284df207184414a75afb1a86f6536a53668279fe825577a400bef0',
    sizeBytes: 2045
  }
];

export function calculateFileDigest(file) {
  const buffer = readFileSync(file);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    sizeBytes: buffer.byteLength
  };
}

export function assertLocalObjectsMatchExpected() {
  for (const object of previewTemplateObjects) {
    const actual = calculateFileDigest(object.file);
    if (actual.sha256 !== object.sha256 || actual.sizeBytes !== object.sizeBytes) {
      throw new Error(
        `Fixture ${object.file} does not match expected digest. ` +
          `Expected ${object.sizeBytes}/${object.sha256}, got ${actual.sizeBytes}/${actual.sha256}.`
      );
    }
    JSON.parse(readFileSync(object.file, 'utf8'));
  }
}
