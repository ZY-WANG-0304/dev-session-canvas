# 建立 Agent 最小真实 backend 原型

本 ExecPlan 是活文档。推进过程中必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

把当前 React Flow 画布中的 `Agent` 节点从展示型占位节点升级为“可由用户显式触发一次真实模型请求”的最小原型，验证以下主路径：

- 画布中可以创建和选中 `Agent` 节点
- 用户可以为节点输入一个简短目标并启动一次运行
- 宿主会调用一个真实可用的 VSCode 语言模型，而不是本地假数据
- 运行中的状态、最近输出摘要和错误信息会回流到画布
- 运行结束后，节点会留下最小必要的可恢复结果，而不是回到纯占位状态

本阶段要验证的是“Agent 节点与真实 backend 的最小垂直链路”，不是多轮对话、自治规划或完整多 Agent 编排。

## 进度

- [x] 梳理 `Agent` 节点当前仅为占位节点的现状。
- [x] 对比 VSCode 当前 AI 扩展入口，确定第一版 backend 路线。
- [x] 新建本 ExecPlan，明确范围、风险和验证口径。
- [x] 更新正式设计文档，记录 Agent backend 初步方案与取舍。
- [x] 扩展共享状态模型，为 `Agent` 节点增加最小运行时元数据。
- [x] 在宿主侧实现最小 `Agent` 运行控制与流式结果回流。
- [x] 在 Webview 中为 `Agent` 节点增加输入、启动和停止动作。
- [x] 完成构建与类型检查。
- [ ] 完成手动验证并记录结果。
- [ ] 记录结果与复盘，并提交本轮改动。

## 意外与发现

- 观察：VSCode 官方当前把 AI 扩展入口明确分成 `Language Model Tool`、`MCP Tool`、`Chat Participant` 和 `Language Model API` 四类，而“画布中的 Agent 节点”更接近 chat 之外的自定义 UI 功能。
  证据：官方 AI extensibility overview 明确写到，构建 chat 之外的 UI 体验、并且需要直接控制模型请求时，应优先选择 `Language Model API`。

- 观察：`Language Model API` 已在 VSCode Stable 可用，且支持直接在扩展中选择模型、发送请求和消费流式文本结果。
  证据：VSCode 2024 年 6 月（1.91）发布说明声明 Chat 与 Language Model API 已进入 Stable；当前官方 `Language Model API` 文档明确提供 `selectChatModels`、`sendRequest` 和流式响应示例。

- 观察：官方明确不建议把语言模型调用写成强依赖某个固定模型或固定 provider。
  证据：`Language Model API` 文档要求扩展对“无模型可用”“特定模型不可用”采取防御式处理，并明确提到可用模型集合会变化。

## 决策记录

- 决策：第一版 `Agent` backend 使用 VSCode `Language Model API`，直接由宿主发起模型请求。
  理由：当前 `Agent` 节点运行在画布自定义 UI 内，不属于 chat 面板，也不只是给 chat 提供工具，因此比 `Chat Participant`、`Language Model Tool` 或 `MCP Tool` 更贴合。
  日期/作者：2026-03-28 / Codex

- 决策：第一版只支持“单次目标 -> 单次响应”的最小运行，不做多轮会话、工具调用和自治任务编排。
  理由：当前需要优先验证的是状态流、宿主调用、流式回流和恢复边界，而不是提前把 Agent 行为做重。
  日期/作者：2026-03-28 / Codex

- 决策：运行中的请求允许用户显式停止，但扩展 reload 后不保证自动恢复。
  理由：当前 `Language Model API` 路线没有现成的跨 reload 运行恢复语义；先把“可中断、可解释失败、reload 后不误报仍在运行”闭合，比虚假恢复更重要。
  日期/作者：2026-03-28 / Codex

## 上下文与定向

相关文档：

- 产品规格：`docs/product-specs/canvas-core-collaboration-mvp.md`
- 运行时设计：`docs/design-docs/vscode-canvas-runtime-architecture.md`
- 当前终端原型计划：`docs/exec-plans/active/terminal-proxy-node.md`

关键代码路径：

- 宿主入口：`src/extension.ts`
- 宿主状态与 Webview 协调：`src/panel/CanvasPanelManager.ts`
- 共享消息协议：`src/common/protocol.ts`
- 画布 UI：`src/webview/main.tsx`

本轮不引入新的 provider SDK，也不要求安装本扩展私有 backend。所有真实模型能力都通过 VSCode 已提供的语言模型入口获取，并对“无可用模型”“未授权”“超额”“API 不可用”等情况做显式退化。

## 工作计划

1. 更新设计文档和产品规格，记录第一版 Agent backend 的问题定义、候选路线和当前结论。
2. 扩展共享协议和节点元数据，让 `Agent` 节点能表达“最近目标、最近输出、当前运行态、最近模型”。
3. 在宿主侧实现最小运行控制器：
   - 选择可用模型
   - 发送请求
   - 处理流式文本
   - 停止运行
   - 回写节点状态
4. 在 Webview 中为 `Agent` 节点增加最小输入框和动作按钮。
5. 完成构建、类型检查和手动验证。

## 具体步骤

1. 新增或更新设计文档，明确为什么当前不走 `Chat Participant`、`Language Model Tool` 或 `MCP Tool`。
2. 为 `Agent` 节点增加宿主权威元数据，并保证旧状态可归一化。
3. 为 Webview 增加 `startAgentRun` / `stopAgentRun` 消息。
4. 在宿主侧维护按节点 ID 索引的运行中请求和 `CancellationTokenSource`。
5. 用流式响应持续更新 `Agent` 节点摘要；完成或失败时持久化最终状态。
6. 在 reload 恢复时，把无法继续的运行态显式收敛为“已中断”而不是假装仍在运行。

## 验证与验收

本轮至少满足以下条件才算完成：

- `Agent` 节点不再只是静态占位卡片。
- 用户能从选中节点输入一个目标并启动一次真实模型请求。
- 运行中状态、成功结果和失败信息会回流到画布。
- 用户可以停止一个正在运行的请求。
- reload 后，不会把实际上已经丢失的运行错误地显示为仍在运行。
- `npm run build` 与 `npm run typecheck` 通过。
- 手动验证至少覆盖：
  - 有可用模型时的成功运行
  - 手动停止运行
  - 无模型或未授权时的错误反馈
  - reload 后的运行态收敛

## 幂等性与恢复

- 共享协议和状态归一化必须可重复执行，旧状态缺少 `Agent` 元数据时不能崩溃。
- 手动验证可重复执行；如果模型请求因权限或额度失败，应保留明确错误提示，允许再次触发。
- 如果扩展 reload 或窗口重开导致运行中请求丢失，节点状态必须回收为非运行态，并保留“上次运行未恢复”的提示。

## 结果与复盘

当前已完成：

- 确认第一版 `Agent` backend 的候选路线与当前收敛方向
- 建立本 ExecPlan，并明确范围、验收和恢复边界
- 已把 Agent backend 方案同步到正式设计文档、设计索引和产品规格
- 已在宿主侧接入 VSCode `Language Model API`，并支持最小启动、停止、流式回流与 reload 后中断收敛
- 已在 Webview 中增加 Agent 目标输入、运行和停止入口
- 已完成 `npm run build` 与 `npm run typecheck`

当前仍待完成：

- 手动验证记录
- 本轮提交与复盘
