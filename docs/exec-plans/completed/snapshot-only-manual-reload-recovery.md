# 修复 snapshot-only reload 后手动恢复状态

本计划遵循 `docs/PLANS.md`，在 PR #314 专用 worktree `/tmp/dscr`、分支 `investigate-smoke-reload-autostart`、基线 `ff789a4f` 实施。原项目树有独立发布改动，不触碰；不合并、不发布、不更新版本。

## 目标与全局图景

关闭 RuntimePersistence 时，Host reload 中断仍活动的 Agent 后，有可信 provider 会话身份应显示 resume-ready，等待用户手动恢复，不自动 provider resume。没有身份的 Agent 和 Terminal 显示 interrupted。主动停止与已自然退出保持真实终态。本轮同时修正产品丢失 Host 中断原因和 smoke 错误期待自动恢复两处问题。

## 进度

- [x] (2026-10-10) 复核 Host boundary/最终保存/重读链路；按用户约束同步产品规格与正式方案。
- [x] 增加修前失败的受控回归，覆盖真实最终保存、普通和永久 Host 边界及手动恢复意图。
- [x] 实施原执行中断标记、最终状态和旧自动意图清理，更新恢复 smoke。
- [x] 运行完整 Host、相关重读测试、类型/本地化与默认真实 VSIX；登记独立后续阻塞。
- [x] 同步证据和索引/原则/技术债并归档计划。
- [x] fetch 后确认 origin/main 仍为 78c58c2a、PR head 仍为 ff789a4f；完成 PR #314 提交材料。

## 意外与发现

`prepareForHostBoundary` 同时用于 reload/deactivation 和 reset/模板替换，不能按通用 reason 字符串把所有停止都变成 resume-ready。真实原生 deactivation 还直接调用 `beginNonNativeHostExecutionClose`，只修测试模拟方法不能覆盖产品。

`persistNonNativeHostFinal` 目前把任何 stopRequested 保存为 stopped/closed，重读只为 liveSession 快照构造恢复状态；因此恢复 ID 已保存也仍 stopped。旧重读代码会设置 pendingLaunch=resume，页面 RAF effect 自动执行，违背用户此次明确的产品设计。

## 决策记录

首轮默认 VSIX 在更早的缺失文件链接检测失败；新增默认 snapshot-only-manual-recovery 具名阶段复用同一恢复函数，使本轮验收不依赖无关交互前缀，保留原 trusted 路径与首次失败工件。

通过明确 preserveLocalRecovery 边界选项，给原来已 confirmed running、未观测 process 结果且未 stopRequested 的原执行记录加内存标记。沿原最终保存生成恢复状态，避免事后补写或破坏正文/持久化责任。真实退出码/信号保留。显式 stop 清除标记，reset/clear/template 不请求恢复；未知结果仍按原严格证据规则失败，不能凭中断意图伪造 saved。

受控测试还发现已观测退出、final 尚未保存时，owner.close 的 stopRequested 也会覆盖真实退出分类；使用同一个内存 hostBoundaryStop 枚举记录 after-process-exit，使清理 stop 不覆盖原结果。

旧 live 快照和旧 pendingLaunch=resume 不自动恢复；显式 create/start 不受影响。历史 stopped 无法可靠识别关闭原因，不做宽泛升级。smoke 在真实页面稳定后确认仍 resume-ready、无新启动，再显式 resume，后续正文读原实际交付通道。

## 结果与复盘

产品与 smoke 修复已完成，新增 24 项、完整 Host 478/478 及重读/类型/本地化通过。最终默认 VSIX 的独立手动恢复阶段和 trusted 原恢复阶段两处完整通过，确认无自动启动且显式恢复正常。下一项 surface 切换在等待旧 recentOutput 时阻塞，原 execution 输出与 snapshot 已有 marker，另行登记；完整门禁没有通过。首轮链接失败与更早的 final-save pending 不追认原因。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 承载原执行记录、Host 关闭编排、最终保存与重读。`NonNativeHostExecution` 保存执行 identity 和最后持久化 metadata 引用；`beginNonNativeHostExecutionClose` 在调用 owner.close 前观察原状态；`persistNonNativeHostFinal` 校验 process/seal/finalRevision 与绑定后同次保存业务终态。`reconcileAgentNodesInArray` 处理从盘读取的历史快照。`scripts/test/test-host-execution-owner-wiring.mjs` 的 candidate/simulatedReloadFixture 提供真实 Host/owner 与可控 provider；`scripts/test/test-runtime-legacy-reconnect.mjs` 导出实际重读函数。`tests/vscode-smoke/extension-tests.cjs` 的 verifyRuntimeReloadRecovery 是当前原生阻塞。

## 工作计划与里程碑

第一里程碑按实际 simulateRuntimeReload/prepareForDeactivation 与受控 provider 最终输出验证修前 stopped 错误，并核对 pending resume 的旧断言。第二里程碑实现最小边界选项和原执行状态区分，保留新建自动启动及 Runtime 重连，测试主动 stop/自然退出/无身份/准备阶段/失败保存的反例。第三里程碑将原生 smoke 改为用户手动 resume 语义并检查原恢复输出；完整 Host、类型与本地化通过后跑默认 VSIX，下一独立失败保留现场，不能放宽断言。

## 具体步骤

工作目录 `/tmp/dscr`，使用 `export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。依赖与浏览器从 `.debug/rca/` 移回根目录，结束移回。

定向：`DEV_SESSION_CANVAS_HOST_TEST_FILTER='manual reload recovery' node scripts/test/test-host-execution-owner-wiring.mjs`。完整：`node scripts/test/test-host-execution-owner-wiring.mjs`；重读：`node scripts/test/test-runtime-legacy-reconnect.mjs` 与 `npm run test:canvas-execution-context`；类型/本地化：`npm run typecheck`、`npm run test:ui-copy-localization`。原生：`DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke`。日志/工件在 `.debug/manual-reload-recovery/`。

## 验证与验收

同一最终保存包含正确 resume-ready/interrupted、原恢复 ID、最后正文和真实退出结果，pendingLaunch 不为 resume；已停止/自然退出保持终态。未知 process/保存失败不伪造恢复完成或释放准入；不覆盖换绑节点。实际 deactivation 与模拟 reload 都覆盖。原生页面加载/重建不发起 resume，显式恢复后新执行提供正确正文，退出分类保留。

## 幂等性与恢复

只修改当前 PR worktree；不重置全树或触碰发布材料。原执行标记不持久化，不把旧 stopped 泛化成恢复状态；最终保存保留既有幂等与失败保护。所有失败工件单独保存，不通过重跑追认旧失败。

## 证据与备注

上轮 `start-admission-repair-evidence.json` 已记录原两个启动与 saved 后 reload 得到 stopped/closed，本轮保留它作为修前原生证据。

## 接口与依赖

新增 Host 内部恢复边界选项与原执行中断标记，不增外部协议/依赖。不调整 starting/pending 限额，不更改 RuntimePersistence 开启后的旧绑定和重连。

最终证据：`docs/references/smoke-reload-autostart/manual-reload-recovery-evidence.json`；原日志/工件在 `.debug/manual-reload-recovery/`。默认 runner 已增加 snapshot-only-manual-recovery，单独复跑可设置 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=snapshot-only-manual-recovery`。本轮无需依赖真实 provider 服务，但不把 fake Agent + 模拟 Host reload 外推为真实 Window Reload、跨平台或跨版本全矩阵。
