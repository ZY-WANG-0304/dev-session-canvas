# 收口执行节点状态、恢复与自动启动

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要按 `功能体验.md` 中第 3、4、5 条的顺序，把当前画布里的 `Agent` / `Terminal` 从“只有 `liveSession` 布尔值的最小会话窗口”收口为更可信的执行对象。完成后，用户应能直接看到两类对象各自更细的运行状态；`Agent` 在扩展重载后会优先走 provider 自身的 resume 路径，而不是一律退化成“已中断”；新建 `Agent` / `Terminal` 节点时也不再要求用户手动点启动，而是自动进入启动或恢复流程。

这轮工作的关键不是再给现有按钮换文案，而是明确三条正式边界。第一，`Agent` 与 `Terminal` 可以有不同的状态机；第二，`Agent` 当前可以由 PTY 适配器承载，但产品定义不再等同于“特殊 Terminal”；第三，终端完整活动 buffer 仍然不承诺跨扩展重载恢复，但 `Agent` 允许在 provider 能力成立时走 best-effort resume。

## 进度

- [x] (2026-04-08 09:18 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md`、`功能体验.md`、现有设计文档与执行代码，确认这是一次需要 `ExecPlan` 的复杂交付。
- [x] (2026-04-08 09:18 +0800) 从 `功能体验.md` 提炼当前目标：先做状态语义，再做恢复，再做创建即打开，并把推荐顺序固定为 `5 -> 4 -> 3`。
- [x] (2026-04-08 09:18 +0800) 记录新的产品边界：`Agent` 与 `Terminal` 状态不必相同，`Agent` 也不再被正式定义成“必须在嵌入式终端里启动 Agent CLI”。
- [x] (2026-04-08 10:31 +0800) 新增正式设计文档，定义执行节点生命周期、恢复与自动启动规则，并把旧的 `Agent` 特殊 Terminal 设计降级为历史结论。
- [x] (2026-04-08 10:31 +0800) 实现任务 5：把 `Agent` / `Terminal` 从共享的 `liveSession` 布尔状态拆成两套状态模型，并让前端状态显示与宿主状态流转对齐。
- [x] (2026-04-08 10:31 +0800) 实现任务 4：为 `Agent` 接入 best-effort resume 元数据、持久化与扩展重载后的自动恢复；`Terminal` 明确保持“跨 surface 可重附着、跨扩展重载仅标中断”的边界。
- [x] (2026-04-08 10:31 +0800) 实现任务 3：新建 `Agent` / `Terminal` 节点后自动进入启动流程；当节点来自已持久化的恢复态时，应自动进入恢复流程。
- [x] (2026-04-08 10:31 +0800) 更新规格、设计索引和技术债说明，并把本计划归档到 `completed/`。
- [x] (2026-04-08 10:31 +0800) 运行 `npm run typecheck`、`npm run build`、`npm run test:smoke` 与 `npm run test:webview`，全部通过。

## 意外与发现

- 观察：当前代码里 `Agent` 与 `Terminal` 在宿主侧几乎共用一套 PTY 生命周期，前端也大量通过 `liveSession` 决定文案和按钮状态。
  证据：`src/panel/CanvasPanelManager.ts` 中 `startAgentSession` / `startTerminalSession` 的状态写回结构几乎平行；`src/webview/main.tsx` 中 `AgentSessionNode` / `TerminalSessionNode` 都优先以 `liveSession` 覆盖状态展示。

- 观察：仓库已经为“创建后自动启动”留下了 `autoStartPending` 字段，但当前没有任何读写主路径真正使用它。
  证据：`src/common/protocol.ts` 和 `src/panel/CanvasPanelManager.ts` 中都存在 `autoStartPending`，但搜索结果只出现在默认值或清零逻辑里。

- 观察：本机 `claude --help` 已明确暴露 `--session-id`、`--resume` 和 `--continue`，可以作为 `Agent` best-effort resume 的真实能力入口；本机没有 `codex` 二进制，因此 Codex 需要通过文档和隔离式状态目录做 best-effort 适配。
  证据：2026-04-08 在仓库根目录执行 `claude --help` 成功返回参数列表，其中包含 `--session-id` 与 `--resume`；执行 `codex --help` 返回 `command not found`。

- 观察：执行节点改成“创建即自动启动”后，原先 smoke test 里依赖“清空 host 消息后还能看到历史快照”的写法不再稳定，测试必须显式请求 `attachExecutionSession` 才能继续断言快照。
  证据：2026-04-08 首轮 `npm run test:smoke` 失败在 `tests/vscode-smoke/extension-tests.cjs:471`；补上显式 `attachExecutionSession` 后通过。

- 观察：`verifyPtyRobustness` 如果直接复用上一步刚恢复成功的 `Agent`，`exit 17` 会落到 `resume-failed` 而不是测试原本要覆盖的 fresh-start `error` 路径。
  证据：2026-04-08 第二轮 `npm run test:smoke` 失败在 `tests/vscode-smoke/extension-tests.cjs:1048`；在测试前显式停止现有会话后，fresh-start 与恢复态语义重新分离。

## 决策记录

- 决策：本轮新增一份独立的“执行节点生命周期与恢复”设计文档，而不是继续在旧的 `Agent` 特殊 Terminal 文档上打补丁。
  理由：旧文档的核心结论已经被新的产品判断推翻；继续原地增量修改会把历史结论和当前方案混在一起，降低可追踪性。
  日期/作者：2026-04-08 / Codex

- 决策：`Agent` 当前实现仍允许通过 PTY 驱动 provider CLI，但正式设计不再把 `Agent` 定义成 `Terminal` 的一个特例。
  理由：用户已经明确要求两者状态可以不同，且 `Agent` 不一定必须在 Terminal 中启动 CLI；实现层复用 PTY 是当前适配策略，不应上升为产品定义。
  日期/作者：2026-04-08 / Codex

- 决策：`Terminal` 与 `Agent` 采用不同的状态集，并允许 `Agent` 出现 `resume-ready` / `resuming` / `resume-failed` 这类终端没有的状态。
  理由：第 4 条需求的主要价值落在 `Agent`；如果强行共享完全一致的状态机，只会继续把恢复边界压扁。
  日期/作者：2026-04-08 / Codex

- 决策：创建即打开不直接在宿主创建节点时同步启动进程，而是通过持久化的 pending 启动意图等待节点尺寸就绪后再发起启动。
  理由：当前启动消息需要列宽和行高；如果在 Webview 尚未 ready 或节点尚未完成布局时直接启动，只会引入尺寸错误和额外 race。
  日期/作者：2026-04-08 / Codex

- 决策：smoke test 中凡是需要断言执行快照的场景，都改成显式发送 `webview/attachExecutionSession`，不再依赖自动启动或 surface attach 的隐式时序。
  理由：自动启动已经是正式产品行为，测试应该验证状态和协议本身，而不是把时序偶然性当成事实。
  日期/作者：2026-04-08 / Codex

- 决策：`verifyPtyRobustness` 进入前先停止现有 `Agent` / `Terminal`，把该用例限定为 PTY fresh-start / stop / 并发输出鲁棒性，而不混入上一阶段的恢复态残留。
  理由：恢复语义已由独立用例覆盖；这里继续复用恢复态只会让用例意图变混，并把 `resume-failed` 与 `error` 两条状态路径混在一起。
  日期/作者：2026-04-08 / Codex

## 结果与复盘

本轮已完成以下结果：

- 正式新增执行节点生命周期与恢复设计文档，并把旧的 `Agent` 特殊 Terminal 结论降级为历史方案。
- 在共享协议中拆出 `AgentNodeStatus`、`TerminalNodeStatus`、pending 启动意图和 `Agent` 恢复元数据。
- 在宿主侧实现 `Agent` / `Terminal` 的差异化生命周期、扩展重载后的差异化 reconcile，以及基于 pending 启动意图的创建即自动启动。
- 在 Webview 中完成新的状态展示、恢复按钮、自动启动副作用和差异化状态文案。
- 补齐 fake provider 的 `resume --last` 行为，并把 smoke / Playwright 回归同步升级到新的状态语义。

本轮自动化验证结果如下：

- `npm run typecheck`
- `npm run build`
- `npm run test:smoke`
- `npm run test:webview`

当前仍保留一项明确技术债：真实 `Codex` / `Claude Code` provider 的 end-to-end resume 主路径尚未在当前环境完成本机验证。仓库已把这项缺口登记到 `docs/exec-plans/tech-debt-tracker.md`，当前交付只把 fake-provider 与协议/状态流验证写成已完成，不把真实 provider 行为伪装成已验证结论。

如果下一位协作者需要继续推进这一主题，优先顺序应是：先补真实 provider 验证证据，再考虑是否把 `Agent` 从当前 PTY 适配实现进一步抽离为独立 runtime。

## 上下文与定向

本轮修改会同时触达四个区域。

第一块是 `src/common/protocol.ts`。这里定义了宿主与 Webview 共享的节点元数据、消息协议和测试 probe 结构。只要状态模型发生变化，这里就必须先成为新的单一事实源。

第二块是 `src/panel/CanvasPanelManager.ts`。这里保存宿主权威状态、执行会话映射、持久化写回和扩展重载后的 reconcile 逻辑。本轮第 5 条和第 4 条的大部分实现都会集中在这里。

第三块是 `src/webview/main.tsx` 与相关样式。这里负责节点按钮文案、覆盖层、自动附着、尺寸上报和测试 DOM probe。只改宿主不改这里，用户仍然只会看到旧的“未开启 / 运行中”体验。

第四块是 `tests/vscode-smoke/` 与 `tests/playwright/`。已有测试大量断言 `liveSession` 布尔语义和旧状态文案；本轮必须同步升级测试，否则回归无法说明真正行为。

本轮还依赖三份正式文档：

- `docs/design-docs/embedded-terminal-runtime-window.md`：`Terminal` 当前已选定为嵌入式终端窗口，跨扩展重载不承诺完整活动 buffer 恢复。
- `docs/design-docs/agent-runtime-prototype.md`：旧结论把 `Agent` 定义成特殊 Terminal，本轮需要明确降级为历史方案。
- `docs/product-specs/canvas-core-collaboration-mvp.md`：当前总规格仍写着 `Agent` / `Terminal` 默认显式启动，本轮要同步改成自动启动与差异化恢复口径。

## 工作计划

第一阶段先修正文档。新增一份执行节点生命周期与恢复设计文档，把 `Agent` 与 `Terminal` 的产品定义、状态集合、恢复边界和自动启动规则写清楚；同时把旧的 `Agent` 特殊 Terminal 结论标记为已废弃，并在索引里更新状态。

第二阶段实现任务 5。这里要先把协议中的共享元数据拆开，让 `Agent` 和 `Terminal` 各自拥有稳定的 lifecycle 字段，再把宿主里的启动、输出、停止、异常退出和重载 reconcile 逻辑全部改成基于 lifecycle 推进，而不是继续把 `liveSession` 当作唯一事实源。对 `Agent`，当前 PTY 适配器需要额外维护“starting -> waiting-input / running -> waiting-input / stopping”等可观察状态；对 `Terminal`，保留更简单的“launching / live / stopping / closed / error / interrupted”即可。

第三阶段实现任务 4。这里分成两半：`Terminal` 继续保持“同一扩展进程内跨 surface 可重附着，扩展重载后标记为 interrupted”；`Agent` 则增加 provider 相关的 resume 元数据。当前计划优先支持两种 best-effort 路径：Claude 通过显式 session id 恢复，Codex 通过独立的会话状态目录恢复最近一次会话。宿主在扩展重载后如果看到一个原本 live 的 `Agent` 节点，就不再一律写成 `interrupted`，而是根据元数据落到 `resume-ready`、`resume-failed` 或 `interrupted`。

第四阶段实现任务 3。创建节点时不立即强拉进程，而是在持久化状态中写入 pending 启动意图。Webview 里的节点在尺寸就绪后会把这条意图转成一次显式的 `startExecutionSession` 消息。这样无论是“用户刚创建新节点”，还是“扩展刚恢复到一个待 resume 的 Agent 节点”，都能走同一条启动桥。

第五阶段补规格、测试和复盘。自动化验证必须覆盖至少五类场景：Agent 生命周期细分、Agent resume、Terminal interrupted、创建后自动启动、恢复态节点自动恢复。只有这些都跑通，本轮才算真正完成。

## 具体步骤

在仓库根目录按以下顺序推进：

1. 新建 `docs/design-docs/execution-lifecycle-and-recovery.md`，并更新 `docs/design-docs/index.md`。
2. 更新 `docs/design-docs/agent-runtime-prototype.md` 的 frontmatter 与正文开头，明确其已被新文档取代。
3. 更新 `docs/product-specs/canvas-core-collaboration-mvp.md`，把 `Agent` / `Terminal` 的状态、恢复和自动启动口径改为当前结论。
4. 修改 `src/common/protocol.ts`，引入新的生命周期枚举、pending 启动意图和 `Agent` resume 元数据。
5. 修改 `src/panel/CanvasPanelManager.ts`，重写 `Agent` / `Terminal` 生命周期推进、重载 reconcile、pending 启动和 resume 逻辑。
6. 修改 `src/webview/main.tsx`，让节点 UI 根据新的 lifecycle 渲染状态、动作按钮和自动启动副作用。
7. 修改 `tests/vscode-smoke/fixtures/fake-agent-provider`，补可重复验证的 resume 行为。
8. 修改 `tests/vscode-smoke/extension-tests.cjs` 与 `tests/playwright/webview-harness.spec.mjs`，覆盖新的状态与恢复主路径。
9. 运行 `npm run typecheck`、`npm run build`、`npm run test:smoke` 与 `npm run test:webview`。

## 验证与验收

本轮完成时，至少应能验证以下可观察行为：

- 新建 `Terminal` 节点后，无需手动点击启动按钮，节点会自动进入启动态并在尺寸准备好后拉起终端。
- 新建 `Agent` 节点后，无需手动点击启动按钮，节点会按当前 provider 自动进入启动态。
- `Agent` 节点不再只显示“运行中 / 未运行”两种语义，至少能区分启动中、等待输入、处理中、恢复中、恢复失败和已停止。
- `Terminal` 节点不再滥用 `draft` 表示执行态，至少能区分启动中、活动、停止中、已关闭、失败和已中断。
- 扩展重载后，原本 live 的 `Terminal` 节点被显式标记为 `interrupted`，不会伪装成仍在运行。
- 扩展重载后，原本 live 的 `Agent` 节点若具备 resume 条件，会自动进入恢复流程并尽量回到可交互状态；若恢复失败，节点会留下明确失败信息，而不是默默退回初始态。
- `npm run typecheck`、`npm run build`、`npm run test:smoke` 与 `npm run test:webview` 全部通过。

## 幂等性与恢复

- 这轮的 pending 启动与 pending 恢复都必须是幂等的。即使 Webview 多次 attach、节点多次 resize 或扩展在启动中途重载，也不应导致同一节点重复拉起多份会话。
- `Agent` resume 只允许做 best-effort。若 provider 不支持、命令不可用或状态目录损坏，系统必须把失败写成正式状态和可见消息，而不是继续假装可恢复。
- `Terminal` 仍然不承诺跨扩展重载恢复完整活动 buffer；若未来需要真正持久化终端活动态，应另开设计与计划，而不是在本计划里顺手扩张范围。

## 证据与备注

当前最关键的基线证据如下：

    功能体验.md：
    3. 创建 Terminal 和 Agent 节点时，直接打开 Terminal 和 Agent，不需要手动启动。
    4. 持久化 Agent和Terminal；如果实现不了，最差通过 Codex 和 Claude 的 resume 功能在重启时还原 Agent CLI 状态。
    5. Agent运行状态与CLI的状态对齐，而不只是Terminal 的未开启和进行中两种状态。

    2026-04-08 本机 CLI 观察：
    claude --help 显示支持 --session-id、--resume、--continue
    codex --help 返回 command not found

    当前实现：
    src/panel/CanvasPanelManager.ts 仍主要用 liveSession + status=live/closed/error/interrupted
    src/webview/main.tsx 仍主要用 liveSession 决定运行中与否

## 接口与依赖

本轮新增或收口的关键接口应该包括：

- `src/common/protocol.ts` 中独立的 `Agent` / `Terminal` 生命周期枚举。
- `src/common/protocol.ts` 中用于表达自动启动与自动恢复的 pending 启动意图字段。
- `src/panel/CanvasPanelManager.ts` 中 `Agent` resume 元数据生成与恢复入口。
- `src/panel/CanvasPanelManager.ts` 中 `reconcileRuntimeNodesInArray(...)` 的差异化恢复逻辑。
- `src/webview/main.tsx` 中节点自动启动副作用与新的状态/按钮映射。

当前依赖仍保持在现有边界内：`Terminal` 继续使用 `node-pty`；`Agent` 当前也允许经由 PTY 适配器驱动 provider CLI，但不再把这种实现方式写成产品定义。

本次修订说明：2026-04-08 10:31 +0800 完成执行节点生命周期、恢复与自动启动实现，补齐 smoke / webview / build / typecheck 验证，并登记真实 provider resume 的后续技术债。
