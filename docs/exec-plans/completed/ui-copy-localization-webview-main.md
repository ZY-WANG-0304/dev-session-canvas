# 主画布 Webview 文案本地化

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。当前计划遵循 `docs/PLANS.md` 的要求维护；计划完成并提交时，如仍有遗留技术债，必须同步更新 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次把主画布 Webview 的产品自有、用户可见文案从硬编码中文迁入现有 Webview typed dictionary。完成后，英文 VS Code 或未注入中文 locale 的 Webview harness 会看到英文按钮、tooltip、空状态、Note 编辑提示、上下文菜单和连线菜单；简体中文 locale 继续看到中文版本。用户创建的标题、路径、终端输出、Agent/provider 原始错误、Host 传入的运行时摘要不被翻译。

## 进度

- [x] (2026-07-02 14:35+08:00) 已读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/FRONTEND.md` 与 `docs/design-docs/ui-copy-localization.md`，确认本批次应使用 Webview typed dictionary 而不是 `vscode.l10n.t`。
- [x] (2026-07-02 14:45+08:00) 已扫描 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`，确认剩余中文主要集中在执行节点、Note、文件列表、pane gallery、上下文菜单、连线菜单、metadata popover、分组工具栏、测试 DOM helper 与 Markdown fallback。
- [x] (2026-07-02 15:35+08:00) 已迁移 `main.tsx` 中产品自有文案到 `extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts`，覆盖 Agent、Terminal、Note、文件/文件列表、pane gallery、右键菜单、连线菜单、metadata popover、分组、状态和 Markdown fallback；用户数据与 Host/runtime 原始文本保持原样。
- [x] (2026-07-02 15:50+08:00) 已更新 `extensions/vscode/dev-session-canvas/src/common/protocol.ts`、`main.tsx` 与 Playwright/VS Code smoke 调用，使 `clickNodeActionButton` 主路径使用稳定 `action` id，不依赖中文按钮文本；旧中文 `label` 仅保留兼容映射。
- [x] (2026-07-02 16:05+08:00) 已增强 `scripts/test/test-ui-copy-localization.mts` 与 `scripts/test/test-protocol-webview-messages.mts`，覆盖 `tCount(...)` key、`main.tsx` 未登记中文扫描、稳定 action id 和无效 action 拒绝。
- [x] (2026-07-02 16:15+08:00) 已更新 `docs/design-docs/ui-copy-localization.md`、`docs/design-docs/index.md` 与 `docs/exec-plans/tech-debt-tracker.md`，说明主画布 Webview 本批已完成，剩余范围转向 sidebar、模板市场和 shared presentation/status 模块。
- [x] (2026-07-02 16:35+08:00) 已运行最终验证，准备移动计划到 `docs/exec-plans/completed/` 并提交一次本批改动。

## 意外与发现

- 观察：`main.tsx` 的测试 DOM helper 通过中文按钮 label 查找按钮，且 `WebviewDomAction` 类型把中文 label 写进 protocol。这属于测试协议而非用户 UI，但会阻碍 UI 文案改成英文默认。
  证据：`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中旧 `clickNodeActionButton.label` 枚举为 `删除`、`启动`、`重新加载` 等；`main.tsx` 中旧 `queryNodeActionButton()` 使用按钮文本查找。
- 观察：Playwright config 的浏览器 locale 是 `zh-CN`，但 harness HTML 目前没有注入 `window.__DEV_SESSION_CANVAS_I18N__`，因此 `main.tsx` 会从 `navigator.language` fallback 到中文。
  证据：`playwright.config.mjs` 的 `use.locale` 为 `zh-CN`，`tests/playwright/harness/webview-harness.html` 只注入 lifecycle，不注入 i18n。
- 观察：最初的 Webview key 扫描只识别 `t('key')`，漏掉 `tCount('one','other', count)` 的复数 key。
  证据：`scripts/test/test-ui-copy-localization.mts` 已补充 `tCount(...)` 正则扫描，避免 pane gallery 计数文案 key 漏测。
- 观察：如果 `clickNodeActionButton` 同时带无效 `action` 和旧中文 `label`，旧守卫会回退到 label 并误判通过。
  证据：`scripts/test/test-protocol-webview-messages.mts` 已新增无效 action 断言，`isWebviewDomAction()` 现在只要出现 `action` 字段就必须是合法稳定 id。

## 决策记录

- 决策：本批只迁移主画布 Webview 自有 UI 文案；从 Host 传入的 `data.summary`、`lastExitMessage`、`associatedMarkdownFile.lastError`、模板名、节点标题、文件路径、Agent 命令行和 Markdown 内容保持原样。
  理由：这些内容可能来自用户数据、外部系统或 Extension Host，Webview 不应二次翻译事实文本；Host 已在前几批迁移自身拥有的运行时文案。
  日期/作者：2026-07-02 / Codex
- 决策：把测试 DOM action 从“按本地化 label 查找”迁到稳定 action id，同时暂时保留旧中文 label 兼容测试调用。
  理由：UI 文案随 locale 变化后，测试协议不能再依赖可见文案；保留旧 label 可减少本批对既有 smoke/playwright 调用的改动面。
  日期/作者：2026-07-02 / Codex
- 决策：`ActionButton.actionId` 使用 `WebviewNodeActionId` 类型，并由 DOM 输出 `data-node-action-id`；Playwright 与 VS Code smoke 中现有 `clickNodeActionButton` 调用改用 `action` 字段。
  理由：把测试定位锚点从自然语言迁到结构化 id，防止未来英文、中文或其他 locale 文案调整造成测试脆弱性。
  日期/作者：2026-07-02 / Codex
- 决策：`main.tsx` 允许剩余中文只存在于 test DOM helper 错误和旧中文 label 兼容映射，并用 `test:ui-copy-localization` 白名单守住该边界。
  理由：这些字符串不面向产品用户；彻底移除旧 label 会放大本批协议兼容风险，但允许范围必须可测试，避免重新引入用户可见硬编码中文。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本批代码、测试和文档修改已经完成并通过本计划列出的自动验证。主画布 Webview 的用户可见自有文案已进入 typed dictionary；测试 DOM action 主路径已改用稳定 id；`main.tsx` 的中文扫描只剩 test helper/legacy compatibility。剩余技术债已登记到 `docs/exec-plans/tech-debt-tracker.md`：sidebar Webview、模板市场 panel/Webview、模板保存表单以及 shared presentation/status/helper 模块仍需后续批次迁移；英文/中文真实 VS Code locale 端到端验证仍需发布前补齐。

## 上下文与定向

本仓库的 VS Code 扩展位于 `extensions/vscode/dev-session-canvas/`。主画布 Webview React 入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`，它运行在浏览器环境，不能调用 Extension Host 的 `vscode.l10n.t`。Webview 字典位于 `extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts`：英文 `enWebviewMessages` 是默认 key 集，中文 `zhCnWebviewMessages` 使用 `satisfies WebviewI18nMessages` 保证 key 完整。Host 通过 `extensions/vscode/dev-session-canvas/src/panel/getWebviewHtml.ts` 注入 `window.__DEV_SESSION_CANVAS_I18N__`；未注入时，`main.tsx` 使用 `navigator.language` fallback。

`main.tsx` 当前使用 `t(key, params)` 和 `tCount(oneKey, otherKey, count)` helper。插值必须使用命名参数，例如 `{count}`、`{title}`，不要用拼接把中英文语序固定死。产品术语按设计文档保持：英文使用 Agent、Terminal、Note、Canvas、workspace；中文保留 Agent、Terminal、Note，Canvas 翻译为“画布”，涉及配置 key、命令行、路径时保留原文。

## 工作计划

先扩充 `webviewI18n.ts`，加入执行节点、Note、文件列表、pane gallery、上下文菜单、连线菜单、metadata popover、分组工具栏、状态展示和 Markdown fallback 所需 key。然后在 `main.tsx` 中替换硬编码中文为 `t(...)` 或 `tCount(...)`，必要时新增小 helper，例如 `webviewHumanizeCanvasStatus()`、`webviewHumanizeCanvasNodeStatus()`。对测试 DOM action，给 `ActionButton` 增加稳定 `data-node-action-id`，让 `queryNodeActionButton()` 优先按 action id 查找，旧 label 仅作为兼容入口。

接着更新 `protocol.ts` 的 `WebviewDomAction` 类型和 `isWebviewDomAction()`，允许 `action` 字段承载稳定动作 id，并拒绝无效 action。现有 Playwright 和 VS Code smoke 调用改用 action id，本批保留旧 label 兼容。最后更新设计文档和技术债记录，运行 `npm run test:ui-copy-localization`、`npm run test:protocol-webview-messages`、相关 Playwright 子集、`npm run typecheck` 与 `git diff --check`。

## 具体步骤

在仓库根目录执行：

    rg -n "[\p{Han}]" extensions/vscode/dev-session-canvas/src/webview/main.tsx
    npm run test:ui-copy-localization
    npm run test:protocol-webview-messages
    npm run typecheck
    npm run build
    node scripts/test/run-playwright-webview.mjs --grep "file list nodes expose a delete button|agent start button posts|agent restart action falls back|deleting a note posts|agent start message uses"
    git diff --check

若 Playwright 全量成本过高，以上子集覆盖本批改动的稳定 action id、删除/启动/重启 fallback 和 Webview DOM 主路径；发布前或准备升级验证状态时仍应补完整 `npm run test:webview` 或真实宿主 locale 验证。

## 验证与验收

自动验收包括：Webview 字典中英文 key 完全一致；新增 `t(...)` / `tCount(...)` key 都存在；`main.tsx` 英文默认渲染不再依赖中文硬编码；测试 DOM action 可用稳定 action id 且无效 action 会被拒绝；TypeScript 编译通过。用户可观察验收是：英文 locale 打开主画布时，Agent/Terminal/Note 按钮、空状态、上下文菜单、连线菜单和 metadata popover 显示英文；中文 locale 打开时对应位置仍显示中文。

已运行并通过的验证包括 `npm run build`、聚焦 Playwright 子集、`npm run test:ui-copy-localization`、`npm run test:protocol-webview-messages`、`npm run typecheck` 和 `git diff --check`。

## 幂等性与恢复

本计划只修改源码、测试和文档，不需要破坏性命令。所有替换应可重复运行；如果测试失败，先用 `git diff` 定位本批变更，不要回滚用户未提交的无关改动。完成前保持 active 计划可继续接手，完成后移动到 `docs/exec-plans/completed/`。

## 证据与备注

当前扫描显示 `main.tsx` 仅剩 22 条中文匹配，均位于 test DOM helper 错误或旧中文 label 兼容映射：

    rg -n "[\p{Han}]" extensions/vscode/dev-session-canvas/src/webview/main.tsx
    17204: throw new Error(`节点 ${nodeId} 的 ${fieldName} 字段不是文本输入控件。`);
    ...
    17377: throw new Error(`未找到节点 ${nodeId} 的执行终端。`);

已通过聚焦 Playwright 子集：

    node scripts/test/run-playwright-webview.mjs --grep "file list nodes expose a delete button|agent start button posts|agent restart action falls back|deleting a note posts|agent start message uses"
    5 passed

最终验证通过：

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    # no output

## 接口与依赖

继续使用现有 `formatWebviewMessage(messages, key, params)`，不引入 i18next 等新依赖。`ActionButton` 新增可选 `actionId?: WebviewNodeActionId` 并写入 `data-node-action-id`；`WebviewDomAction` 新增 `action?: WebviewNodeActionId`，其中 action id 覆盖 `delete`、`start`、`stop`、`new-session`、`restart`、`resume`、`branch`、`reload`、`copy-draft`、`overwrite-file`、`create-missing-associated-markdown-file`、`open-associated-markdown-file`、`save-as-markdown`。旧 label 字段只用于测试兼容，不再作为产品 UI 的事实来源。
