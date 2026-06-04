# 重新实现多根 workspace 组合画布

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。计划文件位于 `docs/exec-plans/active/canvas-multi-root-composed-canvas-rewrite.md`，必须保持自包含，并在实现、验证和关键决策变化时持续更新。

## 目标与全局图景

这次变更要让 Dev Session Canvas 在 VSCode multi-root workspace 中显示所有当前 workspace folder 的画布内容，而不是把 multi-root 当成一份与单根互不相通的新画布。用户单独打开 `frontend` 时只看到 `frontend` 的画布；打开包含 `frontend` 和 `backend` 的 `.code-workspace` 时，可以同时看到两个 root section；在 multi-root 中移动某个 root 内的 Note 后，单独打开该 root 仍能看到移动结果。重实现的重点不是推翻产品方向，而是把状态组合、存储、root 归属和创建目标从 `CanvasPanelManager` 中收敛成更清晰的状态域，减少后续维护风险。

## 进度

- [x] (2026-06-04 00:00 +0800) 从最新 `origin/main` 切出 `feature/multi-root-composed-canvas-rewrite`，保留工作区未跟踪图片文件不动。
- [x] (2026-06-04 00:15 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md` 和现有 main 基线代码，确认当前 main 没有 multi-root root-local 组合实现。
- [x] (2026-06-04 00:35 +0800) 创建本 ExecPlan，并补齐多根 workspace 组合视图的产品规格和设计文档索引。
- [x] (2026-06-04 01:05 +0800) 实现共享状态域模块：root identity、root-local/composed/overlay 类型、compose/decompose/sanitize 纯函数，并补充 root-local 子图替换 helper。
- [x] (2026-06-04 01:20 +0800) 接入宿主存储：单根读写 root-local 镜像，多根读取所有 root-local 并写回各 root-local 与 multi-root overlay。
- [x] (2026-06-04 01:35 +0800) 接入创建目标解析：命令、右键、模板、Markdown 拖入和 Explorer cwd 创建能定位目标 root。
- [x] (2026-06-04 01:50 +0800) 接入 root section 分组策略与 Webview 呈现：系统 root section 只读、不可删除/取消分组/重命名，但能移动、resize、被外层分组包含。
- [x] (2026-06-04 02:10 +0800) 补充并运行自动化验证：composition、group policy、protocol、execution context、template、Markdown drop、typecheck、build。
- [x] (2026-06-04 03:45 +0800) 处理 PR review blocker：Webview 与 Host 双侧拒绝跨 root create/reconnect edge，并补充 group helper 与 Playwright 回归测试。
- [x] (2026-06-04 22:44 +0800) 处理 review follow-up：补齐多根文件活动自动 artifact 的 root 命名空间重建、suppression 剪枝和 workspace folder 变化后的 live runtime 恢复口径。
- [x] (2026-06-05 01:00 +0800) 处理最新 review blocker：live 文件活动按 owner root namespace 写入 file reference，旧 unnamespaced reference 按 root scope 迁移，并保护 multi-root runtime skip 不覆盖 root-local 重连信号。

## 意外与发现

- 观察：`origin/main` 已经支持普通分组、分组内创建、模板应用到目标分组、Markdown 拖入和 Explorer cwd 创建执行节点，但 `CanvasGroupSummary` 还没有系统角色，`loadState()` / `persistState()` 仍只维护当前 workspace 的单份 state。
  证据：`src/common/protocol.ts` 中 `CanvasGroupSummary` 只有 `id/title/position/size/parentGroupId`；`src/panel/CanvasPanelManager.ts` 的 `loadState()` 读取 `snapshot?.state ?? workspaceState`，`persistState()` 只写当前 `canvas-state.json`。

- 观察：全量 `npm run test:webview` 当前失败 29 项，其中新增的 2 个 workspace root group Playwright 用例通过；失败主要来自现有截图/环境敏感断言，以及 Webview lifecycle identity 被加入消息后部分旧用例仍使用整对象相等断言。
  证据：`npm run test:webview` 结果为 224 passed / 29 failed；失败包含 `canvas-shell-baseline.png` 视觉差异、`minimal file nodes keep a content-fitting minimum size`、`agent subtitle shows cwd label...` 和多项 Note Markdown 消息整对象断言多出 `lifecycle` 字段。

- 观察：PR review 发现跨 root 连线可以在当前会话内创建，但拆分持久化时不会写入任一 root-local state，也不属于 overlay，重载后会消失。
  证据：`docs/product-specs/canvas-multi-root-workspace-support.md` 明确非目标包含“不实现跨 root 连线”；修复前 `webview/createEdge` 直接进入 `createUserCanvasEdge`，Webview `handleConnect` / `handleEdgeReconnect` 未校验端点所属 root。

- 观察：多根 composed state 在 `reconcileCanvasFileArtifacts()` 中重建文件活动自动节点时，原先沿用单画布 `file-*`、`file-list-*` ID，会让不同 root 的自动 artifact 有冲突风险，且替换 root-local 子图时仅按已有节点归属删除，可能漏删由 fileReferences 派生出的旧自动 artifact。
  证据：review inline 指出 `composeRootLocalCanvasStateIntoComposed()` 的 `currentRootNodeIds` 只来自当前节点归属；`buildFileNodeId()` / `buildAgentFileListNodeId()` / `file-list-shared` 原实现没有解析 root 命名空间。

- 观察：workspace folder 变化后已重新 `loadReconciledState()` 并发布 UI，但需要明确 live runtime restore 的 multi-root 行为。
  证据：`vscode.workspace.onDidChangeWorkspaceFolders()` 已重新加载状态；`scheduleRestoreLiveRuntimeSessions()` 原先没有单独记录 multi-root skip 口径。

- 观察：live 文件活动入口即使在多根组合视图中收到 namespaced owner node id，也仍用裸文件路径 hash 写入 unnamespaced `fileReferences.id`，会让自动 file 节点和 suppression id 退回 `file-*` 形式。
  证据：最新 review 指出 `recordAgentFileActivity()` 只调用 `buildFileReferenceId(normalizedPath)`；新增 `scripts/test/test-canvas-node-groups.mjs` 回归在修复后覆盖 namespaced owner 产生 `${root}:<hash>` reference，并重建 `${root}:file-<hash>`。

- 观察：multi-root restore skip 如果直接把 composed state 拆回 root-local snapshot，会把原本可重连的 root-local `live-runtime` metadata 持久化降级为 `history-restored`，单根重开时无法再走 reattach 主路径。
  证据：review inline 指出 `reconcileRuntimeNodes(... allowLiveRuntimeReconnect:false ...)` 后立即 `persistState()` 的风险；新增 `scripts/test/test-canvas-execution-context.mjs` 覆盖 previous root-local Agent `liveSession:true` 和 Terminal `attachmentState:'reattaching'` 在多根 skip 持久化后仍保留重连字段。

## 决策记录

- 决策：继续采用 root-local state + multi-root composed view + multi-root overlay 三层模型。
  理由：这能直接满足“单根是局部视图，多根是组合视图”的用户心智；相比 multi-root fork 或独立画布，它能让用户在单根和多根之间看到同一 root 的同一批对象。
  日期/作者：2026-06-04 / Codex

- 决策：本次重实现把组合与拆分逻辑放在 `src/common/canvasMultiRootComposition.ts`，把 VSCode 读写仍接在 `CanvasPanelManager`，但通过独立 helper 暴露 root identity、overlay 和归属转换。
  理由：`src/common/` 不能依赖 VSCode API，适合承载可测试的纯数据规则；`CanvasPanelManager` 仍是宿主权威状态入口，第一轮不拆完整仓储类以避免一次性重构过大，但所有可纯化的规则必须从 Manager 移出。
  日期/作者：2026-06-04 / Codex

- 决策：新增 `composeRootLocalCanvasStateIntoComposed` 与 `decomposeComposedCanvasStateForWorkspaceRoot`，让 root-local 子图替换、创建回填和坐标转换也通过 common 纯函数完成。
  理由：只抽 compose/decompose 批量路径不足以降低维护风险，创建节点、模板和 Markdown 拖入同样需要稳定的 root-local/composed 边界；把这些转换从 `CanvasPanelManager` 收敛到 common 后，宿主只负责 VSCode API、交互选择和持久化编排。
  日期/作者：2026-06-04 / Codex

- 决策：系统 root section 复用 `CanvasGroupSummary`，新增 `role: 'workspace-root'` 和 `workspaceRootPath`，但破坏性操作由宿主拒绝。
  理由：复用已有分组框可以保留用户熟悉的视觉和几何行为；显式 role 可以让删除、取消分组、重命名、overlay 拆分与 root-local 拆分有稳定判定依据。
  日期/作者：2026-06-04 / Codex

- 决策：跨 root 连线按非目标处理，Webview 在连接和重连时提前拒绝，Host 在 create/update edge 时再次校验；不把跨 root edge 扩展进 overlay。
  理由：当前 overlay 只承载 root section 布局和 workspace-level 分组，不承载内容边；允许跨 root edge 会产生“会话内可见、重载丢失”的不可追踪状态。双侧校验既避免无效交互消息，也保证 Host 对异常消息保持权威拒绝。
  日期/作者：2026-06-04 / Codex

- 决策：文件活动自动 artifact 在 composed state 中使用 root 命名空间 ID，例如 `workspace-root-*:file-*`、`workspace-root-*:file-list-*` 和 `workspace-root-*:agent::file-*`，并作为对应 root section 的成员重建；suppression id 也按命名空间剪枝。
  理由：文件活动来自 root-local fileReferences，属于 root 内内容而不是 overlay；复用 root 命名空间可以防止不同 root 的自动 file/list 节点、file-activity edge 和 suppression id 冲突，并使拆分回 root-local 时可以去掉命名空间。
  日期/作者：2026-06-04 / Codex

- 决策：multi-root 组合视图中不重新连接 live runtime，只展示历史结果并记录 skip；用户需要恢复 live runtime 时单独打开所属 root。
  理由：live runtime session 的恢复和 runtime storage 仍以 root-local 节点 ID 为稳定锚点；multi-root composed id 会被命名空间化，本 PR 不扩展 runtime 映射层，先把该行为显式为非目标并避免误连。
  日期/作者：2026-06-04 / Codex

- 决策：live 文件活动在记录阶段就按 owner node 的 workspace-root namespace 生成 `fileReferences.id`；旧 unnamespaced reference 只迁移同一 namespace owner，重建 artifact 时也对当前 root scope 的 unnamespaced reference 补 namespace。
  理由：文件活动的长期事实源是 `fileReferences`，必须和自动节点、file-activity edge、suppression id 使用同一 root 命名空间；只在自动 artifact 层补救不足以保证删除 suppression 能拆回 root-local。
  日期/作者：2026-06-05 / Codex

- 决策：multi-root live runtime skip 是 composed view 的展示降级，不写坏 root-local snapshot 的重连资格；持久化 root-local state 时只从上一份 root-local snapshot 恢复必要 runtime reattach 字段，不回滚 `cwd`、provider、shell 等非 runtime metadata。
  理由：用户在 multi-root 中需要看见“当前没有重新连接”的历史态，但单独打开所属 root 时仍应按 root-local id 尝试真实 live runtime reattach；只恢复必要 runtime 字段可以避免把 root-local 其他最新变更误覆盖成旧 metadata。
  日期/作者：2026-06-05 / Codex

## 结果与复盘

本轮重新实现已完成主路径代码接入与目标自动化验证，并已按 PR review 修复跨 root edge 临时可见但不可持久化的问题；review follow-up 已补齐多根文件活动自动 artifact 的命名空间与 suppression 规则，并明确 multi-root live runtime restore 非目标。最新 review blocker 已进一步修复 live 文件活动入口的 unnamespaced reference 问题，以及 multi-root skip 持久化覆盖 root-local reattach 信号的问题。保留风险是尚未在真实 VSCode multi-root workspace 中完成手动 smoke，且全量 Webview Playwright 存在与本功能无直接关系或 lifecycle 断言口径相关的既有失败，需要后续单独收口。

## 上下文与定向

Dev Session Canvas 是 VSCode extension。`src/panel/CanvasPanelManager.ts` 是宿主权威状态中心，负责加载、持久化、创建节点、处理 Webview 消息和启动执行会话。`src/common/protocol.ts` 定义 Host 与 Webview 共享的节点、分组和消息类型。`src/webview/main.tsx` 渲染 React Flow 画布，并把右键创建、拖拽、分组移动和 Markdown 文件拖入等交互发回宿主。

本计划使用几个普通语言术语。`root-local state` 是某一个 workspace folder 自己的 `CanvasPrototypeState`，它只保存这个 root 内的普通节点、用户分组、连线和文件活动。`composed view` 是 multi-root workspace 运行时把多个 root-local state 合成的一张画布，用户在 Webview 里看到的是它。`overlay` 是当前 multi-root workspace 自己的布局层，只保存 root section 的位置、尺寸、父分组关系，以及包含多个 root section 的外层普通分组，不保存 root 内节点内容。`workspace-root group` 是系统 root section，用 `CanvasGroupSummary.role === 'workspace-root'` 标记。

实现涉及以下路径。`src/common/canvasMultiRootComposition.ts` 将新增纯函数和类型，用于 root id、命名空间、组合、拆分、overlay 归一化和 root-local 污染清洗。`src/common/protocol.ts` 将扩展 group role 与消息字段。`src/panel/CanvasPanelManager.ts` 将在 `loadState()` / `persistState()` 两侧调用组合模块，并在创建节点、模板、Markdown 拖入、分组操作中识别 root section。`src/webview/main.tsx` 将把 `targetGroupId` 透传给宿主，并让 root section 标题只读、隐藏删除/取消分组 toolbar。

## 工作计划

第一阶段先写正式文档和纯函数模块。纯函数模块必须不依赖 `vscode`、React 或 DOM，只接收 workspace folder 列表、root-local states 和 overlay，返回 composed state 或拆分结果。它还要提供 root path 归一化、root section id、命名空间与反命名空间函数，保证两个 root 中都存在 `note-1` 时 composed view 不冲突。

第二阶段接入宿主存储。单根 workspace 加载时优先读取 root-local snapshot，如果没有 root-local snapshot，就使用当前 workspace snapshot 并在持久化时镜像到 root-local storage。多根 workspace 加载时读取所有当前 workspace folders 的 root-local snapshot，组合成 composed state。多根持久化时把 composed state 拆回每个 root-local state，并把 overlay 写入当前 multi-root workspace snapshot。旧 workspace storage 不删除，作为兼容输入。

第三阶段接入交互与创建目标。多根中右键 root body、Webview host command、模板应用和 Markdown 拖入都要把目标 group 传回宿主。宿主用 target group 或 cwd 推断目标 root，把 preferred position 转成 root-local 坐标，在 root-local state 中创建对象，再重新命名空间化接回 composed state。执行节点的 `metadata.cwd` 继续是执行目录权威；拖到另一个 root 不静默改写 cwd。

第四阶段补 root section 分组策略。`workspace-root` 不能删除、取消分组或重命名。它对内部是硬容器：root 内节点或用户分组移动到边界外时，root section 扩张而不是释放成员。它对外是整体分组：root section 之间不能重叠，多个 root section 可以被 workspace-level 普通分组包含，这个外层分组只进入 overlay。

## 具体步骤

在仓库根目录执行。每一步都可以重复运行；如果测试失败，先看失败断言，再更新本计划的 `意外与发现` 或 `决策记录`。

    npm run test:canvas-multi-root-composition
    npm run test:canvas-node-groups
    npm run test:canvas-execution-context
    npm run test:protocol-webview-messages
    npm run test:canvas-templates
    npm run test:note-markdown-file-association
    npm run test:extension-storage-paths
    npm run typecheck
    npm run build
    git diff --check

## 验证与验收

自动化验收必须证明：两个 root 的同名节点 ID 在 composed view 中不冲突；移动整个 root section 后拆分不会改写 root-local 节点坐标；在 root section 内新增 Note、Agent、Terminal 或模板节点会写回对应 root-local state；包含多个 root section 的外层普通分组只保存到 overlay；系统 root section 不能被删除、取消分组或重命名；Markdown 文件在 multi-root 中只有拖到目标 root section 内才创建关联 Note；`Agent` / `Terminal` 的默认 cwd 等于目标 root 路径。
Review 修复后的补充验收必须证明：跨 root 创建连线不会发出 Webview createEdge 消息，跨 root 重连不会发出 updateEdge 消息；Host 侧 helper 同样拒绝跨 root create/update edge，防止异常消息直接写入不可持久化边。
Review follow-up 后的补充验收必须证明：多根文件活动自动 `file` / `file-list` 节点与 file-activity edge 使用 root 命名空间生成，不跨 root 冲突；suppression id 在 composed 与 root-local 往返时按命名空间保留或剪枝；multi-root 下 live runtime restore 明确跳过而不是尝试用 composed id 误连；live 文件活动从 namespaced owner 进入时写入 root-namespaced file reference；旧 unnamespaced reference 在 root scope 内迁移后不会让 deletion suppression 重载失效；multi-root skip 不会把 root-local live runtime reattach 信号永久降级成 `history-restored`。

人工验收建议在真实 VSCode 中创建两个临时 folder。先分别单独打开每个 folder 创建 Note，再打开包含二者的 `.code-workspace`，应看到两个 root section。把第一个 root 内 Note 拖到 root 边界外，root section 应扩张；重新单独打开第一个 root，应看到 Note 的 root-local 位置已更新。选中两个 root section 创建外层分组，重载 multi-root 后外层分组仍存在；单独打开任一 root 时不显示这个外层分组。

## 幂等性与恢复

root-local snapshot 写入使用稳定 root path 派生的目录和原子临时文件重命名，可以重复写入。multi-root overlay 丢失时，组合视图按 root 顺序重新铺排，不删除 root-local 内容。旧 workspace snapshot 不会被删除；如果 root-local 写入失败，宿主记录 diagnostic event，并继续保留当前 workspace snapshot。未跟踪的 `image.png` 和 `image copy.png` 是用户工作区文件，本计划不读取、不修改、不删除它们。

## 证据与备注

当前基线检查记录如下：

    git status --short --branch
    ## feature/multi-root-composed-canvas-rewrite...origin/main
    ?? "image copy.png"
    ?? image.png

    rg -n "CanvasGroupSummary|loadState|persistState" src/common/protocol.ts src/panel/CanvasPanelManager.ts
    src/common/protocol.ts:130:export interface CanvasGroupSummary
    src/panel/CanvasPanelManager.ts:3943:  private loadState(): CanvasPrototypeState
    src/panel/CanvasPanelManager.ts:4036:  private persistState(): void

本轮验证记录如下：

    npm run test:canvas-multi-root-composition
    canvas multi-root composition tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run test:canvas-node-groups
    退出码 0

    npm run test:canvas-execution-context
    canvas execution context tests passed

    npm run test:canvas-templates
    退出码 0

    npm run test:note-markdown-file-association
    note markdown file association tests passed

    npm run test:extension-storage-paths
    extensionStoragePaths tests passed

    npm run typecheck
    退出码 0

    npm run build
    退出码 0

    git diff --check
    退出码 0

    npm run test:webview -- --grep "workspace root group"
    2 passed

    npm run test:webview
    224 passed, 29 failed；新增 workspace root group 用例通过，失败详情见“意外与发现”。

Review 修复后新增验证记录如下：

    npm run test:canvas-node-groups
    退出码 0；覆盖 Host 侧跨 root create/update edge 拒绝。

    npm run test:webview -- --grep "workspace root group|cross-root edge"
    3 passed；覆盖 Webview workspace root group 与跨 root edge create/reconnect 拒绝。

Review follow-up 验证记录如下：

    npm run test:canvas-node-groups
    退出码 0；覆盖多根文件活动自动 artifact root 命名空间、file-list-shared 命名空间和 suppression 剪枝。
    npm run test:canvas-multi-root-composition
    退出码 0；覆盖 compose/decompose 中 file-activity suppression 命名空间往返，以及替换 root-local 子图时清理旧 fileReferences 派生的自动 artifact。
    npm run test:canvas-execution-context
    退出码 0；覆盖 workspace folder 变化后重新调度 live runtime restore，并确认 multi-root restore skip 有显式 block reason 与诊断事件。
    npm run typecheck
    退出码 0。
    npm run test:webview -- --grep "workspace root group|cross-root edge"
    3 passed；同时执行 build。
    git diff --check
    退出码 0。

最新 review blocker 修复验证记录如下：

    npm run test:canvas-node-groups
    退出码 0；覆盖 live 文件活动从 namespaced owner 产生 root-namespaced file reference、旧 unnamespaced reference 迁移，以及 namespaced suppression 保留。
    npm run test:canvas-execution-context
    退出码 0；覆盖 multi-root restore skip 持久化时保留 root-local live runtime reattach 信号，且不覆盖 cwd/provider 等非 runtime metadata。
    npm run test:canvas-multi-root-composition
    退出码 0；确认 compose/decompose 既有多根回归仍通过。
    npm run typecheck
    退出码 0。
    npm run test:webview -- --grep "workspace root group|cross-root edge"
    3 passed；同时执行 build。
    git diff --check
    退出码 0。

## 接口与依赖

在 `src/common/protocol.ts` 中扩展：

    export type CanvasGroupRole = 'user' | 'workspace-root';
    export interface CanvasGroupSummary {
      role?: CanvasGroupRole;
      workspaceRootPath?: string;
    }

在 `src/common/canvasMultiRootComposition.ts` 中定义并导出：

    export interface CanvasMultiRootWorkspaceFolder { name: string; path: string; }
    export interface CanvasMultiRootOverlayRoot { rootPath: string; position: CanvasNodePosition; size?: CanvasNodeFootprint; parentGroupId?: string; }
    export interface CanvasMultiRootOverlayGroup { id: string; title: string; position: CanvasNodePosition; size: CanvasNodeFootprint; parentGroupId?: string; }
    export interface CanvasMultiRootOverlay { version: 1; roots: CanvasMultiRootOverlayRoot[]; groups?: CanvasMultiRootOverlayGroup[]; }
    export function createWorkspaceRootSectionId(rootPath: string): string;
    export function namespaceCanvasObjectId(rootPath: string, objectId: string): string;
    export function denamespaceCanvasObjectId(rootPath: string, objectId: string): string | undefined;
    export function composeMultiRootCanvasState(...): CanvasPrototypeState;
    export function decomposeMultiRootCanvasState(...): { rootStates: CanvasRootLocalStateSnapshot[]; overlay: CanvasMultiRootOverlay };

本次更新说明：2026-06-04 创建计划，原因是用户要求从 `origin/main` 重新实现当前分支功能，并要求按仓库工作流先记录复杂功能计划、正式设计和验证口径。2026-06-05 追加 latest review blocker 修复记录，原因是 live 文件活动 reference 命名空间和 multi-root skip 的 root-local reattach 信号保护都属于本功能的正式边界。
