# 优化 Add Folder to Workspace 的 root section 放置与聚焦

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。计划文件位于 `docs/exec-plans/completed/canvas-add-folder-root-placement.md`，必须保持自包含，并在实现、验证和关键决策变化时持续更新。

## 目标与全局图景

这次变更要让用户在 VSCode multi-root workspace 中执行 `Add Folder to Workspace` 后，新增工程的系统 root section 出现在当前画布视野附近的最近可用位置，而不是按 workspace folder index 掉到远处网格。新增 root section 生成后，当前画布 surface 会通过平移与缩放动画聚焦到它，让用户立即看到新 root 已加入组合画布。用户可观察的结果是：先在画布某处工作，再给 workspace 添加一个 folder；新 root section 会避开已有 root，并通过动画进入视野。

## 进度

- [x] (2026-06-09 10:00 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/FRONTEND.md` 和现有 multi-root / fit view 文档，确认本任务需要 ExecPlan 与正式设计同步。
- [x] (2026-06-09 10:10 +0800) 从 `origin/main` 创建 `canvas-add-folder-root-placement`；当前可清理的已合并本地分支中，`canvas-group-auto-resize-on-double-click` 因仍被其他 worktree checkout，无法安全删除。
- [x] (2026-06-09 10:35 +0800) 调研成熟算法与本仓库现状，确认使用“视口锚点 + 矩形 packing / overlap removal”而不是引入全图自动布局。
- [x] (2026-06-09 11:20 +0800) 实现新增 root section 就近放置：`composeMultiRootCanvasState()` 接收新增 root 与可见中心，用候选槽位搜索避开已有 root，并把结果写入 overlay。
- [x] (2026-06-09 11:45 +0800) 实现新增 root section 聚焦：Host 在 workspace folder 变化后发送 `host/focusGroup`，Webview 用 `getViewportForBounds()` 计算 root section bounds 对应 viewport，并用动画 `setViewport()` 平移缩放过去。
- [x] (2026-06-09 12:00 +0800) 补充 composition / protocol / Playwright Webview 回归，并运行定向测试与 `typecheck`。
- [x] (2026-06-09 19:35 +0800) 补充正式设计、产品规格与索引，把本计划移入 completed，并完成最终定向验证。

## 意外与发现

- 观察：现有 multi-root 默认位置只按 root index 与本轮最大 root 尺寸铺网格；当用户已经有 overlay 且新增 folder 排在第三个或更后时，新 root 可能落到当前视口外很远。
  证据：`src/common/canvasMultiRootComposition.ts` 原先直接用 `overlayRoot?.position ?? defaultRootSectionPosition(index, defaultGridSize)` 生成 root context。

- 观察：仓库已经有 root section 与普通 group 参与 fit view / MiniMap 的空间边界实现，适合直接复用 bounds-to-viewport，而不需要把 root section 伪装成 React Flow node。
  证据：`src/webview/main.tsx` 中 `resolveCanvasSpatialBounds()` 已把 `CanvasGroupSummary.role === 'workspace-root'` 纳入空间 bounds；`docs/exec-plans/completed/canvas-spatial-fit-minimap.md` 已记录该导航语义。

- 观察：已合并本地分支无法通过 `git branch -d` 删除，因为它仍被其他 worktree checkout。
  证据：`git branch --merged origin/main` 显示 `canvas-group-auto-resize-on-double-click` 已合并且位于 `dev-session-canvas4`；`git branch -d canvas-group-auto-resize-on-double-click` 返回 “Cannot delete branch ... checked out at ...dev-session-canvas4”。

- 观察：`test:canvas-execution-context` 的旧 broad `fork` 源码断言会误伤已有 Claude Code 原生 session fork 路径。
  证据：失败命中 `branchAgentSession()` / `isClaudeForkSessionLaunch()` 中的 Claude Code `--fork-session` 文案与参数；本轮把断言改为先剔除 provider 原生 session branching 路径，再继续检查 multi-root canvas 不保留 fork 语义。

## 决策记录

- 决策：新增 root section 放置采用“当前可见中心作为锚点 + 矩形候选槽位 packing + overlap removal”，不引入 ELK / Graphviz / D3 作为运行时依赖。
  理由：当前任务只新增一个或少数 root section，目标是保留用户既有空间整理并把新 root 放在附近；ELK Layered、Graphviz neato/sfdp 或 D3 force 更适合全图重排或节点云模拟，会破坏用户手工 overlay，且新增依赖与异步布局成本超过收益。矩形候选槽位搜索借鉴成熟 rectangular packing / overlap removal 思路，输出确定、可测试、可持久化。
  日期/作者：2026-06-09 / Codex

- 决策：新增 root 的自动落点只作用于“本次 workspace folder 变化新增、且 overlay 中没有位置”的 root；已有 overlay root 坐标不重新计算。
  理由：multi-root overlay 是用户整理后的显式布局，Add Folder 不能借新增对象重排旧工程区域；只给新增 root 找位置能保证最小扰动。
  日期/作者：2026-06-09 / Codex

- 决策：聚焦新增 root 使用新的 `host/focusGroup` 协议，而不是伪造节点 focus 或直接从 Host 写 Webview persisted viewport。
  理由：root section 是 group，不是 React Flow node；Webview 拥有实际 viewport 尺寸与 React Flow instance，能用现有 `getViewportForBounds()` 精确计算缩放和平移动画，同时保持 Host 不直接操纵 Webview 本地 UI 状态。
  日期/作者：2026-06-09 / Codex

## 结果与复盘

本计划已完成。最终实现让 `Add Folder to Workspace` 新增 root section 以当前可见中心为锚点，选择最近的不重叠矩形槽位，并在下一次 persist 时写入 multi-root overlay；Host 随后通过 `host/focusGroup` 请求当前 Webview 用缩放平移动画聚焦该 workspace-root group。composition 测试覆盖新增 root 就近放置、避让和 overlay 持久化；protocol / execution context / node group / typecheck / build / Playwright 定向用例均通过。未新增运行时布局依赖，保留用户既有 root overlay 不被重排。

## 上下文与定向

Dev Session Canvas 是 VSCode extension。`src/panel/CanvasPanelManager.ts` 是 Host 权威状态中心，处理 VSCode workspace folder 变化、加载 root-local / multi-root composed state、持久化 overlay，并向 Webview 发送消息。`src/common/canvasMultiRootComposition.ts` 是不依赖 VSCode API 的纯数据模块，负责 root section ID、坐标转换、multi-root compose / decompose。`src/common/protocol.ts` 定义 Host 与 Webview 共享消息。`src/webview/main.tsx` 渲染 React Flow 画布和非 React Flow node 的 group / workspace-root overlay，并控制 viewport 动画。

本计划中的 `root section` 指 `CanvasGroupSummary.role === 'workspace-root'` 的系统分组区域。`overlay` 指 multi-root workspace 自己保存的 root section 位置、尺寸和 workspace-level 分组。`可见中心` 指 Webview 通过 `webview/updateViewportCenter` 上报给 Host 的当前画布坐标中心。

## 工作计划

第一步在 `src/common/canvasMultiRootComposition.ts` 扩展 `ComposeMultiRootCanvasStateOptions`，新增 `newRootPlacement` 输入。该输入包含新增 root path 列表和可选可见中心。compose 时仍先读取 overlay；只有 overlay 缺失且 root path 属于新增列表时，才把该 root 从默认 index 网格改为就近 placement。

第二步实现确定性候选槽位搜索。以 preferred center 换算新增 root 的 top-left anchor，生成 anchor、已有 root 四周贴边候选、以及按 root size + gap 扩张的环形候选；按候选中心到 preferred center 的距离排序，选择第一个不与已有 root 的扩张阻挡矩形相交的位置。若极端情况下找不到候选，则退化到所有 root bounds 的右侧。

第三步在 `CanvasPanelManager` 的 `vscode.workspace.onDidChangeWorkspaceFolders()` 中记录变化前后的 normalized root path，计算新增 root 列表，读取当前可见中心，作为本次 `loadReconciledState()` 的 pending placement 输入。加载完成后找出新增 root 的 workspace-root group，持久化并发布 `host/stateUpdated`，随后发送 `host/focusGroup`。

第四步在 `src/common/protocol.ts` 增加 `host/focusGroup`，在 `src/webview/main.tsx` 接收后根据 group rect 和当前 viewport size 调用 `getViewportForBounds()`，再用 `ReactFlowInstance.setViewport(..., { duration })` 平移缩放到 root section，同时更新 selected group 本地状态。

## 具体步骤

在仓库根目录执行：

    git fetch --prune origin
    git switch -c canvas-add-folder-root-placement origin/main
    npm run test:canvas-multi-root-composition
    npm run test:protocol-webview-messages
    npm run test:canvas-node-groups
    npm run test:canvas-execution-context
    npm run typecheck
    npm run build
    node scripts/test/run-playwright-webview.mjs -g "host focus group request"
    git diff --check

最终执行记录：

    npm run test:canvas-multi-root-composition
    canvas multi-root composition tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run test:canvas-node-groups
    退出码 0

    npm run test:canvas-execution-context
    canvas execution context tests passed

    npm run typecheck
    tsc --noEmit

    npm run build
    node scripts/build/build.mjs

    node scripts/test/run-playwright-webview.mjs -g "host focus group request"
    1 passed；Playwright webview tests passed.

    git diff --check
    退出码 0

## 验证与验收

自动化验收至少包括四点。第一，`test:canvas-multi-root-composition` 中新增 root 使用 `newRootPlacement.preferredCenter` 后不再落在默认 index 网格位置，且不与已有 root section 重叠。第二，decompose 后新增 root position 写入 overlay，重载后能保持。第三，`test:protocol-webview-messages` 通过，证明协议类型仍可被共享源码检查覆盖。第四，Playwright `host focus group request animates to a workspace root section` 证明 Webview 收到 `host/focusGroup` 后会通过动画把 root section 放到视口中心并选中该 group。

人工验收路径：打开 multi-root 画布，平移到一个已有 root 附近；通过 VSCode `Add Folder to Workspace...` 添加第三个 folder；预期新 root section 出现在当前视口附近的空位，随后画布通过短动画缩放平移到该 root，右下角 MiniMap 也能看到新 root 的相对位置。重载窗口后，新 root section 保持该位置。

## 幂等性与恢复

实现只改变新增 root 的 overlay 位置推导和 Webview focus 协议。重复执行 compose 时，如果 overlay 已有 root position，则不会再次应用 pending placement。若 workspace folder 变化期间没有可见中心，compose 回退到旧的默认 root 网格。若 Webview 未 ready，`focusWorkspaceRootInCanvas()` 会等待 active surface ready；失败只记录诊断，不影响 root-local / overlay 持久化。若需要撤回本轮改动，可删除新增 `newRootPlacement` / `host/focusGroup` 路径，旧默认网格与手动 fit view 行为仍可工作。

## 证据与备注

本轮调研的成熟方案包括：React Flow `getViewportForBounds()` 用于由 bounds 计算 viewport；D3 `forceCollide()` 体现碰撞/重叠移除的 soft constraint 思路；ELK 提供 Rectangle Packing、SPOrE Overlap Removal、Layered / Stress 等布局算法；Graphviz neato / sfdp 代表 spring / multiscale force-directed 布局。参考入口分别为 `https://reactflow.dev/api-reference/utils/get-viewport-for-bounds`、`https://d3js.org/d3-force/collide`、`https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-rectpacking.html`、`https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-sporeOverlap.html`、`https://graphviz.org/docs/layouts/neato/` 和 `https://graphviz.org/docs/layouts/sfdp/`。最终实现借鉴矩形 packing / overlap removal 的局部确定性搜索，而不是引入全图布局库。

关键 diff 摘要：

    src/common/canvasMultiRootComposition.ts
      ComposeMultiRootCanvasStateOptions.newRootPlacement
      resolveClosestFreeRootSectionPosition()

    src/panel/CanvasPanelManager.ts
      onDidChangeWorkspaceFolders() 计算 added root paths 和 preferred center
      focusWorkspaceRootInCanvas() 发送 host/focusGroup

    src/webview/main.tsx
      case 'host/focusGroup'
      centerGroupInViewport() 使用 getViewportForBounds + setViewport(duration)

## 接口与依赖

在 `src/common/canvasMultiRootComposition.ts` 中维护：

    export interface CanvasMultiRootNewRootPlacement {
      rootPaths: readonly string[];
      preferredCenter?: CanvasNodePosition;
    }

    export interface ComposeMultiRootCanvasStateOptions {
      workspaceFolders: readonly CanvasMultiRootWorkspaceFolder[];
      rootStates: readonly CanvasRootLocalStateSnapshot[];
      overlay?: CanvasMultiRootOverlay;
      newRootPlacement?: CanvasMultiRootNewRootPlacement;
      now?: string;
    }

在 `src/common/protocol.ts` 中维护：

    { type: 'host/focusGroup'; payload: { groupId: string } }

不新增 npm 运行时依赖。Webview 继续使用既有 React Flow `getViewportForBounds()` 与 `setViewport()`；layout 侧只使用仓库内纯函数。

计划修订说明：2026-06-09 创建本计划，原因是 Add Folder root placement 同时涉及 multi-root 状态组合、正式空间布局决策、Host/Webview 协议和动画验证，属于需要 ExecPlan 跟踪的多步交付。2026-06-09 完成后将计划移入 `docs/exec-plans/completed/`，并补充最终验证、execution-context 断言修复与分支清理结果。
