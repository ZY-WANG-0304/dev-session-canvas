INSERT INTO users (id, github_user_id, github_login, display_name, avatar_url, banned_at, created_at, last_login_at)
VALUES (
  'github-zy-wang-0304',
  'zy-wang-0304-seed',
  'ZY-WANG-0304',
  'Dev Session Canvas',
  'https://github.com/ZY-WANG-0304.png',
  NULL,
  '2026-05-10T00:00:00.000Z',
  '2026-05-10T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  github_login = excluded.github_login,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  last_login_at = excluded.last_login_at;

INSERT INTO templates (id, slug, latest_version_id, name, description, readme, publisher_id, status, download_count, like_count, search_text, provider_warnings_json, created_at, updated_at)
VALUES
  (
    'tmpl-getting-started',
    'getting-started-canvas',
    'ver-getting-started-1',
    'Getting Started Canvas',
    'A starter layout that introduces agents, terminals, and notes in one workspace canvas.',
    'Use this template to learn the basic Dev Session Canvas workflow.',
    'github-zy-wang-0304',
    'published',
    128,
    21,
    'getting started canvas a starter layout that introduces agents terminals and notes in one workspace canvas starter agent note dev session canvas',
    '[]',
    '2026-05-10T00:00:00.000Z',
    '2026-05-10T00:00:00.000Z'
  ),
  (
    'tmpl-review-loop',
    'review-loop',
    'ver-review-loop-1',
    'Review Loop',
    'A focused review workflow with one implementation agent, one reviewer note, and a terminal checkpoint.',
    'Use this template when a change needs an explicit implementation and review rhythm.',
    'github-zy-wang-0304',
    'published',
    72,
    33,
    'review loop a focused review workflow with one implementation agent one reviewer note and a terminal checkpoint review quality terminal dev session canvas',
    '[]',
    '2026-05-09T00:00:00.000Z',
    '2026-05-09T00:00:00.000Z'
  ),
  (
    'tmpl-release-readiness',
    'release-readiness',
    'ver-release-readiness-1',
    'Release Readiness',
    'A release checklist canvas for packaging, smoke validation, notes, and final handoff.',
    'Use this template to prepare repeatable release validation work.',
    'github-zy-wang-0304',
    'published',
    48,
    12,
    'release readiness a release checklist canvas for packaging smoke validation notes and final handoff release smoke checklist dev session canvas',
    '[]',
    '2026-05-08T00:00:00.000Z',
    '2026-05-08T00:00:00.000Z'
  )
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  latest_version_id = excluded.latest_version_id,
  name = excluded.name,
  description = excluded.description,
  readme = excluded.readme,
  publisher_id = excluded.publisher_id,
  status = excluded.status,
  download_count = excluded.download_count,
  like_count = excluded.like_count,
  search_text = excluded.search_text,
  provider_warnings_json = excluded.provider_warnings_json,
  updated_at = excluded.updated_at;

INSERT INTO template_versions (id, template_id, version_number, changelog, object_key, thumbnail_key, sha256, size_bytes, schema_version, status, created_at)
VALUES
  (
    'ver-getting-started-1',
    'tmpl-getting-started',
    1,
    'Initial marketplace seed version.',
    'templates/tmpl-getting-started/versions/1/template.json',
    'templates/tmpl-getting-started/versions/1/thumbnail.png',
    '031e1f491c5e7b4b39c3c2a84dcf2d81e9833bad6228e32fa8f710dfccc00a7e',
    1497,
    1,
    'published',
    '2026-05-10T00:00:00.000Z'
  ),
  (
    'ver-review-loop-1',
    'tmpl-review-loop',
    1,
    'Initial review workflow seed.',
    'templates/tmpl-review-loop/versions/1/template.json',
    'templates/tmpl-review-loop/versions/1/thumbnail.png',
    '005e90644dae8084a612d6a9d2e198508618eaa792648eb19bc56113cbcc4e92',
    1897,
    1,
    'published',
    '2026-05-09T00:00:00.000Z'
  ),
  (
    'ver-release-readiness-1',
    'tmpl-release-readiness',
    1,
    'Initial release readiness seed.',
    'templates/tmpl-release-readiness/versions/1/template.json',
    'templates/tmpl-release-readiness/versions/1/thumbnail.png',
    'e63a9f3666284df207184414a75afb1a86f6536a53668279fe825577a400bef0',
    2045,
    1,
    'published',
    '2026-05-08T00:00:00.000Z'
  )
ON CONFLICT(template_id, version_number) DO UPDATE SET
  id = excluded.id,
  changelog = excluded.changelog,
  object_key = excluded.object_key,
  thumbnail_key = excluded.thumbnail_key,
  sha256 = excluded.sha256,
  size_bytes = excluded.size_bytes,
  schema_version = excluded.schema_version,
  status = excluded.status,
  created_at = excluded.created_at;

INSERT INTO template_tags (template_id, tag, display_text)
VALUES
  ('tmpl-getting-started', 'starter', 'starter'),
  ('tmpl-getting-started', 'agent', 'agent'),
  ('tmpl-getting-started', 'note', 'note'),
  ('tmpl-review-loop', 'review', 'review'),
  ('tmpl-review-loop', 'quality', 'quality'),
  ('tmpl-review-loop', 'terminal', 'terminal'),
  ('tmpl-release-readiness', 'release', 'release'),
  ('tmpl-release-readiness', 'smoke', 'smoke'),
  ('tmpl-release-readiness', 'checklist', 'checklist')
ON CONFLICT(template_id, tag) DO UPDATE SET
  display_text = excluded.display_text;

INSERT INTO template_daily_stats (template_id, day, download_count, like_count, publish_count)
VALUES
  ('tmpl-getting-started', '2026-05-10', 128, 21, 1),
  ('tmpl-review-loop', '2026-05-09', 72, 33, 1),
  ('tmpl-release-readiness', '2026-05-08', 48, 12, 1)
ON CONFLICT(template_id, day) DO UPDATE SET
  download_count = excluded.download_count,
  like_count = excluded.like_count,
  publish_count = excluded.publish_count;
