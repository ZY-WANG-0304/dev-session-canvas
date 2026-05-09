# Agent / Terminal 复制粘贴快捷键规格

当前状态：已确认，已实现并通过自动化验证。本文收口画布内 `Agent` / `Terminal` 执行节点在终端焦点下处理复制、粘贴和 `Ctrl+C` 打断冲突的产品口径；实现由 `docs/exec-plans/active/execution-terminal-clipboard-shortcuts.md` 跟踪。

## 1. 用户问题

当前画布内执行节点已经能承载真实 `xterm` 会话，但用户在节点里按高频的 `Ctrl` / `Cmd` + `C`、`V` 时缺少可预期行为：有时无法复制终端选区，有时无法粘贴剪贴板内容，最危险的是如果把 `Ctrl+C` 简单绑定成复制，会破坏 shell / Agent CLI 依赖的打断语义。目标不是重新发明一套快捷键，而是让用户把 VSCode 原生 Terminal 的肌肉记忆直接带进画布里的 `Agent` / `Terminal`。

## 2. 目标用户

目标用户是在 VSCode 内同时运行多个 Agent 和终端的开发者。他们通常已经习惯原生 Terminal 的平台差异：macOS 使用 `Cmd` 做复制粘贴，Windows / Linux 需要在复制和 `Ctrl+C` 打断之间保留清楚边界。该能力服务的是高频输入摩擦，不应要求用户理解画布内部的 Webview、Host 或 PTY 分层。

## 3. 核心用户流程

1. 用户在 `Agent` 或 `Terminal` 节点内聚焦终端。
2. 用户拖选终端输出后按平台对应的复制快捷键，选区文本进入系统剪贴板。
3. 用户没有终端选区时按 `Ctrl+C`，按原生 Terminal 语义把打断字符发送给当前 PTY，而不是触发节点停止、删除或画布级复制。
4. 用户按平台对应的粘贴快捷键，系统剪贴板中的文本输入当前执行会话；多行或带尾随换行的文本按安全规则处理，避免未经确认立即执行。
5. 用户焦点在 Note、标题输入框、画布空白区或 VSCode 工作台其他区域时，不套用执行节点终端快捷键。

## 4. 在范围内

- `Agent` 与 `Terminal` 节点共用同一套终端焦点快捷键规则。
- macOS：`Cmd+C` 只在终端选区非空时复制；`Ctrl+C` 始终保留给 shell / Agent CLI 打断；`Cmd+V` 粘贴。
- Windows：终端选区非空时 `Ctrl+C` 复制并清空选区；选区为空时 `Ctrl+C` 发送打断；`Ctrl+V` 和 `Ctrl+Shift+V` 都粘贴。
- Linux：`Ctrl+C` 始终发送打断；`Ctrl+Shift+C` 复制；`Ctrl+Shift+V` 粘贴。
- 复制范围只取当前 xterm 选区；不把画布节点标题、Note DOM 选区或浏览器页面选区混入终端复制。
- 粘贴以文本为第一版范围；如果剪贴板没有文本，第一版可以 no-op，不自动把资源 URI 或文件对象注入终端。
- 多行粘贴使用 VSCode 原生 Terminal 的 `auto` 安全口径：单行直接粘贴；启用 bracketed paste mode 时直接粘贴；单条命令加尾随空白换行时先去掉尾随换行；其他多行粘贴必须显式确认或取消。

## 5. 不在范围内

- 不在第一版引入用户可配置快捷键系统，也不读取 VSCode 用户自定义 keybindings 来重写画布规则。
- 不实现 `terminal.integrated.copyOnSelection` 等设置级完整镜像；如果后续需要，应作为独立交互设置评估。
- 不把 `Ctrl+C` 映射为“停止 Agent / Terminal 节点”；节点停止仍通过标题栏按钮或已有 Host 停止入口完成。
- 不在 Linux 默认支持 `Ctrl+V` 粘贴，因为 VSCode 原生 Terminal 默认把 Linux 粘贴放在 `Ctrl+Shift+V`，以避免和 shell 输入语义冲突。
- 不在第一版承诺 HTML 富文本复制、选择剪贴板 middle-click paste、右键 `copyPaste` 行为或文件资源剪贴板 fallback。

## 6. 关键对象与状态

- 终端焦点：当前按键目标必须属于 `Agent` / `Terminal` 节点中的 xterm 实例。
- 终端选区：由 xterm 持有的 buffer selection，空白或仅缺少选中文本时视为无选区。
- 平台：以 VSCode UI 运行平台为准，不以 PTY 内部 remote OS 为准；Remote SSH 到 Linux 但本机是 macOS 时，用户仍使用 macOS 的 `Cmd+C` / `Cmd+V`；本机是 Windows 时，用户仍使用 Windows 的 `Ctrl+C` 有选区复制、无选区打断以及 `Ctrl+V` / `Ctrl+Shift+V` 粘贴。
- 打断输入：没有被复制快捷键拦截的 `Ctrl+C` 由 xterm 继续转成 `\x03` 并走现有 `webview/executionInput` -> Host -> PTY 路径。
- 粘贴输入：通过 xterm 的 paste 入口写入当前会话，而不是绕过 xterm 直接拼接到 Host 输入流，这样 bracketed paste 和终端本地状态仍由 xterm 统一处理。

## 7. 验收标准

- 在 Windows 语义下，终端选区非空时 `Ctrl+C` 复制并清空选区；终端选区为空时 `Ctrl+C` 向 PTY 写入 `\x03`。
- 在 Linux 语义下，终端选区非空时 `Ctrl+C` 仍向 PTY 写入 `\x03`；`Ctrl+Shift+C` 才复制选区。
- 在 macOS 语义下，终端选区非空时 `Cmd+C` 复制选区；`Ctrl+C` 不论是否有选区都向 PTY 写入 `\x03`。
- `Cmd+V`、Windows `Ctrl+V` / `Ctrl+Shift+V`、Linux `Ctrl+Shift+V` 能把剪贴板文本粘贴进当前 live 执行节点；非 live 节点不得悄悄吞入输入并造成状态错觉。
- 粘贴带尾随换行的单条命令时不会直接执行；多行粘贴在未确认时不会进入 PTY。
- 焦点在 Note、节点标题输入框或画布空白区时，上述终端快捷键规则不抢占原有文本编辑或工作台行为。

## 8. 开放问题

- 是否需要在第一版之后读取 `terminal.integrated.sendKeybindingsToShell` / `commandsToSkipShell` 并提供与原生 Terminal 更细粒度一致的配置口径。
- 是否需要把右键复制 / 粘贴、`copyOnSelection`、Linux selection clipboard 和 HTML 复制纳入后续 native parity 范围。
- 多行粘贴确认应使用 Host 侧 VSCode modal / notification，还是在节点内部显示轻量确认条；第一版实现前应在设计文档中保持单一路线，避免 Webview 与 Host 同时弹确认。
