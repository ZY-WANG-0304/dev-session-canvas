# 修复 owned Runtime 退出描述生成

本计划按 `docs/PLANS.md` 持续维护，基于 PR314 的 b46e8fff。

## 目标与全局图景

Runtime 开启时，成功恢复的 Agent 以 23 退出后，节点及页面应说明具体退出原因。owned Supervisor 当前只保存 code/signal，遗漏消息，导致 Host 显示 Session ended.。修复在 Supervisor 发布终态前生成结构化描述符及英文 fallback，并保留旧退出分类和完整性保护。

## 进度

- [x] (2026-10-10) 复核已确认根因及现有 Supervisor owner 接线测试。
- [x] (2026-10-10) 共享退出描述已接入；Supervisor 接线 134/134（新增18项）、协议完整链、本地化、typecheck 通过。新增恢复23正例在旧源码上因缺 agentExitedCode 失败。
- [x] (2026-10-10) 原生原函数及原断言完整通过，Runtime 开启，原 session 的 error/code23/具体摘要与页面消息一致。
- [x] (2026-10-10) 默认前六阶段通过，第七阶段链接HTTP尾部停滞取证后终止；原包第七阶段重跑通过，trusted 通过本条，在下一项立即 reload 遇到 pending 回调拒绝。
- [x] (2026-10-10) 同步证据、索引、原则与技术债并归档；交付内容和 PR314 描述已准备，推送由最终回执确认。

## 意外与发现

owned 的 ProcessResult 区分 exited、signaled、terminated、unconfirmed。不得把无退出码的结果伪装成 code 0；AuthorityResult.failed 也不能因为进程退出而变成正常结束。source 非 EOF 的已有输出不完整消息仍优先。

默认门禁另遇链接测试尾部 HTTP 连接残留停滞；同载荷重跑通过不追认原运行。trusted 下一项立即 reload 的失败已独立登记，不能据此把本次退出信息缺口重新归为测试问题。

## 决策记录

2026-10-10：复用旧 finalizeSession 的业务分类与描述生成，提取同文件共享函数。owned 仅在 authority applied 且进程结果已确认时生成普通退出信息；无 code/signal 的 terminated 只允许已明确停止时生成停止信息，其余保留 error 与已有失败原因。非 EOF 继续覆盖为明确输出不完整。原 smoke 摘要断言不改。

## 结果与复盘

实现与局部回归、原生原函数和 trusted 内原函数已通过。默认命令因链接HTTP服务尾部停滞被终止，同载荷链接重跑成功；trusted 下一项立即 reload 报 Runtime 更新 pending，Agent 启动被拒、Terminal live，因果待定位。完整 gate 未通过。原会话 stop 获确认，本轮隔离 Supervisor 全部退出。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 的 finalizeOwnedExecution 是新路径，finalizeSession 是旧进程路径。已有 describeAgentExit/describeAgentResumeFailure/describeTerminalExit 与 setSessionLastExitMessage 支持结构化本地化。`scripts/test/test-supervisor-execution-owner-wiring.mjs` 使用真实 Supervisor/owner 和可控传输，验证发布快照、连续输出及结算；在该文件增加退出消息矩阵。`verifyLiveRuntimeResumeExitClassification` 是正式原生验收函数。

## 工作计划

第一里程碑补共享终态分类并从 owned 和 legacy 调用，新增 Agent/Terminal 的零/非零/信号/停止、恢复阶段与已恢复、非 EOF 及失败/未知结果测试；使用原代码负对照证明新增正例确实失败。第二里程碑跑相关接线、协议、本地化、类型及原生完整函数，再运行默认 VSIX 八阶段。最后保存精简证据、清理隔离进程并更新 PR。

## 具体步骤

工作目录 `/tmp/dscr`，Node22，依赖链接从 `.debug/rca` 临时恢复。运行 `node scripts/test/test-supervisor-execution-owner-wiring.mjs`、`npm run test:runtime-supervisor-protocol`、`npm run test:ui-copy-localization`、`npm run typecheck`。原生使用 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`、`DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`，执行 `npm run test:vsix-smoke`。正式原函数保持断言，独立复验脚本放 `docs/references/smoke-reload-autostart/runtime-resume-exit-summary-verification.mjs`。

## 验证与验收

新恢复成功退出23用例须同时验证 error、code23、agentExitedCode、消息中的23、发布快照原 session；恢复未完成时应为 resume-failed。主动停止与正常结束正确，非 EOF、journal 错误、authority 失败、unconfirmed 不被正常文案覆盖。原生原函数需真实通过，不能消费预期失败。默认 gate 如有新问题单独登记，不修改无关断言。

## 幂等性与恢复

不修改版本、发布材料或原工作区。负对照使用临时编译输入，不替换正式源码。原生使用隔离目录，停止原会话并确认本轮 Supervisor 退出；依赖链接移回 .debug/rca。推送前 fetch/rebase origin/main。

## 证据与备注

根因证据为 `docs/references/smoke-reload-autostart/runtime-resume-exit-summary-evidence.json`。本次验证结果另存，不覆盖定位阶段的失败事实。

本次修订：实现、18项新增接线回归、旧源码负对照和正式原生验收完成；完整门禁两项后续现象另记，详见 `docs/references/smoke-reload-autostart/runtime-resume-exit-summary-fix-evidence.json`，本地原日志在 `.debug/runtime-resume-exit-summary-fix/`。
