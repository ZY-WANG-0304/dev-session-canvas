# 修复本地 Agent 异常退出通知

本 ExecPlan 按 `docs/PLANS.md` 维护，覆盖 PR #314 用户授权的异常退出通知修复。

## 目标与全局图景

关闭 RuntimePersistence 时，已进入 running/waiting-input 的 Codex/Claude 非主动以非零码退出，应保存 error 与退出码、设置节点提醒，并按当前渠道发布通知。正常退出、主动停止、未进入运行态及禁用信号不得误报。退出保存不能等待外部通知投递。

## 进度

- [x] 2026-10-10，复核诊断证据与原执行最终保存及通知策略。
- [x] 补充正式应通知回归，修前 attention 为 undefined、应为 true 的断言失败。
- [x] 接回原通知策略，19/19 定向测试覆盖保存、去重与失败隔离边界。
- [x] 完整 Host 395/395、类型检查与 notifier source 通过；默认 VSIX 原退出通知检查通过，保留后续恢复失败状态分类阻塞。
- [x] 同步设计、索引、核心原则、技术债和证据，随本修复提交更新 PR #314。

## 意外与发现

最终保存已生成 error/退出码，却没有调用通知入口；原策略依赖退出前业务状态。当前入口的参数要求完整旧 session，但实际仅使用通知上下文，不需要 process 对象。提醒 setter 默认另行保存和发布状态；最终保存调用方需要合并这次同步，避免漏存提醒或多次保存。正文覆盖抑制诊断原先被 detail.reason=process-exit 覆盖，修正固定字段顺序后保持 covered-by-abnormal-stream。通知展示 promise 原先未捕获拒绝，补充独立失败诊断且不等待用户关闭提示。测试中保存完成并不等于 reader 已确认；通过真实 Host reader 完成入口确认后，异步投递仍未完成的执行也能退休。

## 决策记录

2026-10-10：将通知入口参数收窄到所需的 sessionId、provider、stopRequested、lifecycleStatus、显示标签和通知状态；新本地路径传原 executionId、owner stopRequested 与 business 状态，复用所有既有策略。增加可选的延后状态同步选项，仅最终保存调用方使用，由原最终快照保存及 postState 承担同步。普通调用默认行为不变。

2026-10-10：仅在原身份、metadata、process/source/finalRevision 验证通过且提交标记设定后调用通知入口。入口首次 await 前同步设置提醒，随后原最终保存立即执行；通知 promise 独立捕获失败，不能变成保存失败。重复终态由既有 submitted/result 防护；迟到投递不再写节点状态。

## 结果与复盘

本地 Agent 异常退出通知修复完成。19/19 定向回归、完整 Host 395/395、类型检查和 notifier source 验证通过；默认 VSIX 的 owned reconciliation 与 local execution flow 通过，trusted 已通过 Codex 27、信号关闭后 29、正文通知及 Claude 33 的通知断言。完整命令随后在 Claude 恢复启动失败等待 resume-failed 超时，实际 error/33、attention=false，原执行已保存/退休。本轮未修改该独立状态分类或断言，已登记技术债；完整门禁仍失败。诊断的 4/4 与本修复结果分别记账。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `persistNonNativeHostFinal` 在确认原执行身份及输出尾部后更新节点并做严格最终保存。`markAndNotifyAgentAbnormalInterruption` 检查运行态、非主动非零退出、信号开关和正文通知覆盖，设置 attention 并发布。`setExecutionAttentionPending` 承担节点标记；它的普通行为不能改变。`scripts/test/test-host-execution-owner-wiring.mjs` 加载原 Host/owner/adapter，transport 边界可控，不启动真实进程。`tests/vscode-smoke/extension-tests.cjs` 的 `verifyAgentAbnormalInterruptionNotifications` 使用 fake Codex/Claude 和真实原生 provider，检查 Codex 27/关闭信号后 29、Claude 33、提醒和通知。

## 工作计划与里程碑

第一里程碑增加正式本地退出测试：通过原输入写入进入 running，再提交退出和源终结，断言实际 workbench 调用及最终快照提醒。在未修改产品时运行并保留失败。第二里程碑接回共享策略，覆盖正常/主动停止、等待输入、未运行、信号关闭、正文覆盖、重复/旧记录、异步投递失败及保存失败，确保通知不阻塞结算。第三里程碑运行完整 Host、类型检查及默认 VSIX smoke，保留首次失败工件并同步实际覆盖范围。

## 具体步骤

在 `/tmp/dscr` 使用 Node 22.23.3；临时将 `.debug/rca/node_modules` 和 `.debug/rca/playwright-browsers` 移回原测试路径，完成后停放。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='owned abnormal exit' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke

测试日志保存到 `.debug/exit-notification-fix/`，将精简结果归档到 `docs/references/smoke-reload-autostart/exit-notification-repair-evidence.json`。

## 验证与验收

原退出码、error 状态和最终正文不变；非主动退出只产生一次异常退出通知，最终保存带 attention=true；正常退出/停止/禁用不通知。通知未完成或失败时原执行仍保存/退休，失败有独立诊断。旧 metadata、身份或节点被替换不能通知新节点。原生 smoke 保持通知事件、提醒和 workbench 展示断言，具名通过不能代证未跑到的完整门禁。

## 幂等性与恢复

保持专用 worktree，不触碰原发布树，不合并、不改版本或发布。诊断历史 patch 保留，不重新应用到正式回归。提交前恢复测试依赖 symlink；推送前 fetch/rebase 最新 origin/main，保留用户既有修改。

## 证据与接口

无新依赖、无新执行协议。通知上下文收窄及可选状态同步控制只用于复用旧策略；原最终保存继续负责原身份和严格持久化。未验证的系统弹窗、真实 Agent 服务、RuntimePersistence 开启和跨平台/升级矩阵明确保留。

修订记录：2026-10-10，用户授权修复后创建实施计划，明确通知状态和最终保存顺序。

修订记录：2026-10-10，完成共享策略接线与 19 项回归，补充正文抑制原因和 workbench 拒绝处理，开始完整验证。

修订记录：2026-10-10，完成全部验证与证据归档，通知缺口已收口；明确保留恢复失败状态分类为下一项独立阻塞，计划移 completed。
