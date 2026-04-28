# 侧栏节点列表与会话历史实现

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划已完成，归档于 `docs/exec-plans/completed/canvas-sidebar-node-and-session-lists.md`；其执行过程与结果仍按 `docs/PLANS.md` 的要求保留可追溯记录。

## 目标与全局图景

本轮要把 `docs/product-specs/canvas-sidebar-node-and-session-lists.md` 落成可用实现：用户在 VS Code 侧栏里除了现有的 `概览` 与 `常用操作` 外，还能看到一份当前画布节点列表，以及一份当前 workspace 的 Agent 历史会话列表。点击节点项时，画布会自动定位到对应节点；双击历史会话时，画布会新建一个 `Agent` 节点，并用 provider 自带的 resume 命令直接恢复该会话。

完成后，用户应能亲眼验证三件事：

1. 打开侧栏后能看到 `节点` 与 `会话历史` 两个新 section。
2. 点击 `节点` 列表中的任一非文件节点，画布会滚动并聚焦到该节点。
3. 在 `会话历史` 中搜索并双击某条 `Codex` / `Claude Code` 会话后，画布会新建一个聚焦节点，并自动启动对应的恢复命令。

## 进度

- [x] (2026-04-28 07:54 +08:00) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md`、当前产品规格与现有侧栏/恢复代码，确认本任务属于需要 `ExecPlan` 的交付性工作。
- [x] (2026-04-28 08:10 +08:00) 补齐正式文档：新增侧栏节点/会话列表设计文档，并更新设计索引。
- [x] (2026-04-28 08:45 +08:00) 实现侧栏节点列表：从 `CanvasPanelManager` 权威状态派生非文件节点清单，接入原生 `TreeView`，支持点击定位与命令入口回退。
- [x] (2026-04-28 08:55 +08:00) 实现侧栏会话历史：扫描当前 workspace 的 `Codex` / `Claude Code` 会话记录，接入带搜索框的最小 `WebviewView`，并补刷新与命令入口回退。
- [x] (2026-04-28 09:00 +08:00) 打通“从历史恢复为新节点”的宿主链路：创建新 `Agent` 节点、注入 provider resume 命令、打开画布并定位到新节点。
- [x] (2026-04-28 11:19 +08:00) 补自动化验证与结果记录，覆盖会话历史扫描/过滤、节点列表聚焦，以及从历史记录恢复为新 `Agent` 节点的 smoke 集成行为。

## 意外与发现

- 观察：当前 sidebar 已经是“原生 `TreeView` + 最小 `WebviewView`”的混合架构，其中 `概览` 使用 `TreeView`，`常用操作` 使用 `WebviewView`。
  证据：`src/sidebar/CanvasSidebarView.ts`、`src/sidebar/CanvasSidebarActionsView.ts`、`package.json` 现有 `views` 注册。

- 观察：画布已经具备宿主向 Webview 下发 `host/focusNode` 消息并在前端滚动聚焦节点的能力，但目前只在执行节点注意力提醒链路里调用。
  证据：`src/common/protocol.ts` 中 `host/focusNode`，以及 `src/panel/CanvasPanelManager.ts` 的 `focusExecutionAttentionNode`。

- 观察：当前仓库已经具备两条 provider session identity 读取基础：`Codex` 可从 `~/.codex/sessions/.../rollout-*.jsonl` 的 `session_meta` 读取 `cwd` 与 `sessionId`；`Claude Code` 可通过 `~/.claude/projects/.../<session-id>.jsonl` 文件确认 `sessionId`。
  证据：`src/common/codexSessionIdLocator.ts` 与现有 smoke fixture/测试辅助写入逻辑。

- 观察：新增的 smoke 用例首轮失败并不是实现链路问题，而是测试文件缺少 `writeCodexSessionFile(...)` helper，导致 `verifySidebarSessionHistoryRestore()` 在写 fixture 前直接抛 `ReferenceError`。
  证据：`npm run test:smoke` 首轮失败日志中的 `ReferenceError: writeCodexSessionFile is not defined`；补 helper 后同一 smoke 命令通过。

## 决策记录

- 决策：节点列表继续使用 VS Code 原生 `TreeView`，而不是再做一个自绘 Webview section。
  理由：节点列表不需要内嵌输入框，原生树视图更符合现有 sidebar 的宿主风格，也能直接复用树项点击命令完成节点定位。
  日期/作者：2026-04-28 / Codex

- 决策：会话历史使用最小 `WebviewView`，而不是原生 `TreeView`。
  理由：产品规格要求在同一区域内直接提供搜索框与双击恢复；当前 VS Code 扩展 API 没有给扩展自定义 `TreeView` 暴露同等级的内嵌搜索输入能力，因此用最小 `WebviewView` 承载搜索框和原生风格列表是最小妥协。
  日期/作者：2026-04-28 / Codex

- 决策：会话历史只显示当前 workspace 相关记录，并按 provider 文件中能确认到的 `cwd` / 目录归属过滤，而不是聚合整个用户 home 的所有 session。
  理由：产品规格明确限定“当前 workspace”；同时避免把无关 repo 的历史噪声带进侧栏。
  日期/作者：2026-04-28 / Codex

- 决策：从历史恢复时不复用当前节点，而是新建一个 `Agent` 节点，并把 provider resume 命令写成该节点的自定义启动命令。
  理由：产品规格要求“双击会话项可以在画板中新建节点恢复或打开该历史会话”；直接把 resume 命令固化到新节点 metadata 中，也能保持后续持久化与恢复链路一致。
  日期/作者：2026-04-28 / Codex

## 结果与复盘

本轮已按产品规格落地四块能力：`节点` 原生 TreeView、`会话历史` 最小 WebviewView、命令面板 QuickPick 回退入口，以及“从历史恢复为新 Agent 节点”的宿主链路。用户现在既可以在侧栏内浏览和聚焦当前非文件节点，也可以直接从当前 workspace 的 Codex / Claude Code 历史记录恢复新节点。

自动化验证已经闭环：`node scripts/test-sidebar-session-history.mjs` 证明 session 扫描、workspace 过滤、去重与排序成立；`npm run test:smoke` 证明新增命令注册、节点聚焦消息与历史恢复主路径在真实 VS Code 宿主里成立。实现阶段暴露出的唯一额外问题是 smoke fixture helper 缺失，已在同轮修复。

本轮仍保留一条明确技术债：会话历史依赖 provider 私有 session 落地文件格式；如果后续 provider 提供正式 history/session API，应优先迁移。该问题已登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 上下文与定向

本仓库的 sidebar 入口位于 `src/extension.ts`。当前已经注册了两个视图：

- `devSessionCanvas.sidebar`：`概览`，由 `src/sidebar/CanvasSidebarView.ts` 提供原生 `TreeView`。
- `devSessionCanvas.sidebarFilters`：`常用操作`，由 `src/sidebar/CanvasSidebarActionsView.ts` 提供最小 `WebviewView`。

画布权威状态由 `src/panel/CanvasPanelManager.ts` 持有。所有节点都存在 `CanvasPrototypeState.nodes` 中，节点的共享结构定义在 `src/common/protocol.ts` 的 `CanvasNodeSummary`。其中 `kind` 当前可能为 `agent`、`terminal`、`note`、`file`、`file-list`；本任务的节点列表必须排除 `file` 与 `file-list`。

现有 Webview 已支持宿主消息 `host/focusNode`：宿主只要向当前承载面发送带 `nodeId` 的消息，前端就会把对应节点滚入可见区域并选中。因此，本任务的“点击节点定位”应以 `CanvasPanelManager` 为权威入口，在宿主侧统一完成“打开/定位画布 + 等待 Webview ready + 下发 `host/focusNode`”。

当前 provider 历史会话没有专门的统一索引。仓库里已有的 session identity 相关代码都在 `src/common/codexSessionIdLocator.ts`：

- `Codex`：通过扫描 `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl` 的首行 `session_meta` 来拿到 `sessionId`、`cwd`、时间戳。
- `Claude Code`：通过 `~/.claude/projects/<project-dir>/<session-id>.jsonl` 是否存在来确认 `sessionId`；测试夹具里也把 `cwd` 写进首行 JSON。

这意味着本轮实现不需要重新发明 provider session store，只需要把“定位 session id”的单点逻辑扩展为“列出当前 workspace 的 session 记录”。

## 工作计划

先补文档，再动代码。正式文档层需要新增一份侧栏节点/会话列表设计文档，说明为什么节点列表使用 `TreeView`、会话历史使用 `WebviewView`，以及 provider 历史数据从哪里读、如何保证当前 workspace 过滤。文档同步后，再开始代码落地。

代码上分三块推进。第一块是节点列表：新增一个 sidebar tree provider，把 `CanvasPanelManager` 当前状态中的非文件节点映射成侧栏项，提供类型图标、标题、状态和截断副标题；同时在宿主侧补一个通用“定位指定节点”命令，并提供一个 QuickPick 命令作为 sidebar 不可见时的回退入口。第二块是会话历史：新增一个最小的 `WebviewView`，上方只有搜索框，下方只有列表；宿主侧负责扫描 provider session 文件、生成当前 workspace 的 session snapshot，并在视图 ready、手工刷新或画布会话状态变化后推送给 Webview。第三块是恢复链路：新增一个宿主入口，把某条历史记录转换成 provider resume 命令，创建新的 `Agent` 节点、打开画布，并在节点创建后自动聚焦到它。

验证上拆成两层。纯逻辑层新增独立脚本测试 provider session history 扫描、去重、排序和 workspace 过滤；宿主集成层在现有 smoke 测试里补充最小覆盖，验证节点列表条目生成、节点定位消息，以及历史会话恢复命令确实能生成新的 `Agent` 节点并带上正确的 resume 命令。

## 具体步骤

在仓库根目录执行下列步骤，并随着推进更新本节：

1. 新增 `docs/design-docs/canvas-sidebar-node-and-session-lists.md`，并同步 `docs/design-docs/index.md`。
2. 在 `src/common/` 或 `src/sidebar/` 中补会话历史扫描与展示快照构造逻辑。
3. 在 `src/panel/CanvasPanelManager.ts` 中补通用节点聚焦入口和“从历史创建 Agent 恢复节点”的宿主方法。
4. 在 `src/sidebar/` 中新增节点列表 view 与会话历史 view，并在 `src/extension.ts` / `package.json` 注册新视图和命令。
5. 在 `tests/` 或 `scripts/` 中补自动化验证，并运行：

    npm run typecheck
    node scripts/test-sidebar-session-history.mjs
    npm run test:smoke

本轮已实际执行全部三条命令；`npm run test:smoke` 首轮因测试 helper 缺失失败，补齐 helper 后重新通过。

## 验证与验收

验收以用户可观察行为为准：

- 打开侧栏后，能看到新增的 `节点` 与 `会话历史` section。
- `节点` section 中只包含 `agent`、`terminal`、`note`；点击任一项后，画布会自动定位到对应节点。
- `会话历史` section 中只显示当前 workspace 的 `Codex` / `Claude Code` 历史会话，默认按最近更新时间倒序。
- 在 `会话历史` 搜索框里输入关键词后，列表会即时过滤。
- 双击某条会话后，画布中会出现一个新的 `Agent` 节点，并以对应 provider 的 resume 命令进入自动启动流程。
- 侧栏不可见时，命令面板仍可通过“显示节点列表”“显示会话历史”两条命令到达相同能力。

自动化验收最少包括：

- `node scripts/test-sidebar-session-history.mjs` 通过，证明 provider session 扫描、workspace 过滤与排序逻辑成立。
- `npm run typecheck` 通过。
- 若环境允许，`npm run test:smoke` 通过，至少覆盖新增宿主命令和侧栏数据快照。

## 幂等性与恢复

文档改动与代码改动都应保持可重复执行。provider session history 的读取必须是只读扫描，不得修改 `~/.codex`、`~/.claude` 或 workspace 状态。若中途发现 provider session 文件格式与当前假设不一致，应记录到 `意外与发现`，并让实现回退为“只显示能确定识别的记录”，而不是冒险猜测或写入任何修复文件。

如果测试过程中需要写临时 session fixture，应只写入 `os.tmpdir()` 下的测试目录，并在脚本结束时删除。

## 证据与备注

关键验证证据如下：

    $ npm run typecheck
    > exit 0

    $ node scripts/test-sidebar-session-history.mjs
    > exit 0

    $ npm run test:smoke
    > VS Code smoke test passed.
    > Remote SSH real window reopen smoke passed.

关键实现落点如下：

    src/common/agentSessionHistory.ts
    src/sidebar/CanvasSidebarNodeListView.ts
    src/sidebar/CanvasSidebarSessionHistoryView.ts
    src/panel/CanvasPanelManager.ts
    src/extension.ts
    tests/vscode-smoke/extension-tests.cjs

## 接口与依赖

本轮必须新增或扩展的接口如下：

- 在 `src/panel/CanvasPanelManager.ts` 中提供通用节点聚焦入口，以及“从历史会话创建恢复节点”的宿主入口。
- 在 `src/sidebar/` 中新增：
  - 一个原生 `TreeDataProvider`，负责节点列表。
  - 一个最小 `WebviewViewProvider`，负责会话历史搜索与列表。
- 在 `src/common/` 中新增 provider 历史会话扫描逻辑，输出稳定的 session snapshot，至少包含：
  - provider
  - sessionId
  - cwd
  - createdAt
  - updatedAt
- 在 `src/extension.ts` / `package.json` 中新增命令与视图注册，至少包含：
  - 显示节点列表（QuickPick 回退）
  - 显示会话历史（QuickPick 回退）
  - 刷新会话历史

更新记录：2026-04-28 创建本计划，记录当前已确认上下文、实现分块和初始设计决策，用于承接 `canvas-sidebar-node-and-session-lists` 的正式实现。
更新记录：2026-04-28 完成实现、补齐 smoke fixture helper、通过 `typecheck + session history script + VS Code smoke`，并将计划移入 `completed/` 归档。
