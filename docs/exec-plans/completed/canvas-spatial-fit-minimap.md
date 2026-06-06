# 画布空间边界 Fit View 与 MiniMap

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。该文件要求计划自包含、持续维护，并且每次关键决策变化都同步记录到本文。

## 目标与全局图景

这次变更要让用户点击画布左下角 `fit view` 后看到真正完整的画布空间，而不是只看到 React Flow 节点。完成后，普通用户分组、空分组、系统 workspace root section 以及多根 workspace 的所有 root section 都会进入全局 fit view 的边界计算。右下角 MiniMap 也会显示分组与 root section 的布局，让用户能从小地图看出整张组合画布的空间结构。

用户可观察的结果是：在 multi-root workspace 中，即使某个 root section 为空，点击全局 fit view 也会把所有 root section 放入视口；MiniMap 中可以看出 root section 的相对位置、普通用户分组的位置，以及节点的 attention 提示。

## 进度

- [x] (2026-06-04 03:29 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、分支规范、导航/分组/multi-root 相关设计与规格，确认本任务需要 ExecPlan 和正式文档同步。
- [x] (2026-06-04 03:29 +0800) 从当前 `feature/multi-root-composed-canvas-rewrite` 基线切出短生命周期主题分支 `canvas-spatial-fit-minimap`。
- [x] (2026-06-04 03:29 +0800) 记录产品决策：multi-root 下全局 fit view 默认包含所有 `workspace-root` section，而不是只 fit 当前 root 或节点子集。
- [x] (2026-06-04 04:07 +0800) 更新正式文档：导航设计/规格、节点分组设计/规格、多根 workspace 设计/规格和设计/规格索引已记录空间边界与 MiniMap 口径。
- [x] (2026-06-04 04:07 +0800) 实现 Webview 侧统一空间边界：节点、普通用户分组和 workspace root section 共用同一套 bounds。
- [x] (2026-06-04 04:07 +0800) 替换全局 fit view 与初始自动 fit 的 node-only React Flow 行为，改为 group/root-aware viewport 计算。
- [x] (2026-06-04 04:07 +0800) 替换 MiniMap 为自有 SVG MiniMap，保持现有视觉 token、attention data attributes 和 pannable/zoomable 行为，同时绘制 root section 与用户分组。
- [x] (2026-06-04 04:07 +0800) 补 Playwright 回归用例，覆盖空 root、大 root、多 root 布局、普通分组和 attention minimap 不回退。
- [x] (2026-06-04 04:07 +0800) 运行定向验证并把证据写回本文。
- [x] (2026-06-06 00:38 +0800) 按产品语义收口 MiniMap 分组颜色 token：普通 group 与 user group 不拆分 token，非 workspace-root 分组沿用主画布分组 body / border 的 panel token。
- [x] (2026-06-06 00:48 +0800) 调整 MiniMap 分组层级强度：普通分组提高透明度保证可辨，workspace root section 比普通分组更强并保留虚线系统边界。
- [x] (2026-06-06 00:55 +0800) 将 MiniMap 中分组和节点的 fill 颜色收口为与 stroke 相同的颜色来源，仅通过 opacity 与线宽表达层级。
- [x] (2026-06-06 01:02 +0800) 继续增强 MiniMap 分组区域透明度，让普通分组和 workspace root section 在缩略图中更容易分辨。
- [x] (2026-06-06 01:05 +0800) 按确认值固定 MiniMap 分组透明度：普通分组 fill/stroke opacity 为 0.85，workspace root fill/stroke opacity 为 1。
- [x] (2026-06-06 01:12 +0800) 试用主画布 group 选中/resize 强调色与 group border/stroke 同色，`--canvas-group-selection-color` 改为 `--canvas-group-panel-border`。
- [x] (2026-06-06 01:20 +0800) 试用主画布 group 选中态 focusBorder box-shadow 后，因效果不符合预期回退；group 选中态继续保持无额外 box-shadow。

## 意外与发现

- 观察：rebase 到 `feature/multi-root-composed-canvas-rewrite` 后，`CanvasGroupSummary` 新增 `role?: 'workspace-root'` 和 `workspaceRootPath?: string`，因此分组不再只有用户创建的空间组织对象。
  证据：`src/common/protocol.ts` 中 `CanvasGroupSummary` 已包含 `role` 与 `workspaceRootPath`；`src/common/canvasMultiRootComposition.ts` 中 `isWorkspaceRootGroup()` 用 `role === 'workspace-root'` 判定系统 root section。

- 观察：直接替换原生 MiniMap 后，右下角地图需要显式 `position: absolute`、`pointer-events: auto` 和 `event.preventDefault()`，否则 Playwright 拖拽不会稳定改变 React Flow 视口。
  证据：`minimap remains pannable with the viewport outline overlay` 在补齐上述处理后通过。

## 决策记录

- 决策：全局 fit view 在 multi-root 下默认包含所有 workspace root section。
  理由：用户点击全局 fit view 时期待看到整张组合画布；如果只 fit 节点或当前 root，空 root、大 root 和 root section 布局都会被隐藏，违背 multi-root 组合视图的全局心智。
  日期/作者：2026-06-04 / Codex，根据用户明确确认。

- 决策：不把 workspace root section 或普通用户分组转换成 React Flow node 来复用原生 MiniMap / fitView。
  理由：当前宿主权威状态把分组作为 `CanvasGroupSummary`，通过独立 group layer 渲染；把分组伪装成 React Flow node 会混淆“分组是空间容器，不是执行/文档节点”的产品模型，并可能破坏现有选择、拖拽、删除和 root-local 拆分策略。
  日期/作者：2026-06-04 / Codex。

- 决策：Webview 侧抽统一空间边界，而不是在 fit view 和 MiniMap 中各自重新计算。
  理由：fit view、动态最小缩放、初始自动 fit 和 MiniMap viewBox 都应回答同一个问题：当前画布有哪些空间对象。共用 helper 可以减少 node-only 回归和多根 root section 被遗漏的风险。
  日期/作者：2026-06-04 / Codex。

- 决策：MiniMap 中不维护“普通 group”和“user group”两套颜色 token。
  理由：`user group` 就是普通用户创建的非 workspace-root 分组；拆出额外颜色 token 会让产品语义看起来像两类不同对象。MiniMap 分组缩略区域应与主画布分组边框对齐，fill 与 stroke 都使用 `--vscode-panel-border`；workspace root section 也沿用这组 token，但应比普通分组更强，只通过 opacity、线宽和虚线描边表达系统 root 边界。MiniMap 节点缩略块也应让 fill 使用与 stroke 相同的类型色混合结果。
  日期/作者：2026-06-06 / Codex，根据用户指出的语义不一致收口。

## 结果与复盘

已完成本计划范围内的实现与定向验证。导航与 MiniMap 的空间理解已经从“只理解节点”升级为“理解节点、普通用户分组和系统 workspace root section”。全局 fit view、初始自动 fit、动态最小缩放和 MiniMap viewBox 共用 `resolveCanvasSpatialBounds()` 的合并空间边界；multi-root 下空 root section、大 root section、普通空分组和节点 attention MiniMap 属性都有 Playwright 覆盖。

验证证据：

    npm run typecheck
    npm run build
    node scripts/test/run-playwright-webview.mjs -g "minimap remains pannable|minimap viewport outline|fit view can zoom below|fit view includes empty workspace root|fit view includes empty user groups|fit view keeps a workspace root|minimap shows workspace root|workspace root group"
    git diff --check

上述命令于 2026-06-04 04:07 +0800 通过，其中定向 Playwright 共 9 个用例通过。未运行全量 `npm test`，因为本任务的变更面集中在 Webview 导航/MiniMap，且定向用例已经覆盖本计划验收标准；全量 Webview 套件历史上存在与本任务无直接关系的耗时/口径风险，应在后续发布前单独跑。

## 上下文与定向

当前主画布实现集中在 `src/webview/main.tsx`。React Flow 节点由 `toFlowNodes()` 转换，普通节点以 `CanvasFlowNode` 渲染；分组由 `CanvasGroupsViewportLayer` 通过独立 portal layer 渲染，不是 React Flow node。当前全局 fit view 的动态缩放下限由 `resolveDynamicCanvasMinZoom(nodes, canvasViewportSize)` 计算，左下角 `<Controls>` 的 fit button 通过 React Flow 原生 `fitViewOptions` 工作；右下角 `<MiniMap>` 也是 React Flow 原生组件，只会读取 React Flow nodes。

多根 workspace 组合视图由 `src/common/canvasMultiRootComposition.ts` 和 `src/panel/CanvasPanelManager.ts` 生成。每个 workspace folder 会生成一个 `CanvasGroupSummary`，其 `role` 为 `workspace-root`，表示系统 root section。系统 root section 可以移动和 resize，但不能删除、取消分组或重命名。它是 root-local 内容的硬容器，也是 multi-root overlay 中的整体空间对象。

本计划中的“空间边界”指一组画布坐标中的矩形：节点矩形、用户分组矩形、系统 root section 矩形。全局 fit view 应以这些矩形的合并外接框为输入。MiniMap 也应使用同一外接框计算 viewBox，使 nodes、groups、root sections 和 viewport outline 对齐。

## 工作计划

第一步更新文档。`docs/design-docs/canvas-navigation-and-workbench-polish.md` 与 `docs/product-specs/canvas-navigation-and-workbench-polish.md` 需要记录全局 fit view 和 MiniMap 使用统一空间边界；`docs/design-docs/canvas-node-groups.md` 与 `docs/product-specs/canvas-node-groups.md` 需要记录普通用户分组参与 fit view 和 MiniMap；`docs/design-docs/canvas-multi-root-workspace-support.md` 与 `docs/product-specs/canvas-multi-root-workspace-support.md` 需要记录 workspace root section 是 fit view 和 MiniMap 的一等空间对象。`docs/design-docs/index.md` 需要同步相关设计文档的关联计划与更新时间。

第二步修改 `src/webview/main.tsx`。新增空间边界 helper，输入当前渲染用的 `nodes` 与 `groups`，输出所有有效矩形、合并 bounds 和 MiniMap viewBox 所需信息。`resolveDynamicCanvasMinZoom()` 改为接受空间 bounds。全局 fit view 不再使用 React Flow 原生 node-only `fitView`，而是使用 `getViewportForBounds()` 或等价计算得到 viewport 并调用 `reactFlowInstance.setViewport()`。无 persisted viewport 的首次打开也通过同一 helper 执行一次 group-aware fit。

第三步替换 MiniMap。移除原生 `<MiniMap>` 依赖，新增 `CanvasMiniMap` 组件，保留 `.canvas-minimap`、`.react-flow__minimap-node`、attention data attributes 和现有遮罩/outline class，降低现有样式与测试迁移成本。绘制顺序为 workspace root section、普通用户分组、节点、viewport mask/outline。workspace root section 使用比普通分组更强的面和边框表示工程区域；普通用户分组使用可辨认但更克制的区域边界；节点使用现有类型颜色和 attention 动画。

第四步补测试。`tests/playwright/webview-harness.spec.mjs` 增加 fit view 与 MiniMap 用例：空 workspace root section 仍能被 fit；root section 比内部节点大时 fit 后完整可见；多 root section 在 MiniMap 可见；普通 user group 和 workspace root group 在 MiniMap 可区分；attention node 仍有 `data-minimap-attention-*` 属性。

## 具体步骤

在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas5` 执行以下命令。实现前确认工作区状态：

    git status --short --branch

更新文档后检查 diff：

    git diff -- docs/exec-plans/completed/canvas-spatial-fit-minimap.md docs/design-docs/canvas-navigation-and-workbench-polish.md docs/design-docs/canvas-node-groups.md docs/design-docs/canvas-multi-root-workspace-support.md docs/product-specs/canvas-navigation-and-workbench-polish.md docs/product-specs/canvas-node-groups.md docs/product-specs/canvas-multi-root-workspace-support.md docs/design-docs/index.md

实现后先运行 TypeScript 检查，再运行定向 Playwright：

    npm run typecheck
    node scripts/test/run-playwright-webview.mjs -g "fit view includes groups|minimap shows groups|workspace root group"

如果 Playwright 浏览器在当前宿主环境因权限问题失败，记录失败命令和错误摘要，并至少保留 `npm run typecheck` 与静态 diff 证据。

## 验证与验收

验收标准如下。第一，画布只有 workspace root section、没有节点时，点击 fit view 也能把 root section 放入可视区域。第二，root section 比内部节点大很多时，fit view 后 root section 的边界仍完整可见。第三，multi-root 布局中多个 root section 能同时出现在 MiniMap 上，用户能看出它们的相对位置。第四，普通用户分组也能出现在 MiniMap 中，但视觉层级低于节点 attention。第五，现有 minimap attention flash / size pulse 仍作用在节点上，`data-minimap-attention-pending`、`data-minimap-attention-flashing` 和 `data-minimap-attention-size-pulsing` 仍可由测试读取。

## 幂等性与恢复

文档更新和 Webview helper 修改可以重复应用，只要保持 `git diff` 可读。若自有 MiniMap 实现中出现交互回归，可以临时保留原生 MiniMap 代码作为对照，但最终不应让两套 MiniMap 同时常驻显示。不要删除或重置用户未提交改动；如果 rebase 或测试过程中发现非本任务改动，应停止并询问用户。

## 证据与备注

计划创建时的分支状态：

    ## canvas-spatial-fit-minimap

计划创建时的关键代码事实：`src/common/protocol.ts` 的 `CanvasGroupSummary` 含 `role?: CanvasGroupRole`，其中 `CanvasGroupRole = 'user' | 'workspace-root'`；`src/webview/main.tsx` 当前使用 React Flow 原生 `<MiniMap>` 和 `<Controls fitViewOptions={...}>`，它们默认只理解 nodes。

## 接口与依赖

在 `src/webview/main.tsx` 中需要存在以下内部结构，名称可按实现微调，但职责不能缺失：

    interface CanvasSpatialRect {
      id: string;
      kind: 'node' | 'group' | 'workspace-root';
      x: number;
      y: number;
      width: number;
      height: number;
    }

    interface CanvasSpatialBounds {
      rects: CanvasSpatialRect[];
      bounds?: { x: number; y: number; width: number; height: number };
    }

    function resolveCanvasSpatialBounds(nodes: readonly CanvasFlowNode[], groups: readonly CanvasGroupSummary[]): CanvasSpatialBounds;

全局 fit view 应通过 React Flow instance 的 `setViewport()` 改变视口，MiniMap 应使用 React/DOM 事件实现基本 pan/zoom。实现不新增运行时依赖；继续使用 React、React Flow 和现有 CSS token。

计划修订说明：2026-06-04 创建本计划，原因是 group-aware fit view 与 MiniMap 涉及正式导航语义、多根 root section 设计和 Webview UI 行为，属于复杂功能，必须按 `docs/PLANS.md` 维护 ExecPlan。
