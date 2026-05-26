import { describe, expect, it } from 'vitest';

import { buildTemplatePackagePreview, collectReadmeMediaReferences } from './TemplatePublishView';

describe('template publish package guidance', () => {
  it('classifies README media references by package safety rules', () => {
    const media = collectReadmeMediaReferences(`
![Screenshot](./media/screenshot.png?raw=1)
[Demo video](./assets/demo.mp4)
![External](https://example.com/screenshot.png)
![Blocked](../outside.png)
<video src="./media/demo.mp4"></video>
`);

    expect(media.packageRelative).toEqual(['./media/screenshot.png?raw=1', './assets/demo.mp4']);
    expect(media.external).toEqual(['https://example.com/screenshot.png']);
    expect(media.blocked).toEqual(['../outside.png']);
    expect(media.htmlEmbeds).toBe(1);
  });

  it('summarizes the canonical package shape and lint messages', () => {
    const preview = buildTemplatePackagePreview(
      {
        name: 'Codex Package',
        slug: 'codex-package',
        description: 'A template package smoke fixture.',
        tags: 'smoke',
        readme: '# Codex Package\n\n![Screenshot](./media/screenshot.png)',
        changelog: 'Initial marketplace version.',
        templateJson: '{"version":1}',
        thumbnailPngBase64: 'png',
        thumbnailSource: 'generated',
        templateFileName: 'selected-export-name.json',
        thumbnailFileName: ''
      },
      {},
      { kind: 'available', slug: 'codex-package', message: 'Slug is available.' }
    );

    expect(preview.structure).toContain('  template-package.json');
    expect(preview.structure).toContain('  template.json');
    expect(preview.structure).not.toContain('selected-export-name.json');
    expect(preview.lintItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ok', label: 'Template JSON' }),
        expect.objectContaining({ kind: 'ok', label: 'Slug' }),
        expect.objectContaining({ kind: 'info', label: 'README media' }),
        expect.objectContaining({ kind: 'info', label: 'Install impact' })
      ])
    );
  });
});
