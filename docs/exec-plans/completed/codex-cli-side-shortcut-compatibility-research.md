# Codex CLI `/side` 快捷键兼容性调研

本 `ExecPlan` 是活文档。随着工作推进，必须持续维护 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文件遵循仓库根目录 `docs/PLANS.md`。

## 目标与全局图景

用户在画布 Agent 节点内运行 Codex CLI 时，希望使用 Codex 新增的 `Ctrl+/` 快捷键切换侧聊。本次工作要查明当前 Codex CLI 的快捷键、插件如何处理键盘事件，以及该组合键是否在到达 Codex 前被吞掉。结束后，读者应能从本文档看到证据链、根因置信度、尚未验证的边界和可复现的后续验证步骤。

本轮只完成调研和正式文档同步，不修改运行时代码。根因要分清“仓库代码已能证明”与“用户现场尚未复现”：不能仅凭当前 CLI 文档或一段源码，就宣称所有操作系统和键盘布局都有相同表现。

## 进度

- [x] (2026-11-01 04:03Z) 从最新 `origin/main` 创建隔离工作树与分支 `docs-codex-cli-side-shortcut`；原工作树存在的其他未提交文件保持不变。
- [x] (2026-11-01 04:03Z) 查询并打开 OpenAI Docs 的 Codex CLI 命令/快捷键文档；确认 `/side` 与 `/keymap` 已有说明，但官方页面没有给出 `Ctrl+/` 默认绑定。
- [x] (2026-11-01 04:03Z) 检查本机 `codex-cli 0.166.0` 的 `/keymap`，确认 `Global / Toggle Side Conversation / ctrl-/`，并记录 keymap 页面统计。
- [x] (2026-11-01 04:03Z) 跟踪插件从 Webview 键盘事件到 PTY 的处理路径，并按锁定版本检查 xterm.js `6.0.0` 键盘映射。
- [x] (2026-11-01 04:03Z) 更新终端快捷键设计文档及注册表，写明代码级高置信根因、焦点边界与真实 Webview 验证缺口。
- [x] (2026-11-01 04:03Z) 完成本轮调研记录；不实现快捷键修复，待后续受控验证决定编码适配方案。

## 意外与发现

- 观察：本机 Codex CLI 当前版本是 `0.166.0`；交互式 `/keymap` 列出 154 个 action、0 个自定义绑定、6 个未绑定项。`Global / Toggle Side Conversation` 的默认绑定为 `ctrl-/`，另有 `Global / Leader` 为 `ctrl-x`。
  证据：在空目录启动本机 Codex TUI 后运行 `/keymap`，页面直接显示以上内容。该结果限定于调研时的本机二进制，不代表所有用户版本、配置或平台。
- 观察：OpenAI Docs 将 `/side` 描述为启动临时 side chat，将 `/keymap` 描述为检查和保存 TUI 快捷键；当前页面未列出 `ctrl-/` 默认值。
  证据：[Developer commands](https://learn.chatgpt.com/docs/developer-commands) 的 `/side`、`/keymap`、Interactive shortcuts 章节。
- 观察：执行节点使用 xterm.js `6.0.0`。插件的自定义 key handler 只处理复制/粘贴；其他按键透传给 xterm。xterm 的 `evaluateKeyboardEvent` 对斜杠没有 Ctrl 组合映射，未生成 `result.key` 时 `_keyDown` 会在触发输入事件前返回。
  证据：锁文件 `package-lock.json` 的 `node_modules/@xterm/xterm` 条目；对应 xterm `6.0.0` 源码 `src/common/input/Keyboard.ts` 中 keyCode `191` 的斜杠定义和 Ctrl 特殊键映射、`src/browser/CoreBrowserTerminal.ts` 中 `if (!result.key) return true` 路径。插件落点见 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts`、`executionSessionNodes.tsx`。
- 观察：键盘焦点可能形成另一条“巧合”路径。Note 可编辑字段只向外透传 Ctrl/Cmd+C/X/V/Z/Y 等编辑快捷键，其他按键会停止冒泡；如果焦点不在 Agent xterm，`Ctrl+/` 不会走执行节点输入路径。
  证据：`extensions/vscode/dev-session-canvas/src/webview/canvasUiSurface.tsx` 中的 `handleEditableFieldKeyDown` 和 `shouldAllowTextEditingShortcutToBubble`。
- 观察：尚未在真实 VS Code Webview 内同时记录 DOM `KeyboardEvent` 与 `terminal.onData`，因此布局差异、Webview 到工作台的事件冒泡，以及用户安装版本的具体表现仍需现场复现。
  证据：本轮运行了本机 TUI 的 `/keymap` 并检查锁定 xterm 源码；没有启动真实 VS Code Webview，也没有运行自动化测试。

## 决策记录

- 决策：本轮只记录调研结论，不直接在 `attachCustomKeyEventHandler` 中注入 `Ctrl+/` 兼容输入。
  理由：需要先确认 Codex CLI 对收到的 PTY 字节/增强键盘序列的识别，以及目标操作系统和键盘布局；否则可能误触发、破坏终端输入或只修复一个布局。
  日期/作者：2026-11-01 / Codex。
- 决策：将 `Ctrl+/` 不生效记录为“锁定 xterm 版本中的代码路径高度可疑，真实扩展现场尚待确认”，而不是已完成端到端复现的故障结论。
  理由：CLI 的默认绑定已从当前二进制确认，xterm 6.0.0 源码没有对应输入映射；但用户的 CLI 版本、焦点和键盘布局未知。
  日期/作者：2026-11-01 / Codex。

## 结果与复盘

调研确认 Codex CLI `0.166.0` 的默认全局侧聊切换快捷键是 `Ctrl+/`，并确认仓库现有剪贴板 handler 不主动拦截该组合键。更可能的断点位于 xterm.js `6.0.0`：DOM 按键未形成 PTY 输入，因此 CLI 收不到该快捷键。Note 编辑字段拦截非白名单组合键是另一个依赖焦点的路径。

本轮没有完成真实 Webview 的按键到 PTY 端到端复现，也没有选择正式修复。后续验证应记录目标操作系统、键盘布局、Codex CLI 版本和焦点；在 xterm key handler 与 `terminal.onData` 两侧对同一次输入做无敏感内容的诊断。再比较可行的兼容序列或 `/keymap` 替代绑定，之后另建实现计划。

## 上下文与定向

DevSessionCanvas 的 Agent 与 Terminal 节点在 Webview 中使用 xterm.js 呈现终端。`extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 为 xterm 安装复制/粘贴键盘适配；`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 在 Agent 和 Terminal 实例上通过 `terminal.onData` 接收 xterm 输出的输入数据并交给 Host/runtime。Host 再把输入写入对应的伪终端（PTY）。

“快捷键没到 CLI”至少有三种不同含义：DOM 事件被 Webview/工作台拦截；xterm 收到按键但不编码为终端数据；PTY 收到数据但 Codex CLI 不识别。只查插件事件 handler 不能区分这三种情况。

## 工作计划

先确认当前官方文档范围和实际 Codex CLI 版本，再从干净工作树检查插件的键盘事件路径。随后使用锁定的 xterm 版本源码判断斜杠组合键是否会进入 `terminal.onData`，并检查画布其他键盘 handler 是否会在某些焦点下截断事件。最后将证据和不确定性更新进既有快捷键设计文档，并同步索引。本计划不包含任何运行时代码更改。

## 具体步骤

以下命令从仓库根目录 `/tmp/dev-session-canvas-codex-shortcut` 执行：

1. `git fetch origin` 后确认 `origin/main`，通过 `git worktree add -b docs-codex-cli-side-shortcut /tmp/dev-session-canvas-codex-shortcut origin/main` 建立隔离分支。原用户工作树不做清理或切换。
2. 从 `https://learn.chatgpt.com/docs/developer-commands` 查阅 CLI `/side`、`/keymap` 和交互快捷键文档。
3. 执行 `codex --version`，在空目录启动 TUI 并运行 `/keymap`，只读查看默认快捷键，不保存自定义配置。
4. 检查 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts`、`executionSessionNodes.tsx`、`canvasUiSurface.tsx` 以及 `package-lock.json` 的 xterm 版本。按锁定版本源码核对 Ctrl 加斜杠是否会生成终端输入。
5. 更新 `docs/design-docs/execution-terminal-clipboard-shortcuts.md` 的附加调研章节和 `docs/design-docs/index.md` 注册项；结果明确标记真实 Webview 验证缺口。

## 验证与验收

研究结果只有在以下可复核条件同时成立时才算完成：本机 `/keymap` 明确显示 `Toggle Side Conversation / ctrl-/`；插件代码可追踪出 xterm 自定义 handler、xterm 键盘映射和 `terminal.onData` 的先后关系；正式设计文档与索引同步，并将代码证据和现场不确定性分开写。

本轮不运行自动化测试。真实 VS Code Webview 端到端验证是后续工作，建议在不同操作系统/布局与目标 CLI 版本中分别观察 `KeyboardEvent.key/code/modifier` 和 `terminal.onData` 是否产生字节。未经该验证，不应把某种终端控制序列视为正式兼容方案。

## 幂等性与恢复

文档调查可重复执行。操作只涉及隔离 worktree、只读查看 CLI keymap、检查源代码和更新 Markdown 文档。若后续实现验证失败，应移除新增按键适配并恢复原先所有非剪贴板按键透传给 xterm 的行为；不得通过清空会话、重启 PTY 或更改用户全局 Codex 配置恢复。

## 证据与备注

本机 TUI keymap 的关键行：

    154 actions, 0 customized, 6 unbound
    Global  Toggle Side Conversation  ctrl-/
    Global  Leader                   ctrl-x

插件代码路径：

    executionTerminalNativeInteractions.ts:455  clipboard handler; unmatched keys return true
    executionSessionNodes.tsx:621,1360           Agent / Terminal terminal.onData
    package-lock.json                            @xterm/xterm 6.0.0

xterm 6.0.0 的关键行为：物理斜杠的键码是 191；Ctrl 特殊映射不包含该键。`evaluateKeyboardEvent` 无 `result.key` 时，`CoreBrowserTerminal._keyDown` 提前返回，不触发 xterm data event。

本文件变更说明（2026-11-01）：首次记录 `/side` 默认绑定与插件/xterm 输入链路调研，用于将下一步验证建立在可追踪证据上。

## 接口与依赖

本轮没有新增接口或依赖。涉及的现有路径是：浏览器 `KeyboardEvent` → `terminal.attachCustomKeyEventHandler` → xterm `evaluateKeyboardEvent` → `terminal.onData` → `webview/executionInput` → Host/runtime PTY。所有新增或修改代码（如未来获批实现）都必须位于该路径并用真实终端数据验证，不应直接把 UI 显示层的快捷键状态伪装成 CLI 已收到输入。
