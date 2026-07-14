---
title: 执行终端尺寸合并与重绘边界
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/execution-terminal-resize-coalescing.md
updated_at: 2026-07-14
---

# 执行终端尺寸合并与重绘边界

## 1. 背景与问题

Agent 与 Terminal 节点同时存在两种“尺寸”：画布节点的像素外框，以及 PTY/xterm 的字符网格 `cols/rows`。画布 resize 的 pointer move 是 Webview 本地交互草稿；PTY resize 则是 provider 进程可见的运行时事件。两者若逐帧绑定，用户拖动一个外框就会向 Codex 或 Claude Code 连续发送多个真实尺寸变化。

2026-07-14 的现场诊断显示，一个 Claude Agent 在约 50 个 journal revision 内接收了 27 个不同 resize，几乎每个 resize 后都输出由 `ESC[H` 与重复 `ESC[2K` 组成的全屏重绘帧，至少 29 帧。Host output revision 单调、panel attach/render 生命周期正常，因此画面中的重复回答片段不是消息重复投递，也不是 Claude 重复生成回答，而是快速尺寸变化暴露了全屏 TUI 的中间重绘帧。

## 2. 目标与非目标

本设计要让执行节点继续提供实时外框 resize 预览，同时把 provider 可见的 PTY resize 收口到稳定的最终字符尺寸；也要让纯位置拖动只修复本地 renderer 可能出现的陈旧像素，不通知 provider。

本轮不改变 terminal journal 中 resize 作为有序事件的语义，不修改 Host/Supervisor 的 PTY 能力，不阻止 Codex/Claude 在一次真实最终 resize 后正常重排，也不承诺消除 provider 自身输出的所有 ANSI 重绘帧。

触屏多节点并发交互同样不是本轮目标：当前 multi-touch 防护只覆盖两个触点位于同一 `NodeWrapper` / 单一 draggable surface 的取消场景；多个独立 `NodeWrapper` 或多个节点同时接收触点时，不承诺 drag stop disposition、位置回滚或 Host 位置提交语义。未来只有出现明确的触屏用户需求时，才为跨节点触控单独设计状态模型、交互语义与自动化验收。

## 3. 正式方案

### 3.1 自定义 resize 手势期间冻结字符网格

`NodeResizeAffordance` 继续逐帧发布 Webview 本地节点位置/尺寸草稿，React Flow 继续实时显示外框变化。Agent/Terminal 在包装后的 `onDraftNodeLayout` / `onResizeNodeEnd` 回调中同步维护 active ref；处于 active 状态时，其 `ResizeObserver` 不运行 `FitAddon.fit()`，也不调用 `onResizeExecution`。现有 xterm 投影保持手势开始前的字符网格；容器变大时会暂时出现留白，变小时由容器裁切，这是刻意接受的短暂预览状态。

pointer-up 或取消为明确的手势结束边界。有效 resize 必须在最终节点草稿收口后触发执行终端 finalize：按最终容器 fit 一次、立即去重提交最终 `cols/rows`，然后安排一次 xterm `refresh(0, rows - 1)`。取消或无变化同样可以 finalize，但尺寸去重保证不会产生无意义的 PTY resize。

### 3.2 非手势布局变化做末值合并

Panel 宽高、sidebar、字体度量或其他非节点手势几何变化没有可靠的 pointer-up 边界。对应 `ResizeObserver` 可以 fit 本地 xterm，但向 Host 的尺寸提交使用 150ms trailing settle：窗口内的新尺寸替换旧 pending 值，只在稳定后提交最后一组。最后已提交的 `cols/rows` 被显式记录，相同尺寸不重复发送。

这个时间窗只是 Webview 的流量整形，不改变 Host/Supervisor 收到后对 resize 的有序处理。明确的节点 resize finalize 不等待 settle window，以免给用户增加松手后的可见延迟。

已经完成本地 fit、但仍处于 settle window 内的 pending 尺寸属于合法工作，后续节点移动不能清除它。移动开始前已排队的 fit frame，以及 serialized snapshot restore 的延迟 shrink fit 也遵守同一规则：movement gate 可以阻止移动期间新产生的 observer 噪音，但不能销毁更早形成的真实尺寸工作。

### 3.3 纯位置拖动使用门禁、去重 reconciliation 与本地 refresh

节点位置变化不改变 `.terminal-viewport` 的逻辑像素尺寸，因此纯移动不应发送 `webview/resizeExecutionSession`。浏览器仍可能在 React Flow 拖动/选中布局期间发出 `ResizeObserver` 通知，所以普通画布与 Pane Gallery 都在 drag start 通过 terminal registry 显式进入 movement-active，忽略这段时间新产生的 observer fit/上报，但保留移动前的 pending/deferred 工作。

drag stop 下一帧释放门禁并调用 `executionSessionNodes.tsx` 中的 `fitTerminal()` 做一次 reconciliation：先读取最终容器的 proposed dimensions，只有字符尺寸确实不同才调用 `FitAddon.fit()`，再把结果交给 150ms reporter 去重。对普通纯移动，proposed dimensions 与当前字符网格相同，因此不会 fit，也不会通知 PTY；若移动前已有合法 pending resize 或 snapshot shrink fit，则 reconciliation 保证它最终提交。`main.tsx` 仍对本次移动的 Agent/Terminal（包含多选共同移动节点）安排一次本地 xterm refresh；refresh 只重画当前 buffer，用于清理浏览器 canvas/WebGL 合成后可能残留的旧像素，不会触发 PTY `SIGWINCH`，因而不会要求 Codex/Claude 自己重绘。

movement gate 的生命周期不能只依赖 React Flow 的 `onNodeDragStop`。`main.tsx` 同时记录本轮所有画布移动节点和其中已注册的执行终端；`pointercancel`、lost pointer capture、窗口 blur、document hidden 和鼠标离开窗口都进入同一个幂等 abort。abort 会对 active terminal 调用 `endNodeMovement()`、清除未提交的位置草稿并安排本地 refresh/reconciliation；它只恢复 Host 权威位置，不发送 `webview/moveNode`。如果 React Flow 之后又交付迟到的 drag stop，aborted 标记会消费该 stop，避免把已取消草稿误提交给 Host。

在当前支持的同一 `NodeWrapper` / 单 draggable surface 场景内，多指 abort 还必须处理 capture/target 事件顺序：第二个 `touchstart` 在 window capture 阶段先把当前 touch sequence 标记为已取消，但真正 finalize 安排在该事件传播完成后的 microtask。`beginExecutionTerminalNodeMovement()` 在 lockout 有效期间拒绝同一 surface 上该触摸序列后续的 `onNodeDragStart`，所以 React Flow/d3 的 target listener 不能重新打开 terminal gate 或取消 release frame。只有 `touchend` / `touchcancel` 观察到 `touches.length === 0` 后，lockout 才在事件传播后的 microtask 解除，下一次物理手势才能建立新的 movement 生命周期。

这个 lockout 不定义跨 `NodeWrapper` 的并发拖拽语义。多个触点分别落在不同节点时，React Flow 可能为每个 wrapper 建立独立 drag lifecycle 并按各自时序交付 stop；当前全局 abort latch 不提供按 node、surface 或 gesture generation 隔离的 stop disposition。该边界不属于本轮缺陷修复的支持范围，也不能从“完整 touch sequence”推导为已支持；后续若要支持，必须先明确多节点位置提交、取消顺序和 Host 权威状态的产品语义。

## 4. 与既有设计的关系

本方案延续 `canvas-node-surface-and-resize.md` 的既有结论：pointer move 中的节点几何只是 Webview 本地草稿，只有最终位置和尺寸进入宿主权威状态。新增约束是：对执行节点而言，PTY 字符网格也不能把本地草稿误当作逐帧权威变化。

本方案也延续 `embedded-terminal-runtime-window.md` 对 destructive fit 与 non-destructive redraw 的区分。`fit()` 只用于真实稳定的容器尺寸变化；纯移动、visibility restore 等不改变字符网格的路径使用 `refresh()`。最终 PTY resize 仍是运行时有序事件，不能在 Host 或 supervisor 中任意丢弃。

## 5. 风险与取舍

- 取舍：resize 手势期间字符网格不会填满每一帧外框。这样牺牲短暂的“内容实时铺满”，换取 provider 不被迫连续全屏重排；外框仍实时响应，松手后内容立即对齐最终尺寸。
- 风险：150ms settle 可能让外部容器 resize 后的 PTY 尺寸短暂落后。缓解方式是本地 xterm 可先适应稳定容器，只有 provider 通知延后；窗口足够短，并且每次只保留末值。
- 风险：React 状态收口与 DOM 尺寸提交可能跨 animation frame。缓解方式是通过明确的 `onResizeNodeEnd` finalize 信号，在最终草稿移除后的 frame 才读取容器并 fit。
- 风险：位置拖动可能与 settle window 或 serialized restore grace 交错。movement gate 不取消移动前工作，并在 drag stop 后重新测量；尺寸 reporter 去重保证纯移动仍为零 PTY resize。
- 风险：依赖库在窗口失焦、丢失 mouseup 或多指 abort 时可能不调用 `onNodeDragStop`；同一 `NodeWrapper` 上的第二个触点还可能在 capture abort 后触发一次 target drag-start。独立窗口/指针生命周期监听负责幂等 abort，touch-sequence lockout 阻止当前支持场景中的同 surface 手势重新 begin，迟到 stop 只消费取消标记，不提交移动。跨 `NodeWrapper` 的多个独立 stop 不在当前支持范围，现有全局 abort latch 不承诺隔离其先后消费关系。
- 风险：本地 refresh 只能修复 renderer 陈旧像素，不能修复 provider buffer 本身已经被错误 resize 的内容。核心预防仍是阻止中间 PTY resize，而不是依赖 refresh 掩盖问题。

## 6. 验证口径

Playwright 必须对 Agent 与 Terminal 各执行一次多步 resize：指针移动但未释放期间没有 `webview/resizeExecutionSession`；释放后只有一条最终 resize；等待超过两倍 settle window 后仍只有一条；最终尺寸与起始尺寸不同。稳定基线上的纯节点移动必须产生 `webview/moveNode` 且不产生执行会话 resize。

交错回归还必须覆盖两类节点：外部几何变化已经完成本地 fit、但 150ms pending 尺寸尚未提交时立即移动节点，最终必须恰好提交一次该稳定末值；serialized snapshot 的 shrink-fit grace 内移动节点，延迟 refit 与最终尺寸上报也必须继续完成。这两类场景共同证明 movement gate 只隔离移动噪音，不丢失移动前的真实尺寸工作。

取消回归必须对 Agent 与 Terminal 先用真实 mouse drag 触发 movement-active，再只派发 `pointercancel` 而不依赖 React Flow stop。随后改变容器宽度时，本地 xterm 与 PTY resize 必须恢复；即使迟到的 `mouseup` 最终到达，也不得发送 `webview/moveNode`，节点渲染位置应回到 Host 权威值。

多指回归必须运行在 `hasTouch: true` 的浏览器 context，并只验证当前支持的单 `NodeWrapper` / 单 draggable surface：第一触点真实进入节点拖拽后，第二触点落到同一节点的 draggable surface，随后发送双指 move 与 cancel。取消后本地 xterm/PTY resize 必须恢复、`webview/moveNode` 为零、节点位置恢复；这直接验证同一 wrapper 的第二次 target drag-start 不能越过 touch-sequence lockout。该验收不覆盖触点分别落在多个独立 `NodeWrapper`、跨 Pane Gallery surface 或多节点并发拖拽；这些交互没有当前产品承诺。

类型检查、构建和 resize 聚焦 Webview 回归必须通过；完整 Webview 回归用于同时识别相关回归与当前主线无关失败，不能用更新无关快照/期待来掩盖失败。可运行时补 trusted VS Code smoke，确认最终尺寸仍能进入 Host/Supervisor。真实宿主人工观察应满足：慢速或来回拖动执行节点外框时，Codex/Claude 不再逐帧重绘；松手后只针对最终宽高重排一次；只移动节点位置时 provider 不重绘。

## 7. 当前验证状态

实现与自动化验证已完成：Agent/Terminal 的连续 resize、稳定纯移动、pending resize 交错、serialized snapshot shrink grace、mouse/pointer 取消和同一 `NodeWrapper` 的 multi-touch 取消路径均已覆盖；`hasTouch: true` 同节点第二触点回归 2/2、与既有 mouse abort 合并回归 4/4、正常纯移动与 pending resize 合并回归 4/4 通过，类型检查与构建通过。跨 `NodeWrapper` / 多节点并发触控未实现、未验收，也不属于当前支持范围。更新后的 resize 聚焦首轮 17/19，两个失败分别停在无关连线/文件节点用例的 harness 等待阶段，隔离原样复跑均通过；相关 execution 用例合并运行 9/10，唯一失败为首条 Agent 用例等待 RAF 超时，隔离复跑通过。初始 PR head 的 trusted VS Code smoke 通过；完整 Webview 套件 343/353 通过，10 条失败为当前主线既有截图、文案、菜单/default-args 期待漂移或一次就绪超时。由于尚未在真实 Codex/Claude 进程上人工观察来回 resize，仍保持 `validation_status: 验证中`，完成记录见 `docs/exec-plans/completed/execution-terminal-resize-coalescing.md`。
