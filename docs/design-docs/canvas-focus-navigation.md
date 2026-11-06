---
title: 画布焦点导航与不可滚动边界
decision_status: 已选定
validation_status: 已验证
domains: [画布交互域]
architecture_layers: [画布呈现层]
related_specs: [docs/product-specs/canvas-node-groups.md]
related_plans: [docs/exec-plans/completed/canvas-focus-navigation.md]
updated_at: 2026-11-06
---

# 画布焦点导航与不可滚动边界

## 背景与问题

分组背景挂在 React Flow viewport 内，标签与控制点挂在 renderer 内并显式应用相同 transform。overflow:hidden 只隐藏滚动条，并不禁止焦点自动滚动。Tab 到屏外节点时，pane 滚动会移动节点与背景，前景不跟随，视口模型仍不变。

2026-11-04 的 0.28.0 隔离实验以原生 Tab 复现该路径，但未读取用户原现场 DOM，不能宣称旧截图唯一原因已确认。本次修复以当前源码回归为证。

## 目标与非目标

屏外焦点可达且可见；图层对齐、节点几何和缩放保持不变；可见目标不触发画布跳动。覆盖 rootGroups 和 paneGallery 交互实例，保留终端与正文的滚动、Tab 语义。不调整图层结构、键盘快捷键或缩略图交互；Tab 停靠范围按下述规则收口，不引入空间排序或节点内部导航模式。

## 候选方案与取舍

只给 focus 加 preventScroll 无法覆盖原生 Tab；只给 pane 设置 clip 会留下外层隐式滚动；scroll 后归零会闪跳且引入坐标补偿；共用 viewport 只避免相对错位，不能消除模型外滚动。采用不可滚动边界并显式导航，同时消除根因并保证键盘可用。

## 正式方案

### Tab 停靠范围

2026-11-06 用户确认：节点整体与内部控件均逐项参与原生 Tab / Shift+Tab；连线和只读标题继续参与。节点及分组的八个缩放手柄不参与，Note 预览容器本身不参与。`canvasNodeChrome.tsx`、`canvasGroupLayers.tsx` 的缩放按钮及 `fileNoteNodes.tsx` 的预览容器统一设置 `tabIndex={-1}`，不使用 disabled / inert 禁止鼠标交互，也不在全局拦截 Tab。

范围解释：预览内链接和任务复选框仍按“内部控件逐项参与”保留原生 Tab 停靠；这里只排除预览容器，不排除其子控件。预览仍可鼠标选择、双击进入编辑及程序化聚焦；正文编辑态仍以 Tab 缩进、Shift+Tab 反缩进，Agent / Terminal 保留终端键盘语义。此项不修复缩略图连线独立 focusable 配置，也不改变现有 DOM 顺序。

本轮验证：新增两项原生 Tab / Shift+Tab 回归，检查节点与分组八个手柄的 tabIndex、遍历时不落入手柄或预览容器，并确认节点整体、标题编辑按钮、删除按钮、预览内链接 / 复选框、连线与根分组只读标题可达，预览双击仍进入编辑。连同旧焦点导航、Note 缩进 / 选择 / 复选框、节点与分组鼠标缩放共 21 项通过；构建、类型检查、浏览器门禁合同定向 2 项通过，冻结目录与实际 435 项 ID / 文件 / 标题一致。验证范围为本地 Linux Chromium harness，未执行本轮完整浏览器集或远端 CI，不沿用旧 head 的远端结果作为本轮验收。

### 终端入口与输入焦点

按用户实机反馈补齐提示的可读性：字号从 11px 增为 13px，内边距从 4px / 8px 增为 8px / 12px；Enter 和 Tab 使用语义化 kbd 元素绘制带背景、边框与加厚底边的键帽，而非可点击 button。共用 TerminalEntryHint 渲染器与分段本地化文案，继续保留完整可访问描述；每组键帽和说明尽量同排，窄节点可在两组之间换行。提示仍位于正文中央，不新增焦点停靠点或鼠标拦截。本轮构建、类型检查和 7 项定向浏览器回归通过，入口用例新增字号、两枚键帽、底边厚度及无按钮 / tabindex 断言；中英文与窄节点完成独立截图和无溢出检查，原视觉基线未更新。验证仅限本地 Chromium，远端 CI 未执行。

提示位置采用用户选定的 C 方案：在终端正文区域中央显示紧凑浮层，不在底部铺满宽度，不改变正文布局或添加遮罩。`styles.css` 的 `.terminal-entry-hint` 以 terminal-frame 为定位容器，水平 / 垂直居中，宽度随文案且不超出容器；窄节点允许换行，pointer-events:none 保留点击正文直接进入。仅位置与尺寸变化，焦点与输入语义不变。位置调整后构建与 7 项定向浏览器回归通过：两类节点分别验证水平 / 垂直居中、紧凑宽度、点击提示中心穿透进入终端、原有导航 / 输入语义，另含三项原有视觉基线；没有更新截图基线。验证仅限本地 Chromium。

用户确认 Agent / Terminal 区分导航焦点与输入焦点，不新增键盘退出机制。`executionSessionNodes.tsx` 的 terminal-frame 作为原生 Tab 停靠点；仅当入口本身持有焦点时显示“Enter 进入终端 · Tab 继续导航”，以本地化可访问名称和描述表达入口用途。Tab / Shift+Tab 原生向前 / 向后导航，不进入 xterm。每次 terminal.open 后将 xterm textarea 的 tabIndex 设为 -1，仍允许鼠标与程序化 focus；缩略图、概览和删除隔离沿用现有 inert 边界，概览入口额外设为 tabIndex=-1。

只有入口本身收到无修饰键、非 IME 的 Enter 时才 preventDefault 并调用当前节点注册的 terminal.focus；进入这次 Enter 不发送给终端。入口仅阻止自身按键冒泡到画布，输入框冒泡的事件不在入口层拦截。鼠标点击正文继续直接进入输入，入口提示随焦点离开立即隐藏。输入状态下 Tab、Shift+Tab、Esc 与 Enter 均保持终端原有处理，不增加返回画布的按键或按钮；鼠标仍可转移焦点。只读历史 / 未运行终端保留已有内容聚焦能力，进入不启动会话、不改变输入权限或运行时状态。

验证：Agent / Terminal 各新增一项入口回归，覆盖原生双向 Tab、提示显隐、可访问名称 / 描述、导航态字符与修饰 / IME Enter 不进入、进入 Enter 不下发、进入后 Tab / Shift+Tab / Esc / Enter 原样透传且不退出，以及鼠标离开后再次 Tab 仍回到入口。原有两项终端 Tab 用例改用真实正文鼠标点击进入；概览用例额外核对入口 inert / tabIndex=-1。包括剪贴板、vi 输入、缩放 / 滚轮、旧焦点导航和三项视觉基线的定向集 37/37 通过；入口用例追加真实深色主题后复验 2/2 通过，中英文提示完成独立截图观察和可访问描述核验。本轮不修改 Note 的编辑或退出机制。

构建、类型检查、浏览器门禁合同定向 2/2 通过，冻结目录登记 437 项。初轮被字体覆盖断言拦截：新增“导”“航”不在测试子集中；按既有 generate.py、原源字体和固定工具版本重生成 WOFF / 字符清单 / 摘要后复验通过，没有放宽断言或更新 PNG 基线。上述仅为本地 Linux Chromium 验证，未执行完整功能集或本轮远端 CI，不宣称真实 VS Code 跨平台验收完成。

创建终端入口 PR 前复验：从已合并 PR #369 的最新 origin/main `92736f38` 建立 `canvas-terminal-entry-navigation`，仅携带本轮停靠范围与入口交互改动。最终键帽样式下构建、类型检查、上述 37 项定向浏览器回归、浏览器门禁合同定向 2 项及文档检查均通过；冻结目录与实际 437 项 ID / 文件 / 标题一致。远端 CI 和独立 review 待新 PR 执行，不复用旧 PR 的通过结论。

### 不可滚动边界与焦点可见性

`extensions/vscode/dev-session-canvas/src/webview/styles.css` 将 `.react-flow`、`.react-flow__renderer`、`.react-flow__pane` 统一设为 overflow:clip。仅根元素使用 !important 覆盖固定依赖写死的内联 overflow:hidden。不扩散到正文、xterm viewport、paneGallery 外层列表或缩略图滚动轨道。

新增同目录 `canvasFocusNavigation.tsx`，在 `main.tsx` 和 `paneGallerySurface.tsx` 的交互 React Flow 内挂载 `CanvasFocusNavigation`。仅订阅当前实例 focusin，处理 viewport 或分组前景中的真实焦点，排除 aria-hidden / inert 内容与固定控件。下一帧确认目标仍连接且仍为 activeElement，读取焦点矩形与实例边界：可见则不导航；屏外则保留 zoom，仅平移最小距离并留少量边距；超大目标按最近边界对齐，已经横跨整个可视区则不反复摇摆。

不调用 focus、不拦截键盘、不重置 scroll、不改变节点/分组位置和选择。正文与终端先完成内部原生焦点滚动，随后计算画布平移；隐藏测量层不作为导航目标。通过当前实例 setViewport 更新，并显式调用 onViewportCommit：rootGroups 接 persistCanvasViewport，paneGallery 接绑定 root 和 viewportRole 的 onSavePaneViewport。固定依赖对无 sourceEvent 的程序化导航不触发 onMoveEnd，不能依赖该事件完成保存。缩略图不挂载组件，其他 pane 不受影响。快速焦点切换和卸载取消旧帧任务。

## 验证与限制

2026-11-05：当前源码四项原生 Tab 场景修前均失败（40% 横向 pane 滚动 708px；100% 纵向滚动 600px），修后对齐、零 DOM 滚动、焦点可见、双向导航、zoom 与几何不变通过。十项新用例另覆盖分组标题、可见与固定控件、隐藏测量输入、快速焦点切换、正文原生滚动/缩进、Agent/Terminal Tab 输入、pane 隔离与视口保存，最终连续两轮 20/20 通过。

定向与相邻集合 29/29 通过，覆盖概览隐藏控件、正文滚动恢复、vi 输入、终端滚轮、缩放下 xterm textarea、分组拖动缩放、缩略图滚动与主 pane 视口恢复。构建、类型检查、分组脚本通过，432 项浏览器目录与真实列表一致。验证范围是 Linux Chromium harness，不替代全部浏览器用例或跨平台真实 VS Code 安装验收。

额外完整门禁合同为 131/132：范围外 `a successful parent with a residual process group still fails and retires its child` 在 residualGroup 断言失败，原失败保留并登记技术债；选测合同 23/23、浏览器合同定向 2/2 通过不能代替完整合同结果。

2026-11-06 创建 PR 前复核：已无冲突 rebase 到 origin/main `cdca3297`；rebase 后类型检查、构建和十项焦点回归通过。浏览器目录含主线新增用例，重新核对 433 项真实 ID 一致。此前 432 项目录与完整合同失败均属于原验证输入，不以本次定向复验覆盖。

PR #369 首轮 CI（run `42060940222` / attempt 1）功能集 429/430：旧节点标题双击用例失败，另两个红灯是 verify-result 和最终契约检查的连带拒绝。本地复现确认视口移动来自进入屏外标题编辑时的 focus，而双击自身不移动，三层 DOM scroll 保持零。该用例必须先独立验证焦点导航完成，再以此时的视口为双击前基线；不得禁止正常屏外导航、跳过用例或放宽双击后的精确相等断言。本轮仅调整测试，将最终双击改为目标可见后的真实鼠标操作，继续精确核对持久化视口、DOM transform、zoom、焦点与三层零滚动。

2026-11-06 跟进验证：原失败用例和十项焦点回归 11/11 通过，与 CI 同筛选范围的完整功能集 430/430 通过（无功能用例跳过或重试）；类型、构建、文档检查及 433 项目录身份一致性通过。本地本轮不包含三项视觉用例，也不代替新 head 的跨平台远端验收。历史 CI 失败保留，新一轮结果待运行。
