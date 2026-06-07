import {
  buildMarketplacePackageObjectKey,
  buildSeedDownloadResponse,
  buildSeedPackageDownloadResponse,
  calculateHotScore,
  getSeedTemplateDetail,
  listMarketplaceTemplatesFromCatalog,
  marketplaceSeedTemplates,
  listSeedTemplates,
  type MarketplaceDownloadResponse,
  type MarketplaceAdminReportsResponse,
  type MarketplaceAdminReportActionRequest,
  type MarketplaceAdminStatsResponse,
  type MarketplaceAdminTemplateStatusRequest,
  type MarketplaceAdminTemplateStatusResponse,
  type MarketplaceAdminUserBanRequest,
  type MarketplaceAdminUserBanResponse,
  type MarketplaceListTemplatesRequest,
  type MarketplaceListTemplatesResponse,
  type MarketplacePackageDownloadResponse,
  type MarketplacePublisherSummary,
  type MarketplacePublisherStatsResponse,
  type MarketplaceReportReason,
  type MarketplaceStorageMode,
  type MarketplaceTemplateReportResponse,
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

export interface MarketplaceAdminBootstrapAllowlist {
  githubUserIds?: readonly string[];
  githubLogins?: readonly string[];
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
  getTemplateLikeState(templateIdOrSlug: string, user: MarketplaceRepositoryUserInput): Promise<MarketplaceTemplateLikeResponse | undefined>;
  listLikedTemplates(user: MarketplaceRepositoryUserInput): Promise<MarketplaceListTemplatesResponse>;
  getPublisherStats(user: MarketplaceRepositoryUserInput): Promise<MarketplacePublisherStatsResponse>;
  isUserBanned(user: MarketplaceRepositoryUserInput): Promise<boolean>;
  isAdminUser(user: MarketplaceRepositoryUserInput, adminBootstrapAllowlist?: MarketplaceAdminBootstrapAllowlist, at?: Date): Promise<boolean>;
  createTemplateReport(
    templateIdOrSlug: string,
    user: MarketplaceRepositoryUserInput,
    reason: MarketplaceReportReason,
    at?: Date
  ): Promise<MarketplaceTemplateReportResponse | undefined>;
  listAdminReports(status?: 'open' | 'resolved' | 'rejected'): Promise<MarketplaceAdminReportsResponse>;
  resolveAdminReport(
    reportId: string,
    actor: MarketplaceRepositoryUserInput,
    request: MarketplaceAdminReportActionRequest,
    at?: Date
  ): Promise<MarketplaceTemplateReportResponse | undefined>;
  setAdminTemplateStatus(
    templateIdOrSlug: string,
    actor: MarketplaceRepositoryUserInput,
    request: MarketplaceAdminTemplateStatusRequest,
    at?: Date
  ): Promise<MarketplaceAdminTemplateStatusResponse | undefined>;
  setAdminUserBan(
    userId: string,
    actor: MarketplaceRepositoryUserInput,
    request: MarketplaceAdminUserBanRequest,
    at?: Date
  ): Promise<MarketplaceAdminUserBanResponse | undefined>;
  getAdminStats(): Promise<MarketplaceAdminStatsResponse>;
  isTemplateSlugAvailable(slug: string): Promise<boolean>;
  upsertUser(
    user: MarketplaceRepositoryUserInput,
    at: string,
    adminBootstrapAllowlist?: MarketplaceAdminBootstrapAllowlist
  ): Promise<MarketplacePublisherSummary>;
  publishTemplate(record: MarketplacePublishTemplateRecord, adminBootstrapAllowlist?: MarketplaceAdminBootstrapAllowlist): Promise<TemplateDetailResponse>;
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

  public async getTemplateLikeState(templateIdOrSlug: string): Promise<MarketplaceTemplateLikeResponse | undefined> {
    const template = getSeedTemplateDetail(templateIdOrSlug);
    if (!template) {
      return undefined;
    }
    return {
      templateId: template.id,
      liked: false,
      likeCount: template.likeCount,
      storageMode: this.storageMode
    };
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

  public async isUserBanned(): Promise<boolean> {
    return false;
  }

  public async isAdminUser(): Promise<boolean> {
    return false;
  }

  public async createTemplateReport(): Promise<MarketplaceTemplateReportResponse | undefined> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'Template reports require D1 storage.', 503);
  }

  public async listAdminReports(): Promise<MarketplaceAdminReportsResponse> {
    return { items: [], storageMode: this.storageMode };
  }

  public async resolveAdminReport(): Promise<MarketplaceTemplateReportResponse | undefined> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'Report moderation requires D1 storage.', 503);
  }

  public async setAdminTemplateStatus(): Promise<MarketplaceAdminTemplateStatusResponse | undefined> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'Template moderation requires D1 storage.', 503);
  }

  public async setAdminUserBan(): Promise<MarketplaceAdminUserBanResponse | undefined> {
    throw new MarketplaceRepositoryWriteError('marketplace_writes_unavailable', 'User moderation requires D1 storage.', 503);
  }

  public async getAdminStats(): Promise<MarketplaceAdminStatsResponse> {
    const templates = marketplaceSeedTemplates;
    const publishedTemplates = templates.filter((template) => template.status === 'published');
    const topTemplates = publishedTemplates
      .slice()
      .sort((left, right) => right.downloadCount - left.downloadCount || right.likeCount - left.likeCount || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 5);
    return {
      totals: {
        templateCount: templates.length,
        publishedTemplateCount: publishedTemplates.length,
        delistedTemplateCount: templates.filter((template) => template.status === 'delisted').length,
        userCount: 0,
        bannedUserCount: 0,
        publisherCount: new Set(templates.map((template) => template.publisher.id)).size,
        downloadCount: templates.reduce((total, template) => total + template.downloadCount, 0),
        likeCount: templates.reduce((total, template) => total + template.likeCount, 0),
        publishCount: templates.reduce((total, template) => total + Math.max(1, template.latestVersion.versionNumber), 0),
        reportCount: 0,
        openReportCount: 0,
        resolvedReportCount: 0,
        rejectedReportCount: 0,
        adminActionCount: 0
      },
      daily: [],
      topTemplates: topTemplates.map((template) => ({
        template: toStatsTemplateSummary(template),
        downloadCount: template.downloadCount,
        likeCount: template.likeCount,
        publishCount: Math.max(1, template.latestVersion.versionNumber)
      })),
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

  public async getTemplateLikeState(templateIdOrSlug: string, user: MarketplaceRepositoryUserInput): Promise<MarketplaceTemplateLikeResponse | undefined> {
    const detail = await this.getTemplateDetail(templateIdOrSlug);
    if (!detail) {
      return undefined;
    }

    const liked = await this.database
      .prepare('SELECT created_at FROM template_likes WHERE template_id = ?1 AND user_id = ?2 LIMIT 1')
      .bind(detail.template.id, buildMarketplaceUserId(user.githubUserId))
      .first<{ created_at: string }>();
    return {
      templateId: detail.template.id,
      liked: Boolean(liked),
      likeCount: detail.template.likeCount,
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
    const versionCounts = await this.fetchPublisherVersionCounts(publisherId);
    const templateStats = templates.map((template) => ({
      template: toStatsTemplateSummary(template),
      downloadCount: template.downloadCount,
      likeCount: template.likeCount,
      publishCount: versionCounts.get(template.id) ?? Math.max(1, template.versions.length)
    }));
    const publishCount = templateStats.reduce((total, template) => total + template.publishCount, 0);

    return {
      totals: {
        templateCount: templates.length,
        downloadCount: templates.reduce((total, template) => total + template.downloadCount, 0),
        likeCount: templates.reduce((total, template) => total + template.likeCount, 0),
        publishCount
      },
      daily,
      templates: templateStats,
      storageMode: this.storageMode
    };
  }

  public async isUserBanned(user: MarketplaceRepositoryUserInput): Promise<boolean> {
    const row = await this.database
      .prepare('SELECT banned_at FROM users WHERE github_user_id = ?1 LIMIT 1')
      .bind(user.githubUserId)
      .first<{ banned_at: string | null }>();
    return Boolean(row?.banned_at);
  }

  public async isAdminUser(
    user: MarketplaceRepositoryUserInput,
    adminBootstrapAllowlist: MarketplaceAdminBootstrapAllowlist = {},
    at: Date = new Date()
  ): Promise<boolean> {
    const publisher = await this.upsertUser(user, at.toISOString(), adminBootstrapAllowlist);
    const row = await this.database
      .prepare('SELECT role FROM admin_roles WHERE user_id = ?1 LIMIT 1')
      .bind(publisher.id)
      .first<{ role: 'admin' }>();
    return row?.role === 'admin';
  }

  public async createTemplateReport(
    templateIdOrSlug: string,
    user: MarketplaceRepositoryUserInput,
    reason: MarketplaceReportReason,
    at: Date = new Date()
  ): Promise<MarketplaceTemplateReportResponse | undefined> {
    const detail = await this.getTemplateDetail(templateIdOrSlug);
    if (!detail) {
      return undefined;
    }

    const now = at.toISOString();
    const reporter = await this.upsertUser(user, now);
    const reportId = `report-${crypto.randomUUID()}`;
    await this.database
      .prepare(
        `INSERT INTO reports (id, template_id, version_id, reporter_user_id, reason, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6)`
      )
      .bind(reportId, detail.template.id, detail.template.latestVersion.id, reporter.id, reason, now)
      .run();

    const report = await this.fetchAdminReport(reportId);
    return report ? { report, storageMode: this.storageMode } : undefined;
  }

  public async listAdminReports(status?: 'open' | 'resolved' | 'rejected'): Promise<MarketplaceAdminReportsResponse> {
    const whereClause = status ? 'WHERE r.status = ?1' : '';
    const result = await this.database
      .prepare(`${adminReportSelectSql} ${whereClause} ORDER BY r.created_at DESC`)
      .bind(...(status ? [status] : []))
      .all<AdminReportRow>();
    return {
      items: (result.results ?? []).map(mapAdminReportRow),
      storageMode: this.storageMode
    };
  }

  public async resolveAdminReport(
    reportId: string,
    actor: MarketplaceRepositoryUserInput,
    request: MarketplaceAdminReportActionRequest,
    at: Date = new Date()
  ): Promise<MarketplaceTemplateReportResponse | undefined> {
    const before = await this.fetchAdminReport(reportId);
    if (!before) {
      return undefined;
    }

    const now = at.toISOString();
    const actorId = buildMarketplaceUserId(actor.githubUserId);
    const resolution = sanitizeOptionalText(request.resolution, 500);
    await this.database
      .prepare('UPDATE reports SET status = ?1, resolution = ?2, resolved_at = ?3 WHERE id = ?4')
      .bind(request.status, resolution, now, reportId)
      .run();

    if (request.status === 'resolved' && request.delistTemplate) {
      await this.database
        .prepare('UPDATE templates SET status = ?1, updated_at = ?2 WHERE id = ?3')
        .bind('delisted', now, before.template.id)
        .run();
      await this.insertAdminAuditLog(actorId, 'template.delist', 'template', before.template.id, before.template, { ...before.template, status: 'delisted' }, now);
    }

    const after = await this.fetchAdminReport(reportId);
    if (!after) {
      return undefined;
    }
    await this.insertAdminAuditLog(actorId, request.status === 'resolved' ? 'report.resolve' : 'report.reject', 'report', reportId, before, after, now);
    return { report: after, storageMode: this.storageMode };
  }

  public async setAdminTemplateStatus(
    templateIdOrSlug: string,
    actor: MarketplaceRepositoryUserInput,
    request: MarketplaceAdminTemplateStatusRequest,
    at: Date = new Date()
  ): Promise<MarketplaceAdminTemplateStatusResponse | undefined> {
    const before = await this.fetchAdminTemplate(templateIdOrSlug);
    if (!before) {
      return undefined;
    }

    const now = at.toISOString();
    await this.database
      .prepare('UPDATE templates SET status = ?1, updated_at = ?2 WHERE id = ?3')
      .bind(request.status, now, before.id)
      .run();
    const after = await this.fetchAdminTemplate(before.id);
    if (!after) {
      return undefined;
    }
    await this.insertAdminAuditLog(
      buildMarketplaceUserId(actor.githubUserId),
      request.status === 'published' ? 'template.restore' : 'template.delist',
      'template',
      before.id,
      before,
      after,
      now
    );
    return { template: after, storageMode: this.storageMode };
  }

  public async setAdminUserBan(
    userId: string,
    actor: MarketplaceRepositoryUserInput,
    request: MarketplaceAdminUserBanRequest,
    at: Date = new Date()
  ): Promise<MarketplaceAdminUserBanResponse | undefined> {
    const before = await this.fetchAdminUser(userId);
    if (!before) {
      return undefined;
    }

    const now = at.toISOString();
    const bannedAt = request.banned ? now : null;
    await this.database.prepare('UPDATE users SET banned_at = ?1 WHERE id = ?2').bind(bannedAt, before.id).run();
    const after = await this.fetchAdminUser(before.id);
    if (!after) {
      return undefined;
    }
    await this.insertAdminAuditLog(
      buildMarketplaceUserId(actor.githubUserId),
      request.banned ? 'user.ban' : 'user.unban',
      'user',
      before.id,
      before,
      after,
      now
    );
    return { user: after, storageMode: this.storageMode };
  }

  public async getAdminStats(): Promise<MarketplaceAdminStatsResponse> {
    const [templateTotals, userTotals, reportTotals, adminTotals, templateResult, dailyResult, versionCounts, publisherCount] = await Promise.all([
      this.database
        .prepare(
          `SELECT
             COUNT(*) AS template_count,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published_template_count,
             SUM(CASE WHEN status = 'delisted' THEN 1 ELSE 0 END) AS delisted_template_count,
             COALESCE(SUM(download_count), 0) AS download_count,
             COALESCE(SUM(like_count), 0) AS like_count
           FROM templates`
        )
        .first<AdminTemplateTotalsRow>(),
      this.database
        .prepare(
          `SELECT
             COUNT(*) AS user_count,
             SUM(CASE WHEN banned_at IS NOT NULL THEN 1 ELSE 0 END) AS banned_user_count
           FROM users`
        )
        .first<AdminUserTotalsRow>(),
      this.database
        .prepare(
          `SELECT
             COUNT(*) AS report_count,
             SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_report_count,
             SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_report_count,
             SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_report_count
           FROM reports`
        )
        .first<AdminReportTotalsRow>(),
      this.database.prepare('SELECT COUNT(*) AS admin_action_count FROM admin_audit_logs').first<AdminAuditTotalsRow>(),
      this.database.prepare(`${templateSelectSql} WHERE t.status = 'published' GROUP BY t.id ORDER BY t.download_count DESC, t.like_count DESC, t.updated_at DESC LIMIT 5`).all<TemplateRow>(),
      this.database
        .prepare(
          `SELECT day,
                  SUM(download_count) AS download_count,
                  SUM(like_count) AS like_count,
                  SUM(publish_count) AS publish_count
           FROM template_daily_stats
           GROUP BY day
           ORDER BY day ASC`
        )
        .all<DailyStatsRow>(),
      this.fetchAllPublishedVersionCounts(),
      this.countPublishers()
    ]);
    const topTemplates = (templateResult.results ?? []).map((row) => {
      const template = mapTemplateRow(row);
      return {
        template: toStatsTemplateSummary(template),
        downloadCount: template.downloadCount,
        likeCount: template.likeCount,
        publishCount: versionCounts.get(template.id) ?? Math.max(1, template.versions.length)
      };
    });
    const publishCount = Array.from(versionCounts.values()).reduce((total, count) => total + count, 0);

    return {
      totals: {
        templateCount: templateTotals?.template_count ?? 0,
        publishedTemplateCount: templateTotals?.published_template_count ?? 0,
        delistedTemplateCount: templateTotals?.delisted_template_count ?? 0,
        userCount: userTotals?.user_count ?? 0,
        bannedUserCount: userTotals?.banned_user_count ?? 0,
        publisherCount,
        downloadCount: templateTotals?.download_count ?? 0,
        likeCount: templateTotals?.like_count ?? 0,
        publishCount,
        reportCount: reportTotals?.report_count ?? 0,
        openReportCount: reportTotals?.open_report_count ?? 0,
        resolvedReportCount: reportTotals?.resolved_report_count ?? 0,
        rejectedReportCount: reportTotals?.rejected_report_count ?? 0,
        adminActionCount: adminTotals?.admin_action_count ?? 0
      },
      daily: (dailyResult.results ?? []).map(mapDailyStatsRow),
      topTemplates,
      storageMode: this.storageMode
    };
  }

  public async isTemplateSlugAvailable(slug: string): Promise<boolean> {
    const existingTemplate = await this.database.prepare('SELECT id FROM templates WHERE slug = ?1 LIMIT 1').bind(slug).first<{ id: string }>();
    return !existingTemplate;
  }

  public async publishTemplate(
    record: MarketplacePublishTemplateRecord,
    adminBootstrapAllowlist: MarketplaceAdminBootstrapAllowlist = {}
  ): Promise<TemplateDetailResponse> {
    if (!(await this.isTemplateSlugAvailable(record.slug))) {
      throw new MarketplaceRepositoryWriteError('template_slug_conflict', 'A template with this slug already exists.', 409);
    }

    const publisher = await this.upsertUser(record.publisher, record.createdAt, adminBootstrapAllowlist);
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

  private async fetchPublisherVersionCounts(publisherId: string): Promise<Map<string, number>> {
    const result = await this.database
      .prepare(
        `SELECT v.template_id AS template_id, COUNT(*) AS publish_count
         FROM template_versions v
         JOIN templates t ON t.id = v.template_id
         WHERE t.publisher_id = ?1 AND t.status = 'published' AND v.status = 'published'
         GROUP BY v.template_id`
      )
      .bind(publisherId)
      .all<{ template_id: string; publish_count: number }>();
    return new Map((result.results ?? []).map((row) => [row.template_id, row.publish_count]));
  }

  private async fetchAllPublishedVersionCounts(): Promise<Map<string, number>> {
    const result = await this.database
      .prepare(
        `SELECT template_id, COUNT(*) AS publish_count
         FROM template_versions
         WHERE status = 'published'
         GROUP BY template_id`
      )
      .all<{ template_id: string; publish_count: number }>();
    return new Map((result.results ?? []).map((row) => [row.template_id, row.publish_count]));
  }

  private async countPublishers(): Promise<number> {
    const row = await this.database.prepare('SELECT COUNT(DISTINCT publisher_id) AS publisher_count FROM templates').first<{ publisher_count: number }>();
    return row?.publisher_count ?? 0;
  }

  private async fetchAdminReport(reportId: string) {
    const row = await this.database
      .prepare(`${adminReportSelectSql} WHERE r.id = ?1 LIMIT 1`)
      .bind(reportId)
      .first<AdminReportRow>();
    return row ? mapAdminReportRow(row) : undefined;
  }

  private async fetchAdminTemplate(templateIdOrSlug: string) {
    const row = await this.database
      .prepare(
        `SELECT
           t.id AS template_id,
           t.slug AS template_slug,
           t.name AS template_name,
           t.status AS template_status,
           u.id AS publisher_id,
           u.github_login AS publisher_github_login,
           u.display_name AS publisher_display_name,
           u.avatar_url AS publisher_avatar_url
         FROM templates t
         JOIN users u ON u.id = t.publisher_id
         WHERE t.id = ?1 OR t.slug = ?1
         LIMIT 1`
      )
      .bind(templateIdOrSlug)
      .first<AdminTemplateRow>();
    return row ? mapAdminTemplateRow(row) : undefined;
  }

  private async fetchAdminUser(userId: string) {
    const row = await this.database
      .prepare(
        `SELECT id, github_login, display_name, avatar_url, banned_at
         FROM users
         WHERE id = ?1
         LIMIT 1`
      )
      .bind(userId)
      .first<AdminUserRow>();
    return row ? mapAdminUserRow(row) : undefined;
  }

  private async insertAdminAuditLog(
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    before: unknown,
    after: unknown,
    at: string
  ): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO admin_audit_logs (id, actor_user_id, action, target_type, target_id, before_json, after_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .bind(`audit-${crypto.randomUUID()}`, actorUserId, action, targetType, targetId, JSON.stringify(before), JSON.stringify(after), at)
      .run();
  }

  public async upsertUser(
    user: MarketplaceRepositoryUserInput,
    at: string,
    adminBootstrapAllowlist: MarketplaceAdminBootstrapAllowlist = {}
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

    if (isAdminBootstrapUser(user, adminBootstrapAllowlist)) {
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

function isAdminBootstrapUser(user: MarketplaceRepositoryUserInput, allowlist: MarketplaceAdminBootstrapAllowlist): boolean {
  const allowedIds = new Set((allowlist.githubUserIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (allowedIds.has(user.githubUserId)) {
    return true;
  }

  const normalizedLogin = user.githubLogin.toLowerCase();
  return (allowlist.githubLogins ?? []).some((login) => login.trim().toLowerCase() === normalizedLogin);
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

interface AdminTemplateTotalsRow {
  template_count: number | null;
  published_template_count: number | null;
  delisted_template_count: number | null;
  download_count: number | null;
  like_count: number | null;
}

interface AdminUserTotalsRow {
  user_count: number | null;
  banned_user_count: number | null;
}

interface AdminReportTotalsRow {
  report_count: number | null;
  open_report_count: number | null;
  resolved_report_count: number | null;
  rejected_report_count: number | null;
}

interface AdminAuditTotalsRow {
  admin_action_count: number | null;
}

interface AdminTemplateRow {
  template_id: string;
  template_slug: string;
  template_name: string;
  template_status: 'published' | 'delisted';
  publisher_id: string;
  publisher_github_login: string;
  publisher_display_name: string;
  publisher_avatar_url: string;
}

interface AdminReportRow extends AdminTemplateRow {
  report_id: string;
  report_version_id: string | null;
  report_reason: MarketplaceReportReason;
  report_status: 'open' | 'resolved' | 'rejected';
  report_resolution: string | null;
  report_created_at: string;
  report_resolved_at: string | null;
  reporter_id: string;
  reporter_github_login: string;
  reporter_display_name: string;
  reporter_avatar_url: string;
}

interface AdminUserRow {
  id: string;
  github_login: string;
  display_name: string;
  avatar_url: string;
  banned_at: string | null;
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

const adminReportSelectSql = `SELECT
  r.id AS report_id,
  r.version_id AS report_version_id,
  r.reason AS report_reason,
  r.status AS report_status,
  r.resolution AS report_resolution,
  r.created_at AS report_created_at,
  r.resolved_at AS report_resolved_at,
  t.id AS template_id,
  t.slug AS template_slug,
  t.name AS template_name,
  t.status AS template_status,
  publisher.id AS publisher_id,
  publisher.github_login AS publisher_github_login,
  publisher.display_name AS publisher_display_name,
  publisher.avatar_url AS publisher_avatar_url,
  reporter.id AS reporter_id,
  reporter.github_login AS reporter_github_login,
  reporter.display_name AS reporter_display_name,
  reporter.avatar_url AS reporter_avatar_url
FROM reports r
JOIN templates t ON t.id = r.template_id
JOIN users publisher ON publisher.id = t.publisher_id
JOIN users reporter ON reporter.id = r.reporter_user_id`;

function mapAdminTemplateRow(row: AdminTemplateRow) {
  return {
    id: row.template_id,
    slug: row.template_slug,
    name: row.template_name,
    status: row.template_status,
    publisher: {
      id: row.publisher_id,
      githubLogin: row.publisher_github_login,
      displayName: row.publisher_display_name,
      avatarUrl: row.publisher_avatar_url
    }
  };
}

function mapAdminReportRow(row: AdminReportRow) {
  return {
    id: row.report_id,
    template: mapAdminTemplateRow(row),
    versionId: row.report_version_id ?? undefined,
    reporter: {
      id: row.reporter_id,
      githubLogin: row.reporter_github_login,
      displayName: row.reporter_display_name,
      avatarUrl: row.reporter_avatar_url
    },
    reason: row.report_reason,
    status: row.report_status,
    resolution: row.report_resolution ?? undefined,
    createdAt: row.report_created_at,
    resolvedAt: row.report_resolved_at ?? undefined
  };
}

function mapAdminUserRow(row: AdminUserRow) {
  return {
    id: row.id,
    githubLogin: row.github_login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bannedAt: row.banned_at ?? undefined
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

function sanitizeOptionalText(value: string | undefined, maxLength: number): string {
  return (value ?? '').trim().slice(0, maxLength);
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
