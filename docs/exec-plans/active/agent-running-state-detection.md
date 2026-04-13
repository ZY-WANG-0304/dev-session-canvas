# Agent 运行态判定研究与接入路线

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件遵循 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

当前画布里的 `Agent` 节点已经把状态语义定义为 `running` 与 `waiting-input` 两个不同阶段，但宿主还拿不到 provider 原生的“这一轮开始了 / 这一轮结束了 / 现在只是在等用户输入”的权威信号，所以实现上仍然靠 PTY 输入和输出静默时间去猜。这会直接导致用户看到的状态偶尔漂移，尤其是在交互式 CLI 自己刷新 UI、输出分片不稳定或等待审批时。

本计划要把“Agent 是否还在运行中”从局部补丁收口成正式设计研究：明确成熟方案的优先级，确认哪些 provider 已有官方能力可用，哪些场景仍只能 best-effort，并为后续实现给出最小接入路线。完成后，下一位实现者应能据此把 `Agent` 的运行态判定升级为“优先读 provider 原生事件，必要时才回退到结构化输出、shell integration 和 PTY 启发式”。

## 进度

- [x] 2026-04-12 21:56+08:00 读取 `docs/PLANS.md`、`docs/DESIGN.md` 与现有生命周期设计文档，确认这项工作属于需要单独设计阶段 `ExecPlan` 的复杂设计研究。
- [x] 2026-04-12 21:56+08:00 复核当前实现，确认 `src/panel/CanvasPanelManager.ts` 里 `isAgentInstructionSubmission()` 只按回车/换行把节点切到 `running`，而 `queueAgentWaitingInput()` 仍通过 380ms 输出静默把节点切回 `waiting-input`。
- [x] 2026-04-12 21:56+08:00 查阅官方资料，整理 `Codex`、`Claude Code` 与 VS Code shell integration 中可用于运行态判定的 machine-readable 信号面。
- [x] 2026-04-12 21:56+08:00 新建设计文档 `docs/design-docs/agent-running-state-detection.md`，把候选方案、风险与当前结论写成正式仓库事实。
- [x] 2026-04-12 21:56+08:00 更新 `docs/design-docs/execution-lifecycle-and-recovery.md` 与 `docs/design-docs/index.md`，把“状态语义”和“状态判定来源”拆开记录。
- [x] 2026-04-13 00:20+08:00 新增共享启发式模块 `src/common/agentActivityHeuristics.ts`，把 prompt、通知、bell、spinner/redraw 与 hard fallback 收口成统一状态评估逻辑。
- [x] 2026-04-13 00:20+08:00 将同一套启发式同时接入 `src/panel/CanvasPanelManager.ts` 与 `src/supervisor/runtimeSupervisorMain.ts`，统一本地 PTY 与 runtime supervisor 的 Agent 状态回退行为。
- [x] 2026-04-13 00:34+08:00 为 fake provider 增加 `slowspin` / `notify` 测试能力，并在 `tests/vscode-smoke/extension-tests.cjs` 新增 spinner 持续输出回归验证。
- [x] 2026-04-13 00:49+08:00 完成验证：`npm run typecheck`、`npm run build`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs` 全部通过。
- [x] 2026-04-13 06:44+08:00 完成全量验证：`npm run test` 通过，覆盖 `test:runtime-supervisor-paths`、完整 `test:smoke` 与 `test:webview`。
- [x] 2026-04-13 08:10+08:00 根据 MR review 修复两个确定性 blocker：提交首条输入时即使仍处于 `starting/resuming` 也会进入 `running`；普通换行不再单独触发 `waiting-input`，并补充 local/runtime + start/resume 的回归覆盖。
- [x] 2026-04-13 08:40+08:00 复核 review 修复后的完整验证：单独 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen node scripts/run-vscode-smoke.mjs` 通过，随后 `npm run test` 再次全量通过，确认上一轮 full test 失败属于场景级抖动而非本轮逻辑回归。
- [ ] 后续独立特性：验证 `Codex app-server` / provider 原生结构化事件是否可作为权威状态通道；该项已从本轮 BUG 修复中拆出，另行优化。
- [ ] 后续独立特性：为节点 metadata 增加“状态判定来源/权威性”字段，避免 UI 和诊断把启发式状态误写成权威事实。

## 意外与发现

- 观察：当前 BUG 的核心不是状态枚举定义错了，而是宿主缺少 provider 原生 turn/activity 信号，导致 `running` 与 `waiting-input` 只能从 PTY 行为反推。
  证据：`src/panel/CanvasPanelManager.ts` 里 `writeExecutionInput` 仅在输入包含 `\r` 或 `\n` 时切换到 `running`；`handleSessionChunk` 里 `queueAgentWaitingInput()` 用 380ms 静默把 `running` 退回 `waiting-input`。

- 观察：OpenAI 官方 `Codex app-server` 已经公开了结构化线程与回合事件，包含 `turn/started`、`turn/completed` 与 `thread/status/changed`，并且线程状态里有 `waitingOnApproval` 这样的活动标记。
  证据：2026-04-12 查阅 `https://developers.openai.com/codex/app-server`，页面示例包含 `turn/started`、`turn/completed`、`thread/status/changed` 与 `activeFlags.waitingOnApproval`。

- 观察：Anthropic 官方已经为 `Claude Code` 暴露了两类结构化集成面：一类是 Agent SDK 的流式消息与 session id；另一类是 headless/CLI 的 `--output-format stream-json` 与 hooks。
  证据：2026-04-12 查阅 `https://docs.anthropic.com/en/docs/claude-code/sdk`、`https://code.claude.com/docs/en/headless` 与 `https://code.claude.com/docs/en/hooks`，文档分别展示了 `query()`/`ClaudeSDKClient` 的消息流、`--output-format stream-json`，以及 `Stop`/`Notification` hooks。

- 观察：VS Code shell integration 的成熟能力只覆盖“shell 命令开始/结束/prompt 边界”，不能可靠代表交互式 Agent TUI 内部的一轮推理是否结束。
  证据：2026-04-12 查阅 `https://code.visualstudio.com/docs/terminal/shell-integration` 与 `https://code.visualstudio.com/api/references/vscode-api`，官方能力聚焦 `OSC 633` 序列、prompt 边界和 `onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`。

- 观察：单纯把“最后一次输出时间”作为回退依据会在 spinner/redraw 型输出下过早把 `running` 判成 `waiting-input`。
  证据：本轮为 fake provider 新增 `slowspin 3` 后，持续 0.55s 一次的 `\r` 覆写输出会长时间没有换行，如果仍使用固定 quiet timeout，会在 spinner 尚未结束时提前回退。

- 观察：本地 PTY 路径和 runtime supervisor 路径必须复用同一套 Agent 活动启发式，否则 reopen/reattach 后会重新暴露旧行为。
  证据：`src/panel/CanvasPanelManager.ts` 与 `src/supervisor/runtimeSupervisorMain.ts` 之前各自维护独立状态推进逻辑；本轮 smoke 里 `trusted` 与 `real-reopen` 都需要覆盖，才能证明行为一致。

- 观察：普通换行不能被直接解释成“当前回合结束”，因为长任务可能先输出一整行日志，再在静默中继续执行。
  证据：fake provider 的 `sleep 1` 会先输出 `[fake-agent] sleeping 1s\n`，随后实际继续 `sleep 1`；若 420ms 后仅凭 line-boundary 回退，就会在任务仍运行时误判成 `waiting-input`。

## 决策记录

- 决策：把 `Agent` 的生命周期语义与“这些状态是怎么判出来的”分开建模。
  理由：`waiting-input` 与 `running` 仍然是对用户有价值的产品语义，但当前实现并不总能以权威信号得出它们；如果不把“状态值”和“判定权威性”拆开，后续仍会把启发式结果误写成真实 provider 状态。
  日期/作者：2026-04-12 / Codex

- 决策：长期正式路线优先采用 provider 原生的结构化 turn/session 事件，不再把 PTY 静默推断当成目标态。
  理由：只有 provider 自己的 machine-readable 事件，才能稳定回答“当前一轮是否已结束、是否正在等待下一次用户输入”，而不是把 UI 输出节奏误当作状态机。
  日期/作者：2026-04-12 / Codex

- 决策：把 shell integration 定位为 `Terminal` 节点和 agent 内部 shell command 生命周期的辅助信号，而不是 `Agent` 主状态的权威来源。
  理由：shell integration 观察的是 shell prompt 与命令执行，不是 provider TUI 的对话回合；两者边界不同，不能直接混用。
  日期/作者：2026-04-12 / Codex

- 决策：当前已落地的“提交后进入 `running`、输出静默后回到 `waiting-input`”继续作为 fallback 保留，但必须被显式标记为 best-effort。
  理由：在 provider 原生事件尚未接入前，产品仍需要一个最小可用状态反馈；但这条路径只能作为过渡实现，不应继续被包装成成熟方案。
  日期/作者：2026-04-12 / Codex

- 决策：本轮 BUG 修复继续保持 CLI PTY 为主执行通道，不改为 `app-server` 或 provider 原生 sidecar；`app-server` 作为独立未来特性登记，不混入当前修复范围。
  理由：用户当前要解决的是现有交互模式下的错误状态切换，而不是切换整体运行形态；先在既有 PTY 路径内收紧误判窗口，风险更低，也更符合当前需求边界。
  日期/作者：2026-04-13 / Codex

- 决策：把 prompt、OSC 通知、bell、行边界、spinner/redraw grace 与 hard fallback 提炼成共享 helper，并在 local/runtime 两条 Agent 路径复用。
  理由：如果仍让两条路径各自维护状态回退规则，`reopen` 与 `reattach` 会继续和首次启动表现不一致；共享 helper 可以把这一版 fallback 收敛为单一事实来源。
  日期/作者：2026-04-13 / Codex

- 决策：普通 line-boundary 只保留为诊断线索，不再单独触发 `waiting-input`。
  理由：换行只能说明“输出排版结束”，不能说明“回合结束”；把它当完成信号会稳定误伤 `sleep`、审批等待或其他静默执行中的长任务。
  日期/作者：2026-04-13 / Codex

## 结果与复盘

本轮已经完成的不再只是“把问题定义清楚”，还包括把当前 CLI PTY 路径上的状态误判收敛到一版可工作的组合启发式。当前结论仍然不变：如果继续停留在 PTY 文本和静默超时层面，这个 BUG 只能被明显缓解，不能被 provider 原生语义彻底根治。

研究后的推荐顺序也已经明确：

当前版本已经落地的内容是：

第一，`running` 只在真正提交指令时进入，用户单纯编辑输入中的中间状态不再误报为 `running`。

第二，`waiting-input` 的回退不再只看一个固定 quiet timeout，而是综合 prompt-like 尾部、`OSC 9/777`、bell、spinner/redraw grace 与 hard fallback；普通换行不再被直接当作完成信号。

第三，同一套启发式已经同时接入 local PTY 与 runtime supervisor，因此 `trusted` 和 `real-reopen` 路径下的状态机行为一致。

研究后的长期推荐顺序仍然明确：

第一优先级是 provider 原生事件流。对 `Codex`，官方 `app-server` 已经给出线程与回合事件，这是最接近“权威状态机”的路线。对 `Claude Code`，官方公开材料更偏向 SDK、headless 与 hooks，这意味着 plain interactive TTY 模式下想得到稳定 turn 边界，通常也需要显式打开额外的结构化通道。

第二优先级是 provider 自己的结构化 CLI/SDK 输出，例如 `stream-json`、SDK message stream 或 hooks。它们比 PTY 屏幕解析成熟得多，但不同 provider 的覆盖面和交互模式不同，需要逐个接入。

第三优先级才是 shell integration 与 prompt 边界。它适合 `Terminal` 节点，也适合观测 agent 代表用户执行的 shell command，但不能单独回答“Agent 这一轮是否结束”。

最后才是当前仓库已经在用的 PTY 启发式。它仍有保留价值，也已经在本轮被升级为更稳的组合启发式，但依然只能作为没有更好信号时的兜底。

## 上下文与定向

当前仓库里与这个问题直接相关的代码有四处：

`src/common/protocol.ts` 定义 `AgentNodeStatus`，其中 `waiting-input` 与 `running` 都已经是正式状态值，但 metadata 里还没有字段区分这些状态来自“权威事件”还是“启发式推断”。

`src/panel/CanvasPanelManager.ts` 在 `writeExecutionInput()` 中处理用户输入，在 `handleSessionChunk()` 与 `queueAgentWaitingInput()` 中处理输出和静默回退。它是当前 `Agent` 运行态判定的唯一宿主实现。

`src/webview/main.tsx` 当前已经按 `data.status` 直接显示状态，不再把 `waiting-input` 折叠成 `running`。这意味着宿主判定一旦不准，UI 就会直接把误判暴露给用户。

`docs/design-docs/execution-lifecycle-and-recovery.md` 已经定义了 `Agent` 的目标语义，但此前还没有一份独立文档专门回答“这些状态如何被成熟地判定出来”。

这里的“运行态判定”特指：宿主如何判断一个已启动的 `Agent` 节点目前是在处理上一条用户指令、正在等待新的用户输入、还是进入了恢复/停止/错误阶段。它不等于“进程还活着吗”，也不等于“终端里最近有没有字符输出”。

## 工作计划

当前计划分成两层：

第一层是已经落地的当前修复。它在 `src/common/agentActivityHeuristics.ts` 定义共享启发式，要求 local PTY 与 runtime supervisor 都只在真正提交后进入 `running`，并用多信号轮询而不是固定静默时间回退到 `waiting-input`。测试层用 fake provider 的 `slowspin` 覆盖 redraw/spinner 场景。

第二层是后续独立特性。对 `Codex`，重点验证 `app-server` 是否能在不改变用户主要交互体验的前提下，为画布节点并行提供 `turn/started`、`turn/completed` 与线程状态变化。对 `Claude Code`，重点验证 plain interactive TTY 以外的 hooks 和 SDK/headless。只有这些权威信号面接入后，当前启发式才会退到真正的 fallback。

## 具体步骤

1. 新建 `docs/design-docs/agent-running-state-detection.md`，把候选方案、优先级与当前结论收口成正式设计。
2. 更新 `docs/design-docs/execution-lifecycle-and-recovery.md`，把状态语义和状态判定来源拆开，并显式引用新文档。
3. 更新 `docs/design-docs/index.md`，登记新设计文档的状态与关联计划。
4. 在 `tests/vscode-smoke/fixtures/fake-agent-provider` 增加可控的 spinner/通知输出，让 smoke 能稳定复现“有持续活动但暂无换行”的误判场景。
5. 在 `tests/vscode-smoke/extension-tests.cjs` 增加 slow spinner 回归，证明 Agent 在工作期间保持 `running`，直到输出结束后才回到 `waiting-input`。
6. 后续独立特性中，再做 `Codex app-server` 的最小 spike，并为 `AgentNodeMetadata` 增加“判定来源/权威性”字段。

## 验证与验收

本研究阶段的验收标准：

- 仓库内存在独立设计文档，明确说明 `Agent` 的 `running`/`waiting-input` 不应长期依赖 PTY 静默推断。
- 设计文档已明确给出候选方案优先级：provider 原生事件 > provider 结构化输出/hooks/SDK > shell integration > PTY 启发式。
- 生命周期设计文档已把“状态语义”与“状态判定来源”区分开，避免把当前实现误写成成熟方案。
- 设计索引已登记新文档，并与 frontmatter 保持一致。

当前实现阶段的验收标准：

- `running` 只在真正提交输入后进入，而不是用户尚在编辑指令时就切换。
- spinner/redraw 持续输出期间，Agent 不会因为缺少换行而过早退回 `waiting-input`。
- local PTY 与 runtime supervisor/reopen 路径对同一类输出采用一致的状态回退规则。
- `npm run typecheck`、`npm run build`、`trusted smoke` 与 `real-reopen smoke` 全部通过。

后续独立特性的验收标准：

- 对接入官方结构化事件的 provider，`running` 与 `waiting-input` 由 provider turn/session 信号推进，而不是由字符输出静默决定。
- 当 provider 只有结构化输出或 hooks 时，宿主能稳定把这些信号映射到节点状态，并保留来源说明。
- 当 provider 缺少正式接口时，节点仍可使用启发式退化运行，但 UI 或诊断中能明确看出其为 best-effort。

## 幂等性与恢复

- 当前计划已经包含代码与测试修改，但所有改动都可重复执行：共享 helper 是纯函数式状态记录；smoke fixture 与回归用例也可重复运行，不会改变仓库持久数据格式。
- 若本轮启发式实现需要回滚，移除 `src/common/agentActivityHeuristics.ts` 并恢复两处调用点即可，不涉及状态存储 schema 迁移。
- 后续接入 provider 原生事件时，应保持“没有事件通道也能回退到当前启发式”这一安全退化路径，避免因为新集成失效而让 `Agent` 完全失去状态反馈。
- 如果某个 provider 的结构化接口需要额外子进程或 sidecar，失败时必须 fail closed 到已有 PTY fallback，而不是让节点卡死在 `running`。

## 证据与备注

本轮研究依赖的官方事实如下：

    OpenAI Codex app-server 文档示例包含：
    - thread/status/changed
    - turn/started
    - turn/completed
    - activeFlags.waitingOnApproval

    Claude Code 官方文档包含：
    - SDK query()/ClaudeSDKClient 流式消息与 session_id
    - headless 模式 --output-format stream-json
    - hooks 的 Stop / Notification 事件

    VS Code 官方 shell integration 文档包含：
    - OSC 633;A/B/C/D 提示符与命令边界
    - onDidStartTerminalShellExecution
    - onDidEndTerminalShellExecution

这些证据共同说明：成熟方案的核心不是“更聪明地猜 PTY 文本”，而是“接入官方公开的结构化事件面”。

本轮实现验证记录如下：

    $ npm run typecheck
    通过

    $ npm run build
    通过

    $ DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs
    Trusted workspace smoke passed.
    VS Code smoke test passed.

    $ DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs
    Real window reopen smoke passed.
    VS Code smoke test passed.

    $ npm run test
    runtimeSupervisorPaths tests passed.
    VS Code smoke test passed.
    Playwright webview tests passed.

本轮 review blocker 回归新增覆盖如下：

    - local PTY start: 在 `starting` 阶段立即提交首条输入，状态必须先进入 `running`
    - local PTY sleep: `sleep 1` 的静默期内必须保持 `running`
    - local PTY resume: 在 `resuming` 阶段立即提交首条输入，状态必须先进入 `running`
    - runtime supervisor start/resume: 对应 live-runtime 路径也必须覆盖同样语义

## 接口与依赖

后续实现至少要保留下面这些语义，即使最终命名不同：

- `Agent` 节点 metadata 需要表达：
  - 生命周期状态值，例如 `waiting-input`、`running`
  - 状态判定来源，例如 `provider-event`、`provider-structured-output`、`shell-integration`、`heuristic`
  - 判定权威性，例如 `authoritative`、`derived`、`best-effort`
  - 最近一次驱动状态迁移的事件摘要与时间

- provider capability 需要表达：
  - 是否支持权威 turn/session 事件通道
  - 是否支持 machine-readable 结构化输出
  - 是否支持 hooks 或 sidecar 通知
  - 若以上都不支持，是否只能退回 PTY 启发式

本计划创建于 2026-04-12，并于 2026-04-13 扩展为“先把当前 CLI PTY fallback 做到可用，再把 provider 原生信号保留为后续独立特性”的执行文档。
