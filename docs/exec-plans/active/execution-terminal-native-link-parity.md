# 执行节点终端链接全面对齐 VSCode 原生 Terminal

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/execution-terminal-native-link-parity.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更完成后，用户在画布里的 `Terminal` / `Agent` 节点中看到的 link 解析与交互行为，应当与 VSCode 原生 Terminal 保持同类结果，而不再只是“基础可用的近似版”。最直观的验收方式是：在同一个 workspace 里，把一段终端输出同时放进 VSCode 原生 Terminal 和画布执行节点，两边应对同样的文本给出同样的链接命中结果、相同的 hover 提示和同类的打开语义。当前用户最不满的两个点——“过多的 link”和“跨行 link 不支持”——都必须在这次变更里收口。

这里的“全面对齐”指的是用户可观察的解析逻辑和交互逻辑，而不是要求仓库内部类结构与 VSCode 源码一致。当前仓库仍保留 Webview -> Host 的边界：Webview 负责 xterm link interaction 入口，Host 负责文件解析和 VSCode opener；但 detector 顺序、link taxonomy、hover 语义、修饰键规则和 opener 行为都要以 VSCode 原生 Terminal 为准。

## 进度

- [x] (2026-04-30 22:44 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md` 与现有终端链接设计文档，确认本任务属于显著交互重构，必须先补 ExecPlan 和设计文档。
- [x] (2026-04-30 22:44 +0800) 检查当前分支与工作树状态，确认当前在 `link-parser-update` 分支且工作树干净，可直接开展交付性改动。
- [x] (2026-04-30 22:44 +0800) 对照当前仓库实现与 VSCode upstream Terminal link 源码，确认当前主要差异：执行节点仍存在过度注册链接、缺 multiline detector、hover / scheme / word-search 语义与原生不完全一致。
- [x] (2026-04-30 22:44 +0800) 新建本 ExecPlan，并把 `docs/design-docs/execution-node-terminal-native-interactions.md` 更新到“解析 / 交互全面向原生对齐”的新范围。
- [x] (2026-04-30 23:58 +0800) 把 Webview 侧 provider 顺序收口为显式 hyperlink + `multiline -> local -> uri -> word`，并按原生 detector 的 max context / max link length / max links per line 重新限制检测范围。
- [x] (2026-05-01 00:12 +0800) 补齐 multiline link、native local fallback、styled segment fallback 与 broad word/search 语义；同时去掉此前面向 CJK / prose 的仓库私有“修剪后再补 search”行为。
- [x] (2026-05-01 00:18 +0800) 收口 hover 文案、low-confidence search hover 抑制、allowed scheme 与 opener 分流；hover delay 采用仓库内固定值，不把 `workbench.hover.delay` 透传进运行时协议。
- [x] (2026-05-01 00:22 +0800) 更新 Playwright / smoke 用例，覆盖 multiline、plain word search、native punctuation 行为与 host 侧 multiline 打开路径。
- [x] (2026-05-01 01:08 +0800) 继续把 low-confidence `word/search link` 的装饰行为对齐原生：默认 hover 不下划线，只有按住激活修饰键时才临时强调；并在现有 link Playwright 集合上完成回归验证。
- [x] (2026-05-01 03:18 +0800) 根据 review 收口剩余 parity 缺口：search opener 现在会保留 `contextLine` 里的 `line[:column]` 后缀，workspace fallback 支持原生同类的唯一 partial hit，multiline/link resolve cache 会在终端内容变化时失效，且已删除把 wrapper / trailing punctuation 再修剪成 file link 的仓库私有 refine。
- [x] (2026-05-02 00:16 +0800) 继续根据 review 收口 search/local 边界：唯一 partial basename hit 现在只保留在 search opener 路径里，local fallback resolver 回到 exact-only，避免 `README`、`missing-target.ts` 这类 plain word 被错误升级成高置信 file link。
- [x] (2026-05-19 08:05 +0800) 补齐 Codex / Claude TUI 硬换行链接第一阶段：新增 hard-wrap URL provider 与同 ANSI 样式文件路径重组，补充 agent / terminal Playwright 回归，并把正式方案、验证证据同步到 `docs/design-docs/execution-terminal-tui-hard-wrapped-links.md`。
- [x] (2026-05-19 10:46 +0800) 为 TUI 硬换行链接补 grouped hover underline overlay：hover 任一片段时，同组真实片段全部显示下划线，但缩进空白仍不属于 clickable range。
- [x] (2026-05-19 11:47 +0800) 根据真实手测修正 code path 场景：hard-wrap 文件 candidate 改为 `hardwrap` source，并允许 Host 在 cwd 解析失败后做 workspace exact fallback；同时补充带 `line:column` 后缀的 Playwright 回归。
- [x] (2026-05-19 12:04 +0800) 修复真实 VSCode Host 拒绝 `hardwrap` source 的协议缺口：协议 validator 接受 hard-wrap file candidate / open link，并新增 `test:protocol-webview-messages` 回归覆盖。
- [x] (2026-05-19 14:43 +0800) 根据 PR review 先更新正式设计约束：中文语境 start-boundary 不能回归 git diff header；styled hard-wrap file 必须满足首片段贴行尾、续片段从允许缩进后连续承接、行内不混入 prose 的 continuation 链。
- [x] (2026-05-19 14:49 +0800) 收口 PR review 两个 blocker：diff header 剥离 `a/` / `b/` 后保留合法起点信息；styled hard-wrap file collector 改为只接受明确 continuation 链，并补充纯函数与 Playwright 负例回归。
- [x] (2026-05-19 15:21 +0800) 调整 continuation 边界：续行 link 片段从允许缩进后行首开始时，允许后面跟默认样式说明文字；继续拒绝首片段后混入 prose 或续片段不在缩进后行首的误拼接。

## 意外与发现

- 观察：当前仓库的 Webview provider 顺序是显式 hyperlink + `file -> url -> search`，而不是 VSCode 原生 Terminal 的 `multiline -> local -> uri -> word` 顺序。
  证据：`src/webview/executionTerminalNativeInteractions.ts` 中当前只注册 `createFileLinkProvider()`、`createUrlLinkProvider()` 与 `createSearchLinkProvider()`。

- 观察：当前仓库虽然已经有 line-scoped cwd tracker，但它服务的是自定义 file resolver，而不是原生 detector 顺序本身。
  证据：`src/panel/executionTerminalLineContextTracker.ts` 负责维护 `buffer line -> cwd`，`src/panel/executionTerminalNativeHelpers.ts` 在 `resolveExecutionLinkCwd()` 中消费它。

- 观察：VSCode upstream 当前确实把显式 hyperlink、multiline、本地文件、URI 和 word/search 分成多组 detector / opener，并且 search opener 先 exact-open 再 Quick Access fallback。
  证据：2026-04-30 对照 `terminalLinkManager.ts`、`terminalMultiLineLinkDetector.ts`、`terminalLocalLinkDetector.ts`、`terminalUriLinkDetector.ts`、`terminalWordLinkDetector.ts` 与 `terminalLinkOpeners.ts`。

- 观察：VSCode upstream 的显式 hyperlink 还包含 `terminal.integrated.allowedLinkSchemes` 的放行逻辑，而当前仓库没有这层检查。
  证据：`terminalLinkManager.ts` 的显式 hyperlink `activate` 路径会在打开前检查 scheme 是否在 allowed list 中。

- 观察：VSCode 原生 Terminal 的 search link 属于 low-confidence link，hover 时不会像 file / url 一样弹 tooltip；当前仓库此前把 search hover 也当成普通高置信 link 展示，属于真实交互偏差。
  证据：2026-04-30 对照 `terminalLink.ts`，其 `_isHighConfidenceLink` 为 false 时不会调度 hover widget。

- 观察：`npm run test:webview` 当前只剩一个既有的 baseline screenshot diff（`canvas-shell-baseline`，385 px 差异），其余 91 条全部通过；本轮 link 相关 case 全部通过。
  证据：2026-05-01 本地运行 `npm run test:webview`，失败点位于 `tests/playwright/webview-harness.spec.mjs:276` 的截图基线断言，而新增 / 既有 link case 均为绿色。

- 观察：2026-05-01 记录过的 `verifyRealWebviewProbe()` 提前失败已不再重现；当前 head 的 trusted smoke 可以继续跑到 execution terminal native link 路径。当前覆盖拆成两层：更早的 trusted smoke 步骤会先验证未知消息是否既进入 `host/error`，也真实渲染到 editor surface Webview toast；`verifyRealWebviewProbe()` 本身则只保留 “editor surface ready + 真实 Webview 基线渲染” 断言，避免把多类语义绑在同一个 helper 里。
  证据：2026-05-02 运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 通过；对应调整位于 `tests/vscode-smoke/extension-tests.cjs` 的 trusted smoke 前置断言与 `verifyRealWebviewProbe()`。

- 观察：review 暴露出两类此前被误写成“已完成”的差异：一类是 Host 侧 search opener 仍会丢掉 `contextLine` 的 `line[:column]` 后缀，另一类是 multiline/file resolve cache 只按当前 wrapped line 文本缓存，未在终端 clear / redraw 后失效。
  证据：2026-05-01 的 review comment 直接点名 `src/panel/executionTerminalNativeHelpers.ts` 与 `src/webview/executionTerminalNativeInteractions.ts` 对应实现。

- 观察：上一轮把唯一 partial basename hit 做进共享 `resolveExecutionWorkspaceFallbackLink()` 后，local fallback candidate 也会复用这条路径，导致单独一行 `README` / `missing-target.ts` 在 workspace 存在唯一 `README.md` / `missing-target.tsx` 时被直接解析成 file link，而不是保留为 low-confidence search link。
  证据：2026-05-02 的 review comment 直接点名 `src/panel/executionTerminalNativeHelpers.ts`、`src/webview/executionTerminalNativeInteractions.ts` 与 `src/common/executionTerminalLinks.ts` 的共享 fallback 路径。

- 观察：Codex / Claude TUI 会把长 URL 或路径拆成多条非 `isWrapped` buffer 行，`xterm.js` 的 link range 不能把中间的缩进空白排除后表达成一个连续点击区域。
  证据：2026-05-19 的实现改为在 `src/webview/executionTerminalNativeInteractions.ts` 中为每个可见片段各建一个 `ILink`，但这些片段共享同一个完整 URL 或 file target。

- 观察：只凭“下一行有缩进且是 URL-safe 字符”会把完整 URL 与缩进说明误拼接。
  证据：新增 Playwright 用例 `hard-wrapped URL detector does not append indented prose` 覆盖 `https://example.com/docs` 后接缩进 `details` 的负例。

- 观察：`xterm.js` 原生 link hover underline 只会绘制当前 `ILink.range`；因为 hard-wrap link 被拆成多个不连续片段，hover 第二行时第一行不会自动出现下划线。
  证据：2026-05-19 用户手测截图显示同组 hard-wrap 文件路径可点击完整目标，但 hover underline 只覆盖当前片段。

- 观察：真实 Terminal 手测里，code path 常以 `src/foo.` + 下一行 `ts:line:column` 这种方式拆开；Webview 可以识别出拼接候选，但如果 Host 只按当前 cwd 解析失败，用户最终会落到单片段 search link，例如只搜索 `ts:1600:12`。
  证据：2026-05-19 用户手测截图显示第 9、10、11 组点击后分别进入单片段 Quick Open，而不是打开拼接后的完整文件。

- 观察：把文件 hard-wrap candidate 改成独立 `hardwrap` source 后，真实 VSCode Host 会先经过 `parseWebviewMessage(...)` 的协议 validator；如果 validator 未同步接受新 source，Host 会把 `webview/resolveExecutionFileLinks` / `webview/openExecutionLink` 判为未知消息，导致 hover 不显示下划线且点击无效。
  证据：2026-05-19 用户提供的落盘诊断 `/home/users/ziyang01.wang-al/projects/hf_workspace/.debug/current-host-diagnostics/2026-05-19T03-55-02-067Z/host-messages.json` 中出现多条 `host/error`：“收到无法识别的消息，已忽略。”；同一诊断里 hard-wrap file resolve 结果为 `resolvedLinkCount: 0`。

- 观察：中文语境新增的 path start-boundary 过滤会误伤 git diff header。`detectPathsWithoutSuffix()` 已把 `--- a/src/foo.ts`、`+++ b/src/foo.ts` 和 `diff --git a/src/foo.ts b/src/foo.ts` 中的 `a/` / `b/` 剥掉，但随后 boundary 检查看到剥离后 `src` 前一个字符是 `/`，把原本合法的 diff path 过滤掉。
  证据：2026-05-19 PR review 提供的纯函数复现；本地在 PR head 上运行同样脚本，三类输入均返回 `[]`。

- 观察：styled hard-wrap file collector 只按同一 ANSI style signature 查找后续 span，不检查首片段是否贴行尾、续片段是否从缩进后的行首开始、行内是否混入 prose；同色日志片段只要拼接后能被 path parser 和 Host workspace exact fallback 命中，就可能被错误升级成高置信 file link。
  证据：2026-05-19 PR review 指出 `Error at <blue>src/webview/executionTerminalNativeInteractions.</blue> crashed` 与 `note: <blue>ts:1600:12</blue> elsewhere` 会被拼成真实可打开的 `src/webview/executionTerminalNativeInteractions.ts:1600:12`。

## 决策记录

- 决策：这次不再继续微调当前仓库 heuristics，而是把用户可观察的 link 解析与交互行为整体收口到 VSCode 原生 Terminal。
  理由：用户已经明确要求“除实现代码 / 架构分层之外全面向原生对齐”；继续增量 patch 不能保证整体行为一致。
  日期/作者：2026-04-30 / Codex

- 决策：继续保留当前 Webview -> Host 的架构边界，不要求把实现类结构重构成 VSCode 内部类图。
  理由：这是用户明确允许不对齐的范围；当前仓库已有的消息协议、诊断链路和 line context tracker 都可以继续复用。
  日期/作者：2026-04-30 / Codex

- 决策：把 VSCode upstream 源码当作这轮实现和测试的行为 oracle，而不是把当前仓库已有设计文档中的“简化版原生语义”继续当成正式结论。
  理由：现有设计文档记录的是 2026-04-18 为止的已交付范围，不足以覆盖这次用户要求的新目标。
  日期/作者：2026-04-30 / Codex

- 决策：当前仓库已有的 CJK refine、file-like search 收窄等规则，不再自动继承为正式行为；只有当它们是适配当前边界不可避免的技术层补丁时才允许保留。
  理由：这类自定义 heuristics 正是当前“过多链接”与“看似原生、实际不原生”的主要来源之一。
  日期/作者：2026-04-30 / Codex

- 决策：TUI 硬换行作为原生 parity 之外的受控适配层实现，并放在现有 multiline / local / URI / word provider 之前；第一阶段只支持明确 scheme、首片段以常见 URL 断点结尾、续行不以另一条明确 scheme 开始的 URL，以及同一非默认 ANSI style signature 且 Host 验证存在的文件路径。
  理由：用户给出的场景来自 TUI 自身硬换行，不是 `xterm.js` 软换行；直接把所有相邻缩进行拼成 link 会放大误判和 Host 解析成本，因此必须保留强锚点与 Host 验证。
  日期/作者：2026-05-19 / Codex

- 决策：hard-wrap link 的 hover 下划线由 Webview 自绘 overlay 统一绘制，而不是把 `ILink.range` 扩大成跨行连续范围。
  理由：扩大 range 会把行尾空白和下一行缩进也变成链接区域，破坏“缩进不是 link 内容”的边界；overlay 可以只覆盖真实片段，同时保留当前分段点击模型。
  日期/作者：2026-05-19 / Codex

- 决策：为 hard-wrap 文件 candidate 增加独立 `hardwrap` source，并允许 Host 在当前 cwd 未命中时执行 workspace exact fallback，但不启用 partial basename fallback。
  理由：hard-wrap 文件路径已经有同 ANSI 样式锚点和完整 path parser 识别，属于高置信候选；workspace exact fallback 能覆盖 TUI 输出工作区相对路径但执行节点 cwd 不一致的情况，同时避免像普通 search fallback 那样按 basename 猜测。
  日期/作者：2026-05-19 / Codex

- 决策：所有新增 `ExecutionTerminalFileLinkSource` 都必须同步进入 Webview -> Host 协议 validator，并用协议消息级测试覆盖 candidate resolve 与 open link 两条路径。
  理由：Playwright harness 会模拟 Host resolve，不能覆盖真实扩展宿主的 `parseWebviewMessage(...)` 拒绝路径；协议层回归能防止 Webview 侧新增 source 后在真实 VSCode 中变成“未知消息”。
  日期/作者：2026-05-19 / Codex

- 决策：diff header 中被剥离的 `a/` / `b/` 前缀应作为合法起点证据保留下来，不能再用剥离后路径前一个字符是否为通用 boundary 来否定这类 candidate。
  理由：`a/` / `b/` 是 git diff metadata，原生同类场景应继续生成 `src/foo.ts` 链接；把 `/` 加进通用 boundary 会过度放宽普通 prose，因此只对 diff-prefix special case 放行。
  日期/作者：2026-05-19 / Codex

- 决策：styled hard-wrap file candidate 必须先通过结构化 continuation 链检查，再进入 path parser 与 Host resolve；同一 ANSI style signature 只是必要条件，不是充分条件。
  理由：同色 prose 很常见，Host workspace exact fallback 会让误判变成真实打开动作；首片段贴行尾、续片段从允许缩进后开始能保留 TUI 硬换行主路径，同时降低同色日志误拼接。续行 link 片段后的默认样式说明文字不在两段链接之间，不破坏 continuation 链，因此不作为拒绝条件。
  日期/作者：2026-05-19 / Codex

## 结果与复盘

当前实现已经补齐本轮 review 指出的确定性 parity 缺口：search exact-open / Quick Access 会保留 `contextLine` 的 `line[:column]` 信息；原生同类的唯一 partial basename hit 只保留在 search opener 阶段，不再让 local fallback 共享并误把 plain word 升级成 file link；multiline/file resolve cache 会在终端内容变化时失效，避免同槽位 redraw 复用旧目标；wrapper / trailing punctuation 不再被仓库私有 refine 提升成 file link。对应的 helper 单测与 Playwright / targeted regression 已持续补齐。

2026-05-19 新增的 TUI 硬换行第一阶段已经能让带明确 scheme 的硬换行 URL、同一非默认 ANSI 样式拆开的文件路径在 agent / terminal 节点里点击为同一个完整目标；无样式文件路径、自然语言缩进续行和普通同色日志仍不会被重组。随后补上的 grouped hover overlay 让用户 hover 任一片段时能看到同组所有真实片段的下划线，但不会把缩进空白纳入可点击区域。当前自动化验证通过，但真实 Codex / Claude TUI 输出中的手动验证尚未执行，所以这部分仍保持“验证中”。

## 上下文与定向

这次改动横跨四个主要区域。

第一块是 Webview 侧入口，位于 `src/webview/executionTerminalNativeInteractions.ts`。这里现在直接注册了 file、url、search 三个 xterm link provider，并使用自定义 tooltip 和自定义 file candidate refine 逻辑。若要对齐原生 Terminal，这里是 detector 顺序、hover 行为、显式 hyperlink 和测试入口的第一落点。

第二块是共享 parser / link model，主要位于 `src/common/executionTerminalLinks.ts`。这里定义了当前仓库自己的 `ExecutionTerminalOpenLink`、`ExecutionTerminalFileLinkCandidate`、path suffix parser、单行 path parser 与 fallback matcher。若本轮按原生 Terminal 对齐，这里的职责会从“定义产品规则”收缩为“承载等价 parser / 类型适配”。

第三块是 Host 侧 resolver 与 opener，位于 `src/panel/executionTerminalNativeHelpers.ts` 和 `src/panel/CanvasPanelManager.ts`。这里当前负责 file path sanitize、cwd resolve、workspace fallback、search quickOpen fallback 和 `vscode.open` / `showTextDocument` / `revealInExplorer` 等打开动作。若要对齐原生 Terminal，需要把 exact-open、search、allowed scheme 与 file/uri opener 语义重新对齐。

第四块是 line-scoped cwd tracker，位于 `src/panel/executionTerminalLineContextTracker.ts`。这是当前仓库没有 command detection capability 时最接近原生行级 cwd 的输入来源。后续 multiline / local / search opener 如需对齐原生 Terminal，都应优先消费这里的 `buffer line -> cwd`，而不是回退到节点级 cwd。

作为实现 oracle，需要持续参考 VSCode upstream 这几个文件的当前行为：

    src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkManager.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalMultiLineLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalLocalLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalUriLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalWordLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkOpeners.ts

本计划中的“原生对齐”默认指向 2026-04-30 观察到的 upstream `main` 行为，而不是历史记忆或旧设计文档中的口径。

## 工作计划

先收口 parser 与 detector 顺序。`src/webview/executionTerminalNativeInteractions.ts` 不能继续把 file、url、search 当成三条仓库私有逻辑独立维护，而应显式映射到原生 Terminal 的 detector 顺序：显式 hyperlink、multiline、本地路径、URI、word/search。这里优先做的是把“当前有哪些文本会成为 link”这件事对齐，而不是先追求 hover 细节。

然后收口共享 link model。`src/common/executionTerminalLinks.ts` 当前混合了承载协议类型、仓库私有 path parser 和自定义 fallback matcher 三类职责。实现时应把“消息与类型”保留下来，把“解析规则”替换成原生等价逻辑；如果发现某些 parser 更适合迁回 Webview / Host 层，也可以拆分，但最终要让读代码的人能直接看出“这些规则对应的是原生 Terminal 的哪一类 detector”。

接着改 Host opener。`src/panel/executionTerminalNativeHelpers.ts` 当前已经有 prepare / resolve / open 分层，这是可以保留的；但 `resolveExecutionFileLink()`、`openExecutionTerminalSearchLink()` 与 URL opener 里的 scheme 处理，需要重新对齐原生 exact-open、Quick Access fallback、`file://` 特化和 allowed scheme 语义。若新增配置读取或提示逻辑，优先放在 Host，避免把安全判断留在 Webview。

随后补 multiline 与 styled fallback。当前执行节点完全没有 multiline detector，这会直接导致 ripgrep / eslint / diff 输出与原生体验分叉。实现时应新增等价的 multiline detector，并补上 local detector 在普通 parser miss 后的 styled segment fallback，而不是继续扩张当前的 CJK refine。

最后补测试。Playwright 要明确覆盖“当前已知误判样例与原生结果一致”“multiline 可点击”“word/search 优先级与 open 行为一致”；真实 VSCode smoke 要至少覆盖一条跨行文件打开和一条 search Quick Access fallback。若 allowed scheme 提示做成可测路径，也要补一条宿主级验证。

## 具体步骤

1. 在仓库根目录维护文档与索引：

       docs/design-docs/execution-node-terminal-native-interactions.md
       docs/design-docs/index.md
       docs/exec-plans/active/execution-terminal-native-link-parity.md

2. 在 `src/webview/executionTerminalNativeInteractions.ts` 中重构 detector 注册顺序：

       显式 hyperlink
       multiline detector
       local detector
       uri detector
       word/search detector

   若现有文件过于拥挤，可把 detector 适配层拆到新的 `src/webview/` 或 `src/common/` 模块，但必须在计划和设计文档中同步更新落点。

3. 在 `src/common/executionTerminalLinks.ts` 中整理共享类型与 parser：

       保留协议类型和后续 Host / Webview 都需要消费的纯数据结构；
       用原生等价逻辑替换当前仓库私有 parser；
       删除或降级不再属于正式产品语义的自定义 heuristics。

4. 在 `src/panel/executionTerminalNativeHelpers.ts` 中对齐 opener 与 search 语义：

       文件 / 目录 opener
       file:// URI 特化
       search exact-open
       Quick Access fallback
       allowed scheme 检查与提示（若实现）

5. 在 `src/panel/CanvasPanelManager.ts` 中仅保留上下文装配、缓存与消息转发，不把新的产品规则重新写散到 manager 中。

6. 在 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs` 中新增或更新回归。至少添加：

       multiline 路径
       误判样例
       word/search 行为
       search fallback
       hover / modifier 语义

7. 在仓库根目录持续运行：

       npm run typecheck
       npm run test:webview
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs

   若出现某条用例与原生 Terminal 行为不一致，不允许直接改测试去迁就当前实现，而应回到 upstream 行为核对差异来源。

## 验证与验收

验收时至少要证明以下行为：

1. 对同一组终端输出，执行节点与 VSCode 原生 Terminal 在“是否检测成 link、检测成哪一类 link、点击后走哪类 opener”上保持一致。
2. ripgrep / eslint 类跨行路径输出在执行节点中恢复可点击，且点击后能打开到正确位置。
3. 当前已知“过多链接”样例在执行节点中不再比原生 Terminal 注册更多 file-like link。
4. `word/search link`、`search exact-open` 与 `Quick Access fallback` 语义与原生一致。
5. hover 文案和修饰键与原生一致；如果实现了 allowed scheme 提示，则未放行 scheme 不会直接打开。
6. `npm run typecheck`、`npm run test:webview` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 通过。

## 幂等性与恢复

文档修改、parser 重构和测试补充都应是可重复执行的普通增量改动，不涉及破坏性迁移。若中途发现某条原生对齐路线需要大面积替换当前 parser，可先并行保留新旧 detector，在测试中只让新 detector 生效于受控样例；待 native parity 稳定后再删旧路径。若 smoke 因非本轮问题失败，必须在 `意外与发现` 中记录失败点和是否与当前 link 变更相关，不能把“命令跑过但 unrelated failure 存在”误写成已验证。

## 证据与备注

当前开始阶段最关键的证据是：

    当前仓库：显式 hyperlink + file/url/search provider，缺 multiline detector。
    VSCode upstream：显式 hyperlink + multiline/local/uri/word detector 顺序，search opener 先 exact-open 后 Quick Access。

后续在这里追加最短必要的测试输出，证明“multiline 恢复可点击”和“误判数量收敛到原生结果”。

## 接口与依赖

本轮优先复用现有依赖，不默认引入新的 parser 库。需要直接持续使用和对齐的仓库内接口包括：

- `src/webview/executionTerminalNativeInteractions.ts`
  - `setupExecutionTerminalNativeInteractions(...)`
  - 各 detector provider 的创建与 hover / activate 入口
- `src/common/executionTerminalLinks.ts`
  - `ExecutionTerminalOpenLink`
  - `ExecutionTerminalFileLinkCandidate`
  - 原有 parser / fallback matcher 的替换落点
- `src/panel/executionTerminalNativeHelpers.ts`
  - `resolveExecutionFileLink(...)`
  - `resolveExecutionTerminalFileLinkCandidates(...)`
  - `openExecutionTerminalLink(...)`
- `src/panel/executionTerminalLineContextTracker.ts`
  - `getCwdForBufferLine(...)`
- `src/panel/CanvasPanelManager.ts`
  - `handleResolveExecutionFileLinks(...)`
  - `handleOpenExecutionLink(...)`

若实现过程中需要从 VSCode upstream 移植或改写逻辑，必须在注释或计划中明确它对应的是哪一类原生 detector / opener，而不是留下无法追溯来源的“魔法正则”或“经验规则”。

本次更新说明：2026-04-30 新建本计划，并把任务目标从“基础 terminal link 可用”升级为“除实现分层外，解析与交互全面向 VSCode 原生 Terminal 对齐”，以响应当前关于“过多链接”和“缺少跨行链接”的最新用户反馈。

本次更新说明：2026-05-19 追加 Codex / Claude TUI 硬换行链接第一阶段实现与验证记录；该能力属于原生 parity 之外的受控适配层，因此同步记录强锚点规则、误判边界和真实 TUI 手动验证缺口。

本次更新说明：2026-05-19 追加 grouped hover underline overlay 决策；该方案避免把 hard-wrap link range 扩成连续跨行范围，同时解决用户手测发现的“可点击但视觉下划线不像同一个链接”的问题。
