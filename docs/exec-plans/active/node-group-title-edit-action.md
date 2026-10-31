# 实现节点与分组标题编辑入口

本 `ExecPlan` 是活文档。实现推进时必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划按仓库根目录的 `docs/PLANS.md` 编写。

## 目标与全局图景

完成后，`Agent`、`Terminal`、`Note` 与普通用户分组的标题都以只读文字显示。指针悬停标题时，尾部出现编辑图标；键盘焦点到达该按钮时也显示。按下编辑按钮才进入标题编辑。标题文字单击不会误入编辑。

普通分组标题还按 pointer down 时的分组状态决定手势：未选中时本次按下只选择，不移动分组或画布；已选中且未编辑时，标题文字可作为拖动把手，超过现有拖动阈值后移动整个分组；只点击时保持选中且不提交位置变化。双击标题文字聚焦分组到视口。编辑期间标题文字不触发拖动。

用户可以在活动画布上逐个悬停或通过键盘 Tab 到达编辑按钮，观察按钮出现；点击后输入新标题并按 Enter，标题更新；按 Escape 则恢复原值。自动 File / File List 标题和只读 workspace root 标题继续不提供编辑入口。

## 进度

- [x] (2026-10-30 18:49 +0800) 基于最新 `origin/main` 建立并 rebase `node-group-title-edit-action`，保留本地 OSC 研究文件与图片改动。
- [x] (2026-10-30 18:49 +0800) 阅读 `docs/WORKFLOW.md`、`docs/FRONTEND.md`、`docs/UI.md`、`docs/PLANS.md` 和相关正式设计 / 规格。
- [x] (2026-10-30) Refactor `ChromeTitleEditor`，加入只读展示态、编辑按钮、键盘焦点入口和标题提交 / 取消行为。
- [x] (2026-10-30) 让普通分组标题按 pointer down 时的选中 / 编辑状态执行选择或拖动，并保留双击聚焦。
- [x] (2026-10-30) 完成 CSS、本地化和设计文档实现记录。
- [x] (2026-10-30) 通过类型检查、显式 stock profile 构建和 `git diff --check`。
- [x] (2026-10-31) fetch 最新 `origin/main` 并 rebase 到 `aa18ec56`；恢复功能与 OSC 本地改动并核对完整。
- [x] (2026-10-31) subagent Code Review 两轮复核：修复双击候选移动提交与快速选中后拖动被拦截，最终未发现确定性 blocker。
- [x] (2026-10-31) 统一标题编辑按钮的 hover / focus feedback；按钮跟随主标题实际显示文本，编辑态沿用原输入框宽度规则。
- [ ] (2026-10-31) 对覆盖式展示层与原输入框宽度约束的最后调整补充静态检查；界面级验收仍待完成。
- [ ] 完成真实 Webview 的悬停、键盘和指针手势验收；界面级验证完成前保留本计划于 `active/`。

## 意外与发现

- 观察：仓库主线在设计阶段后又前进 7 个提交，其中包含新 release 记录，因此实现分支先 rebase 到最新 `origin/main`。
  证据：`origin/main` 更新到 `034c5a02`；rebase 保留两条标题设计提交和新的 release 设计索引条目。
- 观察：当前节点标题使用始终挂载的 `<input>`；其 `onFocus` 会立即打开编辑。当前分组拖动把手也位于 `.canvas-group-titlebar`，并依靠可交互目标检测阻止输入框触发拖动。
  证据：`canvasUiSurface.tsx` 的 `ChromeTitleEditor` 和 `canvasGroupLayers.tsx` 的 `beginDrag` / `handleFocusDoubleClick`。
- 观察：分组标题 tab 的自然宽度由 `canvasGroupFrameStyles.ts` 按标题长度计算，右侧 toolbar 从 title tab 宽度开始布局。
  证据：`createCanvasGroupFrameStyle` 计算 `--canvas-group-title-tab-width`；`styles.css` 使用该变量定位 `.canvas-group-toolbar`。
- 观察：节点标题文字使用 `nodrag` / `nopan` 保留原有拖动边界；普通分组只有在按下时已选中，且从标题文字起手，才启动标题拖动。拖动位置草稿在越过现有 3px 屏幕阈值后才发布。
  证据：`ChromeTitleEditor` 展示态 class、`CanvasGroupFrame.beginDrag` 与 `applyDragMove`。
- 观察：编辑按钮热区在展示态预留用于截断的空间，图标紧跟实际展示文本；输入框保留在布局中作为尺寸基准，编辑时继续沿用旧宽度约束。workspace root group 标题不显示编辑按钮，也不启动标题拖动。
  证据：`canvasUiSurface.tsx` 的 edit button 与 `styles.css` 展示覆盖层；`canvasGroupFrameStyles.ts` 为分组 tab 计算标题文字、按钮热区和间距。
- 决策：编辑图标紧跟主标题当前展示文本，hover / focus 显示；节点 hover 色与 Note 路径复制按钮共用样式。展示文字叠加在原输入框尺寸基准上，编辑态恢复并沿用改动前的输入框宽度约束；Agent / Terminal 保留原 `min(100%, 340px)` 宽度，Note 与分组沿用各自原可用宽度。
  理由：入口应跟随用户实际看到的标题尾部；输入框保持原有宽度，避免打字期间收缩或造成布局跳动。
  日期/作者：2026-10-31 / 用户反馈与实现判断
- 观察：首轮 Code Review 确认，第二次标题按下如果跨过 3px 阈值，会在原生双击聚焦前提交分组位置。随后直接吞掉双击候选又会挡住快速拖动；现实现让候选按下仍可达到阈值，并把位置提交延迟到 click 事件可判定是否为双击之后。
  证据：`CanvasGroupFrame.beginDrag` 标记候选，`completeDrag` 延迟候选位置提交，标题栏 `onClick` 在 `detail > 1` 时清除草稿；最终 reviewer 复核确认双击不会提交移动，快速拖动仍可提交。

## 决策记录

- 决策：重用共享 `ChromeTitleEditor`，把编辑入口放在同一标题的尾部，不为 Node、Group 新建独立协议或宿主更新链路。
  理由：当前 Agent / Terminal / Note / user group 已通过同一 `webview/updateNodeTitle` / `webview/updateGroupTitle` 写回；本次只改变 Webview 手势与呈现。
  日期/作者：2026-10-30 / Codex
- 决策：普通分组标题动作读取 pointer down 时的 `selected` 与编辑状态并固定本次手势语义。未选中手势只选择；已选中且未编辑手势可拖动；双击标题优先聚焦；edit button 与编辑输入框排除拖动。
  理由：首次点击产生选择反馈；只有后续明确在选中组上开始的拖动才移动整组。避免同一次 pointer down 后选中状态更新把选择误升级为拖动。
  日期/作者：2026-10-30 / 用户确认
- 决策：workspace root group、自动 File / File List、overview 和非活动缩略图不显示可操作的编辑入口。
  理由：这些对象的标题只读或当前画面禁止写入；入口只属于用户可命名且正在交互的对象。
  日期/作者：2026-10-30 / 用户需求与现行产品边界

## 结果与复盘

上一版实现和静态构建已完成。rebase 到 `origin/main@aa18ec56` 无冲突；主扩展 `npm run typecheck`、`git diff --check` 与 `npm run build -- --execution-profile=stock` 通过。默认构建因当前 checkout 缺少 `generated/execution-assets` 失败。subagent 两轮只读 Code Review 最终未发现确定性 blocker。最新的标题展示覆盖层和输入宽度恢复尚未运行静态检查；Webview Playwright 与真实 VS Code 手动交互也未执行。hover / focus、输入态尺寸稳定、节点与组双击聚焦、未选中拖动阻断、选中组 3px 阈值和只读投影仍需界面级验收，因此计划暂留 `active/`。

## 上下文与定向

仓库是 VS Code 画布扩展。标题展示在 Webview 中，标题值仍由 Host 权威状态保存。本次不改标题消息、状态模型或持久化格式。

`extensions/vscode/dev-session-canvas/src/webview/canvasUiSurface.tsx` 定义共享组件 `ChromeTitleEditor`，目前输入框聚焦即编辑。`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 将其用于 Agent 和 Terminal；`fileNoteNodes.tsx` 用于 Note；自动文件节点不通过此编辑器更改来源标题。

`extensions/vscode/dev-session-canvas/src/webview/canvasGroupLayers.tsx` 的 `CanvasGroupFrame` 显示 user / workspace root group 标题并处理分组拖动、选择和聚焦。`beginDrag` 当前看到非交互标题区域时启动 draft；`completeDrag` 在越过 `CANVAS_GROUP_POINTER_COMMIT_THRESHOLD_PX` 后调用 `onMoveGroup`。`lastTitlebarPointerClickRef`、`takeTitlebarDoubleClickPointerIntent` 和 `handleFocusDoubleClick` 用于保留双击聚焦并避免提交移动。新行为必须复用或适当调整该机制。

`extensions/vscode/dev-session-canvas/src/webview/canvasGroupFrameStyles.ts` 根据标题自然宽度和按钮热区计算 group title tab；`styles.css` 包含 `.window-title-*`、`.canvas-group-title*`、`.canvas-group-toolbar` 样式。展示文本始终为按钮热区保留截断空间，图标锚定展示文本末尾；输入框留在布局中作为宽度基准。

Webview 双语文案在 `extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts`。新增图标必须有本地化 `aria-label` 和 tooltip。项目主题与焦点规则位于 `docs/UI.md`，交互热区与可访问性规则位于 `docs/FRONTEND.md`。

此次实现从最新 `origin/main` 切出的 `node-group-title-edit-action` 开始。工作树已有未提交的 OSC 研究文档、设计索引记录及图片；这些内容不是本功能范围，不应纳入本次实现提交。

## 工作计划

先改共享标题编辑器：明确区分只读标题文字、edit button 和输入态；edit button 点击后选择对象、聚焦输入框并全选原标题。输入仍复用现有清洗、IME、Enter 提交、Escape 取消、失焦提交和无变化去重逻辑。没有 `onSubmit`、`readOnly` 或 overview 禁止交互时，不渲染可操作按钮。

接着改 group titlebar 手势。标题文字 pointer down 时读取本次开始时的 `props.selected` 和标题编辑态；未选中时消费手势并只选择，阻断 React Flow 的拖动 / 画布平移；已选中且未编辑时建立标题拖动候选。只有越过现有阈值才发布 draft 和最终 `webview/moveGroup`；普通点击不提交位置。双击意图检测必须在标题拖动启动之前优先处理。编辑按钮和输入框的 pointer down 不进入 group drag。

最后增加双语 edit label，补图标焦点 / hover / 屏幕热区样式，为 group tab 预留稳定宽度；在设计文档中同步实现事实、验证结果和残余手动验证项。自动化回归建议覆盖节点编辑按钮、只读态、组的两步选择后拖动、未选中拖动只选择、编辑态无拖动、普通点击无位置提交、双击聚焦无位置提交和布局边界。

## 具体步骤

以下命令从仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas5` 执行。

1. 在 `canvasUiSurface.tsx` 修改 `ChromeTitleEditor`，并在必要时拆分标题溢出测量以支持 `span` 展示态和 `input` 编辑态。保持 `data-probe-field="title"` 在两种状态下都能让现有 harness 定位当前标题。
2. 在 `executionSessionNodes.tsx`、`fileNoteNodes.tsx` 检查 Agent / Terminal / Note 调用均启用图标，保持 context、subtitleAccessory、readOnly 和 overview 退化行为。
3. 在 `canvasGroupLayers.tsx` 修改 `beginDrag` 与标题编辑态 / 双击意图判断。未选中 gesture 不得创建 draft，不得调用 `onMoveGroup`，不得落入画布 pan；已选中标题文字拖动仅在越阈值后提交。编辑按钮点击选择 group 并进入输入态。
4. 在 `canvasGroupFrameStyles.ts` 和 `styles.css` 为 group edit button 槽位增加固定布局空间，先截断标题文字，确保按钮热区可见且不覆盖选中态 toolbar。节点 edit button 放在 `window-title-copy` 中标题文字尾部，并避开右侧 actions。
5. 在 `i18n/webviewI18n.ts` 为英文和简体中文增加编辑标题 accessible name / tooltip。更新 `docs/design-docs/canvas-node-group-title-editing.md` 的实现状态及 `docs/design-docs/index.md` 对应验证状态；计划进展持续写入本文。
6. 执行静态质量命令：`git diff --check`；主扩展工作目录 `extensions/vscode/dev-session-canvas` 下运行 `npm run typecheck` 与构建。默认构建依赖工作树中缺少的 `generated/execution-assets`；本次显式运行 `npm run build -- --execution-profile=stock` 成功。Webview harness `npm run test:webview` 与真实宿主手动验收尚未运行。
7. 按 `docs/workflows/COMMIT.md` 暂存本功能相关实现和计划 / 设计记录，排除已存在的 OSC 研究文件、设计索引本地 OSC 行和图片。

## 验证与验收

实现完成后，至少以人工操作确认：在普通活动画布上悬停 Agent、Terminal、Note 和普通分组标题时出现尾部编辑图标，离开后隐藏且不造成标题 / 状态 / toolbar 位移。Tab 可到达编辑按钮，Enter / Space 能进入编辑；按钮有本地化 accessible name 和可见 focus 态。

按节点标题文字时只选中，不编辑或拖动；双击节点标题聚焦节点。按下时未选中的普通 group，点击或拖动标题文字只选中，不移动 group 或平移画布。先选中 group 后，标题文字拖过原有阈值会移动整个 group；仅点击标题文字保持选中且不提交 `webview/moveGroup`。双击标题文字聚焦 group，且不会先提交移动。编辑按钮进入输入态；编辑时拖动标题文字不移动 group；Enter 更新标题，Escape 恢复原标题，失焦沿用既有提交规则。

workspace root group、自动 File / File List、overview 和非活动 pane gallery thumbnail 不显示可操作的编辑按钮。窄 group、长标题、选中 toolbar、执行节点右侧 actions 和浅色 / 深色 / 高对比主题下，图标可读、热区完整、标题优先 ellipsis、控件不重叠。

本次已运行 `git diff --check`、`npm run typecheck` 和显式 stock profile 构建并通过。默认构建失败信息指出缺少 `generated/execution-assets`；此 checkout 未提供默认资产目录。`npm run test:webview` 与真实 UI 手动验收未运行，不能将实现行为写成已通过界面验收。

## 幂等性与恢复

此功能不修改用户数据结构或文件格式。反复进入 / 退出标题编辑不会改变标题；只有标题值实际改变才发出一次对应 update 消息。pointer cancel、窗口 blur 或卸载发生在 group drag draft 期间时，沿用当前取消机制清除 draft，不提交位置。

任何一步失败都可通过恢复本次改动文件的 Git diff 回退；不需要迁移持久化状态。不要使用 `git reset --hard` 或覆盖未提交的 OSC 研究内容。

## 证据与备注

实现阶段在此记录 `git diff --check`、类型检查、构建和实际手势确认的结果。当前工作树状态在开始时为：

    branch: node-group-title-edit-action
    base: origin/main @ 034c5a02894dab45fdbde9b877e787fa4f91f242
    local feature commits: 2 design/documentation commits
    unrelated local files: terminal OSC research docs and two images

## 接口与依赖

复用 React、现有 VS Code Codicon 和 DOM 可访问语义，不新增运行时依赖。

- `ChromeTitleEditor` 保持现有 `value`、`readOnly`、`onSelectNode`、`onSubmit` API，并增加必填 `titleEditLabel`、可选 `groupTitleDragHandle` 与 `disableEditing` 呈现属性；pane gallery 通过 `titleEditingDisabled` 阻止非活动 / overview 分组显示编辑入口，外部仍调用同一标题组件。
- Agent / Terminal 使用现有 `onUpdateNodeTitle` 回调；Note 使用相同节点标题写回；group 使用 `onUpdateGroupTitle(groupId, title)`。
- 不新增 common protocol 消息。节点与 group 分别继续发送现有 `webview/updateNodeTitle` 与 `webview/updateGroupTitle`。
- group move 仍通过 `onDraftGroup` 与 `onMoveGroup` 提交；pointer down 状态只决定是否进入现有拖动流程，不改变宿主的分组几何收口接口。
