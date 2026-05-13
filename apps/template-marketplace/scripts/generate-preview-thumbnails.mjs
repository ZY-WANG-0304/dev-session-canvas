import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const appRootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const thumbnailWidth = 640;
const thumbnailHeight = 360;

if (!existsSync(resolve(appRootDir, 'fixtures/r2'))) {
  throw new Error('Expected fixture directory to exist before generating thumbnails.');
}

const thumbnails = [
  {
    templateFile: 'fixtures/r2/templates/tmpl-getting-started/versions/1/template.json',
    outputFile: 'fixtures/r2/templates/tmpl-getting-started/versions/1/thumbnail.png',
    palette: {
      start: [40, 71, 59],
      end: [211, 187, 140],
      card: [255, 248, 232],
      accent: [230, 121, 76]
    }
  },
  {
    templateFile: 'fixtures/r2/templates/tmpl-review-loop/versions/1/template.json',
    outputFile: 'fixtures/r2/templates/tmpl-review-loop/versions/1/thumbnail.png',
    palette: {
      start: [47, 58, 87],
      end: [166, 125, 93],
      card: [246, 242, 230],
      accent: [118, 156, 117]
    }
  },
  {
    templateFile: 'fixtures/r2/templates/tmpl-review-loop/versions/2/template.json',
    outputFile: 'fixtures/r2/templates/tmpl-review-loop/versions/2/thumbnail.png',
    palette: {
      start: [36, 77, 65],
      end: [219, 176, 112],
      card: [255, 248, 232],
      accent: [226, 108, 72]
    }
  },
  {
    templateFile: 'fixtures/r2/templates/tmpl-release-readiness/versions/1/template.json',
    outputFile: 'fixtures/r2/templates/tmpl-release-readiness/versions/1/thumbnail.png',
    palette: {
      start: [53, 72, 80],
      end: [199, 154, 100],
      card: [248, 244, 231],
      accent: [215, 87, 72]
    }
  }
];

for (const thumbnail of thumbnails) {
  const templateDocument = JSON.parse(readFileSync(resolve(appRootDir, thumbnail.templateFile), 'utf8')).template;
  const buffer = renderThumbnail(templateDocument, thumbnail.palette);
  const outputFile = resolve(appRootDir, thumbnail.outputFile);
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, buffer);
  const digest = createHash('sha256').update(buffer).digest('hex');
  console.log(`${thumbnail.outputFile} ${buffer.byteLength} ${digest}`);
}

function renderThumbnail(templateDocument, palette) {
  const pixels = Buffer.alloc(thumbnailWidth * thumbnailHeight * 3);
  paintBackground(pixels, palette);
  const nodes = Array.isArray(templateDocument.nodes) ? templateDocument.nodes : [];
  const edges = Array.isArray(templateDocument.edges) ? templateDocument.edges : [];
  const transform = createViewportTransform(nodes);

  for (const edge of edges) {
    const source = nodes[edge.sourceNodeIndex];
    const target = nodes[edge.targetNodeIndex];
    if (!source || !target) {
      continue;
    }
    const sourceBox = transformNode(source, transform);
    const targetBox = transformNode(target, transform);
    drawLine(
      pixels,
      Math.round(sourceBox.x + sourceBox.width / 2),
      Math.round(sourceBox.y + sourceBox.height / 2),
      Math.round(targetBox.x + targetBox.width / 2),
      Math.round(targetBox.y + targetBox.height / 2),
      [255, 255, 255],
      4,
      0.42
    );
  }

  for (const [index, node] of nodes.entries()) {
    const box = transformNode(node, transform);
    const nodeColor = mixColor(palette.card, palette.accent, index / Math.max(1, nodes.length + 1) * 0.32);
    drawShadow(pixels, box.x, box.y, box.width, box.height);
    drawRoundedRect(pixels, box.x, box.y, box.width, box.height, 18, nodeColor, 0.95);
    drawRoundedRectStroke(pixels, box.x, box.y, box.width, box.height, 18, [255, 255, 255], 0.58, 3);
    drawKindStripe(pixels, box.x, box.y, box.width, node.kind, palette.accent);
  }

  return encodePng(pixels, thumbnailWidth, thumbnailHeight);
}

function paintBackground(pixels, palette) {
  for (let y = 0; y < thumbnailHeight; y += 1) {
    for (let x = 0; x < thumbnailWidth; x += 1) {
      const baseMix = (x / thumbnailWidth) * 0.62 + (y / thumbnailHeight) * 0.38;
      const radial = Math.max(0, 1 - Math.hypot(x - 120, y - 72) / 260);
      const color = mixColor(mixColor(palette.start, palette.end, baseMix), [255, 244, 213], radial * 0.28);
      setPixel(pixels, x, y, color, 1);
    }
  }
}

function createViewportTransform(nodes) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, scale: 1, offsetX: 48, offsetY: 54 };
  }

  const bounds = nodes.reduce(
    (current, node) => {
      const position = node.position || {};
      const size = node.size || {};
      const x = Number(position.x) || 0;
      const y = Number(position.y) || 0;
      const width = Number(size.width) || 320;
      const height = Number(size.height) || 180;
      return {
        minX: Math.min(current.minX, x),
        minY: Math.min(current.minY, y),
        maxX: Math.max(current.maxX, x + width),
        maxY: Math.max(current.maxY, y + height)
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  const marginX = 54;
  const marginY = 46;
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((thumbnailWidth - marginX * 2) / sourceWidth, (thumbnailHeight - marginY * 2) / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    scale,
    offsetX: (thumbnailWidth - renderedWidth) / 2,
    offsetY: (thumbnailHeight - renderedHeight) / 2
  };
}

function transformNode(node, transform) {
  const position = node.position || {};
  const size = node.size || {};
  const x = Number(position.x) || 0;
  const y = Number(position.y) || 0;
  const width = Number(size.width) || 320;
  const height = Number(size.height) || 180;
  return {
    x: Math.round((x - transform.minX) * transform.scale + transform.offsetX),
    y: Math.round((y - transform.minY) * transform.scale + transform.offsetY),
    width: Math.max(28, Math.round(width * transform.scale)),
    height: Math.max(20, Math.round(height * transform.scale))
  };
}

function drawShadow(pixels, x, y, width, height) {
  drawRoundedRect(pixels, x + 7, y + 9, width, height, 18, [0, 0, 0], 0.16);
}

function drawKindStripe(pixels, x, y, width, kind, accent) {
  const stripeColor = kind === 'terminal' ? [42, 46, 55] : kind === 'agent' ? accent : [85, 121, 104];
  drawRoundedRect(pixels, x + 12, y + 12, Math.max(22, width * 0.28), 7, 5, stripeColor, 0.9);
}

function drawRoundedRect(pixels, x, y, width, height, radius, color, alpha) {
  const startX = Math.max(0, Math.floor(x));
  const endX = Math.min(thumbnailWidth, Math.ceil(x + width));
  const startY = Math.max(0, Math.floor(y));
  const endY = Math.min(thumbnailHeight, Math.ceil(y + height));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      if (isInsideRoundedRect(px + 0.5, py + 0.5, x, y, width, height, radius)) {
        setPixel(pixels, px, py, color, alpha);
      }
    }
  }
}

function drawRoundedRectStroke(pixels, x, y, width, height, radius, color, alpha, thickness) {
  for (let offset = 0; offset < thickness; offset += 1) {
    const currentX = x + offset;
    const currentY = y + offset;
    const currentWidth = width - offset * 2;
    const currentHeight = height - offset * 2;
    for (let px = Math.floor(currentX); px <= Math.ceil(currentX + currentWidth); px += 1) {
      setIfInsideStroke(pixels, px, Math.round(currentY), currentX, currentY, currentWidth, currentHeight, radius, color, alpha);
      setIfInsideStroke(pixels, px, Math.round(currentY + currentHeight), currentX, currentY, currentWidth, currentHeight, radius, color, alpha);
    }
    for (let py = Math.floor(currentY); py <= Math.ceil(currentY + currentHeight); py += 1) {
      setIfInsideStroke(pixels, Math.round(currentX), py, currentX, currentY, currentWidth, currentHeight, radius, color, alpha);
      setIfInsideStroke(pixels, Math.round(currentX + currentWidth), py, currentX, currentY, currentWidth, currentHeight, radius, color, alpha);
    }
  }
}

function setIfInsideStroke(pixels, px, py, x, y, width, height, radius, color, alpha) {
  if (px < 0 || px >= thumbnailWidth || py < 0 || py >= thumbnailHeight) {
    return;
  }
  if (isInsideRoundedRect(px + 0.5, py + 0.5, x, y, width, height, radius)) {
    setPixel(pixels, px, py, color, alpha);
  }
}

function isInsideRoundedRect(px, py, x, y, width, height, radius) {
  const innerLeft = x + radius;
  const innerRight = x + width - radius;
  const innerTop = y + radius;
  const innerBottom = y + height - radius;
  if ((px >= innerLeft && px <= innerRight && py >= y && py <= y + height) || (py >= innerTop && py <= innerBottom && px >= x && px <= x + width)) {
    return true;
  }
  const cornerX = px < innerLeft ? innerLeft : innerRight;
  const cornerY = py < innerTop ? innerTop : innerBottom;
  return Math.hypot(px - cornerX, py - cornerY) <= radius;
}

function drawLine(pixels, x0, y0, x1, y1, color, thickness, alpha) {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    for (let oy = -thickness; oy <= thickness; oy += 1) {
      for (let ox = -thickness; ox <= thickness; ox += 1) {
        if (ox * ox + oy * oy <= thickness * thickness) {
          setPixel(pixels, x + ox, y + oy, color, alpha);
        }
      }
    }
    if (x === x1 && y === y1) {
      break;
    }
    const doubledError = error * 2;
    if (doubledError >= dy) {
      error += dy;
      x += sx;
    }
    if (doubledError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function setPixel(pixels, x, y, color, alpha) {
  if (x < 0 || x >= thumbnailWidth || y < 0 || y >= thumbnailHeight) {
    return;
  }
  const offset = (y * thumbnailWidth + x) * 3;
  pixels[offset] = Math.round(pixels[offset] * (1 - alpha) + color[0] * alpha);
  pixels[offset + 1] = Math.round(pixels[offset + 1] * (1 - alpha) + color[1] * alpha);
  pixels[offset + 2] = Math.round(pixels[offset + 2] * (1 - alpha) + color[2] * alpha);
}

function mixColor(left, right, ratio) {
  return [
    Math.round(left[0] + (right[0] - left[0]) * ratio),
    Math.round(left[1] + (right[1] - left[1]) * ratio),
    Math.round(left[2] + (right[2] - left[2]) * ratio)
  ];
}

function encodePng(rgbPixels, width, height) {
  const rowLength = width * 3 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
    rgbPixels.copy(raw, y * rowLength + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createChunk('IHDR', Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 2, 0, 0, 0])])),
    createChunk('IDAT', deflateSync(raw, { level: 9 })),
    createChunk('IEND', Buffer.alloc(0))
  ]);
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
