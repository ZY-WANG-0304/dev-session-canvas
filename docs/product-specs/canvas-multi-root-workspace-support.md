---
title: 画布多根 workspace 组合视图规格
status: 已确认
updated_at: 2026-07-03
related_designs:
  - docs/design-docs/canvas-multi-root-workspace-support.md
related_plans:
  - docs/exec-plans/active/canvas-multi-root-composed-canvas-rewrite.md
  - docs/exec-plans/completed/canvas-multi-root-pane-gallery-mode.md
  - docs/exec-plans/completed/canvas-spatial-fit-minimap.md
  - docs/exec-plans/completed/canvas-add-folder-root-placement.md
  - docs/exec-plans/completed/sidebar-workspace-worktree-actions.md
---

# 画布多根 workspace 组合视图规格

## 背景

用户在 VSCode 中既会单独打开一个工程，也会把多个工程作为 multi-root workspace 一起打开。Dev Session Canvas 应保持同一套 root 心智：单根只显示当前 root 自己的画布，多根显示所有当前 root 的画布内容，并用系统 root 分组区分不同工程。随着 root 数量增加，单张组合画布虽然保留空间整理能力，但用户在日常巡检多个 root 的运行状态时需要更低成本的全览与聚焦模式。

## 用户目标

- 单独打开一个 workspace folder 时，只看到这个 root 自己的画布内容。
- 打开 multi-root workspace 时，看到所有当前 workspace folders 的画布内容。
- 可以通过配置在现有单张组合画布和新的多根窗格画廊之间切换，不迁移或复制 root-local 内容。
- 在多根窗格画廊中，可以把所有 root 画板按窗格平铺，像多人会议 gallery 一样快速巡检整体状态，并能在任一平铺窗格内直接处理对应 root。
- 在多根窗格画廊中，可以放大一个 root 作为主窗格，其他 root 以缩略图保留上下文和状态提醒。
- 每个 root 都有清晰的系统分组区域或窗格边界，避免不同工程的节点混在一起。
- 点击全局 fit view 或查看右下角 MiniMap 时，可以看到所有 root 分组的组合布局，即使某个 root 暂时没有节点。
- 通过 VSCode `Add Folder to Workspace` 添加新 root 后，新 root 分组出现在当前视野附近，并通过缩放平移动效进入视野。
- 通过 Dev Session Canvas sidebar 的 `节点` section 添加 folder、移除 folder、新建 git worktree、添加已有 git worktree 或移除 git worktree 时，仍复用同一套 workspace root 分组语义。
- 在多根画布中整理某个 root 内的节点后，单独打开该 root 仍能看到这些整理结果。
- 在 `rootGroups` 或 `paneGallery` 中从某个 root 内右键触发整理画布时，主菜单默认只整理当前 root 的节点；通过 `>` 进入二级菜单后，可以明确选择“整理当前 root 内的节点”或“整理整个 workspace 的画布”。
- 移动 multi-root 中的 root 区域只影响多根布局，不改写单根 root-local 节点坐标。
- root 内对象移动到边界外时，root 区域自动扩张，内容不会静默移出所属 root。
- 多根窗口重启后，已有 `Agent` / `Terminal` live runtime 可以按 root-local runtime 身份重新附着；单根窗口与多根窗口同时打开时共享同一个后端 session。

## 功能范围

1. 每个 workspace folder 拥有一份 root-local 画布状态。
2. 单根 workspace 读取并写入当前 root-local 画布状态。
3. 多根 workspace 读取所有当前 root-local 画布状态；默认仍按现有单张组合画布显示，也可以通过 `devSessionCanvas.canvas.multiRootPresentationMode` 切到多根窗格画廊显示。
4. `devSessionCanvas.canvas.multiRootPresentationMode` 是 window scope 配置，枚举值为 `rootGroups` 与 `paneGallery`；`rootGroups` 保持现有单张组合画布，`paneGallery` 使用同一批 root-local state 渲染多个 root 窗格。第一版默认值保持 `rootGroups`，避免改变已有用户的空间布局习惯。
5. `rootGroups` 中，每个 root 显示为一个系统 root 分组。root 分组的 body 以固定密度平铺同名签名式水印，用于在多根 workspace 中快速确认当前会话所属 root；水印只使用 root 展示名，不替代标题 tooltip 中的完整路径；如果展示名混入路径片段或形如 `name - /path/to/name`，水印只取可读 root 名称。水印采用横向文本，基础字号与 root 分组标题一致，但水印反向缩放不受 title tab 为适配分组宽度而降级的限制；当 root 展示名较长时，水印 tile 最多允许两行并继续保持可读。该能力由 `devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 控制，默认开启。
6. 系统 root 分组可以移动和 resize；移动后只保存多根 overlay 位置，不改变单根 root-local 节点坐标。
7. 系统 root 分组不能被删除、取消分组或重命名。
8. root 分组是 root-local 内容的硬容器：root 内节点或用户分组移动到边界外时，root 分组扩张并继续包含它们。
9. root 分组对外作为整体分组参与避让和包含：root 分组之间不能重叠，多个 root 分组可以被 multi-root overlay 普通分组包含。
10. 在 root 分组内创建节点、用户分组、模板内容或关联 Markdown Note 时，新对象写回该 root-local 状态。
11. 执行节点的 `metadata.cwd` 继续作为执行目录权威；拖拽到其他 root 分组不静默改写 cwd。
12. 多根组合视图内部使用命名空间避免不同 root 下的节点 ID、分组 ID 或连线 ID 冲突。
13. 多根组合视图中，用户创建或重连连线时，两个端点必须属于同一个 root 分组；跨 root 连线被拒绝。
14. 文件活动自动节点、file-activity edge 和 suppression id 在多根组合视图中按 root 命名空间重建，不跨 root 共享；`file` / `file-list` 在各自 root 内按 owner Agent 最近公共父分组归属，没有公共用户分组时归属对应 `workspace-root`。
15. 多根组合视图中的 live 文件活动记录按 owner 节点所属 root 生成 root-namespaced `fileReferences.id`；旧的未命名空间化引用在重建时按 root scope 迁移或补 namespace。
16. 多根组合视图中的 `Agent` / `Terminal` 恢复时，display node id 只服务渲染、选择、连线、布局和拆回 root-local；runtime binding id 以 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 为权威，其中 `runtimeStoragePath` 必须保留具体 VS Code `workspaceStorage` slot。
17. 多根窗口不能用当前 multi-root workspace storage path 猜 runtime；同一个 root 的多个 storage slot 也不能互相替代，必须使用 root-local metadata 中保存的完整 `runtimeStoragePath`。旧 snapshot 缺少 `runtimeStoragePath` 时必须迁移或显式降级为历史恢复，并记录诊断。
18. 全局 fit view、初始自动 fit、动态最小缩放和 MiniMap 把所有系统 root 分组作为一等空间对象纳入；multi-root 下全局 fit view 默认包含所有 root 分组。
19. 当 VSCode workspace folder 变化新增 root 时，如果该 root 在 multi-root overlay 中还没有位置，系统应以当前画布可见中心为锚点，选择离该中心最近且不与已有 root 分组重叠的可用位置；已有 overlay root 位置不被重新计算。
20. 新增 root 分组进入 composed view 后，Host 应请求当前 Webview 聚焦该 workspace-root group；Webview 通过平移与缩放动画把该 root 分组移入视野，并在动画结束后持久化 viewport，同时向 Host 上报动画后的 `webview/updateViewportCenter`。
21. `节点` sidebar section 可以调用 VS Code workspace folder API 添加文件夹或移除 folder；移除 folder 使用 VS Code 原生 modal，可选择保留该 root 的画板快照或先清空对应画板再移除，默认保留画板；无论是否清空画板，都不删除磁盘目录。
22. `节点` sidebar section 可以基于某个现有本地 git folder 创建 worktree，并在 `git worktree add` 成功后把新 worktree 目录添加到当前 workspace；也可以从同一个 repository 的 `git worktree list --porcelain` 中选择一个尚未加入当前 workspace 的已有 worktree，直接把该目录添加到 workspace。多根 workspace 下，如果入口不来自具体 workspace folder 分组，宿主必须先按 git common dir 合并同一 repository 的 workspace folders，只有存在多个不同 git repository 时才让用户选择基准 repository；随后用 VS Code 风格 QuickPick 选择添加已有 worktree、新分支、从指定 ref 创建新分支或直接基于已有 ref 创建 worktree；`HEAD` 或已被其他 worktree checkout 的分支会以 detached HEAD 创建。
23. `节点` sidebar section 可以对 workspace folder 分组执行移除 worktree：宿主先确认该 folder 是 linked git worktree，再使用 VS Code 原生 modal 让用户选择移除成功后清空对应画板或保留画板，默认清空画板；确认后先执行 `git worktree remove`，Git 成功后才按选择清空画板并从当前 workspace 移除对应 folder。若不是 git repository、不是 linked worktree、workspace 未受信任或找不到 `git`，必须弹窗说明具体原因。
24. `节点` sidebar section 的 workspace folder 分组行应在标题前用图标区分普通 folder、git repository 和 git worktree；行尾操作顺序为新建 worktree、移除 worktree、移除 folder。
25. `rootGroups` 和 `paneGallery` 中的右键“整理画布布局”采用 root-first 语义：当入口位于 workspace-root section body、title/border chrome、其内部用户分组或 `paneGallery` 可交互 root pane 时，主菜单项默认只整理该 workspace-root 的 root-local 节点和内部用户分组，不移动其他 root 分组，也不重排整个 multi-root overlay；同一菜单项右侧 `>` 打开二级菜单，二级菜单同时提供“整理当前 root 内的节点”和“整理整个 workspace 的画布”，其中全 workspace 选项才按全局组合画布整理所有 root 分组与外层对象。入口位于所有 root section 外部或单根 workspace 时，维持原有直接整理当前可交互画布的行为。
26. 模板功能在支持跨 root 模板前只对单个目标 root 生效：多根中应用模板会追加到目标 root-local state；重置为模板会清空目标 root-local 画布并终止该 root 内执行会话后套用模板，不清空其他 root，也不把 multi-root overlay 当作模板内容。`rootGroups` 中如果用户在所有 root section 外部触发重置为模板，Webview 必须提示用户在目标 root section 内重置且不发送 reset 请求；`paneGallery` 中目标 root 由可交互 root pane 或 thumbnail 模式 active root 主画板决定。
27. `paneGallery` 不改变 root-local storage、runtime binding、文件活动或 cross-root 限制；它只是多根呈现层。每个 root 窗格左上角只保留轻量 root 标签，显示 root 名称并在 tooltip 中保留完整路径；不在标签 subtitle 中常驻 nodes / waiting / attention 等汇总信息。界面不提供整条 paneGallery 顶部 toolbar，也不提供常驻 filter roots 搜索框，但保留主线画布右上角的使用提示入口。
28. `paneGallery` 包含四个运行时布局状态：`dynamic` 把所有 root 窗格按可用区域弹性排列并允许不同窗格尺寸不一致但铺满画布区域，`grid` 使用规则宫格排列，二者都用于全览、状态观察和在任一 root 窗格内直接处理；`topThumbnails` 与 `sideThumbnails` 保留一个 active root 主画板，并分别把所有 root 的缩略槽位放到顶部或右侧缩略图 rail，其中 active root 在自身 workspace 顺序槽位显示等尺寸占位卡片而不是第二个真实画板缩略图。默认粗状态是 `dynamic` 与 `sideThumbnails`，四种布局以及上次使用的全览/缩略图具体模式都属于 Webview 局部 UI 状态，不写入 root-local state。
29. `paneGallery` 的 `dynamic` / `grid` 窗格是可交互 root pane，支持在对应 root 内创建节点、拖拽节点、输入终端、拖入 Markdown、应用模板和重置为模板；每个交互动作的目标 root 由所在窗格身份确定。thumbnail 模式中的非 active root 缩略图仍是对应 root 的画板 fit view，而不是复用 MiniMap 或 SVG 预览；缩略图可以完整挂载对应 root 的子画板并进行 execution snapshot / live 状态 hydrate，以保证缩略图内容与切换为主画板时的连续性。这里的“不可交互 / 不承载终端输入”仅指缩略图不接受由缩略图内用户交互触发的 terminal input、节点拖拽、编辑、创建、drop 或 start / stop 等操作/消息；snapshot hydrate、attach 和正常执行生命周期同步不在禁用范围内。单击缩略图不切换主画板，双击非 active root 缩略图才把对应 root 变成 active root 主画板；active root 占位卡片不响应单击或双击切换。
30. `paneGallery` 的每个可交互 root pane 拥有独立 viewport。首次进入或 pane 尺寸变化时，默认按该 root 的子图做 fit-to-pane，缩放比例与概览触发都遵循主线单一画板的 fit/overview 语义，不在 paneGallery 中额外设置下限，也不因为进入 paneGallery 就强制所有节点进入概览状态；root 内容过大时 pane 允许内部 pan/zoom。四种布局下的 pane viewport 属于 Webview local UI state，不写入 root-local state 或 multi-root overlay。
31. 当 workspace root 很多时，`paneGallery` 不把所有 root 无限压缩到同屏。布局应优先保证 pane 的最小可交互尺寸；超过当前可用区域后使用可滚动/虚拟化 gallery，并依靠稳定排序、缩略图模式和后续快速跳转入口定位 root；本轮不提供 filter roots。thumbnail rail 可以比 `dynamic` / `grid` pane 更小，非 active root 仍以画板 fit view 呈现，active root 以同尺寸轻微斜纹占位呈现；顶部 rail 在未横向溢出时横向居中，右侧 rail 在未纵向溢出时纵向居中；一旦 rail 内容溢出，滚动起点必须对齐第一张 root 槽位，滚动终点必须能访问最后一张 root 槽位。
32. 在 `paneGallery` 的 `dynamic` / `grid` root pane 或 thumbnail 模式 active root 主画板内创建节点、拖入 Markdown、应用模板、重置为模板或启动执行节点时，目标 root 由窗格身份直接确定；跨 root 连线、跨 root 拖拽迁移和静默改写 `cwd` 仍不支持。
33. `paneGallery` 的视觉语言只借鉴多人会议的“gallery / thumbnails”布局模型，不引入视频会议风格头像、强装饰背景或多人实时协作语义；所有颜色、边框、状态和字体继续跟随 VSCode theme token 与 `docs/UI.md`。paneGallery 子画板天然用窗格身份区分 folder，不渲染 `rootGroups` 模式下的 workspace-root 分组框或水印；除子画板自身的画板内边界外，root 画板之间只使用最简单的 VSCode 原生 border line 宽度。paneGallery root 标签常态不再用 running / attention 的静态状态背景或边框色表达聚合状态；root 内存在待确认 attention 时，左上角 root 标签除可访问文本外，还应在 `strongTerminalAttentionReminder` 包含标题栏闪烁时复用执行节点标题栏闪烁动画；闪烁峰值与 reduced motion 静态高亮使用 root 标签当前 border color；动画峰值应通过更高占比背景混色、内外描边和轻量 halo 明确强于常态 chrome，并支持 `prefers-reduced-motion` 静态退化。root 内存在精确 `running` 执行节点且无 attention 时，左上角 root 标签 title 所在的小框区域可在 root title 文字下方显示一个 Codex Working 风格的 `|` 形竖向色块；色块使用 root 标签当前 border color 派生色，宽度为 16px、透明度为 0.82，并在 root title 所在的小框区域内左右往返运动，不使用 running 状态色、Agent 节点色、渐变、外发光或强 halo，不覆盖 root title 文字或原始底部分隔线，运动范围必须裁切在 root title 所在的小框区域内，不用于 `rootGroups`，也不由 `launching` / `live` / `starting` / `resuming` / `reattaching` 触发，reduced motion 下关闭色块动画层；thumbnail 模式 active root 占位卡片左上角 root 标签也复用同一套 attention 闪烁与 running 竖向色块规则，只是不挂载第二份真实画板。模式切换入口不在右上角，而是放入可交互画板左下角的画板控制按钮区域：全览模式下入口使用 `eye` 图标，点击后把当前 root 作为 thumbnail 模式主画板，并进入上次选择的 `topThumbnails` 或 `sideThumbnails`，首次默认 `sideThumbnails`；thumbnail 模式下入口使用 `globe` 图标，点击后返回上次选择的 `dynamic` 或 `grid`，首次默认 `dynamic`。无论当前处于全览还是 thumbnail，hover 都向右展开四个具体模式选项；动态、宫格、顶部缩略图与右侧缩略图选项分别使用 `layout`、`table`、`split-vertical` 和 `split-horizontal` 图标，并且菜单样式对齐左下角画板控制按钮。

## 非目标

- 不实现 root 切换器或独立 workspace 管理器。
- 不把多根窗格画廊做成多人实时协作、视频会议或远程共享白板。参考图只用于说明 gallery / thumbnails 的空间组织方式。
- 不实现多根专属的独立画布分支。
- 不实现跨 root Note、跨 root 连线或跨 root 模板捕获。
- 不把包含多个 root 的 multi-root overlay 普通分组写入任一单根 root-local 状态。
- 不支持把 multi-root 组合视图整体保存为模板。
- 不支持把 multi-root 组合视图整体重置为模板；当前重置语义始终收敛到单个目标 root。
- 不承诺同一个 Host 内多个 display node 同时呈现同一个 runtime；当前绑定仍是一条 runtime key 对应一个 display node，未来如需支持需升级为 subscribers/list。
- 不把 display node id 当成 runtime session 身份；multi-root namespaced id 不能直接替代 root-local runtime metadata。
- 不把窗格内 viewport、active root 或缩略图顺序写入 root-local state；它们只属于多根展示层的局部 UI。
- 不在拖拽时自动把执行节点迁移到另一个 root 或改写 cwd。

## 验收标准

- 在单根 `frontend` workspace 中创建一个 Note，关闭后打开包含 `frontend` 与 `backend` 的 multi-root workspace，能在 `frontend` root 分组中看到该 Note。
- `devSessionCanvas.canvas.multiRootPresentationMode` 默认为 `rootGroups`；切到 `paneGallery` 后，多根 workspace 不改变 root-local 内容，只改变多根呈现方式。
- 在 `rootGroups` 中，每个 workspace folder 都显示一个系统 root 分组，标题对应 folder 名称。
- 在 `paneGallery` 的 `dynamic` / `grid` 布局中，每个 workspace folder 都显示为一个独立且可交互的 root 窗格；窗格左上角轻量标签显示 folder 名称，tooltip 保留完整路径，不常驻 nodes / waiting / attention 汇总 subtitle，并可在该 root 内创建、移动、输入和拖入内容；root 标签 title 区域常态不使用 running / attention 静态状态色；存在待确认 attention 且增强提醒模式包含标题栏闪烁时才同步闪烁，闪烁取色使用 root 标签当前 border color，并通过更高占比背景混色、内外描边和轻量 halo 强化峰值，reduced motion 下改为同色系静态高亮；存在精确 `running` 执行节点且无 attention 时才显示 root 标签 title 所在的小框区域 Codex Working 风格 `|` 形竖向色块，色块使用 root 标签 border color 派生色，在 root title 文字下方并裁切在 root title 所在的小框区域内左右往返运动，`launching`、`live`、`starting`、`resuming`、`reattaching` 不触发。
- `paneGallery` 的 `dynamic` / `grid` root pane 默认 fit 当前 root 子图，且不额外限制缩放比例；root 内容过大时，用户可以在 pane 内 pan/zoom 查看。
- 当 workspace root 数量超过同屏可交互容量时，`paneGallery` 使用可滚动/虚拟化 gallery 或等价机制保留 pane 最小可交互尺寸，并通过稳定排序、缩略图模式或后续快速跳转访问所有 root；本轮不提供 filter roots。
- 在 `paneGallery` 的 `topThumbnails` / `sideThumbnails` 布局中，一个 active root 以主画板展示；主画板右下角显示与单一画板一致的 MiniMap；rail 按 VSCode workspace folder 顺序保留所有 root 槽位，active root 在原槽位显示等尺寸轻微斜纹占位卡片，文案为“正在主画板”，不显示 status dot，但占位卡片左上角 root 标签继续显示 attention 闪烁与 running 竖向色块动画，状态摘要仍通过 `title` / `aria-label` 暴露；其他 root 以不可交互的画板缩略图保留在顶部或右侧 rail，缩略图复用左上角轻量 root 标签而不使用外部卡片标题；rail 未溢出时保持居中，溢出时从第一张 root 槽位开始滚动且滚动终点可访问最后一张 root 槽位；单击不切换 active root，双击非 active root 缩略图才切换 active root。`dynamic` / `grid` 的多 root 子画板不显示 MiniMap。
- 在 multi-root workspace 中，系统 root 分组的 body 区域以固定密度平铺对应 folder 名称的低透明签名式水印；普通用户分组不显示自己的水印，也不会用分组背景遮掉所在 root 的水印；稳定节点仍覆盖水印。水印基础字号使用 root 分组标题的基准字号，但在 title tab 因 root 分组宽度过窄而被压缩或截断时，水印仍按当前 zoom 独立反向缩放；path-like 长标题在水印里收敛成 root 名称，普通长 root 展示名最多允许两行，不拦截 root body 选择、聚焦或右键创建。
- `devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 默认为 `true`；设为 `false` 后，系统 root 分组不再渲染 body 水印，但保留 root 分组标题和完整路径 tooltip。
- 在 multi-root workspace 中移动某个 root 分组后重新加载，多根布局保持；单独打开该 root 时，节点仍保持 root-local 相对位置。
- 在 multi-root workspace 中把某个 root 内 Note 拖到 root 边界外后，root 分组自动扩张；单独打开该 root 可以看到 Note 的 root-local 位置变化。
- 在 multi-root workspace 中两个同父 root 分组不会重叠；选中多个同父 root 分组创建普通分组后，外层分组可以包含这些 root。
- 在 multi-root workspace 的某个 root 分组、`paneGallery` 的 `dynamic` / `grid` root pane 或 thumbnail 模式 active root 主画板内创建 Note / Agent / Terminal / 模板内容 / 关联 Markdown Note 后，单独打开该 root 可以看到对应对象。
- 在 multi-root workspace 的某个 root 分组、`paneGallery` 的 `dynamic` / `grid` root pane 或 thumbnail 模式 active root 主画板内执行"重置为模板"后，只清空并替换该 root 的 root-local 画布；其他 root 的节点、分组和执行会话保持不变。
- 在 `rootGroups` 中，从所有 root section 外部触发"重置为模板"时，Webview 展示提示并且不发送 reset 请求；在 root section body 内触发时，请求携带该 workspace-root group id；在 root 内部用户分组触发时，请求可携带该用户分组 id，但 Host 必须解析到所属 root 并只重置该 root。
- 在 `paneGallery` 中，从可交互 root pane 或 active root 主画板触发"重置为模板"时，请求携带该 pane 对应的 workspace-root group id；缩略图仍不发送 reset 请求。
- 两个 root 中都存在 `note-1` 或 `agent-1` 时，多根组合视图和 `paneGallery` 都不会发生节点 ID 冲突。
- 在 multi-root workspace 中，跨 root 画线或把既有连线重连到另一个 root 的节点不会创建或更新连线。
- 两个 root 都有文件活动时，自动 `file` / `file-list` 节点和 file-activity edge 均保留在各自 root 分组内，按各自 root 内 owner Agent 最近公共父分组归属，且 ID 不冲突；当前版本不把跨 root owner 合并成同一个自动文件 artifact。
- 在 multi-root workspace 中运行 Agent 产生新的文件活动时，新写入的 `fileReferences.id` 带所属 root namespace；删除该自动文件节点后的 suppression 在重载后仍生效。
- 一个 root-local live runtime 节点在 multi-root 重启后按原 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 重新附着，离线期间输出可见。
- 同一个 root 被多个 VS Code slot 打开时，runtime 仍按完整 `runtimeStoragePath` 区分；没有 `runtimeStoragePath` 的旧 live-runtime root-local snapshot 不会被同 root 当前 slot 隐式接管。
- 单根窗口与 multi-root 窗口同时打开同一 root-local live runtime 时，output 在两个窗口可见；input、stop、delete 作用于同一 backend session；resize 第一版按 last-writer-wins 处理。
- 旧 snapshot 缺少 `runtimeStoragePath` 时，不会隐式 attach 到当前 multi-root workspace storage；系统必须迁移或明确降级为历史恢复。
- 在 multi-root workspace 中，空 root 分组没有节点时也会被全局 fit view 纳入；右下角 MiniMap 能看出多个 root 分组的相对布局。
- 在 multi-root workspace 中添加第三个 folder 后，新 root 分组不使用远离当前视口的默认 index 网格位置，而是落在当前可见中心附近的最近可用空位，且不与已有 root 分组重叠；重载后该位置保持。
- 在 `节点` sidebar section 添加 folder、创建 worktree 或添加已有 worktree 并加入 workspace 后，新 root 分组与 VS Code 原生 Add Folder 一样进入 multi-root composed view，并按新增 root 聚焦规则移入视野。
- 在 `节点` sidebar section 的 workspace folder 分组行点击移除 folder 后，用户通过 VS Code 原生 modal 选择保留画板或先清空画板再移除；确认后该 folder 从当前 workspace 和 composed view 中消失，对应磁盘目录不被删除，后续仍可重新添加。
- 在 `节点` sidebar section 的 workspace folder 分组行点击移除 worktree 后，如果该 folder 是 linked git worktree，用户通过 VS Code 原生 modal 选择移除成功后清空画板或保留画板；确认后先执行 `git worktree remove`，Git 成功后该 worktree 目录被删除，并按选择清空画板或保留快照，该 folder 也从当前 workspace 和 composed view 中消失；如果该 folder 不是 git repository、不是 linked worktree 或 Git 拒绝移除，用户会看到说明具体原因的弹窗，画板保持不变。
- 在 `节点` sidebar section 的 workspace folder 分组行中，普通 folder、git repository 和 linked git worktree 分别使用不同前置图标；行尾按钮按新建 worktree、移除 worktree、移除 folder 的顺序出现。
- 在 multi-root workspace 中通过全局 worktree 入口时，宿主先按 git common dir 合并同一 repository 的 workspace folders；只存在一个 repository 时直接进入 worktree QuickPick，存在多个不同 repository 时才让用户选择基准 repository；通过 workspace folder 分组行进入 worktree 流程时，基准 folder 固定为该行对应 folder；两条路径随后都展示同一套 worktree QuickPick，并允许添加已有 worktree、从 `HEAD`、本地分支或二级 base ref 创建。
- 添加 folder 后当前画布通过短暂缩放平移动画移动到新增 root 分组，新增 root 分组可见并被选中。
- 连续添加 folder 且用户不手动平移时，第二个新增 root 的落点应锚定在上一次程序化聚焦后的可见中心附近，而不是聚焦前的旧视口中心。
- 如果添加 folder 后 Panel Webview 发生同 generation frame refresh，新增 root 分组的聚焦请求仍会在当前 frame 上 replay 并完成动画。
- 创建 `Agent` / `Terminal` 时，节点 `metadata.cwd` 等于目标 root 路径或显式 Explorer cwd。
- 在 `paneGallery` 的 `dynamic` / `grid` root pane 中交互只写入对应 root-local state；在 thumbnail 模式非 active root 缩略图中允许只读预加载与 execution snapshot 同步；单击 root 不切换 active root，双击非 active root 缩略图只切换 active root，active root 占位不响应单击 / 双击切换，不会发送由缩略图或占位内用户交互触发的 create / drag / edit / terminal input / start / stop / drop 等消息，也不会因缩略图内用户交互写入 root-local state。

## 验证状态

截至 2026-06-13，本规格已完成主路径自动化验证：`npm run test:canvas-multi-root-composition`、`npm run test:canvas-node-groups`、`npm run test:canvas-execution-context`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates`、`npm run test:note-markdown-file-association`、`npm run test:extension-storage-paths`、`npm run typecheck`、`npm run build`、`git diff --check` 和针对 workspace root / cross-root edge 的 Playwright 用例均通过。Add Folder root placement 本轮新增 composition 回归覆盖新增 root 以当前可见中心就近避让、写入 overlay；新增 Webview 回归覆盖 `host/focusGroup` 通过缩放平移动画聚焦 workspace root 分组；root body 平铺签名水印新增 Playwright 回归覆盖 workspace-root 专属渲染、root title 展示、重复铺排、横向样式、常规字号与 root title 同步缩放、title tab 被宽度压缩时水印独立缩放、path-like 长标题简化和普通长标题换行、低透明和疏密度不可交互、配置关闭、body 点击穿透、普通分组背景不遮挡以及节点层仍覆盖水印。review follow-up 追加覆盖 Host 侧多根文件活动自动 artifact 命名空间、live 文件活动 root-namespaced reference、suppression 剪枝，以及旧 multi-root skip 不覆盖 root-local live runtime 重连信号。2026-06-06 已实现 live runtime 验收口径修订：multi-root 按 root-local runtime metadata 共享恢复，不再整体 skip；自动化已覆盖取消 multi-root block、runtime binding key 包含 backend/storage/session/kind、缺失 `runtimeStoragePath` 的显式降级、supervisor output/state 多播与 delete 终态广播。2026-06-07 补充同 root 多 VS Code slot 验证：`node scripts/smoke/run-vscode-storage-slot-smoke.mjs` 已通过，覆盖 root-local snapshot 优先、旧 sibling slot 恢复、root-local live runtime 缺少 `runtimeStoragePath` 时不会被当前同 root slot 隐式接管；`single-to-multi-root-real-reopen` 真实 smoke 在最新 attach kind guard 与降级逻辑后复跑通过，并校验 setup 与 verify 阶段的 workspaceStorage slot name 一致。真实 VSCode smoke 已新增并通过 `multi-root-real-reopen`、`single-to-multi-root-real-reopen` 与 `two-window-shared-runtime`，覆盖 multi-root 窗口重启恢复、单根创建后 multi-root 重启恢复、离线输出可见、重连后输入继续作用同一 session、使用 root-local `runtimeStoragePath` 而不是当前 multi-root workspace storage，以及两个独立 VS Code 窗口同时 attach 同一 Agent/Terminal runtime 的双向 output 多播、双向 input、Terminal resize last-writer-wins、第二窗口 stop Terminal 和 delete Agent 后第一窗口收到非 live 终态。root 分组参与全局 fit view 与 MiniMap 的导航增强已在 `docs/exec-plans/completed/canvas-spatial-fit-minimap.md` 中完成并记录定向验证。2026-06-25 sidebar worktree 流程新增添加已有 worktree 到 workspace 分支，并修复同一 git repository 的多个 workspace folders / linked worktrees 被重复当作多个 repository 的选择问题，已补 `npm run test:git-worktrees` 覆盖 `git worktree list --porcelain` 解析、repository 去重、添加已有分支入口和不执行 `git worktree add` 的路径，并复跑 `npm run typecheck`、`npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-codicon-bundle` 与 `git diff --check`。2026-06-16 sidebar workspace folder 操作已补 `npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-codicon-bundle`、`npm run test:sidebar-list-colors`、`npm run typecheck`、`npm run build` 与 `git diff --check`，覆盖 title action、workspace folder 分组 action、worktree 专用 Codicon、VS Code 风格 QuickPick ref 选择、workspace folder 前置 kind 图标与行尾操作顺序；真实 VS Code 中的 folder picker、`git worktree add`、添加已有 worktree、workspace folder 移除、worktree 移除和新增 root 聚焦仍需人工验证。全量 Webview Playwright 仍有与本功能无直接关系或 lifecycle 断言口径相关的失败，需要后续按 Webview lifecycle / 截图基线测试口径单独收口。

2026-06-15 补充：`paneGallery` 是本轮新增设计目标；当日先完成规格与设计文档收口，并明确配置、Webview 多窗格和自动化回归为实现前置条件。

2026-06-16 补充：`paneGallery` 的 `tiled` root pane 也属于可交互画布窗格，而不是只读预览。本轮第一版已实现 `devSessionCanvas.canvas.multiRootPresentationMode` 配置声明、`CanvasRuntimeContext` 透传、Webview `tiled` / `focus` 多窗格渲染、每 root 独立 viewport、搜索过滤、滚动 gallery、平铺窗格创建目标 root、focus 缩略窗格切换和 Markdown drop 目标 root；manifest、protocol 与 pane gallery Playwright 定向回归已补充。当前仍保持验证中：真实 VSCode 宿主下 terminal input、复杂跨 pane 拖拽和大量 root 虚拟化性能尚未完成端到端验证，第一版 many-roots 策略采用滚动 gallery + 搜索而非真实虚拟化。

2026-06-17 补充：根据新的交互反馈，`paneGallery` 运行时布局改为 `dynamic` / `grid` / `topThumbnails` / `sideThumbnails`，移除整条顶部 toolbar 与 filter roots，但保留右上角使用提示；动态/宫格和缩略图 fit view 都不额外限制缩放比例，缩略图必须双击才切换 active root。第二轮进一步取消右上角模式按钮，把模式入口收敛到左下角画板控制区；缩略图改为不可交互的真实画板而非 MiniMap/SVG 预览；paneGallery 不再渲染 workspace-root 分组框/水印，root 标签改为轻量左上角标签且删除 nodes / waiting / attention subtitle；动态布局改为不同尺寸窗格铺满区域。第三轮明确左下角入口在全览态使用 `eye`、thumbnail 态使用 `globe`，点击按钮执行全览/thumbnail 粗切换，hover 始终展示四个具体模式，动态/宫格/顶部缩略图/右侧缩略图选项分别使用 `layout` / `table` / `split-vertical` / `split-horizontal`，且菜单样式对齐画板控制按钮。第四轮补充粗切换记忆：全览转 thumbnail 使用上次的顶部/右侧缩略图，thumbnail 返回全览使用上次的动态/宫格，默认分别为右侧缩略图和动态；thumbnail 主画板右下角显示 MiniMap，动态/宫格子画板不显示 MiniMap。本轮已补定向 Playwright 回归覆盖无 toolbar/filter、左下角模式入口、粗切换记忆、thumbnail 主画板 MiniMap、动态/宫格不显示 MiniMap、画板化缩略图、缩略图单击无副作用、缩略图双击切换、per-pane overview、many-roots 滚动、动态布局非等尺寸和 Markdown drop 目标 root；2026-06-18 追加覆盖 many-roots 下顶部/右侧 thumbnail rail 溢出时第一张与最后一张缩略图均可滚动访问。仍保留验证中口径，因为真实 VSCode 宿主下 terminal input、复杂跨 pane 拖拽和大量 root 可见区虚拟化性能尚未端到端验证。

2026-07-03 补充：paneGallery root 标签常态取消 running / attention 静态状态染色后，attention 只保留标题栏闪烁动画；running 聚合提示迁移为 root 标签 title 所在的小框区域 Codex Working 风格 `|` 形竖向色块。色块只在 root 内存在精确 `running` 执行节点且无 attention 时显示在 root title 文字下方，颜色使用 root 标签 border color 派生色，宽度为 16px、透明度为 0.82，在 root title 所在的小框区域内左右往返运动，不使用渐变、外发光或强 halo，运动范围裁切在 root title 所在的小框区域内，`launching` / `live` / `starting` / `resuming` / `reattaching` 不触发，`rootGroups` 模式不渲染对应 paneGallery 属性，reduced motion 下关闭色块动画层并保留原始底部分隔线。

2026-07-02 补充：thumbnail 模式不再把 active root 从 rail 中移除；active root 在原 workspace 顺序槽位保留等尺寸轻微斜纹占位卡片，文案为“正在主画板”，不显示 status dot，attention / running 摘要写入 `title` / `aria-label`，且左上角 root 标签继续复用 paneGallery root 标签的 attention 闪烁与 running 竖向色块动画。该占位不是画板缩略图，不挂载第二份真实 `ReactFlow`，也不响应单击 / 双击切换或任何画板写操作。
