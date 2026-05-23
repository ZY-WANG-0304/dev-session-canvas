# 画布节点通知产品规格

## 1. 用户问题

当用户在画布上并行运行多个 `Agent` 或 `Terminal` 时，如果某个节点完成任务、遇到错误或需要用户输入，用户往往无法及时察觉，导致：

- 用户需要频繁切换到每个节点查看状态，打断当前工作流
- 关键事件（如 Agent 等待输入、Terminal 命令完成）被遗漏，降低协作效率
- 用户无法在画布全局视角下快速定位需要注意的节点
- 当画布不在当前可见区域时，用户完全失去对节点状态变化的感知

## 2. 目标用户

当前阶段优先服务以下用户场景：

- 在画布上同时运行多个 `Agent` 或 `Terminal` 的开发者
- 需要在编辑代码的同时监控后台任务执行状态的用户
- 希望在 Agent 完成任务或遇到问题时能及时得到提醒的用户

## 3. 核心用户流程

### 3.1 基础通知流程

1. 用户在画布上启动一个或多个 `Agent` / `Terminal` 节点
2. 用户切换到其他工作（编辑代码、查看文档等），画布可能不在当前可见区域
3. 某个节点的执行单元输出终端注意力信号（BEL、OSC 9、OSC 777）；在此基础上，`Codex` / `Claude Code` Agent 已运行会话也可能非用户主动异常退出，或 `Codex` 输出已知流断开错误
4. 系统捕获并解析 provider 自身输出的注意力信号；若没有可靠输出但宿主观察到 Agent 已运行后异常终态或已知流断开错误，也补充识别出需要用户注意的事件
5. 系统在画布节点上显示视觉提示（节点内提醒 icon、Minimap 同色明暗闪烁）
6. 如果桥接模式不是 `none`，系统还会按配置额外弹出 VS Code 工作台消息或桌面系统通知
7. 如果启用了强提醒模式，系统还会在节点标题栏或 Minimap 上显示额外增强提示
8. 用户通过视觉提示快速定位到需要注意的节点；若用户点击 VS Code 工作台通知或支持回调的系统桌面通知，画布只把对应节点居中显示，不自动选中节点
9. 用户通过以下方式之一清除通知状态：
   - 左键点击节点本体

### 3.2 配置调整流程

1. 用户打开 VSCode 设置（`devSessionCanvas.notifications.*`）
2. 用户根据个人偏好调整通知行为：
   - 选择通知桥接模式（不桥接通知、工作台消息、系统通知）
   - 选择强提醒模式（无、节点标题栏、Minimap 尺寸脉冲、两者都有）
3. 配置立即生效，无需重启 VSCode

## 4. 在范围内

### 4.1 终端注意力信号解析与节点提醒

- 解析并识别 `Agent` / `Terminal` 输出中的终端注意力信号：
  - BEL (``): 传统终端响铃信号
  - OSC 9 (`ESC ] 9 ; ... BEL` 或 `ESC ] 9 ; ... ESC \`): iTerm2 风格通知协议
  - OSC 777 (`ESC ] 777 ; notify ; ... BEL` 或 `ESC ] 777 ; notify ; ... ESC \`): 通用通知协议
- 支持信号过滤规则：
  - OSC 9 中以 `4;` 开头的消息被标记为 `ignore`，不触发任何提醒
  - 其他信号默认触发节点提醒
- 节点提醒表面（始终启用，不受配置控制）：
  - 节点内提醒 icon 显示
  - Minimap 对应节点的同色明暗闪烁
  - 节点 `attentionPending` 状态标记并持久化到存储

### 4.1.1 Agent 异常中断提醒

- `Codex` / `Claude Code` Agent 会话如果已经跑起来，并在用户未主动停止的情况下以非 `0` 退出码异常退出，或在运行输出中出现已知流断开错误，也会在 provider 自身终端通知之外，补充触发节点提醒与可选外部通知。
- 该能力不替代 Codex / Claude 自己输出的 `BEL`、`OSC 9`、`OSC 777`，也不修改其输出解析；这些信号仍按 4.1 的终端注意力信号链路处理。
- 触发范围：
  - 本地 PTY Agent 已进入 `running` 或 `waiting-input` 后，进程退出码非 `0` 且不是用户主动停止，状态进入 `error`
  - live-runtime supervisor 上报同等的“已跑起来后非用户主动非 `0` 退出” `error` 非 live 终态
  - 本地 PTY 或 live-runtime 已跑起来的输出中出现已知流断开失败文案；当前高置信样本是 Codex / OpenAI Responses 体系的 `stream disconnected before completion: stream closed before response.completed`
- Provider 边界：
  - `response.completed` 是 Codex 一次 turn 成功完成的权威事件；缺少它意味着 Codex 认为本次 stream 未完整完成。该文案不是 Claude Code 的标准事件或标准报错。
  - Claude / Anthropic 的流式完成事件是 `message_stop`，Claude Code 的公开 hook 语义里 API error 对应 `StopFailure` 而不是 `Stop`。在没有 Claude Code 真实输出样本或结构化 `StopFailure` 证据前，不把 Codex 的 `response.completed` 文案泛化为 Claude-specific 规则。
  - Dev Session Canvas 只补充提醒，不自动重放 prompt、不自动 resume、不替 provider 做 stream recovery；retry / reconnect / continuation 由 Codex / Claude 自己负责，避免重复执行工具或破坏会话状态。
- 不触发范围：
  - 启动前校验失败、启动命令解析失败、命令不存在或 spawn 失败
  - resume 启动失败或状态进入 `resume-failed`
  - 用户点击停止按钮后的 `stopped`
  - 退出码 `0` 的正常结束
  - 删除节点或清理 runtime 引发的受控停止
  - `Terminal` 节点退出
- 异常中断提醒复用 `attentionPending`：节点内提醒 icon、Minimap 闪烁、强提醒模式和“点击节点清除”语义与终端注意力信号一致；流断开输出提醒不会等待进程退出。
- 异常中断外部通知复用 `devSessionCanvas.notifications.attentionSignalBridge`：`none` 不弹外部通知，`workbench` 弹 VS Code 工作台消息，`system` 优先交给 notifier companion 并在失败时回退工作台消息。

### 4.2 通知桥接模式

- 配置项 `devSessionCanvas.notifications.attentionSignalBridge`：
  - 类型：`enum`
  - 可选值：`none` | `workbench` | `system`
  - 默认值：`system`
  - 作用域：`window`
- 各模式行为：
  - `none`：不额外弹出 VS Code 工作台消息或系统通知；节点内提醒 icon、Minimap 同色明暗闪烁与 `attentionPending` 状态仍然保留
  - `workbench`：把终端注意力信号桥接为 VS Code 工作台消息（`vscode.window.showInformationMessage`）
  - `system`：优先把 attention event 发送给本机 UI 侧的 `Dev Session Canvas Notifier` companion extension；若 companion 可用且成功接单，则本次提醒走本机桌面系统通知，不再重复弹 VS Code 工作台消息
- `system` 模式下，系统通知标题应包含固定前缀 `DSCanvas`、当前 workspace 名称，以及节点类型（`Agent` / `Terminal`）
- `system` 模式的补充约束：
  - companion 会同时返回实际使用的 `backend` 与 `activationMode`；其中 `activationMode=none` 明确表示“当前平台只保证通知出现，不承诺点击后回到 VS Code”
  - 用户点击支持回调的系统桌面通知时，画布只负责回到对应节点并把节点居中显示，不代替用户选中节点，也不清除 `attentionPending`
  - 若 companion 缺失、当前平台不支持、或调用失败，则自动回退到 VS Code 工作台消息，避免静默丢提醒

### 4.2.1 Notifier companion 声音开关

- 配置项 `devSessionCanvasNotifier.notifications.playSound`：
  - 类型：`boolean`
  - 默认值：`true`
  - 作用域：`window`
  - 功能：控制 notifier companion 在当前本机 UI 侧投递桌面通知时，是否请求系统播放提示音
- 开启后：
  - notifier 会在当前平台支持的后端上 best-effort 请求提示音
  - Linux / Windows 是否真正响铃仍取决于系统通知服务；macOS `osascript` 回退路径会在 `display notification` 上请求内建声音名（当前实现为 `Submarine`），不再额外 `beep`
- 关闭后：
  - notifier 会尽量走静音路径，但不影响通知弹出、点击回跳和 `attentionPending` 状态机
- `Dev Session Canvas Notifier` sidebar 当前拆成多个独立 view section：`概览`、`注意事项`、`macOS`、`Linux`、`Windows`、`Codex`、`Claude Code`
- 各 section 的正文默认使用受控 Markdown 预览渲染，支持段落、列表、标题与 fenced code block；测试通知、打开诊断日志等交互按钮继续保留原生按钮语义
- 用户可从 `概览` view title 行尾部的齿轮按钮打开 companion 配置；该按钮只挂在承载通知状态、测试按钮和诊断入口的概览 section 上，不会出现在其他平台或 Agent section
- 该入口只负责跳转设置，不改变通知投递或回跳语义

### 4.3 强提醒模式

- 配置项 `devSessionCanvas.notifications.strongTerminalAttentionReminder`：
  - 类型：`enum`
  - 可选值：`none` | `titleBar` | `minimap` | `both`
  - 默认值：`both`
  - 作用域：`window`
- 各模式行为：
  - `none`：不额外开启增强提醒，只保留节点提醒 icon 和 Minimap 的同色明暗闪烁
  - `titleBar`：只让执行节点标题栏进入闪烁态（`is-attention-flashing`），不给 Minimap 增加尺寸脉冲
  - `minimap`：只让 Minimap 对应节点在同色明暗闪烁之外额外加入尺寸脉冲（`has-strong-attention-reminder`），不闪烁节点标题栏
  - `both`：同时开启节点标题栏闪烁和 Minimap 尺寸脉冲

### 4.4 Agent 等待输入检测

- 基于启发式规则检测 Agent 是否在等待用户输入：
  - 检测终端提示符模式 (`>`, `›`, `❯`, `≫`, `»`)
  - 检测通知信号 (BEL, OSC 9, OSC 777)
  - 检测输出静默时间窗口
  - 排除 spinner 动画干扰
- 转换原因分类：
  - `prompt`：检测到提示符
  - `notification`：检测到通知信号
  - `fallback`：超时兜底机制

### 4.5 通知状态管理

- 节点通知状态自动管理：
  - 当检测到注意力信号时，自动设置节点为待注意状态（`attentionPending: true`）
  - 通知状态清除路径：
    - 用户左键点击节点本体
  - 用户点击 VS Code 工作台通知中的"查看节点"按钮，或点击支持回调的系统桌面通知（例如 `activationMode=direct-action` 或 `protocol` 的 companion 后端），只会让画布把对应节点居中显示；是否确认并清除提醒，仍由用户自己点击节点决定
- 状态持久化：
  - 通知状态会持久化到存储（snapshot 和 workspace state）
  - 重新加载画布后会从存储中恢复通知状态
  - 用户可以在画布重新加载后继续看到之前未处理的通知

## 5. 不在范围内

### 5.1 当前阶段不做

- 不支持自定义通知声音或声音选择
- 不支持通知历史记录或通知中心
- 不支持基于通知内容的智能分类或优先级
- 不支持跨 workspace 的通知聚合
- 不支持通知的延迟或批量处理
- 不支持用户自定义通知规则或过滤器

### 5.2 明确排除

- 不替代 VSCode 原生的通知系统 (`vscode.window.showInformationMessage` 等)
- 除 Agent 异常中断与已知流断开输出外，不处理非终端输出的通知 (如文件系统变化、Git 事件等)
- 不提供通知的远程同步或多设备协同

## 6. 关键对象与状态

### 6.1 执行注意力信号 (ExecutionAttentionSignal)

```typescript
interface ExecutionAttentionSignal {
  kind: 'bel' | 'osc9' | 'osc777';
  rawMessage?: string;
  message?: string;
  presentation: 'notify' | 'ignore';
}
```

- `kind`：信号类型
- `rawMessage`：原始信号内容
- `message`：规范化后的消息内容
- `presentation`：展示策略（通知或忽略）

### 6.2 Agent 活动启发式状态 (AgentActivityHeuristicState)

```typescript
interface AgentActivityHeuristicState {
  lastOutputAtMs?: number;
  lastLineBoundaryAtMs?: number;
  lastPromptAtMs?: number;
  lastNotificationAtMs?: number;
  lastBellAtMs?: number;
  lastSpinnerAtMs?: number;
  oscCarryover: string;
}
```

- 记录各类事件的最后发生时间
- 用于判断 Agent 是否在等待用户输入
- `oscCarryover`：跨 chunk 的 OSC 序列缓存

### 6.3 强提醒模式 (CanvasStrongTerminalAttentionReminderMode)

```typescript
type CanvasStrongTerminalAttentionReminderMode = 'none' | 'titleBar' | 'minimap' | 'both';
```

- 控制额外增强提醒表面的显示位置
- 默认值为 `both`，同时启用节点标题栏闪烁和 Minimap 尺寸脉冲

### 6.4 节点通知状态

- 节点级别的状态标记：
  - `has-attention`：节点有待处理的通知（始终显示）
  - `is-attention-flashing`：节点标题栏闪烁动画（受 `strongTerminalAttentionReminderMode` 控制）
- Minimap 节点属性：
  - `data-minimap-attention-pending`：Minimap 节点待注意标记（始终显示）
  - `data-minimap-attention-flashing`：Minimap 节点同色明暗闪烁（始终显示）
  - `data-minimap-attention-size-pulsing`：Minimap 节点尺寸脉冲标记（受 `strongTerminalAttentionReminderMode` 控制）
  - `has-strong-attention-reminder`：CSS 类名，用于触发 Minimap 尺寸脉冲动画

## 7. 验收标准

### 7.1 功能验收

- [ ] 系统能正确解析 BEL、OSC 9、OSC 777 三种终端注意力信号
- [ ] OSC 9 中以 `4;` 开头的消息被正确标记为 `ignore`
- [ ] 当检测到注意力信号时，节点内提醒 icon 和 Minimap 同色明暗闪烁始终显示
- [ ] 当 `Codex` / `Claude Code` Agent 已运行后非用户主动非 `0` 异常退出，或运行输出出现已知流断开错误时，节点进入 `attentionPending` 并按桥接模式发出可选外部通知
- [ ] 配置 `attentionSignalBridge` 为 `none` 时，不额外弹出 VS Code 工作台消息或系统通知，但节点内提醒 icon 和 Minimap 闪烁仍然保留
- [ ] 配置 `attentionSignalBridge` 为 `workbench` 时，会弹出 VS Code 工作台消息
- [x] 配置 `attentionSignalBridge` 为 `system` 且 companion 可用时，主扩展会优先把 attention event 发送给 companion，并避免重复弹出 VS Code 工作台消息
- [x] companion 成功接单时，diagnostic event 会记录实际 `backend` 与 `activationMode`，便于区分“完整可点击通知”和“只展示通知”的平台差异
- [ ] 配置 `attentionSignalBridge` 为 `system` 但 companion 不可用时，会自动回退到 VS Code 工作台消息
- [ ] 强提醒模式的四种配置 (`none`、`titleBar`、`minimap`、`both`) 都能正确控制节点标题栏闪烁和 Minimap 尺寸脉冲
- [ ] Agent 等待输入检测能正确识别提示符、通知信号和超时情况
- [ ] 左键点击节点本体后，通知状态自动清除
- [x] 点击 VS Code 工作台通知中的"查看节点"按钮后，画布只居中对应节点，不选中节点且不清除通知状态
- [x] 点击支持回调的系统桌面通知后，画布只居中对应节点，不选中节点且不清除通知状态
- [ ] 配置变更后立即生效，无需重启 VSCode
- [ ] 通知状态会持久化到存储，重新加载画布后能正确恢复

### 7.2 性能验收

- [ ] 信号解析不影响终端输出的实时性
- [ ] 大量并发通知不导致 UI 卡顿
- [ ] OSC 序列跨 chunk 解析的缓存大小受限（256 字节）
- [ ] 通知状态更新不触发不必要的画布重绘

### 7.3 体验验收

- [ ] 通知视觉提示足够明显，用户能快速注意到
- [ ] 通知视觉提示不过于干扰，不影响正常工作
- [ ] 强提醒模式的视觉效果在浅色和深色主题下都清晰可见
- [ ] Minimap 上的通知提示与节点本体的提示保持一致
- [ ] 用户能通过设置面板轻松调整通知行为

### 7.4 真实桌面通知人工验收

- [x] 在本机 VS Code 中运行 `Dev Session Canvas Notifier: 发送测试桌面通知`，能够看到一次真实桌面通知或拿到明确失败原因
- [x] Linux：若实际 `activationMode=direct-action`，点击通知后会回到 VS Code；若实际 `activationMode=none`，则只要求确认通知出现，并在诊断输出中看到退化记录
- [x] macOS：若实际 `backend=macos-terminal-notifier`，点击通知后会回到 VS Code；若实际 `backend=macos-osascript`，则只要求确认通知出现，并接受“不可点击回跳”的退化
- [x] Windows：若实际 `backend=windows-toast`，点击通知后会回到 VS Code；若系统通知被 Focus Assist / 权限策略拦截，需在通知中心或诊断输出中记录环境原因
- [ ] 人工验收记录必须至少包含平台、实际 `backend`、实际 `activationMode` 和点击回调是否成功，避免把退化路径误记成完整能力

## 8. 开放问题

### 8.1 待确认

- **通知优先级**：当多个节点同时触发通知时，是否需要优先级机制？当前实现是平等对待所有通知。
- **自定义信号**：是否需要支持用户自定义的终端注意力信号格式？当前仅支持标准的 BEL、OSC 9、OSC 777。
- **通知历史**：是否需要提供通知历史记录功能，让用户回溯之前的通知？当前实现是无历史记录。

### 8.2 已知限制

- **Codex / Claude Code 集成**：Codex Agent 需要在 `[tui]` 中设置 `notifications = true`、`notification_method = "osc9"` 和 `notification_condition = "always"` 才能稳定触发 provider 自身的终端注意力信号；Claude Code Agent 需要设置 `preferredNotifChannel: "iterm2"` 才能进入同一桥接链路。Agent 异常中断与流断开输出通知只是补充兜底，不降低这部分原生通知配置的重要性；其中 `stream closed before response.completed` 是 Codex 高置信模式，不是 Claude Code 标准模式。
- **平台差异**：桌面通知是否支持“点击后回到 VS Code”并不统一；当前由 companion 返回 `activationMode` 显式区分完整路径和退化路径，而不是伪装成统一能力。
- **跨 chunk 解析**：OSC 序列可能被分割在多个输出 chunk 中，当前实现通过 `oscCarryover` 缓存处理，但缓存大小限制为 256 字节，超长序列可能被截断。
- **启发式检测**：Agent 等待输入检测基于启发式规则，可能存在误判情况（如误将长时间运行的任务判断为等待输入）。

### 8.3 未来增强方向

- **智能通知**：基于通知内容的智能分类和优先级排序
- **通知聚合**：当同一节点短时间内触发多次通知时，聚合显示
- **自定义规则**：允许用户定义通知过滤规则和触发条件
- **声音提示**：自定义通知声音或声音选择
- **通知中心**：提供统一的通知历史和管理界面

## 9. 依据文档

- `docs/PRODUCT_SENSE.md`：产品定位与核心价值主张
- `ARCHITECTURE.md`：系统架构与模块划分
- `src/common/executionAttentionSignals.ts`：终端注意力信号解析实现
- `src/common/agentActivityHeuristics.ts`：Agent 活动启发式检测实现
- `src/panel/CanvasPanelManager.ts`：通知配置管理与状态同步
- `src/webview/main.tsx`：通知视觉效果实现
- `package.nls.json`：配置项说明文案

## 10. 状态

**已确认** - 当前功能已实现并在使用中，本文档是对现有实现的产品规格补充说明。

## 11. 最后更新

2026-05-21
