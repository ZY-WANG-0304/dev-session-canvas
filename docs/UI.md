---
version: 2026-07-13
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
  node-agent: "#22c55e"
  node-terminal: "#38bdf8"
  node-note: "#a78bfa"
  status-starting: "var(--vscode-debugIcon-startForeground, var(--vscode-focusBorder))"
  status-running: "var(--vscode-debugIcon-startForeground, var(--vscode-debugIcon-restartForeground, var(--vscode-focusBorder)))"
  status-resuming: "var(--vscode-debugIcon-restartForeground, var(--vscode-focusBorder))"
  status-success: "var(--vscode-debugIcon-continueForeground, var(--vscode-focusBorder))"
  status-waiting: "var(--vscode-debugIcon-pauseForeground, var(--vscode-focusBorder))"
  status-stopped: "var(--vscode-debugIcon-stopForeground, var(--vscode-descriptionForeground))"
  status-disconnected: "var(--vscode-debugIcon-disconnectForeground, var(--vscode-descriptionForeground))"
  status-history: "var(--vscode-debugIcon-stepBackForeground, var(--vscode-descriptionForeground))"
  status-idle: "var(--vscode-debugView-stateLabelForeground, var(--vscode-descriptionForeground))"
  status-error: "var(--vscode-debugView-exceptionLabelForeground, var(--vscode-debugConsole-errorForeground, var(--vscode-errorForeground, var(--vscode-focusBorder))))"
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
    borderWidth: "inverse canvas viewport zoom, with the browser's 1 CSS px border minimum"
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
    accent: "VSCode debug/status token by state"
    backgroundColor: "status accent mixed at 18% with transparent"
    borderColor: "status accent mixed at 42% with panel border"
    textColor: "status accent; text is treated as a status indicator"
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
  canvas-group:
    backgroundColor: "var(--vscode-panel-background)"
    borderColor: "var(--vscode-panel-border)"
    title: "full-width straight-edged panel header, not a pill"
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

所有用户可见层默认从 VSCode theme token 取色。只有在 VSCode 没有对应语义 token、且需要表达对象类型或关系色时，才允许使用少量固定色，并必须通过 `color-mix` 降低饱和度；状态色优先使用 VSCode 的 debug / status 相关 token。

优先级：

1. VSCode 语义 token，例如 `--vscode-editor-background`、`--vscode-button-background`、`--vscode-focusBorder`。
2. 当前 surface 相关 token 的 fallback，例如 `editorWidget` -> `editor`。
3. 低占比固定强调色，例如节点类型识别色和关系预设色。
4. 禁止把固定背景色、固定渐变或固定深色混色作为默认产品底色。

### Token Roles

- `canvas` / `surface` / `surface-muted` / `surface-chrome`：只负责建立画布、widget、对象正文和标题栏层级。
- `text` / `text-muted` / `icon`：只负责主文本、副文本和图标可读性。
- `border` / `border-subtle` / `focus`：只负责边界、弱分割和当前焦点。
- `node-*`：产品识别色，只负责节点类型弱区分，不用于表达状态，也不用于大面积内部染色。
- `status-*`：状态指示色，优先来自 VSCode debug / status token，不替代结构化状态或事实来源。

## Typography

### Font Family

- 默认 UI 字体使用 `var(--vscode-font-family)`，与用户当前 VSCode 设置保持一致。
- 等宽运行内容区域由宿主运行时与对应 Webview renderer 设置决定，不在普通 UI token 中强行覆盖。
- 文档预览、菜单、按钮和状态标签均使用 VSCode UI 字体。
- 不引入独立品牌字体，除非先有专项设计文档说明收益、加载方式、授权和回退策略。

### Hierarchy

| 用途 | 建议值 | 说明 |
| --- | --- | --- |
| 节点上下文 | 10px / 400 / 1.2 | 可选标题上方上下文，例如 Agent cwd。 |
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
- `8px`：菜单、资源列表、连线工具条内部节奏；执行型节点的内嵌运行时 frame padding。
- `10px`：标题栏横向 gap、紧凑内容 padding。
- `12px`：节点正文外壳 padding、普通内容卡片 padding；卡片态 `Agent` / `Terminal` / `Note` / fallback 节点默认共享这一档。
- `14px`：画布角落控件到边缘距离。
- `16px`：侧栏内容 section 内较大间隔；文档型正文的纵向阅读 padding。
- `18px`：文档型正文的横向阅读 padding，仅用于 Note Markdown 预览和编辑面。
- `24px`：大 section 或空间组织对象的内部预留；分组成员到 group body 四边的视觉预留使用这一档。

### Container Rules

- 画布、节点、侧栏 section 和浮层都应保持紧凑工具型密度。
- 画布空白的产品原则见 `docs/PRODUCT_SENSE.md`；design-system 不为空白区域预设说明块、统计卡或品牌装饰。
- 角落 widget 只用于空间导航、定位或短时反馈；非空间动作优先离开画布。
- 系统生成节点应基于候选阶段宿主可得的 footprint 避开目标 root-local 画布中已有节点；这是创建时规则，不阻止用户之后手工拖拽形成重叠，也不自动重排旧节点。关系专属的方向或层级规则必须建立在同一避碰契约之上；若动态节点的真实初始尺寸在选位后才确定，必须把精度边界写入专项设计与技术债，不能包装成完整无重叠保证。
- 具体对象落位、空画布、上下文菜单与角落控件规则由 `docs/design-docs/canvas-feedback-polish.md`、`docs/design-docs/canvas-navigation-and-workbench-polish.md` 和 `docs/design-docs/canvas-fork-placement-and-generated-node-collision.md` 定义。

## Elevation & Depth

### Shadow Philosophy

阴影用于区分浮层和当前编辑焦点，不用于制造玻璃拟态或营销式深度。

- 节点默认可有轻阴影，选中时以 `focusBorder` 外描边强化。
- workbench widget 使用浅阴影和 1px border，保持 VSCode 面板感。
- 菜单和连线工具条可使用稍强阴影，但必须小面积、短生命周期。
- 空间概览控件不使用高饱和节点阴影；视口内外区分优先靠遮罩和边界。

### Zoom-Stable Boundaries

- 画布节点外边框、选中态边缘和 resize 强调线按视口缩放反向补偿线宽，使不同类型节点缩小时仍保持清晰。
- 选中态阴影边缘和 resize 强调线也按视口缩放反向补偿；CSS border 受浏览器至少 1 CSS px 的限制，因此放大时边缘仍会随画布变粗。
- 边框颜色继续使用节点类型既有的主题色混合，不因缩放改变颜色语义。

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
- 画布外层不可因焦点发生 DOM 隐式滚动；屏外对象焦点由所属 React Flow 实例平移至可见，不改变 zoom 或对象几何。终端和正文保留内部滚动与键盘语义，边界见 `docs/design-docs/canvas-focus-navigation.md`。
- Tab / Shift+Tab 逐项经过节点整体、内部控件、连线与只读标题；节点和分组的八个缩放手柄、Note 预览容器不占停靠点。预览内链接和复选框继续参与，鼠标缩放与预览交互保持不变。
- Agent / Terminal 的 Tab 停靠点是终端入口，而非 xterm 输入框；入口聚焦时在终端正文中央以紧凑浮层显示“Enter 进入终端 · Tab 继续导航”，不挤占正文布局、不拦截鼠标。Enter 只转入输入，不下发此次按键；鼠标点击正文直接进入。进入后隐藏提示并保留终端按键语义，暂不提供新增键盘退出机制。
- 终端入口提示采用 13px 字号和 8px / 12px 内边距；Enter / Tab 为带底边层次的 `kbd` 键帽，不是按钮，不新增 Tab 停靠点。窄节点允许按键与说明成组换行。
- 菜单、toolbar、tooltip 和编辑浮层应短生命周期、小面积、低装饰。

### Feature-Specific Surfaces

- 专属功能如果需要独立视觉系统，应放入对应功能文档，而不是扩写本文的通用 VSCode design-system 基线。
- 模板市场的浏览器网站与插件内市场面板 UI 详见 `docs/marketplace/UI.md`；本文不维护其 palette、页面结构或业务动作语义。

### Sidebar Section

Sidebar 的 design-system 规则只定义表面语言，不定义具体 section 数量、功能范围或宿主 API 形态：

- 状态摘要和宿主级导航优先使用宿主原生列表语义。
- 需要更丰富行内控件时，应保持最小自绘 surface，不把局部能力扩展成完整面板。
- 所有 sidebar section 都应贴近 VSCode 原生 sidebar：扁平列表、弱 hover、紧凑行距、少量 view title action。
- sidebar section 的标题级动作优先使用 VSCode 原生 view title action / secondary `...` 菜单；不要在 Webview 内容区自绘一个替代宿主更多菜单的 `...` 按钮。
- Webview 自绘 sidebar 列表必须按 VSCode list 状态 token 成对绑定颜色：默认标题文本优先使用全局 `foreground` 并以 `sideBar.foreground` 兜底；hover 使用 `list.hoverBackground` / `list.hoverForeground`；当前焦点选中项使用 `list.activeSelectionBackground` / `list.activeSelectionForeground`；失焦但保留选中项使用 `list.inactiveSelectionBackground` / `list.inactiveSelectionForeground`。不要把 `sideBar.foreground` 当作所有 row title 的唯一前景色，也不要只换背景不换对应前景色。
- 禁止在 sidebar 中复制选中对象正文、连续运行输出或完整 inspector，也不要把 sidebar 做成 mini dashboard。

具体 section 职责、功能范围与验收标准分别记录在 `docs/product-specs/canvas-sidebar-controls.md`、`docs/product-specs/canvas-sidebar-node-and-session-lists.md` 和 `docs/product-specs/canvas-template-feature.md`。

### Node Surfaces

节点的通用视觉语言是窗口化、工具化、低噪音：

- 外框使用 1px border、轻阴影、低圆角和类型弱边框。
- 节点类型颜色是产品识别色，可用于 marker、minimap 和弱边框；它们不是状态色，也不是主题 token 选择错误。
- 标题栏承载对象身份、可选标题上方上下文、可选副标题和右侧动作区。
- 正文区按对象类型承载内容，但不应引入多层 card-in-card。
- 节点正文 padding 以 `12px` 为默认外壳；执行型节点在正文外壳内再用 `8px` 的运行时 frame 包住 xterm，使 `Agent` 与 `Terminal` 的终端内容拥有一致留白。
- Note 是文档 surface：节点 body 可贴边，Markdown 预览和编辑态文本区使用 `16px 18px` 的文档页边距；行号 gutter 只占用编辑态左侧文档留白，不改变预览态节奏。
- 选中态使用 `focusBorder` 外描边表达，不重绘整块背景。

具体对象行为和字段边界由 `docs/design-docs/` 中对应对象或节点设计文档定义，并从 `docs/design-docs/index.md` 查找。

### Canvas Group Surfaces

分组是画布空间组织对象，视觉上应更接近 VSCode Panel，而不是节点卡片或白板贴纸：

- 标题栏基础高度为 `36px`，删除按钮保持 `24px` 并垂直居中，上下各留约 `6px`（含边框）；正文上沿仍保持画布坐标 `28px`，增加的标题高度向外扩展，不改变成员几何。
- 外框、body 和等宽标题栏使用 `--vscode-panel-background`；body 背景绘制在普通节点下方，不遮盖成员内容。标题栏不再采用按标题长度伸缩的 tab。
- 边框使用 `--vscode-panel-border`，标题栏和 body 都采用直角，body 上沿保留分隔线，画布缩放时保持屏幕可见线宽。标题栏覆盖分组全宽，不使用外浮胶囊、强阴影或高饱和标签。
- 选中态保留四边线、四角圆形控制点与标题前景；普通组右侧只显示一个删除按钮，复用节点危险按钮的背景、边框、圆角及 focus 样式，workspace-root 不显示删除。标题与按钮仅缩小时反向缩放，以固定最小可用宽度限制比例，文字省略且按钮留位；重命名与选中不改变比例。
- body 四周成员预留仍为 `24px`，宿主 top inset 仍为 `24px + 28px`；标题缩小时向外增长，不改变成员几何。标题栏非控件区域和边框可首次拖动，正文空白仍可选中、拖动画布和打开带分组归属的上下文菜单。删除方式由原生 modal 选择，详见 [分组等宽标题栏与统一操作](design-docs/canvas-group-header-interactions.md)。

### Node Title And Subtitle

节点标题与副标题共享同一套标题栏信息层级：

- 标题是对象身份，使用 `window-title` 字体层级，可编辑，保持单行，不承载来源路径、启动命令或长说明。
- 标题上方上下文是可选更低强调元信息，当前用于 Agent `cwdLabel` 这类定位上下文；它与标题同属对象身份区，但不和启动命令混在同一副标题里。
- 副标题是可选元信息行，使用 `subtitle` 字体层级，可表达 Agent 启动命令、Terminal shell path、关联 Markdown 文件路径等来源信息。
- Agent 标题栏中，路径 / multi-root root 上下文显示在标题上方；启动命令仍显示在标题下方副标题。两者各自独立做单行 ellipsis，并各自只在实际溢出时显示对应完整值 tooltip。
- 副标题文本必须保留完整的人类可读值，不在数据层按字符数预截断，也不为 Canvas 节点做中间省略；`resourceUri` 这类内部身份不能直接进入可见副标题。
- 可视最大长度由标题栏布局决定：Agent 标题副本区当前最多 `340px`，Terminal 与 Note 使用扣除右侧动作区后的标题栏剩余宽度；超出时统一单行 ellipsis。
- 溢出 tooltip 只在实际溢出时出现，内容应是同一条完整人类可读副标题；不要为了常驻 tooltip 单独维护另一份缩写/完整文案。
- 副标题不使用链接视觉，不加下划线、不使用 pointer cursor；打开文件、查看帮助等动作放在标题栏按钮或明确菜单中。

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
- 状态胶囊的文本与圆点一样属于状态指示，不按普通正文文本处理；背景使用状态 accent 的 18%，边框使用状态 accent 的 42% 与 panel border 混合。
- 状态胶囊的 `tone-*` 只负责替换 accent；`idle` 和 `error` 也复用同一套 18% 背景与 42% 边框强度，不再单独回退到特殊背景/边框 token。
- `Agent` / `Terminal` 标题栏状态胶囊、概览态执行节点状态胶囊、sidebar 节点列表中的状态胶囊都应复用同一套状态 accent、背景和边框推导规则；尺寸可以按承载面缩放，但颜色体系不能分叉。
- `Note` 状态文案必须使用共享 label id 映射，并在 Host / Webview 本地化边界翻译：关联 Markdown 的 `contentSource.status = ok` 必须使用共享 label id `status.noteAssociatedFile`，普通内嵌 `ready` 必须使用 `status.notePlain`；异常关联状态使用 `tone-error`。
- 提醒态不等于错误态；视觉上应和错误态区分，具体提醒链路由 `docs/product-specs/canvas-node-notifications.md` 与 `docs/design-docs/index.md` 中的通知相关设计文档定义。
- `Agent` 节点处于精确 `running` 状态时，标题栏底部可显示低强度往返移动细线作为运行活性提示；该细线使用 Agent 节点类型色与 panel border 混合后的低饱和纯色移动段，在标题栏底部分隔线区域内左右往返移动，只加粗移动段到 3px，非移动区域保留标题栏原有 1px 底部分隔线，不替代状态胶囊文本，也不泛化到 `launching`、`live`、`starting`、`resuming`、`reattaching` 或 `waiting-input`。
- `paneGallery` 的 root 标签可在 root 内存在精确 `running` 执行节点且无 attention 时显示一个 `|` 形竖向纯色色块在 root title 所在的小框区域内左右往返运动；thumbnail 模式 active root 占位卡片的左上角 root 标签也遵循同一状态动效规则；该动效只属于 `paneGallery` root 标签，不用于 `rootGroups` 系统 root 分组，颜色取 root 标签当前 border color，采用类似 Codex Working 状态的扁平活性提示：色块宽度为 16px、透明度为 0.82、无渐变和外发光；运动必须裁切在 root title 所在的小框区域内，title 文本保持在色块上方，标题栏原有 1px 底部分隔线保持不变。
- 动画型状态不能作为唯一反馈；motion 实现检查清单见 `docs/FRONTEND.md`。

## Do's and Don'ts

### Do

- 使用 VSCode token 和当前主题作为所有 surface 的默认来源。
- 通过标题栏、边框、状态胶囊和少量图标表达对象类型与状态；对象类型颜色与状态颜色必须分层使用。
- 让系统生成节点先通过统一碰撞检测再进入宿主权威状态，关系专属布局只负责候选顺序，不绕过通用避碰。
- 当交互取舍会改变用户心智时，同步更新对应 `docs/design-docs/` 文档。

### Don't

- 不要固定深色画布、渐变背景或强品牌色作为默认视觉身份。
- 不要把节点内部做成多层 card-in-card、表单面板或 dashboard。
- 不要用颜色替代结构化状态；颜色只能辅助，不是事实来源。

## Implementation Handoff

`docs/UI.md` 只保留 design-system 基线。实现侧检查清单、响应式退化、交互热区、可访问性、motion 和文档分流规则见 `docs/FRONTEND.md`。

新增或修改 UI 时，先按 `docs/FRONTEND.md` 的文档分流规则判断归属；只有跨功能视觉 token、形状尺度、组件表面语言或通用 Do / Don't 发生变化时，才更新本文。

## Known Gaps

- 节点类型和关系预设色仍包含少量固定 hex；这是产品识别色而非状态色。若后续形成更稳定的 host token，应回写本文和实现。
- 本文是 UI 基线，不替代 `docs/FRONTEND.md` 的实现维度清单，也不替代具体设计文档的决策记录。
