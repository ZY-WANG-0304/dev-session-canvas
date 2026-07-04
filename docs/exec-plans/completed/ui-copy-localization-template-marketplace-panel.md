# 模板市场 Panel/Webview 文案本地化

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。当前计划遵循 `docs/PLANS.md` 的要求维护；计划完成并提交时，如仍有遗留技术债，必须同步更新 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次把 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts` 中模板市场面板和它生成的 Webview 文案迁入 VS Code runtime l10n。完成后，英文 VS Code 用户在模板市场列表、详情、安装版本菜单、发布表单、加载/错误/成功状态中看到英文默认文案；简体中文 locale 通过 `l10n/bundle.l10n.zh-cn.json` 继续看到中文。模板名称、作者、标签、README、CHANGELOG、市场 API 原始错误、路径和 URL 等用户或外部事实保持原样。

## 进度

- [x] (2026-07-02 21:35+08:00) 已确认当前分支 `ui-copy-localization-foundation` 工作区干净，并读取 `docs/WORKFLOW.md`、`docs/PLANS.md` 与 `docs/design-docs/ui-copy-localization.md`。
- [x] (2026-07-02 21:45+08:00) 已扫描 `CanvasTemplateMarketplacePanel.ts` 与模板市场相关测试，确认剩余中文集中在 Host 通知/错误、市场来源匹配错误、Webview HTML 静态文案、inline script 动态状态/按钮/表单/详情/安装文案，以及旧测试源码断言。
- [x] (2026-07-02 22:05+08:00) 已迁移 `CanvasTemplateMarketplacePanel.ts` 的 Host 文案与 Webview copy 注入，面板源码不再包含硬编码中文或 `zh-CN`。
- [x] (2026-07-02 22:10+08:00) 已更新 `l10n/bundle.l10n.zh-cn.json`、`scripts/test/test-ui-copy-localization.mts` 和 `scripts/test/test-canvas-templates.mjs`，让模板市场 panel 进入 Host runtime l10n bundle 扫描，并把旧中文源码断言改为结构化/l10n 断言。
- [x] (2026-07-02 22:15+08:00) 已更新 `docs/design-docs/ui-copy-localization.md`、`docs/design-docs/index.md` 和 `docs/exec-plans/tech-debt-tracker.md`，将模板市场 panel/Webview 从剩余债务中移除，保留 shared/client 低层错误为后续批次。
- [x] (2026-07-02 22:20+08:00) 已运行本计划列出的验证命令，准备移动本计划到 `docs/exec-plans/completed/` 并提交一次 commit。

## 意外与发现

- 观察：模板市场 Webview 不是主画布 React bundle，而是在 Extension Host 文件中拼接 HTML 与 inline script。
  证据：`CanvasTemplateMarketplacePanel.ts` 中 `buildTemplateMarketplaceHtml()` 返回完整 HTML 字符串并赋给 `panel.webview.html`。
- 观察：现有 `scripts/test/test-canvas-templates.mjs` 对模板市场 panel 仍有多处旧中文源码断言，迁移后必须改为结构化或 l10n helper 断言。
  证据：测试中曾匹配 `发布新版本`、`发布自建模板`、`网络请求失败，可能无法访问模板市场 API 或代理阻断` 等旧中文；本批已改为检查 `buildTemplateMarketplacePanelCopy`、`vscode.l10n.t('Publish new version')`、`copy.reportTemplate`、`copy.updateToVersion` 等稳定结构。
- 观察：模板市场 install target label 由前序 `CanvasPanelManager` 传入，可能是英文 `Current workspace · name`，也可能来自历史中文 `当前 workspace · name`。
  证据：`formatWorkspaceLocationLabel()` 继续兼容两种前缀，但源码使用 unicode escape 避免重新引入硬编码中文。

## 决策记录

- 决策：本批对模板市场 panel/Webview 使用 VS Code runtime l10n，并由 Host 构造 `copy` 对象注入 inline script，不引入主画布 Webview typed dictionary。
  理由：该面板 HTML 由 Extension Host 生成，可以直接调用 `vscode.l10n.t(...)`；inline script 运行在 Webview 内，不能直接调用 VS Code API，因此复用前序 sidebar/模板保存表单的 copy 注入模式风险最低。
  日期/作者：2026-07-02 / Codex
- 决策：本批只迁移 `CanvasTemplateMarketplacePanel.ts` 中面板拥有的用户可见文案，`TemplateMarketplaceClient.ts` 的协议解析、包校验、HTTP 和 token 交换错误暂留给后续 client/shared 错误批次。
  理由：用户指定的第八批是模板市场 panel/Webview；client 文件混合了低层协议、包解析和外部服务错误，全部迁移会显著扩大本批风险。panel 会本地化自身前后缀和状态文案，外部错误详情继续作为事实文本透传。
  日期/作者：2026-07-02 / Codex
- 决策：模板名、作者名、tag、README、CHANGELOG、存储位置 label、URL 和市场 API 返回错误详情不翻译，只翻译产品拥有的前后缀、按钮、状态和 fallback 文案。
  理由：这些字段来自用户、市场服务或本机环境，属于事实文本；翻译它们会破坏用户确认和排错。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本批完成模板市场 panel/Webview 文案本地化。`CanvasTemplateMarketplacePanel.ts` 的 Host 通知、面板标题、市场来源错误、HTML 静态文本、列表/详情/安装/发布表单状态与按钮文案都改为英文默认源字符串，并在 zh-cn runtime bundle 中补齐中文翻译。inline script 使用 Host 注入的 `copy` 对象和 `formatCopy()` 做命名插值；`<html lang>` 跟随 VS Code 当前语言；`test:ui-copy-localization` 已扫描该文件中的 `vscode.l10n.t` 源字符串并阻止该文件重新出现中文或 `zh-CN`。剩余本地化债务集中在 shared presentation/status/helper 模块和 `TemplateMarketplaceClient.ts` 的低层错误文案；真实英文/中文 VS Code locale 端到端人工验证仍需发布前补齐。

## 上下文与定向

模板市场面板位于 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts`。`CanvasTemplateMarketplacePanelController` 负责创建 VS Code WebviewPanel、处理安装/发布/open-in-browser message，并把已安装模板、发布表单和安装结果推送回 Webview。`buildTemplateMarketplaceHtml()` 生成完整 HTML 和 inline script，脚本负责加载远端模板列表、渲染列表/详情/发布表单、选择安装位置和触发安装。

本地化源字符串默认写英文，中文翻译写入 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`。Host 侧通知、错误和面板标题直接使用 `vscode.l10n.t(...)`；Webview 静态 HTML 和脚本动态文案通过 `buildTemplateMarketplacePanelCopy()` 构造 copy 对象，再用 `serializeForInlineScript()` 注入。用户或外部事实不翻译，包括模板名、作者名、tag、README、CHANGELOG、HTTP 状态、API 返回错误、存储位置 label 和 URL。

## 工作计划

本批已按增量顺序完成：先在 `CanvasTemplateMarketplacePanel.ts` 增加 `TemplateMarketplacePanelCopy`、`buildTemplateMarketplacePanelCopy()`、`serializeForInlineScript()`、`resolveWebviewHtmlLang()` 和 `escapeHtml()`；随后把 Host 通知、panel title、市场来源不匹配错误和链接解析错误迁到 `vscode.l10n.t(...)`；接着在 `buildTemplateMarketplaceHtml()` 中注入 `copy`，替换 HTML 静态文案和 inline script 动态文案，使用 `formatCopy(copy.key, params)` 保留命名插值。最后更新 bundle、扫描范围、模板测试断言和正式文档。

## 具体步骤

在仓库根目录执行：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts
    npm run test:ui-copy-localization
    npm run test:canvas-templates
    npm run typecheck
    git diff --check

本批实际执行结果如下：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts
    # 无输出，退出码 1，表示该 panel 源码已无中文或 zh-CN 命中。

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:canvas-templates
    # 通过，无额外输出

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    # 无输出

## 验证与验收

自动验收包括：`test:ui-copy-localization` 扫描新增 panel 文件中的 `vscode.l10n.t(...)` 源字符串并验证 zh-cn bundle 非空；`test:canvas-templates` 不再依赖模板市场旧中文源码断言；`typecheck` 通过；`git diff --check` 无输出。用户可观察验收是：英文 VS Code 打开模板市场，列表/详情/发布表单/安装菜单显示英文；简体中文 VS Code 显示中文；模板内容和外部错误详情保持原样。

## 幂等性与恢复

本计划只修改源码、测试和文档，不需要破坏性命令。重复运行扫描和测试是安全的。如果替换过程中某段 inline script 失效，先用 `git diff` 和 `npm run typecheck` 定位当前批次改动，不回滚用户未提交的无关变更。

## 证据与备注

初始扫描显示 `CanvasTemplateMarketplacePanel.ts` 有 176 条中文或 `zh-CN` 命中，分布在 Host 消息、HTML、inline script 和 helper 中。本批结束时同一扫描无输出。当前分支相对 `origin/main` 仍是 ahead / behind 状态；按用户连续批次要求继续在当前本地化分支推进，不在本批执行 rebase。

## 接口与依赖

本批不引入新依赖。新增 copy 对象字段只包含字符串或只读字符串 map；inline script 内新增 `formatCopy(template, params)`，只做 `{name}` 这类命名占位替换，不解析 HTML。所有注入到 HTML 属性或文本节点的 Host 字符串都经过 `escapeHtml()` 或 JSON 序列化，避免破坏 CSP nonce 脚本。
