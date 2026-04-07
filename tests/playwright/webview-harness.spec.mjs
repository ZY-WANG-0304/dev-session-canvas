import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { expect, test } from '@playwright/test';

const harnessUrl = pathToFileURL(
  path.join(process.cwd(), 'tests', 'playwright', 'harness', 'webview-harness.html')
).href;
const pageDiagnosticsByPage = new WeakMap();

test.beforeEach(async ({ page }) => {
  const pageDiagnostics = {
    consoleMessages: [],
    pageErrors: [],
    requestFailures: []
  };
  pageDiagnosticsByPage.set(page, pageDiagnostics);

  page.on('console', (message) => {
    pageDiagnostics.consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location: message.location()
    });
  });

  page.on('pageerror', (error) => {
    pageDiagnostics.pageErrors.push({
      message: error.message,
      stack: error.stack ?? null
    });
  });

  page.on('requestfailed', (request) => {
    pageDiagnostics.requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? null
    });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }

  const pageDiagnostics = pageDiagnosticsByPage.get(page) ?? {
    consoleMessages: [],
    pageErrors: [],
    requestFailures: []
  };
  const harnessDiagnostics = await page
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

  await fs.writeFile(
    testInfo.outputPath('playwright-page-diagnostics.json'),
    `${JSON.stringify(pageDiagnostics, null, 2)}\n`,
    'utf8'
  );

  if (harnessDiagnostics) {
    await fs.writeFile(
      testInfo.outputPath('harness-posted-messages.json'),
      `${JSON.stringify(harnessDiagnostics.postedMessages, null, 2)}\n`,
      'utf8'
    );
    await fs.writeFile(
      testInfo.outputPath('harness-persisted-state.json'),
      `${JSON.stringify(harnessDiagnostics.persistedState, null, 2)}\n`,
      'utf8'
    );
  }
});

test('webview bundle emits ready and matches the baseline screenshot', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createCanvasScreenshotState());

  await expect(nodeById(page, 'task-1').locator('[data-probe-field="title"]')).toHaveValue('收口隔离调试');
  await expect(nodeById(page, 'note-1').locator('[data-probe-field="title"]')).toHaveValue('回看 smoke test');
  await expect(page.locator('.canvas-shell')).toHaveScreenshot('canvas-shell-baseline.png', {
    animations: 'disabled',
    caret: 'hide'
  });
});

test('agent start button posts a startExecutionSession message', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createAgentNodeState());
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'clickNodeActionButton',
    nodeId: 'agent-1',
    label: '启动'
  });

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

  await performTestDomAction(page, {
    kind: 'setNodeTextField',
    nodeId: 'note-1',
    field: 'body',
    value: '把真实容器 probe 也纳入回归。'
  });

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

test('dragging a resize handle posts resizeNode and updates the task frame size', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createTaskNodeState());
  await clearPostedMessages(page);

  const taskNode = nodeById(page, 'task-1');
  await performTestDomAction(page, {
    kind: 'selectNode',
    nodeId: 'task-1'
  });
  await clearPostedMessages(page);

  const beforeBox = await taskNode.boundingBox();
  expect(beforeBox).not.toBeNull();

  const handle = taskNode.locator('.canvas-node-resize-handle.bottom.right');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 120,
    handleBox.y + handleBox.height / 2 + 90,
    { steps: 12 }
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'task-1');

        return message
          ? JSON.stringify({
              x: message.payload.position.x,
              y: message.payload.position.y,
              width: message.payload.size.width,
              height: message.payload.size.height
            })
          : null;
      });
    })
    .toMatch(/"x":\d+,"y":\d+,"width":\d+,"height":\d+/);

  const resizedSize = await page.evaluate(() => {
    const message = window.__devSessionCanvasHarness
      .getPostedMessages()
      .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'task-1');

    if (!message) {
      return null;
    }

    return {
      position: message.payload.position,
      width: message.payload.size.width,
      height: message.payload.size.height
    };
  });
  expect(resizedSize).not.toBeNull();

  const nextState = createTaskNodeState();
  nextState.nodes[0].position = resizedSize.position;
  nextState.nodes[0].size = {
    width: resizedSize.width,
    height: resizedSize.height
  };
  await page.evaluate((state) => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/stateUpdated',
      payload: {
        state,
        runtime: {
          workspaceTrusted: true
        }
      }
    });
  }, nextState);

  await expect.poll(async () => taskNode.boundingBox()).not.toBeNull();
  const afterBox = await taskNode.boundingBox();
  expect(afterBox).not.toBeNull();
  expect(afterBox.width).toBeGreaterThan(beforeBox.width + 40);
  expect(afterBox.height).toBeGreaterThan(beforeBox.height + 30);
});

test('dragging the top-left resize handle moves the task origin and grows the frame', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createTaskNodeState());
  await clearPostedMessages(page);

  const taskNode = nodeById(page, 'task-1');
  await performTestDomAction(page, {
    kind: 'selectNode',
    nodeId: 'task-1'
  });
  await clearPostedMessages(page);

  const beforeBox = await taskNode.boundingBox();
  expect(beforeBox).not.toBeNull();

  const handle = taskNode.locator('.canvas-node-resize-handle.top.left');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 - 100,
    handleBox.y + handleBox.height / 2 - 70,
    { steps: 12 }
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'task-1');

        return message
          ? JSON.stringify({
              x: message.payload.position.x,
              y: message.payload.position.y,
              width: message.payload.size.width,
              height: message.payload.size.height
            })
          : null;
      });
    })
    .toMatch(/"x":\d+,"y":\d+,"width":\d+,"height":\d+/);

  const nextLayout = await page.evaluate(() => {
    const message = window.__devSessionCanvasHarness
      .getPostedMessages()
      .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'task-1');

    if (!message) {
      return null;
    }

    return {
      position: message.payload.position,
      size: message.payload.size
    };
  });
  expect(nextLayout).not.toBeNull();
  expect(nextLayout.position.x).toBeLessThan(120);
  expect(nextLayout.position.y).toBeLessThan(140);
  expect(nextLayout.size.width).toBeGreaterThan(380);
  expect(nextLayout.size.height).toBeGreaterThan(360);

  const nextState = createTaskNodeState();
  nextState.nodes[0].position = nextLayout.position;
  nextState.nodes[0].size = nextLayout.size;
  await page.evaluate((state) => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/stateUpdated',
      payload: {
        state,
        runtime: {
          workspaceTrusted: true
        }
      }
    });
  }, nextState);

  const afterBox = await taskNode.boundingBox();
  expect(afterBox).not.toBeNull();
  expect(afterBox.x).toBeLessThan(beforeBox.x - 40);
  expect(afterBox.y).toBeLessThan(beforeBox.y - 20);
  expect(afterBox.width).toBeGreaterThan(beforeBox.width + 40);
  expect(afterBox.height).toBeGreaterThan(beforeBox.height + 30);
});

test('deleting a task posts deleteNode', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createTaskNodeState());
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'clickNodeActionButton',
    nodeId: 'task-1',
    label: '删除'
  });

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
  await performTestDomAction(page, {
    kind: 'clickNodeActionButton',
    nodeId: 'agent-1',
    label: '启动'
  });

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

async function performTestDomAction(page, action) {
  const requestId = `playwright-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await page.evaluate(
    ({ nextRequestId, nextAction }) => {
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/testDomAction',
        payload: {
          requestId: nextRequestId,
          action: nextAction
        }
      });
    },
    {
      nextRequestId: requestId,
      nextAction: action
    }
  );

  await expect
    .poll(async () => {
      return page.evaluate((nextRequestId) => {
        const result = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find(
            (entry) =>
              entry.type === 'webview/testDomActionResult' &&
              entry.payload.requestId === nextRequestId
          );

        if (!result) {
          return null;
        }

        return result.payload.ok ? 'ok' : result.payload.errorMessage ?? 'error';
      }, requestId);
    })
    .toBe('ok');
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
        size: sizeFor('task'),
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
        size: sizeFor('note'),
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
        size: sizeFor('agent'),
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
        size: sizeFor('task'),
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
        size: sizeFor('note'),
        metadata: {
          note: {
            content: '先记录当前上下文。'
          }
        }
      }
    ]
  };
}

function sizeFor(kind) {
  switch (kind) {
    case 'agent':
      return { width: 560, height: 430 };
    case 'terminal':
      return { width: 540, height: 420 };
    case 'task':
      return { width: 380, height: 360 };
    case 'note':
      return { width: 380, height: 430 };
    default:
      throw new Error(`Unsupported kind ${kind}`);
  }
}
