# 修复重挂载期间的本地快照并发请求

本 ExecPlan 按 `docs/PLANS.md` 持续维护，描述独立于分组标题栏 PR #370 的调查、实现及 PR 交付。用户只授权本轮完成独立修复和 PR 创建；合并必须另获授权。修复合入 main 后才允许接续 PR #370 的 rebase 和验证，本轮不执行。

## 目标与全局图景

终端页面关闭后重新打开，进程仍属原 Host 执行。新页面通过 attach 请求读取当前快照；页面真正应用快照后发回消费回执，Host 才允许下一批内容发送。本任务验证：首次快照已经发送、消费回执未完成时，第二次 attach 是否只等首次操作完成便返回而没有新响应。先分别测试主线及分组版本，不把 CI 超时预先归因于此竞态或标题栏改动。

## 进度

- [x] 2026-11-06：读取工作流，从 origin/main `92736f3822a5cf8838553de4ba9255b861a39448` 创建独立分支及 worktree `terminal-remount-snapshot-race`。
- [x] 2026-11-06：以 PR370 `0a180b2629858a4e625fd80abea9af9d5374358f` 创建 detached 对照 worktree `/tmp/dsc-pr370-snapshot-control`；原 canvas5 分支、OSC 文档和图片保持不动。
- [x] 2026-11-06：两份未修复源码上相同 terminal / agent 可控测试四组均为快照数 `1 !== 2`，确认共享吞请求缺口，不归因标题栏。
- [x] 2026-11-06：实现未执行批次合并及链外取消恢复，补并发、延迟回执、再次关闭、页面/对象替换、旧 ACK、最终发布、失败终止共 18 条回归。
- [x] 2026-11-06：本地相关 Host 38/38、类型、生产资产构建、adapter/channel 109+6+7 和真实 source remount 通过；独立审查提出的无界失败重试 P2 已修复并复审无新 blocker。
- [x] 2026-11-06：实现提交 `5677aabb` 已独立复审并创建 [PR #371](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/371)，目标 main；本轮交付完成，不合并。正式 CI 和 required review 以远端最新 head 为准。
- [ ] 独立 PR 的正式 CI 通过后等待用户授权；合并后才另行接续 PR370 rebase，本轮不执行。
- [x] 跟进 PR371 run42164361993 的 root-owner 回归首败：Node22可控I/O闭锁复现100次空tick误判；root用例改为原始Promise/阶段事件同步，保留原3000ms watchdog、业务断言、真实I/O及门禁，新增6条闭锁回归。

## 意外与发现

PR371 head `0f49018e` 的 Release Preflight run [42164361993](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/42164361993) 已完成但失败。唯一原始失败任务是 regression/shard-1 的 `test:runtime-root-ownership`：`root terminal start routes the current release through preparation client metadata and subscription` 在 `completed` 辅助函数报 `terminal root owner creation did not complete within 100 scheduler turns`。同一 producer 的其他结果因 producer 失败不能被正式采信，verify-result 和 Verify release contract 继续失败，不能将这三个 job 或聚合29项失败当作29个独立产品根因。source live-page-remount 成功；独立观察 run42164361990 的 packaged live-page-remount 也成功。

正常本地对照：原始 main `92736f38` 和 PR371 的 root ownership 任务在 Node25 均19/19通过，PR371用CI相同Node22.23.3亦19/19通过。CI日志没有 pending I/O 栈，因此尚不能确认原运行卡在具体哪个文件操作，也不把正常重跑通过当作修复。后续用可控I/O闭锁验证测试同步边界。

独立实验扣住真实mkdir、journal首个sync返回时，原completed均在100轮报同一错误，实际scheduler task=0、虚拟时钟=0；释放后不再tick即可通过原断言。新增storage/journal矩阵覆盖Terminal start、Agent start/resume，已替换为原始启动Promise与明确阶段事件同步。Node22.23.3的完整 `npm run test:runtime-root-ownership` 通过（Host25/25），相同25项另连续复跑三次通过；原快照信用/页面生命周期回归38/38通过。日志 `/tmp/pr371-root-fixed-node22.log`、`/tmp/pr371-root-fixed-repeat-{1,2,3}.log`、`/tmp/pr371-followup-snapshot-node22.log`。未修改生产快照实现、全局pump、超时阈值或CI任务集合；新head正式CI仍需重新完成。

独立review将新6项闭锁用例在内存中仅回退到原completed等待：6/6出现预期100轮失败；修复版6/6通过。review还发现断言失败时原启动未结束、fixture清理可能用ENOTEMPTY覆盖原始错误；已补finally中先释放并等待两条任务结束，再还原stub和删除目录。allSettled只做收尾，前方Promise.all仍传播失败；最终完整root任务再次25/25通过，日志 `/tmp/pr371-root-fixed-final.log`。

输入证据是 PR370 run 42129264704 的 packaged `surface-continuity/live-page-remount` 失败：重挂载后等待 host/executionSnapshot 8 秒，消息列表为空。下载工件位于 `/tmp/pr370-remount-evidence/`。工件显示新页面 ready、bootstrapAck 及一次初始快照恢复；没有 attach 合并分支的直接记录，因此尚不能将这次 CI 的唯一根因写成已确认。

独立 review 在初版补丁发现：只凭 previousAttach + outcome 恢复会把本批次发送拒绝也自动重试。两个不同 ID、持续 postMessage=false 可导致无界发送。现仅允许执行前因旧 reader 取消而跳过的批次恢复；自身失败终止，前驱 reject 清理槽。reviewer 重跑失败实验变为恰好三次尝试（eager + 两个请求），两调用结束，并验证最终发布期间再次 attach 不死锁。

全量 Host 最后一次复跑先通过 252 条，再于旧 detached restored agent restart 断言失败；同用例在未修改 main 对照一致失败。宽过滤另外命中 sharedCanvasFixture 未初始化配置，main 也一致复现。并行运行 smoke 时还曾在 agent root write failure 用例 3000ms 超时，随后全量越过该用例，main 单测通过；准确触发原因未确认，不通过增加时间修复。见技术债记录，不把这些结果称为全量通过。

## 决策记录

用户要求独立 PR，优先于默认关联门禁集中修复约定。主线与分组控制版本使用相同新增测试和相同依赖；只在 detached 控制工作树添加实验测试，不在 PR370 工作树做修改。测试先建立失败证据，生产修复在确认后进行；不增加 timeout，不删除断言，不降级 CI。

## 结果与复盘

已确认并修复共享源码竞态；本地受控回归及真实 Linux source 重挂载通过，分组标题栏及其工作树未改。正式 packaged/跨平台 CI、审批和合并仍未完成，本地诊断不签发正式验收。

## 上下文与定位

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `postLocalExecutionSnapshot` 使用每个页面的 reader（页面读取责任记录）、attachPromise（正在生成/发送/等待消费的快照操作）和 record.terminalChain（顺序处理终端输出的 Promise 链）。`postLocalExecutionReaderMessage` 等待 `webview/executionLocalOutputApplied` 的精确回执；`generation/frameId` 区分前后两份页面。快照消费不是终端进程退出，也不是最终 reader 结算，不能混用这些状态。

`scripts/test/test-host-execution-owner-wiring.mjs` 编译实际 Host 类，替换 VS Code/进程边界，提供 `localFixture({ outputCredit: true })`、可控 provider 与调度器。它允许扣住真实消费回执，不靠真实 sleep 猜时序。`tests/vscode-smoke/extension-tests.cjs` 的 `runIndependentLivePageRemount` 是实际 VS Code 场景，`verifyTerminalLineAndSnapshot` 发出 attach 并核对快照，原 timeout 必须保留。

## 工作计划与里程碑

第一里程碑是在独立工作树添加实际 Host 可控实验：启动一个 local execution，捕获第一份带消费回执标识的快照，暂不回复；第二次 attach 后释放第一回执，要求第二请求有自己的当前快照而不是只结束 Promise。将同一测试 patch 应用于分组 detached 控制目录并运行，比较结果；即使两者同样失败，也只证明共享源码有该缺口，不证明原 CI 的每次超时都来自它。

第二里程碑根据确认的时序修复 Host。方案必须保留串行发送与消费信用、不跨页面复用回执、不重启进程，且并发请求不能无限追加无用的快照工作。设计决策写入 `docs/design-docs/terminal-remount-snapshot-race.md` 后再修改生产逻辑。回归涵盖已发送和未发送的初始请求、并发请求、延迟回执、关闭期间的 pending 请求、重挂载新页面及旧页迟到回执。

第三里程碑验证类型、构建、Host 邻近用例及可执行的真实场景，交给独立子代理 review。按真实能力报告未验证边界，提交本分支并创建目标 main 的独立 PR。PR370 留待独立修复经 CI、审查和用户授权合并后再接续，不另建标题栏 PR。

## 具体步骤

所有修改和主要命令均在 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/terminal-remount-snapshot-race` 运行，控制目录为 `/tmp/dsc-pr370-snapshot-control`。先运行 `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern 'local snapshot attach'`，对照修前修后结果；扩展到 local consumption、mount、reader cancellation 相关测试。执行 `npm run typecheck`、构建以及文档检查。构建如缺少默认原生资产，须区分显式 stock 对照与生产原生构建，不伪装同包验收。

## 验证与验收

可控测试必须证明第二次请求在首次已发送但未消费时不会静默丢失；回执未到前不能越过背压，旧回执不能解锁新快照，新页面不能收到旧页面排队的请求。运行相同测试于两份原始输入并保存红灯证据；最终通过不能覆盖历史失败。创建 PR 只代表交付审查输入，不代表 required CI 或真实跨平台已通过。

## 幂等性与恢复

仅在独立主题分支提交。原工作树不 stash、不切分支、不 reset。控制 worktree 可保留用于审查；任何清理先确认无用户工作。推送前 fetch 并 rebase 最新 origin/main；新分支正常推送，已有远端更新时才用绑定已核对 head 的 force-with-lease，不触碰 main 或 PR370。

## 证据与备注

红灯 SHA、测试名和日志见正式设计的验证证据。最终验证命令与结果：

- `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern '^(local |(terminal|agent) local |actual local Host)'`：38/38，含18条新增用例；日志 `/tmp/snapshot-race-host-local.log`。
- `npm run test:execution-session-adapter`：adapter109、channel6、interaction7通过；日志 `/tmp/snapshot-race-adapter.log`。
- `npm run typecheck`：通过。
- `npm run build -- --execution-assets-set=/home/users/ziyang01.wang-al/projects/dev-session-canvas/generated/execution-assets`：通过，显式使用已有生产原生资产，不是 stock 构建，也未重编原生二进制。
- `DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas5/.vscode-test node scripts/smoke/run-vscode-smoke.mjs --diagnostic --scenario surface-continuity/live-page-remount`：最终生产修改重建后通过；日志 `/tmp/snapshot-race-remount-smoke-final.log`。仅为本地 source 定向诊断，不代表同批 packaged 验收。
- 无过滤 Host：未通过，最终复跑日志 `/tmp/snapshot-race-host-full-repeat.log`；未修改 main 对照 `/tmp/snapshot-race-main-existing-failure.log` 与 `/tmp/snapshot-race-main-shared-fixture-failure.log`。

## 接口与依赖

复用现有 Host、LocalExecutionReader、消费回执、生命周期身份和 esbuild 测试设施，不引入依赖或新运行时服务。是否需要扩展 reader 内部状态或调整 smoke 关联标识，由可控实验和现有 requestId 合同决定，并记录在正式设计。

修订：2026-11-06 创建独立调查与交付计划，明确用户授权顺序和对照边界。

修订：2026-11-06 补齐双基线红灯、独立 review 修复、最终本地验证及未完成的正式门禁边界。
