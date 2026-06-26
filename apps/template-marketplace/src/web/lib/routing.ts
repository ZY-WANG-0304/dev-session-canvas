const TEMPLATE_BASE_PATH = '/templates';
const TEMPLATE_PUBLISH_PATH = `${TEMPLATE_BASE_PATH}/publish`;
const TEMPLATE_PUBLISH_VERSION_PATH = `${TEMPLATE_PUBLISH_PATH}/version`;
const TEMPLATE_PUBLISH_SUCCESS_PATH = `${TEMPLATE_PUBLISH_PATH}/success`;
const TEMPLATE_ME_PATH = `${TEMPLATE_BASE_PATH}/me`;
const TEMPLATE_ADMIN_PATH = `${TEMPLATE_BASE_PATH}/admin`;

export function readTemplateSlugFromPath(pathname: string): string | undefined {
  if (pathname === TEMPLATE_BASE_PATH || pathname === `${TEMPLATE_BASE_PATH}/`) {
    return undefined;
  }
  if (isMarketplacePublishPath(pathname)) {
    return undefined;
  }
  if (isMarketplaceMePath(pathname)) {
    return undefined;
  }
  if (isMarketplaceAdminPath(pathname)) {
    return undefined;
  }
  if (!pathname.startsWith(`${TEMPLATE_BASE_PATH}/`)) {
    return undefined;
  }
  const slug = pathname.slice(TEMPLATE_BASE_PATH.length + 1).split('/')[0];
  return slug ? decodeURIComponent(slug) : undefined;
}

export function buildTemplateDetailHref(slug: string): string {
  return `${TEMPLATE_BASE_PATH}/${encodeURIComponent(slug)}`;
}

export function getMarketplaceHomeHref(): string {
  return `${TEMPLATE_BASE_PATH}/`;
}

export function getMarketplacePublishHref(): string {
  return TEMPLATE_PUBLISH_PATH;
}

export function buildMarketplacePublishSuccessHref(slug: string): string {
  const params = new URLSearchParams();
  params.set('template', slug);
  return `${TEMPLATE_PUBLISH_SUCCESS_PATH}?${params.toString()}`;
}

export function buildMarketplacePublishVersionHref(slug: string): string {
  const params = new URLSearchParams();
  params.set('template', slug);
  return `${TEMPLATE_PUBLISH_VERSION_PATH}?${params.toString()}`;
}

export function getMarketplaceMeHref(): string {
  return TEMPLATE_ME_PATH;
}

export function getMarketplaceAdminHref(): string {
  return TEMPLATE_ADMIN_PATH;
}

export function buildGithubSignInHref(returnTo: string): string {
  const params = new URLSearchParams();
  params.set('return_to', returnTo);
  return `/api/v1/auth/github/start?${params.toString()}`;
}

export function buildSignOutHref(returnTo: string): string {
  const params = new URLSearchParams();
  params.set('return_to', returnTo);
  return `/api/v1/auth/logout?${params.toString()}`;
}

export function isMarketplacePublishPath(pathname: string): boolean {
  return pathname === TEMPLATE_PUBLISH_PATH || pathname === `${TEMPLATE_PUBLISH_PATH}/` || pathname.startsWith(`${TEMPLATE_PUBLISH_PATH}/`);
}

export function isMarketplacePublishVersionPath(pathname: string): boolean {
  return pathname === TEMPLATE_PUBLISH_VERSION_PATH || pathname === `${TEMPLATE_PUBLISH_VERSION_PATH}/`;
}

export function isMarketplacePublishSuccessPath(pathname: string): boolean {
  return pathname === TEMPLATE_PUBLISH_SUCCESS_PATH || pathname === `${TEMPLATE_PUBLISH_SUCCESS_PATH}/`;
}

export function readPublishVersionTemplateSlug(search: string): string | undefined {
  const slug = new URLSearchParams(search).get('template')?.trim();
  return slug ? slug : undefined;
}

export function isMarketplaceMePath(pathname: string): boolean {
  return pathname === TEMPLATE_ME_PATH || pathname === `${TEMPLATE_ME_PATH}/`;
}

export function isMarketplaceAdminPath(pathname: string): boolean {
  return pathname === TEMPLATE_ADMIN_PATH || pathname === `${TEMPLATE_ADMIN_PATH}/`;
}
