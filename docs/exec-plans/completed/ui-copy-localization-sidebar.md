# Sidebar 文案本地化

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。当前计划遵循 `docs/PLANS.md` 的要求维护；计划完成并提交时，如仍有遗留技术债，必须同步更新 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次把 `extensions/vscode/dev-session-canvas/src/sidebar/` 下 sidebar 树视图与 sidebar Webview 的产品自有文案迁入 VS Code runtime l10n。完成后，英文 VS Code 用户在状态摘要、操作面板、节点列表、会话历史和模板侧栏看到英文默认文案；简体中文 locale 继续通过 `l10n/bundle.l10n.zh-cn.json` 获得中文文案。节点标题、模板名、路径、用户历史会话标题、provider 输出等用户或外部事实文本保持原样。

## 进度

- [x] (2026-07-02 17:05+08:00) 已读取 `docs/WORKFLOW.md`、`docs/PLANS.md` 与 `docs/design-docs/ui-copy-localization.md`，确认 sidebar 文件运行在 Extension Host 侧生成 HTML，优先使用 `vscode.l10n.t(...)`，Webview 内脚本所需文案由 Host 注入为结构化 copy 对象。
- [x] (2026-07-02 17:10+08:00) 已扫描 sidebar 五个文件，确认剩余中文集中在 `CanvasSidebarView.ts` 树项摘要、`CanvasSidebarActionsView.ts` 操作面板、`CanvasSidebarNodeListView.ts` 节点列表、`CanvasSidebarSessionHistoryView.ts` 会话历史和 `CanvasSidebarTemplateView.ts` 模板侧栏。
- [x] (2026-07-02 19:32+08:00) 已迁移 `CanvasSidebarView.ts` 和 `CanvasSidebarActionsView.ts` 文案，建立 Host 构造 copy 对象、序列化注入 inline script 的 sidebar HTML 模式。
- [x] (2026-07-02 19:32+08:00) 已迁移 `CanvasSidebarNodeListView.ts`、`CanvasSidebarSessionHistoryView.ts`、`CanvasSidebarTemplateView.ts` 中用户可见文案，并保留节点标题、模板名、历史首条用户指令、路径、provider 名称和市场错误详情等事实文本原样。
- [x] (2026-07-02 19:32+08:00) 已更新 zh-cn runtime bundle 与 `test:ui-copy-localization` 扫描范围，sidebar 五个 provider 文件中的 `vscode.l10n.t` 源字符串均要求有简体中文翻译。
- [x] (2026-07-02 19:32+08:00) 已更新设计文档、技术债记录和本计划，并完成验证命令。

## 意外与发现

- 观察：sidebar Webview HTML 不是主画布 React Webview bundle，而是在 Extension Host 文件中拼接 HTML 与 inline script。
  证据：`CanvasSidebarActionsView.ts`、`CanvasSidebarNodeListView.ts`、`CanvasSidebarSessionHistoryView.ts` 和 `CanvasSidebarTemplateView.ts` 都有 `build...Html()` 函数返回 HTML 字符串。
- 观察：现有 `test:ui-copy-localization` 只扫描 `extension.ts` 和 `CanvasPanelManager.ts` 的 `vscode.l10n.t` 源字符串，暂未覆盖 sidebar。
  证据：`scripts/test/test-ui-copy-localization.mts` 中 `hostRuntimeSourceFiles` 仅包含两项。
- 观察：sidebar node-list 和 session-history 的 Playwright helper 直接 bundle provider 文件，mock 的 `vscode` 模块原本没有 `env.language` 和 `l10n.t`。
  证据：首次运行 `npm run test:sidebar-node-list` 失败在 `buildSidebarNodeListCopy()`，错误为 `TypeError: Cannot read properties of undefined (reading 't')`；补齐测试 stub 后通过。
- 观察：会话历史的相对时间原先对中文做 `.replace(/\s+/g, '')`，英文默认文案如果继续去空格会显示为 `justnow` / `1hrago`。
  证据：`buildCanvasSidebarSessionHistoryItems()` 的 `timestampLabel` 构造已改为保留 `formatRelativeTimestamp()` 返回值空格，`npm run test:sidebar-session-history` 通过。

## 决策记录

- 决策：sidebar 本批使用 `vscode.l10n.t(...)`，不复用主画布 Webview typed dictionary。
  理由：sidebar HTML 由 Extension Host 生成，可以直接使用 VS Code runtime l10n；主画布 typed dictionary 是为浏览器 bundle 不能调用 `vscode.l10n.t` 的边界设计的。
  日期/作者：2026-07-02 / Codex
- 决策：inline script 中需要动态设置的按钮、空状态、aria-label 等文案由 Host 构造 `copy` 对象后序列化注入，不在脚本里保留中文或英文产品文案。
  理由：脚本运行在 Webview 内，不能调用 `vscode.l10n.t`；注入 copy 对象可以让测试和扫描发现源字符串，并避免后续新增硬编码。
  日期/作者：2026-07-02 / Codex
- 决策：sidebar 自动化测试默认按英文 locale stub 断言可见 UI 文案，中文用户体验由 `test:ui-copy-localization` 对 runtime zh-cn bundle 做覆盖验证。
  理由：这些测试直接加载 HTML 字符串，不启动真实 VS Code language pack；用英文默认断言能验证默认文案和 DOM 行为，同时避免把测试夹具绑定到中文可见 label。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本批完成 sidebar 五个 provider 文件的产品自有文案迁移：`CanvasSidebarView.ts` 的树项摘要、`CanvasSidebarActionsView.ts` 的操作与文件过滤面板、`CanvasSidebarNodeListView.ts` 的节点/分组列表、`CanvasSidebarSessionHistoryView.ts` 的历史搜索/分组/动作和 `CanvasSidebarTemplateView.ts` 的模板列表/市场动作都以英文为默认源字符串，并在 `l10n/bundle.l10n.zh-cn.json` 中补齐中文翻译。`scripts/test/test-ui-copy-localization.mts` 已纳入 sidebar 文件，`rg -n "[\p{Han}]" extensions/vscode/dev-session-canvas/src/sidebar` 无命中。经由 shared presentation/status/helper 生成的状态、统计和模板详情文案仍属于后续共享模块债务；剩余本地化技术债集中在模板市场 panel/Webview、模板保存表单和 shared presentation/status/helper 模块。

## 上下文与定向

sidebar 源文件位于 `extensions/vscode/dev-session-canvas/src/sidebar/`。`CanvasSidebarView.ts` 是 VS Code TreeDataProvider 树视图，树项 label、description、tooltip 和 command title 都在 Extension Host 中创建。`CanvasSidebarActionsView.ts`、`CanvasSidebarNodeListView.ts`、`CanvasSidebarSessionHistoryView.ts` 和 `CanvasSidebarTemplateView.ts` 是 WebviewViewProvider，它们用 `build...Html()` 返回 HTML 字符串并在 inline script 中渲染列表或绑定按钮。由于这些 HTML 在 Extension Host 中生成，静态 HTML 文案可以直接 `${vscode.l10n.t('...')}`；inline script 动态文案则应通过 `const copy = ${serialize...}` 注入。

本地化源字符串默认写英文，中文翻译写入 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`。用户输入和外部事实文本不翻译，包括节点标题、模板名、工作区路径、历史会话首条用户消息、Git ref、provider 名称、命令行、错误对象中已经来自外部系统的原文。

## 工作计划

先处理 `CanvasSidebarView.ts` 和 `CanvasSidebarActionsView.ts`，因为它们较小且能验证 TreeDataProvider 与 sidebar HTML copy 注入两种模式。随后处理节点列表、会话历史和模板侧栏：把 HTML 静态文案替换为 `vscode.l10n.t`，把脚本里的动态文案收拢到 copy 对象，必要时新增 `format...` helper 以保留插值。最后扩展 `test:ui-copy-localization` 的 Host runtime 扫描范围，更新 zh-cn bundle 与正式文档。

## 具体步骤

在仓库根目录执行：

    rg -n "[\p{Han}]" extensions/vscode/dev-session-canvas/src/sidebar
    npm run test:ui-copy-localization
    npm run test:sidebar-node-list
    npm run test:sidebar-session-history
    npm run test:sidebar-list-colors
    npm run typecheck
    git diff --check

本批实际执行结果如下：

    rg -n "[\p{Han}]" extensions/vscode/dev-session-canvas/src/sidebar
    # 无输出，退出码 1，表示 sidebar 源文件已无中文命中。
    npm run test:ui-copy-localization
    # ui copy localization tests passed
    npm run test:sidebar-node-list
    # sidebar node list tests passed
    npm run test:sidebar-session-history
    # 通过，无额外输出
    npm run test:sidebar-list-colors
    # sidebar list color token tests passed
    npm run typecheck
    # tsc -p ./tsconfig.json --noEmit 通过
    git diff --check
    # 无输出

## 验证与验收

自动验收包括：`test:ui-copy-localization` 能扫描 sidebar `vscode.l10n.t` 源字符串并验证 zh-cn bundle 非空；sidebar node-list、session-history、list-color 相关测试通过；TypeScript 编译通过；`rg` 扫描剩余中文只出现在 zh-cn bundle、测试输入、非用户可见注释或明确登记的外部/兼容字符串。用户可观察验收是：英文 VS Code locale 下 sidebar 状态摘要、操作面板、节点列表、会话历史与模板侧栏显示英文；简体中文 locale 下显示中文。

## 幂等性与恢复

本计划只修改源码、测试和文档，不需要破坏性命令。重复运行测试和扫描是安全的。如果某个 sidebar 文件迁移引入脚本错误，先用相关 `scripts/test/test-sidebar-*.mjs` 定位对应 Webview HTML，不回滚无关历史提交。

## 证据与备注

初始扫描显示 sidebar 五个文件共 185 条中文命中：

    CanvasSidebarView.ts: 71
    CanvasSidebarTemplateView.ts: 37
    CanvasSidebarSessionHistoryView.ts: 37
    CanvasSidebarNodeListView.ts: 28
    CanvasSidebarActionsView.ts: 12

当前分支为 `ui-copy-localization-foundation`，工作树在本计划创建前干净，但本地分支相对 `origin/main` ahead 5 / behind 9；本批继续沿用户要求的本地化批次分支推进，不在本批中执行 rebase。

最终扫描显示 `extensions/vscode/dev-session-canvas/src/sidebar/` 无中文命中。`scripts/test/test-sidebar-session-history.mjs` 和 `scripts/test/test-sidebar-node-list.mjs` 仍包含中文用户夹具或旧状态夹具，这些不是 sidebar 产品 UI 文案。

## 接口与依赖

本批不引入新依赖。新增 helper 应保持文件内私有，优先使用现有 `serialize...ForInlineScript()` 防止 `<` / `>` 破坏 inline script。需要注入脚本文案时，定义普通对象并用 JSON 序列化，例如 `const copy = ${serializeSidebarActionsCopyForInlineScript(buildSidebarActionsCopy())};`；对象字段只包含字符串，不传函数。
