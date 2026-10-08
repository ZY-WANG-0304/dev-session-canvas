# 收尾确定未获取资源的运行时创建拒绝

本 ExecPlan 按 `docs/PLANS.md` 持续维护。正式决策位于 `docs/design-docs/runtime-admission-rejection-settlement.md`。

## 目标与全局图景

Supervisor（独立托管进程）明确拒绝新执行且未获取资源时，Host（VS Code 宿主）应把 Starting/Resuming/Launching 节点改为 Error，释放原创建预留，允许用户重试或删除。断连、已获取资源、未知结果和旧 Supervisor 的普通错误仍保留原责任。

## 进度

- [x] 2026-10-08：从最新 origin/main 创建主题分支，定位固定错误字符串与普通准入错误之间的缺口。
- [x] 2026-10-08：确定带原会话身份的结构化未获取资源结果及保守兼容边界。
- [x] 2026-10-08：新增回归在旧实现失败：Supervisor 缺结果，Host 仍为 starting。
- [x] 2026-10-08：实现 Supervisor 分类、协议往返与 Host 状态收尾。
- [x] 2026-10-08：相关检查通过，同步证据与旧 Supervisor 债务，归档计划并形成可提交的 PR 改动。

## 意外与发现

现有 `withExecutionCandidateStart` 的注释称其为 typed result，实际仅匹配 `Execution start was rejected-before-acquire.` 文案。准入容量拒绝、owner 隔离、journal 准备失败并不具有相同资源语义，不能统一放开。

恢复测试首次使用虚构 Codex sessionId，被真实命令解析在 createSession 前拒绝为 resume-failed，不能验证本次边界。改用既有 fake-provider 策略并保留 sessionId，确认请求实际发送，再断言 Error、重试及删除。该夹具调整不代表真实 Codex 恢复已验收。

## 决策记录

2026-10-08：在现有错误载荷增加可选、带 sessionId 和 sessionKind 的 `createSessionOutcome: { kind: 'not-acquired', ... }`。保留 message/code/descriptor，不依赖文案判断；仅在未预留成功或准备资源清理成功后生成。原因是错误消息负责解释，资源结果负责授权收尾，两者不能互相代替。

2026-10-08：保留旧 generation，不重启已有 Supervisor；旧进程普通错误和旧固定文案不能释放新 Host 的提交记录。未覆盖的历史记录恢复继续登记技术债，不把修复向旧进程追溯。

## 结果与复盘

完成带原身份的拒绝结果、Host 结算和反向保护。Host 327/327、Supervisor 116/116、客户端 32/32、既有 Supervisor 协议回归与类型检查通过。已有旧 Supervisor 和更新前未知记录不会自动恢复；未跑安装包 UI 验收。正式设计、索引、核心信念及技术债已同步。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 的 `createSession` 先预留 owner，再准备 journal（终端历史文件），最后启动 provider（执行进程）。`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 序列化错误，`panel/runtimeSupervisorClient.ts` 在 socket 回包后重建 Error。`panel/CanvasPanelManager.ts` 的 `withExecutionCandidateStart` 持有 submitted/settled 启动记录；删除入口只要发现它就拒绝。新错误结果只结算匹配的原请求，不结算导致准入关闭的旧会话。

## 工作计划

里程碑一：扩展 `scripts/test/test-supervisor-execution-owner-wiring.mjs` 和 `scripts/test/test-host-execution-owner-wiring.mjs`，覆盖实际 createSession 错误响应及 Agent 创建/恢复、Terminal 启动、重试与删除。先观察原实现不能释放预留。

里程碑二：协议增加结果校验与往返保留；Supervisor 只在安全边界返回结果；Host 匹配原记录和节点身份后更新 Error 并清空 runtime binding。成功、失败与旧协议分别验证，避免把零资源的瞬时快照当成结算证明。

里程碑三：运行相关自动化测试和类型检查，同步设计、索引、核心信念及技术债后归档计划并提交 PR。

## 具体步骤

在仓库根执行 `node scripts/test/test-supervisor-execution-owner-wiring.mjs`、`node scripts/test/test-host-execution-owner-wiring.mjs`、`node scripts/test/test-runtime-supervisor-protocol.mjs`、`node scripts/test/test-runtime-supervisor-reader-client.mjs`、`npm run typecheck` 和 `git diff --check`。以上均已通过；新增回归先红后绿，已有保护测试保持通过。无需启动用户现有会话或制造磁盘耗尽。

## 验证与验收

受控 owner 隔离或容量满时，新请求返回带原身份的未获取资源结果且不创建 journal/provider；Host 错误消息保留 ENOSPC 原因，节点退出启动状态，启动记录及 runtime binding 清除，重试重新发起请求、删除成功。重复 session、部分 journal 失败、获取后错误、断连、未知结果、缺字段/身份错误不释放。新增拒绝测试范围为实际类与受控边界；既有协议回归另含临时独立 Supervisor、真实 socket 和 stock PTY，不冒充新 owned provider 跨平台或安装包 UI 验收。

## 幂等性与恢复

测试使用独立临时目录和受控传输，可重复执行。仅暂存本任务文件，保留工作区既有 IntelliJ、媒体与诊断文件。不重启现有 Supervisor，不热修补旧进程，不以普通错误清理历史残留。

## 证据与备注

初始证据：`withExecutionCandidateStart` 在请求前设置 submitted，普通准入错误不会设置 settled；删除入口因此仍保留原创建保护。

    旧实现 Supervisor: actual undefined，expected { kind: 'not-acquired', sessionId, sessionKind }
    旧实现 Host: actual 'starting'，expected 'error'
    Host execution owner wiring: 327/327 passed (non-native only)
    Supervisor execution owner wiring: 116/116 pure cases passed
    Runtime supervisor reader client: 32/32 non-native cases passed
    runtimeSupervisorProtocol tests passed

运行环境 Node 25.6.0。完整测试日志位于本机 `/tmp/admission-*.log`，正式结论不依赖这些临时路径。

## 接口与依赖

沿用现有 TypeScript、esbuild 接线测试与 JSON 错误协议，不新增包。协议结果必须校验 kind、非空 sessionId 和 agent/terminal sessionKind；Host 必须核对 submitted 记录的 sessionId、节点类型和当前记录，普通字符串错误不具有同等权限。

修订记录：2026-10-08 创建计划，记录实现边界与验证路径。

修订记录：2026-10-08 完成实现、回归与文档收尾，记录恢复夹具前提和实际验证范围，归档至 completed。
