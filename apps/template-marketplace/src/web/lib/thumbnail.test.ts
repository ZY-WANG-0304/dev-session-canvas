import { describe, expect, it } from 'vitest';

import { buildTemplateThumbnailHref } from './thumbnail';

describe('marketplace thumbnail links', () => {
  it('targets the Worker thumbnail API with an explicit version id', () => {
    expect(
      buildTemplateThumbnailHref({
        slug: 'review-loop',
        latestVersion: { id: 'ver-review-loop-2' }
      })
    ).toBe('/api/v1/templates/review-loop/thumbnail?version=ver-review-loop-2');
  });

  it('encodes slug and version path/query components', () => {
    expect(
      buildTemplateThumbnailHref({
        slug: 'unsafe/template',
        latestVersion: { id: 'version with spaces' }
      })
    ).toBe('/api/v1/templates/unsafe%2Ftemplate/thumbnail?version=version+with+spaces');
  });
});
