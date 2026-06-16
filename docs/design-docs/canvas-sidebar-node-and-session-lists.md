---
title: 画布侧栏节点列表与会话历史设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-sidebar-node-and-session-lists.md
  - docs/product-specs/canvas-sidebar-controls.md
related_plans:
  - docs/exec-plans/completed/canvas-sidebar-node-and-session-lists.md
  - docs/exec-plans/completed/canvas-sidebar-node-list-webview-conversion.md
  - docs/exec-plans/completed/sidebar-workspace-worktree-actions.md
updated_at: 2026-06-16
---

# 画布侧栏节点列表与会话历史设计

## 1. 背景

当前 sidebar 已经完成了第一轮“外层控件侧栏化”收口：`概览` 用原生 `TreeView` 承载，`常用操作` 用最小 `WebviewView` 承载，画布内只保留底角控件和节点本体。

这解决了“把非空间性动作从画布顶角拿走”的问题，但新的主路径问题仍然存在：

- 当画布中节点变多时，用户仍然缺少一个稳定的节点概览与快速定位入口。
- 当用户想回到某条旧的 `Codex` / `Claude Code` 会话时，当前只能依赖节点自身的恢复按钮，或重新手工创建节点并输入 resume 命令；侧栏里没有统一的历史入口。

因此，本轮不是重新设计 sidebar 容器本身，而是在既有 sidebar 容器里补齐两类与“多会话管理”直接相关的视图：节点列表，以及会话历史。

## 2. 问题定义

需要同时回答五个问题：

1. 节点列表应该放在 sidebar 的什么宿主表面里，才能保持当前的 VS Code 原生风格。
2. 节点列表的权威数据应该从哪里来，才能和画布状态保持一致。
3. 会话历史列表的数据应该从哪里来，才能只显示当前 workspace 的会话。
4. 会话历史为什么需要搜索框，以及这件事用 `TreeView` 还是 `WebviewView` 更合适。
5. 当侧栏不可见时，节点定位与历史恢复是否还有命令入口可走。

## 3. 目标

- 让用户在不拖动画布的情况下，也能从 sidebar 快速理解当前有哪些节点、它们的状态是什么、点一下就能回到哪里。
- 让用户在同一侧栏中看到当前 workspace 的 `Codex` / `Claude Code` 历史会话，并能通过搜索快速筛到目标会话。
- 让“从历史恢复为一个新节点”和“从历史分叉出一个新节点”都成为稳定的一跳操作，而不是要求用户手工拼 resume / fork 命令。
- 保持整个 sidebar 仍然像 VS Code 原生 view section，而不是长成新的 mini dashboard。

## 4. 非目标

- 不在本轮显示完整 transcript、完整终端输出或 provider 私有元数据。
- 不在本轮支持会话删除、重命名、归档或跨 workspace 聚合。
- 不在本轮为历史分叉新增正式分支树或机器可读 lineage；会话历史分叉只是创建同 provider 新 Agent 节点并执行 provider 原生 fork 命令。
- 不在本轮把节点列表做成可拖拽重排或层级树。
- 不在本轮引入新的 Activity Bar 容器或独立面板。

## 5. 候选方案

### 5.1 节点列表和会话历史都做成原生 `TreeView`

优点：

- 最接近 VS Code 原生 sidebar 结构。
- 宿主接线最简单。

不选原因：

- 会话历史规格明确要求在侧栏区域内提供搜索框；当前扩展 API 没有给自定义 `TreeView` 暴露同等级的内嵌搜索输入能力。
- 规格还要求双击会话项恢复；这在自定义 `TreeView` 上比在最小 `WebviewView` 里更受限。

### 5.2 节点列表用原生 `TreeView`，会话历史用最小 `WebviewView`

优点：

- 节点列表保持最原生的 TreeView 呈现，直接复用树项点击命令。
- 会话历史获得规格要求的搜索框和双击行为，同时 Webview 只承载“必须要有输入框”的那一块，仍然保持克制。

不再选用原因：

- 节点列表的新规格已经明确要求“右侧尾部显示通知图标”，而 stable `TreeView` 对 trailing icon 的公开能力仍然局限在 `FileDecoration.badge` 字符串，无法稳定复用画布节点上的 bell 图标。
- 用户已明确提出节点列表也应改成 Webview，以换取更好的图标与交互扩展性；继续把节点列表留在 `TreeView` 上，只会把后续演进继续锁死在宿主 API 限制里。

### 5.3 节点列表和会话历史都做成自绘 `WebviewView`

优点：

- 节点与会话都能共享同一套“最小 Webview 列表”基础设施，包括 ready 握手、测试动作桥接、焦点态和图标渲染方式。
- 节点列表可以直接使用与画布一致的 codicon bell 提醒图标，也可以稳定显示运行时配色的图标形圆点，不再依赖 `TreeItem` / `FileDecoration` 的 API 缺口。
- 保留了未来扩展空间，例如后续如需加入更细粒度的尾部状态、行内二次动作或更丰富的可访问性语义，不必再次迁移承载面。

当前取舍：

- Webview 只负责绘制“看起来像原生列表”的最小表面，不引入卡片、统计块或复杂装饰。
- `概览` 仍保留原生 `TreeView`；因此 sidebar 并不是“全部都做成 Webview”，而是把确实受宿主 API 限制的两个列表 section 收口到最小 Webview。

## 6. 正式方案

本方案当前涉及的主要实现落点集中在 `src/sidebar/CanvasSidebarNodeListView.ts`、`src/sidebar/CanvasSidebarSessionHistoryView.ts`、`src/common/agentSessionHistory.ts`、`src/common/canvasNodeVisuals.ts`、`src/common/agentActivityHeuristics.ts`、`src/panel/CanvasPanelManager.ts`、`src/extension.ts` 与 `package.json` 的 view/command contribution。

### 6.1 节点列表使用最小 `WebviewView`

- 在现有 `Dev Session Canvas` sidebar container 中新增一个 `节点` section。
- `节点` section 在 `package.json` 中使用 `images/dev-session-canvas-nodes-activitybar.svg` 作为专属 view icon；图标延续主 Dev Session Canvas activitybar glyph，并用右上角“三行节点圆点 + 文本线”badge 表达“节点列表”。这只是该 view section 在标题不可见或被用户拖到 Activity Bar 时的识别资产，不引入新的 Activity Bar 容器。
- 它使用最小 `WebviewView`，数据直接来自 `CanvasPanelManager` 的权威 `CanvasPrototypeState.nodes`。
- 宿主接线落在 `src/sidebar/CanvasSidebarNodeListView.ts` 与 `src/extension.ts`：前者负责把 `CanvasNodeSummary` 投影成节点列表快照并渲染最小 Webview，后者负责注册 `devSessionCanvas.sidebarNodes` view 与命令入口。
- 只投影 `agent`、`terminal`、`note` 三类节点；`file` 与 `file-list` 不进入此列表。
- 每个节点项显示：
  - 节点对应颜色的图标形圆点标记
  - 节点标题
  - 人类可读的第二行状态文案；其中 `Agent` 固定显示 `cwdLabel · provider · 状态`，其余节点继续只显示状态
  - 当节点正处于 notification 提醒中时，在该项最右侧显示通知图标
- 节点列表的图标与提醒都直接使用 Webview 内的 codicon 资源：左侧是带运行时颜色的 `circle-filled`，右侧提醒位是与画布节点一致的 `bell`。
- 节点列表与会话历史 Webview 的 codicon 资源采用与主画布一致的 bundled asset 路线：构建阶段把 `@vscode/codicons/dist/codicon.css` 打成 `dist/sidebar-codicon.css` 并连同字体资产一起发版，运行时只从扩展自己的 `dist/` 目录读取，不再直连 `node_modules/`。
- 视觉上继续收口为 VS Code 原生 sidebar 列表质感：无卡片、无阴影、无多层装饰，只保留轻量 hover / selected 态和紧凑两行排版。
- 节点列表的显示模式切换使用 VSCode 原生 view title secondary action，即 `节点` view 标题右上角宿主提供的 `...` 更多菜单；Webview 内容区不自绘 `...` 按钮或菜单。菜单项提供“平铺展示节点”和“按分组树展示节点”，默认选中按分组树展示，并用当前模式的 check icon 反馈选中项。
- 默认按分组树展示时，Webview 只把权威节点快照和 `CanvasGroupSummary` 投影成侧栏树：父子分组按层级缩进，每个分组 section 可折叠/展开；没有分组的节点进入同样可折叠的“未分组”section。这个折叠状态只存在于侧栏呈现层，不持久化为画布状态，不影响画布分组可见性，也不推导新的成员关系。
- 当存在处于 attention 状态的节点时，节点列表把“回到需要处理的节点”作为最高优先级入口：平铺展示中 attention 节点排在普通节点前；分组树展示中顶部额外显示“待处理提醒”虚拟分组，汇总所有 attention 节点，同时这些节点仍保留在原分组树位置，避免虚拟汇总覆盖真实归属。
- 多根 workspace 下的平铺展示不会完全抹平 root 归属，而是继续保留 workspace root 分组。若此时存在 attention 节点，顶部仍显示“待处理提醒”虚拟分组，并且该虚拟分组排在所有 root 分组之前；root 分组内仍保留各自节点，其中 attention 节点在对应 root 内排在普通节点前。
- `节点` view 标题栏除了创建节点和显示模式切换外，还提供两个 workspace 操作入口：添加文件夹到当前 workspace，以及新建 git worktree 并添加到当前 workspace。添加文件夹走 VS Code `workspace.updateWorkspaceFolders(...)`；新建 worktree 由宿主读取 `HEAD` 和本地分支 refs 后展示 VS Code 风格 QuickPick，成功执行 `git -C <root> worktree add ...` 后再把目标目录作为 workspace folder 加入当前窗口。
- 多根 workspace 下，如果用户从 `节点` view 标题栏点击全局新建 worktree，宿主必须先用 QuickPick 选择基准 folder，避免猜测要基于哪个仓库创建 worktree；单根 workspace 直接使用唯一 folder。选定 folder 后的第一层 QuickPick 使用 `Create Worktree (...path...) (1/2)` 标题，包含 `Create new branch...`、`Create new branch from...`、`HEAD` 和本地分支；`Create new branch from...` 进入第二层 `Create new branch from...` ref picker。创建新分支路径使用 `git worktree add -b <branch> <path> [startPoint]`，已有 ref 路径使用 `git worktree add [--detach] <path> <ref>`，其中 `HEAD` 或已被其他 worktree checkout 的分支会走 detached HEAD。
- workspace folder 分组行尾显示三个 folder 级 icon-only 操作：基于该 folder 新建 worktree 并加入 workspace、从当前 workspace 移除该 folder，以及移除 git worktree 并从 workspace 移除该 folder。它们只出现在 `role === 'workspace-root'` 且存在 `workspaceRootPath` 的系统 workspace folder 分组行，不出现在普通用户分组、未分组或待处理提醒虚拟分组。新建 worktree 按钮使用 VS Code 专用 `worktree` Codicon；移除 folder 只调用 VS Code workspace folder 移除语义，不删除磁盘目录；移除 worktree 会先确认该 folder 是 linked git worktree，再执行 `git worktree remove`。
- 点击节点项后，宿主会统一执行“打开/定位画布 -> 等待 Webview ready -> 下发 `host/focusNode`”，把节点滚入可见区域并选中。

### 6.2 会话历史使用最小 `WebviewView`

- 在同一 sidebar container 中新增一个 `会话历史` section。
- `会话历史` section 在 `package.json` 中使用 `images/dev-session-canvas-sessions-activitybar.svg` 作为专属 view icon；图标延续主 Dev Session Canvas activitybar glyph，并用右上角 badge 表达历史语义，badge 内部参考 VS Code Codicon `history` 的时钟指针部分，去掉外圈和回退箭头以保证 24px 下清晰。这只是该 view section 在标题不可见或被用户拖到 Activity Bar 时的识别资产，不引入新的 Activity Bar 容器。
- 它使用最小 `WebviewView`，原因不是要做更复杂 UI，而是必须在同一区域内提供搜索框与双击恢复能力。
- 具体承载文件是 `src/sidebar/CanvasSidebarSessionHistoryView.ts`；宿主只向 Webview 提供搜索前的 snapshot，搜索输入与双击行为都在这个最小视图内部完成。
- 视图结构只保留两层：
  - 顶部一个搜索框
  - 下方一列结果列表
- 结果项保持 VS Code 原生 list 风格：无卡片、无阴影、无多层装饰，只用主题 token、轻量 hover/selected 态和紧凑行距。
- 每条结果项采用两行紧凑结构：首行显示 provider 图标、“会话中的第一条用户指令”标题，以及右侧 `恢复` / `分叉` 两个 icon-only 按钮；按钮图标使用 VSCode Codicon，其中 `恢复` 使用 `history`，`分叉` 使用 `repo-forked`，不单独自绘同义 SVG；次行显示“相对更新时间 + sessionId”；工作目录和绝对时间收口到 tooltip。
- 搜索文本覆盖会话标题、provider、sessionId 与工作目录等信息；仍不匹配当前画布节点副标题。
- `恢复` / `分叉` 按钮都提供 `aria-label` 与 `title`，按钮最小热区为 24px；按钮点击会阻止事件冒泡，避免误触行双击。会话项本身的双击、Enter、Space 仍保持原有恢复行为。
- tooltip 只展示 provider 历史已知的会话元信息，不再注入当前画布节点标题或副标题。
- tooltip 中的工作目录追加目录尾缀，并保留 provider session 记录中 cwd 的来源分隔符风格：含反斜杠来源显示为 `\`，slash-style 来源显示为 `/`；`//server/share/...` 不被改写成 `\\server\share\...`。

### 6.3 会话历史的数据来源是 provider 当前的 session 落地文件

当前选定以下读取路径：

- `Codex`：扫描 `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`，读取首行 `session_meta` 中的 `sessionId`、`cwd` 与时间戳。
- `Claude Code`：扫描 `~/.claude/projects/**/*.jsonl`。读取 transcript 前若干行中的显式 `cwd` 作为唯一 workspace 归属依据；若整段扫描窗口内都没有可确认的 `cwd`，则直接跳过该会话，不再把 project 目录名等价成精确 workspace 回退。

对应实现集中在 `src/common/agentSessionHistory.ts`，并通过 `scripts/test/test-sidebar-session-history.mjs` 覆盖 workspace 过滤、去重、排序、Claude 跨行 `cwd` 提取、冲突目录 fail-closed，以及“跳过 provider 注入的 synthetic 首条 user message，提取第一条真实用户指令”。

过滤规则如下：

- 只保留 `cwd` 位于当前 workspace 根目录内的记录。
- 按 `provider + sessionId` 去重。
- 排序按最后修改时间倒序。

这意味着本轮会话历史仍然依赖 provider 当前的私有 session 文件格式，而不是正式公开 API。当前仓库没有更稳定的 provider-level history index，因此这是最小可行方案；如果后续 provider 提供正式 history API，应优先切换。

### 6.4 会话标题来自 provider 历史中的第一条真实用户指令

当前显示策略收口为：

1. 直接从 provider session 文件里提取第一条真实用户指令，作为会话标题。
2. 如果 provider 历史最早的 user message 实际是 Harness / suggestion mode 等注入包装，则跳过这些 synthetic message，继续查找第一条真实用户指令。
3. 只有在整个文件都无法提取出可用用户指令时，才回退为 `Codex / Claude Code + 短 session id` 的通用标题。

这样可以让侧栏标题稳定反映“这条会话最初是为了解决什么问题”，同时避免继续复用当前画布节点标题或节点副标题。

### 6.5 从历史恢复或分叉时，新建一个 `Agent` 节点并写入带默认启动参数的显式 provider 命令

- 双击会话历史项或点击 `恢复` icon 按钮后，不修改当前节点，也不要求用户二次确认。
- 点击 `分叉` icon 按钮后，同样不修改当前节点，也不要求用户二次确认；它创建同 provider 新 Agent 节点，并使用 provider 原生 fork 语义启动。
- 宿主会直接新建一个 `Agent` 节点，并把它的自定义启动命令写成“当前 provider 命令 + 当前默认启动参数 + 显式 resume / fork 参数”的组合；例如：
  - `codex resume <当前仍有效的默认参数...> <session-id>`
  - `claude --resume <session-id> <当前仍有效的默认参数...>`
  - `codex fork <当前仍有效的默认参数...> <session-id>`（实现上命令层把 `fork` 尽量前置，session id 保持在命令尾部）
  - `claude --resume <session-id> --fork-session <当前仍有效的默认参数...>`
- 这里的“沿用默认启动参数”不是盲目把默认字符串原样拼到显式目标恢复或分叉后面；若默认参数里已含 `Codex resume --all`、`--include-non-interactive` 这类只影响 picker / `--last` 选择范围的参数，历史恢复 / 分叉时要先剥离这些选择阶段参数，再写入目标 `session-id`。与之相对，`--model`、`--sandbox`、`--ask-for-approval` 等对显式 `resume <session-id>` / `fork <session-id>` 仍有效的参数继续保留；而 `resume` / `fork` / `--resume` 这类模式 argv 本身则尽量前置到命令前部。
- 历史分叉节点标题使用原会话标题加 `分叉` 后缀作为弱提示；从历史列表发起时没有现有画布来源节点，因此不自动创建 `fork` 连线。
- 新节点创建后，宿主会自动打开或定位画布，并聚焦到新节点。
- 后续自动启动仍沿用现有 `Agent` 节点“等待尺寸就绪后自动启动”的宿主/前端链路，不再另开一套特殊恢复流程。

这条链路收口在 `src/panel/CanvasPanelManager.ts` 的 `restoreAgentSessionFromHistory(...)`、`forkAgentSessionFromHistory(...)`、`focusNodeById(...)`、`buildHistoryResumeCommandLine(...)` 和 `buildAgentBranchCommandLine(...)`，并由 `src/extension.ts` 暴露给 sidebar 内部命令与 QuickPick 回退入口。

### 6.6 侧栏不可见时，仍保留命令入口

为了满足规格里的“侧栏不可见时仍可通过命令入口访问”，当前再补两条命令：

- `显示节点列表`：用 QuickPick 临时展示当前非文件节点，选择后定位到画布节点。
- `显示会话历史`：用 QuickPick 临时展示当前 workspace 会话记录，选择后恢复或分叉为新节点。

它们不是新的主交互面，而是 sidebar 被折叠、移动或暂时不可见时的回退入口。

## 7. 风险与取舍

- 风险：`Codex` / `Claude Code` 的 session 文件格式不是本扩展控制的正式接口。
  当前缓解：读取逻辑只做只读扫描，并在无法确认 `cwd` 或 `sessionId` 时 fail closed，不把猜测结果显示为当前 workspace 记录。

- 风险：`Claude Code` 某些 transcript 文件可能没有稳定的 `cwd` 字段。
  当前缓解：扫描 transcript 前若干行里的显式 `cwd`；一旦仍无法确认，就直接 fail closed，不再把 lossy 的 project 目录名映射写成精确 workspace 事实。

- 风险：provider transcript 里的第一条 user message 不一定就是用户自然输入，可能混入 Harness 上下文或 suggestion-mode 包装。
  当前缓解：会话标题提取采用 fail-closed 启发式，只跳过已确认的 synthetic 前缀；一旦无法确认真实用户指令，就回退到 `provider + 短 session id`，而不是猜测标题。

- 风险：如果节点列表和会话历史都在 Webview 中渲染得过重，就会破坏当前 sidebar 的原生感。
  当前缓解：两个 Webview 都只承载紧凑列表，不引入卡片、统计块或说明面板；节点列表也继续保持“标题 + 状态 + 尾部提醒”的最低信息密度。

- 风险：从历史恢复时直接新建节点，会增加画布节点数量。
  当前缓解：这是有意选择；它保留了“历史恢复是新窗口”的空间语义，也避免把当前节点突然改绑到另一条旧会话上。

## 8. 验证方法

至少需要完成以下验证：

1. 打开 `Extension Development Host` 后，sidebar 中能看到新增的 `节点` 与 `会话历史` section。
2. 节点列表中不出现 `file` / `file-list` 节点；点击任一项后，画布能滚动并聚焦到对应节点。
3. `节点` view 默认按分组树展示，标题右上角使用 VSCode 原生 `...` 菜单承载平铺 / 按分组树展示切换；按分组树展示时，分组和“未分组”section 可折叠/展开，折叠只影响侧栏列表可见行。
4. attention 节点在单根平铺展示中排在普通节点前；按分组树展示中顶部出现“待处理提醒”虚拟分组，且不移除节点的原分组位置；多根 workspace 平铺展示中保留 root 分组，并让“待处理提醒”虚拟分组排在 root 分组之前。
5. `节点` view 标题栏提供添加 workspace folder 与新建 worktree 的全局按钮；多根 workspace 下全局新建 worktree 先选择基准 folder。
6. 新建 worktree 的第一层 QuickPick 包含创建新分支、从 ref 创建新分支和已有 ref 选择；第二层只在用户选择 `Create new branch from...` 时出现；已有 ref 创建不要求输入新分支名。
7. workspace folder 分组行尾只在系统 workspace folder 分组上显示新建 worktree、移除 folder 与移除 worktree 三个 icon-only 操作；普通用户分组和虚拟分组不显示这组 folder 操作；新建 worktree 图标使用 `worktree` Codicon。
8. workspace folder 行新建 worktree 成功后，新 worktree 目录被加入当前 workspace；workspace folder 行移除 folder 后，该 folder 从当前 workspace 中移除但磁盘目录不被删除；移除 worktree 会删除对应 git worktree 目录并从 workspace 移除该 folder。
9. 会话历史中只出现当前 workspace 的 `Codex` / `Claude Code` 记录，默认按最近更新时间倒序。
10. 搜索框输入关键词后，列表会即时过滤。
11. 双击一条会话后，会新建一个 `Agent` 节点，并带着正确的 provider resume 命令进入自动启动链路。
12. 点击会话项右侧 `恢复` icon 按钮后，效果与双击一致；点击 `分叉` icon 按钮后，会新建同 provider `Agent` 节点，并带着正确的 provider-native fork 命令进入自动启动链路。
13. 折叠或离开 sidebar 时，命令面板仍可通过“显示节点列表”“显示会话历史”到达相同能力。

## 9. 当前验证状态

- 2026-06-16：根据 VS Code Source Control 截图反馈，worktree 全局命令与 workspace folder 行按钮改用专用 `worktree` Codicon；新建 worktree 流程从单一分支名输入扩展为 `Create Worktree (...path...) (1/2)` + `Create new branch from...` 的 QuickPick ref 选择，可创建新分支、从指定 ref 创建新分支或直接基于已有 ref 创建；`HEAD` 或已被其他 worktree checkout 的分支会走 detached HEAD。已复跑 `npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-codicon-bundle`、`npm run test:sidebar-list-colors`、`npm run typecheck`、`npm run build` 与 `git diff --check`。
- 2026-06-16：`节点` view 标题栏新增添加 workspace folder 与新建 worktree 入口，workspace folder 分组行尾新增 folder 级新建 worktree / 移除 folder / 移除 worktree 操作；已新增 `npm run test:sidebar-node-list` 覆盖 workspace folder 行 action 呈现和 Webview 消息，`npm run test:extension-manifest` 覆盖 sidebar title action 与 folder scoped 命令 contribution。真实 VS Code 中的文件夹 picker、`git worktree add`、`git worktree remove` 与 workspace folder 增删仍需人工验证。
- 2026-06-15：会话历史项右侧 `恢复` / `分叉` icon-only 按钮收口为 bundled VSCode Codicon（`history` / `repo-forked`），与节点列表和模板侧栏共用 `dist/sidebar-codicon.css` 资源路线。
- 2026-06-15：会话历史 view section 新增专属 `images/dev-session-canvas-sessions-activitybar.svg`，沿用主 glyph + 右上角 badge 约定，badge 内部参考 VS Code Codicon `history` 的时钟指针部分；已纳入 `npm run test:activitybar-badges` 与 manifest 测试。
- 2026-06-14：会话历史项右侧新增 `恢复` / `分叉` 两个 icon-only 按钮，双击与 Enter / Space 保持既有恢复行为；Host 新增 `forkAgentSessionFromHistory(...)`，从历史会话生成 provider-native fork 启动命令。已运行 `npm run typecheck`、`npm run test:sidebar-session-history` 与 `git diff --check`。

- 2026-06-13：节点列表 attention 入口补齐三条规则：单根平铺展示中 attention 节点前置；分组树展示中顶部显示“待处理提醒”虚拟分组且保留原分组位置；多根 workspace 平铺展示保留 workspace root 分组，并把“待处理提醒”虚拟分组排在 root 分组之前。新增 `npm run test:sidebar-node-list` 覆盖这些 DOM 排序与分组规则。
- 2026-05-11：`节点` view section 新增专属单色 SVG 图标，manifest 改为引用 `images/dev-session-canvas-nodes-activitybar.svg`；已通过 `npm run typecheck`、`npm run build` 与本地 manifest 图标路径检查验证。
- 2026-06-03：会话历史 tooltip 的工作目录追加目录尾缀，并按 cwd 来源分隔符显示 POSIX、Windows drive、反斜杠 UNC 与 slash-style network path；已通过 `npm run test:sidebar-session-history`、`npm run test:workspace-relative-paths` 与 `npm run typecheck`。
- 2026-06-03：节点列表中的 Agent 第二行跟随 Explorer cwd 可见反馈，显示 `cwdLabel · provider · 状态`；`cwdLabel` 追加目录尾缀并保留 cwd 来源分隔符。本轮已通过 `npm run test:workspace-relative-paths` 与 `npm run typecheck`。
- 2026-05-26：`节点` view 默认按分组树展示；显示模式切换从 Webview 内容区自绘更多按钮收口到 VSCode 原生 view title `...` 菜单，并把按分组展示改为可折叠的侧栏分组树；该折叠状态只属于侧栏呈现，不改变画布分组事实。已通过 manifest、类型检查、侧栏颜色 token、build 和 diff 检查；`trusted` VSCode smoke 已执行到侧栏分组树路径，随后在既有 Note Markdown 文件关联用例中超时，需后续单独收口该非本轮 blocker。
- 2026-04-29 已修复三条 review blocker：节点列表 Webview 的 codicon 资源现改为与主画布一致的 bundled asset，构建产物与 VSIX 都从 `dist/sidebar-codicon.css` 读取；Claude 会话历史只接受 transcript 内显式 `cwd`，冲突 project 目录下缺少 `cwd` 的会话会 fail closed；历史恢复节点会把当前 provider 默认启动参数并入显式 resume 命令。对应自动化验证已通过 `node scripts/test/test-sidebar-codicon-bundle.mjs`、`node scripts/test/test-sidebar-session-history.mjs` 与 `node scripts/test/test-agent-launch-presets.mjs`。
- 2026-04-28 已完成上一版节点列表与会话历史实现，并通过 `node scripts/test/test-sidebar-session-history.mjs` 与 `npm run test:smoke`，证明 provider session 扫描、workspace 过滤、节点聚焦与历史恢复主路径成立。
- 2026-04-28 产品规格新增两条节点列表要求：次级描述只显示状态，不再显示副标题；当节点正处于 notification 提醒中时，该项最右侧显示通知图标。
- 2026-04-30：节点列表的次级描述继续保持紧凑，但对 `Agent` 节点改成显示 `provider · 状态`，以便在侧栏里更快区分 `Codex` / `Claude Code` 会话；对应 smoke 断言同步收口。
- 2026-04-28 已按新规格更新实现：节点列表次级描述收口为“仅状态”，并先用 `resourceUri + FileDecorationProvider` 输出提醒徽标闭合主路径；这一版已经通过 `npm run typecheck`、`npm run build`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 与 `node scripts/test/test-sidebar-session-history.mjs`。
- 2026-04-28 会话历史列表已按最新视觉要求改成“两行原生列表”样式：首行显示 provider 图标和标题，次行显示相对更新时间；详情信息继续留在 tooltip 和搜索文本中；并已通过 `npm run typecheck`、`npm run build`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 与 `node scripts/test/test-sidebar-session-history.mjs`。
- 2026-04-28 会话历史列表已进一步按最新规格收口：标题改为 provider 历史中的第一条真实用户指令，第二行改为“相对时间 + sessionId”，tooltip 移除画布节点标题/副标题；后续再补搜索体验时，搜索范围调整为“匹配会话标题 + provider / sessionId / 工作目录”，不再沿用“不匹配标题”的旧口径。
- 2026-04-28 节点列表已切换到最小 `WebviewView`：左侧使用运行时配色的 `circle-filled` 图标，右侧提醒位改成与画布节点一致的 `bell`，并补专门 UI 回归覆盖点击聚焦与提醒图标呈现；已通过 `npm run typecheck`、`npm run build`、`node scripts/test/test-sidebar-session-history.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs`。
- 当前仍保持 `验证中`：节点列表 Webview 化主路径已经通过自动化验证，但整份设计仍包含“会话历史依赖 provider 私有 session 文件格式”这条已登记技术债，因此暂不把整体文档改成 `已验证`。
