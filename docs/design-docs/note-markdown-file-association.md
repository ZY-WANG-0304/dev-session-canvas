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
related_plans:
  - docs/exec-plans/active/note-markdown-file-association.md
updated_at: 2026-05-13
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

- 风险：文件在 VSCode 编辑器中已打开且有未保存修改时，直接 `workspace.fs.writeFile` 会绕过用户正在编辑的 dirty buffer。
  缓解：宿主写入前必须检查已打开文档；若目标文档 dirty，应优先通过 VSCode 文档编辑模型或先提示冲突，不能静默覆盖磁盘文件。

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
        status: 'ok' | 'missing' | 'not-file' | 'unsupported-extension' | 'unreadable' | 'dirty-conflict';
        lastError?: string;
      };
}
```

规则：

- 省略 `contentSource` 时等价于 `{ kind: 'embedded' }`，保持历史状态兼容。
- `embedded` Note 的 `content` 仍是画布持久化中的正文权威数据。
- `markdown-file` Note 的 `content` 只表示当前 Host 已读取并发送给 Webview 的展示/编辑缓冲；文件才是权威来源。
- 实现时不应依赖 `markdown-file` Note 的 `content` 作为文件缺失后的长期 fallback。即使持久化层因兼容需要保留最近一次 buffer，UI 也必须在文件不可用时优先显示警告状态，不能把缓存伪装成最新文件内容。
- `resourceUri` 使用 VSCode 资源 URI 字符串作为持久化身份，避免只保存本地 `fsPath` 后无法解释 Remote 或非当前工作区资源。
- `displayPath` 只服务 UI subtitle 展示；读取、写入、stat 与 watcher 必须基于 `resourceUri` 重新解析。
- `fullDisplayPath` 可选保存完整的人类可读路径，用于 hover tooltip 或不可用警告；它也不能使用 raw `vscode-remote://...` 这类实现层 URI。

主要落点：

- `src/common/protocol.ts`：扩展 `NoteNodeMetadata` 与跨边界消息 payload。
- `src/panel/CanvasPanelManager.ts`：维护关联文件读取、写入、状态恢复、watcher 与文件不可用状态。
- `src/webview/main.tsx`：根据 Note metadata 渲染 subtitle、文件不可用警告和拖拽创建入口。

### 7.2 普通 Note 转成 Markdown 文件 Note

普通 `Note` 节点新增“保存为 Markdown 并关联”动作。入口可以放在节点上下文菜单、命令面板或节点动作菜单中；不应为了这个低频动作在节点 chrome 上增加显著常驻按钮。

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
- workspace 外文件显示人类可读压缩路径：当前用户 home 下显示 `~/projects/foo/plan.md`，其他绝对路径显示 `/mnt/data/foo/plan.md`；Remote 只在 workspace 外等必要场景加轻量前缀，例如 `ssh:dev_labs · ~/projects/foo/plan.md`，不暴露 `ssh-remote+dev_labs`。
- 长路径在 subtitle 中做中间省略，保留文件名和最近目录，例如 `…/test-branch/Note 2.md`。
- modal、warning message 或错误提示中引用关联文件路径时，使用与 subtitle 相同的 `displayPath` 规则，避免在短提示框中显示 raw URI 或完整绝对路径。
- subtitle 不使用链接视觉：不使用 link color、下划线或 pointer cursor；打开文件仍通过按钮或菜单完成。hover tooltip 如需显示完整路径，也显示人类可读路径而不是 raw URI。
- 正文阅读态继续复用现有 Markdown 预览渲染能力。
- 正文编辑态仍使用纯文本 Markdown 输入；提交后写回关联文件。
- 长篇编辑可通过现有或新增“打开文件”动作交给 VSCode 原生编辑器；该动作可以放在上下文菜单或低频操作菜单中。

文件写回规则：

- 节点内编辑提交时，Host 将正文写入 `resourceUri` 对应文件。
- 如果关联文件在 VSCode 中已有 dirty 文档，Host 不能绕过 dirty buffer 静默写磁盘；应通过文档编辑模型更新该文档，或提示用户先处理冲突。
- 写入失败时，节点进入 `unreadable` 或更精确的错误状态，并在正文区域显示警告。

### 7.4 关联文件变化与不可用状态

Host 是关联文件状态的权威判断者。

- 文件存在、是文件、扩展名受支持且可读时，状态为 `ok`，节点展示最新读取内容。
- 文件被外部修改时，Host 应重新读取并广播最新内容；如果节点内存在未提交编辑草稿，则不能静默覆盖草稿，应提示用户文件已变化并要求用户重新确认。
- 文件被删除、移动、替换为目录、权限变更或当前 Extension Host 不可访问时，节点进入不可用状态。
- 不可用状态下，正文区域显示警告，而不是展示过期缓存内容作为正常正文。

建议警告文案结构：

```text
关联的 Markdown 文件不可用
/path/or/uri/to/file.md
文件可能已被移动、删除，或当前环境无权访问。
```

节点在不可用状态下仍保留：

- 节点 title。
- subtitle 文件路径。
- 删除节点能力。
- 尝试打开或重新读取时的失败提示。

节点在不可用状态下不提供解除关联能力；用户可以删除节点并通过拖拽或普通 Note 流程重新创建。

### 7.5 拖拽 Markdown 文件到画布空白区创建关联 Note

Webview 需要在画布空白区域支持文件拖放创建关联 `Note`：

- 只有拖放到画布空白区域时触发；拖到 `Terminal` / `Agent` 节点上的既有拖放输入语义不变。
- Webview 将释放点转换为画布坐标，并把拖拽资源上报 Host。
- Host 逐个校验资源是否为可访问文件、扩展名是否为 `.md` / `.markdown`。
- Host 必须按规范化资源 URI 对单次 drop payload 去重；同一个文件即使同时通过 `resourceUrls`、`codeFiles`、`uriList` 或 `files` 等多个拖拽通道上报，本次拖放也只能创建或处理一次。
- 如果被拖拽的 Markdown 文件已经在画板上有关联 `Note`，Host 弹出 modal 让用户选择“继续添加新 Note”或“定位已关联 Note”；选择继续添加时允许同一个 Markdown 文件在画板上拥有多个关联 `Note`。
- 对每个合法 Markdown 文件，在释放点附近创建一个关联 Markdown `Note`；多个文件轻微错位排列。
- 节点 title 默认取文件名去扩展名，例如 `design.md` -> `design`。
- 节点 subtitle 显示路径。
- 节点正文读取文件内容并进入 Markdown 预览态。
- 非 Markdown 文件、目录或不可访问资源不创建节点；如果全部失败，应显示轻量提示说明原因。

该能力的产品类比是：把文件拖到 Terminal 会粘贴路径；把 Markdown 文件拖到画布空白处会把这个文件投影成一个关联 `Note`。两者都不应改变被拖拽文件本身。

### 7.6 路径、Remote 与 Workspace Trust 边界

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

## 8. 验证方法

实现阶段至少需要完成以下验证：

1. 普通 `Note` 仍可创建、编辑、持久化，并且没有文件 subtitle。
2. 普通 `Note` 执行“保存为 Markdown 并关联”时，默认推荐 `<workspace root>/<title>.md`。
3. Quick Input 能在当前目录下提示子目录和 `.md` / `.markdown` 文件；选择目录会继续导航，选择 Markdown 文件会填入路径。
4. 目标文件不存在时，会创建文件、写入当前 Note 正文，并把节点切换为关联 Markdown `Note`。
5. 目标文件已存在时，用户可以选择“覆盖文件并关联”“保留文件内容并关联”或“取消”，三条路径都不产生静默覆盖。
6. 关联后 title 下方以 subtitle 显示路径，且不出现路径胶囊、链接视觉或 raw `vscode-remote://...`。
7. 关联后文件内容是正文权威来源；外部修改文件后，节点刷新预览或在无法实时监听时于重新激活/重试后刷新。
8. 关联文件缺失、被替换为目录或不可读时，节点显示文件不可用警告，不把最后一次读取内容伪装成正常正文。
9. 删除关联 Markdown `Note` 不删除关联文件。
10. 拖拽一个 `.md` / `.markdown` 文件到画布空白区，会在释放点创建关联 `Note`；拖到执行节点时不破坏既有节点拖放行为。
11. 同一个 Markdown 文件在一次拖拽中以多个资源通道重复上报，或 Host 在异步处理期间收到重复 drop 消息时，本次用户动作只创建一个关联 `Note`。
12. 已有关联 `Note` 的 Markdown 文件再次拖到画布空白区时，modal 可选择继续添加新的关联 `Note`，也可选择定位已关联 `Note`。
13. 拖拽多个 Markdown 文件会创建多个轻微错位节点；拖拽非 Markdown 文件或目录不会创建节点，并有可解释提示。
14. Remote 场景下，Host 无法访问的拖拽资源 fail closed；workspace 外但 Host 可访问的 Markdown 文件可以关联。
15. `npm run typecheck` 通过。
16. 覆盖 Note 转换流程、目标文件冲突选择、文件缺失警告和拖拽创建的 Playwright / smoke 或纯函数测试通过。

当前验证记录（2026-05-13）：

- `npm run typecheck` 通过。
- `npm run test:note-markdown-file-association` 通过，覆盖扩展名、文件名安全化、display path 中间省略和 Remote authority 轻量前缀。
- `npm run test:webview -- --grep "associated markdown notes|missing associated markdown notes|dropping markdown files"` 通过，覆盖 subtitle、完整路径警告、缺失警告和空白画布拖拽消息。
- `npm run build && DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过，覆盖真实 VSCode 宿主中的拖拽创建关联 Note、单次重复拖拽资源/并发消息只创建一个 Note、已关联文件再次拖入时的“继续添加新 Note”和“定位已关联 Note”modal 分支、modal 路径复用 subtitle `displayPath`、不传入重复“取消”按钮、关联文件 `displayPath` / `fullDisplayPath`、关联文件写回、删除节点不删除文件，以及关联文件缺失后的警告状态。
- Quick Input 真实键盘导航和已有文件三选项当前仍停留在实现与代码审查层面，尚未由自动化直接模拟用户选择，因此本文验证状态保持为“验证中”。
