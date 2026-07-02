# UI 文案本地化第三批：完成 extension.ts Host 文案

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。计划本身放在 `docs/exec-plans/active/ui-copy-localization-extension-host-completion.md`，完成后应移入 `docs/exec-plans/completed/`，并把仍遗留、需要后续跟踪的技术债登记或更新到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次完成 `extensions/vscode/dev-session-canvas/src/extension.ts` 中剩余的用户可见 Host UI 文案迁移，包括用户明确点名的 session history QuickPick。完成后，扩展宿主弹出的诊断通知、画布 reset/分组提示、Explorer 资源校验、workspace folder/worktree 流程、文件过滤输入、模板 QuickPick/确认框，以及 session history QuickPick 的标题、placeholder、description 与 action 文案，默认英文环境会显示英文源字符串，简体中文环境会通过 VS Code runtime l10n bundle 显示中文。

本批次仍不迁移 `extension.ts` 中只给自动化测试使用的 test command 错误消息。用户数据、文件路径、模板名称、workspace folder 名称、provider 返回的错误文本和 Git stderr 保持原样，只把扩展自身组织的 UI 句子放入 `vscode.l10n.t(...)`。

## 进度

- [x] (2026-07-02 01:50Z) 确认工作区干净，当前分支已有前两批本地化提交。
- [x] (2026-07-02 01:55Z) 创建本 ExecPlan，限定第三批迁移范围为 `extension.ts` 剩余用户可见 Host UI 文案，并明确包含 session history QuickPick。
- [x] (2026-07-02 02:40Z) 迁移 `extension.ts` 剩余用户可见 UI 文案到 `vscode.l10n.t(...)`，保留用户/外部事实不翻译；剩余中文仅为 `registerTestCommands` 的 test-only 错误。
- [x] (2026-07-02 02:46Z) 补齐 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json` 对应中文翻译，并把 untrusted session history 标题的 `CanvasPanelManager` key 纳入扫描。
- [x] (2026-07-02 02:52Z) 更新 smoke 中 session history QuickPick、Agent launch QuickPick 和 sidebar attention suffix 默认英文断言。
- [x] (2026-07-02 03:00Z) 同步设计文档与技术债记录，说明 `extension.ts` 用户可见 Host 文案已完成，剩余迁移转向 CanvasPanelManager/sidebar Webview/主 Webview。
- [x] (2026-07-02 03:12Z) 运行验证并记录输出。

## 意外与发现

- 观察：`extension.ts` 中仍有大量中文字符串，但并非全部属于用户可见 UI 文案。`registerTestCommands` 下的 `测试命令 ...` 错误只服务自动化，注释也不是 UI 文案。
  证据：迁移后运行 `rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/extension.ts`，只剩 `registerTestCommands` 与 `showQuickPickWithTestOverride` 中的测试命令错误。

- 观察：session history 只读 QuickPick 的标题来自 `CanvasPanelManager.getSessionHistoryRestoreBlockReason()`，不是 `extension.ts` 本地字符串。若只迁移 QuickPick item/placeholder，smoke 仍会看到中文 title。
  证据：`extensions/vscode/dev-session-canvas/src/extension.ts` 的 `showSessionHistoryQuickPick()` 使用 `title: restoreBlockReason`；`CanvasPanelManager.getSessionHistoryRestoreBlockReason()` 原返回中文句子。

## 决策记录

- 决策：第三批默认继续使用 `vscode.l10n.t` 的英文源字符串作为 key，动态值使用命名参数。
  理由：这延续前两批已验证的 VS Code runtime localization 路径，`scripts/test/test-ui-copy-localization.mts` 已能扫描 Host 英文源字符串并要求 zh-cn bundle 翻译非空。
  日期/作者：2026-07-02 / Codex

- 决策：本批次同步更新 smoke baseline，而不是为了保留旧测试断言继续跳过 session history QuickPick。
  理由：用户明确要求包含 session history QuickPick；默认英文源字符串会改变 intercepted QuickPick item 的 label/description/placeholder，因此需要把 smoke 断言改为英文默认文案。
  日期/作者：2026-07-02 / Codex

- 决策：将 `CanvasPanelManager.getSessionHistoryRestoreBlockReason()` 的 untrusted session history 标题一起迁移，并把 `CanvasPanelManager.ts` 加入 `scripts/test/test-ui-copy-localization.mts` 的 Host runtime 扫描。
  理由：该标题直接显示在 session history QuickPick 和 sidebar 状态说明中，是当前用户点名场景的一部分；如果不迁移，会留下中英混杂体验且测试无法防止 bundle key 缺失。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

实现与验证均已完成。`extension.ts` 中 diagnostics 通知、模板命令错误、workspace/worktree 流程、分组/reset/focus 提示、Agent settings file 提示、Explorer execution 校验、sidebar node-list attention suffix、session history QuickPick、Agent launch QuickPick、文件过滤和模板命令入口均改为英文源字符串加 zh-cn bundle 翻译。为避免 session history QuickPick title 仍显示中文，本批次同时迁移了 `CanvasPanelManager.getSessionHistoryRestoreBlockReason()`。

本批次明确不宣称全 UI 已完成本地化。剩余技术债是 `CanvasPanelManager` 其他生命周期、执行状态、模板、权限提示，以及 sidebar Webview、模板市场 Webview、主画布 Webview 中的硬编码文案。

验证输出摘要：

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:extension-manifest
    extension manifest tests passed

    npm run test:package-vsix-file-list
    package-vsix file-list tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    # 无输出

完整 `npm run test:smoke` 未在本批次运行；本批次已更新 smoke baseline，但真实 VS Code smoke 全量成本较高，后续创建 MR 前可按常规回归策略补跑。


## 上下文与定向

前两批已经完成 manifest/Webview 本地化基础设施，以及 `extension.ts` 中 Terminal shell、Agent CLI、创建节点、sidebar node-list 与 Explorer Markdown 校验等低风险入口。本批次在同一分支继续推进，主要文件仍是 `extensions/vscode/dev-session-canvas/src/extension.ts` 和 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`。因为 session history QuickPick title 来自 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`，本批次也触达该文件的一条用户可见文案。

`tests/vscode-smoke/extension-tests.cjs` 原包含旧中文断言，例如 session history QuickPick description `恢复`、Agent launch QuickPick label `使用自定义命令创建`、sidebar attention suffix `有提醒`。本批次迁移这些入口后，断言已同步为默认英文 `Resume`、`Create with custom command` 和 `Attention`。

## 工作计划

先用 `rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/extension.ts` 盘点剩余中文。迁移时从低风险 Host UI 开始：diagnostics notification、group/reset/focus提示、Agent settings file 提示、Explorer execution 资源校验、workspace folder/worktree 添加/移除、worktree 输入框与确认 modal、session history QuickPick、Agent launch QuickPick、文件过滤输入、模板命令 QuickPick/确认框和模板来源/统计描述。所有动态信息使用命名参数，例如 `{folder}`、`{template}`、`{path}`、`{count}`。

更新 `bundle.l10n.zh-cn.json`，把新增英文源字符串映射回原中文或更清晰的中文。`scripts/test/test-ui-copy-localization.mts` 已从只扫描 `extension.ts` 扩展为扫描 `extension.ts` 与 `CanvasPanelManager.ts`，覆盖本批次新增的 session history restore block reason key。同步 smoke 断言覆盖 session history 和 Agent launch QuickPick 的默认英文文案。

完成后运行 `npm run test:ui-copy-localization`、`npm run test:extension-manifest`、`npm run test:package-vsix-file-list`、`npm run typecheck` 和 `git diff --check`。

## 具体步骤

所有命令都从仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2` 执行。

确认状态：

    git status --short --branch

实现后运行：

    npm run test:ui-copy-localization
    npm run test:extension-manifest
    npm run test:package-vsix-file-list
    npm run typecheck
    git diff --check

如 smoke 断言改动较多，至少记录未运行完整 smoke 的原因；本批次直接修改 smoke baseline，但完整 `npm run test:smoke` 成本高，可在最终说明中列为未执行的残余验证。

## 验证与验收

验收标准一：`extension.ts` 中所有用户可见 Host UI 文案均通过 `vscode.l10n.t(...)` 输出，默认源字符串为英文，简体中文 bundle 存在对应翻译；`registerTestCommands` 的中文 test-only 错误可保留。

验收标准二：session history QuickPick 的 `Resume`、`Fork`、只读 placeholder、普通 placeholder 和 untrusted title 均已迁移，并且 smoke 断言与默认英文文案一致。

验收标准三：`scripts/test/test-ui-copy-localization.mts` 能发现新增 Host key 缺失，`npm run typecheck` 证明 `vscode.l10n.t` 参数类型正确。

验收标准四：文档如实记录本批次边界，不把 `CanvasPanelManager` 其他文案、sidebar Webview 或主 Webview 的文案描述为已完成。

## 幂等性与恢复

本批次只修改源码、bundle、测试和文档，不涉及持久化迁移。若某个文案迁移破坏测试，应优先判断它是否是用户可见 UI；如果是，更新测试 baseline；如果是 test-only 或协议事实，则回退该具体字符串并在本计划记录原因。不要因为语言统一而翻译用户输入、模板名称、路径、Git stderr 或 provider 输出。

## 证据与备注

当前初始状态：

    git status --short --branch
    ## ui-copy-localization-foundation...origin/main [ahead 2]

迁移后关键扫描结果：

    rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/extension.ts
    # 只剩 registerTestCommands / showQuickPickWithTestOverride 的 test-only 错误

    node -e '<scan vscode.l10n.t keys against bundle>'
    missing 0

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:extension-manifest
    extension manifest tests passed

    npm run test:package-vsix-file-list
    package-vsix file-list tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    # 无输出

## 接口与依赖

使用 VS Code runtime localization API：

    vscode.l10n.t('Select a session and resume or fork it into a new node')
    vscode.l10n.t('Removed worktree but could not remove folder from the current workspace automatically: {folder}', { folder })

中文翻译文件位于：

    extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json

修订记录：2026-07-02 创建第三批 `extension.ts` 剩余 Host 文案迁移计划，原因是用户要求完成剩余文案并包含 session history QuickPick。

修订记录：2026-07-02 完成实现前文档同步，补充 `CanvasPanelManager.getSessionHistoryRestoreBlockReason()` 的迁移决策与剩余技术债边界。

修订记录：2026-07-02 验证通过后记录测试证据，准备归档本计划。
