---
version: 2026-05-10
name: DevSessionCanvas UI
description: DevSessionCanvas 的当前 UI 基线是“VSCode 原生语境下、主题跟随的极简工具型协作画布”。界面应优先帮助用户看清一个 workspace 中的 Agent、Terminal、Note、文件活动和关系连线，而不是制造独立 app 式品牌氛围。视觉系统以 VSCode theme token 为第一来源，节点表现为低噪音 runtime window / work document，非空间性的全局动作默认迁入 VSCode sidebar 或命令入口。本文记录 UI token、组件语言、Do / Don't、响应式与迭代约束；具体功能取舍仍以 docs/design-docs/ 中的专项设计文档为准。
colors:
  canvas: "var(--vscode-editor-background)"
  canvas-subtle: "color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-sideBar-background) 6%)"
  surface: "var(--vscode-editorWidget-background, var(--vscode-editor-background))"
  surface-muted: "color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background) 8%)"
  surface-chrome: "color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%)"
  text: "var(--vscode-editor-foreground)"
  text-muted: "var(--vscode-descriptionForeground)"
  icon: "var(--vscode-icon-foreground, var(--vscode-editor-foreground))"
  border: "var(--vscode-widget-border, var(--vscode-panel-border))"
  border-subtle: "color-mix(in srgb, var(--vscode-panel-border) 90%, transparent)"
  focus: "var(--vscode-focusBorder)"
  button-primary: "var(--vscode-button-background)"
  button-primary-text: "var(--vscode-button-foreground)"
  button-secondary: "var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-sideBar-background) 14%))"
  semantic-running: "#22c55e"
  semantic-ready: "#3b82f6"
  semantic-success: "#10b981"
  semantic-warning: "#f59e0b"
  semantic-error: "var(--vscode-errorForeground, #ef4444)"
  accent-agent: "color-mix(in srgb, #22c55e 24%, var(--vscode-widget-border, var(--vscode-panel-border)) 76%)"
  accent-terminal: "color-mix(in srgb, #38bdf8 24%, var(--vscode-widget-border, var(--vscode-panel-border)) 76%)"
  accent-note: "color-mix(in srgb, #a78bfa 24%, var(--vscode-widget-border, var(--vscode-panel-border)) 76%)"
  accent-file: "color-mix(in srgb, #f59e0b 28%, var(--vscode-widget-border, var(--vscode-panel-border)) 72%)"
  accent-file-list: "color-mix(in srgb, #f97316 28%, var(--vscode-widget-border, var(--vscode-panel-border)) 72%)"
typography:
  ui:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  window-title:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.3
  subtitle:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.35
  body-sm:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.2
  terminal:
    fontFamily: "VSCode terminal font / xterm.js runtime font"
    fontSize: "follow VSCode terminal settings"
    fontWeight: 400
    lineHeight: "follow xterm.js fit"
rounded:
  node: 10px
  node-inner: 8px
  widget: 8px
  widget-sm: 6px
  toolbar: 5px
  handle: 999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 6px
  base: 8px
  md: 10px
  lg: 12px
  xl: 14px
  panel: 16px
  section: 24px
components:
  canvas-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
  workbench-widget:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.widget}"
    shadow: "0 4px 14px rgba(0, 0, 0, 0.16)"
  canvas-node:
    backgroundColor: "color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-sideBar-background) 4%)"
    borderColor: "{colors.border}"
    rounded: "{rounded.node}"
    shadow: "0 8px 20px rgba(0, 0, 0, 0.12)"
  window-chrome:
    backgroundColor: "{colors.surface-chrome}"
    borderColor: "{colors.border-subtle}"
    typography: "{typography.window-title}"
    padding: "10px 12px"
  action-button:
    backgroundColor: "transparent / VSCode button tokens by tone"
    textColor: "{colors.text}"
    rounded: "{rounded.widget-sm}"
    minHeight: 24px
  status-pill:
    backgroundColor: "semantic color mixed at 10%-12% with transparent"
    borderColor: "semantic color mixed at 28%-34% with panel border"
    typography: "{typography.caption}"
    rounded: "{rounded.widget-sm}"
  terminal-frame:
    backgroundColor: "VSCode terminal.background with panel/editor fallback"
    typography: "{typography.terminal}"
  note-surface:
    backgroundColor: "{colors.surface-muted}"
    typography: "{typography.body-sm}"
  canvas-edge:
    stroke: "var(--canvas-edge-stroke-default)"
    selectedOutline: "color-mix(in srgb, var(--vscode-focusBorder) 46%, transparent)"
  sidebar-overview:
    hostSurface: "VSCode TreeView"
    density: "native sidebar section"
  sidebar-templates:
    hostSurface: "minimal WebviewView"
    density: "template list and template actions"
  sidebar-actions:
    hostSurface: "minimal WebviewView only for actions and inline include/exclude inputs"
    density: "compact action stack"
  sidebar-nodes:
    hostSurface: "minimal WebviewView"
    density: "current canvas node list and focus entry"
  sidebar-sessions:
    hostSurface: "minimal WebviewView"
    density: "workspace agent session history with filter"
---

# UI

## Overview

DevSessionCanvas 是运行在 VSCode 内的多 Agent 协作 AI workbench。UI 的核心任务不是展示一个独立产品前台，而是在 VSCode 当前 workspace 中，把多个 `Agent`、`Terminal`、`Note`、文件活动节点和关系连线放回同一张可导航的空间化画布。

当前 UI 基线可以概括为：**VSCode 原生语境下、主题跟随的极简工具型协作画布**。

关键特征：

- 主题跟随优先：浅色、深色和高对比主题都应通过 VSCode token 自然成立，不把固定深色画布写成产品身份。
- 画布让位于对象：固定 chrome 尽量少，画布主要承载节点、关系、导航和当前空间上下文。
- 节点像工作窗口：`Agent` / `Terminal` 是执行窗口，`Note` 是轻量工作文档，文件节点是活动投影，不是营销卡片。
- 状态色克制使用：颜色优先表达运行、提醒、错误、选中和关系，不用于制造大面积装饰。
- 宿主能力不伪装：非空间性的全局动作、状态摘要和设置入口优先进入 VSCode sidebar、命令面板或原生工作台入口。
- 文档边界清晰：本文记录 UI design-system 基线；涉及具体交互取舍时，仍应更新 `docs/design-docs/` 中的专项设计文档。

## Colors

### Theme Contract

所有用户可见层默认从 VSCode theme token 取色。只有在 VSCode 没有对应语义 token、且需要表达节点类型或关系色时，才允许使用少量固定色，并必须通过 `color-mix` 降低饱和度。

优先级：

1. VSCode 语义 token，例如 `--vscode-editor-background`、`--vscode-button-background`、`--vscode-focusBorder`。
2. 当前 surface 相关 token 的 fallback，例如 `editorWidget` -> `editor`。
3. 低占比固定强调色，例如 Agent 的绿色、Terminal 的蓝色、文件活动的橙色。
4. 禁止把固定背景色、固定渐变或固定深色混色作为默认产品底色。

### Surface

- `canvas`：使用 `--vscode-editor-background`，保持与当前 VSCode 编辑器 / panel 语境一致。
- `canvas-subtle`：用于 minimap 内部、轻底片或弱分区，最多混入少量 `sideBar` 背景。
- `surface`：用于 minimap、controls、菜单等 workbench widget。
- `surface-muted`：用于节点内部轻内容面，例如 file list entry、Note 内容区、空状态边界。
- `surface-chrome`：用于节点标题栏，和正文区拉开轻微层级，但不能形成重色块。

### Text

- 主文本使用 `--vscode-editor-foreground`。
- 副标题、路径、提示和不可用说明使用 `--vscode-descriptionForeground`。
- 图标默认使用 `--vscode-icon-foreground`，没有可用 token 时才回退到主文本色。
- 禁止为了“弱化”而把关键状态文本降到不可读对比度；状态弱化应优先通过布局与密度完成。

### Semantic

语义色只用于状态表达：

- `running` / attention：绿色系，提示正在运行或需要关注。
- `ready`：蓝色系，提示可继续或等待用户操作。
- `success`：绿色系，提示完成。
- `warning`：黄色 / 橙色系，提示受限、降级或需要确认。
- `error`：优先使用 `--vscode-errorForeground`。

语义色的常规呈现应是边框、状态胶囊、小图标或标题栏轻闪烁；不要把整块节点正文染成状态色。

### Node Accents

节点类型差异通过边框和少量标题栏 attention 表达：

- `Agent`：绿色弱边框，强调执行与 AI 协作主体。
- `Terminal`：蓝色弱边框，强调 shell / terminal 执行窗口。
- `Note`：紫色弱边框，强调轻量文档对象，但不得变成大面积紫色卡片。
- `File`：橙色弱边框，强调文件活动投影。
- `File List`：更偏橙红的弱边框，强调文件集合 / 目录投影。

### Graph Colors

关系线默认使用低饱和 `descriptionForeground`。选中或 hover 时通过 outline、编辑台、端点热区和标签输入框表达焦点，不依赖主线突然变成高饱和颜色。

预设关系色可以存在，但它们必须服务于用户手动区分关系，不应成为系统自动推断语义的证据。

## Typography

### Font Family

- 默认 UI 字体使用 `var(--vscode-font-family)`，与用户当前 VSCode 设置保持一致。
- 终端内容由 xterm.js 与 VSCode terminal 设置决定，不在普通 UI token 中强行覆盖。
- Note 的 Markdown 预览、菜单、按钮和状态标签均使用 VSCode UI 字体。
- 不引入独立品牌字体，除非先有专项设计文档说明收益、加载方式、授权和回退策略。

### Hierarchy

| 用途 | 建议值 | 说明 |
| --- | --- | --- |
| 节点标题 | 13px / 600 / 1.3 | 对象身份，标题栏可编辑。 |
| 节点副标题 | 11px / 400 / 1.35 | provider、路径、摘要和辅助状态。 |
| 正文小文本 | 12px / 400 / 1.5 | Note 正文、空状态、帮助说明。 |
| 胶囊 / 按钮 | 11px / 500 / 1.2 | 状态、紧凑按钮、菜单项。 |
| 终端 | 跟随 VSCode terminal | 保持原生 terminal 肌肉记忆。 |

### Principles

- 信息层级靠位置、权重和密度组织，不靠大字号 hero。
- 节点标题是对象身份，不应被正文区、类型标签或独立 inspector 取代。
- 代码和终端内容遵循对应运行时，不把普通 UI 字体强加给 PTY 输出。
- 文案应短、具体、可操作；长说明优先进入 sidebar、tooltip 或正式文档，不常驻画布角落。

### Font Substitutes

如果 Webview 无法读取某些 VSCode 字体设置，应回退到 VSCode Webview 默认字体栈，而不是内置外部 web font。任何外部字体、图标集或额外资产都需要先确认体积、许可证和离线可用性。

## Layout

### Spacing System

当前 UI 使用紧凑的 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 24px 节奏。常见使用方式：

- `2px`：标题与副标题之间的最小间隔。
- `4px`：widget 内部微间距、minimap padding。
- `6px`：标题栏按钮组、状态 cluster。
- `8px`：菜单、file list、edge toolbar 内部节奏。
- `10px`：标题栏横向 gap、紧凑内容 padding。
- `12px`：节点正文 padding、普通内容卡片 padding。
- `14px`：画布角落控件到边缘距离。
- `16px`：侧栏内容 section 内较大间隔。
- `24px`：页面 / 文档级 section 间隔，不应频繁出现在 Webview 节点内部。

### Grid & Container

- 画布是无限空间，不是固定页面栅格；主布局由用户拖拽位置、React Flow 视口和节点尺寸共同决定。
- 节点内部采用简单 flex / grid，优先保证标题栏、正文区和终端区域的可恢复尺寸。
- `editor` / `panel` 是同一逻辑画布的两种宿主承载面，不应设计成两套不同 UI。
- sidebar 是全局入口、状态摘要、模板管理、节点定位和会话历史入口，不承担选中节点 inspector 或大面积 dashboard。
- 文件活动的最小投影允许使用 compact / minimal 形态，但不得破坏点击、路径识别和可访问名称。

### Whitespace Philosophy

画布空白是工作空间的一部分。不要因为空白存在就添加说明块、统计卡或品牌装饰。常驻元素应只保留节点、边、导航控件、minimap 和必要的 attention 提示；上下文菜单可以作为短暂弹出的空间相关操作入口出现，但不应变成常驻面板。

### Placement Rules

- 新建节点优先落在当前视口附近，并通过宿主避碰搜索避免初始重叠。
- 空画布是合法起点；不要用示例节点伪装“有内容”。
- 左上角和右上角默认不放常驻说明或操作面板。
- 左下角保留导航 controls，右下角保留 minimap / 全局定位。

## Elevation & Depth

### Shadow Philosophy

阴影用于区分浮层和当前编辑焦点，不用于制造玻璃拟态或营销式深度。

- 节点默认可有轻阴影，选中时以 `focusBorder` 外描边强化。
- workbench widget 使用浅阴影和 1px border，保持 VSCode 面板感。
- 菜单和 edge toolbar 可使用稍强阴影，但必须小面积、短生命周期。
- minimap 不使用高饱和节点阴影；视口内外区分优先靠遮罩和边界。

### Decorative Depth

禁止把以下效果作为常规 UI 基线：

- 大面积毛玻璃、强 backdrop blur。
- 固定深色渐变背景。
- 高饱和 neon glow。
- 多层 card-in-card 嵌套。
- 为了“科技感”而添加与任务无关的装饰线或粒子。

## Shapes

### Border Radius Scale

| Token | 值 | 用途 |
| --- | --- | --- |
| `node` | 10px | 普通节点外框。 |
| `node-inner` | 8px | 节点内部内容面。 |
| `widget` | 8px | minimap、controls、菜单和浮层。 |
| `widget-sm` | 6px | 按钮、状态胶囊、file entry。 |
| `toolbar` | 5px | edge toolbar、紧凑工具按钮。 |
| `handle` | 999px | 连线锚点、圆形 swatch。 |

### Geometry

- 节点整体更接近 VSCode editor widget / panel，而不是圆润营销卡片。
- 标题栏与正文区之间保持 1px 分隔，建立窗口化语义。
- Note 是文档面，不是表单卡片；Terminal 是运行窗口，不是聊天卡片；Agent 是执行窗口，不是仅展示消息气泡的聊天面板。
- 文件节点可以有 minimal 形态，但 minimal 不是“不可见”；仍要保留足够热区、焦点态和路径语义。

## Components

### Canvas Shell

`canvas-shell` 是整张工作面：

- 背景使用 `--vscode-editor-background`。
- 只定义必要 CSS 变量，例如节点 radius、edge color、attention 动画时长。
- 不承载营销式 header、空状态大 hero 或永久说明面板。
- 需要用户教学时，优先通过 sidebar、命令标题、tooltip 或文档补充。

### Controls & MiniMap

- 左下角 controls 使用 VSCode toolbar 风格：小按钮、低圆角、透明背景、hover 才显著。
- 右下角 minimap 使用 workbench widget 风格：1px border、小圆角、轻遮罩。
- 两者都是空间导航工具，不承载创建、设置或说明长文案。

### Sidebar

当前 Activity Bar 中的 Dev Session Canvas sidebar 由五个 section 组成：

- `概览`：原生 TreeView，展示工作区信任、画布状态、通知模式、文件功能和关键环境配置摘要；标题行提供设置入口。
- `模板`：最小 WebviewView，展示内置 / 用户 / 工作区模板，并承载应用、重置为模板、设为默认、导出和删除等模板动作。
- `常用操作`：最小 WebviewView，承载打开画布、创建节点、重置为默认模板、清空画板，以及文件功能开启时的 `include` / `exclude` 内联输入框；标题行也保留部分高频 icon-only 快捷入口。
- `节点`：最小 WebviewView，展示当前画布节点列表、状态摘要和 attention 标记，点击后定位到画布中的对应节点。
- `会话历史`：最小 WebviewView，展示当前 workspace 的 Agent 会话历史，支持过滤并恢复可用历史会话。

sidebar 的约束：

- 视觉应接近 VSCode 原生 section；WebviewView 只用于 TreeView 无法承载的 inline 输入、模板操作、节点列表和会话历史，不应重新做成 mini dashboard。
- 状态摘要留在概览，动作留在常用操作，模板生命周期留在模板 section，节点定位留在节点 section，会话恢复留在会话历史 section。
- sidebar 可以提供“跳到对象 / 恢复会话”的导航入口，但不要把选中节点正文、终端输出或完整 inspector 搬进 sidebar。
- 当能力不可用时，使用明确禁用态和短说明，而不是隐藏所有入口。

### Node Window

所有主要节点共享同一套窗口语义：

- 外框：1px border + 轻阴影 + 类型弱边框。
- 标题栏：可编辑标题、可选副标题、右侧动作区。
- 正文区：按节点类型承载终端、Note 文档、文件列表或状态内容。
- 选中态：以 `focusBorder` 外描边表达，不重绘整块背景。
- resize：节点尺寸属于宿主权威状态，视觉上必须能解释为可调整窗口。

### Agent Node

Agent 节点是 AI 执行窗口：

- 标题可编辑，副标题展示 provider / session 关键信息。
- 运行、停止、重启、新会话等动作放在标题栏右侧，按钮保持紧凑。
- 终端 / transcript 区域优先保证执行状态、输出和输入可读性。
- provider 差异不应通过大面积品牌色表达；用副标题、状态与必要图标即可。

### Terminal Node

Terminal 节点应最大限度尊重 VSCode terminal 肌肉记忆：

- 字体、选择、复制、粘贴、`Ctrl+C`、链接打开和右键语义优先对齐原生 terminal。
- xterm 主题从 VSCode token 热更新，不销毁会话、不清空 scrollback。
- 缩放与拖选坐标必须优先保证 terminal 可用，不为了画布统一手势破坏 terminal 主路径。

### Note Node

Note 是轻量工作文档：

- 只保留标题和正文两项核心信息。
- 标题栏右侧只放必要动作，例如删除。
- 正文区可以在编辑态和 Markdown 预览态之间切换，但不引入任务系统、负责人或状态字段。
- Note 不应回退为 inspector 表单，也不应承担完整知识库或文档编辑器职责。

### File & File List Nodes

文件活动节点是 Agent 工作痕迹的投影：

- `File` 展示单个文件路径或图标，点击应回到 VSCode 原生文件打开能力。
- `File List` 展示一组文件活动，可在 list / tree / minimal 等密度之间切换。
- 读写状态使用小 badge 或轻图标，不把整行染成强语义色。
- 自动边表达文件引用关系，但不反向伪造业务依赖结论。

### Edges & Anchors

连线组件应保持轻量：

- 四向锚点只在 hover、选中或连线中显示。
- 默认连线低饱和；选中态通过 outline 和轻量编辑台表达。
- 标签默认贴线纯文本，进入编辑时才显示输入框。
- edge toolbar 是短生命周期浮层，只承载箭头、颜色、标签和删除等直接动作。

### Buttons, Menus & Inputs

- 主按钮使用 VSCode button token；危险动作使用 error token 的弱背景和明确文案。
- secondary 按钮是默认动作密度，不要把每个入口都做成 primary。
- 菜单使用 VSCode menu token；项高保持紧凑，但必须可键盘 focus。
- 输入框优先使用 VSCode input token；inline 输入只用于确实需要连续编辑的场景。

### Status & Attention

- 状态胶囊用于运行、等待、完成、错误、受限等短状态。
- attention 不等于 error；需要用户关注时可用标题栏轻闪烁、minimap 节点闪烁和通知桥接共同表达。
- `prefers-reduced-motion: reduce` 下必须降低或移除循环动画，并保留非动画视觉提示。
- 桌面通知点击回到画布后，仍应让用户能明确看到哪个节点需要处理。

### Empty, Restricted & Degraded States

- 空画布是正常状态，不需要自动生成示例节点。
- Restricted Mode 中执行型入口应明确说明受限原因，并保留能打开文档或设置的路线。
- 远程、notifier companion 不可用、CLI 未配置、文件功能关闭等场景，都应使用可解释降级，而不是让按钮静默失败。

## Do's and Don'ts

### Do

- 使用 VSCode token 和当前主题作为所有 surface 的默认来源。
- 把画布空间留给节点、关系和导航，把全局动作交给 sidebar / 命令入口。
- 通过标题栏、边框、状态胶囊和少量图标表达节点类型与状态。
- 在新增 UI 前先确认它是否帮助用户看清全局；如果只是说明或设置，优先离开画布。
- 为浅色、深色、Restricted、远程和 reload 恢复路径保留验证说明。
- 当交互取舍会改变用户心智时，同步更新对应 `docs/design-docs/` 文档。

### Don't

- 不要固定深色画布、渐变背景或强品牌色作为默认视觉身份。
- 不要把节点内部做成多层 card-in-card、表单面板或 dashboard。
- 不要用颜色替代结构化状态；颜色只能辅助，不是事实来源。
- 不要在画布角落常驻长文案、统计卡、重复详情或选中节点 inspector。
- 不要重写 terminal 的高频原生交互，除非已有专项设计文档记录原因与验证。
- 不要把尚未验证的视觉方向写成“已确认”基线。

## Responsive Behavior

### Workbench Widths

这里的响应式对象不是公网网页，而是 VSCode 中可能变化的 editor / panel / sidebar 宽度。

- 宽画布：保留 minimap、controls、节点完整标题栏和当前节点尺寸。
- 中等宽度：优先减少非空间性浮层；节点内部通过滚动或裁切保护主内容。
- 窄宽度：不强行把画布改成列表；让用户通过 VSCode panel / sidebar 布局、minimap 和节点聚焦动作恢复上下文。
- sidebar 过窄时：长路径使用中间省略，完整值进入 tooltip 或后续详情入口。

### Touch Targets

产品当前默认服务 VSCode 桌面开发者，不按 touch-first 设计。但所有按钮仍应保持可点击热区：

- controls：约 28px。
- 普通 action button：至少 24px 高。
- 菜单项：建议 24px 以上。
- 连线 hitbox：视觉线细，但交互热区必须明显大于线宽。

### Collapsing Strategy

- 折叠 sidebar 不应让画布失去主路径；命令面板和右键创建仍应可达。
- 隐藏或 reload Webview 后，宿主权威状态必须能恢复节点、边、尺寸和关键运行时摘要。
- 当某些能力不可用时，优先降级为明确状态，而不是在窄宽度下悄悄删除入口。

### Motion

- 动画只用于 attention、hover / focus transition、菜单显隐和轻量反馈。
- attention 动画必须支持 `prefers-reduced-motion`。
- 不使用大范围页面入场动画、粒子动效或持续背景运动。

## Accessibility & Interaction

- 所有可点击元素必须有可见 focus 态或宿主原生 focus 行为。
- Icon-only 操作必须提供 `aria-label`、title 或等价可访问名称。
- 状态不能只靠颜色表达，应有文本、图标或 tooltip 辅助。
- Keyboard 行为必须避免误删：例如 edge 的 `Delete` 只删除当前选中连线，不复用节点删除语义。
- 终端区域获得焦点后，应优先保留 terminal 的键盘语义。
- Markdown 预览中的链接、代码、任务列表等交互必须遵守 Webview 安全边界。

## Iteration Guide

新增或修改 UI 时按以下顺序收口：

1. 先判断这是 design-system 基线变化、单功能交互取舍，还是一次性实现细节。
2. 如果改变颜色、字体、形状、组件语言或跨功能 UI 规则，更新本文。
3. 如果改变某个功能的目标、非目标、候选方案、风险或正式方案，更新 `docs/design-docs/` 对应文档和索引。
4. 如果改变用户需求范围或验收口径，更新 `docs/product-specs/`。
5. 如果涉及 UI / 交互实现，优先补 Playwright Webview 回归；涉及宿主行为时补 VSCode smoke；无法自动化时写明手动验证路径。
6. 截图或 Marketplace 媒体只能作为展示结果，不能替代正式设计结论。

## Known Gaps

- `docs/design-docs/canvas-sidebar-controls.md` 当前仍是“验证中”；sidebar 的真实 Extension Development Host 手动验证结果需要后续补齐。
- `docs/design-docs/canvas-feedback-polish.md` 仍保留部分历史过渡语境；当前画布外层 chrome 以 sidebar 化设计为准。
- 节点类型强调色仍包含少量固定 hex，通过 `color-mix` 降饱和；如果后续形成更稳定 token，应回写本文和实现。
- 窄宽度、远程场景和高对比主题的 UI 验证应持续补强；不要把常规深浅主题通过误写成全平台完成。
- 本文是 UI 基线，不替代 `docs/FRONTEND.md` 的维度清单，也不替代具体设计文档的决策记录。
