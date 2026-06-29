export interface TemplateThumbnailTarget {
  slug: string;
  latestVersion: {
    id: string;
  };
}

export function buildTemplateThumbnailHref(template: TemplateThumbnailTarget): string {
  const params = new URLSearchParams({ version: template.latestVersion.id });
  return `/api/v1/templates/${encodeURIComponent(template.slug)}/thumbnail?${params.toString()}`;
}
