# 删除 Task 节点并收口主题跟随的辅助对象表面

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划原始路径是 `docs/exec-plans/active/remove-task-node-and-align-note-surface.md`，完成后已移至 `docs/exec-plans/completed/remove-task-node-and-align-note-surface.md`；文档内容仍按 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

这次变更要同时解决两个已经明确的产品问题。第一，当前 UI 风格不能被定义为“深色画布”，而应收口为跟随 VSCode 主题的极简协作画布。第二，`Task` 与 `Note` 目前没有稳定功能分工，继续同时保留只会增加对象模型和视觉噪音，因此当前范围直接删除 `Task`。

变更完成后，用户应能直接看到：创建入口只剩 `Agent`、`Terminal`、`Note` 三类；旧的 `Task` 不再出现在画布或侧栏；`Note` 节点与画布背景继续收口到主题跟随、低层级噪音的窗口表面，而不是内部有大面积语义色块的卡片组合。用户在画布中创建 `Note`、reload 画布，并切换 VSCode 深浅主题，就能直接验证结果。

## 进度

- [x] (2026-04-07 22:11 +0800) 读取 `AGENTS.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/FRONTEND.md` 与现有设计文档，确认本轮属于需要正式 `ExecPlan` 的交付性 UI / 对象模型收口。
- [x] (2026-04-07 22:11 +0800) 从 `main` 切出主题分支 `remove-task-node-ui-alignment`。
- [x] (2026-04-07 22:11 +0800) 梳理现状：`Task` 已进入协议、宿主状态、Webview、侧栏、产品规格与自动化测试矩阵；当前深色偏置和 `Task` / `Note` 多层染色块确实会放大风格割裂。
- [x] (2026-04-07 22:11 +0800) 新建本 ExecPlan，并新增正式设计文档记录“删除 Task + 主题跟随 + Note 收口”的当前结论。
- [x] (2026-04-07 22:24 +0800) 实现协议、宿主、侧栏和 Webview 中的 `Task` 删除与旧状态过滤。
- [x] (2026-04-07 22:24 +0800) 收口画布与 `Note` 的主题跟随样式，去掉明显不必要的深色偏置和强内部色块。
- [x] (2026-04-07 22:33 +0800) 更新正式规格、README、设计索引与相关文案，确保当前对象模型可追踪。
- [x] (2026-04-07 22:38 +0800) 调整并运行自动化验证，覆盖创建入口、旧状态过滤与 `Note` 编辑主路径。
- [x] (2026-04-07 22:40 +0800) 完成结果复盘；本轮无新增必须登记的后续技术债，计划移入 `completed/`。

## 意外与发现

- 观察：`Task` 不是单一组件，而是当前共享协议和宿主归一化逻辑的一部分；如果只删 Webview 节点，旧状态读取与测试仍会继续把它带回来。
  证据：`src/common/protocol.ts`、`src/panel/CanvasPanelManager.ts`、`src/sidebar/CanvasSidebarView.ts`、`tests/playwright/webview-harness.spec.mjs`、`tests/vscode-smoke/extension-tests.cjs` 都直接枚举 `task`。

- 观察：当前“深色偏置”主要不是来自 VSCode token，而是来自和固定深色值的 `color-mix`、渐变和类型内层染色块叠加。
  证据：`src/webview/styles.css` 的 `.canvas-shell`、`.canvas-corner-panel`、`.task-context-strip`、`.note-context-strip`、`.task-document-sheet`、`.note-document-sheet`，以及 `src/panel/getWebviewHtml.ts` 中待机态背景都混入了固定暗色值。

- 观察：本轮真实回归里唯一新增失败是 Playwright 基线截图，而不是行为逻辑回退。
  证据：`npm run test:webview` 首次失败只出现在 `canvas-shell-baseline.png`，7 个交互用例全部通过；更新基线后 8/8 通过。

## 决策记录

- 决策：当前范围直接删除 `Task` 节点，而不是保留隐藏入口或实验开关。
  理由：产品语义已经明确不需要 `Task`；继续保留只会让对象模型、测试和文档长期分叉。
  日期/作者：2026-04-07 / Codex

- 决策：旧持久化状态中的 `task` 节点直接过滤，不自动迁移成 `note`。
  理由：当前两者没有稳定等价语义，强行迁移会制造错误结论。
  日期/作者：2026-04-07 / Codex

- 决策：本轮把“主题跟随”作为 UI 原则的一部分一起落地，不把深色偏置留作下一轮再收。
  理由：如果只删 `Task`，但不收口浅色主题和内部大色块，用户看到的主要违和感仍然存在。
  日期/作者：2026-04-07 / Codex

## 结果与复盘

本轮已经把当前辅助对象模型正式收口为 `Agent` / `Terminal` / `Note`。`Task` 从共享协议、宿主状态、命令入口、侧栏文案、Webview 组件、样式和自动化测试矩阵中移除；旧持久化状态里的 `task` 节点现在会在读取时被直接过滤，而不是继续回到当前对象图。

视觉上，画布与 `Note` 不再依赖明显的固定深色偏置，浅色主题下也会优先跟随 VSCode token。`Note` 的内部结构从多层语义色块收口为单一主内容面，更接近执行型节点同体系的轻量工作窗口。

本轮没有新增必须立即继续跟踪的技术债。仍保留大量历史文档中的 `Task` 叙述，但这些内容已通过新设计文档或显式“历史阶段说明”与当前实现口径解耦，不再把 `Task` 表述为现行支持对象。

## 上下文与定向

本轮直接相关的关键文件如下：

- `src/common/protocol.ts`：共享协议。当前 `CanvasNodeKind` 仍包含 `task`，并定义了 `TaskNodeStatus`、`TaskNodeMetadata` 和 `webview/updateTaskNode`。
- `src/panel/CanvasPanelManager.ts`：宿主权威状态。当前负责创建、归一化、持久化和恢复 `task` 节点。
- `src/extension.ts` 与 `src/sidebar/CanvasSidebarView.ts`：命令入口和原生侧栏。当前文案与 QuickPick 仍包含 `Task`。
- `src/webview/main.tsx` 与 `src/webview/styles.css`：React Flow 画布和节点样式。当前仍渲染 `TaskEditableNode`，并且辅助对象内部有较重的语义染色和层级。
- `src/panel/getWebviewHtml.ts`：Webview 外层待机态和主题变量注入。当前仍带固定暗色背景偏置。
- `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/PRODUCT_SENSE.md`、`README.md`：当前正式描述里仍把 `Task` 写成现行辅助对象。
- `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs`：当前回归包含 `Task` 创建、编辑和截图基线，需要同步删改。

这里的“主题跟随”指的是：界面底色、表面色和前景色优先来自 `--vscode-*` token。允许存在少量强调色，但它们不应让浅色主题下的界面仍然明显发黑。

这里的“旧状态过滤”指的是：当宿主持久化里读到历史版本留下的 `task` 节点时，当前版本直接丢弃这些节点并继续正常打开画布，而不是报错或继续把 `Task` 当作现行对象。

## 工作计划

先补正式文档，再动代码。新增设计文档明确当前对象模型和主题跟随结论，并同步到设计索引、产品规格、产品判断和 README，保证后续实现有正式依据。

随后改共享协议和宿主状态。删除 `task` 相关类型、更新消息校验与可创建节点集合，并在状态归一化时过滤旧 `task` 节点。这样 Webview 和侧栏的改动才不会被宿主重新带回旧对象。

再改 Webview 和样式。移除 `TaskEditableNode` 及其样式，精简 `Note` 结构和内部层级，去掉不必要的大面积类型染色，同时把画布背景、角落面板和待机态背景进一步改成由 VSCode 主题 token 驱动。

最后更新自动化测试。浏览器 harness 要确认基线截图和创建入口不再包含 `Task`；真实 VS Code smoke 要确认只剩三类节点、旧状态里的 `task` 会被过滤且 `Note` 仍可编辑。

## 具体步骤

1. 新增设计文档，并同步 `docs/design-docs/index.md`、`docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/PRODUCT_SENSE.md` 和 `README.md`。
2. 在 `src/common/protocol.ts` 中删除 `task` 类型、消息和元数据定义，并保留对旧持久化结构做兼容过滤所需的最小解析边界。
3. 在 `src/panel/CanvasPanelManager.ts` 中移除 `task` 的创建、更新和摘要逻辑，并在状态恢复时过滤旧 `task` 节点。
4. 在 `src/extension.ts`、`src/sidebar/CanvasSidebarView.ts`、必要的 package metadata 中删除 `Task` 入口与文案。
5. 在 `src/webview/main.tsx` 与 `src/webview/styles.css` 中删除 `Task` 节点实现，并把 `Note` 与画布表面收口到主题跟随的轻量窗口样式。
6. 在 `tests/playwright/webview-harness.spec.mjs`、`tests/vscode-smoke/extension-tests.cjs` 和相关截图基线中删改 `Task` 相关断言，补充旧状态过滤与 `Note` 主路径验证。
7. 运行 `npm run build`、`npm run typecheck`、`npm run test:webview`、`npm run test:smoke`，并把结果写回本计划。

## 验证与验收

本轮至少满足以下条件才算完成：

- 任何用户可见创建入口都不再出现 `Task`。
- 宿主持久化中即使存在旧 `task` 节点，当前版本也能正常打开画布并把它们过滤掉。
- `Note` 节点仍然可以编辑标题和正文。
- 画布和 `Note` 表面在浅色主题下不再保留明显的固定深色底。
- `npm run build`、`npm run typecheck`、`npm run test:webview`、`npm run test:smoke` 通过；如有无法执行的验证，必须显式记录原因。

## 幂等性与恢复

- 删除 `Task` 后，重复运行状态归一化不应产生副作用；旧 `task` 节点每次都应被安全过滤。
- 任何旧版本状态即使包含 `task` 元数据，也不应阻止当前版本恢复 `Agent`、`Terminal`、`Note`。
- 样式收口应优先基于现有 VSCode token，避免再次写入新的固定主题偏置。

## 证据与备注

关键验证结果如下：

    npm run typecheck
    -> 通过

    npm run build
    -> 通过

    npm run test:webview
    -> 初次仅 baseline screenshot 失败；更新 `tests/playwright/webview-harness.spec.mjs-snapshots/canvas-shell-baseline-linux.png` 后 8/8 通过

    npm run test:smoke
    -> Trusted workspace smoke passed.
    -> Restricted workspace smoke passed.
    -> VS Code smoke test passed.

## 接口与依赖

本轮继续使用现有 `reactflow`、React 和 VSCode Webview 基线，不新增新的运行时依赖。

需要收口的稳定接口包括：

- `src/common/protocol.ts`

    export type CanvasNodeKind = 'agent' | 'terminal' | 'note';

- `src/panel/CanvasPanelManager.ts`

    function sanitizeStoredNode(record: unknown): CanvasNodeSummary | null

    上述归一化函数必须在恢复旧状态时过滤 `task`。

- `src/sidebar/CanvasSidebarView.ts`

    creatableKinds: CanvasNodeKind[]

    侧栏创建入口与状态摘要只针对三类节点。

更新说明：

- 2026-04-07 22:11 +0800，新建本计划，定义删除 `Task`、旧状态过滤、主题跟随样式收口与验证范围。
- 2026-04-07 22:40 +0800，补齐测试、文档和验证结果，确认本轮完成并准备移入 `completed/`。
