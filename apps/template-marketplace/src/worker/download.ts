import type { MarketplaceDownloadResponse, MarketplacePackageDownloadResponse } from '@dev-session-canvas/marketplace-shared';

const TEMPLATE_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEMPLATE_PACKAGE_CONTENT_TYPE = 'application/zip';
const THUMBNAIL_CONTENT_TYPE = 'image/png';

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
  if (!headers.has('content-type')) {
    headers.set('content-type', TEMPLATE_PACKAGE_CONTENT_TYPE);
  }
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

function buildTemplateDownloadFilename(metadata: MarketplaceDownloadResponse): string {
  const safeTemplateId = metadata.templateId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${safeTemplateId}-v${metadata.versionNumber}.json`;
}

function buildTemplatePackageDownloadFilename(metadata: MarketplacePackageDownloadResponse): string {
  const safeTemplateId = metadata.templateId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${safeTemplateId}-v${metadata.versionNumber}.zip`;
}
