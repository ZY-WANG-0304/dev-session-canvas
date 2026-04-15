# Terminal 高频输出下的输入与画布响应修复

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文件已完成，归档于 `docs/exec-plans/completed/terminal-output-flood-input-responsiveness.md`；执行期间一直按 `docs/PLANS.md` 的要求维护。本轮未新增需要登记到 `docs/exec-plans/tech-debt-tracker.md` 的遗留技术债。

## 目标与全局图景

这次变更要解决一个用户可直接感知的阻塞问题：当 `Terminal` 节点执行 `find /` 这类持续高频 PTY 输出命令时，终端内容仍在继续渲染，但整个 Webview 主线程被输出处理占满，导致当前终端的 `Ctrl-C`、其他节点输入，以及画布上的选择、拖拽、缩放和创建操作都被排队到命令结束后才处理。完成后，Terminal 高频输出不应再把输入和画布交互饿死；用户应能像使用 VSCode 原生 Terminal 一样，在输出持续进行时仍然即时发送中断、切换到其他节点并继续操作画布。

用户可见的验收标准有三条。第一，长时间高频输出期间，当前终端可以即时响应 `Ctrl-C` 并继续接受后续输入。第二，同期其他 `Agent` / `Terminal` 节点仍能启动或输入，不会因为某一个终端 flood 而一起卡死。第三，画布上的选择与其他基本交互仍能在可接受延迟内完成，不再等到 flood 结束后集中执行。

## 进度

- [x] (2026-04-16 15:02 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md`、Terminal 相关设计文档与现有活跃计划，确认本问题属于跨模块交付性修复，需要单独 `ExecPlan`。
- [x] (2026-04-16 15:14 +0800) 对比 Terminal 与 Agent 输出链路，确认两者宿主协议相同，但 Terminal 高频 PTY 输出会在 Webview 内触发更高频的同步消息分发与终端写入，从而放大主线程饥饿。
- [x] (2026-04-16 15:32 +0800) 在 Webview 侧移除“全局 `EventTarget` 同步广播到所有执行节点”的热路径，改为按节点注册的输出控制器。
- [x] (2026-04-16 15:44 +0800) 把执行输出从 `window.message` 回调中的同步 `terminal.write` 改为异步批量 drain，让消息回调只做入队。
- [x] (2026-04-16 15:51 +0800) 更新终端运行时设计文档，明确高频输出场景的标准处理方式与输入优先级边界。
- [x] (2026-04-16 16:08 +0800) 补 trusted smoke 回归，覆盖终端 flood 期间的 `Ctrl-C`、其他节点输入和节点选择，并新增真实 Webview 输入动作桥。
- [x] (2026-04-16 16:56 +0800) 运行 `npm run build`、`npm run typecheck`、`npm run test:webview` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`，全部通过。
- [x] (2026-04-16 16:58 +0800) 复核剩余风险；本轮没有新增需要登记到 `docs/exec-plans/tech-debt-tracker.md` 的遗留项，并按 `PLANS.md` 将本计划归档到 `completed/`。

## 意外与发现

- 观察：宿主侧已经有 `EXECUTION_OUTPUT_FLUSH_INTERVAL_MS = 32` 的输出合并，但 Webview 侧仍然对每条 `host/executionOutput` 执行同步 `dispatchEvent`，并由每个执行节点监听器同步判定消息是否属于自己。
  证据：`src/panel/CanvasPanelManager.ts` 中的 `queueExecutionOutput()` 会做 `32ms` 合并；`src/webview/main.tsx` 中 `emitExecutionHostEvent()` 直接 `dispatchEvent()`，`AgentSessionNode` / `TerminalSessionNode` 都在监听器里直接 `terminal.write(detail.chunk)`。

- 观察：`Agent` 与 `Terminal` 的协议类型和恢复路径基本一致，关键差异不在“是否走另一条通道”，而在输出分布特征。`Agent` 输出通常是分段流式生成，`Terminal` 的 PTY 输出可以在 shell 命令下持续高频、长时间无上限地产生。
  证据：`src/panel/CanvasPanelManager.ts` 中 `queueExecutionOutput()` 同时服务 `agent` 与 `terminal`；`src/webview/main.tsx` 中两个节点组件的 `detail.type === 'output'` 分支也是同样的 `terminal.write(detail.chunk)`。

- 观察：`xterm.js` 自身已经把 `write()` 设计成异步缓冲，并在内部用时间片切分解析；因此仓库当前最不标准的部分不是“调用了 `write()`”，而是把消息分发和命中节点的写入都放在 Webview 的同步消息回调里完成，导致用户输入和画布事件没有机会优先进入主线程。
  证据：本地依赖 `node_modules/@xterm/xterm/src/common/input/WriteBuffer.ts` 中 `write()` 默认通过 `setTimeout(() => this._innerWrite())` 延后解析，并在 `WRITE_TIMEOUT_MS = 12` 的预算内切分。

- 观察：现有测试里直接派发 `webview/executionInput` 宿主消息，无法证明真实 Webview 主线程在 flood 期间仍能处理输入；需要新增一个 test-only DOM action，直接通过已挂载的 `xterm` 实例走真实输入路径。
  证据：trusted smoke 首次接入 flood 回归时，如果继续复用 `dispatchWebviewMessage({ type: 'webview/executionInput', ... })`，会绕开本轮要验证的 Webview 主线程排队点；新增 `sendExecutionInput` 后，测试改为 `entry.terminal.input(action.data)`。

## 决策记录

- 决策：本轮优先改 Webview 侧输出消费架构，不额外引入 Terminal 专用宿主协议。
  理由：问题根因是 Webview 主线程被同步输出处理占满，而不是宿主区分错了节点类型；Agent 与 Terminal 应继续共用执行协议，只在消费层处理高频差异。
  日期/作者：2026-04-16 / Codex

- 决策：移除当前 `EventTarget` 广播热点，改为按节点注册的执行终端控制器。
  理由：现有广播会让每条输出都同步触发所有执行节点监听器；这在多节点场景下会把单个终端 flood 放大成全局 O(n) 主线程负担。
  日期/作者：2026-04-16 / Codex

- 决策：输出消息在 Webview 中只做入队，真正写入 `xterm` 改到异步批量 drain。
  理由：这样能把重活从 `window.message` 回调中移走，让浏览器先处理输入和画布事件；同时仍可复用 `xterm.write()` 的异步缓冲模型，不需要自造终端解析器。
  日期/作者：2026-04-16 / Codex

- 决策：trusted smoke 的 flood 回归必须走真实 Webview 输入路径，不能继续直接伪造宿主输入消息。
  理由：本轮目标是证明“高频输出不会饿死 Webview 主线程里的输入与交互”；如果测试直接调用宿主命令，会绕开真正的竞争点，结论不成立。
  日期/作者：2026-04-16 / Codex

## 结果与复盘

本计划已完成，结果如下。

1. `src/webview/main.tsx` 不再使用全局 `EventTarget` 把每条 `host/executionOutput` 同步广播给所有执行节点；改为按节点注册 `ExecutionTerminalController`，把消息直接路由到目标节点，避免单个 Terminal flood 在多节点场景下放大成全局 O(n) 同步负担。
2. Webview 里的输出消费改成“消息回调只入队，`requestAnimationFrame` 批量 drain 后再 `terminal.write()`”。这样宿主侧原有的 `32ms` 合并继续保留，而 Webview 主线程也不再在 `window.message` 回调里同步做重活。
3. trusted smoke 新增 `verifyTerminalFloodKeepsCanvasResponsive()`，现在覆盖五类关键行为：Terminal flood 期间能选中其他节点、既有 Agent 仍能接收输入并输出、第二个 Terminal 可以在压力期间创建并同时进入 flood、压力期间还能新建并启动额外 Agent，以及两个 flooding Terminal 都仍能响应 `Ctrl-C` 并继续执行后续命令。为保证验证路径真实，协议里增加了 test-only `sendExecutionInput` DOM action。
4. 设计文档已同步，正式写明“高频输出属于低优先级、可批量流式数据；输入与画布交互必须保持高优先级，不得被同步输出消费饿死”。

本轮验证记录如下：

    $ npm run build
    ... exit 0

    $ npm run typecheck
    ... exit 0

    $ npm run test:webview
    34/34 passed

    $ DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs
    Trusted workspace smoke passed.
    VS Code smoke test passed.

复盘：

- 根因不是宿主“完全没做批量”，而是 Webview 仍沿用同步广播加同步写入的热路径；Agent 不会稳定复现，只是因为输出频率较低，而不是因为它走了另一套协议。
- 这次修复收口在消息消费架构层，而不是给某个终端节点加局部节流补丁，因此同时改善了当前 Terminal、自身输入、其他执行节点输入，以及画布 DOM 交互的竞争关系。
- 当前自动化已覆盖单 Terminal flood、双 Terminal 同时 flood，以及压力期间新建 Agent 并启动这三类关键边界；本轮未观察到新的结构性缺口，因此没有新增技术债条目。

## 上下文与定向

这次改动主要触达三个区域。

第一处是 `src/panel/CanvasPanelManager.ts`。这里是 Extension Host 中的宿主权威状态与执行会话管理层，负责接收 PTY 输出、更新摘要、推送 `host/executionOutput`、`host/executionSnapshot`、`host/executionExit`。当前它已经对增量输出做了 `32ms` 合并，因此宿主侧并不是“每个 PTY chunk 都立刻发一条 Webview 消息”。

第二处是 `src/webview/main.tsx`。这里现在有一个全局 `executionEventTarget`，`window.message` 收到输出后会立刻 `dispatchEvent()`；每个 `AgentSessionNode` / `TerminalSessionNode` 都订阅这个事件，并在命中自己的消息时立即 `terminal.write(detail.chunk)`。这意味着高频输出会直接占用 Webview 主线程消息回调，同时每条消息还要让所有执行节点监听器都跑一遍。

第三处是 `tests/vscode-smoke/extension-tests.cjs`。这里已经有真实 Webview DOM 动作、probe 和执行节点输入的 smoke 基础设施，适合补一条“终端 flood 期间仍能选择其他节点、给其他节点发输入、对当前终端发 `Ctrl-C`”的回归。

本文里的“输出控制器”指一个按 `kind + nodeId` 注册的 Webview 侧对象，它持有该节点对应的 `xterm` 实例、待写出的输出缓冲，以及必要的 snapshot / exit / visibility refresh 逻辑。它不是新的宿主协议层，只是替换当前 `EventTarget` 广播的本地消费结构。

## 工作计划

先收口设计和执行计划，再改代码。设计文档需要明确一条新的正式结论：在执行节点里，输出属于低优先级、可批量的流式数据；输入与画布交互是高优先级用户事件，因此输出不能继续在消息回调中同步消费。然后在 Webview 中把执行输出路径重构成“注册式控制器 + 批量 drain”，同时保留现有宿主协议和 `xterm` 恢复语义。

实现上先从 `src/webview/main.tsx` 下手。删除 `executionEventTarget` 的同步广播，让 `window.message` 收到 `host/executionSnapshot` / `host/executionOutput` / `host/executionExit` 后，直接按节点路由到对应控制器。控制器需要把连续输出追加到本地缓冲，并通过单次调度在下一帧或下一轮事件循环中合并写入 `xterm`，避免每条消息都同步触发一次写入。

随后补验证。`tests/vscode-smoke/extension-tests.cjs` 应新增一个高频输出场景：让终端执行持续输出的 shell 循环，在其进行期间通过真实 Webview DOM 动作选中其他节点、给 Agent 发输入，再给 flooding terminal 发 `Ctrl-C` 并验证后续命令仍能执行。这样才能证明修复的不是“输出显示”，而是“输入与交互仍可抢到主线程”。

## 具体步骤

1. 修改 `src/webview/main.tsx`，新增执行终端控制器注册表，移除 `executionEventTarget` 广播。
2. 在控制器中实现输出入队与异步 drain，把 `snapshot`、`output`、`exit`、`visibility restore` 的消费统一收口。
3. 更新 `docs/design-docs/embedded-terminal-runtime-window.md` 与 `docs/design-docs/index.md`，记录高频输出场景下的标准处理结论。
4. 修改 `tests/vscode-smoke/extension-tests.cjs`，补 terminal flood 响应性回归。
5. 执行 `npm run build`、`npm run typecheck` 与定向 smoke / Webview 测试。

## 验证与验收

最低自动化要求如下：

- 运行 `npm run build`，预期成功生成最新产物。
- 运行 `npm run typecheck`，预期 TypeScript 检查通过。
- 运行 `npm run test:webview`，预期全部通过。
- 运行定向 trusted smoke：`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`，至少覆盖以下观察：
  - 终端 flood 期间，真实 Webview DOM 动作仍能完成。
  - flood 期间，其他执行节点仍能收到输入并产出结果。
  - 给 flooding terminal 发送 `Ctrl-C` 后，后续命令仍能在同一会话里执行。

如果自动化无法稳定覆盖某个 UI 细节，最终结果中必须显式写明已验证范围和未验证范围，不能把未跑过的交互写成已确认。

## 幂等性与恢复

这次改动主要发生在 Webview 本地消息消费层，不引入新的持久化格式。重复执行构建和测试不应改变仓库运行时状态。若新控制器实现需要局部缓存，也必须保证节点卸载时清理注册表，避免 Webview retain / recreate 后留下悬挂实例。

## 证据与备注

当前最关键的根因证据如下：

    宿主侧：
    - `src/panel/CanvasPanelManager.ts` 的 `queueExecutionOutput()` 已做 32ms 合并。

    Webview 侧：
    - `window.message` 收到 `host/executionOutput` 后直接 `dispatchEvent(new CustomEvent(...))`
    - 每个执行节点监听器命中后立刻执行 `terminal.write(detail.chunk)`

这说明问题不在“完全没有合并”，而在“高频输出进入 Webview 后仍沿同步主线程路径逐条消费”。

## 接口与依赖

本轮预计触达以下接口：

- `src/webview/main.tsx`
  - 删除或废弃 `executionEventTarget` 相关广播逻辑。
  - 新增按节点注册的执行终端控制器与输出 drain 调度。
- `tests/vscode-smoke/extension-tests.cjs`
  - 新增 terminal flood 响应性回归。
- `docs/design-docs/embedded-terminal-runtime-window.md`
  - 更新高频输出场景下的标准处理边界。
- `docs/design-docs/index.md`
  - 同步设计文档更新时间与关联计划。

---

最后更新说明：2026-04-16 完成 Webview 输出消费架构重构、trusted smoke flood 回归、设计文档同步和验证闭环，并将本计划归档到 `completed/`，因为实现与验收都已收口。
