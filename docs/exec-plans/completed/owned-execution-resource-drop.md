# 修复本地执行终端的资源拖放

本计划按 `docs/PLANS.md` 持续维护；目标是在 PR #314 修复拖放路径未写入正在运行的本地 Terminal/Agent，并恢复真实交互 smoke 的有效验证。

## 目标与全局图景

用户将含空格的文件拖入执行终端后，路径按该执行的 shell 规则转义并成为原进程的输入。停止或绑定已经改变的执行不得接收拖放。一次拖入多个资源仍仅使用第一个。真实 VSIX 应输出带完整路径的标记，并继续验证文件、图片、工作目录相对链接和 URL 交互。

## 进度

- [x] (2026-10-10) 核对旧入口仅查询 session map，当前 owned 执行触发 missing-session；核对同一 smoke 仍等待历史 recentOutput。
- [x] (2026-10-10) 新增 17 项回归，修前在陈旧 session 使用错误转义规则处失败；修后通过，入口已接回原执行。
- [x] (2026-10-10) 本交互用例正文断言已迁移；完整 Host 426/426、正文 helper 14/14、路径 helper 与类型检查通过。
- [x] (2026-10-10) 首轮默认真实 VSIX：两个具名阶段、拖放/文件/图片/cwd 链接均通过；随后多行结果 2:8 被解析为 search。
- [x] (2026-10-10) 加强原执行两行输出与页面相邻行等待后复跑，两等待通过，仍在 2:8 文件链接断言处失败；排除仅由回显/未渲染导致。
- [x] (2026-10-10) 同步正式结论、索引、原则与技术债，保留两轮原生证据；本计划完成，随本次提交更新 PR #314。

## 意外与发现

首轮 native interactions 已输出完整拖入路径，继续通过文件定位、图片预览与 cwd 相对文件定位，但 `2:8` 链接实际为 search/quickOpen，期望 file。源码 `getExecutionTerminalPathContext` 的逐行 cwd resolver 仍只接旧 session tracker；加强原执行正文及页面相邻行等待后仍失败，排除仅由命令回显或未渲染导致；逐行 cwd 接线与本次失败的完整因果对照留待独立定位。原失败工件保留在 `.debug/resource-drop-fix/trusted-artifacts`。

owned 执行指由 `nonNativeExecutionOwner` 管理、记录在 `nonNativeHostExecutions` 中的本地执行，未登记到旧 session map。已有粘贴入口 `captureExecutionInputTarget` 验证 metadata、原记录、停止及关闭状态，可用于拖放准入。`launchSpec.file/cwd` 保留原启动上下文。

## 决策记录

- 决策：多行链接验收等待实际相邻两行，并要求页面已显示这些行后才激活。理由：单独正文子串可能匹配命令回显，Host 已交付也不代表页面已完成绘制；用明确观测排除等待过早，保留原文件目标断言。日期：2026-10-10。

- 决策：复用输入目标校验与路径准备函数，同步捕获 owned record 后直接调用 `writeNonNativeHostInput`，保留旧 session/Supervisor 路径。理由：不构造虚拟 session，不在等待确认后重新寻找目标。日期：2026-10-10。
- 决策：仅迁移 `verifyExecutionTerminalNativeInteractions` 中实时正文检查到原执行消息；保留所有 DOM、链接和首资源断言。理由：历史 metadata 不是本地实时正文，后续 Runtime 场景独立验证。日期：2026-10-10。

## 结果与复盘

产品接线和 smoke 断言迁移已实现，定向 17/17、完整 Host 426/426、正文 helper 14/14、路径 helper 与类型检查通过。两轮默认真实 VSIX 均通过构建打包、owned reconciliation、local execution flow、拖放首资源/实际路径、文件位置、图片预览及 cwd 相对文件定位。两轮均在后续多行文件结果 2:8 被当作搜索处失败；第二轮确认实际输出与页面相邻两行后仍复现。拖放交付完成，完整门禁未通过；多行链接和未触达的 URL/Runtime 场景保留为后续验证范围。

## 上下文与定向

产品入口位于 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `handleDroppedExecutionResource`。路径转义由同目录 `executionTerminalNativeHelpers.ts` 的 `prepareExecutionTerminalDroppedPath` 完成。Host 回归在 `scripts/test/test-host-execution-owner-wiring.mjs`，其 `interactiveHostFixture` 启动真实 Host/owner/adapter，仅用受控 transport 替代原生进程。`tests/vscode-smoke/extension-tests.cjs` 的原执行身份和 `waitForLocalExecutionOutput` 可以核对连续输出消息及快照。

## 工作计划

第一里程碑增加 Terminal/Agent 拖放回归，验证原 shell/cwd、等待实际 written 确认、停止/旧绑定拒绝及执行被替换后不会转投新执行；至少一项在产品修改前复现失败。随后将拖放入口接入当前原执行，校验与准备之间没有异步等待。

第二里程碑迁移同一 native interactions 用例的全部实时正文断言，保留实际打开文件位置、图片编辑器、缺失路径搜索、URL hover 和浏览器目标验证。完成完整 Host、路径 helper、正文 helper、类型检查和默认真实 VSIX。第三里程碑将结果写入调查设计、索引、核心原则和技术债，提交推送。

## 具体步骤

在专用工作树 `/tmp/dscr` 工作，原项目树的发布改动保持独立。依赖 symlink 暂放 `.debug/rca/`，测试前移动 `node_modules` 和 `playwright-browsers` 到根目录（后者命名 `.playwright-browsers`），提交前停放回去。使用 Node 22：`export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。

运行 `DEV_SESSION_CANVAS_HOST_TEST_FILTER='resource drop' node scripts/test/test-host-execution-owner-wiring.mjs`；完整运行去掉过滤变量。运行 `npm run test:execution-terminal-native-helpers`、`npm run test:smoke-execution-output`、`npm run typecheck`。

真实验证使用 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke`，日志放 `.debug/resource-drop-fix/`。提交前 `git fetch origin`、`git rebase origin/main`，只更新 PR #314，不合并、不发布。

## 验证与验收

受控请求的身份与原 execution identity 一致，数据为按原 shell/cwd 转义的路径；没有 written 前不报告完成；停止、metadata 替换、隔离或缺少启动上下文时不派发。真实 DOM 拖放后的同执行输出包含完整标记和第一个路径，不含第二个路径；全部链接交互继续执行。

## 幂等性与恢复

回归使用可清理夹具，smoke 使用隔离 VS Code profile，可重跑。保留首次失败和后续失败日志；不覆盖先前修复的历史结论。推送时先核对远端 PR head，变基如重写已推送提交，仅使用固定旧 head 的 force-with-lease。

## 证据与备注

本轮精简证据在 `docs/references/smoke-reload-autostart/resource-drop-repair-evidence.json`，包括两轮同执行输出、失败诊断和工件 hash。修前真实证据在 `.debug/resume-failure-fix/`：原终端 live，`execution/dropResourceRejected` 为 missing-session，输出标记没有路径。精简原证据已保存至 `docs/references/smoke-reload-autostart/resume-failure-repair-evidence.json`。

## 接口与依赖

保留 `handleDroppedExecutionResource(kind, nodeId, resource): Promise<void>` 与现有消息协议。复用 `captureExecutionInputTarget`、`prepareExecutionTerminalDroppedPath` 和 `writeNonNativeHostInput`，不新增依赖或旧 session façade。

修订记录：2026-10-10 建立本轮实现及验收计划，明确原执行身份和实时正文边界。

修订记录：2026-10-10 记录实现、修前失败与自动化结果；真实 VSIX 验证进行中。

修订记录：2026-10-10 保留首轮原生成功与后续多行链接失败，新增明确渲染等待以区分测试时序和产品解析。

修订记录：2026-10-10 完成拖放修复验收，记录两轮多行链接独立阻塞并归档本计划；未声称完整门禁通过。
