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
updated_at: 2026-04-28
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
- 让“从历史恢复为一个新节点”成为稳定的一跳操作，而不是要求用户手工拼 resume 命令。
- 保持整个 sidebar 仍然像 VS Code 原生 view section，而不是长成新的 mini dashboard。

## 4. 非目标

- 不在本轮显示完整 transcript、完整终端输出或 provider 私有元数据。
- 不在本轮支持会话删除、重命名、归档或跨 workspace 聚合。
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
- 它使用最小 `WebviewView`，数据直接来自 `CanvasPanelManager` 的权威 `CanvasPrototypeState.nodes`。
- 宿主接线落在 `src/sidebar/CanvasSidebarNodeListView.ts` 与 `src/extension.ts`：前者负责把 `CanvasNodeSummary` 投影成节点列表快照并渲染最小 Webview，后者负责注册 `devSessionCanvas.sidebarNodes` view 与命令入口。
- 只投影 `agent`、`terminal`、`note` 三类节点；`file` 与 `file-list` 不进入此列表。
- 每个节点项显示：
  - 节点对应颜色的图标形圆点标记
  - 节点标题
  - 人类可读的状态文案，作为唯一的次级描述
  - 当节点正处于 notification 提醒中时，在该项最右侧显示通知图标
- 节点列表的图标与提醒都直接使用 Webview 内的 codicon 资源：左侧是带运行时颜色的 `circle-filled`，右侧提醒位是与画布节点一致的 `bell`。
- 视觉上继续收口为 VS Code 原生 sidebar 列表质感：无卡片、无阴影、无多层装饰，只保留轻量 hover / selected 态和紧凑两行排版。
- 点击节点项后，宿主会统一执行“打开/定位画布 -> 等待 Webview ready -> 下发 `host/focusNode`”，把节点滚入可见区域并选中。

### 6.2 会话历史使用最小 `WebviewView`

- 在同一 sidebar container 中新增一个 `会话历史` section。
- 它使用最小 `WebviewView`，原因不是要做更复杂 UI，而是必须在同一区域内提供搜索框与双击恢复能力。
- 具体承载文件是 `src/sidebar/CanvasSidebarSessionHistoryView.ts`；宿主只向 Webview 提供搜索前的 snapshot，搜索输入与双击行为都在这个最小视图内部完成。
- 视图结构只保留两层：
  - 顶部一个搜索框
  - 下方一列结果列表
- 结果项保持 VS Code 原生 list 风格：无卡片、无阴影、无多层装饰，只用主题 token、轻量 hover/selected 态和紧凑行距。
- 每条结果项采用两行紧凑结构：首行显示 provider 图标和“会话中的第一条用户指令”标题，次行显示“相对更新时间 + sessionId”；工作目录和绝对时间收口到 tooltip。
- 搜索文本覆盖会话标题、provider、sessionId 与工作目录等信息；仍不匹配当前画布节点副标题。
- tooltip 只展示 provider 历史已知的会话元信息，不再注入当前画布节点标题或副标题。

### 6.3 会话历史的数据来源是 provider 当前的 session 落地文件

当前选定以下读取路径：

- `Codex`：扫描 `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`，读取首行 `session_meta` 中的 `sessionId`、`cwd` 与时间戳。
- `Claude Code`：扫描 `~/.claude/projects/**/*.jsonl`。若文件首行 JSON 带有 `cwd`，则用它判断是否属于当前 workspace；若缺少 `cwd`，则至少保留“当前 workspace 根目录对应的 project 目录”这条精确回退路径。

对应实现集中在 `src/common/agentSessionHistory.ts`，并通过 `scripts/test-sidebar-session-history.mjs` 覆盖 workspace 过滤、去重、排序、Claude 根目录回退，以及“跳过 provider 注入的 synthetic 首条 user message，提取第一条真实用户指令”。

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

### 6.5 从历史恢复时，新建一个 `Agent` 节点并写入 provider resume 命令

- 双击会话历史项后，不修改当前节点，也不要求用户二次确认。
- 宿主会直接新建一个 `Agent` 节点，并把它的自定义启动命令写成：
  - `codex resume <session-id>`
  - `claude --resume <session-id>`
- 新节点创建后，宿主会自动打开或定位画布，并聚焦到新节点。
- 后续自动启动仍沿用现有 `Agent` 节点“等待尺寸就绪后自动启动”的宿主/前端链路，不再另开一套特殊恢复流程。

这条链路收口在 `src/panel/CanvasPanelManager.ts` 的 `restoreAgentSessionFromHistory(...)`、`focusNodeById(...)` 和 `buildHistoryResumeCommandLine(...)`，并由 `src/extension.ts` 暴露给 sidebar 内部命令与 QuickPick 回退入口。

### 6.6 侧栏不可见时，仍保留命令入口

为了满足规格里的“侧栏不可见时仍可通过命令入口访问”，当前再补两条命令：

- `显示节点列表`：用 QuickPick 临时展示当前非文件节点，选择后定位到画布节点。
- `显示会话历史`：用 QuickPick 临时展示当前 workspace 会话记录，选择后恢复为新节点。

它们不是新的主交互面，而是 sidebar 被折叠、移动或暂时不可见时的回退入口。

## 7. 风险与取舍

- 风险：`Codex` / `Claude Code` 的 session 文件格式不是本扩展控制的正式接口。
  当前缓解：读取逻辑只做只读扫描，并在无法确认 `cwd` 或 `sessionId` 时 fail closed，不把猜测结果显示为当前 workspace 记录。

- 风险：`Claude Code` 某些 transcript 文件可能没有稳定的 `cwd` 字段。
  当前缓解：优先读取首行 JSON 里的 `cwd`；若没有，则至少支持“当前 workspace 根目录对应 project 目录”的精确路径，不把模糊目录猜测写成已确认行为。

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
3. 会话历史中只出现当前 workspace 的 `Codex` / `Claude Code` 记录，默认按最近更新时间倒序。
4. 搜索框输入关键词后，列表会即时过滤。
5. 双击一条会话后，会新建一个 `Agent` 节点，并带着正确的 provider resume 命令进入自动启动链路。
6. 折叠或离开 sidebar 时，命令面板仍可通过“显示节点列表”“显示会话历史”到达相同能力。

## 9. 当前验证状态

- 2026-04-28 已完成上一版节点列表与会话历史实现，并通过 `node scripts/test-sidebar-session-history.mjs` 与 `npm run test:smoke`，证明 provider session 扫描、workspace 过滤、节点聚焦与历史恢复主路径成立。
- 2026-04-28 产品规格新增两条节点列表要求：次级描述只显示状态，不再显示副标题；当节点正处于 notification 提醒中时，该项最右侧显示通知图标。
- 2026-04-28 已按新规格更新实现：节点列表次级描述收口为“仅状态”，并先用 `resourceUri + FileDecorationProvider` 输出提醒徽标闭合主路径；这一版已经通过 `npm run typecheck`、`npm run build`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 与 `node scripts/test-sidebar-session-history.mjs`。
- 2026-04-28 会话历史列表已按最新视觉要求改成“两行原生列表”样式：首行显示 provider 图标和标题，次行显示相对更新时间；详情信息继续留在 tooltip 和搜索文本中；并已通过 `npm run typecheck`、`npm run build`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 与 `node scripts/test-sidebar-session-history.mjs`。
- 2026-04-28 会话历史列表已进一步按最新规格收口：标题改为 provider 历史中的第一条真实用户指令，第二行改为“相对时间 + sessionId”，tooltip 移除画布节点标题/副标题；后续再补搜索体验时，搜索范围调整为“匹配会话标题 + provider / sessionId / 工作目录”，不再沿用“不匹配标题”的旧口径。
- 2026-04-28 节点列表已切换到最小 `WebviewView`：左侧使用运行时配色的 `circle-filled` 图标，右侧提醒位改成与画布节点一致的 `bell`，并补专门 UI 回归覆盖点击聚焦与提醒图标呈现；已通过 `npm run typecheck`、`npm run build`、`node scripts/test-sidebar-session-history.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`。
- 当前仍保持 `验证中`：节点列表 Webview 化主路径已经通过自动化验证，但整份设计仍包含“会话历史依赖 provider 私有 session 文件格式”这条已登记技术债，因此暂不把整体文档改成 `已验证`。
