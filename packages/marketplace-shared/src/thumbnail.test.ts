import { describe, expect, it } from 'vitest';

import {
  MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_PALETTE,
  MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_THEME_COLORS,
  generateMarketplaceTemplateThumbnailPngBase64,
  generateMarketplaceTemplateThumbnailPngBytes
} from './thumbnail';

describe('marketplace thumbnail generation', () => {
  it('mirrors the canvas node type theme colors in thumbnail accents', () => {
    expect(MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_THEME_COLORS).toEqual({
      agent: '#22c55e',
      terminal: '#38bdf8',
      note: '#a78bfa'
    });
    expect(MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_PALETTE.agent.accent).toEqual([34, 197, 94, 255]);
    expect(MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_PALETTE.terminal.accent).toEqual([56, 189, 248, 255]);
    expect(MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_PALETTE.note.accent).toEqual([167, 139, 250, 255]);
  });

  it('renders a deterministic PNG thumbnail from template layout data', () => {
    const png = generateMarketplaceTemplateThumbnailPngBytes({
      template: {
        name: 'Review Loop',
        nodes: [
          {
            kind: 'agent',
            title: 'Implement',
            position: { x: 0, y: 0 },
            size: { width: 320, height: 200 }
          },
          {
            kind: 'terminal',
            title: 'Test',
            position: { x: 420, y: 40 },
            size: { width: 320, height: 200 }
          }
        ],
        edges: [{ sourceNodeIndex: 0, targetNodeIndex: 1 }]
      }
    });

    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeLessThan(1024 * 1024);
    expect(png.length).toBeGreaterThan(900_000);
  });

  it('keeps generated thumbnails focused on the template layout instead of decorative title bars', () => {
    const png = generateMarketplaceTemplateThumbnailPngBytes({
      template: {
        name: 'Review Loop',
        nodes: [
          {
            kind: 'agent',
            title: 'Implement',
            position: { x: 0, y: 0 },
            size: { width: 320, height: 200 }
          }
        ],
        edges: []
      }
    });

    const rgba = decodeStoredPngRgba(png);

    expect(pixelAt(rgba, 70, 66)).toEqual(pixelAt(rgba, 330, 66));
    expect(pixelAt(rgba, 70, 84)).toEqual(pixelAt(rgba, 330, 84));
  });

  it('uses the vertical space freed by removing the decorative title bars', () => {
    const png = generateMarketplaceTemplateThumbnailPngBytes({
      template: {
        name: 'Review Loop',
        nodes: [
          {
            kind: 'agent',
            title: 'Implement',
            position: { x: 0, y: 0 },
            size: { width: 320, height: 200 }
          }
        ],
        edges: []
      }
    });

    const rgba = decodeStoredPngRgba(png);
    const topAccentY = findFirstPixelY(rgba, MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_PALETTE.agent.accent);

    expect(topAccentY).toBeLessThan(155);
    expect(topAccentY).toBeGreaterThan(110);
  });

  it('returns base64 without a data URL prefix for publish payloads', () => {
    const base64 = generateMarketplaceTemplateThumbnailPngBase64({
      template: {
        name: 'Notes',
        nodes: [
          {
            kind: 'note',
            title: 'Plan',
            position: { x: 0, y: 0 },
            size: { width: 320, height: 180 }
          }
        ],
        edges: []
      }
    });

    expect(base64.startsWith('iVBORw0KGgo')).toBe(true);
    expect(base64).not.toContain('data:image/png');
  });
});

function decodeStoredPngRgba(png: Uint8Array): Uint8Array {
  const idatChunks: Uint8Array[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = readUint32(png, offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    if (type === 'IDAT') {
      idatChunks.push(png.subarray(dataStart, dataStart + length));
    }
    offset = dataStart + length + 4;
  }

  const idat = concatBytes(idatChunks);
  const scanlineChunks: Uint8Array[] = [];
  let blockOffset = 2;
  while (blockOffset < idat.length - 4) {
    const blockHeader = idat[blockOffset];
    const isFinal = (blockHeader & 1) === 1;
    const blockType = (blockHeader >> 1) & 0x03;
    expect(blockType).toBe(0);
    const length = idat[blockOffset + 1] | (idat[blockOffset + 2] << 8);
    const dataStart = blockOffset + 5;
    scanlineChunks.push(idat.subarray(dataStart, dataStart + length));
    blockOffset = dataStart + length;
    if (isFinal) {
      break;
    }
  }

  const scanlines = concatBytes(scanlineChunks);
  const width = 640;
  const height = 360;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (width * 4 + 1) + 1;
    rgba.set(scanlines.subarray(sourceOffset, sourceOffset + width * 4), row * width * 4);
  }
  return rgba;
}

function pixelAt(rgba: Uint8Array, x: number, y: number): number[] {
  const offset = (y * 640 + x) * 4;
  return [...rgba.subarray(offset, offset + 4)];
}

function findFirstPixelY(rgba: Uint8Array, color: readonly number[]): number {
  for (let y = 0; y < 360; y += 1) {
    for (let x = 0; x < 640; x += 1) {
      const offset = (y * 640 + x) * 4;
      if (
        rgba[offset] === color[0] &&
        rgba[offset + 1] === color[1] &&
        rgba[offset + 2] === color[2] &&
        rgba[offset + 3] === color[3]
      ) {
        return y;
      }
    }
  }
  throw new Error('Expected pixel color was not found.');
}

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
