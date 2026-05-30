import { describe, expect, it } from 'vitest';

import { buildTemplateDownloadHref, buildTemplatePackageDownloadHref } from './download';

describe('marketplace download links', () => {
  it('targets the Worker download API with an explicit version id', () => {
    expect(
      buildTemplateDownloadHref({
        slug: 'review-loop',
        latestVersion: { id: 'ver-review-loop-1' }
      })
    ).toBe('/api/v1/templates/review-loop/download?version=ver-review-loop-1');
  });

  it('targets the Worker package download API with an explicit version id', () => {
    expect(
      buildTemplatePackageDownloadHref({
        slug: 'review-loop',
        latestVersion: { id: 'ver-review-loop-1' }
      })
    ).toBe('/api/v1/templates/review-loop/package?version=ver-review-loop-1');
  });

  it('encodes slug and version path/query components', () => {
    expect(
      buildTemplateDownloadHref({
        slug: 'unsafe/template',
        latestVersion: { id: 'version with spaces' }
      })
    ).toBe('/api/v1/templates/unsafe%2Ftemplate/download?version=version+with+spaces');
    expect(
      buildTemplatePackageDownloadHref({
        slug: 'unsafe/template',
        latestVersion: { id: 'version with spaces' }
      })
    ).toBe('/api/v1/templates/unsafe%2Ftemplate/package?version=version+with+spaces');
  });
});
