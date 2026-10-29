# 修复画布删除状态的跨窗口同步与回归

本 `ExecPlan` 是活文档。随着工作推进，必须持续维护 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本计划遵循仓库根目录 `docs/PLANS.md`。目标是修复 PR #344 的 P1/P2 review findings：Runtime Persistence 开启时，同一 root 的另一个 VS Code 窗口也要在节点删除清理期间禁用该节点，并在删除结束、失败或 Host 退出时恢复正确状态；现有 lifecycle-isolation 回归夹具也必须能安全调用新增状态发布路径。

## 目标与全局图景

用户在一个窗口删除节点、清空画布或重置模板时，同一共享 root 的其他窗口应立即显示删除处理中并禁用受影响节点。删除失败或发起删除的 Host 消失后，其他窗口恢复节点交互；新加入的窗口能得到仍在进行的删除状态。此瞬态状态不写入画布模型或持久化快照。关闭 Runtime Persistence 时，各窗口继续保持隔离。

PR #344 已有的节点局部提示、键盘删除、整画布清空/重置锁定及失败解锁保持不变。`test:smoke-lifecycle-isolation` 使用 prototype-only 测试夹具，必须初始化新字段以避免 bootstrap 期间抛错。

## 进度

- [x] (2026-10-29) 确认 PR head `846bac2a`、目标 `main`、PR 仍 OPEN；当前工作目录原分支无已跟踪改动，现有三个 untracked 用户文件与 PR 分支无路径冲突。
- [x] (2026-10-29) 在当前工作目录创建 `canvas-node-deletion-cross-host-fix`，基于 PR head 开展修复；未切换到或修改其他 worktree。
- [x] (2026-10-29) 复核 P1：pending map 是 manager 私有状态；共享 root store 只同步画布快照；现有 participant listener 已提供同 root 的 loopback Host 协调边界。
- [x] (2026-10-29) 复核 P2：`scripts/test/test-smoke-lifecycle-isolation.mjs` 使用 `Object.create(CanvasPanelManager.prototype)`，因此绕过实例字段初始化。
- [x] (2026-10-29) 实现 Runtime Persistence 同 root Host 间的瞬态删除状态订阅、活动操作快照、增量更新、Host 失联确认清理与重连恢复；Webview bootstrap 等待 root stores 就绪后发送状态。
- [x] (2026-10-29) 修复 prototype-only lifecycle fixture 对新增字段的初始化。
- [x] (2026-10-29) 更新正式删除设计与本计划中的跨窗口边界；设计索引无需新增条目，因为沿用现有文档。
- [x] (2026-10-29) 复核 participant 订阅、快照/增量版本、连接重建和来源清理路径；P1/P2 变更通过 `npm run build`、`npm run typecheck` 与 `git diff --check`。未运行自动化测试；跨窗口 Extension Host 场景仍需 CI/手动验收。
- [ ] 完成针对性代码审查，提交并将变更推送至 PR #344。
- [ ] 以上完成后，再分别归因 `Gate webview-function`、`remote-ssh-real-reopen-exit`、`Gate verify-result` 和 `Verify release contract` 四个失败项。

## 意外与发现

- 观察：`SharedRootCanvasStore` 用原子 JSON 快照和 `fs.watchFile` 同步共享结构，但 pending deletion ID 不属于 `CanvasPrototypeState`，不会随删除最终提交前传播。
  证据：`sharedRootCanvasStore.ts` 的 `publish()` / `observe()` 只写入并回调 `Snapshot.state`；PR #344 的 `CanvasPanelManager.publishNodeDeletionPendingState()` 只向当前实例 panel/editor 发消息。
- 观察：共享 root 参与者已拥有 loopback TCP listener、token 身份校验和参与者记录，可用于短生命周期控制消息；现有一次性 admission 请求不能承载持续状态订阅。
  证据：`sharedRootCanvasParticipants.ts` 的 `serve()` 将 JSON 请求响应后结束 socket；Host 注册记录位于 `${canvas-state.json}.participants/`。
- 观察：TCP channel 断开本身不能证明 Host 退出。共享 root 的既有协调把 `ECONNRESET` / `EPIPE` 当作未知，不据此清除参与者；pending deletion 遵守同一边界。
  证据：`SharedRootCanvasParticipants.tryJoin()` 和 `livePeers()` 在 reset 时不授予清理权，也不删除参与者记录。
- 观察：shard-2 已证实是新增字段与一个 constructor-bypass 测试夹具不兼容，不代表真实 manager 构造路径缺少初始化。
  证据：CI artifact `test:smoke-lifecycle-isolation.log` 显示 `Object.create` 创建的 fake Host 在 `publishNodeDeletionPendingState()` 中对 undefined 的 map 调用 `.values()`。

## 决策记录

- 决策：跨窗口 pending 状态走现有 shared-root participant loopback 协调通道，不混入共享画布 snapshot 或用户持久化模型。
  理由：pending deletion 是运行时瞬态状态，设计要求其不落入画布数据；participant token、root 隔离和 listener 生命周期已经由共享 root 协调层管理。
  日期/作者：2026-10-29 / Codex（实现中；协议细节须在验证后补录）
- 决策：peer 订阅需要接收当前 active-operation snapshot；未来更新按来源与操作 ID 合并；peer socket 关闭后保留该来源的远端操作，直到重连恢复，或参与者记录撤销/listener 确认不可达。
  理由：只发送增量会让新 Host 错过已开始的清理；把来源与操作区分开才能正确处理并行删除。创建连接的一侧负责重连，另一侧确认 peer 是否仍登记且 listener 可达；reset/timeout 不作为提前解锁依据。
  日期/作者：2026-10-29 / Codex
- 决策：P2 在触发 bootstrap 的 fixture 显式初始化 pending 状态，而不为生产方法增加只服务于 constructor-bypass 测试对象的 optional chaining。
  理由：生产构造函数保证字段存在；夹具需要按新增实例状态维持完整性，静默忽略缺失状态会掩盖后续 fixture 缺陷。
  日期/作者：2026-10-29 / Codex

## 结果与复盘

P1/P2 代码与设计记录已更新。`npm run build`、`npm run typecheck`、`git diff --check` 通过；本轮没有运行自动化测试，因此跨进程订阅、迟到加入、断线重连和 Host 退出清理尚未得到运行时验证。提交并推送后先确认这两个 finding 的 PR 状态，再按用户要求归因另外四个 CI 失败项。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 持有单个 Extension Host 的 Webview surfaces、待删除本地集合以及 `SharedRootCanvasStore`。`sharedRootCanvasStore.ts` 按 root 读写共享的画布状态文件。`sharedRootCanvasParticipants.ts` 在同一执行环境的 root 范围内登记参与 Host，并通过 localhost TCP 做准入和 Host 接管协调。跨窗口锁定必须复用 root 隔离边界，但不能把删除中状态写入共享结构文件。

`scripts/test/test-shared-root-canvas-store.mjs` 通过独立 Node worker 验证不同进程共享 root 的行为；可在这里验证订阅、初始状态、操作增删和 Host 进程退出。`scripts/test/test-smoke-lifecycle-isolation.mjs` 的 fixture 绕过 `CanvasPanelManager` 构造函数，应显式初始化任何被测试路径触及的新字段。

## 工作计划

先在 participant 通道中增加经过现有 token 身份校验的双向、短生命周期订阅。一个 Host 连接到当前 root 的既有 peers 后，双方同步各自的 active-operation 快照；之后双方都能在该连接上发布操作开始/结束。每条状态按来源 token 和操作 ID 记录，连接意外关闭时保留远端锁并恢复订阅；确认 Host 离开后才移除来源的所有操作。消息过大、身份不匹配或协议错误时关闭该 socket，不污染参与者 admission、运行时交接或共享画布状态。

随后将 participant 事件接到 `SharedRootCanvasStore`，再由 `CanvasPanelManager` 把本地删除 operation 发布到当前共享 root stores，并把远端 operation 合并进本地待删除集合，向本 manager 的 Webviews 广播。多个 root/operation 采用来源隔离与并集；结束一个 operation 不能提前解锁仍被另一个 operation 标记的 node ID。不开启 Runtime Persistence 时没有 shared-root store，也不产生跨窗口状态。

修复 lifecycle fixture 后，更新 `docs/design-docs/canvas-node-deletion.md` 描述跨 Host 的瞬态订阅、迟到加入与断线清理边界。原有第 8 节第 9 项验收继续保留。更新本计划的验证结果。按用户指示，只有 P1/P2 修复完成后才开始取证归因其他四个失败 CI job。

## 具体步骤

1. 在当前工作目录检视 participant socket、root store 创建时序和所有调用 `publishNodeDeletionPendingState()` 的删除入口，确认 store 就绪前开始的操作会被保留并在订阅就绪后广播。
2. 实现订阅协议与 peer 断开清理，再在两个独立进程的 shared-root 测试夹具中覆盖初始快照、并行操作增删、迟到订阅及进程退出清理。
3. 将订阅状态接入 CanvasPanelManager，并确保本地多个 surfaces 与远端状态使用同一并集。
4. 在 `test-smoke-lifecycle-isolation.mjs` 补上 pending map 初始化。
5. 更新 `canvas-node-deletion.md` 和本计划；review 其他四个 CI 失败项待上述 P1/P2 完成后执行。
6. 完成后更新进度/结果，依据 `docs/workflows/COMMIT.md` 提交，并按仓库 MR 更新流程 rebase 到最新 `origin/main` 后推送原 PR branch。

## 验证与验收

验收覆盖两个独立 Host 对同一 root 的订阅。Host A 发布 pending operation 后，Host B 的待删除 union 包含相同 node IDs；并行操作中 A 结束后，B 仍保留被另一来源标记的 node IDs；新加入 Host 收到仍活动操作的快照；确认来源 Host 退出后，其他 Host 清除其操作，而 reset/timeout 不提前清除。最终节点结构仍只由现有共享画布 snapshot 提交。另须确认 Runtime Persistence 关闭时不同 Host 不互相接收 pending 消息。

P2 验收为 lifecycle-isolation bootstrap 不因 pending map 缺失而抛异常，且原 isolation assertions 仍成功。代码改动完成后按本次工作授权执行必要的定向自动化验证、build/typecheck；最终状态应在 PR 最新 head 上记录。手动 Extension Development Host 验收若本环境不可启动，须说明缺口，不声称已验证。

## 幂等性与恢复

订阅连接是瞬态资源。创建连接的一侧负责重连；接收方在连接关闭后先核对同 root participant 记录和 listener，reset/timeout 时保留 pending 状态，确认参与者离开才清除来源状态。Host dispose 时关闭 channels 并清理自身持有的远端来源映射。对同一 operation 的重复 snapshot/update 必须幂等。协议错误关闭 channel，但不直接解锁来源状态。`CanvasPrototypeState`、canvas snapshot schema 和 Runtime Persistence 数据无迁移。

## 证据与备注

初始 review 证据来自 PR head `846bac2a5e58d56c00d01002c46fdc054d5463ba`。shard-2 首次失败的精确报错为 `TypeError: Cannot read properties of undefined (reading 'values')`，调用链从 `bootstrapInteractiveSurface` 到 `publishNodeDeletionPendingState`。

## 接口与依赖

无需增加外部依赖。预期内部接口包括 participant 层的 pending operation 发布/订阅或等价 API、root store 上转发 pending 更新的 callback，以及 manager 侧按 `(source token, operation ID)` 管理远端操作的状态。具体 TS 签名在实现后记录；TCP 消息只属于同 root participant 协议，不加入 `common/protocol.ts`，因为它不面向 Webview。

更新说明：2026-10-29 基于 PR #344 的 P1 跨窗口状态丢失与 P2 regression fixture 未初始化字段创建本计划；先完成这两个确定性问题，再按用户要求归因其余四个失败 CI 检查。
