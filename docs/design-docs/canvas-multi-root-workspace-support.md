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
updated_at: 2026-06-08
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
- 多根组合视图中对某个 root 内节点、用户分组和 Note 的编辑写回该 root 的 root-local 状态。
- 执行节点真实执行 root 继续由 `metadata.cwd` 决定，不因拖到另一个 root section 而静默改写。
- 多根组合视图应支持按 root-local runtime metadata 重新附着 `Agent` / `Terminal` live runtime；canvas surface 只负责显示，不拥有后端进程。

## 4. 非目标

不做独立 app 式 workspace 管理、项目启动器或 root 切换器。不把 multi-root workspace 做成完全隔离的第三份画布状态。不在第一版实现跨 root overlay Note、跨 root 连线或跨 root 模板捕获。不允许删除、取消分组或重命名系统 root section。不把跨 root 外层普通分组写入任一 root-local state。不承诺旧版本所有历史单根 VSCode workspaceStorage 都能被后台自动发现。不在同一个 Host 内支持多个 display node 同时呈现同一个 runtime；当前 `runtimeSessionBindings` 仍是一条 runtime key 对应一个 display node，未来如需同 Host 多视图呈现，应升级为 subscribers/list。

## 5. 候选方案

方案 A 是 multi-root 第一次打开时 fork 某份单根状态，之后单根和多根互不影响。它实现简单，但用户在 multi-root 中整理某个 root 后，单独打开该 root 看不到结果。本轮不采用。

方案 B 是 multi-root 维护一张独立共享画布，节点用 `cwd` 标识 root。它接近现有单状态模型，但单根与多根仍是互相看不见的分支。本轮不采用。

方案 C 是 root-local 状态 + multi-root 组合视图 + overlay。每个 root 维护自己的 root-local 状态；单根直接读取它；多根读取所有 root-local 状态并生成系统 root section；root section 布局属于 overlay。本轮采用。

## 6. 正式方案

### 6.1 数据分层

系统分三层状态。`root-local canvas state` 是每个 workspace folder 一份 `CanvasPrototypeState`，保存该 root 的普通节点、用户分组、root 内连线、文件活动摘要和 Note 内容。`multi-root composed view` 是多根 workspace 运行时构造出的内存态，包含所有 root-local state 的命名空间化节点、用户分组，以及每个 root 的系统 root section。`multi-root overlay` 是当前 multi-root workspace 专属布局，保存 root section 的位置、尺寸、父分组关系，以及包含多个 root section 的 workspace-level 普通分组。

主要实现落点是 `src/common/canvasMultiRootComposition.ts`、`src/panel/CanvasPanelManager.ts`、`src/common/protocol.ts` 和 `src/webview/main.tsx`。`src/common/canvasMultiRootComposition.ts` 负责纯数据组合/拆分，不依赖 VSCode API。`CanvasPanelManager` 仍然是宿主权威状态入口，但加载和持久化时调用组合模块，而不是让 Webview 推断 root 归属。

### 6.2 Root-local storage

root-local 状态使用扩展 global storage 按 root 绝对路径稳定分桶保存，避免依赖 VSCode 未公开的“由任意 folder path 反查 workspaceStorage slot”能力。单根 workspace 加载时优先使用 root-local snapshot；如果 root-local 还不存在，则使用当前 workspace snapshot，并在持久化时镜像到 root-local。多根 workspace 只把 root 内状态写回 root-local storage，当前 multi-root workspace storage 只保存组合快照和 overlay。

### 6.3 系统 root section

多根组合视图中，每个 workspace folder 生成一个 `CanvasGroupSummary`，其 `role` 为 `workspace-root`，`workspaceRootPath` 是 root 绝对路径，`id` 使用 root path 的稳定哈希生成。root section 可以移动、resize、参与同级避让，并可以作为整体被 overlay 普通分组包含；它不允许删除、取消分组或重命名。root section 的标题复用普通分组的反向缩放和宽度压缩规则，确保全局 fit view / 低倍率概览时仍能作为工程区域线索；root section 只读且不显示普通分组的取消分组/删除分组按钮。root section 不是执行上下文本身，执行节点 `metadata.cwd` 仍是权威。导航层把 root section 视为一等空间对象：multi-root 下全局 fit view 默认包含所有 root section，MiniMap 也要显示 root section 的相对布局；这只影响可视导航，不改变 root-local / overlay 的状态分层。

### 6.4 组合与拆分规则

组合时，宿主按 root 顺序读取每个 root-local state。节点、用户分组、连线和文件活动 owner node id 都加上 root 命名空间前缀；root-local 顶层用户分组和稳定节点成为 root section 的直接成员；root-local 坐标加上 root section 的内容偏移；root section 的位置、尺寸和父分组来自 overlay，没有 overlay 时按 root 顺序自动铺开。root 内连线只允许连接同一个 root section 内的节点；Webview 与 Host 都拒绝跨 root 创建或重连连线，避免生成无法拆回 root-local、且 overlay 不持久化的临时边。文件活动自动节点和 file-activity edge 使用同一 root 命名空间重建，按 namespace 归属 root 并参与组合、拆分和 root 整体拖动，但不写入 root section 的直接 `groupId`，也不参与 root section 自然尺寸测量，避免 `file-*` / `file-list-*` 自动 artifact 因重建或点击触发 root 边界漂移；root 内连线判断仍把同 namespace 自动文件节点视作同 root 节点。不同 root 的 `file-*`、`file-list-*` 或 suppression id 仍通过 root namespace 避免冲突。

live 文件活动进入宿主时，`recordAgentFileActivity()` 以 owner 节点所在 workspace-root namespace 生成 `fileReferences.id`。如果多根组合视图中仍存在旧的未命名空间化 file reference，重建文件活动 artifact 时也会按当前 root scope 补 namespace，并只迁移或移除属于当前 root 的 owner，避免把另一个 root 的 owner 一起丢掉。这样用户删除自动文件节点后，suppression id 能在 compose/decompose 往返中继续落到同一个 root-local file artifact，而不会在重载后复活。

拆分持久化时，宿主按命名空间把 composed view 拆回各 root-local state。对象 ID 去掉 root 命名空间前缀，坐标减去 root section 内容偏移；root section 位置、尺寸和父分组写入 overlay；包含 root section 的 workspace-level 普通分组写入 overlay，不写入任何 root-local state。

### 6.5 创建与拖拽语义

单根 workspace 创建行为保持现状。多根 workspace 中，从 root section 内右键创建节点或分组时，新对象归入该 root。命令面板或侧栏创建节点时，如果不能从位置或 cwd 推断 root，宿主让用户选择目标 root。创建 `Agent` / `Terminal` 时，若没有显式 `cwdOverride`，宿主使用目标 root 的路径作为 `metadata.cwd`。拖入 Markdown 文件创建关联 Note 时，只有落点在某个 root section 内才创建。拖动执行节点到其他 root section 不会静默改写 `cwd`。

### 6.6 Multi-root live runtime 恢复语义

`Agent` / `Terminal` 的后端进程由 runtime supervisor 和 provider/shell 持有，canvas 只是 display surface；multi-root、single-root 或两个 VS Code 窗口同时打开时，不应因为显示形态不同而阻止恢复同一个 live runtime。display node id 只服务渲染、选择、连线、布局和 `decomposeMultiRootCanvasState()`；runtime binding id 以 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 为权威。这里的 `runtimeStoragePath` 必须是 VS Code 分配给该窗口/会话的具体 extension storage slot；同一个 root 可能同时存在多个 `workspaceStorage` slot，它们必须被视为不同 runtime，不能退化成只按 root path 绑定。

多根恢复不应再整体以 `multi-root-workspace` block；宿主应按 composed execution node 找回所属 root-local metadata，用其中保存的 `runtimeBackend`、`runtimeStoragePath`、`runtimeSessionId` 和节点类型 attach 原 session。attach、output 和 state event 更新当前窗口里的 display node；持久化时继续依赖现有 decompose 还原成 root-local node id。多窗口控制语义定义为 shared runtime：output 由 supervisor 多播，input、stop 和 delete 作用到同一 backend session，resize 第一版采用 last-writer-wins。

必须避免用当前 multi-root workspace 的 storage path 猜 runtime，也不能用同 root 的当前 slot 回填旧 live-runtime snapshot。对于已有 root-local snapshot，如果 `persistenceMode` 是 `live-runtime` 且存在 `runtimeSessionId`，但缺少 `runtimeStoragePath`，宿主不能把它隐式指到 multi-root workspace storage 或同 root 的当前 storage slot；应通过兼容迁移明确补齐原 root-local runtime storage，或显式降级为历史恢复并记录诊断，避免 attach 到错误 supervisor 或误报找不到 session。当前 `runtimeSessionBindings` 是一条 runtime key 对应一个 display node，这对单根窗口和多根窗口同时 attach 成立，因为两个窗口各有自己的 Host / Manager；若未来同一个 Host 内允许同一 runtime 被多个 display node 同时呈现，应把 binding value 改成 subscribers/list。

## 7. 风险与取舍

root-local global storage 与旧 workspace storage 并存，用户可能有迁移期看不到旧历史；缓解方式是单根打开时自动镜像当前 workspace storage。组合视图中节点 ID 命名空间化会影响 live runtime attach，因此实现必须把 display node id 与 runtime binding id 分离，不能把 namespaced display id 当成后端进程身份。multi-root 恢复的主要风险是错误使用当前 multi-root workspace storage path；同 root 多 VS Code 窗口还会产生多个 `workspaceStorage` slot，修复时必须以 root-local metadata 中的完整 `runtimeStoragePath` 为准，旧 snapshot 缺字段时只能迁移或显式降级。用户把执行节点拖到其他 root section 后可能期待 cwd 改变；第一版不静默改写，以避免错误执行目录。

## 8. 验证方法

新增 root composition 纯函数测试，覆盖 ID 命名空间、root section overlay、组合/拆分、root 内新增对象归属和 overlay 外层分组重组。扩展分组测试，覆盖系统 root section 不可删除/取消分组/重命名、root 内扩边、root-root 避让和 root 被外层分组包含。扩展协议、模板、Markdown 拖入和执行 cwd 测试。导航与 MiniMap 需要追加 Webview Playwright：空 root section 没有节点时仍被全局 fit view 纳入；多个 root section 在 MiniMap 中可见且与普通用户分组可区分。live runtime 恢复需要补 multi-root reload 后 Agent / Terminal 真实 reattach、离线输出可见、单根窗口与 multi-root 窗口同时 attach 同一 session、resize last-writer-wins，以及缺失 `runtimeStoragePath` 的迁移或显式降级回归。最终运行 `npm run typecheck`、`npm run build` 和 `git diff --check`。

## 9. 当前验证状态

截至 2026-06-07，本设计已完成主路径自动化验证：composition、protocol、group policy、execution context、template、Markdown drop、typecheck、build 与针对 workspace root group 的 Playwright 用例均通过。review 修复已追加覆盖 live 文件活动按 owner root namespace 记录 file reference、旧 unnamespaced reference 在 root scope 内迁移、suppression 往返保留，以及旧 multi-root live runtime skip 不覆盖 root-local reattach 信号。root section 参与全局 fit view 与 MiniMap 的导航增强已在 `docs/exec-plans/completed/canvas-spatial-fit-minimap.md` 中完成并记录定向验证。2026-06-06 已把 multi-root live runtime 从“整体跳过”修订并实现为“按 root-local runtime metadata 共享恢复”：Host 不再以 `multi-root-workspace` 整体 block，runtime binding key 纳入 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind`，对缺失 `runtimeStoragePath` 的旧 root-local live-runtime snapshot 显式降级，并让 supervisor delete 先向订阅者广播非 live 终态，避免误连当前 multi-root workspace storage 或让其他窗口停留在假 live。2026-06-07 针对同一个 root 可能存在多个 VS Code `workspaceStorage` slot 的风险补充验证：单根 root-local snapshot 缺少 `runtimeStoragePath` 也降级，不再由当前同 root slot 回填；`test:smoke-storage-slot` 覆盖 root-local snapshot 优先、旧 sibling slot 恢复和缺字段降级；real reopen smoke 记录并校验 Agent / Terminal 重连前后的 slot name 不变。`npm run test:canvas-execution-context`、`npm run test:canvas-multi-root-composition`、`npm run test:runtime-supervisor-protocol`、`npm run test:extension-storage-paths`、`npm run test:canvas-node-groups`、`npm run typecheck`、`npm run build`、`node -c tests/vscode-smoke/real-reopen-tests.cjs`、`node -c tests/vscode-smoke/storage-slot-recovery-tests.cjs`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=single-to-multi-root-real-reopen node scripts/smoke/run-vscode-smoke.mjs`、`node scripts/smoke/run-vscode-storage-slot-smoke.mjs` 和 `git diff --check` 已通过。真实 VSCode smoke 已补充 `multi-root-real-reopen`、`single-to-multi-root-real-reopen` 与 `two-window-shared-runtime` 三条路径，覆盖 multi-root 窗口重启恢复、单根创建后 multi-root 重启恢复、离线输出可见、重连后输入继续作用同一 session、不使用当前 multi-root workspace storage 误连，以及两个独立 VS Code 窗口同时 attach 同一 Agent/Terminal runtime 后的双向 output 多播、双向 input、resize last-writer-wins、stop/delete 共享 session 终态同步。全量 Webview Playwright 仍有与本功能无直接关系或 lifecycle 断言口径相关的失败，需要后续单独收口。
