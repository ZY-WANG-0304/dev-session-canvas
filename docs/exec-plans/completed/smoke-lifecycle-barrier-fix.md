# 修正 smoke 的 reset 与执行退休等待

本 ExecPlan 按 `docs/PLANS.md` 维护，是 PR #314 的正式修正记录。

## 目标与全局图景

使创建预设和异常通知 smoke 按真实生命周期完成后再继续，不再因测试抢跑产生 owner admission closed 或同节点执行占用错误。验收保留 error/退出码、通知及恢复身份断言，并运行完整默认 VSIX smoke；未执行的后续场景不得视为通过。

## 进度

- [x] (2026-10-10) 核对 PR head `5859ee31` 与最新 `origin/main@78c58c2a`，确认工作树干净、上轮根因证据可复用。
- [x] (2026-10-10) 补齐四处 reset 等待及三次原执行退休等待；Claude 恢复失败后删除前也等待完成。
- [x] (2026-10-10) 语法、reset fixture 19/19、正文 helper 14/14、runner 环境检查通过。
- [x] (2026-10-10) 默认 VSIX 前六阶段通过，trusted 已通过两处修正、完整 failure paths，随后在 Stop 竞态旧字段等待中失败。
- [x] (2026-10-10) 修正 Stop 竞态实时输出等待；原顺序复跑在链接检测处失败，单独 Stop 用例确认 stopped/0 及收尾正文，仍被旧摘要断言阻断。
- [x] (2026-10-10) 同步设计、精简证据与技术债，归档实现计划；提交推送和 PR 描述收尾随交付执行。

## 意外与发现

上轮已证明：空画布早于 reset 完成；退出状态和通知早于原页面最终确认。通知复现中 persistence=saved、资源 released，但 reader pending。现有保护正确拒绝同 key 新启动。相邻两个创建命令用例也用相同异步 reset 作为准备或清理，统一等待实际完成。

## 决策记录

- 决策：一并修正原顺序新发现的 Stop 竞态旧字段等待。理由：sleeping 实时正文已输出，但 recentOutput 直到 exit 9 最终保存才更新，Stop 因而晚于进程退出；不修改停止信号或结果断言。日期/作者：2026-10-10 / Codex。

- 决策：创建命令用例的 reset 夹具直接 await `COMMAND_IDS.testResetState`，仍检查空画布。理由：该命令返回真实 reset promise；派发 Webview 消息只代表已接收。日期/作者：2026-10-10 / Codex。
- 决策：从退出前的 live/started 快照固定原执行，在再次启动、转通知模拟夹具或 seed Claude 恢复状态前等待 `waitForOriginalLocalExecutionRetirement`。理由：helper 按 executionId/generation 等原记录移除，遇到 failed/unconfirmed 保存立即失败；不删除记录或放宽产品准入。日期/作者：2026-10-10 / Codex。

## 结果与复盘

两处授权同步缺口已修正并在两次原顺序运行通过。追加 Stop 实时输出等待已确认及时停止；既有摘要断言仍失败。完整 gate 仍被链接检测及 Stop 用例契约核对阻塞，均已登记技术债；后续 Runtime 未执行。本轮不修改产品生命周期规则、版本号或发布资料，不合并 PR。

## 上下文与定向

工作目录 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。`tests/vscode-smoke/extension-tests.cjs` 中创建命令用例使用 reset 清空画布；`verifyAgentAbnormalInterruptionNotifications` 先启动 fake Codex/Claude，再输入 exit 27/29/33 检查异常提醒。原执行退休是指保存、进程/输出/资源和页面最终确认均结束，Host 移除该 executionId/generation 的记录，释放相同节点的启动位置。

## 工作计划

第一里程碑修改上述 smoke：统一四处创建流程 reset 的完成等待；捕获两次 Codex 和一次 Claude 退出前的原执行快照，在下一次变更前等待退休。Claude 恢复失败后的删除也先等待该次执行完成。运行语法、reset fixture、正文 helper、runner 环境检查，预期全部通过。

第二里程碑运行默认打包 smoke，依次覆盖 owned reconciliation、local flow、snapshot-only recovery、surface cutover、PTY robustness、preparation failure、trusted。只记录实际通过范围，若新阻塞出现保留原工件和具体失败位置，再同步正式文档及 PR。

## 具体步骤

在 `/tmp/dscr` 使用 Node 22，必要时把 `.debug/rca/node_modules` 和 `.debug/rca/playwright-browsers` 恢复到根目录。执行：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    node --check tests/vscode-smoke/extension-tests.cjs
    npm run test:smoke-reset-fixture
    npm run test:smoke-execution-output
    npm run test:vscode-smoke-runner-env
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke > .debug/lifecycle-barrier-fix/vsix.log 2>&1

## 验证与验收

创建 QuickPick 用例须在 reset 成功后创建并观测启动诊断。通知用例须保留 Codex exit 27 提醒、exit 29 抑制和全部文本通知断言；Claude exit 33 提醒后等待原退休，再 seed 和显式 resume，仍断言 resume-failed/33、恢复身份和无重复通知。完整 gate 另行判断，不能用局部通过替代。

## 幂等性与恢复

测试可重跑；默认 runner 会覆盖自身 `.debug/vscode-vsix-smoke`，重跑前复制失败工件到本轮证据目录。不要应用上轮调查用延迟、catch 重试或提前 return patch。收尾把依赖移回 `.debug/rca`，避免扫描/打包污染。推送前 fetch 并 rebase 最新 origin/main，重写时仅使用固定原远端 head 的 force-with-lease。

## 证据与备注

前置 RCA：`docs/references/smoke-reload-autostart/lifecycle-barrier-evidence.json`。本轮日志存于 `.debug/lifecycle-barrier-fix/`，精简证据已入库为 `docs/references/smoke-reload-autostart/lifecycle-barrier-fix-evidence.json`。默认前六阶段及 trusted 两处修正通过，完整 gate exit 1；最终 trusted 复跑链接检测失败。standalone Stop 入口控制 patch 随证据保存，只改入口，不更改原结果断言，预期当前在摘要断言失败。

## 接口与依赖

复用 `waitForLocalExecutionStarted(kind, nodeId)` 与 `waitForOriginalLocalExecutionRetirement(snapshot, kind, nodeId)`，不新增产品接口或依赖。需要可用的 Linux 原生执行资产、VS Code 1.141.0、Node 22 和现有 fake Agent。

修订记录：2026-10-10 创建，落实已确认的两处 smoke 同步缺口。

修订记录：2026-10-10 收口两处正式修正与追加 Stop 实时等待，保留默认/复跑失败工件；将完整 gate 的链接检测和旧 Stop 契约核对列为残余阻塞，不用 standalone 运行代证完整门禁。
