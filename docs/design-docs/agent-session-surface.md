---
title: Agent 节点会话窗口设计
decision_status: 已选定
validation_status: 已验证
domains:
  - 画布交互域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/agent-session-surface-alignment.md
  - docs/exec-plans/completed/agent-special-terminal.md
updated_at: 2026-03-30
---

# Agent 节点会话窗口设计

## 1. 背景

当前仓库已经把 `Agent` 的主交互从右侧 inspector 挪回节点内部，但当前节点表面仍然保留了一套“provider 选择器 + prompt textarea + transcript 冒泡”的独立调用 UI。

这比 inspector 方案更接近会话窗口，但仍然过重也不够准确。对 OpenCove 来说，`Agent` 更像一个会默认启动 `Codex` 或 `Claude Code` 的特殊 terminal，而不是一个自己维护 request/response transcript 的调用卡片。

## 2. 问题定义

本轮需要回答的问题不是“Agent backend 走 CLI 还是 SDK”，而是：

1. 画布里的 `Agent` 节点，在产品语义上到底代表什么对象。
2. 节点内部的主交互到底应该是“独立 composer + transcript”，还是“provider CLI 自己的会话终端”。
3. 第一版最小可用的会话窗口，至少要保留哪些可见元素，才能不再误导后续实现。

## 3. 目标

- 把 `Agent` 明确定义为画布上的持续会话窗口，而不是单次请求卡片。
- 让节点本体承载主要输入、输出和运行状态。
- 让 `Agent` 与 `Terminal` 收敛到同一类 runtime window 家族，而不是继续长成一个独立调用系统。

## 4. 非目标

- 不在本轮完整复刻 provider 原生 TUI 的所有视觉细节或快捷键。
- 不在本轮承诺真正可恢复的长期 CLI 会话。
- 不在本轮设计多 Agent 自动协作、复杂工具调用或任务编排。

## 5. 候选方案

### 5.1 继续使用右侧 inspector 驱动 Agent

特点：

- 节点本体只展示摘要。
- 用户需要先选中节点，再到外部面板里输入消息和启动运行。

不选原因：

- 这会把主要交互从画布节点中抽走，破坏“空间化会话窗口”的核心体验。
- 多 Agent 并列时，用户无法直接从节点上理解哪个窗口正在运行、最近交流了什么。

### 5.2 采用节点内 transcript/composer 会话窗口

特点：

- 节点本体包含标题区、状态、转录区和输入区。
- 用户直接在节点内部发送下一条消息、停止运行并查看最近输出。

不选原因：

- 这比 inspector 更接近正确方向，但仍然把 `Agent` 做成了专属调用系统。
- 用户真正熟悉的对象是 `Claude` / `Codex` CLI 自己的会话终端，而不是一套我们自己定义的 transcript UI。
- 继续保留 composer/transcript，会让 `Agent` 和 `Terminal` 的运行时模型继续分叉。

### 5.3 采用节点内嵌入式 CLI 会话窗口

特点：

- 节点本体仍是 runtime window，但主体变成嵌入式终端前端。
- 用户显式启动节点时，按当前 provider 启动 `codex` 或 `claude` CLI。
- 主要输入、输出和状态反馈都来自 CLI 会话本身。

优点：

- 与 OpenCove 中“Agent 是特殊 Terminal”的产品语义一致。
- 让 `Agent` 与 `Terminal` 更容易共享同一套宿主后端和恢复边界。
- 避免把当前实现包装成一套独立的聊天型交互系统。

风险：

- 节点渲染复杂度和 React Flow 重渲染压力都会增加。
- provider CLI 的 TUI 细节并不完全受我们控制。

### 5.4 直接嵌入 provider 原生 CLI/TUI

特点：

- 最接近参考产品视觉与行为。
- 节点内部几乎就是原生终端/Agent UI。

当前不选原因：

- 这会立刻把问题升级为终端仿真、PTY 桥接、远程兼容、快捷键路由和恢复语义。
- 当前先要修正的是产品定义偏差，不是一次性补齐所有底层能力。

## 6. 当前结论

当前收敛结论如下：

- `Agent` 节点的正确产品定义是“画布上的会话窗口”。
- 主交互必须放在节点内部，右侧检查器最多只承担概况展示，不再是主要操作面。
- `Agent` 与 `Terminal` 应属于同一类 runtime window；区别主要在默认启动命令和对象语义，不在运行时模型。
- 新建 `Agent` 节点默认停留在未运行态，允许用户先切换 provider，再显式启动 CLI 会话。
- 第一版最小会话窗口至少包含：
  - 当前 provider 标识
  - 运行状态
  - 嵌入式终端前端
  - 启动、停止和重启动作
  - 最近输出摘要或退出信息

同时必须显式记录一个重要边界：

- 当前 backend 原型应直接收敛为 provider CLI 的 PTY 会话。
- 节点不再以独立 transcript 作为核心产品表面；会话历史主要来自终端 buffer，宿主持久化只保留摘要与退出信息。

## 7. 风险与取舍

- 取舍：先做“预置 provider CLI 的嵌入式会话窗口”，不做“我们自己定义的 transcript/composer UI”。
  原因：前者更贴近产品语义，也能直接减少系统复杂度。

- 风险：如果转录和输入都进节点，节点会比普通卡片大很多。
  当前缓解：把执行型对象单独做成 runtime window 风格，并让任务/笔记继续保持轻量。

- 风险：如果 provider CLI 在 PTY 里出现兼容问题，节点会退化成“能开窗但不好用”的半成品。
  当前缓解：已完成构建、本地 smoke test 和人工验证；继续把非 Linux 平台与长期兼容性留在后续技术债中处理。

## 8. 验证方法

至少需要完成以下验证：

1. 用户可以直接在 Agent 节点内部看到并使用嵌入式 CLI 会话窗口。
2. 节点内部能看到连续终端输出和最终状态，而不是只看到聚合 transcript。
3. 右侧概况区不再承载 Agent 的主要操作。
4. 在已有多个 Agent 节点时，用户能直接从节点本体区分它们的 provider、运行态和最近输出。

## 9. 当前验证状态

- 旧版“节点内 transcript/composer”路线已经证明主交互应该留在节点内部，但它不再是当前要继续保留的最终结论。
- 当前新的结论是：Agent 节点应进一步收敛为预置 provider CLI 的嵌入式会话窗口。
- 本轮代码实现已经移除 transcript/composer 主交互，并通过 `npm run typecheck` 与 `npm run build`。
- 用户已在 VSCode `Extension Development Host` 中完成人工验证，确认节点顶部仅保留必要 chrome，主体已收敛为真实 CLI 会话窗口。
