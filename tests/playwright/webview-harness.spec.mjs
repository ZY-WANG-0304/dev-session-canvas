import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { SerializeAddon } from '@xterm/addon-serialize';
import xtermHeadless from '@xterm/headless';
import { expect, test } from '@playwright/test';

const { Terminal: HeadlessTerminal } = xtermHeadless;

const harnessUrl = pathToFileURL(
  path.join(process.cwd(), 'tests', 'playwright', 'harness', 'webview-harness.html')
).href;
const pageDiagnosticsByPage = new WeakMap();
const TERMINAL_VIEWPORT_ZOOM = 1.6;
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
  const handle = fileNode.locator('.canvas-node-resize-handle.bottom.right');
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
  expect(nextLayout.size.width).toBeGreaterThanOrEqual(80);
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
      node.renderedWidth >= 80 &&
      node.renderedHeight >= 24
  );
  expect(probeNode.renderedWidth).toBeLessThan(96);
  expect(probeNode.renderedWidth).toBeGreaterThanOrEqual(80);
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

test('canvas renders a shared execution help entry with tooltip text', async ({ page }) => {
  await openHarness(page);
  await bootstrap(page, createRuntimeChromeState());

  const helpTrigger = page.locator('.canvas-help-panel .execution-help-trigger-canvas');

  await expect(helpTrigger).toBeVisible();
  await expect(helpTrigger).toContainText('使用提示');
  await helpTrigger.hover();
  await expect(page.locator('.execution-node-help-tooltip.is-visible')).toContainText('执行节点使用提示');
  await expect(page.locator('.execution-node-help-tooltip.is-visible')).toContainText(
    '1. 拖拽文件到 Canvas 后按 Shift，再拖到终端或节点即可插入路径'
  );
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

  test(`${executionKind} unresolved file-like paths fall back to search links while plain words do not`, async ({
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

    await expectTestDomActionError(
      page,
      {
        kind: 'activateExecutionLink',
        nodeId,
        text: searchWordText
      },
      'was not detected'
    );
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

  test(`${executionKind} trims attached CJK prose prefixes from unresolved file-like paths`, async ({
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
    await clearPostedMessages(page);

    await performTestDomAction(page, {
      kind: 'activateExecutionLink',
      nodeId,
      text: cleanPathText
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
              text: cleanPathText,
              searchText: cleanPathText,
              contextLine: proseAttachedLine,
              bufferStartLine: 0,
              source: 'word'
            }
          }
        ])
      );
  });

  test(`${executionKind} trims CJK punctuation and detects multiple directory links in one Chinese sentence`, async ({
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
              source: 'refined'
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
  await expect(menu.locator('[data-context-menu-kind="agent"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-kind="terminal"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-kind="note"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-agent-action="show-providers"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-agent-action="show-providers"] .codicon-chevron-right')).toBeVisible();

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

test('right-click create menu can drill into agent providers and create claude directly', async ({ page }) => {
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
  await menu.locator('[data-context-menu-agent-action="show-providers"]').click();
  await expect(menu.locator('[data-context-menu-back="true"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-back="true"] .codicon-chevron-left')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="codex"]')).toBeVisible();
  await expect(menu.locator('[data-context-menu-provider="claude"]')).toBeVisible();

  await menu.locator('[data-context-menu-provider="claude"]').click();

  await expect(menu).toBeHidden();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/createDemoNode');

        return message ? JSON.stringify(message.payload) : null;
      });
    })
    .toBe(
      JSON.stringify({
        kind: 'agent',
        preferredPosition: {
          x: 760,
          y: 305
        },
        agentProvider: 'claude'
      })
    );
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
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/createDemoNode');

        return message ? JSON.stringify(message.payload) : null;
      });
    })
    .toBe(
      JSON.stringify({
        kind: 'agent',
        preferredPosition: {
          x: 800,
          y: 325
        }
      })
    );
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
  await expect(menu.locator('[data-context-menu-agent-action="create-default"]')).toContainText('默认：Claude Code');

  await menu.locator('[data-context-menu-agent-action="create-default"]').click();

  await expect(menu).toBeHidden();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const message = window.__devSessionCanvasHarness
          .getPostedMessages()
          .find((entry) => entry.type === 'webview/createDemoNode');

        return message ? JSON.stringify(message.payload) : null;
      });
    })
    .toBe(
      JSON.stringify({
        kind: 'agent',
        preferredPosition: {
          x: 730,
          y: 285
        }
      })
    );
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
    terminalScrollback: 1000,
    editorMultiCursorModifier: 'alt',
    terminalWordSeparators: ' ()[]{}\',"`',
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

async function waitForPostedMessageByType(page, type) {
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

  return matchedMessage;
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
      serializedTerminalState
    }
  );
}

async function dispatchExecutionOutput(page, { nodeId, kind, chunk }) {
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
      chunk
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
            lastCols: 96,
            lastRows: 28,
            lastBackendLabel: backendLabel
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
    case 'file':
      return { width: 220, height: 84 };
    case 'file-list':
      return { width: 320, height: 220 };
    default:
      throw new Error(`Unsupported kind ${kind}`);
  }
}
