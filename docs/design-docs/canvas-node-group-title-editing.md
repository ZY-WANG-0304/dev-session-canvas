---
title: 节点与分组标题编辑入口设计
decision_status: 已选定
validation_status: 未验证
domains:
  - 画布交互域
  - 协作对象域
architecture_layers:
  - 画布呈现层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/canvas-node-groups.md
related_plans: []
updated_at: 2026-10-30
---

# 节点与分组标题编辑入口设计

## 1. 背景

当前 `Agent`、`Terminal`、`Note` 和普通用户分组都把标题编辑器直接放在标题文字上。节点标题输入框在聚焦时从只读显示切换为编辑，普通分组复用同一个 `ChromeTitleEditor`；这使标题文字同时承担“识别对象”和“进入编辑”两种职责。节点和分组标题栏还承载选择、分组拖动以及双击聚焦视口等操作，点击标题就编辑容易让这些动作发生竞争。

本设计按用户提出的方向，把标题展示与改名入口分开：标题保持为普通文本，只有指针移入标题区域后才在文字尾部显示编辑图标，点击图标才进入编辑。

## 2. 问题定义

标题既是对象身份，也是节点 / 分组 chrome 的命中区域。改名入口需要足够明确，同时不能抢占标题栏原有的选择、拖动和聚焦行为；它还需要能通过键盘和辅助技术发现与操作。

## 3. 目标

- 让用户一眼区分标题文本与改名动作，避免点标题文字就误入输入状态。
- 在节点和普通用户分组上使用一致的改名入口与提交 / 取消行为。
- 保留节点标题栏双击聚焦、分组标题栏拖动 / 选择和双击聚焦等已有操作。
- 保留标题单行截断、长标题提示、主题跟随和紧凑工具型视觉。

## 4. 非目标

- 不改变标题字段的数据模型、宿主权威写回、持久化、清洗、空值回退或默认编号规则。
- 不开放自动生成 `File` / `File List` 节点标题编辑；这些名称仍由来源资源决定。
- 不开放 workspace root group 标题编辑；它们继续只读显示 workspace folder 身份。
- 不改变标题栏动作按钮、分组 toolbar、resize 控件或分组拖动模型的职责。
- 不在 overview、只读缩略图或其他禁止交互的画布投影中提供编辑入口。

## 5. 候选方案

**方案 A：标题悬停 / 键盘聚焦时显示尾部编辑图标。** 点击图标进入编辑。标题文本自身保留对象选择和 chrome 行为。这与用户要求一致，且新增控件只在需要时出现。

**方案 B：保留标题文本单击改名，另加工具提示或视觉提示。** 该方案无法消除点击标题即进入输入框的冲突，也没有清楚区分标题和动作，因此不采用。

**方案 C：始终显示编辑图标。** 该方案更易发现，但会在每个可编辑节点和分组的标题上常驻一个按钮，与执行控制、状态和分组操作并排增加噪音，因此不采用。

## 6. 风险与取舍

- 悬停图标本身不适用于无指针输入。通过键盘焦点显示同一图标，并提供原生按钮语义、可访问名称和 tooltip，让键盘用户可以找到同一路径。
- 分组标题 tab 的自然宽度目前根据标题长度计算。加入图标后若不预留空间，hover 时会挤压标题或移动右侧 toolbar；因此布局计算需要常驻预留图标槽位，即使图标未显示也不改变宽度。
- 分组标题栏同时是拖动把手。编辑按钮必须被识别为交互目标并阻止拖动、双击聚焦和画布事件；这项隔离仅对图标生效，不应改变标题 tab 的其他命中区域。
- 标题文字变长或分组很窄时，标题应先 ellipsis，编辑图标仍保持可见和可点击；标题 tab 与图标不得越过分组边界或覆盖选中态分组 toolbar。

## 7. 正式方案

### 7.1 适用对象

编辑入口用于当前支持用户命名的 `Agent`、`Terminal`、`Note` 节点和普通用户分组。它不用于自动生成的文件活动节点、workspace root group、overview 投影、pane gallery 的非活动缩略图或其他只读投影。活动 root 中的普通节点和用户分组仍可编辑。

### 7.2 标题展示与编辑

未编辑时，标题以单行只读文本显示。鼠标指针进入标题文字区域后，在标题末尾显示 Codicon `edit` 图标按钮；键盘焦点到达该按钮时也显示它。按钮图标使用紧凑的 VS Code icon foreground，热区至少 24px，悬停和焦点样式使用现有 VS Code theme token，不通过标题改色或常驻背景制造第二种标题状态。图标槽位在默认布局中就已占宽，因此显示 / 隐藏不推挤文字、状态或右侧动作。

点击图标按钮，或在按钮聚焦时按 Enter / Space，选择对应节点 / 分组并进入编辑状态。输入框获得焦点并选中现有标题，方便直接替换默认名称。编辑期间图标隐藏，输入框沿用当前标题提交规则：Enter 提交，Escape 取消并恢复进入编辑前的标题，失焦提交；清空或全空白提交时恢复原标题。没有发生文本变化时不发送更新。分组标题继续允许重名；现有标题清洗与长度保护规则保持不变。

节点标题文字单击只选择节点，不移动或编辑；双击标题文字聚焦节点到视口。普通分组的标题文字交互按 pointer down 时的分组状态决定：若按下时分组未选中，本次手势只选择分组，即使按住后移动指针也不移动分组、不编辑、不平移画布；分组被选中后，若未处于标题编辑状态，从标题文字区域按下并越过现有拖动阈值会移动整个分组，未越过阈值则只保留选中状态且不提交移动。双击普通分组标题文字聚焦分组到视口，并优先识别为导航手势，不提交移动。点击 edit 按钮进入编辑；编辑期间标题文字沿用输入框文本选择 / 光标语义，绝不启动分组拖动。workspace root group 仍只读，不进入上述编辑或分组拖动流程。

### 7.3 布局、事件与可访问性

节点标题组件 `extensions/vscode/dev-session-canvas/src/webview/canvasUiSurface.tsx` 中的 `ChromeTitleEditor` 负责区分只读展示态和编辑态，并提供可复用的 edit button。`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 与 `fileNoteNodes.tsx` 只为可编辑的手工节点启用该入口。workspace root group 仍以 `readOnly` 传入，不渲染 edit button；普通 group 的接线位于 `extensions/vscode/dev-session-canvas/src/webview/canvasGroupLayers.tsx`。

图标按钮使用 `<button type="button">`、本地化的 `aria-label`（例如“编辑标题：{当前标题}”）和相同含义的 tooltip。键盘 Tab 可以到达按钮；按钮聚焦时显示图标和可见 focus ring。点击按钮先选择所属对象，再将焦点交给标题输入框。

按钮的 pointer down、click 与 double click 事件必须在画布手势处理前被识别为交互事件。普通分组的标题手势须在 pointer down 时读取并固定本次开始时的 `selected` / `isEditing` 状态，不能因为按下后第一击触发了选中，就把同一次未选中手势升级为拖动；处于编辑态或点击 edit 按钮时不能启动 `beginDrag`。分组标题双击优先作为聚焦手势处理，不提交 `webview/moveGroup`；edit 按钮不能触发 modifier 多选、group move / resize 或 `handleFocusDoubleClick`。对节点，edit 按钮不能让 click 被解释成标题栏双击聚焦。`isInteractiveTarget`、`isGroupChromeFocusBlockedTarget` 和 `isNodeChromeFocusBlockedTarget` 相关判断应覆盖按钮及分组标题编辑态。

节点标题栏的 edit button 槽位需避开 `.window-chrome-actions`，不覆盖状态、help、start / stop 或 delete 动作；副标题和 Agent context 行的现有截断逻辑不变。普通分组的标题 tab 自然宽度应把 edit button 槽位纳入计算，保持现有反向缩放、宽度上限和 toolbar 间距。窄分组中先压缩标题文字，保留按钮完整热区；若当前最小宽度无法容纳二者，应由分组最小宽度规则兜底，而不是裁掉入口。

### 7.4 随入口一并优化的交互

- **选择与改名分离：** 标题文字单击只选择对象，标题尾部的 edit 按钮才进入改名；输入框只在明确按下该按钮后出现。
- **标题双击聚焦：** 节点和分组标题文字双击都聚焦对应对象到当前视口。编辑输入框与 edit 按钮双击不聚焦，避免把文本编辑解释成导航。
- **分组拖动命中：** 按下时未选中的分组，本次标题文字手势只选中，不移动；按下时已选中且未编辑的分组，标题文字可作为拖动把手，只有越过拖动阈值才移动，单击仍保持选中且不提交移动。标题 tab 空白和分组边框保留拖动行为。双击标题文字聚焦视口并压过拖动判定；编辑期间标题文字和 edit 按钮都不启动拖动、resize、多选或画布平移。
- **改名键盘路径：** Tab 聚焦标题尾部按钮，Enter / Space 进入输入框；Enter 提交，Escape 还原，失焦提交。键盘 focus、hover 使用同一个入口，不新增第二套快捷键。
- **排版和动作冲突：** edit 按钮预留固定槽位；标题先截断，按钮保持可见。节点运行状态 / help / start-stop / delete 与分组选中 toolbar 不因 hover 而跳位或互相覆盖。
- **只读投影边界：** workspace root group、自动 File / File List、overview 与非活动缩略图继续只读；活动画布中的可编辑节点和普通分组共享入口。

## 8. 验证方法

实现时至少覆盖以下可观察行为：

1. `Agent`、`Terminal`、`Note` 与普通用户分组在指针进入标题文字区域时出现 edit 图标，离开后图标隐藏；hover 前后标题、状态与 toolbar 不发生位移。
2. 单击标题文本不进入编辑；单击 edit 图标后输入框获得焦点并可改名；Enter 提交、Escape 取消、失焦按既有规则提交；不变标题不产生重复更新。
3. 节点标题文字双击聚焦节点；普通分组标题文字双击聚焦分组且不提交移动。按下时未选中的分组，标题文字单击或拖动只选中、不移动；先选中分组后，从标题文字开始拖过阈值会移动整个分组，标题文字普通单击不提交移动；edit 按钮不拖动分组、不启动多选或画布平移。
4. Tab 可以聚焦 edit 按钮，Enter / Space 可以启动编辑；屏幕阅读器可读出带当前标题的动作名称；高对比主题下图标与 focus ring 清晰可见。
5. workspace root group、File / File List、overview 与非活动缩略图没有可操作的 edit button；活动 root 中的普通用户对象仍能编辑。
6. 长标题、最窄允许尺寸的分组、选中态 group toolbar、节点右侧动作区、浅色 / 深色 / 高对比主题下布局均不重叠、不越界，标题仍按原规则 ellipsis。

优先在 `tests/playwright/webview-harness.spec.mjs` 覆盖 Webview 指针、键盘、事件隔离和布局；宿主标题持久化链路沿用已有 smoke / 状态测试，并确认重新加载后保留新标题。真实 VS Code smoke 用于确认 Tab 顺序和高对比主题焦点可见性。

## 9. 关联文档

- `docs/product-specs/canvas-node-groups.md` 与 `docs/design-docs/canvas-node-groups.md` 定义普通 group 标题规则；其中“单击标题区域进入重命名”的旧触发口径由本文替换。
- `docs/design-docs/note-only-auxiliary-node-and-theme-alignment.md` 定义节点标题属于对象身份并由标题栏承载；本文补充该标题栏的具体编辑入口。
- 主要实现落点为 `extensions/vscode/dev-session-canvas/src/webview/canvasUiSurface.tsx`、`canvasGroupLayers.tsx`、`executionSessionNodes.tsx`、`fileNoteNodes.tsx`、`styles.css` 与 `i18n/webviewI18n.ts`。

## 10. 决策记录

- 决策：普通分组标题文字是否能拖动，由 pointer down 时的已选中 / 未选中状态及是否正在编辑决定；未选中按下只选择，已选中且未编辑时按下可开始拖动。
  理由：第一次点击继续承担明确的选择反馈；选中后标题文字又能作为直接拖动把手。以手势开始时的状态判定，避免选择状态变化把同一次按压升级为移动。
  日期/作者：2026-10-30 / 用户澄清
