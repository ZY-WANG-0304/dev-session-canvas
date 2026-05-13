import type { MarketplaceTemplateDetail } from '@dev-session-canvas/marketplace-shared';

import { buildTemplateDownloadHref } from '../lib/download';
import { getMarketplaceHomeHref } from '../lib/routing';

interface TemplateDetailViewProps {
  template: MarketplaceTemplateDetail;
  storageMode: string;
  source: 'api' | 'seed-fallback';
}

export function TemplateDetailView({ template, storageMode, source }: TemplateDetailViewProps): JSX.Element {
  const downloadHref = buildTemplateDownloadHref(template);

  return (
    <section className="mt-10 overflow-hidden rounded-[2.5rem] border border-canvas-ink/10 bg-white/80 shadow-card backdrop-blur">
      <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
        <div className="min-h-80 bg-[radial-gradient(circle_at_28%_20%,#fff4d8,transparent_28%),linear-gradient(145deg,#365346,#d8bf96)] p-8 text-white">
          <a className="text-xs font-bold uppercase tracking-[0.24em] text-white/70 hover:text-white" href={getMarketplaceHomeHref()}>
            Back to marketplace
          </a>
          <div className="mt-20">
            <p className="text-xs uppercase tracking-[0.32em] text-white/70">Template detail</p>
            <h2 className="mt-4 font-display text-5xl leading-none sm:text-6xl">{template.name}</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/78">{template.description}</p>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {template.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-canvas-mist px-3 py-1 text-xs font-bold text-canvas-moss">
                  #{tag}
                </span>
              ))}
            </div>
            <span className="rounded-full border border-canvas-moss/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-canvas-moss">
              {source === 'api' ? 'Worker API' : 'Seed fallback'} / {storageMode}
            </span>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <MetricCard label="Downloads" value={template.downloadCount.toLocaleString()} />
            <MetricCard label="Likes" value={template.likeCount.toLocaleString()} />
            <MetricCard label="Latest" value={`v${template.latestVersion.versionNumber}`} />
          </div>

          <div className="mt-8 rounded-[1.5rem] bg-canvas-mist/70 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-canvas-ink/50">Readme</p>
            <p className="mt-3 text-sm leading-7 text-canvas-ink/72">{template.readme}</p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <div className="rounded-[1.5rem] border border-canvas-ink/10 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-canvas-ink/50">Version history</p>
              <div className="mt-4 space-y-3">
                {template.versions.map((version) => (
                  <div key={version.id} className="flex items-start justify-between gap-3 rounded-2xl bg-canvas-mist/60 px-4 py-3">
                    <div>
                      <p className="font-semibold text-canvas-ink">v{version.versionNumber}</p>
                      <p className="mt-1 text-sm leading-6 text-canvas-ink/65">{version.changelog}</p>
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-canvas-moss">{version.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-canvas-ink/10 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-canvas-ink/50">Install file</p>
              <p className="mt-3 break-all text-sm leading-6 text-canvas-ink/65">{template.latestVersion.sha256}</p>
              <a
                className="mt-5 inline-flex w-full justify-center rounded-full bg-canvas-ink px-5 py-3 text-xs font-bold uppercase tracking-[0.18em] text-white transition hover:-translate-y-0.5 hover:bg-canvas-moss focus:outline-none focus:ring-4 focus:ring-canvas-moss/20"
                href={downloadHref}
                download
              >
                Download JSON
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-[1.25rem] border border-canvas-ink/10 bg-white px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-canvas-ink/45">{label}</p>
      <p className="mt-2 font-display text-3xl leading-none text-canvas-ink">{value}</p>
    </div>
  );
}
