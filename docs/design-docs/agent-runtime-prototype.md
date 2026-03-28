---
title: Agent 节点最小 backend 原型设计
decision_status: 已选定
validation_status: 未验证
domains:
  - VSCode 集成域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/active/agent-runtime-prototype.md
updated_at: 2026-03-28
---

# Agent 节点最小 backend 原型设计

## 1. 背景

当前仓库已经完成了 `WebviewPanel` 主画布、React Flow 原型和终端代理节点原型，但 `Agent` 节点仍只是静态占位卡片。这样虽然可以验证对象布局，却无法验证画布与真实 AI 执行能力之间的关键边界。

如果继续让 `Agent` 节点保持纯占位，我们会同时失去三项最重要的验证：

- 画布中的执行型对象是否真的能由宿主驱动
- Webview 与宿主之间的运行时状态回流是否足够稳定
- 当前抽象出来的 Agent 适配边界，是否能覆盖至少一种真实 backend

因此，下一步需要给 `Agent` 节点接入一个“足够真实但范围可控”的最小 backend。

## 2. 问题定义

本轮需要回答的问题不是“长期应该绑定哪家 AI provider”，而是：

1. 画布中的 `Agent` 节点，第一版应该通过什么宿主能力接入真实模型请求。
2. 这条路线是否既能保留画布自定义 UI，又不把系统过早绑定到 chat 面板、工具生态或外部独立服务。
3. 在不引入复杂任务编排的前提下，最小验证闭环应包含哪些状态和动作。

## 3. 目标

- 让 `Agent` 节点具备一次真实模型调用能力。
- 保持“宿主权威状态 + Webview 投影”的当前运行时主线不变。
- 让用户能在画布里看到 `Agent` 的运行中、完成、失败和停止状态。
- 为后续 `AgentAdapter` 抽象补上第一条真实垂直验证链路。

## 4. 非目标

- 不在本轮实现多轮对话或长期会话管理。
- 不在本轮实现工具调用、终端执行、文件修改或自治任务规划。
- 不在本轮绑定私有 provider SDK、外部 CLI orchestrator 或自建远程服务。
- 不把当前原型包装成“完整多 Agent 系统”。

## 5. 候选方案

### 5.1 直接使用 Language Model API

特点：

- 扩展可直接在宿主内选择可用模型并发起请求。
- 适合 chat 之外的自定义 UI 功能。
- 保留对请求、流式输出、停止和错误处理的直接控制。

优点：

- 与画布内 `Agent` 节点的交互形态最匹配。
- 不需要先把体验套进 chat 参与者或工具调用框架。
- 运行在 Extension Host 内，可继续访问 VSCode API。

风险：

- 需要自行管理模型选择、状态回流、取消和错误提示。
- 具体模型集合会变化，必须采用防御式处理。

### 5.2 使用 Chat Participant

特点：

- 适合扩展 chat ask 模式中的专职助手。
- 可以完整控制 chat 中的交互流程。

不选原因：

- 当前主界面是画布，不是 chat 面板。
- 若先把 `Agent` 节点代理成 chat participant，会把产品主路径反向绑到 chat UI。

### 5.3 使用 Language Model Tool 或 MCP Tool

特点：

- 更适合作为其他 agent/chat 的可调用工具。
- `Language Model Tool` 运行在扩展内，`MCP Tool` 运行在 VSCode 外部。

不选原因：

- 当前要验证的是画布里的 `Agent` 节点本身，而不是给别的 agent 提供工具能力。
- `MCP Tool` 没有 VSCode API 访问能力，还会额外引入分发和部署负担。

### 5.4 直接接外部 CLI Agent 或自建 orchestrator

特点：

- 更接近长期“多 Agent 编排”叙事。
- 可能天然带有任务规划、工具调用和终端协作能力。

不选原因：

- 当前仓库还没有稳定的 `AgentAdapter` 实现和恢复语义。
- 直接接入外部 orchestrator 会把问题从“验证运行时边界”升级为“搭建整套 agent 平台”。

## 6. 当前结论

当前原型阶段选择：

- 使用 VSCode `Language Model API` 作为 `Agent` 节点的第一条真实 backend 路线。
- 保持 `Agent` 节点运行在画布自定义 UI 中，不依赖 chat participant。
- 第一版只支持“输入目标 -> 发起一次请求 -> 流式接收文本 -> 更新节点摘要/状态 -> 支持停止”的最小闭环。

建议的最小节点状态包括：

- `idle`：尚未运行，或上次运行已完成
- `running`：当前正在请求或消费流式输出
- `error`：本次运行失败
- `cancelled`：用户主动停止
- `interrupted`：扩展 reload 后，之前的运行无法恢复

建议的最小节点元数据包括：

- 最近一次输入目标
- 最近一次输出全文或最小可读结果
- 最近一次使用的模型标识
- 当前是否存在活动运行
- 最近一次运行 ID

## 7. 风险与取舍

- 取舍：第一版不做多轮上下文保留。
  原因：当前优先验证的是宿主调用与状态回流，不是长期记忆。

- 取舍：第一版不做工具调用。
  原因：工具调用会立刻把 Agent backend 与终端、文件系统、安全策略绑在一起，超出当前验证边界。

- 风险：用户本机可能没有可用模型，或未授予权限。
  当前缓解：必须把“无模型可用”“未授权”“额度受限”等情况显式回流给节点和 toast，而不是静默失败。

- 风险：模型请求具有非确定性，难以做端到端自动化测试。
  当前缓解：把可测部分限制在状态归一化、消息协议和宿主状态机；真实模型请求以手动验证为主。

- 风险：扩展 reload 后，运行中的请求无法继续。
  当前缓解：把旧运行态显式收敛为 `interrupted`，不制造虚假恢复。

## 8. 验证方法

至少需要完成以下验证：

1. 选中 `Agent` 节点后输入目标并启动运行，节点进入运行态。
2. 运行中可看到摘要逐步更新或至少看到明确的运行反馈。
3. 请求成功后，节点保留结果摘要与最近模型信息。
4. 用户主动停止时，节点从运行态回到可解释的终止态。
5. 无模型、未授权或额度受限时，用户能收到明确失败原因。
6. reload 后，不会把原本已丢失的运行继续显示为 `running`。

## 9. 参考资料

以下资料于 2026-03-28 检索：

- AI extensibility in VS Code
  https://code.visualstudio.com/api/extension-guides/ai/ai-extensibility-overview
- Language Model API
  https://code.visualstudio.com/api/extension-guides/ai/language-model
- VSCode 2024 年 6 月（1.91）更新说明
  https://code.visualstudio.com/updates/v1_91
