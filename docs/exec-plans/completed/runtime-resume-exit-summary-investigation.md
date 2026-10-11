# 定位 Runtime 恢复退出摘要丢失

本计划按 `docs/PLANS.md` 持续维护。本轮仅定位 PR314 的下一个 smoke 阻塞，不修改正式产品行为或放宽断言。

## 目标与全局图景

解释为什么 RuntimePersistence 开启时，Agent 手动恢复并运行后以 23 退出，节点 status=error、lastExitCode=23，但 summary 为 Session ended.。区分实际退出信息丢失、终态投影覆盖、测试观察时机或旧文案断言，给出有证据的修复边界。

## 进度

- [x] (2026-10-10) 复核 438ac68b 基线与上一轮正式失败工件。
- [x] (2026-10-10) 确认 owned Supervisor 普通 EOF 终态遗漏消息生成，c1b6bc8b8 引入，08fa33725 默认接入。
- [x] (2026-10-10) baseline/probe/control 三个原生场景完成，保留原会话、发布事实与断言前 Runtime 开启证据。
- [x] (2026-10-10) 同步设计、索引、原则、技术债及精简证据，归档定位计划；PR314 更新内容已准备。

## 意外与发现

原用例在 finally 关闭 Runtime，因此最终失败快照中的 snapshot-only 不能代表发生退出时的模式。断言前取证确认 Runtime 开启。probe 显示原 session 的 processResult=exited/23、source=eof、AuthorityResult=applied，resumePhaseActive=false，消息在 Supervisor 发布前已缺失。

## 决策记录

2026-10-10：先读原失败消息和正式调用链，再使用复制后的测试入口跑原函数；如需探针，仅对隔离副本插入只读记录，保留无探针复现和产品 SHA。不得把包装预期失败的 exit 0 当成正式 smoke 通过。

2026-10-10：加入仅在隔离副本针对 EOF/已恢复/exit23 补 descriptor 与 fallback 的 control，保持其他产品逻辑和原断言，验证缺失消息是直接原因；这不是正式修复，不扩展为全部退出语义验收。

## 结果与复盘

已定位为产品 owned 退出描述遗漏，原测试预期有效。原生无探针和只读探针复现，单独补退出消息的隔离副本使原函数通过；正式产品及测试未改，完整 gate 仍阻塞。隔离节点停止，无本轮 Supervisor 残留。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs` 的 `verifyLiveRuntimeResumeExitClassification` 发送 resume、burst 1、exit 23，期待恢复完成后的失败为 error 并保留退出摘要。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 接收 Runtime 事件并更新节点；`runtimeSupervisorLocalization.ts` 翻译 Supervisor 的结构化消息。原工件在 `.debug/runtime-scrollback-snapshot-fix/trusted-artifacts/`，基线为 `438ac68b58c51d309af8e94739925a1973c9fdb8`。

## 工作计划

第一里程碑按原 node/session 收集 host 消息、状态更新和诊断，追踪 exit message 从 Supervisor 到节点摘要的生成/清理顺序；用 git blame/log 确认首次改变相关逻辑的提交。第二里程碑保留正式函数的动作与断言，使用既有 VSIX smoke-host 和 fake provider 原生复现；以受控观察验证假设，不修改正式源码。最后把事实、归属和未验证边界写入正式设计。

## 具体步骤

工作目录 `/tmp/dscr`。恢复 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers` 两个依赖链接后，使用 Node 22 与 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`、`DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`，通过 `xvfb-run -a node docs/references/smoke-reload-autostart/runtime-resume-exit-summary-investigation.mjs` 运行定位。脚本从 `.debug/vscode-vsix-smoke/smoke-host` 复制隔离宿主，保存新工件，结束停止本轮节点。

## 验证与验收

需要能指出首次摘要偏离发生在哪个函数、输入数据是否仍含 code/message，以及测试读到的是否为原执行终态。原生复验必须记录具体原身份、Runtime 开启事实和退出前后状态；引入历史只到可证实提交，不猜受影响发布版本。

## 幂等性与恢复

所有原生测试使用隔离目录，可重跑；停止原 session 并确认本轮 Supervisor 退出。依赖链接使用后移回 `.debug/rca/`。不动原发布工作区，不合并或发布。

## 证据与备注

先前错误：verifyLiveRuntimeResumeExitClassification:10666，期望 /exit(?:ed with code| code) 23/，实际 Session ended.。这仅是症状，不作为根因。

本轮修订：定位结论由三场景原生证据收口，正式结论见设计文档；精简证据为 `docs/references/smoke-reload-autostart/runtime-resume-exit-summary-evidence.json`。隔离输入/消息/探针留在 `.debug/runtime-resume-exit-summary/`，后续正式修复需保留退出信息优先级和原保护。
