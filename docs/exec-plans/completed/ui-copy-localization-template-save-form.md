# 模板保存表单文案本地化

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。当前计划遵循 `docs/PLANS.md` 的要求维护；计划完成并提交时，如仍有遗留技术债，必须同步更新 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次把 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateSaveFormPanel.ts` 中的模板保存/导入表单文案迁入 VS Code runtime l10n。完成后，英文 VS Code 用户在模板保存表单里看到英文默认的字段 label、placeholder、按钮、帮助说明、Agent Provider 策略和关联 Markdown Note 策略；简体中文 locale 通过 `l10n/bundle.l10n.zh-cn.json` 看到中文。用户输入的模板名、节点标题、路径和外部状态事实保持原样。

## 进度

- [x] (2026-07-02 20:10+08:00) 已确认当前分支 `ui-copy-localization-foundation` 工作区干净，并读取 `docs/WORKFLOW.md`、`docs/PLANS.md` 与 `docs/design-docs/ui-copy-localization.md`。
- [x] (2026-07-02 20:20+08:00) 已检查 `CanvasTemplateSaveFormPanel.ts`，确认它是在 Extension Host 侧生成 WebviewPanel HTML，静态和脚本动态文案都可以由 Host 先通过 `vscode.l10n.t(...)` 生成后注入。
- [x] (2026-07-02 20:45+08:00) 已迁移 `CanvasTemplateSaveFormPanel.ts` 的校验错误、HTML 静态文案和 inline script 动态文案，并让 `<html lang>` 跟随 `vscode.env.language`。
- [x] (2026-07-02 20:50+08:00) 已更新 `l10n/bundle.l10n.zh-cn.json` 与 `scripts/test/test-ui-copy-localization.mts`，模板保存表单的 runtime l10n 源字符串会被测试覆盖。
- [x] (2026-07-02 21:05+08:00) 已更新 `scripts/test/test-canvas-templates.mjs` 中此前仍绑定旧中文 Webview/sidebar 文案的断言，使模板测试改为检查本地化 key 和结构化实现。
- [x] (2026-07-02 21:15+08:00) 已更新 `docs/design-docs/ui-copy-localization.md`、`docs/design-docs/index.md` 和 `docs/exec-plans/tech-debt-tracker.md`，将模板保存表单从剩余债务中移除。
- [x] (2026-07-02 21:20+08:00) 已运行验证命令，准备移动本计划到 `docs/exec-plans/completed/` 并提交一次 commit。

## 意外与发现

- 观察：模板保存表单不是主画布 React Webview bundle，而是在 Extension Host 文件中拼接 HTML 和 inline script。
  证据：`CanvasTemplateSaveFormPanel.ts` 中 `buildCanvasTemplateSaveFormHtml()` 返回完整 HTML 字符串，并在构造函数中赋给 `panel.webview.html`。
- 观察：表单标题和提交按钮文字已经由调用方传入，调用方在 `extension.ts` 中已使用 `vscode.l10n.t(...)`。
  证据：`saveCurrentCanvasAsTemplateFromCommand()` 传入 `Save current Canvas as template` / `Save template`，导入流程传入 `Import template`。
- 观察：`npm run test:canvas-templates` 首次运行失败在旧断言，断言仍要求 `webview/main.tsx` 和 sidebar 模板视图源码包含上一批已迁移掉的中文文案。
  证据：失败点是 `scripts/test/test-canvas-templates.mjs` 对 `/多根 workspace 中请在目标 root section 内重置为模板/u` 的源码匹配；本批将该类断言改为检查 `t('canvas.error.multiRootTemplateReset')`、Webview i18n 英文 key、sidebar `vscode.l10n.t(...)` 和模板保存表单 copy helper，随后 `npm run test:canvas-templates` 通过。

## 决策记录

- 决策：本批对模板保存表单使用 VS Code runtime l10n，不引入主画布 Webview typed dictionary。
  理由：该 HTML 由 Extension Host 生成，可以直接使用 `vscode.l10n.t(...)`；typed dictionary 是为浏览器 bundle 不能调用 VS Code API 的边界准备的。
  日期/作者：2026-07-02 / Codex
- 决策：inline script 需要设置的选项、按钮、空状态和错误提示文案由 Host 构造 `copy` 对象后序列化注入。
  理由：脚本运行在 Webview 内，不能调用 `vscode.l10n.t`；copy 对象能让源字符串被 runtime bundle 测试发现，并避免脚本继续硬编码中文。
  日期/作者：2026-07-02 / Codex
- 决策：关联 Markdown Note 行里的状态标签只翻译扩展已知状态，例如 missing、not-file、unsupported-extension、unreadable 和 dirty-conflict；未知状态仍按原始字符串显示。
  理由：已知状态是产品拥有的枚举文案，应跟随 locale；未知状态更像外部或未来事实值，保留原文比误翻译更安全。
  日期/作者：2026-07-02 / Codex
- 决策：顺手修复 `test:canvas-templates` 中与本地化批次冲突的旧中文源码断言，但不扩大到模板市场 panel 的剩余中文断言。
  理由：Webview main/sidebar 已在前两批完成本地化，测试继续绑定旧中文会让当前模板保存表单批次无法使用模板测试作为验证；模板市场 panel 仍是后续迁移范围，相关中文断言暂时保留。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本批完成模板保存/导入表单面板本地化。`CanvasTemplateSaveFormPanel.ts` 的表单 label、placeholder、帮助说明、按钮、Agent Provider 选项、关联 Markdown Note 策略、已知状态标签和 Host 校验错误都改为英文默认源字符串，并在 zh-cn runtime bundle 中补齐中文翻译。inline script 不再硬编码中文，而是读取 Host 注入的 `copy` 对象；`<html lang>` 跟随 VS Code 当前语言。`scripts/test/test-ui-copy-localization.mts` 已纳入该面板，`scripts/test/test-canvas-templates.mjs` 改为验证本地化 key 与结构化实现，避免继续依赖旧中文源码。剩余本地化债务集中在模板市场 panel/Webview 和 shared presentation/status/helper 模块；真实英文/中文 VS Code locale 端到端验证仍需发布前补齐。

## 上下文与定向

模板保存表单位于 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateSaveFormPanel.ts`。它提供 `showCanvasTemplateSaveForm()`，被 `extension.ts` 中保存当前画布为模板和导入模板流程复用。表单使用 WebviewPanel 承载一段 Host 拼接的 HTML，用户提交后通过 `saveTemplateForm/submit` message 把模板名、目标存储位置、Agent Provider 保存策略和关联 Markdown Note 保存策略传回 Host。Host 校验失败时通过 `saveTemplateForm/error` message 把错误显示在表单内。

本批只处理产品拥有的表单 UI 文案。模板名、节点标题、存储位置 label 中的 workspace 名称、Markdown 路径和外部错误文本是用户或环境事实，不翻译。表单内出现的 `Agent`、`Terminal`、`Note` 保留产品术语，`workspace` 在中文中按既有 glossary 保留英文术语。

## 工作计划

先在 `CanvasTemplateSaveFormPanel.ts` 中新增表单 copy 类型和 `buildCanvasTemplateSaveFormCopy()`，把 label、placeholder、帮助说明、按钮、select option、空状态和错误文案统一改为英文源字符串的 `vscode.l10n.t(...)`。然后把 `buildCanvasTemplateSaveFormHtml()` 的 `<html lang>` 改为 VS Code 当前语言，把 copy 对象和原始 state 一起安全序列化到 inline script。接着将 Host 校验错误改为英文源字符串并补齐中文 runtime bundle。最后扩展 `scripts/test/test-ui-copy-localization.mts` 的 Host runtime 扫描范围，更新设计文档和技术债记录。

## 具体步骤

在仓库根目录执行：

    rg -n "[\p{Han}]|zh-CN|serializeStateForInlineScript" extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateSaveFormPanel.ts
    npm run test:ui-copy-localization
    npm run test:canvas-templates
    npm run typecheck
    git diff --check

本批实际执行结果如下：

    rg -n "[\p{Han}]|zh-CN|serializeStateForInlineScript" extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateSaveFormPanel.ts
    # 无输出，退出码按脚本包装视为通过。

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:canvas-templates
    # 通过，无额外输出。

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

最终 `git diff --check` 已执行，无输出，表示没有空白错误。

## 验证与验收

自动验收包括：`test:ui-copy-localization` 能扫描 `CanvasTemplateSaveFormPanel.ts` 中的 `vscode.l10n.t` 源字符串并验证 zh-cn bundle 非空；`CanvasTemplateSaveFormPanel.ts` 中不再出现硬编码中文、固定 `zh-CN` 或旧 `serializeStateForInlineScript`；模板相关测试继续覆盖表单消息字段、关联 Note 保存策略和本地化实现锚点；TypeScript 编译通过；`git diff --check` 无空白错误。用户可观察验收是：英文 locale 下模板保存/导入表单显示英文表单文案，简体中文 locale 下显示中文表单文案。

## 幂等性与恢复

本计划只修改源码、测试和文档，不需要破坏性命令。重复运行测试和扫描是安全的。如果 inline script 迁移引入 DOM 行为错误，优先查看生成 HTML 中的 copy 注入和 select option 构造，不回滚无关批次提交。

## 证据与备注

初始扫描显示 `CanvasTemplateSaveFormPanel.ts` 中的中文集中在表单校验错误、`<html lang="zh-CN">`、字段 label、placeholder、帮助说明、按钮、Agent Provider option、关联 Note 策略 option 和取消按钮。当前分支相对 `origin/main` ahead 6 / behind 16；本批继续沿用户要求的本地化批次分支推进，不在本批中执行 rebase。

最终源码扫描显示 `CanvasTemplateSaveFormPanel.ts` 无中文命中。`l10n/bundle.l10n.zh-cn.json` 新增 23 条模板保存表单翻译；`test:ui-copy-localization` 会防止后续新增英文源字符串时漏补中文翻译。

## 接口与依赖

本批不引入新依赖。新增 helper 保持文件内私有。需要注入脚本文案时使用 `serializeForInlineScript(value: unknown)`，确保 `<`、`>`、`&`、U+2028 和 U+2029 不破坏 inline script。模板保存表单的 copy 对象只包含字符串和已知状态标签 map，不传函数或用户内容。
