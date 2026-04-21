# 执行节点 attention icon、闪烁提醒与点击确认

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/execution-attention-indicator-and-acknowledgement.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要把执行节点收到终端 attention signal 之后的“节点内提醒”补齐到用户可以直接观察的程度。完成后，`Agent` 和 `Terminal` 节点在收到 `BEL`、`OSC 9` 或 `OSC 777` 这类终端提醒时，会先在节点标题栏的状态控件左侧出现一个 attention icon，minimap 中对应节点也进入闪烁态；如果开启新的“强力提醒”配置，标题栏区域还会持续闪烁，直到用户点击对应节点或通过 VS Code 工作台通知的“查看节点”动作把该节点定位出来。

这次变更还要把两条配置边界拆清楚。`devSessionCanvas.notifications.bridgeTerminalAttentionSignals` 只负责“是否额外桥接成 VS Code 工作台通知”，不再控制节点内 icon 和闪烁。新的 `devSessionCanvas.notifications.strongTerminalAttentionReminder` 默认开启，只控制标题栏闪烁，不控制 icon、minimap 闪烁和工作台通知。用户最终可以通过 smoke 测试和真实 Webview probe 直接看到：关闭 bridge 后，节点内提醒仍然存在；关闭强力提醒后，icon 仍然出现，minimap 仍然闪烁，但标题栏不再闪烁。

## 进度

- [x] (2026-04-22 00:52 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md` 与现有通知设计/实现，确认本任务需要独立 `ExecPlan`，并确认当前实现只覆盖 VS Code 工作台通知桥接，没有节点内未确认提醒状态。
- [x] (2026-04-22 00:54 +0800) 检查工作树与分支状态，确认当前工作树干净，当前分支为 `main`；本轮按仓库约束直接在现有工作树推进，不回退任何用户改动。
- [x] (2026-04-22 01:05 +0800) 补充并同步正式设计文档，明确 execution attention 的宿主权威状态、节点内 icon/闪烁语义、点击确认路径，以及两个配置项的正式边界。
- [x] (2026-04-22 01:12 +0800) 扩展共享协议、宿主状态与配置读取，让 execution node metadata 可以承载“待确认 attention”状态，并把提醒确认收敛到显式鼠标点击节点与工作台通知 `查看节点` 两条路径。
- [x] (2026-04-22 01:14 +0800) 更新 Webview 节点标题栏，在状态控件左侧渲染 attention icon，并在强力提醒开启时只对 execution node 标题栏做闪烁样式。
- [x] (2026-04-22 01:28 +0800) 补充 Webview probe、smoke 测试与必要单测，验证 icon、闪烁、点击确认，以及 bridge/strong reminder 两个配置的解耦行为。
- [x] (2026-04-22 05:26 +0800) 将 minimap 中对应执行节点的闪烁并入默认 attention 表面，让其与节点上的 bell icon 共用 `attentionPending` 状态来源，并明确不受 `strongTerminalAttentionReminder` 限制。
- [x] (2026-04-22 05:41 +0800) 将 minimap attention 的视觉强调从统一通知色改为节点自身颜色，保持缩略图反馈与节点主色一致。
- [x] (2026-04-22 05:48 +0800) 加强 minimap attention pulse 的强度，提升缩略图里的可见性，让同色闪烁在 glance 下也足够明显。
- [x] (2026-04-22 05:58 +0800) 重新定义 minimap attention 的产品边界：明暗闪烁属于默认 attention，尺寸 pulse 归属 strong reminder，并补 probe / smoke 断言两者分离。

## 意外与发现

- 观察：当前 `CanvasPanelManager` 的 `bridgeExecutionAttentionSignals()` 一开始就被 `bridgeTerminalAttentionSignalsEnabled` 总开关短路，因此 bridge 关闭时既不会弹 VS Code 通知，也不会留下任何节点内 attention 状态。
  证据：`src/panel/CanvasPanelManager.ts` 中 `bridgeExecutionAttentionSignals()` 的首个判断就是 `if (!this.bridgeTerminalAttentionSignalsEnabled) return;`。

- 观察：Webview 当前没有任何“节点被点击后告诉宿主”的消息，节点选中完全是本地 UI 状态，因此若 attention icon 要做到“点击节点后消失”，必须补宿主消息，而不能只靠本地 React state。
  证据：`src/webview/main.tsx` 的 `onSelectNode`、`handleNodeClick` 和 `focusNodeInViewport()` 只更新 `selectedNodeId`，`src/common/protocol.ts` 里也没有现成的 `webview/selectNode` 之类消息。

- 观察：执行节点标题栏的 status control 已经集中在 `window-chrome-actions` 中，`AgentSessionNode` 与 `TerminalSessionNode` 共用同样的“状态 pill + 操作按钮”布局，因此 attention icon 与闪烁样式可以沿同一套结构落地，不需要新增单独的标题栏组件层级。
  证据：`src/webview/main.tsx` 里 `AgentSessionNode` 和 `TerminalSessionNode` 都在 `window-chrome-actions` 内渲染 `status-pill` 与按钮；`src/webview/styles.css` 已定义 `window-chrome` 和 `status-pill` 的共享样式。

- 观察：如果把 `webview/selectNode` 绑定到所有“节点被选中”的路径，xterm 内部 selection change、控件 focus 或其它程序化选中也会被误当成“用户已确认提醒”，从而在收到 signal 后瞬间清掉 `attentionPending`。
  证据：2026-04-22 的 trusted smoke 复跑中，第二次 `notify strong-reminder-disabled-smoke` 已经被宿主解析并置位 `attentionPending=true`，但随后又被非点击路径触发的 `webview/selectNode` 立即清除；修复后将确认动作收敛为显式鼠标点击节点，smoke 恢复通过。

## 决策记录

- 决策：把“待确认 attention”建模为 execution node metadata 上的宿主权威状态，而不是只存在于 Webview 本地 UI state。
  理由：attention 是由 PTY 输出驱动的执行节点状态，必须能跨 `host/stateUpdated` 保持稳定，也必须能被点击确认和工作台通知聚焦统一清除；只有宿主权威状态才能避免 Webview 局部状态被后续状态同步覆盖。
  日期/作者：2026-04-22 / Codex

- 决策：新增 `webview/selectNode` 宿主消息，让一切“节点被点击或聚焦”的路径都能显式清除 execution attention，而不是依赖“selectedNodeId 从 A 变到 B”这种间接条件。
  理由：用户要求是“点击节点后 icon 消失”，不是“节点首次被选中时 icon 消失”；同一节点已经选中时再次点击，也必须被视为确认动作。
  日期/作者：2026-04-22 / Codex

- 决策：保留现有 `bridgeTerminalAttentionSignals` 语义，只把它限制到 VS Code 工作台通知；节点内 icon 始终由可显示的 attention signal 驱动，闪烁单独受新的 `strongTerminalAttentionReminder` 控制。
  理由：这正是用户本轮明确提出的配置边界，且能保持“节点内提醒”和“工作台通知”是两个互不覆盖的表面。
  日期/作者：2026-04-22 / Codex

- 决策：将 minimap 中对应执行节点的闪烁视为默认 attention surface 的一部分，并让它与 bell icon 共用同一份宿主权威 `attentionPending` 状态，而不是复用 strong reminder 的开关。
  理由：用户明确指出 minimap 闪烁在产品语义上等同于节点上的通知 icon，是“默认通知处理”的缩略图投影；若把它挂到 strong reminder 下，会把默认 attention surface 和增强提醒错误耦合。
  日期/作者：2026-04-22 / Codex

- 决策：minimap attention 闪烁沿用节点自身颜色做视觉 pulse，而不是切换到统一通知色。
  理由：缩略图里的 attention 反馈应继续保留节点类别辨识度，让用户一眼知道是哪类执行节点在请求注意，而不是在 minimap 上引入额外的全局告警色语义。
  日期/作者：2026-04-22 / Codex

- 决策：同色 minimap pulse 需要通过更大的 opacity 落差、描边增厚和 glow/scale 变化来补足可见性，而不是只做轻微透明度波动。
  理由：minimap 面积小、节点块更小，如果仍按主节点标题栏那种克制强度处理，用户在 glance 导航时不容易注意到 pending attention。
  日期/作者：2026-04-22 / Codex

- 决策：在 minimap 中，把“同色明暗闪烁”定义为默认 attention 表面的一部分，而把“尺寸 pulse”明确归属 `Strong Terminal Attention Reminder`。
  理由：这能让默认通知反馈和增强提醒有清晰分层；关闭 strong reminder 后，minimap 仍然保留通知存在感，但不会再升级成更强的空间扰动。
  日期/作者：2026-04-22 / Codex

- 决策：将“节点被选中”与“节点 attention 被确认”拆开；只有显式鼠标点击节点，或通过 VS Code 工作台通知的 `查看节点` 动作聚焦节点，才清除宿主侧 `attentionPending`。
  理由：用户要的是“点击节点后 icon 消失”，不是“任何本地选中或 focus 变化都算确认”；如果不拆开，xterm selection change 等内部事件会把提醒误清掉。
  日期/作者：2026-04-22 / Codex

## 结果与复盘

本轮已完成以下交付：

- 为 `Agent` / `Terminal` 节点引入宿主权威 `attentionPending` metadata，并通过 `webview/selectNode` 与工作台通知 `查看节点` 动作统一清除。
- 新增 `devSessionCanvas.notifications.strongTerminalAttentionReminder` 配置，默认开启，仅控制标题栏闪烁；`devSessionCanvas.notifications.bridgeTerminalAttentionSignals` 现在只控制 VS Code 工作台通知桥接。
- 在执行节点标题栏状态控件左侧新增 bell icon，并让 minimap 中对应节点与 icon 共用默认 attention 状态；强力提醒开启时仅额外让标题栏区域闪烁。
- Webview probe、Playwright harness 与 VS Code smoke 已覆盖 icon、minimap 闪烁、点击确认，以及两类配置开关解耦。

本轮最终验证结果：

- `npm run typecheck` 通过
- `npm run test:execution-attention-signals` 通过
- `npm run build` 通过
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过

剩余风险：

- 设计文档里记录的 Ghostty / kitty / iTerm2 / tmux 手工协议验证本轮仍未执行，因此文档层面的 `validation_status` 继续保持“验证中”；但仓库内实现与 VS Code 宿主级自动化验证已经闭环。

## 上下文与定向

这次改动分布在四个区域。

第一处是正式设计与执行文档。现有设计文档 `docs/design-docs/execution-node-notification-and-attention-signals.md` 已经定义了 `BEL`、`OSC 9`、`OSC 777` 的解析与 VS Code 工作台通知桥接，但还没有把“节点内未确认提醒状态”和“bridge 开关只影响工作台通知”写成正式方案。本计划会先补这层口径，再进入实现。

第二处是共享协议与宿主状态。`src/common/protocol.ts` 定义 Webview/Host 消息、节点 metadata 和测试 probe 类型；`src/panel/CanvasPanelManager.ts` 是 execution attention 的宿主编排中心。要让 icon 和点击确认稳定工作，必须在这两处补 execution attention 的权威状态与确认消息。

第三处是 Webview UI。`src/webview/main.tsx` 中 `AgentSessionNode` 与 `TerminalSessionNode` 渲染执行节点标题栏；`src/webview/styles.css` 定义标题栏、状态 pill 和 node chrome 的视觉样式。本轮标题栏 icon 与闪烁都在这里实现。

第四处是自动化验证。`tests/vscode-smoke/extension-tests.cjs` 已经覆盖 attention bridge、冷却和“查看节点”工作台动作，但还没有断言节点内 icon、标题栏闪烁和点击确认；`scripts/test-execution-attention-signals.mjs` 则继续负责底层解析器语义。

## 工作计划

先更新设计文档，把 execution attention 的正式表面从“只有 VS Code 工作台通知”扩成“三层分离”：终端底层信号解析、宿主权威 attention 状态、可选的 VS Code 工作台通知桥接。设计文档里必须写清楚新的配置边界、点击确认规则，以及 Webview 的渲染落点，否则后续代码实现会缺乏正式口径。

然后扩展共享类型与宿主逻辑。在 `ExecutionSessionMetadata` 的 agent/terminal 元数据里加一个最小 attention pending 字段，并在 `CanvasPanelManager` 里把“解析到 attention signal”拆成两段：第一段无条件更新节点 attention pending；第二段按 `bridgeTerminalAttentionSignals` 决定是否额外弹 VS Code 通知。与此同时新增新的强力提醒配置读取，并把它通过 `CanvasRuntimeContext` 传给 Webview。

接着补点击确认链路。Webview 只在两条路径上把“当前节点已被用户确认”传给宿主：第一条是用户显式用鼠标点击对应 execution node；第二条是用户点击 VS Code 工作台通知里的 `查看节点` 动作并由宿主完成节点聚焦。宿主收到该确认后清除 metadata 里的 attention pending，再回推状态，让 icon 和闪烁真正消失；本地选中切换、按钮 focus/点击、terminal selection change 或其它程序化 focus 都不应被视为确认。

最后补 UI 与验证。Webview 标题栏把 icon 放到 status pill 左边，强力提醒开启时对 `window-chrome` 做有限范围的闪烁。Smoke 测试要直接验证 bridge 关闭时 icon/闪烁仍然存在，强力提醒关闭时只剩 icon 不闪烁，以及显式鼠标点击节点或通过 `查看节点` 聚焦都会清除 attention。

## 具体步骤

1. 更新设计文档与索引：

    - `docs/design-docs/execution-node-notification-and-attention-signals.md`
    - `docs/design-docs/index.md`

2. 更新共享类型与配置声明：

    - `src/common/protocol.ts`
    - `src/common/extensionIdentity.ts`
    - `package.json`
    - `package.nls.json`

3. 修改宿主 attention 编排与确认逻辑：

    - `src/panel/CanvasPanelManager.ts`
    - 如有必要，同步更新任何使用 execution metadata 的辅助函数

4. 修改 Webview 标题栏与 probe：

    - `src/webview/main.tsx`
    - `src/webview/styles.css`

5. 补验证并执行命令：

    - `scripts/test-execution-attention-signals.mjs`
    - `tests/vscode-smoke/extension-tests.cjs`
    - 在仓库根目录运行：

          npm run typecheck
          npm run test:execution-attention-signals
          DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs

## 验证与验收

需要满足以下可观察结果。

第一，默认配置下，向 `Agent` 或 `Terminal` 节点注入 `notify <message>` 这类 fake provider 输出后，节点标题栏状态控件左侧出现 attention icon，标题栏开始闪烁；点击该节点后，icon 与闪烁同时消失。

第二，当 `devSessionCanvas.notifications.bridgeTerminalAttentionSignals=false` 时，同样的 attention signal 不再弹出 VS Code 工作台通知，但节点内 icon 与闪烁行为完全保留。

第三，当 `devSessionCanvas.notifications.strongTerminalAttentionReminder=false` 时，同样的 attention signal 仍会让节点显示 attention icon，但标题栏不再闪烁；把该配置重新打开后，后续新的 attention signal 再次触发闪烁。

第四，点击 VS Code 工作台通知中的 `查看节点` 动作后，画布聚焦到对应节点，同时该节点 attention icon 被清除；这证明“工作台通知聚焦”与“手动点击节点”共享同一条确认语义。

## 幂等性与恢复

这次变更应保持幂等。重复收到同一节点的 attention signal 时，如果节点已经处于 attention pending 状态，不要求重复写入相同 metadata；bridge 相关的去重与冷却继续只作用于工作台通知，不应导致节点内 attention 状态被提前清除。

若某一步实现失败，恢复策略应尽量局部：协议字段扩展只追加可选字段，旧状态通过 `normalizeMetadata()` 自动回落；Webview probe 字段也只追加，不改变现有测试结构。这样中途回滚或重跑 smoke 时，不会因为旧快照缺字段而把工作树带到不可恢复状态。

## 证据与备注

待补本轮关键测试输出、Webview probe 结果与必要的诊断记录摘要。

## 接口与依赖

本轮实现至少会触达以下接口与模块：

- `src/common/protocol.ts`
  - `ExecutionSessionMetadata`
  - `CanvasRuntimeContext`
  - `WebviewProbeNodeSnapshot`
  - `WebviewToHostMessage`

- `src/panel/CanvasPanelManager.ts`
  - `bridgeExecutionAttentionSignals()`
  - `showExecutionAttentionNotification()`
  - `focusExecutionAttentionNode()`
  - `handleActiveWebviewMessage()`
  - `flushLiveExecutionState()`

- `src/webview/main.tsx`
  - `AgentSessionNode`
  - `TerminalSessionNode`
  - `toFlowNodes()`
  - `performWebviewDomAction()`
  - `collectWebviewProbeSnapshot()`

- `package.json`
  - `contributes.configuration.properties`

---

本次创建说明：2026-04-22 新增本计划，用于覆盖 execution attention 的节点内 icon、强力提醒闪烁、点击确认语义，以及 `bridgeTerminalAttentionSignals` 与新提醒开关的边界拆分。之所以独立起计划，是因为本轮同时涉及正式设计更新、共享协议扩展、宿主状态调整、Webview UI 改造和 smoke 回归。
