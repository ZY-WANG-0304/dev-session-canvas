# Webview main.tsx 第三阶段模块化拆分

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前任务是在已经完成第一、第二阶段行为保持重构后，继续对 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 做第三阶段拆分。行为保持的含义是：不新增用户功能，不修改 Host/Webview 消息协议，不修改持久化状态结构，不修改 UI 文案，不改变节点、边、终端、Note、paneGallery、minimap 或分组层的运行语义。

## 目标与全局图景

`main.tsx` 已从约 19k 行降到约 16.1k 行，但它仍同时包含 `App()` 主状态机、节点组件、paneGallery UI、minimap、group layer、通用 chrome 编辑器、执行终端 controller 与测试 DOM bridge。第三阶段的目标是继续把边界清楚、可独立 review、且可由现有构建和定向测试覆盖的 Webview UI 模块搬出入口，让 `main.tsx` 更接近组合层。

本轮不承诺一次拆完所有节点或 `App()` 状态机。可观察结果是：`main.tsx` 行数继续下降；新增模块位于 `extensions/vscode/dev-session-canvas/src/webview/`；用户在画布缩放、minimap 导航、分组拖拽/缩放/标题编辑和节点标题编辑上不应看到任何行为差异；`npm run typecheck`、`npm run build` 和相关定向测试继续通过。

## 进度

- [x] (2026-07-08 09:24+08:00) 确认当前分支 `webview-main-tsx-refactor` 已有两次重构提交，工作区干净，并重读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/workflows/TECH_DEBT.md` 与 `docs/workflows/COMMIT.md` 的当前约束。
- [x] (2026-07-08 09:26+08:00) 建立本 ExecPlan，明确第三阶段仍只做行为保持拆分，首选拆 `canvasMiniMap.tsx` 与 `canvasGroupLayers.tsx`，不触碰执行终端 controller 和消息协议。
- [x] (2026-07-08 12:25+08:00) 拆出 `canvasMiniMap.tsx`，承载 minimap、overview bridge、canvas spatial bounds 与 viewport helper；`npm run typecheck` 通过。
- [x] (2026-07-08 12:25+08:00) 拆出 `canvasUiSurface.tsx` 与 `canvasGroupLayers.tsx`，承载 overview inert/title editor/通用输入 helper、分组背景/前景层、group frame、分组命中和拖拽/缩放几何；`npm run typecheck` 通过。
- [x] (2026-07-08 12:30+08:00) 同步 `ARCHITECTURE.md` 与 `docs/exec-plans/tech-debt-tracker.md`，记录第三阶段新增模块、`main.tsx` 约 14.1k 行和剩余未解决债务。
- [x] (2026-07-08 12:31+08:00) 运行最终验证：`npm run typecheck`、`npm run build`、Note Markdown 三项定向测试、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages` 和 `git diff --check` 均通过；准备归档本计划并提交。

## 意外与发现

- 观察：`CanvasNodeInteractionBoundary`、`resolveSelectedGroupIds` 和 `arraysEqual` 同在 `main.tsx` 顶部，第一次整体删除 overview helper 时误删了后两个纯状态 helper。
  证据：`npm run typecheck` 报 `resolveSelectedGroupIds`、`arraysEqual` 与 `shouldSelectExecutionNodeForTerminalSelection` 缺失；恢复这些仍属于入口本地状态/终端选择的小 helper 后类型检查通过。

## 决策记录

- 决策：第三阶段先拆 minimap 与 group layer，而不是拆执行终端 controller、全部节点组件或 paneGallery UI。
  理由：minimap 和 group layer 虽然涉及 React Flow viewport，但边界集中在视觉层、几何 helper 和回调注入；执行终端 controller 依赖 xterm 实例、snapshot queue、link/paste request、registry 和 runtime context，风险更高；全部节点组件和 paneGallery UI 的参数面更宽，容易把行为保持重构变成跨功能改造。
  日期/作者：2026-07-08 / Codex。

- 决策：新增模块继续留在 `extensions/vscode/dev-session-canvas/src/webview/`，不移动到 `src/common/`。
  理由：本轮模块依赖 React、React Flow、DOM、CSS selector 和 Webview 本地事件，不是 Host/Webview/Supervisor 共用协议类型；移动到 `common/` 会扩大架构含义并引入错误依赖方向。
  日期/作者：2026-07-08 / Codex。

- 决策：分组层若需要使用标题编辑、overview inert 和通用文本编辑快捷键，可以抽一个 Webview UI surface helper，但不得改变输入框提交、readonly select-all 或 `data-node-interactive` 选择器行为。
  理由：`CanvasGroupFrame` 复用 `ChromeTitleEditor`，而该编辑器也被节点组件使用；如果只为 group layer 复制一份编辑器会制造分叉，抽共享 helper 比复制更能降低维护成本。
  日期/作者：2026-07-08 / Codex。

## 结果与复盘

第三阶段已完成：新增 `canvasMiniMap.tsx`、`canvasUiSurface.tsx` 和 `canvasGroupLayers.tsx`，`main.tsx` 从 16,114 行降到 14,143 行。`canvasMiniMap.tsx` 承载 minimap、spatial bounds、viewport helper 与 overview bridge；`canvasUiSurface.tsx` 承载 overview inert、标题编辑、overflow 文本、编辑快捷键和选择/删除命中 helper；`canvasGroupLayers.tsx` 承载分组背景/前景层、group frame、分组命中排序与拖拽/缩放几何。最终验证通过。剩余技术债仍包括 `App()` 主状态机、执行终端 controller、节点组件、paneGallery UI 和 test-only DOM bridge。

## 上下文与定向

仓库是 VS Code extension monorepo。主扩展位于 `extensions/vscode/dev-session-canvas/`。Webview 是 React / React Flow 前端，入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`。架构不变量来自 `ARCHITECTURE.md`：Extension Host 持有 workspace 绑定权威状态，Webview 只负责呈现、局部 UI 状态和用户意图；Webview 不直接访问文件系统或 CLI 进程。

第一阶段已新增 `paneGalleryLocalState.ts`、`noteMarkdownPreview.ts`、`canvasGroupFrameStyles.ts`。第二阶段已新增 `canvasTypes.ts`、`canvasEdges.tsx`、`canvasGraphRules.ts`、`canvasDomEvents.ts`、`noteEditingSurface.ts`。第三阶段必须复用这些模块，不回搬逻辑。

当前 `main.tsx` 中与本轮相关的区域包括：`CanvasMiniMap`、`CanvasMiniMapNode`、`resolveCanvasSpatialBounds`、`mergeCanvasMiniMapRects` 和 `CanvasOverviewModeBridge`；以及 `CanvasGroupsViewportLayer`、`CanvasGroupBackgroundLayer`、`CanvasRootWatermarkLayer`、`CanvasGroupLayer`、`CanvasGroupFrame`、`findInnermostCanvasGroupBodyAtFlowPoint`、`findInnermostCanvasGroupFrameAtFlowPoint`、`readCanvasViewportTransform`、`resolveGroupDragPosition`、`resolveGroupResizeGeometry` 等分组层逻辑。

术语说明：minimap 指右下角小地图 SVG，它显示节点和分组缩略图，并允许拖拽/滚轮调整 React Flow viewport。group layer 指覆盖在 React Flow viewport 上的分组背景命中层和前景 chrome 层；它不是协议层 group 数据，只是 Webview 对 `CanvasGroupSummary[]` 的渲染与编辑入口。

## 工作计划

先创建 `extensions/vscode/dev-session-canvas/src/webview/canvasMiniMap.tsx`。该模块承载 minimap React 组件、viewBox 计算、viewport bounds 计算、spatial bounds 计算和 overview mode bridge。它可以从 `canvasTypes.ts` 引入 Webview 内部类型，从 `../common/protocol` 引入 `CanvasGroupSummary`、`CanvasNodeSummary`、`CanvasNodeKind`、`CanvasNodeMetadata`、`CanvasOverviewMode` 等协议类型，从 `canvasGroupFrameStyles.ts` 引入 workspace-root role 判断。它不应导入 `main.tsx`，也不应调用 `postMessage` 或读取 `latestRuntimeContext`。需要本地化文案时，由 `main.tsx` 创建组件时通过 `t` 注入，或由模块导出 factory；本轮优先使用 props/factory 注入，避免模块级 i18n 初始化顺序变化。

再创建 `extensions/vscode/dev-session-canvas/src/webview/canvasUiSurface.tsx`，只放跨节点和 group layer 共用的轻量 UI helper：overview interaction context、`canvasOverviewInertProps`、`ChromeTitleEditor`、`OverflowAwareText`、文本编辑快捷键 helper、`isInteractiveTarget`、`positionsEqual`、`footprintsEqual` 和 resize cursor helper。这个文件仍是 Webview 层，允许依赖 React 和 DOM，但不允许依赖 Host 消息或 runtime context。迁移后 `main.tsx` 的节点组件继续从该文件 import，避免 group layer 和节点标题编辑出现两份实现。

然后创建 `extensions/vscode/dev-session-canvas/src/webview/canvasGroupLayers.tsx`。该模块承载分组背景/前景层、group frame、排序/深度/命中 helper 和拖拽/缩放几何 helper。`CanvasGroupFrame` 通过依赖注入接收 `t`，通过 props 接收全部动作回调。它可以复用 `createCanvasGroupFrameStyle`、`CANVAS_GROUP_BODY_TOP_OFFSET`、`isWorkspaceRootCanvasGroupRole`、`stopCanvasEvent`、`ChromeTitleEditor`、`canvasNodeResizeCursorForDirection`、`positionsEqual`、`footprintsEqual` 与 `isInteractiveTarget`。DOM `data-*` selector、className、aria-label、title、event capture 行为必须保持原样，因为 Playwright probe 和真实交互依赖它们。

同步文档时，更新 `ARCHITECTURE.md` 的 Webview code map，补充 `canvasMiniMap.tsx`、`canvasUiSurface.tsx`、`canvasGroupLayers.tsx` 的职责。更新 `docs/exec-plans/tech-debt-tracker.md` 中 `Webview main.tsx 仍是大型组合入口` 的记录，写清第三阶段进一步收口但未完全解决，剩余缺口仍包括 `App()` 主状态机、执行终端 controller、节点组件、paneGallery UI 和 test probe bridge。

## 具体步骤

所有命令从仓库根目录运行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8`。

先确认工作区和行数：

    git status --short --branch
    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx

预期分支是 `webview-main-tsx-refactor`，且只有本计划引入的改动会出现在工作区。

拆 minimap 后运行：

    npm run typecheck

拆 group layer / UI surface 后运行：

    npm run typecheck
    npm run build

最终运行：

    npm run typecheck
    npm run build
    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check

如果本轮实际触碰 Note markdown 编辑路径，再补跑 `npm run test:note-markdown-links`、`npm run test:note-markdown-checklists` 和 `npm run test:note-markdown-source-map`。完整 `npm run test:webview` 在当前 headless Chromium 环境下已知可能因 `requestAnimationFrame` 不触发而超时；如果复跑仍失败，必须记录它和 `origin/main` baseline 的关系，不把它伪装成通过。

## 验证与验收

验收标准是行为保持。TypeScript 类型检查通过，说明拆分后的 import/export 类型边界一致；build 通过，说明 Webview IIFE 仍能打包；protocol/Webview build 定向测试通过，说明协议和 xterm entry 未被新一轮移动破坏；`git diff --check` 通过，说明没有机械格式问题。

代码层面，`main.tsx` 行数应继续下降，新模块职责命名清晰。`canvasMiniMap.tsx`、`canvasUiSurface.tsx` 和 `canvasGroupLayers.tsx` 不应导入 `main.tsx`，不应调用 VS Code API，不应改变 minimap、overview title mode、group background hit area、group title edit、drag/resize commit threshold 或 toolbar 行为。

## 幂等性与恢复

本轮拆分应按小批次执行，每批后运行 `npm run typecheck` 或至少用 `rg` 确认旧定义不再重复存在。若某一批拆分导致循环依赖或需要改变运行时语义，应撤回该批具体文件改动，而不是修改功能行为来适配。不要使用 `git reset --hard` 或 `git checkout --` 回退整仓；如需撤销单个文件，先确认没有用户未提交改动。

## 证据与备注

初始现状：

    git status --short --branch
    ## webview-main-tsx-refactor...origin/main [ahead 2]

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx
    16114 extensions/vscode/dev-session-canvas/src/webview/main.tsx

上一轮提交：

    git log --oneline -2
    4901154 refactor(webview): 拆分 main tsx 第二阶段模块
    6147759 refactor webview main module boundaries

## 接口与依赖

`canvasMiniMap.tsx` 建议导出：

    export function CanvasMiniMap(props: CanvasMiniMapProps): JSX.Element;
    export function CanvasOverviewModeBridge(props: CanvasOverviewModeBridgeProps): null;
    export function resolveCanvasSpatialBounds(nodes, groups): CanvasSpatialBounds;
    export function resolveDynamicCanvasMinZoom(spatialBounds, viewportSize): number;
    export function resolveViewportForCanvasRect(rect, viewportSize, minZoom): Viewport | undefined;
    export function rectForGroupLike(group): CanvasMiniMapRect;
    export function isPositiveFiniteNumber(value): boolean;
    export function mergeCanvasMiniMapRects(rects): CanvasMiniMapRect | undefined;
    export function resolveCanvasOverviewTitleScale(zoom): number;

`canvasUiSurface.tsx` 建议导出：

    export const CanvasOverviewInteractionContext: React.Context<boolean>;
    export function useCanvasOverviewInteractionsDisabled(): boolean;
    export function canvasOverviewInertProps(disabled): React.HTMLAttributes<HTMLElement>;
    export function ChromeTitleEditor(props): JSX.Element;
    export function OverflowAwareText(props): JSX.Element;
    export function handleEditableFieldKeyDown(event, submit, options?): void;
    export function shouldAllowReadonlyTextShortcutToBubble(event): boolean;
    export function shouldHandleReadonlySelectAllShortcut(event): boolean;
    export function isInteractiveTarget(target): boolean;
    export function positionsEqual(left, right): boolean;
    export function footprintsEqual(left, right): boolean;
    export function canvasNodeResizeCursorForDirection(direction): string;

`canvasGroupLayers.tsx` 建议导出：

    export function createCanvasGroupsViewportLayer(deps): React.ComponentType<CanvasGroupsViewportLayerProps>;
    export function findInnermostCanvasGroupBodyAtScreenPoint(...): CanvasGroupSummary | undefined;
    export function findInnermostCanvasGroupBodyAtFlowPoint(...): CanvasGroupSummary | undefined;
    export function findInnermostCanvasGroupFrameAtFlowPoint(...): CanvasGroupSummary | undefined;
    export function groupDepthForWebview(groups, groupId): number;

实际导出可以按实现需要增减，但不得改变字段语义、selector 或回调行为。

本次修订说明：2026-07-08 创建第三阶段拆分计划，记录范围、顺序、验证命令和行为保持边界。

本次修订说明：2026-07-08 完成 minimap、UI surface 与 group layer 拆分，记录 typecheck 证据和误删本地 helper 的发现。

验证记录：

    npm run typecheck
    # 通过

本次修订说明：2026-07-08 完成文档同步、最终验证和归档前复盘。

最终验证记录：

    npm run typecheck
    npm run build
    npm run test:note-markdown-links
    npm run test:note-markdown-checklists
    npm run test:note-markdown-source-map
    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check
    # 均通过
