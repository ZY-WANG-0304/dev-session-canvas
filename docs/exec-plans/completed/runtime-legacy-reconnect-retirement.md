# 统一旧协议重连与退役语义

本 ExecPlan 按 `docs/PLANS.md` 持续维护。分支 `runtime-legacy-reconnect-retirement` 从 `origin/main@2b0a7e26` 创建；PR #309 的共享层整理已合并，本轮不重做 F-02。

## 目标与全局图景

旧 Runtime 会话与新会话采用一致的身份和恢复原则：重连只尝试原 backend/storage/session/kind，不因为连接失败启动替身 Supervisor 或自动运行另一条 Agent CLI。健康旧会话继续使用原协议；用户显式开始新执行时，先按既有规则结算旧绑定，再创建新执行。退役本 Host 的闲置 client 不等于终止共享 Supervisor，也不代表所有会话或后代已退出。

本轮针对已登记的 legacy 默认 restart 竞态与 Agent resume 降级边界，保留请求超时、未知结果、尾部消费、读者及严格删除责任。不迁移旧 live、不修改 root 归属、不做共享存储垃圾回收、不扩展诊断工具。

## 进度

- [x] (2026-10-09) 拉取最新 main、确认工作树干净并建立新分支，核对遗留技术债。
- [x] (2026-10-09) 完成 client/Host/退役调用链和产品契约核对，写入正式方案与受影响验收。
- [x] (2026-10-09) 定向回归先红确认默认重启、连接期误报空闲和 Agent 自动 resume；已实施 client/Host 最小修复，补缺失 ID 的旧意图及 strict delete 迟到结算后的退役通知。
- [x] (2026-10-09) 健康旧绑定、新建显式启动、失败保留身份、其他会话及 reader 隔离的定向回归通过；有限真实 VS Code smoke 通过，独立复核无新确定性 blocker，文档同步并归档，交付同一主题分支。

## 意外与发现

`panel/runtimeSupervisorClient.ts` 的 `ensureConnected()` 在无 owner、无 executionProfile 的 client 上默认允许 restart；Host 初次 `ensureConnected(false)` 不会约束稍后的普通 `request()`，后者无参再次连接。`panel/CanvasPanelManager.ts` 的 `maybeFallbackAgentLiveRuntimeToResume()` 在旧绑定失败时清除 runtimeSessionId、设 pendingLaunch=resume。新 root 排除此路径，但旧会话没有同等保护。

独立复核确认：缺 runtimeSessionId 的 loaded live-runtime 可能落入 snapshot-only 的自动恢复分支；改为历史降级、清旧自动意图而不猜回身份。连接握手尚未产生 RPC 时也必须阻止退役。生产 strict delete 的 first 超时并不等于原尝试已结束，因此增加专用 onSettled 重检，等原请求及 Host finalization 完成后沿既有保护释放 client，不引入通用 idle 框架。

真实 smoke 前三次没有通过。r1/r2 在原端点准备前遇到隔离 global storage 的 0775 权限，被既有 root 安全检查拒绝；r2 还因初始化 pending start 未结算而触发重复启动保护。r3 用私有目录 umask 后 Agent 成功，Terminal 因两个夹具同时启动触发现有 starting=1 准入。r4 改为静态种入 inert 节点、仅显式创建一个 Terminal 端点，两个产品场景通过。没有改变生产权限、准入限制或失败断言。首轮工件在 `.debug/vscode-smoke/runtime-legacy-reconnect/artifacts/`，后两轮在 `/tmp/dsc-legacy-reconnect-r2/` 与 `/tmp/dsc-legacy-reconnect-r3/`，成功在 `/tmp/dsc-legacy-reconnect-r4/`；r3 的具名测试 fake-agent 已发送 TERM 并确认结束。

## 决策记录

2026-10-09：将连接与创建职责分开；原绑定失败不是创建授权。协议能力仍按实际协商，不把旧传输宣称为新分页或尾部保证。具体代码落点与回归根据调用链核对补齐，不引入第二套服务或通用状态框架。

2026-10-09：smoke 只验证受影响恢复与页面路径，不把建两个新执行作为历史恢复前提。目录采用既有私有权限前提，静态节点输入避免与启动准入相争；保留每次失败，不将环境或夹具问题扩成新的工具阶段。

## 上下文与定向

主扩展根为 `extensions/vscode/dev-session-canvas/src/`。`panel/runtimeSupervisorClient.ts` 持有 socket、hello 握手、请求与读者；`panel/CanvasPanelManager.ts` 持有持久绑定、恢复及新建入口、Host client 缓存和退役检查。`panel/runtimeHostBackend.ts` 提供实际启动能力；`supervisor/runtimeSupervisorMain.ts` 持有共享会话和闲置退出责任。旧绑定指已保存的 backend/storage/session/kind，不按当前 workspace 或新 root 地址替换。provider resume 是重新启动 CLI 并读取 provider 历史，不是原 PTY 继续运行。

## 工作计划与里程碑

第一里程碑核对普通 request、hello、attach、旧 Agent 降级、用户显式重启与 client 退役，形成 `docs/design-docs/runtime-legacy-reconnect-retirement.md`。同时核对 `runtime-persistence-modes.md` 及相关 resume 规格，避免只改实现却保留冲突承诺。

第二里程碑以现有 socket/Host 测试为基础补最小回归，先证明外层连接成功后断连不会获准自动启动、重连失败不清原绑定或排队 resume，健康连接仍可用、显式新建仍有启动路径。退役沿用原 reader、在途请求、附着和 reattaching 检查，只修核实的责任缺口。

第三里程碑执行受影响定向测试、类型检查和正常构建，记录精确结果及未验证范围；完成独立复核后归档计划，fetch/rebase、提交推送和创建单一 PR，不自动合并。

## 验证与验收

所有命令在仓库根执行。复用 `scripts/test/test-runtime-supervisor-request-timeout.mjs`、`test-runtime-supervisor-reader-client.mjs`、`test-runtime-host-deactivation-integrity.mjs`、`test-runtime-completed-history.mjs` 与 Host wiring fixture，按实际改动补测试，不默认重跑所有 Agent/平台矩阵。具体新增入口与结果在实现时回填。类型检查为 `npm run typecheck`，正常构建为 `npm run build`，提交前执行 `git diff --check`。

本轮实际结果：`node scripts/test/test-runtime-supervisor-reader-client.mjs` 35/35；`node scripts/test/test-runtime-supervisor-request-timeout.mjs` 37/37，增加完成通知后另跑 strict 迟到证据 1/1。`npm run test:runtime-legacy-reconnect`、`node scripts/test/test-runtime-host-deactivation-integrity.mjs`、`node scripts/test/test-runtime-completed-history.mjs`、`node scripts/test/test-canvas-execution-context.mjs`、`node scripts/test/test-execution-output-sequence.mjs` 均通过。`node scripts/test/test-terminal-paged-projection.mjs` 通过，包含实际 headless xterm writer 50/50 及 Host batch 10/10。`node scripts/test/test-runtime-supervisor-protocol.mjs`、startup-profile 29 项、root-owner-handshake 46 项通过。

Host 接线只选受影响项：`DEV_SESSION_CANVAS_HOST_TEST_FILTER='strict|legacy|original|retir|root' node scripts/test/test-host-execution-owner-wiring.mjs`，127/127（全文件 336 项中选 127），不称全量通过。最终类型、默认构建、smoke 两入口语法及 diff check 均通过。

Linux / VS Code 1.117.0 的两个真实 Host/Webview 场景通过，使用默认 native 产物、受控 provider 元数据和一个显式 Terminal 端点，不是历史 Supervisor 二进制升级或真实 Codex/Claude 验收。复现命令如下，需可用 VS Code/Xvfb，并使用新隔离目录保留此前结果：

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-legacy-reconnect DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dsc-legacy-reconnect-r4 node -e 'process.umask(0o077); import("./scripts/smoke/run-vscode-smoke.mjs")'

    Legacy Runtime reconnect preserves bindings without automatic CLI resume passed.
    VS Code smoke test passed.

## 幂等性与恢复

测试仅使用隔离 socket、临时目录和受控进程，不操作用户已运行的 Supervisor、真实节点或旧 registry。不能通过清空绑定、改写旧终态或删除整个共享目录消除失败。测试可重复执行，清理由 fixture 负责。

## 结果与复盘

本轮完成旧连接授权、失败身份保留及 Host client 退役的有限交付。旧分页测试原先明确期待 legacy 默认 restart，现按新正式契约改为 false；新增 retirement 调用的 AST fixture 补 backend/退役边界，首轮失败保留为测试适配过程，不冒称产品故障。独立复核重跑 Host 新用例和 client 35 项，未发现新确定性 blocker。

不承诺重启故障 Supervisor 或恢复旧进程，不修改 root 归属、shared registry 和旧协议能力；未重跑跨平台/真实 Agent/整套 trusted smoke。技术债原 legacy restart/resume 条目已记录为有限修复完成，历史记录清理、未知结果和旧协议资源保证仍按各自既有边界，不自动生成下一阶段。

修订记录：2026-10-09 创建有限计划，先核对已登记的旧协议语义差异，再落实最小修复。

修订记录：2026-10-09 完成实现、独立复核和受影响验收；补记缺失 ID、严格删除完成通知及三次 smoke 前置失败，归档有限交付，不扩大测试框架。
