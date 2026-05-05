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
updated_at: 2026-05-05
---

# Note Markdown 预览展示模式

## 1. 背景

上一轮已经把 `Note` 从“始终显示纯文本 `textarea`”升级成“编辑态纯文本输入、阅读态 Markdown 预览”。但当前阅读态只覆盖基础标题、列表、引用、代码块与表格排版，仍缺少更接近真实工作笔记的几类高频能力：checklist 仍只是普通列表、链接被显式禁点、代码块没有语法着色、数学公式继续暴露 `$` 分隔符。

因此，本轮不是重新设计 `Note` 的编辑模型，而是在保持“原始 Markdown 文本仍是唯一权威数据”的前提下，把阅读态扩展成更完整的 Markdown 工作表面。

## 2. 问题定义

本轮需要明确五个问题：

1. `Note` 的权威正文应保存什么格式。
2. 用户什么时候看到纯文本，什么时候看到 Markdown 预览。
3. checklist、链接、代码块和数学公式分别在阅读态支持到什么程度。
4. Markdown 预览是否允许原始 HTML、任意 scheme 链接点击等可能改变安全或交互语义的能力。
5. 现有 probe、自动化测试和宿主持久化如何在不引入新对象模型的前提下继续工作。

## 3. 目标

- 保持 `Note` 正文的权威数据仍为原始 Markdown 文本。
- 用户编辑正文时继续使用普通纯文本输入，而不是引入所见即所得富文本编辑器。
- 用户结束编辑后，正文区回到 Markdown 预览展示，让标题、任务列表、链接、代码块和公式具有结构化层次。
- 不改变宿主状态结构，不新增富文本持久化字段或二次缓存 HTML。
- 让现有自动化测试仍能稳定驱动 `Note` 正文写路径。

## 4. 非目标

- 不在本轮引入块编辑器、拖拽排版、图片上传或附件语义。
- 不在本轮支持原始 HTML 透传、脚本执行或任意内嵌 DOM。
- 不在本轮把 `Note` 升级成所见即所得富文本编辑器，也不把任务列表 checkbox 变成可直接回写 Markdown 源文的交互控件。
- 不在本轮允许越出 workspace 边界的相对路径、绝对路径、目录目标、`command:` 或其他未显式白名单的 scheme 在阅读态通过链接打开。
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

- 风险：阅读态点击若同时承担链接激活和进入编辑，会产生冲突。
  缓解：普通正文点击继续进入编辑；只有明确命中链接元素时，才走宿主打开路径，不再回落成默认浏览器导航。

- 风险：如果把任意 Markdown 链接都交给宿主打开，`command:`、越界相对路径或多根 workspace 歧义路径可能绕过安全边界。
  缓解：宿主对白名单外部 scheme 与受限 workspace 文件路径做显式校验；多根 workspace 缺少根名前缀时直接拒绝打开。

- 风险：task list、KaTeX 和语法高亮会引入额外依赖与样式资源，影响 Webview 构建。
  缓解：维持这些能力为纯渲染层插件，不改变协议或持久化；并在构建脚本里显式打包需要的字体资源。

- 风险：侧栏摘要、恢复逻辑和测试工具可能默认正文总是输入框。
  缓解：宿主摘要逻辑仍然基于原始文本；probe 与 DOM action 只补正文模式兼容，不改持久化协议。

## 7. 正式方案

### 7.1 正文权威数据保持原始 Markdown 文本

- `src/common/protocol.ts` 的 `NoteNodeMetadata.content` 继续保存用户输入的原始字符串。
- `src/panel/CanvasPanelManager.ts` 的 `updateNoteContent()`、恢复逻辑和摘要逻辑继续围绕这份原始文本工作。
- 本轮不新增 `renderedHtml`、块结构或额外 schema。

### 7.2 Webview 中把 Note 正文拆成阅读态与编辑态

- `src/webview/main.tsx` 的 `NoteEditableNode` 继续持有本地 `content` 草稿与提交逻辑。
- 当正文未处于编辑态时，节点正文区渲染 Markdown 预览容器；当用户点击正文区时，切换到 `textarea` 并聚焦，展示原始 Markdown 文本。
- 当用户失焦、按 `Ctrl/Cmd+Enter` 提交或结束当前编辑时，正文区回到预览态，并把最新内容写回宿主。
- `Escape` 仍沿用当前退出编辑语义，避免节点内键盘行为分叉。

### 7.3 Markdown 预览使用受控渲染，不开启原始 HTML

- Webview 侧继续以 `markdown-it` 作为核心渲染器，负责把原始 Markdown 转成展示 HTML。
- 配置至少满足：
  - 关闭原始 HTML 透传。
  - 允许基础 Markdown 结构，如标题、列表、引用、代码块、强调和链接文本。
  - 允许以更适合笔记阅读的方式处理换行。
- 在此基础上补充以下插件或渲染扩展：
  - `markdown-it-task-lists`：把 `- [ ]` / `- [x]` 渲染成只读 checkbox 列表。
  - `highlight.js`：为 fenced code block 生成语法高亮 token；声明语言时优先按语言高亮，无法识别时回退到自动识别或纯文本。
  - `markdown-it-katex` + `katex`：支持 `$...$` 行内公式和 `$$...$$` 块级公式，关闭信任外部 HTML 的路径。
- 最终视觉排版由 `src/webview/styles.css` 接管，继续遵循 VSCode 主题 token，而不是引入固定站点风格。

### 7.4 任务列表只读展示，链接通过宿主安全打开

- `Note` 阅读态的首要职责仍然是展示 Markdown 结构，并允许用户点击进入编辑。
- 如果用户点击的是普通正文区域，行为继续是进入编辑态。
- 如果用户点击的是 Markdown 链接元素，则不进入编辑，而是发消息给宿主；宿主按两类目标处理：
  - 外部链接只允许 `http`、`https`、`mailto` 三类 scheme。
  - workspace 文件链接只允许当前 workspace 内文件，单根 workspace 支持纯相对路径，多根 workspace 要求 `workspace-folder/relative/path` 前缀。
- workspace 文件链接支持可选 `#L12`、`#L12C3` 行列 fragment；宿主会按当前画布 surface 语义打开文件并定位到对应行列。
- 绝对路径、`..` 逃逸、目录目标和多根 workspace 下缺少根名前缀的歧义路径都必须 fail closed。
- 任务列表 checkbox 只作为预览态视觉元素存在，不在本轮支持点击勾选后自动修改 Markdown 源文。
- 如果未来要给 `Note` 增加交互式 checklist、目录跳转或代码块复制，应单独扩展设计，而不是把更多行为隐式混进当前预览面。

### 7.5 测试、probe 与宿主协议继续围绕原始文本工作

- `src/webview/main.tsx` 中的 probe 读取正文时，不能只依赖表单控件的 `.value`，而要在阅读态也能读取当前原始文本。
- `setNodeTextField(field: 'body')` 的 test DOM action 继续在设置正文前先确保节点进入编辑态，再对真实 `textarea` 写值。
- `src/common/protocol.ts` 与 `src/panel/CanvasPanelManager.ts` 需要新增一条专用于 `Note` 预览链接的消息链路，让链接打开不与编辑提交共用模糊语义。
- `tests/playwright/webview-harness.spec.mjs` 至少新增覆盖任务列表、链接点击、代码高亮和数学公式渲染的用例；如果补了纯函数级安全白名单辅助逻辑，也应补对应脚本测试。

## 8. 验证方法

至少需要完成以下验证：

1. `Note` 正文默认显示 Markdown 预览，而不是始终显示原始文本框。
2. 点击正文区后，用户能进入纯文本编辑态，并看到原始 Markdown 源文。
3. 编辑结束后，正文会回到预览态，且任务列表、链接、代码高亮与数学公式等结构可见。
4. 点击安全白名单内链接时，Webview 会请求宿主打开，且不会误切回编辑态；其中外部链接只允许显式白名单 scheme，workspace 文件链接只允许当前 workspace 内文件并支持可选行列定位。
5. 宿主持久化的 `metadata.note.content` 仍是原始文本。
6. `npm run typecheck` 通过。
7. `npm run test:note-markdown-links` 通过。
8. `npm run test:webview` 通过；若真实 DOM 或宿主消息链路适配涉及 smoke 主路径，再补 `npm run test:smoke`。

## 9. 已完成实现与验证

当前实现已经按上述方案落地：

- `src/webview/main.tsx` 的 `noteMarkdownRenderer` 已接入 `markdown-it-task-lists`、`highlight.js`、`markdown-it-katex` 和 `katex`，并在预览点击时区分“打开链接”与“进入编辑”。
- `src/common/noteMarkdownLinks.ts`、`src/common/protocol.ts` 与 `src/panel/CanvasPanelManager.ts` 已新增 `Note` 预览链接的统一解析与宿主打开链路，覆盖外部链接白名单与 workspace 文件链接。
- `scripts/build.mjs` 已补齐 KaTeX 字体资源所需的 `.woff` / `.woff2` loader，`src/webview/styles.css` 已补齐任务列表、链接、语法高亮与数学公式样式。
- `tests/playwright/webview-harness.spec.mjs` 已新增任务列表、链接点击、代码高亮和数学公式回归；`scripts/test-note-markdown-links.mts` 已覆盖外部链接白名单、单根/多根 workspace 文件链接和 fragment 解析。

本轮验证结果：

1. `npm run typecheck` 通过。
2. `npm run test:note-markdown-links` 通过。
3. `npm run test:webview` 通过。
4. `npm run test:smoke` 通过，覆盖 trusted / restricted workspace、real reopen 与 remote reopen 主路径。
