---
title: Runtime Supervisor 日志按需读取与有界事件缓存
decision_status: 已选定
validation_status: 验证中
domains:
  - 执行编排域
architecture_layers:
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-journal-bounded-cache.md
updated_at: 2026-09-17
---

# Runtime Supervisor 日志按需读取与有界事件缓存

## 背景与取舍

这是 F-04 的第二个实施增量。checkpoint 独立刷新消除了周期全后缀重传，但拒绝 checkpoint 时，已写入 journal 的事件仍全部留在 Supervisor 内存。可靠保留日志与缓存驻留不应共享同一释放条件。

本次选择复用现有 journal 做按需校验读取，而不是另建归档目录、放宽 checkpoint eligibility 或直接替换 xterm 状态模型。它降低 Supervisor 的长期事件数据占用，保持当前恢复表示和正常 completed 行为。它不是 S2 状态同步方案，也不解决 Host 缓存、完整 wire v1 响应、总恢复时间或 F-05；不以“不承诺崩溃恢复”为理由删除运行中内容。

## 正式方案

### 缓存与存储分离

`extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts` 的事件缓存设为 1 MiB JSON UTF-8 编码字节和 2048 条事件的双重上限。追加和 open 后只保留满足预算的最近连续后缀，超大单事件可以完全不进入缓存。`releaseMemoryThrough()` 仍允许提前释放已覆盖内容，但不再是唯一释放入口。缓存淘汰不删除 journal、不更改 retained revision、不推进 ACK，也不改变 checkpoint/compact 的安全条件。

尚未落盘的数据仍在现有 pending/write chain 中。读取首先等待写入；任何写失败都拒绝读取，不返回空事件假装成功。缓存预算不涵盖 pending/write chain、xterm、段索引、一次性完整响应和其他进程，也不是实际 RSS 上限。

### 可验证的按需读取

异步 `readEventPagesAfter()` 以开始迭代时 head 为固定上界，返回连续 output/resize/scrollback。页默认限制为 256 KiB 事件数组 JSON 编码字节和 256 个事件；单条大事件独占一页，不拆 revision。`getEventsAfter()` 聚合这些页，为当前完整 stream 协议提供兼容入口。

从内存取得完整所需范围时使用缓存，否则读取相交的磁盘段。段的 start/end revision、字节数和首尾 checksum 在开始迭代时冻结；checksum 索引来自本进程实际写入或 open 时的原有完整验证，不从未经校验的文件头推导。完整段通过 session/authority、连续 revision、逐条 checksum 链及末尾锚点验证后，才能返回其中事件。文件读取固定在记录的字节前缀，新增垃圾或并发追加不得扩大读取分配；临时内存受段大小和一页约束，默认段 4 MiB，原有单条超大事件例外。索引空间仍随段数增长，不声称全部内存与历史无关。

读取期间 pin 住日志段，禁止 compact/delete；正常追加允许进行，但新数据不越过本次冻结的 head。成功、失败和取消迭代都必须解除 pin。生产路径继续由 Supervisor 每会话操作队列串行读写；journal 的防护防止其他调用者提前删除正在读取的来源。

删除开始后不允许新读取、追加或 checkpoint 提交，成功删除后同一对象不可重新写入；重复删除幂等。订阅 gap 与随后状态快照都校验成功后才启用订阅和发送数据，避免读取异常留下部分激活的订阅。

Supervisor 的实际 journal 删除、订阅移除和 session map 移除也必须完整进入 `terminalOperationChain`。先排队的读取在删除前完成，先前已接受的重复删除在首个完成后直接返回成功；不能只串行生成删除前快照、再在队列外移除文件。该边界由真实协议并发读取/双删除回归覆盖。

### 接线与兼容

`src/supervisor/runtimeSupervisorMain.ts` 的完整 projection 构建改为异步，在既有 `terminalOperationChain` 中调用。显式恢复、订阅 gap 和正常终态均返回原有完整后缀，不依赖缓存命中。普通生命周期通知也排入该队列；已经终止或删除的普通通知跳过，由 finalization 负责发布唯一正常终态，避免异步读取在删除之后重建历史。错误通知不依赖失败的 journal。

不新增 RPC capability、不改变已保存 canvas/manifest/checkpoint 格式，不改旧 live session 的 runtime 地址。新 Host 与旧 Supervisor 的上一阶段兼容路径保持，Supervisor crash/机器重启后的恢复仍非产品保证；现有可读历史不主动清除。

## 验证与剩余边界

journal 的缓存淘汰前后读取必须逐事件相同。测试覆盖分页、跨段、固定 head、缓存 miss、超大记录、文件截断/身份/校验损坏、写失败及读期间删除保护。真实 PTY 和 VS Code 场景覆盖输出超过缓存、checkpoint 拒绝、deferred attach、Host reload、live 尾部及正常 completed。

容量诊断同时报告累计可读历史、事件缓存条数/字节、完整 snapshot 与 completed 文件字节。三阶段缓存不得超过预算，完整恢复仍等于累计事件；不把编码字节当作堆占用。当前 open/compact/recovery candidate 的全量扫描、Host 后缀、完整响应与 pending 队列仍属于 F-04 后续边界，F-05 和 root/runtime 归属另行推进。实际结果由关联 ExecPlan 回写。

2026-09-17 验证：同一拒绝 checkpoint 负载的累计 output 从 6.55 MB 增至 19.66 MB，事件缓存保持 99 条、约 1.046 MB，最终 1921 条事件全部恢复。journal 故障/并发测试、真实 Agent/Terminal PTY 各 18000 行重连及正常退出、Linux VS Code 1.117.0 的 Host reload/实际渲染/completed 与旧 Supervisor 升级 smoke 通过。未覆盖全平台、端到端峰值内存或长期压力，验证状态保持“验证中”。
