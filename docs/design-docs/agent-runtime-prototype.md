---
title: Agent 节点最小 backend 原型设计
decision_status: 已选定
validation_status: 已验证
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

当前仓库已经完成了 `WebviewPanel` 主画布、React Flow 原型和终端代理节点原型，但 `Agent` 节点仍只是静态占位卡片。这样虽然可以验证对象布局，却无法验证画布与真实外部 Agent 会话之间的关键边界。

如果继续让 `Agent` 节点保持纯占位，我们会同时失去三项最重要的验证：

- 画布中的执行型对象是否真的能由宿主驱动
- Webview 与宿主之间的运行时状态回流是否足够稳定
- 当前抽象出来的 Agent 适配边界，是否能覆盖至少一种真实 backend

因此，下一步需要给 `Agent` 节点接入一个“足够真实但范围可控”的最小 backend。

需要额外说明的是：本文只解决 backend 路线，不定义 Agent 节点最终的产品表面。关于“Agent 应该是节点内会话窗口，而不是 inspector 驱动卡片”的交互结论，见 `docs/design-docs/agent-session-surface.md`。

## 2. 问题定义

本轮需要回答的问题不是“长期应该绑定哪家 AI provider”，而是：

1. 画布中的 `Agent` 节点，第一版应该通过什么宿主能力接入真实 `Codex` / `Claude Code` 会话。
2. 这条路线是否既能保留画布自定义 UI，又不把系统过早绑定到某个本机绝对路径或某个 shell 环境细节。
3. 在不引入复杂任务编排的前提下，最小验证闭环应包含哪些状态和动作。

## 3. 目标

- 让 `Agent` 节点具备一次真实 CLI Agent 调用能力。
- 保持“宿主权威状态 + Webview 投影”的当前运行时主线不变。
- 让用户能在画布里看到 `Agent` 的运行中、完成、失败和停止状态。
- 为后续 `AgentAdapter` 抽象补上第一条真实垂直验证链路。

## 4. 非目标

- 不在本轮实现多轮对话或长期会话管理。
- 不在本文中定义 Agent 节点的最终交互表面。
- 不在本轮实现工具调用、终端执行、文件修改或自治任务规划。
- 不在本轮绑定私有 provider SDK、外部 CLI orchestrator 或自建远程服务。
- 不把当前原型包装成“完整多 Agent 系统”。

## 5. 候选方案

### 5.1 直接代理外部 CLI Agent

特点：

- 扩展在宿主内启动 `codex` 或 `claude` 子进程。
- 保留对 stdout / stderr、停止和错误处理的直接控制。
- 更符合“画布节点代理一个外部 Agent 会话”的产品语义。

优点：

- 与画布内 `Agent` 节点的交互形态最匹配。
- 与真实目标对象 `Codex` / `Claude Code` 一致，不会在语义上跑偏到内置模型调用。
- 运行在 Extension Host 内，可继续访问 VSCode API 和 workspace。

风险：

- 需要自行管理命令解析、状态回流、停止和错误提示。
- Extension Host 的 PATH 与用户日常 shell 可能不一致。

### 5.2 使用 VSCode Language Model API

不选原因：

- 用户已经明确 `Agent` 节点要代理 `Codex` 或 `Claude Code`，而不是 GitHub Copilot 或其他 VSCode 内置 provider。
- 如果继续走内置 Language Model API，会把产品语义改成“向某个编辑器 provider 发请求”，与目标能力不一致。

### 5.3 使用 Chat Participant / Language Model Tool / MCP Tool

不选原因：

- 当前要验证的是画布里的 `Agent` 节点本身，而不是把它变成 chat 生态中的一个参与者或工具。
- 这些入口都不能直接表达“启动本机 `codex` / `claude` CLI 会话”的产品语义。

### 5.4 直接接外部 CLI Agent 或自建 orchestrator

特点：

- 更接近长期“多 Agent 编排”叙事。
- 可能天然带有任务规划、工具调用和终端协作能力。

不选原因：

- 当前仓库还没有稳定的 `AgentAdapter` 实现和恢复语义。
- 直接接入外部 orchestrator 会把问题从“验证运行时边界”升级为“搭建整套 agent 平台”。

## 6. 当前结论

当前原型阶段选择：

- 使用外部 CLI Agent 作为 `Agent` 节点的第一条真实 backend 路线。
- 默认 provider 为 `codex`，同时支持 `claude`，并通过插件设置项覆盖命令路径。
- 第一版只支持“选择 provider -> 输入目标 -> 启动 CLI 会话 -> 回流输出 -> 支持停止”的最小闭环。

建议的最小节点状态包括：

- `idle`：尚未运行，或上次运行已完成
- `running`：当前正在请求或消费流式输出
- `error`：本次运行失败
- `cancelled`：用户主动停止
- `interrupted`：扩展 reload 后，之前的运行无法恢复

建议的最小节点元数据包括：

- 最近一次输入目标
- 最近一次输出全文或最小可读结果
- 最近一次使用的 backend 标识
- 当前是否存在活动运行
- 最近一次运行 ID

## 7. 风险与取舍

- 取舍：第一版不做多轮上下文保留。
  原因：当前优先验证的是宿主调用与状态回流，不是长期记忆。

- 取舍：第一版不做工具调用。
  原因：工具调用会立刻把 Agent backend 与终端、文件系统、安全策略绑在一起，超出当前验证边界。

- 风险：Extension Host 未必能从 PATH 中找到 `codex` 或 `claude`。
  当前缓解：默认用命令名解析，同时提供插件设置项覆盖命令路径；命令缺失时给出明确错误。

- 风险：CLI Agent 会话具有非确定性，难以做端到端自动化测试。
  当前缓解：把可测部分限制在状态归一化、消息协议和宿主状态机；真实 CLI 会话以手动验证为主。

- 风险：扩展 reload 后，运行中的请求无法继续。
  当前缓解：把旧运行态显式收敛为 `interrupted`，不制造虚假恢复。

## 8. 验证方法

至少需要完成以下验证：

1. 在 `Agent` 节点中选择 provider、输入目标并启动运行，节点进入运行态。
2. 运行中可看到摘要逐步更新或至少看到明确的运行反馈。
3. 请求成功后，节点保留结果摘要与最近 backend 信息。
4. 用户主动停止时，节点从运行态回到可解释的终止态。
5. 命令不存在、PATH 不一致或 CLI 异常退出时，用户能收到明确失败原因。
6. reload 后，不会把原本已丢失的运行继续显示为 `running`。

## 9. 当前验证结果

- 用户已在当前环境下完成手动验证，并确认 Agent 节点主路径可用。
- 当前已验证的结论是：CLI Agent 代理节点这条路线成立，至少在当前 workspace 与本机 CLI 环境下可闭合最小主路径。
- 但这不等于 Agent 的产品表面已经对齐；节点内会话窗口的交互修正需由独立设计与原型继续推进。

## 10. 参考资料

以下资料于 2026-03-28 检索：

- Claude Code CLI help
- Codex CLI help
