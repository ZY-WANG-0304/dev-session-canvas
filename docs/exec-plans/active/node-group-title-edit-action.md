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
- [x] (2026-10-31) 最新提交通过 `git diff --check origin/main...HEAD` 的只读 Code Review；界面级验收仍待完成。
- [x] (2026-11-01) 处理 PR #351 review 的两个 blocker：依据第二次按压的实际位移区分快速拖动与轻微双击抖动；迁移测试 probe / Playwright 到编辑按钮入口并更新视觉基线。
- [x] (2026-11-01) 主扩展类型检查、stock profile 构建、`git diff --check` 和标题相关 Playwright 12 项通过；视觉用例在不更新快照模式下与更新后的 Linux 基线匹配。
- [x] (2026-11-01) 修复第二轮 review 的标题左侧空白双击与缩放断言；补充窄组标题内容的命中优先级，六项定向回归和三项视觉用例通过。完整功能组与 PR 最新 head 的门禁结果在 PR #351 跟进。
- [ ] 完成真实 Webview 的悬停、键盘和指针手势验收；界面级验证完成前保留本计划于 `active/`。

## 意外与发现

- 观察：`5f39a385` 的完整 Webview 功能门禁为 432 通过 / 4 失败，定向 12 项通过不足以证明整个功能门禁恢复。普通分组和 workspace root 的标题左侧空白双击都被选中后新增的 resize 热区改变了事件目标；另两项测试仍假定 root 与普通标题等宽，以及窄标题高度必须大于 14px。
  证据：PR #351 评论 `6547465652`，Actions run `41227897560`；reviewer 用相同测试切换主线 browser assets 后四项均通过。首次只选择手势需保持 pointer capture，标题宽度验收需计入普通组的 28px 编辑入口预算。
- 观察：补充窄组编辑入口实测时，标题行中心 hover 被顶部 resize 热区截获。只验证标题与按钮矩形在容器内还不足以确认按钮可操作；标题内容行需要在 resize 热区之上接收事件。
  证据：缩放 0.5、组宽 360、选中长标题组时，Playwright 的中心 hover 报 `canvas-group-resize-top intercepts pointer events`。回归增加中心 hover、编辑按钮点击、输入框焦点及进入编辑前后宽度一致检查；原左侧空白双击的 `left + 4px` 点击点保持不变。
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
- 观察：PR #351 的原生鼠标复现推翻了上面的快速拖动结论。Chromium 在 pointer capture 下会为第二次快速拖动派发 `click(detail=2)`，当前标题栏据此无条件取消 deferred move，之后双击事件仍聚焦视口；Xvfb + headed Chromium + X11 XTest 连续三次复现为 0 条 move 消息。
  证据：PR #351 的 2026-10-31 review comment；同一用例在两次按下间隔约 800ms 时产生 1 条 move 消息。
- 观察：标题编辑入口替换了原本可直接聚焦并输入的标题字段，但 Webview DOM probe 的 `setNodeTextField` 和若干 Playwright 测试仍直接 focus / click 隐藏、只读的测量 input；同一 PR 的定向测试因此失败，视觉基线记录到 10,190 个像素差异。
  证据：PR #351 Gate `webview-function` 和 `webview-visual` 失败工件，以及 review 中列出的两条标题测试。
- 观察：按 edit button 入口迁移测试 probe 和 Playwright 后，标题提交 / IME / 只读 root 边界用例与视觉快照均通过；快速拖动和容差内轻微双击分别提交移动和聚焦，没有混淆。
  证据：2026-11-01 在当前工作树运行定向 Webview Playwright 12 项，均通过；`npm run typecheck`、`npm run build -- --execution-profile=stock`、`git diff --check` 均通过。

## 决策记录

- 决策：首次只选择手势使用标题栏 pointer capture 保住 click 接收目标，不创建拖动草稿；实际标题内容在压缩布局下优先于 resize 热区接收事件，内容外的边框仍可 resize。
  理由：选中会挂载 resize 控件，必须同时保护首次手势的连续性和后续文字 / 编辑按钮操作。缩放验收按新宽度预算验证几何，并通过真实指针点击验证入口可用。
  日期/作者：2026-11-01 / PR #351 第二轮 review 修复
- 决策：重用共享 `ChromeTitleEditor`，把编辑入口放在同一标题的尾部，不为 Node、Group 新建独立协议或宿主更新链路。
  理由：当前 Agent / Terminal / Note / user group 已通过同一 `webview/updateNodeTitle` / `webview/updateGroupTitle` 写回；本次只改变 Webview 手势与呈现。
  日期/作者：2026-10-30 / Codex
- 决策：普通分组标题动作读取 pointer down 时的 `selected` 与编辑状态并固定本次手势语义。未选中手势只选择；已选中且未编辑手势可拖动；双击标题优先聚焦；edit button 与编辑输入框排除拖动。
  理由：首次点击产生选择反馈；只有后续明确在选中组上开始的拖动才移动整组。避免同一次 pointer down 后选中状态更新把选择误升级为拖动。
  日期/作者：2026-10-30 / 用户确认
- 决策：workspace root group、自动 File / File List、overview 和非活动缩略图不显示可操作的编辑入口。
  理由：这些对象的标题只读或当前画面禁止写入；入口只属于用户可命名且正在交互的对象。
  日期/作者：2026-10-30 / 用户需求与现行产品边界
- 决策：第二次标题按压被识别为双击候选时，若该次手势结束位置相对按下点超过现有 8px 双击位置容差，则立即提交已越过 3px 拖动阈值的位置，并吞掉紧随的聚焦双击；位移不超过 8px 时继续短暂延迟移动，让 `click(detail=2)` 取消轻微抖动并保留聚焦。
  理由：`click.detail` 只表示浏览器识别到多次点击，不足以证明第二次按压没有拖动。用释放位置区分明显拖动与容差内抖动，同时保留原双击导航语义。
  日期/作者：2026-11-01 / PR #351 review 反馈
- 决策：所有标题提交测试入口都必须先激活可访问的 edit button，再写入 / 断言当前 input；DOM probe 的 `setNodeTextField` 也复用该真实入口，不再聚焦只读测量字段。标题展示快照在确认实际 UI 变化后更新 Linux 基线。
  理由：测试应覆盖用户当前可操作的入口与展示/编辑边界，视觉基线要记录有意的标题布局变化。
  日期/作者：2026-11-01 / PR #351 review 反馈

## 结果与复盘

第二轮 review 已补齐首次只选择手势的 pointer capture，恢复普通组与 root 的标题左侧空白双击聚焦，并按新编辑预算迁移缩放验收。补充真实 hover / 点击时发现窄组选中后顶部 resize 热区会覆盖标题内容，已使标题内容优先接收事件；按钮点击、焦点和编辑前后输入宽度均通过回归。定向六项、视觉三项及 Webview 功能组的徽标 / 头像 / 侧栏节点列表检查通过。完整功能门禁以 [PR #351](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/351) 对应 head 的检查与修复回复为准，局部验证和静态复审不替代完整门禁。真实 VS Code 的 hover、键盘焦点、高对比主题和宿主持久化手动验收仍未完成，因此本计划保留在 `active/`。

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

最后增加双语 edit label，补图标焦点 / hover / 屏幕热区样式，为 group tab 预留稳定宽度；在设计文档中同步实现事实、验证结果和残余手动验证项。自动化回归需覆盖节点 edit button 与 DOM probe 写入、IME / Enter / Escape 提交，组的两步选择后拖动、快速选中后拖动、双击轻微抖动取消位置变更、标题文字双击聚焦与 edit button 隔离，并运行标题视觉基线测试。

## 具体步骤

以下命令从仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas5` 执行。

1. 在 `canvasUiSurface.tsx` 修改 `ChromeTitleEditor`，并在必要时拆分标题溢出测量以支持 `span` 展示态和 `input` 编辑态。保持 `data-probe-field="title"` 在两种状态下都能让现有 harness 定位当前标题。
2. 在 `executionSessionNodes.tsx`、`fileNoteNodes.tsx` 检查 Agent / Terminal / Note 调用均启用图标，保持 context、subtitleAccessory、readOnly 和 overview 退化行为。
3. 在 `canvasGroupLayers.tsx` 修改 `beginDrag` 与标题编辑态 / 双击意图判断。未选中 gesture 不得创建 draft，不得调用 `onMoveGroup`，不得落入画布 pan；已选中标题文字拖动仅在越阈值后提交。编辑按钮点击选择 group 并进入输入态。
4. 在 `canvasGroupFrameStyles.ts` 和 `styles.css` 为 group edit button 热区保留布局空间，先截断标题文字，确保按钮热区可见且不覆盖选中态 toolbar。节点 edit button 跟随标题文字并避开右侧 actions。
5. 在 `i18n/webviewI18n.ts` 为英文和简体中文增加编辑标题 accessible name / tooltip。更新 `docs/design-docs/canvas-node-group-title-editing.md` 的实现状态及 `docs/design-docs/index.md` 对应验证状态；计划进展持续写入本文。
6. 在 `main.tsx` 的 `setNodeTextField` probe 中先激活对应标题 edit button，再写入当前 input；在 Playwright helper 中提供同一真实 UI 入口。迁移直接点击 / 填写隐藏 title input 的测试，并新增快速拖动和轻微双击抖动的真实鼠标回归。
7. 下载并检查 PR 失败工件中的 expected / actual / diff 图，确认差异来自有意的标题布局后，通过 Webview visual Playwright 测试更新当前平台截图基线，并运行相关功能与视觉用例。
8. 执行静态质量命令：`git diff --check`；主扩展工作目录 `extensions/vscode/dev-session-canvas` 下运行 `npm run typecheck` 与 stock profile 构建；从仓库根目录运行标题定向 Webview Playwright 和视觉基线用例。默认构建依赖工作树中缺少的 `generated/execution-assets`。
9. 按 `docs/workflows/COMMIT.md` 暂存本功能相关实现、测试和计划 / 设计记录，排除已存在的 OSC 研究文件、设计索引本地 OSC 行和图片；rebase 最新 `origin/main` 后更新 PR #351。

## 验证与验收

实现完成后，至少以人工操作确认：在普通活动画布上悬停 Agent、Terminal、Note 和普通分组标题时出现尾部编辑图标，离开后隐藏且不造成标题 / 状态 / toolbar 位移。Tab 可到达编辑按钮，Enter / Space 能进入编辑；按钮有本地化 accessible name 和可见 focus 态。

按节点标题文字时只选中，不编辑或拖动；双击节点标题聚焦节点。按下时未选中的普通 group，点击或拖动标题文字只选中，不移动 group 或平移画布。先选中 group 后，标题文字拖过原有阈值会移动整个 group；仅点击标题文字保持选中且不提交 `webview/moveGroup`。双击标题文字聚焦 group，且不会先提交移动。编辑按钮进入输入态；编辑时拖动标题文字不移动 group；Enter 更新标题，Escape 恢复原标题，失焦沿用既有提交规则。

workspace root group、自动 File / File List、overview 和非活动 pane gallery thumbnail 不显示可操作的编辑按钮。窄 group、长标题、选中 toolbar、执行节点右侧 actions 和浅色 / 深色 / 高对比主题下，图标可读、热区完整、标题优先 ellipsis、控件不重叠。

第二轮修复提交前，`git diff --check`、`npm run typecheck`、`npm run build -- --execution-profile=stock`、六项定向 Webview 回归、三项视觉用例（不更新快照）及 `test:activitybar-badges` / `test:avatar` / `test:sidebar-node-list` 均通过。完整功能套件使用与 CI 相同的视觉排除规则、`--workers=2 --retries=0 --update-snapshots=none` 执行；运行结果随 PR #351 的最新 head 记录。真实 UI 手动验收仍未运行，不能将主题、Tab / Space 与宿主持久化写成已完成人工确认。

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
