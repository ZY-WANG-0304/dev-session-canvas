---
title: 画布外层控件侧栏化设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/canvas-sidebar-controls.md
related_plans:
  - docs/exec-plans/completed/canvas-sidebar-controls-design.md
  - docs/exec-plans/active/canvas-graph-links-and-file-activity.md
updated_at: 2026-05-11
---

# 画布外层控件侧栏化设计

## 1. 背景

当前仓库已经完成一轮“画布反馈收口”。那一轮的主要成果是：

- 去掉遮挡左下角缩放控件的底部浮层
- 去掉右侧固定区域中的选中节点概况
- 把画布恢复目标收口为空画布
- 保留左上角 hero 与右上角操作区作为较克制的过渡态

这个过渡态解决了“遮挡”和“重复详情”问题，但还没有回答 `功能体验.md` 第 2 条提出的新目标：画布区域只保留左下角和右下角的必要控件，左上角和右上角的内容不再留在画布里，而是以极简风格进入 VSCode 左侧 SideBar。

随着文件活动视图把 `include` / `exclude` 过滤也迁入 sidebar，问题又出现了第二层：如果为了追求“像搜索视图”而在 sidebar 里整块自绘 `WebviewView`，整体观感会重新偏离 VSCode 原生 Sidebar。用户最新一轮反馈一方面要求参考 VSCode 官方 Sidebars / Views / Tree View / Webviews 文档，把 sidebar 收口回常见的原生 section 风格；另一方面又明确要求 `include` / `exclude` 必须直接以内嵌输入框形式出现在 sidebar 中，而不是再走弹出输入框。

因此，本轮要解决的问题不再是“右侧固定区要不要显示详情”，而是“哪些东西仍然属于画布，哪些东西已经应该交给宿主侧栏承载”。

## 2. 问题定义

本轮需要明确以下问题：

1. 画布中的常驻角落 UI 到底应该只剩什么。
2. 当前顶角 panel 承载的动作、说明和轻量状态，哪些必须迁出画布。
3. 这些内容迁出后，最适合承载它们的 VSCode 表面是什么。
4. 如何做到“侧栏极简”，而不是把现有 panel 机械平移到另一块区域里继续长成 dashboard。

## 3. 目标

- 让画布重新成为以节点和空间关系为主的工作面，而不是固定 panel 与节点并存的混合面。
- 让非空间性的全局动作和最小必要状态进入 VSCode 宿主侧栏。
- 保留用户在任何时刻都能到达创建、打开画布和恢复状态这些主路径动作。
- 让最终呈现更像 VSCode 原生侧栏，而不是另一个嵌套在侧栏里的自定义应用。

## 4. 非目标

- 不在本轮重新设计节点本体的字段或会话窗口布局。
- 不在本轮把选中节点详情、连续输出或正文内容重新搬到侧栏。
- 不在本轮把画布改造成侧栏中的窄视图。
- 不在本轮设计 dashboard 式信息墙、多列编排或一整块自绘 mini app。
- 不在本轮继续复制 VSCode Search 视图的私有输入框外观，强行在 sidebar 里模拟同款 textbox。

## 5. 候选方案

### 5.1 继续把顶角 panel 留在画布里，只做视觉压缩

特点：

- 不新增宿主侧栏承载面。
- 左上角 hero 和右上角操作区继续存在，只是进一步缩小、半透明或折叠。

优点：

- 不需要新增 VSCode 侧栏集成。
- 代码改动最少，当前实现最容易延续。

不选原因：

- 这仍然是在画布里保留与空间关系无关的固定 chrome。
- 即便视觉更轻，它依旧持续占用顶部工作面，和“只保留左下角/右下角必要控件”的目标不一致。
- 用户要的是画布变干净，而不是把 panel 变得更小。

### 5.2 使用多个原生侧栏 View section 承载全局动作、状态与过滤

特点：

- 在 VSCode Activity Bar / Primary Sidebar 中提供一个 Dev Session Canvas 侧栏容器。
- 侧栏内部使用少量原生 view section，而不是单一大 view 或自绘 dashboard。
- 优先使用原生 View 能力，例如 `TreeView`、view title toolbar、item context action 和命令入口；只有在原生 View 无法表达所需交互时，才局部引入最小 `WebviewView`。
- 画布内移除顶角 panel，只留下左下角导航控件和右下角全局定位控件。

优点：

- 最接近“以极简风格作成 VSCode 左侧 SideBar”的目标。
- 更符合 VSCode 的宿主语境。用户会把它理解成工作台中的一个原生侧栏，而不是另一个嵌套应用。
- 可以把创建对象、打开画布、重置画板和清空画板收口成宿主级入口，减少画布固定 chrome。
- `概览` / `常用操作` 两个 section 更接近 Source Control、Run and Debug、Extensions 等常见 sidebar 结构。
- 当前查核的 VSCode 官方 UX 指南更支持“Activity Bar 对应真实 views”，也更强调谨慎使用 `WebviewView`。

风险：

- 原生 View 的布局表达力弱于自定义 Webview，信息密度必须进一步克制。
- 如果保留过多直接动作，view title toolbar 会显得拥挤。
- VSCode 扩展 API 没有给侧栏 `TreeView` 暴露搜索视图那种原生 inline textbox；如果产品要求必须使用内嵌输入框，就只能把这部分交互独立收口到最小 `WebviewView`。
- 需要宿主提供一个面向侧栏的最小状态摘要，而不是让侧栏直接依赖画布 Webview 内部状态。

### 5.3 使用侧栏 `WebviewView` 承载迁出的内容

特点：

- 仍在 VSCode 侧栏中提供入口，但内容由自定义 `WebviewView` 渲染。
- 可以更自由地排布按钮、状态块和说明文案。

优点：

- 布局自由度高，能快速做出和当前顶角 panel 相似的内容组织方式。
- 若未来确实需要更复杂的状态摘要，可复用现有 Web 技术栈。

不优先原因：

- 这很容易把“顶角 panel”换个位置重新实现一遍，只是从画布搬到侧栏。
- 与“极简、像 VSCode 侧栏”的目标相冲突，信息一多就会继续长成 mini dashboard。
- 当前查核到的 VSCode UX 指南对 `WebviewView` 的态度更克制，不适合在问题尚可用原生 View 解决时直接升级。

### 5.4 不增加侧栏，只把动作分散到命令面板和状态栏

特点：

- 画布清空顶角 UI。
- 创建、重置和打开画布通过命令面板、状态栏或其他零散入口提供。

优点：

- 画布最干净。
- 不需要侧栏视图设计。

不选原因：

- 这会让主路径动作分散，用户缺少一个稳定的全局入口。
- 与需求里明确提到的“作成 VSCode 左侧的 SideBar”不一致。

## 6. 风险与取舍

- 取舍：当前从“两个原生 TreeView section”进一步收口为“概览 TreeView + 常用操作 WebviewView”的混合侧栏，而不是继续坚持所有内容都必须在 TreeView 里表达。
  原因：用户最新要求明确指出 `include` / `exclude` 需要直接以内嵌输入框出现；而 VSCode 扩展 API 又不支持在 TreeView 里局部嵌入文本框。因此最小妥协方案是只把必须用输入框表达的常用操作区做成克制的 `WebviewView`，其余状态摘要继续保留原生 TreeView。

- 风险：如果创建入口收口为一个主动作加对象类型选择，会比四个直接按钮多一步。
  当前缓解：这是有意换来的简洁度；只要创建入口足够稳定可达，这个额外一步是可接受的。

- 风险：VSCode 允许用户把侧栏移动到右侧或 Secondary Sidebar。
  当前缓解：文档只定义“默认入口在主侧栏”，同时要求命令入口始终保留，避免把体验绑定到绝对左侧坐标。

- 风险：一旦把 `WebviewView` 用成新的 mini dashboard，侧栏又会重新偏离 VSCode 原生质感。
  当前缓解：本主题只允许 `常用操作` 用最小 `WebviewView` 承载打开、创建、重置画板、清空画板和 `include` / `exclude`；状态摘要仍然保持在原生 TreeView。模板、节点列表和会话历史虽然也使用 WebviewView，但由各自设计文档限制为紧凑列表和专属操作，不反向扩大本主题的常用操作区范围。

## 7. 正式方案

当前已选定以下路线，并已完成第一版实现：

### 7.1 画布只保留空间相关的常驻元素

- 画布内常驻角落 UI 收口为两类：
  - 左下角导航控件
  - 右下角全局定位控件
- 左上角和右上角不再承载说明、统计、创建和恢复入口。
- 画布上的长段辅助说明、更新时间和验证范围文案都不再常驻。

### 7.2 默认用 `概览` 与 `常用操作` 承担本主题宿主入口

- 默认在 VSCode 主侧栏提供一个 Dev Session Canvas 容器。
- 该容器可以同时包含 `模板`、`节点`、`会话历史` 等其他 section；本文只定义外层控件迁出画布后的两个基础 section：
  - `概览`：继续使用原生 `TreeView` 展示画布状态摘要，并在标题行尾部提供一个设置快捷入口，直接跳转到本扩展设置；其中状态摘要已补入“通知模式”“文件功能”“文件视图”等行，让用户在不离开 sidebar 的前提下看清当前窗口的提醒表面、文件活动总开关，以及文件对象的投影类型与显示模式。`工作区信任` 固定放在概览第一行；`终端`、`Codex 命令`、`Claude Code 命令` 三个环境配置行保留在同一个概览 section 的尾部，不单独拆 section，且终端在三项中排第一。环境配置行只在行内展示当前值，路径过长时使用中间 `...` 保留首尾；完整配置值和解析信息进入 tooltip。
  - `常用操作`：使用最小 `WebviewView` 承载四个高频操作按钮，并在文件功能开启时额外承载 `include` / `exclude` 输入框。
- 这样既保留了大部分 sidebar 的原生结构，也把必须以内嵌输入框表达的交互隔离在最小范围内。

### 7.3 全局动作进入常用操作区，而不是树项大按钮或分散 toolbar

- `常用操作` section 统一承载：
  - 打开画布 / 定位画布
  - 创建节点
  - 重置画板：清空当前画布后套用当前默认模板
  - 清空画板
- 为了兼顾主路径可读性与高频回点效率，`常用操作` 的 view title 行尾部可补一排原生风格的 icon-only 快捷入口；它们只复用内容区里的部分高频动作，不引入新的语义或额外状态。重置画板留在内容区文字按钮中，避免和清空画板共用 `discard` 图标时造成含义混淆；重置画板与清空画板同属会清空当前画布的破坏性动作，内容区使用一致的 danger 按钮视觉，并通过文案区分最终是否套用默认模板；清空入口继续复用既有宿主重置命令，只调整对用户暴露的动作文案。
- `概览` 树项本身优先展示状态，不再承担动作入口职责；唯一例外是环境配置行，它们是“当前值 + 修复入口”的原生 TreeView 行，点击后分别触发 `选择 Terminal shell`、`选择 Codex CLI`、`选择 Claude Code CLI` 的 QuickPick，不在概览中额外放卡片。Codex / Claude Code 命令行右侧允许放最小 inline tail action，用于直接在编辑器打开 provider 自己的配置文件；这些按钮只作为排障捷径，不改变行点击的“选择命令”语义。
- 当 `Codex` / `Claude Code` 命令行点击后没有在当前执行宿主解析到对应 CLI，QuickPick 需要把“安装”作为同一修复入口中的首个动作，而不是只展示一个不可用的默认命令值。安装动作进入二级 QuickPick，固定分成 `命令行安装` 与 `安装 VS Code 插件`：前者在画布中创建并启动 Terminal 节点，然后由宿主向该 Terminal 写入 provider 官方 npm 安装命令；后者打开对应 VS Code 扩展页，只负责把用户带到安装页面，不代替用户点击 Install。
- 这样可以避免把 TreeView 伪装成按钮墙，也避免把同一组操作拆散在 view title toolbar 与别处。

### 7.4 `include` / `exclude` 以条件化最小 Webview 输入框展示

- 当 `devSessionCanvas.files.enabled = true` 的当前窗口会话中，`常用操作` section 内直接显示两个输入框：
  - `包含文件`
  - `排除文件`
- 输入框使用 VSCode 主题 token、输入框边框和最小按钮样式，尽量贴近宿主原生控件观感，不额外包裹卡片式 chrome。
- 输入框在 blur / Enter 时提交，右侧提供轻量清空入口。
- 过滤仍然只影响文件对象与自动边的显示投影，不会修改 `fileReferences`。
- 当 `devSessionCanvas.files.enabled = false` 且已 reload 后，这组输入框不再显示为可用状态；用户会在同一区域看到“文件功能当前已关闭”的说明，而不是继续保留无效入口。
- 这是本轮唯一保留 `WebviewView` 的理由：扩展 API 没有提供可在 TreeView 中局部嵌入文本框的官方能力。

### 7.5 创建入口优先集中，而不是平铺四个常驻大按钮

- 第一版已把“创建对象”收口为一个稳定入口，再通过原生 QuickPick 选择 `Agent`、`Terminal`、`Note`。
- 这样可以避免侧栏一打开就被四个常驻动作按钮占满，也更符合“极简侧栏”的目标。
- 是否需要保留个别高频对象的快捷入口，留待后续人工验证与使用反馈再决定。

### 7.6 与现有正式文档的关系

- `docs/design-docs/canvas-feedback-polish.md` 中关于“顶角 panel 作为过渡态存在”的结论，已被本主题文档接管。
- 旧文档仍保留“空画布”“底角控件不受遮挡”“新增节点默认避碰”这三项结论，但不再作为画布外层 chrome 的当前有效来源。

### 7.7 当前实现边界

- Extension Host 当前提供一个原生侧栏容器；本主题对应其中的 `概览 TreeView` 与 `常用操作 WebviewView` 两个 section，同一容器内的 `模板`、`节点`、`会话历史` section 分别由 `docs/design-docs/canvas-template-feature.md` 与 `docs/design-docs/canvas-sidebar-node-and-session-lists.md` 约束。
- Webview 顶部的左上角 hero 与右上角 actions panel 已移除，画布中只保留底角控件和节点本体。
- 当画布已在前台可见时，侧栏中的“创建节点”会通过 Host -> Webview 消息复用当前视口锚点；当画布尚未就绪时，宿主退回到默认锚点 + 避碰搜索。
- `常用操作` 区域当前是一个最小 `WebviewView`：内容区始终承载四个高频按钮；文件功能开启时追加两个输入框，文件功能关闭时改为说明文案。对应的快捷 icon 按钮放在该 view 的标题行尾部，不承担状态摘要、选中详情或说明卡片。
- `概览` 视图标题行尾部额外提供一个 gear 按钮，作为进入扩展设置的稳定捷径，不把设置入口挤进状态树项本身；视图正文则额外暴露 `通知模式`、`文件功能` 与 `文件视图` 状态，避免用户把“提醒行为变化”或“过滤入口消失”误解成渲染故障。环境配置行由 `src/sidebar/CanvasSidebarView.ts` 读取 `CanvasSidebarState` 中的 terminal / Agent CLI 配置快照，并通过 TreeItem `command` 接到 `src/extension.ts` 中的选择命令；Codex / Claude Code 行通过 `contextValue` 贡献 inline tail action，分别打开 Codex `auth.json`、Codex `config.toml` 和 Claude Code `settings.json`。Codex 路径先按 Agent 实际执行环境解析 `CODEX_HOME`，再回退到当前执行宿主 home 下的 `.codex`；Claude Code 继续使用当前执行宿主 home 下的 `.claude/settings.json`。文件缺失时先弹出 modal 确认提示，再用本地文件 API 创建带最小默认内容的文件并在编辑器中打开；POSIX 上配置目录和文件会 best-effort 收紧到 `0700` / `0600`，并用不覆盖已有文件的 `wx` 语义避免 race 覆盖。Agent CLI 候选发现逻辑收口在 `src/panel/agentCliSelection.ts`，只负责帮助用户选择当前执行宿主上的命令或路径；当候选列表没有任何可解析路径时，同一模块提供安装元数据，`src/extension.ts` 在选择 QuickPick 顶部展示安装入口。命令行安装不改变 Agent 节点的 PTY 启动模型，而是通过 `src/panel/CanvasPanelManager.ts` 创建普通 Terminal 节点，并在该终端 live session 启动后写入一次性安装命令。
- 缺失文件的最小默认内容只提供代理 / gateway 配置占位，不生成真实凭证。Codex `config.toml` 面向“通过代理 / OpenAI-compatible gateway 访问 Codex”的主场景，写入 `model_provider = "openai_compatible"` 与 `[model_providers.openai_compatible]`，并直接暴露 `base_url = ""`，让用户打开文件后填写自己的代理 / gateway endpoint。`env_key = "OPENAI_API_KEY"` 只作为注释保留，因为启用它会让 Codex 强制读取进程环境变量而不是同目录 `auth.json`；默认模板让 `auth.json` 承担 API key 占位。`model`、`approval_policy`、`sandbox_mode` 保持注释，因为它们会改变模型选择或执行权限；官方 OpenAI 登录路径仅作为注释提示 `model_provider = "openai"` 与 `openai_base_url = "https://api.openai.com/v1"`。Codex 通知默认写入 `[tui] notifications = true`、`notification_method = "osc9"`、`notification_condition = "always"`，让嵌入式终端稳定输出 OSC 9 并被画板的注意力桥接捕获。Codex `auth.json` 保持合法 JSON，写入 `auth_mode: "apikey"` 与 `OPENAI_API_KEY: ""` 作为待用户替换的无密钥占位；Claude Code `settings.json` 保持合法 JSON，写入 `$schema`、`preferredNotifChannel: "iterm2"`、`hasCompletedOnboarding: true`、空 `permissions.allow` / `permissions.deny`，并在 `env` 中直接暴露 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_BASE_URL` 这两个代理 / gateway 配置主路径 key，`ANTHROPIC_API_KEY` 默认为 `null`，`ANTHROPIC_BASE_URL` 默认为空字符串，避免空 base URL 被 Claude Code 解析成无效 `null/v1/messages` 地址；Claude Code 依赖内置 iTerm2 通知通道输出终端通知序列，不再在用户 settings 中写入额外 hooks。`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_CUSTOM_HEADERS`、`ANTHROPIC_MODEL` 等高级配置不放进默认模板，避免把可选 gateway / header / model override 误导成必填项。

## 8. 验证方法

至少需要完成以下验证，才能把当前实现从“验证中”推进到“已验证”：

1. 在 VSCode `Extension Development Host` 中手动验证 `概览 TreeView + 常用操作 WebviewView` 的结构、密度和交互是否仍然贴近常见 VSCode Sidebar，而没有长成新的 mini dashboard。
2. 手动验证画布在移除顶角 panel 后，左上角和右上角确实回归为空白工作面，而不是被替代性浮层继续占据。
3. 在窄编辑器宽度下对比新旧方案，确认画布顶部可用空间明显增加。
4. 在 workspace 未受信任场景下，确认侧栏能正确禁用或降级执行型入口。
5. 验证 `包含文件` / `排除文件` 输入框在文件功能开启时的输入、失焦、Enter、清空和 reload 后都保持稳定，且整体观感与 VSCode 输入控件 token 对齐；当文件功能关闭并 reload 后，确认这组入口不再显示为可用状态。
6. 验证当用户折叠、移动或离开侧栏时，命令入口仍能完成打开画布、创建对象、重置画板和清空画板。
7. 验证 `概览` 中 `工作区信任` 始终位于第一行，环境配置行保留在概览尾部并按 `终端`、`Codex 命令`、`Claude Code 命令` 展示；长路径在行内使用中间 `...`，点击三行分别进入对应选择 QuickPick，Codex / Claude Code 行尾按钮能打开对应 provider 配置文件。
8. 验证当当前执行宿主没有解析到 `codex` 或 `claude` 时，点击对应概览行会出现安装入口；选择命令行安装会在画布中新建 Terminal 并执行安装命令，选择 VS Code 插件安装会打开对应扩展详情页且不自动点击 Install。

## 9. 当前验证状态

- 2026-04-20 已按最新 UX 反馈进一步收口为“概览原生 TreeView + 常用操作最小 WebviewView”的混合侧栏。
- 2026-05-11 补齐 Codex / Claude Code CLI 缺失时的安装分流设计；本轮自动化验证覆盖安装元数据与 TypeScript 编译，真实 VS Code 插件页打开和端到端安装仍需人工验证。
- 自动化检查已完成：`npm run typecheck` 与 `npm run build` 通过。
- 当前尚未在 `Extension Development Host` 中完成这一轮人工验证，因此继续保持“验证中”。
