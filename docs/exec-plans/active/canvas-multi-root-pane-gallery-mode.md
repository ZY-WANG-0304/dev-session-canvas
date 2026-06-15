# 多根 Workspace 窗格画廊模式

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/canvas-multi-root-pane-gallery-mode.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，用户在 multi-root workspace 中可以通过 `devSessionCanvas.canvas.multiRootPresentationMode` 在两种呈现方式之间切换。默认 `rootGroups` 保持当前单张组合画布和系统 root 分组；新增 `paneGallery` 把每个 workspace root 的画板投影成一个窗格。用户可以用 `tiled` 布局同时查看所有 root 的状态，也可以用 `focus` 布局放大一个 active root，并让其他 root 以缩略窗格保留状态提醒。

这项能力不改变 root-local 事实源。单独打开某个 root 时仍看到同一份 root-local 画布；multi-root 的 runtime attach、文件活动、ID 命名空间、跨 root 连线拒绝和 `metadata.cwd` 权威语义保持不变。用户可以亲眼验证：切到 `paneGallery` 后，所有 root 都以窗格出现；在 `tiled` 的任一 root pane 或 `focus` active root 主窗格创建 Note 后，单独打开该 root 可以看到该 Note；切回 `rootGroups` 后，原先 root 分组 overlay 位置没有被窗格模式改写。

## 进度

- [x] (2026-06-15 23:10 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md`、`docs/UI.md`、`docs/FRONTEND.md`、`docs/PRODUCT_SENSE.md` 与既有多根 workspace 规格/设计，确认本任务需要正式设计文档和独立 `ExecPlan` 承载。
- [x] (2026-06-15 23:35 +0800) 将 `paneGallery` 的产品范围、非目标、验收标准和未验证状态写入 `docs/product-specs/canvas-multi-root-workspace-support.md`。
- [x] (2026-06-15 23:45 +0800) 将 `paneGallery` 的设计方案、配置边界、局部 UI 状态、风险取舍和验证方法写入 `docs/design-docs/canvas-multi-root-workspace-support.md`。
- [x] (2026-06-16) 根据用户反馈将 `paneGallery` 的 `tiled` root pane 修订为可交互窗格，并同步产品规格、设计文档和本计划的风险/验收口径。
- [x] (2026-06-16) 明确 `paneGallery` 的缩放与规模策略：每个 `tiled` root pane 独立 fit-to-pane，不低于可读/可交互缩放下限；root 很多时使用滚动/虚拟化 gallery，而不是无限压缩同屏。
- [ ] 在扩展清单、协议和宿主运行时上下文中新增 `devSessionCanvas.canvas.multiRootPresentationMode` 配置及其热更新路径。
- [ ] 在 Webview 中实现 `MultiRootPaneGallery`、root pane view model、`tiled` 多窗格交互、`focus` 布局和 active root 主窗格交互。
- [ ] 补充 Playwright / protocol / manifest 回归并运行验证。

## 意外与发现

- 观察：当前多根 workspace 已经有成熟的 root-local state + composed view + overlay 三层模型，新增窗格模式不需要也不应该新增事实源。
  证据：`src/common/canvasMultiRootComposition.ts` 已负责 root id 命名空间、compose/decompose、overlay root 位置与新增 root placement；`docs/design-docs/canvas-multi-root-workspace-support.md` 已把 `CanvasPanelManager` 定义为宿主权威状态入口。

- 观察：当前 Webview 的短期选择与 viewport 已通过 `acquireVsCodeApi().setState()` 保存在 `LocalUiState`，适合承载 `paneGallery` 的 active root 和局部布局状态，但这些状态不能写入 root-local snapshot。
  证据：`src/webview/main.tsx` 的 `LocalUiState` 已包含 selection、viewport 和文件列表展开状态，并在 `vscode.setState(localUiState)` 中持久化到 Webview 局部状态。

- 观察：`tiled` pane 需要支持直接交互，因此一次渲染多个完整 root pane 会放大 React Flow / xterm 的焦点、键盘、selection、resize 和跨窗格拖拽风险；缩略窗格仍应避免开放终端输入与拖拽编辑。
  证据：用户明确要求 `paneGallery` 中的 `tiled pane` 也支持交互；现有 `src/webview/main.tsx` 把 React Flow viewport、terminal native interactions、xterm resize 和 focus 语义绑在一个主画布运行面上，多实例化需要额外验证焦点、键盘、selection 和 resize。

- 观察：现有画布已经有舒适最小缩放、最大缩放和 fit view 的边界语义，`paneGallery` 应复用这类约束，而不是为平铺视图引入无下限缩放。
  证据：`src/webview/main.tsx` 定义了 `CANVAS_COMFORT_MIN_ZOOM`、`CANVAS_MAX_ZOOM`、动态最小缩放和 `fitView` / `getViewportForBounds` 路径，可作为 pane fit-to-pane 的实现参考。

## 决策记录

- 决策：新增多根呈现模式命名为 `paneGallery`，现有模式命名为 `rootGroups`。
  理由：`rootGroups` 描述当前系统 root 分组的单张画布；`paneGallery` 描述会议 gallery 式多窗格呈现，同时避免使用 `meeting`、`video` 等会误导为多人协作的词。
  日期/作者：2026-06-15 / Codex

- 决策：`devSessionCanvas.canvas.multiRootPresentationMode` 默认值为 `rootGroups`，scope 为 `window`，第一版热应用到当前 Webview。
  理由：默认不改变既有用户的空间布局习惯；该配置只改变 Webview 呈现，不改变 runtime ownership 或持久化事实源，因此原则上不需要 Window Reload。若实现中发现热切换无法安全释放 React Flow / xterm 交互层，再改为 reload 生效并同步文档。
  日期/作者：2026-06-15 / Codex

- 决策：`paneGallery` 第一版允许 `tiled` 下每个 root pane 直接交互；`focus` active root 主窗格同样可交互，缩略窗格只做状态预览与切换入口。
  理由：平铺视图的价值不只是观察，还包括在任一 root 上立即处理；缩略窗格尺寸和语境不适合承载终端输入或拖拽编辑，仍应保持只读切换。
  日期/作者：2026-06-16 / Codex

- 决策：`paneGallery` 的 active root、`tiled` / `focus` 和每 root 临时 viewport 只进入 Webview local state，不进入 root-local state 或 multi-root overlay。
  理由：这些是当前窗口的呈现偏好，不是 root 内容或 multi-root 空间整理结果；写入 root-local 会污染单根视图，写入 overlay 会破坏 `rootGroups` 的空间布局语义。
  日期/作者：2026-06-15 / Codex

- 决策：`tiled` 下每个可交互 root pane 使用独立 viewport，默认 fit 当前 root 子图，但缩放不得低于可读/可交互下限；root 内容过大时通过 pane 内 pan/zoom 查看。
  理由：平铺视图要同时支持全览和操作，不能为了让每个 root 全量同屏而把节点和终端缩到不可用。
  日期/作者：2026-06-16 / Codex

- 决策：root 数量超过同屏可交互容量时，`paneGallery` 使用滚动/虚拟化 gallery，并提供按 root 名称、路径和状态定位的入口；不采用无限缩小所有 pane 的策略。
  理由：大量 root 下可读性和交互命中率比“所有 root 同屏”更重要；虚拟化还能避免同时挂载过多 React Flow / xterm surface。
  日期/作者：2026-06-16 / Codex

## 结果与复盘

当前已完成设计阶段收口：产品规格和正式设计文档已经记录 `paneGallery` 的目标、非目标、配置边界、交互模型、风险与验证方法。实现尚未开始，因此本文保持 active 状态，设计文档验证状态保持 `验证中`。下一步应从配置/协议最小切口开始实现，先让 Webview 能在测试 harness 中收到 `multiRootPresentationMode` 并切换到 pane shell，再逐步接入 `tiled` root pane 与 `focus` active root 主窗格交互。

## 上下文与定向

Dev Session Canvas 是 VSCode extension。`src/panel/CanvasPanelManager.ts` 是宿主权威状态中心，负责加载、持久化、创建节点、处理 Webview 消息和启动执行会话。`src/common/protocol.ts` 定义 Host 与 Webview 共享的节点、分组、runtime context 和消息类型。`src/common/canvasMultiRootComposition.ts` 是多根组合/拆分纯函数模块，不依赖 VSCode API。`src/webview/main.tsx` 渲染 React Flow 画布、节点、分组、水印、MiniMap、内嵌终端和 Webview 局部 UI 状态。

本计划使用几个普通语言术语。`root-local state` 是某一个 workspace folder 自己的 `CanvasPrototypeState`，只保存该 root 内的普通节点、用户分组、连线和文件活动。`composed view` 是 multi-root workspace 运行时把多个 root-local state 合成的一张画布，当前 `rootGroups` 看到的是它。`overlay` 是当前 multi-root workspace 自己的布局层，只保存 root 分组的位置、尺寸、父分组关系，以及包含多个 root 分组的外层普通分组。`workspace-root group` 是系统 root 分组，用 `CanvasGroupSummary.role === 'workspace-root'` 标记。`paneGallery` 是新增呈现模式，它从同一份 composed view 派生多个 root pane，不拥有额外事实源。

## 工作计划

第一阶段先接通配置和协议。需要在 `package.json` 与 `package.nls.json` 新增 `devSessionCanvas.canvas.multiRootPresentationMode`，在 `src/common/extensionIdentity.ts` 新增 `CONFIG_KEYS.canvasMultiRootPresentationMode`，在 `src/common/protocol.ts` 定义 `CanvasMultiRootPresentationMode` 并把它加入 `CanvasRuntimeContext`。`src/panel/CanvasPanelManager.ts` 的 `getRuntimeContext()` 要读取配置并透传给 Webview；配置变更监听应把该字段作为普通 runtime context 变化处理，触发 `host/stateUpdated` 或等价 runtime context 更新。

第二阶段实现 Webview pane shell 与缩放/规模骨架。`src/webview/main.tsx` 需要根据 `runtimeContext.multiRootPresentationMode` 与当前是否存在多个 `workspace-root` group 选择渲染：单根或 `rootGroups` 继续走现有 React Flow；multi-root 且 `paneGallery` 时渲染 `MultiRootPaneGallery`。先实现 root pane view model、标题栏、路径 tooltip、节点数量、状态聚合、attention/error/waiting 摘要和空 root 提示；tiled/focus/active root、每 root pane viewport、gallery scroll offset 和筛选/搜索条件放入 `LocalUiState`，并在 root 不存在时回退到第一个 root。`tiled` pane 默认基于 root 子图 bounds 做 fit-to-pane，缩放夹在可读/可交互区间内；root 很多时先按最小可交互 pane 尺寸进入滚动 gallery，并预留虚拟化挂载边界。

第三阶段接入 `tiled` root pane 与 `focus` active root 主窗格交互。每个可交互窗格应复用现有节点渲染、创建消息、terminal input、Markdown drop 和拖拽语义，并确保所有消息携带该窗格对应的 workspace-root group id。`tiled` 下同 root 内拖拽和输入写回对应 root-local state；跨窗格拖拽、跨 root 连线或 edge update 必须被拒绝或回弹。`focus` 缩略窗格点击只能切换 active root，不能发送创建、拖拽、terminal input 或 edge update 消息。

第四阶段补充回归。Playwright harness 需要能注入 `multiRootPresentationMode: 'paneGallery'` 的 runtime context，并断言多 root pane、tiled/focus 切换、独立 pane viewport、fit-to-pane 缩放下限、root 很多时的滚动/虚拟化 gallery、`tiled` root pane 创建/拖拽/terminal input/Markdown drop 目标、缩略窗格点击、状态聚合和 active root 创建目标。协议/manifest 测试需要覆盖新配置 key、默认值、enum 文案和 runtime context normalization。已有 multi-root composition 与 cross-root edge 测试必须继续通过，证明 paneGallery 没有破坏事实源。

## 具体步骤

在仓库根目录执行。每一步都可以重复运行；如果测试失败，先看失败断言，再更新本计划的 `意外与发现` 或 `决策记录`。

    npm run test:extension-manifest
    npm run test:protocol-webview-messages
    npm run test:canvas-multi-root-composition
    npm run test:webview -- --grep "pane gallery|workspace root group|cross-root edge"
    npm run typecheck
    npm run build
    git diff --check

如果本地 Playwright 因宿主环境无法启动，应至少运行 `npm run build`、`npm run typecheck` 和非浏览器脚本测试，并在本计划与最终说明中记录 Playwright 未跑的原因和需要复跑的命令。

## 验证与验收

验收以以下可观察行为为准。

1. Settings 中出现 `devSessionCanvas.canvas.multiRootPresentationMode`，默认 `rootGroups`，枚举值包含 `rootGroups` 与 `paneGallery`，中文文案说明该设置只控制 multi-root workspace 呈现方式。
2. multi-root workspace 下默认仍显示现有系统 root 分组组合画布；切到 `paneGallery` 后，所有 workspace folders 都成为窗格，root-local 内容和 overlay 不迁移、不清空。
3. `paneGallery` 的 `tiled` 布局显示所有 root pane；每个 pane 显示 root 名称、完整路径 tooltip、节点数量和状态聚合，并支持在该 root 内创建、拖拽、输入和拖入内容。
4. 每个 `tiled` root pane 默认 fit 当前 root 子图，但不低于可读/可交互缩放下限；root 内容过大时 pane 内 pan/zoom 可用。
5. root 数量超过同屏可交互容量时，gallery 保持 pane 最小可交互尺寸，通过滚动/虚拟化或等价机制访问所有 root，并提供 root 名称、路径或状态定位入口。
6. 用户双击或点击某个 pane 的聚焦入口后进入 `focus`；active root 成为主窗格，其他 root 成为缩略窗格 rail。
7. 点击缩略窗格只切换 active root，不发送 create / drag / terminal input / edge update 消息。
8. 在 `tiled` root pane 或 `focus` active root 主窗格创建 Note / Agent / Terminal 后，单独打开该 root 可以看到对象；创建 `Agent` / `Terminal` 时 `metadata.cwd` 等于目标 root 或显式 Explorer cwd。
9. 跨 root 连线、跨 root 拖拽迁移和静默改写 `cwd` 仍被拒绝。
10. 切回 `rootGroups` 后，原 multi-root overlay 的 root 分组位置、尺寸和外层分组保持不变。

## 幂等性与恢复

配置和 Webview local state 改动应可重复执行。新增 local state 必须按 root id 校验；当 workspace folder 被移除或 root id 不存在时，active root 回退到第一个 root，不保留悬空 id，并丢弃对应 pane viewport 与滚动定位。实现过程中不要删除或重置用户当前未跟踪图片文件；它们与本任务无关。若 paneGallery 热切换导致 Webview 状态异常，应优先在实现分支上改成 reload 生效并同步设计文档，而不是让宿主事实源承担补救。

## 证据与备注

当前设计阶段证据如下。

    docs/product-specs/canvas-multi-root-workspace-support.md
      已新增 paneGallery 用户目标、功能范围、非目标、验收标准和未验证说明。

    docs/design-docs/canvas-multi-root-workspace-support.md
      已新增 paneGallery 候选方案、正式方案、配置边界、风险取舍和验证方法；frontmatter validation_status 保持 验证中。

    git status --short --branch
      当前 worktree 存在用户未跟踪图片文件，本计划不触碰这些文件。

## 接口与依赖

本次实现预期触达以下接口。

- `package.json`
  - 新增 `contributes.configuration.properties.devSessionCanvas.canvas.multiRootPresentationMode`。
- `package.nls.json`
  - 新增配置说明、枚举 label 和枚举 description。
- `src/common/extensionIdentity.ts`
  - 新增 `CONFIG_KEYS.canvasMultiRootPresentationMode`。
- `src/common/protocol.ts`
  - 新增 `CanvasMultiRootPresentationMode = 'rootGroups' | 'paneGallery'`。
  - `CanvasRuntimeContext` 新增 `multiRootPresentationMode`。
- `src/panel/CanvasPanelManager.ts`
  - `getRuntimeContext()` 读取并透传配置。
  - `onDidChangeConfiguration` 监听该配置并刷新 Webview runtime context。
- `src/webview/main.tsx`
  - 归一化 runtime context 字段。
  - `LocalUiState` 新增 pane gallery 局部状态。
  - 为每个可交互 root pane 维护独立 viewport，并实现 fit-to-pane、缩放下限和 root 多时的滚动/虚拟化 gallery。
  - 新增 `MultiRootPaneGallery` / root pane view model / tiled-focus 切换。
  - 在 `tiled` root pane 与 `focus` active root 主窗格交互时继续走现有 root target group 语义。
- `tests/playwright/webview-harness.spec.mjs`
  - 新增 paneGallery 渲染、切换、`tiled` root pane 交互、缩略窗格和 active root 创建目标回归。
- `scripts/test/test-extension-manifest.mjs` 与 `scripts/test/test-protocol-webview-messages.mts`
  - 视现有断言结构补配置和 runtime context 回归。
