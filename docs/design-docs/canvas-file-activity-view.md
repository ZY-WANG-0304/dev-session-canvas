---
title: 画布文件活动视图设计
decision_status: 已选定
validation_status: 已验证
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
updated_at: 2026-04-21
---

# 画布文件活动视图设计

## 1. 背景

当前 Dev Session Canvas 虽然已经能在同一张画布上承载多个执行对象，但 `Agent` 正在读写哪些文件仍主要依赖终端输出、编辑器切换或用户记忆间接推断：

- `Agent` 文件活动没有进入共享状态模型，画布无法显式投影当前代码上下文。
- 多个 Agent 并行改代码时，用户缺少“哪些文件正在被谁使用”的统一视图。
- 当前正式需求已明确：文件活动不能依赖 PTY 输出流解析，而应在 provider 层抽象结构化文件操作事件接口。

## 2. 问题定义

本设计文档聚焦四个问题：

1. 自动文件对象应如何建模，才能同时支持“单文件节点模式”和“文件列表节点模式”。
2. Agent 文件活动应如何从 provider 侧进入宿主，而不是通过终端文本猜测。
3. 文件对象点击打开、图标展示、过滤和生命周期应如何与 VSCode 宿主能力保持一致。
4. 自动生成的文件对象与自动关系线应如何围绕同一份权威文件状态重建。
5. 文件节点与文件列表节点应如何在保留现有卡片风格的同时，引入更接近 VSCode 原生视图的极简风格。

## 3. 目标

- 引入以 provider 结构化事件为唯一来源的文件活动模型。
- 在默认文件节点模式和可切换的文件列表模式之间，复用同一份文件活动源数据。
- 让文件对象继续遵守 VSCode 宿主边界：打开文件走宿主、编辑区承载面下在独立 editor group 打开、图标能力按实际实现写清楚、无法确认的 provider 能力不伪装成已支持。
- 为文件节点 / 文件列表节点补一层统一的显示风格配置，让用户可在保留当前卡片风格的同时切换到更紧凑的极简风格。
- 为文件节点 / 文件列表节点补一个整体启停开关，并把它收口为 reload 后生效的宿主启动配置：关闭时整个文件活动功能域不可用，不再保留文件活动状态。

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

- 这会把“用户可见文本”误当成“文件活动真相”，与“文件活动必须来自 provider 结构化事件而非 PTY 文本推断”的正式约束冲突。
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

- 风险：当前 VSCode Webview 没有直接暴露“给任意文件路径渲染当前 file icon theme 图标”的单一 API，而本轮实现也还没有补完整的 theme 解析层。
  当前缓解：当前版本只提供有限的“常见扩展名 -> `codicon`”映射，并在其余情况回退到通用文件图标；文档显式保持这一现状，不把完整复用当前 file icon theme 写成已实现。

- 风险：共享文件列表节点需要在“按 Agent 聚合”和“按共享文件聚合”之间取舍。
  当前缓解：第一轮采用“Agent 专属列表节点 + 单独共享列表节点”的双层收口，避免同一文件在多个 Agent 列表里重复出现。

- 风险：如果把文件列表 `list/tree` 切换直接写进宿主权威状态，会让本来只影响节点内部显示的 UI 偏好反向污染 workspace 绑定状态模型。
  当前缓解：本轮把 `list/tree` 切换保留在 Webview 本地 UI 状态，并按节点 ID 持久化到 webview state；宿主持续只关心 `fileReferences`、自动节点重建和位置 / 边关系。

- 风险：如果 `devSessionCanvas.files.enabled` 仍按运行时即时开关实现，provider 文件事件接线、sidebar 文件过滤和持久化状态会继续留下“功能已关闭但文件域真相还在”的分叉语义。
  当前缓解：把该配置抬到宿主启动配置层，语义对齐 `runtimePersistence`：配置变化只在 reload 后生效；关闭时清空 `fileReferences`、自动文件对象、自动文件边、`include` / `exclude` 过滤状态与相关 suppression 状态，并停用文件过滤入口。

## 7. 正式方案

### 7.1 `fileReferences` 是“文件功能开启时”的权威状态

`src/common/protocol.ts` 在当前画布权威状态中新增 `CanvasFileReferenceSummary`，把“某个文件被哪些 Agent 以什么方向访问过”独立持久化。它只在 `devSessionCanvas.files.enabled = true` 的窗口会话中成立；当文件功能关闭并完成 reload 后，这部分状态会被宿主主动清空，而不是继续以隐藏真相的形式留在持久化层。其核心信息包括：

- 规范化文件路径
- 相对所属 workspace folder 根目录的路径；若当前是多根 workspace，则额外带上 workspace folder 名称前缀；若文件不在任何 workspace 内，则该字段留空并回退到规范化绝对路径
- 最近一次活动时间
- 引用该文件的 Agent 集合
- 每个 Agent 对该文件的访问方向：读 / 写 / 读写

这里的关键不变量是：

- 当 `devSessionCanvas.files.enabled = true` 时，provider 结构化事件更新的是 `fileReferences`。
- 当 `devSessionCanvas.files.enabled = true` 时，`file` 节点、`file-list` 节点和自动边都只是 `fileReferences` 的投影视图。
- 当 `devSessionCanvas.files.enabled = false` 且已 reload 时，宿主不再保留 `fileReferences`、自动文件对象与自动文件边。

### 7.2 `CanvasPanelManager` 负责把文件活动投影成两种视图

`src/panel/CanvasPanelManager.ts` 继续作为宿主权威状态入口，并新增一层“文件视图重建”：

- 默认配置 `files.presentationMode = nodes` 时，宿主把每个文件引用投影成一个 `file` 节点，并自动生成 `Agent -> 文件` 关系线。
- 配置切到 `lists` 时，宿主不再保留 `file` 节点，而是为每个 Agent 生成一个 `file-list` 节点；若有共享文件，则额外生成一个共享 `file-list` 节点。
- `include` / `exclude` 过滤从 settings 页面迁到 sidebar 的 `常用操作` section；过滤状态单独持久化为视图状态，不写回 `fileReferences`。
- 由于 VSCode 扩展 API 不支持在 TreeView 中局部嵌入输入框，当前实现把 `包含文件` / `排除文件` 收口为该 section 中的最小 `WebviewView` 输入框，并保持其余状态摘要继续留在原生 TreeView。
- 这些自动节点与自动连线在每次文件引用更新、Agent 删除、sidebar 过滤变化或展示模式变化后统一重建。
- 新增全局配置 `devSessionCanvas.files.enabled`，控制文件活动投影是否启用：
  - `true`：该开关在当前窗口生效后，宿主会启动 provider 文件活动接线，记录 `fileReferences`，并按当前展示模式与过滤条件投影文件节点 / 文件列表节点和自动文件活动边。
  - `false`：该开关需要 reload 后才生效；生效后宿主不再启动文件活动接线，也不会继续加载或保留 `fileReferences`、`file` / `file-list` 自动对象、自动文件边、`include` / `exclude` 过滤状态和对应 suppression 状态。sidebar 中的文件过滤入口也进入不可用态。
- 新增全局配置 `devSessionCanvas.fileNode.displayStyle`，由宿主读入并通过 `CanvasRuntimeContext` 传给 Webview。该配置虽然挂在 `fileNode` 名下，但实际同时控制 `file` 和 `file-list` 两类文件对象的视觉风格：
  - `card`：保留当前卡片式节点与列表节点观感。
  - `minimal`：文件节点收口为贴内容边框；文件列表节点收口为接近 VSCode Source Control Changes 的单行文件视图。

自动边复用关系连线设计里的通用 edge 模型，但不开放人工编辑。

### 7.3 Provider 文件活动事件接口在宿主侧抽象

新增宿主适配层模块，用于把 provider 原生事件转换为统一的文件活动事件：

- `src/panel/agentFileActivity.ts`：定义统一事件类型、session watcher 生命周期和宿主接收入口。
- `Claude` adapter：通过官方 `claude --settings <file>` 路线注入临时 hooks 配置，只监听 `Read`、`Edit`、`Write` 工具事件，并把结构化结果写入扩展存储目录下的 session 事件流。
- `fake-agent-provider` adapter：通过环境变量指定事件流文件，供 smoke 测试稳定产出同形态事件。
- `Codex` adapter：当前返回 no-op watcher。没有结构化事件，就不向宿主上报文件活动。
- 当 `devSessionCanvas.files.enabled = false` 且已 reload 时，`CanvasPanelManager` 不再为 Agent 会话创建真实文件活动 watcher；所有 provider 路径统一退化为 no-op。

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

### 7.5 Webview 只负责文件对象呈现与局部视图切换

`src/webview/main.tsx` 新增两类前端文件呈现：

- `file` 节点渲染紧凑文件卡片，支持图标、路径模式与点击打开。
- `file-list` 节点渲染文件条目列表，支持读写方向图标和点击打开。

在本轮极简化收口后，Webview 还需要补两条规则：

- `card` 风格继续渲染现有卡片式文件节点和文件列表节点，不改变既有交互入口。
- `minimal` 风格下：
  - `file` 节点默认只渲染紧贴内容的细边框容器，不再渲染卡片阴影、宽内边距和额外装饰；尺寸按当前图标 / 路径显示组合自适应。文本模式下只保留首行主标签，不再追加第二行路径补充。
  - `file` 节点即使允许手动 resize，也仍保留“贴内容”的最小尺寸保护；下限不是旧的固定安全阈值，而是按当前图标 / 路径显示组合估算出刚好能完整显示节点内容的最小宽高。
  - `file` 节点的可点击表面不再额外叠加 hover 蒙层；节点层级已有统一选中态与锚点显隐反馈，文件节点继续复用这套通用交互。
  - `file-list` 节点头部提供 `列表视图 / 树形视图` 切换，默认使用 `list`。`list` 视图把每个文件渲染成一行；`tree` 视图按目录结构分组后再渲染文件行。两种视图都使用相同的点击打开消息。
  - `file-list` 条目改为直接复用 VSCode list token 语义：hover 使用 `list.hoverBackground` / `list.hoverForeground`，点击后的选中项使用 `list.activeSelectionBackground` / `list.activeSelectionForeground`，当焦点移到其他节点或离开当前 Webview 时，保留选中项但切换到 `list.inactiveSelectionBackground` / `list.inactiveSelectionForeground`。
  - `list/tree` 切换只属于节点内部局部 UI 状态；它按节点 ID 持久化在 Webview state 中，不回写宿主。
  - 文件列表条目的选中态属于节点内部局部 UI 状态；它按节点 ID 持久化在 Webview state 中，不回写宿主，也不会反向污染 `fileReferences`。

同时，`card` 风格的 `file` 节点在缺少次级路径文案时也不再退化显示 `N 个 Agent 引用`；第二行只在存在真实路径补充信息时才渲染。

Webview 仍然不直接访问 VSCode 文件系统或编辑器 API；所有“打开文件”动作都通过消息交回宿主。

宿主侧打开文件时遵守以下规则：

- 当画布承载在 panel route 时，直接在现有编辑区打开目标文件；当前目标只是“不主动把文本光标切进新打开的文件”，不再额外把 Webview 根元素强制聚焦或制造宿主焦点框。
- 当画布承载在编辑区时，目标文件必须在相邻 editor group 中打开；若当前没有 split editor，则先隐式创建相邻 group，再打开目标文件。
- 打开完成后，只有编辑区承载面的画布需要宿主显式交还交互焦点；panel route 继续依赖 `showTextDocument(... preserveFocus: true)` 的宿主语义，不再追加 Webview 根元素 `.focus()`。

### 7.6 文件图标当前只提供有限 codicon 映射

当前实现没有完成 file icon theme 解析层。宿主只做两件事：

- 对少量常见扩展名映射固定 `codicon`。
- 其余文件统一回退到通用文件图标。

完整复用当前 VSCode File Icon Theme 保留为后续技术债，不在本轮实现口径内。

### 7.7 生命周期规则

宿主必须保持以下规则：

- 删除 Agent 节点时，移除该 Agent 在文件活动引用中的所有 ownership。
- 若某文件不再有任何 Agent ownership，则删除对应文件引用，并在当前展示模式下移除相关自动节点 / 自动连线。
- 若某文件仍被其他 Agent 引用，则只删除失效的那部分 ownership，保留该文件对象。
- 切换 `devSessionCanvas.files.enabled` 后，当前窗口要等 reload 才应用新的文件功能状态；当开关在下次加载时为 `false`，宿主会清空 `fileReferences`、自动文件对象、自动文件边、`include` / `exclude` 过滤状态与相关 suppression 状态，并停用文件过滤入口。
- 编辑 sidebar `包含文件` / `排除文件` 输入框或切换展示模式后，宿主按当前配置重建文件视图，但 `fileReferences` 保持不变。
- 切换 `devSessionCanvas.fileNode.displayStyle` 后，宿主会重建文件节点 / 文件列表节点的视觉投影，但继续复用原有自动节点 ID、位置和文件活动关系线；风格切换不是另一套文件对象生命周期。

## 8. 验证方法

- Playwright Webview 回归：
  - 文件节点 / 文件列表节点在不同展示模式、不同显示风格下都能正确渲染与发送打开文件消息。
  - `minimal` 风格下，文件列表节点可以在 `列表视图 / 树形视图` 之间切换，且读写标识保持清晰可见。
  - 文件节点不会在 hover 时额外叠加文件专属遮罩；文件列表条目遵循 VSCode list hover / active selection / inactive selection token。
- VSCode smoke：
  - `Claude` 或 `fake-agent-provider` 文件活动事件进入宿主后，状态与自动节点 / 自动边按预期变化。
  - 点击文件节点或文件列表条目后，VSCode 会在编辑区打开目标文件；若画布位于编辑区，目标文件进入独立 editor group。
  - 删除 Agent 节点后，文件生命周期规则正确生效。
  - 调整 sidebar `包含文件` / `排除文件` 输入框或展示模式后，宿主会按当前配置重建文件视图，且不会改写 `fileReferences`。
  - 修改 `devSessionCanvas.files.enabled` 后，当前窗口必须在 reload 后才切换文件功能状态；禁用后的下一次加载会清空 `fileReferences`、文件节点 / 文件列表节点、自动文件边、对应过滤入口与 `include` / `exclude` 状态，重新开启后也不会恢复已清空的旧文件活动与过滤状态。
  - 切换 `devSessionCanvas.fileNode.displayStyle` 后，自动文件节点 / 文件列表节点的 ID、位置和自动边关系保持稳定。

截至 2026-04-21，本方案本轮增量已通过 `npm run typecheck`、`npm run test:workspace-relative-paths` 与 `npm run test:webview`。其中新增脚本测试覆盖“单根保持纯相对路径、多根补 workspace folder 前缀”的宿主规则，Playwright 也补了多根同名路径在文件列表树形视图下保持分根展示的回归断言。与此同时，`tests/vscode-smoke/extension-tests.cjs` 现已把 `devSessionCanvas.files.enabled` 收口为 startup-applied 语义：改配置后当前窗口保持不变，只有在 `simulateRuntimeReload()` 后才清空文件活动与过滤状态并切换文件功能可用性；重新开启后也不会恢复已清空的旧 `fileReferences` 与 `include` / `exclude` 状态。最近一次 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 复跑里，这条文件功能链路断言已通过，但整套 trusted smoke 仍卡在既有 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory()` 的 `waitForRuntimeSupervisorState()` 超时。
