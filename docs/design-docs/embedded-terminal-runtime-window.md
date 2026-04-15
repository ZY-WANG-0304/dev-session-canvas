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
updated_at: 2026-04-16
---

# Terminal 节点嵌入式会话窗口设计

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
- 不在本轮把 Windows 写成“已经完成人工验证”；Linux / macOS 优先闭合，Windows 只在拿到验证证据后才升级结论。

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

## 6. 当前结论

当前收敛结论如下：

- `Terminal` 节点的正确产品定义是“画布中的终端会话窗口”。
- 主交互必须留在节点内部，而不是继续依赖 VSCode 原生终端。
- 当前实现路线选择 `xterm.js + node-pty`：
  - Webview 使用 `xterm.js` 渲染终端前端；
  - 宿主用统一 PTY bridge 启动真实 shell，并通过消息桥传递输入输出。
- Linux / macOS 作为当前主支持平台；Windows 代码路径已接通，但仍待人工验证。

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

## 7. 风险与取舍

- 取舍：当前接受原生 PTY 依赖，换取 Linux / macOS 主路径收口，并让 Windows 进入同一后端模型。
  原因：平台兼容性已经成为当前用户目标的一部分，继续保留 `script` 只会让平台能力和运行时模型一起分叉。

- 风险：如果 Webview 重建时仍靠 raw tail replay，`Codex`、`Claude Code` 这类 alternate-buffer / 全屏重绘型 CLI 会出现上半部分空白或只剩底部尾巴。
  当前缓解：local PTY 与 supervisor 两条路径都改为维护 serialized terminal state，Webview 恢复时优先 hydrate 该状态；`recentOutput` 仅保留为摘要和 fallback。

- 风险：serialized terminal snapshot 一旦在 hydrate 后立刻被更小尺寸的 `fit()` 改写，xterm alternate buffer 会直接裁掉顶部行；同样，保活后的 visibility restore 如果无条件 `fit()`，也会把 retain 下的现存 viewport 改写成更少行数。
  当前缓解：snapshot hydrate 现在优先保持宿主记录的终端尺寸与当前屏幕画面；保活后的 visibility restore 只做 non-destructive redraw，不再主动 `fit()`；更强的“尺寸漂移下无损重绘”已登记技术债。

- 风险：如果用户把 `terminal.integrated.scrollback` 设得非常大，serialized terminal state 的内存与落盘体积会同步上升。
  当前缓解：主快照文件继续保留完整 terminal state，以优先满足恢复正确性；`workspaceState` 只保留去掉 serialized terminal state 的轻量兜底，避免把所有存储都膨胀到同一量级。

- 风险：`node-pty` 路线会引入原生模块与扩展打包约束。
  当前缓解：构建脚本已把 `node-pty` 设为 external，并依赖其预编译产物；当前先以 `build` / `typecheck` / Linux smoke test 证明基本可行。

- 风险：Windows 与远程场景仍缺少人工验证证据。
  当前缓解：文档状态继续保持“验证中”，不把未确认平台写成已支持。

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

## 9. 当前验证状态

- 已完成宿主 smoke test，确认当前 Linux 环境下 `node-pty` 启动的子 shell 具备真实 TTY 语义。
- 已完成代码级实现，并通过 `npm run build`、`npm run typecheck`、`npm run test:webview`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs`。
- Playwright harness 已新增“serialized terminal state 恢复优先于 raw tail replay”的回归；真实 VS Code `real-reopen` smoke 已覆盖窗口重开后的重新附着与历史恢复链路。
- 真实 VS Code `trusted` smoke 已覆盖 Editor 区域切到普通文本编辑器再切回画布、以及 Panel 区域切到原生 Terminal 再切回画布时的可见内容保持与 `visibility restore` 断言。
- 2026-04-16 已补 Playwright 回归，覆盖 Agent / Terminal 在用户上滚后遇到增量输出、spinner/redraw 与 `host/visibilityRestored` 时仍保持历史 viewport，不再被强制拉回底部；滚回底部后跟随输出恢复。
- 当前 shell 环境没有可直接启动 `Extension Development Host` 的 `code`/`cursor`/`codium` CLI，也没有 macOS / Windows 本地人工验证证据；文档状态继续保持为“验证中”。
