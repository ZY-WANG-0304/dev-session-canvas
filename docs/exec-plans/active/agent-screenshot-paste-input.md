# Agent 截图粘贴输入支持

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/agent-screenshot-paste-input.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更完成后，用户在画布里的 `Agent` 节点聚焦输入区时，可以把系统剪贴板里的截图直接粘贴给正在运行的 Codex 或 Claude Code Agent，而不需要先手工保存文件、复制路径、再组织提示词。用户可观察到的结果是：复制一张截图后在 Agent 节点里按平台粘贴快捷键或触发 paste 事件，Webview 读取图片，Host 把图片保存成当前工作区可访问的临时图片文件，然后把这个图片路径粘贴回 Agent CLI 当前输入行；用户可以继续补充文字并手动提交，现有文本粘贴、多行安全确认和 `Ctrl+C` 打断语义不被破坏。

这项能力只承诺 `Agent` 节点主路径。`Terminal` 节点仍以文本粘贴和资源拖拽为主，不把截图剪贴板自动写入 shell，避免把二进制图片误变成 shell 输入。

## 进度

- [x] (2026-06-23 22:28Z) 已从 `origin/main` 切出主题分支 `agent-screenshot-paste-input`；当前工作树只有既有未跟踪 `image.png`，本计划不触碰它。
- [x] (2026-06-23 22:28Z) 已读取 `docs/WORKFLOW.md`、`docs/workflows/BRANCH.md`、`docs/PLANS.md`、`docs/DESIGN.md`，确认本任务需要同步正式文档和 ExecPlan。
- [x] (2026-06-23 22:28Z) 已调研 Codex 与 Claude Code 图片输入能力，确认两者都支持图片作为 Agent 上下文；Codex 官方手册确认 CLI `--image/-i`、交互 composer 粘贴图片和 IDE 图片拖放，Claude Code 文档确认粘贴图片、拖放图片、`Ctrl+V` / `Alt+V` 图片粘贴和图片路径输入。
- [x] (2026-06-23 22:28Z) 已梳理现有文本粘贴链路：`src/webview/executionTerminalNativeInteractions.ts` 拦截平台粘贴快捷键，`src/webview/main.tsx` 发起 `webview/requestExecutionPaste` 并等待 Host 回包，`src/panel/CanvasPanelManager.ts` 用 `vscode.env.clipboard.readText()` 读取文本并执行多行安全处理。
- [x] (2026-06-23 22:28Z) 已创建本计划，并准备同步产品规格、设计文档和设计索引。
- [x] (2026-06-23 22:28Z) 更新 `docs/product-specs/agent-terminal-clipboard-shortcuts.md`、`docs/design-docs/execution-terminal-clipboard-shortcuts.md`、`docs/design-docs/index.md` 和 `docs/product-specs/index.md`，把截图粘贴从“文本第一版非目标”提升为 Agent 范围内的已选定方案。
- [x] (2026-06-23 22:28Z) 扩展共享协议，新增 Webview 到 Host 的图片粘贴消息，并复用现有 `host/executionPasteText` / `host/executionPasteCancelled` 回包。
- [x] (2026-06-23 22:28Z) 在 Webview 端从 `ClipboardEvent.clipboardData` 或 `navigator.clipboard.read()` 中读取 `image/*`，转成 base64 后发送 Host；没有图片或读取失败时回退现有文本粘贴路径。
- [x] (2026-06-23 22:28Z) 在 Host 端校验 MIME、大小和 base64，写入扩展存储下的 `execution-image-pastes/<nodeId>/`，并把安全引用文本粘贴回 Agent。
- [x] (2026-06-23 22:28Z) 补充协议、纯 helper 与 Playwright 回归测试，运行定向测试、类型检查和 `git diff --check`。
- [x] (2026-06-24 07:20Z) 补充临时截图缓存后台维护方案：7 天 TTL、独立延迟调度、分片预算、budget 耗尽短延迟续跑、清理失败非阻塞错误提示，并补充清理 helper 测试。

## 意外与发现

- 观察：Codex 和 Claude Code 都支持图片上下文，但支持入口不完全相同。Codex 官方手册明确说明可以在交互 composer 粘贴图片或通过命令行 `--image/-i` 附加文件；Codex 源码还显示 composer 对“粘贴的图片路径”有自动附件处理。Claude Code 文档明确说明可以直接粘贴图片、拖放图片，也可以在提示里提供图片路径。
  证据：`/tmp/openai-docs-cache/codex-manual.md` 的 `Image inputs` 段落；`/tmp/openai-codex-source/codex-rs/tui/src/bottom_pane/chat_composer.rs` 的 `handle_paste_image_path(...)`；`/tmp/claude-code-docs/llms-full.txt` 的 `Work with images` 和 `interactive-mode` 快捷键段落。

- 观察：VS Code Extension Host 官方剪贴板 API 当前只在仓库里通过 `vscode.env.clipboard.readText()` / `writeText()` 用于文本；如果要拿到截图字节，必须在 Webview 侧处理浏览器剪贴板事件或 `navigator.clipboard.read()`，不能只改 Host 侧现有文本粘贴 handler。
  证据：仓库当前只有 `src/panel/CanvasPanelManager.ts` 使用 `vscode.env.clipboard.readText()`，没有图片剪贴板 API 调用。

- 观察：当前 xterm key handler 会在识别粘贴快捷键后 `preventDefault()` 并返回 `false`，这会让浏览器默认 paste 事件不可靠；因此实现不能只依赖 `paste` 事件，还需要在快捷键分支中主动尝试 `navigator.clipboard.read()`，失败或无图片时再走原文本粘贴请求。
  证据：`src/webview/executionTerminalNativeInteractions.ts` 中现有 `action === 'paste'` 分支先 `event.preventDefault()` / `event.stopPropagation()`，再调用 `onRequestPaste(...)`。

- 观察：Terminal 节点收到 image-only `paste` 事件时，xterm 默认 paste handler 会继续派发一个空字符串输入；如果不阻止该事件，会出现一次空 `webview/executionInput`。
  证据：首次运行 `npm run test:webview -- --grep "paste"` 时，新增 Terminal 图片剪贴板用例收到 `data: ""` 的 `webview/executionInput`，随后改为 image-only 且无 text/plain 时在 Webview 侧 `preventDefault()`。

- 观察：临时截图缓存清理不适合绑定启动、panel 激活、截图粘贴或 Agent 退出；成熟后台清理更像独立维护器，按 TTL、预算和重试策略分片运行，并把失败以非阻塞方式暴露给用户。
  证据：调研 `systemd-tmpfiles`、`git maintenance`、Kubernetes GC 与浏览器 storage eviction 后，当前设计采用独立低优先级维护器，而不是把清理塞进用户输入路径。

## 决策记录

- 决策：本次只把截图粘贴开放给 `Agent` 节点，`Terminal` 节点继续使用文本粘贴和文件拖拽，不自动把图片剪贴板转成 shell 输入。
  理由：用户问题是“粘贴到 Agent 中”，而 shell 对图片路径没有统一语义；把截图转成 shell 输入容易造成误执行或状态错觉。
  日期/作者：2026-06-23 / Codex

- 决策：Webview 负责读取剪贴板图片字节，Host 负责验证、落盘和返回要粘贴的路径文本。
  理由：图片字节只能从浏览器剪贴板事件或 Webview 的 `navigator.clipboard.read()` 可靠获得；Host 更适合管理文件系统、安全限制、诊断事件和 Agent provider 信息。
  日期/作者：2026-06-23 / Codex

- 决策：Host 返回图片文件路径文本，不自动提交回车。
  理由：Codex composer 已有图片路径自动附件能力，Claude Code 文档确认图片路径是可用输入方式；不自动提交能保留用户继续补充问题的空间，也避免截图一粘贴就触发昂贵或错误的 Agent 请求。
  日期/作者：2026-06-23 / Codex

- 决策：保存文件采用扩展存储路径 `execution-image-pastes/<nodeId>/`，文件名包含 UTC 时间戳和随机后缀，并限制为常见安全图片 MIME。
  理由：扩展存储对 Host 与 Agent CLI 都可见，避免污染用户仓库；随机文件名降低冲突风险；MIME 与大小限制防止把任意二进制或过大 payload 通过 Webview 消息写入磁盘。
  日期/作者：2026-06-23 / Codex

- 决策：临时截图缓存清理采用独立后台维护器，默认 7 天 TTL；不绑定启动、panel 激活、截图粘贴、粘贴后立即动作或 Agent 退出。
  理由：启动和打开路径不应承担维护成本，截图粘贴是低延迟输入路径且不是可靠触发器，Agent 退出时图片仍可能被后续复盘引用；独立维护器能在低优先级窗口分片运行，并在失败时用非阻塞错误提示让用户感知。
  日期/作者：2026-06-24 / Codex

## 结果与复盘

本轮已完成设计、协议、Webview、Host、测试、临时缓存后台维护和文档同步。用户现在可以在 live `Agent` 节点中粘贴剪贴板截图，系统会把支持的 PNG / JPEG / WebP 图片保存到扩展存储的 `execution-image-pastes/<nodeId>/` 下，并把 shell-safe 图片路径文本插入 Agent 输入行；用户仍需自行补充提示并手动提交。`Terminal` 节点 image-only 粘贴不会写入 shell。过期截图缓存由独立后台维护器按 7 天 TTL 分片清理，清理失败会非阻塞提示用户但不影响当前交互。已验证命令包括 `npm run test:execution-terminal-clipboard`、`npm run test:protocol-webview-messages`、`npm run typecheck`、`npm run test:webview -- --grep "paste"` 和 `git diff --check`。当前没有发现必须登记到 `docs/exec-plans/tech-debt-tracker.md` 的新增遗留债。

## 上下文与定向

当前执行节点由 Webview 和 Host 两侧组成。Webview 的 `src/webview/main.tsx` 创建 `@xterm/xterm` 终端实例，并把输入通过 `webview/executionInput` 发给 Host。`src/webview/executionTerminalNativeInteractions.ts` 负责 xterm 里的原生交互，包括链接、拖拽、复制、文本粘贴快捷键和剪贴板诊断。Host 的 `src/panel/CanvasPanelManager.ts` 解析 Webview 消息，管理 Agent / Terminal 运行时会话，并通过 `vscode.env.clipboard` 处理文本剪贴板。

现有文本粘贴是异步 request / response：Webview 生成 `requestId` 后发送 `webview/requestExecutionPaste`；Host 读取文本剪贴板并执行多行安全处理；Host 返回 `host/executionPasteText`；Webview 查找仍存在的 xterm 并调用 `terminal.paste(text)`。截图粘贴应复用这个回包形态，保证 bracketed paste、xterm 本地状态和 pending request 清理仍走同一机制。

本计划使用的术语如下。`ClipboardEvent` 指浏览器在粘贴时提供的 DOM 事件，可能携带 `clipboardData.items` 或 `clipboardData.files`。`navigator.clipboard.read()` 指浏览器异步读取剪贴板富内容的 API，在 VS Code Webview 中可能因权限或平台而失败。`base64` 指 Webview 把图片字节编码成纯文本后通过 `vscode.postMessage` 发给 Host 的传输格式。`图片路径文本` 指 Host 保存图片后返回给 xterm 的本地文件路径；它不是二进制图片本身，也不会自动包含回车。

## 工作计划

先更新文档。产品规格要把原先“粘贴以文本为第一版范围”的口径补充为“文本粘贴已完成，Agent 截图粘贴进入当前范围”；设计文档要记录 Codex / Claude Code 支持矩阵、Webview / Host 分层、Terminal 非目标、文件保存位置、大小和 MIME 限制；索引要同步关联本 ExecPlan。

然后扩展协议。`src/common/protocol.ts` 需要新增一个 `ExecutionImagePasteMimeType` 类型、图片粘贴 payload 类型，以及 `webview/pasteExecutionImage` 消息 validator。该消息至少包含 `requestId`、`nodeId`、`kind`、`mimeType`、`dataBase64` 和 `sizeBytes`。validator 只做结构和粗粒度大小检查，真正的字节和 magic number 校验在 Host 完成。Host 回包继续使用现有 `host/executionPasteText` 和 `host/executionPasteCancelled`。

接着实现 Webview。`setupExecutionTerminalNativeInteractions(...)` 增加 `onPasteImage` callback。paste 快捷键分支如果当前 `kind` 是 `agent`，先通过 `navigator.clipboard.read()` 尝试读取第一张支持的图片；如果读到图片，转换成 base64 并发送 Host，同时不再请求文本粘贴；如果没有读到图片或 API 不可用，继续调用现有 `onRequestPaste(...)`。同时在 `dropTarget` 上增加 `paste` 事件监听，优先处理 `event.clipboardData` 中的图片，以覆盖菜单粘贴或测试注入路径。

再实现 Host。`CanvasPanelManager` 收到 `webview/pasteExecutionImage` 后，必须确认目标是 live `Agent` 会话，拒绝 `Terminal`。Host 校验 MIME 属于 `image/png`、`image/jpeg` 或 `image/webp`，解码 base64，校验字节大小和图片 magic number，保存到 `getExtensionStoragePath()/execution-image-pastes/<nodeId>/`。保存成功后按 provider 返回路径文本，例如 shell-safe 单引号包裹的绝对路径加一个尾随空格；不返回回车。失败时发 `host/executionPasteCancelled` 并通过 `host/error` 提示用户。临时截图缓存清理由独立后台维护器完成：扩展激活后延迟进入低优先级维护窗口，按 7 天 TTL 清理过期截图，按更短 TTL 清理 `.tmp`，并受文件数、扫描量和耗时预算约束；预算耗尽时短延迟续跑，清理失败时记录诊断并弹非阻塞错误提示。

最后补测试。纯协议测试覆盖合法与非法图片消息；纯 helper 测试覆盖 MIME、文件扩展名、base64 解码、路径引用格式、TTL 删除资格、临时文件 TTL、清理预算和非截图文件保留。Playwright 覆盖 Agent paste 事件携带 PNG 文件时发出 `webview/pasteExecutionImage`，Host 回包后进入 xterm 输入链路；同时确认现有文本粘贴测试仍通过。真实 VS Code 手动验证如环境允许再记录。

## 具体步骤

在仓库根目录执行以下命令完成实现与验证：

    npm run test:execution-terminal-clipboard
    npm run test:protocol-webview-messages
    npm run test:webview -- --grep "paste"
    npm run typecheck
    git diff --check

如果 `npm run test:webview -- --grep "paste"` 因本地 Playwright 环境问题失败，需要记录错误、保留已通过的纯测试和类型检查，并说明未覆盖的真实 Webview 行为。不得把未运行的 smoke 写成已验证。

## 验证与验收

验收标准是用户在 live `Agent` 节点中粘贴截图时，图片不会被当作空文本吞掉，也不会直接提交执行。Webview 应发出 `webview/pasteExecutionImage`；Host 应保存图片并返回一段可见路径文本；Webview 应通过 `terminal.paste(text)` 注入当前 Agent 输入；用户随后可以继续输入“分析这张图”等文字并手动回车。

必须保留现有文本粘贴能力：系统剪贴板只有文本时，仍走 `webview/requestExecutionPaste`，多行安全确认规则不变；`Ctrl+C` 打断规则不变；非 live Agent 粘贴图片时必须取消并提示；Terminal 节点粘贴图片不应写入 shell。临时截图缓存清理不应绑定用户输入路径；清理失败可以提示用户，但提示必须非阻塞且不影响当前 Agent 交互。

## 幂等性与恢复

文档、协议和测试修改可以重复执行。图片落盘使用随机文件名，重复粘贴不会覆盖旧文件。后台维护器只删除 `execution-image-pastes` 命名空间中符合截图缓存命名且超过 TTL 的文件；单次预算耗尽时后续维护窗口继续，不一次性扫完整目录。若 Webview 图片读取失败，必须回退文本粘贴或给出轻量错误，而不是破坏终端输入。若 Host 校验失败，必须取消对应 `requestId`，避免 Webview pending request 泄漏。

如果实现中发现 `navigator.clipboard.read()` 在部分 VS Code Webview 上不可用，paste 事件路径仍应保留；如果两条图片路径都不可用，功能可以降级为现有文本粘贴，并在设计文档中记录该环境限制。

## 证据与备注

当前调研证据摘录：

    Codex CLI help:
      -i, --image <FILE>... Optional image(s) to attach to the initial prompt

    Codex manual Image inputs:
      可以在交互 composer 粘贴图片，或在命令行通过 --image/-i 提供图片文件。

    Claude Code Work with images:
      支持拖放图片、在 CLI 中用 ctrl+v 粘贴图片，以及提供图片路径。

验证输出：

    npm run test:execution-terminal-clipboard
      execution terminal clipboard tests passed

    npm run test:protocol-webview-messages
      protocol webview message tests passed

    npm run typecheck
      tsc --noEmit 退出码 0

    npm run test:webview -- --grep "paste"
      6 passed
      Playwright webview tests passed.

    git diff --check
      退出码 0

## 接口与依赖

需要修改或继续使用的仓库接口如下：

- `src/common/protocol.ts`：新增图片粘贴消息类型和 validator。
- `src/common/executionTerminalClipboard.ts`：新增图片粘贴 MIME、base64、文件名和路径引用 helper。
- `src/webview/executionTerminalNativeInteractions.ts`：新增图片剪贴板读取和 paste 事件处理。
- `src/webview/main.tsx`：新增图片 paste request 发送，并复用 pending paste response 路由。
- `src/panel/CanvasPanelManager.ts`：处理图片粘贴消息、保存图片文件、返回路径文本，并调度临时截图缓存后台维护。
- `src/panel/executionImagePasteCacheMaintenance.ts`：独立执行临时截图缓存 TTL 判断、分片扫描与删除预算。
- `scripts/test/test-execution-terminal-clipboard.mts`、`scripts/test/test-protocol-webview-messages.mts`、`tests/playwright/webview-harness.spec.mjs`：补充自动化验证。

本轮不引入新的 runtime 依赖。图片字节处理使用浏览器 `Blob` / `FileReader` 或 `arrayBuffer()`，Host 侧使用 Node `Buffer`、`fs` 和 `path`。

本次更新说明：2026-06-23 创建计划，收口 Codex / Claude Code 支持情况、本仓库现有粘贴链路和截图粘贴正式实现路线。

本次更新说明：2026-06-23 22:28Z，完成 Agent 截图粘贴实现、文档同步与自动化验证，记录 Terminal image-only paste 的空输入发现和修复。

本次更新说明：2026-06-24 07:20Z，补充临时截图缓存独立后台维护策略与实现，避免把清理绑定到启动、panel 激活、截图粘贴或 Agent 退出，并记录非阻塞错误提示要求。
