# 动态画布概览缩放

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。计划目标是让节点增多或分散后，用户仍能通过缩小或点击 React Flow 左下角的 fit view 看到完整画布，同时在极低倍率下进入概览渲染，优先展示节点标题、类型、状态和连线，而不是继续把终端、笔记正文和文件列表细节当作可编辑主内容。

## 目标与全局图景

当前主画布在 `src/webview/main.tsx` 中把 React Flow 的 `minZoom` 固定为 `0.4`。当节点数量增加或空间分布变宽时，`0.4` 已经不足以把全部节点纳入视口，fit view 也会被这个固定下限卡住。完成本计划后，画布保留 `0.4` 作为日常编辑的舒适下限，但会根据全部节点外接矩形和当前 Webview 尺寸动态降低 `minZoom`；本次按用户要求不设置额外绝对下限。用户可以继续缩小直到完整概览可见，缩放低于 `0.35` 时画布进入概览模式，节点正文细节被弱化，标题、状态、轮廓、连线和 minimap 成为主要线索。

## 进度

- [x] (2026-05-10T16:06:30Z) 已读取 `docs/WORKFLOW.md`、`docs/DESIGN.md`、`docs/FRONTEND.md`、`docs/PLANS.md` 和既有画布导航设计，确认需要同步正式设计文档并创建主题分支。
- [x] (2026-05-10T16:06:30Z) 已从最新 `origin/main` 创建 `canvas-dynamic-overview-zoom` 分支。
- [x] (2026-05-10T16:25:00Z) 已在 `src/webview/main.tsx` 中实现动态 `minZoom`、fit view 选项复用和概览模式状态桥接。
- [x] (2026-05-10T16:25:00Z) 已在 `src/webview/styles.css` 中实现概览模式的低信息密度视觉。
- [x] (2026-05-10T16:25:00Z) 已更新 `docs/design-docs/` 正式设计文档与索引，记录动态缩放和不设绝对下限的决策。
- [x] (2026-05-10T16:25:00Z) 已补充 Playwright Webview 回归测试，覆盖分散节点下 fit view 可突破 `0.4`，以及低倍率概览模式生效。
- [x] (2026-05-10T16:35:00Z) 已运行 `npm run typecheck` 与 `npm run test:webview`，均通过。

## 意外与发现

- 观察：React Flow 的 fit view 可通过同一个动态 `minZoom` 同时约束初始 fit、控制栏 fit view 和手动 zoom out；单节点 `fitView` 仍可继续用独立的 `NODE_FOCUS_MIN_ZOOM` / `NODE_FOCUS_MAX_ZOOM`。
  证据：新增 Playwright 用例点击 `.react-flow__controls-fitview` 后读到 viewport scale 小于 `0.4`，且节点都进入浏览器视口。

## 决策记录

- 决策：继续把 `0.4` 作为舒适编辑下限，但不再作为全局最小缩放硬边界。
  理由：`0.4` 对日常编辑手感仍有价值，但完整概览能力需要随节点外接矩形动态变化。
  日期/作者：2026-05-10 / Codex。
- 决策：本次不设置额外绝对下限，动态最小值直接由全部节点 bounds、视口尺寸和 fit view padding 推导。
  理由：用户明确要求“除了设置绝对下限改成不设绝对下限之外，按照最终策略”实现；因此不引入 `HARD_MIN_ZOOM`。
  日期/作者：2026-05-10 / Codex。

## 结果与复盘

已完成动态全局最小缩放与概览模式实现。用户在节点远距离分散时可以点击 fit view 缩到 `0.4` 以下看全局；低于 `0.35` 时节点正文弱化，标题、状态、轮廓和连线保留为主要导航线索。本轮没有新增需要登记到 `docs/exec-plans/tech-debt-tracker.md` 的遗留技术债。

## 上下文与定向

主画布 Webview 实现在 `src/webview/main.tsx`。`App` 组件把宿主节点状态转换成 React Flow 节点，当前在 `<ReactFlow>` 上直接传入 `minZoom={0.4}` 和 `maxZoom={1.8}`，左下角 `<Controls>` 的 fit view 只传 `padding: CANVAS_FIT_VIEW_PADDING`。节点聚焦动作使用 `NODE_FOCUS_MIN_ZOOM = 0.55` 与 `NODE_FOCUS_MAX_ZOOM = 1.15`，这条路径服务单节点阅读，不应跟全局概览共用动态下限。

节点视觉样式在 `src/webview/styles.css`。执行节点的正文容器是 `.session-body` / `.terminal-frame`，Note 正文是 `.object-body` / `.note-surface`，文件列表正文是 `.file-list-body`，标题和状态主要位于 `.window-chrome`、`.file-list-minimal-header`、`.node-topline`、`.status-pill` 和 `.node-status`。

正式设计记录位于 `docs/design-docs/canvas-navigation-and-workbench-polish.md` 与 `docs/design-docs/index.md`。本变更改变画布缩放和导航的长期交互规则，因此需要同步这些文档。

## 工作计划

先把硬编码缩放常量改为命名常量：`CANVAS_COMFORT_MIN_ZOOM = 0.4`、`CANVAS_MAX_ZOOM = 1.8`、`CANVAS_OVERVIEW_ZOOM_THRESHOLD = 0.35`。在 `App` 中使用 `ResizeObserver` 跟踪 `.canvas-shell` 的宽高，并根据 `nodes` 的外接矩形计算 `dynamicCanvasMinZoom`。计算规则是用 React Flow 的节点 bounds、当前视口宽高和 `CANVAS_FIT_VIEW_PADDING` 推导“完整概览所需倍率”，再取 `Math.min(CANVAS_COMFORT_MIN_ZOOM, fitAllZoom)`；如果没有节点或尺寸不可用，回退到舒适下限。按用户要求，算法不再用 `Math.max` 套一个绝对硬下限。

然后把 `<ReactFlow>` 的 `minZoom` 改为 `dynamicCanvasMinZoom`，并把初始 fit view 和 `<Controls>` 的 fit view 都传入同一组 `padding`、`minZoom` 和 `maxZoom`，确保按钮不会被旧的 `0.4` 限制。节点聚焦继续保留现有 `0.55` 到 `1.15`。

最后在 React Flow 内新增一个轻量桥接组件读取当前 viewport zoom，并在 `zoom < 0.35` 时把 `.canvas-shell` 标记为概览模式。CSS 在该模式下隐藏或弱化正文编辑表面和操作按钮，保留标题、状态、节点边界、连线和 minimap。

## 具体步骤

在仓库根目录执行：

    git fetch origin main
    git checkout -b canvas-dynamic-overview-zoom

然后修改：

    src/webview/main.tsx
    src/webview/styles.css
    docs/design-docs/canvas-navigation-and-workbench-polish.md
    docs/design-docs/index.md
    tests/playwright/webview-harness.spec.mjs

验证命令为：

    npm run typecheck
    npm run test:webview

实际执行了新增用例定向验证，随后运行完整 `npm run test:webview` 收口。

## 验证与验收

验收标准是：在测试构造的多个远距离节点状态下，点击 fit view 后 persisted viewport 或 DOM transform 中的 zoom 小于 `0.4`，并且远端节点的 bounding box 出现在浏览器视口内；在 zoom 低于 `0.35` 的状态下，`.canvas-shell` 标记为概览模式，节点正文不可见或被弱化，而标题仍然可读。`npm run typecheck` 和 `npm run test:webview` 已通过。

## 幂等性与恢复

本计划只修改仓库内源代码、测试和文档。重复运行测试不会改变源文件；如果 Playwright 更新截图不是本任务目标，不应保留截图变更。若实现中发现动态下限导致现有聚焦测试失败，应优先检查全局 fit view 与单节点聚焦是否混用了下限，不能把 `NODE_FOCUS_MIN_ZOOM` 改成动态值。

## 证据与备注

    > dev-session-canvas@0.8.0 typecheck
    > tsc --noEmit

    通过。

    Running 1 test using 1 worker
      ✓ tests/playwright/webview-harness.spec.mjs › fit view can zoom below the comfort minimum and enters overview mode for distant nodes
    1 passed

    Running 128 tests using 1 worker
    128 passed
    Playwright webview tests passed.

本次修订说明：2026-05-10 完成实现、测试和文档同步；计划已具备移动到 `docs/exec-plans/completed/` 的条件。
