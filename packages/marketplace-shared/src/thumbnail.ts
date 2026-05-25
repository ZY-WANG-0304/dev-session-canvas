const PNG_WIDTH = 640;
const PNG_HEIGHT = 360;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

interface ThumbnailTemplateDocument {
  template: {
    name: string;
    nodes: ThumbnailNode[];
    edges: ThumbnailEdge[];
  };
}

interface ThumbnailNode {
  kind: 'agent' | 'terminal' | 'note';
  title: string;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  metadata?: unknown;
}

interface ThumbnailEdge {
  sourceNodeIndex: number;
  targetNodeIndex: number;
}

type Rgba = readonly [number, number, number, number];

export const MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_THEME_COLORS = {
  agent: '#22c55e',
  terminal: '#38bdf8',
  note: '#a78bfa'
} as const;

export const MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_PALETTE = {
  agent: {
    body: [228, 248, 236, 255],
    accent: [34, 197, 94, 255],
    border: [34, 197, 94, 160],
    text: [21, 128, 61, 185]
  },
  terminal: {
    body: [231, 247, 254, 255],
    accent: [56, 189, 248, 255],
    border: [56, 189, 248, 160],
    text: [3, 105, 161, 185]
  },
  note: {
    body: [244, 241, 254, 255],
    accent: [167, 139, 250, 255],
    border: [167, 139, 250, 160],
    text: [109, 40, 217, 180]
  }
} as const satisfies Record<ThumbnailNode['kind'], { body: Rgba; accent: Rgba; border: Rgba; text: Rgba }>;

export function generateMarketplaceTemplateThumbnailPngBase64(document: ThumbnailTemplateDocument): string {
  return encodeBase64(generateMarketplaceTemplateThumbnailPngBytes(document));
}

export function generateMarketplaceTemplateThumbnailPngBytes(document: ThumbnailTemplateDocument): Uint8Array {
  const pixels = new Uint8Array(PNG_WIDTH * PNG_HEIGHT * 4);
  paintBackground(pixels);
  paintTemplateLayout(pixels, document);
  return encodePngRgba(PNG_WIDTH, PNG_HEIGHT, pixels);
}

function paintBackground(pixels: Uint8Array): void {
  for (let y = 0; y < PNG_HEIGHT; y += 1) {
    const t = y / Math.max(PNG_HEIGHT - 1, 1);
    const color = mixColor([244, 250, 247, 255], [225, 239, 245, 255], t);
    fillRect(pixels, 0, y, PNG_WIDTH, 1, color);
  }
  fillRect(pixels, 36, 34, 568, 292, [255, 255, 255, 210]);
  strokeRect(pixels, 36, 34, 568, 292, [91, 125, 112, 80], 2);
}

function paintTemplateLayout(pixels: Uint8Array, document: ThumbnailTemplateDocument): void {
  const nodes = document.template.nodes;
  if (nodes.length === 0) {
    fillRect(pixels, 92, 148, 456, 64, [40, 96, 117, 120]);
    return;
  }

  const bounds = measureBounds(nodes);
  const layout = resolveLayout(bounds);
  const rects = nodes.map((node) => mapNodeRect(node, bounds, layout));

  for (const edge of document.template.edges) {
    const source = rects[edge.sourceNodeIndex];
    const target = rects[edge.targetNodeIndex];
    if (!source || !target) {
      continue;
    }
    drawLine(
      pixels,
      Math.round(source.x + source.width / 2),
      Math.round(source.y + source.height / 2),
      Math.round(target.x + target.width / 2),
      Math.round(target.y + target.height / 2),
      [52, 90, 103, 130],
      4
    );
  }

  rects.forEach((rect, index) => {
    const node = nodes[index];
    const palette = getNodePalette(node.kind);
    fillRect(pixels, Math.round(rect.x + 4), Math.round(rect.y + 5), Math.round(rect.width), Math.round(rect.height), [38, 72, 82, 28]);
    fillRect(pixels, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height), palette.body);
    fillRect(pixels, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), 10, palette.accent);
    strokeRect(pixels, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height), palette.border, 2);
    paintNodeGlyph(pixels, rect, node.kind, palette.accent);
    paintTextBars(pixels, rect, node.title, palette.text);
  });
}

function measureBounds(nodes: readonly ThumbnailNode[]): { minX: number; minY: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.size.width);
    maxY = Math.max(maxY, node.position.y + node.size.height);
  }
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function resolveLayout(bounds: { width: number; height: number }): { x: number; y: number; width: number; height: number; scale: number } {
  const width = 512;
  const height = 236;
  const scale = Math.min(width / bounds.width, height / bounds.height, 0.42);
  const scaledWidth = bounds.width * scale;
  const scaledHeight = bounds.height * scale;
  return {
    x: 64 + (width - scaledWidth) / 2,
    y: 62 + (height - scaledHeight) / 2,
    width,
    height,
    scale
  };
}

function mapNodeRect(
  node: ThumbnailNode,
  bounds: { minX: number; minY: number },
  layout: { x: number; y: number; scale: number }
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(58, Math.min(150, node.size.width * layout.scale));
  const height = Math.max(42, Math.min(92, node.size.height * layout.scale));
  return {
    x: layout.x + (node.position.x - bounds.minX) * layout.scale,
    y: layout.y + (node.position.y - bounds.minY) * layout.scale,
    width,
    height
  };
}

function getNodePalette(kind: ThumbnailNode['kind']): { body: Rgba; accent: Rgba; border: Rgba; text: Rgba } {
  return MARKETPLACE_TEMPLATE_THUMBNAIL_NODE_PALETTE[kind];
}

function paintNodeGlyph(
  pixels: Uint8Array,
  rect: { x: number; y: number; width: number; height: number },
  kind: ThumbnailNode['kind'],
  color: Rgba
): void {
  const x = Math.round(rect.x + 12);
  const y = Math.round(rect.y + 20);
  if (kind === 'terminal') {
    drawLine(pixels, x, y, x + 10, y + 7, color, 3);
    drawLine(pixels, x, y + 14, x + 10, y + 7, color, 3);
    fillRect(pixels, x + 17, y + 13, 18, 3, color);
    return;
  }
  if (kind === 'agent') {
    fillRect(pixels, x, y, 28, 20, [255, 255, 255, 160]);
    strokeRect(pixels, x, y, 28, 20, color, 2);
    fillRect(pixels, x + 7, y + 7, 4, 4, color);
    fillRect(pixels, x + 18, y + 7, 4, 4, color);
    return;
  }
  fillRect(pixels, x, y, 28, 3, color);
  fillRect(pixels, x, y + 8, 22, 3, color);
  fillRect(pixels, x, y + 16, 26, 3, color);
}

function paintTextBars(
  pixels: Uint8Array,
  rect: { x: number; y: number; width: number; height: number },
  title: string,
  color: Rgba
): void {
  const left = Math.round(rect.x + 52);
  const top = Math.round(rect.y + 24);
  const maxWidth = Math.max(18, Math.round(rect.width - 68));
  const titleWidth = Math.max(24, Math.min(maxWidth, title.trim().length * 6));
  fillRect(pixels, left, top, titleWidth, 4, color);
  fillRect(pixels, left, top + 14, Math.max(18, Math.round(maxWidth * 0.72)), 3, [color[0], color[1], color[2], 110]);
}

function fillRect(pixels: Uint8Array, x: number, y: number, width: number, height: number, color: Rgba): void {
  const left = clampInt(x, 0, PNG_WIDTH);
  const top = clampInt(y, 0, PNG_HEIGHT);
  const right = clampInt(x + width, 0, PNG_WIDTH);
  const bottom = clampInt(y + height, 0, PNG_HEIGHT);
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      blendPixel(pixels, column, row, color);
    }
  }
}

function strokeRect(pixels: Uint8Array, x: number, y: number, width: number, height: number, color: Rgba, strokeWidth: number): void {
  fillRect(pixels, x, y, width, strokeWidth, color);
  fillRect(pixels, x, y + height - strokeWidth, width, strokeWidth, color);
  fillRect(pixels, x, y, strokeWidth, height, color);
  fillRect(pixels, x + width - strokeWidth, y, strokeWidth, height, color);
}

function drawLine(pixels: Uint8Array, x0: number, y0: number, x1: number, y1: number, color: Rgba, width: number): void {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    fillRect(pixels, x - Math.floor(width / 2), y - Math.floor(width / 2), width, width, color);
    if (x === x1 && y === y1) {
      break;
    }
    const nextError = 2 * error;
    if (nextError >= dy) {
      error += dy;
      x += sx;
    }
    if (nextError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function blendPixel(pixels: Uint8Array, x: number, y: number, color: Rgba): void {
  const offset = (y * PNG_WIDTH + x) * 4;
  const alpha = color[3] / 255;
  const inverseAlpha = 1 - alpha;
  pixels[offset] = Math.round(color[0] * alpha + pixels[offset] * inverseAlpha);
  pixels[offset + 1] = Math.round(color[1] * alpha + pixels[offset + 1] * inverseAlpha);
  pixels[offset + 2] = Math.round(color[2] * alpha + pixels[offset + 2] * inverseAlpha);
  pixels[offset + 3] = 255;
}

function mixColor(left: Rgba, right: Rgba, t: number): Rgba {
  return [
    Math.round(left[0] * (1 - t) + right[0] * t),
    Math.round(left[1] * (1 - t) + right[1] * t),
    Math.round(left[2] * (1 - t) + right[2] * t),
    Math.round(left[3] * (1 - t) + right[3] * t)
  ];
}

function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const scanlines = new Uint8Array((width * 4 + 1) * height);
  let targetOffset = 0;
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    scanlines[targetOffset] = 0;
    targetOffset += 1;
    scanlines.set(rgba.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
    sourceOffset += width * 4;
    targetOffset += width * 4;
  }

  const idat = zlibStore(scanlines);
  return concatBytes([
    new Uint8Array(PNG_SIGNATURE),
    pngChunk('IHDR', buildIhdr(width, height)),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array())
  ]);
}

function buildIhdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return chunk;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  while (offset < data.length) {
    const blockLength = Math.min(65_535, data.length - offset);
    const isFinal = offset + blockLength >= data.length;
    const header = new Uint8Array(5);
    header[0] = isFinal ? 0x01 : 0x00;
    header[1] = blockLength & 0xff;
    header[2] = (blockLength >> 8) & 0xff;
    const inverse = (~blockLength) & 0xffff;
    header[3] = inverse & 0xff;
    header[4] = (inverse >> 8) & 0xff;
    blocks.push(header, data.subarray(offset, offset + blockLength));
    offset += blockLength;
  }
  const checksum = new Uint8Array(4);
  writeUint32(checksum, 0, adler32(data));
  blocks.push(checksum);
  return concatBytes(blocks);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
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

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const left = bytes[index];
    const middle = bytes[index + 1];
    const right = bytes[index + 2];
    output += alphabet[left >> 2];
    output += alphabet[((left & 0x03) << 4) | ((middle ?? 0) >> 4)];
    output += middle === undefined ? '=' : alphabet[((middle & 0x0f) << 2) | ((right ?? 0) >> 6)];
    output += right === undefined ? '=' : alphabet[right & 0x3f];
  }
  return output;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
