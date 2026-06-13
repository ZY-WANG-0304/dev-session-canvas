---
title: Note Markdown 预览展示模式
decision_status: 已选定
validation_status: 已验证
domains:
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/note-markdown-rich-preview.md
  - docs/exec-plans/completed/note-markdown-preview-rendering.md
  - docs/exec-plans/completed/note-markdown-workspace-file-links.md
  - docs/exec-plans/completed/note-markdown-interactive-checklists.md
  - docs/exec-plans/completed/note-preview-double-click-source-map-v2.md
updated_at: 2026-06-13
---

# Note Markdown 预览展示模式

## 1. 背景

上一轮已经把 `Note` 从“始终显示纯文本 `textarea`”升级成“编辑态纯文本输入、阅读态 Markdown 预览”，并补齐了任务列表、链接、代码高亮、数学公式与图片预览的基础渲染能力。但初版任务列表仍停留在“语义化展示”层：checkbox 只是视觉元素，用户若想标记完成，仍要重新进入纯文本编辑态，手动把 `[ ]` 改成 `[x]`。这让 `Note` 在阅读态离真正可用的工作清单还差最后一步交互。

因此，本轮不是重新设计 `Note` 的编辑模型，而是在保持“原始 Markdown 文本仍是唯一权威数据”的前提下，把阅读态扩展成更完整的 Markdown 工作表面。

## 2. 问题定义

本轮需要明确五个问题：

1. `Note` 的权威正文应保存什么格式。
2. 用户什么时候看到纯文本，什么时候看到 Markdown 预览。
3. checklist 在阅读态是只读展示，还是允许直接勾选并回写 Markdown 源文；链接、图片、代码块和数学公式又分别支持到什么程度。
4. Markdown 预览是否允许原始 HTML、任意 scheme 链接点击等可能改变安全或交互语义的能力。
5. 现有 probe、自动化测试和宿主持久化如何在不引入新对象模型的前提下继续工作。

## 3. 目标

- 保持 `Note` 正文的权威数据仍为原始 Markdown 文本。
- 用户编辑正文时继续使用普通纯文本输入，而不是引入所见即所得富文本编辑器。
- 用户结束编辑后，正文区回到 Markdown 预览展示，让标题、任务列表、链接、图片、代码块和公式具有结构化层次。
- 用户在阅读态点击 Markdown checklist checkbox 时，可以直接切换完成状态，而不必先回到纯文本编辑态。
- 不改变宿主状态结构，不新增富文本持久化字段或二次缓存 HTML。
- 让现有自动化测试仍能稳定驱动 `Note` 正文写路径。

## 4. 非目标

- 不在本轮引入块编辑器、拖拽排版、图片上传、图片编辑、附件管理或图片作为独立画布资产的语义。
- 不在本轮支持原始 HTML 透传、脚本执行或任意内嵌 DOM。
- 不在本轮把 `Note` 升级成所见即所得富文本编辑器，也不在预览态直接改写任务文案、列表顺序或非 checklist 正文。
- 不在本轮允许越出 workspace 边界的相对路径、绝对路径、目录目标、`command:` 或其他未显式白名单的 scheme 在阅读态通过链接打开。
- 不在本轮把图片失败加载、图片尺寸元数据、图片缓存或远程图片代理写入 Note 持久化状态。
- 不在本轮改变 `Note` 在对象模型中的轻量辅助定位。

## 5. 候选方案

### 5.1 始终显示纯文本 textarea

优点：

- 几乎没有实现成本。
- 不需要新增任何渲染依赖。

不选原因：

- 这正是当前行为，无法满足“展示时按 Markdown 预览渲染”的目标。
- 阅读态缺少层次，`Note` 仍然像机械输入框。

### 5.2 常驻双栏：左边编辑、右边预览

优点：

- 编辑与预览同时可见，切换心智成本低。

不选原因：

- 节点空间有限，双栏会明显压缩正文有效面积。
- `Note` 当前是嵌在画布里的轻量节点，而不是独立文档页；双栏会让节点显得过重。

### 5.3 用单一正文区在“纯文本编辑”和“Markdown 预览”之间切换，并逐步扩展阅读态能力

优点：

- 保持当前单区工作面，不增加新的控制按钮。
- 与现有节点内直接编辑路径一致，用户点击正文就能进入编辑。
- 阅读态可以把有限空间留给更高密度的结构化内容，同时继续沿用当前持久化结构。

风险：

- 测试和 probe 需要适配正文不再总是表单控件。
- 用户在阅读态里既可能想进入编辑，也可能想点击链接，交互冲突必须显式收口。

## 6. 风险与取舍

- 取舍：正文继续只保存原始文本，不保存 HTML 缓存。
  原因：宿主持久化与恢复已经围绕 `metadata.note.content` 建立；HTML 缓存会引入冗余状态与失同步风险。

- 风险：Markdown 预览若允许原始 HTML，会把任意标签直接带进 Webview。
  缓解：渲染器关闭 HTML 透传，只把 Markdown 语法转成受控 HTML。

- 风险：阅读态点击若同时承担 checklist 切换、链接激活和进入编辑，会产生冲突。
  缓解：单击普通正文保留预览、双击普通正文进入编辑；明确命中 checklist checkbox 时只切换完成状态；明确命中链接元素时只走宿主打开路径，不回落成默认浏览器导航。

- 风险：如果把任意 Markdown 链接都交给宿主打开，`command:`、越界相对路径或多根 workspace 歧义路径可能绕过安全边界。
  缓解：宿主对白名单外部 scheme 与受限 workspace 文件路径做显式校验；多根 workspace 缺少根名前缀时直接拒绝打开。

- 风险：task list、KaTeX 和语法高亮会引入额外依赖与样式资源，影响 Webview 构建。
  缓解：维持这些能力为纯渲染层插件，不改变协议或持久化；并在构建脚本里显式打包需要的字体资源。

- 风险：预览态 checkbox 需要精确回写对应 Markdown 源文行；如果 DOM 与源文映射漂移，可能误改正文。
  缓解：利用 `markdown-it` token 的 `map` 行号信息给 checkbox 注入源文定位元数据；只有映射到合法 checklist 行时才执行改写，否则 fail closed。

- 风险：侧栏摘要、恢复逻辑和测试工具可能默认正文总是输入框。
  缓解：宿主摘要逻辑仍然基于原始文本；probe 与 DOM action 只补正文模式兼容，不改持久化协议。

- 风险：如果双击预览时从渲染后的 DOM 文本反推出 Markdown 源码偏移，列表续行、嵌套引用、三重强调、实体解码和代码块缩进都会让偏移漂移。
  缓解：源码定位不再手写 Markdown 语法跳过规则，而是在渲染阶段用 mdast/micromark 的 parser position 生成源码 offset map；双击阶段只读取已注入的 offset map 或块级 fallback range。

## 7. 正式方案

### 7.1 正文权威数据保持原始 Markdown 文本

- `src/common/protocol.ts` 的 `NoteNodeMetadata.content` 继续保存用户输入的原始字符串。
- `src/panel/CanvasPanelManager.ts` 的 `updateNoteContent()`、恢复逻辑和摘要逻辑继续围绕这份原始文本工作。
- 本轮不新增 `renderedHtml`、块结构或额外 schema。

### 7.2 Webview 中把 Note 正文拆成阅读态与编辑态

- `src/webview/main.tsx` 的 `NoteEditableNode` 继续持有本地 `content` 草稿与提交逻辑。
- 当正文未处于编辑态时，节点正文区渲染 Markdown 预览容器；用户单击时应能直接选中和复制预览内容，其中 `Ctrl/Cmd+A` 只应全选当前 Note 正文预览而不是整张画布，`Ctrl/Cmd+C` 则继续走宿主原生复制链路；只有双击普通正文区域时才切换到 `textarea` 并聚焦，展示原始 Markdown 文本。
- 当用户失焦、按 `Ctrl/Cmd+Enter` 提交或结束当前编辑时，正文区回到预览态，并把最新内容写回宿主。
- 阅读态与编辑态切换必须保持源文附近的视口连续性：从预览双击进入编辑时，`textarea` 不只设置 selection，还要滚动到该 selection 对应的源文行附近；从编辑态回到预览态时，应把当前编辑器顶部可见源文行映射回预览中最近的 `data-note-markdown-source-*` 元素，而不是重新从文档开头展示。由于 Markdown 预览与纯文本编辑器行高、折行和块间距不同，目标是保持源文局部连续，而不是逐像素同步。
- 编辑态的 `textarea` 应保留纯文本权威输入模型，但需要提供最小代码编辑器 affordance：左侧显示逻辑行号；`Tab` 在光标处插入两个空格或对多行选择整体缩进；`Shift+Tab` 对当前行或多行选择移除一个 tab 或最多两个前导空格，并且不把焦点移出正文编辑区。
- 编辑态行号应采用接近 VSCode/Monaco 的 view line 思路：每个源文逻辑行只在第一条视觉行显示行号，软换行产生的续行在 gutter 中保留等高空 row，从而让后续行号继续落在对应源文行的真实起点。由于当前 Note 仍使用原生 `textarea`，Webview 侧通过隐藏 mirror 层复刻输入框的字体、行高、padding、tab size、内容宽度与 `pre-wrap` 换行规则，计算每个逻辑行折成多少条视觉行；mirror 宽度必须使用 `textarea.clientWidth`，避免垂直滚动条出现后与真实文本换行宽度分叉。
- `Escape` 仍沿用当前退出编辑语义，避免节点内键盘行为分叉。

### 7.3 Markdown 预览使用受控渲染，不开启原始 HTML

- Webview 侧继续以 `markdown-it` 作为核心渲染器，负责把原始 Markdown 转成展示 HTML。
- 配置至少满足：
  - 关闭原始 HTML 透传。
  - 允许基础 Markdown 结构，如标题、列表、引用、代码块、强调和链接文本。
  - 允许以更适合笔记阅读的方式处理换行。
- 在此基础上补充以下插件或渲染扩展：
  - `markdown-it-task-lists`：把 `- [ ]` / `- [x]` 渲染成可交互 checkbox 列表，并保留足够的元数据把点击回写到源文。
  - `highlight.js`：为 fenced code block 生成语法高亮 token；声明语言时优先按语言高亮，无法识别时回退到自动识别或纯文本。
  - `katex`：通过 Webview 内自有 `markdown-it` inline / block 规则识别 `$...$` 行内公式和 `$$...$$` 块级公式，并调用 `katex.renderToString({ trust: false, throwOnError: false })` 生成受控 HTML；不使用会透传 malformed math raw HTML 的第三方 Markdown 插件。
  - Markdown 图片语法：把 `![alt](src)` 渲染成只读图片预览；只允许 `https:`、受限 `data:image/*;base64` 和由宿主转换后的本地 workspace / 关联 Markdown 文件相对图片资源。
- 最终视觉排版由 `src/webview/styles.css` 接管，继续遵循 VSCode 主题 token，而不是引入固定站点风格。

### 7.4 任务列表可在预览态切换，链接通过宿主安全打开，图片只做安全预览

- `Note` 阅读态的首要职责仍然是展示 Markdown 结构，并允许用户在需要时通过双击进入编辑。
- 如果用户单击的是普通正文区域，行为应保留在预览态，以便直接选择和复制内容；只有双击普通正文区域时，才进入编辑态。
- 如果用户点击的是由 Markdown task list 语法渲染出来的 checkbox，则不进入编辑态，而是按源文行号切换对应 `[ ]` / `[x]` 标记，并立即复用现有 `webview/updateNoteNode` 写回宿主。
- checkbox 的源文定位通过 `markdown-it` token `map` 行号注入到渲染后的 DOM 属性中；如果行号缺失、越界或命中的源文行不再是合法 checklist，则必须 fail closed，不切换内容也不报错污染宿主状态。
- 如果用户点击的是 Markdown 图片元素，则保持阅读态，只作为预览内容参与选择、滚动和缩放，不进入编辑、不打开外部资源、不写回 Note 正文。
- Markdown 图片资源按 fail closed 规则解析：`https:` 图片可直接作为远程只读预览；`data:` 只允许常见 base64 图片 MIME；关联 Markdown 文件中的相对图片路径优先按该 Markdown 文件所在目录解析；普通内嵌 Note 中的相对图片路径按现有 workspace 文件链接口径解析，单根 workspace 支持纯相对路径，多根 workspace 需要 workspace folder 前缀。
- 宿主只把可被 Webview 安全加载的本地资源目录通过 `asWebviewUri` 和 `localResourceRoots` 暴露给当前 Webview；原始 `file:`、`vscode-remote:` 或绝对路径不进入 Markdown 预览 DOM。
- 如果用户点击的是 Markdown 链接元素，则不进入编辑，而是发消息给宿主；宿主按两类目标处理：
  - 外部链接只允许 `http`、`https`、`mailto` 三类 scheme。
  - workspace 文件链接只允许当前 workspace 内文件，单根 workspace 支持纯相对路径，多根 workspace 要求 `workspace-folder/relative/path` 前缀。
- 外部链接的打开容器由 `devSessionCanvas.canvas.linkOpenMode` 控制：默认 `editorPreview` 对 `http` / `https` 链接显式调用 VS Code 内置 Simple Browser 的 `simpleBrowser.api.open`，在 editor 区域预览打开；若链接指向 `localhost`、loopback IP 或 all-interface 本地服务，宿主会先用 `vscode.env.asExternalUri(...)` 解析成远程场景可访问的预览 URI。其它安全外部 scheme 继续通过 `vscode.open` 交给 VS Code opener 处理。`externalBrowser` 则通过 `vscode.env.openExternal` 交给系统默认浏览器或应用。这个设置只影响外部链接，不改变 workspace 文件链接始终在 VS Code 编辑器中打开的安全边界。
- 链接安全边界必须在渲染层和宿主层双重 fail closed：`src/webview/main.tsx` 的 Markdown renderer 不应为 `command:`、未知 scheme、绝对路径、query 路径或 `..` 逃逸路径生成真实 `href`，宿主 `src/panel/CanvasPanelManager.ts` 仍在 `openNoteLink()` 中执行最终白名单和 workspace containment 校验。
- workspace 文件链接支持可选 `#L12`、`#L12C3` 行列 fragment；宿主会按当前画布 surface 语义打开文件并定位到对应行列。
- 绝对路径、`..` 逃逸、目录目标和多根 workspace 下缺少根名前缀的歧义路径都必须 fail closed。
- 交互式 checklist 只覆盖标准 Markdown task list 语法生成的 checkbox，包括无序列表、有序列表以及 blockquote / 嵌套场景中的版本；不支持原始 HTML 注入出的自定义 checkbox，也不在预览态直接编辑任务正文。
- 如果未来要给 `Note` 增加目录跳转、代码块复制或更复杂的块级操作，应单独扩展设计，而不是把更多行为隐式混进当前预览面。

### 7.5 双击预览进入编辑时使用 parser-position source map 定位光标

- 双击普通预览文本进入编辑态时，textarea 光标应落在被双击可见字符对应的原始 Markdown 源码 offset，而不是默认落到正文开头或结尾。
- 该能力不替换现有 Markdown 渲染栈：Webview 继续以 `markdown-it` 负责实际 HTML、安全链接、图片、task list、KaTeX 和代码高亮；新增 `src/common/noteMarkdownSourceMap.ts` 只用 `mdast-util-from-markdown`、GFM/math micromark 扩展和 mdast 扩展生成源码位置索引。
- source map 使用原始 `NoteNodeMetadata.content` 的 UTF-16 offset。合法 YAML front matter 被隐藏时，解析 body 后必须把 `frontMatter.rawBlock.length` 加回所有 offset，确保 selection 仍指向完整 Markdown 文件中的真实位置。
- 对稳定文本节点，source map 记录 `text` 和 `sourceOffsets`。`sourceOffsets` 长度为 rendered text 长度加一，第 N 项表示可见文本 offset N 对应的源码 offset。普通文本、标题、链接文本、列表续行、blockquote 内列表续行、inline code、强调/三重强调和 task item 文本都走这条路径。
- `A &amp; B` 这类实体和反斜杠转义不能用 `node.position.start.offset + renderedOffset` 简单相加；实现必须把 mdast 的 rendered value 与 position 覆盖的源码切片逐字符对齐，遇到 HTML character reference 或 Markdown backslash escape 时把可见字符映射回对应源码 token 起点。
- code block 需要按原始代码字符映射。Fenced code 的可见源码起点是 opening fence 下一行；无语言 fenced code 与 indented code 在 mdast 中都可能表现为 `code.lang === null`，因此需要检查源码切片首行是否为 fence。Indented code 的每一行都要跳过最多四个源码缩进字符后再映射可见代码字符。
- 渲染后，Webview 用 DOM API 在临时 template 中给匹配到的文本节点包裹 `<span data-note-markdown-source-offsets="...">`，并给标题、段落、列表项、代码块、图片、display math、table、hr 等块级元素注入 `data-note-markdown-source-block="true"`、`data-note-markdown-source-start` 与 `data-note-markdown-source-end`。这些属性仅用于本地交互，不进入宿主持久化状态。
- 双击处理先用浏览器 caret API 找命中文本节点，并且只有当 caret 所属 source span 的 client rect 覆盖双击点时才读取文本 offset；这避免双击图片或空白时浏览器把 caret 解析到相邻段落文本而误定位。
- 如果命中图片、空白、display math、malformed math 或其他不能稳定映射到单个源码字符的复杂块，双击应寻找最近带块级 range 的元素并返回该块的 `sourceEnd`。只有当前预览内找不到任何局部块范围时，才回退到当前 Note 正文末尾。
- Markdown 图片不再作为双击编辑的排除目标；它没有稳定文本 offset，但必须通过图片自身或外层段落的块级 range fallback 到图片 Markdown 源码末尾。Checklist checkbox 和 Markdown link 仍然是独立交互入口，命中它们时不进入正文编辑。

### 7.6 测试、probe 与宿主协议继续围绕原始文本工作

- `src/webview/main.tsx` 中的 probe 读取正文时，不能只依赖表单控件的 `.value`，而要在阅读态也能读取当前原始文本。
- `setNodeTextField(field: 'body')` 的 test DOM action 继续在设置正文前先确保节点进入编辑态，再对真实 `textarea` 写值。
- 真实 DOM / smoke 还需要一条专用 DOM action 来命中渲染后的 checklist checkbox，证明预览点击会走源文改写与宿主持久化主路径。
- 阅读态与编辑态中的标准文本快捷键需要按语义分流：`Ctrl/Cmd+C`、`Ctrl/Cmd+X`、`Ctrl/Cmd+V` 不能被节点层 `keydown` 处理吞掉；`Ctrl/Cmd+A` 则必须在节点内本地收口为“只全选当前正文区域/输入框”，而不是继续冒泡成整张画布的 select-all。
- 编辑态的 `Tab` / `Shift+Tab` 属于正文编辑器局部快捷键：由 Webview 在 `textarea` 的 `keydown` 中阻止浏览器焦点跳转并直接改写当前草稿，直到失焦或显式提交时再复用 `webview/updateNoteNode` 写回宿主。
- `src/common/protocol.ts` 与 `src/panel/CanvasPanelManager.ts` 需要新增一条专用于 `Note` 预览链接的消息链路，让链接打开不与编辑提交共用模糊语义。
- `tests/playwright/webview-harness.spec.mjs` 至少新增覆盖任务列表交互、链接点击、代码高亮和数学公式渲染的用例；如果补了纯函数级辅助逻辑，也应补对应脚本测试。

## 8. 验证方法

至少需要完成以下验证：

1. `Note` 正文默认显示 Markdown 预览，而不是始终显示原始文本框。
2. 单击正文区时，用户仍停留在预览态并可直接选择内容；双击正文区后，用户能进入纯文本编辑态，并看到原始 Markdown 源文。
3. 双击预览普通文本、列表续行、blockquote 列表续行、强调文本、代码块可见字符和 entity 后续文本时，textarea selection 应等于对应 Markdown 源码 offset；双击图片、空白、display math 或 malformed math 时，selection 应等于对应 Markdown 块源码末尾。
4. 当预览已滚动到文档中部或末尾时，双击进入编辑后应显示 selection 附近的源码内容；当编辑器已滚动到文档中部或末尾时，失焦回到预览后也应显示对应源文附近的预览内容。
5. 点击阅读态 checklist checkbox 时，正文会在不进入编辑态的前提下切换 `[ ]` / `[x]`，并立即写回宿主持久化。
6. 编辑结束后，正文会回到预览态，且任务列表、链接、图片、代码高亮与数学公式等结构可见。
7. 点击安全白名单内链接时，Webview 会请求宿主打开，且不会误切回编辑态；其中外部链接只允许显式白名单 scheme，workspace 文件链接只允许当前 workspace 内文件并支持可选行列定位。
8. Markdown 图片语法在阅读态能展示安全图片预览；不支持的 scheme、绝对路径和越界路径不会生成可加载图片。
9. 宿主持久化的 `metadata.note.content` 仍是原始文本。
10. 编辑态显示与正文逻辑行数一致的行号；长逻辑行软换行时，续行在 gutter 中占空 row 但不额外显示行号，后续行号仍对齐到对应源文行起点；按 `Tab` / `Shift+Tab` 时焦点仍停留在正文输入框，当前行或多行选择按两个空格粒度缩进/反缩进。
11. `npm run typecheck` 通过。
12. `npm run test:note-markdown-links`、`npm run test:note-markdown-checklists`、`npm run test:webview` 与 `npm run test:smoke` 通过。

## 9. 已完成实现与验证

当前实现已经按上述方案落地：

- `src/webview/main.tsx` 的 `noteMarkdownRenderer` 已接入 `markdown-it-task-lists`、`highlight.js`、自有安全 KaTeX 规则和受限图片渲染规则，并在预览点击时区分“切换 checklist”“打开链接”与“进入编辑”；malformed math 中的 raw HTML / `command:` 链接必须被 KaTeX 转义，不能生成真实标签。
- `src/webview/main.tsx` 的 Markdown link renderer 已覆盖 `validateLink` 并在 `link_open` 中二次检查 `href`，不为 `command:` 等 unsafe 链接生成可激活 DOM；`src/panel/CanvasPanelManager.ts` 的 `enableCommandUris` 也收窄到画布 standby 页面需要的扩展命令白名单。
- `src/common/noteMarkdownChecklist.ts` 已新增按源文行切换 Markdown checklist 标记的纯函数辅助逻辑，支持无序列表、有序列表和嵌套缩进场景。
- `src/common/noteMarkdownLinks.ts`、`src/common/protocol.ts` 与 `src/panel/CanvasPanelManager.ts` 已新增 `Note` 预览链接的统一解析与宿主打开链路，覆盖外部链接白名单与 workspace 文件链接。
- `src/common/protocol.ts`、`src/webview/main.tsx` 与 `tests/vscode-smoke/extension-tests.cjs` 已补齐真实 DOM action `toggleNoteChecklistItem`，用于在 smoke 中驱动真实 checkbox 点击并验证宿主状态回写。
- `scripts/build/build.mjs` 已补齐 KaTeX 字体资源所需的 `.woff` / `.woff2` loader，`src/webview/styles.css` 已补齐任务列表、链接、图片预览、语法高亮与数学公式样式，并恢复 preview checklist 的真实命中能力。
- `src/webview/main.tsx` 与 `src/webview/styles.css` 已把编辑态行号从固定逻辑行列表改成“隐藏 mirror 计算视觉行数 + gutter 续行空 row”：普通行继续显示一个 row，软换行后的长逻辑行会在 gutter 中保留空白续行 row，让后续行号按视觉行节奏对齐。
- `tests/playwright/webview-harness.spec.mjs` 已新增任务列表交互、链接点击、代码高亮和数学公式回归，并覆盖编辑态行号展示与 `Tab` / `Shift+Tab` 缩进不会把焦点移出正文输入框；`scripts/test/test-note-markdown-links.mts` 与 `scripts/test/test-note-markdown-checklists.mts` 已分别覆盖链接白名单与 checklist 源文改写逻辑。

2026-05-21 双击源码定位重写追加实现：

- `src/common/noteMarkdownSourceMap.ts` 已新增 parser-position source map，覆盖 GFM、math、entity/backslash 对齐、fenced code 与 indented code 的源码 offset 映射。
- `src/webview/main.tsx` 已在 Markdown 预览 HTML 渲染后注入 text span offset map 和 block fallback range；`handlePreviewDoubleClick()` 会把 selection request 传给正文 textarea，普通文本落到点击字符，复杂块落到最近 Markdown 块源码末尾。
- `src/common/protocol.ts`、`src/webview/main.tsx` 与 `tests/playwright/webview-harness.spec.mjs` 已补齐 `doubleClickNotePreviewText` / `doubleClickNotePreviewSelector` 测试 DOM action，用真实坐标覆盖浏览器 caret 与 fallback 行为。
- `scripts/test/test-note-markdown-source-map.mts` 已新增纯函数回归，覆盖 list continuation、ordered list continuation、nested blockquote list continuation、triple emphasis、entity/backslash、fenced code、indented code、图片与 math block end。

2026-05-22 预览 / 编辑切换滚动连续性追加实现：

- `src/webview/main.tsx` 已在预览态和编辑态共享正文滚动状态，并移除双击进入编辑时把正文滚动重置到 0 的行为。
- 预览进入编辑时，编辑器会优先按 selection 所在源文行计算 `textarea.scrollTop`，让中后段内容进入编辑后仍显示在视口内。
- 编辑回到预览时，Webview 会把当前编辑器顶部可见源文行映射到预览中最近的 source map 元素并恢复滚动位置；找不到局部 source 元素时才回落到保存的滚动值。
- `tests/playwright/webview-harness.spec.mjs` 已新增滚动回归，覆盖“滚动后的预览双击进入编辑不回到源码开头”和“滚动后的编辑失焦回到预览不从头展示”。

2026-05-22 display math 多块 fallback 追加实现：

- `src/webview/main.tsx` 已将 math block range 只绑定到 `.note-markdown-math-display` 外层 wrapper，避免同一公式内层 `.katex-display` 参与同一 kind 候选序列并消费后续公式 range。
- `tests/playwright/webview-harness.spec.mjs` 已新增两段 display math 的回归，分别双击两段公式内部 KaTeX 内容并验证 fallback 落到各自 `$$...$$` Markdown 源码末尾。

本轮验证结果：

1. `npm run typecheck` 通过。
2. `npm run test:note-markdown-links` 通过。
3. `npm run test:note-markdown-checklists` 通过。
4. `npm run test:webview` 通过。
5. `npm run test:smoke` 通过，覆盖 trusted / restricted workspace、real reopen 与 remote reopen 主路径。

2026-05-06 编辑态行号与缩进追加验证：

1. `npm run typecheck` 通过。
2. `npm run test:webview -- -g "note body editor supports tab indentation and line numbers|note body editing target fills the note frame without an inset editor box"` 通过。

2026-05-06 安全 KaTeX 追加验证：

1. 移除存在 high severity XSS 的 `markdown-it-katex` 依赖，改为 `src/webview/main.tsx` 内自有 Markdown math 规则直接调用新版 `katex`。
2. 新增 Playwright 回归，验证 malformed math `$<a href="command:workbench.action.closeActiveEditor">run command</a>%$` 不会在预览态生成真实 `<a>` 标签。

2026-05-07 链接渲染层追加验证：

1. 新增 Playwright 回归，验证普通 Markdown 链接 `[run](command:workbench.action.closeActiveEditor)` 不会在 `.note-markdown-preview` 内生成 `href="command:..."` 或 `data-note-markdown-link="true"` 的可激活链接。
2. 将 Webview `enableCommandUris` 从 `true` 收窄到 `devSessionCanvas.openCanvas` / `openCanvasInEditor` / `openCanvasInPanel`，只保留 standby 页面需要的命令 URI。

2026-05-13 软换行行号对齐追加验证：

1. 新增 Playwright 回归，验证 25 行内容中第 18 / 24 行软换行后，gutter 会在续行位置保留空 row，且第 19 / 25 行号落在对应源文行起点。
2. `npm run typecheck` 通过。
3. `npm run test:webview -- --grep "note body editor"` 通过。

2026-05-16 图片预览追加验证：

1. Note Markdown 阅读态新增受限图片渲染：`https:`、安全 `data:image/*;base64`、关联 Markdown 文件相对图片和 workspace 相对图片可进入预览；不支持的 scheme、绝对路径和越界路径 fail closed。
2. 宿主通过 `asWebviewUri` 为 workspace root 与关联 Markdown 文件目录生成 Webview 可加载基准 URI，并用 `localResourceRoots` 约束本地资源访问范围；该 URI 只随 `host/bootstrap` / `host/stateUpdated` 发送到 Webview，不进入持久化状态。
3. `npm run typecheck`、`npm run test:note-markdown-front-matter`、`npm run test:note-markdown-links` 与 `npm run test:webview -- --grep "safe images|YAML metadata|original line numbers|malformed html|markdown link"` 通过。

2026-05-21 双击源码定位追加验证：

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. `npm run test:protocol-webview-messages` 通过。
4. `npm run test:note-markdown-checklists` 通过。
5. `npm run test:note-markdown-front-matter` 通过。
6. `npm run test:note-markdown-links` 通过。
7. `npm run test:note-markdown-source-map` 通过。
8. `npx playwright test tests/playwright/webview-harness.spec.mjs --grep "note body requires double click|double-clicking note preview starts editing|double-clicking note preview image falls back|double-clicking note preview blank space falls back|double-clicking note preview display math falls back|double-clicking multiline fenced code maps|double-clicking markdown-like fenced code maps|double-clicking indented code maps|double-clicking markdown punctuation|double-clicking note task text|double-clicking list continuation|double-clicking ordered list continuation|double-clicking blockquote list continuation|double-clicking triple emphasis|double-clicking malformed display math"` 通过，15 条测试全部通过。
9. `npx playwright test tests/playwright/webview-harness.spec.mjs --grep "note markdown preview renders task lists|safe images|YAML metadata|original line numbers|malformed html|markdown link|checklist updates keep original line numbers|clicking a note checklist|clicking a note markdown link|unsafe command links"` 通过，8 条测试全部通过。

2026-05-22 预览 / 编辑滚动连续性追加验证：

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. `npm run test:protocol-webview-messages` 通过。
4. `npm run test:note-markdown-source-map` 通过。
5. `npx playwright test tests/playwright/webview-harness.spec.mjs --grep "double-clicking note preview|double-clicking a scrolled note preview|returning from note body edit mode|note body requires double click"` 通过，7 条测试全部通过。

2026-05-22 display math 多块 fallback 追加验证：

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. `npm run test:note-markdown-source-map` 通过。
4. `npx playwright test tests/playwright/webview-harness.spec.mjs --grep "display math falls back|multiple display math|malformed display math"` 通过，3 条测试全部通过。
