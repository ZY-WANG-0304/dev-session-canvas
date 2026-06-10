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
updated_at: 2026-06-10
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
- 运行中输出会放大负缓存刷新成本：若普通 fallback 行在 hover 后进入负缓存，后续 live output 不应反复刷新这些低置信负结果，否则会把普通文本重新送到 Host 侧文件解析与 workspace fallback。
- 复制与选择语义不会自动改善：点击可以打开重组目标，但用户拖选终端文本时仍会复制带缩进或换行的原始文本；这会造成“能点开但复制出来仍坏”的体验差异。

## 正式方案

当前第一阶段正式选择方案二和方案三的受控组合，而不是直接支持所有跨行 URL / path。主要实现落点是 `src/webview/executionTerminalNativeInteractions.ts`，继续复用现有 `xterm.registerLinkProvider`、`ExecutionTerminalOpenLink` 与 Host 侧 `resolveExecutionTerminalFileLinkCandidates(...)` / `openExecutionTerminalLink(...)` 边界。

对普通长 URL，新增 hard-wrap URL detector。只有首片段包含明确 URL scheme，且续行去掉固定缩进后仍是无空格 URL 安全集合字符时，才把多个片段拼成一个完整 URL。每个可见片段各自注册为 `ILink`，但它们共享同一个完整 URL target。

对文件路径，新增 style-assisted hard-wrap detector。它读取 `xterm.js` buffer cell 的前景色、背景色与文本属性，计算非默认 style signature；只有相邻硬换行上的片段拥有同一非默认 style signature，且整组片段同时满足明确 continuation 链结构时，才继续拼接并交给 path parser 与 Host 验证。文件 hard-wrap 的首片段必须贴到当前可见行尾；每个续行只能在允许缩进后立刻开始同样式片段。续行片段之后可以出现不参与链接的默认样式说明文字；但若后续同样式片段不是从缩进后的行首开始，或首片段后仍有说明文字，则不属于 hard-wrap continuation。满足这些结构约束、拼接后能被 path parser 识别，且 Host 验证目标存在时，才暴露高置信 file link。实现不能按“蓝色”判断，只能按 buffer 中稳定的 ANSI style signature 判断。Host 验证优先按执行节点当前 cwd 解析；若 hard-wrap candidate 是工作区相对路径且当前 cwd 无法命中，允许做一次 workspace exact fallback，但不启用 partial basename 猜测。由于 hard-wrap 文件 candidate 会跨 Webview -> Host 协议传输，`hardwrap` source 必须同时纳入 candidate resolve 与 open link 的协议 validator，否则真实 VSCode Host 会拒绝消息并把交互降级成不可点击。

交互呈现上，hard-wrap link 继续保持“每个可见片段一个 `ILink`”的点击模型，但 hover 下划线由 `src/webview/executionTerminalNativeInteractions.ts` 的 grouped hover overlay 统一绘制。这样 hover 任一片段时，所有同组片段都会显示下划线，同时不把 TUI 缩进空白纳入 clickable range。overlay 只服务 hard-wrap 高置信链接；普通 link 继续使用 `xterm.js` 原生 hover underline。

核心规则如下：

1. 首片段从明确 URL scheme 开始。
2. URL 首片段必须以常见 URL 断点字符结尾，例如 `/`、`?`、`#`、`&`、`=`、`.`、`_`、`~`、`%`、`+`、`-`，避免把一个完整 URL 和下一行缩进说明误拼接。
3. 总长度不超过既有 URI 上限。
4. 续行数量有小上限，例如 2 到 4 行。
5. 每个续行去掉固定缩进后只能包含 URL 安全集合字符，不能包含空格或明显自然语言分隔；若续行自身以明确 URL scheme 开始，则视为相邻的另一条 URL，不参与拼接。
6. 对文件路径，必须有明确的同一 ANSI 样式锚点，并且满足首片段贴行尾、续片段从允许缩进后的行首连续承接的 continuation 链结构。
7. 文件路径允许续行链接片段后出现不参与链接的默认样式说明文字或少量 wrapper punctuation；但不能把 `Error at <styled>path.</styled> crashed` 这类首片段后仍有 prose 的输出拼成链接，也不能把 `note: <styled>ts:1:1</styled>` 这类续片段不在缩进后行首的输出拼成链接。
8. 对文件路径，Host 通过 cwd 或 workspace exact fallback 验证目标存在后才暴露高置信 file link。
9. 每个可见片段都映射到同一个完整目标，但不把缩进区域纳入 clickable range；hover 时通过 overlay 给同组真实片段一起画下划线。

无样式文件路径硬换行仍暂缓，除非后续真实样例证明它们同样高频且无法通过 provider 输出 `OSC 8` 或扩大节点宽度缓解。

2026-05-22 追加性能收口：live output 只允许刷新高置信负缓存候选，例如 `detected`、`hardwrap` 等；纯 `fallback` 负缓存不参与后台刷新。原因是 fallback 的最后兜底规则会覆盖普通非空行，这类负缓存如果跟随持续输出反复刷新，会把普通 TUI 文本转化成 Host 侧解析压力。输出触发的负缓存 invalidation 也增加最小间隔，避免 spinner / heartbeat 类高频输出把后台刷新压缩成连续循环。若高置信负缓存的 live output 在最小间隔内到达，不丢弃本次失效，而是安排 remaining interval 后的 trailing refresh，确保“文件随后生成”的高置信路径不会长期停留在 stale negative。显式 snapshot / exit / 用户重新 hover 或点击仍可重新解析当前文本；本策略只限制 live output 后台刷新。

同日继续补充两层低风险保护：若当前 cache 里没有任何可刷新的高置信负缓存，live output 不再推进 negative invalidation generation，也不再安排空刷新 timer；Host 侧为每次 `webview/resolveExecutionFileLinks` 记录候选总数、resolved 数、按 source 分类的候选数和耗时，并在 host diagnostics dump 中输出 `execution-file-link-resolve-diagnostics.json` 与 summary，便于真实环境对比 hotfix 前后的请求量和慢请求。

2026-06-10 追加 fallback 降载规则：真实宿主诊断显示多个运行中 Agent 同时输出时，低置信 terminal file link fallback 会把 `• Working   6`、`• Ran gh --version`、`… +24 lines (ctrl + t to view transcript)`、`│ … +2 lines`、`Implement {feature}` 等普通 TUI 文本送到 Host 侧做 workspace fallback resolve，形成慢请求堆积。因此本阶段不引入强负缓存，而是先落地 A + B-lite + C 低风险部分：

1. Webview / shared detector 的 `src/common/executionTerminalLinks.ts` 只保留路径形态足够明确的 fallback candidate：显式路径前缀、包含路径分隔符，或不含空白 / wrapper 文本的文件扩展名；明显 TUI 状态行、transcript 折叠提示、box drawing gutter、模板占位文本和中文 prose 前缀相对路径不再进入 fallback。
2. Host 侧 `src/panel/executionTerminalNativeHelpers.ts` 对 `source: fallback` 再做同口径防线：明显低置信候选直接过滤；只有带 `./` / `../` 或路径分隔符的 fallback 才允许 workspace exact fallback；裸 basename 只尝试当前 cwd direct stat，不再触发 `workspace.findFiles('**/basename')`。
3. Host 编排入口 `src/panel/CanvasPanelManager.ts` 对同一执行节点的 fallback-only resolve 增加低风险并发上限，避免同一节点在 hover / link provider 重入时堆积多个低置信 workspace resolve；诊断样本新增 `retainedCandidateCount`、`filteredCandidateCount`、`retainedSourceCounts`、`filteredSourceCounts` 与 `skippedReasonCounts`，用于确认 hotfix 后过滤量和并发跳过量。
4. 强负缓存仍暂缓：它可能让“刚生成的文件随后变成可点击”的路径短时间 stale，本次真实证据优先指向候选过宽与 Host fallback 过重，先通过候选准入和 host backstop 收口。

同日追加 styled / detected 降载规则：二次宿主诊断显示新版本仍把 `›`、`· 1`、`tab to queue message`、`Improve documentation in @filename`、`2m 45`、`2026-06-10 04:05`、`time.sleep(max(0, 30` 等 ANSI styled TUI 片段以 `source: detected` 发送到 Host，且 400 条采样中 `resolvedCount = 0`。因此普通 styled span 不再直接升级为 `detected` 文件候选；Webview 必须先用共享 path plausibility gate 确认片段是明确文件形态，才以新的 `source: styled` 发送。保留的 styled 文件形态包括带路径分隔符的相对 / 绝对路径、带可信文件扩展名的 basename，以及 `foo.ts:10` / `File "foo.ts", line 3` 这类明确行号位置；明显 prompt glyph、bullet、TUI 状态文案、时间/日期、包名、纯数字比例和代码表达式不进入 Host resolve。Host 侧对 `source: detected` 与 `source: styled` 也执行同一准入防线，避免旧 Webview 或其他入口绕过 Webview 过滤；协议 validator 增加 `styled` source，以便后续诊断能区分来自 styled span 的候选，而不是全部混入 `detected`。

## 验证方法

若进入实现，至少需要完成：

1. Playwright 覆盖 agent / terminal 两类节点：`https://...` 被 TUI 硬换行缩进后，点击任一片段都发出完整 URL。
2. 若实现 style-assisted file path，Playwright 应覆盖 agent / terminal 两类节点：同一非默认 ANSI 样式的相邻片段被重组为完整 file path，点击任一片段都打开同一文件。
3. hover 样例：hover 任一 hard-wrap 片段时，同组所有真实片段都显示下划线，缩进空白不显示下划线。
4. 回归样例：普通 Markdown 列表、缩进代码、中文说明、两个相邻 URL、带句号结尾的 URL、普通同色日志文本，以及首片段后混入 prose 或续片段不从缩进后行首开始的文件片段不被错误重组。
5. 缓存样例：同一 buffer 行位置被 snapshot redraw 成另一个 URL 或另一个 styled path 后，不复用旧完整目标。
6. 性能样例：普通 fallback-only 负缓存不应在 live output 后台刷新中再次发起文件解析请求；高置信 negative file link 仍应在 live output 后刷新。
7. `npm run typecheck` 与 targeted `npm run test:webview -- -g "link activation"` 通过；最终合并前再跑完整 `npm run test:webview`。
8. 手动验证：在真实 Codex / Claude TUI 输出中确认长链接点击目标正确，并记录具体终端宽度、节点宽度、ANSI 样式和样例输出形态。
9. fallback 性能回归：普通 TUI 状态行、transcript 折叠提示和模板占位文本不应生成 fallback file link candidate；Host 侧低置信 fallback 不应触发 workspace fallback 搜索；可接受的裸 basename fallback 只允许 cwd direct stat。
10. styled / detected 性能回归：真实诊断中出现的 prompt glyph、bullet、状态文案、时间/日期、包名、纯数字比例和代码表达式不应进入 Host file resolve；保留 `event.ts`、`docs/readme.md`、`src/foo.ts:10` 与 `"foo", line 10` 等明确文件形态。

### 当前验证记录

2026-05-19 已完成自动化验证：

- `npm run typecheck`
- `npm run test:protocol-webview-messages`
- `npm run test:execution-terminal-links`
- `npm run test:execution-terminal-native-helpers`
- `npm run test:webview -- -g "hard-wrapped URL fragments|hard-wrapped URL detector|styled hard-wrapped file fragments|styled hard-wrapped code paths|styled hard-wrapped file continuations|styled hard-wrapped file hover|unstyled hard-wrapped file fragments|styled hard-wrapped non-links"`
- `npm run test:webview -- -g "link activation posts parsed file and URL targets|hard-wrapped URL fragments|hard-wrapped URL detector|styled hard-wrapped file fragments|styled hard-wrapped code paths|styled hard-wrapped file continuations|styled hard-wrapped file hover|unstyled hard-wrapped file fragments|styled hard-wrapped non-links|low-confidence word links underline only while the modifier is held|does not synthesize trimmed links from attached CJK prose|treats CJK punctuation as a file-link boundary|keeps file-like words clickable across CJK punctuation boundaries|keeps Chinese file paths eligible for exact file links"`

真实 Codex / Claude TUI 输出的手动验证尚未执行，因此验证状态保持为 `验证中`。

2026-05-22 先补性能回归并记录修复前基线：

- 新增 `does not refresh fallback-only negative file links during live output`，覆盖 agent / terminal 两类节点。测试先通过 hover 普通文本行制造 12 条 fallback-only 负缓存，再连续发送 3 次 live output，并期望不再产生 fallback 文件解析请求。
- 修复前该测试失败：agent 与 terminal 都收到 36 次 fallback resolve request，也就是 12 条负缓存乘以 3 次 live output。该结果确认了 0.10.2 行为会把普通文本负缓存随持续输出反复刷新。
- 修复后同一回归的 fallback-only live-output 后台 resolve request 从 36 次降为 0 次；这里的 0 只表示普通 fallback-only 低置信负缓存不再参与 live output 后台刷新，不表示全局 negative cache refresh 失效。高置信 detected / hardwrap 负缓存仍由 `refreshes negative file link cache while live output continues`、`schedules delayed refresh after stale negative refresh is invalidated` 等用例覆盖。
- 定向验证通过：`npm run build && node scripts/test/run-playwright-webview.mjs --grep "does not refresh fallback-only negative file links during live output|refreshes negative file link cache while live output continues|delays coalesced negative file link refreshes after live output|schedules delayed refresh after stale negative refresh is invalidated|hard-wrapped URL fragments open as one link|styled hard-wrapped file fragments resolve as one link"`，共 12 条 Playwright 用例通过。
- 静态与协议回归通过：`npm run typecheck && npm run test:execution-terminal-links && npm run test:protocol-webview-messages && git diff --check`。
- PR review 发现 1s output throttle 内第二次 live output 若才对应文件创建，会丢失高置信负缓存刷新；新增 `refreshes detected negative file link after second live output inside throttle window` 覆盖 agent / terminal，并改为在 throttle window 内安排 trailing refresh。

2026-06-10 补充 fallback 降载回归：

- `npm run typecheck`
- `npm run test:execution-terminal-links`
- `npm run test:execution-terminal-native-helpers`
- `npm run build`
- `test-execution-terminal-links` 覆盖真实诊断中出现的低置信误判行：`• Working   6`、`• Ran gh --version`、`… +24 lines (ctrl + t to view transcript)`、`│ … +2 lines`、`Implement {feature}` 不再成为 fallback path；裸 basename `test-canvas-execution-context.mjs` 仍允许进入低成本候选。
- `test-execution-terminal-native-helpers` 覆盖 Host backstop：裸 basename fallback 不触发 workspace `findFiles`，带目录的 `docs/readme.md` 才允许 workspace exact fallback；过滤器会剔除 bullet / transcript / box drawing / 模板占位 / 中文 prose 前缀候选。

同日继续补充 styled / detected 降载回归：

- `npm run typecheck`
- `npm run test:execution-terminal-links`
- `npm run test:execution-terminal-native-helpers`
- `npm run test:protocol-webview-messages`
- `test-execution-terminal-links` 覆盖真实诊断中的 styled / detected 误判：`›`、`· 1`、`tab to queue message`、`Improve documentation in @filename`、`2m 45`、`2026-06-10 04:05`、`time.sleep(max(0, 30`、`20/60`、`@openai/codex` 和 `/model` 不再通过 styled path gate；`event.ts`、`sql.ts`、`docs/readme.md`、`src/foo.ts:10`、`File "foo.ts", line 3` 仍保留。
- `test-execution-terminal-native-helpers` 覆盖 Host backstop：`source: detected` / `source: styled` 的低置信 TUI 文本会被过滤，明确路径或 basename 才保留；`test-protocol-webview-messages` 覆盖 `styled` source 的 resolve / open 协议解析。
