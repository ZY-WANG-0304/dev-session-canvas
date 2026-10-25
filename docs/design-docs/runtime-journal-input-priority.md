---
title: Runtime journal 分页的输入优先调度
decision_status: 比较中
validation_status: 未验证
domains:
  - 执行编排域
  - 画布交互域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-journal-input-priority.md
updated_at: 2026-10-25
---

# Runtime journal 分页的输入优先调度

## 1. 背景

RuntimePersistence 的 `terminalPagedReadV1` 用 Supervisor 的 xterm 模型和 journal 恢复、更新 Webview 内的终端。输入仍从 Webview 进入 Host，再写给原 PTY；PTY 回显由 Supervisor 写入 headless xterm 和 journal，Webview 随后按 revision 拉取页面。输入没有本地乐观回显，显示内容仍以真实终端输出为准。

仓库已有一个跨节点交互规则：最近输入的 `kind + nodeId` 获得短时输出优先级，后台节点仍须在有界时间内推进。普通 `host/executionOutput` 路径已接入 Host 和 Webview 输出调度，但当前 journal page 路径没有贯通这条优先级。

本提案基于 2026-10-25 获取的 `origin/main@37ff8554` 源码。它确认了调度路径的差异，不证明这个差异就是某一次用户卡顿的唯一原因；回显端到端时间仍须从真实诊断取得。

## 2. 问题定义

输入派发时，`webview/main.tsx` 的 `reportExecutionInputDispatch()` 记录最近输入节点；Host 收到 `webview/executionInput` 时也记录 `recentExecutionInputPriority`，并立即发送输入 ACK。普通 Host 输出由 `CanvasPanelManager` 的 `selectScheduledExecutionOutputPosts()` 选择最近输入节点；普通 Webview 输出由 `selectExecutionTerminalDrainEntries()` 在 controller 间选择节点。

启用 journal 分页后，路径不同：

1. `webview/terminalPagedProjection.ts` 中的 `TerminalPagedProjection.pull()` 在自身 reader 有新 head 且上一页已应用后，直接发起下一次 page request。每个 reader 一次只有一个页面请求或应用中的页面。
2. `CanvasPanelManager.readExecutionTerminalPage()` 直接调用 `RuntimeTerminalReadRelay.read()` 并向 Webview 返回页面。该路径不经过普通 `host/executionOutput` scheduler。
3. Webview 收到页面后，`main.tsx` 的分页 `events` 回调直接进入该节点的 `queueTerminalWrite()` 和 `applyTerminalStreamEvents()`。页面输出没有进入普通 controller output drain 的 `selectExecutionTerminalDrainEntries()`。

因此，现有规则保证了**一个 reader 内部的顺序、重试游标和应用回执**，但没有在多个 journal reader 之间按最近输入节点仲裁页面应用。需要区分：目前 page read 是按 session 独立发起的异步请求，没有发现所有 session 共享一个按先来先服务的 RPC 队列；“没有 read scheduler”本身不能证明输入节点的 read 会排在其它节点后面。明确缺失的调度点是多个页面进入同一个 Webview/xterm 主线程时，谁先得到应用机会。

```mermaid
sequenceDiagram
    participant W as Webview
    participant H as Host
    participant S as Supervisor
    participant J as Journal

    W->>H: 输入并记录最近输入节点
    H-->>W: 立即发送 input ACK
    H->>S: 写入 PTY
    S->>J: PTY 回显进入 journal 并推进 revision
    S-->>W: 通知 head 有更新
    W->>H: reader 自行请求下一页
    H->>S: 直接 relay 读取
    S-->>W: 返回 journal page
    W->>W: 对应节点直接排入 xterm write chain
```

## 3. 目标

- 在选择调度算法或改运行逻辑前，用同一次实际输入把输入处理、PTY 写入、journal page 读取、Webview xterm 应用和可见绘制阶段分开计时，定位主要等待点。
- 最近接收用户输入的 Agent / Terminal 节点，其已返回 journal 页面优先进入 xterm 应用；其 page read 仍保持现有按 reader 按需发起。
- 保持同一 reader 的 `authorityId + revision` 连续、事件顺序、幂等重试与“应用后才 ACK”语义，不丢弃或重排任何节点内容。
- 在持续输入下为其他节点提供有界公平服务；队列和在途页面的资源上界应明确，不能以无限推迟或清除后台页面换取响应。
- 能从诊断中区分输入回显等待发生在 page 请求、Host/IPC 返回还是 xterm 应用阶段；只有发现共享读取队列后才把 read admission 纳入调度。

## 4. 非目标

- 不改变 Supervisor journal 格式、checkpoint 资格、revision 语义、压缩回收或 RuntimePersistence 的启用策略。
- 不改变输入 RPC、输入 ACK、PTY 写入顺序，也不添加本地 echo。
- 不重构非分页旧 Supervisor 或 `snapshot-only` 输出链路。
- 不因 Webview 不可见、输出过多或读者落后而丢弃 journal 事件、改用不连续快照或伪造已应用 revision。
- 不把最近输入等同于永久焦点状态；本提案沿用 `kind + nodeId` 的最近输入身份。
- 不在没有读阶段排队证据时，为独立 session 的 page RPC 引入一个全局串行队列或任意并发上限。

## 5. 候选方案

### 5.1 Webview 共享页面应用调度器，读取仍按 reader 按需进行（候选）

各 reader 保留现有方式：有新 head、且自身没有未完成页面时，立即从自己的 `afterRevision` 请求一页；不新建跨 session 的全局读队列。页面返回并校验身份后，Webview 不再把整页直接排进该 controller 的 write chain，而交给一个共享 page application scheduler。这里的优先级作用在**已返回页面的应用**，不作用在 page read RPC；若输入节点的页面还没读回来，调度器不能凭空让它先显示。

调度器为每个待应用页面保存 `(authorityId, revision)`、event 游标和当前 output event 的 UTF-16 字符偏移。每一轮只派发一个有界 xterm write quantum，等待对应 xterm write callback 后再重新选 reader。若当前用户最近输入节点有就绪页面，它先拿一个 quantum；若最老后台页面已达到公平等待阈值，则同一轮额外给该后台页面一个 quantum，并在下个选择点重新按等待年龄挑选后台 reader。否则输入优先窗口内暂缓未超时后台页面；窗口外按 ready reader 轮转。输出文本可在 quantum 边界切片，resize / scrollback 等结构事件不可越过之前未写完的文本，也不可相互重排。只有该页全部事件应用成功后，才向原 reader 调用 `applied`，推进 revision 并允许它拉下一页。

建议把现有普通 Webview drain 作为**起始基线**而非已验证值：输入窗口沿用 240ms；输入节点每次最多写入 4 Ki 个 JavaScript UTF-16 code unit；后台等待达到 480ms 后额外获得最多 4 Ki code unit；常规量子先以每 controller 最多 16 Ki code unit 为起点。现有 drain 的普通总预算是每轮最多 32 Ki 字符；是否在共享 page scheduler 中也需要等价总预算，由定向负载验证决定。分页协议的 64 KiB 页预算不是应用 quantum，不能直接拿来当一段不可让出的 `terminal.write()` 大块。480ms 是启动后台服务的年龄阈值，不是 xterm callback 的完成 SLA。所有参数仍待确认，并须通过输入回显与后台完整排空的同负载对照验证。

候选调度轮次如下：

```mermaid
flowchart TD
    A[页面返回并通过 session / authority 校验] --> B[放入共享 ready 集合<br/>记录 revision 与 event / text 游标]
    B --> C[调度轮次开始<br/>此时没有 quantum 在途]
    C --> D{最近输入节点有就绪页?}
    D -- 是 --> E[应用输入节点一个有界 quantum]
    E --> F[等待该 write callback]
    F --> G{最老后台页已到公平阈值?}
    G -- 是 --> H[应用最老后台页一个有界 quantum]
    H --> I[等待该 write callback]
    I --> J{页面是否全部应用?}
    G -- 否 --> J
    D -- 否 --> K{存在达到公平阈值的后台页?}
    K -- 是 --> L[应用最老后台页一个有界 quantum]
    K -- 否 --> M[ready reader 按轮转顺序<br/>应用一个有界 quantum]
    L --> N[等待该 write callback]
    M --> N
    N --> J
    J -- 否 --> C
    J -- 是 --> O[确认 applied revision<br/>reader 才可拉下一页]
```

优点是将优先级放在确有共享竞争的 Webview/xterm 应用边界，同时保留每 session 独立异步读取。限制是已经开始的单个 xterm write 不能抢占；页面消息跨 Webview bridge 的反序列化也没有优先级。每 reader 仍可能持有一页已读未应用的正文，因此总内存按活跃 reader 数增长，不能宣称全局固定上限。

### 5.2 只在 Host 对 page read 排队

Host 收到多个 `readExecutionTerminalPage` 后，用最近输入节点选择要调用的 Supervisor reader，再按选择顺序返回页面。

优点是可复用 Host 已有的最近输入状态，并能减少同时进入 Supervisor/消息桥的读取请求。缺点是页面抵达 Webview 后仍由各 controller 直接排入 xterm write chain，后台大页仍可能先进入 xterm parser 队列；只调请求不能保证当前节点先应用。

### 5.3 Webview 同时调度 page demand 和应用

每个 `TerminalPagedProjection` 将“需要读页”和“收到页面待应用”都交给 Webview 共享调度器；有全局读取并发上限时，调度器才会在发出 page read 前选择 reader。实现还须决定 interactive reader 是否有保留读取名额，否则在途背景读占满全部名额时，当前输入节点仍要等一个读取结束。`CanvasPanelManager` 和 `RuntimeTerminalReadRelay` 可以继续透明转发，不增加协议字段。

该方案可在页面读取阶段和应用阶段执行统一公平策略，也能在将来控制 Host/IPC 读取压力。但当前各 session 的 page RPC 是分开的异步请求，没有发现它们排入一个共享 FIFO；增加全局读取并发限额或保留槽会改变并发模型并可能增加延迟。没有读阶段排队/Host 消息压力的现场证据前，不先采用它。

### 5.4 Host 与 Webview 各放一套独立 page scheduler

Host 调度读取，Webview 再单独调度应用。

该方案控制点最全面，但增加两套队列、两处公平状态和取消/迟到页面协调。若 Webview 统一调度器已控制读取发起与应用，目前没有证据表明 Host 再复制一套调度器有额外收益，因此不作为首选；若验证发现 Host event loop 或消息投递仍是瓶颈，再重新评估。

## 6. 风险与取舍

共享应用调度器需要处理页面响应晚于 reader 替换、输入优先级在写入期间变化、某节点 xterm write 失败，以及同一页含大量 output 和 resize/scrollback 边界等情况。旧 `readId`、Webview generation 或 session 的页面必须按现有身份校验丢弃，不能 ACK；失败重试必须从同一 `afterRevision` 重来。输入 priority 在 callback 边界重新读取；已开始的 write 保持原样结束，不能中途撤销。每个 quantum 都等 callback 再选择会把跨节点应用串行化，可能降低总吞吐；这正是输入响应与总排空速度之间需要实测的取舍。xterm callback 表示该次 write 已处理，不等于浏览器已经完成绘制，所以端到端指标仍要观测真实画面回显。

调度只能重新排序**不同节点**的执行时机，不能改变同节点 revision 顺序。后台公平年龄应以最近一次应用 quantum 为基准，不能因 reader 收到新 head 或当前输入持续刷新而重置。现状是每个可见 reader 最多有一页在途或待应用；聚合正文随活跃 reader 数增长。单页沿用 256 KiB 事件数组 JSON / 256 条预算，但单个大 event 可超过该字节预算；不能把它误称为严格内存上界。

最近输入优先窗口当前在 Webview 为 240ms，在 Host 普通输出调度为 300ms；Webview 普通 drain 对后台项的等待上限为 480ms。推荐先复用 Webview 的最近输入标记和 240ms / 480ms 行为，避免这项改动顺便重新定义输入语义。该时间窗口能否覆盖真实输入到 journal page 应用的延迟尚未验证；若诊断显示回显常在窗口之后到达，应在实现前单独确认优先级保留期限。

## 7. 当前结论

**暂不选择调度算法，也不把方案 5.1 写成确定修复。** 当前源码确认普通 push 和 journal page 应用路径不同，但静态调用链不能说明用户卡顿主要发生在输入写入、Supervisor 产出、Host/read relay、Webview 消息排队、xterm 应用还是画面绘制。应先对原复现场景采集分段数据；如果证据集中在多个已返回页面争用 Webview/xterm，再从 5.1 和各调度算法中选型；如果瓶颈落在其它阶段，设计应转向对应阶段。读页维持 per-reader 按需并行是当前代码发现，不代表显示调度方案已获选择。

以下参数与验收假设须在实现前确认或用具名基准决定：

- 是否沿用 240ms 输入优先窗口和 480ms 后台公平阈值。它们是当前 Webview 普通 drain 的参数，不是 RuntimePersistence 页路径已验证的 SLA。
- page application 是否从现有 drain 量级开始：输入/超时后台各 4 Ki UTF-16 code unit、普通 reader 每次最多 16 Ki、普通轮次是否额外限制总计 32 Ki；它们是候选字符数，不是字节，也没有在 journal page 路径验证。
- callback 串行 quantum 会否损害多 terminal 总吞吐，以及是否需要 requestAnimationFrame / drain-turn 总预算来为浏览器绘制留出机会。write callback 只证明 xterm 处理了该 write，不证明像素已绘制。
- 如果诊断显示 read RPC 或 Host→Webview posting 本身形成共享队列，再为后台读取引入全局并发预算；当前并发模型允许不同 session 独立读，不应先选一个任意数字。

240ms、480ms 与 4/16/32 Ki 字符值只用于理解现有 drain 和制定可比实验，不构成当前方案要求确认的最终参数。先取现场诊断并判定等待阶段，再基于数据提出算法和参数供用户确认；如果需增补 trace，也先呈现字段、采样率、保留上限和内容脱敏方式。当前不改运行时代码，也不宣称静态调度缺口就是现有延迟的根因。

## 8. 成熟依据与复用边界

最直接的项目内对照是已有的 `common/executionOutputScheduler.ts`：它按 `kind + nodeId` 提升最近输入节点，并在后台等待达到阈值后释放最老 controller。`scripts/test/test-execution-output-scheduler.mjs` 覆盖 10 个 Agent 的普通 drain 选择：输入节点优先；连续输入时，9 个等待达到 480ms 的后台 controller 逐个得到额外 drain slot。测试证明现有选择函数的规则，不证明 journal 页应用性能。可用它作为行为基线，但是否沿用该规则到 journal path，应等现场分段数据说明主要瓶颈后再决定。

### 8.1 可选调度算法

这些都是成熟的队列调度方法，但优化目标不同。对比假设“每个 ready reader 可以被切成有限 xterm write quantum”：

| 算法 | 选择规则 | 优点 | 用于当前终端回显的限制 |
| --- | --- | --- | --- |
| Round Robin（RR） | ready reader 逐个获得一个 quantum | 实现简单；在 callback 最终返回的前提下，每个 ready reader 都能轮到 | 所有节点同等优先，不能直接让刚输入节点更快 |
| Weighted Round Robin（WRR / IWRR） | 按配置权重分配 turn，例如输入队列多轮、后台队列一轮 | 服务份额显式；适合想控制交互与后台吞吐比例 | 权重保证的是轮次/份额，不是回显最大延迟；终端处理成本也不一定与字符数成正比 |
| Strict priority + background reservation | 输入节点先服务，同时固定预留每 N 轮或固定比例给后台 | 优先级和后台份额直接、可预测；不依赖等待年龄计算 | 固定预留可能浪费空槽；预留比例需选择，且没单独限制最长连续 write 时仍会卡 |
| Deficit Round Robin（DRR） | 每个 reader 累积 deficit quantum，按字符/字节成本扣减后轮转 | 面向变长数据流的公平带宽份额，常数级队列调度开销 | 保证的是长期输出量公平，不自动保证当前输入回显低延迟或最大等待 |
| Weighted Fair Queueing（WFQ）/ virtual finish time | 按权重和数据量估算每个队列的虚拟完成时间，选最早者 | 比简单 WRR 更平滑地分配不同权重的吞吐 | 需要维护虚拟时间/队列状态；若不另设输入优先类或 deadline，不能保证回显延迟 |
| Earliest Deadline First（EDF） | 先处理截止时间最近的页面/任务 | 有真实 deadline 的实时任务适用，可直接围绕端到端期限优化 | 当前 journal page 没有“这页对应哪次输入回显”的 deadline 字段；Webview/xterm 也不是硬实时执行器，暂时无法据此正确排序 |

当前讨论的就是显示链路上的服务分配：输入链路把按键送入 PTY；PTY 产生的 echo 随后成为终端输出，经过 journal page 读取和 Webview xterm 应用才出现在画面中。因此，在多个输出 reader 竞争 Webview/xterm 时，调度算法分到的显示容量会直接影响当前输入节点 echo 页面排队多久，也影响所有节点的总排空时间。输入 echo latency 与聚合显示吞吐是相关的两项指标，不是互不相干的目标。

当前候选年龄策略可以看作“短时输入 strict priority + 最大后台等待年龄”的组合：近期输入页先取服务机会，后台 reader 到阈值后额外获得一个 quantum。它更直接回应“刚输入节点的显示回显要快，同时后台输出不能饿死”，也复用仓库已有做法；代价是 480ms 只控制调度器何时授予后台机会，不能承诺墙钟完成时间。

RR、WRR、DRR 与 WFQ 都是本显示链路上的有效候选。它们决定 ready reader 如何分享有限的 xterm 应用容量，因而会改变当前输入 echo 页面之前需要等待多少其它输出 quantum，也会改变后台排空分布。DRR / WFQ 单独使用倾向于按配置分配输出吞吐，不会自动识别“最近刚输入”的节点；可组合成“当前输入节点短时优先 + 后台 reader 之间 DRR/WFQ”，再比较输入回显 p50/p95、逐节点显示吞吐与总排空时间。固定 WRR 可作为更简单的比例基线；年龄策略则直接限制后台等待年龄。若要按每次输入给出真正 deadline，还须把输入与对应 echo/page 关联并记录实际显示时刻，当前协议缺少这种对应关系，故 EDF 不宜作为第一版。

### 8.2 外部依据与复用边界

- [Reactive Streams 1.0.4](https://github.com/reactive-streams/reactive-streams-jvm/tree/v1.0.4) 定义基于需求的异步流和非阻塞背压。当前 reader 的“一页在途、应用确认后才请求下一页”是 page 粒度的需求控制；保留它可以避免 reader 不受限制地累计历史页。Reactive Streams 本身不定义当前输入节点优先或多 reader 公平规则。
- Shreedhar 与 Varghese 的 [Deficit Round Robin 公平排队算法](https://doi.org/10.1109/90.502236) 针对不同大小的数据单元提供公平服务，是按 quantum 给多个输出流分配服务的成熟参考。提案没有直接实现 DRR 的 deficit accounting，而采用项目现有“等待年龄达到阈值后释放最老后台项”的规则；两者的共同点是服务需要分段并轮转，不能把本提案称为完整 DRR。
- Parekh 与 Gallager 的 [Generalized Processor Sharing 网络流量控制分析](https://doi.org/10.1109/90.234856) 是 WFQ 一类按权重分享服务的理论依据；它说明权重/虚拟服务份额适合回答吞吐分配问题，但不会自动给本产品一个正确的输入回显 deadline。
- Liu 与 Layland 的 [硬实时多道程序调度分析](https://doi.org/10.1145/321738.321743) 是经典 deadline/实时调度参考。当前 Webview 的事件循环、xterm callback 和显示绘制不构成该论文所需的硬实时执行假设，且页面与特定输入没有可靠关联，因此 EDF 只列为概念候选，不作为当前推荐。

目前没有发现 tmux 或 xterm.js 提供可直接套用的“多终端 journal readers 依当前输入节点优先、同时保障其他节点公平”的现成调度器。RR/WRR/DRR/WFQ/EDF 为成熟算法家族；仓库已有 output scheduler 是最直接的项目内先例。最近输入优先、年龄公平、xterm 写分段和 journal applied ACK 的具体组合仍是本项目策略，必须用本项目负载验证，不能声称已由标准或库证明。

## 9. 定位与数据采集

### 9.1 先采当前已有诊断

在用户观察到卡顿的同一 VS Code 宿主运行 `Dev Session Canvas: 落盘当前宿主诊断`。保存该命令返回目录中的 `execution-performance-diagnostics.json`、`diagnostic-events.json` 和 `summary.json`；后者的 `diagnostics.executionPerformanceSummary` 可快速查看各来源样本数、耗时总量、最大值和慢样本数。必须在短时复现场景结束后立即落盘，因为 Host 与 Webview 都只保留最近 500 个性能样本。性能样本以时序、计数和长度为主，不含终端正文；其它 dump 文件可能含 workspace 路径、node 标识或诊断摘要，分享前应检查并脱敏，不要公开上传完整诊断目录。

先做两组固定条件的短采集：A 为 RuntimePersistence 开启、只有目标 Agent / Terminal 输入；B 为同一节点、同一输入和相同 Webview surface，同时让其它节点持续输出。记录 VS Code / 扩展版本、机器、surface（Panel / Editor）、RuntimePersistence 状态、活跃节点数、后台输出负载和复现步骤。每轮保持这些因素不变，只改变是否有竞争输出；若用户问题只在隐藏切回后出现，则将 visibility 单独设为另一组，不能与背景输出变量混在一轮中。

### 9.2 现有字段能说明什么

- `webview-input-dispatch`、`host-input-received`、`webview-input-ack`、`host-input-write` 可判断输入派发/到 Host/ACK 往返/Host 发往 PTY 的耗时。注意 Host 会在 PTY write 完成前就 ACK；ACK 快只说明输入已被 Host 接纳并回送，不证明程序已经收到或回显。
- `webview-main-thread-lag`、`host-event-loop-lag` 可判断两个事件循环是否明显卡顿。
- 普通 push 的 `host-output-scheduler`、`host-output-post`、`webview-output-enqueue`、`webview-terminal-drain` 可分析普通 output 链；它们不能代表 journal page scheduler，因为当前 page 路径不走普通 output drain。
- `terminal-page-requested`、`terminal-page-received` 与 `webview-terminal-write(reason=paged-events)` 能提供 journal page request、回执和 xterm callback 的部分观察；Host `runtime/terminalPagePosted` 在 `diagnostic-events.json` 中记录 page revision、大小及事件数。

当前记录适合初筛，不能保证完整重建单页时序：page receipt 未携带 `requestId` / `afterRevision` / page revision；Host `readExecutionTerminalPage()` 没有记录 read RPC 开始/结束耗时；page 收到到进入 `writeChain` 的排队时间未单独记录；write callback 不等于浏览器完成绘制。常规诊断会过滤短耗时/小数据样本（Webview 多数默认需达到 24ms 或 32 Ki 字符，drain 默认 16ms；输入统计有 8ms 门槛；page transport 另有限速和小页例外），因此没有样本不等于该阶段没有耗时。

### 9.3 若现有数据不足，补一轮短时关联 trace

只在复现期间开启一个 bounded trace（固定时间窗和样本上限；目标节点 100% 采样，背景节点可限速），不记录输入正文、PTY output 正文或屏幕文本。每条 span 带统一 `traceId`，并至少包含 `surface + kind + nodeId + executionSessionId`；page 阶段增加 `authorityId + readId + requestId + afterRevision + revision`，输入阶段保留现有 `sequence`。把“触发当前输入优先级的 `prioritySequence`”与“输出由这条输入因果产生”分开命名，避免把时间邻近误当成因果。

最小时间点依次为：Webview input dispatch；Host 收到输入与 ACK post；Host→Supervisor input RPC start/end；Supervisor PTY write 完成；Supervisor onData 收到输出并 append journal/revision；page read 在 Host 和 Supervisor 的开始/结束；Host post page；Webview page received/enqueued/write start/write callback；write callback 后第一个 `requestAnimationFrame`；applied ACK 发出/接收。同步相关上下文还应记每节点 ready page 数、待写字符量、最老等待年龄、已选 reader、调度原因、write quantum 字符数和成功/失败。

这能把以下区间分开计算：输入到 Host、Host 写 PTY、PTY output 到 journal、page RPC 往返、page 回到 Webview 后的调度等待、xterm write service、callback 后到绘制机会。实际像素可见时间需由具名 UI probe 或带时间基准的屏幕录制核对；`requestAnimationFrame` 只能说明浏览器得到绘制机会，不等于用户已经看见。

现有 input `sequence` 不会随 PTY output/journal revision 传播，Agent TUI 也可能延迟或改写回显，因此不能仅凭同一节点“输入后紧接页面”断定页面就是这次输入的 echo。应在可控的 Terminal/Agent 场景选一个可识别的测试 marker，通过 UI probe/录屏确认 marker 第一次可见的时刻；诊断仍只记序号、revision 和长度，不落屏幕或终端正文。

### 9.4 分析与选型门槛

按 `(traceId, nodeId, sessionId, requestId, revision)` 排序，并分别计算输入 ACK、Host PTY write、PTY→journal、read RPC、page 回传、page queue wait、xterm write、callback→render opportunity 的 p50/p95/max。再比较输入节点 echo 首次可见时延、各节点 chars/sec、后台最长无服务时间、Webview/Host lag、总排空时间和待处理 page/字符峰值。

若输入与 PTY write 很快、page 已及时回到 Webview，但目标页长期等在 xterm application queue，才有证据优先评估显示 scheduler；若时间消耗在 Supervisor read/Host relay，先分析该阶段是否存在串行化或 IPC 排队；若 callback 很快但绘制机会迟到，则应分析 Webview 主线程/帧调度。拿到这组数据后，再决定年龄阈值、WRR、后台 DRR/WFQ 或其它方案，并以相同输入/输出负载复测。

## 10. 后续实现验证

算法和瓶颈经数据确认、设计得到用户确认后，才实现相应调度器。若选 page application scheduler，先用 Webview 单测注入多个已返回页面的 reader，覆盖输入页面优先、后台公平、同 reader revision 连续、整页应用后 ACK、同游标重试、迟到页面丢弃及 xterm 写失败。每 reader 仍至多一页请求或待应用页面；不新增全局 read in-flight cap。

随后在相同输入/竞争输出负载下复测并逐节点核对完整、无重复、无乱序输出，同时比较输入节点 echo p50/p95、每节点输出吞吐、后台最长等待、总排空时间、页面积压和 Webview main-thread lag。只有用户原复现场景的显示延迟下降且后台服务没有饥饿，才可宣称修复。
