import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-session-history-'));

try {
  const outfile = path.join(tempDir, 'agentSessionHistory.cjs');

  await esbuild.build({
    entryPoints: [path.resolve('src/common/agentSessionHistory.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { listWorkspaceAgentSessionHistory } = require(outfile);

  const homeDir = path.join(tempDir, 'home');
  const workspaceRoot = path.join(tempDir, 'workspace');
  const nestedWorkspace = path.join(workspaceRoot, 'packages', 'feature-a');
  const collidingWorkspaceRoot = path.join(tempDir, 'workspace-collision', 'foo', 'bar');
  const collidingWorkspaceShadow = path.join(tempDir, 'workspace-collision', 'foo-bar');
  const outsideWorkspace = path.join(tempDir, 'outside');
  await mkdir(nestedWorkspace, { recursive: true });
  await mkdir(collidingWorkspaceRoot, { recursive: true });
  await mkdir(collidingWorkspaceShadow, { recursive: true });
  await mkdir(outsideWorkspace, { recursive: true });

  const codexTimestamp = Date.parse('2026-04-27T10:00:00.000Z');
  const codexDuplicateMtime = new Date('2026-04-27T10:20:00.000Z');
  const codexInitialMtime = new Date('2026-04-27T10:05:00.000Z');
  await writeCodexSessionFile({
    homeDir,
    sessionId: 'codex-session-shared',
    cwd: workspaceRoot,
    timestampMs: codexTimestamp,
    fileSuffix: 'first',
    userMessages: [
      '# AGENTS.md instructions for /tmp/workspace\n\n<INSTRUCTIONS>\n...</INSTRUCTIONS>',
      '请实现共享 codex 会话标题'
    ]
  });
  await utimes(
    path.join(homeDir, '.codex', 'sessions', '2026', '04', '27', 'rollout-codex-session-shared-first.jsonl'),
    codexInitialMtime,
    codexInitialMtime
  );
  await writeCodexSessionFile({
    homeDir,
    sessionId: 'codex-session-shared',
    cwd: workspaceRoot,
    timestampMs: codexTimestamp,
    fileSuffix: 'second',
    userMessages: ['请实现共享 codex 会话标题']
  });
  await utimes(
    path.join(homeDir, '.codex', 'sessions', '2026', '04', '27', 'rollout-codex-session-shared-second.jsonl'),
    codexDuplicateMtime,
    codexDuplicateMtime
  );
  await writeCodexSessionFile({
    homeDir,
    sessionId: 'codex-session-outside',
    cwd: outsideWorkspace,
    timestampMs: Date.parse('2026-04-27T11:00:00.000Z'),
    fileSuffix: 'outside',
    userMessages: ['这个工作区外的会话不应被读取']
  });

  const claudeRootSessionPath = await writeClaudeSessionFile({
    homeDir,
    cwd: workspaceRoot,
    sessionId: 'claude-session-root',
    lines: [
      { type: 'progress' },
      { type: 'progress', cwd: workspaceRoot },
      {
        type: 'user',
        message: {
          role: 'user',
          content: '[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]'
        }
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: '写一首打油诗'
        }
      }
    ]
  });
  const claudeRootMtime = new Date('2026-04-27T10:40:00.000Z');
  await utimes(claudeRootSessionPath, claudeRootMtime, claudeRootMtime);

  const claudeNestedSessionPath = await writeClaudeSessionFile({
    homeDir,
    cwd: nestedWorkspace,
    sessionId: 'claude-session-nested',
    lines: [
      {
        type: 'progress',
        cwd: nestedWorkspace
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: '检查 feature-a 的历史会话'
        }
      }
    ]
  });
  const claudeNestedMtime = new Date('2026-04-27T10:30:00.000Z');
  await utimes(claudeNestedSessionPath, claudeNestedMtime, claudeNestedMtime);

  await writeClaudeSessionFile({
    homeDir,
    cwd: outsideWorkspace,
    sessionId: 'claude-session-outside',
    lines: [
      {
        type: 'progress',
        cwd: outsideWorkspace
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: '这个工作区外的 Claude 会话不应被读取'
        }
      }
    ]
  });

  await writeClaudeSessionFile({
    homeDir,
    cwd: collidingWorkspaceShadow,
    sessionId: 'claude-session-shadow-without-cwd',
    lines: [
      {
        type: 'progress'
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: '这个缺少 cwd 的冲突目录会话不应泄漏到别的 workspace'
        }
      }
    ]
  });

  await writeClaudeSessionFile({
    homeDir,
    cwd: collidingWorkspaceRoot,
    sessionId: 'claude-session-collision-root',
    lines: [
      {
        type: 'progress',
        cwd: collidingWorkspaceRoot
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: '这个带 cwd 的冲突目录会话应保留在当前 workspace'
        }
      }
    ]
  });

  const entries = await listWorkspaceAgentSessionHistory({
    workspaceRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir
    }
  });

  assert.deepEqual(
    entries.map((entry) => `${entry.provider}:${entry.sessionId}`),
    [
      'claude:claude-session-root',
      'claude:claude-session-nested',
      'codex:codex-session-shared'
    ]
  );

  const codexEntry = entries.find((entry) => entry.provider === 'codex');
  assert.ok(codexEntry, 'Expected a workspace-scoped Codex session.');
  assert.equal(codexEntry.cwd, workspaceRoot);
  assert.equal(codexEntry.createdAtMs, codexTimestamp);
  assert.equal(codexEntry.updatedAtMs, Math.round(codexDuplicateMtime.getTime()));
  assert.equal(codexEntry.firstUserInstruction, '请实现共享 codex 会话标题');

  const claudeRootEntry = entries.find((entry) => entry.sessionId === 'claude-session-root');
  assert.ok(claudeRootEntry, 'Expected the workspace-root Claude session to be included via transcript cwd discovery.');
  assert.equal(claudeRootEntry.cwd, workspaceRoot);
  assert.equal(claudeRootEntry.firstUserInstruction, '写一首打油诗');

  const claudeNestedEntry = entries.find((entry) => entry.sessionId === 'claude-session-nested');
  assert.ok(claudeNestedEntry, 'Expected the nested Claude session to be included via explicit cwd.');
  assert.equal(claudeNestedEntry.cwd, nestedWorkspace);
  assert.equal(claudeNestedEntry.firstUserInstruction, '检查 feature-a 的历史会话');

  const bundledSidebarModule = path.join(tempDir, 'sidebarSessionHistoryView.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/sidebar/CanvasSidebarSessionHistoryView.ts')],
    bundle: true,
    format: 'cjs',
    outfile: bundledSidebarModule,
    platform: 'node',
    target: 'node18',
    external: ['vscode']
  });
  const vscodeStubDir = path.join(tempDir, 'node_modules', 'vscode');
  await mkdir(vscodeStubDir, { recursive: true });
  await writeFile(path.join(vscodeStubDir, 'index.js'), 'module.exports = {};', 'utf8');
  const { buildCanvasSidebarSessionHistoryItems, buildSidebarSessionHistoryHtml } = require(bundledSidebarModule);
  const multiRootWorkspaceFolders = [
    { name: 'main-root', path: workspaceRoot },
    { name: 'feature-a', path: nestedWorkspace }
  ];
  const sidebarItems = buildCanvasSidebarSessionHistoryItems(entries, workspaceRoot);
  const multiRootSidebarItems = buildCanvasSidebarSessionHistoryItems(entries, multiRootWorkspaceFolders);
  const multiRootNestedSidebarItem = multiRootSidebarItems.find((entry) => entry.sessionId === 'claude-session-nested');
  assert.equal(
    multiRootNestedSidebarItem?.workspaceRootLabel,
    'feature-a',
    'Expected multi-root session history items to use the deepest matching workspace root label.'
  );
  assert.ok(
    multiRootNestedSidebarItem?.tooltip.includes('Root：feature-a'),
    'Expected multi-root session history tooltip to include the matched workspace root label.'
  );
  const claudeRootSidebarItem = sidebarItems.find((entry) => entry.sessionId === 'claude-session-root');
  assert.ok(claudeRootSidebarItem, 'Expected the sidebar session history builder to include the Claude root entry.');
  assert.ok(
    claudeRootSidebarItem.tooltip.includes('目录：工作区根目录/'),
    'Expected root session history tooltip cwd to include a POSIX directory suffix.'
  );
  assert.ok(
    claudeRootSidebarItem.searchText.includes('写一首打油诗'),
    'Expected sidebar session history search text to include the displayed session title.'
  );
  const claudeNestedSidebarItem = sidebarItems.find((entry) => entry.sessionId === 'claude-session-nested');
  assert.ok(claudeNestedSidebarItem, 'Expected the sidebar session history builder to include the nested Claude entry.');
  assert.ok(
    claudeNestedSidebarItem.tooltip.includes('目录：packages/feature-a/'),
    'Expected nested session history tooltip cwd to use POSIX separators and a directory suffix.'
  );
  const windowsSidebarItem = buildCanvasSidebarSessionHistoryItems(
    [
      {
        provider: 'codex',
        sessionId: 'codex-session-windows-cwd',
        cwd: 'C:\\workspace\\packages\\feature-a',
        createdAtMs: codexTimestamp,
        updatedAtMs: codexTimestamp,
        firstUserInstruction: '检查 Windows 原生 cwd 展示'
      }
    ],
    'C:\\workspace'
  )[0];
  assert.ok(
    windowsSidebarItem?.tooltip.includes('目录：packages\\feature-a\\'),
    'Expected Windows session history tooltip cwd to use native separators and a directory suffix.'
  );
  const slashStyleNetworkSidebarItem = buildCanvasSidebarSessionHistoryItems(
    [
      {
        provider: 'claude',
        sessionId: 'claude-session-slash-style-network-cwd',
        cwd: '//server/share/workspace/packages/feature-a',
        createdAtMs: codexTimestamp,
        updatedAtMs: codexTimestamp,
        firstUserInstruction: '检查 slash-style network cwd 展示'
      }
    ],
    '//server/share/workspace'
  )[0];
  assert.ok(
    slashStyleNetworkSidebarItem?.tooltip.includes('目录：packages/feature-a/'),
    'Expected slash-style network session history tooltip cwd to preserve slash separators and a directory suffix.'
  );
  const backslashUncSidebarItem = buildCanvasSidebarSessionHistoryItems(
    [
      {
        provider: 'codex',
        sessionId: 'codex-session-backslash-unc-cwd',
        cwd: '\\\\server\\share\\workspace\\packages\\feature-a',
        createdAtMs: codexTimestamp,
        updatedAtMs: codexTimestamp,
        firstUserInstruction: '检查反斜杠 UNC cwd 展示'
      }
    ],
    '\\\\server\\share\\workspace'
  )[0];
  assert.ok(
    backslashUncSidebarItem?.tooltip.includes('目录：packages\\feature-a\\'),
    'Expected backslash UNC session history tooltip cwd to preserve backslash separators and a directory suffix.'
  );
  const longerInstructionWithinLimit = 'long-session-title-segment-'.repeat(5);
  const longerInstructionSidebarItem = buildCanvasSidebarSessionHistoryItems(
    [
      {
        provider: 'codex',
        sessionId: 'codex-session-long-title',
        cwd: workspaceRoot,
        createdAtMs: codexTimestamp,
        updatedAtMs: codexTimestamp,
        firstUserInstruction: longerInstructionWithinLimit
      }
    ],
    workspaceRoot
  )[0];
  assert.equal(
    longerInstructionSidebarItem?.title,
    longerInstructionWithinLimit,
    'Expected session history titles longer than the old cutoff to remain intact before the new cap.'
  );
  const veryLongInstruction = 'very-long-session-title-segment-'.repeat(9);
  const veryLongInstructionSidebarItem = buildCanvasSidebarSessionHistoryItems(
    [
      {
        provider: 'claude',
        sessionId: 'claude-session-very-long-title',
        cwd: workspaceRoot,
        createdAtMs: codexTimestamp,
        updatedAtMs: codexTimestamp,
        firstUserInstruction: veryLongInstruction
      }
    ],
    workspaceRoot
  )[0];
  assert.equal(veryLongInstructionSidebarItem?.title.length, 256);
  assert.ok(
    veryLongInstructionSidebarItem?.title.endsWith('…'),
    'Expected extremely long session history titles to stay bounded with an ellipsis.'
  );

  const sidebarHtml = buildSidebarSessionHistoryHtml({ cspSource: 'vscode-resource:' });
  const browser = await chromium.launch({ headless: true });
  try {
    await assertSessionHistoryActionButtons(browser, sidebarHtml);
    await assertSessionHistoryGrouping(browser, sidebarHtml);
  } finally {
    await browser.close();
  }

  const limitedEntries = await listWorkspaceAgentSessionHistory({
    workspaceRoot,
    maxEntries: 2,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir
    }
  });
  assert.equal(limitedEntries.length, 2);
  assert.deepEqual(
    limitedEntries.map((entry) => `${entry.provider}:${entry.sessionId}`),
    ['claude:claude-session-root', 'claude:claude-session-nested']
  );

  const collidingEntries = await listWorkspaceAgentSessionHistory({
    workspaceRoot: collidingWorkspaceRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir
    }
  });
  assert.deepEqual(
    collidingEntries.map((entry) => `${entry.provider}:${entry.sessionId}`),
    ['claude:claude-session-collision-root']
  );
  assert.equal(collidingEntries[0]?.cwd, collidingWorkspaceRoot);
  assert.equal(
    collidingEntries[0]?.firstUserInstruction,
    '这个带 cwd 的冲突目录会话应保留在当前 workspace'
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function assertSessionHistoryActionButtons(browser, html) {
  const page = await createSidebarHistoryPage(browser, html);
  try {
    const item = {
      id: 'codex:history-action-session',
      provider: 'codex',
      providerLabel: 'Codex',
      sessionId: 'history-action-session',
      title: '历史 action 按钮回归',
      timestampLabel: 'Codex · 刚刚 · history-action-session',
      tooltip: '历史 action 按钮回归',
      searchText: '历史 action 按钮回归 codex history-action-session'
    };
    await renderSidebarHistoryState(page, { items: [item] });

    const buttons = await page.evaluate(() => {
      const row = document.querySelector('[data-session-history-item-id="codex:history-action-session"]');
      return Array.from(row?.querySelectorAll('[data-session-history-action]') ?? []).map((button) => ({
        action: button.getAttribute('data-session-history-action'),
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        iconClassName: button.querySelector('.session-action-icon')?.className ?? ''
      }));
    });
    assert.deepEqual(
      buttons.map((button) => button.action),
      ['resume', 'fork'],
      'Expected each sidebar session history row to render resume and fork action buttons.'
    );
    for (const button of buttons) {
      assert.match(button.ariaLabel ?? '', /历史会话/u, 'Expected icon-only session actions to expose an accessible label.');
      assert.match(button.title ?? '', /历史会话/u, 'Expected icon-only session actions to expose a title tooltip.');
      assert.ok(button.width >= 24 && button.height >= 24, 'Expected session action buttons to keep at least a 24px hit target.');
      assert.match(button.iconClassName, /\bcodicon\b/u, 'Expected session action buttons to use VSCode Codicon icons.');
    }
    assert.match(buttons[0]?.iconClassName ?? '', /\bcodicon-history\b/u, 'Expected the resume action to use a Codicon history icon.');
    assert.match(buttons[1]?.iconClassName ?? '', /\bcodicon-repo-forked\b/u, 'Expected the fork action to use a Codicon fork icon.');

    await page.click('[data-session-history-action="resume"]');
    await page.click('[data-session-history-action="fork"]');
    await page.dblclick('[data-session-history-item-id="codex:history-action-session"]');

    const postedMessages = await page.evaluate(() => window.__sidebarSessionHistoryMessages);
    assert.deepEqual(
      postedMessages.filter((message) => message.type !== 'sidebarSessionHistory/ready').map((message) => message.type),
      [
        'sidebarSessionHistory/openSession',
        'sidebarSessionHistory/forkSession',
        'sidebarSessionHistory/openSession'
      ],
      'Expected action buttons to post explicit resume/fork messages while row double-click keeps the existing resume action.'
    );
    assert.deepEqual(
      postedMessages
        .filter((message) => message.type === 'sidebarSessionHistory/openSession' || message.type === 'sidebarSessionHistory/forkSession')
        .map((message) => message.payload?.sessionId),
      ['history-action-session', 'history-action-session', 'history-action-session']
    );
  } finally {
    await page.close();
  }
}

async function assertSessionHistoryGrouping(browser, html) {
  const page = await createSidebarHistoryPage(browser, html);
  const now = Date.now();
  try {
    const items = [
      createSidebarHistoryTestItem({
        provider: 'codex',
        sessionId: 'codex-main-recent',
        title: 'main recent codex',
        updatedAtMs: now - 60 * 60 * 1000,
        workspaceRootLabel: 'main-root',
        workspaceRootPath: '/workspace/main'
      }),
      createSidebarHistoryTestItem({
        provider: 'claude',
        sessionId: 'claude-feature-week',
        title: 'feature week claude',
        updatedAtMs: now - 3 * 24 * 60 * 60 * 1000,
        workspaceRootLabel: 'feature-root',
        workspaceRootPath: '/workspace/feature'
      }),
      createSidebarHistoryTestItem({
        provider: 'codex',
        sessionId: 'codex-feature-older',
        title: 'feature older codex',
        updatedAtMs: now - 10 * 24 * 60 * 60 * 1000,
        workspaceRootLabel: 'feature-root',
        workspaceRootPath: '/workspace/feature'
      })
    ];

    await renderSidebarHistoryState(page, {
      items,
      workspaceRootCount: 2,
      grouping: {
        groupByWorkspaceRoot: true,
        groupByProvider: true,
        groupByTime: true
      }
    });

    const groupRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-session-history-group-key]')).map((row) => ({
        key: row.getAttribute('data-session-history-group-key'),
        label: row.getAttribute('data-session-history-group-label'),
        expanded: row.getAttribute('aria-expanded') === 'true',
        role: row.getAttribute('role'),
        twistieClassName: row.querySelector('.session-group-twistie')?.className ?? '',
        depth: Number(row.getAttribute('data-session-history-group-depth'))
      }))
    );
    assert.deepEqual(
      groupRows.map((row) => `${row.depth}:${row.label}`),
      [
        '0:main-root',
        '1:Codex',
        '2:24小时内',
        '0:feature-root',
        '1:Claude Code',
        '2:一周内',
        '1:Codex',
        '2:更早'
      ],
      'Expected multi-selected session history grouping to render in root > provider > time order.'
    );
    assert.ok(
      groupRows.every((row) => row.role === 'treeitem' && row.expanded && row.twistieClassName.includes('codicon-chevron-down')),
      'Expected session history group headers to render as expanded collapsible tree rows.'
    );

    const featureRootGroup = groupRows.find((row) => row.label === 'feature-root');
    assert.ok(featureRootGroup?.key, 'Expected feature root session history group to expose a stable group key.');
    await page.click(`[data-session-history-group-key="${featureRootGroup.key}"]`);
    const collapsedSnapshot = await page.evaluate((groupKey) => ({
      visibleItemIds: Array.from(document.querySelectorAll('[data-session-history-item-id]'))
        .map((row) => row.getAttribute('data-session-history-item-id'))
        .filter(Boolean),
      featureRootExpanded:
        document.querySelector(`[data-session-history-group-key="${CSS.escape(groupKey)}"]`)
          ?.getAttribute('aria-expanded'),
      featureRootTwistieClassName:
        document.querySelector(`[data-session-history-group-key="${CSS.escape(groupKey)}"] .session-group-twistie`)
          ?.className ?? ''
    }), featureRootGroup.key);
    assert.equal(collapsedSnapshot.featureRootExpanded, 'false');
    assert.match(collapsedSnapshot.featureRootTwistieClassName, /\bcodicon-chevron-right\b/u);
    assert.deepEqual(
      collapsedSnapshot.visibleItemIds,
      ['codex:codex-main-recent'],
      'Expected collapsing a session history group to hide all descendant session rows.'
    );
    await page.click(`[data-session-history-group-key="${featureRootGroup.key}"]`);

    await renderSidebarHistoryState(page, {
      items,
      workspaceRootCount: 1,
      grouping: {
        groupByWorkspaceRoot: true,
        groupByProvider: true,
        groupByTime: false
      }
    });

    const singleRootGroupRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-session-history-group-key]')).map((row) => ({
        label: row.getAttribute('data-session-history-group-label'),
        depth: Number(row.getAttribute('data-session-history-group-depth'))
      }))
    );
    assert.deepEqual(
      singleRootGroupRows.map((row) => `${row.depth}:${row.label}`),
      ['0:Codex', '0:Claude Code'],
      'Expected workspace-root grouping to stay visually inactive in a single-root workspace.'
    );
  } finally {
    await page.close();
  }
}

function createSidebarHistoryTestItem({ provider, sessionId, title, updatedAtMs, workspaceRootLabel, workspaceRootPath }) {
  const providerLabel = provider === 'claude' ? 'Claude Code' : 'Codex';
  return {
    id: `${provider}:${sessionId}`,
    provider,
    providerLabel,
    sessionId,
    title,
    updatedAtMs,
    timestampLabel: `${providerLabel} · 刚刚 · ${sessionId}`,
    workspaceRootLabel,
    workspaceRootPath,
    tooltip: title,
    searchText: [title, provider, providerLabel, sessionId, workspaceRootLabel, workspaceRootPath].join(' ').toLowerCase()
  };
}

async function createSidebarHistoryPage(browser, html) {
  const page = await browser.newPage({ viewport: { width: 320, height: 600 } });
  const testHtml = html.replace(
    'const vscode = acquireVsCodeApi();',
    `
      window.__sidebarSessionHistoryMessages = [];
      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          window.__sidebarSessionHistoryMessages.push(message);
        }
      });
      const vscode = acquireVsCodeApi();`
  );
  await page.setContent(testHtml, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    window.__sidebarSessionHistoryMessages.some((message) => message.type === 'sidebarSessionHistory/ready')
  );
  return page;
}

async function renderSidebarHistoryState(page, payload) {
  await page.evaluate((nextPayload) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'sidebarSessionHistory/state',
        payload: nextPayload
      }
    }));
  }, payload);
  await page.waitForFunction(() => document.querySelectorAll('[data-session-history-item-id]').length > 0);
}

async function writeCodexSessionFile({ homeDir, sessionId, cwd, timestampMs, fileSuffix, userMessages = [] }) {
  const [year, month, day] = toDateDirectoryParts(timestampMs);
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', year, month, day);
  await mkdir(sessionsDir, { recursive: true });
  const timestamp = new Date(timestampMs).toISOString();
  const payload = {
    timestamp,
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp,
      cwd,
      originator: 'session-history-test'
    }
  };

  const lines = [JSON.stringify(payload)];
  for (const message of userMessages) {
    lines.push(
      JSON.stringify({
        timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: message
            }
          ]
        }
      })
    );
  }

  await writeFile(path.join(sessionsDir, `rollout-${sessionId}-${fileSuffix}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
}

async function writeClaudeSessionFile({ homeDir, cwd, sessionId, lines }) {
  const projectDir = path.join(homeDir, '.claude', 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]+/g, '-'));
  await mkdir(projectDir, { recursive: true });
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return filePath;
}

function toDateDirectoryParts(timestampMs) {
  const date = new Date(timestampMs);
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ];
}
