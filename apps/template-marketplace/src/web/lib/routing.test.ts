import { describe, expect, it } from 'vitest';

import { buildTemplateDetailHref, getMarketplaceHomeHref, readTemplateSlugFromPath } from './routing';

describe('marketplace web routing', () => {
  it('reads template slugs from /templates detail paths', () => {
    expect(readTemplateSlugFromPath('/templates/review-loop')).toBe('review-loop');
    expect(readTemplateSlugFromPath('/templates/review%20loop')).toBe('review loop');
  });

  it('treats root and marketplace index paths as the list route', () => {
    expect(readTemplateSlugFromPath('/')).toBeUndefined();
    expect(readTemplateSlugFromPath('/templates')).toBeUndefined();
    expect(readTemplateSlugFromPath('/templates/')).toBeUndefined();
  });

  it('builds canonical marketplace hrefs', () => {
    expect(getMarketplaceHomeHref()).toBe('/templates');
    expect(buildTemplateDetailHref('review-loop')).toBe('/templates/review-loop');
  });
});
