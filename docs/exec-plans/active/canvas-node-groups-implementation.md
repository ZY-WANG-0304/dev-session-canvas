# 实现画布节点分组

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循 `docs/PLANS.md` 的要求，目标是让一个不了解前序讨论的协作者也能从当前工作树继续完成分组功能实现。

## 目标与全局图景

本次实现让用户可以在 DevSessionCanvas 无限画布上创建可见分组框，把 `Agent`、`Terminal`、`Note` 或子分组归入同一组，拖动或 resize 分组，并在宿主状态里持久化分组标题、位置、尺寸和成员关系。分组是空间组织对象，不是执行节点；它不启动进程、不承载连线，也不改变成员节点原有能力。

当前里程碑交付的是“首版基础路径”：空白区右键创建空分组、从多选对象创建分组、分组标题编辑、分组拖动 / resize 草稿、拖动节点或分组后按鼠标释放位置重新归属、取消分组、删除分组确认、模板保存 / 应用基础映射，以及侧栏节点列表默认按分组树展示、VSCode 原生更多菜单与可折叠分组树。用户可以通过 Webview harness 看到分组框、重命名标题、右键创建和多选创建分组；通过宿主测试可以验证分组移动子树、resize 纳入 / 移出、空分组保留和 `file` / `file-list` 不持久入组。

## 进度

- [x] (2026-05-21 17:01Z) 已完成设计阶段文档，推荐 `CanvasGroupSummary + CanvasNodeSummary.groupId`，并把拖动 / resize 规则收敛为基础法则。
- [x] (2026-05-21 17:08Z) 已从 `origin/main` rebase 当前分支，命令 `git fetch origin main && git rebase origin/main` 成功。
- [x] (2026-05-21 17:15Z) 创建实现阶段 ExecPlan，记录目标、上下文、工作计划和验证方案。
- [x] (2026-05-22 15:35Z) 重新执行 `git fetch origin main && git rebase --autostash origin/main`；当前分支已经基于 `origin/main`，autostash 已恢复。
- [x] (2026-05-22 15:40Z) 完成共享协议与持久化状态：新增 `CanvasGroupSummary`、节点 `groupId`、`CanvasPrototypeState.groups`、`nextGroupSequence`、分组消息解析，并保持旧状态 normalize 安全。
- [x] (2026-05-22 15:44Z) 完成宿主基础行为：空分组、从选择创建分组、标题更新、节点拖拽归属、分组移动子树、分组 resize 纳入 / 移出、取消分组、删除分组二选一、节点删除保留空组、模板物化 group ID 映射。
- [x] (2026-05-22 15:46Z) 完成 Webview 基础 UI：分组 frame、标题编辑、选中工具栏、右键创建空分组、从多选创建分组、分组拖动 / resize draft、释放后向宿主提交。
- [x] (2026-05-22 15:49Z) 完成侧栏节点列表显示模式基础入口，默认按分组树展示并提供平铺展示与按分组树展示选项；该选项只影响侧栏呈现，不改变画布分组状态。
- [x] (2026-05-22 15:50Z) 补充自动化测试入口：协议消息测试、模板 capture 测试、宿主 group helper 测试、Webview Playwright 分组渲染 / 重命名 / 右键创建 / 从选择创建测试。
- [x] (2026-05-22 17:08Z) 修正分组拖动释放意图：Webview 提交 `webview/moveGroup` 时使用实际鼠标释放位置，而不是分组中心点，保持“拖拽意图载体是鼠标释放位置”。
- [x] (2026-05-22 17:17Z) 完成本轮验证：`npm run typecheck`、协议消息测试、模板测试、`npm run test:canvas-node-groups`、`npm run build` 和 3 条 Webview 分组 Playwright 用例均通过。
- [x] (2026-05-22 17:17Z) 更新实现阶段 ExecPlan 的验证证据、意外发现和结果复盘。
- [x] (2026-05-23 02:54Z) 完成首轮交互调整：普通点击节点恢复单选，Ctrl / Cmd 点击才增删多选；多选节点拖动通过 `selectedMoves` 把所有被选目标的最终位置发给宿主；分组拖动靠近画布边缘时自动平移 viewport；节点拖入分组时按整体簇避让已有同组节点。
- [x] (2026-05-23 03:43Z) 修正分组入口 icon 口径：创建空分组入口使用 `symbol-array`；从选择创建分组入口恢复为 `group-by-ref-type`。
- [x] (2026-05-23 03:25Z) 完成本轮最终验证：`npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates`、`npm run test:canvas-node-groups`、`npm run build`、4 条 Webview 分组 Playwright 用例和 `git diff --check` 均通过。
- [x] (2026-05-23 03:43Z) 完成本次 icon 修正验证：`npm run build`、2 条 Webview 分组入口 Playwright 用例和 `git diff --check` 均通过。
- [x] (2026-05-23 04:07Z) 修正多选节点移动释放点语义：多选节点作为临时整体移动，所有被选节点共用主鼠标释放位置作为归属意图。
- [x] (2026-05-23 04:07Z) 完成本次多选释放点修正验证：`npm run typecheck`、`npm run test:canvas-node-groups`、`npm run build`、Webview 多选拖动 Playwright 用例和 `git diff --check` 均通过。
- [x] (2026-05-23 04:30Z) 调整删除空分组行为：空分组没有直接成员节点且没有直接子分组，删除时跳过确认并直接删除；非空分组仍保留二选一确认。
- [x] (2026-05-23 04:30Z) 完成本次删除空分组修正验证：`npm run typecheck`、`npm run test:canvas-node-groups`、`npm run build` 和 `git diff --check` 均通过。
- [x] (2026-05-23 06:48Z) 修正基础法则与当前交互设计边界：节点入组避让从合法状态法则中移出；修复目标集合内部既有几何关系保护归入最小合法修复法则，并泛化命名到所有修复目标。
- [x] (2026-05-23 06:48Z) 完成本次法则边界修正验证：`npm run typecheck`、`npm run test:canvas-node-groups` 和 `git diff --check` 均通过。
- [x] (2026-05-23 07:30Z) 将同父级非法几何收口从逐个向右挤开改为四向 spread repair：在上、下、左、右候选方向中选择能恢复合法状态且代价较小的方案，保留 pinned 用户结果，并补充左右与上下插入分组测试。
- [x] (2026-05-23 07:30Z) 完成本次四向挤开验证：`npm run typecheck` 和 `npm run test:canvas-node-groups` 均通过。
- [x] (2026-05-23 07:45Z) 复核 resize 释放边界语义：补充“释放边界内完整包含的同父分组纳入、释放边界交叉分组挤走但不纳入”和“resize 边界压入子分组后子分组移出”的宿主回归测试。
- [x] (2026-05-23 08:00Z) 修正 resize 对节点的边界意图：释放边界完整包含的同父稳定节点会加入被 resize 分组；不稳定的 `file` / `file-list` 节点仍不建立稳定成员关系；直接成员节点不再被释放边界完整包含时提升到父级。
- [x] (2026-05-23 08:00Z) 完成本次 resize 节点归属验证：`npm run test:canvas-node-groups` 通过。
- [x] (2026-05-23 10:20Z) 完成分组八向 resize：Webview 分组框提供上、下、左、右和四个角 resize 手柄，左 / 上方向 resize 会同步提交新的 `position` 与 `size`。
- [x] (2026-05-23 10:20Z) 完成本次八向 resize 定向验证：`npm run typecheck`、`npm run build`、`node scripts/test/run-playwright-webview.mjs -g "canvas groups resize from all eight directions"` 均通过。
- [x] (2026-05-23 14:24Z) 修正分组 resize 草稿语义：resize 过程中只调整被 resize 分组边界，不再把直接成员节点或子分组当作移动子树跟随；拖动分组仍保持整棵子树跟随移动。
- [x] (2026-05-23 15:13Z) 修正节点入组避让可见性：节点拖拽或 resize 提交给宿主后，Webview 在下一次宿主状态更新时清理已提交的本地节点布局 draft，避免旧 draft 覆盖宿主返回的避让后坐标。
- [x] (2026-05-23 15:13Z) 完成本次节点入组避让可见性验证：`npm run test:canvas-node-groups`、`npm run typecheck`、`npm run build`、`npx playwright test --config=playwright.config.mjs tests/playwright/webview-harness.spec.mjs --grep "node group drop applies"` 均通过。
- [x] (2026-05-23 18:43Z) 按 resize 边缘调研结论补齐节点 resize 与分组 resize 的画布边缘自动平移：节点 resize 改为 Webview 自定义 8 向控制点，节点 / 分组 resize 过程都会把视口平移折算进本次 resize 草稿，释放后仍只提交一次宿主权威消息。
- [x] (2026-05-26 01:02Z) 修正 Panel 风格分组背景层级：分组 body 的 `--vscode-panel-background` 实心背景改为渲染在 React Flow viewport 内且位于普通节点下方；标题、边框、toolbar 和 resize 控制点由独立 foreground 层负责命中。
- [x] (2026-05-26 01:31Z) 收敛分组选中 chrome：标题 tab 之外的顶部横向区域改为挖空透明，分组 resize UI 改为与节点一致的四边选中线和四角圆形控制点，分组边框与选中线按 viewport zoom 做反向缩放以保持屏幕可见线宽不变。
- [x] (2026-05-26 02:10Z) 修正 Panel 分组直角与 body 边界：标题 tab / body 改为直角，body 顶部恢复 panel 边框；宿主成员容纳 inset 的顶部额外计入标题高度，使节点相对 body 上、左、右、下边界的视觉预留一致。
- [x] (2026-05-26 02:18Z) 去除分组选中时 tab 区域 active 下划线，选中态保留四边 resize 线、四角控制点、标题文字前景和 toolbar。
- [x] (2026-05-26 02:35Z) 将选中分组操作从右上角双按钮改为贴在标题 tab 右侧的双段按钮：左段取消分组，右段执行删除分组。
- [x] (2026-05-26 03:20Z) 修正侧栏节点列表显示模式入口：移除 Webview 内自绘更多按钮，改由 `节点` view 标题右上角 VSCode 原生 `...` 菜单切换平铺 / 按分组树展示，默认使用按分组树展示；按分组树展示改成可折叠的分组 section 和“未分组”section。
- [x] (2026-05-26 10:55Z) 完成本轮 sidebar 验证：`npm run typecheck`、`node scripts/test/test-extension-manifest.mjs`、`npm run test:sidebar-list-colors`、`npm run build` 和 `git diff --check` 均通过；`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 已覆盖侧栏分组树路径，但随后在既有 Note Markdown 文件关联用例中超时，暂不作为本轮 sidebar blocker。
- [x] (2026-05-27 16:40 +0800) 处理 PR review：模板应用改为两阶段预分配 template group id，支持 `parentGroupIndex` 指向后方父分组；命令面板补齐“创建空分组”和“从选中项创建分组”，不增加快捷键。
- [x] (2026-05-27 17:40 +0800) 处理第二轮 PR review：模板解析拒绝越界和循环 `parentGroupIndex`，模板应用兜底切断循环父链；删除非空分组确认文案改为明确递归删除内部所有节点与子分组，并补充嵌套删除确认 smoke 覆盖。
- [x] (2026-05-28 11:20 +0800) 处理第三轮 review：Webview 支持 Ctrl / Cmd 多选同级分组并从选中分组创建外层分组；模板解析补齐节点 `groupIndex` 越界拒绝和分组 self-parent 拒绝。
- [x] (2026-05-30 07:40 +0800) 处理分组缩放滚动条与拖动回归：分组 foreground 从 canvas shell portal 改为 `.react-flow__renderer` portal，React Flow wrapper / renderer / pane 明确裁切溢出，并给 foreground frame 增加 `nodrag nopan` 防止分组拖动被 pane 同时解释为画布 pan。
- [ ] 继续完善删除分组对话框保留成员分支的自动化覆盖、真实 VSCode reload smoke、侧栏分组树 UI smoke，以及更完整的几何合法状态证明。
- [ ] 按 `docs/workflows/COMMIT.md` 提交本次分组实现。

## 意外与发现

- 观察：当前设计明确“直接成员节点与直接子 group 不交叉”是硬不变量，不是交互建议。
  证据：`docs/product-specs/canvas-node-groups.md` 第 3.1 节合法状态法则。

- 观察：早期把 group foreground portal 到 canvas shell 可以绕开 pane 命中，但会在画布放大后扩大 document / Webview scroll area；foreground 现在必须挂到 `.react-flow__renderer` 并接受 React Flow 裁切边界。
  证据：PR #102 的 Webview 回归在 640x520 viewport、1.8x zoom 下复现外层滚动条风险；修复后 `CanvasGroupsViewportLayer` 把 foreground portal 指向 `.react-flow__renderer`，并断言 document / shell scroll 尺寸不超过 client 尺寸。

- 观察：如果只从现有 `group-*` ID 推导下一个编号，删除 `Group 2` 后再次创建会复用编号；这与产品确认“删除后不主动复用旧编号”冲突。
  证据：实现中新增 `CanvasPrototypeState.nextGroupSequence`，旧状态缺失时才根据现有 group ID 前缀推导，正常创建和模板物化都会推进序号。

- 观察：当前宿主几何收口是可验证的基础实现，不是完整几何证明器。
  证据：`finalizeCanvasGroupState` 会 normalize 成员关系、扩容父组、用四向 spread repair 挤走同父交叉 group、处理直接成员节点与直接子 group 交叉；但复杂多层交叉的全局最优没有在本里程碑证明。

- 观察：React Flow 与 Note preview 的交互会重置多选状态，普通 Ctrl / Meta 点击 Note 预览时容易被节点内部 `data-node-interactive` 与 React Flow selection change 共同覆盖。
  证据：`tests/playwright/webview-harness.spec.mjs` 的 “canvas context menu can create a group from selected nodes” 初始失败；修复后通过 `CanvasNodeInteractionBoundary` 的 `onPointerDownCapture` 在非真实交互控件上先处理 modifier selection，并让 `.note-markdown-preview` 可参与多选。

- 观察：分组拖动必须把实际鼠标释放点传给宿主，不能用分组中心点代替，否则标题栏 / 边框拖动会把“入组意图”错误偏移到对象中心。
  证据：`CanvasGroupFrame` 现在在 pointer down 时记录鼠标相对分组框的偏移量，并在 pointer up 时用 `释放后分组位置 + 偏移量` 作为 `pointerPosition`。

- 观察：React Flow 默认会在普通节点点击和拖拽开始时维护自己的多选状态；如果只在 `onNodeClick` 里追加多选，普通点击会把多选误保留。
  证据：本轮将 React Flow 的 `multiSelectionKeyCode` 置空并用 Webview 本地 `Ctrl / Cmd` 点击切换选择，普通点击统一写回单选；Playwright 用例补充再次 Ctrl / Cmd 点击取消选择和普通点击回退单选。

- 观察：React Flow 内置 `NodeResizer` 不能直接满足 resize 边缘自动平移。
  证据：auto-pan 改变 viewport 后，内置 resizer 的内部几何计算无法稳定把视口平移折算为同一次 resize 位移；本轮改为 `NodeResizeAffordance` 自己计算 8 向 resize 草稿，并通过 window-level pointer / mouse 事件兜底，保证鼠标停在边缘时尺寸继续增长。

- 观察：多选节点同时移动时，这批节点应被理解为本次移动的临时整体，不能为每个节点按相对位置推导不同归属释放点。
  证据：`webview/moveNode` 保留 `selectedMoves` 传递每个被选节点的最终位置，但所有被选节点的 `pointerPosition` 均使用主鼠标释放位置；Webview 测试覆盖该消息。

- 观察：节点入组避让是当前交互设计，不属于合法状态法则；但修复目标集合内部既有几何关系保护属于最小合法修复的一部分，且不应只针对移入节点。
  证据：`adjustMovedNodesAfterGroupDrop` 当前仍按交互设计在入组目标变化时把本次移动节点作为整体簇平移避让已有同组节点；底层 helper 已改名为 `preserveRepairTargetClusterWhileAvoidingSiblings`，宿主测试覆盖任意修复目标集合保持相对间距、原有重叠关系和原有非重叠关系。

- 观察：同父级非法几何收口不能固定为逐个向右挤开；插入对象位于左右或上下兄弟之间时，应允许兄弟分别向两侧或上下方向被挤开。
  证据：`repairCanvasGroupGeometry` 现在按同父级集合构造四向候选修复，`scripts/test/test-canvas-node-groups.mjs` 覆盖左右兄弟之间插入新分组会左/右挤开、上下兄弟之间插入新分组会上/下挤开。

- 观察：四向挤开修复不能改变 resize 释放边界本身表达的归属意图。
  证据：`scripts/test/test-canvas-node-groups.mjs` 覆盖 resize 释放边界内完整包含的同父稳定节点和同父分组被纳入，释放边界仅交叉的同父节点 / 分组仍留在原父级或被挤开但不被纳入；也覆盖 resize 边界移动到直接成员节点 / 子分组内部时，它们从父分组移出。

- 观察：分组自定义 overlay 的可命中 body 仍应保持不阻挡节点，因此八向 resize 只能把边 / 角控制点设为 pointer target，不能让整个分组框接管 pointer events。
  证据：`CanvasGroupFrame` 继续保持 `.canvas-group-frame` 和 `.canvas-group-body` 不接管 pointer events；选中时新增 8 个 `.canvas-group-resize-control` 透明命中区分别承担 resize 命中，并用 4 条 `.canvas-group-resize-line` 和四角圆点表达选中态。

- 观察：Webview 分组草稿里的 `position` 既可能来自移动，也可能来自左 / 上方向 resize；不能仅凭 `draft.position` 推断“整棵子树正在移动”。
  证据：`applyCanvasGroupDrafts` 现在只把不含 `size` 且 position 真的变化的草稿视为移动草稿；含 `size` 的 resize 草稿只改变分组框边界，成员节点和子分组在释放前保持原位。

- 观察：节点入组避让在宿主中已经计算，但 Webview 可能继续用 React Flow 拖拽产生的本地 `nodeLayoutDrafts` 覆盖宿主返回的避让后位置。
  证据：新增 Playwright 回归用例先把节点拖到已有组内节点上，再模拟宿主返回避让后的 `host/stateUpdated`；修复后 Webview 会清理已提交节点的 draft，显示宿主坐标，而不是继续显示鼠标释放处的重叠位置。

- 观察：把分组 Panel body 背景直接画在 foreground 交互层上，会让该实心背景位于 React Flow 普通节点之上并视觉遮盖成员节点。
  证据：背景 frame 单独 portal 到 `.react-flow__viewport`，设置在节点层下方；foreground frame 改为透明，仅标题、边框、toolbar 和 resize 控制点继续在 `.react-flow__renderer` 命中。Webview 用例断言背景与节点共享 viewport、背景层 `z-index = -1`、foreground frame 背景透明且与 pane 同处 renderer。

- 观察：分组 foreground 与背景层都跟随 React Flow viewport scale；如果仍使用固定 CSS `1px` border，缩放后屏幕可见线宽会跟着变细或变粗。
  证据：分组背景层和 foreground 层都写入 `--canvas-group-border-width = 1px / zoom`、`--canvas-group-resize-line-width = 2px / zoom`；新增 Webview 用例在 `zoom = 0.5` 时断言 CSS border 变为 `2px`、选中线变为 `4px`，从而经过 viewport scale 后仍显示为 1px / 2px。

- 观察：分组标题 tab 不是成员可用 body 区域的一部分；若宿主仍按完整分组矩形顶部只留 28px padding，节点视觉上会贴住 body 上边界。
  证据：成员容纳 inset 的顶部改为 `CANVAS_GROUP_PADDING + CANVAS_GROUP_TITLE_HEIGHT`，创建分组和父级扩容都使用非对称 inset；宿主测试新增成员四边 inset 断言，Webview 测试断言成员节点距离 body 上边界至少 28px。

- 观察：模板保存会保留当前 `state.groups` 顺序，而从已有分组和同级对象创建外层分组时，新父分组可能排在子分组之后。
  证据：PR review 指出 `applyCanvasTemplateToState` 边遍历边解析 `parentGroupIndex` 会让 child-before-parent 模板丢失嵌套关系；本轮改为先为所有 template group 分配 id，再物化 `parentGroupId`，并用宿主测试覆盖 forward `parentGroupIndex`。

- 观察：外部导入模板不能信任 `parentGroupIndex` 只会形成森林；解析和应用两层都需要防止循环父链。
  证据：第二轮 PR review 用 `groups[0].parentGroupIndex = 1`、`groups[1].parentGroupIndex = 0` 复现循环 group graph；本轮在 `parseCanvasTemplateDocument` 中拒绝越界和循环父索引，并在 `applyCanvasTemplateToState` 中对内存模板做兜底 sanitization，测试覆盖 parse 拒绝和 apply 切断循环。

- 观察：删除父分组的危险选项实际递归删除整棵分组子树，确认文案必须披露子分组、节点数量和执行节点清理风险。
  证据：第二轮 PR review 指出旧文案只说“内部节点”；本轮确认对话框标题和 detail 改为“内部所有节点与子分组”并展示递归计数，VS Code smoke 覆盖嵌套分组删除确认。

- 观察：从选中项创建分组已经支持 `groupIds`，但 Webview 必须提供分组多选入口，否则同级分组创建外层分组的规格路径不可达。
  证据：第三轮 PR review 指出分组选中入口只会覆盖为单个 `selectedGroupIds`；本轮让 Ctrl / Cmd 点击分组标题 / 边框 / body 空白区切换分组选中，并用 Playwright 覆盖两个同级分组右键创建外层分组消息。

- 观察：外部模板节点 `groupIndex` 和分组 `parentGroupIndex` 都属于结构引用，不能静默降级。
  证据：第三轮 PR review 指出越界节点 `groupIndex` 会在应用时静默变成未分组，self-parent 会在解析时静默变根分组；本轮解析阶段直接拒绝这两类坏模板，并补充模板测试。

## 决策记录

- 决策：实现阶段以宿主为分组权威状态中心，Webview 只展示 draft 并回传用户意图。
  理由：现有架构规定 `CanvasPanelManager` 是 workspace 绑定画布状态的唯一权威入口；分组合法状态需要结合所有节点和 group 统一收口，不能分散在 Webview 本地。
  日期/作者：2026-05-21 / Codex

- 决策：先实现可持久化 group frame 与核心宿主状态，再补复杂几何收口和 UI polish。
  理由：分组跨共享协议、宿主、Webview、模板和测试，增量实现能保持类型检查和现有节点能力可用，避免一次性改动过大。
  日期/作者：2026-05-21 / Codex

- 决策：新增 `nextGroupSequence` 作为分组独立序号队列的持久字段，并保持 `CanvasPrototypeState.version = 1`。
  理由：产品要求分组标题编号与节点编号队列分离，且删除后不主动复用；单靠现有 group ID 推导无法在删除后保留历史最大序号。旧状态缺字段时可安全推导，不需要提升状态版本。
  日期/作者：2026-05-22 / Codex

- 决策：分组 resize 与节点 resize 对齐为 8 个方向，但仍使用现有自定义 group frame，而不是迁移到 React Flow `NodeResizer`。
  理由：分组不是 React Flow node，当前 overlay 方案能保持节点绝对坐标和 body 不阻挡成员节点；只需在 Webview 计算左 / 上方向 resize 后的新 `position + size` 并交给宿主现有 `resizeGroup` 收口。
  日期/作者：2026-05-23 / Codex

- 决策：group foreground layer 使用 portal 到 React Flow `.react-flow__renderer`，不再 portal 到 canvas shell，也不迁移为 React Flow 自定义节点。
  理由：方案 B 保持 group 不是 `CanvasNodeKind`；renderer portal 仍可让标题、边框、toolbar 和 resize 控制点位于 pane 同层命中，同时共享 React Flow wrapper / renderer / pane 的裁切边界，避免 canvas shell portal 在放大画布时扩大 document / Webview scroll area。foreground frame 必须带 `nodrag nopan`，防止分组拖动冒泡后被 React Flow pane 同时解释为画布平移。
  日期/作者：2026-05-30 / Codex

- 决策：分组拆成“背景层”和“foreground 交互层”两层渲染。
  理由：产品要求 body 背景使用 `--vscode-panel-background`，但分组 body 不能盖住成员节点。背景层挂载到 `.react-flow__viewport` 并位于普通节点下方；foreground 交互层挂载到 `.react-flow__renderer`，让标题、边框、toolbar 和 resize 控制点保持命中能力，同时不突破 React Flow 的 overflow 裁切。
  日期/作者：2026-05-30 / Codex

- 决策：分组 resize 视觉复用节点 resize affordance 的结构语言。
  理由：用户要求分组选中后的 resize UI 与节点对齐；因此不再显示 VSCode Panel 小方块手柄，改为选中后显示四边线、透明命中区和四角圆形控制点，同时保留分组 8 向 resize 能力。
  日期/作者：2026-05-26 / Codex

- 决策：侧栏节点列表默认按分组树展示，显示模式入口使用 VSCode 原生 view title `...` secondary menu；按分组树展示提供可折叠的侧栏 section，但不持久化侧栏折叠状态为画布分组事实。
  理由：用户明确指出更多按钮应采用 VSCode 原生更多菜单；同时截图要求每个分组在侧栏中像 worktree / repository section 一样可折叠。该折叠只影响侧栏呈现，不改变“画布分组本身不支持折叠”的产品边界。
  日期/作者：2026-05-26 / Codex

- 决策：命令面板补充两个分组入口，其中创建空分组在当前可视中心创建默认 `360 x 240` 分组，从选中项创建分组则由宿主发 `host/requestCreateGroupFromSelection`，Webview 按当前本地选择回传既有 `webview/createGroupFromSelection`；若当前选择不满足创建条件，则 Webview 显示临时错误提示且不提交空创建请求。
  理由：空分组命令没有鼠标锚点，使用可视中心符合命令面板语义；选择状态属于 Webview 本地 UI 状态，宿主不应额外复制一份易漂移的选择缓存；无效选择不应制造一次被宿主拒绝的空状态更新。
  日期/作者：2026-05-27 / Codex

- 决策：本轮节点多选只响应 Ctrl / Cmd 点击，不再把普通点击或 Shift 点击当作追加多选入口。
  理由：用户明确要求“按住 cmd/ctrl 点击节点才是选择多个节点，普通点击节点回退到之前功能”；Shift 在当前画布还承载其他语义，不作为分组首版多选确认路径。
  日期/作者：2026-05-23 / Codex

- 决策：当前交互设计中，节点拖入分组后的重叠避让只移动本次被拖入的节点簇；基础法则层面，最小合法修复涉及多个修复目标时，应把修复目标集合内部的相对位置和原有重叠 / 非重叠关系作为通用约束。
  理由：用户结果优先要求保留拖动对象整体意图；同时基础法则不能把“移入节点”写死为唯一修复目标，后续其他修复也应避免把原本重叠的修复目标拆开或把原本不重叠的修复目标压成重叠。
  日期/作者：2026-05-23 / Codex

- 决策：同父级交叉消解使用四向 spread repair，不固定向右挤开。
  理由：挤开应表达“从冲突中心散开”，而不是固定单方向平移；当新对象位于左右或上下兄弟之间时，分别向两侧或上下挤开更符合最小合法修复和用户结果优先。
  日期/作者：2026-05-23 / Codex

## 结果与复盘

当前工作已经从文档设计推进到首版基础实现。代码层新增了共享 group 协议、宿主持久化与几何收口、Webview group frame 与上下文入口、命令面板补充入口、模板 group capture / materialize、侧栏原生更多菜单和可折叠分组树，以及对应的协议、宿主、模板和 Playwright 测试。设计文档已经把方案 B 从“比较中”收口为“已选定”，验证状态保持“验证中”。

2026-05-22 本轮验证已经覆盖类型检查、协议解析、模板捕获、宿主 group helper 和 Webview harness 的分组主路径。验证命令均在仓库根目录执行并通过。设计文档仍保持“验证中”，因为这些命令证明首版基础路径可用，但还不能替代真实 VSCode reload smoke、删除 modal 两种分支验证、侧栏 grouped view smoke 或完整几何场景矩阵。

剩余缺口包括：删除分组 modal 的保留成员分支还缺自动化断言；真实 VSCode reload 后 group 恢复还没有本轮 smoke 证据；几何收口覆盖的是基础路径而非完整证明。后续协作者应优先补这些缺口，再把验证状态推进到“已验证”。

2026-05-30 PR #102 修正分组 foreground 挂载层级后，当前正式口径是：背景 body 在 `.react-flow__viewport` 的节点下方，foreground 交互 chrome 在 `.react-flow__renderer` 内并带 `nodrag nopan`，React Flow wrapper / renderer / pane 负责裁切溢出；不要再按旧记录把 foreground 改回 canvas shell portal。

## 上下文与定向

DevSessionCanvas 是 VSCode workspace extension。`src/common/protocol.ts` 定义跨宿主和 Webview 的共享状态与消息；`CanvasPrototypeState` 保存 `nodes`、`edges`、`groups`、`nextGroupSequence`、文件引用和文件活动状态。`src/panel/CanvasPanelManager.ts` 是宿主权威状态中心，负责节点创建、移动、resize、删除、持久化和向 Webview 广播状态。`src/webview/main.tsx` 使用 React Flow 渲染画布和节点，维护局部选中态、拖动 UI、节点标题编辑、分组 frame 和上下文菜单。`src/webview/styles.css` 定义节点、连线、菜单和分组样式。`src/common/canvasTemplates.ts` 保存和应用模板。`src/sidebar/CanvasSidebarNodeListView.ts` 渲染侧栏节点列表。

本计划使用以下普通术语：group 指画布分组框；直接成员节点指 `groupId` 指向该 group 的节点；直接子 group 指 `parentGroupId` 指向该 group 的 group；根级对象指没有父 group 的节点或 group；合法状态指 group 无环、对象最多一个直接父 group、同级 group 不交叉、直接成员节点与直接子 group 不交叉、直接子 group 之间不交叉、成员视觉上被所属 group 完整容纳。

实现必须遵守产品规格 `docs/product-specs/canvas-node-groups.md` 和设计文档 `docs/design-docs/canvas-node-groups.md`。如果实现中发现文档和代码现状冲突，先在本计划的“意外与发现”和“决策记录”中写清楚，再同步正式设计文档或产品规格。

## 工作计划

第一阶段已经完成：阅读现有 `CanvasNodeSummary`、`CanvasPanelManager` 的 `moveNode` / `resizeNode` / `deleteNode`、Webview 消息分发、React Flow 节点拖动和标题编辑组件。确认现有节点坐标是绝对坐标，标题编辑可复用 `ChromeTitleEditor`，Playwright harness 加载的是 `dist/webview.js`，因此跑 Webview 测试前必须先 `npm run build`。

第二阶段已经完成：`src/common/protocol.ts` 新增 `CanvasGroupSummary`，`CanvasNodeSummary.groupId?`，`CanvasPrototypeState.groups` 和 `nextGroupSequence`，以及 `webview/createEmptyGroup`、`webview/createGroupFromSelection`、`webview/updateGroupTitle`、`webview/moveGroup`、`webview/resizeGroup`、`webview/deleteGroup`、`webview/ungroup` 等消息。`webview/moveNode` 新增 `pointerPosition` 和 `selectedMoves`；单节点拖动用鼠标释放点表达归属意图，多选节点拖动用 `selectedMoves` 携带其他被选节点的最终位置，且所有被选节点共用主鼠标释放点作为临时整体移动的归属意图。

第三阶段已经完成基础实现：`CanvasPanelManager.ts` 新增 group helper，包括创建空分组、从选择创建分组、更新标题、移动 group 子树、resize group、取消分组、删除分组保留成员、递归删除成员、normalize、几何收口和节点入组避让。`finalizeCanvasGroupState` 负责把宿主持久化状态收敛为基础合法状态；同父级 group 交叉以及直接成员节点与直接子 group 交叉由 `repairCanvasGroupGeometry` 按四向 spread repair 收口；`adjustMovedNodesAfterGroupDrop` 在本次移动节点进入新分组时按当前交互设计把移动节点簇整体平移避让已有同组节点，簇内部既有几何关系保护由 `preserveRepairTargetClusterWhileAvoidingSiblings` 承担。删除非空 group 通过 VS Code modal warning 让用户选择“删除内部所有节点与子分组”或“仅删除分组”；删除空 group 直接删除。

第四阶段已经完成基础 UI：`main.tsx` 渲染 group frame，标题栏和边框可命中，body 不阻挡成员节点；背景 body 挂在 `.react-flow__viewport`，foreground 交互 chrome 挂在 `.react-flow__renderer` 且带 `nodrag nopan`；选中 group 后显示工具栏；空白区右键可创建空分组；Ctrl / Cmd 多选后右键可从选择创建分组；拖动 group 时 Webview draft 同步移动整棵子树，靠近画布边缘会自动平移 viewport，释放后宿主返回最终状态。

第五阶段已经完成基础测试：协议测试覆盖新增 group 消息和 `selectedMoves`；模板测试覆盖 capture group 树；宿主 helper 测试覆盖空分组、编号、从选择创建、拖拽归属、移动子树、resize 纳入 / 移出、取消分组、normalize、节点入组避让和删除节点保留空组；Playwright 覆盖 group render / rename / ungroup、右键创建空组、Ctrl / Cmd 多选切换、普通点击回退单选、从选择创建分组和多选拖动消息。

## 具体步骤

在仓库根目录执行以下命令确认基础环境：

    git fetch origin main && git rebase --autostash origin/main
    npm run typecheck

定向阅读使用：

    rg -n "moveNode|resizeNode|deleteNode|CanvasPrototypeState|WebviewToHostMessage|HostToWebviewMessage" src
    rg -n "contextmenu|title|rename|drag|resize|ReactFlow|onNodeDrag" src/webview tests/playwright

当前验证命令应按以下顺序运行。注意 Webview harness 读取构建产物，Playwright 前必须先 build：

    npm run typecheck
    node --no-warnings --experimental-transform-types scripts/test/test-protocol-webview-messages.mts
    node scripts/test/test-canvas-templates.mjs
    npm run test:canvas-node-groups
    npm run build
    npx playwright test --config=playwright.config.mjs tests/playwright/webview-harness.spec.mjs --grep "canvas groups|empty group|group from selected|selected nodes move"

## 验证与验收

类型层验收：`npm run typecheck` 成功，且共享协议测试覆盖新增 group 消息，不出现未处理消息分支。

宿主状态验收：`npm run test:canvas-node-groups` 证明旧状态 normalize 后 `groups` 为空数组；创建空 group 得到默认标题和尺寸；删除后创建不复用分组编号；从两个同父级稳定对象创建 group 会设置成员关系；跨父级选择被拒绝；移动 group 会移动内部子树；拖动 / resize 释放后输出基础合法状态；节点拖入分组时移动节点簇避让已有同组节点；修复目标集合保持相对位置和原有重叠 / 非重叠关系；同父级分组冲突支持左右与上下四向挤开；取消 group 保留内部对象位置；删除节点不删除空 group。

Webview 验收：Playwright harness 中，空白区可创建空 group；group frame 使用弱边框和标题；单击标题可编辑；选中 group 后标题 tab 右侧双段按钮可取消分组，右段可删除分组；Ctrl / Cmd 点击节点才增删多选，再次点击已选节点会取消，普通点击回退单选；多选节点后右键可以发送 `webview/createGroupFromSelection`；多选拖动会在 `webview/moveNode` 中携带全部选中目标的最终位置，并让所有被选目标共用主鼠标释放点；拖动 group draft 移动子树并在边缘自动平移 viewport；group 支持上、下、左、右和四个角共 8 个方向 resize，resize 过程中只改变被 resize group 的边界，不移动成员节点或子分组；释放后由宿主状态同步。

持久化验收：reload 或窗口重开后，group、标题、位置、尺寸、父子关系和成员 `groupId` 恢复。模板保存 / 应用包含 group 的模板后，新节点和 group 重新生成 id，但保留相对层级关系。当前里程碑只覆盖模板 capture 和基础 apply 物化代码，仍需补真实 reload smoke。

## 幂等性与恢复

代码修改应保持可重复运行。旧状态 normalize 必须允许没有 `groups` 或 `nextGroupSequence` 字段的持久化数据安全加载。新增几何收口函数应尽量保持纯函数形态，失败时不部分写入宿主状态。Git 工作区可能已有用户改动，实施时只修改本计划涉及文件，不回滚无关改动。若某次测试生成临时文件，应删除或加入合适的忽略规则；不要提交 `.debug/` 等测试产物。

## 证据与备注

最近一次 rebase 记录：

    From https://github.com/ZY-WANG-0304/dev-session-canvas
     * branch            main       -> FETCH_HEAD
    Created autostash: ae677e3
    Current branch docs-canvas-node-grouping-design is up to date.
    Applied autostash.

当前新增验证入口：

    "test:canvas-node-groups": "node scripts/test/test-canvas-node-groups.mjs"

Playwright 分组测试需要先执行 `npm run build`，因为 harness 页面加载 `dist/webview.js`。

2026-05-30 PR #102 review 修复验证记录：

    $ npm run typecheck
    通过。

    $ npm run test:canvas-node-groups
    通过。

    $ node scripts/test/run-playwright-webview.mjs --grep "canvas groups render|canvas groups do not create document scrollbars|canvas group drag follows|canvas group body|canvas groups resize|canvas group border stroke|canvas group title and action"
    10 passed。

2026-05-28 第三轮 PR review 修复验证记录：

    $ npm run typecheck
    通过。

    $ npm run test:canvas-templates
    通过。

    $ npm run test:canvas-node-groups
    通过。

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run build
    通过。

    $ node scripts/test/run-playwright-webview.mjs -g "canvas context menu can create a group from selected peer groups|canvas context menu can create a group from selected nodes|host-triggered group creation uses current webview selection"
    3 passed
    Playwright webview tests passed.

    $ git diff --check
    通过。

2026-05-27 第二轮 PR review 修复验证记录：

    $ npm run typecheck
    通过。

    $ npm run test:canvas-node-groups
    通过。

    $ npm run test:canvas-templates
    通过。

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run test:extension-manifest
    extension manifest tests passed

    $ npm run build
    通过。

    $ node scripts/test/run-playwright-webview.mjs -g "host-triggered group creation uses current webview selection|host-triggered group creation reports invalid current webview selection without posting create|canvas context menu can create a group from selected nodes|canvas context menu can create an empty group"
    4 passed
    Playwright webview tests passed.

    $ DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
    Trusted workspace smoke passed.
    VS Code smoke test passed.

    $ git diff --check origin/main...HEAD
    通过。

    $ git diff --check
    通过。

2026-05-27 PR review 修复验证记录：

    > dev-session-canvas@0.10.6 typecheck
    > tsc --noEmit

    > dev-session-canvas@0.10.6 test:protocol-webview-messages
    > node --no-warnings --experimental-transform-types scripts/test/test-protocol-webview-messages.mts
    protocol webview message tests passed

    > dev-session-canvas@0.10.6 test:canvas-node-groups
    > node scripts/test/test-canvas-node-groups.mjs

    > dev-session-canvas@0.10.6 test:canvas-templates
    > node scripts/test/test-canvas-templates.mjs

    > dev-session-canvas@0.10.6 test:extension-manifest
    > node scripts/test/test-extension-manifest.mjs
    extension manifest tests passed

    > dev-session-canvas@0.10.6 build
    > node scripts/build/build.mjs

    $ node scripts/test/run-playwright-webview.mjs -g "host-triggered group creation uses current webview selection|host-triggered group creation reports invalid current webview selection without posting create|canvas context menu can create a group from selected nodes|canvas context menu can create an empty group"
    4 passed
    Playwright webview tests passed.

    $ git diff --check

2026-05-23 八向 resize 定向验证记录：

    > dev-session-canvas@0.10.4 typecheck
    > tsc --noEmit

    > dev-session-canvas@0.10.4 test:canvas-node-groups
    > node scripts/test/test-canvas-node-groups.mjs

    > dev-session-canvas@0.10.4 build
    > node scripts/build/build.mjs

    Running 1 test using 1 worker
      ✓ canvas groups resize from all eight directions
    1 passed

2026-05-23 resize 草稿修复验证记录：

    > dev-session-canvas@0.10.4 build
    > node scripts/build/build.mjs

    Running 2 tests using 1 worker
      ✓ canvas groups resize from all eight directions
      ✓ canvas group resize draft keeps member nodes stationary until release
    2 passed

2026-05-23 节点入组避让可见性修复验证记录：

    > dev-session-canvas@0.10.4 test:canvas-node-groups
    > node scripts/test/test-canvas-node-groups.mjs

    > dev-session-canvas@0.10.4 typecheck
    > tsc --noEmit

    > dev-session-canvas@0.10.4 build
    > node scripts/build/build.mjs

    Running 1 test using 1 worker
      ✓ node group drop applies the host avoidance position after state update
    1 passed

2026-05-24 resize 边缘自动平移验证记录：

    > dev-session-canvas@0.10.4 typecheck
    > tsc --noEmit

    > dev-session-canvas@0.10.4 build
    > node scripts/build/build.mjs

    Running 4 tests using 1 worker
      ✓ dragging a resize handle posts resizeNode and updates the note frame size
      ✓ dragging the top-left resize handle moves the note origin and grows the frame
      ✓ node resize auto-pans at the canvas edge and keeps resizing
      ✓ canvas group resize auto-pans at the canvas edge and keeps member drafts stationary
    4 passed

    Running 4 tests using 1 worker
      ✓ minimap viewport contrast stays readable in dark workbench theme
      ✓ minimap viewport contrast stays readable in light workbench theme
      ✓ minimap viewport outline remains visible after fitting distant nodes
      ✓ minimap remains pannable with the viewport outline overlay
    4 passed

    git diff --check

2026-05-23 调整轮最终验证记录：

    > dev-session-canvas@0.10.4 typecheck
    > tsc --noEmit

    protocol webview message tests passed

    > dev-session-canvas@0.10.4 test:canvas-node-groups
    > node scripts/test/test-canvas-node-groups.mjs

    > dev-session-canvas@0.10.4 build
    > node scripts/build/build.mjs

    Running 4 tests using 1 worker
      ✓ canvas groups render, rename, and post group actions
      ✓ canvas context menu can create an empty group
      ✓ selected nodes move together and report all release intents
      ✓ canvas context menu can create a group from selected nodes
    4 passed

    git diff --check

2026-05-26 分组 Panel chrome 修复验证记录：

    > dev-session-canvas@0.10.4 typecheck
    > tsc --noEmit

    > dev-session-canvas@0.10.4 test:canvas-node-groups
    > node scripts/test/test-canvas-node-groups.mjs

    > dev-session-canvas@0.10.4 build
    > node scripts/build/build.mjs

    Running 5 tests using 1 worker
      ✓ canvas groups render, rename, and post group actions
      ✓ canvas groups resize from all eight directions
      ✓ canvas group border stroke stays screen-stable across zoom levels
      ✓ canvas group resize draft keeps member nodes stationary until release
      ✓ canvas group resize auto-pans at the canvas edge and keeps member drafts stationary
    5 passed

    git diff --check

2026-05-22 本轮验证记录：

    > dev-session-canvas@0.10.4 typecheck
    > tsc --noEmit

    protocol webview message tests passed

    > dev-session-canvas@0.10.4 test:canvas-node-groups
    > node scripts/test/test-canvas-node-groups.mjs

    > dev-session-canvas@0.10.4 build
    > node scripts/build/build.mjs

    Running 3 tests using 1 worker
      ✓ canvas groups render, rename, and post group actions
      ✓ canvas context menu can create an empty group
      ✓ canvas context menu can create a group from selected nodes
    3 passed

## 接口与依赖

在 `src/common/protocol.ts` 中必须存在以下可序列化类型：

    export interface CanvasGroupSummary {
      id: string;
      title: string;
      position: CanvasNodePosition;
      size: CanvasNodeFootprint;
      parentGroupId?: string;
    }

`CanvasNodeSummary` 必须包含：

    groupId?: string;

`CanvasPrototypeState` 必须包含：

    groups: CanvasGroupSummary[];
    nextGroupSequence: number;

宿主至少需要提供以下语义入口，函数可以是私有方法或消息处理分支，但必须能被测试覆盖：创建空 group、从选择创建 group、移动 group、resize group、重命名 group、拖拽释放后解析归属、取消 group、删除 group。删除 group 的模式至少包括保留内部对象和删除内部对象。Webview 消息应携带足够信息，让宿主基于鼠标释放位置和释放几何做权威判断。

本次修订说明：2026-05-22 将实现阶段计划从“尚未开始代码实现”更新为“首版基础路径已实现、验证中”，并记录 portal hit-testing、`nextGroupSequence` 和剩余缺口，避免后续协作者误以为整个产品规格已完全验收。

本次修订说明：2026-05-22 17:17Z 补充分组实现的本轮验证证据，并记录 Note preview 多选修复、分组拖动释放点修复与仍未覆盖的真实 VSCode smoke 缺口。

本次修订说明：2026-05-23 02:54Z 记录用户提出的交互调整，包括 Ctrl / Cmd 多选、多选拖动最终位置上报、分组拖动画布跟随和节点入组避让，并补充当前已完成的局部验证证据。

本次修订说明：2026-05-23 03:43Z 修正分组入口 icon 口径：`symbol-array` 适用于创建空分组入口，从选择创建分组入口恢复为 `group-by-ref-type`。

本次修订说明：2026-05-23 04:07Z 修正多选节点移动释放点语义：多选节点作为临时整体移动，所有被选节点共用主鼠标释放位置作为归属意图。

本次修订说明：2026-05-23 04:30Z 记录删除空分组无需确认的产品口径，并同步宿主行为与测试计划。

本次修订说明：2026-05-23 06:48Z 将节点入组避让从合法状态法则移到当前交互设计，并把重叠 / 非重叠关系保护泛化为最小合法修复中对修复目标集合内部既有几何关系的要求。

本次修订说明：2026-05-23 07:30Z 将宿主同父级非法几何收口从逐个向右挤开改为四向 spread repair，并补充左右 / 上下挤开测试与验证证据。

本次修订说明：2026-05-23 07:45Z 补充 resize 释放边界回归测试，确认四向挤开只修复合法状态，不把修复后的几何关系反向解释成新的 resize 归属意图。

本次修订说明：2026-05-23 08:00Z 修正 resize 释放边界对节点的归属意图，完整包含的同父稳定节点会纳入当前分组，直接成员节点不再完整包含时提升到父级。

本次修订说明：2026-05-23 15:13Z 修正节点入组避让结果在 Webview 中不可见的问题：拖拽 / resize 已提交节点的本地布局 draft 会在宿主权威状态更新时清理，避免覆盖宿主返回的避让后坐标。

本次修订说明：2026-05-24 根据 resize 边缘交互调研结论，补充节点 resize 与分组 resize 的画布边缘自动平移实现。Webview 层复用既有画布自动平移控制器，resize 过程中持续更新草稿；自动平移仅改变视口，不改变拖拽 / resize 的归属意图或宿主最终合法状态收口语义。已补充节点 resize 到右下边缘、分组 resize 到右下边缘，以及分组 resize 自动平移过程中成员节点保持静止的 Playwright 覆盖。

本次修订说明：2026-05-26 修正 VSCode Panel 风格分组 body 背景遮盖成员节点的问题。分组背景层改为挂载在 React Flow viewport 的节点下方，foreground chrome 保持独立于普通节点的 portal 命中；正式 UI、产品规格和设计文档同步记录“body 使用 panel 背景但不得压住成员节点”。

本次修订说明：2026-05-26 继续收敛分组 Panel chrome：标题 tab 之外的顶部横向区域改为挖空透明；选中分组后显示与节点 resize 对齐的四边选中线、透明命中区和四角圆形控制点；分组普通边框和选中线按 viewport zoom 做反向缩放，使画布缩放时屏幕可见线宽保持不变。新增 Webview 回归覆盖 resize affordance、顶部挖空与 zoom 线宽。

本次修订说明：2026-05-26 修正分组 Panel 形状与 body 可见边界：标题 tab 与 body 都改成直角，body 顶部显示 `--vscode-panel-border`；宿主成员容纳 inset 顶部额外计入标题高度，确保成员相对 body 顶部的视觉预留与左、右、下边界一致。已补充宿主成员 inset 和 Webview 样式断言。

本次修订说明：2026-05-26 去除分组选中时标题 tab 的 active 下划线；选中态仅保留与节点 resize 对齐的四边选中线、四角控制点、标题文字前景和双段按钮。

本次修订说明：2026-05-26 将分组选中操作改为标题 tab 右侧双段按钮。左段执行取消分组，右段执行删除分组；Webview 回归覆盖双段按钮位置、双段按钮布局和两种消息。

本次修订说明：2026-05-26 优化分组标题 tab 与双段按钮的缩放表现：两者只在画板缩小时反向放大以保持用户可读尺寸；画板放大时不反向缩小，视觉上跟随画板一起放大；默认按内容自然宽度显示，只有达到分组宽度上限时才停止继续变宽，避免操作区溢出分组框或影响周边内容。新增 Webview 回归覆盖低倍率下的可读尺寸、放大时跟随画板缩放、自然宽度和不越界约束。

本次修订说明：2026-05-30 处理 PR #102 review，更新 active ExecPlan 中已过期的 canvas shell portal 口径：分组 foreground 改挂 `.react-flow__renderer`，用 React Flow wrapper / renderer / pane 裁切溢出避免无限画布外层滚动条，同时通过 `nodrag nopan` 避免拖动分组时 pane 同步平移。同步记录验证证据与正式设计索引日期。
