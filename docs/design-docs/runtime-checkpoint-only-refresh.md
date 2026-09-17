---
title: Runtime Supervisor 独立 checkpoint 刷新
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-checkpoint-only-refresh.md
updated_at: 2026-09-17
---

# Runtime Supervisor 独立 checkpoint 刷新

## 背景与边界

这是 `runtime-persistence-storage-reevaluation.md` 的首个实施增量，降低 F-04 的周期全量传输成本，不宣称完成有界内存、首次恢复或 F-05。当前 Host 已按连续 revision 接收 live 事件，刷新主要为了获取更新 checkpoint，不需要再次获取同一后缀。Supervisor 崩溃/机器重启后无需恢复的产品边界保持；正常运行中不丢未消费内容。

## 正式方案

`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 新增 `terminalCheckpointRefreshV1` capability 与 `getSessionCheckpoint` RPC。请求包含 sessionId、authorityId、afterCheckpointRevision；结果包含 sessionId、authorityId、revision，以及严格新于请求水位的可选 checkpoint，不包含 output、serializedTerminalState 副本或 events。水位必须为合法非负安全整数且不超过 journal revision，authority 必须匹配；错误使用现有协议错误类型。

`src/supervisor/runtimeSupervisorMain.ts` 在既有 session 操作队列中执行 `createFreshSnapshot(..., 'always', false)`，继续使用原 eligibility、flush、compact 和消费者保留规则，禁止走完整 projection 构建路径。无可用 journal、journal 失败或会话身份不符时明确失败，不提供伪快照。该调用不会订阅或取消订阅客户端，不改变 applied revision。

`src/panel/runtimeSupervisorClient.ts` 暴露 capability 检查和 RPC。`src/panel/CanvasPanelManager.ts` 的周期刷新及健康 stream 的显式刷新优先使用新接口；没有新 checkpoint 时保留 stream，不扫描全后缀、不发起全量 fallback。旧 Supervisor 没有 capability 时继续原 `getSessionSnapshot` 路径。首次 attach、gap recovery、终态 handoff 仍使用既有完整 stream 协议。

`src/common/terminalSessionStream.ts` 的 `mergeTerminalStreamCheckpoint` 只接受与 Host stream 同 session/authority 的 checkpoint，revision 不早于当前 checkpoint、不晚于 Host 已收到 revision。它验证当前 stream 连续性，保留所有新于 checkpoint 的 events，包括请求期间的新事件；不把 server 最新 revision 当作 Host 已消费水位。响应身份、顺序或连续性不满足时不修改当前 stream。Host 处理异步结果前必须核对原 session 实例仍在节点上。

这不是新的磁盘格式或第二个 server，也不放宽颜色、parser carry、OSC8 或 checkpoint 大小的校验。若校验持续失败，Supervisor/Host 当前后缀内存仍会增长；改变权威终端状态模型与 completed 存储需要后续设计和回归。

## 验证方法

纯合并测试覆盖倒退/超前 checkpoint、错误身份、gap、事件尾部及不可变输入。协议测试覆盖 capability、正常推进、拒绝状态与非法请求，并证明查询不修改订阅。容量诊断记录持续颜色状态拒绝下完整 snapshot 与 checkpoint-only 响应字节，后者在正常 UUID 下不得超过 1024 字节。定向 tracker/journal/protocol 与 Host/Webview sequence 测试继续通过；实际执行结果由关联 ExecPlan 回写。

2026-09-17 验证结果：新响应在三阶段诊断中为 98/99/99 字节，旧完整 snapshot 增至约 20.29 MB。Host 行为、真实 socket/PTY 协议、tracker/journal/sequence 和类型/构建检查通过；Linux VS Code 1.117.0 的新查询、周期刷新、Host reload、Webview marker 和正常 completed smoke 通过，旧 Supervisor 升级 smoke 通过。未重跑 macOS/Windows/Remote SSH，整体 F-04/F-05 仍未关闭，验证状态保留为“验证中”。
