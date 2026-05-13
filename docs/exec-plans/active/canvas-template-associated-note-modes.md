# 关联 Markdown Note 的模板保存策略

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本文遵循 `docs/PLANS.md` 的要求；仓库中的 `ExecPlan` 必须自包含、持续更新，并导向可验证的工作结果。

## 目标与全局图景

用户在画布中把 `Note` 关联到真实 Markdown 文件后，再保存为模板时，不应被静默降级成普通 `Note`。本次变更让保存模板表单在存在关联 Markdown `Note` 时展示每个节点的处理策略：保存为普通内容快照、仅保存 workspace 相对路径、保存相对路径和文件内容，或不保存该节点。完成后，用户可以明确决定模板是在复用仓库里的已有 Markdown 文件入口，还是把 Markdown 文件内容作为模板资产一起带走；应用模板时，如果需要创建文件或处理已有文件冲突，宿主会给出明确提示，而不是静默覆盖或静默丢失关联。

## 进度

- [x] (2026-05-14 09:40 +0800) 已将当前工作 rebase 到 `e31bed9962f449ed280753e089adcb8e0e25b6b2` 后方，并从 rebased HEAD 新建 `canvas-template-note-file-modes` 分支；原有未跟踪图片文件保持未触碰。
- [x] (2026-05-14 10:05 +0800) 已创建本计划，明确关联 Markdown `Note` 保存为模板时的用户可选策略和应用时文件处理边界。
- [x] (2026-05-14 10:22 +0800) 已更新正式设计与产品规格文档，把关联 Markdown `Note` 的模板保存策略写入 `docs/design-docs/canvas-template-feature.md`、`docs/design-docs/note-markdown-file-association.md`、`docs/product-specs/canvas-template-feature.md` 与 `docs/design-docs/index.md`。
- [x] (2026-05-14 10:48 +0800) 已扩展模板数据模型，支持 `embedded-snapshot`、`workspace-file-path-only`、`workspace-file-with-content` 三种 `Note` 内容模式，并保持旧模板兼容。
- [x] (2026-05-14 11:00 +0800) 已扩展保存模板表单，只有在当前画布存在关联 Markdown `Note` 时显示策略选择区；表单提交后把每个关联 `Note` 的选择传给宿主。
- [x] (2026-05-14 11:15 +0800) 已实现保存时的策略落地：快照策略读取磁盘内容，路径策略只保存 workspace 相对路径，带内容策略保存相对路径和文件内容，跳过策略排除节点及其相关边。
- [x] (2026-05-14 11:32 +0800) 已实现应用模板时的文件处理：路径-only 自动关联已有文件，缺失时提示创建空文件或保留缺失关联；路径+内容在缺失时创建文件，已有内容冲突时提示使用现有内容、覆盖或另存为新文件。
- [x] (2026-05-14 11:46 +0800) 已增加脚本测试和保存表单源码断言，并运行 `npm run typecheck`、`npm run test:canvas-templates`；`npm run test:webview` 中 144/145 通过，剩余 1 个既有基线截图差异需后续确认。

## 意外与发现

- 观察：`npm run test:webview` 只有首个 baseline screenshot 失败，差异集中在已有画布 Note 顶部动作文字区域，比例 0.01%，其余 144 个 Webview 用例通过。
  证据：Playwright 输出 `1 failed ... canvas-shell-baseline.png`，并报告 `144 passed (4.5m)`；失败 artifact 位于 `.debug/playwright/results/webview-harness-webview-bu-f97a0-hes-the-baseline-screenshot/`。

- 观察：执行 rebase 时 `src/webview/main.tsx` 出现一次冲突，冲突点是 `note-markdown-sync-rework` 新增的关联 Markdown 冲突草稿持久化逻辑与当前分支新增的 Note 视觉行测量逻辑相邻。
  证据：`git rebase --onto e31bed9962f449ed280753e089adcb8e0e25b6b2 6b36f72... HEAD` 在应用 `b5a08e6` 时冲突；已手动保留两边逻辑并继续 rebase。

## 决策记录

- 决策：保存模板时把关联 Markdown `Note` 的策略显式交给用户选择，而不是继续静默保存当前 buffer 并在应用时变成普通 `Note`。
  理由：关联 Markdown `Note` 的权威来源是文件，静默保存 buffer 会让用户误以为模板保留了文件关联，也可能在文件不可用或冲突时保存非权威内容。
  日期/作者：2026-05-14 / Codex。

- 决策：workspace 文件关联只保存规范化的 workspace 相对路径，不保存 raw `resourceUri`、本机绝对路径或 `vscode-remote://...` 这类实现层 URI。
  理由：模板是可分享资产；绝对路径和 raw URI 容易跨机器失效，也可能泄露用户本机路径信息。workspace 相对路径能表达“这个模板依赖当前仓库中的文件”。
  日期/作者：2026-05-14 / Codex。

- 决策：把“保留 workspace 相对文件关联”拆成“仅相对路径”和“相对路径 + 文件内容”两种模板内容模式。
  理由：前者表达模板引用仓库已有文件，后者表达模板携带 Markdown 文件资产并可在应用时创建文件；两者的冲突处理、隐私边界和导出风险都不同。
  日期/作者：2026-05-14 / Codex。

## 结果与复盘

本轮已完成主体实现：保存模板表单会为关联 Markdown `Note` 展示策略选择，模板模型能表达普通快照、仅相对路径和相对路径加内容，保存路径会按用户选择读取磁盘内容或跳过节点，应用路径会自动关联、创建文件或在冲突时提示使用现有文件、覆盖或另存。目标测试 `npm run typecheck` 与 `npm run test:canvas-templates` 通过；`npm run test:webview` 仅剩首个 baseline screenshot 视觉差异，需后续判断是否接受并更新快照。

## 上下文与定向

本仓库是 VS Code 扩展。画布状态中的节点类型定义在 `src/common/protocol.ts`，其中 `NoteNodeMetadata` 包含 `content` 和可选 `contentSource`。普通 `Note` 没有 `contentSource` 或 `contentSource.kind === 'embedded'`，正文权威数据存储在画布状态；关联 Markdown `Note` 使用 `contentSource.kind === 'markdown-file'`，`resourceUri` 指向真实 `.md` 或 `.markdown` 文件，`content` 只是宿主读取后发给 Webview 的展示和编辑缓冲。

模板功能的共享模型在 `src/common/canvasTemplates.ts`。当前模板节点只允许 `agent`、`terminal`、`note`，`Note` 模板只保存 `metadata.note.content`。模板保存入口在 `src/extension.ts` 的 `saveCurrentCanvasAsTemplateFromCommand()`，它打开 `src/panel/CanvasTemplateSaveFormPanel.ts` 中的保存表单，再调用 `CanvasPanelManager.saveCurrentCanvasAsTemplate()`。模板应用路径在 `src/panel/CanvasPanelManager.ts` 的 `applyCanvasTemplateRecord()`，它调用 `applyCanvasTemplateToState()` 和 `materializeTemplateNode()` 把模板节点重新物化成画布节点。

本次任务中，“workspace 相对路径”指相对于当前 VS Code workspace folder 的路径，例如单根 workspace 中的 `docs/plan.md`，或多根 workspace 中带 folder name 前缀的 `repo-a/docs/plan.md`。路径必须是相对路径，不能是绝对路径，不能包含 `..` 越出 workspace，且只能指向 `.md` 或 `.markdown` 文件。

## 工作计划

第一步更新正式文档。`docs/design-docs/canvas-template-feature.md` 的模板模型与保存语义需要说明关联 Markdown `Note` 的四种保存策略。`docs/design-docs/note-markdown-file-association.md` 需要说明关联 Markdown `Note` 在保存为模板时不再只有静默快照路径。`docs/product-specs/canvas-template-feature.md` 需要补充用户流程和模板内容范围。

第二步扩展共享模板模型。在 `src/common/canvasTemplates.ts` 增加 `CanvasTemplateNoteContentMode`，允许 `metadata.note.templateContentMode` 为 `embedded-snapshot`、`workspace-file-path-only` 或 `workspace-file-with-content`。旧模板没有该字段时按 `embedded-snapshot` 解析。新增保存选择类型，允许宿主在捕获模板时按节点 id 传入 `embedded-snapshot`、`workspace-file-path-only`、`workspace-file-with-content` 或 `skip`；`skip` 不写入模板节点，并让相关边自然被过滤。

第三步扩展保存表单。`CanvasTemplateSaveFormPanel` 新增 `associatedNoteNodes` 输入，每个条目包含 node id、标题、显示路径、是否在 workspace 内、当前文件状态和默认策略。表单只在 save 模式且存在条目时显示“关联 Markdown Notes”区域。每行一个下拉框；workspace 内文件可选路径-only 和路径+内容，workspace 外文件只能选快照或不保存。提交 payload 增加 `associatedNoteModes`。

第四步实现宿主保存逻辑。`CanvasPanelManager` 增加方法构建保存表单需要的关联 `Note` 条目。保存提交后，`saveCurrentCanvasAsTemplate()` 根据用户策略读取磁盘文件或保存相对路径。快照和路径+内容策略在文件状态为 `ok` 时读取磁盘落盘内容；路径-only 不保存正文。文件缺失、不可读或 dirty-conflict 时不得静默保存旧 buffer，而是抛出带中文说明的错误，提示用户先恢复文件或选择不保存该节点。

第五步实现应用逻辑。应用模板前，`applyCanvasTemplateRecord()` 异步解析模板中的 workspace 文件 `Note`。路径-only：文件存在则读取并关联；文件不存在则提示创建空文件或保留缺失关联。路径+内容：文件不存在则创建父目录和文件并写入模板内容；文件存在且内容相同则关联；文件存在但内容不同则提示使用现有文件或覆盖为模板内容。完成解析后，把每个模板 note index 对应的 `content` 和 `contentSource` 传给 `applyCanvasTemplateToState()`，由物化逻辑创建真正的关联 Markdown `Note`。

第六步补测试。`scripts/test-canvas-templates.mjs` 应覆盖：旧模板继续解析；关联 `Note` 快照模式、路径-only、路径+内容、skip 捕获；路径模式模板 JSON 不含 raw resource URI；应用时能物化关联 `Note` metadata。保存表单源码断言应覆盖新增 section 和 payload 字段。必要时补充 Webview harness 测试以确认表单 UI 不影响导入模式。

## 具体步骤

在仓库根目录执行以下命令进行验证：

    npm run test:canvas-templates
    npm run typecheck

若修改触及 Webview 表单 DOM 或主要交互，还应运行：

    npm run test:webview

当前已执行的版本控制步骤：

    base=$(git merge-base HEAD e31bed9962f449ed280753e089adcb8e0e25b6b2)
    git rebase --onto e31bed9962f449ed280753e089adcb8e0e25b6b2 "$base" HEAD
    git switch -c canvas-template-note-file-modes

## 验证与验收

验收标准如下：当画布中没有关联 Markdown `Note` 时，保存模板流程与当前一致；当存在关联 Markdown `Note` 时，保存表单出现策略选择区。选择“保存为普通 Note 内容快照”后，模板应用回来是普通 `Note`；选择“仅保留 workspace 相对路径”后，模板 JSON 只包含相对路径，应用时关联当前 workspace 中的对应文件；选择“保留相对路径和文件内容”后，模板 JSON 包含相对路径和 Markdown 正文，应用时可在文件缺失时创建文件，已有文件冲突时提示处理；选择“不保存此 Note”后，该节点和相关边不进入模板。

自动化验证需要证明旧模板兼容、新模板字段解析和捕获正确、应用模板时能生成期望的 `contentSource`。`npm run test:canvas-templates` 必须通过；`npm run typecheck` 必须通过。如果未运行完整 `npm test`，最终说明中需要明确剩余验证缺口。

## 幂等性与恢复

文档和源码修改可以重复应用。rebase 已完成并新建分支；若后续需要恢复到 rebase 前的原始分支，原分支 `fix-note-line-number-view-rows` 仍保留在本地。保存模板的实现不得删除用户 Markdown 文件；应用模板时只有用户选择覆盖，或文件不存在且模式要求自动创建时，才会写 workspace 文件。路径-only 缺失场景允许保留缺失关联，以避免强制创建用户不想要的文件。

## 证据与备注

rebase 后的短日志应包含以下顺序，证明当前分支建立在用户指定提交之后：

    * 6646a4f feat(note): 支持复制关联 Markdown 路径
    * 139e093 fix(note): 按视觉行对齐编辑态行号
    * e31bed9 feat(note): 完善关联 Markdown 冲突草稿恢复

当前工作树仍有用户既有未跟踪图片文件：`image.png`、`image copy.png`、`image copy 2.png`、`image copy 3.png`、`image copy 6.png`。本计划不触碰这些文件。

## 接口与依赖

在 `src/common/canvasTemplates.ts` 中新增模板 note 内容模式和保存选择类型。`captureCanvasTemplateFromState()` 需要接受一个可选的关联 note 保存选择 map，并据此生成模板节点或跳过节点。`applyCanvasTemplateToState()` 需要接受一个可选的 note materialization map，让宿主传入已经解析好的关联文件内容和 `contentSource`。

在 `src/panel/CanvasPanelManager.ts` 中新增 workspace 相对 Markdown 文件解析、读取、创建、冲突确认和 materialization 准备函数。这些函数必须复用现有 `readNoteMarkdownFile()`、`writeNoteMarkdownFile()`、`statNoteMarkdownFile()`、`formatNoteMarkdownDisplayPathInfo()` 和 `createNoteMarkdownFileStatRevision()`，避免新增第二套文件状态语义。

在 `src/panel/CanvasTemplateSaveFormPanel.ts` 中新增保存表单关联 `Note` section 和 message payload 字段。表单 JS 只负责收集用户选择，不直接读取文件或判断磁盘状态；所有文件 I/O 仍在 Extension Host 中完成。


修订记录：2026-05-14 / Codex：完成代码、文档与测试验证记录，补充 Webview screenshot 残余风险。
