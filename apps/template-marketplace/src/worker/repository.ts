import {
  buildSeedDownloadResponse,
  calculateHotScore,
  getSeedTemplateDetail,
  listMarketplaceTemplatesFromCatalog,
  listSeedTemplates,
  type MarketplaceDownloadResponse,
  type MarketplaceListTemplatesRequest,
  type MarketplaceListTemplatesResponse,
  type MarketplacePublisherSummary,
  type MarketplaceStorageMode,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateDetailResponse,
  type MarketplaceTemplateVersion
} from '@dev-session-canvas/marketplace-shared';

export type TemplateDetailResponse = MarketplaceTemplateDetailResponse;

export interface MarketplaceRepositoryUserInput {
  githubUserId: string;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
}

export interface MarketplacePublishTemplateRecord {
  templateId: string;
  versionId: string;
  slug: string;
  name: string;
  description: string;
  readme: string;
  tags: string[];
  providerWarnings: string[];
  publisher: MarketplaceRepositoryUserInput;
  changelog: string;
  objectKey: string;
  thumbnailKey: string;
  sha256: string;
  sizeBytes: number;
  schemaVersion: number;
  createdAt: string;
}

export interface MarketplacePublishTemplateVersionRecord {
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
}

export class MarketplaceRepositoryWriteError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = 'MarketplaceRepositoryWriteError';
  }
}

export interface MarketplaceTemplateRepository {
  readonly storageMode: MarketplaceStorageMode;
  listTemplates(query: MarketplaceListTemplatesRequest): Promise<MarketplaceListTemplatesResponse>;
  listTemplatesByPublisher(user: MarketplaceRepositoryUserInput): Promise<MarketplaceListTemplatesResponse>;
  getTemplateDetail(templateIdOrSlug: string): Promise<TemplateDetailResponse | undefined>;
  buildDownloadResponse(templateIdOrSlug: string, versionId?: string): Promise<MarketplaceDownloadResponse | undefined>;
  recordDownload(templateId: string, versionId: string, at?: Date): Promise<void>;
  isTemplateSlugAvailable(slug: string): Promise<boolean>;
  upsertUser(
    user: MarketplaceRepositoryUserInput,
    at: string,
    adminGithubLogins?: readonly string[]
  ): Promise<MarketplacePublisherSummary>;
  publishTemplate(record: MarketplacePublishTemplateRecord, adminGithubLogins?: readonly string[]): Promise<TemplateDetailResponse>;
  publishTemplateVersion(
    template: MarketplaceTemplateDetail,
    record: MarketplacePublishTemplateVersionRecord
  ): Promise<TemplateDetailResponse>;
}

export class SeedTemplateRepository implements MarketplaceTemplateRepository {
  public readonly storageMode = 'seed' as const;

  public async listTemplates(query: MarketplaceListTemplatesRequest): Promise<MarketplaceListTemplatesResponse> {
    return listSeedTemplates(query);
  }

  public async listTemplatesByPublisher(): Promise<MarketplaceListTemplatesResponse> {
    return {
      items: [],
      pagination: {
        page: 1,
        pageSize: 0,
        total: 0,
        hasMore: false
      },
      storageMode: this.storageMode
    };
  }

  public async getTemplateDetail(templateIdOrSlug: string): Promise<TemplateDetailResponse | undefined> {
    const template = getSeedTemplateDetail(templateIdOrSlug);
    return template ? { template, storageMode: this.storageMode } : undefined;
  }

  public async buildDownloadResponse(templateIdOrSlug: string, versionId?: string): Promise<MarketplaceDownloadResponse | undefined> {
    return buildSeedDownloadResponse(templateIdOrSlug, versionId);
  }

  public async recordDownload(): Promise<void> {
    // Seed data is immutable; the no-op keeps local fallback behavior explicit.
  }

  public async isTemplateSlugAvailable(slug: string): Promise<boolean> {
    return !getSeedTemplateDetail(slug);
  }

  public async upsertUser(): Promise<MarketplacePublisherSummary> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'User persistence requires D1 storage.', 503);
  }

  public async publishTemplate(): Promise<TemplateDetailResponse> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'Template publishing requires D1 storage.', 503);
  }

  public async publishTemplateVersion(): Promise<TemplateDetailResponse> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'Template publishing requires D1 storage.', 503);
  }
}

export class D1TemplateRepository implements MarketplaceTemplateRepository {
  public readonly storageMode = 'd1' as const;

  public constructor(private readonly database: D1Database) {}

  public async listTemplates(query: MarketplaceListTemplatesRequest): Promise<MarketplaceListTemplatesResponse> {
    const rows = await this.fetchTemplateRows();
    return listMarketplaceTemplatesFromCatalog(rows.map((row) => mapTemplateRow(row)), query, this.storageMode);
  }

  public async listTemplatesByPublisher(user: MarketplaceRepositoryUserInput): Promise<MarketplaceListTemplatesResponse> {
    const result = await this.database
      .prepare(`${templateSelectSql} WHERE t.status = 'published' AND u.github_user_id = ?1 GROUP BY t.id ORDER BY t.updated_at DESC`)
      .bind(user.githubUserId)
      .all<TemplateRow>();
    return listMarketplaceTemplatesFromCatalog(result.results?.map((row) => mapTemplateRow(row)) ?? [], {
      sort: 'updated',
      pageSize: 50
    }, this.storageMode);
  }

  public async getTemplateDetail(templateIdOrSlug: string): Promise<TemplateDetailResponse | undefined> {
    const row = await this.database
      .prepare(`${templateSelectSql} WHERE (t.id = ?1 OR t.slug = ?1) AND t.status = 'published' GROUP BY t.id LIMIT 1`)
      .bind(templateIdOrSlug)
      .first<TemplateRow>();
    if (!row) {
      return undefined;
    }
    const versions = await this.fetchVersions(row.template_id);
    return {
      template: mapTemplateRow(row, versions.length > 0 ? versions : undefined),
      storageMode: this.storageMode
    };
  }

  public async buildDownloadResponse(templateIdOrSlug: string, versionId?: string): Promise<MarketplaceDownloadResponse | undefined> {
    const detail = await this.getTemplateDetail(templateIdOrSlug);
    if (!detail) {
      return undefined;
    }
    const version = versionId
      ? detail.template.versions.find((entry) => entry.id === versionId)
      : detail.template.latestVersion;
    if (!version) {
      return undefined;
    }
    return {
      templateId: detail.template.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      objectKey: version.objectKey,
      sha256: version.sha256,
      sizeBytes: version.sizeBytes,
      storageMode: this.storageMode,
      downloadUrl: `/api/v1/templates/${detail.template.id}/download?version=${encodeURIComponent(version.id)}`
    };
  }

  public async recordDownload(templateId: string, _versionId: string, at: Date = new Date()): Promise<void> {
    const day = formatUtcDay(at);
    await this.database.prepare('UPDATE templates SET download_count = download_count + 1 WHERE id = ?1').bind(templateId).run();
    await this.database
      .prepare(
        `INSERT INTO template_daily_stats (template_id, day, download_count, like_count, publish_count)
         VALUES (?1, ?2, 1, 0, 0)
         ON CONFLICT(template_id, day) DO UPDATE SET
           download_count = download_count + 1`
      )
      .bind(templateId, day)
      .run();
  }

  public async isTemplateSlugAvailable(slug: string): Promise<boolean> {
    const existingTemplate = await this.database.prepare('SELECT id FROM templates WHERE slug = ?1 LIMIT 1').bind(slug).first<{ id: string }>();
    return !existingTemplate;
  }

  public async publishTemplate(
    record: MarketplacePublishTemplateRecord,
    adminGithubLogins: readonly string[] = []
  ): Promise<TemplateDetailResponse> {
    if (!(await this.isTemplateSlugAvailable(record.slug))) {
      throw new MarketplaceRepositoryWriteError('template_slug_conflict', 'A template with this slug already exists.', 409);
    }

    const publisher = await this.upsertUser(record.publisher, record.createdAt, adminGithubLogins);
    const providerWarningsJson = JSON.stringify(record.providerWarnings);
    const searchText = buildTemplateSearchText(record.name, record.description, record.tags, publisher.displayName);
    const day = record.createdAt.slice(0, 10);

    await this.database
      .prepare(
        `INSERT INTO templates
          (id, slug, latest_version_id, name, description, readme, publisher_id, status, download_count, like_count, search_text, provider_warnings_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'published', 0, 0, ?8, ?9, ?10, ?10)`
      )
      .bind(
        record.templateId,
        record.slug,
        record.versionId,
        record.name,
        record.description,
        record.readme,
        publisher.id,
        searchText,
        providerWarningsJson,
        record.createdAt
      )
      .run();

    await this.database
      .prepare(
        `INSERT INTO template_versions
          (id, template_id, version_number, changelog, object_key, thumbnail_key, sha256, size_bytes, schema_version, status, created_at)
         VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, 'published', ?9)`
      )
      .bind(
        record.versionId,
        record.templateId,
        record.changelog,
        record.objectKey,
        record.thumbnailKey,
        record.sha256,
        record.sizeBytes,
        record.schemaVersion,
        record.createdAt
      )
      .run();

    for (const tag of record.tags) {
      await this.database
        .prepare('INSERT INTO template_tags (template_id, tag, display_text) VALUES (?1, ?2, ?3)')
        .bind(record.templateId, normalizeTagForStorage(tag), tag)
        .run();
    }

    await this.database
      .prepare(
        `INSERT INTO template_daily_stats (template_id, day, download_count, like_count, publish_count)
         VALUES (?1, ?2, 0, 0, 1)
         ON CONFLICT(template_id, day) DO UPDATE SET
           publish_count = publish_count + 1`
      )
      .bind(record.templateId, day)
      .run();

    return {
      template: buildTemplateDetailFromPublishRecord(record, publisher),
      storageMode: this.storageMode
    };
  }

  public async publishTemplateVersion(
    template: MarketplaceTemplateDetail,
    record: MarketplacePublishTemplateVersionRecord
  ): Promise<TemplateDetailResponse> {
    const day = record.createdAt.slice(0, 10);
    await this.database
      .prepare(
        `INSERT INTO template_versions
          (id, template_id, version_number, changelog, object_key, thumbnail_key, sha256, size_bytes, schema_version, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'published', ?10)`
      )
      .bind(
        record.versionId,
        record.templateId,
        record.versionNumber,
        record.changelog,
        record.objectKey,
        record.thumbnailKey,
        record.sha256,
        record.sizeBytes,
        record.schemaVersion,
        record.createdAt
      )
      .run();

    await this.database
      .prepare('UPDATE templates SET latest_version_id = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(record.versionId, record.createdAt, record.templateId)
      .run();

    await this.database
      .prepare(
        `INSERT INTO template_daily_stats (template_id, day, download_count, like_count, publish_count)
         VALUES (?1, ?2, 0, 0, 1)
         ON CONFLICT(template_id, day) DO UPDATE SET
           publish_count = publish_count + 1`
      )
      .bind(record.templateId, day)
      .run();

    return {
      template: buildTemplateDetailFromVersionRecord(template, record),
      storageMode: this.storageMode
    };
  }

  private async fetchTemplateRows(): Promise<TemplateRow[]> {
    const result = await this.database.prepare(`${templateSelectSql} WHERE t.status = 'published' GROUP BY t.id`).all<TemplateRow>();
    return result.results ?? [];
  }

  private async fetchVersions(templateId: string): Promise<MarketplaceTemplateVersion[]> {
    const result = await this.database
      .prepare(
        `SELECT id, template_id, version_number, changelog, object_key, thumbnail_key, sha256, size_bytes, schema_version, status, created_at
         FROM template_versions
         WHERE template_id = ?1 AND status = 'published'
         ORDER BY version_number DESC`
      )
      .bind(templateId)
      .all<VersionRow>();
    return (result.results ?? []).map(mapVersionRow);
  }

  public async upsertUser(
    user: MarketplaceRepositoryUserInput,
    at: string,
    adminGithubLogins: readonly string[] = []
  ): Promise<MarketplacePublisherSummary> {
    const userId = buildMarketplaceUserId(user.githubUserId);
    await this.database
      .prepare(
        `INSERT INTO users (id, github_user_id, github_login, display_name, avatar_url, created_at, last_login_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(github_user_id) DO UPDATE SET
           github_login = excluded.github_login,
           display_name = excluded.display_name,
           avatar_url = excluded.avatar_url,
           last_login_at = excluded.last_login_at`
      )
      .bind(userId, user.githubUserId, user.githubLogin, user.displayName, user.avatarUrl, at)
      .run();

    if (adminGithubLogins.map((login) => login.toLowerCase()).includes(user.githubLogin.toLowerCase())) {
      await this.database
        .prepare(
          `INSERT INTO admin_roles (user_id, role, created_at)
           VALUES (?1, 'admin', ?2)
           ON CONFLICT(user_id) DO NOTHING`
        )
        .bind(userId, at)
        .run();
    }

    return {
      id: userId,
      githubLogin: user.githubLogin,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl
    };
  }
}

export function createTemplateRepository(database?: D1Database): MarketplaceTemplateRepository {
  return database ? new D1TemplateRepository(database) : new SeedTemplateRepository();
}

// Prefer the template's latest pointer when it still resolves to a published version;
// otherwise fall back to the newest published version for that template.
const latestPublishedVersionSql = `COALESCE(
  latest_published_version.id,
  (
    SELECT fallback_version.id
    FROM template_versions AS fallback_version
    WHERE fallback_version.template_id = t.id
      AND fallback_version.status = 'published'
    ORDER BY fallback_version.version_number DESC, fallback_version.created_at DESC, fallback_version.id DESC
    LIMIT 1
  )
)`;

const templateSelectSql = `SELECT
  t.id AS template_id,
  t.slug AS slug,
  t.name AS name,
  t.description AS description,
  t.readme AS readme,
  t.status AS template_status,
  t.download_count AS download_count,
  t.like_count AS like_count,
  t.provider_warnings_json AS provider_warnings_json,
  t.created_at AS template_created_at,
  t.updated_at AS template_updated_at,
  u.id AS publisher_id,
  u.github_login AS publisher_github_login,
  u.display_name AS publisher_display_name,
  u.avatar_url AS publisher_avatar_url,
  v.id AS version_id,
  v.version_number AS version_number,
  v.changelog AS changelog,
  v.object_key AS object_key,
  v.thumbnail_key AS thumbnail_key,
  v.sha256 AS sha256,
  v.size_bytes AS size_bytes,
  v.schema_version AS schema_version,
  v.status AS version_status,
  v.created_at AS version_created_at,
  COALESCE(group_concat(tt.display_text, ','), '') AS tags
FROM templates t
JOIN users u ON u.id = t.publisher_id
LEFT JOIN template_versions AS latest_published_version
  ON latest_published_version.id = t.latest_version_id
  AND latest_published_version.template_id = t.id
  AND latest_published_version.status = 'published'
JOIN template_versions v
  ON v.id = ${latestPublishedVersionSql}
  AND v.template_id = t.id
  AND v.status = 'published'
LEFT JOIN template_tags tt ON tt.template_id = t.id`;

interface TemplateRow {
  template_id: string;
  slug: string;
  name: string;
  description: string;
  readme: string;
  template_status: 'published' | 'delisted';
  download_count: number;
  like_count: number;
  provider_warnings_json: string;
  template_created_at: string;
  template_updated_at: string;
  publisher_id: string;
  publisher_github_login: string;
  publisher_display_name: string;
  publisher_avatar_url: string;
  version_id: string;
  version_number: number;
  changelog: string;
  object_key: string;
  thumbnail_key: string;
  sha256: string;
  size_bytes: number;
  schema_version: number;
  version_status: 'published' | 'rejected';
  version_created_at: string;
  tags: string;
}

interface VersionRow {
  id: string;
  template_id: string;
  version_number: number;
  changelog: string;
  object_key: string;
  thumbnail_key: string;
  sha256: string;
  size_bytes: number;
  schema_version: number;
  status: 'published' | 'rejected';
  created_at: string;
}

function mapTemplateRow(row: TemplateRow, versions: MarketplaceTemplateVersion[] = [mapLatestVersion(row)]): MarketplaceTemplateDetail {
  const publisher: MarketplacePublisherSummary = {
    id: row.publisher_id,
    githubLogin: row.publisher_github_login,
    displayName: row.publisher_display_name,
    avatarUrl: row.publisher_avatar_url
  };
  const tags = row.tags ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
  const providerWarnings = parseJsonStringArray(row.provider_warnings_json);

  return {
    id: row.template_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    tags,
    publisher,
    latestVersion: mapLatestVersion(row),
    versions,
    status: row.template_status,
    downloadCount: row.download_count,
    likeCount: row.like_count,
    hotScore: calculateHotScore(row.download_count, row.like_count, row.template_updated_at),
    createdAt: row.template_created_at,
    updatedAt: row.template_updated_at,
    readme: row.readme,
    providerWarnings
  };
}

function mapLatestVersion(row: TemplateRow): MarketplaceTemplateVersion {
  return {
    id: row.version_id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    changelog: row.changelog,
    objectKey: row.object_key,
    thumbnailKey: row.thumbnail_key,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    schemaVersion: row.schema_version,
    status: row.version_status,
    createdAt: row.version_created_at
  };
}

function mapVersionRow(row: VersionRow): MarketplaceTemplateVersion {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    changelog: row.changelog,
    objectKey: row.object_key,
    thumbnailKey: row.thumbnail_key,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    schemaVersion: row.schema_version,
    status: row.status,
    createdAt: row.created_at
  };
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function formatUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildMarketplaceUserId(githubUserId: string): string {
  return `github-${githubUserId.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`;
}

function buildTemplateSearchText(name: string, description: string, tags: readonly string[], publisherDisplayName: string): string {
  return [name, description, tags.join(' '), publisherDisplayName].join(' ').trim().toLowerCase();
}

function normalizeTagForStorage(tag: string): string {
  return tag.trim().toLowerCase();
}

function buildTemplateDetailFromPublishRecord(
  record: MarketplacePublishTemplateRecord,
  publisher: MarketplacePublisherSummary
): MarketplaceTemplateDetail {
  const latestVersion: MarketplaceTemplateVersion = {
    id: record.versionId,
    templateId: record.templateId,
    versionNumber: 1,
    changelog: record.changelog,
    objectKey: record.objectKey,
    thumbnailKey: record.thumbnailKey,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    schemaVersion: record.schemaVersion,
    status: 'published',
    createdAt: record.createdAt
  };

  return {
    id: record.templateId,
    slug: record.slug,
    name: record.name,
    description: record.description,
    tags: record.tags,
    publisher,
    latestVersion,
    versions: [latestVersion],
    status: 'published',
    downloadCount: 0,
    likeCount: 0,
    hotScore: calculateHotScore(0, 0, record.createdAt),
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
    readme: record.readme,
    providerWarnings: record.providerWarnings
  };
}

function buildTemplateDetailFromVersionRecord(
  template: MarketplaceTemplateDetail,
  record: MarketplacePublishTemplateVersionRecord
): MarketplaceTemplateDetail {
  const latestVersion: MarketplaceTemplateVersion = {
    id: record.versionId,
    templateId: record.templateId,
    versionNumber: record.versionNumber,
    changelog: record.changelog,
    objectKey: record.objectKey,
    thumbnailKey: record.thumbnailKey,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    schemaVersion: record.schemaVersion,
    status: 'published',
    createdAt: record.createdAt
  };
  return {
    ...template,
    latestVersion,
    versions: [latestVersion, ...template.versions],
    updatedAt: record.createdAt,
    hotScore: calculateHotScore(template.downloadCount, template.likeCount, record.createdAt)
  };
}
