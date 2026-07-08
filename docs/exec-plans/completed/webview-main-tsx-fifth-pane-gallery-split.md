# Webview main.tsx 第五阶段 paneGallery UI 拆分

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本计划遵循 `docs/PLANS.md`。

## 目标与全局图景

第四阶段已经把 Agent / Terminal 执行节点拆到 `executionSessionNodes.tsx`，`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 仍有 12,958 行，并继续包含多根 workspace 的 paneGallery UI。第五阶段目标是在不改变用户功能、布局模式、DOM selector、React Flow 配置、viewport 保存语义或拖拽 / 右键 / 缩略图行为的前提下，把 paneGallery UI 从入口文件拆到独立模块。完成后用户看到的多根 paneGallery `dynamic`、`grid`、`topThumbnails`、`sideThumbnails` 四种布局应保持一致；协作者可以在独立文件里 review paneGallery pane、thumbnail rail、controls 和 root pane 渲染。

本轮不拆 `App()` 主状态机，不改变 `PaneGalleryLocalState` 的持久化 shape，不重写 paneGallery 视口缓存、active root、fit scheduling 或 context menu 路由。入口继续持有 refs、状态更新、surface binding 和 Host/Webview 消息边界；新模块只承载 paneGallery 模型辅助和 UI surface。

## 进度

- [x] (2026-07-08 13:34+08:00) 确认当前分支 `webview-main-tsx-refactor` 已有四次重构提交，工作区干净；用户选择继续拆 paneGallery UI。
- [x] (2026-07-08 13:35+08:00) 建立本 ExecPlan，明确本轮只拆 paneGallery UI 与相关模型 helper，不改变 paneGallery local state 或 App 状态机。
- [x] (2026-07-08 15:05+08:00) 抽出 paneGallery model helper 与 UI surface 到 `extensions/vscode/dev-session-canvas/src/webview/paneGallerySurface.tsx`；`main.tsx` 通过 props/依赖传入 `t`、`tCount`、`nodeTypes`、`edgeTypes` 和动画时长。
- [x] (2026-07-08 15:05+08:00) 同步 `ARCHITECTURE.md` Webview 代码地图与 `docs/exec-plans/tech-debt-tracker.md`，记录 paneGallery UI 已离开入口、`main.tsx` 当前为 12,033 行。
- [x] (2026-07-08 15:09+08:00) 最终验证通过：`npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages`、`git diff --check`。
- [x] (2026-07-08 15:10+08:00) 归档本计划到 `docs/exec-plans/completed/`。
- [x] (2026-07-08 15:13+08:00) 已暂存本阶段改动；本计划随本阶段提交一并落地。

## 意外与发现

- 观察：新模块抽出后，最终验证命令均通过，说明 props 注入边界、bundle entry、执行节点 entry 检查、协议消息检查和 diff whitespace 检查都未发现回归。
  证据：2026-07-08 本地执行 `npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages`、`git diff --check` 均返回 exit 0。

## 决策记录

- 决策：第五阶段拆 paneGallery UI，但保留 paneGallery 状态更新、viewport refs、surface binding、fit scheduling 和 drop/context menu 路由在 `main.tsx`。
  理由：这些逻辑直接连接 `App()` 的当前 selection、viewport、root group、context menu、drag/drop 和 persisted local state；本轮只移动可复用 UI surface 能继续降低入口体积，又不扩大行为风险。
  日期/作者：2026-07-08 / Codex。

- 决策：新 paneGallery 模块不导入 `main.tsx`，而是由入口传入 `nodeTypes`、`edgeTypes`、`t`、`tCount` 和 `nodeFocusAnimationDurationMs`。
  理由：paneGallery 的 React Flow pane 需要复用入口组装好的节点/边类型和本地化函数；直接 import 入口会形成循环依赖。显式依赖让 `main.tsx` 保持组合根角色。
  日期/作者：2026-07-08 / Codex。

## 结果与复盘

已新增 `extensions/vscode/dev-session-canvas/src/webview/paneGallerySurface.tsx`，承载 paneGallery root model helper、布局控件、thumbnail rail、active placeholder 和 root pane 渲染；`main.tsx` 继续持有 paneGallery local state、refs、viewport 保存、surface binding、fit scheduling 与消息边界。`main.tsx` 当前从 12,958 行降到 12,033 行。本轮是行为保持重构，没有改变 paneGallery layout option、DOM data attribute、React Flow 配置、thumbnail activation、fit view、viewport save 或 group/node/edge callback 语义。

剩余技术债没有消失：`App()` 状态机、执行终端 controller / output drain、File/Note 节点和 test-only DOM bridge 仍在入口中。已在 `docs/exec-plans/tech-debt-tracker.md` 更新第五阶段收口范围和后续建议。

## 上下文与定向

仓库是 VS Code extension monorepo。Webview 入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`。paneGallery 是多根 workspace presentation mode，相关本地状态规范化已经在 `extensions/vscode/dev-session-canvas/src/webview/paneGalleryLocalState.ts`。当前 UI 组件仍在 `main.tsx` 中，包括 `PaneGallery`、`PaneGalleryThumbnailRail`、`PaneGalleryActiveRootPlaceholder`、`PaneGalleryControls`、`PaneGalleryModeControl` 和 `PaneGalleryRootPane`。模型辅助包括 `buildPaneGalleryRootModels(...)` 与 `resolvePaneGalleryModelContentBounds(...)`，入口的 `App()` 使用它们构造 root model 和执行 fit view。

paneGallery UI 内部会渲染嵌套 `ReactFlow`，复用入口的 `nodeTypes`、`edgeTypes`、`CanvasGroupsViewportLayer`、`CanvasMiniMap` 和 overview mode bridge。它还依赖 `paneGalleryLocalState.ts` 的布局类型与 `isPaneGalleryThumbnailLayout(...)`，以及 `canvasGraphRules.ts` 的 workspace-root containment helper 来构造 root model。本轮必须保持 DOM data attributes，例如 `data-pane-gallery`、`data-pane-gallery-layout`、`data-pane-gallery-root-id`、`data-pane-gallery-root-mode`、`data-pane-gallery-thumbnail-hit-layer`、`data-pane-gallery-mode-option` 等不变。

## 工作计划

创建 `extensions/vscode/dev-session-canvas/src/webview/paneGallerySurface.tsx`。该模块导出 `buildPaneGalleryRootModels(...)`、`resolvePaneGalleryModelContentBounds(...)` 和 `PaneGallery` React component。`PaneGallery` 的 props 继续由 `main.tsx` 提供所有状态、refs 和回调；新增 props 用于传入 `t`、`tCount`、`nodeTypes`、`edgeTypes` 和 `nodeFocusAnimationDurationMs`。模块内部移动原有 thumbnail rail、active placeholder、controls、mode menu、root pane 和 dynamic slot helper。

更新 `main.tsx` 时，移除 paneGallery UI 函数定义，改为从新模块 import。`App()` 现有 `<PaneGallery ...>` 调用只增加新增 props，不改变既有 callback、viewport、refs、selection 或 layout 参数。`main.tsx` 继续保留 `paneGalleryFlowRefs`、`paneGalleryShellRefs`、`bindPaneGallerySurface(...)`、`updatePaneGalleryLayout(...)`、`fitPaneGalleryRoot(...)` 和 drop/context menu handler。

同步文档时，更新 `ARCHITECTURE.md` Webview code map，说明 `paneGallerySurface.tsx` 是 paneGallery UI surface。更新 `docs/exec-plans/tech-debt-tracker.md` 中 Webview `main.tsx` 技术债行，把第五阶段已收口和剩余缺口写清楚，不把大文件债务写成完全解决。

## 具体步骤

所有命令从仓库根目录运行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8`。

先确认工作区：

    git status --short --branch
    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx

拆 paneGallery 后运行：

    npm run typecheck
    npm run build

当前执行记录：

    npm run typecheck && npm run build && npm run test:webview-build-xterm-entry && npm run test:protocol-webview-messages && git diff --check
    # exit 0

    webview xterm entry build tests passed
    protocol webview message tests passed

最终运行：

    npm run typecheck
    npm run build
    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check

如实际触碰 paneGallery Playwright selectors 或 test bridge，再补跑相关 Webview 测试；本轮预期只移动模块，不修改测试 selector 或协议。

## 验证与验收

验收标准是行为保持。TypeScript 类型检查通过，说明 paneGallery props、React Flow 类型和 helper import/export 边界一致；build 通过，说明 Webview bundle 仍能打包；Webview xterm entry 和 protocol 定向测试通过，说明拆分没有破坏执行节点 entry 或消息协议；`git diff --check` 通过，说明没有机械格式问题。

代码层面，`paneGallerySurface.tsx` 不应导入 `main.tsx`，不应调用 VS Code API，不应改变 paneGallery DOM selector、data attribute、layout option、thumbnail activation、fit view、viewport save 或 group/node/edge callback 行为。

## 幂等性与恢复

本轮是纯移动重构，可以重复运行 typecheck / build 验证。若新模块引入循环依赖或 props 类型不稳定，应调整依赖注入边界，不通过改用户行为来适配。不要使用 `git reset --hard` 或 `git checkout --` 回退整仓；如需撤销单个文件，先确认没有用户未提交改动。

## 证据与备注

初始现状：

    git status --short --branch
    ## webview-main-tsx-refactor...origin/main [ahead 4]

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx
    12958 extensions/vscode/dev-session-canvas/src/webview/main.tsx

上一轮提交：

    git log --oneline -1
    b193827 refactor(webview): 拆分执行节点模块

当前拆分后行数：

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx extensions/vscode/dev-session-canvas/src/webview/paneGallerySurface.tsx
      12033 extensions/vscode/dev-session-canvas/src/webview/main.tsx
       1009 extensions/vscode/dev-session-canvas/src/webview/paneGallerySurface.tsx
      13042 total

## 接口与依赖

`paneGallerySurface.tsx` 应导出：

    export function buildPaneGalleryRootModels(...): PaneGalleryRootModel[];
    export function resolvePaneGalleryModelContentBounds(model: PaneGalleryRootModel): CanvasMiniMapRect | undefined;
    export function PaneGallery(props: PaneGalleryProps): JSX.Element;

实际 props 可以按实现需要调整，但不得改变字段语义、selector 或回调行为。

本次修订说明：2026-07-08 创建第五阶段 paneGallery UI 拆分计划，记录范围、顺序、验证命令和行为保持边界。

本次修订说明：2026-07-08 完成 paneGallery UI 模块抽出，补充当前行数、文档同步状态和已通过的 typecheck / build 证据。

本次修订说明：2026-07-08 将第五阶段 ExecPlan 归档到 completed，并记录归档进度。

本次修订说明：2026-07-08 提交前更新最终进度，说明本计划随本阶段提交落地。
