import { useEffect, useMemo, useState } from 'react';

import {
  MARKETPLACE_QUERY_MAX_LENGTH,
  MARKETPLACE_SORT_VALUES,
  type MarketplaceSort,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateSummary
} from '@dev-session-canvas/marketplace-shared';

import { TemplateDetailView } from './components/TemplateDetailView';
import { TemplateAdminView } from './components/TemplateAdminView';
import { TemplateCard } from './components/TemplateCard';
import { TemplateMyTemplatesView } from './components/TemplateMyTemplatesView';
import { TemplatePublishView } from './components/TemplatePublishView';
import { loadMarketplaceTemplateDetail, loadMarketplaceTemplates } from './lib/api';
import {
  getMarketplaceAdminHref,
  getMarketplaceHomeHref,
  getMarketplaceMeHref,
  getMarketplacePublishHref,
  isMarketplaceAdminPath,
  isMarketplaceMePath,
  isMarketplacePublishPath,
  readTemplateSlugFromPath
} from './lib/routing';

interface LoadState {
  templates: MarketplaceTemplateSummary[];
  source: 'api' | 'seed-fallback' | 'empty-fallback';
  storageMode: string;
  loading: boolean;
}

interface DetailState {
  template?: MarketplaceTemplateDetail;
  source: 'api' | 'seed-fallback' | 'empty-fallback';
  storageMode: string;
  loading: boolean;
}

export function App(): JSX.Element {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MarketplaceSort>('hot');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [detailSlug, setDetailSlug] = useState(() => readTemplateSlugFromPath(window.location.pathname));
  const [isPublishPage, setIsPublishPage] = useState(() => isMarketplacePublishPath(window.location.pathname));
  const [isMyTemplatesPage, setIsMyTemplatesPage] = useState(() => isMarketplaceMePath(window.location.pathname));
  const [isAdminPage, setIsAdminPage] = useState(() => isMarketplaceAdminPath(window.location.pathname));
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
    const handlePopState = () => {
      setDetailSlug(readTemplateSlugFromPath(window.location.pathname));
      setIsPublishPage(isMarketplacePublishPath(window.location.pathname));
      setIsMyTemplatesPage(isMarketplaceMePath(window.location.pathname));
      setIsAdminPage(isMarketplaceAdminPath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (detailSlug || isPublishPage || isMyTemplatesPage || isAdminPage) {
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
  }, [query, sort, selectedTags, detailSlug, isPublishPage, isMyTemplatesPage, isAdminPage]);

  const availableTags = useMemo(() => collectVisibleTags(state.templates, selectedTags), [state.templates, selectedTags]);

  useEffect(() => {
    if (!detailSlug || isPublishPage || isMyTemplatesPage || isAdminPage) {
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
  }, [detailSlug, isPublishPage, isMyTemplatesPage, isAdminPage]);

  const isDetailPage = Boolean(detailSlug);
  const isSecondaryPage = isDetailPage || isPublishPage || isMyTemplatesPage || isAdminPage;
  const activeNavItem = isPublishPage ? 'publish' : isMyTemplatesPage ? 'mine' : isAdminPage ? 'admin' : 'templates';
  const statusLabel = `${formatSourceLabel(state.source)} · Storage: ${state.storageMode}`;

  return (
    <main className="min-h-screen bg-canvas-mist text-canvas-ink">
      <header className="bg-canvas-nav text-canvas-navText">
        <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-6 px-6 text-sm sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-lg font-semibold">DevSessionCanvas</span>
            <span className="text-canvas-navText/45">|</span>
            <span className="shrink-0 text-base">Templates</span>
          </div>
          <a className="hidden shrink-0 font-semibold underline underline-offset-4 sm:inline" href="https://github.com/ZY-WANG-0304/dev-session-canvas">
            GitHub
          </a>
        </div>
      </header>
      <nav className="border-b border-canvas-line bg-canvas-paper">
        <div className="mx-auto flex w-full max-w-7xl overflow-x-auto px-6 text-sm font-semibold sm:px-8">
          <a className={navItemClassName(activeNavItem === 'templates')} href={getMarketplaceHomeHref()} aria-current={activeNavItem === 'templates' ? 'page' : undefined}>
            Templates
          </a>
          <a className={navItemClassName(activeNavItem === 'publish')} href={getMarketplacePublishHref()} aria-current={activeNavItem === 'publish' ? 'page' : undefined}>
            Publish
          </a>
          <a className={navItemClassName(activeNavItem === 'mine')} href={getMarketplaceMeHref()} aria-current={activeNavItem === 'mine' ? 'page' : undefined}>
            My Templates
          </a>
          <a className={navItemClassName(activeNavItem === 'admin')} href={getMarketplaceAdminHref()} aria-current={activeNavItem === 'admin' ? 'page' : undefined}>
            Admin
          </a>
        </div>
      </nav>

      <section className={`px-6 sm:px-8 ${isSecondaryPage ? 'py-8 lg:py-10' : 'py-16 lg:py-20'}`}>
        <div className={`mx-auto ${isSecondaryPage ? 'max-w-6xl' : 'max-w-7xl'}`}>
          {isPublishPage ? (
            <TemplatePublishView />
          ) : isMyTemplatesPage ? (
            <TemplateMyTemplatesView />
          ) : isAdminPage ? (
            <TemplateAdminView />
          ) : isDetailPage ? (
            detailState.loading ? (
              <div className="border border-canvas-line bg-canvas-paper p-10 text-canvas-muted shadow-card">Loading template details...</div>
            ) : detailState.template ? (
              <TemplateDetailView template={detailState.template} source={detailState.source} storageMode={detailState.storageMode} />
            ) : (
              <div className="border border-canvas-errorLine bg-canvas-errorBg p-10 text-center text-canvas-error" role="alert">
                <a className="font-semibold text-canvas-moss hover:underline" href={getMarketplaceHomeHref()}>
                  Back to all templates
                </a>
                <p className="mt-4">Template not found. It may have been removed or the link is invalid.</p>
              </div>
            )
          ) : (
            <>
              <h1 className="text-center text-4xl font-light leading-tight text-canvas-ink sm:text-5xl">
                DevSessionCanvas Templates
              </h1>
              <p className="mx-auto mt-4 max-w-3xl text-center text-base leading-7 text-canvas-muted">
                Discover workflow templates for Dev Session Canvas. One-click install or download the complete package.
              </p>

              <div className="mx-auto mt-9 flex max-w-4xl shadow-search">
                <label className="sr-only" htmlFor="templateSearch">
                  Search templates
                </label>
                <input
                  id="templateSearch"
                  className="h-14 min-w-0 flex-1 border border-canvas-line bg-canvas-paper px-5 text-xl text-canvas-ink outline-none ring-canvas-accent/25 transition placeholder:text-canvas-muted focus:ring-4"
                  placeholder="Search templates by name, tag, or keyword..."
                  maxLength={MARKETPLACE_QUERY_MAX_LENGTH}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value.slice(0, MARKETPLACE_QUERY_MAX_LENGTH))}
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

              <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-canvas-ink">Featured</h2>
                  <span className="mt-1 block text-sm text-canvas-muted">{state.templates.length} templates</span>
                </div>
                <a
                  className="inline-flex h-10 items-center bg-canvas-accent px-4 text-sm font-semibold text-canvas-accentText transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
                  href={getMarketplacePublishHref()}
                >
                  Upload your template
                </a>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {state.templates.map((template) => (
                  <TemplateCard key={template.id} template={template} />
                ))}
              </div>

              {!state.loading && state.templates.length === 0 ? (
                <div className="mt-8 border border-dashed border-canvas-line bg-canvas-paper p-10 text-center text-canvas-muted">
                  No templates match your search. Try different keywords or clear the filters.
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function formatSourceLabel(source: LoadState['source']): string {
  if (source === 'api') {
    return 'Worker API';
  }
  return source === 'seed-fallback' ? 'Seed fallback' : 'Local fallback';
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

function navItemClassName(active: boolean): string {
  return active
    ? 'inline-flex shrink-0 bg-canvas-accent px-10 py-4 text-canvas-accentText'
    : 'inline-flex shrink-0 px-8 py-4 text-canvas-muted hover:text-canvas-ink hover:underline';
}
