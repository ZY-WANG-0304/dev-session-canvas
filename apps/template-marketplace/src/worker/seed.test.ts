import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const seedSql = readFileSync(resolve(__dirname, '../../seeds/0001_preview_templates.sql'), 'utf8');
const reviewLoopV2PatchSql = readFileSync(resolve(__dirname, '../../seeds/0002_preview_review_loop_v2.sql'), 'utf8');

describe('marketplace preview seed sql', () => {
  it('seeds the official preview templates and version object keys', () => {
    for (const value of [
      'getting-started-canvas',
      'review-loop',
      'release-readiness',
      'templates/tmpl-getting-started/versions/1/template.json',
      'templates/tmpl-review-loop/versions/1/template.json',
      'templates/tmpl-review-loop/versions/2/template.json',
      'templates/tmpl-release-readiness/versions/1/template.json'
    ]) {
      expect(seedSql).toContain(value);
    }
    expect(seedSql).toContain("'ver-review-loop-2'");
    expect(seedSql).toContain("'ver-review-loop-1'");
  });

  it('uses upserts so the preview seed can be re-run safely', () => {
    expect(seedSql).toContain('ON CONFLICT(id) DO UPDATE SET');
    expect(seedSql).toContain('ON CONFLICT(template_id, version_number) DO UPDATE SET');
    expect(seedSql).toContain('ON CONFLICT(template_id, tag) DO UPDATE SET');
  });

  it('keeps the review-loop v2 preview patch idempotent', () => {
    expect(reviewLoopV2PatchSql).toContain("'ver-review-loop-2'");
    expect(reviewLoopV2PatchSql).toContain('ON CONFLICT(template_id, version_number) DO UPDATE SET');
    expect(reviewLoopV2PatchSql).toContain("latest_version_id = 'ver-review-loop-2'");
  });
});
