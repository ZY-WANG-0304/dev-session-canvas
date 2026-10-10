# 定位 Runtime Agent 创建被准入拒绝

本 ExecPlan 按 `docs/PLANS.md` 持续维护。任务为定位，不修改正式产品行为或 smoke 断言。

## 目标与全局图景

解释 PR #314 在修复 Runtime 存储目录权限后，默认 VSIX smoke 的 Agent 为 error、Terminal 为 live 的原因。用拒绝瞬间的证据区分测试启动顺序、正式资源配额与生命周期泄漏，交付可复验结论及后续修复边界。

## 进度

- [x] (2026-10-10) 确认输入为 `563e45c9`，工作树干净；读取流程与两个同文案拒绝点。
- [x] (2026-10-10 11:14Z) 原 helper 带探针重现：准备检查通过，Terminal 持 starting 槽，Agent beginStart 被拒。
- [x] (2026-10-10 11:15Z) burst、serial、raw 三场景 exit 0；串行两者成功，连续创建的原失败节点重试成功，所有实验 Supervisor 自然退出。
- [x] (2026-10-10) 保存脱敏证据，同步设计/index/core-beliefs/技术债；确认正式源码和 smoke 无修改，恢复依赖链接并归档。

## 意外与发现

`RuntimeSupervisor.createSession` 在准备容量不足时可直接抛出同一文案；也可能由 `PreparedExecution.start` 返回的 `rejected-before-acquire` 转成该文案。因此不能从错误文字直接认定 starting=1。本轮实测为后者：准备时 admissionPending=1/2、retainedRetirements=0；beginStart 时身份正确、未关闭/隔离，Terminal 持唯一 starting 槽，Agent resources=[]。

无探针原载荷的连续创建拒绝的是 Terminal，说明被拒节点随异步准备顺序变化。槽释放后两种失败节点均可原节点重试，串行两者成功。

第一次复制载荷的探针因换行拼接造成语法错误，未进入准入，保留在 `.debug/runtime-admission-probe-setup-failed`；修正探针并增加生成 bundle 的 node --check 后才运行计入结果的三场景。第一次启动还因本地 VS Code 缓存不完整触发下载，已停止该下载进程并使用现有同版本可执行文件。

## 决策记录

- 决策：仅修改隔离复制的 VSIX Supervisor 载荷作只读探针，不改变判断条件或正式源码。
  理由：保留当前发布载荷与原 smoke helper 的行为，以瞬时证据验证原因。
  日期/作者：2026-10-10 / Codex。

- 决策：以真实 started 为串行屏障，原失败节点重试只用于因果实验；不增加正式重试或放宽容量。
  理由：现行产品契约允许多活动会话但只允许一个并发启动，测试准备动作应遵守该前提。
  日期/作者：2026-10-10 / Codex。

## 结果与复盘

根因为 Runtime 共用 fixture 未等待原执行 started，连续创建触发正式单启动槽限制。通过新 Runtime 瞬时证据独立确认，与此前 snapshot-only 同机制但不同 helper。重试时前一次失败记录已释放，两个运行节点 admissionPending=0；没有本次拒绝占槽泄漏证据。后续需修共用 helper 并恢复原门禁，本轮不改正式测试/产品，不宣称完整 gate 通过。

## 上下文与定向

工作目录 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。原目录有无关发布工作，不修改。失败原件在 `.debug/runtime-root-fix/final-trusted-artifacts/`。`tests/vscode-smoke/extension-tests.cjs` 的 `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true)` 连续创建 Agent、Terminal、Note，只等节点存在；`verifyLiveRuntimePersistence` 随后等待 Agent live 超时，尚未执行其 reload/reattach。

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 的 `createSession` 先检查会话准备容量、reserve、创建 journal，再调用 owned execution start。`src/panel/executionOwnerLifecycle.ts` 管理预留记录，`src/panel/executionSessionAdapter.ts` 的 `ExecutionAuthority.beginStart` 按身份、关闭、隔离及 starting 数量检查启动。starting 是尚未确认 started 的执行数，不是运行总数。

## 工作计划

第一里程碑：从原失败诊断提取节点启动顺序；复制 `.debug/vscode-vsix-smoke/smoke-host`，仅在其 Supervisor bundle 加入身份匹配、关闭、隔离、配额、持槽状态与 started 释放的探针，保留可重放 patch。完成条件是确认拒绝分支与占用者。

第二里程碑：复用原 helper 连续创建，另用真实 started 作为串行屏障，并对被拒节点重试。若能观察拒绝、started 释放、重试成功且 pending 清空，则可区分启动冲突与泄漏；若不能，继续检查原子准备与关闭边界。

第三里程碑：将最小证据、运行脚本及结论写入 `docs/references/smoke-reload-autostart/`，同步设计、索引、原则、技术债，归档本计划。不得把专项通过写成完整 gate 通过。

## 具体步骤

在 `/tmp/dscr` 恢复依赖链接：`mv .debug/rca/node_modules node_modules` 与 `mv .debug/rca/playwright-browsers .playwright-browsers`。使用 `/tmp/dsc-release-node22/node_modules/node/bin/node`，隔离实验放在 `.debug/runtime-admission-rca/`，通过 `xvfb-run -a node docs/references/smoke-reload-autostart/runtime-admission-investigation.mjs <scenario>` 启动。脚本已补齐；运行前设置 `export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH` 与 `export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`，或使用本机完整同版本安装。依次执行 burst、serial、raw，三个输出都为 `Runtime admission investigation completed`、exit 0。不运行完整发布、不改版本、不合并 PR。

## 验证与验收

拒绝现场必须包含实际配额、身份匹配、closing/blocked、占槽执行状态、是否连接 provider；串行对照须等真实 `execution/started`，两节点 live；重试须针对原失败节点。清理时通过原 smoke stop 入口确认存活节点停止。结果需区分本轮重现证据与历史原件未记录的瞬时状态。

## 幂等性与恢复

每个场景独立 user-data 和 Runtime 目录。只在复制载荷中探测，保留基线 hash；正式源码无变更。收尾把依赖链接移回 `.debug/rca/`，检查本轮隔离 Supervisor 已退出，保留日志不提交整份环境或输出。

## 证据与备注

原失败：RuntimePersistence=true，globalStorage=0700，Agent error 为 `Execution start was rejected-before-acquire.`，Terminal live。原件未记录瞬时准入，精确归因来自相同 helper 新隔离复现。

`docs/references/smoke-reload-autostart/runtime-admission-evidence.json` 保存 baseline/instrumented hash、三个场景的节点/请求/started/重试记录和两个准入点的只读状态。运行日志为 `.debug/runtime-admission-{burst,serial,raw}.log`，探针为 `.debug/runtime-admission-rca/*-supervisor.ndjson`，无需提交完整环境或终端输出。三场景均通过原 stop 入口清理，随后无实验 Supervisor/provider 进程。

## 接口与依赖

使用现有 `scripts/smoke/vscode-smoke-runner.mjs`、VSIX smoke-host 和 fake-agent-provider，不增加正式 API。探针只保留身份、状态、计数，不记录 launchSpec/env 或完整终端内容。

修订：2026-10-10 建立定位计划，明确双拒绝点与证据边界。

修订：2026-10-10 完成三个原生场景，记录单启动槽根因、探针构造失败的排除原因和后续 fixture 修复边界，归档定位。

修订：2026-10-10 11:19Z 保持探针载荷的 strict 指令，复跑 burst/serial 均通过，精简证据更新为最终脚本对应载荷及结果；首次三场景证据另保存在本地 first-evidence.json。
