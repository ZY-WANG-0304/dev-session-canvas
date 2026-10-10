# 修复本地 Agent 恢复启动失败终态

本 ExecPlan 按 `docs/PLANS.md` 持续维护。用户授权在 PR #314 修复 snapshot-only 本地执行漏掉 resume-failed 的问题。

## 目标与全局图景

Codex/Claude 以恢复模式启动、恢复尚未完成就异常结束时，应展示恢复失败并保存原因。正常退出和主动停止仍为 stopped；已恢复至 running/waiting-input 再失败仍为 error 并沿用异常退出提醒。执行保存及原 reader 结算不改变。

## 进度

- [x] 2026-10-10，核对原生失败及新旧终态处理；缺口是未使用 resumePhaseActive。
- [x] 增加真实恢复模式回归，修前 error != resume-failed 明确失败。
- [x] 补回分类与错误字段，14/14 定向回归通过，覆盖两 provider 的恢复期失败、信号、正常退出、停止、输入/提示完成恢复及未知结果。
- [x] 完整 Host 409/409、类型检查、默认 VSIX 两具名阶段通过；trusted 已通过恢复失败，保留后续终端拖放阻塞。
- [x] 同步设计、索引、核心原则、技术债与证据，随本次修复提交更新 PR #314。

## 意外与发现

`persistNonNativeHostFinal` 只区分 stopped/closed/error；`startNonNativeHostExecution` 已设置 resumePhaseActive，但最终保存未消费它。原生 Claude 恢复夹具退出 33 已保存且 reader 已结算，节点却为 error，lastResumeError 缺失。旧路径通过 `describeAgentResumeFailure` 生成 provider、退出事实与正文摘要；该 helper 实际只依赖 AgentCliSpec.label。

## 决策记录

2026-10-10：沿用原停止优先级，在非正常结束且原 Agent business.resumePhaseActive 为 true 时选择 resume-failed。消息复用现有 helper，将参数收窄为 label；不新增退出协议或构造旧 session。最终快照同步保存 lifecycle、summary、lastExitMessage、lastResumeError，普通 Agent 终态清除旧恢复错误。

2026-10-10：原本地 business 投影清除上一轮 lastResumeError，使新尝试不显示陈旧错误。原执行身份和 metadata 校验、严格最终保存、正文不完整信息及通知策略继续生效。回归从真实 startAgentSession(...resumeRequested=true) 进入恢复阶段，再经写入或 prompt 观察退出恢复阶段，不直接伪造恢复标志。

## 结果与复盘

恢复失败修复完成；14 项定向回归、完整 Host 409/409 和类型检查通过。默认真实 VSIX 两个具名阶段及整个异常通知函数均通过，含 Claude 恢复失败及新增错误字段一致性断言。完整 trusted 随后在终端拖放文件路径等待超时，诊断 missing-session；实际原执行输出缺少路径，源码拖放入口只认识旧 session map，同时 smoke 仍等历史 recentOutput。这是后续独立接线/断言问题，已保存现场并登记技术债。smoke 保留 resume-failed/no-attention 原断言，并增加 lastResumeError、summary、lastExitMessage 和恢复身份一致性检查。保留 `.debug/exit-notification-fix/trusted-artifacts` 的首次失败；本轮不得将具名通知通过写成完整 smoke 通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 管理本地执行。business.resumePhaseActive 表示 provider 恢复尚未达到可用阶段；输入确认或正文提示进入 waiting-input 时会清除此标志。`persistNonNativeHostFinal` 消费确认过的 process/source 与最终终端，严格保存原节点。`scripts/test/test-host-execution-owner-wiring.mjs` 加载原 Host/owner/adapter，仅 transport 可控。`tests/vscode-smoke/extension-tests.cjs` 的异常通知函数后段以 fake Claude 模拟恢复启动退出 33，原断言等待 resume-failed 且无提醒。

## 工作计划与里程碑

第一里程碑扩展可控启动夹具，实际传入恢复 session identity 和 resumeRequested，验证失败状态及最终保存；修前应因 error 不等于 resume-failed 失败。第二里程碑补回分类、复用消息和恢复错误字段；Codex/Claude 分别覆盖恢复期非零退出、信号退出、正常退出、主动停止，以及通过输入/提示完成恢复后异常退出。第三里程碑运行完整 Host 与类型检查，再用当前资产打包运行默认 VSIX，保留全部原断言并增加恢复错误保存一致性检查。

## 具体步骤

目录 `/tmp/dscr`；临时从 `.debug/rca/` 移回 node_modules 和 playwright-browsers symlink，使用 Node 22.23.3。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='owned resume final' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke

日志放 `.debug/resume-failure-fix/`，精简证据放 `docs/references/smoke-reload-autostart/resume-failure-repair-evidence.json`。

## 验证与验收

恢复阶段失败保存 resume-failed、退出码/信号、正文和 lastResumeError，且不发运行期异常通知；正常停止仍 stopped，恢复完成后失败仍 error 并通知，lastResumeError 不残留。原执行及 metadata 失配、未知 process 与保存失败保护保持原样。真实 VSIX 应通过原 Claude 恢复失败断言；后续若有独立失败须保存现场并明确门禁范围。

## 幂等性与恢复

不触碰原发布工作树，不改版本、不发布、不合并。提交前停放依赖 symlink；推送前 fetch/rebase origin/main，保留远端已核验 head，不覆盖别人修改。

## 证据与接口

无新依赖。仅收窄 describeAgentResumeFailure 的输入，增加本地终态分类与 metadata 更新；RuntimePersistence 开启的 Supervisor 路径不改。

修订记录：2026-10-10，建立本次恢复失败修复计划，明确分类优先级和验证边界。

修订记录：2026-10-10，完成最小分类修复及 14 项正式回归，开始完整验证。

修订记录：2026-10-10，完成全部验证；恢复分类已修复，终端拖放遗漏及旧断言保留为后续阻塞；计划移 completed。
