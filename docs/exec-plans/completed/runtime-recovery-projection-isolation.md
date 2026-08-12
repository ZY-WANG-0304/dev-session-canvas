# 隔离运行时控制、显示投影与持久化热路径

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文已归档到 `docs/exec-plans/completed/runtime-recovery-projection-isolation.md`，并按 `docs/PLANS.md` 保留完整实现、验证与残余债务记录。

## 目标与全局图景

本计划修复 PR #272、#276、#277、#278 之后集中暴露的画板卡顿，但不把这些提交整体回滚。完成后，健康 Agent 按 Enter 时，输入会先被 Supervisor 接纳并写入 PTY，不再在写入前同步构造完整 terminal snapshot 或扫描、序列化 journal；新建节点、Note 输入和画布普通状态更新的成本不再随其他节点的多 MiB terminal history 线性增长。

Reload Window 与 Supervisor restart 会成为两个明确不同的流程。若同一 Supervisor 实例和 PTY 仍存活，新的 Webview 为每个节点独立恢复显示投影：bulk open只选择initial target，checkpoint和journal按credit/ACK正序分块，恢复期间增长的head通过target/pin单调扩展继续走同一路径，追平稳定head并原子接上live后才`ready`；选中节点优先，其他节点有界公平推进。当前节点在投影完成前显示`Restoring`并禁用普通输入，其他已就绪节点、Note、新建节点和画布操作不受影响。若Supervisor实例已经变化，则旧PTY已经死亡，新Supervisor不扫描和恢复旧runtime namespace；Agent只凭可信provider identity进入`resume-ready`，用户点击Resume后才创建新的provider PTY，Terminal提供Restart/history。screen snapshot和recent output只是可选帮助，缺失不能阻塞Resume。

用户可以用四个可观察场景验证结果：在一个拥有 90,000 行历史的画布中新建节点和编辑 Note 仍即时；健康 Agent 按 Enter 不先跳到 `running` 再长时间停留在旧画面；Reload Window 时节点各自显示 `Restoring` 并逐块出现完整 retention 范围内的历史；杀死 Supervisor 后重开时新节点立即可创建，旧 Agent 等待显式 Resume，且启动阶段没有全量 journal 扫描。

## 进度

- [x] (2026-08-11 11:40 +0800) 以 `origin/main@b0c61b3a` 为基线创建 `runtime-recovery-projection-isolation` 分支，并保留用户未跟踪文件 `tmp.md` 不动。
- [x] (2026-08-11 11:40 +0800) 复核工作流、产品规格、现有恢复设计、#272/#276/#278 历史计划和关键代码热路径，区分 Supervisor restart、Reload Window、健康输入与 completed history 四类问题。
- [x] (2026-08-11 18:10 +0800) 同步规格、正式设计、设计索引及被取代文档，并把 control/bulk、archive 与 surface-local projection 边界收口为新的文档事实源；本次继续同步 `ARCHITECTURE.md`。
- [x] (2026-08-11 12:05 +0800) 修复健康 input admission：Supervisor先写PTY再发布projection-free lifecycle；Host不再提前推进Supervisor-owned lifecycle，per-node FIFO在socket dispatch后释放而不等待上一response。
- [x] (2026-08-11 12:05 +0800) 删除 recovery progress 的整画布广播与 attach/subscribe 重复完整 history；补compact state投影保留与attach gap恰好一次回放测试。
- [x] (2026-08-11 13:49 +0800) 精确移除误写入工作树的 instance/archive/projection 半成品，保留文档与 P0；重新执行 P0 协议、类型和构建门禁，确认工作树回到可验证检查点。
- [x] (2026-08-11 16:05 +0800) 引入 Supervisor instance identity；实例不匹配时直接收口为 dead PTY 的 Resume/Restart/history，不恢复旧 registry session，不建立 namespace ready barrier；既有 session RPC 以一次性 admission 固定到 socket generation 与 instance。
- [x] (2026-08-11 18:10 +0800) 将 completed terminal history 外置为 immutable content-addressed archive/ref：metadata-only registry persist、正常完成 durable barrier、旧内联数据的延迟 copy-on-write 迁移、按需 archive 读取、live Supervisor payload 清理均已落地。
- [x] (2026-08-11 18:10 +0800) 分离 control attach 与 bulk projection transport：实现 metadata-only attach、revision pin、分块读取、Supervisor credit/backpressure、ACK 后继续、取消、每节点 cursor、identity 校验和 dead/completed fixed projection assembler；live follow 后续已收口为动态target/stable-head handoff，dynamic credit sizing 与更细 scheduler benchmark 仍是技术债。
- [x] (2026-08-11 18:10 +0800) 在 Webview/Host 实现 surface-local `projectionState`、controller generation、queued/restoring 输入 fail-closed、selected/visible/background 优先级和有界公平调度；收到 chunk 即显示，不等待整张画布或整节点 hydrate。
- [x] (2026-08-11 19:05 +0800) 收紧 projection 完成边界：ACK 只使用 projection 自身的 contiguous revision floor，避免 live-tail applied ACK 污染 chunk；Supervisor 返回 `live=false` 的 dead-session fixed projection 直接进入 `ready`，不再在 archive finalization 后重复 subscribe 已删除的 session。
- [x] (2026-08-12 03:24 +0800) 最终收口多surface live event竞态：opening/restoring surface一律丢弃共享bulk socket上的冗余observation，不保留pending payload queue，由自身follow stream的动态target/pin吸收；Supervisor先写stable-head `done/live` response再发布新event，bulk client延后event callback直到Host ready continuation完成，ready后只接受floor+1的真正tail，duplicate忽略、gap fail closed。
- [x] (2026-08-11 20:05 +0800) 修复 legacy inline history 的 reload 热路径：检测迁移候选只读轻量 metadata；constructor、active-surface 和普通 Canvas persist 在 copy-on-write 迁移窗口内合并请求并跳过 clone/hash/stringify，迁移自身显式 bypass，settle 后 flush 最新状态；projection 空 `done` 与不足 target 的终止 ACK fail-closed。
- [x] (2026-08-11 20:15 +0800) 修复 extension storage slot 迁移的 archive 数据风险：immutable content-addressed archive 使用 source/target union 和逐文件校验，不再先删除 target archive；新增 disjoint、相同 blob 与冲突 blob 回归。
- [x] (2026-08-11 23:45 +0800) 完成 projection sidecar 的正式 codec 与 reader：`projection.ndjson` 按 header、checkpoint、output、resize、scrollback、done 顺序编码；reader 严格校验记录形状、范围、offset、revision 连续性、UTF-8/UTF-16 边界、checksum、byte length 和物理 EOF，并在 done/error/cancel 路径关闭文件描述符。
- [x] (2026-08-11 23:45 +0800) 将 archive `describe()` 的大对象工作迁移到可让出事件循环的 `describeAsync()`/分批 materialization；canonical-only descriptor 通过幂等 `ensureProjectionSidecar()` 升级，已有 sidecar 使用快速校验，避免 reload 再次解析完整 canonical JSON。
- [x] (2026-08-11 23:45 +0800) 收口 surface coordinator 的默认资源预算：最多 4 个 opening projection，选中节点持续有请求时允许 1 个 priority overflow，最多 2 个 read，Webview 默认 32 KiB credit，权重 `8 selected : 3 visible : 1 background`；generation replacement、late open/read、queued cancel、terminal ACK/open failure 均会重新 pump 并释放 transport/pin。
- [x] (2026-08-11 23:45 +0800) 完成 completed archive 的 coordinator 投影和渐进式 reload state post：completed 节点不再发送 monolithic Webview snapshot，按同一 chunk/credit/ACK 路径显示；restore 批次以 `setImmediate` 合并 state post，不等待整批 attach，且节点尚无 `projectionId` 时也能按 compact source key 取消。
- [x] (2026-08-12 00:32 +0800) 收口 restore 与 replacement 竞态：restore batch 的失败/instance mismatch 统一安全持久化；coordinator acquisition/open/read 的 stale generation 只清理自身 transport；live identity 变化立即令 Webview 回到 queued，迟到的旧 projection ACK/cancel 不再误杀同 generation 的 archive replacement。
- [x] (2026-08-12 00:32 +0800) 收口 archive/assembler 的 Host event-loop 峰值与 client 生命周期：90,000 小事件使用 async batched normalization、16 KiB 文本聚合和 128 KiB yield；bulk disconnect 只 dispose exact 旧 projection client；fixed assembler 以 parts 累积 checkpoint/output 并只在完成边界合并，不再同步重扫完整 events。
- [x] (2026-08-12 01:10 +0800) 通过真实 `runtime-supervisor-reboot-recovery` 与 `real-reopen` smoke：前者验证 Host 可启动、旧 Agent 暴露显式 Resume action 且不自动 spawn、旧 Terminal 保持 history；该场景未点击真实 Resume/Restart 按钮。后者验证新 Webview 的实际 xterm 按完整 projection 恢复并能继续输入，completed archive 离线恢复通过。
- [x] (2026-08-12 01:35 +0800) 收口fresh create与subscription handoff：Terminal spawn成功后compact create直接为`live`；create/attach先写response再启用control-only catch-up，Client以单轮barrier保证Host先安装binding；同步spawn rejection不会注册幽灵session。
- [x] (2026-08-12 02:39 +0800) 修正live follow完成语义：open只选择initial target和pin；每次当前target ACK后在同一session operation读取head，增长时单调扩展target/pin并继续相同credit/chunk/ACK路径，稳定时原子注册live subscription并返回`done/live`；删除独立、无credit的post-ready replay。Host per-job记录`latestTargetRevision`，response target回落时fail closed并取消projection/pin。
- [x] (2026-08-12 02:53 +0800) 完成completed direct-stream finalization：Store全局admission上限1先于lazy source open/pin；fixed chunks直接写canonical/sidecar staging并增量校验、hash、fsync和atomic commit；Manager production路径不再经过通用assembler、完整`TerminalStream`、full `Buffer`或`readFile`。archive回归已覆盖stream/legacy parity、admission顺序、failure/cancel cleanup与40 MiB bounded-memory gate，typecheck通过。
- [x] (2026-08-12 03:24 +0800) 完成本计划分层验收与归档：最终Manager 600-event和classifier 513-revision回归通过，Runtime Supervisor response-before-event协议通过，build、Agent/Terminal restoring-input + live-ACK Playwright 4/4、`runtime-supervisor-reboot-recovery`与`real-reopen`真实smoke通过；hard-link filesystem矩阵、双surface/90,000行GUI与lag/参数校准、legacy materialization调度已转入技术债，不再作为本计划未完成实现项。

## 意外与发现

- 观察：用户感知到的 Enter 卡顿发生在健康的 `waiting-input + attached-live` Agent，不是待恢复节点。
  证据：`runtimeSupervisorMain.ts` 的 input handler 先设置 `running` 并调用 `emitSessionState()`，`emitSessionState()` 默认通过 `toSnapshot()` 构造 checkpoint 后完整 journal suffix，最后才调用 `process.write(data)`；历史诊断中约 81,000 个 event 时 input 平均 12.13 秒、最大 23.763 秒。

- 观察：#278 的 per-node FIFO 保留了字符顺序，但把队列完成边界放在完整 RPC response 之后，因此会放大同 socket 大 frame 与 parser/event-loop head-of-line blocking。
  证据：`src/common/executionInputQueue.ts` 只有上一 promise resolve 后才发下一项；`runtimeSupervisorClient.ts` 的 request response 与 event 共用一个逐行 JSON socket。

- 观察：一次健康 Window reload 会重复物化终端历史。
  证据：attach 已返回完整 stream，随后 `subscribeSession()` 又补 replay，并发送默认携带完整 suffix 的 `sessionState`；同一历史因此被重复构造、传输、解析和应用。

- 观察：Supervisor restart 的 namespace recovery 不能恢复旧 PTY，却会串行扫描旧 session，并以全局 `recovering -> ready` barrier 延迟 Host 第二轮 attach。
  证据：新 Supervisor 没有旧 `node-pty` master authority；当前 registry 恢复只生成 `live=false` 历史对象，Host 却在 namespace ready 前 defer `sessionNotFound` 并在 ready 后整批重试。

- 观察：画布普通持久化仍把 completed `terminalStream` 内联进节点 metadata，导致 `persistState()` 对每次创建、Note 更新或初始化执行全画布 clone、hash、pretty stringify 和同步文件写入。
  证据：现有 smoke 明确构造并内联大于 5 MiB、90,000 行的 completed stream；创建节点路径在 post Webview state 前先等待 persist。

- 观察：`projectionState` 不能成为 `CanvasPrototypeState` 字段，因为同一逻辑节点可同时被 editor 和 panel 两个 surface 以不同进度投影。
  证据：Webview projection 是否完成取决于本地 xterm write callback 和该 surface 的 applied revision，而生命周期与 runtime attachment 对两个 surface 是共享事实。

- 观察：P0可以把后续input从上一条完整RPC response中解耦，但当前release边界只是“请求已写入`RuntimeSupervisorClient` socket”，不是Supervisor application-level ACK。
  证据：新增client黑盒测试在第一条response被gate时仍观察到第二条request按序到达；清理后重跑10-Agent协议fixture的input response约10.04ms、echo约30.38ms。已经在共享socket上传输/解析的大frame仍可能阻塞第一条input，必须由后续control/bulk连接隔离收口。

- 观察：PTY write提前后，attach-gap测试不能再用“registry revision增长”代替“目标marker已经进入journal”。
  证据：lifecycle compact state可能先触发registry持久化；旧谓词会让订阅先完成，随后把正常live marker误判为replay并比较错误的revision边界。测试现改为同时确认registry recent output包含marker。

- 观察：只在 Host 获取 client 时使用 `allowRestart:false` 仍存在 acquisition 与真正 socket write 之间的断连窗口。
  证据：所有 client RPC 原本都会再次执行默认 `ensureConnected()`；旧 socket 在该窗口关闭时，input、resize、stop、delete、attach、subscribe、ACK 和 projection refresh 仍可能启动替代 Supervisor。Client 现签发只能消费一次的 admission，固定 `socketGeneration + supervisorInstanceId`，带 token 的 RPC 不再执行 reconnect/restart。

- 观察：disconnect 只按 backend 与 storage 分类会把同路径下不同 Supervisor instance 的健康节点一起改成 reattaching。
  证据：Client 现在为每个 socket捕获握手 identity，并用 close barrier保证旧 socket 的 disconnect 通知先于新 socket attach；Host只处理 identity匹配的 session。协议测试同时覆盖断连后不启动替代进程和旧 token跨generation失效。

- 观察：Webview bootstrap/stateUpdated 早已主动剥离 `serializedTerminalState` 与 `terminalStream`，但 root-local 和 extension-storage Canvas snapshot 仍保留 completed payload，且 Supervisor live state sync 仍把 serialized screen 写回内存 Canvas state。
  证据：archive 接入同时停止 Supervisor-owned live metadata 的大投影写回；completed stream 先提交 immutable blob，再持久化 descriptor，最后才解绑并删除 Supervisor session。旧内联历史迁移则先持久化“ref + inline”双副本，再删除 inline，任一步失败均保留可定位的完整副本。

- 观察：metadata-only attach 发现已结束的 bulk session 时，不能直接按“无历史”收口；否则会丢掉 Supervisor 仍可读取的 fixed projection，并遗留 dead registry/journal。
  证据：reload attach 的 compact snapshot 不携带 `terminalStream`，Host 现为该路径创建临时 Supervisor session，复用 fixed projection assembler/finalization；归档成功后才清理 runtime session，失败则保留 `reattaching` 供重试。

- 观察：fixed projection 的完整性不能由 `done` 标志单独证明。
  证据：`terminalProjectionAssembler.ts` 对每个 read response 校验 session/authority/projection/target/Supervisor identity、JSON UTF-8 `payloadBytes`、SHA-256 checksum、checkpoint/output/resize/scrollback revision 连续性和 UTF-16 offset；缺 chunk、gap、live marker、checksum 或 done 不完整均 fail closed。

- 观察：projection 的背压边界必须落在 Webview xterm 消费之后，而不是 Host 读到 chunk 之后。
  证据：Coordinator 保留 per-job transport、credit 和 awaiting ACK；Supervisor 在一个 chunk 的 ACK 前不继续读取，cancel 会释放 server-side pin；Webview controller generation、surface lifecycle 或 identity 失效时丢弃 stale chunk，不把旧内容写入新 Webview。

- 观察：dead-session fixed projection 的最终 `live=false` marker 不是“还需要补一次 control tail”的中间态。
  证据：Supervisor 在返回 `live=false` 前已完成一次 bounded final-head extension、释放 projection pin；随后 archive finalization 可以删除 session。Host 若再调用 `subscribeSession()` 会把完整投影误报为 `sessionNotFound`，因此该 marker 必须直接收口 surface `ready`。

- 观察：projection stream 的 revision floor 与 surface 当前显示的 revision 不是同一个游标。
  证据：同一 Webview 可能在 projection chunk ACK 附近上报更晚的 live-tail `executionTerminalApplied`；ACK coordinator 只能接受已由 projection chunk 连续证明的 floor，surface aggregate revision 则继续独立记录 live tail。

- 观察：多surface共用bulk transport时，restoring projection可能观察到同socket上其他ready subscription的event，但这些frame不是该surface需要缓存的tail；保留pending queue既复制payload，又在超过旧512条上限时制造错误失败。
  证据：最终Host classifier在record尚未ready时无条件返回`ignore`，各surface自己的follow stream通过动态target/pin覆盖这些revision。`test-canvas-execution-context.mjs`向restoring Manager注入600个shared-socket event，断言无failure、无surface输出且record没有`pendingLiveEvents`字段；target推进并ready到600后，revision 601严格按`state:ready`再`event:601`送达。`test-execution-projection-coordinator.mjs`另把revision 1--513全部判为non-ready ignore，并验证ready后的duplicate/next/gap边界。

- 观察：legacy inline history 的 archive 延迟迁移若不同时 gate 所有普通 persist，会在 constructor 或首个 surface claim 中重新触碰多 MiB payload。
  证据：`persistState()` 和直接的 `queuePersistedCanvasSnapshotWrite()` 都会同步 clone/hash/pretty stringify；当前 migration pending gate 在这些入口之前合并普通请求，COW 两阶段写入后再 flush，旧 inline 副本在 durable barrier 前保持不变。

- 观察：projection `done` 不是完整性证据，除非ACK已证明response的最终动态target revision。
  证据：恶意/损坏的空`done` response若直接`max(applied,target)`会让Webview在缺revision时进入ready；Coordinator要求空done的applied floor等于最终target，data-bearing done ACK也必须达到当次target，否则释放pin并fail closed。live follow还必须由Supervisor在同一session operation确认stable head并注册subscription。

- 观察：extension storage slot recovery 不能把 immutable archive 当作普通可替换目录复制。
  证据：source 和 target slot 可能各含不同 archive blob，先 `rmSync(target)` 会删掉仍被 root-local descriptor 引用的 target-only 内容；迁移现递归 union，已存在文件逐块校验，冲突停止且不覆盖 target。

- 观察：`waiting-input` / `attached-live` 与 Webview `restoring` 可以同时成立，不能把 projection 恢复误归因成 runtime 恢复。
  证据：projection phase 只存在于 surface-local registry；键盘、paste、image-paste、drop 在 queued/restoring 阶段都 fail closed 且不缓存，Stop/Kill 仍走 control path，其他 ready surface 和普通画布操作不受阻塞。

- 观察：已有 canonical archive 的 sidecar 升级如果每次都重新读取并解析 `payload.json`，会把 completed history 重新带回 reload 热路径。
  证据：`ensureProjectionSidecar()` 现对已有 sidecar 只做 canonical 文件大小和 sidecar 分块完整性校验；只有缺失或旧 descriptor 才读取 canonical payload 并重建 sidecar。

- 观察：archive reader 的“读完自动 close”和 coordinator 的“ready 后关闭 transport”必须是幂等的两个边界。
  证据：reader 在验证 done、byte length、hash 和 EOF 后立即关闭自身 FD；Host transport 的 close/cancel 仍在 `finally` 调用，重复 close 不会影响后续 job，也不会留下可用 pin。

- 观察：调度器的 opening slot 与 read slot 是两种资源，generation replacement 可能在异步 open/read 返回前重用同一 source key。
  证据：coordinator 对 stale job 只关闭该 job 自己的 transport，不通过公共 key 取消 replacement；late open/read、terminal ACK/open failure 统一触发下一轮 pump。

- 观察：恢复批次若等所有 attach 完成再发送 `host/stateUpdated`，慢节点会阻塞已就绪节点和普通画布交互。
  证据：Host 现在用 `setImmediate` 做有界合并的 state post；每个 surface projection 仍按 chunk ACK 独立推进，未建立全局恢复 barrier。

- 观察：任何在`done/live`之后独立重放`R+1..head`的follow handoff都同时破坏背压和ready语义；即使给该loop分批yield，也不能把它变成正确方案。
  证据：`runtimeSupervisorMain.ts`现只在credit驱动的read中读取head；head增长时调用`pin.extendTargetRevision()`并更新target/barrier，新增区间继续走相同chunk/ACK路径。只有观察到stable head时才在同一session operation注册`terminal-stream-v1`并写`done/live`response；协议回归同时断言target增长、post-open backlog受credit约束且不存在独立replay helper。

- 观察：只校验read response target不低于open-time initial target，不能证明整个session内单调；恶意或损坏的response仍可能从已扩展的高target回落到较低但合法的initial范围。
  证据：`executionProjectionCoordinator.ts`现为每个job初始化并维护`latestTargetRevision`，每次read先拒绝回落再更新游标；coordinator regression构造扩展后回落，验证job fail closed且server-side projection/pin被取消。

- 观察：90,000 个小事件的 archive descriptor/sidecar 构造若只把 API 改成 async、内部仍整数组 normalize/stringify，仍会产生可见长任务。
  证据：修复前 `describeAsync` 约 894.55ms、最大 1ms timer drift 82.35ms，`write` 约 1447.36ms/108.88ms；分批 normalizer、文本聚合和 bounded checksum 后，本机样本分别为 305.25ms/9.74ms 与 623.71ms/7.90ms。

- 观察：同一个 controller generation 可以在 completed 边界从 Supervisor source 切到 archive source，因此 generation 不能单独作为 ACK/cancel identity。
  证据：旧 Supervisor chunk 的迟到 ACK/cancel 若只匹配 `(surface,node,generation)` 会取消 replacement；Host 现要求携带的 `projectionId` 匹配当前 record/job，Webview 也以完整 live identity 变化触发 queued + reattach。

- 观察：legacy canonical-only/inline archive 的首次 sidecar materialization 尚未共享正常 projection coordinator 的 priority queue。
  证据：Manager 与 Store 的一次性 materialization/write 仍是全局 FIFO；selected 可能等待已开始或已入队的 background legacy write。新写入 archive 已自带 sidecar，正常 live/sidecar reload 的 `8:3:1` 调度不经过这条兼容路径。

- 观察：completed bulk handoff原先在持有projection pin期间装配完整`TerminalStreamAttachPayload`；该资源缺口现已由admission-first direct-stream finalizer关闭，legacy inline/canonical-only materialization仍是另一条兼容路径。
  证据：`CanvasPanelManager.ts`现把lazy fixed projection source直接交给`CompletedTerminalHistoryArchiveStore.writeProjectionStream(...)`，Store队列的并发上限1在调用source `open()`前取得；stream writer逐chunk写canonical/sidecar staging并增量校验、hash和提交，Manager已无`createTerminalProjectionAssembler(...)`调用。archive测试断言第二个等待者的`openCalls === 0`，并以40 MiB lazy output验证Host不按完整history线性物化。

## 决策记录

- 决策：以 `origin/main@b0c61b3a` 为唯一实现基线，不在旧分析 worktree 上继续叠加。
  理由：用户明确指定该基线；它也包含 #280，而 #269/#280 不改变本轮已定位的恢复和输入热路径。
  日期/作者：2026-08-11 / 用户、Codex

- 决策：不整体 revert #272--#278，而是保留 listen-first、错误来源分类、显式 Resume、OSC query 修复、健康 stream 不周期 full refresh 和输入保序意图，删除建立在错误恢复边界上的实现。
  理由：这些提交同时包含正确的局部不变量和错误的 namespace/full-snapshot 路径，整体回滚会重新引入已修复的错误归因与无损问题。
  日期/作者：2026-08-11 / Codex

- 决策：Supervisor instance 改变即证明旧 PTY authority 不可重附着；新 Supervisor 不恢复旧 runtime session，也不设置全局 recovery barrier。
  理由：journal 可以恢复显示历史，但不能转移 PTY master。把它称为 runtime 恢复既浪费启动资源，也误导用户。
  日期/作者：2026-08-11 / 用户、Codex

- 决策：dead PTY 最低正确恢复数据是 Agent 的 provider、resume strategy、`resumeSessionId` 和 provider 必需 locator；screen snapshot/recent output 是 optional enhancement。
  理由：用户可由节点名称和显式 Resume identity 回忆上下文，缺少画面不应阻塞恢复入口。Terminal 没有 provider Resume，使用 Restart/history 语义。
  日期/作者：2026-08-11 / 用户、Codex

- 决策：健康 Reload Window 必须最终恢复 retention/scrollback 规则本应保留的完整历史，但按节点、按 revision 分块流式显示，不等待整张画布或单节点完整 hydrate 后再 reveal。
  理由：用户不要求“最新屏幕优先”或原子 reveal；边发送边显示既保留完整性，又缩短首批内容出现时间。
  日期/作者：2026-08-11 / 用户、Codex

- 决策：每个 `(surface,node,generation)` 独立维护 `projectionState = queued | restoring | ready | failed`，它与 lifecycle、runtime attachment 正交且不持久化。
  理由：一个健康 `waiting-input` 节点可以同时是 `attached-live` 和某个 Webview 上的 `restoring`；这不代表 runtime 待恢复，也不应触发整画布状态变化。
  日期/作者：2026-08-11 / 用户、Codex

- 决策：`queued/restoring`的当前节点禁止普通输入且不缓存按键，Stop/Kill等紧急控制继续可用；只有动态target追平一次session operation观察到的stable head、原子接上live并返回`done/live`后才切为ready、开放输入。
  理由：restoring期间的新PTY echo会继续扩展待恢复target，无法立即显示。如果允许输入，用户会看到生命周期先变化而输入/回显暂时藏在恢复流中，重现当前问题；缓存按键又可能在用户已失去上下文后意外执行。
  日期/作者：2026-08-11 / 用户、Codex

- 决策：多个节点共享少量 active bulk stream，用 selected、viewport-visible、background 三档优先级和 chunk-boundary 抢占的 weighted round-robin；具体并发数只由 benchmark 确定。
  理由：完整恢复一个节点后再轮到下一个会饿死大量节点，无限并发又会把 CPU、socket 和 xterm parser 同时打满。chunk 是公平性和抢占的正确边界。
  日期/作者：2026-08-11 / 用户、Codex

- 决策：control attach只返回轻量identity/lifecycle/authority事实；bulk projection使用同一Supervisor server的独立multiplexed connection，并要求lazy construction、backpressure、cancel和revision pin。
  理由：仅在同一 socket 上把大 payload 切块仍无法隔离 JSON parser 和事件循环的 head-of-line blocking；Host 直接读 journal 又会破坏 authority、retention、compaction、版本兼容和 revision pin。
  日期/作者：2026-08-11 / Codex

- 决策：control attach建立compact lifecycle subscription但不预先建立projection pin；surface调度真正准入节点后的bulk open只原子选择checkpoint、initial target `R`和pin。每次当前target已应用并ACK后，Supervisor在同一session operation读取journal head；若增长则先单调扩展pin与target并继续相同credit/chunk/ACK路径，重复到stable head后才原子注册terminal subscription并返回最终target的`done/live`。control subscription始终保持control-only；bulk断开释放socket-local cursor/pin，重试重新open，不承诺跨断线cursor续传。禁止独立、无credit的post-ready `R+1...head` replay。
  理由：启动时为所有节点pin会让后台排队节点长期占用retention，与lazy construction和有界资源相矛盾；open-time target又无法覆盖恢复期间持续产生的output。动态扩展使所有backlog都服从同一背压并让`ready`真正代表已经追平；stable-head operation同时封住历史与live之间的缺口。完全defer control subscription则会让排队期间的真实lifecycle失联，因此control与bulk继续维持固定职责。
  日期/作者：2026-08-11 / Codex

- 决策：per-node FIFO在client socket dispatch后释放，同时保留每条response独立await、诊断和错误上报；Supervisor-owned lifecycle只相信PTY write后的Supervisor compact event。该dispatch边界是正式实现，不把response ACK误写成FIFO completion。
  理由：等待response会继续受socket parser或Host handler HOL影响；完全丢弃response又会吞掉协议拒绝。固定socket admission保证旧session输入不会跨Supervisor generation，response-before-lifecycle和独立错误观察分别保证状态顺序与可诊断性。
  日期/作者：2026-08-11 / Codex

- 决策：input在PTY write后先把compact response写入control socket，再发布lifecycle；Client让同一parser burst的response consumer先恢复，Host异步合并该节点的persist/state post，bulk client不驱动共享lifecycle。
  理由：即使payload已经有界，若lifecycle handler仍在input response前同步执行整画布clone/stringify/write/post，Enter与后续response仍会被Canvas大小拖慢；control与bulk重复应用同一state还会把成本放大两次。
  日期/作者：2026-08-12 / Codex

- 决策：completed history 继续满足完整 final stream 产品承诺，但存入独立 immutable archive，Canvas state 只保存轻量 reference。
  理由：completed history 是用户内容，不应丢失；但它不需要参加每次全画布 clone/hash/stringify、Webview state broadcast 或 Note 输入。
  日期/作者：2026-08-11 / Codex

- 决策：所有既有 session RPC 必须携带一次性 connection admission；只有 Create、用户显式 Resume 与 Restart 可走允许启动 Supervisor 的无 token 路径。
  理由：进程 identity 的响应后校验只能发现错误，不能阻止旧 session request 已经被发送给替代进程；把 instance 与 socket generation校验放在 `socket.write` 前才是 authority routing边界。
  日期/作者：2026-08-11 / Codex

- 决策：旧 metadata 缺 instance identity 时只允许一次兼容探测；旧 Supervisor 使用 `legacy-pid:<pid>` 作为迁移期 effective identity，成功后立即回填，失败后清除 runtime binding。
  理由：需要让升级前仍真实存活的 PTY自然 drain，同时不能让缺字段节点在每次 reload无限探测或把新进程的同名 session当作旧 authority。PID复用是 legacy窗口的有限残余风险，不作为新协议身份。
  日期/作者：2026-08-11 / Codex

- 决策：completed archive 迁移采用“先写 ref、后删 inline”的延迟 copy-on-write；新完成会话直接写 immutable archive，旧 inline stream 只在 archive 已校验且 Canvas state durable 后删除。
  理由：archive 写入、Canvas 持久化或进程中断任一步失败时，保留 inline 副本仍能恢复用户历史；成功后普通 Canvas clone/hash/stringify 不再触碰大 payload。
  日期/作者：2026-08-11 / Codex

- 决策：reload attach 发现已结束的 bulk session 时复用 fixed projection finalization，而不是把 metadata-only snapshot 直接降级成 history-only。
  理由：Supervisor 仍持有可验证的 journal authority；先读固定 revision、完成 checksum/连续性校验并写入 archive，才能同时避免历史丢失和 dead registry/journal 泄漏。projection 失败时 fail closed 并保留 `reattaching`，不伪造终端画面。
  日期/作者：2026-08-11 / Codex

- 决策：projection backpressure 采用“一个 chunk、一个 Webview ACK”的上限，并把 controller generation/lifecycle/identity 校验放在 Host 与 Webview 两侧。
  理由：xterm 的 write callback 才代表用户界面真正消费了数据；旧 surface 的迟到 chunk 不得污染新 surface，也不能让 Supervisor 在 Webview 已拥塞时无限推送。
  日期/作者：2026-08-11 / Codex

- 决策：completed archive 的正式投影 sidecar 使用 `terminal-stream-projection-ndjson-v1`，记录顺序固定为 header、checkpoint 数据片段、按 revision 连续的 output/resize/scrollback 记录和单个 done marker。
  理由：canonical `payload.json` 继续作为不可变校验和兼容读取来源，但 reload 不应重新构造 monolithic JSON；NDJSON 让 reader 可以按 credit 分块、边读边显示并在 EOF 处验证完整性。
  日期/作者：2026-08-11 / Codex

- 决策：已有合法 sidecar 的 `ensureProjectionSidecar()` 走 stat + sidecar hash/长度校验，只有缺 sidecar 或旧 canonical-only ref 才读取 canonical blob 生成 sidecar。
  理由：每次 reload 解析完整 canonical blob 会重新制造 Host event-loop 峰值；descriptor、sidecar header 和 projection hash 已足以在正常路径确认投影身份，损坏时仍 fail closed。
  日期/作者：2026-08-11 / Codex

- 决策：先固定保守 scheduler 预算（4 open、1 selected overflow、2 read、32 KiB credit、`8:3:1` 权重），再用容量基准校准，而不是让节点数量直接决定并发。
  理由：selected 必须抢占但 background 不能饿死；opening、read 和 Webview 消费分别受限，避免历史传输占满 Host、Supervisor 或 xterm parser。
  日期/作者：2026-08-11 / Codex

- 决策：live follow projection、dead/completed fixed projection，以及legacy inline迁移完成后的archive显示都通过同一surface-local coordinator的chunk/credit/ACK语义；不再为completed节点发送monolithic Webview snapshot。
  理由：用户要求完整历史但不要求一次性 reveal；统一路径可复用顺序、背压、取消和 generation 校验，避免 completed 节点再次成为 reload 的大消息特例。
  日期/作者：2026-08-11 / Codex

- 决策：runtime restore 的 Host state post 使用 `setImmediate` 的渐进式 coalescing；projection 取消同时接受 compact `(surface,node,kind,generation)` source key 和完整 projection identity。
  理由：慢节点不能阻塞已 ready 节点；queued/opening 阶段尚无 `projectionId`，但节点删除、session replacement 和 Webview dispose 仍必须及时释放 admission/reader。
  日期/作者：2026-08-11 / Codex

- 决策：legacy inline/canonical-only archive materialization继续以512 events、16 KiB文本聚合和128 KiB byte batch作为保守让步边界；这些批次只服务兼容迁移，不定义新completed finalization的终态。
  理由：旧数据已经以完整对象或canonical-only blob存在，只能通过异步分批降低迁移长任务；把这条兼容路径与新session结束时的流式写入混为一谈，会掩盖旧assembler路径按完整history占用内存的原始问题，也会错误要求legacy迁移具备新writer才有的输入形态。
  日期/作者：2026-08-12 / Codex

- 决策：新completed finalization必须在bulk open/revision pin之前取得全局archive-store admission，当前上限为1；admitted finalizer把fixed projection chunk直接流式写入canonical和sidecar临时文件，增量维护hash、byte/event/revision统计与连续性校验，不经过通用assembler、完整`TerminalStream`、full `Buffer`或`readFile`。两个文件fsync/close/校验/atomic rename后，再完成Canvas ref durable barrier，最后才解绑并删除Supervisor journal；failure/cancel释放reader、pin、admission并保留唯一完整来源。
  理由：最终完成路径既要限制同时持pin的session数，也要限制单个session的Host内存；只优化assembler拼接或archive后处理无法满足这两个资源边界。admission放在open之前可避免排队finalizer长期钉住retention，双文件直写又避免同一history先物化再编码一次。
  日期/作者：2026-08-12 / Codex

- 决策：本轮不把一次性 legacy archive materialization 扩展为另一套可抢占 priority-aware write scheduler，明确登记为兼容路径技术债。
  理由：已经开始的 immutable archive prepare/commit 不能安全抢占；新 archive 和正常 reload 均不走该路径。若真实升级容量基准证明它显著影响首轮体验，再以 content-key dedupe、priority queue 和 durable write ownership 的独立设计处理，不能只在 Manager 表层重排 Promise。
  日期/作者：2026-08-12 / Codex

## 结果与复盘

当前已完成问题归因、产品语义确认、实现基线切换、健康input/重复projection P0、Supervisor instance/dead-runtime边界、metadata-only registry persist、completed archive durable barrier、legacy migration persist gate、archive slot union、control/bulk projection transport与Webview surface-local projection。新Supervisor不再读取旧registry、扫描旧journal或恢复dead PTY namespace；Host只对同instance会话attach，Agent dead runtime停在显式`resume-ready`，Terminal进入closed/history。Client对identity缺失/错配fail closed，并以一次性admission阻止既有session RPC跨断连窗口重启或跨代发送。live follow采用initial target + 单调target/pin extension：所有post-open backlog继续受credit/chunk/ACK约束，只有stable-head operation原子注册subscription并先写`done/live` response后surface才ready，不存在独立post-ready replay。多surface不再保留pending payload queue；opening/restoring record丢弃共享socket冗余observation，由自身follow stream吸收，bulk client deferred callback保证真正tail在Host ready continuation之后才派发。

fixed projection assembler已把identity、checksum、payloadBytes、UTF-16 offset、revision连续性和done完整性收口为可测试的纯reducer，并继续服务需要物化payload的非production辅助边界；Coordinator额外拒绝未达到最终target的空done/终止ACK。production live death event与reload后已结束bulk attach不再经过assembler：`CanvasPanelManager`把lazy fixed source交给archive store，Store先取得唯一admission，再open/pin并逐chunk写canonical与sidecar staging，增量校验后fsync和atomic commit。Archive store同时保留content-addressed blob、Canvas ref durable barrier和slot union；旧inline stream迁移仍延迟到archive与Canvas durable barrier都成功后，迁移窗口内普通persist被合并。Coordinator/Webview已经实现credit/backpressure、ACK、cancel、完整source identity、controller generation和restoring输入门禁，数据边到即显示；dead-session`live=false` fixed projection不再走已删除session的二次订阅，completed archive显示也复用同一coordinator。

completed finalization现已达到本计划选定的Host内存与并发终态：Store admission上限1在lazy source `open()`前生效，等待者不open/pin；canonical/sidecar双staging writer不构造完整`TerminalStreamAttachPayload`、full `Buffer`或`readFile`复核；failure/cancel会cancel已打开source、清理staging并释放admission，Canvas ref durable后才允许清理Supervisor journal。legacy inline/canonical-only的异步materialization继续保留，但不再定义新session的完成路径。当前stream sidecar在canonical已存在时使用hard link做独占发布，缺少不支持hard link filesystem的fallback，继续作为兼容风险保留。

本轮分层验证覆盖live follow动态target/stable-head handoff与response-before-event、513-revision classifier、600-event Manager non-ready observation丢弃、archive sidecar/immutable migration、90,000-event legacy responsiveness、completed direct-stream parity/admission/failure cleanup/40 MiB memory gate、projection assembler、coordinator fairness/generation replacement、canvas execution context、protocol/Webview messages、runtime Supervisor protocol、input queue、output sequence/scheduler、terminal journal、agent provider lifecycle、UI copy localization、typecheck和build。最终Runtime Supervisor容量样本为10个Agent input response 10.16ms、PTY echo 20.3ms、全部输出267.67ms（本机样本，不是跨平台SLA）；最终archive样本中40 MiB lazy output的peak heap增长约7.74 MiB、ArrayBuffer增长约33.37 MiB，GC后两者增量都低于1 MiB。Agent/Terminal restoring-input与live-ACK定向Playwright 4/4通过；`runtime-supervisor-reboot-recovery`和`real-reopen`最终复跑通过。reboot smoke只证明Host启动、Agent Resume action且不自动spawn、Terminal history，未点击真实Resume/Restart；real-reopen证明same-instance新Webview完整投影、继续输入和离线completed archive。其余跨filesystem、真实双surface/90,000行GUI容量与legacy首次materialization调度问题已登记到`docs/exec-plans/tech-debt-tracker.md`，因此本计划代码目标完成并归档，正式设计仍保持“验证中”。

## 上下文与定向

仓库根目录是本计划所有命令的工作目录。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是 Extension Host 的画布权威和运行时编排入口；`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 持有 live PTY、authority、revision 和 journal；`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 是 socket client；`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 与 `protocol.ts` 是跨进程协议；`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 和 `executionSessionNodes.tsx` 管理 xterm 投影。

本计划使用四个必须分开的词。lifecycle 是 Agent 的 `waiting-input/running/...` 或 Terminal 的 `live/closed/...`；attachment 是 Host 是否仍连接同一个真实 PTY authority；projection 是某个 Webview 的 xterm 是否已经应用到动态target并完成stable-head live handoff；Resume 是用 provider session identity 启动一个新 PTY，不是恢复旧进程。Supervisor restart 与 Window reload 的差异就在这四个事实上：前者失去 attachment authority，后者通常只失去 projection。

基线中的`TerminalStreamAttachPayload`把checkpoint、全部suffix events和target revision包成一个monolithic JSON response；`toSnapshot()`、`getEventsAfter()`与逐event diagnostics serialization会让payload构造本身占用Supervisor event loop，response/event还与input共用socket。基线也会把completed`terminalStream`放进`CanvasPrototypeState`，使`persistState()`进入全局clone/hash/pretty stringify路径。本轮已经用control/bulk projection隔离健康reload，并用immutable archive/ref把completed正文移出普通Canvas热路径；这两条路径解释了原交互RPC卡顿与画布编辑随历史增长变慢的原因。completed finalization从bulk chunk到archive的Host内存边界也已由admission-first direct-stream writer收口，并以40 MiB lazy source memory gate证明不再按完整history物化；这不替代最终GUI和跨filesystem验证。

## 工作计划

里程碑一先建立控制面P0。Supervisor的input request只做权限、live session与mutation admission校验，直接执行PTY write，不进入terminal journal operation chain；随后先写小型response，再发布不含terminal stream的compact lifecycle event。Host不在RPC前乐观切换`running`；per-node FIFO在请求写入固定socket generation后释放，每条response独立观察，Client的response handoff不能被同burst lifecycle handler阻塞。移除recovery progress的`postState()`残留；control subscription只发送compact state catch-up/lifecycle，不再次发送完整`sessionState`，bulk live subscription则按里程碑四在stable head之后只承载新event。测试必须用巨大journal证明input latency和response size不随event数线性增长。

里程碑二改写 Supervisor restart。hello 增加每次进程启动唯一的 `supervisorInstanceId`；节点 runtime descriptor 持久化该 identity。Host 只在 instance 相同，或 legacy descriptor 缺字段且一次兼容 attach 成功时，尝试 control attach。instance 不同直接把 Agent 收口到 `resume-ready` 或 history，把 Terminal 收口到 closed/history；新 Supervisor 启动不读取旧 journal event、不逐 segment stat、不恢复 registry session，也不发布 namespace recovery progress。旧 registry/journal 的清理与保留策略不在启动关键路径中完成。

里程碑三隔离持久化。新增completed terminal archive store，以不可变blob和轻量descriptor表达final stream。主磁盘/root-local canvas snapshot只保存descriptor；Webview bootstrap/stateUpdated不携带blob。读取旧snapshot时，第一次需要投影或下一次安全持久化边界把内联stream迁移到archive；迁移在durable archive write成功前保留旧内联数据，不能先删唯一副本。新completed finalization已在bulk open/pin前取得上限1的store admission，直接把fixed chunk流式写canonical与sidecar staging并增量校验；两个文件atomic commit和Canvas ref durable后才清runtime/journal。`persistState()`的性能测试继续证明archive字节增长不增加Canvas JSON大小和Note/create延迟；并发finalization测试已证明等待者不持pin、单个writer不物化完整history，最终GUI仍需补充。

里程碑四新增projection transport。control connection上的attach只返回`supervisorInstanceId/sessionId/live/lifecycle/authorityId`等小字段并保持compact lifecycle订阅，不建立bulk reader。surface调度准入后，独立bulk connection的open在Supervisor内原子确定checkpoint、initial target `R`和revision pin，并用`projectionId` multiplex多个节点；Supervisor根据Host credit/ACK懒读取checkpoint和journal，以有界chunk发送并支持cancel。每次当前target应用并ACK后，在同一session operation读取head；增长时原子、单调扩展target/pin并继续同一路径，稳定时原子注册live subscription、返回最终target的`done/live`，随后新event才走live。断线释放cursor/pin，显式重试重新open；不得保留独立post-ready replay。协议需要对旧Supervisor保留兼容attach，直到当前generation全部迁移。

里程碑五完成 Webview 节点调度。`projectionState` 只存在于 surface-local controller registry。每个节点都有 cursor；全局 scheduler把 selected、viewport-visible、background 转换为权重，在每个 chunk 边界重新选择节点。queued/restoring 节点显示 `Restoring`、禁止普通输入且不缓存，失败显示可重试投影错误；Stop/Kill 仍直接走 control connection。收到 chunk 就立即写 xterm，不等待完整节点或整画布；controller xterm write callback 产生 credit/applied ACK，防止 Host/Supervisor把数据继续推入已拥塞的 Webview。

里程碑六执行分层验收，并把实验得到的并发、chunk字节数和调度权重写回设计。任何90,000行短读、revision gap、重复输出、post-open backlog绕过credit、stable-head之前ready、输入越过restoring门禁、completed finalizer等待时持pin、archive durable barrier失败、资源泄漏或control/bulk相互阻塞都视为失败。

## 具体步骤

在仓库根目录按里程碑运行以下命令。单项失败时先保留 artifact 和日志，修复后重跑相同命令，不删除 journal 或放宽完整性断言。

    npm run test:execution-input-queue
    npm run test:runtime-supervisor-protocol
    npm run test:terminal-session-journal
    npm run test:execution-projection-coordinator
    npm run test:completed-terminal-history-archive
    npm run test:protocol-webview-messages
    npm run typecheck
    npm run build

完成projection与archive后增加定向Webview和Host smoke。Webview用例覆盖多节点selected priority、chunk-boundary抢占、`Restoring`输入门禁、逐块可见、initial target增长、stable-head之后才ready和完成后的live tail连续；`runtime-supervisor-reboot-recovery` smoke覆盖Supervisor kill后Host可启动、Resume action可见且不自动spawn（未点击真实Resume/Restart），`real-reopen`覆盖same-instance实际Webview投影、继续输入和离线completed archive。completed finalization纯Node fixture已断言全局store admission最多1、等待者不open/pin、stream/legacy字节级parity、failure/cancel staging cleanup和40 MiB lazy source有界内存。真实双surface + 90,000行GUI reload下另一ready节点、Note和create并发，以及Host/Webview lag与dynamic credit/并发参数校准未在本轮执行，已转入技术债；真实多session同时结束、ref persist故障与跨filesystem提交矩阵也保持为后续验证边界。

## 验证与验收

健康Agent在`waiting-input`状态按Enter后，Supervisor应先记录input admission/PTY write，把小型response写入control socket，再发布compact lifecycle；Client必须先恢复response consumer再派发同burst state handler。无论journal有10个还是90,000个event，input response都不能包含`terminalStream`，也不能调用完整snapshot builder。快速重复输入必须逐字节保序，失败项不能阻止后续项；bulk与control不能让同一lifecycle在Host重复persist/post。

Reload Window时，每个live节点独立进入`queued/restoring/ready`。第一个chunk到达后该节点立即显示内容，选中节点在下一个chunk边界抢占，后台节点最终完成；完成结果与retention/scrollback本应保存的历史逐revision一致。open-time target只是initial target；恢复期间产生的output必须推动target/pin单调扩展并继续受credit/ACK约束，只有最终target已应用且一次session operation观察到stable head、原子注册subscription并返回`done/live`后才能ready。不得出现post-ready backlog replay。restoring节点普通按键不发送也不缓存，ready节点输入正常，Stop/Kill可用。

Supervisor restart 时，hello 可立即服务新 session。旧 instance 的 Agent 有可信 identity 时显示 Resume且不自动 spawn；点击后才启动新进程。Terminal 提供 Restart/history。启动诊断不得出现 journal event scan、segment-by-segment stat、全局 recovery progress或因旧节点产生的 Webview `host/stateUpdated`。

completed history大于5 MiB时，Canvas snapshot和普通`host/stateUpdated`都只含轻量ref；创建节点和编辑Note不读取或stringify archive blob。新finalizer在取得唯一store admission之前不open projection或持pin；取得后直接把chunk流式写canonical与sidecar临时文件，内存不得随history线性增长。reload后显式投影该completed节点仍能恢复同样的首、中、末marker，并遵守同一分块/背压协议。任一failure/cancel后reader、pin和admission都释放，Supervisor journal或旧inline唯一副本仍可重试。

## 幂等性与恢复

所有源代码和文档patch可重复应用。协议迁移必须先增加optional capability/字段和兼容reader，再切换writer，最后才删除旧monolithic路径。completed finalizer已按“先增加store admission与streaming staging writer、证明资源释放和durable顺序、再从Manager production路径移除assembler”的顺序迁移；legacy inline/canonical-only migration继续保留，不能随新路径一起删除。archive必须先durable write并校验，再更新descriptor；任何失败保留旧内联数据或Supervisor journal。不要删除用户journal、archive或`tmp.md`。测试临时目录必须由fixture自己在`finally`清理。

bulk transport现已完成；它与此前完成的P0控制面和restart修复仍保持可独立验证、可回滚，不以transport收口掩盖input前full snapshot回归。若后续benchmark否定初始scheduler参数，只调整常量和记录证据，不放弃有界并发、chunk-boundary抢占和无损历史三项不变量。

## 证据与备注

基线与初始现场证据：

    branch: runtime-recovery-projection-isolation
    HEAD: b0c61b3a6db60da2151f3ab595625efee076444a
    origin/main: b0c61b3a6db60da2151f3ab595625efee076444a
    existing untracked file: tmp.md (preserved)
    observed large-journal input: mean 12.13s, max 23.763s

最终证据已按里程碑追加在下文，包含测试名、关键 latency/size 数值和已知环境噪声；归档结论与未完成验证边界以“成果与回顾”及技术债登记为准。

P0证据：

    npm run test:execution-input-queue              PASS
    npm run test:runtime-supervisor-protocol        PASS
    npm run test:protocol-webview-messages          PASS
    npm run typecheck                               PASS
    npm run build                                   PASS
    10-Agent input response / echo                  10.04ms / 30.38ms

Supervisor instance里程碑证据：

    npm run test:runtime-supervisor-protocol        PASS（identity稳定/变化、无registry恢复、fail-closed、admission断连竞态）
    node scripts/test/test-canvas-execution-context.mjs
                                                     PASS
    node --no-warnings --experimental-transform-types scripts/test/test-ui-copy-localization.mts
                                                     PASS
    npm run typecheck                               PASS
    npm run build                                   PASS
    git diff --check                                PASS
    10-Agent input response / echo                  45.66ms / 72.01ms（并行测试运行样本，无秒级退化）

Projection/archive 里程碑证据（2026-08-11）：

    node scripts/test/test-terminal-projection-assembler.mjs
                                                     PASS（identity/checksum/payloadBytes/offset/revision/done fail-closed）
    node scripts/test/test-completed-terminal-history-archive.mjs
                                                     PASS（immutable blob、checksum、durable ref 与迁移边界）
    npm run test:runtime-supervisor-protocol        PASS（metadata-only attach、bulk pin/read/cancel/follow、finalization race）
    npm run test:protocol-webview-messages          PASS（controller generation、projection state、stale message filtering）
    npm run typecheck                               PASS
    npm run build                                   PASS
    git diff --check                                PASS

    追加回归（2026-08-11 19:05 +0800）：
    node scripts/test/test-canvas-execution-context.mjs
                                                     PASS（archive ref + inline fallback migration 状态）
    npm run test:execution-projection-coordinator   PASS（non-zero checkpoint ACK floor）
    npm run test:protocol-webview-messages           PASS（ACK floor、dead projection ready、stale lifecycle）
    npm run test:runtime-supervisor-protocol        PASS
    npm run test:execution-input-queue               PASS
    npm run test:execution-output-sequence           PASS
    npm run test:execution-output-scheduler          PASS
    npm run test:terminal-session-journal            PASS
    npm run test:agent-provider-lifecycle             PASS
    node --no-warnings --experimental-transform-types scripts/test/test-ui-copy-localization.mts
                                                     PASS
    runtime protocol local sample (10 agents): input response 20.10ms, PTY echo 29.71ms, all output 475.18ms; journal 1,013,102 bytes, registry 68,085 bytes, checkpoint 864,160 characters.

    多surface handoff回归：covered by `npm run test:execution-projection-coordinator`、`npm run test:canvas-execution-context` and `npm run test:runtime-supervisor-protocol`（513个non-ready observation全部ignore；Manager丢弃600个shared-socket event且不创建pending queue；ready到600后按state-before-event发送601；Supervisor caught-up response先于首个live event；duplicate/next/gap与projection ACK floor）。

    追加收口（2026-08-11 20:15 +0800）：
    node scripts/test/test-completed-terminal-history-archive.mjs
                                                     PASS（slot archive union、同 blob 校验、冲突 fail-closed）
    npm run test:execution-projection-coordinator   PASS（空 done/终止 ACK 不足 target 时 fail-closed）
    npm run test:canvas-execution-context            PASS（legacy migration candidate 与 persist gate 静态/纯 helper 断言）
    npm run typecheck                                PASS
    git diff --check                                 PASS

    真实 VS Code smoke（trusted scenario，连续两次）：均在 `verifyAgentAbnormalInterruptionNotifications()` 超时；节点实际输出完整，但 predicate 仍要求 `provider-lifecycle + authoritative`，而 `origin/main` 同样只产生 `heuristic + best-effort`。该失败是基线 stale lifecycle expectation，不作为本轮 projection/control 回归证据；未为变绿而恢复旧 provider callback 或放宽断言。

    当时已知缺口：完整 VS Code smoke、Playwright 双 surface reload、Supervisor reboot 后的状态 / action 边界与真实 Resume/Restart 点击、90,000 行真实 GUI 容量基准、Host/Webview event-loop lag 和 dynamic credit benchmark尚未复跑；后续`runtime-supervisor-reboot-recovery`只补了Host启动、Resume action和Terminal history状态，未点击真实按钮，`real-reopen`补了实际projection/继续输入，其余缺口保留。完整`npm test`仍受marketplace VS Code fixture的Linux IPC socket路径长度限制；trusted smoke的Claude lifecycle predicate与`origin/main`同样不符。上述本机协议样本不是跨平台SLA。

    最新收口（2026-08-11 23:45 +0800）：
    npm run test:completed-terminal-history-archive  PASS（sidecar header/record/EOF 校验、canonical-only upgrade、slot union、篡改 fail-closed）
    npm run test:terminal-projection-assembler       PASS
    npm run test:execution-projection-coordinator    PASS（4 open + selected overflow、2 read、8:3:1、公平性、generation replacement、queued cancel）
    npm run test:protocol-webview-messages           PASS（archive sidecar source contract、live-session replacement、projection ACK floor）
    npm run test:runtime-supervisor-protocol         PASS（10-agent input response 19.78ms、PTY echo 30.34ms、all output 313.69ms）
    npm run test:execution-input-queue                PASS
    npm run test:execution-output-sequence            PASS
    npm run test:execution-output-scheduler           PASS
    npm run test:terminal-session-journal             PASS
    npm run test:canvas-execution-context             PASS
    npm run typecheck                                 PASS
    npm run build                                     PASS
    git diff --check                                  PASS

    根代理最终复跑（2026-08-12 00:32 +0800）：
    npm run test:completed-terminal-history-archive  PASS（当时覆盖legacy/canonical materialization 90,000 events：describeAsync 323.82ms / 17.59ms max drift；write 652.44ms / 11.04ms；direct-stream证据由02:53追加回归补齐）
    npm run test:terminal-projection-assembler       PASS（含 2 MiB 单 output 分块 materialization）
    npm run test:execution-projection-coordinator    PASS
    npm run test:canvas-execution-context             PASS（restore batch、exact projection client cleanup）
    npm run test:protocol-webview-messages           PASS（完整 live identity replacement、stale ACK/cancel）
    npm run test:runtime-supervisor-protocol         PASS（10-agent input response 20.21ms、PTY echo 30.93ms、all output 312.49ms）
    npm run test:execution-input-queue               PASS
    npm run test:execution-output-sequence           PASS
    npm run test:execution-output-scheduler          PASS
    npm run test:terminal-session-journal            PASS
    npm run test:agent-provider-lifecycle            PASS
    npm run test:ui-copy-localization                PASS
    npm run typecheck                                PASS
    npm run build                                    PASS
    git diff --check                                 PASS

    本轮纯Node证据随后由两条真实VS Code smoke补充：`runtime-supervisor-reboot-recovery`验证Host启动、显式Resume action和Terminal history状态，但未点击真实Resume/Restart按钮；`real-reopen`验证实际Webview projection与继续输入。双surface GUI、90,000行GUI首chunk/完整hydrate和Host/Webview event-loop lag不属于当前自动化已证明范围，归档时转入技术债。测试中的trusted provider lifecycle predicate与基线行为不一致，未通过回退旧callback规避。

    2026-08-12 follow语义代码证据：`runtimeSupervisorMain.ts`在credit驱动read内读取head并调用`pin.extendTargetRevision()`，stable head时在同一session operation注册subscription并写`done/live`；`test-runtime-supervisor-protocol.mjs`静态拒绝独立replay helper，黑盒场景断言target增长、20次以上credit read和post-open marker不作为未ACK live event发送。`npm run test:execution-projection-coordinator` PASS，覆盖per-job `latestTargetRevision`和target回落后的fail-closed/cancel pin。completed direct-stream由下一组独立证据覆盖。

    2026-08-12 02:53 completed direct-stream finalizer证据：
    npm run test:completed-terminal-history-archive  PASS（257 B、32 KiB、64 KiB credit下stream/legacy descriptor、canonical和sidecar parity；admission上限1且等待者不open；checksum/revision/EOF/source/commit failure fail-closed并cleanup；40 MiB lazy output在64 MiB old-space子进程通过peak/retained heap与Buffer门禁）
    npm run typecheck                                PASS
    code inspection                                  PASS（Manager production finalization仅调用`writeProjectionStream`，无assembler；Store admission包围lazy `source.open()`，staging writer增量hash/校验/fsync/commit）
    residual                                         hard-link-only sidecar独占发布的filesystem兼容与跨平台容量验证（归档时转技术债）

    2026-08-12 03:24 最终handoff与归档gate：
    npm run test:execution-projection-coordinator   PASS（513个non-ready observation全部ignore；ready duplicate/next/gap边界）
    npm run test:canvas-execution-context            PASS（Manager丢弃600个restoring shared-socket event，无pending queue；ready后先state再event 601）
    npm run test:runtime-supervisor-protocol        PASS（caught-up response-before-live-event；10-Agent input response 10.16ms、PTY echo 20.3ms、all output 267.67ms）
    npm run build                                   PASS
    node scripts/test/run-playwright-webview.mjs --grep "blocks input while a bulk projection is restoring|re-enables live applied ACKs"
                                                     PASS（4/4，Agent/Terminal各覆盖restoring input gate与archive -> live ACK重启用）
    runtime-supervisor-reboot-recovery smoke        PASS（Host启动、Resume action、无自动spawn、Terminal history；未点击Resume/Restart）
    real-reopen smoke                               PASS（same-instance完整projection、继续输入、离线completed archive）
    最终核心套件                                   PASS（completed archive、assembler、coordinator、canvas context、protocol-webview、runtime protocol、input queue、output sequence/scheduler、journal、provider lifecycle、UI copy、typecheck、build）
    completed archive 40 MiB gate                   PASS（peak heap +7,738,016 B；ArrayBuffer +33,370,846 B；retained +632,992 B / +524,701 B）

## 接口与依赖

不引入新的外部 package。现有 `RuntimeSupervisorClient`、`TerminalSessionJournal`、`SerializedTerminalStateTracker`、Webview execution controller 与 xterm write callback继续作为基础，但职责要收窄。

里程碑二结束时，hello 和节点 runtime descriptor 必须能表达 `supervisorInstanceId`；Host 提供明确的 instance match helper，legacy 缺字段只能走一次兼容探测。

里程碑四结束时，协议至少存在轻量control attach result、projection open/chunk/credit/cancel/complete/error消息，以及稳定的`projectionId/sessionId/authorityId/cursor`。open返回`initialTargetRevision`语义的`targetRevision`下界，read response中的同名字段只能单调扩展；`done/live`必须携带最终stable target。bulk连接不能携带画布对象或React Flow状态；control响应不能携带terminal checkpoint或journal events。

里程碑三的completed finalizer现由`CompletedTerminalHistoryArchiveStore.writeProjectionStream(...)`提供全局admission（上限1）和可失败清理的双文件streaming writer。admission先于Supervisor projection open取得；writer逐chunk接收checkpoint/event并增量维护hash、byte/event/revision统计，commit执行fsync/close/校验/atomic publication，失败时cancel source并清理staging。Manager不再把完整`TerminalStreamAttachPayload`作为writer输入。canonical已存在时的sidecar独占发布目前依赖hard link，filesystem fallback尚未实现。

里程碑五结束时，Webview controller registry必须按 surface generation持有 `projectionState` 和 cursor；`CanvasPrototypeState`、workspace/root-local snapshot与 Supervisor registry均不得持久化该字段。

---

2026-08-11：创建计划。原因是用户确认原 #272--#278 修复路径混淆了 dead PTY、健康 runtime 与 Webview projection，并指定从 `origin/main` 重新落地；本文把已确认的产品语义、分阶段迁移和可观察验收统一为单一执行入口。

2026-08-11：完成健康input和重复projection P0。原因是这些同步热路径已经有明确证据且可独立验证；记录socket-dispatch而非Supervisor ACK的过渡边界，避免把首轮latency改善误写成control/bulk隔离已经完成。

2026-08-11：完成Supervisor instance与dead-runtime边界。原因是只删除registry recovery仍不足以阻止旧session RPC在断连窗口启动新Supervisor；本次把process identity、socket generation、一次性admission、disconnect世代过滤和legacy一次探测一起收口，后续bulk transport可在不混淆runtime authority的前提下独立演进。

2026-08-11：完成现有completed archive/ref、dead/completed fixed projection的assembler finalization、control/bulk背压和Webview fail-closed。原因是实现过程中发现“metadata-only attach + ended session”是reload的独立分支，必须读取final revision并durable归档而不能直接history-only；同时把archive迁移延迟到durable barrier后，避免性能优化变成历史丢失风险。该阶段的assembler路径随后由2026-08-12完成的direct-stream writer取代，不再是production completed finalization边界。

2026-08-11：最初用multi-surface pending event queue对账共享bulk socket observation；后续600-event回归证明旧512条容量会让restoring surface错误失败，最终实现已删除该queue。当前non-ready record直接忽略shared-socket observation，由各自follow stream吸收；Supervisor response-before-event和bulk client deferred callbacks保证ready后才派发真正tail。

2026-08-11：补充 sidecar codec/strict reader、异步 archive materialization、固定 scheduler 预算、completed archive coordinator 路径、渐进式 restore state post 和 queued/generation cancellation 证据；原因是后续审阅发现这些细节直接决定 reload 是否仍会在 Host 热路径重新物化大历史，或在 replacement/dispose 竞态中泄漏 reader/slot。本次修订同时记录最新定向测试结果与尚未完成的真实 GUI 验收。

2026-08-12：完成性能与竞态审阅。legacy archive materialization以async event batching、文本聚合和bounded checksum将90,000-event timer drift降到约11--18ms；阶段性assembler避免大字符串反复拼接和完成边界的完整event重扫；projection replacement改用完整identity，迟到ACK/cancel与disconnect cleanup只作用于exact old transport。审阅确认独立follow replay即使分批yield也违反credit/ready语义，必须改成动态target/stable-head handoff；也确认assembler优化不能替代admission-first direct-stream completed finalization。两项现均已实现并有独立协议/archive证据；legacy canonical-only首次materialization的FIFO priority例外、hard-link-only filesystem兼容和真实GUI验收继续显式保留为残余。

2026-08-12：同步正式follow语义与completed finalization目标。原因是open-time`R`只是initial target，把`R+1...head`放到`done/live`之后会让surface过早ready并绕过Webview credit；当前实现已经在同一session operation内单调扩展target/pin并追到stable head。当时completed路径仍在open后用assembler物化完整payload，因此计划单列direct-stream条目；该条目现已完成并由后续parity、admission、failure cleanup和40 MiB内存门禁闭环。

2026-08-12：完成completed direct-stream finalizer。Store全局admission上限1包围lazy source open/read/commit，等待者不建立projection或pin；canonical与sidecar由fixed chunks直接写staging并增量校验/hash/fsync/atomic publication，Manager production路径移除assembler和完整payload物化。archive测试通过字节级parity、admission-first、故障清理与40 MiB有界内存门禁，typecheck通过；hard-link-only sidecar发布和真实GUI容量继续作为残余并在归档时转入技术债。

2026-08-12：完成最终handoff修复与计划归档。Manager 600-event回归和classifier 513-revision回归关闭已删除的旧pending queue上限；Runtime Supervisor response-before-event与bulk client deferred callback共同固定ready/tail顺序。最终build、定向Playwright 4/4、runtime protocol以及`runtime-supervisor-reboot-recovery`、`real-reopen`真实smoke通过；reboot smoke未点击真实Resume/Restart。剩余hard-link filesystem矩阵、双surface/90,000行GUI与Host/Webview lag及参数校准、legacy首次materialization调度分别登记为技术债；本计划已从`active/`移入`completed/`，正式设计保持`validation_status: 验证中`。
