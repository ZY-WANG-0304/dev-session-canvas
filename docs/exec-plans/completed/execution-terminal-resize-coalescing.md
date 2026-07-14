# 合并执行节点尺寸变化并收口终端重绘

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循仓库根目录的 `docs/PLANS.md`，任何接手者都应在每个停顿点同步维护本文件。

## 目标与全局图景

当前用户拖动 Agent 或 Terminal 节点的 resize 控制点时，节点外框的每一帧草稿都会改变内嵌 xterm 容器。`ResizeObserver` 随即反复执行 `FitAddon.fit()` 并把不同的 `cols/rows` 发给宿主，PTY 再把尺寸变化通知 Codex 或 Claude Code。两类 provider 的全屏 TUI 会为每次尺寸变化重绘整个屏幕，于是用户可能看到回答片段重叠、重复或短暂错排。

完成本计划后，resize 手势期间仍能实时预览节点外框，但 xterm 字符网格和 provider PTY 保持不变；松开指针后只按最终容器 fit 一次并提交一次有效尺寸。非手势布局变化会在短暂稳定窗口内合并为末值。纯位置拖动不会改变 PTY 尺寸，只会在拖动结束后本地刷新 xterm 画布，以清理浏览器合成层可能留下的旧像素。用户可通过 Playwright 回归观察：连续 resize 的移动阶段没有 `webview/resizeExecutionSession`，结束后只有一个最终消息；纯移动只有 `webview/moveNode`，没有 PTY resize。

## 进度

- [x] (2026-07-14 14:50 +0800) 读取工作流、架构、前端、可靠性、现有 resize/终端设计与相关自动化测试，确认需要正式设计记录和本 ExecPlan。
- [x] (2026-07-14 15:10 +0800) 分析现场诊断与权威 terminal journal，确认异常是快速 PTY resize 驱动 provider 全屏 TUI 重绘，不是 Host 重复投递或 provider 重复生成回答。
- [x] (2026-07-14 15:25 +0800) 选定“手势期冻结字符网格、结束后一次提交；普通几何抖动末值合并；纯移动只做本地 refresh”的实现边界并同步正式设计。
- [x] (2026-07-14 15:45 +0800) 修改 Webview 执行节点、registry 与通用 resize 收尾回调，实现 150ms 尺寸末值合并、最终 fit/refresh、位置拖动抑制和本地 refresh。
- [x] (2026-07-14 16:00 +0800) 为 Agent 与 Terminal 各增加连续 resize 和纯移动 Playwright 回归，共 4 条。
- [x] (2026-07-14 16:23 +0800) 运行类型检查、构建、聚焦/完整 Webview 回归和 trusted 真实宿主 smoke，记录通过项与当前主线无关失败。
- [x] (2026-07-14 16:25 +0800) 完成复盘、更新设计验证状态和关联路径，将计划移到 `docs/exec-plans/completed/`；检查技术债 tracker，确认真实容器 UI 覆盖缺口已有既存条目，本轮不重复登记。

## 意外与发现

- 观察：现场并不存在重复的 Host output revision；重复视觉内容来自 provider 对真实尺寸变化的主动全屏重绘。
  证据：Agent 5 的 terminal journal 在 revision 1197--1246 之间记录了 27 个 resize，尺寸在 `69x23`、`70x24`、`121x24`、`75x26` 等值之间快速变化；紧随其后的 Claude 输出至少包含 29 个由 `ESC[H` 和重复 `ESC[2K` 组成的全屏重绘帧，output revision 保持单调。

- 观察：React Flow 的纯位置拖动没有调用执行会话 resize；只有节点外框尺寸或其他容器几何变化才会进入 `ResizeObserver -> fit -> webview/resizeExecutionSession`。
  证据：`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的 `handleNodeDragStop` 只发送 `webview/moveNode`，而尺寸上报位于 `extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 的两个 `fitTerminal()`。

- 观察：通用 resize 组件在发生有效尺寸变化时只调用 `onResizeNode`，没有调用 `onResizeNodeEnd`；执行节点因此缺少一个在 DOM 草稿收口后明确 flush 最终 fit 的信号。
  证据：`extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx` 的 `applyResizeEnd()` 仅在无变化或取消时调用 `onResizeNodeEnd`。

- 观察：纯位置拖动虽然没有显式调用 PTY resize，但 React Flow 的拖动/选中布局仍可能让 `ResizeObserver` 发出通知；只在 drag stop 做 refresh 不足以保证 provider 零 resize。
  证据：首版纯移动回归在 Terminal 路径捕获到一条 `webview/resizeExecutionSession`（`64x23`）。增加 registry 级 drag-start/drag-stop 抑制窗口后，Agent 与 Terminal 两条纯移动回归均稳定为零 resize。

- 观察：完整 Webview 套件当前存在与本补丁无关的主线预期漂移和一次负载超时。
  证据：完整运行 353 条中 343 条通过、10 条失败；失败包括旧截图仍期待 `codex --timeout 300 --verbose`、tooltip 仍期待英文 `Canvas` 而当前文案为“画布”、quick-create 仍未期待 `clear-canvas`、旧 launch preset 仍期待当前已被判冲突的 default args，以及一次既有 Ctrl-Z 用例等待终端 ready 超时。本轮 4 条新增用例、15 条 resize 聚焦用例和后续全部 terminal journal/restore/zoom 用例均通过。

## 决策记录

- 决策：执行节点的自定义 resize 手势期间不调用 `FitAddon.fit()`，也不向宿主发送 PTY resize；手势结束后按最终 DOM 尺寸 fit 和提交一次。
  理由：本地外框草稿足以提供实时视觉反馈；字符网格每帧跟随会把纯 UI 草稿放大成 provider 进程可见的 `SIGWINCH` 风暴。
  日期/作者：2026-07-14 / Codex

- 决策：手势结束后的最终提交立即执行；只有非手势 `ResizeObserver` burst 使用 150ms trailing settle 合并，并对最后已上报的 `cols/rows` 去重。
  理由：明确的 pointer-up 已经提供稳定边界，不应额外增加用户可感知延迟；panel/sidebar 等外部几何变化没有明确结束信号，需要短窗口吸收布局抖动。150ms 足以跨越连续动画帧，又不会让普通窗口调整长期落后。
  日期/作者：2026-07-14 / Codex

- 决策：最终 fit/提交后以及纯节点移动结束后调用 xterm `refresh(0, rows - 1)`；纯移动不 fit、不上报尺寸。
  理由：`refresh` 只让本地 renderer 重画现有 buffer，不改变字符网格或通知 provider，可清理 canvas/WebGL 合成层的陈旧像素而不制造 TUI 重绘。
  日期/作者：2026-07-14 / Codex

- 决策：Agent 与 Terminal 共用同一个尺寸提交协调器，但保留现有两处节点初始化结构。
  理由：两类节点的时序约束完全相同，共享小型协调器可以避免去重和 timer 清理行为漂移，同时不把本轮扩大为执行节点整体重构。
  日期/作者：2026-07-14 / Codex

- 决策：不新增随 React render 传播的 `nodeResizeActive` 数据字段，改为在执行节点传给 `NodeResizeAffordance` 的 callback wrapper 中同步维护 ref。
  理由：`onDraftNodeLayout` 与 `onResizeNodeEnd` 就是手势的精确边界；同步 ref 可在 `ResizeObserver` 运行前生效，避免等待一次 React state/render 周期，也不扩大通用 `CanvasNodeData` 状态面。
  日期/作者：2026-07-14 / Codex

- 决策：纯位置拖动通过 `ExecutionTerminalRegistryEntry.beginNodeMovement/endNodeMovement` 显式抑制 fit/上报，drag stop 后下一帧才释放，并用 controller 做本地 refresh。
  理由：现场回归证明仅凭“位置理论上不改变 content box”不足以阻止浏览器 observer 通知；显式交互边界同时覆盖普通画布、Pane Gallery 和多选拖动。
  日期/作者：2026-07-14 / Codex

## 结果与复盘

实现已完成，并达到三条核心自动化验收：Agent/Terminal 在 resize 手势阶段均为零 PTY resize，pointer-up 后均只提交一条最终尺寸；纯位置移动均只产生 `webview/moveNode`，不产生 `webview/resizeExecutionSession`。普通外部几何变化通过 150ms trailing reporter 合并并按最后已提交尺寸去重。最终 fit 和位置 drag stop 都使用 non-destructive xterm refresh 收口本地画面。

验证结果为：`npm run typecheck` 与 `npm run build` 通过；`resize` 聚焦 Webview 15/15 通过；完整 Webview 343/353 通过，10 条失败均为当前主线既有截图、文案、菜单/default-args 预期漂移或一次就绪超时，本轮新增 4 条全部通过；trusted VS Code smoke 通过。完整失败证据保存在 `.debug/playwright/results/`，没有更新无关截图或测试期待来掩盖它们。

尚未把设计状态升级为“已验证”，因为本轮没有在真实 Codex/Claude 进程上人工执行来回 resize 并观察 provider 输出 journal。自动化已经直接证明 Webview 不再发送中间 resize，trusted smoke 证明 Host/Supervisor 主路径未破坏；真实 provider 人工观察可作为后续发布前验证。该缺口属于技术债 tracker 既有的“Webview UI 回归主要运行在浏览器 harness，真实容器覆盖偏窄”边界，本轮不新增重复条目。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx` 提供八向 `NodeResizeAffordance`。它在 pointer move 中通过 `onDraftNodeLayout` 发布 Webview 本地位置/尺寸草稿，在 pointer up 中通过 `onResizeNode` 持久化最终几何。`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 把草稿映射成 React Flow 节点的渲染尺寸，并把最终尺寸发给 Host；它也处理普通画布和 Pane Gallery 的节点 drag stop。`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 分别挂载 Agent/Terminal 的 xterm，`ResizeObserver` 观察 `.terminal-viewport`，`FitAddon` 把容器像素换算成字符列行，`onResizeExecution` 再把字符尺寸发给 Host。

这里的“PTY resize”是宿主把 `cols/rows` 交给伪终端进程的操作。对 Codex/Claude Code 这类全屏 TUI 来说，它通常会触发 `SIGWINCH` 和整屏 ANSI 重绘。“本地 refresh”是 xterm renderer 对当前 buffer 的重画，不写 PTY、也不要求 provider 生成新输出。“末值合并”是连续几何事件只保留最后一组字符尺寸，在 150ms 没有新变化后提交一次。

宿主 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 已对完全相同的 `cols/rows` 去重，但不同中间尺寸都是真实变化，不能由这层现有去重解决。`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 的 `process.resize()` 是正确的最终执行边界，本轮不改变协议、Host 或 supervisor 的有序 resize 语义，只减少 Webview 产生的无意义中间事件。

## 工作计划

实现没有扩展 `CanvasNodeData` 的持久状态字段，而是在 Agent/Terminal 传给 `NodeResizeAffordance` 的 callback wrapper 中同步维护 resize-active ref。通用 `NodeResizeAffordance` 现在确保有效 resize 在调用 `onResizeNode` 后也调用 `onResizeNodeEnd`，让执行节点能在 React 提交最终 DOM 后安排一次 flush。

然后在 `executionSessionNodes.tsx` 增加共用的尺寸报告协调逻辑。每个执行节点用 ref 读取最新手势状态，并暴露一个“最终确定尺寸”的 ref 回调。`ResizeObserver` 在手势中直接忽略；非手势变化安排 `requestAnimationFrame` fit，再把有效尺寸交给 150ms trailing coordinator。最终收尾回调取消普通 pending 提交，在 DOM 更新后的 animation frame 中 fit，立即去重上报，并在下一帧 refresh。卸载时取消所有 frame/timer。

接着在 `main.tsx` 和 `executionTerminalTypes.ts` 增加 registry 级移动边界。普通画布和 Pane Gallery 的 drag start 都把主节点、React Flow 返回的 dragged nodes 与本地补齐的多选节点进入 movement-active；drag stop 释放抑制并本地 refresh。整个路径不调用 fitAddon 或执行 resize postMessage。

最后在 `tests/playwright/webview-harness.spec.mjs` 用真实 resize handle 指针操作覆盖 Agent/Terminal：移动阶段检查零 resize 消息，pointer-up 后检查只有一个最终消息，等待超过 settle window 后数量仍为一。再覆盖执行节点纯位置拖动只产生 move 消息。完成自动化验证后更新本文档和正式设计状态。

## 具体步骤

所有命令从仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8` 执行：

    npm run typecheck
    npm run build
    npm run test:webview -- --grep "final terminal resize|does not resize the provider terminal"
    npm run test:webview -- --grep "resize"
    npm run test:webview
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs

如果测试名称受 Playwright wrapper 的参数传递方式限制，先运行 `npm run test:webview -- --help` 或直接使用 package script 对应的 Playwright 命令；必须把实际命令写回本节。真实宿主 smoke 若因当前机器环境而不能运行，需记录具体原因，不能把未执行写成通过。

## 验证与验收

自动化验收必须同时覆盖 Agent 和 Terminal。节点处于 live execution fixture 且 attach snapshot 已应用后，连续拖动右下 resize handle 至少经过十个中间位置；mouse/pointer 尚未释放时，posted messages 中没有 `webview/resizeExecutionSession`；释放后最终只出现一条该节点/类型的 resize 消息，且最终 `cols/rows` 与开始值不同；等待至少 300ms 后仍只有一条。纯节点移动测试必须观察到 `webview/moveNode`，同时没有 `webview/resizeExecutionSession`。

类型检查与构建必须通过。完整 Webview 测试应通过；若存在与本补丁无关的既有失败，要保存失败名称与证据并明确区分。可运行时，trusted VS Code smoke 应证明 Host/Supervisor 的正常执行会话路径没有被破坏。人工复现可在正在输出的 Claude/Codex 节点上缓慢、来回 resize：外框实时变化，手势中 TUI 不随每帧重排，松手后按最终宽高重排一次；单纯拖动节点位置不应让 TUI 自己重绘。

## 幂等性与恢复

文档、类型与测试补丁都可重复运行。协调器必须在组件卸载时取消 timer/frame，避免节点删除后提交旧 resize。测试 fixture 每次自行 bootstrap 并清理 posted messages，不依赖上一用例状态。若实现中途失败，保留当前工作树并用 `git diff` 定位本轮变更；不要使用破坏性 reset。Host/Supervisor 协议没有迁移或持久化变化，因此不存在数据回滚步骤。

## 证据与备注

现场证据来自：

    /home/users/ziyang01.wang-al/projects/dev-session-canvas/.debug/current-host-diagnostics/2026-07-14T06-19-52-773Z
    node: workspace-root-cc6ccbc9c9d2fa82:agent-5-096129e7-8bfd-4fbd-95aa-5be064440908
    session: 89faf3d7-5147-442a-adad-e7719369bed5
    revisions 1197--1246: 27 resize records, at least 29 full-screen repaint frames

该证据只用于证明 resize/TUI 重绘因果，不把本机绝对路径当作测试依赖。最终验证摘要：

    npm run typecheck                                                        PASS
    npm run build                                                            PASS
    npm run test:webview -- --grep "final terminal resize|does not resize" 4 passed
    npm run test:webview -- --grep "resize"                                 15 passed
    npm run test:webview                                                     343 passed, 10 unrelated failures
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node ...                PASS

## 接口与依赖

在 `executionSessionNodes.tsx` 中，协调器接收一个 `(cols, rows) => void` 提交函数，提供 trailing `schedule`、立即 `flush`、snapshot 基线 `acknowledge` 与 `dispose` 行为；只提交正尺寸，并与最后已提交或 Host snapshot 已确认的值去重。Agent/Terminal 的最终 fit 回调通过 ref 连接到传给 `NodeResizeAffordance` 的包装 `onResizeNodeEnd`，但继续调用原始全局 `data.onResizeNodeEnd`，不能破坏 auto-pan 清理。

`executionTerminalTypes.ts` 的 registry entry 提供 `beginNodeMovement()` 与 `endNodeMovement()`。`main.tsx` 在普通画布和 Pane Gallery 的 drag start/stop 调用它们，本地 refresh helper 接受只读 node id 集合并在 animation frame 中调用 controller 的 `refreshVisibleRows()`；它不得调用 `fitAddon.fit()` 或 `onResizeExecution`。

计划更新说明（2026-07-14）：创建时写入现场证据、正式实现边界、150ms settle 决策和端到端验收口径；完成时补记 callback-wrapper 实现调整、纯移动 observer 发现、registry 抑制方案、完整验证证据与主线无关失败，并移入 completed。
