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
related_plans:
  - docs/exec-plans/completed/execution-node-notification-research.md
  - docs/exec-plans/active/execution-attention-indicator-and-acknowledgement.md
updated_at: 2026-04-29
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
  - `resume-failed`
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

当前版本只桥接三类终端提醒信号：

- `BEL`
- `OSC 9`
- `OSC 777`

这里的“桥接”指的是：执行节点的 PTY 输出中出现这些信号时，扩展宿主额外发出 VSCode 工作台通知。

当前版本明确不覆盖：

- kitty `OSC 99`
- provider 原生结构化通知事件到 VSCode 通知的直接映射
- VSCode Extension Host 主动发 OS 原生通知

#### 7.7.2 配置开关

新增配置项：

- `devSessionCanvas.notifications.bridgeTerminalAttentionSignals`
- `devSessionCanvas.notifications.strongTerminalAttentionReminder`

当前口径：

- 默认值：`both`
- 作用域：都为 `window`
- `bridgeTerminalAttentionSignals`
  - 关闭时：现有启发式与诊断层继续解析这些信号，节点内 icon 与标题栏提醒也继续生效，但不额外发 VSCode 工作台通知
  - 打开时：在节点内提醒之外，再把命中的 attention signal 桥接为 VSCode 工作台通知
- `strongTerminalAttentionReminder`
  - `none`：只保留节点 attention icon 与 minimap 同色明暗闪烁，不额外开启标题栏闪烁或 minimap 尺寸 pulse
  - `titleBar`：在默认 attention 表面之外，只额外开启标题栏闪烁
  - `minimap`：在默认 attention 表面之外，只额外开启 minimap 尺寸 pulse
  - `both`：同时开启标题栏闪烁和 minimap 尺寸 pulse

这里两个开关默认分别是 `true` 和 `both`，是为了让执行节点里的 attention signal 在开箱即用时既能回到 VSCode 工作台，也能在画布节点内部保留显眼提醒；`BEL` 噪音仍依靠信号优先级与冷却去重控制，用户可按需分别关闭工作台通知桥接或收窄增强提醒表面。

#### 7.7.3 宿主分层

正式实现分层如下：

- `src/common/executionAttentionSignals.ts`
  - 负责解析 `BEL`、`OSC 9`、`OSC 777`
  - 负责处理跨 chunk carryover
  - 输出结构化 signal 列表与原有启发式所需的 `notificationCount` / `bellCount`

- `src/common/agentActivityHeuristics.ts`
  - 继续消费这些计数
  - 仍只服务于 `waiting-input` 启发式
  - 不负责用户通知 UI

- `src/panel/CanvasPanelManager.ts`
  - 负责把命中的 signal 落成 execution node 的宿主权威 attention pending 状态
  - 负责在 bridge 打开时把同一条 signal 额外桥接成 VSCode 工作台通知
  - 统一覆盖本地 PTY 与 runtime supervisor 输出
  - 负责在用户点击节点或使用工作台通知的 `查看节点` 动作时清除 attention pending

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

换句话说，通知桥接是旁路，不是状态机输入裁决层。

#### 7.7.6 通知类型与文案

当前版本统一使用：

- `vscode.window.showInformationMessage(...)`

当前没有把 `BEL` / `OSC` 直接升级成 `warning` 或 `error`。原因是终端协议本身通常不能可靠区分“完成提醒”“审批请求”“输入请求”这几种语义。

通知交互规则：

- 每条工作台通知都提供 `查看节点` action
- 用户点击后，宿主会打开当前活动画布；如果当前没有活动画布，则打开默认承载面
- 画布 ready 后，会把对应 `Agent` / `Terminal` 节点选中并拉到当前视口中心
- 这个交互只改变画布视图焦点，不改变节点 lifecycle 或执行状态

文案规则：

- 若 `OSC 9` / `OSC 777` 能提取出可显示文本，则显示：
  - `Agent「<节点标题>」: <消息>`
  - `Terminal「<节点标题>」: <消息>`
- 若只有 `BEL` 或没有可用消息体，则显示泛化文案：
  - `Agent「<节点标题>」发出终端提醒。`
  - `Terminal「<节点标题>」发出终端提醒。`

#### 7.7.7 节点内提醒与确认语义

当前正式方案要求每个 execution node 都维护一个“待确认 attention”状态：

- 当 `BEL`、`OSC 9` 或 `OSC 777` 命中可显示的 notify signal 时：
  - 节点标题栏状态控件左侧出现 attention icon
  - 若 `strongTerminalAttentionReminder` 为 `titleBar` 或 `both`，标题栏区域进入闪烁态
  - 若 `strongTerminalAttentionReminder` 为 `minimap` 或 `both`，minimap 在同色明暗闪烁之外额外加入尺寸 pulse
- 这个节点内提醒不依赖 `bridgeTerminalAttentionSignals`
- `OSC 9 ; 4` 这类进度状态仍不进入节点内 icon/闪烁

当前确认路径只有两条，且都直接清除宿主权威 attention pending：

- 用户点击对应的 `Agent` / `Terminal` 节点
- 用户点击 VSCode 工作台通知中的 `查看节点` 动作，并由宿主完成节点聚焦

这里的“点击节点”按产品语义理解为“用户显式用鼠标点击该节点”，而不是“selectedNodeId 首次从别的节点切换到它”，也不是程序化 focus、terminal selection change 或其它内部选中副作用。因此即使节点已经处于选中态，用户再次点击也仍应被视为确认动作；但仅仅因为节点在本地 UI 中重新获得 focus，不应自动清除提醒。

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
- `execution/attentionStrongReminderConfigChanged`
- `execution/attentionNotificationPosted`
- `execution/attentionNotificationSuppressed`

这些事件只服务于调试和回归分析，不参与产品状态语义。

#### 7.7.11 未来 OS 系统通知扩展方向（未实现）

这一小节只记录后续扩展方向，不代表当前版本已经支持 OS 系统通知。

如果后续要把 attention event 升级成真正的桌面系统通知，当前选定的扩展方向是：增加一个运行在用户本机 UI 侧的 notifier companion，而不是让当前 `workspace` 扩展宿主直接调用平台通知命令。

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
  - 在用户点击通知时回调主扩展命令，执行 `打开画布 -> 聚焦节点 -> 清除 attention pending`

- VSCode 工作台通知
  - 继续保留为默认 fallback
  - 当 notifier companion 未安装、当前平台不支持、当前运行在 web、或 companion 调用失败时，仍退回 `showInformationMessage(...)`

推荐的最小通信方式是显式扩展命令桥，而不是共享终端输出副作用：

- 主扩展负责调用类似 `devSessionCanvasNotifier.postSystemNotification` 的命令，并把 `nodeId`、`kind`、`title`、`message`、`dedupeKey`、`focusAction` 作为参数传给 companion。
- notifier companion 在通知点击后，再回调主扩展已有的节点聚焦命令。

在仓库组织上，这条路线允许两个扩展保留在同一个 repo 中维护，但发布时应保持为两个独立 VSIX：

- 当前主扩展继续承载画布、节点、会话与 runtime 逻辑。
- notifier companion 作为单独扩展承载本地系统通知。
- 若后续需要一键安装，再用 `extensionPack` 或 `extensionDependencies` 收口用户安装体验。

本小节当前不承诺以下内容：

- 不承诺已经存在 `ui` companion 扩展。
- 不承诺 web / `vscode.dev` 可以获得同等系统通知行为。
- 不承诺现阶段一定优先实现 OS 系统通知，而只是把它记录为后续扩展时的推荐架构方向。

## 8. 验证方法

至少需要完成以下验证，当前判断才适合升级为正式方案：

1. 在真实 VSCode 宿主内验证 `show*Message` 与 `withProgress(Notification)` 的使用场景，确认不会和节点状态或状态栏反馈重复。
2. 在 Ghostty、kitty、iTerm2 至少三种终端里人工验证 `BEL`、`OSC 9` 与当前焦点门槛的实际表现。
3. 在经过 `tmux` 的场景下验证通知序列是否透传，以及需要哪些配置。
4. 对 `Claude Code` / `Codex` 的“审批请求”“用户输入请求”“任务完成”三类事件分别验证最终提醒链路。
5. 在仓库实现阶段补自动化或人工验证，证明 `Agent` 状态机不会因为收到通知协议就错误地把 attention signal 误判为权威 turn 边界。
6. 如果后续开始实现 7.7.11 的 notifier companion，还需要额外验证本地桌面、Remote SSH / Dev Container、缺少 companion 时的 fallback，以及“点击系统通知后回到画布并聚焦节点”的完整链路。

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
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`
- 2026-04-29 已补记未来 OS 系统通知的 UI-side / local-side notifier companion 方向；本次仅更新设计文档，不涉及代码与运行时行为变更。
- 当前文档继续保持 `验证中`，因为本轮尚未在真实 Ghostty / kitty / iTerm2 / tmux 场景里做手工协议验证；但仓库内已完成 VS Code 宿主级自动化验证，覆盖配置开关、冷却抑制、节点内提醒、显式点击确认，以及工作台通知后定位节点。

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
