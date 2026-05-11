import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const avatarPath = 'extensions/vscode/dev-session-canvas-notifier/images/avatar.png';
const avatarSize = 512;
const safeCircleRadius = 244;
const minUsefulRadius = 232;
const alphaThreshold = 8;

const avatar = await readFile(avatarPath);
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: avatarSize, height: avatarSize },
    deviceScaleFactor: 1
  });
  const metrics = await measureAvatar(page, avatar);

  assert.equal(metrics.width, avatarSize, `${avatarPath} must be ${avatarSize}px wide.`);
  assert.equal(metrics.height, avatarSize, `${avatarPath} must be ${avatarSize}px high.`);
  assert.ok(metrics.opaquePixelCount > 0, `${avatarPath} must contain visible icon pixels.`);
  assert.ok(
    metrics.maxRadius <= safeCircleRadius,
    `${avatarPath} visible pixels must fit inside circular avatar safe radius ${safeCircleRadius}; got ${metrics.maxRadius.toFixed(2)}.`
  );
  assert.ok(
    metrics.maxRadius >= minUsefulRadius,
    `${avatarPath} visible pixels should use the circular avatar area; got ${metrics.maxRadius.toFixed(2)}.`
  );

  console.log(
    `notifier avatar safe-area test passed: max radius ${metrics.maxRadius.toFixed(2)} / ${safeCircleRadius}`
  );
} finally {
  await browser.close();
}

async function measureAvatar(page, avatar) {
  const dataUrl = `data:image/png;base64,${avatar.toString('base64')}`;

  return page.evaluate(
    async ({ dataUrl, alphaThreshold }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();

      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Unable to create avatar measurement canvas context.');
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      let maxRadius = 0;
      let opaquePixelCount = 0;

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const alpha = data[(y * canvas.width + x) * 4 + 3];
          if (alpha > alphaThreshold) {
            opaquePixelCount += 1;
            maxRadius = Math.max(maxRadius, Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY));
          }
        }
      }

      return {
        width: canvas.width,
        height: canvas.height,
        maxRadius,
        opaquePixelCount
      };
    },
    { dataUrl, alphaThreshold }
  );
}
