const defaultPublisher = {
  id: 'github-test-dscanvas-admin',
  githubUserId: 'test-dscanvas-admin',
  githubLogin: 'dscanvas-admin',
  displayName: 'DS Canvas Admin',
  avatarUrl: 'https://example.test/avatar.png'
} as const;

export interface FakeD1DatabaseOptions {
  publisherId?: string;
  publisherGithubUserId?: string;
  publisherGithubLogin?: string;
  publisherDisplayName?: string;
  publisherAvatarUrl?: string;
  viewerUserId?: string;
  viewerLiked?: boolean;
  publishedVersionCount?: number;
  viewerBanned?: boolean;
  adminUserIds?: string[];
}

function createTemplateRows(options: FakeD1DatabaseOptions = {}) {
  const publisher = {
    id: options.publisherId ?? defaultPublisher.id,
    githubUserId: options.publisherGithubUserId ?? defaultPublisher.githubUserId,
    githubLogin: options.publisherGithubLogin ?? defaultPublisher.githubLogin,
    displayName: options.publisherDisplayName ?? defaultPublisher.displayName,
    avatarUrl: options.publisherAvatarUrl ?? defaultPublisher.avatarUrl
  };
  return [
    {
      template_id: 'tmpl-d1-review',
      slug: 'd1-review-loop',
      name: 'D1 Review Loop',
      description: 'Review template loaded from D1 metadata.',
      readme: 'D1 detail readme.',
      template_status: 'published',
      download_count: 44,
      like_count: 9,
      provider_warnings_json: '["Requires GitHub provider"]',
      template_created_at: '2026-05-10T01:00:00.000Z',
      template_updated_at: '2026-05-10T02:00:00.000Z',
      publisher_id: publisher.id,
      publisher_github_login: publisher.githubLogin,
      publisher_display_name: publisher.displayName,
      publisher_avatar_url: publisher.avatarUrl,
      version_id: 'ver-d1-review-2',
      version_number: 2,
      changelog: 'Second D1 version.',
      object_key: 'templates/tmpl-d1-review/versions/2/template.json',
      thumbnail_key: 'templates/tmpl-d1-review/versions/2/thumbnail.png',
      sha256: 'd1-review-sha',
      size_bytes: 1234,
      schema_version: 1,
      version_status: 'published',
      version_created_at: '2026-05-10T02:00:00.000Z',
      tags: 'review,d1'
    }
  ] as const;
}

const versionRows = [
  {
    id: 'ver-d1-review-2',
    template_id: 'tmpl-d1-review',
    version_number: 2,
    changelog: 'Second D1 version.',
    object_key: 'templates/tmpl-d1-review/versions/2/template.json',
    thumbnail_key: 'templates/tmpl-d1-review/versions/2/thumbnail.png',
    sha256: 'd1-review-sha',
    size_bytes: 1234,
    schema_version: 1,
    status: 'published',
    created_at: '2026-05-10T02:00:00.000Z'
  },
  {
    id: 'ver-d1-review-1',
    template_id: 'tmpl-d1-review',
    version_number: 1,
    changelog: 'Initial D1 version.',
    object_key: 'templates/tmpl-d1-review/versions/1/template.json',
    thumbnail_key: 'templates/tmpl-d1-review/versions/1/thumbnail.png',
    sha256: 'd1-review-sha-v1',
    size_bytes: 1000,
    schema_version: 1,
    status: 'published',
    created_at: '2026-05-10T01:00:00.000Z'
  }
] as const;

export interface FakeD1Run {
  sql: string;
  boundValues: unknown[];
}

export function createFakeD1Database(runLog: FakeD1Run[] = [], options: FakeD1DatabaseOptions = {}): D1Database {
  const templateRows = createTemplateRows(options);
  const publisherGithubUserId = options.publisherGithubUserId ?? defaultPublisher.githubUserId;
  const viewerUserId = options.viewerUserId ?? defaultPublisher.id;
  const publishedVersionCount = options.publishedVersionCount ?? versionRows.length;
  const adminUserIds = new Set(options.adminUserIds ?? []);
  let viewerLiked = options.viewerLiked ?? false;
  let viewerBanned = options.viewerBanned ?? false;
  let currentLikeCount: number = templateRows[0]?.like_count ?? 0;
  let currentTemplateStatus: 'published' | 'delisted' = templateRows[0]?.template_status ?? 'published';
  let reportStatus: 'open' | 'resolved' | 'rejected' = 'open';
  let reportResolution = '';
  let reportResolvedAt: string | null = null;
  let adminActionCount = 0;
  return {
    prepare(sql: string) {
      let boundValues: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          boundValues = values;
          return this;
        },
        async all() {
          if (sql.includes('FROM reports r')) {
            return {
              results: [
                createReportRow({
                  templateRows,
                  templateStatus: currentTemplateStatus,
                  reportStatus,
                  reportResolution,
                  reportResolvedAt
                })
              ],
              success: true,
              meta: {}
            };
          }
          if (sql.includes('FROM template_daily_stats')) {
            return {
              results: [
                {
                  day: '2026-05-10',
                  download_count: 3,
                  like_count: 2,
                  publish_count: 1
                },
                {
                  day: '2026-05-11',
                  download_count: 5,
                  like_count: 1,
                  publish_count: Math.max(0, publishedVersionCount - 1)
                }
              ],
              success: true,
              meta: {}
            };
          }
          if (sql.includes("template_id = ?1 AND status = 'published'")) {
            return { results: versionRows.slice(), success: true, meta: {} };
          }
          if (sql.includes('COUNT(*) AS publish_count') && sql.includes('FROM template_versions')) {
            return {
              results: [{ template_id: 'tmpl-d1-review', publish_count: publishedVersionCount }],
              success: true,
              meta: {}
            };
          }
          if (sql.includes('JOIN template_likes tl')) {
            return {
              results: viewerLiked && boundValues[0] === viewerUserId ? templateRows.slice() : [],
              success: true,
              meta: {}
            };
          }
          if (sql.includes('u.github_user_id = ?1')) {
            return {
              results: boundValues[0] === publisherGithubUserId ? templateRows.slice() : [],
              success: true,
              meta: {}
            };
          }
          return { results: templateRows.slice(), success: true, meta: {} };
        },
        async first() {
          if (sql.includes('FROM reports r')) {
            return createReportRow({
              templateRows,
              templateStatus: currentTemplateStatus,
              reportStatus,
              reportResolution,
              reportResolvedAt
            });
          }
          if (sql.includes('SELECT role FROM admin_roles')) {
            return adminUserIds.has(String(boundValues[0])) ? { role: 'admin' } : null;
          }
          if (sql.includes('COUNT(DISTINCT publisher_id) AS publisher_count')) {
            return { publisher_count: 1 };
          }
          if (sql.includes('COUNT(*) AS template_count')) {
            return {
              template_count: templateRows.length,
              published_template_count: currentTemplateStatus === 'published' ? templateRows.length : 0,
              delisted_template_count: currentTemplateStatus === 'delisted' ? templateRows.length : 0,
              download_count: currentTemplateStatus === 'published' ? 44 : 44,
              like_count: currentLikeCount
            };
          }
          if (sql.includes('COUNT(*) AS user_count')) {
            return {
              user_count: 2,
              banned_user_count: viewerBanned ? 1 : 0
            };
          }
          if (sql.includes('COUNT(*) AS report_count')) {
            return {
              report_count: 1,
              open_report_count: reportStatus === 'open' ? 1 : 0,
              resolved_report_count: reportStatus === 'resolved' ? 1 : 0,
              rejected_report_count: reportStatus === 'rejected' ? 1 : 0
            };
          }
          if (sql.includes('COUNT(*) AS admin_action_count')) {
            return { admin_action_count: adminActionCount };
          }
          if (sql.includes('SELECT banned_at FROM users WHERE github_user_id = ?1 LIMIT 1')) {
            return viewerBanned ? { banned_at: '2026-06-07T00:00:00.000Z' } : { banned_at: null };
          }
          if (sql.includes('FROM templates t') && sql.includes('JOIN users u') && sql.includes('template_slug')) {
            const row = templateRows[0];
            return row
              ? {
                  template_id: row.template_id,
                  template_slug: row.slug,
                  template_name: row.name,
                  template_status: currentTemplateStatus,
                  publisher_id: row.publisher_id,
                  publisher_github_login: row.publisher_github_login,
                  publisher_display_name: row.publisher_display_name,
                  publisher_avatar_url: row.publisher_avatar_url
                }
              : null;
          }
          if (sql.includes('SELECT id, github_login, display_name, avatar_url, banned_at')) {
            return {
              id: String(boundValues[0]),
              github_login: 'community-user',
              display_name: 'Community User',
              avatar_url: 'https://example.test/community.png',
              banned_at: viewerBanned ? '2026-06-07T00:00:00.000Z' : null
            };
          }
          if (sql.includes('SELECT id FROM templates WHERE slug = ?1 LIMIT 1')) {
            const row = templateRows.find((entry) => entry.slug === boundValues[0]);
            return row ? { id: row.template_id } : null;
          }
          if (sql.includes('SELECT created_at FROM template_likes')) {
            return viewerLiked && boundValues[1] === viewerUserId ? { created_at: '2026-05-10T00:00:00.000Z' } : null;
          }
          if (sql.includes('SELECT like_count FROM templates')) {
            return { like_count: currentLikeCount };
          }
          if (sql.includes('WHERE (t.id = ?1 OR t.slug = ?1)')) {
            return templateRows.find((row) => row.template_id === boundValues[0] || row.slug === boundValues[0]) ?? null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO reports')) {
            reportStatus = 'open';
            reportResolution = '';
            reportResolvedAt = null;
          }
          if (sql.includes('UPDATE reports SET status = ?1')) {
            reportStatus = boundValues[0] as 'open' | 'resolved' | 'rejected';
            reportResolution = String(boundValues[1] ?? '');
            reportResolvedAt = String(boundValues[2] ?? '');
          }
          if (sql.includes('UPDATE templates SET status = ?1')) {
            currentTemplateStatus = boundValues[0] as 'published' | 'delisted';
          }
          if (sql.includes('UPDATE users SET banned_at = ?1')) {
            viewerBanned = Boolean(boundValues[0]);
          }
          if (sql.includes('INSERT INTO admin_roles')) {
            adminUserIds.add(String(boundValues[0]));
          }
          if (sql.includes('INSERT INTO admin_audit_logs')) {
            adminActionCount += 1;
          }
          if (sql.includes('INSERT INTO template_likes')) {
            viewerLiked = true;
          }
          if (sql.includes('DELETE FROM template_likes')) {
            viewerLiked = false;
          }
          if (sql.includes('UPDATE templates SET like_count = like_count + 1')) {
            currentLikeCount += 1;
          }
          if (sql.includes('UPDATE templates SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END')) {
            currentLikeCount = Math.max(0, currentLikeCount - 1);
          }
          runLog.push({ sql, boundValues: boundValues.slice() });
          return { results: [], success: true, meta: {} };
        },
        raw: async () => [],
        firstWithMetadata: async () => ({ results: null, meta: {} })
      };
    },
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 })
  } as unknown as D1Database;
}

function createReportRow({
  templateRows,
  templateStatus,
  reportStatus,
  reportResolution,
  reportResolvedAt
}: {
  templateRows: ReturnType<typeof createTemplateRows>;
  templateStatus: 'published' | 'delisted';
  reportStatus: 'open' | 'resolved' | 'rejected';
  reportResolution: string;
  reportResolvedAt: string | null;
}) {
  const row = templateRows[0];
  return {
    report_id: 'report-d1-review',
    report_version_id: row?.version_id ?? 'ver-d1-review-2',
    report_reason: 'malicious',
    report_status: reportStatus,
    report_resolution: reportResolution || null,
    report_created_at: '2026-06-07T00:00:00.000Z',
    report_resolved_at: reportResolvedAt,
    template_id: row?.template_id ?? 'tmpl-d1-review',
    template_slug: row?.slug ?? 'd1-review-loop',
    template_name: row?.name ?? 'D1 Review Loop',
    template_status: templateStatus,
    publisher_id: row?.publisher_id ?? defaultPublisher.id,
    publisher_github_login: row?.publisher_github_login ?? defaultPublisher.githubLogin,
    publisher_display_name: row?.publisher_display_name ?? defaultPublisher.displayName,
    publisher_avatar_url: row?.publisher_avatar_url ?? defaultPublisher.avatarUrl,
    reporter_id: 'github-test-community-user',
    reporter_github_login: 'community-user',
    reporter_display_name: 'Community User',
    reporter_avatar_url: 'https://example.test/community.png'
  };
}
