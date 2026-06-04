import { describe, expect, it } from 'vitest';

import { D1TemplateRepository } from './repository';
import { createFakeD1Database, type FakeD1Run } from './testD1Database';

describe('D1TemplateRepository', () => {
  it('maps D1 rows into list responses', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.listTemplates({ q: 'review', tags: ['d1'] });

    expect(response.storageMode).toBe('d1');
    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.slug).toBe('d1-review-loop');
    expect(response.items[0]?.latestVersion.versionNumber).toBe(2);
  });

  it('loads detail with version history and provider warnings', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.getTemplateDetail('d1-review-loop');

    expect(response?.storageMode).toBe('d1');
    expect(response?.template.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
    expect(response?.template.providerWarnings).toEqual(['Requires GitHub provider']);
  });

  it('lists templates published by the current GitHub user', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.listTemplatesByPublisher({
      githubUserId: 'test-dscanvas-admin',
      githubLogin: 'dscanvas-admin',
      displayName: 'DS Canvas Admin',
      avatarUrl: ''
    });

    expect(response.storageMode).toBe('d1');
    expect(response.items.map((template) => template.slug)).toEqual(['d1-review-loop']);
  });

  it('returns an empty publisher list for other GitHub users', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.listTemplatesByPublisher({
      githubUserId: 'test-someone-else',
      githubLogin: 'someone-else',
      displayName: 'Someone Else',
      avatarUrl: ''
    });

    expect(response.items).toHaveLength(0);
  });

  it('falls back to the latest published version when the latest pointer is rejected', async () => {
    const repository = new D1TemplateRepository(createFallbackAwareD1Database());

    const listResponse = await repository.listTemplates({ q: 'review', tags: ['d1'] });
    expect(listResponse.items).toHaveLength(1);
    expect(listResponse.items[0]?.latestVersion.versionNumber).toBe(1);

    const detailResponse = await repository.getTemplateDetail('d1-review-loop');
    expect(detailResponse?.template.latestVersion.versionNumber).toBe(1);
    expect(detailResponse?.template.versions.map((version) => version.versionNumber)).toEqual([1]);

    const defaultDownloadResponse = await repository.buildDownloadResponse('d1-review-loop');
    expect(defaultDownloadResponse?.versionNumber).toBe(1);

    const rejectedVersionResponse = await repository.buildDownloadResponse('d1-review-loop', 'ver-d1-review-2');
    expect(rejectedVersionResponse).toBeUndefined();
  });

  it('ignores latest pointers that target another template version', async () => {
    const repository = new D1TemplateRepository(createCrossTemplateLatestPointerD1Database());

    const listResponse = await repository.listTemplates({ q: 'review', tags: ['d1'] });
    expect(listResponse.items).toHaveLength(1);
    expect(listResponse.items[0]?.latestVersion.versionNumber).toBe(1);
    expect(listResponse.items[0]?.latestVersion.objectKey).toBe('templates/tmpl-d1-review/versions/1/template.json');

    const detailResponse = await repository.getTemplateDetail('d1-review-loop');
    expect(detailResponse?.template.latestVersion.sha256).toBe('d1-review-sha-v1');
    expect(detailResponse?.template.versions.map((version) => version.id)).toEqual(['ver-d1-review-1']);

    const defaultDownloadResponse = await repository.buildDownloadResponse('d1-review-loop');
    expect(defaultDownloadResponse?.versionNumber).toBe(1);
    expect(defaultDownloadResponse?.objectKey).toBe('templates/tmpl-d1-review/versions/1/template.json');
  });

  it('builds D1 download metadata for a requested version', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.buildDownloadResponse('d1-review-loop', 'ver-d1-review-1');

    expect(response?.storageMode).toBe('d1');
    expect(response?.versionNumber).toBe(1);
    expect(response?.objectKey).toContain('/versions/1/template.json');
  });

  it('builds D1 package download metadata from the requested version directory', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.buildPackageDownloadResponse('d1-review-loop', 'ver-d1-review-1');

    expect(response?.storageMode).toBe('d1');
    expect(response?.versionNumber).toBe(1);
    expect(response?.packageObjectKey).toBe('templates/tmpl-d1-review/versions/1/package.zip');
    expect(response?.packageDownloadUrl).toBe('/api/v1/templates/tmpl-d1-review/download?version=ver-d1-review-1');
  });

  it('records downloads into cumulative and daily counters', async () => {
    const runLog: FakeD1Run[] = [];
    const repository = new D1TemplateRepository(createFakeD1Database(runLog));

    await repository.recordDownload('tmpl-d1-review', 'ver-d1-review-2', new Date('2026-05-10T12:00:00.000Z'));

    expect(runLog).toHaveLength(2);
    expect(runLog[0]?.sql).toContain('UPDATE templates SET download_count = download_count + 1');
    expect(runLog[0]?.boundValues).toEqual(['tmpl-d1-review']);
    expect(runLog[1]?.sql).toContain('ON CONFLICT(template_id, day)');
    expect(runLog[1]?.boundValues).toEqual(['tmpl-d1-review', '2026-05-10']);
  });

  it('records template likes into relationship, cumulative, and daily counters', async () => {
    const runLog: FakeD1Run[] = [];
    const repository = new D1TemplateRepository(createFakeD1Database(runLog, { viewerUserId: 'github-test-community-user' }));

    const response = await repository.setTemplateLike(
      'd1-review-loop',
      {
        githubUserId: 'test-community-user',
        githubLogin: 'community-user',
        displayName: 'Community User',
        avatarUrl: ''
      },
      true,
      new Date('2026-05-12T12:00:00.000Z')
    );

    expect(response).toEqual({
      templateId: 'tmpl-d1-review',
      liked: true,
      likeCount: 10,
      storageMode: 'd1'
    });
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO users'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_likes'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('UPDATE templates SET like_count = like_count + 1'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('ON CONFLICT(template_id, day)'))).toBe(true);
  });

  it('removes template likes without decrementing daily historical stats', async () => {
    const runLog: FakeD1Run[] = [];
    const repository = new D1TemplateRepository(createFakeD1Database(runLog, { viewerUserId: 'github-test-community-user', viewerLiked: true }));

    const response = await repository.setTemplateLike(
      'd1-review-loop',
      {
        githubUserId: 'test-community-user',
        githubLogin: 'community-user',
        displayName: 'Community User',
        avatarUrl: ''
      },
      false,
      new Date('2026-05-12T12:00:00.000Z')
    );

    expect(response?.liked).toBe(false);
    expect(response?.likeCount).toBe(8);
    expect(runLog.some((entry) => entry.sql.includes('DELETE FROM template_likes'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0'))).toBe(true);
    expect(runLog.some((entry) => entry.sql.includes('INSERT INTO template_daily_stats'))).toBe(false);
  });

  it('lists templates liked by the current user', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database([], { viewerLiked: true }));

    const response = await repository.listLikedTemplates({
      githubUserId: 'test-dscanvas-admin',
      githubLogin: 'dscanvas-admin',
      displayName: 'DS Canvas Admin',
      avatarUrl: ''
    });

    expect(response.storageMode).toBe('d1');
    expect(response.items.map((template) => template.slug)).toEqual(['d1-review-loop']);
  });

  it('returns publisher dashboard stats from cumulative and daily counters', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.getPublisherStats({
      githubUserId: 'test-dscanvas-admin',
      githubLogin: 'dscanvas-admin',
      displayName: 'DS Canvas Admin',
      avatarUrl: ''
    });

    expect(response.storageMode).toBe('d1');
    expect(response.totals).toEqual({
      templateCount: 1,
      downloadCount: 44,
      likeCount: 9,
      publishCount: 1
    });
    expect(response.daily).toEqual([
      { day: '2026-05-10', downloadCount: 3, likeCount: 2, publishCount: 1 },
      { day: '2026-05-11', downloadCount: 5, likeCount: 1, publishCount: 0 }
    ]);
    expect(response.templates[0]?.template.slug).toBe('d1-review-loop');
    expect(response.templates[0]?.downloadCount).toBe(44);
  });
});

function createFallbackAwareD1Database(): D1Database {
  const publishedVersionRow = {
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
  } as const;

  const rejectedLatestTemplateRow = {
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
    publisher_id: 'github-test-dscanvas-admin',
    publisher_github_login: 'dscanvas-admin',
    publisher_display_name: 'DS Canvas Admin',
    publisher_avatar_url: 'https://example.test/avatar.png',
    version_id: 'ver-d1-review-2',
    version_number: 2,
    changelog: 'Second D1 version.',
    object_key: 'templates/tmpl-d1-review/versions/2/template.json',
    thumbnail_key: 'templates/tmpl-d1-review/versions/2/thumbnail.png',
    sha256: 'd1-review-sha',
    size_bytes: 1234,
    schema_version: 1,
    version_status: 'rejected',
    version_created_at: '2026-05-10T02:00:00.000Z',
    tags: 'review,d1'
  } as const;

  const fallbackTemplateRow = {
    ...rejectedLatestTemplateRow,
    version_id: publishedVersionRow.id,
    version_number: publishedVersionRow.version_number,
    changelog: publishedVersionRow.changelog,
    object_key: publishedVersionRow.object_key,
    thumbnail_key: publishedVersionRow.thumbnail_key,
    sha256: publishedVersionRow.sha256,
    size_bytes: publishedVersionRow.size_bytes,
    version_status: publishedVersionRow.status,
    version_created_at: publishedVersionRow.created_at
  } as const;

  return {
    prepare(sql: string) {
      let boundValues: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          boundValues = values;
          return this;
        },
        async all() {
          if (sql.includes("template_id = ?1 AND status = 'published'")) {
            return { results: [publishedVersionRow], success: true, meta: {} };
          }
          if (sql.includes('latest_published_version')) {
            return { results: [fallbackTemplateRow], success: true, meta: {} };
          }
          return { results: [rejectedLatestTemplateRow], success: true, meta: {} };
        },
        async first() {
          if (sql.includes('latest_published_version')) {
            return fallbackTemplateRow;
          }
          return rejectedLatestTemplateRow;
        },
        async run() {
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

function createCrossTemplateLatestPointerD1Database(): D1Database {
  const publishedVersionRow = {
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
  } as const;

  const fallbackTemplateRow = {
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
    publisher_id: 'github-test-dscanvas-admin',
    publisher_github_login: 'dscanvas-admin',
    publisher_display_name: 'DS Canvas Admin',
    publisher_avatar_url: 'https://example.test/avatar.png',
    version_id: publishedVersionRow.id,
    version_number: publishedVersionRow.version_number,
    changelog: publishedVersionRow.changelog,
    object_key: publishedVersionRow.object_key,
    thumbnail_key: publishedVersionRow.thumbnail_key,
    sha256: publishedVersionRow.sha256,
    size_bytes: publishedVersionRow.size_bytes,
    schema_version: publishedVersionRow.schema_version,
    version_status: publishedVersionRow.status,
    version_created_at: publishedVersionRow.created_at,
    tags: 'review,d1'
  } as const;

  const crossTemplatePointerRow = {
    ...fallbackTemplateRow,
    version_id: 'ver-other-template-9',
    version_number: 9,
    changelog: 'Other template version.',
    object_key: 'templates/tmpl-other/versions/9/template.json',
    thumbnail_key: 'templates/tmpl-other/versions/9/thumbnail.png',
    sha256: 'other-template-sha',
    size_bytes: 9000,
    version_created_at: '2026-05-10T09:00:00.000Z'
  } as const;

  return {
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async all() {
          if (sql.includes("template_id = ?1 AND status = 'published'")) {
            return { results: [publishedVersionRow], success: true, meta: {} };
          }
          if (sql.includes('latest_published_version')) {
            return {
              results: [hasSameTemplateVersionGuards(sql) ? fallbackTemplateRow : crossTemplatePointerRow],
              success: true,
              meta: {}
            };
          }
          return { results: [fallbackTemplateRow], success: true, meta: {} };
        },
        async first() {
          if (sql.includes('latest_published_version')) {
            return hasSameTemplateVersionGuards(sql) ? fallbackTemplateRow : crossTemplatePointerRow;
          }
          return fallbackTemplateRow;
        },
        async run() {
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

function hasSameTemplateVersionGuards(sql: string): boolean {
  return (
    sql.includes('latest_published_version.template_id = t.id') &&
    sql.includes('v.template_id = t.id') &&
    sql.includes("v.status = 'published'")
  );
}
