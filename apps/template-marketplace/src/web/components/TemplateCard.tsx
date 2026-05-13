import type { MarketplaceTemplateSummary } from '@dev-session-canvas/marketplace-shared';

import { buildTemplateDownloadHref } from '../lib/download';
import { buildTemplateDetailHref } from '../lib/routing';

interface TemplateCardProps {
  template: MarketplaceTemplateSummary;
}

export function TemplateCard({ template }: TemplateCardProps): JSX.Element {
  const downloadHref = buildTemplateDownloadHref(template);
  const detailHref = buildTemplateDetailHref(template.slug);

  return (
    <article className="group overflow-hidden rounded-[2rem] border border-canvas-ink/10 bg-white/80 p-5 shadow-card backdrop-blur transition duration-200 hover:-translate-y-1 hover:bg-white">
      <a
        className="mb-5 flex h-36 items-end justify-between rounded-[1.5rem] bg-[radial-gradient(circle_at_20%_20%,#fff4d8,transparent_32%),linear-gradient(135deg,#365346,#d8bf96)] p-4 text-white outline-none ring-canvas-moss/20 transition focus:ring-4"
        href={detailHref}
        aria-label={`View ${template.name} details`}
      >
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-white/70">Template</p>
          <h2 className="mt-2 max-w-[13rem] font-display text-3xl leading-none">{template.name}</h2>
        </div>
        <span className="rounded-full bg-white/18 px-3 py-1 text-xs font-semibold">v{template.latestVersion.versionNumber}</span>
      </a>
      <p className="min-h-16 text-sm leading-6 text-canvas-ink/70">{template.description}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {template.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-canvas-mist px-3 py-1 text-xs font-medium text-canvas-moss">
            #{tag}
          </span>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-canvas-ink/10 pt-4">
        <div className="flex gap-4 text-sm text-canvas-ink/70">
          <span>{template.downloadCount.toLocaleString()} downloads</span>
          <span>{template.likeCount.toLocaleString()} likes</span>
        </div>
        <a
          className="rounded-full bg-canvas-ink px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-canvas-moss focus:outline-none focus:ring-4 focus:ring-canvas-moss/20"
          href={downloadHref}
          download
          aria-label={`Download ${template.name} version ${template.latestVersion.versionNumber} template JSON`}
        >
          Download
        </a>
      </div>
    </article>
  );
}
