---
title: 画布模板功能设计
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-template-feature.md
related_plans:
  - docs/exec-plans/active/canvas-template-feature.md
  - docs/exec-plans/active/canvas-template-associated-note-modes.md
updated_at: 2026-05-14
---

# 画布模板功能设计

## 1. 背景

当前画布已经具备 `Agent`、`Terminal`、`Note` 三类核心对象，以及宿主权威状态、画布右键新建、侧栏节点列表/会话历史等基础能力，但它仍然缺少“把一组已验证工作面复用回来”的正式机制。

这会在三个层面直接损伤主路径：

1. 新用户第一次打开空画布时，没有可直接照着操作的内置示例。
2. 熟悉产品的用户每次都要重新摆放相似节点、重新写说明 Note，重复成本高。
3. 团队内部无法把一组标准化工作流以仓库外可分享的文件形式稳定流转。

模板功能因此不是“多一个导入导出按钮”的外围增强，而是把“空白画布”升级成“可教学、可复用、可分享的工作面起点”。

## 2. 问题定义

本轮需要明确以下边界：

1. 模板是宿主权威状态的哪一层抽样，哪些节点/字段应该进入模板，哪些绝不能进入。
2. 内置模板、用户模板和“当前默认模板”分别存放在哪里，谁拥有它们的生命周期。
3. 应用模板时，如何避免把“保存布局”误做成“恢复运行时”，尤其是 `Agent` / `Terminal` 不应在应用模板时自动开跑。
4. 模板的放置规则是什么：首次打开、清空后重置、在现有画布中新增，三种场景分别如何定位。
5. 用户从哪里管理模板：侧栏、命令面板和画布空白区右键菜单之间怎样分工。
6. `default` Provider 与具体 `codex` / `claude` Provider 的语义如何落地，何时解析，何时阻断。

## 3. 目标

- 让画布第一次打开时就能带着默认模板进入可操作状态，而不是把学习成本外包给 README。
- 让用户可以把当前画布中的标准化布局保存成模板，并在后续 workspace 中快速复用。
- 让模板的导入、导出、设为默认、删除都走稳定的宿主路径，可通过侧栏和命令面板访问。
- 让模板始终只表示“布局与静态配置”，不把会话、输出、文件活动或自动启动副作用偷偷带进去。

## 4. 非目标

- 不在本轮实现模板云同步、模板市场、标签系统或使用统计。
- 不在本轮保存 `Agent` 的运行时输出、会话 id、自定义 command line、resume 信息或 `Terminal` scrollback。
- 不在本轮把文件节点、文件列表节点、文件活动边纳入模板可保存范围。
- 不把关联 Markdown `Note` 的 raw `resourceUri`、本机绝对路径或 `vscode-remote://...` 这类实现层 URI 直接写入模板；需要保留文件关联时，只使用 workspace 相对路径。
- 不在本轮实现缩略图预览、拖拽排序、批量操作或模板版本历史。

## 5. 候选方案

### 5.1 直接把当前 `CanvasPrototypeState` 整体当成模板文件

优点：

- 宿主已有完整序列化逻辑，最省实现。
- 可以天然复用节点 id、边 id 和现有快照结构。

不选原因：

- 现有状态里混有运行时字段、文件活动域状态、节点 id 和宿主持久化痕迹，导出后会把“当前会话事实”错误伪装成模板事实。
- 现有 `Agent` / `Terminal` 节点默认带 `pendingLaunch`、`recentOutput`、`resume*` 等宿主运行态，不适合跨用户分享。
- 直接导入整份状态还会把“应用模板”误做成“替换整个 workspace 绑定快照”，破坏模板与宿主状态的边界。

### 5.2 模板只保存最小快照，并在应用时重新物化成新的节点/边

优点：

- 可以显式筛掉运行时字段，只保留节点类型、标题、布局、Note 内容、边样式和 Agent Provider 这类静态信息。
- 应用模板时可以重新分配节点 id，避免与现有画布节点冲突。
- 可以把 `Agent` / `Terminal` 明确物化为 idle 节点，阻断自动启动副作用。

当前取舍：

- 采用这条路径，模板与宿主快照保持不同的数据模型。
- 模板快照中的边改为用“节点索引”引用，而不是宿主节点 id；这样导入、导出和重新落位都更稳定。

### 5.3 默认模板按 workspace 保存

优点：

- 每个仓库可以有自己的默认模板，不会互相影响。

不选原因：

- 产品规格把模板定义为用户级可分享资产，用户模板也落在 `globalStorageUri`。默认模板如果改成 workspace 级，会把“模板资源”和“模板偏好”拆成两套语义。
- 当前没有产品规格要求“每个 workspace 一套默认模板”；先收敛为用户级更符合最小实现。

### 5.4 默认模板按用户全局保存，首次应用判定按 workspace 记录

优点：

- “默认用哪一个模板”是用户全局偏好。
- “这个 workspace 是否已经完成首次模板初始化”仍然能由 workspace 自己决定，不会因为另一个仓库的操作污染当前仓库。

当前取舍：

- 采用这条路径：默认模板 id 进 `globalState`，而“是否已完成首次模板初始化”进 `workspaceState` / 当前工作区持久化路径。

## 6. 风险与取舍

- 风险：如果模板应用沿用现有 `createNode()` 自动启动链路，`Agent` / `Terminal` 模板会在导入瞬间开跑。
  当前缓解：模板应用不走自动启动创建路径，而是直接在宿主中物化为 idle 节点，再由用户手动启动。

- 风险：用户手动把 JSON 复制进模板目录后，侧栏列表不会天然收到 VS Code 级刷新信号。
  当前缓解：模板侧栏 `WebviewView` 在宿主模板目录变更事件、可见性恢复或显式刷新时重新读取目录；本轮不承诺文件系统实时监听。

- 风险：同名导入若与内置模板冲突，“覆盖”语义会变得模糊，因为内置模板不可删除。
  当前缓解：仅允许覆盖已有用户模板；若冲突对象是内置模板，只提供重命名路径。

- 风险：产品规格中的“使用说明模板快捷键文案”仍有 UX 细化空间。
  当前缓解：本轮先交付一份只包含已实现交互的保守文案，不把未实现快捷键写成既成事实。

## 7. 正式方案

本方案的主要实现落点集中在：

- `src/common/canvasTemplates.ts`：模板领域模型、版本校验、摘要和纯数据辅助函数。
- `src/panel/CanvasTemplateStore.ts`：内置模板 / 用户模板文件的读取、写入、导入和删除。
- `src/panel/CanvasPanelManager.ts`：默认模板首次应用、模板物化、Provider 校验、命令入口与宿主权威状态更新。
- `src/panel/CanvasTemplateSaveFormPanel.ts`：保存模板时使用的表单式对话面板。
- `src/sidebar/CanvasSidebarTemplateView.ts`：模板列表侧栏视图。
- `src/extension.ts` / `package.json` / `package.nls.json`：命令、view contribution 和交互文案。
- `src/webview/main.tsx` / `src/common/protocol.ts`：空白区右键菜单中的模板动作，以及视口中心信息回传。
- `resources/templates/*.json`：2 个内置模板的正式资产。

### 7.1 模板模型与版本边界

模板不直接复用 `CanvasPrototypeState`，而是定义独立的 `CanvasTemplateDocument`：

- 文档层包含 `version`，当前固定为 `1`。
- `CanvasTemplate` 本体包含 `id`、`name`、`category`、`nodes`、`edges`、`createdAt`、`updatedAt`。
- 模板节点只允许 `agent`、`terminal`、`note` 三类；`file` 与 `file-list` 不进入模板。
- 模板边只保存用户可见的几何与样式字段：源/目标节点索引、anchor、arrowMode、color、label。
- 普通 `Note` 默认只保存内容快照；关联 Markdown `Note` 在保存模板时由用户选择内容模式：普通内容快照、仅 workspace 相对路径、workspace 相对路径加文件内容。`Terminal` 不保存运行时字段；`Agent` 只保存模板专属 `provider` 和可选 `argv`/后续兼容位，不保存 resume、command line、recentOutput、pendingLaunch 等宿主运行态。

这意味着导出的模板文件是稳定的“可分享布局对象”，而不是某个 workspace 的宿主快照副本。

### 7.2 内置模板、用户模板与默认模板的存储

- 内置模板是只读 JSON 资产，固定放在仓库 `resources/templates/`，随扩展一起发布。
- 用户模板不再只放在单一 `globalStorageUri` 目录，而是支持两类用户可写模板根：
  - `context.globalStorageUri.fsPath/templates/`：当前设备级模板库
  - `<workspace>/.dev-session-canvas/templates/`：当前 workspace 级模板库
- 两类用户模板根都支持继续使用多级子目录（例如 `team/backend/`）组织模板；侧栏读取时会递归扫描 JSON 文件。
- 当前默认模板 id 存在 `context.globalState`；如果值缺失、指向不存在模板，或所指模板被删除，则自动回退到内置 `使用说明` 模板。
- 若当前默认模板存在、但因为 workspace 未受信任或执行 Provider 暂时不可用而无法在首次打开时应用，宿主只临时套用内置 `使用说明` 作为安全起点，不改写 `globalState` 中的默认模板偏好。
- `workspaceState` 额外记录“当前 workspace 是否已经完成首次模板初始化”。首次打开画布时，如果当前宿主状态为空且该标记尚未置位，则宿主会在任一交互式 Webview 发送 `host/bootstrap` 前先应用当前默认模板，再把结果作为首次画布状态发送给 Webview；这同时覆盖命令显式打开、VS Code 直接展开 Panel view、以及恢复 Editor webview 的路径。
- 显式执行“清空画板”为纯空画布时，会把首次初始化标记保留为已完成，避免下次打开又自动回填默认模板。

### 7.3 模板保存语义

“保存为模板”始终从宿主权威 `CanvasPrototypeState` 提取数据，但只抽取模板兼容子集：

- 仅保存 `agent`、`terminal`、`note` 节点；自动文件节点与文件列表节点会被忽略。
- 仅保存两端都仍在模板节点集合中的用户边；文件活动边和悬空边被排除。
- 节点坐标先求整体 bounding box，再转换成相对左上角坐标；这样模板可在任意锚点下重建原始相对布局。
- 宿主节点 id 只作为保存瞬间的临时映射键使用：保存流程用当前节点 id 把用户边转换成模板节点索引、把每个 Agent 的 Provider 选择匹配到对应节点，但模板文件本身不写入任何画布节点 id。
- 保存时通过一个接近 VS Code 原生表单风格的对话面板，一次性完成以下输入，而不是拆成多段 Quick Input：
  - 模板名称
  - 保存位置（workspace 级模板库 / 当前设备模板库这类模板库根位置）
  - 当前画布中每个 Agent 节点各自的 Provider 选择
  - 当前画布中每个关联 Markdown `Note` 的保存策略
- Provider 不再只支持“整份模板统一 default / preserve”二选一；保存面板会列出当前所有 Agent 节点，并允许每个节点分别保存为：
  - `default`：模板不固定该节点 Provider，应用时解析为用户当前默认 Provider。
  - `codex` / `claude`：模板固定该节点使用指定 Provider。
- Agent 的 `argv` 会在保存前先由宿主按当前节点启动配置解析成结构化参数数组，再写入模板；这样模板保存的是“这组参数本身”，而不是某次运行使用的完整命令字符串。
- 保存出的 Agent 节点一律不带 `pendingLaunch`、`recentOutput`、`resumeSessionId`、`lastLaunchCommandLine` 等运行态字段，因此模板只描述工作面，不描述运行时。
- 关联 Markdown `Note` 的保存策略按节点逐项选择：
  - `保存为普通 Note 内容快照`：宿主读取 Markdown 文件当前落盘内容并写入模板，应用模板后物化为普通内嵌 `Note`，不再保留文件关联；如果文件不可读或存在编辑冲突，保存流程必须提示用户先处理文件，不能静默保存旧 buffer。
  - `仅保留 workspace 相对路径`：模板只保存规范化相对路径，例如 `docs/plan.md`；应用模板时尝试关联当前 workspace 中对应文件，不把文件正文写入模板。
  - `保留 workspace 相对路径和文件内容`：模板保存相对路径和当前落盘正文；应用模板时如果文件不存在则创建文件并写入模板正文，如果文件已存在但内容不同则物化为关联 Markdown `Note` 的 `dirty-conflict` 状态，把模板正文作为冲突草稿留在节点内处理。
- 三种策略的设计定位不是“保存多一点 / 少一点”，而是三种模板语义：
  - `保存为普通 Note 内容快照` 服务内容型模板。模板拥有这段 Note 正文，路径只是内容来源；应用后不再保留文件关联，适合 checklist、说明文字、会议模板、需求澄清问题列表等可跨 workspace 复用且不应暴露源文件路径的内容。
  - `仅保留 workspace 相对路径` 服务仓库文件入口型模板。真实 Markdown 文件仍是权威来源，模板只声明“这里应关联当前 workspace 的这个相对路径”；应用后读取目标 workspace 的最新文件内容，适合 `README.md`、`docs/architecture.md`、`docs/plan.md` 这类团队约定路径或项目已有文档入口。workspace 内关联 `Note` 的默认推荐策略是这一项。
  - `保留 workspace 相对路径和文件内容` 服务文件资产 / 脚手架型模板。模板既声明文件入口，也携带可写入的 Markdown 初始内容；适合新项目初始化、ADR/需求/发布 checklist 等需要随模板创建或恢复配套文档的场景。因为模板会保存正文并可能写入 workspace，保存和应用都必须显式处理隐私、缺失文件和内容冲突。
- 只有能解析到当前 workspace 内 `.md` / `.markdown` 文件的关联 `Note` 才能选择两种 workspace 相对路径策略；workspace 外文件只能保存为普通内容快照。相对路径必须拒绝绝对路径、空路径和 `..` 越界段。
- “导入模板”复用同一套表单骨架，但隐藏 Agent Provider 区，仅保留名称与保存位置输入；这样用户在导入时也能决定模板落在哪个模板库中。

### 7.4 模板应用语义

模板应用分成两类：

1. `apply`：把模板节点追加到现有画布。
2. `reset`：先清空当前 workspace 绑定画布及运行中会话，再应用模板。

两条路径都由宿主 `CanvasPanelManager` 负责，Webview 只负责提供当前可见区域中心点或右键位置等定位线索。应用时遵循以下不变量：

- 所有新节点都重新分配宿主节点 id，边也生成新的 edge id。
- `Agent` 与 `Terminal` 模板节点被物化成 idle 节点，不自动启动。
- `Agent` 模板节点的 Provider 先按模板值解析：
  - `default` -> 当前配置的默认 Provider。
  - `codex` / `claude` -> 固定使用该 Provider。
- 若模板携带 `argv`，宿主会把它暂存到节点 metadata 中，并在真正启动时再与当前 Provider 命令组合，避免把用户机器上的 command path 固化进模板或运行态快照。
- 若模板要求的固定 Provider 当前不可用（例如 CLI 命令无法解析），宿主提示用户并阻止整次应用；不静默降级。
- 若当前 workspace 未受信任，含 `agent` / `terminal` 的模板不可应用；仅 `note` 模板允许通过。
- 应用含 workspace 文件 `Note` 的模板时，宿主先解析模板相对路径，再物化节点：
  - `仅保留 workspace 相对路径` 且目标文件存在时，节点恢复为关联 Markdown `Note`；目标文件缺失时，用户可选择创建空 Markdown 文件并关联，或保留一个状态为“关联文件缺失”的节点。
  - `保留 workspace 相对路径和文件内容` 且目标文件不存在时，宿主创建父目录和文件并写入模板正文；目标文件存在且内容不同，则仍创建关联 Markdown `Note`，节点正文显示现有文件内容，同时把模板正文作为 `dirty-conflict` 草稿，通过节点内冲突提示提供重新加载现有文件、复制草稿和覆盖文件动作。默认不静默覆盖，也不在应用前弹出 modal。
  - 如果应用发生在首次打开默认模板这类不适合弹出复杂确认的路径，宿主应优先保留缺失关联或让整个默认模板回退，而不是静默写入用户 workspace。
- 显式 `apply` / `reset` 成功后，宿主会把本次物化出的新节点 id 作为一组发送给 Webview；Webview 对这组节点执行组级 `fitView`，让用户视口自动追到新增模板节点，而不是只停留在发起操作前的画布位置。
- Marketplace 预览媒体录制应运行在非测试模式的 VS Code Extension Development Host 中，并通过真实鼠标/键盘确认 `reset` 的宿主 modal；录制工具不为视频路径增加自动确认特例。
- `src/panel/CanvasPanelManager.ts` 中的手工/模板节点 id 是对象身份，不再等同于可读编号：新建 `agent` / `terminal` / `note` 节点时，标题仍使用 `Agent 1`、`Terminal 2` 这类递增展示编号，但 `node.id` 会带随机 object identity 后缀。这样同一个模板被反复 reset 后，也会物化成新的 React Flow / 执行终端对象，不复用旧 Webview 节点实例或旧 xterm 缓冲区。
- 为兼容已有 workspace 快照，宿主继续接受历史 `agent-1`、`terminal-2`、`note-3` 这类旧 id；计算下一个展示编号时只读取手工节点 id 中的展示编号前缀，不把自动文件节点或随机 identity 后缀当成编号来源。

### 7.5 模板落位规则

- 首次打开或 `reset`：模板 bounding box 的中心对齐到“当前可见区域中心”；若当前还没有 Webview 可见区域信息，则以画布原点附近为基准，让初始 `fitView` 接管居中表现。
- `apply`：以当前可见区域中心作为首选锚点，把整组模板节点视作一个矩形簇执行“组级避碰搜索”。宿主复用现有节点摆放的网格步长思路，但碰撞检测改为模板组内所有节点与现有节点逐一比较；找到第一个无碰撞位置后整组平移落位。
- 若首选区域始终碰撞，则 fallback 到当前画布 bounding box 右下方空区，仍保持模板内部相对位置不变。
- 落位完成后的追焦同样以“本次新增节点组”为单位，而不是任选其中一个节点。这样当避碰把模板放到当前视野外侧时，用户仍会看到整组模板的相对布局；首次打开自动应用默认模板不走这条显式追焦路径，继续由 Webview 初始 `fitView` 保持启动体验稳定。
- 命令面板和 sidebar 入口会先完成模板应用 / 重置并拿到新增节点 id，再 reveal 到最终承载面后发起组级追焦；避免当前 active surface 与配置默认 surface 不一致时，把 `host/focusNodes` 发送给即将被切走或 dispose 的旧 Webview。

这样模板应用不会把每个节点单独散落，也不会与现有窗口初始重叠。

### 7.6 侧栏、命令与画布右键菜单分工

- 新增一个独立的 `模板` sidebar section，继续使用最小 `WebviewView` 承载，但实现风格和生命周期都向现有 `节点` / `会话历史` section 对齐，而不是再做独立的一套卡片式内容区。
- 模板 sidebar 的视觉风格贴近 `CanvasSidebarNodeListView.ts` 与 `CanvasSidebarSessionHistoryView.ts`：用扁平列表行、弱化的 hover 背景、12px 标题 + 11px 次信息、以及右侧轻量行内动作替代厚重卡片式布局。
- 模板 sidebar 仍保留 `WebviewView`，因为它需要自定义 hover 行内动作、状态提示和内容编排；但首屏不能只依赖 `ready` 握手。宿主在 resolve 后立即刷新，Webview 自身也先渲染 loading / empty / issue 状态，从而避免默认展开 section 再次出现整块空白。
- 保存 / 导入 / 刷新这类管理动作放在 view title actions；模板行只保留模板信息与轻量行内动作，避免它在多个 sidebar section 中显得过重或与其他 section 重复。
- 模板 section 内容区只承载模板列表本身；当前画布是否有可保存节点这类保存动作提示不在模板列表底部展示。
- 侧栏列表按“内置模板固定在前 + 用户模板按创建时间倒序”展示；每项显示：
  - 模板标题行按 `图标 / 模板名称 / 行内动作` 排布，按钮始终和标题保持在同一行；当前默认模板不再使用独立 badge，而是在标题文本前增加 `(默认)` 前缀
  - 第二行摘要按 `内置 / 工作区 / 用户` 位置标签与 `Agent / Terminal / Note` 统计排布，让模板来源与节点统计放在同一层级；第二行不被尾部按钮占用宽度，窄宽度下用省略号退化而不是换行
  - `默认 / 内置 / 工作区 / 用户 / Agent / Terminal / Note` 摘要
  - hover tooltip 中的节点命名列表，以及“模板所在层级：保存位置 / 相对目录”提示
  - 单击整行只更新侧栏选中态，不对画布产生应用副作用
  - 右侧轻量行内动作：追加到当前画布、重置当前画布为该模板、设为默认、导出；用户模板额外可删除。设为默认按钮对非默认模板显示空心星标并写入默认模板设置，对当前默认模板显示填满星标且点击只保持当前设置不变。
- sidebar 不再额外显示“用户模板目录”这类绝对路径提示，避免破坏原生 sidebar 的信息密度；模板所在层级只在实际需要时通过 tooltip 中的“保存位置 / 相对目录”组合参与区分。
- 命令面板提供稳定入口：应用默认模板、重置为默认模板、保存为模板、导入模板、导出模板、设为默认模板。
- 侧栏 `常用操作` section 提供“重置画板”文字按钮，直接复用重置为默认模板命令；它放在“创建节点”下方、“清空画板”上方，并与“清空画板”使用相同的破坏性按钮视觉，让“回到默认模板”和“纯清空”两个破坏性动作保持相邻但文案可区分。
- 画布空白区右键菜单保持“先创建节点，后模板操作”的结构：先显示 `Note / Terminal / Agent Provider` 创建按钮，再在其下方用一条横线分隔模板动作。
- 画布空白区右键菜单的根层只保留标题和操作项，不额外显示“先创建节点，再执行模板操作”这类说明文案。
- 右键菜单中的模板分组包含三个一级动作：`应用模板`、`重置为模板`、`保存为模板`。前两个动作的一级点击分别对默认模板执行快速追加 / 快速重置，同时提供二级展开入口，列出全部可用模板供用户显式选择。
- 右键菜单里的“应用模板”对所选模板执行追加语义；“重置为模板”对所选模板执行清空后应用。它们与侧栏 / 命令面板共用同一条宿主模板应用实现。

### 7.7 默认模板与删除保护

- `使用说明` 是出厂默认模板，也是默认模板缺失、被删除或首次打开时暂时不可应用的安全锚点。
- 内置模板不可删除，也不会被导入覆盖。
- 删除当前默认的用户模板后，宿主立即把默认模板切回 `使用说明`，并刷新模板侧栏状态。

### 7.8 损坏文件与导入冲突

- 模板文件解析失败、版本不兼容或字段缺失时，该文件不会进入可应用列表。
- 对用户模板目录中的损坏文件，侧栏视图会展示错误提示或状态文案，并建议用户删除或重新导入。
- 导入时若模板名称冲突：
  - 冲突对象是用户模板：提示“重命名 / 覆盖 / 取消”。
  - 冲突对象是内置模板：提示“重命名 / 取消”，不允许覆盖。

## 8. 验证方法

至少需要完成以下验证：

1. 新 workspace 首次打开画布时，会自动出现默认 `使用说明` 模板，而不是纯空白画布。
2. 将另一个模板设为默认后，再执行“重置为默认模板”，会清空当前节点并应用新的默认模板。
3. 从现有画布保存模板，再重新应用该模板时，节点标题、相对布局、Note 内容和边样式能被保留，但 `Agent` / `Terminal` 不会自动启动。
4. 在当前画布已有节点时应用模板，新模板整体会避开现有节点，而不是直接重叠。
5. 在当前画布已有节点且避碰把模板放到当前视野外时，应用模板后视口会自动 `fitView` 到本次新增的整组模板节点。
6. 导入无效 JSON、损坏文件或不可用 Provider 模板时，会给出明确错误提示，并阻止写入/应用。
7. 模板侧栏能显示 2 个内置模板、默认标记、节点统计和 hover 详情；用户模板支持导出与删除。

## 9. 当前验证状态

- 当前处于 `已验证`：`npm run typecheck`、`npm run build`、`npm run test:canvas-templates`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=restricted node scripts/run-vscode-smoke.mjs` 已于 2026-05-06 完成通过。
- 模板 sidebar 改回 `WebviewView`、并按 `节点` / `会话历史` section 的扁平列表风格与首屏渲染模式重写后，再次执行 `npm run typecheck`、`npm run build`、`npm run test:canvas-templates`、trusted smoke 与 restricted smoke，均通过。
- 模板 sidebar 继续微调为“`内置 / 用户` 标签前置 + 行尾补充追加 / 重置快捷按钮”后，再次执行 `npm run typecheck`、`npm run build` 与 `npm run test:canvas-templates`，均通过。
- 模板 sidebar 再次微调为“`内置 / 用户` 标签移到第二行摘要前、`默认` 标签保留在第一行标题后”后，再次执行 `npm run typecheck` 与 `npm run build`，均通过。
- 保存模板交互改为表单式对话面板后，再次执行 `npm run typecheck`、`npm run build` 与 `npm run test:canvas-templates`，均通过。
- 保存模板表单继续按最新要求优化为“更贴近 VS Code 原生表单布局 + 按 Agent 分别设置 Provider + 选择存储位置与层级路径”，并同步让 sidebar 移除模板目录提示、模板存储支持 workspace/global 多根与递归层级后，再次执行 `npm run typecheck`、`npm run build` 与 `npm run test:canvas-templates`，均通过。
- 导入模板继续改为复用同一套表单，并补充 sidebar tooltip 层级提示与更贴近 VS Code 的字号/控件尺寸后，再次执行 `npm run typecheck`、`npm run build` 与 `npm run test:canvas-templates`，均通过。
- 显式应用 / 重置模板后自动追焦到本次新增节点组，并补充 `host/focusNodes`、宿主新增节点 id 返回与 Webview 组级 `fitView` 的静态断言后，再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过。
- 组级追焦延后一拍问题已修复：Webview 改用最新节点 id ref 判定 `host/focusNodes` 目标，并在 React Flow 节点尚未完成渲染时主动重试；再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过。
- Webview 右键菜单的重置模板入口已改为复用宿主 modal 确认；当前正式内置模板口径同步为 2 个（`使用说明` 与 `示例模板`），不再保留已移除第三模板的旧口径；再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过。
- 模板 sidebar 的行单击交互已收口为“只选中，不应用”；追加模板仍由右侧行内 `run` 动作、命令面板或画布右键菜单显式触发。本轮已再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已覆盖行 click / keyboard handler 不发送 `sidebarTemplates/applyTemplate` 的回归断言。
- 模板 sidebar 行尾动作已收口为与标题同一行，第二行摘要改为独立占用整行宽度，并在窄侧栏下用省略号退化而不是换行。本轮再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已覆盖按钮挂载在标题行、第二行 nowrap 与 ellipsis 的静态回归断言。
- 模板 sidebar 已移除底部“当前画布还没有可保存的 Agent / Terminal / Note 节点”提示，内容区只保留模板列表及模板列表自身的加载 / 空 / 错误状态。本轮再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已覆盖不再输出 `hintNote` / `hint-note` / `canSaveCurrentCanvas`。
- 画布空白区右键菜单根层已移除说明文案，只保留“画布操作”标题和具体操作项；Playwright harness 已补充断言覆盖根层不再出现“先创建节点”提示。本轮再次执行 `npm run typecheck` 与 `npm run test:webview -- --grep "right-clicking the empty pane opens a quick-create menu near the pointer"`，均通过。
- Webview 右键重置路径在 smoke 中已显式模拟 modal 确认；命令面板和 sidebar 模板入口已改为应用 / 重置后拿到新增节点 id，reveal 到最终承载面后再触发组级追焦。本轮再次执行 `git diff --check`、`npm run typecheck`、`npm run build`、`npm run test:canvas-templates` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`，均通过。
- 模板 sidebar 第二行位置标签已从 `内置 / 用户` 扩展为 `内置 / 工作区 / 用户`，用于区分内置模板、workspace 模板和当前设备用户模板。本轮再次执行 `npm run typecheck` 与 `npm run test:canvas-templates`，均通过；`test:canvas-templates` 已覆盖 workspace 模板映射为 `工作区` 标签。
- Marketplace 预览媒体录制入口已改为启动真实 Extension Development Host，不再依赖 VS Code extension test host；右键重置模板路径保留原生 modal，并在录制片段内通过鼠标/键盘完成确认。
- 验证覆盖了“首次默认模板”“保存/应用不自动启动”“导入/导出/删除与默认模板回退”“组级避碰落位”“restricted note-only 限制”以及 Agent `argv` 在模板保存/加载链路中的保留。
