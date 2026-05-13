import type { MarketplaceTemplateDetail } from '@dev-session-canvas/marketplace-shared';

import { InstallInVSCodeLink } from './InstallInVSCodeLink';
import { buildTemplateDownloadHref } from '../lib/download';
import { getMarketplaceHomeHref } from '../lib/routing';
import { buildTemplateThumbnailHref } from '../lib/thumbnail';

interface TemplateDetailViewProps {
  template: MarketplaceTemplateDetail;
  storageMode: string;
  source: 'api' | 'seed-fallback';
}

export function TemplateDetailView({ template, storageMode, source }: TemplateDetailViewProps): JSX.Element {
  const downloadHref = buildTemplateDownloadHref(template);
  const thumbnailHref = buildTemplateThumbnailHref(template);
  const readme = template.readme.trim() || 'This template does not have a README yet.';
  const sourceLabel = source === 'api' ? 'Worker API' : 'Seed fallback';

  return (
    <section className="border border-canvas-line bg-canvas-paper shadow-card">
      <div className="border-b border-canvas-line p-5 sm:p-6">
        <a className="text-sm font-semibold text-canvas-moss hover:underline" href={getMarketplaceHomeHref()}>
          Back to all templates
        </a>
        <div className="mt-5 grid gap-5 lg:grid-cols-[10rem_1fr]">
          <div className="market-thumbnail h-28 border border-canvas-line sm:h-32">
            <img
              className="h-full w-full object-cover"
              src={thumbnailHref}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <div>
            <h2 className="text-3xl font-light leading-tight text-canvas-ink sm:text-4xl">{template.name}</h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-canvas-muted">{template.description}</p>
            <div className="mt-5 flex flex-wrap gap-x-3 gap-y-1">
              {template.tags.map((tag) => (
                <span key={tag} className="text-xs font-semibold text-canvas-moss">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
        <article className="min-h-[28rem] px-5 py-7 sm:px-8 sm:py-9 lg:pr-10">
          <div className="border-b border-canvas-line pb-3">
            <h3 className="text-2xl font-semibold text-canvas-ink">README</h3>
          </div>
          <div className="mt-6 max-w-5xl whitespace-pre-wrap text-base leading-8 text-canvas-ink">
            {readme}
          </div>
        </article>

        <aside className="border-t border-canvas-line px-5 py-6 lg:border-l lg:border-t-0">
          <InstallInVSCodeLink
            className="inline-flex w-full justify-center bg-canvas-accent px-4 py-3 text-xs font-semibold text-canvas-accentText transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
            template={template}
            ariaLabel={`Install ${template.name} v${template.latestVersion.versionNumber} in VS Code`}
          >
            Install in VS Code
          </InstallInVSCodeLink>
          <a
            className="mt-3 inline-flex w-full justify-center border border-canvas-line px-4 py-3 text-xs font-semibold text-canvas-ink transition hover:border-canvas-moss hover:text-canvas-moss focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
            href={downloadHref}
            download
            aria-label={`Download ${template.name} v${template.latestVersion.versionNumber} as JSON`}
          >
            Download JSON
          </a>

          <dl className="mt-6 divide-y divide-canvas-line border-y border-canvas-line">
            <MetaItem label="Downloads" value={template.downloadCount.toLocaleString()} />
            <MetaItem label="Likes" value={template.likeCount.toLocaleString()} />
            <MetaItem label="Latest" value={`v${template.latestVersion.versionNumber}`} />
          </dl>

          <details className="mt-5 border-t border-canvas-line pt-4">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-canvas-muted focus:outline-none focus:ring-4 focus:ring-canvas-accent/25">
              Version history
            </summary>
            <ol className="mt-3 space-y-3">
              {template.versions.map((version) => (
                <li key={version.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-canvas-ink">v{version.versionNumber}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-moss">{version.status}</span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-canvas-muted">{version.changelog}</p>
                </li>
              ))}
            </ol>
          </details>

          <details className="mt-5 border-t border-canvas-line pt-4">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-canvas-muted focus:outline-none focus:ring-4 focus:ring-canvas-accent/25">
              Integrity
            </summary>
            <p className="mt-2 break-all text-xs leading-5 text-canvas-muted">{template.latestVersion.sha256}</p>
          </details>

          <p className="mt-5 border-t border-canvas-line pt-4 text-xs leading-5 text-canvas-muted">
            {sourceLabel} / {storageMode}
          </p>
        </aside>
      </div>
    </section>
  );
}

function MetaItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">{label}</dt>
      <dd className="mt-1 text-xl font-light text-canvas-ink">{value}</dd>
    </div>
  );
}
