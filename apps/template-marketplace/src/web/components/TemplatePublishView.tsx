import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { Zippable } from 'fflate';

import {
  generateMarketplaceTemplateThumbnailPngBase64,
  MARKETPLACE_SLUG_PATTERN,
  marketplaceTemplateDocumentSchema,
  marketplaceTemplatePackageManifestSchema,
  type MarketplaceTemplateDocument,
  type MarketplaceTemplatePackageManifest
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
import { checkMarketplaceSlugAvailability, loadCurrentMarketplaceUser, publishMarketplaceTemplate, publishMarketplaceTemplatePackage, type MarketplaceCurrentUser } from '../lib/api';

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
  packageFileName: string;
  packageWorktree?: ParsedTemplatePackageFile;
  packageSource: 'none' | 'zip';
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
  packageZip?: string;
}

interface SlugCheckState {
  kind: 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid' | 'error';
  message?: string;
  slug?: string;
}

type PublishTextField = 'name' | 'slug' | 'description' | 'tags' | 'readme' | 'changelog' | 'templateJson';

export interface PackageLintItem {
  kind: 'ok' | 'info' | 'warning' | 'error';
  label: string;
  message: string;
}

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
    thumbnailFileName: '',
    packageFileName: '',
    packageSource: 'none'
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
        ...(current.packageSource === 'zip' ? { name: '', slug: '', description: '', tags: '', readme: '', changelog: '' } : {}),
        templateJson: text,
        templateFileName: file.name,
        packageFileName: '',
        packageWorktree: undefined,
        packageSource: 'none',
        ...(current.thumbnailSource === 'custom' && current.packageSource !== 'zip'
          ? {}
          : { thumbnailPngBase64: '', thumbnailSource: 'none' as const, thumbnailFileName: '' })
      }));
      setFieldErrors((current) => ({ ...current, templateJson: `${file.name}: ${parsed.error}` }));
      setStatus({ kind: 'idle' });
      return;
    }

    setForm((current) => {
      const next = {
        ...current,
        templateJson: text,
        templateFileName: file.name,
        packageFileName: '',
        packageWorktree: undefined,
        packageSource: 'none' as const
      };
      const document = parsed.document;
      const switchingFromPackage = current.packageSource === 'zip';
      next.name = switchingFromPackage ? document.template.name || '' : current.name || document.template.name || '';
      next.slug = switchingFromPackage ? slugify(document.template.name || document.template.id || '') : current.slug || slugify(document.template.name || document.template.id || '');
      next.description = switchingFromPackage ? `Template for ${document.template.name || 'Dev Session Canvas'}.` : current.description || `Template for ${document.template.name || 'Dev Session Canvas'}.`;
      if (switchingFromPackage) {
        next.tags = '';
        next.readme = '';
        next.changelog = '';
      }
      if (switchingFromPackage || current.thumbnailSource !== 'custom') {
        next.thumbnailPngBase64 = generateMarketplaceTemplateThumbnailPngBase64(document);
        next.thumbnailSource = 'generated';
        next.thumbnailFileName = '';
      }
      return next;
    });
    setFieldErrors((current) => ({ ...current, templateJson: undefined }));
    setStatus({ kind: 'idle' });
  }

  async function handlePackageFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setForm((current) => ({
        ...current,
        name: '',
        slug: '',
        description: '',
        tags: '',
        readme: '',
        changelog: '',
        templateJson: '',
        templateFileName: '',
        thumbnailPngBase64: '',
        thumbnailSource: 'none',
        thumbnailFileName: '',
        packageFileName: file.name,
        packageWorktree: undefined,
        packageSource: 'none'
      }));
      setFieldErrors((current) => ({ ...current, packageZip: 'Template package must be a .zip file.' }));
      setStatus({ kind: 'idle' });
      return;
    }

    const parsed = await parseTemplatePackageFile(file);
    if (!parsed.package) {
      setForm((current) => ({
        ...current,
        name: '',
        slug: '',
        description: '',
        tags: '',
        readme: '',
        changelog: '',
        templateJson: '',
        templateFileName: '',
        thumbnailPngBase64: '',
        thumbnailSource: 'none',
        thumbnailFileName: '',
        packageFileName: file.name,
        packageWorktree: undefined,
        packageSource: 'none'
      }));
      setFieldErrors((current) => ({ ...current, packageZip: `${file.name}: ${parsed.error}` }));
      setStatus({ kind: 'idle' });
      return;
    }

    setForm((current) => ({
      ...current,
      name: parsed.package.manifest.name,
      slug: parsed.package.manifest.slug,
      description: parsed.package.manifest.description,
      tags: parsed.package.manifest.tags.join(', '),
      readme: parsed.package.readme,
      changelog: parsed.package.changelog,
      templateJson: parsed.package.templateJson,
      templateFileName: parsed.package.manifest.template,
      thumbnailPngBase64: parsed.package.thumbnailDataUrl,
      thumbnailSource: 'custom',
      thumbnailFileName: parsed.package.manifest.thumbnail,
      packageFileName: file.name,
      packageWorktree: parsed.package,
      packageSource: 'zip'
    }));
    setFieldErrors(() => ({ packageZip: undefined, templateJson: undefined }));
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

    if (form.packageSource === 'zip' && form.packageWorktree) {
      const parsed = parseTemplateDocumentFromJson(templateJson);
      if (!parsed.document) {
        setFieldErrors((current) => ({ ...current, templateJson: parsed.error }));
        setStatus({ kind: 'idle' });
        return;
      }
      try {
        const packageFile = await buildTemplatePackageFileFromForm(form, parsed.document);
        const result = await publishMarketplaceTemplatePackage(packageFile);
        window.history.pushState({}, '', buildMarketplacePublishSuccessHref(result.template.slug));
        setPublishedTemplate({ slug: result.template.slug, name: result.template.name });
        setStatus({
          kind: 'success',
          message: `${result.template.name} package was published.`,
          slug: result.template.slug
        });
      } catch (error) {
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Template package publishing failed.' });
      }
      return;
    }

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
  const packagePreview = useMemo(
    () => buildTemplatePackagePreview(form, fieldErrors, slugCheck),
    [form, fieldErrors, slugCheck]
  );

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
                <StepHeading eyebrow="Step 1" title="Template file" description="Upload a package.zip, or use a local template JSON exported by Dev Session Canvas." />
                <label className="mt-4 block cursor-pointer border border-canvas-line bg-canvas-paper px-4 py-4 text-sm text-canvas-muted transition hover:border-canvas-moss">
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/zip,.zip"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      void handlePackageFile(file);
                    }}
                  />
                  <span className="mr-3 inline-flex bg-canvas-ink px-3 py-2 text-xs font-semibold text-canvas-paper">Upload package.zip</span>
                  <span>{form.packageFileName || 'Advanced: publish a full template package with README media'}</span>
                </label>
                {fieldErrors.packageZip ? (
                  <p className="mt-3 border border-canvas-errorLine bg-canvas-errorBg px-4 py-3 text-sm leading-6 text-canvas-error" role="alert">
                    {fieldErrors.packageZip}
                  </p>
                ) : form.packageSource === 'zip' ? (
                  <p className="mt-3 border border-canvas-moss bg-canvas-paper px-4 py-3 text-sm leading-6 text-canvas-moss" role="status">
                    Package mode active. Fields below were filled from the zip; edits will be written into a rebuilt package when you publish.
                  </p>
                ) : null}
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
                {fieldErrors.templateJson ? (
                  <p className="mt-3 border border-canvas-errorLine bg-canvas-errorBg px-4 py-3 text-sm leading-6 text-canvas-error" role="alert">
                    {fieldErrors.templateJson}
                  </p>
                ) : null}
                <p className="mt-3 border border-canvas-line bg-canvas-mist px-4 py-3 text-sm leading-6 text-canvas-muted">
                  Uploads are mutually exclusive. Choosing JSON clears the package source; choosing package.zip switches back to Package mode.
                </p>
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
                <p className="mt-3 border border-canvas-line bg-canvas-mist px-4 py-3 text-sm leading-6 text-canvas-muted">
                  README images can use package-relative paths such as <code className="font-mono text-xs text-canvas-ink">./media/screenshot.png</code>.
                  Video demos should live in package media and are embedded only when package metadata declares them; external media links stay as plain links.
                </p>
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

              <PackageStructurePreview items={packagePreview.structure} />

              <PackageLintList items={packagePreview.lintItems} />

              <dl className="mt-5 divide-y divide-canvas-line border-y border-canvas-line text-sm">
                <StatusRow label="Template" value={form.templateFileName || 'Not selected'} />
                <StatusRow label="Thumbnail" value={form.thumbnailSource === 'custom' ? 'Custom PNG' : form.thumbnailSource === 'generated' ? 'Generated' : 'Pending'} />
                <StatusRow label="Package" value={form.packageSource === 'zip' ? form.packageFileName || 'package.zip ready' : 'Generated on publish'} />
                <StatusRow label="Package limit" value="50MB package / 5MB template JSON" />
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

function PackageStructurePreview({ items }: { items: string[] }): JSX.Element {
  return (
    <section className="mt-5 border border-canvas-line bg-canvas-paper p-4" aria-label="Template package structure">
      <h3 className="text-sm font-semibold text-canvas-ink">Template package structure</h3>
      <p className="mt-2 text-xs leading-5 text-canvas-muted">This form generates a package behind the scenes; advanced authors can later upload the same structure as a zip.</p>
      <pre className="mt-3 overflow-x-auto border border-canvas-line bg-canvas-sand p-3 font-mono text-xs leading-5 text-canvas-ink">{items.join('\n')}</pre>
    </section>
  );
}

function PackageLintList({ items }: { items: PackageLintItem[] }): JSX.Element {
  return (
    <section className="mt-4 border border-canvas-line bg-canvas-paper p-4" aria-label="Template package checks">
      <h3 className="text-sm font-semibold text-canvas-ink">Package checks</h3>
      <ul className="mt-3 grid gap-2 text-xs leading-5">
        {items.map((item) => (
          <li key={`${item.label}:${item.message}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <span className={packageLintBadgeClassName(item.kind)}>{packageLintBadgeLabel(item.kind)}</span>
            <span>
              <span className="font-semibold text-canvas-ink">{item.label}: </span>
              <span className={item.kind === 'error' ? 'text-canvas-error' : item.kind === 'warning' ? 'text-canvas-muted' : 'text-canvas-muted'}>{item.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function packageLintBadgeLabel(kind: PackageLintItem['kind']): string {
  switch (kind) {
    case 'ok':
      return 'OK';
    case 'warning':
      return 'WARN';
    case 'error':
      return 'ERR';
    default:
      return 'INFO';
  }
}

function packageLintBadgeClassName(kind: PackageLintItem['kind']): string {
  const base = 'mt-0.5 inline-flex h-5 min-w-10 items-center justify-center border px-1.5 text-[10px] font-semibold';
  if (kind === 'ok') {
    return `${base} border-canvas-moss bg-canvas-mist text-canvas-moss`;
  }
  if (kind === 'error') {
    return `${base} border-canvas-errorLine bg-canvas-errorBg text-canvas-error`;
  }
  if (kind === 'warning') {
    return `${base} border-canvas-line bg-canvas-sand text-canvas-ink`;
  }
  return `${base} border-canvas-line bg-canvas-paper text-canvas-muted`;
}

export function buildTemplatePackagePreview(
  form: PublishFormState,
  fieldErrors: PublishFieldErrors,
  slugCheck: SlugCheckState
): { structure: string[]; lintItems: PackageLintItem[] } {
  const structure = [
    'template-package/',
    '  template-package.json',
    '  template.json',
    '  README.md',
    '  CHANGELOG.md',
    '  media/',
    '    thumbnail.png'
  ];
  const lintItems: PackageLintItem[] = [];

  lintItems.push(
    form.templateJson.trim() && !fieldErrors.templateJson
      ? { kind: 'ok', label: 'Template JSON', message: 'Ready for the package and kept under the 5MB template-body limit.' }
      : { kind: 'error', label: 'Template JSON', message: 'Choose a valid Dev Session Canvas template before publishing.' }
  );

  if (slugCheck.kind === 'available') {
    lintItems.push({ kind: 'ok', label: 'Slug', message: 'Available for a new marketplace package.' });
  } else if (slugCheck.kind === 'invalid' || slugCheck.kind === 'unavailable' || slugCheck.kind === 'error') {
    lintItems.push({ kind: 'error', label: 'Slug', message: slugCheck.message ?? 'Resolve the slug issue before publishing.' });
  } else if (form.slug.trim()) {
    lintItems.push({ kind: 'info', label: 'Slug', message: 'Availability check is pending.' });
  } else {
    lintItems.push({ kind: 'info', label: 'Slug', message: 'A slug is generated from the template name if left blank.' });
  }

  lintItems.push(
    form.readme.trim()
      ? { kind: 'ok', label: 'README', message: 'Included as README.md for the marketplace detail page.' }
      : { kind: 'warning', label: 'README', message: 'Optional, but a README helps users understand when to install this template.' }
  );

  if (form.packageSource === 'zip') {
    lintItems.push({ kind: 'ok', label: 'Package mode', message: 'Form edits rebuild package.zip before upload, while preserving existing media/assets files.' });
  } else {
    lintItems.push({ kind: 'info', label: 'JSON mode', message: 'The Worker generates a minimal canonical package from this form.' });
  }

  const readmeMedia = collectReadmeMediaReferences(form.readme);
  if (readmeMedia.packageRelative.length > 0) {
    lintItems.push({ kind: 'info', label: 'README media', message: `${readmeMedia.packageRelative.length} package-relative media reference(s) will resolve from media/ or assets/.` });
  }
  if (readmeMedia.external.length > 0) {
    lintItems.push({ kind: 'warning', label: 'External media', message: 'External image or video URLs stay as plain links and are not embedded.' });
  }
  if (readmeMedia.blocked.length > 0) {
    lintItems.push({ kind: 'error', label: 'Blocked media path', message: 'README media must use ./media/... or ./assets/... paths.' });
  }
  if (readmeMedia.htmlEmbeds > 0) {
    lintItems.push({ kind: 'error', label: 'HTML media embed', message: 'Use Markdown images or declared package media instead of raw HTML embeds.' });
  }

  lintItems.push(
    form.thumbnailSource === 'none'
      ? { kind: 'info', label: 'Thumbnail', message: 'A thumbnail is generated after choosing a valid template JSON.' }
      : { kind: 'ok', label: 'Thumbnail', message: form.thumbnailSource === 'custom' ? 'Custom PNG will be saved as media/thumbnail.png.' : 'Generated PNG will be saved as media/thumbnail.png.' }
  );

  lintItems.push({ kind: 'info', label: 'Install impact', message: 'Publishing template.json creates a template version; future README or media-only edits should become listing revisions.' });

  return { structure, lintItems };
}

export function collectReadmeMediaReferences(readme: string): { packageRelative: string[]; external: string[]; blocked: string[]; htmlEmbeds: number } {
  const packageRelative: string[] = [];
  const external: string[] = [];
  const blocked: string[] = [];
  const markdownLinkPattern = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
  const mediaFilePattern = /\.(?:gif|jpe?g|mov|mp4|png|svg|webm|webp)(?:[?#].*)?$/iu;
  const htmlEmbeds = readme.match(/<(?:iframe|img|source|video)\b/giu)?.length ?? 0;
  for (const match of readme.matchAll(markdownLinkPattern)) {
    const marker = match[1] ?? '';
    const target = match[2]?.trim() ?? '';
    if (!target || (!marker && !mediaFilePattern.test(target))) {
      continue;
    }
    const normalizedTarget = normalizeReadmeMediaTarget(target);
    if (/^https:\/\//iu.test(normalizedTarget)) {
      external.push(target);
    } else if (isPackageRelativeReadmeMediaTarget(normalizedTarget)) {
      packageRelative.push(target);
    } else {
      blocked.push(target);
    }
  }
  return { packageRelative, external, blocked, htmlEmbeds };
}

interface ParsedTemplatePackageFile {
  manifest: MarketplaceTemplatePackageManifest;
  templateJson: string;
  readme: string;
  changelog: string;
  thumbnailDataUrl: string;
  entries: Map<string, Uint8Array>;
}

async function parseTemplatePackageFile(file: File): Promise<{ package: ParsedTemplatePackageFile; error?: never } | { package?: never; error: string }> {
  const { unzipSync } = await import('fflate');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { error: 'Package zip could not be opened.' };
  }

  const normalizedEntries = new Map<string, Uint8Array>();
  for (const [entryPath, bytes] of Object.entries(entries)) {
    if (entryPath.endsWith('/')) {
      continue;
    }
    const normalizedPath = normalizePackagePath(entryPath);
    if (!normalizedPath) {
      return { error: `Package path ${entryPath} is not safe.` };
    }
    normalizedEntries.set(normalizedPath, bytes);
  }

  const manifestText = decodePackageText(normalizedEntries.get('template-package.json'));
  if (!manifestText) {
    return { error: 'template-package.json is missing or not valid UTF-8.' };
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestText);
  } catch {
    return { error: 'template-package.json is not valid JSON.' };
  }
  const manifestResult = marketplaceTemplatePackageManifestSchema.safeParse(rawManifest);
  if (!manifestResult.success) {
    return { error: `template-package.json is invalid. ${manifestResult.error.issues[0]?.message ?? 'Check the manifest.'}` };
  }
  const manifest = manifestResult.data;

  const templateBytes = normalizedEntries.get(manifest.template);
  const readmeBytes = normalizedEntries.get(manifest.readme);
  const changelogBytes = normalizedEntries.get(manifest.changelog);
  const thumbnailBytes = normalizedEntries.get(manifest.thumbnail);
  if (!templateBytes || !readmeBytes || !changelogBytes || !thumbnailBytes) {
    return { error: 'Package must include template.json, README.md, CHANGELOG.md, and media/thumbnail.png.' };
  }

  const templateJson = decodePackageText(templateBytes);
  const readme = decodePackageText(readmeBytes);
  const changelog = decodePackageText(changelogBytes);
  if (!templateJson || readme === undefined || changelog === undefined) {
    return { error: 'Package text files must be valid UTF-8.' };
  }
  const parsedTemplate = parseTemplateDocumentFromJson(templateJson);
  if (!parsedTemplate.document) {
    return { error: parsedTemplate.error };
  }
  if (!isPngBytes(thumbnailBytes)) {
    return { error: 'media/thumbnail.png must be a PNG image.' };
  }

  const media = collectReadmeMediaReferences(readme);
  if (media.blocked.length > 0 || media.htmlEmbeds > 0) {
    return { error: 'README media must use ./media/... or ./assets/... Markdown paths, without raw HTML embeds.' };
  }
  for (const target of media.packageRelative) {
    const normalizedTarget = normalizePackagePath(normalizeReadmeMediaTarget(target).replace(/^\.\//u, ''));
    if (!normalizedTarget || !normalizedEntries.has(normalizedTarget)) {
      return { error: `README references missing media ${target}.` };
    }
  }

  return {
    package: {
      manifest,
      templateJson,
      readme,
      changelog,
      thumbnailDataUrl: `data:image/png;base64,${bytesToBase64(thumbnailBytes)}`,
      entries: normalizedEntries
    }
  };
}

export async function buildTemplatePackageFileFromForm(form: PublishFormState, templateDocument: MarketplaceTemplateDocument): Promise<File> {
  if (!form.packageWorktree) {
    throw new Error('Choose a package.zip before publishing in Package mode.');
  }
  const { zipSync } = await import('fflate');
  const encoder = new TextEncoder();
  const normalizedTemplateDocument = normalizeTemplateDocumentForPackageForm(form, templateDocument);
  const templateJsonBytes = encoder.encode(`${JSON.stringify(normalizedTemplateDocument, null, 2)}\n`);
  const manifest = await buildEditedPackageManifest(form, normalizedTemplateDocument, templateJsonBytes);
  const entries = new Map(form.packageWorktree.entries);
  const templatePath = manifest.template;
  const readmePath = manifest.readme;
  const changelogPath = manifest.changelog;
  const thumbnailPath = manifest.thumbnail;

  entries.set('template-package.json', encoder.encode(JSON.stringify(manifest, null, 2)));
  entries.set(templatePath, templateJsonBytes);
  entries.set(readmePath, encoder.encode(`${form.readme.trimEnd()}\n`));
  entries.set(changelogPath, encoder.encode(`${(form.changelog.trim() || 'Initial marketplace version.').trimEnd()}\n`));
  entries.set(thumbnailPath, thumbnailDataUrlToBytes(form.thumbnailPngBase64));

  const zippable: Zippable = {};
  for (const [entryPath, bytes] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    zippable[entryPath] = bytes;
  }
  const packageBytes = zipSync(zippable, { level: 6, mtime: new Date('2026-01-01T00:00:00.000Z') });
  return new File([packageBytes], form.packageFileName || 'template-package.zip', { type: 'application/zip' });
}

function normalizeTemplateDocumentForPackageForm(form: PublishFormState, templateDocument: MarketplaceTemplateDocument): MarketplaceTemplateDocument {
  return {
    ...templateDocument,
    template: {
      ...templateDocument.template,
      name: form.name.trim() || templateDocument.template.name,
      category: 'user'
    }
  };
}

async function buildEditedPackageManifest(
  form: PublishFormState,
  templateDocument: MarketplaceTemplateDocument,
  templateJsonBytes: Uint8Array
): Promise<MarketplaceTemplatePackageManifest> {
  const base = form.packageWorktree?.manifest;
  const templatePath = base?.template ?? 'template.json';
  const readmePath = base?.readme ?? 'README.md';
  const changelogPath = base?.changelog ?? 'CHANGELOG.md';
  const thumbnailPath = base?.thumbnail ?? base?.media?.thumbnail ?? 'media/thumbnail.png';
  const media = {
    ...(base?.media ?? {}),
    thumbnail: thumbnailPath
  };
  const checksums = {
    ...(base?.checksums ?? {}),
    templateSha256: await sha256Hex(templateJsonBytes)
  };
  const candidate: MarketplaceTemplatePackageManifest = {
    ...(base ?? {}),
    schemaVersion: 1,
    slug: form.slug.trim() || slugify(form.name || templateDocument.template.name || templateDocument.template.id || 'template'),
    name: form.name.trim(),
    description: form.description.trim(),
    tags: parseTags(form.tags),
    template: templatePath,
    readme: readmePath,
    changelog: changelogPath,
    thumbnail: thumbnailPath,
    media,
    checksums
  };
  const parsed = marketplaceTemplatePackageManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Package metadata is invalid. ${parsed.error.issues[0]?.message ?? 'Check the edited fields.'}`);
  }
  return parsed.data;
}

function normalizePackagePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/u, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) ||
    normalized.includes('\0')
  ) {
    return undefined;
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    return undefined;
  }
  return parts.join('/');
}

function decodePackageText(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

function thumbnailDataUrlToBytes(value: string): Uint8Array {
  const cleaned = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  if (!cleaned.trim()) {
    throw new Error('Choose or generate a PNG thumbnail before publishing.');
  }
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (!isPngBytes(bytes)) {
      throw new Error('Thumbnail must be a PNG image.');
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Thumbnail must be valid base64 encoded PNG data.');
  }
}

function isPngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeReadmeMediaTarget(target: string): string {
  const withoutFragment = target.split('#', 1)[0] ?? '';
  return withoutFragment.split('?', 1)[0] ?? '';
}

function isPackageRelativeReadmeMediaTarget(normalizedTarget: string): boolean {
  if (!/^\.\/(?:media|assets)\//u.test(normalizedTarget) || normalizedTarget.includes('\\')) {
    return false;
  }
  const decodedTarget = decodeReadmeMediaTarget(normalizedTarget);
  return !decodedTarget.includes('\\') && !decodedTarget.split('/').includes('..');
}

function decodeReadmeMediaTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
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
