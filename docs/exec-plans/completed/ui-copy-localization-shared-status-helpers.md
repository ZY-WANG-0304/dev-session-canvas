# 迁移共享状态与 cwd 展示文案

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前文件已归档到 `docs/exec-plans/completed/ui-copy-localization-shared-status-helpers.md`，并已同步更新 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

这批工作把共享展示 helper 中残留的中文状态文案迁移到英文默认与简体中文本地化边界。完成后，sidebar 节点列表和 Webview 主画布仍显示相同的状态语义与颜色，但公共 `common` 模块不再内置中文自然语言；英文 VS Code 环境看到英文状态和 unknown cwd fallback，简体中文环境通过 Host runtime bundle 或 Webview dictionary 看到中文。

可观察结果是：`canvasNodeStatusPresentation.ts` 只返回稳定状态 label id 和 tone class，Host sidebar 在 `vscode.l10n.t(...)` 边界翻译，Webview 在 typed dictionary 边界翻译；`executionCwdLabel.ts` 的默认 fallback 改为英文 `Unknown cwd`，调用方可传入本地化 fallback。运行本计划列出的测试应通过，并且目标 common 文件不再包含中文字符。

## 进度

- [x] (2026-07-03 00:09 +0800) 读取工作流、计划要求和既有 UI 文案本地化设计，确认本批范围限定为 `canvasNodeStatusPresentation.ts` 与 `executionCwdLabel.ts` 及其调用边界。
- [x] (2026-07-03 00:09 +0800) 扫描目标 helper、sidebar、Webview、测试和文档中的相关硬编码文案，确认 Webview 已有状态 dictionary key，Host sidebar 需要新增 runtime bundle 翻译。
- [x] (2026-07-03 00:21 +0800) 实现共享状态 label id API、Host/Webview 边界翻译和 unknown cwd fallback 参数。
- [x] (2026-07-03 00:31 +0800) 更新本批相关自动化测试、设计系统文档、UI 文案本地化设计文档和技术债登记。
- [x] (2026-07-03 00:39 +0800) 运行验证命令并记录结果；提交将在归档本计划后执行。

## 意外与发现

- 观察：Webview 主画布没有直接导入共享 `humanizeCanvasNodeStatus()`，而是在 `main.tsx` 中维护了 `webviewHumanizeCanvasStatus()` / `webviewHumanizeCanvasNodeStatus()`，已经通过 typed dictionary 翻译状态文案。
  证据：`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 只从 `canvasNodeStatusPresentation.ts` 导入 `canvasStatusToneClass as statusToneClass`，状态 label 函数位于同文件并调用 `t('status.*')`。
- 观察：sidebar 节点列表直接调用共享 `humanizeCanvasNodeStatus(node)`，因此共享 helper 中的中文会直接进入 Host UI 和测试快照。
  证据：`extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts` 在 `getCanvasSidebarNodeListItems()` 中构造 `const statusLabel = humanizeCanvasNodeStatus(node);`。

- 观察：`Closed` 已在 sidebar overview 中用于“画布未打开”，如果复用为执行状态 `status.closed` 会在 zh-cn runtime bundle 中产生语义冲突。
  证据：`CanvasSidebarView.ts` 使用 `vscode.l10n.t('Closed')`，既有 bundle 翻译为“未打开”；本批将执行状态英文默认改为 `Session closed`，Webview dictionary 与 Host sidebar 同步使用该源文案。

## 决策记录

- 决策：共享 `common` 状态模块改为暴露稳定 label id，而不是直接调用 `vscode.l10n.t`。
  理由：同一个模块被 Webview 浏览器代码导入，不能依赖 VS Code Extension Host API；稳定 id 可同时服务 Host runtime bundle 和 Webview typed dictionary。
  日期/作者：2026-07-03 / Codex
- 决策：未知外部状态保留原始 `status` 字符串，不尝试翻译。
  理由：未知状态属于协议外或外部事实，翻译会掩盖调试信息；既有行为也是 default 返回原始 status。
  日期/作者：2026-07-03 / Codex
- 决策：`executionCwdLabel.ts` 默认 fallback 使用英文 `Unknown cwd`，并允许调用方传入 `unknownLabel` 覆盖。
  理由：路径 helper 同时被 Host 和 Webview 使用，公共层不能写中文；调用边界可以用 `vscode.l10n.t('Unknown cwd')` 或 Webview `t('execution.cwd.unknown')` 注入本地化版本。
  日期/作者：2026-07-03 / Codex

- 决策：执行状态 `status.closed` 的英文默认使用 `Session closed`，不复用现有 `Closed` 源字符串。
  理由：Host runtime bundle 已把 `Closed` 用于 sidebar 中的“画布未打开”，中文为“未打开”；执行会话关闭应显示“已关闭”，需要独立源字符串避免同 key 多语义。
  日期/作者：2026-07-03 / Codex

## 结果与复盘

已完成实现、文档同步和自动化验证。共享状态 helper 不再返回中文文案，Host/Webview 分别在本地化边界翻译，cwd 缺失 fallback 可由调用方注入。剩余债务已收敛到更大的 shared helper、runtime supervisor、Agent CLI resolver、模板解析/存储错误和 test DOM 兼容文案；本批不处理这些范围。

## 上下文与定向

当前 UI 文案本地化方案见 `docs/design-docs/ui-copy-localization.md`。已经完成的批次覆盖 manifest、Extension Host 主入口、CanvasPanelManager、主 Webview、sidebar provider、模板保存表单、模板市场 panel 和模板市场客户端。剩余技术债中，`extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts` 仍把运行状态、Note 关联状态和文件异常状态直接映射成中文；`extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts` 在 cwd 缺失时返回中文 `cwd 未知`。

`common` 目录的 helper 会被 Host 和 Webview 共用。Host 文件可以导入 `vscode` 并使用 `vscode.l10n.t(...)`；Webview 浏览器代码不能使用 `vscode.l10n.t`，必须通过 `extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts` 的 typed dictionary 和 `t(...)` 函数翻译。状态颜色 tone class 是语言无关逻辑，继续留在 `canvasNodeStatusPresentation.ts`。

本批触达的主要文件是：`extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts`、`extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts`、`extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts`、`extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts`、`extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`、`scripts/test/test-canvas-node-status-presentation.mts`、`scripts/test/test-workspace-relative-paths.mts`、`scripts/test/test-sidebar-list-color-tokens.mjs`、`scripts/test/test-theme-color-tokens.mjs` 和相关文档。

## 工作计划

先修改 `canvasNodeStatusPresentation.ts`，保留 `canvasNodeStatusToneClass()` / `canvasStatusToneClass()`，新增 `canvasNodeStatusLabelDescriptor()` 与 `canvasStatusLabelDescriptor()`。label id 使用与 Webview dictionary 对齐的字符串，例如 `status.waitingInput`、`status.noteAssociatedFile`；如果状态未知，返回 `{ kind: 'raw', value: status }` 形态。为了减少现有调用方断裂，可以保留英文默认 `humanizeCanvasNodeStatus()` / `humanizeCanvasStatus()`，但它们只基于 label id 返回英文源文案，不再返回中文。

再修改 Host sidebar。`CanvasSidebarNodeListView.ts` 不直接把共享 humanize 结果作为最终文案，而是调用共享 label id，然后用本文件内的小函数把已知 id 映射到 `vscode.l10n.t('...')` 英文源字符串；未知 raw status 原样展示。这个文件已经纳入 `test:ui-copy-localization` 的 Host runtime l10n source 扫描，因此新增英文源字符串必须同步加入 `l10n/bundle.l10n.zh-cn.json`。

随后修改 Webview。`main.tsx` 中已有 `webviewHumanizeCanvasStatus()` 和 `webviewHumanizeCanvasNodeStatus()`，应改为调用共享 label id，再把 id 转成 `t(id)`；未知 raw status 原样返回。这样状态语义来源统一，Webview 字典仍是翻译边界。`webviewI18n.ts` 需要增加 `execution.cwd.unknown` 英中 key，`AgentSessionNode` 调用 `formatExecutionCwdLabel()` / `formatExecutionCwdTooltip()` 时传入 `t('execution.cwd.unknown')`。

接着修改 `executionCwdLabel.ts`，让 `formatExecutionCwdLabel()` 接受可选 options 或 fallback 参数，在 cwd 缺失时返回 `Unknown cwd` 或调用方传入的本地化 fallback；`formatExecutionCwdTooltip()` 继续优先使用 fallback label，但默认也改成 `Unknown cwd`。相关路径测试增加缺失 cwd 断言。

最后更新测试和文档。源码级测试改为断言 label id、英文默认和 tone class；token 测试不再期待中文硬编码，而是期待 shared label id 被 Host/Webview 边界消费；`docs/UI.md` 的状态文案描述改为“使用共享 label id 并由本地化边界翻译”。`docs/design-docs/ui-copy-localization.md` 和 `docs/design-docs/index.md` 登记第十批完成结果；`docs/exec-plans/tech-debt-tracker.md` 从剩余共享 debt 中移除这两个 helper，并保留更大的 shared helper 与 test DOM 兼容债务。

## 具体步骤

所有命令均在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2` 执行。开始前运行 `git status --short --branch` 确认没有意外修改。编辑完成后运行：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts
    npm run test:ui-copy-localization
    npm run test:theme-color-tokens
    npm run test:workspace-relative-paths
    npm run test:sidebar-list-colors
    npm run test:sidebar-node-list
    npm run typecheck
    git diff --check

如果某个测试失败，先判断是预期测试约束需要同步还是实现回归；修复后重复运行失败命令和受影响的上游命令。

## 验证与验收

验收标准有四条。第一，目标 common 文件中不再出现中文字符或 `zh-CN` 字面量，证明共享层不再固化中文 UI 文案。第二，`npm run test:ui-copy-localization` 通过，证明 Webview dictionary key 与 Host runtime bundle 翻译完整。第三，状态和 cwd 相关专项测试通过，证明 Note 关联状态、异常 tone、sidebar 颜色契约和 cwd fallback 没有回归。第四，`npm run typecheck` 和 `git diff --check` 通过，证明类型与空白格式没有问题。

用户可通过真实 VS Code 简体中文环境打开 sidebar 节点列表观察“已关联文件 / 普通笔记 / 等待输入”等状态仍为中文；英文环境则显示“File linked / Plain Note / Waiting for input”。若 Agent 节点缺少 cwd，英文显示 `Unknown cwd`，简体中文显示 `cwd 未知`。

## 幂等性与恢复

本计划只修改源码、测试和文档，不执行破坏性命令。重复运行测试和 `rg` 扫描是安全的。如果实现中发现工作树出现与本计划无关的修改，应停止并询问用户，不要回滚他人改动。若某个改动方向失败，可以通过查看 `git diff` 精确撤销本批未提交片段，但不得使用 `git reset --hard` 或 `git checkout --`。

## 证据与备注

执行前状态：

    ## ui-copy-localization-foundation...origin/main [ahead 9, behind 20]

目标文件原始现状摘录：

    humanizeCanvasNodeStatus(markdown-file ok) -> '已关联文件'
    humanizeCanvasStatus('waiting-input') -> '等待输入'
    formatExecutionCwdLabel(undefined, folders) -> 'cwd 未知'

完成验证记录：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts
    # 无输出

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:theme-color-tokens
    theme color token tests passed
    canvas node status presentation tests passed

    npm run test:workspace-relative-paths
    # exit 0

    npm run test:sidebar-list-colors
    sidebar list color token tests passed

    npm run test:sidebar-node-list
    sidebar node list tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

    git diff --check
    # 无输出

## 接口与依赖

`extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts` 在本批结束时必须至少提供以下语言无关接口：

    export type CanvasStatusLabelId = ...;
    export type CanvasStatusLabelDescriptor = { kind: 'localized'; id: CanvasStatusLabelId } | { kind: 'raw'; value: string };
    export function canvasNodeStatusLabelDescriptor(node: CanvasStatusPresentationNode): CanvasStatusLabelDescriptor;
    export function canvasStatusLabelDescriptor(status: string): CanvasStatusLabelDescriptor;
    export function canvasNodeStatusToneClass(node: CanvasStatusPresentationNode): string;
    export function canvasStatusToneClass(status: string): string;

`extensions/vscode/dev-session-canvas/src/common/executionCwdLabel.ts` 在本批结束时必须允许调用方传入本地化 unknown cwd fallback。Host 调用方使用 `vscode.l10n.t('Unknown cwd')`；Webview 调用方使用 `t('execution.cwd.unknown')`。公共 helper 默认英文源字符串为 `Unknown cwd`。

计划更新记录：2026-07-03 创建本计划，原因是本批 UI 文案迁移涉及共享 API、Host/Webview 边界、测试和正式设计文档，按 `docs/PLANS.md` 需要可执行计划。

计划更新记录：2026-07-03 更新进度、发现和决策，原因是共享状态/cwd helper 的实现与文档同步已经完成，剩余工作进入验证与提交。

计划更新记录：2026-07-03 记录验证结果并准备归档，原因是本批实现、测试和文档均已完成。

计划更新记录：2026-07-03 修正归档路径描述和接口命名，原因是实际实现使用 descriptor API。
