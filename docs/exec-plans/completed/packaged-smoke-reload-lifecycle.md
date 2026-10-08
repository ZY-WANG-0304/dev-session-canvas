# 修复 packaged smoke 的模拟重载生命周期

本 ExecPlan 按 `docs/PLANS.md` 维护。

## 目标与全局图景

修复 PR #296 中 packaged smoke 在 `verifyCreateNodeCommandQuickPick` 等待启动诊断超时的问题。模拟重载成功后，同一 Host 实例应继续接受新的 Agent / Terminal 执行；清理失败时仍须拒绝新执行。验证不能放宽原启动事件断言，也不能把局部通过写成完整 packaged smoke 通过。

## 进度

- [x] (2026-10-08) 从最新 `origin/main` 创建 `tests-packaged-smoke-reload-lifecycle`，保留原未跟踪文件。
- [x] (2026-10-08) 留存 VSIX 对照确认模拟 reload 关闭 owner 后未恢复 admission。
- [x] (2026-10-08) 新增 4 项真实 Host 方法回归；原实现的 closing 断言失败，修复后 4/4 通过。
- [x] (2026-10-08) 类型检查、Node 22 完整 Host 接线测试 236/236 通过。
- [x] (2026-10-08) `test:vsix-smoke` 完成打包并越过原启动事件断言；后续第 2669 行 reset 失败，exit 1，已单独登记。
- [x] (2026-10-08) 同步设计、核心信念和技术债，保留原始及修后证据；本轮实现与验证收口，提交与 PR 为交付动作。

## 意外与发现

原失败不是打包失败。`verifyDefaultSurfaceRequiresReload` 调用 `simulateRuntimeReloadForTest`，通过 Host boundary 将 owner 置为 closing，但该钩子继续复用原实例且未恢复 admission。临时对照观察到 `closing=true, permanent=false, pending=0`；恢复后原启动断言通过。证据在 `/tmp/dsc296-probe-730o3_oa/RESULT.txt`。

临时副本继续跑完整 QuickPick 用例时，后续 reset 曾因最终快照持久化 pending 失败。该问题尚未确认是测试还是产品问题，不能合并到已经确认的根因中。

正式修复后的完整 packaged smoke 同样停在 reset 的空画布断言。Host 返回保存 pending 后，同一 Agent 的 `execution/localFinalPersistence` 最终报告 saved，说明不能把首次 reset 失败等同于磁盘最终写入失败；reset 和最终保存的时序另行定位。原启动事件断言未改动。

## 决策记录

- 决策：只在模拟重载成功完成后调用 owner 的受约束 `tryResume()`，恢复失败须显式报错；不修改永久关闭或生产准入规则。理由：真实 reload 重建 owner，模拟路径复用实例必须补齐等价生命周期。日期/作者：2026-10-08 / Codex。
- 决策：后续 smoke 失败先保留证据和具名债务，只有与本次恢复直接相关的缺陷才进入本修复。理由：不能用扩大修复范围或弱化断言隐藏验证缺口。日期/作者：2026-10-08 / Codex。

## 结果与复盘

已完成原始首个阻塞修复，代码仅在测试模拟重载成功后恢复原 owner，失败时显式报错；生产准入与保存保护未修改。新增 4 项回归先红后绿，Node 22 完整 Host 接线 236/236、类型检查通过。真实 VSIX 打包通过，完整 smoke 已越过原诊断超时，但后续 reset 失败，exit 1。该独立缺口已写入技术债，不声明整个 clean-checkout 门禁通过，不修改 0.26.0 发布历史。

复验日志在 `.debug/packaged-smoke-reload/host-owner.log` 和 `vsix-smoke.log`，失败工件复制到同目录 `artifacts/`。原定位证据保留在 `/tmp/dsc296-probe-730o3_oa/`；未提交含环境信息的完整日志。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `simulateRuntimeReloadForTest` 在同一个实例上清理、重读状态并恢复画布。`prepareForHostBoundary` 会关闭本地执行 owner。owner 是管理执行资源和新执行准入的对象；其 `tryResume` 仅在没有遗留执行且未永久关闭时恢复准入。`scripts/test/test-host-execution-owner-wiring.mjs` 可通过注入 provider 对真实 Host 类进行确定性测试。`tests/vscode-smoke/extension-tests.cjs` 的默认 surface/reload 用例紧邻原失败用例。

## 里程碑与工作计划

第一里程碑先在 Host 接线测试中覆盖模拟重载后启动 Agent / Terminal，以及边界失败和永久关闭不得重新准入；先运行看到原实现失败，再修复并验证。第二里程碑构建真实打包产物，沿原 packaged smoke 路径检查首个阻塞是否消失，记录下一失败或整体成功。最后同步开发调试设计、核心信念和技术债，提交可审查的改动。

## 具体步骤与验证

在仓库根目录运行 `node scripts/test/test-host-execution-owner-wiring.mjs` 和 `npm run typecheck`。定向测试可用 `DEV_SESSION_CANVAS_HOST_TEST_FILTER='simulated reload'` 选择，成功和拒绝路径均应通过。

使用 Node 22，设置 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets` 和 `DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/home/users/ziyang01.wang-al/projects/dev-session-canvas/.vscode-test`，运行 `npm run test:vsix-smoke`。资产必须通过构建脚本的输入校验；不得绕过同源检查。日志写到忽略目录 `.debug/packaged-smoke-reload/`。必要时使用独立短路径导出，避免 VS Code Unix socket 路径限制。

## 幂等性与恢复

测试使用独立运行目录，不覆盖原失败证据。修改仅涉及测试钩子、回归和相关文档；不删除用户未跟踪文件，不重写发布契约。失败只重试有明确新证据或新修复的路径。

## 产物与接口

不新增产品接口或运行时依赖。`simulateRuntimeReloadForTest` 仍返回 `CanvasDebugSnapshot`；原 owner 无法恢复时通过 rejected Promise 报告失败。最终验证结果和残余风险随本计划、设计和技术债一起收口。
