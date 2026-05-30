# 画布导航与工作台原生收口规格

当前状态：已确认。2026-04-13 已按本文规格完成实现，并通过自动化验证覆盖默认 `panel` 主路径、标题栏双击聚焦、空白区右键快捷创建、`Agent` / `Terminal` 内嵌 `xterm` 跟随 VSCode 主题切换，以及相关 smoke 场景。2026-05-11 继续补齐全局动态概览缩放与概览模式配置：fit view 可在节点分散时缩到 `0.4` 以下；概览模式仅提供 `none` 与 `title` 两个选项，默认 `title` 会在节点内容区域显示节点标题，`none` 则无论缩放多小都不进入概览；概览触发倍率由 `devSessionCanvas.canvas.overviewZoomThreshold` 配置，默认 `0.2`。2026-05-15 补齐低倍率概览中的状态可读性：默认 `title` 概览在内容区域显示节点标题，并只为 `Agent` / `Terminal` 等本身有运行状态的节点追加状态标记。`panel` route 的实际工作台位置仍由 VSCode 原生维护。

## 1. 用户问题

当前主画布已经能在 VSCode 内承载 `Agent`、`Terminal` 和 `Note`，但仍有四个主路径摩擦：

- 当节点变多、画布缩小后，用户缺少一个比手动平移缩放更快的“回到当前节点”动作。
- 画布虽已支持 `editor/panel` 两种承载面，但默认仍是 `editor`，用户打开其他文件时仍容易把主画布挤走。
- 节点标题栏、节点外轮廓和右下角地图仍带明显自定义白板感，不够像 VSCode 原生工作台里的轻量 toolbar / widget / minimap 语言。
- `Agent` 和 `Terminal` 节点中的内嵌 `xterm` 在 VSCode 切换主题后，内容区配色不应继续停留在旧主题。
- 在空白画布上新建对象仍主要依赖侧栏或命令面板，不够贴近白板式操作习惯。
- 当节点数量或分布范围继续增大时，固定 `0.4` 缩放下限会阻止用户一次看全全部节点；但低倍率概览也需要给用户可关闭的选择，并在开启时保留节点身份线索。

## 2. 目标用户

当前规格优先服务已经把 Dev Session Canvas 当作多执行单元全局视图使用的 VSCode 开发者。用户熟悉 VSCode 的编辑区、Panel、Secondary Sidebar 和原生命令入口，希望画布交互继续贴近工作台原生习惯，而不是发展出一套完全独立的 UI 语言。

## 3. 核心用户流程

1. 用户执行 `Dev Session Canvas: 打开画布`。
2. 在未显式改设置的情况下，主画布默认通过 `panel` route 打开，而不是默认占用编辑区。
3. 用户在一张包含多个节点的画布上工作；当某个节点跑远或缩得太小，用户双击该节点标题栏，即可让它重新居中并回到合适阅读尺寸。
4. 用户查看节点时，看到的是更接近 VSCode 原生 workbench 的标题栏、外轮廓和地图 widget，而不是高圆角白板卡片。
5. 用户在 VSCode 深浅主题之间切换时，`Agent` 和 `Terminal` 节点里的 `xterm` 内容区颜色、光标、选区与 ANSI 调色板会一起切换；即使主题没有显式声明 `terminal.background` 或完整 ANSI 颜色，也不会停留在旧主题或退回固定深色。
6. 用户在画布空白区右键，看到一个轻量快捷菜单，并可直接新建 `Agent`、`Terminal` 或 `Note`。
7. 如果用户把 `panel` route 的 view 移到了底部 Panel 或右侧 Secondary Sidebar，VSCode 会继续记住这一工作台位置；扩展不应把它强行拉回某个绝对位置。
8. 当节点分散到很远时，用户点击 fit view 仍能看到全部节点；如果概览配置为默认 `title`，低于可配置概览触发倍率时每个节点内容区域会显示节点标题，并只为 `Agent` / `Terminal` 等本身有运行状态的节点追加状态标记；如果配置为 `none`，画布不会切换到概览显示。

## 4. 在范围内

- 节点标题栏双击聚焦：
  - 双击节点标题栏的非交互区域后，节点会居中并缩放到适合阅读的尺寸。
  - 输入框、按钮本身保持原有交互语义，不把双击改成导航动作。
- 默认承载面改成 `panel`：
  - `devSessionCanvas.canvas.defaultSurface` 的默认值改为 `panel`。
  - `Dev Session Canvas: 打开画布` 在默认配置下走 `panel` route。
  - 当 `devSessionCanvas.canvas.defaultSurface = panel` 时，VS Code 启动后应能在原生 Panel 区域发现 `Dev Session Canvas` view；这只是承载位置可发现性，不要求扩展每次启动都自动把画布拉到前台或立即渲染 Webview 内容。
  - 显式命令 `在编辑区打开画布` / `在面板打开画布` 继续保留。
- `panel` route 的工作台位置边界：
  - 扩展继续使用可移动的 VSCode view container 路线，而不是重新改回固定 `WebviewPanel`。
  - 用户可以按 VSCode 原生方式把该 view 留在底部 Panel，或移动到 Secondary Sidebar。
  - 扩展文案与说明必须承认这是“用户可移动并由 VSCode 记住的位置”，而不是误写成“永远固定在底部 Panel”。
- 节点与地图视觉原生化：
  - 标题栏按钮、Agent provider 的只读副标题和状态标签统一收口为更接近 VSCode workbench 的低强调样式。
  - 节点外轮廓从偏白板的大圆角卡片收口到更接近 VSCode editor widget / panel 的小圆角边界。
  - 右下角 minimap 收口为更接近 VSCode workbench widget 的小圆角地图面板，而不是高圆角浮层。
  - `Agent` 与 `Terminal` 的内嵌 `xterm` 主题需跟随 VSCode 当前主题实时刷新，至少覆盖背景、前景、光标、选区与 ANSI 16 色，不要求重建现有会话实例。
  - 主题 token 以 VSCode Webview 实际注入到当前页面的 CSS vars 为准；当 `terminal.background` 缺失时，背景需按当前 surface 回退到 `panel.background` 或 `editor.background`。
  - 当 ANSI 颜色 token 缺失时，需回退到 VSCode 官方终端默认调色板，而不是仓库私有颜色。
  - 保留现有动作集合和状态语义，不额外扩张按钮数量。
- 画布空白区右键菜单：
  - 仅在空白 pane 出现，不在节点、终端或输入控件内部劫持原有右键语义。
  - 第一版仅提供创建 `Agent`、`Terminal`、`Note` 的快捷入口。
  - 节点默认创建在右键发生位置附近，而不是固定落在视口中心。
- 全局动态概览缩放与概览模式配置：
  - 全局 fit view 和手动缩小不再被固定 `0.4` 下限阻挡；`0.4` 只代表日常编辑舒适下限，完整容纳全部节点所需倍率可以更低。
  - 不设置额外绝对硬下限，避免未来在更大画布上再次无法看全节点。
  - 概览模式设置只提供 `none` 和 `title` 两个选项。
  - 概览触发倍率通过 `devSessionCanvas.canvas.overviewZoomThreshold` 配置，默认 `0.2`，可在 `0` 到 `1` 范围内调整；该配置不改变动态最小缩放或 fit view 能力。
  - `none` 表示无概览：无论缩放多小都保持普通节点渲染。
  - `title` 表示低倍率进入概览后，在节点内容区域显示节点标题；对于 `Agent` / `Terminal` 等本身有运行状态的节点，同时显示状态标记，帮助用户确认节点身份与当前状态。

## 5. 不在范围内

- 通过扩展 API 强制把 view 默认贡献到 Secondary Sidebar。
- 改写 VSCode 自己保存的 view 位置、工作台布局或用户个性化设置。
- 节点级右键菜单、连接线菜单或多级上下文菜单。
- 新增节点模板、批量创建或更复杂的白板命令面板。
- 重新设计节点正文结构、执行会话模型或对象关系模型。
- 为标题栏双击新增键盘快捷键等价物。
- 在 `none` / `title` 之外新增更多概览选项或自动策略。

## 6. 关键对象与状态

### 画布导航状态

- 当前视口位置与缩放
- 当前选中节点
- 最近一次“聚焦节点”动作产生的视口变化

### 宿主承载面

- 默认 surface 配置值 `editor | panel`
- 当前主画布 active surface
- `panel` route 的真实工作台位置由 VSCode 维护，扩展只承认它可能位于底部 Panel 或 Secondary Sidebar

### 节点标题栏

- 标题输入框
- provider 标识（仅 Agent，只读）
- 状态标签
- 标题栏动作按钮
- 可触发聚焦的非交互标题栏区域

### 空白区右键菜单

- 菜单是否打开
- 菜单的屏幕位置
- 对应的 flow 坐标锚点
- 可创建的节点类型集合
- 当前创建项是否只读可见但受限，以及对应的受限原因提示

### 概览缩放与概览模式

- 动态全局最小缩放倍率
- 概览触发倍率配置 `devSessionCanvas.canvas.overviewZoomThreshold`
- 概览模式配置值 `none | title`
- 概览态是否正在生效

## 7. 验收标准

- 在默认设置下执行 `Dev Session Canvas: 打开画布` 时，主画布进入 `panel` route，而不是默认在编辑区打开。
- 显式 `在编辑区打开画布` 命令仍能把主画布拉回编辑区。
- 用户把 `panel` route 的 view 移到 Secondary Sidebar 后，再次执行默认打开或显式 `panel` 打开命令时，扩展不会把它错误描述成“固定在底部 Panel”。
- 双击节点标题栏非交互区域后，节点会在视口中居中，并缩放到适合阅读的尺寸；双击标题输入框或按钮不会触发该动作。
- 节点标题栏按钮和状态标签在视觉上更接近 VSCode workbench 的 toolbar / badge 语言，而不再是高圆角大胶囊。
- 节点外轮廓和 minimap 的圆角、边框与阴影明显更接近 VSCode workbench widget，而不是白板式浮层卡片。
- VSCode 切换深浅主题后，`Agent` 与 `Terminal` 节点里的 `xterm` 会同步刷新颜色主题；至少背景、前景、光标、选区与 ANSI 16 色不再停留在旧主题。
- 即使当前主题没有声明 `terminal.background`，`xterm` 背景也会按当前 surface 正确回退到 `panel.background` 或 `editor.background`。
- 即使当前主题没有声明完整 ANSI 16 色，`xterm` 也会回退到 VSCode 官方默认终端调色板，而不是继续保留上一个主题的颜色。
- 在空白画布右键后，用户可以直接看到新建 `Agent`、`Terminal`、`Note` 的快捷菜单；点选后节点出现在右键点附近。
- 当 workspace 未受信任时，空白区右键菜单仍显示 `Agent`、`Terminal`、`Note` 三类入口；点击受限的 `Agent` / `Terminal` 时，会弹出说明当前不可用原因的宿主 modal，而不是把入口隐藏掉。
- 右键菜单在点击外部、按 `Escape`、切换节点或完成创建后会关闭。
- 当节点分布很宽时，点击 fit view 后缩放可以低于 `0.4`，且所有节点仍进入当前视口。
- 当概览模式为默认 `title`，且缩放低于概览触发倍率时，节点内容区域显示节点标题；`Agent` / `Terminal` 等本身有运行状态的节点额外显示状态标记，用户能在低倍率下辨认节点并区分状态。
- 当用户调整 `devSessionCanvas.canvas.overviewZoomThreshold` 后，当前画布会按新的触发倍率进入或退出概览显示，无需重新加载窗口。
- 当概览模式为 `none`，即使缩放低于概览触发倍率，画布也不进入概览模式，节点正文和内容区域继续按普通表面渲染。

## 8. 开放问题

- 第一版“合适尺寸”的缩放上限应取多少，才能既解决远距离节点定位，又不把节点放大得过头。
- 未来是否需要把“聚焦节点”扩展到连接线、搜索结果或对象列表跳转，目前先不纳入本规格。
