# 迁移模板解析与存储错误文案

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前文件位于 `docs/exec-plans/completed/ui-copy-localization-template-core.md`，已完成并从 active 目录归档；仍遗留的本地化技术债已同步到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次要把模板解析、捕获和模板文件存储中的产品自有错误文案从硬编码中文迁移到英文默认 + 简体中文本地化。完成后，英文 VS Code 用户在导入模板、安装市场模板、模板侧栏 issue 和从 Webview 应用模板失败时看到英文错误；简体中文用户通过 VS Code locale 看到中文翻译。用户提供的模板名、节点标题、文件路径、JSON parser 原始错误等事实内容保持原样。

## 进度

- [x] (2026-07-03 10:10+08:00) 已确认本批次范围是 `extensions/vscode/dev-session-canvas/src/common/canvasTemplates.ts` 与 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateStore.ts`，并读取 `docs/WORKFLOW.md` 与 `docs/PLANS.md`。
- [x] (2026-07-03 10:27+08:00) 已梳理模板解析 / 存储错误的调用边界，并定义稳定 message descriptor 与英文 fallback。
- [x] (2026-07-03 10:27+08:00) 已迁移模板 common 层和 store 层错误，不在 common/store 中引入 `vscode` 运行时依赖。
- [x] (2026-07-03 10:27+08:00) 已在 Host 边界新增模板本地化 helper，并接入命令错误、模板侧栏 issue、Webview host/error 与模板市场安装 / 已安装列表错误展示。
- [x] (2026-07-03 10:27+08:00) 已更新自动化测试与中文 runtime bundle，确保新增 source string 都有 zh-cn 翻译，且目标文件不再含硬编码中文。
- [x] (2026-07-03 10:27+08:00) 已同步设计文档、设计索引和技术债追踪；本计划将在最终验证后移动到 completed。
- [x] (2026-07-03 10:31+08:00) 已运行最终定向测试、typecheck 和 diff check，准备提交本批次。

## 意外与发现

- 观察：`CanvasTemplateStore.ts` 当前不导入 `vscode`，且 `scripts/test/test-canvas-templates.mjs` 会用 esbuild 直接 bundle 该文件。
  证据：测试入口直接 `export * from './extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateStore'`，esbuild 配置未为 `vscode` 设置 external。
- 观察：`CanvasTemplateStore.writeMarketplaceTemplatePackage(...)` 过去对包内 `template.json` 直接执行 `JSON.parse(decodeUtf8(...))`，JSON parse 错误不受控。
  证据：迁移后将 decode 与 JSON parse 拆开，UTF-8 错误使用 `utf8Invalid` descriptor，JSON parse 错误使用 `templateJsonInvalid` descriptor。

## 决策记录

- 决策：模板 common/store 层只抛出携带稳定 descriptor 的错误，并保留英文 fallback message；实际中文翻译只放在 Host 边界 helper 中。
  理由：`canvasTemplates.ts` 属于 common 层，不能依赖 VS Code API；`CanvasTemplateStore.ts` 虽在 panel 目录下，但现有 Node 测试会直接 bundle，保持无 `vscode` 依赖可以降低测试和复用成本。
  日期/作者：2026-07-03 / Codex

## 结果与复盘

本批次已完成模板解析 / 存储错误文案迁移。`canvasTemplates.ts` 现在输出 `CanvasTemplateMessageDescriptor`、typed `CanvasTemplateError` 和英文 fallback；`CanvasTemplateStore.ts` 保持无 `vscode` 依赖，并把模板目录、sidecar、完整模板包、UTF-8 与 JSON parse 错误转换为 descriptor。Host 边界新增 `canvasTemplateLocalization.ts`，命令错误、模板侧栏 issue、主画布 Webview host/error、模板市场安装 / 已安装列表错误可以按 VS Code locale 展示。剩余本地化缺口收敛为 `webview/main.tsx` 的 test DOM helper 错误和旧中文 label 兼容映射，以及发布前英文/中文真实宿主 locale 手动验证。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/canvasTemplates.ts` 负责模板 JSON schema 的轻量解析、画布状态捕获成模板、模板统计和文件名清理。它属于 common 层，被 Host、Webview 相关测试和市场代码间接复用，因此不能调用 `vscode.l10n.t(...)`。

`extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateStore.ts` 负责从内置目录、当前 workspace 模板目录和全局模板目录读取模板 JSON，保存用户模板、保存市场完整模板包、读取/写入 market sidecar。它当前也不依赖 `vscode`，并在 `scripts/test/test-canvas-templates.mjs` 里被 Node/esbuild 直接打包测试。

错误 message descriptor 指一个只包含稳定 `id` 和必要参数的普通对象，例如 `{ id: 'templateNameEmpty' }`。common/store 层可以用 descriptor 生成英文 fallback `Error.message`；Host 边界再根据 `id` 调用 `vscode.l10n.t(...)` 生成当前 locale 的展示文案。

## 工作计划

第一步在 `canvasTemplates.ts` 中新增 `CanvasTemplateMessageDescriptor`、`CanvasTemplateError`、`createCanvasTemplateError(...)`、`getCanvasTemplateErrorDescriptor(...)` 与 `formatCanvasTemplateMessageDescriptor(...)`，然后把原有中文 `throw new Error(...)` 和 warnings 改成 descriptor + 英文 fallback。

第二步在 `CanvasTemplateStore.ts` 中复用同一套 descriptor，给 JSON parse、完整模板包路径、用户模板路径、sidecar、相对目录和 UTF-8 错误添加稳定 id，同时让 `CanvasTemplateStoreIssue` 保存 `messageDescriptor`，方便 UI later localize。

第三步新增 `extensions/vscode/dev-session-canvas/src/panel/canvasTemplateLocalization.ts`。该文件是 Host 边界，负责把 descriptor 翻译为 `vscode.l10n.t(...)` 文案，并提供 issue 和 error 的 localize helper。随后在 `extension.ts`、`CanvasPanelManager.ts`、`CanvasSidebarTemplateView.ts` 和 `CanvasTemplateMarketplacePanel.ts` 的用户可见错误展示处接入 helper。

第四步更新 `scripts/test/test-canvas-templates.mjs` 与 `scripts/test/test-ui-copy-localization.mts`。前者验证 descriptor id 与英文 fallback；后者把目标文件纳入硬编码中文扫描，并检查新增 Host source string 已写入 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`。

第五步更新 `docs/design-docs/ui-copy-localization.md`、`docs/design-docs/index.md` 和 `docs/exec-plans/tech-debt-tracker.md`，说明模板解析 / 存储错误已完成，剩余主要是 `webview/main.tsx` test DOM helper 错误和旧 label 兼容映射。

## 具体步骤

在仓库根目录执行以下命令探索与验证：

    rg -n "[\\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/common/canvasTemplates.ts extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateStore.ts
    npm run test:canvas-templates
    npm run test:ui-copy-localization
    npm run typecheck
    git diff --check

预期迁移后第一条命令对两个目标文件没有输出，定向测试和 typecheck 均通过。

## 验证与验收

自动验收标准是：`test:canvas-templates` 能证明模板解析和模板 store 错误带有稳定 descriptor 且英文 fallback 可读；`test:ui-copy-localization` 能证明目标 common/store 文件不再含硬编码中文或 `zh-CN` 字面量，Host 本地化 helper 的所有英文 source string 都在 zh-cn bundle 中有非空翻译；`typecheck` 证明新增类型和跨文件 imports 正确；`git diff --check` 证明没有尾随空白。

用户可观察验收是：英文环境导入坏 JSON 模板或安装坏模板包时看到英文错误；中文环境同一路径通过 VS Code locale 看到中文错误；模板文件名、节点标题、路径和 parser 原始错误保持原样。

## 幂等性与恢复

本计划只修改源码、测试和文档。测试命令可重复运行。若某个本地化 source string 遗漏，`npm run test:ui-copy-localization` 会指出缺失 key；补入 `bundle.l10n.zh-cn.json` 后重跑即可。若实现过程中发现范围过大，应保留 descriptor 层并只收口用户可见的模板解析 / 存储错误，不迁移 test-only 中文命令错误或 Webview 兼容 label。

## 证据与备注

最终验证已通过。关键输出如下：

    $ rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/common/canvasTemplates.ts extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateStore.ts extensions/vscode/dev-session-canvas/src/panel/canvasTemplateLocalization.ts
    <no output>

    > dev-session-canvas-workspace@0.21.0 test:canvas-templates
    > node scripts/test/test-canvas-templates.mjs

    > dev-session-canvas-workspace@0.21.0 test:ui-copy-localization
    > node --no-warnings --experimental-transform-types scripts/test/test-ui-copy-localization.mts
    ui copy localization tests passed

    > dev-session-canvas@0.21.0 typecheck
    > tsc -p ./tsconfig.json --noEmit

    $ git diff --check
    <no output>

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/common/canvasTemplates.ts` 中必须存在以下导出：`CanvasTemplateMessageDescriptor`、`CanvasTemplateMessageId`、`CanvasTemplateError`、`createCanvasTemplateError`、`getCanvasTemplateErrorDescriptor`、`formatCanvasTemplateMessageDescriptor`。它们不得依赖 `vscode`。

在 `extensions/vscode/dev-session-canvas/src/panel/canvasTemplateLocalization.ts` 中必须存在 `localizeCanvasTemplateMessageDescriptor(...)`、`localizeCanvasTemplateError(...)` 和 `localizeCanvasTemplateStoreIssue(...)`。该文件可以依赖 `vscode`，因为它只在 Extension Host 边界使用。

修订记录：2026-07-03 创建计划，明确本批次采用 descriptor + Host 边界本地化，避免 common/store 直接依赖 `vscode`。


修订记录：2026-07-03 完成实现后更新进度、发现、结果和验证证据，明确剩余缺口转为 test DOM 兼容文案与真实宿主 locale 验证。

修订记录：2026-07-03 最终验证通过后更新完成状态与归档路径。
