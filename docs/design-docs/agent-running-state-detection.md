---
title: Agent 运行态判定与等待输入信号设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/agent-running-state-detection.md
  - docs/exec-plans/completed/claude-agent-ctrl-z-containment.md
  - docs/exec-plans/completed/agent-provider-lifecycle-events.md
  - docs/exec-plans/completed/agent-lifecycle-adapter-hardening.md
  - docs/exec-plans/completed/agent-provider-signals-as-enhancements.md
  - docs/exec-plans/completed/agent-pty-spinner-and-quiet-fallback.md
  - docs/exec-plans/active/agent-terminal-title-activity-signals.md
updated_at: 2026-08-06
---

# Agent 运行态判定与等待输入信号设计

## 1. 背景

当前仓库已经把 `Agent` 节点的目标状态语义定义为：

- `running`：Agent 正在处理用户刚提交的一轮指令，或者仍处在当前回合的连续输出阶段。
- `waiting-input`：Agent 已结束当前回合，正在等待下一条用户输入。

旧实现没有接入 provider 的 turn/session 信号，所以宿主只能靠 PTY 行为推断：

- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 与 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 都只要发现输入包含回车或换行，就把状态切到 `running`。
- 两条路径随后都调用 `extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts`：prompt-like 输出静默 220ms、OSC/BEL 静默 260ms，或者无条件 hard fallback 静默 1600ms 后，把 `running` 退回 `waiting-input`。

这套旧方案能缓解“只要一有输入就一直是 running”的明显错误，但它实际观察到的是“PTY 最近发生了什么”，不是“provider 自己认定当前回合处在什么阶段”。进一步复核确认，Codex `notify` 和 Claude hooks 都需要改写或注入 provider 配置，而且会受用户配置、启动 flag、继承环境与 hook block 影响；正式方案不再安装、注入或依赖它们。状态判断收口为“明确提交 + PTY quiet/activity + provider 自己发出的 title activity + 可纠正的 best-effort fallback”。

## 2. 问题定义

本设计需要回答四个问题：

1. `Agent` 的 `running` 与 `waiting-input` 应该以什么信号为正式判定依据，才能和真实 provider 语义对齐。
2. 当 provider 提供多种信号面时，宿主应该优先相信哪一层。
3. 当 provider 缺少权威事件时，哪些退化路线仍然值得保留，哪些不应被误写成正式能力。
4. UI 和诊断如何区分“节点当前状态值”和“这个状态值的判定权威性”。
5. 在不改写 provider 配置的前提下，如何避免把升级菜单等非 prompt Enter 冒充成 Codex turn start。
6. 当 provider 没有可安全接入的结构化回合事件时，如何把 title activity 限定在可纠正的 best-effort 边界。

## 3. 目标

- 为 `Agent` 的 `running` / `waiting-input` 定义一套成熟、可扩展的基础判定与增强信号组合。
- 在保留交互式 PTY 的前提下，让基础状态判定不依赖可选 callback 是否成功安装或送达。
- 让不同 provider 的差异可以被显式建模，而不是再被压成一套脆弱的统一启发式。
- 为宿主与 UI 增加“状态来源/权威性”概念，避免把 best-effort 结果伪装成权威事实。

## 4. 非目标

- 不在本轮直接重写 `Agent` backend。
- 不在本轮把所有第三方 CLI 都接入正式运行态协议。
- 不在本轮把 `waitingOnApproval`、工具执行中、子任务中等更细颗粒度活动态全部升格为新的用户可见主状态。
- 不在本轮承诺 plain PTY 模式下一定能获得和 provider 原生 UI 完全一致的判定精度。

## 5. 候选方案

### 5.1 继续只靠 PTY 输入与输出静默推断

特点：

- 提交输入时切到 `running`。
- 一段静默后切回 `waiting-input`。
- 不需要 provider 额外能力。

当前定位：

- 它观察到的是字符流节奏，不是回合边界。
- provider UI 自刷新、延迟 flush、等待审批、后台工具执行或输出节流时，都会让推断漂移。
- 同一个 provider 升级版本后，屏幕输出模式一变，状态判定就可能失真。
- 但在继续使用 interactive PTY 且 callback 可被禁用的约束下，它必须作为持续可用的基础方案；实现以提交、PTY 活动和实测 quiet fallback 为主，不解析 prompt glyph，也不把 generic OSC/BEL 当成回合完成。

### 5.2 利用 shell integration / prompt boundary

特点：

- 依赖 shell prompt 与命令执行的开始/结束信号。
- VS Code 已支持 `OSC 633;A/B/C/D` 和 `onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`。

适用范围：

- `Terminal` 节点的命令生命周期。
- Agent 代表用户调用 shell command 时的辅助诊断。

不选为 `Agent` 主判定方案的原因：

- shell integration 看到的是 shell 命令，不是 provider TUI 的内部对话回合。
- 交互式 `codex` / `claude` 会话在 shell 看来通常只是一个长期存活的前台进程，shell 侧并不知道它何时完成一轮回答。

### 5.3 接入 provider 原生结构化 turn/session 事件

特点：

- 直接消费 provider 官方公开的 machine-readable 事件。
- 事件通常包含“回合开始”“回合完成”“线程状态变化”“等待审批”等信息。

当前判断：

- app-server 等不可由用户配置关闭的完整结构化执行面仍是长期可选路线，但不属于当前 interactive PTY 实现；它必须先完成不改写用户配置的独立设计。
- 当前 direct-TUI notify 被明确排除：不安装、不追加、不读取为主状态事实；当前只能依赖 submit、PTY 与 title。

已知证据：

- OpenAI 官方 `Codex app-server` 文档已经公开 `turn/started`、`turn/completed`、`thread/status/changed` 与 `activeFlags.waitingOnApproval`。
- 本轮按产品约束没有切换 app-server；Codex direct TUI 的 `notify` 已通过实机实验确认会发送带 `thread-id + turn-id` 的 `agent-turn-complete`。

### 5.4 接入 provider 自己的结构化输出、SDK 或 hooks

特点：

- 不一定是完整事件总线，但 provider 会提供结构化输出或回调点。
- 例如 SDK message stream、`stream-json`、hooks。

当前判断：

- SDK/headless stream 若未来成为执行面，可以重新设计为完整主路径；当前 interactive TTY 不注入 hooks 或临时 settings。
- 任何需要改写 provider 配置的 callback 都不属于当前状态判断方案；未来只有不改配置的 structured transport 才能单独评估。

已知证据：

- Anthropic 官方文档公开了 Agent SDK 的流式消息与 `session_id`。
- `Claude Code` headless 模式支持 `--output-format stream-json`。
- hooks 支持 `Stop` 与 `Notification` 等事件点。

## 6. 风险与取舍

- 取舍：为不同 provider 维护不同的活动信号适配层。
  原因：这会增加实现复杂度，但比继续强行共享一套错误抽象更可控。

- 风险：某些 provider 的官方结构化接口更偏自动化模式，而不是当前仓库在用的交互式 PTY 模式。
  当前缓解：允许“交互式 UI 继续走 PTY，状态判定额外并行接一条结构化 sidecar”，而不是要求一步切掉现有 UI。

- 风险：同一 provider 不同运行模式下，状态信号粒度可能不一致。
  当前缓解：把“生命周期状态值”和“信号来源/权威性”拆开建模，防止因为不同模式的粒度差异而污染用户可见语义。

- 风险：provider 增强事件和 PTY heuristic 可能先后给出同一结论，或者 heuristic 先给出较弱结论。
  当前缓解：新路径不接收 hook/notify 的生命周期迁移；submit、PTY、title 与 quiet/bottom-screen reducer 只产生 derived/best-effort 结果。历史 callback 到达只做兼容诊断，不改变新会话状态。

- 历史风险：Codex `notify` 是单一 argv 数组配置，安装 notifier 可能覆盖用户已有 notifier。
  当前决策：不安装、不追加、不读取 `notify` 作为状态事实；该风险不再进入新会话主路径。

- 历史风险：Claude `Stop` hook 可以被另一个 Stop hook 阻止，收到 Stop 不代表 provider 不会继续当前 prompt。
  当前决策：不注入、不合并、不消费 Claude lifecycle hooks 进行状态迁移；此限制保留为历史实验结论。

- 风险：OSC 0/2 是通用标题传输通道，不包含跨 CLI 的 `working` 标准；用户配置、shell、工具子进程或未来 CLI 版本都可能写标题。
  当前缓解：title 只作为 Codex / Claude Code 当前版本 profile 的正向活动增强，必须观察到连续不同的已知 frame；静态 title、标题清除、`Action Required` 与未知 profile 都不改变 Agent lifecycle。active turn 内的 generic OSC/BEL 只允许产生 `attention / best-effort waiting-input`，不确认 authoritative completion/failed。

- 风险：title 可能携带项目路径、会话名称或用户可控文本，并且 title update 的频率高于普通状态边界。
  当前缓解：parser 只短暂保留有上限的未完成 OSC 和 frame 值，不持久化或上报 raw title；正常 `running` 不按 frame 写 metadata，只有弱 waiting 被纠正为 running 才写入一次状态。

- 风险：为了接入 Codex `notify` 或 Claude lifecycle hooks 而写入用户配置，会覆盖用户既有设置、改变 provider 启动行为或让状态能力随 hook 送达失败而漂移。
  当前缓解：正式方案不注入、不修改、不依赖 hook/notify；已存在的 callback 代码只能作为待清理的历史路径或非生命周期诊断，不得驱动新的 `running` / `waiting-input` 状态。

## 7. 正式方案

### 7.1 正式语义

- `running` 只表示 provider 已接受当前一轮用户指令，且该轮尚未结束。
- `waiting-input` 只表示 provider 已结束当前一轮，正在等待新的用户输入。

这两个状态的定义不依赖实现方式；实现是否成熟，只影响“这些状态值是如何被判出来的”。

### 7.2 基础判定与增强信号

`Agent` 运行态不再采用“provider callback 可用时关闭 heuristic”的排他优先级，而采用持续基础判定加正向增强：

1. Webview/owner 识别真实可编辑内容后的明确 submit，进入 `running`，来源为 `submission-intent / derived`。
2. PTY 任意输出刷新 quiet 时钟并使当前回合保持 `running`；已识别的 provider title frame 也只在内存中刷新同一时钟。正常 `running` 阶段不扫描 headless terminal 屏幕，也不需要从可见屏幕寻找 spinner 做二次确认。
3. 从有效 submit 或最近 PTY/title activity 开始连续 5000ms 无活动时，进入 `waiting-input`，来源为 `heuristic / best-effort`；同一已提交回合收到可识别的终端 attention signal 时，也可以立即进入 `waiting-input`，来源为 `attention / best-effort`。两者都只保留当前 turn correlation，不能确认 completed/failed；quiet timer 必须依据单调时间戳检查 `lastActivityAtMs`，不能仅依据回调到达顺序。
4. 只有进入可纠正的弱 `waiting-input` 后，才追踪当前屏幕最下方非空内容区域；连续跨帧变化可以把同一回合纠正回 `running`。该恢复证据不匹配 provider 文案或 glyph，并抑制用户输入后 600ms 内的 composer 回显。
5. 已确认的 provider title activity 可以在当前回合内保持或纠正 `running`；它没有 provider turn identity，来源只能是 `terminal-title / best-effort`，不能确认 completed/failed。
6. 不安装或依赖 Codex `notify`、Claude hooks 等会改写 provider 配置的 callback。没有 provider identity 时，回合完成只能进入 `heuristic / best-effort waiting-input`；未来不改配置的结构化 transport 另行设计。

5000ms 来自 2026-07-21 的真实 PTY 实验，不是 provider 协议保证。Codex CLI 0.144.5 与 Claude Code 2.1.209 各执行 6s/15s 静默 Bash 工具回合，另各执行一次“已启动 TUI 内提交”的 6s 回合：最慢 active PTY gap 为 Claude 460.5ms，最慢 submit-to-strong-running 为 119.4ms；5000ms 提供约 10.8 倍观测余量。3s 虽有约 6.5 倍余量，但对样本外调度停顿更敏感；8s/15s 会无必要地增加 callback 缺失时的完成延迟。该阈值仍需随 provider TUI、平台和调度行为变化复测。

### 7.3 terminal title 活动增强

terminal title 是 PTY raw output 中的 `OSC 0`（同时设置 icon/title）或 `OSC 2`（设置 title）控制序列。它能解释 macOS Terminal、iTerm2、Ghostty、VS Code Terminal 与 xterm.js 宿主为何无需 Agent 专用 hook 就能显示 spinner：终端只渲染 title，`working` 语义由 CLI 自己维护。它不是 OSC 133，也不是“进程仍活着”的检测。

本仓库把 title 定位为 provider-specific 的正向活动增强，而不是新的主状态、完成信号或通用 PTY heuristic：

1. 只在拥有 current PTY 的 Host/Supervisor raw chunk 层增量解析 OSC 0/2；必须同时支持 BEL、ST 与跨 chunk 终止，未完成 payload 有固定上限。title activity reducer 不读取或写入 raw title；title 文本的受限显示与 reattach 投影由 `docs/design-docs/execution-terminal-title-display.md` 另行定义，仍不得进入 terminal journal、diagnostic detail、attention 文案或 lifecycle metadata。
2. Codex profile 只识别当前 `0.146.0` 已验证的十个 Braille activity frame；Claude Code profile 只识别当前 `2.1.209` busy 的 `⠂` / `⠐`。同一 profile 要在 2500ms 内见到两个不同 frame 才形成 `terminal-title activity`。这是版本化实现证据，不是 provider API 契约；title 配置关闭、改序、失焦暂停或未来改 frame 都只会使本增强缺席。
3. 已经有有效 submit/结构化 start 的 `running` 回合只在内存中吸收该活动，不得每帧 persist 或 post state。title activity 不能从 `starting`、`resuming`、`live` 或 idle 单独创建一轮 `running`，因为 Codex 的 MCP startup 也会转动且 title 没有 turn identity。
4. 已确认的 title activity 与 quiet fallback 由同一个幂等 reducer 处理，事件到达顺序无关：title 两帧先到时只维持当前回合的 `running`，随后在确实连续 5000ms 没有 PTY/title activity 时仍可进入弱 `waiting-input`；quiet fallback 先到时，之后同一回合的 title 两帧可以把弱 `waiting-input` 纠正回 `running`。两条路径都必须使用事件的观察时间和同一 `lastActivityAtMs`，避免 timer 与 PTY parser 调度顺序造成不同最终状态。恢复后的状态来源写为 `terminal-title / best-effort`，且不要求 spinner 可见于 xterm screen。
5. 当前没有由 hook/notify 产生的 `provider-lifecycle / authoritative` 状态迁移；进程终态和已确认 interrupt 会清除可恢复回合资格，后续 title、chrome redraw 或普通 PTY 输出都不得重新打开。title 不从固定 `✳`、title 消失或 `Action Required` 推导 waiting/complete/approval，attention 继续走独立 BEL/OSC 9/OSC 777 与进程/宿主事件路径。

本轮明确放弃 hook/notify 状态路径：Agent 启动不得为了状态判断修改 Codex `notify`、Claude `settings/hooks` 或继承环境；现有 provider lifecycle callback 只保留为兼容清理对象或诊断资料，不再驱动新的主状态迁移。未来只有不改 provider 配置的结构化通道（例如独立 app-server/stream transport）经过另行设计后，才可以重新成为 provider lifecycle source。

该增强不改变 `running` / `waiting-input` 的用户定义，也不要求新增 UI 状态。现有 Agent `running` 标题栏活性线继续只由精确 `running` 且无 attention 的主状态驱动；`activitySource` 只用于诊断和状态可追溯性。

#### 7.3.1 Attention Signals 与 lifecycle 的并行边界

Codex 与 Claude Code 已经支持的 attention signal 继续接入同一条 PTY raw-output 观察链，但进入独立的 attention reducer，不与 title/quiet lifecycle reducer 混用：

- 两个 provider 的 PTY 都接入统一的 `BEL`、`OSC 9`、`OSC 777` parser；当前已确认的 provider 行为是 Codex TUI 通过 `OSC 9`/`BEL` 投递提醒、Claude Code 提供终端 bell notification，`OSC 777` 仅作为通用兼容 transport 接收，不把“provider 一定会发出 OSC 777”写成事实。Codex TUI 的 turn 完成、执行审批、编辑审批、elicitation 或 plan-mode prompt 等内部事件，可能被压缩成同一种 `OSC 9`/`BEL` transport。经过 PTY 后，宿主通常只能可靠知道“需要注意”，不能从通用序列恢复 provider event subtype 或 turn identity；但在当前回合仍 active 时，这个观察可以作为 `attention / best-effort waiting-input` 候选。
- 产品 attention source 还包括两种宿主观察候选：Codex 的显式高置信最终失败输出文本，以及 Codex/Claude 已运行后非用户主动、非 `0` 进程退出。前者只生成 `attentionPending`，后者同时进入既有 `error` 终态；两者都不需要 hook/notify。
- `extensions/vscode/dev-session-canvas/src/common/executionAttentionSignals.ts` 负责 BEL/OSC 9/OSC 777 的增量解析、allow-list 过滤和 `OSC 9;4` 进度消息忽略；`CanvasPanelManager.ts` 的 attention bridge 负责设置 `attentionPending` 与可选通知。原始 signal observation 可以驱动 `attention / best-effort waiting-input`，但 `attentionPending` UI 字段本身不能反向驱动 lifecycle。
- Generic BEL/OSC attention 可以与 `running` 或弱 `waiting-input` 并存；在有 active turn 时，它也可以把当前状态标记为弱 `waiting-input`，但不能以 authoritative 意义结束 turn、确认 completed/failed 或从弱 waiting 恢复 running。它会随其所在的 PTY chunk 刷新普通 quiet clock，也不会在进程终态或 confirmed interrupt 后重新打开回合。title/quiet 与 attention 事件交错到达时，各自 reducer 独立、幂等；attention 的 allow-list 或通知 bridge 开关不能改变这条弱 waiting 规则。
- attention signal 的产品表现仍由 `devSessionCanvas.notifications.enabledAttentionSignals`、`attentionSignalBridge` 和 `attentionPending` 确定；禁用某个 signal 只禁止产品提醒和外部 bridge，不得为了状态判断修改 Codex/Claude 配置或注入 hooks。原始 payload、项目路径和会话文本仍不得写入 lifecycle metadata。

### 7.4 provider 级结论

`Codex`

- 当前正式实现继续使用 interactive CLI PTY，不采用 app-server，也不接入 Codex `UserPromptSubmit`。
- Webview 识别用户明确提交意图后进入 `running`；单纯“数据中出现 CR/LF”只保留为旧 Webview/Host/Supervisor 的兼容兜底。由于启动升级菜单和 provider 本地选择菜单也会产生 Enter，`submit` 还必须消费同一进程内已观察到的可编辑输入候选：方向键、终端控制响应、空白和编辑换行不能建立候选，可见非空文本或粘贴可以建立候选，submit 与 interrupt 会清空候选。该规则不解析 Codex 屏幕文案，也不把候选伪装成 provider turn identity。
- 不安装、不覆盖、不追加 Codex `notify`；用户现有 `notify` 配置不被读取为 Agent 状态事实，也不作为本节点启动的隐式依赖。
- Codex 的 title animation 只作为当前 PTY 会话的 provider-specific activity evidence；它不能单独开启 turn，也不能表达 completed/failed。
- Codex app-server 的 `turn/started`、`turn/completed` 和 `thread/status/changed` 属于未来可选的非配置改写路线；当前不把 interactive CLI 切换到 app-server。

`Claude Code`

- interactive TTY 保持为执行与显示通道；不注入或消费 `UserPromptSubmit`、`Stop`、`StopFailure` lifecycle hooks，不写入 lifecycle 临时 settings，不改变用户的 `--settings`、`--safe-mode`、`--bare` 或继承环境来判断运行态。文件活动是独立能力：仅在用户开启文件活动时，它可以继续使用只监听 `PostToolUse` 的临时 settings；该 hook、事件流与环境变量不得创建 callback、provider identity 或 lifecycle 迁移。
- Claude Code 的 title animation 只作为当前 PTY 会话的 provider-specific activity evidence；idle/waiting 的固定 `✳` 不表示完成，title 也不能提供 `session_id + prompt_id`。
- 现有 hooks 实验和 callback 类型保留为历史兼容资料；它们不再驱动新的 `running`、`waiting-input` 或 failed outcome。未来若有不改配置的结构化 transport，再单独评估。

### 7.5 数据模型结论

本轮实现中，节点 metadata 至少新增以下信息：

- `activitySource`：当前状态由什么来源驱动。新会话只使用 `submission-intent`、`terminal-title`、`attention` 与 `heuristic`；`provider-lifecycle` 保留为历史 metadata 兼容值，只有未来不改配置的结构化 transport 被单独接入后才可重新启用。
- `activityAuthority`：当前来源是 `derived` 或 `best-effort`。明确 submit 进入 running 属于 `submission-intent / derived`；title、attention、quiet/bottom-screen 均属于 `best-effort`。当前 interactive PTY 方案不把任何 title/OSC/Hook 伪装成 `authoritative`。
- provider session/turn identity：已有 metadata 可以继续保存和展示，但在本方案中不再依赖 hook/notify 获取它，也不作为当前状态迁移前提。
- last turn outcome/error：只有明确进程退出、受控中断或未来不改配置的结构化 transport 才能写入 typed outcome；不能从 title、静态 prompt 或 quiet waiting 伪造 completed/failed。

这样即使用户看到的主状态仍然是 `running`，宿主和 UI 也能明确区分“由用户提交推导”“由 provider title 活动确认”与“由 quiet fallback 猜测”；当前不再声称 hook callback 是默认权威来源。

### 7.6 非侵入式 provider 信号与旧代兼容边界

本地会话由 Extension Host 读取 PTY，`live-runtime` 会话由对应 generation 的 Supervisor 读取 PTY；两条路径都只能消费实际已经经过该 PTY 的提交、输出、title 与进程退出。不允许为了收集运行态而注入 Codex `notify`、Claude lifecycle `settings.hooks`、临时 `--settings`、callback nonce、loopback hook server 或额外环境变量。用户显式开启文件活动时的 Claude `PostToolUse` hook 属于另一个数据域，不能向本 reducer 提供输入。

已有 `processEpoch`、callback envelope、provider session/turn identity 和 lifecycle capability 属于已经发布的兼容面。新实现必须能读取旧 snapshot，但对于新会话不得主动构造 notifier/hook callback，也不得让其到达事件改变 lifecycle；最多记录已接收的旧事件诊断而不改变状态。

未来若采用 Codex app-server、Claude SDK/stream-json 或其他正式结构化 transport，必须先单独设计其进程 ownership、用户可见模式、session/turn identity、恢复和权限边界。只有该 transport 不改写用户 provider 配置、且可在 Host/Supervisor 两条路径一致运行时，才能重新引入 `provider-lifecycle / authoritative`。

当前 Supervisor generation 已在此前的 provider lifecycle 工作中从 `terminal-stream-v1` 切换到 `agent-provider-lifecycle-v1`；这是实际的 storage、socket 和 systemd unit namespace 切换，不是本次 title 工作中的 rebase 产物。新会话经 `resolveCurrentRuntimeSupervisorBaseStoragePath()` 进入当前 generation；新 Supervisor 不再声明 `agentProviderLifecycleV1` callback capability，但协议仍可读取旧 snapshot 中的历史 lifecycle 字段。

旧会话的 restore、attach、stop 与 diagnostics 始终采用已持久化的 `runtimeStoragePath`，因此仍会连接其原来的 `terminal-stream-v1` namespace，并在原 PTY 不迁移、不重启的情况下自然 drain。缺失该路径的旧 live-runtime metadata 必须降级到历史结果，不能猜测或改连当前 generation。`scripts/test/test-runtime-supervisor-paths.mjs` 显式断言两代 storage/socket 路径不同；`CanvasPanelManager.ts` 也只在没有既有路径的新会话上选择当前 generation。

terminal-title enhancement 只扩展当前 generation 内可安全忽略的 `activitySource` 值，parser state 不写入 session snapshot、journal 或恢复格式，因此本项不会在既有 `agent-provider-lifecycle-v1` 之上再创建新的 Supervisor generation。若实现验证发现旧 Host 收到 `terminal-title` 会拒绝整份 snapshot，而不只是 fail closed 地忽略未知 source，必须改为新增 capability/generation 后才能交付。

### 7.7 基础 heuristic 的保留范围

组合 heuristic 始终同时运行于本地 PTY 与 runtime supervisor 路径，不依赖 provider callback 是否配置或送达。当前路径不生成 lifecycle hook/notify；title parser 只作为附加的正向活动观察。

基础 heuristic 的具体规则是：

- 旧协议缺少输入意图时，只有输入里出现 `\r` 或 `\n` 才把 `Agent` 切到 `running`；新 Webview 使用显式 `submit/text/paste/interrupt` 意图，编辑换行、IME 与多行粘贴不再冒充提交。
- Codex 与 Claude 即使收到显式 `submit`，也只有在当前提交候选已由可见非空输入建立时才进入 `running`；启动菜单中的纯导航与 Enter 仍原样转发给 PTY，但不改变 Agent lifecycle。任何 provider hook/notify 都不参与 turn start。
- prompt glyph 不参与 lifecycle 判定；`>`、`›`、`❯` 等输出只和其他 PTY 输出一样刷新 quiet 时钟。generic `OSC 9` / `OSC 777` 与 bell 继续服务 attention；当前存在 active turn 时，它们还可以把状态降为 `attention / best-effort waiting-input`。只有独立 title parser 经 provider profile 确认的连续 OSC 0/2 activity frame，或等待态下的底部活动，才能恢复 running；它们都不读取或保留 title 文本。
- attention parser 与 lifecycle reducer 并行运行：BEL、OSC 9、OSC 777 的命中在 active turn 内可产生 `attention / best-effort waiting-input`，同时更新 `attentionPending` / 通知链路；它们不确认 completed/failed，也不能从弱 waiting 恢复 running。Codex abnormal output text 仅在显式配置下生成 attention，`agentAbnormalExit` 才在满足既有条件时进入 error；allow-list 只控制产品提醒，不屏蔽 lifecycle 的弱 waiting evidence。
- 有效 submit 立即建立 quiet 起点；之后任意 PTY 输出或已知 title frame 都重置起点，因此完全静默和中途停止输出两种路径都能在 5000ms 后 fallback。quiet timer 与 title observation 是顺序无关、可重复处理的事件：同一事件重复到达不得重复写状态，较旧的 timer 不能覆盖较新的 activity。
- 只有进入可纠正的 `heuristic / best-effort waiting-input` 后，Agent 会话的 headless terminal 才启用活动追踪，为每个已解析输出 batch 记录当前屏幕最下方非空内容区域的字符与样式变化版本；正常 `running` Agent 与普通 Terminal 都不承担这项扫描。连续两次、间隔不超过 1000ms 的变化构成恢复 `running` 的证据；只移动 cursor 不算屏幕活动，用户输入后的 600ms 回显窗口不建立恢复证据。
- quiet fallback 保留本地 turn correlation。只有 `heuristic / best-effort waiting-input` 可以被后续 title 或底部活动纠正为 `running`；没有当前回合 identity 的 hook/notify 不得制造 authoritative waiting，也不能推翻已确认 interrupt 或进程终态。
- 普通换行本身不再被当成“当前回合已完成”的直接信号；因为长任务可能先输出一整行文本，再在静默期内继续执行。
- Claude Code 的 `Ctrl-Z` / `fg` 文案不再参与运行态或生命周期判定。当前 Claude Agent 是 direct-spawn provider CLI，没有普通 shell job table；如果把 provider 输出的 suspend 文案当作权威状态，会制造页面仍在更新、恢复后输入无效等伪挂起问题。新的输入路径在 Webview、宿主与 runtime supervisor 三层阻断 Claude Agent `Ctrl-Z`，并把后续处理引导到停止、恢复或分叉。
- local Host 与当前 Supervisor 使用同一个 5000ms evaluator、title profile、底部活动 reducer 和可纠正 lifecycle reducer；既有 `terminal-stream-v1` generation Supervisor 按已持久化的 `runtimeStoragePath` 不迁移地继续服务既有会话，直至自然 drain。

这一版仍然属于 `heuristic` / `best-effort`：它用实测 quiet 阈值、底部活动与可纠正语义降低误判，但不能把 plain PTY 提升成 provider 权威事件。


### 7.8 Webview 状态呈现

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的 `AgentSessionNode` 只在节点 `status` 精确等于 `running` 且 `metadata.agent.attentionPending` 不为 `true` 时，为标题栏添加 `is-agent-running-titleline` 与 `data-agent-running-titleline="true"`。`live`、`starting`、`resuming`、`reattaching`、`waiting-input` 等状态即使表示执行节点仍可附着或处在生命周期过渡中，也不得触发这条运行活性线；这些状态继续依靠状态胶囊文本与既有状态色表达。

`extensions/vscode/dev-session-canvas/src/webview/styles.css` 的 `execution-agent-running-titleline` 只让标题栏底部的短纯色段在可用宽度内左右往返移动，并使用 `--canvas-node-color` 派生的 Agent 节点类型色，而不是 `tone-running` 或 VSCode running 状态色。非移动区域继续使用标题栏原有 1px `border-bottom`，不额外铺一条静态状态色底线；只有移动段可加粗，不使用渐变尾部，也不再从左到右单向划过后淡出，避免 running 视觉覆盖普通标题栏分隔语义。这样该动效表达的是“这个 Agent 对象正在处理当前回合”，不是新的全局 running 状态色体系；当 attention pending 存在时，attention 提醒优先，运行细线隐藏，避免弱活性提示和强提醒同时竞争。`prefers-reduced-motion: reduce` 下关闭高光位移，仅保留标题栏原有底部分隔线。

## 8. 验证方法

至少需要完成以下验证：

1. 自动化测试能证明不安装、不修改 Codex `notify` / Claude hooks 时，提交与 PTY 基础路径独立完成 `running -> waiting-input`。
2. title profile 的连续 frame 只能在当前回合内保持或恢复 `running`，不能创建 turn、完成 turn 或生成 failed outcome。
3. 运行态路径下，用户已有 Codex/Claude 配置、`--settings`、`--safe-mode`、`--bare` 与继承环境在 Agent 启动前后保持字节级等价；扩展不生成 lifecycle hook 文件参数、临时 settings 或额外 callback 环境变量。用户显式开启的 Claude 文件活动 `PostToolUse` hook 必须另行验证为只产出文件事件，不能影响 lifecycle。
4. 任何旧 callback 到达、缺失或拒绝都不会改变新会话的主状态；若未来接入不改配置的 structured transport，必须另有 capability 与 identity 测试。
5. 输入意图测试覆盖 Enter/Return/NumpadEnter、virtual keyboard 的独立 CR/LF/CRLF、Shift+Enter/Ctrl+J、多行/括号粘贴、IME composition 和 Esc；粘贴或编辑换行不能把 Agent 误切到 `running`。
6. identity 测试覆盖旧 process epoch、错误 nonce、不同 provider session、上一 prompt 的延迟 start/Stop 事件对和重复 Stop；这些事件不能认领或结束当前回合。
7. Agent 进程退出、用户中断和异常输出仍可分别记录 exit/interrupted/attention；不能用静态 title 冒充 failed outcome。
8. 主路径不再要求 lifecycle runtime hook 文件；main-only staging、trusted smoke 与正式 package 都必须证明没有为状态判断注入 hook。
9. Codex/Claude 输入测试覆盖“方向键 + Enter”的菜单序列不进入 `running`，以及可见文本/IME/粘贴后 submit 正常进入 `running`；Host 与 Supervisor owner 必须共享同一判定函数。
10. Codex/Claude launch integration 测试覆盖用户已有 `--settings`、`--safe-mode`、`--bare` 与环境变量：状态功能仍回退到 submit + PTY + title，绝不安装 notify/lifecycle hook；文件活动关闭时 argv/env 不被改写，开启时的独立 `PostToolUse` hook 不得传递 lifecycle 事件。
11. 没有结构化 completion callback 时，无输出回合从 submit 起、已有输出回合从最后输出起，在 5000ms 后进入 `heuristic / best-effort waiting-input`；prompt glyph 不能改变 lifecycle，active turn 内 OSC/BEL 只能提前产生 `attention / best-effort waiting-input`，不能确认 authoritative completed/failed。
12. 正常 `running` 阶段不启用 bottom-screen tracking，持续 PTY 输出或已知 title frame 只通过刷新 quiet 时钟保持 `running`；quiet fallback 后才启用追踪，恢复的连续 title/底部活动可纠正回 `running`，用户 composer 回显、进程终态和用户中断后的终端 chrome 都不能误触发纠正。自动化必须分别覆盖 `title -> quiet` 与 `quiet -> title` 两种顺序，并断言最终状态一致。
13. attention 自动化覆盖 BEL/OSC 9/OSC 777、OSC 9;4 忽略、allow-list、`attentionPending` 与 lifecycle 的分层，以及 Codex/Claude 的异常退出边界；active turn 收到 attention 时进入 `attention / best-effort waiting-input`，无 submit、进程终态或 confirmed interrupt 后不得创建/重开回合；attention 与 title/quiet 交错时各自 reducer 必须幂等。
14. title activity 自动化覆盖 OSC 0/2 的 BEL/ST/C1 分片解析、payload 上限、Codex/Claude 连续不同 frame profile、weak waiting 恢复、进程终态/interrupt 不重开、Host/Supervisor 同构结果与 raw title 不落盘；真实 CLI smoke 只记录 frame 与版本，不提交完整 title/prompt trace。

## 9. 当前验证状态

- 2026-04-12 已完成设计研究，确认当前仓库仍处于 PTY 启发式阶段。
- 2026-04-12 已确认三类官方能力面：
  - `Codex app-server` 的结构化 turn/thread 事件。
  - `Claude Code` 的 SDK、headless `stream-json` 与 hooks。
  - VS Code shell integration 的 prompt/command 边界。
- 2026-04-13 已把共享启发式 helper 接入 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 与 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`，统一本地 PTY 与 runtime supervisor 的 `running -> waiting-input` 回退规则。
- 2026-04-13 已新增 smoke 回归，覆盖 spinner/redraw 持续输出期间不应过早回退到 `waiting-input`。
- 2026-06-10 曾补充 Claude Code `Ctrl-Z` 挂起输出识别；2026-06-11 已撤销该方向，不再把 suspend / `fg` 文案作为状态机输入。
- 2026-06-11 已补充 Claude Agent `Ctrl-Z` 阻断验证：Webview 阻止 `\u001a` 发送到 host，host 与 runtime supervisor 也拒绝旧客户端绕过前端的写入请求；该逻辑不影响 Terminal 或 Codex Agent 输入。
- 2026-07-14 已完成 Codex CLI 0.144.1 direct-TUI notify 实验：确认 `agent-turn-complete` payload 的 `thread-id + turn-id`、resume identity、notifier ACK 前后的 TUI 顺序，以及 Stop hook continuation 后只在最终完成时通知。
- 2026-07-14 已完成 Claude Code 2.1.209 hooks 实验：确认 `UserPromptSubmit/Stop` 的 `session_id + prompt_id`、Stop hook block 后的重复 Stop、Esc 不产生 Stop/StopFailure，以及约 60 秒后的 `Notification(idle_prompt)`。
- 2026-07-14 已完成 Claude repeated-settings 实验：`--settings A --settings B` 只有 B 的 hook 生效，因此正式实现采用单份合并 settings。
- 2026-04-13 已通过旧启发式阶段的以下验证：
  - `npm run typecheck`
  - `npm run build`
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs`
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/smoke/run-vscode-smoke.mjs`
  - `npm run test`
- 2026-07-15 已完成 provider lifecycle 正式实现并通过聚焦测试、类型检查、构建和 trusted VS Code smoke。smoke 中 hook-capable 假 Claude 的 3 秒静默回合在 2 秒检查点仍为 `running`，随后只由 `Stop` 进入 `waiting-input`；`StopFailure` 进入 `waiting-input` 的同时保存 failed/error 并触发 attention；异常进程退出通知仍然有效。
- 2026-07-15 已验证 Supervisor lifecycle callback 延迟到 2300ms 时，1600ms 检查点仍保持 `running`，callback 到达后才进入 `waiting-input`；旧 generation capability gate、错误 nonce/process epoch/runtime session、stale prompt/thread 和重复 completion 也均有自动化回归。
- 2026-07-15 的真实 main-only Host diagnostics 暴露两个回归：staged extension 漏复制 lifecycle hook，且 Codex 启动升级菜单的方向键 + Enter 被当成 prompt submit。本轮已让 main-only staging 复制完整 runtime scripts，在 adapter 启动前增加缺 hook fallback，并用共享 submission candidate 阻止控制序列/方向键后的纯 Enter 进入 `running`。debug staging、provider lifecycle、Supervisor protocol、typecheck、build、正式 VSIX 文件列表和 trusted VSCode smoke 全部通过，详细证据见 `docs/exec-plans/completed/agent-lifecycle-adapter-hardening.md`。
- 2026-07-17 的 PR review 发现 Claude `--safe-mode` / `--bare` 会合法禁用 hooks，但 launch integration 仍声明 lifecycle enabled。当前实现已在 settings 合并前识别两种模式，保留原始 argv 并以明确原因回退 heuristic；聚焦测试覆盖两种 flag、capability gate 与文件活动 env 不注入。
- 2026-07-21 的后续 review 证明继承 `CLAUDE_CODE_SAFE_MODE=1` / `CLAUDE_CODE_SIMPLE=1` 也会跳过 hooks，而静态 argv preflight 仍会误报 lifecycle enabled。用户据此确认 notify/hooks 只作为辅助增强信号；基础提交与 heuristic 必须始终工作，普通 `running` 不再接受 1600ms 无条件 hard fallback。
- 2026-07-21 已完成增强信号收口：Host 与 Supervisor 不再用 `lifecycleEnabled` gate 基础提交/PTY heuristic；callback configured 但永不送达的 Supervisor fixture 会在 1600ms 后保持 `running`，随后由 prompt 进入 `heuristic / best-effort` 的 `waiting-input`；provider callback 先到或后到仍可升级 identity/outcome。Claude safe/simple argv/env preflight、上一回合延迟 start/Stop 事件对、共享 candidate、类型检查、构建、package 文件列表和 trusted VS Code smoke 均已通过，详细证据见 `docs/exec-plans/completed/agent-provider-signals-as-enhancements.md`。
- 2026-07-21 用户根据真实 Codex TUI 确认 prompt glyph 不能作为 lifecycle 判断特征，并确认底部活动 spinner 是强 running 证据、PTY 连续 Nms 无输出可作为 waiting fallback；六组真实 PTY 实验选定 N=5000ms，最大 active gap 460.5ms。2026-07-22 后续复核将 spinner 证据的实际使用范围收窄到弱 waiting 恢复。
- 2026-07-21 已完成新版 PTY 主线并验证：prompt glyph 与 generic OSC/BEL 不再结束 turn；5s quiet 产生可纠正的 best-effort waiting，之后底部非空内容区域连续变化可以恢复 `running`；provider authoritative completion 不会被终端 chrome 重开。聚焦测试、Supervisor 协议与 10 Agent 压测、typecheck、build、debug launch 和 trusted VS Code Host smoke 全部通过，详细证据见 `docs/exec-plans/completed/agent-pty-spinner-and-quiet-fallback.md`。
- 2026-07-22 根据用户复核进一步收窄屏幕扫描：正常 `running` 已有 PTY 输出刷新 quiet 时钟，不再逐 batch 维护 bottom-screen signature；只有 5s quiet 产生可纠正的 best-effort waiting 后才临时启用追踪，恢复、新 submit、interrupt 确认或 provider lifecycle 事件都会关闭并清空追踪状态。聚焦测试、typecheck、build 和 trusted VS Code smoke 已重新通过。
- 2026-07-30：确认 Codex `0.146.0` 与 Claude Code `2.1.209` 都会通过 OSC 0 发送 provider 自己维护的 title activity，而非依赖 terminal 识别进程或 OSC 133。正式方案新增 `terminal-title` 作为仅正向、版本化、两帧确认的弱等待恢复证据；不读取/持久化原始 title，且不能开启回合或推翻 authoritative completion。实现与真实 CLI/Host/Supervisor 验证尚未开始，因此本文验证状态从“已验证”回到“验证中”。
- 2026-08-04：用户明确决定放弃会改写 Codex/Claude 配置的 hook/notify 状态路径。2026-07-14 至 2026-07-21 的 callback/hook 实验保留为历史证据，不再代表当前实现目标；新会话必须只依赖 submit、PTY、title activity 与 best-effort fallback。现有运行时代码尚未完成 hook 注入清理，需通过后续 ExecPlan 实施并验证配置前后不变。
- 2026-08-04：用户确认 5000ms quiet fallback 与同一回合连续两帧已知 title spinner 的先后顺序可以互换。两者改为共享 `lastActivityAtMs` 的顺序无关、幂等 reducer：`title -> quiet` 在后续真实静默达到阈值时仍可弱等待，`quiet -> title` 可恢复 `running`，最终结果不依赖 timer/parser 调度顺序。
- 2026-08-05：补充 Codex/Claude 已支持的 Attention Signals 边界。active turn 收到 BEL、OSC 9 或 OSC 777 时可进入 `attention / best-effort waiting-input`，同时继续进入 `attentionPending`/通知链路；Codex 高置信异常输出与已运行后的异常退出仍按既有 attention/error 规则处理。Attention 不具备 completed/failed 权威性，也不能在终态后重开回合。
- 2026-08-05：已实现 `agentTerminalTitleActivity.ts` 的 OSC 0/2 增量 parser、Codex/Claude profile 与 2500ms 两帧确认；Host 和 Supervisor 都在 active turn 内消费同一份 title/attention evidence。新 Agent 会话不再启动 callback server、注入 Codex `notify` 或 Claude lifecycle hooks，Supervisor 也不再声明 lifecycle callback capability。本地 Host 将 title provider 与可选 Codex 异常文本提醒 provider 分开传递，因此关闭异常文本提醒不会关闭 Codex/Claude title profile。`npm run test:agent-terminal-title-activity`、`npm run test:agent-provider-lifecycle`、`npm run test:execution-attention-signals`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck`、`npm run build` 与 `git diff --check` 已通过；真实 Codex/Claude CLI smoke 仍待当前安装版本执行。
- 2026-08-06：PR review 发现增量 title parser 不能丢弃合法的 PTY 分块边界。本轮保留 `ESC | ]` 的 OSC introducer 与 `ESC | \` 的 String Terminator carryover，并补充两帧 Claude title 的端到端回归；同时更正 Supervisor generation 事实：当前 `agent-provider-lifecycle-v1` 已替换旧 `terminal-stream-v1`，旧会话依持久化 `runtimeStoragePath` 继续连接旧 namespace 并自然 drain，本 title 工作不额外创建 generation。`npm run test:agent-terminal-title-activity`、`npm run test:runtime-supervisor-paths`、`npm run test:agent-provider-lifecycle`、`npm run test:execution-attention-signals`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck`、`npm run build` 与 `git diff --check` 已通过；真实 Codex/Claude CLI / Extension Development Host smoke 仍待执行。
