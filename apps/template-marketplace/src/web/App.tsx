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
import { getMarketplaceHomeHref, readTemplateSlugFromPath } from './lib/routing';

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
    loading: true
  });

  useEffect(() => {
    const handlePopState = () => setDetailSlug(readTemplateSlugFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (detailSlug) {
      setState((current) => (current.loading ? { ...current, loading: false } : current));
      return;
    }

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
  }, [query, sort, selectedTags, detailSlug]);

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

  const isDetailPage = Boolean(detailSlug);
  const statusLabel = `${state.source === 'api' ? 'Worker API' : 'Seed fallback'} · Storage: ${state.storageMode}`;

  return (
    <main className="min-h-screen bg-canvas-mist text-canvas-ink">
      <header className="bg-canvas-nav text-canvas-navText">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-6 text-sm sm:px-8">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">DevSessionCanvas</span>
            <span className="text-canvas-navText/45">|</span>
            <span className="text-base">Templates</span>
          </div>
          <a className="hidden font-semibold underline underline-offset-4 sm:inline" href="https://github.com/ZY-WANG-0304/dev-session-canvas">
            GitHub
          </a>
        </div>
      </header>
      <nav className="border-b border-canvas-line bg-canvas-paper">
        <div className="mx-auto max-w-7xl px-6 text-sm font-semibold sm:px-8">
          <span className="inline-flex bg-canvas-accent px-10 py-4 text-canvas-accentText">Templates</span>
        </div>
      </nav>

      <section className={`px-6 sm:px-8 ${isDetailPage ? 'py-8 lg:py-10' : 'py-16 lg:py-20'}`}>
        <div className={`mx-auto ${isDetailPage ? 'max-w-6xl' : 'max-w-7xl'}`}>
          {isDetailPage ? (
            detailState.loading ? (
              <div className="border border-canvas-line bg-canvas-paper p-10 text-canvas-muted shadow-card">Loading template detail...</div>
            ) : detailState.template ? (
              <TemplateDetailView template={detailState.template} source={detailState.source} storageMode={detailState.storageMode} />
            ) : (
              <div className="border border-dashed border-canvas-line bg-canvas-paper p-10 text-center text-canvas-muted">
                <a className="font-semibold text-canvas-moss hover:underline" href={getMarketplaceHomeHref()}>
                  Back to templates
                </a>
                <p className="mt-4">Template was not found.</p>
              </div>
            )
          ) : (
            <>
              <h1 className="text-center text-4xl font-light leading-tight text-canvas-ink sm:text-5xl">
                Templates for DevSessionCanvas
              </h1>
              <p className="mx-auto mt-4 max-w-3xl text-center text-base leading-7 text-canvas-muted">
                Browse community workflow templates, install them into VSCode, or download the template JSON.
              </p>

              <div className="mx-auto mt-9 flex max-w-4xl shadow-search">
                <label className="sr-only" htmlFor="templateSearch">
                  Search templates
                </label>
                <input
                  id="templateSearch"
                  className="h-14 min-w-0 flex-1 border border-canvas-line bg-canvas-paper px-5 text-xl text-canvas-ink outline-none ring-canvas-accent/25 transition placeholder:text-canvas-muted focus:ring-4"
                  placeholder="Search DevSessionCanvas templates"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
                <button
                  className="grid h-14 w-16 place-items-center bg-canvas-accent text-canvas-accentText transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
                  type="button"
                  aria-label="Search templates"
                >
                  <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="none">
                    <path d="m21 21-4.7-4.7m2.7-5.3a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-canvas-muted">{statusLabel}</p>
                <label className="flex items-center gap-2 text-sm font-semibold text-canvas-ink">
                  Sort
                  <select
                    className="h-10 border border-canvas-line bg-canvas-paper px-3 text-sm font-normal capitalize outline-none ring-canvas-accent/25 transition focus:ring-4"
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

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="font-semibold text-canvas-ink">Tags</span>
                {availableTags.map((tag) => {
                  const selected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      className={`font-semibold transition hover:underline ${
                        selected ? 'text-canvas-accent underline underline-offset-4' : 'text-canvas-moss'
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
                    className="font-semibold text-canvas-muted transition hover:text-canvas-ink hover:underline"
                    type="button"
                    onClick={() => setSelectedTags([])}
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="mt-12 flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-canvas-ink">Featured</h2>
                <span className="text-sm text-canvas-muted">{state.templates.length} templates</span>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {state.templates.map((template) => (
                  <TemplateCard key={template.id} template={template} />
                ))}
              </div>

              {!state.loading && state.templates.length === 0 ? (
                <div className="mt-8 border border-dashed border-canvas-line bg-canvas-paper p-10 text-center text-canvas-muted">
                  No templates matched this search.
                </div>
              ) : null}
            </>
          )}
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
