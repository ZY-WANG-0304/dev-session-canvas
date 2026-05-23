# 实现画布节点分组

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循 `docs/PLANS.md` 的要求，目标是让一个不了解前序讨论的协作者也能从当前工作树继续完成分组功能实现。

## 目标与全局图景

本次实现让用户可以在 DevSessionCanvas 无限画布上创建可见分组框，把 `Agent`、`Terminal`、`Note` 或子分组归入同一组，拖动或 resize 分组，并在宿主状态里持久化分组标题、位置、尺寸和成员关系。分组是空间组织对象，不是执行节点；它不启动进程、不承载连线，也不改变成员节点原有能力。

当前里程碑交付的是“首版基础路径”：空白区右键创建空分组、从多选对象创建分组、分组标题编辑、分组拖动 / resize 草稿、拖动节点或分组后按鼠标释放位置重新归属、取消分组、删除分组确认、模板保存 / 应用基础映射，以及侧栏节点列表的更多菜单与按分组树展示选项。用户可以通过 Webview harness 看到分组框、重命名标题、右键创建和多选创建分组；通过宿主测试可以验证分组移动子树、resize 纳入 / 移出、空分组保留和 `file` / `file-list` 不持久入组。

## 进度

- [x] (2026-05-21 17:01Z) 已完成设计阶段文档，推荐 `CanvasGroupSummary + CanvasNodeSummary.groupId`，并把拖动 / resize 规则收敛为基础法则。
- [x] (2026-05-21 17:08Z) 已从 `origin/main` rebase 当前分支，命令 `git fetch origin main && git rebase origin/main` 成功。
- [x] (2026-05-21 17:15Z) 创建实现阶段 ExecPlan，记录目标、上下文、工作计划和验证方案。
- [x] (2026-05-22 15:35Z) 重新执行 `git fetch origin main && git rebase --autostash origin/main`；当前分支已经基于 `origin/main`，autostash 已恢复。
- [x] (2026-05-22 15:40Z) 完成共享协议与持久化状态：新增 `CanvasGroupSummary`、节点 `groupId`、`CanvasPrototypeState.groups`、`nextGroupSequence`、分组消息解析，并保持旧状态 normalize 安全。
- [x] (2026-05-22 15:44Z) 完成宿主基础行为：空分组、从选择创建分组、标题更新、节点拖拽归属、分组移动子树、分组 resize 纳入 / 移出、取消分组、删除分组二选一、节点删除保留空组、模板物化 group ID 映射。
- [x] (2026-05-22 15:46Z) 完成 Webview 基础 UI：分组 frame、标题编辑、选中工具栏、右键创建空分组、从多选创建分组、分组拖动 / resize draft、释放后向宿主提交。
- [x] (2026-05-22 15:49Z) 完成侧栏节点列表更多菜单基础入口，提供平铺展示与按分组树展示选项；该选项只影响侧栏呈现，不改变画布分组状态。
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
- [ ] 继续完善删除分组对话框的自动化覆盖、真实 VSCode reload smoke、侧栏分组树 UI smoke，以及更完整的几何合法状态证明。
- [ ] 按 `docs/workflows/COMMIT.md` 提交本次分组实现。

## 意外与发现

- 观察：当前设计明确“直接成员节点与直接子 group 不交叉”是硬不变量，不是交互建议。
  证据：`docs/product-specs/canvas-node-groups.md` 第 3.1 节合法状态法则。

- 观察：React Flow pane 会抢占普通 overlay 内 toolbar 的 hit-testing，group 工具栏如果直接渲染在 React Flow 子树中，点击可能被 pane 处理。
  证据：Webview Playwright 初始 toolbar 点击失败；修复方式是 `CanvasGroupsViewportLayer` 在 React Flow 内读取 viewport，再把 `CanvasGroupLayer` portal 到 `canvasShellRef.current`，并让 `.canvas-group-layer` 在 shell 层设置 `z-index: 5`、body 不接管 pointer events。

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

- 观察：多选节点同时移动时，这批节点应被理解为本次移动的临时整体，不能为每个节点按相对位置推导不同归属释放点。
  证据：`webview/moveNode` 保留 `selectedMoves` 传递每个被选节点的最终位置，但所有被选节点的 `pointerPosition` 均使用主鼠标释放位置；Webview 测试覆盖该消息。

- 观察：节点入组避让是当前交互设计，不属于合法状态法则；但修复目标集合内部既有几何关系保护属于最小合法修复的一部分，且不应只针对移入节点。
  证据：`adjustMovedNodesAfterGroupDrop` 当前仍按交互设计在入组目标变化时把本次移动节点作为整体簇平移避让已有同组节点；底层 helper 已改名为 `preserveRepairTargetClusterWhileAvoidingSiblings`，宿主测试覆盖任意修复目标集合保持相对间距、原有重叠关系和原有非重叠关系。

- 观察：同父级非法几何收口不能固定为逐个向右挤开；插入对象位于左右或上下兄弟之间时，应允许兄弟分别向两侧或上下方向被挤开。
  证据：`repairCanvasGroupGeometry` 现在按同父级集合构造四向候选修复，`scripts/test/test-canvas-node-groups.mjs` 覆盖左右兄弟之间插入新分组会左/右挤开、上下兄弟之间插入新分组会上/下挤开。

- 观察：四向挤开修复不能改变 resize 释放边界本身表达的归属意图。
  证据：`scripts/test/test-canvas-node-groups.mjs` 覆盖 resize 释放边界内完整包含的同父稳定节点和同父分组被纳入，释放边界仅交叉的同父节点 / 分组仍留在原父级或被挤开但不被纳入；也覆盖 resize 边界移动到直接成员节点 / 子分组内部时，它们从父分组移出。

- 观察：分组自定义 overlay 的可命中 body 仍应保持不阻挡节点，因此八向 resize 只能把边 / 角手柄设为 pointer target，不能让整个分组框接管 pointer events。
  证据：`CanvasGroupFrame` 继续保持 `.canvas-group-frame` 和 `.canvas-group-body` 不接管 pointer events；新增的 8 个 `.canvas-group-resize-handle-*` 手柄分别承担 resize 命中。

- 观察：Webview 分组草稿里的 `position` 既可能来自移动，也可能来自左 / 上方向 resize；不能仅凭 `draft.position` 推断“整棵子树正在移动”。
  证据：`applyCanvasGroupDrafts` 现在只把不含 `size` 且 position 真的变化的草稿视为移动草稿；含 `size` 的 resize 草稿只改变分组框边界，成员节点和子分组在释放前保持原位。

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

- 决策：group layer 使用 portal 到 canvas shell，而不是完全作为 React Flow 自定义节点。
  理由：方案 B 保持 group 不是 `CanvasNodeKind`；portal 既能复用 React Flow viewport，又能避免 pane 遮挡 group 标题栏和工具栏命中。
  日期/作者：2026-05-22 / Codex

- 决策：侧栏本里程碑只做“更多”按钮和按分组路径排序 / 分段展示，不做可折叠持久树状态。
  理由：产品要求提供按分组树折叠展示选项，但同时确认画布分组本身不支持折叠；本里程碑先让侧栏显示入口和分组路径可用，不把侧栏折叠状态升级成画布分组事实。
  日期/作者：2026-05-22 / Codex

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

当前工作已经从文档设计推进到首版基础实现。代码层新增了共享 group 协议、宿主持久化与几何收口、Webview group frame 与上下文入口、模板 group capture / materialize、侧栏更多菜单，以及对应的协议、宿主、模板和 Playwright 测试。设计文档已经把方案 B 从“比较中”收口为“已选定”，验证状态保持“验证中”。

2026-05-22 本轮验证已经覆盖类型检查、协议解析、模板捕获、宿主 group helper 和 Webview harness 的分组主路径。验证命令均在仓库根目录执行并通过。设计文档仍保持“验证中”，因为这些命令证明首版基础路径可用，但还不能替代真实 VSCode reload smoke、删除 modal 两种分支验证、侧栏 grouped view smoke 或完整几何场景矩阵。

剩余缺口包括：删除分组 modal 的两种选择还缺自动化断言；真实 VSCode reload 后 group 恢复还没有本轮 smoke 证据；几何收口覆盖的是基础路径而非完整证明；侧栏“按分组树折叠展示”当前是显示模式入口和按路径分段，不是完整可折叠树组件；命令面板入口仍未补齐。后续协作者应优先补这些缺口，再把验证状态推进到“已验证”。

## 上下文与定向

DevSessionCanvas 是 VSCode workspace extension。`src/common/protocol.ts` 定义跨宿主和 Webview 的共享状态与消息；`CanvasPrototypeState` 保存 `nodes`、`edges`、`groups`、`nextGroupSequence`、文件引用和文件活动状态。`src/panel/CanvasPanelManager.ts` 是宿主权威状态中心，负责节点创建、移动、resize、删除、持久化和向 Webview 广播状态。`src/webview/main.tsx` 使用 React Flow 渲染画布和节点，维护局部选中态、拖动 UI、节点标题编辑、分组 frame 和上下文菜单。`src/webview/styles.css` 定义节点、连线、菜单和分组样式。`src/common/canvasTemplates.ts` 保存和应用模板。`src/sidebar/CanvasSidebarNodeListView.ts` 渲染侧栏节点列表。

本计划使用以下普通术语：group 指画布分组框；直接成员节点指 `groupId` 指向该 group 的节点；直接子 group 指 `parentGroupId` 指向该 group 的 group；根级对象指没有父 group 的节点或 group；合法状态指 group 无环、对象最多一个直接父 group、同级 group 不交叉、直接成员节点与直接子 group 不交叉、直接子 group 之间不交叉、成员视觉上被所属 group 完整容纳。

实现必须遵守产品规格 `docs/product-specs/canvas-node-groups.md` 和设计文档 `docs/design-docs/canvas-node-groups.md`。如果实现中发现文档和代码现状冲突，先在本计划的“意外与发现”和“决策记录”中写清楚，再同步正式设计文档或产品规格。

## 工作计划

第一阶段已经完成：阅读现有 `CanvasNodeSummary`、`CanvasPanelManager` 的 `moveNode` / `resizeNode` / `deleteNode`、Webview 消息分发、React Flow 节点拖动和标题编辑组件。确认现有节点坐标是绝对坐标，标题编辑可复用 `ChromeTitleEditor`，Playwright harness 加载的是 `dist/webview.js`，因此跑 Webview 测试前必须先 `npm run build`。

第二阶段已经完成：`src/common/protocol.ts` 新增 `CanvasGroupSummary`，`CanvasNodeSummary.groupId?`，`CanvasPrototypeState.groups` 和 `nextGroupSequence`，以及 `webview/createEmptyGroup`、`webview/createGroupFromSelection`、`webview/updateGroupTitle`、`webview/moveGroup`、`webview/resizeGroup`、`webview/deleteGroup`、`webview/ungroup` 等消息。`webview/moveNode` 新增 `pointerPosition` 和 `selectedMoves`；单节点拖动用鼠标释放点表达归属意图，多选节点拖动用 `selectedMoves` 携带其他被选节点的最终位置，且所有被选节点共用主鼠标释放点作为临时整体移动的归属意图。

第三阶段已经完成基础实现：`CanvasPanelManager.ts` 新增 group helper，包括创建空分组、从选择创建分组、更新标题、移动 group 子树、resize group、取消分组、删除分组保留成员、递归删除成员、normalize、几何收口和节点入组避让。`finalizeCanvasGroupState` 负责把宿主持久化状态收敛为基础合法状态；同父级 group 交叉以及直接成员节点与直接子 group 交叉由 `repairCanvasGroupGeometry` 按四向 spread repair 收口；`adjustMovedNodesAfterGroupDrop` 在本次移动节点进入新分组时按当前交互设计把移动节点簇整体平移避让已有同组节点，簇内部既有几何关系保护由 `preserveRepairTargetClusterWhileAvoidingSiblings` 承担。删除非空 group 通过 VS Code modal warning 让用户选择“删除内部所有节点与子分组”或“仅删除分组”；删除空 group 直接删除。

第四阶段已经完成基础 UI：`main.tsx` 渲染 group frame，标题栏和边框可命中，body 不阻挡成员节点；选中 group 后显示工具栏；空白区右键可创建空分组；Ctrl / Cmd 多选后右键可从选择创建分组；拖动 group 时 Webview draft 同步移动整棵子树，靠近画布边缘会自动平移 viewport，释放后宿主返回最终状态。

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

Webview 验收：Playwright harness 中，空白区可创建空 group；group frame 使用弱边框和标题；单击标题可编辑；选中 group 后工具栏可取消分组；Ctrl / Cmd 点击节点才增删多选，再次点击已选节点会取消，普通点击回退单选；多选节点后右键可以发送 `webview/createGroupFromSelection`；多选拖动会在 `webview/moveNode` 中携带全部选中目标的最终位置，并让所有被选目标共用主鼠标释放点；拖动 group draft 移动子树并在边缘自动平移 viewport；group 支持上、下、左、右和四个角共 8 个方向 resize，resize 过程中只改变被 resize group 的边界，不移动成员节点或子分组；释放后由宿主状态同步。

持久化验收：reload 或窗口重开后，group、标题、位置、尺寸、父子关系和成员 `groupId` 恢复。模板保存 / 应用包含 group 的模板后，新节点和 group 重新生成 id，但保留相对层级关系。当前里程碑只覆盖模板 capture 和基础 apply 物化代码，仍需补真实 reload smoke。

## 幂等性与恢复

代码修改应保持可重复运行。旧状态 normalize 必须允许没有 `groups` 或 `nextGroupSequence` 字段的持久化数据安全加载。新增几何收口函数应尽量保持纯函数形态，失败时不部分写入宿主状态。Git 工作区可能已有用户改动，实施时只修改本计划涉及文件，不回滚无关改动。若某次测试生成临时文件，应删除或加入合适的忽略规则；不要提交 `.debug/` 等测试产物。

## 证据与备注

最近一次 rebase 记录：

    From https://github.com/ZY-WANG-0304/dev-session-canvas
     * branch            main       -> FETCH_HEAD
    Created autostash: 81c6fd6
    Current branch docs-canvas-node-grouping-design is up to date.
    Applied autostash.

当前新增验证入口：

    "test:canvas-node-groups": "node scripts/test/test-canvas-node-groups.mjs"

Playwright 分组测试需要先执行 `npm run build`，因为 harness 页面加载 `dist/webview.js`。

2026-05-23 八向 resize 定向验证记录：

    > dev-session-canvas@0.10.4 typecheck
    > tsc --noEmit

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
