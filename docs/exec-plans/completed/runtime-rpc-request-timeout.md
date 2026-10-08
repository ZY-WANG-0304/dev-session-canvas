# 修复普通 hello 与 RPC 的请求级等待超时

本 ExecPlan 按 `docs/PLANS.md` 维护，是活文档。

## 目标与全局图景

对端接受连接但不回消息时，Host 应在有限等待后得到明确超时，知道操作结果未知，且不会自动重复创建、输入或删除。严格删除已有有限首次观察及迟到补证保持不变。

## 进度

- [x] 2026-10-08：从最新 origin/main e196d7da 创建独立 worktree 和 runtime-rpc-request-timeout 分支，保留原工作区未提交内容。
- [x] 2026-10-08：定位普通 pending 无 timer、ready 内部 hello 无界及严格删除独立观察，记录正式方案。
- [x] 2026-10-08：实现请求 deadline、清理、错误文案和 ready 剩余预算；首次类型及本地化检查通过。
- [x] 2026-10-08：新增 23/23 回归通过，真实 socket 约 5/5/15 秒有界；reader 31/31、Host 接线 296 项及相关协议链通过。
- [x] 2026-10-08：同步验证证据与技术债，完成交付准备；提交和 PR 关联由 Git 记录。

## 意外与发现

分页投影旧测试以空 options 构造 client，缺少当前必需的 backend，origin/main 同样失败；本轮仅补 `backend: {}`，未改变其禁止重启断言。依赖复用首次失败是旧目录缺固定 serializer patch，独立 npm ci 后执行所有正式验证。

严格删除的 `first` 已在 deadline 返回 unconfirmed，原 pending 继续等待迟到回包以更新 current；不能由普通超时策略破坏此契约。Host 输出消费 catch 会补发 cancellation ack，新增超时必须避免对结果未知的同批 ack 再次提交。

## 决策记录

2026-10-08：普通请求观察 15 秒、hello/连接 5 秒；ready 使用剩余绝对预算。普通到期只清理自己的 pending，hello 到期关闭未握手连接；严格删除已提交项保持独立观察。依据是避免把等待期限当作执行事实，以及保护并发请求和迟到删除证据。正式说明见 `docs/design-docs/runtime-rpc-request-timeout.md`。

## 结果与复盘

F-01 的普通请求等待已有限，独立错误明确结果未知，不自动重发。严格删除现有 first/current 证据契约保持，原 ACK 超时不再补发 cancellation。没有新增已知待修债务；backend 启动/文件系统以及跨平台真实宿主验证不在本次请求等待范围。

## 上下文与定向

Runtime Supervisor 是在 VS Code 宿主外托管终端的进程，Host 通过 socket 发送带 ID 的请求（RPC）并等待同 ID 回包。`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 持有连接和 pending map，`requestOnConnectedSocket()` 是共用发送边界，`performHelloHandshake()` 与 `waitForSupervisorReady()` 管理握手。`deleteSessionStrict()` 提供 first/current 两阶段删除观察。协议错误位于 `src/common/runtimeSupervisorProtocol.ts`，Host 文案位于 `src/panel/runtimeSupervisorLocalization.ts` 和扩展 `l10n/bundle.l10n.zh-cn.json`。

## 工作计划

里程碑一在共用发送边界增加绝对 deadline 与统一 pending 释放，保留严格删除例外；为 hello/ready/连接预算补传递，给超时增加可区分错误及本地化。类型检查可独立验证编译与错误契约。

里程碑二新增 `scripts/test/test-runtime-supervisor-request-timeout.mjs`，用受控时间验证 deadline 到期、回包竞争和清理，用实际 net server 保持连接而不回复验证真实 timer/IO。在 `package.json` 的协议测试链注册；重跑既有 reader 严格删除与输出信用测试。

里程碑三以测试结果同步设计验证状态、审核 F-01 及技术债，归档本计划。按仓库工作流提交并推送主题分支创建 PR，不执行合并。

## 具体步骤

工作目录为独立 worktree `../runtime-rpc-request-timeout`。运行 `node scripts/test/test-runtime-supervisor-request-timeout.mjs`、`node scripts/test/test-runtime-supervisor-reader-client.mjs`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck` 与 `npm run test:ui-copy-localization`；预期所有定向断言通过，pending 清零且原有严格删除迟到补证通过。原工作区 node_modules 未应用当前固定 serializer 补丁，因此改为在独立 worktree 执行 npm ci，不修改原目录依赖或锁文件。

## 验证与验收

真实 peer 收到 hello 后永不响应时 ensureConnected 有限 reject，两个并发调用一起结束且共享连接状态释放；后续显式连接能成功。普通有副作用请求到期时只有一条请求、错误描述未知，迟到回包不能重写结果。连接/请求成功、服务端错误、写异常、断连、替换和 dispose 后没有遗留 timer。ready 后半段的 hello 只能使用剩余时间。严格删除 first 到期仍为 unconfirmed，迟到回包更新 current 且只发送一次。

## 幂等性与恢复

测试夹具使用临时 socket，finally 关闭 server/client 并删除临时目录，可以重复运行。不会自动重发业务 RPC 或取消远端操作。原工作区内容保持原位。

## 证据与备注

基线 e196d7da 的 client 配同一新增 writeInput 测试时失败（pending.size 为 1，期望 0），修后通过。真实 socket 分别 5014/5006/15005ms；新增 23/23、reader 31/31、Host 接线 296 项通过。协议主脚本及 checkpoint refresh、terminal paged projection、completed history、paged completion、Host output credit、terminal available credit 均逐项运行通过；typecheck、本地化及 diff 检查通过。

本地证据在 `/tmp/dsc-rpc-before.log`、`/tmp/dsc-rpc-after.log`、`/tmp/dsc-rpc-timeout-tests.log`、`/tmp/dsc-rpc-reader-tests.log`、`/tmp/dsc-rpc-host-wiring.log`、`/tmp/dsc-rpc-protocol.log`、`/tmp/dsc-rpc-projection-fixed.log`、`/tmp/dsc-rpc-output-credit.log`。

## 接口与依赖

复用 Node net、timer、performance 单调时钟以及现有协议错误机制，不新增运行时依赖。增加 `clientRequestTimeout` 错误，发送边界 deadline 与 pending 释放为私有实现；严格删除 public 返回类型不变。

2026-10-08：初版计划记录 F-01 的边界、实现路径和验证要求，避免普通超时破坏严格删除证据。

2026-10-08：完成请求等待、失败清理、严格删除和 ACK 回归，记录修前/修后证据及旧夹具最小修正，归档计划。
