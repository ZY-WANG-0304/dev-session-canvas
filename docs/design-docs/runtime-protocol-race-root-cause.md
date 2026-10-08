---
title: Supervisor 协议回归两处时序失败的根因
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域]
architecture_layers: [适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-protocol-race-root-cause.md, docs/exec-plans/completed/runtime-protocol-race-test-repair.md]
updated_at: 2026-10-09
---

# Supervisor 协议回归两处时序失败的根因

## 背景

PR #306 从 `96c1e5db` rebase 至 `7a95b6ba` 后，`scripts/test/test-runtime-supervisor-protocol.mjs` 先后在第 548 行订阅 revision 比较、第 992 行终态 resize 拒绝断言失败。随后主线 `9e6243c9` 和分支都曾完整通过。本轮应用户要求确认根因，保留历史失败，不以复跑通过宣布修复。

## 正式方案

两处失败均已确认存在**测试同步前提缺失**：原等待条件不保证测试所声称的阶段已发生。相同实际 Supervisor 可以在合法事件顺序下触发原断言失败。诊断使用真实 socket、真实 node-pty 和原 Supervisor 方法，分别记录和控制 marker 产生、订阅边界、退出通知及 resize 到达顺序。以下结论针对这两个具名断言，不泛化为所有运行时行为无缺陷。

### 1. 订阅用例把输入回显当作目标输出已经产生

`scripts/test/test-runtime-supervisor-protocol.mjs:486` 发送 `trigger\n`，随后只等 registry 的 `terminalRevision > attachGapSnapshot.terminalRevision`。终端的输入回显 `trigger\r\n` 已能推进 journal revision，Node 子进程尚未输出 `gapMarker` 时该条件就成立。后面的 checkpoint 推进也可能只覆盖回显。

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 的 `subscribeSessionAtSettledRevision()` 回放当前已存在的事件，然后建立 live 订阅。回放与后续 live 输出使用同一种 `sessionTerminalEvent` 消息。测试的 marker 查找没有约束它属于回放阶段：marker 可能在订阅之后才产生，此时其 revision 大于 `subscribeResult.revision` 完全符合协议。第 548 行把这个 live 事件误当成 attach gap 回放事件，因而失败。

真实 PTY 的受控对照在 PR 与主线均得到以下结果；门控只改变子进程何时输出 marker，不修改输入回显或服务端：

| 顺序 | registry 已有内容 / revision | checkpoint revision | 订阅返回 revision | marker revision | 原比较 |
| --- | --- | --- | --- | --- | --- |
| marker 在订阅后放行 | `trigger\r\n` / 1 | 1 | 1 | 2 | false |
| marker 在订阅前放行并确认 | `trigger\r\n` / 1（最初等待点） | 1 | 2 | 2 | true |

两种情况的实际回放区间均连续且没有重复。这证明缺的是“指定 marker 已经进入 journal”的前置证据，不能据此归因 Supervisor 回放乱序或遗漏。

### 2. 终态用例把输出加 25ms 当作退出通知已经到达

`scripts/test/test-runtime-supervisor-protocol.mjs:916` 的子进程先写 2 MiB 输出和尾部 marker，再安排 5ms 后退出。测试看到 marker 后固定等待 25ms 就发送 resize，要求返回 `SESSION_NOT_LIVE`。输出到达、子进程执行退出、PTY 退出回调传给 Supervisor 是独立事件；5ms 与 25ms 没有建立这条先后保证。

`runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 在收到 `onExit` 时同步关闭 `terminalMutationAdmissionOpen`，再进入 `finalizeSession()`。`resizeSession()` 通过 `requireLiveSession()` 检查这个事实，未收到退出通知且准入仍开放时可以接受 resize。依赖 `node_modules/node-pty/lib/unixTerminal.js` 的退出实现还会等待 PTY close 后再发 exit；源码本身也不承诺输出后 25ms 内送达。不能把该源码中的 200ms 关闭后备 timer 当作这次实测延迟的具体原因。

未增加任何退出门控的原输入场景直接复现失败：PR 诊断运行在看到 marker 后 **27ms** 收到 resize，记录 `live=true, admission=true` 并成功返回；真实 `onExit` 到 **639ms** 才到达。退出后再次发送的独立 resize 返回 `SESSION_NOT_LIVE`。主线自然对照则在 **13ms** 收到退出回调、**28ms** 收到 resize，原断言通过。两种结果取决于事件先后，固定 sleep 无法区分。

正向控制在真实退出回调关闭准入后暂时挂起最终收尾：resize 到达时 `live=true, admission=false`，最终状态尚未发布，仍正确返回 `SESSION_NOT_LIVE`。这验证了真正进入 finalizing 阶段的拒绝边界。

另一个明确标记的人为控制延后了已经到达的 PTY exit 回调交付，原 resize 断言失败，底层返回 `ioctl(2) failed, EBADF`，释放回调后返回 `SESSION_NOT_LIVE`。它仅用于区分 OS 资源状态与 Host 已观察状态，不能把该人为扩大窗口下的错误追认为原历史运行实际返回的错误，也不在本轮据此宣布新的产品缺陷。

### 3. 与 F-01 的关系

这两个用例通过 `sendRuntimeSupervisorRawRequest()` 直接写 socket，不经过 `RuntimeSupervisorClient`。诊断 Supervisor 构建的输入清单也断言不包含 `runtimeSupervisorClient.ts`。主线和 PR 的 Supervisor 实现、原协议测试文件完全相同；共享协议差异只增加请求超时错误标识及格式化分支，没有改变上述输出、订阅和退出路径。主线受控对照复现相同的失败/成功分界。

因此已确认的根因是测试缺少因果同步，不是 F-01 的请求 deadline 或自动重发行为。不同运行负载可以改变两种时序出现的机会，但本轮不以概率或运行快慢代替该结论，也不需要改超时值解决这两个断言。

## 测试修正方案与交付边界

根因调查阶段只交付诊断与归因，未修改原测试。后续按用户“进行修正”的要求实施以下测试修正；产品代码和 F-01 超时契约保持不变。

订阅用例在订阅前等待 registry 的 `output.includes(gapMarker)` 且 revision 已推进，同时保持回放连续、无重复和 marker 恰好一次的断言。单纯等 revision 增长或延长 sleep 都不能建立该前提。

退出用例分开验证两个责任：真实 PTY 场景等待完整非 live 终态，核验尾部完整与终态后的 resize 拒绝；“已收到退出通知、最终状态尚未发布”的中间阶段，在同一协议测试脚本新增确定性服务端测试。该测试使用实际 `RuntimeSupervisorServer.bindSessionProcess()`、`finalizeSession()`、journal 和 tracker；可控 process 回调先交付尾部输出再交付 exit，Promise 屏障挂在实际 `terminalOperationChain` 上。屏障未释放时检查 live 仍为 true、准入已关闭、终态未发布，并要求一次 resize 立即返回 `SESSION_NOT_LIVE`。释放屏障后检查尾部完整、终态只发布一次、尺寸和 journal 没有被 resize 改写。仅替换外部 process/socket 和后台调度，不替换被测收尾、快照及准入逻辑。scrollback/output 发布顺序另作独立断言。

只等待最终状态不能冒称覆盖 finalizing 窗口，也不反复发送 resize 直到某次被拒绝。上述修正已实现并通过完整协议门禁，技术债收口；历史根因证据保留。

### 修正验证（2026-10-09）

Linux / Node 25.6.0 下 `npm run test:runtime-supervisor-protocol` 完整通过：请求超时 23/23、新的确定性 finalizing 测试、真实 PTY 协议主脚本、checkpoint refresh、分页投影、completed history、paged completion、Host output credit 与 terminal available credit。日志为 `/tmp/dsc-rpc-race-test-repair-protocol.log`，不是此前失败后的复跑记录。

临时内存构建做两项反向控制，不修改工作树产品源码：移除退出回调及 finalizeSession 两处同步关闭准入，新测试在“Exit must synchronously close mutation admission”失败；让 resize 跳过入口准入检查，新测试在“Resize must reject before finalization settles”失败，未靠释放屏障后的结果冒充及时拒绝。控制脚本从当前测试文件抽取同一辅助函数，记录为 `/tmp/dsc-rpc-race-test-repair-controls.log`；两项变异均被捕获。测试中的 1 秒界限仅防止坏实现使门禁悬挂，不用于判断退出阶段。

本轮只修改测试与文档，无新增生产接口；未重新执行多平台真实 VS Code smoke。历史诊断及失败日志继续作为根因证据。

## 验证证据及适用范围

运行 `node scripts/diagnostics/diagnose-runtime-protocol-races.mjs [证据目录]`，需要仓库已执行 `npm ci`。它运行五个有限场景：marker 在订阅后/前、无退出门控的原输入、延后 exit 回调交付、关闭准入后挂起最终收尾。每轮都验证原布尔断言和真实回包，原自然时序可以成功或失败；其余受控场景验证确定的边界，不要求靠概率复现。

2026-10-09，Linux / Node 25.6.0：PR `7a95b6ba` 与主线 `9e6243c9` 各完成 5/5 场景；没有调用真实用户会话。原始证据分别在 `.debug/runtime-protocol-races/`、`.debug/runtime-protocol-races-main/`，各含 `summary.json`、`server.ndjson`、`wire.json` 和构建 `inputs.json`。两处历史失败日志仍保留 `/tmp/dsc-rpc-rebase-protocol.log`、`/tmp/dsc-rpc-rebase-protocol-rerun.log`；历史运行没有完整时序 trace，因此不能补造其精确延迟和实际 resize 回包。当前结论由同一代码的机制复现及反向控制支撑。

诊断结束清理子进程、socket 和临时 storage。原始日志留在忽略目录，本文保存关键数值和因果链，不上传环境变量。未重跑多平台 VS Code 或把 legacy node-pty 证据泛化到 native execution owner。
