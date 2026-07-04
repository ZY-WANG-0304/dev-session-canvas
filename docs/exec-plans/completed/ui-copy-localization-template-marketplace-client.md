# 模板市场客户端文案本地化

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。当前计划遵循 `docs/PLANS.md` 的要求维护；计划完成并提交时，如仍有遗留技术债，必须同步更新 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次把 `extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts` 中模板市场客户端拥有的错误、校验和默认发布草稿文案迁入 VS Code runtime l10n。完成后，英文 VS Code 用户在安装、更新、发布、token 交换、协议解析、包校验和 HTTP/network 失败时看到英文默认错误；简体中文 locale 通过 `l10n/bundle.l10n.zh-cn.json` 继续看到中文。模板名、作者、文件名、URL、HTTP 状态码、schema/parser 原始错误和市场服务返回的原始错误详情保持原样。

## 进度

- [x] (2026-07-02 23:00+08:00) 已确认当前分支 `ui-copy-localization-foundation` 工作区干净，并读取 `docs/WORKFLOW.md`、`docs/PLANS.md` 与 `docs/design-docs/ui-copy-localization.md`。
- [x] (2026-07-02 23:05+08:00) 已扫描 `TemplateMarketplaceClient.ts`，确认剩余中文集中在安装/更新/发布校验、token 与详情解析、安装链接解析、可信来源校验、完整模板包解析和 HTTP/network 请求错误。
- [x] (2026-07-02 23:25+08:00) 已迁移 `TemplateMarketplaceClient.ts` 的产品拥有文案到 `vscode.l10n.t(...)`，并确认源码不再包含中文或 `zh-CN`。
- [x] (2026-07-02 23:35+08:00) 已更新 zh-cn runtime bundle、i18n 测试扫描范围与模板市场结构测试。
- [x] (2026-07-02 23:45+08:00) 已更新 UI 文案设计文档、设计索引与技术债追踪，把 client 低层错误从剩余债务中移除。
- [x] (2026-07-02 23:55+08:00) 已运行验证命令，准备移动本计划到 `docs/exec-plans/completed/` 并提交一次 commit。

## 意外与发现

- 观察：`TemplateMarketplaceClient.ts` 已经运行在 Extension Host 内并导入 `vscode`，因此客户端错误可以直接调用 `vscode.l10n.t(...)`，不需要新增跨 Webview 字典或协议字段。
  证据：文件顶部已有 `import * as vscode from 'vscode';`，客户端由 `extension.ts` 在激活路径中创建。
- 观察：完整模板包解析使用旧中文错误前缀判断 unzip filter 中的受控错误，迁移后不能再依赖自然语言前缀。
  证据：`parseMarketplaceTemplatePackageForInstall()` 的 catch 分支原先检查 `error.message.startsWith('完整模板包')`；本批改为 `error instanceof MarketplaceTemplatePackageError`。
- 观察：`TemplateMarketplaceClient.ts` 中的默认发布草稿 description / README / CHANGELOG 会直接出现在插件内发布表单里，属于用户提交前的产品默认建议文案。
  证据：`buildPublishDraft()` 的 `defaultDescription`、`defaultReadme`、`defaultChangelog` 会被 `CanvasTemplateMarketplacePanel.ts` 写入 `state.publishForm`。

## 决策记录

- 决策：本批直接在 `TemplateMarketplaceClient.ts` 中使用 `vscode.l10n.t(...)`，不新增自定义错误协议或跨文件字典。
  理由：该文件属于 Extension Host 运行时边界，和前序 Host 文案迁移使用同一 VS Code 官方机制即可；新增协议会扩大范围并影响调用方。
  日期/作者：2026-07-02 / Codex
- 决策：保留 HTTP 状态码、字段名、文件名、路径、URL、parser/schema 原始错误和市场服务返回错误详情原样，只本地化产品拥有的前后缀和 fallback 文案。
  理由：这些动态值是排错事实或外部系统输出，翻译会降低可追踪性；本地化前后缀已足以让用户理解上下文。
  日期/作者：2026-07-02 / Codex
- 决策：完整模板包受控解析错误改用专用 Error 子类识别，而不是继续依赖本地化后的 message 前缀。
  理由：错误 message 会随 locale 改变，不能作为控制流标记；Error 子类能保持行为稳定并避免测试依赖中文。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本批完成模板市场客户端文案本地化。`TemplateMarketplaceClient.ts` 中安装、更新、发布、token 交换、安装链接解析、可信来源校验、详情 API 解析、完整模板包解析和 HTTP/network 请求错误均改为英文默认 `vscode.l10n.t(...)` 源字符串，并在 zh-cn runtime bundle 中补齐中文翻译；默认发布草稿的 description、README fallback 与 CHANGELOG fallback 也跟随 locale。完整模板包解析新增 `MarketplaceTemplatePackageError`，让受控包解析失败不再依赖本地化后的 message 前缀。`scripts/test/test-ui-copy-localization.mts` 已把客户端纳入 Host runtime l10n bundle 扫描并阻止该文件重新出现中文或 `zh-CN`。剩余本地化债务集中在 shared presentation/status/helper 模块、`main.tsx` test DOM helper 错误和旧 label 兼容映射；真实英文/中文 VS Code locale 端到端人工验证仍需发布前补齐。

## 上下文与定向

模板市场客户端位于 `extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts`。它负责列出已安装市场模板、检查更新、解析 `vscode://.../install-template` 安装链接、下载完整模板包、校验 template/package SHA-256、保存模板包或内联模板、生成发布草稿、调用市场发布 API，以及用 VS Code GitHub session 换取市场 token。该文件抛出的错误会被 `CanvasTemplateMarketplacePanel.ts`、sidebar provider 或命令入口捕获后展示给用户，因此属于 Extension Host runtime UI 文案边界。

`extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json` 承载 runtime 简体中文翻译，key 是英文源字符串。`scripts/test/test-ui-copy-localization.mts` 会读取纳入扫描的 Host runtime 文件，提取 `vscode.l10n.t('...')` 源字符串，并断言 zh-cn bundle 中存在非空翻译。当前批次需要把 `TemplateMarketplaceClient.ts` 加入扫描，并增加该文件不再出现中文或 `zh-CN` 的断言。

## 工作计划

先迁移 `TemplateMarketplaceClient.ts` 中 `throw new Error(...)`、`reject(new Error(...))` 和 `request.destroy(new Error(...))` 的中文文案，把英文作为 `vscode.l10n.t(...)` 源字符串，动态值通过命名参数传入。接着处理完整模板包解析中的 prefix control flow：新增 `MarketplaceTemplatePackageError` 并仅用于受控包解析错误，catch 分支改为 `instanceof` 判断。随后把发布草稿中由产品生成的默认 description/readme/changelog 也接入 l10n，保留模板名作为用户事实。最后更新 bundle、测试扫描、设计文档和技术债追踪。

## 具体步骤

在仓库根目录执行修改和验证。需要重点运行以下命令：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts
    npm run test:ui-copy-localization
    npm run test:canvas-templates
    npm run typecheck
    git diff --check

预期第一条命令无输出；`test:ui-copy-localization` 应确认新增客户端文件中的 l10n 源字符串都有 zh-cn 翻译；`test:canvas-templates` 应继续通过结构性模板市场断言；`typecheck` 应通过；`git diff --check` 无输出。

## 验证与验收

自动验收包括：`TemplateMarketplaceClient.ts` 无硬编码中文或 `zh-CN`；新增 `vscode.l10n.t(...)` 源字符串都存在 zh-cn runtime bundle 翻译；模板市场现有结构测试仍确认客户端安装、更新、发布和 token 路径存在；TypeScript 类型检查通过。用户可观察验收是：英文 VS Code 中模板市场客户端错误显示英文，简体中文 VS Code 中同类错误显示中文；模板名、文件名、路径、HTTP 状态和市场服务错误详情保持原样。

## 幂等性与恢复

本计划只修改源码、测试和文档，不需要破坏性命令。重复运行扫描和测试是安全的。如果替换过程中发现调用方依赖某个旧错误文本，先把依赖改为结构化断言或本地化源字符串断言，不回滚用户未提交的无关变更。

## 证据与备注

初始扫描显示 `TemplateMarketplaceClient.ts` 仍有多处中文错误与注释命中，分布在安装、发布、token、安装链接、可信来源、完整模板包、详情接口和 HTTP 请求 helper 中。本批结束时同一扫描无输出。当前分支相对 `origin/main` 仍是 ahead / behind 状态；按用户连续批次要求继续在当前本地化分支推进，不在本批执行 rebase。

本批实际验证记录如下：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts
    # 无输出，退出码 1，表示该 client 源码已无中文或 zh-CN 命中。

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:canvas-templates
    # 通过，无额外输出

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    # 无输出

## 接口与依赖

本批不引入新依赖。新增的 `MarketplaceTemplatePackageError` 只用于 `TemplateMarketplaceClient.ts` 内部识别受控包解析失败，不改变导出 API。所有本地化调用使用 VS Code 官方 `vscode.l10n.t(...)`，源字符串为英文，简体中文翻译写入现有 `bundle.l10n.zh-cn.json`。

## 完成更新记录

2026-07-02 / Codex：完成计划执行并准备归档。更新内容包括源码迁移、bundle 与测试扫描、正式设计文档、技术债追踪和验证证据。
