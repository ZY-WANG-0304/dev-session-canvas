import assert from 'assert/strict';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  COMPARE_ENTER_FRAME_COUNT,
  HERO_COPY,
  HERO_FRAME_ID,
  HERO_MODE_TOP,
  HERO_WINDOWS,
  GIF_SIZE,
  MARKETPLACE_COPY,
  MASTER_SIZE,
  MP4_SIZE,
  PANE_EXPAND_FRAME_COUNT,
  PRODUCT_ICON_RELATIVE_PATH,
  STORYBOARD,
  VIDEO_CAPTION_TIMELINE,
  VIDEO_SEGMENT_TIMELINE,
  buildCompareEnterLayoutFilter,
  buildPaneExpandLayoutFilter,
  buildStableCompareLayoutFilter,
  buildStableSingleLayoutFilter,
  getMp4WindowRects,
  renderGif,
  resolveCompareEnterLayout,
  resolveHeroPresentation,
  resolvePaneExpandLayout,
  resolveStoryboardPresentation,
  resolveVideoTimelineSources,
  validateManifestSources,
  validateManifestStructure
} from './compose-marketplace-media.mjs';

test('validates the fixed eight-frame bilingual storyboard contract', () => {
  const manifest = createManifest();

  assert.deepEqual(validateManifestStructure(manifest), []);
  assert.equal(manifest.heroFrameId, HERO_FRAME_ID);
  assert.equal(
    PRODUCT_ICON_RELATIVE_PATH,
    'extensions/vscode/dev-session-canvas/images/dev-session-canvas-icon.svg'
  );
  assert.equal(existsSync(path.resolve(PRODUCT_ICON_RELATIVE_PATH)), true);
  assert.equal(STORYBOARD.reduce((total, frame) => total + frame.durationMs, 0), 10000);
  assert.deepEqual(
    STORYBOARD.map(({ id, layout, captionKey }) => ({ id, layout, captionKey })),
    [
      { id: 'overview-start', layout: 'root-single', captionKey: undefined },
      { id: 'all-running', layout: 'root-single', captionKey: undefined },
      { id: 'attention-arrives', layout: 'compare', captionKey: 'compare' },
      { id: 'mode-compare', layout: 'compare', captionKey: undefined },
      { id: 'attention-focused', layout: 'pane-single', captionKey: 'focus' },
      { id: 'decision-submitted', layout: 'pane-single', captionKey: undefined },
      { id: 'tests-passed', layout: 'pane-single', captionKey: undefined },
      { id: 'all-in-view', layout: 'pane-single', captionKey: undefined }
    ]
  );
  assert.equal(HERO_FRAME_ID, 'attention-focused');
  assert.deepEqual(resolveStoryboardPresentation('attention-arrives'), {
    layout: 'compare',
    captionKey: 'compare',
    productLockup: false
  });
  assert.deepEqual(resolveStoryboardPresentation(HERO_FRAME_ID), {
    layout: 'pane-single',
    captionKey: 'focus',
    productLockup: false
  });
  assert.deepEqual(MARKETPLACE_COPY.en, {
    opening: ['One workspace.', 'Multiple tasks moving in parallel.'],
    compare: ['Two view modes. Choose as needed.'],
    focus: ['Spot the session that needs you.', 'Focus instantly.'],
    closing: ['See the whole picture.', 'Focus with ease.'],
    leftMode: 'Root Groups',
    rightMode: 'Pane Gallery'
  });
  assert.deepEqual(MARKETPLACE_COPY['zh-CN'], {
    opening: ['一个工作区，同时推进多项任务。'],
    compare: ['两种视图模式，按需选择。'],
    focus: ['发现需要关注的会话，立即聚焦。'],
    closing: ['既能统览全局，也能从容聚焦。'],
    leftMode: '组合画布',
    rightMode: '窗格画廊'
  });
});

test('defines an independent bilingual 50/50 Hero presentation', () => {
  assert.deepEqual(HERO_WINDOWS, {
    left: { x: 60, y: 550, width: 1200, height: 750 },
    right: { x: 1300, y: 550, width: 1200, height: 750 }
  });
  assert.equal(HERO_MODE_TOP, 400);
  assert.equal(MASTER_SIZE.height - HERO_WINDOWS.left.y - HERO_WINDOWS.left.height, 300);
  assert.equal(HERO_WINDOWS.left.width, HERO_WINDOWS.right.width);
  assert.equal(HERO_WINDOWS.left.height, HERO_WINDOWS.right.height);
  assert.equal(
    HERO_WINDOWS.left.x,
    MASTER_SIZE.width - HERO_WINDOWS.right.x - HERO_WINDOWS.right.width
  );
  assert.equal(
    HERO_WINDOWS.right.x - HERO_WINDOWS.left.x - HERO_WINDOWS.left.width,
    40
  );
  assert.deepEqual(HERO_COPY.en, {
    descriptor: 'Multi-agent workbench for VS Code',
    headline: 'Every agent. Every root. One canvas.',
    leftDescription: 'Sessions from every root, tiled together on one canvas.',
    rightDescription: 'Focus on one task while staying in control of the rest.'
  });
  assert.deepEqual(HERO_COPY['zh-CN'], {
    descriptor: 'VS Code 多 Agent 协作工作台',
    headline: '所有 Agent，跨根目录汇聚于一张画布。',
    leftDescription: '各根目录的会话，平铺在同一张画布中。',
    rightDescription: '兼顾单任务聚焦与全局任务掌控。'
  });
  assert.deepEqual(resolveHeroPresentation('en'), {
    frameId: HERO_FRAME_ID,
    layout: 'compare-50-50',
    windows: HERO_WINDOWS,
    modes: { left: 'Root Groups', right: 'Pane Gallery' },
    modeTop: HERO_MODE_TOP,
    footerLayout: 'none',
    copy: HERO_COPY.en
  });
  assert.deepEqual(resolveHeroPresentation('zh-CN'), {
    frameId: HERO_FRAME_ID,
    layout: 'compare-50-50',
    windows: HERO_WINDOWS,
    modes: { left: '组合画布', right: '窗格画廊' },
    modeTop: HERO_MODE_TOP,
    footerLayout: 'none',
    copy: HERO_COPY['zh-CN']
  });
  assert.throws(() => resolveHeroPresentation('fr'), /Unsupported Hero language/);
});

test('rejects a missing pair, mismatched state, wrong order, and implicit last-frame hero', () => {
  const manifest = createManifest();
  manifest.frames.splice(2, 1);
  manifest.frames[2].left.stateId = 'different-state';
  manifest.heroFrameId = 'all-in-view';

  const errors = validateManifestStructure(manifest);

  assert.ok(errors.some((error) => error.includes('exactly 8 frames')));
  assert.ok(errors.some((error) => error.includes('frames[2].id must be attention-arrives')));
  assert.ok(errors.some((error) => error.includes('left/right stateId must match')));
  assert.ok(errors.some((error) => error.includes(`heroFrameId must be ${HERO_FRAME_ID}`)));
});

test('requires continuous video boundaries and maps every MP4 segment to live sources', () => {
  const manifest = createManifest('continuous.mp4');
  const resolved = {
    ...manifest,
    takes: {
      rootGroups: {
        ...manifest.takes.rootGroups,
        clip: { ...manifest.takes.rootGroups.clip, absolutePath: '/video/root-live.mp4' }
      },
      paneGallery: {
        ...manifest.takes.paneGallery,
        clip: { ...manifest.takes.paneGallery.clip, absolutePath: '/video/pane-live.mp4' }
      }
    },
    comparisonClips: {
      rootGroups: {
        ...manifest.comparisonClips.rootGroups,
        absolutePath: '/video/root-live.mp4'
      },
      paneGallery: {
        ...manifest.comparisonClips.paneGallery,
        absolutePath: '/video/pane-live.mp4'
      }
    }
  };

  assert.deepEqual(resolveVideoTimelineSources(resolved), {
    takeA: { path: '/video/root-live.mp4', inMs: 0 },
    compareEnter: {
      left: { path: '/video/root-live.mp4', inMs: 19000 },
      right: { path: '/video/pane-live.mp4', inMs: 9000 }
    },
    compareStable: {
      left: { path: '/video/root-live.mp4', inMs: 20000 },
      right: { path: '/video/pane-live.mp4', inMs: 10000 }
    },
    paneExpand: {
      left: { path: '/video/root-live.mp4', inMs: 26000 },
      pane: { path: '/video/pane-live.mp4', inMs: 16000 }
    },
    paneStable: {
      pane: { path: '/video/pane-live.mp4', inMs: 19000 }
    }
  });

  manifest.comparisonClips.rootGroups.path = 'different.mp4';
  manifest.takes.paneGallery.clip.inMs = 16001;
  const errors = validateManifestStructure(manifest);
  assert.ok(errors.some((error) => error.includes('same continuous video path')));
  assert.ok(errors.some((error) => error.includes('contiguous at 16000ms')));
});

test('probes every source and enforces native 1440x900 take/checkpoint geometry', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-media-compositor-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const imagePath = path.join(tempDir, 'checkpoint.png');
  const clipPath = path.join(tempDir, 'take.mp4');
  runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=#152026:s=1440x900:r=1',
    '-frames:v', '1', imagePath
  ]);
  runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=#152026:s=1440x900:r=1',
    '-t', '45.1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clipPath
  ]);

  const manifest = createManifest('take.mp4', 'checkpoint.png');
  const manifestPath = path.join(tempDir, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const valid = await validateManifestSources(manifest, manifestPath);
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.sources.length, 20);

  const wrongImagePath = path.join(tempDir, 'wrong.png');
  runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=#152026:s=1280x720:r=1',
    '-frames:v', '1', wrongImagePath
  ]);
  manifest.frames[0].left.path = 'wrong.png';
  const invalid = await validateManifestSources(manifest, manifestPath);
  assert.ok(invalid.errors.some((error) => error.includes('must be 1440x900, got 1280x720')));

  manifest.frames[0].left.path = 'checkpoint.png';
  manifest.comparisonClips.paneGallery.inMs = 12000;
  manifest.takes.paneGallery.clip.inMs = 19000;
  const invalidTrim = await validateManifestSources(manifest, manifestPath);
  assert.ok(invalidTrim.errors.some((error) => error.includes('after inMs=19000')));
});

test('renders the eight-frame GIF with the declared 10-second timeline', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-media-gif-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const frameDir = path.join(tempDir, 'frames');
  await fs.mkdir(frameDir);
  const colors = ['152026', '18302e', '173a43', '1d334b', '21433c', '29453f', '31504a', '365965'];

  STORYBOARD.forEach((frame, index) => {
    runFfmpeg([
      '-f', 'lavfi', '-i', `color=c=#${colors[index]}:s=1440x900:r=1`,
      '-frames:v', '1', path.join(frameDir, `${frame.id}.png`)
    ]);
  });

  const outputPath = path.join(tempDir, 'storyboard.gif');
  await renderGif({ resolved: { frames: STORYBOARD }, frameDir, workDir: tempDir, outputPath });
  const mediaProbe = probe(outputPath);

  assert.equal(mediaProbe.width, GIF_SIZE.width);
  assert.equal(mediaProbe.height, GIF_SIZE.height);
  assert.equal(mediaProbe.frameCount, STORYBOARD.length);
  assert.equal(mediaProbe.durationSeconds, 10);
});

test('renders fixed equal comparison windows and a true large Pane Gallery window', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-media-layout-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const comparePath = path.join(tempDir, 'compare.png');
  const panePath = path.join(tempDir, 'pane.png');

  assert.equal(
    VIDEO_SEGMENT_TIMELINE.reduce((total, segment) => total + segment.durationSeconds, 0),
    54
  );
  assert.ok(Math.abs(
    VIDEO_SEGMENT_TIMELINE.find((segment) => segment.id === 'compareStable').durationSeconds -
      VIDEO_CAPTION_TIMELINE.compareStableEndSeconds -
      0.2
  ) < 1e-9);
  assert.deepEqual(VIDEO_CAPTION_TIMELINE, {
    compareStableEndSeconds: 5.8,
    closingStartSeconds: 20.2,
    closingEndSeconds: 25,
    productStartSeconds: 23.5,
    productEndSeconds: 25
  });
  assert.deepEqual(getMp4WindowRects(), {
    single: { x: 240, y: 60, width: 1440, height: 900 },
    dualLeft: { x: 90, y: 270, width: 840, height: 525 },
    dualRight: { x: 990, y: 270, width: 840, height: 525 }
  });

  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=1`,
    '-f', 'lavfi', '-i', 'color=c=red:s=1440x900:r=1',
    '-f', 'lavfi', '-i', 'color=c=blue:s=1440x900:r=1',
    '-filter_complex', buildStableCompareLayoutFilter({ fps: 1, output: 'out' }),
    '-map', '[out]', '-frames:v', '1', comparePath
  ]);
  assertBoundsNear(detectColorBounds(comparePath, 'r'), { x: 90, y: 270, width: 840, height: 525 });
  assertBoundsNear(detectColorBounds(comparePath, 'b'), { x: 990, y: 270, width: 840, height: 525 });

  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=1`,
    '-f', 'lavfi', '-i', 'color=c=green:s=1440x900:r=1',
    '-filter_complex', buildStableSingleLayoutFilter({ fps: 1, output: 'out' }),
    '-map', '[out]', '-frames:v', '1', panePath
  ]);
  assertBoundsNear(detectColorBounds(panePath, 'g'), { x: 240, y: 60, width: 1440, height: 900 });
});

test('preserves independent motion inside both live comparison windows', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-media-live-compare-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const outputPath = path.join(tempDir, 'live-compare.mp4');
  const { dualLeft, dualRight } = getMp4WindowRects();

  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=30:d=1`,
    '-f', 'lavfi', '-i', 'testsrc2=s=1440x900:r=30:d=1',
    '-f', 'lavfi', '-i', 'testsrc=s=1440x900:r=30:d=1',
    '-filter_complex', `${buildStableCompareLayoutFilter()};[windows]format=yuv420p[out]`,
    '-map', '[out]', '-frames:v', '30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', outputPath
  ]);

  const leftStart = await extractVideoRegionFrame(outputPath, 0, dualLeft, tempDir, 'left-start');
  const leftLater = await extractVideoRegionFrame(outputPath, 15, dualLeft, tempDir, 'left-later');
  const rightStart = await extractVideoRegionFrame(outputPath, 0, dualRight, tempDir, 'right-start');
  const rightLater = await extractVideoRegionFrame(outputPath, 15, dualRight, tempDir, 'right-later');
  assert.notEqual(await sha256(leftStart), await sha256(leftLater));
  assert.notEqual(await sha256(rightStart), await sha256(rightLater));
});

test('moves and scales both transition windows continuously on a fixed canvas', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-media-motion-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const comparePath = path.join(tempDir, 'compare.mp4');
  const panePath = path.join(tempDir, 'pane.mp4');
  const rects = getMp4WindowRects();

  const compareLayouts = Array.from(
    { length: COMPARE_ENTER_FRAME_COUNT },
    (_, index) => resolveCompareEnterLayout(index)
  );
  assertRectSeries(compareLayouts.map((layout) => layout.left), rects.single, rects.dualLeft);
  assertRectSeries(
    compareLayouts.map((layout) => layout.right),
    { ...rects.dualRight, x: MP4_SIZE.width },
    rects.dualRight
  );

  const paneLayouts = Array.from(
    { length: PANE_EXPAND_FRAME_COUNT },
    (_, index) => resolvePaneExpandLayout(index)
  );
  assertRectSeries(
    paneLayouts.slice(0, COMPARE_ENTER_FRAME_COUNT).map((layout) => layout.left),
    rects.dualLeft,
    { ...rects.dualLeft, x: -rects.dualLeft.width }
  );
  assertRectSeries(paneLayouts.map((layout) => layout.pane), rects.dualRight, rects.single);

  runFfmpeg([
    '-filter_complex_threads', '4',
    '-f', 'lavfi', '-i', `color=c=black:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=30:d=1`,
    '-f', 'lavfi', '-i', `color=c=red:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=30:d=1`,
    '-f', 'lavfi', '-i', `color=c=blue:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=30:d=1`,
    '-filter_complex', `${buildCompareEnterLayoutFilter()};[windows]format=yuv420p[out]`,
    '-map', '[out]', '-frames:v', String(COMPARE_ENTER_FRAME_COUNT),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', comparePath
  ]);
  for (const frameIndex of [0, 7, 15, 22, 29]) {
    const framePath = await extractVideoFrame(comparePath, frameIndex, tempDir, `compare-${frameIndex}`);
    assertBoundsNear(
      detectColorBounds(framePath, 'r'),
      roundRect(resolveCompareEnterLayout(frameIndex).left),
      6
    );
    if (frameIndex > 0) {
      assertBoundsNear(
        detectColorBounds(framePath, 'b'),
        clipRectToCanvas(roundRect(resolveCompareEnterLayout(frameIndex).right)),
        6
      );
    }
  }

  runFfmpeg([
    '-filter_complex_threads', '4',
    '-f', 'lavfi', '-i', `color=c=green:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=30:d=3`,
    '-f', 'lavfi', '-i', `color=c=black:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=30:d=3`,
    '-f', 'lavfi', '-i', `color=c=red:s=${MP4_SIZE.width}x${MP4_SIZE.height}:r=30:d=3`,
    '-filter_complex', `${buildPaneExpandLayoutFilter()};[window]format=yuv420p[out]`,
    '-map', '[out]', '-frames:v', String(PANE_EXPAND_FRAME_COUNT),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', panePath
  ]);
  for (const frameIndex of [0, 22, 44, 66, 89]) {
    const framePath = await extractVideoFrame(panePath, frameIndex, tempDir, `pane-${frameIndex}`);
    assertBoundsNear(
      detectColorBounds(framePath, 'g'),
      roundRect(resolvePaneExpandLayout(frameIndex).pane),
      6
    );
  }
  for (const frameIndex of [0, 7, 15, 22, 28]) {
    const framePath = await extractVideoFrame(panePath, frameIndex, tempDir, `pane-left-${frameIndex}`);
    assertBoundsNear(
      detectColorBounds(framePath, 'r'),
      clipRectToCanvas(roundRect(resolvePaneExpandLayout(frameIndex).left)),
      6
    );
  }
});

function createManifest(clipPath = 'take.mp4', checkpointPath = 'checkpoint.png') {
  return {
    version: 2,
    scenario: 'four-root-attention',
    heroFrameId: HERO_FRAME_ID,
    takes: {
      rootGroups: {
        presentationMode: 'rootGroups',
        clip: { path: clipPath, inMs: 0, durationMs: 19000 }
      },
      paneGallery: {
        presentationMode: 'paneGallery',
        clip: { path: clipPath, inMs: 16000, durationMs: 28000 }
      }
    },
    comparisonClips: {
      rootGroups: { path: clipPath, inMs: 19000, durationMs: 10000 },
      paneGallery: { path: clipPath, inMs: 9000, durationMs: 7000 }
    },
    frames: STORYBOARD.map(({ id, durationMs }) => ({
      id,
      durationMs,
      left: { take: 'rootGroups', stateId: id, path: checkpointPath },
      right: { take: 'paneGallery', stateId: id, path: checkpointPath }
    }))
  };
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    timeout: 180000
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

async function extractVideoFrame(videoPath, frameIndex, outputDir, label) {
  const outputPath = path.join(outputDir, `${label}.png`);
  runFfmpeg([
    '-i', videoPath,
    '-vf', `select=eq(n\\,${frameIndex})`,
    '-frames:v', '1',
    outputPath
  ]);
  return outputPath;
}

async function extractVideoRegionFrame(videoPath, frameIndex, rect, outputDir, label) {
  const outputPath = path.join(outputDir, `${label}.png`);
  runFfmpeg([
    '-i', videoPath,
    '-vf', `select=eq(n\\,${frameIndex}),crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`,
    '-frames:v', '1',
    outputPath
  ]);
  return outputPath;
}

async function sha256(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function assertRectSeries(rects, expectedStart, expectedEnd) {
  assert.deepEqual(roundRect(rects[0]), expectedStart);
  assert.deepEqual(roundRect(rects.at(-1)), expectedEnd);
  for (const key of ['x', 'y', 'width', 'height']) {
    const delta = expectedEnd[key] - expectedStart[key];
    let largestStep = 0;
    for (let index = 1; index < rects.length; index += 1) {
      const step = rects[index][key] - rects[index - 1][key];
      largestStep = Math.max(largestStep, Math.abs(step));
      if (delta > 0) {
        assert.ok(step >= -1e-9, `${key} must increase at frame ${index}`);
      } else if (delta < 0) {
        assert.ok(step <= 1e-9, `${key} must decrease at frame ${index}`);
      } else {
        assert.ok(Math.abs(step) <= 1e-9, `${key} must remain fixed at frame ${index}`);
      }
    }
    const maximumSmoothstepStep = Math.abs(delta) * 1.6 / (rects.length - 1) + 0.5;
    assert.ok(
      largestStep <= maximumSmoothstepStep,
      `${key} jumped ${largestStep}px; expected <= ${maximumSmoothstepStep}px`
    );
  }
}

function roundRect(rect) {
  return Object.fromEntries(
    Object.entries(rect).map(([key, value]) => [key, Math.round(value)])
  );
}

function clipRectToCanvas(rect) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(MP4_SIZE.width, rect.x + rect.width);
  const bottom = Math.min(MP4_SIZE.height, rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function detectColorBounds(filePath, plane, minimumValue = 100) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-i', filePath,
    '-vf', `extractplanes=${plane},bbox=min_val=${minimumValue}`,
    '-frames:v', '1', '-f', 'null', '-'
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const match = result.stderr.match(/crop=(\d+):(\d+):(\d+):(\d+)/u);
  assert.ok(match, `Unable to detect ${plane}-plane bounds:\n${result.stderr}`);
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4])
  };
}

function assertBoundsNear(actual, expected, tolerance = 2) {
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= tolerance,
      `${key} expected ${expected[key]} +/- ${tolerance}, got ${actual[key]}`
    );
  }
}

function probe(filePath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames:format=duration',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const parsed = JSON.parse(result.stdout);
  return {
    width: Number(parsed.streams[0].width),
    height: Number(parsed.streams[0].height),
    frameCount: Number(parsed.streams[0].nb_frames),
    durationSeconds: Number(parsed.format.duration)
  };
}
