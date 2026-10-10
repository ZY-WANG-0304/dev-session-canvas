# 修正 Runtime smoke 的启动完成屏障

本计划按 `docs/PLANS.md` 维护。用户授权在 PR #314 修复已确认的 Runtime 创建准入问题。

## 目标与全局图景

让 smoke 在准备多个运行节点时遵守单并发启动契约，能够进入后续 Runtime 持久化验证。每次启动固定本次 session/execution 身份并等待真实 started，避免节点已创建或早期 live 被误当作启动完成。

## 进度

- [x] (2026-10-10) 基线 `1357217b`、干净工作树；核对共用 helper 的 Runtime 开/关调用点。
- [x] (2026-10-10) 发现同一 Runtime 用例的显式重新启动也有相同的连续派发。
- [x] (2026-10-10) 增加 Runtime 原 session 的 started 等待，修正共用 helper 与该重启顺序；语法和 diff 检查通过。
- [x] (2026-10-10) 开/关专项均通过；默认 VSIX 七阶段通过，trusted 完整持久化用例通过，随后滚动历史快照等待失败。
- [x] (2026-10-10) 同步设计、索引、原则、技术债与精简证据，清理隔离会话、恢复依赖链接，归档供 PR314 更新。

## 意外与发现

`verifyLiveRuntimePersistence` 在初始自启动后停止两节点，再连续派发两个指定尺寸启动，也需要相同屏障。`waitForAgentLive` 可接受 starting + liveSession，因此不足以单独证明启动槽释放。

原共用 helper 的开启修正与显式重启均在 trusted 原顺序验证通过；关闭分支由独立原生专项直接调用正式 helper 验证，因为 trusted 后续快照断言尚未通过。完整门禁不能由两专项代证。

## 决策记录

- 决策：Runtime 等待使用 metadata.runtimeSessionId 绑定真实 execution/started；snapshot-only 复用既有 waitForLocalExecutionStarted。
  理由：Runtime 会话不在 localExecutions，不能套用本地记录捕获；两模式都必须确认原执行。
  日期/作者：2026-10-10 / Codex。
- 决策：同时修正同一用例中显式重启的连续派发，保留后续状态/正文断言。
  理由：同一种启动前提遗漏；不增加重试、固定 sleep 或放宽配额。
  日期/作者：2026-10-10 / Codex。

## 结果与复盘

共用 helper 与同一用例的指定尺寸重启已修正。Runtime 开/关专项均只有两次原身份启动，首个 started 先于下一个请求，无拒绝和重试。默认 VSIX 类型检查/打包、七阶段通过，trusted 完整 verifyLiveRuntimePersistence（启动、重启、运行、reload/reattach、停止后重读）已通过。

下一项 verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory 在 10380 等待旧 terminalStream 字段超时，实际快照带 terminalRead/currentState；此前页面首末行断言已完成。本轮不改该独立断言，已登记后续范围。没有更改产品或启动限额。

## 上下文与定向

工作目录 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`，基线 `1357217b`。原目录包含无关发布工作，不修改。`tests/vscode-smoke/extension-tests.cjs` 的 `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode` 服务 Runtime 开/关及 checkpoint/scrollback 独立场景。只修改可信工作区的启动准备；restricted 不启动执行，不加入 started 等待。`waitForLocalExecutionStarted` 已按原 identity 等待；新增 Runtime 对应等待使用同一 started 诊断。

## 工作计划与里程碑

第一里程碑在正式设计补齐本轮方案，再实现小范围等待；代码检查不得触及产品额度或 Runtime 实现。第二里程碑调用实际共用 helper 验证 Runtime 开/关两种模式，确认只启动两次且第一个 started 先于第二个请求，再运行默认 VSIX 覆盖显式重新启动和后续断言。第三里程碑归档实际证据并更新 PR；后续独立阻塞按事实登记，不弱化断言使门禁变绿。

## 具体步骤

在 `/tmp/dscr` 恢复 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers` 链接。设置 `PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`、`DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`、`DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`。运行 `node --check tests/vscode-smoke/extension-tests.cjs`、`npm run test:vsix-smoke`。专项复制默认 smoke-host，仅替换测试入口复用实际 helper：`xvfb-run -a node docs/references/smoke-reload-autostart/runtime-admission-fix-verification.mjs on` 与 `off`；精简结果到 `.debug/runtime-admission-fix/`。

## 验证与验收

开/关两模式各有 Agent/Terminal 两条唯一 started，节点绑定保持；Terminal startRequested 晚于 Agent started；无 candidateStartFailed、无自动重试。显式重启同样串行。完整 VSIX 若在后续独立断言失败，保存原错误、精简状态与诊断，明确不能代证整个门禁通过。

## 幂等性与恢复

不改版本、不合并、不发布。专项使用隔离 user-data，原生执行通过原 stop 入口清理，等待隔离 Supervisor 退出；恢复依赖链接。推送前 fetch/rebase origin/main，保持其他工作树不变。

## 证据与备注

根因证据见 `docs/references/smoke-reload-autostart/runtime-admission-evidence.json`；本轮证据为相邻 `runtime-admission-fix-evidence.json`，保存正式载荷 hash、两模式原身份与事件、trusted 两轮启动和后续快照超时字段。原完整日志与失败工件在 `.debug/runtime-admission-fix/`。

cleanup.log 记录原失败现场 Terminal 真实 client stop 成功；两个专项使用原 stop helper。所有本轮 Supervisor/provider 已退出。语法、git diff --check 与证据完整性核对通过。

## 接口与依赖

仅使用既有 smoke 命令、诊断及快照，不增加产品 API、依赖或队列。

修订：2026-10-10 建立修复计划，覆盖共用创建与同一 Runtime 用例的显式重启。

修订：2026-10-10 完成正式等待修正及原生验收，登记后续分页快照断言阻塞，清理并归档。
