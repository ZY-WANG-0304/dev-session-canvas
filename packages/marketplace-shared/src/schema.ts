import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const marketplaceUsers = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    githubUserId: text('github_user_id').notNull(),
    githubLogin: text('github_login').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url').notNull(),
    bannedAt: text('banned_at'),
    createdAt: text('created_at').notNull(),
    lastLoginAt: text('last_login_at').notNull()
  },
  (table) => ({
    githubUserIdIdx: uniqueIndex('users_github_user_id_idx').on(table.githubUserId),
    githubLoginIdx: index('users_github_login_idx').on(table.githubLogin)
  })
);

export const marketplaceTemplates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    latestVersionId: text('latest_version_id'),
    name: text('name').notNull(),
    description: text('description').notNull(),
    readme: text('readme').notNull().default(''),
    publisherId: text('publisher_id').notNull().references(() => marketplaceUsers.id),
    status: text('status', { enum: ['published', 'delisted'] }).notNull().default('published'),
    downloadCount: integer('download_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    searchText: text('search_text').notNull().default(''),
    providerWarningsJson: text('provider_warnings_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    slugIdx: uniqueIndex('templates_slug_idx').on(table.slug),
    statusUpdatedIdx: index('templates_status_updated_idx').on(table.status, table.updatedAt),
    publisherIdx: index('templates_publisher_idx').on(table.publisherId)
  })
);

export const marketplaceTemplateVersions = sqliteTable(
  'template_versions',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull().references(() => marketplaceTemplates.id),
    versionNumber: integer('version_number').notNull(),
    changelog: text('changelog').notNull().default(''),
    objectKey: text('object_key').notNull(),
    thumbnailKey: text('thumbnail_key').notNull(),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    status: text('status', { enum: ['published', 'rejected'] }).notNull().default('published'),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    templateVersionIdx: uniqueIndex('template_versions_template_version_idx').on(table.templateId, table.versionNumber),
    templateStatusIdx: index('template_versions_template_status_idx').on(table.templateId, table.status)
  })
);

export const marketplaceTemplateTags = sqliteTable(
  'template_tags',
  {
    templateId: text('template_id').notNull().references(() => marketplaceTemplates.id),
    tag: text('tag').notNull(),
    displayText: text('display_text').notNull()
  },
  (table) => ({
    templateTagIdx: uniqueIndex('template_tags_template_tag_idx').on(table.templateId, table.tag),
    tagIdx: index('template_tags_tag_idx').on(table.tag)
  })
);

export const marketplaceTemplateLikes = sqliteTable(
  'template_likes',
  {
    templateId: text('template_id').notNull().references(() => marketplaceTemplates.id),
    userId: text('user_id').notNull().references(() => marketplaceUsers.id),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    templateUserIdx: uniqueIndex('template_likes_template_user_idx').on(table.templateId, table.userId),
    userIdx: index('template_likes_user_idx').on(table.userId)
  })
);

export const marketplaceTemplateCollections = sqliteTable(
  'template_collections',
  {
    templateId: text('template_id').notNull().references(() => marketplaceTemplates.id),
    userId: text('user_id').notNull().references(() => marketplaceUsers.id),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    templateUserIdx: uniqueIndex('template_collections_template_user_idx').on(table.templateId, table.userId),
    userIdx: index('template_collections_user_idx').on(table.userId)
  })
);

export const marketplaceTemplateDailyStats = sqliteTable(
  'template_daily_stats',
  {
    templateId: text('template_id').notNull().references(() => marketplaceTemplates.id),
    day: text('day').notNull(),
    downloadCount: integer('download_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    publishCount: integer('publish_count').notNull().default(0)
  },
  (table) => ({
    templateDayIdx: uniqueIndex('template_daily_stats_template_day_idx').on(table.templateId, table.day),
    dayIdx: index('template_daily_stats_day_idx').on(table.day)
  })
);

export const marketplaceReports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull().references(() => marketplaceTemplates.id),
    versionId: text('version_id').references(() => marketplaceTemplateVersions.id),
    reporterUserId: text('reporter_user_id').notNull().references(() => marketplaceUsers.id),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['open', 'resolved', 'rejected'] }).notNull().default('open'),
    resolution: text('resolution'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at')
  },
  (table) => ({
    statusIdx: index('reports_status_idx').on(table.status, table.createdAt),
    templateIdx: index('reports_template_idx').on(table.templateId)
  })
);

export const marketplaceAdminRoles = sqliteTable(
  'admin_roles',
  {
    userId: text('user_id').primaryKey().references(() => marketplaceUsers.id),
    role: text('role', { enum: ['admin'] }).notNull().default('admin'),
    createdAt: text('created_at').notNull()
  }
);

export const marketplaceAdminAuditLogs = sqliteTable(
  'admin_audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').notNull().references(() => marketplaceUsers.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    targetIdx: index('admin_audit_logs_target_idx').on(table.targetType, table.targetId),
    actorIdx: index('admin_audit_logs_actor_idx').on(table.actorUserId, table.createdAt)
  })
);

export const marketplaceSchema = {
  users: marketplaceUsers,
  templates: marketplaceTemplates,
  templateVersions: marketplaceTemplateVersions,
  templateTags: marketplaceTemplateTags,
  templateLikes: marketplaceTemplateLikes,
  templateCollections: marketplaceTemplateCollections,
  templateDailyStats: marketplaceTemplateDailyStats,
  reports: marketplaceReports,
  adminRoles: marketplaceAdminRoles,
  adminAuditLogs: marketplaceAdminAuditLogs
};
