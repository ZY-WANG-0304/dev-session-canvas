# 画布模板功能实现

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/canvas-template-feature.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要让 Canvas 具备正式的模板能力。完成后，用户第一次打开新 workspace 的画布时，会自动看到默认的“使用说明”模板；之后可以在侧栏模板视图中应用内置模板、把任意模板设为默认模板、把当前画布保存成用户模板、导入/导出模板文件，并在画布空白区右键菜单和命令面板里走同一套模板操作入口。

用户可观察到的关键变化有三条：第一，空画布不再只能从零开始，而会先以默认模板起步；第二，模板应用只会恢复布局和静态内容，不会自动启动 `Agent` / `Terminal`；第三，模板新增到现有画布时会整体避开现有节点，而不是简单重叠。

## 进度

- [x] (2026-05-06 16:55 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md`、`docs/DESIGN.md`、`docs/FRONTEND.md` 与产品规格，确认这是一个需要独立 `ExecPlan` 和正式设计文档的跨层功能。
- [x] (2026-05-06 16:58 +0800) 检查工作树状态，确认当前分支为 `execution-terminal-shell-selection`，工作树已有用户侧未提交改动：`docs/product-specs/index.md`、`docs/product-specs/canvas-template-feature.md`、`CLAUDE.md`；本轮只在必要处协作修改，不回退这些改动。
- [x] (2026-05-06 17:30 +0800) 新增正式设计文档与本执行计划，明确模板模型、默认模板机制、存储边界、组级摆放规则、侧栏/命令/右键菜单分工，以及“模板应用不自动启动执行节点”的正式口径。
- [x] (2026-05-06 17:45 +0800) 盘点现有宿主状态、Webview 上下文菜单、侧栏 webview 和持久化能力，确认需要新增模板模型、模板存储、侧栏模板视图、空白区模板菜单与 Webview -> Host 视口中心同步。
- [x] (2026-05-06 18:05 +0800) 实现模板领域模型、2 个内置模板资源、用户模板目录扫描、默认模板持久化和首次打开自动应用逻辑。
- [x] (2026-05-06 18:15 +0800) 实现模板保存、应用、重置、设为默认、导入、导出、删除的宿主命令与错误处理，并补齐 Agent `argv` 在模板保存 / 重新物化 / 实际启动前解析链路中的贯通。
- [x] (2026-05-06 18:20 +0800) 接入模板侧栏视图、命令面板入口和画布空白区右键菜单，补齐视口中心回传与 smoke host `resources/` 资源打包。
- [x] (2026-05-06 18:30 +0800) 补充自动化测试与资源夹具，执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`、trusted/restricted VS Code smoke，并同步更新设计文档验证状态。
- [x] (2026-05-06 07:48 +0800) 按最新交互反馈把模板 sidebar 从卡片式改成更贴近 VSCode 原生 sidebar 的紧凑列表样式，并重新执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`。
- [x] (2026-05-06 08:05 +0800) 继续把模板 section 与已对齐的 sidebar section 收口：移除内容区自定义工具栏，改为依赖 VSCode view title actions，只保留列表与状态提示，并再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`。
- [x] (2026-05-06 08:25 +0800) 根据实际回归截图重新实现模板 sidebar 的首屏渲染链路：不再把默认展开 section 的首屏内容完全依赖在 `ready` 握手后，改为 resolve 时主动刷新并先显示 loading / empty / issue 状态，避免出现整块空白。
- [x] (2026-05-06 08:38 +0800) 重新调研模板 sidebar 的承载方式后，去掉模板 section 的自绘 Webview，改为原生 `TreeView` + hover inline actions，并重新执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`、trusted/restricted smoke。
- [x] (2026-05-06 08:55 +0800) 按最新要求把模板 section 改回 `WebviewView`，并参考 `节点` / `会话历史` section 的扁平列表行样式与生命周期模式重写模板列表，再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`、trusted/restricted smoke。
- [x] (2026-05-06 09:20 +0800) 继续按最新交互反馈微调模板 sidebar：把 `内置 / 用户` 标签前置到标题行，并在每个模板末尾补上“追加到当前画布 / 重置为该模板”的快捷按钮，同时保留既有设默认、导出与删除动作。
- [x] (2026-05-07 00:15 +0800) 按最新视觉反馈继续微调模板 sidebar：把 `内置 / 用户` 标签移到第二行摘要前，同时让 `默认` 标签继续紧跟在第一行标题后，并重新执行 `npm run typecheck`、`npm run build`。
- [x] (2026-05-07 00:45 +0800) 按最新交互反馈把“保存模板”从 `showInputBox + showQuickPick` 改成表单式对话面板，一次性填写模板名称与 Agent Provider 保存策略，并重新执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`。
- [x] (2026-05-07 01:35 +0800) 继续按最新需求把保存模板表单收口为更贴近 VS Code 原生表单的布局，并支持按 Agent 分别设置 Provider、选择 workspace / 当前设备模板库与层级路径；同时让模板 sidebar 去掉目录提示，并把模板存储扩展为多根递归扫描，再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`。
- [x] (2026-05-07) 继续按最新反馈补齐导入模板表单：导入仅保留名称与保存位置选择，移除层级输入；sidebar tooltip 继续展示“模板所在层级”，并把表单字号/控件尺寸进一步收口到更接近 VS Code 原生风格；随后再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`。
- [x] (2026-05-07) 按最新交互反馈把模板 sidebar 行单击收口为只更新选中态，不再把模板追加到画布；显式应用仍通过右侧行内 `run` 动作、命令面板或画布右键菜单触发，并重新执行 `npm run typecheck`、`npm run test:canvas-templates`。
- [x] (2026-05-07) 按最新视觉反馈把模板 sidebar 尾部按钮移入标题行，并让第二行摘要独立占用整行宽度；窄侧栏下标题与摘要改为省略号退化而不是换行，并重新执行 `npm run typecheck`、`npm run test:canvas-templates`。
- [x] (2026-05-07) 按最新产品反馈移除模板 sidebar 底部“当前画布还没有可保存的 Agent / Terminal / Note 节点”提示，让模板 section 内容区只列出模板列表，并重新执行 `npm run typecheck`、`npm run test:canvas-templates`。
- [x] (2026-05-07) 按最新视觉反馈移除画布空白区右键菜单根层说明文案，只保留“画布操作”标题和操作项，并重新执行 `npm run typecheck` 与 targeted `npm run test:webview -- --grep "right-clicking the empty pane opens a quick-create menu near the pointer"`。
- [x] (2026-05-07) 按最新产品反馈把模板 sidebar 第二行位置标签扩展为 `内置 / 工作区 / 用户`，区分内置模板、workspace 模板和当前设备用户模板，并重新执行 `npm run typecheck`、`npm run test:canvas-templates`。
- [x] (2026-05-08 08:43 +0800) 按最新交互反馈实现模板应用后的组级追焦：宿主记录本次物化出的节点 id 组，显式应用 / 重置模板后向 Webview 发送组级聚焦消息，Webview 对这组节点执行 `fitView`；同时更新产品规格、设计文档与模板测试静态断言。
- [x] (2026-05-08 23:27 +0800) 修复组级追焦延后一拍的问题：Webview 收到 `host/focusNodes` 时改用最新 host node id ref 判定目标节点，并在 React Flow 尚未完成节点渲染时安排短间隔重试，避免第一次点击只缓存请求、第二次点击才追到上一组节点。
- [x] (2026-05-09 00:14 +0800) 按最新视觉反馈调整模板 sidebar 默认标识：默认模板在标题文本前显示 `(默认)`，设为默认按钮对当前默认模板显示填满星标且点击不再重复写入默认设置；同时补充产品规格、设计文档和模板测试断言。
- [x] (2026-05-09 00:44 +0800) 修复 PR review 反馈：Webview 右键“重置为模板 / 重置为默认模板”改为复用宿主 modal 确认后再清空画布；同时把正式文档中的旧三模板口径同步为当前 2 个内置模板。
- [x] (2026-05-09 01:17 +0800) 修复 PR review 反馈：首次打开默认模板因为 untrusted workspace 或 Provider 暂不可用而应用失败时，只临时回退到内置 `使用说明`，不再改写用户全局默认模板偏好；同时把 smoke acceptance 的内置模板数量收口为 2 个。
- [x] (2026-05-09 06:25 +0800) 修复 PR review 反馈：smoke 中“使用说明”模板断言同步为当前 1 个 Note；Webview ready/bootstrap 前统一执行首次默认模板初始化，覆盖 VS Code 直接打开 Panel view 与恢复 Editor webview 的路径。
- [x] (2026-05-09 07:00 +0800) 修复 PR review 反馈：smoke 直接注入 `webview/resetToTemplate` 时显式模拟“继续重置”确认；命令面板与 sidebar 模板入口改为应用后拿到新增节点 id，reveal 到最终承载面后再发起组级追焦，避免跨 surface 时追焦旧 Webview。

## 意外与发现

- 观察：当前 `CanvasPanelManager.createNode()` 与 Webview 的 `host/requestCreateNode` 链路默认会把新建 `Agent` / `Terminal` 节点置成 `pendingLaunch=start`，随后在节点尺寸就绪后自动启动。
  证据：`src/panel/CanvasPanelManager.ts` 的 `applyCreateNode()` 在 `agent` / `terminal` 分支里会把节点状态改成 `starting` / `launching` 并写入 `pendingLaunch`。

- 观察：宿主当前没有关于视口中心的权威状态，只有 Webview 本地 `vscode.setState(localUiState)` 持久化；如果模板重置要把整组节点精确放到当前视口中心，需要补一条显式的 Webview -> Host 视口信息回传。
  证据：`src/webview/main.tsx` 的 `handleMoveEnd()` 只更新本地 `localUiState.viewport`，`src/common/protocol.ts` 里没有现成的 `webview/updateViewport` 之类消息。

- 观察：现有侧栏列表能力已经有“概览 TreeView + 多个最小 WebviewView”的模式，模板视图可以沿用同样的宿主承载方式，而无需重新发明一个画布内面板。
  证据：`src/extension.ts` 已注册 `sidebarFilters`、`sidebarNodes`、`sidebarSessions` 三个独立视图，且 `CanvasSidebarNodeListView.ts` / `CanvasSidebarSessionHistoryView.ts` 已形成可复用模式。

- 观察：模板 sidebar 是默认展开的 section，而节点 / 会话历史默认更常以折叠态出现；如果模板 view 首屏只等 Webview `ready` 回传后才开始真正刷新，一旦握手时序抖动，就更容易直接暴露成“模板区整块空白”的用户可见问题。
  证据：最新回归截图中，模板 section header 已显示但内容区没有模板列表；同时当前实现直到 `sidebarTemplates/ready` 或 visible 变化后才会稳定补发状态。

- 观察：虽然模板列表的交互复杂度低于节点 / 会话历史，但用户明确要求它与那两个 section 保持一致的 `webview` 承载方式；因此最终更重要的是“对齐现有 sidebar 体系”，而不是单独追求最小实现。
  证据：用户最新要求明确指出“还是改成 webview 的类型，参考 节点section 和 历史会话section”。当前实现也确实改为与 `CanvasSidebarNodeListView.ts` / `CanvasSidebarSessionHistoryView.ts` 同类的 `WebviewViewProvider`。

- 观察：`host/focusNodes` 若在 `host/stateUpdated` 已处理但 React 当前闭包仍持有旧 `hostState` 时到达，会只把请求写进 pending ref；由于这时没有新的状态变化触发 pending effect，用户第一次点击不会追焦，下一次应用模板触发状态变化时才追到上一组节点。
  证据：实际调试复现为“点击应用模板按钮后不会追焦；再次点击应用模板按钮时，追焦前一次应用的模板节点组”。

- 观察：画布右键菜单的 `webview/resetToDefaultTemplate` / `webview/resetToTemplate` 消息直接走 `reset: true` 应用路径，会绕过命令面板重置模板时已有的 modal 确认。
  证据：`CanvasPanelManager.handleActiveWebviewMessage()` 原本在两个 webview reset case 中直接调用 `applyDefaultCanvasTemplate({ reset: true })` / `applyCanvasTemplateById(..., { reset: true })`。

- 观察：内置模板资产已收口为 `resources/templates/01-getting-started.json` 与 `resources/templates/02-basic-workflow.json` 两个文件，第二个模板名称是“示例模板”，但部分正式文档仍保留旧三模板口径。
  证据：`resources/templates/` 当前只有两个 JSON；`docs/product-specs/canvas-template-feature.md` 原 4.5 节仍有已移除的第三模板小节。

## 决策记录

- 决策：模板采用独立的 `CanvasTemplateDocument` 模型，而不是直接导出 `CanvasPrototypeState`。
  理由：宿主状态混有运行时字段、文件活动域和节点 id，直接导出会把“当前会话事实”误写成模板事实；独立模型才能明确筛掉非模板字段。
  日期/作者：2026-05-06 / Codex

- 决策：模板应用创建的 `Agent` / `Terminal` 节点一律保持 idle，不走现有自动启动链路。
  理由：产品规格明确排除运行时状态；如果应用模板就自动开跑，会把“复用布局”误做成“恢复执行会话”。
  日期/作者：2026-05-06 / Codex

- 决策：默认模板 id 存在 `globalState`，而“当前 workspace 是否已经完成首次模板初始化”单独记在 workspace 作用域持久化中。
  理由：默认选哪一个模板是用户级偏好，但“这个 workspace 的第一次打开是否已经处理过”必须是 workspace 自己的事实。
  日期/作者：2026-05-06 / Codex

- 决策：模板新增落位使用“以视口中心为首选锚点的组级避碰搜索”，而不是对模板内每个节点分别调用现有单节点摆放算法。
  理由：模板是一个相对布局整体；逐节点单独避碰会打散模板内部结构，不再符合“复用工作面”的产品目标。
  日期/作者：2026-05-06 / Codex

- 决策：模板中的 Agent `argv` 在宿主态以结构化参数数组暂存，并在真正启动时再与当前 Provider 命令组合，而不是把完整 command line 原样固化回模板。
  理由：产品规格把 `argv` 纳入模板内容、但明确排除了 command 配置；用结构化 `argv` 过渡可以既保留模板意图，又避免把用户机器上的命令路径写进模板文件。
  日期/作者：2026-05-06 / Codex

- 决策：模板 sidebar 从最小 `WebviewView` 改为原生 `TreeView`，由 `TreeDataProvider` 直接输出模板条目、损坏文件条目与空状态条目。
  理由：用户明确要求模板 section 更贴近 VSCode 原生 sidebar；模板列表又恰好是 TreeView 的典型场景。这样既能消除 `ready` 握手导致的空白首屏风险，也能顺手删掉模板 sidebar 专用的 DOM 测试链路与额外样式负担。
  日期/作者：2026-05-06 / Codex

- 决策：模板 sidebar 最终仍使用 `WebviewView`，但在布局、状态提示与首屏生命周期上主动对齐 `节点` / `会话历史` section，而不是继续保留之前模板专属的卡片式实现。
  理由：这是用户给出的明确交互要求；同时 `WebviewView` 也更适合承载模板行右侧动作与多状态提示。为避免旧 blank bug，新的实现保留了“初始 loading + resolve 后立即 refresh + ready 后再次 refresh”的双保险模式。
  日期/作者：2026-05-06 / Codex

- 决策：模板 sidebar 的整行单击和键盘 `Enter` / `Space` 只负责选中当前模板，不直接执行 `apply`。
  理由：模板应用会改变画布内容，必须由行内 `run` 动作、命令面板或画布右键菜单这类显式动作触发，避免用户浏览列表时误把模板追加到画布。
  日期/作者：2026-05-07 / Codex

- 决策：模板 sidebar 的行内动作放在标题行尾部，第二行摘要不再与按钮共享列宽，所有可变文本在窄宽度下用省略号退化。
  理由：sidebar 宽度经常被用户拖动；按钮如果作为整行尾列会压缩第二行摘要并导致换行撑高条目，不符合紧凑原生列表的稳定信息密度。
  日期/作者：2026-05-07 / Codex

- 决策：模板 sidebar 内容区不展示“当前画布是否可保存”提示。
  理由：模板 section 的产品功能是列出和管理模板列表；当前画布是否满足保存条件属于保存命令执行时的反馈，不应常驻在模板列表底部。
  日期/作者：2026-05-07 / Codex

- 决策：画布空白区右键菜单根层不展示“先创建节点，再通过横线下方的模板分组执行模板操作”说明文案。
  理由：该菜单已经通过顺序和分隔线表达结构，额外说明显得重复且占用首屏空间；根层应聚焦标题与可执行操作。
  日期/作者：2026-05-07 / Codex

- 决策：模板 sidebar 的标签使用精简组合：内置模板显示 `内置`，市场模板显示 `市场 · 本地/工作区`，用户保存或导入的模板显示 `自建 · 本地/工作区`。
  理由：workspace 模板和当前设备用户模板都属于用户可写模板，但作用域不同；市场模板也仍是本地用户模板格式，需要在侧栏同时区分来源和保存位置，避免用户误判模板资产来源或操作目标；内置模板没有用户可选保存位置，因此不显示位置。
  日期/作者：2026-05-07，2026-05-12 更新 / Codex

- 决策：模板应用后的自动追焦以“本次物化出的节点 id 组”为单位，由宿主在状态更新后发送 `host/focusNodes`，Webview 再对整组节点执行 `fitView`。
  理由：模板是一个相对布局整体；如果只聚焦第一个节点，用户仍可能看不到整组模板结构。追焦放在状态更新之后，并允许 Webview 在新节点尚未渲染时暂存请求，可避免消息时序早于 React Flow 节点渲染导致定位失败。首次打开默认模板初始化不走这条显式追焦路径，继续交给初始 `fitView` 处理。
  日期/作者：2026-05-08 / Codex

- 决策：组级追焦的即时判定不再读取 React 闭包里的 `hostState`，而改读 `latestHostNodeIdsRef`；如果 `fitView` 当下仍失败，则通过有限次数短间隔重试兜住 React Flow 节点渲染晚于消息处理的情况。
  理由：消息监听器是长期注册的稳定回调，闭包中的 `hostState` 可能不是最新状态；使用 ref 能读到最近一次 `host/stateUpdated` 的节点集合，重试则避免把 pending 请求卡到下一次用户操作才执行。
  日期/作者：2026-05-08 / Codex

- 决策：模板 sidebar 的默认状态不再用独立 badge 表示，而改为标题文本前缀 `(默认)`；设为默认按钮始终可见，当前默认模板使用填满星标并且点击为 no-op。
  理由：默认状态属于模板标题的限定信息，文本前缀比额外 badge 更轻；保留星标位置能避免行内动作数量随默认状态变化而跳动，同时填满星标表达“已经是默认”。
  日期/作者：2026-05-09 / Codex

- 决策：模板重置确认收口到 `CanvasPanelManager`，Webview 和命令面板重置入口都调用同一组 `reset*WithConfirmation` 方法。
  理由：重置会清空画布并终止运行会话，是破坏性动作；确认逻辑必须靠近真正执行 reset 的宿主状态层，避免新增入口绕过确认。
  日期/作者：2026-05-09 / Codex

- 决策：当前正式内置模板数量为 2 个，即“使用说明”和“示例模板”；不恢复已经移除的第三个模板。
  理由：当前资源资产已经只发布两份内置模板，文档应描述实际可见产品事实，不能把已移除模板继续写成验收口径。
  日期/作者：2026-05-09 / Codex

## 结果与复盘

本轮已完成画布模板功能的正式交付：默认模板首次打开自动应用、模板侧栏与命令入口、导入导出与默认模板管理、组级避碰落位、restricted note-only 限制，以及 Agent `argv` 的保存与回放链路均已落地。随后又按最新交互要求把空白区右键菜单调整为“先节点创建、后横线分组的模板操作”，并让“应用模板 / 重置为模板”同时支持一级默认模板快速操作与二级具体模板选择菜单；模板 sidebar 最终保持 `WebviewView`，但在布局、间距、title actions 与行级交互上向 `节点` / `会话历史` section 收口，同时继续保留修掉 blank bug 所需的首屏 loading + 主动 refresh 机制。

在本轮最新收口中，模板表单继续统一为一套可复用骨架：保存模板时显示名称 / 保存位置 / Agents Provider 设置；导入模板时复用同一套布局，但只保留名称 / 保存位置输入。与此同时，sidebar tooltip 会额外展示“模板所在层级：保存位置 / 相对目录”，用于区分同名模板；表单本身也通过更小字号、2px 圆角输入框、右对齐底部按钮等细节进一步贴近 VS Code 原生面板。

侧栏模板列表的主交互也已进一步收口：单击模板行只改变选中态，追加模板必须点击行尾 `run` 动作或走命令 / 右键菜单入口，避免用户在浏览模板时误改画布内容。

随后继续调整了列表行的响应式布局：行尾动作按钮挂到标题行内，第二行摘要不再被按钮列挤压；侧栏变窄时标题和摘要都以 `...` 逐步退化，不再换行改变行高。

最新收口中还移除了模板列表底部的“当前画布还没有可保存的 Agent / Terminal / Note 节点”提示，让模板 section 内容区只保留模板列表本身；保存条件相关反馈回到保存命令自身处理。

右键菜单也继续收口：根层标题区不再显示“先创建节点，再通过横线下方的模板分组执行模板操作”这类说明句，只保留“画布操作”标题和实际操作项。

模板 sidebar 的第二行标签已收敛为精简组合：内置模板显示 `内置`，用户保存或导入的模板显示 `自建 · 本地/工作区`，市场下载安装的模板显示 `市场 · 本地/工作区`；tooltip 继续展示更具体的保存位置与相对层级。

显式应用模板和重置为模板现在会在状态更新后自动追焦到本次新增的节点组。宿主的模板物化函数会返回新增节点 id，`CanvasPanelManager` 在用户发起的模板应用路径上发送 `host/focusNodes`，Webview 收到后对整组节点执行 `fitView`；如果新节点还没完成渲染，Webview 会暂存这次组级聚焦请求，等下一次状态/React Flow ready 后再执行。首次打开自动套用默认模板仍沿用初始 `fitView`，不会额外制造一次追焦动画。

该追焦链路随后修复了“延后一拍”问题：Webview 现在收到 `host/focusNodes` 后直接用最新节点 id ref 尝试追焦，并在节点尚未进入 React Flow 内部视图时主动重试，不再依赖下一次模板应用或其他 host state 更新来触发 pending 请求。

模板 sidebar 的默认标识也继续收口：默认模板标题前直接显示 `(默认)` 文本，标题行不再额外挂默认 badge；行内星标按钮保持固定位置，非默认模板为空心星标并可设为默认，当前默认模板为填满星标且点击不改变设置。

PR review 后继续修复两处一致性问题：第一，Webview 右键菜单的重置模板入口现在不再直接调用 `reset: true` 应用路径，而是复用宿主侧 modal 确认方法，用户取消时不会清空画布或终止会话；第二，产品规格、设计文档和本计划中的内置模板数量统一为当前实际的 2 个模板，不再保留已移除第三模板的旧口径。

本轮验证结果如下：

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run test:canvas-templates` 通过。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=restricted node scripts/run-vscode-smoke.mjs` 通过。
- 模板 sidebar 改为原生风格后再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`，均通过。
- 模板 section 去掉内容区自定义工具栏、改为依赖 title actions 后再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`，均通过。
- 模板 sidebar 首屏渲染链路重做后，再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`，均通过。
- 模板 sidebar 切到原生 TreeView 后再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`、trusted smoke 与 restricted smoke，均通过。
- 模板 sidebar 改回 `WebviewView`、并按节点 / 会话历史 section 风格重写后，再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`、trusted smoke 与 restricted smoke，均通过。
- 导入模板表单收口为仅保留保存位置选择、sidebar tooltip 补充模板所在层级、保存/导入表单字号和控件尺寸继续向 VS Code 原生风格收口后，再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`，均通过。
- 模板 sidebar 行单击改为只选中后，再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已补充静态断言，覆盖行 click / keyboard handler 不发送 `sidebarTemplates/applyTemplate`，而行内 `run` 动作仍发送应用消息。
- 模板 sidebar 按钮同标题行、第二行 nowrap + ellipsis 布局调整后，再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已补充静态断言覆盖按钮挂载位置和不换行退化规则。
- 模板 sidebar 底部保存条件提示移除后，再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已补充静态断言覆盖 `hintNote` / `hint-note` / `canSaveCurrentCanvas` 不再出现在模板 sidebar 源码中。
- 画布空白区右键菜单根层说明文案移除后，再次执行 `npm run typecheck` 与 `npm run test:webview -- --grep "right-clicking the empty pane opens a quick-create menu near the pointer"`，均通过；Playwright harness 已补充断言覆盖根层仍显示“画布操作”标题且不再显示“先创建节点”说明。
- 模板 sidebar 精简组合标签补齐后，再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已补充静态断言覆盖 workspace scope 映射为 `工作区`、市场来源映射为 `市场`，以及行内 badge 使用 `item.locationLabel`。
- 模板应用后组级追焦补齐后，再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已补充静态断言覆盖宿主返回新增节点 id、发送 `host/focusNodes`，以及 Webview 对该节点组执行 `fitView`。
- 组级追焦延后一拍修复后，再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已补充静态断言覆盖 Webview 使用 `latestHostNodeIdsRef` 判定目标节点，并在首次 `fitView` 失败时调度追焦重试。
- Webview 重置确认与跨 surface 命令追焦修复后，再次执行 `git diff --check`、`npm run typecheck`、`npm run build`、`npm run test:canvas-templates` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`，均通过；`test:canvas-templates` 已补充静态断言覆盖命令入口在 reveal 最终承载面后再触发组级追焦。

剩余取舍与已知边界：

- 用户手动把 JSON 复制到模板目录后，侧栏刷新仍以模板目录变更事件或显式刷新时的重新扫描为主，本轮没有补实时文件系统监听。
- 内置模板文案已按当前已实现交互收口为保守版本；后续若 UX 需要更细文案，可继续只改模板资源与文案说明，不必推翻当前模型。

## 上下文与定向

这次功能横跨五个区域。

第一处是正式文档层。产品规格位于 `docs/product-specs/canvas-template-feature.md`，当前还没有对应正式设计文档；本轮新增 `docs/design-docs/canvas-template-feature.md` 作为正式方案来源，并同步更新 `docs/design-docs/index.md`。

第二处是宿主权威状态层。`src/panel/CanvasPanelManager.ts` 当前拥有画布节点图、持久化、命令接线和运行时生命周期，因此模板的默认首次应用、模板物化、Provider 校验、导入/导出和删除都必须从这里发起，不能让 Webview 自己持有模板真相。

第三处是共享模型与文件存储层。当前仓库还没有模板领域模型，需要新增一个独立模块来定义模板文件格式、版本号、节点/边快照和摘要函数；同时需要一个宿主侧文件存储模块来读 `resources/templates/` 与 `globalStorageUri/templates/`。

第四处是侧栏与命令入口。`src/extension.ts` 与 `package.json` 当前已经承载多个 sidebar section；模板功能需要在这里新增 view 和 command contribution，并把命令面板、侧栏按钮与 Webview 右键入口收敛到同一条宿主实现。

第五处是 Webview 交互层。`src/webview/main.tsx` 当前的空白区右键菜单只负责新建节点，且视口中心只保留在本地状态里；模板功能需要在这里补模板动作入口，并把当前可见区域中心显式传回宿主，供模板组级落位使用。

## 工作计划

先补齐正式设计文档和执行计划，让模板模型、默认模板边界、侧栏承载方式以及“不自动启动执行节点”的关键规则先在文档中落定。否则后续代码很容易被现有 `createNode()` 自动启动链路牵着走，偏离产品规格。

然后拆出模板领域模型与宿主文件存储。`src/common/canvasTemplates.ts` 负责定义版本化模板文档、节点/边快照、模板摘要和解析函数；`src/panel/CanvasTemplateStore.ts` 负责读写内置模板目录与用户模板目录，并暴露导入、导出、删除和模板列表刷新能力。这样既方便 `CanvasPanelManager` 编排，也方便单独做纯数据测试。

接着扩展 `CanvasPanelManager`。重点是新增四类宿主能力：一是首次打开时的默认模板自动应用与 workspace 初始化标记；二是模板保存与模板应用的状态转换，包括 Provider 校验和 restricted-mode 限制；三是模板列表刷新通知与默认模板持久化；四是重置到模板与追加模板的组级摆放算法。这里也要补一个最小的视口中心缓存结构，用来消费 Webview 回传的可见区域中心。

随后接入交互面。`src/extension.ts`、`package.json`、`package.nls.json` 新增模板命令和模板 sidebar view；`src/sidebar/CanvasSidebarTemplateView.ts` 用最小 `WebviewViewProvider` 输出模板列表、默认标记、损坏文件状态与右侧轻量行内动作；`src/webview/main.tsx` 与 `src/common/protocol.ts` 新增模板右键菜单动作和视口中心消息。

最后补自动化验证。纯数据层至少要覆盖模板序列化/反序列化、冲突处理、模板摘要和组级落位算法；宿主 smoke 至少要覆盖首次默认模板、保存再应用不自动启动、设为默认后重置、导入冲突与 restricted note-only 路径。完成后更新本计划与设计文档的 `当前验证状态`。

## 具体步骤

1. 文档与索引：

   - 新增 `docs/design-docs/canvas-template-feature.md`
   - 更新 `docs/design-docs/index.md`
   - 新增 `docs/exec-plans/active/canvas-template-feature.md`

2. 模板领域模型与存储：

   - 新增 `src/common/canvasTemplates.ts`
   - 新增 `src/panel/CanvasTemplateStore.ts`
   - 新增 `resources/templates/*.json`

3. 宿主编排与命令：

   - 更新 `src/common/extensionIdentity.ts`
   - 更新 `src/common/protocol.ts`
   - 更新 `src/panel/CanvasPanelManager.ts`
   - 更新 `src/extension.ts`
   - 更新 `package.json`
   - 更新 `package.nls.json`

4. 侧栏与 Webview：

   - 新增 `src/sidebar/CanvasSidebarTemplateView.ts`
   - 更新 `src/webview/main.tsx`
   - 必要时更新 `src/webview/styles.css`

5. 测试与验证：

   - 新增 / 更新相关 `scripts/test-*.mjs`
   - 更新 `tests/vscode-smoke/extension-tests.cjs`
   - 在仓库根目录运行：

         npm run typecheck
         node scripts/test-canvas-templates.mjs
         DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs

## 验证与验收

需要满足以下可观察结果。

第一，第一次打开新 workspace 的画布时，会直接出现默认“使用说明”模板，而不是空白画布；如果用户已经把别的模板设为默认，首次打开和“重置为默认模板”都应改用新默认模板。当当前 workspace 暂时不能应用用户默认模板时，首次打开只临时回退到“使用说明”，并保留用户的全局默认模板设置。

第二，用户从当前画布保存模板后，再从侧栏或命令面板应用该模板时，节点标题、相对布局、Note 内容和边样式会被重建，但 `Agent` / `Terminal` 仍保持 idle，不会自动启动。

第三，在当前画布已有节点的情况下追加模板，整组模板节点会整体避开现有节点，而不是打散或重叠。

第四，模板侧栏可以看到 2 个内置模板和新增的用户模板，能执行应用、设为默认、导出、删除等动作；删除当前默认用户模板后，会自动回退到“使用说明”。

第五，导入无效 JSON、导入同名模板、应用不可用 Provider 模板时，宿主会给出明确提示，并阻止不安全操作。

## 幂等性与恢复

这次改动应保持幂等。重复刷新模板目录不应产生重复模板项；重复应用同一个模板只会新增一份新的节点集，不会覆盖已有节点 id。首次模板初始化标记一旦写入，就不应因为用户后续主动清空画布而被自动重置。

若导入流程中途失败，恢复策略是“先验证、后落盘”：只有模板文件通过版本和字段校验后，才写入用户模板目录；导出则先解析模板，再调起保存对话框。模板应用失败时，整次操作应保持原画布状态不变，不允许部分节点已经写入、部分节点被阻断。

## 证据与备注

- 2026-05-06：`npm run typecheck`、`npm run build`、`npm run test:canvas-templates` 均通过。
- 2026-05-06：`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 输出 `Trusted workspace smoke passed.`。
- 2026-05-06：`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=restricted node scripts/run-vscode-smoke.mjs` 输出 `Restricted workspace smoke passed.`。

## 接口与依赖

本轮实现至少会触达以下接口与模块：

- `src/common/canvasTemplates.ts`
  - `CanvasTemplateDocument`
  - `CanvasTemplate`
  - `CanvasTemplateNodeSnapshot`
  - `CanvasTemplateEdgeSnapshot`
  - 模板解析、摘要和默认 Provider 归一化辅助函数

- `src/panel/CanvasTemplateStore.ts`
  - 读取内置模板与用户模板目录
  - 保存、删除、导入、导出用户模板

- `src/panel/CanvasPanelManager.ts`
  - 默认模板首次应用逻辑
  - 模板保存 / 应用 / 重置 / 删除 / 设为默认
  - 组级摆放算法
  - 模板列表变更事件

- `src/webview/main.tsx`
  - 空白区右键菜单模板动作
  - 当前可见区域中心回传

- `src/sidebar/CanvasSidebarTemplateView.ts`
  - 模板列表渲染、tooltip、行内动作和刷新

---

本次创建说明：2026-05-06 新建本计划，用于覆盖 Canvas 模板功能的正式设计、宿主持久化、侧栏承载、Webview 交互和自动化验证。之所以独立起计划，是因为该功能同时改动产品默认入口、宿主状态、用户模板文件、侧栏与画布交互，复杂度明显超过单点修补。
