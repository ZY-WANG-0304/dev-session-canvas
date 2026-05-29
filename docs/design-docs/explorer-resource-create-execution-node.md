---
title: File Explorer 资源右键创建执行节点设计
decision_status: 已选定
validation_status: 未验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/explorer-resource-create-execution-node.md
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/agent-launch-modes-and-restart.md
  - docs/product-specs/canvas-navigation-and-workbench-polish.md
related_plans: []
updated_at: 2026-05-29
---

# File Explorer 资源右键创建执行节点设计

## 1. 背景

当前 DevSessionCanvas 已经有三条创建节点入口：命令面板 / 侧栏里的 `Dev Session Canvas: 创建节点`、画布空白区右键菜单，以及测试命令。它们都默认把 `Agent` / `Terminal` 放到当前画布视口附近，并让执行会话在当前 workspace 根目录启动。在多根 workspace 下，“当前 workspace 根目录”如果继续静默解析为第一个 root，会让普通创建入口和 Explorer 资源入口形成明显不一致。

用户在 VSCode File Explorer 中浏览代码目录或文件时，经常已经明确知道“下一条 Agent 或 Terminal 应该从这个上下文开始工作”。如果仍要求先在画布里创建节点，再进入节点内手动 `cd` 到目录或文件父目录，会把资源上下文从 VSCode 原生文件树里断开。新能力需要让用户在 Explorer 的目录或普通文件右键菜单中直接创建一个绑定目标目录 cwd 的 `Terminal` 或 `Agent`，并在画布中看到该绑定。

## 2. 问题定义

本设计需要回答六个问题：

1. Explorer 菜单应暴露哪些命令，如何避免和通用“创建节点”入口混淆。
2. 右键传入的目录或普通文件如何被校验、规范化为目标 cwd 并写入节点 metadata，避免执行会话仍回到 workspace 根目录。
3. 如果画布 Webview 已打开或尚未打开，新节点应落在哪里。
4. `Agent` 的 provider 与启动方式选择如何复用现有 Quick Input，而不是复制一套新逻辑。
5. 多根 workspace 下普通“创建节点”入口如何确认使用哪个 root，避免静默使用第一个 workspace folder。
6. 多根 workspace、未信任 workspace、非文件 URI、资源不存在、文件父目录不可用或 remote 执行宿主等边界如何退化。

## 3. 目标

- File Explorer 中的本地 / 远端文件系统目录和普通文件右键菜单可以直接创建 `Terminal` 或 `Agent` 节点；普通文件自动解析为父目录 cwd。
- 新建的执行节点必须把解析后的目标目录作为 `metadata.terminal.cwd` 或 `metadata.agent.cwd` 的初始值，首次自动启动和后续节点内“启动 / 新建”都继续使用该节点自己的 cwd。
- `Agent` 创建仍复用现有 provider / preset / custom command 选择规则；Explorer 入口只新增目录上下文，不改写 Agent 启动方式模型。
- 新节点在画布已就绪时仍优先落在当前视口附近；在画布未就绪时由宿主按已有避碰规则创建，不能因为等待坐标而丢失 cwd。
- Agent 节点标题副标题必须让用户看出它不是默认 workspace 根目录启动；Terminal 节点不额外显示 cwd 标签，因为终端内容本身会显示当前路径。
- 侧栏节点列表中的 Agent 第二行必须显示 `cwdLabel · provider · 状态`；其他节点不额外显示 cwdLabel。
- 普通“创建节点”入口在多根 workspace 下创建 `Terminal` / `Agent` 时必须让用户确认 workspace root；所选 root 作为节点 cwd。单根 workspace 不增加确认步骤，Explorer 入口因资源已经明确 cwd 也不重复确认。

## 4. 非目标

- 不新增每节点 shell / provider 配置；本轮只新增每节点工作目录覆盖。
- 不提供任意目录选择器；普通创建入口只在多根 workspace 下确认 root，子目录上下文继续由 Explorer 资源入口表达。
- 不改变模板应用、恢复已有节点或单根 workspace 普通创建入口的 cwd 语义。
- 不承诺虚拟 workspace、只读虚拟文件系统或非 `file` scheme 的 Explorer 资源可以启动执行会话。
- 不把 Explorer 入口做成直接在 Explorer 内显示运行状态；状态仍归画布节点与侧栏节点列表表达。

## 5. 候选方案

### 5.1 创建后向终端输入 `cd <目录>`

特点：保留现有节点创建与启动 cwd，只在 Terminal 或 Agent 启动后自动输入一条 `cd` 命令。

不选原因：

- `Agent` CLI 的启动 cwd 已经影响项目配置、权限、文件活动、provider session identity 和恢复定位；启动后再 `cd` 太晚。
- shell quoting、Windows drive 切换、失败处理和 Agent TUI 首屏状态都会变成额外不确定性。
- 节点 metadata 仍会记录旧 cwd，后续恢复、链接解析和诊断都会与用户看到的目录不一致。

### 5.2 复用 `Dev Session Canvas: 创建节点`，在 Quick Pick 中增加“选择目录”步骤

特点：只有一个通用创建命令，用户先选节点类型，再通过 Quick Input 选择目录。

不选原因：

- 用户已经在 Explorer 里用右键表达了资源上下文，再要求二次选择目录会增加摩擦。
- 这会把通用创建入口复杂化，并影响侧栏和命令面板主路径。
- 它不能解决“从 Explorer 当前目录顺手创建”的 discoverability。

### 5.3 普通创建入口在多根 workspace 下继续静默使用第一个 root

特点：保持现有创建流程不变，只有 Explorer 入口传入 per-node cwd。

不选原因：

- 多根 workspace 下“第一个 root”常常只是打开顺序，不是用户当前意图；继续静默使用会把 Terminal / Agent 启动到错误项目。
- Agent 启动 cwd 影响 provider 配置、权限、文件活动和恢复定位，启动错 root 的代价高于一次 root 确认。
- Explorer 入口已经强调目录上下文；普通入口如果仍静默落到第一个 root，会让同一功能在多根 workspace 下表现不一致。

### 5.4 Explorer 贡献两个资源上下文命令，并把解析后的 cwd 作为创建请求的一部分；普通入口多根时确认 root

这是当前选择。

特点：

- `package.json` 在 `explorer/context` 中新增 `Create Terminal in Canvas` 与 `Create Agent in Canvas` 两条资源上下文菜单项，对目录直接使用该目录，对普通文件使用父目录。
- 命令处理函数从 VSCode 传入的 `vscode.Uri` 解析目标 cwd，校验通过后调用同一套节点创建管线，只额外传入 `cwdOverride`。
- `Agent` 命令继续调用现有 `promptCreateNodeRequest` / `promptAgentLaunchRequest` 逻辑的 Agent 子路径，以复用 provider、preset 和 custom command 校验。
- 普通“创建节点”入口在 `workspaceFolders.length > 1` 且目标类型为 `Terminal` 或 `Agent` 时，先通过 Quick Pick 让用户选择 workspace root；单根 workspace 仍走原默认 cwd。

选择原因：

- 资源上下文来自 VSCode 原生 Explorer，菜单命令是最直接、可发现且符合原生肌肉记忆的入口。
- cwd 作为节点 metadata 的一等字段写入，能保证启动、恢复、链接解析和诊断保持一致。
- 对现有创建入口影响受控：单根 workspace 不增加步骤，多根 workspace 才用 root 确认替代“隐式第一个 root”。

## 6. 风险与取舍

- 取舍：第一版支持普通文件自动转父目录，但不进一步把文件路径注入 Agent 命令或创建文件关联节点。原因是“从这个文件所在目录启动执行会话”与“把这个文件作为画布对象或 Agent 任务输入”是不同语义；本轮只解决 cwd，上下文文件关联仍留给文件节点 / 文件活动 / Markdown Note 相关设计。
- 取舍：Explorer 入口不进入 Webview 右键菜单的自定义 Agent 内联编辑器，而是复用宿主 Quick Input。原因是 VSCode Explorer 菜单发生在宿主侧，不应该为了视觉一致性强行打开画布内菜单；Quick Input 已经是宿主命令的正式 Agent 创建路径。
- 取舍：普通“创建节点”入口在多根 workspace 下只确认 workspace root，不提供任意目录选择器。原因是普通入口要保持轻量，子目录意图已经由 Explorer 资源右键表达；把任意目录选择塞进普通入口会重新制造一套文件浏览体验。
- 风险：用户右键资源或文件父目录不在当前 workspace folder 内。当前缓解：第一版要求解析后的 cwd 必须落在某个 `vscode.workspace.workspaceFolders` 下；否则显示 warning，不创建执行节点。这样避免执行会话逃逸到工作区之外，并让 workspace trust、持久化槽和文件活动继续有明确 workspace 绑定。
- 风险：多根 workspace 下 root 确认会增加普通创建入口的一步操作。当前缓解：只在 `Terminal` / `Agent` 且 workspace folders 多于一个时触发，单根 workspace、Explorer 资源入口和模板应用不受影响；Quick Pick 默认可把第一个 root 放在首位，但必须让用户显式确认。
- 风险：单根 workspace 扩容成多根 workspace 时，VSCode 的 workspace 持久化 scope 可能变化，并且目标多根 scope 可能已有旧快照。当前缓解：把该动作定义为“当前窗口 workspace 扩容”，当前 Canvas 优先进入新的多根 scope；原单根快照保留，新增 root 的历史 Canvas 不自动导入，目标旧快照不自动 merge，并要求实现保留可恢复备份或诊断记录。
- 风险：Terminal shell、Agent CLI resolver 和 shell env probe 当前部分缓存以 workspace cwd 为 key。当前缓解：本轮需要把启动路径相关 resolver 调用改为读取节点 cwd；Agent CLI cache key、相对 shellPath probe、shell env patch 至少要按目标 cwd 区分，不能复用默认 workspace 根目录结果。
- 风险：目录在创建后被删除或变成不可访问。当前缓解：启动前校验 cwd 仍存在且是目录；失败时节点进入 `error`，摘要说明目录不可用，不回退到 workspace 根目录偷偷启动。

## 7. 正式方案

### 7.1 命令与菜单

在 `src/common/extensionIdentity.ts` 的 `COMMAND_IDS` 中新增：

- `createTerminalFromExplorerResource`: `devSessionCanvas.createTerminalFromExplorerResource`
- `createAgentFromExplorerResource`: `devSessionCanvas.createAgentFromExplorerResource`

在 `package.json` 的 `contributes.commands` 中登记两条命令，标题分别使用 `package.nls.json` 文案，例如：

- `Dev Session Canvas: 在 Canvas 中创建 Terminal`
- `Dev Session Canvas: 在 Canvas 中创建 Agent`

在 `contributes.menus.explorer/context` 中新增两条菜单项，`when` 条件至少包含：

- `resourceScheme == file`

不要再用 `explorerResourceIsFolder` 限制菜单显示；命令自身负责区分目录与普通文件，并拒绝其他类型资源。

菜单分组建议放在 `navigation` 之后的独立组，例如 `devSessionCanvas@1` / `devSessionCanvas@2`，避免挤到 VSCode 内置 open / reveal 主动作之前。

### 7.2 URI 校验与目录解析

`src/extension.ts` 新增一个宿主侧解析函数，负责把命令参数转成执行 cwd：

- 输入优先使用命令第一个参数 `vscode.Uri`；若没有参数，可尝试 `vscode.window.activeTextEditor?.document.uri` 作为兜底只用于开发调试，但正式 Explorer 菜单不依赖它。
- 只接受 `uri.scheme === 'file'`。
- 使用 `vscode.workspace.fs.stat(uri)` 读取资源类型。
- 若资源是 `FileType.Directory`，目标 cwd 是该目录。
- 若资源是 `FileType.File`，目标 cwd 是 `vscode.Uri.joinPath(uri, '..')` 等价父目录，并需要再用 `vscode.workspace.fs.stat(parentUri)` 确认父目录存在且是目录。
- 其他类型资源，包括 symlink 解析后无法确认目录或普通文件的情况，第一版直接拒绝。
- 使用 `vscode.workspace.getWorkspaceFolder(cwdUri)` 确认解析后的 cwd 属于当前 workspace。
- 输出 `cwdUri.fsPath` 作为宿主执行 cwd，并记录一个用于标题 / tooltip 的显示路径：单根 workspace 用相对路径，多根 workspace 前缀 workspace folder 名称。

校验失败时不创建节点，并显示明确 warning，例如“请选择当前 workspace 内的文件夹或普通文件来创建画布 Terminal / Agent”。未信任 workspace 的执行限制继续由 `CanvasPanelManager.applyCreateNode(...)` 和启动路径处理；命令层可以提前给出更贴近 Explorer 的提示，但不能绕过宿主权威判断。

### 7.3 共享协议与节点 metadata

`src/common/protocol.ts` 现有 `ExecutionSessionMetadata.cwd` 已经是 Agent / Terminal 共享字段，不需要新增持久化字段；需要扩展创建消息与宿主请求：

- `WebviewToHostMessage` 的 `webview/createDemoNode.payload` 新增可选 `cwd?: string`。
- `HostToWebviewMessage` 的 `host/requestCreateNode.payload` 新增可选 `cwd?: string`。
- `cwdLabel` 不进入持久化权威状态；正式状态仍以 `metadata.*.cwd` 为准。Agent 标题副标题显示所需的短路径标签由 Webview 从 runtime context 的 workspace folder 列表派生，或由宿主在非持久化 runtime context 中提供辅助信息。

`src/panel/CanvasPanelManager.ts` 的 `CreateAgentNodeOptions` 改名或扩展为通用 `CreateNodeOptions`，至少包含：

- `cwdOverride?: string`
- `cwdSelectionSource?: 'explorer-resource' | 'workspace-root-picker' | 'default-workspace-root'`
- `titleOverride?: string`
- 现有 Agent provider / preset / custom command 字段
- 现有 `targetGroupId`、`requestId`、`bypassTrust`

`applyCreateNode(...)` 在构造 metadata 后，如果创建的是 `agent` 或 `terminal`，把 `cwdOverride` 写入对应 metadata 的 `cwd`，并用同一个值设置启动前 `pendingLaunch` 节点。必须先通过宿主侧 `validateExecutionCwd(...)`：路径非空、绝对路径、存在、是目录、属于当前 workspace。校验失败时拒绝创建并通过 `host/error` 或 warning 给出原因。

### 7.4 创建管线与落位

Explorer 命令的主流程为：

1. 解析右键资源并得到 `{ cwd, label, sourceKind }`；目录直接作为 cwd，普通文件使用父目录作为 cwd。
2. 对 `Terminal`：调用 `panelManager.revealOrCreate()`，然后调用 `panelManager.createNode('terminal', { cwdOverride: cwd, titleOverride })`。
3. 对 `Agent`：先复用现有 Agent 创建 Quick Input，得到 provider / launchPreset / custom command；然后调用 `panelManager.revealOrCreate()` 和 `panelManager.createNode('agent', { cwdOverride: cwd, titleOverride, ...agentOptions })`。
4. 如果当前可交互 Webview 已 ready，`CanvasPanelManager.createNode(...)` 继续发 `host/requestCreateNode`，由 Webview 在当前视口附近计算 `preferredPosition`，并把 `cwd` 原样带回 `webview/createDemoNode`。
5. 如果 Webview 未 ready 或消息无法投递，宿主直接 `applyCreateNode(...)`，使用已有默认锚点与避碰搜索。

建议标题默认值：

- Terminal：`Terminal · <目录名>`
- Agent：`<ProviderLabel> Agent · <目录名>`

标题只用于可读性，不作为恢复或 cwd 判断依据。若目录名为空或根目录，回退到现有 `Terminal N` / `Agent N`。

### 7.5 普通创建入口的多根 workspace root 确认

普通创建入口包括命令面板 / 侧栏里的 `Dev Session Canvas: 创建节点`、画布空白区右键菜单以及同一宿主创建管线下的非 Explorer 创建动作。它们在创建 `Terminal` 或 `Agent` 时应先解析默认 cwd：

1. 如果 `vscode.workspace.workspaceFolders` 为空，沿用当前无 workspace 的默认工作目录回退策略。
2. 如果只有一个 workspace folder，直接使用该 root，不显示 root 选择 Quick Pick。
3. 如果有多个 workspace folders，弹出 Quick Pick 让用户选择要作为 cwd 的 workspace root；列表项至少显示 workspace folder 名称和完整路径或可读路径。
4. 用户取消 Quick Pick 时，不创建节点，也不继续进入 Agent provider / preset / custom command 选择。
5. 用户确认 root 后，把 root `uri.fsPath` 作为 `cwdOverride` 传入统一创建管线，后续写入 `metadata.terminal.cwd` 或 `metadata.agent.cwd`。

Agent 普通创建入口的交互顺序建议为“先确认 root，再进入 Agent provider / 启动方式 Quick Input”。原因是 cwd 会影响 provider 配置发现、CLI resolver、文件活动根和后续诊断；如果用户取消 root 选择，应尽早退出，不再让用户完成一串 Agent 选择后才发现没有 cwd。

Explorer 资源右键入口不使用该 root 选择器：资源 URI 已经明确 cwd，重复弹 root 会降低“从当前资源直接创建”的价值。模板应用和恢复已有节点也不使用该 root 选择器：模板节点和已持久化节点有自己的状态来源，本轮不改变其 cwd 语义。

### 7.6 启动、恢复与后续重启语义

执行启动路径必须从节点 metadata 读取 cwd，而不是每次调用 `getTerminalWorkingDirectory()`：

- `startTerminalSession(...)` 使用 `ensureTerminalMetadata(terminalNode).cwd` 作为 `buildTerminalLaunchSpec(...)`、line context tracker 和 diagnostic `cwd`。
- `startAgentSession(...)` 使用 `ensureAgentMetadata(agentNode).cwd` 作为 fresh-start、resume、CLI resolver、file activity session 和 diagnostic `cwd`。
- `resolveAgentCli(...)`、`resolveExecutionEnvironment(...)`、`getResolvedShellEnvironmentPatch(...)` 等 cwd-sensitive helper 需要接收目标 cwd 参数；缓存 key 必须包含目标 cwd。
- live-runtime supervisor 的 createSession request 同样使用节点 cwd；reattach snapshot 继续以 supervisor snapshot 的 cwd 为准。
- 节点停止后点击 `Terminal` 的“重启”、Agent 的“新建”或“重启恢复原会话”都继续使用该节点 metadata 中的 cwd。不要在后续启动时回退到当前 workspace 根目录。

如果 cwd 在后续启动时不可用：

- 不自动改用 workspace 根目录。
- 节点进入 `error` / `resume-failed`，摘要写明目标目录不存在或不可访问。
- 保留原 cwd，方便目录恢复后用户再次启动。

### 7.7 多根 workspace 持久化与单根扩容

本设计复用当前 Dev Session Canvas 的 workspace 级持久化模型：`context.storageUri` 下的 `canvas-state.json` 是主快照，`context.workspaceState` 只作为轻量兜底；多根 workspace 下仍是一组 workspace folders 对应一张 Canvas 状态，而不是每个 root 单独持久化一张 Canvas。

当用户从单根 workspace `A` 通过拖入目录或 VSCode `Add Folder to Workspace` 增加 `B` 时，本轮约定该动作是“当前窗口 workspace 扩容”，不是“切换到另一个历史 workspace”。语义如下：

1. 当前窗口内存中的 Canvas 原样保留，包括节点、连线、布局、执行状态、`metadata.agent.cwd` 和 `metadata.terminal.cwd`。
2. 新的 `A + B` 多根 workspace 持久化状态从当前窗口 Canvas fork 而来，并写入当前 VSCode 提供的 workspace storage scope。
3. 原 `A` 单根 workspace 的 `canvas-state.json` / `workspaceState` 保留，不删除、不迁移；之后单独打开 `A` 和打开 `A + B` 会自然分叉。
4. 不自动读取或合并 `B` 单独打开时可能存在的 Canvas，也不把 `B` 的历史节点导入当前画布。新增 root 只有在用户从该 root 的 Explorer 资源创建节点后，才开始贡献新的 cwd 绑定节点。
5. 如果 `A + B` 的目标持久化 scope 已经存在旧快照，当前窗口状态优先；实现不得在扩容瞬间用旧 `A + B` 快照替换用户当前画布，也不得自动 merge。覆盖目标旧快照前应保留可恢复备份或至少记录明确诊断事件，避免不可追溯的静默覆盖。
6. 运行期收到 `onDidChangeWorkspaceFolders` 且事件是纯新增 root 时，宿主必须把当前内存 Canvas 视为权威源：刷新 storage recovery 选择和 cwd-sensitive cache 后，立即把当前内存态写入当前 storage scope，并向 Webview 重新推送当前状态。这个路径不得调用 `loadReconciledState()` 从新 scope 读取历史快照，否则未保存的 `Untitled (Workspace)` 多根容器可能在扩容瞬间用目标 scope 的空状态或旧状态覆盖当前画布。
7. 已有 live-runtime 会话不因 workspace 扩容自动重启；仍以会话自己的 `runtimeStoragePath` 和节点 metadata cwd 继续运行。workspace folders 变化时需要失效 shell env patch、Agent CLI resolver 等 cwd / workspace 敏感缓存，后续新启动按节点 cwd 重新解析。
8. `cwdLabel` 是投影值，不进入持久化。扩容前单根下显示为 `src` 的 cwd，扩容后如果仍落在 `A` 下，应按多根规则显示为 `A/src`；Terminal 标题副标题仍不额外显示 cwdLabel。

这条规则只处理“增加 root”的扩容场景。移除 root、重排 root 或显式打开已有 `.code-workspace` 文件是否应恢复旧多根快照，属于后续多根 workspace 语义讨论，不在本轮结论中扩大。

### 7.8 可见反馈

第一版不新增全局 inspector。节点本体按节点类型区别处理目录上下文：

- `Terminal` 标题副标题继续只显示 shell path，不额外拼接 `cwdLabel`；原因是 Terminal 内容区和 shell prompt 本身会显示当前路径，标题栏重复展示会增加噪声。完整 cwd 仍保留在 metadata、diagnostic 和执行上下文中。
- `Agent` 标题副标题改为 `cwdLabel · 启动命令`；启动命令仍来自 `resolveAgentLaunchCommandLineForSubtitle(...)`，`cwdLabel` 由 `metadata.agent.cwd` 派生。完整 cwd 和完整启动命令进入 hover title，避免窄节点下被截断后丢失上下文。
- `src/sidebar/CanvasSidebarNodeListView.ts` 投影 Agent 节点时，第二行从 `provider · 状态` 改为 `cwdLabel · provider · 状态`；`cwdLabel` 同样由 `metadata.agent.cwd` 派生，并按单根 / 多根 workspace 规则缩短。Terminal / Note 节点列表项保持只显示状态。
- `terminal-overlay` / `agent overlay` 在未运行或启动失败时应继续使用 `data.summary` / `lastExitMessage`，其中 cwd 不可用错误需要可读。

为了让 Webview 可靠生成相对 cwd 标签，`CanvasRuntimeContext` 可新增 workspace folder 列表：`workspaceFolders: Array<{ name: string; path: string }>`。该列表只用于显示，不作为权限或执行校验来源。

### 7.9 测试与验证落点

建议实现时补以下验证：

- VSCode smoke：在临时 workspace 下创建子目录，执行 `devSessionCanvas.createTerminalFromExplorerResource`，断言新 Terminal 节点 `metadata.terminal.cwd` 等于该子目录，并等待 `execution/started` diagnostic 的 `cwd` 也是该子目录。
- VSCode smoke：同样覆盖 Agent Explorer 命令，使用测试 fake provider，断言 `metadata.agent.cwd` 与 `execution/startRequested` / `execution/started` diagnostic cwd 都等于子目录。
- VSCode smoke：对 workspace 内普通文件 URI 调用命令，断言新节点 cwd 等于父目录；对 workspace 外目录 / 文件、非普通文件资源调用命令，断言不会创建节点，并尽可能断言 warning 或 diagnostic reason。
- VSCode smoke：在多根 workspace 下通过普通创建入口创建 Terminal / Agent，断言会出现 root 选择，确认第二个 root 后节点 metadata cwd 和执行 diagnostic cwd 均等于所选 root；取消选择时不创建节点。
- VSCode smoke：在单根 workspace 下通过普通创建入口创建 Terminal / Agent，断言不出现 root 选择，节点 cwd 继续使用唯一 workspace root。
- Playwright Webview：构造带不同 cwd 的 Agent / Terminal 节点，断言 Agent subtitle 使用 `cwdLabel · 启动命令`，Terminal subtitle 不显示 cwdLabel 且仍只展示 shell path。
- 侧栏节点列表 smoke / DOM 验证：构造带不同 cwd 的 Agent 节点，断言第二行使用 `cwdLabel · provider · 状态`；Terminal / Note 仍只显示状态。
- VSCode smoke 或宿主级单元验证：从单根 workspace 状态模拟增加第二个 root 后，断言当前 Canvas 未被目标多根旧快照替换，已有节点 cwd 不变，持久化写入对齐新的多根 scope，并且原单根快照仍可恢复。
- 单元测试：如果把 cwd 校验、相对标签生成或 cwd-sensitive cache key 抽成纯函数，应覆盖单根、多根、Windows path 大小写和路径越界。

## 8. 验证方法

本设计文档当前状态为“未验证”。进入实现后至少需要运行：

1. `npm run typecheck`
2. 新增或相关的 VSCode smoke 测试，覆盖 Explorer 目录创建 Terminal 与 Agent 的 cwd 传递。
3. 若调整 Webview subtitle / tooltip，则运行相关 `npm run test:webview` 用例或定向 Playwright 用例。
4. 手动验证：在 VSCode Explorer 对 workspace 内子目录和普通文件分别右键，选择创建 Terminal / Agent；画布打开后节点出现在当前视口附近，终端 `pwd` / `cd` 显示位于目标目录，Agent 启动 diagnostic 中 cwd 为目标目录；普通文件场景的目标目录应为文件父目录。
