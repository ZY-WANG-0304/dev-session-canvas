---
title: 同一执行会话的完整恢复与订阅责任
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/runtime-restore-subscription-fix.md]
updated_at: 2026-10-24
---

# 同一执行会话的完整恢复与订阅责任

## 问题与现象

多个入口可同时恢复同一持久化会话。任务 A 完成 attach、快照应用和输出订阅后，等待 client 的任务 B 才继续。B 的 deferred attach 先让 Supervisor 撤销 A 的订阅；Host 在回包后发现会话已经 attached-live，丢弃 B 的结果，未再订阅。连接仍在，普通断连恢复不会触发。

用户可见结果是输出或状态不再更新，Stop 后长期显示 stopping/live。原生受控对照已经确认原 PTY 在 8–12ms 内退出、Supervisor 为 closed，Host 在原 30 秒期限内仍未得到终态。历史首败缺现场，不能唯一归因；完整证据及局限保留于 `legacy-supervisor-stop-timeout-investigation.md`。

## 候选方案与取舍

| 方案 | 能解决什么 | 局限与取舍 |
| --- | --- | --- |
| 仅在 attach 前检查 reattaching | 拒绝一部分已经过时的普通恢复 | client 内还有异步等待；快照已应用而订阅未完成时，调用者仍可能提前认为恢复结束 |
| 同身份共用完整任务，并在 RPC 派发前重验 | 从源头合并重复恢复，覆盖半完成状态和等待期间失效 | 需要覆盖普通恢复、页面恢复及断连恢复，明确共用失败和任务退役 |
| Supervisor 原子交接订阅或增加恢复代次协议 | 可以让服务端判断旧请求的副作用资格 | 涉及 wire 协议、旧 Supervisor 兼容及更多读者顺序验证，本次范围更大 |
| 丢订阅后轮询/重订阅或延长 Stop 等待 | 可能掩盖部分停滞 | 无法阻止旧任务继续撤销新订阅，可能破坏游标和真实失败反馈，不作为根因修复 |

选择第二项。既有本地组合候选可提供实现参考，但本分支独立收口和验收。

## 正式方案

`CanvasPanelManager.ts` 的恢复任务以 node/kind 为登记位置，以完整 backend/storage/session/owner/root 绑定和现有执行操作令牌判断是否同一有效任务。在等待 client 前同步登记，共用任务覆盖 attach、快照应用与订阅；后到调用先查有效任务，再判断 metadata 是否已 attached-live。不同身份不能复用。成功只表示本轮所需恢复已完成，不永久缓存成功 Promise。

`attachPersistedRuntimeSession` 只让主任务取得操作令牌；重复调用共用其结果。attach、快照或 subscribe 的失败必须传给全部等待者，并保留现有原绑定错误投影。旧任务完成时仅能移除自己的登记。节点删除/替换、现有 Host 准入关闭、已离开共享 root 或实际断连后，旧任务不得派发或写回。

`requestRuntimeSupervisorSessionAttach` 和 `subscribeRuntimeSupervisorTerminalStream` 将资格检查传入 `runtimeSupervisorClient.ts`。client 等待连接后、实际发送 attach/subscribe 前再次核验。结果应用和异步快照/订阅边界也继续验证原身份与任务责任。普通恢复从 reattaching 变为 attached-live 不取消它自身尚未完成的订阅责任。

`reconnectPagedRuntimeSession` 与页面恢复共用该任务入口，保留实际断连后从 consumed cursor 恢复、游标已压缩时显式重建和已有失败处理。断连使旧恢复失效，新代次可以合法恢复；旧任务不得误删新登记。Supervisor deferred attach 的既有快照/实时输出顺序保持，完整绑定、操作令牌、旧回调保护和 Stop 期限保持。

首次恢复在本地 managed session 建立前断连时，不能只把任务标成 ignored：此时没有既有分页会话替它安排恢复，节点会永远显示 reattaching。`handleRuntimeSupervisorDisconnected` 为该任务保留原连接错误并投影 history-restored，全部等待者得到同一失败；已存在的分页会话继续由原重连流程负责。此边界由本次新回归先红后绿验证。

本次不改变模式切换删除前的回调准入或保存边界。该独立缺陷仍由 `runtime-shared-root-canvas-sync.md` 跟踪；不能声称此次恢复修复关闭所有模式切换交错。

## 验证与当前状态

Node 22.23.3/Linux 的当前实现已通过完整 `test:runtime-supervisor-protocol`、类型检查、Host 634/634 和生产 build。真实 socket/PTY 回归只延迟重复恢复的 client 获取：原 main 22998ff4 已有订阅在迟到恢复后消失，修复后单次/并发均保持订阅、真实输入输出、独立进程退出、Supervisor closed、Host closed 和 consumed ACK。回归已接入默认协议链，快照投影和 UI 通知仍是受控边界。

固定 VS Code 1.142.0 的原 `legacy-supervisor-upgrade` 完整具名场景退出 0，原 Stop 与 30 秒业务断言保持；没有在这次 GUI 运行注入迟到时序，因此它是自然原生回归，受控迟到的修复前后证据来自上述实际 Host/socket/PTY 测试。

首次 Host 全套与协议链并行时，原 PID 等待用例超过其原 3 秒期限；随后同输入单项和串行全套 634/634 通过，未延长期限，原因仍未确认。VS Code 日志有 watcher ENOSPC 警告，具名场景最终通过。依赖、六目标资产和 VS Code 缓存均复用既有输入，build 按原规则校验原生资产；不称为冷安装或新的六平台产品验收。

命令、日志摘要与本轮文件 hash 见 `docs/references/runtime-restore-subscription-fix/result.json`。正式 CI/复审、剩余模式切换缺陷以及 PR327 最新正式预合并完整验收仍分别待收口，状态保持验证中。

## 判断修复成立的标准与证据边界

当前结论限于同一 Host、同一有效执行绑定的重复恢复及已覆盖的失效交错。任务在 client 获取前登记，并一直保留到订阅完成；因此迟到的同身份调用没有第二次 deferred attach 可以撤销已有订阅。client 在连接等待结束后到 socket 写入之间同步检查资格，避免等待期间失效的请求再次派发。已经发出的请求不能靠此检查撤回，仍依赖既有结果身份保护、连接代次和服务端顺序；本次没有新增服务端恢复代次协议，也没有证明所有跨窗口/跨进程交错。

判据不是 GUI 偶尔不超时，而是以下可失败的行为约束：

| 检查 | 失败如何判定 | 当前证据 |
| --- | --- | --- |
| 迟到重复恢复 | 首次订阅存在，第二次恢复后消失 | 原 main 真实 socket/PTY 确定失败，修复后通过 |
| 完整恢复责任 | 快照已应用但订阅尚未完成，等待者提前成功 | Agent/Terminal 受控异步边界回归通过 |
| 资格失效 | 连接等待期间删除、替换或关闭后仍派发旧请求 | Host 与实际 client 方法回归通过 |
| 失败与新代次 | 等待者丢失错误、旧任务删除新登记或首次断连永久 reattaching | 共同失败、首次断连、连续断连和任务清理回归通过 |
| 用户结果 | 原进程退出但 Host 收不到 closed，或输出未消费 | 真实 I/O、独立 PTY exit、Supervisor/Host 终态与 consumed ACK 通过 |

PR336 初始 head `d7496a99` 的 CI `40094803396` 在 regression shard-2 失败。`test-execution-output-sequence.mjs` 的两条源码正则分别限定独立 `if (!snapshot.live)` 和没有其他清理语句的 `finally`，与本次合并准入条件、登记清理的实现写法不匹配。相应要求已移到 `test-runtime-legacy-reconnect.mjs`，直接调用实际 Host 方法：结束态/失效不订阅、正常会话订阅、完成快照不补订阅，以及共享恢复成功/失败/忽略后才复核 client 退役，共新增 13 例。两个定向命令通过；分别移除结束态保护和退役回调的内存变体均使行为回归失败。没有删除行为要求或更改生产代码来适配正则。证据见 `docs/references/runtime-restore-subscription-fix/followup.json`；初始证据文件继续对应初始 head，不用新结果覆盖旧失败。

该 CI 的 source-host 原 `legacy-supervisor-upgrade` 场景已通过，但整轮未通过，更新后的 PR head 仍需正式 CI/复审。自然 GUI 没有注入迟到时序；多 root、跨平台产品行为和最终 PR327 完整验收不能由当前受控回归代证。
