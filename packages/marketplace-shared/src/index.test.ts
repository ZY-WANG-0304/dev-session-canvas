import { describe, expect, it } from 'vitest';

import {
  buildSeedDownloadResponse,
  calculateHotScore,
  getSeedTemplateDetail,
  listSeedTemplates,
  marketplaceSeedTemplates
} from './index';
import { marketplaceSchema } from './schema';

describe('marketplace shared seed repository', () => {
  it('lists published seed templates with pagination metadata', () => {
    const response = listSeedTemplates({ pageSize: 2 });

    expect(response.storageMode).toBe('seed');
    expect(response.items).toHaveLength(2);
    expect(response.pagination.total).toBe(marketplaceSeedTemplates.length);
    expect(response.pagination.hasMore).toBe(true);
  });

  it('filters templates by query and tag', () => {
    const response = listSeedTemplates({ q: 'review', tags: ['quality'] });

    expect(response.items.map((item) => item.slug)).toEqual(['review-loop']);
  });

  it('clamps overlong search queries before schema validation', () => {
    const response = listSeedTemplates({ q: 'x'.repeat(120) });

    expect(response.items).toHaveLength(0);
  });

  it('sorts by downloads and likes deterministically', () => {
    expect(listSeedTemplates({ sort: 'downloads' }).items[0]?.slug).toBe('getting-started-canvas');
    expect(listSeedTemplates({ sort: 'likes' }).items[0]?.slug).toBe('review-loop');
  });

  it('returns detail by id or slug', () => {
    expect(getSeedTemplateDetail('tmpl-release-readiness')?.slug).toBe('release-readiness');
    expect(getSeedTemplateDetail('release-readiness')?.id).toBe('tmpl-release-readiness');
  });

  it('builds seed download responses for the latest version', () => {
    const response = buildSeedDownloadResponse('review-loop');

    expect(response?.storageMode).toBe('seed');
    expect(response?.versionNumber).toBe(2);
    expect(response?.objectKey).toContain('/versions/2/template.json');
  });

  it('keeps previous review-loop versions downloadable by explicit version id', () => {
    const response = buildSeedDownloadResponse('review-loop', 'ver-review-loop-1');

    expect(response?.versionNumber).toBe(1);
    expect(response?.objectKey).toContain('/versions/1/template.json');
  });

  it('calculates hot score with a freshness boost', () => {
    const fresh = calculateHotScore(10, 10, '2026-05-10T00:00:00.000Z');
    const old = calculateHotScore(10, 10, '2026-04-01T00:00:00.000Z');

    expect(fresh).toBeGreaterThan(old);
  });

  it('exports the D1/Drizzle schema tables required through Phase 4', () => {
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
});
