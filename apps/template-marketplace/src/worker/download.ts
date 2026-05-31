import { zipSync } from 'fflate';

import type {
  MarketplaceDownloadResponse,
  MarketplacePackageDownloadResponse,
  MarketplaceTemplateDetail,
  MarketplaceTemplatePackageManifest,
  MarketplaceTemplateVersion
} from '@dev-session-canvas/marketplace-shared';

const TEMPLATE_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEMPLATE_PACKAGE_CONTENT_TYPE = 'application/zip';
const THUMBNAIL_CONTENT_TYPE = 'image/png';
const EMPTY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAKB0nKcJwAAAABJRU5ErkJggg==';

export async function buildR2TemplateDownloadResponse(
  bucket: R2Bucket,
  metadata: MarketplaceDownloadResponse
): Promise<Response | undefined> {
  const object = await bucket.get(metadata.objectKey);
  if (!object) {
    return undefined;
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', TEMPLATE_JSON_CONTENT_TYPE);
  }
  headers.set('content-disposition', `attachment; filename="${buildTemplateDownloadFilename(metadata)}"`);
  headers.set('content-length', String(object.size));
  headers.set('cache-control', 'private, max-age=0, must-revalidate');
  headers.set('etag', object.httpEtag);
  headers.set('x-marketplace-storage-mode', 'r2');
  headers.set('x-marketplace-catalog-storage-mode', metadata.storageMode);
  headers.set('x-marketplace-template-id', metadata.templateId);
  headers.set('x-marketplace-version-id', metadata.versionId);
  headers.set('x-marketplace-sha256', metadata.sha256);

  return new Response(object.body, { headers });
}

export async function buildR2TemplateThumbnailResponse(bucket: R2Bucket, thumbnailKey: string): Promise<Response | undefined> {
  const object = await bucket.get(thumbnailKey);
  if (!object) {
    return undefined;
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', THUMBNAIL_CONTENT_TYPE);
  }
  headers.set('content-length', String(object.size));
  headers.set('cache-control', 'public, max-age=3600, s-maxage=86400');
  headers.set('etag', object.httpEtag);
  headers.set('x-marketplace-storage-mode', 'r2');

  return new Response(object.body, { headers });
}

export async function buildR2TemplatePackageDownloadResponse(
  bucket: R2Bucket,
  metadata: MarketplacePackageDownloadResponse
): Promise<Response | undefined> {
  const object = await bucket.get(metadata.packageObjectKey);
  if (!object) {
    return undefined;
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', TEMPLATE_PACKAGE_CONTENT_TYPE);
  headers.set('content-disposition', `attachment; filename="${buildTemplatePackageDownloadFilename(metadata)}"`);
  headers.set('content-length', String(object.size));
  headers.set('cache-control', 'private, max-age=0, must-revalidate');
  headers.set('etag', object.httpEtag);
  headers.set('x-marketplace-storage-mode', 'r2');
  headers.set('x-marketplace-catalog-storage-mode', metadata.storageMode);
  headers.set('x-marketplace-template-id', metadata.templateId);
  headers.set('x-marketplace-version-id', metadata.versionId);
  headers.set('x-marketplace-sha256', metadata.sha256);

  return new Response(object.body, { headers });
}

export async function buildR2TemplatePackageFromJsonResponse(
  bucket: R2Bucket,
  metadata: MarketplacePackageDownloadResponse,
  template: MarketplaceTemplateDetail,
  version: MarketplaceTemplateVersion
): Promise<Response | undefined> {
  const object = await bucket.get(metadata.objectKey);
  if (!object) {
    return undefined;
  }
  const templateJsonBytes = new Uint8Array(await object.arrayBuffer());
  const thumbnail = await bucket.get(version.thumbnailKey);
  const thumbnailBytes = thumbnail ? new Uint8Array(await thumbnail.arrayBuffer()) : decodeBase64(EMPTY_PNG_BASE64);
  const readme = template.readme?.trim() || `# ${template.name}\n\n${template.description}`;
  const changelog = version.changelog?.trim() || `Version ${version.versionNumber}.`;
  const manifest: MarketplaceTemplatePackageManifest = {
    schemaVersion: 1,
    slug: template.slug,
    name: template.name,
    description: template.description,
    tags: template.tags,
    template: 'template.json',
    readme: 'README.md',
    changelog: 'CHANGELOG.md',
    thumbnail: 'media/thumbnail.png',
    media: {
      thumbnail: 'media/thumbnail.png'
    },
    checksums: {
      templateSha256: metadata.sha256
    }
  };
  const packageZipBytes = zipSync(
    {
      'template-package.json': encodePrettyJson(manifest),
      'template.json': templateJsonBytes,
      'README.md': encodeText(`${readme.trimEnd()}\n`),
      'CHANGELOG.md': encodeText(`${changelog.trimEnd()}\n`),
      media: {
        'thumbnail.png': thumbnailBytes
      }
    },
    { level: 6, mtime: new Date('2026-01-01T00:00:00.000Z') }
  );
  const headers = buildTemplatePackageHeaders(metadata);
  headers.set('content-length', String(packageZipBytes.byteLength));
  headers.set('x-marketplace-package-source', 'generated-from-template-json');
  return new Response(packageZipBytes, {
    headers
  });
}

function buildTemplateDownloadFilename(metadata: MarketplaceDownloadResponse): string {
  const safeTemplateId = metadata.templateId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${safeTemplateId}-v${metadata.versionNumber}.json`;
}

function buildTemplatePackageDownloadFilename(metadata: MarketplacePackageDownloadResponse): string {
  const safeTemplateId = metadata.templateId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${safeTemplateId}-v${metadata.versionNumber}.zip`;
}

function buildTemplatePackageHeaders(metadata: MarketplacePackageDownloadResponse): Headers {
  const headers = new Headers();
  headers.set('content-type', TEMPLATE_PACKAGE_CONTENT_TYPE);
  headers.set('content-disposition', `attachment; filename="${buildTemplatePackageDownloadFilename(metadata)}"`);
  headers.set('cache-control', 'private, max-age=0, must-revalidate');
  headers.set('x-marketplace-storage-mode', 'r2');
  headers.set('x-marketplace-catalog-storage-mode', metadata.storageMode);
  headers.set('x-marketplace-template-id', metadata.templateId);
  headers.set('x-marketplace-version-id', metadata.versionId);
  headers.set('x-marketplace-sha256', metadata.sha256);
  return headers;
}

function encodePrettyJson(value: unknown): Uint8Array {
  return encodeText(`${JSON.stringify(value, null, 2)}\n`);
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
