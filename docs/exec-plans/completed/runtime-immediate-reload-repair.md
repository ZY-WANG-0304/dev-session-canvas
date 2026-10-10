# 修正 Runtime 立即模拟重载的等待边界

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

在 PR #314 修复 `verifyImmediateReloadAfterLiveRuntimeLaunch`：遵守一次只启动一个会话的准入，保留第二个会话启动在途时立即发起模拟 reload 的覆盖；模拟边界等待期间到达的新输出完成并保存后才能清空 Host 绑定，超时保留原责任而不伪报重载成功。

## 进度

- [x] 已复核原定位及调用链，工作树为 `/tmp/dscr` 的 PR #314 分支，基线 `35481035`。
- [x] 记录正式方案，新增受控回归并确认原代码失败。
- [x] 实现仅模拟 live-runtime reload 使用的有界回调等待，修正独立 smoke 启动顺序及身份断言。
- [x] 完成 Host 回归、类型/本地化和最终原生专项（连续三次）。
- [x] 最终 VSIX 七个独立阶段及 trusted 立即 reload 通过，后续本地 Agent live 等待失败，工件已保存。
- [x] 同步文档和技术债并归档计划；提交推送 PR #314。

## 意外与发现

原边界等待回调发生在等待启动操作之前；首批正文可在此后新登记。原生定位中回调在拒绝后 17ms 正常结束。真实 deactivation 先关闭事件准入；不能改变它或 reset/template 的既有保护来满足模拟重载。

## 决策记录

2026-10-10：仅为保留 live-runtime 的模拟重载传入回调结算期限，使用既有 20 秒 boundary 预算和单调时钟。在清空 session/binding 之前，等待新回调、重新 flush/save，直到检查时集合为空；检查与清空之间不增加 await。保留原 pending 断言以及最终边界检查，不关闭/重开永久准入，不修改 Supervisor 配额，不用固定 sleep 或错误文本重试。

2026-10-10：smoke 等待 Agent 原 started 后再派发 Terminal，随即模拟 reload，不等待 Terminal started 或输出安静。之后按本次 started 事件核对两项原 Runtime session，不能仅以任意 live 记录通过。

## 结果与复盘

实现与回归已完成。最终原生专项连续三次通过第二项启动在途的模拟重载及原 session 重连。完整 gate 最终 exit1，在后续 `verifyHostBoundaryFlushesRecentLocalState:11210` 等待本地 Agent live 失败；已登记下一处待定位问题，真实新 Host/跨平台验证不能由本次模拟重载代证。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `simulateRuntimeReloadForTest` 复用原 Host，`prepareForHostBoundaryCore` 负责会话状态保存和断开；`pendingRuntimeSupervisorStateCallbacks` 保存 Supervisor 输出/状态事件产生的异步工作。`scripts/test/test-runtime-host-deactivation-integrity.mjs` 可直接调用真实 Host 方法，控制事件和时钟。`tests/vscode-smoke/extension-tests.cjs` 包含原生场景和 `waitForRuntimeExecutionStarted`。

## 工作计划

第一里程碑补正式设计与确定性回归：在启动等待、flush 或 workspace 保存期间加入回调，确保等待完成后重新保存；期限到达保留 map/binding，迟到完成不得继续重载；普通边界仍拒绝。第二里程碑实现最小边界选项和 smoke 串行准入，保留在途 Terminal。第三里程碑打包并运行原生专项与默认门禁；有后续新阻塞时记录真实现场，不顺手修复无关问题。

## 具体步骤

工作目录 `/tmp/dscr`。恢复 `.debug/rca/node_modules` 和 `.debug/rca/playwright-browsers` 链接；PATH 使用 `/tmp/dsc-release-node22/node_modules/node/bin`。运行 `node scripts/test/test-runtime-host-deactivation-integrity.mjs`、`node scripts/test/test-host-execution-owner-wiring.mjs`、`npm run typecheck`、`npm run test:ui-copy-localization`、smoke 语法检查。

原生运行使用 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code` 与 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`，以 `xvfb-run -a` 执行 VSIX smoke。日志保留 `.debug/runtime-immediate-reload-fix/`，精简证据入库 `docs/references/smoke-reload-autostart/`。

## 验证与验收

新回归在基线失败、修后通过；待处理回调跨两轮保存仍被等待，期限拒绝不清空 session/binding、不发生迟到 reload；普通 reset/deactivation 既有契约保持。原生专项必须在派发 Terminal 后立即 reload 并重连原会话，完整默认命令如实报告通过或下一处阻塞。

## 幂等性与恢复

只操作本分支及隔离测试会话。超时不移除回调或冒充结算；其原 promise 正常结算仍由原逻辑负责。原生测试清理本轮会话，不影响用户 Supervisor。结束归还依赖链接。

## 证据与备注

原定位为 `docs/references/smoke-reload-autostart/runtime-immediate-reload-evidence.json`。本轮证据为 `docs/references/smoke-reload-autostart/runtime-immediate-reload-fix-evidence.json`；相邻 `runtime-immediate-reload-verification.mjs` 可用最终 packaged smoke-host 重跑三次专项。新增受控14项、Host529/529、类型/本地化/语法通过。

## 接口与依赖

只扩展 Host 私有边界选项和回调等待的可选 deadline，不新增外部协议、依赖、设置或生产准入入口。

初稿：明确受控修复范围、期限语义与原生在途覆盖。

实施更新：增加回调登记修订，覆盖保存期间新回调已完成、集合重新为空的情况；覆盖持续输出到期及永久关闭交错。

完成修订：最终产品专项及 trusted 原顺序均通过具名修复；记录后续本地启动阻塞，不把完整 gate 写成成功。
