# 实现单根 folder 到多根 workspace 的画布状态 fork

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循 `docs/PLANS.md` 的要求；该文件定义了 ExecPlan 必须自包含、持续维护并导向可验证工作结果。

## 目标与全局图景

这次变更完成后，用户从单根 folder 通过 VSCode 的“添加 folder 到 workspace”变成多根 workspace 时，Dev Session Canvas 会把原单根 folder 的画布状态 fork 到新的多根 workspace storage 中。fork 只发生一次，并且只在当前运行环境能主动给出单根 folder 的 storage slot 时发生；之后单根 folder 和多根 workspace 各自写自己的 `canvas-state.json`，互不影响。用户可以亲眼验证：先在单根 folder 中创建节点，再添加第二个 folder，新的多根 workspace 里能看到原节点；随后在多根画布里新增/删除节点，不会改写原单根 folder 的画布。

## 进度

- [x] (2026-06-01) 先按 `docs/workflows/COMMIT.md` 提交上一阶段多根执行上下文改动，commit 为 `3dcb2f6 feat(canvas): 支持多根 workspace 执行上下文`。
- [x] (2026-06-01) 确认 VSCode API 约束：`ExtensionContext.storageUri` 是当前 workspace 私有目录，`workspace.onDidChangeWorkspaceFolders` 在添加/移除 workspace folder 时触发并带 `added` / `removed` 列表；本轮 fork 不能从后台枚举任意历史 root storage。
- [x] (2026-06-01) 设计并实现当前环境主动记录单根 folder storage slot 的机制：在单根 folder 运行时把 folder path 与当前 `storageUri` 写入 `globalState` 私有索引，multi-root 启动或 folder 变化时只读取该索引。
- [x] (2026-06-01) 在 multi-root 当前 storage 没有可恢复状态且 workspaceState 也为空时，从主动登记的单根 folder slot fork `canvas-state.json`、关联 Markdown 草稿等可恢复状态到当前 multi-root storage。
- [x] (2026-06-01) 保证 fork 后当前 multi-root storage 继续独立写入，后续不再从单根 slot 读取；单根和多根成为不同分支。
- [x] (2026-06-01) 补脚本测试覆盖主动 slot、已有 multi-root snapshot / workspaceState 不覆盖、候选按主动登记时间新鲜度选择或 fail closed，以及源码契约确认不后台猜测历史 storage。
- [x] (2026-06-01) 更新设计文档、产品规格和索引，已记录当前定向验证。
- [x] (2026-06-01) 完成最终验证：`test:extension-storage-paths`、`test:canvas-execution-context`、`typecheck`、`build` 和 `git diff --check` 均通过。

## 意外与发现

- 观察：当前仓库已有 sibling workspaceStorage slot 恢复逻辑，但它只处理同一 canonical workspace id 下的 `<id>` / `<id>-N` 并按快照新鲜度选择 source，不覆盖“单根 folder workspace id”到“多根 workspace id”的迁移。
  证据：`src/common/extensionStoragePaths.ts` 的 `collectExtensionStorageSlotCandidates(...)` 只枚举当前 slot 的同 canonicalName 目录。
- 观察：`CanvasPanelManager` 启动时立刻把当前状态写回当前 storage。
  证据：构造函数中 `this.state = this.loadReconciledState()` 后马上调用 `this.persistState()`；fork 必须发生在 load 阶段或更早，不能等空白状态已经稳定写完后再猜测历史 storage。
- 观察：VSCode API 只提供当前 `storageUri`，没有公开“给定任意 folder 反查它的 workspaceStorage slot”的稳定 API。
  证据：本仓库本地官方 `vscode.d.ts` 中 `ExtensionContext.storageUri` 是当前 workspace specific storage，`workspace.onDidChangeWorkspaceFolders` 只提供 folder 增删事件；因此本轮必须由当前环境在单根运行时主动登记 slot，而不是后台扫描历史。
- 观察：从单根 folder fork 到多根 workspace 时，如果直接复制带 `live-runtime` 的节点元数据，多根画布会继续沿原单根 slot 的 `runtimeStoragePath` 重新附着同一个 supervisor 会话。
  证据：`hydrateRuntimeStoragePaths(...)` 只为缺失 `runtimeStoragePath` 的 live-runtime 节点补 source path；已有 `runtimeStoragePath` 会被保留，`restoreLiveRuntimeSessions()` 又按该路径分桶 attach。因此本轮 fork 后必须显式清理 live runtime 绑定。
- 观察：当前 `workspaceState` 虽然不是主恢复源，但仍是 `canvas-state.json` 缺失时的 fallback；若 multi-root workspaceState 已经存在，继续从单根 slot fork 会覆盖已有 multi-root 分支。
  证据：`loadState()` 使用 `snapshot?.state ?? workspaceState`，所以 fork 选择函数新增 `currentWorkspaceStateAvailable` 阻断条件。
- 观察：如果多个候选只按 snapshot `writtenAt` / state `updatedAt` 排序，仍可能选择到用户较早登记但之后被后台写新的历史单根 storage。
  证据：`scripts/test/test-extension-storage-paths.mjs` 中 `OLDER-RECORDED-REGISTERED-SOURCE` 的 snapshot 时间晚于当前 source，但因主动登记 `recordedAt` 更早不会被选中。

## 决策记录

- 决策：fork 源只来自本扩展在单根 folder 环境主动登记的 `storageUri`，不通过 workspaceStorage 目录名、folder hash 或历史目录枚举推断。
  理由：用户明确要求“由当前环境主动发送 slot”，且 VSCode 没有稳定 API 支持任意 folder 反查 storage slot；后台猜测容易选错 slot。
  日期/作者：2026-06-01 / Codex
- 决策：fork 仅在当前 multi-root storage 没有可恢复画布状态时发生；如果 multi-root storage 已有 `canvas-state.json`、`workspaceState` 或 recoverable runtime state，保持现有 multi-root 分支，不覆盖。
  理由：fork 是从单根进入多根的初始化动作，不是历史恢复或 merge；已有 multi-root 状态必须被视为用户已经开始维护的独立分支。
  日期/作者：2026-06-01 / Codex
- 决策：fork 后只复制可恢复状态到当前 multi-root storage，不让后续读写继续指向单根 slot。
  理由：用户要求 fork 后单根和多根互不影响；如果继续使用 source slot 或按新鲜度回读，就会把两个分支重新耦合。
  日期/作者：2026-06-01 / Codex
- 决策：fork 后清理 `Agent` / `Terminal` 的 live runtime 绑定，包括 `runtimeSessionId`、`runtimeStoragePath`、`runtimeBackend`、`runtimeGuarantee` 和 `pendingLaunch`；如果 Agent 带 provider 原生 resume 上下文，则保留为手动可恢复状态。
  理由：fork 是 storage branch 复制，不是 live process 迁移；复用原单根 supervisor 会话会让两个画布分支继续共享同一个后台进程，违背“相互之间不会影响”。
  日期/作者：2026-06-01 / Codex
- 决策：多个单根候选只按主动登记 slot 时写入的 `recordedAt` 新鲜度选择，并要求所有候选都有可比较 `recordedAt`、最新登记时间唯一、被选 snapshot 自身也有可比较时间；即使只有一个候选，只要缺少这些时间证据也 fail closed。
  理由：用户明确反对从历史 storage 猜一个 root 来用；`recordedAt` 代表当前环境主动发送 slot 的时刻，snapshot 时间只作为快照可用性校验，不能替代 slot 来源证据。
  日期/作者：2026-06-01 / Codex

## 结果与复盘

当前已经完成核心实现与最终验证。`src/common/extensionStoragePaths.ts` 新增主动登记 slot 的构造与选择函数；`src/panel/CanvasPanelManager.ts` 在单根 folder 中登记当前 slot，在 multi-root 当前 storage 空白时 fork 到当前 storage，并在加载 forked state 时清理 live runtime 绑定。`scripts/test/test-extension-storage-paths.mjs` 覆盖主动登记时间优先、已有 multi-root 状态阻断和 fail-closed；`scripts/test/test-canvas-execution-context.mjs` 覆盖源码契约。已通过 `test:extension-storage-paths`、`test:canvas-execution-context`、`typecheck`、`build` 与 `git diff --check`。

## 上下文与定向

本仓库是 VSCode workspace extension。`src/panel/CanvasPanelManager.ts` 是宿主权威状态中心，负责启动时读取 `canvas-state.json`、规范化状态、写回当前 `storageUri` 和处理 `workspace.onDidChangeWorkspaceFolders`。`src/common/extensionStoragePaths.ts` 负责从当前 `storageUri` 中选择同 canonical workspace id 的 sibling slot source；它解决 Remote SSH 或 VSCode 产生 `<id>-N` slot 的问题，不负责跨单根 folder 和多根 workspace 的 fork。

“单根 folder”指 `vscode.workspace.workspaceFolders.length === 1` 且没有 `.code-workspace` 多根语义的窗口。“多根 workspace”指同一个窗口有多个 `workspaceFolders`，通常由用户在单根窗口里添加 folder 触发。`storageUri` 是 VSCode 给扩展的当前 workspace 私有目录；我们不能根据 folder path 自己计算它，也不能枚举所有历史 workspaceStorage 猜测。

## 工作计划

先扩展 `src/common/extensionStoragePaths.ts`。新增小型纯函数与类型，用于描述“主动登记的单根 folder storage slot”：至少包含 folder path、storage path、记录时间、当前 snapshot 的 stateHash 或 writtenAt。新增选择函数时只接受调用方显式传入的 candidates，不做文件系统历史枚举；它判断当前 multi-root folders 中是否包含某个登记过的单根 folder，并且当前 multi-root storage 是否没有可恢复状态。

然后修改 `src/panel/CanvasPanelManager.ts`。在单根 folder 环境中，构造函数完成 storage selection 后登记当前 folder path 与当前 `storageUri` 到 `globalState` 中的索引，并记录诊断事件。启动 multi-root 时，在 `loadState()` 选择当前 snapshot 之前，如果当前 source/current 都没有可恢复画布状态，则检查 `globalState` 中与当前 workspace folders 匹配的单根 slot；如果存在且该 slot 有可比较的主动登记时间，并且它的 `canvas-state.json` 也带可比较 snapshot 时间，就把它作为 fork source，复制 recoverable storage 到当前 storage，并从当前 storage 继续 load。为了避免 fork 后继续耦合，迁移只发生一次，且会在当前 storage 写入自己的快照后退出。加载 forked state 时额外清理执行节点 live runtime 绑定，避免多根分支继续连接单根分支的后台会话。

最后补测试与文档。`scripts/test/test-extension-storage-paths.mjs` 覆盖纯函数；`scripts/test/test-canvas-execution-context.mjs` 增加源码契约，确保 folder change 事件不后台枚举历史 storage，fork 使用主动索引。设计文档和产品规格补上 storage fork 语义，明确不是从历史单根 storage 中任意找一个 root。

## 具体步骤

在仓库根目录执行：

    TMPDIR=$PWD/.debug/tmp npm run test:extension-storage-paths
    TMPDIR=$PWD/.debug/tmp npm run test:canvas-execution-context
    TMPDIR=$PWD/.debug/tmp npm run typecheck
    TMPDIR=$PWD/.debug/tmp npm run build
    git diff --check

如果改动影响真实 VSCode storage 恢复路径，视情况补跑：

    TMPDIR=$PWD/.debug/tmp npm run test:smoke-storage-slot

当前环境根分区已满，所有会用临时目录的命令都使用仓库内 `.debug/tmp`。

## 验证与验收

自动化成功标准：主动 slot 选择函数只使用传入的单根 slot candidates；multi-root 当前 storage 或 workspaceState 已有状态时不会 fork；当前 storage 空白且包含登记过的原单根 folder 时会选择该单根 slot；候选主动登记时间不可比、snapshot 时间不可比或最新登记时间并列时 fail closed；fork 之后写入路径仍是当前 multi-root storage，且执行节点不会复用单根 live runtime 绑定。

用户可观察验收：在单根 folder 中创建一个 Note，添加第二个 folder 后，多根 workspace 画布第一次打开能看到这个 Note；在多根中新增另一个节点后，回到原单根 folder 不会看到多根新增节点；再回多根 workspace 时仍看到多根自己的分支。

## 幂等性与恢复

登记单根 slot 是幂等的：同一个 folder path 会覆盖为最新当前 slot。fork 只在当前 multi-root storage 没有可恢复状态时发生；一旦 multi-root 已写入自己的 `canvas-state.json`，后续重载不会再从单根 slot fork。若 fork 源损坏或不可读，当前 multi-root 按空白状态启动并记录诊断，不删除任何单根状态。

## 证据与备注

当前已获得的定向验证输出：

    $ TMPDIR=$PWD/.debug/tmp npm run test:extension-storage-paths
    extensionStoragePaths tests passed

    $ TMPDIR=$PWD/.debug/tmp npm run test:canvas-execution-context
    canvas execution context tests passed

    $ TMPDIR=$PWD/.debug/tmp npm run typecheck
    # 通过，无 TypeScript 错误

    $ TMPDIR=$PWD/.debug/tmp npm run build
    # 通过，build.mjs 无错误输出

    $ git diff --check
    # 通过，无 whitespace error


## 接口与依赖

需要新增或稳定以下接口：

`src/common/extensionStoragePaths.ts`：

    export interface RegisteredSingleFolderStorageSlot { folderPath: string; storagePath: string; recordedAt?: string; snapshot: ExtensionStorageSnapshotMetadata }
    export function selectSingleFolderForkSourceForWorkspace(...): RegisteredSingleFolderStorageSlot | undefined

`src/panel/CanvasPanelManager.ts`：

    globalState 中维护 Dev Session Canvas 私有的单根 folder storage slot 索引。
    loadState() 在当前 multi-root storage 没有可恢复状态时尝试从主动登记的单根 slot fork，并在 forked state 上清理 live runtime 绑定。

本次更新说明：2026-06-01 新建计划，记录单根 folder 添加 folder 变成多根 workspace 时的画布状态 fork 目标、非目标、实现顺序和验证口径。

本次更新说明：2026-06-01 完成核心实现后更新进度、发现、决策、验证证据和接口说明，补充 fork 后清理 live runtime 绑定的决策。

本次更新说明：2026-06-01 最终验证通过后更新进度、结果、证据，并把候选选择规则明确为主动登记 `recordedAt` 优先、snapshot 时间仅作可恢复性校验。

本次更新说明：2026-06-01 计划目标已经完成且无新增技术债，将计划从 `active/` 移入 `completed/`，并同步相关设计/规格索引引用。
