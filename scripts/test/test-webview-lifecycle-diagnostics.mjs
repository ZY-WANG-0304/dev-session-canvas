import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  analyzeWebviewLifecycleDump,
  formatWebviewLifecycleReport,
  main as runWebviewLifecycleDiagnosticsCli
} from '../diagnostics/analyze-webview-lifecycle-dump.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-webview-lifecycle-diagnostics-'));
const scriptPath = path.resolve('scripts/diagnostics/analyze-webview-lifecycle-dump.mjs');

try {
  const healthyDir = path.join(tempDir, 'healthy');
  await writeDump(healthyDir, createLifecycleSummary({
    status: 'healthy',
    panelStatus: 'healthy',
    panelReady: true,
    panelBootstrapAck: true,
    panelNodeCount: 5
  }));

  const healthyAnalysis = await analyzeWebviewLifecycleDump(healthyDir);
  assert.equal(healthyAnalysis.exitCode, 0);
  const healthyReport = formatWebviewLifecycleReport(healthyAnalysis);
  assert.match(healthyReport, /整体状态：healthy/u);
  assert.match(healthyReport, /Panel restore 风险：否/u);
  assert.match(healthyReport, /面板：healthy/u);

  const blockedDir = path.join(tempDir, 'blocked');
  await writeDump(blockedDir, createLifecycleSummary({
    status: 'blocked',
    panelStatus: 'blocked',
    panelReady: false,
    panelBootstrapAck: false,
    panelRestoreLikelyAffected: true,
    consecutiveAttachRender: true,
    missingReadyAfterRender: true,
    staleMessageIgnoredCount: 2,
    panelIssues: [
      '面板 active Webview 已渲染但尚未 ready。',
      '面板 近期 12ms 内出现 4 次 attach/render。',
      '面板 已忽略 2 条 stale Webview 消息。'
    ]
  }));

  const blockedAnalysis = await analyzeWebviewLifecycleDump(blockedDir);
  assert.equal(blockedAnalysis.exitCode, 2);
  const blockedReport = formatWebviewLifecycleReport(blockedAnalysis);
  assert.match(blockedReport, /Panel restore 风险：是/u);
  assert.match(blockedReport, /render 后缺失 ready：是/u);
  assert.match(blockedReport, /面板：blocked/u);
  assert.match(blockedReport, /仍像 Panel restore lifecycle 阻塞/u);

  const blockedCli = spawnSync(process.execPath, [scriptPath, blockedDir], {
    encoding: 'utf8'
  });
  assert.equal(blockedCli.status, 2, blockedCli.stderr || blockedCli.stdout);
  assert.match(blockedCli.stdout, /摘要来源：webview-lifecycle-summary\.json/u);
  assert.match(blockedCli.stdout, /退出码：2/u);

  const fallbackDir = path.join(tempDir, 'fallback');
  await mkdir(fallbackDir, { recursive: true });
  await writeFile(
    path.join(fallbackDir, 'summary.json'),
    `${JSON.stringify({ webviewLifecycle: createLifecycleSummary({ status: 'attention', panelStatus: 'attention' }) }, null, 2)}\n`,
    'utf8'
  );
  const fallbackAnalysis = await analyzeWebviewLifecycleDump(fallbackDir);
  assert.equal(fallbackAnalysis.sourceLabel, 'summary.json.webviewLifecycle');
  assert.equal(fallbackAnalysis.exitCode, 0);
  assert.match(formatWebviewLifecycleReport(fallbackAnalysis), /摘要来源：summary\.json\.webviewLifecycle/u);

  const missingDir = path.join(tempDir, 'missing');
  await mkdir(missingDir, { recursive: true });
  const missingCliCode = await runWebviewLifecycleDiagnosticsCli([missingDir], {
    stdout: () => {},
    stderr: () => {}
  });
  assert.equal(missingCliCode, 1);

  const latestRoot = path.join(tempDir, 'project');
  const latestDumpDir = path.join(latestRoot, '.debug', 'current-host-diagnostics', '2026-06-08T12-00-00-000Z');
  await writeDump(latestDumpDir, createLifecycleSummary({ status: 'healthy', panelStatus: 'healthy' }));
  const defaultAnalysis = await analyzeWebviewLifecycleDump(undefined, { cwd: latestRoot });
  assert.equal(defaultAnalysis.dumpDir, latestDumpDir);

  console.log('webview lifecycle diagnostics tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function writeDump(dumpDir, lifecycleSummary) {
  await mkdir(dumpDir, { recursive: true });
  await writeFile(
    path.join(dumpDir, 'webview-lifecycle-summary.json'),
    `${JSON.stringify(lifecycleSummary, null, 2)}\n`,
    'utf8'
  );
  await writeFile(
    path.join(dumpDir, 'diagnostic-events.json'),
    `${JSON.stringify(lifecycleSummary.surfaces.flatMap((surface) => surface.latestEvents), null, 2)}\n`,
    'utf8'
  );
  await writeFile(path.join(dumpDir, 'host-messages.json'), '[]\n', 'utf8');
  await writeFile(
    path.join(dumpDir, 'panel-probe.json'),
    `${JSON.stringify(lifecycleSummary.surfaces[0].probe, null, 2)}\n`,
    'utf8'
  );
}

function createLifecycleSummary(options = {}) {
  const panelIssues = options.panelIssues ?? [];
  const panelStatus = options.panelStatus ?? options.status ?? 'healthy';
  const panelReady = options.panelReady ?? true;
  const panelBootstrapAck = options.panelBootstrapAck ?? true;
  const consecutiveAttachRender = options.consecutiveAttachRender ?? false;
  const staleMessageIgnoredCount = options.staleMessageIgnoredCount ?? 0;
  const missingReadyAfterRender = options.missingReadyAfterRender ?? false;
  return {
    capturedAt: '2026-06-08T12:00:00.000Z',
    activeSurface: 'panel',
    status: options.status ?? panelStatus,
    panelRestore: {
      likelyAffected: options.panelRestoreLikelyAffected ?? false,
      consecutiveAttachRender,
      readyPromotionObserved: false,
      staleMessageIgnoredCount,
      probeFailedAfterReady: false,
      missingReadyAfterRender,
      missingBootstrapAckAfterReady: panelReady && !panelBootstrapAck
    },
    surfaces: [
      {
        surface: 'panel',
        active: true,
        attached: true,
        visibility: 'visible',
        interactive: true,
        ready: panelReady,
        lifecycle: {
          surface: 'panel',
          mode: 'active',
          generation: 4,
          frameId: 'frame-panel'
        },
        bootstrapAck: panelBootstrapAck,
        messageTarget: 'explicit',
        pendingBootstrapHostMessageCount: 0,
        hostMessages: {
          bootstrapCount: panelReady ? 1 : 0,
          stateUpdatedCount: panelReady && panelBootstrapAck ? 2 : 0,
          visibilityRestoredCount: 0,
          deliveredCount: panelReady ? 3 : 0,
          undeliveredCount: 0
        },
        events: {
          attached: consecutiveAttachRender ? 2 : 1,
          rendered: consecutiveAttachRender ? 2 : 1,
          messageWebviewBound: 1,
          ready: panelReady ? 1 : 0,
          readyWebviewPromoted: 0,
          bootstrapAck: panelBootstrapAck ? 1 : 0,
          hostMessageQueuedUntilBootstrapAck: 0,
          staleMessageIgnored: staleMessageIgnoredCount,
          staleProbeResultIgnored: 0,
          staleDomActionResultIgnored: 0,
          invalidLifecycleIgnored: 0,
          runtimeDiagnostic: 0,
          executionPerformanceDiagnostic: 0
        },
        attachRenderBurst: {
          detected: consecutiveAttachRender,
          eventCount: consecutiveAttachRender ? 4 : 2,
          windowMs: consecutiveAttachRender ? 12 : 0,
          latestTimestamp: '2026-06-08T12:00:00.012Z'
        },
        latestEvents: [
          {
            timestamp: '2026-06-08T12:00:00.000Z',
            kind: 'surface/rendered',
            detail: { surface: 'panel' }
          },
          {
            timestamp: '2026-06-08T12:00:00.012Z',
            kind: panelReady ? 'surface/ready' : 'webview/staleMessageIgnored',
            detail: { surface: 'panel' }
          }
        ],
        probe: {
          attached: true,
          ready: panelReady,
          interactive: true,
          visibility: 'visible',
          capturedAt: '2026-06-08T12:00:01.000Z',
          nodeCount: options.panelNodeCount ?? null
        },
        status: panelStatus,
        issues: panelIssues,
        recommendedNextSteps: panelStatus === 'blocked'
          ? ['保持面板空白现场，不要切换承载面；直接分享本次 dump 目录。']
          : ['面板 lifecycle 当前健康；如果用户仍看到空白，优先排查前端渲染或节点过滤。']
      },
      {
        surface: 'editor',
        active: false,
        attached: false,
        visibility: 'closed',
        interactive: false,
        ready: false,
        bootstrapAck: false,
        messageTarget: 'missing',
        pendingBootstrapHostMessageCount: 0,
        hostMessages: {
          bootstrapCount: 0,
          stateUpdatedCount: 0,
          visibilityRestoredCount: 0,
          deliveredCount: 0,
          undeliveredCount: 0
        },
        events: {
          attached: 0,
          rendered: 0,
          messageWebviewBound: 0,
          ready: 0,
          readyWebviewPromoted: 0,
          bootstrapAck: 0,
          hostMessageQueuedUntilBootstrapAck: 0,
          staleMessageIgnored: 0,
          staleProbeResultIgnored: 0,
          staleDomActionResultIgnored: 0,
          invalidLifecycleIgnored: 0,
          runtimeDiagnostic: 0,
          executionPerformanceDiagnostic: 0
        },
        attachRenderBurst: {
          detected: false,
          eventCount: 0
        },
        latestEvents: [],
        probe: {
          attached: false,
          ready: false,
          interactive: false,
          visibility: 'closed',
          nodeCount: null
        },
        status: 'not-attached',
        issues: ['编辑区 Webview 当前未 attached。'],
        recommendedNextSteps: ['编辑区 Webview 当前未 attached；如需验证它，请先打开对应画布承载面。']
      }
    ]
  };
}
