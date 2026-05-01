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
  - docs/exec-plans/active/execution-terminal-native-link-parity.md
  - docs/exec-plans/completed/execution-node-terminal-native-interactions.md
  - docs/exec-plans/completed/execution-node-link-parity-and-extensions.md
updated_at: 2026-05-01
---

# 执行节点的 VSCode 原生 Terminal 交互对齐

## 1. 背景

当前仓库已经让 `Terminal` 与 `Agent` 节点具备了画布内嵌终端、拖拽输入路径、文件路径 / URL 点击跳转，以及基础的 `OSC 8` / `search fallback` 能力。

但最新用户反馈已经明确表明，这一轮“基础可用”的实现还停留在“近似原生”而不是“原生同类体验”层级。当前最突出的两个问题是：

1. 终端输出里仍会出现比 VSCode 原生 Terminal 更多的误判链接，尤其是 file-like 文本被过度注册链接。
2. 终端输出中的跨行链接当前还不支持，例如上一行是路径、下一行是 `16:5` 这类 ripgrep / eslint / diff 输出，原生 Terminal 能点，执行节点里不能点。

因此，这一轮不再把目标限定为“支持路径和 URL 点击”，而是要把**除实现分层之外的链接解析逻辑与交互逻辑，全面向 VSCode 原生 Terminal 对齐**。

## 2. 问题定义

本轮需要明确的不是“是否继续补若干启发式规则”，而是：

1. 当前执行节点里的 link detector / opener / hover 语义，应否继续维护一套仓库自定义 heuristics。
2. 如果用户要求行为向 VSCode 原生 Terminal 全面对齐，那么哪些部分必须对齐到源码级别的解析顺序、交互规则与 opener 语义，哪些部分只需要保持当前 Webview -> Host 的架构边界即可。
3. 如何在不照搬 VSCode 内部类结构的前提下，把执行节点的用户可观察行为收口成与原生 Terminal 同一套规则。

## 3. 目标

- 执行节点中的链接检测顺序与命中结果，默认按 VSCode 原生 Terminal 的显式 hyperlink、multiline、本地文件、URI、word/search 语义对齐。
- 当前仓库里“过多链接”的主问题应通过原生 detector 规则收口，而不是继续叠加仓库私有 heuristics。
- 执行节点支持原生同类的跨行链接主路径，至少覆盖 ripgrep / eslint 类“上一行路径、下一行行列号”以及 git diff hunk 这类原生已支持场景。
- 文件、目录、URL、search link 的 hover 文案、修饰键规则、打开语义与 fallback 语义，默认与 VSCode 原生 Terminal 一致。
- 保留当前仓库的 Webview -> Host 架构边界，不要求把实现类、模块切分、扩展 API 接线方式做成与 VSCode 源码同构。

## 4. 非目标

- 不要求把当前仓库内部类名、模块结构、消息协议或宿主 / Webview 分层改写成 VSCode 源码的类图。
- 不要求在本轮把 VSCode 原生 Terminal 的 external link provider 扩展槽直接复制到仓库协议中；只要求当前仓库自己负责的内置解析与交互行为与原生一致。
- 不要求像素级复刻 VSCode workbench hover widget 的 DOM 结构、动画和样式细节；但 hover 出现时机、文案和修饰键提示语义必须对齐。
- 不在本轮扩大到 git commit hash、问题 matcher 等其它原生 Terminal 支持但当前用户未提出的 link taxonomy，除非它们是原生 multiline / local / uri / word 主路径收口所必需的组成部分。

## 5. 候选方案

### 5.1 继续在当前仓库 heuristics 上增量打补丁

特点：

- 继续保留当前 `file -> url -> search` provider 架构与仓库自定义 refine。
- 遇到误判就补新的 trim rule，遇到漏判就补新的正则。

不选原因：

- 这条路线已经证明只能“局部收敛”，无法保证与原生 Terminal 的整体行为一致。
- 用户这次明确要求的是“除实现分层之外全面向原生对齐”，继续打补丁会让仓库结论与用户目标背离。
- 当前最关键的跨行链接问题，本质上不是一两条后缀正则能稳定补齐的。

### 5.2 保留当前 Webview -> Host 边界，但把 detector / opener 语义改成原生同类实现

特点：

- 继续使用当前仓库已有的 Webview xterm + Host opener 架构。
- 但链接检测顺序、跨行规则、本地文件验证、URI / word / search fallback、hover 语义与 opener 分流都按 VSCode 原生 Terminal 对齐。

当前选择原因：

- 它满足用户“架构分层不必对齐，但解析与交互要全面对齐”的要求。
- 它允许仓库继续复用当前的消息协议、行级 cwd 追踪与宿主诊断能力。
- 它把“行为 oracle”明确收口到 VSCode 原生 Terminal，而不是继续让仓库私有 heuristics 主导产品语义。

### 5.3 改成宿主全量扫描输出并在 Webview 只画结果

特点：

- 宿主直接负责所有文本解析、hover 与打开逻辑。
- Webview 仅渲染已解析好的 link overlays。

不选原因：

- 这会破坏当前 `xterm.registerLinkProvider` 作为交互入口的架构边界。
- 用户这次只要求“实现代码 / 架构分层不必对齐”，没有要求推翻现有边界。
- 在当前仓库里，继续让 xterm 负责 buffer 与 link interaction，风险更低，也更贴近原生 Terminal 的入口模型。

## 6. 风险与取舍

- 取舍：本轮把“原生行为一致性”放在“继续保留仓库自定义误报抑制规则”之前。
  原因：用户已经明确要求向原生 Terminal 对齐，仓库不应继续把自定义 heuristics 当成正式产品语义。

- 风险：原生 `word/search link` 语义理论上比当前仓库更宽，可能让“任何普通词条都能触发 search link”重新进入可观察范围。
  当前缓解：本轮不是简单放开所有当前自定义 search fallback，而是把完整 detector 顺序和优先级一起对齐；产品上接受“native parity 可能与当前主观预期不同”，但不接受“仓库私有误判更多却仍自称原生对齐”。

- 风险：当前仓库的行级 cwd 追踪来自 `ExecutionTerminalLineContextTracker`，而不是 VSCode 内部的 command detection capability；若对齐方式不当，容易出现“顺序看似对齐，但相对路径解析结果仍不一致”。
  当前缓解：本轮把现有 line context tracker 明确当作“原生行级 cwd 能力的仓库内等价输入”，要求 detector / opener 使用同一条 line-scoped cwd 语义，而不是回退到节点级 cwd。

- 风险：原生 hover widget 依赖 workbench 内部服务；当前仓库仍在 Webview 内自绘 tooltip。
  当前缓解：本轮只要求 hover 时机、文案和修饰键语义对齐，不要求 DOM / CSS 同构；`workbench.hover.delay` 不再透传到 Webview，而是保留仓库内固定 delay 作为边界取舍。

- 风险：若继续大量保留当前仓库的 CJK refine / path trim 私有逻辑，会与“全面向原生对齐”的目标冲突。
  当前缓解：当前仓库已有的自定义 refine 不再默认视为正式能力；只有当它是把 VSCode 原生 parser 移植到当前 Webview / Host 边界时不可避免的适配层时，才允许保留，并需在实现文档里明确标注“这是适配层，不是额外产品规则”。

## 7. 正式方案

### 7.1 对齐范围

从本轮开始，执行节点里的链接能力以 **VSCode 原生 Terminal 的用户可观察行为** 为准绳。这里的“用户可观察行为”包括：

- 哪些文本会成为 link。
- 不同类型 link 的优先级顺序。
- hover 在什么时机出现、显示什么文案、要求什么修饰键。
- 点击后文件、目录、URL、search 各自走哪条打开路径。
- 哪些 path-like 文本必须等宿主验证后才可点击，哪些可以直接当 URI / search link。

当前仓库仍保留 Webview 与 Host 分层：`src/webview/executionTerminalNativeInteractions.ts` 继续作为 xterm 交互入口，`src/panel/executionTerminalNativeHelpers.ts` 与 `src/panel/CanvasPanelManager.ts` 继续作为宿主解析 / 打开入口；但这些模块内部的规则应当向 VSCode 原生 Terminal 对齐，而不再长期维护仓库自定义的替代语义。

### 7.2 detector 顺序与 link taxonomy

执行节点中的 detector 顺序收口为：

1. `OSC 8` / 显式 hyperlink，由 `xterm.options.linkHandler` 处理。
2. multiline detector。
3. local file / folder detector。
4. URI detector。
5. word / search detector。

这意味着当前仓库的 `file -> url -> search` 简化顺序需要被替换。新的顺序要求如下：

- multiline detector 必须先于 local / uri / word 执行，这样“上一行路径、下一行 16:5”的输出才能与原生 Terminal 一样优先解析为文件链接，而不是被当成孤立 search token。
- local detector 必须在 URI detector 之前，以保持原生 Terminal 对本地路径的优先级。
- word / search detector 必须位于最低优先级，只在更高优先级 detector 都未吞掉对应范围时，才为该词条暴露 search 语义。

当前仓库不要求复制 VSCode 的外部扩展 link provider 注册槽，但内置 detector 的顺序、遮蔽关系和最终可点击范围必须与原生一致。

### 7.3 显式 hyperlink 语义

`src/webview/executionTerminalNativeInteractions.ts` 中的显式 hyperlink 入口继续由 xterm `linkHandler` 承载，但其行为要对齐原生 Terminal：

- 必须允许非 `http/https` 协议参与显式 hyperlink 检测。
- `file://` URI 必须按文件 / 目录 opener 特化，而不是一律当成普通外链。
- 非 `file://` URI 的打开前检查应对齐原生 Terminal 的 allowed scheme 语义；当前仓库可以在 Host 侧实现配置检查与提示，而不要求复制原生内部 prompt 类。
- hover 文案与修饰键语义必须与原生保持一致。

### 7.4 本地文件与跨行链接解析

`src/common/executionTerminalLinks.ts` 不再把当前仓库私有的简化 parser 当成最终产品语义来源。它要么被替换为基于原生 Terminal 规则的等价 parser，要么只保留当前仓库消息模型与适配层所必需的类型定义。

本轮文件 / 目录链接解析的正式规则如下：

- 单行 path 检测必须对齐原生 Terminal 的 local link parser，包括后缀 `:line:col`、括号风格行列号、`File "..."` 与其它原生 fallback matcher 主路径。
- 当普通单行解析失败时，仍需保留原生 local detector 的 fallback matcher 行为与 styled segment fallback，而不是继续使用当前仓库私有的 CJK / prose refine 作为主方案。
- 跨行链接必须补齐原生 multiline detector 主路径，至少覆盖：
  - ripgrep / eslint 类“上一行路径、下一行 `16:5`”格式。
  - git diff hunk header 类原生已支持场景。
- 本地路径解析必须继续使用当前仓库已有的 line-scoped cwd 语义；也就是 `src/panel/executionTerminalLineContextTracker.ts` 追踪出来的 `buffer line -> cwd` 结果，应作为原生 command detection 能力在当前仓库里的等价输入。

### 7.5 URI 与 word/search 语义

当前仓库的 URL 检测与 search fallback 需要从“仓库私有收口逻辑”切换到“原生 Terminal 语义”。正式规则如下：

- URI detector 的结果范围与 file opener 分流应对齐原生 Terminal；这意味着对 `file://`、普通 URI 以及带 line/col 后缀的 file URI，应遵循原生的区分方式。
- word detector 的切词规则必须受 `terminal.integrated.wordSeparators` 控制，并处于最低优先级。
- search link 的打开逻辑不再是“仓库判断为 file-like 才给 search”，而是与原生 Terminal 一样：先尝试 exact-open，再回退到 Quick Access 搜索。
- 若原生 Terminal 对普通词条暴露 search link，而当前仓库没有，那应以原生行为为准。

### 7.6 hover、修饰键与 opener 行为

`src/webview/executionTerminalNativeInteractions.ts` 与 `src/panel/executionTerminalNativeHelpers.ts` 共同负责当前仓库中的 hover 与 opener。虽然实现层仍保留 Webview / Host 边界，但用户可见行为应按下列规则对齐：

- 激活修饰键继续遵循 `editor.multiCursorModifier`，行为与原生 Terminal 一致。
- hover 文案和文案中的修饰键描述，应对齐原生 Terminal，而不是继续使用仓库自定义命名；但 `workbench.hover.delay` 不作为 Host -> Webview 运行时协议的一部分透传。
- low-confidence 的 `word/search link` 不应在普通 hover 下默认显示下划线；只有按住激活修饰键时，才像原生 Terminal 一样临时强调为可点击状态。
- 文件打开：`showTextDocument` 语义与原生 `openEditor` 对齐，包含 line / column selection。
- workspace 内目录：`revealInExplorer`。
- workspace 外目录：新窗口打开目录。
- search：先 exact-open，再 `workbench.action.quickOpen`。
- URL：非 `file://` 走 VSCode opener 路径，而不是浏览器默认行为。

### 7.7 当前自定义 heuristics 的处置原则

当前仓库已有的自定义 heuristics，例如 CJK 前缀裁剪、额外 trim rule、path-like search 限流，不再默认视为正式产品规则。它们的处置原则如下：

- 如果某条规则是为了弥补当前仓库 Webview / Host 边界与原生内部服务差异而必须存在，则可保留，但应在实现文档和注释里说明“这是适配层”。
- 如果某条规则只是为了继续偏离原生 detector 结果，则应删除或降级，不得继续作为默认行为。
- 若原生 Terminal 的行为本身会让某些普通词条成为 search link，本轮不能以“当前仓库主观上不想给太多 link”为由再次私自收窄。

## 8. 验证方法

本轮至少需要完成以下验证，才能把文档重新标回 `已验证`：

1. 在同一 workspace 中，对照 VSCode 原生 Terminal 与执行节点，验证单行文件路径、跨行 ripgrep / eslint 路径、git diff hunk、`file://` URI、普通 URI、普通词条 search 的命中结果与打开结果一致。
2. `npm run typecheck` 通过。
3. `npm run test:webview` 通过，并新增覆盖：
   - multiline link 检测。
   - 当前“过多链接”误判的回归样例，对齐到原生结果。
   - word / search link 的原生优先级与 fallback 行为。
4. `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过，并至少在真实宿主中覆盖：
   - 跨行文件链接打开。
   - search link 的 exact-open / Quick Access fallback。
   - hover 修饰键文案与打开动作。
5. 若新增了 allowed scheme 提示语义，还必须补一条真实或可控自动化验证，证明未放行 scheme 不会直接打开。
