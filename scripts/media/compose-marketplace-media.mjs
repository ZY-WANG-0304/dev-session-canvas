#!/usr/bin/env node

import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { chromium } from 'playwright';

export const MASTER_SIZE = Object.freeze({ width: 2560, height: 1600 });
export const MP4_SIZE = Object.freeze({ width: 1920, height: 1200 });
export const GIF_SIZE = Object.freeze({ width: 1440, height: 900 });
export const SOURCE_SIZE = Object.freeze({ width: 1440, height: 900 });
export const HERO_FRAME_ID = 'attention-focused';
export const PRODUCT_ICON_RELATIVE_PATH = 'extensions/vscode/dev-session-canvas/images/dev-session-canvas-icon.svg';
export const PRODUCT_NAME = 'DevSessionCanvas';
export const PROJECT_GITHUB_URL = 'https://github.com/ZY-WANG-0304/dev-session-canvas';
export const PROJECT_GITHUB_DISPLAY = 'github.com/ZY-WANG-0304/dev-session-canvas';

export const STORYBOARD = Object.freeze([
  { id: 'overview-start', durationMs: 800, layout: 'root-single' },
  { id: 'all-running', durationMs: 700, layout: 'root-single' },
  { id: 'attention-arrives', durationMs: 2200, layout: 'compare', captionKey: 'compare' },
  { id: 'mode-compare', durationMs: 700, layout: 'compare' },
  { id: 'attention-focused', durationMs: 2400, layout: 'pane-single', captionKey: 'focus' },
  { id: 'decision-submitted', durationMs: 800, layout: 'pane-single' },
  { id: 'tests-passed', durationMs: 800, layout: 'pane-single' },
  { id: 'all-in-view', durationMs: 1600, layout: 'pane-single' }
]);

const EXPECTED_STORYBOARD_DURATION_MS = 10000;
const VIDEO_FPS = 30;
const VIDEO_DURATION_SECONDS = 54;
const TAKE_A_DURATION_SECONDS = 19;
const COMPARE_ENTER_DURATION_SECONDS = 1;
const COMPARE_STABLE_DURATION_SECONDS = 6;
const PANE_EXPAND_DURATION_SECONDS = 3;
const PANE_STABLE_DURATION_SECONDS = 25;
const TAKE_B_DURATION_SECONDS = 28;
const COMPARE_DURATION_SECONDS = COMPARE_ENTER_DURATION_SECONDS + COMPARE_STABLE_DURATION_SECONDS;
const ROOT_COMPARISON_DURATION_SECONDS = COMPARE_DURATION_SECONDS + PANE_EXPAND_DURATION_SECONDS;
const PANE_COMPARISON_DURATION_SECONDS = COMPARE_DURATION_SECONDS;
export const COMPARE_ENTER_FRAME_COUNT = COMPARE_ENTER_DURATION_SECONDS * VIDEO_FPS;
export const PANE_EXPAND_FRAME_COUNT = PANE_EXPAND_DURATION_SECONDS * VIDEO_FPS;
const FONT_FAMILY = 'Noto Sans CJK SC';
const SCREENSHOT_TIMEOUT_MS = 60000;
const SCREENSHOT_RENDERER = process.env.DSC_MEDIA_SCREENSHOT_RENDERER ?? 'playwright';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_ICON_PATH = path.resolve(MODULE_DIR, '..', '..', PRODUCT_ICON_RELATIVE_PATH);
const DEFAULT_FONT_PATHS = Object.freeze({
  regular: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  bold: '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
});

export const SINGLE_WINDOW = Object.freeze({ x: 320, y: 80, width: 1920, height: 1200 });
export const DUAL_LEFT_WINDOW = Object.freeze({ x: 120, y: 360, width: 1120, height: 700 });
export const DUAL_RIGHT_WINDOW = Object.freeze({ x: 1320, y: 360, width: 1120, height: 700 });
export const HERO_WINDOWS = Object.freeze({
  left: Object.freeze({ x: 60, y: 550, width: 1200, height: 750 }),
  right: Object.freeze({ x: 1300, y: 550, width: 1200, height: 750 })
});
export const HERO_MODE_TOP = 400;
export const VIDEO_SEGMENT_TIMELINE = Object.freeze([
  { id: 'takeA', durationSeconds: TAKE_A_DURATION_SECONDS },
  { id: 'compareEnter', durationSeconds: COMPARE_ENTER_DURATION_SECONDS },
  { id: 'compareStable', durationSeconds: COMPARE_STABLE_DURATION_SECONDS },
  { id: 'paneExpand', durationSeconds: PANE_EXPAND_DURATION_SECONDS },
  { id: 'paneStable', durationSeconds: PANE_STABLE_DURATION_SECONDS }
]);
export const VIDEO_CAPTION_TIMELINE = Object.freeze({
  compareStableEndSeconds: 5.8,
  closingStartSeconds: 20.2,
  closingEndSeconds: PANE_STABLE_DURATION_SECONDS,
  productStartSeconds: 23.5,
  productEndSeconds: PANE_STABLE_DURATION_SECONDS
});

export const MARKETPLACE_COPY = Object.freeze({
  en: {
    opening: ['One workspace.', 'Multiple tasks moving in parallel.'],
    compare: ['Two view modes. Choose as needed.'],
    focus: ['Spot the session that needs you.', 'Focus instantly.'],
    closing: ['See the whole picture.', 'Focus with ease.'],
    leftMode: 'Root Groups',
    rightMode: 'Pane Gallery'
  },
  'zh-CN': {
    opening: ['一个工作区，同时推进多项任务。'],
    compare: ['两种视图模式，按需选择。'],
    focus: ['发现需要关注的会话，立即聚焦。'],
    closing: ['既能统览全局，也能从容聚焦。'],
    leftMode: '组合画布',
    rightMode: '窗格画廊'
  }
});

export const HERO_COPY = Object.freeze({
  en: Object.freeze({
    descriptor: 'Multi-agent workbench for VS Code',
    headline: 'Every agent. Every root. One canvas.',
    leftDescription: 'Sessions from every root, tiled together on one canvas.',
    rightDescription: 'Focus on one task while staying in control of the rest.'
  }),
  'zh-CN': Object.freeze({
    descriptor: 'VS Code 多 Agent 协作工作台',
    headline: '所有 Agent，跨根目录汇聚于一张画布。',
    leftDescription: '各根目录的会话，平铺在同一张画布中。',
    rightDescription: '兼顾单任务聚焦与全局任务掌控。'
  })
});

export function validateManifestStructure(manifest) {
  const errors = [];
  if (!isRecord(manifest)) {
    return ['manifest must be an object'];
  }
  if (manifest.version !== 2) {
    errors.push('manifest.version must be 2');
  }
  if (manifest.scenario !== 'four-root-attention') {
    errors.push('manifest.scenario must be four-root-attention');
  }
  if (manifest.heroFrameId !== HERO_FRAME_ID) {
    errors.push(`manifest.heroFrameId must be ${HERO_FRAME_ID}`);
  }

  const takeA = manifest.takes?.rootGroups;
  const takeB = manifest.takes?.paneGallery;
  validateTake(errors, takeA, 'takes.rootGroups', 'rootGroups', TAKE_A_DURATION_SECONDS * 1000);
  validateTake(errors, takeB, 'takes.paneGallery', 'paneGallery', TAKE_B_DURATION_SECONDS * 1000);

  const rootComparison = manifest.comparisonClips?.rootGroups;
  const paneComparison = manifest.comparisonClips?.paneGallery;
  validateVideoClip(
    errors,
    rootComparison,
    'comparisonClips.rootGroups',
    ROOT_COMPARISON_DURATION_SECONDS * 1000
  );
  validateVideoClip(
    errors,
    paneComparison,
    'comparisonClips.paneGallery',
    PANE_COMPARISON_DURATION_SECONDS * 1000
  );
  validateContinuousVideoBoundary(errors, {
    first: takeA?.clip,
    second: rootComparison,
    offsetMs: TAKE_A_DURATION_SECONDS * 1000,
    field: 'takes.rootGroups.clip -> comparisonClips.rootGroups'
  });
  validateContinuousVideoBoundary(errors, {
    first: paneComparison,
    second: takeB?.clip,
    offsetMs: COMPARE_DURATION_SECONDS * 1000,
    field: 'comparisonClips.paneGallery -> takes.paneGallery.clip'
  });

  if (!Array.isArray(manifest.frames)) {
    errors.push('manifest.frames must be an array');
    return errors;
  }
  if (manifest.frames.length !== STORYBOARD.length) {
    errors.push(`manifest.frames must contain exactly ${STORYBOARD.length} frames`);
  }

  STORYBOARD.forEach((expected, index) => {
    const frame = manifest.frames[index];
    const field = `frames[${index}]`;
    if (!isRecord(frame)) {
      errors.push(`${field} must be an object`);
      return;
    }
    if (frame.id !== expected.id) {
      errors.push(`${field}.id must be ${expected.id}`);
    }
    if (frame.durationMs !== expected.durationMs) {
      errors.push(`${field}.durationMs must be ${expected.durationMs}`);
    }
    validateCheckpoint(errors, frame.left, `${field}.left`, 'rootGroups', expected.id);
    validateCheckpoint(errors, frame.right, `${field}.right`, 'paneGallery', expected.id);
    if (frame.left?.stateId !== frame.right?.stateId) {
      errors.push(`${field} left/right stateId must match`);
    }
  });

  const totalDurationMs = manifest.frames.reduce(
    (total, frame) => total + (Number.isFinite(frame?.durationMs) ? frame.durationMs : 0),
    0
  );
  if (totalDurationMs !== EXPECTED_STORYBOARD_DURATION_MS) {
    errors.push(`storyboard duration must be ${EXPECTED_STORYBOARD_DURATION_MS}ms`);
  }

  return errors;
}

export async function validateManifestSources(manifest, manifestPath) {
  const errors = validateManifestStructure(manifest);
  if (errors.length > 0) {
    return { errors, sources: [] };
  }

  const baseDir = path.dirname(path.resolve(manifestPath));
  const sources = [
    { field: 'takes.rootGroups.clip.path', type: 'video', value: manifest.takes.rootGroups.clip.path },
    { field: 'takes.paneGallery.clip.path', type: 'video', value: manifest.takes.paneGallery.clip.path },
    {
      field: 'comparisonClips.rootGroups.path',
      type: 'video',
      value: manifest.comparisonClips.rootGroups.path
    },
    {
      field: 'comparisonClips.paneGallery.path',
      type: 'video',
      value: manifest.comparisonClips.paneGallery.path
    },
    ...manifest.frames.flatMap((frame, index) => [
      { field: `frames[${index}].left.path`, type: 'image', value: frame.left.path },
      { field: `frames[${index}].right.path`, type: 'image', value: frame.right.path }
    ])
  ].map((source) => ({ ...source, absolutePath: resolveManifestPath(baseDir, source.value) }));

  for (const source of sources) {
    if (!existsSync(source.absolutePath)) {
      errors.push(`${source.field} does not exist: ${source.absolutePath}`);
      continue;
    }
    const probe = probeMedia(source.absolutePath);
    if (!probe) {
      errors.push(`${source.field} cannot be probed: ${source.absolutePath}`);
      continue;
    }
    source.probe = probe;
    if (probe.width !== SOURCE_SIZE.width || probe.height !== SOURCE_SIZE.height) {
      errors.push(
        `${source.field} must be ${SOURCE_SIZE.width}x${SOURCE_SIZE.height}, got ${probe.width}x${probe.height}`
      );
    }
  }

  validateClipProbe(
    errors,
    sources[0],
    manifest.takes.rootGroups.clip.inMs,
    manifest.takes.rootGroups.clip.durationMs
  );
  validateClipProbe(
    errors,
    sources[1],
    manifest.takes.paneGallery.clip.inMs,
    manifest.takes.paneGallery.clip.durationMs
  );
  validateClipProbe(
    errors,
    sources[2],
    manifest.comparisonClips.rootGroups.inMs,
    manifest.comparisonClips.rootGroups.durationMs
  );
  validateClipProbe(
    errors,
    sources[3],
    manifest.comparisonClips.paneGallery.inMs,
    manifest.comparisonClips.paneGallery.durationMs
  );

  return { errors, sources };
}

export async function renderMarketplaceMedia({ manifest, manifestPath, language, outputDir }) {
  if (!MARKETPLACE_COPY[language]) {
    throw new Error(`Unsupported language: ${language}`);
  }
  const validation = await validateManifestSources(manifest, manifestPath);
  if (validation.errors.length > 0) {
    throw new Error(`Invalid Marketplace media manifest:\n- ${validation.errors.join('\n- ')}`);
  }
  ensureFontFiles();
  if (!existsSync(PRODUCT_ICON_PATH)) {
    throw new Error(`Missing product icon: ${PRODUCT_ICON_PATH}`);
  }
  const productIconDataUrl = await fileToDataUrl(PRODUCT_ICON_PATH);

  const manifestBaseDir = path.dirname(path.resolve(manifestPath));
  const resolved = resolveManifestSources(manifest, manifestBaseDir);
  const workDir = path.join(manifestBaseDir, 'composite', language);
  const frameDir = path.join(workDir, 'frames');
  const overlayDir = path.join(workDir, 'overlays');
  const heroMasterPath = path.join(workDir, 'hero-master.png');
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(frameDir, { recursive: true });
  await fs.mkdir(overlayDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  let fontVerification;
  try {
    fontVerification = await renderBackground(browser, path.join(overlayDir, 'background.png'));
    await renderTransparentOverlay(browser, {
      outputPath: path.join(overlayDir, 'labels.png'),
      modeLabels: true,
      language
    });
    for (const key of ['opening', 'compare', 'focus', 'closing']) {
      await renderTransparentOverlay(browser, {
        outputPath: path.join(overlayDir, `caption-${key}.png`),
        captionLines: MARKETPLACE_COPY[language][key],
        language
      });
    }
    await renderTransparentOverlay(browser, {
      outputPath: path.join(overlayDir, 'video-product.png'),
      productLockup: 'video',
      productIconDataUrl,
      language
    });

    for (const frame of resolved.frames) {
      await renderStoryboardFrame(browser, {
        frame,
        language,
        productIconDataUrl,
        outputPath: path.join(frameDir, `${frame.id}.png`)
      });
    }
    const heroFrame = resolved.frames.find((frame) => frame.id === HERO_FRAME_ID);
    if (!heroFrame) {
      throw new Error(`Missing resolved Hero frame: ${HERO_FRAME_ID}`);
    }
    await renderHeroMaster(browser, {
      frame: heroFrame,
      language,
      productIconDataUrl,
      outputPath: heroMasterPath
    });
  } finally {
    await browser.close();
  }

  const suffix = language === 'en' ? '' : '.zh-CN';
  const stagedDir = path.join(workDir, 'staged-output');
  await fs.mkdir(stagedDir, { recursive: true });
  const staged = {
    mp4: path.join(stagedDir, `canvas-overview${suffix}.mp4`),
    gif: path.join(stagedDir, `canvas-overview${suffix}.gif`),
    png: path.join(stagedDir, `canvas-overview${suffix}.png`)
  };

  await renderVideo({ resolved, overlayDir, language, outputPath: staged.mp4 });
  await renderGif({ resolved, frameDir, workDir, outputPath: staged.gif });
  renderHero({ heroMasterPath, outputPath: staged.png });

  const final = {
    mp4: path.join(outputDir, path.basename(staged.mp4)),
    gif: path.join(outputDir, path.basename(staged.gif)),
    png: path.join(outputDir, path.basename(staged.png))
  };
  const report = await buildValidationReport({
    manifest,
    manifestPath,
    language,
    resolved,
    output: staged,
    fontVerification
  });
  if (report.passed) {
    for (const kind of ['mp4', 'gif', 'png']) {
      await fs.rename(staged[kind], final[kind]);
      report.assets[kind].path = final[kind];
    }
  }
  await fs.writeFile(
    path.join(workDir, 'validation-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  if (report.passed) {
    await fs.writeFile(
      path.join(workDir, 'render-metadata.json'),
      `${JSON.stringify({
        version: 1,
        language,
        heroFrameId: manifest.heroFrameId,
        gifLastFrameId: STORYBOARD.at(-1).id,
        gifFramePresentations: storyboardFramePresentations(),
        heroPresentation: resolveHeroPresentation(language),
        productIcon: {
          path: PRODUCT_ICON_RELATIVE_PATH,
          sha256: await sha256File(PRODUCT_ICON_PATH)
        },
        brand: resolveBrandIdentity(),
        sourceManifest: path.resolve(manifestPath),
        output: final,
        renderedAt: new Date().toISOString()
      }, null, 2)}\n`,
      'utf8'
    );
  }

  return { output: final, report, workDir };
}

async function renderBackground(browser, outputPath) {
  const page = await browser.newPage({ viewport: MASTER_SIZE, deviceScaleFactor: 1 });
  try {
    await page.setContent(backgroundDocument(), { waitUntil: 'load' });
    const loaded = await verifyFont(page);
    await capturePageScreenshot(page, { outputPath });
    return loaded;
  } finally {
    await page.close();
  }
}

async function renderTransparentOverlay(browser, options) {
  const page = await browser.newPage({ viewport: MASTER_SIZE, deviceScaleFactor: 1 });
  try {
    await page.setContent(overlayDocument(options), { waitUntil: 'load' });
    await verifyFont(page);
    await capturePageScreenshot(page, {
      outputPath: options.outputPath,
      omitBackground: true
    });
  } finally {
    await page.close();
  }
}

async function renderStoryboardFrame(browser, { frame, language, productIconDataUrl, outputPath }) {
  const page = await browser.newPage({ viewport: MASTER_SIZE, deviceScaleFactor: 1 });
  try {
    const leftDataUrl = await fileToDataUrl(frame.left.absolutePath);
    const rightDataUrl = await fileToDataUrl(frame.right.absolutePath);
    await page.setContent(
      storyboardDocument({ frame, language, leftDataUrl, rightDataUrl, productIconDataUrl }),
      { waitUntil: 'load' }
    );
    await verifyFont(page);
    await capturePageScreenshot(page, { outputPath });
  } finally {
    await page.close();
  }
}

async function renderHeroMaster(browser, { frame, language, productIconDataUrl, outputPath }) {
  const page = await browser.newPage({ viewport: MASTER_SIZE, deviceScaleFactor: 1 });
  try {
    const leftDataUrl = await fileToDataUrl(frame.left.absolutePath);
    const rightDataUrl = await fileToDataUrl(frame.right.absolutePath);
    await page.setContent(
      heroDocument({ language, leftDataUrl, rightDataUrl, productIconDataUrl }),
      { waitUntil: 'load' }
    );
    await verifyFont(page);
    await capturePageScreenshot(page, { outputPath });
  } finally {
    await page.close();
  }
}

async function capturePageScreenshot(page, { outputPath, omitBackground = false }) {
  if (SCREENSHOT_RENDERER === 'playwright') {
    await page.screenshot({ path: outputPath, omitBackground, timeout: SCREENSHOT_TIMEOUT_MS });
    return;
  }
  if (SCREENSHOT_RENDERER !== 'chrome-cli') {
    throw new Error(`Unsupported DSC_MEDIA_SCREENSHOT_RENDERER: ${SCREENSHOT_RENDERER}`);
  }

  const htmlPath = `${outputPath}.render.html`;
  await fs.writeFile(htmlPath, await page.content(), 'utf8');
  try {
    const args = [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1000',
      `--window-size=${MASTER_SIZE.width},${MASTER_SIZE.height}`,
      `--screenshot=${path.resolve(outputPath)}`
    ];
    if (omitBackground) {
      args.push('--default-background-color=00000000');
    }
    args.push(pathToFileURL(path.resolve(htmlPath)).href);
    runCommand(
      resolveChromeCliExecutable(),
      args,
      `Chrome CLI screenshot failed (${path.basename(outputPath)})`,
      SCREENSHOT_TIMEOUT_MS
    );
    const probe = probeMedia(outputPath);
    if (probe?.width !== MASTER_SIZE.width || probe?.height !== MASTER_SIZE.height) {
      throw new Error(
        `Chrome CLI screenshot must be ${MASTER_SIZE.width}x${MASTER_SIZE.height}: ${outputPath}`
      );
    }
  } finally {
    await fs.rm(htmlPath, { force: true });
  }
}

function resolveChromeCliExecutable() {
  const browserPath = chromium.executablePath();
  const browserInstallDir = path.dirname(path.dirname(browserPath));
  const revision = path.basename(browserInstallDir).match(/^chromium-(.+)$/)?.[1];
  if (!revision) {
    return browserPath;
  }
  const browsersDir = path.dirname(browserInstallDir);
  const candidates = [
    path.join(
      browsersDir,
      `chromium_headless_shell-${revision}`,
      'chrome-headless-shell-linux64',
      'chrome-headless-shell'
    ),
    path.join(
      browsersDir,
      `chromium_headless_shell-${revision}`,
      'chrome-linux',
      'headless_shell'
    )
  ];
  const headlessShellPath = candidates.find((candidate) => existsSync(candidate));
  if (!headlessShellPath) {
    throw new Error(`Playwright Chromium headless shell not found beside ${browserInstallDir}`);
  }
  return headlessShellPath;
}

async function renderVideo({ resolved, overlayDir, language, outputPath }) {
  const backgroundMaster = path.join(overlayDir, 'background.png');
  const background = path.join(overlayDir, 'background-mp4.png');
  const productMaster = path.join(overlayDir, 'video-product.png');
  const product = path.join(overlayDir, 'video-product-mp4.png');
  const timeline = resolveVideoTimelineSources(resolved);

  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', backgroundMaster,
    '-vf', `scale=${MP4_SIZE.width}:${MP4_SIZE.height}:flags=lanczos`,
    '-frames:v', '1', background
  ], 'MP4 background preparation failed', 30000);

  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', productMaster,
    '-vf', `scale=${MP4_SIZE.width}:${MP4_SIZE.height}:flags=lanczos,format=rgba`,
    '-frames:v', '1', product
  ], 'MP4 product lockup preparation failed', 30000);

  const textDir = path.join(overlayDir, 'video-text');
  await fs.mkdir(textDir, { recursive: true });
  const textFiles = {};
  for (const key of ['opening', 'compare', 'focus', 'closing']) {
    textFiles[key] = path.join(textDir, `${key}.txt`);
    await fs.writeFile(textFiles[key], `${MARKETPLACE_COPY[language][key].join('\n')}\n`, 'utf8');
  }
  textFiles.leftMode = path.join(textDir, 'left-mode.txt');
  textFiles.rightMode = path.join(textDir, 'right-mode.txt');
  await fs.writeFile(textFiles.leftMode, `${MARKETPLACE_COPY[language].leftMode}\n`, 'utf8');
  await fs.writeFile(textFiles.rightMode, `${MARKETPLACE_COPY[language].rightMode}\n`, 'utf8');

  const single = scaleRect(SINGLE_WINDOW, MP4_SIZE.width / MASTER_SIZE.width);
  const dualLeft = scaleRect(DUAL_LEFT_WINDOW, MP4_SIZE.width / MASTER_SIZE.width);
  const dualRight = scaleRect(DUAL_RIGHT_WINDOW, MP4_SIZE.width / MASTER_SIZE.width);

  const segmentDir = path.join(path.dirname(outputPath), 'video-segments');
  await fs.rm(segmentDir, { recursive: true, force: true });
  await fs.mkdir(segmentDir, { recursive: true });
  const segments = {
    takeA: path.join(segmentDir, '01-take-a.mp4'),
    compareEnter: path.join(segmentDir, '02-compare-enter.mp4'),
    compareStable: path.join(segmentDir, '03-compare-stable.mp4'),
    paneExpand: path.join(segmentDir, '04-pane-expand.mp4'),
    paneStable: path.join(segmentDir, '05-pane-stable.mp4')
  };

  renderVideoSegment({
    duration: TAKE_A_DURATION_SECONDS,
    inputs: [
      ...videoInput(timeline.takeA.path, timeline.takeA.inMs),
      ...loopedImageInput(background, TAKE_A_DURATION_SECONDS)
    ],
    filter: [
      `[1:v]fps=30,format=rgba[bg]`,
      `[0:v]setpts=PTS-STARTPTS,fps=30,scale=${single.width}:${single.height}:flags=lanczos,format=rgba[take]`,
      `[bg][take]overlay=${single.x}:${single.y}:shortest=1[window]`,
      drawTextFilter({
        input: 'window',
        output: 'out',
        textFile: textFiles.opening,
        fontSize: 80,
        x: '(w-text_w)/2',
        y: language === 'en' ? 972 : 1028,
        enable: 'between(t,0.35,4.85)'
      })
    ].join(';'),
    outputPath: segments.takeA
  });

  renderVideoSegment({
    duration: COMPARE_ENTER_DURATION_SECONDS,
    inputs: [
      ...loopedImageInput(background, COMPARE_ENTER_DURATION_SECONDS),
      ...videoInput(timeline.compareEnter.left.path, timeline.compareEnter.left.inMs),
      ...videoInput(timeline.compareEnter.right.path, timeline.compareEnter.right.inMs),
      ...loopedImageInput(product, COMPARE_ENTER_DURATION_SECONDS)
    ],
    filter: [
      buildCompareEnterLayoutFilter(),
      drawTextFilter({
        input: 'windows',
        output: 'withLeftLabel',
        textFile: textFiles.leftMode,
        fontSize: 40,
        x: `${dualLeft.x}+(${dualLeft.width}-text_w)/2`,
        y: 203,
        enable: 'gte(t,0.35)',
        alpha: 'clip((t-0.35)/0.25,0,1)'
      }),
      drawTextFilter({
        input: 'withLeftLabel',
        output: 'withLabels',
        textFile: textFiles.rightMode,
        fontSize: 40,
        x: `${dualRight.x}+(${dualRight.width}-text_w)/2`,
        y: 203,
        enable: 'gte(t,0.35)',
        alpha: 'clip((t-0.35)/0.25,0,1)'
      }),
      drawTextFilter({
        input: 'withLabels',
        output: 'withCaption',
        textFile: textFiles.compare,
        fontSize: 80,
        x: '(w-text_w)/2',
        y: 1015,
        enable: 'gte(t,0.2)',
        alpha: 'clip((t-0.2)/0.25,0,1)'
      }),
      '[3:v]fps=30,format=rgba,fade=t=in:st=0:d=0.2:alpha=1[brand]',
      '[withCaption][brand]overlay=0:0:shortest=1[out]'
    ].join(';'),
    outputPath: segments.compareEnter
  });

  renderVideoSegment({
    duration: COMPARE_STABLE_DURATION_SECONDS,
    inputs: [
      ...loopedImageInput(background, COMPARE_STABLE_DURATION_SECONDS),
      ...videoInput(timeline.compareStable.left.path, timeline.compareStable.left.inMs),
      ...videoInput(timeline.compareStable.right.path, timeline.compareStable.right.inMs),
      ...loopedImageInput(product, COMPARE_STABLE_DURATION_SECONDS)
    ],
    filter: [
      buildStableCompareLayoutFilter(),
      drawTextFilter({
        input: 'windows',
        output: 'withLeftLabel',
        textFile: textFiles.leftMode,
        fontSize: 40,
        x: `${dualLeft.x}+(${dualLeft.width}-text_w)/2`,
        y: 203
      }),
      drawTextFilter({
        input: 'withLeftLabel',
        output: 'withLabels',
        textFile: textFiles.rightMode,
        fontSize: 40,
        x: `${dualRight.x}+(${dualRight.width}-text_w)/2`,
        y: 203
      }),
      drawTextFilter({
        input: 'withLabels',
        output: 'withCaption',
        textFile: textFiles.compare,
        fontSize: 80,
        x: '(w-text_w)/2',
        y: 1015,
        enable: `lte(t,${VIDEO_CAPTION_TIMELINE.compareStableEndSeconds})`
      }),
      '[3:v]fps=30,format=rgba[brand]',
      '[withCaption][brand]overlay=0:0:shortest=1[out]'
    ].join(';'),
    outputPath: segments.compareStable
  });

  renderVideoSegment({
    duration: PANE_EXPAND_DURATION_SECONDS,
    inputs: [
      ...videoInput(timeline.paneExpand.pane.path, timeline.paneExpand.pane.inMs),
      ...loopedImageInput(background, PANE_EXPAND_DURATION_SECONDS),
      ...videoInput(timeline.paneExpand.left.path, timeline.paneExpand.left.inMs),
      ...loopedImageInput(product, PANE_EXPAND_DURATION_SECONDS)
    ],
    filter: [
      '[0:v]setpts=PTS-STARTPTS[paneSource]',
      buildPaneExpandLayoutFilter({ paneInput: 'paneSource' }),
      drawTextFilter({
        input: 'window',
        output: 'withLeftLabel',
        textFile: textFiles.leftMode,
        fontSize: 40,
        x: `${dualLeft.x}+(${dualLeft.width}-text_w)/2`,
        y: 203,
        enable: 'between(t,0,0.8)',
        alpha: '1-clip(t/0.65,0,1)'
      }),
      drawTextFilter({
        input: 'withLeftLabel',
        output: 'withLabels',
        textFile: textFiles.rightMode,
        fontSize: 40,
        x: `${dualRight.x}+(${dualRight.width}-text_w)/2`,
        y: 203,
        enable: 'between(t,0,0.8)',
        alpha: '1-clip(t/0.65,0,1)'
      }),
      '[3:v]fps=30,format=rgba,fade=t=out:st=0:d=0.65:alpha=1[brand]',
      '[withLabels][brand]overlay=0:0:shortest=1[out]'
    ].join(';'),
    outputPath: segments.paneExpand
  });

  renderVideoSegment({
    duration: PANE_STABLE_DURATION_SECONDS,
    inputs: [
      ...videoInput(
        timeline.paneStable.pane.path,
        timeline.paneStable.pane.inMs
      ),
      ...loopedImageInput(background, PANE_STABLE_DURATION_SECONDS),
      ...loopedImageInput(product, PANE_STABLE_DURATION_SECONDS)
    ],
    filter: [
      buildStableSingleLayoutFilter({ backgroundInput: '1:v', paneInput: '0:v' }),
      drawTextFilter({
        input: 'window',
        output: 'withFocus',
        textFile: textFiles.focus,
        fontSize: 80,
        x: '(w-text_w)/2',
        y: language === 'en' ? 972 : 1020,
        enable: 'between(t,0,6.2)',
        lineSpacing: 16
      }),
      drawTextFilter({
        input: 'withFocus',
        output: 'withClosing',
        textFile: textFiles.closing,
        fontSize: 80,
        x: '(w-text_w)/2',
        y: language === 'en' ? 972 : 1020,
        enable: `between(t,${VIDEO_CAPTION_TIMELINE.closingStartSeconds},${VIDEO_CAPTION_TIMELINE.closingEndSeconds})`
      }),
      `[2:v]fps=30,format=rgba,fade=t=in:st=${VIDEO_CAPTION_TIMELINE.productStartSeconds}:d=0.2:alpha=1[brand]`,
      `[withClosing][brand]overlay=0:0:shortest=1:enable='between(t,${VIDEO_CAPTION_TIMELINE.productStartSeconds},${VIDEO_CAPTION_TIMELINE.productEndSeconds})'[out]`
    ].join(';'),
    outputPath: segments.paneStable
  });

  const concatPath = path.join(segmentDir, 'concat.txt');
  await fs.writeFile(
    concatPath,
    `${Object.values(segments).map((segment) => `file '${escapeFfconcatPath(segment)}'`).join('\n')}\n`,
    'utf8'
  );
  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-c', 'copy', '-movflags', '+faststart',
    outputPath
  ], 'MP4 segment concatenation failed', 60000);
}

function renderVideoSegment({ duration, inputs, filter, outputPath }) {
  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-filter_complex_threads', '2',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[out]',
    '-an', '-r', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000',
    '-t', String(duration),
    outputPath
  ], `MP4 segment composition failed (${path.basename(outputPath)})`, 180000);
}

function videoInput(filePath, inMs) {
  return ['-ss', String(inMs / 1000), '-i', filePath];
}

export function resolveVideoTimelineSources(resolved) {
  const rootTake = resolved.takes.rootGroups.clip;
  const paneTake = resolved.takes.paneGallery.clip;
  const rootComparison = resolved.comparisonClips.rootGroups;
  const paneComparison = resolved.comparisonClips.paneGallery;
  return {
    takeA: { path: rootTake.absolutePath, inMs: rootTake.inMs },
    compareEnter: {
      left: { path: rootComparison.absolutePath, inMs: rootComparison.inMs },
      right: { path: paneComparison.absolutePath, inMs: paneComparison.inMs }
    },
    compareStable: {
      left: {
        path: rootComparison.absolutePath,
        inMs: rootComparison.inMs + COMPARE_ENTER_DURATION_SECONDS * 1000
      },
      right: {
        path: paneComparison.absolutePath,
        inMs: paneComparison.inMs + COMPARE_ENTER_DURATION_SECONDS * 1000
      }
    },
    paneExpand: {
      left: {
        path: rootComparison.absolutePath,
        inMs: rootComparison.inMs + COMPARE_DURATION_SECONDS * 1000
      },
      pane: { path: paneTake.absolutePath, inMs: paneTake.inMs }
    },
    paneStable: {
      pane: {
        path: paneTake.absolutePath,
        inMs: paneTake.inMs + PANE_EXPAND_DURATION_SECONDS * 1000
      }
    }
  };
}

function loopedImageInput(filePath, duration) {
  return ['-loop', '1', '-framerate', '30', '-t', String(duration), '-i', filePath];
}

function scaleRect(rect, scale) {
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale)
  };
}

export function getMp4WindowRects() {
  const scale = MP4_SIZE.width / MASTER_SIZE.width;
  return {
    single: scaleRect(SINGLE_WINDOW, scale),
    dualLeft: scaleRect(DUAL_LEFT_WINDOW, scale),
    dualRight: scaleRect(DUAL_RIGHT_WINDOW, scale)
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function smoothstep(value) {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function interpolateRect(start, end, progress) {
  const eased = smoothstep(progress);
  return Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((key) => [
      key,
      start[key] + (end[key] - start[key]) * eased
    ])
  );
}

export function resolveCompareEnterLayout(frameIndex) {
  const { single, dualLeft, dualRight } = getMp4WindowRects();
  const progress = frameIndex / (COMPARE_ENTER_FRAME_COUNT - 1);
  return {
    left: interpolateRect(single, dualLeft, progress),
    right: interpolateRect(
      { ...dualRight, x: MP4_SIZE.width },
      dualRight,
      progress
    )
  };
}

export function resolvePaneExpandLayout(frameIndex) {
  const { single, dualLeft, dualRight } = getMp4WindowRects();
  return {
    left: interpolateRect(
      dualLeft,
      { ...dualLeft, x: -dualLeft.width },
      frameIndex / (COMPARE_ENTER_FRAME_COUNT - 1)
    ),
    pane: interpolateRect(
      dualRight,
      single,
      frameIndex / (PANE_EXPAND_FRAME_COUNT - 1)
    )
  };
}

function ffmpegSmoothstepExpression(frameCount) {
  // perspective's output-frame counter starts at one; normalize the first encoded frame to progress zero.
  const linear = `min(max(on-1,0)/${frameCount - 1},1)`;
  return `(${linear})*(${linear})*(3-2*(${linear}))`;
}

function ffmpegInterpolatedValue(start, end, progress) {
  const delta = end - start;
  if (delta === 0) {
    return String(start);
  }
  return `${start}${delta > 0 ? '+' : ''}${delta}*(${progress})`;
}

function rectCorners(rect) {
  return {
    x0: rect.x,
    y0: rect.y,
    x1: rect.x + rect.width,
    y1: rect.y,
    x2: rect.x,
    y2: rect.y + rect.height,
    x3: rect.x + rect.width,
    y3: rect.y + rect.height
  };
}

function buildAnimatedWindowLayerFilter({ input, output, startRect, endRect, frameCount, fps }) {
  const start = rectCorners(startRect);
  const end = rectCorners(endRect);
  const progress = ffmpegSmoothstepExpression(frameCount);
  const coordinates = Object.keys(start).map(
    (key) => `${key}='${ffmpegInterpolatedValue(start[key], end[key], progress)}'`
  );
  return [
    `[${input}]setpts=PTS-STARTPTS,fps=${fps},scale=${MP4_SIZE.width}:${MP4_SIZE.height}:flags=lanczos,format=rgba`,
    'drawbox=x=0:y=0:w=iw:h=ih:color=black@0:t=1:replace=1',
    `perspective=sense=destination:eval=frame:interpolation=cubic:${coordinates.join(':')}[${output}]`
  ].join(',');
}

export function buildCompareEnterLayoutFilter({
  backgroundInput = '0:v',
  leftInput = '1:v',
  rightInput = '2:v',
  output = 'windows',
  fps = VIDEO_FPS
} = {}) {
  const { single, dualLeft, dualRight } = getMp4WindowRects();
  return [
    `[${backgroundInput}]fps=${fps},format=rgba[bg]`,
    buildAnimatedWindowLayerFilter({
      input: leftInput,
      output: 'left',
      startRect: single,
      endRect: dualLeft,
      frameCount: COMPARE_ENTER_FRAME_COUNT,
      fps
    }),
    buildAnimatedWindowLayerFilter({
      input: rightInput,
      output: 'right',
      startRect: { ...dualRight, x: MP4_SIZE.width },
      endRect: dualRight,
      frameCount: COMPARE_ENTER_FRAME_COUNT,
      fps
    }),
    '[bg][left]overlay=0:0:shortest=1[withLeft]',
    `[withLeft][right]overlay=0:0:shortest=1[${output}]`
  ].join(';');
}

export function buildPaneExpandLayoutFilter({
  backgroundInput = '1:v',
  paneInput = '0:v',
  leftInput = '2:v',
  output = 'window',
  fps = VIDEO_FPS
} = {}) {
  const { single, dualLeft, dualRight } = getMp4WindowRects();
  return [
    `[${backgroundInput}]fps=${fps},format=rgba[bg]`,
    buildAnimatedWindowLayerFilter({
      input: leftInput,
      output: 'left',
      startRect: dualLeft,
      endRect: { ...dualLeft, x: -dualLeft.width },
      frameCount: COMPARE_ENTER_FRAME_COUNT,
      fps
    }),
    buildAnimatedWindowLayerFilter({
      input: paneInput,
      output: 'pane',
      startRect: dualRight,
      endRect: single,
      frameCount: PANE_EXPAND_FRAME_COUNT,
      fps
    }),
    '[bg][left]overlay=0:0:shortest=1[withLeft]',
    `[withLeft][pane]overlay=0:0:shortest=1[${output}]`
  ].join(';');
}

export function buildStableCompareLayoutFilter({
  backgroundInput = '0:v',
  leftInput = '1:v',
  rightInput = '2:v',
  output = 'windows',
  fps = 30
} = {}) {
  const { dualLeft, dualRight } = getMp4WindowRects();
  return [
    `[${backgroundInput}]fps=${fps},format=rgba[bg]`,
    `[${leftInput}]setpts=PTS-STARTPTS,fps=${fps},scale=${dualLeft.width}:${dualLeft.height}:flags=lanczos,format=rgba[left]`,
    `[${rightInput}]setpts=PTS-STARTPTS,fps=${fps},scale=${dualRight.width}:${dualRight.height}:flags=lanczos,format=rgba[right]`,
    `[bg][left]overlay=${dualLeft.x}:${dualLeft.y}:shortest=1[withLeft]`,
    `[withLeft][right]overlay=${dualRight.x}:${dualRight.y}:shortest=1[${output}]`
  ].join(';');
}

export function buildStableSingleLayoutFilter({
  backgroundInput = '0:v',
  paneInput = '1:v',
  output = 'window',
  fps = 30
} = {}) {
  const { single } = getMp4WindowRects();
  return [
    `[${backgroundInput}]fps=${fps},format=rgba[bg]`,
    `[${paneInput}]setpts=PTS-STARTPTS,fps=${fps},scale=${single.width}:${single.height}:flags=lanczos,format=rgba[pane]`,
    `[bg][pane]overlay=${single.x}:${single.y}:shortest=1[${output}]`
  ].join(';');
}

function drawTextFilter({ input, output, textFile, fontSize, x, y, enable, alpha, lineSpacing = 12 }) {
  const options = [
    `fontfile='${escapeFfmpegFilterValue(DEFAULT_FONT_PATHS.bold)}'`,
    `textfile='${escapeFfmpegFilterValue(textFile)}'`,
    'fontcolor=0xf5faf9',
    `fontsize=${fontSize}`,
    `line_spacing=${lineSpacing}`,
    `x=${x}`,
    `y=${y}`,
    'shadowcolor=black@0.72',
    'shadowx=2',
    'shadowy=2'
  ];
  if (enable) {
    options.push(`enable='${enable}'`);
  }
  if (alpha) {
    options.push(`alpha='${alpha}'`);
  }
  return `[${input}]drawtext=${options.join(':')},setsar=1,format=yuv420p[${output}]`;
}

function escapeFfmpegFilterValue(value) {
  return path.resolve(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, `\\'`);
}

export async function renderGif({ resolved, frameDir, workDir, outputPath }) {
  const manifestPath = path.join(workDir, 'gif-concat.txt');
  const lines = [];
  for (const frame of resolved.frames) {
    const framePath = path.join(frameDir, `${frame.id}.png`);
    lines.push(`file '${escapeFfconcatPath(framePath)}'`);
    lines.push(`duration ${(frame.durationMs / 1000).toFixed(3)}`);
  }
  await fs.writeFile(manifestPath, `${lines.join('\n')}\n`, 'utf8');

  const palettePath = path.join(workDir, 'gif-palette.png');
  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', manifestPath,
    '-vf', `scale=${GIF_SIZE.width}:${GIF_SIZE.height}:flags=lanczos,palettegen=max_colors=192:stats_mode=diff`,
    palettePath
  ], 'GIF palette generation failed', 120000);
  const finalDelayCentiseconds = Math.round(resolved.frames.at(-1).durationMs / 10);
  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', manifestPath,
    '-i', palettePath,
    '-lavfi', `scale=${GIF_SIZE.width}:${GIF_SIZE.height}:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`,
    // ffconcat has no following timestamp from which to infer the last still's delay.
    '-final_delay', String(finalDelayCentiseconds),
    '-loop', '0',
    outputPath
  ], 'GIF composition failed', 120000);
}

function renderHero({ heroMasterPath, outputPath }) {
  runCommand('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', heroMasterPath,
    '-vf', `scale=${MP4_SIZE.width}:${MP4_SIZE.height}:flags=lanczos`,
    '-frames:v', '1',
    outputPath
  ], 'Hero PNG export failed', 30000);
}

async function buildValidationReport({ manifest, manifestPath, language, resolved, output, fontVerification }) {
  const assets = {};
  for (const [kind, filePath] of Object.entries(output)) {
    assets[kind] = {
      path: filePath,
      sha256: await sha256File(filePath),
      probe: probeMedia(filePath)
    };
  }
  const expected = {
    mp4: { width: MP4_SIZE.width, height: MP4_SIZE.height, durationSeconds: VIDEO_DURATION_SECONDS },
    gif: { width: GIF_SIZE.width, height: GIF_SIZE.height, durationSeconds: EXPECTED_STORYBOARD_DURATION_MS / 1000 },
    png: { width: MP4_SIZE.width, height: MP4_SIZE.height }
  };
  const checks = [];
  for (const kind of Object.keys(expected)) {
    const probe = assets[kind].probe;
    checks.push({
      name: `${kind}-dimensions`,
      passed: probe?.width === expected[kind].width && probe?.height === expected[kind].height,
      actual: probe ? `${probe.width}x${probe.height}` : null,
      expected: `${expected[kind].width}x${expected[kind].height}`
    });
    if (expected[kind].durationSeconds) {
      const tolerance = kind === 'gif' ? 0.15 : 0.1;
      checks.push({
        name: `${kind}-duration`,
        passed: Math.abs((probe?.durationSeconds ?? 0) - expected[kind].durationSeconds) <= tolerance,
        actual: probe?.durationSeconds ?? null,
        expected: expected[kind].durationSeconds
      });
    }
  }
  checks.push({
    name: 'font-loaded',
    passed: Boolean(fontVerification?.loaded),
    actual: fontVerification,
    expected: FONT_FAMILY
  });
  checks.push({
    name: 'hero-is-explicit-and-not-last-frame',
    passed: manifest.heroFrameId === HERO_FRAME_ID && manifest.heroFrameId !== STORYBOARD.at(-1).id,
    actual: manifest.heroFrameId,
    expected: HERO_FRAME_ID
  });
  checks.push({
    name: 'hero-layout-is-symmetric-50-50',
    passed:
      HERO_WINDOWS.left.width === HERO_WINDOWS.right.width &&
      HERO_WINDOWS.left.height === HERO_WINDOWS.right.height &&
      HERO_WINDOWS.left.x === MASTER_SIZE.width - HERO_WINDOWS.right.x - HERO_WINDOWS.right.width,
    actual: HERO_WINDOWS,
    expected: 'equal-sized windows mirrored around the 2560px master canvas'
  });
  checks.push({
    name: 'hero-footer-has-no-capability-strip',
    passed: resolveHeroPresentation(language).footerLayout === 'none',
    actual: resolveHeroPresentation(language).footerLayout,
    expected: 'none'
  });

  return {
    version: 1,
    language,
    sourceManifest: path.resolve(manifestPath),
    scenario: manifest.scenario,
    heroFrameId: manifest.heroFrameId,
    heroPresentation: resolveHeroPresentation(language),
    gifFrameIds: resolved.frames.map((frame) => frame.id),
    gifFramePresentations: storyboardFramePresentations(),
    productIcon: {
      path: PRODUCT_ICON_RELATIVE_PATH,
      sha256: await sha256File(PRODUCT_ICON_PATH)
    },
    brand: resolveBrandIdentity(),
    videoSourceHashes: await Promise.all([
      ['takeA', resolved.takes.rootGroups.clip],
      ['rootComparison', resolved.comparisonClips.rootGroups],
      ['paneComparison', resolved.comparisonClips.paneGallery],
      ['paneStory', resolved.takes.paneGallery.clip]
    ].map(async ([role, source]) => ({
      role,
      path: source.absolutePath,
      inMs: source.inMs,
      durationMs: source.durationMs,
      sha256: await sha256File(source.absolutePath)
    }))),
    sourceHashes: await Promise.all(resolved.frames.flatMap((frame) => [frame.left, frame.right]).map(async (source) => ({
      path: source.absolutePath,
      sha256: await sha256File(source.absolutePath)
    }))),
    font: fontVerification,
    assets,
    checks,
    passed: checks.every((check) => check.passed),
    generatedAt: new Date().toISOString()
  };
}

function storyboardFramePresentations() {
  return STORYBOARD.map(({ id, layout, captionKey }) => ({
    id,
    layout,
    captionKey,
    productLockup: 'persistent'
  }));
}

function validateTake(errors, take, field, expectedMode, minimumDurationMs) {
  if (!isRecord(take)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (take.presentationMode !== expectedMode) {
    errors.push(`${field}.presentationMode must be ${expectedMode}`);
  }
  validateVideoClip(errors, take.clip, `${field}.clip`, minimumDurationMs);
}

function validateVideoClip(errors, clip, field, minimumDurationMs) {
  if (!isRecord(clip)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (typeof clip.path !== 'string' || clip.path.length === 0) {
    errors.push(`${field}.path must be a non-empty string`);
  }
  if (!Number.isFinite(clip.inMs) || clip.inMs < 0) {
    errors.push(`${field}.inMs must be a non-negative number`);
  }
  if (!Number.isFinite(clip.durationMs) || clip.durationMs < minimumDurationMs) {
    errors.push(`${field}.durationMs must be at least ${minimumDurationMs}`);
  }
}

function validateContinuousVideoBoundary(errors, { first, second, offsetMs, field }) {
  if (!isRecord(first) || !isRecord(second)) {
    return;
  }
  if (first.path !== second.path) {
    errors.push(`${field} must use the same continuous video path`);
  }
  if (
    Number.isFinite(first.inMs) &&
    Number.isFinite(second.inMs) &&
    second.inMs !== first.inMs + offsetMs
  ) {
    errors.push(`${field} must be contiguous at ${first.inMs + offsetMs}ms`);
  }
}

function validateCheckpoint(errors, checkpoint, field, expectedTake, expectedStateId) {
  if (!isRecord(checkpoint)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (checkpoint.take !== expectedTake) {
    errors.push(`${field}.take must be ${expectedTake}`);
  }
  if (checkpoint.stateId !== expectedStateId) {
    errors.push(`${field}.stateId must be ${expectedStateId}`);
  }
  if (typeof checkpoint.path !== 'string' || checkpoint.path.length === 0) {
    errors.push(`${field}.path must be a non-empty string`);
  }
}

function validateClipProbe(errors, source, inMs, declaredDurationMs) {
  if (!source?.probe) {
    return;
  }
  const availableDurationMs = (source.probe.durationSeconds ?? 0) * 1000 - inMs;
  if (availableDurationMs + 50 < declaredDurationMs) {
    errors.push(
      `${source.field} has only ${availableDurationMs / 1000}s after inMs=${inMs}, ` +
      `shorter than declared clip duration ${declaredDurationMs / 1000}s`
    );
  }
}

function resolveManifestSources(manifest, baseDir) {
  return {
    takes: {
      rootGroups: {
        ...manifest.takes.rootGroups,
        clip: {
          ...manifest.takes.rootGroups.clip,
          absolutePath: resolveManifestPath(baseDir, manifest.takes.rootGroups.clip.path)
        }
      },
      paneGallery: {
        ...manifest.takes.paneGallery,
        clip: {
          ...manifest.takes.paneGallery.clip,
          absolutePath: resolveManifestPath(baseDir, manifest.takes.paneGallery.clip.path)
        }
      }
    },
    comparisonClips: {
      rootGroups: {
        ...manifest.comparisonClips.rootGroups,
        absolutePath: resolveManifestPath(baseDir, manifest.comparisonClips.rootGroups.path)
      },
      paneGallery: {
        ...manifest.comparisonClips.paneGallery,
        absolutePath: resolveManifestPath(baseDir, manifest.comparisonClips.paneGallery.path)
      }
    },
    frames: manifest.frames.map((frame) => ({
      ...frame,
      left: { ...frame.left, absolutePath: resolveManifestPath(baseDir, frame.left.path) },
      right: { ...frame.right, absolutePath: resolveManifestPath(baseDir, frame.right.path) }
    }))
  };
}

function backgroundDocument() {
  return htmlDocument(`
    <main class="background">
      <svg class="topology" viewBox="0 0 2560 1600" aria-hidden="true">
        <path d="M250 330 C520 190 760 260 1030 430 S1530 640 1800 430 S2200 290 2370 420" />
        <path d="M210 1120 C470 890 760 980 1010 1130 S1500 1340 1770 1120 S2160 980 2380 1130" />
        <path d="M660 250 C560 520 620 750 820 940 S980 1240 820 1450" />
        <path d="M1890 230 C1990 520 1940 760 1740 930 S1560 1230 1730 1460" />
        <g class="nodes">
          <circle cx="480" cy="430" r="8"/><circle cx="970" cy="520" r="8"/>
          <circle cx="1590" cy="520" r="8"/><circle cx="2110" cy="430" r="8"/>
          <circle cx="500" cy="1150" r="8"/><circle cx="990" cy="1070" r="8"/>
          <circle cx="1570" cy="1080" r="8"/><circle cx="2070" cy="1160" r="8"/>
        </g>
      </svg>
      <div class="region region-a"></div><div class="region region-b"></div>
      <div class="region region-c"></div><div class="region region-d"></div>
      <div class="grain"></div>
    </main>
  `, baseCss());
}

function overlayDocument({ captionLines, modeLabels, productLockup, productIconDataUrl, language }) {
  const content = [];
  if (modeLabels) {
    content.push(`<div class="mode-label left">${escapeHtml(MARKETPLACE_COPY[language].leftMode)}</div>`);
    content.push(`<div class="mode-label right">${escapeHtml(MARKETPLACE_COPY[language].rightMode)}</div>`);
  }
  if (captionLines) {
    content.push(`<div class="caption ${language === 'en' ? 'english' : 'chinese'}">${captionLines.map(escapeHtml).join('<br>')}</div>`);
  }
  if (productLockup) {
    content.push(productLockupMarkup(productIconDataUrl, productLockup));
  }
  return htmlDocument(`<main class="transparent-layer">${content.join('')}</main>`, `${baseCss()}${overlayCss()}`);
}

function heroDocument({ language, leftDataUrl, rightDataUrl, productIconDataUrl }) {
  if (!productIconDataUrl) {
    throw new Error('Hero requires the Dev Session Canvas icon');
  }
  const copy = HERO_COPY[language];
  const modeCopy = MARKETPLACE_COPY[language];
  const languageClass = language === 'en' ? 'english' : 'chinese';
  return htmlDocument(`
    <main class="background hero ${languageClass}">
      ${backgroundInnerMarkup()}
      <header class="hero-brand">
        <div class="hero-brand-lockup">
          <img class="hero-brand-icon" src="${productIconDataUrl}" alt="">
          <div class="hero-brand-copy">
            <span class="hero-brand-name">${PRODUCT_NAME}</span>
            <span class="hero-brand-url">${PROJECT_GITHUB_DISPLAY}</span>
          </div>
        </div>
        <div class="hero-descriptor">${escapeHtml(copy.descriptor)}</div>
      </header>
      <h1 class="hero-headline">${escapeHtml(copy.headline)}</h1>
      <section class="hero-mode left">
        <h2>${escapeHtml(modeCopy.leftMode)}</h2>
        <p>${escapeHtml(copy.leftDescription)}</p>
      </section>
      <section class="hero-mode right">
        <h2>${escapeHtml(modeCopy.rightMode)}</h2>
        <p>${escapeHtml(copy.rightDescription)}</p>
      </section>
      <div class="hero-center-rule" aria-hidden="true"></div>
      <section class="hero-window left"><img src="${leftDataUrl}" alt="Root Groups"></section>
      <section class="hero-window right"><img src="${rightDataUrl}" alt="Pane Gallery"></section>
    </main>
  `, `${baseCss()}${heroCss()}`);
}

function storyboardDocument({ frame, language, leftDataUrl, rightDataUrl, productIconDataUrl }) {
  const presentation = resolveStoryboardPresentation(frame.id);
  const captionKey = presentation.captionKey;
  const caption = captionKey
    ? `<div class="caption ${language === 'en' ? 'english' : 'chinese'}">${MARKETPLACE_COPY[language][captionKey].map(escapeHtml).join('<br>')}</div>`
    : '';
  const product = productLockupMarkup(productIconDataUrl, 'gif');
  return htmlDocument(`
    <main class="background">
      ${backgroundInnerMarkup()}
      ${storyboardWindowsMarkup(presentation.layout, leftDataUrl, rightDataUrl)}
      ${storyboardModeLabelsMarkup(presentation.layout, language)}
      ${caption}
      ${product}
    </main>
  `, `${baseCss()}${overlayCss()}${storyboardCss()}`);
}

export function resolveHeroPresentation(language) {
  if (!HERO_COPY[language]) {
    throw new Error(`Unsupported Hero language: ${language}`);
  }
  return {
    frameId: HERO_FRAME_ID,
    layout: 'compare-50-50',
    windows: HERO_WINDOWS,
    modes: {
      left: MARKETPLACE_COPY[language].leftMode,
      right: MARKETPLACE_COPY[language].rightMode
    },
    modeTop: HERO_MODE_TOP,
    footerLayout: 'none',
    brand: resolveBrandIdentity(),
    copy: HERO_COPY[language]
  };
}

function resolveBrandIdentity() {
  return {
    productName: PRODUCT_NAME,
    projectUrl: PROJECT_GITHUB_URL,
    projectUrlDisplay: PROJECT_GITHUB_DISPLAY
  };
}

function productLockupMarkup(productIconDataUrl, placement) {
  if (!productIconDataUrl) {
    throw new Error('Product lockup requires the Dev Session Canvas icon');
  }
  const placementClass = placement === 'video' ? ' video' : ' gif';
  return `<div class="product-lockup${placementClass}"><img class="product-icon" src="${productIconDataUrl}" alt=""><span class="product-name">${PRODUCT_NAME}</span><span class="product-divider" aria-hidden="true"></span><span class="product-url">${PROJECT_GITHUB_DISPLAY}</span></div>`;
}

export function resolveStoryboardPresentation(frameId) {
  const specification = STORYBOARD.find((frame) => frame.id === frameId);
  if (!specification) {
    throw new Error(`Unknown storyboard frame: ${frameId}`);
  }
  return {
    layout: specification.layout,
    captionKey: specification.captionKey,
    productLockup: 'persistent'
  };
}

function storyboardWindowsMarkup(layout, leftDataUrl, rightDataUrl) {
  if (layout === 'root-single') {
    return `<section class="story-window single root"><img src="${leftDataUrl}" alt="Root Groups"></section>`;
  }
  if (layout === 'pane-single') {
    return `<section class="story-window single pane"><img src="${rightDataUrl}" alt="Pane Gallery"></section>`;
  }
  return `
    <section class="story-window left"><img src="${leftDataUrl}" alt="Root Groups"></section>
    <section class="story-window right"><img src="${rightDataUrl}" alt="Pane Gallery"></section>
  `;
}

function storyboardModeLabelsMarkup(layout, language) {
  const copy = MARKETPLACE_COPY[language];
  if (layout === 'root-single') {
    return `<div class="mode-label single root">${escapeHtml(copy.leftMode)}</div>`;
  }
  if (layout === 'pane-single') {
    return `<div class="mode-label single pane">${escapeHtml(copy.rightMode)}</div>`;
  }
  return `
    <div class="mode-label left">${escapeHtml(copy.leftMode)}</div>
    <div class="mode-label right">${escapeHtml(copy.rightMode)}</div>
  `;
}

function backgroundInnerMarkup() {
  return `
    <svg class="topology" viewBox="0 0 2560 1600" aria-hidden="true">
      <path d="M250 330 C520 190 760 260 1030 430 S1530 640 1800 430 S2200 290 2370 420" />
      <path d="M210 1120 C470 890 760 980 1010 1130 S1500 1340 1770 1120 S2160 980 2380 1130" />
      <path d="M660 250 C560 520 620 750 820 940 S980 1240 820 1450" />
      <path d="M1890 230 C1990 520 1940 760 1740 930 S1560 1230 1730 1460" />
      <g class="nodes"><circle cx="480" cy="430" r="8"/><circle cx="970" cy="520" r="8"/><circle cx="1590" cy="520" r="8"/><circle cx="2110" cy="430" r="8"/><circle cx="500" cy="1150" r="8"/><circle cx="990" cy="1070" r="8"/><circle cx="1570" cy="1080" r="8"/><circle cx="2070" cy="1160" r="8"/></g>
    </svg>
    <div class="region region-a"></div><div class="region region-b"></div>
    <div class="region region-c"></div><div class="region region-d"></div>
    <div class="grain"></div>
  `;
}

function htmlDocument(body, css) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

function baseCss() {
  return `
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 2560px; height: 1600px; overflow: hidden; }
    body { font-family: "${FONT_FAMILY}", sans-serif; }
    .background { position: relative; width: 2560px; height: 1600px; overflow: hidden; background: #0b1115; color: #f2f7f6; }
    .topology { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .34; }
    .topology path { fill: none; stroke: #4fb4ad; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 3 18; }
    .topology path:nth-child(2), .topology path:nth-child(4) { stroke: #4d86b8; }
    .topology circle { fill: #77d3c7; opacity: .78; }
    .region { position: absolute; width: 530px; height: 310px; border: 1px solid rgba(108, 183, 178, .13); }
    .region::before { content: ""; position: absolute; inset: 24px; border: 1px solid rgba(88, 134, 174, .08); }
    .region-a { left: 210px; top: 250px; }
    .region-b { right: 210px; top: 250px; }
    .region-c { left: 210px; bottom: 220px; }
    .region-d { right: 210px; bottom: 220px; }
    .grain { position: absolute; inset: 0; opacity: .035; background-image: repeating-linear-gradient(0deg, transparent 0 4px, #d8ffff 5px); }
  `;
}

function overlayCss() {
  return `
    .transparent-layer { position: relative; width: 2560px; height: 1600px; color: #f5faf9; }
    .mode-label { position: absolute; top: 273px; width: 1120px; font-size: 54px; line-height: 1; font-weight: 600; letter-spacing: .01em; color: #dce9e7; }
    .mode-label::before { content: ""; display: inline-block; width: 28px; height: 4px; margin: 0 18px 12px 0; background: #5cc7bb; }
    .mode-label.left { left: 120px; }
    .mode-label.right { left: 1320px; }
    .mode-label.right::before { background: #5b94c7; }
    .mode-label.single { top: 20px; left: 320px; width: 1920px; font-size: 42px; text-align: center; }
    .mode-label.single.pane::before { background: #5b94c7; }
    .caption { position: absolute; left: 180px; right: 180px; bottom: 82px; min-height: 178px; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 106px; font-weight: 600; line-height: 1.24; letter-spacing: -.025em; color: #f5faf9; text-shadow: 0 2px 18px rgba(0, 0, 0, .75); }
    .caption.english { letter-spacing: -.035em; }
    .product-lockup { position: absolute; left: 0; right: 0; bottom: 74px; display: flex; align-items: center; justify-content: center; gap: 24px; color: #eff8f6; line-height: 1; }
    .product-icon { display: block; width: 72px; height: 72px; object-fit: contain; }
    .product-name { font-size: 64px; font-weight: 600; letter-spacing: -.035em; }
    .product-divider { width: 1px; height: 44px; background: rgba(142, 183, 180, .38); }
    .product-url { color: #9cb3b1; font-size: 34px; font-weight: 400; letter-spacing: -.01em; }
    .product-lockup.video { top: 10px; bottom: auto; height: 64px; gap: 18px; }
    .product-lockup.video .product-icon { width: 52px; height: 52px; }
    .product-lockup.video .product-name { font-size: 48px; }
    .product-lockup.video .product-divider { height: 36px; }
    .product-lockup.video .product-url { font-size: 29px; }
    .product-lockup.gif { top: 12px; bottom: auto; left: 80px; right: auto; height: 56px; justify-content: flex-start; gap: 12px; }
    .product-lockup.gif .product-icon { width: 40px; height: 40px; }
    .product-lockup.gif .product-name { font-size: 34px; }
    .product-lockup.gif .product-divider { height: 28px; }
    .product-lockup.gif .product-url { font-size: 21px; }
  `;
}

function heroCss() {
  return `
    .hero-brand { position: absolute; left: 120px; right: 120px; top: 48px; height: 82px; display: flex; align-items: center; justify-content: space-between; }
    .hero-brand-lockup { display: flex; align-items: center; gap: 20px; color: #eff8f6; }
    .hero-brand-icon { display: block; width: 64px; height: 64px; object-fit: contain; }
    .hero-brand-copy { display: flex; flex-direction: column; gap: 9px; }
    .hero-brand-name { font-size: 42px; line-height: 1; font-weight: 600; letter-spacing: -.03em; }
    .hero-brand-url { color: #8fa9a6; font-size: 27px; line-height: 1; font-weight: 400; letter-spacing: -.005em; }
    .hero-descriptor { color: #94aaa8; font-size: 28px; line-height: 1; font-weight: 400; letter-spacing: .01em; }
    .hero-headline { position: absolute; left: 120px; right: 120px; top: 190px; margin: 0; color: #f2f8f7; font-size: 84px; line-height: 1.08; font-weight: 600; letter-spacing: -.04em; }
    .hero.chinese .hero-headline { font-size: 80px; letter-spacing: -.02em; }
    .hero-mode { position: absolute; top: ${HERO_MODE_TOP}px; width: ${HERO_WINDOWS.left.width}px; color: #dce9e7; }
    .hero-mode.left { left: ${HERO_WINDOWS.left.x}px; }
    .hero-mode.right { left: ${HERO_WINDOWS.right.x}px; }
    .hero-mode h2 { margin: 0; font-size: 48px; line-height: 1; font-weight: 600; letter-spacing: -.015em; }
    .hero-mode h2::before { content: ""; display: inline-block; width: 28px; height: 4px; margin: 0 18px 11px 0; background: #5cc7bb; }
    .hero-mode.right h2::before { background: #5b94c7; }
    .hero-mode p { margin: 18px 0 0; color: #aabbb9; font-size: 32px; line-height: 1.2; font-weight: 400; letter-spacing: -.01em; white-space: nowrap; }
    .hero.chinese .hero-mode p { font-size: 35px; letter-spacing: 0; }
    .hero-window { position: absolute; top: ${HERO_WINDOWS.left.y}px; width: ${HERO_WINDOWS.left.width}px; height: ${HERO_WINDOWS.left.height}px; overflow: hidden; background: #11181d; border: 2px solid rgba(167, 207, 202, .32); box-shadow: 0 28px 80px rgba(0, 0, 0, .44); }
    .hero-window.left { left: ${HERO_WINDOWS.left.x}px; }
    .hero-window.right { left: ${HERO_WINDOWS.right.x}px; border-color: rgba(128, 175, 214, .34); }
    .hero-window img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .hero-center-rule { position: absolute; left: 1279px; top: ${HERO_MODE_TOP}px; width: 1px; height: ${HERO_WINDOWS.left.y + HERO_WINDOWS.left.height - HERO_MODE_TOP}px; background: rgba(129, 171, 178, .14); }
  `;
}

function storyboardCss() {
  return `
    .story-window { position: absolute; top: 360px; width: 1120px; height: 700px; overflow: hidden; background: #11181d; border: 2px solid rgba(167, 207, 202, .32); box-shadow: 0 28px 80px rgba(0, 0, 0, .44); }
    .story-window.left { left: 120px; }
    .story-window.right { left: 1320px; border-color: rgba(128, 175, 214, .34); }
    .story-window.single { top: 80px; left: 320px; width: 1920px; height: 1200px; }
    .story-window.single.pane { border-color: rgba(128, 175, 214, .34); }
    .story-window img { display: block; width: 100%; height: 100%; object-fit: cover; }
  `;
}

async function verifyFont(page) {
  await page.evaluate(async () => document.fonts.ready);
  const loaded = await page.evaluate((family) => document.fonts.check(`600 106px "${family}"`), FONT_FAMILY);
  const computedFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  if (!loaded || !computedFamily.includes(FONT_FAMILY)) {
    throw new Error(`Required font did not load: ${FONT_FAMILY}; computed=${computedFamily}`);
  }
  return { family: FONT_FAMILY, loaded, computedFamily, files: DEFAULT_FONT_PATHS };
}

function ensureFontFiles() {
  for (const [kind, fontPath] of Object.entries(DEFAULT_FONT_PATHS)) {
    if (!existsSync(fontPath)) {
      throw new Error(`Missing ${kind} ${FONT_FAMILY} font: ${fontPath}`);
    }
  }
}

function probeMedia(filePath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames:format=duration',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) {
    return undefined;
  }
  const parsed = JSON.parse(result.stdout || '{}');
  const stream = parsed.streams?.[0] ?? {};
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    frameCount: parseOptionalNumber(stream.nb_frames),
    durationSeconds: parseOptionalNumber(parsed.format?.duration)
  };
}

function runCommand(command, args, errorMessage, timeout) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n').slice(-6000);
    throw new Error(`${errorMessage}${detail ? `:\n${detail}` : ''}`);
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

async function fileToDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === '.svg'
    ? 'image/svg+xml'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : 'image/png';
  return `data:${mime};base64,${(await fs.readFile(filePath)).toString('base64')}`;
}

function escapeFfconcatPath(filePath) {
  return path.resolve(filePath).replace(/'/g, `'\\''`);
}

function resolveManifestPath(baseDir, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDir, value);
}

function parseOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function readManifest(manifestPath) {
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
}

function printUsage() {
  console.error('Usage:');
  console.error('  node scripts/media/compose-marketplace-media.mjs validate --manifest <path>');
  console.error('  node scripts/media/compose-marketplace-media.mjs render --manifest <path> --language en|zh-CN [--output-dir <path>]');
}

async function main(argv) {
  const [command, ...args] = argv;
  const manifestPath = readOption(args, '--manifest');
  if (!command || !manifestPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  const manifest = await readManifest(manifestPath);
  if (command === 'validate') {
    const result = await validateManifestSources(manifest, manifestPath);
    if (result.errors.length > 0) {
      throw new Error(`Invalid Marketplace media manifest:\n- ${result.errors.join('\n- ')}`);
    }
    console.log(`Manifest valid: ${manifest.frames.length} paired frames, ${EXPECTED_STORYBOARD_DURATION_MS / 1000}s GIF.`);
    return;
  }
  if (command === 'render') {
    const language = readOption(args, '--language');
    const outputDir = path.resolve(
      readOption(args, '--output-dir') ??
        path.join(process.cwd(), 'extensions', 'vscode', 'dev-session-canvas', 'images', 'marketplace')
    );
    const result = await renderMarketplaceMedia({ manifest, manifestPath, language, outputDir });
    if (!result.report.passed) {
      throw new Error(`Rendered assets failed validation: ${result.workDir}/validation-report.json`);
    }
    console.log(`Rendered ${language}: ${Object.values(result.output).join(', ')}`);
    console.log(`Validation report: ${result.workDir}/validation-report.json`);
    return;
  }
  printUsage();
  process.exitCode = 1;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
