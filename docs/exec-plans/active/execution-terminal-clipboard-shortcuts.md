# Agent / Terminal 复制粘贴快捷键支持

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/execution-terminal-clipboard-shortcuts.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更完成后，用户在画布里的 `Agent` / `Terminal` 节点聚焦终端时，可以按 VSCode 原生 Terminal 的默认平台口径复制终端选区、粘贴系统剪贴板文本，并在无选区时继续用 `Ctrl+C` 打断当前 shell 或 Agent CLI。用户最容易亲眼验证的行为是：选中终端输出后复制能进入系统剪贴板；没有选区时按 `Ctrl+C` 不会复制也不会停止节点，而是让正在运行的命令收到 interrupt；粘贴多行内容不会未经确认直接执行。

本计划先完成调研和正式设计收口，再按设计实现 Webview / Host 的最小剪贴板协议和测试。当前仓库已经有 Webview xterm、Host PTY 输入桥和执行节点 native interaction 模块，所以本计划不改变运行时 ownership，只补齐键盘剪贴板交互。

## 进度

- [x] (2026-05-09 02:41Z) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md`、`docs/FRONTEND.md`、产品规格索引与现有执行终端设计文档，确认本任务属于多步设计研究并需要 ExecPlan 与设计文档。
- [x] (2026-05-09 02:41Z) 从最新 `origin/main` 新建主题分支 `agent-terminal-clipboard-shortcuts`，开始本轮交付性改动。
- [x] (2026-05-09 02:41Z) 梳理当前实现：`src/webview/main.tsx` 直接把 `terminal.onData` 透传到 `webview/executionInput`，`src/panel/CanvasPanelManager.ts` 将输入写入本地 PTY 或 supervisor；当前没有专门处理复制、粘贴或 `Ctrl+C` 冲突的逻辑。
- [x] (2026-05-09 02:41Z) 调研 VSCode upstream Terminal clipboard / keybinding / paste safety 代码，确认原生行为依赖平台、终端选区、`commandsToSkipShell` 和 bracketed paste。
- [x] (2026-05-09 02:41Z) 新增 `docs/product-specs/agent-terminal-clipboard-shortcuts.md`、`docs/design-docs/execution-terminal-clipboard-shortcuts.md`，并同步设计索引、产品规格索引与核心信念。
- [x] (2026-05-09 04:01Z) 实现 `src/common/executionTerminalClipboard.ts` 纯规则 helper，覆盖本地 UI 平台推断、复制粘贴快捷键矩阵和 Host 粘贴文本预处理。
- [x] (2026-05-09 04:01Z) 在 `src/common/protocol.ts` 增加 copy request、paste request、paste text response 和 paste cancelled response，并补齐 Webview 消息 validator。
- [x] (2026-05-09 04:01Z) 在 `src/webview/executionTerminalNativeInteractions.ts` 中接入 xterm keyboard shortcut adapter，并让 Agent / Terminal 创建终端时共用同一入口。
- [x] (2026-05-09 04:01Z) 在 `src/webview/main.tsx` 中接线复制 / 粘贴 callbacks、pending paste request 管理和 Host paste response 路由，最终通过 `terminal.paste(text)` 进入现有输入链路。
- [x] (2026-05-09 04:01Z) 在 `src/panel/CanvasPanelManager.ts` 中接入 `vscode.env.clipboard`，粘贴前确认 live session、处理多行安全确认，并把错误和回包限制到来源 surface。
- [x] (2026-05-09 04:01Z) 补齐 `scripts/test-execution-terminal-clipboard.mts`、`package.json` 测试脚本和 `tests/playwright/webview-harness.spec.mjs` 的 copy / paste / interrupt 回归，并完成自动化验证。
- [x] (2026-05-09 06:33Z) 处理 PR review blocker：把裸 `CR` 纳入粘贴行分隔 / 尾随换行安全处理，避免 `echo one\recho two` 绕过多行确认。
- [x] (2026-05-09 06:33Z) 处理 PR review blocker：移除 Webview 端 paste request 的固定 30 秒清理，让等待 Host 模态确认的请求只在回包、取消或 Webview dispose 时清理。
- [x] (2026-05-09 06:33Z) 补充 CR-only 纯规则测试和延迟 Host 粘贴回包 Playwright 回归，并重新运行验证。
- [x] (2026-05-09 06:45Z) 处理 PR review blocker：macOS `Cmd+C` 无终端选区时改为 `passThrough`，避免被 xterm key handler 作为 `noop` 吞掉。

## 意外与发现

- 观察：VSCode 原生 Terminal 并不是所有平台都用同一组 `Ctrl+C/V` 规则。Windows 在有选区时额外把 `Ctrl+C` 绑定到 copy-and-clear-selection；Linux 默认不这样做，复制走 `Ctrl+Shift+C`；macOS 用 `Cmd+C` 复制，`Ctrl+C` 继续保留给 shell。
  证据：2026-05-09 对照 `terminal.clipboard.contribution.ts` 的 `CopySelection`、`CopyAndClearSelection` 与 `Paste` keybinding。

- 观察：VSCode 原生 Terminal 的粘贴路径不是简单读剪贴板后写 PTY；它会在单行、bracketed paste、多行和尾随换行场景下做安全判断。
  证据：2026-05-09 对照 `terminalClipboard.ts` 的 `shouldPasteTerminalText(...)`。

- 观察：当前仓库输入桥没有区分“按键输入”和“粘贴输入”。`terminal.onData` 直接调用 `data.onExecutionInput`，Host 的 `writeExecutionInput(...)` 只接收字符串并写入 session。
  证据：`src/webview/main.tsx` 中 Agent / Terminal 都使用 `terminal.onData((input) => data.onExecutionInput?.(..., input))`；`src/panel/CanvasPanelManager.ts` 的 `writeExecutionInput(...)` 只接受 `data: string`。

- 观察：设计阶段即可确定 UI 平台应作为快捷键判断依据，而不是 PTY / remote OS。否则 Remote SSH 到 Linux 的 macOS 用户会被迫使用 Linux 复制粘贴快捷键，和 VSCode Workbench 行为不一致。
  证据：VSCode 原生 keybinding 由 UI Workbench 解析，Host / PTY OS 不参与 `Cmd` / `Ctrl` 平台选择。

- 观察：VSCode 官方 remote extension 文档明确说明 Webview API 和 clipboard API 即使由 Workspace Extension 使用，也运行在用户本地机器或浏览器；这支持本设计把键盘平台语义放在本地 Webview，把剪贴板操作交给 VSCode API 代理，而不是用远端 Linux 的 `process.platform`。
  证据：2026-05-09 查阅 VSCode `Supporting Remote Development and GitHub Codespaces` 与 `Extension Host` 官方文档。


- 观察：实现时可以把 Remote SSH 的特殊性降到纯平台推断测试里验证；只要 Webview 使用 `window.navigator.platform` / `userAgent` 推断本地 UI 平台，Host 侧 `process.platform` 就不会参与快捷键分支。
  证据：`scripts/test-execution-terminal-clipboard.mts` 覆盖 `MacIntel`、`Win32` 与 `Linux x86_64` 推断，说明 macOS / Windows 本地连 Linux 远端时仍按本地平台解释快捷键。

- 观察：Host 读取剪贴板后不直接写 PTY，而是回给 Webview 再走 `terminal.paste(text)`，可以复用 xterm 的 paste 行为并继续触发现有 `terminal.onData -> webview/executionInput` 链路。
  证据：Playwright 用 `host/executionPasteText` 模拟 Host 回包后，断言 `webview/executionInput` 收到同一段粘贴文本；`npm run test:webview` 中对应 Agent / Terminal 两组用例通过。

- 观察：trusted VSCode smoke 在当前环境会输出大量 VSCode trace、GPU 初始化和缺失用户配置文件噪声，但进程最终以 0 退出并打印通过信息。
  证据：`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 输出 `Trusted workspace smoke passed.` 与 `VS Code smoke test passed.`。

- 观察：剪贴板文本不能只按 `\n` 或 `\r\n` 识别换行；裸 `\r` 在 xterm paste 中也会形成回车输入，如果不计入行分隔，会绕过多行粘贴确认。
  证据：PR review 指出 `prepareExecutionTerminalPasteText('echo one\recho two', false)` 曾被误判为单行；本轮改为 `\r\n|\r|\n` 拆分，并补充 CR-only 尾随回车与 CR-only 多行测试。

- 观察：Webview 端固定 30 秒 paste request 超时会与 Host 侧无超时的 VSCode modal 确认冲突，用户在确认框停留超过 30 秒后点击“继续粘贴”会让回包被误丢弃。
  证据：本轮移除固定前端超时，并新增 `terminal paste response survives a delayed host confirmation` Playwright 用例，用 fake clock 前进 31 秒后确认 Host 回包仍能进入 xterm。

- 观察：macOS `Cmd+C` 无终端选区如果返回 `noop`，会被当前 xterm key handler 当作非 `passThrough` 动作执行 `preventDefault()` 和 `stopPropagation()`，从而违背“透传给 Workbench / 浏览器”的设计意图。
  证据：`resolveExecutionTerminalClipboardShortcut('mac', Cmd+C, false)` 已改为 `passThrough`，并补充纯规则断言。

## 决策记录

- 决策：本功能默认对齐 VSCode 原生 Terminal 的平台默认口径，而不是做一套跨平台统一的 `Ctrl+C` / `Ctrl+V` 规则。
  理由：`Ctrl+C` 与 shell interrupt 的冲突是终端产品逻辑的核心风险；原生 Terminal 已经用平台差异解决这个问题，用户也最熟悉这套肌肉记忆。
  日期/作者：2026-05-09 / Codex

- 决策：正式方案选择“Webview 判定快捷键，Host 负责系统剪贴板与粘贴安全，Webview 调用 xterm paste”。
  理由：xterm focus、selection 和 bracketed paste mode 只能可靠地从 Webview 读取；系统剪贴板和 VSCode 确认弹窗更适合由 Host 通过 `vscode.env.clipboard` 与 Workbench API 处理。
  日期/作者：2026-05-09 / Codex

- 决策：第一版不实现 `copyOnSelection`、右键 copyPaste、Linux selection clipboard、HTML copy 和资源剪贴板 fallback。
  理由：用户当前请求聚焦键盘复制粘贴和 `Ctrl+C` 冲突；这些能力会扩大设置面与鼠标交互范围，应在键盘主路径稳定后单独评估。
  日期/作者：2026-05-09 / Codex

- 决策：多行粘贴采用固定 `auto` 安全口径，不新增用户配置。
  理由：这是 VSCode 原生 Terminal 的默认保护思路；仓库当前没有终端设置镜像系统，先用安全默认值可以避免剪贴板尾随换行导致命令直接执行。
  日期/作者：2026-05-09 / Codex

- 决策：Remote SSH / WSL / Dev Container 场景下，复制粘贴快捷键按本地 VSCode UI 平台解释，远端 workspace / PTY OS 只接收最终输入字节。
  理由：VSCode 的 Workbench keybinding、Webview 和 clipboard 语义都贴近用户本地 UI；如果使用远端 `process.platform`，macOS / Windows 用户连到 Linux 后会错误退化成 Linux 快捷键。
  日期/作者：2026-05-09 / Codex

## 结果与复盘

本轮已经完成设计、协议、Webview、Host 和测试收口。用户现在可以在画布内 `Agent` / `Terminal` xterm 聚焦时按本地 VSCode UI 平台的默认规则复制终端选区、请求系统剪贴板粘贴，并在无选区时继续让 `Ctrl+C` 进入 PTY / Agent CLI 作为 interrupt。Remote SSH 到 Linux 时，macOS 本地仍用 `Cmd+C/V`，Windows 本地仍用 Windows 的 `Ctrl+C` 有选区复制 / 无选区打断规则；远端 Linux 只接收最终输入字节。

验证已覆盖纯规则矩阵、协议 validator、TypeScript 类型检查、完整 Webview Playwright 回归和 trusted VSCode smoke。PR review 发现的 blocker 已完成修复：裸 `CR` 粘贴不会绕过多行安全判断，Host 多行确认超过 30 秒后返回的 paste response 不会被 Webview 固定超时丢弃，macOS `Cmd+C` 无终端选区也不会被 xterm handler 吞掉。设计文档的 `validation_status` 已从 `未验证` 更新为 `已验证`，产品规格也更新为“已实现并通过自动化验证”。当前没有发现必须登记到 `docs/exec-plans/tech-debt-tracker.md` 的新增遗留债；本计划仍保留在 `active/`，等待后续提交 / MR 流程前的最终复查。

## 上下文与定向

当前执行节点由三层共同完成。Webview 层在 `src/webview/main.tsx` 中创建 `new Terminal(createEmbeddedTerminalOptions())`，注册 native interaction，打开 xterm，然后通过 `terminal.onData(...)` 把输入回传给 Host。Host 层在 `src/panel/CanvasPanelManager.ts` 中解析 `webview/executionInput`，再由 `writeExecutionInput(...)` 写入 `ExecutionSessionProcess` 或 supervisor session。共享协议位于 `src/common/protocol.ts`，所有 Webview / Host 消息都需要在那里定义和验证。

已有 `src/webview/executionTerminalNativeInteractions.ts` 负责执行终端的 native-like link、拖拽、tooltip 和缩放坐标辅助。复制粘贴快捷键也属于 xterm native interaction，应优先进入这个模块，而不是分散写在 AgentNode / TerminalNode 两套 React effect 中。这样 `Agent` 和 `Terminal` 可以共享一套行为，后续也更容易测试。

VSCode 原生 Terminal 的行为 oracle 锚定到 2026-05-09 upstream commit `9300eb847eaf812841160885d4885ae6dd394d1c`。后续实现者只需要理解用户可观察规则，不需要复刻 VSCode 内部贡献点结构。关键事实是：copy / paste 命令属于 skipped shell command，xterm key handler 会在输入前判断 Workbench 是否应该接管；多行粘贴有安全确认；平台默认快捷键并不相同。

本计划使用的术语如下。`xterm` 指 Webview 内的 `@xterm/xterm` 终端前端；`PTY` 指 Host 或 supervisor 持有的真实伪终端进程；`bracketed paste` 指终端应用启用的一种模式，xterm paste 会用转义序列包裹粘贴文本，使 shell 能把粘贴当作整体处理；`interrupt` 指 `Ctrl+C` 产生的 `\x03` 输入，通常用于打断当前命令或 Agent CLI 当前响应。

## 工作计划

先实现规则纯函数。新增或放置在合适模块中的 helper 应接收 UI 平台、按键形状、是否有 xterm 选区，返回 `copy`、`copyAndClearSelection`、`paste`、`passThrough` 或 `noop`。所有平台差异先由测试锁住，避免直接写进 DOM handler 后难以验证。Remote SSH 下 Host 的 `process.platform` 可能是远端 Linux，不能作为该 helper 的平台输入；平台值应来自 Webview / UI 侧可观测环境或可测试注入。

然后扩展协议。在 `src/common/protocol.ts` 中加入 copy request、paste request、paste text response 和 paste cancelled response。协议需要验证 `nodeId`、`kind`、`requestId`、`text` 和 `bracketedPasteMode`。Host-to-Webview 的 paste response 应能被现有 `window.message` 分发处理。

接着接入 Webview。`setupExecutionTerminalNativeInteractions(...)` 增加 clipboard shortcut options，或直接在 options 中传入 `onCopySelection` / `onRequestPaste`。keyboard handler 只在 xterm 焦点内生效；复制时读取 `terminal.getSelection()`，粘贴时传当前 xterm 实例暴露的 bracketed paste mode 状态。收到 Host paste response 后从 `executionTerminalRegistry` 查找目标 terminal 并调用 `terminal.paste(text)`。

再接入 Host。`CanvasPanelManager` 收到 copy request 后调用 `vscode.env.clipboard.writeText(...)`。收到 paste request 后调用 `vscode.env.clipboard.readText()`，执行固定 `auto` 安全规则，并在需要确认时使用 VSCode 工作台确认入口；确认后发 `host/executionPasteText`，取消或空文本时发 `host/executionPasteCancelled` 或 no-op。Host 在返回粘贴前应确认节点仍存在且处于可输入状态，避免 inactive 节点制造输入错觉。

最后补验证。Playwright 覆盖当前平台的真实 Webview 行为，纯规则测试覆盖三平台矩阵，宿主级 smoke 或手动验证说明覆盖 `vscode.env.clipboard` 实际可用性。如果宿主剪贴板在 CI 不稳定，应保留协议级替代测试并在结果中明确风险。

## 具体步骤

1. 在仓库根目录运行并维护文档：

       docs/product-specs/agent-terminal-clipboard-shortcuts.md
       docs/design-docs/execution-terminal-clipboard-shortcuts.md
       docs/exec-plans/active/execution-terminal-clipboard-shortcuts.md
       docs/product-specs/index.md
       docs/design-docs/index.md
       docs/design-docs/core-beliefs.md

2. 在 `src/webview/` 或 `src/common/` 中新增平台快捷键 helper。若放在 `src/common/`，不得依赖 DOM、React、xterm 或 `vscode`。

3. 更新 `src/common/protocol.ts`：

       WebviewToHostMessage:
         webview/copyExecutionSelection
         webview/requestExecutionPaste

       HostToWebviewMessage:
         host/executionPasteText
         host/executionPasteCancelled

   同步补齐 validator 和必要类型。

4. 更新 `src/webview/executionTerminalNativeInteractions.ts`，把 keyboard handler 作为 setup 的一部分安装和 dispose。若已有 link / drag 逻辑变得过长，可将 clipboard adapter 拆成同目录小模块，但对外仍由 `setupExecutionTerminalNativeInteractions(...)` 统一接线。

5. 更新 `src/webview/main.tsx`，让 Agent / Terminal 在注册 native interactions 时传入 copy / paste callbacks，并在 Host paste response 到达时调用对应 terminal 的 paste。

6. 更新 `src/panel/CanvasPanelManager.ts`，在 message switch 中处理新消息，使用 `vscode.env.clipboard` 读写剪贴板，并实现多行粘贴安全逻辑。

7. 补测试并运行：

       npm run test:execution-terminal-clipboard
       npm run typecheck
       npm run test:webview
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs

   若 smoke 受环境剪贴板限制失败，应记录具体错误和替代验证，不得写成已验证。

## 验证与验收

验收标准来自产品规格和设计文档。必须证明 Windows / Linux / macOS 三个平台的规则矩阵通过纯测试；当前 CI 平台的 Webview 行为能真实触发 copy request、paste request 和无选区 `Ctrl+C` pass-through；Host 粘贴安全规则能阻止未确认多行文本进入 PTY。

具体可观察行为包括：终端选区非空时，平台复制快捷键把选区文本写入剪贴板；Windows `Ctrl+C` 有选区时复制并清选区，无选区时写入 `\x03`；Linux `Ctrl+C` 即使有选区也写入 `\x03`；macOS `Ctrl+C` 始终写入 `\x03`，`Cmd+C` 才复制；粘贴单行文本进入当前 live session；粘贴一条带尾随换行的命令时先去掉尾随换行；其他多行文本未确认时不会进入 PTY。

当前实现已完成上述验收中的自动化部分：纯规则测试覆盖三平台矩阵与粘贴安全预处理；Playwright 覆盖当前平台下 Agent / Terminal 的复制请求、粘贴回包和无选区 `Ctrl+C` pass-through；trusted smoke 验证真实 VSCode 宿主能够加载扩展并通过既有主路径回归。

## 幂等性与恢复

文档和测试修改都是普通增量改动，可重复运行。协议新增必须保持向后兼容：旧 Webview 不会发送新消息，新 Host 不应要求旧消息存在；新 Webview 收到未知 paste response 时应能安全忽略。Host 剪贴板读写失败时不应破坏执行会话，只通过 `host/error` 或诊断记录反馈。

如果 keyboard handler 中途实现出错，恢复方式是移除新增 handler 或让 helper 返回 `passThrough`，这样普通 xterm 输入和 `Ctrl+C` 打断会回到现有行为。不要通过杀掉 PTY、重置画布状态或清空 session 来恢复剪贴板功能问题。

## 证据与备注

调研阶段的关键证据：

    VSCode upstream terminal.clipboard.contribution.ts:
      CopySelection: Ctrl/Cmd+Shift+C，macOS 覆盖为 Cmd+C，要求终端选区。
      CopyAndClearSelection: Windows Ctrl+C，要求终端选区。
      Paste: macOS Cmd+V，Windows Ctrl+V / Ctrl+Shift+V，Linux Ctrl+Shift+V。

    VSCode upstream terminalClipboard.ts:
      单行直接粘贴；bracketed paste mode 直接粘贴；单条命令尾随空白换行时剥离尾随换行；其他多行文本需要确认。

    当前仓库:
      Webview 只有 terminal.onData -> webview/executionInput；Host writeExecutionInput 只按字符串写入 session。

实现与验证阶段的关键证据：

    npm run test:execution-terminal-clipboard
      execution terminal clipboard tests passed

    npm run typecheck
      tsc --noEmit 退出码 0

    npm run test:webview
      127 passed (3.8m)
      Playwright webview tests passed.

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs
      Trusted workspace smoke passed.
      VS Code smoke test passed.

PR review 修复后的补充验证：

    npm run test:execution-terminal-clipboard
      execution terminal clipboard tests passed

    npm run typecheck
      tsc --noEmit 退出码 0

    npm run build && node scripts/run-playwright-webview.mjs -g "terminal copy shortcut|terminal paste shortcut|paste response survives|Ctrl\\+C without terminal selection"
      8 passed (15.1s)

    npm run test:webview
      127 passed (3.8m)
      Playwright webview tests passed.

macOS `Cmd+C` 无选区透传修复后的补充验证：

    npm run test:execution-terminal-clipboard
      execution terminal clipboard tests passed

    npm run typecheck
      tsc --noEmit 退出码 0

## 接口与依赖

需要修改或继续使用的仓库接口如下：

- `src/common/protocol.ts`：新增剪贴板相关消息类型和 validator。
- `src/webview/executionTerminalNativeInteractions.ts`：新增 xterm keyboard shortcut adapter，并在 dispose 时恢复。
- `src/webview/main.tsx`：给 Agent / Terminal 传入复制 / 粘贴 callback，并处理 Host paste response。
- `src/panel/CanvasPanelManager.ts`：处理剪贴板请求，调用 `vscode.env.clipboard` 与 VSCode 确认入口。
- `tests/playwright/webview-harness.spec.mjs`：覆盖 Webview 侧 copy / paste / interrupt 行为。

本轮不引入新 runtime 依赖。若后续为了测试拆出纯 helper，应优先使用现有 Node / Playwright 测试环境，不引入新的键盘事件库。

本次更新说明：2026-05-09 新建计划，完成 VSCode 原生 Terminal 剪贴板逻辑调研，并把本仓库 `Agent` / `Terminal` 执行节点的正式交互口径收口为“Webview 判定快捷键，Host 负责系统剪贴板与粘贴安全，Webview 调用 xterm paste”。

本次更新说明：2026-05-09 04:01Z，完成协议、Webview、Host、测试与验证收口；记录 Remote SSH 本地 UI 平台语义和自动化验证结果。

本次更新说明：2026-05-09 06:33Z，处理 PR review 中的 CR-only 粘贴安全绕过和 Webview 端 paste request 固定超时问题，并记录补充验证结果。

本次更新说明：2026-05-09 06:45Z，处理 PR review 中的 macOS `Cmd+C` 无终端选区被吞掉问题，并记录纯规则验证。
