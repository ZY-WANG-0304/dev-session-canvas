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

  it('builds D1 download metadata for a requested version', async () => {
    const repository = new D1TemplateRepository(createFakeD1Database());

    const response = await repository.buildDownloadResponse('d1-review-loop', 'ver-d1-review-1');

    expect(response?.storageMode).toBe('d1');
    expect(response?.versionNumber).toBe(1);
    expect(response?.objectKey).toContain('/versions/1/template.json');
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
});
