import { z } from 'zod';

export const MARKETPLACE_API_VERSION = 'v1' as const;
export const MARKETPLACE_DEFAULT_PAGE_SIZE = 12;
export const MARKETPLACE_MAX_PAGE_SIZE = 50;
export const MARKETPLACE_QUERY_MAX_LENGTH = 80;
export const MARKETPLACE_SORT_VALUES = ['hot', 'downloads', 'likes', 'newest', 'updated'] as const;
export const MARKETPLACE_TEMPLATE_STATUS_VALUES = ['published', 'delisted'] as const;
export const MARKETPLACE_VERSION_STATUS_VALUES = ['published', 'rejected'] as const;
export const MARKETPLACE_STORAGE_MODES = ['seed', 'd1', 'r2'] as const;
export const MARKETPLACE_TEMPLATE_NODE_KINDS = ['agent', 'terminal', 'note'] as const;
export const MARKETPLACE_TEMPLATE_AGENT_PROVIDERS = ['default', 'codex', 'claude'] as const;
export const MARKETPLACE_TEMPLATE_NOTE_CONTENT_MODES = [
  'embedded-snapshot',
  'workspace-file-path-only',
  'workspace-file-with-content'
] as const;
export const MARKETPLACE_DEFAULT_MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;
export const MARKETPLACE_DEFAULT_MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
export const MARKETPLACE_DEFAULT_MAX_PACKAGE_UNZIPPED_BYTES = 100 * 1024 * 1024;
export const MARKETPLACE_MAX_PACKAGE_FILES = 100;
export const MARKETPLACE_MAX_PACKAGE_MANIFEST_BYTES = 64 * 1024;
export const MARKETPLACE_MAX_THUMBNAIL_BYTES = 1024 * 1024;
export const MARKETPLACE_MAX_TEMPLATE_NAME_LENGTH = 80;
export const MARKETPLACE_MAX_TEMPLATE_DESCRIPTION_LENGTH = 240;
export const MARKETPLACE_MAX_TEMPLATE_README_LENGTH = 1024 * 1024;
export const MARKETPLACE_TEMPLATE_README_WARNING_BYTES = 512 * 1024;
export const MARKETPLACE_MAX_TEMPLATE_CHANGELOG_LENGTH = 256 * 1024;
export const MARKETPLACE_MAX_TAGS_PER_TEMPLATE = 10;
export const MARKETPLACE_MAX_TAG_LENGTH = 32;
export const MARKETPLACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MARKETPLACE_PACKAGE_MEDIA_TYPES = ['image', 'video'] as const;

export type MarketplaceSort = (typeof MARKETPLACE_SORT_VALUES)[number];
export type MarketplaceTemplateStatus = (typeof MARKETPLACE_TEMPLATE_STATUS_VALUES)[number];
export type MarketplaceVersionStatus = (typeof MARKETPLACE_VERSION_STATUS_VALUES)[number];
export type MarketplaceStorageMode = (typeof MARKETPLACE_STORAGE_MODES)[number];
export type MarketplaceTemplateNodeKind = (typeof MARKETPLACE_TEMPLATE_NODE_KINDS)[number];
export type MarketplaceTemplateAgentProviderKind = (typeof MARKETPLACE_TEMPLATE_AGENT_PROVIDERS)[number];
export type MarketplaceTemplateNoteContentMode = (typeof MARKETPLACE_TEMPLATE_NOTE_CONTENT_MODES)[number];
export type MarketplaceTemplatePackageMediaType = (typeof MARKETPLACE_PACKAGE_MEDIA_TYPES)[number];

export interface MarketplacePublisherSummary {
  id: string;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
}

export interface MarketplaceTemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  changelog: string;
  objectKey: string;
  thumbnailKey: string;
  sha256: string;
  sizeBytes: number;
  schemaVersion: number;
  status: MarketplaceVersionStatus;
  createdAt: string;
}

export interface MarketplaceTemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  publisher: MarketplacePublisherSummary;
  latestVersion: MarketplaceTemplateVersion;
  status: MarketplaceTemplateStatus;
  downloadCount: number;
  likeCount: number;
  hotScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceTemplateDetail extends MarketplaceTemplateSummary {
  versions: MarketplaceTemplateVersion[];
  readme: string;
  providerWarnings: string[];
}

export interface MarketplaceListTemplatesRequest {
  q?: string;
  tags?: string[];
  sort?: MarketplaceSort;
  page?: number;
  pageSize?: number;
}

export interface MarketplacePagination {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface MarketplaceListTemplatesResponse {
  items: MarketplaceTemplateSummary[];
  pagination: MarketplacePagination;
  storageMode: MarketplaceStorageMode;
}

export interface MarketplaceTemplateDetailResponse {
  template: MarketplaceTemplateDetail;
  storageMode: MarketplaceStorageMode;
}

export interface MarketplaceDownloadResponse {
  templateId: string;
  versionId: string;
  versionNumber: number;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  storageMode: MarketplaceStorageMode;
  downloadUrl: string;
}

export interface MarketplacePackageDownloadResponse extends MarketplaceDownloadResponse {
  packageObjectKey: string;
  packageDownloadUrl: string;
}

export interface MarketplaceTemplatePackageManifest {
  schemaVersion: 1;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  template: string;
  readme: string;
  changelog: string;
  thumbnail: string;
  version?: string;
  minExtensionVersion?: string;
  providers?: MarketplaceTemplateAgentProviderKind[];
  media?: {
    thumbnail?: string;
    gallery?: MarketplaceTemplatePackageMediaItem[];
  };
  license?: string;
  homepage?: string;
  repository?: string;
  checksums?: {
    templateSha256?: string;
  };
}

export interface MarketplaceTemplatePackageMediaItem {
  type: MarketplaceTemplatePackageMediaType;
  path: string;
  alt?: string;
  title?: string;
  poster?: string;
}

export interface MarketplaceTemplateDocument {
  version: 1;
  template: {
    id: string;
    name: string;
    category: 'builtin' | 'user';
    nodes: MarketplaceTemplateNodeSnapshot[];
    edges: MarketplaceTemplateEdgeSnapshot[];
    createdAt: string;
    updatedAt: string;
  };
}

export interface MarketplaceTemplateNodeSnapshot {
  kind: MarketplaceTemplateNodeKind;
  title: string;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  metadata?: {
    note?: {
      content: string;
      templateContentMode?: MarketplaceTemplateNoteContentMode;
      relativePath?: string;
    };
    agent?: {
      provider: MarketplaceTemplateAgentProviderKind;
      argv?: string[];
    };
  };
}

export interface MarketplaceTemplateEdgeSnapshot {
  sourceNodeIndex: number;
  targetNodeIndex: number;
  sourceAnchor: 'top' | 'right' | 'bottom' | 'left';
  targetAnchor: 'top' | 'right' | 'bottom' | 'left';
  arrowMode: 'none' | 'forward' | 'both';
  color?: string;
  label?: string;
}

export interface MarketplacePublishTemplateRequest {
  slug?: string;
  name: string;
  description: string;
  tags: string[];
  readme?: string;
  changelog?: string;
  templateDocument: MarketplaceTemplateDocument;
  thumbnailPngBase64?: string;
}

export interface MarketplacePublishTemplateVersionRequest {
  changelog?: string;
  templateDocument: MarketplaceTemplateDocument;
  thumbnailPngBase64?: string;
}

export interface MarketplacePublishTemplateResponse {
  template: MarketplaceTemplateDetail;
  storageMode: MarketplaceStorageMode;
}

export interface MarketplaceSlugAvailabilityResponse {
  slug: string;
  available: boolean;
  storageMode: MarketplaceStorageMode;
}

export interface MarketplaceApiError {
  error: {
    code: string;
    message: string;
  };
}

export const marketplaceListTemplatesRequestSchema = z.object({
  q: z.string().trim().max(MARKETPLACE_QUERY_MAX_LENGTH).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
  sort: z.enum(MARKETPLACE_SORT_VALUES).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(MARKETPLACE_MAX_PAGE_SIZE).optional()
});

const marketplaceTemplatePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

const marketplaceTemplateSizeSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
});

const marketplaceTemplateNoteSchema = z
  .object({
    content: z.string().max(100_000).optional(),
    templateContentMode: z.enum(MARKETPLACE_TEMPLATE_NOTE_CONTENT_MODES).optional(),
    relativePath: z.string().max(500).optional()
  })
  .superRefine((note, context) => {
    const contentMode = note.templateContentMode ?? 'embedded-snapshot';
    if (contentMode === 'embedded-snapshot') {
      return;
    }

    if (!normalizeMarketplaceTemplateWorkspaceRelativePath(note.relativePath ?? '')) {
      context.addIssue({
        code: 'custom',
        path: ['relativePath'],
        message: 'relativePath must be a safe workspace-relative path.'
      });
    }
  })
  .transform((note) => {
    const contentMode = note.templateContentMode ?? 'embedded-snapshot';
    if (contentMode === 'embedded-snapshot') {
      return {
        content: note.content ?? ''
      };
    }

    const relativePath = normalizeMarketplaceTemplateWorkspaceRelativePath(note.relativePath ?? '');
    return {
      content: contentMode === 'workspace-file-path-only' ? '' : note.content ?? '',
      templateContentMode: contentMode,
      relativePath: relativePath ?? ''
    };
  });

const marketplaceTemplateNodeSchema = z.object({
  kind: z.enum(MARKETPLACE_TEMPLATE_NODE_KINDS),
  title: z.string().trim().min(1).max(120),
  position: marketplaceTemplatePositionSchema,
  size: marketplaceTemplateSizeSchema,
  metadata: z
    .object({
      note: marketplaceTemplateNoteSchema.optional(),
      agent: z
        .object({
          provider: z.enum(MARKETPLACE_TEMPLATE_AGENT_PROVIDERS),
          argv: z.array(z.string().max(500)).max(64).optional()
        })
        .optional()
    })
    .optional()
});

const marketplaceTemplateEdgeSchema = z.object({
  sourceNodeIndex: z.number().int().nonnegative(),
  targetNodeIndex: z.number().int().nonnegative(),
  sourceAnchor: z.enum(['top', 'right', 'bottom', 'left']),
  targetAnchor: z.enum(['top', 'right', 'bottom', 'left']),
  arrowMode: z.enum(['none', 'forward', 'both']),
  color: z.string().max(32).optional(),
  label: z.string().max(120).optional()
});

export const marketplaceTemplateDocumentSchema = z
  .object({
    version: z.literal(1),
    template: z.object({
      id: z.string().trim().min(1).max(160),
      name: z.string().trim().min(1).max(MARKETPLACE_MAX_TEMPLATE_NAME_LENGTH),
      category: z.enum(['builtin', 'user']),
      nodes: z.array(marketplaceTemplateNodeSchema).min(1),
      edges: z.array(marketplaceTemplateEdgeSchema),
      createdAt: z.string().trim().min(1).max(80),
      updatedAt: z.string().trim().min(1).max(80)
    })
  })
  .superRefine((document, context) => {
    const nodeCount = document.template.nodes.length;
    document.template.edges.forEach((edge, index) => {
      if (edge.sourceNodeIndex >= nodeCount) {
        context.addIssue({
          code: 'custom',
          path: ['template', 'edges', index, 'sourceNodeIndex'],
          message: 'sourceNodeIndex must point to an existing node.'
        });
      }
      if (edge.targetNodeIndex >= nodeCount) {
        context.addIssue({
          code: 'custom',
          path: ['template', 'edges', index, 'targetNodeIndex'],
          message: 'targetNodeIndex must point to an existing node.'
        });
      }
    });
  });

const marketplaceTagsSchema = z
  .array(z.string().trim().min(1).max(MARKETPLACE_MAX_TAG_LENGTH))
  .max(MARKETPLACE_MAX_TAGS_PER_TEMPLATE)
  .transform((tags) => dedupeNormalizedTags(tags));

export const marketplacePublishTemplateRequestSchema = z.object({
  slug: z
    .string()
    .trim()
    .max(80)
    .transform((value) => normalizeMarketplaceSlug(value))
    .refine((value) => value.length === 0 || MARKETPLACE_SLUG_PATTERN.test(value), 'Slug must use lowercase words separated by hyphens.')
    .optional(),
  name: z.string().trim().min(1).max(MARKETPLACE_MAX_TEMPLATE_NAME_LENGTH),
  description: z.string().trim().min(1).max(MARKETPLACE_MAX_TEMPLATE_DESCRIPTION_LENGTH),
  tags: marketplaceTagsSchema,
  readme: z.string().max(MARKETPLACE_MAX_TEMPLATE_README_LENGTH).optional(),
  changelog: z.string().max(MARKETPLACE_MAX_TEMPLATE_CHANGELOG_LENGTH).optional(),
  templateDocument: marketplaceTemplateDocumentSchema,
  thumbnailPngBase64: z.string().trim().min(1).optional()
});

export const marketplacePublishTemplateVersionRequestSchema = z.object({
  changelog: z.string().max(MARKETPLACE_MAX_TEMPLATE_CHANGELOG_LENGTH).optional(),
  templateDocument: marketplaceTemplateDocumentSchema,
  thumbnailPngBase64: z.string().trim().min(1).optional()
});

const marketplaceTemplatePackagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .transform((value) => normalizeMarketplacePackagePath(value))
  .refine((value): value is string => Boolean(value), 'Package paths must be safe package-relative paths.');

const marketplaceTemplatePackageMediaPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .transform((value) => normalizeMarketplacePackagePath(value))
  .refine((value): value is string => Boolean(value), 'Package media paths must be safe package-relative paths.')
  .refine((value) => Boolean(value) && (value.startsWith('media/') || value.startsWith('assets/')), 'Package media must live under media/ or assets/.');

const marketplaceTemplatePackageMediaItemSchema = z.object({
  type: z.enum(MARKETPLACE_PACKAGE_MEDIA_TYPES),
  path: marketplaceTemplatePackageMediaPathSchema,
  alt: z.string().trim().max(240).optional(),
  title: z.string().trim().max(240).optional(),
  poster: marketplaceTemplatePackageMediaPathSchema.optional()
});

export const marketplaceTemplatePackageManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    slug: z
      .string()
      .trim()
      .max(80)
      .transform((value) => normalizeMarketplaceSlug(value))
      .refine((value) => MARKETPLACE_SLUG_PATTERN.test(value), 'Slug must use lowercase words separated by hyphens.'),
    name: z.string().trim().min(1).max(MARKETPLACE_MAX_TEMPLATE_NAME_LENGTH),
    description: z.string().trim().min(1).max(MARKETPLACE_MAX_TEMPLATE_DESCRIPTION_LENGTH),
    tags: marketplaceTagsSchema,
    template: marketplaceTemplatePackagePathSchema.default('template.json'),
    readme: marketplaceTemplatePackagePathSchema.default('README.md'),
    changelog: marketplaceTemplatePackagePathSchema.default('CHANGELOG.md'),
    thumbnail: marketplaceTemplatePackageMediaPathSchema.optional(),
    version: z.string().trim().max(80).optional(),
    minExtensionVersion: z.string().trim().max(80).optional(),
    providers: z.array(z.enum(MARKETPLACE_TEMPLATE_AGENT_PROVIDERS)).max(16).optional(),
    media: z
      .object({
        thumbnail: marketplaceTemplatePackageMediaPathSchema.optional(),
        gallery: z.array(marketplaceTemplatePackageMediaItemSchema).max(20).optional()
      })
      .optional(),
    license: z.string().trim().max(120).optional(),
    homepage: z.string().trim().url().max(500).optional(),
    repository: z.string().trim().max(500).optional(),
    checksums: z
      .object({
        templateSha256: z.string().trim().regex(/^[0-9a-f]{64}$/i).optional()
      })
      .optional()
  })
  .transform((manifest) => ({
    ...manifest,
    thumbnail: manifest.thumbnail ?? manifest.media?.thumbnail ?? 'media/thumbnail.png',
    media: manifest.media
      ? {
          ...manifest.media,
          thumbnail: manifest.media.thumbnail ?? manifest.thumbnail
        }
      : manifest.thumbnail
      ? { thumbnail: manifest.thumbnail }
      : undefined
  }));

const seedPublisher: MarketplacePublisherSummary = {
  id: 'github-8197085',
  githubLogin: 'ZY-WANG-0304',
  displayName: 'Dev Session Canvas',
  avatarUrl: 'https://github.com/ZY-WANG-0304.png'
};

const rawMarketplaceSeedTemplates: Array<
  Omit<MarketplaceTemplateDetail, 'versions' | 'hotScore'> & {
    previousVersions?: MarketplaceTemplateVersion[];
  }
> = [
  {
    id: 'tmpl-getting-started',
    slug: 'getting-started-canvas',
    name: 'Getting Started Canvas',
    description: 'A starter layout that introduces agents, terminals, and notes in one workspace canvas.',
    tags: ['starter', 'agent', 'note'],
    publisher: seedPublisher,
    latestVersion: {
      id: 'ver-getting-started-1',
      templateId: 'tmpl-getting-started',
      versionNumber: 1,
      changelog: 'Initial marketplace seed version.',
      objectKey: 'templates/tmpl-getting-started/versions/1/template.json',
      thumbnailKey: 'templates/tmpl-getting-started/versions/1/thumbnail.png',
      sha256: '031e1f491c5e7b4b39c3c2a84dcf2d81e9833bad6228e32fa8f710dfccc00a7e',
      sizeBytes: 1497,
      schemaVersion: 1,
      status: 'published',
      createdAt: '2026-05-10T00:00:00.000Z'
    },
    status: 'published',
    downloadCount: 128,
    likeCount: 21,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    readme: 'Use this template to learn the basic Dev Session Canvas workflow.',
    providerWarnings: []
  },
  {
    id: 'tmpl-review-loop',
    slug: 'review-loop',
    name: 'Review Loop',
    description: 'A focused review workflow with implementation, reviewer, test checkpoint, and decision log nodes.',
    tags: ['review', 'quality', 'terminal'],
    publisher: seedPublisher,
    latestVersion: {
      id: 'ver-review-loop-2',
      templateId: 'tmpl-review-loop',
      versionNumber: 2,
      changelog: 'Adds a decision log note and clearer review handoff guidance.',
      objectKey: 'templates/tmpl-review-loop/versions/2/template.json',
      thumbnailKey: 'templates/tmpl-review-loop/versions/2/thumbnail.png',
      sha256: 'd74f3887ad39c05912629b771635bf8c3e110a498a559ec6b56d8aee390e8ead',
      sizeBytes: 2470,
      schemaVersion: 1,
      status: 'published',
      createdAt: '2026-05-10T09:00:00.000Z'
    },
    previousVersions: [
      {
        id: 'ver-review-loop-1',
        templateId: 'tmpl-review-loop',
        versionNumber: 1,
        changelog: 'Initial review workflow seed.',
        objectKey: 'templates/tmpl-review-loop/versions/1/template.json',
        thumbnailKey: 'templates/tmpl-review-loop/versions/1/thumbnail.png',
        sha256: '005e90644dae8084a612d6a9d2e198508618eaa792648eb19bc56113cbcc4e92',
        sizeBytes: 1897,
        schemaVersion: 1,
        status: 'published',
        createdAt: '2026-05-09T00:00:00.000Z'
      }
    ],
    status: 'published',
    downloadCount: 72,
    likeCount: 33,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-10T09:00:00.000Z',
    readme: 'Use this template when a change needs an explicit implementation, review, test, and handoff rhythm.',
    providerWarnings: []
  },
  {
    id: 'tmpl-release-readiness',
    slug: 'release-readiness',
    name: 'Release Readiness',
    description: 'A release checklist canvas for packaging, smoke validation, notes, and final handoff.',
    tags: ['release', 'smoke', 'checklist'],
    publisher: seedPublisher,
    latestVersion: {
      id: 'ver-release-readiness-1',
      templateId: 'tmpl-release-readiness',
      versionNumber: 1,
      changelog: 'Initial release readiness seed.',
      objectKey: 'templates/tmpl-release-readiness/versions/1/template.json',
      thumbnailKey: 'templates/tmpl-release-readiness/versions/1/thumbnail.png',
      sha256: 'e63a9f3666284df207184414a75afb1a86f6536a53668279fe825577a400bef0',
      sizeBytes: 2045,
      schemaVersion: 1,
      status: 'published',
      createdAt: '2026-05-08T00:00:00.000Z'
    },
    status: 'published',
    downloadCount: 48,
    likeCount: 12,
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    readme: 'Use this template to prepare repeatable release validation work.',
    providerWarnings: []
  }
];

export const marketplaceSeedTemplates: MarketplaceTemplateDetail[] = rawMarketplaceSeedTemplates.map(
  ({ previousVersions, ...template }) => ({
    ...template,
    versions: [template.latestVersion, ...(previousVersions ?? [])],
    hotScore: calculateHotScore(template.downloadCount, template.likeCount, template.updatedAt)
  })
);

export function listSeedTemplates(query: MarketplaceListTemplatesRequest = {}): MarketplaceListTemplatesResponse {
  return listMarketplaceTemplatesFromCatalog(marketplaceSeedTemplates, query, 'seed');
}

export function listMarketplaceTemplatesFromCatalog(
  templates: readonly MarketplaceTemplateDetail[],
  query: MarketplaceListTemplatesRequest = {},
  storageMode: MarketplaceStorageMode
): MarketplaceListTemplatesResponse {
  const parsed = marketplaceListTemplatesRequestSchema.parse(normalizeListQuery(query));
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? MARKETPLACE_DEFAULT_PAGE_SIZE;
  const normalizedQuery = normalizeSearchText(parsed.q ?? '');
  const requiredTags = (parsed.tags ?? []).map(normalizeTag);

  const filtered = templates.filter((template) => {
    if (template.status !== 'published') {
      return false;
    }
    if (normalizedQuery && !buildSearchText(template).includes(normalizedQuery)) {
      return false;
    }
    if (requiredTags.length > 0) {
      const templateTags = new Set(template.tags.map(normalizeTag));
      return requiredTags.every((tag) => templateTags.has(tag));
    }
    return true;
  });

  const sorted = sortTemplates(filtered, parsed.sort ?? 'hot');
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize).map(toTemplateSummary);

  return {
    items,
    pagination: {
      page,
      pageSize,
      total: sorted.length,
      hasMore: start + pageSize < sorted.length
    },
    storageMode
  };
}

export function getSeedTemplateDetail(templateIdOrSlug: string): MarketplaceTemplateDetail | undefined {
  return marketplaceSeedTemplates.find((template) => template.id === templateIdOrSlug || template.slug === templateIdOrSlug);
}

export function buildSeedDownloadResponse(templateIdOrSlug: string, versionId?: string): MarketplaceDownloadResponse | undefined {
  const template = getSeedTemplateDetail(templateIdOrSlug);
  if (!template) {
    return undefined;
  }
  const version = versionId ? template.versions.find((entry) => entry.id === versionId) : template.latestVersion;
  if (!version) {
    return undefined;
  }
  return {
    templateId: template.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    objectKey: version.objectKey,
    sha256: version.sha256,
    sizeBytes: version.sizeBytes,
    storageMode: 'seed',
    downloadUrl: `/api/v1/templates/${template.id}/template.json?version=${encodeURIComponent(version.id)}`
  };
}

export function buildSeedPackageDownloadResponse(templateIdOrSlug: string, versionId?: string): MarketplacePackageDownloadResponse | undefined {
  const response = buildSeedDownloadResponse(templateIdOrSlug, versionId);
  if (!response) {
    return undefined;
  }
  const packageObjectKey = buildMarketplacePackageObjectKey(response.objectKey);
  return {
    ...response,
    packageObjectKey,
    packageDownloadUrl: `/api/v1/templates/${response.templateId}/download?version=${encodeURIComponent(response.versionId)}`
  };
}

export function calculateHotScore(downloadCount: number, likeCount: number, updatedAt: string, now: Date = new Date('2026-05-10T00:00:00.000Z')): number {
  const updatedTime = Date.parse(updatedAt);
  const ageDays = Number.isFinite(updatedTime) ? Math.max(0, (now.getTime() - updatedTime) / 86_400_000) : 30;
  const freshnessBoost = Math.max(0, 1 - ageDays / 30) * 0.25;
  return Number((Math.log10(downloadCount + 1) * 0.7 + Math.log10(likeCount + 1) * 1.3 + freshnessBoost).toFixed(6));
}

export function makeMarketplaceApiError(code: string, message: string): MarketplaceApiError {
  return {
    error: {
      code,
      message
    }
  };
}

export function normalizeMarketplaceSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function buildMarketplaceSlugFromName(name: string): string {
  return normalizeMarketplaceSlug(name) || 'template';
}

export function normalizeMarketplaceTag(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeMarketplaceTemplateWorkspaceRelativePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/u, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) ||
    normalized.includes('\0')
  ) {
    return undefined;
  }

  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    return undefined;
  }

  return parts.join('/');
}

export function normalizeMarketplacePackagePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/u, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) ||
    normalized.includes('\0')
  ) {
    return undefined;
  }

  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    return undefined;
  }

  return parts.join('/');
}

export function buildMarketplacePackageObjectKey(objectKey: string): string {
  const normalized = normalizeMarketplacePackagePath(objectKey) ?? objectKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const directory = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
  return directory ? `${directory}/package.zip` : 'package.zip';
}

export {
  generateMarketplaceTemplateThumbnailPngBase64,
  generateMarketplaceTemplateThumbnailPngBytes
} from './thumbnail';

function normalizeListQuery(query: MarketplaceListTemplatesRequest): MarketplaceListTemplatesRequest {
  const normalizedQuery = query.q?.trim();

  return {
    ...query,
    q: normalizedQuery ? normalizedQuery.slice(0, MARKETPLACE_QUERY_MAX_LENGTH) : undefined,
    tags: query.tags?.map((tag) => tag.trim()).filter(Boolean),
    page: query.page && query.page > 0 ? query.page : undefined,
    pageSize: query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, MARKETPLACE_MAX_PAGE_SIZE) : undefined
  };
}

function sortTemplates(templates: MarketplaceTemplateDetail[], sort: MarketplaceSort): MarketplaceTemplateDetail[] {
  return templates.slice().sort((left, right) => {
    if (sort === 'downloads') {
      return right.downloadCount - left.downloadCount || compareByUpdatedAt(left, right);
    }
    if (sort === 'likes') {
      return right.likeCount - left.likeCount || compareByUpdatedAt(left, right);
    }
    if (sort === 'newest') {
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    }
    if (sort === 'updated') {
      return compareByUpdatedAt(left, right);
    }
    return right.hotScore - left.hotScore || compareByUpdatedAt(left, right);
  });
}

function compareByUpdatedAt(left: MarketplaceTemplateDetail, right: MarketplaceTemplateDetail): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function toTemplateSummary(template: MarketplaceTemplateDetail): MarketplaceTemplateSummary {
  const { versions: _versions, readme: _readme, providerWarnings: _providerWarnings, ...summary } = template;
  return summary;
}

function buildSearchText(template: MarketplaceTemplateDetail): string {
  return normalizeSearchText([template.name, template.description, template.tags.join(' '), template.publisher.displayName].join(' '));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function dedupeNormalizedTags(tags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const displayTag = tag.trim();
    const normalizedTag = normalizeMarketplaceTag(displayTag);
    if (!normalizedTag || seen.has(normalizedTag)) {
      continue;
    }
    seen.add(normalizedTag);
    result.push(displayTag);
  }
  return result;
}
