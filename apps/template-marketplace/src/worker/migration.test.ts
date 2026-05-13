import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { marketplaceSchema } from '@dev-session-canvas/marketplace-shared/schema';

const migrationText = readFileSync(resolve(__dirname, '../../migrations/0001_marketplace_core.sql'), 'utf8');

const coreTableNames = [
  'users',
  'templates',
  'template_versions',
  'template_tags',
  'template_likes',
  'template_collections',
  'template_daily_stats',
  'reports',
  'admin_roles',
  'admin_audit_logs'
] as const;

describe('marketplace D1 migration', () => {
  it('creates the Phase 1-4 core tables', () => {
    for (const tableName of coreTableNames) {
      expect(migrationText).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    }
  });

  it('exposes the Drizzle schema through the package schema subpath', () => {
    expect(Object.keys(marketplaceSchema).sort()).toEqual([
      'adminAuditLogs',
      'adminRoles',
      'reports',
      'templateCollections',
      'templateDailyStats',
      'templateLikes',
      'templateTags',
      'templateVersions',
      'templates',
      'users'
    ]);
  });

  it('keeps version objects immutable through object keys and latest version references', () => {
    expect(migrationText).toContain('latest_version_id TEXT');
    expect(migrationText).toContain('object_key TEXT NOT NULL');
    expect(migrationText).toContain('UNIQUE (template_id, version_number)');
  });
});
