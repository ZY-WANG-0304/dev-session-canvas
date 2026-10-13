# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: webview-harness.spec.mjs >> webview bundle emits ready and matches the baseline screenshot
- Location: tests/playwright/webview-harness.spec.mjs:281:1

# Error details

```
Error: expect(locator).toHaveScreenshot(expected) failed

Locator: locator('.canvas-shell')
  4319 pixels (ratio 0.01 of all image pixels) are different.

  Snapshot: canvas-shell-baseline.png

Call log:
  - Expect "toHaveScreenshot(canvas-shell-baseline.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - waiting for locator('.canvas-shell')
    - locator resolved to <div class="canvas-shell" data-canvas-overview-mode="false" data-canvas-overview-config="title">…</div>
  - taking element screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - attempting scroll into view action
    - waiting for element to be stable
  - 4319 pixels (ratio 0.01 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - waiting for locator('.canvas-shell')
    - locator resolved to <div class="canvas-shell" data-canvas-overview-mode="false" data-canvas-overview-config="title">…</div>
  - taking element screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - attempting scroll into view action
    - waiting for element to be stable
  - captured a stable screenshot
  - 4319 pixels (ratio 0.01 of all image pixels) are different.

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - button "执行节点使用提示：1. 拖拽文件到画布后按 Shift，再拖到终端或节点即可插入路径；2. Panel 模式下可拖拽画板标签页在底部面板与右侧辅助侧栏之间切换位置；3. 在设置中开启 devSessionCanvas.runtimePersistence.enabled 可持久化会话（会启动额外后台进程）；4. 如需让 Agent 完成后主动提醒，请先在对应的 Agent CLI（Claude Code 或 Codex）中启用通知。；5. Windows 环境下如果执行节点受 PowerShell 策略影响，请按系统安全要求完成对应设置后再重试。；6. 多根 workspace 可通过 devSessionCanvas.canvas.multiRootPresentationMode 在 rootGroups 单张组合画布和 paneGallery 窗格画廊之间切换。" [ref=e5] [cursor=pointer]:
    - generic [ref=e6]: 使用提示
  - generic [ref=e7]:
    - generic [ref=e9]:
      - generic:
        - img
        - generic:
          - button "workspace/ Agent 1 codex --model gpt-5 执行节点使用提示：1. 拖拽文件到画布后按 Shift，再拖到终端或节点即可插入路径；2. Panel 模式下可拖拽画板标签页在底部面板与右侧辅助侧栏之间切换位置；3. 在设置中开启 devSessionCanvas.runtimePersistence.enabled 可持久化会话（会启动额外后台进程）；4. 如需让 Agent 完成后主动提醒，请先在对应的 Agent CLI（Claude Code 或 Codex）中启用通知。；5. Windows 环境下如果执行节点受 PowerShell 策略影响，请按系统安全要求完成对应设置后再重试。；6. 多根 workspace 可通过 devSessionCanvas.canvas.multiRootPresentationMode 在 rootGroups 单张组合画布和 paneGallery 窗格画廊之间切换。 草稿 启动 删除 Agent 尚未启动 尚未启动 Agent 会话。" [ref=e10]:
            - generic [ref=e11]:
              - generic [ref=e16]:
                - generic [ref=e18]:
                  - generic [ref=e20]: workspace/
                  - textbox "Agent 标题" [ref=e21]: Agent 1
                  - generic [ref=e22]:
                    - generic [ref=e23]: codex --model gpt-5
                    - button "执行节点使用提示：1. 拖拽文件到画布后按 Shift，再拖到终端或节点即可插入路径；2. Panel 模式下可拖拽画板标签页在底部面板与右侧辅助侧栏之间切换位置；3. 在设置中开启 devSessionCanvas.runtimePersistence.enabled 可持久化会话（会启动额外后台进程）；4. 如需让 Agent 完成后主动提醒，请先在对应的 Agent CLI（Claude Code 或 Codex）中启用通知。；5. Windows 环境下如果执行节点受 PowerShell 策略影响，请按系统安全要求完成对应设置后再重试。；6. 多根 workspace 可通过 devSessionCanvas.canvas.multiRootPresentationMode 在 rootGroups 单张组合画布和 paneGallery 窗格画廊之间切换。" [ref=e24] [cursor=pointer]:
                      - generic [ref=e25]: 
                - generic [ref=e26]:
                  - generic [ref=e28]: 草稿
                  - button "启动" [ref=e29] [cursor=pointer]:
                    - generic [ref=e30]: 启动
                  - button "删除" [ref=e31] [cursor=pointer]:
                    - generic [ref=e32]: 删除
              - generic [ref=e34]:
                - generic [ref=e38]:
                  - generic:
                    - textbox "Terminal input"
                - generic:
                  - strong: Agent 尚未启动
                  - generic: 尚未启动 Agent 会话。
          - button "workspace/ Terminal 1 /bin/bash 执行节点使用提示：1. 拖拽文件到画布后按 Shift，再拖到终端或节点即可插入路径；2. Panel 模式下可拖拽画板标签页在底部面板与右侧辅助侧栏之间切换位置；3. 在设置中开启 devSessionCanvas.runtimePersistence.enabled 可持久化会话（会启动额外后台进程）；4. 如需让 Agent 完成后主动提醒，请先在对应的 Agent CLI（Claude Code 或 Codex）中启用通知。；5. Windows 环境下如果执行节点受 PowerShell 策略影响，请按系统安全要求完成对应设置后再重试。；6. 多根 workspace 可通过 devSessionCanvas.canvas.multiRootPresentationMode 在 rootGroups 单张组合画布和 paneGallery 窗格画廊之间切换。 草稿 启动 删除 终端尚未启动 尚未启动嵌入式终端。" [ref=e39]:
            - generic [ref=e40]:
              - generic [ref=e45]:
                - generic [ref=e47]:
                  - generic [ref=e49]: workspace/
                  - textbox "Terminal 标题" [ref=e50]: Terminal 1
                  - generic [ref=e51]:
                    - generic [ref=e52]: /bin/bash
                    - button "执行节点使用提示：1. 拖拽文件到画布后按 Shift，再拖到终端或节点即可插入路径；2. Panel 模式下可拖拽画板标签页在底部面板与右侧辅助侧栏之间切换位置；3. 在设置中开启 devSessionCanvas.runtimePersistence.enabled 可持久化会话（会启动额外后台进程）；4. 如需让 Agent 完成后主动提醒，请先在对应的 Agent CLI（Claude Code 或 Codex）中启用通知。；5. Windows 环境下如果执行节点受 PowerShell 策略影响，请按系统安全要求完成对应设置后再重试。；6. 多根 workspace 可通过 devSessionCanvas.canvas.multiRootPresentationMode 在 rootGroups 单张组合画布和 paneGallery 窗格画廊之间切换。" [ref=e53] [cursor=pointer]:
                      - generic [ref=e54]: 
                - generic [ref=e55]:
                  - generic [ref=e57]: 草稿
                  - button "启动" [ref=e58] [cursor=pointer]:
                    - generic [ref=e59]: 启动
                  - button "删除" [ref=e60] [cursor=pointer]:
                    - generic [ref=e61]: 删除
              - generic [ref=e63]:
                - generic [ref=e67]:
                  - generic:
                    - textbox "Terminal input"
                - generic:
                  - strong: 终端尚未启动
                  - generic: 尚未启动嵌入式终端。
          - button "回看 smoke test 保存为 Markdown 删除 Note 正文预览，按 Enter 或双击开始编辑" [ref=e68]:
            - generic [ref=e69]:
              - generic [ref=e74]:
                - textbox "Note 标题" [ref=e77]: 回看 smoke test
                - generic [ref=e78]:
                  - button "保存为 Markdown" [ref=e79] [cursor=pointer]:
                    - generic [ref=e80]: 保存为 Markdown
                  - button "删除" [ref=e81] [cursor=pointer]:
                    - generic [ref=e82]: 删除
              - generic "Note 正文预览，按 Enter 或双击开始编辑" [ref=e85]:
                - paragraph [ref=e87]: 第二层只覆盖主路径；第三层专注 Webview UI。
    - img [ref=e88]
    - img "画布缩略图" [ref=e91]
    - generic [ref=e96]:
      - button "zoom in" [ref=e97] [cursor=pointer]:
        - img [ref=e98]
      - button "zoom out" [ref=e100] [cursor=pointer]:
        - img [ref=e101]
      - button "适应视图" [ref=e103] [cursor=pointer]:
        - img [ref=e104]
```

# Test source

```ts
  191 |     },
  192 |     unsetVars: SPARSE_TERMINAL_THEME_UNSET_VARS
  193 |   }
  194 | };
  195 | const WORKBENCH_THEME_VAR_NAMES = Array.from(
  196 |   new Set(
  197 |     Object.values(WORKBENCH_THEME_FIXTURES).flatMap((fixture) => [
  198 |       ...Object.keys(fixture.themeVars),
  199 |       ...(fixture.unsetVars ?? [])
  200 |     ])
  201 |   )
  202 | );
  203 | 
  204 | test.beforeEach(async ({ page }) => {
  205 |   const pageDiagnostics = {
  206 |     consoleMessages: [],
  207 |     pageErrors: [],
  208 |     requestFailures: []
  209 |   };
  210 |   pageDiagnosticsByPage.set(page, pageDiagnostics);
  211 | 
  212 |   page.on('console', (message) => {
  213 |     pageDiagnostics.consoleMessages.push({
  214 |       type: message.type(),
  215 |       text: message.text(),
  216 |       location: message.location()
  217 |     });
  218 |   });
  219 | 
  220 |   page.on('pageerror', (error) => {
  221 |     pageDiagnostics.pageErrors.push({
  222 |       message: error.message,
  223 |       stack: error.stack ?? null
  224 |     });
  225 |   });
  226 | 
  227 |   page.on('requestfailed', (request) => {
  228 |     pageDiagnostics.requestFailures.push({
  229 |       url: request.url(),
  230 |       method: request.method(),
  231 |       resourceType: request.resourceType(),
  232 |       errorText: request.failure()?.errorText ?? null
  233 |     });
  234 |   });
  235 | });
  236 | 
  237 | test.afterEach(async ({ page }, testInfo) => {
  238 |   if (testInfo.status === testInfo.expectedStatus) {
  239 |     return;
  240 |   }
  241 | 
  242 |   const pageDiagnostics = pageDiagnosticsByPage.get(page) ?? {
  243 |     consoleMessages: [],
  244 |     pageErrors: [],
  245 |     requestFailures: []
  246 |   };
  247 |   const harnessDiagnostics = await page
  248 |     .evaluate(() => {
  249 |       const harness = window.__devSessionCanvasHarness;
  250 |       if (!harness) {
  251 |         return null;
  252 |       }
  253 | 
  254 |       return {
  255 |         postedMessages: harness.getPostedMessages(),
  256 |         persistedState: harness.getPersistedState()
  257 |       };
  258 |     })
  259 |     .catch(() => null);
  260 | 
  261 |   await fs.writeFile(
  262 |     testInfo.outputPath('playwright-page-diagnostics.json'),
  263 |     `${JSON.stringify(pageDiagnostics, null, 2)}\n`,
  264 |     'utf8'
  265 |   );
  266 | 
  267 |   if (harnessDiagnostics) {
  268 |     await fs.writeFile(
  269 |       testInfo.outputPath('harness-posted-messages.json'),
  270 |       `${JSON.stringify(harnessDiagnostics.postedMessages, null, 2)}\n`,
  271 |       'utf8'
  272 |     );
  273 |     await fs.writeFile(
  274 |       testInfo.outputPath('harness-persisted-state.json'),
  275 |       `${JSON.stringify(harnessDiagnostics.persistedState, null, 2)}\n`,
  276 |       'utf8'
  277 |     );
  278 |   }
  279 | });
  280 | 
  281 | test('webview bundle emits ready and matches the baseline screenshot', async ({ page }) => {
  282 |   await openHarness(page);
  283 |   await applyWorkbenchTheme(page, 'dark');
  284 |   await bootstrap(page, createCanvasScreenshotState());
  285 | 
  286 |   await expect(nodeById(page, 'agent-1').locator('[data-probe-field="provider"]')).toHaveCount(0);
  287 |   await expect(nodeById(page, 'agent-1').locator('[data-probe-field="title"]')).toHaveValue('Agent 1');
  288 |   await expect(nodeById(page, 'agent-1').locator('.window-title-subtitle')).toHaveText('codex --model gpt-5');
  289 |   await expect(nodeById(page, 'terminal-1').locator('[data-probe-field="title"]')).toHaveValue('Terminal 1');
  290 |   await expect(nodeById(page, 'note-1').locator('[data-probe-field="title"]')).toHaveValue('回看 smoke test');
> 291 |   await expect(page.locator('.canvas-shell')).toHaveScreenshot('canvas-shell-baseline.png', {
      |                                               ^ Error: expect(locator).toHaveScreenshot(expected) failed
  292 |     animations: 'disabled',
  293 |     caret: 'hide'
  294 |   });
  295 | });
  296 | 
  297 | test('canvas shell spans panel horizontal edges for single-root and multi-root layouts', async ({ page }) => {
  298 |   await openHarness(page);
  299 |   await applyWorkbenchTheme(page, 'dark');
  300 | 
  301 |   const assertPanelEdges = async (label, extraSelectors = []) => {
  302 |     const shellSelectors = ['html', 'body', '#app', '.canvas-shell'];
  303 |     const contract = await page.evaluate((selectors) => {
  304 |       const readLayer = (selector) => {
  305 |         const element = document.querySelector(selector);
  306 |         if (!(element instanceof HTMLElement)) {
  307 |           return null;
  308 |         }
  309 | 
  310 |         const rect = element.getBoundingClientRect();
  311 |         const style = getComputedStyle(element);
  312 |         return {
  313 |           selector,
  314 |           leftInset: Math.round(rect.left),
  315 |           rightInset: Math.round(window.innerWidth - rect.right),
  316 |           paddingLeft: style.paddingLeft,
  317 |           paddingRight: style.paddingRight,
  318 |           marginLeft: style.marginLeft,
  319 |           marginRight: style.marginRight
  320 |         };
  321 |       };
  322 | 
  323 |       return {
  324 |         viewportWidth: window.innerWidth,
  325 |         layers: selectors.map(readLayer)
  326 |       };
  327 |     }, [...shellSelectors, ...extraSelectors]);
  328 | 
  329 |     expect(contract.viewportWidth, `${label} viewport width`).toBeGreaterThan(0);
  330 |     for (const layer of contract.layers) {
  331 |       expect(layer, `${label} layer should exist`).not.toBeNull();
  332 |       expect(layer.leftInset, `${label} ${layer.selector} left inset`).toBe(0);
  333 |       expect(layer.rightInset, `${label} ${layer.selector} right inset`).toBe(0);
  334 |       expect(layer.marginLeft, `${label} ${layer.selector} left margin`).toBe('0px');
  335 |       expect(layer.marginRight, `${label} ${layer.selector} right margin`).toBe('0px');
  336 |       if (shellSelectors.includes(layer.selector)) {
  337 |         expect(layer.paddingLeft, `${label} ${layer.selector} left padding`).toBe('0px');
  338 |         expect(layer.paddingRight, `${label} ${layer.selector} right padding`).toBe('0px');
  339 |       }
  340 |     }
  341 |   };
  342 | 
  343 |   await bootstrap(page, createCanvasScreenshotState(), createRuntimeContext({ multiRootPresentationMode: 'rootGroups' }));
  344 |   await settleWebview(page, 4);
  345 |   await assertPanelEdges('single-root canvas', ['.react-flow']);
  346 | 
  347 |   const multiRootState = createPaneGalleryCanvasState();
  348 |   await bootstrap(page, multiRootState, createRuntimeContext({ multiRootPresentationMode: 'rootGroups' }));
  349 |   await settleWebview(page, 4);
  350 |   await assertPanelEdges('multi-root rootGroups canvas', ['.react-flow']);
  351 |   await expect(page.locator('[data-pane-gallery-root-running-title-block]')).toHaveCount(0);
  352 | 
  353 |   await bootstrap(page, multiRootState, createRuntimeContext({ multiRootPresentationMode: 'paneGallery' }));
  354 |   await settleWebview(page, 4);
  355 |   await assertPanelEdges('multi-root paneGallery canvas', ['.pane-gallery', '[data-pane-gallery-grid="true"]']);
  356 | 
  357 |   await page
  358 |     .locator('.pane-gallery-root-pane-tile[data-pane-gallery-root-id="workspace-root-frontend"] [data-pane-gallery-mode-trigger="true"]')
  359 |     .click();
  360 |   await expect(page.locator('[data-pane-gallery-layout="sideThumbnails"]')).toBeVisible();
  361 |   await assertPanelEdges('multi-root paneGallery thumbnail canvas', [
  362 |     '.pane-gallery',
  363 |     '.pane-gallery-thumbnail-layout'
  364 |   ]);
  365 | });
  366 | 
  367 | test('lifecycle identity acks bootstrap and ignores stale bootstrap frames', async ({ page }) => {
  368 |   await openHarness(page);
  369 |   const readyMessage = await waitForPostedMessageByType(page, 'webview/ready', { includeLifecycle: true });
  370 |   expect(readyMessage.lifecycle).toMatchObject({
  371 |     surface: 'panel',
  372 |     mode: 'active',
  373 |     generation: 1
  374 |   });
  375 |   expect(readyMessage.lifecycle.frameId).toMatch(/^frame-/);
  376 |   expect(readyMessage.payload.capabilities.terminalAvailableReceiptV1).toBe(true);
  377 | 
  378 |   const staleState = createEmptyCanvasState();
  379 |   const currentState = createCanvasScreenshotState();
  380 | 
  381 |   await page.evaluate(({ nextState, nextRuntime }) => {
  382 |     window.__devSessionCanvasHarness.clearPostedMessages();
  383 |     window.__devSessionCanvasHarness.dispatchHostMessage({
  384 |       type: 'host/bootstrap',
  385 |       lifecycle: {
  386 |         surface: 'panel',
  387 |         mode: 'active',
  388 |         generation: 0,
  389 |         frameId: 'frame-stale'
  390 |       },
  391 |       payload: {
```