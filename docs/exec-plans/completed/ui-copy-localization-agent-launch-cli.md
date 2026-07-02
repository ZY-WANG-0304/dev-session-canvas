# 迁移 Agent 启动与 CLI 解析文案

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本计划遵循 `docs/PLANS.md`。当前文件完成后归档到 `docs/exec-plans/completed/ui-copy-localization-agent-launch-cli.md`，并已同步更新 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

这次变更要把 Agent 启动命令 helper 与 Agent CLI 解析 helper 中的产品自有 UI 文案迁移到英文默认和简体中文本地化边界。完成后，用户在 Agent launch QuickPick、画布右键自定义启动校验、历史恢复 / 分叉错误，以及 CLI 未找到错误中，会在英文 VS Code 看到英文默认文案，在简体中文 VS Code 看到中文翻译。共享 helper 不直接依赖 VS Code API，而是输出结构化消息描述，Host 和 Webview 分别在自己的本地化边界翻译。

## 进度

- [x] (2026-07-03 01:10+08:00) 已确认工作树干净，并重读 `docs/WORKFLOW.md` 与 `docs/PLANS.md`。
- [x] (2026-07-03 01:12+08:00) 已建立本批计划，范围限定在 `agentLaunchPresets.ts`、`agentCliResolver.ts` 及其 Host/Webview 展示边界。
- [x] (2026-07-03 01:14+08:00) 已迁移 `agentLaunchPresets.ts` 的中文错误为结构化 descriptor、typed error 与英文默认 fallback。
- [x] (2026-07-03 01:15+08:00) 已迁移 `agentCliResolver.ts` 的尝试记录和未找到错误为英文默认，并新增 `attemptDescriptors` 供 Host 本地化。
- [x] (2026-07-03 01:19+08:00) 已更新 Host、Webview、测试与设计文档，新增 `agentLaunchLocalization.ts` 作为 Host 本地化边界。
- [x] (2026-07-03 01:23+08:00) 已完成最终验证，准备归档计划并提交一次 commit。

## 意外与发现

- 观察：`scripts/test/test-agent-cli-resolver.mjs` 原本在非 Windows 平台直接跳过，无法在本地证明新增 attempt descriptor formatter 可被 bundle 导出。
  证据：本批把测试调整为所有平台都 bundle `agentCliResolver.ts` 并验证 `formatAgentCliResolutionAttemptDescriptor(...)`，仅 Windows 专属路径解析用例在非 Windows 平台跳过。

## 决策记录

- 决策：`common/agentLaunchPresets.ts` 不导入 `vscode`，只导出稳定消息 descriptor、英文 formatter 与 typed error。
  理由：该模块同时被 Extension Host 和 Webview bundle 使用；直接使用 `vscode.l10n.t` 会破坏 Webview 边界，也会让测试 bundle 复杂化。
  日期/作者：2026-07-03 / Codex。
- 决策：`agentCliResolver.ts` 保留 `attempts: string[]` 作为英文诊断兼容字段，同时新增结构化 `attemptDescriptors` 供 Host 翻译。
  理由：诊断事件和既有测试可以继续消费字符串；用户可见错误不再依赖 resolver 内部的自然语言。
  日期/作者：2026-07-03 / Codex。

## 结果与复盘

本批已完成 Agent 启动与 CLI 解析文案迁移。`agentLaunchPresets.ts` 不再输出中文错误，调用方可通过稳定 descriptor 在 Host 或 Webview 本地化；`agentCliResolver.ts` 保留英文 `attempts` 诊断兼容字段，同时提供结构化 `attemptDescriptors` 供用户可见错误翻译。剩余本地化债务不在本批解决，继续集中在 runtime supervisor、模板解析/存储错误和 test DOM 兼容文案。

## 上下文与定向

当前 UI 文案本地化方案记录在 `docs/design-docs/ui-copy-localization.md`。此前批次已经迁移 manifest、Extension Host、`CanvasPanelManager.ts`、主 Webview、sidebar、模板保存表单、模板市场以及共享状态/cwd helper。剩余技术债明确点名 `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts` 和 `extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts`。

`agentLaunchPresets.ts` 位于 `common` 目录，提供 Agent 启动命令构造、解析、校验和预设识别。它被 `extensions/vscode/dev-session-canvas/src/extension.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 和 runtime supervisor 使用，因此不能直接调用 VS Code API。这里的“descriptor”指一个只包含稳定 id 和动态参数的普通对象，调用方可以用它生成当前语言的 UI 文案。

`agentCliResolver.ts` 位于 `panel` 目录，负责在配置路径、缓存、PATH、Windows `where.exe` / PowerShell 和 POSIX login shell 中解析 Codex / Claude Code CLI。解析失败会抛出 `AgentCliResolutionError`，该错误最终由 `CanvasPanelManager.ts` 展示给用户或写入诊断。

## 工作计划

先在 `agentLaunchPresets.ts` 中新增消息 descriptor 类型、英文 formatter、typed error 和 descriptor-aware validation result，替换中文错误句子与冲突描述。随后在 Host 侧新增一个小型本地化 helper，把 descriptor switch 到 `vscode.l10n.t(...)` 的英文源字符串；`extension.ts` 和 `CanvasPanelManager.ts` 只调用这个 helper，不直接拼接共享 helper 的 `error` 字段。Webview 侧在 `webviewI18n.ts` 增加对应 key，并在 `main.tsx` 用 typed dictionary 翻译 validation/build error。

接着在 `agentCliResolver.ts` 中把 resolver 内部尝试记录改为英文默认，并新增结构化 attempt descriptor。Host 本地化 helper 负责把 resolver error 转为用户可见的中文或英文句子，`CanvasPanelManager.ts` 的 spawn error 描述函数不再直接返回 `error.message`。

最后更新测试和文档：`test-agent-launch-presets` 改断言英文默认与 descriptor，`test-ui-copy-localization` 把新增 helper 与目标文件纳入扫描，设计文档和技术债追踪记录本批完成与剩余范围。

## 具体步骤

在仓库根目录执行以下命令完成实现与验证：

    npm run test:agent-launch-presets
    npm run test:agent-cli-resolver
    npm run test:ui-copy-localization
    npm run test:protocol-webview-messages
    npm run typecheck
    git diff --check

如果当前平台不是 Windows，`test:agent-cli-resolver` 允许输出跳过信息；本批仍通过 typecheck 和源码扫描覆盖非 Windows 变更。

## 验证与验收

自动验收要求目标源码 `agentLaunchPresets.ts` 和 `agentCliResolver.ts` 不再包含中文或 `zh-CN` 字面量；Agent launch preset 测试证明默认错误为英文且 descriptor 存在；UI copy 测试证明 Host 新增 `vscode.l10n.t(...)` 源字符串都有简体中文 bundle 翻译，Webview 新增 key 英中对齐；TypeScript 类型检查通过。用户可观察验收是：Agent 启动命令校验、默认参数冲突、历史恢复/分叉、CLI 未找到等错误在英文环境显示英文，在简体中文环境显示中文。

## 幂等性与恢复

本批只修改源码、测试和文档，不迁移用户数据。若某个测试失败，可重复运行对应命令；若方案需要回退，只撤销本批改动即可，不需要清理外部状态。不得执行 `git reset --hard` 或覆盖用户未提交改动。

## 证据与备注

最终验证输出如下：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts scripts/test/test-agent-launch-presets.mjs scripts/test/test-agent-cli-resolver.mjs
    <no output>

    npm run test:agent-launch-presets
    agentLaunchPresets tests passed

    npm run test:agent-cli-resolver
    agentCliResolver Windows resolution tests skipped on non-Windows platform
    agentCliResolver tests passed

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    <no output>

## 接口与依赖

本批不新增 npm 依赖。`agentLaunchPresets.ts` 必须导出 `AgentLaunchMessageDescriptor`、`formatAgentLaunchMessageDescriptor(...)`、`AgentLaunchPresetError`、`getAgentLaunchErrorDescriptor(...)` 等共享接口。Host 本地化 helper 必须只在 Extension Host 侧导入 `vscode`。Webview 翻译必须通过现有 `extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts` typed dictionary。`agentCliResolver.ts` 必须继续导出 `resolveAgentCliCommand(...)`、`AgentCliResolutionError`、`isAgentCliResolutionError(...)`，并保持 `attempts: string[]` 诊断兼容字段。
