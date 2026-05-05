# 为 Note Markdown 预览补齐交互式 checklist

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划原始路径是 `docs/exec-plans/active/note-markdown-interactive-checklists.md`，完成后已移至 `docs/exec-plans/completed/note-markdown-interactive-checklists.md`；文档内容仍按 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

这次变更要把 Note Markdown 阅读态里的 checklist 从“只读展示”升级成“可直接勾选并回写 Markdown 源文”。完成后，用户在 Note 中写 `- [ ] 补测试` 或 `1. [x] 收口文档`，无需切回纯文本编辑态，就可以在预览里直接点击 checkbox 切换完成状态；宿主持久化仍然只保存原始 Markdown 文本，不引入富文本对象模型。

用户可直接观察到的结果是：阅读态里的 checkbox 不再只是装饰；点击后会立即切换勾选状态，原始 Markdown 正文同步从 `[ ]` 与 `[x]` 之间切换，且点击 checkbox 时不会误进入编辑态。

## 进度

- [x] (2026-05-06 00:07 +0800) 复盘现有 Note Markdown 预览、链接打开链路与测试入口，确认本轮只补交互式 checklist，不改富文本模型。
- [x] (2026-05-06 00:12 +0800) 新建本 ExecPlan，记录交互式 checklist 的范围、点击语义分流和验证口径。
- [x] (2026-05-06 00:18 +0800) 更新设计文档、规格文档与本计划，把 Note 阅读态中的 checklist 从“只读展示”升级成正式支持交互。
- [x] (2026-05-06 00:26 +0800) 实现 Markdown checklist 的预览态点击回写逻辑，并保持 checklist / 链接 / 编辑三类点击行为不冲突。
- [x] (2026-05-06 00:34 +0800) 补齐纯函数脚本测试、Playwright 回归与真实 smoke DOM action，并完成验证与复盘。

## 意外与发现

- 观察：当前 `markdown-it-task-lists` 已接入，但配置为 `enabled: false`，因此渲染出的 checkbox 自带 `disabled` 属性，且样式层也把 `pointer-events` 关掉了。
  证据：`src/webview/main.tsx` 的 `createNoteMarkdownRenderer()` 当前以 `renderer.use(markdownItTaskLists, { enabled: false })` 注册插件；`src/webview/styles.css` 的 `.task-list-item-checkbox` 当前有 `pointer-events: none`。

- 观察：当前 Note 阅读态的预览点击逻辑只区分“链接”和“其他正文”，其余点击都会进入编辑态。
  证据：`src/webview/main.tsx` 的 `handlePreviewClick()` 当前只先检查 `findNoteMarkdownLinkTarget()`，否则直接调用 `startEditingBody()`。

- 观察：`markdown-it` 的 inline token `map` 已经能稳定给出当前任务项起始行号，因此不需要额外构建 Markdown AST 或持久化映射表，就能把 checkbox 点击回写到对应源文行。
  证据：`createNoteMarkdownRenderer()` 中 `github-task-lists` 之后的 core rule 可以读取每个 `inline` token 的 `map[0]`，并把它注入到渲染后的 checkbox `data-note-markdown-task-line` 属性。

- 观察：真实 VS Code smoke 需要通过专用 DOM action 命中渲染后的 preview checkbox；仅复用现有 `setNodeTextField('body')` 无法覆盖“保持预览态但仍回写宿主”的交互。
  证据：`tests/vscode-smoke/extension-tests.cjs` 现有 DOM action 只覆盖文本写入、点击按钮和文件树，新增 `toggleNoteChecklistItem` 后才能直接驱动 preview checkbox。

## 决策记录

- 决策：交互式 checklist 继续沿用原始 Markdown 文本作为唯一权威数据，通过回写对应源文行的 `[ ]` / `[x]` 标记实现状态切换。
  理由：这样可以复用现有 `webview/updateNoteNode` 持久化主路径，避免引入单独的 checklist 状态字段或 HTML 到 Markdown 的双向同步层。
  日期/作者：2026-05-06 / Codex

- 决策：当前仓库口径下，只有真正由 Markdown checklist 语法渲染出来的 checkbox 可交互；普通正文单击保留预览、双击进入编辑，链接点击仍走宿主打开链路。
  理由：这能把四类交互语义分清：checkbox 负责切换完成状态，链接负责跳转，单击正文负责选择/复制，双击正文负责进入编辑，避免交互冲突。
  日期/作者：2026-05-06 / Codex

- 决策：checkbox 到源文的定位采用“渲染时注入行号元数据 + 改写时再次校验源文行是否仍是合法 checklist”的 fail-closed 方案。
  理由：这样无需维护独立的 checklist 对象模型，也能避免在 DOM 与源文漂移时误改正文；最坏情况只是当前点击被安全忽略。
  日期/作者：2026-05-06 / Codex

## 结果与复盘

本轮已经把 Note Markdown 阅读态中的 checklist 从“只读视觉元素”升级成“可直接勾选并回写 Markdown 源文”的工作表面。`src/common/noteMarkdownChecklist.ts` 负责按源文行切换 `[ ]` / `[x]` 标记，支持无序列表、有序列表、大写 `X`、blockquote 前缀和嵌套缩进场景；`src/webview/main.tsx` 则在渲染时给 checkbox 注入源文行号元数据，并在 preview 点击时复用现有 `webview/updateNoteNode` 持久化主路径。

后续同主题交互收口后，当前仓库中的点击语义已进一步分流为：checkbox 点击只切换完成状态，不进入编辑；Markdown 链接点击继续走宿主安全打开链路；普通正文单击保留预览以便选择/复制，双击才进入纯文本编辑态。若 checkbox 缺少合法源文行号、命中的源文行已不再是 checklist，系统会 fail closed，不产生异常写入。

验证已完成：`npm run typecheck`、`npm run test:note-markdown-checklists`、`npm run test:webview -- --grep "note markdown|checklist"` 与 `npm run test:smoke` 均通过，其中 smoke 覆盖了 trusted / restricted workspace、real reopen 与 remote reopen 主路径。本轮没有新增需要登记到 `docs/exec-plans/tech-debt-tracker.md` 的遗留技术债。

## 上下文与定向

本轮相关文件如下：

- `src/webview/main.tsx`：Note 阅读态预览、Markdown 渲染器和预览点击处理都在这里；本轮主实现落点在此。
- `src/webview/styles.css`：checkbox 的鼠标命中、视觉反馈和主题跟随样式需要在这里调整。
- `src/common/protocol.ts`：如果 smoke 需要新增 DOM action 来驱动真实 checkbox 点击，这里要补测试协议。
- `tests/playwright/webview-harness.spec.mjs`：需要补“点击 checkbox 后回写 Markdown 且不进入编辑态”的 Webview 回归。
- `tests/vscode-smoke/extension-tests.cjs`：需要补真实 VS Code Webview 下的 checkbox 点击验证，证明主宿主持久化路径生效。
- `docs/design-docs/note-markdown-preview-rendering.md` 与 `docs/product-specs/canvas-core-collaboration-mvp.md`：要把 checklist 从“只读展示”更新成正式支持交互。

这里的“交互式 checklist”指 Markdown 语法 `- [ ] item`、`- [x] item`、`- [X] item`、有序列表版本 `1. [ ] item`，以及带 blockquote / 嵌套前缀的这些标准 task list 变体，在阅读态都可直接点击 checkbox 切换状态。这里的“回写源文”指把原始 Markdown 对应行的标记从 `[ ]` 改成 `[x]`，或从 `[x]` / `[X]` 改回 `[ ]`。

## 工作计划

先同步文档，把 Note Markdown 阅读态从“任务列表只读展示”更新为“任务列表可直接切换完成状态，但仍不升级为富文本编辑器”。同时明确边界：只支持由 Markdown task list 语法产生的 checkbox；不支持原始 HTML 注入出来的自定义复选框，也不支持在预览态直接修改任务文本本身。

然后在 Webview 里补主实现。`markdown-it-task-lists` 需要切到可交互模式，并给每个 checkbox 附上可追溯到 Markdown 源文行号的元数据。点击 checkbox 时，不进入编辑态，而是基于当前原始 Markdown 文本精确改写对应行的 `[ ]` / `[x]` 标记，再复用现有 `onUpdateNote` / `webview/updateNoteNode` 提交流程持久化。

最后补验证。纯函数层需要证明 checklist 行改写逻辑能处理无序/有序列表、blockquote / 嵌套前缀与 fail-closed 场景；Playwright harness 需要证明点击 checkbox 会发出正文更新而非切换到编辑态；真实 smoke 需要证明 VS Code 宿主里的真实 DOM 点击也能更新宿主状态与 probe 结果。

## 具体步骤

1. 更新 `docs/design-docs/note-markdown-preview-rendering.md`、`docs/design-docs/index.md` 和 `docs/product-specs/canvas-core-collaboration-mvp.md`。
2. 新增一个纯函数辅助模块，负责按源文行切换 Markdown checklist 标记，并补对应脚本测试。
3. 修改 `src/webview/main.tsx`，让渲染出的 checklist checkbox 带上源文定位信息，并在预览态点击时回写 Markdown。
4. 修改 `src/webview/styles.css`，恢复 checkbox 命中能力并补交互态样式。
5. 如有需要，扩展 `src/common/protocol.ts` 与 `src/webview/main.tsx` 的 test DOM action，支持 smoke 驱动真实 checkbox 点击。
6. 更新 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs`。
7. 运行：
   - `npm run typecheck`
   - `npm run test:note-markdown-checklists`
   - `npm run test:webview -- --grep "note markdown|checklist"`
   - `npm run test:smoke`

## 验证与验收

完成时至少满足以下条件：

- 阅读态里的 Markdown checklist checkbox 可直接点击切换。
- 点击 checkbox 后不会误进入编辑态，也不会走链接打开链路。
- 原始 Markdown 文本会按对应源文行回写 `[ ]` / `[x]` 标记。
- 非 checklist 正文单击仍保留预览且可选择复制；双击仍进入编辑态，链接点击仍保持原有行为。
- `npm run typecheck`、新增 checklist 纯函数测试、相关 `test:webview` 回归和 `npm run test:smoke` 通过。

## 幂等性与恢复

- 对同一条 checklist 连续点击两次，应稳定在 `[ ]` 与 `[x]` 之间往返切换，不应引入额外空格、重复标记或破坏列表缩进。
- 如果某个 preview checkbox 无法映射到合法源文行，系统必须 fail closed：不切换内容、不进入编辑态、不产生异常宿主状态。
- reload 后阅读态应继续从宿主持久化的原始 Markdown 文本恢复 checkbox 状态，而不是依赖上一次的 DOM 勾选结果。

## 证据与备注

关键验证结果如下：

    npm run typecheck
    -> 通过

    npm run test:note-markdown-checklists
    -> note markdown checklist tests passed

    npm run test:webview -- --grep "note markdown|checklist"
    -> 8 passed

    npm run test:smoke
    -> Trusted workspace smoke passed.
    -> Restricted workspace smoke passed.
    -> Fake legacy real window reopen smoke passed.
    -> Fake systemd-user real window reopen smoke passed.
    -> Fake systemd-fallback real window reopen smoke passed.
    -> Remote SSH real window reopen smoke passed.
    -> VS Code smoke test passed.

## 接口与依赖

- `src/common/noteMarkdownChecklist.ts`

    export function toggleNoteMarkdownChecklistAtLine(content: string, lineNumber: number): string | null

  该函数负责把原始 Markdown 文本的指定行从 `[ ]` 切到 `[x]`，或从 `[x]` / `[X]` 切回 `[ ]`。

- `src/webview/main.tsx`

    function NoteEditableNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element

  预览态 checkbox 点击将在这里分流，不复用“普通正文进入编辑态”的路径。

更新说明：

- 2026-05-06 00:07 +0800，新建本计划，记录交互式 checklist 的范围、实现顺序与验证口径。
- 2026-05-06 00:34 +0800，补齐实现、验证与复盘，确认本轮完成并移入 `completed/`。
