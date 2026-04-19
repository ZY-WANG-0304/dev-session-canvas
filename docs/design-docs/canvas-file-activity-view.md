---
title: 画布文件活动视图设计
decision_status: 已选定
validation_status: 验证中
domains:
  - 画布交互域
  - 协作对象域
  - VSCode 集成域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/canvas-graph-links-and-file-activity.md
related_plans:
  - docs/exec-plans/active/canvas-graph-links-and-file-activity.md
updated_at: 2026-04-19
---

# 画布文件活动视图设计

## 1. 背景

当前 Dev Session Canvas 虽然已经能在同一张画布上承载多个执行对象，但 `Agent` 正在读写哪些文件仍主要依赖终端输出、编辑器切换或用户记忆间接推断：

- `Agent` 文件活动没有进入共享状态模型，画布无法显式投影当前代码上下文。
- 多个 Agent 并行改代码时，用户缺少“哪些文件正在被谁使用”的统一视图。
- `tmp.md` 已明确要求文件活动不能依赖 PTY 输出流解析，而应在 provider 层抽象结构化文件操作事件接口。

## 2. 问题定义

本设计文档聚焦四个问题：

1. 自动文件对象应如何建模，才能同时支持“单文件节点模式”和“文件列表节点模式”。
2. Agent 文件活动应如何从 provider 侧进入宿主，而不是通过终端文本猜测。
3. 文件对象点击打开、图标展示、过滤和生命周期应如何与 VSCode 宿主能力保持一致。
4. 自动生成的文件对象与自动关系线应如何围绕同一份权威文件状态重建。

## 3. 目标

- 引入以 provider 结构化事件为唯一来源的文件活动模型。
- 在默认文件节点模式和可切换的文件列表模式之间，复用同一份文件活动源数据。
- 让文件对象继续遵守 VSCode 宿主边界：打开文件走宿主、图标尽量复用当前 file icon theme、无法确认的 provider 能力不伪装成已支持。

## 4. 非目标

- 不通过 PTY 输出、正则或自然语言摘要推导文件活动。
- 不为 `Codex` 发明未经确认的结构化文件事件接口。
- 不让自动文件对象反向成为长期事实来源；长期真相仍是文件活动引用状态。
- 不在本轮引入更复杂的白板自动布局、手工文件节点创建或文件关系语义系统。

## 5. 候选方案

### 5.1 从 PTY 输出里解析文件路径

特点：

- 复用现有终端输出桥，不需要新增 provider 接口。
- 理论上对所有 provider 都“看起来可用”。

不选原因：

- 这会把“用户可见文本”误当成“文件活动真相”，与 `tmp.md` 的明确约束冲突。
- 输出里出现路径，不等于 Agent 真正读写了文件；反过来，Agent 读写文件也未必会把路径打印出来。
- 一旦 provider UI、语言或输出格式变化，功能会立刻失真。

### 5.2 以 provider 原生结构化事件作为唯一来源

特点：

- 文件活动由 provider adapter 明确上报，宿主只消费结构化事件。
- 自动文件对象和自动关系线都可以围绕同一份权威文件引用状态构建。

选择原因：

- 与仓库“先定义谁拥有长期状态”和“不要把未确认内容写成已确认结论”的原则一致。
- 便于按 provider 差异分层实现，避免把 Webview 或 PTY 桥变成事实来源。
- 能让文件活动数据直接进入宿主持久化模型，并支撑两种展示模式重建。

## 6. 风险与取舍

- 取舍：当前自动文件活动第一轮只正式覆盖 `Claude Code` 和仓库内 `fake-agent-provider`。
  原因：`Claude Code` 官方已提供 hooks 机制，可在 `Read` / `Edit` / `Write` 工具层输出结构化事件；`Codex` 当前仓库内尚无已确认的等价接口。

- 风险：自动文件对象在展示模式切换时需要重建节点集合。
  当前缓解：文件活动本身单独持久化为引用状态，文件节点 / 文件列表节点视图由宿主根据当前配置重建；第一轮只保证当前启用模式的布局连续性，不把隐藏模式的布局保持当作硬性承诺。

- 风险：当前 VSCode Webview 没有直接暴露“给任意文件路径渲染当前 file icon theme 图标”的单一 API。
  当前缓解：宿主读取当前启用的 file icon theme contribution 与主题 JSON，尽量把图标资源转成 webview-safe URI 或字体描述；若解析失败，明确回退到通用文件图标，而不是显示空白。

- 风险：共享文件列表节点需要在“按 Agent 聚合”和“按共享文件聚合”之间取舍。
  当前缓解：第一轮采用“Agent 专属列表节点 + 单独共享列表节点”的双层收口，避免同一文件在多个 Agent 列表里重复出现。

## 7. 正式方案

### 7.1 `fileReferences` 是文件活动的权威状态

`src/common/protocol.ts` 在当前画布权威状态中新增 `CanvasFileReferenceSummary`，把“某个文件被哪些 Agent 以什么方向访问过”独立持久化。其核心信息包括：

- 规范化文件路径
- 最近一次活动时间
- 引用该文件的 Agent 集合
- 每个 Agent 对该文件的访问方向：读 / 写 / 读写

这里的关键不变量是：

- provider 结构化事件更新的是 `fileReferences`。
- `file` 节点、`file-list` 节点和自动边都只是 `fileReferences` 的投影视图。
- reset、持久化恢复和 runtime reload 都围绕 `fileReferences` 重建文件视图，而不是信任旧自动节点。

### 7.2 `CanvasPanelManager` 负责把文件活动投影成两种视图

`src/panel/CanvasPanelManager.ts` 继续作为宿主权威状态入口，并新增一层“文件视图重建”：

- 默认配置 `files.presentationMode = nodes` 时，宿主把每个文件引用投影成一个 `file` 节点，并自动生成 `Agent -> 文件` 关系线。
- 配置切到 `lists` 时，宿主不再保留 `file` 节点，而是为每个 Agent 生成一个 `file-list` 节点；若有共享文件，则额外生成一个共享 `file-list` 节点。
- 这些自动节点与自动连线在每次文件引用更新、Agent 删除、文件过滤配置变化或展示模式变化后统一重建。

自动边复用关系连线设计里的通用 edge 模型，但不开放人工编辑。

### 7.3 Provider 文件活动事件接口在宿主侧抽象

新增宿主适配层模块，用于把 provider 原生事件转换为统一的文件活动事件：

- `src/panel/agentFileActivity.ts`：定义统一事件类型、session watcher 生命周期和宿主接收入口。
- `Claude` adapter：通过官方 `claude --settings <file>` 路线注入临时 hooks 配置，只监听 `Read`、`Edit`、`Write` 工具事件，并把结构化结果写入扩展存储目录下的 session 事件流。
- `fake-agent-provider` adapter：通过环境变量指定事件流文件，供 smoke 测试稳定产出同形态事件。
- `Codex` adapter：当前返回 no-op watcher。没有结构化事件，就不向宿主上报文件活动。

这样可以保证：

- 宿主只消费 `AgentFileActivityEvent`。
- Webview 不知道 provider hooks、日志文件或临时配置的存在。
- “哪个 provider 已支持自动文件活动”成为宿主 adapter 的显式事实，而不是 UI 猜测。

### 7.4 Claude hooks 只作为 session 临时注入，不污染用户项目

为了不修改用户仓库，也不把临时设置写进 `.claude/`，`CanvasPanelManager` 在构造 Claude 启动命令时：

- 为当前 session 生成临时 settings JSON。
- 通过 `--settings <path>` 把 hooks 配置只附着到这次 Claude 启动。
- 通过环境变量把事件流文件路径传给 hook 处理脚本。

这保证了 hooks 是“当前 Agent session 的实现细节”，而不是长期写进用户项目的隐式副作用。

### 7.5 Webview 只负责文件对象呈现

`src/webview/main.tsx` 新增两类前端文件呈现：

- `file` 节点渲染紧凑文件卡片，支持图标、路径模式与点击打开。
- `file-list` 节点渲染文件条目列表，支持读写方向图标和点击打开。

Webview 仍然不直接访问 VSCode 文件系统或编辑器 API；所有“打开文件”动作都通过消息交回宿主。

### 7.6 文件图标尽量复用当前 VSCode File Icon Theme

宿主侧新增 file icon theme 解析层：

- 从 `workbench.iconTheme` 读取当前主题 ID。
- 在 `vscode.extensions.all` 中查找贡献该 icon theme 的扩展及其主题 JSON。
- 将能直接映射到文件名 / 扩展名的图标资源转为 webview-safe 描述，再放入节点 metadata。
- 如果解析不到图标，Webview 回退到通用文件图标。

这条路径的目标是“尽量遵守当前 file icon theme”，而不是在 Webview 里重新发明一套独立图标规则。

### 7.7 生命周期规则

宿主必须保持以下规则：

- 删除 Agent 节点时，移除该 Agent 在文件活动引用中的所有 ownership。
- 若某文件不再有任何 Agent ownership，则删除对应文件引用，并在当前展示模式下移除相关自动节点 / 自动连线。
- 若某文件仍被其他 Agent 引用，则只删除失效的那部分 ownership，保留该文件对象。
- 切换 include/exclude 或展示模式后，宿主按当前配置重建文件视图。

## 8. 验证方法

- Playwright Webview 回归：
  - 文件节点 / 文件列表节点在不同展示模式下能正确渲染与发送打开文件消息。
- VSCode smoke：
  - `Claude` 或 `fake-agent-provider` 文件活动事件进入宿主后，状态与自动节点 / 自动边按预期变化。
  - 点击文件节点或文件列表条目后，VSCode 会在编辑区打开目标文件。
  - 删除 Agent 节点后，文件生命周期规则正确生效。
  - 切换 include/exclude 或展示模式后，宿主会按当前配置重建文件视图。
