import path from 'path';
import { pathToFileURL } from 'url';
import { expect, test } from '@playwright/test';

const harnessUrl = pathToFileURL(
  path.join(process.cwd(), 'tests', 'playwright', 'harness', 'webview-harness.html')
).href;

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

  await page.locator('.agent-session-node').getByRole('button', { name: '启动' }).click();

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

  await page.getByLabel('状态').selectOption('running');

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
