# 实现 Agent 创建前 provider 选择

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要把“先创建默认 Agent，再到节点里切换 provider”的旧路径，改成“创建时就确定 provider”。完成后，用户可以在 VSCode 侧栏/命令入口的 `QuickPick` 里一屏完成默认 `Agent`、`Terminal`、`Note` 的创建，也可以在同一个 `QuickPick` 里直接按 `Codex` 或 `Claude Code` 创建对应 `Agent`。同时，画布空白区右键菜单需要保留默认快速创建能力，并允许 drill-in 到 provider 选择视图。

用户可见的正确结果有两条。第一，选择 `Agent（默认：Codex）` 或 `Codex（默认）` 创建时，新节点首帧 metadata 就是 `codex`，不会先落成别的 provider。第二，选择 `Claude Code` 创建时，节点第一次自动启动消息和持久化 metadata 都直接使用 `claude`。要证明工作完成，应至少运行 `npm run typecheck`、`npm run test:webview` 和 `npm run test:smoke`，并观察新增测试覆盖默认创建与按 provider 创建两条路径。

## 进度

- [x] (2026-04-13 15:20 +0800) 阅读 `AGENTS.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/FRONTEND.md`、`ARCHITECTURE.md` 以及相关设计文档，确认这次实现需要先有正式设计文档并使用 `ExecPlan` 推进。
- [x] (2026-04-13 15:28 +0800) 新增 `docs/design-docs/agent-node-creation-provider-selection.md`，并把 `QuickPick` 方案收口为“顶层分区 + 一击创建 + 第二组展示完整 Agent 类型列表”。
- [x] (2026-04-13 20:40 +0800) 更新宿主 `QuickPick`、测试注入和创建命令，支持默认创建与按 provider 创建。
- [x] (2026-04-13 20:55 +0800) 更新 Webview 右键菜单与 Host/Webview 创建协议，支持创建时传入 `agentProvider` 初始值。
- [x] (2026-04-13 21:05 +0800) 更新宿主状态写入路径，保证创建出的节点第一次落库、首次自动启动和后续 probe 都使用正确 provider。
- [x] (2026-04-13 21:20 +0800) 补齐自动化验证，覆盖 Webview 右键菜单的 provider 选择、宿主 `QuickPick` 的默认/显式创建，以及创建后首帧 metadata/启动消息的正确性。
- [x] (2026-04-13 22:09 +0800) 运行 `npm run typecheck`、`npm run test:webview`、`npm run test:smoke`，修复一处 smoke 时序断言后全部通过，并回填设计文档、索引和本计划复盘。

## 意外与发现

- 观察：当前 `COMMAND_IDS.createNode` 的宿主实现直接调用 `vscode.window.showQuickPick`，现有自动化没有任何办法稳定选择 `QuickPick` 项。
  证据：`src/extension.ts` 当前的 `promptCreateNodeKind()` 直接调用 `showQuickPick`；`tests/vscode-smoke` 中也没有任何 QuickPick 相关测试注入。

- 观察：当前创建协议只传 `kind`，没有“创建时 provider”字段，所以任何显式 provider 选择如果不改协议，就只能退化成“先创建默认节点，再补一次 update”。
  证据：`src/common/protocol.ts` 中 `webview/createDemoNode` 与 `host/requestCreateNode` 的 payload 都只有 `kind` 和可选坐标。

- 观察：新增宿主 `QuickPick` 验证后，`trusted smoke` 里原有 `verifyAgentExecutionFlow()` 对 `starting` 瞬时状态的等待变得不稳定；节点已经 live 且可输入时，也可能先于断言进入 `waiting-input`。
  证据：2026-04-13 22:04 +0800 的一次 `npm run test:smoke` 失败快照显示 `agent-1.metadata.agent.liveSession === true` 且 `status === 'waiting-input'`，超时点位于 `tests/vscode-smoke/extension-tests.cjs:574`。

## 决策记录

- 决策：为 `QuickPick` 自动化增加轻量测试注入，而不是把宿主命令验证完全留给人工。
  理由：这是正式用户入口；如果只测 Webview 菜单而不测宿主 `QuickPick`，这次实现最关键的一半交互会缺少自动化证据。仓库已经允许大量 test-only 命令，因此在测试模式下注入选择序列是可接受的。
  日期/作者：2026-04-13 / Codex

- 决策：创建协议使用一个可选的 `agentProvider` 初始值，而不是新增“创建后立即切换 provider”的第二条消息。
  理由：这能保证首帧 metadata、首次自动启动和持久化状态都从一开始就正确，也更符合“创建动作一次完成对象定义”的设计目标。
  日期/作者：2026-04-13 / Codex

- 决策：保留 `trusted smoke` 对 Agent 自动启动的验证，但把 `verifyAgentExecutionFlow()` 的首个等待条件从仅接受 `starting`，放宽到接受 `starting`、`running` 或 `waiting-input` 三种 live 状态。
  理由：`verifyAutoStartOnCreate()` 已经覆盖“创建后进入 live 启动流程”的核心语义；后续执行流验证的职责是确认会话可继续收发输入输出，不应该绑定一个实现上很短暂的瞬时状态。
  日期/作者：2026-04-13 / Codex

## 结果与复盘

本计划已完成，结果如下：

- 宿主 `QuickPick` 已经收口为单层分区式列表：第一组提供 `Agent（默认：<provider>）`、`Terminal`、`Note` 的最快创建路径，第二组提供完整 `Agent` provider 列表。
- Webview 右键菜单保持 `Agent / Terminal / Note` 根视图，其中 `Agent` 既可主操作直接按默认 provider 创建，也可 drill-in 到 provider 列表显式创建。
- Host/Webview 共享创建协议、宿主落库路径和自动启动路径都已支持可选 `agentProvider`；显式选择 `Claude Code` 创建时，首帧 metadata 与第一次启动记录都直接使用 `claude`。
- 自动化已经覆盖宿主 `QuickPick` 默认/显式创建、Webview 右键菜单默认/显式创建，以及创建后 metadata/启动 provider 一致性。
- 残余风险主要不在本功能本身，而在 smoke 中若继续依赖非常短暂的中间状态，后续仍可能出现时序脆弱性；本次已把最直接的断言收敛到可观察稳定态。

## 上下文与定向

这项工作同时涉及宿主命令、Webview 交互、共享消息协议和宿主权威状态。

最关键的文件如下：

- `src/extension.ts`：注册 `devSessionCanvas.createNode`，当前只弹一个“节点类型” `QuickPick`。
- `src/common/protocol.ts`：定义 `host/requestCreateNode` 和 `webview/createDemoNode` 消息；这里需要为创建时 provider 补字段并更新校验。
- `src/webview/main.tsx`：当前右键菜单 `CanvasContextMenu` 只列三类对象，且 `createNode()` 只传 `kind`。
- `src/webview/styles.css`：右键菜单的视觉结构需要支撑 Agent 默认创建与 provider drill-in。
- `src/panel/CanvasPanelManager.ts`：`createNode()`、`applyCreateNode()`、`createNextState()` 和 `createNodeMetadata()` 会决定新节点首次落库时的 provider 与 pending launch。
- `tests/playwright/webview-harness.spec.mjs`：需要验证 Webview 右键菜单的新增交互和发出的创建消息。
- `tests/vscode-smoke/extension-tests.cjs`：需要验证正式 `createNode` 命令在测试模式下走分区式 `QuickPick` 后，落地到正确节点和 provider。

这里的“首帧 metadata”指节点刚被创建并写入宿主状态时，`state.nodes[n].metadata.agent.provider` 的值。这个值必须在第一次自动启动前就已经正确，因为当前 `Agent` 创建语义会立即进入“等待尺寸后启动”的自动启动流程。

## 工作计划

第一步，先修改共享消息协议和宿主落库接口，把“创建一个节点”升级成“创建一种节点，并在是 Agent 时可选携带 provider 初始值”。这一步必须先做，因为宿主命令和 Webview 菜单最终都要走这条路径。

第二步，修改 `src/extension.ts` 的 `QuickPick`。当前单层“选节点类型”的实现要替换成分区式顶层列表：第一组是 `Agent（默认：<provider>）`、`Terminal`、`Note`；第二组是完整 `Agent` provider 列表。这里要补一个只在测试模式下生效的选择序列注入，使 smoke test 可以调用正式命令并稳定选中不同条目。

第三步，修改 Webview 右键菜单。根菜单仍保留 `Agent`、`Terminal`、`Note` 三类对象，但 `Agent` 需要拆成“主点击直接按默认 provider 创建”与“次级动作进入 provider 视图”。provider 视图负责列出完整 provider 列表并支持返回上一级。所有创建动作都必须最终发出同一条带 `agentProvider` 的创建消息。

第四步，更新自动化。`tests/playwright/webview-harness.spec.mjs` 需要新增或修改用例，验证右键菜单显式选择 `Claude Code` 时，发出的 `webview/createDemoNode` payload 已包含 `agentProvider: 'claude'`。`tests/vscode-smoke/extension-tests.cjs` 需要用测试注入跑正式 `devSessionCanvas.createNode` 命令，分别覆盖默认 `Agent` 与 `Claude Code` 的创建，并断言宿主状态里的 provider 与首个启动消息一致。

第五步，运行 `npm run typecheck`、`npm run test:webview`、`npm run test:smoke`。如果其中某条失败，必须把故障原因和修复结果写回 `意外与发现` 或 `决策记录`，而不是只改代码不记过程。

## 具体步骤

在仓库根目录执行：

1. 创建并持续维护本计划。
2. 修改 `src/common/protocol.ts`，给创建消息补 `agentProvider` 可选字段，并更新消息校验。
3. 修改 `src/panel/CanvasPanelManager.ts`，让宿主创建入口、状态落库和测试命令都能接收 `agentProvider`。
4. 修改 `src/extension.ts`，实现分区式 `QuickPick` 和测试模式下注入。
5. 修改 `src/webview/main.tsx` 与 `src/webview/styles.css`，完成右键菜单的默认创建和 provider drill-in。
6. 修改 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs`。
7. 运行：
   - `npm run typecheck`
   - `npm run test:webview`
   - `npm run test:smoke`

## 验证与验收

验收标准必须是可观察行为：

- 在宿主命令入口中，用户执行 `Dev Session Canvas: 创建对象` 时，可以在一个分区式 `QuickPick` 里直接选择默认 `Agent`、`Terminal`、`Note`，也可以直接选择 `Codex（默认）` 或 `Claude Code`。
- 选择 `Claude Code` 创建后，节点首帧 metadata 中的 `provider` 已经是 `claude`，而不是先出现 `codex` 再切换。
- 在画布空白区右键后，点击 `Agent` 主操作区会创建默认 provider 的 `Agent`；进入 provider 视图并选择 `Claude Code` 后，会直接创建 `claude` 节点。
- 自动启动场景下，创建后的第一条 `webview/startExecutionSession` 或等价宿主启动记录使用正确 provider。
- `npm run typecheck`、`npm run test:webview`、`npm run test:smoke` 通过。

## 幂等性与恢复

- 这次协议扩展必须保持向后兼容：旧测试或旧消息如果不带 `agentProvider`，仍应按当前默认 provider 工作。
- 测试注入只能在 `vscode.ExtensionMode.Test` 下启用；正式扩展环境不能留下隐藏入口改变 `QuickPick` 行为。
- Webview 右键菜单如果中途关闭或返回上一级，不应留下半完成的创建状态；只有最终点击创建项时才真正发消息。

## 证据与备注

本次完成时的关键证据如下：

    npm run typecheck
    Exit code: 0

    npm run test:webview
    25 passed (30.5s)
    Playwright webview tests passed.

    npm run test:smoke
    Exit code: 0
    Remote SSH real window reopen smoke passed.
    VS Code smoke test passed.

新增 smoke / harness 断言直接覆盖了两条关键路径：一条验证宿主 `QuickPick` 选择 `Claude Code` 时，新节点 metadata 和 `execution/startRequested` 的 provider 都是 `claude`；另一条验证默认 `Agent` 路径会直接创建 `codex`。

## 接口与依赖

这次实现结束时，以下接口应成立：

- `src/common/protocol.ts` 中：

    type `webview/createDemoNode`.payload 新增可选 `agentProvider?: AgentProviderKind`
    type `host/requestCreateNode`.payload 新增可选 `agentProvider?: AgentProviderKind`

- `src/panel/CanvasPanelManager.ts` 中：

    public createNode(kind: CanvasNodeKind, options?: { agentProvider?: AgentProviderKind }): void
    private applyCreateNode(kind: CanvasNodeKind, preferredPosition?: CanvasNodePosition, options?: { bypassTrust?: boolean; agentProvider?: AgentProviderKind }): void

- `src/extension.ts` 中：

    宿主 `QuickPick` 条目需要有稳定的测试选择 ID，测试模式下可通过 test-only 命令预置选择序列。

- `tests/vscode-smoke/extension-tests.cjs` 中：

    通过正式 `COMMAND_IDS.createNode` 覆盖默认 `Agent` 与显式 provider 创建。

本次修订说明：2026-04-13 22:09 +0800 回填最终实现结果与验证证据，记录 smoke 时序修复，并将本计划标记为已完成。
