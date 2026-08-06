# 将 Agent provider callback 收口为辅助增强信号

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

完成后，Codex `notify` 和 Claude hooks 是否被 provider、用户配置或启动模式禁用，都不会决定 Agent 基础状态机能否工作。用户输入真实 prompt 并提交后，Codex 与 Claude 都会由共享提交判定进入 `running`；PTY 出现 prompt、notification 或 bell 等等待输入证据后，基础 heuristic 可以进入 `waiting-input`。若 Codex `agent-turn-complete` 或 Claude `UserPromptSubmit`、`Stop`、`StopFailure` callback 到达，它们会更早确认或纠正当前状态，并补充 provider session/turn identity、失败 outcome 与 attention，但 callback 缺失不会关闭基础判定。

可观察验收包括三类场景：一个三秒静默回合不能再被 1600ms quiet 提前结束；callback 正常到达时仍能立即投影 provider identity 与 outcome；callback 配置存在但实际不送达时，终端最终打印 prompt 后仍能回到 `waiting-input`。Claude 仅通过继承环境启用 safe/simple mode 时也不得注入明知不会执行的 hooks 或文件活动 env。

## 进度

- [x] (2026-07-21 00:00 CST) 复核当前分支、正式设计、基础 heuristic、Host/Supervisor capability gate 和最新 review，确认静态 `lifecycleEnabled` 把“配置成功”错误提升为“callback 必达”。
- [x] (2026-07-21 00:00 CST) 用户确认 Codex notify 与 Claude hooks 只作为辅助增强信号，不作为主判定方案。
- [x] (2026-07-21 00:20 CST) 更新正式设计、能力矩阵和技术债口径，把 provider callback 从排他主路径改为正向增强。
- [x] (2026-07-21 00:28 CST) 统一 Codex/Claude 提交候选，在 Host 与 Supervisor 中移除 `lifecycleEnabled` 对基础提交和 heuristic 的 gate。
- [x] (2026-07-21 00:28 CST) 限制普通 `running` 的无条件 hard fallback，并保留启动、恢复和明确中断的 recovery。
- [x] (2026-07-21 00:45 CST) 为 Claude delayed `UserPromptSubmit` 增加提交时间保护，阻止上一回合的延迟 start/stop 事件对认领并结束下一回合。
- [x] (2026-07-21 08:59 CST) 补齐 Claude safe/simple 环境 preflight，以及 callback 正常、延迟、缺失和禁用模式回归。
- [x] (2026-07-21 08:59 CST) 完成聚焦测试、类型检查、构建、package 文件列表和 trusted smoke，并将本计划移入 completed。

## 意外与发现

- 观察：当前 Host 与 Supervisor 只有在 `lifecycleEnabled=false` 时才通过用户提交进入 `running`；Claude hooks 被 `--safe-mode`、`--bare`、`CLAUDE_CODE_SAFE_MODE=1` 或 `CLAUDE_CODE_SIMPLE=1` 禁用时，如果 adapter 误报 enabled，节点会稳定停在 `waiting-input`。
  证据：`CanvasPanelManager.ts` 与 `runtimeSupervisorMain.ts` 的 input owner 分支都用 `lifecycleEnabled` 排除 Claude submit fallback；PR review 在 Claude Code 2.1.209 上用无模型请求实验确认两个环境变量会跳过 hooks。

- 观察：仅删除上述 gate 会让当前 1600ms hard fallback 再次结束真实的静默长回合。
  证据：`agentActivityHeuristics.ts` 在没有 spinner 时无条件按 1600ms quiet 返回 `fallback`；现有 Supervisor 协议与 trusted smoke 特意用 2.3 秒 callback 和三秒 sleep 证明当前 gate 阻止了该误判。

- 观察：provider callback 提供的是可靠正向证据，但“没有 callback”无法区分禁用、配置冲突、传输失败、provider 仍运行或版本行为变化。
  证据：Codex direct-TUI 只有 completion notify，没有 session-start handshake；Claude hooks 同时受启动 flag、环境、settings source 与其他 hook block 影响。

- 观察：不需要新增 wire capability 就能完成语义调整；`providerLifecycleEnabled` 可保留为 callback configured 诊断，删除 Host/Supervisor 对它的 gate 后旧 snapshot 仍可读取。
  证据：聚焦搜索确认该字段在 owner 状态推进中的剩余引用只负责诊断与 snapshot 序列化；`test:agent-provider-lifecycle`、`test:runtime-supervisor-protocol` 和 typecheck 已通过。

- 观察：只校验 Claude completion 的 prompt identity 还不足以保护下一回合；如果上一回合的 `UserPromptSubmit` 和 `Stop` 成对延迟到新提交之后，旧 start 会先占用当前 active turn，随后旧 Stop 仍可结束新回合。
  证据：Claude hook 已携带 `observedAtMs`，但原 reducer 只在 Codex completion 路径比较该时间与当前 `activeTurnStartedAtMs`；本轮为 Claude start 增加同类保护并补充延迟事件对回归。

## 决策记录

- 决策：provider callback 只增强基础状态机，不再通过 `lifecycleEnabled` 关闭提交或 heuristic。
  理由：callback 到达可以证明事件发生，配置成功不能证明未来事件必达。基础体验不能依赖用户环境和 provider 可选回调机制。
  日期/作者：2026-07-21 / 用户确认，Codex 记录。

- 决策：共享可编辑输入 candidate 同时服务 Codex 与 Claude。
  理由：Claude 失去 `UserPromptSubmit` 排他 turn-start 后也必须从终端提交进入 `running`；方向键、控制序列、空白和纯 Enter 不应把 provider 菜单冒充成用户 prompt。
  日期/作者：2026-07-21 / Codex。

- 决策：普通 `running` 不使用 1600ms 无条件 hard fallback，只接受 prompt/notification/bell 等正向 PTY 证据或 provider completion；hard fallback 仅用于 `starting`、`resuming` 和已明确 arm 的 interrupt recovery。
  理由：这样基础 heuristic 始终运行，同时不会把单纯“最近没输出”重新当成普通长回合完成。若 provider 完成后既不打印可识别 prompt、也不发任何 callback/terminal signal，状态仍可能高估为 running；这是 plain PTY 的固有限制，优先于频繁提前误判。
  日期/作者：2026-07-21 / Codex。

- 决策：Claude env preflight 只把已实验证实的值 `1` 当作 hooks-disabled，并保留原 argv/env。
  理由：不能把变量仅存在、空值、`0` 或未经验证的文本误判为 provider 已禁用 hooks；preflight 只用于避免无效增强配置和改善诊断，不承担基础状态正确性。
  日期/作者：2026-07-21 / Codex。

- 决策：Claude `turn-started` 与 Codex completion 一样，必须拒绝早于当前 derived submission 的 `observedAtMs`。
  理由：session/turn identity 只有在 start 已正确关联当前提交后才能阻止 stale completion；增加时间下界可以在旧 start/stop 成对延迟时保护下一回合。
  日期/作者：2026-07-21 / Codex。

## 结果与复盘

本计划已完成。Codex 与 Claude 现在都由共享的可编辑输入 candidate 和明确 submit 进入 `running`，并持续使用 PTY prompt/notification/bell 正向证据进入 `waiting-input`；callback configured 与否不再 gate 这条基础路径。Codex notify 与 Claude `UserPromptSubmit/Stop/StopFailure` 保留为增强信号：到达时更早确认状态并补 identity/outcome/error，缺失时不阻断状态流转。

普通 `running` 已禁止 1600ms quiet-only hard fallback，避免重新引入长静默回合提前结束；该 fallback 仅保留给启动、恢复和已 arm 的 interrupt recovery。Claude safe/simple argv/env 会跳过无效 hook 注入，但这只改善增强能力诊断。上一回合延迟的 Claude start/stop 事件对也会由提交时间、session/turn identity 共同拒绝。

验证结果全部通过：`test:agent-provider-lifecycle`、`test:runtime-supervisor-protocol`、`test:debug-launch-config`、`test:protocol-webview-messages`、`test:agent-launch-presets`、`test:package-vsix-file-list`、`typecheck`、`build` 与 trusted VS Code smoke；smoke 最终输出 `Trusted workspace smoke passed.` 和 `VS Code smoke test passed.`。本轮没有引入新的独立技术债条目，而是把既有 provider lifecycle 条目重定向为“PTY 基础 heuristic 与 callback 增强的精度边界”。plain PTY 在既无可识别 prompt、也无 callback/terminal signal 时仍可能高估 `running`，这是保留 interactive PTY 且拒绝 app-server 方案后的明确取舍。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts` 是 Host 与 Supervisor 共用的 PTY 输出判断器。它记录 prompt 尾部、OSC notification、bell、spinner 和最近输出时间。`evaluateAgentWaitingInputTransition()` 包含由调用方显式控制的 1600ms hard fallback。

`extensions/vscode/dev-session-canvas/src/common/agentProviderLifecycle.ts` 保存 provider session/turn identity、状态来源、权威性、StopFailure outcome 与共享输入 candidate。submission helper 同时服务 Codex 与 Claude，并继续保留 legacy 客户端没有 intent 时的 CR/LF 兼容。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 拥有本地 PTY 并投影节点状态。`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 拥有 live-runtime PTY。两者必须调用相同 shared helper，不能各自解释提交或 callback。`providerLifecycleEnabled` 是现有 Supervisor wire/snapshot 字段；为兼容旧 generation，本轮保留字段名，把它解释为“增强 callback 已配置”，但不再用它 gate 基础状态机。

`extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts` 为 Codex 注入 notify，为 Claude 合并临时 settings。它同时识别 argv 中的 `--safe-mode` / `--bare` 和最终 launch env 中已验证的 `CLAUDE_CODE_SAFE_MODE=1` / `CLAUDE_CODE_SIMPLE=1`。

## 工作计划

先更新 `docs/design-docs/agent-running-state-detection.md`，把“provider 事件优先且排他、heuristic 只在 adapter 不可用时启用”改成“基础提交与 PTY 证据持续工作、provider callback 只提供正向增强”。同时把验证状态改为验证中并同步索引、provider capability matrix 与技术债 tracker。

随后在 `agentProviderLifecycle.ts` 中把 Codex-only candidate 泛化为 Agent candidate，并提供通用 submission 记录函数。Host 和 Supervisor 对拥有 provider lifecycle state 的 Codex/Claude 都使用该 candidate；真实提交一律记录 `submission-intent / derived` 并进入 `running`。interrupt 只允许在当前可见 lifecycle 为 `running` 时 arm，避免 heuristic 已进入等待输入后仍把旧 provider correlation 当成活动回合。

接着修改 heuristic evaluator，使调用方可以禁止普通 hard fallback。Host 与 Supervisor 始终调度 prompt/notification heuristic；状态为普通 `running` 且没有 interrupt 时不允许 1600ms quiet 单独结束，`starting`、`resuming` 和 interrupt recovery 仍允许。heuristic 命中时把 activity source 写回 `heuristic / best-effort`；provider start/completion 后续到达时仍可把来源升级为 `provider-lifecycle / authoritative`，延迟旧 turn 必须继续被 identity/time 校验拒绝。

最后让 Claude launch preflight 同时读取最终 env。新增纯逻辑和 launch integration 测试覆盖 `=1` 与 inactive 值；改写 Supervisor protocol 和 smoke 断言，证明 callback 只是加速器而不是基础状态机开关。完成所有验证后更新设计证据、技术债和 PR 描述，提交并 rebase 最新 `origin/main` 后推送。

## 具体步骤

所有命令在仓库根目录执行：

    npm run test:agent-provider-lifecycle
    npm run test:runtime-supervisor-protocol
    npm run test:debug-launch-config
    npm run typecheck
    npm run build
    npm run test:package-vsix-file-list
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
    git diff --check

成功时聚焦测试分别输出 `agent provider lifecycle tests passed`、`runtimeSupervisorProtocol tests passed` 和 `debug launch configuration tests passed`；typecheck/build/diff check 退出码为 0；smoke 最终输出 `Trusted workspace smoke passed.` 与 `VS Code smoke test passed.`。

## 验证与验收

共享逻辑测试必须证明两种 provider 的方向键/纯 Enter 不提交、可见文本或 paste 后 submit 进入 `submission-intent / running`，Claude `UserPromptSubmit` 可以升级 provider identity，Stop/StopFailure 可以提前结束并保留 outcome，stale session/turn 仍拒绝。

heuristic 测试或协议测试必须证明：普通 `running` 在 1600ms quiet 后仍保持 running；打印 prompt 后即使 callback 永不到达也进入 waiting-input；provider completion 先到时立即进入 waiting-input；heuristic 先到、completion 后到时状态保持 waiting-input 但 metadata 升级；明确 interrupt 仍能用 hard fallback recovery。

Claude launch integration 必须覆盖 argv flag、仅 env `CLAUDE_CODE_SAFE_MODE=1`、仅 env `CLAUDE_CODE_SIMPLE=1`、inactive env 值和缺 hook 文件。hooks-disabled 时原 argv 不变、lifecycle 增强 capability 为 false、不设置文件活动 env，并返回明确 fallback reason。

## 幂等性与恢复

测试临时目录由现有脚本创建并在 finally 中清理，可重复执行。代码和文档使用小范围 patch；不删除或暂存用户的 `image.png`。如果 rebase 遇到冲突，只处理当前主题文件并重新运行受影响验证，不使用 reset、checkout 或 merge main。

## 证据与备注

当前 review 的关键复现是：argv 为空、env 仅含 `CLAUDE_CODE_SAFE_MODE=1` 或 `CLAUDE_CODE_SIMPLE=1` 时，adapter 仍返回 `lifecycleEnabled=true` 并注入 settings/file activity env，而 Claude Code 2.1.209 实验确认 hook marker 不会产生。

当前 Supervisor 回归脚本用 2300ms Codex callback 证明 lifecycle gate 阻止 1600ms fallback；trusted smoke 用 `sleep 3` Claude 回合证明同一点。本轮要保留“超过 1600ms 仍 running”的用户结果，但原因改为普通 running 禁止无条件 hard fallback，而不是 callback capability 排他。

最终验证记录：

    agent provider lifecycle tests passed
    runtimeSupervisorProtocol tests passed
    debug launch configuration tests passed
    Trusted workspace smoke passed.
    VS Code smoke test passed.

## 接口与依赖

不新增外部依赖，不切换 Codex app-server，也不把 Claude 执行面改成 SDK/headless stream。`agentActivityHeuristics.ts` 的 evaluator 增加可选 hard-fallback policy；`agentProviderLifecycle.ts` 导出 provider-neutral 的 candidate/submission helper。现有 callback envelope、runtime session/process epoch/nonce/provider identity、Supervisor capability 与 snapshot wire 字段保持兼容。

计划修订说明：2026-07-21 创建本计划，记录用户将 notify/hooks 定位为辅助增强信号的设计反转、基础 heuristic 的 hard-fallback 边界和 env review 收口要求。

计划修订说明：2026-07-21 完成正式设计与核心实现；共享测试证明普通 quiet-only 不结束 running，Supervisor 测试证明 callback configured 但不送达时可由后续 prompt heuristic 收尾，开始最终验证。

计划修订说明：2026-07-21 完成跨回合 delayed Claude start/stop 保护与全部验证，记录 plain PTY 残余边界并将计划移入 completed。
