import { useEffect, useState } from 'react';
import type { MarketplaceTemplateDetail } from '@dev-session-canvas/marketplace-shared';

import { InstallInVSCodeLink } from './InstallInVSCodeLink';
import { loadCurrentMarketplaceUser, loadMyMarketplaceLikes, setMarketplaceTemplateLike, type MarketplaceCurrentUser } from '../lib/api';
import { buildTemplateDownloadHref, buildTemplateJsonExportHref } from '../lib/download';
import { buildGithubSignInHref, getMarketplaceHomeHref } from '../lib/routing';
import { buildTemplateThumbnailHref } from '../lib/thumbnail';

interface TemplateDetailViewProps {
  template: MarketplaceTemplateDetail;
  storageMode: string;
  source: 'api' | 'seed-fallback';
}

type DetailTab = 'readme' | 'changelog';

interface LikeState {
  loading: boolean;
  liked: boolean;
  likeCount: number;
  user?: MarketplaceCurrentUser;
  errorMessage?: string;
}

const activeTabClassName =
  'border-b-2 border-canvas-accent px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-canvas-ink outline-none transition focus:ring-4 focus:ring-canvas-accent/25';
const inactiveTabClassName =
  'border-b-2 border-transparent px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-canvas-muted outline-none transition hover:text-canvas-ink focus:ring-4 focus:ring-canvas-accent/25';

export function TemplateDetailView({ template, storageMode, source }: TemplateDetailViewProps): JSX.Element {
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('readme');
  const [likeState, setLikeState] = useState<LikeState>({
    loading: true,
    liked: false,
    likeCount: template.likeCount
  });
  const downloadHref = buildTemplateDownloadHref(template);
  const templateJsonExportHref = buildTemplateJsonExportHref(template);
  const thumbnailHref = buildTemplateThumbnailHref(template);
  const readme = template.readme.trim() || 'This template does not have a README yet.';
  const versions = [...template.versions].sort((left, right) => right.versionNumber - left.versionNumber);
  const sourceLabel = source === 'api' ? 'Worker API' : 'Seed fallback';

  useEffect(() => {
    setActiveDetailTab('readme');
  }, [template.slug]);

  useEffect(() => {
    let cancelled = false;
    setLikeState({
      loading: true,
      liked: false,
      likeCount: template.likeCount
    });
    async function loadLikeState(): Promise<void> {
      try {
        const currentUser = await loadCurrentMarketplaceUser();
        if (!currentUser.user) {
          if (!cancelled) {
            setLikeState({
              loading: false,
              liked: false,
              likeCount: template.likeCount
            });
          }
          return;
        }
        const likes = await loadMyMarketplaceLikes();
        if (!cancelled) {
          setLikeState({
            loading: false,
            liked: likes.items.some((entry) => entry.id === template.id || entry.slug === template.slug),
            likeCount: template.likeCount,
            user: currentUser.user
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLikeState({
            loading: false,
            liked: false,
            likeCount: template.likeCount,
            errorMessage: error instanceof Error ? error.message : 'Unable to load like state.'
          });
        }
      }
    }
    void loadLikeState();
    return () => {
      cancelled = true;
    };
  }, [template.id, template.slug, template.likeCount]);

  async function toggleLike(): Promise<void> {
    if (!likeState.user || likeState.loading) {
      return;
    }
    const nextLiked = !likeState.liked;
    const previous = likeState;
    setLikeState({
      ...likeState,
      loading: true,
      liked: nextLiked,
      likeCount: Math.max(0, likeState.likeCount + (nextLiked ? 1 : -1)),
      errorMessage: undefined
    });
    try {
      const result = await setMarketplaceTemplateLike(template.slug, nextLiked);
      setLikeState({
        loading: false,
        liked: result.liked,
        likeCount: result.likeCount,
        user: previous.user
      });
    } catch (error) {
      setLikeState({
        ...previous,
        loading: false,
        errorMessage: error instanceof Error ? error.message : 'Unable to update like.'
      });
    }
  }

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
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-canvas-muted">
              <PublisherAvatar src={template.publisher.avatarUrl} name={template.publisher.displayName || template.publisher.githubLogin} />
              <span>
                Published by <span className="font-semibold text-canvas-ink">{template.publisher.displayName || template.publisher.githubLogin}</span>
                {template.publisher.githubLogin ? <span className="ml-1"> @{template.publisher.githubLogin}</span> : null}
              </span>
            </div>
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
          <div className="border-b border-canvas-line">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Template detail content">
              <button
                id="template-detail-readme-tab"
                className={activeDetailTab === 'readme' ? activeTabClassName : inactiveTabClassName}
                type="button"
                role="tab"
                aria-selected={activeDetailTab === 'readme'}
                aria-controls="template-detail-readme-panel"
                onClick={() => setActiveDetailTab('readme')}
              >
                README
              </button>
              <button
                id="template-detail-changelog-tab"
                className={activeDetailTab === 'changelog' ? activeTabClassName : inactiveTabClassName}
                type="button"
                role="tab"
                aria-selected={activeDetailTab === 'changelog'}
                aria-controls="template-detail-changelog-panel"
                onClick={() => setActiveDetailTab('changelog')}
              >
                CHANGELOG
              </button>
            </div>
          </div>
          {activeDetailTab === 'readme' ? (
            <section
              id="template-detail-readme-panel"
              className="mt-6"
              role="tabpanel"
              aria-labelledby="template-detail-readme-tab"
            >
              <h3 className="text-2xl font-semibold text-canvas-ink">README</h3>
              <div className="mt-6 max-w-5xl whitespace-pre-wrap text-base leading-8 text-canvas-ink">{readme}</div>
            </section>
          ) : (
            <section
              id="template-detail-changelog-panel"
              className="mt-6"
              role="tabpanel"
              aria-labelledby="template-detail-changelog-tab"
            >
              <h3 className="text-2xl font-semibold text-canvas-ink">CHANGELOG</h3>
              {versions.length > 0 ? (
                <ol className="mt-6 max-w-5xl space-y-5">
                  {versions.map((version) => (
                    <li key={version.id} className="border-b border-canvas-line pb-5 last:border-b-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <span className="text-lg font-semibold text-canvas-ink">v{version.versionNumber}</span>
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-moss">{version.status}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-base leading-8 text-canvas-muted">
                        {version.changelog.trim() || 'No changelog provided for this version.'}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-6 text-base leading-8 text-canvas-muted">This template does not have a changelog yet.</p>
              )}
            </section>
          )}
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
            aria-label={`Download ${template.name} v${template.latestVersion.versionNumber} as full package`}
          >
            Download full package
          </a>
          <a
            className="mt-3 inline-flex w-full justify-center border border-canvas-line bg-canvas-mist px-4 py-3 text-xs font-semibold text-canvas-ink transition hover:border-canvas-moss hover:text-canvas-moss focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
            href={templateJsonExportHref}
            download
            aria-label={`Export ${template.name} v${template.latestVersion.versionNumber} as template.json`}
          >
            Download template.json
          </a>

          <dl className="mt-6 divide-y divide-canvas-line border-y border-canvas-line">
            <MetaItem label="Downloads" value={template.downloadCount.toLocaleString()} />
            <MetaItem label="Likes" value={likeState.likeCount.toLocaleString()} />
            <MetaItem label="Latest" value={`v${template.latestVersion.versionNumber}`} />
            <MetaItem label="Publisher" value={template.publisher.displayName || template.publisher.githubLogin} />
          </dl>

          <div className="mt-5 border-t border-canvas-line pt-4">
            {likeState.user ? (
              <button
                className={`inline-flex w-full justify-center px-4 py-3 text-xs font-semibold transition focus:outline-none focus:ring-4 focus:ring-canvas-accent/25 ${
                  likeState.liked
                    ? 'border border-canvas-moss bg-canvas-mist text-canvas-moss hover:border-canvas-line hover:text-canvas-ink'
                    : 'bg-canvas-moss text-canvas-accentText hover:brightness-110'
                }`}
                type="button"
                disabled={likeState.loading}
                onClick={() => {
                  void toggleLike();
                }}
                aria-pressed={likeState.liked}
              >
                {likeState.loading ? 'Saving...' : likeState.liked ? 'Liked' : 'Like this template'}
              </button>
            ) : (
              <a
                className="inline-flex w-full justify-center border border-canvas-line bg-canvas-mist px-4 py-3 text-xs font-semibold text-canvas-ink transition hover:border-canvas-moss hover:text-canvas-moss focus:outline-none focus:ring-4 focus:ring-canvas-accent/25"
                href={buildGithubSignInHref(window.location.pathname)}
              >
                Sign in to like
              </a>
            )}
            {likeState.errorMessage ? <p className="mt-2 text-xs leading-5 text-canvas-error">{likeState.errorMessage}</p> : null}
          </div>

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

function PublisherAvatar({ src, name }: { src: string; name: string }): JSX.Element {
  if (!src) {
    return <span className="h-7 w-7 shrink-0 border border-canvas-line bg-canvas-mist" aria-hidden="true" title={name} />;
  }
  return <img className="h-7 w-7 shrink-0 border border-canvas-line object-cover" src={src} alt={`${name} avatar`} loading="lazy" />;
}

function MetaItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">{label}</dt>
      <dd className="mt-1 text-xl font-light text-canvas-ink">{value}</dd>
    </div>
  );
}
