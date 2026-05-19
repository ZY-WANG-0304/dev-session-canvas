---
title: 执行节点 TUI 硬换行链接支持分析
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
updated_at: 2026-05-19
---

# 执行节点 TUI 硬换行链接支持分析

## 背景

当前 `Agent` 与 `Terminal` 执行节点已经通过 `xterm.js` link provider 支持单行文件路径、URL、`OSC 8` 显式链接，以及 ripgrep / eslint 类“上一行路径、下一行行列号”的原生 multiline link 主路径。

新的问题来自 Codex / Claude 这类 TUI 输出：当 TUI 自己为了固定缩进、列表 gutter 或消息气泡宽度把长链接拆成多条终端行时，后续行会带有人为缩进或前缀。这个场景不同于 `xterm.js` 自己把同一条超长输出软换行到下一行；前者在终端 buffer 中通常是多条非 `isWrapped` 行，链接文本被插入的缩进打断。

本文记录当前已选定的第一阶段方案；更宽泛的无样式 path 拼接和 overlay 渲染仍不是当前正式范围。

## 问题定义

需要支持的“多行 link”应先拆成两类：

1. 软换行 link：进程输出一条连续文本，由终端宽度导致 `xterm.js` 标记后续 buffer line 为 `isWrapped`。当前 `readWrappedLineContext(...)` 已经会把这类行合并成一个检测上下文。
2. TUI 硬换行 link：进程或 TUI 先输出换行，再在下一行补固定缩进、边框或列表前缀。当前 link detector 会把这些行当成相互独立的文本，URL / path detector 无法可靠重组。

本次用户反馈指向第 2 类。它不是简单增大 `EXECUTION_URI_LINK_MAX_LENGTH` 或 multiline context 就能解决的问题，因为需要判断哪些换行与缩进属于链接排版噪音，哪些是用户真实文本。

## 当前实现证据

- `src/webview/executionTerminalNativeInteractions.ts` 注册了 explicit hyperlink、multiline、file、URL、word/search 等 provider；URL provider 当前只对 `readWrappedLineContext(...)` 返回的单个上下文运行 `linkify-it`。
- `readWrappedLineContext(...)` 只沿着 `terminal.buffer.active.getLine(...).isWrapped` 向前后扩展上下文；TUI 主动输出的换行不会进入同一上下文。
- 现有 `collectMultilineFileLinkCandidates(...)` 只覆盖“上一行 path + 当前行 line:col”和 git diff hunk header，不覆盖被缩进拆断的 URL 或 path 片段。
- 现有 `collectStyledFileLinks(...)` 只能在当前 `readWrappedLineContext(...)` 覆盖的行内工作；它不会跨非 `isWrapped` 的硬换行续行重组文本。其底层 `readXtermRangesByAttr(...)` 也没有把 `IBufferCell.getFgColorMode()` / `getFgColor()` 纳入样式签名，因此单纯“蓝色但不加粗/不下划线”的片段当前不会被当成 styled segment。
- `xterm.js` 的 `ILink.range` 是一个连续 buffer range。若链接视觉上由多个非连续文本片段组成，当前 API 不能天然表达“跳过每行缩进但仍视为一个链接”的 disjoint range。

## 目标

- 让 Codex / Claude TUI 中被固定缩进硬换行的长 URL 在常见场景下可点击，并打开完整目标。
- 若扩展到文件路径，应保证相对路径仍使用当前 line-scoped cwd 语义解析，不能因为跨行重组而回退到节点级 cwd。
- 保持与现有原生 Terminal link parity 设计兼容：新增规则应是 TUI hard-wrap 适配层，而不是重新引入无边界的仓库私有 link heuristics。
- 所有新增规则必须有 Playwright 覆盖，至少证明不会把普通缩进文本、Markdown 列表或代码块错误拼接成链接。

## 非目标

- 不在本轮尝试完整理解 Codex / Claude 的私有 TUI DOM 或协议；执行节点只能看到 PTY 输出和 `xterm.js` buffer。
- 不承诺支持任意自然语言段落中的跨行 URL、任意 Markdown 硬换行或任意 shell 输出重排。
- 不改变 Host opener 的安全边界；非 file URL 仍需走 `terminal.integrated.allowedLinkSchemes` 放行逻辑。
- 不把 `xterm.js` link API 改造成 overlay 系统，除非后续明确接受更大的实现范围。

## 候选方案

### 方案一：不做 TUI 硬换行适配

工作量最低，只保留当前软换行、显式 hyperlink 和原生 multiline 文件链接能力。

优点是不会引入新的误判、性能和安全面；缺点是 Codex / Claude TUI 里最常见的“长 URL 被缩进拆断”仍不可点击，用户需要手动复制并修复链接。

### 方案二：只做保守 URL 重组

在 URL provider 之前增加一个 TUI hard-wrap URL detector。规则只在首行出现明确 URL scheme（例如 `http://`、`https://`、`vscode://`、`mailto:`）时启动；向后最多扫描少量相邻非空行，要求后续行具备稳定缩进或已知 TUI continuation 形态；重组时删除 continuation indentation，并在任一行出现空行、明显新句子、代码 fence 或另一个完整链接时停止。

交互上优先创建“每个可见片段各自可点击、共同打开同一完整 URL”的多个 link，而不是用一个大 range 覆盖缩进。这样能避免把 indentation / gutter 本身下划线，但用户看到的是多个片段共享同一目标，不是一个连续下划线。

这是当前最小可控路线。

### 方案三：样式辅助的硬换行重组

针对 Codex / Claude TUI 明确把链接片段渲染成同一颜色或同一 ANSI 样式的场景，新增一个 style-assisted detector。它不把“任意缩进 path-like 文本”都拼起来，而是先读取 `xterm.js` buffer cell 的前景色、背景色和文本样式，只有相邻硬换行上的片段拥有一致的非默认样式、且重组后能被 URL / path parser 识别时，才生成 logical link。

交互仍受 `xterm.js` 连续 range 限制，因此实现上应为每个可见片段创建一个 `ILink`，但这些 `ILink` 共用同一个完整 URL 或完整 file path 目标。对于文件路径，Webview 侧只负责把片段拼成 candidate，Host 侧仍用 `resolveExecutionTerminalFileLinkCandidates(...)` 验证文件是否真实存在。

这个方案可以覆盖“同一非默认 ANSI 样式的 `docs/design-docs/execution-terminal-tui-` + 下一行同样式的 `hard-wrapped-links.md`”这类样例，前提是样式来自 PTY 输出，并且 `xterm.js` buffer cell 能读到对应属性。方案不依赖当前主题把该 ANSI 样式渲染成哪一种视觉颜色。

### 方案四：URL + 文件路径统一重组

在方案二或方案三基础上，继续支持没有颜色或样式锚点的相对路径、绝对路径和带行列号路径硬换行重组。例如把 `src/webview/very/long/` 与下一行缩进后的 `file.ts:10:2` 拼成同一个 file link。

这会显著增加误判风险，因为路径片段没有 URL scheme 作为强锚点，且普通缩进代码、Markdown 列表、日志字段和中文说明中都可能出现类似 `/`、`.`、`:` 的文本。Host 侧文件存在性验证可以降低打开错误目标的概率，但不能避免 hover / underline 噪音和解析请求增多。

### 方案五：引入独立 overlay / disjoint link 渲染层

Webview 不再完全依赖 `xterm.registerLinkProvider` 的连续 range 表达，而是在终端上叠一层自绘 hit area，支持多个非连续片段共享一个 logical link。

这能提供最接近“一个跨行链接”的视觉与命中体验，但会绕开 xterm 原生 link interaction，重新处理滚动、选择、缩放、字体测量、hover、hit testing、可访问性和缓存失效。它本质上是一次新的终端交互层重构。

## 工作量评估

方案一无需实现，只有文档说明和已知限制记录。

方案二预计是小到中等工作量。核心改动集中在 `src/webview/executionTerminalNativeInteractions.ts`：新增 hard-wrap URL candidate collector、片段 range 到完整 URL 的映射、provider 顺序和 cache key；补充 `tests/playwright/webview-harness.spec.mjs` 中 agent / terminal 双执行节点回归。若只覆盖明确 scheme URL，预计约 2 到 4 个开发日；若需要先录真实 Codex / Claude 输出作为 fixture，再补不同宽度、主题和缩放下的交互验证，预计约 4 到 6 个开发日。

方案三预计是中等工作量。需要在 `src/webview/executionTerminalNativeInteractions.ts` 中改造 styled range 读取，把前景色、背景色和文本样式纳入签名；新增跨硬换行的 styled fragments collector；为一个 logical file / URL link 映射多个 `ILink.range`；并补 agent / terminal 双节点 Playwright 回归。若只覆盖同色 ANSI 片段 + Host 可验证文件路径，预计约 3 到 5 个开发日；若要覆盖多种 TUI 主题色、真实 Codex / Claude fixture、snapshot redraw 和缩放 hover，预计约 5 到 7 个开发日。

方案四预计是中等到偏大工作量。除 Webview detector 外，还要调整 `src/common/executionTerminalLinks.ts` 的 candidate model，确保一个 logical link 可以由多个可见片段组成，并让 `src/panel/executionTerminalNativeHelpers.ts` 正确消费重组后的 path、line、column 与 `bufferStartLine`。预计约 1 到 2 周，并且需要更多 false-positive 回归样例。

方案五预计是大工作量。它会触碰执行节点 terminal interaction 的核心边界，和既有缩放坐标补偿、选择、hover、scrollback redraw、snapshot restore 都有耦合。保守估计 2 到 4 周，且需要新的端到端验证矩阵；除非后续还要支持更多富交互 overlay，否则不建议仅为 TUI hard-wrap URL 走这条路。

## 负面效果与风险

- 误判风险增加：硬换行重组必须猜测“下一行缩进是链接续行还是普通文本”。规则越宽，越容易把列表、代码、日志或中文说明错误拼成 URL / path。
- 样式依赖会引入不稳定性：蓝色对人眼明显，但程序只能读取 PTY 输出中的 ANSI cell attributes；如果某个 TUI 没有输出颜色，或主题把普通文本和链接映射到相近样式，style-assisted detector 就不能作为可靠锚点。
- 原生对齐口径变弱：现有设计把执行节点 link 行为收口到 VSCode 原生 Terminal。TUI hard-wrap 是额外适配层，必须明确标注，否则会重新滑向仓库私有 heuristics。
- 视觉反馈不完美：`xterm.js` link range 不能表达 disjoint link。若使用一个连续 range，会把缩进、边框或 gutter 一起下划线和命中；若使用多个片段 range，用户会看到同一个 URL 被分成多段可点击。
- 性能成本增加：每次 hover / link resolution 可能要向前后扫描更多 buffer 行，并运行重组与去重逻辑。需要保留 max lines、max length、max links per context 等硬限制。
- 安全与隐私面扩大：重组后的完整 URL 可能包含 query token。当前 Host 会记录 link open diagnostic 的 `text` / `targetUri`，支持更完整的长 URL 后，诊断事件中出现敏感 URL 的概率更高。
- 缓存失效更复杂：TUI 常用 redraw、alternate screen 或 snapshot restore。重组结果如果只按当前行缓存，可能在重绘后复用旧续行；cache key 必须覆盖参与重组的所有 buffer 行文本。
- 文件路径支持会放大 Host 请求：若把 path 也纳入硬换行重组，Webview 会产生更多待解析 file candidates，Host 侧 `stat` 和 workspace fallback 请求会增加。
- 复制与选择语义不会自动改善：点击可以打开重组目标，但用户拖选终端文本时仍会复制带缩进或换行的原始文本；这会造成“能点开但复制出来仍坏”的体验差异。

## 正式方案

当前第一阶段正式选择方案二和方案三的受控组合，而不是直接支持所有跨行 URL / path。主要实现落点是 `src/webview/executionTerminalNativeInteractions.ts`，继续复用现有 `xterm.registerLinkProvider`、`ExecutionTerminalOpenLink` 与 Host 侧 `resolveExecutionTerminalFileLinkCandidates(...)` / `openExecutionTerminalLink(...)` 边界。

对普通长 URL，新增 hard-wrap URL detector。只有首片段包含明确 URL scheme，且续行去掉固定缩进后仍是无空格 URL 安全集合字符时，才把多个片段拼成一个完整 URL。每个可见片段各自注册为 `ILink`，但它们共享同一个完整 URL target。

对文件路径，新增 style-assisted hard-wrap detector。它读取 `xterm.js` buffer cell 的前景色、背景色与文本属性，计算非默认 style signature；只有相邻硬换行上的片段拥有同一非默认 style signature，拼接后能被 path parser 识别，且 Host 验证目标存在时，才暴露高置信 file link。实现不能按“蓝色”判断，只能按 buffer 中稳定的 ANSI style signature 判断。Host 验证优先按执行节点当前 cwd 解析；若 hard-wrap candidate 是工作区相对路径且当前 cwd 无法命中，允许做一次 workspace exact fallback，但不启用 partial basename 猜测。由于 hard-wrap 文件 candidate 会跨 Webview -> Host 协议传输，`hardwrap` source 必须同时纳入 candidate resolve 与 open link 的协议 validator，否则真实 VSCode Host 会拒绝消息并把交互降级成不可点击。

交互呈现上，hard-wrap link 继续保持“每个可见片段一个 `ILink`”的点击模型，但 hover 下划线由 `src/webview/executionTerminalNativeInteractions.ts` 的 grouped hover overlay 统一绘制。这样 hover 任一片段时，所有同组片段都会显示下划线，同时不把 TUI 缩进空白纳入 clickable range。overlay 只服务 hard-wrap 高置信链接；普通 link 继续使用 `xterm.js` 原生 hover underline。

核心规则如下：

1. 首片段从明确 URL scheme 开始。
2. URL 首片段必须以常见 URL 断点字符结尾，例如 `/`、`?`、`#`、`&`、`=`、`.`、`_`、`~`、`%`、`+`、`-`，避免把一个完整 URL 和下一行缩进说明误拼接。
3. 总长度不超过既有 URI 上限。
4. 续行数量有小上限，例如 2 到 4 行。
5. 每个续行去掉固定缩进后只能包含 URL 安全集合字符，不能包含空格或明显自然语言分隔；若续行自身以明确 URL scheme 开始，则视为相邻的另一条 URL，不参与拼接。
6. 对文件路径，必须有明确的同一 ANSI 样式锚点，且 Host 通过 cwd 或 workspace exact fallback 验证目标存在后才暴露高置信 file link。
7. 每个可见片段都映射到同一个完整目标，但不把缩进区域纳入 clickable range；hover 时通过 overlay 给同组真实片段一起画下划线。

无样式文件路径硬换行仍暂缓，除非后续真实样例证明它们同样高频且无法通过 provider 输出 `OSC 8` 或扩大节点宽度缓解。

## 验证方法

若进入实现，至少需要完成：

1. Playwright 覆盖 agent / terminal 两类节点：`https://...` 被 TUI 硬换行缩进后，点击任一片段都发出完整 URL。
2. 若实现 style-assisted file path，Playwright 应覆盖 agent / terminal 两类节点：同一非默认 ANSI 样式的相邻片段被重组为完整 file path，点击任一片段都打开同一文件。
3. hover 样例：hover 任一 hard-wrap 片段时，同组所有真实片段都显示下划线，缩进空白不显示下划线。
4. 回归样例：普通 Markdown 列表、缩进代码、中文说明、两个相邻 URL、带句号结尾的 URL、普通同色日志文本不被错误重组。
5. 缓存样例：同一 buffer 行位置被 snapshot redraw 成另一个 URL 或另一个 styled path 后，不复用旧完整目标。
6. `npm run typecheck` 与 targeted `npm run test:webview -- -g "link activation"` 通过；最终合并前再跑完整 `npm run test:webview`。
7. 手动验证：在真实 Codex / Claude TUI 输出中确认长链接点击目标正确，并记录具体终端宽度、节点宽度、ANSI 样式和样例输出形态。

### 当前验证记录

2026-05-19 已完成自动化验证：

- `npm run typecheck`
- `npm run test:protocol-webview-messages`
- `npm run test:execution-terminal-links`
- `npm run test:execution-terminal-native-helpers`
- `npm run test:webview -- -g "hard-wrapped URL fragments|hard-wrapped URL detector|styled hard-wrapped file fragments|styled hard-wrapped code paths|styled hard-wrapped file hover|unstyled hard-wrapped file fragments|styled hard-wrapped non-links"`
- `npm run test:webview -- -g "link activation posts parsed file and URL targets|hard-wrapped URL fragments|hard-wrapped URL detector|styled hard-wrapped file fragments|styled hard-wrapped code paths|styled hard-wrapped file hover|unstyled hard-wrapped file fragments|styled hard-wrapped non-links|low-confidence word links underline only while the modifier is held|does not synthesize trimmed links from attached CJK prose|treats CJK punctuation as a file-link boundary|keeps file-like words clickable across CJK punctuation boundaries|keeps Chinese file paths eligible for exact file links"`

真实 Codex / Claude TUI 输出的手动验证尚未执行，因此验证状态保持为 `验证中`。
