---
title: Note 与 Markdown 文件关联
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/explorer-markdown-create-note.md
related_plans:
  - docs/exec-plans/active/note-markdown-file-association.md
  - docs/exec-plans/active/canvas-template-associated-note-modes.md
updated_at: 2026-06-07
---

# Note 与 Markdown 文件关联

## 1. 背景

`Note` 当前已经从纯文本输入框升级为轻量 Markdown 工作表面：正文权威数据仍是原始 Markdown 文本，阅读态由 Webview 渲染 Markdown 预览，并支持 checklist、workspace 文件链接、代码高亮与数学公式。这个方向符合 `Note` 的产品定位：它是画布里的轻量协作上下文纸面，而不是完整任务系统、知识库或独立文档应用。

下一步增强希望让 `Note` 可以和真实 Markdown 文件发生关系。核心动机不是在画布里重做 Markdown 编辑器，而是让用户把临时上下文沉淀到可被 VSCode、Agent 与仓库工具链直接读写的 `.md` / `.markdown` 文件中；画布继续负责空间化组织、快速预览和协作上下文呈现。

## 2. 问题定义

本设计需要回答以下问题：

1. 普通 `Note` 是否仍然存在，以及它和关联 Markdown 文件后的 `Note` 如何区分。
2. 用户如何把普通 `Note` 转成一个真实 Markdown 文件，并在转换时决定最终路径与文件名。
3. 当目标 Markdown 文件已经存在时，当前 `Note` 内容和现有文件内容谁胜出。
4. 关联文件是否必须限制在当前 workspace 内，以及如何处理 workspace 外、Remote 或不可访问文件。
5. 关联文件被修改、删除、移动或权限变化时，画布节点如何展示状态。
6. 拖拽 Markdown 文件到画布空白区域时，是否可以直接创建关联 Markdown 的 `Note`。
7. 关联后是否需要解除关联能力，以及删除节点是否影响文件。

## 3. 目标

- 保留普通 `Note`：未关联文件的 `Note` 继续把正文保存在画布状态中。
- 允许用户把普通 `Note` 显式转换为关联 Markdown 文件的 `Note`。
- 转换时由用户在 Quick Input 流程中确认最终 Markdown 路径与名称，默认推荐 `<workspace root>/<note title>.md`。
- Quick Input 的路径确认过程应提供类似 VSCode “Open File or Folder” 的当前目录子目录与 Markdown 文件提示，帮助用户导航和选择。
- 目标文件已存在时，让用户在“覆盖文件并关联”“保留文件内容并关联”“取消”之间显式选择。
- 关联后的 `Note` 以 Markdown 文件作为内容权威来源；画布节点提供轻量预览和编辑入口。
- 关联后的 `Note` 在标题下方以 subtitle 形式显示文件路径，不使用额外路径胶囊。
- 支持 workspace 内外由用户显式选择、输入或拖拽的 `.md` / `.markdown` 文件。
- 支持把 `.md` / `.markdown` 文件拖到画布空白区域释放，并在释放位置创建关联 Markdown 的 `Note`。
- 关联文件不可用时，节点清楚显示警告状态；不要求展示最后一次读取的内容缓存。

## 4. 非目标

- 不把所有普通 `Note` 强制落成文件。
- 不支持 `.txt`、`.rst`、`.adoc` 或任意文本文件；第一版只支持 `.md` / `.markdown`。
- 不在本轮引入完整 Markdown 文件管理器、目录树、知识库、标签系统或双链语义。
- 不在节点内复刻 VSCode Markdown 编辑器的全部能力；长篇编辑仍应优先回到 VSCode 原生编辑器。
- 不提供解除关联能力。用户如果不再需要关联节点，可以删除节点并新建普通 `Note`。
- 删除关联 Markdown 的 `Note` 不删除对应文件。
- 不自动扫描 workspace 或外部目录来生成 `Note`；只响应用户明确动作。

## 5. 候选方案

### 5.1 所有 Note 自动保存为 Markdown 文件

优点：

- 数据全部落在真实文件中，Agent 与仓库工具链天然可见。
- 画布持久化模型可以减少正文内容负担。

不选原因：

- 会破坏普通 `Note` 的轻量性，让用户创建临时上下文时被迫处理文件命名与目录选择。
- 容易把产品推向 Markdown 文档管理器，而不是多 Agent 协作画布。
- 需要为历史 `Note`、空 `Note`、临时草稿和删除语义引入大量迁移与清理规则。

### 5.2 可双向绑定并允许随时解除关联

优点：

- 看起来更灵活，用户可以在普通 `Note` 和文件 `Note` 之间反复切换。

不选原因：

- 解除关联时必须决定是否把文件内容复制回画布状态、是否保留文件、是否覆盖普通 `Note` 草稿，容易制造双源冲突。
- 用户心智会从“这个 Note 现在由文件驱动”变成“这个 Note 可能部分由文件、部分由画布状态驱动”。
- 与当前需求不一致；当前更需要清晰的一次性升级路径，而不是复杂绑定管理。

### 5.3 保留普通 Note，提供单向“保存为 Markdown 并关联”和拖拽创建

优点：

- 普通 `Note` 仍然满足轻量临时上下文需求。
- 用户需要沉淀内容时，可以显式把 `Note` 保存成真实 Markdown 文件。
- 关联后文件成为权威内容源，状态边界清楚。
- 拖拽 `.md` / `.markdown` 文件到画布空白区创建节点，符合 VSCode 用户对文件拖放的自然预期。

取舍：

- 关联后不再提供“解除关联”，减少灵活性，但换来更清晰的数据权威与冲突模型。
- workspace 外文件会带来可访问性、Remote 与路径持久化风险，需要通过用户显式动作、类型校验和不可用警告来收口。

## 6. 风险与取舍

- 取舍：关联 Markdown 后，文件是内容权威来源。
  原因：如果同时让画布状态和文件内容都成为权威，外部编辑、Agent 写文件和节点内编辑会持续产生冲突。

- 取舍：不提供解除关联。
  原因：解除关联会把“文件内容是否复制回普通 Note”变成新的产品分叉。当前更简单的路径是删除关联节点并新建普通 `Note`。

- 风险：workspace 外路径在另一台机器、远程窗口或不同用户环境中可能不可访问。
  缓解：只允许用户显式输入、选择或拖拽产生关联；持久化时记录资源标识，节点恢复后若文件不可读，显示明确警告而不是静默退回缓存内容。

- 风险：目标文件已存在时，如果静默覆盖会造成数据丢失。
  缓解：转换流程必须让用户在“覆盖文件并关联”“保留文件内容并关联”“取消”之间选择；覆盖属于破坏性动作，应通过 modal warning 或同等强度的确认表达风险。

- 风险：文件在 VSCode 编辑器中已打开且有未保存修改时，Note 只认磁盘内容，可能和编辑器里的草稿短暂分叉。
  缓解：关联 Markdown Note 的读取、写回和冲突判断都只以已落盘内容为准；`onDidChangeTextDocument` 不驱动节点同步，只有保存或文件系统变化才刷新节点。这样可以避免节点跟随未保存草稿，但也意味着 editor 草稿不在本功能的内容权威范围内。

- 风险：写回冲突保护基于 Host 可观测的磁盘状态 revision，而不是每次写回前完整读取文件并计算内容 hash；如果外部工具刻意保留相同大小和时间戳，理论上可能绕过冲突检测。
  缓解：普通 VSCode 保存、Agent 写文件和常规 shell 写入都会改变 `mtime` / `ctime` 或文件大小；本地文件还会纳入 `dev` / `ino`。该方案避免大文件每次写回前被完整读入内存，并把完整读取收敛到首次展示、磁盘状态变化、显式重新加载和已确认冲突恢复等确实需要内容的路径。

- 风险：Webview 拖拽在 Local、Remote、浏览器化宿主或不同操作系统中的文件路径可用性不一致。
  缓解：Webview 只上报可获得的拖拽资源标识；Host 侧必须重新校验资源是否可由 Extension Host 读取、是否是文件、扩展名是否支持。无法验证时 fail closed，并给出轻量提示。

- 风险：外部文件变更监听在 workspace 外或非 `file` scheme 下可能无法提供强实时保证。
  缓解：workspace 内文件应尽量使用可靠 watcher；workspace 外文件可采用 Extension Host 可用的文件监听能力，并在 surface 激活、节点聚焦或显式重试时重新 stat/read。无论是否实时，文件不可用时都必须显示警告。

## 7. 正式方案

### 7.1 节点模型：普通 Note 与 Markdown 文件 Note 共用 Note 类型

`src/common/protocol.ts` 继续保留 `kind: 'note'`。本功能不新增独立 `markdown-note` 节点类型，而是在 `NoteNodeMetadata` 中增加内容来源信息：

```ts
interface NoteNodeMetadata {
  content: string;
  contentSource?:
    | { kind: 'embedded' }
    | {
        kind: 'markdown-file';
        resourceUri: string;
        displayPath: string;
        fullDisplayPath?: string;
        contentRevision?: string;
        status: 'ok' | 'missing' | 'not-file' | 'unsupported-extension' | 'unreadable' | 'dirty-conflict';
        lastError?: string;
        recoverableDraft?: {
          draftId: string;
          baseContentRevision?: string;
          remoteContentRevision?: string;
          updatedAt: string;
          content?: string;
        };
      };
}
```

规则：

- 省略 `contentSource` 时等价于 `{ kind: 'embedded' }`，保持历史状态兼容。
- `embedded` Note 的 `content` 仍是画布持久化中的正文权威数据。
- `embedded` Note 继续使用普通 Note 的 8,000 字符上限；Webview 在空 Note 占位提示中说明上限，并在编辑达到上限时阻止继续输入、提示用户改用 Markdown 文件。
- `markdown-file` Note 的 `content` 只表示当前 Host 已读取并发送给 Webview 的展示/编辑缓冲；文件才是权威来源。
- `markdown-file` Note 的展示/编辑缓冲不复用普通 Note 的 8,000 字符持久化截断上限；节点内编辑、checklist 切换或 Host 刷新都不能把超过 8,000 字符的 Markdown 文件截断后写回真实文件。
- `contentRevision` 表示 Host 侧最近一次确认的磁盘状态版本，默认由 `FileStat` 可观测信息生成；本地 `file:` 资源优先使用 `dev + ino + size + mtime + ctime`，其他 VSCode 文件系统资源使用 provider 暴露的 `type + size + mtime + ctime`。Webview 在开始编辑时记录该 revision 并向 Host 登记一次运行时 edit session，提交时带回；Host 在编辑期间的文件刷新或写回前若发现当前磁盘状态版本已变化，必须进入 `dirty-conflict` 而不是写回旧草稿。
- `recoverableDraft` 表示关联 Markdown Note 的未提交草稿引用。Webview 在用户编辑关联 Markdown Note 时把草稿和开始编辑时的 `baseContentRevision` 上报给 Host；Host 把草稿正文写入 extension `storageUri` 下的 `note-markdown-drafts/<draftId>.md`，画布状态只持久化 `draftId`、开始编辑时的 `baseContentRevision`、远端 revision 和更新时间。开始编辑但尚未产生冲突或正文差异时，Host 只保留内存态 edit session，不把同内容草稿写入持久化状态；一旦草稿正文已经不同于编辑基线，即使远端 revision 暂未变化，也可以以 `status: ok` + `recoverableDraft` 形式保留可恢复草稿，直到用户提交、显式清除、重新加载或覆盖文件；重新打开或刷新 Webview 时，Host 仍需 hydrate 可读草稿正文，Webview 必须恢复草稿编辑态或至少显示可处理入口，不能只渲染磁盘内容。
- `recoverableDraft.content` 只允许作为 Host 发给 Webview 的运行时 hydration 字段，用于恢复 textarea 和显示“覆盖文件”入口；写入 `canvas-state.json`、`workspaceState`、debug snapshot 或正式持久化状态前必须移除。该字段服务未解决冲突和非冲突可恢复草稿的 Webview 恢复，不能被当作文件内容权威。
- 历史状态中的 `conflictDraft` 读取时迁移为 `recoverableDraft`；如果旧状态曾内联 `conflictDraft.content`，Host 在落盘前也会把正文写回 storage draft 文件，并在 debug snapshot 与 Webview 广播中只暴露 `recoverableDraft`。新代码路径只写 `recoverableDraft`。storage draft 文件目录继续沿用 `note-markdown-drafts/`，避免升级时丢失已有草稿正文。
- 实现时不应依赖 `markdown-file` Note 的 `content` 作为文件缺失后的长期 fallback。即使持久化层因兼容需要保留最近一次 buffer，UI 也必须在文件不可用时优先显示警告状态，不能把缓存伪装成最新文件内容。
- `resourceUri` 使用 VSCode 资源 URI 字符串作为持久化身份，避免只保存本地 `fsPath` 后无法解释 Remote 或非当前工作区资源。
- `displayPath` 只服务 UI subtitle 展示；读取、写入、stat 与 watcher 必须基于 `resourceUri` 重新解析。
- `fullDisplayPath` 可选保存完整的人类可读路径，用于 hover tooltip 或不可用警告；它也不能使用 raw `vscode-remote://...` 这类实现层 URI。

主要落点：

- `src/common/protocol.ts`：扩展 `NoteNodeMetadata` 与跨边界消息 payload，包括关联文件重新加载请求，以及关联 Markdown 编辑开始/结束和草稿同步消息。
- `src/panel/CanvasPanelManager.ts`：维护关联文件读取、写入、状态恢复、watcher、运行时 edit session 与文件不可用状态。
- `src/webview/main.tsx`：根据 Note metadata 渲染 subtitle、文件不可用警告和拖拽创建入口。
- `src/extension.ts` 与 `src/panel/CanvasPanelManager.ts`：处理 Explorer Markdown 文件右键创建关联 Note 的命令入口、Host 侧文件校验、去重确认和节点创建。

### 7.2 普通 Note 转成 Markdown 文件 Note

普通 `Note` 节点新增常驻的“保存为 Markdown 并关联”动作按钮。虽然这是低频动作，但它是普通 Note 升级为文件 Note 的关键发现入口；因此第一版允许它作为普通 Note 的节点 chrome secondary button 常驻显示。关联 Markdown Note 的同一位置显示“打开文件”，避免同时出现保存与打开两个文件动作。

转换流程由 `CanvasPanelManager` 在 Extension Host 侧主导：

1. 读取当前节点标题和正文。
2. 生成默认文件名：基于 Note title 做文件名安全化；空标题回退到 `note.md`；没有 `.md` / `.markdown` 后缀时补 `.md`。
3. 生成默认路径：`<workspace root>/<safe title>.md`。多根 workspace 下，默认使用当前 workspace folder 选择规则；若无法判定，Quick Input 的初始列表应允许用户先选 workspace root 或输入绝对路径。
4. 打开路径 Quick Input。输入框显示当前候选路径；下方列表展示当前目录中的子目录和 `.md` / `.markdown` 文件。用户选择目录时进入该目录；选择 Markdown 文件时填入该文件路径；也可以直接输入新的文件名或路径。
5. 用户确认后，Host 校验扩展名、父目录可访问性和目标状态。
6. 如果目标不存在：创建文件，写入当前 Note 正文，然后把节点切换为 `markdown-file` 来源。
7. 如果目标已存在且是文件：弹出明确选择，让用户决定覆盖还是保留。
8. 如果目标是目录、扩展名不支持、父目录不存在或不可写：不改变原节点，并显示失败原因。

目标文件已存在时的选择：

- `覆盖文件并关联`：把当前普通 Note 正文写入目标 Markdown 文件，然后关联该文件。
- `保留文件内容并关联`：不写入当前 Note 正文，读取目标文件现有内容并关联。
- `取消`：保持普通 Note 不变，不写文件，不建立关联。

其中“覆盖文件并关联”是破坏性动作，应使用 `vscode.window.showWarningMessage(..., { modal: true })` 或等价强度的确认表达风险；如果最终实现选择在 Quick Input 中增加一级 Quick Pick，也必须让覆盖动作的风险文案足够明确。

### 7.3 关联 Markdown Note 的呈现与编辑

关联后的节点继续使用 Note 的窗口化表面：

- Title 仍是画布节点标题，可由用户编辑；它不必和文件名保持同步。
- Title 下方显示 subtitle，内容为 `displayPath`。
- subtitle 不显示 raw `vscode-remote://...`；raw `resourceUri` 只作为内部身份保存。
- workspace 内文件优先显示 workspace-relative path：单根 workspace 显示 `docs/plan.md`，多根 workspace 显示 `workspace-name/docs/plan.md`，workspace root 下文件只显示文件名。
- workspace 外文件显示完整人类可读路径：当前用户 home 下显示 `~/projects/foo/plan.md`，其他绝对路径显示 `/mnt/data/foo/plan.md`；Remote 资源的“当前宿主”判断与 workspace containment 分离：Host 优先通过当前 Webview 的 `asWebviewUri(file://...)` 结果推断完整 Remote authority，并只在 normalize 后的资源 URI authority 与该值一致时视为当前 Extension Host；这一步必须兼容 `ssh-remote%2Bdev_labs` 和 `ssh-remote+dev_labs` 这类编码差异，也必须兼容 Webview resource host 中 `vscode-remote%2Bssh-002dremote-...` 这种 percent-encoded separator。拖拽准入先分成 `same-workspace`、`same-host-outside-workspace`、`foreign-host` 和 `unknown-current-host`：同 workspace 文件允许创建并显示 workspace-relative path；同设备但 workspace 外文件允许创建并显示完整人类可读路径；不同设备或无法确认当前完整 Remote authority 时 fail closed，直接拒绝 drop，不进入 read/stat/write/watcher 流程。确认属于当前 Host 后，`resourceUri` 可以继续收敛并持久化为 canonical `file:` 身份，不保留 raw `vscode-remote:` 供每次重新计算。若完整 authority 暂时无法从 Webview resource URI 推断，Host 必须 fail closed：保留原 `vscode-remote:` 身份和 remote 前缀，不基于 workspace path containment、`vscode.env.remoteName` 或当前文件系统存在性做同设备推断；等首次成功推断完整 authority 后，再触发 host-side refresh / watcher resync，把确认属于当前 Host 的旧 `vscode-remote:` 资源收敛为同一个 `file:` 身份。同时诊断必须记录 probe URI、current Remote authority、raw/normalized dropped authority、准入分类与 canonical URI，便于追踪启动期与 Webview 就绪后的判定差异。不能只因为 remote kind 相同就判定同一设备；例如 `ssh-remote+dev_labs` 与 `ssh-remote+prod` 仍应优先通过完整 authority 匹配。这个 current Host canonicalization 不只用于新 drop，也必须用于已有 `resourceUri` 的去重 key、保存刷新、watcher 和后续状态更新，避免同一 Markdown 文件出现双身份。
- 长路径不在 Host 或持久化字段中按字符数预截断；subtitle 与 Agent / Terminal 一样交给标题栏布局做单行 ellipsis，实际溢出时 hover tooltip 显示同一条完整人类可读路径。
- modal、warning message 或错误提示中引用关联文件路径时，使用与 subtitle 相同的 `displayPath` 规则，避免在提示中显示 raw URI。
- subtitle 不使用链接视觉：不使用 link color、下划线或 pointer cursor；打开文件仍通过按钮或菜单完成。
- subtitle 行允许提供一个低强调的 `复制 Markdown 路径` accessory 按钮；它是路径辅助操作，不把 subtitle 本身变成链接。按钮点击时由 Webview 发送 `webview/copyTextToClipboard`，`source` 固定为 `note-markdown-subtitle`，并携带当前 `nodeId`，由 Host 统一写入系统剪贴板。
- 复制内容必须与当前标题栏对用户展示的完整人类可读路径一致：Webview 优先使用 `fullDisplayPath`，缺失时回退到 `displayPath`。因此即使标题栏因布局 ellipsis 截断，剪贴板中仍应得到同一条未截断的人类可读路径；不得复制 raw `resourceUri` 或 `vscode-remote://...`。
- 正文阅读态继续复用现有 Markdown 预览渲染能力。
- 当 Markdown 正文以合法 YAML front matter 开头时，阅读态默认隐藏 front matter，只渲染正文 body；编辑态和磁盘文件仍保留完整原文。隐藏 front matter 不能改变 `Note` 节点标题、文件 subtitle、节点状态或关联文件权威关系。
- 有 YAML front matter 的 `Note` 在标题栏 subtitle 行显示与复制路径按钮同尺寸的 `{}` icon-only metadata 按钮；若没有文件 subtitle，则按钮独占标题下方的辅助行。按钮锚定一个只读 popover，展示精简标题、解析出的 key/value 摘要，并在 popover 标题栏右侧提供复制原始 front matter 的 icon-only 按钮；popover 标题栏与正文分别沿用 Note 节点标题栏和正文 surface 的配色，是临时浮层，不改变节点尺寸、不进入正文流、不作为新的画布对象保存状态，并随当前画布缩放保持与节点一致的视觉倍率。metadata value 支持自动换行，避免长字段把 popover 横向撑开。
- YAML front matter 解析失败时，不隐藏原文；`metadata` chip 使用 warning 变体，popover 显示解析失败原因。此时预览保守保留原始 Markdown，避免把未确认的 metadata 当成已生效结论。
- 隐藏 front matter 后，checklist 预览仍必须使用原始 Markdown 行号写回；Webview 渲染时应把被隐藏 front matter 的行数作为 offset 注入任务 checkbox metadata，避免点击 checklist 改错正文行。
- 正文编辑态仍使用纯文本 Markdown 输入；提交后写回关联文件。
- 长篇编辑可通过现有或新增“打开文件”动作交给 VSCode 原生编辑器；该动作可以放在上下文菜单或低频操作菜单中。
- 如果用户在画布内编辑关联 Markdown Note 时，Host 收到同一文件的外部刷新，Webview 必须保留当前 textarea 内容并进入非阻塞冲突提示；用户仍可继续编辑草稿，但失焦或快捷提交不得静默写回真实文件，必须通过 `重新加载` 或 `覆盖文件` 显式解决。
- 如果 Host 在写回时因 `contentRevision` 不匹配拒绝旧草稿并进入 `dirty-conflict`，Webview 也必须保留本地已提交但未被 Host 接受的草稿，继续显示同一套冲突提示；不能把 Host 返回的文件当前内容当作已提交 baseline 覆盖本地草稿。
- 如果 Webview 首次接收或重新 bootstrap 时已经是 Host 持久化的 `recoverableDraft`，且 Host 能通过 `recoverableDraft.draftId` 读回草稿并把 `content` hydrate 到 Webview，则必须恢复草稿、显示冲突或恢复提示，并继续提供显式处理动作；这条规则覆盖 `dirty-conflict`、`ok` 和 `missing` / `unreadable` / `not-file` / `unsupported-extension` 等关联文件不可用状态，不能因为文件当前不可读而让草稿 UI 不可达。如果没有可用草稿内容，只显示节点内恢复卡片和 `重新加载` 恢复入口，不得渲染普通预览或允许 checklist 直接写回。若状态是 `ok` 但仍带 `recoverableDraft`，恢复入口不使用“关联文件已在外部更新”的冲突文案；若文件不可用，恢复入口必须同时保留文件不可用原因。
- 冲突提示在仍持有本地草稿或 Host 已 hydrate 的 `recoverableDraft.content` 时提供三个显式动作，并保持 textarea 可编辑：`重新加载` 会丢弃草稿并请求 Host 重新读取关联文件以恢复 `ok` 状态；`复制草稿` 会把当前草稿写入系统剪贴板，方便用户先保留内容再决定恢复；`覆盖文件` 会用当前草稿发起 `force` 写回。`覆盖文件` 是显式冲突解决动作，即使当前草稿正文已经与当前磁盘内容一致，也必须通知 Host 清理 `dirty-conflict` 与 `recoverableDraft`。没有草稿内容时只提供 `重新加载`，不提供 `复制草稿` 或 `覆盖文件`。

文件写回规则：

- 节点内编辑提交时，Host 将正文写入 `resourceUri` 对应文件。
- 写回请求必须携带编辑开始时的 `contentRevision`；Host 写入前先 `stat` 当前文件并比较磁盘状态 revision，不为了冲突检测默认读取完整文件内容。若 revision 不匹配，Host 不写文件，节点进入 `dirty-conflict`，并在此时读取当前文件内容用于冲突恢复提示；Webview 在 Host 确认写回成功前不能提前推进本地 committed baseline。
- Host 写回时直接操作磁盘文件；同一文件若在 VS Code 编辑器中有未保存草稿，这些草稿不参与 Note 的内容基线，也不会在 `onDidChangeTextDocument` 阶段驱动 Note 刷新。
- 写入失败时，节点进入 `unreadable` 或更精确的错误状态，并在正文区域显示警告。

### 7.4 关联文件变化与不可用状态

Host 是关联文件状态的权威判断者。

- 文件存在、是文件、扩展名受支持且可读时，状态为 `ok`，节点展示最新落盘内容。
- 文件被外部修改时，Host 先比较磁盘状态 revision；revision 未变化时不读取完整内容也不广播；revision 变化后才重新读取并广播最新内容。如果节点内存在未提交编辑草稿或已提交但尚未被 Host 接受的草稿，Host 必须同时判断“用户是否已编辑草稿”和“关联文件是否相对编辑基线发生变化”：`draftContent !== baseContent` 表示用户已经编辑；`latestRemoteContent !== baseContent` 或 `contentRevision` / mtime / ctime 变化表示关联 Markdown 发生变化。两者同时成立时必须提示冲突；即使用户随后把草稿改到等于 `latestRemoteContent`，冲突也不能自动消失，必须由 `重新加载` 或 `覆盖文件` 显式解决。若用户尚未编辑草稿，则外部变化可以刷新基线而不提示。
- 如果外部修改发生时 Host 已有该 Note 的未提交 `recoverableDraft`、运行时 edit session，或者 Webview 随后带旧 `baseContentRevision` 上报草稿，Host 必须把节点置为 `dirty-conflict`，把草稿正文写入 storage draft 文件，并在持久化状态中只保留 draft 引用；普通窗口切换、焦点恢复、文件 watcher 刷新不得自动把 `dirty-conflict` 改回 `ok`。
- VS Code 编辑器里尚未保存的同路径草稿不算作“文件被外部修改”；只有文件真正落盘后，Host 才会刷新 Note。
- 文件被删除、移动、替换为目录、权限变更或当前 Extension Host 不可访问时，节点进入不可用状态；删除和移动都归入 `missing`，因为用户可观察到的本质都是节点关联到一个当前不存在的路径。
- 不可用状态下，正文区域显示与无草稿 `dirty-conflict` 恢复态一致的节点内冲突卡片，而不是展示过期缓存内容作为正常正文；如果状态仍带 `recoverableDraft`，可读草稿必须优先恢复到 textarea，并提供重新加载、复制草稿、覆盖文件，草稿不可读时至少提供“发现未提交的本地草稿”的 reload-only 恢复入口。

建议警告文案结构：

```text
关联文件缺失
docs/plan.md 或 /path/to/file.md
文件可能已被移动、删除，或当前环境无权访问。
创建空文件并关联
```

`missing` 状态只提供 `创建空文件并关联` 一个节点内动作；创建后由 watcher / refresh 自动检查并恢复关联，不提供手动“重新检查”。路径复制复用标题栏 subtitle 的复制按钮，不在冲突卡片里重复提供。节点不提供“改选文件”动作；如果用户想关联到另一个文件，可以删除当前 `Note` 并拖入目标 Markdown 文件。

节点在不可用状态下仍保留：

- 节点 title。
- subtitle 文件路径。
- 删除节点能力。
- 尝试打开或自动刷新时的失败提示。

节点在不可用状态下不提供解除关联能力；用户可以删除节点并通过拖拽或普通 Note 流程重新创建。

### 7.5 拖拽 Markdown 文件到画布空白区创建关联 Note

Webview 需要在画布空白区域支持文件拖放创建关联 `Note`：

- 只有拖放到画布空白区域时触发；拖到 `Terminal` / `Agent` 节点上的既有拖放输入语义不变。
- Webview 将释放点转换为画布坐标，并把拖拽资源上报 Host。
- Host 逐个校验资源是否为可访问文件、扩展名是否为 `.md` / `.markdown`。
- Host 必须按规范化资源 URI 对单次 drop payload 去重；同一个文件即使同时通过 `resourceUrls`、`codeFiles`、`uriList` 或 `files` 等多个拖拽通道上报，本次拖放也只能创建或处理一次。
- 如果被拖拽的 Markdown 文件已经在画板上有关联 `Note`，Host 弹出 modal 让用户选择“添加新 Note”或“定位已有 Note”；选择添加时允许同一个 Markdown 文件在画板上拥有多个关联 `Note`。
- 对每个合法 Markdown 文件，在释放点附近创建一个关联 Markdown `Note`；多个文件轻微错位排列。
- 节点 title 默认保留完整文件名，例如 `design.md` -> `design.md`；如果用户把 `devSessionCanvas.noteMarkdown.stripExtensionFromDroppedFileTitle` 设为 `true`，则拖拽创建时去掉 `.md` / `.markdown` 后缀，例如 `design.md` -> `design`。该配置只影响拖拽创建的新关联 `Note` 默认标题，不重命名文件、不影响普通 `Note` 保存为 Markdown 并关联的标题保持规则，也不回改已有节点标题。
- 节点 subtitle 显示路径。
- 节点正文读取文件内容并进入 Markdown 预览态。
- 非 Markdown 文件、目录或不可访问资源不创建节点；如果全部失败，应显示轻量提示说明原因。

该能力的产品类比是：把文件拖到 Terminal 会粘贴路径；把 Markdown 文件拖到画布空白处会把这个文件投影成一个关联 `Note`。两者都不应改变被拖拽文件本身。

### 7.6 Explorer Markdown 文件右键创建关联 Note

VSCode File Explorer 需要为 Markdown 文件提供低成本创建入口：

- `package.json` 在 `contributes.commands` 中登记 `devSessionCanvas.createNoteFromExplorerMarkdown`，标题为 `Dev Session Canvas: 在 Canvas 中创建关联 Note`，图标使用 `$(markdown)`。
- `contributes.menus["explorer/context"]` 仅在 `resourceScheme == file && resourceExtname =~ /^\.(md|markdown)$/i` 时显示该入口；命令层仍必须二次校验 URI scheme、扩展名、资源存在性和普通文件类型。
- `src/extension.ts` 的命令处理只负责解析 Explorer `vscode.Uri` 并打开/定位画布；实际 Note 创建交给 `CanvasPanelManager.createNoteFromMarkdownResource(...)`，避免在扩展入口复制关联 Markdown Note 的状态规则。
- `CanvasPanelManager.createNoteFromMarkdownResource(...)` 复用现有 `readNoteMarkdownFile(...)`、`createAssociatedNoteMarkdownNode(...)`、`getAssociatedNoteMarkdownNodeIdsForResourceKey(...)` 和 `confirmExistingDroppedNoteMarkdownFile(...)`。因此右键创建与拖拽创建共享 title 规则、content revision、display path、watcher、已有 Note 定位/添加确认，以及删除节点不删除文件的语义。
- 多根 workspace 下，如果画布已有 workspace root section，右键创建优先按文件所属 workspace folder 归入对应 root section；若当前可见视口已经在某个 root section 内，则优先保留视口附近落点和该 root 归属。
- 该入口不是目录扫描器，也不扩大文件类型范围；目录、非 Markdown 文件、缺失或不可读文件均不创建节点，并给出明确提示。

### 7.7 路径、Remote 与 Workspace Trust 边界

支持范围：

- 只支持 `.md` / `.markdown`，扩展名大小写不敏感。
- 文件不要求位于当前 workspace 内，但必须来自用户显式输入、选择或拖拽。
- Host 必须用 VSCode 资源 API 或 Extension Host 可访问的文件系统能力做最终 stat/read/write 校验。
- Remote / SSH / Dev Container 下，关联文件必须是当前 Extension Host 可访问的文件；如果本机拖入的文件无法被远端 Extension Host 读取，应拒绝创建并提示。

Workspace Trust：

- 普通 `Note` 在 Restricted Workspace 下继续可用。
- Markdown 文件关联不启动进程、不执行脚本，也不应放宽执行节点限制。
- 在 Restricted Workspace 下是否允许“保存为 Markdown 并关联”和拖拽创建，可以按 VSCode 当前 API 能力与扩展安全声明保守收口；若允许，也只能处理用户显式确认的 `.md` / `.markdown` 文件，并继续执行所有 Host 侧校验。
- 任何情况下，Webview 侧的路径判断都只是用户体验优化，不能代替 Host 侧安全边界。

### 7.8 保存为模板时的关联处理

关联 Markdown `Note` 参与画布模板保存时，不能静默退化为普通 `Note`。保存模板表单在检测到关联 Markdown `Note` 后，必须逐节点展示处理策略：

- `保存为普通 Note 内容快照`：读取关联 Markdown 文件当前落盘内容，把正文写入模板；应用模板后生成普通内嵌 `Note`，不保留文件关联。
- `仅保留 workspace 相对路径`：只把当前 workspace 内的 `.md` / `.markdown` 相对路径写入模板；应用模板时自动关联对应文件，文件不存在时创建缺失状态的关联 `Note`，由节点内提示承接恢复。
- `保留 workspace 相对路径和文件内容`：把相对路径和当前落盘正文一起写入模板；应用模板时文件不存在则创建并写入内容，文件已存在但内容不同时创建关联 Markdown `Note` 并进入 `dirty-conflict`，把模板正文作为节点内可处理的冲突草稿。

三种策略对应三种产品定位：普通快照是内容型模板，保存的是 Note 正文而不是文件关系；仅相对路径是仓库文件入口型模板，保存的是当前 workspace 中某个约定 Markdown 文件的入口，文件继续作为内容权威来源；相对路径加文件内容是文件资产 / 脚手架型模板，保存的是“这个路径下应该有这份 Markdown 初始内容”，应用时可以创建文件，并在已有文件内容不同时交给节点内冲突提示处理。

只有 workspace 内文件可使用两种相对路径策略；workspace 外文件只能保存内容快照。模板不得保存 raw `resourceUri`、本机绝对路径或 `vscode-remote://...` 实现层 URI。快照和“路径+内容”策略都必须以磁盘落盘内容为输入；如果文件缺失、不可读或处于 `dirty-conflict`，保存流程不能静默使用旧 buffer。

关联 Markdown `Note` 指向的路径不存在时，不区分来源是模板 path-only 应用、文件被删除、文件被移动，还是 workspace 中暂时没有该相对路径；都统一进入“关联文件缺失”节点状态。该状态不弹 modal、不阻塞模板应用，也不自动写入 workspace；节点内只提供“创建空文件并关联”。不提供“重新检查”和“复制路径”动作：前者依赖 watcher / refresh 自动完成，后者复用 subtitle 的复制路径按钮。不提供“改选文件”动作；如果用户想关联到另一个文件，可以删除当前 `Note`，并把目标 Markdown 文件拖入画板重新创建关联 `Note`。

## 8. 验证方法

实现阶段至少需要完成以下验证：

1. 普通 `Note` 仍可创建、编辑、持久化，并且没有文件 subtitle。
2. 普通 `Note` 的空内容占位提示显示 8,000 字符上限，编辑达到上限后不能继续输入并显示提示。
3. 普通 `Note` 执行“保存为 Markdown 并关联”时，默认推荐 `<workspace root>/<title>.md`。
4. Quick Input 能在当前目录下提示子目录和 `.md` / `.markdown` 文件；选择目录会继续导航，选择 Markdown 文件会填入路径。
5. 目标文件不存在时，会创建文件、写入当前 Note 正文，并把节点切换为关联 Markdown `Note`。
6. 目标文件已存在时，用户可以选择“覆盖文件并关联”“保留文件内容并关联”或“取消”，三条路径都不产生静默覆盖。
7. 关联后 title 下方以 subtitle 显示路径，且不出现路径胶囊、链接视觉或 raw `vscode-remote://...`。
8. 关联 Markdown subtitle 的复制按钮存在时，点击后发送 `webview/copyTextToClipboard`，payload 使用 `source: "note-markdown-subtitle"` 和当前 `nodeId`；复制文本为 `fullDisplayPath ?? displayPath`，不复制 raw `resourceUri`。
9. Markdown YAML front matter 在阅读态隐藏，并通过标题栏低强调 `metadata` chip 打开只读 popover；复制 metadata 时发送 `webview/copyTextToClipboard`，payload 使用 `source: "note-markdown-metadata"` 和当前 `nodeId`。
10. 隐藏 YAML front matter 后，点击 checklist 仍按原始 Markdown 行号写回，不能改到 front matter 或正文错行。
11. 关联后文件内容是正文权威来源；外部修改文件后，节点刷新预览或在无法实时监听时于重新激活/重试后刷新。
12. 超过 8,000 字符的关联 Markdown 文件拖入、显示、编辑或 checklist 更新后，真实文件不会被普通 Note 上限截断。
13. 关联 Markdown Note 在画布内编辑期间或写回被 Host 判定为 stale revision 时，旧草稿不会静默覆盖或丢失；Host 把草稿正文放在 `storageUri/note-markdown-drafts/` 下，持久化状态只保存 draft 引用；UI 显示编辑冲突并仍允许继续编辑当前草稿，同时允许用户重新加载、复制草稿或显式覆盖；重新打开已持久化 `dirty-conflict` 但没有可读草稿内容的节点时，仍显示 `重新加载` 恢复入口，且不允许 checklist 绕过恢复直接写回。重新打开 `status: ok` 或文件不可用状态 + `recoverableDraft` 时，可读草稿必须恢复到 textarea 并提供重新加载、复制草稿、覆盖文件；若草稿正文不可读，UI 至少显示“发现未提交的本地草稿”的 reload-only 恢复卡片，并在文件不可用时保留不可用原因。
14. 关联文件缺失、被替换为目录或不可读时，节点显示文件不可用警告，不把最后一次读取内容伪装成正常正文。
15. 删除关联 Markdown `Note` 不删除关联文件。
16. 拖拽一个 `.md` / `.markdown` 文件到画布空白区，会在释放点创建关联 `Note`；默认 title 保留完整文件名，开启 `devSessionCanvas.noteMarkdown.stripExtensionFromDroppedFileTitle` 后才去掉 Markdown 扩展名；即使 `dragover` 阶段只能看到 `DataTransfer.types` 而拿不到真实路径 payload，也会允许后续 drop；拖到执行节点时不破坏既有节点拖放行为。
17. 同一个 Markdown 文件在一次拖拽中以多个资源通道重复上报，或 Host 在异步处理期间收到重复 drop 消息时，本次用户动作只创建一个关联 `Note`。
18. 已有关联 `Note` 的 Markdown 文件再次拖到画布空白区时，modal 可选择添加新的关联 `Note`，也可选择定位已有 Note。
19. 拖拽多个 Markdown 文件会创建多个轻微错位节点；拖拽非 Markdown 文件或目录不会创建节点，并有可解释提示。
20. Remote 场景下，拖拽资源必须先通过 current-host 准入：同 workspace 或同设备 workspace 外 Markdown 可以关联；不同设备或无法确认完整 current Remote authority 时直接拒绝创建，即使底层 `vscode.workspace.fs` 可能可读也不能用“可访问”替代“属于当前设备”的产品规则。
21. Explorer 中 `.md` / `.markdown` 文件右键菜单会显示 `Dev Session Canvas: 在 Canvas 中创建关联 Note`；执行后创建与拖拽路径同模型的关联 Note，已有同资源关联时先确认定位或添加，非 Markdown 文件、目录、缺失或不可读文件不会创建节点。
22. `npm run typecheck` 通过。
23. 覆盖 Note 转换流程、目标文件冲突选择、文件缺失警告、拖拽创建、Explorer Markdown 右键创建和 YAML metadata popover 的 Playwright / smoke 或纯函数测试通过。

当前验证记录（2026-05-13）：

- `npm run typecheck` 通过。
- `npm run test:note-markdown-file-association` 通过，覆盖扩展名、文件名安全化和 Remote authority 轻量前缀。
- `npm run test:webview -- --grep "associated markdown note editor|associated markdown note editing blocks|associated markdown note keeps|associated markdown note bootstrapped|ordinary note empty placeholder|associated markdown notes|missing associated markdown notes|dropping markdown files"` 通过，覆盖普通 Note 8,000 字符占位提示/编辑上限、关联 Markdown Note 不使用普通 Note 编辑上限、编辑期外部刷新、Host `dirty-conflict` 阻止旧草稿静默写回或丢失、重新 bootstrap 已持久化 `dirty-conflict` 时只提供重新加载且不渲染 checklist 预览、subtitle、完整路径警告、缺失警告和空白画布拖拽消息；空白画布拖拽覆盖 `dragover` 只暴露资源类型但 drop 才暴露真实 payload 的场景。
- `npm run test:webview -- --grep "ordinary note empty|associated markdown|missing associated markdown|ordinary note save-as-markdown|dropping markdown"` 通过，本轮重跑 9 个相关 Webview 用例，覆盖普通 Note 上限提示、关联 Markdown 渲染/编辑/冲突恢复、缺失警告、保存为 Markdown 按钮与空白画布拖拽消息。
- `npm run test:webview -- --grep "associated markdown notes render|missing associated markdown notes"` 通过，本轮覆盖关联 Markdown Note 使用完整 subtitle 文本、节点宽度不足时显示完整 tooltip，以及缺失状态继续显示同一条人类可读路径。
- `npm run test:webview -- --grep "associated markdown note (persists|restores|editing blocks|keeps|bootstrapped)"` 通过，本轮覆盖关联 Markdown Note 编辑草稿上报、外部刷新后冲突阻止旧草稿静默写回、Host `dirty-conflict` 保留被拒绝草稿引用、带已 hydrate `recoverableDraft.content` 的重新 bootstrap 恢复草稿并提供覆盖入口，以及无草稿内容 `dirty-conflict` 只提供重新加载。
- `npm run build` 通过。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 通过，覆盖真实 VSCode 宿主中的拖拽创建关联 Note、超过 8,000 字符的关联 Markdown 读取与写回不截断、打开但未保存的 VSCode editor 草稿不会改变 Note 内容且保存后才刷新、stale revision 写回进入 `dirty-conflict` 且不覆盖真实文件、`recoverableDraft` 随 `dirty-conflict` 持久化并在 `reloadPersistedStateForTest` 后保留、重新 bootstrap 持久化 `dirty-conflict` 只显示恢复警告、单次重复拖拽资源/并发消息只创建一个 Note、已关联文件再次拖入时的“添加新 Note”和“定位已有 Note”modal 分支、modal 路径复用 subtitle `displayPath`、不传入重复“取消”按钮、关联文件 `displayPath` / `fullDisplayPath`、关联文件写回、删除节点不删除文件，以及关联文件缺失后的警告状态。本轮已把该路径进一步收敛为 storage-backed draft 文件；待下次完整 smoke 时复核真实宿主中的 draft 文件内容断言。

追加验证记录（2026-05-14）：

- `npm run typecheck` 通过。
- `npm run test:webview -- --grep "associated markdown note (editing blocks|warns when an edited draft sees a file revision change|accepts a file revision change before the draft is edited|keeps|restores a persisted dirty-conflict draft|persists an edit draft)"` 通过，覆盖编辑期外部刷新提示后 textarea 仍可继续编辑、失焦不静默写回、显式覆盖携带原始 base revision、用户已编辑草稿后同内容 revision-only 变化也提示、用户尚未编辑草稿时 revision 变化只更新基线，以及已持久化 `dirty-conflict` 草稿恢复后仍可编辑。
- `npm run test:note-markdown-file-association` 通过，复核关联 Markdown 纯函数基线。
- `node --check tests/vscode-smoke/extension-tests.cjs` 通过。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 通过，覆盖真实 VSCode 宿主中 begin edit session 后外部落盘修改会在提交前进入 `dirty-conflict`，并把当前编辑态内容写入 storage-backed draft 文件。
- `git diff --check` 通过。
- `npm run typecheck && node --check tests/vscode-smoke/extension-tests.cjs && npm run test:note-markdown-file-association` 通过。
- `npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs` 和 `npm run test:webview -- --grep "associated markdown note (persists|restores|bootstrapped)"` 通过；本轮验证 storage-backed conflict draft 的 Webview 恢复入口、无内联内容的 reload-only 退化，以及 smoke 语法有效性。
- `npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs` 和 `npm run test:webview -- --grep "associated markdown note restores a persisted dirty-conflict draft"` 通过；本轮验证冲突提示里的 `复制草稿` 会向 Host 发送 `webview/copyAssociatedNoteMarkdownDraft`，并且复制后保留原有覆盖/重新加载恢复路径。
- `git diff --check`、`npm run typecheck`、`npm run test:note-markdown-file-association` 和 `npm run test:execution-terminal-clipboard` 通过；本轮文档补齐后复核格式、关联 Markdown 纯函数基线和共享剪贴板消息基线。此前本 PR 的 `npm run test:webview` 全量通过，已覆盖关联 Markdown subtitle 的 `复制 Markdown 路径` 按钮向 Host 发送 `webview/copyTextToClipboard`，复制 `fullDisplayPath ?? displayPath`，同时保留打开文件入口、长路径 tooltip 与编辑态行号回归。
- Quick Input 真实键盘导航和已有文件三选项当前仍停留在实现与代码审查层面，尚未由自动化直接模拟用户选择，因此本文验证状态保持为“验证中”。

追加验证记录（2026-05-15）：

- `npm run typecheck` 通过。
- `npm run test:execution-terminal-clipboard` 通过，覆盖 `note-markdown-metadata` 作为通用剪贴板文本来源能通过协议 validator。
- `npm run test:webview -- --grep "YAML metadata|original line numbers"` 通过，覆盖 YAML front matter 阅读态隐藏、标题栏 icon-only metadata 按钮、只读 popover、复制原始 front matter、popover 随画布缩放保持视觉倍率、metadata value 自动换行，以及隐藏 front matter 后 checklist 仍按原始 Markdown 行号写回。

追加验证记录（2026-05-16）：

- `npm run test:note-markdown-file-association` 通过，覆盖 Remote 路径显示需要完整 scheme + authority 才能判定同一设备；只有 remote kind 或 file-scheme workspace root 时按无法判定处理，保留 `ssh:设备id` 前缀且不参与 workspace-relative path 计算。
- `npm run typecheck` 通过。
- `npm run test:note-markdown-file-association`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs` 与 `git diff --check` 通过；本轮覆盖拖拽创建关联 Markdown `Note` 时默认保留完整文件名作为 title、开启 `devSessionCanvas.noteMarkdown.stripExtensionFromDroppedFileTitle` 后去掉 Markdown 扩展名，以及配置项 manifest / 本地化文案存在且默认值为 `false`。
- `npm run test:note-markdown-file-association`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`git diff --check` 与 `npm run build` 通过；本轮覆盖 Host 从 Webview resource URI 推断完整 Remote authority、当前 Remote authority 可独立于 workspace containment 隐藏 `ssh:设备id` 前缀、不同 Remote authority 继续保留前缀，且不回退到只比较 `ssh-remote` 这类 remote kind。
- `npm run test:note-markdown-file-association`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`git diff --check` 与 `npm run build` 通过；本轮复核已有 `vscode-remote:` 关联 Note 与新 drop 得到的 `file:` URI 会共用 current Host canonical resource key，保存刷新与 watcher 入口也使用同一 canonical URI，并在刷新/写回状态时把当前 Host `resourceUri` 收敛到 canonical 身份。
- `npm run test:note-markdown-file-association`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`git diff --check` 与 `npm run build` 通过；本轮补充 Remote authority normalize，覆盖 `ssh-remote%2Bdev_labs` 与 `ssh-remote+dev_labs` 的同源匹配；完整 authority 不可得时继续 fail closed，禁止 workspace-contained / same remote kind + filesystem existence fallback，并补充首次成功推断 current Remote authority 后主动触发 host-side refresh / watcher resync 以及 Markdown 诊断导出的回归断言。
- `npm run test:note-markdown-file-association`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`git diff --check` 与 `npm run build` 通过；本轮根据导出诊断补齐 Webview probe authority 的 percent decode，覆盖 `vscode-remote%2Bssh-002dremote-002bdev-005flabs.vscode-resource...` 能正确提取为 `ssh-remote+dev_labs`。
- `npm run test:note-markdown-file-association`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`git diff --check` 与 `npm run build` 通过；本轮补齐拖拽准入分类，覆盖 drop 入口在 read/stat/write 前先区分 same-workspace、same-host-outside-workspace、foreign-host 与 unknown-current-host，foreign-host / unknown-current-host 直接拒绝，不再让 raw `vscode-remote:` 进入文件流程。

追加验证记录（2026-05-24）：

- `npm run typecheck`、`npm run test:webview -- --grep "associated markdown note (restores a persisted ok recoverable draft|bootstrapped with ok recoverable draft|restores a persisted dirty-conflict draft|bootstrapped with dirty-conflict shows reload recovery only)"`、`git diff --check`、`node --check tests/vscode-smoke/extension-tests.cjs` 和 `npm run test:note-markdown-file-association` 通过；本轮补齐 `status: ok` + `recoverableDraft` 重新 bootstrap 的 Webview 恢复矩阵，覆盖可读草稿恢复 textarea、非冲突文案、复制/覆盖入口，以及草稿正文不可读时的 reload-only 恢复卡片和 checklist 写回阻断。
- `npm run typecheck`、`npm run test:note-markdown-file-association`、`npm run test:canvas-templates`、`node --check tests/vscode-smoke/extension-tests.cjs`、`npm run test:webview -- --grep "associated markdown note (persists an edit draft|clears a reverted edit draft|warns when an edited draft sees a file revision change|keeps a rejected stale draft|restores a persisted dirty-conflict draft|bootstrapped with dirty-conflict shows reload recovery only)"`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke`、`npm run test:vsix-smoke` 和 `git diff --check` 通过；本轮把关联 Markdown 草稿字段从旧 `conflictDraft` 收敛为 `recoverableDraft`，覆盖旧字段读取迁移、旧内联正文写入 storage draft 文件、debug/Webview 不再输出旧字段、模板冲突路径继续带 runtime-only `recoverableDraft.content`，以及真实 VSCode / packaged VSIX smoke 下的草稿迁移与恢复路径。

追加验证记录（2026-06-07）：

- `npm run test:extension-manifest` 通过，覆盖 Explorer Markdown Note 命令注册、`$(markdown)` 图标和 `resourceExtname` 右键菜单条件。
- `npm run typecheck` 通过，覆盖 `src/extension.ts` 与 `src/panel/CanvasPanelManager.ts` 新增 Host 创建入口的类型一致性。
- `npm run test:note-markdown-file-association` 通过，复核关联 Markdown 文件准入与 title 规则。
- `node --check tests/vscode-smoke/extension-tests.cjs` 通过，新增真实宿主 smoke 断言覆盖 Explorer Markdown 命令复用已有 Note 定位/添加确认、读取文件内容和 title 规则。
- `git diff --check` 通过。
- 真实 VSCode smoke 尚未在本轮重跑；Explorer 右键创建关联 Note 的端到端行为已补测试断言但仍待真实宿主执行复核。
