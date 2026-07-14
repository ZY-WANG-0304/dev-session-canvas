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
- [x] (2026-05-22 17:30 +0800) 按 hotfix 要求先补性能回归并记录修复前基线：fallback-only 负缓存测试在修复前 agent / terminal 都产生 36 次 live-output 后台 resolve request；随后限制 live output 只刷新高置信负缓存，并增加输出 invalidation 最小间隔。
- [x] (2026-06-10 18:40 +0800) 根据二次宿主诊断继续降载：styled span 不再直接伪装成 `detected`，而是必须通过共享 path plausibility gate 后以 `styled` source 发送；`detected` / `styled` 在 Webview 与 Host 双侧都执行同一准入防线，并补协议、纯函数与 Host helper 回归。
- [x] (2026-06-11 20:35 +0800) 根据第四次宿主诊断改为交互优先：file-link provider 只暴露轻量 pending link，Host resolve 改为点击时 `interactive` 触发；高置信负缓存后台刷新标记为 `background`，Host 增加 resolve cache / in-flight dedupe / 背景请求节流，并把诊断 schema 提升到 v3。
- [x] (2026-07-14 18:32 +0800) 修复执行链接无法打开 PNG / GIF / MP4 等媒体文件：普通文件统一交给 `vscode.open`，保留文本 selection；同步正式设计索引、command rejection 诊断语义、PNG custom editor smoke 与 GIF / MP4 未分别执行真实 fixture 的验证边界。
- [x] (2026-07-14 21:15 +0800) 根据 PR #266 follow-up 把“上下文与定向”“工作计划”“具体步骤”“证据与备注”从 2026-04-30 的起始基线更新为当前实现，明确 hard-wrap / multiline / file / URL / word provider 与 multiline detector 已落地，不再把已完成工作写成待办。

## 意外与发现

- 观察：2026-04-30 开始本计划时，仓库的 Webview provider 顺序是显式 hyperlink + `file -> url -> search`，而不是 VSCode 原生 Terminal 的 `multiline -> local -> uri -> word` 顺序。
  证据：当时版本的 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 只注册 `createFileLinkProvider()`、`createUrlLinkProvider()` 与 `createSearchLinkProvider()`；当前实现状态见后文“上下文与定向”和“证据与备注”。

- 观察：当前仓库虽然已经有 line-scoped cwd tracker，但它服务的是自定义 file resolver，而不是原生 detector 顺序本身。
  证据：`extensions/vscode/dev-session-canvas/src/panel/executionTerminalLineContextTracker.ts` 负责维护 `buffer line -> cwd`，`extensions/vscode/dev-session-canvas/src/panel/executionTerminalNativeHelpers.ts` 在 `resolveExecutionLinkCwd()` 中消费它。

- 观察：VSCode upstream 当前确实把显式 hyperlink、multiline、本地文件、URI 和 word/search 分成多组 detector / opener，并且 search opener 先 exact-open 再 Quick Access fallback。
  证据：2026-04-30 对照 `terminalLinkManager.ts`、`terminalMultiLineLinkDetector.ts`、`terminalLocalLinkDetector.ts`、`terminalUriLinkDetector.ts`、`terminalWordLinkDetector.ts` 与 `terminalLinkOpeners.ts`。

- 观察：VSCode upstream 的显式 hyperlink 包含 `terminal.integrated.allowedLinkSchemes` 的放行逻辑，而 2026-04-30 的仓库起始版本没有这层检查。
  证据：`terminalLinkManager.ts` 的显式 hyperlink `activate` 路径会在打开前检查 scheme 是否在 allowed list 中；当前 Host 已由 `ensureExecutionTerminalUrlSchemeAllowed(...)` 承担这一路径。

- 观察：VSCode 原生 Terminal 的 search link 属于 low-confidence link，hover 时不会像 file / url 一样弹 tooltip；当前仓库此前把 search hover 也当成普通高置信 link 展示，属于真实交互偏差。
  证据：2026-04-30 对照 `terminalLink.ts`，其 `_isHighConfidenceLink` 为 false 时不会调度 hover widget。

- 观察：2026-05-01 运行 `npm run test:webview` 时只剩一个既有的 baseline screenshot diff（`canvas-shell-baseline`，385 px 差异），其余 91 条全部通过；当时本轮 link 相关 case 全部通过。
  证据：2026-05-01 本地运行 `npm run test:webview`，失败点位于 `tests/playwright/webview-harness.spec.mjs:276` 的截图基线断言，而新增 / 既有 link case 均为绿色。

- 观察：2026-05-01 记录过的 `verifyRealWebviewProbe()` 提前失败已不再重现；当前 head 的 trusted smoke 可以继续跑到 execution terminal native link 路径。当前覆盖拆成两层：更早的 trusted smoke 步骤会先验证未知消息是否既进入 `host/error`，也真实渲染到 editor surface Webview toast；`verifyRealWebviewProbe()` 本身则只保留 “editor surface ready + 真实 Webview 基线渲染” 断言，避免把多类语义绑在同一个 helper 里。
  证据：2026-05-02 运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 通过；对应调整位于 `tests/vscode-smoke/extension-tests.cjs` 的 trusted smoke 前置断言与 `verifyRealWebviewProbe()`。

- 观察：review 暴露出两类此前被误写成“已完成”的差异：一类是 Host 侧 search opener 仍会丢掉 `contextLine` 的 `line[:column]` 后缀，另一类是 multiline/file resolve cache 只按当前 wrapped line 文本缓存，未在终端 clear / redraw 后失效。
  证据：2026-05-01 的 review comment 直接点名 `extensions/vscode/dev-session-canvas/src/panel/executionTerminalNativeHelpers.ts` 与 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 对应实现。

- 观察：上一轮把唯一 partial basename hit 做进共享 `resolveExecutionWorkspaceFallbackLink()` 后，local fallback candidate 也会复用这条路径，导致单独一行 `README` / `missing-target.ts` 在 workspace 存在唯一 `README.md` / `missing-target.tsx` 时被直接解析成 file link，而不是保留为 low-confidence search link。
  证据：2026-05-02 的 review comment 直接点名 `extensions/vscode/dev-session-canvas/src/panel/executionTerminalNativeHelpers.ts`、`extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 与 `extensions/vscode/dev-session-canvas/src/common/executionTerminalLinks.ts` 的共享 fallback 路径。

- 观察：Codex / Claude TUI 会把长 URL 或路径拆成多条非 `isWrapped` buffer 行，`xterm.js` 的 link range 不能把中间的缩进空白排除后表达成一个连续点击区域。
  证据：2026-05-19 的实现改为在 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 中为每个可见片段各建一个 `ILink`，但这些片段共享同一个完整 URL 或 file target。

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
  证据：2026-05-19 PR review 指出 `Error at <blue>extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.</blue> crashed` 与 `note: <blue>ts:1600:12</blue> elsewhere` 会被拼成真实可打开的 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts:1600:12`。

- 观察：0.10.2 的 live output 负缓存刷新会反复刷新 fallback-only 普通文本。新增性能回归在修复前失败，agent 与 terminal 都收到 36 次 `webview/resolveExecutionFileLinks` fallback 请求，来源是 12 条普通文本负缓存乘以 3 次 live output。
  证据：2026-05-22 运行 `npm run build && node scripts/test/run-playwright-webview.mjs --grep "does not refresh fallback-only negative file links during live output"`，新增用例在 agent / terminal 均失败，收到值为 `36`，期望为 `0`。

- 观察：2026-06-10 的二次宿主诊断显示 fallback 降载没有命中当前主因；400 条 file-link resolve 采样中全部仍是 `source: detected`，`filteredCandidateCount = 0`，但候选文本大量是 `›`、`· 1`、`tab to queue message`、`Improve documentation in @filename`、`2m 45`、日期时间、代码表达式和 box drawing 文本，最终 `resolvedCount = 0`。
  证据：用户提供的 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-10T10-08-29-170Z/execution-file-link-resolve-diagnostics.json`；对比旧诊断后，file-link resolve p50 从 29ms 升到 116ms，p90 从 71ms 升到 450ms，而 input write p50 从 86ms 降到 14ms。

- 观察：2026-06-11 复核第三次宿主诊断时，input write 相比原始版本仍改善，但 file-link resolve 已成为新的主瓶颈；207 次请求累计 613.7s，p90 13.0s，max 33.3s，慢请求主要是 `build/plan`、`Dashboard/配置页/状态按钮很多不会按预期工作`、`@earendil-works/pi-coding-agent` 等非文件候选。该 dump 仍显示 `filteredCandidateCount = 0` 且没有 `source: styled`，因此后续诊断需要 schema/version 标记来区分“未安装最新构建”和“规则仍不够窄”。
  证据：用户提供的 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-06-10T16-23-08-709Z/summary.json` 与 `execution-file-link-resolve-diagnostics.json`；同一 dump 的 host input p50 为 20ms、p90 为 118ms，但 file-link resolve p50 为 116ms、p90 为 13027ms、p95 为 17160ms、max 为 33345ms。

- 观察：`workspace.openTextDocument` 会把所有普通文件强制解释成文本，导致 PNG、GIF、MP4 已解析成功却在打开阶段 rejection；改用 `vscode.open` 后，VS Code 会按已注册 custom editor 选择图片或视频预览，同时继续接受文本 selection。
  证据：2026-07-14 的现场诊断中三类媒体均 `resolvedCount = 1`，但旧实现记录 `execution/linkOpenRejected`；新增 trusted Host smoke 确认 PNG 打开为 `TabInputCustom` 且 `viewType=imagePreview.previewEditor`。

- 观察：`vscode.open` 的命令返回契约不能报告 editor model 的最终加载结果。命令 rejection 可由 Host 捕获并写入 `execution/linkOpenRejected.detail.error`；若 editor service 内部显示错误占位页，命令仍正常 resolve，当前应记录 `execution/linkOpened`。缓存目标在 resolve 后被删除或移动时也可能进入后一条路径。
  证据：2026-07-14 review 的真实 Host 探针确认不存在文件会打开 “file was not found” 占位页且命令正常 resolve；本轮 smoke 另外注入精确 command rejection，锁定可观察错误边界。

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

- 决策：live output 后台刷新只处理高置信负缓存，纯 `fallback` 负缓存不参与刷新；输出触发的负缓存 invalidation 增加最小间隔。
  理由：fallback 兜底规则会覆盖普通非空行，若这些负缓存随持续输出反复刷新，会把普通 TUI 文本持续送到 Host 文件解析和 workspace fallback。高置信 `detected` / `hardwrap` 仍保留 live output 后刷新，避免刚生成文件的路径长期不可点击；若 output throttle window 内又收到高置信失效，必须安排 trailing refresh，不能丢弃最后一次文件生成信号。
  日期/作者：2026-05-22 / Codex

- 决策：若当前 cache 中没有任何可刷新的高置信负缓存，live output 不再推进 negative invalidation generation，也不安排空刷新 timer；Host 侧记录每次 file link resolve 的候选数、按 source 分类、resolved 数和耗时，并写入 host diagnostics dump。
  理由：fallback-only 已退出后台刷新后，继续为纯 fallback 缓存推进 generation 和 timer 只会制造无效主线程调度；Host 侧诊断能让真实环境继续验证请求量是否从 0.10.2 的放大行为回落，而不是只能依赖 Playwright mock 计数。
  日期/作者：2026-05-22 / Codex

- 决策：styled span 不能直接作为高置信 `detected` 文件候选；只有明确 file-like、path-like 或 line-location 形态通过共享 gate 后，才以新的 `styled` source 进入 Host。`detected` 与 `styled` 都要在 Webview 和 Host 双侧执行同一准入防线。
  理由：真实 TUI 会把 prompt glyph、状态文案、时间、包名、代码表达式等都染成非默认样式；把这些文本直接标成 `detected` 会绕过 fallback 降载和 source 诊断，造成大量 `resolvedCount = 0` 的 Host 解析请求。新增 `styled` source 让后续诊断能区分 styled span 来源，同时 Host backstop 可保护旧 Webview 或其他入口。
  日期/作者：2026-06-10 / Codex

- 决策：继续收紧 `detected` / `styled` / `hardwrap` 的 extensionless path gate，并把 Host 侧同一节点 file-link resolve 串行化；诊断 summary 增加 `diagnosticsSchema.executionFileLinkResolve = 2`。
  理由：第三次真实 dump 证明剩余主因已经不是 prompt glyph，而是 CJK prose 斜杠短语、domain path fragment、package name 和泛化目录短语进入 Host resolve；同时同一节点重复 resolve 会把单次 100ms 级 filesystem probe 排队放大成 30s 级尾延迟。新规则只保留带文件扩展名、显式路径前缀、`file://`、或以 `src` / `docs` / `packages` 等常见代码目录根开头的 extensionless 目录；不同节点仍可并行，同一节点内部串行。schema 标记用于下次现场直接确认是否运行到本批代码。
  日期/作者：2026-06-11 / Codex

- 决策：停止继续靠静态 allowlist / denylist 扩展保性能，转为“交互优先 + 懒解析 + 缓存 + 预算”。Webview provider 不再因 hover / link 枚举主动发 Host resolve；pending file link 在点击时以 `priority: interactive` 解析并立即打开，失败则降级 search。高置信 negative cache 的 live-output 刷新保留，但标记为 `priority: background`；Host 对同 key in-flight 去重、30s 结果缓存、同节点串行和背景请求最小间隔做统一保护，诊断 schema 提升为 v3 并记录 priority / cache 计数。
  理由：第四次真实 dump 显示 file-link 请求已从 207 降到 7，输入 p90 约 79ms，但候选已明显偏少；继续收紧会损害链接体验，且单次 `stat` 仍可能抖到秒级。昂贵的文件验证必须被用户意图、缓存和预算约束，而不是由 xterm provider 枚举触发。
  日期/作者：2026-06-11 / Codex

- 决策：普通文件统一使用 `vscode.open`，由 VS Code editor service 选择文本或 custom editor；`execution/linkOpened` 表示 opener 命令已受理，`execution/linkOpenRejected` 只表示命令 rejection。本轮不为缓存目标增加激活前重复 `stat`。
  理由：通用 opener 才能覆盖图片、GIF、视频等二进制文件，同时保留文本 selection。公开命令契约无法观察 editor 内部加载结果；重复 `stat` 会增加交互路径 I/O，并且用户已经能从 VS Code 错误占位页看到 stale target，因此当前保持 command-based 口径并把边界写清。
  日期/作者：2026-07-14 / Codex

## 结果与复盘

当前实现已经补齐本轮 review 指出的确定性 parity 缺口：search exact-open / Quick Access 会保留 `contextLine` 的 `line[:column]` 信息；原生同类的唯一 partial basename hit 只保留在 search opener 阶段，不再让 local fallback 共享并误把 plain word 升级成 file link；multiline/file resolve cache 会在终端内容变化时失效，避免同槽位 redraw 复用旧目标；wrapper / trailing punctuation 不再被仓库私有 refine 提升成 file link。对应的 helper 单测与 Playwright / targeted regression 已持续补齐。

2026-05-19 新增的 TUI 硬换行第一阶段已经能让带明确 scheme 的硬换行 URL、同一非默认 ANSI 样式拆开的文件路径在 agent / terminal 节点里点击为同一个完整目标；无样式文件路径、自然语言缩进续行和普通同色日志仍不会被重组。随后补上的 grouped hover overlay 让用户 hover 任一片段时能看到同组所有真实片段的下划线，但不会把缩进空白纳入可点击区域。当前自动化验证通过，但真实 Codex / Claude TUI 输出中的手动验证尚未执行，所以这部分仍保持“验证中”。

2026-05-22 hotfix 先用失败测试记录了修复前性能状况：fallback-only 普通文本负缓存会被每次 live output 批量刷新，12 条普通文本缓存和 3 次输出即可产生 36 次文件解析请求。实现收口后，同一回归里的 fallback-only live-output 后台解析请求降为 0 次；这里的 0 只表示普通 fallback-only 低置信负缓存退出 live output 后台刷新，不表示全局 negative cache refresh 失效。高置信 detected / hardwrap 负缓存仍可在文件创建后刷新。随后补充空刷新保护，避免纯 fallback cache 在 live output 后继续推进无效 generation / timer；Host 侧新增 file link resolve 诊断，后续真实 dump 会包含按 source 分类的请求量与慢请求摘要。定向验证已覆盖新增性能回归、既有 negative refresh、coalesced refresh 与 stale refresh 场景。

PR review 后补齐 output throttle trailing refresh：当第二次 live output 在 1s 最小间隔内才让高置信 `detected` 负缓存变为可解析时，不再直接丢弃 invalidation，而是在 remaining interval 后触发 trailing refresh。新增 `refreshes detected negative file link after second live output inside throttle window` 覆盖 agent / terminal。

2026-06-10 二次降载继续把 styled span 与一般 detected 候选收窄到明确路径形态。对用户提供的新诊断样本做离线回放时，582 个候选中只有 28 个会通过新 gate，其余 554 个 prompt glyph、状态文案、时间/日期、包名、纯数字比例和代码表达式会被过滤；保留的主要是 `input.ts`、`event.ts`、`sql.ts`、`session.ts` 和 `.dev-session-canvas/templates/测试上传-` 等 file-like 文本。自动化验证通过 `npm run typecheck`、`npm run test:execution-terminal-links`、`npm run test:execution-terminal-native-helpers`、`npm run test:protocol-webview-messages`、定向 `npm run test:webview -- --grep "link activation posts parsed file and URL targets|styled hard-wrapped file fragments resolve as one link|styled hard-wrapped non-links are not guessed as one link|unstyled hard-wrapped file fragments are not guessed as one link"`、`npm run build` 与 `git diff --check`。

2026-06-11 第三轮诊断后继续降载：共享 gate 过滤 `旧源码里某个未发布/未同步版本`、`openai.com/policies`、`en/articles/...`、`Plus/Pro`、`build/plan`、`directory/project/`、`package/@earendil-works/pi-coding-agent` 和 `Dashboard/配置页/状态按钮很多不会按预期工作`；Host backstop 同步覆盖 `hardwrap`，避免 `@earendil-works/pi-coding-agent` 进入高置信 resolve；fallback 拒绝 `git+https://...` 这类非 file URI-like 字符串。对第三次 dump 离线回放，213 个候选中 182 个会被新 gate 过滤，保留 31 个明确路径；其中 100% 过滤了 `build/plan`、`openai.com/policies`、package 名、CJK prose 和泛化目录。Host 同一节点 file-link resolve 改成串行队列，避免同一节点 hover/cache refresh 重入把 filesystem probe 打满；summary 增加 `diagnosticsSchema.executionFileLinkResolve = 2` 作为下次现场校验标记。当前已通过 `npm run typecheck`、`npm run test:execution-terminal-links`、`npm run test:execution-terminal-native-helpers`、`npm run build`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "styled hard-wrapped non-links are not guessed as one link|unstyled hard-wrapped file fragments are not guessed as one link|treats CJK punctuation as a file-link boundary|keeps file-like words clickable across CJK punctuation boundaries|keeps Chinese file paths eligible for exact file links"` 与 `git diff --check`。

同日第四轮诊断后转向交互机制：最新 dump 证明 hotfix 已把 file-link resolve 从 207 次 / 613.7s 降到 7 次 / 2.93s，输入 p50 17ms、p90 79ms，但候选也被压到只剩少量明确路径，继续静态收紧会牺牲链接可发现性。实现上，`extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 的 file / multiline / styled / hardwrap provider 现在只返回 pending file link；点击 pending link 时才调用 Host resolve，成功后立即打开 file，失败后降级 search。`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 和协议增加 `priority` 字段；`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 记录 priority / cache 诊断，维护 30s resolve cache、in-flight dedupe、同节点串行和背景请求节流，`resolvedId` 也保存真实 resolved target，打开时优先复用已解析结果。`extensions/vscode/dev-session-canvas/src/panel/executionTerminalNativeHelpers.ts` 在单次 candidate group 内复用 `stat` / workspace fallback promise，避免重复路径重复 filesystem probe。新增 / 更新测试覆盖 priority 协议、重复 stat 去重、fallback hover 不 eager resolve、fallback 点击才 interactive resolve、既有高置信 negative refresh 和 link activation 回归；已通过 `npm run typecheck`、`npm run test:execution-terminal-links`、`npm run test:execution-terminal-native-helpers`、`npm run test:protocol-webview-messages`、`npm run build` 和定向 `npm run test:webview -- --grep "link activation posts parsed file and URL targets|styled hard-wrapped file fragments resolve as one link|reuses file link resolution while live output continues|refreshes negative file link cache while live output continues|does not eagerly resolve fallback-only text during hover or live output|resolves fallback file links only on activation|keeps unresolved file link fallback stable while live output continues"`。

2026-07-14 的媒体 opener 修复把普通文件从 `workspace.openTextDocument` 切换为 `vscode.open`。文本 exact-open 与 multi-root search 继续传递 line / column selection；图片、GIF、视频由 VS Code 已注册 custom editor 接管。trusted Host smoke 直接验证 PNG 使用 `imagePreview.previewEditor`，并注入一次 command rejection 验证 `execution/linkOpenRejected.detail.error`；GIF / MP4 虽走同一路径且有 VS Code 1.128 内置 media-preview 注册，但尚未分别执行真实 Host fixture。诊断结论只覆盖 opener 命令是否 resolve/reject，不覆盖 editor service 内部显示错误占位页的加载结果。

同日 PR follow-up 复核了计划与当前代码的自一致性：2026-04-30 开始时缺失的 multiline detector 已完成，Webview 当前通过显式 hyperlink handler 和 hard-wrap、multiline、file、URL、word 五类 provider 承载链接交互。计划后半部已改为描述当前实现和后续维护动作，不再把这部分历史起点误写成未完成状态。

## 上下文与定向

这次改动横跨四个主要区域。

第一块是 Webview 侧入口，位于 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts`。`setupExecutionTerminalNativeInteractions(...)` 先通过 `terminal.options.linkHandler` 承载显式 hyperlink，再依次注册 hard-wrap、multiline、file/local、URL、word/search 五类 xterm link provider，并统一管理 tooltip、低置信装饰和 hard-wrap hover overlay。这里是 detector 顺序、hover 行为、显式 hyperlink 和测试入口的主要落点。

第二块是共享 parser / link model，主要位于 `extensions/vscode/dev-session-canvas/src/common/executionTerminalLinks.ts`。这里定义 `ExecutionTerminalOpenLink`、`ExecutionTerminalFileLinkCandidate`、path suffix parser、单行 path parser 与 fallback matcher，当前职责是承载 Webview / Host 共同使用的原生同类 parser、协议类型和受控适配规则；后续修改必须继续区分“原生 parity”与 TUI hard-wrap 等仓库适配层。

第三块是 Host 侧 resolver 与 opener，位于 `extensions/vscode/dev-session-canvas/src/panel/executionTerminalNativeHelpers.ts` 和 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`。这里当前负责 file path sanitize、cwd resolve、workspace fallback、search quickOpen fallback 和 `vscode.open` / `revealInExplorer` 等打开动作。普通文件统一交给 `vscode.open`，让 editor service 在文本与 custom editor 之间选择；Host 只能观察 opener 命令是否 reject，不能观察 editor 内部加载结果。若要对齐原生 Terminal，需要继续保持 exact-open、search、allowed scheme 与 file/uri opener 语义一致。

第四块是 line-scoped cwd tracker，位于 `extensions/vscode/dev-session-canvas/src/panel/executionTerminalLineContextTracker.ts`。这是当前仓库没有 command detection capability 时最接近原生行级 cwd 的输入来源；multiline、local 与 search opener 当前都应优先消费这里的 `buffer line -> cwd`，只有缺少行级记录时才回退到节点级 cwd。

作为实现 oracle，需要持续参考 VSCode upstream 这几个文件的当前行为：

    src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkManager.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalMultiLineLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalLocalLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalUriLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalWordLinkDetector.ts
    src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkOpeners.ts

本计划中的“原生对齐”默认指向 2026-04-30 观察到的 upstream `main` 行为，而不是历史记忆或旧设计文档中的口径。

## 工作计划

核心 parser 与 detector 顺序已经完成收口。`extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 当前以显式 hyperlink handler 开始，再按 hard-wrap 受控适配、multiline、本地路径、URI、word/search 的顺序注册 provider。后续工作是在 VSCode upstream 行为变化或现场诊断暴露偏差时维护这一映射，而不是重新实现 multiline detector。

共享 link model 已保留消息类型、路径后缀解析和原生同类 fallback matcher，并将 hard-wrap、styled 等适配来源显式化。后续调整 `extensions/vscode/dev-session-canvas/src/common/executionTerminalLinks.ts` 时，应继续删除无法追溯到原生行为或已记录适配需求的 heuristics，并让规则能明确映射到对应 detector。

Host opener 已保留 prepare / resolve / open 分层，并覆盖 exact-open、Quick Access fallback、`file://` 特化、allowed scheme 与通用文件 opener。后续维护 `resolveExecutionFileLink()`、`openExecutionTerminalSearchLink()` 和 URL opener 时，安全检查继续留在 Host，且不得破坏文本 selection、媒体 custom editor 或 command-based opened/rejected 诊断口径。

Multiline detector、local fallback 与 styled / hard-wrap 受控适配均已落地，并由 ripgrep / eslint、git diff、TUI hard-wrap 和误拼接负例覆盖。后续若出现漏判或误判，应先核对 upstream detector 与现有适配边界，再修改对应 provider；不得重新依靠泛化 CJK refine 扩张高置信 file link。

测试当前覆盖已知误判、multiline 点击、word/search 优先级、exact-open、Quick Access fallback、文本 selection、PNG custom editor 与 opener command rejection。后续每次调整 detector 或 opener 都要更新对应纯函数、Playwright 或真实 Host smoke，并把尚未直接覆盖的媒体或平台边界留在本计划。

## 具体步骤

1. 在仓库根目录维护文档与索引：

       docs/design-docs/execution-node-terminal-native-interactions.md
       docs/design-docs/index.md
       docs/exec-plans/active/execution-terminal-native-link-parity.md

2. 在 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 中维护当前 detector / provider 注册顺序：

       显式 hyperlink
       hard-wrap 受控适配
       multiline detector
       local detector
       uri detector
       word/search detector

   这套顺序已经落地。若后续文件继续膨胀，可把 detector 适配层拆到新的 `extensions/vscode/dev-session-canvas/src/webview/` 或 `extensions/vscode/dev-session-canvas/src/common/` 模块，但必须在计划和设计文档中同步更新落点。

3. 在 `extensions/vscode/dev-session-canvas/src/common/executionTerminalLinks.ts` 中持续维护共享类型与 parser：

       保留协议类型和后续 Host / Webview 都需要消费的纯数据结构；
       保持解析规则可追溯到原生等价逻辑或已记录的受控适配；
       删除或降级不再属于正式产品语义的自定义 heuristics。

4. 在 `extensions/vscode/dev-session-canvas/src/panel/executionTerminalNativeHelpers.ts` 中维持已经对齐的 opener 与 search 语义：

       文件 / 目录 opener
       file:// URI 特化
       search exact-open
       Quick Access fallback
       allowed scheme 检查与提示（若实现）

5. 在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中仅保留上下文装配、缓存与消息转发，不把新的产品规则重新写散到 manager 中。

6. 在 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs` 中维护并按新回归扩展现有覆盖：

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
6. 普通文件通过 `vscode.open` 后，文本 selection 仍生效，PNG 由 `imagePreview.previewEditor` custom editor 接管；精确 command rejection 会进入 `execution/linkOpenRejected.detail.error`。GIF / MP4 若未分别执行真实 fixture，必须继续把这项边界留在计划与正式设计中。
7. `npm run typecheck`、`npm run test:webview` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 通过。

## 幂等性与恢复

文档修改、parser 重构和测试补充都应是可重复执行的普通增量改动，不涉及破坏性迁移。若中途发现某条原生对齐路线需要大面积替换当前 parser，可先并行保留新旧 detector，在测试中只让新 detector 生效于受控样例；待 native parity 稳定后再删旧路径。若 smoke 因非本轮问题失败，必须在 `意外与发现` 中记录失败点和是否与当前 link 变更相关，不能把“命令跑过但 unrelated failure 存在”误写成已验证。

## 证据与备注

2026-04-30 开始阶段的历史基线是：

    当时仓库：显式 hyperlink + file/url/search provider，缺 multiline detector。
    VSCode upstream：显式 hyperlink + multiline/local/uri/word detector 顺序，search opener 先 exact-open 后 Quick Access。

截至 2026-07-14，当前实现已经变为：

    显式 hyperlink handler + hard-wrap/multiline/file/URL/word provider。
    Multiline、local/styled fallback、word/search exact-open 与 Quick Access fallback 均已有自动化覆盖。

后续在这里继续追加最短必要的测试输出，证明新增 parity 调整没有让 multiline、provider 顺序或误判控制回归。

2026-07-14 媒体 opener 的最短 Host 证据是：PNG link 激活后活动 tab 为 `TabInputCustom`、`viewType=imagePreview.previewEditor`；注入的 `vscode.open` rejection 文本原样出现在 `execution/linkOpenRejected.detail.error`。GIF / MP4 使用相同 opener，但当前没有各自的真实 fixture 证据。

## 接口与依赖

本轮优先复用现有依赖，不默认引入新的 parser 库。需要直接持续使用和对齐的仓库内接口包括：

- `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts`
  - `setupExecutionTerminalNativeInteractions(...)`
  - 各 detector provider 的创建与 hover / activate 入口
- `extensions/vscode/dev-session-canvas/src/common/executionTerminalLinks.ts`
  - `ExecutionTerminalOpenLink`
  - `ExecutionTerminalFileLinkCandidate`
  - 原有 parser / fallback matcher 的替换落点
- `extensions/vscode/dev-session-canvas/src/panel/executionTerminalNativeHelpers.ts`
  - `resolveExecutionFileLink(...)`
  - `resolveExecutionTerminalFileLinkCandidates(...)`
  - `openExecutionTerminalLink(...)`
- `extensions/vscode/dev-session-canvas/src/panel/executionTerminalLineContextTracker.ts`
  - `getCwdForBufferLine(...)`
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`
  - `handleResolveExecutionFileLinks(...)`
  - `handleOpenExecutionLink(...)`

若实现过程中需要从 VSCode upstream 移植或改写逻辑，必须在注释或计划中明确它对应的是哪一类原生 detector / opener，而不是留下无法追溯来源的“魔法正则”或“经验规则”。

本次更新说明：2026-04-30 新建本计划，并把任务目标从“基础 terminal link 可用”升级为“除实现分层外，解析与交互全面向 VSCode 原生 Terminal 对齐”，以响应当前关于“过多链接”和“缺少跨行链接”的最新用户反馈。

本次更新说明：2026-05-19 追加 Codex / Claude TUI 硬换行链接第一阶段实现与验证记录；该能力属于原生 parity 之外的受控适配层，因此同步记录强锚点规则、误判边界和真实 TUI 手动验证缺口。

本次更新说明：2026-05-19 追加 grouped hover underline overlay 决策；该方案避免把 hard-wrap link range 扩成连续跨行范围，同时解决用户手测发现的“可点击但视觉下划线不像同一个链接”的问题。

本次更新说明：2026-07-14 同步媒体文件通用 opener 修复、command-based opened/rejected 诊断边界与 PNG custom editor / command rejection 验证；同时显式保留 GIF / MP4 尚未分别执行真实 Host fixture 的缺口，以修复 PR #266 review 指出的活文档漂移。

本次更新说明：2026-07-14 根据 PR #266 补充 follow-up，把上下文、工作计划、具体步骤和证据中的 2026-04-30 起始描述改为当前实现；缺少 multiline detector 现在只作为历史基线保留，不再呈现为待办。
