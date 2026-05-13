import type { MarketplaceTemplateSummary } from '@dev-session-canvas/marketplace-shared';

import { InstallInVSCodeLink } from './InstallInVSCodeLink';
import { buildTemplateDownloadHref } from '../lib/download';
import { buildTemplateDetailHref } from '../lib/routing';
import { buildTemplateThumbnailHref } from '../lib/thumbnail';

interface TemplateCardProps {
  template: MarketplaceTemplateSummary;
}

export function TemplateCard({ template }: TemplateCardProps): JSX.Element {
  const downloadHref = buildTemplateDownloadHref(template);
  const detailHref = buildTemplateDetailHref(template.slug);
  const thumbnailHref = buildTemplateThumbnailHref(template);

  return (
    <article className="group flex min-h-full flex-col border border-canvas-line bg-canvas-paper shadow-card transition duration-150 hover:-translate-y-0.5">
      <a
        className="market-thumbnail block h-36 overflow-hidden border-b border-canvas-line outline-none ring-canvas-accent/25 transition focus:ring-4"
        href={detailHref}
        aria-label={`View details for ${template.name}`}
      >
        <img
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          src={thumbnailHref}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      </a>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <a className="text-lg font-semibold leading-snug text-canvas-ink hover:text-canvas-moss" href={detailHref}>
            {template.name}
          </a>
          <span className="shrink-0 text-sm font-semibold text-canvas-muted">v{template.latestVersion.versionNumber}</span>
        </div>
        <p className="mt-3 min-h-14 text-sm leading-6 text-canvas-muted">{template.description}</p>
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
        {template.tags.map((tag) => (
          <span key={tag} className="text-xs font-semibold text-canvas-moss">
            #{tag}
          </span>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-canvas-line pt-4">
        <div className="flex gap-4 text-sm text-canvas-muted">
          <span>{template.downloadCount.toLocaleString()} downloads</span>
          <span>{template.likeCount.toLocaleString()} likes</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <InstallInVSCodeLink
            className="bg-canvas-accent px-3 py-2 text-xs font-semibold text-canvas-accentText transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
            template={template}
            ariaLabel={`Install ${template.name} v${template.latestVersion.versionNumber} in VS Code`}
            noticeClassName="basis-full text-right text-xs leading-5 text-canvas-muted"
          >
            Install
          </InstallInVSCodeLink>
          <a
            className="border border-canvas-line px-3 py-2 text-xs font-semibold text-canvas-ink transition hover:border-canvas-moss hover:text-canvas-moss focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
            href={downloadHref}
            download
            aria-label={`Download ${template.name} v${template.latestVersion.versionNumber} as JSON`}
          >
            JSON
          </a>
        </div>
      </div>
      </div>
    </article>
  );
}
