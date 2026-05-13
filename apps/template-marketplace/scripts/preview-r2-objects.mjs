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
    key: 'templates/tmpl-getting-started/versions/1/thumbnail.png',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-getting-started/versions/1/thumbnail.png'),
    contentType: 'image/png',
    sha256: '454d6e9225cb01987cbcc0211f54519c359c44adcd42bf1ecb6ae7e6903bccf3',
    sizeBytes: 48922
  },
  {
    key: 'templates/tmpl-review-loop/versions/1/template.json',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-review-loop/versions/1/template.json'),
    contentType: 'application/json',
    sha256: '005e90644dae8084a612d6a9d2e198508618eaa792648eb19bc56113cbcc4e92',
    sizeBytes: 1897
  },
  {
    key: 'templates/tmpl-review-loop/versions/1/thumbnail.png',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-review-loop/versions/1/thumbnail.png'),
    contentType: 'image/png',
    sha256: '60a83bd7100cbbb8bab14867ce38b837cffddbf57edc42bc5aef34567d8b709c',
    sizeBytes: 43053
  },
  {
    key: 'templates/tmpl-review-loop/versions/2/template.json',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-review-loop/versions/2/template.json'),
    contentType: 'application/json',
    sha256: 'd74f3887ad39c05912629b771635bf8c3e110a498a559ec6b56d8aee390e8ead',
    sizeBytes: 2470
  },
  {
    key: 'templates/tmpl-review-loop/versions/2/thumbnail.png',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-review-loop/versions/2/thumbnail.png'),
    contentType: 'image/png',
    sha256: '3157578492cccc717eb9275fd92ced163acc5ed1c467039d223f0d182329b6fd',
    sizeBytes: 53548
  },
  {
    key: 'templates/tmpl-release-readiness/versions/1/template.json',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-release-readiness/versions/1/template.json'),
    contentType: 'application/json',
    sha256: 'e63a9f3666284df207184414a75afb1a86f6536a53668279fe825577a400bef0',
    sizeBytes: 2045
  },
  {
    key: 'templates/tmpl-release-readiness/versions/1/thumbnail.png',
    file: resolve(appRootDir, 'fixtures/r2/templates/tmpl-release-readiness/versions/1/thumbnail.png'),
    contentType: 'image/png',
    sha256: '76b80d6197d7847d1cb81db1701e31d9ad7ef3c5cbb9be5f8f5b07f54c920138',
    sizeBytes: 43145
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
    if (object.contentType === 'application/json') {
      JSON.parse(readFileSync(object.file, 'utf8'));
    }
  }
}
