import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const scale = 100;
const canvasSize = 24 * scale;
const badgeCenter = { x: 18.75, y: 5.25 };
const scanRadius = 4.7;
const defaultTargetContentRadius = 3.85;
const radiusTolerance = 0.08;
const whiteThreshold = 245;
const defaultContentGuide = 'Badge content guide: center 18.75,5.25; outer radius 3.85.';

const badgeIcons = [
  {
    label: 'templates',
    path: 'images/dev-session-canvas-templates-activitybar.svg'
  },
  {
    label: 'nodes',
    path: 'images/dev-session-canvas-nodes-activitybar.svg'
  },
  {
    label: 'sessions',
    path: 'images/dev-session-canvas-sessions-activitybar.svg'
  },
  {
    label: 'notifier-draft',
    path: 'images/dev-session-canvas-notifier-activitybar.svg'
  },
  {
    label: 'notifier-companion',
    path: 'extensions/vscode/dev-session-canvas-notifier/images/activitybar.svg'
  }
];

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: canvasSize, height: canvasSize },
    deviceScaleFactor: 1
  });

  for (const icon of badgeIcons) {
    const svg = await readFile(icon.path, 'utf8');
    assertBadgeContract(svg, icon.path, icon.contentGuide ?? defaultContentGuide);
    if (icon.label === 'nodes') {
      assertNodesBadgeUsesSingleWindow(svg, icon.path);
    }
    if (icon.label === 'sessions') {
      assertSessionsBadgeUsesHistoryClockHands(svg, icon.path);
    }
    const metrics = await measureBadgeCutout(page, svg);
    const targetContentRadius = icon.targetContentRadius ?? defaultTargetContentRadius;
    const radiusDelta = metrics.maxRadius - targetContentRadius;

    assert.ok(
      Math.abs(radiusDelta) <= radiusTolerance,
      `${icon.path} badge cutout max radius ${metrics.maxRadius.toFixed(2)} should stay within ${radiusTolerance} of ${targetContentRadius}.`
    );

    console.log(
      `${icon.label}: badge cutout max radius ${metrics.maxRadius.toFixed(2)} ` +
        `(target ${targetContentRadius.toFixed(2)}, delta ${radiusDelta >= 0 ? '+' : ''}${radiusDelta.toFixed(2)})`
    );
  }

  console.log('activitybar badge geometry tests passed');
} finally {
  await browser.close();
}

function assertBadgeContract(svg, filePath, contentGuide) {
  const expectedSnippets = [
    contentGuide,
    'cx="18.75" cy="5.25" r="6.35"',
    'cx="18.75" cy="5.25" r="4.85"',
    'currentColor',
    'badge-clearance',
    'badge-cutout'
  ];

  for (const snippet of expectedSnippets) {
    assert.ok(svg.includes(snippet), `${filePath} must include ${snippet}`);
  }
}

function assertSessionsBadgeUsesHistoryClockHands(svg, filePath) {
  const cutoutMask = extractBetween(svg, '<mask id="sessions-badge-cutout">', '</mask>');
  assert.ok(
    cutoutMask.includes('d="M18.75 2.15V5.25H21.65"'),
    `${filePath} badge cutout should keep only the clock-hand portion of the history glyph.`
  );
  assert.ok(
    cutoutMask.includes('stroke-width="1.55"'),
    `${filePath} badge clock hands should use a heavier stroke for 24px readability.`
  );
  assert.ok(
    !cutoutMask.includes('M7.99909 3C10.7605'),
    `${filePath} badge cutout should not include the full history clock outline.`
  );
}

function assertNodesBadgeUsesSingleWindow(svg, filePath) {
  const cutoutMask = extractBetween(svg, '<mask id="nodes-badge-cutout">', '</mask>');
  const rects = [
    ...cutoutMask.matchAll(
      /<rect\s+x="([^"]+)"\s+y="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"\s+rx="([^"]+)"\s+stroke="black"\s+stroke-width="([^"]+)"/g
    )
  ];
  const paths = [
    ...cutoutMask.matchAll(/<path\s+d="([^"]+)"\s+stroke="black"\s+stroke-width="([^"]+)"/g)
  ];
  assert.equal(rects.length, 1, `${filePath} badge cutout should contain exactly one window frame.`);
  assert.equal(paths.length, 1, `${filePath} badge cutout should contain exactly one stroked window header line.`);
  assert.ok(!cutoutMask.includes('<circle'), `${filePath} badge cutout should not contain dot circles.`);
  assert.ok(!cutoutMask.includes('fill="black"'), `${filePath} badge cutout should not contain a filled title bar.`);

  const expectedRects = [
    { x: '16.25', y: '3.25', width: '5.1', height: '4.05', rx: '0.25', strokeWidth: '1.2' }
  ];
  const expectedPaths = [{ d: 'M16.65 4.65H20.85', strokeWidth: '0.75' }];

  for (const [index, rect] of rects.entries()) {
    const [, x, y, width, height, rx, strokeWidth] = rect;
    assert.deepEqual(
      { x, y, width, height, rx, strokeWidth },
      expectedRects[index],
      `${filePath} badge window frame ${index + 1} should match the single-window layout.`
    );
  }

  for (const [index, path] of paths.entries()) {
    const [, d, strokeWidth] = path;
    assert.deepEqual(
      { d, strokeWidth },
      expectedPaths[index],
      `${filePath} badge window header ${index + 1} should match the single-window layout.`
    );
  }
}

function extractBetween(value, start, end) {
  const startIndex = value.indexOf(start);
  assert.notEqual(startIndex, -1, `Expected to find ${start}`);
  const contentStart = startIndex + start.length;
  const endIndex = value.indexOf(end, contentStart);
  assert.notEqual(endIndex, -1, `Expected to find ${end}`);
  return value.slice(contentStart, endIndex);
}

async function measureBadgeCutout(page, svg) {
  const renderSvg = svg.replace('<svg ', '<svg color="black" ');
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(renderSvg).toString('base64')}`;

  return page.evaluate(
    async ({ dataUrl, scale, canvasSize, badgeCenter, scanRadius, whiteThreshold }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();

      const canvas = document.createElement('canvas');
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Unable to create badge measurement canvas context.');
      }

      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvasSize, canvasSize);
      context.drawImage(image, 0, 0, canvasSize, canvasSize);

      const { data } = context.getImageData(0, 0, canvasSize, canvasSize);
      const centerX = badgeCenter.x * scale;
      const centerY = badgeCenter.y * scale;
      const scanRadiusPx = scanRadius * scale;
      const minX = Math.max(0, Math.floor(centerX - scanRadiusPx));
      const maxX = Math.min(canvasSize - 1, Math.ceil(centerX + scanRadiusPx));
      const minY = Math.max(0, Math.floor(centerY - scanRadiusPx));
      const maxY = Math.min(canvasSize - 1, Math.ceil(centerY + scanRadiusPx));
      let maxRadius = 0;
      let cutoutPixelCount = 0;

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x + 0.5 - centerX;
          const dy = y + 0.5 - centerY;
          if (dx * dx + dy * dy > scanRadiusPx * scanRadiusPx) {
            continue;
          }

          const offset = (y * canvasSize + x) * 4;
          const red = data[offset];
          const green = data[offset + 1];
          const blue = data[offset + 2];
          if (red > whiteThreshold && green > whiteThreshold && blue > whiteThreshold) {
            cutoutPixelCount += 1;
            maxRadius = Math.max(maxRadius, Math.hypot(dx / scale, dy / scale));
          }
        }
      }

      if (cutoutPixelCount === 0) {
        throw new Error('No badge cutout pixels found.');
      }

      return { maxRadius, cutoutPixelCount };
    },
    { dataUrl, scale, canvasSize, badgeCenter, scanRadius, whiteThreshold }
  );
}
