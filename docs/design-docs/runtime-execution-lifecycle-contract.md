---
title: 执行会话 Provider 与 Adapter 生命周期契约
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 适配与基础设施层
  - 共享模型与编排层
  - 宿主集成层
  - 画布呈现层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity-native-candidates.md
updated_at: 2026-09-23
---

# 执行会话 Provider 与 Adapter 生命周期契约

## 1. 状态、目的与非目标

当前以 `runtime-native-failure-isolation.md` 第21节（2026-09-23）为准：同一aff95d1e原生候选、冻结v1执行角色及原预算下，唯一新v2切片U1-0一次、U1-1三次共4/4通过，采集CLI与独立离线复核均exit0。U1-0真实wait1792/exit7；三次U1-1真实wait256/exit1，均完成已登记owner结算，新判定分别报告scenarioMatches、resourcesSettled、evidenceSufficient。旧第20阶段3通过/1失败/2未运行及原CLI exit13保留，不补跑、不重判，也不与新样本合算。 第18–24节及其“下一步”按历史时点保留；本契约仍比较中/验证中。

本轮仅在v2中解决退出形式与资源准入耦合、新采集入口循环导入两项直接问题，未修改冻结v1/native或业务。下一项是Linux U1-2实际取得TSFN后、wait线程启动前注入线程启动失败的协议与原生验证，本轮尚未运行。其余U1/W1、macOS/Windows、真实Agent、并发及Supervisor/Host/Webview/产品验收仍开放，不新增通用工具前置。

第20阶段历史证据：U1-0各次均记录writer成功写2102字节、PTY原始2104字节（Linux ONLCR）、真实EIO、wait exit7、完整headless状态及最终光标x6/y4，master close、waiter thread、payload和TSFN均已结算。U1-1关闭前fd flags32770仍blocking，跳过非阻塞设置并记录合成EIO、未提交read；close和SIGTERM请求均返回0，真实wait status256/exit1/signal0，已登记owner均已结算。`kill`返回0不要求随后以信号退出，失败的退出形式不能抹去这些资源事实；本机glibc `forkpty`子路径在`login_tty`失败、信号仍阻塞时`_exit(1)`只是原因候选，尚未证明本样本命中。

第20阶段历史入口记录：原入口在最后`verifySaved`动态导入入口自身形成top-level-await循环并exit13，原失败保留，不能称原CLI已修好。新增只读独立入口 `verify-native-failure-v1.mjs` 直接导入冻结verifier；`standalone-verification.log`记录离线重放exit1，仍为3通过、1失败、2未运行且仅原U1-1失败，没有新增native执行。该入口缺陷与U1-1冻结判据失败分别记录，原driver、verifier、测试、原始证据、原断言和历史结果均保留。

本设计是 `docs/design-docs/runtime-exit-integrity-native-candidates.md` 第30节之后的候选契约 v1，不是已部署接口，也不授权直接接入业务。已有证据支持 Unix 独占读取、macOS 自然路径 kqueue 关闭和 Windows bundled HPCON 最终 Close 的局部可行性；没有证明取消、异常、并发或全部支持环境的生产完整性。本文将这些证据转换为明确的职责、结果和可检验偏序，整体仍比较中/验证中。

Provider 指持有原生进程、PTY/pipe、reader、worker 与退出等待资源的平台实现；adapter 指把平台事实转换为统一事件的共享适配层。Authority 指按顺序应用终端操作并生成最终 revision 的运行时权威，在 live-runtime 中是 Supervisor，在直接 snapshot-only 中是 Host。页面读者是 Webview 的一次终端投影，既不是进程 owner，也不是源输出结束的判定者。

继续遵守已确认产品范围：管理 Terminal/Agent 会话与终端资源，不逐个托管普通后代；实际 Agent CLI 即使位于启动包装程序之下仍是会话主体。主体退出后普通后代未来输出不形成独立服务承诺，但主进程尾部、自身已接收/排队/消费内容、最终终端状态和资源释放仍须保证。Runtime 正常结束重开无进程/正文、Supervisor 崩溃或机器重启无需恢复的边界不变。root runtime 归属、容量整体模型、历史归档和新增独立 server 不属于本增量。

## 2. 现有接口与候选选择

本节及第4/6节的业务函数、分页链路和旧契约/屏障模型锚点基于运行时主分支 `0518dcc4fdbc0b233e2bb4bd1c27511aea85be88`。本独立 main-based 诊断分支尚未包含该运行时改造和两个旧模型，不将这些锚点视为本树已实现接口或可直接执行的旧模型入口；本阶段新增的D3/D4仅是独立诊断入口，不是业务候选模块。D3/D4实施结果与契约缺口见第18节。

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 的 `ExecutionSessionProcess` 目前只有 `onData/onExit/kill` 等操作；`onExit` 注释将它解释为输出已经排空。`src/supervisor/runtimeSupervisorMain.ts::bindSessionProcess()` 收到此事件立即关闭 `terminalMutationAdmissionOpen`，`finalizeSession()` 才排空已接受操作。`src/panel/CanvasPanelManager.ts` 的直接 Agent/Terminal 路径也依赖此接口。现有队列不能补回 provider 未交付的尾部，调整上层等待并不能使旧 onExit 获得源 EOF 证明。

`src/webview/terminalPagedProjection.ts::finishExit()` 与 `stop()` 都调用同一个 `close`；`src/common/runtimeSupervisorProtocol.ts::RuntimeSupervisorCloseTerminalReadParams` 只有身份。现有 revision/分页基础可保留，但关闭读者不能证明页面应用完成。已做过的契约与屏障模型分别在 `scripts/diagnostics/runtime-exit-contract-model.mjs` 和 `scripts/diagnostics/runtime-exit-barrier-model.mjs`，它们是注入模型，不是拟定生产实现；后者的进程结果只接受整数 exitCode，资源释放 promise 也没有 unknown/未返回分支。

| 路线 | 判断 |
| --- | --- |
| 两个业务 owner 各自等待/解释 node-pty onExit | 不采用。复制平台竞态处理，不能取得旧接口没有提供的事实。 |
| 给旧 onExit 加 timer，统一改名 complete | 不采用。时间过去不是 EOF、消费完成或资源回收证据。 |
| 平台 provider 分离事实，共享 adapter 统一封口，authority 与读者分别结算 | 作为本轮待验证候选。单一平台资源 owner，复用现有 authority 队列与分页，避免全部 wire 重写。 |
| 立即替换整个终端引擎或新增外部服务 | 暂不选定。正常路径局部证据不足以决定新的构建、取消、分发和失效隔离成本。 |

“共享”指同一实现可在 Supervisor 或 Host 进程内实例化，不共享它们之间的内存，不引入全局会话注册表。生产文件候选为 `src/panel/executionSessionLifecycle.ts`（新共享 adapter）和 bridge 内的平台 provider 接入点；只在设计中登记这些待建位置，本阶段不创建业务模块。

## 3. 五类独立事实

不能用单一 `closed`、`lifecycleFailed` 或退出码覆盖以下结果。pending 是尚未观察到，不是超时后的成功；unconfirmed/unknown 是明确缺少证明，不等于已确认进程存活、尾部丢失或资源泄漏。

| 事实及唯一判定者 | 结算含义 | 不能据此推导 |
| --- | --- | --- |
| 进程结果，provider | native wait 得到的 exit code/signal；wait/通信失败则 unconfirmed 并保留原因 | 源结束、页面已应用；信号发送成功也不等于退出 |
| 源结果，provider 经 adapter 校验 | 真实 eof；主动截断 interrupted；读取失败 error；旧能力或 owner 丢失 unknown | 进程一定已退、reader 已释放、输出来自哪个后代 |
| authority 应用结果，Supervisor/Host | 所有已接受操作与终端解析完成后固定最终 revision；失败明确记录已应用前缀和错误 | 每个页面已应用、源原始字节一定完整 |
| 每个读者结果，Webview/读者 owner | applied 到确切最终 revision；cancelled；连接/页面失效 lost；旧 close 仅 legacy-released | 其他读者完成、整个 PTY 应取消 |
| 资源处置，provider | 已知 owner 单次释放；仍持有；已知释放失败；是否完成无法确认 | OS 所有关联对象全局消失、内容完整 |

以下 TypeScript 仅定义下一轮诊断使用的结果格式，生产名称、导出位置和 wire 编码仍需集成评审。`executionId` 是一次创建的不可复用身份，不是 PID/root/readId；generation 使旧回调不能命中新执行。data sequence 是 adapter 已接受文本块序号，不是 authority revision。

```ts
type ExecutionIdentity = { executionId: string; generation: string };
type ProcessResult =
  | { kind: 'exited'; exitCode: number; signal?: string }
  | { kind: 'signaled'; signal: string }
  | { kind: 'terminated'; reason: string }
  | { kind: 'unconfirmed'; reason: string };
type SourceResult =
  | { kind: 'eof'; lastDataSequence: number }
  | { kind: 'interrupted' | 'error' | 'unknown'; lastDataSequence: number; reason: string };
type ResourceResult =
  | { kind: 'released' }
  | { kind: 'retained' | 'failed' | 'unknown'; reason: string };
type OutputSeal = ExecutionIdentity & {
  process: ProcessResult;
  source: SourceResult;
  lastDataSequence: number;
};
type AuthorityResult =
  | { kind: 'applied'; finalRevision: number; throughDataSequence: number }
  | { kind: 'failed'; throughDataSequence: number; reason: string };
```

每个结果必须带执行身份；表内 payload 可由外层统一封装，不重复引入第二套身份权威。空输出 `lastDataSequence=0`；非空文本每次接受递增1，严格连续。解码最后尾片也占一个序号；序号溢出、跨 generation、跳号、冲突重复均为协议失败，不静默补零。合法非零退出与 eof 可同时成立；signal-only 不捏造 exitCode0。terminated 专指已由 wait 证明终止但取不到退出状态，reason记录查询失败，不能降格成未证明终止的unconfirmed；Windows wait已成功时退出码259也不能机械判成仍运行。原始字节计数、平台 VT 转换与解码序号分开，不能用字符串长度冒充源字节数。

ResourceResult是对本次执行所有已登记资源的摘要，底层必须另留逐项owner及释放尝试台账：reader/input、waiter、thread/TSFN、PTY/HPCON分别记录 `not-invoked / in-flight / returned / failed / unknown`、操作id和错误。只有全部属于自身的必需owner均已结算才能汇总released；仍在执行的正常操作是pending而非unknown。unknown仅表示观察/控制失效或预算到点后无法确认，不撤销其他已经证实的释放结果。每个具体资源只有一个已进入的释放操作，不禁止对其他已证明安全的资源分段回收。

retained/unknown和process unconfirmed是带时间的观察，不是不可变最终事实。相同execution/generation/operation的迟到证据可以把当前unknown推进为released，或把unconfirmed推进为已证明终止；不重新调用Close，不覆盖历史超时报告，不追认当时通过。已经公布的OutputSeal是当时事实的快照，不回写或重发；新证明用独立进程/资源更新传递，不能把后来audit的EOF补为旧source完整。相互矛盾的两个确切退出/释放结果才是协议违约。

## 4. 接口职责和偏序

### Provider 到共享 adapter

创建采用候选 `openExecution(spec, observer)`，必须先安装 observer 再启动可产生事件的源，避免 create 后注册 listener 丢失快速退出/首块。平台实现持有一个 owner 记录，创建每项资源立即登记；传给 JS 的 token 只定位自身记录，绝不把外部 PID 或数值句柄当作所有权证明。公开返回的是受控操作，不暴露 raw fd/HPCON。

这个无缺口要求覆盖整个provider→adapter→authority链，不只覆盖native到adapter：业务工厂须在spawn前建好authority的session、tracker、串行队列并绑定完整sink，或采用已经验证的prepare/bind/start屏障，不能沿用“启动后再注册onData/onOutputSeal”而依赖事件循环碰巧未调度。保留onData形式不免除创建接线调整，也不能用无限启动缓存掩盖晚订阅。当前创建后绑定的代码顺序尚不构成旧实现已经丢失首块的证据；D1的M01在open返回前同步注入首块/进程事件以检查新候选要求。

最小 observer 包含 `data(identity, text)`、`processResult(identity, result)`、`sourceEnd(identity, disposition)`、`resourceResult(identity, result)` 和独立 `fault(identity, detail)`。data由adapter的串行接受入口唯一分配sequence并同步返回给provider作为移交回执；provider不另建竞争序号。sourceEnd的原始disposition只有原因/证据，adapter在所有先前数据接受后补上lastDataSequence；平台内部read/message编号只作独立所有权审计。解码和在途read的buffer在消费方取得独立所有权前不得复用。重复的相同确切最终事实幂等，冲突确切事实报告fault；观察更新遵守第3节的补证规则。最终封口后迟到data是provider违约，留下序号和可用内容证据，不静默追加到已公布的最终revision。

允许 `processResult` 先于或后于 `sourceEnd`；进程退出只关闭该执行的输入/原生 resize，不封闭输出 admission。主体身份未经验证的 launcher 路径不能自报可信完成。`sourceEnd` 必须位于所有成功 read 回调、已取得的 worker 消息及 decoder 尾片交付之后；没有待处理所有权才能宣告不再输出。只观察到 socket close/worker exit 而没有真实 end/read0/平台已验证的 EOF，不得写 eof。

### Adapter 到 authority

adapter 在进程观察已结算、源已封口且连续数据全部交给 authority 队列后发布一次 `OutputSeal`。这不是“全部交付成功”，只是输出流不再增长的带原因边界；名称不得缩写为无法区分语义的 onExit。进程 unconfirmed 不能成为正常 completed/stopped 节点的依据，也不能触发旧 live 绑定迁移或宣称进程已结束。若 waiter 失效但读取仍正常，报告进程未知并保持输出服务，不因缺退出结果而提前截断。

OutputSeal.lastDataSequence、其中source.lastDataSequence与adapter连续接受尾值必须相等；下一轮模型保留这个冗余字段只用于核对跨边界封口不一致，不把两个水位当两份权威。生产序列化可消除冗余，但不可消除对连续数据尾值的校验。

`lastDataSequence` 与 journal revision 没有一一对应：标题处理、过滤、resize/scrollback 操作都会影响映射。authority 记录接受/应用的序列水位，收到 seal 后关闭新的会话终端变更 admission，等待既有串行操作和 tracker 的异步解析完成，再固定 final revision。应用失败记录已应用前缀与错误，不将最后一个入队位置包装成成功最终状态。journal/持久化失败继续沿现有错误语义处理，但不能冒充 provider 正常源完成。

`runtimeSupervisorMain.ts::enqueueTerminalOperation()` 只保证已提交操作保序，tracker.write仍是异步；当前finalize使用createFreshSnapshot的never策略，不等于tracker.flush已完成。候选必须使用真实解析屏障，不能以journal.flush代证；现有journal仍可能向页面重放，不能由此直接宣称已发生页面缺尾。adapter不得在authority操作链中等待一个必须由同一条链继续消费data才能完成的provider promise，防止自等待。

候选对现有 `ExecutionSessionProcess` 的最小扩展是 capability-gated 的 `onProcessResult`、`onOutputSeal`、`onResourceResult`，以及分开的 stop/cancel 操作；`onData` 可保留，adapter 内部关联序号。旧 onExit 仅供旧能力分支，不能同时作为新会话第二条 finalize 入口。最终生产名称在模型和接入评审后收口，不在本阶段改 bridge、Host 或 Supervisor。

### 原生释放与终端/页面消费

native 回收等待的是自身读写、waiter/thread 和 buffer 所有权安全，不等待所有 Webview 完成。adapter 已转移到 authority 的独立文本允许在 native 释放后继续解析；authority 来源须保留到合法读者结算。候选诊断先 consumerComplete 再 Close 是本次安全对照门槛，不应原封不动升级为“页面挂起永远占着 HPCON”的生产规则。

输出封口和资源报告可以分别完成；Close 阻塞/失败不能让已经收到的尾部和进程结果不可见，也不能被吞掉写成 released。未知资源留在不可复用的 owner 记录中，禁止 resize/clear/重复 close；后续是否隔离到专用 native worker、允许何种恢复或停止新建，仍需异常路径与有界性验证。不能无限累积未知 owner，也不能为了清理一个 owner 重启整个共享 Supervisor、结束其他 live 会话。该隔离/容量策略未选定，是生产接入阻塞项。

## 5. 停止、取消与预算

候选控制操作分为 `requestStop(requestId, mode)`、`cancelOutput(requestId, reason)` 与 provider 内部的 `releaseOwnedResources`；相同 requestId/参数重复共享一个操作结果，冲突参数拒绝，generation 不匹配拒绝。发出请求和实际生效分别留证，不把 Promise resolve 当作进程退出、EOF 或页面应用凭证。

`requestStop` 只请求结束实际会话主体，graceful/force 的平台可用性如实返回 accepted/unsupported/failed；正常读取继续，stop 后真实排空仍可是 eof。若具体强制操作同时破坏 pipe，则源为 interrupted/error，而不是因为用户点过 Stop 就预先指定结果。不能未经实现证据假定所有平台都有 Unix signal 或可靠的进程树终止。

`cancelOutput` 是会话 owner 决定停止继续获取输出，不是页面读者 close；适用 delete、已批准的收尾期限或 source 故障处置。取消请求后不启动下一次 read，但已在途 read/消息、已读成功的正长度 readable-buffer、decoder 和已接受操作仍要按所有权结算。取消生效导致截断时结果为 interrupted；若真实 EOF 先完成且取消没有实际截断，保留 eof。追加 audit reader 取得的系统残留不能混入 candidate 交付。

取消或超时期间尚有无法结算的 read，不能立即生成虚假 sourceEnd 或 lastDataSequence。等待 API 可以返回“仍未结算”的观察报告，同时保留 owner/在途责任并继续接收安全的迟到回调；只有来源确已终止或不可恢复地失联、已有可用内容已移交时，才以 interrupted/error/unknown 封口。失联后的不可恢复丢失必须明确记录，不能以“未知”免除已确认收到内容的保留义务。生产如何隔离永久未返回操作仍是接入前阻塞项。

本阶段不决定主进程退出到收尾的毫秒数，不从普通后代职责边界推导“立即关闭 PTY”。生产预算需兼顾已成功写入尾部、所有权边界、事件循环响应、并发和支持版本；后文诊断预算只约束测试工具，不能写成产品超时。

## 6. 读者结算与兼容

保留现有 `sessionId/authorityId/readId`、连接 owner、surface 生命周期和分页 revision。候选新能力 `terminalReadSettlementV1` 扩展 close 的 outcome，而非新建第二套消费水位：`applied(finalRevision)` 仅由真实 xterm/control callback 完成后提交；`cancelled(reason)` 由页面放弃读者提交；连接失效由服务器登记 lost，不信任客户端自报其他连接的结果。旧 close 的 outcome 缺失即 legacy-released，不默认为 applied。

选择扩展close作为本轮模型候选，是为了让结算和读者释放在同一次服务端处理完成；独立ACK是可选对照，但需要定义ACK与旧close/断连竞态及保存期限。若实现无法在同一事务内保留幂等结果，必须重评，不能先删除read再默默丢掉结果。现有terminalAppliedRevisionAckV1是增量应用水位，不自动代表终态结算；生产wire字段和能力握手仍未批准。

服务端校验完整身份、读者归属、最终 revision 已固定、该读者获得的内容覆盖目标；同一结果重复幂等，冲突结果拒绝。服务端只能核验声明与已交付范围一致，不能仅凭发出页面或收到数字证明 xterm 已执行，因此实际 Webview callback 测试不可省略。authority固定finalRevision的同一串行边界关闭新open准入，不等节点保存或retiring标记才关闭；此前已获准但回包仍在途的open须计入既有读者。一个读者取消不改变其他读者结果。

协商新结算能力后，Webview协议解析、CanvasPanelManager、relay/client和Supervisor每一跳都必须校验并保留outcome；非法/未知outcome拒绝，不能被重建identity时丢弃后降成旧close。旧消息没有outcome才适用legacy-released。服务端删除读者前保留同一连接内的幂等结算回执，过期后只能报告不可确认/已释放，不能捏造第二次applied；回执是有界内存元数据，不保存正文或形成completed历史。数量/期限和断连行为须在接入前确定，未定时不能启用生产能力。

当前TerminalPagedProjection.finishExit已经等待真实写队列/xterm回调，缺口在跨层结果表达，不是页面完全没有应用屏障。applied(finalRevision)只证明权威stream的终端操作；随后本地追加的退出提示不属于该revision，须另验证显示顺序，不倒推为源数据。relay的onReleased只释放连接引用，RPC失败或断连要可观测，不能被当作应用成功或未经证实的数据丢失。

源能力、资源跟踪能力、读者结算能力分开判定，不凭 transport 协议版本替旧 provider 补能力。新 Host 接旧 Supervisor/session 保留原 backend/storage/session/generation 绑定，源结果 unknown、旧 close 仍可释放但不报告应用成功；旧 Host 接新 Supervisor 走已验证旧分支，不收到必须理解的新 mandatory 字段。新能力只有双方 opt-in 后启用，旧会话不被迁移、重启或改写 storage。

正常来源物理退役仍需轻量节点保存成功、禁止新读者、既有读者结算及已知资源职责完成。错误/unknown 不能伪装成这一成功门槛，但保存/页面/原生资源可分别报告和清理各自安全部分。不得以等待用户重开或保存 completed 正文补偿未知结果；snapshot-only 的快照保留语义不在这里改变。

## 7. 平台失败表与证据限制

本表定义需要报告的事实，不保证所有失败已经存在安全回收实现。后续原生注入须固定真实故障点、控制组、仍持有的 owner 和可观测前提；不能用合成异常替代实际 API 的失败证明。

| 边界 | 必须保留的事实与后续约束 |
| --- | --- |
| create/pipe/input/reader 部分初始化 | 每取得一项即登记，失败仅释放确切拥有且不被使用的资源。尚无子进程不伪造 exit0；已有 HPCON 不因 create 整体失败而遗漏。 |
| CreateProcess 成功但 connect 后半失败 | 先保留 hProcess/主体身份再做可能失败的 Release/TSFN/thread 初始化；启动请求失败不等于主体不存在。安全停止/等待及输出结算必须单列，不依赖 JS 没收到返回值来清理 PID。 |
| bundled Release 缺符号/失败 HRESULT | 不报 releaseSucceeded；Release 与最终 Close 是不同动作，调用位置/次数及真实错误保留。失败后是否可继续读/Close另做原生验证，不能重复 Release 求成功。 |
| wait 失败或退出码查询失败 | 前者不能证明已退出；后者若 wait 已成功，可保留终止事实但 exitCode未知。下一轮结果格式需容纳这个事实，不将两种错误都映射为 exit0。 |
| TSFN 排队拒绝、callback抛错、Release/线程启动失败、环境销毁 | native wait 与 JS 通知分别结算；必须有无需 JS callback 成功也能管理自身 payload/线程的 owner 路径。正常92次成功不证明这些路径安全。 |
| reader error/worker失联/close无end/无EOF | 已读内容移交，源 error/unknown；原生资源依据独立前提处置，不用销毁 reader 后产生的 close 冒充 EOF。 |
| authority拒绝/挂起、页面取消/断连 | authority失败与读者结算区分；已拥有独立内容不能被 native 清理清空，也不因某一页面失效阻止其他读者收尾。 |
| 最终 Close缺导出/不返回/返回后重复调用 | 未调用、已调用未确认、已返回分别记录；同 owner 只有一个已接受的释放尝试。void API无HRESULT；未确认状态禁止盲重试或重用 token。 |
| 多会话/取消/resize/Close交错 | generation和单owner同步必须真实覆盖所有入口；关闭后拒绝原生操作，旧回调不污染新会话，某会话失败不隐式结束其他会话。 |

Windows 当前诊断 `windows-hpcon-owner-patch.mjs` 将 lifecycleFailed、TSFN callback、consumer gate 等都作为自然 Close 的前提，故意 fail-closed 以避免污染对照；它没有交付失败路径的长期回收策略。正常对象引用语义、旧具体句柄身份不确定及本轮四个 no-close 失败继续保留。builtin 可能需要不同的 Close/读取协调，不能套用 bundled DLL 的先 EOF gate 宣称支持；同步 Close 不返回也不能由同线程 JS timer 兜底。

只读复核还发现固定node-addon-api7.1.1的 `node_modules/node-pty/node_modules/node-addon-api/napi-inl.h::ThreadSafeFunction::CallJS()` 在env与callback均为空时直接返回，不执行CallbackWrapper。因此诊断patch里放在callback内部的ExitEvent RAII不能证明环境销毁时的排队payload已释放。`conpty.cc`的CreateProcess成功后也先执行DLL/Release再登记hShell。二者都是需覆盖的静态失败窗口，不是本轮已复现native异常；保留正常92次TSFN成功证据，不借此推断其已发生泄漏。

Unix 不再通过继承 master 的 helper 观察 readiness，以免改变共享 O_NONBLOCK；不假定 poll ready 就是 EOF，不在 read 未完成时 close/复用 fd。Linux EIO 和 macOS read0 的平台映射保留，kqueue/control fd/reader/waiter 各有 owner，成功关闭一个不证明全部回收；关闭失败不能不加区分地按数值 fd 重试，防止误关复用槽位。轮询候选的公平性、CPU、并发成本还未成为生产预算。

## 8. 下一轮诊断冻结：模型与工具先行

本阶段只冻结下列 D1/D2，不运行这两组新矩阵或新增原生失败注入。生产不读取诊断模型的类型或状态机。独立诊断分支新增文件，旧39项契约、25项屏障及全部原生脚本/断言/工件逐字保留；新失败保存新目录，禁止覆盖或反复重跑筛绿。

### D1：有限契约模型

候选新文件 `scripts/diagnostics/runtime-provider-lifecycle-model-v1.mjs` 与 `scripts/diagnostics/diagnose-runtime-provider-lifecycle-v1.mjs`。模型只注入上述事实，不制造可信 EOF；固定下列24组、37个独立子案例，每个一次，schedule运行前落盘。M07四例、M18两例、M21三例、M24八例，其余各一例；每个子案例用全新状态和独立trace，首个fault不能掩盖其他分支。读取旧模型是对照，不重写它们以满足新契约。

| ID | 单项输入与期望 |
| --- | --- |
| M01 | open返回前process先到、随后首块data/eof；sink已绑定、不提前封口，非零退出保留 |
| M02 | eof先到、随后process；空输出sequence0，只封口一次 |
| M03 | signal-only退出；不补造整数exit0 |
| M04 | wait失败且源继续，随后同owner取得退出证明；不提前关闭admission，不覆盖未知观察 |
| M05 | wait证明终止、exitCode查询失败；与未证明终止分开 |
| M06 | 连续块与decoder尾片；最后序号在sourceEnd前交付 |
| M07 | 缺序号/重复冲突/封口后data/seal水位不一致，四个独立负例逐个拒绝并留fault |
| M08 | 相同process/source重复；幂等且没有第二次seal |
| M09 | stop请求后真实EOF；命令与源结果分开 |
| M10 | 取消请求但EOF先结算；未生效取消不改写EOF |
| M11 | 取消生效时在途read有data；移交全部拥有数据再interrupted |
| M12 | read永久未回调；截止只返回未结算观察，不伪造sourceEnd |
| M13 | worker失联且已有独立消息排队；保留可用前缀，源unknown |
| M14 | authority异步解析尚未完成；无成功finalRevision |
| M15 | authority写入拒绝；已应用前缀及失败单列，不宣称applied |
| M16 | native释放先于页面应用；独立队列和读者仍可完成 |
| M17 | Close已调用但超时后才返回；先unknown后同操作released，保留首次观察、不重复调用或重发seal |
| M18 | 同requestId释放重复/冲突参数；共享结果或拒绝冲突 |
| M19 | 两个execution同序号/旧generation回调；状态不串会话 |
| M20 | 双读者一applied一cancelled；互不取消，结算各自身份 |
| M21 | final目标未到/未交付/旧readId的applied；分别拒绝 |
| M22 | open在途与来源退役竞争；已获准读者计入，新的拒绝 |
| M23 | 页面lost及legacy close；释放不计applied，不补新页面 |
| M24 | source可信/资源可跟踪/读者结算协商三能力各开关，共八例；可applied且source未知，也可eof且reader仅legacy-released |

本地先以 Node25.6.0 与 Electron-as-Node39.8.7 各运行37子案例，输出到两个全新目录；runner阶段三平台固定 Node22.23.2各37子案例。预期37/37仅证明确定性状态约束，不计为原生资源或真实Host验证。validator必须按完整schedule独立重算，不只信任模型的pass字段；自测包括删事件、改序号/身份、丢终态、缺工件及第一项损坏后继续验证。

### D2：诊断父进程的有界返回

候选新增 `scripts/diagnostics/diagnostic-process-guard-v2.mjs` 与 `scripts/diagnostics/diagnose-process-guard-v2.mjs`，不修改HPCON原入口。guard分别记录 child的exit、stdio close、计时截止和控制调用；到预算后必须独立结算自己的Promise，不能只kill后继续无限等close。超时输出为截断/不完整工件，绝不是自然EOF。原生同步操作仍在隔离driver中，父timer不得与被测同步调用处于同一阻塞线程。

固定每项deadline1000ms、截止后清理/返回最多1000ms、外层独立driver hard cutoff5000ms加1000ms最终观测；这些是诊断参数。t0是控制器调用spawn之前的单调时间，包含启动与ready握手，不因ready/exit或kill重置；G04在截止前未建立ready/主体退出前提即precondition-failure，不能无限等待setup。早期返回以真实exit+stdio关闭/工件结算为准，deadline按单调时钟检查；所有路径共享一次性结算，kill返回false或抛错也不能取消绝对返回期限。硬截止是独立活着的观察进程约束，不宣称在操作系统无法调度时提供实时保证。只允许对当前控制器确切拥有的ChildProcess做强制控制，不从日志PID取得清理权限；G04的受控继承helper是下面单列的观察例外，不使用被测PTY fd。本矩阵零PTY。

固定 G01正常exit0/stdio关闭、G02自然exit7、G03 spawn失败、G04 driver先exit0但受控helper仍持有stdio、G05 driver在deadline时仍运行、G06a/G06b分别注入kill抛错/返回false且close一直缺失、G07 stdio先关闭但driver仍运行后自然退出。八个子项各连续3次，共24条/平台；Linux/macOS/Windows固定Node22.23.2共72条，其中G06两类是明确synthetic的18条，真实进程/启动控制共54条，均零PTY。本地先跑本平台24条，不替代其他平台。G04–G06达到截止的返回必须是显式失败/不确定；控制套件可以验证“正确识别失败”而成功，但raw结果不得标为自然成功。G07不能因stdio先关就提前报告进程已退出。

G04不能假定公有Node API能取得driver stdio的子侧写端并转给兄弟helper。采用driver创建一个继承stdout/stderr的受控helper，helper提供私有nonce控制/完成回执及3000ms自限生存期；driver在helper-ready后退出。运行前必须证明确实保持stdio、主体已在deadline前退出，且helper不被Windows父Node Job提前结束；前提不成立记precondition-failure，不换成普通pipe模型或隐藏失败。控制器可协作请求helper自退，不按其PID强杀；仅有helper回执/stdio结束不冒称OS退出已独立wait确认，无法证明的清理状态保留unknown。该控制只证明guard不被stdio拖住，不成为后代托管或原生资源释放验收。

已知driver的控制结果、G04协作回执与可观察的helper状态独立保存，缺回执/超出自限期保留fixture清理失败，不阻止guard按预算返回；不得以runner销毁环境当作回收成功。断开监听/销毁自身日志管道必须注明截断，保留此前stdout/stderr，迟到事实追加而不改首次返回报告，不能让未结算ChildProcess引用重新拖住整个父进程。外层仅能终止它直接拥有的测试driver；若G04预检不能满足上述限定，在设计中登记未覆盖，先收口其他控制而不宣称全部硬返回矩阵通过。

### 原生异常验证的下一门槛

D1/D2完成后才逐平台另冻原生失败矩阵，不在本轮虚构fixture或结果。每个平台至少要把第7节中的partial-create、wait/通知失败、reader取消与正长度已读缓冲、最终release失败/挂起、两个并发会话分开验证，并有同版本自然正对照。Windows TSFN环境销毁/已排队payload和hShell登记前失败、Unix在途read/control-fd生命周期都是必须覆盖的输入；无法安全注入的API点标未覆盖，不用JS抛异常声称已经原生覆盖。builtin、旧Windows版本、真实Agent/Host/Webview/packaged仍独立开放。

## 9. 接入门槛与验证记录

进入业务实施前须同时满足：结果格式与实际native证据对应；平台所有权失败路径有明确处置且不会无限累积；取消和生产预算有设计依据；bridge/authority/读者协议的能力分流及两个运行模式接入方案通过评审；分发与支持版本矩阵已明确。新adapter不能仅根据当前隔离候选通过就成为默认provider，也不能把诊断的轮询、删除kill导出或静默失败策略直接带入生产。

本阶段交付物是契约提案、有限故障分类和D1/D2冻结协议；不是新模型或原生矩阵的通过记录。正式运行须记录输入commit、运行时/OS、schedule、原始trace、结果及源码hash，并完整下载离线复核。现有自然路径结果与旧失败引用本树原生候选设计第30节，新增结论只按实际证据更新，不追认任何历史失败为通过。

设计复审分别核查Windows/native、Unix/guard与authority/页面三条边界，修订M05类型、唯一序号、迟到补证、新读者准入、outcome各跳保留及G04可行性限制。运行时主工作树 `dev-session-canvas2` 的既有bridge、tracker、Supervisor协议聚合回归与该树 `.debug/lifecycle-contract-design-v1-node25` 的旧39项契约通过；不将它们计为D1/D2或生产失败路径验证。

## 10. D1/D2 实施约束（2026-09-21）

第8节的运行前冻结协议保持不变，本阶段开始实现四个新诊断文件及 `.github/workflows/runtime-lifecycle-contract-v1.yml`。D1、D2分别执行并离线复核，一组失败不跳过另一组；三平台固定Node22.23.2，仅用Node标准库、不安装依赖、不加载PTY。每组schedule在执行前保存，源码快照/指纹、实际Node/OS/架构、输入commit与runner run/attempt全部留证；旧脚本、断言、历史工件与业务不改。

D2在t0+1950ms开始最终本地capture清理和一次性返回，预留50ms调度开销，但验收上限仍是t0+2000ms，不增加宽限。t0在spawn之前，ready不能重置预算。G04的Windows helper拟以detached模式避免父Node自身Job在driver退出时提前终止它，同时显式继承stdio；这不能静态保证runner外层Job行为，仍必须观察driver退出后的私有nonce响应及stdio持有，缺前提就保留precondition-failure。helper内核退出未经独立wait证明时保留unknown，不拿协作回执冒充资源全部回收，也不因此否定已证明的guard返回控制。

实现与校验器分别检查原始事实；自测删除事件、改序号/身份、缺终态/工件及第一项损坏后继续遍历全部schedule。控制测试正确识别预期失败可以通过，但raw的超时、截断、非零退出、未知和前提失败不能改写为自然成功。新结果应在本节之后追加，首次失败和修订原因均保留；这里没有提前声明新矩阵通过。

## 11. 本地实施与首轮证据（2026-09-21）

四个新脚本和workflow仅位于 `runtime-exit-integrity-native-candidates` 独立分支。主运行时分支只同步文档。D1模型有真实deferred parser Promise、重复释放返回Promise引用和完成值的驱动侧观察，以及明确标记的异步消费者callback模拟；不是实际xterm/Host。D2把进程exit、管道end/close、捕获错误、deadline和首次返回分别留证，父观察进程独立执行5000ms截止，额外1000ms不是自然成功宽限。source字节指纹与只读LF规范化核对同时保留，离线校验不执行保存的源码、不相信pass字段，并遍历完整schedule。

D1的 `.debug/provider-lifecycle-v1-node25-first` 与 `.debug/provider-lifecycle-v1-electron39-first` 各37/37，完整离线复核无failures或evidenceErrors；实际运行时分别为Node25.6.0及Electron39.8.7内嵌Node22.22.1。两个本地输入以独立分支9824f166工作区及归档源码指纹为准，不谎称在尚未创建的新commit运行。开发自测v1原样保留；复审发现M18初版仅由模型自报同Promise，v2改由harness比较真实返回引用及两个fulfilled值，同时观察解析Promise的pending/fulfilled/rejected和消费者callback。v2自测37正例、12类负对照通过，不追认v1具备新增证明。

D2的 `.debug/process-guard-v2-local-first` 原24项control-pass、最长1952.568317ms返回保留，并用其归档版本独立复核。末审发现G04/G05在deadline后协作或强制结束、收到真实管道end时仍写captureIntegrity=complete，整体完整性表达不足；不能把这些首轮输出当作新分类已验证。修订不改期限或案例，将整体采集标记为deadline-incomplete，保留真实endObserved；error/truncated优先于该分类。新目录 `.debug/process-guard-v2-local-v2-deadline-integrity` 在Linux/Node25.6.0再次完整24项及离线复核通过，最长1952.428426ms；raw为9条natural-exit、3条spawn-error、12条deadline-exceeded，含18条真实进程/启动控制和6条synthetic，零PTY。G04三次主体已退出但stdio仍被helper持有的前提均成立；helper仍只确认协作回执，不补造OS退出wait。

D2最终自测25项通过，含有效G01/G07基线、9类重新计算manifest后的语义篡改、首项损坏后继续检查末项，以及超时后EOF不晋升完整。初版/增强版自测、两次开发矩阵及两份正式本地输入均保留。独立只读复审已收口Promise自证、capture-error缺维度、outer自然截止宽限和deadline完整性表达问题，没有放宽冻结协议。主运行时树本轮bridge、tracker、Supervisor协议聚合回归再次通过，workflow YAML/内嵌脚本及精确Node版本拒绝检查通过。

本节收口时三平台runner尚未运行，不能将本地Linux、Electron注入模型或静态Windows审查记为macOS/Windows已通过。下一步推送独立输入，运行完整三平台D1/D2并下载全部工件复算；新原生异常、builtin、正缓冲、并发、真实Agent/Host/Webview/packaged及生产预算仍开放。新guard也没有追溯替换旧冻结入口中的guarded等待。

## 12. 三平台首次矩阵与完整复核（2026-09-21）

独立输入 `d173c099d37f83bb3178d280a6a6d8b80d984b92` 经fetch/rebase后推送，workflow run `35620967433`、attempt1三平台全部success，没有重跑。三个完整ZIP均下载到主运行时工作树 `.debug/lifecycle-contract-35620967433/`，逐包校验API声明的大小和SHA256，各1280成员；解压后使用当前同版本入口分别复核D1/D2，并将四个脚本、workflow及冻结契约共六份源码快照与该commit对账。Windows换行仅在比较Git文本时只读规范化，原字节/ZIP/指纹不改。补充复核在同目录 `offline-review-v1.json`，不覆盖原工件。

| 实际runner环境，均Node22.23.2 | D1模型 | D2原校验器结果，前提另审 | 最大guard返回 / 原始时钟观察，ms | 最大outer返回，ms |
| --- | --- | --- | --- | --- |
| Ubuntu24 x64，kernel6.17.0-1022-azure，image20260907.300.1 | 37/37 | 24/24 | 1950.919840 / 1951.046799 | 2004.825633 |
| macOS26 arm64，Darwin25.6.0，image20260907.0351.1 | 37/37 | 24/24 | 1980.901916 / 1980.999041 | 2103.605875 |
| Windows Server2025 Datacenter x64，10.0.26100，image20260907.229.1 | 37/37 | 24/24 | 1960.830200 / 1960.969100 | 2150.444700 |

D1合计111个独立模型子案例，D2原校验器合计72条通过，其中54条真实进程/启动控制、18条synthetic，零PTY；两个原离线校验器均完整遍历且未报语义失败或工件错误。这不等于D2所有冻结前提都已成立：后续独立源码/时间审计发现Windows G07三项夹具未执行真实提前关闭，见第13节。每个平台另外运行D1的37正例/12类负对照自测和D2的25项自测，额外自测夹具不计入上述主矩阵。

每个平台的raw结果仍为9条natural-exit（包括G02的exit7）、3条spawn-error及12条deadline-exceeded；捕获字段为12条complete、6条deadline-incomplete、6条truncated。complete中的G03只是失败启动后的空日志管道完成，不代表创建了进程或自然exit0。控制pass只表示原校验器接受观察结果，不能将12个deadline和3个spawn-error改成被测路径自然成功。三平台G04均取得helper-ready、driver真实exit0、exit后nonce ping/pong以及deadline前两stdio仍持有的证据；helper完成仍是协作回执，`osExit=unobserved`、`cleanup=os-exit-unknown`保持不变。G07原校验器在三平台均看到两流end/close通知先于child-exit通知，guard未提前返回；这仅是通知偏序，Windows真实提前关闭前提尚未成立。外层均自然完成、没有命中5000ms硬截止。

| 平台 / artifact ID | 完整ZIP SHA256 |
| --- | --- |
| Linux / 10648081653 | `8fcf2607481a9b498991d850208928e0ad380fa5dafaa320ed5ec2a91c116a2f` |
| macOS / 10649965248 | `28b7d77edcef6e35e4b71df6af8de79ed912ddcd4e9b8bdfdffb81f2554ab56a` |
| Windows / 10649136626 | `1d05a7dcbdca16d71019b8b5910ca9dc45cb023b0256060e9582080ec4343268` |

本轮建立D1有限模型及D2各平台有界返回的证据，Windows G07三项的特定前提仍未建立，不能将D2整组标为无缺口验收完成。其他69条控制的证据不因这个夹具缺口被抹去，但也不是原生PTY/EOF、终端资源释放、实际Agent/Host/Webview或packaged验收；不覆盖其他Windows客户端/旧版本、macOS架构和生产并发。Windows正常退出对象被引用的语义不变，本轮不关闭未知句柄或按PID强杀。旧冻结guarded入口仍保留原实现，新guard未追溯替换它。

下一阶段优先另冻Windows G07真实stdio提前关闭与关闭后主体仍可执行的独立证明，使用新版本/新入口，不修改本轮冻结脚本或通过改旧断言求绿。该缺口收口后，再逐平台设计和冻结partial-create、wait/通知失败、在途取消与正长度已读缓冲、最终release失败/挂起、两个并发会话的原生矩阵，并明确unknown owner的有界隔离与处置门槛。这里不选定生产取消预算、不接入业务，设计继续比较中/验证中，退出完整性总计划保持active。

## 13. Windows G07 夹具前提缺口与复核结论（2026-09-22）

本节追加独立审计结论，不改第8节冻结输入、第12节原校验器结果或run35620967433的工件。Windows G07-1/2/3的“stdio先真实关闭、主体仍继续运行”前提未建立，分类为前提未建立（not-established）；这三条不能计作该场景已验收。原72条control-pass及其他69条控制的依据保留，不以新的解释覆盖历史记录。

固定输入的 `scripts/diagnostics/diagnose-process-guard-v2.mjs:131` 和 `:132` 调用 `fs.closeSync(1)`、`fs.closeSync(2)`，随后在250ms定时器中自然退出。固定Node22.23.2的官方调用链为 `lib/fs.js:516` 的closeSync，经 `src/node_file.cc:1007` 的uv_fs_close，到 `deps/uv/src/win/fs.c:681` 的fs__close。该Windows分支只在 `fd > 2` 时调用 `_close(fd)`，标准fd0/1/2直接返回成功，没有实际关闭。因此不能从JS调用不抛错推导此夹具已关闭标准输出。这里确认的是固定libuv平台实现语义，不是Windows系统bug，也不是Terminal/Agent业务缺陷证据。

| Windows案例 | 首个stdout块，ms | stdout end，ms | stdout close，ms | child-exit通知，ms |
| --- | --- | --- | --- | --- |
| G07-1 | 58.5962 | 314.1353 | 316.3174 | 316.5896 |
| G07-2 | 61.0528 | 315.3610 | 317.5805 | 317.8744 |
| G07-3 | 61.2261 | 315.9397 | 318.7246 | 319.0809 |

表中时间来自guard的spawn前单调t0，不跨进程拼接时钟。两路管道结束均接近250ms等待后的退出通知，而非夹具发起close后立即结束。原verifier在 `diagnose-process-guard-v2.mjs:385`、`:389`、`:391` 只检查父端流通知先于child-exit通知及guard未提前返回；通知顺序不证明两通知之间主体仍可执行。macOS三项在两流结束后约250ms才收到exit，支持当地提前关闭控制，但也不能替Windows补证或外推PTY。

完整独立审计另存主运行时树 `.debug/lifecycle-contract-35620967433/windows-independent-audit-v1.json`，SHA256为 `4d46bb38ee69dd575dfe6ee0e4010af2dda7033660d400bf04cf0efa26d1a2d1`，含六输入快照对账、24条raw时间、G04/G07及官方源带行号摘录。macOS独立审计为同目录 `macos-independent-audit-v1.json`，SHA256为 `7c6166f810c7ea3b2ff4df9254543bffac963a6f75d4cfbb3c8c7522548a3eac`。原始ZIP和源字节指纹保持不变，审计JSON不是替换后的测试结果。

官方固定版本来源及下载字节SHA256如下，不用浮动main分支推断本次runner：

| 来源 | SHA256 |
| --- | --- |
| https://raw.githubusercontent.com/nodejs/node/v22.23.2/lib/fs.js | `7ce17b5a74abfe1b988222f62522a70958bac154f1828a11b047379648c688b6` |
| https://raw.githubusercontent.com/nodejs/node/v22.23.2/src/node_file.cc | `d9bd85b74171f392d96217ca5e1fbf522b504c2cb94f0f84965ebd4ceee9ef06` |
| https://raw.githubusercontent.com/nodejs/node/v22.23.2/deps/uv/src/win/fs.c | `60c76976514f427fa0be21c1c7986c2ab1d9e2e77b9d5bcf8c7ab99ed36b0693` |

下一阶段先另冻新入口/版本：由明确owner真实关闭两路stdio，父端确认两路结束后，使用独立控制通道取得同一主体仍可执行的nonce响应，再允许主体退出。关闭操作的具体平台实现、身份与资源所有权、控制通道和失败分类须在运行前设计并审查；当前没有选定新API。只看到EOF先于exit通知、PID仍可查询或已退出Process对象仍被引用，均不能替代存活前提。缺前提就报告未建立，不修改原G07、放宽断言或重新运行本轮筛绿。

本轮D1的111个模型子案例和D2有界返回观察成立，但D2尚有三条场景覆盖缺口；缺口关闭前不越过原生异常矩阵的前置门槛。后续仍需partial-create、wait/通知失败、在途取消与正长度缓冲、release失败/挂起、并发及unknown owner有界隔离的独立设计，生产取消预算、业务接入和完整产品验收不在本节宣称完成。

## 14. Windows G07 独立前提控制协议（2026-09-22，运行前冻结）

本增量只补第13节缺失的Windows G07前提，不修改旧D2脚本、guard-v2、断言或原72条结果。独立诊断树新增 `scripts/diagnostics/windows-stdio-close-control.c`、`scripts/diagnostics/diagnose-windows-stdio-close.mjs` 和 `.github/workflows/runtime-windows-stdio-close.yml`。固定Node22.23.2、Windows x64/MSVC，零PTY、不安装业务依赖；Linux本地只做工具逻辑/合成校验，不计Windows原生样本。旧模型D1和Linux/macOS控制不重复运行。

### 所有权与观察方式

新C程序就是guard直接创建的被测主体，没有启动器或后代。它仅取得本进程继承的stdout/stderr写端，检查两者有效、互异且类型为pipe，写入带本次身份的短marker，并记录WriteFile实际字节数。关闭使用真实Win32句柄操作，不通过已知会跳过标准fd的fs.closeSync；先登记owner，再单次解除标准句柄槽位与CloseHandle，分别记录调用结果。私有控制管道在关闭前建立，不复用或重新打开旧stdout/stderr槽位；不调用CRT stdio、不在关闭后重新打开CRT fd，终止采用ExitProcess避免CRT退出清理再次操作旧fd。这里只关闭确切属于该fixture的句柄，不关闭Supervisor、OS或其他进程的资源。

控制通道使用父进程创建的随机命名管道，与受测两路stdio分开。每项全新身份和连接，验证一次hello中的nonce、mode及主体PID与直接ChildProcess一致；身份报告本身不是存活证明。父端只有在两路真实end/close、完整marker和native关闭回执均已观察到后，才生成新的随机challenge。主体经控制管道返回匹配pong，随后父端按自身单调时钟持有至少100ms，再生成第二个不同challenge并取得pong，最后发出退出许可。两次challenge不能提前放进argv/config或通过受测stdio传输，收到旧token、重复连接、身份不符或提前退出许可均失败；关闭后的新响应证明同一受控主体仍可执行，而不是由PID可查询或JS通知排序推断存活。

所有事件在父端用连续序号和同一单调时钟记录；native序号只用于核对主体内的操作顺序，不与父端时钟数值拼接。真实EOF、native关闭回执、控制响应及guard Promise尚未返回分别核验。100ms是诊断持有窗口，不是产品收尾预算；计时器触发后须重查单调截止点，不能靠调度碰巧顺序证明。

第二次challenge的100ms起点是父端观察首个有效pong的时刻，两次pong及退出许可均须在原guard t0+1000ms前。控制server须在spawn前ready，record先将原事件落盘、再异步推进握手；不能等待guard返回才开始控制。deadline、捕获主动销毁或guard已返回后不再启动挑战，迟到响应只追加证据，不补正首次失败。

两次pong证明主体在两个响应时刻仍执行，第二次距父端观察首次至少100ms；这不是对整个间隔每个瞬间的OS调度或wait测量。自限watchdog使用独立线程，线程仅等待3000ms后ExitProcess非零，创建所得线程HANDLE由创建方立即单次关闭；线程仍运行的语义不与句柄关闭混淆。管道阻塞读写也受该自限约束，watchdog触发永远不是自然成功。

夹具argv固定为 `--pipe <\\.\pipe\dsc-g07-32hex> --run <32hex> --mode <close-wait|keep-open|close-exit>`。控制行采用ASCII、TAB分隔、LF结束，含LF最多512字节，拒绝CR/NUL/多余字段；不引入通用C JSON parser。C到父公共字段是 `DSCG07/1 TYPE RUN SEQ PID QPC FREQ`，SEQ从1连续，QPC/FREQ十进制字符串只作主体内序号/时钟核验。HELLO后缀为MODE；WRITTEN后缀为两路实际字节数、两路GetFileType和distinct，正常为 `40 40 3 3 1`；CLOSED后缀依次是stdout的SetStdHandle/CloseHandle各自BOOL与错误、stderr同四项，正常为 `1 0 1 0 1 0 1 0`。成功时错误归零，失败时立即取得GetLastError，不把陈旧last-error当失败。

PONG后缀为PHASE、TOKEN；EXITING后缀为 `2 TOKEN2`；ERROR后缀为固定OP枚举和WIN32ERR。父到C严格为 `DSCG07/1 PING RUN PHASE TOKEN` 或 `DSCG07/1 EXIT RUN 2 TOKEN2`（字段实际以TAB分隔）。phase顺序1再2，两个token为不同的32位hex，EXIT必须匹配已响应phase2。stdout/stderr的原始marker精确为 `stdout:<RUN>\n`、`stderr:<RUN>\n`，各40字节，各一次WriteFile且记录实际写入数；短写/API错误/非法协议均明确失败、非零退出。关闭回执本身不替代父端EOF和控制响应。

### 固定矩阵与预算

| 新模式 | 次数 | 预期前提与结果 |
| --- | --- | --- |
| close-wait | 3 | 两路真实关闭、双EOF后两次新challenge/pong与100ms持有成立；guard在主体获准exit0且捕获结算后自然返回，不提前返回，不超时，不截断。 |
| keep-open | 3 | 两路marker后保持写端，不能进入双EOF后challenge；由guard到deadline终止其直接拥有的主体。必须拒绝目标前提，raw保留deadline/不完整，不当作自然成功。 |
| close-exit | 3 | 两路真实关闭后主体直接exit0，不读取或回复challenge；即使父端先见流结束再见exit，也必须拒绝存活前提。guard可自然完成，不能因此把前提标为已建立。 |

合计9个新真实进程控制，无synthetic主样本、无PTY。两个负控“按预期被拒绝”可使控制套件通过，但每项的 `preconditionEstablished`、guard原始结果和失败/未知须独立保存，不把前提失败改成正例通过。缺hello/marker/关闭回执、启动/控制错误、意外早退、超时和工件缺失均不能算作有意负控成立。

close-exit的预期对端退出可能使父端挑战写入遇到EPIPE/ECONNRESET，或收到控制end/close早于child-exit通知。只在完整HELLO/WRITTEN/成功CLOSED、精确marker/双EOF、自然exit0且没有PONG/native ERROR等预定轨迹全部成立时，将这类已退出对端的传输结果单列为预期观察；仍保留原错误，不推广为忽略所有channel-error，更不能让它建立活进程前提。其他错误及正例控制通道错误仍失败。

原样导入 `diagnostic-process-guard-v2.mjs`，固定spawn前t0、1000ms工作截止、总2000ms返回上限、1950ms开始最终结算；本阶段不修改该实现或扩大门槛。每项由另一个独立Node进程观察controller，5000ms硬截止加1000ms最终观察，外层只能终止自己直接拥有的controller。fixture另有3000ms自限寿命，控制断开不无限等待；自限/外层干预必须记录为失败，不能算自然完成。私有控制server、socket、定时器与日志也须有界收口；编译及平台预检有独立工具预算，不计作guard启动后的宽限。

### 工件、校验与进入下一阶段的门槛

完整schedule在执行前保存，每项保存config、源码/原guard/编译工具与参数、实际EXE字节指纹、运行时/OS/runner输入commit、stdout/stderr原字节、native控制消息、父guard/outer原始trace、首次返回和独立结果。所有文件写新目录，失败继续全部9项并完整上传；校验器独立重算时序、身份、字节数、原始capture分类和预算，不执行归档代码，也不只读取pass。manifest摘要核对需与固定输入commit/源码快照交叉复核，不仅检查摘要自洽。

编译失败应保留完整编译日志及九项not-run，实际创建数为零，不伪造九个原生样本；逐项错误仍遍历全部schedule。负控通过必须分别满足保留两路写端直到deadline、或确实关闭并自然退出但无有效pong的预定轨迹，不能将任意失败都当作负控成功。

CLI支持 `--self-test`、`--output NEW_DIRECTORY` 和 `--verify-saved DIRECTORY`。合成自测至少拒绝：缺一个EOF、close仅自报而父无EOF、错误身份/token、复用第一次challenge、未满100ms放行、guard提前返回、将负控伪装正例、deadline后补EOF升级完整、缺EXE/改输入指纹、破坏首项后仍遍历末项。自测不是原生成功；首次Windows编译/运行失败也须保存，不以放宽门槛或修改旧实验求绿。

本阶段成功仅表示新正例建立Windows真实关闭后的活进程窗口，且原guard没有因stdio先关闭而提前返回；两个负控证明新oracle拒绝不足前提。旧Windows G07三项仍记not-established，不追认通过。完成原生首次运行和全工件离线复核后，才进入原生partial-create、wait/通知、取消/正长度缓冲、release失败/挂起、并发及unknown owner有界隔离的设计；这里不交付PTY、真实Agent/Host/Webview、生产API或预算。

## 15. G07 新工具实施与本地复审（2026-09-22）

第14节协议已由独立分支eb37902c、主运行时文档fb99eed9提交冻结。独立诊断树新增C夹具、JS入口和Windows-only workflow，原guard-v2、原G07及全部旧实验不改。C直接操作两路继承owner，控制与受测输出分开，MSVC构建使用/W4 /WX /O2 /TC并归档编译器、SDK环境、参数、日志及实际EXE；本地没有Windows编译器，不能提前声明原生编译通过。

本地 `.debug/windows-stdio-close-selftest-v1-first` 的21项原结果保留。只读复审发现ERROR操作名大小写不匹配、outer捕获仅信快照及token负例只改冗余字段等工具缺口；新版补固定native错误枚举，从原始outer end/close/exit派生结果，token负例同步raw wire/解析值/原字节并明确检查语义拒绝。另去除对native EXITING回执与child-exit两路通知到达顺序的额外假设：退出许可必须早于主体退出，native操作序号/匹配回执仍核验，但不同通道通知不强行排序。keep-open继续拒绝任何控制错误；close-exit有限传输例外严格受第14节完整轨迹约束。

新目录 `.debug/windows-stdio-close-selftest-v2-oracle` 完成27/27合成断言，含九项oracle夹具、首项损坏后继续末项、outer缺事件/提前返回、双EOF/身份/token/持有窗口及完整性篡改。全部是工具自测，真实native创建数零，不追认v1已有新增证明。JS语法、workflow YAML/内嵌脚本、两树文档metadata/引用和历史协议保留检查通过，主树既有bridge回归通过。两份独立源码复审收口后才准备首次runner，不反复执行旧矩阵。

本地源码SHA256：JS为 `1bf7bbfcb7d760374305ba99540219a8fc0ae6bbfeb9095ec304734a6e81bf36`，C为 `d803d2a0bfe57e0d4442833ebc289002dab080318bf20a505fc02e9a47342668`，原guard为 `efb430fc16d1c673cf0ad88fc7b2df2d3649c60922b9cf0288ec7d146f241ade`，workflow为 `c3956642fe6c61bf523db02e26a776481f795d46b23e12814ee022b440b5eb49`。自测输入是eb37902c工作树加归档源码，不写成未来runner commit；Windows换行可能不同，须同时保存原字节摘要并只读LF归一对账。下一步固定新输入一次运行全部九项并完整下载复核；本节没有Windows结果或生产验收结论。

## 16. G07 首次 Windows 原生结果与完整复核（2026-09-22）

第14节冻结协议、第15节实现对应的独立输入为 `cf35904055a840e6e5b3189eb8551beba17d7163`；首次 [run35631266321](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35631266321) attempt1完成且workflow成功，没有重跑。本节仅补新的九项零PTY进程控制，不改run35620967433原72条pass或Windows G07三个not-established记录，也不是PTY或产品退出完整性验收。

### 固定输入与工件

实际环境是Windows Server 2025 Datacenter 10.0.26100 / x64，runner image为 `win25-vs2026 / 20260907.229.1`，Node22.23.2、libuv1.51.0、MSVC Tools14.51.36231（编译器报告19.51.36256.0）、SDK10.0.26100.0。C以 `/W4 /WX /O2 /TC /Bv` 编译成功；stderr为版本列表，没有编译警告。实际EXE SHA256为 `a472e116c449c457d75d6ec5ba53689cb86dc08014f62d084b214c781b465dd7`，编译器字节指纹为 `e6d57100c82ae0310c18b16abfe52bc0df8fbb272ca6c5fb287d485807cfce91`。编译参数、SDK环境和源码快照完整保留，未安装业务依赖。

artifact `runtime-windows-stdio-close-35631266321-1` 的ID为10653794664，完整ZIP为1422720字节、1449成员，SHA256为 `64376d0c6c68521594b137e5f09bda636ea4445f67defa7fc243cdd257fe79ef`，与API size/digest一致。主运行时树 `.debug/stdio-close-35631266321/` 保存run/jobs/artifacts API元数据、ZIP及全部解压内容。五份runner输入快照分别保留原字节摘要，并仅在内存中LF归一后与固定commit对账；C/JS/guard/workflow的LF摘要与第15节一致，工件原字节未修改。

runner合成自测27/27且nativeProcesses为0；实际矩阵checked9、actualCreated9、synthetic:false、pty:false，可信入口离线复算pass:true、无errors/evidenceErrors。两组计数分开，不把合成自测当原生样本。

### 原生判定

| 模式 | 实际次数 | 新前提判定 | guard原始分类 |
| --- | --- | --- | --- |
| close-wait | 3 | 三项均建立：实际双写端关闭，双EOF/close后两次fresh pong及至少100ms持有。 | 三项natural-exit / complete；第二次pong后获准exit0，guard随后返回。 |
| keep-open | 3 | 三项均按预期拒绝：保持写端至deadline，没有challenge/pong或退出许可。 | 三项deadline-exceeded / deadline-incomplete；guard终止自己直接拥有的主体，迟到EOF不改为自然完整。 |
| close-exit | 3 | 三项均按预期拒绝：真实关闭后直接exit0，没有pong或退出许可。 | 三项natural-exit / complete；捕获完整不代表关闭后的存活前提成立。 |

正例各自精确收到stdout/stderr的40字节marker，两路SetStdHandle/CloseHandle均单次成功；native顺序为HELLO、WRITTEN、CLOSED、PONG、PONG、EXITING。下表全部为父端spawn前t0的毫秒值，不拼接native QPC时钟；guard列为父端记录`guard-returned`事件的时刻，不是内部自报时间，也不是调用方await续体时间。

| 正例 | stdout EOF | stderr EOF | challenge1 | pong1 | challenge2 | pong2 | challenge2-pong1 | child-exit | guard-returned事件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| close-wait-1 | 22.6284 | 23.1980 | 24.6204 | 26.3205 | 128.1139 | 128.8659 | 101.7934 | 130.8163 | 131.2240 |
| close-wait-2 | 19.1609 | 19.6807 | 21.1135 | 22.8479 | 124.0095 | 124.7468 | 101.1616 | 127.0241 | 127.4555 |
| close-wait-3 | 18.6984 | 19.8407 | 21.3026 | 23.0531 | 123.8783 | 124.5995 | 100.8252 | 126.8343 | 127.3604 |

三项keep-open的`guard-returned`事件记录分别为1006.8106、1009.5670、1011.7495ms。另从九份trace的`controller-guard-observed`核对真正await后观察：正例分别132.1465、128.5959、128.6105ms，keep-open分别1007.1812、1009.9730、1012.3385ms，close-exit分别23.9235、22.8170、22.6008ms，均在原总2000ms内，超时仍保留不完整分类。全部九项的最大外层结果构造时间为1112.4883ms，`outer-returned`事件记录为1112.4939ms，controller退出/两流close均已观察，且没有命中5000ms截止。该事件后仍执行同步writeJSON再resolve，本轮没有外层调用方await后时间，不能把事件计时当作完整外层返回预算已经独立证明；此工具观察缺口留待新入口补充，不改本轮工件或G07前提结论。九项无主动截断、native ERROR或控制传输错误；keep-open预期直接主体终止仍保留，不能把无外层干预误写成所有样本都自然退出。

close-exit-1/2先观察到child-exit再见流结束；close-exit-3的双流最晚close为20.7513ms，父端21.1521ms尝试challenge，21.4268ms记录`control-unavailable`（观察控制通道已不可用，并非原生关闭时刻），child-exit通知21.7708ms才到，仍没有pong。因此其前提正确拒绝；流关闭先于退出通知不能独立证明主体尚可执行。第14节允许的有限EPIPE/ECONNRESET例外本轮未发生，只在合成测试中验证，不能计作已原生覆盖。

### 独立审计、结论与后续

可信入口的 `--verify-saved` 从原始事件重算全部九项；另存 `offline-review-v1.json` 对账五输入、实际EXE、完整分类和outer时序。独立审计 `independent-native-audit-v1.json` 为836项检查、九条预定轨迹成立，SHA256为 `133b9fc9ed673cf23637837517e1b140e56266daed4a3af701545eeb9c80a20f`；审计同时核对PE x64、源码commit绑定、双EOF/close、控制原字节、两次token、持有时长、许可/退出及预算。审计脚本和JSON单独保存在主树证据父目录，未执行归档代码、未改原工件或用保存的pass替代事件复核。另存`timing-observation-audit-v1.json`从九份原始trace补充guard调用方await后时间，并限定outer计时及`control-unavailable`的含义；原审计数值和文件不改。

本次新证据补齐了固定Windows环境下“输出确实关闭而主体仍可执行、guard不因此提前返回”的窄前提；两个负控均验证新oracle按预定原因拒绝不足证据。旧G07三项仍not-established，不能追认原矩阵无缺口通过。正常已退出Process对象被其他句柄引用仍是Windows正常语义，不需要消除；本轮没有关闭未知句柄、按日志PID强杀或新增产品缺陷结论。

下一阶段可进入逐平台原生异常路径与unknown owner有界隔离设计，另冻partial-create、wait/通知失败、在途取消/正长度已读缓冲、release失败/挂起及两个并发会话的矩阵。需要先明确已知owner、不可确认状态、允许隔离的边界与观测预算，并补诊断外层调用方返回及结算I/O的独立观察，再实施新诊断；当前没有这批异常原生结果。builtin、其他Windows版本、真实Agent启动链/Host/Webview/packaged、生产API/取消预算和总退出完整性仍未验收。业务、依赖、旧live绑定和所有旧实验不改，设计继续比较中/验证中，ExecPlan保持active。

## 17. 原生失败与隔离的设计承接（设计冻结时记录，2026-09-22）

新设计 `docs/design-docs/runtime-native-failure-isolation.md` 以主树f318579a、独立树7fb4ae9e为输入；本段记录设计冻结时的协议状态，后续D3/D4实施结果见第18节。它区分真实API受控输入、native调用点返回替身、真实返回后扣留通知、调用前门控和模型；不把这些来源混称系统调用真实失败。

资源处置必须覆盖部分初始化、未确认是否进入API、明确失败但副作用不明，以及同操作迟到补证。诊断按N=2总owner槽、Q=1停止新建比较有界准入：已有两个会话可同时unknown，Q不成为虚假的硬上限；跨generation不清账。封禁owner和停止新建不能隔离共享进程同步卡死/崩溃，独立进程单元仅为创建前候选，不是已选生产server，也不允许事后迁移旧live或重启共享Supervisor来清一个owner。

D3冻结三平台各24个零PTY调用方/证据控制，共72项；D4各8个策略模型，共24项；W1 Windows24、U1 Linux18/macOS24合计66个driver尝试，不等于66次成功PTY。D3观察真实await后与父端接收，操作/进程结算和writer证据阶段预算分离；当前第16节的外层返回缺口仍未因设计完成而关闭。先实施并验证D3/D4，再推进W1/U1；所有结果另存新输入/新节，旧工具不改。

W1/U1先覆盖创建/登记与等待事实，兼有明确的U1通知返回替身和释放回执扣留；其余通知/env销毁、正缓冲取消、真正API内Close挂起、并发故障域以及生产支持/分发仍为第二批阻塞项，未冻结的危险注入不得执行。新文档保持比较中/未验证，本契约及总体退出完整性继续比较中/验证中，业务代码和生产预算不改。

## 18. D3/D4 v1 本地实施结果与契约边界（历史阶段，2026-09-22）

独立诊断树已实现D3观察外壳、D4 owner准入模型及三平台 foundation workflow。本地结果为D3 24/24 verified、D4 linux/darwin/win32各8项共24/24 control-pass；自测和篡改/库存负例均通过。D3使用真实额外控制管道和Node caller/writer子进程，D4是N=2/Q=1有限模型；范围上均不包含PTY、ConPTY或native资源。D3 schedule记录nativeProcesses:0/pty:false；D4记录native:false/nativeProcesses:0而没有pty:false字段，不能将范围说明写成不存在的工件字段。

完整本地目录为独立诊断树 `.debug/runtime-native-failure-foundation-v2-d3/` 与 `.debug/runtime-native-failure-foundation-v2-d4/`，本地采集时输入是未提交工作树源码快照，后来v1工具冻结为7141cfa3。目录中的v2是第二版本地工件名称，并非第20节新增v2工具。workflow已配置完整schedule和self-test目录/日志上传，本节记录runner前状态；后续首次与重复run见第19节，W1/U1仍未实施。

本阶段没有实现冻结接口 `startObservedCase(spec)`。D3当前内部以单个child close Promise收口，caller、process settlement和writer/evidence阶段仍由CLI串行编排；迟到after-await未形成不可变首次观察快照，caller源帧身份由observer重包，强制处置请求、实际退出与stdio close也未完全分层，evidence sealed仍是最终编排字段。D4虽覆盖跨generation保账场景，但部分事件和validator没有完整核对execution/generation identity，不能视作完整代际oracle。因此D3/D4本地结果只能作为最终trace/manifest和有限状态控制的阶段性离线证据，不能关闭本契约第3–5节的独立Promise、外层await和证据结算要求。

上述v1审计边界继续有效；当前第20节只冻结来源/顺序oracle窄修正，其他诊断语义和有界unconfirmed另验，W1/U1不开始。业务代码、旧live绑定、Windows正常对象语义和历史失败均不改，整体 `validation_status` 继续为“验证中”。

## 19. Foundation v1 两次 runner 结果与证据边界（2026-09-22）

固定输入7141cfa3的首次run `35673511893` attempt1及误触的同SHA重复run `35673550930`均为failure。每次完整D3：Linux/macOS各24/24，Windows23/24、仅D3-01-1跨stdout/fd3顺序误判；原始trace证明跨pipe接收没有caller因果保证，不能外推Windows/产品bug或其他平台不存在风险。D4每runner执行全部三组平台标签各8项共24项，每次run72次、两次144次模型均按原verifier通过，不是原冻结计划数24或native/真实并发验收。

Windows self-test positive首次23/24，重复21/24；后者除D3-01-1误序外，D3-07-1/08-1 after-await实际接收为504.2253/543.014ms，超过未改的缩放500ms预算，属于独立真实迟到。重复自测的writer结算还出现554.9569/630.9223/608.3949ms超500ms，原verifier未全部检查；保留原分类并登记结算预算审计债务，不把它们归为跨pipe误判。两次Windows自测在positive校验失败后退出，未生成最终self-test报告或tampered负例，已有positive轨迹和日志完整保存。

两次共六ZIP、3,853,782字节/3022成员，API size/digest与完整本地摘要一致；36份runner输入与7141cfa3对账，Windows仅CRLF差异。可信验证器来自固定Git字节，不执行归档代码。工件和 `.debug/foundation-first-two-audit/{summary,audit,acquisition}.json` 均在独立诊断树；summary SHA256为 `eb5d8e91ffe23ffa03ff43384d1d52c46ab0798a05a0adc644084a2a7d9081d5`，audit SHA256为 `b1de5345391c816f11a47b4143afa65b5da8d826463f76d5883f559f59b1d5c1`。原v1脚本/断言/工件/两次failure不改；模型和进程控制不计native PTY。

## 20. D3 v2 来源与顺序窄修正（运行前协议，2026-09-22）

新入口 `diagnostic-observation-envelope-v2.mjs` 与 `diagnose-observation-envelope-v2.mjs` 位于scripts/diagnostics，完整协议见 `runtime-native-failure-isolation.md` 第15节。caller在发送时携带全局递增sequence和完整身份，observer只记录真实stdout/stderr/fd3来源及有限非负接收时间；after-await只接收fd3，同pipe必须递增，跨pipe接收可以任意顺序，及时性仍由observer真实接收时间决定。完整帧含身份在内最多4096字节，分片在拼接前限界，错误协议形成失败；源序连续缺口仅允许D3-08明确bulk溢出区段。D3-08新增匹配fd4 ACK后才开始bulk，证明observer先确认after-await。

v2保留八场景各三次与原预算，另测错误来源、身份/序号、接收时间、帧边界和ACK/bulk负例。新结果只验证窄oracle，不以新工具追认v1失败或补造旧self-test证据。三独立settlement、deadline不可变首次快照、bounded unconfirmed、独立evidence结算、writer预算核验及D4独立重放/完整身份仍未闭合，W1/U1未开始；本地结果见第21节，整体状态不变。

## 21. D3 v2 本地窄验证与 runner 前状态（2026-09-22）

独立诊断树Linux Node22.23.2上，`.debug/observation-envelope-v2-local-1-selftest/` 的oracle78/78、parser8/8、positive24/24及篡改拒绝通过，`.debug/observation-envelope-v2-local-1-full/` 未缩放24/24 verified，三个新源码文件语法通过并保存完整hash。source身份和observer通道/时间现在分开验证；D3-08证据是observer的fd3 receipt、fd4 ACK发送、首bulk事件及caller源码中等待匹配ACK的控制流，没有独立caller ACK接收事件。

新workflow `.github/workflows/runtime-observation-envelope-v2.yml` 只跑D3 v2，不重复D4；固定Node22.23.2三平台，语法、oracle/parser、原0.25缩放自测、完整schedule/verify和完整上传。当前输入仍为未提交工作树快照，三平台v2 runner未取得，不能称commit复现或跨平台通过。v1两个failure及真实预算迟到不改；本契约未实现的完整结算与D4审计阻塞项不随本地窄验证关闭。

local-1篡改负例经独立复核并未证明失败后继续有效验证：根manifest提前失败令run.scale未读取，报告attempted24/verified0，原自测只检查总fail与首项错误。local-1 positive/full各24通过仍保留，但不追认其具备新证明。修正后根manifest检查与run元数据读取独立，self-test强制attempted24/verified23且末项无错误，并保存tampered-verification.json。新local-2-selftest目录的oracle78/parser8/positive24通过，篡改报告24/23且仅shared-manifest、D3-01-1错误；local-2-full目录未缩放24/24 verified、无evidenceErrors，最终CLI语法/diff检查通过，仍非已提交输入或三平台证据。非法writer帧可能被sealed掩盖也列入完整writer协议及独立evidence settlement债务，本次不新增其实现或通过声明。

## 22. D3 v2 三平台窄验证收口（2026-09-22）

唯一push run35676427931 attempt1绑定b4db41cc，Node22.23.2的Ubuntu24 x64、macOS26 arm64、Windows Server2025 x64均完成full24/24、缩放positive24/24、oracle78/78、parser8/8，篡改复核各24 attempted/23 verified。Windows full D3-01-1实际跨pipe到达倒序但源序合法，新oracle正确接受；坏首项不再阻断其余23项有效复核。三ZIP与API大小/摘要一致，15输入与Git绑定，Windows仅CRLF差异，未执行归档源码。

独立诊断树 `.debug/observation-envelope-v2-run-35676427931/` 保存完整输入、原始事件、ZIP、API、可信离线复核和metrics；audit SHA256为 `a772fa2a399c9b51fe109b56fff097933e9873fa0c424aab93f18717c13233f7`。各平台本次after-await/writer原始最大值均在2000ms完整或500ms缩放预算内，详见原生失败设计第17节；不以本次未超时关闭writer预算oracle或独立结算债务。

本增量仅关闭来源/顺序窄修正的runner待验项，不关闭三settlement、首次deadline不可变快照、bounded unconfirmed、writer协议/封存或D4完整身份重放；PTY、D4及W1/U1本轮新增运行均零。旧失败和正常Windows对象引用语义保留，下一步先补诊断结算契约，总退出完整性仍未验收。

## 23. D3 v3 / D4 v2 设计冻结与实施边界（2026-09-22）

新设计 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 以诊断树e1a31b79、运行时树a5f8d629为输入，冻结D3 v3与D4 v2的下一版契约，状态比较中/未验证。本阶段仅源码、协议与设计复审，零新增测试、零新增native运行；旧D3 v1/v2、D4 v1、workflow、工件和历史失败全部不改。三侧静态复审、跨文档及历史保持检查已通过；只收口设计，不代表实现或新矩阵通过。

D3 v3同步返回handle，observation、processSettlement、evidenceSettlement各自首次结算；绝对deadline先于等时/迟到事件，首报不可变，迟到事实追加。exit与捕获真实EOF分开，capture gate保留尾部；直接owner有界控制、未确认责任继续占账，不能以kill/close当释放。D3每case最多预留caller/evidence/publisher三个槽，任一hard截止仍unknown即停止后续case；这不是D4模型的N2容量。writer、独立verifier与最终publisher分责，协议错误不可被合法claim清除，受测证据结算、发布与可信离线归档验证分别判断；这些是诊断候选，不是生产进程布局或退出时间政策。

D4 v2固定N2/Q1，完整command/return/event/snapshot由不共用SUT转换函数的oracle逐步重放。创建acquisition、use token、整体release操作、首次unknown、当前证明与槽位分账；失败不抹已取得资源，错身份拒绝零副作用，旧代同操作迟到补证不得污染新owner，完整责任结算后仍显式reopen。failureDomain只是模型标签，不提供真实故障隔离证明。

运行前计划为每runner D3 v3主控36项、因果gate2项、publisher4项，D4 v2确定性模型16项，分别计数；三runner对应108/6/12/48，均尚未实施执行，不相加作PTY或产品通过数。下一步仅在独立诊断树新增版本入口，先本地实施、fixture清单/源码hash冻结与独立源码复审，再唯一一次固定输入三平台采集及全工件可信重放。主运行时树只同步文档，不推送；W1/U1和完整生产退出交付继续阻塞。

## 24. 新诊断本地实施与审计边界（2026-09-22）

本阶段已进入独立诊断树的八个新版本入口实施与本地审计，完整记录见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节（比较中/验证中）。主运行时只同步文档；本阶段不运行D3真实36+2+4、不新增runner、不推送任何分支，不改业务、依赖、旧实验/工件或image.png。上一节“均未实施”的表述只描述设计冻结时点，不覆盖当前进展。

D4 v2的local-3 self-test/full及各自离线复核均16/16、302命令、58次预期拒绝、1924 checks；93语义负例、4 saved负例和另存7个重hash sidecar负例分开计数。unknown key拼接碰撞的初次失败保留，修订为JSON tuple并在固定第05项回归；早期绿色没有覆盖负例sidecar独立绑定的缺口也已记录。证据、精确源hash及不含native/PTY/真实并发的边界见该契约，不把本地模型计为三平台或产品验收。

D3最终本地self-test-2通过119 oracle、41 core、15文件、25 archive/consumer/binding fixtures；saved复核4/4、88 manifest members及四源原字节均匹配，但boundedConsumerDelivery=false、acceptanceReady=false，真实进程/native/PTY均未运行。首轮76/29/15及saved3/3保留为历史覆盖；cross-replay-1因oracle多算stdin JSON换行字节而误拒，修订移除该额外字节，core仍以stdin EOF分隔。迟到错误回溯首报、owner/unknown/event/scenario漏验和归档绑定已本地修正，首次失败不改判。到期才冻结的首报记录真实消费者延迟并标delivery-budget-unresolved，独立消费验收预算及六组逐fixture对账仍开放，不修改原deadline或暗加宽限；symlink负例归档须保留link元数据。

下一步仍补齐冻结覆盖和独立审查，之后才另行确认真实D3与三平台采集。W1/U1、原生第二批、真实Agent启动链/双会话/Host/Webview/packaged、生产API/停止预算及整体退出完整性均未完成；不把正常Windows已退出对象引用升级为OS bug。
