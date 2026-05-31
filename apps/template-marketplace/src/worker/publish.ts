import { unzipSync, zipSync, type Zippable } from 'fflate';

import {
  buildMarketplacePackageObjectKey,
  buildMarketplaceSlugFromName,
  MARKETPLACE_DEFAULT_MAX_PACKAGE_BYTES,
  MARKETPLACE_DEFAULT_MAX_PACKAGE_UNZIPPED_BYTES,
  MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES,
  MARKETPLACE_MAX_PACKAGE_FILES,
  MARKETPLACE_MAX_PACKAGE_MANIFEST_BYTES,
  MARKETPLACE_MAX_TEMPLATE_CHANGELOG_LENGTH,
  MARKETPLACE_MAX_TEMPLATE_README_LENGTH,
  MARKETPLACE_MAX_THUMBNAIL_BYTES,
  marketplacePublishTemplateRequestSchema,
  marketplacePublishTemplateVersionRequestSchema,
  marketplaceTemplateDocumentSchema,
  marketplaceTemplatePackageManifestSchema,
  normalizeMarketplacePackagePath,
  type MarketplacePublishTemplateRequest,
  type MarketplacePublishTemplateVersionRequest,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateDocument,
  type MarketplaceTemplatePackageManifest
} from '@dev-session-canvas/marketplace-shared';

import type { MarketplaceAuthenticatedUser } from './auth';
import type { MarketplacePublishTemplateRecord } from './repository';

const PLACEHOLDER_THUMBNAIL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAKB0nKcJwAAAABJRU5ErkJggg==';

export interface PreparedMarketplacePublishTemplate {
  record: MarketplacePublishTemplateRecord;
  templateJsonBytes: Uint8Array;
  thumbnailBytes: Uint8Array;
  packageZipBytes: Uint8Array;
  manifestJsonBytes: Uint8Array;
}

export interface PreparedMarketplacePublishTemplateVersion {
  record: {
    templateId: string;
    slug: string;
    versionId: string;
    versionNumber: number;
    changelog: string;
    objectKey: string;
    thumbnailKey: string;
    sha256: string;
    sizeBytes: number;
    schemaVersion: number;
    createdAt: string;
  };
  templateJsonBytes: Uint8Array;
  thumbnailBytes: Uint8Array;
  packageZipBytes?: Uint8Array;
  manifestJsonBytes?: Uint8Array;
}

export interface PreparePublishTemplateOptions {
  maxTemplateBytes?: number;
  maxPackageBytes?: number;
  maxPackageUnzippedBytes?: number;
  now?: Date;
}

interface PreparedPackagePayload {
  request: MarketplacePublishTemplateRequest;
  manifest: MarketplaceTemplatePackageManifest;
  entries: Map<string, PackageZipEntry>;
  templateJsonBytes: Uint8Array;
  thumbnailBytes: Uint8Array;
}

interface PackageZipEntry {
  path: string;
  bytes: Uint8Array;
}

export class MarketplacePublishValidationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = 'MarketplacePublishValidationError';
  }
}

export async function prepareMarketplacePublishTemplate(
  input: unknown,
  publisher: MarketplaceAuthenticatedUser,
  options: PreparePublishTemplateOptions = {}
): Promise<PreparedMarketplacePublishTemplate> {
  const parsed = marketplacePublishTemplateRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new MarketplacePublishValidationError('publish_request_invalid', parsed.error.issues[0]?.message ?? 'Publish request is invalid.');
  }

  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const request = parsed.data as MarketplacePublishTemplateRequest;
  assertSafePublishContent(collectPublishTemplateTextFields(request));
  const slug = request.slug?.trim() || buildMarketplaceSlugFromName(request.name);
  const templateId = `tmpl-${slug}-${createShortId()}`;
  const versionId = `ver-${slug}-1-${createShortId()}`;
  const templateDocument = normalizeTemplateDocumentForMarketplace(request, createdAt);
  const templateJson = `${JSON.stringify(templateDocument, null, 2)}\n`;
  const templateJsonBytes = new TextEncoder().encode(templateJson);
  assertTemplateByteLimit(templateJsonBytes, options.maxTemplateBytes);

  const thumbnailBytes = decodeThumbnailBytes(request.thumbnailPngBase64);
  assertThumbnailBytes(thumbnailBytes);

  const objectKey = `templates/${templateId}/versions/${versionId}/template.json`;
  const thumbnailKey = `templates/${templateId}/versions/${versionId}/thumbnail.png`;
  const sha256 = await sha256Hex(templateJsonBytes);
  const readme = request.readme?.trim() || buildDefaultReadme(request.name, request.description);
  const changelog = request.changelog?.trim() || 'Initial marketplace version.';
  const manifest = buildTemplatePackageManifestFromRequest({ ...request, readme, changelog }, sha256);
  const manifestJsonBytes = encodePrettyJson(manifest);
  const packageZipBytes = buildTemplatePackageZip(
    buildCanonicalPackageEntries({
      manifest,
      templateJsonBytes,
      readme,
      changelog,
      thumbnailBytes
    })
  );
  assertPackageZipByteLimit(packageZipBytes, options.maxPackageBytes);

  return {
    record: {
      templateId,
      versionId,
      slug,
      name: request.name,
      description: request.description,
      readme,
      tags: request.tags,
      providerWarnings: extractProviderWarnings(templateDocument),
      publisher,
      changelog,
      objectKey,
      thumbnailKey,
      sha256,
      sizeBytes: templateJsonBytes.byteLength,
      schemaVersion: templateDocument.version,
      createdAt
    },
    templateJsonBytes,
    thumbnailBytes,
    packageZipBytes,
    manifestJsonBytes
  };
}

export async function prepareMarketplacePublishTemplatePackage(
  packageZipBytes: Uint8Array,
  publisher: MarketplaceAuthenticatedUser,
  options: PreparePublishTemplateOptions = {}
): Promise<PreparedMarketplacePublishTemplate> {
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const packagePayload = await parseMarketplaceTemplatePackage(packageZipBytes, options);
  const request = packagePayload.request;
  const readme = request.readme?.trim() || buildDefaultReadme(request.name, request.description);
  const changelog = request.changelog?.trim() || 'Initial marketplace version.';
  assertSafePublishContent(collectPublishTemplateTextFields({ ...request, readme, changelog }));

  const slug = request.slug?.trim() || buildMarketplaceSlugFromName(request.name);
  const templateId = `tmpl-${slug}-${createShortId()}`;
  const versionId = `ver-${slug}-1-${createShortId()}`;
  const templateDocument = normalizeTemplateDocumentForMarketplace(request, createdAt);
  const templateJsonBytes = encodePrettyJson(templateDocument);
  assertTemplateByteLimit(templateJsonBytes, options.maxTemplateBytes);

  const objectKey = `templates/${templateId}/versions/${versionId}/template.json`;
  const thumbnailKey = `templates/${templateId}/versions/${versionId}/thumbnail.png`;
  const sha256 = await sha256Hex(templateJsonBytes);
  const manifest = buildTemplatePackageManifestFromUploadedPackage(packagePayload.manifest, { ...request, readme, changelog }, sha256);
  const manifestJsonBytes = encodePrettyJson(manifest);
  const canonicalPackageEntries = buildCanonicalPackageEntries({
    baseEntries: packagePayload.entries,
    manifest,
    templateJsonBytes,
    readme,
    changelog,
    thumbnailBytes: packagePayload.thumbnailBytes
  });
  assertPackageReadmeMediaReferences(readme, canonicalPackageEntries);
  assertManifestMediaEntries(manifest, canonicalPackageEntries);
  const canonicalPackageZipBytes = buildTemplatePackageZip(canonicalPackageEntries);
  assertPackageZipByteLimit(canonicalPackageZipBytes, options.maxPackageBytes);

  return {
    record: {
      templateId,
      versionId,
      slug,
      name: request.name,
      description: request.description,
      readme,
      tags: request.tags,
      providerWarnings: extractProviderWarnings(templateDocument),
      publisher,
      changelog,
      objectKey,
      thumbnailKey,
      sha256,
      sizeBytes: templateJsonBytes.byteLength,
      schemaVersion: templateDocument.version,
      createdAt
    },
    templateJsonBytes,
    thumbnailBytes: packagePayload.thumbnailBytes,
    packageZipBytes: canonicalPackageZipBytes,
    manifestJsonBytes
  };
}

export async function prepareMarketplacePublishTemplateVersion(
  input: unknown,
  template: MarketplaceTemplateDetail,
  nextVersionNumber: number,
  options: PreparePublishTemplateOptions = {}
): Promise<PreparedMarketplacePublishTemplateVersion> {
  const parsed = marketplacePublishTemplateVersionRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new MarketplacePublishValidationError('publish_request_invalid', parsed.error.issues[0]?.message ?? 'Publish request is invalid.');
  }

  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const request = parsed.data as MarketplacePublishTemplateVersionRequest;
  assertSafePublishContent(collectPublishTemplateVersionTextFields(request));
  const templateDocument = normalizeVersionDocumentForMarketplace(request, template, createdAt);
  const templateJson = `${JSON.stringify(templateDocument, null, 2)}\n`;
  const templateJsonBytes = new TextEncoder().encode(templateJson);
  assertTemplateByteLimit(templateJsonBytes, options.maxTemplateBytes);

  const thumbnailBytes = decodeThumbnailBytes(request.thumbnailPngBase64);
  assertThumbnailBytes(thumbnailBytes);

  const versionId = `ver-${template.slug}-${nextVersionNumber}-${createShortId()}`;
  const objectKey = `templates/${template.id}/versions/${versionId}/template.json`;
  const thumbnailKey = `templates/${template.id}/versions/${versionId}/thumbnail.png`;
  const sha256 = await sha256Hex(templateJsonBytes);

  return {
    record: {
      templateId: template.id,
      slug: template.slug,
      versionId,
      versionNumber: nextVersionNumber,
      changelog: request.changelog?.trim() || `Version ${nextVersionNumber}.`,
      objectKey,
      thumbnailKey,
      sha256,
      sizeBytes: templateJsonBytes.byteLength,
      schemaVersion: templateDocument.version,
      createdAt
    },
    templateJsonBytes,
    thumbnailBytes
  };
}

export async function writeMarketplaceTemplateObjects(
  bucket: R2Bucket,
  prepared: PreparedMarketplacePublishTemplate | PreparedMarketplacePublishTemplateVersion
): Promise<void> {
  await bucket.put(prepared.record.objectKey, prepared.templateJsonBytes, {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8'
    },
    customMetadata: {
      sha256: prepared.record.sha256
    }
  });
  await bucket.put(prepared.record.thumbnailKey, prepared.thumbnailBytes, {
    httpMetadata: {
      contentType: 'image/png'
    }
  });
  if (prepared.packageZipBytes) {
    await bucket.put(buildMarketplacePackageObjectKey(prepared.record.objectKey), prepared.packageZipBytes, {
      httpMetadata: {
        contentType: 'application/zip'
      },
      customMetadata: {
        templateSha256: prepared.record.sha256
      }
    });
  }
  if (prepared.manifestJsonBytes) {
    await bucket.put(buildMarketplaceManifestObjectKey(prepared.record.objectKey), prepared.manifestJsonBytes, {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8'
      }
    });
  }
}

export function resolveMarketplaceMaxTemplateBytes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES;
}

export function resolveMarketplaceMaxPackageBytes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MARKETPLACE_DEFAULT_MAX_PACKAGE_BYTES;
}

function normalizeTemplateDocumentForMarketplace(request: MarketplacePublishTemplateRequest, now: string): MarketplacePublishTemplateRequest['templateDocument'] {
  return {
    ...request.templateDocument,
    template: {
      ...request.templateDocument.template,
      name: request.name,
      category: 'user',
      updatedAt: now
    }
  };
}

function normalizeVersionDocumentForMarketplace(
  request: MarketplacePublishTemplateVersionRequest,
  template: MarketplaceTemplateDetail,
  now: string
): MarketplacePublishTemplateVersionRequest['templateDocument'] {
  return {
    ...request.templateDocument,
    template: {
      ...request.templateDocument.template,
      name: template.name,
      category: 'user',
      updatedAt: now
    }
  };
}

async function parseMarketplaceTemplatePackage(
  packageZipBytes: Uint8Array,
  options: PreparePublishTemplateOptions
): Promise<PreparedPackagePayload> {
  assertPackageZipByteLimit(packageZipBytes, options.maxPackageBytes);
  let rawEntries: Record<string, Uint8Array>;
  let totalUnzippedBytes = 0;
  try {
    rawEntries = unzipSync(packageZipBytes, {
      filter: (file) => {
        if (file.name.endsWith('/')) {
          return true;
        }
        const normalized = normalizeMarketplacePackagePath(file.name);
        if (!normalized) {
          throw new MarketplacePublishValidationError('package_path_invalid', `Package path ${file.name} is not safe.`);
        }
        totalUnzippedBytes += file.originalSize;
        if (totalUnzippedBytes > (options.maxPackageUnzippedBytes ?? MARKETPLACE_DEFAULT_MAX_PACKAGE_UNZIPPED_BYTES)) {
          throw new MarketplacePublishValidationError('package_unzipped_too_large', 'Template package expands beyond the configured unzipped size limit.', 413);
        }
        return true;
      }
    });
  } catch (error) {
    if (error instanceof MarketplacePublishValidationError) {
      throw error;
    }
    throw new MarketplacePublishValidationError('package_zip_invalid', 'Template package must be a valid zip archive.');
  }

  const entries = normalizePackageEntries(rawEntries);
  if (entries.size > MARKETPLACE_MAX_PACKAGE_FILES) {
    throw new MarketplacePublishValidationError('package_file_count_too_large', `Template package cannot contain more than ${MARKETPLACE_MAX_PACKAGE_FILES} files.`, 413);
  }

  const manifestBytes = requirePackageEntry(entries, 'template-package.json');
  if (manifestBytes.byteLength > MARKETPLACE_MAX_PACKAGE_MANIFEST_BYTES) {
    throw new MarketplacePublishValidationError('package_manifest_too_large', 'template-package.json exceeds the configured size limit.', 413);
  }
  const manifest = parsePackageManifest(manifestBytes);

  const templateJsonBytes = requirePackageEntry(entries, manifest.template);
  assertTemplateByteLimit(templateJsonBytes, options.maxTemplateBytes);
  const templateDocument = parsePackageTemplateDocument(templateJsonBytes);
  const readme = decodeUtf8Entry(requirePackageEntry(entries, manifest.readme), manifest.readme);
  const changelog = decodeUtf8Entry(requirePackageEntry(entries, manifest.changelog), manifest.changelog);
  if (readme.length > MARKETPLACE_MAX_TEMPLATE_README_LENGTH) {
    throw new MarketplacePublishValidationError('readme_too_large', 'README.md exceeds the configured size limit.', 413);
  }
  if (changelog.length > MARKETPLACE_MAX_TEMPLATE_CHANGELOG_LENGTH) {
    throw new MarketplacePublishValidationError('changelog_too_large', 'CHANGELOG.md exceeds the configured size limit.', 413);
  }
  const thumbnailBytes = requirePackageEntry(entries, manifest.thumbnail);
  assertThumbnailBytes(thumbnailBytes);
  assertPackageReadmeMediaReferences(readme, entries);
  assertManifestMediaEntries(manifest, entries);

  return {
    request: {
      slug: manifest.slug,
      name: manifest.name,
      description: manifest.description,
      tags: manifest.tags,
      readme,
      changelog,
      templateDocument,
      thumbnailPngBase64: bytesToBase64(thumbnailBytes)
    },
    manifest,
    entries,
    templateJsonBytes,
    thumbnailBytes
  };
}

function normalizePackageEntries(rawEntries: Record<string, Uint8Array>): Map<string, PackageZipEntry> {
  const entries = new Map<string, PackageZipEntry>();
  for (const [entryPath, bytes] of Object.entries(rawEntries)) {
    if (entryPath.endsWith('/')) {
      continue;
    }
    const normalized = normalizeMarketplacePackagePath(entryPath);
    if (!normalized) {
      throw new MarketplacePublishValidationError('package_path_invalid', `Package path ${entryPath} is not safe.`);
    }
    entries.set(normalized, { path: normalized, bytes });
  }
  return entries;
}

function parsePackageManifest(bytes: Uint8Array): MarketplaceTemplatePackageManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8Entry(bytes, 'template-package.json'));
  } catch {
    throw new MarketplacePublishValidationError('package_manifest_invalid', 'template-package.json must be valid JSON.');
  }
  const result = marketplaceTemplatePackageManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new MarketplacePublishValidationError('package_manifest_invalid', result.error.issues[0]?.message ?? 'template-package.json is invalid.');
  }
  return result.data;
}

function parsePackageTemplateDocument(bytes: Uint8Array): MarketplaceTemplateDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8Entry(bytes, 'template.json'));
  } catch {
    throw new MarketplacePublishValidationError('package_template_invalid', 'template.json must be valid JSON.');
  }
  const result = marketplaceTemplateDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new MarketplacePublishValidationError('package_template_invalid', `${path}${issue?.message ?? 'template.json is invalid.'}`);
  }
  return result.data;
}

function requirePackageEntry(entries: Map<string, PackageZipEntry>, path: string): Uint8Array {
  const normalized = normalizeMarketplacePackagePath(path);
  if (!normalized) {
    throw new MarketplacePublishValidationError('package_path_invalid', `Package path ${path} is not safe.`);
  }
  const entry = entries.get(normalized);
  if (!entry) {
    throw new MarketplacePublishValidationError('package_file_missing', `Template package is missing ${normalized}.`);
  }
  return entry.bytes;
}

function decodeUtf8Entry(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new MarketplacePublishValidationError('package_text_invalid', `${path} must be valid UTF-8 text.`);
  }
}

function assertPackageReadmeMediaReferences(readme: string, entries: Map<string, PackageZipEntry>): void {
  const markdownLinkPattern = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
  const mediaFilePattern = /\.(?:gif|jpe?g|mov|mp4|png|svg|webm|webp)(?:[?#].*)?$/iu;
  if (/<(?:iframe|img|source|video)\b/iu.test(readme)) {
    throw new MarketplacePublishValidationError('package_readme_media_invalid', 'README.md must not use raw HTML media embeds.');
  }
  for (const match of readme.matchAll(markdownLinkPattern)) {
    const marker = match[1] ?? '';
    const target = match[2]?.trim() ?? '';
    if (!target || (!marker && !mediaFilePattern.test(target))) {
      continue;
    }
    const normalizedTarget = normalizeReadmeMediaTarget(target);
    if (/^https:\/\//iu.test(normalizedTarget)) {
      continue;
    }
    if (!/^\.\/(?:media|assets)\//u.test(normalizedTarget)) {
      throw new MarketplacePublishValidationError('package_readme_media_invalid', 'README.md media must use ./media/... or ./assets/... package paths.');
    }
    const packagePath = decodeReadmeMediaTarget(normalizedTarget).replace(/^\.\//u, '');
    const normalizedPackagePath = normalizeMarketplacePackagePath(packagePath);
    if (!normalizedPackagePath || !entries.has(normalizedPackagePath)) {
      throw new MarketplacePublishValidationError('package_readme_media_missing', `README.md references missing media ${target}.`);
    }
  }
}

function assertManifestMediaEntries(manifest: MarketplaceTemplatePackageManifest, entries: Map<string, PackageZipEntry>): void {
  for (const item of manifest.media?.gallery ?? []) {
    requirePackageEntry(entries, item.path);
    if (item.poster) {
      requirePackageEntry(entries, item.poster);
    }
  }
}

function normalizeReadmeMediaTarget(target: string): string {
  const withoutFragment = target.split('#', 1)[0] ?? '';
  return withoutFragment.split('?', 1)[0] ?? '';
}

function decodeReadmeMediaTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function buildDefaultReadme(name: string, description: string): string {
  return `# ${name}\n\n${description}\n`;
}

function buildTemplatePackageManifestFromRequest(request: MarketplacePublishTemplateRequest, templateSha256: string): MarketplaceTemplatePackageManifest {
  return {
    schemaVersion: 1,
    slug: request.slug?.trim() || buildMarketplaceSlugFromName(request.name),
    name: request.name,
    description: request.description,
    tags: request.tags,
    template: 'template.json',
    readme: 'README.md',
    changelog: 'CHANGELOG.md',
    thumbnail: 'media/thumbnail.png',
    media: {
      thumbnail: 'media/thumbnail.png'
    },
    checksums: {
      templateSha256
    }
  };
}

function buildTemplatePackageManifestFromUploadedPackage(
  base: MarketplaceTemplatePackageManifest,
  request: MarketplacePublishTemplateRequest,
  templateSha256: string
): MarketplaceTemplatePackageManifest {
  const candidate: MarketplaceTemplatePackageManifest = {
    ...base,
    schemaVersion: 1,
    slug: request.slug?.trim() || buildMarketplaceSlugFromName(request.name),
    name: request.name,
    description: request.description,
    tags: request.tags,
    template: base.template,
    readme: base.readme,
    changelog: base.changelog,
    thumbnail: base.thumbnail,
    media: {
      ...(base.media ?? {}),
      thumbnail: base.thumbnail
    },
    checksums: {
      ...(base.checksums ?? {}),
      templateSha256
    }
  };
  const parsed = marketplaceTemplatePackageManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new MarketplacePublishValidationError('package_manifest_invalid', parsed.error.issues[0]?.message ?? 'template-package.json is invalid.');
  }
  return parsed.data;
}

function buildCanonicalPackageEntries({
  baseEntries,
  manifest,
  templateJsonBytes,
  readme,
  changelog,
  thumbnailBytes
}: {
  baseEntries?: Map<string, PackageZipEntry>;
  manifest: MarketplaceTemplatePackageManifest;
  templateJsonBytes: Uint8Array;
  readme: string;
  changelog: string;
  thumbnailBytes: Uint8Array;
}): Map<string, PackageZipEntry> {
  const encoder = new TextEncoder();
  const entries = new Map<string, PackageZipEntry>(baseEntries);
  setPackageEntry(entries, 'template-package.json', encodePrettyJson(manifest));
  setPackageEntry(entries, manifest.template, templateJsonBytes);
  setPackageEntry(entries, manifest.readme, encoder.encode(`${readme.trimEnd()}\n`));
  setPackageEntry(entries, manifest.changelog, encoder.encode(`${changelog.trimEnd()}\n`));
  setPackageEntry(entries, manifest.thumbnail, thumbnailBytes);
  return entries;
}

function setPackageEntry(entries: Map<string, PackageZipEntry>, path: string, bytes: Uint8Array): void {
  const normalized = normalizeMarketplacePackagePath(path);
  if (!normalized) {
    throw new MarketplacePublishValidationError('package_path_invalid', `Package path ${path} is not safe.`);
  }
  entries.set(normalized, { path: normalized, bytes });
}

function buildTemplatePackageZip(entries: Map<string, PackageZipEntry>): Uint8Array {
  const zippable: Zippable = {};
  for (const [entryPath, entry] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    zippable[entryPath] = entry.bytes;
  }
  return zipSync(zippable, { level: 6, mtime: new Date('2026-01-01T00:00:00.000Z') });
}

function buildMarketplaceManifestObjectKey(objectKey: string): string {
  const normalized = normalizeMarketplacePackagePath(objectKey) ?? objectKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const directory = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
  return directory ? `${directory}/manifest.json` : 'manifest.json';
}

function extractProviderWarnings(document: MarketplacePublishTemplateRequest['templateDocument']): string[] {
  const providers = new Set<string>();
  for (const node of document.template.nodes) {
    const provider = node.metadata?.agent?.provider;
    if (node.kind === 'agent' && provider && provider !== 'default') {
      providers.add(provider);
    }
  }
  return [...providers].sort().map((provider) => `Requires ${provider} provider`);
}

function collectPublishTemplateTextFields(request: MarketplacePublishTemplateRequest): Array<{ path: string; value: string }> {
  return [
    { path: 'name', value: request.name },
    { path: 'description', value: request.description },
    { path: 'readme', value: request.readme ?? '' },
    { path: 'changelog', value: request.changelog ?? '' },
    ...request.tags.map((tag, index) => ({ path: `tags[${index}]`, value: tag })),
    ...collectTemplateDocumentTextFields(request.templateDocument)
  ];
}

function collectPublishTemplateVersionTextFields(
  request: MarketplacePublishTemplateVersionRequest
): Array<{ path: string; value: string }> {
  return [
    { path: 'changelog', value: request.changelog ?? '' },
    ...collectTemplateDocumentTextFields(request.templateDocument)
  ];
}

function collectTemplateDocumentTextFields(
  document: MarketplacePublishTemplateRequest['templateDocument']
): Array<{ path: string; value: string }> {
  const fields: Array<{ path: string; value: string }> = [
    { path: 'template.name', value: document.template.name },
    { path: 'template.id', value: document.template.id }
  ];
  document.template.nodes.forEach((node, index) => {
    fields.push({ path: `template.nodes[${index}].title`, value: node.title });
    if (node.metadata?.note?.content) {
      fields.push({ path: `template.nodes[${index}].metadata.note.content`, value: node.metadata.note.content });
    }
    if (node.metadata?.note?.templateContentMode) {
      fields.push({
        path: `template.nodes[${index}].metadata.note.templateContentMode`,
        value: node.metadata.note.templateContentMode
      });
    }
    if (node.metadata?.note?.relativePath) {
      fields.push({ path: `template.nodes[${index}].metadata.note.relativePath`, value: node.metadata.note.relativePath });
    }
    node.metadata?.agent?.argv?.forEach((arg, argIndex) => {
      fields.push({ path: `template.nodes[${index}].metadata.agent.argv[${argIndex}]`, value: arg });
    });
  });
  document.template.edges.forEach((edge, index) => {
    if (edge.label) {
      fields.push({ path: `template.edges[${index}].label`, value: edge.label });
    }
  });
  return fields;
}

function assertSafePublishContent(fields: Array<{ path: string; value: string }>): void {
  for (const field of fields) {
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(field.value)) {
      throw new MarketplacePublishValidationError(
        'content_safety_failed',
        `Publish field ${field.path} contains unsupported control characters.`
      );
    }
    if (/\b(?:javascript|vbscript|command):/iu.test(field.value) || /\bdata:text\/html/iu.test(field.value)) {
      throw new MarketplacePublishValidationError(
        'content_safety_failed',
        `Publish field ${field.path} contains an unsupported executable link scheme.`
      );
    }
  }
}

function decodeThumbnailBytes(value: string | undefined): Uint8Array {
  const base64 = value?.trim() || PLACEHOLDER_THUMBNAIL_BASE64;
  const cleaned = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new MarketplacePublishValidationError('thumbnail_invalid', 'Thumbnail must be valid base64 encoded PNG data.');
  }
}

function assertTemplateByteLimit(bytes: Uint8Array, maxTemplateBytes = MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES): void {
  if (bytes.byteLength > maxTemplateBytes) {
    throw new MarketplacePublishValidationError(
      'template_too_large',
      `Template JSON exceeds the configured ${maxTemplateBytes} byte limit.`,
      413
    );
  }
}

function assertPackageZipByteLimit(bytes: Uint8Array, maxPackageBytes = MARKETPLACE_DEFAULT_MAX_PACKAGE_BYTES): void {
  if (bytes.byteLength > maxPackageBytes) {
    throw new MarketplacePublishValidationError(
      'package_too_large',
      `Template package exceeds the configured ${maxPackageBytes} byte limit.`,
      413
    );
  }
}

function assertThumbnailBytes(bytes: Uint8Array): void {
  if (bytes.byteLength > MARKETPLACE_MAX_THUMBNAIL_BYTES) {
    throw new MarketplacePublishValidationError(
      'thumbnail_too_large',
      `Thumbnail exceeds the configured ${MARKETPLACE_MAX_THUMBNAIL_BYTES} byte limit.`,
      413
    );
  }
  if (!isPng(bytes)) {
    throw new MarketplacePublishValidationError('thumbnail_invalid', 'Thumbnail must be a PNG image.');
  }
}

function isPng(bytes: Uint8Array): boolean {
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

function encodePrettyJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
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

function createShortId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
