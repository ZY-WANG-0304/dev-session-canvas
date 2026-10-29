# 修复画布删除状态的跨窗口同步与回归

本 `ExecPlan` 是活文档。随着工作推进，必须持续维护 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本计划遵循仓库根目录 `docs/PLANS.md`。目标是修复 PR #344 的 P1/P2 review findings：Runtime Persistence 开启时，同一 root 的另一个 VS Code 窗口也要在节点删除清理期间禁用该节点，并在删除结束、失败或 Host 退出时恢复正确状态；现有 lifecycle-isolation 回归夹具也必须能安全调用新增状态发布路径。

## 目标与全局图景

用户在一个窗口删除节点、清空画布或重置模板时，同一共享 root 的其他窗口应立即显示删除处理中并禁用受影响节点；即使窗口分别以单根和多根工作区打开，也必须把同一 root-local node ID 映射到各自画布 ID。删除失败或发起删除的 Host 消失后，其他窗口恢复节点交互；新加入的窗口能得到仍在进行的删除状态。此瞬态状态不写入画布模型或持久化快照。关闭 Runtime Persistence 时，各窗口继续保持隔离。

PR #344 已有的节点局部提示、键盘删除、整画布清空/重置锁定及失败解锁保持不变。`test:smoke-lifecycle-isolation` 使用 prototype-only 测试夹具，必须初始化新字段以避免 bootstrap 期间抛错。

## 进度

- [x] (2026-10-29) 确认 PR head `846bac2a`、目标 `main`、PR 仍 OPEN；当前工作目录原分支无已跟踪改动，现有三个 untracked 用户文件与 PR 分支无路径冲突。
- [x] (2026-10-29) 在当前工作目录创建 `canvas-node-deletion-cross-host-fix`，基于 PR head 开展修复；未切换到或修改其他 worktree。
- [x] (2026-10-29) 复核 P1：pending map 是 manager 私有状态；共享 root store 只同步画布快照；现有 participant listener 已提供同 root 的 loopback Host 协调边界。
- [x] (2026-10-29) 复核 P2：`scripts/test/test-smoke-lifecycle-isolation.mjs` 使用 `Object.create(CanvasPanelManager.prototype)`，因此绕过实例字段初始化。
- [x] (2026-10-29) 实现 Runtime Persistence 同 root Host 间的瞬态删除状态订阅、活动操作快照、增量更新、Host 失联确认清理与重连恢复；Webview bootstrap 等待 root stores 就绪后发送状态。
- [x] (2026-10-29) 修复 prototype-only lifecycle fixture 对新增字段的初始化。
- [x] (2026-10-29) 更新正式删除设计与本计划中的跨窗口边界；设计索引无需新增条目，因为沿用现有文档。
- [x] (2026-10-29) 复核 participant 订阅、快照/增量版本、连接重建和来源清理路径；修正通过 `npm run build`、`npm run typecheck` 与 `git diff --check`。本机未运行自动化测试；跨窗口 Extension Host 场景仍需 CI/手动验收。
- [x] (2026-10-29) 针对 shard-2 暴露的第二个 constructor-bypass manager 补齐独立 pending map，并在隔离断言中校验；commit `4035e1cb` 已推送至 PR #344。
- [x] (2026-10-29) 基于旧 CI run `40840058557` 的 job 日志与 artifacts，对其余四个失败项完成初步归因。
- [x] (2026-10-29) 确认 head `621ea27c` 的最新 run `40849874062` 中 regression shard-2 通过，Remote SSH exit/reopen 通过；webview-function 超时再次出现。
- [x] (2026-10-29) 更新 lifecycle smoke 的 bootstrap 顺序断言，覆盖新增的 `host/nodeDeletionPending`，并推送至 PR #344。
- [x] (2026-10-29) 按 CI `Resolve immutable plan` 提示重建 `smoke-budget-inventory.json`，确认场景预算未变化，只有 `extension-tests.cjs` 源码摘要更新。
- [x] (2026-10-29) 确认最新 head `f4769a78` 的 run `40854227908` 收尾：三个 regression shards、source-host restricted 与 Remote SSH exit/reopen 通过；webview-function 一例超时，其余失败均为上游结果聚合。
- [x] (2026-10-29) 对照 `origin/main` 和 Playwright trace 确认 webview timeout 是本 PR 的确定性 overview 交互回归：overview 禁用路径新增的整节点 `inert` 阻断了已有 `.window-chrome` 双击 handler。
- [x] (2026-10-29) 将整节点 inert 限制在 deletion-pending 节点，同时保留 overview context 禁用内部操作的行为。
- [x] (2026-10-29) 最新修复 head `cc61e295` 的 Release Preflight `40865378852` 成功：154 个 job 成功、3 个按范围跳过；localized Stop case、regression shards 和 Verify release contract 全部通过。
- [x] (2026-10-29) 统计六轮完整 PR Release Preflight 墙钟耗时为 19:18、19:42、19:56、32:21、20:02、20:00；中位数约 19:58，最长 32:21，后续默认等待 35 分钟再查，若仍未完成再续等。
- [x] (2026-10-29) 修正 `remote-ssh-real-reopen-exit` 初始化时序：关闭临时 editor Canvas 前等待应用层 ready；重新生成 bounded wait inventory，为 setup/verify 各登记 45 秒 ready 上界（场景总预算增加 90 秒）。最新 head `0a339295` 的 Release Preflight `40880877833` 中该 job 通过。
- [x] (2026-10-29) 处理新 review finding：每个 root channel 改为传 root-local node IDs，接收端按单根/多根模式映射本机 ID；远端操作键补入 rootPath，避免同一跨 root operation 的子集相互覆盖。
- [x] (2026-10-29) 在 Host wiring 回归中新增多根到单根、单根到多根配对映射，以及同一 operation 跨 root 独立清除覆盖；同步设计验收口径。新增回归尚未运行。
- [x] (2026-10-30) `npm run typecheck`、`node --check scripts/test/test-host-execution-owner-wiring.mjs` 与 `git diff --check` 通过；未本地运行测试。
- [x] (2026-10-30) PR head `4bbed104` 的 Release Preflight run `40900971882` 完成并通过：154 个 job 成功、3 个按范围跳过；regression shards、verify-result 和 Verify release contract 均成功。

## 意外与发现

- 观察：`SharedRootCanvasStore` 用原子 JSON 快照和 `fs.watchFile` 同步共享结构，但 pending deletion ID 不属于 `CanvasPrototypeState`，不会随删除最终提交前传播。
  证据：`sharedRootCanvasStore.ts` 的 `publish()` / `observe()` 只写入并回调 `Snapshot.state`；PR #344 的 `CanvasPanelManager.publishNodeDeletionPendingState()` 只向当前实例 panel/editor 发消息。
- 观察：共享 root 参与者已拥有 loopback TCP listener、token 身份校验和参与者记录，可用于短生命周期控制消息；现有一次性 admission 请求不能承载持续状态订阅。
  证据：`sharedRootCanvasParticipants.ts` 的 `serve()` 将 JSON 请求响应后结束 socket；Host 注册记录位于 `${canvas-state.json}.participants/`。
- 观察：TCP channel 断开本身不能证明 Host 退出。共享 root 的既有协调把 `ECONNRESET` / `EPIPE` 当作未知，不据此清除参与者；pending deletion 遵守同一边界。
  证据：`SharedRootCanvasParticipants.tryJoin()` 和 `livePeers()` 在 reset 时不授予清理权，也不删除参与者记录。
- 观察：shard-2 已证实是新增字段与一个 constructor-bypass 测试夹具不兼容，不代表真实 manager 构造路径缺少初始化。
  证据：CI artifact `test:smoke-lifecycle-isolation.log` 显示 `Object.create` 创建的 fake Host 在 `publishNodeDeletionPendingState()` 中对 undefined 的 map 调用 `.values()`。
- 发现：首次给 `fixture()` 补 map 后，PR 更新触发的 shard-2 仍以同一 `.values()` 错误失败，因为 `createWebviewLifecycleRaceDiagnosticManager()` 内部还通过 `Object.create` 单独构造第二个 manager。已在该诊断 manager 初始化两个独立 map，并把独立性加入 smoke-isolation 断言；修正后结果待 PR 新一轮 CI 确认。
- 根因：该 webview case 验证 overview Terminal 标题栏双击后聚焦节点。测试与 `handleNodeChromeDoubleClick` 在 `origin/main` 已存在；本 PR 改动 `CanvasNodeInteractionBoundary`，将 `canvasOverviewInertProps(props.disabled)` 设到整个 `.canvas-node`，同时 execution nodes 传入 `disabled={overviewInteractionsDisabled || deletionPending}`。overview 时该父节点因此为 `inert`，浏览器不会把双击交给其子元素 `.window-chrome` 上已有的 React handler；事件落到外层 React Flow 节点，表现为选中/移动，而非 `focusNodeInViewport`。这与 trace 一致：双击完成、出现两次 `webview/moveNode`，selected 变 true，但 viewport 未改变、overview 仍为 true，故 Stop 一直不可见并耗尽 deadline。
- 证据与边界：该 case 在多个 run 重复，最新完整代码 run `40854227908` 的 434 个用例中 433 个通过；`.window-chrome` handler 和原 test 位于 `origin/main`，造成差异的是 PR 新增的 inert 传播。由此确认是当前 PR 引入的确定性 UI regression，而非不稳定手势或单纯测试预算不足；需将 overview context disable 与删除 pending 的全节点 inert 分开。该回归不是原删除意图本身，但来自 PR 中为锁定删除节点添加的通用 interaction boundary。
- 归因：旧 run 的 `remote-ssh-real-reopen-exit` 在重新打开 editor Canvas 后 45 秒未等到 ready。诊断记录有 `surface/rendered`，但 lifecycle 保持 `ready:false`、`bootstrapAck:false`；远端 Host 被确认退出、Supervisor 和原执行仍在，失败发生于 Remote SSH 重开后的 Webview ready 握手。配对的 `remote-ssh-real-reopen-retain` 同 run 成功；现有证据没有证明 Remote SSH 的 `PendingMigrationError` 是原因，也不能排除这个退出/重开路径里的产品或 harness 时序问题。
- 归因：`Gate verify-result` 的 206 个目标成功、失败项来自 shard-2、webview-functional 与 remote-ssh-real-reopen-exit producer。它报告这些 producer 失败，不是独立的验证器根因。
- 归因：`Verify release contract` 在 `check-acceptance.mjs:50` 因 Verify result 实际结论为 failure 而拒绝上传的 acceptance，报错 `Verifier failure cannot be hidden by an uploaded file`。它是对上游验收失败的预期阻断。
- 归因：run `40849874062` 曾显示 `source-host (restricted)` 失败，原因是 lifecycle smoke 对 bootstrap 消息顺序的旧断言；bootstrap 实际依次发送 `host/bootstrap`、`host/nodeDeletionPending`、`host/visibilityRestored`。更新断言并生成 smoke budget inventory 后，最新 run `40854227908` 的 restricted job 通过，确认是测试预期/清单同步问题。
- 复核：run `40854227908` 的 `remote-ssh-real-reopen-exit` 通过，旧 run 的握手超时没有重现。`webview-function` preparation deadline 超时仍重现，详见上面的页面与消息证据。
- 归因：紧接断言修复的 heads `e6047096` 与 `169ea86c` 的 Release Preflight 都在 `Resolve immutable plan` 失败，日志为 `Smoke budget source changed: tests/vscode-smoke/extension-tests.cjs; regenerate and review the bounded wait inventory`；`verify-result` 和 release contract 随之报告 plan/acceptance 缺失，smoke 任务图没有执行。这是新增 smoke 源码后漏更受管 hash 清单，不是产品问题。已运行仓库生成器并复核只有源码 hash 变化，预算项不变。
- 复盘：此前将 overview Terminal 超时作为未定产品/测试归因登记在 tech-debt tracker；与 `origin/main` 对照后发现 PR 正是引入全节点 inert 的改动，已从非阻塞技术债条目移出，改列为合入前待修 regression。
- CI 时间观察：六轮完整 PR Release Preflight（run `created_at` 至 `updated_at`）分别为 `40840058557` 19:56、`40854227908` 19:42、`40857232877` 19:18、`40865378852` 32:21、`40874575062` 20:02、`40880877833` 20:00；中位数 19:58，均值约 21:53，最长 32:21。成功 run `40880877833` 有 157 个 job（154 成功、3 按范围跳过），最长单 job 为 webview-function 9:55；完整 run 墙钟受分批依赖和 runner 队列影响，后续按最长记录留余量等待 35 分钟再查。
- CI 观察更新：本次 run `40900971882` 对应 head `4bbed104`，从 `created_at` 到 `updated_at` 用时 39:30；154 个 job 成功、3 个按范围跳过，无失败。推送后按 35 分钟轮询时仍有 14 个 source-host job 运行，追加等待约 10 分钟后全部通过；因此完整 run 的已观察最长值更新为 39:30，后续轮询采用 40 分钟，再按状态续等。
- CI 归因与验证：文档记录 head `40b34575` 的 run `40874575062` 在 20:02 结束但失败。artifact 记录 editor generation 2 render 后 166ms 被 dispose，随后 generation 5 render，`surfaceReady.editor=false`；`waitForCanvasReady` 等待 45 秒后超时。单轮日志不能确认这是否为唯一根因；测试 helper 已改为临时 Canvas ready 后再关闭。修正 head `0a339295` 的 run `40880877833` 于 20:00 全绿，`remote-ssh-real-reopen-exit`、verify-result、Verify release contract 均通过。
- CR follow-up：reviewer 未将 manager 把操作发布到所有 root stores 列为 blocker，但指出它比“仅同 root”设计边界更宽。当前随机 node ID 下没有已确认的可见错误；保留为范围隔离 follow-up。
- 新 blocker：reviewer 确认单根/多根 Host 的 composed node ID 不同，当前跨 Host 通道原样传播 ID 会使对端节点继续可交互。根因已在 `CanvasPanelManager` 直接确认；修复采用每 root channel 上传 root-local IDs，接收端按本机单根/多根模式映射，并用 `(rootPath, sourceToken, operationId)` 隔离多 root 更新。对应 Host 回归和设计验收已补齐，静态验证通过；修复已推送至 PR #344 分支，待新 CI 验证回归。

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
- 决策：跨 Host participant channel 的 node IDs 固定使用 root-local 形式，manager 在发送端按 root 拆分 composed IDs，在接收端根据本地单根/多根工作区重新映射；远端操作身份包含 rootPath。
  理由：同一 root-local object 在单根画布不带 namespace，在多根画布带 root namespace；root-local 通道格式让两种参与者互通，root 维度也避免一项跨 root 删除的子集互相覆盖。
  日期/作者：2026-10-29 / Codex

## 结果与复盘

P1 跨 Host 同步已推送；P2 两个 constructor-bypass 初始化点均已补齐，第二处修正位于 commit `4035e1cb`，并经 subagent follow-up CR 复核。`npm run build`、`npm run typecheck` 与 `git diff --check` 在 P2 修正上通过。随后修复 overview disabled 与 deletion-pending inert 的混用。代码 head `cc61e295` 的 Release Preflight `40865378852` 全绿；之后文档 head `40b34575` 的 run 暴露 Remote SSH exit/reopen Canvas ready 超时，已调整临时 Canvas 销毁时序并同步预算清单。最新 head `0a339295` 的 Release Preflight `40880877833` 全绿：157 个 job 中 154 成功、3 跳过；Remote SSH exit/reopen、regression shards、webview-function、verify-result 和 Verify release contract 均通过，墙钟 20 分钟整。跨进程订阅、迟到加入、断线重连和 Host 退出清理仍缺用户态 Extension Host 手动验证。

旧 head `846bac2a` 的四个额外失败已有日志归因（job IDs `123334357754`、`123337059568`、`123340781398`、`123341449518`）：overview inert 回归造成 localized Stop preparation 超时；一个 Remote SSH exit/reopen 后 Webview 未完成 ready 握手；verify-result 归集 producer 失败；release contract 按规则拒绝失败的 acceptance。overview inert 回归已在 `cc61e295` 修复；Remote SSH 夹具的应用层 ready 等待已在 `0a339295` 加固，最新 run 验证通过；两个聚合门禁也已通过。

本轮单根/多根 review 修复在本地通过 TypeScript typecheck、回归脚本语法检查和 `git diff --check`；PR #344 head `4bbed104` 的 Release Preflight `40900971882` 全绿，包含三个 regression shards 和 Verify release contract。Host 回归由 CI 执行，本机未运行测试。

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
7. 本轮 review follow-up：补齐单根/多根 ID 映射和跨 root 操作隔离回归，执行适用的静态验证；推送前同步最新 `origin/main` 并 rebase，推送 PR #344 原分支后按既有 35 分钟 CI 等待约定检查新 head。

## 验证与验收

验收覆盖两个独立 Host 对同一 root 的订阅。单根 Host 与多根 Host 双向发布时，接收画布的 pending union 必须包含正确的 local/namespaced node ID；同一 operation 覆盖多个 root 时分别清除一个 root 的更新不能解锁另一个 root 的节点。并行操作中 A 结束后，B 仍保留被另一来源标记的 node IDs；新加入 Host 收到仍活动操作的快照；确认来源 Host 退出后，其他 Host 清除其操作，而 reset/timeout 不提前清除。最终节点结构仍只由现有共享画布 snapshot 提交。另须确认 Runtime Persistence 关闭时不同 Host 不互相接收 pending 消息。

P2 验收为 lifecycle-isolation bootstrap 不因 pending map 缺失而抛异常，且原 isolation assertions 仍成功。代码改动完成后按本次工作授权执行必要的定向自动化验证、build/typecheck；最终状态应在 PR 最新 head 上记录。手动 Extension Development Host 验收若本环境不可启动，须说明缺口，不声称已验证。

## 幂等性与恢复

订阅连接是瞬态资源。创建连接的一侧负责重连；接收方在连接关闭后先核对同 root participant 记录和 listener，reset/timeout 时保留 pending 状态，确认参与者离开才清除来源状态。Host dispose 时关闭 channels 并清理自身持有的远端来源映射。对同一 operation 的重复 snapshot/update 必须幂等。协议错误关闭 channel，但不直接解锁来源状态。`CanvasPrototypeState`、canvas snapshot schema 和 Runtime Persistence 数据无迁移。

## 证据与备注

初始 review 证据来自 PR head `846bac2a5e58d56c00d01002c46fdc054d5463ba`。shard-2 首次失败的精确报错为 `TypeError: Cannot read properties of undefined (reading 'values')`，调用链从 `bootstrapInteractiveSurface` 到 `publishNodeDeletionPendingState`。

## 接口与依赖

无需增加外部依赖。预期内部接口包括 participant 层的 pending operation 发布/订阅或等价 API、root store 上转发 pending 更新的 callback，以及 manager 侧按 `(source token, operation ID)` 管理远端操作的状态。具体 TS 签名在实现后记录；TCP 消息只属于同 root participant 协议，不加入 `common/protocol.ts`，因为它不面向 Webview。

更新说明：2026-10-29 基于 PR #344 的 P1 跨窗口状态丢失与 P2 regression fixture 未初始化字段创建本计划；先完成这两个确定性问题，再按用户要求归因其余四个失败 CI 检查。
