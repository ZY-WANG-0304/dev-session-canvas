# 多根 Workspace 窗格画廊模式

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/completed/canvas-multi-root-pane-gallery-mode.md`，已随第一轮实现完成归档；若后续重新打开本计划，仍必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，用户在 multi-root workspace 中可以通过 `devSessionCanvas.canvas.multiRootPresentationMode` 在两种呈现方式之间切换。默认 `rootGroups` 保持当前单张组合画布和系统 root 分组；新增 `paneGallery` 把每个 workspace root 的画板投影成一个窗格。用户可以用 `dynamic` 或 `grid` 布局同时查看并直接操作所有 root，也可以用 `topThumbnails` 或 `sideThumbnails` 布局保留一个 active root 主画板，并让其他 root 以不可交互的画板缩略图保留上下文。

这项能力不改变 root-local 事实源。单独打开某个 root 时仍看到同一份 root-local 画布；multi-root 的 runtime attach、文件活动、ID 命名空间、跨 root 连线拒绝和 `metadata.cwd` 权威语义保持不变。用户可以亲眼验证：切到 `paneGallery` 后，所有 root 都以窗格出现；在 `dynamic` / `grid` 的任一 root pane 或 thumbnail 模式 active root 主画板创建 Note 后，单独打开该 root 可以看到该 Note；切回 `rootGroups` 后，原先 root 分组 overlay 位置没有被窗格模式改写。

## 进度

- [x] (2026-06-15 23:10 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md`、`docs/UI.md`、`docs/FRONTEND.md`、`docs/PRODUCT_SENSE.md` 与既有多根 workspace 规格/设计，确认本任务需要正式设计文档和独立 `ExecPlan` 承载。
- [x] (2026-06-15 23:35 +0800) 将 `paneGallery` 的产品范围、非目标、验收标准和未验证状态写入 `docs/product-specs/canvas-multi-root-workspace-support.md`。
- [x] (2026-06-15 23:45 +0800) 将 `paneGallery` 的设计方案、配置边界、局部 UI 状态、风险取舍和验证方法写入 `docs/design-docs/canvas-multi-root-workspace-support.md`。
- [x] (2026-06-16) 根据用户反馈将 `paneGallery` 的 `tiled` root pane 修订为可交互窗格，并同步产品规格、设计文档和本计划的风险/验收口径。
- [x] (2026-06-16) 明确 `paneGallery` 的缩放与规模策略：每个 `tiled` root pane 独立 fit-to-pane，不低于可读/可交互缩放下限；root 很多时使用滚动/虚拟化 gallery，而不是无限压缩同屏。
- [x] (2026-06-16) 在扩展清单、协议和宿主运行时上下文中新增 `devSessionCanvas.canvas.multiRootPresentationMode` 配置及其热更新路径。
- [x] (2026-06-16) 在 Webview 中实现 `PaneGallery`、root pane view model、`tiled` 多窗格交互、`focus` 布局和 active root 主窗格交互。
- [x] (2026-06-16) 补充 manifest、protocol 和 Playwright pane gallery 回归；已通过 `npm run typecheck`、`npm run build` 和 pane gallery 定向 Playwright。
- [x] (2026-06-16) 运行最终提交前的完整目标验证组合，并把最终命令结果回填到本计划。
- [x] (2026-06-17 00:00 +0800) 根据新反馈重新打开计划：移除 paneGallery 顶部 toolbar 与 filter roots，将局部布局从 `tiled` / `focus` 改为 `dynamic` / `grid` / `topThumbnails` / `sideThumbnails`，并同步规格与设计文档。
- [x] (2026-06-17 00:32 +0800) 实现新的模式菜单、四种布局、缩略图双击切换和不额外限制 pane fit 缩放。
- [x] (2026-06-17 00:52 +0800) 更新 pane gallery Playwright 回归并运行定向验证，补充 dynamic pane 右键创建目标 root、四模式菜单、缩略图单击/双击语义、many-roots 滚动、Markdown drop 与 workspace root/cross-root edge 守护回归。
- [x] (2026-06-17) 根据第二轮反馈取消右上角模式入口，把模式切换收敛到左下角画板控制区；缩略图改为不可交互的真实画板；移除 paneGallery 内 workspace-root 分组框/水印和 root 标签 subtitle；修正 per-pane overview 与动态非等尺寸铺满布局，并补充定向 Playwright 回归。

## 意外与发现

- 观察：当前多根 workspace 已经有成熟的 root-local state + composed view + overlay 三层模型，新增窗格模式不需要也不应该新增事实源。
  证据：`src/common/canvasMultiRootComposition.ts` 已负责 root id 命名空间、compose/decompose、overlay root 位置与新增 root placement；`docs/design-docs/canvas-multi-root-workspace-support.md` 已把 `CanvasPanelManager` 定义为宿主权威状态入口。

- 观察：当前 Webview 的短期选择与 viewport 已通过 `acquireVsCodeApi().setState()` 保存在 `LocalUiState`，适合承载 `paneGallery` 的 active root 和局部布局状态，但这些状态不能写入 root-local snapshot。
  证据：`src/webview/main.tsx` 的 `LocalUiState` 已包含 selection、viewport 和文件列表展开状态，并在 `vscode.setState(localUiState)` 中持久化到 Webview 局部状态。

- 观察：`tiled` pane 需要支持直接交互，因此一次渲染多个完整 root pane 会放大 React Flow / xterm 的焦点、键盘、selection、resize 和跨窗格拖拽风险；缩略图仍应避免开放终端输入与拖拽编辑。
  证据：用户先前明确要求 `paneGallery` 中的 `tiled pane` 也支持交互，本轮进一步把该模式改名为 `dynamic` / `grid`；现有 `src/webview/main.tsx` 把 React Flow viewport、terminal native interactions、xterm resize 和 focus 语义绑在一个主画布运行面上，多实例化需要额外验证焦点、键盘、selection 和 resize。

- 观察：现有主线单一画板在全局 fit view 时允许动态最小缩放低于舒适缩放下限，从而在大画布下进入 overview；新的 `paneGallery` 应与该语义一致，而不是为子画板另设固定 `0.4` 缩放下限。
  证据：`src/webview/main.tsx` 的 `resolveDynamicCanvasMinZoom()` 会用空间 bounds 与 viewport size 计算 fit-all zoom，并返回 `Math.min(CANVAS_COMFORT_MIN_ZOOM, fitAllZoom)`；用户明确要求动态/宫格与缩略图 fit view 都“不限制缩放的比例”。

- 观察：第一轮实现采用滚动 gallery 和搜索过滤来处理 root 很多的情况，暂未接入可见区虚拟化；本轮需要移除搜索过滤，并把缩放断言从固定下限改成“不额外限制”。
  证据：`src/webview/styles.css` 的 `.pane-gallery-grid` 已保持最小 pane 宽高并 `overflow: auto`；用户本轮明确指出 filter roots 暂不需要，且动态/宫格与缩略图 fit view 都不限制缩放比例。

- 观察：terminal input 能通过 `dynamic` / `grid` root pane 和 thumbnail 模式 active root 主画板中挂载的既有 execution node 继续走原有节点输入路径，但本轮自动化尚未覆盖真实 xterm 输入端到端。
  证据：`PaneGalleryRootPane` 渲染同一套 `nodeTypes`，`CanvasNodeData.onExecutionInput` 仍发送 `webview/executionInput`；现有新增 Playwright 主要覆盖窗格渲染、创建、缩略窗格无副作用、滚动规模策略和 Markdown drop 目标 root；本轮需要改成覆盖四模式与缩略图双击切换。

## 决策记录

- 决策：新增多根呈现模式命名为 `paneGallery`，现有模式命名为 `rootGroups`。
  理由：`rootGroups` 描述当前系统 root 分组的单张画布；`paneGallery` 描述会议 gallery 式多窗格呈现，同时避免使用 `meeting`、`video` 等会误导为多人协作的词。
  日期/作者：2026-06-15 / Codex

- 决策：`devSessionCanvas.canvas.multiRootPresentationMode` 默认值为 `rootGroups`，scope 为 `window`，第一版热应用到当前 Webview。
  理由：默认不改变既有用户的空间布局习惯；该配置只改变 Webview 呈现，不改变 runtime ownership 或持久化事实源，因此原则上不需要 Window Reload。若实现中发现热切换无法安全释放 React Flow / xterm 交互层，再改为 reload 生效并同步文档。
  日期/作者：2026-06-15 / Codex

- 决策：`paneGallery` 当前正式局部布局为 `dynamic`、`grid`、`topThumbnails` 和 `sideThumbnails`，不再使用 UI 上的 `tiled` / `focus` 命名。
  理由：用户希望模式与参考图一致，动态/宫格表达全览，顶部缩略图/右侧缩略图表达主画板加 rail；这个命名也比 `focus` 更少会议隐喻。
  日期/作者：2026-06-17 / Codex

- 决策：`paneGallery` 不提供整条顶部 toolbar、常驻 filter roots 或右上角模式切换按钮，但保留主线画布右上角使用提示入口；模式切换入口放到可交互画板左下角控制区。全览态入口使用 `eye`，点击后以当前 pane 作为 thumbnail 主画板；thumbnail 态入口使用 `globe`，点击后返回全览；hover 菜单始终向右展开 `dynamic`、`grid`、`topThumbnails`、`sideThumbnails` 四个具体模式，并让四个选项分别使用 `layout`、`table`、`split-vertical`、`split-horizontal`。粗切换保留上次选择的具体模式：全览转 thumbnail 默认 `sideThumbnails`，后续使用上次 `topThumbnails` / `sideThumbnails`；thumbnail 返回全览默认 `dynamic`，后续使用上次 `dynamic` / `grid`。
  理由：现有主线画布是低 chrome、空间画布优先；顶部 toolbar、搜索框和右上角全局按钮让新 UI 偏 dashboard 化。把入口放入画板控制区能与单一画板控件保持肌肉记忆；点击只处理高频粗切换，hover 提供完整四模式选择，减少用户为了从 thumbnail 直接切到另一个 thumbnail 形态而往返全览。
  日期/作者：2026-06-17 / Codex

- 决策：`dynamic` / `grid` 下每个 root pane 直接交互；`topThumbnails` / `sideThumbnails` 的 active root 主画板同样可交互并显示右下角 MiniMap，缩略图渲染为不可交互的真实 root 画板 fit view，且双击才切换 active root；`dynamic` / `grid` 子画板不显示 MiniMap。
  理由：平铺视图的价值不只是观察，还包括在任一 root 上立即处理；缩略图需要保持画板状态语义，但尺寸和语境不适合承载终端输入或拖拽编辑，双击切换能降低误触。
  日期/作者：2026-06-17 / Codex

- 决策：`paneGallery` 的 active root、`dynamic` / `grid` / `topThumbnails` / `sideThumbnails`、上次使用的全览/缩略图具体模式和每 root 临时 viewport 只进入 Webview local state，不进入 root-local state 或 multi-root overlay。
  理由：这些是当前窗口的呈现偏好，不是 root 内容或 multi-root 空间整理结果；写入 root-local 会污染单根视图，写入 overlay 会破坏 `rootGroups` 的空间布局语义。
  日期/作者：2026-06-15 / Codex

- 决策：`dynamic` / `grid` 下每个可交互 root pane 使用独立 viewport，默认 fit 当前 root 子图，且不额外限制缩放比例；thumbnail 模式主画板和缩略图也使用不额外设下限的 fit view；overview 由每个 pane 自己的 zoom 与主线 threshold 判定。
  理由：用户希望子画板基本与当前主线单一画板一致；主线全局 fit view 已允许在大画布下缩到舒适下限以下进入 overview，因此 paneGallery 不应另设固定下限，也不应因为进入 gallery 就让全部 pane 强制概览。
  日期/作者：2026-06-17 / Codex

- 决策：root 数量超过同屏可交互容量时，`paneGallery` 使用滚动/虚拟化 gallery；本轮不提供 filter roots，后续如需要再补快速跳转入口。
  理由：大量 root 下可读性和交互命中率比“所有 root 同屏”更重要；虚拟化还能避免同时挂载过多 React Flow / xterm surface。用户明确指出 filter roots 暂不需要，因此当前不把搜索框作为规模策略前提。
  日期/作者：2026-06-17 / Codex

- 决策：第一轮先落地滚动 gallery，不在本次提交中引入 heavy pane 可见区虚拟化。
  理由：用户当前问题的核心是缩放和很多 root 时不能无限压缩；滚动 gallery 已能保持最小可交互尺寸并通过自动化验证，虚拟化需要额外处理 React Flow / xterm mount 生命周期，适合在有真实规模性能证据后单独收口。本轮按新反馈移除了搜索过滤，因此当前规模策略不再依赖 filter roots。
  日期/作者：2026-06-16，2026-06-17 修订 / Codex

- 决策：paneGallery 中不渲染 workspace-root 分组框和水印；所有 pane 与缩略图复用左上角轻量 root 标签，删除 nodes / waiting / attention 等汇总 subtitle。
  理由：paneGallery 的窗格边界已经天然区分 folder，继续渲染 root 分组会造成重复边界；轻量标签足够表达 root 身份，汇总 subtitle 对当前 UI 信息密度收益低。
  日期/作者：2026-06-17 / Codex

- 决策：`dynamic` 布局采用不同尺寸 pane 的弹性铺排，`grid` 保持规则宫格。
  理由：用户希望 dynamic 更接近会议 gallery 的自适应主次感，而不是规则等分；动态布局不写入 overlay，可用 CSS flex/grid 局部实现，不影响 root-local 状态。
  日期/作者：2026-06-17 / Codex

## 结果与复盘

第一轮实现已完成并提交：配置 `devSessionCanvas.canvas.multiRootPresentationMode` 已进入 manifest、NLS、协议和 Host runtime context；Webview 已能在 multi-root 且配置为 `paneGallery` 时渲染多 root pane。2026-06-17 根据新的交互反馈，本轮把第一轮 `tiled` / `focus` UI 收敛为低 chrome 的四模式 `paneGallery`：移除顶部 toolbar 与 filter roots，保留右上角使用提示，随后进一步取消右上角模式按钮，把模式入口放入左下角画板控制区。入口在全览态使用 `eye`，点击粗切换到 thumbnail；在 thumbnail 态使用 `globe`，点击粗切换回全览；hover 始终展示四个具体模式，动态/宫格/顶部缩略图/右侧缩略图选项使用 `layout` / `table` / `split-vertical` / `split-horizontal`，菜单样式对齐画板控制按钮；粗切换记住上次的全览/thumbnail 具体模式，默认分别回到 `dynamic` 和 `sideThumbnails`。`dynamic` / `grid` 中所有 root pane 保持可交互，thumbnail 模式只让 active root 主画板交互并显示右下角 MiniMap，缩略图渲染为不可交互的真实画板 fit view 且双击才切换 active root；dynamic / grid 子画板不显示 MiniMap。fit-to-pane 不再使用固定 `0.4` 下限，overview 按每个 pane 自己的 zoom 判定；dynamic 布局使用非等尺寸 pane 弹性铺排，many-roots 继续通过保持最小 pane 尺寸的滚动 gallery 访问所有 root。自动化已覆盖 manifest、protocol、multi-root composition、typecheck、build、pane gallery 定向 Playwright、workspace root/cross-root edge 守护和 whitespace 检查。仍遗留真实 VSCode 宿主下 terminal input、复杂跨 pane 拖拽和可见区虚拟化性能验证，因此设计与规格继续保持“验证中”。

## 上下文与定向

Dev Session Canvas 是 VSCode extension。`src/panel/CanvasPanelManager.ts` 是宿主权威状态中心，负责加载、持久化、创建节点、处理 Webview 消息和启动执行会话。`src/common/protocol.ts` 定义 Host 与 Webview 共享的节点、分组、runtime context 和消息类型。`src/common/canvasMultiRootComposition.ts` 是多根组合/拆分纯函数模块，不依赖 VSCode API。`src/webview/main.tsx` 渲染 React Flow 画布、节点、分组、水印、MiniMap、内嵌终端和 Webview 局部 UI 状态。

本计划使用几个普通语言术语。`root-local state` 是某一个 workspace folder 自己的 `CanvasPrototypeState`，只保存该 root 内的普通节点、用户分组、连线和文件活动。`composed view` 是 multi-root workspace 运行时把多个 root-local state 合成的一张画布，当前 `rootGroups` 看到的是它。`overlay` 是当前 multi-root workspace 自己的布局层，只保存 root 分组的位置、尺寸、父分组关系，以及包含多个 root 分组的外层普通分组。`workspace-root group` 是系统 root 分组，用 `CanvasGroupSummary.role === 'workspace-root'` 标记。`paneGallery` 是新增呈现模式，它从同一份 composed view 派生多个 root pane，不拥有额外事实源。

## 工作计划

第一阶段先接通配置和协议。需要在 `package.json` 与 `package.nls.json` 新增 `devSessionCanvas.canvas.multiRootPresentationMode`，在 `src/common/extensionIdentity.ts` 新增 `CONFIG_KEYS.canvasMultiRootPresentationMode`，在 `src/common/protocol.ts` 定义 `CanvasMultiRootPresentationMode` 并把它加入 `CanvasRuntimeContext`。`src/panel/CanvasPanelManager.ts` 的 `getRuntimeContext()` 要读取配置并透传给 Webview；配置变更监听应把该字段作为普通 runtime context 变化处理，触发 `host/stateUpdated` 或等价 runtime context 更新。

第二阶段实现 Webview pane shell 与缩放/规模骨架。`src/webview/main.tsx` 根据 `runtimeContext.multiRootPresentationMode` 与当前是否存在多个 `workspace-root` group 选择渲染：单根或 `rootGroups` 继续走现有 React Flow；multi-root 且 `paneGallery` 时渲染 `PaneGallery`。root pane view model 从同一份 composed state 派生，左上角轻量标签展示 root 名称和路径 tooltip，不常驻节点数量、运行/等待/错误/attention 汇总 subtitle；dynamic/grid/topThumbnails/sideThumbnails/active root、上次全览/缩略图具体模式和每 root pane viewport 放入 `LocalUiState`，并在 root 不存在时回退到第一个 root。每个 pane 默认基于 root 分组 bounds 做 fit-to-pane，缩放下限按该 pane 的空间 bounds 动态计算，不额外固定为 `0.4`；overview 按各 pane 自己的 zoom 判定；root 很多时第一版按最小可交互 pane 尺寸进入滚动 gallery，并保留未来虚拟化挂载边界。

第三阶段接入 `dynamic` / `grid` root pane 与 thumbnail 模式 active root 主画板交互。每个可交互窗格应复用现有节点渲染、创建消息、terminal input、Markdown drop 和拖拽语义，并确保所有消息携带该窗格对应的 workspace-root group id。`dynamic` / `grid` 下同 root 内拖拽和输入写回对应 root-local state；跨窗格拖拽、跨 root 连线或 edge update 必须被拒绝或回弹。thumbnail 模式缩略图是不可交互的真实 React Flow 画板，active root 主画板显示与单一画板一致的右下角 MiniMap，单击缩略图不能切换 active root，也不能发送创建、拖拽、terminal input 或 edge update 消息；只有双击缩略图切换 active root。

第四阶段补充回归。Playwright harness 已能注入 `multiRootPresentationMode: 'paneGallery'` 的 runtime context，并新增回归覆盖多 root pane、dynamic 右键创建目标 root、移除 toolbar/search/右上角模式入口、保留右上角使用提示、左下角模式入口、`eye` / `globe` 粗切换、hover 四模式菜单、`layout` / `table` / `split-vertical` / `split-horizontal` 模式图标、粗切换记忆、thumbnail 主画板 MiniMap、画板化缩略图、缩略图单击无副作用、缩略图双击切换 active root、many-roots 滚动 gallery、pane 最小尺寸、不额外限制缩放、per-pane overview、动态非等尺寸布局和 Markdown drop 目标 root。协议/manifest 测试覆盖新配置 key、默认值、enum 和 runtime context normalization。已有 multi-root composition 与 cross-root edge 测试需要在最终验证中继续通过，证明 paneGallery 没有破坏事实源。terminal input 和真实拖拽端到端路径第一版通过复用现有节点渲染与 Host 跨 root guard 支撑，后续应补更专门的真实宿主或 xterm 输入自动化。

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
3. `paneGallery` 的 `dynamic` / `grid` 布局显示所有 root pane；每个 pane 用左上角轻量标签显示 root 名称和完整路径 tooltip，不显示 nodes / waiting / attention subtitle，并支持在该 root 内创建、拖拽、输入和拖入内容。
4. 每个 `dynamic` / `grid` root pane 默认 fit 当前 root 子图，且不额外限制缩放比例；root 内容过大时 pane 内 pan/zoom 可用。
5. root 数量超过同屏可交互容量时，gallery 保持 pane 最小可交互尺寸，通过滚动/虚拟化或等价机制访问所有 root；本轮不提供 filter roots，后续如需要再补快速跳转入口。
6. 用户通过左下角画板控制区的模式按钮粗切换全览与 thumbnail：全览态按钮为 `eye`，thumbnail 态按钮为 `globe`；hover 始终展开四个具体模式选项，其中 `dynamic` / `grid` / `topThumbnails` / `sideThumbnails` 分别使用 `layout` / `table` / `split-vertical` / `split-horizontal`。粗切换记住上次具体模式，默认从全览进入 `sideThumbnails`、从 thumbnail 返回 `dynamic`。进入 `topThumbnails` 或 `sideThumbnails` 后，active root 成为主画板，其他 root 成为对应方向的不可交互画板缩略图 rail。
7. 单击缩略图不切换 active root；双击缩略图只切换 active root，不发送 create / drag / terminal input / edge update 消息；缩略图不是 MiniMap/SVG 预览，也不带外部标题卡片。
8. 在 `dynamic` / `grid` root pane 或 thumbnail 模式 active root 主画板创建 Note / Agent / Terminal 后，单独打开该 root 可以看到对象；创建 `Agent` / `Terminal` 时 `metadata.cwd` 等于目标 root 或显式 Explorer cwd。
9. 跨 root 连线、跨 root 拖拽迁移和静默改写 `cwd` 仍被拒绝。
10. 切回 `rootGroups` 后，原 multi-root overlay 的 root 分组位置、尺寸和外层分组保持不变。

## 幂等性与恢复

配置和 Webview local state 改动应可重复执行。新增 local state 必须按 root id 校验；当 workspace folder 被移除或 root id 不存在时，active root 回退到第一个 root，不保留悬空 id，并丢弃对应 pane viewport 与滚动定位。实现过程中不要删除或重置用户当前未跟踪图片文件；它们与本任务无关。若 paneGallery 热切换导致 Webview 状态异常，应优先在实现分支上改成 reload 生效并同步设计文档，而不是让宿主事实源承担补救。

## 证据与备注

当前实现阶段证据如下。

    src/common/protocol.ts / src/panel/CanvasPanelManager.ts / package.json
      已新增 multiRootPresentationMode 配置、类型归一化、runtime context 透传和热更新监听。

    src/webview/main.tsx / src/webview/styles.css
      已新增 paneGallery local state、surface binding、多 root pane view model、四模式布局、独立 pane viewport、滚动 gallery 和可交互 pane；本轮移除搜索过滤、右上角模式入口和 pane 内 workspace-root 分组视觉，补充左下角 `eye` / `globe` 粗切换、四模式 hover 菜单、画板化缩略图、per-pane overview 与动态非等尺寸布局。

    tests/playwright/webview-harness.spec.mjs
      已新增 pane gallery 渲染、创建目标 root、thumbnail 模式、many roots scroll/min zoom 和 Markdown drop 目标 root 回归；本轮更新为无 toolbar/search/右上角模式入口、保留右上角使用提示、左下角 `eye` / `globe` 粗切换、四模式 hover 菜单、`layout` / `table` / `split-vertical` / `split-horizontal` 模式图标、粗切换记忆、thumbnail 主画板 MiniMap、画板化缩略图、缩略图双击、不额外限制缩放、per-pane overview 与动态非等尺寸布局。

    npm run test:extension-manifest
      extension manifest tests passed

    npm run test:protocol-webview-messages
      protocol webview message tests passed

    npm run test:canvas-multi-root-composition
      canvas multi-root composition tests passed

    npm run typecheck
      tsc --noEmit 通过

    npm run test:webview -- --grep "pane gallery|workspace root groups reject cross-root edge creation and reconnect|workspace root group"
      11 passed

    npm run build
      node scripts/build/build.mjs 通过

    git diff --check
      无输出，表示 whitespace 检查通过

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
  - 新增 `PaneGallery` / root pane view model / 四模式切换。
  - 在 `dynamic` / `grid` root pane 与 thumbnail 模式 active root 主画板交互时继续走现有 root target group 语义。
- `tests/playwright/webview-harness.spec.mjs`
  - 新增 paneGallery 渲染、切换、`dynamic` / `grid` root pane 交互、缩略图和 active root 创建目标回归。
- `scripts/test/test-extension-manifest.mjs` 与 `scripts/test/test-protocol-webview-messages.mts`
  - 视现有断言结构补配置和 runtime context 回归。
