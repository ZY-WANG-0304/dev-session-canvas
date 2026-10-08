---
title: 执行准入拒绝保留底层错误原因
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域]
architecture_layers: [适配与基础设施层, 宿主集成层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: []
updated_at: 2026-10-08
---

# 执行准入拒绝保留底层错误原因

## 问题与证据

0.26.0 现场旧会话的终端 journal 写入收到 `ENOSPC: no space left on device`，输出消费失败使共享 execution owner 进入隔离状态。随后创建只提示 `Failed to start Codex: Execution owner admission is closed`，用户无法据此处理磁盘问题。

2026-10-08 Host diagnostics 的 `09-33-06-664Z` 样本确认创建拒绝和 Starting/Resuming 残留；同一 Supervisor 的只读内存核对确认 `terminalJournalError=ENOSPC`、`blockedReason=Authority consumption failed`。原进程已退出、资源已释放，但仍有 5 帧未消费，不能将其等同于最终保存成功。原始现场证据仅存于本地 `.debug/diagnosis-owner-admission/`，本文保留必要事实，不将路径当作可移植测试依赖。

## 正式方案

本轮只修复错误原因传递和展示，使用现有错误提示渠道，不改变启动、删除、隔离及恢复语义。

`extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts` 的 `beginConsumption` 将同步抛出或异步拒绝的原始错误交给 `consumptionFailed`；错误为 `Error` 或字符串且包含非空信息时，保留到 `Authority consumption failed: <原始信息>`。无可用信息时保留原来的通用文案，不序列化任意对象或错误堆栈。该原因沿现有首次故障和 authority 隔离状态传递。

`extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts` 的 `assertAdmission` 在存在 `blockedReason` 时把它附加到准入拒绝；普通关闭且没有底层故障时保留现有提示。最终终端消费/flush 失败的隔离原因同样保留已有 `terminal.reason`。首次隔离原因不被后续关闭故障覆盖。

Supervisor 已通过 `serializeRuntimeSupervisorError` 的 `message` 返回普通错误，Host 的 Agent 创建/恢复和 Terminal 启动提示已保留该信息，沿用这些路径。例如新运行时发生磁盘错误后的提示为：

    Failed to start Codex: Execution owner admission is closed: Authority consumption failed: ENOSPC: no space left on device, open '/.../manifest.json.tmp'

同一 owner 的其他执行拒绝会报告这个首次故障，信息描述的是阻止准入的原因，不表示新节点曾尝试写该文件。现有协议、generation 和 native provider 不变；已有旧版 Supervisor 不会因 Host 更新而自动获得这段新代码，也不为更新错误文案重启旧会话。

## 删除问题的独立边界

Host 的 `withExecutionCandidateStart` 在请求发送前标记 `submitted=true`，仅对精确的 `Execution start was rejected-before-acquire.` 释放预留。此次普通准入错误使 `settled=false` 保持，candidate 错误分支只通知，不改变节点 Starting/Resuming；`terminateExecutionNodeForDeletion` 因原记录存在而拒绝删除。现场新会话没有创建成功，但当前消息协议未给 Host 可用于释放的明确结果。

后续应独立修复确定未获取资源的拒绝分类及状态收尾，并保留通信中断、已取得资源和未确认结果的保护。本轮不通过匹配更长的错误字符串解除保护。该既有缺口登记在 `docs/exec-plans/tech-debt-tracker.md`。

## 验证方法

用受控 journal 写失败覆盖原始错误到 Supervisor createSession 错误响应；覆盖 owner 同步/异步消费、final flush 和无原因关闭，以及 Host 创建/恢复/Terminal 提示保留原因。检查失败后消费信用、隔离状态和未确认责任仍保留。运行相关 adapter、owner、Supervisor、Host 接线测试与 `npm run typecheck`。不以受控测试冒充实际磁盘耗尽或安装包 UI 验收。

2026-10-08 在 Node 25.6.0 下完成验证：`test-execution-session-adapter.mjs` 105/105、`test-execution-owner-lifecycle.mjs` 54/54、`test-supervisor-execution-owner-wiring.mjs` 109/109、`test-host-execution-owner-wiring.mjs` 296/296；`npm run typecheck`、`git diff --check` 通过。新增 owner 消费错误回归先在原实现失败，实际只收到 `Authority consumption failed`，修后同步和异步路径均保留 ENOSPC 原因。Supervisor 覆盖 appendFile 与 manifest writeFile 两个真实 journal 调用点的受控拒绝；Host 覆盖序列化后 Agent 创建、恢复和 Terminal 启动的实际错误消息。测试未启动 native provider，未在用户磁盘制造满盘、修改现有画布或重启运行时。
