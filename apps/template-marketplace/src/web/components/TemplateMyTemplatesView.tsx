import { useEffect, useState } from 'react';

import type { MarketplacePublisherStatsResponse, MarketplaceTemplateSummary } from '@dev-session-canvas/marketplace-shared';

import { loadCurrentMarketplaceUser, loadMyMarketplaceStats, loadMyMarketplaceTemplates, type MarketplaceCurrentUser } from '../lib/api';
import {
  buildGithubSignInHref,
  buildMarketplacePublishVersionHref,
  buildSignOutFormAction,
  getMarketplaceHomeHref,
  getMarketplaceMeHref,
  getMarketplacePublishHref
} from '../lib/routing';
import { TemplateCard } from './TemplateCard';

interface MyTemplatesState {
  user?: MarketplaceCurrentUser;
  templates: MarketplaceTemplateSummary[];
  stats?: MarketplacePublisherStatsResponse;
  loading: boolean;
  errorMessage?: string;
}

export function TemplateMyTemplatesView(): JSX.Element {
  const [state, setState] = useState<MyTemplatesState>({
    templates: [],
    loading: true
  });

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const currentUser = await loadCurrentMarketplaceUser();
        if (!currentUser.user) {
          if (!cancelled) {
            setState({ templates: [], loading: false });
          }
          return;
        }
        const [templates, stats] = await Promise.all([loadMyMarketplaceTemplates(), loadMyMarketplaceStats()]);
        if (!cancelled) {
          setState({
            user: currentUser.user,
            templates: templates.items,
            stats,
            loading: false
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            templates: [],
            loading: false,
            errorMessage: error instanceof Error ? error.message : 'Unable to load your templates.'
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 text-sm">
        <a className="font-semibold text-canvas-moss hover:underline" href={getMarketplaceHomeHref()}>
          Back to templates
        </a>
      </div>

      <div className="border border-canvas-line bg-canvas-paper p-8 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-canvas-moss">Publisher</p>
            <h1 className="mt-2 text-3xl font-semibold text-canvas-ink">My templates</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-canvas-muted">
              Review templates published by your GitHub account and jump back to their public details.
            </p>
          </div>
          <a
            className="inline-flex h-11 items-center bg-canvas-accent px-5 text-sm font-semibold text-canvas-accentText hover:brightness-110"
            href={getMarketplacePublishHref()}
          >
            Publish template
          </a>
        </div>

        {state.loading ? (
          <div className="mt-8 border border-canvas-line bg-canvas-mist p-5 text-sm text-canvas-muted">Loading your templates...</div>
        ) : state.errorMessage ? (
          <div className="mt-8 border border-canvas-errorLine bg-canvas-errorBg p-5 text-sm text-canvas-error" role="alert">
            {state.errorMessage}
          </div>
        ) : !state.user ? (
          <div className="mt-8 border border-canvas-line bg-canvas-mist p-6">
            <h2 className="text-lg font-semibold text-canvas-ink">GitHub sign-in required</h2>
            <p className="mt-2 text-sm leading-6 text-canvas-muted">Sign in to view templates published by your GitHub account.</p>
            <a
              className="mt-5 inline-flex h-11 items-center bg-canvas-accent px-5 text-sm font-semibold text-canvas-accentText hover:brightness-110"
              href={buildGithubSignInHref(getMarketplaceMeHref())}
            >
              Sign in with GitHub
            </a>
          </div>
        ) : (
          <>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border border-canvas-line bg-canvas-mist px-4 py-3 text-sm text-canvas-muted">
              <span>
                Signed in as <span className="font-semibold text-canvas-ink">{state.user.githubLogin}</span>
              </span>
              <form action={buildSignOutFormAction(getMarketplaceMeHref())} method="post">
                <button className="border border-canvas-line bg-canvas-paper px-3 py-1 font-semibold text-canvas-ink hover:border-canvas-moss" type="submit">
                  Sign out
                </button>
              </form>
              <span>{state.templates.length} templates</span>
            </div>

            {state.templates.length > 0 ? (
              <>
                <PublisherStatsPanel stats={state.stats} />
                <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {state.templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      footerAction={
                        <a
                          className="border border-canvas-line px-3 py-2 text-xs font-semibold text-canvas-ink transition hover:border-canvas-moss hover:text-canvas-moss focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
                          href={buildMarketplacePublishVersionHref(template.slug)}
                        >
                          Publish new version
                        </a>
                      }
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-8 border border-dashed border-canvas-line bg-canvas-mist p-10 text-center text-sm text-canvas-muted">
                You have not published any templates yet.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PublisherStatsPanel({ stats }: { stats?: MarketplacePublisherStatsResponse }): JSX.Element | null {
  if (!stats) {
    return null;
  }
  const recentDaily = stats.daily.slice(-7);

  return (
    <section className="mt-8 border border-canvas-line bg-canvas-paper">
      <div className="border-b border-canvas-line px-5 py-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-canvas-moss">Dashboard</p>
        <h2 className="mt-1 text-2xl font-semibold text-canvas-ink">Community signal</h2>
      </div>
      <div className="grid gap-px bg-canvas-line sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Templates" value={stats.totals.templateCount} />
        <StatCard label="Downloads" value={stats.totals.downloadCount} />
        <StatCard label="Likes" value={stats.totals.likeCount} />
        <StatCard label="Publishes" value={stats.totals.publishCount} />
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-canvas-muted">Recent trend</h3>
          {recentDaily.length > 0 ? (
            <ol className="mt-4 divide-y divide-canvas-line border-y border-canvas-line">
              {recentDaily.map((point) => (
                <li key={point.day} className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm">
                  <span className="font-semibold text-canvas-ink">{point.day}</span>
                  <span className="text-canvas-muted">{formatNumber(point.downloadCount)} downloads</span>
                  <span className="text-canvas-muted">{formatNumber(point.likeCount)} likes</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 border border-dashed border-canvas-line bg-canvas-mist p-4 text-sm text-canvas-muted">
              No daily activity has been recorded yet.
            </p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-canvas-muted">Top templates</h3>
          {stats.templates.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {stats.templates.slice(0, 5).map((entry) => (
                <li key={entry.template.id} className="border border-canvas-line bg-canvas-mist p-3">
                  <div className="font-semibold text-canvas-ink">{entry.template.name}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-canvas-muted">
                    <span>{formatNumber(entry.downloadCount)} downloads</span>
                    <span>{formatNumber(entry.likeCount)} likes</span>
                    <span>{formatNumber(entry.publishCount)} publishes</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 border border-dashed border-canvas-line bg-canvas-mist p-4 text-sm text-canvas-muted">
              Publish a template to see per-template performance.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="bg-canvas-paper p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-canvas-muted">{label}</div>
      <div className="mt-2 text-3xl font-light text-canvas-ink">{formatNumber(value)}</div>
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}
