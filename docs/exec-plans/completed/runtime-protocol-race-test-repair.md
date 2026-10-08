# 修正 Supervisor 协议测试的两处同步前提

## 目标与全局图景

修复 PR #306 中已确认根因的两处间歇测试失败，使协议门禁按真实事件顺序判断回放与退出行为。普通 hello/RPC 的 F-01 超时已在本分支实现，本轮只修正其回归测试，不改变超时、未知结果或严格删除契约。

## 进度

- [x] 2026-10-09：复核已确认根因与生产回调，选定 marker 等待和真实串行链路屏障。
- [x] 2026-10-09：实现订阅前 marker 同步、终态后 resize 拒绝及确定性 finalizing 测试。
- [x] 2026-10-09：完整协议门禁通过，两项准入变异均被新测试捕获，已同步文档并关闭技术债。
- [x] 2026-10-09：fetch 确认目标仍为 `9e6243c9`，当前分支已包含该基线；完成交付准备，提交及 PR #306 关联由 Git 记录。

## 意外与发现

PTY（伪终端）输入回显也会推进日志 revision（事件序号）；输出 marker 到达不能证明退出回调已到达。历史诊断已经分别复现，不需要再次碰运气定位。

## 决策记录

2026-10-09：在现有协议脚本中复用构建产物，直接实例化真实 Supervisor、journal 和 tracker，注入可控 process/socket，并屏蔽后台持久化与退出计时器。将 Promise 屏障放入实际串行操作链，使输出和收尾排队；不替换 finalizeSession 或准入判断，保证收尾窗口的业务断言仍有意义。

## 结果与复盘

两处同步条件已实际修正，原回放连续性、marker 恰好一次、尾部完整与发布顺序断言保留。新增屏障测试证明收尾尚未运行时立即拒绝 resize，释放后只发布一个含完整尾部的终态。完整协议门禁通过；准入关闭缺失和 resize 绕过准入的变异均被捕获。本轮无新增技术债；历史失败与本轮修复验证分别记录。

## 上下文与定向

`scripts/test/test-runtime-supervisor-protocol.mjs` 运行真实 socket/PTY 回归。`assertRuntimeSupervisorFinalStateUsesFreshSerializedSnapshot()` 内的 attach gap 用例只等 revision 增长，finalization 用例看到 marker 后固定等 25ms。二者根因见 `docs/design-docs/runtime-protocol-race-root-cause.md`，历史诊断计划已完成。

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 中 `bindSessionProcess()` 在 exit 时关闭 mutation admission（变更准入），`finalizeSession()` 将收尾排入 `terminalOperationChain`，`resizeSession()` 在排队前检查准入。journal 保存事件，tracker 维护终端状态。测试要保持这些方法真实运行。

## 工作计划

里程碑一修正同一脚本的两个真实 PTY 用例：订阅前等 registry 出现指定 marker；收到含尾部的非 live 终态后只发送一次 resize 并验证拒绝，将 scrollback/output 顺序断言移到其事件检查处。

里程碑二新增确定性服务端辅助测试：建立带真实 journal/tracker 的 live session，绑定可控进程；先挂起串行链，交付尾部和退出，要求收尾尚未发布时立即拒绝 resize。释放屏障后验证尾部、单一终态及没有尺寸/日志副作用。fixture 使用独立临时目录并完整清理。

里程碑三运行完整协议门禁并做一次反向控制，更新设计索引、核心信念和技术债，归档计划，提交到当前 PR 分支。

## 具体步骤

在 `runtime-rpc-request-timeout` worktree 根目录运行 `npm run test:runtime-supervisor-protocol`。已有 `npm ci` 依赖，门禁包含 23 个请求超时测试、主协议、checkpoint、分页与输出信用回归。预期全部退出码为 0。用临时构建取消同步关闭准入作为反向控制，预期新测试在未释放屏障时失败；不得把变异产物写入产品源码。

## 验证与验收

marker 必须属于 subscribe 返回 revision 覆盖的回放，原连续性与恰好一次断言保留。真实 PTY 的最终快照必须包含尾部且拒绝后续 resize。确定性测试必须确认 exit 已交付、live 仍为 true、finalization 已排队而未发布时，resize 已拒绝且无副作用；屏障释放后完整收尾。不得以加 sleep 或反复 resize 满足断言。

## 幂等性与恢复

测试使用 mkdtemp 独立存储、可控进程和 finally 清理；失败也释放屏障、等待已排队操作、释放 tracker/journal。原用户 dev-session-canvas5 工作树的未提交修改不触碰。正常 push；若 rebase 改写已推送提交则使用固定远端旧 head 的 force-with-lease。

## 证据与备注

历史第 548/992 行失败记录保留在根因文档。本轮 Linux / Node 25.6.0 的 `npm run test:runtime-supervisor-protocol` 退出码为 0；日志 `/tmp/dsc-rpc-race-test-repair-protocol.log` 包含 23/23 请求超时、新 finalizing、协议主脚本、checkpoint、分页和输出信用全部通过。

临时脚本 `.debug/runtime-protocol-race-repair-controls.mjs` 从当前文件抽取同一辅助函数并在内存构建中取消同步关闭准入、绕过 resize 入口检查，两项分别在同步关闭与屏障释放前拒绝断言失败；`/tmp/dsc-rpc-race-test-repair-controls.log` 保留记录。产品源码未变异。语法与 diff 检查通过；未重跑多平台 VS Code。

## 接口与依赖

复用现有 esbuild、Node assert/fs/net 与 node-pty。新增辅助函数 `assertRuntimeSupervisorRejectsResizeDuringFinalization()`，通过现有 server/journal/tracker 构建产物调用，不新增生产测试钩子或协议接口。

2026-10-09：新建修复计划，与已完成的根因调查区分，记录确定性屏障与验收边界。

2026-10-09：完成测试修正、完整门禁与两项变异对照，关闭技术债并归档，历史调查结论不改写。
