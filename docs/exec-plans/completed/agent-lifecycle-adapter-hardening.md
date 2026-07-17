# 加固 Agent lifecycle adapter 与 Codex 提交判定

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

完成后，main-only Extension Development Host 会把 provider lifecycle 所需的 runtime hook 一起放进 staged extension。若安装或 staging 仍意外缺少 hook，Codex 与 Claude 不会声明 lifecycle adapter 已启用，而会显式退回旧 Supervisor 的 PTY 启发式；Claude 不再显示找不到 hook 模块的错误。Codex 启动时的升级菜单、选择菜单或其他只包含方向键和 Enter 的交互不会再被当成用户提交了一轮 prompt；用户输入实际可编辑内容后按提交键仍会立即进入 `running`，回合完成仍只由带 identity 的 `notify` 回调进入 `waiting-input`。

## 进度

- [x] (2026-07-15 23:37 CST) 对照两份 Host diagnostics、main-only staging、hook 注入与 Supervisor 状态机，确认存在“staging 漏 hook”和“菜单 Enter 冒充 prompt submit”两个独立根因。
- [x] (2026-07-15 23:37 CST) 用户确认采用 A + B + C：复制完整 runtime scripts、启动前检查 hook 并 fallback、用可编辑输入证据限定 Codex submit。
- [x] (2026-07-15 23:39 CST) 更新正式设计文档，把 hook 可用性不变量和 Codex submission candidate 规则写入正式方案，并暂时把验证状态改为“验证中”。
- [x] (2026-07-15 23:40 CST) 实现 main-only `scripts/runtime` staging 与 hook preflight；debug staging 和 provider lifecycle 聚焦测试通过。
- [x] (2026-07-15 23:43 CST) 实现共享 Codex submission candidate 状态机，同时接入本地 Host 与 runtime Supervisor；纯逻辑和 Supervisor 协议回归通过。
- [x] (2026-07-15 23:48 CST) 完成聚焦测试、类型检查、构建、正式 VSIX 文件列表和 trusted smoke；所有命令退出码均为 0。
- [x] (2026-07-15 23:50 CST) 将本计划移入 `docs/exec-plans/completed/`，同步设计验证状态和 provider lifecycle 技术债边界。

## 意外与发现

- 观察：main-only staging 的 allow-list 只复制旧的 `claude-file-event-hook.cjs`，但新 lifecycle adapter 从 staged extension root 注入 `agent-lifecycle-hook.cjs`；现有 staging 测试也只断言旧文件存在。
  证据：`scripts/shared/prepare-debug-main-only-extension.mjs` 的 `copiedEntries` 与 `scripts/test/test-debug-launch-config.mjs` 的唯一 hook `access()` 断言。

- 观察：Codex diagnostics 在真实 prompt 文本出现前先记录三次方向键和一次 `intent: submit`；该 Enter 来自启动升级菜单。当前 Host 与 Supervisor 只检查 `submit`，因此在没有真实 provider turn 的情况下写入 `submission-intent / running`。
  证据：`2026-07-15T15-20-54-405Z/diagnostic-events.json` 中 `15:20:12.578Z` 的 submit 早于 `15:20:14.782Z` 的第一段可见文本。

- 观察：trusted smoke staging 会复制整个 `scripts`，正式 `.vscodeignore` 也保留 `scripts/runtime`，所以既有自动化和正式 package 规则没有覆盖 main-only debug staging 的独立 allow-list。
  证据：`prepareMainSmokeHostExtension()` 的目录列表与 `extensions/vscode/dev-session-canvas/.vscodeignore`。

- 观察：submission candidate 能可靠排除 diagnostics 中的控制序列、方向键、SS3 功能键、空白、编辑换行与纯 Enter，但它不是完整 composer mirror。
  证据：共享纯逻辑测试和 Supervisor 协议测试覆盖升级菜单序列并通过；用户输入后完全删除或 provider 本地 slash command 仍没有 direct-TUI turn-start identity 可供最终确认。

## 决策记录

- 决策：main-only staging 复制 `scripts/runtime` 目录，而不是继续逐个列举 runtime hook。
  理由：runtime scripts 是扩展运行时依赖；目录级复制与 smoke/package 边界一致，也避免新增下一支 runtime hook 时再次遗漏。
  日期/作者：2026-07-15 / Codex，经用户确认。

- 决策：adapter 只有在 `agent-lifecycle-hook.cjs` 启动前真实存在时才能声明 lifecycle enabled；缺失时不注入坏命令，并记录 `agent-lifecycle-hook-missing` fallback reason。
  理由：callback server 可用不代表 callback executable 可用。fail closed 到旧启发式可以避免永久 `running` 和 Claude hook error。
  日期/作者：2026-07-15 / Codex，经用户确认。

- 决策：Codex 的 `submit` 必须消费当前进程内已记录的“可编辑输入候选”。控制序列、方向键、空白、编辑换行与纯 Enter 不建立候选；可见非空文本或粘贴建立候选；submit 与 interrupt 会清空候选。
  理由：direct-TUI `notify` 只有 completion，没有 turn-start。该窄门槛不解析 provider 屏幕文案，能处理启动菜单，同时保持 IME、虚拟键盘和平台换行键兼容。
  日期/作者：2026-07-15 / Codex，经用户确认。

- 决策：不恢复 lifecycle-enabled 普通回合的 prompt/1600ms completion heuristic。
  理由：那会重新引入真实运行中被误判 `waiting-input` 的原始问题。hook 不可用时才整体 fallback。
  日期/作者：2026-07-15 / Codex，经用户确认。

## 结果与复盘

A + B + C 已全部完成。main-only staged extension 现在复制完整 `scripts/runtime`，实际重建后同时包含 `agent-lifecycle-hook.cjs` 与 `claude-file-event-hook.cjs`。Codex 与 Claude adapter 在注入命令前验证 lifecycle hook 是普通文件；缺失时保留原始 argv/settings、记录 `agent-lifecycle-hook-missing`，并让已有 lifecycle capability gate 回到 heuristic，避免 Claude hook error 和等待不存在 completion 的永久 `running`。

Codex 提交判定由 `agentProviderLifecycle.ts` 的共享 candidate 函数统一，Host 与 Supervisor 不再各自解释控制输入。协议测试先发送方向键和 Enter，确认来源不变成 `submission-intent`，再发送实际文本和 submit，确认超过 1600ms 仍为 `running`，最后由带 thread/turn identity 的 notify 进入 `waiting-input`。本轮没有恢复普通回合的 prompt/quiet completion heuristic，也没有引入 app-server。

验证全部通过：debug staging、provider lifecycle、runtime Supervisor protocol、typecheck、build、正式 VSIX 文件列表以及完整 trusted VSCode smoke。残余边界是 completion-only direct TUI 无法完美识别“输入后全部删除”和不产生 provider turn 的本地 slash command；它们已同步进技术债 tracker，不阻塞本次已复现的升级菜单与缺 hook 修复。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts` 为 Codex 构造 `notify` argv，并为 Claude 合并临时 `--settings` hooks。它从 VSCode 提供的 extension root 解析 `scripts/runtime/agent-lifecycle-hook.cjs`。`scripts/shared/prepare-debug-main-only-extension.mjs` 为 main-only Development Host 构建一个去掉 companion dependency 的 staged extension root；如果这里没复制 hook，adapter 当前仍会错误地把 lifecycle 标成启用。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 拥有本地 PTY 会话，也维护 Supervisor 会话在 Host 中的投影。`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 拥有 live-runtime PTY。两处都消费 `AgentInputIntent`，并在 Codex submit 时调用 `recordCodexSubmission()`。共享状态和规则应放在 `extensions/vscode/dev-session-canvas/src/common/agentProviderLifecycle.ts`，避免两条 owner 路径漂移。

这里的“submission candidate”是一个进程内布尔状态：它只表示自上一次 submit/interrupt 以来是否观察到可组成真实 prompt 的可见非空输入，不尝试完整镜像 Codex composer。它不是 provider turn identity，也不能替代 completion callback。

## 工作计划

先更新 `docs/design-docs/agent-running-state-detection.md`，把本次 diagnostics 暴露的新不变量写入正式方案并把验证状态暂时改为“验证中”。然后让 debug staging 复制 `scripts/runtime`，增强 staging 测试。接着在 `agentFileActivity.ts` 中对共享 lifecycle hook 做存在性检查，缺失时保持原 argv/settings 不变并返回明确 fallback reason；聚焦测试应分别覆盖 Codex 和 Claude。

随后在共享 lifecycle state 中加入 Codex submission candidate。输入观察函数先剥离终端控制序列，只把可见非空字符当作编辑证据；legacy 无 intent 且同一 chunk 包含文本与回车时也应正常提交。Host 与 Supervisor 在现有 `isAgentInstructionSubmission()` 位置调用同一个共享函数，Claude 与没有 provider metadata 的兼容路径保持原行为。

最后运行聚焦测试、Supervisor 协议测试、类型检查和构建。若环境允许，运行 trusted VSCode smoke；完成后更新正式设计的验证证据，将本计划移入 completed，并检查技术债 tracker 是否需要登记新的未解决项。

## 具体步骤

所有命令均在仓库根目录执行：

    npm run test:debug-launch-config
    npm run test:agent-provider-lifecycle
    npm run test:runtime-supervisor-protocol
    npm run typecheck
    npm run build
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs

实际 npm script 名称以根 `package.json` 为准；若不存在单独别名，直接运行对应 `node scripts/test/<file>`。成功时聚焦测试应输出各自的 `... tests passed`，typecheck/build 应以退出码 0 完成。

## 验证与验收

自动化必须证明以下行为：main-only staged root 同时包含两个 runtime hook；缺 lifecycle hook 的临时 extension root 不会向 Codex 注入 `notify`，也不会向 Claude 生成 lifecycle settings，且 fallback reason 可诊断；Claude `--safe-mode` / `--bare` 保留原始 argv、关闭 lifecycle capability 与文件活动 hook env，并返回对应 fallback reason；方向键控制序列后直接 submit 不会调用 Codex `recordCodexSubmission`；可见文本、IME 产出的文本、普通或 bracketed paste 后 submit 会进入 `running`；编辑换行不提交；legacy `text + CR` 单 chunk 仍兼容。

Supervisor 协议测试必须先发送模拟升级菜单的控制输入和 Enter，确认状态来源没有变成 `submission-intent`，再发送实际文本和 submit，确认超过 1600ms 仍为 `running`，最后由带 `thread-id + turn-id` 的 hook callback 进入 `waiting-input`。

## 幂等性与恢复

staging 准备和测试目录创建本来就是先删除再重建，可安全重复。所有源文件修改通过小范围 patch 完成，不删除用户文件。若某个验证失败，应保留失败输出并继续修正当前主题文件，不用 reset 或 checkout；`image.png` 是用户未跟踪文件，始终忽略。

## 证据与备注

诊断阶段的关键证据：

    Codex launchArgs notify=.../.debug/vscode-extension-main-only/scripts/runtime/agent-lifecycle-hook.cjs
    15:20:12.578Z inputWritten data="\\r" intent="submit"
    15:20:14.782Z inputWritten preview="我的" intent="text"
    Claude Stop hook error: MODULE_NOT_FOUND .../agent-lifecycle-hook.cjs

## 接口与依赖

不新增外部依赖。`AgentProviderLifecycleState` 增加一个进程内 Codex submission candidate 字段；`agentProviderLifecycle.ts` 导出一个消费 `data + AgentInputIntent` 的共享函数，返回本次输入是否构成真实 Codex instruction submission。`AgentFileActivitySession.getProviderLifecycleFallbackReason()` 继续作为 preflight 失败的诊断接口。runtime protocol 不新增 wire 字段或 capability；已有 `agentSubmissionIntentV1` 足以传递 submit/text/paste/interrupt。

计划修订说明：2026-07-15 创建本计划，记录用户确认的 A + B + C、两项诊断根因、实现边界与验证要求。

计划修订说明：2026-07-15 完成正式设计、main-only runtime staging 和 lifecycle hook preflight；聚焦测试证明 staged hook 与 Codex/Claude 缺文件 fallback 生效，下一步进入共享提交候选实现。

计划修订说明：2026-07-15 完成共享 Codex submission candidate 及 Host/Supervisor 接线；协议测试已复现并阻止升级菜单 Enter 冒充 turn start，开始运行完整静态与 smoke 验证。

计划修订说明：2026-07-15 所有验证通过，完成设计、技术债和结果收口，并将计划移入 completed。

计划修订说明：2026-07-17 根据 PR blocker 补充 Claude hooks-disabled launch mode preflight；`--safe-mode` / `--bare` 现在显式回退 heuristic，并纳入聚焦测试与正式设计边界。
