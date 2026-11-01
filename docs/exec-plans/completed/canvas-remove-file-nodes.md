# 移除画布文件节点与文件活动采集

本执行计划按 `docs/PLANS.md` 维护，现已完成并归档。用户确认了范围和兼容策略；自动文件活动及 `file` / `files` 节点已从当前功能移除。本计划记录迁移边界、自动化、打包、smoke 和用户手动验收证据，以及未由本轮自动化单独覆盖的真实 provider 行为。

## 目标与全局图景

用户认为 `file` / `files` 节点实际价值不足，尤其不值得继续为 Claude 维护。完成后，画布不再生成或显示文件节点、文件列表及其自动关系，Claude 启动也不再为此注入 hook 或收集文件活动。Agent、Terminal、Note、普通连线及文件相关的其他独立能力继续工作。旧画布可以打开，保留其他节点和关系。用户可以通过升级旧画布、启动 Claude 和检查设置直观看到结果。

## 进度

- [x] (2026-11-01) 从最新 `origin/main` 创建 `canvas-remove-file-nodes`，保留工作树原有未跟踪文件；初步识别实现与验收边界。
- [x] (2026-11-01) 编写供确认的实施计划及验收标准；尚未实现或验证。
- [x] (2026-11-01) 用户确认计划，登记正式退役设计并标记现有规格的过渡状态。
- [x] (2026-11-01) 盘点并拆除 Claude 文件活动采集、专用 hook、配置、过滤、文件节点渲染与设置入口，更新产品规格和退役设计。
- [x] (2026-11-01) 在单根、多根和共享 root 持久化边界清理旧文件节点、活动记录、自动边及失效分组成员；保留其他画布对象和独立文件能力。
- [x] (2026-11-01) 更新 smoke 场景映射：旧文件活动验证目标登记为退役；150 个当前目标保留现有映射。
- [x] (2026-11-01) 定向回归：类型检查、迁移/分组、多根组合、共享 root、模板、侧栏、执行上下文、主题、本地化、打包文件清单及 fake-resume 验证通过。
- [x] (2026-11-01) `npm run test:webview` 通过，Playwright 418 项通过；用户本机手动调试并确认未发现问题。
- [x] (2026-11-01) 修正侧栏摘要 smoke 对已退役 Files 项目的过期断言，并通过 `npm run test:smoke -- --scenario=canvas-entry/surface-sidebar`；真实 VS Code 1.140.0 场景通过。
- [x] (2026-11-01) 删除只服务文件节点点击的 CDP smoke 辅助器与过期合同测试，重新生成并审核 bounded-wait inventory；`node scripts/test/test-gate-contracts.mjs` 101/101 通过。
- [x] (2026-11-01) 更新多根、模板市场与技术债文档中的过时当前口径；将旧关系连线 / 文件活动计划标为历史并归档；同步退役设计状态和索引。
- [x] (2026-11-01) 完成 `git diff --check`、残留搜索与最终差异审计；保留原有未跟踪文件。该记录对应当日尚未获 PR 授权的状态。
- [x] (2026-11-01) 用户已在本机手动调试并确认未发现问题；真实 Claude CLI 专项未由本轮单独自动运行，作为验证边界明确记录。
- [x] (2026-11-02) 按后续授权提交实现并 rebase 到最新 `origin/main`；rebase 后 `npm run typecheck`、`node scripts/test/test-gate-contracts.mjs`（101/101）通过。
- [x] (2026-11-02) rebase 后完整 Webview 回归 420 项中 419 项通过；一项终端悬停链接用例首次超时，独立复跑通过。打包检查发现并移除已退役脚本目录的 staging 引用，`npm run test:package-vsix-file-list` 和 `canvas-entry/surface-sidebar` VS Code smoke 修复后通过。

## 意外与发现

`src/common/protocol.ts` 当前将 `file` 和 `file-list` 纳入节点种类并保存 `fileReferences`；`CanvasPanelManager.ts` 同时负责采集、旧状态恢复和投影。`agentFileActivity.ts` 与 `scripts/runtime/claude-file-event-hook.cjs` 支撑 Claude 采集，`scripts/release/package-vsix.mjs` 还明确检查 hook。故仅隐藏节点或关闭默认设置不能完成移除。现有文件开关默认关闭，但用户仍可启用。

2026-11-01 迁移边界需要同时覆盖单根状态恢复、多根组合和共享 root 持久化。最终保留的兼容逻辑只识别并清理旧 `file` / `file-list` 数据，不再包含生成这些对象的采集器或投影器。旧文件活动 smoke 用例在覆盖映射中登记为 `retired`，不能再计入当前运行覆盖；通用手工连线和 Note / Terminal 文件能力继续由各自测试保护。

## 决策记录

- 已确认：整个自动文件活动功能域随节点一起移除，包括 Claude hook、文件活动过滤器、展示配置及自动关系；这符合减少维护成本的目标。日期：2026-11-01。
- 已确认：读取旧状态时仅清除旧文件节点、文件活动记录和依赖这些节点的边及分组成员；保留其他节点、手工连线、分组、位置和会话身份。历史文件活动不会迁移成 Note，也不删除磁盘文件。读取兼容代码可保留为狭窄的迁移边界，不再保留可运行的文件活动功能。日期：2026-11-01。
- 已确认：保留终端文件链接、Markdown Note 文件关联、Explorer 创建节点和普通文件打开能力；它们不是自动文件节点功能。日期：2026-11-01。

## 结果与复盘

主功能、迁移兼容和文档规格已按用户确认的边界落地。初次实施时 `npm run typecheck`、迁移与多根 / 共享 root / 模板 / 侧栏 / 打包定向测试、`npm run test:webview`（418 项）和 VS Code smoke 通过。随后 rebase 到最新 `origin/main` 后，类型检查和 gate-contracts（101/101）通过。更新后的完整 Webview 回归为 419/420：终端悬停链接用例在整套运行中首次超时，独立单项复跑通过，因此保留为一次偶发失败而不声称整套全绿。打包清单测试发现 staging 仍复制已删除的 `scripts/runtime`，VS Code smoke 又发现调试宿主仍无条件复制已删除的 `scripts`；移除两条过期 staging 后，`npm run test:package-vsix-file-list` 与 `npm run test:smoke -- --scenario=canvas-entry/surface-sidebar` 均通过。用户完成手动调试并确认未发现问题。当前 150 个 smoke 目标有实现映射，2 个旧文件活动目标明确退役。完整 host owner-wiring 测试中的单根 reset 夹具错误此前已在未修改的 `origin/main` 基线上复现，不作为本分支回归。真实 Claude CLI 文件读写专项没有在本轮单独自动运行；不把 fake provider 或用户总体手动验收描述成这条专项的自动证据。最终完成残留搜索与 diff 检查后，本计划归档。

## 上下文与定向

VS Code 扩展宿主 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 管理画布状态、Agent 启动与恢复；`src/common/protocol.ts` 定义跨宿主与 Webview 的状态；`src/webview/main.tsx` 和 `src/webview/fileNoteNodes.tsx` 渲染节点；`src/sidebar/` 提供侧栏设置和入口。`src/panel/agentFileActivity.ts` 以及 `scripts/runtime/claude-file-event-hook.cjs` 为 Agent 文件活动提供采集。共享 root 存储和多根组合还涉及 `src/panel/sharedRootCanvasStore.ts`、`src/common/canvasMultiRootComposition.ts`。旧画布可能保存自动对象、用户连到它们的普通边和分组成员；这些引用不能留成悬空关系。

## 工作计划

第一里程碑先确认方案并更新 `docs/product-specs/canvas-graph-links-and-file-activity.md`、对应设计文档和索引，明确通用连线仍受支持，旧文件活动功能退役。审查所有持久化入口（包括单根、多根、共享 root、模板和导入），以旧版真实形状建立测试数据，确定清理发生在写回之前且不会清空无关状态。验收为测试数据经过恢复后仅移除指定对象，重复恢复结果稳定。

第二里程碑移除采集与运行时：从 Agent 启动、停止、恢复和错误清理路径移除文件活动会话、参数和环境注入，删除仅服务此功能的 hook 和打包要求；保留 Claude 的其他启动参数及用户自己的 hooks。更新协议和状态转换，必要时保留只读旧格式的最小兼容处理；不得让另一窗口的旧状态重新复活文件对象。验收为旧数据迁移测试和 Agent 启动测试通过，且生成包不含专用 hook。

第三里程碑移除 Webview、侧栏、设置、命令、本地化文案及专属样式和测试；清理自动文件节点的布局、分组、投影与过滤逻辑，保留共用 Note 与普通连线代码。检查 README 中当前功能描述、相关正式规格与设计索引；历史执行记录和历史发布记录保留为历史，不把过去的事实改写为当前行为。验收为设置、侧栏和画布均没有文件活动入口，其他功能回归通过。

第四里程碑执行下述验收并记录证据。功能实现、迁移与文档已经完成；用户随后授权将分支 rebase 到 `origin/main` 并创建 PR，按该授权继续交付，不执行合并。

## 具体步骤

在仓库根目录工作。先使用 `rg -n 'fileActivity|fileReferences|file-list|filesFeatureEnabled|claude-file-event' extensions/vscode/dev-session-canvas scripts tests` 盘点引用，区分旧数据迁移、专属实现和无关文件功能。逐层修改后运行 `npm run typecheck`，再运行下面的定向测试和宿主验证。搜索结果须人工分类，不能因文本匹配而删除终端链接或 Note 功能。PR 前按工作流获取最新目标分支并 rebase；保留原有未跟踪文件。

## 验证与验收

1. 旧画布：构造包含 Agent、Terminal、Note、文件节点、文件列表、自动边、连到文件的手工边、其他手工边及分组的旧快照；分别验证单根、多根与共享 root 加载、保存、重载。文件对象及其相关边、活动记录和无效成员消失；其他节点、连线、位置、分组和会话身份保留。重复加载和多窗口同步不重新生成文件对象；磁盘文件不受影响。
2. Claude：启动、停止和恢复 Claude，验证其命令、环境及正常会话可用，不注入本功能 hook、额外参数或事件文件；用户已有 Claude hooks 不被改写。以真实 Claude 可用环境做一次手动文件读写；若环境不可用，明确记录未运行，不能用 fake provider 冒充真实验证。
3. 用户界面：设置搜索、侧栏、画布和命令入口均不再出现文件活动、文件列表及相关过滤或展示选项；Claude 读写文件后画布不生成文件对象。Agent、Terminal、Note、手工连线和分组可创建、编辑并在 reload 后恢复。
4. 独立文件功能：验证终端文件链接、关联 Markdown Note 和 Explorer 的节点创建仍可使用。验证包内不含专用 Claude 文件活动 hook，且正常打包成功。
5. 已在仓库根完成 `npm run typecheck`、迁移 / 多根组合 / 共享 root / 模板 / 侧栏 / 执行上下文 / 主题 / 本地化定向测试、`npm run test:webview`、`npm run test:package-vsix-file-list` 及 `npm run test:smoke -- --scenario=canvas-entry/surface-sidebar`。真实 Claude CLI 文件读写专项本轮未单独自动运行，需与用户的总体手动调试确认区分。旧 host owner-wiring 单根 reset 夹具失败已在未修改的 `origin/main` 基线复现；底层 gate-contracts 脚本的实际结果补在最终证据中。

## 幂等性与恢复

迁移必须可重复运行且不扩大删除范围；在测试副本上验证，不手工修改用户实际工作区数据。首次新版本写回后旧文件活动数据将不再存在，因此回退旧版本无法恢复这些记录；若需要保留，升级前备份画布存储。代码改动可通过 Git 回退，不清理原有未跟踪文件。

## 证据与备注

初步证据：协议的 `CanvasNodeKind` 包含 `file` / `file-list`，扩展 manifest 声明 `devSessionCanvas.files.enabled`，打包脚本引用 Claude hook。尚未运行任何验收。实施时记录测试结果、旧快照输入和包检查结果，不记录用户私有文件内容。

## 接口与依赖

沿用现有 TypeScript、VS Code 扩展宿主、React Webview 和仓库测试工具；不增加外部服务。最终公开状态只提供 Agent、Terminal、Note 的当前节点语义；旧格式转换放在现有状态解析/恢复边界，具体函数以对所有存储入口的审查为准。不得依赖已删除的 hook 才能启动 Claude。

修订记录（2026-11-01）：建立待确认计划，明确移除范围、旧状态处理及可观察验收；此时尚未实施。

修订记录（2026-11-01）：用户确认方案，登记正式设计和规格过渡状态；实现与验证仍待完成。

修订记录（2026-11-01）：补充旧状态清理和三条采集生命周期路径的定位，便于继续实施；未声称功能已移除。

修订记录（2026-11-01）：移除侧栏 Files 摘要和过滤输入，记录定向验证及其余未完成范围。

修订记录（2026-11-01）：拆除文件活动采集、专用 hook、配置和文件节点渲染；记录定向测试及仍未完成的端到端验收，避免把局部结果写成完整交付。

修订记录（2026-11-01）：`npm run test:webview` 的 418 项测试通过，用户完成手动调试并确认未发现问题；同步活文档进度与最终验收范围。最后 smoke 和 diff 审计仍待完成。

修订记录（2026-11-01）：定向 VS Code smoke 先发现侧栏摘要仍断言 Files 项目存在；移除该过期测试期望后场景通过。Gate 合同随后暴露文件条目点击测试仍引用已删除专用路径，故一并删除专用 CDP helper 和对应过期测试，并重生成 bounded-wait inventory；底层合同 101/101 通过。同步退役设计验证状态、历史计划归档、多根与模板设计现状、过期文件图标技术债关闭状态及验证边界。计划完成并归档。
