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
