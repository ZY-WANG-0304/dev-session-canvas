# Note 预览双击源码定位重写

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。如果后续协作者接手，应先确认当前文件仍与 `docs/PLANS.md` 的要求一致，再继续实现或修订。

## 目标与全局图景

本次变更要让用户在 `Note` 阅读态的 Markdown 预览中双击普通文本时，进入纯文本编辑态后 textarea 光标落在被双击的 Markdown 源码位置，而不是默认落在文档顶部或文档末尾。若双击命中图片、空白、公式或其他无法稳定映射到单个源码字符的复杂块，光标应回退到该块对应 Markdown 源码范围的末尾，而不是整篇文档末尾。

上一版方案试图从已渲染 DOM 文本反推出 Markdown 源码偏移，并不断用启发式跳过列表标记、强调分隔符、HTML entity、代码块缩进等语法字符。review 已证明这条路线会在 list continuation、nested blockquote、triple emphasis、代码块原始字符和 entity 上持续产生边界问题。本计划放弃旧分支实现，从 `origin/main` 新建分支，用 parser 提供的位置信息作为权威 source map，再把可定位文本包成带 `data-note-markdown-source-offsets` 的 span。用户可通过 Playwright 回归亲眼验证：双击 `***bold***` 中的 `bold`、列表续行中间字符、代码块第二行和 `A &amp; B` 后续文本时，textarea selection 均落到预期源码 offset。

## 进度

- [x] (2026-05-21 22:15 CST) 从旧 PR 分支切出前确认工作区干净，并从 `origin/main` 创建 `note-preview-dblclick-source-map-v2`。
- [x] (2026-05-21 22:15 CST) 复核 PR #88 最新 review，确认旧方案的 blocker 集中在 DOM 文本反推 Markdown 源码偏移的启发式失效。
- [x] (2026-05-21 22:15 CST) 调研 `markdown-it`、`mdast-util-from-markdown`、`mdast-util-gfm`、`mdast-util-math` 与 `micromark-extension-*`，确认更成熟路线是使用带 position.offset 的 Markdown AST 作为 source map。
- [x] (2026-05-21 22:15 CST) 新增 parser 依赖并起草本 ExecPlan，记录放弃旧方案与重写边界。
- [x] (2026-05-21 23:35 CST) 新增 `src/common/noteMarkdownSourceMap.ts`，用 mdast/micromark 位置信息生成文本 offset map 与块级 fallback range，并保持 `markdown-it` 继续作为实际 HTML 渲染器。
- [x] (2026-05-21 23:45 CST) 在 `src/webview/main.tsx` 渲染后注入 `data-note-markdown-source-*` 元数据，并把双击处理改成“文本 offset 优先、最近块末尾 fallback、最后才退到当前 Note 文末”。
- [x] (2026-05-22 00:05 CST) 补齐 Playwright 与纯函数回归，覆盖普通文本、图片/空白/公式 fallback、fenced code、indented code、literal `_` / `*`、HTML entity、task item、list continuation、nested blockquote list continuation、triple emphasis。
- [x] (2026-05-22 00:20 CST) 修复两处回归：图片双击不再被旧测试期望拦截；测试协议允许新增的双击 DOM action 并校验 offset 为安全整数。
- [x] (2026-05-22 00:40 CST) 更新 `docs/design-docs/note-markdown-preview-rendering.md` 与 `docs/design-docs/index.md`，记录 parser-position source map、fallback 规则、依赖与验证状态。
- [x] (2026-05-22 00:30 CST) 完成核心验证：`npm run typecheck`、`npm run build`、协议/Note Markdown 相关脚本测试、15 条双击定位 Playwright 回归、8 条现有预览渲染回归均通过。
- [x] (2026-05-22 00:45 CST) 将 ExecPlan 移动到 `docs/exec-plans/completed/`；无新增需登记到 `docs/exec-plans/tech-debt-tracker.md` 的阻塞技术债。
- [ ] 提交、推送并创建新的 PR，说明旧 PR #88 被新分支替代。

## 意外与发现

- 观察：`markdown-it` 的 `Token#map` 只有 `[line_begin, line_end]` 行级信息，不能提供 inline 文本字符级位置。
  证据：官方 API 文档把 `Token#map` 定义为 source map info，格式为 `[ line_begin, line_end ]`。

- 观察：`mdast-util-from-markdown` 生成的 mdast 节点默认带 `position.start.offset` / `position.end.offset`，并且 triple emphasis 会把 `***bold***` 中的 text 节点定位到第三个 delimiter 后；list continuation 与 nested blockquote continuation 的 text 节点 position 也会落在可见文本源码起点。
  证据：本地 `node --input-type=module` probe 显示 `***bold*** after` 的 `text.value = 'bold'` 起点为 offset 9；`> > - first line\n> >   second line` 的 paragraph text 跨行 position 覆盖真实源码行列。

- 观察：`mdast-util-from-markdown` 会把 `A &amp; B after` 的 text value 解码为 `A & B after`，但 position 仍覆盖源码切片 `A &amp; B after`。因此点击 `B after` 的源码 offset 不能简单用 `text.position.start.offset + renderedOffset`，需要基于源码切片与 rendered value 做一次字符级对齐。
  证据：本地 probe 显示 text value 为 `A & B after`，position end offset 为 15，覆盖源码中的 `&amp;` 五个字符。

- 观察：indented code 的 mdast code 节点 position 覆盖含四个缩进空格的源码行，而 `node.value` 已剥掉 CommonMark 代码缩进。因此 code block 的 text offset map 需要从源码切片中逐行跳过最多四个缩进字符后再映射 visible code 字符。
  证据：本地 probe 显示 `    - item` 的 code node value 是 `- item`，position.start.offset 仍为 0。

- 观察：浏览器的 `caretPositionFromPoint` 在图片中心附近可能返回图片后一个段落的文本 caret；如果无条件信任 caret，就会把图片 fallback 错误算到后续正文开头。
  证据：Playwright `double-clicking note preview image falls back to the image markdown source end` 初次失败，期望 offset 48，实际 offset 50；修复后先判断 caret 所在 source span 的 client rect 是否覆盖双击点，再决定是否使用文本 offset。

- 观察：无语言 fenced code 与 indented code 在 mdast 中都表现为 `code.lang === null`，不能只用 `node.lang` 区分二者。
  证据：本地 probe 显示 `fenced code` 与 `    abc` 都是 `type: 'code', lang: null`；因此实现改成检查源码切片首行是否为 0-3 个空格后的三连反引号或波浪线。

- 观察：旧的图片预览测试曾断言双击图片不进入编辑态，这与本次用户明确要求“图片命中 fallback 到该图片 Markdown 源码末尾”冲突。
  证据：现有 `note markdown preview renders safe images and rewrites local image paths` 失败于 textarea count 仍期望 0；该断言已删除，图片双击行为由新增的 `double-clicking note preview image falls back to the image markdown source end` 覆盖。


## 决策记录

- 决策：放弃旧 PR 分支上的启发式 DOM 文本反推方案，不再继续修补 `mapRenderedLineOffsetToSourceLineOffset()` 这类按字符猜测 Markdown 语法的 mapper。
  理由：review 已经覆盖 list continuation mid-offset、nested blockquote list、triple emphasis、code raw 字符、literal punctuation、entity、task DOM-only 空格等多类确定性失败；继续追加例外会扩大复杂度且无法证明收敛。
  日期/作者：2026-05-21 / Codex

- 决策：保留 `markdown-it` 作为预览 HTML 的主渲染器，但新增 `mdast-util-from-markdown` + `micromark-extension-gfm` + `mdast-util-gfm` + `micromark-extension-math` + `mdast-util-math` 只用于生成源码位置索引。
  理由：仓库现有预览已经围绕 `markdown-it`、`markdown-it-task-lists`、`highlight.js`、自有 KaTeX 和安全链接/图片 renderer 建立，不应一次性替换渲染栈；同时 `markdown-it` 的行级 `Token#map` 不足以支持字符级 caret，而 mdast/micromark 生态提供成熟的 position.offset。
  日期/作者：2026-05-21 / Codex

- 决策：在渲染后的 HTML 上注入数据属性，而不是在双击时现场解析 DOM 文本并猜测源码。
  理由：source map 应在渲染阶段由 parser 位置信息生成，双击阶段只读取最近 text span 的 offset map；复杂块使用块级 source range fallback。这样能把“不稳定映射”显式降级为块末尾，而不是误算到文档末尾或语法前缀。
  日期/作者：2026-05-21 / Codex


- 决策：把 source map 生成逻辑抽到 `src/common/noteMarkdownSourceMap.ts`，而不是继续留在 Webview 大文件中。
  理由：源码 offset 计算本身不依赖 DOM，抽成 common 模块后可以用 `scripts/test/test-note-markdown-source-map.mts` 做快速纯函数回归，覆盖 review 指出的 list continuation、triple emphasis、entity、代码块缩进等核心风险。
  日期/作者：2026-05-22 / Codex

- 决策：图片双击不再被 `handlePreviewDoubleClick()` 过滤，改由 block fallback 返回图片 Markdown 源码末尾。
  理由：用户明确要求图片、空白或复杂块应落在它们对应 Markdown 源码内容末尾，而不是整篇文档文末；继续把图片当交互元素拦截会无法满足该规则。
  日期/作者：2026-05-22 / Codex

## 结果与复盘

当前已经完成重写实现与核心验证。用户可观察行为变为：在 Note Markdown 预览中双击普通文本后，textarea 光标落在被双击可见字符对应的原始 Markdown UTF-16 offset；双击图片、空白、display math 或 malformed math 这类无法稳定映射到单个字符的位置时，光标落在最近 Markdown 块源码范围末尾；只有找不到局部块时才回退到当前 Note 正文末尾。

本轮没有继续修补旧 PR #88 的启发式 mapper，而是把旧方案整体替换成 parser-position source map。`src/common/noteMarkdownSourceMap.ts` 使用 `mdast-util-from-markdown` 加 GFM/math 扩展生成带 `position.start.offset` / `position.end.offset` 的 mdast，再为稳定文本生成 `sourceOffsets` 数组；`src/webview/main.tsx` 继续用既有 `markdown-it` 渲染 HTML，并在渲染后按可见文本顺序注入 dataset。残余风险是 source segment 与渲染 DOM 仍需要按“mdast 文本顺序等于 markdown-it 可见文本顺序”对齐；当前已用普通文本、列表续行、blockquote list、任务列表、强调、entity、代码块和现有预览能力回归覆盖，未发现需要登记到技术债跟踪器的阻塞项。

已经通过的验证命令包括：`npm run typecheck`、`npm run build`、`npm run test:protocol-webview-messages`、`npm run test:note-markdown-checklists`、`npm run test:note-markdown-front-matter`、`npm run test:note-markdown-links`、`npm run test:note-markdown-source-map`、15 条双击定位 Playwright grep，以及 8 条既有 Markdown 预览渲染/交互 Playwright grep。设计文档已经同步，计划文件已移动到 completed；提交与 PR 创建仍待最后收口。

## 上下文与定向

仓库根目录是 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas5`。当前任务发生在 `Note` 节点的 Markdown 预览与纯文本编辑切换路径中。

关键文件如下：

`src/webview/main.tsx` 是 Webview 的主要 React 入口。`NoteEditableNode` 负责 `Note` 节点正文的阅读态/编辑态切换；`handlePreviewDoubleClick()` 当前只调用 `startEditingBody()`，不会设置 selection。`createNoteMarkdownRenderer()` 与 `renderNoteMarkdownPreview()` 负责把原始 Markdown 转为预览 HTML，并处理 task list、链接、图片、KaTeX 与代码高亮。

`src/webview/noteMarkdownFrontMatter.ts` 会在渲染前隐藏合法 YAML front matter，并通过 `lineOffset` 记录正文相对原始 content 的行偏移。新的 source map 必须使用原始 `content` 的绝对 offset；如果只解析隐藏 front matter 后的 body，则需要把 body 的起始 offset 加回所有映射。

`tests/playwright/webview-harness.spec.mjs` 是主要 UI 回归。已有 Note 预览、task list、链接、图片、数学公式和编辑态测试。本轮需要新增用于“在预览中双击某段可见文本并读取 textarea selectionStart”的辅助函数与测试用例。

“source map” 在本计划中指从预览可见字符位置到原始 Markdown 字符 offset 的映射。“复杂块 fallback” 指当命中图片、display math、代码块空白、预览空白等不能稳定落到单个字符的位置时，返回该 Markdown 块源码范围的 end offset，而不是整篇文档的 end offset。

## 工作计划

第一步在 `src/webview/main.tsx` 中扩展 `NoteMarkdownPreviewResult`，让 `renderNoteMarkdownPreview()` 除了返回 HTML 和 front matter，也返回或直接注入源码定位 metadata。新增内部 helper：解析原始 content 的可见 body，生成若干 source segment，每个 segment 包含 rendered text、source offsets 数组、source range 和 fallback range。对 inline text、inlineCode、link text、heading text、list paragraph text 等稳定文本，source offsets 数组长度应等于 rendered text 的 UTF-16 code unit 数量加一，数组第 N 项表示 rendered offset N 对应的源码 offset。对 code block，需要按 raw code 字符生成映射；fenced code 的 visible code 起点是 opening fence 下一行，indented code 的 visible code 起点是每行最多四个源码缩进之后。对 image、display math、HTML fallback 等复杂节点，只记录 block range，不生成 text map。

第二步继续用现有 `markdown-it` 渲染 HTML，然后用浏览器 `DOMParser` 或 `template` 在 Webview 内把 HTML 解析成临时 DOM，根据可见文本顺序把 source segment 包裹为 `<span data-note-markdown-source-offsets="...">...</span>`，并给 block DOM 注入 `data-note-markdown-source-start` / `data-note-markdown-source-end`。注入时必须保留现有安全 renderer 产物，不能让原始 Markdown HTML 透传。因为 `markdown-it` 已设置 `html: false`，注入逻辑只处理当前 renderer 生成的 HTML 字符串。

第三步修改 `handlePreviewDoubleClick()`：如果命中 checkbox、link、image 等交互元素，仍沿用现有行为不进入编辑或由对应点击逻辑处理；否则阻止默认事件并调用新的 `findNotePreviewSourceOffset(event, content, markdownPreview)`。该函数优先使用 `document.caretRangeFromPoint` / `document.caretPositionFromPoint` 找到双击点的 text node 与 node offset，再向上找 source span 读取 offset map。若没有稳定 text span，则找最近带 block range 的元素，返回 block end。最后把 selection 写入 `pendingBodySelectionRef.current`，再调用 `startEditingBody()`。`startEditingBody()` 现有逻辑会把 pending focus 放到文末；需要调整为如果已有 pending selection，就不要再覆盖到文末。

第四步补测试。新增 helper 用真实坐标双击指定 selector/text/offset，再读取 textarea selection。测试必须覆盖 review 提到的失败场景和用户明确的 fallback 规则：无序/有序/nested blockquote list continuation 的起点和中间 offset；`***bold***` 与 `___bold___`；fenced code 第二行、Markdown-like code raw chars；indented code；literal `_`、literal `*`、HTML entity；task item 文本；图片、空白、valid/malformed display math fallback。

第五步更新 `docs/design-docs/note-markdown-preview-rendering.md`，在正式方案中新增“双击预览源码定位”小节，记录 parser-position source map、fallback 规则、依赖和测试证据；同步更新 `docs/design-docs/index.md` 的日期与 related plans。

## 具体步骤

工作目录统一为 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas5`。

已执行的准备命令：

    git fetch origin main
    git switch -c note-preview-dblclick-source-map-v2 origin/main
    npm view markdown-it-source-map version description repository --json
    npm view mdast-util-from-markdown version description repository --json
    npm view mdast-util-gfm version description repository --json
    npm view micromark-extension-gfm version description repository --json
    npm view mdast-util-math version description repository --json
    npm view micromark-extension-math version description repository --json
    npm install mdast-util-from-markdown mdast-util-gfm micromark-extension-gfm mdast-util-math micromark-extension-math

预期后续实现命令：

    rg -n "handlePreviewDoubleClick|renderNoteMarkdownPreview|createNoteMarkdownRenderer" src/webview/main.tsx
    npm run typecheck
    npm run build
    npm run test:protocol-webview-messages
    npm run test:note-markdown-checklists
    npm run test:note-markdown-front-matter
    npm run test:note-markdown-links
    npm run test:note-markdown-source-map
    npx playwright test tests/playwright/webview-harness.spec.mjs --grep "double-clicking note preview|note body requires double click|note markdown preview renders task lists|safe images|YAML metadata|malformed html|markdown link|checklist"

创建 PR 前必须按 `docs/WORKFLOW.md` 再次拉取目标分支并 rebase：

    git fetch origin main
    git rebase origin/main
    git push -u origin note-preview-dblclick-source-map-v2
    gh pr create --base main --head note-preview-dblclick-source-map-v2 --title "fix(note): 重写预览双击源码定位" --body-file <临时说明文件>

## 验证与验收

验收以用户可观察行为为准。打开 Playwright harness 中的 Note 节点，正文显示 Markdown 预览。双击普通段落、标题、列表续行、强调文本、代码块可见代码字符时，进入编辑态后 textarea 的 `selectionStart` 应等于对应 Markdown 源码字符 offset。双击图片、空白区域、display math 或 malformed math 时，textarea 的 `selectionStart` 应等于对应 Markdown 源码块的 end offset；只有完全找不到局部块时，才允许退到整篇 content 的末尾。

自动化至少需要通过：

    npm run typecheck
    npm run build
    npm run test:protocol-webview-messages
    npm run test:note-markdown-checklists
    npm run test:note-markdown-front-matter
    npm run test:note-markdown-links
    npm run test:note-markdown-source-map
    npx playwright test tests/playwright/webview-harness.spec.mjs --grep "double-clicking note preview|note body requires double click"

新增 Playwright 回归应在旧方案或 `origin/main` 上失败，在本轮实现后通过。尤其要包含：`***bold***` / `___bold___` 起点与 offset 2；无序、有序、nested blockquote list continuation 的起点与 offset 5；`A &amp; B after` 的后续文本；fenced code 第二行和 Markdown-like code；indented code；task item 文本；image、blank、valid/malformed display math fallback。

## 幂等性与恢复

当前旧 PR 分支未被删除，新的工作只发生在 `note-preview-dblclick-source-map-v2`。如果实现中途失败，可以保持当前分支改动，使用 `git status --short` 查看未提交文件，按文件逐一修复；不要使用 `git reset --hard` 或 `git checkout --` 这类破坏性命令。`npm install` 已更新 `package.json` 与 `package-lock.json`，这是本计划的一部分；如果最终决定不用 mdast/micromark 路线，需要用正常编辑方式移除依赖并重新 `npm install`，而不是回滚整个工作树。

注入 HTML 的逻辑应是纯函数式、可重复执行的：同一 content 和同一 image workspace roots 应产生同一 HTML。双击处理只读取 DOM dataset 并设置本地 selection，不写回宿主状态；因此重复双击不会改变 Note 内容。

## 证据与备注

调研摘录：

    markdown-it Token#map: Source map info. Format: [ line_begin, line_end ]
    mdast-util-from-markdown: Turn markdown into a syntax tree; extensions can add GFM and math.
    mdast-util-gfm: adds GFM syntax including tasklists to mdast-util-from-markdown.

本地 probe 关键结果：

    输入: # em\n\n***bold*** after\n
    mdast text node: value 'bold', position.start.offset 9, position.end.offset 13

    输入: # list\n\n> > - first line\n> >   second line\n
    mdast paragraph text: value 'first line\nsecond line', start offset 14, end offset 42

    输入: A &amp; B after\n
    mdast text value: 'A & B after', source range offset 0..15

这些结果证明 parser-position source map 可以覆盖 review 指出的 triple delimiter、nested quote/list continuation 和 entity 场景；entity 仍需在实现中做 source slice 到 rendered value 的对齐。

本次计划创建说明：2026-05-21 起草，原因是用户要求放弃旧方案、从 `origin/main` 新建分支并调研更成熟标准方案后重写。

## 接口与依赖

新增依赖必须保留在根 `package.json` dependencies 中，因为 Webview bundle 运行时需要它们：

    mdast-util-from-markdown
    micromark-extension-gfm
    mdast-util-gfm
    micromark-extension-math
    mdast-util-math
    decode-named-character-reference

在 `src/webview/main.tsx` 中需要新增或调整以下内部类型，名称可在实现中微调，但职责必须存在：

    interface NoteMarkdownPreviewResult {
      html: string;
      frontMatter: NoteMarkdownFrontMatter;
    }

    interface NoteMarkdownSourceTextSegment {
      text: string;
      sourceOffsets: number[];
      sourceStart: number;
      sourceEnd: number;
    }

    interface NoteMarkdownSourceBlockRange {
      sourceStart: number;
      sourceEnd: number;
    }

    function renderNoteMarkdownPreview(content: string, options: NoteMarkdownPreviewRenderOptions): NoteMarkdownPreviewResult

    function findNotePreviewSourceOffset(event: React.MouseEvent<HTMLElement>, fallbackContent: string): number

`sourceOffsets` 数组使用原始 `content` 的 UTF-16 offset，不能使用 body 内相对 offset。数组长度必须是 rendered text length + 1，以便点击文本末尾也能稳定定位。所有写入 dataset 的 JSON 必须先 HTML escape 或通过 DOM API 设置属性，避免把数据拼接成不可信 HTML。
