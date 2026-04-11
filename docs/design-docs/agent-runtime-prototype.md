---
title: Agent 节点特殊 Terminal backend 设计
decision_status: 已废弃
validation_status: 验证中
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
  - docs/exec-plans/completed/agent-runtime-prototype.md
  - docs/exec-plans/completed/agent-special-terminal.md
  - docs/exec-plans/completed/execution-session-platform-compatibility.md
  - docs/exec-plans/completed/execution-lifecycle-recovery-and-autostart.md
updated_at: 2026-04-08
---

# Agent 节点特殊 Terminal backend 设计

> 状态说明：本文记录的是 2026-03-30 之前的收敛结论，核心前提是“`Agent` 应正式收敛为特殊 `Terminal`”。该前提已被新的产品判断取代。当前有效结论请以 [docs/design-docs/execution-lifecycle-and-recovery.md](./execution-lifecycle-and-recovery.md) 为准；本文保留仅用于追踪历史取舍，不再作为当前实现依据。

## 1. 背景

当前仓库已经完成了 `WebviewPanel` 主画布、React Flow 原型，以及 `Terminal` 节点的嵌入式 PTY 会话窗口；`Agent` 节点也接入过一版最小真实 backend，但那条路线仍把 `Agent` 当成“输入 prompt，然后宿主离散执行一次 CLI，再把 stdout 聚合回节点”的对象。

这条实现已经能跑通最小主路径，但产品定义仍然偏了。用户要的不是“一个会向 CLI 发请求的特殊卡片”，而是“一个默认启动 `Codex` 或 `Claude Code` 的特殊终端窗口”。既然 `Terminal` 已经有 PTY 会话窗口，`Agent` 继续保留单独调用模型只会让系统复杂度继续上升。

因此，本文需要把 Agent backend 收敛到新的方向：`Agent` 也是 PTY 会话窗口，只是默认启动命令不是 shell，而是 provider CLI。

## 2. 问题定义

本轮需要回答的问题不是“长期应该绑定哪家 AI provider”，而是：

1. 画布中的 `Agent` 节点，应该继续维持“离散 CLI 调用”模型，还是应该和 `Terminal` 一样收敛为真实 PTY 会话窗口。
2. 如果收敛为会话窗口，宿主应该怎样启动 `codex` / `claude`，才能尽量复用当前嵌入式终端后端。
3. `Agent` 还需要保留哪些专属元数据，哪些状态应直接与终端会话模型共享。

## 3. 目标

- 把 `Agent` 明确定义为一种预置 CLI 启动命令的嵌入式会话窗口。
- 保持“宿主权威状态 + Webview 投影”的当前运行时主线不变。
- 让 `Agent` 与 `Terminal` 尽量共享 PTY 会话模型、输入输出桥和恢复边界。
- 让用户能在画布里直接和 `Codex` / `Claude Code` CLI TUI 交互，而不是只看聚合后的文本摘要。

## 4. 非目标

- 不在本轮实现多 Agent 自动协作、任务编排或工具调用编排。
- 不在本轮为 `Agent` 单独引入一套不同于 `Terminal` 的 PTY 依赖或后端。
- 不在本轮承诺跨扩展重载恢复完整活动 Agent 会话。
- 不把当前实现包装成“完整 Agent orchestrator”。

## 5. 候选方案

### 5.1 保留当前离散 CLI 调用模型

特点：

- 宿主在收到节点输入后，离散执行 `codex exec ...` 或 `claude --print ...`。
- 节点里显示的是聚合后的 transcript，而不是 provider 原生 CLI 会话。

不选原因：

- 这条路线和当前产品定义不一致；它更像“调用器”，而不是“会话窗口”。
- 它会把 `Agent` 和 `Terminal` 固化成两套运行时模型，继续放大宿主状态与前端交互复杂度。
- 节点内看起来像会话，实际上却不是长期会话，语义更容易误导。

### 5.2 预置 provider CLI 的 PTY 会话窗口

特点：

- `Agent` 节点使用与 `Terminal` 节点同类的 PTY 会话桥。
- 节点启动时默认执行 `codex` 或 `claude`，后续输入直接进入该 CLI TUI。
- 节点保留 provider、最近输出摘要、退出信息等轻量元数据，而不再维护 transcript 状态机。

优点：

- 与当前产品里“Agent 是特殊 Terminal”的产品语义一致。
- 可以最大化复用当前 `xterm.js + node-pty` 宿主后端。
- 让 `Agent` 与 `Terminal` 的恢复边界和事件流更清晰。

风险：

- 需要确认当前 provider CLI 在 PTY 环境下的行为是否足够稳定。
- Agent 会话启动失败、退出或缺命令时，需要给出比普通 shell 更明确的错误说明。

### 5.3 直接接外部 CLI orchestrator 或自建 orchestrator

特点：

- 更接近长期“多 Agent 编排”叙事。
- 可能天然带有任务规划、工具调用和终端协作能力。

不选原因：

- 当前仓库还没有稳定的 PTY 会话恢复语义。
- 直接接入外部 orchestrator 会把问题从“修正对象定义”升级为“搭建整套 agent 平台”。

## 6. 当前结论

当前收敛结论如下：

- `Agent` 节点不再继续走“prompt -> 单次 CLI 调用 -> transcript 聚合”路线。
- `Agent` 节点与 `Terminal` 节点共享同类 PTY 会话模型；差别只在于启动命令、默认 provider 和节点标题语义。
- 默认 provider 仍为 `codex`，同时支持 `claude`，并继续通过设置项覆盖命令路径。
- 新建 `Agent` 节点默认不自动启动；用户可先切换 provider，再显式启动会话。
- 节点的新最小主路径变为：
  - 选择 provider
  - 启动嵌入式会话
  - 在节点内直接与 CLI TUI 交互
  - 支持停止、重启和重新附着

建议的最小节点状态包括：

- `idle`：尚未运行，或上次会话已结束
- `live`：当前 PTY 会话仍活跃
- `error`：启动失败或异常退出
- `closed`：用户主动停止或会话自然结束
- `interrupted`：扩展 reload 后，之前的活动会话未恢复

建议的最小节点元数据包括：

- 当前 provider
- 当前是否存在活动会话
- 最近输出摘要
- 最近一次退出信息
- 最近一次会话的列宽/行高
- provider CLI 的展示标签

## 7. 风险与取舍

- 取舍：第一版不保留独立 transcript 存储。
  原因：如果节点本身就是 CLI 会话窗口，主要历史应由会话 buffer 承担；宿主权威状态只需要保存摘要和退出信息。

- 风险：Extension Host 未必能从 PATH 中找到 `codex` 或 `claude`。
  当前缓解：默认用命令名解析，同时提供插件设置项覆盖命令路径；新建节点默认不自动运行，允许用户先切换到可用 provider；命令缺失时给出明确错误。

- 风险：provider CLI 在 PTY 环境下可能与普通 shell 有额外兼容性问题，Windows 下还可能涉及 `.cmd` / `.exe` 路径差异。
  当前缓解：当前统一复用 `node-pty` backend，并保留设置项覆盖命令路径；Linux 构建与 PTY smoke test 已完成，macOS / Windows 人工验证继续作为后续技术债跟踪。

- 风险：扩展 reload 后，运行中的请求无法继续。
  当前缓解：沿用嵌入式终端的处理方式，把旧活动态显式收敛为 `interrupted`，不制造虚假恢复。

## 8. 验证方法

至少需要完成以下验证：

1. 在 `Agent` 节点中选择 provider 并启动运行，节点进入活动态。
2. 节点启动后，用户可直接在节点内与 CLI TUI 交互，而不是继续依赖独立 prompt 输入区。
3. 会话中能看到连续终端输出，节点摘要随最近输出更新。
4. 用户主动停止时，节点从活动态回到可解释的终止态。
5. 命令不存在、PATH 不一致或 CLI 异常退出时，用户能收到明确失败原因。
6. reload 后，不会把原本已丢失的活动会话继续显示为 `live`。

## 9. 当前验证结果

- 旧版“离散 CLI 调用”原型已经验证过可以闭合最小主路径，但该验证结果不再代表当前结论。
- 当前新的结论是：Agent backend 应收敛为预置 provider CLI 的 PTY 会话窗口。
- 本轮代码实现已经完成，并通过 `npm run typecheck` 与 `npm run build`。
- 当前 Linux 环境已完成 `node-pty` PTY smoke test；`Agent` 节点在 macOS / Windows / 本地 VSCode 中的真实 provider CLI 人工验证仍待补充，因此文档状态改为“验证中”。
