import { describe, expect, it } from 'vitest';

import { buildTemplateDownloadHref, buildTemplateJsonExportHref } from './download';

describe('marketplace download links', () => {
  it('targets the Worker download API with an explicit version id', () => {
    expect(
      buildTemplateDownloadHref({
        slug: 'review-loop',
        latestVersion: { id: 'ver-review-loop-1' }
      })
    ).toBe('/api/v1/templates/review-loop/download?version=ver-review-loop-1');
  });

  it('targets the lightweight template JSON export API with an explicit version id', () => {
    expect(
      buildTemplateJsonExportHref({
        slug: 'review-loop',
        latestVersion: { id: 'ver-review-loop-1' }
      })
    ).toBe('/api/v1/templates/review-loop/template.json?version=ver-review-loop-1');
  });

  it('encodes slug and version path/query components', () => {
    expect(
      buildTemplateDownloadHref({
        slug: 'unsafe/template',
        latestVersion: { id: 'version with spaces' }
      })
    ).toBe('/api/v1/templates/unsafe%2Ftemplate/download?version=version+with+spaces');
    expect(
      buildTemplateJsonExportHref({
        slug: 'unsafe/template',
        latestVersion: { id: 'version with spaces' }
      })
    ).toBe('/api/v1/templates/unsafe%2Ftemplate/template.json?version=version+with+spaces');
  });
});
