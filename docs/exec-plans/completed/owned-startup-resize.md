# 修复本地执行启动期间的尺寸同步

本计划按 `docs/PLANS.md` 维护，用户授权在 PR #314 中完成 resize 修复。

## 目标与全局图景

关闭 RuntimePersistence 时，页面按容器计算的尺寸可能早于后台 PTY（伪终端）启动就绪。Host 应保留最新尺寸，确认原执行 started 后再应用，不产生未就绪 toast。尺寸变更不能阻塞启动输出消费；正常关闭时取消未派发的视口意图，真实失败和未知效果继续报错。

## 进度

- [x] 复核 `8bff62fb`、PR 状态、现有准入和队列；原工作树保持不动。
- [x] 建立 20 项启动前/启动中/关闭交错的回归，原实现首先失败于最新尺寸没有保留。
- [x] Host 保留单个最新意图，started 后派发；明确 superseded/cancelled/applied 并保留原执行与最终保存约束。
- [x] Host 376/376、类型检查、VSIX 打包通过；两个默认具名阶段通过，trusted 仍在独立异常退出通知等待失败。
- [x] 同步设计/证据/技术债，收口至 PR #314 更新，不合并或发布。

## 意外与发现

已有 `pendingResize` 只合并等待正文消费的请求；出队立即调用 adapter，未协调 starting。已归档诊断在真实页面捕获四次同类错误，四项特征对照验证 ready 前和 ready 后 started 前均受影响。原生诊断还触达异常退出通知超时，该独立问题已有技术债，本次不以修改通知断言放行。

## 决策记录

2026-10-10：沿用原执行记录上的单个 pending 尺寸，不增加独立重试队列。等待 started 不挂在 `terminalChain` 上，保留输出消费进展。正常关闭前未派发的 resize 可以明确取消，已确认原生生效的 resize 必须完成 tracker 提交；失败、未知结果及绑定替换不视作取消成功。RuntimePersistence 开启路径不由本次验证代证。

## 结果与复盘

已完成 resize 修复并验证原执行确认后更新 Host tracker；20 项新增回归纳入完整 376 项验证。真实 VSIX 执行流及重组通过，trusted 未出现本地 resize 拒绝，但完整流程仍因异常退出通知缺失而失败。该独立问题已保留技术债。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `startNonNativeHostExecution` 创建本地执行；`resizeExecutionSession` 接收页面意图，`queueNonNativeHostResize` 通过 `terminalChain` 与已接受输出串行。`executionOwnerLifecycle.ts` 与 `executionSessionAdapter.ts` 提供原执行状态及生命周期事件。`scripts/test/test-host-execution-owner-wiring.mjs` 提供可控 provider、时钟及真实 Host 类；`tests/vscode-smoke/extension-tests.cjs` 提供实际 VS Code 页面。启动参数与页面尺寸可以不同，不能改固定测试尺寸隐藏缺陷。`resizeExecutionSession` 在真正失败时记录带执行身份的诊断；smoke 在清理及结束前检查，防止只依赖后续 toast。

## 工作计划与里程碑

第一里程碑将诊断中的四项特征转换为保留最新尺寸的正向回归，并覆盖准备中、失败、超时、停止及启动前已接受输出。第二里程碑调整 Host 的派发时机与未派发取消语义，原生确认之前不改 tracker/metadata，原生确认之后继续原提交屏障。第三里程碑跑完整 Host 和真实 VSIX，分别报告 resize 验收与其他 smoke 阶段结果，更新 `docs/design-docs/smoke-reload-autostart-investigation.md`、索引、核心原则及技术债。

## 具体步骤

工作目录 `/tmp/dscr`。依赖 symlink 位于 `.debug/rca/`，运行前移回根目录，提交前移回。使用 Node 22.23.3、VS Code 1.141.0、Linux 原生资产和独立 profile：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='startup resize' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    npm run test:vsix-smoke

日志放 `.debug/resize-fix/`：`red.log` 为修前失败，`host-final.log` 为 376/376，`vsix1.log` 和 `trusted-artifacts/` 为真实打包运行及完整失败。发布验证不把过滤场景成功算作完整通过。

## 验证与验收

准备/ready/started 的屏障内多次 resize 不派发 native 请求；释放后仅应用最新尺寸，无额外启动、无未就绪错误。输出在屏障期间能够消费。停止/源结束时未派发请求不触碰原尺寸或最终正文；已派发未知结果、绑定替换与 tracker 提交失败仍保留错误。验证失败和超时不泄漏 pending 等待。

## 幂等性与恢复

不触碰用户原发布 worktree，不应用旧诊断 patch 到新实现。独立 profile 可以重建，旧日志不覆盖。变更仅服务本地 resize，退出通知等独立问题继续登记。

## 证据与接口

现有诊断位于 `docs/references/smoke-reload-autostart/resize-admission-evidence.json`。沿用现有协议与依赖；Host 内部 `NonNativeHostResizeResult` 区分 applied、superseded、cancelled，不能把后两者当作原生确认。修复证据位于 `docs/references/smoke-reload-autostart/resize-repair-evidence.json`。

修订记录：2026-10-10，依据已定位的启动窗口建立修复计划。

修订记录：2026-10-10，交互的 5 秒期限改为首次就绪后开始，避免慢启动提前消耗交互期限；实际覆盖 startup/output-credit/失败取消边界，记录完整 smoke 的独立通知阻塞。
