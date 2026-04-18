# 执行节点链接检测与打开能力第三轮收口

本 `ExecPlan` 已完成并归档在 `docs/exec-plans/completed/execution-node-link-parity-and-extensions.md`；其执行过程仍按 `docs/PLANS.md` 的要求保留 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

这轮完成后，用户在 Canvas 内的 `Terminal` 和 `Agent` 节点里，链接体验不再停留在“能点少数 `http/https` 与简单路径”的状态，而是补齐四类能力：

1. 终端输出里的显式超链接（`OSC 8`）可以直接命中并打开。
2. URL 检测不再只认 `http/https`，而是支持更成熟的 URI/URL 解析。
3. 文件路径解析更接近 VSCode 原生 Terminal，包括更可靠的尾字符裁剪、低置信度 fallback 和按输出上下文解析相对路径。
4. 链接检测结构从单文件硬编码收口成可扩展 provider 顺序，后续可以继续挂接新的链接类型而不再重写主流程。
5. 与 VSCode 原生 Terminal 的 `search fallback` 对齐：不存在的 file-like 路径词条可进入顶部 Quick Access 搜索，但普通文本不会被注册成链接。

用户可见验证方式是：在执行节点里输出 `OSC 8` 链接、`mailto:` / `vscode://` / `https://` URL、普通文件路径、带空格或尾随引号的路径，以及 cwd 变化后的相对路径；这些链接都应在 hover 时给出正确提示，在按下修饰键点击后走到正确的 VSCode 打开路径。

## 进度

- [x] (2026-04-18 00:00Z) 新建本轮 active `ExecPlan`，并把设计文档范围扩展到 `OSC 8`、成熟 URL parser、file parity 与 fallback/provider registry。
- [x] (2026-04-18 00:20Z) 实现 `OSC 8` 链接打开与 hover tooltip，并补 Playwright 覆盖。
- [x] (2026-04-18 00:35Z) 引入 `linkify-it`，替换旧 URL 正则，并把 `mailto:`、`vscode://`、显式 URI 全部接到宿主 opener。
- [x] (2026-04-18 00:55Z) 为 file link 增加候选细化、尾字符裁剪、低置信度 fallback、目录目标 hover 文案与显式 `file://` URI 分流。
- [x] (2026-04-18 01:10Z) 为 Host resolver 增加逐行上下文 cwd 跟踪能力，并在缺失时安全回退到节点当前 cwd。
- [x] (2026-04-18 01:25Z) 补齐低置信度 fallback provider 与 basename `path:line:col` 修复，避免 cwd 变化后低置信度相对路径完全 miss。
- [x] (2026-04-18 01:20Z) 完成 `npm run typecheck`、`npm run test:webview` 与 trusted VS Code smoke 回归，并同步设计文档与完成状态。
- [x] (2026-04-18 06:30Z) 补齐 VSCode 原生 `search fallback`：Webview 只为 unresolved file-like candidate 注册 search link，Host 侧先尝试 exact-open，失败后回退 `workbench.action.quickOpen`。

## 意外与发现

- 观察：当前仓库没有 shell integration，也没有现成的“会话内 cwd 变化”事件源。
  证据：`rg -n "OSC 7|shell integration|cwdChanged|command detection" src/panel src/supervisor src/common` 仅命中初始 `cwd` 与通用会话元数据，没有历史 cwd 追踪实现。

- 观察：`xterm` 6.x 已内建 `OSC 8` hyperlink provider，当前仓库只是没有设置 `linkHandler`。
  证据：`node_modules/@xterm/xterm/typings/xterm.d.ts` 暴露 `linkHandler?: ILinkHandler | null`，并说明它服务于 `OSC 8 hyperlinks`。

- 观察：当前 `SerializedTerminalStateTracker` 已经在 Host 侧维护一份 headless xterm 状态，可作为行号一致性的基础设施。
  证据：`src/common/serializedTerminalState.ts` 内部直接用 `@xterm/headless` 持续写入同样的输出流。

## 决策记录

- 决策：URL 检测升级优先采用成熟 parser，而不是继续扩写当前正则。
  理由：当前正则只覆盖 `http/https`，扩写成本高且安全边界分散；成熟 parser 更适合作为 provider 的基础层。
  日期/作者：2026-04-18 / Codex

- 决策：本轮继续沿用“Webview 检测入口，Host 解析与打开”的总分层，不把 VSCode opener 语义移回 Webview。
  理由：`OSC 8`、URL 与 file 都最终依赖 VSCode Extension API 打开；只扩 Webview 侧 detector，不能解决真正的打开分层问题。
  日期/作者：2026-04-18 / Codex

- 决策：逐行 cwd 不单独等待完整 shell integration，而是在 Host 侧补一条与 headless xterm 对齐的行上下文跟踪路径。
  理由：当前仓库已经维护 headless xterm，可在不改 Webview buffer 语义的前提下给 file resolve 提供更细的上下文。
  日期/作者：2026-04-18 / Codex

## 结果与复盘

本轮第三轮收口已完成，用户可见结果如下：

- `Agent` / `Terminal` 节点现在都支持 `OSC 8` 显式超链接、成熟 URI/URL 检测、改进后的 file link 检测与宿主打开。
- URL 检测不再只认 `http/https`，而是由 `linkify-it` 解析 `https://`、`mailto:`、`vscode://` 等 URI；显式 `OSC 8` 链接通过 xterm `linkHandler` 直接复用现有宿主打开链路。
- 文件路径解析现在区分高置信度候选与低置信度 fallback；Host 侧会优先按 buffer 行号对应的 cwd 解析，相对路径缺乏足够结构时再回退到 workspace 唯一命中的 fallback。
- basename 形式的 `link-target.ts:3:1` 在真实 VS Code smoke 中已恢复可点击，并能正确打开到第 3 行第 1 列。
- 无法解析为真实文件的 file-like 路径词条，现在会按原生 `search link` 语义回退到顶部 Quick Access；普通文本不会再被注册成链接。

本轮同时补掉了一处测试通道技术债：真实 smoke 中，`activateExecutionLink` 会因为打开文件后 editor webview 立刻失焦而丢失 DOM 动作回执。当前测试专用链路改为“先回执，再异步触发实际点击”，避免把真实打开成功误判成 DOM 动作超时。

最终自动化证据：

- `npm run typecheck` 通过。
- `npm run test:webview` 通过，覆盖 `OSC 8`、`mailto:`、`vscode://`、basename `path:line:col`、拖拽资源转发等场景。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过，覆盖真实宿主里的文件链接打开、cwd 变化后的 basename 链接、URL opener 与 hover tooltip。
- 同一组验证现已补覆盖原生 `search fallback`：Webview 回归断言不存在路径词条会发出 `search` link、普通文本不会被检测成 link；trusted smoke 断言真实宿主 opener 为 `workbench.action.quickOpen`。

## 上下文与定向

本任务主要涉及四个区域。

第一块是 Webview 里的终端交互层：`src/webview/executionTerminalNativeInteractions.ts`。这里当前直接注册了两个 `xterm` link provider，一个做 file，一个做 URL；拖拽、hover tooltip、修饰键判定也都在这里。

第二块是共享链接模型：`src/common/executionTerminalLinks.ts` 与 `src/common/protocol.ts`。前者定义 file/url link 的类型、路径检测规则和 fallback matcher；后者负责 Webview 与 Host 之间的消息校验。

第三块是 Host 侧打开与解析：`src/panel/executionTerminalNativeHelpers.ts` 与 `src/panel/CanvasPanelManager.ts`。前者把 file/url 真正转换成 VSCode opener；后者负责接 Webview 消息、缓存 resolved file link，并给 Host opener 提供当前节点的 `cwd`、`shellPath` 和 `pathStyle`。

第四块是验证层：`tests/playwright/webview-harness.spec.mjs`、`tests/playwright/harness/webview-harness.html` 和 `tests/vscode-smoke/extension-tests.cjs`。前者覆盖 Webview 内 link detection 与 tooltip；后者覆盖真实 VSCode Host 的 opener 行为。

本轮新增的“provider registry”指的是：把当前硬编码的 file/url 检测顺序改成一组显式注册、按优先级运行的检测器。其目的不是为了抽象而抽象，而是为了让 `OSC 8`、成熟 URL parser、file detector 与 fallback detector 可以共存，且不会互相覆盖。

## 工作计划

先扩文档与共享模型，再改 Webview provider 层，最后补 Host resolver 和验证。

首先在 `src/common/executionTerminalLinks.ts` 补充 provider 需要的类型字段。文件候选需要带上来自 xterm buffer 的行号上下文与检测来源，便于 Host 用不同行为解析高置信度和低置信度候选。若低置信度 fallback 需要单独打开语义，则同步扩 `ExecutionTerminalOpenLink`。

接着改 `src/webview/executionTerminalNativeInteractions.ts`。这里需要把现有 file/url provider 重构成一个顺序注册的 registry：

1. `OSC 8` explicit hyperlink handler。直接利用 `xterm` 的 `linkHandler`，让显式超链接优先于隐式检测命中。
2. 成熟 URL provider。这里不再用当前正则，而改用成熟 parser 生成 URI/URL 范围，再把结果映射成 Webview -> Host 打开消息。
3. 高置信度 file provider。保留现有路径检测主干，但补尾字符细化和 styled segment refine。
4. 低置信度 fallback provider。只在前几类 provider 没命中时尝试，避免误报淹没主路径。

然后改 `src/panel/executionTerminalNativeHelpers.ts` 与 `src/panel/CanvasPanelManager.ts`。这里要把 Host resolver 扩成三层：

1. 直接 URI opener：显式 URL、`mailto:`、`vscode://` 等统一走 `vscode.open`。
2. 直接 file resolver：按行级 cwd 或节点 cwd 解析相对路径，再 `stat`。
3. 低置信度 fallback resolver：只对未命中的文件词条做 workspace suffix / basename 搜索，并在唯一命中时转成可打开文件。

逐行 cwd 通过 Host 侧行上下文跟踪器提供。该跟踪器要与当前会话写入 PTY 的输出流同步，并且使用与 Webview 相同的 cols/rows 来维护 buffer 行号一致性。设计上优先复用 `@xterm/headless`，避免自己手写换行和 wrap 逻辑。

最后补测试与文档：Playwright 要覆盖 URL scheme 扩展、`OSC 8`、fallback 与 hover 文案；smoke 要覆盖真实 Host opener 路径；设计文档要把“当前 non-goal 不做逐行 cwd”改成新的正式结论，并在完成后把未做完的项记入技术债。

## 具体步骤

在仓库根目录执行并持续更新结果：

    npm run typecheck
    npm run test:webview
    npm run test:smoke

如果新增直接依赖，执行：

    npm install <package-name>

本轮预计需要新增一条依赖用于 URL 解析；若安装失败，需要在计划中记录失败原因与替代方案。

## 验证与验收

验收时至少需要证明以下行为：

1. 输出显式 `OSC 8` hyperlink 后，hover 显示 tooltip，修饰键点击能走到正确 Host opener。
2. `https://`、`mailto:`、`vscode://` 与 `file://` 这四类 URI 中，除 `file://` 可按 file opener 特化外，其余都能通过 Host 路径打开。
3. 输出 `src/foo.ts:12:3`、`"src/foo.ts".`、`(src/foo.ts:12)`、带空格路径等文本时，file link 命中率高于当前版本。
4. cwd 变化后再输出相对路径，Host resolve 优先按对应输出上下文解析，而不是统一按节点当前初始化 cwd。
5. 当直接 file 检测 miss 时，低置信度 fallback 至少能把唯一 workspace 命中的文件恢复成可点击链接。

## 幂等性与恢复

除 `npm install` 外，本轮改动都应是可重复执行的。若 `npm install` 更新了 `package-lock.json`，后续重跑测试只需保持工作区在同一锁文件版本即可。若新 detector 导致误报回升，优先通过关闭对应 provider 或降低其优先级恢复，而不要回滚整套链接链路。

## 证据与备注

待实现完成后补充最关键的测试输出与人工验证记录。

## 接口与依赖

本轮允许新增一个成熟 URL parser 依赖，优先选择：

    linkify-it

在 `src/webview/executionTerminalNativeInteractions.ts` 中，最终应形成显式可读的 provider 顺序，而不是继续通过散落函数隐式耦合。

在 `src/panel/executionTerminalNativeHelpers.ts` 中，最终 Host opener 需要继续保持单入口：

    openExecutionTerminalLink(link, context, readResolvedFileLink?)

但其内部要扩展到能处理显式 URI、文件路径与低置信度 fallback。

在 `src/common/executionTerminalLinks.ts` 中，文件候选与结果类型需要明确表达“检测来源”和“缓冲区上下文”，以支撑 Host resolver 的不同策略。

## 计划维护记录

- 2026-04-18：新建本计划，用于承接第三轮链接体验收口；范围从原先的 file/http 基础能力扩展到 `OSC 8`、成熟 URL parser、逐行 cwd 与 fallback/provider registry。
