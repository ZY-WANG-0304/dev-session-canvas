# File Explorer Markdown 右键创建 Note 规格

当前状态：已确认，验证中。本文收口从 VSCode File Explorer 的 Markdown 文件右键，在 Dev Session Canvas 中创建关联 Markdown 文件的 `Note` 节点的产品范围与验收口径。关联文件的内容权威、状态刷新、冲突处理和拖拽创建规则继续以 `docs/design-docs/note-markdown-file-association.md` 为准；本规格只补齐 Explorer 快捷入口。

## 1. 用户问题

开发者在 Explorer 中看到某个 `.md` / `.markdown` 文件时，常常想把它作为画布上的协作上下文纸面固定下来。目前用户需要先打开画布，再把文件拖到画布空白区，或者先创建普通 Note 后再保存/关联，路径较绕。Explorer 已经表达了明确文件上下文，系统应允许用户直接从该 Markdown 文件创建关联 `Note`。

## 2. 目标用户

目标用户是在 VSCode workspace 内使用 Dev Session Canvas 组织 Agent、Terminal 与 Note 的开发者。他们会把需求、计划、会议纪要、ADR、发布检查清单等 Markdown 文件作为多 Agent 协作上下文，并希望低成本把这些文件固定到画布中。

## 3. 核心用户流程

1. 用户在 VSCode File Explorer 中右键点击 `.md` 或 `.markdown` 文件。
2. 用户选择“Dev Session Canvas: 从 Markdown 创建 Note”。
3. 扩展打开或定位画布，读取该 Markdown 文件内容。
4. 若该文件尚未关联到已有 Note，画布创建一个 `Note` 节点；节点标题默认来自文件名，正文来自文件内容，`metadata.note.contentSource.kind` 为 `markdown-file`。
5. 若该文件已有关联 Note，系统复用现有确认流程，让用户选择定位已有 Note 或添加新的关联 Note。
6. 新建 Note 会被聚焦；关联后的文件刷新、打开文件、缺失状态与冲突处理继续沿用现有关联 Markdown Note 行为。

## 4. 在范围内

- Explorer 右键入口：
  - 在 `explorer/context` 中仅对 `file` scheme 且扩展名为 `.md` / `.markdown` 的资源暴露创建关联 Note 命令。
  - 命令层仍会二次校验参数是 `file` URI、路径扩展名受支持、资源存在且是普通文件。
- Note 创建语义：
  - 复用现有关联 Markdown Note 模型，不新增 `markdown-note` 节点类型。
  - 不强制文件位于当前 workspace；workspace 外 `file` 资源如果由用户显式触发命令，继续沿用关联 Markdown Note 的路径显示与可访问性规则。
  - 文件内容读取、content revision、display path、watcher、dirty-conflict、missing 状态和删除节点不删除文件等规则，沿用 `docs/design-docs/note-markdown-file-association.md`。
  - 创建后的 Note 标题默认与拖拽 Markdown 文件创建一致，受 `devSessionCanvas.noteMarkdown.stripExtensionFromDroppedFileTitle` 配置影响。
- 已有关联文件：
  - 如果同一 Markdown 资源已经被 Note 关联，系统不静默创建重复节点；先让用户确认“定位已有 Note”或“添加新 Note”。
- 多根 workspace：
  - 如果当前画布存在 workspace root section，命令优先把 Note 创建到该 Markdown 文件所属 root section 内。
  - 若当前可见视口已经位于某个 root section 内，优先保留视口附近落点和该 root 归属。
  - workspace 外文件在多根组合画布中只有当前视口可判定目标 root section 时才创建到该 section；否则不创建并提示用户先进入目标 root section。
- 失败反馈：
  - 非 Markdown 文件、目录、资源不存在、不可读或不支持的 URI 不创建节点，并给出明确提示。

## 5. 不在范围内

- 从 Explorer 目录右键批量扫描并创建多个 Note。
- 支持 `.txt`、`.rst`、`.adoc` 或任意文本文件。
- 为普通 Note 创建新的文件选择器或改写现有“保存为 Markdown 并关联”流程。
- 支持虚拟文件系统或非 `file` scheme Explorer 资源作为第一版快捷入口；用户仍可通过现有关联 Markdown Note 的显式路径/拖拽能力处理更复杂来源。
- 解除关联、改选文件或删除 Note 时删除源 Markdown 文件。

## 6. 关键对象与状态

- Explorer Markdown 资源 URI：命令参数中的 `vscode.Uri`。
- Markdown 文件准入状态：scheme、扩展名、文件类型、读取状态。
- 关联 Note 节点：`kind: 'note'`、`metadata.note.content`、`metadata.note.contentSource`。
- Markdown 资源去重 key：与拖拽创建相同的 canonical resource key。
- 多根 root section 归属：文件所属 workspace folder 与当前可见视口所在 root section。

## 7. 验收标准

- Markdown 文件右键菜单中出现“Dev Session Canvas: 从 Markdown 创建 Note”，非 Markdown 文件不出现该入口。
- 对 `.md` / `.markdown` 文件执行命令后，画布创建 `Note` 节点；其 `metadata.note.contentSource.kind` 等于 `markdown-file`，`resourceUri` 指向该文件，正文等于文件内容。
- 新 Note 标题与拖拽 Markdown 文件创建规则一致，并遵循 `devSessionCanvas.noteMarkdown.stripExtensionFromDroppedFileTitle`。
- 同一 Markdown 文件已有对应 Note 时，再次执行命令会弹出现有确认流程；选择定位时不创建重复 Note，选择添加时创建第二个关联 Note。
- 多根 workspace 中，对某个 root 内 Markdown 文件执行命令后，新 Note 归属于该 root section；单独打开该 root 时能看到对应 root-local Note。
- 对目录、缺失文件、非 Markdown 文件、不可读文件、非 `file` scheme 资源，或多根组合画布中无法判定目标 root section 的 workspace 外文件执行命令时，不创建节点并显示明确提示。

## 8. 开放问题

暂无。后续若要支持目录批量创建或非 `file` scheme 资源，应单独补规格与设计，不把第一版快捷入口泛化为 Markdown 文件管理器。
