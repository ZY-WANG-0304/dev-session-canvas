import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';

import { buildTemplatePackageFileFromForm, buildTemplatePackagePreview, collectReadmeMediaReferences } from './TemplatePublishView';

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
        thumbnailFileName: '',
        packageFileName: '',
        packageWorktree: undefined,
        packageSource: 'none'
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
        expect.objectContaining({ kind: 'info', label: 'JSON mode' }),
        expect.objectContaining({ kind: 'info', label: 'README media' }),
        expect.objectContaining({ kind: 'info', label: 'Install impact' })
      ])
    );
  });

  it('rebuilds an uploaded package with edited fields before publishing', async () => {
    const templateDocument = buildTemplateDocument('Package Original');
    const originalPng = decodeBase64Png();
    const editedPng = decodeBase64Png('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+P+/HgMDAwMjAABuRAf8qO9NPwAAAABJRU5ErkJggg==');
    const file = await buildTemplatePackageFileFromForm(
      {
        name: 'Edited Package',
        slug: 'edited-package',
        description: 'Edited description.',
        tags: 'edited, package',
        readme: '# Edited README\n\n![Screenshot](./media/screenshot.png)',
        changelog: 'Edited changelog.',
        templateJson: JSON.stringify(templateDocument, null, 2),
        thumbnailPngBase64: `data:image/png;base64,${bytesToBase64(editedPng)}`,
        thumbnailSource: 'custom',
        templateFileName: 'template.json',
        thumbnailFileName: 'custom.png',
        packageFileName: 'original-package.zip',
        packageSource: 'zip',
        packageWorktree: {
          manifest: {
            schemaVersion: 1,
            slug: 'original-package',
            name: 'Package Original',
            description: 'Original description.',
            tags: ['original'],
            template: 'template.json',
            readme: 'README.md',
            changelog: 'CHANGELOG.md',
            thumbnail: 'media/thumbnail.png',
            media: {
              thumbnail: 'media/thumbnail.png',
              gallery: [{ type: 'image', path: 'media/screenshot.png', alt: 'Screenshot' }]
            }
          },
          templateJson: JSON.stringify(templateDocument, null, 2),
          readme: '# Original README\n\n![Screenshot](./media/screenshot.png)',
          changelog: 'Original changelog.',
          thumbnailDataUrl: `data:image/png;base64,${bytesToBase64(originalPng)}`,
          entries: new Map([
            ['template-package.json', new TextEncoder().encode('{}')],
            ['template.json', new TextEncoder().encode(JSON.stringify(templateDocument, null, 2))],
            ['README.md', new TextEncoder().encode('# Original README\n\n![Screenshot](./media/screenshot.png)\n')],
            ['CHANGELOG.md', new TextEncoder().encode('Original changelog.\n')],
            ['media/thumbnail.png', originalPng],
            ['media/screenshot.png', originalPng]
          ])
        }
      },
      templateDocument
    );

    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(entries['template-package.json'])) as { slug: string; name: string; description: string; tags: string[]; checksums?: { templateSha256?: string } };
    const rebuiltTemplate = JSON.parse(new TextDecoder().decode(entries['template.json'])) as { template: { name: string; category: string } };

    expect(file.name).toBe('original-package.zip');
    expect(manifest).toEqual(expect.objectContaining({ slug: 'edited-package', name: 'Edited Package', description: 'Edited description.', tags: ['edited', 'package'] }));
    expect(manifest.checksums?.templateSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(new TextDecoder().decode(entries['README.md'])).toBe('# Edited README\n\n![Screenshot](./media/screenshot.png)\n');
    expect(new TextDecoder().decode(entries['CHANGELOG.md'])).toBe('Edited changelog.\n');
    expect(rebuiltTemplate.template).toEqual(expect.objectContaining({ name: 'Edited Package', category: 'user' }));
    expect(entries['media/thumbnail.png']).toEqual(editedPng);
    expect(entries['media/screenshot.png']).toEqual(originalPng);
  });
});

function buildTemplateDocument(name: string) {
  return {
    version: 1 as const,
    template: {
      id: 'package-original',
      name,
      category: 'user' as const,
      nodes: [{ kind: 'note' as const, title: 'Readme', position: { x: 0, y: 0 }, size: { width: 320, height: 200 } }],
      edges: [],
      createdAt: '2026-05-29T00:00:00.000Z',
      updatedAt: '2026-05-29T00:00:00.000Z'
    }
  };
}

function decodeBase64Png(value = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAKB0nKcJwAAAABJRU5ErkJggg=='): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
