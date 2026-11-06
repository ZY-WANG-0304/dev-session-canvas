---
title: 分组等宽标题栏与统一操作
decision_status: 已选定
validation_status: 验证中
domains: [画布交互域, 协作对象域]
architecture_layers: [画布呈现层, 宿主集成层]
related_specs: [docs/product-specs/canvas-node-groups.md]
related_plans: [docs/exec-plans/completed/canvas-group-header-interactions.md]
updated_at: 2026-11-06
---

# 分组等宽标题栏与统一操作

## 背景与范围

按标题长度伸缩的 tab 和双段按钮缺乏稳定拖动区域。本次按用户方向替换此布局，适用于普通分组与 rootGroups 系统分组，不修改 paneGallery 自身 root 标签、分组状态模型或宿主几何。

## 正式方案

`canvasGroupFrameStyles.ts` 不再按字符数估算 tab 宽度；`styles.css` 的背景与交互标题栏始终覆盖分组全宽，保留 Panel 主题色、直角和缩放稳定边界。缩小时保持可读、放大时随画布放大，以 180px 基础宽度限制反向缩放。文字单行省略，选中和重命名不改变比例。正文上沿保持画布坐标 28px，标题向外增长，不改成员位置。

2026-11-06 根据实际截图微调：标题栏基础高度从 28px 增至 36px，删除按钮保持 24px，100% 缩放时上下各约 6px 留白（含边框），文字保持垂直居中。边框线宽不加粗；正文上沿仍为 28px，增加的高度向外扩展，不挤压组内节点。相同留白比例跟随标题栏缩放。

`canvasGroupLayers.tsx` 在选中普通分组标题栏右侧显示一个删除按钮，复用节点 `action-button danger compact` 样式（边框、背景、圆角、hover、focus），只按标题缩放调整尺寸。编辑图标仍位于文字尾部。workspace-root 标题只读、没有删除按钮；含 root 的外层普通组可取消分组但不能递归删除 roots。

点击只发 `webview/deleteGroup`。`CanvasPanelManager.deleteGroup` 对空组和非空组都显示原生 modal：首项保留内容，另一项递归删除节点和子分组；取消不改变状态和选择。保留分支不结束会话，递归删除沿用既有运行时清理、边清理与持久化流程。含 root 的外层组继续只提供保留 root 的选项。

拖动的明确解释：整个标题栏非按钮、非输入区域均可拖动，不要求先选中；首次 pointer down 选择并捕获指针，超过 3px 阈值才显示草稿，释放后提交。文字与空白一致，系统 root 也可拖动。普通点击仅选中，Ctrl/Cmd 点击切换选择而不移动，双击聚焦沿用候选移动取消逻辑。编辑和删除不触发拖动或聚焦；边框移动、8 向 resize、正文空白平移、边缘自动平移、失焦/指针取消回滚不变。

2026-11-06 root 标题拖动修复：`ChromeTitleEditor` 的只读分组标题使用与普通分组相同的文本展示行，不再暴露可聚焦的只读输入框。此前 `readOnly` 分支仍将输入框标记为交互控件，点击会进入输入焦点，标题文字和大部分空白因此被拖动准入排除。只读与 `groupTitleDragHandle` 同时成立时，输入框仅保留不可命中、不可 Tab 聚焦的尺寸基准，文本不允许原生文字选择；点击选择分组、首次拖动及选中后拖动、双击聚焦均交给标题栏，完整 root 路径 tooltip 和无改名入口保持不变。非分组只读节点的输入框与复制快捷键行为不变。

与最新主线的 Tab 停靠规则衔接：root 只读标题的文本自身保留 `tabIndex=0`（overview 除外）、聚焦选组与 `focus-visible` 主题描边，不以输入框承载键盘可达性。鼠标按下仍由标题栏捕获并阻止原生聚焦，不影响拖动；Tab / Shift+Tab 保留只读标题入口，并跳过隐藏的尺寸基准输入框。

首次选择会在右侧原空白区域挂载删除按钮。标题栏在 pointer down 捕获阶段识别该位置是否仍属于先前标题栏点击序列（沿用 700ms / 8px 容差）；匹配时由标题栏继续捕获指针并复用既有拖动/双击处理，不让新按钮接管第二击。正常按钮点击、键盘激活和编辑控件仍走各自动作，不通过延迟显示按钮或统一禁用按钮解决。第二次按下后若实际拖动，仍按拖动提交而不是提前聚焦。

删除按钮与节点动作一样阻止 keydown 向画布传播，但不阻止按钮原生默认动作，避免 React Flow 的 Space 平移监听吞掉空格激活；Enter 和 Space 均保留一次删除请求。

## 取舍与假设

不新增自绘 modal，避免重复宿主确认与焦点管理。空组也确认以保持一个入口的行为一致。保留内容作为默认选项，避免误删执行节点。“参考节点拖动”按首次拖动标题栏解释，不复制执行正文的交互。

## 验证

创建独立修复 PR 前，从已合并 #370 的旧主题切换到最新 `origin/main@30bc4999`（含 #372）。首轮相邻回归为 91/93：主线新增的 Tab / Shift+Tab 用例仍要求 root 只读标题可达，而最初修复仅移除了输入框停靠。补齐文本自身的 Tab 停靠、选组与可见焦点，并将原可达性断言指向文本、增加隐藏输入框排除检查；没有删除这两项测试或取消只读标题可达性要求。最终相同集合 93/93 通过（2.6m），日志 `/tmp/canvas5-root-title-pr-browser-final.log`；首轮日志 `/tmp/canvas5-root-title-pr-browser.log`。类型检查、stock 构建、分组几何、主题测试与文档检查通过，453 项浏览器目录的 ID / 文件 / 完整标题一致（不代表全量执行）。无关 OSC 研究及图片不进入本次提交；真实安装级验证边界不变。

2026-11-06 root 标题专项：将既有首次拖动用例的 root 命中点从标题栏左侧边距移到标题内容行，修前期望移动 90px、实际 0px，修后通过。既有 root 标题用例改为验证点击不聚焦输入框、没有改名入口、选中后拖动产生正确草稿与单次 move 消息、双击聚焦以及路径 tooltip；拖动草稿在释放前检查，释放后验证消息，不把未模拟的宿主回写当作已持久化。相关 Playwright 集合 `group|pane gallery|editing node titles|pressing Enter in the title|canvas focus navigation|workspace root watermark` 为 89/89 通过（2.3m），日志 `/tmp/canvas5-root-title-regression.log`；修前复现日志 `/tmp/canvas5-root-title-red.log`。`npm run typecheck`、显式 stock 构建、分组几何与主题测试、文档检查均通过。本次更新现有用例，不新增测试 ID；未执行全量浏览器或真实 VS Code 安装级验证。手动复核路径：rootGroups 模式下点击 root 标题文字或空白，再从同一区域拖动，确认不出现输入焦点框且 root 与成员一起移动，双击仍聚焦，标题不可改名。

双击误触修复后，分组、paneGallery 和相关标题回归共 78/78 通过；原复现四档缩放修前全部失败、修后全部通过。独立子代理复审确认 P2 关闭，并通过 7 项复现/按钮专项及 10 项捕获阶段隔离测试。新增测试已同步正式浏览器目录，438 项注册与实际列表一致（不代表全量执行）。

Playwright 相关回归 56/56 通过，覆盖浅色/深色主题、0.4/0.5/1/1.8 缩放、重命名和选择前后等宽、单按钮键盘操作、首次拖动、成员草稿、双击与取消回滚；宿主 mock 删除分支 9/9 通过。分组几何、主题、typecheck 与显式 stock 构建通过，默认原生构建缺少本地 execution assets。实际命令和结果见关联 ExecPlan。真实 VS Code 原生 modal、真实会话删除、远程与高对比主题未执行，已登记技术债，不声称已完成安装级验收。
