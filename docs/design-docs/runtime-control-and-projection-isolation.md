---
title: 运行时控制面、显示投影与恢复隔离
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-recovery-projection-isolation.md
  - docs/exec-plans/completed/runtime-supervisor-reboot-recovery.md
  - docs/exec-plans/completed/runtime-supervisor-dead-pty-bounded-recovery.md
  - docs/exec-plans/completed/terminal-checkpoint-input-responsiveness.md
updated_at: 2026-08-12
---

# 运行时控制面、显示投影与恢复隔离

## 1. 背景

PR #255 建立了 live terminal 的 Supervisor authority、revision、checkpoint 和无损 journal；PR #272--#278 又尝试处理 Supervisor restart、dead PTY、显式 Resume、恢复提示和 checkpoint 拒绝时的输入响应。这些工作保留了无损历史、错误来源区分和显式 Resume 等重要不变量，但把三种本质不同的事件接入了同一条“大 snapshot + 全局恢复”路径：Supervisor 进程变化、Extension Host / Webview 重建，以及健康节点的普通输入。

结果是，旧 PTY 已经无法重附着时，新 Supervisor仍恢复整个 registry namespace；健康 Window reload会重复物化完整历史；健康 Agent 按 Enter时，Supervisor会先发布带完整 terminal suffix的 session snapshot，再真正写 PTY。completed history还被内联进整张 Canvas state，使新建节点、Note 编辑和普通状态持久化的成本随无关 terminal history增长。

本文取代 `docs/design-docs/runtime-supervisor-recovery-readiness.md` 中的 namespace recovery结论，并修正 `docs/design-docs/agent-terminal-lossless-io-and-recovery.md` 中 monolithic attach、健康 session snapshot广播和 completed history内联的传输/存储形态。它不推翻 Supervisor作为 live terminal history authority、连续 revision、无损 journal、checkpoint eligibility、显式 provider Resume或旧 Supervisor真实 live进程并行 drain。

## 2. 问题定义

需要同时回答五个问题：

1. Supervisor restart时，既然新进程无法取得旧 PTY master，哪些数据仍值得恢复，哪些工作必须退出启动关键路径。
2. Reload Window时，真实 PTY仍存活而只丢失 Host/Webview投影，怎样恢复完整历史而不阻塞整张画布。
3. 健康输入、resize、stop和生命周期事件怎样避免与历史 payload共享同步构造、解析和响应边界。
4. completed history怎样继续满足完整性承诺，却不参与每次 Canvas clone、hash、stringify、持久化和广播。
5. 多节点同时需要恢复时，怎样让选中节点优先，又避免后台节点饿死或无限并发压垮 Supervisor、Host和Webview。

## 3. 目标

- Supervisor restart后立即服务新会话；旧 dead PTY不建立 namespace恢复队列或 ready barrier。
- Agent凭可信 provider session identity提供显式 Resume；Terminal提供 Restart/history；可选画面缺失不阻塞动作。
- Reload Window最终恢复 retention/scrollback规则本应保留的完整 terminal历史，不因性能优化额外裁剪。
- 每个节点独立、分块、边接收边显示；selected和viewport-visible节点优先，后台节点有界公平推进。
- 健康 input/control不构造、不等待、不解析完整 terminal history；生命周期反馈不携带 terminal stream。
- completed terminal history外置保存，Canvas state和普通Webview广播只携带轻量引用。
- lifecycle、runtime attachment和Webview projection成为三个正交状态维度。

## 4. 非目标

- 不复活Supervisor restart前已经失去authority的PTY，也不把journal replay称为进程恢复。
- 不为dead PTY承诺mandatory screen snapshot、recent output或完整历史浏览器。
- 不通过recent tail、文本去重、截断journal或降低用户既有scrollback配置来换取性能。
- 不把`projectionState`写入workspace Canvas state、Supervisor registry或跨surface共享事实。
- 不在本文预设bulk stream并发数、chunk字节数和权重常量；这些值由容量基准决定。
- 不改变snapshot-only local PTY现有最低恢复承诺；其跨Host生命周期语义仍独立设计。

## 5. 候选方案

### 5.1 保留namespace recovery并继续优化snapshot大小

该方案可以继续压缩dead session snapshot或给journal扫描增加预算，但不能恢复旧PTY authority。它仍要求每次Supervisor启动枚举旧session、维护全局phase并让Host区分“尚未hydrate”和“真正不存在”，因此不选。

### 5.2 Host直接读取journal并向Webview分块发送

该方案表面上省去Supervisor bulk协议，但Host将同时承担journal格式兼容、checksum、compaction retention、checkpoint producer profile和revision pin。它破坏Supervisor唯一authority，也让Remote/升级边界依赖共享文件布局，因此不选。

### 5.3 同一socket中把现有attach JSON切成小消息

该方案能降低单个frame大小，却不能隔离control和bulk的socket读写、JSON parser和事件循环head-of-line blocking。它可作为短期兼容桥，但不能作为最终控制面隔离，因此不选为正式终态。

### 5.4 独立control与multiplexed bulk projection连接

该方案让input/resize/stop/lifecycle只走小消息；checkpoint/journal在另一个连接上按credit懒读取、分块和取消。多个节点共享少量bulk stream并在chunk边界调度。它保留Supervisor authority，也能为Host/Webview提供真实backpressure，因此选定。

## 6. 风险与取舍

- 独立bulk协议增加跨Supervisor版本兼容成本。迁移期保留capability-gated monolithic attach，只用于旧代真实live session；当前generation新会话必须走新协议。
- `Restoring`期间禁止当前节点普通输入，会暂时牺牲交互可用性，但避免输入已进入PTY、回显却仍在尚未追平稳定head的显示投影之后。只禁该节点且不缓存按键；其他节点和紧急控制不受影响。
- completed archive引入Canvas snapshot与blob之间的durable barrier。迁移必须先写archive、校验成功，再更新轻量ref；失败时保留旧内联数据，宁可重复占用空间也不能丢唯一副本。
- weighted round-robin只能保证scheduler admission公平，不能承诺任意机器上的固定墙钟完成时间。测试同时验证无饿死、无重复、无缺失和交互延迟分位数。
- 新Supervisor不读旧journal会留下orphan数据。retention/GC是独立治理问题，不得重新进入startup关键路径；在策略确认前保守保留。

## 7. 正式方案

### 7.1 场景语义

| 场景 | runtime事实 | 内容处理 | 用户状态与动作 |
| --- | --- | --- | --- |
| Webview隐藏后再次显示 | Host、Supervisor、PTY和原xterm均存活 | non-destructive redraw，不attach、不replay | 保持真实lifecycle |
| Webview dispose/recreate或Reload Window，Supervisor instance相同 | PTY authority仍存活，只丢失新surface投影 | 每节点从初始target开始分块恢复；target与pin随head单调扩展，追到稳定head后原子接live | `attachment=attached-live`；当前surface节点保持`projection=restoring`，稳定head handoff完成后才转`ready` |
| Reload Window，snapshot-only PTY随Host死亡 | 原PTY不可重附着 | 只显示已有持久化内容，不补造live事实 | Agent按可信identity Resume；Terminal Restart/history |
| Supervisor instance改变或旧socket不可达 | 旧PTY authority已经丢失 | 不恢复registry runtime，不扫描journal；snapshot/recent output可选显示 | Agent `resume-ready`且只由按钮启动；Terminal closed/history + Restart |
| 正常completed session | 已有合法finalization和完整final stream | 写入独立immutable archive，按需分块投影 | 保持completed/closed，可Resume或新开 |
| 升级时旧Supervisor仍可达且持有PTY | 旧进程仍是该会话authority | capability-gated继续attach和交互，直到自然drain | 不强杀、不迁移PTY；新会话进入当前generation |

这里的“完整历史”指产品retention和`terminal.integrated.scrollback`规则本应保留的内容，不等于无限期永久transcript。性能实现不能在这些规则之外再裁剪。

### 7.2 数据所有权

`CanvasPrototypeState`只保存节点、边、布局、bounded runtime descriptor、Agent Resume identity和completed history轻量引用。runtime descriptor至少包含`runtimeSessionId`、backend/storage identity和`supervisorInstanceId`；Resume identity至少包含provider、resume strategy、`resumeSessionId`以及provider确实需要的可信locator。

Runtime Supervisor control plane拥有input、resize、stop/delete、lifecycle、session/authority和Supervisor instance identity。projection plane拥有live checkpoint、journal、可单调扩展的revision pin/target，以及稳定head之后的新live event。它们可由同一个Supervisor server实现，但必须使用独立connection和独立message预算。

completed history由Extension storage中的immutable archive拥有。节点metadata只保存archive id、codec、authority/final revision、字节数和完整性校验等轻量descriptor。archive不进入`CanvasPrototypeState`的普通deep clone/hash/pretty stringify，不进入bootstrap或`host/stateUpdated`。

Webview拥有surface-local controller、xterm、hydrate cursor和`projectionState`。editor与panel可以对同一节点处于不同projection进度；Host不得把其中一个surface的ready写成全局节点事实。

### 7.3 正交状态

生命周期继续使用Agent的`waiting-input/running/resume-ready/...`和Terminal的`live/closed/...`。attachment描述Host是否绑定真实PTY authority，例如`reattaching | attached-live | history-restored | unavailable`。projection只描述一个surface上的显示构建：

    queued | restoring | ready | failed

因此同一节点可以合法地同时是：

    lifecycle = waiting-input
    attachment = attached-live
    projection(panel,node,generation) = restoring

这不是“待恢复runtime”。UI在当前节点projection未ready时以`Restoring`作为临时主反馈，保留真实lifecycle作为底层事实；投影完成后恢复显示真实lifecycle。queued/restoring不接收、不缓存普通按键，避免在用户还看不到目标revision之后的PTY echo时执行输入。Stop/Kill等紧急control始终可用。

### 7.4 Supervisor instance与dead PTY判定

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`在每次进程启动时生成不可复用的`supervisorInstanceId`，通过hello返回。`CanvasPanelManager.ts`把该值写入节点bounded runtime descriptor。Window/Host重建后，只有descriptor identity与当前hello一致才进入control attach。

instance不一致时，Host不调用旧session attach，也不等待namespace ready。Agent若有可信Resume identity，直接转`resume-ready`；Terminal转closed/history。legacy节点缺instance id时允许一次兼容attach：成功则补写identity，明确not found/transport不可达则按dead PTY收口，不能无限重试。

instance比较不能只发生在Host取得client时。`runtimeSupervisorClient.ts`为每个既有session RPC签发一次性admission，固定当前`socket generation + supervisorInstanceId`；Client在真正`socket.write`前消费并校验，带token的请求不执行reconnect或restart。input、resize、scrollback、stop、delete、attach、subscribe、applied-revision ACK和projection refresh都必须走该边界；只有Create、用户显式Resume和Restart允许启动Supervisor。每个socket还捕获自己的instance identity，旧socket的disconnect先完成Host通知再允许新socket attach，Host只降级identity匹配的session。

新协议Supervisor使用每进程UUID。旧Supervisor没有该capability时，Client仅在迁移窗口用hello PID合成`legacy-pid:<pid>`；legacy attach成功后立即持久化该effective identity。PID复用是旧binary drain期间的有限风险，不能作为新协议的正式identity方案。

新Supervisor启动只恢复服务自身所需的小型instance/control配置。它不逐session打开journal、不逐segment执行`stat`、不从registry构造历史session对象、不发布全局recovery count。旧journal只供后续显式历史工具、审计或配额GC；这些操作不能阻塞hello、create或普通control。

### 7.5 control input和生命周期

`runtimeSupervisorProtocol.ts`中的control request/response必须保持有界。input处理顺序是：校验session/authority、mutation admission和输入策略，直接调用`process.write(data)`，先把不含terminal正文的小型response写入control socket，再发布由这次PTY write触发的compact lifecycle event。input刻意不进入terminal journal operation chain，避免resize/checkpoint/finalization中的大任务重新成为键盘head-of-line barrier；process退出或delete关闭mutation admission后则fail closed。不得在PTY write前调用`toSnapshot()`、`getEventsAfter()`、`buildTerminalStreamAttachPayload()`或逐event `JSON.stringify`诊断。

Host不在RPC开始前乐观写`running`并全画布post。per-node FIFO在请求成功写入固定socket generation后释放，下一条输入不等待上一条response；每条response仍独立观察、诊断和报错。Client在同一parser burst中先解析input response时，必须让response consumer先恢复，再派发随后到达的lifecycle event。control socket是共享lifecycle的唯一Host authority；节点摘要的Canvas persistence与`host/stateUpdated`使用有界异步合并，不能在socket parser内同步完成整画布clone/stringify/write/post。大projection、普通session snapshot或Canvas persistence都不能成为下一输入的前置条件。

### 7.6 轻量attach与分块projection

control attach只返回小型事实：`supervisorInstanceId`、`sessionId`、`live`、`lifecycle`、`authorityId`、geometry/capabilities和当时的revision观察值，并建立只接收compact lifecycle的control subscription；它不为所有节点预先创建projection reader、target或revision pin。只有surface-local调度器真正准入某个节点后，独立bulk connection的open操作才在Supervisor单session operation chain内原子选择checkpoint `C`、初始`targetRevision=R`并建立覆盖该范围的pin。这样后台排队节点不占用reader或长期钉住retention；open时的`R`只是第一段恢复范围，不是ready边界。

Host在独立bulk connection上用`projectionId`打开stream。Supervisor只在收到credit时懒加载checkpoint和journal，发送有界chunk；每个chunk包含session、authority、cursor、revision范围、类型和payload checksum。Host/Webview实际应用并ACK后才返还credit。每当当前target已经全部发送、应用并ACK，下一次read都在同一session operation中读取journal head：若head已经增长，Supervisor先原子、单调扩展pin和`targetRevision`，再让新增区间继续经过完全相同的credit/chunk/Webview ACK路径；该过程重复，不能另起不受credit约束的replay loop。Host把open返回的target视为initial target，并要求后续response target不小于initial target且只单调增加。

只有在某次session operation中确认当前target已经ACK且journal head稳定，Supervisor才在该operation内注册`terminal-stream-v1` live subscription，并先把对应最终target的`done/live` response写入socket，再允许后续PTY event作为live tail发布。bulk client启用deferred session-event callbacks：parser即使在同一burst读到response和紧随其后的event，也先恢复response promise及Host ready continuation，再派发event callback。surface确认最终target已应用并处理完成response后才转`ready`、开放输入，因此真正的tail不会在该surface ready之前进入显示处理。cancel或socket断开会释放reader、pin和socket-local cursor；当前协议没有跨bulk断线的已确认cursor续传，Coordinator会令该job失败，后续重试重新open并选择新的checkpoint/initial target。

显示顺序是checkpoint `C`，然后从`C+1`到不断单调扩展的当前target。Webview收到chunk即hydrate/显示，不等待完整节点或整张画布，也无需最新screen优先或完整hydrate后的原子reveal。禁止在`done/live`之后再独立重放`R+1...head`：完成后的新事件才是live tail。多surface共用bulk transport时，某个ready surface的subscription event可能被同socket上仍在opening/restoring的其他surface观察到；这些non-ready observation一律丢弃，不按surface暂存，也不复制payload，因为各自的follow stream会通过target/pin扩展吸收对应revision。完成response经过Supervisor response-before-event与bulk client deferred callback双重顺序屏障后，ready surface才开始按`max(final target,last live revision)+1`接收真正tail；不高于floor的重复event忽略，不连续的更高revision fail closed。这既避免了旧512条/4 MiB pending queue的容量与竞态边界，也不会把一个surface的live observation当成另一个surface的projection完成证据。

control attach和control subscription不能各自发送一份完整sessionState；它们只承载compact lifecycle/state catch-up。bulk侧的live subscription只在stable-head handoff中注册，并且只发布最终target之后新发生的event，不负责另一次历史补偿。显式诊断或最终生命周期收口才按需获取对应小型事实或dead/completed fixed projection。

`extensions/vscode/dev-session-canvas/src/panel/executionProjectionCoordinator.ts` 对每个
`(surface,node,controllerGeneration)` 保存独立 job。generation 被替换、surface dispose、节点删除或
materialization 过期时，Host 既按 compact source key 取消，也在已取得 `projectionId` 时发送 server-side
cancel；Webview 在仍处于 `queued/opening`、尚未拿到 `projectionId` 时也发送 node/controller cancel，因而不会
留下等待中的 pin 或 scheduler job。健康 bulk session 结束时，Host 先完成 archive durable barrier，再把尚未
应用到 final revision 的 surface 用同一 controller generation 切换到 archive projection；已经 `ready` 且
`appliedRevision >= finalRevision` 的 surface 只清理 Host transport，保留当前 xterm 显示，不无谓重播整段历史。

### 7.7 多节点调度

每个节点有独立state machine和cursor，多个节点共享有界projection scheduler。优先级固定为selected/focused、viewport-visible、background三档；同档使用weighted round-robin。调度单位是有界chunk，不是完整节点。用户切换选中节点时，新节点在下一个chunk边界抢占；旧节点保留cursor并在后台继续。

active bulk stream数量有限，Host不会同时让所有节点读取journal，Webview也不会同时给所有xterm灌入大块数据。
当前实现的可调默认值是最多 4 个 opening projection（持续有 selected 请求时允许 1 个临时 priority
overflow）、同时最多 2 个 read，以及 64 KiB 的 transport 上限；Webview 默认每次授予 32 KiB credit。
admission 和 read 使用相同的 `8 selected : 3 visible : 1 background` weighted cursor，但各自维护游标，
因此 selected 持续有压力时 background 仍会在一个权重周期内得到机会。具体数值仍需 10 节点与 90,000
行容量基准校准；无论数值如何，selected优先、background无饿死、单节点保序和总量背压是不变量。

### 7.8 completed history archive

正常finalization仍必须得到checkpoint加连续suffix覆盖final revision。新完成会话在打开fixed projection或建立revision pin之前，必须先取得全局archive-store admission；该admission有界，当前正式上限为`1`。等待admission的finalizer不打开projection、不持有pin，也不预读journal。取得admission后，Host把fixed projection chunk直接流式写入canonical临时文件与`projection.ndjson` sidecar临时文件，同时增量维护hash、byte/event/revision统计和连续性校验；完成边界以流式校验、文件stat与物理EOF证明完整，不经过通用projection assembler、完整`TerminalStream`对象、full `Buffer`或`readFile`。

两个临时文件完成写入后依次flush/fsync、close并复核校验，再通过atomic rename提交immutable archive；随后主/root-local Canvas snapshot必须完成轻量ref durable barrier，最后才能解除runtime binding和删除Supervisor journal。failure、cancel或进程中断必须释放reader、pin和store admission，并保留仍完整的Supervisor journal或旧内联payload。该顺序使同时结束的多个大session按archive写入能力排队，而不会让所有finalizer同时钉住journal并在Host内存中组装完整历史。

读取旧版本内联`ExecutionSessionMetadata.terminalStream`时保持兼容。迁移使用copy-on-write：成功提交archive并持久化ref后再移除内联字段。Webview需要显示completed history时走与live projection相同的chunk/credit接口或等价Host archive stream，不通过普通Canvas state广播大blob。

archive 的 canonical `payload.json` 只用于不可变校验与兼容读取；正式 projection 使用同一 archive 目录下的
`projection.ndjson` sidecar，codec 为 `terminal-stream-projection-ndjson-v1`。sidecar 依次包含严格校验的
header、checkpoint 数据片段、按 revision 连续的 output/resize/scrollback 记录和单个 done marker；header
记录 checkpoint revision、serialized-state 元数据、canonical byte length/hash 与 sidecar byte length/hash。
`CompletedTerminalHistoryArchiveProjectionReader` 逐行读取、按 credit 切片并在 done 时验证 offset、revision、
hash、byte length 和物理 EOF；open/read/cancel/error 都在 finally/close barrier 中释放 file descriptor。
旧 canonical-only descriptor 通过幂等 `ensureProjectionSidecar()` 升级，已存在且校验通过的 sidecar 不重写。
首次 legacy inline migration 的 `describeAsync()`、`write()` 和 sidecar materialization 会在大 payload walk 与
分批 hash/写入之间让出 Host event loop；迁移窗口内普通 persist 仍由 gate 合并，失败时保留 inline 副本。

legacy inline与canonical-only archive migration继续使用既有异步materialization路径；它们处理已经存在的完整对象或旧codec，不等同于新完成会话的流式finalization。截至2026-08-12，`CanvasPanelManager.ts`的production completed bulk handoff已改为把lazy fixed projection source交给`CompletedTerminalHistoryArchiveStore.writeProjectionStream(...)`：Store的全局admission上限1先于source `open`，取得admission后才建立reader/pin；每个credit-sized chunk直接进入canonical与sidecar staging writer，增量完成identity、checksum、offset、revision、hash和byte统计，最终执行fsync、物理EOF校验与atomic commit。该路径不再调用通用projection assembler，也不物化完整`TerminalStreamAttachPayload`、full `Buffer`或以`readFile`复核。legacy migration仍保留原有materialization，不应与production finalizer混为一条路径。

当前流式提交在canonical archive已经存在而sidecar缺失时，通过同一archive root内的hard link独占发布sidecar；尚未提供不支持hard link的rename/copy fallback。这是filesystem compatibility残余风险，不改变已验证的本地流式内存边界，但在跨平台完成验证前不能写成全filesystem保证。

legacy inline stream 迁移存在延迟窗口：constructor、surface claim 和普通 Canvas persist 在候选检测完成后只合并待写状态，不在窗口内 clone/hash/stringify 大 payload；archive COW 两阶段写入显式绕过该门禁，迁移 settle 后 flush 最新状态。若迁移失败，inline 副本继续作为恢复副本，不能为了性能提前删除。

Extension storage slot 迁移不能把 archive 根当作普通可替换目录。source/target archive 必须做 content-addressed union：source-only blob 复制到 target，target-only blob 保留，已存在的相同路径逐字节校验，任何类型或内容冲突 fail-closed 且不得覆盖 target。普通 canvas/runtime 快照仍可按 slot 迁移策略替换，但不能删除 immutable archive。

### 7.9 性能与正确性不变量

1. input、resize、stop、kill、hello、create和compact lifecycle响应大小不随journal event数或completed archive字节数增长。
2. 普通Canvas persist、Note更新、节点创建和`host/stateUpdated`不读取、clone、hash或stringifyterminal history blob。
3. live output和reload history不得缺失、重复、乱序或按文本去重；revision/sequence只能由真实event推进。
4. checkpoint是恢复加速cache，不是live backlog replacement；不具备eligibility时保留完整journal并分块重放。
5. control socket不承载bulk checkpoint/journal frame；bulk backpressure不能阻塞control event loop。
6. 任何一个节点projection失败不改变其他节点lifecycle/attachment/projection，也不触发整画布barrier。
7. screen snapshot/recent output缺失不阻塞dead Agent Resume；Resume从不自动触发。
8. queued projection 的取消只需要 node、kind 和 controller generation；拿到 projection identity 后必须额外校验
   session、authority、projection和Supervisor identity。open返回的initial target是下界，read返回的target只能单调扩展；late open/read不得取消同source key的replacement generation。
9. Window reload 的控制 attach 不等待整批节点完成；成功节点以有界 coalescing 的 state update 尽快进入 Webview
   projection，慢节点不能阻塞 selected 或已经 ready 的节点。
10. live follow projection在最终target追平一次session operation内观察到的稳定head之前不得返回`done/live`或转`ready`；所有post-open backlog都必须经过credit/chunk/ACK，禁止独立post-ready replay。
11. 新completed finalizer取得archive-store admission前不得打开projection或持有pin；admission后的内存占用必须受chunk/encoder状态约束，而不能随完整history字节数增长。

## 8. 验证方法

协议测试构造大journal并断言input handler不调用snapshot builder、ACK不含terminal payload、快速输入严格保序、subscribe不重复完整state。Supervisor restart fixture使用新instance和旧registry/journal，断言hello/create立即成功、启动期间journal event读取与逐segment metadata访问为零，并以确定性生命周期测试证明旧Agent只有用户显式Resume才spawn；当前真实reboot smoke只验证Resume action存在且没有自动spawn，不把未执行的按钮点击写成smoke证据。

Playwright创建多个独立controller，验证selected节点在chunk边界抢占、viewport节点先于background、background最终完成、收到首chunk即显示、`Restoring`期间普通input不发送/不缓存、Stop仍发送，以及initial target之后产生的backlog继续受credit/ACK约束、target单调扩展、稳定head的`done/live`之后才转ready且后续live tail连续。Coordinator classifier回归把513个non-ready shared-socket observation全部判为ignore，并验证ready后的duplicate/next/gap边界；Manager回归在restoring期间注入600个event，断言无failure、无surface event、无`pendingLiveEvents`字段，随后只按`state:ready`、`event:601`顺序发送第一条真正tail。

completed archive纯Node测试已证明：不同credit边界下stream writer与legacy writer的descriptor、canonical bytes和sidecar bytes完全一致；全局admission上限为1且第二个source在admit前不会`open`；checksum/revision/EOF/source/commit failure会fail closed、cancel已打开source并清除staging；40 MiB lazy output在`--max-old-space-size=64`子进程中通过peak/retained heap与Buffer门禁。现有回归还覆盖follow target单调扩展与stable-head handoff、sidecar严格reader、异步legacy materialization ticker、coordinator weighted fairness/generation replacement、projection ACK floor、dead-session finalization、queued cancel和non-ready shared-socket observation丢弃。真实`runtime-supervisor-reboot-recovery` smoke证明新Host可启动、Agent显示Resume action且不自动spawn、Terminal保留history，但未点击真实Resume/Restart；`real-reopen` smoke证明same-instance新Webview完整投影、继续输入和离线completed archive恢复。hard-link-only sidecar发布的filesystem兼容、双surface + 90,000行真实GUI、Host/Webview event-loop lag、dynamic credit/并发校准与跨平台容量数字已经转入技术债，不再作为本实现计划的未完成代码项。

容量基准至少记录control ACK、PTY echo、首chunk、完整hydrate、Host event-loop lag、Webview main-thread lag、Canvas snapshot大小、archive大小和各优先级等待时间。测试阈值使用宽于当前可靠样本的回归门禁，不把单机数字写成跨平台SLA。

当前正式方案与本轮代码迁移已经完成；残余容量、GUI和filesystem矩阵已登记到技术债。由于这些外部验证边界仍未关闭，`validation_status`保持“验证中”。
