# 修复启动拒绝反馈与 smoke 启动顺序

本计划遵循 `docs/PLANS.md`，在 PR #314 专用工作树 `/tmp/dscr`、分支 `investigate-smoke-reload-autostart`、基线 `f91b5186` 实施。不修改原项目树、版本或发布材料。

## 目标与全局图景

用户快速启动不同节点时，合法的并发拒绝应显示可理解提示，而不是无人处理的 promise。恢复 smoke 应逐个等到真实启动，进入预期 reload 验证。正式 owner 的 starting=1、pending=2 保持；多个运行会话允许，启动过程不排队。前轮原生与双向特征对照见已完成的 `owned-start-admission-investigation.md`。

## 进度

- [x] (2026-10-10) 复核真实启动入口和既有错误责任，确定页面 catch 边界。
- [x] (2026-10-10) 新增 20 项真实页面入口回归；修前原 rejected-before-acquire 成为未处理拒绝，修后通过。
- [x] (2026-10-10) 统一页面错误消费、原结果/identity 诊断与中文提示；恢复 smoke 串行启动，并按原 executionId 等待 started；后续恢复正文改写已撤回。
- [x] (2026-10-10) 完整 Host 454/454、类型/本地化/正文 helper 通过；最终原生确认两个启动，后续 reload 状态冲突与中间 pending 保存单列。
- [x] (2026-10-10) 同步正式文档/证据并归档计划；按既有 PR #314 分支完成提交和远端更新。

## 意外与发现

最终代码的第二轮原生复验揭示错误观察边界遗漏：早期准备中的旧请求已被 Host boundary 取消，新的通用 catch 却仍弹出迟到错误，导致 verifyRealWebviewProbe 看见 toast。已按本请求原 record 的 stopRequested/身份绑定抑制取消、替换及删除请求的提示，诊断保留；普通 Error 提示改为 message，避免内部 stack 出现在页面。该问题由本轮新反馈路径暴露，必须在本轮收口，不能登记后放任回归。

首轮原生的新阻塞发生在两个启动确认之后、simulateRuntimeReload 返回的状态断言；已保存恢复 ID 排除缺失恢复信息。代码中早期正文也可能投影 live，因此 smoke 最终显式等待原 executionId 的 started 诊断后再启动另一个节点或 reload。最终真实 VSIX 已跨过旧 toast 及中间的 pending 保存现场，在自身 reload 后状态断言再次失败；两个原启动和 saved 均有直接证据。

内部 `startAgentSession` / `startTerminalSession` 被 await 的测试/命令调用依赖 reject；不能为页面提示把内部错误全部吞掉。RuntimePersistence 分支已有部分 catch，成功处理的错误不应重复提示。启动结果的资源责任由 `startNonNativeHostExecution` 与 owner 保留，页面 catch 不参与清理。

## 决策记录

页面 `webview/startExecutionSession` 统一立即消费启动 promise；明确的非 started 本地结果保留类型和原 identity 供诊断，拒绝提示不解析错误字符串。通用准备失败继续显示原因。页面比较派发前后记录，只捕获本请求新建的 owned record/metadata；新请求被旧 stopping 记录阻塞仍须提示，不能借旧 stopRequested 抑制；原请求已 stopRequested、当前记录被替换、metadata 换绑或节点删除时仅保留 suppressed 诊断，避免旧错误污染后续页面。提示和诊断不修改节点、metadata、reader 或持久化责任。观察者抛错也不能产生新的未处理拒绝。内部 awaited 调用保持 reject，原 Runtime 操作跟踪保持。

smoke 在 Agent live 后再派发 Terminal；不提高准入限额，不增加固定延迟。该恢复场景后续运行期正文仍等待历史 metadata，初始曾一并校准；原生运行在更早的 reload 状态断言失败，因此撤回未触达的正文改写，后续独立处理，不把未经原生验证的正文变更混入本轮。

## 结果与复盘

新增 20 项定向、最终完整 Host 454/454、类型检查、UI 本地化与正文 helper 14/14 通过。首轮真实 VSIX 已确认两个执行 started，随后模拟 reload 状态得到 Agent stopped/Terminal closed，与 resume-ready/interrupted 断言冲突，恢复会话 ID 存在。本轮不修改这项状态语义或断言；最终启动等待补充原 executionId 的 started 证据，避免将早期输出投影的 live 当作启动确认。最终默认 VSIX 前缀与两次原启动通过，随后仍在上述 reload 状态断言失败；本轮两项修复完成，完整门禁未完成。

## 上下文与定向

`CanvasPanelManager.ts` 的页面 handler 启动 promise 后返回，snapshot-only 未消费失败；`startNonNativeHostExecution` 将 `OperationResult` 非 started 转成普通 Error，丢失结果类型。补充内部类型化异常及页面反馈，不改变结果结算。`tests/vscode-smoke/extension-tests.cjs` 的 `verifyRuntimeReloadRecovery` 连续发两个请求，需先等 Agent live。`scripts/test/test-host-execution-owner-wiring.mjs` 提供真实 Host 和受控 transport，使用完整生产页面 output-credit 能力；双向挂住 first started 验证 second connect=0 和提示，释放后重试两个都 running。

## 工作计划与里程碑

第一里程碑先补回归并在原产品上看到无 host/error 的失败；覆盖真实页面 handler，原生调用内部错误仍 reject。第二里程碑补统一页面 catch 与类型化本地启动结果，捕获明确拒绝与未知结果各自诊断；保留现有资源清理，避免晚到错误改节点，补中文翻译，校准同一恢复 smoke。第三里程碑运行定向及完整测试和真实 VSIX，区分原启动超时已收口与整个恢复函数完成；独立后续阻塞另记，不弱化断言。

## 具体步骤

在 `/tmp/dscr` 使用 `export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。依赖与浏览器从 `.debug/rca/` 移回根目录，结束移回。

定向：`DEV_SESSION_CANVAS_HOST_TEST_FILTER='webview start' node scripts/test/test-host-execution-owner-wiring.mjs`；完整：`node scripts/test/test-host-execution-owner-wiring.mjs`；类型：`npm run typecheck`；smoke 语法：`node --check tests/vscode-smoke/extension-tests.cjs`。真实：`DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke`，日志与原工件保存在 `.debug/start-admission-fix/`。

## 验证与验收

合法并发拒绝有且仅有一次页面提示与同请求诊断，second connect=0，原 first 仍 starting；释放 first 后手动重试成功。准备失败/早期准入抛错同样消费，已处理的 Runtime 错误不重复通知，未知结果保留资源责任；旧请求晚到不改新节点。完整 Host 保留原直接调用拒绝的测试。原生恢复函数需按其真正生命周期与原执行正文/退出断言验证。

## 幂等性与恢复

只在专用 PR worktree 修改，临时日志不进产品；失败工件单独留存。不自动重试启动，不放宽 owner 限制，不用页面错误释放未知资源。推送前 fetch、rebase origin/main，不合并或发布。

## 证据与备注

前轮证据 `docs/references/smoke-reload-autostart/start-admission-evidence.json` 已有真实 gate；本轮补修前/修后、完整测试和原生具名结果。

## 接口与依赖

仅增加 Host 内部类型化错误和页面观察方法，不增加协议或依赖；使用既有 host/error、l10n 与诊断入口。

修订记录：2026-10-10 完成页面拒绝反馈、迟到错误保护与原身份启动等待；保留中间失败证据并登记独立 reload 状态冲突，归档修复计划。
