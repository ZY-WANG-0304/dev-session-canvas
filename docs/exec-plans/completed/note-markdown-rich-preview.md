# 为 Note Markdown 预览补齐富展示能力

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划原始路径是 `docs/exec-plans/active/note-markdown-rich-preview.md`，完成后已移至 `docs/exec-plans/completed/note-markdown-rich-preview.md`；文档内容仍按 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

这次变更要把 `Note` 的 Markdown 阅读态从“只支持基础标题/列表/引用/代码块的静态预览”升级成更接近真实工作笔记的预览表面。完成后，用户在 `Note` 里写 `- [x]` checklist、普通链接、带语言标记的 fenced code block，以及 `$...$` / `$$...$$` 数学公式时，编辑态仍然保持纯文本输入，但回到阅读态后会分别看到只读任务列表、可点击链接、带语法着色的代码块和 KaTeX 公式渲染结果。

用户可直接观察到的行为包括：`[ ]` / `[x]` 以只读 checkbox 展示；点击 `https://...` 或 `[说明](https://...)` 会通过 VSCode 宿主打开链接，而不是把正文误当成不可点击装饰；代码块在声明语言后会有明显的语法高亮；数学公式会按行内或块级公式展示，而不是继续暴露 `$` 分隔符。

## 进度

- [x] (2026-05-05 22:06 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、既有 `Note` Markdown 设计文档与当前实现，确认本轮属于正式功能扩展而不是临时实验。
- [x] (2026-05-05 22:12 +0800) 梳理当前 `markdown-it` 渲染器、Webview 点击行为、CSP 与测试辅助层，明确现状只支持基础 Markdown 结构，链接仍被 `pointer-events: none` 禁用。
- [x] (2026-05-05 22:18 +0800) 新建本 ExecPlan，并记录本轮四项能力的交互边界、安全约束与验证口径。
- [x] (2026-05-05 22:24 +0800) 更新正式设计文档、设计索引与产品规格，把任务列表、链接打开、代码高亮、数学公式的正式边界写成仓库口径。
- [x] (2026-05-05 22:43 +0800) 在 Webview 与宿主侧接入 task list、代码高亮、KaTeX、链接打开消息链路及白名单校验。
- [x] (2026-05-05 23:08 +0800) 补齐 Webview / 纯函数自动化测试，并运行 `npm run typecheck`、`npm run test:note-markdown-links`、`npm run test:webview`、`npm run test:smoke`。

## 意外与发现

- 观察：当前 `Note` 预览虽然已经使用 `markdown-it`，但正文容器仍把所有 `<a>` 链接禁用，点击任意位置都会进入编辑态。
  证据：`src/webview/styles.css` 中 `.note-markdown-preview-copy a { pointer-events: none; }`，且 `src/webview/main.tsx` 的预览容器 `onClick` 直接调用 `startEditingBody()`。

- 观察：当前 Webview 构建只为 `.ttf` 配置了 esbuild file loader；若直接引入 KaTeX CSS，字体资源还需要补齐 `.woff` / `.woff2` loader。
  证据：`scripts/build.mjs` 的 `webviewConfig.loader` 目前只有 `.ttf: 'file'`。

- 观察：`markdown-it` 自带的 `html: false` 只能阻止原始 HTML 注入，但不足以定义“哪些 URI 允许通过宿主打开”。如果把所有 Markdown 链接都直接交给 `vscode.open`，`command:` 之类的 scheme 会成为新的安全边界。
  证据：当前仓库的执行终端链接打开链路已在 `src/panel/executionTerminalNativeHelpers.ts` 中单独做 scheme 级约束，说明宿主打开 URI 不能只依赖渲染器默认行为。

- 观察：KaTeX 在浏览器 harness 里对更复杂的带命令 block 示例容易把测试回归焦点转移到具体公式写法，而不是“块级公式是否渲染”本身；回归用例应优先选用能稳定验证 block 渲染路径的公式。
  证据：首次 Playwright 断言使用 `\\int` / `\\mathrm` 示例时，block 数学回归曾以原样文本落在 DOM 中，改为更直接的 `x^2 + y^2 = z^2` 后稳定覆盖了 block 渲染主路径。

## 决策记录

- 决策：任务列表只提供阅读态渲染，不在本轮把 checkbox 变成可直接回写 Markdown 源文的交互控件。
  理由：`Note` 的权威数据仍然是原始 Markdown 文本；如果允许直接在预览态勾选，就必须设计“点击 checkbox 如何反向修改源文”的新写路径，这已经超出本轮目标。
  日期/作者：2026-05-05 / Codex

- 决策：`Note` 链接采用“仅安全白名单 scheme 可打开，打开行为优先走 VSCode 宿主”的方案，而不是让浏览器默认导航或允许任意 URI。
  理由：Webview 默认导航不符合仓库现有原生打开语义；同时 `command:`、相对路径或其他未知 scheme 不应因为用户粘贴 Markdown 就隐式获得打开能力。
  日期/作者：2026-05-05 / Codex

- 决策：代码高亮优先使用 `highlight.js` 的常见语言集合，数学公式使用 `markdown-it-katex` + `katex`，并继续保持 `markdown-it` 的 `html: false`。
  理由：这条组合能在不引入富文本编辑器的前提下，补齐用户最直观的阅读态能力；同时它们都可以作为纯渲染层能力存在，不改变 `Note` 的持久化模型。
  日期/作者：2026-05-05 / Codex

## 结果与复盘

本轮已经把 `Note` Markdown 阅读态从“基础排版预览”扩展成更完整的工作笔记预览表面。`src/webview/main.tsx` 现在通过 `markdown-it-task-lists`、`highlight.js`、`markdown-it-katex` 和 `katex` 生成任务列表、语法高亮与数学公式的受控 HTML；`NoteEditableNode` 也不再把所有预览点击都强行切回编辑态，而是对链接点击单独分流到宿主。

为保证链接能力不破坏安全边界，本轮新增了 `src/common/noteMarkdownLinks.ts` 作为纯函数白名单辅助模块，只允许 `http`、`https`、`mailto` 三类 scheme；`src/common/protocol.ts` 与 `src/panel/CanvasPanelManager.ts` 新增 `webview/openNoteLink` 消息链路，最终通过 `vscode.open` 打开安全链接，并在拒绝非法 scheme 时留下诊断事件。

样式和构建层也已同步收口：`scripts/build.mjs` 补齐 `.woff` / `.woff2` loader，`src/webview/styles.css` 为 task list checkbox、highlight token、可点击链接和 KaTeX block 提供了跟随 VSCode 主题的样式。最终验证通过，且没有发现需要立即登记到 `docs/exec-plans/tech-debt-tracker.md` 的新技术债。

## 上下文与定向

本轮直接相关的文件如下：

- `src/webview/main.tsx`：`noteMarkdownRenderer`、`NoteEditableNode`、测试 DOM action 与 probe 读取逻辑都在这里；需要同时处理 Markdown 插件接入、链接点击分流和预览态行为。
- `src/webview/styles.css`：任务列表 checkbox、可点击链接、语法高亮 token 和公式排版都需要在这里补齐主题跟随样式。
- `src/panel/getWebviewHtml.ts`：当前 CSP 已允许 Webview 自身样式与字体；引入 KaTeX 字体后要确认现有策略仍足够。
- `scripts/build.mjs`：若 Webview CSS 需要打包第三方字体资源，本文件必须补齐对应 loader。
- `src/common/protocol.ts`：如果链接打开需要新增 `webview -> host` 消息类型，应在这里同步扩展协议与解析逻辑。
- `src/panel/CanvasPanelManager.ts`：宿主侧负责接收 Webview 链接打开请求，并通过 VSCode 原生 opener 打开外部 URI。
- `tests/playwright/webview-harness.spec.mjs`：至少要新增任务列表、链接点击、代码高亮和数学公式渲染的浏览器 harness 断言。
- `docs/design-docs/note-markdown-preview-rendering.md` 与 `docs/product-specs/canvas-core-collaboration-mvp.md`：需要把新增能力与边界写成正式文档，而不是只留在实现里。

这里的“任务列表”指 Markdown checklist 语法 `- [ ] item` 与 `- [x] item`；“可点击链接”指阅读态预览里允许激活的安全外部链接；“代码高亮”指 fenced code block 的语法着色；“数学公式”指 `$...$` 行内公式和 `$$...$$` 块级公式。

## 工作计划

先更新文档。沿用现有 `docs/design-docs/note-markdown-preview-rendering.md`，把上一轮“链接不可点击、task list / math / highlighting 暂不支持”的边界改成新的正式方案；同时同步设计索引与 MVP 规格，让仓库文档明确哪些 Markdown 能力现在已经正式支持、哪些仍保持非目标。

再更新渲染器与宿主协议。Webview 侧继续以 `markdown-it` 为核心，但补上 task-list、KaTeX 和 code highlighting 插件；阅读态点击逻辑要从“点任何位置都进入编辑”调整成“点普通正文进入编辑，点链接则请求宿主打开”。由于 URI 打开是安全边界的一部分，宿主必须新增一条专用于 `Note` 的链接打开处理路径，并对白名单 scheme 做显式校验。

然后补样式与构建支持。KaTeX 会引入字体文件，build 脚本要能把对应资源打到 `dist/`；`styles.css` 需要为 task list、highlight token 和公式块补齐跟随 VSCode 主题的样式，而不是直接依赖固定站点配色。

最后补测试和验证。Playwright harness 需要至少覆盖四类新增可见行为；如果新增了纯函数链接白名单辅助逻辑，应该加对应脚本测试，防止未来把 `command:` 之类 scheme 打开回归进来。验证时至少跑 `npm run typecheck` 与 `npm run test:webview`；若本轮宿主消息链路影响真实容器主路径，再补真实 smoke。

## 具体步骤

1. 更新 `docs/design-docs/note-markdown-preview-rendering.md`、`docs/design-docs/index.md` 和 `docs/product-specs/canvas-core-collaboration-mvp.md`，写清新增支持项与安全边界。
2. 安装并接入 `markdown-it-task-lists`、`highlight.js`、`markdown-it-katex`、`katex` 等运行时依赖；必要时补 TypeScript 声明。
3. 在 `src/webview/main.tsx` 中扩展 `noteMarkdownRenderer`，增加 task list、代码高亮、数学公式和链接点击分流。
4. 在 `src/common/protocol.ts` 与 `src/panel/CanvasPanelManager.ts` 中增加 `Note` 链接打开消息与宿主处理，并对白名单 scheme 做显式校验。
5. 在 `scripts/build.mjs` 与 `src/webview/styles.css` 中补齐 KaTeX 资源打包与预览样式。
6. 更新 `tests/playwright/webview-harness.spec.mjs`，必要时补纯函数脚本测试。
7. 运行：
   - `npm run typecheck`
   - `npm run test:webview`
   - 如宿主链路需要，再运行 `npm run test:smoke`

## 验证与验收

完成时必须满足以下可观察条件：

- `Note` 阅读态能把 `- [ ]` / `- [x]` 渲染成只读 checkbox，而不是普通列表或原始语法。
- `Note` 阅读态中的 `http` / `https` / `mailto` 链接可以点击，并通过宿主打开；点击链接不会错误地把正文切回编辑态。
- fenced code block 至少在常见语言上能呈现语法高亮，且无语言声明时仍保持可读的代码块样式。
- `$...$` 与 `$$...$$` 公式能分别渲染成行内 / 块级数学公式。
- `metadata.note.content` 仍然只保存原始 Markdown 文本，不新增富文本缓存字段。
- `npm run typecheck` 与 `npm run test:webview` 通过；如本轮消息链路影响真实宿主，再补 `npm run test:smoke` 通过。

## 幂等性与恢复

- 反复在阅读态与编辑态之间切换，不应丢失原始 Markdown 文本，也不应把只读 task list 的勾选状态误当成新的持久化来源。
- 重新构建 Webview 时，KaTeX 字体资源和高亮样式应稳定打包到 `dist/`，不依赖人工复制产物。
- 链接白名单校验应是纯函数或显式宿主逻辑，重复点击同一条不受支持链接时应稳定拒绝，而不是产生部分打开、部分失败的漂移状态。

## 证据与备注

关键验证结果如下：

    npm run typecheck
    -> 通过

    npm run test:note-markdown-links
    -> note markdown link tests passed

    npm run test:webview
    -> 109 passed

    npm run test:smoke
    -> Trusted workspace smoke passed.
    -> Restricted workspace smoke passed.
    -> Fake legacy real window reopen smoke passed.
    -> Fake systemd-user real window reopen smoke passed.
    -> Fake systemd-fallback real window reopen smoke passed.
    -> Remote SSH real window reopen smoke passed.
    -> VS Code smoke test passed.

## 接口与依赖

本轮计划新增或扩展的依赖与接口如下：

- 运行时依赖：
  - `markdown-it-task-lists`：把 checklist 语法渲染成只读 checkbox 结构。
  - `highlight.js`：为 fenced code block 生成语法高亮的 HTML token。
  - `markdown-it-katex` 与 `katex`：为行内 / 块级数学公式生成受控 HTML 与字体样式。

- `src/common/protocol.ts`

    type WebviewToHostMessage =
      | {
          type: 'webview/openNoteLink';
          payload: {
            nodeId: string;
            href: string;
          };
        }
      | ...

  Webview 需要一条显式消息把点击的 Markdown 链接交给宿主；宿主再决定是否允许打开。

- `src/webview/main.tsx`

    const noteMarkdownRenderer = new MarkdownIt({ ... }).use(...)

  这里负责把原始 Markdown 转成安全可控的阅读态 HTML，并在预览点击时区分“打开链接”与“进入编辑”。

- `src/panel/CanvasPanelManager.ts`

    private async openNoteLink(nodeId: string, href: string): Promise<void>

  这里负责 URI 白名单校验和调用 `vscode.open`。

更新说明：

- 2026-05-05 22:18 +0800，新建本计划，记录 Note Markdown 富展示扩展的目标、边界与实现顺序。
- 2026-05-05 23:08 +0800，补齐实现、验证与复盘，确认本轮完成并移入 `completed/`。
