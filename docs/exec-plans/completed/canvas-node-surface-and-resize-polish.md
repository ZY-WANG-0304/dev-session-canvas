# 收口节点表面与可拉伸尺寸体验

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于 `docs/exec-plans/completed/canvas-node-surface-and-resize-polish.md`，并且必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要解决两条已经明确的真实体验问题。第一，`Task` 和 `Note` 现在虽然可编辑，但展示方式更像一组配置表单，和 `Agent` / `Terminal` 的窗口化表面不在同一套视觉语言里。第二，四类节点当前都被固定尺寸锁死，用户无法按信息密度和当前任务调整窗口大小。

变更完成后，用户应能直接看到：`Task` / `Note` 节点改成更接近运行窗口与工作文档的表面，而不是硬标签表单；`Agent`、`Terminal`、`Task`、`Note` 四类节点都能通过选中后的拉伸手柄调整宽高，且尺寸在 reload 后仍会恢复。用户在画布里新建四类节点、拖动右下角或边缘手柄、再 reload 画布，就能肉眼验证结果。

## 进度

- [x] (2026-04-07 12:06 +0800) 读取 `AGENTS.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/FRONTEND.md`、`ARCHITECTURE.md` 和任务说明，确认本轮属于需要 ExecPlan 的交付性前端改动。
- [x] (2026-04-07 12:06 +0800) 确认当前 `main` 与 `origin/main` 一致，并切出主题分支 `canvas-node-ux-polish`。
- [x] (2026-04-07 12:06 +0800) 梳理现状：Task/Note 使用固定表单式节点；宿主状态只持久化 `position`，没有节点 `size`；自动化测试还未覆盖节点 resize。
- [x] (2026-04-07 12:06 +0800) 新建本 ExecPlan，并新增正式设计文档说明节点表面与尺寸方案。
- [x] (2026-04-07 12:24 +0800) 实现共享协议、宿主状态和 Webview 节点的尺寸模型，支持四类节点拉伸并持久化。
- [x] (2026-04-07 12:24 +0800) 重构 Task/Note 节点表面，使其与 Agent/Terminal 共享更一致的窗口化视觉语言。
- [x] (2026-04-07 12:29 +0800) 补充并运行自动化验证，覆盖 Task/Note 新表面主路径、节点 resize 写路径与持久化。
- [x] (2026-04-07 12:29 +0800) 更新 ExecPlan、登记技术债，并完成提交前文档收口。

## 意外与发现

- 观察：当前“节点尺寸”并不是状态模型的一部分，而只是写死在 CSS 和宿主默认尺寸估算里。
  证据：`src/common/protocol.ts` 只有 `position`；`src/webview/styles.css` 里 `agent-session-node`、`terminal-session-node`、`object-editor-node` 都使用固定 `width`；`CanvasPanelManager` 的避碰逻辑使用 `estimatedCanvasNodeFootprint(kind)`。

- 观察：Task/Note 的主要问题不是缺字段，而是字段展示语义过于像 inspector 表单，和运行窗口表面割裂。
  证据：`src/webview/main.tsx` 中 Task/Note 直接渲染 `label + input/select/textarea` 网格，而 Agent/Terminal 使用 `window-chrome + session-body` 的窗口结构。

- 观察：Task/Note 的本地编辑态如果在挂载后仍用普通 `useEffect` 从 props 回填，会和用户首个输入发生竞争，导致刚输入的正文被旧值覆盖回去。
  证据：`tests/playwright/webview-harness.spec.mjs` 中快速编辑 Note 正文时，`webview/updateNoteNode` 曾稳定发回旧内容；将同步逻辑改为 `useLayoutEffect` 后恢复稳定。

## 决策记录

- 决策：把节点尺寸升级为宿主权威状态的一部分，并通过新的 `webview/resizeNode` 消息在 resize 结束后持久化。
  理由：如果尺寸只存在于 Webview 内存或只存在于 React Flow 内部，reload 后就无法恢复，也无法让宿主避碰逻辑认识到用户已经改过窗口尺寸。
  日期/作者：2026-04-07 / Codex

- 决策：四类节点统一使用 React Flow 自带的 resize 控件；只在选中态暴露手柄。
  理由：这条路线可以复用现有依赖，避免自造拖拽框，并且只在选中时显示控件，噪音最小。
  日期/作者：2026-04-07 / Codex

- 决策：Task/Note 不回退到 inspector，也不保留强表单感布局，而是改成“窗口头部 + 语义化内容区 + 轻量输入表面”的同构节点。
  理由：用户问题是视觉与交互风格不一致，不是字段不够；因此需要统一表面语言，而不是再搬位置。
  日期/作者：2026-04-07 / Codex

## 结果与复盘

本轮已完成：

- 共享协议新增节点 `size` 与 `webview/resizeNode`，宿主会在加载旧状态时补默认尺寸。
- 宿主节点创建、避碰和持久化链路已经改为使用节点尺寸，而不再只依赖 CSS 写死宽度。
- 四类节点统一接入 React Flow `NodeResizer`，选中后可拉伸调整宽高。
- `Task` / `Note` 从强表单感布局改为窗口化内容面，同时保留节点内编辑主路径。
- `Task` / `Note` 的本地编辑态同步改为 `useLayoutEffect`，避免首帧回填覆盖用户刚输入的内容。
- Webview probe 改为读取 React Flow 节点 wrapper 的布局尺寸，使真实 VS Code smoke 能直接校验持久化后的节点宽高。
- 浏览器 harness 已新增真实 resize 手柄拖动回归；真实 VS Code smoke 已覆盖节点尺寸写回与 reload 恢复。

本轮仍未完成：

- MR 创建与 reviewer 协作不属于本文件当前收口范围之外；代码和文档已具备进入提交 / MR 的条件。

经验与结论：

- 这类“画布内窗口体验”问题不能只改 CSS，必须把尺寸纳入宿主状态，否则 reload 和新增节点避碰都会继续失真。
- 真实 Webview 容器里的 DOM action 时序比浏览器 harness 更敏感；`input` 后等待一帧再 `blur` 可以显著提高稳定性。
- 对“节点内可编辑对象”这类组件，props 回填如果要和本地草稿态共存，应优先使用不会与首个输入竞争的同步时机，而不是把首次同步留到普通 `useEffect`。

## 上下文与定向

本轮直接相关的关键文件如下：

- `src/common/protocol.ts`：共享协议与测试 DOM action 类型，当前缺节点尺寸字段与 resize 消息。
- `src/panel/CanvasPanelManager.ts`：宿主权威状态、持久化、节点创建/归一化/避碰逻辑，当前只认识节点位置。
- `src/webview/main.tsx`：React Flow 画布与四类节点渲染，当前 Task/Note 是固定尺寸的表单节点。
- `src/webview/styles.css`：节点视觉和布局样式，当前各节点宽度写死在 CSS 类上。
- `tests/playwright/webview-harness.spec.mjs`：浏览器内 Webview 回归；适合覆盖真实拖动 resize 手柄与表面展示结果。
- `tests/vscode-smoke/extension-tests.cjs`：真实 VS Code 宿主 smoke；适合覆盖 resize 消息写回宿主后的状态持久化。
- `docs/design-docs/task-note-editable-nodes.md`：上一轮只收口了字段与编辑状态分层，没有收口窗口表面和通用尺寸模型。

这里的“窗口化表面”指的是：节点继续保留 `window-chrome` 头部，但正文不再是一组机械标签表单，而是更接近运行窗口或工作文档的结构，让用户把它当成正在操作的对象，而不是设置面板。

这里的“尺寸模型”指的是：每个节点都带一个宿主持久化的 `size`，其中至少包含 `width` 与 `height`。Webview 按这个尺寸渲染节点；用户拖动手柄后，Webview 把新尺寸发回宿主；宿主更新状态并在下一次 bootstrap / reload 时恢复。

## 工作计划

先补文档，再改协议和宿主。具体做法是：为节点新增 `size` 字段与 `webview/resizeNode` 消息，宿主在加载旧状态时补默认尺寸，在创建新节点和计算避碰矩形时使用节点实际尺寸。这样后面的 Webview 改动才有稳定状态边界。

随后重构 Webview。统一在四类节点中接入 React Flow 的 resize 控件，只在选中态显示，并按节点类型给出最小宽高。Agent/Terminal 改成“容器撑满父尺寸”的布局，保留现有会话逻辑；Task/Note 改成更贴近窗口内容面的结构，例如标题区、轻量元信息、正文工作区和更自然的占位文案，同时避免把四个字段直接堆成配置表单。

最后补自动化验证。浏览器 harness 要覆盖至少一条真实 resize 手柄拖动，证明 Webview 会发出 `webview/resizeNode` 并更新节点外框。真实 VS Code smoke 要覆盖 resize 写回宿主、reload 后尺寸仍在，避免只验证前端瞬时样式。

## 具体步骤

1. 在 `docs/design-docs/` 新增本轮设计文档，并同步 `docs/design-docs/index.md` 与 `docs/product-specs/canvas-core-collaboration-mvp.md`。
2. 在 `src/common/protocol.ts` 中新增节点 `size`、`webview/resizeNode`、必要的测试类型与尺寸归一化辅助。
3. 在 `src/panel/CanvasPanelManager.ts` 中补齐节点尺寸默认值、归一化、更新与避碰逻辑。
4. 在 `src/webview/main.tsx` 中接入 `NodeResizer`，并重构 Task/Note 节点表面与各节点布局。
5. 在 `src/webview/styles.css` 中去掉写死宽度，改成基于父容器尺寸的样式，并补齐 resize 控件与新表面样式。
6. 在 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs` 中补充回归。
7. 运行 `npm run build`、`npm run typecheck`、`npm run test:webview`、`npm run test:smoke`。

## 验证与验收

本轮至少满足以下条件才算完成：

- `Task` 和 `Note` 节点在视觉上不再像纯表单，而与 `Agent` / `Terminal` 共享一致的窗口化表面语言。
- `Agent`、`Terminal`、`Task`、`Note` 四类节点都可以通过选中后的手柄调整宽高。
- resize 后会触发宿主状态更新，并在 reload 后恢复。
- 执行型节点在 resize 后不会破坏现有终端/Agent 容器主路径。
- `npm run build`、`npm run typecheck`、`npm run test:webview`、`npm run test:smoke` 通过；如有无法执行的验证，必须显式记录原因。

## 幂等性与恢复

- 旧的持久化状态没有 `size` 字段时，宿主必须自动补默认尺寸，而不是让节点变成 `0x0` 或丢失。
- resize 消息应只更新目标节点尺寸，不应影响其他节点位置或 metadata。
- Webview 内部可以在拖动时使用 React Flow 的临时尺寸，但最终持久化必须由宿主状态负责。
- 若用户把节点缩到极小，宿主和 Webview 都要通过最小宽高约束保证内容区不会塌陷到不可用。

## 证据与备注

已完成的关键验证：

- `npm run build`
- `npm run typecheck`
- `npm run test:webview`
- `npm run test:smoke`

关键结果摘要：

- 浏览器 harness 8 条用例全部通过，包含新增的 resize 手柄拖动回归与截图基线更新。
- 真实 VS Code smoke 在 trusted / restricted 两个场景均通过，包含新增的节点尺寸持久化与 reload 恢复验证。

## 接口与依赖

本轮继续使用仓库已存在的 `reactflow@11.11.4`，直接复用其导出的 `NodeResizer`，不新增新的画布依赖。

需要新增或稳定的接口包括：

- `src/common/protocol.ts`

    interface CanvasNodeSummary {
      ...
      size: CanvasNodeFootprint;
    }

    type WebviewToHostMessage =
      | { type: 'webview/resizeNode'; payload: { nodeId: string; size: CanvasNodeFootprint } }
      | ...

- `src/panel/CanvasPanelManager.ts`

    function resizeNode(previousState: CanvasPrototypeState, nodeId: string, size: CanvasNodeFootprint): CanvasPrototypeState

- `src/webview/main.tsx`

    onResizeNode?: (nodeId: string, size: CanvasNodeFootprint) => void

更新说明：

- 2026-04-07 12:06 +0800，新建本计划，收口节点表面与通用 resize 范围、状态边界和验证要求。
- 2026-04-07 12:29 +0800，补齐实现、验证与结果复盘，并将计划移入 completed。
