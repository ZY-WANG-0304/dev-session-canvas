# 修正 trusted 汇总诊断的观察范围

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

在 PR #314 基线 `60c1d9c4` 上修正旧 PTY 诊断断言，使默认 owned 执行的真实退出、live 快照和启动失败能够被 smoke 正确验收。验证必须绑定原执行身份，且不依赖长流程结束时诊断缓存仍包含早期事件。本轮不改产品。

## 进度

- [x] 确认原断言、现有具名用例和最终保存/读者结算接口。
- [x] 在 Agent flow、Terminal flow 和 missing CLI 用例中验证并返回证据，调整末尾汇总。
- [x] 原生专项通过缓存清空后的汇总，缺失三项证据分别被拒绝。
- [x] 默认完整 VSIX smoke 七个独立阶段、本次 trusted 汇总通过；下一处文件活动 Agent live 等待超时已留存。
- [x] 同步证据和技术债，归档计划；随本次提交更新 PR。

## 意外与发现

诊断缓存上限为 2000，末尾旧断言中的 Agent exited、live Terminal snapshot、Agent spawnError/error exit 三项不满足。owned 最终保存和页面读者结算是不同事实，不能把其中一项当作完整退出验收。

## 决策记录

2026-10-11：复用已存在的 Agent 正常退出、Terminal 输出/停止、缺失 CLI 场景，直接返回通过验证的证据给 trusted 调用者，不增加全局标志或无界诊断缓存。保留存储诊断的当前范围检查，不改变产品事件名称。

## 结果与复盘

实现、原生专项及 trusted 原序本次汇总通过。完整 gate exit1，下一处为文件活动用例第二项 Agent live 等待；本轮仅登记，未定位。产品代码与三个 bundle hash 不变，既有历史限制保留。

## 上下文与定向

工作树 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。`tests/vscode-smoke/extension-tests.cjs` 的 `runTrustedSmoke` 依次调用具名行为用例，再经过多个 Runtime 用例后调用 `verifyTrustedDiagnostics`。退出码在最终节点 metadata 中，`execution/localFinalPersistence` 按 executionId/generation 表达保存，`execution/localTerminalReaderSettled` 按执行与 surface lifecycle 表达页面最终应用，`host/executionExit` 含原执行及 finalOutputSequence。

## 工作计划

第一里程碑在行为发生时核对 started、退出码、最终保存、页面最终应用和 live snapshot，并返回精简证据。缺失 CLI 场景按专属新节点及未启动执行身份检查失败，避免对环形缓存使用旧数组下标。第二里程碑用原生 VS Code 运行原函数，在清空早期事件后仍能通过最终汇总；用缺失证据的负向检查确认不能空跑通过。第三里程碑运行完整 gate，如出现独立新阻塞则保留现场与明确覆盖范围。

## 具体步骤

从 `/tmp/dscr/.debug/rca/` 恢复依赖链接。使用 Node22 `/tmp/dsc-release-node22/node_modules/node/bin/node`，设置 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code` 和 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`。运行语法检查、`npm run test:vsix-smoke`，专项脚本位于 `docs/references/smoke-reload-autostart/trusted-diagnostics-verification.mjs`，用 xvfb 启动隔离目录。

## 验证与验收

原具名行为用例及其新增身份断言通过；早期诊断被清空后，保存的证据仍可汇总，缺项则失败。完整 gate 必须单独报告结果，不把专项成功扩大为真实新 Host、跨平台或真实 provider 验证。

## 幂等性与恢复

专项每次复制独立载荷，退出时停止自己的节点；结束归还依赖链接。不改用户原工作树或其它 Supervisor。

## 证据与备注

基线调查证据为 `docs/references/smoke-reload-autostart/trusted-diagnostics-evidence.json`，59 条事件时旧退出诊断已缺失；不是仅由容量淘汰造成。

## 接口与依赖

只调整 smoke 内部函数的返回值与汇总参数，不增加产品接口。沿用现有 started、host messages、diagnostic events、snapshot 及退休等待 helper。

初稿：固定具名验证、显式返回证据和原生缓存清空对照。

阶段修订（2026-10-11）：原生专项 exit0，Agent exit0/saved/applied、Terminal 原执行 live snapshot、缺失 CLI not-required 均已验证；清空早期诊断后汇总仍通过，缺少任一证据分别失败。正式 smoke 与 staging 的 SHA256 一致。

完成修订（2026-10-11）：七个独立阶段和 trusted 汇总通过，完整 gate 在 `verifyFileActivityViewsAndOpenFiles:3795` 超时，现场与未归因 Runtime batch 报告已登记技术债。证据为 `docs/references/smoke-reload-autostart/trusted-diagnostics-fix-evidence.json`；原生与 VSIX 进程已退出，依赖链接已归还。
