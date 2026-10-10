# 定位 Runtime 启动后立即 reload 的阻塞

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

定位 PR #314 在 `verifyImmediateReloadAfterLiveRuntimeLaunch` 的下一处失败，区分并发启动准入和 Host 切换时的回调结算。交付可复核的根因和修复边界，本轮不正式修改产品或 smoke 断言。

## 进度

- [x] 已核对 d0fc7e0b 原始 trusted 工件：Agent 启动被拒，Terminal live，reload 报 Runtime 更新未完成。
- [x] 追踪启动和边界回调的代码及设计契约。
- [x] 用隔离原生场景或受控测试区分两条因果链。
- [x] 同步结论、证据和技术债，提交 PR #314。

## 意外与发现

Host 边界只对当前回调集合做一次等待，但非永久边界仍接收新事件；后续断言可能看见新回调。原生探针确认首批输出在初次等待后到达；serial2 在拒绝后 17ms 正常消费并结束。

## 决策记录

2026-10-10：保留原始断言，不使用固定 sleep 或放宽启动容量；实验仅使用隔离副本，避免把绕过故障写成修复。

## 结果与复盘

已完成六次原生隔离对照与 Host deactivation 测试。确认并发启动前提遗漏和非永久模拟边界的新回调交错独立存在；原 batch 在拒绝后正常结束。未修改产品或正式 smoke，完整 gate 未重跑，修复工作登记技术债。

## 上下文与定向

工作树 `/tmp/dscr` 的 `investigate-smoke-reload-autostart` 对应 PR #314。`tests/vscode-smoke/extension-tests.cjs` 的具名场景在 RuntimePersistence 开启后连续派发 Agent/Terminal 启动，再立即模拟 Host reload。`CanvasPanelManager.ts` 的 `prepareForHostBoundaryCore` 等待并检查 Runtime 状态回调；`runtimeSupervisorMain.ts` 承担外部 Runtime 进程启动。状态回调是 Supervisor 事件引发的 Host 异步状态更新，不等同于子进程仍在启动。

## 工作计划

第一里程碑读取入口、回调跟踪、边界保护及现有测试，确定可观测点。第二里程碑保留原产品包，使用临时 smoke 入口和必要的只读探针复现原顺序，再控制启动顺序，确认边界失败是否独立存在。第三里程碑将证据收敛至 `docs/references/smoke-reload-autostart/`，同步原调查设计、索引、核心原则与技术债。

## 具体步骤

在 `/tmp/dscr` 执行源码检索和隔离实验。Node 来自 `/tmp/dsc-release-node22/node_modules/node/bin`；原生 VS Code 为 `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`，执行资源为 `/tmp/dsc-release-026-assets`。通过 `xvfb-run -a node` 运行基于 `scripts/smoke/vscode-smoke-runner.mjs` 的调查脚本。原始失败保存在 `.debug/runtime-resume-exit-summary-fix/recheck-trusted/artifacts/`。

## 验证与验收

必须解释 Agent 拒绝与 pending callback 的具体来源，区分启动完成、状态回调完成与重连成功。对照须保留 Runtime 模式、原 session 身份和 reload 后连接断言；只报告实际触达范围，不宣称完整发布门禁通过。

## 幂等性与恢复

每个实验使用隔离 VS Code 数据目录和 Runtime 存储。只停止实验创建的会话；不操作用户工作树或其它 Supervisor。临时依赖链接结束后归还 `.debug/rca/`。

## 证据与备注

原错误：`Runtime session updates are still pending. Please try again after they finish.`；Agent 错误：`Execution start was rejected-before-acquire.`。

## 接口与依赖

不新增正式接口；复用现有测试命令和原生 smoke runner。探针若修改副本 bundles，必须记录修改内容并与未探针产品区分。

完成修订：补充原生正反对照、边界测试和结论；交付范围为定位，修复与真实新 Host 验收仍待推进。

复跑：在仓库根使用 `xvfb-run -a node docs/references/smoke-reload-autostart/runtime-immediate-reload-investigation.mjs original`，其余模式为 probed/probed2/serial/serial2/serial-clean；脚本每轮生成新隔离目录，避免旧工件混入。脚本捕获失败的 exit0 仅代表调查完成，查看 evidence 中 outcome。`node scripts/test/test-runtime-host-deactivation-integrity.mjs` exit0。详细时序保存在相邻 evidence JSON。
