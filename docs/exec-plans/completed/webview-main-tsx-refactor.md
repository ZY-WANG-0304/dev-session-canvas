# Webview main.tsx 模块化重构

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前任务是一次有意限制范围的技术债收口：只把 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中已经存在的逻辑拆到更小模块，不新增用户功能、不改变协议、不改变 UI 文案、不改变运行时行为。

## 目标与全局图景

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 当前超过一万九千行，React 应用入口、React Flow 画布、节点组件、Note Markdown 渲染、内嵌终端前端、测试 DOM bridge、局部状态和工具函数混在同一个文件。完成本计划后，用户看到的画布行为应与变更前一致；协作者获得的收益是以后修改 Webview 时可以先定位到更小的模块，降低 review 成本和误改无关区域的风险。

这次重构的可观察结果不是新增按钮或新能力，而是：`main.tsx` 行数下降，一部分纯工具和局部 UI 逻辑进入 `extensions/vscode/dev-session-canvas/src/webview/` 下的新模块；`npm run typecheck` 和 `npm run build` 继续通过；定向 Webview / Markdown / protocol 测试不因拆分而改变结果。

## 进度

- [x] (2026-07-08 10:45+08:00) 从 `origin/main` 创建主题分支 `webview-main-tsx-refactor`。
- [x] (2026-07-08 10:52+08:00) 确认 `main.tsx` 为 `19,233` 行，且技术债追踪中没有独立记录“Webview 主入口单文件过大”。
- [x] (2026-07-08 11:00+08:00) 建立本 ExecPlan，明确本轮只做行为保持的模块拆分。
- [x] (2026-07-08 11:35+08:00) 登记技术债追踪，把 `main.tsx` 单文件过大作为独立技术债，并说明本轮只做部分收口。
- [x] (2026-07-08 11:14+08:00) 第一批拆分：移动 paneGallery 本地状态规范化到 `paneGalleryLocalState.ts`，移动 Note Markdown preview renderer / source map DOM helper 到 `noteMarkdownPreview.ts`。
- [x] (2026-07-08 11:24+08:00) 第二批拆分：移动 Canvas group frame style、workspace root watermark helper 和 workspace-root role 判断到 `canvasGroupFrameStyles.ts`；未继续拆 `App()`、执行终端 controller 或 test bridge。
- [x] (2026-07-08 11:31+08:00) 运行验证：`npm run typecheck`、`npm run build`、`npm run test:note-markdown-links`、`npm run test:note-markdown-checklists`、`npm run test:note-markdown-source-map`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages` 和 `git diff --check` 均通过。
- [x] (2026-07-08 11:40+08:00) 复盘结果，记录剩余技术债，并准备将本计划移入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：`main.tsx` 过大此前只以若干具体功能技术债间接出现，没有单独跟踪“主入口职责过载”。
  证据：`rg "main\.tsx|单文件|monolith|过大" docs/exec-plans/tech-debt-tracker.md docs/design-docs docs/exec-plans` 只找到具体功能债和路径引用，没有独立主题。


- 观察：完整 `npm run test:webview` 在当前 headless Chromium 环境下卡在测试 helper 的 `requestAnimationFrame` 等待；页面已发送 `webview/ready`，无 page error。
  证据：单条 `webview bundle emits ready` 失败诊断中 `harness-posted-messages.json` 包含 `webview/ready`；内联 Playwright probe 显示 `requestAnimationFrame` 2 秒内不触发，而 `setTimeout` 正常。

- 观察：上述 `requestAnimationFrame` 不触发不是本轮重构引入。
  证据：临时 worktree 基于 `origin/main` 构建后运行相同内联 Playwright probe，`rafFired: false` 同样复现。

## 决策记录

- 决策：本轮不改用户功能，不改 `WebviewToHostMessage` / `HostToWebviewMessage` 协议，不改持久化状态结构，不改 UI 文案。
  理由：用户明确要求“针对 main.tsx 不做任何功能修改，只进行重构”。任何行为变化都会降低 MR 可审查性。
  日期/作者：2026-07-08 / Codex。

- 决策：优先拆低耦合模块，不先拆 `App()` 状态机和执行终端 controller。
  理由：`App()` 和 execution terminal controller 与宿主消息、局部状态、React lifecycle 强耦合，先拆容易引入行为漂移；Note Markdown renderer、paneGallery 状态规范化等模块更接近纯逻辑，可通过 typecheck/build 和已有测试验证。
  日期/作者：2026-07-08 / Codex。

## 结果与复盘

本轮完成了行为保持的第一阶段模块化重构：`main.tsx` 从 19,233 行降到约 17.9k 行，新增 `paneGalleryLocalState.ts`、`noteMarkdownPreview.ts` 和 `canvasGroupFrameStyles.ts`。这次没有新增用户功能，没有改变 Host/Webview 消息协议，也没有改变持久化状态结构。剩余技术债已经登记：`App()` 状态机、执行终端 controller、节点组件和 test-only DOM bridge 仍留在大型入口中，后续应继续分批拆分。

## 上下文与定向

仓库是 VS Code extension monorepo。主扩展位于 `extensions/vscode/dev-session-canvas/`。Webview 是 React / React Flow 前端，入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`，由 `scripts/build/build.mjs` 通过 esbuild 的 `webview` entry 打包成浏览器 IIFE。架构不变量来自 `ARCHITECTURE.md`：Extension Host 持有 workspace 绑定权威状态，Webview 只负责呈现、局部 UI 状态和用户意图；Webview 不直接访问文件系统或 CLI 进程。

当前 `main.tsx` 同时包含以下职责：

- React 应用入口 `App()` 和 `createRoot(rootElement).render(...)`。
- React Flow 节点与边的组件，例如 `AgentSessionNode`、`TerminalSessionNode`、`NoteEditableNode`、`CanvasGroupFrame`、`CanvasContextMenu`。
- 局部 UI 状态、选择态、视口、paneGallery 模式和上下文菜单。
- 内嵌 xterm 前端 controller、输出 drain、snapshot restore、clipboard / paste request 路由。
- Note Markdown preview 渲染、source map 注解、任务列表 checkbox、数学公式和图片链接安全处理。
- Webview test-only DOM action bridge 和 probe snapshot。

本轮目标是把明显可以独立命名的代码搬出 `main.tsx`，让入口文件逐步变成组合层。新模块必须继续位于 `extensions/vscode/dev-session-canvas/src/webview/`，除非逻辑已经完全跨边界通用且不依赖 DOM / React / VSCode Webview bootstrap，才考虑进入 `src/common/`。本轮默认不移动到 `common/`，避免扩大架构语义。

## 工作计划

先创建新模块并移动低耦合代码。第一批目标是 `paneGalleryLocalState.ts` 与 `noteMarkdownPreview.ts`。`paneGalleryLocalState.ts` 负责 `PaneGalleryLayoutMode`、`PaneGalleryLocalState` 和相关 normalize / resolve 函数；这些函数只依赖 React Flow 的 `Viewport` 类型和普通数据。`noteMarkdownPreview.ts` 负责 MarkdownIt renderer、HTML source map 注解、可渲染链接 / 图片判断、checkbox selector helper 和 `renderNoteMarkdownPreview`；它依赖 DOM、`highlight.js`、`katex`、`markdown-it` 和 `webviewI18n` 的翻译函数，但不应依赖 `App()` 或节点状态。

随后运行 `npm run typecheck` 与 `npm run build`。如果第一批拆分稳定，再选择第二批拆分目标。第二批只能选择边界清楚的模块，例如 canvas group watermark helpers、note body scroll / source offset helpers、test DOM action bridge 中的查询工具。若发现需要大范围参数穿透或改变函数签名，则停止在第一批，不强行继续。

技术债追踪需要同步记录：本轮是对 `main.tsx` 单文件过大的部分收口，不宣称完全解决。剩余 `App()`、执行终端 controller、节点组件和测试 bridge 仍可能留在 `main.tsx` 或继续拆分。

## 具体步骤

所有命令从仓库根目录运行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8`。

第一步，确认基线与当前结果：

    git status --short --branch
    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx

预期分支是 `webview-main-tsx-refactor`，工作区没有未解释的用户改动。

第二步，创建模块并移动代码。编辑应保持函数体行为一致，只做 import / export 和类型引用调整。移动后用 `rg` 确认旧定义不再留在 `main.tsx`，调用点改成 import。

第三步，运行验证：

    npm run typecheck
    npm run build

如果改动触及 Note Markdown renderer，补跑：

    npm run test:note-markdown-links
    npm run test:note-markdown-checklists
    npm run test:note-markdown-source-map

如果改动触及 Webview DOM 或 React 组件，视范围补跑：

    npm run test:webview -- --grep "<相关用例关键词>"

最后运行：

    git diff --check

## 验证与验收

验收标准是行为保持：

- TypeScript 类型检查通过，证明拆分后的 import / export 和浏览器目标类型一致。
- esbuild build 通过，证明 Webview IIFE 仍能打包，CSS 和第三方依赖仍可解析。
- Note Markdown 相关测试通过，证明 Markdown 链接、checkbox、source map 的既有行为没有被拆分破坏。
- `git diff --check` 通过，避免重构引入尾随空白等机械问题。
- `main.tsx` 行数下降，且新增模块职责命名清晰。

本计划不以新增功能、视觉变化或新的用户路径作为验收标准。

## 幂等性与恢复

代码移动可以重复执行，但每次移动后必须立即跑 typecheck 或至少 `npm run typecheck` 前的局部 `rg` 检查，避免在多个模块之间留下重复定义。若某一批拆分导致大量耦合问题，应直接回退该批拆分对应文件变更，而不是通过改变运行时行为来适配。不要使用 `git reset --hard` 或 `git checkout --` 回退整仓；如需撤销单个文件，先确认没有用户未提交改动。

## 证据与备注

初始现状：

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx
    19233 extensions/vscode/dev-session-canvas/src/webview/main.tsx

分支创建：

    git switch -c webview-main-tsx-refactor origin/main
    Branch 'webview-main-tsx-refactor' set up to track remote branch 'main' from 'origin'.

验证记录：

    npm run typecheck
    # tsc -p ./tsconfig.json --noEmit 通过

    npm run build
    # node scripts/build/build.mjs 通过

    npm run test:note-markdown-links
    npm run test:note-markdown-checklists
    npm run test:note-markdown-source-map
    # 三条 Note Markdown 定向测试均 passed

    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check
    # 均通过

完整 `npm run test:webview` 未作为本轮通过证据：它在当前环境下因 `requestAnimationFrame` 不触发超时，且同一 probe 在 `origin/main` 也复现。该现象已写入技术债记录，避免把它误判为本轮重构引入的行为差异。

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/webview/paneGalleryLocalState.ts` 中应导出：

    export type PaneGalleryLayoutMode = 'dynamic' | 'grid' | 'topThumbnails' | 'sideThumbnails';
    export type PaneGalleryOverviewLayoutMode = Extract<PaneGalleryLayoutMode, 'dynamic' | 'grid'>;
    export type PaneGalleryThumbnailLayoutMode = Extract<PaneGalleryLayoutMode, 'topThumbnails' | 'sideThumbnails'>;
    export interface PaneGalleryLocalState { ... }
    export function normalizePaneGalleryLocalState(value: unknown): PaneGalleryLocalState | undefined;
    export function filterPaneGalleryViewportRecord(...): Record<string, Viewport> | undefined;
    export function isPaneGalleryThumbnailLayout(layout: PaneGalleryLayoutMode): boolean;
    export function resolvePaneGalleryViewportRole(layout: PaneGalleryLayoutMode): 'overview' | 'main';
    export function resolvePaneGalleryLastOverviewLayout(...): PaneGalleryOverviewLayoutMode;
    export function resolvePaneGalleryLastThumbnailLayout(...): PaneGalleryThumbnailLayoutMode;

在 `extensions/vscode/dev-session-canvas/src/webview/noteMarkdownPreview.ts` 中应导出：

    export interface NoteMarkdownPreviewResult { html: string; frontMatter: NoteMarkdownFrontMatter; }
    export interface NoteMarkdownPreviewRenderOptions { imageBaseUri?: string; imageWorkspaceRoots: readonly NoteMarkdownImageWorkspaceRoot[]; }
    export const NOTE_MARKDOWN_LINK_SELECTOR = 'a[data-note-markdown-link="true"]';
    export const NOTE_MARKDOWN_CHECKLIST_SELECTOR = 'input.task-list-item-checkbox[data-note-markdown-task-line]';
    export const NOTE_MARKDOWN_SOURCE_TEXT_SELECTOR = '[data-note-markdown-source-offsets]';
    export const NOTE_MARKDOWN_SOURCE_BLOCK_SELECTOR = '[data-note-markdown-source-block="true"]';
    export function createNoteMarkdownPreviewRenderer(t: (key: WebviewI18nKey, params?: Record<string, string | number>) => string): NoteMarkdownPreviewRenderer;
    export function findNoteMarkdownLinkTarget(target: EventTarget | null): HTMLAnchorElement | null;
    export function findNoteMarkdownChecklistInputTarget(target: EventTarget | null): HTMLInputElement | null;
    export function readNoteMarkdownChecklistLineNumber(input: HTMLInputElement): number | null;
    export function readNoteMarkdownSourceStart(element: HTMLElement): number | null;
    export function readNoteMarkdownSourceEnd(element: HTMLElement): number | null;
    export function clampNoteMarkdownSourceOffset(offset: number, content: string): number;

`noteMarkdownPreview.ts` 可以依赖 DOM、`highlight.js`、`katex`、`markdown-it` 和 `markdown-it-task-lists`，因为它仍是 Webview 侧模块。它不能调用 `postMessage`、读取 `vscode.getState()` 或依赖 `App()` 内部状态。

本次修订说明：2026-07-08 创建计划，记录重构范围、第一批拆分目标、验证命令和行为保持边界。

本次修订说明：2026-07-08 完成本轮行为保持重构，补充验证结果、RAF 环境发现、剩余技术债与归档前复盘。
