import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const scale = 100;
const canvasSize = 24 * scale;
const badgeCenter = { x: 18.75, y: 5.25 };
const scanRadius = 4.7;
const targetContentRadius = 3.85;
const radiusTolerance = 0.08;
const whiteThreshold = 245;

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
    assertBadgeContract(svg, icon.path);
    const metrics = await measureBadgeCutout(page, svg);
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

function assertBadgeContract(svg, filePath) {
  const expectedSnippets = [
    'Badge content guide: center 18.75,5.25; outer radius 3.85.',
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
