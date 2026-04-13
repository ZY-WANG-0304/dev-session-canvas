---
title: 画布导航与工作台原生收口设计
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-navigation-and-workbench-polish.md
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/canvas-navigation-and-native-polish.md
updated_at: 2026-04-13
---

# 画布导航与工作台原生收口设计

## 1. 背景

当前仓库已经完成了主画布 `editor/panel` 双 surface、节点窗口化表面、侧栏极简入口和空画布默认态等几轮收口。现在排在最前面的剩余问题，不再是“能不能跑起来”，而是“默认主路径是否足够顺手”和“视觉语言是否够像 VSCode 原生工作台”。

从用户反馈来看，当前还差几项关键动作：在大画布里快速回到某个节点、默认避开编辑区竞争、把节点标题栏与节点 / 地图外轮廓进一步收口到原生语境、让 `Agent` / `Terminal` 内嵌 `xterm` 跟随 VSCode 主题切换，以及在空白处提供更贴手的创建入口。

## 2. 问题定义

本轮要同时回答四个问题：

1. 节点导航是否应该提供比手动缩放和平移更快的聚焦动作。
2. `panel` route 是否应成为默认主路径，以及它和 Secondary Sidebar 的边界如何表达。
3. 节点标题栏、节点外轮廓与 minimap 应如何继续收口到 VSCode 原生风格。
4. 空白区右键菜单应做到什么范围，既能提升创建效率，又不把节点内语义打乱。
5. `Agent` 与 `Terminal` 中内嵌的 `xterm` 在 VSCode 切换深浅主题后，应如何稳定同步颜色主题而不打断当前会话。

## 3. 目标

- 增加一个低学习成本的节点聚焦入口。
- 把默认主画布承载面切到 `panel` route。
- 把标题栏按钮、状态标签、节点外轮廓与 minimap 一并收口到 VSCode 原生 workbench 语言。
- 让 `Agent` / `Terminal` 中内嵌的 `xterm` 与 VSCode 当前主题保持一致。
- 让空白区右键可以直接创建节点，并尽量让新节点靠近用户右键点。

## 4. 非目标

- 不通过非公开 API 或宿主状态 hack 强制把 view 默认放到 Secondary Sidebar。
- 不新增节点级右键菜单或复杂多级菜单。
- 不重做节点正文、会话模型或状态机。
- 不在本轮引入搜索面板、对象列表跳转或快捷键方案。

## 5. 候选方案

### 5.1 保持现状，只改默认 `panel`

优点：

- 宿主改动最小。

不选原因：

- 这无法解决节点快速定位、标题栏风格与空白区创建效率的问题。
- 用户当前最直接的摩擦来自“多处小步骤叠加”，而不是单一默认值。

### 5.2 对节点整体双击聚焦，并在任何右键场景都弹全局菜单

优点：

- 看起来入口更多，动作更显眼。

不选原因：

- 节点内部已经有标题输入、provider 信息、终端区域和按钮；对整节点双击或全域右键劫持会和这些现有交互直接冲突。
- 执行型节点里的终端本身就需要保留原生右键、拖选和双击语义。

### 5.3 只在标题栏非交互区域提供双击聚焦，只在空白 pane 提供右键创建菜单

优点：

- 导航入口清晰，但不侵入已有编辑和终端交互。
- 菜单范围窄，和侧栏 / 命令面板职责清楚。
- 实现上主要集中在 Webview 层，不需要改宿主协议大边界。

风险：

- 需要标题栏明确区分“交互控件”和“可当作 chrome 的空白区域”。

### 5.4 强制把 view 默认移动到 Secondary Sidebar

优点：

- 表面上最接近用户原始诉求。

不选原因：

- VSCode 官方公开能力只允许扩展 view container 默认贡献到 Activity Bar 或 Panel；Secondary Sidebar 是用户移动后的工作台区域，不是扩展可直接声明的默认目标。
- 如果为了表面满足需求去操作未公开工作台状态，会把产品建立在不稳定接口上。

## 6. 风险与取舍

- 取舍：默认 surface 改为 `panel`，但 Secondary Sidebar 只作为用户可移动后的合法位置，不写成扩展可强制设定的默认值。
  原因：这是当前唯一与 VSCode 官方公开能力一致的表达。

- 取舍：双击聚焦使用 React Flow 的单节点 `fitView`，而不是自定义复杂相机算法。
  原因：需求要的是“居中并缩放到合适尺寸”，单节点 `fitView + maxZoom` 已足够满足第一版，且与现有相机状态模型兼容。

- 风险：如果 `fitView` 没有限制放大上限，小节点会被放得过头。
  当前缓解：为聚焦动作显式设定 padding 和 max zoom。

- 风险：如果标题栏已经收口，但节点外轮廓和 minimap 仍保留大圆角浮层，整体还是会更像自定义白板应用而不是 VSCode 工作台。
  当前缓解：本轮把按钮、状态标签、节点外轮廓和 minimap 统一收口为更克制的 workbench widget 语言。

- 风险：右键菜单如果出现在节点或终端内部，会破坏执行节点已有的原生语义。
  当前缓解：只监听 React Flow pane 级 context menu。

- 风险：如果 `xterm` 主题只在首次创建时读取一次 CSS 变量，那么切换 VSCode 主题后，终端内容区会继续停留在旧主题，即使节点外壳已经切到新主题。
  当前缓解：宿主在主题切换时显式通知 Webview，Webview 对所有现存 `xterm` 实例热更新完整主题对象，而不是销毁重建终端。

- 风险：VSCode Webview 的主题 token 实际挂在 `body` 侧；如果前端只从 `documentElement` 读 CSS 变量，很多主题会读不到真实颜色，表现成“只在少数主题下跟随”。
  当前缓解：主题 token 统一从 Webview 当前主题作用域读取，优先使用 `body` 的 computed style，而不是假设 token 一定挂在 `html`。

- 风险：两个同类主题切换时，`body` 的 `vscode-dark` / `vscode-light` class 可能不变；如果只依赖宿主主题消息或 class 变化，`xterm` 可能错过真正的样式落地时机。
  当前缓解：除了响应 `host/themeChanged`，Webview 还监听 `body/html` 的 class、dataset、style 与 head style 注入变化，在 VSCode 实际完成主题样式更新后再次刷新现存 `xterm`。

## 7. 当前结论

### 7.1 节点聚焦入口收口为标题栏双击

- 仅在节点标题栏的非交互区域响应双击。
- 标题输入框和标题栏按钮保留原有交互，不把它们的双击改成导航。
- 双击后执行单节点 `fitView`，同时完成居中与缩放。
- 第一版通过 padding 和 max zoom 控制“合适尺寸”，不单独引入自定义相机规则。

### 7.2 默认主路径切到 `panel` route

- `devSessionCanvas.canvas.defaultSurface` 默认值改为 `panel`。
- `Dev Session Canvas: 打开画布` 在无用户覆盖配置时，默认走 `panel` route。
- 显式 editor / panel 打开命令继续保留。

### 7.3 `panel` route 的真实工作台位置由 VSCode 维护

- 扩展继续把 `panel` route 建立在可移动的 `WebviewView` / view container 上。
- 用户可以按 VSCode 原生工作台能力把它留在底部 Panel，或移动到 Secondary Sidebar。
- 扩展文案、standby 页面和侧栏状态只承认“这是 `panel` route 的 view”，不把它误描述成“永远固定在底部 Panel”。
- 不使用非公开 API 或内部存储 hack 强行改 Secondary Sidebar 默认落位。

### 7.4 节点与 minimap 视觉继续收口到 workbench 语境

- 标题栏按钮从高圆角胶囊改为更接近 VSCode toolbar 的低强调按钮。
- 状态标签改为更克制的 badge 语言，保留状态区分但降低视觉体积和饱和度。
- Agent provider 通过标题副标题只读展示，不再在已创建节点上提供切换控件。
- 节点外轮廓改用更接近 VSCode editor widget / panel 的小圆角边界，降低当前窗口卡片的白板感。
- 右下角 minimap 改成与 workbench 角落 widget 一致的小圆角地图面板，减少当前浮层式大圆角和重阴影；框外区域主要依靠更明显的背景遮罩，而不是继续依赖高饱和节点色块来做视口内外区分。

### 7.5 空白区右键菜单只做快捷创建

- 菜单只在空白 pane 弹出。
- 第一版仅提供 `Agent`、`Terminal`、`Note` 三项创建动作。
- 选中菜单项后，新节点以右键点对应的 flow 坐标为锚点创建，再复用宿主已有避碰逻辑。
- 菜单在点击外部、完成创建、按 `Escape` 或切换视图后关闭。

### 7.6 内嵌 `xterm` 跟随 VSCode 主题热更新

- 宿主层通过 `vscode.window.onDidChangeActiveColorTheme` 显式向当前活动 Webview 发送主题变更消息。
- Webview 不直接依赖扩展 API 提供颜色值，而是读取 VSCode Webview 注入到当前主题作用域中的 CSS token，并把这些 token 映射到 `xterm` 的 `theme` 对象。
- token 读取以 Webview `body` 的 computed style 为准；当 `terminal.background` 缺失时，按当前 surface 位置回退到 `panel.background` 或 `editor.background`，而不是回退到固定深色。
- ANSI 16 色缺失时，回退到 VSCode 官方终端默认调色板，而不是自定义一套仓库私有颜色。
- 主题切换不仅依赖宿主主题消息；当 Webview 实际的 class、dataset、style 或 head 中主题样式发生变化时，也会再次刷新所有现存 `xterm`。
- 主题切换时对所有现存 `xterm` 实例执行热更新，不销毁会话、不清空 scrollback，也不重建 `Terminal` 实例。

## 8. 验证方法

至少需要完成以下验证：

1. 在浏览器 harness 中验证标题栏双击能改变 viewport，且双击输入框不会触发聚焦。
2. 在浏览器 harness 中验证空白区右键菜单出现、选择后会发出 `webview/createDemoNode` 并带上靠近右键点的坐标。
3. 在真实 VSCode smoke 中验证默认 `openCanvas` 走 `panel` route。
4. 手动验证当用户把 `panel` view 移到 Secondary Sidebar 后，显式 `panel` 打开命令仍能正确 reveal 该 view。
5. 运行 `npm run typecheck`、`npm run test:webview`、`npm run test:smoke`。
6. 浏览器 harness 截图基线应能直接体现节点外轮廓与 minimap 的小圆角 widget 化收口。
7. 在浏览器 harness 中验证 `Agent` 与 `Terminal` 节点里的 `xterm` 会在不重建实例的前提下，随 VSCode 深浅主题切换一起刷新背景、前景与 ANSI 调色板。

## 9. 验证结果

- 2026-04-13 运行 `npm run typecheck`，通过。
- 2026-04-13 运行 `npm run test:webview`，23 个 Playwright 用例全部通过；其中新增覆盖 `body` 级 theme vars、同类主题切换、稀疏 `terminal.*` token 与当前 surface 背景 fallback，确认 `Agent` / `Terminal` 内嵌 `xterm` 不再只在少数主题下正确跟随。
- 2026-04-13 追加运行 `node scripts/run-playwright-webview.mjs --update-snapshots`，23 个 Playwright 用例全部通过；刷新主画布截图与 dark / light 两张 minimap 专用截图基线，确认“加深框外遮罩 + 适度压低 minimap 节点色块对抗性”的方案在浅色和深色 workbench token 下都能拉开视口内外区分，同时 `xterm` 主题跟随改动后的整体画布视觉基线已同步收口。
- 2026-04-13 运行 `npm run test:smoke`，通过；覆盖 trusted / restricted、real reopen、fake systemd-user / fallback 与 remote-ssh real reopen，确认默认 `Dev Session Canvas: 打开画布` 走 `panel` route。
- 2026-04-13 追加运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`，通过；真实验证 `Dark Modern` / `Light Modern` 在 `panel` 与 `editor` 两种 surface 下都能让内嵌 `xterm` 正确切换背景、前景与 ANSI 蓝色，并确认当主题缺失 `terminal.background` 时会按当前 surface 回退到 `panel.background` 或 `editor.background`。
- “用户手动把 view 拖到 Secondary Sidebar 后再 reveal” 这一工作台布局动作，本轮未单独脚本化自动化；当前仅确认扩展继续使用可移动 `WebviewView` / view container 路线，且所有文案都明确写为“位置由 VSCode 原生记住”，没有把它误写成固定底部 Panel。
