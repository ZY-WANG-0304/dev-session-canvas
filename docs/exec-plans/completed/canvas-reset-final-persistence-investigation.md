# 定位 Reset 与最终保存的收尾时序

本 ExecPlan 按 `docs/PLANS.md` 维护，覆盖本轮定位、受控验证及结论收口。

## 目标与全局图景

解释 #300 后完整 packaged smoke 在 QuickPick 用例末尾 reset 失败的原因，区分实际保存失败、保存尚未完成时的安全拒绝和夹具假设。用户要求继续定位；本轮先交付可复现的因果证据，不预设产品或测试责任，不通过吞错、强开准入或延长等待获得通过。若需要改变“单次 reset 是否应等待最终保存”的行为，须先明确设计契约，不能把该产品变更伪装成测试修正。

## 进度

- [x] (2026-10-08) 读取工作流、已有计划和设计，从最新 `origin/main@e196d7da` 创建 `canvas-reset-final-persistence`，原分支工作保留。
- [x] (2026-10-08) 确认当前设计 §26.3 明确要求 reset 在保存 pending 时中止；代码检查独立保存结果，没有等待或恢复原 reset 的逻辑。
- [x] (2026-10-08) 核对原 VSIX hash、UTF-16 栈位置及诊断时间线；真实 Host + 文件 writer 复现 owner 已退役、workspaceState 仍 pending。
- [x] (2026-10-08) Agent/Terminal 成功与失败共 4 项验证：晚到保存不改原拒绝；saved 后再次 reset 清空并恢复准入，failed 后继续保留。
- [x] (2026-10-08) 原 bundle 精确定位排队 resize guard；profile 有/无 resize 两项对照证明它不是 pending 拒绝的必要原因。设计、索引、核心信念与原债务已同步。
- [x] (2026-10-08) Node 22.23.3 定向 6/6、完整 Host 接线 302/302、脚本语法及 diff 检查通过；定位交付完成，提交与 PR 是后续协作动作。

## 意外与发现

`docs/design-docs/runtime-exit-integrity-production-integration.md` §26.3 不承诺单次 reset 等待最终保存：原 owner 结果不涵盖 Host 保存 Promise，pending 时主动中止且不新增保存预算。§50 的历史 installed smoke 清理也记录过这一拒绝。本轮已单独核对原失败和后续再次操作。原 resize 消息没有节点身份，只能确认调用位置，不能据此确定具体 Agent 或 guard 条件。

## 决策记录

2026-10-08 / Codex：按“继续定位”的范围验证当前契约和因果链，保留生产与 smoke 行为。现有正式设计显式选择 pending 中止；本轮不是修改产品保证的修复，不把测试首次通过写成先红后绿。

2026-10-08 / Codex：将原工件、真实 Host 文件写入及 profile 的有/无 resize 对照组合为证据，不重跑未经修改的完整 packaged smoke。原失败已被原栈定位且受控重现，没有新修复需要用完整 gate 验收；真实宿主再次 reset 成功和完整 clean-checkout 仍不宣称已验。

## 结果与复盘

定位已完成。产品实现按 §26.3 在保存 pending 时拒绝 reset，夹具却只发送一次并等待空画布，确认了两者的契约差异。原保存成功只释放 record，不再进入 reset 的状态替换；显式再次操作的成功/失败保护已通过受控测试。排队 resize 的 guard 拒绝可独立发生，不是此次 pending 的必要原因。未修改产品、原 smoke 或等待时长，不把现有策略的操作体验认作已闭环；完整 packaged smoke 继续按失败保留，后续修订/产品方案与门禁留在原债务。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是宿主画布状态中心。`resetState()` 经 `prepareForHostBoundary()` 调用 `closeNonNativeHostExecutions()`，后者先等 execution owner（管理原执行、输出和资源责任的对象）关闭，再检查每个 Host record 的独立保存结果。`persistNonNativeHostFinal()` 调用真实 `persistState()`，等待 root-local 文件、workspace 文件及 `workspaceState.update()` 的完成后才记录 `execution/localFinalPersistence`。保存成功只释放记录，不继续已经拒绝的 reset。

`tests/vscode-smoke/extension-tests.cjs` 的 `verifyCreateNodeCommandQuickPick()` 创建 Agent 后发送一次 `webview/resetDemoState`，直接等待空画布。`scripts/test/test-host-execution-owner-wiring.mjs` 用真实 Host 类及真实文件写入提供受控验证，provider 和 VS Code workspaceState 是注入边界，可用 deferred Promise 精确隔离保存窗口。

## 里程碑与工作计划

第一里程碑保留原失败，检查捕获的 host/error、最终保存诊断、状态与执行身份，建立先后顺序。第二里程碑沿现有 persistenceFixture 增加受控用例，先从运行中 Agent/Terminal 发起 reset，暂扣 workspaceState.update，分别验证 pending、成功后静止、再次 reset、真正失败等结果。第三里程碑把可证明事实、产品契约与夹具差异写入正式设计 `docs/design-docs/canvas-reset-final-persistence.md` 和债务。三个里程碑均已完成；无产品代码修复，不声称完整 packaged 门禁通过。

## 具体步骤

在仓库根使用 Node 22 执行：

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='reset final persistence' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    git diff --check

定向测试应观察真实 reset 返回、原节点及文件仍保留、保存结果和 owner 准入；不能通过只测试自行编写的状态模型代替 Host。原工件实际读取兄弟工作树 `../dev-session-canvas3/.debug/packaged-smoke-reload/` 及同树 `dev-session-canvas-0.26.0.vsix`，VSIX SHA256 和原栈见正式设计。新的日志写入忽略目录 `.debug/reset-final-persistence/`。本机 Node 22 路径为 `/tmp/dsc-release-node22/node_modules/node/bin/node`。

## 验证与验收

能够明确回答：是哪一个 await 后触发 pending；保存成功为何不能完成原 reset；当前产品契约是什么；夹具是否确实假定不同语义；再次 reset 是否能恢复。成功/失败判断必须分别包含原 record 保存结果及画布节点状态。保存错误、未知执行和替换身份的既有回归继续保持。未改产品或夹具时不重新宣称 clean-checkout 门禁闭环。

## 幂等性与恢复

Host 受控测试使用独立临时目录，finally 释放 tracker 和保存闸门；不接入用户真实会话、不删除原日志。原失败副本只读，必要对照运行使用新临时路径。分支不合并，不覆盖原用户分支。

## 证据与备注

原日志及 VSIX hash、诊断时间戳、消息数组位置已写入正式设计。原文件写出到 saved 相隔约 22ms，不补造没有时间戳的 reset 拒绝时刻，也不猜测某个具体 workspaceState update 的耗时。

本机 Linux / Node 22.23.3：

    targeted-profile.log: Host execution owner wiring: 6/6 passed (selected 6/302; non-native only).
    host-owner-final.log: Host execution owner wiring: 302/302 passed (selected 302/302; non-native only).
    node --check scripts/test/test-host-execution-owner-wiring.mjs: exit 0
    git diff --check: exit 0

此前 4 项定向及 300 项完整运行也通过，新增 profile 对照后重跑为上述最终结果，不累计数量。日志在 `.debug/reset-final-persistence/`；测试无真实 PTY/native，已有 node-pty external 构建提示保留。

## 接口与依赖

复用真实 `CanvasPanelManager`、`ExecutionOwnerLifecycle`、`SerializedTerminalStateTracker`、现有注入 provider 和 workspaceState 边界，不增加运行时依赖、公共接口、保存预算或自动重试机制。

修订记录：2026-10-08 创建定位计划；同日根据原 VSIX 和六项受控复现收口原因、责任与验证边界，移入 completed。未改变原 packaged gate 的失败状态。
