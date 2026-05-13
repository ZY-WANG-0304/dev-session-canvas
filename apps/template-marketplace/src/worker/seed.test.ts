import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const seedSql = readFileSync(resolve(__dirname, '../../seeds/0001_preview_templates.sql'), 'utf8');

describe('marketplace preview seed sql', () => {
  it('seeds the official preview templates and version object keys', () => {
    for (const value of [
      'getting-started-canvas',
      'review-loop',
      'release-readiness',
      'templates/tmpl-getting-started/versions/1/template.json',
      'templates/tmpl-review-loop/versions/1/template.json',
      'templates/tmpl-release-readiness/versions/1/template.json'
    ]) {
      expect(seedSql).toContain(value);
    }
  });

  it('uses upserts so the preview seed can be re-run safely', () => {
    expect(seedSql).toContain('ON CONFLICT(id) DO UPDATE SET');
    expect(seedSql).toContain('ON CONFLICT(template_id, version_number) DO UPDATE SET');
    expect(seedSql).toContain('ON CONFLICT(template_id, tag) DO UPDATE SET');
  });
});
