---
title: 画布多根 workspace 组合视图设计
decision_status: 已选定
validation_status: 已部分验证
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
  - docs/exec-plans/completed/canvas-spatial-fit-minimap.md
  - docs/exec-plans/completed/canvas-add-folder-root-placement.md
  - docs/exec-plans/completed/sidebar-workspace-worktree-actions.md
updated_at: 2026-06-16
---

# 画布多根 workspace 组合视图设计

## 1. 背景

Dev Session Canvas 的核心价值是让用户在 VSCode 内通过同一张空间化画布理解多个 `Agent`、`Terminal` 和 `Note`。VSCode 支持 multi-root workspace；用户在同一个窗口中打开多个工程时，期望看到这些工程各自的画布内容，而不是把 multi-root 视为一个与单根 workspace 完全隔离的新画布分支。

## 2. 问题定义

本设计需要回答：单根 workspace 与多根 workspace 如何共享 root 内容；每个 root 的内容如何在同一张画布上组织；用户在多根组合视图中移动节点、创建节点或移动 root section 后，哪些内容写回 root-local，哪些内容只属于 multi-root 布局；系统 root section 如何区别于普通用户分组；执行节点 `cwd`、ID 冲突、跨 root 拖拽和运行时恢复如何保守处理。

## 3. 目标

- 单根 workspace 只显示当前 root 的 root-local 画布状态。
- 多根 workspace 显示当前所有 workspace folder 对应的 root-local 画布状态。
- 多根组合视图中每个 root 有一个系统级 root section。
- 全局 fit view 与 MiniMap 默认把所有系统 root section 作为一等空间对象纳入，让用户能看到完整组合画布布局。
- root section 对内部是硬容器，对外部是整体分组对象。
- 多根组合视图中的 root section 位置、尺寸和跨 root 外层普通分组保存为 multi-root overlay。
- `Add Folder to Workspace` 新增 root section 时，应优先出现在用户当前可见中心附近的最近可用位置，并通过视口动画进入视野。
- 多根组合视图中对某个 root 内节点、用户分组和 Note 的编辑写回该 root 的 root-local 状态。
- 执行节点真实执行 root 继续由 `metadata.cwd` 决定，不因拖到另一个 root section 而静默改写。
- 多根组合视图应支持按 root-local runtime metadata 重新附着 `Agent` / `Terminal` live runtime；canvas surface 只负责显示，不拥有后端进程。

## 4. 非目标

不做独立 app 式 workspace 管理、项目启动器或 root 切换器。不把 multi-root workspace 做成完全隔离的第三份画布状态。不在第一版实现跨 root overlay Note、跨 root 连线或跨 root 模板捕获。不允许删除、取消分组或重命名系统 root section。不把跨 root 外层普通分组写入任一 root-local state。不承诺旧版本所有历史单根 VSCode workspaceStorage 都能被后台自动发现。不在同一个 Host 内支持多个 display node 同时呈现同一个 runtime；当前 `runtimeSessionBindings` 仍是一条 runtime key 对应一个 display node，未来如需同 Host 多视图呈现，应升级为 subscribers/list。

## 5. 候选方案

方案 A 是 multi-root 第一次打开时 fork 某份单根状态，之后单根和多根互不影响。它实现简单，但用户在 multi-root 中整理某个 root 后，单独打开该 root 看不到结果。本轮不采用。

方案 B 是 multi-root 维护一张独立共享画布，节点用 `cwd` 标识 root。它接近现有单状态模型，但单根与多根仍是互相看不见的分支。本轮不采用。

方案 C 是 root-local 状态 + multi-root 组合视图 + overlay。每个 root 维护自己的 root-local 状态；单根直接读取它；多根读取所有 root-local 状态并生成系统 root section；root section 布局属于 overlay。本轮采用。

新增 root section 的空间落点比较过几类成熟算法。ELK / Graphviz 这类全图布局适合层次图、力导向图或大型图重排，但它们会把已有 root section 一并重算，不符合 overlay 是用户手工整理结果的约束。D3 force collision 一类碰撞约束适合持续模拟节点云，容易带来迭代收敛和抖动问题。矩形 packing / overlap removal 更贴近本需求：新增对象有明确矩形尺寸，已有 root section 是不可移动障碍物，只需要找离当前视口中心最近且不重叠的槽位。因此本轮采用局部确定性矩形候选槽位搜索，不新增布局库依赖。

## 6. 正式方案

### 6.1 数据分层

系统分三层状态。`root-local canvas state` 是每个 workspace folder 一份 `CanvasPrototypeState`，保存该 root 的普通节点、用户分组、root 内连线、文件活动摘要和 Note 内容。`multi-root composed view` 是多根 workspace 运行时构造出的内存态，包含所有 root-local state 的命名空间化节点、用户分组，以及每个 root 的系统 root section。`multi-root overlay` 是当前 multi-root workspace 专属布局，保存 root section 的位置、尺寸、父分组关系，以及包含多个 root section 的 workspace-level 普通分组。

主要实现落点是 `src/common/canvasMultiRootComposition.ts`、`src/panel/CanvasPanelManager.ts`、`src/common/protocol.ts` 和 `src/webview/main.tsx`。`src/common/canvasMultiRootComposition.ts` 负责纯数据组合/拆分，不依赖 VSCode API。`CanvasPanelManager` 仍然是宿主权威状态入口，但加载和持久化时调用组合模块，而不是让 Webview 推断 root 归属。

### 6.2 Root-local storage

root-local 状态使用扩展 global storage 按 root 绝对路径稳定分桶保存，避免依赖 VSCode 未公开的“由任意 folder path 反查 workspaceStorage slot”能力。单根 workspace 加载时优先使用 root-local snapshot；如果 root-local 还不存在，则使用当前 workspace snapshot，并在持久化时镜像到 root-local。多根 workspace 只把 root 内状态写回 root-local storage，当前 multi-root workspace storage 只保存组合快照和 overlay。

### 6.3 系统 root section

多根组合视图中，每个 workspace folder 生成一个 `CanvasGroupSummary`，其 `role` 为 `workspace-root`，`workspaceRootPath` 是 root 绝对路径，`id` 使用 root path 的稳定哈希生成。root section 可以移动、resize、参与同级避让，并可以作为整体被 overlay 普通分组包含；它不允许删除、取消分组或重命名。root section 的标题复用普通分组的反向缩放和宽度压缩规则，确保全局 fit view / 低倍率概览时仍能作为工程区域线索；root section 只读且不显示普通分组的取消分组/删除分组按钮。为降低多根 workspace 下用户在同一画布中迷失 root 的风险，root section 的 body 区域以固定密度平铺同名的签名式水印：文本使用 root section title（即 workspace folder 展示名），完整路径仍只进入标题 tooltip；水印采用横向文本，基础字号与 root section title 的基准字号一致，但水印使用独立的 zoom 反向缩放，不继承 title tab 为适配分组宽度而降级后的 readable scale；当 title 因 root section 过窄被截断时，水印仍继续放大到当前 zoom 对应的可读尺寸。若 title 混入路径片段或形如 `name - /path/to/name`，水印先收敛成可读 root 名称；普通长 root 展示名在 tile 内按断点最多显示两行。水印跟随 VSCode theme token、更低透明度、更疏的 tile 密度、不可交互，并通过 `pointer-events: none` 保证不拦截 body 选择、双击聚焦或右键创建入口；水印层位于 root/普通分组背景之上、React Flow 节点层之下，因此 root 内普通分组不会把水印整块遮掉，但稳定节点仍按对象实体覆盖水印；用户可通过 `devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 关闭，默认开启。root section 不是执行上下文本身，执行节点 `metadata.cwd` 仍是权威。导航层把 root section 视为一等空间对象：multi-root 下全局 fit view 默认包含所有 root section，MiniMap 也要显示 root section 的相对布局；这只影响可视导航，不改变 root-local / overlay 的状态分层。

### 6.4 组合与拆分规则

组合时，宿主按 root 顺序读取每个 root-local state。节点、用户分组、连线和文件活动 owner node id 都加上 root 命名空间前缀；root-local 顶层用户分组和稳定节点成为 root section 的直接成员；root-local 坐标加上 root section 的内容偏移；root section 的位置、尺寸和父分组来自 overlay，没有 overlay 时按 root 顺序自动铺开。`src/common/canvasMultiRootComposition.ts` 的 `ComposeMultiRootCanvasStateOptions.newRootPlacement` 只服务 workspace folder 变化时新增且 overlay 尚无位置的 root：Host 把当前可见中心传入后，组合模块以该中心作为锚点，生成 anchor、已有 root 四周贴边和环形扩张候选，按候选中心到可见中心的距离选择第一个不与已有 root section 扩张阻挡矩形相交的位置，并在下一次 decompose / persist 时写入 multi-root overlay。已有 overlay root section 不因新增 root 重新排布；没有可见中心时仍回退到默认网格。root 内连线只允许连接同一个 root section 内的节点；Webview 与 Host 都拒绝跨 root 创建或重连连线，避免生成无法拆回 root-local、且 overlay 不持久化的临时边。文件活动自动节点和 file-activity edge 使用同一 root 命名空间重建，且 `file` / `file-list` 按 owner Agent 的最近公共父分组推导为 root 内自动成员；没有公共用户分组时直接归属该 root section。当前版本不合并跨 root 的 `file` / `file-list`，避免产生无法拆回 root-local state 的跨 root 自动 artifact，并避免不同 root 的 `file-*`、`file-list-*` 或 suppression id 冲突。

live 文件活动进入宿主时，`recordAgentFileActivity()` 以 owner 节点所在 workspace-root namespace 生成 `fileReferences.id`。如果多根组合视图中仍存在旧的未命名空间化 file reference，重建文件活动 artifact 时也会按当前 root scope 补 namespace，并只迁移或移除属于当前 root 的 owner，避免把另一个 root 的 owner 一起丢掉。这样用户删除自动文件节点后，suppression id 能在 compose/decompose 往返中继续落到同一个 root-local file artifact，而不会在重载后复活。

拆分持久化时，宿主按命名空间把 composed view 拆回各 root-local state。对象 ID 去掉 root 命名空间前缀，坐标减去 root section 内容偏移；root section 位置、尺寸和父分组写入 overlay；包含 root section 的 workspace-level 普通分组写入 overlay，不写入任何 root-local state。

### 6.5 创建与拖拽语义

单根 workspace 创建行为保持现状。多根 workspace 中，从 root section 内右键创建节点或分组时，新对象归入该 root。命令面板或侧栏创建节点时，如果不能从位置或 cwd 推断 root，宿主让用户选择目标 root。创建 `Agent` / `Terminal` 时，若没有显式 `cwdOverride`，宿主使用目标 root 的路径作为 `metadata.cwd`。拖入 Markdown 文件创建关联 Note 时，只有落点在某个 root section 内才创建。拖动执行节点到其他 root section 不会静默改写 `cwd`。`src/sidebar/CanvasSidebarNodeListView.ts` 的 `节点` section 可以通过宿主命令添加 workspace folder、基于某个本地 git root 创建 worktree 并把新目录加入 workspace，或从当前 workspace 移除某个 root；这些操作都只改变 VS Code workspace folder 列表，不直接改写 multi-root overlay，也不删除磁盘目录。全局新建 worktree 在多根 workspace 下必须先选择基准 root；root 分组行的新建 worktree 直接使用该 root。成功添加 folder 或 worktree 后，仍由 `src/panel/CanvasPanelManager.ts` 的 `onDidChangeWorkspaceFolders` 监听器重新组合状态。当 VSCode `onDidChangeWorkspaceFolders` 发现新增 root 后，`src/panel/CanvasPanelManager.ts` 在完成 state reload、persist 和 `host/stateUpdated` 后发送 `host/focusGroup`；`src/webview/main.tsx` 根据该 root section 的 group bounds 调用 React Flow `getViewportForBounds()` 和 `setViewport(..., { duration })`，用缩放平移动画把新增 root section 移入视野并选中该系统分组。程序化 focus 动画结束后，Webview 必须像用户平移/缩放一样继续发送 `webview/updateViewportCenter`，让 Host 的当前可见中心随动画后的 viewport 更新；否则连续 Add Folder 时，后一个 root 会继续锚定到聚焦前的旧视口中心。2026-06-09 的实测诊断显示，`Add Folder to Workspace` 后 Panel Webview 可能在同一个 generation 内刷新 frameId，导致旧 frameId 上的首条 `host/focusGroup` 被新 frame 按 lifecycle mismatch 忽略；因此 Host 会在短窗口内保留 workspace-root focus 意图，并在同 generation frame refresh / bootstrapAck 后用当前 lifecycle 再投递一次聚焦请求。

Sidebar 创建 git worktree 的宿主交互不改变 multi-root 组合模型，但会影响用户如何选择 root。全局入口先选基准 root；root 分组入口直接使用对应 root。选定 root 后，`src/extension.ts` 读取 `HEAD` 与本地分支 refs，展示 VS Code 风格 `Create Worktree (...path...) (1/2)` QuickPick，并支持 `Create new branch...`、`Create new branch from...` 和已有 ref。新建分支执行 `git worktree add -b <branch> <path> [startPoint]`，已有 ref 执行 `git worktree add [--detach] <path> <ref>`；选择 `HEAD` 或已被其他 worktree checkout 的分支时使用 detached HEAD；成功后仍只通过 `workspace.updateWorkspaceFolders(...)` 增加新 root，由既有 `onDidChangeWorkspaceFolders` 路径重新组合并聚焦新增 root section。root 行 worktree action 使用 VS Code `worktree` Codicon，以便和 Source Control 的 worktree 语义保持一致。

### 6.6 Multi-root live runtime 恢复语义

`Agent` / `Terminal` 的后端进程由 runtime supervisor 和 provider/shell 持有，canvas 只是 display surface；multi-root、single-root 或两个 VS Code 窗口同时打开时，不应因为显示形态不同而阻止恢复同一个 live runtime。display node id 只服务渲染、选择、连线、布局和 `decomposeMultiRootCanvasState()`；runtime binding id 以 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 为权威。这里的 `runtimeStoragePath` 必须是 VS Code 分配给该窗口/会话的具体 extension storage slot；同一个 root 可能同时存在多个 `workspaceStorage` slot，它们必须被视为不同 runtime，不能退化成只按 root path 绑定。

多根恢复不应再整体以 `multi-root-workspace` block；宿主应按 composed execution node 找回所属 root-local metadata，用其中保存的 `runtimeBackend`、`runtimeStoragePath`、`runtimeSessionId` 和节点类型 attach 原 session。attach、output 和 state event 更新当前窗口里的 display node；持久化时继续依赖现有 decompose 还原成 root-local node id。多窗口控制语义定义为 shared runtime：output 由 supervisor 多播，input、stop 和 delete 作用到同一 backend session，resize 第一版采用 last-writer-wins。

必须避免用当前 multi-root workspace 的 storage path 猜 runtime，也不能用同 root 的当前 slot 回填旧 live-runtime snapshot。对于已有 root-local snapshot，如果 `persistenceMode` 是 `live-runtime` 且存在 `runtimeSessionId`，但缺少 `runtimeStoragePath`，宿主不能把它隐式指到 multi-root workspace storage 或同 root 的当前 storage slot；应通过兼容迁移明确补齐原 root-local runtime storage，或显式降级为历史恢复并记录诊断，避免 attach 到错误 supervisor 或误报找不到 session。当前 `runtimeSessionBindings` 是一条 runtime key 对应一个 display node，这对单根窗口和多根窗口同时 attach 成立，因为两个窗口各有自己的 Host / Manager；若未来同一个 Host 内允许同一 runtime 被多个 display node 同时呈现，应把 binding value 改成 subscribers/list。

## 7. 风险与取舍

root-local global storage 与旧 workspace storage 并存，用户可能有迁移期看不到旧历史；缓解方式是单根打开时自动镜像当前 workspace storage。组合视图中节点 ID 命名空间化会影响 live runtime attach，因此实现必须把 display node id 与 runtime binding id 分离，不能把 namespaced display id 当成后端进程身份。multi-root 恢复的主要风险是错误使用当前 multi-root workspace storage path；同 root 多 VS Code 窗口还会产生多个 `workspaceStorage` slot，修复时必须以 root-local metadata 中的完整 `runtimeStoragePath` 为准，旧 snapshot 缺字段时只能迁移或显式降级。用户把执行节点拖到其他 root section 后可能期待 cwd 改变；第一版不静默改写，以避免错误执行目录。

## 8. 验证方法

新增 root composition 纯函数测试，覆盖 ID 命名空间、root section overlay、组合/拆分、root 内新增对象归属、overlay 外层分组重组，以及 Add Folder 新增 root 按可见中心就近避让并写回 overlay。扩展分组测试，覆盖系统 root section 不可删除/取消分组/重命名、root 内扩边、root-root 避让和 root 被外层分组包含。扩展协议、模板、Markdown 拖入和执行 cwd 测试。sidebar workspace 操作需要用 manifest 与节点列表 Webview 测试覆盖：`节点` view title 暴露添加 folder / 新建 worktree，workspace-root 分组行只在系统 root 上显示 root 级 worktree / remove 操作，worktree action 使用 `worktree` Codicon，并向 Host 发送 rootPath。worktree ref QuickPick 仍需真实 VS Code 宿主人工验证。导航与 MiniMap 需要追加 Webview Playwright：空 root section 没有节点时仍被全局 fit view 纳入；多个 root section 在 MiniMap 中可见且与普通用户分组可区分；`host/focusGroup` 能用缩放平移动画把新增 root section 居中。live runtime 恢复需要补 multi-root reload 后 Agent / Terminal 真实 reattach、离线输出可见、单根窗口与 multi-root 窗口同时 attach 同一 session、resize last-writer-wins，以及缺失 `runtimeStoragePath` 的迁移或显式降级回归。最终运行 `npm run typecheck`、`npm run build` 和 `git diff --check`。

## 9. 当前验证状态

截至 2026-06-13，本设计已完成主路径自动化验证：composition、protocol、group policy、execution context、template、Markdown drop、typecheck、build 与针对 workspace root group 的 Playwright 用例均通过。Add Folder root placement 本轮新增 `test:canvas-multi-root-composition` 覆盖新增 root 使用当前可见中心就近放置、避让已有 root 并写回 overlay，新增 Playwright 用例覆盖 `host/focusGroup` 通过缩放平移动画把 workspace root section 居中并选中；root body 平铺签名水印补充 Playwright 用例覆盖仅 workspace-root 渲染、展示 root title、重复铺排、横向样式、常规字号与 root title 同步缩放、title tab 被分组宽度压缩时水印独立反向缩放、path-like 长标题简化和普通长标题换行、低透明和疏密度不可交互、配置关闭、不拦截 body 选择、普通分组背景不遮挡以及节点层仍覆盖水印。review 修复已追加覆盖 live 文件活动按 owner root namespace 记录 file reference、旧 unnamespaced reference 在 root scope 内迁移、suppression 往返保留，以及旧 multi-root live runtime skip 不覆盖 root-local reattach 信号。root section 参与全局 fit view 与 MiniMap 的导航增强已在 `docs/exec-plans/completed/canvas-spatial-fit-minimap.md` 中完成并记录定向验证。2026-06-06 已把 multi-root live runtime 从“整体跳过”修订并实现为“按 root-local runtime metadata 共享恢复”：Host 不再以 `multi-root-workspace` 整体 block，runtime binding key 纳入 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind`，对缺失 `runtimeStoragePath` 的旧 root-local live-runtime snapshot 显式降级，并让 supervisor delete 先向订阅者广播非 live 终态，避免误连当前 multi-root workspace storage 或让其他窗口停留在假 live。2026-06-07 针对同一个 root 可能存在多个 VS Code `workspaceStorage` slot 的风险补充验证：单根 root-local snapshot 缺少 `runtimeStoragePath` 也降级，不再由当前同 root slot 回填；`test:smoke-storage-slot` 覆盖 root-local snapshot 优先、旧 sibling slot 恢复和缺字段降级；real reopen smoke 记录并校验 Agent / Terminal 重连前后的 slot name 不变。2026-06-16 sidebar root 操作已补 `npm run test:extension-manifest` 和 `npm run test:sidebar-node-list` 覆盖 title action 与 root 分组 action 消息；同日补充 worktree 专用 Codicon 与 VS Code 风格 QuickPick ref 选择后，已复跑 `npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-codicon-bundle`、`npm run test:sidebar-list-colors`、`npm run typecheck`、`npm run build` 与 `git diff --check`。真实 VS Code 中的 folder picker、`git worktree add`、workspace folder 移除和新增 root 聚焦仍需人工验证。真实 VSCode smoke 已补充 `multi-root-real-reopen`、`single-to-multi-root-real-reopen` 与 `two-window-shared-runtime` 三条路径，覆盖 multi-root 窗口重启恢复、单根创建后 multi-root 重启恢复、离线输出可见、重连后输入继续作用同一 session、不使用当前 multi-root workspace storage 误连，以及两个独立 VS Code 窗口同时 attach 同一 Agent/Terminal runtime 后的双向 output 多播、双向 input、resize last-writer-wins、stop/delete 共享 session 终态同步。全量 Webview Playwright 仍有与本功能无直接关系或 lifecycle 断言口径相关的失败，需要后续单独收口。
