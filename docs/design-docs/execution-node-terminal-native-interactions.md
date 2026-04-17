---
title: 执行节点的 VSCode 原生 Terminal 交互对齐
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
  - docs/exec-plans/completed/execution-node-terminal-native-interactions.md
updated_at: 2026-04-17
---

# 执行节点的 VSCode 原生 Terminal 交互对齐

## 1. 背景

当前仓库已经把 `Terminal` 与 `Agent` 节点都收口成画布内的 runtime window，主要输入输出都发生在嵌入式 `xterm.js` 里。

但这两类节点还缺少 VSCode 原生 Terminal 用户已经默认拥有的两项标准交互：

1. 从 Explorer 拖拽文件到终端后，把路径文本插入当前会话。
2. 在终端输出里识别文件路径与 URL，并支持点击跳转。

这两项能力缺失后，用户在画布里工作时会频繁退回原生 Terminal 或编辑器，破坏“执行窗口留在画布里”的主路径。

## 2. 问题定义

本轮需要回答的不是“要不要做拖拽和链接”，而是：

1. 这两项能力应该以什么标准对齐 VSCode 原生 Terminal。
2. 在 `Webview` 里运行的 `xterm.js` 要如何接住 Explorer 拖拽和 link activation，而不越过宿主边界直接调用 VSCode API。
3. 哪些逻辑应当留在 Webview，哪些必须回到 Extension Host。

## 3. 目标

- 让 `Terminal` 与 `Agent` 节点都支持文件拖拽输入路径。
- 让执行节点中的文件路径与 URL 可被识别并点击打开。
- 与 VSCode 原生 Terminal 在“入口机制、修饰键规则、宿主打开路径”上保持同类实现分层，而不是在 Webview 里另造一套终端交互系统。

## 4. 非目标

- 不在本轮覆盖 git commit hash、search link 等 VSCode Terminal 还支持的其它 link type。
- 不在本轮承诺完全复刻 VSCode 内部 terminal hover widget 的所有像素细节，也不单独收口链接下划线的像素级一致性。
- 不在本轮补齐基于 shell integration 的逐行真实 cwd 跟踪；相对路径解析先以节点当前宿主 cwd 为准。

## 5. 候选方案

### 5.1 在 Webview 内自行实现拖拽和链接全部逻辑

特点：

- Webview 自己从 `DragEvent` 和终端文本中拿到全部信息。
- 文件打开、URL 打开和路径准备都由前端直接决定。

不选原因：

- Webview 不能直接调用 VSCode API。
- 路径准备与资源打开带有平台、配置和宿主语义，放在 Webview 会把边界做反。
- 这条路线会偏离 VSCode 原生 Terminal 的分层实现。

### 5.2 完全依赖 xterm.js 内置 addon，不做宿主消息

特点：

- URL 可能可以靠现成 addon。
- 文件路径和拖拽尽量在 xterm 范围内解决。

不选原因：

- VSCode 原生 Terminal 也没有只靠 xterm 自己完成这两项能力；它对拖拽和链接都包了一层宿主逻辑。
- 文件路径打开最终仍需要 Extension Host 调用 VSCode API。

### 5.3 Webview 负责事件入口与 xterm Link Provider，宿主负责路径准备与打开动作

特点：

- 拖拽入口在 Webview：读取 `DataTransfer`，提取第一个文件资源，发消息给宿主。
- 链接检测入口在 Webview：使用 xterm `registerLinkProvider` 暴露 link。
- 最终的路径准备、文件解析与 URL 打开都在 Extension Host 执行。

当前选择原因：

- 这与 VSCode 原生 Terminal 的实现分层最接近。
- 它保留了 Webview 与宿主的清晰边界。
- 两类执行节点都能共享同一套 UI 层交互，而不把 VSCode API 漏进 Webview。

## 6. 当前结论

当前收敛结论如下：

- 执行节点要补齐的标准交互是：
  - Explorer/文件系统拖拽文件到终端区域后，把路径文本输入当前会话。
  - 输出中的文件路径和 `http/https` URL 可以按 VSCode 原生 Terminal 的修饰键规则点击打开。

- 拖拽入口使用 Webview 原生 `DragEvent` / `DataTransfer`，并优先读取与 VSCode 原生 Terminal 一致的数据来源：
  - `ResourceURLs`
  - `CodeFiles`
  - 文件系统 `Files`

- 根据当前 VSCode 源码，原生 Terminal 拖拽消费的是“第一个文件资源”，并把它交给宿主侧路径准备逻辑；当前没有源码证据支持“Explorer 拖拽默认输入 workspace 相对路径”这一说法，因此本仓库不能把它写成已确认结论。

- 拖拽入口在 Webview，最终输入文本准备在宿主；第二轮收口后，拖拽成功时会立即把焦点交还给当前 xterm textarea，避免拖拽后用户还要额外点一次终端才能继续输入。

- 当前已确认的宿主现实约束是：从 VSCode Explorer 拖资源进入 Webview 时，VSCode 在拖拽期间默认不会把事件直接交给 Webview；当前人工观察与上游源码都指向“按住 `Shift` 时 Webview 才会重新接管拖拽事件”。这不是当前仓库的 Webview 内部解析逻辑可以单独消除的限制。

- 因此当前实现能保证的是“当 Webview 已经收到拖拽事件后，首个资源会按宿主路径准备逻辑写入 PTY”；但“无需修饰键直接把 Explorer 资源拖进执行节点”不能再写成已验证结论。为避免误导，执行节点界面已显式提示 `Explorer 拖拽请按住 Shift`。

- 链接检测使用 xterm `registerLinkProvider`，而不是在 React 层或宿主侧扫描终端输出字符串。

- 文件路径链接采用“Webview 检测候选，宿主解析/验证后再注册链接”的两段式实现；未被宿主确认存在的候选不会成为可点击链接。

- 相对文件路径解析当前只相对节点当前宿主 `cwd`，不再做 workspace 级搜索 fallback；这比先前仓库实现更接近 VSCode 原生 Terminal 的上下文语义。

- 最终打开动作必须在宿主侧执行：
  - 文件路径：`openTextDocument` + `showTextDocument`
  - URL：通过 `vscode.open` 命令委托给 VSCode opener 路径

- `Agent` 与 `Terminal` 节点都属于 execution runtime window，因此拖拽和链接的 Webview 交互层应共享一套实现；但宿主仍可按节点 kind 区分路径准备/解析策略，因为 `Agent` 运行的是直接 PTY CLI，不等于 shell。

- 宿主实现按 prepare / resolve / open 三层收口，目录目标统一分成：
  - workspace 内目录：`revealInExplorer`
  - workspace 外目录：`vscode.openFolder(uri, true)`

## 7. 风险与取舍

- 取舍：本轮不做 VSCode 级别的完整 link taxonomy，只先覆盖文件路径和 URL。
  原因：这是用户明确要求的两类能力，也是 VSCode Terminal 最常见的主路径。

- 风险：当前仓库没有 shell integration 驱动的逐行 cwd 跟踪，相对路径链接只能按节点当前宿主 cwd 解析。
  当前缓解：节点创建时的 cwd 就是 workspace root；常见 `src/foo.ts` 场景会成立。更复杂的“会话里多次 `cd` 后输出相对路径”留待后续增强。

- 风险：Explorer 拖拽进入 Webview 的主 blocker 不是单一 `DataTransfer` type，而是 VSCode 宿主会在拖拽期间默认屏蔽 Webview 接收事件；在当前上游行为下，人工验证显示按住 `Shift` 才会把拖拽重新交给 Webview。
  当前缓解：仓库侧继续兼容 `ResourceURLs`、`CodeFiles`、`text/uri-list` 和 Chromium/Electron 文件拖拽入口，确保一旦事件进入 Webview 就能完成资源提取；同时在执行节点界面显式提示 `Explorer 拖拽请按住 Shift`。若后续需要彻底消除该限制，只能继续寻找 VSCode 宿主级能力，而不是继续在 Webview 内部补解析分支。

- 风险：扩展 API 不直接暴露 VSCode 内部的 opener service。
  当前缓解：URL 打开改走 `vscode.open` 命令，这条路径最终委托 `_workbench.open`，比直接 `env.openExternal` 更接近原生 Terminal 的 opener 行为。

## 8. 当前验证方法

至少需要完成以下验证：

1. 拖拽单个文件到 `Terminal` 节点后，会话收到路径文本输入。
2. 相同行为对 `Agent` 节点也成立。
3. 终端输出中的文件路径点击后会在编辑器中打开并跳到指定行列。
4. `http/https` URL 点击后会进入 VSCode opener 路径。
5. 悬停时存在修饰键提示 tooltip，且文案遵循 `editor.multiCursorModifier`；不单独要求下划线像素效果自动化收口。

## 9. 当前验证状态

- 2026-04-17 已完成 VSCode 源码级对照，明确拖拽和链接的原生分层与调用链。
- 2026-04-17 已完成 Webview 自动化回归：
  - `npm run test:webview` 覆盖了 `Agent` / `Terminal` 两类节点的拖拽消息转发，并断言只消费第一个 Explorer 资源。
  - 同一组回归覆盖了文件路径 `src/index.ts:42:10` 与 URL `https://example.com/docs?q=1` 的 link activation 消息形态，确认 Webview 侧通过 xterm `registerLinkProvider` 暴露统一打开动作。
- 2026-04-17 已完成真实 VS Code 宿主 smoke 的链接侧验证：
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 当前真实覆盖的是文件链接与 URL 打开链路。
  - 该 smoke 里的拖拽断言本质上是 Webview DOM action，不是真实 Explorer → Webview 宿主拖拽，因此不能继续当成“真实 Explorer 拖拽已验证”的证据。
- 2026-04-17 已完成第二轮收口验证：
  - `npm run typecheck` 通过。
  - `npm run test:webview` 通过，新增断言覆盖了拖拽后焦点回到 `.xterm-helper-textarea`，以及文件链接在宿主解析回包后才会发起 `openExecutionLink`。
  - 同一轮 trusted smoke 再次通过，确认宿主预解析文件链接、`cwd` 收紧策略和目录打开分层没有打坏真实宿主场景。
- 2026-04-17 已补齐真实宿主里的剩余自动化断言：
  - trusted smoke 现在会点击本地 `http://127.0.0.1` URL，并断言真实 VSCode Host 最终把该链接委托给 `vscode.open`，从而覆盖 URL 的宿主 opener 落点，而不依赖外部浏览器或特定 tab 形态。
  - 同一条 trusted smoke 现在会在真实 Webview 容器里触发链接 hover，并断言 tooltip 文案与 `editor.multiCursorModifier` 对齐。
- 2026-04-17 人工复核后确认：真实 Explorer → Webview 的无修饰键拖拽仍受 VSCode 宿主限制，当前文档状态回退到 `验证中`。当前已验证的是链接打开链路，以及“Webview 已收到拖拽事件后”的资源提取与宿主写入链路；未验证的是“无需 `Shift` 的真实 Explorer 拖拽对齐”。
