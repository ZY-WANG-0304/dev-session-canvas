import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { expect, test } from '@playwright/test';

const harnessUrl = pathToFileURL(
  path.join(process.cwd(), 'tests', 'playwright', 'harness', 'webview-harness.html')
).href;

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }

  const diagnostics = await page
    .evaluate(() => {
      const harness = window.__devSessionCanvasHarness;
      if (!harness) {
        return null;
      }

      return {
        postedMessages: harness.getPostedMessages(),
        persistedState: harness.getPersistedState()
      };
    })
    .catch(() => null);

  if (!diagnostics) {
    return;
  }

  await fs.writeFile(
    testInfo.outputPath('harness-posted-messages.json'),
    `${JSON.stringify(diagnostics.postedMessages, null, 2)}\n`,
    'utf8'
  );
  await fs.writeFile(
    testInfo.outputPath('harness-persisted-state.json'),
    `${JSON.stringify(diagnostics.persistedState, null, 2)}\n`,
    'utf8'
  );
});

test('webview bundle emits ready and matches the baseline screenshot', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createCanvasScreenshotState());

  await expect(page.getByText('收口隔离调试')).toBeVisible();
  await expect(page.getByText('回看 smoke test')).toBeVisible();
  await expect(page.locator('.canvas-shell')).toHaveScreenshot('canvas-shell-baseline.png', {
    animations: 'disabled',
    caret: 'hide'
  });
});

test('agent start button posts a startExecutionSession message', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createAgentNodeState());
  await clearPostedMessages(page);

  await nodeById(page, 'agent-1').getByRole('button', { name: '启动' }).click();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/startExecutionSession');

        if (!message) {
          return null;
        }

        return JSON.stringify({
          type: message.type,
          payload: {
            nodeId: message.payload.nodeId,
            kind: message.payload.kind,
            provider: message.payload.provider
          }
        });
      });
    })
    .toBe(
      JSON.stringify({
        type: 'webview/startExecutionSession',
        payload: {
          nodeId: 'agent-1',
          kind: 'agent',
          provider: 'codex'
        }
      })
    );
});

test('changing a task node status posts updateTaskNode', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createTaskNodeState());
  await clearPostedMessages(page);

  await nodeById(page, 'task-1').locator('[data-probe-field="status"]').selectOption('running');

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.__devSessionCanvasHarness.getPostedMessages().some(
          (entry) =>
            entry.type === 'webview/updateTaskNode' &&
            entry.payload.nodeId === 'task-1' &&
            entry.payload.status === 'running'
        );
      });
    })
    .toBe(true);
});

test('editing a note body posts updateNoteNode', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState());
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const noteBody = noteNode.locator('[data-probe-field="body"]');
  await noteBody.fill('把真实容器 probe 也纳入回归。');
  await noteBody.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.__devSessionCanvasHarness.getPostedMessages().find(
          (entry) =>
            entry.type === 'webview/updateNoteNode' &&
            entry.payload.nodeId === 'note-1' &&
            entry.payload.content === '把真实容器 probe 也纳入回归。'
        )
          ? 'matched'
          : null;
      });
    })
    .toBe('matched');
});

test('deleting a task posts deleteNode', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createTaskNodeState());
  await clearPostedMessages(page);

  const deleteButton = nodeById(page, 'task-1').getByRole('button', { name: '删除', exact: true });
  await deleteButton.focus();
  await deleteButton.press('Enter');

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.__devSessionCanvasHarness.getPostedMessages().find(
          (entry) =>
            entry.type === 'webview/deleteNode' && entry.payload.nodeId === 'task-1'
        )
          ? 'matched'
          : null;
      });
    })
    .toBe('matched');
});

test('switching provider changes the next agent start message', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createAgentNodeState());
  await clearPostedMessages(page);

  const agentNode = nodeById(page, 'agent-1');
  await agentNode.locator('[data-probe-field="provider"]').selectOption('claude');
  await agentNode.getByRole('button', { name: '启动' }).click();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/startExecutionSession');

        if (!message) {
          return null;
        }

        return message.payload.provider ?? null;
      });
    })
    .toBe('claude');
});

test('incoming host error shows a toast in the harness', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createTaskNodeState());

  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/error',
      payload: {
        message: '真实容器之外也要保留错误提示。'
      }
    });
  });

  await expect(page.locator('[data-toast-kind="error"]')).toHaveText(
    '真实容器之外也要保留错误提示。'
  );
});

async function openHarness(page) {
  await page.goto(harnessUrl);

  await expect
    .poll(async () => {
      return page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .some((entry) => entry.type === 'webview/ready')
      );
    })
    .toBe(true);
}

async function bootstrap(page, state) {
  await page.evaluate((nextState) => {
    window.__devSessionCanvasHarness.clearPostedMessages();
    window.__devSessionCanvasHarness.bootstrap(nextState);
  }, state);
}

async function clearPostedMessages(page) {
  await page.evaluate(() => {
    window.__devSessionCanvasHarness.clearPostedMessages();
  });
}

function nodeById(page, nodeId) {
  return page.locator(`[data-node-id="${nodeId}"]`);
}

function createCanvasScreenshotState() {
  return {
    version: 1,
    updatedAt: '2026-04-06T00:00:00.000Z',
    nodes: [
      {
        id: 'task-1',
        kind: 'task',
        title: '收口隔离调试',
        status: 'running',
        summary: '让 F5 始终启动到隔离的开发宿主。',
        position: { x: 80, y: 120 },
        metadata: {
          task: {
            description: '固定 user-data-dir、extensions-dir，并禁用外部扩展。',
            assignee: 'Codex'
          }
        }
      },
      {
        id: 'note-1',
        kind: 'note',
        title: '回看 smoke test',
        status: 'todo',
        summary: '补齐真实 VS Code 宿主验证与截图回归。',
        position: { x: 520, y: 180 },
        metadata: {
          note: {
            content: '第二层只覆盖主路径；第三层专注 Webview UI。'
          }
        }
      }
    ]
  };
}

function createAgentNodeState() {
  return {
    version: 1,
    updatedAt: '2026-04-06T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-1',
        kind: 'agent',
        title: '实现自动化测试',
        status: 'idle',
        summary: '等待启动 Codex CLI。',
        position: { x: 120, y: 140 },
        metadata: {
          agent: {
            backend: 'node-pty',
            shellPath: 'codex',
            cwd: '/workspace',
            liveSession: false,
            provider: 'codex',
            lastCols: 96,
            lastRows: 28,
            lastBackendLabel: 'Codex CLI'
          }
        }
      }
    ]
  };
}

function createTaskNodeState() {
  return {
    version: 1,
    updatedAt: '2026-04-06T00:00:00.000Z',
    nodes: [
      {
        id: 'task-1',
        kind: 'task',
        title: '原始任务标题',
        status: 'todo',
        summary: '等待更新任务字段。',
        position: { x: 120, y: 140 },
        metadata: {
          task: {
            description: '旧描述',
            assignee: 'Codex'
          }
        }
      }
    ]
  };
}

function createNoteNodeState() {
  return {
    version: 1,
    updatedAt: '2026-04-06T00:00:00.000Z',
    nodes: [
      {
        id: 'note-1',
        kind: 'note',
        title: '初始笔记标题',
        status: 'ready',
        summary: '等待补充说明。',
        position: { x: 120, y: 140 },
        metadata: {
          note: {
            content: '先记录当前上下文。'
          }
        }
      }
    ]
  };
}
