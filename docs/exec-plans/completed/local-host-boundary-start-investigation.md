# 定位本地 Host boundary 用例的 Agent 启动等待

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

定位 PR #314 `verifyHostBoundaryFlushesRecentLocalState:11210` 在 snapshot-only 模式等待 Agent live 超时的根因，解释 stopped/SIGINT 属于哪次执行，并确认修复应落在测试还是产品。本轮仅调查，不正式修改产品或 smoke。

## 进度

- [x] 核对基线 `675f2a55` 与最终 trusted 工件；本次 Agent 请求收到 rejected-before-acquire，Terminal 随后 started。
- [x] 追踪旧停止、新启动、准入和状态保留语义。
- [x] 完成原生原序及单变量对照，保留产品 hash 和原执行身份。
- [x] 同步设计、技术债和证据，归档并推送 PR #314。

## 意外与发现

故障前旧 Agent/Terminal 都已有 saved 和 reader applied；Agent 的新执行则 not-required。不能把最终 stopped/SIGINT 当作新进程启动后被杀，也不能只按错误文案断言是同 key 退休占槽。

## 决策记录

2026-10-10：使用最终打包产品的隔离副本；原序与串行 started 对照保持产品不变，必要时只读记录 authority 的身份/关闭/启动集合。保留原 flush/reload/正文断言，不放宽配额、不固定 sleep。

## 结果与复盘

已确认独立测试的并发启动前提遗漏。原序及 authority 探针复现，串行 Agent started 的单变量对照完整通过原函数；SIGINT 绑定旧执行，未发现本次插件生命周期缺陷。正式产品/smoke 未改，完整 gate 未重跑，修复登记技术债。

## 上下文与定向

工作树 `/tmp/dscr`，PR #314 分支 `investigate-smoke-reload-autostart`。`tests/vscode-smoke/extension-tests.cjs` 的独立 Host boundary 用例先停止 fixture 会话，再连续派发两个新启动。`CanvasPanelManager.ts` 的页面启动入口不会等待启动 promise，`executionSessionAdapter.ts::ExecutionAuthority.beginStart` 负责并发启动准入；产品契约为 starting=1。要用具体证据确认本次被拒的分支，不能只凭相似历史结论。

## 工作计划

第一里程碑按 executionId 关联原停止、保存、读者确认和新启动，阅读状态保留代码。第二里程碑复用 `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(false)`，运行原 `verifyHostBoundaryFlushesRecentLocalState`；仅等待 Agent 原 started 后再派发 Terminal 作为对照。第三里程碑记录本次根因、SIGINT 归属和修复边界，保留未触达或新阻塞的限制。

## 具体步骤

在 `/tmp/dscr` 恢复 `.debug/rca/` 下依赖链接，使用 `/tmp/dsc-release-node22/node_modules/node/bin` 的 Node22。原生 VS Code 为 `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`，资源集为 `/tmp/dsc-release-026-assets`。从 `.debug/vscode-vsix-smoke/smoke-host` 复制隔离载荷，以 `scripts/smoke/vscode-smoke-runner.mjs` 与 xvfb 运行调查入口。旧工件为 `.debug/runtime-immediate-reload-fix/final-trusted-artifacts/`。

## 验证与验收

原序复现、准入分支观察及只改启动顺序的对照共同证明根因。必须区分旧 execution 和新请求身份，确认旧 saved/applied 与新 not-required，解释为何节点仍显示旧停止摘要。对照通过到哪一步如实记录，不宣称完整 gate 成功。

## 幂等性与恢复

每轮使用新隔离目录；只停止实验会话，退出本轮 VS Code。结束归还依赖链接；不操作原用户工作树或其它 Supervisor。

## 证据与备注

原序 15:49:00.967Z Agent startRequested，.975 Terminal startRequested，15:49:01.011Z Agent startRejected，.092 Terminal started。新 Agent 保存责任为 not-required。

## 接口与依赖

不新增正式接口；调查脚本与精简证据入库 `docs/references/smoke-reload-autostart/`。源码、正式测试、发布材料不变。

初稿：固定调查范围与原生对照要求。

完成修订（2026-10-11）：三轮原生实验与两项现有准入回归完成。复跑命令为 `xvfb-run -a node docs/references/smoke-reload-autostart/local-host-boundary-start-investigation.mjs baseline`，模式亦可为 probe/serial；每轮新目录，result.json 的 outcome 区分预期失败与通过。Host 回归使用 `DEV_SESSION_CANVAS_HOST_TEST_FILTER='webview start .* overlap' node scripts/test/test-host-execution-owner-wiring.mjs`，2/2通过。证据与精简身份时序已入库。
