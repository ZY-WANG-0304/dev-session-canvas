# RemoteSSH 重连后画布状态回退调查

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/completed/remote-canvas-state-revert-investigation.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次工作要解释一个具体现象：在 `RemoteSSH` 场景下，用户退出 VS Code 或断开连接后再次重连，画布恢复成更早的状态，而不是关闭前最后一次可见状态。用户可见影响包括节点列表、节点布局和节点内容一起回退，且有时出现“永远慢一拍”的循环。

调查完成时，读者应能直接回答四个问题：第一，画布状态到底写到哪里；第二，保存是在什么时候触发；第三，恢复时到底从哪个来源读回；第四，为什么 `RemoteSSH` 下会出现落后一轮或多轮的恢复结果，以及应该如何验证这一判断。

## 进度

- [x] (2026-04-16 06:02 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`，确认这是需要独立追踪的多步调查。
- [x] (2026-04-16 06:05 +0800) 检查工作树并从 `main` 切出主题分支 `canvas-persistence-remote-revert-analysis`。
- [x] (2026-04-16 06:32 +0800) 梳理 `CanvasPanelManager` 的状态持久化与恢复链路，确认画布主快照写入 extension storage 下的 `canvas-state.json`，`workspaceState` 只保留轻量 fallback；普通节点变更实时触发 `persistState()`，执行节点内容按 `1s` 节流同步并在 host boundary 上强制 flush。
- [x] (2026-04-16 06:43 +0800) 梳理 `RemoteSSH` reopen 的 storage fallback 与 snapshot 读取链路，确认 `resolvePreferredExtensionStoragePath()` 只在 current slot 无 recoverable state 时才搜索 sibling slot，且优先级按 slot 距离而不是写入新鲜度。
- [x] (2026-04-16 06:50 +0800) 用代码证据解释“慢一拍”现象：当前 slot 优先 + snapshot 无单调时间戳 + 多 slot 并存时不比较新鲜度，足以导致重连读到旧 slot；同时确认异步落盘窗口会放大“最后一次修改未落盘”的次级风险。
- [x] (2026-04-16 07:06 +0800) 补 test-only 诊断事件 `state/loadSelected`、`state/persistQueued`、`state/persistWritten`，并同步正式设计文档、发布文档与技术债记录。

## 意外与发现

- 观察：仓库里已经存在与 `RemoteSSH` reopen、`workspaceStorage` sibling slot fallback、terminal state restore 相关的设计文档和 `ExecPlan`。
  证据：`docs/design-docs/public-marketplace-release-readiness.md`、`docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/exec-plans/completed/public-marketplace-package-readiness.md`、`docs/exec-plans/completed/remote-ssh-runtime-persistence-automation.md`。

- 观察：画布恢复主路径不是 `workspaceState`，而是 extension storage 下的 `canvas-state.json`；`loadState()` 会先读 snapshot 文件，再 fallback 到 `workspaceState`。
  证据：`src/panel/CanvasPanelManager.ts` 中 `loadState()` 使用 `loadPersistedCanvasSnapshot()?.state ?? this.getStoredValue(STORAGE_KEYS.canvasState)`，而 `queuePersistedCanvasSnapshotWrite()` 先写 `canvas-state.json`，再把去掉 serialized terminal state 的轻量状态写回 `workspaceState`。

- 观察：节点列表、布局、标题与 Note 正文变更都会立即触发 `persistState()`；执行节点内容则通过 `queueExecutionStateSync()` 以 `1000ms` 节流更新到快照，并在 `prepareForHostBoundary()` 前强制 flush。
  证据：`handleActiveWebviewMessage()` 中 `moveNode`、`resizeNode`、`updateNodeTitle`、`updateNoteNode` 均直接调用 `persistState()`；`EXECUTION_OUTPUT_STATE_SYNC_INTERVAL_MS = 1000`，`flushAllExecutionSessionStatesForHostBoundary()` 会在 deactivation/reload 前同步状态。

- 观察：`resolvePreferredExtensionStoragePath()` 的 sibling-slot fallback 只在 current slot 没有 recoverable state 时生效；若 current slot 已有旧 `canvas-state.json`、`runtime-supervisor/registry.json` 或 `agent-runtime` 目录，就会直接把 current slot 视为权威路径，不再比较其他 sibling slot。
  证据：`src/common/extensionStoragePaths.ts` 在 `hasRecoverableState(normalizedCurrentPath)` 为真时直接返回 current path；只有为假时才收集 sibling slot candidates。

- 观察：当前实现没有跨 slot 的写入新鲜度元数据；`PersistedCanvasSnapshot` 只有 `version`、`state` 和 `activeSurface`，slot fallback 也只按 slot 距离排序，因此无法可靠选出“最新”那份快照。
  证据：`PersistedCanvasSnapshot` 定义位于 `src/panel/CanvasPanelManager.ts`，不包含时间戳或序号；`compareWorkspaceStorageSlotCandidates()` 仅比较 `slotIndex` 距离和名称。

- 观察：一个最小脚本已经能直接证明“current slot 自带旧 snapshot 时，解析逻辑不会转去读更新的 sibling slot”。
  证据：2026-04-16 本轮 ad-hoc 脚本在 `workspaceStorage/abc` 和 `workspaceStorage/abc-1` 同时放置 `canvas-state.json` 后，调用 `resolvePreferredExtensionStoragePath(canonical)` 的输出仍是 `resolvedPath = canonical`。

## 决策记录

- 决策：本轮先按“问题调查”而不是“直接修复”推进，但仍创建独立 `ExecPlan`。
  理由：当前问题涉及多条状态链路与 `RemoteSSH` 特有恢复路径，如果没有活文档承载代码证据、推断与未确认项，后续结论很难追溯。
  日期/作者：2026-04-16 / Codex

- 决策：本轮额外补 test-only 诊断事件，而不是直接尝试修改 slot 选择策略。
  理由：当前最缺的是“到底从哪个 slot 读、写到了哪个 slot”的直接证据；先把读写源打到测试诊断里，能让后续 real-reopen / RemoteSSH 复现更快闭环，也避免在尚未确认最终策略前做错误修复。
  日期/作者：2026-04-16 / Codex

## 结果与复盘

本轮已经完成三件事。第一，确认画布状态主恢复源是 extension storage 下的 `canvas-state.json`，而不是 `workspaceState`；`workspaceState` 只是去掉 serialized terminal state 的轻量兜底。第二，确认常规对象图变更是实时触发异步持久化，执行节点输出与 terminal state 则按 `1s` 节流更新并在正常 host boundary 上强制 flush。第三，确认 `RemoteSSH` 下“慢一拍”最符合代码证据的根因并不是单纯的退出时机，而是 `workspaceStorage` 多 slot 并存时缺少“最新快照”判定：当前 slot 只要残留任意 recoverable state 就会被直接采用，而 snapshot 本身又没有跨 slot 的单调时间戳或序号。

这解释了症状为什么会覆盖整张画布，而不只是 terminal 输出：一旦恢复链路读到旧 slot 的 `canvas-state.json`，节点列表、布局、标题、正文和 execution metadata 都会一起回退。异步落盘未等待完成仍然是次级风险，尤其会影响最后 `1s` 内的 execution output / serialized terminal state，但它更像“加重因素”，不足以单独解释多轮回退和“永远慢一拍”的循环。

## 上下文与定向

与本次问题直接相关的主线文件预计包括：

- `src/panel/CanvasPanelManager.ts`：宿主权威状态、节点变更、持久化调度、恢复入口。
- `src/common/extensionStoragePaths.ts`：从当前 extension storage 路径推导 sibling workspace slot 的 fallback 规则。
- `docs/design-docs/runtime-persistence-and-session-supervisor.md`：正式的 runtime persistence 分层与恢复口径。
- `docs/design-docs/embedded-terminal-runtime-window.md`：终端节点内容如何进入 snapshot。
- `tests/vscode-smoke/real-reopen-tests.cjs`：`RemoteSSH` / reopen 场景的自动化入口。

这里的“慢一拍”指的是：用户在第 N 次退出前已经看到状态 `S_N`，但第 N+1 次重连恢复成 `S_(N-1)` 或更早状态。这通常意味着“读取源”和“最新写入源”不是同一个，或者写入有异步窗口导致最后一次修改没有进入实际恢复链路。

## 工作计划

先确认画布宿主状态的真实写入路径：`workspaceState`、snapshot 文件、runtime registry 各自保存什么字段，谁是恢复主路径，谁只是 fallback。然后确认 `RemoteSSH` reopen 时恢复逻辑是否会因为 workspace slot 漂移而落到旧目录，或者在主 snapshot 缺失/滞后时回退到更旧的 `workspaceState`。最后把这些证据与“节点布局、内容、terminal 历史一起回退”的症状对齐，收敛出最符合现象的根因。

## 具体步骤

1. 在仓库根目录阅读 `src/panel/CanvasPanelManager.ts` 中的 `loadState()`、`persistState()`、snapshot 读写辅助函数及其调用点。
2. 阅读 `src/common/extensionStoragePaths.ts` 与 reopen 相关测试，确认 `RemoteSSH` 下 storage slot fallback 的排序和选择规则。
3. 对照 `docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/design-docs/public-marketplace-release-readiness.md` 和相关已完成 `ExecPlan`，核对当前正式口径与实际代码是否一致。
4. 如证据不足，再补最小诊断日志或使用现有 smoke 场景确认读取源与最新写入源是否一致。

## 验证与验收

本轮调查的验收不是“代码编译通过”，而是以下可核对结论成立：

- 能明确指出画布状态的所有持久化介质，以及各自保存的数据范围。
- 能明确指出保存是实时触发、异步触发还是依赖关闭事件补写。
- 能明确指出 `RemoteSSH` reopen 时优先恢复哪份数据，何时会 fallback 到其他来源。
- 对“慢一拍”给出至少一条由代码证据支撑的根因判断，并附上可执行的日志或 smoke 验证方式。

## 幂等性与恢复

本计划本身是文档改动，可重复编辑。调查过程中不应回退现有代码；若需要临时插桩，应保持改动最小且便于撤回。

## 证据与备注

本轮最关键的直接证据如下：

    src/panel/CanvasPanelManager.ts
    - loadState(): snapshot 优先，workspaceState 仅作 fallback
    - queuePersistedCanvasSnapshotWrite(): 先异步写 canvas-state.json，再更新 workspaceState
    - handleActiveWebviewMessage(): move/resize/title/note 变更均实时调用 persistState()
    - queueExecutionStateSync(): execution 内容按 1000ms 节流写回

    src/common/extensionStoragePaths.ts
    - hasRecoverableState(currentPath) 为真时，直接返回 currentPath
    - sibling-slot fallback 只在 currentPath 无 recoverable state 时生效
    - compareWorkspaceStorageSlotCandidates() 只按 slotIndex 距离排序，没有时间戳

    2026-04-16 ad-hoc 验证：
    - 在 workspaceStorage/abc 与 workspaceStorage/abc-1 同时放置 canvas-state.json
    - 调用 resolvePreferredExtensionStoragePath(abc)
    - 返回 resolvedPath = workspaceStorage/abc，而不是更新的 sibling slot

## 接口与依赖

本轮主要依赖以下接口与边界：

- `vscode.ExtensionContext.workspaceState`
- extension storage 目录下的 snapshot / registry 文件
- `RemoteSSH` reopen 场景使用的 workspace storage slot 推导逻辑
- 宿主到 Webview 的状态同步协议，仅用于判断恢复后的 UI 是否来自宿主最新状态

---

本次创建说明：2026-04-16 新增本计划，用于调查 `RemoteSSH` 断开/重连后画布状态回退与“永远慢一拍”现象；之所以单独起计划，是因为本轮需要同时梳理宿主持久化、extension storage slot fallback 与 reopen 恢复路径。
