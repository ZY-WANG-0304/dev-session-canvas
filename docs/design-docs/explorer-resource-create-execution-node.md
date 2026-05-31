---
title: File Explorer 资源右键创建执行节点设计
decision_status: 已选定
validation_status: 已验证
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
related_plans:
  - docs/exec-plans/completed/explorer-resource-create-execution-node-implementation.md
updated_at: 2026-05-31
---

# File Explorer 资源右键创建执行节点设计

## 1. 背景

当前 DevSessionCanvas 已经有三条创建节点入口：命令面板 / 侧栏里的 `Dev Session Canvas: 创建节点`、画布空白区右键菜单，以及测试命令。它们默认把 `Agent` / `Terminal` 放到当前画布视口附近，并让执行会话在当前 workspace 根目录启动。

用户在 VSCode File Explorer 中浏览代码目录或文件时，经常已经明确知道“下一条 Agent 或 Terminal 应该从这个上下文开始工作”。如果仍要求先在画布里创建节点，再进入节点内手动 `cd` 到目录或文件父目录，会把资源上下文从 VSCode 原生文件树里断开。新能力需要让用户在 Explorer 的目录或普通文件右键菜单中直接创建一个绑定目标目录 cwd 的 `Terminal` 或 `Agent`，并在画布中看到该绑定。

## 2. 问题定义

本设计需要回答五个问题：

1. Explorer 菜单应暴露哪些命令，如何避免和通用“创建节点”入口混淆。
2. 右键传入的目录或普通文件如何被校验、规范化为目标 cwd 并写入节点 metadata，避免执行会话仍回到 workspace 根目录。
3. 如果画布 Webview 已打开或尚未打开，新节点应落在哪里。
4. `Agent` 的 provider 与启动方式选择如何复用现有 Quick Input，而不是复制一套新逻辑。
5. 未信任 workspace、非文件 URI、资源不存在、文件父目录不可用或 remote 执行宿主等边界如何退化。

## 3. 目标

- File Explorer 中的 `file` scheme 目录和普通文件右键菜单可以直接创建 `Terminal` 或 `Agent` 节点；普通文件自动解析为父目录 cwd。本轮不支持非 `file` scheme 的虚拟资源。
- 新建的执行节点必须把解析后的目标目录作为 `metadata.terminal.cwd` 或 `metadata.agent.cwd` 的初始值，首次自动启动和后续节点内“启动 / 新建”都继续使用该节点自己的 cwd。
- `Agent` 创建仍复用现有 provider / preset / custom command 选择规则；Explorer 入口只新增目录上下文，不改写 Agent 启动方式模型。
- 新节点在画布已就绪时仍优先落在当前视口附近；在画布未就绪时由宿主按已有避碰规则创建，不能因为等待坐标而丢失 cwd。
- Agent 节点标题副标题必须让用户看出它不是默认 workspace 根目录启动；Terminal 节点不额外显示 cwd 标签，因为终端内容本身会显示当前路径。
- 侧栏节点列表中的 Agent 第二行必须显示 `cwdLabel · provider · 状态`；其他节点不额外显示 cwdLabel。

## 4. 非目标

- 不为普通“创建节点”入口新增 root picker 或任意目录选择器；这属于独立的多根 workspace 创建语义。
- 不改变模板应用、恢复已有节点、测试命令和普通创建入口的 cwd 语义。
- 不把 Explorer 中的文件资源自动关联到 Note 或 Agent 启动参数。
- 不把 Terminal 标题栏改成目录标签。
- 不在本轮处理单根 workspace 扩容到多根 workspace 后的 storage fork / merge 问题。

## 5. 候选方案与取舍

### 5.1 方案 A：只给 Webview 发送一个“创建节点”请求，让前端自行写 cwd

做法是 Explorer 命令打开画布后发消息给 Webview，由 Webview 创建节点并把 cwd 写入创建消息。

优点是实现路径看似接近当前画布右键创建。缺点是 cwd 校验、workspace trust、执行启动与持久化权威都在宿主侧，前端自行写 cwd 会让安全边界和 fallback 路径分散；如果 Webview 尚未 ready，还可能丢失目录上下文。

本轮不采用。

### 5.2 方案 B：宿主解析 Explorer 资源，统一创建管线携带 `cwdOverride`

做法是在扩展宿主中解析右键 URI，把目录或文件父目录校验成 workspace 内 cwd，然后调用 `CanvasPanelManager.createNode(kind, { cwdOverride })`。如果 Webview 已 ready，宿主把 cwd 放入 `host/requestCreateNode`，Webview 只负责计算当前视口附近落点并原样带回 `webview/createDemoNode`；如果 Webview 未 ready，宿主直接创建节点并写入 metadata。

优点是 cwd 权威、trust 判断、启动路径、诊断和持久化都留在宿主侧；Webview 仍只负责视觉落点；无 Webview ready 时也不会丢上下文。缺点是需要扩展 Host/Webview 协议，但协议只新增一个可选字符串字段，影响面可控。

本轮采用该方案。

### 5.3 方案 C：创建后向终端发送 `cd <dir>`

做法是继续按默认 workspace root 创建节点，然后在终端启动后自动输入 `cd`。

这个方案不能满足 Agent 启动前 cwd 影响 provider 配置、工具权限和文件活动根的需求，也无法让 resume / supervisor / diagnostic 稳定使用目标目录，因此不采用。

## 6. 正式方案

### 6.1 命令与菜单

在 `src/common/extensionIdentity.ts` 的 `COMMAND_IDS` 中新增：

- `createTerminalFromExplorerResource`: `devSessionCanvas.createTerminalFromExplorerResource`
- `createAgentFromExplorerResource`: `devSessionCanvas.createAgentFromExplorerResource`

在 `package.json` 的 `contributes.commands` 中登记两条命令，标题分别为：

- `Dev Session Canvas: 在 Canvas 中创建 Terminal`
- `Dev Session Canvas: 在 Canvas 中创建 Agent`

在 `contributes.menus.explorer/context` 中新增两条菜单项，`when` 条件使用 `resourceScheme == file`。不要用 `explorerResourceIsFolder` 限制菜单显示；命令自身负责区分目录与普通文件，并拒绝其他类型资源。

### 6.2 URI 校验与目录解析

`src/extension.ts` 新增宿主侧解析函数，负责把命令参数转成执行 cwd：

- 输入优先使用命令第一个参数 `vscode.Uri`；若没有参数，则拒绝创建并提示用户从 Explorer 的文件或文件夹右键触发。
- 只接受 `uri.scheme === 'file'`。
- 使用 `vscode.workspace.fs.stat(uri)` 读取资源类型；由于 VSCode `FileType` 是 bitmask，判断目录或普通文件时使用按位包含判断。
- 若资源是 `FileType.Directory`，目标 cwd 是该目录。
- 若资源是 `FileType.File`，目标 cwd 是 `vscode.Uri.file(path.dirname(uri.fsPath))`，并需要再用 `vscode.workspace.fs.stat(parentUri)` 确认父目录存在且是目录。
- 其他类型资源，包括 symlink 解析后无法确认目录或普通文件的情况，第一版直接拒绝。
- 优先使用 `vscode.workspace.getWorkspaceFolder(cwdUri)` 确认解析后的 cwd 属于当前 workspace；若该 API 在文件 URI 比较上未命中，再使用 workspace folder 路径包含关系做保守 fallback。
- 输出 `cwdUri.fsPath` 作为宿主执行 cwd。

校验失败时不创建节点，并显示明确 warning。未信任 workspace 的执行限制继续由 `CanvasPanelManager.applyCreateNode(...)` 和启动路径处理；命令层不绕过宿主权威判断。

### 6.3 共享协议与节点 metadata

`src/common/protocol.ts` 现有 `ExecutionSessionMetadata.cwd` 已经是 Agent / Terminal 共享字段，不需要新增持久化字段；需要扩展创建消息与宿主请求：

- `WebviewToHostMessage` 的 `webview/createDemoNode.payload` 新增可选 `cwd?: string`。
- `HostToWebviewMessage` 的 `host/requestCreateNode.payload` 新增可选 `cwd?: string`。
- `CanvasRuntimeContext` 新增 `workspaceFolders: Array<{ name: string; path: string }>`，仅用于 Webview 显示 cwdLabel，不作为权限判断来源。
- `cwdLabel` 不进入持久化权威状态；正式状态仍以 `metadata.*.cwd` 为准。

`src/panel/CanvasPanelManager.ts` 的创建选项扩展为通用 `CreateNodeOptions`，至少包含 `cwdOverride?: string`、`titleOverride?: string`、现有 Agent provider / preset / custom command 字段，以及现有 `targetGroupId`、`requestId`、`bypassTrust`。

`applyCreateNode(...)` 在构造 metadata 后，如果创建的是 `agent` 或 `terminal`，把 `cwdOverride` 写入对应 metadata 的 `cwd`。必须先通过宿主侧 `validateExecutionCwd(...)`：路径非空、绝对路径、存在、是目录、属于当前 workspace。校验失败时拒绝创建并通过 `host/error` 给出原因。

### 6.4 创建管线与落位

Explorer 命令的主流程为：

1. 解析右键资源并得到 `{ cwd, sourceKind }`；目录直接作为 cwd，普通文件使用父目录作为 cwd。
2. 对 `Terminal`：调用 `panelManager.revealOrCreate()`，然后调用 `panelManager.createNode('terminal', { cwdOverride: cwd })`。
3. 对 `Agent`：先复用现有 Agent 创建 Quick Input，得到 provider / launchPreset / custom command；然后调用 `panelManager.revealOrCreate()` 和 `panelManager.createNode('agent', { cwdOverride: cwd, ...agentOptions })`。
4. 如果当前可交互 Webview 已 ready，`CanvasPanelManager.createNode(...)` 继续发 `host/requestCreateNode`，由 Webview 在当前视口附近计算 `preferredPosition`，并把 `cwd` 原样带回 `webview/createDemoNode`。
5. 如果 Webview 未 ready 或消息无法投递，宿主直接 `applyCreateNode(...)`，使用已有默认锚点与避碰搜索。

本轮不改变默认标题。Agent 的 cwd 上下文通过副标题和 tooltip 呈现；Terminal 保持原副标题。

### 6.5 启动、恢复与后续重启语义

执行启动路径必须从节点 metadata 读取 cwd，而不是每次调用默认 workspace root：

- `startTerminalSession(...)` 使用 `ensureTerminalMetadata(terminalNode).cwd` 作为 `buildTerminalLaunchSpec(...)`、line context tracker 和 diagnostic `cwd`。
- `startAgentSession(...)` 使用 `ensureAgentMetadata(agentNode).cwd` 作为 fresh-start、resume、CLI resolver、file activity session 和 diagnostic `cwd`。
- `resolveAgentCli(...)`、`resolveExecutionEnvironment(...)`、`getResolvedShellEnvironmentPatch(...)` 等 cwd-sensitive helper 需要接收目标 cwd 参数；缓存 key 必须包含目标 cwd。
- live-runtime supervisor 的 createSession request 同样使用节点 cwd；reattach snapshot 继续以 supervisor snapshot 的 cwd 为准。
- 节点停止后点击 `Terminal` 的“重启”、Agent 的“新建”或“重启恢复原会话”都继续使用该节点 metadata 中的 cwd。不要在后续启动时回退到当前 workspace 根目录。
- Terminal 的进程 cwd 与 shell 可执行文件解析使用不同基准：进程 cwd 始终使用节点 metadata cwd；`devSessionCanvas.terminal.shellPath` 中显式相对路径先按当前 workspace/configuration cwd 解析成绝对 shell path，再传入 shell env probe、local PTY 与 runtime supervisor，避免 Explorer cwd 改变 repo-local shell wrapper 的解析位置。
- 新建 Agent / Terminal metadata 的默认 cwd 使用同一 canonical 执行 cwd：优先当前第一个 workspace folder，否则回退宿主 HOME。旧持久化节点中历史 HOME 默认 cwd 仅在它不属于当前 workspace 时迁移到 canonical cwd，以保持预启动 `cwdLabel` 与启动时 cwd 一致。
- workspace folders 变化时，宿主必须重新发布 `host/stateUpdated` 和侧栏状态，即使 terminal shell metadata 没有变化；Webview 的 `runtime.workspaceFolders` 是 cwdLabel 的显示上下文，不能依赖 shell metadata 变化间接刷新。

如果 cwd 在后续启动时不可用：

- 不自动改用 workspace 根目录。
- 节点进入 `error` / `resume-failed`，摘要写明目标目录不存在或不可访问。
- 保留原 cwd，方便目录恢复后用户再次启动。

### 6.6 可见反馈

第一版不新增全局 inspector。节点本体按节点类型区别处理目录上下文：

- `Terminal` 标题副标题继续只显示 shell path，不额外拼接 `cwdLabel`。
- `Agent` 标题副标题改为 `cwdLabel · 启动命令`；启动命令仍来自 `resolveAgentLaunchCommandLineForSubtitle(...)`，`cwdLabel` 由 `metadata.agent.cwd` 和 runtime context 中的 workspace folder 列表派生。完整 cwd 和完整启动命令进入 hover title，避免窄节点下被截断后丢失上下文。
- `src/sidebar/CanvasSidebarNodeListView.ts` 投影 Agent 节点时，第二行从 `provider · 状态` 改为 `cwdLabel · provider · 状态`；`cwdLabel` 同样由 `metadata.agent.cwd` 派生，并按单根 / 多根 workspace 规则缩短。Terminal / Note 节点列表项保持只显示状态。
- `terminal-overlay` / `agent overlay` 在未运行或启动失败时继续使用 `data.summary` / `lastExitMessage`，其中 cwd 不可用错误需要可读。

## 7. 风险与缓解

- 风险：Explorer 菜单可能出现在不可支持资源上。缓解：菜单只用 `resourceScheme == file` 做粗筛，命令层用 `workspace.fs.stat`、文件类型和 `getWorkspaceFolder` 做最终拒绝。
- 风险：Webview ready 之前创建节点丢失 cwd。缓解：cwd 在宿主 `CreateNodeOptions` 中传递，fallback 直接创建也写 metadata。
- 风险：启动时目录已被删除。缓解：启动前再次校验 metadata.cwd，失败时进入错误态，不回退默认 root。
- 风险：Agent CLI 和 shell env patch 误复用默认 root 缓存。缓解：cwd-sensitive helper 显式接收 cwd，缓存 key 包含 cwd。
- 风险：Explorer cwd 影响 workspace-relative `terminal.shellPath`，让 repo-local shell wrapper 被错误解析到目标子目录。缓解：shell executable 以 workspace/configuration cwd 解析，执行进程 cwd 独立保持节点 cwd。
- 风险：Agent 副标题过长。缓解：只显示短 `cwdLabel`，完整 cwd 放到 hover title。

## 8. 验证计划

- `npm run typecheck` 验证跨边界类型。
- `npm run test:protocol-webview-messages` 覆盖新增 `cwd` 协议字段解析。
- `npm run test:workspace-relative-paths` 覆盖 cwdLabel 派生 helper。
- `npm run test:canvas-execution-context` 覆盖默认执行 metadata cwd、workspace-relative terminal shell path 解析基准、旧 HOME metadata 迁移，以及 workspace folder 变化时强制发布 state 的宿主源码契约。
- `npm run test:extension-manifest` 覆盖 Explorer 菜单和命令注册。
- VSCode smoke 覆盖目录 / 文件右键创建 Terminal 和 Agent 后 metadata.cwd、diagnostic cwd、Agent 副标题与侧栏第二行。

## 9. 当前验证状态

截至 2026-05-31，本设计已完成实现并通过自动化验证。PR review 后已补齐相对 Terminal shell path 解析基准、默认 metadata cwd 规范化和 workspace folder 变更刷新；已运行 `npm run typecheck`、协议 / 路径 / manifest / execution context 测试、Playwright 定向测试、`npm run build` 与 trusted VSCode smoke。普通创建入口多根 root 选择和 storage fork 不纳入本次收口。
