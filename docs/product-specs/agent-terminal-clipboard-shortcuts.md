# Agent / Terminal 复制粘贴快捷键规格

当前状态：已确认，已实现并通过自动化验证。本文收口画布内 `Agent` / `Terminal` 执行节点在终端焦点下处理复制、文本粘贴、Agent 截图粘贴和 `Ctrl+C` 打断冲突的产品口径；原文本粘贴实现由 `docs/exec-plans/active/execution-terminal-clipboard-shortcuts.md` 跟踪，Agent 截图粘贴实现由 `docs/exec-plans/active/agent-screenshot-paste-input.md` 跟踪。

## 1. 用户问题

当前画布内执行节点已经能承载真实 `xterm` 会话，但用户在节点里按高频的 `Ctrl` / `Cmd` + `C`、`V` 时缺少可预期行为：有时无法复制终端选区，有时无法粘贴剪贴板内容，最危险的是如果把 `Ctrl+C` 简单绑定成复制，会破坏 shell / Agent CLI 依赖的打断语义。随着 Agent 节点承担更多视觉调试和 UI 评审任务，用户还需要把刚截取的屏幕直接交给 Codex / Claude Code，而不是手工保存图片、复制路径再粘贴。目标不是重新发明一套快捷键，而是让用户把 VSCode 原生 Terminal 的肌肉记忆和 Agent 图片输入能力带进画布里的执行节点。

## 2. 目标用户

目标用户是在 VSCode 内同时运行多个 Agent 和终端的开发者。他们通常已经习惯原生 Terminal 的平台差异：macOS 使用 `Cmd` 做复制粘贴，Windows / Linux 需要在复制和 `Ctrl+C` 打断之间保留清楚边界。该能力服务的是高频输入摩擦，不应要求用户理解画布内部的 Webview、Host 或 PTY 分层。

## 3. 核心用户流程

1. 用户在 `Agent` 或 `Terminal` 节点内聚焦终端。
2. 用户拖选终端输出后按平台对应的复制快捷键，选区文本进入系统剪贴板。
3. 用户没有终端选区时按 `Ctrl+C`，按原生 Terminal 语义把打断字符发送给当前 PTY，而不是触发节点停止、删除或画布级复制。
4. 用户按平台对应的粘贴快捷键，系统剪贴板中的文本输入当前执行会话；多行或带尾随换行的文本按安全规则处理，避免未经确认立即执行。
5. 用户在 live `Agent` 节点聚焦时复制一张截图后粘贴，系统把截图保存成当前 Agent CLI 可读取的图片文件，并把图片路径文本插入 Agent 输入行；用户可以继续补充文字并手动提交。
6. 用户焦点在 Note、标题输入框、画布空白区或 VSCode 工作台其他区域时，不套用执行节点终端快捷键。

## 4. 在范围内

- `Agent` 与 `Terminal` 节点共用同一套终端焦点快捷键规则。
- macOS：`Cmd+C` 只在终端选区非空时复制；`Ctrl+C` 始终保留给 shell / Agent CLI 打断；`Cmd+V` 粘贴。
- Windows：终端选区非空时 `Ctrl+C` 复制并清空选区；选区为空时 `Ctrl+C` 发送打断；`Ctrl+V` 和 `Ctrl+Shift+V` 都粘贴。
- Linux：`Ctrl+C` 始终发送打断；`Ctrl+Shift+C` 复制；`Ctrl+Shift+V` 粘贴。
- 复制范围只取当前 xterm 选区；不把画布节点标题、Note DOM 选区或浏览器页面选区混入终端复制。
- 文本粘贴继续使用已验证的 Host 读取剪贴板路径；如果剪贴板没有文本且没有 Agent 支持的图片内容，可以 no-op 或给出轻量错误，不自动把资源 URI 或任意文件对象注入终端。
- 多行文本粘贴使用 VSCode 原生 Terminal 的 `auto` 安全口径：单行直接粘贴；启用 bracketed paste mode 时直接粘贴；按 `CRLF`、裸 `CR` 或裸 `LF` 识别行分隔，单条命令加尾随空白换行时先去掉尾随换行；其他多行粘贴必须显式确认或取消。
- `Agent` 节点支持从剪贴板粘贴 `image/png`、`image/jpeg`、`image/webp` 截图或图片；Webview 读取图片字节，Host 校验并保存到扩展存储，再把图片路径文本粘贴回当前 Agent 输入行。
- Agent 截图文件是临时附件缓存，不是用户资产；默认 7 天 TTL，由独立后台维护任务在低优先级窗口分片清理。清理不绑定启动、panel 激活、截图粘贴、粘贴后立即动作或 Agent 退出；清理失败可以用非阻塞错误提示让用户感知并排查，但不得阻塞或影响当前输入、粘贴、启动或画布交互。
- Agent 截图粘贴不自动提交回车；用户仍需自行补充问题并提交，避免截图一粘贴就触发不可撤销或高成本请求。
- `Terminal` 节点不把图片剪贴板转成 shell 输入；如果同一次粘贴没有文本内容，应取消或提示，而不是向 PTY 写入图片路径。

## 5. 不在范围内

- 不在第一版引入用户可配置快捷键系统，也不读取 VSCode 用户自定义 keybindings 来重写画布规则。
- 不实现 `terminal.integrated.copyOnSelection` 等设置级完整镜像；如果后续需要，应作为独立交互设置评估。
- 不把 `Ctrl+C` 映射为“停止 Agent / Terminal 节点”；节点停止仍通过标题栏按钮或已有 Host 停止入口完成。
- 不在 Linux 默认支持 `Ctrl+V` 粘贴，因为 VSCode 原生 Terminal 默认把 Linux 粘贴放在 `Ctrl+Shift+V`，以避免和 shell 输入语义冲突。
- 不承诺 HTML 富文本复制、选择剪贴板 middle-click paste、右键 `copyPaste` 行为或通用文件资源剪贴板 fallback。
- 不把截图粘贴实现成 Codex / Claude Code 原生 `[Image #N]` chip；第一版以保存图片文件并粘贴路径文本作为跨 provider 最小能力。
- 不在粘贴截图时自动发送 Enter，也不自动替用户生成具体任务提示词。
- 不把截图保存到用户仓库目录或自动纳入版本控制；图片只作为当前 Agent 输入的临时上下文文件。
- 不把临时截图缓存清理绑定到用户输入路径、Agent 生命周期或画布打开路径；清理属于独立后台维护职责。

## 6. 关键对象与状态

- 终端焦点：当前按键目标必须属于 `Agent` / `Terminal` 节点中的 xterm 实例。
- 终端选区：由 xterm 持有的 buffer selection，空白或仅缺少选中文本时视为无选区。
- 平台：以 VSCode UI 运行平台为准，不以 PTY 内部 remote OS 为准；Remote SSH 到 Linux 但本机是 macOS 时，用户仍使用 macOS 的 `Cmd+C` / `Cmd+V`；本机是 Windows 时，用户仍使用 Windows 的 `Ctrl+C` 有选区复制、无选区打断以及 `Ctrl+V` / `Ctrl+Shift+V` 粘贴。
- 打断输入：没有被复制快捷键拦截的 `Ctrl+C` 由 xterm 继续转成 `\x03` 并走现有 `webview/executionInput` -> Host -> PTY 路径。
- 粘贴输入：通过 xterm 的 paste 入口写入当前会话，而不是绕过 xterm 直接拼接到 Host 输入流，这样 bracketed paste 和终端本地状态仍由 xterm 统一处理。
- 图片剪贴板：Webview 能从 `ClipboardEvent.clipboardData` 或浏览器剪贴板富内容 API 读取到的 `image/*` 数据；Host 只接受白名单 MIME、有限大小和可识别 magic number 的图片。
- 图片路径文本：Host 保存截图后返回给 xterm 的本地绝对路径引用；它不包含自动提交回车，并且应尽量 shell-safe，使 Agent CLI 能把它识别为图片路径或普通路径上下文。
- 临时截图缓存维护：后台维护任务只扫描 `execution-image-pastes` 命名空间，按 7 天 TTL 删除过期截图，按更短 TTL 删除中断写入留下的 `.tmp` 文件；单次运行受文件数、扫描量和耗时预算约束，若预算耗尽则短延迟续跑，不把 backlog 拖到固定日频窗口。

## 7. 验收标准

- 在 Windows 语义下，终端选区非空时 `Ctrl+C` 复制并清空选区；终端选区为空时 `Ctrl+C` 向 PTY 写入 `\x03`。
- 在 Linux 语义下，终端选区非空时 `Ctrl+C` 仍向 PTY 写入 `\x03`；`Ctrl+Shift+C` 才复制选区。
- 在 macOS 语义下，终端选区非空时 `Cmd+C` 复制选区；`Ctrl+C` 不论是否有选区都向 PTY 写入 `\x03`。
- `Cmd+V`、Windows `Ctrl+V` / `Ctrl+Shift+V`、Linux `Ctrl+Shift+V` 能把剪贴板文本粘贴进当前 live 执行节点；非 live 节点不得悄悄吞入输入并造成状态错觉。
- 粘贴带尾随换行的单条命令时不会直接执行；多行粘贴在未确认时不会进入 PTY。
- 焦点在 Note、节点标题输入框或画布空白区时，上述终端快捷键规则不抢占原有文本编辑或工作台行为。
- 在 live `Agent` 节点中粘贴支持的截图时，Webview 发出图片粘贴请求，Host 保存图片并返回图片路径文本，最终该路径通过 xterm paste 进入 Agent 输入行；用户没有确认提交前不会自动发送回车。
- 在 `Terminal` 节点中粘贴只有图片的剪贴板时，不应向 shell 写入路径或二进制数据；现有文本粘贴回归仍通过。
- 临时截图缓存清理在后台分片运行；过期文件会被清理，未过期文件和非截图缓存命名文件会保留；清理失败时用户能收到非阻塞错误提示，当前 Agent 交互不受影响。

## 8. 开放问题

- 是否需要在第一版之后读取 `terminal.integrated.sendKeybindingsToShell` / `commandsToSkipShell` 并提供与原生 Terminal 更细粒度一致的配置口径。
- 是否需要把右键复制 / 粘贴、`copyOnSelection`、Linux selection clipboard 和 HTML 复制纳入后续 native parity 范围。
- 多行粘贴确认应使用 Host 侧 VSCode modal / notification，还是在节点内部显示轻量确认条；第一版实现前应在设计文档中保持单一路线，避免 Webview 与 Host 同时弹确认。
- 后续是否需要对 Codex 原生图片附件协议做更深集成，直接在 composer 中形成图片附件，而不是通过路径文本让 CLI 自行识别。
