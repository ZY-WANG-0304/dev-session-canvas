import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  const { buildCanvasSidebarSessionHistoryItems } = require(bundledSidebarModule);
  const sidebarItems = buildCanvasSidebarSessionHistoryItems(entries, workspaceRoot);
  const claudeRootSidebarItem = sidebarItems.find((entry) => entry.sessionId === 'claude-session-root');
  assert.ok(claudeRootSidebarItem, 'Expected the sidebar session history builder to include the Claude root entry.');
  assert.ok(
    claudeRootSidebarItem.searchText.includes('写一首打油诗'),
    'Expected sidebar session history search text to include the displayed session title.'
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
