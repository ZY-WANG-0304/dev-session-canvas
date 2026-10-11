# 定位后续 Agent 启动准入拒绝

本计划按 `docs/PLANS.md` 持续维护。本轮为 PR #314 后续 `verifyRuntimeReloadRecovery` 启动失败的根因调查，不直接实现修复。

## 目标与全局图景

解释 Codex Agent 为什么在 reload 之前启动失败，区分 smoke 启动顺序、正式并发限制与插件错误反馈缺口。结果必须有原始现场、拒绝瞬间的实际状态及受控正反对照，不能把通用 rejected-before-acquire 消息当成完整原因。

## 进度

- [x] (2026-10-10) 复核原现场：Agent/Terminal 请求相隔 3ms，Agent CLI 解析成功但未获取 provider；Terminal started，Agent 等待超时发生于 reload 前。
- [x] (2026-10-10) 审计产品约束、adapter beginStart 与 Webview 启动入口。
- [x] (2026-10-10) 原生探针确认 Agent 被 Terminal 的 starting=1 拒绝；双顺序重叠拒绝及确认后重试 2/2。
- [x] (2026-10-10) 核对 owned 抛错与页面 promise 漏消费，原生未处理拒绝/无 host/error 与受控状态相符；补齐历史源码来源。
- [x] (2026-10-10) 探针/特征测试分别保存为 patch；移除探针后 2/2 通过；三份源文件恢复并核对基线 hash，归档研究计划。

## 意外与发现

正式准入在 `docs/product-specs/runtime-persistence-modes.md` §9 和容量设计中明确 `{ executions: null, starting: 1, pending: 2 }`，并发启动限制拒绝新获取，不排隐藏队列。源码 `ExecutionAuthority.beginStart` 也可能因身份不符、closing 或 quarantine 拒绝，需实际观测区分，不能先断言本次一定是 starting=1。

`handleMessage` 的 `webview/startExecutionSession` 只在 RuntimePersistence 开启时跟踪启动 promise；snapshot-only Agent 分支直接 await owned start 且没有 catch。两者结合可以解释拒绝未反馈，但仍需受控验证。

## 决策记录

- 决策：在实际 authority 拒绝点临时记录 identity 是否匹配、starting/active、关闭/隔离与占槽执行，保持原判断和时序不变。理由：原日志只有通用结果，最后 snapshot 已失去拒绝记录。日期：2026-10-10。
- 决策：使用当前 Host/owner/adapter 受控 transport 保留 started 确认，比较另一执行在确认前与确认后启动；临时特征测试和探针保存为证据 patch，调查结束恢复。理由：隔离配置、真实服务、旧进程与窗口 reload。日期：2026-10-10。
- 决策：分别给出触发原因、限制是否符合产品设计、错误传播是否正确。理由：测试不符合准入约束与产品未反馈拒绝可以同时成立，不能混为单一生命周期故障。日期：2026-10-10。

## 结果与复盘

已确认三层结论：smoke 不等待实际 started 导致两次启动重叠；底层 starting=1 拒绝符合正式契约；snapshot-only owned 抛错未被页面消费是产品反馈缺口。原生 Agent eb50c81c… 被 Terminal cb92d2be… 占用的启动槽拒绝，identityMatch=true、closing=false、无 blockedReason。移除探针后的双顺序对照 2/2：第二 transport connect=0，释放第一 started 后同节点重试成功、两个 adapter running。没有必要增加另一次完整串行 smoke：原生 gate 与受控因果对照已回答本轮归因；后续完整门禁继续标失败，修复与验收仍待后续工作。

临时夹具初次失败源于未提供生产准入要求的页面 output-credit，finally 无条件 release 掩盖该失败；加齐能力后通过。后续 connect 计数最初装在 owner 复制选项之后，未观测到连接；改在 transport 的实际 connect 中计数后得到 0/1 对照。均为实验夹具修正，不是产品根因证据。源码恢复后 adapter、Host 测试、smoke 的 SHA-256 与调查前一致。

## 上下文与定向

专用工作树 `/tmp/dscr`，基线 `2b828114`，原项目树有独立发布改动，不使用它。`tests/vscode-smoke/extension-tests.cjs` 的 `verifyRuntimeReloadRecovery` 连续调用两个 `dispatchWebviewMessage` 后才 waitForAgentLive；命令返回只表示 Host 已接收，不能表示 provider started。`extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts` 的 `ExecutionAuthority.beginStart` 决定真实资源获取准入。`executionOwnerLifecycle.ts` 的 reserve 和 Host 准备先于该判断，`CanvasPanelManager.startNonNativeHostExecution` 将非 started 结果抛出。`scripts/test/test-host-execution-owner-wiring.mjs` 提供真实 Host 和受控 transport 夹具。

## 工作计划

第一里程碑读原失败和契约，插入仅观测的临时拒绝日志并运行默认真实 VSIX，确认本次被哪条条件拒绝，日志不能打印环境变量。第二里程碑复用受控 fixture 挂住第一个 provider 的 started 确认，比较另一节点在该窗口启动与释放后启动；交换 Agent/Terminal 验证不依赖 provider 类型，检查 Host 清理及错误反馈。第三里程碑核对 git 历史，更新正式调查文档、索引、原则与技术债，保留短 JSON 及可复跑 patch；恢复产品/测试临时代码。

## 具体步骤

使用 Node 22：`export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。将 `.debug/rca/node_modules` 移至根目录，将 `.debug/rca/playwright-browsers` 移至 `.playwright-browsers`，结束移回。

受控测试使用 `DEV_SESSION_CANVAS_HOST_TEST_FILTER='start admission characterization' node scripts/test/test-host-execution-owner-wiring.mjs`。真实验证为 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke`，日志与工件放 `.debug/start-admission-rca/`。

调查文档完成后核对原源码 hash、`git diff --check`，`git fetch origin`、提交并 `git rebase origin/main` 后更新 PR #314，不合并、不发布。

## 验证与验收

真实拒绝记录要明确 identityMatch、starting 限制、closing/blockedReason 和占槽执行。受控重叠对照应在第二个 provider connect 之前拒绝，释放第一个 started 后同种请求应成功；反向顺序用于排除 Agent 配置专属问题。错误传播验证分清 promise 拒绝、Host 诊断、host/error 和节点状态，不把未处理拒绝当成正常提示。

## 幂等性与恢复

临时探针只记录标识和准入计数，无环境信息、无条件改变。保存临时 diff 后按基线恢复指定产品/测试文件，保留文档；不使用全树 reset。原生测试使用隔离 VS Code profile，可重跑，保留首次失败。

## 证据与备注

原现场见 `docs/references/smoke-reload-autostart/scrollback-smoke-repair-evidence.json` 和 `.debug/scrollback-smoke-fix/trusted-artifacts`：03:00:22.130 Agent request，22.133 Terminal request，22.144 CLI resolved，22.145 Agent persistence not-required，22.212 Terminal started。

## 接口与依赖

不新增正式接口或依赖，不修改 starting/pending 限额和生产排队策略；调查使用既有 authority snapshot、Host 夹具与原生 VSIX runner。

修订记录：2026-10-10 建立多步调查计划，明确拒绝契约与错误反馈分开验证。

修订记录：2026-10-10 完成原生瞬时证据、双向特征对照、错误传播及历史来源审计；恢复临时代码，归档纯调查交付。
