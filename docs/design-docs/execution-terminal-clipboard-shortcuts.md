---
title: Agent / Terminal 终端复制粘贴快捷键交互
decision_status: 已选定
validation_status: 已验证
domains: [VSCode 集成域, 画布交互域, 协作对象域, 执行编排域]
architecture_layers: [宿主集成层, 画布呈现层, 共享模型与编排层]
related_specs: [docs/product-specs/agent-terminal-clipboard-shortcuts.md]
related_plans: [docs/exec-plans/active/execution-terminal-clipboard-shortcuts.md]
updated_at: 2026-06-15
---

# Agent / Terminal 终端复制粘贴快捷键交互

## 1. 背景

`Agent` 与 `Terminal` 节点当前都使用 Webview 内的 `xterm.js` 承载终端前端，并通过 `webview/executionInput` 把输入交给 `src/panel/CanvasPanelManager.ts` 写入本地 PTY 或 live runtime。这个模型已经支持普通字符输入、终端输出、link 交互和缩放坐标修正，但还没有把 `Ctrl` / `Cmd` + `C`、`V` 这类高频剪贴板快捷键收口成正式行为。

调研 VSCode 原生 Terminal 后可以确认，复制粘贴不是简单把 `Ctrl+C` 和 `Ctrl+V` 都改成剪贴板操作。VSCode 原生 Terminal 把终端快捷键先放进 Workbench keybinding / command 体系，再用 `commandsToSkipShell`、终端选区状态和平台差异决定某次按键是给 VSCode 处理，还是继续交给 shell。`Ctrl+C` 的冲突处理尤其依赖“是否有终端选区”和“当前平台”。本设计把这些用户可观察规则移植到画布执行节点，但不要求内部类结构复刻 VSCode 源码。

本次调研参考的 VSCode upstream 为 2026-05-09 `main` 分支 `9300eb847eaf812841160885d4885ae6dd394d1c`。关键来源包括：

- `terminal.clipboard.contribution.ts`：定义 copy / paste / copy-and-clear-selection keybinding、`copyOnSelection`、右键 copyPaste 和 clipboard 读写入口。
- `terminalClipboard.ts`：定义多行粘贴确认、bracketed paste 例外，以及“单条命令尾随换行先剥离”的安全处理。
- `terminalInstance.ts`：通过 `attachCustomKeyEventHandler` 在 xterm 输入前拦截 Workbench 命令、Meta 组合键和 `commandsToSkipShell`。
- `terminalConfiguration.ts` 与 `terminal.ts`：定义 `sendKeybindingsToShell`、`commandsToSkipShell`、`rightClickBehavior`、`copyOnSelection` 等配置和默认 skipped command 集合。

## 2. 问题定义

画布执行节点需要解决三个同时成立的问题。第一，用户在节点终端中选中输出后，应能用平台熟悉的快捷键复制，不再被迫右键或离开画布。第二，用户应能把系统剪贴板文本粘贴到当前会话，不因为 Webview 边界丢失 `Ctrl` / `Cmd+V`。第三，`Ctrl+C` 不能被粗暴改成复制，因为对 shell、Codex、Claude Code 等 Agent CLI 来说，`Ctrl+C` 是打断当前命令或当前生成的核心输入。

如果只实现“有键就复制 / 粘贴”，会带来两个回归：Windows 用户无法在无选区时中断进程，Linux 用户会发现选区存在时 `Ctrl+C` 不再像原生 Terminal 一样打断。若完全不拦截快捷键，则复制粘贴能力继续缺失。本设计的核心是让同一按键在同一平台、同一选区状态下做出与 VSCode 原生 Terminal 一致的判断。

## 3. 目标

- 在 `Agent` / `Terminal` xterm 聚焦时，复制、粘贴和 `Ctrl+C` 打断语义对齐 VSCode 原生 Terminal 的默认平台口径。
- 在不改变现有 PTY 输入链路的前提下，使无选区 `Ctrl+C` 继续由 xterm 生成 `\x03` 并写入 Host / runtime。
- 粘贴文本必须通过 xterm paste 入口进入会话，使 bracketed paste 与终端内部状态继续由 xterm 管理。
- 多行粘贴默认采用 VSCode 原生 Terminal 的安全防线，避免剪贴板尾随换行导致命令立即执行。
- 方案必须明确 Host / Webview 边界，避免剪贴板权限、确认弹窗和终端选区状态散落在多个不可追踪位置。

## 4. 非目标

- 不读取或复刻用户全部 VSCode keybindings，也不引入自定义 keybinding 编辑器。
- 不在第一版支持 `terminal.integrated.copyOnSelection`、Linux selection clipboard、右键 copyPaste、HTML 复制或资源剪贴板 fallback。
- 不把 `Ctrl+C` 改成画布节点 stop 行为；这仍属于执行生命周期控制，而不是终端输入。
- 不改变 Note、标题输入框、画布空白区、sidebar 或 VSCode 工作台其他焦点区域的快捷键语义。
- 不把 Webview 的 DOM selection 当成终端 selection；执行节点只处理 xterm buffer selection。

## 5. 候选方案

### 方案 A：完全依赖浏览器 / xterm 默认行为

这个方案不新增任何 Webview / Host 协议，期待 xterm 或浏览器自己处理复制粘贴。它实现成本最低，但当前用户问题已经说明这条路径不可用：画布内执行节点没有获得可预期的 `Ctrl` / `Cmd+C/V` 行为，也无法显式处理 `Ctrl+C` 与打断的冲突。

结论：排除。

### 方案 B：在 Webview 内直接使用 `navigator.clipboard`

这个方案由 `src/webview/executionTerminalNativeInteractions.ts` 在 xterm 上注册 keyboard handler：复制时读取 xterm 选区并调用 `navigator.clipboard.writeText`，粘贴时调用 `navigator.clipboard.readText` 后 `terminal.paste(text)`。它能最少改动现有 Host 协议，也让选区和 xterm paste 留在同一侧。

主要风险是 VSCode Webview 的 clipboard 权限和失败反馈更难统一，粘贴前的多行安全确认也会被迫在 Webview 内自建 UI，和 VSCode 原生 Terminal 的 Workbench 弹窗体验分叉。未来如果要加 Host 诊断或测试替身，还需要再补一层协议。

结论：不作为正式方案；可作为无 Host 剪贴板时的诊断 fallback，但不能成为主路径。

### 方案 C：Webview 判定终端快捷键，Host 负责系统剪贴板与粘贴安全

这个方案把职责拆开：Webview 仍然拥有 xterm focus、selection、bracketed paste mode 与按键事件，因此它负责判断“这次按键是否应该拦截”和“复制的文本是什么”；Host 通过 `vscode.env.clipboard` 读写系统剪贴板，并在粘贴多行文本时执行与 VSCode 原生 Terminal `auto` 类似的安全处理。Host 返回可粘贴文本后，Webview 调用当前 xterm 实例的 paste 入口。

它比方案 B 多一个 request / response 协议，但更符合当前架构：`src/common/protocol.ts` 承载跨边界消息，`src/panel/CanvasPanelManager.ts` 是 Host 侧权威入口，Webview 不直接承担平台剪贴板权限与 VSCode 弹窗策略。复制时 Host 可记录诊断；粘贴时 Host 可在读取剪贴板、剥离尾随换行、显示确认和取消之间保持单一决策点。

结论：选定。

## 6. 风险与取舍

- 平台差异风险：VSCode 原生 Terminal 的默认规则在 Windows、Linux、macOS 不同；测试需要把规则抽成纯函数或可注入平台，否则本机只能覆盖当前平台。
- Remote 语义风险：快捷键应按 UI 平台判断，而不是 remote PTY OS。Remote SSH 到 Linux 但 UI 在 macOS 时仍应使用 `Cmd+C` / `Cmd+V`；UI 在 Windows 时仍应使用 Windows 的 `Ctrl+C` 选区复制 / 无选区打断与 `Ctrl+V` 粘贴。实现时不能在 workspace Host 侧用 `process.platform` 判断快捷键，因为 Remote SSH 下它会反映远端 Linux。
- 异步粘贴风险：Host 读取剪贴板和确认弹窗是异步的，返回时目标 xterm 可能已经销毁或失焦。消息必须带 `requestId`、`nodeId`、`kind`，Webview 只对仍存在的同一节点执行 paste。
- 安全取舍：第一版不暴露 `terminal.integrated.enableMultiLinePasteWarning` 设置镜像，而是采用固定 `auto` 安全口径。这样少一个设置面，但能避免多行剪贴板在画布里默认直通执行。
- 兼容取舍：第一版不支持 Linux selection clipboard 与 right-click copyPaste，因为用户当前请求是键盘复制粘贴；后续若扩展到鼠标路径，应另立设计补充。

## 7. 正式方案

正式方案采用“Webview 判定快捷键，Host 拥有系统剪贴板与粘贴安全，Webview 最终调用 xterm paste”的分层。Remote SSH 场景下，快捷键平台归属仍由本地 Webview / UI 侧判断，远端 Host 只负责接收已经判定好的 copy / paste request 和最终 PTY 输入。

`src/webview/executionTerminalNativeInteractions.ts` 是执行节点终端交互入口。这里应新增一个 keyboard shortcut adapter，并由 `Agent` 与 `Terminal` 节点在创建 xterm 后共用。adapter 通过 `terminal.attachCustomKeyEventHandler` 在 xterm 处理按键前判断当前事件。只有事件目标属于当前 xterm、当前键是平台定义的复制 / 粘贴快捷键时才拦截；普通字符、无选区 `Ctrl+C`、shell 自有组合键和其他 Workbench 快捷键继续交给 xterm 或外层 VSCode 处理。adapter 不直接写 PTY；它只做三类动作：发送复制请求、发送粘贴请求、或返回 `true` 让 xterm 继续处理。

`src/common/protocol.ts` 应新增最小跨边界消息，用于 Host 剪贴板操作和异步粘贴回包。推荐结构是：

    webview/copyExecutionSelection
      payload: { nodeId, kind, text, clearSelectionAfterCopy }

    webview/requestExecutionPaste
      payload: { requestId, nodeId, kind, bracketedPasteMode }

    host/executionPasteText
      payload: { requestId, nodeId, kind, text }

    host/executionPasteCancelled
      payload: { requestId, nodeId, kind }

复制不需要回包；如果 Host 写剪贴板失败，可走现有 `host/error`。粘贴必须回包，因为 Webview 需要在确认后调用本地 xterm paste。`requestId` 用于丢弃没有匹配请求的响应，`nodeId` 与 `kind` 用于确认目标仍是原节点；Webview 不应对等待 Host 多行粘贴确认的请求施加固定短超时，否则用户在模态确认框停留较久后点击继续会被误丢弃。

`src/panel/CanvasPanelManager.ts` 是 Host 侧处理入口。收到 `webview/copyExecutionSelection` 后，Host 调用 `vscode.env.clipboard.writeText(text)`；如果 `clearSelectionAfterCopy` 为 true，Webview 可在发送请求后立即清选区，因为清选区只影响 xterm UI。收到 `webview/requestExecutionPaste` 后，Host 调用 `vscode.env.clipboard.readText()`，再按固定 `auto` 规则处理文本：空文本 no-op；单行文本直接返回；`bracketedPasteMode` 为 true 时直接返回；按 `CRLF`、裸 `CR` 或裸 `LF` 判断行分隔，若文本只有一条命令和尾随空白换行，剥离尾随空白换行后返回；其他多行文本必须通过 VSCode 原生确认后才返回，取消则发 `host/executionPasteCancelled`。

Webview 收到 `host/executionPasteText` 后，必须查找当前 `executionTerminalRegistry` 中仍存活的对应 `Terminal` 实例，并调用 `terminal.paste(text)`，而不是发送 `webview/executionInput` 或直接调用 Host 写入输入。这样可以保留 xterm 的 bracketed paste、换行归一化、textarea focus 和本地状态一致性。若节点已经销毁、kind 不匹配或请求不是最新请求，应丢弃回包。

核心快捷键不变量如下：

- macOS：`Cmd+C` 在 xterm 选区非空时复制，选区为空时透传给 Workbench / 浏览器；`Ctrl+C` 始终不拦截，继续发送打断；`Cmd+V` 请求粘贴。
- Windows：xterm 选区非空时 `Ctrl+C` 复制并清空选区；选区为空时不拦截，继续发送打断；`Ctrl+Shift+C` 复制但不要求清选区；`Ctrl+V` 与 `Ctrl+Shift+V` 请求粘贴。
- Linux：`Ctrl+C` 始终不拦截，继续发送打断；`Ctrl+Shift+C` 复制；`Ctrl+Shift+V` 请求粘贴。

这些规则只在 xterm focus 内生效。`Agent` 和 `Terminal` 使用同一套规则；差异只体现在 Host 写入的目标会话类型不同。对 Agent 来说，无选区 `Ctrl+C` 是发送给 provider CLI 的 interrupt，不等同于节点 stop。对 Terminal 来说，它就是 shell interrupt。非 live 节点可以复制已有 scrollback 选区，但粘贴必须在 Webview 或 Host 侧确认目标仍有可输入 live session；如果没有，应取消粘贴并可用 `host/error` 给出轻量反馈。

2026-06-14 补充：为了定位“复制快捷键或右键复制没有生效”的现场原因，正式方案增加只读诊断，不改变复制行为。`src/webview/executionTerminalNativeInteractions.ts` 在执行节点 xterm 内上报 `webview/executionClipboardDiagnostic`，覆盖本地 Webview 平台推断、复制/粘贴快捷键判定、xterm selection 变化、TUI mouse tracking 模式变化、mouse tracking 下的拖选尝试、右键菜单触发时的选区状态，以及收到 OSC 52 时的目标、payload 类型和短预览。`src/panel/CanvasPanelManager.ts` 只把这些事件写入 `diagnostic-events.json`，并在 `summary.json.diagnostics.executionClipboardSummary` 汇总按 source / node 的计数和最新状态；Host 不因为该诊断写剪贴板，也不把 OSC 52 转成复制。`src/common/protocol.ts` 同步扩展 `WebviewProbeNodeSnapshot`，让 `panel-probe.json` 能直接看到 `terminalMouseTrackingMode`、`terminalBufferType` 和 `terminalHasFocus`，用于区分“没有 xterm 选区”“TUI mouse tracking 捕获了拖选”“平台快捷键推断错误”和“OSC 52 已出现但未桥接”等原因。

2026-06-15 补充：snapshot restore 期间的 `terminal.reset()` 与 `terminal.write(snapshot)` 会触发 xterm 内部 selection、mouse tracking 和 OSC 52 parser 事件，这些属于程序化恢复副作用，不代表用户实际选择或复制。Webview 只在显式进入 snapshot restore 上下文时抑制 `selectionChange`、`mouseTrackingMode` 和 `osc52` 三类 clipboard 诊断，并在 restore 完成后的短帧窗口内继续吸收 xterm 延迟派发的同类事件，随后聚合上报一条 `restoreSuppressed`，其中包含 reason、generation、total 与按 source 的 counts；若下一次真实 output/input/exit 写入开始，会先刷新这条聚合诊断，避免抑制窗口跨越到用户路径。`shortcut`、`contextMenu`、`mouseSelection`、paste/copy 请求和 `environment` 诊断不进入抑制窗口；系统也不做“空选区同值去重/节流”，避免把真实用户现场误判为噪音。

## 8. 验证方法

实现时应同时覆盖纯规则测试、Webview DOM 测试和至少一条真实 VSCode smoke / 手动验证说明。

纯规则测试建议新增一个不依赖 DOM 的 helper，例如 `resolveExecutionTerminalClipboardShortcut(platform, eventShape, hasSelection)`，覆盖 macOS、Windows、Linux 三个平台下 `Ctrl+C`、`Cmd+C`、`Ctrl+Shift+C`、`Ctrl+V`、`Ctrl+Shift+V`、`Cmd+V` 的动作矩阵。这样 CI 在 Linux 上也能验证 Windows / macOS 分支。

`tests/playwright/webview-harness.spec.mjs` 应覆盖当前平台的真实 xterm 行为：写入终端输出后拖选文本，触发复制快捷键并确认发出了 Host copy 请求；无选区触发 `Ctrl+C` 时确认 `webview/executionInput` 收到 `\x03`；模拟 Host 返回 paste 文本后确认 xterm 把文本送入现有 input 链路。Note 正文、标题输入框和画布空白区应至少各有一个“不被终端快捷键拦截”的回归。

宿主级验证可以先用测试命令或 smoke harness 注入剪贴板内容，打开真实 VSCode Webview，聚焦一个 `Terminal` 节点后执行粘贴并观察 PTY 收到文本。若宿主级剪贴板在 CI 环境不可用，必须在验证说明中明确记录限制，并保留 Playwright 的协议级替代证据。

截至 2026-05-09，本设计已通过纯规则测试、TypeScript 类型检查、完整 Webview Playwright 回归和 trusted VSCode smoke 验证。已执行命令包括 `npm run test:execution-terminal-clipboard`、`npm run typecheck`、`npm run test:webview` 和 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs`。

2026-06-14 诊断补充已通过 `npm run typecheck`、`npm run test:execution-terminal-clipboard` 和 `npm run test:webview -- --grep "terminal copy diagnostics"` 验证。覆盖范围包括协议 validator、Agent / Terminal 两类节点的 mouse tracking 模式上报、mouse tracking 下拖选后无 xterm 选区的快捷键诊断、右键菜单选区诊断，以及 OSC 52 诊断事件。

2026-06-15 snapshot restore 抑制补充的验证口径是：协议 validator 接受 `restoreSuppressed` source；Playwright 在 Agent / Terminal 两类节点上通过 snapshot replay 触发 mouse tracking 与 OSC 52，断言 restore 窗口内没有原始 `mouseTrackingMode` / `osc52` / `selectionChange` 诊断，只保留聚合 `restoreSuppressed`；同一节点在 restore 之后收到 live OSC 52 output 时仍正常上报原始 `osc52` 诊断。

## 9. 参考资料

- VSCode Terminal clipboard contribution: https://github.com/microsoft/vscode/blob/9300eb847eaf812841160885d4885ae6dd394d1c/src/vs/workbench/contrib/terminalContrib/clipboard/browser/terminal.clipboard.contribution.ts
- VSCode Terminal paste safety helper: https://github.com/microsoft/vscode/blob/9300eb847eaf812841160885d4885ae6dd394d1c/src/vs/workbench/contrib/terminalContrib/clipboard/browser/terminalClipboard.ts
- VSCode Terminal xterm key event handling: https://github.com/microsoft/vscode/blob/9300eb847eaf812841160885d4885ae6dd394d1c/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts
- VSCode Terminal configuration schema: https://github.com/microsoft/vscode/blob/9300eb847eaf812841160885d4885ae6dd394d1c/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts
- VSCode Terminal skipped command defaults: https://github.com/microsoft/vscode/blob/9300eb847eaf812841160885d4885ae6dd394d1c/src/vs/workbench/contrib/terminal/common/terminal.ts
