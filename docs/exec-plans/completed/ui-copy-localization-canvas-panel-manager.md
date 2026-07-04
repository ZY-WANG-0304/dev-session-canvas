# 迁移 CanvasPanelManager Host UI 文案

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本仓库的执行计划规范位于 `docs/PLANS.md`。当前文档按该规范维护；完成后应从 `docs/exec-plans/active/` 移到 `docs/exec-plans/completed/`，并同步设计文档和技术债登记。

## 目标与全局图景

这次变更要把 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中由 VS Code Extension Host 直接展示或传给 Webview 展示的产品拥有 UI 文案迁移到 `vscode.l10n.t(...)`。完成后，英文 VS Code locale 会看到英文默认文案，简体中文 locale 会通过 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json` 看到中文翻译。用户创建的节点标题、Note 内容、模板名称、文件路径、运行时输出、provider 错误文本和测试专用断言文案不被翻译。

用户可观察到的效果是：模板保存/重置、Markdown Note 关联、历史会话恢复/分叉、设置重载、执行节点启动/输入/删除、attention 通知、CanvasPanelManager 侧的 Webview lifecycle 诊断提示和 host/error payload 在英文环境下不再混入中文；中文环境仍保留当前语义。自动化验证会扫描 `CanvasPanelManager.ts` 内新增的 `vscode.l10n.t` 英文源字符串，并要求 zh-cn bundle 提供非空翻译。

## 进度

- [x] (2026-07-02 11:14 +08:00) 已阅读 `docs/WORKFLOW.md` 与 `docs/PLANS.md`，确认本批属于多区域迁移，需要 ExecPlan。
- [x] (2026-07-02 11:14 +08:00) 已用 `rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 初步盘点 362 处中文匹配，并确认既包含用户可见 UI，也包含 test-only/internal 文案。
- [x] (2026-07-02 12:21 +08:00) 已迁移 `CanvasPanelManager.ts` 中产品拥有的 Host/UI 文案到英文源 `vscode.l10n.t(...)`，覆盖模板、Markdown 关联、历史恢复/分叉、执行节点、设置 reload、Webview lifecycle 诊断、attention 和删除确认等区域。
- [x] (2026-07-02 12:24 +08:00) 已补齐 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json` 中所有新增英文源字符串的中文翻译；缺失 key 检查为 0。
- [x] (2026-07-02 12:31 +08:00) 已更新受影响的测试断言，英文默认环境断言改为英文源文案，并给源码打包测试 mock 补 `vscode.l10n.t`。
- [x] (2026-07-02 12:44 +08:00) 已运行核心验证命令，`test:ui-copy-localization`、`test:canvas-templates`、`test:canvas-execution-context`、`test:webview-lifecycle-diagnostics`、`test:extension-manifest`、`test:package-vsix-file-list`、`typecheck` 与 `git diff --check` 均通过。
- [x] (2026-07-02 12:50 +08:00) 已更新设计文档索引和技术债登记。
- [x] (2026-07-02 12:51 +08:00) 已将本计划移入 `docs/exec-plans/completed/`；本地提交将在最终验证后完成。

## 意外与发现

- 观察：`CanvasPanelManager.ts` 中中文匹配既有 `showWarningMessage`、QuickPick title、host/error payload 等用户可见文案，也有 `createNodeForTest 仅在测试模式下可用。`、Webview probe timeout 等测试或内部诊断文案。
  证据：`rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts | wc -l` 输出 `362`，前 260 条覆盖模板、Markdown、session fork、runtime 和删除流程。

- 观察：迁移 Webview lifecycle 诊断文案后，不能再通过中文 issue 子串判断 Panel restore 是否受影响。
  证据：`buildWebviewLifecycleDiagnosticsSummary` 原本检查 `issue.includes('尚未 ready')` 和 `issue.includes('probe 失败')`；本批改为直接基于 `missingReadyAfterRender`、`missingBootstrapAckAfterReady` 和 `probeFailedAfterReady` 布尔条件判断，避免语言影响诊断语义。

- 观察：源码级测试 `scripts/test/test-canvas-execution-context.mjs` 用 mock `vscode` bundle 出 `CanvasPanelManager.ts` 后直接调用 pure helper，迁移 `defaultSummaryForKind` 后需要 mock `vscode.l10n.t`。
  证据：首次运行 `npm run test:canvas-execution-context` 报 `TypeError: Cannot read properties of undefined (reading 't')`；补充 mock 后测试通过。

## 决策记录

- 决策：本批只迁移 `CanvasPanelManager.ts` 中产品拥有且可能面向用户展示的 Host UI 文案；测试专用 command 错误、测试 harness 入口守卫、注释、用户数据、legacy 迁移 sentinel 与外部错误原文不纳入本批。
  理由：用户请求聚焦 `CanvasPanelManager.ts` 文案，设计文档已要求用户事实不被翻译；同时保留测试专用中文可避免无关断言漂移并降低大文件迁移风险。Webview lifecycle 诊断虽然偏开发者，但会通过宿主诊断命令面向用户/协作者展示，因此纳入迁移。
  日期/作者：2026-07-02 / Codex

- 决策：生成的 Agent 分叉标题后缀也迁移为英文源 `"{title} Fork"`，中文 bundle 翻译为 `"{title} 分叉"`。
  理由：该标题由产品生成而不是用户输入，英文环境应避免看到中文后缀；通过命名参数保留用户原始 source title。
  日期/作者：2026-07-02 / Codex

- 决策：Webview lifecycle 诊断的 surface label 使用 `Panel` / `Editor` 英文源并在 zh-cn bundle 翻译为“面板”/“编辑区”。
  理由：诊断报告本身会在 Host 侧生成并落盘，属于产品拥有文本；保持英文源可以让英文环境的诊断输出和命令文案一致。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本批已完成 `CanvasPanelManager.ts` 中产品拥有 Host UI 文案的迁移，并把运行时 zh-cn bundle 补齐。用户可见默认文案现在以英文源为准，简体中文环境通过 bundle 显示中文；分叉标题、template reset 确认、Markdown 关联错误、执行节点错误和 Webview lifecycle diagnostics 都纳入扫描测试。`rg` 复查后 `CanvasPanelManager.ts` 剩余中文从 362 处降到 25 处，剩余项为 test-only guard、注释、runtime 中文错误探测、legacy snapshot sentinel 和旧 placeholder 比较，不属于本批用户可见 UI 迁移范围。

仍未完成的是 Webview/Sidebar/模板市场面板内部的第三层 UI 文案迁移，以及真实 VS Code 英文/中文 locale 手动切换验收。本批用自动化扫描、源码测试、打包文件列表和 typecheck 证明 Host 侧改动可用，不把完整 UI 本地化写成已完成。

## 上下文与定向

`CanvasPanelManager.ts` 是 VS Code 扩展宿主侧的画布管理器。它维护 Canvas 状态、处理 Webview 发来的消息、启动 Agent/Terminal runtime、展示 VS Code QuickPick/通知/确认框，并向 Webview 发送 `host/error`、`host/stateUpdated` 等消息。这里的 Host UI 文案是指 Extension Host 生成、最终出现在 VS Code 或 Webview UI 上的自然语言句子。

当前本地化方案记录在 `docs/design-docs/ui-copy-localization.md`。运行时 Host 文案使用 VS Code 官方 `vscode.l10n.t(...)`，默认源字符串使用英文，简体中文翻译放在 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`。扫描测试位于 `scripts/test/test-ui-copy-localization.mts`，会读取 `extensions/vscode/dev-session-canvas/src/extension.ts` 和 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`，检查所有 `vscode.l10n.t('English source')` 都在 zh-cn bundle 中有非空翻译。

本批触达这些路径：`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`、`scripts/test/test-canvas-templates.mjs`、`scripts/test/test-canvas-execution-context.mjs`、`tests/vscode-smoke/extension-tests.cjs`、`docs/design-docs/ui-copy-localization.md`、`docs/design-docs/index.md`、`docs/exec-plans/tech-debt-tracker.md`，以及本计划文件本身。

## 工作计划

先按功能区域迁移，不做全局盲替换。第一组处理顶部 action 常量、模板保存/导出/删除/重置和模板 Note 物化错误。第二组处理 workspace root 选择、新建节点、安装 Terminal、Markdown Note 关联、保存为 Markdown 和 drag-drop 错误。第三组处理历史恢复/分叉、分叉标题、workspace root 清空、模板应用/重置确认、设置重载和 shell 配置提示。第四组处理 runtime supervisor、live runtime fallback、Webview lifecycle 用户可见提示、attention 通知、Agent/Terminal 启动/输入/粘贴/截图/停止、删除分组/节点、Webview 创建节点响应、execution cwd 校验和 sidebar summary 描述。

迁移时把中文句子改成英文源字符串，例如 `vscode.l10n.t('Only Markdown files (.md / .markdown) can be associated.')`。动态值使用命名参数，例如 `vscode.l10n.t('template "{name}"', { name: storedTemplate.template.name })`。用户输入和外部事实作为参数保留，不翻译参数值本身。迁移 Webview lifecycle diagnostics 时避免业务判断依赖本地化后的自然语言，而改用结构化布尔条件。

完成代码迁移后，用一个小脚本提取 Host runtime source strings，列出 bundle 缺失项，再补齐中文翻译。不要运行全局格式化；如需格式调整，只局部编辑相关代码。之后用 `rg` 复查 `CanvasPanelManager.ts` 剩余中文，并确认剩余项都符合本批排除范围或是中文 bundle/测试数据之外的用户事实。

## 具体步骤

在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2` 执行以下命令。盘点命令可以重复运行且无副作用：

    rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts
    node --no-warnings --experimental-transform-types scripts/test/test-ui-copy-localization.mts

代码修改完成后，运行以下验证：

    npm run test:ui-copy-localization
    npm run test:canvas-templates
    npm run test:canvas-execution-context
    npm run test:webview-lifecycle-diagnostics
    npm run test:extension-manifest
    npm run test:package-vsix-file-list
    npm run typecheck
    git diff --check

若测试断言涉及迁移后的英文默认文案，需要更新对应测试，使英文环境断言英文默认源，或者断言 zh-cn bundle/key 存在而不是硬编码中文 Host 源码。完整 `npm run test:smoke` 和 `npm run test:webview` 代价较高，本批默认不运行；若未运行，必须在结果中登记残余风险。

## 验证与验收

自动验收标准是：`npm run test:ui-copy-localization` 通过，并证明 `CanvasPanelManager.ts` 中新增 `vscode.l10n.t(...)` 源字符串都有 zh-cn 翻译；`npm run typecheck` 通过，证明 API 调用和类型未破坏；`npm run test:extension-manifest` 与 `npm run test:package-vsix-file-list` 通过，证明已有 manifest 和打包本地化资源仍完整；`git diff --check` 不报告空白错误。针对受影响测试还运行 `npm run test:canvas-templates`、`npm run test:canvas-execution-context` 和 `npm run test:webview-lifecycle-diagnostics`。

人工验收口径是：英文 locale 下 CanvasPanelManager 负责的 VS Code 通知、QuickPick、确认框和 host/error payload 默认显示英文；简体中文 locale 下通过 bundle 显示中文。由于当前环境不启动真实 VS Code 手动操作，本计划以自动化扫描和 typecheck 作为本批主要证据，并把未跑真实 locale 手动验证登记为残余风险。

## 幂等性与恢复

本批仅修改源码、翻译 bundle、测试和文档，可以通过 `git diff` 审查。提取缺失 key 的 Node 脚本只读文件，可重复执行。若某个迁移导致测试断言大量漂移，应优先缩小该功能区域改动并保留用户可见语义，不要用 `git reset --hard` 或 `git checkout --` 回退整个工作树。若发现非本人修改或工作树出现意外变化，应停止并向用户确认。

## 证据与备注

初始证据：

    ## ui-copy-localization-foundation...origin/main [ahead 3]
    rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts | wc -l
    362

完成后的关键证据：

    rg -n "[\\p{Han}]" extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts | wc -l
    25

    missing runtime l10n bundle keys
    0

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:canvas-templates
    通过，无额外输出

    npm run test:canvas-execution-context
    canvas execution context tests passed

    npm run test:webview-lifecycle-diagnostics
    webview lifecycle diagnostics tests passed

    npm run test:extension-manifest
    extension manifest tests passed

    npm run test:package-vsix-file-list
    package-vsix file-list tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    通过，无输出

## 接口与依赖

必须使用 VS Code 官方运行时本地化接口 `vscode.l10n.t(message, args?)`。`message` 使用英文默认源字符串，`args` 使用命名参数对象，不使用拼接制造语序固定的半句。翻译 bundle `bundle.l10n.zh-cn.json` 是一个 JSON object，key 必须与英文源字符串完全一致，value 为简体中文翻译。

`CanvasPanelManager.ts` 中新增或使用的 helper 包括 `formatCreatableNodeKind`、`formatExecutionNodeKind`、`formatLocalizedList`、`formatForkTitle`、`formatHistoryForkTitle`。这些 helper 返回普通 string，不改变协议类型。不得改变 Canvas 状态 schema、Webview message type 或 runtime supervisor 协议。完成时 `agentProviderDisplayLabel`、`formatUnknownError` 等现有 helper 继续使用，但任何产品拥有的自然语言包装层已经过 `vscode.l10n.t(...)`。

计划修订记录：2026-07-02 11:14 +08:00 创建计划，明确迁移范围、排除范围、验证命令和初始盘点证据。
计划修订记录：2026-07-02 12:48 +08:00 更新完成进度、Webview lifecycle 诊断决策、测试修复发现、验证证据与残余风险。
计划修订记录：2026-07-02 12:51 +08:00 记录设计文档和技术债已同步，并标记计划移入 completed。
