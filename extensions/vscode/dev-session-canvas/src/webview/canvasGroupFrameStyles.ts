import type { CSSProperties } from 'react';

import type { CanvasGroupSummary } from '../common/protocol';

type CanvasGroupRole = CanvasGroupSummary['role'];

const CANVAS_GROUP_TITLE_BASE_HEIGHT = 28;
export const CANVAS_GROUP_BODY_TOP_OFFSET = CANVAS_GROUP_TITLE_BASE_HEIGHT;
const CANVAS_GROUP_TITLE_BASE_FONT_SIZE = 12;
const CANVAS_GROUP_TITLE_BASE_MIN_WIDTH = 112;
const CANVAS_GROUP_TITLE_HORIZONTAL_PADDING = 32;
const CANVAS_GROUP_TITLE_TEXT_WIDTH_PER_CHAR = 7;
const CANVAS_GROUP_ACTION_PRIMARY_WIDTH = 76;
const CANVAS_GROUP_ACTION_DANGER_WIDTH = 62;
const CANVAS_GROUP_SELECTED_TITLE_ACTION_GAP = 0;
const CANVAS_ROOT_WATERMARK_BASE_MIN_TILE_WIDTH = 160;
const CANVAS_ROOT_WATERMARK_BASE_MAX_TILE_WIDTH = 360;
const CANVAS_ROOT_WATERMARK_BASE_TILE_HEIGHT = 88;
const CANVAS_ROOT_WATERMARK_BASE_HORIZONTAL_PADDING = 84;
const CANVAS_ROOT_WATERMARK_BASE_TEXT_INSET = 22;
const CANVAS_ROOT_WATERMARK_BASE_LINE_HEIGHT = 18;
const CANVAS_ROOT_WATERMARK_BASE_VERTICAL_PADDING = 50;
const CANVAS_ROOT_WATERMARK_BASE_TILE_GAP_X = 52;
const CANVAS_ROOT_WATERMARK_BASE_TILE_GAP_Y = 24;
const CANVAS_ROOT_WATERMARK_MAX_LINES = 2;

export function isWorkspaceRootCanvasGroupRole(role: CanvasGroupRole | undefined): boolean {
  return role === 'workspace-root';
}

function cssPixelForCanvasZoom(value: number, zoom: number): string {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return `${value / safeZoom}px`;
}

function groupReadableChromeScaleForZoom(zoom: number, maxScale: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const targetScale = safeZoom < 1 ? 1 / safeZoom : 1;
  return Math.min(targetScale, Math.max(0, maxScale));
}

function createCanvasGroupChromeStyle(zoom: number, readableScale: number): CSSProperties {
  return {
    '--canvas-group-border-width': cssPixelForCanvasZoom(1, zoom),
    '--canvas-group-readable-scale': String(readableScale),
    '--canvas-group-title-height': `${CANVAS_GROUP_TITLE_BASE_HEIGHT * readableScale}px`,
    '--canvas-group-body-top': `${CANVAS_GROUP_BODY_TOP_OFFSET}px`,
    '--canvas-group-title-font-size': `${CANVAS_GROUP_TITLE_BASE_FONT_SIZE * readableScale}px`,
    '--canvas-group-title-padding-left': `${12 * readableScale}px`,
    '--canvas-group-title-padding-right': `${10 * readableScale}px`,
    '--canvas-group-toolbar-button-padding-x': `${8 * readableScale}px`,
    '--canvas-group-toolbar-font-size': `${11 * readableScale}px`,
    '--canvas-group-resize-line-width': cssPixelForCanvasZoom(2, zoom),
    '--canvas-group-resize-control-size': cssPixelForCanvasZoom(16, zoom),
    '--canvas-group-resize-edge-inset': cssPixelForCanvasZoom(12, zoom),
    '--canvas-group-resize-edge-thickness': cssPixelForCanvasZoom(12, zoom),
    '--canvas-group-resize-dot-size': cssPixelForCanvasZoom(12, zoom),
    '--canvas-group-resize-dot-border-width': cssPixelForCanvasZoom(2, zoom),
    '--canvas-group-resize-dot-shadow-y': cssPixelForCanvasZoom(2, zoom),
    '--canvas-group-resize-dot-shadow-blur': cssPixelForCanvasZoom(12, zoom)
  } as CSSProperties;
}

export function createCanvasGroupFrameStyle(
  group: Pick<CanvasGroupSummary, 'position' | 'size' | 'title' | 'role'>,
  zoom: number,
  selected = false,
  workspaceRootWatermarksEnabled = true
): CSSProperties {
  const isWorkspaceRootGroup = isWorkspaceRootCanvasGroupRole(group.role);
  const titleBaseWidth = Math.max(
    CANVAS_GROUP_TITLE_BASE_MIN_WIDTH,
    group.title.length * CANVAS_GROUP_TITLE_TEXT_WIDTH_PER_CHAR + CANVAS_GROUP_TITLE_HORIZONTAL_PADDING
  );
  const toolbarScaleBaseWidth = selected
    ? CANVAS_GROUP_ACTION_PRIMARY_WIDTH + CANVAS_GROUP_ACTION_DANGER_WIDTH
    : 0;
  const toolbarRenderBaseWidth = selected && !isWorkspaceRootGroup ? toolbarScaleBaseWidth : 0;
  const toolbarGap = toolbarRenderBaseWidth > 0 ? CANVAS_GROUP_SELECTED_TITLE_ACTION_GAP : 0;
  const widthBase = Math.max(
    1,
    titleBaseWidth + toolbarScaleBaseWidth + (toolbarScaleBaseWidth > 0 ? CANVAS_GROUP_SELECTED_TITLE_ACTION_GAP : 0)
  );
  const readableScale = groupReadableChromeScaleForZoom(zoom, group.size.width / widthBase);
  const desiredTitleTabWidth = titleBaseWidth * readableScale;
  const desiredToolbarWidth = toolbarRenderBaseWidth * readableScale;
  const titleTabWidth = Math.min(desiredTitleTabWidth, group.size.width);
  const bodyAlignedTitleTabWidth = `min(${titleTabWidth}px, 100%)`;
  const availableToolbarWidth = Math.max(0, group.size.width - titleTabWidth - toolbarGap);
  const toolbarWidth = selected && toolbarRenderBaseWidth > 0 && availableToolbarWidth >= 1
    ? Math.max(1, Math.min(desiredToolbarWidth, availableToolbarWidth))
    : 0;
  const watermarkReadableScale = isWorkspaceRootGroup && workspaceRootWatermarksEnabled
    ? groupReadableChromeScaleForZoom(zoom, Number.POSITIVE_INFINITY)
    : readableScale;
  const watermarkFontSize = CANVAS_GROUP_TITLE_BASE_FONT_SIZE * watermarkReadableScale;
  const rootWatermarkPattern = isWorkspaceRootGroup && workspaceRootWatermarksEnabled
    ? createCanvasRootWatermarkPattern(group.title, watermarkFontSize, watermarkReadableScale)
    : undefined;
  return {
    ...createCanvasGroupChromeStyle(zoom, readableScale),
    '--canvas-group-title-tab-width': bodyAlignedTitleTabWidth,
    '--canvas-group-toolbar-width': `${toolbarWidth}px`,
    ...(rootWatermarkPattern
      ? {
          '--canvas-root-watermark-pattern': rootWatermarkPattern.pattern,
          '--canvas-root-watermark-tile-width': `${rootWatermarkPattern.tileWidth}px`,
          '--canvas-root-watermark-tile-height': `${rootWatermarkPattern.tileHeight}px`,
          '--canvas-root-watermark-font-size': `${watermarkFontSize}px`,
          '--canvas-root-watermark-readable-scale': String(watermarkReadableScale)
        }
      : {}),
    left: group.position.x,
    top: group.position.y,
    width: group.size.width,
    height: group.size.height
  } as CSSProperties;
}

function createCanvasRootWatermarkPattern(
  title: string,
  fontSize: number,
  readableScale: number
): { pattern: string; tileWidth: number; tileHeight: number } {
  const label = resolveCanvasRootWatermarkVisualLabel(title);
  const safeReadableScale = Number.isFinite(readableScale) && readableScale > 0 ? readableScale : 1;
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : CANVAS_GROUP_TITLE_BASE_FONT_SIZE * safeReadableScale;
  const lines = wrapCanvasRootWatermarkLabel(label);
  const longestLineBaseWidth = Math.max(...lines.map((line) => estimateCanvasRootWatermarkTextWidth(line)));
  const baseTextTileWidth = Math.max(
    CANVAS_ROOT_WATERMARK_BASE_MIN_TILE_WIDTH,
    Math.min(
      CANVAS_ROOT_WATERMARK_BASE_MAX_TILE_WIDTH,
      longestLineBaseWidth + CANVAS_ROOT_WATERMARK_BASE_HORIZONTAL_PADDING
    )
  );
  const baseTextTileHeight = Math.max(
    CANVAS_ROOT_WATERMARK_BASE_TILE_HEIGHT,
    CANVAS_ROOT_WATERMARK_BASE_VERTICAL_PADDING + lines.length * CANVAS_ROOT_WATERMARK_BASE_LINE_HEIGHT
  );
  const tileWidth = Math.round((baseTextTileWidth + CANVAS_ROOT_WATERMARK_BASE_TILE_GAP_X) * safeReadableScale);
  const tileHeight = Math.round((baseTextTileHeight + CANVAS_ROOT_WATERMARK_BASE_TILE_GAP_Y) * safeReadableScale);
  const textX = Math.round(tileWidth / 2);
  const lineHeight = CANVAS_ROOT_WATERMARK_BASE_LINE_HEIGHT * safeReadableScale;
  const firstTextY = tileHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
  const textLength = Math.max(
    84 * safeReadableScale,
    (baseTextTileWidth - CANVAS_ROOT_WATERMARK_BASE_TEXT_INSET * 2) * safeReadableScale
  );
  const letterSpacing = 0.6 * safeReadableScale;
  const textElements = lines.map((line, index) => {
    const textY = firstTextY + index * lineHeight;
    return `<text x="${textX}" y="${formatSvgNumber(textY)}" text-anchor="middle" dominant-baseline="middle" fill="black" font-family="sans-serif" font-size="${formatSvgNumber(safeFontSize)}" font-weight="600" letter-spacing="${formatSvgNumber(letterSpacing)}" textLength="${formatSvgNumber(textLength)}" lengthAdjust="spacingAndGlyphs">${escapeSvgText(line)}</text>`;
  });
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}" viewBox="0 0 ${tileWidth} ${tileHeight}">`,
    ...textElements,
    '</svg>'
  ].join('');
  return {
    pattern: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    tileWidth,
    tileHeight
  };
}

function resolveCanvasRootWatermarkVisualLabel(title: string): string {
  let label = title.trim() || 'Root';
  const separatedPathLabel = label.match(/^(.*?)\s+-\s+(.+)$/u);
  if (separatedPathLabel && isCanvasRootWatermarkPathLikeLabel(separatedPathLabel[2])) {
    label = separatedPathLabel[1].trim() || separatedPathLabel[2].trim();
  }

  label = label.replace(/^\.[\\/]+/u, '').trim();
  if (isCanvasRootWatermarkPathLikeLabel(label)) {
    label = basenameForCanvasRootWatermarkLabel(label) || label;
  }

  return label || 'Root';
}

function isCanvasRootWatermarkPathLikeLabel(value: string): boolean {
  return /[\\/]/u.test(value) || /^[A-Za-z]:[\\/]/u.test(value) || /^~[\\/]/u.test(value);
}

function basenameForCanvasRootWatermarkLabel(value: string): string | undefined {
  const normalized = value.trim().replace(/[\\/]+$/u, '');
  const segments = normalized.split(/[\\/]+/u).filter(Boolean);
  return segments.at(-1);
}

function wrapCanvasRootWatermarkLabel(label: string): string[] {
  const normalizedLabel = label.replace(/\s+/gu, ' ').trim() || 'Root';
  const maxLineWidth =
    CANVAS_ROOT_WATERMARK_BASE_MAX_TILE_WIDTH - CANVAS_ROOT_WATERMARK_BASE_TEXT_INSET * 2;
  const chunks = splitCanvasRootWatermarkLabelIntoChunks(normalizedLabel);
  const lines: string[] = [];
  let currentLine = '';

  chunks.forEach((chunk) => {
    const nextLine = currentLine ? `${currentLine}${chunk}` : chunk.trimStart();
    if (currentLine && estimateCanvasRootWatermarkTextWidth(nextLine) > maxLineWidth) {
      lines.push(currentLine.trim());
      currentLine = chunk.trimStart();
      return;
    }

    currentLine = nextLine;
  });

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  if (lines.length <= CANVAS_ROOT_WATERMARK_MAX_LINES) {
    return lines.length > 0 ? lines : ['Root'];
  }

  const clampedLines = lines.slice(0, CANVAS_ROOT_WATERMARK_MAX_LINES);
  const overflowText = lines.slice(CANVAS_ROOT_WATERMARK_MAX_LINES - 1).join(' ');
  clampedLines[CANVAS_ROOT_WATERMARK_MAX_LINES - 1] =
    truncateCanvasRootWatermarkLine(overflowText, maxLineWidth);
  return clampedLines;
}

function splitCanvasRootWatermarkLabelIntoChunks(label: string): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const char of label) {
    currentChunk += char;
    if (/[\s._/-]/u.test(char) || isCanvasRootWatermarkCjkCharacter(char)) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  const maxLineWidth =
    CANVAS_ROOT_WATERMARK_BASE_MAX_TILE_WIDTH - CANVAS_ROOT_WATERMARK_BASE_TEXT_INSET * 2;
  return chunks.flatMap((chunk) => breakCanvasRootWatermarkLongChunk(chunk, maxLineWidth));
}

function breakCanvasRootWatermarkLongChunk(chunk: string, maxLineWidth: number): string[] {
  if (estimateCanvasRootWatermarkTextWidth(chunk) <= maxLineWidth) {
    return [chunk];
  }

  const parts: string[] = [];
  let currentPart = '';
  for (const char of chunk) {
    const nextPart = `${currentPart}${char}`;
    if (currentPart && estimateCanvasRootWatermarkTextWidth(nextPart) > maxLineWidth) {
      parts.push(currentPart);
      currentPart = char;
    } else {
      currentPart = nextPart;
    }
  }

  if (currentPart) {
    parts.push(currentPart);
  }

  return parts;
}

function estimateCanvasRootWatermarkTextWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    if (char === ' ') {
      width += 4;
    } else if (/[._/-]/u.test(char)) {
      width += 5;
    } else if (isCanvasRootWatermarkCjkCharacter(char)) {
      width += 12;
    } else if (/[A-ZMW@#%&]/u.test(char)) {
      width += 8;
    } else if (/[ilI1|]/u.test(char)) {
      width += 4;
    } else {
      width += CANVAS_GROUP_TITLE_TEXT_WIDTH_PER_CHAR;
    }
  }

  return width;
}

function truncateCanvasRootWatermarkLine(value: string, maxLineWidth: number): string {
  const ellipsis = '...';
  const normalized = value.trim();
  if (estimateCanvasRootWatermarkTextWidth(normalized) <= maxLineWidth) {
    return normalized;
  }

  const ellipsisWidth = estimateCanvasRootWatermarkTextWidth(ellipsis);
  let truncated = '';
  for (const char of normalized) {
    const nextValue = `${truncated}${char}`;
    if (estimateCanvasRootWatermarkTextWidth(nextValue) + ellipsisWidth > maxLineWidth) {
      break;
    }
    truncated = nextValue;
  }

  return `${truncated.trimEnd()}${ellipsis}`;
}

function isCanvasRootWatermarkCjkCharacter(char: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
}

function formatSvgNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/u, '');
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}
