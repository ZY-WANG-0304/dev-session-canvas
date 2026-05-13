const templateRows = [
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
    publisher_id: 'user-admin',
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
    version_status: 'published',
    version_created_at: '2026-05-10T02:00:00.000Z',
    tags: 'review,d1'
  }
] as const;

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

export function createFakeD1Database(runLog: FakeD1Run[] = []): D1Database {
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
            return { results: versionRows.slice(), success: true, meta: {} };
          }
          return { results: templateRows.slice(), success: true, meta: {} };
        },
        async first() {
          if (sql.includes('WHERE (t.id = ?1 OR t.slug = ?1)')) {
            return templateRows.find((row) => row.template_id === boundValues[0] || row.slug === boundValues[0]) ?? null;
          }
          return null;
        },
        async run() {
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
