# Runtime Persistence 第二阶段：日志按需读取与有界事件缓存

本 ExecPlan 按 `docs/PLANS.md` 维护。它承接已完成的 checkpoint 独立刷新，覆盖 F-04 中 Supervisor 长期持有完整后缀的问题，不表示整个 Runtime Persistence 重构完成。

## 目标与全局图景

Supervisor 是拥有原终端进程的后台进程；journal 是已经存在的按顺序保存 output、resize、scrollback 的文件日志；checkpoint 是经过验证、可以重建终端的快照。当前只要 checkpoint 一直被拒绝，Supervisor 就会把全部后缀一直留在内存，即使同一内容已经写进日志。本阶段使事件缓存有独立预算，缓存之外的恢复材料按需从既有日志读取，且必须验证会话身份、顺序和校验和。

用户能够继续重开原会话，正常结束后仍有完整历史。以持续颜色状态拒绝 checkpoint 的同一诊断负载验收：历史从约 6 MiB 增长到 19 MiB 时，事件缓存不超过 1 MiB 编码数据及 2048 条事件，完整恢复仍返回全部连续事件。预算不是实际 RSS，也不包括待写数据、终端模型、索引、完整恢复响应及 Host 缓存。本轮不改变磁盘保留策略、不新增 server 或归档目录、不放宽 checkpoint eligibility；Supervisor 崩溃/机器重启不要求恢复的产品边界保持。

## 进度

- [x] (2026-09-17) 核对现有 journal、快照、订阅、生命周期通知和 completed handoff；确认当前分支干净且上一阶段已提交。
- [x] (2026-09-17) 选定本阶段范围、缓存预算与失败边界，登记正式设计。
- [x] (2026-09-17) 实现按需校验读取、有限事件缓存，接入 Supervisor 的恢复和生命周期通知。
- [x] (2026-09-17) 缓存淘汰、跨段分页、损坏、并发边界与真实 Agent/Terminal PTY 大输出重连及正常结束测试通过；容量诊断的缓存保持约 1 MiB。
- [x] (2026-09-17) 构建和 Linux VS Code 1.117.0 组合 smoke 通过，18000 行历史在 Host reload 和 completed 后完整，旧 Supervisor 升级兼容通过。
- [x] (2026-09-17) 最终边界复核补齐队列内删除与并发删除回归，重新通过协议、类型检查和构建后的组合 smoke；同步正式文档、技术债并归档本阶段计划。

## 意外与发现

`toSnapshot()` 不仅用于恢复，也在普通生命周期通知中同步构建完整 stream。因此不能只改 journal 的淘汰策略，否则会把合法历史误判为不可恢复。本阶段需要把完整 projection 构建统一为异步读取，并让普通状态通知在既有会话操作队列中执行。正常终态仍由 finalization 队列内的完整 snapshot 发布，排队的普通通知不得在终态或删除之后再次发送过期状态。

当前 open、checkpoint 提交验证和恢复候选仍有全量扫描，Host 和 wire v1 也需要完整 stream。本阶段明确只限制长期事件缓存，不能把内部分页称为端到端分页或恢复时间有界。

固定前缀读取需要冻结段末 checksum，而不能直接信任重读文件的首尾记录。新增测试将内容和自身 checksum 一起改写，reader 必须在返回该段第一页前拒绝；单纯重算逐条 checksum 不能通过 writer anchor 校验。新增删除 guard 同时阻止删除开始后的新读取/追加，取消分页迭代会释放 compact pin。

边界复核发现原 `deleteSession()` 只把终态构建放进 session 队列，实际文件清理在队列外。启用异步读取后，并发的第二次删除会在 journal 已开始删除时构建自己的快照。新增真实协议断言在修复前稳定返回 `Terminal journal is being deleted or has been deleted for session evicted-journal-terminal.`；清理和 map 移除全部收进同一队列，并使已经排队的重复删除在首个完成后直接成功，测试恢复通过。此修正是按需读取成立所必需的顺序保护，不另设已接受风险。

## 决策记录

2026-09-17 / Codex：复用已有 journal，不新增另一份历史存储。采用 1 MiB JSON UTF-8 字节和 2048 条事件的双重缓存预算，缓存淘汰不删除磁盘记录，也不推进消费者水位。未落盘事件仍由既有 pending/write chain 持有，读取先等写入完成；写失败必须报错，不能把缓存缺失当作空后缀。

2026-09-17 / Codex：读取以开始迭代时的 head 为固定上界；使用每段首尾 checksum 的内存索引验证完整段后才返回其事件，不把未经完整锚定验证的事件发给调用方。读取期间禁止 compact/delete，允许追加但只读固定前缀。索引由可信写入或现有 open 的全量验证建立，不引入新磁盘格式。

2026-09-17 / Codex：暂不更改 Host/Webview 协议。完整 snapshot 和订阅 gap 通过新的异步 reader 收集同一连续后缀，仍可能有全量临时分配；这属于原 F-04 剩余项。内部分页为后续按需协议提供可验证读取入口，不先宣称 S2 权威状态同步已经选定。

2026-09-17 / Codex：实际 journal 删除、订阅移除与 session map 移除必须在 `terminalOperationChain` 内完成；同一实例的排队重复删除复用已完成结果，不在文件开始删除后再生成终态。回归同时验证先排队的读取完整成功。

## 结果与复盘

本阶段已实现，journal、真实协议、容量和最终构建的真实 VS Code 门禁通过。历史增加不再要求 Supervisor 永久持有全部事件；恢复和正常完成仍读取原有连续 journal。异步读取所需的实际删除串行边界也已通过先失败、修复后通过的并发回归确认。F-04 的 Host 内存、恢复消息/耗时及全量临时分配，以及 F-05 的 completed 内联继续开放，并已回写原技术债，不新增历史存储或清理绕过。所有验证只操作测试生成的临时存储，不连接用户会话。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts` 当前同时持有 `events` 和 `pendingWrites`。`getEventsAfter()` 只读内存，`releaseMemoryThrough()` 依赖已验证 checkpoint，磁盘采用 v1/v2 manifest、带链式 checksum 的 NDJSON segment 和双代 checkpoint。`runtimeSupervisorMain.ts` 用每会话的 `terminalOperationChain` 排序输出、快照、结束和删除；该队列继续是主路径互斥边界。`src/panel/CanvasPanelManager.ts` 和 Webview 的 v1 stream 仍要求完整 checkpoint 加连续事件，本阶段保持该契约。

## 工作计划

### 里程碑一：日志缓存和读取

在 journal 内定义缓存计量与段 checksum 索引，追加/open 时裁剪缓存但不改日志保留边界。增加 `readEventPagesAfter()` 异步迭代器和异步 `getEventsAfter()` 兼容聚合器。页按编码字节和事件数限制，单条超大事件独占一页，不能拆开已有 revision。完整段读取的临时空间受段大小约束（默认 4 MiB，单条超大事件例外）；固定读取长度，不能因文件被追加垃圾而无界读取。缓存计量只报告已缓存事件，不宣称进程总内存。

### 里程碑二：接入 Supervisor

在会话操作队列内异步构建完整 stream；显式 snapshot、deferred subscribe gap、终态 handoff 都必须等待正确后缀。普通生命周期通知也在队列内构建，跳过已正常终止/删除的排队通知，错误状态不依赖可读 journal。保留旧 RPC 和 metadata 格式；不修改旧会话地址或创建规则。

### 里程碑三：容量与回归

journal 测试覆盖缓存预算、缓存 miss、跨段分页、部分范围、超大单事件、身份/校验错误、读写故障和读取期间 compact/delete 防护。真实 socket/PTY 测试在颜色状态导致 checkpoint 不能推进时生成超过缓存的输出，验证 deferred subscribe、显式恢复、实时尾部和正常结束的完整性。更新现有容量诊断，分别报告累计历史与驻留缓存，不继续把可读历史命名为内存事件。

## 具体步骤

从仓库根目录执行：

    npm run typecheck
    npm run test:terminal-session-journal
    npm run test:runtime-supervisor-protocol
    npm run test:serialized-terminal-state-tracker
    npm run test:execution-output-sequence
    node scripts/diagnostics/audit-runtime-persistence-capacity.mjs
    npm run build
    npm run build:notifier
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-checkpoint-refresh,legacy-supervisor-upgrade node scripts/smoke/run-vscode-smoke.mjs
    git diff --check

smoke 日志写入 `.debug/runtime-journal-bounded-cache-smoke.log`，检查退出码与场景结果。不能把旧阶段的成功记录当作本阶段验证。

## 验证与验收

相同诊断的三阶段 checkpoint 均停在 revision 0，完整 snapshot 与 completed 仍覆盖全部事件；缓存 JSON UTF-8 字节始终不超过 1048576，事件数不超过 2048。小页逐一拼接必须等于原始 output/resize/scrollback 顺序；损坏或缺失文件、错误校验和、写失败不得产生看似成功的短后缀。读取截止 revision 后追加的事件只进入下一次读取。缓存淘汰不影响 deferred attach 和原 PTY identity，正常 completed 仍保留最后 marker。

## 幂等性与恢复

不迁移磁盘格式和路径。现有 manifest、checkpoint generation 与清理规则保持；缓存只是副本，可以随时淘汰。读取/写入错误保持现有 fail-closed 行为，拒绝伪装为成功恢复。读事务在成功、异常或迭代器取消时释放 pin。新旧 Supervisor 沿用各自 storage，回退代码仍能读取原格式。

## 证据与备注

2026-09-17 初轮通过 `typecheck`、`test:terminal-session-journal`、`test:runtime-supervisor-protocol`（含 checkpoint refresh）、`test:serialized-terminal-state-tracker`、`test:execution-output-sequence`、`test:runtime-supervisor-paths`、`test:protocol-webview-messages`、`build` 和 `build:notifier`。

最终复核又通过 `test:webview-build-xterm-entry`、journal、容量诊断，以及并发删除修复后的 `typecheck` / 完整 runtime protocol suite / `build`。最终构建的同一组合 smoke 返回 code 0，新恢复场景和旧 Supervisor 升级均通过，日志位于 `.debug/runtime-journal-bounded-cache-final-smoke.log`。10 份变更 Markdown、4 份设计 frontmatter/索引及关联引用检查通过，`git diff --check` 无错误。本阶段只本地提交，不推送或创建 MR；整体重构尚未结束。

容量诊断中，累计 output 为 6553613 / 13107213 / 19660813 字节；缓存均为 99 个事件，编码字节为 1046034 / 1046133 / 1046133。checkpoint 始终为 revision 0；完整 snapshot 仍为 6763684 / 13526849 / 20290369 字节，最终 1921 个事件全部可恢复。completed 画板仍为 20509666 字节，移动节点后仍重写相同体积。本阶段没有解决这些剩余项，也没有测真实 RSS/OOM 或峰值堆。

新增真实 socket/PTY 场景对 Agent 和 Terminal 各输出 18000 行、超过 1 MiB 缓存，以 OSC 颜色状态保持 checkpoint 不推进，逐事件比较 deferred subscribe 与完整 snapshot，并验证 reattach 后唯一 live tail 和正常结束的 final marker。Linux VS Code 1.117.0 的组合 smoke 返回 code 0；真实 Host reload 前后、正常 completed 内联中均保留全部 18000 行，Webview 实际显示末尾 marker，旧 Supervisor 兼容场景亦通过。日志位于 `.debug/runtime-journal-bounded-cache-smoke.log`。未运行全量 `npm test` 或 macOS/Windows/Remote SSH，不把此结果扩大为全平台/全部容量验收。

## 接口与依赖

复用 Node `fs`、`crypto`、现有 terminal stream 类型和测试 esbuild，无新增依赖。`getEventsAfter(revision)` 改为返回 Promise；`readEventPagesAfter(revision, options)` 提供连续事件页，`getCacheStats()` 报告缓存编码字节、条数及限制。完整 projection 由异步 `buildTerminalStreamAttachPayload()` 构建，所有调用点必须等待它。

修订记录：2026-09-17 创建并完成第二阶段，补齐缓存/读取/清理互斥，记录并发删除的失败与修复证据、容量和最终真实宿主回归，归档计划；端到端容量和归档继续由 F-04/F-05 跟踪。
