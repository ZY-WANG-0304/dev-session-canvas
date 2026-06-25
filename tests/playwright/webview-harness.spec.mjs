import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { SerializeAddon } from '@xterm/addon-serialize';
import xtermHeadless from '@xterm/headless';
import { expect, test } from '@playwright/test';

const { Terminal: HeadlessTerminal } = xtermHeadless;
const PRIMARY_ACCELERATOR_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

const harnessUrl = pathToFileURL(
  path.join(process.cwd(), 'tests', 'playwright', 'harness', 'webview-harness.html')
).href;
const pageDiagnosticsByPage = new WeakMap();
const TERMINAL_VIEWPORT_ZOOM = 1.6;
const NODE_FOCUS_ANIMATION_DURATION_MS = 280;
const NOTE_EMBEDDED_CONTENT_MAX_LENGTH = 8000;
const WORKBENCH_THEME_VARS = {
  dark: {
    '--vscode-editor-background': '#1e1e1e',
    '--vscode-editor-foreground': '#cccccc',
    '--vscode-panel-background': '#181818',
    '--vscode-sideBar-background': '#181818',
    '--vscode-editorWidget-background': '#252526',
    '--vscode-panel-border': '#454545',
    '--vscode-widget-border': '#454545',
    '--vscode-focusBorder': '#0078d4',
    '--vscode-list-hoverBackground': '#2a2d2e',
    '--vscode-list-hoverForeground': '#cccccc',
    '--vscode-list-activeSelectionBackground': '#04395e',
    '--vscode-list-activeSelectionForeground': '#ffffff',
    '--vscode-list-inactiveSelectionBackground': '#37373d',
    '--vscode-list-inactiveSelectionForeground': '#cccccc',
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
    '--vscode-terminal-background': '#101722',
    '--vscode-terminal-foreground': '#cccccc',
    '--vscode-terminalCursor-foreground': '#aeafad',
    '--vscode-terminalCursor-background': '#101722',
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
    '--vscode-panel-background': '#f8f8f8',
    '--vscode-sideBar-background': '#f3f3f3',
    '--vscode-editorWidget-background': '#f8f8f8',
    '--vscode-panel-border': '#c8c8c8',
    '--vscode-widget-border': '#c8c8c8',
    '--vscode-focusBorder': '#005fb8',
    '--vscode-list-hoverBackground': '#f0f0f0',
    '--vscode-list-hoverForeground': '#1f1f1f',
    '--vscode-list-activeSelectionBackground': '#cce8ff',
    '--vscode-list-activeSelectionForeground': '#1f1f1f',
    '--vscode-list-inactiveSelectionBackground': '#e5ebf1',
    '--vscode-list-inactiveSelectionForeground': '#1f1f1f',
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
const SPARSE_TERMINAL_THEME_UNSET_VARS = [
  '--vscode-terminal-background',
  '--vscode-terminalCursor-background',
  '--vscode-terminal-selectionForeground',
  '--vscode-terminal-ansiBlack',
  '--vscode-terminal-ansiRed',
  '--vscode-terminal-ansiGreen',
  '--vscode-terminal-ansiYellow',
  '--vscode-terminal-ansiBlue',
  '--vscode-terminal-ansiMagenta',
  '--vscode-terminal-ansiCyan',
  '--vscode-terminal-ansiWhite',
  '--vscode-terminal-ansiBrightBlack',
  '--vscode-terminal-ansiBrightRed',
  '--vscode-terminal-ansiBrightGreen',
  '--vscode-terminal-ansiBrightYellow',
  '--vscode-terminal-ansiBrightBlue',
  '--vscode-terminal-ansiBrightMagenta',
  '--vscode-terminal-ansiBrightCyan',
  '--vscode-terminal-ansiBrightWhite'
];
const WORKBENCH_THEME_FIXTURES = {
  dark: {
    kind: 'dark',
    themeId: 'Harness Dark',
    themeVars: WORKBENCH_THEME_VARS.dark
  },
  light: {
    kind: 'light',
    themeId: 'Harness Light',
    themeVars: WORKBENCH_THEME_VARS.light
  },
  darkSparse: {
    kind: 'dark',
    themeId: 'Harness Dark Modern Sparse',
    themeVars: {
      ...WORKBENCH_THEME_VARS.dark,
      '--vscode-editor-background': '#1f1f1f',
      '--vscode-editorWidget-background': '#202020',
      '--vscode-panel-background': '#181818',
      '--vscode-panel-border': '#2b2b2b',
      '--vscode-widget-border': '#313131',
      '--vscode-terminal-foreground': '#cccccc',
      '--vscode-terminalCursor-foreground': '#aeafad'
    },
    unsetVars: SPARSE_TERMINAL_THEME_UNSET_VARS
  },
  lightSparse: {
    kind: 'light',
    themeId: 'Harness Light Modern Sparse',
    themeVars: {
      ...WORKBENCH_THEME_VARS.light,
      '--vscode-editor-background': '#ffffff',
      '--vscode-editor-foreground': '#3b3b3b',
      '--vscode-editorWidget-background': '#f8f8f8',
      '--vscode-panel-background': '#f8f8f8',
      '--vscode-panel-border': '#e5e5e5',
      '--vscode-widget-border': '#e5e5e5',
      '--vscode-terminal-foreground': '#3b3b3b',
      '--vscode-terminalCursor-foreground': '#005fb8',
      '--vscode-terminal-inactiveSelectionBackground': '#e5ebf1'
    },
    unsetVars: SPARSE_TERMINAL_THEME_UNSET_VARS
  }
};
const WORKBENCH_THEME_VAR_NAMES = Array.from(
  new Set(
    Object.values(WORKBENCH_THEME_FIXTURES).flatMap((fixture) => [
      ...Object.keys(fixture.themeVars),
      ...(fixture.unsetVars ?? [])
    ])
  )
);

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
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createCanvasScreenshotState());

  await expect(nodeById(page, 'agent-1').locator('[data-probe-field="provider"]')).toHaveCount(0);
  await expect(nodeById(page, 'agent-1').locator('[data-probe-field="title"]')).toHaveValue('Agent 1');
  await expect(nodeById(page, 'terminal-1').locator('[data-probe-field="title"]')).toHaveValue('Terminal 1');
  await expect(nodeById(page, 'note-1').locator('[data-probe-field="title"]')).toHaveValue('回看 smoke test');
  await expect(page.locator('.canvas-shell')).toHaveScreenshot('canvas-shell-baseline.png', {
    animations: 'disabled',
    caret: 'hide'
  });
});

test('lifecycle identity acks bootstrap and ignores stale bootstrap frames', async ({ page }) => {
  await openHarness(page);
  const readyMessage = await waitForPostedMessageByType(page, 'webview/ready', { includeLifecycle: true });
  expect(readyMessage.lifecycle).toMatchObject({
    surface: 'panel',
    mode: 'active',
    generation: 1
  });
  expect(readyMessage.lifecycle.frameId).toMatch(/^frame-/);

  const staleState = createEmptyCanvasState();
  const currentState = createCanvasScreenshotState();

  await page.evaluate(({ nextState, nextRuntime }) => {
    window.__devSessionCanvasHarness.clearPostedMessages();
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/bootstrap',
      lifecycle: {
        surface: 'panel',
        mode: 'active',
        generation: 0,
        frameId: 'frame-stale'
      },
      payload: {
        state: nextState,
        runtime: nextRuntime
      }
    });
  }, { nextState: staleState, nextRuntime: createRuntimeContext() });
  await settleWebview(page, 3);

  expect(await page.locator('.react-flow__node').count()).toBe(0);
  expect(await readPostedMessagesByType(page, 'webview/bootstrapAck', { includeLifecycle: true })).toHaveLength(0);

  await bootstrap(page, currentState);
  const bootstrapAck = await waitForPostedMessageByType(page, 'webview/bootstrapAck', { includeLifecycle: true });
  expect(bootstrapAck.lifecycle).toMatchObject({
    surface: 'panel',
    mode: 'active',
    generation: 1
  });
  await expect(nodeById(page, 'agent-1')).toBeVisible();
});

test('lifecycle identity rejects missing lifecycle host bootstrap', async ({ page }) => {
  await openHarness(page);
  const currentState = createCanvasScreenshotState();

  await page.evaluate(({ nextState, nextRuntime }) => {
    window.__devSessionCanvasHarness.clearPostedMessages();
    window.__devSessionCanvasHarness.dispatchRawHostMessage({
      type: 'host/bootstrap',
      payload: {
        state: nextState,
        runtime: nextRuntime
      }
    });
  }, { nextState: currentState, nextRuntime: createRuntimeContext() });
  await settleWebview(page, 3);

  expect(await page.locator('.react-flow__node').count()).toBe(0);
  expect(await readPostedMessagesByType(page, 'webview/bootstrapAck')).toHaveLength(0);
  const diagnostic = await waitForPostedMessageByType(page, 'webview/runtimeDiagnostic');
  expect(diagnostic.payload).toMatchObject({
    source: 'webview.lifecycle',
    message: 'ignore host message without lifecycle: host/bootstrap'
  });
});

test('manual edges can be created, selected, edited, and deleted', async ({ page }) => {
  const state = createCanvasScreenshotState();

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state);
  await clearPostedMessages(page);

  await dragConnectionBetweenAnchors(page, {
    sourceNodeId: 'agent-1',
    sourceAnchor: 'right',
    targetNodeId: 'terminal-1',
    targetAnchor: 'left'
  });

  let message = await waitForPostedMessageByType(page, 'webview/createEdge');
  expect(message.payload).toEqual({
    sourceNodeId: 'agent-1',
    targetNodeId: 'terminal-1',
    sourceAnchor: 'right',
    targetAnchor: 'left'
  });

  state.edges = [
    {
      id: 'edge-user-1',
      sourceNodeId: 'agent-1',
      targetNodeId: 'terminal-1',
      sourceAnchor: 'right',
      targetAnchor: 'left',
      arrowMode: 'forward',
      owner: 'user'
    }
  ];
  await updateHostState(page, state);

  await expect
    .poll(async () => {
      const edge = await readProbeEdge(page, 'edge-user-1', 20);
      return edge
        ? JSON.stringify({
            arrowMode: edge.arrowMode,
            label: edge.label,
            selected: edge.selected
          })
        : null;
    })
    .toBe(
      JSON.stringify({
        arrowMode: 'forward',
        label: null,
        selected: false
      })
    );
  const edgePath = page.locator('[data-edge-probe="true"][data-edge-id="edge-user-1"]');
  await expect.poll(async () => edgePath.evaluate((node) => node.style.stroke)).toBe(
    'var(--canvas-edge-stroke-default)'
  );

  await performTestDomAction(page, {
    kind: 'selectEdge',
    nodeId: 'agent-1',
    edgeId: 'edge-user-1'
  });
  await expect.poll(async () => edgePath.evaluate((node) => node.style.stroke)).toBe(
    'var(--canvas-edge-stroke-default)'
  );
  await expect.poll(async () => (await readProbeEdge(page, 'edge-user-1', 20))?.selected ?? false).toBe(true);
  await expect(page.locator('.canvas-edge-label.is-selected')).toHaveCount(0);
  const edgeToolbar = page.locator(
    '[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-user-1"]'
  );
  await expect(edgeToolbar).toBeVisible();

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '切换箭头模式' }).click();
  const edgeArrowMenu = page.locator(
    '[data-edge-arrow-menu="true"][data-edge-arrow-menu-edge-id="edge-user-1"]'
  );
  await expect(edgeArrowMenu).toBeVisible();
  await edgeArrowMenu.getByRole('button', { name: '双向箭头' }).click();
  message = await waitForPostedMessageByType(page, 'webview/updateEdge');
  expect(message.payload).toEqual({
    edgeId: 'edge-user-1',
    arrowMode: 'both'
  });

  state.edges = [
    {
      ...state.edges[0],
      arrowMode: 'both'
    }
  ];
  await updateHostState(page, state);
  await expect.poll(async () => (await readProbeEdge(page, 'edge-user-1', 20))?.arrowMode ?? null).toBe('both');

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '设置颜色' }).click();
  const edgeColorMenu = page.locator(
    '[data-edge-color-menu="true"][data-edge-color-menu-edge-id="edge-user-1"]'
  );
  await expect(edgeColorMenu).toBeVisible();
  await edgeColorMenu.getByRole('button', { name: '绿色' }).click();
  message = await waitForPostedMessageByType(page, 'webview/updateEdge');
  expect(message.payload).toEqual({
    edgeId: 'edge-user-1',
    color: '4'
  });

  state.edges = [
    {
      ...state.edges[0],
      color: '4'
    }
  ];
  await updateHostState(page, state);
  await expect.poll(async () => edgePath.evaluate((node) => node.style.stroke)).toBe('var(--canvas-edge-color-4)');

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '设置颜色' }).click();
  await expect(edgeColorMenu).toBeVisible();
  await edgeColorMenu.getByRole('button', { name: '默认颜色' }).click();
  message = await waitForPostedMessageByType(page, 'webview/updateEdge');
  expect(message.payload).toEqual({
    edgeId: 'edge-user-1',
    color: null
  });

  state.edges = [
    {
      ...state.edges[0],
      color: undefined
    }
  ];
  await updateHostState(page, state);
  await expect.poll(async () => edgePath.evaluate((node) => node.style.stroke)).toBe(
    'var(--canvas-edge-stroke-default)'
  );

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '编辑标签' }).click();
  const edgeLabelEditor = page.locator(
    '[data-edge-label-editor="true"][data-edge-label-editor-edge-id="edge-user-1"]'
  );
  await expect(edgeLabelEditor).toBeVisible();
  await edgeLabelEditor.fill('依赖关系');
  await edgeLabelEditor.press('Enter');
  message = await waitForPostedMessageByType(page, 'webview/updateEdge');
  expect(message.payload).toEqual({
    edgeId: 'edge-user-1',
    label: '依赖关系'
  });

  state.edges = [
    {
      ...state.edges[0],
      label: '依赖关系'
    }
  ];
  await updateHostState(page, state);
  await expect.poll(async () => (await readProbeEdge(page, 'edge-user-1', 20))?.label ?? null).toBe('依赖关系');
  const edgeLabel = page.locator('[data-edge-label="true"][data-edge-label-edge-id="edge-user-1"]');
  await expect(edgeLabel).toContainText('依赖关系');
  await expect.poll(async () => edgeLabelIsProtected(page, 'edge-user-1')).toBe(true);
  const toolbarBox = await edgeToolbar.boundingBox();
  const labelBox = await edgeLabel.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(toolbarBox.y + toolbarBox.height).toBeLessThan(labelBox.y + 2);

  await clearPostedMessages(page);
  await edgePath.dblclick({ force: true });
  await expect(edgeLabelEditor).toBeVisible();
  await expect(edgeLabelEditor).toHaveValue('依赖关系');
  const editorBox = await edgeLabelEditor.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(Math.abs(editorBox.x + editorBox.width / 2 - (labelBox.x + labelBox.width / 2))).toBeLessThanOrEqual(4);
  expect(Math.abs(editorBox.y + editorBox.height / 2 - (labelBox.y + labelBox.height / 2))).toBeLessThanOrEqual(4);
  await edgeLabelEditor.fill('很长的关系标签');
  await settleWebview(page, 1);
  const longEditorBox = await edgeLabelEditor.boundingBox();
  expect(longEditorBox).not.toBeNull();
  await edgeLabelEditor.fill('短');
  await settleWebview(page, 1);
  const shortEditorBox = await edgeLabelEditor.boundingBox();
  expect(shortEditorBox).not.toBeNull();
  expect(shortEditorBox.width).toBeLessThan(longEditorBox.width - 20);
  await edgeLabelEditor.fill('协作关系');
  await edgeLabelEditor.press('Escape');
  await settleWebview(page, 2);
  await expect(edgeLabelEditor).toHaveCount(0);
  await expect(edgeLabel).toContainText('依赖关系');

  await clearPostedMessages(page);
  await reconnectEdgeEndpointToAnchor(page, {
    edgeId: 'edge-user-1',
    handleType: 'target',
    targetNodeId: 'note-1',
    targetAnchor: 'left'
  });
  message = await waitForPostedMessageByType(page, 'webview/updateEdge');
  expect(message.payload).toEqual({
    edgeId: 'edge-user-1',
    sourceNodeId: 'agent-1',
    targetNodeId: 'note-1',
    sourceAnchor: 'right',
    targetAnchor: 'left'
  });

  state.edges = [
    {
      ...state.edges[0],
      targetNodeId: 'note-1',
      targetAnchor: 'left'
    }
  ];
  await updateHostState(page, state);
  await expect.poll(async () => (await readProbeEdge(page, 'edge-user-1', 20))?.targetNodeId ?? null).toBe('note-1');

  await performTestDomAction(page, {
    kind: 'selectEdge',
    nodeId: 'agent-1',
    edgeId: 'edge-user-1'
  });
  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '删除连线' }).click();
  message = await waitForPostedMessageByType(page, 'webview/deleteEdge');
  expect(message.payload).toEqual({
    edgeId: 'edge-user-1'
  });

  state.edges = [];
  await updateHostState(page, state);
  await expect.poll(async () => (await requestWebviewProbe(page, 20)).edgeCount).toBe(0);
});

test('selected node midpoint handles can start connections while resize affordance is visible', async ({ page }) => {
  const state = createCanvasScreenshotState();

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state);

  await performTestDomAction(page, {
    kind: 'selectNode',
    nodeId: 'agent-1'
  });
  await expect(nodeById(page, 'agent-1').locator('[data-node-resize-direction]')).toHaveCount(8);

  for (const sourceAnchor of ['top', 'right', 'bottom', 'left']) {
    await clearPostedMessages(page);
    await dragConnectionBetweenAnchors(page, {
      sourceNodeId: 'agent-1',
      sourceAnchor,
      targetNodeId: 'terminal-1',
      targetAnchor: 'left'
    });

    const message = await waitForPostedMessageByType(page, 'webview/createEdge');
    expect(message.payload).toEqual({
      sourceNodeId: 'agent-1',
      targetNodeId: 'terminal-1',
      sourceAnchor,
      targetAnchor: 'left'
    });
  }
});

test('edge label IME confirmation does not submit before explicit commit', async ({ page }) => {
  const state = createCanvasScreenshotState();
  state.edges = [
    {
      id: 'edge-user-1',
      sourceNodeId: 'agent-1',
      targetNodeId: 'terminal-1',
      sourceAnchor: 'right',
      targetAnchor: 'left',
      arrowMode: 'forward',
      owner: 'user'
    }
  ];

  await openHarness(page);
  await bootstrap(page, state);
  await expect(page.locator('[data-edge-hitbox="true"][data-edge-id="edge-user-1"]')).toHaveCount(1);
  await performTestDomAction(page, {
    kind: 'selectEdge',
    nodeId: 'agent-1',
    edgeId: 'edge-user-1'
  });

  const edgeToolbar = page.locator(
    '[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-user-1"]'
  );
  await expect(edgeToolbar).toBeVisible();

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '编辑标签' }).click();
  const edgeLabelEditor = page.locator(
    '[data-edge-label-editor="true"][data-edge-label-editor-edge-id="edge-user-1"]'
  );
  await expect(edgeLabelEditor).toBeVisible();

  const nextLabel = '依赖关系';
  await simulateImeCompositionOnTextField(page, edgeLabelEditor, nextLabel);
  await settleWebview(page, 4);

  await expect(edgeLabelEditor).toBeFocused();
  await expect(edgeLabelEditor).toHaveValue(nextLabel);
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((entry) => entry.type === 'webview/updateEdge').length;
      });
    })
    .toBe(0);

  await edgeLabelEditor.press('Enter');
  await settleWebview(page, 4);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const edgeMessages = window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((entry) => entry.type === 'webview/updateEdge');

        return JSON.stringify(
          edgeMessages.map((entry) => ({
            edgeId: entry.payload.edgeId,
            label: entry.payload.label
          }))
        );
      });
    })
    .toBe(
      JSON.stringify([
        {
          edgeId: 'edge-user-1',
          label: nextLabel
        }
      ])
    );
});

test('self loop edges can be created and rendered', async ({ page }) => {
  const state = createCanvasScreenshotState();

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state);
  await clearPostedMessages(page);

  await dragConnectionBetweenAnchors(page, {
    sourceNodeId: 'agent-1',
    sourceAnchor: 'right',
    targetNodeId: 'agent-1',
    targetAnchor: 'bottom'
  });

  const message = await waitForPostedMessageByType(page, 'webview/createEdge');
  expect(message.payload).toEqual({
    sourceNodeId: 'agent-1',
    targetNodeId: 'agent-1',
    sourceAnchor: 'right',
    targetAnchor: 'bottom'
  });

  state.edges = [
    {
      id: 'edge-self-1',
      sourceNodeId: 'agent-1',
      targetNodeId: 'agent-1',
      sourceAnchor: 'right',
      targetAnchor: 'bottom',
      arrowMode: 'forward',
      owner: 'user',
      label: '自环'
    }
  ];
  await updateHostState(page, state);

  await expect
    .poll(async () => {
      const edge = await readProbeEdge(page, 'edge-self-1', 20);
      return edge
        ? JSON.stringify({
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            label: edge.label
          })
        : null;
    })
    .toBe(
      JSON.stringify({
        sourceNodeId: 'agent-1',
        targetNodeId: 'agent-1',
        label: '自环'
      })
    );
  await expect(page.locator('[data-edge-probe="true"][data-edge-id="edge-self-1"]')).toBeVisible();
  await expect(page.locator('.canvas-edge-label')).toContainText('自环');
});

test('workspace root groups reject cross-root edge creation and reconnect', async ({ page }) => {
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('frontend-note', { x: 180, y: 160 }),
      groupId: 'workspace-root-frontend'
    },
    {
      ...createManualNoteNode('backend-note', { x: 980, y: 160 }),
      groupId: 'workspace-root-backend'
    },
    {
      ...createManualNoteNode('frontend-peer', { x: 380, y: 160 }),
      groupId: 'workspace-root-frontend'
    }
  ];
  state.groups = [
    {
      id: 'workspace-root-frontend',
      title: 'frontend',
      position: { x: 80, y: 80 },
      size: { width: 640, height: 360 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    },
    {
      id: 'workspace-root-backend',
      title: 'backend',
      position: { x: 880, y: 80 },
      size: { width: 640, height: 360 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/backend'
    }
  ];

  await openHarness(page);
  await bootstrap(page, state);
  await clearPostedMessages(page);

  await dragConnectionBetweenAnchors(page, {
    sourceNodeId: 'frontend-note',
    sourceAnchor: 'right',
    targetNodeId: 'backend-note',
    targetAnchor: 'left'
  });

  await expect
    .poll(async () => (await readPostedMessagesByType(page, 'webview/createEdge')).length)
    .toBe(0);

  state.edges = [
    {
      id: 'edge-frontend',
      sourceNodeId: 'frontend-note',
      targetNodeId: 'frontend-peer',
      sourceAnchor: 'right',
      targetAnchor: 'left',
      arrowMode: 'forward',
      owner: 'user'
    }
  ];
  await updateHostState(page, state);
  await expect.poll(async () => (await readProbeEdge(page, 'edge-frontend', 20))?.targetNodeId ?? null).toBe('frontend-peer');

  await performTestDomAction(page, {
    kind: 'selectEdge',
    nodeId: 'frontend-note',
    edgeId: 'edge-frontend'
  });
  await clearPostedMessages(page);
  await reconnectEdgeEndpointToAnchor(page, {
    edgeId: 'edge-frontend',
    handleType: 'target',
    targetNodeId: 'backend-note',
    targetAnchor: 'left'
  });

  await expect
    .poll(async () => (await readPostedMessagesByType(page, 'webview/updateEdge')).length)
    .toBe(0);
});

test('pane gallery renders dynamic workspace roots with canvas controls and light labels', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  const state = createPaneGalleryCanvasState();
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  await expect(page.locator('[data-pane-gallery="true"]')).toBeVisible();
  await expect(page.locator('[data-pane-gallery-layout="dynamic"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-toolbar')).toHaveCount(0);
  await expect(page.getByLabel('Filter workspace roots')).toHaveCount(0);
  await expect(page.getByLabel('切换 workspace pane 模式')).toHaveCount(0);
  await expect(page.locator('[data-pane-gallery-root-id]')).toHaveCount(2);

  const frontendPane = page.locator('[data-pane-gallery-root-id="workspace-root-frontend"]');
  const backendPane = page.locator('[data-pane-gallery-root-id="workspace-root-backend"]');
  await expect(frontendPane.locator('.pane-gallery-root-title')).toHaveText('Frontend');
  await expect(frontendPane.locator('.pane-gallery-root-title')).toHaveAttribute('title', '/repo/frontend');
  await expect(backendPane.locator('.pane-gallery-root-meta')).toHaveCount(0);
  await expect(frontendPane.locator('.pane-gallery-canvas-controls')).toBeVisible();
  await expect(backendPane.locator('.pane-gallery-canvas-controls')).toBeVisible();
  await expect(frontendPane).toHaveAttribute('data-pane-gallery-status', 'idle');
  await expect(backendPane).toHaveAttribute('data-pane-gallery-status', 'running');
  await expect(backendPane).toHaveAttribute('aria-label', /1 个节点正在运行/);
  await expect(backendPane).toHaveAttribute('data-pane-gallery-running-count', '1');
  await expect(backendPane).toHaveAttribute('data-pane-gallery-attention-count', '0');
  await expect
    .poll(async () =>
      backendPane.locator('.pane-gallery-root-header').evaluate((header) => getComputedStyle(header).backgroundColor)
    )
    .not.toBe(
      await frontendPane.locator('.pane-gallery-root-header').evaluate((header) => getComputedStyle(header).backgroundColor)
    );
  await expect(page.locator('.canvas-help-panel .execution-help-trigger-canvas')).toBeVisible();
  await expect(frontendPane.locator('[data-group-background-role="workspace-root"]')).toHaveCount(0);
  await expect(frontendPane.locator('[data-root-name-watermark="true"]')).toHaveCount(0);

  await clearPostedMessages(page);
  await backendPane.locator('.react-flow__pane').click({
    button: 'right',
    position: {
      x: 120,
      y: 150
    }
  });
  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-menu-kind="note"]').click();
  const createPayload = await waitForCreateDemoNodePayload(page);
  expect(createPayload.kind).toBe('note');
  expect(createPayload.targetGroupId).toBe('workspace-root-backend');
  expect(Number.isFinite(createPayload.preferredPosition.x)).toBe(true);
  expect(Number.isFinite(createPayload.preferredPosition.y)).toBe(true);
});

test('pane gallery lower-left mode control switches layouts and canvas thumbnails', async ({ page }) => {
  await openHarness(page);
  const state = createPaneGalleryCanvasState({ rootCount: 3 });
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const frontendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"]');
  await expect(frontendTile.locator('[data-pane-gallery-mode-trigger="true"] .codicon-eye')).toHaveCount(1);
  await frontendTile.locator('[data-pane-gallery-mode-trigger="true"]').hover();
  await expect(frontendTile.locator('[data-pane-gallery-mode-option]')).toHaveCount(4);
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="dynamic"]')).toContainText('动态');
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="grid"]')).toContainText('宫格');
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="topThumbnails"]')).toContainText('顶部缩略图');
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="sideThumbnails"]')).toContainText('右侧缩略图');
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="dynamic"]')).toHaveAttribute('aria-checked', 'true');
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="dynamic"] .codicon-layout')).toHaveCount(1);
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="topThumbnails"] .codicon-split-vertical')).toHaveCount(1);
  await expect(frontendTile.locator('[data-pane-gallery-mode-option="sideThumbnails"] .codicon-split-horizontal')).toHaveCount(1);

  await frontendTile.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-tile .canvas-minimap')).toHaveCount(0);
  await expect(page.locator('.pane-gallery-root-pane-main .canvas-minimap')).toHaveCount(1);
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-frontend'
  );

  let mainPane = page.locator('.pane-gallery-root-pane-main');
  await expect(mainPane.locator('[data-pane-gallery-mode-trigger="true"] .codicon-globe')).toHaveCount(1);
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').hover();
  await expect(mainPane.locator('[data-pane-gallery-mode-option]')).toHaveCount(4);
  await expect(mainPane.locator('[data-pane-gallery-mode-option="dynamic"]')).toContainText('动态');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="grid"]')).toContainText('宫格');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="topThumbnails"]')).toContainText('顶部缩略图');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="sideThumbnails"]')).toContainText('右侧缩略图');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="sideThumbnails"]')).toHaveAttribute('aria-checked', 'true');
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="dynamic"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-tile')).toHaveCount(3);
  await expect(page.locator('.pane-gallery-root-pane-tile .canvas-minimap')).toHaveCount(0);
  await expect
    .poll(async () => (await readPersistedUiState(page)).paneGallery?.layout)
    .toBe('dynamic');

  await frontendTile.locator('[data-pane-gallery-mode-trigger="true"]').hover();
  await frontendTile.locator('[data-pane-gallery-mode-option="topThumbnails"]').click();
  await expect(page.locator('[data-pane-gallery-layout="topThumbnails"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-frontend'
  );
  await expect(page.locator('.pane-gallery-root-pane-main .pane-gallery-canvas-controls')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-main .canvas-minimap')).toHaveCount(1);
  await expect(page.locator('.pane-gallery-root-pane-thumbnail')).toHaveCount(2);
  await expect(page.locator('.pane-gallery-root-pane-thumbnail .react-flow')).toHaveCount(2);
  await expect(page.locator('.pane-gallery-thumbnail-preview svg')).toHaveCount(0);
  await expect(page.locator('.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-backend"] .pane-gallery-root-title')).toHaveText('Backend');
  await expect(page.locator('.pane-gallery-root-pane-thumbnail .pane-gallery-root-meta')).toHaveCount(0);

  const topTrackAlignment = await page.locator('.pane-gallery-thumbnail-rail-topThumbnails').evaluate((rail) => {
    const track = rail.querySelector('.pane-gallery-thumbnail-track');
    const railRect = rail.getBoundingClientRect();
    const trackRect = track instanceof HTMLElement ? track.getBoundingClientRect() : null;
    return trackRect
      ? {
          leading: trackRect.left - railRect.left,
          trailing: railRect.right - trackRect.right
        }
      : null;
  });
  expect(topTrackAlignment?.leading).toBeGreaterThan(0);
  expect(Math.abs((topTrackAlignment?.leading ?? 0) - (topTrackAlignment?.trailing ?? 0))).toBeLessThanOrEqual(1);

  await clearPostedMessages(page);
  const backendThumbnail = page.locator('.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-backend"]');
  await backendThumbnail.click();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-frontend'
  );
  expect(await readPostedMessagesByType(page, 'webview/createDemoNode')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/moveNode')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/dropNoteMarkdownFiles')).toEqual([]);

  await backendThumbnail.dblclick();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-backend'
  );
  await expect
    .poll(async () => (await readPersistedUiState(page)).paneGallery?.activeRootGroupId)
    .toBe('workspace-root-backend');
  expect(await readPostedMessagesByType(page, 'webview/createDemoNode')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/moveNode')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/dropNoteMarkdownFiles')).toEqual([]);

  mainPane = page.locator('.pane-gallery-root-pane-main');
  await expect(mainPane.locator('[data-pane-gallery-mode-trigger="true"] .codicon-globe')).toHaveCount(1);
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').hover();
  await expect(mainPane.locator('[data-pane-gallery-mode-option]')).toHaveCount(4);
  await expect(mainPane.locator('[data-pane-gallery-mode-option="dynamic"]')).toContainText('动态');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="grid"]')).toContainText('宫格');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="topThumbnails"]')).toContainText('顶部缩略图');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="sideThumbnails"]')).toContainText('右侧缩略图');
  await expect(mainPane.locator('[data-pane-gallery-mode-option="topThumbnails"] .codicon-split-vertical')).toHaveCount(1);
  await expect(mainPane.locator('[data-pane-gallery-mode-option="sideThumbnails"] .codicon-split-horizontal')).toHaveCount(1);
  await expect(mainPane.locator('[data-pane-gallery-mode-option="dynamic"] .codicon-layout')).toHaveCount(1);

  await mainPane.locator('[data-pane-gallery-mode-option="grid"]').click();
  await expect(page.locator('[data-pane-gallery-layout="grid"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-tile')).toHaveCount(3);
  await expect(page.locator('.pane-gallery-root-pane-tile .canvas-minimap')).toHaveCount(0);
  await expect(page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-backend"] [data-pane-gallery-mode-trigger="true"] .codicon-eye')).toHaveCount(1);
  await expect
    .poll(async () => (await readPersistedUiState(page)).paneGallery?.layout)
    .toBe('grid');

  const backendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-backend"]');
  await backendTile.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="topThumbnails"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-backend'
  );
  await expect(page.locator('.pane-gallery-root-pane-main .canvas-minimap')).toHaveCount(1);
  await expect
    .poll(async () => (await readPersistedUiState(page)).paneGallery?.lastOverviewLayout)
    .toBe('grid');
  await expect
    .poll(async () => (await readPersistedUiState(page)).paneGallery?.lastThumbnailLayout)
    .toBe('topThumbnails');

  mainPane = page.locator('.pane-gallery-root-pane-main');
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="grid"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-tile .canvas-minimap')).toHaveCount(0);

  await page
    .locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-backend"] [data-pane-gallery-mode-trigger="true"]')
    .click();
  await expect(page.locator('[data-pane-gallery-layout="topThumbnails"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-thumbnail')).toHaveCount(2);
  const rememberedTopTrackAlignment = await page.locator('.pane-gallery-thumbnail-rail-topThumbnails').evaluate((rail) => {
    const track = rail.querySelector('.pane-gallery-thumbnail-track');
    const railRect = rail.getBoundingClientRect();
    const trackRect = track instanceof HTMLElement ? track.getBoundingClientRect() : null;
    return trackRect
      ? {
          leading: trackRect.left - railRect.left,
          trailing: railRect.right - trackRect.right
        }
      : null;
  });
  expect(rememberedTopTrackAlignment?.leading).toBeGreaterThan(0);
  expect(
    Math.abs((rememberedTopTrackAlignment?.leading ?? 0) - (rememberedTopTrackAlignment?.trailing ?? 0))
  ).toBeLessThanOrEqual(1);

  mainPane = page.locator('.pane-gallery-root-pane-main');
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').hover();
  await mainPane.locator('[data-pane-gallery-mode-option="sideThumbnails"]').click();
  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  const sideTrackAlignment = await page.locator('.pane-gallery-thumbnail-rail-sideThumbnails').evaluate((rail) => {
    const track = rail.querySelector('.pane-gallery-thumbnail-track');
    const railRect = rail.getBoundingClientRect();
    const trackRect = track instanceof HTMLElement ? track.getBoundingClientRect() : null;
    return trackRect
      ? {
          leading: trackRect.top - railRect.top,
          trailing: railRect.bottom - trackRect.bottom
        }
      : null;
  });
  expect(sideTrackAlignment?.leading).toBeGreaterThan(0);
  expect(Math.abs((sideTrackAlignment?.leading ?? 0) - (sideTrackAlignment?.trailing ?? 0))).toBeLessThanOrEqual(1);
});

test('pane gallery overflowing thumbnail rails keep first and last roots reachable', async ({ page }) => {
  const state = createPaneGalleryCanvasState({ rootCount: 16 });
  const activeRootId = state.groups[0].id;
  const firstThumbnailRootId = state.groups[1].id;
  const lastThumbnailRootId = state.groups.at(-1).id;

  await openHarness(page, {
    persistedState: {
      paneGallery: {
        layout: 'sideThumbnails',
        activeRootGroupId: activeRootId,
        lastOverviewLayout: 'dynamic',
        lastThumbnailLayout: 'sideThumbnails'
      }
    }
  });
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const measureRailReachability = async (layout) => {
    const axis = layout === 'topThumbnails' ? 'x' : 'y';
    const rail = page.locator(`[data-pane-gallery-thumbnail-rail="${layout}"]`);
    await expect(rail).toBeVisible();
    return rail.evaluate(
      (railElement, { firstRootId, lastRootId, scrollAxis }) => {
        const collect = () => {
          const railRect = railElement.getBoundingClientRect();
          const entries = [...railElement.querySelectorAll('.pane-gallery-root-pane-thumbnail')]
            .filter((entry) => entry instanceof HTMLElement)
            .map((entry) => {
              const rect = entry.getBoundingClientRect();
              return {
                id: entry.getAttribute('data-pane-gallery-root-id'),
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left
              };
            });
          const visibleIds = entries
            .filter((entry) =>
              entry.right > railRect.left + 1 &&
              entry.left < railRect.right - 1 &&
              entry.bottom > railRect.top + 1 &&
              entry.top < railRect.bottom - 1
            )
            .map((entry) => entry.id);
          const isFullyVisible = (entry) =>
            entry
              ? scrollAxis === 'x'
                ? entry.left >= railRect.left - 1 && entry.right <= railRect.right + 1
                : entry.top >= railRect.top - 1 && entry.bottom <= railRect.bottom + 1
              : false;
          const firstEntry = entries.find((entry) => entry.id === firstRootId);
          const lastEntry = entries.find((entry) => entry.id === lastRootId);

          return {
            scrollLeft: railElement.scrollLeft,
            scrollTop: railElement.scrollTop,
            visibleIds,
            firstFullyVisible: isFullyVisible(firstEntry),
            lastFullyVisible: isFullyVisible(lastEntry),
            firstOffset: firstEntry
              ? scrollAxis === 'x'
                ? firstEntry.left - railRect.left
                : firstEntry.top - railRect.top
              : null,
            lastOffset: lastEntry
              ? scrollAxis === 'x'
                ? railRect.right - lastEntry.right
                : railRect.bottom - lastEntry.bottom
              : null
          };
        };

        railElement.scrollLeft = 0;
        railElement.scrollTop = 0;
        const start = collect();
        railElement.scrollLeft = railElement.scrollWidth;
        railElement.scrollTop = railElement.scrollHeight;
        const end = collect();

        return {
          axis: scrollAxis,
          railJustifyContent: getComputedStyle(railElement).justifyContent,
          railAlignContent: getComputedStyle(railElement).alignContent,
          scrollMax: scrollAxis === 'x'
            ? railElement.scrollWidth - railElement.clientWidth
            : railElement.scrollHeight - railElement.clientHeight,
          start,
          end
        };
      },
      { firstRootId: firstThumbnailRootId, lastRootId: lastThumbnailRootId, scrollAxis: axis }
    );
  };

  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  const sideRailMetrics = await measureRailReachability('sideThumbnails');
  expect(sideRailMetrics.railAlignContent).not.toContain('safe');
  expect(sideRailMetrics.railAlignContent).not.toBe('center');
  expect(sideRailMetrics.scrollMax).toBeGreaterThan(0);
  expect(sideRailMetrics.start.firstFullyVisible).toBe(true);
  expect(sideRailMetrics.start.visibleIds[0]).toBe(firstThumbnailRootId);
  expect(sideRailMetrics.start.firstOffset).toBeGreaterThanOrEqual(-1);
  expect(sideRailMetrics.end.lastFullyVisible).toBe(true);
  expect(sideRailMetrics.end.visibleIds).toContain(lastThumbnailRootId);
  expect(sideRailMetrics.end.lastOffset).toBeGreaterThanOrEqual(-1);

  const mainPane = page.locator('.pane-gallery-root-pane-main');
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').hover();
  await mainPane.locator('[data-pane-gallery-mode-option="topThumbnails"]').click();
  await expect(page.locator('[data-pane-gallery-layout="topThumbnails"]')).toBeVisible();
  await settleWebview(page, 2);

  const topRailMetrics = await measureRailReachability('topThumbnails');
  expect(topRailMetrics.railJustifyContent).not.toContain('safe');
  expect(topRailMetrics.railJustifyContent).not.toBe('center');
  expect(topRailMetrics.scrollMax).toBeGreaterThan(0);
  expect(topRailMetrics.start.firstFullyVisible).toBe(true);
  expect(topRailMetrics.start.visibleIds[0]).toBe(firstThumbnailRootId);
  expect(topRailMetrics.start.firstOffset).toBeGreaterThanOrEqual(-1);
  expect(topRailMetrics.end.lastFullyVisible).toBe(true);
  expect(topRailMetrics.end.visibleIds).toContain(lastThumbnailRootId);
  expect(topRailMetrics.end.lastOffset).toBeGreaterThanOrEqual(-1);
});

test('pane gallery thumbnail rail follows workspace root order after switching active root', async ({ page }) => {
  const state = createPaneGalleryCanvasState({ rootCount: 4 });
  const groupsById = new Map(state.groups.map((group) => [group.id, group]));
  state.groups = [
    'workspace-root-tools',
    'workspace-root-frontend',
    'workspace-root-mobile',
    'workspace-root-backend'
  ].map((groupId) => {
    const group = groupsById.get(groupId);
    if (!group) {
      throw new Error(`Missing fixture group: ${groupId}`);
    }
    return group;
  });
  const workspaceFolders = [
    { name: 'Frontend', path: '/repo/frontend' },
    { name: 'Backend', path: '/repo/backend' },
    { name: 'Tools', path: '/repo/tools' },
    { name: 'Mobile', path: '/repo/mobile' }
  ];

  await openHarness(page, {
    persistedState: {
      paneGallery: {
        layout: 'sideThumbnails',
        activeRootGroupId: 'workspace-root-frontend',
        lastOverviewLayout: 'dynamic',
        lastThumbnailLayout: 'sideThumbnails'
      }
    }
  });
  await bootstrap(
    page,
    state,
    createRuntimeContext({
      multiRootPresentationMode: 'paneGallery',
      workspaceFolders
    })
  );
  await settleWebview(page, 4);

  const readThumbnailIds = async (layout) =>
    page
      .locator(`[data-pane-gallery-thumbnail-track="${layout}"] .pane-gallery-root-pane-thumbnail`)
      .evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-pane-gallery-root-id')));

  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-frontend'
  );
  expect(await readThumbnailIds('sideThumbnails')).toEqual([
    'workspace-root-backend',
    'workspace-root-tools',
    'workspace-root-mobile'
  ]);

  await page
    .locator('.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-tools"]')
    .dblclick();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-tools'
  );
  expect(await readThumbnailIds('sideThumbnails')).toEqual([
    'workspace-root-frontend',
    'workspace-root-backend',
    'workspace-root-mobile'
  ]);

  const mainPane = page.locator('.pane-gallery-root-pane-main');
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').hover();
  await mainPane.locator('[data-pane-gallery-mode-option="topThumbnails"]').click();
  await expect(page.locator('[data-pane-gallery-layout="topThumbnails"]')).toBeVisible();
  expect(await readThumbnailIds('topThumbnails')).toEqual([
    'workspace-root-frontend',
    'workspace-root-backend',
    'workspace-root-mobile'
  ]);
});

test('pane gallery clears transient selection before roots become thumbnails', async ({ page }) => {
  await openHarness(page);
  const state = createPaneGalleryCanvasState();
  state.edges = [
    {
      id: 'edge-backend',
      sourceNodeId: 'workspace-root-backend-note',
      targetNodeId: 'workspace-root-backend-terminal',
      sourceAnchor: 'right',
      targetAnchor: 'left',
      arrowMode: 'forward',
      owner: 'user'
    },
    {
      id: 'edge-frontend',
      sourceNodeId: 'workspace-root-frontend-note',
      targetNodeId: 'workspace-root-frontend-terminal',
      sourceAnchor: 'right',
      targetAnchor: 'left',
      arrowMode: 'forward',
      owner: 'user'
    }
  ];
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  await performTestDomAction(page, {
    kind: 'selectEdge',
    edgeId: 'edge-backend'
  });
  await expect(page.locator('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-backend"]')).toBeVisible();

  const frontendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"]');
  await frontendTile.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  const backendThumbnail = page.locator(
    '.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-backend"]'
  );
  await expect(backendThumbnail).toBeVisible();
  await expect(backendThumbnail.locator('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-backend"]')).toHaveCount(0);
  await expect(page.locator('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-backend"]')).toHaveCount(0);

  await clearPostedMessages(page);
  await backendThumbnail.click();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-frontend'
  );
  expect(await readPostedMessagesByType(page, 'webview/deleteEdge')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/updateEdge')).toEqual([]);

  await performTestDomAction(page, {
    kind: 'selectEdge',
    edgeId: 'edge-frontend'
  });
  await expect(page.locator('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-frontend"]')).toBeVisible();

  await backendThumbnail.dblclick();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-backend'
  );
  const frontendThumbnail = page.locator(
    '.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-frontend"]'
  );
  await expect(frontendThumbnail.locator('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-frontend"]')).toHaveCount(0);
  await expect(page.locator('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-frontend"]')).toHaveCount(0);
  expect(await readPostedMessagesByType(page, 'webview/deleteEdge')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/updateEdge')).toEqual([]);
});

test('pane gallery thumbnail hit layer blocks execution node attention acknowledgement', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  const state = createPaneGalleryCanvasState();
  const backendTerminal = state.nodes.find((node) => node.id === 'workspace-root-backend-terminal');
  backendTerminal.status = 'running';
  backendTerminal.metadata.terminal.attentionPending = true;

  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const frontendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"]');
  await frontendTile.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();

  const backendThumbnail = page.locator(
    '.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-backend"]'
  );
  const backendTerminalNode = backendThumbnail.locator('[data-node-id="workspace-root-backend-terminal"]');
  await expect(backendThumbnail).toHaveAttribute('data-pane-gallery-status', 'attention');
  await expect(backendThumbnail).toHaveAttribute('data-pane-gallery-attention-count', '1');
  await expect(backendThumbnail).toHaveAttribute('data-pane-gallery-running-count', '1');
  await expect(backendThumbnail).toHaveAttribute('aria-label', /1 个节点需要关注，1 个节点正在运行/);
  await expect(backendThumbnail.locator('[data-pane-gallery-thumbnail-hit-layer="true"]')).toHaveAttribute(
    'title',
    /1 个节点需要关注，1 个节点正在运行/
  );
  await expect
    .poll(async () =>
      backendThumbnail.locator('.pane-gallery-root-header').evaluate((header) => getComputedStyle(header).backgroundColor)
    )
    .not.toBe('rgba(0, 0, 0, 0)');
  await expect(backendTerminalNode.locator('[data-execution-attention-pending="true"]')).toHaveCount(1);
  await expect(backendThumbnail.locator('[data-pane-gallery-thumbnail-hit-layer="true"]')).toBeVisible();
  await expect(backendThumbnail.locator('[data-pane-gallery-thumbnail-hit-layer="true"]')).toHaveCSS(
    'cursor',
    'default'
  );

  const terminalCenter = await backendTerminalNode.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  });
  const hitLayerOwnsTerminalPoint = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return target instanceof Element && target.closest('[data-pane-gallery-thumbnail-hit-layer="true"]') !== null;
  }, terminalCenter);
  expect(hitLayerOwnsTerminalPoint).toBe(true);

  await clearPostedMessages(page);
  await page.mouse.click(terminalCenter.x, terminalCenter.y);
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-frontend'
  );
  expect(await readPostedMessagesByType(page, 'webview/selectNode')).toEqual([]);

  await page.mouse.dblclick(terminalCenter.x, terminalCenter.y);
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-backend'
  );
  expect(await readPostedMessagesByType(page, 'webview/selectNode')).toEqual([]);
});

test('pane gallery fits a root the first time it becomes the main thumbnail pane', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      paneGallery: {
        layout: 'dynamic',
        activeRootGroupId: 'workspace-root-frontend',
        lastOverviewLayout: 'dynamic',
        lastThumbnailLayout: 'sideThumbnails',
        overviewViewports: {
          'workspace-root-backend': {
            x: 5000,
            y: -3000,
            zoom: 2
          }
        }
      }
    }
  });
  const state = createPaneGalleryCanvasState();
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const frontendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"]');
  await frontendTile.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  const backendThumbnail = page.locator(
    '.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-backend"]'
  );

  await backendThumbnail.dblclick();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-backend'
  );
  await expect
    .poll(async () => {
      const paneGallery = (await readPersistedUiState(page)).paneGallery;
      return paneGallery?.mainViewports?.['workspace-root-backend'] ?? null;
    })
    .not.toBeNull();

  const paneGalleryState = (await readPersistedUiState(page)).paneGallery;
  const backendOverviewViewport = paneGalleryState?.overviewViewports?.['workspace-root-backend'];
  const backendMainViewport = paneGalleryState?.mainViewports?.['workspace-root-backend'];
  expect(backendOverviewViewport).toEqual({
    x: 5000,
    y: -3000,
    zoom: 2
  });
  expect(backendMainViewport?.x).not.toBe(5000);
  expect(backendMainViewport?.y).not.toBe(-3000);
  expect(backendMainViewport?.zoom).toBeLessThan(1.95);

  const mainPane = page.locator('.pane-gallery-root-pane-main');
  await mainPane.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="dynamic"]')).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-backend"] .react-flow__viewport')
        .evaluate((viewport) => (viewport instanceof HTMLElement ? viewport.style.transform : null))
    )
    .toContain('translate(5000px, -3000px)');
});

test('pane gallery fits the active root when entering thumbnail mode without a main viewport', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      paneGallery: {
        layout: 'dynamic',
        activeRootGroupId: 'workspace-root-frontend',
        lastOverviewLayout: 'dynamic',
        lastThumbnailLayout: 'sideThumbnails',
        overviewViewports: {
          'workspace-root-frontend': {
            x: 5000,
            y: -3000,
            zoom: 2
          }
        }
      }
    }
  });
  const state = createPaneGalleryCanvasState();
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const frontendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"]');
  await frontendTile.locator('[data-pane-gallery-mode-trigger="true"]').click();
  await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-frontend'
  );

  await expect
    .poll(async () => {
      const paneGallery = (await readPersistedUiState(page)).paneGallery;
      return paneGallery?.mainViewports?.['workspace-root-frontend'] ?? null;
    })
    .not.toBeNull();

  const paneGalleryState = (await readPersistedUiState(page)).paneGallery;
  expect(paneGalleryState?.overviewViewports?.['workspace-root-frontend']).toEqual({
    x: 5000,
    y: -3000,
    zoom: 2
  });
  const frontendMainViewport = paneGalleryState?.mainViewports?.['workspace-root-frontend'];
  expect(frontendMainViewport?.x).not.toBe(5000);
  expect(frontendMainViewport?.y).not.toBe(-3000);
});

test('pane gallery fit view centers visible root content instead of the workspace root frame', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      paneGallery: {
        layout: 'dynamic',
        activeRootGroupId: 'workspace-root-frontend',
        lastOverviewLayout: 'dynamic',
        lastThumbnailLayout: 'sideThumbnails',
        overviewViewports: {
          'workspace-root-frontend': {
            x: 0,
            y: 0,
            zoom: 0.3
          }
        }
      }
    }
  });
  const state = createPaneGalleryCanvasState();
  const frontendGroup = state.groups.find((group) => group.id === 'workspace-root-frontend');
  frontendGroup.position = { x: 0, y: 0 };
  frontendGroup.size = { width: 900, height: 2600 };
  state.nodes.find((node) => node.id === 'workspace-root-frontend-note').position = { x: 120, y: 1840 };
  state.nodes.find((node) => node.id === 'workspace-root-frontend-terminal').position = { x: 560, y: 1840 };
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const frontendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"]');
  await frontendTile.locator('.react-flow__controls-fitview').click();

  await expect
    .poll(async () =>
      frontendTile.evaluate((pane) => {
        const shell = pane.querySelector('.pane-gallery-root-flow-shell');
        const note = pane.querySelector('[data-node-id="workspace-root-frontend-note"]');
        const terminal = pane.querySelector('[data-node-id="workspace-root-frontend-terminal"]');
        if (!(shell instanceof HTMLElement) || !(note instanceof HTMLElement) || !(terminal instanceof HTMLElement)) {
          return Number.POSITIVE_INFINITY;
        }

        const shellBox = shell.getBoundingClientRect();
        const boxes = [note.getBoundingClientRect(), terminal.getBoundingClientRect()];
        const top = Math.min(...boxes.map((box) => box.top));
        const bottom = Math.max(...boxes.map((box) => box.bottom));
        const contentCenterY = (top + bottom) / 2;
        const shellCenterY = shellBox.top + shellBox.height / 2;
        return Math.abs(contentCenterY - shellCenterY);
      })
    )
    .toBeLessThan(18);
});

test('pane gallery fit view leaves an empty root viewport unchanged', async ({ page }) => {
  const unchangedViewport = {
    x: 123,
    y: -45,
    zoom: 0.75
  };
  await openHarness(page, {
    persistedState: {
      paneGallery: {
        layout: 'dynamic',
        activeRootGroupId: 'workspace-root-frontend',
        lastOverviewLayout: 'dynamic',
        lastThumbnailLayout: 'sideThumbnails',
        overviewViewports: {
          'workspace-root-frontend': unchangedViewport
        }
      }
    }
  });
  const state = createPaneGalleryCanvasState();
  const frontendGroup = state.groups.find((group) => group.id === 'workspace-root-frontend');
  frontendGroup.size = { width: 900, height: 2600 };
  state.nodes = state.nodes.filter((node) => !node.id.startsWith('workspace-root-frontend-'));
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const frontendTile = page.locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"]');
  await frontendTile.locator('.react-flow__controls-fitview').click();
  await settleWebview(page, 4);

  expect((await readPersistedUiState(page)).paneGallery?.overviewViewports?.['workspace-root-frontend']).toEqual(
    unchangedViewport
  );
});

test('pane gallery restores the saved main viewport when switching thumbnail roots', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      paneGallery: {
        layout: 'sideThumbnails',
        activeRootGroupId: 'workspace-root-frontend',
        lastOverviewLayout: 'dynamic',
        lastThumbnailLayout: 'sideThumbnails',
        mainViewports: {
          'workspace-root-backend': {
            x: -700,
            y: -200,
            zoom: 1.2
          }
        }
      }
    }
  });
  const state = createPaneGalleryCanvasState();
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  const backendThumbnail = page.locator(
    '.pane-gallery-root-pane-thumbnail[data-pane-gallery-root-id="workspace-root-backend"]'
  );
  await backendThumbnail.dblclick();
  await expect(page.locator('.pane-gallery-root-pane-main')).toHaveAttribute(
    'data-pane-gallery-root-id',
    'workspace-root-backend'
  );
  await expect
    .poll(async () =>
      page
        .locator('.pane-gallery-root-pane-main .react-flow__viewport')
        .evaluate((viewport) => (viewport instanceof HTMLElement ? viewport.style.transform : null))
    )
    .toContain('translate(-700px, -200px) scale(1.2)');
  expect((await readPersistedUiState(page)).paneGallery?.mainViewports?.['workspace-root-backend']).toEqual({
    x: -700,
    y: -200,
    zoom: 1.2
  });
});

test('pane gallery keeps panes scrollable without fixed zoom floor and targets markdown drops', async ({ page }) => {
  await openHarness(page);
  const state = createPaneGalleryCanvasState({ rootCount: 8, hugeFirstRoot: true });
  await bootstrap(page, state, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  await settleWebview(page, 4);

  await expect
    .poll(async () => page.locator('[data-pane-gallery-root-id="workspace-root-frontend"]').getAttribute('data-canvas-overview-mode'))
    .toBe('true');
  await expect
    .poll(async () => page.locator('[data-pane-gallery-root-id="workspace-root-backend"]').getAttribute('data-canvas-overview-mode'))
    .toBe('false');

  const galleryMetrics = await page.locator('.pane-gallery-grid').evaluate((grid) => {
    const pane = grid.querySelector('[data-pane-gallery-root-id="workspace-root-frontend"]');
    const flowViewport = pane?.querySelector('.react-flow__viewport');
    const paneBox = pane instanceof HTMLElement ? pane.getBoundingClientRect() : null;
    const transform = flowViewport instanceof HTMLElement ? getComputedStyle(flowViewport).transform : '';
    const scale = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).a : null;
    const paneBoxes = [...grid.querySelectorAll('.pane-gallery-root-pane')]
      .filter((entry) => entry instanceof HTMLElement)
      .map((entry) => {
        const box = entry.getBoundingClientRect();
        return {
          width: Math.round(box.width),
          height: Math.round(box.height)
        };
      });
    return {
      scrolls: grid.scrollHeight > grid.clientHeight + 20,
      paneWidth: paneBox?.width ?? 0,
      paneHeight: paneBox?.height ?? 0,
      scale,
      distinctPaneSizes: new Set(paneBoxes.map((box) => `${box.width}x${box.height}`)).size
    };
  });
  expect(galleryMetrics.scrolls).toBe(true);
  expect(galleryMetrics.paneWidth).toBeGreaterThanOrEqual(420);
  expect(galleryMetrics.paneHeight).toBeGreaterThanOrEqual(320);
  expect(galleryMetrics.distinctPaneSizes).toBeGreaterThan(1);
  expect(galleryMetrics.scale).toBeLessThan(0.4);
  expect(galleryMetrics.scale).toBeGreaterThan(0);

  await clearPostedMessages(page);
  const dropResult = await page.locator('[data-pane-gallery-root-id="workspace-root-backend"] .pane-gallery-root-flow-shell').evaluate((shell) => {
    const attachDataTransfer = (event, dataTransfer) => {
      Object.defineProperty(event, 'dataTransfer', {
        configurable: true,
        value: dataTransfer
      });
      return event;
    };
    let exposeDropPayload = false;
    const dataTransfer = {
      dropEffect: 'copy',
      effectAllowed: 'all',
      files: [],
      items: [],
      types: ['ResourceURLs'],
      getData: (type) =>
        exposeDropPayload && type === 'ResourceURLs'
          ? JSON.stringify(['file:///repo/backend/notes.md'])
          : '',
      setData: () => {},
      clearData: () => {},
      setDragImage: () => {}
    };
    const box = shell.getBoundingClientRect();
    const dragOverEvent = attachDataTransfer(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2
      }),
      dataTransfer
    );
    const dropEvent = attachDataTransfer(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2
      }),
      dataTransfer
    );

    shell.dispatchEvent(dragOverEvent);
    exposeDropPayload = true;
    shell.dispatchEvent(dropEvent);

    return {
      dragOverDefaultPrevented: dragOverEvent.defaultPrevented,
      dropDefaultPrevented: dropEvent.defaultPrevented
    };
  });
  expect(dropResult).toEqual({
    dragOverDefaultPrevented: true,
    dropDefaultPrevented: true
  });

  const dropMessage = await waitForPostedMessageByType(page, 'webview/dropNoteMarkdownFiles');
  expect(dropMessage.payload.targetGroupId).toBe('workspace-root-backend');
  expect(dropMessage.payload.resources).toEqual([
    {
      source: 'resourceUrls',
      valueKind: 'uri',
      value: 'file:///repo/backend/notes.md'
    }
  ]);
});

test('file activity edges expose the same toolbar actions as manual edges', async ({ page }) => {
  const state = createFileNodeState();

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state);

  await performTestDomAction(page, {
    kind: 'selectEdge',
    nodeId: 'agent-1',
    edgeId: 'agent-1::file-src-main'
  });

  const edgeToolbar = page.locator(
    '[data-edge-toolbar="true"][data-edge-toolbar-edge-id="agent-1::file-src-main"]'
  );
  await expect(edgeToolbar).toBeVisible();

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '编辑标签' }).click();
  const edgeLabelEditor = page.locator(
    '[data-edge-label-editor="true"][data-edge-label-editor-edge-id="agent-1::file-src-main"]'
  );
  await expect(edgeLabelEditor).toBeVisible();
  await edgeLabelEditor.fill('写入主文件');
  await edgeLabelEditor.press('Enter');

  let message = await waitForPostedMessageByType(page, 'webview/updateEdge');
  expect(message.payload).toEqual({
    edgeId: 'agent-1::file-src-main',
    label: '写入主文件'
  });

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '设置颜色' }).click();
  const edgeColorMenu = page.locator(
    '[data-edge-color-menu="true"][data-edge-color-menu-edge-id="agent-1::file-src-main"]'
  );
  await edgeColorMenu.getByRole('button', { name: '紫色' }).click();
  message = await waitForPostedMessageByType(page, 'webview/updateEdge');
  expect(message.payload).toEqual({
    edgeId: 'agent-1::file-src-main',
    color: '6'
  });

  await clearPostedMessages(page);
  await edgeToolbar.getByRole('button', { name: '删除连线' }).click();
  message = await waitForPostedMessageByType(page, 'webview/deleteEdge');
  expect(message.payload).toEqual({
    edgeId: 'agent-1::file-src-main'
  });
});

test('minimal file nodes render only the primary label and open the target file through the host message', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileNodeState(), createRuntimeContext({ fileNodeDisplayStyle: 'minimal' }));

  const fileNode = nodeById(page, 'file-src-main');
  await expect(fileNode).toHaveClass(/display-style-minimal/);
  await expect(fileNode.locator('.file-node-copy strong')).toContainText('main.ts');
  await expect(fileNode.locator('.file-node-copy span')).toHaveCount(0);
  await expect(fileNode.locator('.file-node-icon .codicon-symbol-file')).toHaveCount(1);
  await expect.poll(async () => (await readProbeEdge(page, 'agent-1::file-src-main', 20))?.owner ?? null).toBe(
    'file-activity'
  );

  await clearPostedMessages(page);
  await fileNode.locator('.file-node-action').click();

  const message = await waitForPostedMessageByType(page, 'webview/openCanvasFile');
  expect(message.payload).toEqual({
    nodeId: 'file-src-main',
    filePath: '/workspace/src/main.ts'
  });
});

test('card file nodes do not fall back to owner counts when no secondary path label exists', async ({ page }) => {
  const state = createFileNodeState();
  state.nodes = state.nodes.map((node) =>
    node.id === 'file-src-main' && node.metadata?.file
      ? {
          ...node,
          metadata: {
            ...node.metadata,
            file: {
              ...node.metadata.file,
              relativePath: undefined
            }
          }
        }
      : node
  );

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(
    page,
    state,
    createRuntimeContext({
      fileNodeDisplayStyle: 'card',
      filePathDisplayMode: 'relative-path'
    })
  );

  const fileNode = nodeById(page, 'file-src-main');
  await expect(fileNode).toHaveClass(/display-style-card/);
  await expect(fileNode.locator('.file-node-copy strong')).toContainText('/workspace/src/main.ts');
  await expect(fileNode.locator('.file-node-copy span')).toHaveCount(0);
  await expect(fileNode).not.toContainText('1 个 Agent 引用');
});

test('canvas node body padding follows unified spacing tokens', async ({ page }) => {
  const state = createCanvasScreenshotState();
  state.nodes.push({
    id: 'file-list-1',
    kind: 'file-list',
    title: 'Changed files',
    status: 'ready',
    summary: '1 file',
    position: { x: 1040, y: 60 },
    size: sizeFor('file-list'),
    metadata: {
      fileList: {
        entries: [
          {
            fileId: 'src-main',
            filePath: '/workspace/src/main.ts',
            relativePath: 'src/main.ts',
            accessMode: 'read-write',
            icon: { kind: 'codicon', codicon: 'symbol-file' },
            ownerNodeIds: ['agent-1']
          }
        ]
      }
    }
  });

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state, createRuntimeContext({ fileNodeDisplayStyle: 'card' }));

  const padding = await page.evaluate(() => {
    const readPadding = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element for ${selector}`);
      }
      const styles = getComputedStyle(element);
      return {
        top: styles.paddingTop,
        right: styles.paddingRight,
        bottom: styles.paddingBottom,
        left: styles.paddingLeft,
        radius: styles.borderTopLeftRadius
      };
    };

    return {
      agentBody: readPadding('[data-node-id="agent-1"] .session-body'),
      terminalBody: readPadding('[data-node-id="terminal-1"] .session-body'),
      terminalFrame: readPadding('[data-node-id="terminal-1"] .terminal-frame'),
      notePreview: readPadding('[data-node-id="note-1"] .note-markdown-preview'),
      fileListBody: readPadding('[data-node-id="file-list-1"] .file-list-body')
    };
  });

  expect(padding.agentBody).toMatchObject({ top: '12px', right: '12px', bottom: '12px', left: '12px' });
  expect(padding.terminalBody).toMatchObject({ top: '12px', right: '12px', bottom: '12px', left: '12px' });
  expect(padding.terminalFrame).toMatchObject({ top: '8px', right: '8px', bottom: '8px', left: '8px' });
  expect(padding.terminalFrame.radius).toBe('8px');
  expect(padding.notePreview).toMatchObject({ top: '16px', right: '18px', bottom: '16px', left: '18px' });
  expect(padding.fileListBody).toMatchObject({ top: '12px', right: '12px', bottom: '12px', left: '12px' });
});

test('minimal file nodes keep a compact, tight border around the rendered content', async ({ page }) => {
  const state = createFileNodeState();
  state.nodes = state.nodes.map((node) =>
    node.id === 'file-src-main'
      ? {
          ...node,
          size: { width: 150, height: 48 }
        }
      : node
  );

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state, createRuntimeContext({ fileNodeDisplayStyle: 'minimal' }));

  const fileNode = nodeById(page, 'file-src-main');
  await expect(fileNode.locator('.file-node-action')).toHaveClass(/file-node-action-minimal/);
  const styles = await page.evaluate(() => {
    const root = document.querySelector('[data-node-id="file-src-main"]');
    const action = root?.querySelector('.file-node-action');
    const icon = root?.querySelector('.file-node-icon');
    if (!(root instanceof HTMLElement) || !(action instanceof HTMLElement) || !(icon instanceof HTMLElement)) {
      return null;
    }

    const rootStyles = getComputedStyle(root);
    const actionStyles = getComputedStyle(action);
    const iconStyles = getComputedStyle(icon);
    return {
      boxShadow: rootStyles.boxShadow,
      paddingTop: actionStyles.paddingTop,
      paddingRight: actionStyles.paddingRight,
      paddingBottom: actionStyles.paddingBottom,
      paddingLeft: actionStyles.paddingLeft,
      iconWidth: iconStyles.width,
      iconFontSize: iconStyles.fontSize
    };
  });
  expect(styles).not.toBeNull();
  expect(styles.boxShadow).toBe('none');
  expect(styles.paddingTop).toBe('3px');
  expect(styles.paddingRight).toBe('6px');
  expect(styles.paddingBottom).toBe('3px');
  expect(styles.paddingLeft).toBe('6px');
  expect(styles.iconWidth).toBe('14px');
  expect(styles.iconFontSize).toBe('14px');
});

test('minimal path-only file nodes fit the label without reserving an empty trailing grid column', async ({ page }) => {
  const state = createFileNodeState();
  state.nodes = state.nodes.map((node) =>
    node.id === 'file-src-main'
      ? {
          ...node,
          title: 'arch_10.md',
          size: { width: 1, height: 1 },
          metadata: {
            ...node.metadata,
            file: {
              ...node.metadata.file,
              filePath: '/workspace/docs/arch_10.md',
              relativePath: 'docs/arch_10.md'
            }
          }
        }
      : node
  );

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(
    page,
    state,
    createRuntimeContext({
      fileNodeDisplayStyle: 'minimal',
      fileNodeDisplayMode: 'path-only',
      filePathDisplayMode: 'basename'
    })
  );

  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-node-id="file-src-main"]');
    const action = root?.querySelector('.file-node-action');
    const label = root?.querySelector('.file-node-copy strong');
    if (!(root instanceof HTMLElement) || !(action instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      return null;
    }

    const actionStyles = getComputedStyle(action);
    const paddingLeft = Number.parseFloat(actionStyles.paddingLeft);
    const paddingRight = Number.parseFloat(actionStyles.paddingRight);
    return {
      rootWidth: root.offsetWidth,
      actionWidth: action.clientWidth,
      labelWidth: label.clientWidth,
      slack: action.clientWidth - paddingLeft - paddingRight - label.clientWidth,
      gridTemplateColumns: actionStyles.gridTemplateColumns,
      scrollWidth: label.scrollWidth,
      clientWidth: label.clientWidth
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics.gridTemplateColumns).not.toContain('1fr');
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.slack).toBeLessThan(8);
});

test('minimal icon-path file nodes keep a tight right edge around the icon and basename', async ({ page }) => {
  const state = createFileNodeState();
  state.nodes = state.nodes.map((node) =>
    node.id === 'file-src-main'
      ? {
          ...node,
          title: 'arch_10.md',
          size: { width: 1, height: 1 },
          metadata: {
            ...node.metadata,
            file: {
              ...node.metadata.file,
              filePath: '/workspace/docs/arch_10.md',
              relativePath: 'docs/arch_10.md'
            }
          }
        }
      : node
  );

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(
    page,
    state,
    createRuntimeContext({
      fileNodeDisplayStyle: 'minimal',
      fileNodeDisplayMode: 'icon-path',
      filePathDisplayMode: 'basename'
    })
  );

  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-node-id="file-src-main"]');
    const action = root?.querySelector('.file-node-action');
    const icon = root?.querySelector('.file-node-icon');
    const label = root?.querySelector('.file-node-copy strong');
    if (
      !(root instanceof HTMLElement) ||
      !(action instanceof HTMLElement) ||
      !(icon instanceof HTMLElement) ||
      !(label instanceof HTMLElement)
    ) {
      return null;
    }

    const actionStyles = getComputedStyle(action);
    const paddingLeft = Number.parseFloat(actionStyles.paddingLeft);
    const paddingRight = Number.parseFloat(actionStyles.paddingRight);
    const gap = Number.parseFloat(actionStyles.columnGap);
    return {
      rootWidth: root.offsetWidth,
      slack: action.clientWidth - paddingLeft - paddingRight - icon.offsetWidth - gap - label.clientWidth,
      gridTemplateColumns: actionStyles.gridTemplateColumns,
      scrollWidth: label.scrollWidth,
      clientWidth: label.clientWidth
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics.gridTemplateColumns).not.toContain('1fr');
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.slack).toBeLessThan(10);
});

test('minimal icon-path file nodes fit short numeric basenames without premature ellipsis', async ({ page }) => {
  const state = createFileNodeState();
  state.nodes = state.nodes.flatMap((node) => {
    if (node.id !== 'file-src-main') {
      return [node];
    }

    return [
      {
        ...node,
        id: 'file-short-1',
        title: '1.md',
        position: { x: 720, y: 160 },
        size: { width: 1, height: 1 },
        metadata: {
          ...node.metadata,
          file: {
            ...node.metadata.file,
            fileId: 'file-short-1',
            filePath: '/workspace/docs/1.md',
            relativePath: 'docs/1.md'
          }
        }
      },
      {
        ...node,
        id: 'file-short-10',
        title: '10.md',
        position: { x: 720, y: 230 },
        size: { width: 1, height: 1 },
        metadata: {
          ...node.metadata,
          file: {
            ...node.metadata.file,
            fileId: 'file-short-10',
            filePath: '/workspace/docs/10.md',
            relativePath: 'docs/10.md'
          }
        }
      },
      {
        ...node,
        id: 'file-short-11',
        title: '11.md',
        position: { x: 720, y: 300 },
        size: { width: 1, height: 1 },
        metadata: {
          ...node.metadata,
          file: {
            ...node.metadata.file,
            fileId: 'file-short-11',
            filePath: '/workspace/docs/11.md',
            relativePath: 'docs/11.md'
          }
        }
      }
    ];
  });
  state.edges = [
    state.edges[0],
    {
      ...state.edges[0],
      id: 'agent-1::file-short-10',
      targetNodeId: 'file-short-10'
    },
    {
      ...state.edges[0],
      id: 'agent-1::file-short-11',
      targetNodeId: 'file-short-11'
    }
  ];
  state.fileReferences = [
    {
      ...state.fileReferences[0],
      id: 'file-short-1',
      filePath: '/workspace/docs/1.md',
      relativePath: 'docs/1.md'
    },
    {
      ...state.fileReferences[0],
      id: 'file-short-10',
      filePath: '/workspace/docs/10.md',
      relativePath: 'docs/10.md'
    },
    {
      ...state.fileReferences[0],
      id: 'file-short-11',
      filePath: '/workspace/docs/11.md',
      relativePath: 'docs/11.md'
    }
  ];

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(
    page,
    state,
    createRuntimeContext({
      fileNodeDisplayStyle: 'minimal',
      fileNodeDisplayMode: 'icon-path',
      filePathDisplayMode: 'basename'
    })
  );

  const metrics = await page.evaluate(() => {
    return ['file-short-1', 'file-short-10', 'file-short-11'].map((nodeId) => {
      const root = document.querySelector(`[data-node-id="${nodeId}"]`);
      const label = root?.querySelector('.file-node-copy strong');
      if (!(root instanceof HTMLElement) || !(label instanceof HTMLElement)) {
        return null;
      }

      return {
        nodeId,
        renderedWidth: root.offsetWidth,
        scrollWidth: label.scrollWidth,
        clientWidth: label.clientWidth,
        title: label.textContent
      };
    });
  });

  expect(metrics).toHaveLength(3);
  for (const metric of metrics) {
    expect(metric).not.toBeNull();
    expect(metric.title).toMatch(/^\d+\.md$/);
    expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth + 1);
  }
});

test('minimal file nodes keep a content-fitting minimum size when manually resized', async ({ page }) => {
  const state = createFileNodeState();
  state.nodes = state.nodes.map((node) =>
    node.id === 'file-src-main'
      ? {
          ...node,
          size: { width: 96, height: 32 }
        }
      : node
  );

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state, createRuntimeContext({ fileNodeDisplayStyle: 'minimal' }));
  await performTestDomAction(page, {
    kind: 'selectNode',
    nodeId: 'file-src-main'
  });
  await clearPostedMessages(page);

  const fileNode = nodeById(page, 'file-src-main');
  const minimumExpectedWidth = 64;
  const handle = fileNode.locator('[data-node-resize-direction="bottom-right"]');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 - 128,
    handleBox.y + handleBox.height / 2 - 24,
    { steps: 12 }
  );
  await page.mouse.up();

  let nextLayout = null;
  await expect
    .poll(async () => {
      const layout = await page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/resizeNode' && entry.payload.nodeId === 'file-src-main');

        return message
          ? {
              position: message.payload.position,
              size: message.payload.size
            }
          : null;
      });
      if (!layout) {
        return null;
      }

      nextLayout = layout;
      return 'matched';
    })
    .toBe('matched');

  expect(nextLayout.size.width).toBeLessThan(96);
  expect(nextLayout.size.width).toBeGreaterThanOrEqual(minimumExpectedWidth);
  expect(nextLayout.size.height).toBeGreaterThanOrEqual(24);
  expect(nextLayout.size.height).toBeLessThanOrEqual(28);

  state.nodes = state.nodes.map((node) =>
    node.id === 'file-src-main'
      ? {
          ...node,
          position: nextLayout.position,
          size: nextLayout.size
        }
      : node
  );
  await updateHostState(page, state, createRuntimeContext({ fileNodeDisplayStyle: 'minimal' }));

  const probeNode = await waitForProbeNodeMatch(
    page,
    'file-src-main',
    (node) =>
      typeof node?.renderedWidth === 'number' &&
      typeof node?.renderedHeight === 'number' &&
      node.renderedWidth >= minimumExpectedWidth &&
      node.renderedHeight >= 24
  );
  expect(probeNode.renderedWidth).toBeLessThan(96);
  expect(probeNode.renderedWidth).toBeGreaterThanOrEqual(minimumExpectedWidth);
  expect(probeNode.renderedHeight).toBeGreaterThanOrEqual(24);

  const contentRemainsVisible = await page.evaluate(() => {
    const action = document.querySelector('[data-node-id="file-src-main"] .file-node-action');
    if (!(action instanceof HTMLElement)) {
      return null;
    }

    return action.scrollWidth <= action.clientWidth + 2;
  });
  expect(contentRemainsVisible).toBe(true);
});

test('file nodes do not add a hover overlay to their clickable surface', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileNodeState(), createRuntimeContext({ fileNodeDisplayStyle: 'minimal' }));

  const action = nodeById(page, 'file-src-main').locator('.file-node-action');
  await action.hover();

  const backgroundColor = await action.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');
});

test('selected file nodes can be deleted with the Delete key', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileNodeState());

  const fileNode = nodeById(page, 'file-src-main');
  await fileNode.locator('.file-node-action').click();
  await waitForPostedMessageByType(page, 'webview/openCanvasFile');

  await clearPostedMessages(page);
  await page.keyboard.press('Delete');

  const message = await waitForPostedMessageByType(page, 'webview/deleteNode');
  expect(message.payload).toEqual({
    nodeId: 'file-src-main'
  });
});

test('edge label text color follows the rendered edge color', async ({ page }) => {
  const state = createCanvasScreenshotState();
  state.edges = [
    {
      id: 'edge-user-1',
      sourceNodeId: 'agent-1',
      targetNodeId: 'terminal-1',
      sourceAnchor: 'right',
      targetAnchor: 'left',
      arrowMode: 'forward',
      owner: 'user',
      color: '4',
      label: '写入'
    }
  ];

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state);

  const edgeLabelText = page.locator(
    '[data-edge-label="true"][data-edge-label-edge-id="edge-user-1"] .canvas-edge-label-text'
  );
  await expect(edgeLabelText).toContainText('写入');

  const coloredStyles = await page.evaluate(() => {
    const edgeCandidates = document.querySelectorAll('[data-edge-probe="true"][data-edge-id="edge-user-1"]');
    const edge = edgeCandidates.item(edgeCandidates.length - 1);
    const label = document.querySelector(
      '[data-edge-label="true"][data-edge-label-edge-id="edge-user-1"] .canvas-edge-label-text'
    );
    if (!(edge instanceof SVGElement) || !(label instanceof HTMLElement)) {
      return null;
    }

    return {
      stroke: getComputedStyle(edge).stroke,
      color: getComputedStyle(label).color
    };
  });
  expect(coloredStyles).not.toBeNull();
  expect(coloredStyles.color).toBe(coloredStyles.stroke);

  state.edges = [
    {
      ...state.edges[0],
      color: undefined
    }
  ];
  await updateHostState(page, state);

  const coloredStylesSnapshot = JSON.stringify(coloredStyles);
  await expect.poll(async () => {
    return page.evaluate((previousSnapshot) => {
      const edgeCandidates = document.querySelectorAll('[data-edge-probe="true"][data-edge-id="edge-user-1"]');
      const edge = edgeCandidates.item(edgeCandidates.length - 1);
      const label = document.querySelector(
        '[data-edge-label="true"][data-edge-label-edge-id="edge-user-1"] .canvas-edge-label-text'
      );
      if (!(edge instanceof SVGElement) || !(label instanceof HTMLElement)) {
        return previousSnapshot;
      }

      const styles = {
        stroke: getComputedStyle(edge).stroke,
        color: getComputedStyle(label).color
      };
      return styles.stroke === styles.color ? JSON.stringify(styles) : previousSnapshot;
    }, coloredStylesSnapshot);
  }).not.toBe(coloredStylesSnapshot);

  const defaultStyles = await page.evaluate(() => {
    const edgeCandidates = document.querySelectorAll('[data-edge-probe="true"][data-edge-id="edge-user-1"]');
    const edge = edgeCandidates.item(edgeCandidates.length - 1);
    const label = document.querySelector(
      '[data-edge-label="true"][data-edge-label-edge-id="edge-user-1"] .canvas-edge-label-text'
    );
    if (!(edge instanceof SVGElement) || !(label instanceof HTMLElement)) {
      return null;
    }

    return {
      stroke: getComputedStyle(edge).stroke,
      color: getComputedStyle(label).color
    };
  });
  expect(defaultStyles).not.toBeNull();
  expect(defaultStyles.color).toBe(defaultStyles.stroke);
});

test('edge toolbar keeps top endpoints and labels unobstructed', async ({ page }) => {
  const state = createCanvasScreenshotState();
  state.nodes = state.nodes.map((node) => {
    if (node.id === 'note-1') {
      return {
        ...node,
        position: { x: 430, y: 20 }
      };
    }

    if (node.id === 'agent-1') {
      return {
        ...node,
        position: { x: 430, y: 360 }
      };
    }

    if (node.id === 'terminal-1') {
      return {
        ...node,
        position: { x: 760, y: 220 }
      };
    }

    return node;
  });
  state.edges = [
    {
      id: 'edge-user-1',
      sourceNodeId: 'agent-1',
      targetNodeId: 'note-1',
      sourceAnchor: 'top',
      targetAnchor: 'bottom',
      arrowMode: 'forward',
      owner: 'user',
      label: '你好'
    }
  ];

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state);
  await performTestDomAction(page, {
    kind: 'selectEdge',
    nodeId: 'agent-1',
    edgeId: 'edge-user-1'
  });

  const edgeToolbar = page.locator('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-user-1"]');
  await expect(edgeToolbar).toBeVisible();

  const layout = await page.evaluate(() => {
    const toolbar = document.querySelector('[data-edge-toolbar="true"][data-edge-toolbar-edge-id="edge-user-1"]');
    const label = document.querySelector('[data-edge-label="true"][data-edge-label-edge-id="edge-user-1"]');
    const sourceHandle = document.querySelector('[data-node-id="agent-1"] .canvas-node-handle.anchor-top');
    const targetHandle = document.querySelector('[data-node-id="note-1"] .canvas-node-handle.anchor-bottom');
    if (!(toolbar instanceof HTMLElement) || !(label instanceof HTMLElement) || !(sourceHandle instanceof HTMLElement) || !(targetHandle instanceof HTMLElement)) {
      return null;
    }

    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      };
    };
    const intersects = (left, right) => {
      return !(
        left.right <= right.left ||
        left.left >= right.right ||
        left.bottom <= right.top ||
        left.top >= right.bottom
      );
    };

    const toolbarRect = toRect(toolbar);
    const labelRect = toRect(label);
    const sourceHandleRect = toRect(sourceHandle);
    const targetHandleRect = toRect(targetHandle);

    return {
      toolbarOverlapsLabel: intersects(toolbarRect, labelRect),
      toolbarOverlapsSourceHandle: intersects(toolbarRect, sourceHandleRect),
      toolbarOverlapsTargetHandle: intersects(toolbarRect, targetHandleRect)
    };
  });

  expect(layout).not.toBeNull();
  expect(layout.toolbarOverlapsLabel).toBe(false);
  expect(layout.toolbarOverlapsSourceHandle).toBe(false);
  expect(layout.toolbarOverlapsTargetHandle).toBe(false);
});

test('file nodes can be dragged without triggering open file', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileNodeState());

  const fileNode = nodeById(page, 'file-src-main');
  await expect(fileNode).toBeVisible();
  const fileNodeBox = await fileNode.boundingBox();
  expect(fileNodeBox).not.toBeNull();

  await clearPostedMessages(page);
  await page.mouse.move(fileNodeBox.x + fileNodeBox.width / 2, fileNodeBox.y + fileNodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(fileNodeBox.x + fileNodeBox.width / 2 + 120, fileNodeBox.y + fileNodeBox.height / 2 + 80, {
    steps: 12
  });
  await page.mouse.up();
  await settleWebview(page, 3);

  const moveMessage = await waitForPostedMessageByType(page, 'webview/moveNode');
  expect(moveMessage.payload.id).toBe('file-src-main');
  expect(moveMessage.payload.position.x).not.toBe(720);
  expect(moveMessage.payload.position.y).not.toBe(200);

  const openCount = await page.evaluate(() => {
    return window.__devSessionCanvasHarness
      .getPostedMessages()
      .filter((entry) => entry.type === 'webview/openCanvasFile').length;
  });
  expect(openCount).toBe(0);
});

test('file list nodes render entries and open clicked file entries through the host message', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileListState(), createRuntimeContext({ filePresentationMode: 'lists', filePathDisplayMode: 'relative-path' }));

  const fileListNode = nodeById(page, 'file-list-shared');
  await expect(fileListNode).toHaveClass(/display-style-minimal/);
  await expect(fileListNode.locator('.file-list-title-text')).toContainText('共享文件');
  await expect(fileListNode.locator('.file-list-entry')).toHaveCount(2);
  await expect(fileListNode.locator('.file-list-entry').first()).toContainText('src/shared.ts');
  await expect(fileListNode.locator('.file-list-entry').first().locator('.file-access-indicator')).toContainText('RW');
  await expect(fileListNode.locator('.file-list-entry').nth(1).locator('.file-access-indicator')).toContainText('W');
  const secondEntryBorderTopWidth = await page.evaluate(() => {
    const entry = document.querySelector('[data-node-id="file-list-shared"] .file-list-entry:nth-of-type(2)');
    return entry instanceof HTMLElement ? getComputedStyle(entry).borderTopWidth : null;
  });
  expect(secondEntryBorderTopWidth).toBe('0px');
  await expect.poll(async () => (await requestWebviewProbe(page, 20)).edgeCount).toBe(2);

  await clearPostedMessages(page);
  await fileListNode.locator('.file-list-entry').filter({ hasText: 'src/shared.ts' }).click();

  const message = await waitForPostedMessageByType(page, 'webview/openCanvasFile');
  expect(message.payload).toEqual({
    nodeId: 'file-list-shared',
    filePath: '/workspace/src/shared.ts'
  });
});

test('file list entries follow VS Code list hover, active selection, and inactive selection colors', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileListState(), createRuntimeContext({ filePresentationMode: 'lists', filePathDisplayMode: 'relative-path' }));

  const entry = nodeById(page, 'file-list-shared').locator('.file-list-entry').filter({ hasText: 'src/shared.ts' });
  const readEntryVisualState = async () =>
    page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('[data-node-id="file-list-shared"] .file-list-entry')).find((candidate) =>
        candidate.textContent?.includes('src/shared.ts')
      );
      if (!(target instanceof HTMLElement)) {
        return null;
      }

      const styles = getComputedStyle(target);
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        selected: target.dataset.fileEntrySelected ?? null,
        selectionTone: target.dataset.fileEntrySelectionTone ?? null
      };
    });

  await entry.hover();
  await expect.poll(readEntryVisualState).toEqual({
    backgroundColor: 'rgb(42, 45, 46)',
    color: 'rgb(204, 204, 204)',
    selected: 'false',
    selectionTone: null
  });

  await clearPostedMessages(page);
  await entry.click();
  await waitForPostedMessageByType(page, 'webview/openCanvasFile');
  await expect.poll(readEntryVisualState).toEqual({
    backgroundColor: 'rgb(4, 57, 94)',
    color: 'rgb(255, 255, 255)',
    selected: 'true',
    selectionTone: 'active'
  });

  await page.evaluate(() => {
    window.dispatchEvent(new FocusEvent('blur'));
  });
  await expect.poll(readEntryVisualState).toEqual({
    backgroundColor: 'rgb(55, 55, 61)',
    color: 'rgb(204, 204, 204)',
    selected: 'true',
    selectionTone: 'inactive'
  });
});

test('minimal file list nodes can switch between list and tree views', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileListState(), createRuntimeContext({ filePresentationMode: 'lists', filePathDisplayMode: 'relative-path' }));

  const fileListNode = nodeById(page, 'file-list-shared');
  await expect(fileListNode.locator('[data-file-list-view-mode="list"]')).toHaveClass(/is-active/);
  await expect(fileListNode.locator('.file-tree-folder-row')).toHaveCount(0);

  await fileListNode.locator('[data-file-list-view-mode="tree"]').click();
  await expect(fileListNode.locator('[data-file-list-view-mode="tree"]')).toHaveClass(/is-active/);
  await expect(fileListNode.locator('.file-tree-folder-row')).toHaveCount(2);
  await expect(fileListNode.locator('.file-tree-folder-row').filter({ hasText: 'src' })).toHaveCount(1);
  await expect(fileListNode.locator('.file-tree-folder-row').filter({ hasText: 'docs' })).toHaveCount(1);
  await expect(fileListNode.locator('.file-list-entry').filter({ hasText: 'shared.ts' }).locator('.file-access-indicator')).toContainText('RW');

  await clearPostedMessages(page);
  await fileListNode.locator('.file-list-entry').filter({ hasText: 'shared.ts' }).click();

  const message = await waitForPostedMessageByType(page, 'webview/openCanvasFile');
  expect(message.payload).toEqual({
    nodeId: 'file-list-shared',
    filePath: '/workspace/src/shared.ts'
  });
});

test('minimal file list tree view supports explorer-style ordering and collapsible folders', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(
    page,
    createExplorerLikeFileListState(),
    createRuntimeContext({ filePresentationMode: 'lists', filePathDisplayMode: 'relative-path' })
  );

  const fileListNode = nodeById(page, 'file-list-shared');
  await fileListNode.locator('[data-file-list-view-mode="tree"]').click();

  const readTreeRows = async () =>
    fileListNode.locator('.file-list-tree > [data-file-tree-item-type]').evaluateAll((elements) =>
      elements.map((element) => ({
        type: element.getAttribute('data-file-tree-item-type'),
        label: element.getAttribute('data-file-tree-label'),
        expanded: element.getAttribute('data-file-tree-expanded')
      }))
    );

  await expect.poll(readTreeRows).toEqual([
    { type: 'folder', label: 'docs', expanded: 'true' },
    { type: 'file', label: 'guide.md', expanded: null },
    { type: 'folder', label: 'src', expanded: 'true' },
    { type: 'folder', label: 'webview', expanded: 'true' },
    { type: 'file', label: 'main.tsx', expanded: null },
    { type: 'file', label: 'extension.ts', expanded: null },
    { type: 'file', label: 'README.md', expanded: null }
  ]);

  await fileListNode.locator('[data-file-tree-branch-key="src"]').click();
  await expect(fileListNode.locator('[data-file-tree-branch-key="src"]')).toHaveAttribute('data-file-tree-expanded', 'false');
  await expect(fileListNode.locator('.file-list-entry').filter({ hasText: 'extension.ts' })).toHaveCount(0);
  await expect(fileListNode.locator('.file-list-entry').filter({ hasText: 'main.tsx' })).toHaveCount(0);
  await expect.poll(readTreeRows).toEqual([
    { type: 'folder', label: 'docs', expanded: 'true' },
    { type: 'file', label: 'guide.md', expanded: null },
    { type: 'folder', label: 'src', expanded: 'false' },
    { type: 'file', label: 'README.md', expanded: null }
  ]);

  const persistedState = await readPersistedUiState(page);
  expect(persistedState.collapsedFileListTreeBranches).toEqual({
    'file-list-shared': ['src']
  });
});

test('multi-root relative paths stay split by workspace folder in tree view', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(
    page,
    createMultiRootFileListState(),
    createRuntimeContext({ filePresentationMode: 'lists', filePathDisplayMode: 'relative-path' })
  );

  const fileListNode = nodeById(page, 'file-list-shared');
  await fileListNode.locator('[data-file-list-view-mode="tree"]').click();
  await expect(fileListNode.locator('.file-tree-folder-row').filter({ hasText: 'workspace-a' })).toHaveCount(1);
  await expect(fileListNode.locator('.file-tree-folder-row').filter({ hasText: 'workspace-b' })).toHaveCount(1);
  await expect(fileListNode.locator('.file-tree-folder-row').filter({ hasText: 'src' })).toHaveCount(2);
  await expect(fileListNode.locator('.file-list-entry').filter({ hasText: 'index.ts' })).toHaveCount(2);
});

test('file list nodes expose a delete button that posts deleteNode', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, createFileListState(), createRuntimeContext({ filePresentationMode: 'lists', filePathDisplayMode: 'relative-path' }));
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'clickNodeActionButton',
    nodeId: 'file-list-shared',
    label: '删除'
  });

  const message = await waitForPostedMessageByType(page, 'webview/deleteNode');
  expect(message.payload).toEqual({
    nodeId: 'file-list-shared'
  });
});

test('selected file list nodes scroll their file list without zooming the canvas', async ({ page }) => {
  const state = createFileListState();
  state.nodes = state.nodes.map((node) =>
    node.id === 'file-list-shared' && node.metadata?.fileList
      ? {
          ...node,
          size: { width: 320, height: 136 },
          metadata: {
            ...node.metadata,
            fileList: {
              ...node.metadata.fileList,
              entries: Array.from({ length: 18 }, (_, index) => ({
                fileId: `shared-entry-${index}`,
                filePath: `/workspace/src/generated/file-${index}.ts`,
                relativePath: `src/generated/file-${index}.ts`,
                accessMode:
                  index % 3 === 0 ? 'read' : index % 3 === 1 ? 'write' : 'read-write',
                ownerNodeIds: ['agent-1', 'agent-2'],
                icon: {
                  kind: 'codicon',
                  id: 'symbol-file'
                }
              }))
            }
          }
        }
      : node
  );

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(
    page,
    state,
    createRuntimeContext({
      filePresentationMode: 'lists',
      filePathDisplayMode: 'relative-path',
      fileNodeDisplayStyle: 'minimal'
    })
  );

  const fileListNode = nodeById(page, 'file-list-shared');
  await fileListNode.locator('.file-list-title-text').click();
  await expect(fileListNode).toHaveAttribute('data-node-selected', 'true');

  const listViewport = fileListNode.locator('.file-list-entries.minimal');
  await expect(listViewport).toBeVisible();

  const beforeScroll = await page.evaluate(() => {
    const scroller = document.querySelector('[data-node-id="file-list-shared"] .file-list-entries.minimal');
    const viewport = document.querySelector('.react-flow__viewport');
    if (!(scroller instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      return null;
    }

    return {
      scrollTop: scroller.scrollTop,
      transform: viewport.style.transform
    };
  });
  expect(beforeScroll).not.toBeNull();

  const box = await listViewport.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height - 8, 24));
  await page.mouse.wheel(0, 320);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const scroller = document.querySelector('[data-node-id="file-list-shared"] .file-list-entries.minimal');
        return scroller instanceof HTMLElement ? scroller.scrollTop : null;
      });
    })
    .toBeGreaterThan(beforeScroll.scrollTop);

  const afterScroll = await page.evaluate(() => {
    const scroller = document.querySelector('[data-node-id="file-list-shared"] .file-list-entries.minimal');
    const viewport = document.querySelector('.react-flow__viewport');
    if (!(scroller instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      return null;
    }

    return {
      scrollTop: scroller.scrollTop,
      transform: viewport.style.transform
    };
  });
  expect(afterScroll).not.toBeNull();
  expect(afterScroll.transform).toBe(beforeScroll.transform);
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
        agentBackground: WORKBENCH_THEME_FIXTURES.dark.themeVars['--vscode-terminal-background'],
        agentForeground: WORKBENCH_THEME_FIXTURES.dark.themeVars['--vscode-terminal-foreground'],
        agentAnsiBlue: WORKBENCH_THEME_FIXTURES.dark.themeVars['--vscode-terminal-ansiBlue'],
        terminalBackground: WORKBENCH_THEME_FIXTURES.dark.themeVars['--vscode-terminal-background'],
        terminalBrightWhite: WORKBENCH_THEME_FIXTURES.dark.themeVars['--vscode-terminal-ansiBrightWhite']
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
        agentBackground: WORKBENCH_THEME_FIXTURES.light.themeVars['--vscode-terminal-background'],
        agentForeground: WORKBENCH_THEME_FIXTURES.light.themeVars['--vscode-terminal-foreground'],
        agentAnsiBlue: WORKBENCH_THEME_FIXTURES.light.themeVars['--vscode-terminal-ansiBlue'],
        terminalBackground: WORKBENCH_THEME_FIXTURES.light.themeVars['--vscode-terminal-background'],
        terminalBrightWhite: WORKBENCH_THEME_FIXTURES.light.themeVars['--vscode-terminal-ansiBrightWhite']
      })
    );
});

test('embedded xterm re-reads body theme vars and falls back to workbench surfaces for sparse themes', async ({
  page
}) => {
  const state = createCanvasScreenshotState();

  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, state, createRuntimeContext({ surfaceLocation: 'panel' }));
  await settleWebview(page, 4);

  await expect
    .poll(async () => {
      const agentNode = await readProbeNode(page, 'agent-1', 20);
      return agentNode?.terminalTheme?.background ?? null;
    })
    .toBe(WORKBENCH_THEME_FIXTURES.dark.themeVars['--vscode-terminal-background']);

  await applyWorkbenchTheme(page, 'darkSparse');
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
        agentBackground: WORKBENCH_THEME_FIXTURES.darkSparse.themeVars['--vscode-panel-background'],
        agentForeground: WORKBENCH_THEME_FIXTURES.darkSparse.themeVars['--vscode-terminal-foreground'],
        agentAnsiBlue: '#2472c8',
        terminalBackground: WORKBENCH_THEME_FIXTURES.darkSparse.themeVars['--vscode-panel-background'],
        terminalBrightWhite: '#e5e5e5'
      })
    );

  await updateHostState(page, state, createRuntimeContext({ surfaceLocation: 'editor' }));
  await settleWebview(page, 4);

  await expect
    .poll(async () => {
      const agentNode = await readProbeNode(page, 'agent-1', 20);
      return JSON.stringify({
        background: agentNode?.terminalTheme?.background,
        foreground: agentNode?.terminalTheme?.foreground
      });
    })
    .toBe(
      JSON.stringify({
        background: WORKBENCH_THEME_FIXTURES.darkSparse.themeVars['--vscode-editor-background'],
        foreground: WORKBENCH_THEME_FIXTURES.darkSparse.themeVars['--vscode-terminal-foreground']
      })
    );

  await applyWorkbenchTheme(page, 'lightSparse');
  await dispatchThemeChanged(page);
  await settleWebview(page, 4);

  await expect
    .poll(async () => {
      const agentNode = await readProbeNode(page, 'agent-1', 20);
      return JSON.stringify({
        background: agentNode?.terminalTheme?.background,
        foreground: agentNode?.terminalTheme?.foreground,
        ansiBlue: agentNode?.terminalTheme?.ansiBlue,
        brightWhite: agentNode?.terminalTheme?.ansiBrightWhite
      });
    })
    .toBe(
      JSON.stringify({
        background: WORKBENCH_THEME_FIXTURES.lightSparse.themeVars['--vscode-editor-background'],
        foreground: WORKBENCH_THEME_FIXTURES.lightSparse.themeVars['--vscode-terminal-foreground'],
        ansiBlue: '#0451a5',
        brightWhite: '#a5a5a5'
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

test('minimap viewport outline remains visible after fitting distant nodes', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.4
      }
    }
  });
  await bootstrap(page, createDistantOverviewState());
  await settleWebview(page, 4);

  await page.locator('.react-flow__controls-fitview').click();

  await expect.poll(async () => readCanvasViewportScale(page)).toBeLessThan(0.2);

  const outlineStyle = await page.locator('.canvas-minimap-viewport-outline-rect').evaluate((outline) => {
    const styles = getComputedStyle(outline);
    return {
      strokeWidth: Number.parseFloat(styles.strokeWidth),
      vectorEffect: styles.vectorEffect
    };
  });
  const maskStroke = await page
    .locator('.canvas-minimap .react-flow__minimap-mask')
    .evaluate((mask) => getComputedStyle(mask).stroke);

  expect(maskStroke).toBe('none');
  expect(outlineStyle.vectorEffect).toBe('non-scaling-stroke');
  expect(outlineStyle.strokeWidth).toBe(0.5);
});

test('minimap remains pannable with the viewport outline overlay', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1.25
      }
    }
  });
  await bootstrap(page, createMinimapContrastState());
  await settleWebview(page, 4);
  await clearPostedMessages(page);

  const beforeState = await readPersistedUiState(page);
  const beforeDragTransform = await readCanvasViewportTransform(page);
  const minimapBox = await page.locator('.canvas-minimap svg').boundingBox();
  expect(minimapBox).not.toBeNull();

  await page.mouse.move(minimapBox.x + minimapBox.width / 2, minimapBox.y + minimapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(minimapBox.x + minimapBox.width / 2 + 24, minimapBox.y + minimapBox.height / 2, {
    steps: 4
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const transform = await readCanvasViewportTransform(page);
      return transform && transform !== beforeDragTransform ? transform : null;
    })
    .not.toBeNull();

  const afterState = await readPersistedUiState(page);
  expect(afterState.viewport.x).not.toBe(beforeState.viewport.x);
  expect(afterState.viewport.zoom).toBe(beforeState.viewport.zoom);

  const centerMessages = await readPostedMessagesByType(page, 'webview/updateViewportCenter');
  expect(centerMessages.length).toBeGreaterThan(0);
  expect(centerMessages.at(-1).payload.visibleCenter.x).not.toBe(0);
});

test('minimap shows workspace root sections, user groups, and attention nodes', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.85
      }
    }
  });
  const state = createMinimapContrastState();
  state.groups = [
    {
      id: 'workspace-root-minimap',
      title: 'Frontend Root',
      position: { x: -240, y: -80 },
      size: { width: 780, height: 520 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    },
    {
      id: 'group-user-minimap',
      title: 'Attention Follow-up',
      position: { x: 1120, y: 420 },
      size: { width: 460, height: 340 }
    }
  ];
  state.nodes.find((node) => node.id === 'terminal-minimap-right').metadata.terminal.attentionPending = true;
  await bootstrap(page, state, createRuntimeContext({ strongTerminalAttentionReminderMode: 'both' }));
  await settleWebview(page, 4);

  const rootGroup = page.locator('[data-minimap-group-id="workspace-root-minimap"]');
  const userGroup = page.locator('[data-minimap-group-id="group-user-minimap"]');
  await expect(rootGroup).toHaveAttribute('data-minimap-group-role', 'workspace-root');
  await expect(userGroup).toHaveAttribute('data-minimap-group-role', 'user');

  const minimapLayout = await page.locator('.canvas-minimap svg').evaluate((svg) => {
    const rectFor = (selector) => {
      const element = svg.querySelector(selector);
      if (!(element instanceof SVGGraphicsElement)) {
        throw new Error(`MiniMap element not found: ${selector}`);
      }
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    };

    return {
      root: rectFor('[data-minimap-group-id="workspace-root-minimap"]'),
      userGroup: rectFor('[data-minimap-group-id="group-user-minimap"]'),
      attentionNode: rectFor('[data-minimap-node-id="terminal-minimap-right"]')
    };
  });
  expect(minimapLayout.root.width).toBeGreaterThan(0);
  expect(minimapLayout.root.height).toBeGreaterThan(0);
  expect(minimapLayout.userGroup.width).toBeGreaterThan(0);
  expect(minimapLayout.userGroup.height).toBeGreaterThan(0);
  expect(minimapLayout.userGroup.left).toBeGreaterThan(minimapLayout.root.left);
  expect(minimapLayout.attentionNode.width).toBeGreaterThan(0);
  expect(minimapLayout.attentionNode.height).toBeGreaterThan(0);

  const attentionNode = page.locator('[data-minimap-node-id="terminal-minimap-right"]');
  await expect(attentionNode).toHaveAttribute('data-minimap-attention-pending', 'true');
  await expect(attentionNode).toHaveAttribute('data-minimap-attention-flashing', 'true');
  await expect(attentionNode).toHaveAttribute('data-minimap-attention-size-pulsing', 'true');
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

test('agent restart actions can start a new session and resume the original session', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createStoppedAgentNodeState({ resumable: true }));
  await clearPostedMessages(page);

  await nodeById(page, 'agent-1').locator('[data-agent-restart-action="new-session"]').click();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/startExecutionSession');

        return message
          ? JSON.stringify({
              provider: message.payload.provider,
              resume: message.payload.resume === true
            })
          : null;
      });
    })
    .toBe(
      JSON.stringify({
        provider: 'codex',
        resume: false
      })
    );

  await clearPostedMessages(page);
  await nodeById(page, 'agent-1').locator('[data-agent-restart-action="resume"]').click();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/startExecutionSession');

        return message
          ? JSON.stringify({
              provider: message.payload.provider,
              resume: message.payload.resume === true
            })
          : null;
      });
    })
    .toBe(
      JSON.stringify({
        provider: 'codex',
        resume: true
      })
    );
});

test('agent restart actions render inline without a dropdown', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createStoppedAgentNodeState({ resumable: true }));

  const agentNode = nodeById(page, 'agent-1');
  await expect(agentNode.locator('[data-agent-restart-toggle="true"]')).toHaveCount(0);
  await expect(agentNode.locator('.action-split-button-menu')).toHaveCount(0);
  await expect(agentNode.locator('[data-agent-restart-action="new-session"]')).toBeVisible();
  await expect(agentNode.locator('[data-agent-restart-action="resume"]')).toBeVisible();

  const actionLabels = await agentNode.locator('.action-button-group .action-button').evaluateAll((buttons) =>
    buttons.map((button) => button.textContent?.trim() ?? '')
  );
  expect(actionLabels).toEqual(['新建', '重启']);
});

test('Agent Fork action posts a branchAgentSession message for supported providers', async ({ page }) => {
  await openHarness(page);

  for (const { provider, label } of [
    { provider: 'codex', label: 'Codex' },
    { provider: 'claude', label: 'Claude Code' }
  ]) {
    await bootstrap(page, createStoppedAgentNodeState({ provider, resumable: true }));
    await clearPostedMessages(page);

    const agentNode = nodeById(page, 'agent-1');
    const branchAction = agentNode.locator('[data-agent-branch-action="true"]');
    await expect(branchAction).toBeVisible();
    await expect(branchAction).toHaveText('分叉');
    await expect(branchAction).toHaveAttribute('aria-label', `分叉当前 ${label} 会话`);
    await branchAction.click();

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const message = window.__devSessionCanvasHarness
            .getPostedMessages()
            .find((entry) => entry.type === 'webview/branchAgentSession');

          return message
            ? JSON.stringify({
                type: message.type,
                payload: message.payload
              })
            : null;
        });
      })
      .toBe(
        JSON.stringify({
          type: 'webview/branchAgentSession',
          payload: {
            nodeId: 'agent-1'
          }
        })
      );
  }
});

test('forked Agent nodes keep title actions readable before and after launch', async ({ page }) => {
  await openHarness(page);

  for (const variant of [
    {
      provider: 'codex',
      title: 'Codex Agent 分叉 layout regression probe 分叉',
      summary: '等待启动从当前 Codex 会话 fork 出来的 Agent。',
      customLaunchCommand: 'codex fork session-123',
      runningSummary: 'Codex CLI 正在执行 fork 出来的 Agent。',
      lastBackendLabel: 'Codex CLI',
      minActionsGap: 9
    },
    {
      provider: 'claude',
      title: 'Claude Agent 分叉 layout regression probe 分叉',
      summary: '等待启动从当前 Claude Code 会话 fork 出来的 Agent。',
      customLaunchCommand: 'claude --resume session-123 --fork-session',
      runningSummary: 'Claude Code CLI 正在执行 fork 出来的 Agent。',
      lastBackendLabel: 'Claude Code CLI',
      minActionsGap: 9
    }
  ]) {
    const state = createStoppedAgentNodeState({ provider: variant.provider, resumable: false });
    state.nodes[0] = {
      ...state.nodes[0],
      title: variant.title,
      summary: variant.summary,
      size: {
        ...state.nodes[0].size,
        width: 360
      },
      metadata: {
        ...state.nodes[0].metadata,
        agent: {
          ...state.nodes[0].metadata.agent,
          launchPreset: 'custom',
          customLaunchCommand: variant.customLaunchCommand,
          resumeStrategy: 'none',
          resumeSessionId: undefined,
          lastBackendLabel: variant.lastBackendLabel
        }
      }
    };
    await bootstrap(page, state);

    const agentNode = nodeById(page, 'agent-1');
    await expect(agentNode.locator('button:has-text("启动")')).toBeVisible();
    await expect(agentNode.locator('[data-agent-branch-action="true"]')).toHaveCount(0);
    await expect(agentNode.locator('button:has-text("删除")')).toBeVisible();
    await expect(agentNode.locator('.window-chrome .status-pill')).toHaveText('已停止');

    await expectForkedAgentActionsToBeReadable(agentNode, ['启动', '删除'], {
      minActionsGap: variant.minActionsGap,
      expectCompactActions: true
    });

    await bootstrap(page, {
      ...state,
      nodes: [
        {
          ...state.nodes[0],
          status: 'running',
          summary: variant.runningSummary,
          metadata: {
            ...state.nodes[0].metadata,
            agent: {
              ...state.nodes[0].metadata.agent,
              lifecycle: 'running',
              liveSession: true,
              resumeSupported: false
            }
          }
        }
      ]
    });

    await expect(agentNode.locator('button:has-text("停止")')).toBeVisible();
    await expect(agentNode.locator('[data-agent-branch-action="true"]')).toHaveCount(0);
    await expect(agentNode.locator('button:has-text("删除")')).toBeVisible();
    await expect(agentNode.locator('.window-chrome .status-pill')).toHaveText('运行中');

    await expectForkedAgentActionsToBeReadable(agentNode, ['停止', '删除'], {
      minActionsGap: variant.minActionsGap,
      expectCompactActions: true
    });
  }
});

test('Agent title action buttons wrap before pushing delete outside compact chrome', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');

  const state = createStoppedAgentNodeState({ provider: 'codex', resumable: true });
  state.nodes[0].title = 'Agent 4';
  state.nodes[0].size = { width: 360, height: state.nodes[0].size.height };
  state.nodes[0].metadata.agent.cwd =
    '/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2';
  state.nodes[0].metadata.agent.lastLaunchCommandLine =
    'codex --sandbox workspace-write --config compact-branch-action-overflow';

  await bootstrap(page, state);

  const agentNode = nodeById(page, 'agent-1');
  await expect(agentNode.locator('[data-agent-restart-action="new-session"]')).toBeVisible();
  await expect(agentNode.locator('[data-agent-restart-action="resume"]')).toBeVisible();
  await expect(agentNode.locator('[data-agent-branch-action="true"]')).toHaveText('分叉');
  await expect(agentNode.locator('.window-chrome .status-pill')).toHaveText('已停止');
  await expect(agentNode.getByRole('button', { name: '删除' })).toBeVisible();

  await expectForkedAgentActionsToBeReadable(agentNode, ['新建', '重启', '分叉', '删除'], {
    minActionsGap: -80,
    expectBranchActionWrap: true,
    expectCompactActions: true,
    expectedBranchVisible: 'true'
  });
});

async function expectForkedAgentActionsToBeReadable(agentNode, expectedLabels, options = {}) {
  const layoutContract = await agentNode.locator('.window-chrome').evaluate((chrome) => {
    const title = chrome.querySelector('.window-title');
    const actions = chrome.querySelector('.window-chrome-actions');
    const statusPill = chrome.querySelector('.window-chrome-actions .status-pill');
    const buttons = Array.from(chrome.querySelectorAll('.window-chrome-actions .action-button'));
    const branchButton = chrome.querySelector('[data-agent-branch-action="true"]');
    if (!(title instanceof HTMLElement) || !(actions instanceof HTMLElement) || !(statusPill instanceof HTMLElement)) {
      throw new Error('Agent title chrome was not rendered.');
    }

    const chromeRect = chrome.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const statusRect = statusPill.getBoundingClientRect();
    const buttonRects = buttons.map((button) => button.getBoundingClientRect());
    const actionsStyle = getComputedStyle(actions);
    const branchRect = branchButton instanceof HTMLElement ? branchButton.getBoundingClientRect() : null;
    const branchStyle = branchButton instanceof HTMLElement ? getComputedStyle(branchButton) : null;
    const branchLabel = branchButton instanceof HTMLElement
      ? branchButton.querySelector('.action-button-label')
      : null;
    const branchLabelRect = branchLabel instanceof HTMLElement ? branchLabel.getBoundingClientRect() : null;
    const branchLabelStyle = branchLabel instanceof HTMLElement ? getComputedStyle(branchLabel) : null;

    return {
      branchVisible: actions.dataset.agentBranchVisible,
      actionDensity: actions.dataset.agentActionDensity,
      titleFlexShrink: getComputedStyle(title).flexShrink,
      actionsFlexShrink: actionsStyle.flexShrink,
      actionsFlexWrap: actionsStyle.flexWrap,
      titleRight: titleRect.right,
      actionsLeft: actionsRect.left,
      chromeRight: chromeRect.right,
      actionsRight: actionsRect.right,
      statusStyle: {
        label: statusPill.textContent?.trim() ?? '',
        whiteSpace: getComputedStyle(statusPill).whiteSpace,
        width: statusRect.width,
        height: statusRect.height,
        right: statusRect.right,
        clientWidth: statusPill.clientWidth,
        scrollWidth: statusPill.scrollWidth
      },
      branchStyle: branchRect && branchStyle
        ? {
            label: branchButton.textContent?.trim() ?? '',
            whiteSpace: branchStyle.whiteSpace,
            width: branchRect.width,
            height: branchRect.height,
            clientWidth: branchButton.clientWidth,
            scrollWidth: branchButton.scrollWidth
          }
        : null,
      branchLabelStyle: branchLabelRect && branchLabelStyle
        ? {
            display: branchLabelStyle.display,
            whiteSpace: branchLabelStyle.whiteSpace,
            width: branchLabelRect.width,
            height: branchLabelRect.height
          }
        : null,
      titleInputStyle: (() => {
        const input = chrome.querySelector('.window-title-input');
        if (!(input instanceof HTMLElement)) {
          return null;
        }
        const style = getComputedStyle(input);
        return {
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace
        };
      })(),
      buttonStyles: buttons.map((button, index) => ({
        ...(() => {
          const label = button.querySelector('.action-button-label');
          const labelRect = label instanceof HTMLElement ? label.getBoundingClientRect() : null;
          const labelStyle = label instanceof HTMLElement ? getComputedStyle(label) : null;
          return {
            labelDisplay: labelStyle?.display ?? '',
            labelWhiteSpace: labelStyle?.whiteSpace ?? '',
            labelWidth: labelRect?.width ?? 0,
            labelHeight: labelRect?.height ?? 0
          };
        })(),
        label: button.textContent?.trim() ?? '',
        groupKey: button.closest('.action-button-group')?.className ?? '',
        whiteSpace: getComputedStyle(button).whiteSpace,
        width: buttonRects[index].width,
        height: buttonRects[index].height,
        left: buttonRects[index].left,
        right: buttonRects[index].right,
        top: buttonRects[index].top,
        bottom: buttonRects[index].bottom,
        clientWidth: button.clientWidth,
        scrollWidth: button.scrollWidth
      }))
    };
  });

  const minActionsGap = options.minActionsGap ?? 9;
  expect(layoutContract.branchVisible).toBe(options.expectedBranchVisible ?? 'false');
  expect(layoutContract.titleFlexShrink).toBe('1');
  expect(layoutContract.actionsFlexShrink).toBe('0');
  expect(layoutContract.actionsFlexWrap).toBe('nowrap');
  expect(layoutContract.actionsLeft - layoutContract.titleRight).toBeGreaterThanOrEqual(minActionsGap);
  expect(['已停止', '运行中']).toContain(layoutContract.statusStyle.label);
  expect(layoutContract.statusStyle.whiteSpace).toBe('nowrap');
  expect(layoutContract.statusStyle.width).toBeGreaterThanOrEqual(34);
  expect(layoutContract.statusStyle.height).toBeGreaterThanOrEqual(22);
  expect(layoutContract.statusStyle.right).toBeLessThanOrEqual(layoutContract.chromeRight - 1);
  expect(layoutContract.statusStyle.scrollWidth).toBeLessThanOrEqual(layoutContract.statusStyle.clientWidth + 1);
  expect(layoutContract.titleInputStyle).toMatchObject({
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  });
  expect(layoutContract.buttonStyles.map((button) => button.label)).toEqual(expectedLabels);
  expect(layoutContract.actionsRight).toBeLessThanOrEqual(layoutContract.chromeRight - 1);
  const normalWhiteSpaceLabels = new Set(options.normalWhiteSpaceLabels ?? []);
  for (const button of layoutContract.buttonStyles) {
    if (options.expectCompactActions || normalWhiteSpaceLabels.has(button.label)) {
      expect(button.whiteSpace).toBe('normal');
    } else {
      expect(button.whiteSpace).toBe('nowrap');
    }
    if (options.expectCompactActions) {
      expect(button.width).toBeGreaterThanOrEqual(20);
    } else {
      expect(button.width).toBeGreaterThanOrEqual(34);
    }
    expect(button.height).toBeGreaterThanOrEqual(22);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
  }
  if (options.expectCompactActions) {
    expect(layoutContract.actionDensity).toBe('compact-actions');
    for (const button of layoutContract.buttonStyles) {
      expect(button.labelDisplay).toBe('block');
      expect(button.labelWhiteSpace).toBe('normal');
      expect(button.labelHeight).toBeGreaterThan(button.labelWidth * 1.5);
    }
  }
  if (options.expectBranchActionWrap) {
    expect(layoutContract.branchStyle).toMatchObject({
      label: '分叉',
      whiteSpace: 'normal'
    });
    const branchButton = layoutContract.buttonStyles.find((button) => button.label === '分叉');
    const deleteButton = layoutContract.buttonStyles.find((button) => button.label === '删除');
    expect(branchButton).toBeTruthy();
    expect(deleteButton).toBeTruthy();
    expect(branchButton.height).toBeCloseTo(deleteButton.height, 1);
    expect(branchButton.width).toBeCloseTo(deleteButton.width, 1);
    expect(layoutContract.branchLabelStyle).toMatchObject({
      display: 'block',
      whiteSpace: 'normal'
    });
    expect(layoutContract.branchLabelStyle.height).toBeGreaterThan(layoutContract.branchLabelStyle.width * 1.5);
  }
  for (let index = 1; index < layoutContract.buttonStyles.length; index += 1) {
    const previousButton = layoutContract.buttonStyles[index - 1];
    const currentButton = layoutContract.buttonStyles[index];
    if (previousButton.groupKey && previousButton.groupKey === currentButton.groupKey) {
      expect(currentButton.left - previousButton.right).toBeGreaterThanOrEqual(0);
    } else {
      expect(currentButton.left - previousButton.right).toBeGreaterThanOrEqual(5);
    }
  }
}

test('Agent Fork action is hidden outside supported resumable sessions', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createStoppedAgentNodeState({ provider: 'codex', resumable: false }));
  await expect(nodeById(page, 'agent-1').locator('[data-agent-branch-action="true"]')).toHaveCount(0);

  await bootstrap(page, createStoppedAgentNodeState({ provider: 'claude', resumable: false }));
  await expect(nodeById(page, 'agent-1').locator('[data-agent-branch-action="true"]')).toHaveCount(0);

  const mismatchedState = createStoppedAgentNodeState({ provider: 'codex', resumable: true });
  mismatchedState.nodes[0].metadata.agent.resumeStrategy = 'claude-session-id';
  await bootstrap(page, mismatchedState);
  await expect(nodeById(page, 'agent-1').locator('[data-agent-branch-action="true"]')).toHaveCount(0);
});

test('agent restart actions wrap before pushing delete outside compact chrome', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');

  const state = createStoppedAgentNodeState({ resumable: true });
  state.nodes[0].title = 'Agent 4';
  state.nodes[0].size = { width: 420, height: state.nodes[0].size.height };
  state.nodes[0].metadata.agent.cwd =
    '/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2';
  state.nodes[0].metadata.agent.lastLaunchCommandLine =
    'codex --sandbox workspace-write --config compact-restart-action-overflow';

  await bootstrap(page, state);

  const agentNode = nodeById(page, 'agent-1');
  await expect(agentNode.locator('[data-agent-restart-action="new-session"]')).toBeVisible();
  await expect(agentNode.getByRole('button', { name: '删除' })).toBeVisible();

  const layout = await agentNode.evaluate((root) => {
    const chrome = root.querySelector('.window-chrome');
    const restartGroup = root.querySelector('.agent-restart-action-group');
    const newSessionButton = root.querySelector('[data-agent-restart-action="new-session"]');
    const resumeButton = root.querySelector('[data-agent-restart-action="resume"]');
    const deleteButton = Array.from(root.querySelectorAll('.window-chrome-actions button')).find(
      (button) => button.textContent?.trim() === '删除'
    );
    if (!chrome || !restartGroup || !newSessionButton || !resumeButton || !deleteButton) {
      throw new Error('Expected compact agent restart actions to be rendered.');
    }

    const chromeRect = chrome.getBoundingClientRect();
    const restartGroupRect = restartGroup.getBoundingClientRect();
    const newSessionButtonRect = newSessionButton.getBoundingClientRect();
    const resumeButtonRect = resumeButton.getBoundingClientRect();
    const deleteButtonRect = deleteButton.getBoundingClientRect();
    const newSessionButtonStyle = getComputedStyle(newSessionButton);
    const resumeButtonStyle = getComputedStyle(resumeButton);
    const deleteButtonStyle = getComputedStyle(deleteButton);

    return {
      chromeRight: chromeRect.right,
      restartGroupRight: restartGroupRect.right,
      newSessionButtonHeight: newSessionButtonRect.height,
      resumeButtonHeight: resumeButtonRect.height,
      deleteButtonLeft: deleteButtonRect.left,
      deleteButtonRight: deleteButtonRect.right,
      deleteButtonHeight: deleteButtonRect.height,
      newSessionButtonPaddingInlineStart: newSessionButtonStyle.paddingInlineStart,
      newSessionButtonPaddingInlineEnd: newSessionButtonStyle.paddingInlineEnd,
      resumeButtonPaddingInlineStart: resumeButtonStyle.paddingInlineStart,
      resumeButtonPaddingInlineEnd: resumeButtonStyle.paddingInlineEnd,
      deleteButtonPaddingInlineStart: deleteButtonStyle.paddingInlineStart,
      deleteButtonPaddingInlineEnd: deleteButtonStyle.paddingInlineEnd,
      newSessionButtonWhiteSpace: newSessionButtonStyle.whiteSpace,
      resumeButtonWhiteSpace: resumeButtonStyle.whiteSpace
    };
  });

  expect(layout.deleteButtonRight).toBeLessThanOrEqual(layout.chromeRight - 8);
  expect(layout.restartGroupRight).toBeLessThanOrEqual(layout.deleteButtonLeft - 4);
  expect(layout.newSessionButtonHeight).toBeGreaterThanOrEqual(layout.deleteButtonHeight);
  expect(layout.resumeButtonHeight).toBeGreaterThanOrEqual(layout.deleteButtonHeight);
  expect(layout.newSessionButtonPaddingInlineStart).toBe(layout.deleteButtonPaddingInlineStart);
  expect(layout.newSessionButtonPaddingInlineEnd).toBe(layout.deleteButtonPaddingInlineEnd);
  expect(layout.resumeButtonPaddingInlineStart).toBe(layout.deleteButtonPaddingInlineStart);
  expect(layout.resumeButtonPaddingInlineEnd).toBe(layout.deleteButtonPaddingInlineEnd);
  expect(layout.newSessionButtonWhiteSpace).toBe('normal');
  expect(layout.resumeButtonWhiteSpace).toBe('normal');
});

test('agent restart action falls back to start button when no resumable session exists', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createStoppedAgentNodeState({ resumable: false }));
  await clearPostedMessages(page);

  const agentNode = nodeById(page, 'agent-1');
  await expect(agentNode.locator('button:has-text("启动")')).toBeVisible();
  await expect(agentNode.locator('button:has-text("重启")')).toHaveCount(0);
  await expect(agentNode.locator('[data-agent-restart-action="new-session"]')).toHaveCount(0);
  await expect(agentNode.locator('[data-agent-restart-action="resume"]')).toHaveCount(0);

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

        return message
          ? JSON.stringify({
              provider: message.payload.provider,
              resume: message.payload.resume === true
            })
          : null;
      });
    })
    .toBe(
      JSON.stringify({
        provider: 'codex',
        resume: false
      })
    );
});

test('right-click create menu validates custom agent launch commands before creating', async ({ page }) => {
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
      x: 1060,
      y: 520
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu
    .locator('[data-context-menu-provider="codex"] [data-context-menu-provider-action="show-launch-modes"]')
    .click();
  await menu.locator('[data-context-menu-launch-preset="launch-custom"]').click();

  const customInput = menu.locator('[data-context-menu-custom-input="true"]');
  const confirmButton = menu.locator('[data-context-menu-custom-confirm="true"]');
  await expect(menu.locator('.canvas-context-menu-dismiss')).toHaveCount(0);
  await expect(customInput).toHaveValue('codex --timeout 300 --verbose');

  await customInput.fill('python not-agent');
  await expect(confirmButton).toBeDisabled();
  await expect(menu.locator('.canvas-context-menu-inline-error')).toContainText('codex');

  await customInput.fill('codex resume session-123');
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(menu).toBeHidden();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'agent',
    preferredPosition: {
      x: 780,
      y: 305
    },
    agentProvider: 'codex',
    agentLaunchPreset: 'custom',
    agentCustomLaunchCommand: 'codex resume session-123'
  });
});

test('right-click create menu blocks custom agent launch when provider default args are invalid', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(
    page,
    createCanvasScreenshotState(),
    createRuntimeContext({
      agentLaunchDefaults: {
        codex: {
          command: 'codex',
          defaultArgs: '--model "o3'
        },
        claude: {
          command: 'claude',
          defaultArgs: '--model sonnet'
        }
      }
    })
  );
  await clearPostedMessages(page);

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 1060,
      y: 520
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu
    .locator('[data-context-menu-provider="codex"] [data-context-menu-provider-action="show-launch-modes"]')
    .click();

  await expect(menu.locator('[data-context-menu-launch-error="true"]')).toContainText(
    'Codex 默认启动参数无法解析：双引号未闭合。'
  );
  await expect(menu.locator('[data-context-menu-launch-preset="launch-default"]')).toBeDisabled();
  await expect(menu.locator('[data-context-menu-launch-preset="launch-custom"]')).toBeDisabled();
  await expect(menu.locator('[data-context-menu-custom-editor="true"]')).toHaveCount(0);
});

test('right-click custom agent launch input ignores IME Enter before composition commits', async ({ page }) => {
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
      x: 1060,
      y: 520
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu
    .locator('[data-context-menu-provider="codex"] [data-context-menu-provider-action="show-launch-modes"]')
    .click();
  await menu.locator('[data-context-menu-launch-preset="launch-custom"]').click();

  const customInput = menu.locator('[data-context-menu-custom-input="true"]');
  await simulateImeCompositionOnTextField(page, customInput, 'codex --timeout 300 --verbose --yolo');

  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-context-menu-custom-confirm="true"]')).toBeEnabled();
  await expect
    .poll(async () => {
      return page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((entry) => entry.type === 'webview/createDemoNode').length
      );
    })
    .toBe(0);

  await customInput.press('Enter');

  await expect(menu).toBeHidden();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'agent',
    preferredPosition: {
      x: 780,
      y: 305
    },
    agentProvider: 'codex',
    agentLaunchPreset: 'yolo'
  });
});

test('right-click custom agent launch input closes before the menu backs out on Escape', async ({ page }) => {
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

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 1060,
      y: 520
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu
    .locator('[data-context-menu-provider="codex"] [data-context-menu-provider-action="show-launch-modes"]')
    .click();
  await menu.locator('[data-context-menu-launch-preset="launch-custom"]').click();

  await expect(menu.locator('[data-context-menu-custom-editor="true"]')).toBeVisible();
  await menu.locator('[data-context-menu-custom-confirm="true"]').focus();
  await page.keyboard.press('Escape');

  await expect(menu.locator('[data-context-menu-custom-editor="true"]')).toHaveCount(0);
  await expect(menu.locator('[data-context-menu-launch-preset="launch-default"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-back="true"]')).toBeVisible();
});

test('execution node chrome hides runtime diagnostics and keeps agent waiting-input visible', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createRuntimeChromeState());

  const agentNode = nodeById(page, 'agent-runtime');
  const terminalNode = nodeById(page, 'terminal-runtime');

  await expect(agentNode.locator('.status-pill')).toHaveCount(1);
  await expect(agentNode.locator('.status-pill').first()).toHaveText('等待输入');
  await expect(agentNode.locator('.status-pill').first()).toHaveClass(/tone-waiting/);
  await expect(agentNode).not.toContainText('best-effort');
  await expect(agentNode).not.toContainText('systemd-user');
  await expect(agentNode).not.toContainText('detached');

  await expect(terminalNode.locator('.status-pill')).toHaveCount(1);
  await expect(terminalNode.locator('.status-pill').first()).toHaveText('活动');
  await expect(terminalNode.locator('.status-pill').first()).toHaveClass(/tone-waiting/);
  await expect(terminalNode).not.toContainText('best-effort');
  await expect(terminalNode).not.toContainText('systemd-user');
  await expect(terminalNode).not.toContainText('detached');
});

test('canvas renders a shared execution help entry with tooltip text', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createRuntimeChromeState());

  const helpTrigger = page.locator('.canvas-help-panel .execution-help-trigger-canvas');

  await expect(helpTrigger).toBeVisible();
  await expect(helpTrigger).toContainText('使用提示');
  await helpTrigger.hover();
  const helpTooltip = page.locator('.execution-node-help-tooltip.is-visible');
  await expect(helpTooltip).toContainText('执行节点使用提示');
  await expect(helpTooltip).toContainText(
    '1. 拖拽文件到 Canvas 后按 Shift，再拖到终端或节点即可插入路径'
  );
  await expect(helpTooltip).toContainText(
    '4. 如需让 Agent 完成后主动提醒，请先在对应的 Agent CLI（Claude Code 或 Codex）中启用通知。'
  );
  await expect(helpTooltip).toContainText(
    '5. Windows 环境下如果执行节点受 PowerShell 策略影响，请按系统安全要求完成对应设置后再重试。'
  );
  await expect(helpTooltip).toContainText(
    '6. 多根 workspace 可通过 devSessionCanvas.canvas.multiRootPresentationMode 在 rootGroups 单张组合画布和 paneGallery 窗格画廊之间切换。'
  );
  await expect(helpTooltip).not.toContainText('notification_method');
  await expect(helpTooltip).not.toContainText('Set-ExecutionPolicy');
});

test('Claude Agent Ctrl-Z is blocked before execution input reaches the host', async ({ page }) => {
  const state = createLiveExecutionNodeState('agent');
  const agentNode = state.nodes[0];
  agentNode.status = 'waiting-input';
  agentNode.summary = 'Claude Code 已就绪，等待输入。';
  agentNode.metadata.agent.provider = 'claude';
  agentNode.metadata.agent.shellPath = 'claude';
  agentNode.metadata.agent.lifecycle = 'waiting-input';
  agentNode.metadata.agent.lastBackendLabel = 'Claude Code';

  await openHarness(page);
  await bootstrap(page, state);
  await waitForExecutionTerminalReady(page, 'agent-zoom');
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'sendExecutionInput',
    nodeId: 'agent-zoom',
    data: '\u001a'
  });

  await expect(page.locator('[data-toast-kind="error"]')).toHaveText(
    'Claude Agent 节点不支持 Ctrl-Z/fg；请使用停止、重启或分叉。'
  );
  const inputMessages = await page.evaluate(() =>
    window.__devSessionCanvasHarness
      .getPostedMessages()
      .filter((entry) => entry.type === 'webview/executionInput')
  );
  expect(inputMessages).toHaveLength(0);
});

test('Claude Agent Ctrl-Z block is scoped away from Terminal and Codex Agent input', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createLiveExecutionNodeState('terminal'));
  await waitForExecutionTerminalReady(page, 'terminal-zoom');
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'sendExecutionInput',
    nodeId: 'terminal-zoom',
    data: '\u001a'
  });

  await expect
    .poll(async () => readFirstExecutionInputPayload(page))
    .toMatchObject({ nodeId: 'terminal-zoom', kind: 'terminal', data: '\u001a' });
  await expect(page.locator('[data-toast-kind="error"]')).toHaveCount(0);

  await bootstrap(page, createLiveExecutionNodeState('agent'));
  await waitForExecutionTerminalReady(page, 'agent-zoom');
  await clearPostedMessages(page);

  await performTestDomAction(page, {
    kind: 'sendExecutionInput',
    nodeId: 'agent-zoom',
    data: '\u001a'
  });

  await expect
    .poll(async () => readFirstExecutionInputPayload(page))
    .toMatchObject({ nodeId: 'agent-zoom', kind: 'agent', data: '\u001a' });
  await expect(page.locator('[data-toast-kind="error"]')).toHaveCount(0);
});

test('suspended Claude Agent legacy state no longer exposes restore actions', async ({ page }) => {
  const state = createLiveExecutionNodeState('agent');
  const agentNode = state.nodes[0];
  agentNode.status = 'suspended';
  agentNode.summary = 'Claude Code 已挂起，请点击“停止”结束会话后重启。';
  agentNode.metadata.agent.provider = 'claude';
  agentNode.metadata.agent.shellPath = 'claude';
  agentNode.metadata.agent.lifecycle = 'suspended';
  agentNode.metadata.agent.lastBackendLabel = 'Claude Code';
  agentNode.metadata.agent.preSuspendLifecycle = 'waiting-input';
  agentNode.metadata.agent.lastSuspendReason = 'claude-ctrl-z';
  agentNode.metadata.agent.lastSuspendMessage = 'Claude Code 已挂起，请点击“停止”结束会话后重启。';
  agentNode.metadata.agent.resumeStrategy = 'claude-session-id';
  agentNode.metadata.agent.resumeSessionId = 'session-123';

  await openHarness(page);
  await bootstrap(page, state);
  await waitForExecutionTerminalReady(page, 'agent-zoom');

  const node = nodeById(page, 'agent-zoom');
  await expect(node.locator('.status-pill').first()).toHaveText('已挂起');
  await expect(node.getByRole('button', { name: '恢复', exact: true })).toHaveCount(0);
  await expect(node.locator('[data-agent-branch-action="true"]')).toHaveCount(0);
  await expect(node.getByRole('button', { name: '停止' })).toBeVisible();
  await expect(node.locator('.terminal-overlay')).toHaveCount(0);

  await clearPostedMessages(page);
  await node.getByRole('button', { name: '停止' }).click();
  const stopMessage = await waitForPostedMessageByType(page, 'webview/stopExecutionSession');
  expect(stopMessage.payload).toMatchObject({
    nodeId: 'agent-zoom',
    kind: 'agent'
  });
});

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} renders an inline execution help trigger beside the subtitle`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const node = nodeById(page, nodeId);
    const helpTrigger = node.locator('.window-title-subtitle-row .execution-help-trigger-inline');

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);

    await expect(helpTrigger).toBeVisible();
    await expect(helpTrigger.locator('.codicon.codicon-info')).toHaveCount(1);
    await expect(node.locator('.window-chrome-actions .execution-help-trigger')).toHaveCount(0);
    await helpTrigger.hover();
    await expect(page.locator('.execution-node-help-tooltip.is-visible')).toContainText('执行节点使用提示');
    await expect(page.locator('.execution-node-help-tooltip.is-visible')).toContainText(
      '1. 拖拽文件到 Canvas 后按 Shift，再拖到终端或节点即可插入路径'
    );
  });

  if (executionKind === 'agent') {
    test('agent title context shows cwd label above title and leaves launch command in subtitle', async ({
      page
    }) => {
      const state = createLiveExecutionNodeState('agent');
      const agentNode = state.nodes[0];
      const longLaunchCommand =
        'codex --model gpt-5.2 --sandbox workspace-write --yolo --config very-long-command-for-subtitle-overflow';
      const longCwd = [
        '/workspace/packages',
        'app-with-an-extraordinarily-long-root-label',
        'that-forces-the-cwd-context-tooltip'
      ].join('/');

      agentNode.size = { width: 420, height: agentNode.size.height };
      agentNode.metadata.agent.lastLaunchCommandLine = longLaunchCommand;
      agentNode.metadata.agent.cwd = longCwd;

      await openHarness(page);
      await bootstrap(
        page,
        state,
        createRuntimeContext({
          workspaceFolders: [{ name: 'workspace', path: '/workspace' }]
        })
      );
      await waitForExecutionTerminalReady(page, 'agent-zoom');

      const node = nodeById(page, 'agent-zoom');
      const context = node.locator('.window-title-context');
      const subtitle = node.locator('.window-title-subtitle');
      await expect
        .poll(async () => context.getAttribute('title'))
        .toBe(`${longCwd}/`);
      await expect(context).toContainText('packages/app-with-an-extraordinarily-long-root-label');
      await expect
        .poll(async () => subtitle.getAttribute('title'))
        .toBe(longLaunchCommand);
      await expect(subtitle).toContainText('codex --model gpt-5.2');

      const verticalOrder = await node.evaluate(() => {
        const contextElement = document.querySelector('[data-node-id="agent-zoom"] .window-title-context');
        const titleElement = document.querySelector('[data-node-id="agent-zoom"] [data-probe-field="title"]');
        const subtitleElement = document.querySelector('[data-node-id="agent-zoom"] .window-title-subtitle');
        if (!(contextElement instanceof HTMLElement) || !(titleElement instanceof HTMLElement) || !(subtitleElement instanceof HTMLElement)) {
          throw new Error('Agent title context, title, or subtitle was not rendered.');
        }

        return {
          contextBottom: contextElement.getBoundingClientRect().bottom,
          titleTop: titleElement.getBoundingClientRect().top,
          titleBottom: titleElement.getBoundingClientRect().bottom,
          subtitleTop: subtitleElement.getBoundingClientRect().top
        };
      });
      expect(verticalOrder.contextBottom).toBeLessThanOrEqual(verticalOrder.titleTop + 1);
      expect(verticalOrder.titleBottom).toBeLessThanOrEqual(verticalOrder.subtitleTop + 1);
    });

    test('agent title chrome keeps a bounded width even when the node grows wider', async ({ page }) => {
      const state = createLiveExecutionNodeState('agent');
      state.nodes[0].size = {
        width: 960,
        height: state.nodes[0].size.height
      };

      await openHarness(page);
      await bootstrap(page, state);
      await waitForExecutionTerminalReady(page, 'agent-zoom');

      const titleWidth = await nodeById(page, 'agent-zoom')
        .locator('.agent-window-title .window-title-copy')
        .evaluate((element) => Math.round(element.getBoundingClientRect().width));

      expect(titleWidth).toBeLessThanOrEqual(340);
    });
  }

  test(`${executionKind} dragover accepts explorer resources before payload becomes readable`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstUri = 'file:///workspace/path%20with%20space.txt';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await clearPostedMessages(page);

    const dragState = await page.evaluate(
      ({ nextNodeId, nextFirstUri }) => {
        const nodeRoot = document.querySelector(`[data-node-id="${nextNodeId}"]`);
        const dropTarget = nodeRoot?.querySelector('.terminal-frame');
        if (!dropTarget) {
          throw new Error(`Execution terminal ${nextNodeId} has no drop target.`);
        }

        const createStubDataTransfer = ({ types, getData }) => ({
          dropEffect: 'copy',
          effectAllowed: 'all',
          files: [],
          items: [],
          types,
          getData,
          setData: () => {},
          clearData: () => {},
          setDragImage: () => {}
        });
        const attachDataTransfer = (event, dataTransfer) => {
          Object.defineProperty(event, 'dataTransfer', {
            configurable: true,
            value: dataTransfer
          });
          return event;
        };
        const previewTransfer = createStubDataTransfer({
          types: ['ResourceURLs'],
          getData: () => ''
        });
        const dragEnter = attachDataTransfer(
          new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true
          }),
          previewTransfer
        );
        const dragOver = attachDataTransfer(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true
          }),
          previewTransfer
        );

        dropTarget.dispatchEvent(dragEnter);
        dropTarget.dispatchEvent(dragOver);

        const acceptedBeforePayloadReadable =
          dragEnter.defaultPrevented &&
          dragOver.defaultPrevented &&
          dropTarget.classList.contains('is-drop-target');

        const dropTransfer = createStubDataTransfer({
          types: ['ResourceURLs'],
          getData: (type) => (type === 'ResourceURLs' ? JSON.stringify([nextFirstUri]) : '')
        });
        const dropEvent = attachDataTransfer(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true
          }),
          dropTransfer
        );
        dropTarget.dispatchEvent(dropEvent);

        return {
          acceptedBeforePayloadReadable,
          dropDefaultPrevented: dropEvent.defaultPrevented,
          dropTargetCleared: !dropTarget.classList.contains('is-drop-target')
        };
      },
      {
        nextNodeId: nodeId,
        nextFirstUri: firstUri
      }
    );

    expect(dragState).toEqual({
      acceptedBeforePayloadReadable: true,
      dropDefaultPrevented: true,
      dropTargetCleared: true
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const message = window.__devSessionCanvasHarness
            .getPostedMessages()
            .find((entry) => entry.type === 'webview/dropExecutionResource');
          return message
            ? JSON.stringify({
                type: message.type,
                payload: message.payload
              })
            : null;
        });
      })
      .toBe(
        JSON.stringify({
          type: 'webview/dropExecutionResource',
          payload: {
            nodeId,
            kind: executionKind,
            resource: {
              source: 'resourceUrls',
              valueKind: 'uri',
              value: firstUri
            }
          }
        })
      );
  });

  test(`${executionKind} drag-and-drop forwards the first explorer resource to the host`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstUri = 'file:///workspace/path%20with%20space.txt';
    const secondUri = 'file:///workspace/second-file.txt';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'dropExecutionResources',
      nodeId,
      source: 'resourceUrls',
      values: [firstUri, secondUri]
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const message = window.__devSessionCanvasHarness
            .getPostedMessages()
            .find((entry) => entry.type === 'webview/dropExecutionResource');
          return message
            ? JSON.stringify({
                type: message.type,
                payload: message.payload
              })
            : null;
        });
      })
      .toBe(
        JSON.stringify({
          type: 'webview/dropExecutionResource',
          payload: {
            nodeId,
            kind: executionKind,
            resource: {
              source: 'resourceUrls',
              valueKind: 'uri',
              value: firstUri
            }
          }
        })
      );

    const dropFocusState = await page.evaluate((nextNodeId) => {
      const nodeRoot = document.querySelector(`[data-node-id="${nextNodeId}"]`);
      const textarea = nodeRoot?.querySelector('.xterm-helper-textarea');
      return textarea === document.activeElement;
    }, nodeId);
    expect(dropFocusState).toBe(true);
  });

  test(`${executionKind} terminal copy shortcut posts the xterm selection`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const outputLine = 'copy-target';

    await openHarness(page);
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
      startCol: 1,
      endCol: outputLine.length
    });
    await clearPostedMessages(page);
    await dispatchTerminalShortcut(page, nodeId, executionTerminalCopyShortcutEvent());

    const message = await waitForPostedMessageByType(page, 'webview/copyExecutionSelection');
    expect(message.payload).toEqual({
      nodeId,
      kind: executionKind,
      text: outputLine,
      clearSelectionAfterCopy: process.platform === 'win32'
    });
  });

  test(`${executionKind} terminal copy diagnostics expose shortcut, mouse tracking, context menu, and OSC52 state`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const outputLine = 'diagnostic-copy-target';
    const osc52Text = 'osc52 diagnostic copy';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    const readyProbe = await waitForExecutionTerminalReady(page, nodeId);
    expect(readyProbe.terminalMouseTrackingMode).toBe('none');
    expect(readyProbe.terminalBufferType).toBe('normal');

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${outputLine}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await clearPostedMessages(page);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: '\x1b[?1002h'
    });
    await settleWebview(page, 4);

    await expect
      .poll(async () => {
        const probeNode = await readProbeNode(page, nodeId, 20);
        return probeNode?.terminalMouseTrackingMode ?? null;
      })
      .toBe('drag');
    let diagnostic = (await readPostedMessagesByType(page, 'webview/executionClipboardDiagnostic')).find(
      (entry) => entry.payload.source === 'mouseTrackingMode'
    );
    expect(diagnostic).toBeTruthy();
    expect(diagnostic.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      source: 'mouseTrackingMode'
    });
    expect(diagnostic.payload.detail).toMatchObject({
      previous: 'none',
      current: 'drag',
      enabled: true
    });

    await clearPostedMessages(page);
    await dragTerminalSelection(page, {
      nodeId,
      row: 1,
      startCol: 1,
      endCol: Math.min(12, outputLine.length)
    });

    await expect
      .poll(async () => {
        const diagnostics = await readPostedMessagesByType(page, 'webview/executionClipboardDiagnostic');
        return diagnostics.some(
          (entry) =>
            entry.payload.source === 'mouseSelection' &&
            entry.payload.detail?.phase === 'mouseup' &&
            entry.payload.detail?.mouseTrackingMode === 'drag'
        );
      })
      .toBe(true);

    await clearPostedMessages(page);
    await dispatchTerminalShortcut(page, nodeId, executionTerminalCopyShortcutEvent());
    diagnostic = await waitForPostedMessageByType(page, 'webview/executionClipboardDiagnostic');
    expect(diagnostic.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      source: 'shortcut'
    });
    expect(diagnostic.payload.detail).toMatchObject({
      mouseTrackingMode: 'drag',
      selectionLength: 0,
      hasSelection: false
    });

    await clearPostedMessages(page);
    await nodeById(page, nodeId).locator('.xterm-screen').click({
      button: 'right',
      position: { x: 24, y: 24 }
    });
    diagnostic = await waitForPostedMessageByType(page, 'webview/executionClipboardDiagnostic');
    expect(diagnostic.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      source: 'contextMenu'
    });
    expect(diagnostic.payload.detail).toMatchObject({
      mouseTrackingMode: 'drag',
      hasSelection: false
    });

    await clearPostedMessages(page);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `\x1b]52;c;${Buffer.from(osc52Text, 'utf8').toString('base64')}\x07`
    });
    diagnostic = await waitForPostedMessageByType(page, 'webview/executionClipboardDiagnostic');
    expect(diagnostic.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      source: 'osc52'
    });
    expect(diagnostic.payload.detail).toMatchObject({
      target: 'c',
      dataKind: 'base64',
      decodedPreview: osc52Text
    });
  });

  test(`${executionKind} snapshot restore suppresses programmatic clipboard diagnostics`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const osc52Text = 'snapshot restore osc52 diagnostic';
    const snapshotOutput = `before restore\r\n\x1b[?1002h\x1b]52;c;${Buffer.from(
      osc52Text,
      'utf8'
    ).toString('base64')}\x07after restore\r\n`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await clearPostedMessages(page);

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: snapshotOutput,
      cols: 96,
      rows: 28,
      liveSession: true
    });

    await expect
      .poll(async () => {
        const diagnostics = await readPostedMessagesByType(page, 'webview/executionClipboardDiagnostic');
        return diagnostics.some((entry) => entry.payload.source === 'restoreSuppressed');
      })
      .toBe(true);

    const diagnostics = await readPostedMessagesByType(page, 'webview/executionClipboardDiagnostic');
    expect(
      diagnostics.filter((entry) => ['selectionChange', 'mouseTrackingMode', 'osc52'].includes(entry.payload.source))
    ).toHaveLength(0);
    const suppressionDiagnostic = diagnostics.find((entry) => entry.payload.source === 'restoreSuppressed');
    expect(suppressionDiagnostic.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      source: 'restoreSuppressed'
    });
    expect(suppressionDiagnostic.payload.detail).toMatchObject({
      reason: 'snapshot-restore',
      counts: {
        mouseTrackingMode: 1,
        osc52: 1
      }
    });

    await clearPostedMessages(page);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `\x1b]52;c;${Buffer.from('live osc52 diagnostic', 'utf8').toString('base64')}\x07`
    });
    const liveDiagnostic = await waitForPostedMessageByType(page, 'webview/executionClipboardDiagnostic');
    expect(liveDiagnostic.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      source: 'osc52'
    });
  });

  test(`${executionKind} input flushes snapshot restore clipboard diagnostic suppression`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const osc52Text = 'snapshot restore osc52 before input';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await clearPostedMessages(page);

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `before input\r\n\x1b]52;c;${Buffer.from(osc52Text, 'utf8').toString('base64')}\x07`,
      cols: 96,
      rows: 28,
      liveSession: true
    });

    await performTestDomAction(page, {
      kind: 'sendExecutionInput',
      nodeId,
      data: 'x'
    });

    await expect
      .poll(async () => {
        const diagnostics = await readPostedMessagesByType(page, 'webview/executionClipboardDiagnostic');
        return diagnostics.some((entry) => entry.payload.source === 'restoreSuppressed');
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const inputMessages = await readPostedMessagesByType(page, 'webview/executionInput');
        return inputMessages.some((entry) => entry.payload.nodeId === nodeId && entry.payload.data === 'x');
      })
      .toBe(true);

    await clearPostedMessages(page);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `\x1b]52;c;${Buffer.from('live osc52 after input', 'utf8').toString('base64')}\x07`
    });
    const liveDiagnostic = await waitForPostedMessageByType(page, 'webview/executionClipboardDiagnostic');
    expect(liveDiagnostic.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      source: 'osc52'
    });
  });

  test(`${executionKind} terminal paste shortcut requests host clipboard text and routes returned text through xterm`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const pasteText = 'pasted into xterm';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await clearPostedMessages(page);

    await dispatchTerminalShortcut(page, nodeId, executionTerminalPasteShortcutEvent());
    const pasteRequest = await waitForPostedMessageByType(page, 'webview/requestExecutionPaste');
    expect(pasteRequest.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      bracketedPasteMode: false
    });

    await page.evaluate(
      ({ requestId, nextNodeId, nextKind, nextPasteText }) => {
        window.__devSessionCanvasHarness.dispatchHostMessage({
          type: 'host/executionPasteText',
          payload: {
            requestId,
            nodeId: nextNodeId,
            kind: nextKind,
            text: nextPasteText
          }
        });
      },
      {
        requestId: pasteRequest.payload.requestId,
        nextNodeId: nodeId,
        nextKind: executionKind,
        nextPasteText: pasteText
      }
    );

    await expect
      .poll(async () => {
        const message = await page.evaluate(() => {
          return (
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .find((entry) => entry.type === 'webview/executionInput') ?? null
          );
        });
        return message?.payload?.data ?? null;
      })
      .toBe(pasteText);
  });

  test(`${executionKind} terminal paste response survives a delayed host confirmation`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const pasteText = 'confirmed paste after modal wait';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await page.clock.install({ time: new Date('2026-05-09T00:00:00Z') });
    await clearPostedMessages(page);

    await dispatchTerminalShortcut(page, nodeId, executionTerminalPasteShortcutEvent(), { settle: false });
    const pasteRequest = await waitForPostedMessageByType(page, 'webview/requestExecutionPaste');

    await page.clock.fastForward(31_000);
    await page.evaluate(
      ({ requestId, nextNodeId, nextKind, nextPasteText }) => {
        window.__devSessionCanvasHarness.dispatchHostMessage({
          type: 'host/executionPasteText',
          payload: {
            requestId,
            nodeId: nextNodeId,
            kind: nextKind,
            text: nextPasteText
          }
        });
      },
      {
        requestId: pasteRequest.payload.requestId,
        nextNodeId: nodeId,
        nextKind: executionKind,
        nextPasteText: pasteText
      }
    );

    await expect
      .poll(async () => {
        const message = await page.evaluate(() => {
          return (
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .find((entry) => entry.type === 'webview/executionInput') ?? null
          );
        });
        return message?.payload?.data ?? null;
      })
      .toBe(pasteText);
  });

  if (executionKind === 'agent') {
    test('agent paste event sends clipboard screenshots to the host and routes returned image path through xterm', async ({
      page
    }) => {
      const nodeId = 'agent-zoom';
      const pasteText = "'/tmp/dev-session-canvas-paste/screenshot.png' ";

      await openHarness(page);
      await bootstrap(page, createLiveExecutionNodeState('agent'));
      await waitForExecutionTerminalReady(page, nodeId);
      await clearPostedMessages(page);

      const pasteDispatch = await page.evaluate((nextNodeId) => {
        const textarea = document.querySelector(`[data-node-id="${nextNodeId}"] .xterm-helper-textarea`);
        if (!(textarea instanceof HTMLTextAreaElement)) {
          throw new Error(`Execution terminal ${nextNodeId} has no xterm textarea.`);
        }

        const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const file = new File([pngBytes], 'clipboard-screenshot.png', { type: 'image/png' });
        const clipboardData = {
          files: [file],
          items: [
            {
              kind: 'file',
              type: 'image/png',
              getAsFile: () => file
            }
          ],
          types: ['Files'],
          getData: () => '',
          setData: () => {},
          clearData: () => {},
          dropEffect: 'copy',
          effectAllowed: 'all'
        };
        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true
        });
        Object.defineProperty(event, 'clipboardData', {
          configurable: true,
          value: clipboardData
        });

        textarea.focus();
        textarea.dispatchEvent(event);

        return {
          defaultPrevented: event.defaultPrevented
        };
      }, nodeId);

      expect(pasteDispatch.defaultPrevented).toBe(true);

      const imagePasteRequest = await waitForPostedMessageByType(page, 'webview/pasteExecutionImage');
      expect(imagePasteRequest.payload).toMatchObject({
        nodeId,
        kind: 'agent',
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
        sizeBytes: 8,
        name: 'clipboard-screenshot.png'
      });

      await page.evaluate(
        ({ requestId, nextNodeId, nextPasteText }) => {
          window.__devSessionCanvasHarness.dispatchHostMessage({
            type: 'host/executionPasteText',
            payload: {
              requestId,
              nodeId: nextNodeId,
              kind: 'agent',
              text: nextPasteText
            }
          });
        },
        {
          requestId: imagePasteRequest.payload.requestId,
          nextNodeId: nodeId,
          nextPasteText: pasteText
        }
      );

      await expect
        .poll(async () => {
          const message = await page.evaluate(() => {
            return (
              window.__devSessionCanvasHarness
                .getPostedMessages()
                .find((entry) => entry.type === 'webview/executionInput') ?? null
            );
          });
          return message?.payload?.data ?? null;
        })
        .toBe(pasteText);
    });
  }

  if (executionKind === 'terminal') {
    test('terminal paste event ignores image-only clipboards instead of sending image paths to the shell', async ({
      page
    }) => {
      const nodeId = 'terminal-zoom';

      await openHarness(page);
      await bootstrap(page, createLiveExecutionNodeState('terminal'));
      await waitForExecutionTerminalReady(page, nodeId);
      await clearPostedMessages(page);

      await page.evaluate((nextNodeId) => {
        const textarea = document.querySelector(`[data-node-id="${nextNodeId}"] .xterm-helper-textarea`);
        if (!(textarea instanceof HTMLTextAreaElement)) {
          throw new Error(`Execution terminal ${nextNodeId} has no xterm textarea.`);
        }

        const file = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'terminal.png', { type: 'image/png' });
        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true
        });
        Object.defineProperty(event, 'clipboardData', {
          configurable: true,
          value: {
            files: [file],
            items: [
              {
                kind: 'file',
                type: 'image/png',
                getAsFile: () => file
              }
            ],
            types: ['Files'],
            getData: () => ''
          }
        });
        textarea.focus();
        textarea.dispatchEvent(event);
      }, nodeId);
      await settleWebview(page, 3);

      const messages = await page.evaluate(() => window.__devSessionCanvasHarness.getPostedMessages());
      expect(messages.filter((entry) => entry.type === 'webview/pasteExecutionImage')).toEqual([]);
      expect(messages.filter((entry) => entry.type === 'webview/executionInput')).toEqual([]);
    });
  }

  test(`${executionKind} terminal handles vi-style alternate screen without blocking input or node controls`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await clearPostedMessages(page);

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output:
        '\x1b[?1049h\x1b[?1h\x1b=\x1b[H\x1b[6n\x1bPzz\x1b\\\x1b[0%m\x1b[6n\x1b[>c\x1b]10;?\x07\x1b]11;?\x07' +
        '~/.bashrc                        1,1            All',
      cols: 96,
      rows: 28,
      liveSession: true
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return window.__devSessionCanvasHarness
            .getPostedMessages()
            .filter((entry) => entry.type === 'webview/executionInput')
            .map((entry) => entry.payload.data)
            .join('');
        });
      })
      .toMatch(/\x1b\[\d+;\d+R/);

    await nodeById(page, nodeId).locator('.xterm-screen').click({ position: { x: 16, y: 16 } });
    await settleWebview(page, 2);
    await clearPostedMessages(page);

    await page.keyboard.press('KeyI');
    await page.keyboard.type('abc');
    await page.keyboard.press('Escape');
    await page.keyboard.type(':q!');
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => {
        const payloads = await page.evaluate(() => {
          return window.__devSessionCanvasHarness
            .getPostedMessages()
            .filter((entry) => entry.type === 'webview/executionInput')
            .map((entry) => entry.payload);
        });
        return payloads.map((payload) => payload.data).join('');
      })
      .toBe('iabc\x1b:q!\r');

    await clearPostedMessages(page);
    await nodeById(page, nodeId).getByRole('button', { name: '停止' }).click();

    const stopMessage = await waitForPostedMessageByType(page, 'webview/stopExecutionSession');
    expect(stopMessage.payload).toMatchObject({
      nodeId,
      kind: executionKind
    });
  });

  test(`${executionKind} Ctrl+C without terminal selection still reaches the PTY as interrupt`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await focusExecutionTerminal(page, nodeId);
    await clearPostedMessages(page);

    await page.keyboard.press('Control+KeyC');

    await expect
      .poll(async () => {
        const message = await page.evaluate(() => {
          return (
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .find((entry) => entry.type === 'webview/executionInput') ?? null
          );
        });
        return message?.payload?.data ?? null;
      })
      .toBe('\u0003');
  });

  test(`${executionKind} link activation posts parsed file and URL targets`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const fileLinkText = 'src/index.ts:42:10';
    const cwdScopedFileLinkText = 'link-target.ts:3:1';
    const urlLinkText = 'https://example.com/docs?q=1';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${fileLinkText}\r\n${cwdScopedFileLinkText}\r\nOpen ${urlLinkText}.\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: fileLinkText
    });
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: cwdScopedFileLinkText
    });
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: urlLinkText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                type: entry.type,
                payload:
                  entry.payload.link.linkKind === 'file'
                    ? {
                        nodeId: entry.payload.nodeId,
                        kind: entry.payload.kind,
                        link: {
                          linkKind: entry.payload.link.linkKind,
                          text: entry.payload.link.text,
                          path: entry.payload.link.path,
                          line: entry.payload.link.line,
                          column: entry.payload.link.column,
                          targetKind: entry.payload.link.targetKind
                        }
                      }
                    : entry.payload
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            type: 'webview/openExecutionLink',
            payload: {
              nodeId,
              kind: executionKind,
              link: {
                linkKind: 'file',
                text: fileLinkText,
                path: 'src/index.ts',
                line: 42,
                column: 10,
                targetKind: 'file'
              }
            }
          },
          {
            type: 'webview/openExecutionLink',
            payload: {
              nodeId,
              kind: executionKind,
              link: {
                linkKind: 'file',
                text: cwdScopedFileLinkText,
                path: 'link-target.ts',
                line: 3,
                column: 1,
                targetKind: 'file'
              }
            }
          },
          {
            type: 'webview/openExecutionLink',
            payload: {
              nodeId,
              kind: executionKind,
              link: {
                linkKind: 'url',
                text: urlLinkText,
                url: urlLinkText,
                source: 'implicit'
              }
            }
          }
        ])
      );
  });

  test(`${executionKind} hard-wrapped URL fragments open as one link`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstUrlFragment = 'https://example.com/docs/very/';
    const secondUrlFragment = 'long/path?q=1';
    const hardWrappedUrl = `${firstUrlFragment}${secondUrlFragment}`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `Open ${firstUrlFragment}\r\n  ${secondUrlFragment}\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: hardWrappedUrl
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => entry.payload)
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'url',
              text: hardWrappedUrl,
              url: hardWrappedUrl,
              source: 'implicit'
            }
          }
        ])
      );
  });

  test(`${executionKind} hard-wrapped URL detector does not append indented prose`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const url = 'https://example.com/docs';
    const wronglyJoinedUrl = `${url}details`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `Open ${url}\r\n  details\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: wronglyJoinedUrl
      },
      'was not detected'
    );
  });

  test(`${executionKind} hard-wrapped URL detector does not merge adjacent URL lines`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstUrl = 'https://example.com/';
    const secondUrl = 'https://other.example/path';
    const wronglyJoinedUrl = `${firstUrl}${secondUrl}`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `Open ${firstUrl}\r\n  ${secondUrl}\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: wronglyJoinedUrl
      },
      'was not detected'
    );
  });

  test(`${executionKind} styled hard-wrapped file fragments resolve as one link`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathFragment = 'docs/design-docs/execution-terminal-tui-';
    const secondPathFragment = 'hard-wrapped-links.md';
    const hardWrappedPath = `${firstPathFragment}${secondPathFragment}`;

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [hardWrappedPath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `\u001b[94m${firstPathFragment}\u001b[39m\r\n  \u001b[94m${secondPathFragment}\u001b[39m\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: hardWrappedPath
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                nodeId: entry.payload.nodeId,
                kind: entry.payload.kind,
                link: {
                  linkKind: entry.payload.link.linkKind,
                  text: entry.payload.link.text,
                  path: entry.payload.link.path,
                  targetKind: entry.payload.link.targetKind,
                  source: entry.payload.link.source
                }
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'file',
              text: hardWrappedPath,
              path: hardWrappedPath,
              targetKind: 'file',
              source: 'hardwrap'
            }
          }
        ])
      );
  });

  test(`${executionKind} styled hard-wrapped code paths keep line and column suffixes`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathFragment = 'src/webview/executionTerminalNativeInteractions.';
    const secondPathFragment = 'ts:1600:12';
    const hardWrappedPath = `${firstPathFragment}${secondPathFragment}`;
    const resolvedPath = 'src/webview/executionTerminalNativeInteractions.ts';

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [hardWrappedPath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `TypeError: Cannot read properties of undefined\r\n    at renderTerminalLink (\u001b[94m${firstPathFragment}\u001b[39m\r\n      \u001b[94m${secondPathFragment}\u001b[39m)\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: hardWrappedPath
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                nodeId: entry.payload.nodeId,
                kind: entry.payload.kind,
                link: {
                  linkKind: entry.payload.link.linkKind,
                  text: entry.payload.link.text,
                  path: entry.payload.link.path,
                  line: entry.payload.link.line,
                  column: entry.payload.link.column,
                  targetKind: entry.payload.link.targetKind,
                  source: entry.payload.link.source
                }
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'file',
              text: hardWrappedPath,
              path: resolvedPath,
              line: 1600,
              column: 12,
              targetKind: 'file',
              source: 'hardwrap'
            }
          }
        ])
      );
  });

  test(`${executionKind} styled hard-wrapped file fragments are not joined through prose`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathFragment = 'src/webview/executionTerminalNativeInteractions.';
    const secondPathFragment = 'ts:1600:12';
    const hardWrappedPath = `${firstPathFragment}${secondPathFragment}`;

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [hardWrappedPath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `Error at \u001b[94m${firstPathFragment}\u001b[39m crashed\r\nnote: \u001b[94m${secondPathFragment}\u001b[39m elsewhere\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: hardWrappedPath
      },
      'was not detected'
    );
  });

  test(`${executionKind} styled hard-wrapped file continuations allow trailing prose`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathFragment = 'src/webview/executionTerminalNativeInteractions.';
    const secondPathFragment = 'ts:1600:12';
    const hardWrappedPath = `${firstPathFragment}${secondPathFragment}`;
    const resolvedPath = 'src/webview/executionTerminalNativeInteractions.ts';

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [hardWrappedPath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `\u001b[94m${firstPathFragment}\u001b[39m\r\n  \u001b[94m${secondPathFragment}\u001b[39m elsewhere\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: hardWrappedPath
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                nodeId: entry.payload.nodeId,
                kind: entry.payload.kind,
                link: {
                  linkKind: entry.payload.link.linkKind,
                  text: entry.payload.link.text,
                  path: entry.payload.link.path,
                  line: entry.payload.link.line,
                  column: entry.payload.link.column,
                  targetKind: entry.payload.link.targetKind,
                  source: entry.payload.link.source
                }
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'file',
              text: hardWrappedPath,
              path: resolvedPath,
              line: 1600,
              column: 12,
              targetKind: 'file',
              source: 'hardwrap'
            }
          }
        ])
      );
  });

  test(`${executionKind} styled hard-wrapped file hover underlines all fragments`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathFragment = 'docs/design-docs/execution-terminal-tui-';
    const secondPathFragment = 'hard-wrapped-links.md';
    const hardWrappedPath = `${firstPathFragment}${secondPathFragment}`;

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [hardWrappedPath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `\u001b[94m${firstPathFragment}\u001b[39m\r\n  \u001b[94m${secondPathFragment}\u001b[39m\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    try {
      await performTestDomAction(page, {
        kind: 'hoverExecutionLink',
        nodeId,
        text: hardWrappedPath
      });

      await expect.poll(async () => readHardWrappedLinkHoverSegmentCount(page, nodeId)).toBe(2);
    } finally {
      await performTestDomAction(page, {
        kind: 'clearExecutionLinkHover',
        nodeId
      }).catch(() => {});
    }

    await expect.poll(async () => readHardWrappedLinkHoverSegmentCount(page, nodeId)).toBe(0);
  });

  test(`${executionKind} unstyled hard-wrapped file fragments are not guessed as one link`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathFragment = 'docs/design-docs/execution-terminal-tui-';
    const secondPathFragment = 'hard-wrapped-links.md';
    const hardWrappedPath = `${firstPathFragment}${secondPathFragment}`;

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [hardWrappedPath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${firstPathFragment}\r\n  ${secondPathFragment}\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: hardWrappedPath
      },
      'was not detected'
    );
  });

  test(`${executionKind} styled hard-wrapped non-links are not guessed as one link`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstLogFragment = 'status-';
    const secondLogFragment = 'ok';
    const hardWrappedLogText = `${firstLogFragment}${secondLogFragment}`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `\u001b[94m${firstLogFragment}\u001b[39m\r\n  \u001b[94m${secondLogFragment}\u001b[39m\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: hardWrappedLogText
      },
      'was not detected'
    );
  });

  test(`${executionKind} multiline line-number links resolve against the previous path line`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const pathLineText = 'link-target.ts';
    const lineNumberLinkText = '3:1';
    const duplicateWordLinkLineText = lineNumberLinkText;
    const resultLineText = `  ${lineNumberLinkText}  export const value = 1;`;

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [lineNumberLinkText]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${duplicateWordLinkLineText}\r\n${pathLineText}\r\n${resultLineText}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: lineNumberLinkText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                nodeId: entry.payload.nodeId,
                kind: entry.payload.kind,
                link: {
                  linkKind: entry.payload.link.linkKind,
                  text: entry.payload.link.text,
                  path: entry.payload.link.path,
                  line: entry.payload.link.line,
                  column: entry.payload.link.column,
                  targetKind: entry.payload.link.targetKind,
                  source: entry.payload.link.source
                }
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'file',
              text: lineNumberLinkText,
              path: pathLineText,
              line: 3,
              column: 1,
              targetKind: 'file',
              source: 'detected'
            }
          }
        ])
      );
  });

  test(`${executionKind} multiline line-number links prefer file links when shell echo repeats the text`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const pathLineText = 'link-target.ts';
    const lineNumberLinkText = '2:8';
    const resultLineText = `  ${lineNumberLinkText}  export const two = 2;`;
    const serializedTerminalData =
      "initialmoon@InitialMoondeMacBook-Air execution-native-interactions % print\r\nf '%s\\n%s\\n' 'link-target.ts' '  2:8  export const two = 2;'\r\nlink-target.ts\r\n  2:8  export const two = 2;\r\ninitialmoon@InitialMoondeMacBook-Air execution-native-interactions % [?2004h";

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [lineNumberLinkText]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 74,
      rows: 24,
      liveSession: true,
      serializedTerminalState: {
        format: 'xterm-serialize-v1',
        data: serializedTerminalData,
        viewportY: 0
      }
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: lineNumberLinkText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const linkEvents = window.__devSessionCanvasHarness
            .getPostedMessages()
            .filter((entry) => entry.type === 'webview/openExecutionLink')
            .map((entry) => ({
              linkKind: entry.payload.link.linkKind,
              text: entry.payload.link.text,
              path: entry.payload.link.path,
              line: entry.payload.link.line,
              column: entry.payload.link.column,
              source: entry.payload.link.source
            }));
          return JSON.stringify(linkEvents);
        });
      })
      .toBe(
        JSON.stringify([
          {
            linkKind: 'file',
            text: lineNumberLinkText,
            path: pathLineText,
            line: 2,
            column: 8,
            source: 'detected'
          }
        ])
      );
  });

  test(`${executionKind} multiline links do not reuse stale previous-path cache after snapshot redraw`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathLineText = 'link-target.ts';
    const secondPathLineText = 'other-link-target.ts';
    const lineNumberLinkText = '2:8';
    const resultLineText = `  ${lineNumberLinkText}  export const two = 2;`;

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [lineNumberLinkText]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${firstPathLineText}\r\n${resultLineText}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: lineNumberLinkText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const linkEvents = window.__devSessionCanvasHarness
            .getPostedMessages()
            .filter((entry) => entry.type === 'webview/openExecutionLink')
            .map((entry) => entry.payload.link.path);
          return JSON.stringify(linkEvents);
        });
      })
      .toBe(JSON.stringify([firstPathLineText]));

    await clearPostedMessages(page);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${secondPathLineText}\r\n${resultLineText}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: lineNumberLinkText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const linkEvents = window.__devSessionCanvasHarness
            .getPostedMessages()
            .filter((entry) => entry.type === 'webview/openExecutionLink')
            .map((entry) => entry.payload.link.path);
          return JSON.stringify(linkEvents);
        });
      })
      .toBe(JSON.stringify([secondPathLineText]));
  });

  test(`${executionKind} word links match plain words and unresolved file-like paths as search links`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const searchWordText = 'xxxtest';
    const missingPathText = 'missing-target.ts:9:3';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${searchWordText}\r\n${missingPathText}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: searchWordText
    });
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: missingPathText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => entry.payload)
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'search',
              text: searchWordText,
              searchText: searchWordText,
              contextLine: searchWordText,
              bufferStartLine: 0,
              source: 'word'
            }
          },
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'search',
              text: missingPathText,
              searchText: missingPathText,
              contextLine: missingPathText,
              bufferStartLine: 1,
              source: 'word'
            }
          }
        ])
      );
  });

  test(`${executionKind} low-confidence word links underline only while the modifier is held`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const searchWordText = 'xxxtest';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${searchWordText}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    try {
      await performTestDomAction(page, {
        kind: 'hoverExecutionLink',
        nodeId,
        text: searchWordText
      });

      await expect
        .poll(async () => readTerminalUnderlinedText(page, nodeId))
        .not.toContain(searchWordText);

      await page.keyboard.down('Control');
      await expect.poll(async () => readTerminalUnderlinedText(page, nodeId)).toContain(searchWordText);

      await page.keyboard.up('Control');
      await expect
        .poll(async () => readTerminalUnderlinedText(page, nodeId))
        .not.toContain(searchWordText);
    } finally {
      await page.keyboard.up('Control').catch(() => {});
      await performTestDomAction(page, {
        kind: 'clearExecutionLinkHover',
        nodeId
      }).catch(() => {});
    }
  });

  test(`${executionKind} keeps hovered links active while live output continues`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const url = 'https://example.com/live-link';
    const underlinedUrlText = '//example.com/live-link';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `Open ${url}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    try {
      await performTestDomAction(page, {
        kind: 'hoverExecutionLink',
        nodeId,
        text: url
      });
      await expect.poll(async () => readTerminalUnderlinedText(page, nodeId)).toContain(underlinedUrlText);

      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: 'still working\r\n'
      });
      await settleWebview(page, 4);
      await expect.poll(async () => readTerminalUnderlinedText(page, nodeId)).toContain(underlinedUrlText);

      const clickPoint = await readFirstTerminalUnderlinedPoint(page, nodeId);
      if (!clickPoint) {
        throw new Error(`Expected ${url} to remain underlined after live output.`);
      }

      await clearPostedMessages(page);
      await page.keyboard.down('Control');
      await page.mouse.click(clickPoint.x, clickPoint.y);
      await page.keyboard.up('Control');

      await expect
        .poll(async () => {
          return page.evaluate((nextNodeId) => {
            const openedLink = window.__devSessionCanvasHarness
              .getPostedMessages()
              .find(
                (entry) =>
                  entry.type === 'webview/openExecutionLink' &&
                  entry.payload.nodeId === nextNodeId
              );
            return openedLink?.payload?.link?.text ?? null;
          }, nodeId);
        })
        .toContain('live-link');
    } finally {
      await page.keyboard.up('Control').catch(() => {});
      await performTestDomAction(page, {
        kind: 'clearExecutionLinkHover',
        nodeId
      }).catch(() => {});
    }
  });

  test(`${executionKind} reuses file link resolution while live output continues`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'src/live-link-target.ts';

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [filePath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `Open ${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    try {
      await performTestDomAction(page, {
        kind: 'hoverExecutionLink',
        nodeId,
        text: filePath
      });
      await expect.poll(async () => readTerminalUnderlinedText(page, nodeId)).toContain(filePath);

      await clearPostedMessages(page);
      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: 'still working\r\n'
      });
      await performTestDomAction(page, {
        kind: 'clearExecutionLinkHover',
        nodeId
      });
      await performTestDomAction(page, {
        kind: 'hoverExecutionLink',
        nodeId,
        text: filePath
      });

      const resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
      expect(
        resolveRequests.some((entry) =>
          entry.payload.candidates.some((candidate) => candidate.text === filePath)
        )
      ).toBe(false);
    } finally {
      await performTestDomAction(page, {
        kind: 'clearExecutionLinkHover',
        nodeId
      }).catch(() => {});
    }
  });

  test(`${executionKind} refreshes negative file link cache while live output continues`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'missing-target.ts:9:3';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });

    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [filePath]);
    await clearPostedMessages(page);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'created missing-target.ts\r\n'
    });
    await settleWebview(page, 4);
    await page.waitForTimeout(260);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'file',
        text: filePath,
        source: 'detected'
      });
  });

  test(`${executionKind} refreshes detected negative file link after second live output inside throttle window`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'throttled-created-target.ts:11:2';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'checking throttled-created-target.ts\r\n'
    });
    await page.waitForTimeout(260);
    await clearPostedMessages(page);

    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [filePath]);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'created throttled-created-target.ts\r\n'
    });
    await page.waitForTimeout(1050);
    await settleWebview(page, 4);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'file',
        text: filePath,
        source: 'detected'
      });
  });

  test(`${executionKind} revalidates a hovered negative file link after live output resolves it`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'hover-created-target.ts:9:3';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    try {
      await performTestDomAction(page, {
        kind: 'hoverExecutionLink',
        nodeId,
        text: filePath
      });
      await page.keyboard.down('Control');
      await expect.poll(async () => readTerminalUnderlinedText(page, nodeId)).toContain(filePath);

      const hoveredPoint = await readFirstTerminalUnderlinedPoint(page, nodeId);
      if (!hoveredPoint) {
        throw new Error(`Expected ${filePath} to be underlined before live output.`);
      }

      await clearPostedMessages(page);
      await page.mouse.click(hoveredPoint.x, hoveredPoint.y);
      await expect
        .poll(async () => readLastOpenedExecutionLink(page, nodeId))
        .toMatchObject({
          linkKind: 'search',
          text: filePath,
          source: 'word'
        });

      await page.evaluate((nextResolvedTexts) => {
        window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
      }, [filePath]);
      await clearPostedMessages(page);
      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: 'created hover-created-target.ts\r\n'
      });
      await page.waitForTimeout(260);
      await settleWebview(page, 4);

      await page.mouse.click(hoveredPoint.x, hoveredPoint.y);

      await expect
        .poll(async () => readLastOpenedExecutionLink(page, nodeId))
        .toMatchObject({
          linkKind: 'file',
          text: filePath,
          source: 'detected'
        });
    } finally {
      await page.keyboard.up('Control').catch(() => {});
      await performTestDomAction(page, {
        kind: 'clearExecutionLinkHover',
        nodeId
      }).catch(() => {});
    }
  });

  test(`${executionKind} revalidates a hovered hard-wrapped negative file link continuation`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstPathFragment = 'docs/design-docs/execution-terminal-tui-';
    const secondPathFragment = 'hard-wrapped-links.md';
    const hardWrappedPath = `${firstPathFragment}${secondPathFragment}`;

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `\u001b[94m${firstPathFragment}\u001b[39m\r\n  \u001b[94m${secondPathFragment}\u001b[39m\r\n`,
      cols: 120,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    try {
      await performTestDomAction(page, {
        kind: 'hoverExecutionLink',
        nodeId,
        text: hardWrappedPath
      });
      await page.keyboard.down('Control');
      await expect.poll(async () => readHardWrappedLinkHoverSegmentCount(page, nodeId)).toBe(2);

      const hoveredPoint = await readLastHardWrappedLinkHoverSegmentPoint(page, nodeId);
      if (!hoveredPoint) {
        throw new Error(`Expected ${secondPathFragment} to be underlined before live output.`);
      }

      await clearPostedMessages(page);
      await page.mouse.click(hoveredPoint.x, hoveredPoint.y);
      await expect
        .poll(async () => readLastOpenedExecutionLink(page, nodeId))
        .toMatchObject({
          linkKind: 'search',
          text: hardWrappedPath,
          source: 'word'
        });

      await page.evaluate((nextResolvedTexts) => {
        window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
      }, [hardWrappedPath]);
      await clearPostedMessages(page);
      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: 'created hard-wrapped-links.md\r\n'
      });
      await page.waitForTimeout(260);
      await settleWebview(page, 4);

      await page.mouse.click(hoveredPoint.x, hoveredPoint.y);

      await expect
        .poll(async () => readLastOpenedExecutionLink(page, nodeId))
        .toMatchObject({
          linkKind: 'file',
          text: hardWrappedPath,
          source: 'hardwrap'
        });
    } finally {
      await page.keyboard.up('Control').catch(() => {});
      await performTestDomAction(page, {
        kind: 'clearExecutionLinkHover',
        nodeId
      }).catch(() => {});
    }
  });

  test(`${executionKind} delays coalesced negative file link refreshes after live output`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'coalesced-target.ts:5:1';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });
    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });

    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setHoldExecutionFileLinkResponses(true);
    });
    await clearPostedMessages(page);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'checking coalesced-target.ts\r\n'
    });
    await waitForPostedMessageByType(page, 'webview/resolveExecutionFileLinks');

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'still checking coalesced-target.ts\r\n'
    });
    await page.waitForTimeout(260);
    const flushedResponses = await page.evaluate(() => {
      return window.__devSessionCanvasHarness.flushExecutionFileLinkResponses(1);
    });
    expect(flushedResponses).toBe(1);
    await settleWebview(page, 1);

    let resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
    expect(
      resolveRequests.filter((entry) =>
        entry.payload.candidates.some((candidate) => candidate.text === filePath)
      ).length
    ).toBe(1);

    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
      window.__devSessionCanvasHarness.setHoldExecutionFileLinkResponses(false);
    }, [filePath]);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'created coalesced-target.ts\r\n'
    });

    await expect
      .poll(async () => {
        resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
        return resolveRequests.filter((entry) =>
          entry.payload.candidates.some((candidate) => candidate.text === filePath)
        ).length;
      })
      .toBeGreaterThanOrEqual(2);
    await settleWebview(page, 4);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'file',
        text: filePath,
        source: 'detected'
      });
  });

  test(`${executionKind} keeps unresolved file link fallback stable while live output continues`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'still-missing-target.ts:7:1';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });
    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });

    await clearPostedMessages(page);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: '...\r\n'
    });
    await settleWebview(page, 4);
    await page.waitForTimeout(260);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });
    const resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
    expect(
      resolveRequests.some((entry) =>
        entry.payload.candidates.some((candidate) => candidate.text === filePath)
      )
    ).toBe(false);
  });

  test(`${executionKind} does not eagerly resolve fallback-only text during hover or live output`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const ordinaryLines = Array.from(
      { length: 12 },
      (_, index) => `plainstatus${String(index + 1).padStart(2, '0')} waiting for stream update`
    );

    const countFallbackResolveRequests = async () => {
      const resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
      return resolveRequests.filter((entry) =>
        entry.payload.candidates.some(
          (candidate) =>
            candidate.source === 'fallback' && ordinaryLines.includes(candidate.text)
        )
      ).length;
    };

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${ordinaryLines.join('\r\n')}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    for (const line of ordinaryLines) {
      const hoverText = line.split(' ')[0];
      await performTestDomAction(page, {
        kind: 'hoverExecutionText',
        nodeId,
        text: hoverText
      });
    }

    await expect.poll(async () => countFallbackResolveRequests()).toBe(0);
    await performTestDomAction(page, {
      kind: 'clearExecutionLinkHover',
      nodeId
    });

    await clearPostedMessages(page);
    for (let index = 0; index < 3; index += 1) {
      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: `live output heartbeat ${index + 1}\r\n`
      });
      await page.waitForTimeout(260);
    }
    await settleWebview(page, 4);

    expect(await countFallbackResolveRequests()).toBe(0);
  });

  test(`${executionKind} resolves fallback file links only on activation`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'lazy-fallback-target.mjs';

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [filePath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'hoverExecutionLink',
      nodeId,
      text: filePath
    });
    expect(await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks')).toEqual([]);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'file',
        text: filePath,
        source: 'fallback'
      });
    const resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
    expect(resolveRequests).toHaveLength(1);
    expect(resolveRequests[0].payload.priority).toBe('interactive');
    expect(resolveRequests[0].payload.candidates).toMatchObject([
      {
        text: filePath,
        source: 'fallback'
      }
    ]);
  });

  test(`${executionKind} falls back to search when lazy file link activation times out`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'timeout-fallback-target.mjs';

    await openHarness(page);
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
      window.__devSessionCanvasHarness.setExecutionFileLinkResolutionDelayMs(3000);
    }, [filePath]);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });
    const resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
    expect(resolveRequests).toHaveLength(1);
    expect(resolveRequests[0].payload.priority).toBe('interactive');
  });

  test(`${executionKind} keeps extensionless fallback paths activation-only with interactive priority`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'custom/tool';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'hoverExecutionLink',
      nodeId,
      text: filePath
    });
    expect(await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks')).toEqual([]);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });
    const resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
    expect(resolveRequests).toHaveLength(1);
    expect(resolveRequests[0].payload.priority).toBe('interactive');
    expect(resolveRequests[0].payload.candidates).toMatchObject([
      {
        text: filePath,
        path: filePath,
        source: 'fallback'
      }
    ]);
  });

  test(`${executionKind} ignores stale pending negative file link resolution after live output`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'eventual-target.ts:4:2';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
      window.__devSessionCanvasHarness.setExecutionFileLinkResolutionDelayMs(700);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    const staleActivation = performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });
    await waitForPostedMessageByType(page, 'webview/resolveExecutionFileLinks');

    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
    }, [filePath]);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'created eventual-target.ts\r\n'
    });
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setExecutionFileLinkResolutionDelayMs(0);
    });
    await settleWebview(page, 4);
    await page.waitForTimeout(260);
    await staleActivation;

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });

    await clearPostedMessages(page);
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'file',
        text: filePath,
        source: 'detected'
      });
  });

  test(`${executionKind} schedules delayed refresh after stale negative refresh is invalidated`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const filePath = 'stale-refresh-target.ts:6:2';

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
      window.__devSessionCanvasHarness.setExecutionFileLinkResolutionDelayMs(500);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${filePath}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    const pendingActivation = performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });
    await waitForPostedMessageByType(page, 'webview/resolveExecutionFileLinks');
    const countDetectedFileResolveRequests = async () => {
      const resolveRequests = await readPostedMessagesByType(page, 'webview/resolveExecutionFileLinks');
      return resolveRequests.filter((entry) =>
        entry.payload.candidates.some(
          (candidate) => candidate.text === filePath && candidate.source === 'detected'
        )
      ).length;
    };
    const initialDetectedRequestCount = await countDetectedFileResolveRequests();

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'first invalidation for stale-refresh-target.ts\r\n'
    });

    await expect
      .poll(async () => {
        return countDetectedFileResolveRequests();
      })
      .toBeGreaterThan(initialDetectedRequestCount);
    const staleRefreshRequestCount = await countDetectedFileResolveRequests();
    expect(staleRefreshRequestCount).toBeGreaterThan(initialDetectedRequestCount);

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: 'second invalidation for stale-refresh-target.ts\r\n'
    });
    await page.evaluate((nextResolvedTexts) => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts(nextResolvedTexts);
      window.__devSessionCanvasHarness.setExecutionFileLinkResolutionDelayMs(0);
    }, [filePath]);
    await page.waitForTimeout(260);

    await expect
      .poll(async () => {
        return countDetectedFileResolveRequests();
      })
      .toBeGreaterThan(staleRefreshRequestCount);
    await pendingActivation;
    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'search',
        text: filePath,
        source: 'word'
      });
    await settleWebview(page, 4);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: filePath
    });

    await expect
      .poll(async () => readLastOpenedExecutionLink(page, nodeId))
      .toMatchObject({
        linkKind: 'file',
        text: filePath,
        source: 'detected'
      });
  });

  test(`${executionKind} does not synthesize trimmed links from attached CJK prose`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const cleanPathText =
      'demo/web_demo/WebRTC_Demo/omni_backend_code/code/voice_chat/omni_stream.py:159';
    const proseAttachedLine = `这里要么在${cleanPathText}`;

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${proseAttachedLine}\r\n`,
      cols: 140,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: cleanPathText
      },
      'was not detected'
    );
    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: proseAttachedLine
      },
      'was not detected'
    );
  });

  test(`${executionKind} does not promote trimmed wrapper or punctuation candidates into file links`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const wrappedDirectoryLinkText = 'src/webview';
    const trailingDirectoryLinkText = 'src/panel';
    const wrappedLineText = `[${wrappedDirectoryLinkText}]`;
    const trailingLineText = `${trailingDirectoryLinkText}.`;

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${wrappedLineText}\r\n${trailingLineText}\r\n`,
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: wrappedDirectoryLinkText
    });
    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: trailingDirectoryLinkText
      },
      'was not detected'
    );
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: trailingLineText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                text: entry.payload.link.text,
                linkKind: entry.payload.link.linkKind,
                source: entry.payload.link.source
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            text: wrappedDirectoryLinkText,
            linkKind: 'search',
            source: 'word'
          },
          {
            text: trailingLineText,
            linkKind: 'search',
            source: 'word'
          }
        ])
      );
  });

  test(`${executionKind} treats CJK punctuation as a file-link boundary in Chinese prose`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const firstDirectoryLinkText = 'src/webview';
    const secondDirectoryLinkText = 'src/panel';
    const proseLine = `开放问题： 仓库里同时有两套目录： ${firstDirectoryLinkText} 和 ${secondDirectoryLinkText}。`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${proseLine}\r\n`,
      cols: 44,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: firstDirectoryLinkText
    });
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: secondDirectoryLinkText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                nodeId: entry.payload.nodeId,
                kind: entry.payload.kind,
                link: {
                  linkKind: entry.payload.link.linkKind,
                  text: entry.payload.link.text,
                  path: entry.payload.link.path,
                  targetKind: entry.payload.link.targetKind,
                  source: entry.payload.link.source
                }
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'file',
              text: firstDirectoryLinkText,
              path: firstDirectoryLinkText,
              targetKind: 'file',
              source: 'detected'
            }
          },
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'file',
              text: secondDirectoryLinkText,
              path: secondDirectoryLinkText,
              targetKind: 'file',
              source: 'detected'
            }
          }
        ])
      );
  });

  test(`${executionKind} keeps file-like words clickable across CJK punctuation boundaries`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const designDocPath = 'docs/foo.md';
    const proseLine = `设计文档：${designDocPath}。`;

    await openHarness(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.setResolvedExecutionFileLinkTexts([]);
    });
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${proseLine}\r\n`,
      cols: 44,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: designDocPath
    });
    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: proseLine
      },
      'was not detected'
    );

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                nodeId: entry.payload.nodeId,
                kind: entry.payload.kind,
                link: {
                  linkKind: entry.payload.link.linkKind,
                  text: entry.payload.link.text,
                  searchText: entry.payload.link.searchText,
                  source: entry.payload.link.source
                }
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'search',
              text: designDocPath,
              searchText: designDocPath,
              source: 'word'
            }
          }
        ])
      );
  });

  test(`${executionKind} keeps Chinese file paths eligible for exact file links`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const chineseFilePath = '文档/设计.md';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: `${chineseFilePath}\r\n`,
      cols: 44,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: chineseFilePath
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => ({
                nodeId: entry.payload.nodeId,
                kind: entry.payload.kind,
                link: {
                  linkKind: entry.payload.link.linkKind,
                  text: entry.payload.link.text,
                  path: entry.payload.link.path,
                  targetKind: entry.payload.link.targetKind,
                  source: entry.payload.link.source
                }
              }))
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'file',
              text: chineseFilePath,
              path: chineseFilePath,
              targetKind: 'file',
              source: 'detected'
            }
          }
        ])
      );
  });

  test(`${executionKind} link activation covers additional URI schemes and OSC 8 hyperlinks`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const mailtoLinkText = 'mailto:test@example.com';
    const vscodeLinkText = 'vscode://file/workspace/foo.ts:3:2';
    const explicitUrlLinkText = 'https://example.com/explicit';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: [
        `${mailtoLinkText}\r\n`,
        `${vscodeLinkText}\r\n`,
        `\u001b]8;;${explicitUrlLinkText}\u0007explicit label\u001b]8;;\u0007\r\n`
      ].join(''),
      cols: 96,
      rows: 28,
      liveSession: true
    });
    await settleWebview(page, 4);
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: mailtoLinkText
    });
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: vscodeLinkText
    });
    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: explicitUrlLinkText
    });

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return JSON.stringify(
            window.__devSessionCanvasHarness
              .getPostedMessages()
              .filter((entry) => entry.type === 'webview/openExecutionLink')
              .map((entry) => entry.payload)
          );
        });
      })
      .toBe(
        JSON.stringify([
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'url',
              text: mailtoLinkText,
              url: mailtoLinkText,
              source: 'implicit'
            }
          },
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'url',
              text: vscodeLinkText,
              url: vscodeLinkText,
              source: 'implicit'
            }
          },
          {
            nodeId,
            kind: executionKind,
            link: {
              linkKind: 'url',
              text: explicitUrlLinkText,
              url: explicitUrlLinkText,
              source: 'explicit'
            }
          }
        ])
      );
  });
}

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

test('pressing Enter in the title input commits exactly one update and keeps the rendered title aligned', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createCanvasScreenshotState());
  await clearPostedMessages(page);

  const titleInput = nodeById(page, 'agent-1').locator('[data-probe-field="title"]');
  const nextTitle = 'Agent Heading Via Enter';

  await titleInput.click();
  await titleInput.fill(nextTitle);
  await titleInput.press('Enter');
  await settleWebview(page, 4);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const titleMessages = window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((entry) => entry.type === 'webview/updateNodeTitle');

        return JSON.stringify(
          titleMessages.map((entry) => ({
            nodeId: entry.payload.nodeId,
            title: entry.payload.title
          }))
        );
      });
    })
    .toBe(
      JSON.stringify([
        {
          nodeId: 'agent-1',
          title: nextTitle
        }
      ])
    );

  await expect(titleInput).toHaveValue(nextTitle);
  await expect
    .poll(async () => {
      const probeNode = await readProbeNode(page, 'agent-1', 20);
      return probeNode ? JSON.stringify(probeNode) : null;
    })
    .toContain(nextTitle);
});

test('IME confirmation Enter does not submit or duplicate the title before explicit commit', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createCanvasScreenshotState());
  await clearPostedMessages(page);

  const titleInput = nodeById(page, 'agent-1').locator('[data-probe-field="title"]');
  const nextTitle = 'Code';

  await simulateImeCompositionOnTextField(page, titleInput, nextTitle);
  await settleWebview(page, 4);

  await expect(titleInput).toHaveValue(nextTitle);
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((entry) => entry.type === 'webview/updateNodeTitle').length;
      });
    })
    .toBe(0);

  await titleInput.press('Enter');
  await settleWebview(page, 4);

  await expect(titleInput).toHaveValue(nextTitle);
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const titleMessages = window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((entry) => entry.type === 'webview/updateNodeTitle');

        return JSON.stringify(
          titleMessages.map((entry) => ({
            nodeId: entry.payload.nodeId,
            title: entry.payload.title
          }))
        );
      });
    })
    .toBe(
      JSON.stringify([
        {
          nodeId: 'agent-1',
          title: nextTitle
        }
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
  const beforeTransform = await readCanvasViewportTransform(page);
  expect(beforeState.viewport).toEqual({
    x: -420,
    y: -220,
    zoom: 0.48
  });
  expect(beforeTransform).not.toBeNull();

  await page
    .locator('[data-node-id="agent-1"] .window-chrome')
    .dispatchEvent('dblclick', { bubbles: true, cancelable: true, composed: true });

  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedNodeId ?? null)
    .toBe('agent-1');
  await expect
    .poll(async () => {
      const transform = await readCanvasViewportTransform(page);
      return transform && transform !== beforeTransform ? transform : null;
    })
    .not.toBeNull();

  const duringState = await readPersistedUiState(page);
  expect(duringState.viewport).toEqual(beforeState.viewport);

  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).toBe('agent-1');
  expect(afterState.viewport.zoom).toBeGreaterThan(0.48);
  expect(afterState.viewport.zoom).toBeLessThanOrEqual(1.15);
  expect(afterState.viewport.x).not.toBe(beforeState.viewport.x);
  expect(afterState.viewport.y).not.toBe(beforeState.viewport.y);
});

test('fit view can zoom below the comfort minimum and enters overview mode for distant nodes', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.4
      }
    }
  });
  const state = createDistantOverviewState();
  await bootstrap(page, state);
  await settleWebview(page, 4);

  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-mode', 'false');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-config', 'title');

  await page.locator('.react-flow__controls-fitview').click();

  await expect.poll(async () => readCanvasViewportScale(page)).toBeLessThan(0.2);
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-mode', 'true');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-config', 'title');

  const fitZoom = await readCanvasViewportScale(page);
  expect(fitZoom).toBeGreaterThan(0);

  const viewportSize = page.viewportSize();
  expect(viewportSize).not.toBeNull();
  for (const node of state.nodes) {
    const box = await nodeById(page, node.id).boundingBox();
    expect(box, `${node.id} should be rendered in the viewport after fit view`).not.toBeNull();
    expect(box.x + box.width).toBeGreaterThanOrEqual(-2);
    expect(box.y + box.height).toBeGreaterThanOrEqual(-2);
    expect(box.x).toBeLessThanOrEqual(viewportSize.width + 2);
    expect(box.y).toBeLessThanOrEqual(viewportSize.height + 2);
  }

  await expect(nodeById(page, 'agent-1').locator('[data-probe-field="title"]')).toBeVisible();
  await expect
    .poll(async () => readComputedOpacity(page, '[data-node-id="note-1"] .note-editor-surface'))
    .toBe('0');
  await expect(nodeById(page, 'note-1').locator('.node-overview-title')).toContainText('回看 smoke test');
  await expect(nodeById(page, 'note-1').locator('.node-overview-status')).toHaveCount(0);
  await expect(nodeById(page, 'agent-1').locator('.node-overview-status')).toHaveAttribute(
    'data-overview-status',
    'draft'
  );
  await expect(nodeById(page, 'agent-1').locator('.node-overview-status')).toContainText('草稿');
  await expect
    .poll(async () => readComputedOpacity(page, '[data-node-id="agent-1"] .node-overview-status'))
    .toBe('1');
  await expect
    .poll(async () => readComputedOpacity(page, '[data-node-id="note-1"] .node-overview-title'))
    .toBe('1');
});

test('minimap wheel honors the dynamic fit view min zoom', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.8
      }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'workspace-root-huge',
      title: 'Huge Root',
      position: { x: -2400, y: -1800 },
      size: { width: 22000, height: 16000 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/huge'
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 4);

  await page.locator('.react-flow__controls-fitview').click();
  await expect.poll(async () => readCanvasViewportScale(page)).toBeLessThan(0.1);
  await expect.poll(async () => (await readPersistedUiState(page)).viewport?.zoom ?? null).toBeLessThan(0.1);
  await clearPostedMessages(page);

  const beforeWheelState = await readPersistedUiState(page);
  const minimapBox = await page.locator('.canvas-minimap svg').boundingBox();
  expect(minimapBox).not.toBeNull();

  await page.mouse.move(minimapBox.x + minimapBox.width / 2, minimapBox.y + minimapBox.height / 2);
  await page.mouse.wheel(0, 120);
  await settleWebview(page, 4);

  const afterWheelState = await readPersistedUiState(page);
  expect(afterWheelState.viewport.zoom).toBeLessThanOrEqual(beforeWheelState.viewport.zoom);
  expect(afterWheelState.viewport.zoom).toBeLessThan(0.1);

  const centerMessages = await readPostedMessagesByType(page, 'webview/updateViewportCenter');
  expect(centerMessages.length).toBeGreaterThan(0);
});

test('fit view includes empty workspace root sections in multi-root canvases', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.4
      }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'workspace-root-frontend',
      title: 'Frontend',
      position: { x: 120, y: 120 },
      size: { width: 760, height: 460 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    },
    {
      id: 'workspace-root-backend',
      title: 'Backend',
      position: { x: 5200, y: 2800 },
      size: { width: 920, height: 540 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/backend'
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 4);

  await page.locator('.react-flow__controls-fitview').click();

  await expect
    .poll(async () => {
      const rootBox = await page.locator('[data-group-id="workspace-root-backend"]').boundingBox();
      return rootBox && rootBox.x < page.viewportSize().width ? rootBox : null;
    })
    .not.toBeNull();

  const viewportSize = page.viewportSize();
  expect(viewportSize).not.toBeNull();
  for (const group of state.groups) {
    const box = await page.locator(`[data-group-id="${group.id}"]`).boundingBox();
    expect(box, `${group.id} should be rendered in the viewport after fit view`).not.toBeNull();
    expect(box.x + box.width).toBeGreaterThanOrEqual(-2);
    expect(box.y + box.height).toBeGreaterThanOrEqual(-2);
    expect(box.x).toBeLessThanOrEqual(viewportSize.width + 2);
    expect(box.y).toBeLessThanOrEqual(viewportSize.height + 2);
  }

  const fitZoom = await readCanvasViewportScale(page);
  expect(fitZoom).toBeGreaterThan(0);
  expect(fitZoom).toBeLessThan(0.4);
});

test('fit view includes empty user groups alongside nodes', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.4
      }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [createManualNoteNode('nearby-note', { x: 160, y: 140 })];
  state.groups = [
    {
      id: 'group-empty-distant',
      title: 'Later Investigation',
      position: { x: 4200, y: 2600 },
      size: { width: 820, height: 520 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 4);

  await page.locator('.react-flow__controls-fitview').click();

  await expect
    .poll(async () => {
      const groupBox = await page.locator('[data-group-id="group-empty-distant"]').boundingBox();
      return groupBox && groupBox.x < page.viewportSize().width ? groupBox : null;
    })
    .not.toBeNull();

  const viewportSize = page.viewportSize();
  expect(viewportSize).not.toBeNull();
  const nodeBox = await nodeById(page, 'nearby-note').boundingBox();
  const groupBox = await page.locator('[data-group-id="group-empty-distant"]').boundingBox();
  expect(nodeBox).not.toBeNull();
  expect(groupBox).not.toBeNull();
  for (const box of [nodeBox, groupBox]) {
    expect(box.x + box.width).toBeGreaterThanOrEqual(-2);
    expect(box.y + box.height).toBeGreaterThanOrEqual(-2);
    expect(box.x).toBeLessThanOrEqual(viewportSize.width + 2);
    expect(box.y).toBeLessThanOrEqual(viewportSize.height + 2);
  }
});

test('fit view keeps a workspace root section visible when it is larger than its nodes', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.8
      }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('root-note-small', { x: 360, y: 340 }),
      groupId: 'workspace-root-large'
    }
  ];
  state.groups = [
    {
      id: 'workspace-root-large',
      title: 'Large Root',
      position: { x: 80, y: 80 },
      size: { width: 5200, height: 3200 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/large'
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 4);

  await page.locator('.react-flow__controls-fitview').click();

  await expect.poll(async () => readCanvasViewportScale(page)).toBeLessThan(0.4);
  const viewportSize = page.viewportSize();
  expect(viewportSize).not.toBeNull();

  const rootBox = await page.locator('[data-group-id="workspace-root-large"]').boundingBox();
  const nodeBox = await nodeById(page, 'root-note-small').boundingBox();
  expect(rootBox).not.toBeNull();
  expect(nodeBox).not.toBeNull();
  expect(rootBox.x).toBeGreaterThanOrEqual(-2);
  expect(rootBox.y).toBeGreaterThanOrEqual(-2);
  expect(rootBox.x + rootBox.width).toBeLessThanOrEqual(viewportSize.width + 2);
  expect(rootBox.y + rootBox.height).toBeLessThanOrEqual(viewportSize.height + 2);
  expect(rootBox.width).toBeGreaterThan(nodeBox.width * 2);
  expect(rootBox.height).toBeGreaterThan(nodeBox.height * 2);
});

test('overview mode none keeps regular node rendering when fit view zooms below the overview threshold', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.4
      }
    }
  });
  const state = createDistantOverviewState();
  await bootstrap(page, state, createRuntimeContext({ overviewMode: 'none' }));
  await settleWebview(page, 4);

  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-mode', 'false');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-config', 'none');

  await page.locator('.react-flow__controls-fitview').click();

  await expect.poll(async () => readCanvasViewportScale(page)).toBeLessThan(0.2);
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-mode', 'false');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-config', 'none');
  await expect
    .poll(async () => readComputedOpacity(page, '[data-node-id="note-1"] .note-editor-surface'))
    .toBe('1');
  await expect(nodeById(page, 'note-1').locator('.node-overview-title')).toContainText('回看 smoke test');
  await expect
    .poll(async () => readComputedOpacity(page, '[data-node-id="note-1"] .node-overview-title'))
    .toBe('0');
});

test('overview zoom threshold runtime config controls title overview activation', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.4
      }
    }
  });
  const state = createCanvasScreenshotState();
  await bootstrap(page, state, createRuntimeContext({ overviewZoomThreshold: 0.5 }));
  await settleWebview(page, 4);

  await expect.poll(async () => readCanvasViewportScale(page)).toBeCloseTo(0.4, 2);
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-mode', 'true');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-config', 'title');
  await expect
    .poll(async () => readComputedOpacity(page, '[data-node-id="note-1"] .note-editor-surface'))
    .toBe('0');

  await updateHostState(page, state, createRuntimeContext({ overviewZoomThreshold: 0.2 }));

  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-mode', 'false');
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-config', 'title');
  await expect
    .poll(async () => readComputedOpacity(page, '[data-node-id="note-1"] .note-editor-surface'))
    .toBe('1');
});

test('overview mode keeps hidden node controls out of the keyboard focus path', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 0.4
      }
    }
  });
  await bootstrap(page, createCanvasScreenshotState(), createRuntimeContext({ overviewZoomThreshold: 0.5 }));
  await settleWebview(page, 4);

  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-canvas-overview-mode', 'true');
  await clearPostedMessages(page);

  const hiddenFocusSnapshots = [];
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press('Tab');
    const snapshot = await readActiveElementOverviewFocusSnapshot(page);
    if (snapshot?.hiddenNodeControl) {
      hiddenFocusSnapshots.push(snapshot);
    }
  }

  expect(hiddenFocusSnapshots).toEqual([]);
  await page.keyboard.press('Enter');
  await settleWebview(page, 2);

  const deleteMessages = await page.evaluate(() =>
    window.__devSessionCanvasHarness
      .getPostedMessages()
      .filter((entry) => entry.type === 'webview/deleteNode')
  );
  expect(deleteMessages).toEqual([]);
});

test('host center node request recenters without selecting or acknowledging attention', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedNodeId: 'agent-1',
      viewport: {
        x: -20,
        y: -20,
        zoom: 1
      }
    }
  });
  const state = createCanvasScreenshotState();
  state.nodes.find((node) => node.id === 'terminal-1').metadata.terminal.attentionPending = true;
  await bootstrap(page, state);
  await settleWebview(page, 4);
  await performTestDomAction(page, {
    kind: 'selectNode',
    nodeId: 'note-1'
  });
  await expect.poll(async () => (await readPersistedUiState(page)).selectedNodeId ?? null).toBe('note-1');

  const beforeTransform = await readCanvasViewportTransform(page);
  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/centerNode',
      payload: {
        nodeId: 'terminal-1'
      }
    });
  });

  await expect
    .poll(async () => {
      const transform = await readCanvasViewportTransform(page);
      return transform && transform !== beforeTransform ? transform : null;
    })
    .not.toBeNull();
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).toBe('note-1');

  const terminalProbe = await readProbeNode(page, 'terminal-1', 20);
  expect(terminalProbe.selected).toBe(false);
  expect(terminalProbe.attentionIndicatorVisible).toBe(true);

  const viewportSize = page.viewportSize();
  const terminalBox = await nodeById(page, 'terminal-1').boundingBox();
  expect(viewportSize).not.toBeNull();
  expect(terminalBox).not.toBeNull();
  expect(Math.abs(terminalBox.x + terminalBox.width / 2 - viewportSize.width / 2)).toBeLessThanOrEqual(18);
  expect(Math.abs(terminalBox.y + terminalBox.height / 2 - viewportSize.height / 2)).toBeLessThanOrEqual(18);
});

test('host focus group request animates to a workspace root section', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-06-09T00:00:00.000Z',
    nodes: [],
    edges: [],
    groups: [
      {
        id: 'workspace-root-tools',
        title: 'tools',
        position: { x: 2400, y: 720 },
        size: { width: 720, height: 520 },
        role: 'workspace-root',
        workspaceRootPath: '/workspace/tools'
      }
    ],
    nextGroupSequence: 1,
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  });
  await settleWebview(page, 4);

  const beforeTransform = await readCanvasViewportTransform(page);
  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/focusGroup',
      payload: {
        groupId: 'workspace-root-tools'
      }
    });
  });

  await expect
    .poll(async () => {
      const transform = await readCanvasViewportTransform(page);
      return transform && transform !== beforeTransform ? transform : null;
    })
    .not.toBeNull();
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedGroupId).toBe('workspace-root-tools');
  expect(afterState.selectedGroupIds).toEqual(['workspace-root-tools']);
  await expect
    .poll(async () => {
      const centerMessages = await readPostedMessagesByType(page, 'webview/updateViewportCenter');
      const latestCenter = centerMessages.at(-1)?.payload.visibleCenter;
      return latestCenter ? `${latestCenter.x},${latestCenter.y}` : null;
    })
    .not.toBeNull();
  const centerMessages = await readPostedMessagesByType(page, 'webview/updateViewportCenter');
  const latestCenter = centerMessages.at(-1).payload.visibleCenter;
  expect(Math.abs(latestCenter.x - (2400 + 720 / 2))).toBeLessThanOrEqual(18);
  expect(Math.abs(latestCenter.y - (720 + 520 / 2))).toBeLessThanOrEqual(18);

  const viewportSize = page.viewportSize();
  const rootBox = await page.locator('[data-group-id="workspace-root-tools"]').boundingBox();
  expect(viewportSize).not.toBeNull();
  expect(rootBox).not.toBeNull();
  expect(Math.abs(rootBox.x + rootBox.width / 2 - viewportSize.width / 2)).toBeLessThanOrEqual(18);
  expect(Math.abs(rootBox.y + rootBox.height / 2 - viewportSize.height / 2)).toBeLessThanOrEqual(18);
});

test('host focus group request survives a same-generation frame refresh', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-06-09T00:00:00.000Z',
    nodes: [],
    edges: [],
    groups: [
      {
        id: 'workspace-root-refresh',
        title: 'refresh',
        position: { x: 2400, y: 720 },
        size: { width: 720, height: 520 },
        role: 'workspace-root',
        workspaceRootPath: '/workspace/refresh'
      }
    ],
    nextGroupSequence: 1,
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  });
  await settleWebview(page, 4);

  const beforeTransform = await readCanvasViewportTransform(page);
  await page.evaluate(() => {
    const lifecycle = window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__;
    window.__devSessionCanvasHarness.dispatchRawHostMessage({
      type: 'host/focusGroup',
      lifecycle: {
        ...lifecycle,
        frameId: 'frame-before-refresh'
      },
      payload: {
        groupId: 'workspace-root-refresh'
      }
    });
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/focusGroup',
      payload: {
        groupId: 'workspace-root-refresh'
      }
    });
  });

  await expect
    .poll(async () => {
      const transform = await readCanvasViewportTransform(page);
      return transform && transform !== beforeTransform ? transform : null;
    })
    .not.toBeNull();
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedGroupId).toBe('workspace-root-refresh');
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

test('ordinary note empty placeholder and editor show the 8000 character limit', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '';
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-markdown-preview-placeholder')).toContainText(
    `最多 ${NOTE_EMBEDDED_CONTENT_MAX_LENGTH.toLocaleString()} 字符`
  );

  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveAttribute('maxlength', String(NOTE_EMBEDDED_CONTENT_MAX_LENGTH));

  const overLimitContent = 'a'.repeat(NOTE_EMBEDDED_CONTENT_MAX_LENGTH + 5);
  await bodyInput.fill(overLimitContent);
  await expect(bodyInput).toHaveValue('a'.repeat(NOTE_EMBEDDED_CONTENT_MAX_LENGTH));
  await expect(noteNode.locator('.note-limit-hint')).toContainText(
    `已达 ${NOTE_EMBEDDED_CONTENT_MAX_LENGTH.toLocaleString()} 字符上限`
  );
});

test('note body requires double click to switch from markdown preview to plain text editing', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = '# 迭代复盘\n- 补齐 Markdown 预览\n- 保持纯文本编辑';
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview h1')).toHaveText('迭代复盘');
  await expect(noteNode.locator('.note-markdown-preview li')).toHaveText([
    '补齐 Markdown 预览',
    '保持纯文本编辑'
  ]);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveAttribute('data-probe-value', markdownBody);

  await noteNode.locator('.note-markdown-preview').click();
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);

  await noteNode.locator('.note-markdown-preview').dblclick();

  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(markdownBody);

  await bodyInput.fill('## 已完成\n- 主路径切换');
  await bodyInput.blur();

  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview h2')).toHaveText('已完成');
  await expect(noteNode.locator('.note-markdown-preview li')).toHaveText(['主路径切换']);
});


test('double-clicking note preview starts editing at the clicked text position', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = [
    '# 迭代复盘',
    '',
    '第一段保持阅读态。',
    '目标段落用于验证双击光标定位。',
    '',
    '- 补齐 Markdown 预览',
    '- 保持纯文本编辑'
  ].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const targetText = '验证双击光标定位';
  await doubleClickNotePreviewText(page, {
    nodeId: 'note-1',
    text: targetText,
    offset: 2
  });

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(markdownBody);
  await expectCaretPosition(bodyInput, markdownBody.indexOf(targetText) + 2);
});

test('double-clicking note preview image falls back to the image markdown source end', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = [
    '# 图片定位',
    '',
    '![架构图](https://cdn.example.com/arch.png)',
    '',
    '后续正文不应该成为光标落点。'
  ].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  await doubleClickNotePreviewSelector(page, {
    nodeId: 'note-1',
    selector: 'img.note-markdown-image'
  });

  const imageMarkdown = '![架构图](https://cdn.example.com/arch.png)';
  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(markdownBody);
  await expectCaretPosition(bodyInput, markdownBody.indexOf(imageMarkdown) + imageMarkdown.length);
});

test('double-clicking note preview blank space falls back to the paragraph markdown source end', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# 空白定位', '', '短句。', '', '后续正文不应该成为光标落点。'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const paragraph = nodeById(page, 'note-1').locator('.note-markdown-preview p').first();
  await expect(paragraph).toHaveText('短句。');
  const paragraphBox = await paragraph.boundingBox();
  expect(paragraphBox).not.toBeNull();
  if (!paragraphBox) {
    return;
  }

  await page.mouse.dblclick(paragraphBox.x + paragraphBox.width - 4, paragraphBox.y + paragraphBox.height / 2);

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(markdownBody);
  await expectCaretPosition(bodyInput, markdownBody.indexOf('短句。') + '短句。'.length);
});

test('double-clicking note preview display math falls back to the math markdown source end', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = [
    '# 公式定位',
    '',
    '$$',
    'x^2 + y^2 = z^2',
    '$$',
    '',
    '后续正文不应该成为光标落点。'
  ].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  await doubleClickNotePreviewSelector(page, {
    nodeId: 'note-1',
    selector: '.note-markdown-math-display .katex'
  });

  const mathMarkdown = ['$$', 'x^2 + y^2 = z^2', '$$'].join('\n');
  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(markdownBody);
  await expectCaretPosition(bodyInput, markdownBody.indexOf(mathMarkdown) + mathMarkdown.length);
});

test('double-clicking multiple display math blocks falls back to each math markdown source end', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const firstMathMarkdown = ['$$', 'a=1', '$$'].join('\n');
  const secondMathMarkdown = ['$$', 'b=2', '$$'].join('\n');
  const markdownBody = ['# math', '', firstMathMarkdown, '', 'middle', '', secondMathMarkdown, '', 'tail'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await doubleClickNotePreviewSelector(page, {
    nodeId: 'note-1',
    selector: '.note-markdown-math-display:nth-of-type(1) .katex'
  });
  await expect(bodyInput).toHaveValue(markdownBody);
  await expectCaretPosition(bodyInput, markdownBody.indexOf(firstMathMarkdown) + firstMathMarkdown.length);

  await bodyInput.blur();
  await expect(nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await doubleClickNotePreviewSelector(page, {
    nodeId: 'note-1',
    selector: '.note-markdown-math-display:nth-of-type(2) .katex'
  });
  await expect(bodyInput).toHaveValue(markdownBody);
  await expectCaretPosition(bodyInput, markdownBody.indexOf(secondMathMarkdown) + secondMathMarkdown.length);
});

test('double-clicking multiline fenced code maps to the clicked source line', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = [
    '# 代码定位',
    '',
    '```ts',
    'const a = 1;',
    'const b = 2;',
    '```',
    '',
    '后续正文不应该成为光标落点。'
  ].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const targetText = 'b =';
  await doubleClickNotePreviewText(page, {
    nodeId: 'note-1',
    text: targetText,
    offset: 1
  });

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(markdownBody);
  await expectCaretPosition(bodyInput, markdownBody.indexOf(targetText) + 1);
});

test('double-clicking markdown-like fenced code maps raw code characters', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# 代码定位', '', '```txt', '- item', 'foo_bar', '```'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  const cases = [
    { text: '- item', offset: 0 },
    { text: 'bar', offset: 0 }
  ];

  for (const entry of cases) {
    await doubleClickNotePreviewText(page, {
      nodeId: 'note-1',
      text: entry.text,
      offset: entry.offset
    });
    await expectCaretPosition(bodyInput, markdownBody.indexOf(entry.text) + entry.offset);
    await bodyInput.blur();
    await expect(nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  }
});

test('double-clicking indented code maps raw code after source indentation', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# 缩进代码定位', '', '    - item', '    foo_bar'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  const cases = [
    { text: '- item', offset: 0 },
    { text: 'bar', offset: 0 }
  ];

  for (const entry of cases) {
    await doubleClickNotePreviewText(page, {
      nodeId: 'note-1',
      text: entry.text,
      offset: entry.offset
    });
    await expectCaretPosition(bodyInput, markdownBody.indexOf(entry.text) + entry.offset);
    await bodyInput.blur();
    await expect(nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  }
});

test('double-clicking markdown punctuation and entities maps visible text characters', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# 段落定位', '', 'foo_bar baz', '2 * 3 result', 'A &amp; B after'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  const cases = [
    { text: 'bar', offset: 0, sourceText: 'bar' },
    { text: '3 result', offset: 0, sourceText: '3 result' },
    { text: 'B after', offset: 0, sourceText: 'B after' }
  ];

  for (const entry of cases) {
    await doubleClickNotePreviewText(page, {
      nodeId: 'note-1',
      text: entry.text,
      offset: entry.offset
    });
    await expectCaretPosition(bodyInput, markdownBody.indexOf(entry.sourceText) + entry.offset);
    await bodyInput.blur();
    await expect(nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  }
});

test('double-clicking note task text ignores the rendered checkbox spacing', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = '- [x] second task';
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const targetText = 'second';
  await doubleClickNotePreviewText(page, {
    nodeId: 'note-1',
    text: targetText,
    offset: 0
  });

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expectCaretPosition(bodyInput, markdownBody.indexOf(targetText));
});

test('double-clicking list continuation text maps after continuation indentation', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# list', '', '- first line', '  second line'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const targetText = 'second line';
  await doubleClickNotePreviewText(page, {
    nodeId: 'note-1',
    text: targetText,
    offset: 5
  });

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expectCaretPosition(bodyInput, markdownBody.indexOf(targetText) + 5);
});

test('double-clicking ordered list continuation text maps after continuation indentation', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# list', '', '1. first line', '   second line'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const targetText = 'second line';
  await doubleClickNotePreviewText(page, {
    nodeId: 'note-1',
    text: targetText,
    offset: 5
  });

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expectCaretPosition(bodyInput, markdownBody.indexOf(targetText) + 5);
});

test('double-clicking blockquote list continuation text maps after nested quote indentation', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# list', '', '> > - first line', '> >   second line'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const targetText = 'second line';
  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  for (const offset of [0, 5]) {
    await doubleClickNotePreviewText(page, {
      nodeId: 'note-1',
      text: targetText,
      offset
    });
    await expectCaretPosition(bodyInput, markdownBody.indexOf(targetText) + offset);
    await bodyInput.blur();
    await expect(nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  }
});

test('double-clicking triple emphasis maps after all delimiters', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# em', '', '***bold*** after', '___firm___ later'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  const cases = [
    { text: 'bold', offset: 0, sourceStart: markdownBody.indexOf('bold') },
    { text: 'bold', offset: 2, sourceStart: markdownBody.indexOf('bold') },
    { text: 'firm', offset: 0, sourceStart: markdownBody.indexOf('firm') }
  ];

  for (const entry of cases) {
    await doubleClickNotePreviewText(page, {
      nodeId: 'note-1',
      text: entry.text,
      offset: entry.offset
    });
    await expectCaretPosition(bodyInput, entry.sourceStart + entry.offset);
    await bodyInput.blur();
    await expect(nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  }
});

test('double-clicking malformed display math falls back to the math markdown source end', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['# math', '', '$$', '\\bad{', '$$', '', 'tail'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  await doubleClickNotePreviewSelector(page, {
    nodeId: 'note-1',
    selector: '.note-markdown-math-display .katex-error'
  });

  const mathMarkdown = ['$$', '\\bad{', '$$'].join('\n');
  const bodyInput = nodeById(page, 'note-1').locator('textarea[data-probe-field="body"]');
  await expectCaretPosition(bodyInput, markdownBody.indexOf(mathMarkdown) + mathMarkdown.length);
});

test('note body editing target fills the note frame without an inset editor box', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# Note\n- [ ] 你好\n- [ ] 天气';
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  const noteBox = await noteNode.boundingBox();
  const chromeBox = await noteNode.locator('.window-chrome').boundingBox();
  const surfaceBox = await noteNode.locator('.note-editor-surface').boundingBox();
  const preview = noteNode.locator('.note-markdown-preview');
  const previewBox = await preview.boundingBox();
  expect(noteBox).not.toBeNull();
  expect(chromeBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  if (!noteBox || !chromeBox || !surfaceBox || !previewBox) {
    throw new Error('Expected note frame, chrome, surface, and preview boxes.');
  }

  const bodyFrameBox = {
    x: noteBox.x + 1,
    y: chromeBox.y + chromeBox.height,
    width: noteBox.width - 2,
    height: noteBox.y + noteBox.height - 1 - (chromeBox.y + chromeBox.height)
  };
  expectBoxEdgesClose(surfaceBox, bodyFrameBox, 2);
  expectBoxEdgesClose(previewBox, surfaceBox, 1);
  await preview.focus();
  expect(await preview.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');

  await preview.dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveCount(1);
  const editorBox = await bodyInput.boundingBox();
  expect(editorBox).not.toBeNull();
  if (!editorBox) {
    throw new Error('Expected note textarea to have a bounding box.');
  }

  expectBoxEdgesClose(editorBox, surfaceBox, 1);
  expect(await bodyInput.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
});

test('double-clicking a scrolled note preview preserves the edit viewport around the target text', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const lines = Array.from({ length: 80 }, (_value, index) => `段落 ${index + 1} 用于撑开预览滚动。`);
  const targetLineIndex = 65;
  lines[targetLineIndex] = 'scroll-target-alpha keeps editor viewport away from top.';
  const markdownBody = lines.join('\n\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  const preview = noteNode.locator('.note-markdown-preview');
  await preview.evaluate((element, targetText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let targetElement = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text && node.data.includes(targetText)) {
        targetElement = node.parentElement;
        break;
      }
    }
    if (!targetElement) {
      throw new Error(`未找到预览文本 ${targetText}。`);
    }
    const previewRect = element.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    element.scrollTop += targetRect.top - previewRect.top - 48;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, 'scroll-target-alpha');

  const previewScrollTop = await preview.evaluate((element) => element.scrollTop);
  expect(previewScrollTop).toBeGreaterThan(0);
  await settleWebview(page, 2);

  await doubleClickNotePreviewText(page, {
    nodeId: 'note-1',
    text: 'away from top',
    offset: 0
  });

  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  const targetLineStart = markdownBody.indexOf('scroll-target-alpha');
  const targetLineEnd = targetLineStart + lines[targetLineIndex].length;
  await expect(bodyInput).toHaveCount(1);
  const selection = await bodyInput.evaluate((element) => ({
    selectionStart: element.selectionStart,
    selectionEnd: element.selectionEnd
  }));
  expect(selection.selectionStart).toBeGreaterThanOrEqual(targetLineStart);
  expect(selection.selectionEnd).toBeLessThanOrEqual(targetLineEnd);
  await expect
    .poll(async () => bodyInput.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
});

test('returning from note body edit mode restores the preview scroll position', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const lines = Array.from({ length: 85 }, (_value, index) => `正文 ${index + 1} 用于验证编辑返回预览滚动。`);
  lines[70] = 'return-target-alpha should stay inside the restored preview viewport.';
  const markdownBody = lines.join('\n\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();

  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await bodyInput.evaluate((element, targetText) => {
    const targetOffset = element.value.indexOf(targetText);
    if (targetOffset < 0) {
      throw new Error(`未找到编辑文本 ${targetText}。`);
    }
    const targetLineIndex = element.value.slice(0, targetOffset).split('\n').length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    element.scrollTop = targetLineIndex * lineHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, 'return-target-alpha');
  const editScrollTop = await bodyInput.evaluate((element) => element.scrollTop);
  expect(editScrollTop).toBeGreaterThan(0);
  await settleWebview(page, 2);

  await bodyInput.blur();
  const preview = noteNode.locator('.note-markdown-preview');
  await expect(preview).toHaveCount(1);
  await expect
    .poll(async () => preview.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
});

test('note body editor supports tab indentation and line numbers', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const markdownBody = ['alpha', 'beta', 'gamma'].join('\n');
  state.nodes[0].metadata.note.content = markdownBody;
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-document-line-number')).toHaveCount(0);
  await noteNode.locator('.note-markdown-preview').dblclick();

  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(markdownBody);
  await expect(noteNode.locator('.note-document-line-number')).toHaveText(['1', '2', '3']);
  await settleWebview(page, 2);

  await bodyInput.evaluate((element) => {
    element.focus();
    element.setSelectionRange(0, 0);
  });
  await expectSelectionRange(bodyInput, 0, 0);
  await page.keyboard.press('Tab');
  await settleWebview(page, 2);
  await expect(bodyInput).toHaveValue(`  ${markdownBody}`);

  await page.keyboard.press('Shift+Tab');
  await settleWebview(page, 2);
  await expect(bodyInput).toHaveValue(markdownBody);

  await bodyInput.evaluate((element) => {
    element.focus();
    element.setSelectionRange(0, element.value.length);
  });
  await expectSelectionRange(bodyInput, 0, markdownBody.length);
  await page.keyboard.press('Tab');
  await settleWebview(page, 2);
  await expect(bodyInput).toHaveValue(['  alpha', '  beta', '  gamma'].join('\n'));

  await page.keyboard.press('Shift+Tab');
  await settleWebview(page, 2);
  await expect(bodyInput).toHaveValue(markdownBody);
  await expect(bodyInput).toBeFocused();
});

test('note body editor reserves blank gutter rows for soft-wrapped lines', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const lines = Array.from({ length: 25 }, (_value, index) => `line ${index + 1}`);
  lines[17] = '18 的点点滴滴发的发发发发发发发发发发发发发发发发发发发发发发发发发发';
  lines[23] = '24 的点点滴滴发的发发发发发发发发发发发发发发发发发发发发发发发发发发';
  state.nodes[0].metadata.note.content = lines.join('\n');
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();

  await expect
    .poll(async () =>
      noteNode.locator('.note-document-editor').evaluate((editor) => {
        const rows = Array.from(editor.querySelectorAll('.note-document-line-number')).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim() ?? '',
            top: rect.top
          };
        });
        const firstRow = editor.querySelector('.note-document-line-number');
        const lineHeight = firstRow ? Number.parseFloat(getComputedStyle(firstRow).lineHeight) : 0;
        const visibleNumbers = rows.map((row) => row.text).filter(Boolean);
        const index18 = rows.findIndex((row) => row.text === '18');
        const index19 = rows.findIndex((row) => row.text === '19');
        const index24 = rows.findIndex((row) => row.text === '24');
        const index25 = rows.findIndex((row) => row.text === '25');

        const hasExpectedNumbers =
          visibleNumbers.join(',') === Array.from({ length: 25 }, (_value, index) => String(index + 1)).join(',');
        const hasContinuationAfter18 =
          index18 >= 0 && index19 > index18 + 1 && rows.slice(index18 + 1, index19).every((row) => row.text === '');
        const hasContinuationAfter24 =
          index24 >= 0 && index25 > index24 + 1 && rows.slice(index24 + 1, index25).every((row) => row.text === '');
        const line18VisualRows =
          index18 >= 0 && index19 >= 0 && Number.isFinite(lineHeight) && lineHeight > 0
            ? Math.round((rows[index19].top - rows[index18].top) / lineHeight)
            : 0;
        const line24VisualRows =
          index24 >= 0 && index25 >= 0 && Number.isFinite(lineHeight) && lineHeight > 0
            ? Math.round((rows[index25].top - rows[index24].top) / lineHeight)
            : 0;

        return (
          hasExpectedNumbers &&
          hasContinuationAfter18 &&
          hasContinuationAfter24 &&
          line18VisualRows > 1 &&
          line24VisualRows > 1
        );
      })
    )
    .toBe(true);

  const wrappedLineRows = await noteNode.locator('.note-document-editor').evaluate((editor) => {
    const rows = Array.from(editor.querySelectorAll('.note-document-line-number')).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim() ?? '',
        top: rect.top
      };
    });
    const firstRow = editor.querySelector('.note-document-line-number');
    const lineHeight = firstRow ? Number.parseFloat(getComputedStyle(firstRow).lineHeight) : 0;
    const index18 = rows.findIndex((row) => row.text === '18');
    const index19 = rows.findIndex((row) => row.text === '19');
    const index24 = rows.findIndex((row) => row.text === '24');
    const index25 = rows.findIndex((row) => row.text === '25');

    return {
      line18: Math.round((rows[index19].top - rows[index18].top) / lineHeight),
      line24: Math.round((rows[index25].top - rows[index24].top) / lineHeight)
    };
  });
  expect(wrappedLineRows.line18).toBeGreaterThan(1);
  expect(wrappedLineRows.line24).toBeGreaterThan(1);
});

test('note markdown preview text remains selectable in read mode', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = 'copyable preview text stays selectable without entering edit mode.';
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  const previewParagraph = noteNode.locator('.note-markdown-preview-copy p').first();
  const previewBox = await previewParagraph.boundingBox();
  expect(previewBox).not.toBeNull();
  if (!previewBox) {
    throw new Error('Expected note preview paragraph to have a bounding box.');
  }

  const anchorX = previewBox.x + 12;
  const focusX = previewBox.x + Math.min(previewBox.width - 12, 220);
  const selectionY = previewBox.y + Math.min(previewBox.height / 2, 14);
  await page.mouse.move(anchorX, selectionY);
  await page.mouse.down();
  await page.mouse.move(focusX, selectionY, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .not.toBe('');
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
});

test('note preview and editor scope select-all locally while copy and edit shortcuts still reach the host', async ({
  page
}) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = 'shortcut bridge should keep bubbling to the host.';
  await bootstrap(page, state);

  await page.evaluate(() => {
    window.__noteShortcutEvents = [];
    window.addEventListener('keydown', (event) => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      window.__noteShortcutEvents.push({
        key: event.key.toLowerCase(),
        editing: Boolean(document.querySelector('textarea[data-probe-field="body"]'))
      });
    });
  });

  const noteNode = nodeById(page, 'note-1');
  const preview = noteNode.locator('.note-markdown-preview');
  await preview.focus();
  await page.keyboard.press(`${PRIMARY_ACCELERATOR_KEY}+KeyA`);
  await expect
    .poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('shortcut bridge should keep bubbling to the host.');
  await page.keyboard.press(`${PRIMARY_ACCELERATOR_KEY}+KeyC`);
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);

  await preview.dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveCount(1);
  await bodyInput.focus();
  await page.keyboard.press(`${PRIMARY_ACCELERATOR_KEY}+KeyA`);
  await expect
    .poll(async () =>
      bodyInput.evaluate((element) => ({
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd,
        valueLength: element.value.length
      }))
    )
    .toEqual({
      selectionStart: 0,
      selectionEnd: 'shortcut bridge should keep bubbling to the host.'.length,
      valueLength: 'shortcut bridge should keep bubbling to the host.'.length
    });
  await page.keyboard.press(`${PRIMARY_ACCELERATOR_KEY}+KeyC`);
  await page.keyboard.press(`${PRIMARY_ACCELERATOR_KEY}+KeyX`);
  await page.keyboard.press(`${PRIMARY_ACCELERATOR_KEY}+KeyV`);

  const shortcutEvents = await page.evaluate(() => window.__noteShortcutEvents);
  expect(
    shortcutEvents.filter((event) => event.editing === false).map((event) => event.key)
  ).toEqual(expect.arrayContaining(['c']));
  expect(shortcutEvents.some((event) => event.editing === false && event.key === 'a')).toBe(false);
  expect(
    shortcutEvents.filter((event) => event.editing === true).map((event) => event.key)
  ).toEqual(expect.arrayContaining(['c', 'x', 'v']));
  expect(shortcutEvents.some((event) => event.editing === true && event.key === 'a')).toBe(false);
});

test('note markdown preview renders task lists, syntax highlighting, and math formulas', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = [
    '- [x] 已收口预览切换',
    '- [ ] 补齐宿主链接打开',
    '',
    '```ts',
    'const total: number = 2;',
    '```',
    '',
    '内联公式 $a^2 + b^2 = c^2$',
    '',
    '$$',
    'x^2 + y^2 = z^2',
    '$$'
  ].join('\n');
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  const taskCheckboxes = noteNode.locator('.note-markdown-preview .task-list-item-checkbox');
  await expect(taskCheckboxes).toHaveCount(2);
  await expect(taskCheckboxes.nth(0)).toBeChecked();
  await expect(taskCheckboxes.nth(0)).toBeEnabled();
  await expect(taskCheckboxes.nth(1)).not.toBeChecked();
  await expect(taskCheckboxes.nth(1)).toBeEnabled();
  await expect(noteNode.locator('.note-markdown-preview pre code.hljs')).toHaveCount(1);
  await expect(noteNode.locator('.note-markdown-preview pre code.hljs .hljs-keyword')).toContainText('const');
  await expect(noteNode.locator('.note-markdown-preview .katex')).toHaveCount(2);
  await expect(noteNode.locator('.note-markdown-preview .katex-display')).toHaveCount(1);
});

test('note markdown preview renders safe images and rewrites local image paths', async ({ page }) => {
  await openHarness(page);
  const dataImage = 'data:image/png;base64,iVBORw0KGgo=';
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = [
    `![Inline pixel](${dataImage})`,
    '',
    '![Remote chart](https://cdn.example.com/charts/roadmap.png)',
    '',
    '![Diagram](assets/diagram.png)',
    '',
    '![Unsupported](mailto:team@example.com)'
  ].join('\n');
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/design.md',
    displayPath: 'docs/design.md',
    fullDisplayPath: '/workspace/docs/design.md',
    contentRevision: 'image-revision',
    status: 'ok',
    webviewResourceBaseUri: 'https://webview.example/workspace/docs/'
  };
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  const preview = noteNode.locator('.note-markdown-preview');
  const images = preview.locator('img.note-markdown-image');
  await expect(images).toHaveCount(3);
  await expect(images.nth(0)).toHaveAttribute('alt', 'Inline pixel');
  await expect(images.nth(0)).toHaveAttribute('src', dataImage);
  await expect(images.nth(1)).toHaveAttribute('alt', 'Remote chart');
  await expect(images.nth(1)).toHaveAttribute(
    'src',
    'https://cdn.example.com/charts/roadmap.png'
  );
  await expect(images.nth(2)).toHaveAttribute('alt', 'Diagram');
  await expect(images.nth(2)).toHaveAttribute(
    'src',
    'https://webview.example/workspace/docs/assets/diagram.png'
  );
  await expect(preview.locator('.note-markdown-image-fallback')).toContainText('Unsupported');
  await expect(preview.locator('img[src^="mailto:"]')).toHaveCount(0);
  const embeddedState = createNoteNodeState();
  embeddedState.nodes[0].metadata.note.content = '![Workspace diagram](workspace-a/assets/root.png)';
  await bootstrap(
    page,
    embeddedState,
    createRuntimeContext({
      noteMarkdownImageWorkspaceRoots: [
        { name: 'workspace-a', webviewResourceBaseUri: 'https://webview.example/workspace-a/' },
        { name: 'workspace-b', webviewResourceBaseUri: 'https://webview.example/workspace-b/' }
      ]
    })
  );
  const embeddedPreview = nodeById(page, 'note-1').locator('.note-markdown-preview');
  await expect(embeddedPreview.locator('img.note-markdown-image')).toHaveAttribute(
    'src',
    'https://webview.example/workspace-a/assets/root.png'
  );
});

test('note markdown preview hides YAML metadata and exposes a titlebar popover', async ({ page }) => {
  await openHarness(page);
  const frontMatterBlock = [
    '---',
    'title: Note 与 Markdown 文件关联',
    'decision_status: 已选定',
    'domains:',
    '  - VSCode 集成域',
    '  - 画布交互域',
    'updated_at: 2026-05-15',
    '---',
    ''
  ].join('\n');
  const markdownBody = `${frontMatterBlock}# Note 与 Markdown 文件关联\n\n- [ ] 补齐 metadata popover`;
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = markdownBody;
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/design.md',
    displayPath: 'docs/design.md',
    fullDisplayPath: '/workspace/docs/design.md',
    contentRevision: 'metadata-revision',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-markdown-preview h1')).toHaveText('Note 与 Markdown 文件关联');
  await expect(noteNode.locator('.note-markdown-preview')).not.toContainText('decision_status');
  await expect(noteNode.locator('.note-markdown-preview hr')).toHaveCount(0);

  const metadataButton = noteNode.getByRole('button', { name: '查看 Markdown metadata' });
  await expect(metadataButton).toBeVisible();
  await metadataButton.click();

  const popover = page.getByRole('dialog', { name: 'Metadata' });
  await expect(popover).toBeVisible();
  await expect(metadataButton).not.toContainText('metadata');
  await expect(popover.locator('.note-metadata-popover-header strong')).toHaveText('Metadata');
  await expect(popover.locator('.note-metadata-popover-footer')).toHaveCount(0);
  await expect(popover).toContainText('title');
  await expect(popover).toContainText('Note 与 Markdown 文件关联');
  await expect(popover).toContainText('domains');
  await expect(popover).toContainText('VSCode 集成域 +1');
  await expect
    .poll(async () =>
      popover.locator('.note-metadata-popover-value').first().evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap
        };
      })
    )
    .toEqual({
      whiteSpace: 'normal',
      overflowWrap: 'anywhere'
    });

  const copyMetadataButton = popover.getByRole('button', { name: '复制 Metadata' });
  await expect(copyMetadataButton.locator('.codicon.codicon-copy')).toHaveCount(1);
  await copyMetadataButton.click();
  const copyMessage = await waitForPostedMessageByType(page, 'webview/copyTextToClipboard');
  expect(copyMessage).toEqual({
    type: 'webview/copyTextToClipboard',
    payload: {
      text: frontMatterBlock,
      source: 'note-markdown-metadata',
      nodeId: 'note-1'
    }
  });
});

test('note checklist updates keep original line numbers when YAML metadata is hidden', async ({ page }) => {
  await openHarness(page);
  const frontMatterBlock = [
    '---',
    'title: Checklist metadata',
    'tags:',
    '  - smoke',
    '---',
    ''
  ].join('\n');
  const initialBody = ['# Tasks', '- [ ] 补齐 metadata 行号', '- [x] 保留正文'].join('\n');
  const expectedBody = ['# Tasks', '- [x] 补齐 metadata 行号', '- [x] 保留正文'].join('\n');
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = `${frontMatterBlock}${initialBody}`;
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const taskCheckboxes = noteNode.locator('.note-markdown-preview .task-list-item-checkbox');
  await expect(taskCheckboxes).toHaveCount(2);
  await taskCheckboxes.nth(0).click();

  const message = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(message).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: `${frontMatterBlock}${expectedBody}`
    }
  });
});

test('note markdown math escapes malformed html and command links', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content =
    '恶意公式 $<a href="command:workbench.action.closeActiveEditor">run command</a>%$';
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-markdown-preview .katex')).toHaveCount(1);
  await expect(noteNode.locator('.note-markdown-preview a')).toHaveCount(0);
  await expect
    .poll(async () =>
      noteNode.locator('.note-markdown-preview').evaluate((element) => element.innerHTML)
    )
    .not.toContain('<a href="command:workbench.action.closeActiveEditor">');
});

test('clicking a note checklist checkbox updates markdown without entering edit mode', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = ['- [ ] 补齐 smoke', '- [x] 收口设计'].join('\n');
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const taskCheckboxes = noteNode.locator('.note-markdown-preview .task-list-item-checkbox');
  await taskCheckboxes.nth(0).click();

  const message = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(message).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: ['- [x] 补齐 smoke', '- [x] 收口设计'].join('\n')
    }
  });
  await expect(taskCheckboxes.nth(0)).toBeChecked();
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveAttribute(
    'data-probe-value',
    ['- [x] 补齐 smoke', '- [x] 收口设计'].join('\n')
  );
});

test('clicking a quoted note checklist checkbox updates markdown without entering edit mode', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = ['> 引用段落', '> - [ ] quoted task', '> - [x] done task'].join('\n');
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const taskCheckboxes = noteNode.locator('.note-markdown-preview .task-list-item-checkbox');
  await expect(taskCheckboxes).toHaveCount(2);
  await taskCheckboxes.nth(0).click();

  const message = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(message).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: ['> 引用段落', '> - [x] quoted task', '> - [x] done task'].join('\n')
    }
  });
  await expect(taskCheckboxes.nth(0)).toBeChecked();
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveAttribute(
    'data-probe-value',
    ['> 引用段落', '> - [x] quoted task', '> - [x] done task'].join('\n')
  );
});

test('clicking a note markdown link posts openNoteLink without entering edit mode', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '[打开文档](https://example.com/docs)';
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview a').click();

  const message = await waitForPostedMessageByType(page, 'webview/openNoteLink');
  expect(message).toEqual({
    type: 'webview/openNoteLink',
    payload: {
      nodeId: 'note-1',
      href: 'https://example.com/docs'
    }
  });
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview a')).toHaveText('打开文档');
});

test('clicking a note workspace file link posts openNoteLink with the raw relative href', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '[打开配置](package.json#L3C1)';
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview a').click();

  const message = await waitForPostedMessageByType(page, 'webview/openNoteLink');
  expect(message).toEqual({
    type: 'webview/openNoteLink',
    payload: {
      nodeId: 'note-1',
      href: 'package.json#L3C1'
    }
  });
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
});

test('associated markdown notes render the file path subtitle and open-file action', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const longDisplayPath =
    'ssh:dev_labs · ~/projects/MiniCPM-V-CookBook-main.worktrees/test-branch/docs/design.md';
  state.nodes[0].metadata.note.content = '# 文件笔记';
  state.nodes[0].size = { width: 280, height: state.nodes[0].size.height };
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/design.md',
    displayPath: longDisplayPath,
    fullDisplayPath: longDisplayPath,
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const subtitle = noteNode.locator('.window-title-subtitle');
  await expect(subtitle).toHaveText(longDisplayPath);
  await expect(subtitle).toHaveAttribute('title', longDisplayPath);
  await expect(noteNode.locator('.note-markdown-preview h1')).toHaveText('文件笔记');
  await expect(noteNode.getByRole('button', { name: '保存为 Markdown' })).toHaveCount(0);

  const copyPathButton = noteNode.getByRole('button', { name: '复制 Markdown 路径' });
  await expect(copyPathButton.locator('.codicon.codicon-copy')).toHaveCount(1);
  await copyPathButton.click();
  const copyMessage = await waitForPostedMessageByType(page, 'webview/copyTextToClipboard');
  expect(copyMessage).toEqual({
    type: 'webview/copyTextToClipboard',
    payload: {
      text: longDisplayPath,
      source: 'note-markdown-subtitle',
      nodeId: 'note-1'
    }
  });
  await expect(noteNode.getByRole('button', { name: '已复制 Markdown 路径' })).toBeVisible();
  await clearPostedMessages(page);

  await noteNode.getByRole('button', { name: '打开文件' }).click();
  const message = await waitForPostedMessageByType(page, 'webview/openAssociatedNoteMarkdownFile');
  expect(message).toEqual({
    type: 'webview/openAssociatedNoteMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });
});

test('associated markdown note editor does not apply the ordinary note 8000 character limit', async ({ page }) => {
  await openHarness(page);
  const longMarkdownContent = `# 文件笔记\n\n${'long markdown body\n'.repeat(510)}`;
  expect(longMarkdownContent.length).toBeGreaterThan(NOTE_EMBEDDED_CONTENT_MAX_LENGTH);

  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = longMarkdownContent;
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/large.md',
    displayPath: 'docs/large.md',
    fullDisplayPath: '/workspace/docs/large.md',
    contentRevision: 'large-revision',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-markdown-preview')).toHaveAttribute('data-probe-value', longMarkdownContent);

  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).not.toHaveAttribute('maxlength', String(NOTE_EMBEDDED_CONTENT_MAX_LENGTH));
  await expect(bodyInput).toHaveValue(longMarkdownContent);

  const updatedLongMarkdownContent = `${longMarkdownContent}\n追加内容`;
  await bodyInput.fill(updatedLongMarkdownContent);
  await bodyInput.blur();

  const message = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(message).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: updatedLongMarkdownContent,
      baseContentRevision: 'large-revision'
    }
  });
});

test('associated markdown note editing blocks stale drafts after an external file refresh', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue('# 文件笔记\n\n原始内容');

  const localDraft = '# 文件笔记\n\n本地草稿';
  await bodyInput.fill(localDraft);

  const refreshedState = createNoteNodeState();
  refreshedState.nodes[0].metadata.note.content = '# 文件笔记\n\n外部更新';
  refreshedState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-b',
    status: 'ok'
  };
  await updateHostState(page, refreshedState);

  await expect(bodyInput).toHaveValue(localDraft);
  await expect(bodyInput).not.toHaveAttribute('readonly', '');
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText(
    '关联文件已在外部更新'
  );
  const continuedDraft = `${localDraft}\n\n继续编辑`;
  await bodyInput.fill(continuedDraft);
  await expect(bodyInput).toHaveValue(continuedDraft);

  await bodyInput.blur();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((message) => message.type === 'webview/updateNoteNode').length
      )
    )
    .toBe(0);

  await noteNode.getByRole('button', { name: '覆盖文件' }).click();
  const message = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(message).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: continuedDraft,
      baseContentRevision: 'revision-a',
      force: true
    }
  });
});

test('associated markdown note warns when an edited draft sees a file revision change', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/revision-only.md',
    displayPath: 'docs/revision-only.md',
    fullDisplayPath: '/workspace/docs/revision-only.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  const localDraft = '# 文件笔记\n\n本地草稿';
  await bodyInput.fill(localDraft);
  await waitForPostedMessageByType(page, 'webview/updateAssociatedNoteMarkdownDraft');
  await clearPostedMessages(page);

  const revisionOnlyState = createNoteNodeState();
  revisionOnlyState.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  revisionOnlyState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/revision-only.md',
    displayPath: 'docs/revision-only.md',
    fullDisplayPath: '/workspace/docs/revision-only.md',
    contentRevision: 'revision-b',
    status: 'ok'
  };
  await updateHostState(page, revisionOnlyState);

  await expect(bodyInput).toHaveValue(localDraft);
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText('关联文件已在外部更新');
  await clearPostedMessages(page);

  await bodyInput.blur();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((message) => message.type === 'webview/updateNoteNode').length
      )
    )
    .toBe(0);

  await noteNode.getByRole('button', { name: '覆盖文件' }).click();
  const message = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(message).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: localDraft,
      baseContentRevision: 'revision-a',
      force: true
    }
  });
});

test('associated markdown conflict actions respond while the editor keeps focus', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/focused-conflict.md',
    displayPath: 'docs/focused-conflict.md',
    fullDisplayPath: '/workspace/docs/focused-conflict.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  const localDraft = '# 文件笔记\n\n本地草稿';
  await bodyInput.fill(localDraft);
  await waitForPostedMessageByType(page, 'webview/updateAssociatedNoteMarkdownDraft');
  await clearPostedMessages(page);
  const preservedSelectionStart = 4;
  await bodyInput.evaluate((textarea, selectionStart) => {
    textarea.setSelectionRange(selectionStart, selectionStart);
  }, preservedSelectionStart);

  const conflictState = createNoteNodeState();
  conflictState.nodes[0].metadata.note.content = '# 文件笔记\n\n外部更新';
  conflictState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/focused-conflict.md',
    displayPath: 'docs/focused-conflict.md',
    fullDisplayPath: '/workspace/docs/focused-conflict.md',
    contentRevision: 'revision-b',
    status: 'dirty-conflict',
    lastError: '关联文件在编辑期间被外部修改。请重新加载或覆盖。',
    recoverableDraft: {
      draftId: '33333333-3333-4333-8333-333333333333',
      content: localDraft,
      baseContentRevision: 'revision-a',
      remoteContentRevision: 'revision-b',
      updatedAt: '2026-05-13T00:00:00.000Z'
    }
  };
  await updateHostState(page, conflictState);

  await expect(bodyInput).toBeFocused();
  await expect
    .poll(async () =>
      bodyInput.evaluate((textarea) => ({
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd
      }))
    )
    .toEqual({
      selectionStart: preservedSelectionStart,
      selectionEnd: preservedSelectionStart
  });
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText('关联文件已在外部更新');

  await noteNode.getByRole('button', { name: '复制草稿' }).click();
  const copyMessage = await waitForPostedMessageByType(page, 'webview/copyAssociatedNoteMarkdownDraft');
  expect(copyMessage).toEqual({
    type: 'webview/copyAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: 'note-1',
      content: localDraft
    }
  });
  await expect(bodyInput).toBeFocused();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((message) => message.type === 'webview/copyAssociatedNoteMarkdownDraft').length
      )
    )
    .toBe(1);
  await clearPostedMessages(page);

  await noteNode.getByRole('button', { name: '覆盖文件' }).click();
  const overwriteMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(overwriteMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: localDraft,
      baseContentRevision: 'revision-a',
      force: true
    }
  });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((message) => message.type === 'webview/updateNoteNode').length
      )
    )
    .toBe(1);
  await expect(noteNode.locator('.note-edit-conflict-hint')).toHaveCount(0);
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveAttribute('data-probe-value', localDraft);
});

test('associated markdown reload resolves the edit conflict on first click', async ({ page }) => {
  await openHarness(page);
  const remoteContent = '# 文件笔记\n\n外部更新';
  const localDraft = '# 文件笔记\n\n本地草稿';
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = remoteContent;
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/reload-conflict.md',
    displayPath: 'docs/reload-conflict.md',
    fullDisplayPath: '/workspace/docs/reload-conflict.md',
    contentRevision: 'revision-b',
    status: 'dirty-conflict',
    lastError: '关联文件在编辑期间被外部修改。请重新加载或覆盖。',
    recoverableDraft: {
      draftId: '44444444-4444-4444-8444-444444444444',
      content: localDraft,
      baseContentRevision: 'revision-a',
      remoteContentRevision: 'revision-b',
      updatedAt: '2026-05-13T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveValue(localDraft);
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText('关联文件已在外部更新');

  await noteNode.getByRole('button', { name: '重新加载' }).click();
  const reloadMessage = await waitForPostedMessageByType(page, 'webview/reloadAssociatedNoteMarkdownFile');
  expect(reloadMessage).toEqual({
    type: 'webview/reloadAssociatedNoteMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .filter((message) => message.type === 'webview/reloadAssociatedNoteMarkdownFile').length
      )
    )
    .toBe(1);
  await expect(noteNode.locator('.note-edit-conflict-hint')).toHaveCount(0);
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveAttribute('data-probe-value', remoteContent);
});

test('associated markdown note accepts a file revision change before the draft is edited', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/revision-before-draft.md',
    displayPath: 'docs/revision-before-draft.md',
    fullDisplayPath: '/workspace/docs/revision-before-draft.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');

  const revisionOnlyState = createNoteNodeState();
  revisionOnlyState.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  revisionOnlyState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/revision-before-draft.md',
    displayPath: 'docs/revision-before-draft.md',
    fullDisplayPath: '/workspace/docs/revision-before-draft.md',
    contentRevision: 'revision-b',
    status: 'ok'
  };
  await updateHostState(page, revisionOnlyState);
  await expect(noteNode.locator('.note-edit-conflict-hint')).toHaveCount(0);

  const localDraft = '# 文件笔记\n\n本地草稿';
  await bodyInput.fill(localDraft);
  await bodyInput.blur();
  const message = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(message).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: localDraft,
      baseContentRevision: 'revision-b'
    }
  });
});

test('associated markdown note persists an edit draft with its base revision', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/draft.md',
    displayPath: 'docs/draft.md',
    fullDisplayPath: '/workspace/docs/draft.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  const localDraft = '# 文件笔记\n\n本地草稿';
  await bodyInput.fill(localDraft);

  const draftMessage = await waitForPostedMessageByType(page, 'webview/updateAssociatedNoteMarkdownDraft');
  expect(draftMessage).toEqual({
    type: 'webview/updateAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: 'note-1',
      content: localDraft,
      baseContentRevision: 'revision-a'
    }
  });
});

test('associated markdown note clears a reverted edit draft before accepting file refresh', async ({ page }) => {
  await openHarness(page);
  const originalContent = '# 文件笔记\n\n原始内容';
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = originalContent;
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/reverted-draft.md',
    displayPath: 'docs/reverted-draft.md',
    fullDisplayPath: '/workspace/docs/reverted-draft.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  const localDraft = '# 文件笔记\n\n本地草稿';
  await bodyInput.fill(localDraft);

  const draftMessage = await waitForPostedMessageByType(page, 'webview/updateAssociatedNoteMarkdownDraft');
  expect(draftMessage).toEqual({
    type: 'webview/updateAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: 'note-1',
      content: localDraft,
      baseContentRevision: 'revision-a'
    }
  });
  await clearPostedMessages(page);

  await bodyInput.fill(originalContent);
  const clearMessage = await waitForPostedMessageByType(page, 'webview/clearAssociatedNoteMarkdownDraft');
  expect(clearMessage).toEqual({
    type: 'webview/clearAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: 'note-1'
    }
  });
  await clearPostedMessages(page);

  const refreshedState = createNoteNodeState();
  refreshedState.nodes[0].metadata.note.content = '# 文件笔记\n\n外部更新';
  refreshedState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/reverted-draft.md',
    displayPath: 'docs/reverted-draft.md',
    fullDisplayPath: '/workspace/docs/reverted-draft.md',
    contentRevision: 'revision-b',
    status: 'ok'
  };
  await updateHostState(page, refreshedState);

  await expect(noteNode.locator('.note-edit-conflict-hint')).toHaveCount(0);
  await expect(bodyInput).toHaveValue('# 文件笔记\n\n外部更新');
});

test('associated markdown note keeps a rejected stale draft after host dirty-conflict', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n原始内容';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.note-markdown-preview').dblclick();
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  const localDraft = '# 文件笔记\n\n本地草稿';
  await bodyInput.fill(localDraft);
  await bodyInput.blur();

  const staleMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(staleMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: localDraft,
      baseContentRevision: 'revision-a'
    }
  });
  await clearPostedMessages(page);

  const conflictState = createNoteNodeState();
  conflictState.nodes[0].metadata.note.content = '# 文件笔记\n\n外部更新';
  conflictState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-b',
    status: 'dirty-conflict',
    lastError: '关联文件在编辑期间被外部修改。请重新加载或覆盖。',
    recoverableDraft: {
      draftId: '11111111-1111-4111-8111-111111111111',
      baseContentRevision: 'revision-a',
      remoteContentRevision: 'revision-b',
      updatedAt: '2026-05-13T00:00:00.000Z'
    }
  };
  await updateHostState(page, conflictState);

  await expect(bodyInput).toHaveValue(localDraft);
  await expect(bodyInput).not.toHaveAttribute('readonly', '');
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText(
    '关联文件已在外部更新'
  );
  await expect(noteNode.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '覆盖文件' })).toBeVisible();

  await noteNode.getByRole('button', { name: '重新加载' }).click();
  const reloadMessage = await waitForPostedMessageByType(page, 'webview/reloadAssociatedNoteMarkdownFile');
  expect(reloadMessage).toEqual({
    type: 'webview/reloadAssociatedNoteMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });

  const recoveredState = createNoteNodeState();
  recoveredState.nodes[0].metadata.note.content = '# 文件笔记\n\n外部更新';
  recoveredState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-b',
    status: 'ok'
  };
  await updateHostState(page, recoveredState);
  await expect(noteNode.locator('.note-markdown-preview')).toContainText('外部更新');
});

test('associated markdown note restores a persisted dirty-conflict draft after bootstrap', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n外部更新';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-b',
    status: 'dirty-conflict',
    lastError: '关联文件在编辑期间被外部修改。请重新加载或覆盖。',
    recoverableDraft: {
      draftId: '22222222-2222-4222-8222-222222222222',
      content: '# 文件笔记\n\n本地草稿',
      baseContentRevision: 'revision-a',
      remoteContentRevision: 'revision-b',
      updatedAt: '2026-05-13T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue('# 文件笔记\n\n本地草稿');
  await expect(bodyInput).not.toHaveAttribute('readonly', '');
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText(
    '关联文件已在外部更新'
  );
  await expect(noteNode.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '复制草稿' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '覆盖文件' })).toBeVisible();

  await noteNode.getByRole('button', { name: '复制草稿' }).click();
  const copyMessage = await waitForPostedMessageByType(page, 'webview/copyAssociatedNoteMarkdownDraft');
  expect(copyMessage).toEqual({
    type: 'webview/copyAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: 'note-1',
      content: '# 文件笔记\n\n本地草稿'
    }
  });
  await expect(noteNode.getByRole('button', { name: '已复制' })).toBeVisible();

  await noteNode.getByRole('button', { name: '覆盖文件' }).click();
  const overwriteMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(overwriteMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: '# 文件笔记\n\n本地草稿',
      baseContentRevision: 'revision-a',
      force: true
    }
  });
});

test('associated markdown note overwrites dirty-conflict when draft matches remote content', async ({ page }) => {
  await openHarness(page);
  const remoteContent = '# 文件笔记\n\n外部更新';
  const draftContent = '# 文件笔记\n\n本地草稿';
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = remoteContent;
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-b',
    status: 'dirty-conflict',
    lastError: '关联文件在编辑期间被外部修改。请重新加载或覆盖。',
    recoverableDraft: {
      draftId: '77777777-7777-4777-8777-777777777777',
      content: draftContent,
      baseContentRevision: 'revision-a',
      remoteContentRevision: 'revision-b',
      updatedAt: '2026-05-24T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(draftContent);

  await bodyInput.fill(remoteContent);
  await noteNode.getByRole('button', { name: '覆盖文件' }).click();

  const overwriteMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(overwriteMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: remoteContent,
      baseContentRevision: 'revision-a',
      force: true
    }
  });
});

test('associated markdown note restores a persisted ok recoverable draft after bootstrap', async ({ page }) => {
  await openHarness(page);
  const diskContent = '# 文件笔记\n\n磁盘内容';
  const draftContent = '# 文件笔记\n\n本地草稿';
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = diskContent;
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/draft.md',
    displayPath: 'docs/draft.md',
    fullDisplayPath: '/workspace/docs/draft.md',
    contentRevision: 'revision-a',
    status: 'ok',
    recoverableDraft: {
      draftId: '66666666-6666-4666-8666-666666666666',
      content: draftContent,
      baseContentRevision: 'revision-a',
      updatedAt: '2026-05-24T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(draftContent);
  await expect(bodyInput).not.toHaveAttribute('readonly', '');
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText(
    '发现未提交的本地草稿'
  );
  await expect(noteNode.locator('.note-edit-conflict-hint')).not.toContainText(
    '关联文件已在外部更新'
  );
  await expect(noteNode.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '复制草稿' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '覆盖文件' })).toBeVisible();

  await noteNode.getByRole('button', { name: '复制草稿' }).click();
  const copyMessage = await waitForPostedMessageByType(page, 'webview/copyAssociatedNoteMarkdownDraft');
  expect(copyMessage).toEqual({
    type: 'webview/copyAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: 'note-1',
      content: draftContent
    }
  });
  await expect(noteNode.getByRole('button', { name: '已复制' })).toBeVisible();
  await clearPostedMessages(page);

  await noteNode.getByRole('button', { name: '覆盖文件' }).click();
  const overwriteMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(overwriteMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: draftContent,
      baseContentRevision: 'revision-a',
      force: true
    }
  });
});

test('associated markdown note bootstrapped with ok recoverable draft shows reload recovery only', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n- [ ] 磁盘任务';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/draft.md',
    displayPath: 'docs/draft.md',
    fullDisplayPath: '/workspace/docs/draft.md',
    contentRevision: 'revision-a',
    status: 'ok',
    recoverableDraft: {
      draftId: '77777777-7777-4777-8777-777777777777',
      baseContentRevision: 'revision-a',
      updatedAt: '2026-05-24T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('发现未提交的本地草稿');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('草稿正文暂不可读取');
  await expect(noteNode.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '复制草稿' })).toHaveCount(0);
  await expect(noteNode.getByRole('button', { name: '覆盖文件' })).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveCount(0);
  await expect(noteNode.locator('input.task-list-item-checkbox')).toHaveCount(0);

  await noteNode.getByRole('button', { name: '重新加载' }).click();
  const reloadMessage = await waitForPostedMessageByType(page, 'webview/reloadAssociatedNoteMarkdownFile');
  expect(reloadMessage).toEqual({
    type: 'webview/reloadAssociatedNoteMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });
  await clearPostedMessages(page);

  const recoveredState = createNoteNodeState();
  recoveredState.nodes[0].metadata.note.content = '# 文件笔记\n\n- [ ] 磁盘任务';
  recoveredState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/draft.md',
    displayPath: 'docs/draft.md',
    fullDisplayPath: '/workspace/docs/draft.md',
    contentRevision: 'revision-a',
    status: 'ok'
  };
  await updateHostState(page, recoveredState);

  await expect(noteNode.locator('.note-markdown-preview')).toContainText('磁盘任务');
  await noteNode.locator('input.task-list-item-checkbox').click();
  const updateMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(updateMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: '# 文件笔记\n\n- [x] 磁盘任务',
      baseContentRevision: 'revision-a'
    }
  });
});

test('associated markdown note restores a persisted missing recoverable draft after bootstrap', async ({ page }) => {
  await openHarness(page);
  const cachedContent = '# 文件笔记\n\n旧磁盘内容';
  const draftContent = '# 文件笔记\n\n文件缺失时仍可恢复的草稿';
  const missingDisplayPath = '/workspace/docs/missing-draft.md';
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = cachedContent;
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/missing-draft.md',
    displayPath: missingDisplayPath,
    fullDisplayPath: missingDisplayPath,
    contentRevision: 'revision-a',
    status: 'missing',
    lastError: '关联文件不可用：docs/missing-draft.md',
    recoverableDraft: {
      draftId: '99999999-9999-4999-8999-999999999999',
      content: draftContent,
      baseContentRevision: 'revision-a',
      updatedAt: '2026-05-24T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  const bodyInput = noteNode.locator('textarea[data-probe-field="body"]');
  await expect(bodyInput).toHaveValue(draftContent);
  await expect(bodyInput).not.toHaveAttribute('readonly', '');
  await expect(noteNode.locator('.note-edit-conflict-hint')).toContainText('关联文件缺失');
  await expect(noteNode.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '复制草稿' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '覆盖文件' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '创建空文件并关联' })).toHaveCount(0);

  await noteNode.getByRole('button', { name: '复制草稿' }).click();
  const copyMessage = await waitForPostedMessageByType(page, 'webview/copyAssociatedNoteMarkdownDraft');
  expect(copyMessage).toEqual({
    type: 'webview/copyAssociatedNoteMarkdownDraft',
    payload: {
      nodeId: 'note-1',
      content: draftContent
    }
  });
  await clearPostedMessages(page);

  await noteNode.getByRole('button', { name: '覆盖文件' }).click();
  const overwriteMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(overwriteMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: draftContent,
      baseContentRevision: 'revision-a',
      force: true
    }
  });
});

test('associated markdown note bootstrapped with unreadable recoverable draft shows reload recovery only', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n- [ ] 旧缓存任务';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/unreadable-draft.md',
    displayPath: 'docs/unreadable-draft.md',
    fullDisplayPath: '/workspace/docs/unreadable-draft.md',
    contentRevision: 'revision-a',
    status: 'unreadable',
    lastError: '关联文件当前不可读：docs/unreadable-draft.md',
    recoverableDraft: {
      draftId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      baseContentRevision: 'revision-a',
      updatedAt: '2026-05-24T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('发现未提交的本地草稿');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('关联文件当前不可读');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('草稿正文暂不可读取');
  await expect(noteNode.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '复制草稿' })).toHaveCount(0);
  await expect(noteNode.getByRole('button', { name: '覆盖文件' })).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveCount(0);
  await expect(noteNode.locator('input.task-list-item-checkbox')).toHaveCount(0);

  await noteNode.getByRole('button', { name: '重新加载' }).click();
  const reloadMessage = await waitForPostedMessageByType(page, 'webview/reloadAssociatedNoteMarkdownFile');
  expect(reloadMessage).toEqual({
    type: 'webview/reloadAssociatedNoteMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });
});

test('associated markdown note bootstrapped with dirty-conflict shows reload recovery only', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '# 文件笔记\n\n- [ ] 外部任务';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-b',
    status: 'dirty-conflict',
    lastError: '关联文件在编辑期间被外部修改。请重新加载或覆盖。',
    recoverableDraft: {
      draftId: '11111111-1111-4111-8111-111111111111',
      baseContentRevision: 'revision-a',
      remoteContentRevision: 'revision-b',
      updatedAt: '2026-05-13T00:00:00.000Z'
    }
  };
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('关联文件存在编辑冲突');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('关联文件在编辑期间被外部修改');
  await expect(noteNode.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(noteNode.getByRole('button', { name: '覆盖文件' })).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview')).toHaveCount(0);
  await expect(noteNode.locator('input.task-list-item-checkbox')).toHaveCount(0);

  await noteNode.getByRole('button', { name: '重新加载' }).click();
  const reloadMessage = await waitForPostedMessageByType(page, 'webview/reloadAssociatedNoteMarkdownFile');
  expect(reloadMessage).toEqual({
    type: 'webview/reloadAssociatedNoteMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });
  await clearPostedMessages(page);

  const recoveredState = createNoteNodeState();
  recoveredState.nodes[0].metadata.note.content = '# 文件笔记\n\n- [ ] 外部任务';
  recoveredState.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/conflict.md',
    displayPath: 'docs/conflict.md',
    fullDisplayPath: '/workspace/docs/conflict.md',
    contentRevision: 'revision-b',
    status: 'ok'
  };
  await updateHostState(page, recoveredState);

  await expect(noteNode.locator('.note-markdown-preview')).toContainText('外部任务');
  await noteNode.locator('input.task-list-item-checkbox').click();
  const updateMessage = await waitForPostedMessageByType(page, 'webview/updateNoteNode');
  expect(updateMessage).toEqual({
    type: 'webview/updateNoteNode',
    payload: {
      nodeId: 'note-1',
      content: '# 文件笔记\n\n- [x] 外部任务',
      baseContentRevision: 'revision-b'
    }
  });
});

test('missing associated markdown notes show a warning instead of stale markdown content', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  const missingDisplayPath = '/workspace/docs/missing.md';
  state.nodes[0].metadata.note.content = '# 旧内容';
  state.nodes[0].metadata.note.contentSource = {
    kind: 'markdown-file',
    resourceUri: 'file:///workspace/docs/missing.md',
    displayPath: missingDisplayPath,
    fullDisplayPath: missingDisplayPath,
    status: 'missing',
    lastError: '关联文件不可用：docs/missing.md'
  };
  await bootstrap(page, state);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('关联文件缺失');
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText('关联文件不可用');
  await expect(noteNode.locator('.window-title-subtitle')).toHaveText(missingDisplayPath);
  await expect(noteNode.locator('.note-file-conflict-card')).toContainText(missingDisplayPath);
  await expect(noteNode.locator('.note-markdown-preview h1')).toHaveCount(0);
  await expect(noteNode.locator('textarea[data-probe-field="body"]')).toHaveCount(0);
  await expect(noteNode.getByRole('button', { name: '打开文件' })).toHaveCount(0);
  await expect(noteNode.locator('.note-file-conflict-card .note-edit-conflict-action')).toHaveText(
    '创建空文件并关联'
  );

  await noteNode.getByRole('button', { name: '创建空文件并关联' }).click();
  const createMessage = await waitForPostedMessageByType(page, 'webview/createMissingAssociatedNoteMarkdownFile');
  expect(createMessage).toEqual({
    type: 'webview/createMissingAssociatedNoteMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });
});

test('ordinary note save-as-markdown action posts saveNoteAsMarkdownFile', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState());
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.getByRole('button', { name: '保存为 Markdown' }).click();

  const message = await waitForPostedMessageByType(page, 'webview/saveNoteAsMarkdownFile');
  expect(message).toEqual({
    type: 'webview/saveNoteAsMarkdownFile',
    payload: {
      nodeId: 'note-1'
    }
  });
});

test('dropping markdown files on the empty canvas posts markdown note resources', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState());
  await clearPostedMessages(page);

  const dropResult = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (!pane) {
      throw new Error('React Flow pane not found.');
    }

    const attachDataTransfer = (event, dataTransfer) => {
      Object.defineProperty(event, 'dataTransfer', {
        configurable: true,
        value: dataTransfer
      });
      return event;
    };
    let exposeDropPayload = false;
    const dataTransfer = {
      dropEffect: 'copy',
      effectAllowed: 'all',
      files: [],
      items: [],
      types: ['ResourceURLs'],
      getData: (type) =>
        exposeDropPayload && type === 'ResourceURLs'
          ? JSON.stringify(['file:///workspace/docs/one.md', 'file:///workspace/docs/two.markdown'])
          : '',
      setData: () => {},
      clearData: () => {},
      setDragImage: () => {}
    };
    const dragOverEvent = attachDataTransfer(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: 320,
        clientY: 260
      }),
      dataTransfer
    );
    const dropEvent = attachDataTransfer(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 320,
        clientY: 260
      }),
      dataTransfer
    );

    pane.dispatchEvent(dragOverEvent);
    exposeDropPayload = true;
    pane.dispatchEvent(dropEvent);

    return {
      dragOverDefaultPrevented: dragOverEvent.defaultPrevented,
      dropDefaultPrevented: dropEvent.defaultPrevented
    };
  });

  expect(dropResult).toEqual({
    dragOverDefaultPrevented: true,
    dropDefaultPrevented: true
  });

  const message = await waitForPostedMessageByType(page, 'webview/dropNoteMarkdownFiles');
  expect(message.payload.resources).toEqual([
    {
      source: 'resourceUrls',
      valueKind: 'uri',
      value: 'file:///workspace/docs/one.md'
    },
    {
      source: 'resourceUrls',
      valueKind: 'uri',
      value: 'file:///workspace/docs/two.markdown'
    }
  ]);
  expect(Number.isFinite(message.payload.position.x)).toBe(true);
  expect(Number.isFinite(message.payload.position.y)).toBe(true);
});

test('note markdown unsafe command links do not render clickable hrefs', async ({ page }) => {
  await openHarness(page);
  const state = createNoteNodeState();
  state.nodes[0].metadata.note.content = '[run](command:workbench.action.closeActiveEditor)';
  await bootstrap(page, state);
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.note-markdown-preview')).toContainText('run');
  await expect(noteNode.locator('.note-markdown-preview a[href^="command:"]')).toHaveCount(0);
  await expect(noteNode.locator('.note-markdown-preview a[data-note-markdown-link="true"]')).toHaveCount(0);
});

test('selected node resize affordance keeps type-colored edge highlight', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState());

  const noteNode = nodeById(page, 'note-1');
  await expect(noteNode.locator('.canvas-node-resize-line')).toHaveCount(0);

  await noteNode.locator('.window-chrome').click();

  await expect(noteNode.locator('.canvas-node-resize-line')).toHaveCount(4);
  await expect(noteNode.locator('[data-node-resize-direction]')).toHaveCount(8);

  const resizeChrome = await noteNode.evaluate((node) => {
    const topLine = node.querySelector('.canvas-node-resize-line-top');
    const rightLine = node.querySelector('.canvas-node-resize-line-right');
    const cornerHandle = node.querySelector('[data-node-resize-direction="bottom-right"]');
    if (
      !(topLine instanceof HTMLElement) ||
      !(rightLine instanceof HTMLElement) ||
      !(cornerHandle instanceof HTMLElement)
    ) {
      return null;
    }

    const topLineStyle = window.getComputedStyle(topLine);
    const rightLineStyle = window.getComputedStyle(rightLine);
    const cornerHandleStyle = window.getComputedStyle(cornerHandle, '::after');

    return {
      topBorderColor: topLineStyle.borderTopColor,
      topBorderWidth: topLineStyle.borderTopWidth,
      rightBorderColor: rightLineStyle.borderRightColor,
      rightBorderWidth: rightLineStyle.borderRightWidth,
      handleBackground: cornerHandleStyle.backgroundColor
    };
  });

  expect(resizeChrome).toEqual({
    topBorderColor: 'rgb(167, 139, 250)',
    topBorderWidth: '2px',
    rightBorderColor: 'rgb(167, 139, 250)',
    rightBorderWidth: '2px',
    handleBackground: 'rgb(167, 139, 250)'
  });
});

test('dragging a resize handle posts resizeNode and updates the note frame size', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  await bootstrap(page, createNoteNodeState());
  await clearPostedMessages(page);

  const noteNode = nodeById(page, 'note-1');
  await noteNode.locator('.window-chrome').click();
  await clearPostedMessages(page);

  const beforeBox = await noteNode.boundingBox();
  expect(beforeBox).not.toBeNull();

  const handle = noteNode.locator('[data-node-resize-direction="bottom-right"]');
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
  await page.evaluate(({ state, runtime }) => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/stateUpdated',
      payload: {
        state,
        runtime
      }
    });
  }, { state: nextState, runtime: createRuntimeContext() });

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

  const handle = noteNode.locator('[data-node-resize-direction="top-left"]');
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
  await page.evaluate(({ state, runtime }) => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/stateUpdated',
      payload: {
        state,
        runtime
      }
    });
  }, { state: nextState, runtime: createRuntimeContext() });

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
  await expect(menu.locator('.canvas-context-menu-header-copy')).toContainText('画布操作');
  await expect(menu.locator('.canvas-context-menu-header-copy')).not.toContainText('先创建节点');
  await expect(menu.locator('[data-context-menu-kind="terminal"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-kind="note"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="codex"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="claude"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="codex"] .codicon-chevron-right')).toBeVisible();
  await expect(
    menu.locator('[data-context-menu-provider="codex"] [data-context-menu-provider-action="create-default"]')
  ).toContainText('Codex（默认）');
  await expect(menu.locator('[data-context-menu-action="arrange-canvas-layout"]')).toContainText('整理画布布局');
  await expect(menu.locator('[data-context-menu-action="arrange-canvas-layout"] .codicon-type-hierarchy-sub')).toBeVisible();
  await expect
    .poll(async () =>
      menu
        .locator('.canvas-context-menu-items > *')
        .evaluateAll((elements) =>
          elements.map(
            (element) =>
              element.getAttribute('data-context-menu-kind') ??
              element.getAttribute('data-context-menu-provider') ??
              element.getAttribute('data-context-menu-action') ??
              element.getAttribute('data-context-menu-template-group')
          ).filter(Boolean)
        )
    )
    .toEqual(['note', 'terminal', 'codex', 'claude', 'create-empty-group', 'arrange-canvas-layout', 'apply', 'reset', 'save-canvas-template']);

  await menu.locator('[data-context-menu-kind="note"]').click();

  await expect(menu).toBeHidden();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'note',
    preferredPosition: {
      x: 910,
      y: 360
    }
  });
});

test('canvas context menu can request layout arrangement without a completion toast', async ({ page }) => {
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

  await page.locator('.react-flow__pane').click({
    button: 'right',
    position: {
      x: 920,
      y: 500
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu.locator('[data-context-menu-action="arrange-canvas-layout"]')).toBeVisible();
  await menu.locator('[data-context-menu-action="arrange-canvas-layout"]').click();

  await expect(menu).toBeHidden();
  await expect(page.locator('[data-toast-kind="success"]')).toHaveCount(0);
  await expect
    .poll(async () => readPostedMessagesByType(page, 'webview/arrangeCanvasLayout'))
    .toContainEqual({
      type: 'webview/arrangeCanvasLayout'
    });
});

test('right-click create menu still shows execution entries in untrusted mode and asks host for reason', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(page, createCanvasScreenshotState(), createRuntimeContext({ workspaceTrusted: false }));
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
  await expect(menu.locator('[data-context-menu-kind="terminal"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="codex"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="claude"]')).toBeVisible();

  await menu.locator('[data-context-menu-kind="terminal"]').click();

  await expect
    .poll(async () => readPostedMessagesByType(page, 'webview/showCreateNodeBlockedReason'))
    .toContainEqual({
      type: 'webview/showCreateNodeBlockedReason',
      payload: {
        kind: 'terminal'
      }
    });

  await expect
    .poll(async () => {
      return page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .some((entry) => entry.type === 'webview/createDemoNode')
      );
    })
    .toBe(false);
});

test('manually created nodes recenter without zooming when they already fully fit in view', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  const initialState = createNoteNodeState();
  await bootstrap(page, initialState);
  await clearPostedMessages(page);

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 850,
      y: 500
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu.locator('[data-context-menu-kind="note"]').click();

  const createPayload = await waitForCreateDemoNodePayload(page);
  expect(createPayload).toMatchObject({
    kind: 'note',
    preferredPosition: {
      x: 660,
      y: 300
    }
  });

  const nextState = createNoteNodeState();
  nextState.nodes.push(createManualNoteNode('note-2', createPayload.preferredPosition));
  await updateHostState(page, nextState);
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).toBe('note-2');
  expect(afterState.viewport.zoom).toBeCloseTo(1, 5);

  const viewportSize = page.viewportSize();
  const noteBox = await nodeById(page, 'note-2').boundingBox();
  expect(viewportSize).not.toBeNull();
  expect(noteBox).not.toBeNull();
  expect(noteBox.x).toBeGreaterThanOrEqual(-2);
  expect(noteBox.y).toBeGreaterThanOrEqual(-2);
  expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(viewportSize.width + 2);
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(viewportSize.height + 2);
  expect(Math.abs(noteBox.x + noteBox.width / 2 - viewportSize.width / 2)).toBeLessThanOrEqual(18);
  expect(Math.abs(noteBox.y + noteBox.height / 2 - viewportSize.height / 2)).toBeLessThanOrEqual(18);
});

test('manually created nodes can zoom to fit before recentering when the node overflows the viewport', async ({ page }) => {
  await page.setViewportSize({
    width: 960,
    height: 540
  });
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1.8
      }
    }
  });
  const initialState = createEmptyCanvasState();
  await bootstrap(page, initialState);
  await clearPostedMessages(page);

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 700,
      y: 420
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu.locator('[data-context-menu-kind="terminal"]').click();

  const createPayload = await waitForCreateDemoNodePayload(page);
  expect(createPayload).toMatchObject({
    kind: 'terminal',
    preferredPosition: {
      x: 119,
      y: 23
    }
  });

  const nextState = createEmptyCanvasState();
  nextState.nodes.push(createManualTerminalNode('terminal-1', createPayload.preferredPosition));
  await updateHostState(page, nextState);
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).toBe('terminal-1');
  expect(afterState.viewport.zoom).toBeLessThan(1.8);
  expect(afterState.viewport.zoom).toBeGreaterThanOrEqual(0.55);
  expect(afterState.viewport.zoom).toBeLessThanOrEqual(1.15);

  const viewportSize = page.viewportSize();
  const noteBox = await nodeById(page, 'terminal-1').boundingBox();
  expect(viewportSize).not.toBeNull();
  expect(noteBox).not.toBeNull();
  expect(noteBox.x).toBeGreaterThanOrEqual(-2);
  expect(noteBox.y).toBeGreaterThanOrEqual(-2);
  expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(viewportSize.width + 2);
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(viewportSize.height + 2);
  expect(Math.abs(noteBox.x + noteBox.width / 2 - viewportSize.width / 2)).toBeLessThanOrEqual(18);
  expect(Math.abs(noteBox.y + noteBox.height / 2 - viewportSize.height / 2)).toBeLessThanOrEqual(18);
});


test('canvas groups render, rename, and post group actions', async ({ page }) => {
  await openHarness(page);
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-05-22T00:00:00.000Z',
    nodes: [
      {
        id: 'note-1',
        kind: 'note',
        title: 'Grouped Note',
        status: 'ready',
        summary: 'inside group',
        position: { x: 160, y: 176 },
        size: sizeFor('note'),
        groupId: 'group-1',
        metadata: { note: { content: 'inside' } }
      }
    ],
    groups: [
      {
        id: 'group-1',
        title: 'Group 1',
        position: { x: 120, y: 120 },
        size: { width: 520, height: 420 }
      }
    ],
    edges: []
  });

  const groupFrame = page.locator('[data-group-id="group-1"]');
  const groupBackground = page.locator('[data-group-background-id="group-1"]');
  await expect(groupFrame).toBeVisible();
  await expect(groupBackground).toBeVisible();
  await expect(groupFrame.locator('[data-probe-field="title"]')).toHaveValue('Group 1');

  const groupPanelStyles = await groupFrame.evaluate((frame) => {
    const background = document.querySelector('[data-group-background-id="group-1"]');
    const titlebar = frame.querySelector('.canvas-group-titlebar');
    const node = document.querySelector('[data-node-id="note-1"]');
    const nodeWrapper = node?.closest('.react-flow__node');
    const backgroundLayer = background?.closest('.canvas-group-background-layer');
    const probeFrame = document.createElement('div');
    probeFrame.className = 'canvas-group-frame';
    probeFrame.style.position = 'absolute';
    probeFrame.style.left = '-10000px';
    probeFrame.style.top = '-10000px';
    probeFrame.style.width = '70.5px';
    probeFrame.style.height = '80px';
    probeFrame.style.setProperty('--canvas-group-title-tab-width', 'min(112px, 100%)');
    const probeTitlebar = document.createElement('div');
    probeTitlebar.className = 'canvas-group-titlebar';
    probeFrame.append(probeTitlebar);
    document.body.append(probeFrame);
    if (!(titlebar instanceof HTMLElement)) {
      throw new Error('Group titlebar not found.');
    }
    if (!(background instanceof HTMLElement)) {
      throw new Error('Group background not found.');
    }
    if (!(nodeWrapper instanceof HTMLElement)) {
      throw new Error('Grouped node wrapper not found.');
    }
    if (!(backgroundLayer instanceof HTMLElement)) {
      throw new Error('Group background layer not found.');
    }
    const frameStyles = getComputedStyle(frame);
    const backgroundStyles = getComputedStyle(background);
    const backgroundBeforeStyles = getComputedStyle(background, '::before');
    const backgroundAfterStyles = getComputedStyle(background, '::after');
    const backgroundLayerStyles = getComputedStyle(backgroundLayer);
    const nodeWrapperStyles = getComputedStyle(nodeWrapper);
    const titlebarStyles = getComputedStyle(titlebar);
    const frameRect = frame.getBoundingClientRect();
    const backgroundRect = background.getBoundingClientRect();
    const titlebarRect = titlebar.getBoundingClientRect();
    const nodeRect = nodeWrapper.getBoundingClientRect();
    const probeFrameRect = probeFrame.getBoundingClientRect();
    const probeTitlebarRect = probeTitlebar.getBoundingClientRect();
    probeFrame.remove();
    return {
      frameBackgroundColor: frameStyles.backgroundColor,
      frameBorderTopColor: frameStyles.borderTopColor,
      frameBoxShadow: frameStyles.boxShadow,
      backgroundColor: backgroundStyles.backgroundColor,
      backgroundBeforeBorderTopColor: backgroundBeforeStyles.borderTopColor,
      backgroundBeforeBorderTopLeftRadius: backgroundBeforeStyles.borderTopLeftRadius,
      backgroundAfterBorderTopColor: backgroundAfterStyles.borderTopColor,
      backgroundAfterBorderBottomColor: backgroundAfterStyles.borderBottomColor,
      backgroundBeforeBorderTopWidth: backgroundBeforeStyles.borderTopWidth,
      backgroundAfterBorderTopWidth: backgroundAfterStyles.borderTopWidth,
      backgroundAfterBorderBottomWidth: backgroundAfterStyles.borderBottomWidth,
      backgroundAfterBorderBottomLeftRadius: backgroundAfterStyles.borderBottomLeftRadius,
      backgroundTopRightCornerColor: document.elementFromPoint(Math.floor(backgroundRect.right - 2), Math.floor(backgroundRect.top + 2)) === background
        ? backgroundStyles.backgroundColor
        : 'transparent',
      backgroundBodyTopCss: Math.round(
        Number.parseFloat(backgroundStyles.getPropertyValue('--canvas-group-body-top'))
      ),
      backgroundBodyTop: Math.round(
        Number.parseFloat(backgroundStyles.getPropertyValue('--canvas-group-body-top')) * (frameRect.height / frame.offsetHeight)
      ),
      backgroundBoxShadow: backgroundStyles.boxShadow,
      backgroundLayerZIndex: backgroundLayerStyles.zIndex,
      backgroundSharesViewportWithNodes: background.closest('.react-flow__viewport') === nodeWrapper.closest('.react-flow__viewport'),
      frameSharesRendererWithPane:
        frame.closest('.react-flow__renderer') === document.querySelector('.react-flow__pane')?.closest('.react-flow__renderer'),
      nodeWrapperZIndex: nodeWrapperStyles.zIndex,
      backgroundLeft: Math.round(backgroundRect.left - frameRect.left),
      backgroundTop: Math.round(backgroundRect.top - frameRect.top),
      backgroundWidth: Math.round(backgroundRect.width),
      backgroundHeight: Math.round(backgroundRect.height),
      frameWidth: Math.round(frameRect.width),
      frameHeight: Math.round(frameRect.height),
      frameBorderTopLeftRadius: frameStyles.borderTopLeftRadius,
      titlebarBackgroundColor: titlebarStyles.backgroundColor,
      titlebarBorderRightColor: titlebarStyles.borderRightColor,
      titlebarColor: titlebarStyles.color,
      titlebarTop: Math.round(titlebarRect.top - frameRect.top),
      titlebarBottom: Math.round(titlebarRect.bottom - frameRect.top),
      titlebarBorderBottomWidth: titlebarStyles.borderBottomWidth,
      titlebarBorderTopLeftRadius: titlebarStyles.borderTopLeftRadius,
      titlebarBorderTopRightRadius: titlebarStyles.borderTopRightRadius,
      titlebarBorderBottomRightRadius: titlebarStyles.borderBottomRightRadius,
      titlebarBoxShadow: titlebarStyles.boxShadow,
      subpixelTitlebarWidth: probeTitlebarRect.width,
      subpixelFrameWidth: probeFrameRect.width,
      nodeBodyTopInset: Math.round(
        nodeRect.top - frameRect.top - Number.parseFloat(backgroundStyles.getPropertyValue('--canvas-group-body-top')) * (frameRect.height / frame.offsetHeight)
      )
    };
  });
  expect(groupPanelStyles.frameBackgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(groupPanelStyles.frameBorderTopColor).toBe('rgba(0, 0, 0, 0)');
  expect(groupPanelStyles.frameBoxShadow).toBe('none');
  expect(groupPanelStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(groupPanelStyles.titlebarBackgroundColor).toBe('rgb(24, 24, 24)');
  expect(groupPanelStyles.backgroundBeforeBorderTopColor).toBe('rgb(69, 69, 69)');
  expect(groupPanelStyles.backgroundAfterBorderTopColor).toBe('rgb(69, 69, 69)');
  expect(groupPanelStyles.backgroundAfterBorderBottomColor).toBe('rgb(69, 69, 69)');
  expect(groupPanelStyles.backgroundBeforeBorderTopWidth).toBe('1px');
  expect(groupPanelStyles.backgroundAfterBorderTopWidth).toBe('1px');
  expect(groupPanelStyles.backgroundAfterBorderBottomWidth).toBe('1px');
  expect(Number.parseFloat(groupPanelStyles.backgroundBeforeBorderTopLeftRadius)).toBe(0);
  expect(Number.parseFloat(groupPanelStyles.backgroundAfterBorderBottomLeftRadius)).toBe(0);
  expect(groupPanelStyles.backgroundTopRightCornerColor).toBe('transparent');
  expect(groupPanelStyles.backgroundBoxShadow).toBe('none');
  expect(groupPanelStyles.backgroundLayerZIndex).toBe('-1');
  expect(groupPanelStyles.backgroundSharesViewportWithNodes).toBe(true);
  expect(groupPanelStyles.frameSharesRendererWithPane).toBe(true);
  expect(Number.parseInt(groupPanelStyles.nodeWrapperZIndex, 10)).toBeGreaterThanOrEqual(0);
  expect(groupPanelStyles.backgroundLeft).toBe(0);
  expect(groupPanelStyles.backgroundTop).toBe(0);
  expect(groupPanelStyles.backgroundWidth).toBe(groupPanelStyles.frameWidth);
  expect(groupPanelStyles.backgroundHeight).toBe(groupPanelStyles.frameHeight);
  expect(groupPanelStyles.titlebarBorderRightColor).toBe('rgb(69, 69, 69)');
  expect(groupPanelStyles.titlebarColor).toBe('rgb(157, 157, 157)');
  expect(Number.parseFloat(groupPanelStyles.frameBorderTopLeftRadius)).toBe(0);
  expect(groupPanelStyles.backgroundBodyTopCss).toBe(28);
  expect(groupPanelStyles.titlebarTop).toBeLessThanOrEqual(2);
  expect(groupPanelStyles.titlebarBottom).toBeCloseTo(groupPanelStyles.backgroundBodyTop, -1);
  expect(groupPanelStyles.titlebarBorderBottomWidth).toBe('1px');
  expect(Number.parseFloat(groupPanelStyles.titlebarBorderTopLeftRadius)).toBe(0);
  expect(Number.parseFloat(groupPanelStyles.titlebarBorderTopRightRadius)).toBe(0);
  expect(Number.parseFloat(groupPanelStyles.titlebarBorderBottomRightRadius)).toBe(0);
  expect(groupPanelStyles.titlebarBoxShadow).toBe('none');
  expect(groupPanelStyles.subpixelTitlebarWidth).toBeLessThanOrEqual(groupPanelStyles.subpixelFrameWidth);
  expect(groupPanelStyles.nodeBodyTopInset).toBeGreaterThanOrEqual(24);

  await groupFrame.locator('.canvas-group-titlebar').click();
  const selectedTitlebarStyles = await groupFrame.locator('.canvas-group-titlebar').evaluate((titlebar) => {
    const styles = getComputedStyle(titlebar);
    return {
      borderBottomColor: styles.borderBottomColor,
      color: styles.color
    };
  });
  expect(selectedTitlebarStyles.borderBottomColor).toBe('rgb(69, 69, 69)');
  expect(selectedTitlebarStyles.color).toBe('rgb(204, 204, 204)');

  await groupFrame.locator('[data-probe-field="title"]').fill('Planning Group');
  await groupFrame.locator('[data-probe-field="title"]').press('Enter');
  const titleMessage = await waitForPostedMessageByType(page, 'webview/updateGroupTitle');
  expect(titleMessage.payload).toEqual({ groupId: 'group-1', title: 'Planning Group' });

  const groupToolbarLayout = await groupFrame.evaluate((frame) => {
    const titlebar = frame.querySelector('.canvas-group-titlebar');
    const toolbar = frame.querySelector('.canvas-group-toolbar');
    if (!(titlebar instanceof HTMLElement) || !(toolbar instanceof HTMLElement)) {
      throw new Error('Group toolbar not found.');
    }
    const frameRect = frame.getBoundingClientRect();
    const titlebarRect = titlebar.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      frameWidth: Math.round(frameRect.width),
      toolbarLeft: Math.round(toolbarRect.left - frameRect.left),
      toolbarTop: Math.round(toolbarRect.top - frameRect.top),
      toolbarWidth: Math.round(toolbarRect.width),
      toolbarRight: Math.round(toolbarRect.right - frameRect.left),
      titlebarRight: Math.round(titlebarRect.right - frameRect.left),
      titlebarTop: Math.round(titlebarRect.top - frameRect.top)
    };
  });
  expect(groupToolbarLayout.toolbarLeft).toBe(groupToolbarLayout.titlebarRight);
  expect(groupToolbarLayout.toolbarTop).toBe(groupToolbarLayout.titlebarTop);
  expect(groupToolbarLayout.toolbarRight).toBeLessThanOrEqual(groupToolbarLayout.frameWidth);
  expect(groupToolbarLayout.toolbarWidth).toBeLessThan(280);
  await expect(groupFrame.locator('.canvas-group-split-primary')).toHaveText('取消分组');
  await expect(groupFrame.locator('.canvas-group-split-danger')).toHaveText('删除分组');
  await groupFrame.locator('.canvas-group-split-danger').click();
  const deleteGroupMessage = await waitForPostedMessageByType(page, 'webview/deleteGroup');
  expect(deleteGroupMessage.payload).toEqual({ groupId: 'group-1' });
  await clearPostedMessages(page);

  await groupFrame.locator('.canvas-group-titlebar').click();
  await expect(groupFrame.locator('.canvas-group-split-primary')).toBeVisible();
  await groupFrame.locator('.canvas-group-split-primary').click();
  const ungroupMessage = await waitForPostedMessageByType(page, 'webview/ungroup');
  expect(ungroupMessage.payload).toEqual({ groupId: 'group-1' });
});

test('canvas group title exposes the full title when truncated like node titles', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const longTitle = '非常长的规划分组标题用于验证标题区域被截断时悬浮可以看到完整内容';
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('note-long-title', { x: 360, y: 168 }),
      title: longTitle,
      size: { width: 180, height: 220 }
    }
  ];
  state.groups = [
    {
      id: 'group-long-title',
      title: longTitle,
      position: { x: 120, y: 140 },
      size: { width: 150, height: 220 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const groupTitle = page.locator('[data-group-id="group-long-title"] [data-probe-field="title"]');
  const nodeTitle = nodeById(page, 'note-long-title').locator('[data-probe-field="title"]');
  await expect(groupTitle).toHaveValue(longTitle);
  await expect(nodeTitle).toHaveValue(longTitle);
  await expect
    .poll(async () =>
      groupTitle.evaluate((title) => title.scrollWidth > title.clientWidth + 1)
    )
    .toBe(true);
  await expect
    .poll(async () =>
      nodeTitle.evaluate((title) => title.scrollWidth > title.clientWidth + 1)
    )
    .toBe(true);
  await expect(groupTitle).toHaveAttribute('title', longTitle);
  await expect(nodeTitle).toHaveAttribute('title', longTitle);
});

test('workspace root group keeps the root path tooltip when its display title is truncated', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const displayTitle = '非常长的工作区根目录标题用于验证截断时仍然展示完整路径';
  const workspaceRootPath = '/repo/frontend-app-with-a-very-long-folder-display-title';
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'workspace-root-long-title',
      title: displayTitle,
      position: { x: 120, y: 140 },
      size: { width: 150, height: 220 },
      role: 'workspace-root',
      workspaceRootPath
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const rootTitle = page.locator('[data-group-id="workspace-root-long-title"] [data-probe-field="title"]');
  await expect(rootTitle).toHaveValue(displayTitle);
  await expect(rootTitle).toHaveAttribute('readonly', '');
  await expect
    .poll(async () =>
      rootTitle.evaluate((title) => title.scrollWidth > title.clientWidth + 1)
    )
    .toBe(true);
  await expect(rootTitle).toHaveAttribute('title', workspaceRootPath);
});

test('workspace root group body renders a tiled non-interactive root name watermark', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedGroupId: 'workspace-root-watermark',
      selectedGroupIds: ['workspace-root-watermark'],
      viewport: { x: 0, y: 0, zoom: 0.5 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('root-note', { x: 200, y: 200 }),
      groupId: 'workspace-root-watermark'
    }
  ];
  state.groups = [
    {
      id: 'workspace-root-watermark',
      title: 'Frontend',
      position: { x: 120, y: 140 },
      size: { width: 720, height: 520 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    },
    {
      id: 'group-child',
      title: 'Child Group',
      position: { x: 260, y: 260 },
      size: { width: 360, height: 260 },
      parentGroupId: 'workspace-root-watermark'
    },
    {
      id: 'group-regular',
      title: 'Frontend',
      position: { x: 960, y: 140 },
      size: { width: 720, height: 520 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const rootBackground = page.locator('[data-group-background-id="workspace-root-watermark"]');
  const rootWatermarkFrame = page.locator('[data-root-watermark-frame-id="workspace-root-watermark"]');
  const rootWatermark = rootWatermarkFrame.locator('.canvas-root-watermark-tile[data-root-name-watermark="true"]');
  const rootWatermarkLabel = rootWatermark.locator('[data-root-watermark-label="Frontend"]');
  await expect(rootBackground).toHaveAttribute('data-group-background-role', 'workspace-root');
  await expect(rootWatermarkFrame).toHaveCount(1);
  await expect(rootWatermarkLabel).toHaveText('Frontend');
  await expect(page.locator('[data-group-background-id="group-regular"] [data-root-name-watermark="true"]')).toHaveCount(0);
  await expect(page.locator('[data-root-watermark-frame-id="group-regular"]')).toHaveCount(0);

  const watermarkStyle = await rootWatermark.evaluate((watermark) => {
    const watermarkFrame = watermark.closest('[data-root-watermark-frame-id]');
    const groupId = watermarkFrame?.getAttribute('data-root-watermark-frame-id');
    const background = groupId ? document.querySelector(`[data-group-background-id="${CSS.escape(groupId)}"]`) : null;
    const bodyHitArea = background?.querySelector('[data-group-background-body-hit-area="true"]');
    const rootFrame = groupId ? document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`) : null;
    const rootTitle = rootFrame?.querySelector('[data-probe-field="title"]');
    const childBackground = document.querySelector('[data-group-background-id="group-child"]');
    const node = document.querySelector('[data-node-id="root-note"]');
    const nodeWrapper = node?.closest('.react-flow__node');
    const viewport = document.querySelector('.react-flow__viewport');
    const renderer = document.querySelector('.react-flow__renderer');
    const backgroundLayer = watermarkFrame?.closest('.canvas-group-background-layer');
    if (
      !(watermarkFrame instanceof HTMLElement) ||
      !(background instanceof HTMLElement) ||
      !(bodyHitArea instanceof HTMLElement) ||
      !(rootTitle instanceof HTMLElement) ||
      !(childBackground instanceof HTMLElement) ||
      !(nodeWrapper instanceof HTMLElement) ||
      !(viewport instanceof HTMLElement) ||
      !(renderer instanceof HTMLElement) ||
      !(backgroundLayer instanceof HTMLElement)
    ) {
      throw new Error('Workspace root watermark frame not found.');
    }
    const watermarkRect = watermark.getBoundingClientRect();
    const watermarkFrameRect = watermarkFrame.getBoundingClientRect();
    const bodyRect = bodyHitArea.getBoundingClientRect();
    const layerChildren = Array.from(backgroundLayer.children);
    const style = getComputedStyle(watermark);
    const frameStyle = getComputedStyle(watermarkFrame);
    const rootTitleStyle = getComputedStyle(rootTitle);
    const childBackgroundStyle = getComputedStyle(childBackground);
    const viewportStyle = getComputedStyle(viewport);
    const rendererStyle = getComputedStyle(renderer);
    const nodeRect = nodeWrapper.getBoundingClientRect();
    const topElementAtNodeCenter = document.elementFromPoint(
      nodeRect.left + nodeRect.width / 2,
      nodeRect.top + nodeRect.height / 2
    );
    const beforeStyle = getComputedStyle(watermark, '::before');
    const maskSize = beforeStyle.maskSize || beforeStyle.webkitMaskSize;
    const tileWidth = Number.parseFloat(maskSize.split(' ')[0]);
    const tileHeight = Number.parseFloat(maskSize.split(' ')[1]);
    const zIndexValue = (value) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      framePointerEvents: frameStyle.pointerEvents,
      pointerEvents: style.pointerEvents,
      left: Math.round(watermarkRect.left - bodyRect.left),
      top: Math.round(watermarkRect.top - bodyRect.top),
      frameLeft: Math.round(watermarkFrameRect.left - background.getBoundingClientRect().left),
      frameTop: Math.round(watermarkFrameRect.top - background.getBoundingClientRect().top),
      width: Math.round(watermarkRect.width),
      height: Math.round(watermarkRect.height),
      bodyWidth: Math.round(bodyRect.width),
      bodyHeight: Math.round(bodyRect.height),
      beforeOpacity: Number.parseFloat(beforeStyle.opacity),
      beforeBackgroundColor: beforeStyle.backgroundColor,
      beforeMaskImage: beforeStyle.maskImage || beforeStyle.webkitMaskImage,
      beforeMaskRepeat: beforeStyle.maskRepeat || beforeStyle.webkitMaskRepeat,
      beforeMaskSize: maskSize,
      labelFontStyle: getComputedStyle(watermark.querySelector('[data-root-watermark-label]')).fontStyle,
      labelFontSize: Number.parseFloat(getComputedStyle(watermark.querySelector('[data-root-watermark-label]')).fontSize),
      titleFontSize: Number.parseFloat(rootTitleStyle.fontSize),
      tileWidth,
      tileHeight,
      watermarkZIndex: zIndexValue(frameStyle.zIndex),
      childBackgroundZIndex: zIndexValue(childBackgroundStyle.zIndex),
      watermarkAfterChildBackground: layerChildren.indexOf(watermarkFrame) > layerChildren.indexOf(childBackground),
      watermarkInsideViewport: watermarkFrame.closest('.react-flow__viewport') === viewport,
      nodeInsideRenderer: nodeWrapper.closest('.react-flow__renderer') === renderer,
      viewportZIndex: zIndexValue(viewportStyle.zIndex),
      rendererZIndex: zIndexValue(rendererStyle.zIndex),
      topNodeIdAtNodeCenter: topElementAtNodeCenter?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
    };
  });
  expect(watermarkStyle.framePointerEvents).toBe('none');
  expect(watermarkStyle.pointerEvents).toBe('none');
  expect(watermarkStyle.left).toBe(0);
  expect(watermarkStyle.top).toBe(0);
  expect(watermarkStyle.frameLeft).toBe(0);
  expect(watermarkStyle.frameTop).toBe(0);
  expect(watermarkStyle.width).toBe(watermarkStyle.bodyWidth);
  expect(watermarkStyle.height).toBe(watermarkStyle.bodyHeight);
  expect(watermarkStyle.beforeOpacity).toBeGreaterThan(0);
  expect(watermarkStyle.beforeOpacity).toBeLessThan(0.6);
  expect(watermarkStyle.beforeBackgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(watermarkStyle.beforeMaskImage).toContain('data:image/svg+xml');
  expect(watermarkStyle.beforeMaskImage).toContain('Frontend');
  expect(watermarkStyle.beforeMaskImage).not.toContain('rotate');
  expect(watermarkStyle.beforeMaskRepeat).toContain('repeat');
  expect(watermarkStyle.beforeOpacity).toBeGreaterThanOrEqual(0.24);
  expect(watermarkStyle.beforeOpacity).toBeLessThanOrEqual(0.34);
  expect(watermarkStyle.labelFontStyle).toBe('normal');
  expect(watermarkStyle.labelFontSize).toBeGreaterThan(12);
  expect(watermarkStyle.labelFontSize).toBeCloseTo(watermarkStyle.titleFontSize, 1);
  expect(watermarkStyle.tileWidth).toBeGreaterThan(0);
  expect(watermarkStyle.tileWidth).toBeGreaterThan(180 * (watermarkStyle.labelFontSize / 12));
  expect(watermarkStyle.tileWidth).toBeLessThan(watermarkStyle.bodyWidth * 1.5);
  expect(watermarkStyle.tileHeight).toBeGreaterThan(88 * (watermarkStyle.labelFontSize / 12));
  expect(watermarkStyle.tileHeight).toBeLessThan(watermarkStyle.bodyHeight);
  expect(watermarkStyle.watermarkZIndex).toBeGreaterThan(watermarkStyle.childBackgroundZIndex);
  expect(watermarkStyle.watermarkAfterChildBackground).toBe(true);
  expect(watermarkStyle.watermarkInsideViewport).toBe(true);
  expect(watermarkStyle.nodeInsideRenderer).toBe(true);
  expect(watermarkStyle.rendererZIndex).toBeGreaterThan(watermarkStyle.viewportZIndex);
  expect(watermarkStyle.topNodeIdAtNodeCenter).toBe('root-note');

  await clearPostedMessages(page);
  const rootBackgroundBox = await rootBackground.boundingBox();
  expect(rootBackgroundBox).not.toBeNull();
  await page.mouse.click(rootBackgroundBox.x + rootBackgroundBox.width - 30, rootBackgroundBox.y + rootBackgroundBox.height - 15);
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupId ?? null)
    .toBe('workspace-root-watermark');
});

test('workspace root watermark keeps overview-scale text when the title chrome is width-capped', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 0.25 }
    }
  });
  const longTitle = './dsc-test-02 - home/users/ziyang01.wang-al/projects/dsc-test-02';
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'workspace-root-watermark-long-title',
      title: longTitle,
      position: { x: 120, y: 140 },
      size: { width: 180, height: 320 },
      role: 'workspace-root',
      workspaceRootPath: `/repo/${longTitle}`
    },
    {
      id: 'group-distant-min-zoom-anchor',
      title: 'Distant Anchor',
      position: { x: 8400, y: 140 },
      size: { width: 320, height: 240 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const watermark = page.locator(
    '[data-root-watermark-frame-id="workspace-root-watermark-long-title"] .canvas-root-watermark-tile'
  );
  const title = page.locator('[data-group-id="workspace-root-watermark-long-title"] [data-probe-field="title"]');
  await expect(watermark.locator(`[data-root-watermark-label="${longTitle}"]`)).toHaveText(longTitle);
  await expect(title).toHaveValue(longTitle);

  const watermarkStyle = await watermark.evaluate((element) => {
    const frame = element.closest('[data-root-watermark-frame-id]');
    const groupId = frame?.getAttribute('data-root-watermark-frame-id');
    const groupFrame = groupId ? document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`) : null;
    const titleInput = groupFrame?.querySelector('[data-probe-field="title"]');
    const beforeStyle = getComputedStyle(element, '::before');
    const maskImage = beforeStyle.maskImage || beforeStyle.webkitMaskImage;
    const maskSize = beforeStyle.maskSize || beforeStyle.webkitMaskSize;
    const tileWidth = Number.parseFloat(maskSize.split(' ')[0]);
    const tileHeight = Number.parseFloat(maskSize.split(' ')[1]);
    if (!(frame instanceof HTMLElement) || !(groupFrame instanceof HTMLElement) || !(titleInput instanceof HTMLElement)) {
      throw new Error('Workspace root watermark elements not found.');
    }

    const frameStyles = getComputedStyle(frame);
    const titleStyles = getComputedStyle(titleInput);
    const label = element.querySelector('[data-root-watermark-label]');
    const labelStyles = label instanceof HTMLElement ? getComputedStyle(label) : null;
    const viewport = document.querySelector('.react-flow__viewport');
    const viewportZoom = viewport instanceof HTMLElement
      ? Number.parseFloat(viewport.style.transform.match(/scale\(([-\d.]+)\)/)?.[1] ?? 'NaN')
      : NaN;
    const decodeSvgMaskImage = (value) => {
      const match = value.match(/url\("data:image\/svg\+xml,([^"]+)"\)/u) ??
        value.match(/url\(data:image\/svg\+xml,([^)]*)\)/u);
      return match ? decodeURIComponent(match[1]) : null;
    };
    return {
      groupWidth: Math.round(groupFrame.getBoundingClientRect().width),
      titleClientWidth: titleInput.clientWidth,
      titleScrollWidth: titleInput.scrollWidth,
      titleFontSize: Number.parseFloat(titleStyles.fontSize),
      titleReadableScale: Number.parseFloat(frameStyles.getPropertyValue('--canvas-group-readable-scale')),
      viewportZoom,
      watermarkFontSize: Number.parseFloat(frameStyles.getPropertyValue('--canvas-root-watermark-font-size')),
      watermarkReadableScale: Number.parseFloat(frameStyles.getPropertyValue('--canvas-root-watermark-readable-scale')),
      labelFontSize: labelStyles ? Number.parseFloat(labelStyles.fontSize) : null,
      maskImage,
      textElementCount: decodeSvgMaskImage(maskImage)?.match(/<text\b/gu)?.length ?? 0,
      hasSecondTextLine: Boolean(decodeSvgMaskImage(maskImage)?.match(/<text\b[^>]* y="[^"]+"/gu)?.[1]),
      tileWidth,
      tileHeight
    };
  });

  expect(watermarkStyle.titleReadableScale).toBeLessThan(1);
  expect(watermarkStyle.titleReadableScale).toBeLessThan(watermarkStyle.watermarkReadableScale / 3);
  expect(watermarkStyle.watermarkReadableScale).toBeCloseTo(1 / watermarkStyle.viewportZoom, 1);
  expect(watermarkStyle.watermarkFontSize).toBeCloseTo(12 / watermarkStyle.viewportZoom, 1);
  expect(watermarkStyle.watermarkFontSize).toBeGreaterThan(watermarkStyle.titleFontSize * 3);
  expect(watermarkStyle.labelFontSize).toBeCloseTo(watermarkStyle.watermarkFontSize, 1);
  expect(watermarkStyle.maskImage).toContain('data:image/svg+xml');
  expect(watermarkStyle.maskImage).toContain('dsc-test-02');
  expect(watermarkStyle.maskImage).not.toContain('home%2Fusers');
  expect(watermarkStyle.maskImage).not.toContain('projects%2Fdsc-test-02');
  expect(watermarkStyle.textElementCount).toBe(1);
  expect(watermarkStyle.hasSecondTextLine).toBe(false);
  expect(watermarkStyle.tileWidth).toBeGreaterThan(watermarkStyle.groupWidth);
  expect(watermarkStyle.tileHeight).toBeGreaterThanOrEqual(88 * watermarkStyle.watermarkReadableScale);
});

test('workspace root group body watermark can be disabled by runtime configuration', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'workspace-root-watermark-disabled',
      title: 'Backend',
      position: { x: 120, y: 140 },
      size: { width: 720, height: 520 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/backend'
    }
  ];
  await bootstrap(page, state, createRuntimeContext({ workspaceRootWatermarksEnabled: false }));
  await settleWebview(page, 2);

  const rootBackground = page.locator('[data-group-background-id="workspace-root-watermark-disabled"]');
  const rootWatermarkFrame = page.locator('[data-root-watermark-frame-id="workspace-root-watermark-disabled"]');
  await expect(rootBackground).toHaveAttribute('data-group-background-role', 'workspace-root');
  await expect(rootWatermarkFrame).toHaveCount(0);

  await updateHostState(page, state, createRuntimeContext({ workspaceRootWatermarksEnabled: true }));
  await settleWebview(page, 2);
  await expect(rootWatermarkFrame.locator('[data-root-name-watermark="true"]')).toHaveCount(1);
});

test('workspace root group title reuses regular group title chrome without rename actions', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 0.5 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-06-03T00:00:00.000Z',
    nodes: [],
    groups: [
      {
        id: 'workspace-root-a',
        title: 'Frontend',
        position: { x: 120, y: 120 },
        size: { width: 900, height: 520 },
        role: 'workspace-root',
        workspaceRootPath: '/repo/frontend'
      },
      {
        id: 'group-regular',
        title: 'Frontend',
        position: { x: 1200, y: 120 },
        size: { width: 900, height: 520 }
      }
    ],
    edges: []
  });
  await settleWebview(page, 2);

  const rootFrame = page.locator('[data-group-id="workspace-root-a"]');
  const regularFrame = page.locator('[data-group-id="group-regular"]');
  const rootTitle = rootFrame.locator('[data-probe-field="title"]');
  const regularTitle = regularFrame.locator('[data-probe-field="title"]');
  await expect(rootTitle).toHaveValue('Frontend');
  await expect(rootTitle).toHaveAttribute('readonly', '');
  await expect(rootTitle).toHaveAttribute('title', '/repo/frontend');
  await expect(regularTitle).not.toHaveAttribute('readonly', '');

  const titleChrome = await rootFrame.evaluate((frame) => {
    const regularFrame = document.querySelector('[data-group-id="group-regular"]');
    const rootInput = frame.querySelector('[data-probe-field="title"]');
    const regularInput = regularFrame?.querySelector('[data-probe-field="title"]');
    const rootTitlebar = frame.querySelector('.canvas-group-titlebar');
    const regularTitlebar = regularFrame?.querySelector('.canvas-group-titlebar');
    if (
      !(rootInput instanceof HTMLInputElement) ||
      !(regularInput instanceof HTMLInputElement) ||
      !(rootTitlebar instanceof HTMLElement) ||
      !(regularTitlebar instanceof HTMLElement)
    ) {
      throw new Error('Group title chrome not found.');
    }
    const rootInputStyles = getComputedStyle(rootInput);
    const regularInputStyles = getComputedStyle(regularInput);
    return {
      rootTagName: rootInput.tagName,
      regularTagName: regularInput.tagName,
      rootDataInteractive: rootInput.dataset.nodeInteractive,
      regularDataInteractive: regularInput.dataset.nodeInteractive,
      rootFontSize: Number.parseFloat(rootInputStyles.fontSize),
      regularFontSize: Number.parseFloat(regularInputStyles.fontSize),
      rootFontWeight: rootInputStyles.fontWeight,
      regularFontWeight: regularInputStyles.fontWeight,
      rootHeight: rootTitlebar.getBoundingClientRect().height,
      regularHeight: regularTitlebar.getBoundingClientRect().height
    };
  });
  expect(titleChrome.rootTagName).toBe(titleChrome.regularTagName);
  expect(titleChrome.rootDataInteractive).toBe(titleChrome.regularDataInteractive);
  expect(titleChrome.rootFontSize).toBeCloseTo(titleChrome.regularFontSize, 1);
  expect(titleChrome.rootFontWeight).toBe(titleChrome.regularFontWeight);
  expect(titleChrome.rootHeight).toBeCloseTo(titleChrome.regularHeight, 1);
  expect(titleChrome.rootFontSize * 0.5).toBeCloseTo(12, 1);

  await rootTitle.click();
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupId)
    .toBe('workspace-root-a');
  await expect(rootFrame.locator('.canvas-group-split-primary')).toHaveCount(0);
  await expect(rootFrame.locator('.canvas-group-split-danger')).toHaveCount(0);

  await clearPostedMessages(page);
  await rootTitle.press(`${PRIMARY_ACCELERATOR_KEY}+KeyA`);
  await rootTitle.pressSequentially('Renamed Root');
  await rootTitle.press('Enter');
  await settleWebview(page, 1);
  await expect(rootTitle).toHaveValue('Frontend');
  await expect
    .poll(async () => (await readPostedMessagesByType(page, 'webview/updateGroupTitle')).length)
    .toBe(0);

  const rootTitleBox = await rootTitle.boundingBox();
  const rootFrameBox = await rootFrame.boundingBox();
  expect(rootTitleBox).not.toBeNull();
  expect(rootFrameBox).not.toBeNull();
  await page.mouse.move(rootTitleBox.x + 8, rootTitleBox.y + rootTitleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rootTitleBox.x + 88, rootTitleBox.y + rootTitleBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await settleWebview(page, 1);
  await expect
    .poll(async () => (await readPostedMessagesByType(page, 'webview/moveGroup')).length)
    .toBe(0);
  const rootFrameBoxAfterTitleDrag = await rootFrame.boundingBox();
  expect(rootFrameBoxAfterTitleDrag).not.toBeNull();
  expectBoxEdgesClose(rootFrameBoxAfterTitleDrag, rootFrameBox);
});

for (const groupFixture of [
  {
    label: 'regular',
    group: {
      id: 'group-focus',
      title: 'Focus Group',
      position: { x: 700, y: 420 },
      size: { width: 820, height: 520 }
    },
    viewport: { x: -230, y: -100, zoom: 0.5 }
  },
  {
    label: 'workspace root',
    group: {
      id: 'workspace-root-focus',
      title: 'Frontend Root',
      position: { x: 1000, y: 740 },
      size: { width: 1180, height: 760 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    },
    viewport: { x: -340, y: -241, zoom: 0.42 }
  }
]) {
  test(`double-clicking ${groupFixture.label} group titlebar blank area focuses the existing group`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 620 });
    await openHarness(page, {
      persistedState: {
        selectedNodeId: 'stale-node-selection',
        viewport: groupFixture.viewport
      }
    });
    await bootstrap(page, createGroupFocusCanvasState(groupFixture.group));
    await settleWebview(page, 4);

    const groupFrame = page.locator(`[data-group-id="${groupFixture.group.id}"]`);
    const beforeGeometry = await readGroupCanvasGeometry(page, groupFixture.group.id);
    const beforeState = await readPersistedUiState(page);
    expect(beforeState.viewport).toEqual(groupFixture.viewport);
    await clearPostedMessages(page);

    const titlebarBox = await groupFrame.locator('.canvas-group-titlebar').boundingBox();
    expect(titlebarBox).not.toBeNull();
    await page.mouse.dblclick(titlebarBox.x + 4, titlebarBox.y + titlebarBox.height / 2);

    await expect
      .poll(async () => (await readPersistedUiState(page)).selectedGroupId ?? null)
      .toBe(groupFixture.group.id);

    await waitForNodeFocusAnimation(page);

    const afterState = await readPersistedUiState(page);
    expect(afterState.selectedNodeId ?? null).toBeNull();
    expect(afterState.selectedGroupId).toBe(groupFixture.group.id);
    expect(afterState.selectedGroupIds).toEqual([groupFixture.group.id]);
    expect(afterState.viewport).not.toEqual(beforeState.viewport);
    expect(afterState.viewport.zoom).toBeLessThanOrEqual(1.15);
    expect(await readGroupCanvasGeometry(page, groupFixture.group.id)).toEqual(beforeGeometry);
    expect(await readPostedMessagesByType(page, 'webview/moveGroup')).toEqual([]);
    expect(await readPostedMessagesByType(page, 'webview/resizeGroup')).toEqual([]);
    expect(await readPostedMessagesByType(page, 'webview/createEmptyGroup')).toEqual([]);
    await expectGroupCenteredInViewport(page, groupFixture.group.id);
  });
}

test('double-clicking group body blank area focuses the existing group', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 0.65 }
    }
  });
  const group = {
    id: 'group-body-focus',
    title: 'Body Focus Group',
    position: { x: 120, y: 120 },
    size: { width: 620, height: 500 }
  };
  await bootstrap(page, createGroupFocusCanvasState(group));
  await settleWebview(page, 4);

  const groupFrame = page.locator(`[data-group-id="${group.id}"]`);
  const beforeGeometry = await readGroupCanvasGeometry(page, group.id);
  const beforeState = await readPersistedUiState(page);
  const beforeBox = await groupFrame.boundingBox();
  expect(beforeBox).not.toBeNull();
  await clearPostedMessages(page);

  await page.mouse.dblclick(beforeBox.x + beforeBox.width - 70, beforeBox.y + beforeBox.height - 70);

  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupId ?? null)
    .toBe(group.id);

  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedGroupId).toBe(group.id);
  expect(afterState.selectedGroupIds).toEqual([group.id]);
  expect(afterState.viewport).not.toEqual(beforeState.viewport);
  expect(afterState.viewport.zoom).toBeLessThanOrEqual(1.15);
  expect(await readGroupCanvasGeometry(page, group.id)).toEqual(beforeGeometry);
  expect(await readPostedMessagesByType(page, 'webview/moveGroup')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/resizeGroup')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/createEmptyGroup')).toEqual([]);
  await expectGroupCenteredInViewport(page, group.id);
});

test('double-clicking group title input keeps the current viewport unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await openHarness(page, {
    persistedState: {
      viewport: { x: -180, y: -120, zoom: 0.8 }
    }
  });
  const group = {
    id: 'group-title-input',
    title: 'Editable Group',
    position: { x: 260, y: 220 },
    size: { width: 620, height: 420 }
  };
  await bootstrap(page, createGroupFocusCanvasState(group));
  await settleWebview(page, 4);
  await clearPostedMessages(page);

  const beforeState = await readPersistedUiState(page);

  await page.locator(`[data-group-id="${group.id}"] [data-probe-field="title"]`).dblclick();
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.viewport).toEqual(beforeState.viewport);
  expect(await readPostedMessagesByType(page, 'webview/updateGroupTitle')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/moveGroup')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/resizeGroup')).toEqual([]);
});

test('workspace root group title counter-scales like regular group titles below the content inset cap', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 0.4 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-06-08T00:00:00.000Z',
    nodes: [],
    groups: [
      {
        id: 'workspace-root-a',
        title: 'Frontend',
        position: { x: 120, y: 120 },
        size: { width: 2800, height: 1400 },
        role: 'workspace-root',
        workspaceRootPath: '/repo/frontend'
      },
      {
        id: 'group-regular',
        title: 'Frontend',
        position: { x: 3600, y: 120 },
        size: { width: 2800, height: 1400 }
      }
    ],
    edges: []
  });
  await settleWebview(page, 2);

  await page.locator('.react-flow__controls-fitview').click();
  await expect.poll(async () => readCanvasViewportScale(page)).toBeLessThan(0.25);

  const titleChrome = await page.locator('[data-group-id="workspace-root-a"]').evaluate((frame) => {
    const regularFrame = document.querySelector('[data-group-id="group-regular"]');
    const rootTitlebar = frame.querySelector('.canvas-group-titlebar');
    const regularTitlebar = regularFrame?.querySelector('.canvas-group-titlebar');
    const rootInput = frame.querySelector('.canvas-group-title .window-title-input');
    const regularInput = regularFrame?.querySelector('.canvas-group-title .window-title-input');
    const viewport = document.querySelector('.react-flow__viewport');
    if (
      !(regularFrame instanceof HTMLElement) ||
      !(rootTitlebar instanceof HTMLElement) ||
      !(regularTitlebar instanceof HTMLElement) ||
      !(rootInput instanceof HTMLInputElement) ||
      !(regularInput instanceof HTMLInputElement) ||
      !(viewport instanceof HTMLElement)
    ) {
      throw new Error('Workspace root title chrome not found.');
    }
    const zoom = Number(viewport.style.transform.match(/scale\(([-\d.]+)\)/)?.[1] ?? NaN);
    const rootStyles = getComputedStyle(frame);
    const regularStyles = getComputedStyle(regularFrame);
    const rootInputStyles = getComputedStyle(rootInput);
    const regularInputStyles = getComputedStyle(regularInput);
    return {
      zoom,
      rootReadableScale: Number.parseFloat(rootStyles.getPropertyValue('--canvas-group-readable-scale')),
      regularReadableScale: Number.parseFloat(regularStyles.getPropertyValue('--canvas-group-readable-scale')),
      rootTitlebarHeight: rootTitlebar.getBoundingClientRect().height,
      regularTitlebarHeight: regularTitlebar.getBoundingClientRect().height,
      rootFontSize: Number.parseFloat(rootInputStyles.fontSize),
      regularFontSize: Number.parseFloat(regularInputStyles.fontSize),
      rootTitlebarWidth: rootTitlebar.getBoundingClientRect().width,
      regularTitlebarWidth: regularTitlebar.getBoundingClientRect().width
    };
  });

  expect(titleChrome.zoom).toBeLessThan(0.25);
  expect(titleChrome.rootReadableScale).toBeCloseTo(1 / titleChrome.zoom, 1);
  expect(titleChrome.rootReadableScale).toBeCloseTo(titleChrome.regularReadableScale, 1);
  expect(titleChrome.rootTitlebarHeight).toBeCloseTo(titleChrome.regularTitlebarHeight, 1);
  expect(titleChrome.rootTitlebarHeight).toBeGreaterThanOrEqual(24);
  expect(titleChrome.rootFontSize * titleChrome.zoom).toBeCloseTo(12, 1);
  expect(titleChrome.regularFontSize * titleChrome.zoom).toBeCloseTo(12, 1);
  expect(titleChrome.rootTitlebarWidth).toBeCloseTo(titleChrome.regularTitlebarWidth, 1);
});

test('workspace root group resize commit survives host refresh and follow-up selection without geometry drift', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedGroupId: 'workspace-root-a',
      selectedGroupIds: ['workspace-root-a'],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('root-note', { x: 260, y: 260 }),
      size: { width: 220, height: 180 },
      groupId: 'workspace-root-a'
    }
  ];
  state.groups = [
    {
      id: 'workspace-root-a',
      title: 'Frontend Root',
      position: { x: 120, y: 120 },
      size: { width: 760, height: 560 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const rootFrame = page.locator('[data-group-id="workspace-root-a"]');
  const initialProbe = await requestWebviewProbe(page);
  expect(initialProbe.groups.find((group) => group.groupId === 'workspace-root-a')).toMatchObject({
    groupId: 'workspace-root-a',
    role: 'workspace-root',
    selected: true,
    left: 120,
    top: 120,
    width: 760,
    height: 560
  });

  const handle = rootFrame.locator('[data-group-resize-direction="bottom-right"]');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await clearPostedMessages(page);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 180, handleBox.y + handleBox.height / 2 + 120, { steps: 5 });
  await page.mouse.up();

  const message = await waitForPostedMessageByType(page, 'webview/resizeGroup');
  expect(message.payload).toMatchObject({
    groupId: 'workspace-root-a',
    position: { x: 120, y: 120 },
    size: { width: 940, height: 680 }
  });

  state.groups[0] = {
    ...state.groups[0],
    position: message.payload.position,
    size: message.payload.size
  };
  await updateHostState(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const committedGeometry = await readGroupCanvasGeometry(page, 'workspace-root-a');
  expect(committedGeometry).toEqual({ x: 120, y: 120, width: 940, height: 680 });
  const committedProbe = await requestWebviewProbe(page);
  expect(committedProbe.groups.find((group) => group.groupId === 'workspace-root-a')).toMatchObject({
    selected: true,
    left: 120,
    top: 120,
    width: 940,
    height: 680
  });

  await clearPostedMessages(page);
  await rootFrame.locator('.canvas-group-titlebar').click({ position: { x: 12, y: 14 } });
  await settleWebview(page, 3);

  expect(await readGroupCanvasGeometry(page, 'workspace-root-a')).toEqual(committedGeometry);
  const afterClickProbe = await requestWebviewProbe(page);
  expect(afterClickProbe.groups.find((group) => group.groupId === 'workspace-root-a')).toMatchObject({
    selected: true,
    left: 120,
    top: 120,
    width: 940,
    height: 680
  });
  expect(await readPostedMessagesByType(page, 'webview/moveGroup')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/resizeGroup')).toEqual([]);
});

test('workspace root group resize draft is replaced by repaired host geometry after refresh', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedGroupId: 'workspace-root-a',
      selectedGroupIds: ['workspace-root-a'],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('root-note', { x: 260, y: 260 }),
      size: { width: 220, height: 180 },
      groupId: 'workspace-root-a'
    }
  ];
  state.groups = [
    {
      id: 'workspace-root-a',
      title: 'Frontend Root',
      position: { x: 120, y: 120 },
      size: { width: 760, height: 560 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    },
    {
      id: 'workspace-root-b',
      title: 'Backend Root',
      position: { x: 1120, y: 120 },
      size: { width: 760, height: 560 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/backend'
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const rootFrame = page.locator('[data-group-id="workspace-root-a"]');
  await clearPostedMessages(page);
  const handle = rootFrame.locator('[data-group-resize-direction="bottom-right"]');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 180, handleBox.y + handleBox.height / 2 + 120, { steps: 5 });
  await page.mouse.up();

  const message = await waitForPostedMessageByType(page, 'webview/resizeGroup');
  expect(message.payload).toMatchObject({
    groupId: 'workspace-root-a',
    position: { x: 120, y: 120 },
    size: { width: 940, height: 680 }
  });

  state.groups[0] = {
    ...state.groups[0],
    position: { x: 96, y: 104 },
    size: { width: 820, height: 620 }
  };
  await updateHostState(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  expect(await readGroupCanvasGeometry(page, 'workspace-root-a')).toEqual({
    x: 96,
    y: 104,
    width: 820,
    height: 620
  });
  const repairedProbe = await requestWebviewProbe(page);
  expect(repairedProbe.groups.find((group) => group.groupId === 'workspace-root-a')).toMatchObject({
    selected: true,
    left: 96,
    top: 104,
    width: 820,
    height: 620
  });

  await clearPostedMessages(page);
  await page.locator('[data-group-id="workspace-root-b"] .canvas-group-titlebar').click({ position: { x: 12, y: 14 } });
  await settleWebview(page, 2);
  await rootFrame.locator('.canvas-group-titlebar').click({ position: { x: 12, y: 14 } });
  await settleWebview(page, 3);

  expect(await readGroupCanvasGeometry(page, 'workspace-root-a')).toEqual({
    x: 96,
    y: 104,
    width: 820,
    height: 620
  });
  const afterReselectProbe = await requestWebviewProbe(page);
  expect(afterReselectProbe.groups.find((group) => group.groupId === 'workspace-root-a')).toMatchObject({
    selected: true,
    left: 96,
    top: 104,
    width: 820,
    height: 620
  });
  expect(await readPostedMessagesByType(page, 'webview/moveGroup')).toEqual([]);
  expect(await readPostedMessagesByType(page, 'webview/resizeGroup')).toEqual([]);
});

test('workspace root group selected title chrome keeps nodes inside body while zoomed out', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedGroupId: 'workspace-root-a',
      selectedGroupIds: ['workspace-root-a', 'group-regular'],
      viewport: { x: 0, y: 0, zoom: 0.25 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('root-note', { x: 200, y: 200 }),
      groupId: 'workspace-root-a'
    },
    createManualNoteNode('distant-note', { x: 9000, y: 200 })
  ];
  state.groups = [
    {
      id: 'workspace-root-a',
      title: 'Frontend Root',
      position: { x: 120, y: 120 },
      size: { width: 760, height: 560 },
      role: 'workspace-root',
      workspaceRootPath: '/repo/frontend'
    },
    {
      id: 'group-regular',
      title: 'Frontend Root',
      position: { x: 1120, y: 120 },
      size: { width: 760, height: 560 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const rootFrame = page.locator('[data-group-id="workspace-root-a"]');
  const regularFrame = page.locator('[data-group-id="group-regular"]');
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupIds ?? [])
    .toEqual(['workspace-root-a', 'group-regular']);
  await expect(rootFrame.locator('.canvas-group-resize-control')).toHaveCount(8);
  await expect(rootFrame.locator('.canvas-group-toolbar')).toHaveCount(0);

  const layout = await rootFrame.evaluate((frame) => {
    const regularFrame = document.querySelector('[data-group-id="group-regular"]');
    const rootNode = document.querySelector('[data-node-id="root-note"]');
    const rootBackground = document.querySelector('[data-group-background-id="workspace-root-a"]');
    const rootTitlebar = frame.querySelector('.canvas-group-titlebar');
    const regularTitlebar = regularFrame?.querySelector('.canvas-group-titlebar');
    if (
      !(rootNode instanceof HTMLElement) ||
      !(rootBackground instanceof HTMLElement) ||
      !(rootTitlebar instanceof HTMLElement) ||
      !(regularTitlebar instanceof HTMLElement)
    ) {
      throw new Error('Workspace root selected chrome not found.');
    }

    const frameRect = frame.getBoundingClientRect();
    const nodeRect = rootNode.getBoundingClientRect();
    const titlebarRect = rootTitlebar.getBoundingClientRect();
    const regularTitlebarRect = regularTitlebar.getBoundingClientRect();
    const frameScale = frameRect.height / frame.offsetHeight;
    const bodyTopOffset = Number.parseFloat(getComputedStyle(rootBackground).getPropertyValue('--canvas-group-body-top')) * frameScale;
    return {
      nodeTopOffsetFromFrame: Math.round(nodeRect.top - frameRect.top),
      bodyTopOffsetFromFrame: bodyTopOffset,
      titlebarTopOffsetFromFrame: titlebarRect.top - frameRect.top,
      titlebarBottomOffsetFromFrame: titlebarRect.bottom - frameRect.top,
      rootTitlebarHeight: titlebarRect.height,
      regularTitlebarHeight: regularTitlebarRect.height
    };
  });
  expect(layout.nodeTopOffsetFromFrame).toBeGreaterThanOrEqual(layout.bodyTopOffsetFromFrame - 1);
  expect(layout.bodyTopOffsetFromFrame).toBeCloseTo(11.2, 1);
  expect(Math.abs(layout.titlebarBottomOffsetFromFrame - layout.bodyTopOffsetFromFrame)).toBeLessThanOrEqual(2);
  expect(layout.titlebarTopOffsetFromFrame).toBeLessThan(0);
  expect(layout.rootTitlebarHeight).toBeCloseTo(layout.regularTitlebarHeight, 1);

  await clearPostedMessages(page);
  const handle = rootFrame.locator('[data-group-resize-direction="top-left"]');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + handleBox.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  const message = await waitForPostedMessageByType(page, 'webview/resizeGroup');
  expect(message.payload.groupId).toBe('workspace-root-a');
  const resizedRootMember = state.nodes[0];
  const repairedRootPosition = {
    x: Math.min(message.payload.position.x, resizedRootMember.position.x - 80),
    y: Math.min(message.payload.position.y, resizedRootMember.position.y - 80)
  };
  const repairedRootRight = Math.max(
    message.payload.position.x + message.payload.size.width,
    resizedRootMember.position.x + resizedRootMember.size.width + 80
  );
  const repairedRootBottom = Math.max(
    message.payload.position.y + message.payload.size.height,
    resizedRootMember.position.y + resizedRootMember.size.height + 80
  );
  state.groups[0] = {
    ...state.groups[0],
    position: repairedRootPosition,
    size: {
      width: repairedRootRight - repairedRootPosition.x,
      height: repairedRootBottom - repairedRootPosition.y
    }
  };
  await updateHostState(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const afterResize = await rootFrame.evaluate((frame) => {
    const rootNode = document.querySelector('[data-node-id="root-note"]');
    const rootBackground = document.querySelector('[data-group-background-id="workspace-root-a"]');
    if (!(rootNode instanceof HTMLElement) || !(rootBackground instanceof HTMLElement)) {
      throw new Error('Workspace root selected chrome not found after resize.');
    }
    const frameRect = frame.getBoundingClientRect();
    const nodeRect = rootNode.getBoundingClientRect();
    const titlebar = frame.querySelector('.canvas-group-titlebar');
    if (!(titlebar instanceof HTMLElement)) {
      throw new Error('Workspace root titlebar not found after resize.');
    }
    const titlebarRect = titlebar.getBoundingClientRect();
    const frameScale = frameRect.height / frame.offsetHeight;
    const bodyTopOffset = Number.parseFloat(getComputedStyle(rootBackground).getPropertyValue('--canvas-group-body-top')) * frameScale;
    return {
      nodeTopOffsetFromFrame: Math.round(nodeRect.top - frameRect.top),
      bodyTopOffsetFromFrame: bodyTopOffset,
      titlebarBottomOffsetFromFrame: titlebarRect.bottom - frameRect.top
    };
  });
  expect(afterResize.nodeTopOffsetFromFrame).toBeGreaterThanOrEqual(afterResize.bodyTopOffsetFromFrame - 1);
  expect(Math.abs(afterResize.titlebarBottomOffsetFromFrame - afterResize.bodyTopOffsetFromFrame)).toBeLessThanOrEqual(2);
});

test('canvas groups do not create document scrollbars when zoomed in', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 520 });
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1.8 }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'group-1',
      title: 'Zoomed Group',
      position: { x: 120, y: 120 },
      size: { width: 520, height: 420 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const overflowSnapshot = await page.locator('[data-group-id="group-1"]').evaluate((frame) => {
    const shell = document.querySelector('.canvas-shell');
    const reactFlow = document.querySelector('.react-flow');
    const renderer = document.querySelector('.react-flow__renderer');
    const pane = document.querySelector('.react-flow__pane');
    if (
      !(shell instanceof HTMLElement) ||
      !(reactFlow instanceof HTMLElement) ||
      !(renderer instanceof HTMLElement) ||
      !(pane instanceof HTMLElement)
    ) {
      throw new Error('Canvas shell or React Flow layers not found.');
    }
    const documentElement = document.documentElement;
    const reactFlowStyles = getComputedStyle(reactFlow);
    const rendererStyles = getComputedStyle(renderer);
    const paneStyles = getComputedStyle(pane);
    return {
      documentScrollWidth: documentElement.scrollWidth,
      documentScrollHeight: documentElement.scrollHeight,
      documentClientWidth: documentElement.clientWidth,
      documentClientHeight: documentElement.clientHeight,
      shellScrollWidth: shell.scrollWidth,
      shellScrollHeight: shell.scrollHeight,
      shellClientWidth: shell.clientWidth,
      shellClientHeight: shell.clientHeight,
      reactFlowOverflow: reactFlowStyles.overflow,
      rendererOverflow: rendererStyles.overflow,
      paneOverflow: paneStyles.overflow,
      frameSharesRendererWithPane: frame.closest('.react-flow__renderer') === pane.closest('.react-flow__renderer')
    };
  });

  expect(overflowSnapshot.documentScrollWidth).toBe(overflowSnapshot.documentClientWidth);
  expect(overflowSnapshot.documentScrollHeight).toBe(overflowSnapshot.documentClientHeight);
  expect(overflowSnapshot.shellScrollWidth).toBe(overflowSnapshot.shellClientWidth);
  expect(overflowSnapshot.shellScrollHeight).toBe(overflowSnapshot.shellClientHeight);
  expect(overflowSnapshot.reactFlowOverflow).toBe('hidden');
  expect(overflowSnapshot.rendererOverflow).toBe('hidden');
  expect(overflowSnapshot.paneOverflow).toBe('hidden');
  expect(overflowSnapshot.frameSharesRendererWithPane).toBe(true);
});

test('canvas group drag follows the pointer without panning the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1.8 }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'group-1',
      title: 'Drag Group',
      position: { x: 120, y: 120 },
      size: { width: 320, height: 220 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const groupFrame = page.locator('[data-group-id="group-1"]');
  const beforeBox = await groupFrame.boundingBox();
  expect(beforeBox).not.toBeNull();
  const beforeTransform = await readCanvasViewportTransform(page);
  const dragDelta = { x: 90, y: 54 };
  const startPoint = {
    x: beforeBox.x + 4,
    y: beforeBox.y + beforeBox.height / 2
  };

  await clearPostedMessages(page);
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(startPoint.x + dragDelta.x, startPoint.y + dragDelta.y, { steps: 4 });
  await settleWebview(page, 2);

  const draftBox = await groupFrame.boundingBox();
  expect(draftBox).not.toBeNull();
  expect(Math.abs(draftBox.x - beforeBox.x - dragDelta.x)).toBeLessThanOrEqual(5);
  expect(Math.abs(draftBox.y - beforeBox.y - dragDelta.y)).toBeLessThanOrEqual(5);
  expect(await readCanvasViewportTransform(page)).toBe(beforeTransform);

  await page.mouse.up();
  const message = await waitForPostedMessageByType(page, 'webview/moveGroup');
  expect(message.payload.groupId).toBe('group-1');
  expect(message.payload.position).toEqual({ x: 170, y: 150 });
  expect(await readCanvasViewportTransform(page)).toBe(beforeTransform);
});

test('canvas group body drag pans the canvas instead of moving the group', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openHarness(page, {
    persistedState: {
      selectedGroupId: 'group-1',
      selectedGroupIds: ['group-1'],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'group-1',
      title: 'Pan Body Group',
      position: { x: 120, y: 120 },
      size: { width: 620, height: 500 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const groupFrame = page.locator('[data-group-id="group-1"]');
  const beforeBox = await groupFrame.boundingBox();
  expect(beforeBox).not.toBeNull();
  const beforeViewport = await readCanvasViewport(page);
  expect(beforeViewport).toEqual({ x: 0, y: 0, zoom: 1 });
  const startPoint = {
    x: beforeBox.x + beforeBox.width - 48,
    y: beforeBox.y + beforeBox.height - 44
  };

  await clearPostedMessages(page);
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(startPoint.x + 96, startPoint.y + 72, { steps: 6 });
  await settleWebview(page, 2);
  await page.mouse.up();
  await settleWebview(page, 2);

  const afterViewport = await readCanvasViewport(page);
  expect(afterViewport.zoom).toBe(beforeViewport.zoom);
  expect(afterViewport.x).toBeLessThan(beforeViewport.x - 40);
  expect(afterViewport.y).toBeLessThan(beforeViewport.y - 30);
  const afterBox = await groupFrame.boundingBox();
  expect(afterBox).not.toBeNull();
  expect(Math.abs(afterBox.x - beforeBox.x - (afterViewport.x - beforeViewport.x))).toBeLessThanOrEqual(6);
  expect(Math.abs(afterBox.y - beforeBox.y - (afterViewport.y - beforeViewport.y))).toBeLessThanOrEqual(6);
  expect(await readPostedMessagesByType(page, 'webview/moveGroup')).toEqual([]);
});

test('canvas context menu can create an empty group', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createEmptyCanvasState());

  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 260, y: 220 } });
  await expect(page.locator('[data-context-menu-action="create-empty-group"] .codicon-symbol-array')).toBeVisible();
  await page.locator('[data-context-menu-action="create-empty-group"]').click();
  const message = await waitForPostedMessageByType(page, 'webview/createEmptyGroup');
  expect(message.payload.size).toEqual({ width: 360, height: 240 });
  expect(typeof message.payload.position.x).toBe('number');
  expect(typeof message.payload.position.y).toBe('number');
});

test('canvas group body blank area selects the group and preserves right-click menu', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('note-1', { x: 160, y: 180 }),
      groupId: 'group-1'
    }
  ];
  state.groups = [
    {
      id: 'group-1',
      title: 'Group 1',
      position: { x: 120, y: 120 },
      size: { width: 620, height: 500 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  const groupFrame = page.locator('[data-group-id="group-1"]');
  await expect(groupFrame.locator('.canvas-group-split-primary')).toHaveCount(0);

  await page.mouse.click(690, 580);
  await expect(groupFrame.locator('.canvas-group-split-primary')).toBeVisible();
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupId)
    .toBe('group-1');
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedNodeId ?? null)
    .toBeNull();

  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 30 } });
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupId ?? null)
    .toBeNull();

  await page.mouse.click(690, 580, { button: 'right' });
  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.canvas-context-menu-header-copy')).toContainText('画布操作');
  await expect(menu.locator('[data-context-menu-action="create-empty-group"]')).toBeVisible();
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupId)
    .toBe('group-1');
});

test('canvas group body context menu creates objects inside the group', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'group-1',
      title: 'Group 1',
      position: { x: 120, y: 120 },
      size: { width: 720, height: 620 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  await page.mouse.click(520, 500, { button: 'right' });
  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-menu-kind="note"]').click();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'note',
    preferredPosition: {
      x: 330,
      y: 300
    },
    targetGroupId: 'group-1'
  });

  await clearPostedMessages(page);
  await page.mouse.click(520, 500, { button: 'right' });
  await page.locator('[data-context-menu-action="create-empty-group"]').click();
  const createGroupMessage = await waitForPostedMessageByType(page, 'webview/createEmptyGroup');
  expect(createGroupMessage.payload).toEqual({
    position: { x: 520, y: 500 },
    size: { width: 360, height: 240 },
    parentGroupId: 'group-1'
  });
});

test('canvas group body context menu keeps target group after pan and zoom', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 100, y: 80, zoom: 0.8 }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'group-1',
      title: 'Group 1',
      position: { x: 240, y: 240 },
      size: { width: 720, height: 620 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  await page.mouse.click(660, 420, { button: 'right' });
  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-menu-kind="note"]').click();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'note',
    preferredPosition: {
      x: 510,
      y: 225
    },
    targetGroupId: 'group-1'
  });
});

test('canvas group body context menu can group selected members inside that group', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('note-1', { x: 180, y: 220 }),
      groupId: 'group-1'
    },
    {
      ...createManualNoteNode('note-2', { x: 460, y: 220 }),
      groupId: 'group-1'
    }
  ];
  state.groups = [
    {
      id: 'group-1',
      title: 'Group 1',
      position: { x: 120, y: 120 },
      size: { width: 820, height: 620 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  await page.keyboard.down(PRIMARY_ACCELERATOR_KEY);
  await nodeById(page, 'note-1').click();
  await nodeById(page, 'note-2').click();
  await page.keyboard.up(PRIMARY_ACCELERATOR_KEY);
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedNodeIds)
    .toEqual(['note-1', 'note-2']);

  await page.mouse.click(880, 680, { button: 'right' });
  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu.locator('[data-context-menu-action="create-group-from-selection"]')).toBeVisible();
  await menu.locator('[data-context-menu-action="create-group-from-selection"]').click();
  const message = await waitForPostedMessageByType(page, 'webview/createGroupFromSelection');
  expect(message.payload).toEqual({
    nodeIds: ['note-1', 'note-2'],
    groupIds: [],
    parentGroupId: 'group-1'
  });
});

test('canvas context menu can create a group from selected peer groups', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.groups = [
    {
      id: 'group-a',
      title: 'Group A',
      position: { x: 120, y: 120 },
      size: { width: 220, height: 180 }
    },
    {
      id: 'group-b',
      title: 'Group B',
      position: { x: 420, y: 120 },
      size: { width: 220, height: 180 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  await page.keyboard.down(PRIMARY_ACCELERATOR_KEY);
  await page.locator('[data-group-id="group-a"] .canvas-group-titlebar').click({ position: { x: 12, y: 14 } });
  await page.locator('[data-group-id="group-b"] .canvas-group-titlebar').click({ position: { x: 12, y: 14 } });
  await page.keyboard.up(PRIMARY_ACCELERATOR_KEY);
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupIds)
    .toEqual(['group-a', 'group-b']);

  await page.keyboard.down(PRIMARY_ACCELERATOR_KEY);
  await page.locator('[data-group-id="group-a"] .canvas-group-titlebar').click({ position: { x: 12, y: 14 } });
  await page.keyboard.up(PRIMARY_ACCELERATOR_KEY);
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupIds)
    .toEqual(['group-b']);

  await page.keyboard.down(PRIMARY_ACCELERATOR_KEY);
  await page.locator('[data-group-id="group-a"] .canvas-group-titlebar').click({ position: { x: 12, y: 14 } });
  await page.keyboard.up(PRIMARY_ACCELERATOR_KEY);
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedGroupIds)
    .toEqual(['group-b', 'group-a']);

  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 80, y: 520 } });
  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu.locator('[data-context-menu-action="create-group-from-selection"]')).toBeVisible();
  await menu.locator('[data-context-menu-action="create-group-from-selection"]').click();
  const message = await waitForPostedMessageByType(page, 'webview/createGroupFromSelection');
  expect(message.payload).toEqual({
    nodeIds: [],
    groupIds: ['group-b', 'group-a']
  });
});

test('canvas groups resize from all eight directions', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-05-23T00:00:00.000Z',
    nodes: [],
    groups: [
      {
        id: 'group-1',
        title: 'Group 1',
        position: { x: 240, y: 220 },
        size: { width: 320, height: 220 }
      }
    ],
    edges: []
  });

  const groupFrame = page.locator('[data-group-id="group-1"]');
  await expect(groupFrame.locator('.canvas-group-resize-control')).toHaveCount(0);
  await groupFrame.locator('.canvas-group-titlebar').click();
  await expect(groupFrame.locator('.canvas-group-resize-line')).toHaveCount(4);
  await expect(groupFrame.locator('.canvas-group-resize-control')).toHaveCount(8);

  const resizeAffordanceStyles = await groupFrame.evaluate((frame) => {
    const topLine = frame.querySelector('.canvas-group-resize-line-top');
    const topControl = frame.querySelector('[data-group-resize-direction="top"]');
    const cornerControl = frame.querySelector('[data-group-resize-direction="bottom-right"]');
    if (!(topLine instanceof HTMLElement) || !(topControl instanceof HTMLElement) || !(cornerControl instanceof HTMLElement)) {
      throw new Error('Group resize affordance not found.');
    }
    const topLineStyles = getComputedStyle(topLine);
    const topControlAfterStyles = getComputedStyle(topControl, '::after');
    const cornerControlStyles = getComputedStyle(cornerControl);
    const cornerControlAfterStyles = getComputedStyle(cornerControl, '::after');
    return {
      topLineBorderTopWidth: topLineStyles.borderTopWidth,
      topLineBorderTopColor: topLineStyles.borderTopColor,
      topControlBackground: getComputedStyle(topControl).backgroundColor,
      topControlAfterDisplay: topControlAfterStyles.display,
      cornerControlBorderTopWidth: cornerControlStyles.borderTopWidth,
      cornerControlBackground: cornerControlStyles.backgroundColor,
      cornerControlAfterDisplay: cornerControlAfterStyles.display,
      cornerControlAfterBorderRadius: cornerControlAfterStyles.borderRadius,
      cornerControlAfterBackground: cornerControlAfterStyles.backgroundColor
    };
  });
  expect(resizeAffordanceStyles.topLineBorderTopWidth).toBe('2px');
  expect(resizeAffordanceStyles.topLineBorderTopColor).toBe('rgb(69, 69, 69)');
  expect(resizeAffordanceStyles.topControlBackground).toBe('rgba(0, 0, 0, 0)');
  expect(resizeAffordanceStyles.topControlAfterDisplay).toBe('none');
  expect(resizeAffordanceStyles.cornerControlBorderTopWidth).toBe('0px');
  expect(resizeAffordanceStyles.cornerControlBackground).toBe('rgba(0, 0, 0, 0)');
  expect(resizeAffordanceStyles.cornerControlAfterDisplay).not.toBe('none');
  expect(Number.parseFloat(resizeAffordanceStyles.cornerControlAfterBorderRadius)).toBeGreaterThanOrEqual(999);
  expect(resizeAffordanceStyles.cornerControlAfterBackground).toBe('rgb(69, 69, 69)');

  const dragResizeHandle = async (direction, deltaX, deltaY) => {
    await clearPostedMessages(page);
    const handle = groupFrame.locator(`[data-group-resize-direction="${direction}"]`);
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + deltaX, handleBox.y + handleBox.height / 2 + deltaY, { steps: 4 });
    await page.mouse.up();
    const message = await waitForPostedMessageByType(page, 'webview/resizeGroup');
    expect(message.payload.groupId).toBe('group-1');
    return message.payload;
  };

  expect(await dragResizeHandle('right', 40, 0)).toMatchObject({
    position: { x: 240, y: 220 },
    size: { width: 360, height: 220 }
  });
  expect(await dragResizeHandle('bottom', 0, 40)).toMatchObject({
    position: { x: 240, y: 220 },
    size: { width: 320, height: 260 }
  });
  expect(await dragResizeHandle('left', -40, 0)).toMatchObject({
    position: { x: 200, y: 220 },
    size: { width: 360, height: 220 }
  });
  expect(await dragResizeHandle('top', 0, -40)).toMatchObject({
    position: { x: 240, y: 180 },
    size: { width: 320, height: 260 }
  });
  expect(await dragResizeHandle('top-left', -40, -30)).toMatchObject({
    position: { x: 200, y: 190 },
    size: { width: 360, height: 250 }
  });
  expect(await dragResizeHandle('top-right', 40, -30)).toMatchObject({
    position: { x: 240, y: 190 },
    size: { width: 360, height: 250 }
  });
  expect(await dragResizeHandle('bottom-left', -40, 30)).toMatchObject({
    position: { x: 200, y: 220 },
    size: { width: 360, height: 250 }
  });
  expect(await dragResizeHandle('bottom-right', 40, 30)).toMatchObject({
    position: { x: 240, y: 220 },
    size: { width: 360, height: 250 }
  });
});

test('canvas zoom keeps group title chrome outside the body boundary', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedGroupId: 'group-1',
      selectedGroupIds: ['group-1'],
      // Keep the top-left resize handle away from the viewport edge so this isolates resize from auto-pan.
      viewport: { x: 120, y: 120, zoom: 0.25 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('note-1', { x: 148, y: 148 }),
      size: { width: 220, height: 180 },
      groupId: 'group-1'
    }
  ];
  state.groups = [
    {
      id: 'group-1',
      title: 'Readable Planning Group',
      position: { x: 120, y: 120 },
      size: { width: 520, height: 360 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());
  await settleWebview(page, 2);

  const groupFrame = page.locator('[data-group-id="group-1"]');
  const noteNode = nodeById(page, 'note-1');
  const layout = await groupFrame.evaluate((frame) => {
    const titlebar = frame.querySelector('.canvas-group-titlebar');
    const background = document.querySelector('[data-group-background-id="group-1"]');
    const note = document.querySelector('[data-node-id="note-1"]');
    if (!(titlebar instanceof HTMLElement) || !(background instanceof HTMLElement) || !(note instanceof HTMLElement)) {
      throw new Error('Group body boundary chrome not found.');
    }

    const frameRect = frame.getBoundingClientRect();
    const titlebarRect = titlebar.getBoundingClientRect();
    const noteRect = note.getBoundingClientRect();
    const bodyTop = Number.parseFloat(getComputedStyle(background).getPropertyValue('--canvas-group-body-top')) * (frameRect.height / frame.offsetHeight);
    return {
      bodyTop,
      titlebarTop: titlebarRect.top - frameRect.top,
      titlebarBottom: titlebarRect.bottom - frameRect.top,
      titlebarHeight: titlebarRect.height,
      noteTop: noteRect.top - frameRect.top
    };
  });
  expect(layout.bodyTop).toBeCloseTo(11.2, 1);
  expect(layout.titlebarHeight).toBeGreaterThan(layout.bodyTop);
  expect(layout.titlebarTop).toBeLessThan(0);
  expect(layout.titlebarBottom).toBeCloseTo(layout.bodyTop, -1);
  expect(layout.noteTop).toBeGreaterThanOrEqual(layout.bodyTop - 1);
  const viewportScale = await readCanvasViewportScale(page);
  expect(viewportScale).not.toBeNull();

  const initialNoteBox = await noteNode.boundingBox();
  expect(initialNoteBox).not.toBeNull();
  await clearPostedMessages(page);
  const handle = groupFrame.locator('[data-group-resize-direction="top-left"]');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 - 40, handleBox.y + handleBox.height / 2 - 40, { steps: 4 });
  await settleWebview(page, 2);
  const draftNoteBox = await noteNode.boundingBox();
  expect(draftNoteBox).not.toBeNull();
  expectBoxEdgesClose(draftNoteBox, initialNoteBox);
  await page.mouse.up();
  const message = await waitForPostedMessageByType(page, 'webview/resizeGroup');
  const expectedResizeDelta = Math.round(40 / viewportScale);
  expect(message.payload).toMatchObject({
    groupId: 'group-1',
    position: { x: 120 - expectedResizeDelta, y: 120 - expectedResizeDelta },
    size: { width: 520 + expectedResizeDelta, height: 360 + expectedResizeDelta }
  });
});

test('canvas group border stroke stays screen-stable across zoom levels', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 0.5 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-05-26T00:00:00.000Z',
    nodes: [],
    groups: [
      {
        id: 'group-1',
        title: 'Group 1',
        position: { x: 240, y: 220 },
        size: { width: 320, height: 220 }
      }
    ],
    edges: []
  });
  await settleWebview(page, 2);

  const groupFrame = page.locator('[data-group-id="group-1"]');
  const groupBackground = page.locator('[data-group-background-id="group-1"]');
  await expect(groupBackground).toBeVisible();
  await groupFrame.locator('.canvas-group-titlebar').click();
  await expect(groupFrame.locator('.canvas-group-resize-line')).toHaveCount(4);

  const zoomedChrome = await groupFrame.evaluate((frame) => {
    const background = document.querySelector('[data-group-background-id="group-1"]');
    const line = frame.querySelector('.canvas-group-resize-line-top');
    if (!(background instanceof HTMLElement) || !(line instanceof HTMLElement)) {
      throw new Error('Group chrome not found.');
    }
    const backgroundStyles = getComputedStyle(background);
    const frameStyles = getComputedStyle(frame);
    const lineStyles = getComputedStyle(line);
    const viewport = document.querySelector('.react-flow__viewport');
    return {
      viewportTransform: viewport instanceof HTMLElement ? viewport.style.transform : '',
      backgroundBeforeBorderTopWidth: getComputedStyle(background, '::before').borderTopWidth,
      backgroundAfterBorderBottomWidth: getComputedStyle(background, '::after').borderBottomWidth,
      frameBorderTopWidth: frameStyles.borderTopWidth,
      selectedLineBorderTopWidth: lineStyles.borderTopWidth
    };
  });
  expect(zoomedChrome.viewportTransform).toContain('scale(0.5)');
  expect(Number.parseFloat(zoomedChrome.backgroundBeforeBorderTopWidth)).toBeCloseTo(2, 1);
  expect(Number.parseFloat(zoomedChrome.backgroundAfterBorderBottomWidth)).toBeCloseTo(2, 1);
  expect(Number.parseFloat(zoomedChrome.frameBorderTopWidth)).toBeCloseTo(2, 1);
  expect(Number.parseFloat(zoomedChrome.selectedLineBorderTopWidth)).toBeCloseTo(4, 1);
});

test('canvas group title and action buttons only counter-scale while zooming out', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 0.5 }
    }
  });
  await applyWorkbenchTheme(page, 'dark');
  await bootstrap(page, {
    version: 1,
    updatedAt: '2026-05-26T00:00:00.000Z',
    nodes: [],
    groups: [
      {
        id: 'group-1',
        title: 'Long Planning Group Title',
        position: { x: 240, y: 220 },
        size: { width: 360, height: 160 }
      },
      {
        id: 'group-2',
        title: 'Group 2',
        position: { x: 520, y: 220 },
        size: { width: 1000, height: 180 }
      }
    ],
    edges: []
  });
  await settleWebview(page, 2);

  const readGroupChromeLayout = async (groupId) => {
    const groupFrame = page.locator('[data-group-id="' + groupId + '"]');
    await groupFrame.locator('.canvas-group-titlebar').click();
    await expect(groupFrame.locator('.canvas-group-toolbar')).toBeVisible();
    return groupFrame.evaluate((frame, targetGroupId) => {
      const background = document.querySelector('[data-group-background-id="' + targetGroupId + '"]');
      const titlebar = frame.querySelector('.canvas-group-titlebar');
      const titleInput = frame.querySelector('.canvas-group-title .window-title-input');
      const toolbar = frame.querySelector('.canvas-group-toolbar');
      const primaryButton = frame.querySelector('.canvas-group-split-primary');
      const dangerButton = frame.querySelector('.canvas-group-split-danger');
      if (
        !(background instanceof HTMLElement) ||
        !(titlebar instanceof HTMLElement) ||
        !(titleInput instanceof HTMLElement) ||
        !(toolbar instanceof HTMLElement) ||
        !(primaryButton instanceof HTMLElement) ||
        !(dangerButton instanceof HTMLElement)
      ) {
        throw new Error('Group readable chrome not found.');
      }
      const frameRect = frame.getBoundingClientRect();
      const titlebarRect = titlebar.getBoundingClientRect();
      const titleInputRect = titleInput.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const primaryRect = primaryButton.getBoundingClientRect();
      const dangerRect = dangerButton.getBoundingClientRect();
      const titleStyles = getComputedStyle(titlebar);
      const inputStyles = getComputedStyle(titlebar.querySelector('.window-title-input'));
      const buttonStyles = getComputedStyle(primaryButton);
      return {
        frameWidth: frameRect.width,
        bodyTopOffset: Number.parseFloat(getComputedStyle(background).getPropertyValue('--canvas-group-body-top')) * (frameRect.height / frame.offsetHeight),
        titlebarTop: titlebarRect.top - frameRect.top,
        titlebarWidth: titlebarRect.width,
        titleInputWidth: titleInputRect.width,
        toolbarWidth: toolbarRect.width,
        titlebarHeight: titlebarRect.height,
        toolbarHeight: toolbarRect.height,
        titlebarRight: titlebarRect.right - frameRect.left,
        toolbarLeft: toolbarRect.left - frameRect.left,
        toolbarRight: toolbarRect.right - frameRect.left,
        titleFontSize: Number.parseFloat(inputStyles.fontSize),
        buttonFontSize: Number.parseFloat(buttonStyles.fontSize),
        titlePaddingLeft: Number.parseFloat(titleStyles.paddingLeft),
        buttonPaddingLeft: Number.parseFloat(buttonStyles.paddingLeft),
        primaryButtonWidth: primaryRect.width,
        dangerButtonWidth: dangerRect.width
      };
    }, groupId);
  };

  const narrowLayout = await readGroupChromeLayout('group-1');
  expect(narrowLayout.titlebarHeight).toBeGreaterThan(14);
  expect(narrowLayout.titlebarHeight).toBeLessThan(28);
  expect(narrowLayout.titlebarTop + narrowLayout.titlebarHeight).toBeCloseTo(narrowLayout.bodyTopOffset, -1);
  expect(narrowLayout.toolbarHeight).toBeLessThanOrEqual(narrowLayout.titlebarHeight + 2);
  expect(narrowLayout.titlebarRight).toBeCloseTo(narrowLayout.toolbarLeft, 1);
  expect(narrowLayout.toolbarRight).toBeLessThanOrEqual(narrowLayout.frameWidth + 1);
  expect(narrowLayout.titlebarWidth + narrowLayout.toolbarWidth).toBeGreaterThanOrEqual(narrowLayout.frameWidth - 1);
  expect(narrowLayout.primaryButtonWidth).toBeGreaterThan(0);
  expect(narrowLayout.dangerButtonWidth).toBeGreaterThan(0);

  const wideLayout = await readGroupChromeLayout('group-2');
  expect(wideLayout.titlebarHeight).toBeCloseTo(28, 1);
  expect(wideLayout.titlebarTop).toBeLessThan(0);
  expect(wideLayout.titlebarTop + wideLayout.titlebarHeight).toBeCloseTo(wideLayout.bodyTopOffset, -1);
  expect(wideLayout.titleFontSize * 0.5).toBeCloseTo(12, 1);
  expect(wideLayout.buttonFontSize * 0.5).toBeCloseTo(11, 1);
  expect(wideLayout.titlePaddingLeft * 0.5).toBeCloseTo(12, 1);
  expect(wideLayout.buttonPaddingLeft * 0.5).toBeCloseTo(8, 1);
  expect(wideLayout.titlebarRight).toBeCloseTo(wideLayout.toolbarLeft, 1);
  expect(wideLayout.toolbarRight).toBeLessThan(wideLayout.frameWidth - 200);
  expect(wideLayout.toolbarWidth).toBeGreaterThan(130);
  expect(wideLayout.toolbarWidth).toBeLessThan(300);
  expect(wideLayout.titlebarWidth + wideLayout.toolbarWidth).toBeLessThan(wideLayout.frameWidth);
  expect(wideLayout.titleInputWidth).toBeGreaterThan(70);

  const zoomedInScale = await page.evaluate(() => {
    const frame = document.createElement('div');
    frame.style.position = 'absolute';
    frame.style.left = '-10000px';
    frame.style.top = '-10000px';
    frame.style.width = '1000px';
    frame.style.height = '180px';
    frame.style.setProperty('--canvas-group-title-height', '28px');
    document.body.append(frame);
    const titlebar = document.createElement('div');
    titlebar.className = 'canvas-group-titlebar';
    titlebar.style.transform = 'scale(1.5)';
    frame.append(titlebar);
    const result = titlebar.getBoundingClientRect().height / 28;
    frame.remove();
    return result;
  });
  expect(zoomedInScale).toBeCloseTo(1.5, 1);
});

test('node resize auto-pans at the canvas edge and keeps resizing', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 520 });
  await openHarness(page, {
    persistedState: {
      selectedNodeId: 'note-1',
      selectedNodeIds: ['note-1'],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [createManualNoteNode('note-1', { x: 10, y: 20 })];
  await bootstrap(page, state, createRuntimeContext());
  await expect(nodeById(page, 'note-1').locator('[data-node-resize-direction="bottom-right"]')).toBeVisible();
  await clearPostedMessages(page);

  const beforePersistedState = await readPersistedUiState(page);
  expect(beforePersistedState.viewport).toEqual({ x: 0, y: 0, zoom: 1 });

  const handle = nodeById(page, 'note-1').locator('[data-node-resize-direction="bottom-right"]');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(636, 516, { steps: 8 });
  await settleWebview(page, 12);
  await page.mouse.up();

  const message = await waitForPostedMessageByType(page, 'webview/resizeNode');
  expect(message.payload.nodeId).toBe('note-1');
  expect(message.payload.position).toEqual({ x: 10, y: 20 });
  expect(message.payload.size.width).toBeGreaterThan(450);
  expect(message.payload.size.height).toBeGreaterThan(460);

  await expect
    .poll(async () => (await readPersistedUiState(page)).viewport?.x ?? 0)
    .toBeLessThan(0);
  const afterPersistedState = await readPersistedUiState(page);
  expect(afterPersistedState.viewport.y).toBeLessThan(0);
});

test('canvas group resize draft keeps member nodes stationary until release', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('note-1', { x: 260, y: 260 }),
      groupId: 'group-1'
    }
  ];
  state.groups = [
    {
      id: 'group-1',
      title: 'Group 1',
      position: { x: 240, y: 220 },
      size: { width: 520, height: 480 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  const groupFrame = page.locator('[data-group-id="group-1"]');
  const noteNode = nodeById(page, 'note-1');
  const initialNoteBox = await noteNode.boundingBox();
  expect(initialNoteBox).not.toBeNull();

  await groupFrame.locator('.canvas-group-titlebar').click();
  await clearPostedMessages(page);
  const handle = groupFrame.locator('[data-group-resize-direction="top-left"]');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 - 60, handleBox.y + handleBox.height / 2 - 40, { steps: 4 });
  await settleWebview(page, 2);
  const draftNoteBox = await noteNode.boundingBox();
  expect(draftNoteBox).not.toBeNull();
  expectBoxEdgesClose(draftNoteBox, initialNoteBox);

  await page.mouse.up();
  const message = await waitForPostedMessageByType(page, 'webview/resizeGroup');
  expect(message.payload.groupId).toBe('group-1');
  expect(message.payload.position.x).toBeLessThan(240);
  expect(message.payload.position.y).toBeLessThan(220);
  expect(message.payload.size.width).toBeGreaterThan(520);
  expect(message.payload.size.height).toBeGreaterThan(480);
});

test('canvas group resize auto-pans at the canvas edge and keeps member drafts stationary', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 520 });
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('note-1', { x: 170, y: 120 }),
      size: { width: 280, height: 260 },
      groupId: 'group-1'
    }
  ];
  state.groups = [
    {
      id: 'group-1',
      title: 'Group 1',
      position: { x: 150, y: 80 },
      size: { width: 200, height: 220 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  const groupFrame = page.locator('[data-group-id="group-1"]');
  const noteNode = nodeById(page, 'note-1');
  const initialNoteStyle = await noteNode.evaluate((element) => {
    const wrapper = element.closest('.react-flow__node');
    return wrapper instanceof HTMLElement ? wrapper.getAttribute('style') : null;
  });
  expect(initialNoteStyle).not.toBeNull();
  await groupFrame.locator('.canvas-group-titlebar').click();
  await clearPostedMessages(page);

  const handle = groupFrame.locator('[data-group-resize-direction="bottom-right"]');
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(636, 516, { steps: 8 });
  await settleWebview(page, 12);
  const draftNoteStyle = await noteNode.evaluate((element) => {
    const wrapper = element.closest('.react-flow__node');
    return wrapper instanceof HTMLElement ? wrapper.getAttribute('style') : null;
  });
  expect(draftNoteStyle).toBe(initialNoteStyle);
  await page.mouse.up();

  const message = await waitForPostedMessageByType(page, 'webview/resizeGroup');
  expect(message.payload.groupId).toBe('group-1');
  expect(message.payload.position).toEqual({ x: 150, y: 80 });
  expect(message.payload.size.width).toBeGreaterThan(400);
  expect(message.payload.size.height).toBeGreaterThan(420);

  await expect
    .poll(async () => (await readPersistedUiState(page)).viewport?.x ?? 0)
    .toBeLessThan(0);
  const afterPersistedState = await readPersistedUiState(page);
  expect(afterPersistedState.viewport.y).toBeLessThan(0);
});

test('selected nodes move together and share the primary release intent', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedNodeId: 'note-2',
      selectedNodeIds: ['note-1', 'note-2'],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    createManualNoteNode('note-1', { x: 80, y: 120 }),
    createManualNoteNode('note-2', { x: 360, y: 120 })
  ];
  state.nodes[0].title = 'Note 1';
  state.nodes[1].title = 'Note 2';
  await bootstrap(page, state, createRuntimeContext());
  await expect
    .poll(async () => (await readPersistedUiState(page)).selectedNodeIds)
    .toEqual(['note-1', 'note-2']);

  await clearPostedMessages(page);
  const firstBox = await nodeById(page, 'note-1').boundingBox();
  expect(firstBox).not.toBeNull();
  await page.mouse.move(firstBox.x + 30, firstBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + 130, firstBox.y + 66, { steps: 8 });
  await page.mouse.up();

  const moveMessage = await waitForPostedMessageByType(page, 'webview/moveNode');
  expect(moveMessage.payload.id).toBe('note-1');
  expect(moveMessage.payload.selectedMoves).toHaveLength(1);
  expect(moveMessage.payload.selectedMoves[0].id).toBe('note-2');
  expect(moveMessage.payload.selectedMoves[0].position.x - moveMessage.payload.position.x).toBe(280);
  expect(moveMessage.payload.selectedMoves[0].position.y - moveMessage.payload.position.y).toBe(0);
  expect(moveMessage.payload.selectedMoves[0].pointerPosition).toEqual(moveMessage.payload.pointerPosition);
});

test('node group drop applies the host avoidance position after state update', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  });
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      ...createManualNoteNode('existing-1', { x: 180, y: 160 }),
      title: 'Existing',
      groupId: 'group-1'
    },
    {
      ...createManualNoteNode('moved-1', { x: 700, y: 160 }),
      title: 'Moved'
    }
  ];
  state.groups = [
    {
      id: 'group-1',
      title: 'Group 1',
      position: { x: 120, y: 120 },
      size: { width: 520, height: 480 }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  const existingBox = await nodeById(page, 'existing-1').boundingBox();
  const movedStartBox = await nodeById(page, 'moved-1').boundingBox();
  expect(existingBox).not.toBeNull();
  expect(movedStartBox).not.toBeNull();

  await clearPostedMessages(page);
  const dragOffset = { x: 6, y: 6 };
  await page.mouse.move(movedStartBox.x + dragOffset.x, movedStartBox.y + dragOffset.y);
  await page.mouse.down();
  await page.mouse.move(existingBox.x + dragOffset.x, existingBox.y + dragOffset.y, { steps: 8 });
  await page.mouse.up();

  const moveMessage = await waitForPostedMessageByType(page, 'webview/moveNode');
  expect(moveMessage.payload.id).toBe('moved-1');
  expect(moveMessage.payload.pointerPosition).toEqual({ x: 186, y: 166 });

  await updateHostState(page, {
    ...state,
    updatedAt: '2026-05-23T12:00:00.000Z',
    nodes: [
      state.nodes[0],
      {
        ...state.nodes[1],
        position: { x: 584, y: 160 },
        groupId: 'group-1'
      }
    ],
    groups: [
      {
        ...state.groups[0],
        size: { width: 872, height: 480 }
      }
    ]
  }, createRuntimeContext());

  await expect
    .poll(async () => (await nodeById(page, 'moved-1').boundingBox())?.x)
    .toBeGreaterThan(existingBox.x + existingBox.width + 16);
});

test('canvas context menu can create a group from selected nodes', async ({ page }) => {
  await openHarness(page);
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      id: 'note-1',
      kind: 'note',
      title: 'Note 1',
      status: 'ready',
      summary: 'first',
      position: { x: 80, y: 120 },
      size: sizeFor('note'),
      metadata: { note: { content: 'first' } }
    },
    {
      id: 'note-2',
      kind: 'note',
      title: 'Note 2',
      status: 'ready',
      summary: 'second',
      position: { x: 360, y: 120 },
      size: sizeFor('note'),
      metadata: { note: { content: 'second' } }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await nodeById(page, 'note-1').click();
  await nodeById(page, 'note-2').click();
  await nodeById(page, 'note-2').click();
  let selectedState = await page.evaluate(() => window.__devSessionCanvasHarness.getPersistedState());
  expect(selectedState.selectedNodeIds).toEqual(['note-1']);
  await nodeById(page, 'note-2').click();
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  selectedState = await page.evaluate(() => window.__devSessionCanvasHarness.getPersistedState());
  expect(selectedState.selectedNodeIds).toEqual(['note-1', 'note-2']);

  await nodeById(page, 'note-1').click();
  selectedState = await page.evaluate(() => window.__devSessionCanvasHarness.getPersistedState());
  expect(selectedState.selectedNodeIds).toEqual(['note-1']);
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await nodeById(page, 'note-2').click();
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  selectedState = await page.evaluate(() => window.__devSessionCanvasHarness.getPersistedState());
  expect(selectedState.selectedNodeIds).toEqual(['note-1', 'note-2']);

  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 40, y: 620 } });
  await expect(page.locator('[data-context-menu-action="create-group-from-selection"] .codicon-group-by-ref-type')).toBeVisible();
  await page.locator('[data-context-menu-action="create-group-from-selection"]').click();
  const message = await waitForPostedMessageByType(page, 'webview/createGroupFromSelection');
  expect(message.payload).toEqual({
    nodeIds: ['note-1', 'note-2'],
    groupIds: []
  });
});

test('host-triggered group creation uses current webview selection', async ({ page }) => {
  await openHarness(page);
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      id: 'note-1',
      kind: 'note',
      title: 'Note 1',
      status: 'ready',
      summary: 'first',
      position: { x: 80, y: 120 },
      size: sizeFor('note'),
      metadata: { note: { content: 'first' } }
    },
    {
      id: 'note-2',
      kind: 'note',
      title: 'Note 2',
      status: 'ready',
      summary: 'second',
      position: { x: 520, y: 120 },
      size: sizeFor('note'),
      metadata: { note: { content: 'second' } }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  await page.keyboard.down(PRIMARY_ACCELERATOR_KEY);
  await nodeById(page, 'note-1').click();
  await nodeById(page, 'note-2').click();
  await page.keyboard.up(PRIMARY_ACCELERATOR_KEY);
  await clearPostedMessages(page);

  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/requestCreateGroupFromSelection'
    });
  });

  const message = await waitForPostedMessageByType(page, 'webview/createGroupFromSelection');
  expect(message.payload).toEqual({
    nodeIds: ['note-1', 'note-2'],
    groupIds: []
  });
});

test('host-triggered group creation reports invalid current webview selection without posting create', async ({ page }) => {
  await openHarness(page);
  const state = createEmptyCanvasState();
  state.nodes = [
    {
      id: 'note-1',
      kind: 'note',
      title: 'Note 1',
      status: 'ready',
      summary: 'first',
      position: { x: 80, y: 120 },
      size: sizeFor('note'),
      metadata: { note: { content: 'first' } }
    }
  ];
  await bootstrap(page, state, createRuntimeContext());

  await nodeById(page, 'note-1').click();
  await clearPostedMessages(page);

  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/requestCreateGroupFromSelection'
    });
  });

  await expect(page.locator('[data-toast-kind="error"]')).toContainText('请先选中至少两个同一父级的节点或分组。');
  const createMessages = await page.evaluate(() =>
    window.__devSessionCanvasHarness
      .getPostedMessages()
      .filter((message) => message.type === 'webview/createGroupFromSelection')
  );
  expect(createMessages).toEqual([]);
});

test('host-triggered manual node creation snapshots existing nodes before resolving autofocus', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      selectedNodeId: 'note-1',
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  const initialState = createNoteNodeState();
  const runtime = createRuntimeContext();

  await page.evaluate(
    ({ nextState, nextRuntime }) => {
      window.__devSessionCanvasHarness.clearPostedMessages();
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/bootstrap',
        payload: {
          state: nextState,
          runtime: nextRuntime
        }
      });
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/requestCreateNode',
        payload: {
          kind: 'note'
        }
      });
    },
    {
      nextState: normalizeCanvasState(initialState),
      nextRuntime: runtime
    }
  );

  const createPayload = await waitForCreateDemoNodePayload(page);
  const nextState = createNoteNodeState();
  nextState.nodes.push(
    createManualNoteNode(
      'note-2',
      createPayload.preferredPosition ?? {
        x: 320,
        y: 0
      }
    )
  );
  await updateHostState(page, nextState, runtime);
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).toBe('note-2');
});

test('host-triggered agent creation bypasses stale webview workspace trust gate', async ({ page }) => {
  await openHarness(page);
  const runtime = createRuntimeContext({ workspaceTrusted: true });

  await page.evaluate(
    ({ nextRuntime }) => {
      window.__devSessionCanvasHarness.clearPostedMessages();
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/bootstrap',
        payload: {
          state: {
            version: 1,
            updatedAt: '2026-04-06T00:00:00.000Z',
            nodes: []
          },
          runtime: nextRuntime
        }
      });
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/requestCreateNode',
        payload: {
          kind: 'agent',
          agentProvider: 'claude',
          agentLaunchPreset: 'yolo'
        }
      });
    },
    {
      nextRuntime: runtime
    }
  );

  await expect(waitForCreateDemoNodePayload(page)).resolves.toEqual(
    expect.objectContaining({
      kind: 'agent',
      agentProvider: 'claude',
      agentLaunchPreset: 'yolo'
    })
  );
  expect(await readPostedMessagesByType(page, 'webview/showCreateNodeBlockedReason')).toEqual([]);
});

test('host-triggered execution node creation echoes cwd into the create request', async ({ page }) => {
  await openHarness(page);
  const runtime = createRuntimeContext({ workspaceTrusted: true });

  await page.evaluate(
    ({ nextRuntime }) => {
      window.__devSessionCanvasHarness.clearPostedMessages();
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/bootstrap',
        payload: {
          state: {
            version: 1,
            updatedAt: '2026-05-31T00:00:00.000Z',
            nodes: []
          },
          runtime: nextRuntime
        }
      });
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/requestCreateNode',
        payload: {
          kind: 'terminal',
          cwd: '/workspace/packages/app'
        }
      });
    },
    {
      nextRuntime: runtime
    }
  );

  await expect(waitForCreateDemoNodePayload(page)).resolves.toEqual(
    expect.objectContaining({
      kind: 'terminal',
      cwd: '/workspace/packages/app'
    })
  );
});

test('unrelated host errors do not cancel pending manual node centering', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  const initialState = createNoteNodeState();
  await bootstrap(page, initialState);
  await clearPostedMessages(page);

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 850,
      y: 500
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu.locator('[data-context-menu-kind="note"]').click();

  const createPayload = await waitForCreateDemoNodePayload(page);
  const nextState = createNoteNodeState();
  nextState.nodes.push(createManualNoteNode('note-2', createPayload.preferredPosition));

  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/error',
      payload: {
        message: '运行中终端 scrollback 同步失败。'
      }
    });
  });
  await expect(page.locator('[data-toast-kind="error"]')).toHaveText('运行中终端 scrollback 同步失败。');

  await updateHostState(page, nextState);
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).toBe('note-2');
});

test('create-scoped host errors cancel the matching pending manual create request', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  const initialState = createNoteNodeState();
  await bootstrap(page, initialState);
  await clearPostedMessages(page);

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 850,
      y: 500
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu.locator('[data-context-menu-kind="note"]').click();

  const createPayload = await waitForCreateDemoNodePayload(page, {
    includeRequestId: true
  });
  const nextState = createNoteNodeState();
  nextState.nodes.push(createManualNoteNode('note-2', createPayload.preferredPosition));

  await page.evaluate((createRequestId) => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/error',
      payload: {
        message: '创建节点失败。',
        createRequestId
      }
    });
  }, createPayload.requestId);
  await expect(page.locator('[data-toast-kind="error"]')).toHaveText('创建节点失败。');

  await updateHostState(page, nextState);
  await waitForNodeFocusAnimation(page);

  const afterState = await readPersistedUiState(page);
  expect(afterState.selectedNodeId).not.toBe('note-2');
});

test('right-click create menu can drill into agent launch modes and create claude yolo directly', async ({ page }) => {
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
      x: 1040,
      y: 520
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu.locator('[data-context-menu-provider="codex"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="claude"]')).toBeVisible();
  await menu
    .locator('[data-context-menu-provider="claude"] [data-context-menu-provider-action="show-launch-modes"]')
    .click();
  await expect(menu.locator('[data-context-menu-back="true"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-back="true"] .codicon-chevron-left')).toBeVisible();
  await expect(menu.locator('[data-context-menu-launch-preset="launch-default"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-launch-preset="launch-resume"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-launch-preset="launch-resume"]')).toContainText(
    '选择历史会话：claude --resume'
  );
  await expect(menu.locator('[data-context-menu-launch-preset="launch-yolo"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-launch-preset="launch-sandbox"]')).toBeVisible();

  await menu.locator('[data-context-menu-launch-preset="launch-yolo"]').click();

  await expect(menu).toBeHidden();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'agent',
    preferredPosition: {
      x: 760,
      y: 305
    },
    agentProvider: 'claude',
    agentLaunchPreset: 'yolo'
  });
});

test('right-click launch preset descriptions normalize conflicting default launch mode flags', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(
    page,
    createCanvasScreenshotState(),
    createRuntimeContext({
      agentLaunchDefaults: {
        codex: {
          command: 'codex',
          defaultArgs: '--model gpt-5.2 resume --last --sandbox danger-full-access'
        },
        claude: {
          command: 'claude',
          defaultArgs: '--model sonnet --resume session-123 --permission-mode acceptEdits'
        }
      }
    })
  );

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 1040,
      y: 520
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu
    .locator('[data-context-menu-provider="codex"] [data-context-menu-provider-action="show-launch-modes"]')
    .click();

  const yoloPreset = menu.locator('[data-context-menu-launch-preset="launch-yolo"]');
  await expect(yoloPreset).toContainText('codex --yolo --model gpt-5.2 resume --last');
  await expect(yoloPreset).toContainText('自动批准执行模式：');
  await expect(yoloPreset).not.toContainText('danger-full-access');
  await expect(yoloPreset.locator('.canvas-context-menu-copy-detail')).toContainText(
    'codex --yolo --model gpt-5.2 resume --last'
  );

  const sandboxPreset = menu.locator('[data-context-menu-launch-preset="launch-sandbox"]');
  await expect(sandboxPreset).toContainText('codex --sandbox workspace-write --model gpt-5.2 resume --last');
  await expect(sandboxPreset).toContainText('受限权限安全模式：');
  await expect(sandboxPreset).not.toContainText('danger-full-access');

  await menu.locator('[data-context-menu-back="true"]').click();
  await menu
    .locator('[data-context-menu-provider="claude"] [data-context-menu-provider-action="show-launch-modes"]')
    .click();

  const claudeYoloPreset = menu.locator('[data-context-menu-launch-preset="launch-yolo"]');
  await expect(claudeYoloPreset).toContainText(
    'claude --dangerously-skip-permissions --model sonnet --resume session-123'
  );
  await expect(claudeYoloPreset).toContainText('自动批准执行模式：');
  await expect(claudeYoloPreset).not.toContainText('acceptEdits');
});

test('right-click create menu creates the default agent without opening the provider list', async ({ page }) => {
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
      x: 1080,
      y: 540
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await menu.locator('[data-context-menu-agent-action="create-default"]').click();

  await expect(menu).toBeHidden();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'agent',
    preferredPosition: {
      x: 800,
      y: 325
    },
    agentProvider: 'codex',
    agentLaunchPreset: 'default'
  });
});

test('right-click create menu refreshes its default agent label after runtime context changes', async ({ page }) => {
  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  const state = createCanvasScreenshotState();
  await bootstrap(page, state);
  await updateHostState(page, state, createRuntimeContext({ defaultAgentProvider: 'claude' }));
  await clearPostedMessages(page);

  const pane = page.locator('.react-flow__pane');
  await pane.click({
    button: 'right',
    position: {
      x: 1010,
      y: 500
    }
  });

  const menu = page.locator('[data-context-menu="true"]');
  await expect(menu.locator('[data-context-menu-agent-action="create-default"]')).toContainText('Claude Code（默认）');

  await menu.locator('[data-context-menu-agent-action="create-default"]').click();

  await expect(menu).toBeHidden();
  expect(await waitForCreateDemoNodePayload(page)).toEqual({
    kind: 'agent',
    preferredPosition: {
      x: 730,
      y: 285
    },
    agentProvider: 'claude',
    agentLaunchPreset: 'default'
  });
});

test('agent start message uses the node metadata provider', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createAgentNodeState('claude'));
  await clearPostedMessages(page);

  const agentNode = nodeById(page, 'agent-1');
  await expect(agentNode.locator('[data-probe-field="provider"]')).toHaveCount(0);
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

test('visibility restore does not move focus onto the canvas shell', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createNoteNodeState(), createRuntimeContext({ surfaceLocation: 'panel' }));

  const beforeRestore = await page.evaluate(() => {
    const sentinel = document.createElement('button');
    sentinel.type = 'button';
    sentinel.id = 'focus-sentinel';
    sentinel.textContent = 'focus sentinel';
    document.body.appendChild(sentinel);
    sentinel.focus();
    return {
      activeElementId: document.activeElement instanceof HTMLElement ? document.activeElement.id : null
    };
  });
  expect(beforeRestore.activeElementId).toBe('focus-sentinel');

  await dispatchVisibilityRestored(page);
  await settleWebview(page, 4);

  const afterRestore = await page.evaluate(() => {
    return {
      activeElementId: document.activeElement instanceof HTMLElement ? document.activeElement.id : null,
      activeElementIsCanvasShell:
        document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('canvas-shell')
    };
  });
  expect(afterRestore.activeElementId).toBe('focus-sentinel');
  expect(afterRestore.activeElementIsCanvasShell).toBe(false);
});

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} snapshot restore prefers serialized terminal state after rebuild`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const fixture = createFullscreenSerializedFixture();
    const serializedTerminalState = await createSerializedTerminalStateFromOutput(
      fixture.output,
      fixture.cols,
      fixture.rows
    );

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: fixture.cols,
      rows: fixture.rows,
      liveSession: true,
      serializedTerminalState
    });
    await settleWebview(page, 4);

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: fixture.cols,
      rows: fixture.rows,
      liveSession: true,
      serializedTerminalState
    });
    await settleWebview(page, 4);
    const restoredVisibleProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (probeNode) =>
        probeNode?.terminalViewportY === 0 &&
        fixture.visibleLines
          .slice(0, 3)
          .every((line, index) => probeNode?.terminalVisibleLines?.[index] === line)
    );
    expect(restoredVisibleProbe.terminalViewportY).toBe(0);
    expect(restoredVisibleProbe.terminalVisibleLines.slice(0, 3)).toEqual(fixture.visibleLines.slice(0, 3));
  });
}

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} exit preserves buffered tail output before the exit banner`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const tailUsageLine = 'Token usage: input=12 output=34 total=46';
    const tailResumeLine = 'To continue this session, run: codex resume session-tail-123';
    const exitMessage = executionKind === 'agent' ? '已停止 Codex CLI 会话。' : '终端会话已结束。';

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `${tailUsageLine}\r\n${tailResumeLine}\r\n`
    });
    await dispatchExecutionExit(page, {
      nodeId,
      kind: executionKind,
      message: exitMessage
    });

    const probeNode = await waitForProbeNodeMatch(page, nodeId, (nextProbeNode) => {
      const visibleLines = nextProbeNode?.terminalVisibleLines ?? [];
      return (
        visibleLines.some((line) => line.includes(tailUsageLine)) &&
        visibleLines.some((line) => line.includes(tailResumeLine)) &&
        visibleLines.some((line) => line.includes(`[Dev Session Canvas] ${exitMessage}`))
      );
    });

    expect(probeNode.terminalVisibleLines.some((line) => line.includes(tailUsageLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(tailResumeLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(`[Dev Session Canvas] ${exitMessage}`))).toBe(
      true
    );
  });
}

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} applies the final snapshot before rendering the exit banner`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const staleBufferedLine = 'STALE-BUFFERED-LINE';
    const finalUsageLine = 'Token usage: input=18 output=52 total=70';
    const finalResumeLine = 'To continue this session, run: codex resume session-final-456';
    const exitMessage = executionKind === 'agent' ? '已停止 Codex CLI 会话。' : '终端会话已结束。';
    const serializedTerminalState = await createSerializedTerminalStateFromOutput(
      `FINAL-PROMPT\r\n${finalUsageLine}\r\n${finalResumeLine}\r\n`
    );

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `${staleBufferedLine}\r\n`
    });
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: false,
      serializedTerminalState
    });
    await dispatchExecutionExit(page, {
      nodeId,
      kind: executionKind,
      message: exitMessage
    });

    const probeNode = await waitForProbeNodeMatch(page, nodeId, (nextProbeNode) => {
      const visibleLines = nextProbeNode?.terminalVisibleLines ?? [];
      return (
        visibleLines.some((line) => line.includes(finalUsageLine)) &&
        visibleLines.some((line) => line.includes(finalResumeLine)) &&
        visibleLines.some((line) => line.includes(`[Dev Session Canvas] ${exitMessage}`)) &&
        !visibleLines.some((line) => line.includes(staleBufferedLine))
      );
    });

    expect(probeNode.terminalVisibleLines.some((line) => line.includes(finalUsageLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(finalResumeLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(`[Dev Session Canvas] ${exitMessage}`))).toBe(
      true
    );
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(staleBufferedLine))).toBe(false);
  });
}

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} requests only one attach snapshot for an already-live mounted node`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await settleWebview(page, 4);

    const attachRequests = await readPostedMessagesByType(page, 'webview/attachExecutionSession');
    expect(
      attachRequests.filter(
        (message) =>
          message.payload.nodeId === nodeId &&
          message.payload.kind === executionKind &&
          message.payload.requestId === undefined
      )
    ).toHaveLength(1);
  });

  test(`${executionKind} staggers snapshot hydrates and prioritizes the node with recent input`, async ({ page }) => {
    const state = createMultiLiveExecutionNodeState(executionKind, 3);
    const nodeIds = state.nodes.map((node) => node.id);
    const inputNodeId = nodeIds[2];

    await openHarness(page);
    await bootstrap(page, state);
    for (const nodeId of nodeIds) {
      await waitForExecutionTerminalReady(page, nodeId);
    }
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'sendExecutionInput',
      nodeId: inputNodeId,
      data: 'i'
    });
    const snapshot = {
      format: 'xterm-serialize-v1',
      data: `SNAPSHOT-${'x'.repeat(40 * 1024)}\r\n`
    };

    for (const nodeId of nodeIds) {
      await dispatchExecutionSnapshot(page, {
        nodeId,
        kind: executionKind,
        output: '',
        cols: 96,
        rows: 28,
        liveSession: true,
        executionSessionId: `${nodeId}-session`,
        outputSequence: 1,
        serializedTerminalState: snapshot
      });
    }

    const startedDiagnostics = await waitForPostedMessagesByTypeMatch(
      page,
      'webview/executionPerformanceDiagnostic',
      (messages) =>
        messages.filter(
          (message) =>
            message.payload.source === 'webview-snapshot-restore-queue' &&
            message.payload.reason === 'started'
        ).length >= nodeIds.length
    );
    const startedNodeIds = startedDiagnostics
      .filter(
        (message) =>
          message.payload.source === 'webview-snapshot-restore-queue' &&
          message.payload.reason === 'started'
      )
      .map((message) => message.payload.nodeId);

    expect(startedNodeIds[0]).toBe(inputNodeId);
  });
}

test('agent output drain reaches every live node when many nodes have pending backlog', async ({ page }) => {
  const state = createMultiLiveExecutionNodeState('agent', 6);
  const nodeIds = state.nodes.map((node) => node.id);
  const outputEvents = nodeIds.map((nodeId, index) => {
    const marker = `AGENT-FAIR-DRAIN-${nodeId}`;
    const chunk =
      Array.from({ length: 12000 }, (_value, lineIndex) => {
        return `${marker}-${String(lineIndex).padStart(4, '0')}`;
      }).join('\r\n') + '\r\n';
    return {
      nodeId,
      kind: 'agent',
      chunk,
      executionSessionId: `fair-drain-session-${index + 1}`,
      outputSequence: index + 1
    };
  });

  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(page, state);
  for (const nodeId of nodeIds) {
    await waitForExecutionTerminalReady(page, nodeId);
  }

  await page.evaluate((events) => {
    for (const payload of events) {
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/executionOutput',
        payload
      });
    }
  }, outputEvents);
  await settleWebview(page, 12);

  for (const nodeId of nodeIds) {
    const probeNode = await readProbeNode(page, nodeId, 0);
    expect(
      probeNode?.terminalVisibleLines?.some((line) => line.includes(`AGENT-FAIR-DRAIN-${nodeId}`))
    ).toBe(true);
  }
});

test('agent attention final output is not starved behind flooded nodes', async ({ page }) => {
  const state = createMultiLiveExecutionNodeState('agent', 6);
  const nodeIds = state.nodes.map((node) => node.id);
  const floodNodeIds = nodeIds.slice(0, 2);
  const attentionNodeIds = nodeIds.slice(2);

  for (const node of state.nodes) {
    if (attentionNodeIds.includes(node.id)) {
      node.metadata.agent.attentionPending = true;
      node.status = 'waiting-input';
      node.metadata.agent.lifecycle = 'waiting-input';
    }
  }

  const floodEvents = floodNodeIds.map((nodeId, index) => ({
    nodeId,
    kind: 'agent',
    chunk:
      Array.from({ length: 12000 }, (_value, lineIndex) => {
        return `BACKGROUND-FLOOD-${nodeId}-${String(lineIndex).padStart(5, '0')}`;
      }).join('\r\n') + '\r\n',
    executionSessionId: `attention-flood-session-${index + 1}`,
    outputSequence: index + 1
  }));
  const finalEvents = attentionNodeIds.map((nodeId, index) => ({
    nodeId,
    kind: 'agent',
    chunk: `ATTENTION-FINAL-OUTPUT-${nodeId}\r\n`,
    executionSessionId: `attention-final-session-${index + 1}`,
    outputSequence: index + 1,
    exitMessage: `Attention final complete ${nodeId}`
  }));

  await openHarness(page, {
    persistedState: {
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      }
    }
  });
  await bootstrap(page, state);
  for (const nodeId of nodeIds) {
    await waitForExecutionTerminalReady(page, nodeId);
  }

  await page.evaluate(
    ({ floodPayloads, finalPayloads }) => {
      for (const payload of floodPayloads) {
        window.__devSessionCanvasHarness.dispatchHostMessage({
          type: 'host/executionOutput',
          payload
        });
      }
      for (const { exitMessage, ...payload } of finalPayloads) {
        window.__devSessionCanvasHarness.dispatchHostMessage({
          type: 'host/executionOutput',
          payload
        });
        window.__devSessionCanvasHarness.dispatchHostMessage({
          type: 'host/executionExit',
          payload: {
            nodeId: payload.nodeId,
            kind: payload.kind,
            message: exitMessage
          }
        });
      }
    },
    { floodPayloads: floodEvents, finalPayloads: finalEvents }
  );
  await settleWebview(page, 18);

  for (const nodeId of attentionNodeIds) {
    const probeNode = await readProbeNode(page, nodeId, 0);
    const visibleLines = probeNode?.terminalVisibleLines ?? [];
    expect(probeNode?.attentionIndicatorVisible).toBe(true);
    expect(visibleLines.some((line) => line.includes(`ATTENTION-FINAL-OUTPUT-${nodeId}`))).toBe(true);
    expect(visibleLines.some((line) => line.includes(`[Dev Session Canvas] Attention final complete ${nodeId}`))).toBe(
      true
    );
  }
});

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} requests snapshot reset instead of replaying a huge restored backlog`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const staleBacklogLine = 'STALE-BACKLOG-SHOULD-NOT-REPLAY';
    const freshSnapshotLine = 'FRESH-SNAPSHOT-AFTER-BACKLOG-RESET';
    const freshLiveLine = 'LIVE-AFTER-SNAPSHOT-RESET';
    const hugeBacklog = `${staleBacklogLine}\r\n${'x'.repeat(560 * 1024)}`;
    const serializedTerminalState = await createSerializedTerminalStateFromOutput(`${freshSnapshotLine}\r\n`);
    const executionSessionId = `${executionKind}-session-reset`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      executionSessionId,
      outputSequence: 0,
      serializedTerminalState: await createSerializedTerminalStateFromOutput('INITIAL-SNAPSHOT\r\n')
    });
    await dispatchVisibilityRestored(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.clearPostedMessages();
    });
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: hugeBacklog,
      executionSessionId,
      outputSequence: 1
    });

    const attachRequest = await waitForPostedMessageByType(page, 'webview/attachExecutionSession');
    expect(attachRequest.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      executionSessionId,
      minOutputSequence: 1
    });
    expect(attachRequest.payload.requestId).toMatch(/^snapshot-reset-/u);

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `${freshLiveLine}\r\n`,
      executionSessionId,
      outputSequence: 2
    });
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      requestId: attachRequest.payload.requestId,
      executionSessionId,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      outputSequence: 1,
      serializedTerminalState
    });

    const probeNode = await waitForProbeNodeMatch(page, nodeId, (nextProbeNode) => {
      const visibleLines = nextProbeNode?.terminalVisibleLines ?? [];
      return (
        visibleLines.some((line) => line.includes(freshSnapshotLine)) &&
        visibleLines.some((line) => line.includes(freshLiveLine)) &&
        !visibleLines.some((line) => line.includes(staleBacklogLine))
      );
    });

    expect(probeNode.terminalVisibleLines.some((line) => line.includes(freshSnapshotLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(freshLiveLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(staleBacklogLine))).toBe(false);

    const snapshotResetDiagnostics = await readPostedMessagesByType(page, 'webview/executionPerformanceDiagnostic');
    expect(
      snapshotResetDiagnostics.some(
        (message) =>
          message.payload.source === 'webview-output-snapshot-reset' &&
          message.payload.nodeId === nodeId &&
          message.payload.requestId === attachRequest.payload.requestId &&
          message.payload.reason === 'visibility-backlog-snapshot-reset' &&
          message.payload.characters >= hugeBacklog.length
      )
    ).toBe(true);
    expect(
      snapshotResetDiagnostics.some(
        (message) =>
          message.payload.source === 'webview-output-snapshot-reset' &&
          message.payload.nodeId === nodeId &&
          message.payload.requestId === attachRequest.payload.requestId &&
          message.payload.reason === 'snapshot-reset-applied'
      )
    ).toBe(true);
  });

  test(`${executionKind} requests hidden snapshot reset before visible backlog threshold`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const hiddenBacklogLine = 'HIDDEN-BACKLOG-SHOULD-RESET-EARLY';
    const hiddenBacklog = `${hiddenBacklogLine}\r\n${'h'.repeat(160 * 1024)}`;
    const executionSessionId = `${executionKind}-session-hidden-reset`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      executionSessionId,
      outputSequence: 0,
      serializedTerminalState: await createSerializedTerminalStateFromOutput('INITIAL-SNAPSHOT\r\n')
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await clearPostedMessages(page);

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: hiddenBacklog,
      executionSessionId,
      outputSequence: 1
    });

    const attachRequest = await waitForPostedMessageByType(page, 'webview/attachExecutionSession');
    expect(attachRequest.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      executionSessionId,
      minOutputSequence: 1
    });
    expect(attachRequest.payload.requestId).toMatch(/^snapshot-reset-/u);

    const resetDiagnostics = await waitForPostedMessagesByTypeMatch(
      page,
      'webview/executionPerformanceDiagnostic',
      (messages) =>
        messages.some(
          (message) =>
            message.payload.source === 'webview-output-snapshot-reset' &&
            message.payload.nodeId === nodeId &&
            message.payload.requestId === attachRequest.payload.requestId &&
            message.payload.reason === 'hidden-backlog-snapshot-reset'
        )
    );
    const resetDiagnostic = resetDiagnostics.find(
      (message) =>
        message.payload.source === 'webview-output-snapshot-reset' &&
        message.payload.nodeId === nodeId &&
        message.payload.requestId === attachRequest.payload.requestId &&
        message.payload.reason === 'hidden-backlog-snapshot-reset'
    );
    expect(resetDiagnostic.payload.characters).toBeGreaterThanOrEqual(hiddenBacklog.length);
    expect(resetDiagnostic.payload.sequence).toBe(1);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  });

  test(`${executionKind} keeps snapshot reset deferred output bounded while waiting for Host snapshot`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const staleBacklogLine = 'STALE-BACKLOG-BUDGET-SHOULD-NOT-REPLAY';
    const freshSnapshotLine = 'FRESH-SNAPSHOT-AFTER-BUDGET-RESET';
    const freshTailLine = 'LIVE-TAIL-AFTER-BUDGET-RESET';
    const hugeBacklog = `${staleBacklogLine}\r\n${'x'.repeat(560 * 1024)}`;
    const executionSessionId = `${executionKind}-session-budget-reset`;
    const serializedTerminalState = await createSerializedTerminalStateFromOutput(`${freshSnapshotLine}\r\n`);

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      executionSessionId,
      outputSequence: 0,
      serializedTerminalState: await createSerializedTerminalStateFromOutput('INITIAL-SNAPSHOT\r\n')
    });
    await dispatchVisibilityRestored(page);
    await page.evaluate(() => {
      window.__devSessionCanvasHarness.clearPostedMessages();
    });

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: hugeBacklog,
      executionSessionId,
      outputSequence: 1
    });
    const firstAttachRequest = await waitForPostedMessageByType(page, 'webview/attachExecutionSession');
    expect(firstAttachRequest.payload.requestId).toMatch(/^snapshot-reset-/u);
    expect(firstAttachRequest.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      executionSessionId,
      minOutputSequence: 1
    });

    for (let index = 0; index < 5; index += 1) {
      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: `DEFERRED-BULK-${index}-${'y'.repeat(70 * 1024)}\r\n`,
        executionSessionId,
        outputSequence: index + 2
      });
    }

    const resetDiagnostics = await waitForPostedMessagesByTypeMatch(
      page,
      'webview/executionPerformanceDiagnostic',
      (messages) =>
        messages.some(
          (message) =>
            message.payload.source === 'webview-output-snapshot-reset' &&
            message.payload.nodeId === nodeId &&
            message.payload.reason === 'deferred-output-budget-reset'
        )
    );
    const budgetDiagnostic = resetDiagnostics.find(
      (message) =>
        message.payload.source === 'webview-output-snapshot-reset' &&
        message.payload.nodeId === nodeId &&
        message.payload.reason === 'deferred-output-budget-reset'
    );
    expect(budgetDiagnostic.payload.pendingOutputLength).toBeGreaterThan(256 * 1024);

    const attachRequests = await waitForPostedMessagesByTypeMatch(
      page,
      'webview/attachExecutionSession',
      (messages) => messages.length >= 2
    );
    const latestAttachRequest = attachRequests.at(-1);
    expect(latestAttachRequest.payload.requestId).toMatch(/^snapshot-reset-/u);
    expect(latestAttachRequest.payload.requestId).not.toBe(firstAttachRequest.payload.requestId);
    expect(latestAttachRequest.payload).toMatchObject({
      nodeId,
      kind: executionKind,
      executionSessionId,
      minOutputSequence: 5
    });

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `${freshTailLine}\r\n`,
      executionSessionId,
      outputSequence: 8
    });
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      requestId: latestAttachRequest.payload.requestId,
      executionSessionId,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      outputSequence: 7,
      serializedTerminalState
    });

    const probeNode = await waitForProbeNodeMatch(page, nodeId, (nextProbeNode) => {
      const visibleLines = nextProbeNode?.terminalVisibleLines ?? [];
      return (
        visibleLines.some((line) => line.includes(freshSnapshotLine)) &&
        visibleLines.some((line) => line.includes(freshTailLine)) &&
        !visibleLines.some((line) => line.includes(staleBacklogLine)) &&
        !visibleLines.some((line) => line.includes('DEFERRED-BULK-'))
      );
    });

    expect(probeNode.terminalVisibleLines.some((line) => line.includes(freshSnapshotLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(freshTailLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(staleBacklogLine))).toBe(false);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes('DEFERRED-BULK-'))).toBe(false);
  });

  test(`${executionKind} ignores unsequenced live snapshot reset responses until a sequenced snapshot arrives`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const staleBacklogLine = 'STALE-BACKLOG-UNSEQUENCED-LIVE-SHOULD-NOT-REPLAY';
    const unsequencedSnapshotLine = 'UNSEQUENCED-LIVE-SNAPSHOT-SHOULD-NOT-APPLY';
    const freshSnapshotLine = 'FRESH-SNAPSHOT-AFTER-UNSEQUENCED-LIVE';
    const deferredLiveLine = 'DEFERRED-LIVE-AFTER-UNSEQUENCED-LIVE';
    const hugeBacklog = `${staleBacklogLine}\r\n${'x'.repeat(560 * 1024)}`;
    const executionSessionId = `${executionKind}-session-unsequenced-live-reset`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      executionSessionId,
      outputSequence: 0,
      serializedTerminalState: await createSerializedTerminalStateFromOutput('INITIAL-SNAPSHOT\r\n')
    });
    await dispatchVisibilityRestored(page);
    await clearPostedMessages(page);

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: hugeBacklog,
      executionSessionId,
      outputSequence: 1
    });
    const attachRequest = await waitForPostedMessageByType(page, 'webview/attachExecutionSession');
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `${deferredLiveLine}\r\n`,
      executionSessionId,
      outputSequence: 2
    });

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      requestId: attachRequest.payload.requestId,
      executionSessionId,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      serializedTerminalState: await createSerializedTerminalStateFromOutput(`${unsequencedSnapshotLine}\r\n`)
    });
    const unsequencedDiagnostics = await waitForPostedMessagesByTypeMatch(
      page,
      'webview/executionPerformanceDiagnostic',
      (messages) =>
        messages.some(
          (message) =>
            message.payload.source === 'webview-output-snapshot-reset' &&
            message.payload.nodeId === nodeId &&
            message.payload.requestId === attachRequest.payload.requestId &&
            message.payload.reason === 'snapshot-reset-unsequenced-snapshot'
        )
    );
    expect(
      unsequencedDiagnostics.some(
        (message) =>
          message.payload.source === 'webview-output-snapshot-reset' &&
          message.payload.nodeId === nodeId &&
          message.payload.requestId === attachRequest.payload.requestId &&
          message.payload.reason === 'snapshot-reset-applied'
      )
    ).toBe(false);
    await settleWebview(page, 4);
    const ignoredProbe = await readProbeNode(page, nodeId, 20);
    expect(ignoredProbe.terminalVisibleLines.some((line) => line.includes(unsequencedSnapshotLine))).toBe(false);
    expect(ignoredProbe.terminalVisibleLines.some((line) => line.includes(deferredLiveLine))).toBe(false);

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      requestId: attachRequest.payload.requestId,
      executionSessionId,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      outputSequence: 1,
      serializedTerminalState: await createSerializedTerminalStateFromOutput(`${freshSnapshotLine}\r\n`)
    });

    const probeNode = await waitForProbeNodeMatch(page, nodeId, (nextProbeNode) => {
      const visibleLines = nextProbeNode?.terminalVisibleLines ?? [];
      return (
        visibleLines.some((line) => line.includes(freshSnapshotLine)) &&
        visibleLines.some((line) => line.includes(deferredLiveLine)) &&
        !visibleLines.some((line) => line.includes(unsequencedSnapshotLine)) &&
        !visibleLines.some((line) => line.includes(staleBacklogLine))
      );
    });

    expect(probeNode.terminalVisibleLines.some((line) => line.includes(freshSnapshotLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(deferredLiveLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(unsequencedSnapshotLine))).toBe(false);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(staleBacklogLine))).toBe(false);
  });

  test(`${executionKind} accepts unsequenced ended snapshot reset without replaying deferred live output`, async ({
    page
  }) => {
    const nodeId = `${executionKind}-zoom`;
    const staleBacklogLine = 'STALE-BACKLOG-ENDED-SNAPSHOT-SHOULD-NOT-REPLAY';
    const deferredLiveLine = 'DEFERRED-LIVE-AFTER-ENDED-SNAPSHOT-SHOULD-NOT-REPLAY';
    const finalSnapshotLine = 'FINAL-UNSEQUENCED-ENDED-SNAPSHOT';
    const hugeBacklog = `${staleBacklogLine}\r\n${'x'.repeat(560 * 1024)}`;
    const executionSessionId = `${executionKind}-session-ended-snapshot-reset`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      executionSessionId,
      outputSequence: 0,
      serializedTerminalState: await createSerializedTerminalStateFromOutput('INITIAL-SNAPSHOT\r\n')
    });
    await dispatchVisibilityRestored(page);
    await clearPostedMessages(page);

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: hugeBacklog,
      executionSessionId,
      outputSequence: 1
    });
    const attachRequest = await waitForPostedMessageByType(page, 'webview/attachExecutionSession');
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `${deferredLiveLine}\r\n`,
      executionSessionId,
      outputSequence: 2
    });

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      requestId: attachRequest.payload.requestId,
      executionSessionId,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: false,
      serializedTerminalState: await createSerializedTerminalStateFromOutput(`${finalSnapshotLine}\r\n`)
    });

    const probeNode = await waitForProbeNodeMatch(page, nodeId, (nextProbeNode) => {
      const visibleLines = nextProbeNode?.terminalVisibleLines ?? [];
      return (
        visibleLines.some((line) => line.includes(finalSnapshotLine)) &&
        !visibleLines.some((line) => line.includes(deferredLiveLine)) &&
        !visibleLines.some((line) => line.includes(staleBacklogLine))
      );
    });

    expect(probeNode.terminalVisibleLines.some((line) => line.includes(finalSnapshotLine))).toBe(true);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(deferredLiveLine))).toBe(false);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(staleBacklogLine))).toBe(false);

    const resetDiagnostics = await readPostedMessagesByType(page, 'webview/executionPerformanceDiagnostic');
    expect(
      resetDiagnostics.some(
        (message) =>
          message.payload.source === 'webview-output-snapshot-reset' &&
          message.payload.nodeId === nodeId &&
          message.payload.requestId === attachRequest.payload.requestId &&
          message.payload.reason === 'snapshot-reset-session-ended-snapshot'
      )
    ).toBe(true);
    expect(
      resetDiagnostics.some(
        (message) =>
          message.payload.source === 'webview-output-snapshot-reset' &&
          message.payload.nodeId === nodeId &&
          message.payload.requestId === attachRequest.payload.requestId &&
          message.payload.reason === 'snapshot-reset-applied'
      )
    ).toBe(false);
  });

  test(`${executionKind} clears pending snapshot reset when the session exits`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const staleBacklogLine = 'STALE-BACKLOG-EXIT-SHOULD-NOT-REPLAY';
    const deferredLiveLine = 'DEFERRED-LIVE-AFTER-EXIT-SHOULD-NOT-REPLAY';
    const lateSnapshotLine = 'LATE-SNAPSHOT-AFTER-EXIT-SHOULD-NOT-APPLY';
    const exitMessage = 'Exited after snapshot reset';
    const hugeBacklog = `${staleBacklogLine}\r\n${'x'.repeat(560 * 1024)}`;
    const executionSessionId = `${executionKind}-session-exit-reset`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      executionSessionId,
      outputSequence: 0,
      serializedTerminalState: await createSerializedTerminalStateFromOutput('INITIAL-SNAPSHOT\r\n')
    });
    await dispatchVisibilityRestored(page);
    await clearPostedMessages(page);

    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: hugeBacklog,
      executionSessionId,
      outputSequence: 1
    });
    const attachRequest = await waitForPostedMessageByType(page, 'webview/attachExecutionSession');
    await dispatchExecutionOutput(page, {
      nodeId,
      kind: executionKind,
      chunk: `${deferredLiveLine}\r\n`,
      executionSessionId,
      outputSequence: 2
    });
    await dispatchExecutionExit(page, {
      nodeId,
      kind: executionKind,
      message: exitMessage
    });
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      requestId: attachRequest.payload.requestId,
      executionSessionId,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: false,
      outputSequence: 1,
      serializedTerminalState: await createSerializedTerminalStateFromOutput(`${lateSnapshotLine}\r\n`)
    });

    const probeNode = await waitForProbeNodeMatch(page, nodeId, (nextProbeNode) => {
      const visibleLines = nextProbeNode?.terminalVisibleLines ?? [];
      return (
        visibleLines.some((line) => line.includes(`[Dev Session Canvas] ${exitMessage}`)) &&
        !visibleLines.some((line) => line.includes(deferredLiveLine)) &&
        !visibleLines.some((line) => line.includes(lateSnapshotLine)) &&
        !visibleLines.some((line) => line.includes(staleBacklogLine))
      );
    });

    expect(probeNode.terminalVisibleLines.some((line) => line.includes(`[Dev Session Canvas] ${exitMessage}`))).toBe(
      true
    );
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(deferredLiveLine))).toBe(false);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(lateSnapshotLine))).toBe(false);
    expect(probeNode.terminalVisibleLines.some((line) => line.includes(staleBacklogLine))).toBe(false);

    const resetDiagnostics = await readPostedMessagesByType(page, 'webview/executionPerformanceDiagnostic');
    expect(
      resetDiagnostics.some(
        (message) =>
          message.payload.source === 'webview-output-snapshot-reset' &&
          message.payload.nodeId === nodeId &&
          message.payload.requestId === attachRequest.payload.requestId &&
          message.payload.reason === 'snapshot-reset-session-ended'
      )
    ).toBe(true);
    expect(
      resetDiagnostics.some(
        (message) =>
          message.payload.source === 'webview-output-snapshot-reset' &&
          message.payload.nodeId === nodeId &&
          message.payload.requestId === attachRequest.payload.requestId &&
          message.payload.reason === 'stale-snapshot-reset-ignored'
      )
    ).toBe(true);
  });
}

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
  test(`${executionKind} snapshot restore keeps configured scrollback history after rebuild`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const configuredScrollback = 240;
    const output = createScrollableTerminalOutput(220);
    const serializedTerminalState = await createSerializedTerminalStateFromOutput(
      output,
      96,
      28,
      configuredScrollback
    );

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind), createRuntimeContext({
      terminalScrollback: configuredScrollback
    }));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      serializedTerminalState
    });
    await settleWebview(page, 4);

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind), createRuntimeContext({
      terminalScrollback: configuredScrollback
    }));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      serializedTerminalState
    });
    await settleWebview(page, 4);

    const bottomProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (probeNode) =>
        typeof probeNode?.terminalViewportY === 'number' &&
        probeNode.terminalViewportY > 120 &&
        probeNode.terminalVisibleLines?.some((line) => line.includes('ROW-219'))
    );

    expect(bottomProbe.terminalVisibleLines.some((line) => line.includes('ROW-219'))).toBe(true);

    await performTestDomAction(page, {
      kind: 'scrollTerminalViewport',
      nodeId,
      lines: -400
    });
    const restoredTopProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (probeNode) =>
        probeNode?.terminalViewportY === 0 &&
        probeNode.terminalVisibleLines?.some((line) => line.includes('ROW-000'))
    );

    expect(restoredTopProbe.terminalVisibleLines.some((line) => line.includes('ROW-000'))).toBe(true);
  });
}

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} snapshot restore eventually refits to the current smaller container`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind));
    const readyProbe = await waitForExecutionTerminalReady(page, nodeId);
    const restoreCols = readyProbe.terminalCols + 12;
    const restoreRows = readyProbe.terminalRows + 6;
    const fixture = createFullscreenSerializedFixture(restoreCols, restoreRows);
    const serializedTerminalState = await createSerializedTerminalStateFromOutput(
      fixture.output,
      restoreCols,
      restoreRows
    );

    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: restoreCols,
      rows: restoreRows,
      liveSession: true,
      serializedTerminalState
    });

    const oversizedProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (probeNode) => probeNode?.terminalCols === restoreCols && probeNode.terminalRows === restoreRows
    );
    expect(oversizedProbe.terminalCols).toBe(restoreCols);
    expect(oversizedProbe.terminalRows).toBe(restoreRows);

    await expect
      .poll(
        async () => {
          const probeNode = await readProbeNode(page, nodeId, 20);
          if (!probeNode) {
            return null;
          }

          return JSON.stringify({
            cols: probeNode.terminalCols,
            rows: probeNode.terminalRows
          });
        },
        { timeout: 4000 }
      )
      .toBe(
        JSON.stringify({
          cols: readyProbe.terminalCols,
          rows: readyProbe.terminalRows
        })
      );
  });
}

for (const executionKind of ['agent', 'terminal']) {
  test(`${executionKind} snapshot restore still responds to wheel scrolling after rebuild`, async ({ page }) => {
    const nodeId = `${executionKind}-zoom`;
    const configuredScrollback = 240;
    const output = createScrollableTerminalOutput(220);
    const serializedTerminalState = await createSerializedTerminalStateFromOutput(
      output,
      96,
      28,
      configuredScrollback
    );

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind), createRuntimeContext({
      terminalScrollback: configuredScrollback
    }));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      serializedTerminalState
    });
    await settleWebview(page, 4);

    await openHarness(page);
    await bootstrap(page, createLiveExecutionNodeState(executionKind), createRuntimeContext({
      terminalScrollback: configuredScrollback
    }));
    await waitForExecutionTerminalReady(page, nodeId);
    await dispatchExecutionSnapshot(page, {
      nodeId,
      kind: executionKind,
      output: '',
      cols: 96,
      rows: 28,
      liveSession: true,
      serializedTerminalState
    });
    await settleWebview(page, 4);

    const bottomProbe = await waitForProbeNodeMatch(
      page,
      nodeId,
      (probeNode) =>
        typeof probeNode?.terminalViewportY === 'number' &&
        probeNode.terminalViewportY > 120 &&
        probeNode.terminalVisibleLines?.some((line) => line.includes('ROW-219'))
    );
    const bottomViewportY = bottomProbe.terminalViewportY;

    const wheelProbe = await scrollTerminalViewport(
      page,
      nodeId,
      -1600,
      (probeNode) =>
        typeof probeNode?.terminalViewportY === 'number' &&
        probeNode.terminalViewportY <= bottomViewportY - 12 &&
        probeNode.terminalVisibleLines?.some((line) => line.includes('ROW-180')),
      10
    );

    expect(wheelProbe.terminalViewportY).toBeLessThan(bottomViewportY);
    expect(wheelProbe.terminalVisibleLines.some((line) => line.includes('ROW-180'))).toBe(true);
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
  test(
    `${executionKind} keeps a scrolled-back viewport locked across output, spinner redraw, and host refresh`,
    async ({ page }) => {
      const nodeId = `${executionKind}-zoom`;
      const output = createScrollableTerminalOutput(160);

      await openHarness(page);
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
        (probeNode) =>
          typeof probeNode?.terminalViewportY === 'number' &&
          probeNode.terminalViewportY > 100 &&
          probeNode.terminalVisibleLines?.some((line) => line.includes('ROW-159'))
      );
      const scrolledProbe = await scrollTerminalViewport(
        page,
        nodeId,
        -1800,
        (probeNode) =>
          typeof probeNode?.terminalViewportY === 'number' &&
          probeNode.terminalViewportY <= bottomProbe.terminalViewportY - 12 &&
          probeNode.terminalVisibleLines?.some((line) => line.includes('ROW-120')),
        10
      );
      const lockedViewportY = scrolledProbe.terminalViewportY;
      const lockedAnchorLine =
        scrolledProbe.terminalVisibleLines.find((line) => line.includes('ROW-12')) ??
        scrolledProbe.terminalVisibleLines.find((line) => line.includes('ROW-11')) ??
        null;

      expect(lockedAnchorLine).not.toBeNull();

      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: 'FOLLOW-SHOULD-STAY-HIDDEN\r\n'
      });
      await settleWebview(page, 4);

      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: '\rSPINNER-TICK'
      });
      await settleWebview(page, 4);

      const updatedState = createLiveExecutionNodeState(executionKind);
      updatedState.updatedAt = '2026-04-16T12:00:00.000Z';
      updatedState.nodes[0].summary = 'Host rerender while viewport is intentionally locked in history.';
      await updateHostState(page, updatedState);
      await settleWebview(page, 4);

      await dispatchVisibilityRestored(page);
      await settleWebview(page, 6);

      const lockedProbe = await waitForProbeNodeMatch(
        page,
        nodeId,
        (probeNode) =>
          probeNode?.terminalViewportY === lockedViewportY &&
          probeNode.terminalVisibleLines?.includes(lockedAnchorLine)
      );

      expect(lockedProbe.terminalVisibleLines.includes('FOLLOW-SHOULD-STAY-HIDDEN')).toBe(false);
      expect(lockedProbe.terminalVisibleLines.includes('SPINNER-TICK')).toBe(false);

      await performTestDomAction(page, {
        kind: 'scrollTerminalViewport',
        nodeId,
        lines: 9999
      });
      const resumedBottomProbe = await waitForProbeNodeMatch(
        page,
        nodeId,
        (probeNode) =>
          typeof probeNode?.terminalViewportY === 'number' &&
          probeNode.terminalViewportY > lockedViewportY &&
          probeNode.terminalVisibleLines?.some((line) => line.includes('FOLLOW-SHOULD-STAY-HIDDEN'))
      );

      await dispatchExecutionOutput(page, {
        nodeId,
        kind: executionKind,
        chunk: 'FOLLOW-RESUMED\r\n'
      });
      await settleWebview(page, 4);

      const followedProbe = await waitForProbeNodeMatch(
        page,
        nodeId,
        (probeNode) => probeNode?.terminalVisibleLines?.some((line) => line.includes('FOLLOW-RESUMED'))
      );

      expect(followedProbe.terminalViewportY).toBeGreaterThanOrEqual(resumedBottomProbe.terminalViewportY);
    }
  );
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

async function bootstrap(page, state, runtime = createRuntimeContext()) {
  await page.evaluate(({ nextState, nextRuntime }) => {
    window.__devSessionCanvasHarness.clearPostedMessages();
    window.__devSessionCanvasHarness.bootstrap(nextState, nextRuntime);
  }, { nextState: normalizeCanvasState(state), nextRuntime: runtime });
}

async function updateHostState(page, state, runtime = createRuntimeContext()) {
  await page.evaluate(({ nextState, nextRuntime }) => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/stateUpdated',
      payload: {
        state: nextState,
        runtime: nextRuntime
      }
    });
  }, { nextState: normalizeCanvasState(state), nextRuntime: runtime });
}

async function applyWorkbenchTheme(page, themeName) {
  const fixture = WORKBENCH_THEME_FIXTURES[themeName];
  const colorScheme = fixture.kind === 'dark' ? 'dark' : 'light';
  await page.emulateMedia({ colorScheme });
  await page.evaluate(
    ({ themeVars, themeKind, themeId, themeVarNames, unsetVars }) => {
      const body = document.body;
      if (!body) {
        throw new Error('Harness body not ready.');
      }

      for (const name of themeVarNames) {
        body.style.removeProperty(name);
        document.documentElement.style.removeProperty(name);
      }

      body.classList.remove(
        'vscode-light',
        'vscode-dark',
        'vscode-high-contrast',
        'vscode-high-contrast-light'
      );
      body.classList.add(themeKind === 'dark' ? 'vscode-dark' : 'vscode-light');
      body.dataset.vscodeThemeKind = themeKind === 'dark' ? 'vscode-dark' : 'vscode-light';
      body.dataset.vscodeThemeId = themeId;

      for (const [name, value] of Object.entries(themeVars)) {
        body.style.setProperty(name, value);
      }
      for (const name of unsetVars) {
        body.style.removeProperty(name);
      }
    },
    {
      themeVars: fixture.themeVars,
      themeKind: fixture.kind,
      themeId: fixture.themeId,
      themeVarNames: WORKBENCH_THEME_VAR_NAMES,
      unsetVars: fixture.unsetVars ?? []
    }
  );
  await settleWebview(page, 2);
}

function createRuntimeContext(overrides = {}) {
  return {
    workspaceTrusted: true,
    surfaceLocation: 'panel',
    defaultAgentProvider: 'codex',
    agentLaunchDefaults: {
      codex: {
        command: 'codex',
        defaultArgs: '--timeout 300 --verbose'
      },
      claude: {
        command: 'claude',
        defaultArgs: '--model sonnet'
      }
    },
    strongTerminalAttentionReminderMode: 'both',
    terminalScrollback: 1000,
    editorMultiCursorModifier: 'alt',
    terminalWordSeparators: ' ()[]{}\',"`',
    overviewMode: 'title',
    overviewZoomThreshold: 0.2,
    multiRootPresentationMode: 'rootGroups',
    workspaceRootWatermarksEnabled: true,
    filesEnabled: true,
    filePresentationMode: 'nodes',
    fileNodeDisplayStyle: 'minimal',
    fileNodeDisplayMode: 'icon-path',
    filePathDisplayMode: 'basename',
    fileIconFontFaces: [],
    ...overrides
  };
}

function normalizeCanvasState(state) {
  return {
    ...state,
    edges: Array.isArray(state?.edges) ? state.edges : [],
    groups: Array.isArray(state?.groups) ? state.groups : [],
    nextGroupSequence:
      typeof state?.nextGroupSequence === 'number' && Number.isInteger(state.nextGroupSequence) && state.nextGroupSequence > 0
        ? state.nextGroupSequence
        : 1,
    fileReferences: Array.isArray(state?.fileReferences) ? state.fileReferences : []
  };
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

async function dispatchVisibilityRestored(page) {
  await page.evaluate(() => {
    window.__devSessionCanvasHarness.dispatchHostMessage({
      type: 'host/visibilityRestored'
    });
  });
}

async function readPersistedUiState(page) {
  return page.evaluate(() => {
    return window.__devSessionCanvasHarness.getPersistedState();
  });
}

async function readCanvasViewportTransform(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport');
    return viewport instanceof HTMLElement ? viewport.style.transform : null;
  });
}

async function readCanvasViewport(page) {
  const transform = await readCanvasViewportTransform(page);
  const match = transform?.match(
    /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)\s+scale\((-?\d+(?:\.\d+)?)\)/
  );
  return match
    ? {
        x: Number.parseFloat(match[1]),
        y: Number.parseFloat(match[2]),
        zoom: Number.parseFloat(match[3])
      }
    : null;
}

async function readCanvasViewportScale(page) {
  const transform = await readCanvasViewportTransform(page);
  const scaleMatch = transform?.match(/scale\(([-\d.]+)\)/);
  return scaleMatch ? Number(scaleMatch[1]) : null;
}

async function readGroupCanvasGeometry(page, groupId) {
  return page.locator(`[data-group-id="${groupId}"]`).evaluate((frame) => {
    const left = Number.parseFloat(frame.style.left);
    const top = Number.parseFloat(frame.style.top);
    const width = Number.parseFloat(frame.style.width);
    const height = Number.parseFloat(frame.style.height);
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(width),
      height: Math.round(height)
    };
  });
}

async function expectGroupCenteredInViewport(page, groupId, tolerance = 20) {
  const viewportSize = page.viewportSize();
  const groupBox = await page.locator(`[data-group-id="${groupId}"]`).boundingBox();
  expect(viewportSize).not.toBeNull();
  expect(groupBox).not.toBeNull();
  expect(Math.abs(groupBox.x + groupBox.width / 2 - viewportSize.width / 2)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(groupBox.y + groupBox.height / 2 - viewportSize.height / 2)).toBeLessThanOrEqual(tolerance);
}

async function readComputedOpacity(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    return target instanceof HTMLElement ? getComputedStyle(target).opacity : null;
  }, selector);
}

async function readActiveElementOverviewFocusSnapshot(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      return null;
    }

    let hiddenByOverviewStyle = false;
    let current = active;
    while (current) {
      const style = getComputedStyle(current);
      if (style.opacity === '0' || style.visibility === 'hidden' || current.hasAttribute('inert')) {
        hiddenByOverviewStyle = true;
        break;
      }
      current = current.parentElement;
    }

    const node = active.closest('[data-node-id]');
    const hiddenNodeControl =
      Boolean(node) &&
      hiddenByOverviewStyle &&
      (
        active.matches('button, input, textarea, [tabindex]') ||
        active.closest('button, input, textarea, [tabindex]')
      );

    return {
      tagName: active.tagName,
      className: active.className,
      text: active.textContent?.trim() ?? '',
      nodeId: node?.getAttribute('data-node-id') ?? null,
      hiddenNodeControl
    };
  });
}

async function waitForNodeFocusAnimation(page) {
  await page.waitForTimeout(NODE_FOCUS_ANIMATION_DURATION_MS + 80);
  await settleWebview(page, 4);
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

async function readProbeEdge(page, edgeId, delayMs = 0) {
  const snapshot = await requestWebviewProbe(page, delayMs);
  return snapshot.edges.find((edge) => edge.edgeId === edgeId) ?? null;
}

async function edgeLabelIsProtected(page, edgeId) {
  return page.evaluate((nextEdgeId) => {
    const label = document.querySelector(
      `[data-edge-label="true"][data-edge-label-edge-id="${nextEdgeId}"]`
    );
    if (!label) {
      return null;
    }

    const paths = Array.from(
      document.querySelectorAll(`[data-edge-visible-segment][data-edge-id="${nextEdgeId}"]`)
    );
    if (paths.length === 0) {
      return null;
    }

    const labelRect = label.getBoundingClientRect();
    const sampleXs = [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92];
    const sampleYs = [0.18, 0.34, 0.5, 0.66, 0.82];

    const intersectsStroke = sampleXs.some((xRatio) =>
      sampleYs.some((yRatio) => {
        const screenX = labelRect.left + labelRect.width * xRatio;
        const screenY = labelRect.top + labelRect.height * yRatio;

        return paths.some((candidate) => {
          if (!(candidate instanceof SVGGeometryElement) || typeof candidate.isPointInStroke !== 'function') {
            return false;
          }

          const matrix = candidate.getScreenCTM();
          if (!matrix) {
            return false;
          }

          const localPoint = new DOMPoint(screenX, screenY).matrixTransform(matrix.inverse());
          return candidate.isPointInStroke(localPoint);
        });
      })
    );

    if (!intersectsStroke) {
      return true;
    }

    if (label.dataset.edgeLabelMask !== 'true') {
      return false;
    }

    const maskStyle = getComputedStyle(label, '::before');
    return maskStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' || maskStyle.boxShadow !== 'none';
  }, edgeId);
}

async function waitForPostedMessageByType(page, type, options = {}) {
  let matchedMessage = null;

  await expect
    .poll(async () => {
      const message = await page.evaluate((nextType) => {
        return (
          window.__devSessionCanvasHarness
            .getPostedMessages()
            .find((entry) => entry.type === nextType) ?? null
        );
      }, type);
      if (!message) {
        return null;
      }

      matchedMessage = message;
      return 'matched';
    })
    .toBe('matched');

  return options.includeLifecycle === true ? matchedMessage : stripPostedMessageLifecycle(matchedMessage);
}

async function readPostedMessagesByType(page, type, options = {}) {
  const messages = await page.evaluate((nextType) => {
    return window.__devSessionCanvasHarness
      .getPostedMessages()
      .filter((entry) => entry.type === nextType);
  }, type);
  return options.includeLifecycle === true ? messages : messages.map(stripPostedMessageLifecycle);
}

async function readFirstExecutionInputPayload(page) {
  return page.evaluate(() => {
    return (
      window.__devSessionCanvasHarness
        .getPostedMessages()
        .find((entry) => entry.type === 'webview/executionInput')?.payload ?? null
    );
  });
}

async function waitForPostedMessagesByTypeMatch(page, type, predicate, options = {}) {
  let matchedMessages = [];

  await expect
    .poll(async () => {
      const messages = await readPostedMessagesByType(page, type, options);
      if (!predicate(messages)) {
        return null;
      }

      matchedMessages = messages;
      return 'matched';
    })
    .toBe('matched');

  return matchedMessages;
}

function stripPostedMessageLifecycle(message) {
  if (!message || typeof message !== 'object') {
    return message;
  }

  const { lifecycle: _lifecycle, ...rest } = message;
  return rest;
}

async function readLastOpenedExecutionLink(page, nodeId) {
  return page.evaluate((nextNodeId) => {
    const messages = window.__devSessionCanvasHarness
      .getPostedMessages()
      .filter((entry) => entry.type === 'webview/openExecutionLink' && entry.payload.nodeId === nextNodeId);
    return messages.at(-1)?.payload.link ?? null;
  }, nodeId);
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

async function scrollTerminalViewport(page, nodeId, deltaY, predicate, maxAttempts = 4) {
  const screen = nodeById(page, nodeId).locator('.xterm-screen');
  await expect(screen).toBeVisible();
  const box = await screen.boundingBox();

  expect(box).not.toBeNull();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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

async function readTerminalUnderlinedText(page, nodeId) {
  return page.evaluate((nextNodeId) => {
    const rows = document.querySelector(`[data-node-id="${nextNodeId}"] .xterm-rows`);
    if (!(rows instanceof HTMLElement)) {
      return '';
    }

    return Array.from(rows.querySelectorAll('span'))
      .filter((span) => span instanceof HTMLElement && span.style.textDecoration.includes('underline'))
      .map((span) => span.textContent ?? '')
      .join('');
  }, nodeId);
}

async function readFirstTerminalUnderlinedPoint(page, nodeId) {
  return page.evaluate((nextNodeId) => {
    const rows = document.querySelector(`[data-node-id="${nextNodeId}"] .xterm-rows`);
    if (!(rows instanceof HTMLElement)) {
      return null;
    }

    const span = Array.from(rows.querySelectorAll('span')).find(
      (entry) => entry instanceof HTMLElement && entry.style.textDecoration.includes('underline')
    );
    if (!(span instanceof HTMLElement)) {
      return null;
    }

    const rect = span.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, nodeId);
}

async function readHardWrappedLinkHoverSegmentCount(page, nodeId) {
  return page.evaluate((nextNodeId) => {
    return document.querySelectorAll(
      `[data-node-id="${nextNodeId}"] .execution-hard-wrapped-link-hover-segment`
    ).length;
  }, nodeId);
}

async function readLastHardWrappedLinkHoverSegmentPoint(page, nodeId) {
  return page.evaluate((nextNodeId) => {
    const segments = Array.from(
      document.querySelectorAll(`[data-node-id="${nextNodeId}"] .execution-hard-wrapped-link-hover-segment`)
    ).filter((entry) => entry instanceof HTMLElement);
    const segment = segments.at(-1);
    if (!(segment instanceof HTMLElement)) {
      return null;
    }

    const rect = segment.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top
    };
  }, nodeId);
}

async function dragConnectionBetweenAnchors(page, { sourceNodeId, sourceAnchor, targetNodeId, targetAnchor }) {
  const sourceHandle = nodeById(page, sourceNodeId).locator(`.canvas-node-handle.anchor-${sourceAnchor}`);
  const targetHandle = nodeById(page, targetNodeId).locator(`.canvas-node-handle.anchor-${targetAnchor}`);

  await nodeById(page, sourceNodeId).hover();

  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();

  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 18
  });
  await page.mouse.up();
  await settleWebview(page, 3);
}

async function reconnectEdgeEndpointToAnchor(page, { edgeId, handleType, targetNodeId, targetAnchor }) {
  const edgeUpdater = page.locator(
    `[data-testid="rf__edge-${edgeId}"] .react-flow__edgeupdater-${handleType}`
  );
  const targetHandle = nodeById(page, targetNodeId).locator(`.canvas-node-handle.anchor-${targetAnchor}`);

  const edgeUpdaterBox = await edgeUpdater.boundingBox();
  const targetHandleBox = await targetHandle.boundingBox();

  expect(edgeUpdaterBox).not.toBeNull();
  expect(targetHandleBox).not.toBeNull();

  await page.mouse.move(
    edgeUpdaterBox.x + edgeUpdaterBox.width / 2,
    edgeUpdaterBox.y + edgeUpdaterBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetHandleBox.x + targetHandleBox.width / 2,
    targetHandleBox.y + targetHandleBox.height / 2,
    {
      steps: 18
    }
  );
  await page.mouse.up();
  await settleWebview(page, 3);
}

async function dispatchExecutionSnapshot(
  page,
  {
    nodeId,
    kind,
    output,
    cols = 96,
    rows = 28,
    liveSession = true,
    requestId,
    executionSessionId,
    outputSequence,
    serializedTerminalState
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
      liveSession,
      requestId,
      executionSessionId,
      outputSequence,
      serializedTerminalState
    }
  );
}

async function dispatchExecutionOutput(page, { nodeId, kind, chunk, executionSessionId, persisted, outputSequence }) {
  await page.evaluate(
    (payload) => {
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/executionOutput',
        payload
      });
    },
    {
      nodeId,
      kind,
      chunk,
      executionSessionId,
      persisted,
      outputSequence
    }
  );
}

async function dispatchExecutionExit(page, { nodeId, kind, message }) {
  await page.evaluate(
    (payload) => {
      window.__devSessionCanvasHarness.dispatchHostMessage({
        type: 'host/executionExit',
        payload
      });
    },
    {
      nodeId,
      kind,
      message
    }
  );
}

async function createSerializedTerminalStateFromOutput(output, cols = 96, rows = 28, scrollback = 1000) {
  const terminal = new HeadlessTerminal({
    allowProposedApi: true,
    cols,
    rows,
    scrollback
  });
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(serializeAddon);

  await new Promise((resolve) => {
    terminal.write(output, () => resolve());
  });

  const serializedTerminalState = {
    format: 'xterm-serialize-v1',
    data: serializeAddon.serialize({
      scrollback,
      excludeAltBuffer: false,
      excludeModes: false
    }),
    viewportY: terminal.buffer.active.viewportY >= 0 ? terminal.buffer.active.viewportY : undefined
  };
  terminal.dispose();
  serializeAddon.dispose();
  return serializedTerminalState;
}

function createFullscreenSerializedFixture(cols = 96, rows = 28) {
  const visibleLines = Array.from({ length: rows }, (_, index) => {
    const rowNumber = String(index + 1).padStart(2, '0');
    return `SERIALIZED-ROW-${rowNumber} viewport restore verification`;
  });

  return {
    cols,
    rows,
    output: `\u001b[?1049h\u001b[2J\u001b[H${visibleLines.join('\r\n')}`,
    visibleLines
  };
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

async function focusExecutionTerminal(page, nodeId) {
  await nodeById(page, nodeId).locator('.xterm-helper-textarea').focus();
  await settleWebview(page, 1);
}

async function dispatchTerminalShortcut(page, nodeId, shortcut, options = {}) {
  await page.evaluate(
    ({ nextNodeId, nextShortcut }) => {
      const textarea = document.querySelector(`[data-node-id="${nextNodeId}"] .xterm-helper-textarea`);
      if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error(`Execution terminal ${nextNodeId} has no xterm textarea.`);
      }
      textarea.focus();
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: nextShortcut.key,
          code: nextShortcut.code,
          keyCode: nextShortcut.keyCode,
          which: nextShortcut.keyCode,
          ctrlKey: nextShortcut.ctrlKey,
          metaKey: nextShortcut.metaKey,
          shiftKey: nextShortcut.shiftKey,
          altKey: false
        })
      );
    },
    {
      nextNodeId: nodeId,
      nextShortcut: shortcut
    }
  );
  if (options.settle !== false) {
    await settleWebview(page, 2);
  }
}

function executionTerminalCopyShortcutEvent() {
  if (process.platform === 'darwin') {
    return createTerminalShortcutEvent('c', { metaKey: true });
  }
  if (process.platform === 'win32') {
    return createTerminalShortcutEvent('c', { ctrlKey: true });
  }
  return createTerminalShortcutEvent('c', { ctrlKey: true, shiftKey: true });
}

function executionTerminalPasteShortcutEvent() {
  if (process.platform === 'darwin') {
    return createTerminalShortcutEvent('v', { metaKey: true });
  }
  if (process.platform === 'win32') {
    return createTerminalShortcutEvent('v', { ctrlKey: true });
  }
  return createTerminalShortcutEvent('v', { ctrlKey: true, shiftKey: true });
}

function createTerminalShortcutEvent(
  key,
  modifiers = {}
) {
  const normalizedKey = key.toLowerCase();
  return {
    key: normalizedKey,
    code: `Key${normalizedKey.toUpperCase()}`,
    keyCode: normalizedKey.toUpperCase().charCodeAt(0),
    ctrlKey: modifiers.ctrlKey === true,
    metaKey: modifiers.metaKey === true,
    shiftKey: modifiers.shiftKey === true
  };
}


async function doubleClickNotePreviewText(page, { nodeId, text, offset = Math.floor(text.length / 2) }) {
  await performTestDomAction(page, {
    kind: 'doubleClickNotePreviewText',
    nodeId,
    text,
    offset
  });
  await settleWebview(page, 3);
}

async function doubleClickNotePreviewSelector(page, { nodeId, selector }) {
  await performTestDomAction(page, {
    kind: 'doubleClickNotePreviewSelector',
    nodeId,
    selector
  });
  await settleWebview(page, 3);
}

async function expectCaretPosition(locator, expectedCaret) {
  await expect
    .poll(async () =>
      locator.evaluate((element) => ({
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd
      }))
    )
    .toEqual({
      selectionStart: expectedCaret,
      selectionEnd: expectedCaret
    });
}

async function expectSelectionRange(locator, expectedStart, expectedEnd) {
  await expect
    .poll(async () =>
      locator.evaluate((element) => ({
        selectionStart: element.selectionStart,
        selectionEnd: element.selectionEnd
      }))
    )
    .toEqual({
      selectionStart: expectedStart,
      selectionEnd: expectedEnd
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

async function simulateImeCompositionOnTextField(page, locator, value) {
  await locator.click();
  await locator.evaluate((field) => {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  });
  await settleWebview(page, 2);

  await locator.evaluate((field, nextValue) => {
    const prototype =
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(field, nextValue);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await settleWebview(page, 2);

  await locator.evaluate((field) => {
    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
        which: 229
      })
    );
  });
  await settleWebview(page, 2);

  await locator.evaluate((field, nextValue) => {
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: nextValue }));
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function expectTestDomActionError(page, action, expectedSubstring) {
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

        if (!result || result.payload.ok) {
          return null;
        }

        return result.payload.errorMessage ?? 'error';
      }, requestId);
    })
    .toContain(expectedSubstring);
}

function nodeById(page, nodeId) {
  return page.locator(`[data-node-id="${nodeId}"]`);
}

function expectBoxEdgesClose(actualBox, expectedBox, tolerance = 2) {
  expect(Math.abs(actualBox.x - expectedBox.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actualBox.y - expectedBox.y)).toBeLessThanOrEqual(tolerance);
  expect(
    Math.abs(actualBox.x + actualBox.width - (expectedBox.x + expectedBox.width))
  ).toBeLessThanOrEqual(tolerance);
  expect(
    Math.abs(actualBox.y + actualBox.height - (expectedBox.y + expectedBox.height))
  ).toBeLessThanOrEqual(tolerance);
}

async function waitForCreateDemoNodePayload(page, options = {}) {
  await expect
    .poll(async () => {
      return page.evaluate(() =>
        window.__devSessionCanvasHarness
          .getPostedMessages()
          .some((entry) => entry.type === 'webview/createDemoNode')
      );
    })
    .toBe(true);

  const payload = await page.evaluate(() => {
    const message = window.__devSessionCanvasHarness
      .getPostedMessages()
      .find((entry) => entry.type === 'webview/createDemoNode');

    if (!message) {
      throw new Error('Expected a pending webview/createDemoNode message.');
    }

    return message.payload;
  });

  return options.includeRequestId === true
    ? payload
    : normalizeCreateDemoNodePayloadForAssertion(payload);
}

function normalizeCreateDemoNodePayloadForAssertion(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const { requestId: _requestId, ...rest } = payload;
  return rest;
}

function createManualNoteNode(nodeId, position) {
  return {
    id: nodeId,
    kind: 'note',
    title: 'Note 2',
    status: 'ready',
    summary: '等待记录笔记内容。',
    position,
    size: sizeFor('note'),
    metadata: {
      note: {
        content: ''
      }
    }
  };
}

function createManualTerminalNode(nodeId, position) {
  return {
    id: nodeId,
    kind: 'terminal',
    title: 'Terminal 2',
    status: 'draft',
    summary: '尚未启动嵌入式终端。',
    position,
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
  };
}

function createGroupFocusCanvasState(group) {
  return {
    version: 1,
    updatedAt: '2026-06-09T00:00:00.000Z',
    nodes: [],
    groups: [group],
    edges: []
  };
}

function createEmptyCanvasState() {
  return {
    version: 1,
    updatedAt: '2026-04-06T00:00:00.000Z',
    nodes: []
  };
}

function createPaneGalleryCanvasState(options = {}) {
  const baseRootDefinitions = [
    ['workspace-root-frontend', 'Frontend', '/repo/frontend'],
    ['workspace-root-backend', 'Backend', '/repo/backend'],
    ['workspace-root-tools', 'Tools', '/repo/tools'],
    ['workspace-root-mobile', 'Mobile', '/repo/mobile'],
    ['workspace-root-docs', 'Docs', '/repo/docs'],
    ['workspace-root-cli', 'CLI', '/repo/cli'],
    ['workspace-root-services', 'Services', '/repo/services'],
    ['workspace-root-infra', 'Infra', '/repo/infra']
  ];
  const rootCount = options.rootCount ?? 2;
  const rootDefinitions = Array.from(
    { length: rootCount },
    (_, index) => baseRootDefinitions[index] ?? [
      `workspace-root-extra-${index + 1}`,
      `Root ${index + 1}`,
      `/repo/root-${index + 1}`
    ]
  );
  const groups = rootDefinitions.map(([id, title, workspaceRootPath], index) => ({
    id,
    title,
    position: { x: 120 + index * 860, y: 100 },
    size: options.hugeFirstRoot && index === 0
      ? { width: 12000, height: 8200 }
      : { width: 680, height: 460 },
    role: 'workspace-root',
    workspaceRootPath
  }));
  const nodes = groups.flatMap((group, index) => [
    {
      ...createManualNoteNode(`${group.id}-note`, {
        x: group.position.x + 120,
        y: group.position.y + 140
      }),
      title: `${group.title} Note`,
      groupId: group.id
    },
    {
      ...createManualTerminalNode(`${group.id}-terminal`, {
        x: group.position.x + (options.hugeFirstRoot && index === 0 ? 8200 : 360),
        y: group.position.y + (options.hugeFirstRoot && index === 0 ? 5600 : 140)
      }),
      title: `${group.title} Terminal`,
      status: index === 1 ? 'running' : 'draft',
      groupId: group.id
    }
  ]);

  return {
    version: 1,
    updatedAt: '2026-06-16T00:00:00.000Z',
    nodes,
    groups,
    edges: []
  };
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

function createDistantOverviewState() {
  const state = JSON.parse(JSON.stringify(createCanvasScreenshotState()));
  state.nodes[1] = {
    ...state.nodes[1],
    position: { x: 15000, y: 120 }
  };
  state.nodes[2] = {
    ...state.nodes[2],
    position: { x: 7200, y: 9000 }
  };
  return state;
}

function createFileNodeState() {
  return {
    version: 1,
    updatedAt: '2026-04-19T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-1',
        kind: 'agent',
        title: 'Agent 1',
        status: 'draft',
        summary: '尚未启动 Agent 会话。',
        position: { x: 80, y: 120 },
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
        id: 'file-src-main',
        kind: 'file',
        title: 'main.ts',
        status: 'linked',
        summary: 'src/main.ts',
        position: { x: 720, y: 200 },
        size: sizeFor('file'),
        metadata: {
          file: {
            fileId: 'file-src-main',
            filePath: '/workspace/src/main.ts',
            relativePath: 'src/main.ts',
            ownerNodeIds: ['agent-1'],
            icon: {
              kind: 'codicon',
              id: 'symbol-file'
            }
          }
        }
      }
    ],
    edges: [
      {
        id: 'agent-1::file-src-main',
        sourceNodeId: 'agent-1',
        targetNodeId: 'file-src-main',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'forward',
        owner: 'file-activity'
      }
    ],
    fileReferences: [
      {
        id: 'file-src-main',
        filePath: '/workspace/src/main.ts',
        relativePath: 'src/main.ts',
        updatedAt: '2026-04-19T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'write',
            updatedAt: '2026-04-19T00:00:00.000Z'
          }
        ]
      }
    ]
  };
}

function createFileListState() {
  return {
    version: 1,
    updatedAt: '2026-04-19T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-1',
        kind: 'agent',
        title: 'Agent 1',
        status: 'draft',
        summary: '尚未启动 Agent 会话。',
        position: { x: 80, y: 120 },
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
        id: 'agent-2',
        kind: 'agent',
        title: 'Agent 2',
        status: 'draft',
        summary: '尚未启动 Agent 会话。',
        position: { x: 80, y: 520 },
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
        id: 'file-list-shared',
        kind: 'file-list',
        title: '共享文件',
        status: 'linked',
        summary: '共 2 个共享文件',
        position: { x: 720, y: 280 },
        size: sizeFor('file-list'),
        metadata: {
          fileList: {
            scope: 'shared',
            entries: [
              {
                fileId: 'shared-src-shared',
                filePath: '/workspace/src/shared.ts',
                relativePath: 'src/shared.ts',
                accessMode: 'read-write',
                ownerNodeIds: ['agent-1', 'agent-2'],
                icon: {
                  kind: 'codicon',
                  id: 'symbol-file'
                }
              },
              {
                fileId: 'shared-docs-workflow',
                filePath: '/workspace/docs/WORKFLOW.md',
                relativePath: 'docs/WORKFLOW.md',
                accessMode: 'write',
                ownerNodeIds: ['agent-1', 'agent-2'],
                icon: {
                  kind: 'codicon',
                  id: 'markdown'
                }
              }
            ]
          }
        }
      }
    ],
    edges: [
      {
        id: 'agent-1::file-list-shared',
        sourceNodeId: 'agent-1',
        targetNodeId: 'file-list-shared',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'both',
        owner: 'file-activity'
      },
      {
        id: 'agent-2::file-list-shared',
        sourceNodeId: 'agent-2',
        targetNodeId: 'file-list-shared',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'forward',
        owner: 'file-activity'
      }
    ],
    fileReferences: [
      {
        id: 'shared-src-shared',
        filePath: '/workspace/src/shared.ts',
        relativePath: 'src/shared.ts',
        updatedAt: '2026-04-19T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'read-write',
            updatedAt: '2026-04-19T00:00:00.000Z'
          },
          {
            nodeId: 'agent-2',
            accessMode: 'write',
            updatedAt: '2026-04-19T00:00:00.000Z'
          }
        ]
      },
      {
        id: 'shared-docs-workflow',
        filePath: '/workspace/docs/WORKFLOW.md',
        relativePath: 'docs/WORKFLOW.md',
        updatedAt: '2026-04-19T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'write',
            updatedAt: '2026-04-19T00:00:00.000Z'
          },
          {
            nodeId: 'agent-2',
            accessMode: 'write',
            updatedAt: '2026-04-19T00:00:00.000Z'
          }
        ]
      }
    ]
  };
}

function createExplorerLikeFileListState() {
  return {
    version: 1,
    updatedAt: '2026-04-30T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-1',
        kind: 'agent',
        title: 'Agent 1',
        status: 'draft',
        summary: '尚未启动 Agent 会话。',
        position: { x: 80, y: 120 },
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
        id: 'file-list-shared',
        kind: 'file-list',
        title: '共享文件',
        status: 'linked',
        summary: '共 4 个共享文件',
        position: { x: 720, y: 280 },
        size: sizeFor('file-list'),
        metadata: {
          fileList: {
            scope: 'shared',
            entries: [
              {
                fileId: 'shared-src-webview-main',
                filePath: '/workspace/src/webview/main.tsx',
                relativePath: 'src/webview/main.tsx',
                accessMode: 'read-write',
                ownerNodeIds: ['agent-1'],
                icon: {
                  kind: 'codicon',
                  id: 'code'
                }
              },
              {
                fileId: 'shared-root-readme',
                filePath: '/workspace/README.md',
                relativePath: 'README.md',
                accessMode: 'read',
                ownerNodeIds: ['agent-1'],
                icon: {
                  kind: 'codicon',
                  id: 'markdown'
                }
              },
              {
                fileId: 'shared-src-extension',
                filePath: '/workspace/src/extension.ts',
                relativePath: 'src/extension.ts',
                accessMode: 'write',
                ownerNodeIds: ['agent-1'],
                icon: {
                  kind: 'codicon',
                  id: 'symbol-file'
                }
              },
              {
                fileId: 'shared-docs-guide',
                filePath: '/workspace/docs/guide.md',
                relativePath: 'docs/guide.md',
                accessMode: 'write',
                ownerNodeIds: ['agent-1'],
                icon: {
                  kind: 'codicon',
                  id: 'markdown'
                }
              }
            ]
          }
        }
      }
    ],
    edges: [
      {
        id: 'agent-1::file-list-shared',
        sourceNodeId: 'agent-1',
        targetNodeId: 'file-list-shared',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'both',
        owner: 'file-activity'
      }
    ],
    fileReferences: [
      {
        id: 'shared-src-webview-main',
        filePath: '/workspace/src/webview/main.tsx',
        relativePath: 'src/webview/main.tsx',
        updatedAt: '2026-04-30T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'read-write',
            updatedAt: '2026-04-30T00:00:00.000Z'
          }
        ]
      },
      {
        id: 'shared-root-readme',
        filePath: '/workspace/README.md',
        relativePath: 'README.md',
        updatedAt: '2026-04-30T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'read',
            updatedAt: '2026-04-30T00:00:00.000Z'
          }
        ]
      },
      {
        id: 'shared-src-extension',
        filePath: '/workspace/src/extension.ts',
        relativePath: 'src/extension.ts',
        updatedAt: '2026-04-30T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'write',
            updatedAt: '2026-04-30T00:00:00.000Z'
          }
        ]
      },
      {
        id: 'shared-docs-guide',
        filePath: '/workspace/docs/guide.md',
        relativePath: 'docs/guide.md',
        updatedAt: '2026-04-30T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'write',
            updatedAt: '2026-04-30T00:00:00.000Z'
          }
        ]
      }
    ]
  };
}

function createMultiRootFileListState() {
  return {
    version: 1,
    updatedAt: '2026-04-21T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-1',
        kind: 'agent',
        title: 'Agent 1',
        status: 'draft',
        summary: '尚未启动 Agent 会话。',
        position: { x: 80, y: 320 },
        size: sizeFor('agent'),
        metadata: {
          agent: {
            backend: 'node-pty',
            shellPath: 'codex',
            cwd: '/workspace-a',
            liveSession: false,
            provider: 'codex',
            lastCols: 96,
            lastRows: 28,
            lastBackendLabel: 'Codex CLI'
          }
        }
      },
      {
        id: 'file-list-shared',
        kind: 'file-list',
        title: '共享文件',
        status: 'linked',
        summary: '共 2 个共享文件',
        position: { x: 720, y: 280 },
        size: sizeFor('file-list'),
        metadata: {
          fileList: {
            scope: 'shared',
            entries: [
              {
                fileId: 'workspace-a-src-index',
                filePath: '/workspace-a/src/index.ts',
                relativePath: 'workspace-a/src/index.ts',
                accessMode: 'read-write',
                ownerNodeIds: ['agent-1'],
                icon: {
                  kind: 'codicon',
                  id: 'symbol-file'
                }
              },
              {
                fileId: 'workspace-b-src-index',
                filePath: '/workspace-b/src/index.ts',
                relativePath: 'workspace-b/src/index.ts',
                accessMode: 'write',
                ownerNodeIds: ['agent-1'],
                icon: {
                  kind: 'codicon',
                  id: 'symbol-file'
                }
              }
            ]
          }
        }
      }
    ],
    edges: [
      {
        id: 'agent-1::file-list-shared',
        sourceNodeId: 'agent-1',
        targetNodeId: 'file-list-shared',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'both',
        owner: 'file-activity'
      }
    ],
    fileReferences: [
      {
        id: 'workspace-a-src-index',
        filePath: '/workspace-a/src/index.ts',
        relativePath: 'workspace-a/src/index.ts',
        updatedAt: '2026-04-21T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'read-write',
            updatedAt: '2026-04-21T00:00:00.000Z'
          }
        ]
      },
      {
        id: 'workspace-b-src-index',
        filePath: '/workspace-b/src/index.ts',
        relativePath: 'workspace-b/src/index.ts',
        updatedAt: '2026-04-21T00:00:00.000Z',
        owners: [
          {
            nodeId: 'agent-1',
            accessMode: 'write',
            updatedAt: '2026-04-21T00:00:00.000Z'
          }
        ]
      }
    ]
  };
}

function createAgentNodeState(provider = 'codex') {
  const backendLabel = provider === 'claude' ? 'Claude Code CLI' : 'Codex CLI';
  const shellPath = provider === 'claude' ? 'claude' : 'codex';

  return {
    version: 1,
    updatedAt: '2026-04-06T00:00:00.000Z',
    nodes: [
      {
        id: 'agent-1',
        kind: 'agent',
        title: '实现自动化测试',
        status: 'idle',
        summary: `等待启动 ${backendLabel}。`,
        position: { x: 120, y: 140 },
        size: sizeFor('agent'),
        metadata: {
          agent: {
            backend: 'node-pty',
            shellPath,
            cwd: '/workspace',
            liveSession: false,
            provider,
            launchPreset: 'default',
            lastCols: 96,
            lastRows: 28,
            lastBackendLabel: backendLabel
          }
        }
      }
    ]
  };
}

function createStoppedAgentNodeState({ provider = 'codex', resumable = true } = {}) {
  const state = createAgentNodeState(provider);
  state.nodes[0].status = 'stopped';
  state.nodes[0].summary = resumable ? '检测到可恢复的原会话。' : '上一次 Agent 会话已结束。';
  state.nodes[0].metadata.agent = {
    ...state.nodes[0].metadata.agent,
    lifecycle: 'stopped',
    lastExitMessage: '上一次 Agent 会话已结束。',
    resumeStrategy: resumable ? (provider === 'claude' ? 'claude-session-id' : 'codex-session-id') : 'none',
    resumeSessionId: resumable ? 'session-123' : undefined,
    resumeStoragePath: resumable && provider === 'codex' ? undefined : undefined
  };
  return state;
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
  return createMultiLiveExecutionNodeState(kind, 1);
}

function createMultiLiveExecutionNodeState(kind, count) {
  const common = {
    version: 1,
    updatedAt: '2026-04-12T00:00:00.000Z',
    nodes: []
  };

  for (let index = 0; index < count; index += 1) {
    const suffix = index === 0 ? 'zoom' : `zoom-${index + 1}`;
    const position = { x: 120 + index * 620, y: 140 };

    if (kind === 'agent') {
      common.nodes.push({
        id: `agent-${suffix}`,
        kind: 'agent',
        title: index === 0 ? 'Zoom Agent' : `Zoom Agent ${index + 1}`,
        status: 'running',
        summary: '验证缩放后的鼠标拖选坐标。',
        position,
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
      continue;
    }

    if (kind === 'terminal') {
      common.nodes.push({
        id: `terminal-${suffix}`,
        kind: 'terminal',
        title: index === 0 ? 'Zoom Terminal' : `Zoom Terminal ${index + 1}`,
        status: 'live',
        summary: '验证缩放后的鼠标拖选坐标。',
        position,
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
      continue;
    }

    throw new Error(`Unsupported execution kind ${kind}`);
  }

  return common;
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
    case 'file':
      return { width: 220, height: 84 };
    case 'file-list':
      return { width: 320, height: 220 };
    default:
      throw new Error(`Unsupported kind ${kind}`);
  }
}
