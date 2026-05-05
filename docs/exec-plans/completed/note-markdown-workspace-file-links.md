# 为 Note Markdown 预览补齐 workspace 文件链接打开

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划原始路径是 `docs/exec-plans/active/note-markdown-workspace-file-links.md`，完成后已移至 `docs/exec-plans/completed/note-markdown-workspace-file-links.md`；文档内容仍按 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

这次变更要在现有 Note Markdown 预览已支持外部链接的基础上，继续补齐 workspace 内文件链接主路径。完成后，用户在单根 workspace 中写 `[package](package.json#L1)`，或在多根 workspace 中写 `[entry](workspace-a/src/index.ts#L12)` 时，阅读态点击链接会按 VSCode 文件打开语义跳到目标文件，而不是被当成不支持的普通文本。编辑态仍然保持纯文本 Markdown 输入，不引入富文本编辑器。

用户可直接观察到的结果是：Note 里的相对文件链接现在能打开仓库内文件；单根 workspace 支持纯相对路径，多根 workspace 要求带 workspace folder 前缀；可选的 `#L12` 或 `#L12C3` 会把编辑器定位到对应行列。

## 进度

- [x] (2026-05-05 23:20 +0800) 复盘现有 Note 链接实现、宿主 `openCanvasFile` 路径与 smoke / harness 入口，确认本轮只补 workspace 文件链接，不混入交互式 checklist。
- [x] (2026-05-05 23:24 +0800) 新建本 ExecPlan，记录解析规则、宿主打开语义与验证口径。
- [x] (2026-05-05 23:31 +0800) 更新设计文档与规格文档，明确单根 / 多根 workspace 下的 Note 文件链接边界。
- [x] (2026-05-05 23:37 +0800) 实现 Note Markdown 文件链接解析、宿主打开与可选行列定位。
- [x] (2026-05-05 23:36 +0800) 补齐脚本、Playwright 和 smoke 验证，并更新复盘。

## 意外与发现

- 观察：现有 `Note` 链接能力只把 `http` / `https` / `mailto` 视为可打开目标，相对路径仍会被统一拒绝。
  证据：`src/common/noteMarkdownLinks.ts` 当前只有 `normalizeOpenableNoteMarkdownHref()`，没有 workspace 文件路径解析分支。

- 观察：仓库已经对文件节点的“多根 workspace 相对路径展示”有一致规则：单根显示纯相对路径，多根显示 `workspace-folder/path`。
  证据：`src/common/workspaceRelativePath.ts` 的 `resolveContainedWorkspaceRelativePath()` 会在多根场景下显式补 `workspaceFolderName` 前缀。

## 决策记录

- 决策：单根 workspace 的 Note 文件链接支持纯相对路径，多根 workspace 要求显式写 `workspace-folder/relative/path` 前缀。
  理由：`Note` 节点并不隶属于某一个具体文件目录；在多根场景下允许裸相对路径会引入歧义，而要求前缀可以和现有文件列表展示口径保持一致。
  日期/作者：2026-05-05 / Codex

- 决策：本轮只支持文件打开，不支持目录打开，也不支持 `command:`、绝对路径或逃逸出 workspace root 的路径。
  理由：当前主路径是把 Note 当作工作上下文里的文档入口；目录打开、命令 URI 和越界路径都属于更高风险或更宽的能力边界，不应隐式放开。
  日期/作者：2026-05-05 / Codex

## 结果与复盘

本轮已经把 Note Markdown 阅读态链接能力从“只支持安全外部链接”扩展为“支持安全外部链接 + 受限 workspace 文件链接”。`src/common/noteMarkdownLinks.ts` 现在统一解析外部链接与 workspace 文件链接，`src/panel/CanvasPanelManager.ts` 会在宿主侧区分打开外部 URI 与打开工作区文件，并在命中文件 fragment 时把编辑器定位到对应行列。

本轮同时把多根 workspace 的歧义处理写成显式规则：只有单根 workspace 才允许裸相对路径，多根 workspace 必须写成 `workspace-folder/relative/path`。为避免越权或误开，绝对路径、`..` 逃逸、目录目标、缺少根名前缀的多根歧义路径，以及白名单外 scheme 都会稳定 fail closed。

验证方面，`scripts/test-note-markdown-links.mts` 覆盖了外部链接白名单、单根 / 多根文件路径解析和 fragment 规则；`tests/playwright/webview-harness.spec.mjs` 覆盖了阅读态点击文件链接时继续只发 `webview/openNoteLink`，不会误入编辑态；`tests/vscode-smoke/extension-tests.cjs` 覆盖了真实宿主里打开 workspace 文件并定位到 `#L..C..` 的主路径。没有新增需要单独登记的技术债。

## 上下文与定向

本轮相关文件如下：

- `src/common/noteMarkdownLinks.ts`：当前只做外部链接白名单；本轮要扩展成“外部链接 + workspace 文件链接”统一解析入口。
- `src/panel/CanvasPanelManager.ts`：宿主侧负责接收 `webview/openNoteLink`，并把解析后的文件链接按当前 canvas surface 语义打开。
- `src/webview/main.tsx`：预览态点击链接仍然只发 `webview/openNoteLink`；本轮不改点击手势，只依赖宿主增强解析能力。
- `tests/playwright/webview-harness.spec.mjs`：可补一条文件链接点击后仍只发 `webview/openNoteLink` 的回归，防止 Webview 侧重新退回编辑态。
- `tests/vscode-smoke/extension-tests.cjs`：需要补真实宿主验证，证明 `webview/openNoteLink` 的 workspace 文件分支确实会打开目标文件并定位行列。
- `docs/design-docs/note-markdown-preview-rendering.md` 与 `docs/product-specs/canvas-core-collaboration-mvp.md`：需要把新的文件链接边界写成正式仓库口径。

这里的“workspace 文件链接”指 Markdown 链接中的相对路径，例如 `package.json`、`src/main.ts`，以及多根场景下带 workspace folder 前缀的路径，例如 `workspace-a/src/index.ts`。这里的“行列定位”指链接 fragment 里的 `#L12` 或 `#L12C3`。

## 工作计划

先同步文档，把 Note 阅读态链接能力从“只支持外部链接”扩展成“支持外部链接和受限的 workspace 文件链接”，并明确多根 workspace 的歧义处理规则。

然后扩展 `src/common/noteMarkdownLinks.ts`，让它能把 `href` 解析成“外部链接”或“workspace 文件链接”两类结果，并在 workspace 文件场景下输出标准化文件路径与可选的行列定位。解析规则要 fail closed：空路径、绝对路径、`..` 逃逸、多根场景缺少 workspace folder 前缀、以及 `command:` 等不安全 scheme 都不能通过。

宿主侧在 `src/panel/CanvasPanelManager.ts` 中消费新的解析结果。外部链接继续走 `vscode.open`；文件链接则复用当前 `openCanvasFile` 语义，并在有 `#L..` fragment 时附带 selection。这样 editor surface 继续保持“在旁边打开并保留 canvas”的行为，panel surface 继续保持“在编辑器区打开文件”的行为。

最后补验证。脚本测试需要覆盖解析规则；Playwright harness 需要确认文件链接点击仍然只发 `webview/openNoteLink`，不误回到编辑态；VS Code smoke 需要证明真实宿主里相对路径和 `#L..` fragment 都会生效。

## 具体步骤

1. 更新 `docs/design-docs/note-markdown-preview-rendering.md`、`docs/design-docs/index.md` 和 `docs/product-specs/canvas-core-collaboration-mvp.md`。
2. 扩展 `src/common/noteMarkdownLinks.ts`，新增 workspace 文件链接解析与 fragment 处理。
3. 修改 `src/panel/CanvasPanelManager.ts`，让 `openNoteLink()` 能打开 workspace 文件并支持行列定位。
4. 更新 `scripts/test-note-markdown-links.mts`，补单根 / 多根 / fragment / fail-closed 回归。
5. 更新 `tests/playwright/webview-harness.spec.mjs`，补 Note 文件链接点击回归。
6. 更新 `tests/vscode-smoke/extension-tests.cjs`，补真实宿主验证。
7. 运行：
   - `npm run typecheck`
   - `npm run test:note-markdown-links`
   - `npm run test:webview -- --grep "note .*link"`
   - `npm run test:smoke`

## 验证与验收

完成时至少满足以下条件：

- 单根 workspace 中的 `[pkg](package.json)` 能打开工作区内文件。
- 多根 workspace 中的文件链接只有在写成 `workspace-folder/path` 时才会被解析；缺少前缀的歧义链接不会被误开。
- `#L12` 或 `#L12C3` 能把编辑器定位到对应行列。
- `command:`、绝对路径、`..` 逃逸和不受支持 scheme 仍然被拒绝。
- `npm run typecheck`、`npm run test:note-markdown-links`、相关 `test:webview` 回归和 `npm run test:smoke` 通过。

## 幂等性与恢复

- 重复点击同一条文件链接，不应改变 Note 正文内容，也不应生成新的宿主持久化状态。
- 文件链接解析必须对同一输入稳定给出同一结果，不依赖临时 UI 状态。
- 多根 workspace 歧义场景必须稳定 fail closed，而不是偶发地打开某个根目录下的同名文件。

## 证据与备注

关键验证结果如下：

    npm run typecheck
    -> 通过

    npm run test:note-markdown-links
    -> note markdown link tests passed

    npm run test:webview -- --grep "note .*link"
    -> 2 passed

    npm run test:smoke
    -> Trusted workspace smoke passed.
    -> Restricted workspace smoke passed.
    -> Fake legacy real window reopen smoke passed.
    -> Fake systemd-user real window reopen smoke passed.
    -> Fake systemd-fallback real window reopen smoke passed.
    -> Remote SSH real window reopen smoke passed.
    -> VS Code smoke test passed.

## 接口与依赖

- `src/common/noteMarkdownLinks.ts`

    export type ResolvedNoteMarkdownLinkTarget =
      | { kind: 'external'; href: string }
      | { kind: 'workspace-file'; filePath: string; selection?: { line: number; column?: number } };

  Webview 与宿主共用这层解析结果，保证链接边界只有一份定义。

- `src/panel/CanvasPanelManager.ts`

    private async openNoteLink(nodeId: string, href: string, sourceSurface: CanvasSurfaceLocation): Promise<void>

  宿主侧会根据解析结果决定走 `vscode.open` 还是打开 workspace 文件。

更新说明：

- 2026-05-05 23:24 +0800，新建本计划，记录 Note workspace 文件链接的解析规则、宿主打开语义与验证要求。
- 2026-05-05 23:50 +0800，补齐实现、文档、验证与复盘，确认本轮完成并移入 `completed/`。
