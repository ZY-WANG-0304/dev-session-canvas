---
version: 2026-05-12
name: DevSessionCanvas UI
description: DevSessionCanvas 的跨功能 UI design-system 基线。本文只记录 UI token、组件表面语言和通用 Do / Don't；产品判断、功能规格、具体设计方案和前端实现检查清单分别进入对应正式文档。
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
  accent-execution-primary: "color-mix(in srgb, #22c55e 24%, var(--vscode-widget-border, var(--vscode-panel-border)) 76%)"
  accent-execution-secondary: "color-mix(in srgb, #38bdf8 24%, var(--vscode-widget-border, var(--vscode-panel-border)) 76%)"
  accent-document: "color-mix(in srgb, #a78bfa 24%, var(--vscode-widget-border, var(--vscode-panel-border)) 76%)"
  accent-resource: "color-mix(in srgb, #f59e0b 28%, var(--vscode-widget-border, var(--vscode-panel-border)) 72%)"
  accent-resource-group: "color-mix(in srgb, #f97316 28%, var(--vscode-widget-border, var(--vscode-panel-border)) 72%)"
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
  runtime-monospace:
    fontFamily: "host runtime monospace font"
    fontSize: "follow host runtime settings"
    fontWeight: 400
    lineHeight: "follow runtime renderer fit"
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
  runtime-frame:
    backgroundColor: "host runtime background token with panel/editor fallback"
    typography: "{typography.runtime-monospace}"
  document-surface:
    backgroundColor: "{colors.surface-muted}"
    typography: "{typography.body-sm}"
  canvas-edge:
    stroke: "var(--canvas-edge-stroke-default)"
    selectedOutline: "color-mix(in srgb, var(--vscode-focusBorder) 46%, transparent)"
  sidebar-section:
    hostSurface: "host-native sidebar surface by default"
    density: "compact workbench section"
---

# UI

## Overview

`docs/UI.md` 是 DevSessionCanvas 的跨功能 UI design-system 基线，记录视觉 token、组件表面语言和通用 Do / Don't。

边界：

- 产品定位、视觉原则和取舍标准以 `docs/PRODUCT_SENSE.md` 为准。
- 功能范围和验收口径以 `docs/product-specs/` 为准。
- 具体交互方案、风险取舍和实现边界以 `docs/design-docs/` 为准。
- 前端实现检查清单以 `docs/FRONTEND.md` 为准。

## Colors

### Theme Contract

所有用户可见层默认从 VSCode theme token 取色。只有在 VSCode 没有对应语义 token、且需要表达对象类型、状态或关系色时，才允许使用少量固定色，并必须通过 `color-mix` 降低饱和度。

优先级：

1. VSCode 语义 token，例如 `--vscode-editor-background`、`--vscode-button-background`、`--vscode-focusBorder`。
2. 当前 surface 相关 token 的 fallback，例如 `editorWidget` -> `editor`。
3. 低占比固定强调色，例如对象类型边框、状态胶囊或关系预设色。
4. 禁止把固定背景色、固定渐变或固定深色混色作为默认产品底色。

### Token Roles

- `canvas` / `surface` / `surface-muted` / `surface-chrome`：只负责建立画布、widget、对象正文和标题栏层级。
- `text` / `text-muted` / `icon`：只负责主文本、副文本和图标可读性。
- `border` / `border-subtle` / `focus`：只负责边界、弱分割和当前焦点。
- `semantic-*`：只负责状态解释，不替代结构化状态或事实来源。
- `accent-*`：只负责对象类型弱区分，不用于大面积内部染色。

## Typography

### Font Family

- 默认 UI 字体使用 `var(--vscode-font-family)`，与用户当前 VSCode 设置保持一致。
- 等宽运行内容区域由宿主运行时与对应 Webview renderer 设置决定，不在普通 UI token 中强行覆盖。
- 文档预览、菜单、按钮和状态标签均使用 VSCode UI 字体。
- 不引入独立品牌字体，除非先有专项设计文档说明收益、加载方式、授权和回退策略。

### Hierarchy

| 用途 | 建议值 | 说明 |
| --- | --- | --- |
| 节点标题 | 13px / 600 / 1.3 | 对象身份，标题栏可编辑。 |
| 节点副标题 | 11px / 400 / 1.35 | 来源、路径、摘要和辅助状态。 |
| 正文小文本 | 12px / 400 / 1.5 | 文档正文、空状态、帮助说明。 |
| 胶囊 / 按钮 | 11px / 500 / 1.2 | 状态、紧凑按钮、菜单项。 |
| 等宽运行内容 | 跟随宿主运行时 | 保持原生执行面的肌肉记忆。 |

### Principles

- 信息层级靠位置、权重和密度组织，不靠大字号 hero。
- 节点标题是对象身份，不应被正文区、类型标签或独立 inspector 取代。
- 代码和等宽运行内容遵循对应运行时，不把普通 UI 字体强加给执行输出。
- 文案应短、具体、可操作；长说明优先进入侧栏、tooltip 或正式文档，不常驻画布角落。

### Font Substitutes

如果 Webview 无法读取某些 VSCode 字体设置，应回退到 VSCode Webview 默认字体栈，而不是内置外部 web font。任何外部字体、图标集或额外资产都需要先确认体积、许可证和离线可用性。

## Layout

### Spacing System

当前 UI 使用紧凑的 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 24px 节奏。常见使用方式：

- `2px`：标题与副标题之间的最小间隔。
- `4px`：widget 内部微间距、空间概览控件 padding。
- `6px`：标题栏按钮组、状态 cluster。
- `8px`：菜单、资源列表、连线工具条内部节奏。
- `10px`：标题栏横向 gap、紧凑内容 padding。
- `12px`：节点正文 padding、普通内容卡片 padding。
- `14px`：画布角落控件到边缘距离。
- `16px`：侧栏内容 section 内较大间隔。
- `24px`：文档级或大 section 间隔，不应频繁出现在 Webview 节点内部。

### Container Rules

- 画布、节点、侧栏 section 和浮层都应保持紧凑工具型密度。
- 画布空白的产品原则见 `docs/PRODUCT_SENSE.md`；design-system 不为空白区域预设说明块、统计卡或品牌装饰。
- 角落 widget 只用于空间导航、定位或短时反馈；非空间动作优先离开画布。
- 具体对象落位、空画布、上下文菜单与角落控件规则由 `docs/design-docs/canvas-feedback-polish.md` 和 `docs/design-docs/canvas-navigation-and-workbench-polish.md` 定义。

## Elevation & Depth

### Shadow Philosophy

阴影用于区分浮层和当前编辑焦点，不用于制造玻璃拟态或营销式深度。

- 节点默认可有轻阴影，选中时以 `focusBorder` 外描边强化。
- workbench widget 使用浅阴影和 1px border，保持 VSCode 面板感。
- 菜单和连线工具条可使用稍强阴影，但必须小面积、短生命周期。
- 空间概览控件不使用高饱和节点阴影；视口内外区分优先靠遮罩和边界。

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
| `widget` | 8px | 空间概览控件、导航控件、菜单和浮层。 |
| `widget-sm` | 6px | 按钮、状态胶囊、资源列表项。 |
| `toolbar` | 5px | 连线工具条、紧凑工具按钮。 |
| `handle` | 999px | 连线锚点、圆形 swatch。 |

### Geometry

- 节点整体更接近 VSCode editor widget / panel，而不是圆润营销卡片。
- 标题栏与正文区之间保持 1px 分隔，建立窗口化语义。
- 不同对象类型可以有专属内容面，但外层几何应保持同一套窗口化语言。

## Components

### Workbench Widgets

- widget 使用 VSCode token、1px border、小圆角和轻阴影。
- 常驻 widget 只能服务导航、定位或当前状态理解。
- 菜单、toolbar、tooltip 和编辑浮层应短生命周期、小面积、低装饰。

### Feature-Specific Surfaces

- 专属功能如果需要独立视觉系统，应放入对应功能文档，而不是扩写本文的通用 VSCode design-system 基线。
- 模板市场的浏览器网站与插件内市场面板 UI 详见 `docs/marketplace/UI.md`；本文不维护其 palette、页面结构或业务动作语义。

### Sidebar Section

Sidebar 的 design-system 规则只定义表面语言，不定义具体 section 数量、功能范围或宿主 API 形态：

- 状态摘要和宿主级导航优先使用宿主原生列表语义。
- 需要更丰富行内控件时，应保持最小自绘 surface，不把局部能力扩展成完整面板。
- 所有 sidebar section 都应贴近 VSCode 原生 sidebar：扁平列表、弱 hover、紧凑行距、少量 view title action。
- 禁止在 sidebar 中复制选中对象正文、连续运行输出或完整 inspector，也不要把 sidebar 做成 mini dashboard。

具体 section 职责、功能范围与验收标准分别记录在 `docs/product-specs/canvas-sidebar-controls.md`、`docs/product-specs/canvas-sidebar-node-and-session-lists.md` 和 `docs/product-specs/canvas-template-feature.md`。

### Node Surfaces

节点的通用视觉语言是窗口化、工具化、低噪音：

- 外框使用 1px border、轻阴影、低圆角和类型弱边框。
- 标题栏承载对象身份、可选副标题和右侧动作区。
- 正文区按对象类型承载内容，但不应引入多层 card-in-card。
- 选中态使用 `focusBorder` 外描边表达，不重绘整块背景。

具体对象行为和字段边界由 `docs/design-docs/` 中对应对象或节点设计文档定义，并从 `docs/design-docs/index.md` 查找。

### Edges & Anchors

连线组件保持轻量、可读、短操作路径：

- 默认连线低饱和；选中态通过 outline、端点热区和轻量编辑台表达。
- 四向锚点只在 hover、选中或连线中显示。
- 标签默认贴线纯文本，进入编辑时才显示输入框。
- 连线工具条是短生命周期浮层，只承载直接编辑动作。

具体连线模型、自动边和资源活动关系由 `docs/design-docs/` 中 graph / link / 资源活动相关设计文档定义，并从 `docs/design-docs/index.md` 查找。

### Controls

- 主按钮使用 VSCode button token；危险动作使用 error token 的弱背景和明确文案。
- secondary 按钮是默认动作密度，不要把每个入口都做成 primary。
- 菜单使用 VSCode menu token；项高保持紧凑，但必须可键盘 focus。
- 输入框优先使用 VSCode input token；行内输入只用于确实需要连续编辑的场景。

### Status

- 状态胶囊用于运行、等待、完成、错误、受限等短状态。
- 提醒态不等于错误态；视觉上应和错误态区分，具体提醒链路由 `docs/product-specs/canvas-node-notifications.md` 与 `docs/design-docs/index.md` 中的通知相关设计文档定义。
- 动画型状态不能作为唯一反馈；motion 实现检查清单见 `docs/FRONTEND.md`。

## Do's and Don'ts

### Do

- 使用 VSCode token 和当前主题作为所有 surface 的默认来源。
- 通过标题栏、边框、状态胶囊和少量图标表达对象类型与状态。
- 当交互取舍会改变用户心智时，同步更新对应 `docs/design-docs/` 文档。

### Don't

- 不要固定深色画布、渐变背景或强品牌色作为默认视觉身份。
- 不要把节点内部做成多层 card-in-card、表单面板或 dashboard。
- 不要用颜色替代结构化状态；颜色只能辅助，不是事实来源。

## Implementation Handoff

`docs/UI.md` 只保留 design-system 基线。实现侧检查清单、响应式退化、交互热区、可访问性、motion 和文档分流规则见 `docs/FRONTEND.md`。

新增或修改 UI 时，先按 `docs/FRONTEND.md` 的文档分流规则判断归属；只有跨功能视觉 token、形状尺度、组件表面语言或通用 Do / Don't 发生变化时，才更新本文。

## Known Gaps

- 状态与对象类型强调色仍包含少量固定 hex，通过 `color-mix` 降饱和；如果后续形成更稳定 token，应回写本文和实现。
- 本文是 UI 基线，不替代 `docs/FRONTEND.md` 的实现维度清单，也不替代具体设计文档的决策记录。
