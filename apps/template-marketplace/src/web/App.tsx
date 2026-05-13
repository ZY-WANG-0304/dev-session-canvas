import { useEffect, useMemo, useState } from 'react';

import {
  MARKETPLACE_SORT_VALUES,
  type MarketplaceSort,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateSummary
} from '@dev-session-canvas/marketplace-shared';

import { TemplateDetailView } from './components/TemplateDetailView';
import { TemplateCard } from './components/TemplateCard';
import { loadMarketplaceTemplateDetail, loadMarketplaceTemplates } from './lib/api';
import { readTemplateSlugFromPath } from './lib/routing';

interface LoadState {
  templates: MarketplaceTemplateSummary[];
  source: 'api' | 'seed-fallback';
  storageMode: string;
  loading: boolean;
}

interface DetailState {
  template?: MarketplaceTemplateDetail;
  source: 'api' | 'seed-fallback';
  storageMode: string;
  loading: boolean;
}

export function App(): JSX.Element {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MarketplaceSort>('hot');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [detailSlug, setDetailSlug] = useState(() => readTemplateSlugFromPath(window.location.pathname));
  const [state, setState] = useState<LoadState>({
    templates: [],
    source: 'seed-fallback',
    storageMode: 'seed',
    loading: true
  });
  const [detailState, setDetailState] = useState<DetailState>({
    source: 'seed-fallback',
    storageMode: 'seed',
    loading: false
  });

  useEffect(() => {
    const handlePopState = () => setDetailSlug(readTemplateSlugFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    void loadMarketplaceTemplates({ q: query, sort, tags: selectedTags }).then((result) => {
      if (cancelled) {
        return;
      }
      setState({
        templates: result.templates,
        source: result.source,
        storageMode: result.storageMode,
        loading: false
      });
    });
    return () => {
      cancelled = true;
    };
  }, [query, sort, selectedTags]);

  const availableTags = useMemo(() => collectVisibleTags(state.templates, selectedTags), [state.templates, selectedTags]);

  useEffect(() => {
    if (!detailSlug) {
      setDetailState((current) => ({ ...current, loading: false }));
      return;
    }
    let cancelled = false;
    setDetailState((current) => ({ ...current, loading: true }));
    void loadMarketplaceTemplateDetail(detailSlug).then((result) => {
      if (cancelled) {
        return;
      }
      setDetailState({
        template: result.template,
        source: result.source,
        storageMode: result.storageMode,
        loading: false
      });
    });
    return () => {
      cancelled = true;
    };
  }, [detailSlug]);

  return (
    <main className="min-h-screen overflow-hidden bg-canvas-mist text-canvas-ink">
      <section className="relative px-6 py-10 sm:px-10 lg:px-16">
        <div className="absolute -right-32 -top-28 h-80 w-80 rounded-full bg-canvas-sand/70 blur-3xl" />
        <div className="absolute left-8 top-48 h-44 w-44 rounded-full bg-canvas-ember/20 blur-2xl" />
        <div className="relative mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <p className="mb-4 inline-flex rounded-full border border-canvas-moss/20 bg-white/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] text-canvas-moss">
                dscanvas.dev/templates
              </p>
              <h1 className="max-w-4xl font-display text-5xl leading-[0.95] tracking-tight text-canvas-ink sm:text-7xl">
                Community templates for durable agent work.
              </h1>
            </div>
            <div className="rounded-[2rem] border border-canvas-ink/10 bg-white/70 p-5 shadow-card backdrop-blur">
              <p className="text-sm leading-6 text-canvas-ink/70">
                Browse the first marketplace foundation build. Data is served by the Worker API when available and falls back to explicit seed data during local development.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-canvas-moss">
                <span>{state.source === 'api' ? 'Worker API' : 'Seed fallback'}</span>
                <span>Storage: {state.storageMode}</span>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-4 rounded-[2rem] border border-canvas-ink/10 bg-white/75 p-4 shadow-card backdrop-blur md:grid-cols-[1fr_14rem]">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-canvas-ink/50">Search templates</span>
              <input
                className="h-12 w-full rounded-2xl border border-canvas-ink/10 bg-white px-4 text-base outline-none ring-canvas-moss/20 transition focus:ring-4"
                placeholder="Try review, release, starter..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-canvas-ink/50">Sort</span>
              <select
                className="h-12 w-full rounded-2xl border border-canvas-ink/10 bg-white px-4 text-base capitalize outline-none ring-canvas-moss/20 transition focus:ring-4"
                value={sort}
                onChange={(event) => setSort(event.currentTarget.value as MarketplaceSort)}
              >
                {MARKETPLACE_SORT_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[1.5rem] border border-canvas-ink/10 bg-white/55 p-3 shadow-card backdrop-blur">
            <span className="mr-1 text-xs font-bold uppercase tracking-[0.22em] text-canvas-ink/45">Tags</span>
            {availableTags.map((tag) => {
              const selected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    selected ? 'bg-canvas-ink text-white shadow-sm' : 'bg-canvas-mist text-canvas-moss hover:bg-canvas-sand/45'
                  }`}
                  type="button"
                  onClick={() => setSelectedTags((current) => toggleTag(current, tag))}
                  aria-pressed={selected}
                >
                  #{tag}
                </button>
              );
            })}
            {selectedTags.length > 0 ? (
              <button
                className="rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-canvas-ink/45 transition hover:text-canvas-ink"
                type="button"
                onClick={() => setSelectedTags([])}
              >
                Clear
              </button>
            ) : null}
          </div>

          {detailSlug ? (
            detailState.loading ? (
              <div className="mt-10 rounded-[2rem] border border-canvas-ink/10 bg-white/70 p-10 text-canvas-ink/60 shadow-card">Loading template detail...</div>
            ) : detailState.template ? (
              <TemplateDetailView template={detailState.template} source={detailState.source} storageMode={detailState.storageMode} />
            ) : (
              <div className="mt-10 rounded-[2rem] border border-dashed border-canvas-ink/20 bg-white/60 p-10 text-center text-canvas-ink/60">
                Template was not found.
              </div>
            )
          ) : null}

          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {state.templates.map((template) => (
              <TemplateCard key={template.id} template={template} />
            ))}
          </div>

          {!state.loading && state.templates.length === 0 ? (
            <div className="mt-8 rounded-[2rem] border border-dashed border-canvas-ink/20 bg-white/60 p-10 text-center text-canvas-ink/60">
              No templates matched this search.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function collectVisibleTags(templates: MarketplaceTemplateSummary[], selectedTags: string[]): string[] {
  const tags = new Set<string>(selectedTags);
  for (const template of templates) {
    for (const tag of template.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
}

function toggleTag(current: string[], tag: string): string[] {
  return current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag];
}
