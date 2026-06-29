import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import {
  generateMarketplaceTemplateThumbnailPngBase64,
  marketplaceTemplateDocumentSchema,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateDocument
} from '@dev-session-canvas/marketplace-shared';

import { buildGithubSignInHref, buildSignOutFormAction, buildTemplateDetailHref, getMarketplaceMeHref, getMarketplacePublishHref } from '../lib/routing';
import {
  loadCurrentMarketplaceUser,
  loadMarketplaceTemplateDetail,
  publishMarketplaceTemplateVersion,
  type MarketplaceCurrentUser
} from '../lib/api';

interface TemplatePublishVersionViewProps {
  templateSlug?: string;
}

interface PublishVersionState {
  loading: boolean;
  user?: MarketplaceCurrentUser;
  template?: MarketplaceTemplateDetail;
  errorMessage?: string;
}

interface PublishVersionFormState {
  changelog: string;
  templateJson: string;
  templateFileName: string;
  thumbnailPngBase64: string;
  thumbnailSource: 'none' | 'generated' | 'custom';
  thumbnailFileName: string;
}

interface PublishVersionStatus {
  kind: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  slug?: string;
  versionNumber?: number;
}

interface TemplateJsonValidation {
  document?: MarketplaceTemplateDocument;
  errorMessage?: string;
}

export function TemplatePublishVersionView({ templateSlug }: TemplatePublishVersionViewProps): JSX.Element {
  const [state, setState] = useState<PublishVersionState>({ loading: true });
  const [status, setStatus] = useState<PublishVersionStatus>({ kind: 'idle' });
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [form, setForm] = useState<PublishVersionFormState>({
    changelog: '',
    templateJson: '',
    templateFileName: '',
    thumbnailPngBase64: '',
    thumbnailSource: 'none',
    thumbnailFileName: ''
  });

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const currentUser = await loadCurrentMarketplaceUser();
        if (!currentUser.user) {
          if (!cancelled) {
            setState({ loading: false });
          }
          return;
        }
        const slug = templateSlug;
        if (!slug) {
          if (!cancelled) {
            setState({
              loading: false,
              user: currentUser.user,
              errorMessage: 'Choose a template from My Templates before publishing a new version.'
            });
          }
          return;
        }
        const detail = await loadMarketplaceTemplateDetail(slug);
        if (!detail.template) {
          if (!cancelled) {
            setState({
              loading: false,
              user: currentUser.user,
              errorMessage: 'Template was not found. It may have been removed or delisted.'
            });
          }
          return;
        }
        if (detail.template.publisher.id !== `github-${currentUser.user.githubUserId}`) {
          if (!cancelled) {
            setState({
              loading: false,
              user: currentUser.user,
              template: detail.template,
              errorMessage: 'Only the template publisher can publish a new version.'
            });
          }
          return;
        }
        if (!cancelled) {
          const nextVersionNumber = detail.template.latestVersion.versionNumber + 1;
          setState({
            loading: false,
            user: currentUser.user,
            template: detail.template
          });
          setForm((current) => ({
            ...current,
            changelog: current.changelog || `Version ${nextVersionNumber}.`
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            errorMessage: error instanceof Error ? error.message : 'Unable to load the version publish form.'
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [templateSlug]);

  async function handleTemplateFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    const text = await file.text();
    const parsed = parseTemplateDocumentFromJson(text);
    if (!parsed.document) {
      setForm((current) => ({
        ...current,
        templateJson: text,
        templateFileName: file.name,
        thumbnailPngBase64: '',
        thumbnailSource: 'none',
        thumbnailFileName: ''
      }));
      setFieldError(`${file.name}: ${parsed.errorMessage}`);
      setStatus({ kind: 'idle' });
      return;
    }
    const templateDocument = parsed.document;
    setForm((current) => ({
      ...current,
      templateJson: text,
      templateFileName: file.name,
      thumbnailPngBase64: current.thumbnailSource === 'custom' ? current.thumbnailPngBase64 : generateMarketplaceTemplateThumbnailPngBase64(templateDocument),
      thumbnailSource: current.thumbnailSource === 'custom' ? current.thumbnailSource : 'generated',
      thumbnailFileName: current.thumbnailSource === 'custom' ? current.thumbnailFileName : ''
    }));
    setFieldError(undefined);
    setStatus({ kind: 'idle' });
  }

  async function handleThumbnailFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    if (file.type && file.type !== 'image/png') {
      setStatus({ kind: 'error', message: 'Thumbnail must be a PNG image.' });
      return;
    }
    const thumbnailPngBase64 = await fileToDataUrl(file);
    setForm((current) => ({
      ...current,
      thumbnailPngBase64,
      thumbnailSource: 'custom',
      thumbnailFileName: file.name
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state.template) {
      setStatus({ kind: 'error', message: 'Load a published template before publishing a new version.' });
      return;
    }
    const parsed = parseTemplateDocumentFromJson(form.templateJson);
    if (!parsed.document) {
      setFieldError(parsed.errorMessage);
      setStatus({ kind: 'idle' });
      return;
    }
    setStatus({ kind: 'loading', message: 'Publishing new version...' });
    try {
      const result = await publishMarketplaceTemplateVersion(state.template.slug, {
        changelog: form.changelog.trim() || undefined,
        templateDocument: parsed.document,
        thumbnailPngBase64:
          form.thumbnailSource === 'custom'
            ? form.thumbnailPngBase64
            : generateMarketplaceTemplateThumbnailPngBase64(parsed.document)
      });
      setStatus({
        kind: 'success',
        message: `${result.template.name} v${result.template.latestVersion.versionNumber} was published.`,
        slug: result.template.slug,
        versionNumber: result.template.latestVersion.versionNumber
      });
      setState((current) => ({ ...current, template: result.template }));
      setForm({
        changelog: `Version ${result.template.latestVersion.versionNumber + 1}.`,
        templateJson: '',
        templateFileName: '',
        thumbnailPngBase64: '',
        thumbnailSource: 'none',
        thumbnailFileName: ''
      });
      setFieldError(undefined);
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Template version publishing failed.' });
    }
  }

  const template = state.template;
  const thumbnailPreviewSrc = form.thumbnailPngBase64 ? toPngPreviewSrc(form.thumbnailPngBase64) : undefined;
  const nextVersionNumber = template ? template.latestVersion.versionNumber + 1 : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <a className="font-semibold text-canvas-moss hover:underline" href={getMarketplaceMeHref()}>
          Back to my templates
        </a>
        <a className="font-semibold text-canvas-muted hover:text-canvas-ink hover:underline" href={getMarketplacePublishHref()}>
          Publish a new template
        </a>
      </div>

      <section className="border border-canvas-line bg-canvas-paper shadow-card">
        <div className="border-b border-canvas-line px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-canvas-moss">Version</p>
              <h1 className="mt-2 text-3xl font-semibold text-canvas-ink">Publish a new version</h1>
              <p className="mt-3 text-sm leading-6 text-canvas-muted">
                Upload a new template JSON for an existing listing. This creates a template version, keeps history immutable, and triggers installed-template update reminders.
              </p>
            </div>
            {state.user ? (
              <div className="flex flex-wrap items-center gap-3 text-sm leading-6 text-canvas-muted">
                <span>
                  Signed in as <span className="font-semibold text-canvas-ink">{state.user.githubLogin}</span>
                </span>
                <form action={buildSignOutFormAction(window.location.pathname + window.location.search)} method="post">
                  <button className="border border-canvas-line bg-canvas-paper px-3 py-1 font-semibold text-canvas-ink hover:border-canvas-moss" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>

        {state.loading ? (
          <div className="m-6 border border-canvas-line bg-canvas-mist p-5 text-sm text-canvas-muted sm:m-8">Loading version form...</div>
        ) : !state.user ? (
          <div className="m-6 border border-canvas-line bg-canvas-mist p-6 sm:m-8">
            <h2 className="text-lg font-semibold text-canvas-ink">GitHub sign-in required</h2>
            <p className="mt-2 text-sm leading-6 text-canvas-muted">Version publishing uses the original publisher identity for this template.</p>
            <a
              className="mt-5 inline-flex h-11 items-center bg-canvas-accent px-5 text-sm font-semibold text-canvas-accentText hover:brightness-110"
              href={buildGithubSignInHref(window.location.pathname + window.location.search)}
            >
              Sign in with GitHub
            </a>
          </div>
        ) : state.errorMessage ? (
          <div className="m-6 border border-canvas-errorLine bg-canvas-errorBg p-5 text-sm leading-6 text-canvas-error sm:m-8" role="alert">
            {state.errorMessage}
          </div>
        ) : template ? (
          <form className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_20rem]" onSubmit={handleSubmit} noValidate>
            <div className="grid gap-7 px-6 py-6 sm:px-8 sm:py-8">
              <section className="border border-canvas-line bg-canvas-mist p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-canvas-muted">Target listing</p>
                <h2 className="mt-2 text-2xl font-semibold text-canvas-ink">{template.name}</h2>
                <p className="mt-2 text-sm leading-6 text-canvas-muted">{template.description}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-sm text-canvas-muted">
                  <span>Current v{template.latestVersion.versionNumber}</span>
                  <span>{template.downloadCount.toLocaleString()} downloads</span>
                  <span>{template.likeCount.toLocaleString()} likes</span>
                </div>
              </section>

              <section>
                <StepHeading
                  eyebrow="Step 1"
                  title="Template JSON"
                  description="Choose the updated Dev Session Canvas template export. Listing name, slug, README, tags, and description stay unchanged in this version flow."
                />
                <label className="mt-4 block cursor-pointer border border-canvas-line bg-canvas-mist px-4 py-4 text-sm text-canvas-muted transition hover:border-canvas-moss">
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      void handleTemplateFile(file);
                    }}
                  />
                  <span className="mr-3 inline-flex bg-canvas-accent px-3 py-2 text-xs font-semibold text-canvas-accentText">Choose JSON</span>
                  <span>{form.templateFileName || 'No template JSON selected'}</span>
                </label>
                {fieldError ? (
                  <p className="mt-3 border border-canvas-errorLine bg-canvas-errorBg px-4 py-3 text-sm leading-6 text-canvas-error" role="alert">
                    {fieldError}
                  </p>
                ) : null}
              </section>

              <section className="border-t border-canvas-line pt-7">
                <StepHeading eyebrow="Step 2" title="Changelog" description={`Tell users what changed in v${nextVersionNumber ?? ''}.`} />
                <label className="mt-4 grid gap-2 text-sm font-semibold text-canvas-ink">
                  Update notes
                  <textarea
                    className="min-h-28 border border-canvas-line bg-canvas-paper px-4 py-3 text-sm font-normal leading-6 outline-none ring-canvas-accent/25 focus:ring-4"
                    value={form.changelog}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setForm((current) => ({ ...current, changelog: value }));
                    }}
                  />
                </label>
              </section>

              <details className="border-t border-canvas-line pt-5">
                <summary className="cursor-pointer text-sm font-semibold text-canvas-muted hover:text-canvas-ink focus:outline-none focus:ring-4 focus:ring-canvas-accent/25">
                  Template JSON preview
                </summary>
                <textarea
                  className="mt-5 min-h-48 w-full border border-canvas-line bg-canvas-paper px-4 py-3 font-mono text-xs font-normal leading-5 outline-none ring-canvas-accent/25 focus:ring-4"
                  value={form.templateJson}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setForm((current) => ({ ...current, templateJson: value }));
                    setFieldError(undefined);
                  }}
                />
              </details>
            </div>

            <aside className="border-t border-canvas-line bg-canvas-mist px-6 py-6 sm:px-8 lg:border-l lg:border-t-0">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-canvas-moss">Preview & publish</h2>
              <div className="mt-4 border border-canvas-line bg-canvas-paper p-3">
                {thumbnailPreviewSrc ? (
                  <img className="aspect-video w-full border border-canvas-line object-cover" src={thumbnailPreviewSrc} alt="Generated version thumbnail preview" />
                ) : (
                  <div className="grid aspect-video place-items-center border border-dashed border-canvas-line bg-canvas-sand px-5 text-center text-sm leading-6 text-canvas-muted">
                    Thumbnail preview appears after you choose a template JSON.
                  </div>
                )}
                <label className="mt-3 block cursor-pointer text-sm text-canvas-muted hover:text-canvas-ink">
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      void handleThumbnailFile(file);
                    }}
                  />
                  <span className="font-semibold text-canvas-moss">Replace with PNG</span>
                  <span className="mt-1 block text-xs leading-5">
                    {form.thumbnailSource === 'custom'
                      ? form.thumbnailFileName || 'Custom thumbnail ready.'
                      : form.thumbnailSource === 'generated'
                      ? 'Generated from the selected template layout.'
                      : 'Optional. A thumbnail is generated automatically.'}
                  </span>
                </label>
              </div>

              <dl className="mt-5 divide-y divide-canvas-line border-y border-canvas-line text-sm">
                <StatusRow label="Template" value={form.templateFileName || 'Not selected'} />
                <StatusRow label="Next version" value={nextVersionNumber ? `v${nextVersionNumber}` : 'Pending'} />
                <StatusRow label="Install impact" value="Installed users see an update badge" />
                <StatusRow label="Package" value="Generated from template JSON" />
              </dl>

              <button
                className="mt-6 h-11 w-full bg-canvas-accent px-6 text-sm font-semibold text-canvas-accentText hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={status.kind === 'loading'}
              >
                {status.kind === 'loading' ? 'Publishing...' : `Publish v${nextVersionNumber ?? ''}`}
              </button>
              <PublishVersionStatusMessage status={status} />
            </aside>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function StepHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }): JSX.Element {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-canvas-moss">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-canvas-ink">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-canvas-muted">{description}</p>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-canvas-muted">{label}</dt>
      <dd className="break-words text-canvas-ink">{value}</dd>
    </div>
  );
}

function PublishVersionStatusMessage({ status }: { status: PublishVersionStatus }): JSX.Element | null {
  if (status.kind === 'idle') {
    return null;
  }
  const className =
    status.kind === 'success'
      ? 'border-canvas-moss bg-canvas-paper text-canvas-ink'
      : status.kind === 'error'
      ? 'border-canvas-errorLine bg-canvas-errorBg text-canvas-error'
      : 'border-canvas-line bg-canvas-paper text-canvas-ink';
  return (
    <div className={`mt-4 border p-4 text-sm leading-6 ${className}`} role={status.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      {status.message}
      {status.slug ? (
        <a className="ml-3 font-semibold text-canvas-moss hover:underline" href={buildTemplateDetailHref(status.slug)}>
          View template
        </a>
      ) : null}
    </div>
  );
}

function parseTemplateDocumentFromJson(value: string): TemplateJsonValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { errorMessage: 'Template JSON is not valid JSON.' };
  }

  const result = marketplaceTemplateDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { errorMessage: `Template JSON is not a valid Dev Session Canvas template. ${path}${issue?.message ?? 'Check the file and try again.'}` };
  }

  return { document: result.data };
}

function toPngPreviewSrc(value: string): string {
  return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read file.')));
    reader.readAsDataURL(file);
  });
}
