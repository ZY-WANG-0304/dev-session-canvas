# 执行节点补齐 VSCode 原生 Terminal 的拖拽输入与链接跳转

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/completed/execution-node-terminal-native-interactions.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要把画布里的 `Terminal` 与 `Agent` 节点补齐两项 VSCode 原生 Terminal 已有的标准交互：从 Explorer 拖拽文件到终端后把路径文本插入当前会话，以及在终端输出里识别文件路径和 URL 并支持点击跳转。完成后，用户在画布里操作执行节点时，不需要为了“拖一个文件路径进去”或“点开终端里打印出来的文件/网址”再切回 VSCode 原生 Terminal。

用户可见的最终验收标准有两组。第一组是拖拽：把 Explorer 里的单个文件拖到任一执行节点的终端区域后，当前会话会收到与 VSCode 原生 Terminal 一致的路径文本输入；多文件拖拽时行为与源码一致，只消费第一个文件。第二组是链接：节点里的终端输出出现文件路径或 `http/https` URL 时，鼠标悬停会出现与 VSCode 原生 Terminal 同类的下划线和修饰键提示；按要求的修饰键点击后，文件会在编辑器中打开并跳到对应行列，URL 会走 VSCode 的 opener 路径。

## 进度

- [x] (2026-04-17 14:47 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md`、`docs/FRONTEND.md` 以及现有终端/Agent 设计文档，确认本任务属于跨宿主与 Webview 的交付性改动，需要独立 `ExecPlan` 与正式设计记录。
- [x] (2026-04-17 14:55 +0800) 检查当前工作树并从 `main` 切出主题分支 `execution-node-terminal-native-interactions`。
- [x] (2026-04-17 15:25 +0800) 直接对照 VSCode 源码，确认原生 Terminal 的拖拽链路、路径准备逻辑、`registerLinkProvider` 链路和 opener 调用方式。
- [x] (2026-04-17 15:45 +0800) 新增正式设计文档并同步索引，记录本轮与 VSCode 源码对齐的结论。
- [x] (2026-04-17 17:20 +0800) 在协议与运行时上下文中补齐执行节点拖拽/链接交互所需的消息、配置和测试动作定义。
- [x] (2026-04-17 17:55 +0800) 在 Webview 中为 `Agent` / `Terminal` 两类节点接入统一的拖拽路径输入、xterm Link Provider、tooltip 与测试钩子。
- [x] (2026-04-17 18:20 +0800) 在宿主侧实现拖拽路径准备、文件链接解析与 URL/文件打开动作，并把打开/拖拽行为接回 `CanvasPanelManager`。
- [x] (2026-04-17 18:45 +0800) 补充 Playwright 与 VS Code smoke 验证，并根据结果更新文档状态、结果与技术债。
- [x] (2026-04-17 08:54 +0800) 完成第二轮收口：拖拽后恢复终端焦点；文件链接改为“Webview 先检测候选，宿主按节点上下文解析成功后才暴露为可点击链接”；相对路径解析收紧为仅相对当前会话 `cwd`；宿主 helper 拆分为 prepare / resolve / open 三层，并统一目录打开策略。
- [x] (2026-04-17 08:54 +0800) 重新运行 `npm run typecheck`、`npm run test:webview` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`，确认第二轮收口没有引入 Webview 或真实宿主回归。

## 意外与发现

- 观察：VSCode 当前原生 Terminal 的文件拖拽不是把路径直接塞给 `xterm.paste()`，而是 `TerminalInstanceDragAndDropController.onDropFile -> TerminalInstance.sendPath(path, false) -> preparePathForShell(...) -> sendText(...) -> processManager.write(...)`。
  证据：`microsoft/vscode` `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts` 第 1253-1258、1360-1396、2536-2616 行。

- 观察：VSCode 当前原生 Terminal 的拖拽实现消费的不是 workspace 相对路径，而是从 `DataTransfers.RESOURCES` / `CodeDataTransfers.FILES` / `dataTransfer.files[0]` 取到的第一个文件 URI 或文件系统路径，再由 `preparePathForShell` 做 shell 级转义。
  证据：`terminalInstance.ts` 第 2595-2616 行和 `src/vs/workbench/contrib/terminal/common/terminalEnvironment.ts` 第 320-379 行。

- 观察：VSCode Terminal 的链接检测不是 xterm 内置 web-links addon 直出，而是 `TerminalLinkContribution -> TerminalLinkManager` 注册多组 `registerLinkProvider`，其中本地文件、URI、普通单词和外部 provider 都走 xterm 的 `ILinkProvider`。
  证据：`src/vs/workbench/contrib/terminalContrib/links/browser/terminal.links.contribution.ts` 与 `terminalLinkManager.ts` 第 44-107、397-423 行。

- 观察：VSCode 的文件链接打开逻辑分成“解析/验证”和“打开”两层：检测阶段会尽量确认 link 是否存在；打开阶段文件走 `editorService.openEditor`，URL 走 opener service，而不是简单 `openExternal`。
  证据：`terminalLocalLinkDetector.ts`、`terminalLinkResolver.ts`、`terminalLinkOpeners.ts`。

- 观察：当前仓库里的 `Agent` 节点运行的是直接 PTY 启动的 provider CLI，不是 shell 包一层；因此把 VSCode Terminal 的 shell path 准备逻辑直接原封不动搬到 Agent 节点，会出现“CLI 会话收到 shell 风格转义文本”的语义差异。
  证据：`src/panel/CanvasPanelManager.ts` 第 3948-3985 行显示 `buildAgentLaunchSpec()` 直接以 `spec.command` 作为 PTY `file`。

- 观察：xterm 的 `registerLinkProvider` 支持异步 `provideLinks`；因此文件链接可以先在 Webview 侧做候选检测，再等宿主按 `cwd` 和文件存在性完成解析后才返回可点击链接，不需要先暴露伪阳性链接再在点击时失败。
  证据：`src/webview/executionTerminalNativeInteractions.ts` 中 `collectFileLinks()` 会先调用 `resolveExecutionFileLinksForContext()`，只有宿主返回 `resolvedLinks` 后才映射成 `ILink`；`tests/playwright/webview-harness.spec.mjs` 的文件链接激活回归依赖同一链路通过。

## 决策记录

- 决策：本轮以 VSCode 源码行为为准，而不是以需求文字中的“workspace 相对路径”表述为准。
  理由：源码已经明确显示原生 Terminal 消费的是拖拽文件的 URI/文件系统路径，并通过 `preparePathForShell` 生成要写入 PTY 的文本。继续把“workspace 相对路径”写成既定事实会把未确认内容写成结论。
  日期/作者：2026-04-17 / Codex

- 决策：拖拽能力采用 Webview 原生 `DragEvent` + `DataTransfer` 读取 Explorer/文件系统拖拽数据，再通过宿主消息让 Extension Host 负责准备最终输入文本。
  理由：VSCode 原生 Terminal 也是 DOM drag-and-drop 入口；路径准备必须在宿主侧完成，才能复用 shell/平台相关逻辑，并为未来 remote/Windows 路径差异保留空间。
  日期/作者：2026-04-17 / Codex

- 决策：链接检测采用 xterm `registerLinkProvider`，不在 React 层扫描“最近输出字符串”。
  理由：这与 VSCode 原生 Terminal 的实现分层一致，也能天然支持悬停下划线、激活回调和 wrapped line 处理。
  日期/作者：2026-04-17 / Codex

- 决策：URL 打开走 `vscode.commands.executeCommand('vscode.open', uri)`，文件打开走 `workspace.openTextDocument + window.showTextDocument`。
  理由：VSCode 内部终端对 URL 走 opener service；扩展 API 不直接暴露该服务，但 `vscode.open` 会委托到 `_workbench.open`，再转给 opener service，从而比 `env.openExternal` 更接近“由 VSCode opener/配置决定”的原生行为。
  日期/作者：2026-04-17 / Codex

- 决策：Agent 节点与 Terminal 节点共享同一套拖拽与链接 UI 机制，但宿主侧保留“按节点 kind 决定路径准备/解析策略”的空间。
  理由：两类节点都属于 execution runtime window；UI 行为应一致，但 Agent 直接运行 CLI，不等于 shell，会话语义不能被默认为与终端 shell 完全相同。
  日期/作者：2026-04-17 / Codex

- 决策：文件链接在 Webview 侧只做候选检测，不在宿主验证前暴露为可点击链接。
  理由：这更接近 VSCode Terminal “检测/解析/打开”三层分工，也修复了此前仓库实现里“看起来能点、但点击后才发现不存在”的伪阳性问题。
  日期/作者：2026-04-17 / Codex

- 决策：相对文件路径解析收紧为仅相对当前会话 `cwd`，不再遍历 workspace 或做全局 `findFiles` fallback。
  理由：VSCode 原生 Terminal 的 local link 解析以终端上下文为核心，而不是“整个 workspace 找一个同名文件”；继续做 workspace 级兜底会让嵌入式终端出现原生没有的误命中。
  日期/作者：2026-04-17 / Codex

- 决策：宿主 helper 按 prepare / resolve / open 分层，并把目录打开统一收口为“workspace 内目录 `revealInExplorer`，workspace 外目录 `vscode.openFolder(..., true)`”。
  理由：这完成了第二轮建议修复中的结构收口，避免 `CanvasPanelManager` 继续承载过多终端原生交互细节，也让目录链接策略在真实文件打开路径上保持单点实现。
  日期/作者：2026-04-17 / Codex

## 结果与复盘

本轮已完成执行节点原生交互对齐的第二轮收口。第一轮交付的拖拽输入与链接跳转能力仍保留；第二轮则补齐了全部 must fix 与前两个建议修复：拖拽后自动把焦点放回当前 xterm，会话外观与原生 Terminal 更一致；文件链接只有在宿主按节点上下文解析成功后才会成为可点击链接；相对路径只按当前会话 `cwd` 解析，不再做 workspace 全局兜底；宿主侧路径准备、链接解析与打开动作也拆成了明确 helper，并统一了目录打开策略。

实现上，协议层新增了文件链接候选解析请求/响应；Webview 层把 `Agent` / `Terminal` 节点统一挂上异步文件 link provider、URL link provider、拖拽焦点恢复与测试激活钩子；宿主层把 `prepareExecutionTerminalDroppedPath()`、`resolveExecutionTerminalFileLinkCandidates()`、`openResolvedExecutionTerminalLink()` 统一收口到 `executionTerminalNativeHelpers.ts`，`CanvasPanelManager` 只负责节点上下文装配、缓存已解析链接和转发打开动作。

自动化证据如下：

- `npm run typecheck` 通过。
- `npm run test:webview` 通过，新增了两组回归：一组验证 `Agent` / `Terminal` 节点拖拽只向宿主转发首个 Explorer 资源；另一组验证文件路径与 URL 的 link activation 消息形态。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过，但其中拖拽部分是 Webview DOM action，不是真实 Explorer → Webview 宿主拖拽；当前能当作真实宿主证据的是 `file:line:col` 文件链接打开、`http://127.0.0.1` URL opener 路径以及 hover tooltip 修饰键文案。

补充更正：后续人工验证发现，真实 Explorer → Webview 的无修饰键拖拽仍受 VSCode 宿主限制，当前不能把它写成“已完成且已验证”。本轮 repo 内真正收口的是 Webview 已收到拖拽事件后的资源提取/宿主写入链路，以及文件路径 / URL 链接打开链路。链接下划线的像素级视觉一致性继续作为显式非目标处理，不单独登记技术债，也不把它包装成这轮必须补齐的发布口径。

## 上下文与定向

这次变更横跨四个区域。

第一类是 Webview 执行节点本体。`src/webview/main.tsx` 当前直接在 `AgentSessionNode` 与 `TerminalSessionNode` 中创建 `xterm.Terminal`，已有输入、选择、缩放修正、resize 和快照恢复逻辑，但没有拖拽处理和任何 Link Provider。两类节点都把用户输入通过 `webview/executionInput` 发回宿主。

第二类是宿主执行会话。`src/panel/CanvasPanelManager.ts` 持有本地 PTY 与 live-runtime supervisor 会话，`writeExecutionInput()` 是所有会话输入的统一入口。这里最适合承接“把拖拽资源准备成最终输入文本再写入会话”以及“收到链接点击后调用 VSCode API 打开资源”的动作。

第三类是协议。`src/common/protocol.ts` 定义了 Webview 与宿主之间的消息和测试专用 DOM action。要补齐这次能力，需要新增拖拽资源输入、链接激活和必要的测试动作定义，并把修饰键配置或等价 runtime context 传到 Webview。

第四类是验证。`tests/playwright/webview-harness.spec.mjs` 可以直接驱动真实 `dist/webview.js`，适合覆盖 Webview 拖拽/链接装配与视觉提示；`tests/vscode-smoke/extension-tests.cjs` 能调用真实扩展宿主，适合覆盖宿主侧“把拖拽路径写进 PTY”和“点击文件链接后打开编辑器”。

本计划中，“拖拽资源”特指来自 VSCode Explorer 或操作系统文件管理器的单个文件拖拽；按照 VSCode 当前源码，多文件拖拽时只消费第一个文件。“链接检测”特指 xterm 缓冲区中的文件路径与 `http/https` URL，不包含 git commit hash 等其它原生 Terminal 也支持的扩展 link type。

## 工作计划

先补正式文档。新增一份专门覆盖本轮交互对齐的设计文档，把 VSCode 源码结论写清楚，并同步 `docs/design-docs/index.md`。同时在本计划里保留足够的源码证据，让后续协作者不需要重新搜索微软仓库。

然后扩协议。`src/common/protocol.ts` 需要新增两类 Webview 到宿主消息：一类用于“当前执行节点收到拖拽资源，请宿主把它转换成会话输入”；另一类用于“当前执行节点中的链接被激活，请宿主执行打开动作”。为了做 Playwright / smoke 自动化，还要扩展 `WebviewDomAction`，让测试能合成拖拽和链接激活。

接着做宿主侧行为。`CanvasPanelManager` 里要新增一组 execution-terminal native interaction helper：读取节点当前元数据/会话上下文、把拖拽资源转换成最终输入文本、把文件路径解析成 `Uri + selection` 并调用 VSCode API 打开、把 URL 委托给 `vscode.open`。拖拽输入要尽量贴近 VSCode 的 `preparePathForShell` 规则，但也要显式记录 Agent CLI 与 shell 的差异边界。

随后做 Webview 侧装配。两类执行节点都要统一挂上拖拽事件处理和 xterm Link Provider。拖拽侧读取 `DataTransfer.RESOURCES`、`CodeFiles`、`text/uri-list` 以及 Chromium/Electron 文件拖拽的 `File.path` 风格字段，取第一个可用资源并发消息。链接侧用 `registerLinkProvider` 给每个 xterm 注册 URL/provider 与文件路径 provider，悬停时显示固定 tooltip 和修饰键说明，激活时再把打开动作交给宿主。为避免重复实现，最好把执行节点终端的交互层抽成可复用 helper，而不是继续在 `AgentSessionNode` 和 `TerminalSessionNode` 里复制粘贴。

最后补自动化并收口文档。Playwright 至少要证明拖拽事件会向宿主发出正确消息，且链接 provider 会暴露可激活链接；VS Code smoke 至少要证明拖拽输入真的进入当前 PTY，会话输出中的文件路径点击后能在编辑器里打开指定文件。若 URL 的“内部/外部浏览器”路径无法在 smoke 里稳定断言，需要在结果章节留下手动验证说明，而不是伪装成已自动覆盖。

## 具体步骤

1. 在仓库根目录更新文档：

       docs/exec-plans/completed/execution-node-terminal-native-interactions.md
       docs/design-docs/execution-node-terminal-native-interactions.md
       docs/design-docs/index.md

2. 在 `src/common/protocol.ts` 中新增：
   - 执行节点拖拽资源输入消息
   - 执行节点链接激活消息
   - 测试用 DOM action 扩展
   - Webview 需要的修饰键信息或等价 runtime context 字段

3. 在 `src/panel/CanvasPanelManager.ts` 中实现：
   - 拖拽资源到最终输入文本的准备逻辑
   - 文件路径解析、存在性检查和编辑器打开
   - URL 打开
   - 与测试/诊断结合的最小可观察记录

4. 在 `src/webview/` 中实现：
   - 执行节点终端统一交互 helper
   - 拖拽读取与 `postMessage`
   - xterm `registerLinkProvider`
   - 悬停 tooltip 和修饰键提示

5. 在 `tests/playwright/webview-harness.spec.mjs`、`tests/vscode-smoke/extension-tests.cjs` 中新增回归。

6. 在仓库根目录运行验证：

       npm run build
       npm run typecheck
       npm run test:webview
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs

## 验证与验收

拖拽验收至少要覆盖以下行为：

- 在 Webview 中把一个资源拖到 `Terminal` 节点终端区域后，宿主收到拖拽资源消息并把最终文本写入 PTY。
- 同样的拖拽路径对 `Agent` 节点也生效。
- 含空格文件名的资源会按照宿主准备逻辑插入，而不是裸文本断裂。
- 多文件拖拽时只消费第一个资源，与 VSCode 当前源码一致。

链接验收至少要覆盖以下行为：

- 终端输出中的文件路径被识别后，执行激活动作会在编辑器中打开对应文件。
- `src/index.ts:42` 与 `src/index.ts:42:10` 这类带行列号的文本会跳到对应位置。
- `http://` 或 `https://` URL 会走宿主 opener 路径。
- 悬停时存在修饰键提示 tooltip，且文案遵循 `editor.multiCursorModifier` 的原生规则；下划线像素效果不单独作为本轮收口项。

自动化最低要求：

- `npm run typecheck` 通过。
- `npm run test:webview` 通过，并新增至少一条拖拽或链接相关回归。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过，覆盖至少一个真实文件链接打开场景。

## 幂等性与恢复

这次变更只涉及文档、协议、Webview 与宿主逻辑，不涉及破坏性迁移。拖拽与链接能力本身不应写入持久化快照；若实现过程中发现测试辅助字段必须入状态或元数据，必须先在 `决策记录` 中说明原因，再确认不会污染正式持久化语义。

如果 Playwright 或 smoke 因宿主浏览器/Chromium 沙箱问题失败，应保留失败现象和重试条件，但不能把“测试命令跑不起来”误写成“功能已验证”。如需改用沙箱外命令，必须在 `结果与复盘` 中明确写出。

## 证据与备注

本计划开始前已经确认的关键 VSCode 源码锚点如下：

    terminalInstance.ts
    - 1253-1258: onDropFile 事件最终调用 sendPath(path, false)
    - 1360-1396: sendText / sendPath / preparePathForShell 链路
    - 2595-2616: 从 ResourceURLs / CodeFiles / DataTransfer.files 中取第一个资源

    terminalLinkManager.ts
    - 75-107: 注册 Local/Uri/Word/External link providers
    - 397-423: 通过 xterm.registerLinkProvider 注册 provider

    terminalLinkOpeners.ts
    - 26-49: 文件链接通过 editorService.openEditor 打开并支持 selection
    - 276-320: URL 通过 opener service，而不是直接 openExternal

这些证据说明本轮实现的对齐标准已经足够明确，不需要再依赖“我印象中 VSCode 大概是这样”的非正式知识。

## 接口与依赖

本轮预计触达以下接口：

- `src/common/protocol.ts`
  - `CanvasRuntimeContext`
  - `WebviewToHostMessage`
  - `HostToWebviewMessage`
  - `WebviewDomAction`

- `src/panel/CanvasPanelManager.ts`
  - `handleWebviewMessage`
  - `writeExecutionInput`
  - 终端/Agent 元数据读取与 VSCode 打开动作

- `src/webview/main.tsx`
  - `executionTerminalRegistry`
  - `AgentSessionNode`
  - `TerminalSessionNode`
  - `performWebviewDomAction`

- 新增 Webview helper（如需要）
  - 负责 xterm link provider、tooltip、拖拽事件与测试钩子

VSCode 源码中有可直接参考但不能直接依赖的内部模块，包括：

- `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts`
- `src/vs/workbench/contrib/terminal/common/terminalEnvironment.ts`
- `src/vs/workbench/contrib/terminalContrib/links/browser/*`

如果实现过程中发现某块 VSCode 源码依赖过重，不适合整段移植，必须在 `决策记录` 里写清楚“保留了哪一层等价行为、放弃了哪一层细节”，而不是静默退化。

---

本次更新说明：2026-04-17 在第二轮收口基础上继续补齐 trusted smoke 的 URL opener 最终落点断言与 hover tooltip 语义断言；对应设计文档已升级为 `已验证`，原先为 URL / hover 留下的技术债也一并收回。
