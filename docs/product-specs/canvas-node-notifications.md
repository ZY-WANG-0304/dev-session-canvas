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
3. 某个节点的执行单元输出终端注意力信号（BEL、OSC 9、OSC 777）
4. 系统捕获并解析这些信号，识别出需要用户注意的事件
5. 系统在画布节点上显示视觉提示（节点边框闪烁、Minimap 高亮）
6. 如果启用了强提醒模式，系统还会在 VSCode 标题栏或 Minimap 上显示额外提示
7. 用户通过视觉提示快速定位到需要注意的节点
8. 用户点击节点查看详情或进行交互，通知状态自动清除

### 3.2 配置调整流程

1. 用户打开 VSCode 设置（`devSessionCanvas.notifications.*`）
2. 用户根据个人偏好调整通知行为：
   - 启用/禁用终端注意力信号桥接
   - 选择强提醒模式（无、标题栏、Minimap、两者都有）
3. 配置立即生效，无需重启 VSCode

## 4. 在范围内

### 4.1 终端注意力信号桥接

- 解析并识别 `Agent` / `Terminal` 输出中的终端注意力信号：
  - BEL (``): 传统终端响铃信号
  - OSC 9 (`]9;...`): iTerm2 风格通知协议
  - OSC 777 (`]777;notify;...`): 通用通知协议
- 支持信号过滤规则：
  - OSC 9 中以 `4;` 开头的消息被标记为 `ignore`，不触发通知
  - 其他信号默认触发通知
- 配置项 `devSessionCanvas.notifications.bridgeTerminalAttentionSignals`：
  - 类型：`boolean`
  - 默认值：`true`
  - 作用域：`window`
  - 功能：控制是否启用终端注意力信号桥接

### 4.2 节点视觉通知

- 画布节点层面的视觉提示：
  - 节点边框闪烁动画 (`is-attention-flashing`)
  - 节点标记为待注意状态 (`has-attention`)
- Minimap 层面的视觉提示：
  - Minimap 节点高亮显示
  - 支持根据强提醒模式配置显示不同强度的提示

### 4.3 强提醒模式

- 配置项 `devSessionCanvas.notifications.strongTerminalAttentionReminder`：
  - 类型：`enum`
  - 可选值：`none` | `titleBar` | `minimap` | `both`
  - 默认值：`both`
  - 作用域：`window`
- 各模式行为：
  - `none`：仅在节点本身显示基础视觉提示
  - `titleBar`：在 VSCode 标题栏显示闪烁提示
  - `minimap`：在 Minimap 上显示尺寸脉冲动画 (`has-strong-attention-reminder`)
  - `both`：同时启用标题栏和 Minimap 增强提示

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
  - 当检测到注意力信号时，自动设置节点为待注意状态
  - 当用户与节点交互时，自动清除通知状态
  - 支持手动清除通知状态
- 状态持久化：
  - 通知状态不持久化到存储，仅在当前会话有效
  - 重新加载画布后通知状态重置

## 5. 不在范围内

### 5.1 当前阶段不做

- 不支持自定义通知声音或系统级通知
- 不支持通知历史记录或通知中心
- 不支持基于通知内容的智能分类或优先级
- 不支持跨 workspace 的通知聚合
- 不支持通知的延迟或批量处理
- 不支持用户自定义通知规则或过滤器
- 不支持通知的持久化存储或恢复

### 5.2 明确排除

- 不替代 VSCode 原生的通知系统 (`vscode.window.showInformationMessage` 等)
- 不处理非终端输出的通知 (如文件系统变化、Git 事件等)
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

- 控制额外视觉提示的显示位置
- 默认值为 `both`，同时启用标题栏和 Minimap 提示

### 6.4 节点通知状态

- 节点级别的状态标记：
  - `has-attention`：节点有待处理的通知
  - `is-attention-flashing`：节点边框闪烁动画
  - `has-strong-attention-reminder`：启用强提醒模式
- Minimap 节点属性：
  - `data-minimap-attention-pending`：Minimap 节点待注意标记
  - `data-minimap-attention-flashing`：Minimap 节点闪烁标记
  - `data-minimap-attention-size-pulsing`：Minimap 节点尺寸脉冲标记

## 7. 验收标准

### 7.1 功能验收

- [ ] 系统能正确解析 BEL、OSC 9、OSC 777 三种终端注意力信号
- [ ] OSC 9 中以 `4;` 开头的消息被正确标记为 `ignore`
- [ ] 当检测到注意力信号时，节点边框显示闪烁动画
- [ ] Minimap 上的节点能正确显示高亮状态
- [ ] 配置 `bridgeTerminalAttentionSignals` 为 `false` 时，不触发任何通知
- [ ] 强提醒模式的四种配置 (`none`、`titleBar`、`minimap`、`both`) 都能正确工作
- [ ] Agent 等待输入检测能正确识别提示符、通知信号和超时情况
- [ ] 用户与节点交互后，通知状态自动清除
- [ ] 配置变更后立即生效，无需重启 VSCode

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

## 8. 开放问题

### 8.1 待确认

- **通知优先级**：当多个节点同时触发通知时，是否需要优先级机制？当前实现是平等对待所有通知。
- **通知持久化**：是否需要在画布重新加载后恢复通知状态？当前实现是不持久化，重新加载后通知状态重置。
- **自定义信号**：是否需要支持用户自定义的终端注意力信号格式？当前仅支持标准的 BEL、OSC 9、OSC 777。
- **通知历史**：是否需要提供通知历史记录功能，让用户回溯之前的通知？当前实现是无历史记录。

### 8.2 已知限制

- **Codex 集成**：Codex Agent 需要在配置中设置 `notification_method` 和 `notification_condition` 才能正确触发通知，这一要求需要在文档中明确说明。
- **跨 chunk 解析**：OSC 序列可能被分割在多个输出 chunk 中，当前实现通过 `oscCarryover` 缓存处理，但缓存大小限制为 256 字节，超长序列可能被截断。
- **启发式检测**：Agent 等待输入检测基于启发式规则，可能存在误判情况（如误将长时间运行的任务判断为等待输入）。

### 8.3 未来增强方向

- **智能通知**：基于通知内容的智能分类和优先级排序
- **通知聚合**：当同一节点短时间内触发多次通知时，聚合显示
- **自定义规则**：允许用户定义通知过滤规则和触发条件
- **声音提示**：可选的通知声音或系统级通知
- **通知中心**：提供统一的通知历史和管理界面

## 9. 依据文档

- `docs/PRODUCT_SENSE.md`：产品定位与核心价值主张
- `ARCHITECTURE.md`：系统架构与模块划分
- `src/common/executionAttentionSignals.ts`：终端注意力信号解析实现
- `src/common/agentActivityHeuristics.ts`：Agent 活动启发式检测实现
- `src/panel/CanvasPanelManager.ts`：通知配置管理与状态同步
- `src/webview/main.tsx`：通知视觉效果实现

## 10. 状态

**已确认** - 当前功能已实现并在使用中，本文档是对现有实现的产品规格补充说明。

## 11. 最后更新

2026-04-28
