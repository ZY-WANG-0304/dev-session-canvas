import { useEffect, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import {
  generateMarketplaceTemplateThumbnailPngBase64,
  MARKETPLACE_SLUG_PATTERN,
  marketplaceTemplateDocumentSchema,
  type MarketplaceTemplateDocument
} from '@dev-session-canvas/marketplace-shared';

import {
  buildGithubSignInHref,
  buildMarketplacePublishSuccessHref,
  buildSignOutHref,
  buildTemplateDetailHref,
  getMarketplaceHomeHref,
  getMarketplacePublishHref,
  isMarketplacePublishSuccessPath
} from '../lib/routing';
import { checkMarketplaceSlugAvailability, loadCurrentMarketplaceUser, publishMarketplaceTemplate, type MarketplaceCurrentUser } from '../lib/api';

interface PublishFormState {
  name: string;
  slug: string;
  description: string;
  tags: string;
  readme: string;
  changelog: string;
  templateJson: string;
  thumbnailPngBase64: string;
  thumbnailSource: 'none' | 'generated' | 'custom';
  templateFileName: string;
  thumbnailFileName: string;
}

interface PublishStatus {
  kind: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  slug?: string;
}

interface PublishedTemplateState {
  slug: string;
  name?: string;
}

interface PublishFieldErrors {
  templateJson?: string;
}

interface SlugCheckState {
  kind: 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid' | 'error';
  message?: string;
  slug?: string;
}

type PublishTextField = 'name' | 'slug' | 'description' | 'tags' | 'readme' | 'changelog' | 'templateJson';

export function TemplatePublishView(): JSX.Element {
  const [user, setUser] = useState<MarketplaceCurrentUser | undefined>();
  const [authLoading, setAuthLoading] = useState(true);
  const [status, setStatus] = useState<PublishStatus>({ kind: 'idle' });
  const [publishedTemplate, setPublishedTemplate] = useState<PublishedTemplateState | undefined>(() => readPublishedTemplateFromLocation());
  const [fieldErrors, setFieldErrors] = useState<PublishFieldErrors>({});
  const [slugCheck, setSlugCheck] = useState<SlugCheckState>({ kind: 'idle' });
  const [form, setForm] = useState<PublishFormState>({
    name: '',
    slug: '',
    description: '',
    tags: '',
    readme: '',
    changelog: '',
    templateJson: '',
    thumbnailPngBase64: '',
    thumbnailSource: 'none',
    templateFileName: '',
    thumbnailFileName: ''
  });

  useEffect(() => {
    let cancelled = false;
    void loadCurrentMarketplaceUser()
      .then((result) => {
        if (!cancelled) {
          setUser(result.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ kind: 'error', message: 'Unable to check GitHub sign-in status. Try refreshing the page.' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => setPublishedTemplate(readPublishedTemplateFromLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const slug = form.slug.trim();
    if (!slug) {
      setSlugCheck({ kind: 'idle' });
      return;
    }
    if (!MARKETPLACE_SLUG_PATTERN.test(slug)) {
      setSlugCheck({ kind: 'invalid', slug, message: 'Slug must use lowercase words separated by hyphens.' });
      return;
    }

    let cancelled = false;
    setSlugCheck({ kind: 'checking', slug, message: 'Checking slug availability...' });
    const timeout = window.setTimeout(() => {
      void checkMarketplaceSlugAvailability(slug)
        .then((result) => {
          if (cancelled || result.slug !== slug) {
            return;
          }
          setSlugCheck(
            result.available
              ? { kind: 'available', slug, message: 'Slug is available.' }
              : { kind: 'unavailable', slug, message: 'Slug is already used by another template.' }
          );
        })
        .catch((error) => {
          if (!cancelled) {
            setSlugCheck({
              kind: 'error',
              slug,
              message: error instanceof Error ? error.message : 'Unable to check slug availability.'
            });
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [form.slug]);

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
        ...(current.thumbnailSource === 'custom' ? {} : { thumbnailPngBase64: '', thumbnailSource: 'none' as const })
      }));
      setFieldErrors((current) => ({ ...current, templateJson: `${file.name}: ${parsed.error}` }));
      setStatus({ kind: 'idle' });
      return;
    }

    setForm((current) => {
      const next = { ...current, templateJson: text, templateFileName: file.name };
      const document = parsed.document;
      next.name = current.name || document.template.name || '';
      next.slug = current.slug || slugify(document.template.name || document.template.id || '');
      next.description = current.description || `Template for ${document.template.name || 'Dev Session Canvas'}.`;
      if (current.thumbnailSource !== 'custom') {
        next.thumbnailPngBase64 = generateMarketplaceTemplateThumbnailPngBase64(document);
        next.thumbnailSource = 'generated';
      }
      return next;
    });
    setFieldErrors((current) => ({ ...current, templateJson: undefined }));
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
    setForm((current) => ({ ...current, thumbnailPngBase64, thumbnailSource: 'custom', thumbnailFileName: file.name }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = form.name.trim();
    const description = form.description.trim();
    const slug = form.slug.trim();
    const templateJson = form.templateJson.trim();
    if (!templateJson) {
      setFieldErrors((current) => ({ ...current, templateJson: 'Choose a template JSON before publishing.' }));
      setStatus({ kind: 'idle' });
      return;
    }
    if (!name) {
      setStatus({ kind: 'error', message: 'Name is required before publishing.' });
      return;
    }
    if (!description) {
      setStatus({ kind: 'error', message: 'Description is required before publishing.' });
      return;
    }
    if (slug && (slugCheck.kind === 'invalid' || slugCheck.kind === 'unavailable')) {
      setStatus({ kind: 'error', message: 'Resolve the slug issue before publishing.' });
      return;
    }
    if (slug && slugCheck.kind === 'checking') {
      setStatus({ kind: 'error', message: 'Wait for the slug availability check to finish.' });
      return;
    }

    setStatus({ kind: 'loading', message: 'Publishing template...' });

    const parsed = parseTemplateDocumentFromJson(templateJson);
    if (!parsed.document) {
      setFieldErrors((current) => ({ ...current, templateJson: parsed.error }));
      setStatus({ kind: 'idle' });
      return;
    }
    const templateDocument = parsed.document;

    try {
      const result = await publishMarketplaceTemplate({
        slug: slug || undefined,
        name,
        description,
        tags: parseTags(form.tags),
        readme: form.readme || undefined,
        changelog: form.changelog || undefined,
        templateDocument,
        thumbnailPngBase64:
          form.thumbnailSource === 'custom'
            ? form.thumbnailPngBase64
            : generateMarketplaceTemplateThumbnailPngBase64(templateDocument)
      });
      window.history.pushState({}, '', buildMarketplacePublishSuccessHref(result.template.slug));
      setPublishedTemplate({ slug: result.template.slug, name: result.template.name });
      setStatus({
        kind: 'success',
        message: `${result.template.name} was published.`,
        slug: result.template.slug
      });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Template publishing failed.' });
    }
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (event.key === 'Enter' && target.type !== 'submit' && target.type !== 'file') {
      event.preventDefault();
    }
  }

  const thumbnailPreviewSrc = form.thumbnailPngBase64 ? toPngPreviewSrc(form.thumbnailPngBase64) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 text-sm">
        <a className="font-semibold text-canvas-moss hover:underline" href={getMarketplaceHomeHref()}>
          Back to templates
        </a>
      </div>

      <section className="border border-canvas-line bg-canvas-paper shadow-card">
        <div className="border-b border-canvas-line px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-canvas-moss">Publish</p>
              <h1 className="mt-2 text-3xl font-semibold text-canvas-ink">Publish a template</h1>
              <p className="mt-3 text-sm leading-6 text-canvas-muted">
                Choose a DevSessionCanvas template JSON, review the generated marketplace details, and publish it to Templates.
              </p>
            </div>
            {user ? (
              <div className="flex flex-wrap items-center gap-3 text-sm leading-6 text-canvas-muted">
                <span>
                  Signed in as <span className="font-semibold text-canvas-ink">{user.githubLogin}</span>
                </span>
                <form action={buildSignOutHref(getMarketplacePublishHref())} method="post">
                  <button className="border border-canvas-line bg-canvas-paper px-3 py-1 font-semibold text-canvas-ink hover:border-canvas-moss" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>

        {publishedTemplate ? (
          <PublishSuccessView template={publishedTemplate} />
        ) : authLoading ? (
          <div className="m-6 border border-canvas-line bg-canvas-mist p-5 text-sm text-canvas-muted sm:m-8">Checking GitHub sign-in...</div>
        ) : !user ? (
          <div className="m-6 border border-canvas-line bg-canvas-mist p-6 sm:m-8">
            <h2 className="text-lg font-semibold text-canvas-ink">GitHub sign-in required</h2>
            <p className="mt-2 text-sm leading-6 text-canvas-muted">Publishing uses GitHub identity so templates have an accountable publisher.</p>
            <a
              className="mt-5 inline-flex h-11 items-center bg-canvas-accent px-5 text-sm font-semibold text-canvas-accentText hover:brightness-110"
              href={buildGithubSignInHref(getMarketplacePublishHref())}
            >
              Sign in with GitHub
            </a>
          </div>
        ) : (
          <form className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_20rem]" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} noValidate>
            <div className="grid gap-7 px-6 py-6 sm:px-8 sm:py-8">
              <section>
                <StepHeading eyebrow="Step 1" title="Template file" description="Upload the local template JSON exported by Dev Session Canvas." />
                <label className="mt-4 block cursor-pointer border border-canvas-line bg-canvas-mist px-4 py-4 text-sm text-canvas-muted transition hover:border-canvas-moss">
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void handleTemplateFile(event.currentTarget.files?.[0])}
                  />
                  <span className="mr-3 inline-flex bg-canvas-accent px-3 py-2 text-xs font-semibold text-canvas-accentText">Choose JSON</span>
                  <span>{form.templateFileName || 'No template JSON selected'}</span>
                </label>
                {fieldErrors.templateJson ? (
                  <p className="mt-3 border border-canvas-errorLine bg-canvas-errorBg px-4 py-3 text-sm leading-6 text-canvas-error" role="alert">
                    {fieldErrors.templateJson}
                  </p>
                ) : null}
              </section>

              <section className="border-t border-canvas-line pt-7">
                <StepHeading eyebrow="Step 2" title="Marketplace details" description="These fields are public. Name and description are required; slug can stay auto-generated." />
                <div className="mt-4 grid items-start gap-5 md:grid-cols-2">
                  <TextInput label="Name" value={form.name} onChange={(value) => updateFormField('name', value)} required />
                  <div className="grid min-h-20 grid-rows-[auto_auto_1.25rem] gap-2 text-sm font-semibold text-canvas-ink">
                    <label htmlFor="publishTemplateSlug">Slug</label>
                    <input
                      id="publishTemplateSlug"
                      className="border border-canvas-line bg-canvas-paper px-4 py-3 text-sm font-normal outline-none ring-canvas-accent/25 focus:ring-4"
                      placeholder="generated-from-name"
                      value={form.slug}
                      onChange={(event) => updateFormField('slug', event.currentTarget.value)}
                    />
                    <SlugCheckMessage state={slugCheck} />
                  </div>
                </div>

                <label className="mt-5 grid gap-2 text-sm font-semibold text-canvas-ink">
                  Description
                  <input
                    className="border border-canvas-line bg-canvas-paper px-4 py-3 text-sm font-normal outline-none ring-canvas-accent/25 focus:ring-4"
                    value={form.description}
                    onChange={(event) => updateFormField('description', event.currentTarget.value)}
                    required
                  />
                </label>

                <label className="mt-5 grid gap-2 text-sm font-semibold text-canvas-ink">
                  Tags
                  <input
                    className="border border-canvas-line bg-canvas-paper px-4 py-3 text-sm font-normal outline-none ring-canvas-accent/25 focus:ring-4"
                    placeholder="review, quality, agent"
                    value={form.tags}
                    onChange={(event) => updateFormField('tags', event.currentTarget.value)}
                  />
                </label>
              </section>

              <details className="border-t border-canvas-line pt-5">
                <summary className="cursor-pointer text-sm font-semibold text-canvas-muted hover:text-canvas-ink focus:outline-none focus:ring-4 focus:ring-canvas-accent/25">
                  Optional README, changelog, and JSON preview
                </summary>
                <div className="mt-5 grid gap-5">
                  <label className="grid gap-2 text-sm font-semibold text-canvas-ink">
                    README
                    <textarea
                      className="min-h-28 border border-canvas-line bg-canvas-paper px-4 py-3 text-sm font-normal leading-6 outline-none ring-canvas-accent/25 focus:ring-4"
                      value={form.readme}
                      onChange={(event) => updateFormField('readme', event.currentTarget.value)}
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-semibold text-canvas-ink">
                    Changelog
                    <textarea
                      className="min-h-24 border border-canvas-line bg-canvas-paper px-4 py-3 text-sm font-normal leading-6 outline-none ring-canvas-accent/25 focus:ring-4"
                      placeholder="Initial marketplace version."
                      value={form.changelog}
                      onChange={(event) => updateFormField('changelog', event.currentTarget.value)}
                    />
                  </label>

                  <label className="grid gap-2 text-sm font-semibold text-canvas-ink">
                    Template JSON preview
                    <textarea
                      className="min-h-36 border border-canvas-line bg-canvas-paper px-4 py-3 font-mono text-xs font-normal leading-5 outline-none ring-canvas-accent/25 focus:ring-4"
                      value={form.templateJson}
                      onChange={(event) => updateFormField('templateJson', event.currentTarget.value)}
                    />
                  </label>
                </div>
              </details>

            </div>

            <aside className="border-t border-canvas-line bg-canvas-mist px-6 py-6 sm:px-8 lg:border-l lg:border-t-0">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-canvas-moss">Preview & publish</h2>
              <div className="mt-4 border border-canvas-line bg-canvas-paper p-3">
                {thumbnailPreviewSrc ? (
                  <img className="aspect-video w-full border border-canvas-line object-cover" src={thumbnailPreviewSrc} alt="Generated template thumbnail preview" />
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
                    onChange={(event) => void handleThumbnailFile(event.currentTarget.files?.[0])}
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
                <StatusRow label="Thumbnail" value={form.thumbnailSource === 'custom' ? 'Custom PNG' : form.thumbnailSource === 'generated' ? 'Generated' : 'Pending'} />
                <StatusRow label="Limit" value="Template JSON defaults to 5MB" />
              </dl>

              <button
                className="mt-6 h-11 w-full bg-canvas-accent px-6 text-sm font-semibold text-canvas-accentText hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={status.kind === 'loading'}
              >
                {status.kind === 'loading' ? 'Publishing...' : 'Publish template'}
              </button>
              <PublishStatusMessage status={status} />
            </aside>
          </form>
        )}
      </section>
    </div>
  );

  function updateFormField(field: PublishTextField, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }
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

function PublishSuccessView({ template }: { template: PublishedTemplateState }): JSX.Element {
  const detailHref = buildTemplateDetailHref(template.slug);
  return (
    <div className="m-6 border border-canvas-moss bg-canvas-mist p-6 sm:m-8 sm:p-8" role="status" aria-live="polite">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-canvas-moss">Published</p>
      <h2 className="mt-2 text-2xl font-semibold text-canvas-ink">Template published successfully</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-canvas-muted">
        {template.name ? `${template.name} is now available in Templates.` : 'Your template is now available in Templates.'}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a className="inline-flex h-11 items-center bg-canvas-accent px-5 text-sm font-semibold text-canvas-accentText hover:brightness-110" href={detailHref}>
          View template detail
        </a>
        <a className="inline-flex h-11 items-center border border-canvas-line bg-canvas-paper px-5 text-sm font-semibold text-canvas-ink hover:border-canvas-moss" href={getMarketplacePublishHref()}>
          Publish another template
        </a>
      </div>
    </div>
  );
}

function TextInput({
  label,
  value,
  placeholder,
  required,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="grid gap-2 text-sm font-semibold text-canvas-ink">
      {label}
      <input
        className="border border-canvas-line bg-canvas-paper px-4 py-3 text-sm font-normal outline-none ring-canvas-accent/25 focus:ring-4"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        required={required}
      />
    </label>
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

function SlugCheckMessage({ state }: { state: SlugCheckState }): JSX.Element | null {
  if (state.kind === 'idle' || !state.message) {
    return null;
  }
  const isBlocking = state.kind === 'invalid' || state.kind === 'unavailable' || state.kind === 'error';
  const className = isBlocking ? 'text-canvas-error' : state.kind === 'available' ? 'text-canvas-moss' : 'text-canvas-muted';
  return (
    <span className={`text-xs font-normal leading-5 ${className}`} role={isBlocking ? 'alert' : 'status'} aria-live="polite">
      {state.message}
    </span>
  );
}

function PublishStatusMessage({ status }: { status: PublishStatus }): JSX.Element | null {
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

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseTemplateDocumentFromJson(value: string): { document: MarketplaceTemplateDocument; error?: never } | { document?: never; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'Template JSON is not valid JSON.' };
  }

  const result = marketplaceTemplateDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { error: `Template JSON is not a valid Dev Session Canvas template. ${path}${issue?.message ?? 'Check the file and try again.'}` };
  }

  return { document: result.data };
}

function readPublishedTemplateFromLocation(): PublishedTemplateState | undefined {
  if (!isMarketplacePublishSuccessPath(window.location.pathname)) {
    return undefined;
  }
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('template')?.trim();
  if (!slug) {
    return undefined;
  }
  const name = params.get('name')?.trim() || undefined;
  return { slug, name };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
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
