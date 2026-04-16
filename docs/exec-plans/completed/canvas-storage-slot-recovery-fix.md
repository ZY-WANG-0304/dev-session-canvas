# 修复 RemoteSSH 画布多 slot 恢复与持久化一致性

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/completed/canvas-storage-slot-recovery-fix.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要修复 `RemoteSSH` 下画布状态“慢一拍”或回退到更早状态的问题，并把它收口成可重复执行的自动化回归。完成后，用户即使在 `workspaceStorage/<id>` 与 `workspaceStorage/<id>-N` 之间发生 slot 漂移，也应恢复到最新画布，而不是误读旧 slot 的 `canvas-state.json`；一旦做出这次恢复选择，后续所有持久化都应统一写回当前活跃 slot，而不是继续沿着旧 sibling slot 写下去。

用户可见的验收标准有三条。第一，存在多个 slot 时，恢复逻辑会基于时间戳校验选出最新快照，而不是“谁先被发现就用谁”。第二，一旦从 sibling slot 借用了更新快照，系统会把主快照迁回当前 slot，后续 `canvas-state.json` 写入重新对齐到 current slot；仍处于 live-runtime 的会话则继续绑定原 source slot 的 `runtimeStoragePath`。第三，自动化回归能证明 slot 选择、state hash 与最终持久化路径是一致的。

## 进度

- [x] (2026-04-16 06:30 +0800) 读取前一轮调查结论，确认本轮实现需要同时修改 slot 选择、读写路径和测试验证，属于独立交付。
- [x] (2026-04-16 06:33 +0800) 在已有脏工作树上切出主题分支 `canvas-storage-slot-recovery-fix`，避免继续直接停留在 `main`。
- [x] (2026-04-16 07:42 +0800) 重构 extension storage slot 枚举与选择逻辑，补齐 candidate/snapshot metadata、current/source/write path 分离，以及基于 `writtenAt` / `state.updatedAt` 的新鲜度选择。
- [x] (2026-04-16 08:10 +0800) 把 `CanvasPanelManager` 改成“current slot 写入、必要时先迁移 sibling state 到 current”的读写模型，并补 `storage/slotSelected`、`storage/stateMigratedToCurrentSlot` 等诊断事件。
- [x] (2026-04-16 08:24 +0800) 增强 snapshot 落盘可靠性，为主快照补 `writtenAt` / `stateHash` 元数据，并把 `canvas-state.json` 写入改成同步 write-through，再串行更新 `workspaceState`。
- [x] (2026-04-16 08:53 +0800) 补 script 回归与独立 VS Code smoke，验证多 slot 选择、迁移、当前 slot 写回以及 `stateHash` 一致性。
- [x] (2026-04-16 09:16 +0800) 清理 trusted smoke 中已废弃的多 slot helper，并同步正式设计文档、索引与技术债记录，完成计划收口。
- [x] (2026-04-16 14:40 +0800) 处理 review blocker：停止迁移 `runtime-supervisor/`，把 live-runtime 的 supervisor 访问路径改为按 `runtimeStoragePath` 绑定原 source slot，并补真实 reopen 回归与测试诊断接口。

## 意外与发现

- 观察：当前工作树已经有本轮调查留下的文档与诊断插桩改动，还夹杂用户自己的无关文件与大量未跟踪产物。
  证据：`git status --short` 显示 `src/panel/CanvasPanelManager.ts`、多份文档已修改，同时还有大量 `core.*` 与图片文件未跟踪。

- 观察：把多 slot 回归直接塞回原 `test:smoke` 主流程会引入额外状态与时序耦合，导致 trusted smoke 的失败信号变得不够聚焦。
  证据：独立抽出 `tests/vscode-smoke/storage-slot-recovery-tests.cjs` 与 `scripts/run-vscode-storage-slot-smoke.mjs` 后，`npm run test:smoke-storage-slot` 可以稳定只覆盖 slot 选择、迁移和当前 slot 写回，而不影响原 trusted smoke 的长链路职责。

- 观察：只把 sibling slot 的 `runtime-supervisor/` 复制回 current slot，不能让旧 live session 自动“搬家”；supervisor socket / registry 路径本身就是从 storage path 派生的。
  证据：review blocker 复现中，恢复后的节点仍持有旧 `runtimeSessionId`，但 attach/input/resize/stop 如果改走 current slot backend，会稳定连到错误的 supervisor，并把原 live session 降级成 `history-restored`。

## 决策记录

- 决策：本轮采用“按快照时间戳选择 source，然后把主快照迁回 current slot”的策略，而不是继续让 manager 长期绑定 sibling slot。
  理由：这样可以修复“读错旧 slot”和“后续主快照继续落在旧 slot”两类问题，同时保留 VS Code 当前会话的 current slot 写入语义。
  日期/作者：2026-04-16 / Codex

- 决策：不再迁移 sibling slot 的 `runtime-supervisor/`；live-runtime 会话继续绑定原 source slot 的 `runtimeStoragePath`，直到会话自然结束或被删除。
  理由：supervisor 的 socket / registry 路径本来就 hash 到 storage path 上，单纯复制 `runtime-supervisor/` 无法让旧 session 在 current slot 被重新发现，反而会制造错误 registry 影子状态。
  日期/作者：2026-04-16 / Codex

- 决策：多 slot 回归单独收口为 `test:smoke-storage-slot`，而不是继续嵌入 `test:smoke`。
  理由：这个问题需要精确操纵 sibling slot 文件与诊断事件；独立 smoke 更容易稳定复现，也不会把原 trusted smoke 变成耦合过多的大杂烩。
  日期/作者：2026-04-16 / Codex

## 结果与复盘

本轮已经完成用户要求的三件事。第一，`src/common/extensionStoragePaths.ts` 不再只做“current slot 为空才 fallback”的单一路径解析，而是显式枚举 current/sibling slot、读取 snapshot metadata，并按 `writtenAt` 与 `state.updatedAt` 选择最新 recovery source。第二，`CanvasPanelManager` 不再把 recovery source 直接当成长期写入路径；当 fresher sibling slot 被选中时，现在只把主快照 `canvas-state.json` 迁回 current slot 并固定由 current slot 继续持久化，而 live-runtime 会话则把 `runtimeStoragePath` 持久化为原 source slot，保证后续 attach/input/resize/stop 仍指向正确 supervisor。第三，主快照写入现已先同步落盘 `canvas-state.json`，再串行更新 `workspaceState`，把“最后一次修改只停留在异步队列里”的窗口压缩到关键恢复路径之外。

自动化验证也已经补齐。`scripts/test-extension-storage-paths.mjs` 覆盖了 fresher sibling、current slot 保留、invalid timestamp 与 recoverable-state fallback；`tests/vscode-smoke/storage-slot-recovery-tests.cjs` 则在真实 VS Code 宿主下验证 sibling fresher snapshot 被选中后，当前 slot 主快照会被更新、`storage/slotSelected` 与 `state/loadSelected` 的 `stateHash` 一致，且 live-runtime 继续保留 source slot 的 `runtimeStoragePath`；`tests/vscode-smoke/real-reopen-tests.cjs` 进一步验证 Remote-SSH reopen 后仍会沿该 `runtimeStoragePath` 重新附着到原 live session。2026-04-16 本地执行 `npm run typecheck`、`npm run test:extension-storage-paths` 与 `npm run test:smoke-storage-slot` 已通过，后续全量 `npm test` 将继续以这条 reopen 回归作为收口验证。

## 上下文与定向

本次实现跨了以下区域：

- `src/common/extensionStoragePaths.ts`
  从原来的“单一路径解析 + current slot 优先”升级为“候选 slot 集合 + freshness 选择 + recoverable fallback”。
- `src/panel/CanvasPanelManager.ts`
  从“resolved path 同时承担读写”升级为“主快照 writePath 永远固定为 current slot，而 live-runtime 按 `runtimeStoragePath` 继续指向原 source slot”，并新增 slot 选择/迁移/持久化诊断。
- `scripts/test-extension-storage-paths.mjs`
  负责验证纯逻辑层的 slot 选择，避免每次都依赖真实 VS Code 宿主。
- `tests/vscode-smoke/storage-slot-recovery-tests.cjs`
  本轮新增的独立 smoke，专门操作 sibling slot snapshot 与诊断事件，验证“选新 source -> 迁回 current -> 继续写 current”这条完整链路。

这里的“current slot”指 VS Code 当前会话给 extension 的真实 `storageUri` 路径；“sibling slot”指同一 canonical workspace id 下带 `-N` 后缀的并列 `workspaceStorage` 目录。当前修复不把 sibling slot 当长期主快照写入路径，但 live-runtime 在会话存活期间仍可能继续绑定该 source slot 的 `runtimeStoragePath`。

## 工作计划

先把 storage-slot 枚举从“单路径解析”改成“候选路径集合 + 选择结果”，这样才能在不耦合具体文件系统读写的情况下测试 slot 选择策略。然后在 `CanvasPanelManager` 中引入启动期的 recoverable-state 迁移：读取 current 与 sibling 的 snapshot 元数据，按时间戳和当前 slot 身份选出 source；如果 source 不是 current，就把 `canvas-state.json` 迁回 current 并让后续主快照固定写回 current，同时把 live-runtime 的 backend 继续绑定到 source slot 的 `runtimeStoragePath`。

接着增强落盘可靠性。主 snapshot 文件是当前画布恢复的关键路径，因此关键状态变更不能继续完全依赖后台 promise 链；至少主 snapshot 文件本身应立即写到 disk，而 `workspaceState` 更新继续串行排队即可。执行输出的节流同步仍可保留，但对象图、布局、标题、正文和 live-state flush 都应让主 snapshot 及时落盘。

最后补两层验证。第一层是 script 级回归，直接构造多 slot 目录和不同时间戳的 snapshot，验证选择逻辑。第二层是 VS Code smoke，用真实 manager 命令、诊断事件和文件读写证明：当 sibling snapshot 更新时，主快照会迁回 current slot 并继续写回 current，而 live-runtime 仍沿 source slot 的 `runtimeStoragePath` 重连；`state/loadSelected` 的 `stateHash` 也必须与被选择的源快照一致。

## 具体步骤

1. 修改 `src/common/extensionStoragePaths.ts`，导出 slot candidate 枚举与 fresher snapshot 选择所需的纯逻辑。
2. 修改 `src/panel/CanvasPanelManager.ts`：
   - 取消“resolved path 既读又写”的单一路径模型。
   - 引入启动期 recoverable-state 选择与迁移。
   - 调整 snapshot 写入时机与诊断事件。
3. 修改 `scripts/test-extension-storage-paths.mjs`，补多 slot fresher-sibling、invalid timestamp 与 current-slot retention 回归。
4. 新增 `tests/vscode-smoke/storage-slot-recovery-tests.cjs` 与 `scripts/run-vscode-storage-slot-smoke.mjs`，补 slot 选择/迁移/diagnostic/stateHash 回归。
5. 运行 `npm run typecheck`、`npm run test:extension-storage-paths` 与 `npm run test:smoke-storage-slot`。
6. 清理 trusted smoke 中不再执行的旧 helper，并同步设计文档、索引和技术债记录。

## 验证与验收

验收至少包括：

- `scripts/test-extension-storage-paths.mjs` 新增场景证明：current slot 有旧 snapshot、sibling slot 有新 snapshot 时，选择逻辑会选新 snapshot。
- VS Code smoke 证明：启动后会记录 slot 选择诊断；若 source 来自 sibling，`state/loadSelected` 与后续 `canvas-state.json` 写入会对齐 current slot，而 live-runtime 仍沿 source slot 的 `runtimeStoragePath` 重连。
- 新 smoke 断言 `stateHash` 一致：slot 选择事件里的 source state hash、`state/loadSelected` 的 state hash 和最终 current-slot `canvas-state.json` 的 state hash 应一致。
- `npm run typecheck` 通过。

本轮实际验证结果：

    $ npm run typecheck
    # 通过

    $ npm run test:extension-storage-paths
    extensionStoragePaths tests passed

    $ npm run test:smoke-storage-slot
    Storage-slot recovery smoke passed.

## 幂等性与恢复

slot 迁移逻辑必须是幂等的：重复启动同一 workspace 时，不应因为重复复制 recoverable state 而制造新分叉。主快照迁移目标永远是 current slot；sibling slot 只能作为读取来源，不能在本轮继续承担主快照写入责任。对仍然存活的 live-runtime，会话级 `runtimeStoragePath` 可以继续指向 source slot，直到会话本身被 drain。

若迁移过程中复制失败，应 fail closed：保留清晰诊断事件并回退到 current slot 自身，而不是静默继续使用 sibling 作为长期写入路径。

## 证据与备注

实现完成后的关键证据：

    src/common/extensionStoragePaths.ts
    - collectExtensionStorageSlotCandidates() 会同时收集 current/sibling slot 与 snapshot metadata
    - selectPreferredExtensionStorageRecoverySource() 会优先按 snapshot freshness 选择 source，同时固定 writePath = currentPath

    src/panel/CanvasPanelManager.ts
    - refreshStorageRecoverySelection() 会记录 `storage/slotSelected`，必要时先迁移主快照到 current slot
    - queuePersistedCanvasSnapshotWrite() 会先同步写 `canvas-state.json`，再串行更新 `workspaceState`
    - loadState() 会记录 `state/loadSelected`，便于对照 recovery source、snapshot path 与 `stateHash`

    tests/vscode-smoke/storage-slot-recovery-tests.cjs
    - sibling fresher snapshot 会被选中，主快照迁回 current slot，而 live-runtime 继续绑定 source slot
    - 恢复后的新写入只更新 current slot，sibling snapshot 保持为恢复来源快照；真实 reopen 后 attach/input 仍能命中原 live session

## 接口与依赖

本轮最终收口到以下接口：

- `collectExtensionStorageSlotCandidates(...)`
  负责枚举 current slot 与 sibling slots，并抽取 snapshot metadata。
- `selectPreferredExtensionStorageRecoverySource(...)`
  基于 snapshot 时间戳选择 source，并区分 `sourcePath` 与 `writePath`。
- `CanvasPanelManager` 启动期的 recoverable-state migration helper
  负责把 source slot 的主快照迁回 current slot，并把 live-runtime 的 `runtimeStoragePath` 保留为 source slot。

---

本次更新说明：2026-04-16 将计划移入 `completed/`，因为多 slot 恢复选择、current-slot 写回、同步快照落盘与自动化回归已经全部完成；同时同步记录独立 smoke 的收口方式与最终验证结果。
