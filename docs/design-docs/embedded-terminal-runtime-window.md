---
title: Terminal 节点嵌入式会话窗口设计
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
  - docs/exec-plans/completed/embedded-terminal-runtime-window.md
  - docs/exec-plans/completed/execution-session-platform-compatibility.md
  - docs/exec-plans/active/runtime-terminal-state-restore.md
  - docs/exec-plans/completed/terminal-output-flood-input-responsiveness.md
  - docs/exec-plans/active/execution-input-responsiveness.md
  - docs/exec-plans/completed/runtime-recovery-projection-isolation.md
updated_at: 2026-08-12
---

# Terminal 节点嵌入式会话窗口设计

> 2026-08-12 收口说明：本文关于本地 PTY、xterm 原生交互、resize、链接与 live output 背压的结论继续有效；其中 Host monolithic snapshot、旧 registry/raw-tail fallback、全局 restore queue 和旧 input completion 边界只记录当时实现，不再代表当前 Supervisor 路径。Supervisor restart 的空 namespace、同 instance Window Reload 的 surface-local bulk projection、fixed-socket input dispatch、control/lifecycle 隔离与 completed history archive/ref 以 [运行时控制面、显示投影与恢复隔离](./runtime-control-and-projection-isolation.md) 和 [Agent / Terminal 无损输入输出与恢复](./agent-terminal-lossless-io-and-recovery.md) 为准。

## 1. 背景

当前仓库已经实现了 `Terminal` 节点的第一版“宿主终端代理节点”原型：节点能创建、显示和重连 VSCode 原生终端，但真实终端并不在画布内，节点本体只是状态与跳转入口。

这条路线验证了宿主状态回流，却没有对齐当前产品的核心语义。用户要的不是“在画布里放一个跳转器”，而是“把终端窗口本身放回画布里”。

## 2. 问题定义

本轮需要回答的问题是：

1. `Terminal` 节点的正确产品定义到底是什么。
2. 真正可交互的嵌入式终端，当前应该走哪条宿主后端路线，才能在实现风险和产品目标之间取得平衡。
3. 哪些状态必须留在宿主侧，哪些只需要作为 Webview 内的运行时表现，不应被误写成可永久恢复能力。

## 3. 目标

- 把 `Terminal` 节点重新定义为画布中的终端会话窗口，而不是 VSCode 原生终端的代理卡片。
- 让主要输入、输出、滚动和聚焦行为都在节点内部完成。
- 保持宿主权威状态、节点摘要和恢复边界清晰，不把短期内做不到的恢复能力伪装成已完成。

## 4. 非目标

- 不在本轮像素级复刻参考产品的全部终端视觉细节。
- 不在本轮承诺跨扩展重载恢复完整活动终端 buffer。
- 不在本轮把 Windows 写成“完全没有已知限制”的稳定支持；即使主路径已验证可用，剩余差异也必须继续显式记录。

## 5. 候选方案

### 5.1 继续使用 VSCode 原生终端代理节点

特点：

- 真实 shell 仍跑在 VSCode 原生终端。
- 节点只显示摘要、状态和跳转动作。

不选原因：

- 这条路线的产品语义已经偏了。它验证了“能不能打开终端”，却没有验证“终端是否真正属于画布”。
- 用户的主要操作仍发生在画布外，不符合当前明确目标。

### 5.2 `xterm.js + node-pty`

特点：

- Webview 里用 `xterm.js` 渲染终端。
- 宿主侧用 `node-pty` 创建真实 PTY。

优点：

- 是最常见、最标准的嵌入式终端组合。
- 后续跨平台能力理论上更完整。

当前选择原因：

- 现在用户已经明确要求 Linux / macOS 优先，同时希望 Windows 尽量兼容；继续围绕 `script` 扩展只会放大平台分叉。
- 当前扩展构建目标已经是 `node18`，而 `node-pty` 也提供了多平台预编译产物，足以支撑这轮统一 PTY 收口。

### 5.3 `xterm.js + script PTY bridge`

特点：

- Webview 里仍用 `xterm.js` 渲染真正的终端前端。
- 宿主侧不再依赖原生 Node 模块，而是通过系统自带的 `script` 命令为 shell 分配 PTY。

当前不继续沿用的原因：

- 它适合作为 Linux 原型，但不适合作为 Linux / macOS / Windows 的统一长期主线。
- 运行中 resize、停止语义和平台错误处理都会被迫继续分叉。

## 6. 正式方案

当前收敛结论如下：

- `Terminal` 节点的正确产品定义是“画布中的终端会话窗口”。
- 主交互必须留在节点内部，而不是继续依赖 VSCode 原生终端。
- 当前实现路线选择 `xterm.js + node-pty`：
  - Webview 使用 `xterm.js` 渲染终端前端；
  - 宿主用统一 PTY bridge 启动真实 shell，并通过消息桥传递输入输出。
- Linux、macOS、Windows 本地主路径都已完成当前轮功能可用性验证。
- Windows 下使用 `Codex` 时，执行节点内历史当前仍存在无法向上翻页的已知限制；这条差异继续作为 `Preview` 已知问题保留。

为避免把不同生命周期混成一句“恢复”，这里额外固定三层术语：

- `保活隐藏`
  - Webview 只是因为标签切换而暂时 hidden，但原实例仍被 `retainContextWhenHidden` 保活。
  - 这一路径不应丢失 live xterm、输入焦点与滚动历史；恢复动作只允许做 non-destructive redraw，不应借机重算并改写当前 viewport 行数。
- `同宿主重建`
  - Webview 真的被 dispose 后又 recreate，但 extension host / runtime supervisor 仍活着。
  - 这一路径必须从宿主权威 terminal state 恢复，而不是退回 raw output tail replay。
- `跨宿主恢复`
  - VS Code reload、extension host 重启，或需要重新从 supervisor / 持久化快照恢复状态的场景。
  - 这一路径仍以宿主记录的 terminal state 为恢复源，只是数据来源可能从内存换成落盘快照或 live-runtime supervisor。

同时必须明确记录两个边界：

- Panel `WebviewView` 与 Editor `WebviewPanel` 两条主承载面路径现在都显式启用 `retainContextWhenHidden`，把同一宿主标签切换下的 Webview 保活视为体验优化，而不是唯一正确性前提。
- 活跃会话的宿主权威恢复源不再只是最近一段 raw output tail，而是摘要、最近输出、尺寸与可序列化 terminal state 的组合；其中 `recentOutput` 只保留给摘要与兼容 fallback，不再承担画面恢复职责。
- live xterm、宿主 `SerializedTerminalStateTracker` 与落盘快照现在统一对齐 `terminal.integrated.scrollback`，不再分别硬编码 `4000` / `80`。当前不使用 `terminal.integrated.persistentSessionScrollback` 去主动缩小画布侧 snapshot，因为这会直接损失用户切回画布后可继续上滚的 live 历史。
- Webview 隐藏再显示时，现存 xterm 会显式执行 non-destructive redraw，不再在这条保活路径上主动 `fit()` 改写行数；如果 Webview 被销毁并重建，则应按宿主 snapshot 中的 serialized terminal state hydrate，再继续接 live output。
- 执行节点的滚动语义必须保持和标准终端一致：用户一旦向上滚动进入历史查看，增量输出、spinner/redraw、主题刷新与 visibility redraw 都不应主动 `scrollToBottom()`；只有用户自己回到底部，或显式触发“滚到底部”命令时，视图才恢复跟随最新输出。
- 当前恢复语义面向“尽量保住与 live xterm 对齐的 scrollback 历史”；仍不额外承诺用户手动滚到任意 scrollback 位置后的 viewport 也能跨重建精确复原。
- 运行中 resize 现在通过 PTY 后端原生能力处理，不再通过 stdin 注入 `stty`。
- PTY 原生 resize 只承载稳定、真实的字符网格变化：执行节点 resize 手势中的 Webview 外框草稿不得逐帧发送给 PTY；手势结束后提交最终尺寸，其他容器几何 burst 合并为末值。纯位置拖动只允许本地 non-destructive `refresh()`，不得借机 fit 或触发 Codex / Claude 自己的全屏重绘；详细方案见 `docs/design-docs/execution-terminal-resize-coalescing.md`。
- 高频输出现在也属于正式运行时边界的一部分：宿主侧增量输出允许继续按小时间窗批量合并，但不能把大批 `host/executionOutput` 无让步地一次性塞入 Webview 消息队列。Host 普通 output 先进入 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 output scheduler，由 scheduler 按短 tick 分批 post；`host/executionInputAck`、error、snapshot、exit 和状态类控制消息不进入该 output scheduler，保证输入 ACK 不再被 output flood 排在后面。用户输入发生后的短窗口内，Host output scheduler 只优先释放最近输入节点的 output，其他节点最多等待固定上限后逐步释放，避免后台 Agent 被长期饿死。Webview 仍不得在 `window.message` 回调里同步广播到所有执行节点并立刻 `terminal.write()`；标准做法是按节点维护独立输出控制器，把连续 `host/executionOutput` 先入队，再以异步批量 drain 写入 `xterm.js`，让输入与画布交互始终有机会先进入主线程。多节点持续输出时，drain 必须带全局每帧字符预算、每 controller 小块预算和 xterm queued write 背压；重新排队时，未处理 controller 必须排在已处理但仍有剩余 output 的 controller 前面，避免前几个持续高输出节点反复占满每帧 controller 预算，导致后续 Agent 长时间看不到最新输出。用户输入发生后的短窗口内，Webview 输出只能小块推进，并优先推进刚输入节点的回显，避免其他节点的大块输出继续占满 xterm parser 队列。普通 live attach snapshot 在同一 Webview mount 内不得重复请求；多个执行节点的 serialized snapshot hydrate 不应同帧并发写入 xterm，而应进入全局恢复队列，最近输入节点优先，其余节点按短间隔错峰恢复。最近输入发生后，snapshot hydrate 必须先让出短窗口，但要有等待上限，不能因为持续输入永久不恢复 Host snapshot。Webview hidden 或刚从主线程 lag / visibility restore 恢复时，不应一次性回放 backlog，而应暂停或进入小预算 recovery；若单节点 Webview pending raw output 已超过安全阈值，则不能盲目截断后继续写原 xterm，而必须清空 Webview 待渲染 backlog、请求 Host serialized terminal snapshot 重建显示，再按 `outputSequence` 只重放 snapshot 之后的新 output。当前阈值区分可见与隐藏场景：visible / lag recovery 仍按 512KB 单节点 backlog 触发，`document.hidden` 时提前到 128KB，避免用户切回画板时才承担后台积压的 raw replay 成本；若单节点 pending raw output 无论可见性或 lag 状态已经达到 1MB，则直接触发 hard backlog snapshot reset，避免 VSIX packaged-payload /真实极端 flood 场景在常规恢复窗口之外继续累计 raw replay。snapshot reset 必须有 request id、超时重试和等待期预算：Host snapshot 应带回 request id 与 execution session id；Webview 等待 snapshot 时的 deferred output 不能无界增长，超过预算后应推进 reset 边界并重新请求 Host snapshot，而不是把 MB 级 backlog 从 raw pending queue 转移到 deferred queue。仍在运行的 reset snapshot 若缺少 `outputSequence`，不能作为有序 reset 边界应用，只能记录诊断并等待 sequenced snapshot 或 timeout retry；已结束会话的无序 snapshot 可以作为最终画面收口，但不得重放等待期 live output。若会话在 reset 等待期退出，Webview 必须清空 reset 状态并显示 exit，后到的旧 reset snapshot 只能被诊断为 stale 并忽略。
- snapshot hydrate 会临时重放宿主保存的 xterm 状态；这期间 `terminal.reset()`、`terminal.write(snapshot)` 和 snapshot 内的 escape sequence 可能触发 xterm selection、mouse tracking 或 OSC 52 hook。它们是恢复副作用，不应污染“用户是否选择/复制”的 clipboard 诊断。Webview 必须只在显式 restore 窗口内抑制 `selectionChange`、`mouseTrackingMode` 和 `osc52` 原始诊断，并在 restore 完成后的短帧窗口继续吸收 xterm 延迟派发的同类事件，随后上报 `restoreSuppressed` 聚合计数；下一次真实 output/input/exit 写入开始前必须先刷新该聚合，避免抑制跨越到用户路径。真实用户动作相关的 `shortcut`、`contextMenu`、`mouseSelection`、copy/paste 请求与环境诊断不得被该机制吞掉。
- 2026-06-10 起，卡顿现场的第一步收敛为诊断而不是继续猜测。`Dev Session Canvas: 落盘当前宿主诊断` 必须写出 `execution-performance-diagnostics.json`，并在 `summary.json.diagnostics.executionPerformanceSummary` 中内嵌摘要。样本来源覆盖 Webview 侧输出入队、批量 drain、单次 `xterm.write`、snapshot restore queue、backlog snapshot reset、输入 `postMessage` 分发、输入 ack 往返、Webview 主线程 timer lag、Host event-loop timer lag、Host 侧输入到达、Host 侧输入写入、Host 侧输出 chunk 处理、Host output scheduler、输出投递和状态持久化；样本只记录节点、类型、耗时、字符/字节数、队列/缓冲长度、owner、生命周期、sequence、request id、execution session id 与成功/失败，不记录完整终端内容。
- 2026-06-11 的现场诊断显示 file-link resolve 已完全退出热路径，但 `workspaceState.update` 在多 Agent 输出期间形成高频慢任务。因此 live execution state 的常规持久化必须按“交互优先”处理：内存权威状态和 Webview state 仍立即更新，主快照文件与 root-local snapshot 继续写出；`workspaceState.update` 不再进入活跃执行会话期间的热路径，只在没有活跃 Agent / Terminal 会话时作为兼容 fallback 更新。当前策略使用短 debounce 与 max wait 合并 live execution state，并在 active session 期间用 `workspaceStateMode: "skip"` 记录跳过；生命周期边界、停止、挂起、等待输入、恢复确认、宿主边界、测试 reload 与诊断 dump 仍必须保证主快照 flush。
- 延迟持久化不能牺牲恢复正确性。若首个 `host/executionOutput` 到达时，对应会话的启动快照仍未安全写出，Host 必须把该输出标为 `persisted: false`；Webview controller 必须缓冲 chunk 而不是丢弃或写入 xterm，等 Host 写完快照后用 `persisted: true` 释放缓冲。这样用户不会看到一个宿主尚无法恢复的“幽灵输出”，也不会因为持久化栅栏丢失首个 output chunk。
- Host 侧用于恢复和链接上下文的 headless terminal 处理也不应与用户输入竞争。`SerializedTerminalStateTracker` 与 `ExecutionTerminalLineContextTracker` 对连续 output 使用短时间窗批处理和固定 chunk 拆分；`flush()`、`resize()`、`setScrollback()`、输入记录和链接 cwd 查询这类正确性边界必须先 drain pending write，保证恢复快照、尺寸变化和文件链接上下文仍按顺序可用。常规 live output state sync 默认只更新权威状态和持久化快照，不再强制向 Webview 广播整份 `host/stateUpdated`；只有输入提交、生命周期边界、immediate persist 或无活跃执行会话时才推送完整状态。
- serialized terminal state 不是独立权威数据；它必须携带与 raw output 相同的 `outputSequence`，且只有序号与 snapshot 边界一致时，Host / runtime supervisor / Webview 才能把它作为恢复源。若历史 state 缺少序号，或序号落后于 raw output，则必须回放 raw output 重建 headless terminal state，而不是依赖 resize、visibility redraw 或 TUI 自发重绘来“补齐”画面。旧 supervisor 返回的无序 snapshot 只能作为不可信 fallback；Host 不得把 `snapshot.output` 这类 6000 字符 raw tail 重新喂给 tracker 并打上当前 `outputSequence` 后当成权威 serialized state，因为 tail 可能从 ANSI/TUI 控制序列中间开始。对于这种不可信会话，raw tail 只保留为摘要、历史文本或临时显示 fallback，不能持久化、回包或从 metadata 回填为新鲜 `serializedTerminalState`。但当前 supervisor 的 live `sessionState` 也可能因为 tracker 批处理而短暂缺少新鲜 serialized state；若 Host 已经持有同一 runtime session 的可信 tracker，这类 transient stale state 只能更新生命周期与元数据，必须保留现有 tracker，不能把可信会话降级成旧 raw-tail fallback。
- `host/executionInputAck` 只用于测量 Webview 到 Host 再回 Webview 的消息桥往返。它不表示输入已经写入 PTY，也不得触发本地 echo、乐观回显或状态变更；真实终端反馈仍必须来自 Host 写入后的 PTY / supervisor 输出。ACK 需要携带 Host 生成时间、Host post 时间和当时 output scheduler 的 backlog 状态；分析卡顿时，`webview-input-ack.durationMs` 是同一 Webview 时钟内的用户可感知主指标，`host-input-received.queueDelayMs` 只作为跨时钟参考。
- `host/executionOutput.outputSequence` 与 `host/executionSnapshot.outputSequence` 是 Webview backlog reset 的顺序边界，不是用户可见内容。Host 每次收到 PTY / supervisor output chunk 时递增或采纳 supervisor 提供的单调序号，之后投递 output 与 snapshot 都必须带同一 session 下不回退的序号；runtime supervisor 的 sessionOutput、snapshot、registry 恢复和 Host live execution metadata 都要保留该序号，reattach 时以已持久化 metadata 为 floor，避免旧 registry 或 Host session 重建把序号重置到 0。Webview 丢弃旧 raw backlog 后请求 snapshot，snapshot 序号之前的旧 output 不得再写入 xterm，snapshot 序号之后已经收到的新 output 只能在 snapshot hydrate 完成后重放。`webview/attachExecutionSession.requestId` 与 snapshot 回包的 `requestId` 用于确认 reset 请求是否完成；`executionSessionId` 用于区分同一节点的新旧执行会话，避免新会话低序号 output 被上一轮 reset 边界误判为 stale。reset attach request 可携带同一 session 的 `minOutputSequence`，Host 只能在 session id 匹配时把 snapshot 序号提升到该边界，不能跨 session 复用。reset 已清空或 session 已结束后，带 `snapshot-reset-*` request id 的迟到 snapshot 不应覆盖当前终端画面。
- 生产 Webview bundle 必须使用 `@xterm/xterm/lib/xterm.js` 作为浏览器端打包输入；`scripts/build/build.mjs` 通过 `xterm-browser-main-entry` esbuild plugin 只重定向裸导入 `@xterm/xterm`，不影响 `@xterm/xterm/css/xterm.css`。当前不使用 xterm 的 ESM `module` 入口作为生产打包输入，因为在本仓库的 esbuild production minify 组合下，`@xterm/xterm@6.0.0` ESM 入口里的局部 `const enum` 降级代码会被压成未声明变量，遇到 Vim / glab 等 TUI 发送 `DECRQM`（例如 `CSI ? 12 $ p` 查询光标闪烁模式）时会在 Webview 侧抛 `ReferenceError`，从而中断 xterm parser。宿主 `extension.js` 与 `runtime-supervisor.js` 仍可继续使用各自 Node bundle 的解析规则；这个约束只针对浏览器 Webview bundle。

## 7. 风险与取舍

- 取舍：当前接受原生 PTY 依赖，换取 Linux / macOS 主路径收口，并让 Windows 进入同一后端模型。
  原因：平台兼容性已经成为当前用户目标的一部分，继续保留 `script` 只会让平台能力和运行时模型一起分叉。

- 风险：如果 Webview 重建时仍靠 raw tail replay，`Codex`、`Claude Code` 这类 alternate-buffer / 全屏重绘型 CLI 会出现上半部分空白或只剩底部尾巴。
  当前缓解：local PTY 与新 supervisor 两条路径都维护带 `outputSequence` 的 serialized terminal state，Webview 恢复时优先 hydrate 可信状态；旧 supervisor 或旧 registry 只提供 raw tail 时，Host 将其标记为不可信 fallback，不再生成、发送或持久化伪造的新鲜 serialized state，`recentOutput` 仅保留为摘要和 fallback。

- 风险：serialized terminal snapshot 一旦在 hydrate 后立刻被更小尺寸的 `fit()` 改写，xterm alternate buffer 会直接裁掉顶部行；同样，保活后的 visibility restore 如果无条件 `fit()`，也会把 retain 下的现存 viewport 改写成更少行数。
  当前缓解：snapshot hydrate 现在优先保持宿主记录的终端尺寸与当前屏幕画面；保活后的 visibility restore 只做 non-destructive redraw，不再主动 `fit()`；更强的“尺寸漂移下无损重绘”已登记技术债。

- 风险：如果用户把 `terminal.integrated.scrollback` 设得非常大，serialized terminal state 的内存与落盘体积会同步上升。
  当前缓解：主快照文件继续保留完整 terminal state，以优先满足恢复正确性；`workspaceState` 只保留去掉 serialized terminal state 的轻量兜底，避免把所有存储都膨胀到同一量级。

- 风险：如果运行中状态持久化被收得过狠，扩展宿主崩溃或 VS Code 被强制退出时，最近几秒的 live terminal state 可能尚未落盘。
  当前缓解：只有高频 live execution state 默认延迟合并，主 `canvas-state.json` 仍是恢复权威并按合并窗口写出；active session 期间仅跳过慢的 `workspaceState` fallback。first output 受 `persisted` 栅栏保护，保证用户看到输出前至少已有一次可恢复的会话快照。

- 风险：如果 Webview output backlog 限流过严，非当前输入节点的输出可能明显滞后，用户会误以为 Agent 没有继续运行。
  当前缓解：限流只推迟 Host/Webview output 投递或写入，不丢弃 Host output；Host 侧输入窗口内最近输入节点优先，非输入节点有最大等待上限，Webview 输入窗口外仍按全局预算逐帧推进，并在重新排队时把未处理节点放到已处理节点前面，避免前几个持续输出节点长期占用每帧预算。诊断记录 `host-output-scheduler.reason`、`pendingOutputLength`、`queuedWriteCount`、`webview-terminal-drain.reason` 和 `webview-terminal-write.queuedWriteCount`，用于判断是必要让步还是过度限流。

- 风险：如果 Webview 直接丢弃 raw output 后继续沿用原 xterm 状态，ANSI 模式、alternate screen、scrollback 或半截控制序列会导致显示异常。
  当前缓解：只有在 Host `outputSequence` 可用、且 Webview 处于 hidden 或刚经历 lag/visibility restore、且 pending raw output 超过阈值时，才触发 snapshot reset；hidden 阈值低于 visible 阈值，用更频繁的 Host snapshot 请求换取更低的切回恢复成本。若 pending raw output 达到 1MB hard threshold，即使没有检测到最近 lag / visibility restore，也必须触发 snapshot reset，避免极端 flood 在常规恢复窗口之外继续累计 raw replay。reset 会清空 Webview 待渲染 backlog并请求 Host serialized terminal state 重建，旧 output 不再 replay。reset 后新 output 只在预算内暂存到 snapshot 之后写入；若 snapshot 未及时到达，Webview 会超时重试，若暂存超过预算则丢弃等待期 tail、推进 reset 边界并重新请求 snapshot。无 `outputSequence` 的 live snapshot 不作为 reset-safe 边界；session ended snapshot 和 exit 会关闭 reset 状态，但不 replay 等待期 output，避免为了收口而把未知顺序 backlog 写回 xterm。

- 风险：`node-pty` 路线会引入原生模块与扩展打包约束。
  当前缓解：构建脚本已把 `node-pty` 设为 external，并依赖其预编译产物；当前先以 `build` / `typecheck` / Linux smoke test 证明基本可行。

- 风险：xterm 浏览器 bundle 的第三方入口选择会影响 TUI 控制序列解析。
  当前缓解：Webview production build 显式选择 `@xterm/xterm` CommonJS `main` 入口，并新增 `test:webview-build-xterm-entry`，在 minified bundle 上执行 `CSI ? 12 $ p` 探针，确保不会再次把 TUI 模式查询路径打包成运行时 `ReferenceError`。

- 风险：Windows 本地下使用 `Codex` 时，执行节点内历史仍无法向上翻页；此外，虽然 `Remote SSH` 主路径已验证可用，但其之外的更深远程场景仍缺少同等级人工验证证据。
  当前缓解：桌面三平台与 `Remote SSH` 主路径的功能可用性都已写成已验证结论，但 Windows `Codex` 历史翻页问题继续作为已知限制保留；文档状态仍保持“验证中”，不把剩余差异误写成已收口。

## 8. 验证方法

至少需要完成以下验证：

1. 在宿主 shell 里验证 `node-pty` 确实给子 shell 分配了真实 TTY。
2. `npm run build` 和 `npm run typecheck` 通过。
3. 在 Linux / macOS 的 `Extension Development Host` 中，新建 `Terminal` 节点后可直接在节点内输入并看到实时输出。
4. 不论主画布当前承载在 Panel 还是 Editor，同一宿主区域内切到其他标签再切回后，画布中的终端节点仍保持原 live 会话，且现存 xterm 会完成 non-destructive redraw，不会把当前 viewport 行数改写掉。
5. 如果 Webview 被销毁并重建，执行节点仍能基于宿主 serialized terminal state 恢复当前可见屏幕，并保住与 `terminal.integrated.scrollback` 对齐的 scrollback 历史，而不是只重放尾部日志。
6. 活跃会话期间调整节点尺寸后，终端行列同步生效。
7. 未信任 workspace 时，终端创建与输入路径被正确禁用。
8. 用户向上滚动查看历史后，增量输出、spinner/redraw 与 `host/visibilityRestored` 这类纯视图刷新都不会把 viewport 强制拉回底部；用户滚回底部后，最新输出会再次自动跟随。
9. 一个或多个 `Terminal` 节点执行高频持续输出命令时，当前终端的 `Ctrl-C`、其他执行节点输入、至少一种画布内 DOM 交互，以及在压力期间新建并启动额外执行节点，都仍能在命令进行期间完成，而不是等输出结束后再排队执行。
10. production minified Webview bundle 必须通过 `DECRQM` 探针：向 xterm 写入 `CSI ? 12 $ p` 后，Webview 侧应正常产生 `CSI ? 12 ; 1 $ y` 或同类合法模式响应，而不是抛出 `ReferenceError`；同时至少覆盖一次 Vim 风格 alternate screen 进入后的真实输入路径。
11. 多个执行节点同时输出并出现输入卡顿时，用户应先执行 `Dev Session Canvas: 落盘当前宿主诊断`。诊断目录中的 `execution-performance-diagnostics.json` 应能区分主要耗时发生在 Webview 主线程 lag、Webview input dispatch、Host input received queue delay、Host input write、Host output chunk 处理、Host output scheduler、Host output postMessage、Webview output enqueue、Webview drain、`xterm.write`，还是 Host state persist；若样本为空，至少说明当前阈值下没有捕捉到慢路径，应结合现场复现强度继续调整阈值或采集。
12. 持久化合并、`workspaceState` 非热路径化和 backlog scheduling 生效后，新的诊断 `summary.json.diagnostics.diagnosticsSchema.executionPerformance` 应至少为 10；`state/persistDeferred` 与 `state/workspaceStateSkipped` 可以出现，但运行期间 `persist-workspace-state` 不应再跟随 live output state sync 增长。上一轮 12:35 基线中 `persist-workspace-state` p95 为 2635ms、max 为 16573ms，输入 `queueDelayMs` p95 为 4019ms；14:43 基线中 `webview-terminal-drain.characters` 曾出现 427750 / 336810 / 205738 / 74666 字符突刺，`webview-main-thread-lag` p95 约 59488ms；13:53 基线中 `webview-input-ack` 平均约 142ms、最大 272ms，但 Webview 恢复时 `pendingOutputLength` 达到 6,142,227；15 日基线中 Host 已快速收到输入并生成 ACK，但 Webview 侧 `webview-input-ack.durationMs` 仍可被大量 `host/executionOutput` 延迟到秒级。本轮验收应重点确认 `webview-output-snapshot-reset` 能替代 6MB 级 raw replay，`snapshot-reset-requested` 与 `snapshot-reset-applied` 能成对出现，等待期 `pendingOutputLength` 不再长期超过 256KB，`host-output-scheduler` 能解释 Host output 分批和输入节点优先，且真实终端反馈仍来自 Host 写入后的 PTY / supervisor 输出。边界回归还要覆盖 unsequenced live snapshot 被忽略并等待 retry、unsequenced ended snapshot 能收口但不重放 deferred output、session exit 会清理 pending reset、迟到 reset snapshot 不覆盖 exit 画面，以及普通 attach snapshot 去重和多节点 snapshot hydrate 输入节点优先。
13. 多个 Agent 节点同时拥有大块待渲染 output 时，Webview drain 应在有限帧内触达每个 live Agent，而不是只反复刷新最早进入队列的少数节点；回归用例应覆盖修复前后续 Agent 可见区长期没有最新输出、修复后每个节点都能看到自己的输出 marker。

## 9. 当前验证状态

- 已完成宿主 smoke test，确认当前 Linux 环境下 `node-pty` 启动的子 shell 具备真实 TTY 语义。
- 已完成代码级实现，并通过 `npm run build`、`npm run typecheck`、`npm run test:webview`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/smoke/run-vscode-smoke.mjs`。
- Playwright harness 已新增“serialized terminal state 恢复优先于 raw tail replay”的回归；真实 VS Code `real-reopen` smoke 已覆盖窗口重开后的重新附着与历史恢复链路。
- 真实 VS Code `trusted` smoke 已覆盖 Editor 区域切到普通文本编辑器再切回画布、以及 Panel 区域切到原生 Terminal 再切回画布时的可见内容保持与 `visibility restore` 断言。
- 2026-04-16 已补 Playwright 回归，覆盖 Agent / Terminal 在用户上滚后遇到增量输出、spinner/redraw 与 `host/visibilityRestored` 时仍保持历史 viewport，不再被强制拉回底部；滚回底部后跟随输出恢复。
- 截至 `2026-04-28`，Linux、macOS、Windows 本地 workspace 的 `Terminal` / `Agent` / `Note` 主路径已补齐当前轮功能可用性验证。
- 截至 `2026-04-28`，`Remote SSH` 主路径以及 Linux、macOS、Windows 本地 workspace 的 `Terminal` / `Agent` / `Note` 主路径都已补齐当前轮功能可用性验证。
- 截至 `2026-05-27`，已用 v0.10.6 正常安装宿主诊断确认：`vim tmp.txt` 后宿主仍收到 `execution/inputWritten` 且 PTY 有 Vim 输出，但 Webview 记录 `ReferenceError: n is not defined`，栈位于 `@xterm/xterm` 的 `requestMode`；调试宿主没有该错误。该问题已收敛为生产 Webview bundle 选择 ESM 入口并压缩后触发的 xterm `DECRQM` parser 运行时错误。已新增构建入口约束和 Playwright TUI 回归作为验证口径。
- 截至 `2026-06-10`，已补充执行性能诊断插桩，覆盖 Host/Webview 输出与输入路径，并把结果接入当前宿主诊断 dump；本轮代码级验证以协议解析、lifecycle 诊断测试、typecheck 与差异检查为准，真实多 Agent 卡顿现场仍需用户复现时采集 dump 后再判断瓶颈位置。
- 截至 `2026-06-11`，最新现场诊断显示 file-link resolve 已降为 0，但用户仍能感到明显输入卡顿；因此已补充输入 sequence、Webview→Host queue delay、Host state persist、Webview main-thread lag 诊断，并给 Webview terminal output drain 增加每帧预算和输入后小块优先策略。当前代码级验证已通过 `npm run test:protocol-webview-messages` 与 `npm run typecheck`；真实多 Agent 体感仍需用户安装后重新采集宿主诊断确认。
- 截至 `2026-06-11`，新现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T08-05-07-282Z` 显示 `host-state-persist` 占 488/500 个性能样本，`persist-workspace-state` 平均 161ms、p95 300ms、max 470ms，输入到达 Host 前排队 110ms 到 266ms。已将 live execution state 的默认持久化改为延迟合并，并增加 `host/executionOutput.persisted` 栅栏；当前代码级验证已通过 `npm run test:protocol-webview-messages`、`npm run typecheck`、`npm run build`、定向 Webview 回归与 `git diff --check`，仍需新的真实宿主诊断验证体感和指标变化。
- 截至 `2026-06-11`，第三轮现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T12-35-46-410Z` 显示 deferred coalescing 已把 `state/persistDeferred = 622` 合并到 `state/persistWritten = 66`，但剩余 `workspaceState.update` 单次写入已恶化到平均 1555.79ms、p95 2635ms、max 16573ms，输入到达 Host 前排队平均 945ms、p95 4019ms。当前实现把 active session 期间的 `workspaceState.update` 跳过，只保留主快照文件作为恢复权威，并把诊断 schema 提升到 4；仍需新的真实宿主诊断验证体感和指标变化。
- 截至 `2026-06-11`，第四轮现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T14-43-43-595Z` 显示 `workspaceState` 跳过已生效，file-link request 仍为 0，但 Webview main-thread lag 出现分钟级样本，恢复后 terminal drain 仍有几十万字符 backlog 突刺，且 Host input received queue delay p95 约 7157ms。当前实现进一步收紧为 schema 5：Webview drain 使用全局帧预算、queued write 背压、hidden pause 与 lag/visibility recovery；Host 侧 serialized terminal state 和 line-context tracker 改为批处理，常规 live stateUpdated 静默化。该结论仍需新的真实宿主诊断验证体感和指标变化。
- 截至 `2026-06-12`，第五轮现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-06-12T02-58-38-216Z` 显示 schema 5 已移除分钟级 Webview lag 和 backlog 突刺，`host/stateUpdated` 只剩 2 条，但 `host-input-received.queueDelayMs` 仍稳定在 p50 309ms、p95 377ms。当前实现把诊断 schema 提升到 6，增加 `host/executionInputAck`、`webview-input-ack` 和 `host-event-loop-lag`，且明确不在 Host 写入前做本地反馈；仍需新的真实宿主诊断验证剩余 300ms 的来源。
- 截至 `2026-06-13`，第六轮现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-06-13T13-53-34-850Z` 显示 schema 6 已能区分 ack 往返与 Host queue delay：`webview-input-ack` 平均约 142ms、最大 272ms，未见对应 Host event-loop lag；剩余明显体感卡顿转为 Webview 长时间 timer-lag 后恢复时的 6MB 级 raw output backlog。当前实现把诊断 schema 提升到 7，增加 `webview-output-snapshot-reset`，并用 Host serialized terminal snapshot 替代 Webview raw backlog replay；仍需新的真实宿主诊断验证体感和指标变化。
- 截至 `2026-06-14`，第七轮现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-06-13T15-44-39-405Z` 显示 schema 7 已让 raw replay 退出 retained drain 样本，但 `webview-output-snapshot-reset` 中 `output-deferred-until-snapshot-reset` 仍可把等待期队列增长到约 5.59MB。当前实现把诊断 schema 提升到 8，增加 reset `requestId`、`executionSessionId`、timeout retry、deferred-output budget reset 和采样诊断；仍需新的真实宿主诊断验证体感和指标变化。
- 截至 `2026-06-14`，已补齐 snapshot reset 的 session 结束和无序 snapshot 行为回归：live unsequenced reset snapshot 不应用、不 replay 等待期 output，并等待 sequenced snapshot 或 timeout retry；ended unsequenced snapshot 可作为最终画面应用但不 replay deferred live output；reset 等待期收到 exit 会清理 reset 状态并忽略迟到 reset snapshot。定向 Playwright 已覆盖 Agent / Terminal 两类节点。

- 截至 `2026-06-14`，第九轮现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-14T05-43-23-414Z` 显示 file-link、MB 级 raw backlog 和 `workspaceState` 热路径都不是当前主因；剩余卡顿集中在 panel restore 后 8 个普通 snapshot hydrate 与输入重叠。当前实现把诊断 schema 提升到 9，普通 live attach snapshot 在 mount 内去重，并新增 `webview-snapshot-restore-queue` 诊断，snapshot hydrate 串行且优先最近输入节点；仍保持 Host 写入前不做本地 echo。
- 截至 `2026-06-14`，现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-14T08-48-07-706Z` 显示 attach 去重和 snapshot reset 握手已经生效，`webview-input-ack` p50 108.2ms、p95 172ms、max 209ms；但 hidden 期间总 pending raw output 仍升到约 1.22MB，恢复后需要从约 1MB 开始 lag-recovery drain。当前实现把 hidden 场景的单节点 snapshot reset 阈值降到 128KB，visible / lag recovery 仍保留 512KB，并已用 Playwright 覆盖 Agent / Terminal 在 160KB hidden backlog 时提前发起 `hidden-backlog-snapshot-reset`。

- 截至 `2026-06-15`，现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-14T17-23-57-416Z` 显示 Webview lifecycle、file-link resolve、input ack 与 hidden 128KB reset 方向均已生效，但两个 live-runtime Agent 的 snapshot reset 进入 timeout/retry/stale 循环：Webview reset 边界分别为 3581 / 6437，Host snapshot 却长期返回 `outputSequence = 2`。当前实现将 `outputSequence` 纳入 runtime supervisor output/snapshot/registry、Host metadata、reattach floor 和 Webview reset attach 的 `minOutputSequence` 握手，避免同一 session 下序号回退造成无限 stale snapshot。
- 截至 `2026-06-15`，`0.16.0` packaged-payload VSIX smoke 覆盖了 terminal flood 后继续操作画布和执行节点的主路径。该轮验证暴露出 pending raw output 可在没有最近 lag / visibility restore 标记时越过 1MB，因此 Webview 增加 hard backlog snapshot reset 阈值；同轮还确认 xterm 在 flood / snapshot restore 期间可能触发空选区 `selectionChange`，执行节点只在 xterm 有真实选区或 textarea 已聚焦时才因 selection change 抢回节点选中，避免用户刚选中 Note 又被终端空选区事件覆盖。
- 截至 `2026-06-16`，现场诊断 `/home/users/ziyang01.wang-al/projects/dev-session-canvas/.debug/current-host-diagnostics/2026-06-15T09-00-14-651Z` 显示 Host 已快速收到输入并生成 ACK，但 ACK 在 Webview 侧仍可被大量 output 消息排队延迟。当前实现把 Host 普通 output post 提升为 schema 10 的 scheduler 路径，控制消息和 `host/executionInputAck` 绕过该队列；ACK 诊断增加 Host post 时间与 scheduler backlog 字段，后续应以 `webview-input-ack.durationMs` 优先判断用户可感知延迟。
- 截至 `2026-06-24`，补充 Agent 多节点 output drain 公平性回归。修复前 6 个 live Agent 同时入队大块 output 时，Webview drain 会因 `Set` 重新插入顺序反复处理最早两个 controller，后续 Agent 在有限帧内看不到自己的输出 marker；修复后未处理 controller 会排在已处理但仍有剩余 output 的 controller 前面，定向 Playwright 覆盖每个 Agent 都能在多节点 backlog 下显示自己的输出 marker。
- 截至 `2026-07-01`，现场诊断 `/home/users/ziyang01.wang-al/projects/dev-session-canvas/.debug/current-host-diagnostics/2026-06-28T16-08-57-885Z` 与 `2026-06-28T16-11-12-160Z` 显示 raw output / `recentOutput` 已包含最终内容，但 `serializedTerminalState.data` 落后；拖动节点尺寸只是触发 Codex TUI 重绘后让 stale state 偶然补齐。同日追加诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-07-01T05-25-37-168Z` 进一步显示 Host live metadata / persisted canvas snapshot 也可能保存 `outputSequence` 落后的 serialized state。当前修复将 `outputSequence` 写入 serialized terminal state，并在 runtime supervisor snapshot、Host snapshot、Host metadata 持久化 / reconcile / normalize 与 Webview restore 各路径拒绝序号不一致的 serialized state，改为从 raw output 重建；诊断摘要必须记录 serialized state 序号、长度与新鲜度。不增加 resize 兜底，避免掩盖真实新鲜度问题。
- 截至 `2026-07-02`，现场诊断 `/home/users/ziyang01.wang-al/projects/dev-session-canvas/.debug/current-host-diagnostics/2026-07-02T02-25-04-409Z` 显示上一轮新鲜度修复仍会把旧 supervisor 的 raw output tail 伪装成新鲜状态：Host snapshot `outputPreview` 与 `serializedTerminalState.data` 都以 `6;2H` 开头，缺失 `ESC[`，说明 6000 字符 tail 从 CSI 中间截断；Host 又把它标成 `serializedTerminalStateOutputSequence = outputSequence = 40286`，Webview hydrate 后自然只显示残缺画面，resize 后 TUI 主动重绘才恢复。当前修复把 `createSupervisorExecutionSession` 中来自旧 supervisor 的无序 serialized state / raw tail 降级为 `terminalStateTrusted = false`，不再 flush、发送、持久化或从 metadata 回填该 tracker；只有 supervisor snapshot 自带与 session 边界匹配的 serialized terminal state 时才进入可信恢复链路。PR review 追加确认：当前 supervisor 首个输出的 lifecycle state 事件可能先于 tracker flush 到达 Host，因此同一 live runtime 已有可信 tracker 时，Host 必须保留 tracker 并仅用 snapshot 更新 lifecycle / metadata / summary，避免正常新 supervisor 会话被误降级为不可信 fallback。
- Windows 下使用 `Codex` 时，执行节点内历史当前仍有无法向上翻页的已知限制；Remote SSH 之外的更深远程场景也还缺少同等级人工验证证据，因此文档状态继续保持为“验证中”。
