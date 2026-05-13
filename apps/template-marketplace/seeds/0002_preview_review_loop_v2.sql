INSERT INTO template_versions (id, template_id, version_number, changelog, object_key, thumbnail_key, sha256, size_bytes, schema_version, status, created_at)
VALUES (
  'ver-review-loop-2',
  'tmpl-review-loop',
  2,
  'Adds a decision log note and clearer review handoff guidance.',
  'templates/tmpl-review-loop/versions/2/template.json',
  'templates/tmpl-review-loop/versions/2/thumbnail.png',
  'd74f3887ad39c05912629b771635bf8c3e110a498a559ec6b56d8aee390e8ead',
  2470,
  1,
  'published',
  '2026-05-10T09:00:00.000Z'
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

UPDATE templates
SET
  latest_version_id = 'ver-review-loop-2',
  description = 'A focused review workflow with implementation, reviewer, test checkpoint, and decision log nodes.',
  readme = 'Use this template when a change needs an explicit implementation, review, test, and handoff rhythm.',
  search_text = 'review loop a focused review workflow with implementation reviewer test checkpoint and decision log nodes review quality terminal decision dev session canvas',
  updated_at = '2026-05-10T09:00:00.000Z'
WHERE id = 'tmpl-review-loop';
