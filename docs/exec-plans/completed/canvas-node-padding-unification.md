# 统一画布节点 Padding 视觉风格

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本计划遵循 `docs/PLANS.md` 的要求；即使后续由不了解本轮上下文的协作者继续，也应能只凭本文件和当前工作树完成任务。

## 目标与全局图景

这次变更要把画布上不同节点和分组的正文留白从“各自历史实现”收口为一套明确的视觉规则。用户完成后应该能看到：`Agent` 和 `Terminal` 的终端内容拥有一致的外层呼吸感；`Note` 的 Markdown 阅读态和编辑态拥有一致的文档页边距；`File`、`File List` 和 fallback card 使用同一套紧凑节点密度；分组内部成员到 body 四边的视觉预留与节点正文节奏相容，而不是显得像另一个系统。

本轮不改变节点类型、执行会话、Note 内容持久化、文件活动语义或分组成员关系。它只修改视觉间距和与间距直接相关的几何 inset，并把这些设计结论写入正式文档，避免后续新增节点继续按旧实现随意设置 padding。

## 进度

- [x] (2026-05-30 16:14Z) 已从 `origin/main` 创建主题分支 `canvas-padding-unification`，并确认工作树只有既有未跟踪文件，没有改动已跟踪文件。
- [x] (2026-05-30 16:14Z) 已梳理当前 padding 事实：`session-body` / `object-body` 默认 `12px`，Terminal 覆盖为外层 `0` 加 frame `6px`，Note 覆盖为 body `0` 加文档 `16px 18px`，File card 为 `14px 16px`，File List body 为 `10px`，Group member inset 为 `28px` 加标题高度。
- [x] (2026-05-30 16:30Z) 已制定统一 padding token 与分类规则，并落地到 `src/webview/styles.css` 和 `src/panel/CanvasPanelManager.ts`。
- [x] (2026-05-30 16:34Z) 已同步 `docs/UI.md`、`docs/design-docs/canvas-node-groups.md` 和设计索引中的分组更新时间。
- [x] (2026-05-30 16:47Z) 已运行 `npm run typecheck`、`npm run test:canvas-node-groups`、`npm run build`、新增 padding Playwright 定向用例、分组 Playwright 定向用例、Note / minimal file Playwright 定向用例和 `git diff --check`。
- [x] (2026-05-30 16:50Z) 已根据验证结果更新本计划；本轮没有新增需要登记到技术债追踪的残余问题。

## 意外与发现

- 观察：当前 `Terminal` 比 `Agent` 少一圈外层正文留白；`Agent` 是 `.session-body padding: 12px` 加 `.terminal-frame padding: 6px`，`Terminal` 是 `.terminal-session-body padding: 0` 加 `.terminal-frame padding: 6px`。
  证据：`src/webview/styles.css` 中 `.session-body`、`.terminal-session-body` 和 `.terminal-frame` 的现有规则。

- 观察：`Note` 并非使用普通节点正文 padding，而是通过 `.note-surface padding: 0` 把内部文档面铺满，再由编辑态和预览态各自设置 `16px 18px` 左右的文档页边距。
  证据：`src/webview/styles.css` 中 `.note-surface`、`.note-document-input` 和 `.note-markdown-preview` 的现有规则。

- 观察：分组成员预留当前为 `28px`，这是普通节点正文 `12px` 的两倍以上，导致分组看起来像另一套密度系统；其中 top inset 是 `28px + 28px title height`，用于扣掉标题 tab 后保持 body 上边界视觉预留一致。
  证据：`src/panel/CanvasPanelManager.ts` 中 `CANVAS_GROUP_PADDING = 28`、`CANVAS_GROUP_TITLE_HEIGHT = 28`、`CANVAS_GROUP_MEMBER_INSETS.top = CANVAS_GROUP_PADDING + CANVAS_GROUP_TITLE_HEIGHT`。


- 观察：把 `Terminal` 外层正文 padding 从 `0` 改为默认 `12px` 后，如果 `.terminal-frame` 仍只在底部保留节点圆角，会在标题栏下方形成没有圆角的内层色块。
  证据：`src/webview/styles.css` 中 `.terminal-frame` 已从 `border-radius: 0 0 var(--canvas-node-radius) var(--canvas-node-radius)` 改为 `var(--canvas-node-radius-inner)`，让外层 `12px` 留白内的运行时 frame 成为完整内嵌面。

- 观察：Note 编辑态左侧 padding `62px` 不只是文档横向 padding，而是 `46px` 行号 gutter 加文本起始补偿；强行用 `46px + 18px` 会造成编辑态文本相对原位置右移。
  证据：本轮把行号 gutter 宽度和文档页边距抽成变量，但保留 `--canvas-note-document-input-padding-left: 62px`，确保编辑态行号与文本起始位置不发生非目标变化。

- 观察：分组成员 padding 从 `28px` 收紧到 `24px` 后，`resizeGroup` 中一个 pinned group 的自动扩容期望从 `{ y: -6, height: 186 }` 变成 `{ y: -2, height: 182 }`。
  证据：首次运行 `npm run test:canvas-node-groups` 在 `scripts/test/test-canvas-node-groups.mjs:575` 失败，实际值为 `{ x: 0, y: -2 }`；更新期望后同一测试通过。这是设计常量变化带来的预期几何结果，而不是行为回归。

## 决策记录

- 决策：本轮把 padding 分成四类，而不是强行所有地方同一个数值：节点正文外壳、运行时 frame、文档正文、空间分组成员 inset。
  理由：执行终端、Markdown 文档和分组 frame 的可读性约束不同；统一应体现在 token 和节奏上，而不是让 xterm、文档和文件列表都使用同一个 CSS 值。
  日期/作者：2026-05-30 / Codex

- 决策：默认节点正文外壳以 `12px` 为基准；运行时 frame 使用 `8px`；文档正文使用 `16px 18px`；分组成员到 body 边界的视觉预留收口为 `24px`，top 继续额外加标题高度。
  理由：`12px` 已经是 `docs/UI.md` 定义的节点正文节奏；运行时 frame 需要比普通正文更贴近终端但不贴边，`8px` 对齐 spacing scale；Markdown 文档保留略大的阅读页边距；分组不是节点内部正文，保留大于普通节点的空间组织感，但从 `28px` 收紧到 `24px`，与 design-system 的 section spacing 对齐。
  日期/作者：2026-05-30 / Codex

- 决策：本轮同步收紧 `File` 卡片态、`File List` 卡片态和 fallback compact card 到默认 `12px`，但不调整 minimal 文件节点、文件列表行、按钮、状态胶囊和浮层等局部控件 padding。
  理由：这些 minimal / row / control padding 表达的是控件热区或列表密度，不是节点 body 区域；统一它们会破坏已有极简文件活动 footprint。
  日期/作者：2026-05-30 / Codex

## 结果与复盘

本轮已完成实现、文档同步和针对性验证。已统一的部分包括：`Agent` / `Terminal` 外层正文 padding、运行时 frame padding、卡片态 `File` / `File List` / fallback padding，以及分组成员预留。保留差异的部分包括：Note 文档页边距、Note 行号 gutter、minimal 文件活动和列表行级 padding。验证覆盖了 TypeScript、构建、分组几何状态测试、新增 padding Webview 定向用例、分组 Webview 样式/交互定向用例、Note 编辑面定向用例和 minimal file 定向用例；没有新增技术债。

## 上下文与定向

画布 Webview 的主要样式在 `src/webview/styles.css`。当前节点外壳是 `.canvas-node`，执行型节点的正文容器是 `.session-body`，Terminal 额外使用 `.terminal-session-body` 覆盖外层 padding；终端实际承载 xterm 的 frame 是 `.terminal-frame`。Note 使用 `.object-body object-surface note-surface`，再进入 `.note-editor-surface`、`.note-document-input` 或 `.note-markdown-preview`。File 节点没有独立标题栏，它的 button `.file-node-action-card` 或 `.file-node-action-minimal` 就是内容区。File List 使用 `.file-list-body` 包住条目列表。Fallback 节点使用 `.compact-node`。

分组不是 React Flow 节点，而是独立的 group frame。视觉层在 `src/webview/styles.css` 的 `.canvas-group-*` 规则；宿主权威几何在 `src/panel/CanvasPanelManager.ts`，其中 `CANVAS_GROUP_MEMBER_INSETS` 控制“成员对象必须离 group body 边界多远”。因为标题 tab 占据 group 顶部，top inset 必须等于视觉 body padding 加标题高度，不能简单改成与 left/right/bottom 一样，否则成员会贴近 body 顶部。

正式 UI 规则在 `docs/UI.md`。如果改变跨功能 padding 规则，必须更新这里。分组具体设计在 `docs/design-docs/canvas-node-groups.md`，如果改变 group member inset 或视觉预留，也必须同步。`docs/design-docs/index.md` 只在新增设计文档或改变该文档 frontmatter 状态 / 日期时需要更新；本轮预计只更新已有文档的 `updated_at` 和对应索引日期。

## 工作计划

第一步先在 `src/webview/styles.css` 增加语义 CSS 变量，让 padding 数值集中在 `.canvas-shell` 下：例如 `--canvas-node-body-padding: 12px`、`--canvas-runtime-frame-padding: 8px`、`--canvas-document-body-padding-block: 16px`、`--canvas-document-body-padding-inline: 18px`。然后把分散的硬编码值替换为这些变量，保留真正属于内部控件的行项目 padding，例如文件列表条目 `8px 10px` 可以保持为资源列表行密度，不把它误归为节点 body padding。

第二步处理执行节点差异。`Agent` 和 `Terminal` 都是执行节点，应统一正文外壳：让 `.terminal-session-body` 不再把 padding 覆盖为 `0`，只保留 `gap: 0`；`.terminal-frame` 改为使用 `--canvas-runtime-frame-padding`。这样 `Agent` 与 `Terminal` 都是外层 `12px`、内层 frame `8px`。如果后续截图显示过厚，可再单独讨论，但本轮目标是统一历史差异。

第三步处理 Note 和文件节点。Note 保留 `.note-surface padding: 0`，因为它是文档面，不是普通 card-in-card；但将编辑态、预览态和行号 gutter / measure 的 padding 改用文档变量，保证左右上下完全一致。File card 从 `14px 16px` 收口到普通正文 `12px`，minimal 维持 `3px 6px` 因为它是图标/路径 badge 级密度。File List body 从 `10px` 收口到 `12px`，minimal 仍使用 `4px 0` 保护列表密度。

第四步处理分组。把 `CANVAS_GROUP_PADDING` 从 `28` 收口到 `24`，并保留 `top = CANVAS_GROUP_PADDING + CANVAS_GROUP_TITLE_HEIGHT`。同步 `docs/UI.md` 和 `docs/design-docs/canvas-node-groups.md`，明确分组成员预留使用 `24px`，不是普通节点正文 padding。

第五步运行验证。优先运行 `npm run typecheck`、`npm run build`、`npm run test:canvas-node-groups`。如果 CSS 变动存在 Playwright 覆盖，运行相关 Webview 用例；至少运行 `node scripts/test/run-playwright-webview.mjs -g "canvas groups"` 或更窄的分组视觉/几何用例，并观察是否有 padding 断言需要更新。

## 具体步骤

所有命令都在仓库根目录执行，即 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas4`。

先读取当前状态：

    git status --short --branch
    rg -n "session-body|terminal-session-body|terminal-frame|object-body|note-surface|note-document-input|note-markdown-preview|file-node-action-card|file-list-body|compact-node|CANVAS_GROUP_PADDING" src/webview/styles.css src/panel/CanvasPanelManager.ts

完成修改后运行：

    npm run typecheck
    npm run build
    npm run test:canvas-node-groups

如 Playwright 环境可用，再运行：

    node scripts/test/run-playwright-webview.mjs -g "canvas node body padding"
    node scripts/test/run-playwright-webview.mjs -g "canvas groups"

## 验证与验收

验收标准是：代码中节点正文和分组成员预留不再散落使用互相冲突的历史硬编码；`Agent` 和 `Terminal` 的终端区域 padding 规则一致；`Note` 阅读态和编辑态维持同一文档页边距；`File` 和 `File List` 的卡片态使用普通正文密度；分组成员到 body 四边的视觉预留为 `24px` 且 top 继续扣除标题高度。自动化验证必须证明 TypeScript 和构建没有退化，分组几何测试没有因 inset 调整破坏合法状态。若 Playwright 分组测试失败，应判断是预期基线变化还是真实命中/布局回归，并把结论写回本计划。

## 幂等性与恢复

本轮只修改文本文件和样式常量，可以反复运行测试。不要删除未跟踪文件；当前工作树存在 `.tmp-playwright/`、`docs/references/coding-agent-security-products-2026-05.md`、`image.png`、`tmp.txt` 等未跟踪项，它们不是本任务产物，不应纳入提交，也不应清理。若修改中途发现已有跟踪文件出现非本轮改动，应停止并询问用户。

## 证据与备注

初始证据：当前分支为 `canvas-padding-unification`，跟踪 `origin/main`；`git status --short --branch` 显示只有未跟踪文件，没有已跟踪改动。

## 接口与依赖

本轮不引入新依赖，不改变协议接口。主要接口是 CSS 变量和宿主几何常量：

    src/webview/styles.css
      .canvas-shell 下定义 padding 变量
      .session-body / .terminal-frame / .object-body / .note-* / .file-* 使用这些变量

    src/panel/CanvasPanelManager.ts
      CANVAS_GROUP_PADDING = 24
      CANVAS_GROUP_MEMBER_INSETS.top = CANVAS_GROUP_PADDING + CANVAS_GROUP_TITLE_HEIGHT


本次修订说明：2026-05-30 完成 padding 统一实现、文档同步和验证记录，补充了分组 inset 变化导致测试期望调整的发现。
