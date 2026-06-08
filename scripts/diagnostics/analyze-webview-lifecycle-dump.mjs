#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXIT_CODE_OK = 0;
const EXIT_CODE_FINDING = 2;
const EXIT_CODE_ERROR = 1;

const SURFACE_LABELS = {
  panel: '面板',
  editor: '编辑区'
};

const PANEL_RESTORE_FLAGS = [
  ['consecutiveAttachRender', '连续 attach/render'],
  ['readyPromotionObserved', 'ready Webview promotion'],
  ['probeFailedAfterReady', 'ready 后 probe 失败'],
  ['missingReadyAfterRender', 'render 后缺失 ready'],
  ['missingBootstrapAckAfterReady', 'ready 后缺失 bootstrapAck']
];

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMainModule) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(`Webview lifecycle 离线诊断失败：${formatUnknownError(error)}`);
    process.exitCode = EXIT_CODE_ERROR;
  });
}

export async function main(args = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? ((text) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text) => process.stderr.write(`${text}\n`));

  try {
    const parsedArgs = parseArgs(args);
    if (parsedArgs.help) {
      stdout(`${formatUsage()}\n`);
      return EXIT_CODE_OK;
    }

    const analysis = await analyzeWebviewLifecycleDump(parsedArgs.dumpDir, {
      cwd: io.cwd ?? process.cwd()
    });
    stdout(formatWebviewLifecycleReport(analysis));
    return analysis.exitCode;
  } catch (error) {
    stderr(`Webview lifecycle 离线诊断失败：${formatUnknownError(error)}\n\n${formatUsage()}`);
    return EXIT_CODE_ERROR;
  }
}

export async function analyzeWebviewLifecycleDump(inputDir, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const dumpDir = await resolveDumpDirectory(inputDir, cwd);
  const loadedSummary = await loadWebviewLifecycleSummary(dumpDir);
  const summary = loadedSummary.summary;
  assertWebviewLifecycleSummary(summary, loadedSummary.sourcePath);

  const optionalFiles = await readSupplementalDumpFiles(dumpDir);
  const panelSurface = findSurfaceSummary(summary, 'panel');
  const blocking = isBlockingLifecycleSummary(summary);
  const keyFindings = buildKeyFindings(summary, panelSurface, optionalFiles);

  return {
    dumpDir,
    sourcePath: loadedSummary.sourcePath,
    sourceLabel: loadedSummary.sourceLabel,
    summary,
    supplemental: optionalFiles,
    panelSurface,
    keyFindings,
    exitCode: blocking ? EXIT_CODE_FINDING : EXIT_CODE_OK
  };
}

export function formatWebviewLifecycleReport(analysis) {
  const { summary, panelSurface, supplemental } = analysis;
  const panelRestore = isRecord(summary.panelRestore) ? summary.panelRestore : {};
  const lines = [
    'Webview lifecycle 离线诊断',
    `Dump：${analysis.dumpDir}`,
    `摘要来源：${analysis.sourceLabel}`,
    `整体状态：${formatStatus(summary.status)}`,
    `Panel restore 风险：${panelRestore.likelyAffected === true ? '是' : '否'}`,
    `退出码：${analysis.exitCode}`,
    ''
  ];

  lines.push('Panel restore 线索：');
  for (const [key, label] of PANEL_RESTORE_FLAGS) {
    lines.push(`- ${label}：${formatBoolean(panelRestore[key])}`);
  }
  lines.push(`- stale Webview 消息：${formatNumber(panelRestore.staleMessageIgnoredCount)}`);
  lines.push('');

  lines.push('Surface 摘要：');
  for (const surface of normalizeSurfaceSummaries(summary.surfaces)) {
    lines.push(...formatSurfaceSummary(surface));
  }

  const latestEvents = collectLatestEvents(summary, supplemental.diagnosticEvents);
  if (latestEvents.length > 0) {
    lines.push('');
    lines.push('最新 lifecycle 事件：');
    for (const event of latestEvents) {
      lines.push(`- ${event}`);
    }
  }

  if (analysis.keyFindings.length > 0) {
    lines.push('');
    lines.push('结论：');
    for (const finding of analysis.keyFindings) {
      lines.push(`- ${finding}`);
    }
  }

  if (panelSurface?.recommendedNextSteps?.length > 0) {
    lines.push('');
    lines.push('建议下一步：');
    for (const step of panelSurface.recommendedNextSteps.slice(0, 4)) {
      lines.push(`- ${step}`);
    }
  }

  if (supplemental.warnings.length > 0) {
    lines.push('');
    lines.push('补充文件读取警告：');
    for (const warning of supplemental.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs(args) {
  let dumpDir;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }
    if (dumpDir) {
      throw new Error('只能传入一个 dump 目录。');
    }
    dumpDir = arg;
  }

  return { dumpDir };
}

function formatUsage() {
  return [
    '用法：npm run diagnose:webview-lifecycle -- [dump-dir]',
    '',
    '如果省略 dump-dir，会自动分析 .debug/current-host-diagnostics/ 下最新的诊断目录。',
    '退出码：0 表示未发现阻塞性 lifecycle 线索；2 表示 blocked / initializing 或 Panel restore 高风险；1 表示输入或解析失败。'
  ].join('\n');
}

async function resolveDumpDirectory(inputDir, cwd) {
  if (inputDir) {
    return path.resolve(cwd, inputDir);
  }

  const diagnosticsRoot = path.join(cwd, '.debug', 'current-host-diagnostics');
  let entries;
  try {
    entries = await readdir(diagnosticsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('未传入 dump 目录，且 .debug/current-host-diagnostics 不存在。');
    }
    throw error;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidatePath = path.join(diagnosticsRoot, entry.name);
    const candidateStat = await stat(candidatePath);
    candidates.push({ path: candidatePath, name: entry.name, mtimeMs: candidateStat.mtimeMs });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
  if (!candidates[0]) {
    throw new Error('未传入 dump 目录，且 .debug/current-host-diagnostics 下没有可分析目录。');
  }

  return candidates[0].path;
}

async function loadWebviewLifecycleSummary(dumpDir) {
  const directPath = path.join(dumpDir, 'webview-lifecycle-summary.json');
  if (existsSync(directPath)) {
    return {
      sourcePath: directPath,
      sourceLabel: 'webview-lifecycle-summary.json',
      summary: await readJsonFile(directPath)
    };
  }

  const summaryPath = path.join(dumpDir, 'summary.json');
  const summary = await readJsonFile(summaryPath);
  if (!isRecord(summary.webviewLifecycle)) {
    throw new Error(`${summaryPath} 中没有 webviewLifecycle 摘要。`);
  }

  return {
    sourcePath: summaryPath,
    sourceLabel: 'summary.json.webviewLifecycle',
    summary: summary.webviewLifecycle
  };
}

async function readSupplementalDumpFiles(dumpDir) {
  const warnings = [];
  const [diagnosticEvents, hostMessages, panelProbe] = await Promise.all([
    readOptionalJsonFile(path.join(dumpDir, 'diagnostic-events.json'), warnings),
    readOptionalJsonFile(path.join(dumpDir, 'host-messages.json'), warnings),
    readOptionalJsonFile(path.join(dumpDir, 'panel-probe.json'), warnings)
  ]);

  return {
    diagnosticEvents: Array.isArray(diagnosticEvents) ? diagnosticEvents : undefined,
    hostMessages: Array.isArray(hostMessages) ? hostMessages : undefined,
    panelProbe: isRecord(panelProbe) ? panelProbe : undefined,
    warnings
  };
}

async function readOptionalJsonFile(filePath, warnings) {
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    warnings.push(`${path.basename(filePath)} 读取失败：${formatUnknownError(error)}`);
    return undefined;
  }
}

async function readJsonFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath} 不是有效 JSON：${formatUnknownError(error)}`);
  }
}

function assertWebviewLifecycleSummary(summary, sourcePath) {
  if (!isRecord(summary) || typeof summary.status !== 'string' || !Array.isArray(summary.surfaces)) {
    throw new Error(`${sourcePath} 不是有效的 Webview lifecycle 摘要。`);
  }
}

function isBlockingLifecycleSummary(summary) {
  const status = typeof summary.status === 'string' ? summary.status : 'unknown';
  const panelRestore = isRecord(summary.panelRestore) ? summary.panelRestore : {};
  return panelRestore.likelyAffected === true || status === 'blocked' || status === 'initializing';
}

function buildKeyFindings(summary, panelSurface, supplemental) {
  const panelRestore = isRecord(summary.panelRestore) ? summary.panelRestore : {};
  const findings = [];

  if (panelRestore.likelyAffected === true) {
    findings.push('这份 dump 仍像 Panel restore lifecycle 阻塞；优先保留现场并分享整个 dump 目录。');
  } else if (summary.status === 'blocked') {
    findings.push('当前 active surface lifecycle 处于 blocked，但摘要未把它归因为 Panel restore；需要继续看 surface issues。');
  } else if (summary.status === 'initializing') {
    findings.push('当前 active surface 仍在初始化；等待 2-3 秒后重新落盘可区分慢启动和卡死。');
  } else if (summary.status === 'attention') {
    findings.push('当前 lifecycle 可用但近期有 stale/promotion 等线索；若仍空白，应转向前端渲染或节点过滤排查。');
  } else if (summary.status === 'healthy') {
    findings.push('当前 lifecycle 健康；若用户仍看到空白，优先排查 Webview 前端渲染、节点过滤或样式层。');
  }

  if (panelSurface?.issues?.length > 0) {
    findings.push(`面板 surface 线索：${panelSurface.issues.slice(0, 3).join(' / ')}`);
  }

  if (supplemental.panelProbe?.error && !panelSurface?.probe?.error) {
    findings.push(`panel-probe.json 额外记录 probe 失败：${supplemental.panelProbe.error}`);
  }

  return findings;
}

function normalizeSurfaceSummaries(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function findSurfaceSummary(summary, surface) {
  return normalizeSurfaceSummaries(summary.surfaces).find((candidate) => candidate.surface === surface);
}

function formatSurfaceSummary(surface) {
  const label = SURFACE_LABELS[surface.surface] ?? surface.surface ?? '未知 surface';
  const probe = isRecord(surface.probe) ? surface.probe : {};
  const attachRenderBurst = isRecord(surface.attachRenderBurst) ? surface.attachRenderBurst : {};
  const hostMessages = isRecord(surface.hostMessages) ? surface.hostMessages : {};
  const events = isRecord(surface.events) ? surface.events : {};
  const lines = [
    `- ${label}：${formatStatus(surface.status)}；active=${formatBoolean(surface.active)} attached=${formatBoolean(surface.attached)} ready=${formatBoolean(surface.ready)} bootstrapAck=${formatBoolean(surface.bootstrapAck)} messageTarget=${surface.messageTarget ?? 'unknown'}`,
    `  probe=${formatProbe(probe)}；hostMessages bootstrap=${formatNumber(hostMessages.bootstrapCount)} stateUpdated=${formatNumber(hostMessages.stateUpdatedCount)} undelivered=${formatNumber(hostMessages.undeliveredCount)}`,
    `  attach/render burst=${formatBoolean(attachRenderBurst.detected)} count=${formatNumber(attachRenderBurst.eventCount)} windowMs=${formatOptional(attachRenderBurst.windowMs)}；stale=${formatNumber(events.staleMessageIgnored)} invalid=${formatNumber(events.invalidLifecycleIgnored)}`
  ];

  if (Array.isArray(surface.issues) && surface.issues.length > 0) {
    lines.push(`  issues=${surface.issues.slice(0, 4).join(' / ')}`);
  }

  return lines;
}

function formatProbe(probe) {
  if (typeof probe.error === 'string' && probe.error.length > 0) {
    return `失败(${probe.error})`;
  }
  if (probe.nodeCount !== undefined && probe.nodeCount !== null) {
    return `OK(nodeCount=${probe.nodeCount})`;
  }
  return '未采集';
}

function collectLatestEvents(summary, diagnosticEvents) {
  const events = [];
  for (const surface of normalizeSurfaceSummaries(summary.surfaces)) {
    if (!Array.isArray(surface.latestEvents)) {
      continue;
    }
    for (const event of surface.latestEvents.slice(-4)) {
      events.push(formatDiagnosticEvent(event));
    }
  }

  if (events.length > 0) {
    return events.slice(-8);
  }

  if (!Array.isArray(diagnosticEvents)) {
    return [];
  }

  return diagnosticEvents.slice(-8).map(formatDiagnosticEvent);
}

function formatDiagnosticEvent(event) {
  if (!isRecord(event)) {
    return String(event);
  }
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : 'unknown-time';
  const kind = typeof event.kind === 'string' ? event.kind : 'unknown-kind';
  const surface = isRecord(event.detail) && typeof event.detail.surface === 'string'
    ? ` surface=${event.detail.surface}`
    : '';
  return `${timestamp} ${kind}${surface}`;
}

function formatStatus(status) {
  return typeof status === 'string' && status.length > 0 ? status : 'unknown';
}

function formatBoolean(value) {
  if (value === true) {
    return '是';
  }
  if (value === false) {
    return '否';
  }
  return '未知';
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '未知';
}

function formatOptional(value) {
  return value === undefined || value === null ? '未知' : String(value);
}

function formatUnknownError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
