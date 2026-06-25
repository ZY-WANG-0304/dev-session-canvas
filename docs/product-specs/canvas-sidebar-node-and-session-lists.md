# 画布侧栏节点列表与会话历史规格

当前状态：草案。本文档定义在 VSCode 侧栏中新增节点列表与历史会话列表的产品范围与验收口径。

## 1. 用户问题

当用户在画布上放置多个节点并进行多轮协作时，存在以下问题：

- 用户缺少一个结构化的节点概览视图，难以快速理解当前画布上有哪些节点、它们的类型和状态。
- 当画布视口较大或节点分散时，用户需要频繁拖动或缩放才能找到目标节点。
- 用户缺少一个统一的历史会话入口，无法快速回溯当前 workspace 下 Codex 和 Claude Code 的历史协作记录。
- 当用户需要在多个会话之间切换或查找特定会话时，缺少有效的检索和导航手段。

## 2. 目标用户

本规格优先服务已经在 VSCode 中使用 Dev Session Canvas 画布进行多 Agent 协作的开发者。用户需要：

- 在不离开当前工作流的前提下，快速了解画布上的节点分布
- 通过点击节点列表项快速定位到画布中的目标节点
- 查看和检索当前 workspace 下的历史会话记录

## 3. 核心用户流程

### 节点列表流程

1. 用户在 VSCode 侧栏中打开 Dev Session Canvas 视图，看到节点列表区域。
2. 节点列表显示当前画布上的所有非文件类型节点，每个节点显示：节点对应颜色的图标形圆点标记、节点标题、第二行状态信息；其中 `Agent` 节点的第二行显示 `cwdLabel · provider · 状态`，其他节点继续只显示状态；当节点正处于 notification 提醒中时，该项最右侧显示通知图标。
3. 用户点击列表中的某个节点项，画布自动定位到该节点位置（类似大纲视图的跳转行为）。
4. 节点列表默认使用“按分组树展示节点”；用户通过 `节点` view 标题右上角的 VSCode 原生 `...` 更多菜单切换“平铺展示节点”和“按分组树展示节点”。按分组树展示时，分组标题按画布分组树缩进呈现，并可在侧栏中折叠/展开具体分组 section，但不折叠画布上的分组框，也不改变任何分组事实；若存在处于 attention 状态的节点，顶部额外显示一个“待处理提醒”虚拟分组汇总这些节点。
5. 平铺展示在单根 workspace 下仍显示为普通列表；若存在处于 attention 状态的节点，这些节点排在普通节点前。多根 workspace 下的平铺展示仍保留 workspace root 分组；若存在处于 attention 状态的节点，顶部先显示“待处理提醒”虚拟分组，然后再显示各 root 分组。
6. 当画布上的节点发生变化（新增、删除、状态更新）时，节点列表自动同步更新。
7. 用户可以在 `节点` view 标题栏直接添加文件夹到当前 workspace，也可以进入 worktree 流程：既能新建 git worktree 并把新目录加入 workspace，也能从 `git worktree list` 中选择一个尚未加入当前 workspace 的已有 worktree 直接加入；多根 workspace 下全局 worktree 流程先选择基准 folder，再用 VS Code 风格 QuickPick 选择添加已有 worktree、创建新分支、从指定 ref 创建新分支或直接基于已有 ref 创建 worktree。
8. 多根 workspace 的 workspace folder 分组行最前面用图标区分普通 folder、git repository 和 git worktree；行尾提供 folder 级操作：基于该 folder 新建 worktree 并加入 workspace、移除 git worktree 并从 workspace 移除该 folder，以及仅从当前 workspace 移除该 folder；新建 worktree 使用 VS Code 专用 `worktree` Codicon，普通移除 folder 不删除磁盘目录，移除 worktree 会执行 `git worktree remove`。

### 历史会话列表流程

1. 用户在同一侧栏视图中看到历史会话列表区域。
2. 会话列表按时间倒序显示当前 workspace 下的 Codex 和 Claude Code 历史会话，最新会话在上；每条采用紧凑两行结构，首行显示 provider 图标和“会话中的第一条用户指令”作为标题，次行显示相对时间和 session id。
3. 用户可以使用搜索框按会话标题、provider、session id、工作目录等信息过滤会话列表；搜索不匹配画布节点副标题。
4. 每个会话项右侧显示两个 icon-only 操作按钮：按钮图标使用 VSCode Codicon，`恢复` 使用 `history`，`分叉` 使用 `repo-forked`；`恢复` 使用 provider 显式 resume 语义创建新 Agent，`分叉` 使用 provider 原生 fork 语义创建新 Agent；当前会话项双击、选中项 Enter / Space 的效果保持为原来的 `恢复`，不改成分叉或展开菜单。恢复新建节点时沿用当前 provider 命令与默认启动参数，并显式附加目标会话的 resume 参数；resume 相关 argv 应尽量前置到命令前部；若默认启动参数里已含只作用于 resume picker / `--last` 选择范围的参数（如 `Codex --all`、`--include-non-interactive`），历史恢复时要先剥离这些选择阶段参数，再写入目标 `session-id`。分叉新建节点时复用当前 provider 命令与默认启动参数，并生成 provider 原生 fork 命令：Codex 使用 `fork <session-id>`，Claude Code 使用 `--resume <session-id> --fork-session`。
5. 用户可以通过 `会话历史` view 标题右上角的 VSCode 原生 `...` 更多菜单多选分组开关：多根 root workspace 下按 root 分组（默认开启）、按 provider 分组、按分级时间分组（`24小时内`、`一周内`、`更早`）。当多个开关同时开启时，列表按 root > provider > 时间的层级呈现；root 分组在单根 workspace 下不产生额外视觉分组。

## 4. 在范围内

### 节点列表

- 在 VSCode 侧栏中新增节点列表区域，集成到现有侧栏容器中。
- 节点列表显示当前画布上的所有节点，但排除文件类型的节点。
- 每个节点项显示以下信息：
  - 节点对应颜色的图标形圆点标记
  - 节点标题/名称
  - 节点状态；其中 `Agent` 节点第二行显示 `cwdLabel · provider · 状态`
  - 节点处于 notification 提醒中时，在该项最右侧显示通知图标
- 点击节点项后，画布自动定位到该节点位置（类似大纲视图的跳转）。
- 节点列表与画布状态实时同步，当画布节点变化时自动更新。
- `节点` view 的显示模式入口使用 VSCode 原生 view title secondary action，也就是标题右上角 `...` 更多菜单；Webview 内容区不自绘额外的更多按钮或菜单。
- 节点列表默认按分组树展示，也支持切回平铺展示。按分组树展示时，每个分组 section 按当前画布分组层级缩进，并可独立折叠/展开；未分组节点进入一个同样可折叠的“未分组”section。该折叠状态只属于侧栏呈现，不持久化为画布分组折叠，也不影响画布分组内容。
- 当存在处于 attention 状态的节点时，平铺展示把这些节点排在普通节点前；按分组树展示在顶部显示“待处理提醒”虚拟分组汇总这些节点，同时保留节点在原分组树中的位置。
- 多根 workspace 下，即使用户切到平铺展示，节点列表也保留 workspace root 分组；此时若存在处于 attention 状态的节点，顶部仍显示“待处理提醒”虚拟分组，并且这个虚拟分组排在 root 分组之前。
- `节点` view 标题栏提供添加 workspace folder 与 worktree 的全局入口；worktree 流程的第一层 QuickPick 先提供 `Add existing worktree to workspace...` 分支，再提供新建 worktree 分支；新建成功后必须把新 worktree 目录加入当前 workspace，添加已有分支不得执行 `git worktree add`，只把已存在且尚未在当前 workspace 中的 worktree 目录加入当前 workspace。
- 新建 worktree 的宿主交互对齐 VS Code Source Control：第一层 QuickPick 除添加已有 worktree 外，还展示 `Create new branch...`、`Create new branch from...`、`HEAD` 和本地分支 refs；选择 `Create new branch from...` 后进入第二层 ref QuickPick；只有创建新分支路径需要输入分支名，已有 ref 路径直接确认目标目录；`HEAD` 或已被其他 worktree checkout 的分支会以 detached HEAD 创建，避免重复 checkout 同一分支失败。
- 多根 workspace 下，workspace folder 分组行最前面提供 folder 类型图标：普通 folder 使用 `folder` Codicon，git repository 使用 `repo` Codicon，linked git worktree 使用 `worktree` Codicon；未发现 `.git` 时显示普通 folder，`.git` 文件读取失败或无法识别时保守显示 git repository。
- 多根 workspace 下，workspace folder 分组行尾提供 `新建 worktree 并加入 workspace`、`移除 worktree 并从 workspace 移除 folder` 与 `从 workspace 移除 folder` 三个 icon-only 操作；workspace folder 行的 worktree 流程直接使用该 folder，不再额外要求用户选择基准 folder；worktree 按钮必须使用 bundled VSCode Codicon `worktree`。
- 从 workspace 移除 folder 只调用 VS Code workspace folder 移除语义，不删除目录或 git worktree；移除 worktree 会先确认该 folder 是 linked git worktree，再执行 `git worktree remove` 并从 workspace 移除对应 folder。
- 当 worktree 功能不可用时，必须通过 modal 明确提示具体原因，例如 workspace 未受信任、当前 folder 不是本地文件系统 folder、当前 folder 还不是 git repository、当前 folder 不是可移除的 linked worktree，或环境中找不到 `git`。
- UI 风格符合 VSCode 原生 sidebar 内容列表风格，简洁克制，不加过多装饰和线条。

### 历史会话列表

- 在同一侧栏视图中新增历史会话列表区域。
- 会话列表按时间倒序排列，最新会话在上。
- 只显示当前 workspace 下的会话记录。
- 分别显示 Codex 和 Claude Code 的历史会话（两者独立存储）。
- 每条会话项采用紧凑两行结构：
  - 首行显示 Codex / Claude Code provider 图标和会话中的第一条用户指令
  - 次行显示相对时间和 session id
- 提供搜索过滤功能，支持按会话标题、provider、session id、工作目录等信息筛选；不匹配节点副标题。
- `会话历史` view 的分组入口使用 VSCode 原生 view title secondary action，也就是标题右上角 `...` 更多菜单；Webview 内容区不自绘额外的更多按钮或菜单。已开启的分组项在标题左侧显式显示 `✓`，作为 `view/title` popup 中稳定可见的 checked fallback。
- 分组开关可多选，包含“多根 root workspace 下按 root 分组”“按 provider 分组”“按分级时间分组”；root 分组默认开启，provider 与时间默认关闭。
- 多个分组开关同时开启时，层级固定为 root > provider > 时间，不按用户勾选顺序改变；时间分组固定为 `24小时内`、`一周内`、`更早`。
- 多根 workspace 下 root 分组按每条会话 cwd 所属的最深匹配 workspace folder 归属；单根 workspace 下即使 root 分组开关开启，也不额外增加 root 标题行。
- 会话历史分组标题行支持折叠/展开，折叠后隐藏该分组下的子分组和会话项；折叠只影响侧栏呈现，不改变会话排序、过滤结果、root/provider/time 归属或恢复 / 分叉行为。
- 会话项 tooltip 只展示 provider 历史已知的会话元信息，不展示当前画布节点标题或节点副标题。
- 会话项 tooltip 中的工作目录追加目录尾缀，并保留 cwd 来源分隔符；含反斜杠来源使用 `\`，slash-style 来源使用 `/`。
- 会话项右侧提供 `恢复` 与 `分叉` 两个 icon-only 操作按钮，图标必须使用 bundled VSCode Codicon（`history` / `repo-forked`），并提供 `aria-label` / `title` 等可访问名称；双击会话项、在选中项上按 Enter / Space 仍执行原有恢复行为。
- 双击会话项或点击 `恢复` 按钮可以在画板中新建节点恢复或打开该历史会话，并自动定位到新建节点的位置；恢复命令需沿用当前 provider 命令与默认启动参数，再附加目标会话的显式 resume 参数；resume 相关 argv 应尽量前置到命令前部；若默认启动参数里已含只影响 resume picker / `--last` 的选择阶段参数，则需先剥离这些参数，再写入显式 `session-id`。
- 点击 `分叉` 按钮可以在画板中新建同 provider Agent 节点并以 provider 原生 fork 语义启动；Codex 分叉命令使用 `fork <session-id>`，Claude Code 分叉命令使用 `--resume <session-id> --fork-session`，同样沿用并清理当前 provider 默认启动参数。
- UI 风格符合 VSCode 原生列表风格。

### 布局与视觉

- 两个区域使用 Dev Session Canvas sidebar 容器中的两个独立 view section：`节点` 与 `会话历史`。
- 整体视觉风格跟随 VSCode 原生列表组件，保持极简和一致性。
- 不引入额外的装饰线条、阴影或复杂层级。
- 颜色优先来自 `--vscode-*` token，跟随用户当前主题。
- `节点` 与 `会话历史` section 使用专属单色 view icon：主体延续 Dev Session Canvas 双节点 glyph，右上角 badge 分别表达节点列表与历史会话；其中历史会话 badge 参考 VS Code Codicon `history` 的时钟指针部分。该图标只用于对应 view section 在标题不可见或被用户拖到 Activity Bar 时的识别，不新增独立 Activity Bar 容器。

## 5. 不在范围内

- 在节点列表中显示节点的完整内容或详细元数据。
- 在节点列表中支持拖拽排序或重组节点层级关系。
- 在节点列表中直接编辑节点属性或内容。
- 在会话列表中显示会话的完整 transcript 或详细输出。
- 跨 workspace 的会话聚合或全局会话管理。
- 会话的导出、分享或云端同步功能。
- 在侧栏中复刻画布的可视化视图或关系图。
- 新增独立 Activity Bar 容器；节点列表与会话历史仍集成到现有侧栏容器内，只有 section 级专属 view icon。
- 在侧栏中复制选中节点正文、终端连续输出或完整 inspector；节点列表只作为导航入口与状态摘要存在。

## 6. 关键对象与状态

### 节点列表区域

- **节点项**：
  - 节点 ID（用于定位）
  - 节点类型（Agent、Terminal、Note 等）
  - 节点标题
  - 节点颜色图标形圆点标记
  - 节点第二行状态信息（`Agent` 为 `cwdLabel · provider · 状态`，其他节点为状态）
  - 通知图标（仅在该节点正处于 notification 提醒中时显示在最右侧）
- **过滤规则**：
  - 排除文件类型节点
- **排序与分组规则**：
  - 单根平铺展示中，attention 节点排在非 attention 节点前
  - 按分组树展示中，attention 节点进入顶部“待处理提醒”虚拟分组，同时保留原分组位置
  - 多根 workspace 平铺展示中，保留 workspace root 分组，并把“待处理提醒”虚拟分组放在所有 root 分组之前
- **交互行为**：
  - 点击跳转到画布中的节点位置
  - `节点` view 标题栏可以添加 workspace folder、新建 worktree 或添加已有 worktree
  - workspace folder 分组行可以通过前置图标区分普通 folder、repo 与 worktree，并可以基于该 folder 创建 worktree 或添加已有 worktree 到 workspace、移除 worktree 并从 workspace 移除对应 folder，或从 workspace 移除该 folder
- **同步机制**：
  - 监听画布节点变化事件
  - 实时更新列表内容

### 历史会话列表区域

- **会话项**：
  - 会话 ID
  - 会话类型（Codex / Claude Code）
  - provider 图标
  - 会话标题（会话中的第一条用户指令）
  - 相对时间
  - 创建时间
  - 最后修改时间
  - 恢复按钮
  - 分叉按钮
- **排序规则**：
  - 按时间倒序
  - 开启多个分组开关时，按 root > provider > 时间形成层级，层级内继续保持会话时间倒序
- **分组开关**：
  - root 分组：默认开启；仅在多根 workspace 下形成可见 root 分组
  - provider 分组：默认关闭；开启后按 Codex / Claude Code 分组
  - 时间分组：默认关闭；开启后按 `24小时内`、`一周内`、`更早` 分组
- **过滤规则**：
  - 只显示当前 workspace 下的会话
  - 支持关键词搜索
- **数据来源**：
  - Codex 和 Claude Code 分别独立存储
  - 具体读取接口在设计阶段确定
- **交互行为**：
  - 双击恢复历史会话为新 Agent 节点
  - 点击 `恢复` icon 按钮恢复历史会话为新 Agent 节点
  - 点击 `分叉` icon 按钮以 provider 原生 fork 语义创建新 Agent 节点
  - 点击分组标题行或在分组标题行按 Enter / Space 可折叠/展开该分组

### 侧栏容器

- **布局方式**：
  - 同一个 Dev Session Canvas sidebar 容器中的两个独立 view section
  - 可折叠/展开
- **视觉风格**：
  - 使用 VSCode 原生 TreeView 或 WebviewView
  - 跟随 VSCode 主题
  - 极简设计，无额外装饰

## 7. 验收标准

### 节点列表

- 用户可以在 VSCode 侧栏中看到节点列表区域。
- 节点列表显示当前画布上的所有非文件类型节点。
- 每个节点项显示：颜色图标形圆点标记、标题、第二行状态信息；其中 `Agent` 节点的第二行是 `cwdLabel · provider · 状态`，其他节点继续只显示状态；当节点正处于 notification 提醒中时，该项最右侧显示通知图标。
- 点击节点项后，画布视口自动定位到该节点位置，节点进入可见区域。
- 当画布上新增、删除或更新节点时，节点列表自动同步更新。
- 用户可以从 `节点` view 标题右上角的原生 `...` 菜单在默认的按分组树展示和平铺展示之间切换；切换入口出现在宿主 view title secondary menu 中，而不是 Webview 内容区。当前视图模式在菜单标题左侧显式显示 `✓`。
- 按分组树展示时，父子分组在侧栏中按树形缩进呈现；每个分组 section 和“未分组”section 都可折叠/展开，折叠后隐藏该 section 下的节点或子分组行；该行为只影响侧栏呈现，不改变画布分组状态。
- 单根平铺展示中，若存在 attention 节点，attention 节点显示在普通节点前。
- 按分组树展示中，若存在 attention 节点，列表顶部显示“待处理提醒”虚拟分组，并汇总所有 attention 节点；这些节点仍保留在原分组树位置。
- 多根 workspace 平铺展示中，列表保留 workspace root 分组；若存在 attention 节点，“待处理提醒”虚拟分组显示在所有 root 分组之前。
- `节点` view 标题栏显示添加 workspace folder 与 worktree 的按钮；点击添加 folder 后，所选文件夹会进入当前 VS Code workspace。
- 点击全局 worktree 入口时，单根 workspace 直接使用当前 folder；多根 workspace 先选择基准 folder；随后通过 VS Code 风格 QuickPick 选择添加已有 worktree，或创建新分支、从某个 ref 创建新分支、直接 checkout / detached checkout 已有 ref 并确认目标目录。
- 多根 workspace 的每个 workspace folder 分组行最前面显示 folder 类型图标，分别区分普通 folder、git repository 和 git worktree；行尾按新建 worktree、移除 worktree、移除 folder 的顺序显示 icon-only 操作；新建 worktree 使用专用 `worktree` Codicon；点击 workspace folder 行的 worktree 按钮直接基于该 folder 创建 worktree 或添加已有 worktree 并加入 workspace；点击移除 folder 只把该 folder 从当前 workspace 中移除；点击移除 worktree 会执行 `git worktree remove` 并从 workspace 移除该 folder。
- 节点列表的视觉风格符合 VSCode 原生列表组件，不引入额外装饰。
- 节点列表在浅色和深色主题下都能正常显示，颜色跟随主题。

### 历史会话列表

- 用户可以在同一侧栏视图中看到历史会话列表区域。
- 会话列表按时间倒序显示，最新会话在上。
- 只显示当前 workspace 下的 Codex 和 Claude Code 会话。
- 每条会话项按两行显示：首行是 provider 图标和标题，次行是相对时间。
- 会话标题取自该会话中的第一条用户指令，而不是当前画布中的节点标题。
- 每条会话项的第二行显示相对时间和 session id。
- 用户可以使用搜索框过滤会话列表，并支持匹配会话标题、provider、session id 与工作目录；不匹配节点副标题。
- 用户可以从 `会话历史` view 标题右上角的原生 `...` 菜单多选分组开关；root 分组默认开启，provider 和分级时间分组默认关闭；切换入口出现在宿主 view title secondary menu 中，而不是 Webview 内容区。已开启的分组菜单项使用独立 checked variant，并在标题左侧显式显示 `✓`；不开启的 variant 不显示 `✓`，以便用户区分多选开关状态。
- 多根 workspace 下 root 分组开启时，列表先按会话 cwd 所属 workspace root 分组；单根 workspace 下 root 分组不额外显示 root 标题行。
- 同时开启 root、provider 和时间分组时，列表层级固定为 root > provider > 时间；时间分组标题分别为 `24小时内`、`一周内`、`更早`；各分组内会话仍保持时间倒序。
- 会话历史的每个可见分组标题行都可折叠/展开；折叠状态只保存在当前 Webview 呈现层，搜索或分组设置变化后仅保留仍然存在的分组 key。
- 每个会话项右侧显示 `恢复` 与 `分叉` 两个 icon-only 操作按钮，按钮使用 VSCode Codicon 且具有可访问名称。
- 双击会话项，或在选中项上按 Enter / Space，可以恢复或打开该历史会话，既有双击行为不改变。
- 点击 `恢复` icon 按钮时，效果与双击会话项一致。
- 点击 `分叉` icon 按钮时，会创建同 provider 新 Agent 节点并以 provider 原生 fork 语义启动；Codex 命令包含 `fork <session-id>`，Claude Code 命令包含 `--resume <session-id> --fork-session`。
- 历史恢复 / 分叉新建出的节点会沿用当前 provider 命令与默认启动参数，再附加目标会话的显式 resume 或 fork 参数，而不是绕过默认启动参数设置；若默认参数里已含 `Codex --all` / `--include-non-interactive` 这类只服务于 picker / `--last` 的选择阶段参数，则历史恢复 / 分叉不会继续保留它们。
- 会话列表的视觉风格符合 VSCode 原生列表组件。
- 会话列表在浅色和深色主题下都能正常显示。

### 整体体验

- 两个区域在侧栏中独立显示，可以分别折叠/展开。
- 整体信息密度保持极简，不引入长段说明或教学卡片。
- 当侧栏不可见时，相关功能仍可通过命令入口访问。
- 在窄编辑器宽度下，侧栏内容仍能正常显示和交互。

## 8. 开放问题

- 节点列表的数据获取方式：是从前端画布状态直接读取，还是通过 Extension API 获取？具体方案在设计阶段讨论。
- 节点列表的更新机制：是通过事件监听实时更新，还是定期轮询？性能和实时性如何平衡？
- 历史会话的读取接口：Codex 和 Claude Code 的会话数据存储格式和读取方式是什么？
- 会话列表的恢复 / 分叉行为已选定为新建 Agent 节点；后续仍可补充节点摆放、批量管理或冲突提示的细节。
- 侧栏容器的具体集成位置：是新增独立的侧栏视图，还是集成到现有的某个侧栏视图中？
- 节点列表是否需要支持多选或批量操作？
- 会话列表是否需要支持删除、重命名等管理操作？

## 9. 当前验证状态

- 2026-06-25：`节点` section 的 worktree 流程新增 `Add existing worktree to workspace...` 分支，Host 通过 `git worktree list --porcelain` 列出当前 repository 已有 worktree，过滤已在当前 workspace 中、prunable、bare 或磁盘目录不可用的条目；选择后仅调用 VS Code workspace folder API 加入目录，不执行 `git worktree add`。已补 `npm run test:git-worktrees` 覆盖 porcelain 解析、分支入口和添加已有路径，并复跑 `npm run typecheck`、`npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-codicon-bundle` 与 `git diff --check`。
