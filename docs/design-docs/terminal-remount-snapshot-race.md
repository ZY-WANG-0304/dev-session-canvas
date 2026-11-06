---
title: 本地终端重挂载的快照请求责任
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 共享模型与编排层, 画布呈现层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/terminal-remount-snapshot-race.md]
updated_at: 2026-11-06
---

# 本地终端重挂载的快照请求责任

## 背景与问题

PR370 CI 的 packaged live-page-remount 在第二次页面打开后等待快照超时。修前 `CanvasPanelManager.postLocalExecutionSnapshot` 遇到现有 attachPromise 时等待后直接返回；该 Promise 包含发送后的页面消费回执，因此会合并掉已发送之后到达的请求。该机制已由可控对照确认；原 CI 工件没有 attach 分支的完整轨迹，不宣称标题栏导致或已确定 CI 唯一根因。

## 目标与非目标

先在最新 main 与分组固定 head 做同一可控对照，再确保并发请求和页面替换的快照责任完整。仅处理 Host 本地执行的快照链路；不重启进程、不改变 Supervisor 持久化、不变更标题栏，不扩大超时或修改 CI 通过规则。

## 候选方案与边界

候选项包括等待已有操作后重新响应、按发送边界合并请求并安排有界后续快照，或确认测试误读协议后修正消费验证。不能直接删除去重返回而忽略并发工作数量，也不能复用已被测试清除且不对应后来请求的历史结果来制造绿色。请求标识、终端状态序列、消费回执与页面身份须分别保持含义。

## 当前结论与验证

相同可控测试在 main `92736f38` 和分组 `0a180b26` 的 terminal / agent 四组输入均失败：第一份快照已发送而未 ACK 时进入第二 attach，第一 ACK 后第二 Promise 完成，但快照数量仍为 1 而非 2。这确认共享 Host 逻辑存在吞请求路径，不是分组标题栏独有问题；不代表原 CI 触发时序已被完整证明。

## 正式方案

每个 reader 记录尚未开始执行的快照批次，以可选 requestId 为键。同 ID（包括无 ID）只合并未开始的批次；任务开始后到达的请求必须取得后续响应。不同 ID 保留各自响应，不能 latest-wins。无 ID 流量最多一个执行中和一个待执行批次；不同 ID 的总待办数量未增加新的限额，需要协议拒绝语义才能另行限流，本次不更改协议。

实现位于 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `LocalExecutionReader.pendingSnapshotAttaches` 和 `postLocalExecutionSnapshot`。批次直接排入现有 terminalChain，任务开始时释放合并槽，再读取届时 tracker/finalTerminal 并等待独立消费回执。attachPromise 只记录真实排队任务，不记录会递归重新排队的外层恢复 Promise，避免等待自身。取消 eager 快照后的同页 mount 恢复保持既有行为，但恢复必须发生在链外，并重新核对页面身份、可交互状态及 admission；旧页请求不得迁移到新页。发送、消费及最终结算继续使用原有精确身份校验。

只有因前序 reader 已取消、尚未尝试本批次而跳过的请求可以恢复；本批次自己的 flush、发送拒绝或异常不自动重试。独立 review 曾以两个不同 ID、持续 postMessage=false 发现初版恢复条件会无界重试，现已限定跳过标记，并在前驱失败时清理未执行的合并槽。对应 false / throw、前驱 reject 回归保留，不增加重试预算或超时。

独立 PR 经审查、CI 和用户授权后方可合并，之后才更新 PR370。

## 验证证据与局限

### PR371 首轮 CI 的外部 I/O 同步

run42164361993 的 snapshot 重挂载 source 场景通过，独立观察 run42164361990 的 packaged 场景也通过；新的首败是 `test:runtime-root-ownership` 的100轮 scheduler 等待。root fixture 的创建会执行真实目录检查与 journal 写入/锁/fsync；这些不由虚拟 scheduler 驱动。Node22.23.3 的可控实验分别扣住真实 mkdir 与首次 journal sync 的返回，100次 tick 均未执行任何 task，却触发相同完成断言；释放后不再 tick 即完成，原 owner/create/metadata/subscription 断言通过。原CI没有pending I/O轨迹，不将具体mkdir或fsync断言为原运行唯一卡点。

该门禁卡点在本独立PR内继续收口，不触碰#370或生产快照实现。root ownership 的外部异步任务改为等待原始操作Promise，阶段检查等待对应的entered事件；保留每例原3000ms watchdog、所有业务断言、真实文件操作与fsync，不全局更改用于纯生命周期测试的100轮pump。新增storage/journal闭锁矩阵：扣住外部完成交付、走满原100轮，断言尚未创建/订阅或完成；释放后按原合同完成。同步修复不是增加等待阈值、mock掉持久化或删除验收条件。

异常收尾先释放闭锁并等原始启动和检查任务结束，再恢复连接stub、清理目录，避免未结束的journal写入与删除竞态覆盖原断言。失败由Promise.all传播，finally中的allSettled只负责收尾。独立review的内存回退6/6红、修复6/6绿；Node22完整root任务25/25及snapshot相关38/38通过，仍不替代新head的正式CI。

`scripts/test/test-host-execution-owner-wiring.mjs` 使用实际 Host 类和可控回执。新增测试覆盖 Terminal/Agent 的第二次 attach、32 个无 ID 合并请求、混合及不同 ID、后续批次、再次关闭、generation/frame 与实际 webview 对象替换、旧 ACK、最终发布、发送失败及前驱异常。保留 eager 取消恢复与原信用/结算测试。

修前对照：main `92736f3822a5cf8838553de4ba9255b861a39448`、group `0a180b2629858a4e625fd80abea9af9d5374358f` 分别运行 `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern 'local snapshot attach.*terminal'` 和 agent 变体，均在 `second attach must not complete without a fresh snapshot` 得到 `1 !== 2`。原始日志在 `/tmp/snapshot-race-main-red.log`、`/tmp/snapshot-race-main-agent-red.log`、`/tmp/snapshot-race-group-terminal-red.log`、`/tmp/snapshot-race-group-agent-red.log`；SHA 与测试名用于重建证据，不依赖临时日志永久保存。

PR370 run [42129264704](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/42129264704) 的首败是 packaged `surface-continuity/live-page-remount`，`verify-result` 和 `Verify release contract` 是下游失败，不是三份独立产品根因。原 artifact 显示新页面 bootstrap 与初始恢复、后续等待 snapshot 超时；不能单凭本地修复通过就追认该运行根因完全闭环。独立 PR 的正式 source/packaged 和跨平台 CI 仍须验证，不通过就不能合并。
