# Webview main.tsx 第二阶段模块化拆分

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前任务是在已经完成第一阶段低耦合拆分后，继续对 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 做第二阶段行为保持重构。行为保持的含义是：不新增用户功能，不修改 Host/Webview 消息协议，不修改持久化状态结构，不修改 UI 文案，不改变节点、边、终端、Note 或 paneGallery 的运行语义。

## 目标与全局图景

`main.tsx` 第一阶段已从 19,233 行降到约 17.9k 行，但它仍同时承载 React Flow 节点、边、paneGallery、分组层、Note 编辑辅助、执行终端前端 controller、测试 DOM bridge 与 `App()` 主状态机。第二阶段的目标是继续把边界清楚、可独立命名、能用现有测试验证的代码搬出 `main.tsx`，让主入口更接近“组合层”。用户不应看到任何功能差异；协作者应能在更小的文件中 review 边渲染、paneGallery 或共享类型变化。

本轮不承诺把 `main.tsx` 一次降到很小，也不拆 `App()` 状态机。可观察结果是：`main.tsx` 行数继续下降；新增模块位于 `extensions/vscode/dev-session-canvas/src/webview/`；`npm run typecheck`、`npm run build` 和相关定向测试继续通过。

## 进度

- [x] (2026-07-08 08:27+08:00) 确认当前分支 `webview-main-tsx-refactor` 已基于 `origin/main`，前一轮重构已提交，工作区干净。
- [x] (2026-07-08 08:27+08:00) 建立本 ExecPlan，明确第二阶段仍只做行为保持模块拆分。
- [x] (2026-07-08 08:38+08:00) 第一批拆分 Webview 共享类型到 `canvasTypes.ts`，消除后续模块之间对 `main.tsx` 内部类型的依赖；`npm run typecheck` 通过。
- [x] (2026-07-08 08:43+08:00) 第二批拆分 Canvas edge 渲染和几何到 `canvasEdges.tsx`，并把 edge/group 选择约束移动到 `canvasGraphRules.ts`、DOM 事件 helper 移到 `canvasDomEvents.ts`；`npm run typecheck` 通过。
- [x] (2026-07-08 08:46+08:00) 第三批改拆 Note 编辑辅助到 `noteEditingSurface.ts`，包括行号、scroll/source offset 同步、preview 双击定位和 Tab indent glue；未拆 paneGallery UI 或 Webview test probe bridge。
- [x] (2026-07-08 08:52+08:00) 运行验证：`npm run typecheck`、`npm run build`、`npm run test:note-markdown-links`、`npm run test:note-markdown-checklists`、`npm run test:note-markdown-source-map`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages` 和 `git diff --check` 均通过；同步 `ARCHITECTURE.md` 与技术债记录，并归档本计划。

## 意外与发现

- 观察：`canvasTypes.ts` 中的 `CanvasOverviewViewportState`、`CanvasSpatialRect` 和 `PaneGalleryRootModel` 必须完全贴合 `main.tsx` 的真实字段，不能按名称猜测通用结构。
  证据：第一次移动类型后 `npm run typecheck` 暴露字段差异和 `Node` 类型 import 缺口；修正为 `active/titleScale`、`node|group|workspace-root`、`attentionTitleBarFlashing` 并改用 `CanvasFlowNode` 后类型检查通过。

## 决策记录

- 决策：第二阶段先拆共享类型和 Canvas edge，而不是先拆执行终端 controller 或 `App()` 状态机。
  理由：执行终端 controller 依赖全局 registry、xterm 内部接口、snapshot write queue、paste/link request 和 runtime context，先拆风险较高；Canvas edge 与 paneGallery 更接近局部渲染和纯几何，能通过 typecheck/build 与定向 Webview 测试验证。
  日期/作者：2026-07-08 / Codex。

- 决策：本轮新增模块仍留在 `extensions/vscode/dev-session-canvas/src/webview/`，不移动到 `src/common/`。
  理由：这些类型和组件仍依赖 React、React Flow、DOM 或 Webview 侧 callback，不是跨 Host/Webview/Supervisor 的稳定协议；放入 `common/` 会扩大架构语义。
  日期/作者：2026-07-08 / Codex。

- 决策：第三批不继续拆 paneGallery UI，改拆 Note 编辑辅助。
  理由：paneGallery 组件同时依赖 React Flow、`CanvasGroupsViewportLayer`、`CanvasOverviewModeBridge`、node/edge types、viewport fit 常量和多组回调，若本轮继续移动会形成很宽的参数面；Note 编辑辅助已在 Markdown renderer 外形成清楚边界，移动后可由现有 Note Markdown 定向测试覆盖。
  日期/作者：2026-07-08 / Codex。

## 结果与复盘

第二阶段已完成并归档：`canvasTypes.ts` 承载 Webview 内部共享类型，`canvasEdges.tsx` 承载 Canvas edge 渲染与几何，`canvasGraphRules.ts` 承载 Webview 侧分组/连线约束，`canvasDomEvents.ts` 承载共享 DOM 事件 helper，`noteEditingSurface.ts` 承载 Note 编辑辅助。`main.tsx` 从 17,939 行降到约 16.1k 行，仍保留 `App()` 状态机、节点组件、paneGallery UI、group layer、执行终端 controller 和 test DOM bridge。验证命令已通过，完整 `npm run test:webview` 的 RAF 环境 caveat 仍沿用第一阶段记录。

## 上下文与定向

仓库是 VS Code extension monorepo。主扩展位于 `extensions/vscode/dev-session-canvas/`。Webview 是 React / React Flow 前端，入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`。架构不变量来自 `ARCHITECTURE.md`：Extension Host 持有 workspace 绑定权威状态，Webview 只负责呈现、局部 UI 状态和用户意图；Webview 不直接访问文件系统或 CLI 进程。

第一阶段已经新增以下模块：`paneGalleryLocalState.ts` 负责 paneGallery 本地状态规范化；`noteMarkdownPreview.ts` 负责 Note Markdown 阅读态渲染与 source map DOM helper；`canvasGroupFrameStyles.ts` 负责 group frame CSS 变量、workspace root watermark 和 workspace-root role 判断。第二阶段应复用这些模块，不回搬逻辑。

当前 `main.tsx` 仍包含多类内部类型：`CanvasNodeData`、`CanvasEdgeData`、`CanvasFlowNode`、`CanvasFlowEdge`、`CanvasNodeLayoutDraft`、`CanvasNodeResizeDraft`、`CanvasContextMenuState`、`CanvasGroupDraft`、`PaneGalleryRootModel` 等。这些类型不属于跨边界协议，但多个 Webview 子模块需要共享，因此应先进入 `canvasTypes.ts`。

Canvas edge 区域从 `CANVAS_EDGE_ARROW_MENU_ITEMS` 到 `CanvasEdge`，主要依赖 React、React Flow 的 `EdgeLabelRenderer` / `Position` / `EdgeProps`、`canvasEdgePresetColors`、`WebviewI18nKey`、`CanvasEdgeData` 和几个来自 `main.tsx` 的小 helper：`t`、`stopCanvasEvent`、`isImeComposingKeyboardEvent`、`resolveCanvasEdgeArrowIcon`。拆分时可以让 `canvasEdges.tsx` 接收 `t` helper 或导出 `createCanvasEdgeTypes(t)`，但不应让它读取 `vscode`、`latestRuntimeContext` 或调用 `postMessage`。

## 工作计划

先创建 `extensions/vscode/dev-session-canvas/src/webview/canvasTypes.ts`。该文件只放 Webview 内部共享类型和少量不含运行时副作用的 type aliases。移动类型时要保持字段名、可选性和 callback 签名完全一致。`main.tsx`、后续 `canvasEdges.tsx` 和其他模块都从这里 import type。若某个类型只在 `main.tsx` 局部使用且迁移会带来循环，可以暂时留在原处；不要为了“看起来完整”强行移动。

第二步创建 `extensions/vscode/dev-session-canvas/src/webview/canvasEdges.tsx`。把 edge menu items、edge geometry 类型、几何 helper、`CanvasEdge` 组件和 `createCanvasEdgeOverlayStyle` 等一起移动。为了保持 i18n 初始化顺序，优先导出 `createCanvasEdgeTypes(deps)`，由 `main.tsx` 传入 `t`、`stopCanvasEvent`、`isImeComposingKeyboardEvent` 和 `resolveCanvasEdgeArrowIcon`，返回 `{ canvas: CanvasEdge }`。这样 `canvasEdges.tsx` 不需要导入 `main.tsx`，也不需要自己解析 i18n。若发现 `edgeTypes` 必须保持引用稳定，可在模块级创建一次，而不是在 `App()` render 内创建。

第三步根据耦合情况选择继续拆 paneGallery UI 或 test probe bridge。如果拆 paneGallery，需要把 `PaneGalleryRootModel`、pane 状态和 `PaneGallery` 组件一起移动，并继续从 `main.tsx` 传入 `nodeTypes`、`edgeTypes`、callbacks 和状态。若参数穿透变得过宽，停止在 edge 拆分，不强行继续。若拆 probe bridge，需要把 DOM query/dispatch 和 snapshot reader 移到 `webviewProbeBridge.ts`，但保留 registry 注入，避免直接读取 `main.tsx` 的 execution terminal registry。

同步文档时，更新 `ARCHITECTURE.md` 的 Webview code map，补充新模块说明。更新 `docs/exec-plans/tech-debt-tracker.md` 时应写“进一步收口但未完全解决”，因为 `App()` 状态机、执行终端 controller、节点组件和部分 test bridge 可能仍留在入口中。

## 具体步骤

所有命令从仓库根目录运行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8`。

先确认工作区：

    git status --short --branch
    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx

预期分支是 `webview-main-tsx-refactor`，且只有本计划引入的改动会出现在工作区。

移动类型后运行：

    npm run typecheck

移动 Canvas edge 后运行：

    npm run typecheck
    npm run build
    npm run test:protocol-webview-messages

最终运行：

    npm run typecheck
    npm run build
    npm run test:note-markdown-links
    npm run test:note-markdown-checklists
    npm run test:note-markdown-source-map
    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check

完整 `npm run test:webview` 在当前 headless Chromium 环境下已知可能因 `requestAnimationFrame` 不触发而超时；如果复跑仍失败，必须记录它和 `origin/main` baseline 的关系，不把它伪装成通过。

## 验证与验收

验收标准是行为保持。TypeScript 类型检查通过，说明拆分后的 import/export 类型边界一致；build 通过，说明 Webview IIFE 仍能打包；protocol/Webview build/Note Markdown 定向测试通过，说明协议、xterm entry 和已拆 Markdown 路径没有被新一轮移动破坏；`git diff --check` 通过，说明没有机械格式问题。

代码层面，`main.tsx` 行数应继续下降，新模块职责命名清晰。`canvasEdges.tsx` 不应导入 `main.tsx`，不应调用 VS Code API，不应改变 edge menu、label edit、arrow/color 选择或 delete callback 的行为。

## 幂等性与恢复

类型移动和组件移动可以重复执行，但每批移动后都应立即跑 `npm run typecheck` 或至少用 `rg` 确认旧定义不再重复存在。若某一批拆分导致循环依赖或需要改变运行时语义，应撤回该批具体文件改动，而不是修改功能行为来适配。不要使用 `git reset --hard` 或 `git checkout --` 回退整仓；如需撤销单个文件，先确认没有用户未提交改动。

## 证据与备注

初始现状：

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx
    17939 extensions/vscode/dev-session-canvas/src/webview/main.tsx

上一轮提交：

    git log -1 --oneline
    6147759 refactor webview main module boundaries

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/webview/canvasTypes.ts` 中至少导出：

    export interface LocalUiState { ... }
    export interface CanvasSurfaceBinding { ... }
    export interface CanvasNodeData { ... }
    export type CanvasFlowNode = Node<CanvasNodeData>;
    export interface CanvasEdgeData { ... }
    export type CanvasFlowEdge = Edge<CanvasEdgeData>;
    export type FileListViewMode = 'list' | 'tree';
    export type FileListEntrySelectionTone = 'active' | 'inactive';
    export interface CanvasNodeLayoutDraft { ... }
    export interface CanvasNodeResizeDraft { ... }
    export type CanvasNodeResizeDirection = ...;
    export interface CanvasContextMenuState { ... }
    export interface CanvasGroupDraft { ... }

实际导出可以按实现需要增减，但不得改变字段语义。

在 `extensions/vscode/dev-session-canvas/src/webview/canvasEdges.tsx` 中建议导出：

    export function createCanvasEdgeTypes(deps: CanvasEdgeDependencies): { canvas: React.ComponentType<EdgeProps<CanvasEdgeData>> };
    export function canConnectCanvasEdgeEndpoints(...): boolean;
    export function resolveCanvasEdgeStrokeColor(...): string;

其中 `CanvasEdgeDependencies` 至少包含 `t`、`stopCanvasEvent`、`isImeComposingKeyboardEvent` 和 `resolveCanvasEdgeArrowIcon`。如果某些 edge helper 仍被 `main.tsx` 调用，可单独 export，避免复制实现。

本次修订说明：2026-07-08 创建第二阶段拆分计划，记录范围、顺序、验证命令和行为保持边界。

本次修订说明：2026-07-08 完成 `canvasTypes.ts` 第一批拆分，记录类型字段差异发现和 typecheck 证据。

本次修订说明：2026-07-08 完成 edge、graph rules、DOM event helper 和 Note editing surface 拆分，记录不拆 paneGallery 的决策与阶段结果。

验证记录：

    npm run typecheck
    npm run build
    npm run test:note-markdown-links
    npm run test:note-markdown-checklists
    npm run test:note-markdown-source-map
    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check
    # 均通过

本次修订说明：2026-07-08 完成最终验证、文档同步和归档前复盘。
