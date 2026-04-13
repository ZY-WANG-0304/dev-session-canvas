import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { expect, test } from '@playwright/test';

const harnessUrl = pathToFileURL(
  path.join(process.cwd(), 'tests', 'playwright', 'harness', 'webview-harness.html')
).href;
const pageDiagnosticsByPage = new WeakMap();
const TERMINAL_VIEWPORT_ZOOM = 1.6;
const WORKBENCH_THEME_VARS = {
  dark: {
    '--vscode-editor-background': '#1e1e1e',
    '--vscode-editor-foreground': '#cccccc',
    '--vscode-sideBar-background': '#181818',
    '--vscode-editorWidget-background': '#252526',
    '--vscode-panel-border': '#454545',
    '--vscode-widget-border': '#454545',
    '--vscode-focusBorder': '#0078d4',
    '--vscode-descriptionForeground': '#9d9d9d',
    '--vscode-icon-foreground': '#c5c5c5',
    '--vscode-button-background': '#0e639c',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#1177bb',
    '--vscode-button-secondaryBackground': '#3a3d41',
    '--vscode-button-secondaryForeground': '#cccccc',
    '--vscode-button-secondaryHoverBackground': '#45494e',
    '--vscode-menu-background': '#252526',
    '--vscode-menu-foreground': '#cccccc',
    '--vscode-menu-selectionBackground': '#04395e',
    '--vscode-menu-selectionForeground': '#ffffff',
    '--vscode-menu-border': '#454545',
    '--vscode-terminal-background': '#181818',
    '--vscode-terminal-foreground': '#cccccc',
    '--vscode-terminalCursor-foreground': '#aeafad',
    '--vscode-terminalCursor-background': '#181818',
    '--vscode-terminal-selectionBackground': 'rgba(38, 79, 120, 0.5)',
    '--vscode-terminal-selectionForeground': '#ffffff',
    '--vscode-terminal-inactiveSelectionBackground': 'rgba(38, 79, 120, 0.28)',
    '--vscode-terminal-ansiBlack': '#000000',
    '--vscode-terminal-ansiRed': '#cd3131',
    '--vscode-terminal-ansiGreen': '#0dbc79',
    '--vscode-terminal-ansiYellow': '#e5e510',
    '--vscode-terminal-ansiBlue': '#2472c8',
    '--vscode-terminal-ansiMagenta': '#bc3fbc',
    '--vscode-terminal-ansiCyan': '#11a8cd',
    '--vscode-terminal-ansiWhite': '#e5e5e5',
    '--vscode-terminal-ansiBrightBlack': '#666666',
    '--vscode-terminal-ansiBrightRed': '#f14c4c',
    '--vscode-terminal-ansiBrightGreen': '#23d18b',
    '--vscode-terminal-ansiBrightYellow': '#f5f543',
    '--vscode-terminal-ansiBrightBlue': '#3b8eea',
    '--vscode-terminal-ansiBrightMagenta': '#d670d6',
    '--vscode-terminal-ansiBrightCyan': '#29b8db',
    '--vscode-terminal-ansiBrightWhite': '#f2f2f2',
    '--vscode-font-family': "'Segoe UI', sans-serif",
    '--vscode-editor-font-family': "'Segoe UI', sans-serif"
  },
  light: {
    '--vscode-editor-background': '#ffffff',
    '--vscode-editor-foreground': '#1f1f1f',
    '--vscode-sideBar-background': '#f3f3f3',
    '--vscode-editorWidget-background': '#f8f8f8',
    '--vscode-panel-border': '#c8c8c8',
    '--vscode-widget-border': '#c8c8c8',
    '--vscode-focusBorder': '#005fb8',
    '--vscode-descriptionForeground': '#616161',
    '--vscode-icon-foreground': '#424242',
    '--vscode-button-background': '#005fb8',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#004a9f',
    '--vscode-button-secondaryBackground': '#e8e8e8',
    '--vscode-button-secondaryForeground': '#1f1f1f',
    '--vscode-button-secondaryHoverBackground': '#dddddd',
    '--vscode-menu-background': '#ffffff',
    '--vscode-menu-foreground': '#1f1f1f',
    '--vscode-menu-selectionBackground': '#cce8ff',
    '--vscode-menu-selectionForeground': '#1f1f1f',
    '--vscode-menu-border': '#d4d4d4',
    '--vscode-terminal-background': '#fdfdfd',
    '--vscode-terminal-foreground': '#1f1f1f',
    '--vscode-terminalCursor-foreground': '#424242',
    '--vscode-terminalCursor-background': '#fdfdfd',
    '--vscode-terminal-selectionBackground': 'rgba(173, 214, 255, 0.45)',
    '--vscode-terminal-selectionForeground': '#0f0f0f',
    '--vscode-terminal-inactiveSelectionBackground': 'rgba(173, 214, 255, 0.24)',
    '--vscode-terminal-ansiBlack': '#24292e',
    '--vscode-terminal-ansiRed': '#b31d28',
    '--vscode-terminal-ansiGreen': '#16825d',
    '--vscode-terminal-ansiYellow': '#a05a00',
    '--vscode-terminal-ansiBlue': '#0451a5',
    '--vscode-terminal-ansiMagenta': '#6f42c1',
    '--vscode-terminal-ansiCyan': '#0f7b8f',
    '--vscode-terminal-ansiWhite': '#6a737d',
    '--vscode-terminal-ansiBrightBlack': '#4b5563',
    '--vscode-terminal-ansiBrightRed': '#d73a49',
    '--vscode-terminal-ansiBrightGreen': '#22863a',
    '--vscode-terminal-ansiBrightYellow': '#b08800',
    '--vscode-terminal-ansiBrightBlue': '#0366d6',
    '--vscode-terminal-ansiBrightMagenta': '#8250df',
    '--vscode-terminal-ansiBrightCyan': '#1b7c83',
    '--vscode-terminal-ansiBrightWhite': '#111827',
    '--vscode-font-family': "'Segoe UI', sans-serif",
    '--vscode-editor-font-family': "'Segoe UI', sans-serif"
  }
};

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

  await expect(nodeById(page, 'agent-1').locator('[data-probe-field="provider"]')).toHaveValue('codex');
  await expect(nodeById(page, 'agent-1').locator('[data-probe-field="title"]')).toHaveValue('Agent 1');
  await expect(nodeById(page, 'terminal-1').locator('[data-probe-field="title"]')).toHaveValue('Terminal 1');
  await expect(nodeById(page, 'note-1').locator('[data-probe-field="title"]')).toHaveValue('回看 smoke test');
  await expect(page.locator('.canvas-shell')).toHaveScreenshot('canvas-shell-baseline.png', {
    animations: 'disabled',
    caret: 'hide'
  });
});

test('embedded xterm theme follows workbench theme changes for agent and terminal nodes', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createCanvasScreenshotState());
  await settleWebview(page, 4);

  await expect
    .poll(async () => {
      const agentNode = await readProbeNode(page, 'agent-1', 20);
      const terminalNode = await readProbeNode(page, 'terminal-1', 20);

      return JSON.stringify({
        agentBackground: agentNode?.terminalTheme?.background,
        agentForeground: agentNode?.terminalTheme?.foreground,
        agentAnsiBlue: agentNode?.terminalTheme?.ansiBlue,
        terminalBackground: terminalNode?.terminalTheme?.background,
        terminalBrightWhite: terminalNode?.terminalTheme?.ansiBrightWhite
      });
    })
    .toBe(
      JSON.stringify({
        agentBackground: WORKBENCH_THEME_VARS.dark['--vscode-terminal-background'],
        agentForeground: WORKBENCH_THEME_VARS.dark['--vscode-terminal-foreground'],
        agentAnsiBlue: WORKBENCH_THEME_VARS.dark['--vscode-terminal-ansiBlue'],
        terminalBackground: WORKBENCH_THEME_VARS.dark['--vscode-terminal-background'],
        terminalBrightWhite: WORKBENCH_THEME_VARS.dark['--vscode-terminal-ansiBrightWhite']
      })
    );

  await applyWorkbenchTheme(page, 'light');
  await dispatchThemeChanged(page);
  await settleWebview(page, 4);

  await expect
    .poll(async () => {
      const agentNode = await readProbeNode(page, 'agent-1', 20);
      const terminalNode = await readProbeNode(page, 'terminal-1', 20);

      return JSON.stringify({
        agentBackground: agentNode?.terminalTheme?.background,
        agentForeground: agentNode?.terminalTheme?.foreground,
        agentAnsiBlue: agentNode?.terminalTheme?.ansiBlue,
        terminalBackground: terminalNode?.terminalTheme?.background,
        terminalBrightWhite: terminalNode?.terminalTheme?.ansiBrightWhite
      });
    })
    .toBe(
      JSON.stringify({
        agentBackground: WORKBENCH_THEME_VARS.light['--vscode-terminal-background'],
        agentForeground: WORKBENCH_THEME_VARS.light['--vscode-terminal-foreground'],
        agentAnsiBlue: WORKBENCH_THEME_VARS.light['--vscode-terminal-ansiBlue'],
        terminalBackground: WORKBENCH_THEME_VARS.light['--vscode-terminal-background'],
        terminalBrightWhite: WORKBENCH_THEME_VARS.light['--vscode-terminal-ansiBrightWhite']
      })
    );
});

for (const themeName of ['dark', 'light']) {
  test(`minimap viewport contrast stays readable in ${themeName} workbench theme`, async ({ page }) => {
    await openHarness(page, {
      persistedState: {
        viewport: {
          x: 0,
          y: 0,
          zoom: 1.25
        }
      }
    });
    await applyWorkbenchTheme(page, themeName);
    await bootstrap(page, createMinimapContrastState());
    await settleWebview(page, 4);

    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();

    const agentBox = await nodeById(page, 'agent-minimap-left').boundingBox();
    const terminalBox = await nodeById(page, 'terminal-minimap-right').boundingBox();
    const noteBox = await nodeById(page, 'note-minimap-bottom').boundingBox();

    expect(agentBox).not.toBeNull();
    expect(terminalBox).not.toBeNull();
    expect(noteBox).not.toBeNull();
    expect(agentBox.x).toBeLessThan(0);
    expect(terminalBox.x + terminalBox.width).toBeGreaterThan(viewportSize.width);
    expect(noteBox.y + noteBox.height).toBeGreaterThan(viewportSize.height);

    await expect(page.locator('.canvas-minimap')).toHaveScreenshot(`canvas-minimap-${themeName}.png`, {
      animations: 'disabled',
      caret: 'hide'
    });
  });
}

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

test('execution node chrome hides runtime diagnostics and keeps agent waiting-input visible', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createRuntimeChromeState());

  const agentNode = nodeById(page, 'agent-runtime');
  const terminalNode = nodeById(page, 'terminal-runtime');

  await expect(agentNode.locator('.status-pill')).toHaveCount(1);
  await expect(agentNode.locator('.status-pill').first()).toHaveText('等待输入');
  await expect(agentNode).not.toContainText('best-effort');
  await expect(agentNode).not.toContainText('systemd-user');
  await expect(agentNode).not.toContainText('detached');

  await expect(terminalNode.locator('.status-pill')).toHaveCount(1);
  await expect(terminalNode.locator('.status-pill').first()).toHaveText('活动');
  await expect(terminalNode).not.toContainText('best-effort');
  await expect(terminalNode).not.toContainText('systemd-user');
  await expect(terminalNode).not.toContainText('detached');
});

test('editing node titles posts updateNodeTitle for agent, terminal, and note', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createCanvasScreenshotState());
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'setNodeTextField',
    nodeId: 'agent-1',
    field: 'title',
    value: 'Agent Heading'
  });
  await performTestDomAction(page, {
    kind: 'setNodeTextField',
    nodeId: 'terminal-1',
    field: 'title',
    value: 'Terminal Heading'
  });
  await performTestDomAction(page, {
    kind: 'setNodeTextField',
    nodeId: 'note-1',
    field: 'title',
    value: 'Note Heading'
  });

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const messages = window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((entry) => entry.type === 'webview/updateNodeTitle');

        if (messages.length < 3) {
          return null;
        }

        return JSON.stringify(
          messages.map((entry) => ({
            nodeId: entry.payload.nodeId,
            title: entry.payload.title
          }))
        );
      });
    })
    .toBe(
      JSON.stringify([
        { nodeId: 'agent-1', title: 'Agent Heading' },
        { nodeId: 'terminal-1', title: 'Terminal Heading' },
        { nodeId: 'note-1', title: 'Note Heading' }
      ])
    );
});

test('double-clicking the chrome focus region recenters the node and updates persisted viewport', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedNodeId: 'terminal-1',
      viewport: {
        x: -420,
        y: -220,
        zoom: 0.48
      }
    }
  });
  await bootstrap(page, createCanvasScreenshotState());
  await settleWebview(page, 4);

  const beforeState = await readPersistedUiState(page);
  expect(beforeState.viewport).toEqual({
    x: -420,
    y: -220,
    zoom: 0.48
  });

  await page
    .locator('[data-node-id="agent-1"] .window-chrome')
    .dispatchEvent('dblclick', { bubbles: true, cancelable: true, composed: true });
  await settleWebview(page, 6);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).toBe('agent-1');
  expect(afterState.viewport.zoom).toBeGreaterThan(0.48);
  expect(afterState.viewport.zoom).toBeLessThanOrEqual(1.15);
  expect(afterState.viewport.x).not.toBe(beforeState.viewport.x);
  expect(afterState.viewport.y).not.toBe(beforeState.viewport.y);
});

test('double-clicking the title input keeps the current viewport unchanged', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: -320,
        y: -160,
        zoom: 0.62
      }
    }
  });
  await bootstrap(page, createCanvasScreenshotState());
  await settleWebview(page, 4);

  const beforeState = await readPersistedUiState(page);

  await nodeById(page, 'agent-1')
    .locator('[data-probe-field="title"]')
    .dispatchEvent('dblclick', { bubbles: true, cancelable: true, composed: true });
  await settleWebview(page, 4);

  const afterState = await readPersistedUiState(page);
  expect(afterState.viewport).toEqual(beforeState.viewport);
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

test('dragging a resize handle posts resizeNode and updates the note frame size', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState());
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await performTestDomAction(page, {
    kind: 'selectNode',
    nodeId: 'note-1'
  });
  await clearPostedMessages(page);

  const beforeBox = await noteNode.boundingBox();
  expect(beforeBox).not.toBeNull();

  const handle = noteNode.locator('.canvas-node-resize-handle.bottom.right');
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
          .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'note-1');

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
        .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'note-1');

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

  const nextState = createNoteNodeState();
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

  await expect.poll(async () => noteNode.boundingBox()).not.toBeNull();
  const afterBox = await noteNode.boundingBox();
  expect(afterBox).not.toBeNull();
  expect(afterBox.width).toBeGreaterThan(beforeBox.width + 40);
  expect(afterBox.height).toBeGreaterThan(beforeBox.height + 30);
});

test('dragging the top-left resize handle moves the note origin and grows the frame', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState());
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await performTestDomAction(page, {
    kind: 'selectNode',
    nodeId: 'note-1'
  });
  await clearPostedMessages(page);

  const beforeBox = await noteNode.boundingBox();
  expect(beforeBox).not.toBeNull();

  const handle = noteNode.locator('.canvas-node-resize-handle.top.left');
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
          .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'note-1');

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
        .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'note-1');

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
  expect(nextLayout.size.height).toBeGreaterThan(400);

  const nextState = createNoteNodeState();
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

  const afterBox = await noteNode.boundingBox();
  expect(afterBox).not.toBeNull();
  expect(afterBox.x).toBeLessThan(beforeBox.x - 40);
  expect(afterBox.y).toBeLessThan(beforeBox.y - 20);
  expect(afterBox.width).toBeGreaterThan(beforeBox.width + 40);
  expect(afterBox.height).toBeGreaterThan(beforeBox.height + 30);
});

test('deleting a note posts deleteNode', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState());
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'clickNodeActionButton',
    nodeId: 'note-1',
    label: '删除'
  });

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.__devSessionCanvasHarness.getPostedMessages().find(
          (entry) =>
            entry.type === 'webview/deleteNode' && entry.payload.nodeId === 'note-1'
        )
          ? 'matched'
          : null;
      });
    })
    .toBe('matched');
});

test('right-clicking the empty pane opens a quick-create menu near the pointer', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(page, createCanvasScreenshotState());
  await clearPostedMessages(page);

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 1100,
      y: 560
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-context-menu-kind="agent"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-kind="terminal"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-kind="note"]')).toBeVisible();

  await menu.locator('[data-context-menu-kind="note"]').click();

  await expect(menu).toBeHidden();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/createDemoNode');

        if (!message) {
          return null;
        }

        return JSON.stringify(message.payload);
      });
    })
    .toBe(
      JSON.stringify({
        kind: 'note',
        preferredPosition: {
          x: 910,
          y: 360
        }
      })
    );
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
  await bootstrap(page, createNoteNodeState());

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

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} xterm selection stays aligned under zoomed React Flow`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const outputLine = '0123456789ABCDEFGHIJKLMNO';
    const selectionRange = {
      startCol: 5,
      endCol: 12
    };

    await openHarness(page, {
      persistedState: {
        viewport: {
          x: 0,
          y: 0,
          zoom: TERMINAL_VIEWPORT_ZOOM
        }
      }
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${outputLine}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await dragTerminalSelection(page, {
      nodeId,
      row: 1,
      ...selectionRange
    });

    await expect
      .poll(async () => {
        const probeNode = await readProbeNode(page, nodeId, 20);
        return probeNode?.terminalSelectionText ?? null;
      })
      .toBe(outputLine.slice(selectionRange.startCol - 1, selectionRange.endCol));
  });
}

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} drag scroll waits for the visual edge under zoomed React Flow`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const output = createScrollableTerminalOutput(80);

    await openHarness(page, {
      persistedState: {
        viewport: {
          x: 0,
          y: 0,
          zoom: TERMINAL_VIEWPORT_ZOOM
        }
      }
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    const bottomProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (probeNode) => typeof probeNode?.terminalViewportY === 'number' && probeNode.terminalViewportY > 0
    );
    const bottomViewportY = bottomProbe.terminalViewportY;

    const scrolledProbe = await scrollTerminalViewport(page, nodeId, -1400, (probeNode) => {
      return (
        typeof probeNode?.terminalViewportY === 'number' &&
        probeNode.terminalViewportY < bottomViewportY - 4
      );
    });
    const scrolledViewportY = scrolledProbe.terminalViewportY;

    const screen = nodeById(page, nodeId).locator('.xterm-screen');
    await expect(screen).toBeVisible();
    const box = await screen.boundingBox();
    expect(box).not.toBeNull();
    expect(scrolledProbe.terminalCols).toBeGreaterThan(0);
    expect(scrolledProbe.terminalRows).toBeGreaterThan(0);

    const cellWidth = box.width / scrolledProbe.terminalCols;
    const cellHeight = box.height / scrolledProbe.terminalRows;
    const startX = box.x + 1.5 * cellWidth;
    const startY = box.y + Math.floor(scrolledProbe.terminalRows / 2) * cellHeight;
    const insideBottomY = box.y + box.height - Math.max(24, cellHeight * 1.25);
    const belowBottomY = box.y + box.height + Math.max(18, cellHeight * 0.9);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, insideBottomY, { steps: 12 });
    await page.waitForTimeout(250);

    const insideProbe = await readProbeNode(page, nodeId, 20);
    expect(insideProbe?.terminalViewportY).toBe(scrolledViewportY);

    await page.mouse.move(startX, belowBottomY, { steps: 8 });
    const outsideProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (probeNode) =>
        typeof probeNode?.terminalViewportY === 'number' &&
        probeNode.terminalViewportY > scrolledViewportY
    );
    await page.mouse.up();

    expect(outsideProbe.terminalViewportY).toBeGreaterThan(scrolledViewportY);
  });
}

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} right click keeps xterm textarea aligned under zoomed React Flow`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;

    await openHarness(page, {
      persistedState: {
        viewport: {
          x: 0,
          y: 0,
          zoom: TERMINAL_VIEWPORT_ZOOM
        }
      }
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: 'context-menu-anchor\r\n',
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    const screen = nodeById(page, nodeId).locator('.xterm-screen');
    await expect(screen).toBeVisible();
    const probeNode = await waitForExecutionTerminalReady(page, nodeId);
    const box = await screen.boundingBox();

    expect(box).not.toBeNull();
    expect(probeNode.terminalCols).toBeGreaterThan(0);
    expect(probeNode.terminalRows).toBeGreaterThan(0);

    const cellWidth = box.width / probeNode.terminalCols;
    const cellHeight = box.height / probeNode.terminalRows;
    const offsetX = cellWidth * 12.4;
    const offsetY = cellHeight * 5.6;
    const clickX = box.x + offsetX;
    const clickY = box.y + offsetY;
    const expectedLeft = offsetX / TERMINAL_VIEWPORT_ZOOM - 10;
    const expectedTop = offsetY / TERMINAL_VIEWPORT_ZOOM - 10;

    await page.mouse.click(clickX, clickY, { button: 'right' });
    await settleWebview(page, 3);

    const textareaProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (nextProbeNode) =>
        typeof nextProbeNode?.terminalTextareaLeft === 'number' &&
        typeof nextProbeNode?.terminalTextareaTop === 'number' &&
        Math.abs(nextProbeNode.terminalTextareaLeft - expectedLeft) <= 3 &&
        Math.abs(nextProbeNode.terminalTextareaTop - expectedTop) <= 3
    );

    expect(Math.abs(textareaProbe.terminalTextareaLeft - expectedLeft)).toBeLessThanOrEqual(3);
    expect(Math.abs(textareaProbe.terminalTextareaTop - expectedTop)).toBeLessThanOrEqual(3);
  });
}

async function openHarness(page, options = {}) {
  if (options.persistedState !== undefined) {
    await page.addInitScript((persistedState) => {
      window.__devSessionCanvasHarnessInitialPersistedState = persistedState;
    }, options.persistedState);
  }

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

async function applyWorkbenchTheme(page, themeName) {
  const colorScheme = themeName === 'dark' ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme });
  await page.evaluate(
    ({ themeVars }) => {
      for (const [name, value] of Object.entries(themeVars)) {
        document.documentElement.style.setProperty(name, value);
      }
    },
    {
      themeVars: WORKBENCH_THEME_VARS[themeName]
    }
  );
  await settleWebview(page, 2);
}

async function clearPostedMessages(page) {
  await page.evaluate(() => {
    window.__devSessionCanvasHarness.clearPostedMessages();
  });
}

async function dispatchThemeChanged(page) {
  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/themeChanged'
    });
  });
}

async function readPersistedUiState(page) {
  return page.evaluate(() => {
    return window.__devSessionCanvasHarness.getPersistedState();
  });
}

async function requestWebviewProbe(page, delayMs = 0) {
  const requestId = `probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await page.evaluate(
    ({ nextRequestId, nextDelayMs }) => {
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/testProbeRequest',
        payload: {
          requestId: nextRequestId,
          delayMs: nextDelayMs
        }
      });
    },
    {
      nextRequestId: requestId,
      nextDelayMs: delayMs
    }
  );

  await page.waitForFunction((nextRequestId) => {
    return window.__devSessionCanvasHarness
      .getPostedMessages()
      .some(
        (entry) =>
          entry.type === 'webview/testProbeResult' &&
          entry.payload.requestId === nextRequestId
      );
  }, requestId);

  return page.evaluate((nextRequestId) => {
    return window.__devSessionCanvasHarness
      .getPostedMessages()
      .find(
        (entry) =>
          entry.type === 'webview/testProbeResult' &&
          entry.payload.requestId === nextRequestId
      )?.payload.snapshot;
  }, requestId);
}

async function readProbeNode(page, nodeId, delayMs = 0) {
  const snapshot = await requestWebviewProbe(page, delayMs);
  return snapshot.nodes.find((node) => node.nodeId === nodeId) ?? null;
}

async function waitForProbeNodeMatch(page, nodeId, predicate, delayMs = 20) {
  let matchedNode = null;

  await expect
    .poll(async () => {
      const probeNode = await readProbeNode(page, nodeId, delayMs);
      if (!predicate(probeNode)) {
        return null;
      }

      matchedNode = probeNode;
      return 'matched';
    })
    .toBe('matched');

  return matchedNode;
}

async function waitForExecutionTerminalReady(page, nodeId) {
  let readyNode = null;

  await expect
    .poll(async () => {
      readyNode = await readProbeNode(page, nodeId, 20);
      if (!readyNode?.terminalCols || !readyNode?.terminalRows) {
        return null;
      }

      return JSON.stringify({
        cols: readyNode.terminalCols,
        rows: readyNode.terminalRows
      });
    })
    .toMatch(/"cols":\d+,"rows":\d+/);

  return readyNode;
}

async function scrollTerminalViewport(page, nodeId, deltaY, predicate) {
  const screen = nodeById(page, nodeId).locator('.xterm-screen');
  await expect(screen).toBeVisible();
  const box = await screen.boundingBox();

  expect(box).not.toBeNull();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, deltaY);
    await settleWebview(page, 2);

    const probeNode = await readProbeNode(page, nodeId, 20);
    if (predicate(probeNode)) {
      return probeNode;
    }
  }

  throw new Error(`Failed to scroll terminal viewport for node ${nodeId}.`);
}

async function dispatchExecutionSnapshot(
  page,
  {
    nodeId,
    kind,
    output,
    cols = 96,
    rows = 28,
    liveSession = true
  }
) {
  await page.evaluate(
    (payload) => {
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/executionSnapshot',
        payload
      });
    },
    {
      nodeId,
      kind,
      output,
      cols,
      rows,
      liveSession
    }
  );
}

async function settleWebview(page, frameCount = 2) {
  await page.evaluate(async (nextFrameCount) => {
    for (let index = 0; index < nextFrameCount; index += 1) {
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    }
  }, frameCount);
}

async function dragTerminalSelection(
  page,
  {
    nodeId,
    startCol,
    endCol,
    row
  }
) {
  const screen = nodeById(page, nodeId).locator('.xterm-screen');
  await expect(screen).toBeVisible();
  const probeNode = await waitForExecutionTerminalReady(page, nodeId);
  const box = await screen.boundingBox();

  expect(box).not.toBeNull();
  expect(probeNode).not.toBeNull();
  expect(probeNode.terminalCols).toBeGreaterThan(0);
  expect(probeNode.terminalRows).toBeGreaterThan(0);

  const cellWidth = box.width / probeNode.terminalCols;
  const cellHeight = box.height / probeNode.terminalRows;
  const y = box.y + (row - 0.5) * cellHeight;
  const startX = box.x + (startCol - 0.75) * cellWidth;
  const endX = box.x + (endCol - 0.25) * cellWidth;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 14 });
  await page.mouse.up();
  await settleWebview(page, 3);
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
        id: 'agent-1',
        kind: 'agent',
        title: 'Agent 1',
        status: 'draft',
        summary: '尚未启动 Agent 会话。',
        position: { x: 80, y: 60 },
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
      },
      {
        id: 'terminal-1',
        kind: 'terminal',
        title: 'Terminal 1',
        status: 'draft',
        summary: '尚未启动嵌入式终端。',
        position: { x: 700, y: 60 },
        size: sizeFor('terminal'),
        metadata: {
          terminal: {
            backend: 'node-pty',
            shellPath: '/bin/bash',
            cwd: '/workspace',
            liveSession: false,
            lastCols: 96,
            lastRows: 28
          }
        }
      },
      {
        id: 'note-1',
        kind: 'note',
        title: '回看 smoke test',
        status: 'ready',
        summary: '补齐真实 VS Code 宿主验证与截图回归。',
        position: { x: 430, y: 420 },
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

function createMinimapContrastState() {
  return {
    version: 1,
    updatedAt: '2026-04-13T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-minimap-left',
        kind: 'agent',
        title: 'Left Edge Agent',
        status: 'draft',
        summary: '让 minimap 可视框切过左上边界。',
        position: { x: -120, y: -20 },
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
      },
      {
        id: 'terminal-minimap-right',
        kind: 'terminal',
        title: 'Right Edge Terminal',
        status: 'draft',
        summary: '让 minimap 可视框切过右边界。',
        position: { x: 960, y: 40 },
        size: sizeFor('terminal'),
        metadata: {
          terminal: {
            backend: 'node-pty',
            shellPath: '/bin/bash',
            cwd: '/workspace',
            liveSession: false,
            lastCols: 96,
            lastRows: 28
          }
        }
      },
      {
        id: 'note-minimap-bottom',
        kind: 'note',
        title: 'Bottom Edge Note',
        status: 'ready',
        summary: '让 minimap 可视框切过下边界。',
        position: { x: 400, y: 650 },
        size: sizeFor('note'),
        metadata: {
          note: {
            content: 'minimap 对比截图需要明确跨过视口边界。'
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

function createLiveExecutionNodeState(kind) {
  const common = {
    version: 1,
    updatedAt: '2026-04-12T00:00:00.000Z',
    nodes: []
  };

  if (kind === 'agent') {
    common.nodes.push({
      id: 'agent-zoom',
      kind: 'agent',
      title: 'Zoom Agent',
      status: 'running',
      summary: '验证缩放后的鼠标拖选坐标。',
      position: { x: 120, y: 140 },
      size: sizeFor('agent'),
      metadata: {
        agent: {
          backend: 'node-pty',
          shellPath: 'codex',
          cwd: '/workspace',
          liveSession: true,
          provider: 'codex',
          runtimeKind: 'pty-cli',
          resumeSupported: false,
          resumeStrategy: 'none',
          lifecycle: 'running',
          lastCols: 96,
          lastRows: 28,
          lastBackendLabel: 'Codex CLI'
        }
      }
    });
    return common;
  }

  if (kind === 'terminal') {
    common.nodes.push({
      id: 'terminal-zoom',
      kind: 'terminal',
      title: 'Zoom Terminal',
      status: 'live',
      summary: '验证缩放后的鼠标拖选坐标。',
      position: { x: 120, y: 140 },
      size: sizeFor('terminal'),
      metadata: {
        terminal: {
          backend: 'node-pty',
          shellPath: '/bin/bash',
          cwd: '/workspace',
          liveSession: true,
          lifecycle: 'live',
          lastCols: 96,
          lastRows: 28
        }
      }
    });
    return common;
  }

  throw new Error(`Unsupported execution kind ${kind}`);
}

function createRuntimeChromeState() {
  return {
    version: 1,
    updatedAt: '2026-04-12T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-runtime',
        kind: 'agent',
        title: 'Runtime Agent',
        status: 'waiting-input',
        summary: 'Codex 已就绪，等待输入。',
        position: { x: 120, y: 140 },
        size: sizeFor('agent'),
        metadata: {
          agent: {
            backend: 'node-pty',
            shellPath: 'codex',
            cwd: '/workspace',
            liveSession: true,
            provider: 'codex',
            lifecycle: 'waiting-input',
            persistenceMode: 'live-runtime',
            attachmentState: 'attached-live',
            runtimeBackend: 'legacy-detached',
            runtimeGuarantee: 'best-effort',
            runtimeSessionId: 'agent-runtime-session',
            lastCols: 96,
            lastRows: 28,
            lastBackendLabel: 'Codex CLI'
          }
        }
      },
      {
        id: 'terminal-runtime',
        kind: 'terminal',
        title: 'Runtime Terminal',
        status: 'live',
        summary: '验证 runtime chrome 收口。',
        position: { x: 520, y: 140 },
        size: sizeFor('terminal'),
        metadata: {
          terminal: {
            backend: 'node-pty',
            shellPath: '/bin/bash',
            cwd: '/workspace',
            liveSession: true,
            lifecycle: 'live',
            persistenceMode: 'live-runtime',
            attachmentState: 'attached-live',
            runtimeBackend: 'systemd-user',
            runtimeGuarantee: 'strong',
            runtimeSessionId: 'terminal-runtime-session',
            lastCols: 96,
            lastRows: 28
          }
        }
      }
    ]
  };
}

function createScrollableTerminalOutput(lineCount) {
  return Array.from({ length: lineCount }, (_value, index) => {
    return `ROW-${String(index).padStart(3, '0')} scroll target`;
  }).join('\r\n') + '\r\n';
}

function sizeFor(kind) {
  switch (kind) {
    case 'agent':
      return { width: 560, height: 430 };
    case 'terminal':
      return { width: 540, height: 420 };
    case 'note':
      return { width: 380, height: 400 };
    default:
      throw new Error(`Unsupported kind ${kind}`);
  }
}
