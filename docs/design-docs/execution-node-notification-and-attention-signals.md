---
title: 执行节点通知与注意力信号设计
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
  - docs/product-specs/canvas-node-notifications.md
related_plans:
  - docs/exec-plans/completed/execution-node-notification-research.md
  - docs/exec-plans/completed/execution-attention-indicator-and-acknowledgement.md
updated_at: 2026-06-17
---

# 执行节点通知与注意力信号设计

## 1. 背景

当前仓库已经同时出现了两类“提醒用户注意”的机制，但它们还没有被正式分层：

- VSCode 工作台通知：`src/extension.ts` 与 `src/panel/CanvasPanelManager.ts` 已经使用 `vscode.window.showInformationMessage` 和 `showWarningMessage` 处理重置确认、功能未启用提示与 reload 提示。
- 终端 attention signal：`src/common/agentActivityHeuristics.ts` 已把 `OSC 9`、`OSC 777` 与 `BEL` 解析为启发式信号，并用于把 `Agent` 从 `running` 回退到 `waiting-input`。

这说明仓库已经接触到“通知 UI”与“通知协议”两条链路，但目前仍缺一个正式设计回答以下问题：

1. 对执行节点来说，哪些事件应被视为“需要用户注意”的正式语义。
2. 这些事件应该在 VSCode 工作台内通知、终端系统通知、节点内状态变化之间如何分发。
3. 终端里的 `BEL` / `OSC` 协议究竟是“产品通知渠道”还是“非权威辅助线索”。

## 2. 问题定义

本设计需要回答五个问题：

1. VSCode 扩展当前有哪些正式通知 API，它们的适用边界是什么。
2. “系统级通知”与“编辑器内通知”在本项目语境下应如何区分。
3. Ghostty 等终端应用里，`Claude Code` 和 `Codex` 当前如何把任务完成、审批请求、`request_user_input` 等事件转成系统提醒。
4. 如果本仓库后续要支持更正式的注意力提醒，应该以什么对象建模事件，而不是把具体终端协议直接上升为产品语义。
5. 当前仓库里已经存在的 `OSC 9`、`OSC 777` 与 `BEL` 解析逻辑，应该保留在什么层级。

## 3. 目标

- 盘清 VSCode 官方通知 API 与 UX 规范的正式边界。
- 区分 VSCode 工作台通知、系统级终端通知和节点内状态提醒各自适合承载的事件类型。
- 盘清终端侧通知的主流协议与当前 `Claude Code` / `Codex` 的官方实现方式。
- 为本仓库形成一条当前可执行的设计判断，指导后续实现与验证。

## 4. 非目标

- 不在本轮直接落地新的通知实现。
- 不在本轮承诺所有 Terminal、所有 shell、多路复用器和 Remote 场景都能统一支持同一通知协议。
- 不在本轮把 `Agent` 的所有运行态都升级成新的通知类型。
- 不把“终端里曾经出现某个 escape sequence”直接等同于“用户已经看到可靠通知”。

## 5. 候选方案

### 5.1 只使用 VSCode 工作台通知

特点：

- 所有需要提醒用户的事件都通过 `showInformationMessage`、`showWarningMessage`、`showErrorMessage` 或 `withProgress` 进入 VSCode 工作台。
- 不依赖终端协议，也不需要区分 Ghostty、kitty、tmux、iTerm2 之类终端差异。

优点：

- 语义清晰，和扩展宿主绑定，最容易测试。
- 不需要额外处理 escape sequence 兼容性。

问题：

- 当用户不在 VSCode 窗口内时，它并不能天然覆盖“把用户从别的应用拉回来”这一目标。
- 对外部终端运行的 provider CLI，工作台通知并不是最近的用户接收面。

### 5.2 只使用终端系统通知

特点：

- 长任务完成、审批请求、用户输入请求全部通过 `BEL`、`OSC 9`、`OSC 777`、hooks 或外部脚本触发系统通知。
- VSCode 侧只保留节点状态，不再承担提醒职责。

优点：

- 终端离用户更近时，这条链路能直接落到操作系统通知中心或终端自带提醒。
- 对 SSH / tmux / 本地终端的长任务提醒很自然。

问题：

- 协议支持高度碎片化，不同终端支持的协议、焦点策略和多路复用器透传行为都不同。
- VSCode 扩展的正式 API 不以这些终端协议为边界，若把它当主语义，会让设计依赖具体终端实现细节。
- 某些事件明明需要用户在 VSCode 里操作，仍然要绕终端通知，路径过长。

### 5.3 先建模“注意力事件”，再按 surface 分发

特点：

- 先在宿主侧定义与产品语义一致的 attention event，例如：
  - `turn-complete`
  - `approval-requested`
  - `user-input-requested`
  - `runtime-error`
- 再根据当前运行环境和焦点状态，决定把事件分发到：
  - VSCode 工作台通知
  - 节点/画布内状态提示
  - 终端系统通知适配层

优点：

- 语义与 transport 分离，能同时兼容 VSCode 与终端生态。
- 更容易保持“provider 原生结构化事件优先、终端协议只作 fallback”的分层。

问题：

- 需要额外设计事件模型与去重策略。
- 在真正实现前，仍需要明确哪些事件必须跨 surface，哪些只应留在局部 UI。

## 6. 风险与取舍

- 取舍：不把 VSCode 工作台通知直接等同于系统级通知。
  原因：官方 API 当前明确覆盖的是工作台消息与通知型进度，而不是跨平台 OS 通知抽象。

- 风险：同一个 attention event 可能在 VSCode、终端和节点表面上重复出现，变成噪音。
  当前缓解：后续实现必须有去重与焦点门槛，例如“窗口聚焦时只在节点/工作台提醒，离焦时再升级为系统通知”。

- 风险：终端通知协议支持碎片化。
  当前缓解：把 `BEL` / `OSC` 视为 transport 能力，而不是产品主状态；协议不支持时，仍可退回 VSCode 工作台或 hooks 脚本。

- 风险：把终端通知信号误当成权威运行态。
  当前缓解：继续遵循 `docs/design-docs/agent-running-state-detection.md` 的优先级，provider 原生结构化事件永远高于 shell integration 和 PTY/escape-sequence 启发式。

- 风险：若未来要从 VSCode Extension Host 直接发 OS 通知，当前官方 API 可能不够用，而且 `workspace` 宿主在 Remote / Dev Container 场景下可能把通知发到错误机器。
  当前缓解：当前正式实现仍停留在 VSCode 工作台通知；若未来要扩展到 OS 系统通知，优先采用 7.7.11 记录的 UI-side / local-side notifier companion 路线，而不是把 `notify-send`、`terminal-notifier` 之类逻辑直接塞进当前 `workspace` 宿主。

## 7. 正式方案

### 7.1 VSCode 官方通知 API 的正式边界

根据 VSCode 官方 API 与官方 UX 指南，当前可确认的正式工作台通知接口包括：

- `vscode.window.showInformationMessage(...)`
- `vscode.window.showWarningMessage(...)`
- `vscode.window.showErrorMessage(...)`
- `vscode.window.withProgress(...)`

其中：

- `show*Message` 会把消息显示在 VSCode 工作台通知区域，并返回用户点击的 action。
- `MessageOptions.modal` 可以把消息提升为模态确认，不再是普通非模态提醒。
- `MessageOptions.detail` 可补充更长的说明文本。
- `withProgress({ location: ProgressLocation.Notification, ... })` 会把长任务进度显示为通知型进度，而不是普通消息 toast。

官方 UX 指南给出的关键约束包括：

- 通知只用于重要信息。
- 一次只显示一个通知。
- 通知文案应简短、清晰、可操作。
- 对会重复出现的通知，应该提供 “Do not show again” 之类的退出机制。
- 后台进度优先放状态栏或局部 UI，只有需要用户立刻注意时再升级为通知。
- 不要用通知做推广、调查问卷或已经成功完成动作的确认。

基于本轮能查到的官方文档，当前可做出的实现判断是：VSCode 扩展 API 公开提供的是工作台内通知与通知型进度，而不是一个跨平台 OS 原生通知 API。这里的“不是”是基于官方公开 API 范围作出的判断，不是官方显式声明的禁令。

### 7.2 工作台通知与系统级通知的适用场景

对本仓库而言，两类提醒应按用户所在 surface 区分：

- 工作台通知适合：
  - 用户已经在 VSCode 内，且下一步动作也需要在 VSCode 内完成。
  - 需要配合 action button 或 modal confirm 的场景。
  - 配置切换、reload、功能受限、错误说明这类宿主级反馈。

- 系统级通知更适合：
  - 用户可能已经切到别的应用或另一个终端窗口。
  - 长任务完成，需要把用户拉回当前会话。
  - 审批请求、`request_user_input` 这类“需要尽快回来响应”的外部注意力提醒。

- 节点或画布内状态更适合：
  - 会持续存在、和节点强绑定的状态，例如 `running`、`waiting-input`、`resume-failed`。
  - 不需要立即打断用户，只要用户回到画布就能看见的状态变化。

因此，通知不应替代节点状态；它只是 attention event 的一个投递面。

### 7.3 Terminal 环境中的系统通知机制

本轮可以确认的终端通知机制包括：

- `BEL`：经典终端提醒字符 `\x07`。是否发声、闪烁或转成系统通知，取决于终端配置。
- `OSC 9`：终端通知 escape sequence，常见形式是 `ESC ] 9 ; <message> BEL`。iTerm2、Ghostty、kitty 的文档都覆盖了这一路线或兼容层。
- `OSC 777`：Ghostty 官方文档明确把它和 `OSC 9` 一起列为受 `desktop-notifications` 开关影响的通知 escape sequence；但本轮查到的 Ghostty 公共文档没有继续展开 payload 格式。
- kitty `OSC 99`：kitty 官方文档定义了更完整的桌面通知协议，并说明 kitty 也保留了对 legacy `OSC 9` 的有限兼容。
- hooks / 外部命令：当终端本身不支持通知协议，或需要更稳定的跨平台行为时，可由 CLI 在事件点上触发本地脚本，再由脚本调用 `notify-send`、`terminal-notifier` 等系统工具。

这些协议的共同点是：通知是在“终端渲染端”落地，而不是在远端 shell 侧直接落地。也就是说，CLI 只负责输出控制序列；最终是否出现系统通知，要看本机终端是否支持以及中间层是否透传。

### 7.4 Ghostty 的当前能力边界

根据 Ghostty 当前官方文档：

- `bell-features` 可以决定 `BEL` 是否触发声音、视觉提示或系统通知。
- `desktop-notifications` 控制 Ghostty 是否响应桌面通知 escape sequence，并明确提到 `OSC 9`、`OSC 777`。
- `notify-on-command-finish` 可以在 shell 命令结束时由终端自身发出通知，这条能力并不要求应用主动发 `OSC 9`。
- VT 参考中已记录 `OSC 9` 与 `OSC 9 ; 4`；后者用于进度状态，不等同于桌面通知消息本身。

这意味着 Ghostty 至少支持三种不同来源的“提醒”：

1. 应用自己发 `BEL`
2. 应用自己发 `OSC 9` / `OSC 777`
3. Ghostty 根据命令生命周期自行发“命令完成”通知

后续实现不能把它们混成同一种产品语义。

### 7.5 `Claude Code` 的当前机制

根据 Anthropic 当前官方文档，`Claude Code` 至少有两条正式提醒路径：

- `Terminal Bell Notifications`
  - 官方单独提供了终端 bell 配置文档。
  - 官方文档明确提到：在 Ghostty、Kitty、iTerm2 这类支持终端通知的环境里，可以直接获得通知；在其它终端里，通常需要配置 hooks。
  - 如果经过 `tmux`，官方文档要求打开 `set -g allow-passthrough on` 之类设置，避免通知序列被吞掉。

- `hooks`
  - 官方 hooks 文档公开了 `Notification` 事件。
  - 该事件当前覆盖 `permission_prompt`、`idle_prompt`、`auth_success` 和 `elicitation_dialog`。
  - 这说明 `Claude Code` 并不要求“所有通知都只能通过终端协议完成”；它允许用 hooks 在本地直接接系统通知脚本。

对本仓库有价值的结论是：`Claude Code` 已经把“通知 transport”做成可替换层。终端 bell 可以是默认轻量路径，但 hooks 才是更稳定的跨终端补偿机制。

### 7.6 `Codex` 的当前机制

根据 `openai/codex` 当前官方仓库源码与 `app-server` README：

- `Codex app-server` 已公开结构化事件流，包括：
  - `turn/started`
  - `turn/completed`
  - `thread/status/changed`
  - 各类 `item/*` 与审批请求

- `Codex` 当前 TUI 内建了一层 `Notification` 分类，至少包括：
  - `AgentTurnComplete`
  - `ExecApprovalRequested`
  - `EditApprovalRequested`
  - `ElicitationRequested`
  - `PlanModePrompt`

- TUI 默认只在终端离焦时发通知；配置层暴露了：
  - `notification_method = auto | osc9 | bel`
  - `notification_condition = unfocused | always`

- 自动后端选择逻辑当前偏向：
  - `TERM_PROGRAM=WezTerm | WarpTerminal | ghostty`
  - `ITERM_SESSION_ID`
  - `TERM=xterm-kitty | wezterm | wezterm-mux`
  这些环境优先走 `OSC 9`。
  其它环境回退到 `BEL`。

- `OSC 9` 后端当前直接输出：

      \x1b]9;<message>\x07

- `BEL` 后端当前直接输出：

      \x07

这说明 `Codex` 当前已经把“结构化事件语义”和“终端通知 transport”分成两层：

1. 事件来源可以是 turn complete、审批请求、计划模式输入请求等 TUI 内部事件。
2. 投递通道可以是 `OSC 9` 或 `BEL`。

对本仓库最重要的结论不是“照抄 `Codex` 的 transport”，而是“先定义事件，再选 transport”。

### 7.7 当前仓库的正式方案

本轮已选定并落地的正式方案如下。

#### 7.7.1 事件范围

当前版本识别五类可配置 attention source：

- `BEL`
- `OSC 9`
- `OSC 777`
- `agentAbnormalExit`
- `codexAbnormalOutputText`

这里的“signal 生成 attention”指的是：执行节点的 PTY 输出中出现终端信号，或宿主观察到 Agent 异常退出 / Codex 高置信最终失败文本候选后，只有该 signal 在 `devSessionCanvas.notifications.enabledAttentionSignals` allow-list 中时，扩展宿主才会把它提升为节点 `attentionPending`、节点内提醒 icon、minimap attention 与可选外部桥接。未启用的终端信号仍可被底层解析器识别用于诊断和现有启发式输入，但不得生成产品 attention；未启用的 Agent 异常候选也不得生成产品 attention。

当前版本明确不覆盖：

- kitty `OSC 99`
- provider 原生结构化通知事件到 VSCode 通知的直接映射
- VSCode Extension Host 主动发 OS 原生通知

#### 7.7.2 配置开关

新增配置项：

- `devSessionCanvas.notifications.attentionSignalBridge`
- `devSessionCanvas.notifications.enabledAttentionSignals`
- `devSessionCanvas.notifications.strongTerminalAttentionReminder`

当前口径：

- 默认值：分别是 `system`、`["bel", "osc9", "osc777", "agentAbnormalExit", "codexAbnormalOutputText"]` 和 `both`
- 作用域：都为 `window`
- `attentionSignalBridge`
  - `none`：现有启发式与诊断层继续解析这些信号，节点内 icon、minimap 同色闪烁与增强提醒也继续生效，但不额外发工作台消息或系统通知
  - `workbench`：在节点内提醒之外，再把命中的 attention signal 桥接为 VSCode 工作台消息
  - `system`：优先把命中的 attention signal 交给本机 UI 侧的 `Dev Session Canvas Notifier` companion；若 companion 缺失、当前平台不支持或投递失败，则自动回退到 VSCode 工作台消息
- `enabledAttentionSignals`
  - `bel`：允许终端 `BEL` / `\x07` 生成节点 attention
  - `osc9`：允许普通 `OSC 9` notify 生成节点 attention；`OSC 9;4` 进度状态仍按 7.7.9 强制忽略
  - `osc777`：允许 `OSC 777` notify 生成节点 attention
  - `agentAbnormalExit`：允许已运行 Agent 非用户主动非 `0` 异常退出生成节点 attention
  - `codexAbnormalOutputText`：允许显式开启文本匹配后的 Codex 高置信异常输出文本生成节点 attention
  - 空数组 `[]`：所有 attention signal 都不生成节点 attention，也不会进入 strong reminder 或外部 bridge
- `strongTerminalAttentionReminder`
  - `none`：只保留节点 attention icon 与 minimap 同色明暗闪烁，不额外开启标题栏闪烁或 minimap 尺寸 pulse
  - `titleBar`：在默认 attention 表面之外，只额外开启标题栏闪烁
  - `minimap`：在默认 attention 表面之外，只额外开启 minimap 尺寸 pulse
  - `both`：同时开启标题栏闪烁和 minimap 尺寸 pulse

这里三个开关默认分别是 `system`、全部当前 attention signal 启用和 `both`，是为了让执行节点里的 attention signal 在开箱即用时保持既有覆盖面、优先回到本机桌面，并继续在画布节点内部保留显眼提醒；`workbench` 仍作为显式可选模式与 `system` 的失败回退存在，`BEL` 噪音、Agent 异常退出兜底或 Codex 文本异常兜底都可通过 `enabledAttentionSignals` 直接从 attention 入口关闭，也可继续依靠信号优先级与冷却去重控制。用户可按需把外部桥接改成 `none` / `workbench`，或单独收窄增强提醒表面。

#### 7.7.3 宿主分层

正式实现分层如下：

- `src/common/executionAttentionSignals.ts`
  - 负责解析 `BEL`、`OSC 9`、`OSC 777`
  - 负责处理跨 chunk carryover
  - 输出结构化 signal 列表与原有启发式所需的 `notificationCount` / `bellCount`
  - 定义 `ExecutionAttentionSignalKind`、终端 signal 子集、默认启用信号列表、配置 normalization 与 allow-list 过滤工具

- `src/common/agentActivityHeuristics.ts`
  - 继续消费这些计数
  - 仍只服务于 `waiting-input` 启发式
  - 不负责用户通知 UI

- `src/panel/CanvasPanelManager.ts`
  - 负责读取 `enabledAttentionSignals` 并在终端信号、Agent 异常退出和 Codex 最终失败文本候选进入产品 attention 前执行 allow-list 过滤
  - 负责把启用且可通知的 signal 落成 execution node 的宿主权威 attention pending 状态
  - 负责在 bridge 打开时把同一条 signal 额外桥接成 VSCode 工作台通知
  - 统一覆盖本地 PTY 与 runtime supervisor 输出
  - 负责在用户点击节点时清除 attention pending
  - 工作台通知的 `查看节点` 动作与系统通知 companion 回跳都只把对应节点居中显示，不清除 attention pending；确认仍由用户点击节点完成

- `src/webview/main.tsx` 与 `src/webview/styles.css`
  - 负责把 execution node 的 attention pending 渲染成标题栏 icon 与 minimap 中对应节点的闪烁态
  - 负责在 `strongTerminalAttentionReminder` 为 `titleBar` 或 `both` 时把标题栏渲染为闪烁态
  - minimap 闪烁始终由 `attentionPending` 驱动，不受 `strongTerminalAttentionReminder` 配置限制
  - minimap 闪烁的视觉强调沿用节点自身颜色，而不是额外切到统一通知色
  - `none` / `titleBar` 时，minimap 只保留同色明暗变化；`minimap` / `both` 时，才额外加入尺寸 pulse
  - minimap pulse 需要明显强于静止态的 opacity / glow，否则缩略图里不够可见
  - 不自己判断终端信号，只消费宿主回推的 metadata 与 runtime context

这意味着“状态启发式”“节点内提醒”和“VSCode 工作台通知”共用同一份底层解析器，但已经明确拆成三条独立支路。

#### 7.7.4 local 与 live-runtime 的接线方式

当前桥接统一在 `CanvasPanelManager` 落地，分别接在以下入口：

- 本地 Agent：`handleSessionChunk`
- 本地 Terminal：`handleTerminalChunk`
- live-runtime：`handleRuntimeSupervisorOutput`

正式规则是：

- supervisor 不直接发 VSCode 通知
- 所有通知桥接都由 Extension Host 完成
- 这样可以避免 UI 逻辑分散到 runtime owner，并保证本地与 live-runtime 使用同一套去重规则

#### 7.7.5 不影响启发式与诊断层

这是本轮方案的硬约束：

- `recordAgentOutputHeuristics()` 的语义不变
- `evaluateAgentWaitingInputTransition()` 的语义不变
- `BEL / OSC 9 / OSC 777` 仍继续作为 `Agent` `waiting-input` 的启发式输入
- 新增通知桥接失败、被抑制或被关闭，都不能反向影响 lifecycle 状态推进
- `enabledAttentionSignals` 当前控制候选 signal 到产品 attention 的入口，不直接关闭 `recordAgentOutputHeuristics()` 对底层终端信号的观察；如果未来要让该配置也影响 `waiting-input`，必须另行记录设计决策

换句话说，通知桥接是旁路，不是状态机输入裁决层。

#### 7.7.6 通知类型与文案

当前版本统一使用：

- `vscode.window.showInformationMessage(...)`

当前没有把 `BEL` / `OSC` 直接升级成 `warning` 或 `error`。原因是终端协议本身通常不能可靠区分“完成提醒”“审批请求”“输入请求”这几种语义。

通知交互规则：

- 每条工作台通知都提供 `查看节点` action
- 用户点击后，宿主会打开当前活动画布；如果当前没有活动画布，则打开默认承载面
- 画布 ready 后，只把对应 `Agent` / `Terminal` 节点居中显示，不选中节点
- 这个交互只改变画布视口位置，不改变节点 lifecycle、执行状态或 `attentionPending`

文案规则：

- 若 `OSC 9` / `OSC 777` 能提取出可显示文本，则显示：
  - `Agent「<节点标题>」: <消息>`
  - `Terminal「<节点标题>」: <消息>`
- 若只有 `BEL` 或没有可用消息体，则显示泛化文案：
  - `Agent「<节点标题>」发出终端提醒。`
  - `Terminal「<节点标题>」发出终端提醒。`

#### 7.7.7 节点内提醒与确认语义

当前正式方案要求每个 execution node 都维护一个“待确认 attention”状态：

- 当 `BEL`、`OSC 9` 或 `OSC 777` 命中可显示的 notify signal，或 Agent 异常退出 / Codex 最终失败文本候选命中，且该 signal kind 被 `enabledAttentionSignals` 启用时：
  - 节点标题栏状态控件左侧出现 attention icon
  - 若 `strongTerminalAttentionReminder` 为 `titleBar` 或 `both`，标题栏区域进入闪烁态
  - 若 `strongTerminalAttentionReminder` 为 `minimap` 或 `both`，minimap 在同色明暗闪烁之外额外加入尺寸 pulse
- 这个节点内提醒不依赖 `attentionSignalBridge`，但依赖 `enabledAttentionSignals`
- 未启用的 signal 不进入节点内 icon/闪烁，也不进入 minimap attention、strong reminder 或外部 bridge
- `OSC 9 ; 4` 这类进度状态仍不进入节点内 icon/闪烁

当前确认路径只有一条，且会直接清除宿主权威 attention pending：

- 用户点击对应的 `Agent` / `Terminal` 节点

这里的“点击节点”按产品语义理解为“用户显式用鼠标点击该节点”，而不是“selectedNodeId 首次从别的节点切换到它”，也不是程序化 focus、terminal selection change、工作台通知 `查看节点` 动作或系统通知回跳。因此即使节点已经处于选中态，用户再次点击也仍应被视为确认动作；但仅仅因为节点在本地 UI 中重新获得 focus 或被通知动作居中，不应自动清除提醒。

#### 7.7.8 去重与冷却

为避免噪音，当前版本按 session 维持独立的通知桥接状态，并应用冷却：

- 相同通知 key 在短时间内不重复弹出
- `BEL` 的冷却窗口比 `OSC 9 / OSC 777` 更长
- 同一 chunk 中优先使用显式 `OSC` 通知；只有没有显式通知时才回退到 `BEL`

这是为了满足“支持 `BEL`”与“不要刷屏”两个目标。

#### 7.7.9 `OSC 9 ; 4` 的特殊处理

Ghostty 文档中 `OSC 9 ; 4` 属于进度状态，而不是普通桌面通知文案。

当前正式方案是：

- 解析层仍把 `OSC 9` 记入 attention signal 统计，保持与现有启发式兼容
- 但当 `OSC 9` payload 呈现为 `4;...` 进度形态时，通知桥接层不把它弹成 VSCode 通知，节点内 icon/闪烁也不点亮

这样可以避免“进度更新被误弹成用户通知”，同时不破坏现有 heuristics 的输入口径

#### 7.7.10 诊断事件

当前实现新增以下诊断事件：

- `execution/attentionNotificationBridgeConfigChanged`
- `execution/enabledAttentionSignalsConfigChanged`
- `execution/attentionStrongReminderConfigChanged`
- `execution/attentionNotificationPosted`
- `execution/attentionNotificationSuppressed`

这些事件只服务于调试和回归分析，不参与产品状态语义。

#### 7.7.11 UI 侧 OS 系统通知 companion 路线（已实现）

这一小节原本用于记录后续扩展方向；当前已由 `docs/design-docs/notifier-companion-architecture.md` 收口为正式实现路径。也就是说，当前版本已经支持通过本机 UI 侧 notifier companion 在 `system` 模式下桥接 OS 系统通知；这里保留的是更高层的分层理由与安装语义。

当前选定并已实现的路线是：增加一个运行在用户本机 UI 侧的 notifier companion，而不是让当前 `workspace` 扩展宿主直接调用平台通知命令。

选择这条路线的原因是：

- 当前主扩展 `package.json` 已声明 `extensionKind: ["workspace"]`，因此在 Remote SSH、Dev Container、Codespaces 一类场景里，主扩展运行位置不一定是用户眼前这台机器。
- 如果把 `terminal-notifier`、`notify-send`、Windows Toast helper 或类似命令直接接进当前宿主，系统通知有较高概率落到远端机器，或在容器里直接失效。
- 当前 attention signal 解析、冷却去重、节点确认与聚焦路径都已经集中在 `CanvasPanelManager`；把“事件判定”和“通知落地”拆开，能最大化复用现有实现，并避免平台差异污染主扩展。

推荐分层如下：

- `workspace` 主扩展
  - 继续解析 `BEL`、`OSC 9`、`OSC 777` 与未来 provider 原生 attention event
  - 继续维护宿主权威 `attentionPending`、冷却去重、配置判断与焦点后确认逻辑
  - 对外只产出结构化 `AttentionEvent`

- `ui` / `local` notifier companion
  - 运行在用户本机 UI 侧
  - 接收结构化 `AttentionEvent`
  - 负责按平台调用 macOS / Windows / Linux 的系统通知能力
  - 在用户点击通知时回调主扩展命令，执行 `打开画布 -> 居中对应节点`，不代替用户清除 attention pending

- VSCode 工作台通知
  - 继续保留为默认 fallback
  - 当 notifier companion 未安装、当前平台不支持、当前运行在 web、或 companion 调用失败时，仍退回 `showInformationMessage(...)`

推荐的最小通信方式是显式扩展命令桥，而不是共享终端输出副作用：

- 主扩展负责调用类似 `devSessionCanvasNotifier.postSystemNotification` 的命令，并把 `nodeId`、`kind`、`title`、`message`、`dedupeKey`、`focusAction` 作为参数传给 companion。
- notifier companion 在通知点击后，再回调主扩展受控的节点居中命令；节点确认和清除 attention 仍只由画布内点击承担。

在仓库组织上，这条路线允许两个扩展保留在同一个 repo 中维护，但发布时应保持为两个独立 VSIX：

- 当前主扩展继续承载画布、节点、会话与 runtime 逻辑。
- notifier companion 作为单独扩展承载本地系统通知。
- 当前正式安装策略已收口为“主扩展 `extensionPack` 自动带上 notifier + notifier 单向 `extensionDependencies` 自动补齐主扩展”；仍继续保持两个独立 VSIX，而不是额外引入第三个 extension pack。需要注意的是，repo-local staged smoke 为了装配 wrapper 会临时移除这些安装期关系，因此真实 Marketplace / VSIX 自动补齐路径仍应在 clean profile 安装步骤里单独复核。

本小节当前不承诺以下内容：

- 不承诺 web / `vscode.dev` 可以获得同等系统通知行为。
- 不承诺所有平台都具备完全一致的通知点击回跳体验；具体能力边界以 `docs/design-docs/notifier-companion-architecture.md` 为准。

#### 7.7.12 Agent 异常中断通知

当前版本在保留 `Codex` / `Claude Code` 自身终端通知输出解析的基础上，把 Agent 会话异常额外纳入同一条 attention event 投递链路。它不是对 provider 输出的替代或拦截，而是宿主对已观察到的异常现象补充生成的兜底信号：

- 适用范围只覆盖 `Agent` 节点，且 provider 限定为 `codex` 与 `claude`。
- 本地 PTY 与 live-runtime supervisor 两条路径都适用；终态判定点分别在本地 `onExit` finalize、以及 supervisor `sessionState` 从 live 变成非 live 的处理里；输出流判定点在两条路径的 Agent stdout/stderr chunk 处理里。
- 只有 `agentAbnormalExit` 启用，且 Agent 已经跑起来（`running` 或 `waiting-input`）之后，进程在非用户主动停止的情况下以非 `0` 退出码结束并进入 `error`，才会触发异常中断通知。
- 运行中的输出流文本匹配默认关闭；只有当 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications` 设置为 `codex` 且 `codexAbnormalOutputText` 启用时，Codex 输出中出现高置信最终失败文案才会触发补充提醒。当前模式包括 Codex TUI 方块标记的最终错误行 `■ {"error":{"message":"Internal server error"}}`，以及同样以 `■` 标记、出现在输出尾部的 `stream disconnected before completion: stream closed before response.completed`。其中 `response.completed` 是 Codex 一次 turn 完成的权威事件，不是 Claude Code 的标准事件；尾部紧随的 Codex 输入提示行（如 `› Write tests for @filename`、`›继续`）和模型 / cwd footer（如 `gpt-5.4 xhigh · ~/ZeroInput`）不影响判定。`Reconnecting... n/m` 与树形缩进的 `└ Stream disconnected ...` 表示 Codex 仍可能自动 retry / reconnect，不作为最终失败文本触发提醒，即使同类文本重复出现也不触发。
- Claude / Anthropic API 的流式完成事件是 `message_stop`，Claude Code 的公开 hook 语义里 API error 会进入 `StopFailure` 而不是 `Stop`。因此在没有 Claude Code 真实输出样本或结构化 `StopFailure` 证据前，不把 Codex 的 `response.completed` 文案写成 Claude-specific 规则，也不对 Claude 启用输出文本匹配；Claude 侧仍主要依赖“已运行后非用户主动非 `0` 退出”的终态兜底，或未来接入更结构化的 Claude 信号。
- 宿主不尝试自动重放 prompt、自动 resume 或替 provider 做流恢复。流断开后的 retry / reconnect / continuation 属于 provider 自身拥有 turn state 的层级；画布只做补充提醒，避免重复 tool call、重复写文件或破坏 provider 会话状态。`Reconnecting... n/m` 与树形缩进的 stream-disconnected 文案属于仍在运行中的 retry / reconnect 暂态输出，重复出现也不进入异常通知候选；对方块标记且位于输出尾部的 `Internal server error` / stream-disconnected 最终错误样式，可直接提醒。
- 启动前校验失败、启动命令解析或 spawn 失败、resume 启动失败（`resume-failed`）、用户点击停止按钮、删除节点清理、退出码为 `0` 的正常结束，以及 `Terminal` 节点退出都不触发这条额外通知。
- 这条通知沿用 `devSessionCanvas.notifications.attentionSignalBridge`：`none` 只保留节点内 `attentionPending`，不弹工作台或系统通知；`workbench` 走 VS Code 工作台消息；`system` 优先交给 UI-side notifier companion，失败再回退工作台消息。异常退出和异常输出文本是否能生成 attention 由 `devSessionCanvas.notifications.enabledAttentionSignals` 统一控制；异常输出文本匹配还需 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications` 显式开启，默认 `off`，当前唯一开启值是 `codex`。
- Codex / Claude 自己输出的 `BEL`、`OSC 9`、`OSC 777` 仍按 7.7.4 的终端 attention signal 解析路径处理；异常中断通知与可选文本匹配不会修改、吞掉或替代这些输出。
- 异常终态或异常输出流会把同一节点的 `attentionPending` 置为 `true`，因此节点标题栏 icon、minimap 闪烁和点击节点后确认清除的语义与终端 attention signal 完全一致。
- 通知标题仍使用 `DSCanvas · <workspace> · Agent`，通知正文使用 provider 与节点标题组合，例如 `Codex Agent「Agent 1」异常中断：...`、`Claude Code Agent「Agent 2」异常中断：...` 或在用户启用 Codex 文本匹配时使用 `Codex Agent「Agent 3」输出流异常：Internal server error...` / `stream disconnected before completion...`；正文会裁剪长错误摘要，避免把完整终端输出推到系统通知。

这条规则的关键取舍是：Codex / Claude 的原生通知输出仍是正常提醒主路径，宿主异常检测只做兜底补充。它不要求 provider 在已运行会话崩溃前一定能输出 `BEL` / `OSC 9`，因此可覆盖“会话跑起来后崩溃、进程异常退出但没有来得及发终端通知”的场景；同时用户可以通过 `enabledAttentionSignals` 把这类兜底信号彻底排除出产品 attention。Codex 异常输出文本属于用户显式 opt-in 的 fallback，只在开启 `agentAbnormalOutputTextNotifications=codex` 且 `codexAbnormalOutputText` 启用后扫描新增输出并要求完整高置信文案；其中方块标记且位于输出尾部的 `Internal server error` / stream-disconnected 文案会生成通知，且允许尾部再跟 Codex 输入提示与模型 / cwd footer；`Reconnecting... n/m` 与树形缩进的 stream-disconnected 文案被视为仍在运行中的 retry / reconnect 暂态输出，即使重复出现也不会生成通知，避免 Codex 自动 retry 期间连续打扰用户；扫描只面向新增输出，也避免旧 buffer 在下一轮输入、配置切换或 live-runtime attach 后重复触发 stale 通知。live-runtime supervisor attach 时，`snapshot.output` 中已有的历史输出会被标记为已扫描，后续第一段新 chunk 只匹配新增部分；`enabledAttentionSignals` 变更时也会把当前 buffer 标为已扫描，避免重新启用后把历史异常文本补弹成新提醒。同时不把正常完成、启动失败或 resume 启动失败当成额外提醒，因为这些阶段用户大概率仍在画板页面，额外外部通知只会增加噪音。如果后续接入 Codex app-server / protocol，应优先消费结构化 `StreamError` / `Error`，并区分“正在 retry / reconnect”的暂态和“最终失败”的终态，外部通知默认只在最终失败时触发。Claude 侧如果后续接入 `StopFailure`、hook 或其他结构化输出，也应按同样原则优先使用结构化信号，而不是继续扩大通用正则。

## 8. 验证方法

至少需要完成以下验证，当前判断才适合升级为正式方案：

1. 在真实 VSCode 宿主内验证 `show*Message` 与 `withProgress(Notification)` 的使用场景，确认不会和节点状态或状态栏反馈重复。
2. 在 Ghostty、kitty、iTerm2 至少三种终端里人工验证 `BEL`、`OSC 9` 与当前焦点门槛的实际表现。
3. 在经过 `tmux` 的场景下验证通知序列是否透传，以及需要哪些配置。
4. 对 `Claude Code` / `Codex` 的“审批请求”“用户输入请求”“任务完成”“异常退出”“Codex 最终失败文本”和“Codex retry / reconnect 暂态输出不提醒”事件分别验证最终提醒链路。
5. 在仓库实现阶段补自动化或人工验证，证明 `Agent` 状态机不会因为收到通知协议就错误地把 attention signal 误判为权威 turn 边界。
6. 如果后续开始实现 7.7.11 的 notifier companion，还需要额外验证本地桌面、Remote SSH / Dev Container、缺少 companion 时的 fallback，以及“点击系统通知后回到画布并居中节点，但不自动选中或清除 attention”的完整链路。

## 9. 当前验证状态

- 2026-04-21 已完成仓库内代码与现有设计文档复核。
- 2026-04-21 已完成一手资料阅读，覆盖 VSCode、Ghostty、kitty、iTerm2、Anthropic 官方文档，以及 `openai/codex` 当前官方源码。
- 2026-04-21 已完成第一轮代码落地，并通过：
  - `npm run typecheck`
  - `npm run test:execution-attention-signals`
  - `npm run test:smoke`
- 2026-04-22 已完成第二轮节点内 icon / 闪烁 / 点击确认实现，并通过：
  - `npm run typecheck`
  - `npm run test:execution-attention-signals`
  - `npm run build`
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs`
- 2026-04-29 已补记未来 OS 系统通知的 UI-side / local-side notifier companion 方向；本次仅更新设计文档，不涉及代码与运行时行为变更。
- 2026-05-21 已补充 Agent 异常中断通知设计：非用户主动的 `Codex` / `Claude Code` Agent 已运行后非 `0` 退出 `error` 终态，会在 provider 原生终端通知之外，补充复用同一条 attention bridge 与节点确认语义；启动失败和 `resume-failed` 不触发额外通知。
- 2026-05-22 已补充 provider 边界：`stream closed before response.completed` 是 Codex / OpenAI Responses 的未完成标记；Claude Code 不共享 `response.completed` 这个标准完成事件，后续 Claude 流失败扩展应优先基于 `StopFailure` 或真实输出样本。当前 Codex TUI `Reconnecting... n/m` 场景把树形缩进的该文案视为 retry / reconnect 暂态，不作为最终失败通知；方块标记且位于输出尾部的同类文案才作为最终失败。
- 2026-05-24 根据 review 收口异常输出文本匹配：新增 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，默认 `off`，仅 `codex` 开启 Codex 高置信完整文案匹配；Claude 不启用文本匹配，用户输入 reset、配置切换与 live-runtime attach 会把当前 buffer 标为已扫描，避免 stale stream notification 重复触发。
- 2026-06-10 新增 `devSessionCanvas.notifications.enabledAttentionSignals`，把候选 signal 是否生成画布 attention 从外部 bridge 目标中拆出；已通过单元测试覆盖 normalization / allow-list 过滤，并通过 VS Code smoke 扩展 attention 场景覆盖禁用 BEL 不生成节点 attention、重新启用 BEL 后恢复节点 attention 与工作台桥接，同时覆盖禁用 `agentAbnormalExit` / `codexAbnormalOutputText` 后不生成节点 attention 或外部通知。
- 2026-06-10 修正 Codex 异常输出通知抑制规则：方块标记且位于输出尾部的 `Internal server error` / stream-disconnected 样式作为可直接提醒的 Codex 最终错误文本；`Reconnecting... n/m` 与树形缩进的 stream-disconnected 属于 retry / reconnect 暂态输出，即使重复出现也不提醒。
- 2026-06-17 修正 Codex TUI footer 兼容：方块最终错误行后紧跟 `›继续` 这类无空格输入提示，以及 `gpt-5.4 xhigh · ~/ZeroInput` 这类模型 / cwd footer 时，仍视为输出尾部最终失败；历史 buffer 仍只在 reload / attach 后标记为已扫描，不补发 stale 通知。
- 当前文档继续保持 `验证中`，因为本轮尚未在真实 Ghostty / kitty / iTerm2 / tmux 场景里做手工协议验证；但仓库内已完成 VS Code 宿主级自动化验证，覆盖配置开关、冷却抑制、attention signal allow-list、节点内提醒、显式点击确认，以及工作台通知后居中节点但不确认提醒。

## 10. 外部依据

本轮判断主要基于以下一手资料：

- VSCode API Reference：`showInformationMessage`、`showWarningMessage`、`showErrorMessage`、`withProgress`
- VSCode Common Capabilities：Notification messages
- VSCode UX Guidelines：Notifications
- VSCode Terminal 文档：shell integration、appearance
- Ghostty 文档：config reference、VT reference、BEL 控制、1.3.0 release notes
- kitty 官方文档：Desktop notifications
- iTerm2 官方文档：Escape Codes / Generated Alerts
- Anthropic 官方文档：`Claude Code` terminal config、hooks
- `openai/codex` 官方仓库：`app-server` README、TUI `chatwidget.rs`、`tui.rs`、`notifications/*`、`config/src/types.rs`
