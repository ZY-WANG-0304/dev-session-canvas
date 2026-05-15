import {
  buildMarketplaceSlugFromName,
  MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES,
  MARKETPLACE_MAX_THUMBNAIL_BYTES,
  marketplacePublishTemplateRequestSchema,
  marketplacePublishTemplateVersionRequestSchema,
  type MarketplacePublishTemplateRequest,
  type MarketplacePublishTemplateVersionRequest,
  type MarketplaceTemplateDetail
} from '@dev-session-canvas/marketplace-shared';

import type { MarketplaceAuthenticatedUser } from './auth';
import type { MarketplacePublishTemplateRecord } from './repository';

const PLACEHOLDER_THUMBNAIL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAKB0nKcJwAAAABJRU5ErkJggg==';

export interface PreparedMarketplacePublishTemplate {
  record: MarketplacePublishTemplateRecord;
  templateJsonBytes: Uint8Array;
  thumbnailBytes: Uint8Array;
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
}

export interface PreparePublishTemplateOptions {
  maxTemplateBytes?: number;
  now?: Date;
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
  const maxTemplateBytes = options.maxTemplateBytes ?? MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES;
  if (templateJsonBytes.byteLength > maxTemplateBytes) {
    throw new MarketplacePublishValidationError(
      'template_too_large',
      `Template JSON exceeds the configured ${maxTemplateBytes} byte limit.`,
      413
    );
  }

  const thumbnailBytes = decodeThumbnailBytes(request.thumbnailPngBase64);
  if (thumbnailBytes.byteLength > MARKETPLACE_MAX_THUMBNAIL_BYTES) {
    throw new MarketplacePublishValidationError(
      'thumbnail_too_large',
      `Thumbnail exceeds the configured ${MARKETPLACE_MAX_THUMBNAIL_BYTES} byte limit.`,
      413
    );
  }
  if (!isPng(thumbnailBytes)) {
    throw new MarketplacePublishValidationError('thumbnail_invalid', 'Thumbnail must be a PNG image.');
  }

  const objectKey = `templates/${templateId}/versions/1/template.json`;
  const thumbnailKey = `templates/${templateId}/versions/1/thumbnail.png`;
  const sha256 = await sha256Hex(templateJsonBytes);

  return {
    record: {
      templateId,
      versionId,
      slug,
      name: request.name,
      description: request.description,
      readme: request.readme?.trim() || buildDefaultReadme(request.name, request.description),
      tags: request.tags,
      providerWarnings: extractProviderWarnings(templateDocument),
      publisher,
      changelog: request.changelog?.trim() || 'Initial marketplace version.',
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
  const maxTemplateBytes = options.maxTemplateBytes ?? MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES;
  if (templateJsonBytes.byteLength > maxTemplateBytes) {
    throw new MarketplacePublishValidationError(
      'template_too_large',
      `Template JSON exceeds the configured ${maxTemplateBytes} byte limit.`,
      413
    );
  }

  const thumbnailBytes = decodeThumbnailBytes(request.thumbnailPngBase64);
  if (thumbnailBytes.byteLength > MARKETPLACE_MAX_THUMBNAIL_BYTES) {
    throw new MarketplacePublishValidationError(
      'thumbnail_too_large',
      `Thumbnail exceeds the configured ${MARKETPLACE_MAX_THUMBNAIL_BYTES} byte limit.`,
      413
    );
  }
  if (!isPng(thumbnailBytes)) {
    throw new MarketplacePublishValidationError('thumbnail_invalid', 'Thumbnail must be a PNG image.');
  }

  const versionId = `ver-${template.slug}-${nextVersionNumber}-${createShortId()}`;
  const objectKey = `templates/${template.id}/versions/${nextVersionNumber}/template.json`;
  const thumbnailKey = `templates/${template.id}/versions/${nextVersionNumber}/thumbnail.png`;
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
}

export function resolveMarketplaceMaxTemplateBytes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES;
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

function buildDefaultReadme(name: string, description: string): string {
  return `# ${name}\n\n${description}\n`;
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
