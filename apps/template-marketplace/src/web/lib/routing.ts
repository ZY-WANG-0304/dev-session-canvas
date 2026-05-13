const TEMPLATE_BASE_PATH = '/templates';

export function readTemplateSlugFromPath(pathname: string): string | undefined {
  if (pathname === TEMPLATE_BASE_PATH || pathname === `${TEMPLATE_BASE_PATH}/`) {
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
  return TEMPLATE_BASE_PATH;
}
