# 为 Note 增加 Markdown 预览展示模式

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划原始路径是 `docs/exec-plans/active/note-markdown-preview-rendering.md`，完成后已移至 `docs/exec-plans/completed/note-markdown-preview-rendering.md`；文档内容仍按 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

这次变更要把 `Note` 从“始终显示纯文本 textarea”升级成“编辑时保留纯文本输入，阅读时按 Markdown 预览渲染”的工作笔记窗口。完成后，用户在 `Note` 节点里输入 `# 标题`、列表、代码块或链接时，聚焦编辑区会看到原始 Markdown 文本；一旦结束编辑，正文区会回到阅读态，并按 Markdown 预览展示，而不是继续暴露原始语法符号。

用户最容易观察到的结果是：新建或已有 `Note` 在未编辑时会像轻量文档一样展示标题、段落、列表与代码块；点击正文区后会切换到纯文本编辑；失焦或提交后又回到预览态。已有持久化数据仍然只保存原始文本，不新增富文本结构。

## 进度

- [x] (2026-05-05 21:35 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/workflows/BRANCH.md` 与现有 `Note` 相关设计文档，确认本轮属于需要正式留痕的交付性功能开发。
- [x] (2026-05-05 21:36 +0800) 从 `origin/main` 切出主题分支 `note-markdown-preview-rendering`。
- [x] (2026-05-05 21:45 +0800) 新建本 ExecPlan，并记录 Markdown 预览模式的范围、验证口径与关键文件。
- [x] (2026-05-05 21:46 +0800) 更新正式设计文档与产品规格，明确 `Note` 的“编辑态 / 预览态”边界。
- [x] (2026-05-05 21:49 +0800) 实现 Webview 侧 `Note` 正文的 Markdown 预览、纯文本编辑切换与样式。
- [x] (2026-05-05 21:50 +0800) 调整测试探针与 DOM action，保证现有 smoke / harness 仍能驱动 `Note` 正文写路径。
- [x] (2026-05-05 21:51 +0800) 更新自动化测试，覆盖 Markdown 预览展示与回到纯文本编辑的主路径。
- [x] (2026-05-05 21:59 +0800) 运行 `npm run typecheck`、`npm run test:webview`、`npm run test:smoke`，补齐结果与复盘。

## 意外与发现

- 观察：当前 `Note` 正文始终是一个 `textarea`，没有单独的阅读态，因此任何 Markdown 语法都会原样暴露在画布上。
  证据：`src/webview/main.tsx` 的 `NoteEditableNode` 当前直接渲染 `textarea.note-document-input`，不存在正文预览分支。

- 观察：现有真实 DOM 测试与 probe 快照都把 `data-probe-field="body"` 视为一个表单控件，因此如果阅读态改成普通 `div`，测试辅助层也必须同步适配。
  证据：`src/webview/main.tsx` 的 `queryNodeTextField()` 只接受 `HTMLInputElement | HTMLTextAreaElement`；`readProbeFieldValue()` 也只读取 `.value`。

- 观察：仓库当前没有把 Markdown 渲染库声明为直接依赖，虽然 `package-lock.json` 里出现了 `markdown-it` 的传递依赖记录，但工作区根目录并没有可直接导入的包。
  证据：在仓库根目录执行 `node -e "require('./node_modules/markdown-it/package.json')"` 会得到 `MODULE_NOT_FOUND`。

- 观察：正文从“始终挂载 textarea”改成“编辑/预览切换”后，如果仍沿用原来的 `useLayoutEffect` 同步逻辑，失焦瞬间会被旧的宿主 props 覆盖，看起来像正文更新失败。
  证据：新增的 Playwright 用例首次失败时，`textarea` 退出后没有渲染新的 `h2`，因为本地草稿在宿主回写前被 `noteMetadata.content` 回滚。

- 观察：`markdown-it` 当前没有随包附带 TypeScript 声明，因此除了运行时依赖，还需要补 `@types/markdown-it` 才能通过 `tsc --noEmit`。
  证据：首次运行 `npm run typecheck` 报错 `TS7016: Could not find a declaration file for module 'markdown-it'`。

- 观察：Markdown 预览会改变基线画面里的 `Note` 正文排版，因此现有 `canvas-shell-baseline.png` 截图基线必须同步更新。
  证据：首次运行 `npm run test:webview` 时，仅 `webview bundle emits ready and matches the baseline screenshot` 因 3178 个像素差异失败。

## 决策记录

- 决策：`Note` 的权威正文仍然只保存原始 Markdown 文本，不新增预渲染 HTML 或块级结构。
  理由：宿主状态、持久化和侧栏摘要已经围绕 `metadata.note.content` 建立；本轮目标是展示层升级，不是把 `Note` 变成富文本对象模型。
  日期/作者：2026-05-05 / Codex

- 决策：正文模式切换采用“阅读态点击进入编辑、编辑失焦后回到预览”的单区模型，而不是常驻双栏或显式切换按钮。
  理由：`Note` 节点尺寸有限，双栏会挤压正文；显式按钮会增加一次额外交互，与当前节点内直接编辑路径不一致。
  日期/作者：2026-05-05 / Codex

- 决策：Markdown 预览默认关闭原始 HTML 透传，并把正文预览视为阅读面而不是链接激活面。
  理由：当前画布里 `Note` 是工作上下文笔记，不应把任意 HTML 注入到 Webview；同时正文点击需要稳定进入编辑，不能因为链接可点击而破坏主路径。
  日期/作者：2026-05-05 / Codex

## 结果与复盘

本轮已经完成 `Note` 正文的“纯文本编辑 / Markdown 预览”双态收口。`src/webview/main.tsx` 现在在阅读态渲染 Markdown 预览容器，点击后切到 `textarea`；失焦或提交后回到预览态。宿主持久化结构没有变化，`src/panel/CanvasPanelManager.ts` 仍然只保存 `metadata.note.content` 原始文本。

为避免阅读态切换时被旧 props 回滚，组件侧额外补了一层 pending content 协调，让本地提交在宿主回写到达前也能保持乐观显示。probe 与 test DOM action 也同步适配了阅读态：阅读态使用 `data-probe-value` 暴露原始文本，`setNodeTextField(field: 'body')` 会先点击预览进入编辑态，再写入真实 `textarea`。

本轮没有新增需要继续登记的技术债。后续如果要支持链接点击、代码块复制或交互式 checklist，应单独立项，不应在当前“轻量笔记预览”能力上继续堆叠隐式交互。

## 上下文与定向

本轮直接相关的关键文件如下：

- `src/webview/main.tsx`：`NoteEditableNode`、测试 probe、test-only DOM action 都在这里，需要同时处理正文模式切换、Markdown 渲染与测试辅助层兼容。
- `src/webview/styles.css`：`Note` 正文、预览态排版、代码块、引用块、空态提示等样式要在这里补齐。
- `src/panel/CanvasPanelManager.ts`：宿主持久化状态仍然通过 `metadata.note.content` 保存正文；本轮应确认宿主无需引入新字段。
- `src/common/protocol.ts`：`WebviewProbeNodeSnapshot` 与 `WebviewDomAction` 的校验逻辑可能需要适配正文从输入控件切换为预览 DOM 的情况。
- `tests/playwright/webview-harness.spec.mjs`：浏览器 harness 需要新增 Markdown 预览主路径断言。
- `tests/vscode-smoke/extension-tests.cjs`：真实 VS Code Webview smoke 现有会直接驱动 `Note` 正文输入，本轮需保证该路径不被回归。
- `docs/design-docs/` 与 `docs/product-specs/canvas-core-collaboration-mvp.md`：需要把新行为写成正式口径，而不是只停留在代码里。

这里的“阅读态”指 `Note` 正文未被编辑时的展示模式，正文区应渲染 Markdown 预览；这里的“编辑态”指聚焦后展示原始文本输入的模式，用户可直接键入 Markdown 语法本体。

## 工作计划

先补文档。新增一份设计文档，明确 `Note` 正文继续使用原始文本持久化，但在 Webview 表面拆成“阅读预览”和“纯文本编辑”两种模式；同时更新 MVP 规格，让 `Note` 的当前正式行为包含 Markdown 预览。

再改前端实现。`NoteEditableNode` 需要保留现有 `content` 本地草稿和提交逻辑，但把正文区域拆成两个分支：未编辑时渲染 Markdown 预览容器，点击后切换到 `textarea`；编辑时继续保留当前 IME、`Ctrl/Cmd+Enter` 提交与 `Escape` 退出的文本编辑语义。为保证输入框切换稳定，需要加一个 `ref` 或提交后的同步逻辑，把焦点与本地草稿保持一致。

同时改测试辅助层。probe 读取正文时，不能再假设 `body` 一定来自表单控件；DOM action 在设置 `Note` 正文前，也要先确保节点已进入编辑态。这样真实 smoke 仍能用同一套 `setNodeTextField` 动作写入正文。

最后补 UI 测试与验证。浏览器 harness 需要新增至少一条针对 Markdown 预览的断言，例如输入标题、列表或代码块后，未编辑状态下能看到对应结构化 DOM；然后运行类型检查和 Webview 测试，必要时再补 smoke 验证。

## 具体步骤

1. 新增 `docs/design-docs/note-markdown-preview-rendering.md`，同步更新 `docs/design-docs/index.md`。
2. 更新 `docs/product-specs/canvas-core-collaboration-mvp.md`，把 `Note` 的正式行为改成“编辑态纯文本、阅读态 Markdown 预览”。
3. 在 `package.json` 中新增直接依赖 `markdown-it`，并同步更新锁文件。
4. 在 `src/webview/main.tsx` 中为 `NoteEditableNode` 增加 Markdown 渲染、模式切换和测试辅助兼容逻辑。
5. 在 `src/webview/styles.css` 中新增 `Note` 预览排版与空态样式。
6. 在 `src/common/protocol.ts` 与 `src/webview/main.tsx` 的 probe / DOM action 辅助逻辑中适配阅读态正文。
7. 更新 `tests/playwright/webview-harness.spec.mjs`，必要时同步更新 `tests/vscode-smoke/extension-tests.cjs` 的断言。
8. 运行：
   - `npm run typecheck`
   - `npm run test:webview`
   - 如有必要，再运行 `npm run test:smoke`

## 验证与验收

本轮至少满足以下条件才算完成：

- `Note` 正文在未编辑时按 Markdown 结构渲染，而不是继续展示原始语法文本框。
- 点击 `Note` 正文会进入纯文本编辑，用户能看到原始 Markdown 文本并继续输入。
- 结束编辑后，正文会回到预览态，并保留刚才输入的 Markdown 效果。
- 宿主保存的 `metadata.note.content` 仍然是原始文本，不引入新的富文本持久化字段。
- 现有 `setNodeTextField(field: 'body')` 测试驱动仍可写入 `Note` 正文，真实 VS Code Webview smoke 不回归。
- `npm run typecheck` 与 `npm run test:webview` 通过；如果本轮改动影响真实容器路径，再补 `npm run test:smoke`。

## 幂等性与恢复

- 多次在阅读态与编辑态之间切换，不应丢失尚未提交的本地草稿，也不应重复上报同一份正文。
- reload 或宿主状态恢复后，`Note` 应继续从原始 `metadata.note.content` 重建 Markdown 预览，而不是依赖缓存 HTML。
- 测试辅助层若先选中节点、再切换编辑态、再写入正文，应能重复执行，不依赖隐藏的一次性状态。

## 证据与备注

关键验证结果如下：

    npm run typecheck
    -> 通过

    npm run test:webview
    -> 107 passed

    npm run test:smoke
    -> Trusted workspace smoke passed.
    -> Restricted workspace smoke passed.
    -> Fake legacy real window reopen smoke passed.
    -> Fake systemd-user real window reopen smoke passed.
    -> Fake systemd-fallback real window reopen smoke passed.
    -> Remote SSH real window reopen smoke passed.
    -> VS Code smoke test passed.

## 接口与依赖

本轮预计引入一个新的直接运行时依赖：

- `markdown-it`：负责把 `Note` 的原始 Markdown 文本渲染成受控 HTML。配置应至少关闭原始 HTML 透传，并保持主题跟随样式由本仓库 CSS 接管。

关键接口边界如下：

- `src/panel/CanvasPanelManager.ts`

    interface NoteNodeMetadata {
      content: string;
    }

  本轮不修改该持久化结构，只消费 `content`。

- `src/common/protocol.ts`

    interface WebviewProbeNodeSnapshot {
      bodyValue?: string;
    }

  本轮需要保证 `bodyValue` 在阅读态和编辑态都能读到当前原始文本。

- `src/webview/main.tsx`

    function NoteEditableNode({ id, data }: NodeProps<CanvasNodeData>): JSX.Element

  这里将承担正文模式切换、Markdown 预览渲染和测试辅助兼容。

更新说明：

- 2026-05-05 21:45 +0800，新建本计划，定义 `Note` Markdown 预览模式的范围、实现顺序与验证口径。
- 2026-05-05 21:59 +0800，补齐实现、验证与复盘，确认本轮完成并移入 `completed/`。
