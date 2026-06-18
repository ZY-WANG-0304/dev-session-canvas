---
title: 画布多根 workspace 组合视图设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-multi-root-workspace-support.md
related_plans:
  - docs/exec-plans/active/canvas-multi-root-composed-canvas-rewrite.md
  - docs/exec-plans/completed/canvas-multi-root-pane-gallery-mode.md
  - docs/exec-plans/completed/canvas-spatial-fit-minimap.md
  - docs/exec-plans/completed/canvas-add-folder-root-placement.md
  - docs/exec-plans/completed/sidebar-workspace-worktree-actions.md
updated_at: 2026-06-18
---

# 画布多根 workspace 组合视图设计

## 1. 背景

Dev Session Canvas 的核心价值是让用户在 VSCode 内通过同一张空间化画布理解多个 `Agent`、`Terminal` 和 `Note`。VSCode 支持 multi-root workspace；用户在同一个窗口中打开多个工程时，期望看到这些工程各自的画布内容，而不是把 multi-root 视为一个与单根 workspace 完全隔离的新画布分支。

现有 `rootGroups` 路线已经把每个 root 表达为系统 root 分组，适合整理 root 之间的空间关系、移动 root 区域和在无限画布上建立外层分组。但当 root 数量增加，用户更常见的动作是像观察多人会议一样巡检每个 root 的运行状态，再临时放大其中一个 root 继续处理。这个场景需要一个新的多根窗格画廊模式：所有 root 可以平铺观察，也可以把一个 root 放大为主窗格，其他 root 退到缩略图保留上下文。

## 2. 问题定义

本设计需要回答：单根 workspace 与多根 workspace 如何共享 root 内容；每个 root 的内容如何在同一张画布或多窗格画廊中组织；用户在多根组合视图中移动节点、创建节点或移动 root 分组后，哪些内容写回 root-local，哪些内容只属于 multi-root 布局；系统 root 分组如何区别于普通用户分组；多根窗格画廊如何只改变呈现层而不复制状态；执行节点 `cwd`、ID 冲突、跨 root 拖拽和运行时恢复如何保守处理。

## 3. 目标

- 单根 workspace 只显示当前 root 的 root-local 画布状态。
- 多根 workspace 显示当前所有 workspace folder 对应的 root-local 画布状态。
- 多根呈现方式可通过 `devSessionCanvas.canvas.multiRootPresentationMode` 在现有 `rootGroups` 与新增 `paneGallery` 之间切换。
- `rootGroups` 中每个 root 有一个系统级 root 分组，继续支持 root 分组移动、resize、避让、外层分组、全局 fit view 与 MiniMap。
- `paneGallery` 中每个 root 是一个窗格；局部布局状态改为 `dynamic`、`grid`、`topThumbnails` 与 `sideThumbnails` 四种：前两者用于全览多个可交互 root 子画板，后两者保留一个与主线单一画板一致的主画板，并把其他 root 收进顶部或右侧的不可交互画板缩略图。
- `paneGallery` 不改变 root-local storage、multi-root overlay、runtime binding、文件活动或跨 root 限制；它只改变 Webview 呈现与交互入口。
- 通过 Dev Session Canvas sidebar 的 `节点` section 添加或移除 folder / worktree 时，仍复用同一套 root 分组组合语义与新增 root 聚焦规则。
- 多根组合视图中对某个 root 内节点、用户分组和 Note 的编辑写回该 root 的 root-local 状态。
- 执行节点真实执行 root 继续由 `metadata.cwd` 决定，不因拖到另一个 root 分组或切换窗格而静默改写。
- 多根组合视图应支持按 root-local runtime metadata 重新附着 `Agent` / `Terminal` live runtime；canvas surface 只负责显示，不拥有后端进程。

## 4. 非目标

不做独立 app 式 workspace 管理、项目启动器或 root 切换器。不把多根窗格画廊做成多人实时协作、视频会议或远程共享白板；参考会议截图只用于说明 gallery / thumbnails 的空间组织方式。不把 multi-root workspace 做成完全隔离的第三份画布状态。不在第一版实现跨 root overlay Note、跨 root 连线或跨 root 模板捕获。不允许删除、取消分组或重命名系统 root 分组。不把跨 root 外层普通分组写入任一 root-local state。不把窗格内 viewport、active root 或缩略图顺序写入 root-local state。不承诺旧版本所有历史单根 VSCode workspaceStorage 都能被后台自动发现。不在同一个 Host 内支持多个 display node 同时呈现同一个 runtime；当前 `runtimeSessionBindings` 仍是一条 runtime key 对应一个 display node，未来如需同 Host 多视图呈现，应升级为 subscribers/list。

## 5. 候选方案

方案 A 是 multi-root 第一次打开时 fork 某份单根状态，之后单根和多根互不影响。它实现简单，但用户在 multi-root 中整理某个 root 后，单独打开该 root 看不到结果。本轮不采用。

方案 B 是 multi-root 维护一张独立共享画布，节点用 `cwd` 标识 root。它接近现有单状态模型，但单根与多根仍是互相看不见的分支。本轮不采用。

方案 C 是 root-local 状态 + multi-root 组合视图 + overlay。每个 root 维护自己的 root-local 状态；单根直接读取它；多根读取所有 root-local 状态并生成系统 root 分组；root 分组布局属于 overlay。本轮继续采用，作为数据与默认呈现基础。

方案 D 是在现有画布上新增 root 切换器，只显示一个 root，其他 root 变成列表项。它实现成本低，但会丢掉多根全览，用户无法同时观察多个 root 的执行状态。本轮不采用。

方案 E 是新增 `paneGallery` 呈现模式，保留方案 C 的事实源和持久化，只在 Webview 把各 root 投影成会议 gallery 式窗格。它能满足“全览所有 root”和“放大一个 root”的双路径，并且不破坏当前 `rootGroups` 用户已经整理过的 overlay。本轮采用，且通过配置与现有模式切换。

新增 root 分组的空间落点比较过几类成熟算法。ELK / Graphviz 这类全图布局适合层次图、力导向图或大型图重排，但它们会把已有 root 分组一并重算，不符合 overlay 是用户手工整理结果的约束。D3 force collision 一类碰撞约束适合持续模拟节点云，容易带来迭代收敛和抖动问题。矩形 packing / overlap removal 更贴近本需求：新增对象有明确矩形尺寸，已有 root 分组是不可移动障碍物，只需要找离当前视口中心最近且不重叠的槽位。因此 `rootGroups` 仍采用局部确定性矩形候选槽位搜索，不新增布局库依赖。`paneGallery` 的窗格排布是 Webview 视口布局，不写入 overlay，因此可用 CSS grid / flex 与确定性排序完成，不需要引入图布局库。

## 6. 正式方案

### 6.1 数据分层

系统分三层状态。`root-local canvas state` 是每个 workspace folder 一份 `CanvasPrototypeState`，保存该 root 的普通节点、用户分组、root 内连线、文件活动摘要和 Note 内容。`multi-root composed view` 是多根 workspace 运行时构造出的内存态，包含所有 root-local state 的命名空间化节点、用户分组，以及每个 root 的系统 root 分组。`multi-root overlay` 是当前 multi-root workspace 专属布局，保存 root 分组的位置、尺寸、父分组关系，以及包含多个 root 分组的 workspace-level 普通分组。

`paneGallery` 不增加第四份事实状态。它在 `src/webview/main.tsx` 从同一份 composed state 派生 root pane view model：每个 view model 由一个 `role === 'workspace-root'` 的 `CanvasGroupSummary`、该 root 拥有的 nodes / groups / edges 和运行摘要派生而来，但 pane 内不渲染 `rootGroups` 模式的 workspace-root 分组框或水印，因为窗格边界已经承担 folder 区分。`src/panel/CanvasPanelManager.ts` 仍是宿主权威状态入口；`src/common/canvasMultiRootComposition.ts` 仍负责纯数据组合/拆分；`src/common/protocol.ts` 只需要新增运行时配置字段，不应让 Host 为窗格模式维护另一套节点图。

### 6.2 Root-local storage

root-local 状态使用扩展 global storage 按 root 绝对路径稳定分桶保存，避免依赖 VSCode 未公开的“由任意 folder path 反查 workspaceStorage slot”能力。单根 workspace 加载时优先使用 root-local snapshot；如果 root-local 还不存在，则使用当前 workspace snapshot，并在持久化时镜像到 root-local。多根 workspace 只把 root 内状态写回 root-local storage，当前 multi-root workspace storage 只保存组合快照和 overlay。

切换 `devSessionCanvas.canvas.multiRootPresentationMode` 不触发 root-local migration，也不清空 overlay。`rootGroups` 里用户移动 root 分组后产生的 overlay 继续保留；切到 `paneGallery` 时只是暂时不把 overlay 作为窗格排布依据。切回 `rootGroups` 时，root 分组位置、尺寸和外层 overlay 分组仍按原数据恢复。

### 6.3 系统 root 分组与 rootGroups

多根组合视图中，每个 workspace folder 生成一个 `CanvasGroupSummary`，其 `role` 为 `workspace-root`，`workspaceRootPath` 是 root 绝对路径，`id` 使用 root path 的稳定哈希生成。root 分组可以移动、resize、参与同级避让，并可以作为整体被 overlay 普通分组包含；它不允许删除、取消分组或重命名。root 分组的标题复用普通分组的反向缩放和宽度压缩规则，确保全局 fit view / 低倍率概览时仍能作为工程区域线索；root 分组只读且不显示普通分组的取消分组/删除分组按钮。为降低多根 workspace 下用户在同一画布中迷失 root 的风险，root 分组的 body 区域以固定密度平铺同名的签名式水印：文本使用 root 分组标题（即 workspace folder 展示名），完整路径仍只进入标题 tooltip；水印采用横向文本，基础字号与 root 分组标题的基准字号一致，但水印使用独立的 zoom 反向缩放，不继承 title tab 为适配分组宽度而降级后的 readable scale；当 title 因 root 分组过窄被截断时，水印仍继续放大到当前 zoom 对应的可读尺寸。若 title 混入路径片段或形如 `name - /path/to/name`，水印先收敛成可读 root 名称；普通长 root 展示名在 tile 内按断点最多显示两行。水印跟随 VSCode theme token、更低透明度、更疏的 tile 密度、不可交互，并通过 `pointer-events: none` 保证不拦截 body 选择、双击聚焦或右键创建入口；水印层位于 root/普通分组背景之上、React Flow 节点层之下，因此 root 内普通分组不会把水印整块遮掉，但稳定节点仍按对象实体覆盖水印；用户可通过 `devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 关闭，默认开启。root 分组不是执行上下文本身，执行节点 `metadata.cwd` 仍是权威。导航层把 root 分组视为一等空间对象：multi-root 下全局 fit view 默认包含所有 root 分组，MiniMap 也要显示 root 分组的相对布局；这只影响可视导航，不改变 root-local / overlay 的状态分层。

### 6.4 PaneGallery 交互模型

`devSessionCanvas.canvas.multiRootPresentationMode = "paneGallery"` 时，Webview 不再把所有 root 放进同一张无限画布，而是渲染 `PaneGallery`。这个组件包含四种局部布局状态：`dynamic`、`grid`、`topThumbnails` 和 `sideThumbnails`。`dynamic` 是默认的弹性全览布局，用 CSS grid/flex 在当前 `editor` / `panel` 可用宽高中按 root 数量和容器比例分配窗格；不同窗格可以有不同尺寸，但应尽量铺满画布区域。`grid` 使用更规则的宫格排列，便于用户稳定比较多个 root。`dynamic` 与 `grid` 下，每个 root 都是可交互子画板，视觉和行为应尽量接近当前主线的单一画板，并保留左下角画板控制按钮；除子画板自身的画板内边界外，pane 之间只用最简单的 VSCode 原生 border line 区分。`topThumbnails` 和 `sideThumbnails` 则保留一个 active root 主画板，主画板的画布体验与当前主线单一画板一致并保留左下角画板控制按钮；其他 root 显示为顶部或右侧的不可交互画板缩略图。`paneGallery` 不再提供整条顶部 toolbar，也不提供常驻 filter roots 搜索框，但保留主线画布右上角的使用提示入口；模式切换入口不放在右上角，而是进入每个可交互画板左下角控制按钮区域。全览模式下入口显示 `eye`，点击后把当前 root 作为 thumbnail 模式主画板，并进入上次选择的 `topThumbnails` 或 `sideThumbnails`，首次默认 `sideThumbnails`；thumbnail 模式下入口显示 `globe`，点击后返回上次选择的 `dynamic` 或 `grid`，首次默认 `dynamic`。hover 菜单始终在右侧展示 `dynamic`、`grid`、`topThumbnails`、`sideThumbnails` 四个具体模式，不因当前粗状态而裁剪；其中动态、宫格、顶部缩略图和右侧缩略图分别使用 `layout` / `table` / `split-vertical` / `split-horizontal` 图标，菜单视觉与左下角画板控制按钮一致。

`dynamic` 与 `grid` 中每个可交互 root pane 使用独立 overview viewport，而不是共享 `rootGroups` 的全局 viewport，也不复用缩略图模式主画板的 viewport。pane 首次挂载、root 内容变化或 pane 尺寸显著变化时，默认对该 root 子图执行 fit-to-pane：计算 root 内节点、分组、连线相关 bounds，用 pane 内容区尺寸和内边距得出目标 viewport。这里的 fit 与主线单一画板的全局 fit view 语义保持一致，不额外限制缩放比例；概览模式也必须按该 pane 自己的 zoom 与主线 overview threshold 判断，不能因为进入 paneGallery 或其他 pane 缩小就让所有 pane 都处于概览状态。用户在 `dynamic` / `grid` 中 pan/zoom 后只更新该 root 的 overview viewport；用户在 `topThumbnails` / `sideThumbnails` 的 active root 主画板中 pan/zoom 后只更新该 root 的 main viewport。缩略图本身始终使用真实画板的 fit view，不写入 viewport 记忆。这些 viewport 都只进入 Webview local state，并按 root id 与 presentation mode 校验恢复；它们不写入 root-local state，也不写入 multi-root overlay。

root 数量很多时，`paneGallery` 不采用“所有 root 永远同屏”的硬约束。`dynamic` / `grid` 先按最小可交互 pane 尺寸决定当前列数和行数；当 root 数量超过同屏容量时，gallery 变成可滚动容器，并应使用虚拟化或按可见区挂载重型 pane，避免一次性运行过多 React Flow / xterm surface。可见 root pane 保持可交互；离屏 root 只保留轻量排序、状态摘要和定位数据。由于本轮明确暂不提供 filter roots，第一版规模处理依靠滚动、稳定排序、缩略图模式和后续可补的快速跳转入口，而不是常驻搜索框。顶部缩略图 rail 内的缩略图画板在未横向溢出时横向居中，右侧缩略图 rail 内的缩略图画板在未纵向溢出时纵向居中；一旦 rail 内容溢出，必须用兼容旧 Chromium 的外层滚动容器与内层 track 居中结构或等价实现退回 start 对齐，不能依赖 `safe center` 作为可达性的关键路径，保证滚动起点能看到第一张非 active root 缩略图，滚动终点能看到最后一张缩略图。

`paneGallery` 借鉴会议 gallery 的结构，而不是视觉风格。窗格不使用头像、视频控件、参会者计数或会议装饰；它们继续使用 `docs/UI.md` 的 VSCode theme token、紧凑 spacing 和状态色。每个 pane 左上角使用更轻、更浅的 multi-root root 标签，只显示 root 名称并通过 tooltip 暴露完整路径；nodes / waiting / attention 等汇总 subtitle 不常驻显示。active root 使用 `--vscode-focusBorder` 或状态 token 建立清晰边界；attention / error / waiting 等状态以节点自身状态、图标或 tooltip 辅助表达，不能只靠颜色。

第一版将交互分成完整 root 子画板与缩略图。`dynamic` 和 `grid` 中每个 root pane 都是可交互子画板，支持在该 root 内创建 Note / Agent / Terminal、拖拽节点、输入终端、拖入 Markdown 和应用模板；窗格边界直接决定目标 root。`topThumbnails` / `sideThumbnails` 中 active root 主画板同样承载深度交互，并尽量复用主线单一画板的控件、缩放体验和右下角 MiniMap；`dynamic` / `grid` 的多 root 子画板不渲染 MiniMap，避免每个 pane 同时出现导航小窗造成视觉噪音。缩略图仍渲染对应 root 的画板 fit view，而不是复用 MiniMap 或静态 SVG 预览；缩略图可以完整挂载对应 root 的子画板并进行 execution snapshot / live 状态 hydrate，以保证缩略图内容与切换为主画板时的连续性。这里的“不可交互 / 不承载终端输入”仅指缩略图不接受由缩略图内用户交互触发的 terminal input、节点拖拽、编辑、创建、drop 或 start / stop 等操作/消息；snapshot hydrate、attach 和正常执行生命周期同步不在禁用范围内。缩略图复用左上角轻量 root 标签，不在缩略图外再包一层标题卡片；缩略图单击只选中或预览缩略图，不切换主画板；只有双击缩略图才把对应 root 变成 active root 主画板，避免误触。

`paneGallery` 的每个可交互 root pane 内部仍使用命名空间化 display id。创建 Note / Agent / Terminal、拖入 Markdown、应用模板或右键创建时，Webview 发送的目标 group 是该窗格对应的 workspace-root group；宿主按现有 multi-root 规则写回对应 root-local state。跨 root 连线、跨 root 拖拽迁移和静默改写 `cwd` 仍被拒绝。用户如果需要整理 root 分组的空间位置、resize root 分组或创建包含多个 root 的 overlay 普通分组，应切回 `rootGroups`。

### 6.5 配置与局部 UI 状态

新增配置 `devSessionCanvas.canvas.multiRootPresentationMode`，类型为 string enum，取值 `rootGroups` 与 `paneGallery`，scope 为 `window`，默认 `rootGroups`。该配置只在 multi-root workspace 中改变呈现；单根 workspace 忽略该设置并继续显示单 root 画布。配置变化可以通过 Host 更新 `CanvasRuntimeContext` 热应用到当前 Webview，不要求 Window Reload，因为它不改变宿主事实源和 runtime ownership。若实际实现发现 React Flow lifecycle 或 xterm 释放存在不可控风险，应在实现计划的决策记录中改为 reload 生效，并同步更新本设计和 Settings 文案。

`paneGallery` 的 `dynamic` / `grid` / `topThumbnails` / `sideThumbnails`、上次使用的全览布局、上次使用的缩略图布局、active root、每个 root 的 overview viewport、每个 root 的 main viewport、gallery scroll offset 和 rail 位置属于 Webview local UI state。它们可以用 `acquireVsCodeApi().setState()` 保持 Webview reload 后的短期连续性，但不得写入 root-local canvas state 或 multi-root overlay。hover 弹出的布局选择只属于瞬时组件状态，不需要持久化。local state 需要带上 presentation mode 与 root id 校验；当 workspace folder 移除或 root id 不再存在时，active root 回退到第一个 root，对应 pane viewport 和滚动定位也要丢弃或重新 fit。旧版单一 `paneViewports` 状态只作为兼容迁移输入：已标记为 main-fit 的 root 迁移为 main viewport，其他 root 迁移为 overview viewport。

### 6.6 组合与拆分规则

组合时，宿主按 root 顺序读取每个 root-local state。节点、用户分组、连线和文件活动 owner node id 都加上 root 命名空间前缀；root-local 顶层用户分组和稳定节点成为 root 分组的直接成员；root-local 坐标加上 root 分组的内容偏移；root 分组的位置、尺寸和父分组来自 overlay，没有 overlay 时按 root 顺序自动铺开。`src/common/canvasMultiRootComposition.ts` 的 `ComposeMultiRootCanvasStateOptions.newRootPlacement` 只服务 workspace folder 变化时新增且 overlay 尚无位置的 root：Host 把当前可见中心传入后，组合模块以该中心作为锚点，生成 anchor、已有 root 四周贴边和环形扩张候选，按候选中心到可见中心的距离选择第一个不与已有 root 分组扩张阻挡矩形相交的位置，并在下一次 decompose / persist 时写入 multi-root overlay。已有 overlay root 分组不因新增 root 重新排布；没有可见中心时仍回退到默认网格。root 内连线只允许连接同一个 root 分组内的节点；Webview 与 Host 都拒绝跨 root 创建或重连连线，避免生成无法拆回 root-local、且 overlay 不持久化的临时边。文件活动自动节点和 file-activity edge 使用同一 root 命名空间重建，且 `file` / `file-list` 按 owner Agent 的最近公共父分组推导为 root 内自动成员；没有公共用户分组时直接归属该 root 分组。当前版本不合并跨 root 的 `file` / `file-list`，避免产生无法拆回 root-local state 的跨 root 自动 artifact，并避免不同 root 的 `file-*`、`file-list-*` 或 suppression id 冲突。

live 文件活动进入宿主时，`recordAgentFileActivity()` 以 owner 节点所在 workspace-root namespace 生成 `fileReferences.id`。如果多根组合视图中仍存在旧的未命名空间化 file reference，重建文件活动 artifact 时也会按当前 root scope 补 namespace，并只迁移或移除属于当前 root 的 owner，避免把另一个 root 的 owner 一起丢掉。这样用户删除自动文件节点后，suppression id 能在 compose/decompose 往返中继续落到同一个 root-local file artifact，而不会在重载后复活。

拆分持久化时，宿主按命名空间把 composed view 拆回各 root-local state。对象 ID 去掉 root 命名空间前缀，坐标减去 root 分组内容偏移；root 分组位置、尺寸和父分组写入 overlay；包含 root 分组的 workspace-level 普通分组写入 overlay，不写入任何 root-local state。`paneGallery` 不参与 decompose，不生成额外 overlay 条目。

### 6.7 创建与拖拽语义

单根 workspace 创建行为保持现状。多根 workspace 中，从 root 分组内右键创建节点或分组时，新对象归入该 root。命令面板或侧栏创建节点时，如果不能从位置或 cwd 推断 root，宿主让用户选择目标 root。`paneGallery` 的 `dynamic` / `grid` root pane 和 thumbnail 模式 active root 主窗格都可以直接作为目标 root 推断来源，减少 Quick Pick。创建 `Agent` / `Terminal` 时，若没有显式 `cwdOverride`，宿主使用目标 root 的路径作为 `metadata.cwd`。拖入 Markdown 文件创建关联 Note 时，只有落点在某个 root 分组、`dynamic` / `grid` root pane 或 active root 主画板内才创建。拖动执行节点到其他 root 分组或其他 root pane 不会静默改写 `cwd`；如果用户在 `dynamic` / `grid` 下跨窗格拖动节点或连线，Host 必须按跨 root 操作拒绝或回弹。thumbnail 模式的缩略图不作为创建、拖拽、输入或 drop 目标。当 VSCode `onDidChangeWorkspaceFolders` 发现新增 root 后，`rootGroups` 仍按现有 `host/focusGroup` 流程聚焦新增 root；`paneGallery` 下新增 root 应插入窗格列表，并在不打断用户当前输入的前提下显示短暂高亮或状态提示，是否自动切换 active root 需要在实现前通过 ExecPlan 明确。

### 6.8 Multi-root live runtime 恢复语义

`Agent` / `Terminal` 的后端进程由 runtime supervisor 和 provider/shell 持有，canvas 只是 display surface；multi-root、single-root 或两个 VS Code 窗口同时打开时，不应因为显示形态不同而阻止恢复同一个 live runtime。display node id 只服务渲染、选择、连线、布局和 `decomposeMultiRootCanvasState()`；runtime binding id 以 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 为权威。这里的 `runtimeStoragePath` 必须是 VS Code 分配给该窗口/会话的具体 extension storage slot；同一个 root 可能同时存在多个 `workspaceStorage` slot，它们必须被视为不同 runtime，不能退化成只按 root path 绑定。

多根恢复不应再整体以 `multi-root-workspace` block；宿主应按 composed execution node 找回所属 root-local metadata，用其中保存的 `runtimeBackend`、`runtimeStoragePath`、`runtimeSessionId` 和节点类型 attach 原 session。attach、output 和 state event 更新当前窗口里的 display node；持久化时继续依赖现有 decompose 还原成 root-local node id。多窗口控制语义定义为 shared runtime：output 由 supervisor 多播，input、stop 和 delete 作用到同一 backend session，resize 第一版采用 last-writer-wins。

`paneGallery` 只改变 display surface。`dynamic` / `grid` root pane 和 thumbnail 模式 active root 主窗格可以承载 terminal input，仍使用同一个 runtime binding key；缩略图可以显示 live runtime 状态与 attention 提示、hydrate / attach execution snapshot，并跟随正常执行生命周期同步，但不直接承载由缩略图内用户交互触发的 terminal input、start / stop、编辑、拖拽、创建或 drop 消息。必须避免用当前 multi-root workspace 的 storage path 猜 runtime，也不能用同 root 的当前 slot 回填旧 live-runtime snapshot。对于已有 root-local snapshot，如果 `persistenceMode` 是 `live-runtime` 且存在 `runtimeSessionId`，但缺少 `runtimeStoragePath`，宿主不能把它隐式指到 multi-root workspace storage 或同 root 的当前 storage slot；应通过兼容迁移明确补齐原 root-local runtime storage，或显式降级为历史恢复并记录诊断，避免 attach 到错误 supervisor 或误报找不到 session。当前 `runtimeSessionBindings` 是一条 runtime key 对应一个 display node，这对单根窗口和多根窗口同时 attach 成立，因为两个窗口各有自己的 Host / Manager；`paneGallery` 若在同一个 Host 内同时可见多个 root pane，仍必须保证同一 runtime 只由所属 root pane 的一个 display node 承载；若未来同一个 Host 内允许同一 runtime 被多个 display node 同时呈现，应把 binding value 改成 subscribers/list。

## 7. 风险与取舍

root-local global storage 与旧 workspace storage 并存，用户可能有迁移期看不到旧历史；缓解方式是单根打开时自动镜像当前 workspace storage。组合视图中节点 ID 命名空间化会影响 live runtime attach，因此实现必须把 display node id 与 runtime binding id 分离，不能把 namespaced display id 当成后端进程身份。multi-root 恢复的主要风险是错误使用当前 multi-root workspace storage path；同 root 多 VS Code 窗口还会产生多个 `workspaceStorage` slot，修复时必须以 root-local metadata 中的完整 `runtimeStoragePath` 为准，旧 snapshot 缺字段时只能迁移或显式降级。用户把执行节点拖到其他 root 分组后可能期待 cwd 改变；第一版不静默改写，以避免错误执行目录。

`paneGallery` 的主要取舍是让 `dynamic` / `grid` 模式下的多个 root pane 同时可交互，换取全览状态下的直接处理效率，但会提高内存、焦点、键盘、terminal resize 和跨窗格拖拽判定复杂度。缓解方式是把 root 身份绑定到窗格边界和消息目标上，缩略图只做状态预览，并在测试中覆盖多 pane focus、terminal input 归属、拖拽边界和跨 root 拒绝。root 很多时如果仍强行同屏，会让所有 pane 变成不可读缩略图；因此 `paneGallery` 必须优先保证最小可交互尺寸，用滚动、虚拟化、缩略图模式和后续快速跳转处理规模，而不是依赖顶部 toolbar 或常驻搜索框。另一个风险是用户误以为 paneGallery 是 workspace 管理器或会议协作功能；缓解方式是在 Settings 文案、UI 空状态和文档中明确它只是多根呈现模式。`paneGallery` 与 `rootGroups` 的切换如果热应用，会要求 Webview 正确释放旧 React Flow / terminal 交互层；若实现中验证失败，应改为 reload 生效并更新文档。

## 8. 验证方法

已有 `rootGroups` 验证继续保留：新增 root composition 纯函数测试覆盖 ID 命名空间、root 分组 overlay、组合/拆分、root 内新增对象归属、overlay 外层分组重组，以及 Add Folder 新增 root 按可见中心就近避让并写回 overlay。扩展分组测试覆盖系统 root 分组不可删除/取消分组/重命名、root 内扩边、root-root 避让和 root 被外层分组包含。扩展协议、模板、Markdown 拖入和执行 cwd 测试。sidebar workspace 操作需要用 manifest 与节点列表 Webview 测试覆盖：`节点` view title 暴露添加 folder / 新建 worktree，workspace folder 分组行只在系统 root 上显示 folder kind 图标与 folder 级 worktree / remove-worktree / remove-folder 操作，worktree action 使用 `worktree` Codicon，并向 Host 发送 rootPath；worktree ref QuickPick 仍需真实 VS Code 宿主人工验证。导航与 MiniMap 需要保留 Webview Playwright：空 root 分组没有节点时仍被全局 fit view 纳入；多个 root 分组在 MiniMap 中可见且与普通用户分组可区分；`host/focusGroup` 能用缩放平移动画把新增 root 分组居中。live runtime 恢复需要覆盖 multi-root reload 后 Agent / Terminal 真实 reattach、离线输出可见、单根窗口与 multi-root 窗口同时 attach 同一 session、resize last-writer-wins，以及缺失 `runtimeStoragePath` 的迁移或显式降级回归。

新增 `paneGallery` 实现时必须补充验证：配置默认值为 `rootGroups`；将 runtime context 切到 `paneGallery` 后 Webview 渲染 root pane 数量等于 workspace root 数量；不出现整条 paneGallery 顶部 toolbar、filter roots 搜索框或右上角模式入口，但右上角使用提示入口仍可见；左下角画板控制区提供模式入口，全览态为 `eye`、thumbnail 态为 `globe`，点击执行粗切换，hover 后始终暴露四个具体模式，并验证 `dynamic` / `grid` / `topThumbnails` / `sideThumbnails` 选项分别使用 `layout` / `table` / `split-vertical` / `split-horizontal` 且菜单样式对齐画板控制按钮；粗切换默认从全览进入 `sideThumbnails`、从 thumbnail 返回 `dynamic`，并在用户选择后记住上次的全览/缩略图具体模式；`dynamic` / `grid` pane 显示轻量 root 标签和路径 tooltip，不显示 nodes / waiting / attention subtitle，默认 fit 当前 root 子图且不额外限制缩放比例，per-pane overview 跟随各 pane 自己的 zoom，root 内容过大时 pane 内 pan/zoom 可用；overview viewport 与 thumbnail 主画板 main viewport 必须按 root 分离记忆，root 首次成为 thumbnail 主画板时自动 fit，后续切换主画板恢复 main viewport，切回 `dynamic` / `grid` 恢复 overview viewport，缩略图自身 fit view 不写入 viewport；root 数量超过同屏容量时 gallery 保持最小可交互 pane 尺寸并通过滚动/虚拟化或等价机制访问所有 root；`dynamic` / `grid` pane 内创建 Note / Agent / Terminal、拖拽节点、terminal input 和 Markdown drop 的目标 root 正确；切到 `topThumbnails` 或 `sideThumbnails` 后 active root 主画板可见且右下角 MiniMap 可见，其他 root 进入不可交互的画板缩略图 rail，顶部 rail 未溢出时横向居中、右侧 rail 未溢出时纵向居中，溢出时滚动起点能看到第一张非 active root 缩略图且滚动终点能看到最后一张缩略图；`dynamic` / `grid` 子画板不显示 MiniMap；缩略图复用左上角轻量标签，不使用外部标题卡片或 MiniMap/SVG 预览；在 thumbnail 模式缩略图中允许只读预加载与 execution snapshot 同步，单击 root 不切换 active root，双击 root 只切换 active root，且缩略图不会发送由缩略图内用户交互触发的 create / drag / edit / terminal input / start / stop / drop 等消息，也不会因缩略图内用户交互写入 root-local state；paneGallery 不渲染 workspace-root 分组框或水印；active root 主窗格创建 Note / Agent / Terminal 时目标 root 正确，单独打开该 root 可见对象；跨 root 连线和跨 root 拖拽仍被拒绝；切回 `rootGroups` 后 overlay 位置未被 paneGallery 改写。最终运行 `npm run typecheck`、`npm run build`、`npm run test:canvas-multi-root-composition`、相关 Playwright grep 和 `git diff --check`。

## 9. 当前验证状态

截至 2026-06-13，本设计的 `rootGroups` 主路径已完成自动化验证：composition、protocol、group policy、execution context、template、Markdown drop、typecheck、build 与针对 workspace root group 的 Playwright 用例均通过。Add Folder root placement 本轮新增 `test:canvas-multi-root-composition` 覆盖新增 root 使用当前可见中心就近放置、避让已有 root 并写回 overlay，新增 Playwright 用例覆盖 `host/focusGroup` 通过缩放平移动画把 workspace root 分组居中并选中；root body 平铺签名水印补充 Playwright 用例覆盖仅 workspace-root 渲染、展示 root title、重复铺排、横向样式、常规字号与 root title 同步缩放、title tab 被分组宽度压缩时水印独立反向缩放、path-like 长标题简化和普通长标题换行、低透明和疏密度不可交互、配置关闭、不拦截 body 选择、普通分组背景不遮挡以及节点层仍覆盖水印。review 修复已追加覆盖 live 文件活动按 owner root namespace 记录 file reference、旧 unnamespaced reference 在 root scope 内迁移、suppression 往返保留，以及旧 multi-root live runtime skip 不覆盖 root-local reattach 信号。root 分组参与全局 fit view 与 MiniMap 的导航增强已在 `docs/exec-plans/completed/canvas-spatial-fit-minimap.md` 中完成并记录定向验证。2026-06-06 已把 multi-root live runtime 从“整体跳过”修订并实现为“按 root-local runtime metadata 共享恢复”：Host 不再以 `multi-root-workspace` 整体 block，runtime binding key 纳入 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind`，对缺失 `runtimeStoragePath` 的旧 root-local live-runtime snapshot 显式降级，并让 supervisor delete 先向订阅者广播非 live 终态，避免误连当前 multi-root workspace storage 或让其他窗口停留在假 live。2026-06-07 针对同一个 root 可能存在多个 VS Code `workspaceStorage` slot 的风险补充验证：单根 root-local snapshot 缺少 `runtimeStoragePath` 也降级，不再由当前同 root slot 回填；`test:smoke-storage-slot` 覆盖 root-local snapshot 优先、旧 sibling slot 恢复和缺字段降级；real reopen smoke 记录并校验 Agent / Terminal 重连前后的 slot name 不变。2026-06-16 sidebar workspace folder 操作已补 `npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-codicon-bundle`、`npm run test:sidebar-list-colors`、`npm run typecheck`、`npm run build` 与 `git diff --check`，覆盖 title action、workspace folder 分组 action、worktree 专用 Codicon、VS Code 风格 QuickPick ref 选择、workspace folder 前置 kind 图标与行尾操作顺序；真实 VS Code 中的 folder picker、`git worktree add`、workspace folder 移除、worktree 移除和新增 root 聚焦仍需人工验证。真实 VSCode smoke 已补充 `multi-root-real-reopen`、`single-to-multi-root-real-reopen` 与 `two-window-shared-runtime` 三条路径，覆盖 multi-root 窗口重启恢复、单根创建后 multi-root 重启恢复、离线输出可见、重连后输入继续作用同一 session、不使用当前 multi-root workspace storage 误连，以及两个独立 VS Code 窗口同时 attach 同一 Agent/Terminal runtime 后的双向 output 多播、双向 input、resize last-writer-wins、stop/delete 共享 session 终态同步。全量 Webview Playwright 仍有与本功能无直接关系或 lifecycle 断言口径相关的失败，需要后续单独收口。

2026-06-15 本轮新增的 `paneGallery` 先完成规格与设计收口，并明确必须按 `docs/exec-plans/completed/canvas-multi-root-pane-gallery-mode.md` 推进实现和回填验证证据。

2026-06-16 补充：`paneGallery` 的 `tiled` root pane 被修订为可交互窗格，而不是只读预览；`focus` 缩略窗格仍保持只读预览和 active root 切换。本轮第一版已落地配置声明、runtime context 透传、Webview `PaneGallery`、`tiled` / `focus` 布局、每 root 独立 viewport、滚动 gallery、搜索过滤、平铺窗格创建目标 root、focus 缩略窗格无写入副作用和 Markdown drop 目标 root 回归。文档 frontmatter 仍保持 `validation_status: 验证中`：自动化尚未覆盖真实 terminal input 端到端、复杂跨 pane 拖拽和可见区虚拟化；many-roots 第一版使用滚动 gallery 与搜索定位而不是真正虚拟化。

2026-06-17 补充：根据新的视觉与交互反馈，`paneGallery` 不再采用整条顶部 toolbar、filter roots 搜索框或 `tiled` / `focus` 二态命名，但保留右上角使用提示入口；正式局部模式改为 `dynamic`、`grid`、`topThumbnails`、`sideThumbnails`。动态/宫格模式下每个 root 子画板应尽量与当前主线单一画板一致，并且不额外限制缩放比例；顶部/右侧缩略图模式下主画板与单一画板一致，缩略图使用对应 root 画板 fit view 且不限制比例；缩略图双击才切换 active root。第二轮进一步取消右上角模式按钮，把模式入口移入左下角画板控制区；缩略图改为不可交互的真实 React Flow 画板而非 MiniMap/SVG 预览；paneGallery 不渲染 workspace-root 分组框/水印；root 标签轻量化并删除 nodes / waiting / attention subtitle；动态布局改为非等尺寸窗格铺满区域；per-pane overview 按各自 zoom 判定。第三轮明确左下角入口图标和粗切换语义：全览态 `eye` 点击进入 thumbnail，thumbnail 态 `globe` 点击返回全览；hover 始终展示四模式，动态/宫格/顶部缩略图/右侧缩略图用 `layout` / `table` / `split-vertical` / `split-horizontal`，菜单样式贴近画板控制按钮。第四轮补充粗切换记忆与 MiniMap 规则：全览转 thumbnail 使用上次顶部/右侧缩略图，thumbnail 返回全览使用上次动态/宫格，默认分别为右侧缩略图和动态；thumbnail 主画板显示右下角 MiniMap，动态/宫格子画板不显示 MiniMap。本轮已补定向 Playwright 回归覆盖无 toolbar/filter/右上角入口、左下角模式入口、粗切换记忆、thumbnail 主画板 MiniMap、动态/宫格不显示 MiniMap、画板化缩略图、缩略图单击无副作用、缩略图双击切换、many-roots 滚动、动态布局非等尺寸、per-pane overview 和 Markdown drop 目标 root。2026-06-18 追加收口 thumbnail rail 溢出对齐：未溢出时通过内层 track 自身 margin 居中，溢出时不允许居中到滚动容器负偏移之外，顶部/右侧 rail 均必须能从第一张缩略图滚到最后一张缩略图；实现不得依赖 VS Code 1.80 / Chromium 108 不支持的 `safe center` 行为。同日补充 viewport 记忆拆分：`dynamic` / `grid` 使用 overview viewport，thumbnail 主画板使用 main viewport；root 首次成为 thumbnail 主画板时自动 fit 并写入 main viewport，后续恢复 main viewport；切回 overview 时恢复 overview viewport，缩略图自身始终 fit 且不写入 viewport。文档仍保持 `validation_status: 验证中`：真实 VSCode 宿主下 terminal input、复杂跨 pane 拖拽和大量 root 可见区虚拟化性能尚未端到端验证。
