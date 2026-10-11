---
title: 双窗口删除 Agent 后原窗口终态未收口调查
decision_status: 比较中
validation_status: 已验证
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-two-window-agent-delete-investigation.md]
updated_at: 2026-10-11
---

# 双窗口删除 Agent 后原窗口终态未收口调查

## 问题与范围

两个 VS Code 窗口挂接同一 live-runtime Agent，attacher 窗口删除节点后本地消失，owner 原窗口仍为 waiting-input、liveSession:true 且保留 runtimeSessionId。用户已取消 0.26.1 发布准备，本调查从 `origin/main` 的 `a39cd8c19a93b87a14823fceee186499a212eb26` 独立开展，只交付原因、复查工具与修复边界。`已验证` 指下面具名 Supervisor 因果实验，不表示产品已修复或重新完成真实双窗口验收；正式修复方案仍在比较中。

## 已有真实失败证据

输入来自发布准备分支 `a283ef3d` 的隔离双窗口运行，产品实现与上述 main 相同，fixture 已串行等待 Agent live 后创建 Terminal，并使用新 debugRoot。原始工件在 `/tmp/d26lrest3/two-window-shared-runtime/`，另有 `.debug/release-0-26-1-latest-main-e6b9f39c/two-window-owner/` 备份。这些本地文件不提交；关键事实如下。

Agent 节点为 `agent-1-e4d67bc9-a86e-4d3a-9ee7-9d6b85ba4e9b`，runtime 为 `d5267588-5369-445a-b7e0-e6f61001d1ab`。双向输入输出和 resize 已成功；attacher 先停止 Terminal，owner 看见 Terminal 收口，再删除 Agent。`shared/attacher-deleted-agent.json` 为 `{ "ok": true }`。owner 在原 30 秒终态断言超时，快照仍有 waiting-input/liveSession:true/原 runtimeSessionId。owner Supervisor 工件显示 pendingRuntimeSupervisorOperationCount=0、root storage registry sessions=[]，但 bindings 仍有该 Agent。故会话删除已发生，失败是其他窗口投影未收口；空 registry 本身不能推导正常退出码、EOF 或最终保存成功。

原断言在 `tests/vscode-smoke/two-window-shared-runtime-tests.cjs:174` 要求 stopped、snapshot-only、history-restored、liveSession:false 和无 runtimeSessionId，应保留。不能用节点本地消失替代其他窗口的终态验收。

## 确认的通知丢失链路

`panel/CanvasPanelManager.ts` 的 `subscribeRuntimeSupervisorTerminalStream` 在当前 Supervisor 能力允许时使用 `hostOutputCredit: journal-pages-v1`，相应订阅类型为 `terminal-host-credit`。Host 同时依赖该通道的 `sessionTerminalBatch.snapshot` 接收生命周期变化，`handleRuntimeSupervisorTerminalBatch` 将其传给 `handleRuntimeSupervisorState`，再进入 `applyCompletedRuntimeSupervisorSnapshot` 保存并清除 live 绑定。

直接删除活跃节点走 `terminateExecutionNodeForDeletion`（CanvasPanelManager.ts:20586 附近），其严格删除请求不携带 preserveTerminalReads。`supervisor/runtimeSupervisorMain.ts:2015` 的 `deleteSession` 首先遍历所有 socket 的 hostOutputSubscriptions，取消匹配 session 的订阅；并不限于请求删除的窗口。`cancelHostOutput`（:1756）还从 subscriptions 中移除该 socket 的 terminal-host-credit 条目。

owned execution 随后停止、完成 tracker/journal 最后结算并在 `finalizeOwnedExecution`（:2240 附近）广播 `sessionState`。但是 `broadcastToSessionSubscribers`（:3109）只遍历仍存在的订阅；terminal-host-credit 原本通过 `updateHostOutput` 把状态转换为有消费回执的 batch。原窗口条目已移除，既没有独立 sessionState，也没有含终态的 batch。最终 `finishSessionRetirement` 可以移除会话，原窗口的连接本身仍可存在，因此不能指望 socket 断连代替终态通知。

这是原窗口未收口的充分原因：上游删除所有窗口的唯一生命周期递送通道。并非删除 RPC 必须失败，也不是原窗口等待时长过短。当前调查没有发现足以把失败归因于 Webview 渲染或 startup quota 的证据。`git log -L` 将该取消循环追溯到 `52ff49bc`（2026-09-28，Host 消费信用输出传输）；这是代码引入点，不是已完成的历史版本端到端二分。

## 当前 main 上的受控验证

在仓库根运行：

    node scripts/diagnostics/investigate-two-window-agent-delete.mjs

脚本复用 `scripts/test/test-supervisor-execution-owner-wiring.mjs` 的受控 owner、scheduler 与 socket fixture，打包当前真实 RuntimeSupervisorServer，而非重新实现状态机。原生加载、真实监听和子进程获取由既有 fixture 拒绝。一个 socket 发出删除，另一个 socket 持有订阅与独立 terminal reader；实验显式提供进程结束、sourceEnd 和资源释放事实，确保不会把 provider 未停止混入通知问题。临时脚本会清理，产品源文件和原测试不修改。

每种模式分别执行 Agent / Terminal，共 8 项，全部通过诊断预期：

| 模式 | 删除成功 / 会话移除 | 另一窗口终态事件 | reader 结果 |
| --- | --- | --- | --- |
| 直接删除，Host 消费信用 | 是 | 0 | cancelled=1 / applied=0 |
| 直接删除，旧 paged-until-exit 订阅 | 是 | 1 | cancelled=1 / applied=0 |
| 先停止并应用最终页，再保留式删除，Host 消费信用 | 是 | 1 | cancelled=0 / applied=1 |
| 直接删除，诊断中仅阻止取消另一 socket 的 Host 输出订阅 | 是 | 1 | cancelled=1 / applied=0 |

最后一项只在内存中的 fixture 对 `cancelHostOutput` 做诊断干预，在最终 ACK 前恢复原方法。其他停止、读者取消和删除逻辑均沿用当前实现，证明保留通知通道足以恢复终态递送，但它仍取消 terminal reader，不能作为正式修复。脚本断言 `direct-credit` 收不到终态是锁定本次缺陷的诊断预期，不是产品正确行为回归标准；修复后应更新/退役该诊断并增加要求完整收口的正式测试。

## 修复候选与验收边界

优先候选是分离删除请求窗口的本地关闭责任和其他窗口的最终消费责任：关闭新读者/输入准入，停止原执行，但对仍挂接的其他窗口保留最后 batch、terminal reader、最终快照和真实结算所需 journal，直到有界结算后再物理退役。现有 preserving-delete 支持已停止会话保留消费责任，可作为接口比较输入，不能直接对 live 会话传 preserveTerminalReads，当前 Supervisor 会拒绝。

另一候选是独立可靠的删除终态通知，但仅补 sessionState 不足以保证完整终端状态；必须说明 Host 如何取得尚未消费的尾部、保存并结算 reader，且不能在 journal 被删除后强造成功。暂不选定新协议、超时预算或 tombstone 格式。简单把删除前 cancel 全部删掉也不是完整方案：需覆盖慢窗口、关闭窗口、未 ACK、reader cancellation 与资源退役。

后续修复至少需要实际两窗口同一 runtime 输入/输出、resize、另一窗口直接删除 Agent 后 owner 的原严格终态断言；Terminal 直接删除也应覆盖，现有 smoke 只有 Terminal stop，不能由此宣称 Terminal delete 健康。增加多 socket Supervisor 回归与 Host 最终保存/失败保护测试，并核验 journal 不在其他读者完成前删除、超时不能宣称 applied、同 runtime reconnect 不重开输入准入。

## 验证限制与当前结论

本轮确认当前 main 上的跨 socket 通知丢失及其因果；未运行新的完整 VS Code 双窗口 smoke、未运行完整 npm test、未构建新 VSIX、未复测跨平台或 systemd。已有真实失败保持为输入，不追认为本轮新结果。受控实验未驱动真实 Host/Webview 最终保存，故诊断恢复一个事件不代表修复成功。产品实现未变，版本仍沿用 main；问题需在独立修复任务中处理。
