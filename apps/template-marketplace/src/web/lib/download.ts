export interface TemplateDownloadTarget {
  slug: string;
  latestVersion: {
    id: string;
  };
}

export function buildTemplateDownloadHref(template: TemplateDownloadTarget): string {
  const params = new URLSearchParams({ version: template.latestVersion.id });
  return `/api/v1/templates/${encodeURIComponent(template.slug)}/download?${params.toString()}`;
}

export function buildTemplatePackageDownloadHref(template: TemplateDownloadTarget): string {
  const params = new URLSearchParams({ version: template.latestVersion.id });
  return `/api/v1/templates/${encodeURIComponent(template.slug)}/package?${params.toString()}`;
}
