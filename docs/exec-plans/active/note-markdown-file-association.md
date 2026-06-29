# Note 与 Markdown 文件关联实现

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/note-markdown-file-association.md`，必须按 `docs/PLANS.md` 的要求持续维护。执行者应假设自己只知道当前工作树和本文内容，不依赖之前的对话记忆。

## 目标与全局图景

这次变更要让画布里的普通 `Note` 可以被用户显式保存为真实 Markdown 文件，并从此成为一个由该 Markdown 文件驱动的关联 `Note`。完成后，用户可以在一个普通 `Note` 上执行“保存为 Markdown 并关联”，在 Quick Input 中确认文件路径；如果目标文件已存在，用户可以选择覆盖文件、保留文件内容并关联，或取消。关联后的节点继续是 `Note`，标题下方以 subtitle 显示文件路径，正文读取和写回 `.md` / `.markdown` 文件。

这次变更还要让用户把 `.md` / `.markdown` 文件拖到画布空白区域释放，并在释放位置创建关联 Markdown 的 `Note`。如果文件缺失、被替换为目录或不可读，节点必须显示明确警告，而不是把最后一次读取内容伪装成最新正文。删除关联 `Note` 只删除画布节点，不删除文件。

用户可以亲眼验证的结果是：普通 `Note` 仍可照常使用；一个普通 `Note` 能被保存成 `<workspace root>/<title>.md` 并关联；已有文件冲突时不会静默覆盖；拖入 Markdown 文件会生成关联 `Note`；删除或移走关联文件后节点显示“关联的 Markdown 文件不可用”。

## 进度

- [x] (2026-05-13 06:52 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md` 和现有 Note Markdown 设计，确认这是需要正式设计文档和 `ExecPlan` 的跨层功能。
- [x] (2026-05-13 06:52 +0800) 从 `origin/main` 新建分支 `docs/note-markdown-file-association`，保留工作树中既有未跟踪文件 `image copy.png`、`image.png`、`xxxx.prompts.md` 不改动。
- [x] (2026-05-13 06:52 +0800) 新增正式设计文档 `docs/design-docs/note-markdown-file-association.md`，并在 `docs/design-docs/index.md` 登记。
- [x] (2026-05-13 06:52 +0800) 新增本执行计划，明确实现切片、接口、验证与回滚方式。
- [x] (2026-05-13 06:52 +0800) 更新设计文档 frontmatter 与索引，把本执行计划登记到 `related_plans`。
- [x] (2026-05-13 07:26 +0800) 盘点现有 Note 创建、编辑、持久化、Markdown 链接打开、Webview 拖放与 smoke 测试路径，确认最小改动点。
- [x] (2026-05-13 07:26 +0800) 实现共享协议与纯函数：Note 内容来源模型、Markdown 文件扩展名校验、文件名安全化、display path 计算和解析辅助。
- [x] (2026-05-13 07:26 +0800) 实现 Host 侧 Markdown 文件 Note 编排：转换 Quick Input、已有文件冲突选择、文件读写、保存/文件系统刷新、watcher、缺失状态和持久化恢复。
- [x] (2026-05-13 07:26 +0800) 实现 Webview 呈现与交互：subtitle、不可用警告、关联文件编辑提交、打开文件动作、画布空白区 Markdown 文件拖放创建。
- [x] (2026-05-13 07:26 +0800) 补充自动化测试，覆盖共享纯函数、Webview 呈现/拖放消息，以及真实 VSCode smoke 中的拖拽创建、写回、删除节点不删文件和缺失警告。
- [x] (2026-05-13 07:26 +0800) 执行验证命令，并把结果同步回本计划和设计文档；Quick Input 既有文件三选项已实现但尚未由自动化直接驱动验证。
- [x] (2026-05-13 07:54 +0800) 修复 Markdown 文件拖放时同一文件以多个拖拽资源或重复消息上报会创建重复 Note 的问题，并补充 smoke 回归断言。
- [x] (2026-05-13 08:27 +0800) 调整关联 Markdown Note 的 subtitle 显示规则，避免 raw `vscode-remote://...` 暴露到 UI，并加入人类可读路径处理。
- [x] (2026-05-13 08:59 +0800) 放开“一个 Markdown 只能对应一个 Note”的长期限制；已关联文件再次拖入时改为 modal 选择继续添加新 Note 或定位已关联 Note。
- [x] (2026-05-13 09:47 +0800) 调整 Markdown 关联相关 modal：不再额外传入“取消”按钮，避免和 VSCode modal 默认 Cancel 重复；提示文案中的文件路径改用与 subtitle 一致的 `displayPath`。
- [x] (2026-05-13 10:35 +0800) 修复关联 Markdown 内容复用普通 Note 8,000 字符截断上限的问题；普通 Note 编辑器显式展示并执行 8,000 字符上限；设计文档同步确认“保存为 Markdown”作为普通 Note 常驻按钮。
- [x] (2026-05-13 11:31 +0800) 修复关联 Markdown Note 编辑期间外部文件刷新后旧草稿可静默覆盖新内容的问题；新增 content revision 写回保护、Webview 冲突提示和回归测试。
- [x] (2026-05-13 14:21 +0800) 根据 PR review 修复空白画布 Markdown 拖拽 `dragover` 判断、Host `dirty-conflict` 后草稿丢失/无法恢复，以及无 workspace 时 Quick Input 相对路径基准不一致的问题。
- [x] (2026-05-13 15:02 +0800) 根据 PR review 修复重新 bootstrap 已持久化 `dirty-conflict` 时没有恢复入口的问题；该状态只显示重新加载恢复，不提供无草稿覆盖，也不渲染 checklist 预览。
- [x] (2026-05-13 17:29 +0800) 根据用户纠正把关联 Markdown 的内容权威切回磁盘：移除 open dirty buffer 参与读取/写回基线的逻辑，并补充“未保存 editor 草稿不影响 Note 展示、保存后才刷新”的回归测试。
- [x] (2026-05-13 17:58 +0800) 根据用户确认把写回冲突检测从完整内容 hash 改为 `FileStat` 磁盘状态 revision；刷新展示先比较 revision，未变化时不读完整文件。
- [x] (2026-05-13 19:40 +0800) 将关联 Markdown Note subtitle 改为与 Agent / Terminal 一致的完整人类可读文本加布局省略，不再在 Host 侧做 56 字符中间压缩；同步 `docs/UI.md` 中节点标题/副标题规范。
- [x] (2026-05-13 21:10 +0800) 补齐关联 Markdown Note 未解决冲突的草稿持久化：Webview 编辑时上报 draft，Host 在 stale 写回或外部刷新后持久化 `recoverableDraft`，窗口焦点刷新不再自动清除 `dirty-conflict`。
- [x] (2026-05-13 23:16 +0800) 补充并运行本轮针对 `recoverableDraft` 的 Playwright、smoke 片段与文档验证记录。
- [x] (2026-05-14 10:32 +0800) 根据手动验证反馈补强编辑态外部变更提醒：Webview 开始编辑时向 Host 登记运行时 edit session，Host 文件刷新能在提交前进入 `dirty-conflict` 并持久化草稿；冲突提示不再把 textarea 设为只读，用户可继续编辑后再重新加载、复制或覆盖。
- [x] (2026-05-13 23:57 +0800) 将关联 Markdown Note 的冲突草稿正文迁移到 `storageUri/note-markdown-drafts/<draftId>.md`；Host 持久化状态和 debug snapshot 只保留 draft 引用，发给 Webview 时再按需 hydrate 草稿内容。
- [x] (2026-05-14 00:16 +0800) 在关联 Markdown 冲突提示中增加 `复制草稿` 动作；Webview 发送草稿内容给 Host，由 Host 写入系统剪贴板，并补充 Playwright 回归。
- [x] (2026-05-24 01:47 +0800) 将持久化草稿字段从 `conflictDraft` 收敛为 `recoverableDraft`，保留历史字段读取兼容，避免“可恢复草稿”和“已进入冲突”语义继续混用。
- [x] (2026-05-24 02:16 +0800) 补强旧字段迁移：历史 `conflictDraft.content` 会先物化到既有 `note-markdown-drafts/` draft 文件，再以 `recoverableDraft` 进入运行态；debug snapshot 和 Webview 广播不再输出旧字段，新代码路径只写 `recoverableDraft`。

## 意外与发现

- 观察：当前 `Note` 已经有 Markdown 预览、checklist、链接、安全 KaTeX 与宿主打开 workspace 文件链接的基础设施。
  证据：`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中 `createNoteMarkdownRenderer()` 负责受控 Markdown 渲染；`extensions/vscode/dev-session-canvas/src/common/noteMarkdownLinks.ts` 和 `CanvasPanelManager.openNoteLink()` 已经负责 Note 预览链接的 Host 侧打开校验。

- 观察：`NoteNodeMetadata` 当前只有 `content: string`，因此需要以向后兼容方式新增内容来源字段，不能让旧快照失效。
  证据：`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中 `export interface NoteNodeMetadata { content: string; }`，宿主 `createNoteMetadata()` / `ensureNoteMetadata()` 都围绕这一个字段工作。

- 观察：用户希望关联 Markdown Note 严格以磁盘内容为权威来源，VS Code 中打开但未保存的 editor buffer 不应驱动节点刷新。
  证据：用户明确指出“Note 节点应该以硬盘上的文件内容为准”，因此 `onDidChangeTextDocument` 不能再被用作 Note 内容同步输入。

- 观察：每次写回前完整读取 Markdown 文件并计算内容 hash 会带来不必要的内存和 I/O 成本。
  证据：用户明确询问“有不需要读完整内容的可靠方式吗”，并确认采用 `FileStat` / `mtime + size` 风格的第二种方案；本轮实现把写回前冲突检测收敛为 stat 比较，仅在 revision 变化进入冲突时读取当前内容用于恢复提示。

- 观察：只用 `fs.watch(filePath)` 监听关联文件删除，在 smoke 环境里没有稳定触发缺失状态刷新。
  证据：第一次 trusted smoke 在删除 `.debug/vscode-smoke/missing-associated-note.md` 后，节点 `contentSource.status` 仍为 `ok`，测试超时。

- 观察：新增 smoke 场景创建的缺失文件关联 Note 如果不在测试末尾删除，会影响后续持久化恢复测试的节点数量假设。
  证据：修复缺失状态刷新后，trusted smoke 在 `verifyPersistenceAndRecovery()` 中报错 `4 !== 3`，说明前序测试遗留了额外 Note 节点。

- 观察：VSCode Webview 拖拽同一个 Markdown 文件时，可能同时携带 `resourceUrls`、`codeFiles`、`uriList` 或 `files` 等多种资源表示；测试入口也可能在异步读取文件期间收到重复 drop 消息。
  证据：用户报告“将 markdown 文档拖拽到画布并释放时，会同时创建两个该文件对应的 Note 节点”；`tests/vscode-smoke/extension-tests.cjs` 已复现同一文件通过 `resourceUrls` 与 `codeFiles`，以及重复 `dropNoteMarkdownFiles` 消息进入 Host。

- 观察：Remote Markdown 文件的 subtitle 如果直接使用 `uri.toString(true)`，会显示 `vscode-remote://ssh-remote+...` 这类实现层 URI，并在 hover tooltip 中暴露过长绝对路径。
  证据：用户截图中 Note title 下方和 tooltip 显示 `vscode-remote://ssh-remote+dev_labs/home/.../Note 2.md`，不符合 subtitle 作为位置提示的 UI 目标。

- 观察：用户需要允许同一个 Markdown 文件在画板上出现多个关联 Note，但仍要避免同一次拖拽因为 DataTransfer 多资源表示而误建两个节点。
  证据：用户明确要求去掉一个 Markdown 只能在图上有一个关联 Note 节点的限制，同时保留已关联文件再次拖入时的确认与定位能力。

- 观察：VSCode modal warning 在启用 `{ modal: true }` 时会提供默认 Cancel；如果扩展再显式传入“取消”，用户会看到 `Cancel` 和 `取消` 两个取消项。
  证据：用户截图显示已关联 Markdown 文件确认框中同时出现 `Cancel` 与 `取消`，且路径仍使用较长绝对路径。

- 观察：关联 Markdown 文件如果复用普通 Note 的持久化截断函数，超过 8,000 字符的真实 Markdown 文件会在节点编辑或 checklist 更新后被截断写回。
  证据：Review 指出 `handleUpdateNoteNode()`、拖拽创建和关联状态更新均调用普通 Note 的 `trimStoredNodeText()`；本轮 smoke 改为使用超过 8,000 字符的关联 Markdown 正文验证读写不截断。

- 观察：关联 Markdown Note 在 textarea 编辑期间收到 Host 文件刷新时，旧本地草稿会保留在 textarea 中；如果失焦提交不带编辑基线，旧草稿会覆盖外部新内容。
  证据：Review 指出 Webview `committedContentRef` 被外部刷新推进但本地 textarea 不覆盖，随后 `submitNote()` 会把旧草稿写回；本轮新增 content revision 写回保护和 Playwright/smoke 回归。

- 观察：VSCode Webview 在 `dragover` 阶段可能只暴露 `DataTransfer.types`，不暴露 `ResourceURLs` / `CodeFiles` / `files[].path` 的真实内容。
  证据：PR review 指出空白画布 Markdown drop 如果在 `dragover` 阶段解析真实 payload，会因为资源为空而不 `preventDefault()`；本轮复用终端拖拽的潜在资源判断并补充 Playwright 回归。

- 观察：Host 因 stale `contentRevision` 返回 `dirty-conflict` 后，Webview 不能把被拒绝的本地草稿当作已提交或直接替换为 Host 返回的当前文件内容。
  证据：PR review 指出 `committedContentRef` / `pendingContentRef` 过早推进会导致本地草稿丢失，且 `dirty-conflict` 只显示不可用 warning、无法重新加载或覆盖；本轮改为等待 Host ack 后才推进 baseline。

- 观察：`dirty-conflict` 是 Host 会持久化到画布状态里的状态，Webview 重新加载、重新 bootstrap 或另一个 surface 首次接收该状态时不会拥有本地 `associatedMarkdownEditConflict` 草稿。
  证据：PR review 指出该路径会显示普通预览但禁止编辑，且 checklist 可能绕过显式恢复继续写回；本轮改为渲染恢复警告并补充直接以 `dirty-conflict` bootstrap 的 Playwright 回归。

- 观察：在本轮补强前，`refreshAllAssociatedMarkdownNotes()` 会在 VSCode 窗口重新获得焦点时对所有关联 Markdown Note 执行刷新；如果节点已经是 `dirty-conflict`，原实现会重新读取文件并把状态改回 `ok`。
  证据：`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的窗口焦点监听调用 `refreshAllAssociatedMarkdownNotes()`，而旧版 `refreshAssociatedMarkdownNote()` 在 `source.status !== 'ok'` 时仍会把 `readResult.status === 'ok'` 写回状态。这意味着用户未处理冲突时切换窗口可能错误清除冲突。

- 观察：把草稿正文直接内联到 `metadata.note.contentSource.recoverableDraft.content` 会让大 Markdown 草稿进入 `canvas-state.json`、`workspaceState` 和 debug snapshot，虽然没有污染关联文件权威模型，但会放大画布状态并重新绕开普通 Note 8,000 字符上限的初衷。
  证据：用户指出此前讨论过“草稿放到 storageUri 下的 draft 文件，状态里只保存 draft id/base revision/remote revision/时间戳”的更稳妥方案；本轮代码改为写入 `note-markdown-drafts/<draftId>.md` 并在持久化前剥离 `recoverableDraft.content`。

- 观察：如果测试或历史快照直接携带旧 `conflictDraft.content`，持久化前至少必须剥离正文，避免把大草稿重新写入 `canvas-state.json`。
  证据：本轮检查 `setPersistedStateForTest()` 发现它会把 raw state 传给持久化写入；剥离函数现会识别旧字段并移除 `content`，reload 路径再通过 normalize 把旧字段迁移为 `recoverableDraft`。

## 决策记录

- 决策：关联 Markdown 文件仍使用 `kind: 'note'`，通过 `NoteNodeMetadata.contentSource` 区分普通内嵌内容和 Markdown 文件来源。
  理由：产品上它仍是 Note 节点，只是内容来源变化；新增节点类型会放大 Webview、Sidebar、模板、删除和持久化分支，且不符合“普通 Note 单向升级”的用户心智。
  日期/作者：2026-05-13 / Codex

- 决策：关联后不提供解除关联能力，删除节点也不删除文件。
  理由：解除关联会重新引入双源内容冲突；删除文件属于高风险破坏性动作，不应由删除画布节点隐式触发。
  日期/作者：2026-05-13 / Codex

- 决策：已有目标文件冲突必须由用户显式选择覆盖、保留文件内容并关联，或取消；覆盖必须使用 modal warning 或同等强度确认。
  理由：这是唯一会破坏已有文件内容的路径，不能用默认行为或静默写入替用户决策。
  日期/作者：2026-05-13 / Codex

- 决策：文件缺失时优先显示警告，不把最后一次读取内容当成正常正文。
  理由：关联 Markdown Note 的权威来源是文件；显示旧内容会误导用户以为节点展示的是当前文件事实。
  日期/作者：2026-05-13 / Codex

- 决策：本地 `file:` 关联文件同时使用父目录 `fs.watch` 与 `fs.watchFile` 轮询兜底来触发状态刷新。
  理由：父目录监听能捕捉 rename/delete/create，`fs.watchFile` 能兜底文件级删除或外部修改事件；两者都只作为刷新触发，最终状态仍由 Host 重新 stat/read 判定。
  日期/作者：2026-05-13 / Codex

- 决策：拖放创建关联 Markdown Note 必须在 Host 侧按规范化资源 URI 去重，并在异步读取文件之后再次检查当前画布状态。
  理由：Webview 的 DataTransfer 类型和事件到达顺序不稳定；Host 是文件与画布状态的权威边界，只有 Host 侧去重才能覆盖单次拖拽内的多资源表示和重复消息竞态。这个去重只约束一次拖拽动作，不再禁止用户显式为同一个 Markdown 添加多个关联 Note。
  日期/作者：2026-05-13 / Codex

- 决策：关联 Markdown Note 的 subtitle 显示完整人类可读 `displayPath` / `fullDisplayPath`，不再在 Host 侧做固定字符上限或中间压缩；可视截断、ellipsis 与溢出 tooltip 统一交给节点标题栏规则处理，且不能显示 raw `resourceUri`。
  理由：`resourceUri` 是持久化与 IO 身份，不适合作为 UI 文案；关联 Markdown Note 应与 Agent 启动命令、Terminal shell path 一样保留原始人类可读信息，再由 UI 根据节点宽度退化。
  日期/作者：2026-05-13 / Codex

- 决策：同一个 Markdown 文件可以有多个关联 Note；当文件已经在画板上有关联 Note 时，再次拖入必须用 modal 让用户选择“继续添加新 Note”或“定位已关联 Note”。
  理由：同一文档可能需要出现在不同画布区域作为局部上下文；但重复添加可能是误操作，所以需要在创建第二个及后续节点前显式确认，并提供不创建节点的定位路径。
  日期/作者：2026-05-13 / Codex

- 决策：普通 Note 保留 8,000 字符上限，并在空内容占位与达到上限时提示；关联 Markdown Note 不复用该上限。
  理由：普通 Note 是轻量画布内上下文，持久化上限能控制画布状态体积；Markdown 文件是外部文件权威来源，截断后写回会造成数据丢失。
  日期/作者：2026-05-13 / Codex

- 决策：“保存为 Markdown”作为普通 Note 节点 chrome 的常驻 secondary button。
  理由：这是普通 Note 升级为文件 Note 的关键发现入口；关联 Markdown Note 在同位置显示“打开文件”，避免动作竞争。
  日期/作者：2026-05-13 / Codex

- 决策：关联 Markdown 写回必须基于 Host 颁发的 `contentRevision` 做乐观并发保护。
  理由：文件是权威来源；Webview 编辑草稿只能基于开始编辑时的 revision 写回。若文件在编辑期间变化，默认写回会造成数据丢失，必须进入冲突状态并要求用户重新加载或显式覆盖。
  日期/作者：2026-05-13 / Codex

- 决策：`contentRevision` 使用 Host 可观测的磁盘状态 revision，而不是完整内容 hash。
  理由：刷新展示和写回冲突检测不应为了比较 revision 每次读取完整 Markdown 内容；本地 `file:` 使用 `dev + ino + size + mtime + ctime`，其他 VSCode 文件系统资源使用 provider 暴露的 `type + size + mtime + ctime`。这会在极端“外部工具保留同大小和时间戳”的场景存在理论漏判，但普通 VSCode 保存、Agent 写文件和常规 shell 写入都能被检测，同时显著降低大文件内存和 I/O 成本。
  日期/作者：2026-05-13 / Codex

- 决策：关联 Markdown Note 的 Host 侧同步只认磁盘内容，打开但未保存的 editor buffer 不参与读取、刷新或写回基线。
  理由：用户明确要求 Note 节点以硬盘上的文件内容为准。把 dirty 草稿纳入同步会让节点跟随未保存状态，违反产品定义；只有保存或文件系统变化才应该刷新 Note。
  日期/作者：2026-05-13 / Codex

- 决策：空白画布 Markdown drop 的 `dragover` 阶段复用终端拖拽的“潜在资源”判断，只看 `DataTransfer.types` / `files` 是否可能携带资源；真实资源解析和 Markdown 扩展名过滤留到 `drop` 与 Host 侧执行。
  理由：`dragover` 阶段拿不到完整 payload 是 VSCode Webview 的正常约束；过早解析会导致 drop 不被允许。复用共享 helper 可以避免终端拖拽和画布拖拽判断漂移。
  日期/作者：2026-05-13 / Codex

- 决策：关联 Markdown Webview 只有在 Host 返回 `ok` 且内容匹配本次提交后，才推进 committed baseline；Host 返回 `dirty-conflict` 时保留本地草稿并提供重新加载或 force overwrite。
  理由：文件是权威来源，但用户草稿也是未被接受的本地事实；提前确认会在并发冲突时丢失草稿，无法让用户做显式恢复选择。
  日期/作者：2026-05-13 / Codex

- 决策：Webview 首次接收 Host `dirty-conflict` 但没有本地草稿时，只显示冲突警告和 `重新加载`，不显示普通预览、不提供 `覆盖文件`。
  理由：没有本地草稿时无法安全表达“覆盖”的内容；普通预览中的 checklist 会形成绕过显式冲突恢复的写回路径。
  日期/作者：2026-05-13 / Codex

- 决策：关联 Markdown Note 的未提交草稿正文不再内联到持久化画布状态，而是写入 `storageUri/note-markdown-drafts/<draftId>.md`；`MarkdownFileNoteContentSource.recoverableDraft` 在持久化状态中只保存 `draftId`、开始编辑时的 `baseContentRevision`、远端 revision 和更新时间，Host 发给 Webview 时再临时 hydrate `content`。
  理由：用户要求未处理 conflict 在切换窗口、Reload Window 或关闭 VSCode 后不能被错误处理，同时不能让大草稿污染画布状态。storage-backed draft 保留 `重新加载` / `覆盖文件` 恢复能力，又避免把草稿正文写入 `canvas-state.json`、`workspaceState` 或 debug snapshot；该字段仍只服务未解决冲突恢复，不改变“磁盘文件是正文权威”的原则。
  日期/作者：2026-05-13 / Codex

- 决策：普通焦点恢复、保存事件或 watcher 触发的刷新不得自动清除 `dirty-conflict`；只有用户显式点击 `重新加载` 或 `覆盖文件` 后才允许清除 `recoverableDraft` 并恢复 `ok`。
  理由：窗口切换是环境事件，不代表用户已经解决冲突。自动清除会让旧草稿丢失，或让 checklist/预览路径绕过显式恢复。
  日期/作者：2026-05-13 / Codex

- 决策：在有可用草稿内容的冲突提示中增加 `复制草稿`，复制动作由 Host 使用 `vscode.env.clipboard.writeText()` 完成；没有草稿内容时仍只提供 `重新加载`。
  理由：重新加载会丢弃草稿，覆盖文件会改写权威 Markdown；复制草稿提供一个非破坏性出口，让用户先把本地内容保存到剪贴板，再决定如何解决冲突。Host 负责剪贴板写入可以复用现有终端复制的权限和错误处理边界。
  日期/作者：2026-05-14 / Codex

- 决策：关联 Markdown Note 进入正文编辑时，Webview 向 Host 登记不持久化的运行时 edit session；文件 watcher、保存事件或焦点刷新一旦发现磁盘 revision 已不同，Host 用当前 edit session 内容生成 storage-backed `recoverableDraft` 并进入 `dirty-conflict`。冲突提示保持 textarea 可编辑，但阻止失焦或快捷提交静默写回。
  理由：只在失焦写回前做 stale revision 检查会让用户编辑期间看不到外部落盘变化；把 edit session 放在 Host 内存态可以让文件刷新提前提示，同时避免把“尚未产生差异”的普通编辑开始动作写入持久化状态。保持可编辑可减少用户在冲突提示出现后被迫中断整理草稿的体验成本，真正改写文件仍必须点击显式动作。
  日期/作者：2026-05-14 / Codex

- 决策：正式模型命名统一使用 `recoverableDraft`；旧 `conflictDraft` 只保留在读取迁移和旧快照剥离代码中。draft 文件目录继续使用 `note-markdown-drafts/`。
  理由：一个草稿可能处于 `status: ok`，并不必然代表已经进入冲突；字段名继续叫 `conflictDraft` 会把“保留可恢复草稿”和“标记冲突”混成同一概念。目录名保持不变可以让升级前已经写入 storage 的 draft 文件继续被找到；旧 raw 快照只作为升级输入存在，Host 规范化后的运行态和后续代码写入都使用新字段。
  日期/作者：2026-05-24 / Codex

- 决策：运行时 edit session 记录 `baseContent` 和 `baseContentRevision`，冲突判定必须同时满足“用户已编辑草稿”与“关联文件相对编辑基线发生变化”：`draftContent !== baseContent` 且 `latestRemoteContent !== baseContent` 或 revision/mtime/ctime 变化。冲突一旦出现，不因后续草稿文本又等于最新远端内容而自动消失，必须由用户显式重新加载或覆盖。
  理由：用户指出“textarea 与 Markdown 不同”本身可能只是正常本地草稿，不能作为冲突提示条件；但用户已经编辑草稿后，关联文件发生任何落盘变化都需要提示，否则会出现草稿先等于远端、继续编辑后又等于远端导致提示状态来回消失的问题。
  日期/作者：2026-05-14 / Codex

## 结果与复盘

以下内容记录当前实现结果；本轮已根据用户纠正把关联 Markdown 的同步基线重新收回到磁盘。

已落地内容：

- `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 新增 `NoteNodeMetadata.contentSource` 与 Webview -> Host 消息：保存为 Markdown、打开关联文件、重新加载关联文件、拖拽 Markdown 文件创建 Note；关联 Markdown 写回携带编辑基线 `contentRevision`。
- `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 继续扩展 Webview -> Host 消息：关联 Markdown 编辑开始/结束时登记运行时 edit session，编辑时上报/清理未提交 draft，使 Host 能在 Reload Window 或关闭 VSCode 后保留未解决冲突的草稿引用；冲突提示的 `复制草稿` 会发送 `webview/copyAssociatedNoteMarkdownDraft`。
- `extensions/vscode/dev-session-canvas/src/common/noteMarkdownFileAssociation.ts` 新增扩展名校验、默认文件名、安全文件名、Remote authority 人类可读前缀与内容来源类型；`NoteMarkdownRecoverableDraft` 支持 storage-backed `draftId` 与只面向 Webview hydration 的可选 `content`，旧 Note 仍通过缺省 `contentSource` 作为普通 Note 兼容。
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 实现普通 Note 保存为 Markdown 并关联、Quick Input 路径导航、已有文件 modal 选择、关联文件读写、保存/文件系统刷新、缺失/不可读状态刷新、打开关联文件和本地文件监听；关联 Markdown 文件的读取与写回不受普通 Note 8,000 字符上限截断，并在 stale revision 写回时进入 `dirty-conflict`。同步规则只认磁盘落盘内容，不读 dirty buffer；写回前冲突检测使用 `FileStat` 磁盘状态 revision，刷新展示在 revision 未变化时跳过完整内容读取；运行时 edit session 让 watcher/保存/焦点刷新可以在用户仍处于编辑态时发现外部落盘变化并生成 storage-backed `recoverableDraft`；普通焦点恢复和 watcher 刷新会保留未处理 `dirty-conflict`，只有显式重新加载或覆盖才清理 `recoverableDraft`。冲突草稿正文写入 `note-markdown-drafts/<draftId>.md`，持久化状态和 debug snapshot 会剥离 `content`，历史 `conflictDraft` 读取时迁移为 `recoverableDraft`，Host 给 Webview 广播状态时再读取 draft 文件 hydrate；复制草稿请求由 Host 写入系统剪贴板。
- `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`extensions/vscode/dev-session-canvas/src/webview/styles.css` 和 `extensions/vscode/dev-session-canvas/src/webview/droppedResources.ts` 实现关联文件 subtitle、布局溢出 tooltip、缺失警告、普通 Note 的保存入口、关联 Note 的打开文件入口、普通 Note 8,000 字符上限提示、关联 Markdown 编辑冲突提示、带已 hydrate `recoverableDraft.content` 的 Host `dirty-conflict` 重新 bootstrap 草稿恢复、无草稿内容 `dirty-conflict` 的 reload-only 恢复警告、冲突时的 `复制草稿` 按钮，以及空白画布拖放 Markdown 文件创建关联 Note；冲突提示出现后 textarea 仍可编辑，但 blur / Ctrl+Enter 只同步草稿，不会静默提交；空白画布与终端拖拽共享潜在资源判断。
- `tests/playwright/webview-harness.spec.mjs`、`scripts/test/test-note-markdown-file-association.mts` 和 `tests/vscode-smoke/extension-tests.cjs` 覆盖了核心模型、Webview 呈现/消息、真实文件写回、打开但未保存的 editor buffer 不影响 Note 展示且保存后才刷新、编辑期外部刷新冲突、冲突提示后继续编辑草稿、关联 Markdown draft 上报、Host dirty-conflict 后保留草稿引用、带 hydrate 草稿的 Host dirty-conflict 重新 bootstrap 的恢复/覆盖入口、只有 draft 引用但无内容时的 reload-only 恢复入口、删除节点不删文件、缺失警告、拖拽创建、重复拖拽资源去重，以及已关联文件再次拖入时的添加/定位选择。

验证结果：

       npm run typecheck
       通过

       npm run test:note-markdown-file-association
       note markdown file association tests passed；覆盖扩展名、文件名安全化和 Remote authority 轻量前缀

       npm run test:webview -- --grep "associated markdown note editor|associated markdown note editing blocks|associated markdown note keeps|associated markdown note bootstrapped|ordinary note empty placeholder|associated markdown notes|missing associated markdown notes|dropping markdown files"
       Playwright webview tests passed；覆盖普通 Note 8,000 字符占位提示/编辑上限、关联 Markdown Note 不使用普通 Note 编辑上限、编辑期外部刷新、Host dirty-conflict 阻止旧草稿静默写回或丢失、Host dirty-conflict 重新 bootstrap 只提供重新加载并阻止 checklist 绕过恢复、subtitle、完整路径警告、缺失警告和空白画布拖拽消息

       npm run test:webview -- --grep "ordinary note empty|associated markdown|missing associated markdown|ordinary note save-as-markdown|dropping markdown"
       Playwright webview tests passed；本轮重跑 9 个相关用例，覆盖普通 Note 上限提示、关联 Markdown 渲染/编辑/冲突恢复、缺失警告、保存为 Markdown 按钮与空白画布拖拽消息

       npm run test:webview -- --grep "associated markdown notes render|missing associated markdown notes"
       Playwright webview tests passed；本轮覆盖关联 Markdown Note 使用完整 subtitle 文本、节点宽度不足时显示完整 tooltip，以及缺失状态继续显示同一条人类可读路径

       npm run test:webview -- --grep "associated markdown note (persists|restores|editing blocks|keeps|bootstrapped)"
       Playwright webview tests passed；本轮覆盖编辑 draft 上报、外部刷新冲突保护、Host dirty-conflict 保留草稿引用、带已 hydrate recoverableDraft content 重新 bootstrap 的草稿恢复/覆盖入口，以及无草稿内容 dirty-conflict 只提供重新加载

       npm run test:webview -- --grep "associated markdown note (persists|restores|bootstrapped)"
       Playwright webview tests passed；本轮覆盖 storage-backed draft 方案下的编辑 draft 上报、Host hydrate 后恢复/覆盖入口，以及只有 draft 引用但无 content 时只提供重新加载

       npm run test:webview -- --grep "associated markdown note restores a persisted dirty-conflict draft"
       Playwright webview tests passed；本轮覆盖复制草稿按钮发出 webview/copyAssociatedNoteMarkdownDraft，且不影响后续覆盖文件动作

       node --check tests/vscode-smoke/extension-tests.cjs
       通过

       npm run build
       通过

       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
       Trusted workspace smoke passed；VS Code smoke test passed；覆盖超过 8,000 字符的关联 Markdown 读取与写回不截断、打开但未保存的 VSCode editor 草稿不会改变 Note 内容且保存后才刷新、stale revision 写回进入 dirty-conflict 且不覆盖真实文件、recoverableDraft 随 dirty-conflict 持久化并在 reloadPersistedStateForTest 后保留、重新 bootstrap 持久化 dirty-conflict 只显示恢复警告、关联文件 displayPath / fullDisplayPath、已关联文件再次拖入的添加/定位分支、modal 路径复用 subtitle displayPath，以及不再传入重复“取消”按钮。本轮已把这一路径改成 storage-backed draft，待下次完整 smoke 复核真实宿主 draft 文件内容断言。

       git diff --check
       通过

       npm run typecheck
       通过；本轮复核运行时 edit session / 协议扩展 / Webview 可编辑冲突提示类型

       npm run test:webview -- --grep "associated markdown note (editing blocks|warns when an edited draft sees a file revision change|accepts a file revision change before the draft is edited|keeps|restores a persisted dirty-conflict draft|persists an edit draft)"
       Playwright webview tests passed；覆盖编辑期外部刷新后立即显示冲突提示、textarea 继续可编辑、失焦不静默写回、显式覆盖携带原始 base revision、用户已编辑草稿后同内容 revision-only 变化也提示、用户尚未编辑草稿时 revision 变化只更新基线、Host dirty-conflict 和持久化 dirty-conflict 草稿恢复后仍可编辑

       npm run test:note-markdown-file-association
       note markdown file association tests passed；复核关联 Markdown 纯函数基线

       node --check tests/vscode-smoke/extension-tests.cjs
       通过

       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
       Trusted workspace smoke passed；VS Code smoke test passed；覆盖真实 VSCode 宿主中 begin edit session 后外部落盘修改会在提交前进入 dirty-conflict，并把当前编辑态内容写入 storage-backed draft 文件

       git diff --check
       通过

       npm run typecheck
       通过；本轮复核 `recoverableDraft` 模型重命名后的类型边界

       npm run test:note-markdown-file-association
       note markdown file association tests passed；覆盖刷新草稿保留策略改名、legacy `conflictDraft` 读取迁移、持久化剥离 runtime `content`，并约束旧字段只出现在迁移/剥离代码

       npm run test:canvas-templates
       通过；复核路径+内容模板冲突继续创建 storage-backed `recoverableDraft`

       node --check tests/vscode-smoke/extension-tests.cjs
       通过；smoke 语法有效性复核，包含 legacy `conflictDraft` 种子迁移断言

       npm run test:webview -- --grep "associated markdown note (persists an edit draft|clears a reverted edit draft|warns when an edited draft sees a file revision change|keeps a rejected stale draft|restores a persisted dirty-conflict draft|bootstrapped with dirty-conflict shows reload recovery only)"
       Playwright webview tests passed；6 个关联 Markdown 草稿/冲突恢复用例通过，覆盖 `recoverableDraft` Webview hydration、无草稿 reload-only 和活跃草稿保留路径

       git diff --check
       通过

       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
       Trusted workspace smoke passed；VS Code smoke test passed；复核真实 VSCode 宿主中的关联 Markdown 草稿迁移、storage-backed draft 与恢复路径

       npm run test:vsix-smoke
       VSIX packaged-payload smoke passed；复核 packaged VSIX 载荷中的 `recoverableDraft` 迁移与真实宿主 smoke 路径

剩余验证缺口：

- Quick Input 的真实键盘导航和已有文件三选项已经在 Host 代码中实现，但当前自动化没有直接模拟用户在 VSCode Quick Input / modal 中分别选择“覆盖文件并关联”“保留文件内容并关联”“取消”。后续如果继续强化回归保护，可在 smoke 中补充针对 `createQuickPick` 与 `showWarningMessage` 的拦截式命令测试。

## 上下文与定向

本仓库是一个 VSCode workspace extension。`Extension Host` 持有画布权威状态，`Webview` 负责 React / React Flow 呈现和局部交互，二者通过 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中的消息协议通信。执行者需要始终记住：节点图和持久化真相在 Host 侧，Webview 只能请求操作和展示 Host 广播的状态。

当前与 `Note` 相关的主要路径如下。

`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 定义跨边界模型。`CanvasNodeKind` 已包含 `note`，`NoteNodeMetadata` 当前只有 `content: string`。`WebviewToHostMessage` 已有 `webview/updateNoteNode`，payload 是 `nodeId` 和 `content`；也已有 `webview/openNoteLink` 给 Markdown 预览链接使用。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是 Host 侧状态中枢。它创建 Note、持久化画布状态、处理 `webview/updateNoteNode`，并且已经有 `openCanvasFile()` 与 `openNoteLink()` 可以把工作区文件或外部链接交给 VSCode 打开。新增 Markdown 文件关联能力应主要在这里编排，或者拆出 Host 侧 helper 模块再由这里调用。

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 渲染节点。`NoteEditableNode` 维护本地正文草稿、编辑态 textarea 和阅读态 Markdown 预览，编辑提交后发送 `webview/updateNoteNode`。本轮需要让它支持 title 下方 subtitle、文件不可用警告，以及空白画布拖拽 Markdown 文件创建关联 Note 的消息。

`extensions/vscode/dev-session-canvas/src/webview/styles.css` 定义 Note 表面样式。subtitle 与不可用警告应继续使用 VSCode 主题 token，保持低噪音工具型画布风格。

测试主要在 `tests/playwright/webview-harness.spec.mjs` 和 `tests/vscode-smoke/extension-tests.cjs`。Playwright harness 适合验证 Webview DOM 呈现、菜单、拖放和消息；VSCode smoke 适合验证 Host 文件系统、Quick Input / 命令、持久化恢复和真实工作区文件写入。纯函数测试通常放在 `scripts/test/test-*.mjs` 或 `scripts/test/test-*.mts` 中，并通过 `package.json` 脚本接入。

这次实现需要新增三个普通术语：

“普通 Note”指 `NoteNodeMetadata.contentSource` 缺失或为 `embedded` 的节点，它的正文权威数据保存在画布状态中。

“关联 Markdown Note”指 `contentSource.kind === 'markdown-file'` 的节点，它的正文权威数据来自 `.md` 或 `.markdown` 文件。节点 metadata 中的 `content` 只是 Host 读取后发给 Webview 的当前展示/编辑缓冲。

“resource URI”指 VSCode 用来标识文件资源的 URI 字符串，例如 `file:///path/to/a.md`。它比裸 `fsPath` 更适合持久化，因为 Remote、Dev Container 或其他文件系统 scheme 可能不等同于本机绝对路径。

## 工作计划

第一步更新文档引用，把 `docs/design-docs/note-markdown-file-association.md` 的 `related_plans` 指向本文，并同步 `docs/design-docs/index.md` 的关联计划字段。这样设计结论与实施过程可以相互追踪。

第二步盘点现有代码并补共享模型。先在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 为 `NoteNodeMetadata` 增加向后兼容的 `contentSource` 字段，并扩展或新增 Webview -> Host 消息：普通编辑继续使用 `webview/updateNoteNode`；保存为 Markdown、拖拽 Markdown 文件创建关联 Note、打开关联文件可以使用新消息。再新增一个 `extensions/vscode/dev-session-canvas/src/common/noteMarkdownFileAssociation.ts` 纯函数模块，放置扩展名校验、文件名安全化、标题到默认文件名、URI/display path 的纯逻辑。纯函数要能被脚本测试直接覆盖。

第三步实现 Host 侧能力。优先在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中添加入口方法，必要时拆出 `extensions/vscode/dev-session-canvas/src/panel/noteMarkdownFileAssociation.ts` 保存 Host 侧 IO helper。Host 需要完成：默认路径生成、Quick Input 导航、目标文件 stat、已有文件冲突选择、写入或读取文件、把节点 metadata 切换为 `markdown-file`、打开关联文件、监控文件变化、恢复时重新读取文件、文件不可用时设置状态。所有写入和读取都以磁盘落盘内容为准，打开但未保存的 dirty 文档不参与同步。

第四步实现 Webview 呈现与拖拽。`NoteEditableNode` 读取 metadata 后，如果是关联 Markdown Note，就在标题下方显示 subtitle；如果状态不是 `ok`，正文区显示不可用警告，不显示普通 Markdown 正文。编辑提交仍发送内容到 Host，由 Host 决定写入画布状态还是关联文件。画布空白区拖拽 `.md` / `.markdown` 文件时，Webview 把释放点和拖拽资源发给 Host；Host 创建一个或多个关联 Note，并在释放点附近轻微错位。

第五步补测试和验证。纯函数测试覆盖扩展名、文件名安全化、默认路径、display path。Playwright 测试覆盖 subtitle、不可用警告、拖拽空白区发送消息且拖到执行节点不走创建路径。VSCode smoke 覆盖真实文件写入、已有文件三选项、删除节点不删文件、缺失文件警告和恢复后重新读取。

## 具体步骤

1. 文档同步。在仓库根目录执行编辑，更新：

       docs/design-docs/note-markdown-file-association.md
       docs/design-docs/index.md
       docs/exec-plans/active/note-markdown-file-association.md

   预期结果是设计文档 frontmatter 的 `related_plans` 包含本文路径，索引行的关联规格/计划也包含本文路径。

2. 代码盘点。用以下命令确认当前 Note 相关路径：

       rg -n "NoteNodeMetadata|updateNoteNode|openNoteLink|kind === 'note'|createNoteMetadata|ensureNoteMetadata" src tests scripts
       rg -n "drag|drop|dataTransfer|onDrop|dropped" extensions/vscode/dev-session-canvas/src/webview/main.tsx extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts extensions/vscode/dev-session-canvas/src/common/protocol.ts

   预期看到 `NoteNodeMetadata` 在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts`，Note 编辑提交在 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 和 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`，拖放已有能力主要服务执行节点资源输入。

3. 共享模型与纯函数。新增或更新：

       extensions/vscode/dev-session-canvas/src/common/protocol.ts
       extensions/vscode/dev-session-canvas/src/common/noteMarkdownFileAssociation.ts
       scripts/test/test-note-markdown-file-association.mjs 或 .mts
       package.json

   在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中引入类似以下模型，实际字段名可以根据实现调整，但必须保持设计文档的语义：

       export type NoteContentSource =
         | { kind: 'embedded' }
         | {
             kind: 'markdown-file';
             resourceUri: string;
             displayPath: string;
             status: NoteMarkdownFileStatus;
             lastError?: string;
           };

       export interface NoteNodeMetadata {
         content: string;
         contentSource?: NoteContentSource;
       }

   新增消息至少覆盖：保存普通 Note 为 Markdown 文件、拖拽 Markdown 文件创建关联 Note、打开关联文件。消息解析函数必须 fail closed：payload 缺字段、坐标不是 finite number、URI/path 不是字符串时返回 `null`。

4. Host 侧实现。更新或新增：

       extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts
       extensions/vscode/dev-session-canvas/src/panel/noteMarkdownFileAssociation.ts
       extensions/vscode/dev-session-canvas/src/common/extensionIdentity.ts
       package.json
       package.nls.json
       extensions/vscode/dev-session-canvas/src/extension.ts

   命令和 UI 入口命名应遵循现有 `devSessionCanvas.*` 约定。保存为 Markdown 的流程必须由 Host 执行，因为只有 Host 能可靠访问 VSCode workspace、Quick Input、文件系统和 Remote URI。Quick Input 导航应展示当前目录子目录和 `.md` / `.markdown` 文件；如果完整复刻 VSCode 打开文件体验成本过高，第一版也必须满足“输入路径时可看到当前目录下可选目录和 Markdown 文件”的验收要求。

5. Webview 实现。更新：

       extensions/vscode/dev-session-canvas/src/webview/main.tsx
       extensions/vscode/dev-session-canvas/src/webview/styles.css

   `NoteEditableNode` 中 title 下方新增 subtitle 区域。关联文件状态不是 `ok` 时，正文区域显示警告文案。画布空白区的 drag/drop handler 只在没有命中节点交互区域时触发；现有执行节点拖放资源输入不能被破坏。

6. 测试实现。优先补低成本测试，再补 smoke：

       npm run test:note-markdown-file-association
       npm run test:webview -- --grep "markdown file note|note file association"
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs

   如果新增 smoke filter，需要在测试文件里登记清楚名称；如果没有新增 filter，则运行相关 trusted smoke 并记录实际命令。

7. 全量基础验证。在仓库根目录运行：

       git diff --check
       npm run typecheck
       npm run test:note-markdown-file-association
       npm run test:webview

   如果 smoke 成本可接受，再运行：

       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs

   完成后把输出摘要写回本计划 `结果与复盘`，并把设计文档 `validation_status` 从 `未验证` 更新为与实际结果一致的状态。

## 验证与验收

本计划完成时，至少应满足以下可观察行为。

用户创建普通 `Note` 后，节点没有文件 subtitle，编辑正文仍写入画布状态，重载后内容恢复。

用户对普通 `Note` 执行“保存为 Markdown 并关联”时，默认路径是 `<workspace root>/<safe title>.md`。用户可以在 Quick Input 中进入目录、选择 `.md` / `.markdown` 文件，或输入新文件名。确认一个不存在的目标文件后，文件被创建，内容等于原 Note 正文，节点变成关联 Markdown Note，subtitle 显示路径。

当目标文件已存在时，用户会看到明确选择。如果选“覆盖文件并关联”，文件内容变成原 Note 正文；如果选“保留文件内容并关联”，节点正文显示现有文件内容；如果选“取消”，原普通 Note 和目标文件都不变。

关联 Markdown Note 编辑正文后，关联文件内容随提交更新。该内容以磁盘落盘内容为唯一基线；VS Code 中打开但未保存的 editor buffer 不参与 Note 同步。若提交时磁盘版本已经变化，扩展会进入 `dirty-conflict` 并要求用户重新加载或显式覆盖。

关联文件被删除、移动、替换为目录或变得不可读后，节点显示“关联的 Markdown 文件不可用”警告，并继续显示 title 与 subtitle。节点不提供解除关联。删除节点不删除文件。

把一个或多个 `.md` / `.markdown` 文件拖到画布空白区域释放，会在释放点附近创建对应数量的关联 Note。拖非 Markdown 文件或目录不会创建节点。把文件拖到 Terminal / Agent 节点上的既有行为不被破坏。

自动化验证应覆盖以上主路径。至少 `git diff --check`、`npm run typecheck` 和新增纯函数测试必须通过；Webview 与 smoke 覆盖应按实际实现记录命令和结果。

## 幂等性与恢复

本计划中的文档编辑和纯函数新增可以安全重复执行。新增命令、协议字段和测试时，应保持向后兼容：旧画布快照中缺失 `contentSource` 的 Note 必须继续被视为普通 Note。

文件写入相关实现必须谨慎处理失败。保存为 Markdown 的转换流程在最终文件写入和节点状态切换都成功前，不应破坏原普通 Note。若写文件失败、用户取消、目标是目录或扩展名不支持，Host 必须保持节点原样，并显示错误提示。

已有文件覆盖是唯一可能破坏用户数据的路径，必须被用户显式确认。实现或测试不得使用 `git reset --hard`、`git checkout --` 或删除用户未跟踪文件。当前工作树中已有未跟踪文件 `image copy.png`、`image.png`、`xxxx.prompts.md`，本计划不触碰它们。

如果实现中发现某个平台或 Remote 拖放路径无法可靠支持，应先 fail closed，并在 `意外与发现` 和 `结果与复盘` 中记录限制；不要为了让单个平台测试通过而放宽 Host 侧校验。

## 证据与备注

初始文档验证已经完成：

       python3 文档空白检查：doc whitespace check passed
       git diff --check -- docs/design-docs/index.md：无输出，表示通过

当前分支与工作树状态摘要：

       ## docs/note-markdown-file-association...origin/main
        M docs/design-docs/index.md
        M package.json
        M package.nls.json
        M extensions/vscode/dev-session-canvas/src/common/extensionIdentity.ts
        M extensions/vscode/dev-session-canvas/src/common/protocol.ts
        M extensions/vscode/dev-session-canvas/src/extension.ts
        M extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts
        M extensions/vscode/dev-session-canvas/src/webview/main.tsx
        M extensions/vscode/dev-session-canvas/src/webview/styles.css
        M tests/playwright/webview-harness.spec.mjs
        M tests/vscode-smoke/extension-tests.cjs
       ?? docs/design-docs/note-markdown-file-association.md
       ?? docs/exec-plans/active/note-markdown-file-association.md
       ?? image copy.png
       ?? image.png
       ?? scripts/test/test-note-markdown-file-association.mts
       ?? extensions/vscode/dev-session-canvas/src/common/noteMarkdownFileAssociation.ts
       ?? xxxx.prompts.md

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中必须存在一个可序列化的 Note 内容来源模型。字段可以在实现中微调，但必须表达以下信息：普通内嵌来源、Markdown 文件来源、资源 URI、展示路径、文件状态和可选错误信息。

在 `extensions/vscode/dev-session-canvas/src/common/noteMarkdownFileAssociation.ts` 中应提供纯函数，至少覆盖：

       isSupportedNoteMarkdownFilePath(pathOrUri: string): boolean
       sanitizeNoteMarkdownFileName(title: string): string
       createDefaultNoteMarkdownFileName(title: string): string
       normalizeNoteMarkdownDisplayPath(...): string

如果函数签名需要引入 workspace folder 或 URI 参数，可以调整，但调用者必须能用它们完成默认路径、扩展名校验和 subtitle 展示。

在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 或 `extensions/vscode/dev-session-canvas/src/panel/noteMarkdownFileAssociation.ts` 中应提供 Host 侧流程函数，至少覆盖：普通 Note 转 Markdown 文件、关联文件读取、关联文件写入、关联文件 stat/status 刷新、拖拽资源创建关联 Note。

Webview -> Host 消息必须通过 `parseWebviewToHostMessage()` 校验。任何拖拽资源、路径或 URI 都不能只靠 Webview 判断合法；Host 必须重新 stat/read/write 校验。

本功能不需要新增运行时依赖。如果为了 Quick Input 导航或 URI 处理确实需要新依赖，必须先在本计划 `决策记录` 说明为什么 VSCode / Node 标准库能力不足，并补充验证与许可证影响。

## 修订记录

- 2026-05-13 / Codex：创建本计划，承接 `docs/design-docs/note-markdown-file-association.md` 的已选定方案，准备进入实现阶段。
- 2026-05-13 / Codex：完成实现、测试与验证记录；保留 Quick Input 既有文件三选项自动化验证缺口。
- 2026-05-13 / Codex：按用户纠正重梳同步模型，关联 Markdown 只以磁盘内容为权威；打开但未保存的 VSCode editor buffer 不再参与读取、刷新或写回基线。
