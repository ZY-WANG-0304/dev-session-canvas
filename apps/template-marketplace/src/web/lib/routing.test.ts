import { describe, expect, it } from 'vitest';

import {
  buildMarketplacePublishSuccessHref,
  buildMarketplacePublishVersionHref,
  buildGithubSignInHref,
  buildSignOutHref,
  buildTemplateDetailHref,
  getMarketplaceAdminHref,
  getMarketplaceHomeHref,
  getMarketplaceMeHref,
  getMarketplacePublishHref,
  isMarketplaceAdminPath,
  isMarketplaceMePath,
  isMarketplacePublishPath,
  isMarketplacePublishVersionPath,
  isMarketplacePublishSuccessPath,
  readPublishVersionTemplateSlug,
  readTemplateSlugFromPath
} from './routing';

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

  it('keeps the publish path out of template detail slug routing', () => {
    expect(readTemplateSlugFromPath('/templates/publish')).toBeUndefined();
    expect(readTemplateSlugFromPath('/templates/publish/success')).toBeUndefined();
    expect(readTemplateSlugFromPath('/templates/publish/version')).toBeUndefined();
    expect(isMarketplacePublishPath('/templates/publish')).toBe(true);
    expect(isMarketplacePublishSuccessPath('/templates/publish/success')).toBe(true);
    expect(isMarketplacePublishVersionPath('/templates/publish/version')).toBe(true);
    expect(readPublishVersionTemplateSlug('?template=review-loop')).toBe('review-loop');
  });

  it('keeps the publisher dashboard path out of template detail slug routing', () => {
    expect(readTemplateSlugFromPath('/templates/me')).toBeUndefined();
    expect(isMarketplaceMePath('/templates/me')).toBe(true);
  });

  it('keeps the admin path out of template detail slug routing', () => {
    expect(readTemplateSlugFromPath('/templates/admin')).toBeUndefined();
    expect(isMarketplaceAdminPath('/templates/admin')).toBe(true);
  });

  it('builds canonical marketplace hrefs', () => {
    expect(getMarketplaceHomeHref()).toBe('/templates/');
    expect(getMarketplacePublishHref()).toBe('/templates/publish');
    expect(buildMarketplacePublishSuccessHref('review-loop')).toBe('/templates/publish/success?template=review-loop');
    expect(buildMarketplacePublishVersionHref('review-loop')).toBe('/templates/publish/version?template=review-loop');
    expect(getMarketplaceMeHref()).toBe('/templates/me');
    expect(getMarketplaceAdminHref()).toBe('/templates/admin');
    expect(buildTemplateDetailHref('review-loop')).toBe('/templates/review-loop');
    expect(buildGithubSignInHref('/templates/publish')).toBe('/api/v1/auth/github/start?return_to=%2Ftemplates%2Fpublish');
    expect(buildSignOutHref('/templates/me')).toBe('/api/v1/auth/logout?return_to=%2Ftemplates%2Fme');
  });
});
