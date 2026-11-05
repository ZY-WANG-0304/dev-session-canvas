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

屏外焦点可达且可见；图层对齐、节点几何和缩放保持不变；可见目标不触发画布跳动。覆盖 rootGroups 和 paneGallery 交互实例，保留终端与正文的滚动、Tab 语义。不调整图层结构、Tab 顺序、键盘快捷键或缩略图交互。

## 候选方案与取舍

只给 focus 加 preventScroll 无法覆盖原生 Tab；只给 pane 设置 clip 会留下外层隐式滚动；scroll 后归零会闪跳且引入坐标补偿；共用 viewport 只避免相对错位，不能消除模型外滚动。采用不可滚动边界并显式导航，同时消除根因并保证键盘可用。

## 正式方案

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
