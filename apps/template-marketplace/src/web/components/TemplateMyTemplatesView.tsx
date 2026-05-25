import { useEffect, useState } from 'react';

import type { MarketplaceTemplateSummary } from '@dev-session-canvas/marketplace-shared';

import { loadCurrentMarketplaceUser, loadMyMarketplaceTemplates, type MarketplaceCurrentUser } from '../lib/api';
import { buildGithubSignInHref, buildSignOutHref, getMarketplaceHomeHref, getMarketplaceMeHref, getMarketplacePublishHref } from '../lib/routing';
import { TemplateCard } from './TemplateCard';

interface MyTemplatesState {
  user?: MarketplaceCurrentUser;
  templates: MarketplaceTemplateSummary[];
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
        const templates = await loadMyMarketplaceTemplates();
        if (!cancelled) {
          setState({
            user: currentUser.user,
            templates: templates.items,
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
              <form action={buildSignOutHref(getMarketplaceMeHref())} method="post">
                <button className="border border-canvas-line bg-canvas-paper px-3 py-1 font-semibold text-canvas-ink hover:border-canvas-moss" type="submit">
                  Sign out
                </button>
              </form>
              <span>{state.templates.length} templates</span>
            </div>

            {state.templates.length > 0 ? (
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {state.templates.map((template) => (
                  <TemplateCard key={template.id} template={template} />
                ))}
              </div>
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
