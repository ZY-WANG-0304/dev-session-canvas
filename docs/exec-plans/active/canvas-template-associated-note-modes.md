# 关联 Markdown Note 的模板保存策略

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本文遵循 `docs/PLANS.md` 的要求；仓库中的 `ExecPlan` 必须自包含、持续更新，并导向可验证的工作结果。

## 目标与全局图景

用户在画布中把 `Note` 关联到真实 Markdown 文件后，再保存为模板时，不应被静默降级成普通 `Note`。本次变更让保存模板表单在存在关联 Markdown `Note` 时展示每个节点的处理策略：保存为普通内容快照、仅保存 workspace 相对路径、保存相对路径和文件内容。完成后，用户可以明确决定模板是在复用仓库里的已有 Markdown 文件入口，还是把 Markdown 文件内容作为模板资产一起带走；应用模板时，如果需要创建文件或处理已有文件冲突，宿主会给出明确提示，而不是静默覆盖或静默丢失关联。

## 进度

- [x] (2026-05-14 09:40 +0800) 已将当前工作 rebase 到 `e31bed9962f449ed280753e089adcb8e0e25b6b2` 后方，并从 rebased HEAD 新建 `canvas-template-note-file-modes` 分支；原有未跟踪图片文件保持未触碰。
- [x] (2026-05-14 10:05 +0800) 已创建本计划，明确关联 Markdown `Note` 保存为模板时的用户可选策略和应用时文件处理边界。
- [x] (2026-05-14 10:22 +0800) 已更新正式设计与产品规格文档，把关联 Markdown `Note` 的模板保存策略写入 `docs/design-docs/canvas-template-feature.md`、`docs/design-docs/note-markdown-file-association.md`、`docs/product-specs/canvas-template-feature.md` 与 `docs/design-docs/index.md`。
- [x] (2026-05-14 10:48 +0800) 已扩展模板数据模型，支持 `embedded-snapshot`、`workspace-file-path-only`、`workspace-file-with-content` 三种 `Note` 内容模式，并保持旧模板兼容。
- [x] (2026-05-14 11:00 +0800) 已扩展保存模板表单，只有在当前画布存在关联 Markdown `Note` 时显示策略选择区；表单提交后把每个关联 `Note` 的选择传给宿主。
- [x] (2026-05-14 11:15 +0800) 已实现保存时的策略落地：快照策略读取磁盘内容，路径策略只保存 workspace 相对路径，带内容策略保存相对路径和文件内容。
- [x] (2026-05-14 11:32 +0800) 已实现应用模板时的文件处理：路径-only 自动关联已有文件，缺失时创建缺失状态关联 `Note`；路径+内容在缺失时创建文件，已有内容冲突时转为节点内 `dirty-conflict`。
- [x] (2026-05-14 11:46 +0800) 已增加脚本测试和保存表单源码断言，并运行 `npm run typecheck`、`npm run test:canvas-templates`；`npm run test:webview` 中 144/145 通过，剩余 1 个既有基线截图差异需后续确认。
- [x] (2026-05-14 22:45 +0800) 按用户反馈移除“不保存此 Note”保存选项；应用模板的路径+内容冲突改为物化 `dirty-conflict` Note，由节点内冲突提示承接处理，不再在应用前弹出冲突 modal。
- [x] (2026-05-14 23:05 +0800) 已重新运行 `git diff --check`、`npm run typecheck`、`npm run test:canvas-templates` 和 `npm run test:webview`；本轮 150 个 Webview 用例全部通过。
- [x] (2026-05-14 23:18 +0800) 已把普通快照、仅相对路径、相对路径加文件内容三种策略的设计定位补入正式设计文档和产品规格：内容型模板、仓库文件入口型模板、文件资产 / 脚手架型模板。
- [x] (2026-05-15 09:20 +0800) 已将 path-only 模板缺失文件与运行中关联文件被删除 / 移动统一为“关联文件缺失”节点状态；节点内只提供“创建空文件并关联”，不提供重新检查、复制路径或改选文件。
- [x] (2026-05-15 09:35 +0800) 已运行 `git diff --check`、`npm run typecheck`、`npm run test:canvas-templates`、`npm run test:webview -- --grep "missing associated markdown notes"` 与完整 `npm run test:webview`；完整 Webview 150 个用例通过。
- [x] (2026-05-15 01:59 +0800) 已将关联文件缺失状态的正文提示改为与无草稿 `dirty-conflict` 恢复态一致的节点内冲突卡片，并补充针对缺失和无草稿冲突卡片的 Webview 回归断言。
- [x] (2026-05-15 07:39 +0800) 已处理 PR review 的两个 blocker：路径+内容模板遇到已有文件冲突时，首次物化的 `conflictDraft` 直接携带运行时 `content` 以显示复制/覆盖动作；workspace 首次打开固定应用内置 `使用说明`，不再先应用用户默认模板，避免打开 workspace 时由用户默认模板静默写文件。
- [x] (2026-05-15 07:39 +0800) 已运行 `git diff --check`、`npm run typecheck`、`npm run test:canvas-templates` 和 `npm run test:webview -- --grep "associated markdown note restores a persisted dirty-conflict draft after bootstrap|associated markdown note bootstrapped with dirty-conflict shows reload recovery only"`；targeted Webview 2 个用例通过。
- [x] (2026-05-15 07:46 +0800) 已处理 review 反馈：关联文件缺失时不再显示节点 chrome 的“打开文件”按钮，缺失态只保留正文冲突卡片里的“创建空文件并关联”恢复动作；已补 Webview 断言。
- [x] (2026-05-15 07:46 +0800) 已运行 `git diff --check`、`npm run typecheck` 和 `npm run test:webview -- --grep "missing associated markdown notes"`；targeted Webview 1 个用例通过。

## 意外与发现

- 观察：`npm run test:webview` 只有首个 baseline screenshot 失败，差异集中在已有画布 Note 顶部动作文字区域，比例 0.01%，其余 144 个 Webview 用例通过。
  证据：Playwright 输出 `1 failed ... canvas-shell-baseline.png`，并报告 `144 passed (4.5m)`；失败 artifact 位于 `.debug/playwright/results/webview-harness-webview-bu-f97a0-hes-the-baseline-screenshot/`。

- 观察：rebase 到最新 `origin/main` 后重新执行完整 Webview 测试，之前的 baseline 差异已不再复现。
  证据：本轮 `npm run test:webview` 输出 `150 passed (4.2m)`。

- 观察：执行 rebase 时 `src/webview/main.tsx` 出现一次冲突，冲突点是 `note-markdown-sync-rework` 新增的关联 Markdown 冲突草稿持久化逻辑与当前分支新增的 Note 视觉行测量逻辑相邻。
  证据：`git rebase --onto e31bed9962f449ed280753e089adcb8e0e25b6b2 6b36f72... HEAD` 在应用 `b5a08e6` 时冲突；已手动保留两边逻辑并继续 rebase。

- 观察：关联文件缺失、文件移动/删除和无可恢复草稿的 `dirty-conflict` 都不能展示旧 Markdown 预览或进入普通编辑态，因此它们适合共享同一个“正文区域内的冲突卡片”视觉语言。
  证据：`npm run test:webview -- --grep "associated markdown note bootstrapped with dirty-conflict shows reload recovery only|missing associated markdown notes"` 覆盖这两条路径并通过。

- 观察：`createStoredNoteMarkdownConflictDraft()` 正常只返回 storage-backed draft id；Webview 广播路径会再 hydrate draft content，但模板内容冲突的首个 materialization 自身如果不携带 `content`，就会把“模板正文首屏可复制/覆盖”这个需求隐含依赖到后续广播实现。
  证据：PR review 指出该路径可能只显示 `重新加载`，导致用户一点击就丢弃模板正文；本轮改为在 materialization 中保留 runtime-only `conflictDraft.content`，持久化前仍由现有剥离逻辑移除正文。

- 观察：首次 workspace 打开如果复用用户当前默认模板，会让“相对路径 + 文件内容”模板的缺失文件自动创建能力变成打开 workspace 的副作用。
  证据：`ensureDefaultTemplateAppliedIfNeeded()` 原本调用 `applyDefaultCanvasTemplate()`；本轮改为只解析 `DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID` 对应的内置 `使用说明`。

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

- 决策：不提供“不保存此 Note”作为关联 Markdown `Note` 的保存策略。
  理由：用户原始选择范围聚焦在保留内容快照、保留路径和保留路径加内容；额外跳过选项会改变节点和连线集合，容易让模板缺失上下文。
  日期/作者：2026-05-14 / Codex。

- 决策：应用“相对路径 + 文件内容”模板时，如果目标文件已存在且内容不同，不在应用前用宿主 modal 阻塞确认，而是创建关联 Markdown `Note` 并进入 `dirty-conflict`，把模板正文作为冲突草稿留在节点里。
  理由：冲突属于具体 Note 的内容状态，放在节点内能让用户看到模板内容和现有文件路径，再用已有“重新加载 / 复制草稿 / 覆盖文件”恢复动作处理；应用模板流程也不会被多个文件冲突串行 modal 打断。
  日期/作者：2026-05-14 / Codex。

- 决策：把三种保存策略定位为三类模板意图，而不是同一意图下的保存强弱选项。
  理由：普通快照服务内容型模板，路径不再重要；仅相对路径服务仓库文件入口型模板，真实文件继续作为内容权威来源；相对路径加文件内容服务文件资产 / 脚手架型模板，模板需要携带可创建的 Markdown 初始内容。明确定位能帮助用户理解隐私、可移植性和写文件风险。
  日期/作者：2026-05-14 / Codex。

- 决策：关联 Markdown `Note` 的路径缺失统一在节点内处理，只提供“创建空文件并关联”。
  理由：模板 path-only 应用时缺文件、文件后续被删除或移动，本质都是节点关联到一个当前不存在的路径；这不是需要阻塞模板应用的 modal 冲突。重新检查由 watcher / refresh 自动完成，复制路径复用 subtitle 复制按钮；不提供“改选文件”，如果用户想关联到另一个文件，可以删除当前 `Note` 并拖入目标 Markdown 文件。
  日期/作者：2026-05-15 / Codex。

- 决策：关联文件缺失 / 不可用与无草稿 `dirty-conflict` 恢复态共享同一套节点内冲突卡片样式。
  理由：这几种状态都表示当前正文不能作为可信、可直接编辑的 Markdown 内容展示；共享冲突卡片能让用户把它们理解为同一类“需要在 Note 内处理的关联文件状态”，同时保留各自不同的动作：缺失只创建空文件并关联，无草稿冲突只重新加载。
  日期/作者：2026-05-15 / Codex。

- 决策：路径+内容模板遇到已有文件内容冲突时，创建 storage-backed `conflictDraft` 的同时，在当前 materialization 中携带 runtime-only `conflictDraft.content`。
  理由：模板正文是用户需要处理的冲突草稿，首次应用模板后必须立即显示 `复制草稿` 和 `覆盖文件`；正文仍不写入持久化画布状态，现有持久化剥离逻辑继续保证长期状态只保存 draft id。
  日期/作者：2026-05-15 / Codex。

- 决策：workspace 首次打开固定应用内置 `使用说明`，不读取用户当前默认模板；用户默认模板只服务显式应用或重置。
  理由：首次打开是 onboarding，不是用户显式应用模板。若复用用户默认模板，带文件内容的模板可能在打开 workspace 时自动创建文件，违反文件写入必须由显式模板应用触发的边界。
  日期/作者：2026-05-15 / Codex。

- 决策：关联 Markdown 文件处于 `missing` 状态时隐藏节点 chrome 的“打开文件”动作。
  理由：缺失路径的唯一恢复动作应在节点正文冲突卡片内完成，即“创建空文件并关联”；保留“打开文件”会绕过新的恢复路径并对不存在的资源发起打开请求。
  日期/作者：2026-05-15 / Codex。

## 结果与复盘

本轮已完成主体实现：保存模板表单会为关联 Markdown `Note` 展示策略选择，模板模型能表达普通快照、仅相对路径和相对路径加内容，保存路径会按用户选择读取磁盘内容或保存相对路径，应用路径会自动关联、创建文件，或在内容冲突时生成节点内 `dirty-conflict` 提示。后续反馈中的“缺失关联路径”也已下沉为 Note 内状态，并与无草稿 `dirty-conflict` 恢复态统一为同一套冲突卡片 UI。PR review 后又补齐模板冲突草稿首屏恢复和首次打开不应用用户默认模板的安全边界。目标测试 `npm run typecheck`、`npm run test:canvas-templates` 与 rebase 后的 `npm run test:webview` 均已通过；本轮 UI 统一又重新通过完整 `npm run test:webview`。

## 上下文与定向

本仓库是 VS Code 扩展。画布状态中的节点类型定义在 `src/common/protocol.ts`，其中 `NoteNodeMetadata` 包含 `content` 和可选 `contentSource`。普通 `Note` 没有 `contentSource` 或 `contentSource.kind === 'embedded'`，正文权威数据存储在画布状态；关联 Markdown `Note` 使用 `contentSource.kind === 'markdown-file'`，`resourceUri` 指向真实 `.md` 或 `.markdown` 文件，`content` 只是宿主读取后发给 Webview 的展示和编辑缓冲。

模板功能的共享模型在 `src/common/canvasTemplates.ts`。当前模板节点只允许 `agent`、`terminal`、`note`，`Note` 模板只保存 `metadata.note.content`。模板保存入口在 `src/extension.ts` 的 `saveCurrentCanvasAsTemplateFromCommand()`，它打开 `src/panel/CanvasTemplateSaveFormPanel.ts` 中的保存表单，再调用 `CanvasPanelManager.saveCurrentCanvasAsTemplate()`。模板应用路径在 `src/panel/CanvasPanelManager.ts` 的 `applyCanvasTemplateRecord()`，它调用 `applyCanvasTemplateToState()` 和 `materializeTemplateNode()` 把模板节点重新物化成画布节点。

本次任务中，“workspace 相对路径”指相对于当前 VS Code workspace folder 的路径，例如单根 workspace 中的 `docs/plan.md`，或多根 workspace 中带 folder name 前缀的 `repo-a/docs/plan.md`。路径必须是相对路径，不能是绝对路径，不能包含 `..` 越出 workspace，且只能指向 `.md` 或 `.markdown` 文件。

## 工作计划

第一步更新正式文档。`docs/design-docs/canvas-template-feature.md` 的模板模型与保存语义需要说明关联 Markdown `Note` 的三种保存策略。`docs/design-docs/note-markdown-file-association.md` 需要说明关联 Markdown `Note` 在保存为模板时不再只有静默快照路径。`docs/product-specs/canvas-template-feature.md` 需要补充用户流程和模板内容范围。

第二步扩展共享模板模型。在 `src/common/canvasTemplates.ts` 增加 `CanvasTemplateNoteContentMode`，允许 `metadata.note.templateContentMode` 为 `embedded-snapshot`、`workspace-file-path-only` 或 `workspace-file-with-content`。旧模板没有该字段时按 `embedded-snapshot` 解析。新增保存选择类型，允许宿主在捕获模板时按节点 id 传入 `embedded-snapshot`、`workspace-file-path-only` 或 `workspace-file-with-content`。

第三步扩展保存表单。`CanvasTemplateSaveFormPanel` 新增 `associatedNoteNodes` 输入，每个条目包含 node id、标题、显示路径、是否在 workspace 内、当前文件状态和默认策略。表单只在 save 模式且存在条目时显示“关联 Markdown Notes”区域。每行一个下拉框；workspace 内文件可选路径-only 和路径+内容，workspace 外文件只能选快照。提交 payload 增加 `associatedNoteModes`。

第四步实现宿主保存逻辑。`CanvasPanelManager` 增加方法构建保存表单需要的关联 `Note` 条目。保存提交后，`saveCurrentCanvasAsTemplate()` 根据用户策略读取磁盘文件或保存相对路径。快照和路径+内容策略在文件状态为 `ok` 时读取磁盘落盘内容；路径-only 不保存正文。文件缺失、不可读或 dirty-conflict 时不得静默保存旧 buffer，而是抛出带中文说明的错误，提示用户先恢复文件。

第五步实现应用逻辑。应用模板前，`applyCanvasTemplateRecord()` 异步解析模板中的 workspace 文件 `Note`。路径-only：文件存在则读取并关联；文件不存在则创建缺失状态关联 `Note`，由节点内“创建空文件并关联”动作恢复。路径+内容：文件不存在则创建父目录和文件并写入模板内容；文件存在且内容相同则关联；文件存在但内容不同则关联现有文件并进入 `dirty-conflict`，把模板正文作为节点内冲突草稿。完成解析后，把每个模板 note index 对应的 `content` 和 `contentSource` 传给 `applyCanvasTemplateToState()`，由物化逻辑创建真正的关联 Markdown `Note`。

第六步补测试。通过 `npm run test:canvas-templates` 运行模板回归，实际测试文件位于 `scripts/test/test-canvas-templates.mjs`；测试应覆盖：旧模板继续解析；关联 `Note` 快照模式、路径-only、路径+内容捕获；路径模式模板 JSON 不含 raw resource URI；应用内容冲突不再走 modal，而是生成 `dirty-conflict` materialization。保存表单源码断言应覆盖新增 section、payload 字段和不出现“不保存此 Note”。必要时补充 Webview harness 测试以确认表单 UI 不影响导入模式。

第七步统一 Note 内关联文件异常的视觉表达。`src/webview/main.tsx` 中正文区域不可用分支继续负责缺失、不可读和无草稿 `dirty-conflict` 恢复态，但内容结构统一为 `.note-file-conflict-card`；`src/webview/styles.css` 让该卡片复用 `.note-edit-conflict-hint` 的边框、背景、字号、阴影和 `.note-edit-conflict-action` 按钮语言。缺失状态仍只提供“创建空文件并关联”，无草稿 `dirty-conflict` 仍只提供“重新加载”。

## 具体步骤

在仓库根目录执行以下命令进行验证：

    npm run test:canvas-templates
    npm run typecheck

若修改触及 Webview 表单 DOM 或主要交互，还应运行：

    npm run test:webview

若修改触及关联 Markdown Note 的缺失或冲突提示 UI，可先运行针对性回归：

    npm run test:webview -- --grep "associated markdown note bootstrapped with dirty-conflict shows reload recovery only|missing associated markdown notes"

当前已执行的版本控制步骤：

    base=$(git merge-base HEAD e31bed9962f449ed280753e089adcb8e0e25b6b2)
    git rebase --onto e31bed9962f449ed280753e089adcb8e0e25b6b2 "$base" HEAD
    git switch -c canvas-template-note-file-modes

## 验证与验收

验收标准如下：当画布中没有关联 Markdown `Note` 时，保存模板流程与当前一致；当存在关联 Markdown `Note` 时，保存表单出现策略选择区。选择“保存为普通 Note 内容快照”后，模板应用回来是普通 `Note`；选择“仅保留 workspace 相对路径”后，模板 JSON 只包含相对路径，应用时关联当前 workspace 中的对应文件，文件缺失时在 Note 节点内显示缺失提示并只提供“创建空文件并关联”；选择“保留相对路径和文件内容”后，模板 JSON 包含相对路径和 Markdown 正文，应用时可在文件缺失时创建文件，已有文件冲突时在 Note 节点内显示冲突提示并允许用户重新加载、复制草稿或覆盖文件。

自动化验证需要证明旧模板兼容、新模板字段解析和捕获正确、应用模板时能生成期望的 `contentSource`。`npm run test:canvas-templates` 必须通过；`npm run typecheck` 必须通过。关联 Markdown Note 的缺失提示和无草稿 `dirty-conflict` 恢复态必须分别继续不渲染普通 Markdown 预览或 checklist，并在同一个节点内冲突卡片中显示各自动作。如果未运行完整 `npm test`，最终说明中需要明确剩余验证缺口。

## 幂等性与恢复

文档和源码修改可以重复应用。rebase 已完成并新建分支；若后续需要恢复到 rebase 前的原始分支，原分支 `fix-note-line-number-view-rows` 仍保留在本地。保存模板的实现不得删除用户 Markdown 文件；应用模板时只有用户选择覆盖、节点内点击“创建空文件并关联”，或文件不存在且模式要求自动创建时，才会写 workspace 文件。路径-only 缺失场景默认保留缺失关联，以避免强制创建用户不想要的文件。

## 证据与备注

rebase 后的短日志应包含以下顺序，证明当前分支建立在用户指定提交之后：

    * 6646a4f feat(note): 支持复制关联 Markdown 路径
    * 139e093 fix(note): 按视觉行对齐编辑态行号
    * e31bed9 feat(note): 完善关联 Markdown 冲突草稿恢复

此前工作树存在用户既有未跟踪图片文件：`image.png`、`image copy.png`、`image copy 2.png`、`image copy 3.png`、`image copy 6.png`；本计划未触碰这些文件。本轮继续前用户已自行清理这些未跟踪文件。

本轮 UI 统一的验证记录：

    git diff --check
    npm run typecheck
    npm run test:webview -- --grep "associated markdown note bootstrapped with dirty-conflict shows reload recovery only|missing associated markdown notes"
    2 passed (12.7s)
    npm run test:webview
    150 passed (4.3m)

PR review blocker 修复的验证记录：

    git diff --check
    npm run typecheck
    npm run test:canvas-templates
    npm run test:webview -- --grep "associated markdown note restores a persisted dirty-conflict draft after bootstrap|associated markdown note bootstrapped with dirty-conflict shows reload recovery only"
    2 passed (12.5s)

缺失态隐藏“打开文件”的验证记录：

    git diff --check
    npm run typecheck
    npm run test:webview -- --grep "missing associated markdown notes"
    1 passed (11.1s)

## 接口与依赖

在 `src/common/canvasTemplates.ts` 中新增模板 note 内容模式和保存选择类型。`captureCanvasTemplateFromState()` 需要接受一个可选的关联 note 保存选择 map，并据此生成模板节点。`applyCanvasTemplateToState()` 需要接受一个可选的 note materialization map，让宿主传入已经解析好的关联文件内容和 `contentSource`。

在 `src/panel/CanvasPanelManager.ts` 中新增 workspace 相对 Markdown 文件解析、读取、创建、冲突确认和 materialization 准备函数。这些函数必须复用现有 `readNoteMarkdownFile()`、`writeNoteMarkdownFile()`、`statNoteMarkdownFile()`、`formatNoteMarkdownDisplayPathInfo()` 和 `createNoteMarkdownFileStatRevision()`，避免新增第二套文件状态语义。

在 `src/panel/CanvasTemplateSaveFormPanel.ts` 中新增保存表单关联 `Note` section 和 message payload 字段。表单 JS 只负责收集用户选择，不直接读取文件或判断磁盘状态；所有文件 I/O 仍在 Extension Host 中完成。


修订记录：2026-05-14 / Codex：完成代码、文档与测试验证记录，补充 Webview screenshot 残余风险。
修订记录：2026-05-15 / Codex：补充缺失关联文件与无草稿 `dirty-conflict` 恢复态共享节点内冲突卡片的设计、步骤与验证记录。
修订记录：2026-05-15 / Codex：记录 PR review blocker 修复，覆盖模板冲突草稿首屏恢复与首次打开固定使用内置 `使用说明` 的安全边界。
