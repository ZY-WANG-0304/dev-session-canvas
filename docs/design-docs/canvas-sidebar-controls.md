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
updated_at: 2026-04-21
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
- 可以把创建对象、打开画布和重置状态收口成宿主级入口，减少画布固定 chrome。
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
  当前缓解：当前只把“必须要有 inline 输入框”的常用操作区交给 `WebviewView`，并明确限制它只承载打开、创建、恢复和 `include` / `exclude`；状态摘要仍然保持在原生 TreeView。

## 7. 当前结论

当前已选定以下路线，并已完成第一版实现：

### 7.1 画布只保留空间相关的常驻元素

- 画布内常驻角落 UI 收口为两类：
  - 左下角导航控件
  - 右下角全局定位控件
- 左上角和右上角不再承载说明、统计、创建和恢复入口。
- 画布上的长段辅助说明、更新时间和验证范围文案都不再常驻。

### 7.2 默认使用两个 sidebar section 组成宿主入口

- 默认在 VSCode 主侧栏提供一个 Dev Session Canvas 容器。
- 该容器当前收口为两个 section：
  - `概览`：继续使用原生 `TreeView` 展示画布状态摘要，并在标题行尾部提供一个设置快捷入口，直接跳转到本扩展设置。
  - `常用操作`：使用最小 `WebviewView` 承载三个高频操作按钮与 `include` / `exclude` 输入框。
- 这样既保留了大部分 sidebar 的原生结构，也把必须以内嵌输入框表达的交互隔离在最小范围内。

### 7.3 全局动作进入常用操作区，而不是树项大按钮或分散 toolbar

- `常用操作` section 统一承载：
  - 打开画布 / 定位画布
  - 创建节点
  - 重置画布状态
- 为了兼顾主路径可读性与高频回点效率，`常用操作` 的 view title 行尾部可补一排原生风格的 icon-only 快捷入口；它们只复用同一组动作，不引入新的语义或额外状态。
- `概览` 树项本身优先展示状态，不再承担动作入口职责。
- 这样可以避免把 TreeView 伪装成按钮墙，也避免把同一组操作拆散在 view title toolbar 与别处。

### 7.4 `include` / `exclude` 以最小 Webview 输入框展示

- `常用操作` section 内直接显示两个输入框：
  - `包含文件`
  - `排除文件`
- 输入框使用 VSCode 主题 token、输入框边框和最小按钮样式，尽量贴近宿主原生控件观感，不额外包裹卡片式 chrome。
- 输入框在 blur / Enter 时提交，右侧提供轻量清空入口。
- 过滤仍然只影响文件对象与自动边的显示投影，不会修改 `fileReferences`。
- 这是本轮唯一保留 `WebviewView` 的理由：扩展 API 没有提供可在 TreeView 中局部嵌入文本框的官方能力。

### 7.5 创建入口优先集中，而不是平铺四个常驻大按钮

- 第一版已把“创建对象”收口为一个稳定入口，再通过原生 QuickPick 选择 `Agent`、`Terminal`、`Note`。
- 这样可以避免侧栏一打开就被四个常驻动作按钮占满，也更符合“极简侧栏”的目标。
- 是否需要保留个别高频对象的快捷入口，留待后续人工验证与使用反馈再决定。

### 7.6 与现有正式文档的关系

- `docs/design-docs/canvas-feedback-polish.md` 中关于“顶角 panel 作为过渡态存在”的结论，已被本主题文档接管。
- 旧文档仍保留“空画布”“底角控件不受遮挡”“新增节点默认避碰”这三项结论，但不再作为画布外层 chrome 的当前有效来源。

### 7.7 当前实现边界

- Extension Host 当前提供一个原生侧栏容器，并在其中放置 `概览 TreeView` 与 `常用操作 WebviewView` 两个 section。
- Webview 顶部的左上角 hero 与右上角 actions panel 已移除，画布中只保留底角控件和节点本体。
- 当画布已在前台可见时，侧栏中的“创建节点”会通过 Host -> Webview 消息复用当前视口锚点；当画布尚未就绪时，宿主退回到默认锚点 + 避碰搜索。
- `常用操作` 区域当前是一个最小 `WebviewView`：内容区只承载三个高频按钮和两个输入框；对应的快捷 icon 按钮放在该 view 的标题行尾部，不承担状态摘要、选中详情或说明卡片。
- `概览` 视图标题行尾部额外提供一个 gear 按钮，作为进入扩展设置的稳定捷径，不把设置入口挤进状态树项本身。

## 8. 验证方法

至少需要完成以下验证，才能把当前实现从“验证中”推进到“已验证”：

1. 在 VSCode `Extension Development Host` 中手动验证 `概览 TreeView + 常用操作 WebviewView` 的结构、密度和交互是否仍然贴近常见 VSCode Sidebar，而没有长成新的 mini dashboard。
2. 手动验证画布在移除顶角 panel 后，左上角和右上角确实回归为空白工作面，而不是被替代性浮层继续占据。
3. 在窄编辑器宽度下对比新旧方案，确认画布顶部可用空间明显增加。
4. 在 workspace 未受信任场景下，确认侧栏能正确禁用或降级执行型入口。
5. 验证 `包含文件` / `排除文件` 输入框在输入、失焦、Enter、清空和 reload 后都保持稳定，且整体观感与 VSCode 输入控件 token 对齐。
6. 验证当用户折叠、移动或离开侧栏时，命令入口仍能完成打开画布、创建对象和重置状态。

## 9. 当前验证状态

- 2026-04-20 已按最新 UX 反馈进一步收口为“概览原生 TreeView + 常用操作最小 WebviewView”的混合侧栏。
- 自动化检查已完成：`npm run typecheck` 与 `npm run build` 通过。
- 当前尚未在 `Extension Development Host` 中完成这一轮人工验证，因此继续保持“验证中”。
