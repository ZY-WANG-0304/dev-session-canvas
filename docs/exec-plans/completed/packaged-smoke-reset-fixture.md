# 修复 packaged smoke 的 Reset 收尾夹具

本 ExecPlan 按 `docs/PLANS.md` 维护。前置定位见 `docs/exec-plans/completed/canvas-reset-final-persistence-investigation.md`；本轮按用户要求在 PR #305 继续修复夹具。

## 目标与全局图景

QuickPick smoke 创建两个 Agent、shell 切换用例重启 Terminal 后，一次 reset 可能按产品契约因最终保存 pending 而中止。夹具应确认原保存结果后显式再次操作，成功时断言画布为空，保存失败时直接报告原因；不改变产品 reset、resize 或关闭策略，不延长原 20 秒上限。

## 进度

- [x] (2026-10-08) 复核原调用点与现有测试命令；`__test.resetState` 返回真实 reset Promise，消息派发命令不提供完成确认。
- [x] (2026-10-08) 增加收尾 helper 及 19 项成功、拒绝、失败、过期、重启和身份冲突回归，接入 QuickPick 与实际暴露的 shell 切换用例清理。
- [x] (2026-10-08) 第一次完整 packaged smoke 越过原 reset 与后续默认 cwd 用例，失败于相对 shell 的 execution/started 诊断等待，已保留工件。
- [x] (2026-10-08) 第二次在前置 shell 切换用例发现同类保存 pending reset，已补同一 helper 与排除重启前旧 saved 的保护。
- [x] (2026-10-08) 第三次真实 VSIX 验证：shell 清理成功，QuickPick 实际经历 pending → 两个原保存结算 → 第二次 reset 空画布；随后仍失败于相对 shell 启动诊断。
- [x] (2026-10-08) 同步正式设计、原债务和完成计划，纯测 19/19、脚本语法与 diff 检查通过；提交和同一 PR 更新作为收口动作。

## 意外与发现

现有 testResetState 成功后还会清 Agent CLI 解析缓存。QuickPick 用例在清理完成后才进入下一独立用例，可使用此既有测试隔离行为；生产接口不变。原 Webview reset 消息覆盖仍由其他 smoke 用例承担。

## 决策记录

2026-10-08 / Codex：初次和第二次均调用已有 testResetState，避免从混合的 host/error 消息猜测操作结果。只有精确匹配原新建节点的 pending 拒绝可进入保存观察，等待两个新建 Agent 的 saved/not-required；failed/unconfirmed、缺失或本次观察中出现多个执行身份均不得放行。再次 reset 最多一次，错误直接传播，全过程共用 20 秒。QuickPick 删除中途两次 clearDiagnosticEvents，完整保留本用例可能较早完成的 Agent 保存事实。

## 结果与复盘

已修复两个实际触发同类问题的清理步骤。最终真实 VSIX run 中 shell 清理一次成功；原 QuickPick reset 明确拒绝 pending，随后读取 Claude not-required 与 Codex saved 的唯一身份，第二次 reset 确认空画布。没有修改生产代码、resize、原 20 秒预算或 shell 启动诊断断言。完整 gate 随后仍因相对 shell 的 execution/started 等待失败，已单列后续债务，不宣称完整 clean-checkout 通过。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs::verifyCreateNodeCommandQuickPick` 创建具备唯一 ID 的 Claude/Codex Agent，原末尾发送 webview/resetDemoState 后只轮询空画布。`CanvasPanelManager` 的 execution/localFinalPersistence 诊断携带 kind、nodeId、executionId、generation、submitted 和独立保存结果。测试 helper 将读取这些事实而不写 Host 内部状态。QuickPick 两个新建节点不复用历史 ID；shell 切换用例会复用同一个 Terminal ID，所以 helper 在第一次 reset 前采集诊断基线，只对报 pending 的节点排除基线里已经完成的 executionId/generation，禁止旧 saved 冒充当前保存。两个调用方在清理期间均不重启节点。

## 里程碑与工作计划

第一里程碑在 `tests/vscode-smoke/reset-canvas.cjs` 实现有界清理，并以 `scripts/test/test-smoke-reset-fixture.mjs` 注入命令、诊断和时钟验证分支。第二里程碑接入原 QuickPick 清理并运行完整 VSIX payload smoke；遇到独立产品或夹具问题保留证据，不混入 resize 修复。第三里程碑按实际覆盖更新文档和同一 PR。

## 具体步骤

在仓库根使用 Node 22.23.3：

    node scripts/test/test-smoke-reset-fixture.mjs
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/home/users/ziyang01.wang-al/projects/dev-session-canvas/.vscode-test npm run test:vsix-smoke
    git diff --check

PATH 使用 `/tmp/dsc-release-node22/node_modules/node/bin` 中的 Node；原生日志放在忽略目录 `.debug/reset-final-persistence/`，测试 runner 工件在 `.debug/vscode-vsix-smoke/`。构建须保持六目标原生资产的源码/hash 校验，不绕过打包检查。

## 验证与验收

正常 reset 不重试；仅精确 pending + 全部原执行 saved/not-required 可以发第二次；失败、未知、错误身份、截止后和第二次错误均失败。真实 packaged smoke 必须越过原 reset 空画布断言；若整体仍失败则明确记录位置及是否属于本次范围，不能宣称 clean-checkout gate 全绿。

## 幂等性与恢复

保留原 #300 失败工件，本轮使用独立日志。纯测不启动真实进程。完整 smoke 使用隔离用户数据目录；任何重跑先保留失败 artifacts，不碰用户会话或调整等待预算。

## 证据与备注

最终纯测 19/19；日志 `.debug/reset-final-persistence/fixture-unit-final.log`。第一次完整日志 `vsix-fixture-first.log` 与 `fixture-first-artifacts/` 保留相对 shell 诊断等待失败；第二次 `vsix-fixture-final.log` 与 `fixture-second-artifacts/` 保留前置 shell 切换的 reset pending。最终输入复验日志为 `vsix-fixture-verified.log`，工件复制到 `fixture-verified-artifacts/`。Linux / Node 22.23.3 / VS Code 1.126.0，打包成功，完整命令 exit 1。前次 Host 302/302 是定位证据，不冒充本轮夹具验证。

## 接口与依赖

复用现有 testResetState、getDebugSnapshot、getDiagnosticEvents 与 Node assert；helper 不依赖 vscode，调用方注入现有命令。无生产接口或依赖变更。

修订记录：2026-10-08 创建夹具修复计划，按用户新授权将同一 PR 从定位推进至修复。

修订记录：2026-10-08 将第二次完整运行暴露的 shell 切换 reset 纳入同类修复；补重启前后保存身份区分，不扩大到独立的 shell 启动事件或 resize 产品修改。

最终证据：`vsix-fixture-verified.log` 第 3217 行 pending，第 3227 行原两执行保存结果，第 3228 行 `Empty canvas confirmed after 2 reset call(s)`；第 3781 行 Exit code 1。对完整命令的最终失败不追认为通过。

修订记录：2026-10-08 依据第三次真实 VSIX 证据完成夹具修复，移入 completed，后续 shell 诊断失败单列。
