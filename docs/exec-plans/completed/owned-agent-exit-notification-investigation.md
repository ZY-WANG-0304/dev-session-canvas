# 定位本地 Agent 异常退出通知缺失

本计划按 `docs/PLANS.md` 维护。用户要求定位 Agent 退出码 27 后未出现通知事件的原因；本次收口为有证据的根因和修复边界。

## 目标与全局图景

PR #314 已修复本地 resize，真实 VSIX trusted 随后在异常退出通知检查超时。需要确认失败来自退出事实、提醒策略、通知渠道还是旧测试断言。不能把普通通知桥接通过当成退出通知通过，也不能只凭最终 attentionPending=false 推断没有发过通知。

## 进度

- [x] 复核 `e872865b`、工作流与真实失败工件，定位新旧退出处理入口及通知判定。
- [x] 提取超时瞬间的退出/配置/通知事件，核对正文证据。
- [x] 用原 Host/owner/adapter 可控退出和通知正向对照验证缺口。
- [x] 同步结论、证据与技术债，归档 patch 并移除临时测试观测；随本次诊断提交更新 PR 描述。

## 意外与发现

旧本地 session 与 Supervisor 路径调用 `markAndNotifyAgentAbnormalInterruption`；新的 `persistNonNativeHostFinal` 设置 error/lastExitCode 和保存快照，但未见对应调用。受控验证确认其他回调没有承担该职责：非主动退出 27 的 Codex/Claude 均为入口调用 0 次。测试选择 workbench 且启用 agentAbnormalExit，等待事件名仍存在于正式通知发布方法。

## 决策记录

2026-10-10：复用已有真实失败，不重新跑整个 smoke 来重复等待。通过可控退出观测通知方法是否被调用，再以相同状态直接调用现有通知入口作为渠道正向对照；对照仅证明可用路径，不能冒充产品已修复。

## 结果与复盘

定位完成：snapshot-only owned 退出路径漏接异常退出通知，原退出码和最终保存正确。4/4 受控特征对照通过：Codex/Claude 非主动退出 27 自动路径不调用入口，直接调用原入口后 posted/展示/attention 均出现；正常退出 0 与主动停止后 27 仍不通知。测试通过代表缺口复现，不代表产品已修复。真实 VSIX 证据复用原失败工件，完整 smoke 本轮未重跑；原 376 项 Host 测试也未重跑。

临时测试已归档为 `docs/references/smoke-reload-autostart/exit-notification-characterization.patch` 并恢复原文件，依赖 symlink 已停放；精简原生时间线、源文件 SHA-256、四组对照及范围限制在 `exit-notification-evidence.json`。既有 esbuild node-pty require.resolve 提示不影响 4/4 结果。设计、索引、核心原则与技术债已同步。产品通知和 smoke 断言保持原样，后续修复仍须通过完整 trusted 门禁。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `persistNonNativeHostFinal` 提交本地执行终态；旧路径通过 `markAndNotifyAgentAbnormalInterruption` 判定非用户停止、运行过的 Codex/Claude、非零 process-exit，再设置 attention 并调用 `publishExecutionAttentionNotification`。workbench 发布记录 `execution/attentionNotificationPosted`。`tests/vscode-smoke/extension-tests.cjs` 的 `verifyAgentAbnormalInterruptionNotifications` 创建 fake Codex、发送 exit 27 并等待该事件。可控夹具位于 `scripts/test/test-host-execution-owner-wiring.mjs`。

## 工作计划与里程碑

第一里程碑提取 `.debug/resize-fix/trusted-artifacts/failure-error.txt` 中超时瞬间事件及最终快照，保留清理前后区别。第二里程碑在隔离 worktree `/tmp/dscr` 通过实际输入进入 running，提交原执行非零 processResult、sourceEnd 和资源释放，观测终态、保存及通知调用；以同一通知策略运行正常退出/主动停止和手动调用通知入口对照。第三里程碑将正式结论写入现有设计、索引、核心原则与技术债，归档可复跑特征 patch。

## 具体步骤

将 `.debug/rca/node_modules` symlink 暂移到根目录，使用已有 Node 22.23.3：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='exit notification RCA' node scripts/test/test-host-execution-owner-wiring.mjs

日志保存在 `.debug/exit-notification-rca/`。特征验证结束后归档 patch 并恢复测试文件，依赖 symlink 移回 `.debug/rca/`。

## 验证与验收

基于同 executionId 证明输入已接收、退出码 27 已处理且最终保存成功；明确通知入口是否调用、有无 suppression 或 posted 事件。正向对照须验证 attention 状态、事件与实际通知方法调用。区分 RuntimePersistence 关闭的实际证据与开启路径的源码审计，不扩大到全平台。

## 幂等性与恢复

不触碰原发布工作树、生产会话或系统通知。可控夹具拦截通知展示方法，仅保留调用记录。临时诊断不进入产品代码，不合并、不发布。

## 证据与接口

使用当前 Host、owner、adapter 与现有测试边界，无新增依赖。历史 resize 修复证据继续保留；本次结果单独归档，不把预期复现缺陷的特征测试通过写成门禁通过。

修订记录：2026-10-10，建立异常退出通知专项定位计划。

修订记录：2026-10-10，完成原生证据复核与四项可控正反对照，归档诊断并将修复保留为明确未完成项。
