PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  banned_at TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_github_login_idx ON users (github_login);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  latest_version_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  readme TEXT NOT NULL DEFAULT '',
  publisher_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'delisted')),
  download_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL DEFAULT '',
  provider_warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS templates_status_updated_idx ON templates (status, updated_at);
CREATE INDEX IF NOT EXISTS templates_publisher_idx ON templates (publisher_id);

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  version_number INTEGER NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL,
  thumbnail_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'rejected')),
  created_at TEXT NOT NULL,
  UNIQUE (template_id, version_number)
);
CREATE INDEX IF NOT EXISTS template_versions_template_status_idx ON template_versions (template_id, status);

CREATE TABLE IF NOT EXISTS template_tags (
  template_id TEXT NOT NULL REFERENCES templates(id),
  tag TEXT NOT NULL,
  display_text TEXT NOT NULL,
  UNIQUE (template_id, tag)
);
CREATE INDEX IF NOT EXISTS template_tags_tag_idx ON template_tags (tag);

CREATE TABLE IF NOT EXISTS template_likes (
  template_id TEXT NOT NULL REFERENCES templates(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (template_id, user_id)
);
CREATE INDEX IF NOT EXISTS template_likes_user_idx ON template_likes (user_id);

CREATE TABLE IF NOT EXISTS template_collections (
  template_id TEXT NOT NULL REFERENCES templates(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (template_id, user_id)
);
CREATE INDEX IF NOT EXISTS template_collections_user_idx ON template_collections (user_id);

CREATE TABLE IF NOT EXISTS template_daily_stats (
  template_id TEXT NOT NULL REFERENCES templates(id),
  day TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  publish_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, day)
);
CREATE INDEX IF NOT EXISTS template_daily_stats_day_idx ON template_daily_stats (day);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  version_id TEXT REFERENCES template_versions(id),
  reporter_user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS reports_template_idx ON reports (template_id);

CREATE TABLE IF NOT EXISTS admin_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx ON admin_audit_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx ON admin_audit_logs (actor_user_id, created_at);
