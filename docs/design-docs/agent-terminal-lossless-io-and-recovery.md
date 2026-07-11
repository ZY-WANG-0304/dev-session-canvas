---
title: Agent / Terminal 无损输入输出与恢复
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/agent-terminal-lossless-io-redesign.md
  - docs/exec-plans/active/execution-input-responsiveness.md
  - docs/exec-plans/active/runtime-terminal-state-restore.md
updated_at: 2026-07-11
---

# Agent / Terminal 无损输入输出与恢复

## 1. 背景

当前 `Agent` 与 `Terminal` 都通过 PTY 把 provider CLI 或 shell 的终端字节流投影到画布内的 xterm。产品上两者不是同一个对象：`Agent` 是 provider 执行会话窗口，`Terminal` 是终端会话窗口；实现上它们暂时共享大部分输入、输出和终端恢复链路。

2026-06-15 合入的 PR #152 为了解决多 Agent 输出期间的输入卡顿，引入了更严格的 Host/Webview 输出让步、Webview backlog snapshot reset、延迟持久化、snapshot hydrate 调度和 `outputSequence` 边界。后续 PR #176、#203、#229、#236 又分别补充 Host 输出调度、公平性、新鲜度和旧 supervisor 信任边界。2026-07-06 至 2026-07-07，分支 `agent-node-fork-launch-intent` 还追加了四个未合入提交，尝试用 checkpoint + delta 和 degraded transcript 收口恢复问题。

这条演进解决过真实性能问题，但没有形成稳定的内容模型。基线 `origin/main@5355e6a` 仍可能在没有可信 serialized terminal state 时把最后 6000 字符 raw tail 写入空 xterm；未合入方案则先禁止这条 fallback，导致旧 live runtime 大面积空屏，再用净化 transcript 止血。本文同时保留历史诊断，并记录后续选定和实现的第一阶段替代方案。

## 2. 问题定义

本轮需要回答的核心问题不是“阈值改成多少”，而是：

1. PTY 输出、用户可见画面、恢复 checkpoint、历史 transcript 和摘要分别是什么数据，谁拥有它们。
2. 系统如何在不丢弃尚未渲染或尚未投递输出的前提下，为当前输入节点让出调度时间。
3. 一个 revision / sequence 如何证明 checkpoint 已经覆盖某段输出，而不只是数字相等。
4. 输入、ACK、生命周期等控制信号如何不被数据洪峰淹没，同时又不让后台节点永久拿不到输出。
5. local PTY、live runtime reattach、Webview recreate、Extension Host reload 和 supervisor 升级分别能承诺什么恢复语义。
6. Agent 当前复用终端表面时，哪些是终端 transport 事实，哪些是 Agent 产品内容，避免未来继续把两者锁死成同一模型。

### 2.1 已确认的产品与架构约束

2026-07-10，用户确认以下约束；它们不再作为候选方案比较：

1. 同一时刻只有一个节点处于用户输入状态。输入优化应把该节点的输入、控制消息和真实回显设为最高调度优先级，而不是以牺牲其他节点的内容完整性换取手感。
2. live 输出链路不得丢弃任何尚未被消费的增量内容，也不得把 snapshot replacement 当作输入性能优化。后台节点可以延后渲染，但内容必须保序保存并最终交付。
3. Extension Host 与 Webview 都会在 Reload Window 时重建，因此 Host snapshot 不能成为可跨 reload 的 Agent 恢复权威。对于 VS Code 关闭后仍继续运行的 Agent，新 Host 必须重新连接到生命周期更长的执行权威，并恢复 Host 离线期间产生的输出。
4. checkpoint、日志或其他恢复表示的具体格式仍待比较；但权威的生命周期必须覆盖后台 Agent，Host 在这条路径上只能充当转发、缓存和投影协调者，不能用自身快照声明后台输出历史完整。

## 3. 目标

- 给每份内容表示明确唯一职责，不再让 raw tail、serialized state、Webview pending queue 和 transcript 互相冒充。
- live 路径不因输入让步、队列阈值或渲染落后而丢弃增量输出；snapshot 不再承担稳态 backlog replacement。
- 同一执行会话的 revision 只能由一个权威 writer 分配；中间层不得为兼容而无数据推进 revision。
- 当前输入节点的输入、控制消息和回显保持最高优先级；后台输出调度同时具备有界背压、单会话顺序、无损交付和跨会话公平性。
- 可后台运行的 Agent 由生命周期长于 Extension Host 的组件维护恢复事实；Reload Window 是重新连接执行权威，不是从 Host snapshot 猜测恢复。
- local PTY 与 live runtime 的恢复承诺显式分开；旧 supervisor / 旧状态迁移有明确降级和退出条件。
- 通过真实 TUI、真实窗口重建和多节点压力验证内容完整性，而不只验证 helper 形状或 marker 是否出现。

## 4. 非目标

- 本文不决定是否把 Agent 改成 transcript/composer UI；当前正式产品主路径仍是节点内 provider CLI 会话窗口。
- 本文不承诺对任意尺寸变化无损恢复 xterm alternate buffer；该问题仍登记在技术债追踪中。
- 本文不把旧 live runtime 无法重建的历史伪装成可恢复。没有权威 checkpoint 时，可以明确降级，但不能伪造完整终端。
- 本文不把具体 scheduler 常量、缓存上限或序列化格式写成已选定方案。

## 5. 术语与当前内容表示

| 表示 | 当前生产者 | 当前消费者 | 能保证什么 | 不能保证什么 |
| --- | --- | --- | --- | --- |
| PTY raw output | `node-pty` 或 runtime supervisor | Host/supervisor tracker、输出队列 | 按单一生产路径观察到的终端字节流 | 被截断后不能从任意位置重放成终端状态 |
| `ManagedExecutionSession.buffer` / supervisor `output` | Host / supervisor | snapshot fallback、摘要、诊断 | 最近约 6000 字符 | 不保证从 ANSI 序列边界开始，也不保留完整 scrollback |
| `SerializedTerminalState` | Host / supervisor 的 headless xterm tracker | 持久化、snapshot、Webview hydrate | 某次 tracker 序列化时的终端投影 | 当前仅靠外部 sequence 不能自证覆盖了哪些 raw output |
| Host output scheduler entry | `CanvasPanelManager` | Webview message bridge | 合并后准备投递的增量 output | 不是持久化日志，snapshot 前可被清空 |
| Webview `pendingOutput` | `host/executionOutput` 消费端 | xterm drain | Webview 已收到但尚未写入 xterm 的增量 | 达到阈值时会被主动丢弃 |
| Webview live xterm buffer | 用户当前可见 Webview | 用户 | 当前实例真实显示内容 | Webview dispose 后不再存在，也不是宿主持久化真源 |
| sanitized transcript | 未合入提交 `0bcb3b0` | degraded xterm 显示 | 可读的最近纯文本片段 | 不是终端状态，不能承接后续 TUI cursor/mode 语义 |

这里最重要的区别是：raw output 是事件，serialized state 是派生 checkpoint，transcript 是阅读投影，摘要是节点元数据。它们可以来自同一 PTY，但不是同一种内容。

## 6. 历史时间线与问题归因

### 6.1 前置条件：serialized state 早于 PR #152

2026-04-15 的 `bc3e9eb`、`6ec9690`、`489a5f6` 等提交已经用 Host/supervisor headless xterm serialized state 替换单纯 raw tail 恢复。PR #152 没有发明 serialized state；它改变的是使用频率和正确性地位：Webview 在 live 输出 backlog 过大时也可以丢弃增量，再依赖 snapshot 重建当前画面。

因此，不能把所有恢复缺陷都写成 PR #152 新增；更准确的结论是：PR #152 把原本主要发生在 Webview recreate / reattach 的 snapshot 风险带进了稳态高输出路径。

### 6.2 PR #152：从输出让步走到破坏性 snapshot reset

PR #152 共包含五个提交，主要实现提交为 `0d2489a`、`28236cd`、`831562f`。整个 PR 修改 24 个文件，范围同时覆盖输入诊断、输出调度、持久化、snapshot reset、snapshot hydrate、`outputSequence`、runtime supervisor 和终端链接解析。

已证实的正向结果：

- file-link resolver 退出输出热路径。
- `workspaceState.update` 不再在 active session 输出期间形成高频串行慢任务。
- Webview drain 获得全局字符预算、xterm queued-write 背压和 input priority。
- MB 级 raw backlog 不再必须逐字节回放。

PR 内部已经暴露并连续修补的问题：

- 第一版 snapshot reset 请求后，新 output 会在等待 snapshot 期间继续增长到约 5.59 MB；随后才增加 request id、timeout 和 256 KB deferred budget。
- 普通 attach 在同一 mount 中重复请求，4 个 Agent 产生 8 次 snapshot hydrate；随后才增加 attach 去重和全局 hydrate 队列。
- live runtime reattach 后 `outputSequence` 回退到 1/2，而 Webview reset 边界为 3581/6437，形成 timeout/retry/stale loop；`831562f` 才增加 metadata floor 和 `minOutputSequence`。

合入后仍保留的结构性问题：

- `resetBacklogForSnapshot()` 在请求 snapshot 前就清空 Webview `pendingOutput`。当前 `origin/main` 对应 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的该路径仍然先丢内容，再等待替代物。
- snapshot 应用路径在验证 serialized state 是否真的可用之前，就清空 pending output、取消 drain 并推进 `lastAppliedSnapshotSequence`。
- Host `postExecutionSnapshot()` 先清除 Host pending/scheduled output，再 flush tracker 并发 snapshot。只要 tracker 不是可信覆盖源，两个投影层都已失去原增量。
- 为解决序号回退，Host 可以在没有对应新 output 字节时把 `session.outputSequence` 提升到 Webview 的 `minOutputSequence`，并调用 `terminalStateTracker.markOutputSequence()`。这证明 sequence 是可被修账的 bookkeeping，不是内容覆盖证明。

PR #152 最终 review 明确没有运行完整 `npm test` 或 VS Code smoke，且残余风险要求新的真实宿主诊断确认；随后同日进入发布准备。这个事实不证明实现必然错误，但说明最终方案没有在真实多 Agent 生命周期矩阵下完成验收。

### 6.3 PR #176：改善控制消息，但进一步拉大投影时间差

PR #176 的 Host output scheduler 解决了一个真实问题：Host 已快速收到输入并生成 ACK，但大量已 post 的 `host/executionOutput` 仍让 ACK 在 Webview 侧延迟到秒级。普通 output 改为 16 ms tick、每轮至多三个节点；ACK、error、snapshot、exit 和状态消息绕过 scheduler。

这不是已证实的内容丢失 bug，不能把 PR #176 直接写成显示回归。不过它使以下时间点进一步分离：PTY 已产生输出、Host tracker 已消费、Host 已 post、Webview 已收到、Webview xterm 已渲染。snapshot reset 若仍以“Host 有 snapshot”替代内容覆盖证明，就会更频繁成为用户可见收口路径。

PR #176 review 同样明确未在真实多 Agent output flood 场景手动复现；因此它对输入延迟有诊断证据，对输出完整性的影响只有后续现场才能确认。

### 6.4 PR #203：固定预算没有自动带来公平性

PR #203 是 PR #152 合入后的确定性回归修复。Webview 每帧最多处理两个 controller，但已处理且仍有 backlog 的 controller 会先重新插回 `Set`；后续 controller 因而在有限帧内一直轮不到。结果包括：后台 Agent 最终输出长时间不完整，甚至 attention 节点的 final output 和 exit banner 被前置 flood 节点饿死。

修复只调整重新排队顺序：未处理 controller 先于已处理但仍有剩余 output 的 controller。它证明“有预算”与“有公平性”是两个独立不变量；它没有修复 snapshot 可信度、Host scheduler 或恢复完整性。

### 6.5 PR #229：给派生状态加序号，但序号不是内容证明

2026-06-28 至 2026-07-01 的现场显示 raw output / `recentOutput` 已包含最终内容，`serializedTerminalState.data` 却落后。拖动节点只因 TUI 被 resize 后重绘而偶然补齐。PR #229 给 `SerializedTerminalState` 增加 `outputSequence`，并要求 Host/supervisor/Webview 只接受与 snapshot 外层序号一致的 state。

这修复了“缓存明显落后但仍无条件 hydrate”的问题，却没有证明 state 数据真的覆盖 sequence。当前 tracker 是异步批处理缓存；当前 Host 还允许 `markOutputSequence()` 在没有新字节时推进序号。2026-07-02 现场进一步证明，一个从 6000 字符 tail 重建的残缺画面也能被标记成与外层完全一致的 fresh state。

PR #229 首版另有一个 review 阶段 blocker：输出后立即退出时，final `sessionState` 和 registry 没有先 flush tracker，会退化为 6000 字符 tail。该问题在合并前由 `922e9b7` 修复，不属于已发布回归，但说明生命周期边界不能只依赖常规批处理刷新。

### 6.6 PR #236：拒绝伪造 state，暴露恢复源缺失

2026-07-02 的诊断中，三个 snapshot 都被标为 `serializedTerminalStateFresh=true`；其中一个 state 只有 664 字符，数据与 raw tail 都从缺失 `ESC[` 的 `6;2H` 开始。原因是旧 supervisor 只提供末尾 6000 字符，Host 把这段任意截断的 tail 喂给空 headless xterm，再盖上当前 `outputSequence`。

PR #236 增加 `terminalStateTrusted`，禁止旧 supervisor raw tail 继续生成、持久化或回包为 serialized state。这是正确的安全收紧，但没有生成新的可信恢复源；旧会话随后只能继续使用 raw tail fallback。

PR #236 首版在 review 中还会把当前 supervisor 暂时未 flush 的普通 live `sessionState` 误判为不可信，并丢弃既有可信 tracker。`5b7d35b` 在合并前修复为：同一 runtime session 已有可信 tracker 时，暂时 stale 的 lifecycle snapshot 只能更新元数据，不能降级 tracker。该 blocker 同样没有进入 `main`。

### 6.7 2026-07-06 至 2026-07-07：未合入 checkpoint/delta 实验

分支 `agent-node-fork-launch-intent` 在已经合并并关闭的 PR #245 head 上继续追加四个本地提交：

- `7284c16`：记录 checkpoint 恢复架构。
- `3fcd7b5`：禁止 Webview 用 raw tail hydrate xterm。
- `8ce60df`：引入 `TerminalAttachPayload`、checkpoint 与 bounded delta log。
- `0bcb3b0`：在 degraded 时把 raw tail 净化成 transcript 写入 xterm。

GitHub 没有对应的新 PR；远端分支也已删除。因此历史计划中“同一 PR 内阶段性 commit 已收口”的表述不成立，这四个提交应视为未 review、未合入实验。

已由真实诊断证实的问题：

- `3fcd7b5` 的安全护栏会让没有可信 state 的旧会话空屏。
- `8ce60df` 不能为已经运行在旧 supervisor 中的会话补造过去的 checkpoint。2026-07-06 15:43 UTC 的诊断里，48/48 个 execution snapshot 都是 `missing-checkpoint`，0 个带 serialized state；48 个仍有可读 output，41 个为完整 6000 字符 tail。
- `0bcb3b0` 让空屏变成可读文本，但它先 `terminal.reset()`，再把产品提示头和 sanitized text 写进同一个 live xterm。后续 provider TUI 的 cursor movement、alternate-screen 与 mode output 会在这份合成文本状态上继续执行；因此它既不是旁路 transcript，也不是可继续交互的真实终端 checkpoint。

实现中仍待验证的风险：

- Host 与 supervisor 都继续维护 tracker、revision 和 delta，权威 writer 仍不唯一；Host 也保留 `minOutputSequence` 无数据推进逻辑。
- `TerminalAttachPayload` 与既有 `serializedTerminalState` 同时进入 execution metadata，fresh checkpoint 时会重复保存大块 state；payload 还允许最多 2 MB delta。该分支没有记录多 Agent 持久化体积与输入响应基准，可能重新放大 PR #152 曾处理的持久化压力。
- `normalizeTerminalCheckpoint()` 可在 serialized state 缺少自身 `outputSequence` 时用 checkpoint revision 补写；如果 payload 来源本身不可信，这仍是用外层声明替代内容证明。
- 新测试主要覆盖 helper 结构、synthetic marker 和浏览器 harness；没有真实窗口 reload 期间 supervisor 持续输出、旧 supervisor 升级、checkpoint 截断、delta log rollover 和多节点持久化压力的宿主级验证。
- 该分支相对当前 `origin/main` 已落后 30 个提交，还没有适配后续 Webview 模块拆分和本地化主线。

## 7. 当前主线的故障路径

当前 `origin/main` 的关键路径如下：

```text
PTY / provider CLI
  -> Supervisor 或 Host 收到 output，并写 headless tracker
  -> Host 32ms 合并
  -> Host output scheduler 分批 post
  -> Webview pendingOutput
  -> Webview 每帧预算 drain
  -> live xterm
```

同一批 output 还会异步进入节点 metadata、主 snapshot、root-local snapshot 和 supervisor registry。发生 backlog reset 时，路径变成：

```text
Webview pendingOutput 超阈值
  -> 先清空 pendingOutput
  -> 请求 Host snapshot(minOutputSequence)
  -> Host 先清空 pending/scheduled output
  -> 必要时无数据推进 session.outputSequence
  -> flush headless tracker，或退回 metadata/raw tail
  -> Webview 先清空当前恢复队列，再 reset xterm
  -> 写 serialized state；没有可信 state 时写 raw tail
```

这条路径的第一层错误是“先丢旧内容，再验证新内容”；更根本的问题是，输入性能优化根本不应进入内容替换路径。确认后的边界是：

```text
live Webview 落后
  -> 唯一输入节点优先，其他节点有界公平延后
  -> queued/pending output 保序保留，必要时向持久执行权威背压或转存
  -> 最终把每段增量交付给既有 xterm，不触发 snapshot replacement

Webview / Host 重建
  -> 新 Host 连接生命周期更长的执行权威
  -> 从权威 checkpoint 或日志建立一个新的 Webview 投影
  -> 连续补齐权威生成 checkpoint 后和 Host 离线期间的 output
```

当前实现的 `outputSequence` 只能标识观察顺序，不能单独完成“覆盖证明”，因为同一数字可以由 tracker 实际消费 output 得到，也可以由 Host 为兼容直接 `markOutputSequence()` 得到。

## 8. 根因归纳

### 8.1 数据面、控制面和恢复面混在同一套补偿机制中

输入 ACK 慢最初是消息队列调度问题；最终却通过 Host scheduler、Webview scheduler、snapshot reset 和持久化栅栏一起解决。性能优化可以延迟数据面，但不应自动触发破坏性恢复；恢复正确性也不应依赖不断调整输出阈值。

### 8.2 派生状态被当成独立事实源

headless xterm serialized state 是 PTY stream 在某组尺寸和终端模式下的派生 checkpoint。只有“同一 authority、同一 revision、原子生成、连续增量”才能用它重建新的 Webview 投影。它不能替代既有 live 投影尚未消费的增量；当前实现只检查数字相等，且数字可被修账。

### 8.3 多个组件同时修正同一 revision

Supervisor、Host、持久化 metadata 和 Webview 都维护或推进 `outputSequence`。reattach 时使用 floor 能避免数字回退，却也隐藏了内容实际缺失。revision 应描述权威日志位置，而不是各层为了通过 stale check 协商出的最大值。

### 8.4 降级表现替代了恢复目标

raw tail 原样 hydrate 会产生残缺 ANSI 画面；完全拒绝会空屏；sanitized transcript 可读但不是终端状态。三者都是不同程度的降级，不应被包装成“终端恢复已完成”。如果产品要展示 transcript，它应是明确的只读投影，不应污染后续 live xterm 状态。

### 8.5 缺少升级与所有权迁移策略

新 Host 无法为旧 supervisor 已运行会话补造完整 checkpoint。新协议必须说明旧 session 是继续保留旧 Webview、强制重启、历史降级，还是等待自然结束；不能只把协议字段设为 optional，再假设兼容成立。

### 8.6 验证按补丁拆分，没有覆盖完整生命周期矩阵

历史测试分别证明过输入不卡、scheduler 选择、controller 公平、state sequence 相等、delta 连续和 transcript 可读，但缺少一条同时覆盖真实 PTY/TUI、多节点 flood、Webview recreate、Host reload、supervisor reattach、会话立即退出和旧版本迁移的端到端链路。

## 9. 已确认方向与待比较实现

无损 live 调度和 Host 非恢复权威已经确认；本节只比较满足这些约束的实现机制。

### 9.1 单前台优先级的无损 live 调度

同一时刻唯一处于输入状态的节点具有最高优先级。其输入、ACK、生命周期控制消息和真实回显优先推进；其他节点按有界公平顺序消费。coalescing 只能合并相邻字节而不改变内容和顺序，背压只能延迟、上游限流或转存，不能清空尚未消费的 Host/Webview 队列，也不能触发 snapshot replacement。

待比较点：优先级队列与轮转调度如何组合、Host/Webview 各自缓存上限、Webview bridge 拥塞时采用内存队列还是可恢复 spool，以及如何定义逐 revision ACK。

### 9.2 生命周期长于 Host 的 Agent 恢复权威

对于可在 VS Code 关闭后继续运行的 Agent，runtime supervisor 或同等生命周期的持久执行服务负责分配 revision，并持有能覆盖后台运行期间的恢复数据。Extension Host 重新启动后按 session/authority/revision 重新连接并转发，不能用重建前的 Host snapshot 补写 freshness。Webview recreate/reattach 是从该权威创建新投影，不是替换 live backlog。

待比较点：权威保存完整 append-only output journal、terminal checkpoint + 无损 delta，还是两者组合；checkpoint 生成成本、日志轮转、持久化体积、进程升级和断线重连协议也仍需验证。local Terminal 不跨 Host 存活，其恢复承诺应单独设计，不能反向降低 Agent 的语义。

### 9.3 终端状态与 Agent 可读内容分层

Terminal 继续以 xterm state 为主；Agent 同时保留 provider PTY 和独立的结构化/只读活动投影。Agent 可读内容不从截断 PTY tail 反推，优先使用 provider 结构化事件；PTY 仍承担真实交互和兼容 TUI。

待验证点：Codex / Claude Code 可用结构化接口、双投影一致性、是否符合当前节点内 CLI 主交互产品边界。

### 9.4 已选定的第一阶段路线

第一轮受控验证以“持久执行权威维护 terminal checkpoint + 无损 journal”为首选路线。这里的 journal 是按 session 保序记录的 output、resize 与 scrollback 事件序列，不是最近 6000 字符 tail；checkpoint 是同一权威 headless xterm 在明确 revision 上原子生成的终端投影。首选路线如下：

```text
Runtime Supervisor / persistent backend
  - 持有 PTY 与 session registry
  - 在实际收到 output / resize 时推进 revision
  - 以相同顺序更新 headless xterm
  - 原子生成 checkpoint C
  - 保留 C 之后的无损 journal
          |
          | attach: checkpoint C + events C+1...R + live from R+1
          v
Extension Host
  - 发现和连接 session
  - 转发、优先级调度与流量控制
  - 不生成第二套 revision 或 terminal state authority
          |
          v
Webview xterm
  - 新建显示投影
  - hydrate checkpoint、连续应用 events、回报 applied revision
```

attach 必须在同一 authority 内完成原子切点：返回 checkpoint 与历史事件时，新的 live output 要么已经包含在截止 revision `R` 内，要么从 `R + 1` 开始进入 live stream，不能落在两者之间。Host/Webview 活着时仍走无损 live 增量，不因已有 checkpoint 清空 backlog；只有 Webview 或 Host 已经重建、旧投影不存在时，才使用 checkpoint 创建新投影。

journal 不能因为达到内存阈值直接丢弃。第一阶段完整保留从 session 创建开始的 journal，checkpoint 只作为恢复加速缓存；本阶段不做 compact。后续只有在新的 checkpoint 已原子提交、产品承诺范围内的 scrollback/content 已被覆盖、上一代恢复数据仍可回退且受控验证通过后，才能另行设计 compact。

## 10. 正式方案

### 10.1 适用范围

本阶段覆盖 `live-runtime` Agent / Terminal 的 supervisor 输出权威、完整事件 journal、checkpoint cache 和 Host 重新附着。local PTY 仍由 Extension Host 持有，其生命周期与恢复承诺不在本阶段改写。输入调度继续遵守“唯一输入节点优先且不丢其他节点内容”的硬性边界；本阶段不会用 checkpoint 替换既有 live Webview backlog。

### 10.2 唯一 authority 与 revision

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 为每个新 live-runtime session 创建稳定 `authorityId`。同一 session 的 output、resize 与 scrollback 变化都由 supervisor 按一个连续 revision 序列记录；只有 supervisor 在实际接收事件时能推进 revision。`CanvasPanelManager` 与 Webview 只能验证、转发、排队和回报 applied revision，不得再用 metadata floor、`minOutputSequence` 或无数据 `markOutputSequence()` 提高 supervisor revision。

新协议字段保持可选，以便识别旧 supervisor。缺少 authority/journal capability 的旧会话继续走明确的 legacy/历史恢复路径，但不能把 6000 字符 tail 升级成新 checkpoint，也不能为它补造过去的 journal。

### 10.3 完整、分段、可校验 journal

`extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts` 在 supervisor storage 下为每个 session 建立独立目录、原子 manifest 和 NDJSON segment。journal record 至少包含 session、authority、revision、事件类型、事件数据、前一 record checksum 与当前 checksum；事件类型覆盖 output、resize 和 scrollback。segment 可以轮转，但第一阶段不得删除或截断已经完成的 segment，只有用户显式删除 session 时才能删除整份 journal。

append 在内存中同步分配 revision 并进入单 writer 队列，磁盘写入按序批处理，避免在 PTY output callback 中做每 chunk `fsync`。registry 写入、final session state 与 supervisor 正常退出边界必须先 flush journal；写盘失败必须保留错误并让后续 flush fail closed，不能静默继续声称内容已持久化。读取时按 manifest、segment 字节数、连续 revision 与 checksum chain 校验；损坏记录不能被跳过后继续伪装成完整历史。

### 10.4 checkpoint 只是 cache

`SerializedTerminalStateTracker` 仍在 supervisor 内消费与 journal 相同顺序的事件。supervisor 在明确 revision 上生成包含 cols、rows、scrollback、format 与 serialized state 的 checkpoint，并把它写入 supervisor registry。checkpoint 不删除任何 journal segment，也不改变 journal 的权威地位。

checkpoint 正常时，attach 返回 checkpoint `C`、journal `C+1...R` 和 target revision `R`。checkpoint 缺失、格式不兼容或校验失败时，supervisor 从 journal 起点重建 headless xterm；不能回退到任意 raw tail。checkpoint 是否能在后续阶段接管旧 journal，必须另行验证和决策。

### 10.5 原子 attach 与 live 切换

新 Host 创建或重新附着 session 时先请求静态 attach payload，并要求 supervisor 暂缓该 socket 的 live subscription。Host 建立 runtime binding、保存 authority 并把 checkpoint+journal 交给新 Webview 投影后，再以 `authorityId + afterRevision` 订阅。supervisor 在同一个事件循环切点内读取 `afterRevision+1...R2`、注册 live subscription、按 revision 发送补偿事件，然后才允许后续 live event 继续发送。这样 output 不会落在 attach response 与 Host binding 之间。

Webview 只在新投影 attach 时 reset 并 hydrate checkpoint；随后按序应用 output/resize/scrollback event。已有 live xterm 的 backlog 不因 checkpoint 存在而清空。authority 不匹配、revision gap、重复跨 session 数据或 checkpoint+journal 不连续时必须 fail closed 并重新 attach，不能写 raw tail 或 sanitized transcript 冒充终端状态。

### 10.6 阶段退出条件

本阶段完成必须证明：journal segment 轮转后逐 record 校验通过；checkpoint 缺失时完整 journal 能重建相同 xterm；Host attach 间隙产生的 output 被补偿且只显示一次；Reload Window 期间 Agent 输出连续；Host 不再推进 supervisor revision；旧 supervisor 被明确识别；10 个并发 Agent 的 journal 写入不会破坏当前输入节点响应。compact、永久 transcript 和完整生命周期 retention 不属于本阶段完成条件。

## 11. 正式方案必须满足的不变量

无论最终选择哪条路线，都必须满足：

1. live 路径不得丢弃尚未消费的增量 output；允许延迟和字节等价 coalescing，不允许以 snapshot、raw tail 或 transcript 替代。
2. 唯一处于输入状态的节点获得最高调度优先级；其他 session 仍保持单会话顺序、无损交付和跨会话有界公平。
3. `sessionId + authorityId + revision` 唯一标识一条输出历史；revision 只能由 authority 在实际接收 output 时推进。
4. 可跨 VS Code 生命周期运行的 Agent authority 必须长于 Extension Host；Host/Webview snapshot 只能是缓存或投影，不能证明后台输出完整。
5. Reload Window 后，新 Host 必须从持久执行权威恢复连续历史；Host 离线期间产生的 output 不能形成 gap、重复或跨 session 混入。
6. checkpoint 自身记录覆盖 revision、尺寸、格式和生成 authority；消费者不能补写 freshness，checkpoint 也不能用于清空 live backlog。
7. transcript、摘要和诊断永远不 hydrate 成可继续交互的 terminal state。
8. 会话退出前必须生成覆盖 final revision 的可恢复表示，并保留产品承诺范围内的完整 scrollback/content。
9. 旧 supervisor / 旧 snapshot 的升级行为必须用户可解释，且不能伪造 live 或完整恢复；Agent 与 local Terminal 的恢复承诺分别定义。
10. 所有队列、日志和持久化预算按节点数做总量验证，不能用达到上限后丢内容作为容量策略。

## 12. 验证方法

设计选择前应先建立可重复失败基线：

- 用真实 headless xterm 证明从 ANSI/UTF 边界中间截断的 6000 字符 tail 不能恢复原画面。
- 用当前 `origin/main` 复现 replacement snapshot 不可信时，Webview/Host 已先清空待处理 output。
- 用多 controller 压力证明唯一输入节点的输入、ACK 和真实回显优先，同时逐字节核对所有后台节点最终 output 无缺失、无重复且顺序正确。
- 在 Host 完全退出期间让 persistent Agent 持续输出，重建 Host/Webview 后核对离线区间和重连区间形成一条连续 revision 历史。
- 用 output 后立即 exit 验证 final checkpoint 覆盖 final revision。
- 用旧 supervisor registry 验证升级后不会伪造 checkpoint，并明确用户可见降级。
- 用真实 VS Code `trusted` 与 `real-reopen` smoke 覆盖 local PTY、live runtime、Webview recreate、Reload Window 和窗口重开。
- 在至少 10 个并发 Agent、每节点高输出、较大 `terminal.integrated.scrollback` 下记录 Host/Webview CPU、输入 ACK、输出延迟、snapshot/registry 字节数和持久化耗时。
- 对 Codex / Claude Code 的 alternate screen、cursor addressing、OSC、CJK 与 emoji 边界分别保留 fixture。

自动化不能只断言“某个 marker 最终出现”；还要断言未重复、未缺失、顺序正确、旧内容未被未经验证的 snapshot 覆盖、每个 controller 在有界时间内推进。

## 13. 当前结论

历史诊断已确认：

- 输入性能目标只需要提升唯一输入节点的调度优先级，不需要也不允许用丢弃其他节点内容换取响应速度。
- live 增量 output 必须保序、无损并最终交付；snapshot replacement 不再是可接受的稳态性能策略。
- 对可在 VS Code 关闭后继续执行的 Agent，Extension Host snapshot 不是可信恢复源；恢复权威必须覆盖后台 Agent 生命周期，Reload Window 按重新连接而不是 Host 自恢复处理。
- PR #152 是问题的转折点，因为它让 live Webview 可以主动丢弃 backlog，并把 snapshot 从“重建时 fallback”升级为“稳态性能补偿边界”。
- PR #176 解决控制消息排队，但没有让 snapshot 更可信；不能把它单独定性为内容丢失回归。
- PR #203 证明 PR #152 的第一版预算调度缺少跨 controller 公平性。
- PR #229 / #236 逐步拒绝 stale 或伪造 state，但没有给旧会话补上权威恢复源。
- 2026-07-06 至 2026-07-07 的 checkpoint/delta 方向包含正确的不变量雏形，但现有实现没有迁移闭环、单一 authority 和完整宿主级验证；degraded transcript 只是止血，不是终端恢复。
- 基线 `origin/main@5355e6a` 仍保留 raw tail hydrate fallback；它是本分支要替换的基线行为，不是新方案的事实源。

2026-07-11 已完成用户指定的前三项实现：

- Runtime Supervisor 为新 `live-runtime` session 分配稳定 `authorityId`，并为 output、resize、scrollback 统一分配连续 revision。Host 对 authority session 不再使用 metadata floor 或 Webview `minOutputSequence` 推进 revision。
- `terminalSessionJournal.ts` 以每 session 独立目录、原子 manifest、分段 NDJSON 和 checksum chain 完整保存所有事件。checkpoint 释放的只是已覆盖事件的内存副本；磁盘 segment 只在显式删除 session 时删除。
- supervisor registry 保存 checkpoint cache；checkpoint 缺失时从 journal 起点重建，journal checksum/revision 损坏时拒绝 raw-tail fallback，并进入明确错误态。checkpoint 超过当前 serialized-state 格式上限时保留上一 checkpoint 与其后的完整事件，不 compact journal。
- create/attach 使用静态 payload 与 `subscribeSession(afterRevision)` 两阶段切换。deferred attach revision 在订阅完成前被 pin，避免并发 checkpoint 刷新提前释放补偿区间；同一 socket 的旧订阅会先撤销。
- Host/Webview 以 authority 和 revision range 校验 coalesced output，在 resize/scrollback 前 flush 旧 output；gap 或 authority 变化会 fail closed 并重新 attach。Webview 已删除 backlog 阈值触发的 snapshot replacement，健康 live backlog 不再被 checkpoint 清空。

当前自动化已证明：segment 轮转、完整重开、stale manifest 修复、最后不完整 record 截断、checksum 损坏 fail closed；checkpoint 缺失后的全 journal 重建；attach 间隙事件无缺失且只发送一次；checkpoint geometry 与 tracker flush 使用同一切点；final/registry checkpoint 覆盖 final revision；Webview checkpoint+journal 顺序 hydrate、live revision gap 恢复、健康/结束态 snapshot 不替换既有 backlog；真实 `trusted` Reload Window 与 `real-reopen` 均通过。

以下仍未写成已完成结论：

- Host 为 Webview recreate 缓存的 `terminalStream.events` 只会在收到新的 supervisor lifecycle snapshot 时换成较新 checkpoint；纯输出、长时间无生命周期变化的会话仍可能让这份 Host 内存缓存持续增长。磁盘 journal 与 supervisor 内存已受 checkpoint 控制，但 Host 还需要专门的 checkpoint refresh/ACK 协议。
- 旧 supervisor 没有 authority/journal 时仍只具备 legacy 保证；显式只读降级、升级迁移和旧 raw-tail UI 的最终退出策略尚未完成。
- 10 个并发 Agent 的总量/输入延迟基准、alternate screen、OSC、CJK/emoji 边界与长期 retention 仍需单独验证；不能用当前定向测试代替这些容量结论。
- local PTY 的独立恢复语义、journal compact、永久 transcript 与 Agent 结构化内容投影不属于本次前三项实现。
