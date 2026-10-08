# 确认协议回归中两处时序失败的根因

本 ExecPlan 按 `docs/PLANS.md` 维护。任务是对 PR #306 rebase 时发现的两处失败作出有证据的归因，不通过重复运行至绿或放宽断言替代定位。

## 目标与全局图景

确认 `test-runtime-supervisor-protocol.mjs:548` 的订阅 revision 断言和 `:992` 的终态 resize 拒绝断言为什么间歇失败，区分测试前提错误、Supervisor 产品缺陷与 F-01 请求超时修复的影响。交付可重跑的诊断、正式结论与后续修复边界。

## 进度

- [x] 2026-10-09：读取原始两次失败日志及测试/服务端路径，确认原测试使用 raw socket，不通过 RuntimeSupervisorClient 发这两类请求。
- [x] 2026-10-09：真实 socket/PTY 五个有限场景验证同步缺口，未门控原退出输入也直接复现失败。
- [x] 2026-10-09：主线与 PR 各 5/5；正向场景满足原业务断言，构建输入不包含 F-01 client。
- [x] 2026-10-09：正式设计与技术债记录确认事实和未修测试，完成诊断交付准备；提交及 PR 关联由 Git 记录。

## 意外与发现

第一处等待 registry revision 增长，没有验证指定 marker 已写入；PTY 输入回显也可以推进 revision。第二处观察输出后固定等待 25ms，没有等到服务端退出回调。受控对照现已证实；原退出输入未加门控也复现 marker 后 27ms resize 成功、639ms 退出通知才到达。主线自然对照则为 13ms 退出、28ms resize 被拒绝。

## 决策记录

2026-10-09：复用实际 Supervisor、Node PTY 和 raw socket，记录事件顺序并对输出/退出门控，分别构造前提未满足和已满足的情况。理由是原失败仅有断言结果，缺少时序记录；不直接从复跑通过推断无缺陷。原产品代码和原测试保持不变，诊断脚本只提供有限输入、插桩与证据。

## 结果与复盘

两项根因已确认为测试缺少阶段事实同步；F-01 的客户端超时不在对应 raw socket 路径中。诊断/设计交付完成，原测试修正未实施，已登记技术债。原失败与后续通过均保留，未把归因当作修复。

## 上下文与定向

Supervisor 是独立托管终端的进程。`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 中 `bindSessionProcess()` 将 PTY 输出写入日志并赋予 revision，`subscribeSessionAtSettledRevision()` 回放订阅时已存在的事件并继续推送 live 事件；输出和回放共享同一种消息。`bindSessionProcess()` 的退出回调关闭变更准入，`resizeSession()` 通过 `requireLiveSession()` 检查该事实。`scripts/test/test-runtime-supervisor-protocol.mjs` 的两个目标用例直接向 socket 写 JSON 请求；`waitForRuntimeSupervisorMessage()` 会从数组移除找到的消息。

## 工作计划

里程碑一新增 `scripts/diagnostics/diagnose-runtime-protocol-races.mjs`，从真实源码构建诊断 Supervisor，在进程输出、订阅、resize 和退出入口记录小体积 JSON 事实。真实子进程分别允许 marker 在订阅前/后产生、允许退出通知在 resize 前/后出现；使用明确门控而非靠重复碰运气。结束时应打印输入、订阅 revision、marker revision、resize 回包和退出顺序。

里程碑二已核对失败输入满足原测试实际等待条件，但未必满足它声称的业务前提；对前提确实满足的输入验证原断言成立。读取依赖的 node-pty 退出事件实现，必要时增加一次未门控原输入观察，严格区分机制证明与原历史运行的不可追溯细节。

里程碑三在 `docs/design-docs/runtime-protocol-race-root-cause.md` 记录结论和代码锚点，索引同步，技术债保留未执行的测试修复。更新 PR #306 对两项未知风险的描述。

## 具体步骤

在 `runtime-rpc-request-timeout` worktree 执行 `node scripts/diagnostics/diagnose-runtime-protocol-races.mjs`。依赖当前 npm ci 安装并打补丁的 xterm 与 node-pty。临时目录写入日志和子进程脚本，raw 证据保存在 `.debug/runtime-protocol-races/`，不包含环境变量或命令凭据。只保留有限场景，所有 socket、子进程、临时目录在 finally 清理。

## 验证与验收

必须看到同一服务端在不同合法事件顺序下，原等待条件都满足，但 marker 可能超出订阅回放边界、resize 可能在退出通知前合法成功。反向控制先等待实际 marker/退出准入关闭，应满足原业务断言。如果观测不符，就撤回对应候选解释并沿实际记录继续定位。不得仅凭源码或后续绿灯宣布根因。

## 幂等性与恢复

诊断使用独立临时 storage/socket，不接触用户会话。每轮场景只发有限请求，不重放有副作用的生产请求；结束时显式终止诊断子进程并等待退出。当前 PR 已有实现不变。

## 证据与备注

PR 与主线各完成 5/5；订阅后 marker 对照为订阅 revision 1、marker revision 2，订阅前放行为 2/2；两种回放均完整连续。自然退出与正向 finalizing 对照详见 `docs/design-docs/runtime-protocol-race-root-cause.md`。构建、语法与 diff 检查通过。`exit-callback-held` 人为控制返回 EBADF，不将该控制输入当作历史运行实际错误。

历史原始失败：`/tmp/dsc-rpc-rebase-protocol.log`（第 548 行）；`/tmp/dsc-rpc-rebase-protocol-rerun.log`（第 992 行）。旧主线对照与末次分支协议运行都曾通过；这不足以确定根因。调查基线为 PR head `7a95b6ba`、主线 `9e6243c9`。

## 接口与依赖

复用 Node fs/net/child_process、现有 esbuild 与 node-pty。不修改 wire 协议、客户端超时或生产运行时接口。诊断插桩以测试构建内的方法包装记录事实；任何人为延迟或门控都必须标在输出中。

2026-10-09：初版计划记录范围、候选解释、有限受控验证与证据要求。

2026-10-09：完成主线/PR 的有限机制复现与正向对照，记录未门控退出输入失败的实际时序；归档计划并单独登记尚未实施的测试修正。
