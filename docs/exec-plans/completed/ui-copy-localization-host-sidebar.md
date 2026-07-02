# UI 文案本地化第二批：Host 与 Sidebar 入口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。计划完成后已归档到 `docs/exec-plans/completed/ui-copy-localization-host-sidebar.md`，并把仍遗留、需要后续跟踪的技术债登记或更新到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次在已完成的本地化基础设施上继续迁移低风险、用户高频可见的 Extension Host UI 文案。完成后，用户在命令面板触发“选择 Terminal shell”“选择 Agent CLI”“创建节点”和“显示节点列表”等 Host QuickPick 或通知时，英文环境会看到英文默认文案，简体中文环境会通过 VS Code `l10n` bundle 看到中文翻译。

这批次不尝试迁移所有 `CanvasPanelManager` 生命周期、执行状态和 Webview 大组件文案，避免一次性修改高风险状态机文案。可观察效果主要来自 Host QuickPick 标题、placeholder、item description/detail、通知与 explorer 资源校验提示。

## 进度

- [x] (2026-07-02 01:05Z) 确认当前分支 `ui-copy-localization-foundation` 工作区干净，上一批已提交。
- [x] (2026-07-02 01:10Z) 创建本 ExecPlan，限定第二批迁移范围。
- [x] (2026-07-02 01:38Z) 迁移 `extensions/vscode/dev-session-canvas/src/extension.ts` 中 Terminal shell、Agent CLI、创建节点、sidebar node-list QuickPick 和 Explorer Markdown 校验相关文案到 `vscode.l10n.t`；session history QuickPick 因 smoke baseline 暂缓。
- [x] (2026-07-02 01:38Z) 补齐 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json` 对应中文翻译。
- [x] (2026-07-02 01:38Z) 扩展 `scripts/test/test-ui-copy-localization.mts`，扫描 `extension.ts` 中的 Host `vscode.l10n.t` 英文源字符串，并校验 zh-cn bundle 翻译非空。
- [x] (2026-07-02 01:40Z) 运行验证并记录输出。

## 意外与发现

- 观察：VS Code API 类型定义明确要求使用 `vscode.l10n.t` 时，extension manifest 需要定义 `l10n`，并提供 `bundle.l10n.<language>.json`。
  证据：`docs/references/vscode-official-extension-docs/api/references/generated/vscode.d.ts` 的 `namespace l10n` 注释中说明该前提；上一批已经在主扩展 manifest 中声明 `"l10n": "./l10n"`。

- 观察：`extension.ts` 同时包含测试强依赖的历史恢复/分叉中文 description，真实 smoke 中有断言 `quickPickItem.description === '恢复'`。
  证据：`tests/vscode-smoke/extension-tests.cjs` 包含该断言。第二批若直接改默认英文会影响现有 smoke baseline，因此需要优先迁移可由本仓库单元测试约束的低风险入口，并避免不必要破坏大型 smoke 断言。


- 观察：第二批实际迁移时保留了 session history QuickPick 默认中文 `恢复` / `分叉` 和只读 placeholder，且保留 sidebar node-list attention 后缀 `有提醒`。
  证据：`tests/vscode-smoke/extension-tests.cjs` 对 session history `恢复` 和 sidebar attention `有提醒` 有显式断言；当前改动只迁移 show node-list 的空状态、placeholder、定位失败 warning 和 detail 中节点类型描述。

## 决策记录

- 决策：第二批默认使用 VS Code `vscode.l10n.t` 的英文源字符串作为 key，中文翻译写入 `bundle.l10n.zh-cn.json`。
  理由：这是 VS Code extension runtime 官方支持路径，不需要再自建 Host 字典；英文源字符串也能作为默认 fallback，符合英文 Marketplace 主路径。
  日期/作者：2026-07-02 / Codex

- 决策：本批次不迁移 `CanvasPanelManager` 中的执行状态/恢复状态自然语言，也不迁移 smoke 已强断言的 session history `恢复` / `分叉` description，除非同步更新对应自动化。
  理由：这些文案和历史会话状态、协议测试、smoke baseline 交织较多；第二批目标是扩大低风险覆盖，而不是重做状态文案 baseline。
  日期/作者：2026-07-02 / Codex


- 决策：测试不维护手工枚举的 Host key 列表，而是用正则扫描 `extension.ts` 中的 `vscode.l10n.t('...')` 英文源字符串，要求 zh-cn bundle 存在同名 key 且翻译非空。
  理由：第二批迁移的 Host 文案数量较多，扫描源码能避免后续新增或改名 `vscode.l10n.t` 字符串时忘记同步 bundle；它仍保持边界克制，只覆盖已经显式接入 VS Code runtime localization 的 Host 文案。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本计划已完成第二批 Host 低风险文案迁移。当前已迁移 Terminal shell 选择、Agent CLI 选择/安装/手动输入、创建节点 QuickPick、Explorer Markdown 校验 warning、sidebar node-list 的空状态/placeholder/定位失败 warning，以及创建节点中对象描述等低风险 Host 文案。仍保留 session history QuickPick、CanvasPanelManager 生命周期/执行状态、sidebar Webview 和大型主 Webview 中的硬编码文案作为后续技术债，不把本批次描述为全量本地化。验证命令 `npm run test:ui-copy-localization`、`npm run test:extension-manifest`、`npm run test:package-vsix-file-list`、`npm run typecheck` 和 `git diff --check` 均已通过。

## 上下文与定向

上一批已经完成 `package.nls.json` 英文默认、`package.nls.zh-cn.json` 简体中文、`extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`、Webview typed dictionary 与资源 staging。本批次只在这个基础上扩展 runtime 文案迁移。

关键文件：

`extensions/vscode/dev-session-canvas/src/extension.ts` 是 VS Code Extension Host 入口，负责注册命令、弹出 QuickPick / InputBox / notification、调用 `CanvasPanelManager`。本批次主要修改这里。

`extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json` 是 `vscode.l10n.t` 的简体中文翻译文件。默认英文源字符串作为 key，中文值作为翻译。

`scripts/test/test-ui-copy-localization.mts` 已验证 Webview 字典；本批次可以扩展它或新增测试，用文件级扫描检查新增 Host 英文源字符串在中文 bundle 中有翻译。

## 工作计划

先在 `extension.ts` 引入一个短别名，例如 `const localize = vscode.l10n.t;` 或直接使用 `vscode.l10n.t(...)`。为了避免 `this` 绑定不明确，优先直接调用 `vscode.l10n.t`。

迁移低风险入口：`describeTerminalShellConfigurationTarget`、`promptTerminalShellSelection`、`buildTerminalShellQuickPickItems`、`promptAgentCliSelection`、`promptAgentCliInstallation`、`buildAgentCliInstallQuickPickItems`、`promptManualAgentCliCommand`、`buildAgentCliQuickPickItems`、`formatAgentCliCandidateSource`、`promptCreateNodeRequest`、`showExplorerMarkdownNoteResourceWarning`、`showSidebarNodeListQuickPick` 以及 `buildCreateNodeQuickPickItems`。session history QuickPick 与 sidebar attention 后缀已经确认和 smoke baseline 强绑定，本批次跳过；相关遗留继续由技术债追踪。

更新中文 bundle，把英文源字符串逐条映射到原中文文案或更清晰的中文文案。动态变量使用命名参数，如 `{target}`、`{provider}`、`{command}`，避免中文语序被英文拼接固定。

补充测试：读取 `bundle.l10n.zh-cn.json`，扫描 `extension.ts` 中所有 `vscode.l10n.t('...')` 英文源字符串都存在对应中文翻译；保留 `test:ui-copy-localization` 作为入口。运行 `npm run test:ui-copy-localization`、`npm run test:extension-manifest` 和 `npm run typecheck`。

## 具体步骤

所有命令都从仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2` 执行。

确认状态：

    git status --short --branch

实现后运行：

    npm run test:ui-copy-localization
    npm run test:extension-manifest
    npm run typecheck

如修改打包资源路径则补跑：

    npm run test:package-vsix-file-list

## 验证与验收

验收标准一：第二批迁移范围内的 Host QuickPick / notification / input validation 默认源字符串为英文，且简体中文 bundle 中存在对应翻译。

验收标准二：`npm run test:ui-copy-localization` 能发现关键 Host bundle key 缺失；`npm run typecheck` 通过，证明 `vscode.l10n.t` 参数类型正确。

验收标准三：文档如实记录未迁移范围，不把 Host/Webview 全部文案描述为已完成。

## 幂等性与恢复

本批次只修改源码、bundle 和测试，不涉及持久化迁移。若某个文案迁移破坏现有 smoke baseline，可回退该具体字符串并在本计划记录原因。不要因为语言统一而改动协议枚举、用户数据或 provider 输出。

## 证据与备注

当前初始状态：

    git status --short --branch
    ## ui-copy-localization-foundation...origin/main [ahead 1]

中途验证输出摘要：

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:extension-manifest
    extension manifest tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    npm run test:package-vsix-file-list
    package-vsix file-list tests passed

    git diff --check
    # no output

## 接口与依赖

使用 VS Code runtime localization API：

    vscode.l10n.t('Select embedded Terminal shell')
    vscode.l10n.t('Updated embedded Terminal shell for {target}: {path}', { target, path })

中文翻译文件位于：

    extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json

修订记录：2026-07-02 创建第二批 Host/Sidebar 文案迁移计划，原因是用户要求继续进行下一批 UI 文案处理。


修订记录：2026-07-02 完成第二批 Host 低风险文案迁移与测试扩展，跳过 session history 和已强断言的 sidebar attention 文案以保护 smoke baseline。

修订记录：2026-07-02 完成验证收口，补充 package-vsix file-list 与 diff check 证据，准备将计划归档到 completed。
