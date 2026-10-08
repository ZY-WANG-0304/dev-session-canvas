---
title: 确定未获取资源的创建拒绝收尾
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域]
architecture_layers: [共享模型与编排层, 适配与基础设施层, 宿主集成层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-admission-rejection-settlement.md]
updated_at: 2026-10-08
---

# 确定未获取资源的创建拒绝收尾

## 问题

#303 保留了底层错误原因，但 Host 对普通准入错误仍保留 submitted 启动记录。新会话没有创建，节点却残留 Starting/Resuming，重试和删除受阻。旧故障会话的未消费输出与新请求的拒绝必须分别结算。

## 正式方案

以下代码路径均相对于 `extensions/vscode/dev-session-canvas/src/`。`common/runtimeSupervisorProtocol.ts` 的错误载荷增加可选 `createSessionOutcome: { kind: 'not-acquired', sessionId, sessionKind }`。序列化和客户端重建均校验此字段，保留原 message/code/descriptor。字段表示该次创建没有获取执行资源，也不再持有准备存储等责任；它不表示整个 owner 健康或旧会话已结算。

`supervisor/runtimeSupervisorMain.ts` 的 `createSession` 仅在以下边界生成结果：准入/容量检查或 reserve 失败，且存在 owner、该身份没有既有 session 或 owner record；或启动前拒绝后，journal 清理与 owner 放弃均已完成。初始 profile 不匹配等参数错误不纳入此分类。已有身份冲突、journal 部分写失败/清理失败、provider 获取后失败、未知结果不生成此证明。adapter 在进入 connect 前登记 provider-control；catch 中只要出现获取记录就保留原会话并请求停止。无获取记录的路径还须等待 journal 删除并成功执行 `OwnedExecution.abandon`，后者拒绝含资源、process 或 source 事实的执行；不能单靠资源集合暂空或连接中断推断结果。

`panel/CanvasPanelManager.ts` 的 `withExecutionCandidateStart` 只对当前 submitted 记录、原 sessionId 和 kind 匹配的结果设置 settled；只在节点仍持有该次 runtime binding 时改为 error，清空 runtime 绑定、pendingLaunch、投影信息并保留错误原因与 Agent 恢复信息。随后移除该启动预留，现有重试/删除入口即可继续。后来的节点或绑定不由旧响应覆盖。

协议字段向后兼容，不升级 generation，不重启既有 Supervisor。旧进程缺少结构化结果时继续保守保护；不再把旧固定错误文案当成新资源证明。此次修复不追认更新前留下的未知创建记录，也不恢复旧故障会话。

## 取舍

匹配更长错误文案无法表达资源边界，统一清理所有 createSession 失败会误删断连后的真实会话，均不采用。可选的身份化结果把释放权限限制在 Supervisor 的明确同步拒绝或已完成清理边界，并保留原错误展示。

## 验证

2026-10-08，Node 25.6.0 下完成以下验证：

- `scripts/test/test-host-execution-owner-wiring.mjs`：327/327。新增 Agent 创建/恢复、Terminal 启动在结构化拒绝后进入 error、清空 runtime 绑定、保留恢复信息、重试获得新 sessionId、删除成功；普通错误、旧固定文案、已获取/未知值、错身份、缺字段继续保护；迟到响应不覆盖后来绑定或启动记录。
- `scripts/test/test-supervisor-execution-owner-wiring.mjs`：116/116。真实 journal appendFile/writeFile 受控 ENOSPC 后，新请求返回未获取资源结果，旧失败会话仍保留原责任；关闭/容量拒绝无新 journal/provider，准备期关闭和启动前拒绝等待清理；重复身份、部分准备失败、清理失败、获取后失败和 unconfirmed 均不返回证明。
- `scripts/test/test-runtime-supervisor-reader-client.mjs`：32/32。实际客户端从原 socket 错误回包重建结果，拒绝畸形字段并保留错误原因及 code。
- `scripts/test/test-runtime-supervisor-protocol.mjs` 通过，包含临时独立 Supervisor、真实 socket 和 stock PTY 的既有协议/终态/容量回归；这不是新 owned provider 的跨平台验收。
- `npm run typecheck` 与 `git diff --check` 通过。

新增测试先在旧实现失败：Supervisor 回包 `createSessionOutcome` 为 undefined；Host 节点实际为 starting，预期 error。新增拒绝场景使用实际类与受控边界，未在用户磁盘制造满盘，未改写现有画布或重启用户 Supervisor，未跑安装包 UI 验收。恢复夹具使用 fake-provider 策略隔离 CLI 命令解析，不把它当成真实 Codex CLI 恢复验证。
