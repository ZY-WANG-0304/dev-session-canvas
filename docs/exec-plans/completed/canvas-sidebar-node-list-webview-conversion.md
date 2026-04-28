# 侧栏节点列表 Webview 化

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循仓库根目录下的 `docs/PLANS.md`。当前任务是在既有“侧栏节点列表与会话历史”能力上继续收口节点列表承载面，因此本计划必须和现有产品规格、设计文档及已落地代码一起维护，直到实现、验证与文档状态一致为止。

## 目标与全局图景

把 `Dev Session Canvas` 侧栏中的“节点” section 从原生 `TreeView` 改为最小 `WebviewView`。用户仍然看到极简、接近 VS Code 原生列表的节点概览，但这次要获得两个新的正式能力：左侧节点标记改成运行时配色的图标形状，右侧提醒位改成与画布节点一致的 bell 通知图标；点击节点行后，仍能立即定位到画布中的对应节点。

完成后，用户应能亲眼验证三件事：

1. `节点` section 仍然显示当前画布上的非文件节点，首行是彩色节点标记和节点标题，第二行只显示状态。
2. 某个节点处于 notification 提醒中时，该节点行最右侧显示与画布节点一致的 bell 图标，而不是 `!` badge。
3. 在侧栏中点击节点项后，画布仍会打开并聚焦到对应节点；相关 UI 回归测试能在真实 VS Code 宿主里稳定通过。

## 进度

- [x] (2026-04-28 16:05 +08:00) 重新阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、当前产品规格、设计文档与现有 `TreeView` / `WebviewView` 实现，确认本次节点列表承载面切换属于需要单独 `ExecPlan` 的显著 UI 重构。
- [x] (2026-04-28 16:08 +08:00) 更新正式文档：把产品规格与设计文档中的节点列表承载面从 `TreeView + FileDecoration` 改成最小 `WebviewView + bell icon`，并登记本计划。
- [x] (2026-04-28 16:15 +08:00) 实现新的 `CanvasSidebarNodeListView`：改为 `WebviewViewProvider`，保留点击定位、QuickPick 回退和测试快照导出。
- [x] (2026-04-28 16:20 +08:00) 补充节点列表专门 UI 回归测试，并运行 `npm run typecheck`、`npm run build`、`node scripts/test-sidebar-session-history.mjs`、相关 VS Code smoke 进行验证。
- [x] (2026-04-28 16:20 +08:00) 收口结果：同步计划、设计文档验证状态，并确认本轮没有新增需要登记到 `docs/exec-plans/tech-debt-tracker.md` 的技术债。

## 意外与发现

- 观察：现有节点列表实现虽然已经满足“状态-only 次级描述”，但右侧提醒位只能借 `FileDecoration.badge` 输出字符串，因此此前只能退化为 `!`，无法稳定复用画布节点上的 bell 图标。
  证据：`src/sidebar/CanvasSidebarNodeListView.ts` 当前使用 `resourceUri + FileDecorationProvider`，且 `vscode.d.ts` 中 `FileDecoration` 只有 `badge/tooltip/color` 三个公开字段。

- 观察：仓库已经有一个成熟的最小 `WebviewView` 参考实现，即 `src/sidebar/CanvasSidebarSessionHistoryView.ts`，其中包含 ready 握手、测试动作桥接、紧凑列表样式和双击 UI 回归基础设施。
  证据：`CanvasSidebarSessionHistoryView` 已实现 `waitForReady()`、`performTestAction()` 和 smoke 用到的 `performSidebarSessionHistoryAction` 测试命令。

- 观察：侧栏节点列表直接引用 `@vscode/codicons` 的本地 CSS / TTF 资源可行，真实 VS Code smoke 中也能成功加载字体资源，因此不需要再为 `circle-filled` / `bell` 复制一份自定义 SVG 资产。
  证据：`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 日志包含 `Webview.loadLocalResource ... node_modules/@vscode/codicons/dist/codicon.css` 与 `codicon.ttf` 的成功加载记录。

## 决策记录

- 决策：本轮把节点列表也切到最小 `WebviewView`，而不是继续留在 `TreeView` 上做局部补丁。
  理由：用户最新要求明确优先“可扩展性更好”；同时 bell 提醒图标和运行时配色图标形状都更适合在自绘列表中稳定表达，不再受 `TreeItem` / `FileDecoration` stable API 的限制。
  日期/作者：2026-04-28 / Codex

- 决策：节点列表仍保留“原生侧栏列表感”，而不是借 Webview 增加卡片、统计块或复杂交互。
  理由：产品目标仍是一个极简概览入口；承载面改变是为了图标与扩展性，不是为了把侧栏变成 mini dashboard。
  日期/作者：2026-04-28 / Codex

## 结果与复盘

本轮已完成节点列表承载面切换：`devSessionCanvas.sidebarNodes` 现在是最小 `WebviewView`，左侧使用运行时配色的 `circle-filled`，右侧提醒位使用与画布节点一致的 `bell`，并保留了 QuickPick 回退与 `focusSidebarNode` 宿主入口。`src/sidebar/CanvasSidebarNodeListView.ts` 同时补上了 ready 握手、测试动作桥接和 smoke 可见的快照导出，因此节点列表也具备了和会话历史相同级别的真实宿主 UI 回归能力。

验证层已闭环：`npm run typecheck`、`npm run build`、`node scripts/test-sidebar-session-history.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 全部通过，新增的节点列表 UI 回归会在真实 VS Code 侧栏里点击节点行，并断言选中态、提醒图标态和 `host/focusNode` 宿主消息都成立。

本轮没有新增技术债。既有“会话历史仍依赖 provider 私有 session 文件格式”的技术债不受本次节点列表 Webview 化影响，因此继续沿用已有登记即可。

## 上下文与定向

当前侧栏相关入口位于 `src/extension.ts`。现有注册关系是：

- `devSessionCanvas.sidebar`：侧栏概览，原生 `TreeView`，代码在 `src/sidebar/CanvasSidebarView.ts`。
- `devSessionCanvas.sidebarFilters`：常用操作，最小 `WebviewView`，代码在 `src/sidebar/CanvasSidebarActionsView.ts`。
- `devSessionCanvas.sidebarNodes`：当前节点列表，仍是原生 `TreeView`，代码在 `src/sidebar/CanvasSidebarNodeListView.ts`。
- `devSessionCanvas.sidebarSessions`：会话历史，最小 `WebviewView`，代码在 `src/sidebar/CanvasSidebarSessionHistoryView.ts`。

节点列表的权威数据仍然来自 `CanvasPanelManager.getCanvasNodes()`，共享节点结构定义在 `src/common/protocol.ts` 的 `CanvasNodeSummary`。本次切换承载面时，不应改变数据边界：仍只投影 `agent`、`terminal`、`note`，仍要保留 `COMMAND_IDS.focusSidebarNode` 和命令面板 QuickPick 回退入口。

当前实现的主要限制在于宿主 API：`TreeItem.iconPath` 可以显示左侧图标，但右侧尾部提醒位只能靠 `FileDecorationProvider` 输出字符串 badge。产品已经明确希望右侧展示真正的通知图标，且最好与画布节点一致，因此最小 `WebviewView` 是当前仓库中最直接、风险最低的正式承载面。

## 工作计划

先更新文档，再替换实现。文档层需要同步两件事：产品规格不再把节点列表描述成 `treeview` 风格；设计文档的正式方案也要从“节点 `TreeView` + 会话历史 `WebviewView`”升级为“两块都是最小 `WebviewView`，但视觉仍收口为原生列表”。完成文档后，再开始代码替换。

代码实现分三部分。第一部分是把 `src/sidebar/CanvasSidebarNodeListView.ts` 改造成 `WebviewViewProvider`：保留当前节点 snapshot 构造函数 `getCanvasSidebarNodeListItems(...)`，但新增 ready/state 消息协议、最小 HTML/CSS、节点点击转发以及 smoke 所需的测试动作桥接。第二部分是 `src/extension.ts` 与 `package.json` 的宿主接线：`sidebarNodes` 视图改成 `type: webview`，移除 `FileDecorationProvider` 注册，新增节点列表 Webview 的 test command。第三部分是回归验证：在 `tests/vscode-smoke/extension-tests.cjs` 中增加一个专门的侧栏节点列表 UI 用例，验证点击聚焦与 bell 提醒图标可见性；同时保留现有逻辑级断言，确保摘要 sanitization、状态-only 描述和 QuickPick 回退不被破坏。

## 具体步骤

在仓库根目录执行以下步骤，并在推进中持续修订本节：

1. 更新 `docs/product-specs/canvas-sidebar-node-and-session-lists.md` 与 `docs/design-docs/canvas-sidebar-node-and-session-lists.md`，把节点列表承载面改写成最小 `WebviewView`，并记录 bell icon 的正式口径。
2. 修改 `src/sidebar/CanvasSidebarNodeListView.ts`：移除 `TreeItem` / `FileDecorationProvider` 路径，新增 Webview 握手、HTML、节点点击和测试动作。
3. 修改 `src/extension.ts`、`src/common/extensionIdentity.ts`、`package.json` 与 smoke 测试入口，接入新的 Webview provider 和测试命令。
4. 在 `tests/vscode-smoke/extension-tests.cjs` 中增加节点列表 UI 回归，并运行：

    npm run typecheck
    npm run build
    node scripts/test-sidebar-session-history.mjs
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs

## 验证与验收

验收以用户可观察行为为准：

- `节点` section 仍然只显示当前画布上的非文件节点。
- 每条节点项的首行左侧是运行时配色的圆形图标，正文是节点标题；第二行只显示状态。
- 某条节点处于提醒中时，右侧尾部显示 bell 图标；非提醒节点不显示该图标。
- 点击节点项后，画布能打开并聚焦到对应节点。
- 会话历史的既有搜索、双击恢复与 UI 回归不受影响。

自动化验证最少包括：

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `node scripts/test-sidebar-session-history.mjs` 继续通过，证明本轮没有破坏会话历史逻辑。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过，并包含新的节点列表 UI 回归断言。

## 幂等性与恢复

本轮改动不应改变任何 provider session 落地文件、workspace 内容或持久化协议；节点列表 Webview 只是现有节点状态的另一种投影。实现时应尽量复用既有 `getCanvasSidebarNodeListItems(...)`，确保 QuickPick 回退、测试命令和 Webview 列表读取同一份 snapshot 构造逻辑，避免产生两套不一致格式。

如果 Webview 资源（例如 codicon 字体或 CSS）在某些宿主环境中无法加载，实现必须保留安全退化：列表文本、状态和点击定位仍然可用，最多只有图标退化为空白，而不是让整个视图失效。

## 证据与备注

关键验证证据如下：

    $ npm run typecheck
    > exit 0

    $ npm run build
    > exit 0

    $ node scripts/test-sidebar-session-history.mjs
    > exit 0

    $ DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs
    > Trusted workspace smoke passed.
    > VS Code smoke test passed.

关键实现落点如下：

    docs/product-specs/canvas-sidebar-node-and-session-lists.md
    docs/design-docs/canvas-sidebar-node-and-session-lists.md
    src/sidebar/CanvasSidebarNodeListView.ts
    src/common/extensionIdentity.ts
    src/extension.ts
    tests/vscode-smoke/extension-tests.cjs

## 接口与依赖

本轮必须新增或调整的接口如下：

- `src/sidebar/CanvasSidebarNodeListView.ts`
  - 继续导出 `getCanvasSidebarNodeListItems(nodes)`。
  - 新增节点列表 Webview 的 ready/state 消息协议。
  - 新增 `waitForReady()`、`performTestAction()` 和测试动作类型守卫，供 smoke 调用。
- `src/common/extensionIdentity.ts`
  - 新增节点列表 Webview 的测试命令 ID。
- `src/extension.ts`
  - 把 `sidebarNodes` 从 `registerTreeDataProvider` 改成 `registerWebviewViewProvider`。
  - 删除已废弃的节点 `FileDecorationProvider` 注册。
  - 暴露节点列表 Webview 测试命令。
- `package.json`
  - 把 `devSessionCanvas.sidebarNodes` 视图声明改为 `type: webview`。
- `tests/vscode-smoke/extension-tests.cjs`
  - 新增节点列表 UI 回归，覆盖节点点击与 bell 图标呈现。

更新记录：2026-04-28 创建本计划，记录节点列表从 `TreeView` 切到最小 `WebviewView` 的原因、影响面与验证路径。
更新记录：2026-04-28 完成节点列表 Webview 化、补节点列表专门 UI 回归，并通过 `typecheck + build + session history script + trusted smoke` 验证。
