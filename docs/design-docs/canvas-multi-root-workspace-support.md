---
title: 画布多根 workspace 支持设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/explorer-resource-create-execution-node.md
  - docs/product-specs/canvas-sidebar-node-and-session-lists.md
related_plans:
  - docs/exec-plans/active/canvas-multi-root-workspace-support.md
updated_at: 2026-06-01
---

# 画布多根 workspace 支持设计

## 1. 背景

Dev Session Canvas 的核心对象是绑定当前 VSCode workspace 的一张协作画布。File Explorer 资源右键创建 `Terminal` / `Agent` 已经把执行节点从“默认 workspace 根目录”扩展到“节点 metadata 持有自己的 cwd”。这让多根 workspace 支持具备了基本前提：画布可以继续保持一张共享画布，但执行节点、文件活动、历史会话和路径展示必须知道自己属于哪个 workspace folder。

VSCode multi-root workspace 中常见多个 root 同时存在，例如 `frontend` 与 `backend`。如果普通画布创建入口仍静默使用第一个 root，或路径展示仍只写 `src/index.ts`，用户会无法判断 Agent / Terminal 在哪个工程里运行，也可能在点击文件链接时打开另一个 root 下的同名文件。

## 2. 问题定义

本设计需要回答六个问题：

1. 当前画布在多根 workspace 下是一张共享画布，还是每个 root 独立一张画布。
2. 普通创建入口在多根 workspace 下如何确定 `Agent` / `Terminal` 的初始 cwd。
3. 节点、侧栏、文件活动和历史会话如何展示 root-aware 的目录标签，避免同名路径混淆。
4. 执行启动、重启、恢复和诊断如何持续使用节点自己的 cwd，而不是第一个 workspace root。
5. 文件链接与 Note 链接在多根 root 下如何解析相对路径，避免模糊命中。
6. workspace folder 增删后，既有节点如何降级而不是被静默改绑。

## 3. 目标

- VSCode multi-root workspace 下仍使用一张共享画布；不按 root 拆分独立画布。
- 单根 workspace 的现有创建、展示、执行与文件路径语义保持不变。
- 多根 workspace 下，普通画布创建入口、侧栏创建入口和命令面板创建入口在创建 `Agent` / `Terminal` 前必须选择 workspace folder；Explorer 右键入口继续从资源路径推导 cwd，不重复弹 root picker。
- `Agent` / `Terminal` metadata 持久化绝对 cwd；启动、重启、resume、CLI 解析、shell env、runtime supervisor、diagnostics 和 file activity 都使用该 cwd。
- Webview 与侧栏使用同一套 root-aware label 规则：单根显示 root-relative path，多根显示 workspace folder 前缀；重复 root name 时自动消歧。
- 文件活动、Note 链接和执行终端链接在多根 workspace 下避免模糊打开；只有明确在某个节点 cwd 或唯一 workspace 命中时才自动打开。
- workspace folder 变化时刷新 Webview runtime 与侧栏状态；绑定已移除 root 的节点保留在画布上，但后续执行进入明确错误态。

## 4. 非目标

- 不实现独立 app 式 workspace 管理、root 切换器或项目启动器。
- 不把 multi-root 拆成多张画布，也不引入跨 workspace 共享 / 合并 / 同步能力。
- 不重新实现 File Explorer 创建执行节点；该入口作为已存在能力继续复用节点 cwd 语义。
- 不对旧节点做不透明迁移到其他 root；缺失或失效 cwd 必须显式呈现。
- 不在第一版承诺所有 provider 私有历史格式都能无歧义覆盖；缺少可信 cwd 的历史继续 fail closed。

## 5. 候选方案与取舍

### 5.1 方案 A：每个 workspace folder 一张画布

做法是按 root 分裂画布状态和持久化，每个 root 都有独立节点图。

优点是执行 cwd 和文件路径天然单根化。缺点是 Dev Session Canvas 的价值在于同一张画布上理解多个 `Agent` / `Terminal` 的协作状态；拆分画布会让跨 root 协作回到多视图切换，并引入状态迁移、切换器和多画布持久化问题。

本轮不采用。

### 5.2 方案 B：继续静默使用第一个 workspace folder

做法是保留现有默认 cwd 行为，仅让 Explorer 入口支持其他 root。

优点是实现最小。缺点是普通创建入口在 multi-root 下会稳定落错 root，且用户无法从 UI 中判断为什么 Agent 在第一个工程里启动。这是确定性产品 bug，不符合“不要把未确认内容写成已确认内容”的文档原则。

本轮不采用。

### 5.3 方案 C：共享画布 + 节点 cwd 权威 + 创建前 root picker

做法是保留单一画布状态，执行节点 metadata 持有绝对 cwd。普通创建入口在多根 workspace 下先选择 root，再创建节点；Explorer 入口直接用资源 cwd。Host 侧继续是权威，Webview 只负责落位和局部展示，路径 label 与相对路径解析统一使用 workspace folder 列表。

优点是保持画布协作价值，同时让每个执行节点有明确 root 归属；对现有 Explorer cwd 能力和 runtime supervisor 影响可控。缺点是创建步骤多一步，但只在多根 workspace 且创建执行节点时出现。

本轮采用。

## 6. 正式方案

### 6.1 画布与 workspace folder 模型

`src/panel/CanvasPanelManager.ts` 继续作为画布权威状态入口。`CanvasPrototypeState` 不新增 root 级画布分片；`AgentNodeMetadata.cwd` 与 `TerminalNodeMetadata.cwd` 继续是执行目录权威。

`src/common/protocol.ts` 中 `CanvasRuntimeContext.workspaceFolders` 继续承载当前 VSCode workspace folders。该列表只用于 Webview 展示、创建入口提示和 label 派生，不作为安全或权限判断来源。Host 侧使用 `vscode.workspace.workspaceFolders`、`vscode.workspace.getWorkspaceFolder()` 和路径包含判断做最终校验。

`vscode.workspace.onDidChangeWorkspaceFolders` 发生时，Host 必须：

- 清空 shell env 与 Agent CLI 解析缓存。
- 重新 reconcile 仅代表旧 HOME 默认值的执行 metadata；明确绑定其他 cwd 的节点不自动改绑。
- 刷新 terminal shell metadata。
- 无条件发送 `host/stateUpdated` 并刷新 sidebar state，让 Webview runtime 的 workspace folder 列表即时更新。

### 6.2 创建入口的 cwd 选择

普通命令 `devSessionCanvas.createNode`、侧栏动作和 Webview 右键菜单共享同一原则：

- `Note` 不需要 cwd，创建行为不变。
- 单根 workspace 下，`Agent` / `Terminal` 默认使用唯一 workspace folder 的 root。
- 多根 workspace 下，创建 `Agent` / `Terminal` 前必须选择 workspace folder。选择项显示 root name 和绝对路径；重复 name 时展示更长路径帮助消歧。
- 无 workspace folder 时，继续回退宿主 HOME 作为无 workspace 兼容路径。

Host 命令和侧栏入口在 `src/extension.ts` 中通过 Quick Pick 选择 root，并把选择结果作为 `cwdOverride` 传给 `CanvasPanelManager.createNode(...)`。Webview 右键菜单无法直接调用 VSCode Quick Pick，因此在多根 workspace 下创建 execution node 时，Webview 将 `requiresWorkspaceFolderSelection: true` 写入 `webview/createDemoNode`；Host 收到后显示 root picker，再按 Webview 传回的 preferred position 与 target group 创建节点。扩展内部为了安装 Agent CLI 自动创建 Terminal 并执行命令时，也必须在多根 workspace 下复用同一 root picker；这类入口虽然不是用户显式选择“创建节点”，但最终仍会产生执行节点和运行 cwd。

Explorer 资源右键入口已经从文件或目录推导 cwd，本轮不再弹 root picker；其 cwd 必须继续通过 `validateExecutionCwd(...)` 校验属于当前 workspace。

### 6.3 可见反馈与 cwd label

`src/common/executionCwdLabel.ts` 是 Webview 与侧栏共享的 cwd label 规则入口。本轮扩展为：

- 单根 workspace：root 下目录显示相对路径，例如 `src/panel`；cwd 等于 root 时显示 workspace folder name。
- 多根 workspace：显示 `workspace-label/relative/path`；cwd 等于 root 时显示 `workspace-label`。
- 多个 folder name 重复时，`workspace-label` 自动附加足够的父级路径片段；仍无法消歧时附加序号。
- workspace 外或已移除 root 的 cwd 退化为目录 basename，tooltip 保留完整规范化路径。

`Agent` 节点标题副标题保持 `cwdLabel · 启动命令`。`Terminal` 节点标题栏仍优先展示 shell path，但侧栏节点列表应对 `Agent` 与 `Terminal` 都显示 root-aware cwd label，避免多个执行节点在多根 workspace 中无法区分。

### 6.4 执行语义与失效 cwd

执行节点启动前使用 `getExecutionNodeCwd(...)` 从 metadata 读取 cwd，并由 `describeUnavailableExecutionCwd(...)` 做最后校验。若 cwd 不存在、不可访问、不是目录或不属于当前 workspace：

- 不自动 fallback 到第一个 workspace folder。
- 节点进入 `error` / `resume-failed` 等当前路径已有错误态。
- `summary`、`lastExitMessage` 和 host error 写明目标目录不可用。
- 保留原 cwd，用户恢复 workspace folder 或目录后可以再次启动。

`resolveAgentCli(...)`、`resolveExecutionEnvironment(...)`、`getResolvedShellEnvironmentPatch(...)`、runtime supervisor createSession 和 file activity session 都接收节点 cwd。`devSessionCanvas.terminal.shellPath` 的显式相对路径继续按 workspace/configuration cwd 解析成 shell executable；执行进程 cwd 与 shell executable 解析基准保持分离。

### 6.5 文件链接、Note 链接与文件活动

执行终端链接解析优先使用当前节点 cwd 和行上下文 cwd。多根 workspace 下，如果链接是相对路径，Host 不应直接在所有 root 中任意挑一个同名文件；只能在节点 cwd 可证明的上下文或唯一 workspace 命中时打开。模糊命中时通过 rejected diagnostic 或后续 Quick Pick 处理，本轮第一版选择拒绝自动打开。

Note Markdown 链接解析继续使用 `docs/design-docs/note-markdown-file-association.md` 中已定义的 workspace-relative 规则。多根 workspace 下，链接若写成 `workspace-folder/path` 可以解析到指定 root；裸相对路径在多个 root 命中时不自动打开。

文件活动 `relativePath` 继续复用“单根纯相对、多根带 folder 前缀”的规则。重复 workspace folder name 时应使用同一套消歧后的 label，避免两个 root 都显示成同一个前缀。

### 6.6 侧栏会话历史

`src/sidebar/CanvasSidebarSessionHistoryView.ts` 从单一 `workspaceRoot` 扩展为 `workspaceRoots`。Codex / Claude 历史扫描仍只接受 transcript 中可信 cwd；若 cwd 落在任一当前 root 下则纳入列表。列表 tooltip、searchText 和 Quick Pick detail 使用 root-aware cwd label。

恢复历史为 Agent 节点时，Sidebar 必须把历史 entry 的 cwd 一并传给 `CanvasPanelManager.restoreAgentSessionFromHistory(...)`，新节点 metadata.cwd 等于历史 cwd。若历史 cwd 后续已不在当前 workspace 内，或 multi-root 恢复请求缺少可信 cwd，则恢复失败并给出可读错误，不静默改绑到第一个 root。

## 7. 风险与缓解

- 风险：多根 workspace 下创建执行节点多一步选择，降低快捷性。缓解：仅在 workspace folder 数量大于 1 且创建 execution node 时出现；Explorer 右键入口仍零额外步骤。
- 风险：重复 workspace folder name 造成 label 仍不唯一。缓解：共享 label helper 使用父级路径片段和序号消歧。
- 风险：旧节点 cwd 已不在 workspace 中。缓解：保留节点并在启动时明确报错，不自动迁移。
- 风险：文件链接 fallback 过于保守导致少量链接不能自动打开。缓解：优先保证不打开错文件；后续可补 ambiguous Quick Pick。
- 风险：会话历史扫描多个 root 增加成本。缓解：历史扫描仍先读 provider 本地索引并限制 maxEntries；多 root 只扩大 cwd 包含判断。

## 8. 验证计划

- `npm run test:workspace-relative-paths` 覆盖 cwd label、重复 root name 消歧、文件相对路径前缀。
- `npm run test:protocol-webview-messages` 覆盖 `requiresWorkspaceFolderSelection` 协议字段。
- `npm run test:canvas-execution-context` 覆盖默认 cwd、workspace folder change 刷新契约和 Webview 请求 Host root picker 的源码契约。
- `npm run test:sidebar-session-history` 覆盖多个 workspace root 历史扫描、展示和 restore cwd 传递。
- `npm run test:extension-manifest` 维持命令 / 菜单注册不回归。
- `npm run typecheck` 与 `npm run build` 验证跨边界类型和打包。
- 必要时补 VSCode smoke：创建临时 `.code-workspace`，验证多根下 root picker、Explorer cwd 和启动 diagnostic cwd。

## 9. 当前验证状态

截至 2026-06-01，本设计的第一版实现已经落到 `canvas-multi-root-workspace-support` 分支，验证状态保持“验证中”。已完成的自动化证据覆盖共享 label helper、重复 root name 消歧、协议字段、Webview 多根创建请求、Host 侧 root picker 源码契约、侧栏历史多 root 扫描、历史 cwd 传递、Note 链接重复 root fail closed、typecheck、build 和定向 Playwright harness。验证命令包括：

    TMPDIR=$PWD/.debug/tmp npm run test:workspace-relative-paths
    TMPDIR=$PWD/.debug/tmp npm run test:protocol-webview-messages
    TMPDIR=$PWD/.debug/tmp npm run test:sidebar-session-history
    TMPDIR=$PWD/.debug/tmp npm run test:canvas-execution-context
    TMPDIR=$PWD/.debug/tmp npm run test:note-markdown-links
    TMPDIR=$PWD/.debug/tmp npm run test:extension-manifest
    TMPDIR=$PWD/.debug/tmp npm run build
    TMPDIR=$PWD/.debug/tmp npm run test:webview -- --grep "multi-root canvas execution creation|multi-root canvas note creation|host-triggered execution"
    TMPDIR=$PWD/.debug/tmp npm run typecheck
    git diff --check

尚未完成完整 VSCode smoke 或真实 multi-root 窗口人工验收，因此不把本设计标记为“已验证”。后续若要升级状态，应补一个包含至少两个 workspace folder 的真实 VSCode 场景，验证命令面板创建、侧栏创建、Explorer 资源创建、历史恢复、移除 root 后启动失败提示，以及重载后的 cwd 保持。
