import {
  buildMarketplacePackageObjectKey,
  buildSeedDownloadResponse,
  buildSeedPackageDownloadResponse,
  calculateHotScore,
  getSeedTemplateDetail,
  listMarketplaceTemplatesFromCatalog,
  listSeedTemplates,
  type MarketplaceDownloadResponse,
  type MarketplaceListTemplatesRequest,
  type MarketplaceListTemplatesResponse,
  type MarketplacePackageDownloadResponse,
  type MarketplacePublisherSummary,
  type MarketplacePublisherStatsResponse,
  type MarketplaceStorageMode,
  type MarketplaceTemplateLikeResponse,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateDetailResponse,
  type MarketplaceTemplateSummary,
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
  buildPackageDownloadResponse(templateIdOrSlug: string, versionId?: string): Promise<MarketplacePackageDownloadResponse | undefined>;
  recordDownload(templateId: string, versionId: string, at?: Date): Promise<void>;
  setTemplateLike(
    templateIdOrSlug: string,
    user: MarketplaceRepositoryUserInput,
    liked?: boolean,
    at?: Date
  ): Promise<MarketplaceTemplateLikeResponse | undefined>;
  listLikedTemplates(user: MarketplaceRepositoryUserInput): Promise<MarketplaceListTemplatesResponse>;
  getPublisherStats(user: MarketplaceRepositoryUserInput): Promise<MarketplacePublisherStatsResponse>;
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

  public async buildPackageDownloadResponse(templateIdOrSlug: string, versionId?: string): Promise<MarketplacePackageDownloadResponse | undefined> {
    return buildSeedPackageDownloadResponse(templateIdOrSlug, versionId);
  }

  public async recordDownload(): Promise<void> {
    // Seed data is immutable; the no-op keeps local fallback behavior explicit.
  }

  public async setTemplateLike(): Promise<MarketplaceTemplateLikeResponse | undefined> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'Template likes require D1 storage.', 503);
  }

  public async listLikedTemplates(): Promise<MarketplaceListTemplatesResponse> {
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

  public async getPublisherStats(): Promise<MarketplacePublisherStatsResponse> {
    return {
      totals: {
        templateCount: 0,
        downloadCount: 0,
        likeCount: 0,
        publishCount: 0
      },
      daily: [],
      templates: [],
      storageMode: this.storageMode
    };
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
      downloadUrl: `/api/v1/templates/${detail.template.id}/template.json?version=${encodeURIComponent(version.id)}`
    };
  }

  public async buildPackageDownloadResponse(templateIdOrSlug: string, versionId?: string): Promise<MarketplacePackageDownloadResponse | undefined> {
    const response = await this.buildDownloadResponse(templateIdOrSlug, versionId);
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

  public async setTemplateLike(
    templateIdOrSlug: string,
    user: MarketplaceRepositoryUserInput,
    liked?: boolean,
    at: Date = new Date()
  ): Promise<MarketplaceTemplateLikeResponse | undefined> {
    const detail = await this.getTemplateDetail(templateIdOrSlug);
    if (!detail) {
      return undefined;
    }

    const now = at.toISOString();
    const day = formatUtcDay(at);
    const publisher = await this.upsertUser(user, now);
    const existing = await this.database
      .prepare('SELECT created_at FROM template_likes WHERE template_id = ?1 AND user_id = ?2 LIMIT 1')
      .bind(detail.template.id, publisher.id)
      .first<{ created_at: string }>();
    const nextLiked = liked ?? !existing;

    if (nextLiked && !existing) {
      await this.database
        .prepare('INSERT INTO template_likes (template_id, user_id, created_at) VALUES (?1, ?2, ?3)')
        .bind(detail.template.id, publisher.id, now)
        .run();
      await this.database
        .prepare('UPDATE templates SET like_count = like_count + 1 WHERE id = ?1')
        .bind(detail.template.id)
        .run();
      await this.database
        .prepare(
          `INSERT INTO template_daily_stats (template_id, day, download_count, like_count, publish_count)
           VALUES (?1, ?2, 0, 1, 0)
           ON CONFLICT(template_id, day) DO UPDATE SET
             like_count = like_count + 1`
        )
        .bind(detail.template.id, day)
        .run();
    } else if (!nextLiked && existing) {
      await this.database
        .prepare('DELETE FROM template_likes WHERE template_id = ?1 AND user_id = ?2')
        .bind(detail.template.id, publisher.id)
        .run();
      await this.database
        .prepare('UPDATE templates SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = ?1')
        .bind(detail.template.id)
        .run();
    }

    const row = await this.database.prepare('SELECT like_count FROM templates WHERE id = ?1 LIMIT 1').bind(detail.template.id).first<{ like_count: number }>();
    return {
      templateId: detail.template.id,
      liked: nextLiked,
      likeCount: row?.like_count ?? Math.max(0, detail.template.likeCount + (nextLiked && !existing ? 1 : !nextLiked && existing ? -1 : 0)),
      storageMode: this.storageMode
    };
  }

  public async listLikedTemplates(user: MarketplaceRepositoryUserInput): Promise<MarketplaceListTemplatesResponse> {
    const result = await this.database
      .prepare(
        `${templateSelectSqlWithJoins('JOIN template_likes tl ON tl.template_id = t.id')}
         WHERE t.status = 'published' AND tl.user_id = ?1
         GROUP BY t.id
         ORDER BY tl.created_at DESC`
      )
      .bind(buildMarketplaceUserId(user.githubUserId))
      .all<TemplateRow>();
    return listMarketplaceTemplatesFromCatalog(result.results?.map((row) => mapTemplateRow(row)) ?? [], {
      sort: 'updated',
      pageSize: 50
    }, this.storageMode);
  }

  public async getPublisherStats(user: MarketplaceRepositoryUserInput): Promise<MarketplacePublisherStatsResponse> {
    const publisherId = buildMarketplaceUserId(user.githubUserId);
    const templateResult = await this.database
      .prepare(`${templateSelectSql} WHERE t.status = 'published' AND t.publisher_id = ?1 GROUP BY t.id ORDER BY t.updated_at DESC`)
      .bind(publisherId)
      .all<TemplateRow>();
    const templates = templateResult.results?.map((row) => mapTemplateRow(row)) ?? [];

    if (templates.length === 0) {
      return {
        totals: {
          templateCount: 0,
          downloadCount: 0,
          likeCount: 0,
          publishCount: 0
        },
        daily: [],
        templates: [],
        storageMode: this.storageMode
      };
    }

    const dailyResult = await this.database
      .prepare(
        `SELECT s.day AS day,
                SUM(s.download_count) AS download_count,
                SUM(s.like_count) AS like_count,
                SUM(s.publish_count) AS publish_count
         FROM template_daily_stats s
         JOIN templates t ON t.id = s.template_id
         WHERE t.publisher_id = ?1 AND t.status = 'published'
         GROUP BY s.day
         ORDER BY s.day ASC`
      )
      .bind(publisherId)
      .all<DailyStatsRow>();
    const daily = (dailyResult.results ?? []).map(mapDailyStatsRow);
    const publishCount = daily.reduce((total, point) => total + point.publishCount, 0);
    const templateStats = templates.map((template) => ({
      template: toStatsTemplateSummary(template),
      downloadCount: template.downloadCount,
      likeCount: template.likeCount,
      publishCount: Math.max(1, template.versions.length)
    }));

    return {
      totals: {
        templateCount: templates.length,
        downloadCount: templates.reduce((total, template) => total + template.downloadCount, 0),
        likeCount: templates.reduce((total, template) => total + template.likeCount, 0),
        publishCount: publishCount || templateStats.reduce((total, template) => total + template.publishCount, 0)
      },
      daily,
      templates: templateStats,
      storageMode: this.storageMode
    };
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

function templateSelectSqlWithJoins(extraJoins: string): string {
  return templateSelectSql.replace('LEFT JOIN template_tags tt ON tt.template_id = t.id', `${extraJoins}\nLEFT JOIN template_tags tt ON tt.template_id = t.id`);
}

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

interface DailyStatsRow {
  day: string;
  download_count: number | null;
  like_count: number | null;
  publish_count: number | null;
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

function mapDailyStatsRow(row: DailyStatsRow) {
  return {
    day: row.day,
    downloadCount: row.download_count ?? 0,
    likeCount: row.like_count ?? 0,
    publishCount: row.publish_count ?? 0
  };
}

function toStatsTemplateSummary(template: MarketplaceTemplateDetail): MarketplaceTemplateSummary {
  const { versions: _versions, readme: _readme, providerWarnings: _providerWarnings, ...summary } = template;
  return summary;
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

export function buildMarketplaceUserId(githubUserId: string): string {
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
