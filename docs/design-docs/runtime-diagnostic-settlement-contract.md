---
title: 诊断观察、进程与证据结算契约
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 适配与基础设施层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity-native-candidates.md
updated_at: 2026-09-23
---

# 诊断观察、进程与证据结算契约

## 1. 当前阶段与证据边界

当前推进第17节：只以最小真实role对照确认ACK候选等待环，修直接原因并最多一次重新验证既定整链；第16节失败保持。通用增强不恢复为前置，生产/native验收边界不变。

本设计承接 `docs/design-docs/runtime-native-failure-isolation.md` 第17节。当前以第16节的范围纠偏为准：通用容量、listener和任意路径兼容性不再默认阻塞；预期截断汇总已修，首次Linux真实Node整链在180秒安全截止时终止，未完成42项，具体失败与候选ACK等待环见第16.4节。主运行时树仅同步文档，诊断改动在独立工作树；不改业务、D4、workflow或依赖，不运行PTY/原生API/runner，不推送。第2–15节按历史输入保留，整体方案仍比较中、验证中，不将工具结果计为产品退出验收。

D3 v1/v2、D4 v1、原workflow、断言、工件及失败全部冻结。唯一v2 run `35676427931` 只验证来源/顺序窄修正，不证明完整结算或原生退出完整性。W1/U1只等待与其实际输入判定和实验安全直接相关的门槛；通用工具增强不能自动成为前置，具体推进按第16节，不追认旧失败。

本诊断不改 Terminal/Agent 业务、旧 live 绑定、root runtime 归属或生产进程拓扑。不新增退出后历史、崩溃/重启恢复或任意后代托管。执行主体存活期间的终端输出与主体退出时自身已接收、排队、消费中的尾部仍须正确结算；实际 Agent CLI 启动包装链仍须单独验证。Windows 正常的已退出进程对象引用不是系统 bug；本设计不关闭陌生句柄、不按日志 PID 清理。

## 2. 静态发现与候选取舍

以下是固定诊断源码的静态缺口，不是新增原生实验或已证明的业务缺陷。路径均相对独立诊断树的 `scripts/diagnostics/`。

| 输入位置 | 已核实缺口 | 下一版本约束 |
| --- | --- | --- |
| `diagnose-observation-envelope-v2.mjs` 的 observeCaller/observeWriter/runCase | 等待 close 的单一 Promise；首次观察在收尾后重算；发送 kill 后仍可能无限等 close。 | 三个独立 Promise；exit、流 end、主动取消分别登记；deadline 首报不可变。 |
| 同文件 writer reader/deriveFacts/publisher | stdout/stderr 混读、缺完整协议；坏帧可被 sealed 覆盖；封存先于实际文件/manifest，发布仍在 observer 同步写盘。 | 单协议通道、错误不可清除、独立 verifier 与 publisher；不得由 seal claim 自证成功。 |
| `runtime-owner-quarantine-model-v1.mjs` 的 requestRelease/reopenAdmission | unknown 可被 release-in-flight 覆盖，unknownCount 降为零并重新准入。 | unknown 为独立观察维度；完整责任结算及显式 reopen 才能解除封禁。 |
| 同文件 createReturned/createFailed/releaseResource | 校验前写状态；失败可抹掉已取得资源；资源 unknown 后不能接纳同操作迟到 released。 | 拒绝无副作用；取得记录追加；首报与当前已知事实分开。 |
| 同文件 operations 与 `diagnose-owner-quarantine-v1.mjs` reducer | 跨 owner operationId 可覆盖，事件身份不全；oracle 不重放准入/currentGeneration，只比最终摘要，没有外部 command 输入。 | 独立完整身份、命令、结果及全量台账重放；篡改者重算摘要和 hash 后仍须拒绝。 |

保留 observer 内异步写盘虽然改动少，仍无法隔离解析/散列/存储对同一事件循环的影响，不采用。仅 writer 自写自验也无法证明声明对应真实文件，不采用。下一版诊断采用直接子进程 writer 写入、另一直接子进程 verifier 校验、最终 publisher 保存完整报告的串行职责划分。helper 可复用入口但每个角色单独 spawn；不引入常驻服务，不把诊断布局升级为生产 server 决策。

## 3. D3 v3 接口与不可变首次报告

候选 `startObservedCase(spec)` 同步返回 handle；校验纯配置失败在任何副作用前抛错，其余 spawn、流、协议、超时、存储故障都 resolve 为类型化报告，不产生无人处理的 rejection。先构造三 Promise、登记 owner，再排入启动工作；不能在返回 handle 前同步跑完整场景。

```text
handle.id = { schema, runId, caseId, generation, nonce }
handle.observation: Promise<ObservationFirstReport>
handle.processSettlement: Promise<ProcessFirstReport>
handle.evidenceSettlement: Promise<EvidenceFirstReport>
handle.getOwnerSnapshot(): immutable copy of current ledger
handle.subscribeLateFacts(listener): unsubscribe function
```

三份首报都有完整 id、reportId、单调 deadline、冻结时间/observer eventOrdinal、kind、reason 和引用的事实 ID；不得暴露可变 ledger/数组引用。迟到事实另有唯一 ID、真实收到时间和原首报 ID，追加到有界 journal，不能重写已有对象、文件或 Promise 结果。listener 先排队再投递，异常记独立消费失败，不在结算栈内调用。“有界”只限制队列数量/字节，不隔离同线程同步死循环；listener 必须受信且协作，其阻塞属于不满足 observer 可调度前提，不承诺抢占任意 JS。调用方必须自行消费 Promise，实际 `await` 续体记录 `consumer-after-await`；resolve 前日志或 Promise.race 加 sleep 不能替代这一事实。

| Promise | 首报及含义 | 不提供的证明 |
| --- | --- | --- |
| observation | `observed-within-budget`：合法 caller-after-await 在截止前实际收到；`not-observed`：到期或通道真实结束仍无证明；`protocol-failed`：取得有效观察前协议已坏。 | 操作成功、进程退出、全部尾部、文件已保存。合法迟到帧另记 observed-late，不回写首报。 |
| processSettlement | `exit-observed`：直接 child 的实际 exit，保留 code/signal；`spawn-failed`：本次启动明确失败；`unconfirmed`：截止仍缺退出证明。 | 不用 natural/forced 二选一猜因果。controlAttempts 独立记录，kill 返回 true 不等于已退出；exit 不等于流结束或资源均释放。 |
| evidenceSettlement | `sealed`：本节后续全部条件满足；`failed`：协议/明确 I/O/校验错误；`incomplete`：缺证明、截断或阶段超时。 | 不是最终发布成功、断电耐久、所有 OS 资源释放或整个 run 通过。 |

进程 exit 可以先于合法 fd3 帧到达，不能单凭 exit 判 observation 失败。已有 timely after-await 也不能被后来非法帧抹掉；后者使 capture/evidence 失败。证据失败是 sticky 的：记录全部原因，failed 优先于 incomplete，后到合法 claim 不清除早先错误。阶段超时同时保留 helper 的 unconfirmed 等独立原始事实，不压成一个总枚举。

## 4. 时钟、输出捕获与有界控制

observer 以同一单调时钟，在纯配置校验后、启动任务排队前记 T0 并建立绝对 deadline；排队和 spawn 都计入预算。所有事件回调在修改状态前检查绝对截止；本版统一 `now >= deadline` 先冻结该截止报告，再记录本次事件为迟到，恰好相等也不算及时。保存严格递增 observer eventOrdinal 作为相同时间的本地次序；不跨进程比较绝对 sentNs。source sequence/sentNs 只用于源内因果，不能把晚收到的帧倒填为及时。迟调 timer 不增加宽限。

| 阶段 | 运行前固定预算 | 动作与首报 |
| --- | --- | --- |
| caller 内等待 | 调用前起 1000 ms 工作截止 | 返回操作 raw timeout 仍可正常进入 await 续体；不能把这个 timeout 判进程退出。 |
| 外层 observation | T0 + 2000 ms | 有效证明缺失即冻结 not-observed；迟到证明独立留存。 |
| caller 控制 | T0 + 5000 / 5500 / 6000 ms | 对仍有控制权且未观察退出的直接 child 依次尝试 TERM、KILL；6000 冻结 process unconfirmed 及捕获不完整。5500 是 v3 新冻结升级点，不改旧实验。 |
| evidence | E0 + 1000 / 1500 / 2000 ms | 1000 关闭新工作入口，对当时仍未退出的 helper 尝试 TERM；1500 KILL；2000 冻结首报。E0 在 writer spawn/发送输入前，不在 verifier 启动时重置。 |
| 最终 publication | P0 + 1000 / 1500 / 2000 ms | 独立环境窗口，规则同 evidence；不借用前三份报告余量。P0 在 publisher spawn 前。 |

进程首报不等 close，但 writer 输入也不能在 exit 时立即截取。内部 **capture gate**（输出捕获门）持续消费 stdout、stderr、fd3 等登记的读取流：每流只有真实 `end` 且协议 parser 无残片才是完整 EOF；`close`、error、destroy、取消和预算耗尽分别记录。所有流完整结束，或者 T0+6000 明确截断后，捕获阶段才结算。截断保存已接收前缀、各流终态和原因；不能假造 EOF，也不能由捕获逻辑结算归还仍有责任的 owner 槽。无需第四个公开 Promise。

仅在 observation 与 processSettlement 首报均已冻结、capture gate 已结算后建立 E0，并冻结 writer 输入字节；process 可早于 capture、observation 可早于 process，互不等待 writer。若 T0+6000 到期仍 unknown，三报告仍可结算；新 case 停止，剩余 schedule 记 blocked/not-run。当前 case 仅能使用开始前预留的一个证据 helper 槽，writer 与 verifier 串行且先前进程退出已确认；不得借取证名义无限启动 helper。publisher 也有独立预留槽，失败后不重启下一代来规避未知责任。

Node ChildProcess 对象不是永久 OS 控制句柄。只直接 spawn 已知可执行文件，不用 shell；不使用私有 `_handle`，不引入外部 waitpid/reaper，收到 exit 后停止控制，绝不再按保存的数值 PID 寻找目标。Windows 的 TERM/KILL 在固定 libuv 中均走 TerminateProcess，不称 Unix 式优雅升级。error 必须按发生阶段分类，成功 spawn 后的 kill/send error 不得误记 spawn-failed；ENOENT 只表示启动失败，不证明操作系统从未创建临时子进程。固定官方源码与指纹见第11节。

首报、owner 当前状态、流关闭、helper 退出和控制尝试分账。hard deadline 后迟到 exit 可以补台账，不能改首报；仍 unknown 时保留控制责任且 CLI 禁止成功退出。CI 终止整个环境不算 released。真实矩阵不尝试制造不可杀进程或阻塞持有活体 child 的 observer；无退出回执的边界用明确标记的事件替身验证。API 有界承诺以 observer 能获调度、spawn/控制 API 能返回为前提，不能保证事件循环永久停摆下的绝对实时。首报在自身 deadline 前冻结时，消费者真正续体在同一 deadline 相等或之后运行，另记环境迟调/验收失败，不扩大期限。对于恰在或晚于 deadline 才冻结的 timeout 首报，不要求消费者先于该 deadline；按第12.4节记录冻结后的实际延迟及 delivery-budget-unresolved，独立消费验收预算仍待冻结。

D3 每 case 最多三个预留直接 child 槽：caller、串行 evidence helper、publisher；这不是第8节 D4 的 N2 模型参数。任一槽的进程/流责任在自身 hard deadline 仍未确认，停止启动后续 case，仅可使用本 case 已预留的剩余取证槽。迟到补证保留，但本次 run 不自动重新准入或重跑；剩余项仍按原 schedule 记录 blocked/not-run。

## 5. 来源协议、容量与捕获完整性

caller 延续 v2 的完整身份、跨 pipe 源序与真实接收时间规则，但使用新 schema，不能混用旧帧。协议通道固定 stdout 和 fd3，after-await 只走 fd3；stderr 仅为有界诊断字节，不提供成功证明。ACK 携带完整 id 与 requestId，收到匹配 ACK 才允许 bulk/受控后续阻塞。控制 oracle 同时验证源发送因果和 observer 接收事实，不因跨 pipe 倒序拒绝合法轨迹。

帧最多 4096 编码字节（含换行），单项主轨迹最多 4096 事件且 1 MiB，其中预留 64 事件/64 KiB 控制区；首次 bulk 溢出后拒收所有后续 bulk 明细，只保留一个范围摘要及控制事实。不得先无限拼接再检查。late journal 最多 256 事件/64 KiB；任一容量溢出保留标志并使证据不完整，不扩容。辅助进程每实例协议最多 8 帧、stderr 最多 16 KiB，输入最多 2 MiB；最终发布请求最多 4 MiB。容量限定诊断资料而非整个 Node RSS；输出来源持续洪泛时暂停/取消并如实标截断，不将丢弃等同消费完成。

原始数据在收到时记录通道、receiptNs 与 eventOrdinal；不得等 close 后重包接收时间。`captureIntegrity=complete/incomplete/failed` 独立于 `artifactVerified`：完整保存一个截断前缀可以 artifactVerified=true，却不能让 evidenceSettlement=sealed。D3v3-08 预期 evidence incomplete；成功归档这个失败事实是另一种结果。

## 6. Writer、独立校验与最终发布

writer/verifier/publisher 共用严格帧 envelope：schema、role、runId、caseId、generation、nonce、attemptId、requestId、sourceSequence、十进制 sentNs、type、严格 payload。每角色重新起源序，不跨角色拼成单源；拒绝错身份、错通道、未知/额外字段、非有限时间、重复/逆序/缺帧、非法 UTF-8、超长或 EOF 残片。所有输入也有严格 schema 和长度上限。stdin 输入结束才能解析请求；stderr 中的 JSON 或成功文本不算协议帧。

writer 语法为 start -> write-entered -> seal-claim | failed；非法输入可 start -> failed，terminal 帧后不允许新协议帧。verifier 为 start -> verify-entered -> verified | failed，publisher 为 start -> publish-entered -> publish-claim | failed。首个协议错误永久保留，即使后续帧合法也失败。每帧原样保留源身份和收到时间；role claim 从来不是 observer 的成功结论。

区分非法语法与未完成：非法帧、已收到源序中间缺口、双 terminal 或 terminal 后新帧为 failed；合法连续前缀因期限/主动控制而没有 terminal 帧是 incomplete，不因预期超时再造一个协议错误。正常自然退出却未按语法完成协议是 failed。进入阻塞 shim 的前提必须由 observer 实际收到 entered，再回完整身份 ACK 才放行；只调用 write 不证明 observer 已收到，未建立此前提则 scenario not-established。

writer 只向本 case 新目录 exclusive-create 固定 inventory：`payload.json` 和最后写入的 `manifest.json`。manifest 含 schema、完整身份及 payload 的真实编码文件大小/hash；inventory 是严格条目数组，显式拒绝重复 path，不用会吞重复键的对象映射代替唯一性校验。manifest 不包含自己的 hash；文件关闭完成后才发送 claim。payload 是 observer 已冻结的明确 UTF-8 字节，不依赖不同进程自行 JSON 重排。它只含 E0 前已冻结的 observation/process 首报及已发生的 capture/control 事实，不包含当前 evidence 首报或未来 helper 事实；后续 late journal 不修改这次 seal，另行随最终归档保存。

verifier 只在 writer 实际 exit0、全部读取流真实结束且协议无错、唯一 seal claim 完整时启动，且启动必须在 E0+1000 前。它从 observer 得到同一份预期输入字节，在隔离进程中独立计算预期摘要并读取实际文件，检查精确 inventory、完整身份、普通文件类型、实际大小/hash、schema、无额外/缺失条目、无 symlink/路径逃逸。不能只验证一个内部自洽但与请求不同的 manifest；不执行工件中的代码。observer 关键路径没有文件 I/O 或文件散列。

E0+1000 是两 helper 的共享工作截止，不在交接时重置。writer/verifier 均须在该截止前已被观察自然 exit0、且没有对其执行超时控制，才可能 sealed；此前启动且已退出的 helper，尾部协议/EOF 可以继续排空至 E0+2000。writer 虽在 1000 前退出但 claim/EOF 后到而未能及时启动 verifier，则明确 incomplete（verifier-not-started-before-work-deadline），仍保存尾部，不能为新工作延长期。这个保守分类是 v3 新诊断取舍，不改变旧预算结果，也不是生产尾部截断政策。

sealed 的全部门槛是 capture 完整、双方协议无错、writer 和 verifier 合法退出、verifier 唯一 verified 回执与精确内容/identity 相符、两者全部真实 EOF、均在各自截止内。仅 verified receipt 不够，必须防止其后 helper 失败或尾帧损坏。控制后恰有完整文件可以另记 artifactVerified，但不能回写正常 sealed。E0+2000 无论 helper 是否 close 都冻结首报；仍有进程或流责任的 owner 继续保留。

最终 publisher 在三个首报和当时 late journal 冻结后，保存输入、首报、原始轨迹/字节、owner 当前账、全部错误与精确 inventory/manifest。该请求另有 archiveAttemptId、snapshotOrdinal；后来补证只能另建归档版本引用旧版本，不能覆盖旧首报或旧 manifest。publisher 在独立 P0 窗口执行，不在 observer 同步落盘；它的退出/协议首报称 publication，最终 `archiveIntegrity` 由可信离线 verifier 及完整 ZIP/digest 对账给出，不由 publish-claim 自证。

publisher 输入不能包含尚未发生的“本次 publisher 已成功”；publication 首报只在返回内存及外层控制记录中产生，由外部采集一并保留。源 helper 仍 unknown 时，publisher 若复制它的文件，只能写入新的独占归档目录，标为可能变化源的一次 partial snapshot，不能以该副本的 manifest 完整证明 writer 已结束。不用活跃源目录充当已封存归档。

publication 的错误、超时或 incomplete 使该项不能验收通过，但不改变前三报告；成功发布故障事实也不把受测 evidence failed 改为 sealed。publisher 失败保存已有 partial 文件，通过预先建立的有界外层控制通道/CI 日志发送失败事实，不在 observer 同步写“证明写盘失败”的 fallback 文件。归档边界后的迟到补证不能静默丢弃：没有新归档则标 late-evidence-unarchived。外层通道和存储同时失效时明确 evidence unavailable，不递归启动无限 publisher/watchdog。

在可调度前提下，三个首报最多分阶段 6000+2000 ms，publication 另 2000 ms；不把 10000 ms 称原操作的宽限，也不把 ZIP 上传、离线复核包含在此内。sealed/archiveIntegrity 均只证明读取当时可见完整性，不承诺崩溃耐久或敌对并发修改下原子快照。

## 7. D3 v3 运行前固定矩阵

真实 Node 控制仅用 Node 22.23.2、直接 caller/helper、无 PTY/无后代。下表 12 项每 runner 各 3 次，完整 scale=1，共 36 项；三 runner 共 108 项，尚未运行。复用 v2 的八个场景目的但使用新 ID/输入/报告，不重跑或修改 v2。v3 不用缩放实时时间当主验收；边界采用确定性虚拟时钟，原 v2 的 0.25/500 ms 失败和通过原样保留，不以新设计追认。

| ID | 固定输入及必须观察 |
| --- | --- |
| D3v3-01 | 正常操作、实际 after-await、自然 exit、完整 capture、writer/verifier sealed；外部 publisher 完整保存。 |
| D3v3-02 | 操作永久 pending，由调用方 1000 ms 等待边界返回；after-await 及时，raw 操作仍 timeout。 |
| D3v3-03 | result-ready 后、实际 await 续体前同步阻塞；首报 not-observed，独立 observer 控制 caller，不能用 ready 判返回。 |
| D3v3-04 | observer 收到 after-await 并 ACK 后才同步阻塞；首份观察成功，进程退出和控制尝试分列。 |
| D3v3-05 | caller 不发目标帧而结束专用 fd3；observer 确认真实 end，not-observed；无平台私有 fd close 假设。 |
| D3v3-06 | 本次独有目录预置固定文件，以 wx 触发真实 EEXIST；observation/process 不受 writer failed 改写。 |
| D3v3-07 | writer 在记录进入后同步 shim 阻塞；明确不是实测磁盘挂起，按共享预算控制，evidence incomplete。 |
| D3v3-08 | 合法 after-await/ACK 后连续 bulk 至溢出；保留前缀/容量原因/控制事实，evidence incomplete，archive 可完整。 |
| D3v3-09 | caller 实际 await 后扣住目标帧，observer 到 T0+2200 才发完整身份许可；caller 匹配后发送。首报 not-observed 不变，单列真实迟到接收并归档；这是 delivery-held，不证明 caller 续体自身迟到，也不跨进程比较 T0。 |
| D3v3-10 | 直接 spawn 本次确认不存在的路径，收到启动错误；spawn-failed 与 not-observed 分开，不宣称从未有过 OS 子进程。 |
| D3v3-11 | writer 发非法帧后再合法 claim/exit0；错误不可清除，不启动 verifier，不 sealed。 |
| D3v3-12 | verifier 进入后同步 shim 阻塞；writer 已退出，控制只针对 verifier，原观察/进程首报不变。 |

另有真实因果 gate 控制 2 项，每 runner 各一次，独立计数，不混入 36 项：G1 先扣 caller，消费者真正 await observation 后才 ACK 放行；随后扣 writer、await process；再扣最终 publisher、await evidence。每个 gate 都由消费者续体推进，记录 request/ack 匹配，不以定时 sleep 猜独立性。G2 在 after-await 已正常交付后，只扣 stdout 最后 caller-finished 帧及各读取流 end 的测试 transport 交付，exit 原样递送；消费者真正 await process 后才放行扣留回调，capture 在此之前不能完整结算。分别保存 Node 入口接收时刻 ingressNs 与 SUT 交付时刻 deliveryNs，报告使用 deliveryNs，不回填更早 ingress，不偷偷用 audit 补 SUT 事实。明确 delivery-held 不是 OS 管道实际被后代持有。gates 仅扣 helper 的工作动作/明确回调，不阻塞 observer 线程或扣死真实进程退出控制；每一阶段的固定截止照常生效。

G2 的拦截规则必须在 caller 启动前安装，caller 等到 observer 确认 after-await 的匹配 ACK 后才能发送 caller-finished/结束流；不能收到 fd3 后才临时装 stdout 拦截而再次引入跨 pipe 先后假设。测试审计保留实际 ingress，但 SUT 只能看到按 gate 释放的 delivery。

纯确定性事件 oracle 另固定覆盖：每个 deadline 的 -1ns/相等/+1ns；exit 先于 after-await；真实 end 对比 close/destroy；process hard 未确认及晚 exit；TERM 返回成功却未退出；spawn error 对比成功 spawn 后 kill error；writer 已退出但尾 claim 在 work 截止后到；verifier 已 exit0 而回执晚到 hard；非法帧后合法 claim；首报深度不可变；控制/late 区溢出和 blocked 后不得新建。每项保存 fixture 和预期报告，不将替身的 unconfirmed 称真实不可杀进程。

共享工作截止还必须有组合 fixture：claim 及时但 writer exit 在 1000 相等/之后；writer 完整结束但 verifier 尚未及时启动；verified 及时但 verifier exit 在 1000 相等/之后；verifier exit 及时但 verified 或 EOF 在 2000 相等/之后；terminal 后错误/残片；callback 早于迟调 timer 执行但实际时间已跨截止。每例核对首报、helper 原始事实、控制尝试和 late journal，不只判断最终 kind。

D3 oracle 也必须独立于 SUT：仅共享 schema 常量/可信 fixture 格式，不 import 状态转换、报告构造或验证 helper。从原始身份、receipt/eventOrdinal、控制尝试、实际 exit 与逐流终态重建三个首次报告及 deadline；不信任 SUT 的 kind/deadlinePassed/artifactVerified/summary.pass。同步篡改报告/摘要并重算 manifest 仍须语义拒绝，坏首项后继续有效核验剩余项及末项。文件 verifier 的实际输出与独立文件负例另核，不能由报告重放替代真实文件校验。

协议负例按 caller/writer/verifier/publisher 四角色保存独立 fixture：错 schema/每一身份字段、错误通道、重复/逆序/缺帧、双 terminal、terminal 后新帧、非法 UTF-8、完整或分片超 4096、残片、额外字段、负数/NaN 时间、改 receipt/deadline。文件负例各独立目录覆盖：claim 无文件、错误大小/hash、内部自洽但请求内容错误、缺/多文件、重复 inventory、symlink、路径逃逸、坏 manifest。不得修改旧工件构造负例。

publisher 专项 4 项每 runner 各一次：正常、wx/EEXIST、写出前缀后明确失败、同步 shim 阻塞。由没有活体 API child 的直接父 controller 驱动，保存受测 publication 与外层实际收到的失败事实；其最终审计由现有离线采集路径完成，不递归要求发布者自证。预期失败不会使缺少最终证据成为通过。首次真实矩阵前冻结全部纯 fixture 清单/hash 和新 workflow 输入 SHA；测试数按 fixture 实际清单报告，不预造 oracle 断言总数。

## 8. D4 v2 全身份与责任台账

本版是确定性单进程模型，不 import 生产模块，不验证原生释放/真实并发。failureDomainId 只是逻辑归属标签，不代表已建立 OS 隔离。完整 envelope 为 schema/runId/caseId、唯一 commandId（事件另有 eventSeq/因果 commandId）；owner 身份是不可变 tuple：failureDomainId + executionId + ownerGeneration + allocationId。资源与操作回执再带 resourceId/resourceKind/operationId/receiptId；verifier 不给缺字段补身份。

整份台账 N=2/Q=1。currentGeneration 仅限制新 admit；ownerGeneration 永不改写。换代/重连/换 failureDomain 不清旧槽，old generation 对自身同一操作的迟到证明可以有效，对新 owner 无权。已准入 A/B 都 unknown 时如实计 2，Q 不是未知量硬上限。unknown 封禁新 admit，但不停止 B 的已有模型数据/应用/释放进度。

槽预留、创建 pending/concluded、实际 acquisition、唯一 use token、release 请求/dispatch、首次观察与当前证明分别记账。admit 不把计划资源写成已取得；pending create 即使零 acquisition 仍占槽。createReturned/createFailed 必须验证当前 pending 后才写状态；失败不能提交一个新空数组抹掉已有 acquisition。创建失败且确证零 acquisition 才能归还空槽。

begin-use/end-use 使用唯一 token 推导 in-flight；重复 end、错身份、陌生 token 均拒绝。release 可排队，但本模型仅在创建 acquisition 账封口且所有资源 use token 结束后，对 owner 整体模拟一次 dispatch，冻结完整 acquired 集合。此计数不是各 native Close 的次数。operationId 在整个 run 唯一绑定 owner、操作类型与规范化请求参数；pending 或 completed 时同请求复用原逻辑结果，不重复 dispatch，不承诺 JS Promise 对象相同。创建/释放不得共用 ID；冲突参数或跨 owner 复用必须拒绝。

unknown 是独立观察维度，不是替代 release-in-flight 的单一 status。资源首次 unknown 不可变，同 operation 的完整迟到证明可将当前观察补成 released；禁止重试 Close 获得新证明，也不能反转已确定 released。完整责任结算要求创建已结束、所有 acquired 资源确定释放、全部 use token 和请求操作结算；部分资源 released 不归还整槽。不明进入/返回责任仍占槽；全部补齐后可归还，但准入封禁仍须显式 reopen，且整账无 unresolved unknown 才接受。

相同 receiptId 和规范化内容精确重复是幂等无新效果；同 ID 变内容拒绝，重复原 eventSeq 则是工件协议错误。参数/回执只允许合法 JSON，等价比较忽略对象键顺序、保留数组顺序及值类型，数值必须有限。已释放及零资源失败 owner 都留 tombstone，旧 allocation/resource/operation ID 不能重新用于另一次取得。release 请求先验证完整身份，再查历史 operation；完成后相同 op/参数仍复用，不能先因 owner released 而拒绝。每个拒绝命令除追加 rejection 记录外，资源、操作、计数、generation 和准入状态全量不变；不能先写 returned 再验证参数。

command 外壳为 schema/runId/caseId/commandId/commandSeq/kind/args；args.owner 含完整目标身份（包括目标 run/case），据此区分合法命令引用错误目标的模型 rejected 与工件外壳坏掉的 evidence-error。return 明确 accepted/reused/rejected 及结构化原因；不以任意异常满足预期拒绝。模型不用真实计时器，延迟/到期为固定逻辑步骤。

| Command | 前提与允许状态变化 |
| --- | --- |
| reserve(owner, createOperationId) | 当前 generation、已声明 domain、ID 未使用、未封禁且 occupied<2；先预留空资源账及槽。 |
| dispatch-create(owner, createOperationId) | 匹配已预留操作，只 dispatch 一次，计数不代表真实创建。 |
| acquire(owner, createOperationId, resource) | 同一已 dispatch 且未封口创建，resourceId 未使用；只追加 acquisition。 |
| report-create(owner, createOperationId, outcome) | 必须已 dispatch，记录 success/failed；精确重复可复用，冲突拒绝，不清 acquisition。本有限模型 success 且零 acquisition 的输入明确拒绝为未覆盖，不能按空集合已释放。 |
| seal-create(owner, createOperationId, resourceIds) | 已报告结果，资源集合精确等于 acquisition；封口后不能 acquire。 |
| begin-use / end-use(owner, resourceId, token) | begin 必须有资源、未 released、未请求释放且 token 未用；end 只结束当前匹配 token。 |
| request-release(owner, operationId, params) | 新请求绑定并排队，同参数复用；不清 unknown，不接受第二个不同 ID 的并行/重试释放。 |
| dispatch-release(owner, operationId, resourceIds) | 创建封口、use 全归零、精确完整资源集合；整体一次 dispatch。 |
| release-evidence(owner, operationId, resourceId, receiptId, result) | 仅处理已 dispatch 操作中的资源，result=released/unconfirmed；unknown 后同操作可补 released。 |
| observe-unknown(owner, subject, reason) | subject 指向存在的 create/op/token/resource 责任；追加首次观察及未解决责任，不反转已确定事实。 |
| advance-generation(previous, next) | previous 匹配当前、next 从未用；只变新建 fence，保留旧账。 |
| reopen(expectedGeneration) | generation 匹配且 unresolved unknown 为零，才解除 latch；不要求所有槽空闲，也不跳过下一次容量检查。 |

零资源创建失败只有 report failed、seal 空集合且无在途使用后才能归还；此前排队 release 则结算同操作为 not-required，dispatchCount=0。资源 released 不能代替 end-use，操作只有全部冻结资源释放且创建/使用责任结算才能 complete。创建/使用/释放的 unknown 只被相应 seal-create/end-use/完整 release 证明消除；原首次观察保留。unknownCount 从存在未解决责任的 owner 去重推导，归零不自动 reopen。slot 归还由完整条件派生，不提供任意 free-slot 命令。tombstone 留至 run 结束；reconnect 只是相同账本的再次访问，不创建新状态容器。

D4v2-04 的 B 进展用 begin-use/end-use 中 `kind=data-application`、唯一 batchId 的 token 表达：A unknown 后 B 才开始该 batch，end-use 保存同 batch 的 applied 事实，oracle 核对完整身份与前后顺序。它只证明模型允许推进，不以一个计数声称真实 B 仍可服务。

## 9. D4 v2 独立 oracle 与固定场景

harness 从可信冻结 fixture 取命令，在调用 SUT 前记录完整 command，之后记录 return/error、原始 emitted events、完整 immutable snapshot。oracle 不 import SUT 的类、转换、验证或 snapshot helper；共享仅限常量 schema/fixture 格式。oracle 从可信命令独立推导每一步合法性、事件语法、owner/资源/token/operation/generation/quarantine/tombstone 全账，再比较返回、事件和每步完整快照。不能用 SUT accepted/rejected、occupied/unknown/dispatchCount 自述作真相，也不能只比较最终摘要。

每命令的所有事件须有精确归属，原始 schedule 必须完整匹配 fixture；删/复制/重排事件后重新编号、同步修改 snapshot/assessment 并重算 manifest，仍须由语义拒绝。manifest 校验和案例遍历分开，首项坏后继续有效验证末项，逐项保存 attempted/verified/errors。文件损坏、模型拒绝和整体场景结论分别计数。

每次调用固定以下 16 项各一次；不在一个 runner 重复 linux/darwin/win32 逻辑标签。三 runner 合计 48 次模型，零 native、零真实并发，尚未执行。

| ID | 必须验证的轨迹 |
| --- | --- |
| D4v2-01 | A/B 预留占满 N2，C 拒绝；B 明确零资源创建失败归还后 C 才可准入。 |
| D4v2-02 | pending create 且零 acquisition 仍占槽，不能凭空列表提前归还。 |
| D4v2-03 | 部分创建取得 pipe 后失败，空列表不能抹资源，逐项结算后才归还。 |
| D4v2-04 | A unknown 封禁，B 仍有模型数据/应用/释放进展，C 拒绝。 |
| D4v2-05 | A/B 都 unknown，unknownCount=2，不超总槽也不压成 Q1。 |
| D4v2-06 | 两 use token 延迟 release dispatch，错/重复 end 拒绝，归零才一次 dispatch。 |
| D4v2-07 | 部分资源 released，其他 pending/unknown 时不归还/reopen。 |
| D4v2-08 | 资源 unknown 后同 operation 迟到 released，首报保留、dispatch 一次，显式 reopen。 |
| D4v2-09 | 分别篡改 run/case/domain/execution/generation/allocation/resourceId/resourceKind/op 身份，不污染其他 owner。 |
| D4v2-10 | g1 A pending 后换 g2 建 B；旧回执只能结算 A，不改 owner 身份。 |
| D4v2-11 | g1 unknown 换代/重连/换域重试仍占槽并封禁，不经新 namespace 清账。 |
| D4v2-12 | pending/completed 同参数复用；参数冲突/跨 owner operationId 重用拒绝。 |
| D4v2-13 | 精确重复 receipt 无效果，同 ID 改内容及确定状态反向污染拒绝。 |
| D4v2-14 | 完成或零资源失败留 tombstone，旧 allocation/resource/op 不复用。 |
| D4v2-15 | 非法 create/resources/身份/generation 命令拒绝，全账除 rejection 外不变。 |
| D4v2-16 | 观察结束仍有创建/使用/释放责任，保留 pending/unknown、占槽并封禁，不假 released。 |

语义负例至少逐类删除/复制/重排事件，篡改完整身份/资源/请求、删保留 owner、伪造 occupancy/reopen/released、修改每步全量快照和坏首项后仍验末项。每例保存可信输入、篡改后数据、预期错误；不得仅用 hash/sequence 错误声称完成独立语义 oracle。

## 10. 实施入口、验收与剩余门槛

设计冻结时拟新增的八个诊断文件现已在独立树创建，当前证据和未完成边界见第12节：`scripts/diagnostics/diagnostic-settlement-v3.mjs`（handle/owner/时钟）、`scripts/diagnostics/diagnose-settlement-v3.mjs`（直接进程角色及CLI）、`scripts/diagnostics/settlement-oracle-v3.mjs`（独立报告重放）、`scripts/diagnostics/settlement-fixtures-v3.mjs`（固定事件/文件/gate负例）；D4 为 `runtime-owner-quarantine-model-v2.mjs`、`owner-quarantine-oracle-v2.mjs`、`diagnose-owner-quarantine-v2.mjs`、`owner-quarantine-fixtures-v2.mjs`，同目录。本阶段不新增或修改 workflow；未来采集另冻精确路径过滤与唯一首次触发方式，避免 push+dispatch 重复采集。

当前里程碑只推进本地实施、fixture/源码审查及纯 oracle/文件/模型验证；Linux D3 真实完整矩阵不在本阶段执行。CLI 已提供 `--self-test --output NEW_DIRECTORY`、`--output NEW_DIRECTORY`、`--verify-saved DIRECTORY`，实际证据见第12节；D3 的 `--output` 仍受真实矩阵门槛约束。每次失败另存，不覆盖或重跑同输入筛绿，不将预定 108+48 写成已通过。

之后固定新输入 commit，唯一一次三平台完整采集，失败也上传所有 partial/控制日志；下载全部 ZIP，对账 API digest/成员数/实际输入源码（Windows 原字节保留，CRLF 只读归一比较），仅以可信 Git verifier 重放，不执行归档代码。在线报告和离线独立 oracle 都须满足首次报告、期限、原始身份、tail/EOF、全账和语义负例；归档失败不能由 scenario 预期 writer 失败豁免。

设计冻结阶段的文档验收检查 frontmatter/索引/本地引用、两树共同契约一致、ExecPlan 四活章节、diff、旧源码/workflow/历史章节不变，并独立复审；当前本地实施与审计结果见第12节。该检查只收口设计阶段，不关闭 D3/D4 实施债务、W1/U1 门槛、原生第二批、真实双会话/启动链/宿主/packaged、生产 API/停止预算或整体退出完整性交付。正常 Windows 引用语义与历史失败的证据边界继续保留。

## 11. 固定官方源码依据

本设计已经完成进程/时钟、writer/发布、D4台账三个方向的独立静态复审。修订包含排队前计时、capture gate、G2启动前拦截与ACK、合法未完成前缀分类、非自指归档、共享work截止组合、完整独立oracle与D4原子拒绝/迟到责任结算；最终没有剩余设计阻断点。两树本轮元数据/索引状态/新增引用/历史保持与diff检查通过；这不是新版本实施、自动化矩阵或产品退出完整性通过。

本轮只读取得 Node v22.23.2 官方源码，annotated tag 为 `490a9fef8f8adcda5a95bd6f96035b05cb43fe5b`，peeled commit 为 `aa4c77582be995286fc6e00aaf530dc7ade102a9`（git ls-remote 核对）。tag URL 与固定 commit URL 完整字节/hash 一致；GitHub API 的一次 403 不作证据，Windows 源首次网络零字节超时后重新获取只属于资料下载，不是重跑实验。本次文件未收入仓库或当作 runner 二进制证明。

| 官方固定来源 | 字节数 / SHA256 | 最小源码结论 |
| --- | --- | --- |
| [lib/internal/child_process.js](https://raw.githubusercontent.com/nodejs/node/aa4c77582be995286fc6e00aaf530dc7ade102a9/lib/internal/child_process.js) | 31715 / `9f7c4dfcbd7e3d2e8006f6e19fc09695322edd20ef280a68025e2a269bfa12cd` | 280–293：关闭并清空 _handle 再发 exit/error；497–516：无 handle 不可 kill，kill 本身也可发 error。保留 JS 对象不延长原生控制权。 |
| [deps/uv/src/win/process.c](https://raw.githubusercontent.com/nodejs/node/aa4c77582be995286fc6e00aaf530dc7ade102a9/deps/uv/src/win/process.c) | 42052 / `39516fc8c2316ec53b853a67301958796372676fb1b27d4ec76ec51217ae6f26` | 1114/1129：保存创建 hProcess 并登记 wait；1371：按该 HANDLE 控制，1376 记录 requested signal；884：endgame CloseHandle。引用存在、控制请求和实际终止不等价。 |
| [deps/uv/src/unix/process.c](https://raw.githubusercontent.com/nodejs/node/aa4c77582be995286fc6e00aaf530dc7ade102a9/deps/uv/src/unix/process.c) | 31333 / `cedc79cb473c0dde5c270ff2ee7b7956cbdfe0b3aceba19597b9a75a21e119f0` | 131/142/174：waitpid 与回调；1097–1102：按 PID 发信号。fork 路径的 exec 失败会传 errno 并由父 waitpid（929/938/945/948）；macOS 872–898 优先 posix_spawn，不能泛称所有 Unix ENOENT 必然先 fork。 |

这是固定版本静态行为依据，不是新跨平台运行结果；不以该源码保证 private handle 可用，也不承诺任意外部 reaper/插件干预后仍可安全用 PID 控制。

## 12. 本地实施、独立审计与未闭合门槛（2026-09-22）

### 12.1 阶段拆分与实际范围

第11节以前的设计冻结记录保留；当前转为本地实施与审计，状态为比较中/验证中。八个新版本文件仅在独立诊断树创建，运行时树只同步文档。本阶段不运行 D3 v3 的真实 36 主控 + 2 gate + 4 publisher，不新增 runner，不推送任何分支，不启动 W1/U1，也不改业务、依赖、旧入口/workflow、历史工件或未跟踪的 image.png。

本地固定 Node 22.23.2。D3 事件替身/虚拟时钟、文件负例与 D4 确定性有限模型分别计数，不相加成原生测试数。failureDomainId 仍只是逻辑标签；Windows 正常的已退出进程对象引用不作为系统 bug。

### 12.2 D4 v2 当前证据与审查修正

model/oracle/CLI/fixtures 四个入口已实现。原始 command 在调用前保存，expectations 分文件存放，每一步记录 result、events 和完整 snapshot；独立数组式 oracle 从可信命令重建 owner、resource、use、operation、generation、unknown 与 tombstone，不导入 SUT 转换、验证或 snapshot helper。snapshot 为隔离深拷贝，不与模型内部状态共享可变引用；这里不声称调用方不能修改该副本。

最终本地修订证据为独立诊断树 `.debug/owner-quarantine-v2-local-3-selftest`、`.debug/owner-quarantine-v2-local-3-full`，各有同名前缀 `-verification.json`。每次调用固定16项各一次，均为16/16、302 commands、58次预期模型拒绝、1924次 oracle checks。self-test 的16个正例与 full 的16项分别说明用途，不累计成新增场景或三平台执行结果。

self-test 另有93个语义负例、4个 saved 负例。21个实际事件类型各删除/复制/重排，重编号、同步篡改相关 ledger/final/assessment 并重算 manifest 后，仍由命令和全账语义拒绝。坏 JSON 或 null 根 manifest 均不阻断16项遍历；坏首项及重新计算 hash 的语义首项均 attempted=16、verified=15，末项仍有效。`.debug/owner-quarantine-v2-local-3-sidecar-negatives` 的另外7项逐份篡改 commands、expectations、expected、forged-assessment、positive/saved verification 和子 manifest 身份，重算涉及的全部 hash 后均被语义拒绝，主 matrix 仍为16/16。

审查发现两个不能由首轮绿色掩盖的缺口。原 unknown key 以 / 拼接，但合法 ID 允许 /，两个 owner 的不同责任可碰撞，被误作 reused 且 unknownCount=1；初次失败完整保留在 `.debug/owner-quarantine-v2-key-collision-first-failure`。现改为无歧义 JSON tuple，并在原 D4v2-05 中加入真实碰撞输入，仍保持16项。负例 sidecar 与 verification 报告曾只受 root hash 覆盖，现逐份与可信 fixture/重算结果核对并校验子 manifest。local-1/local-2 的原通过、源快照及覆盖缺口保留，不追认其具有后补覆盖。

| D4 v2 当前源文件 | SHA256 |
| --- | --- |
| runtime-owner-quarantine-model-v2.mjs | 553fbf80ae069d599c387308bf4a5f467453ad8e95562388b0d149500b90f3a7 |
| owner-quarantine-oracle-v2.mjs | 3d75740321276670f9eecfa79e1e41a5c0eded8ce1578d807f86095b602fb304 |
| diagnose-owner-quarantine-v2.mjs | 1ca9d761e6af4419ab161de66a17f761b231054d7c80b6a259edf8bd8732322b |
| owner-quarantine-fixtures-v2.mjs | f3ab683b4dfa68b027b8a32c2ecdc8b9cc0166f577e35d30171c34202579db9d |

这些 hash 对应实际工作树输入与工件内源快照，不以基准 commit 冒充已提交的执行输入。本地通过不证明原生释放、PTY、真实并发或生产模块正确。

修订后的独立只读复审确认上述两个阻断已闭合，未发现新的确定性阻断；该复审没有新增D4实验。create/use unknown 经 seal-create/end-use 迟到证明清除仍缺独立正向fixture，登记为后续覆盖，不把现有固定16项通过扩大成全部模型边界。

### 12.3 D3 v3 已确认进展与审计发现

D3 v3最终正式本地自测证据为独立目录 `.debug/settlement-v3-cli-selftest-2`：Node 22.23.2，oracle 119/119、core 41/41、文件 fixtures 15/15、archive/consumer/binding fixtures 25/25，exit 0；`realNodeCases=0`、`nativeProcesses=0`、`pty=false`。对应 `-verification.json` 离线复核 attempted=4、verified=4、evidenceErrors=[]、88 manifest members、四份源文件原字节 exact，`pass=true`，但 `boundedConsumerDelivery=false`、`acceptanceReady=false`。这些是纯本地 fixture/重放和保存完整性结果，不是live 36+2+4、原生平台或产品验收；self-test坏首/坏根继续遍历末项的负例也不是完整矩阵。CLI源 `diagnose-settlement-v3.mjs` SHA256 `5f1e8f01adce626f9e3a79bbd9eebd24e1779f5d859774b3a3bf24901c2f48bf`；其余源 hash：`diagnostic-settlement-v3.mjs=80666ad9d161e2198dcaff9363d457227acc6903a5b0b1ab09534aa21be77206`、`settlement-oracle-v3.mjs=9f50a320860f5c96a496018f0c3435b6d90737695b671571623fc4a5da739600`、`settlement-fixtures-v3.mjs=46995e03a4aaf4a5a8b8b64fb7d1768e6d2eb816b876b81610eaa536578be9ac`。self-test含真实symlink负例；远端归档必须保留link元数据（例如tar），不能假定GitHub artifact ZIP保留链接。首次cross-replay与`.debug/d3-oracle-review-first-failures`失败目录继续保留，不追认通过。

首轮 `.debug/settlement-v3-cli-selftest-1` 的76 oracle、29 core、15文件和saved3/3只覆盖当时的fixture，原始绿色与覆盖缺口保留。cross-replay-1曾因oracle误把stdin JSON当作带换行、多算1字节而拒绝正常core样本；修订移除oracle额外字节，core仍只发送JSON字节并以stdin EOF分隔，没有给core新增换行。首次cross-replay和`.debug/d3-oracle-review-first-failures`原失败均不追认通过。

本地审计修正已按eventOrdinal有界前缀生成首次报告，防止迟到错误回溯污染，并加固owner/unknown台账、event/scenario、numeric generation、派生ID上限、lifecycle与capture分层、launch-rejected及迟到原始事实绑定。CLI将publisher身份/场景绑定运行前specs，同时核对归档源码原字节hash与可信源码的只读CRLF归一比较，并拒绝publication/source根或祖先symlink借用未归档内容。修订及复核证据为本节self-test-2，不从首轮绿色外推；这些是新诊断工具修正，不是新增Terminal/Agent或操作系统缺陷，也不代表下述冻结覆盖与消费预算已全部完成。

剩余冻结覆盖按六组逐fixture对账补齐，已存在的部分边界样本不重列为零覆盖：caller TERM/KILL/hard与helper KILL的全部-1/相等/+1、排队跨hard；同步spawn throw、异步ENOENT已注册reader与launch-rejected的完整责任；目标帧前后坏帧、同chunk偏移与合法跨pipe倒序；claim/verified/exit/EOF围绕work/hard及共享E0的完整组合；各role帧长、terminal语法、stderr/input/publication/control/late容量及listener排队/异常；unknown迟到补账与不自动准入、cancel+close、实际await缺失/迟到和未建立G1/G2的拒绝。已新增的同时间戳正负例、numeric generation和长ID派生边界按实际测试清单扣除，不用总数替代覆盖矩阵。

### 12.4 消费者续体边界与下一门槛

首报冻结与消费者实际 await 续体分账。最终 snapshot 对每份首报核验唯一 consumer-after-await、name/reportId 和冻结后的顺序。报告在自身 deadline 前冻结时，消费者在同 deadline 相等或之后运行，另判环境迟调/验收失败，不标为及时。对恰在或晚于 deadline 才冻结的 timeout 首报，消费者不可能早于该 deadline，因此只保存 frozen→consumer 延迟并标 `delivery-budget-unresolved`，不宣称有界消费已验证。独立的超时首报消费验收预算尚未冻结；本阶段不修改首次 deadline、不暗加宽限，也不把缺口隐藏在总体 pass 中。

下一步补齐第7节冻结 fixture、首次/迟到事实前缀、逐项 owner 与准入封禁、严格协议/文件/publisher、消费边界及坏首项后的完整重放，完成独立源码审查并固定新输入。本地门槛完成后，才另行确认 D3 真实矩阵及唯一一次三平台采集；本阶段没有执行它们。旧 D3 v1/v2、D4 v1 与历史失败不改，W1/U1、原生第二批、实际启动链/双会话/宿主/packaged、生产 API/停止预算及整体退出完整性交付继续开放。

## 13. 确定性覆盖补齐与消费判据（2026-09-22）

本增量承接第12节已保存的输入和结果，诊断树基准为0b7040a9，运行时树为115c8641。先修正文档尾项的独立提交不改变旧实验。本增量只实施已有六组缺口、D4创建/使用unknown迟到正例和独立消费判据；真实D3 36+2+4、PTY/native、三平台runner和生产改造均不在本轮执行范围。所有改动只落独立诊断树及两树文档，不推送。旧自测目录及冻结的v1/v2入口不变。

消费判据先比较三个候选：延长原工作deadline会混淆操作与交付，不采用；要求到期首报的消费者先于同一deadline在因果上不可能，不采用；另设从不可变frozenNs起算的消费窗口，保持原操作/控制/证据deadline不变，作为待复审的诊断方案。初始候选窗口为100ms，是最短1000ms工作窗的十分之一，仅用于运行前识别诊断observer内的同步阻塞，不是测后容差或生产预算。仍需同时保留及时冻结首报在原deadline内消费的既有条件；到期首报不改写原kind、freeze时间或结果。实施前需记录复审结论，虚拟时钟覆盖新消费窗口的-1ns/相等/+1ns，并将首报自身迟调与消费迟调分开。

实施前独立复审确认上述独立窗口逻辑成立，本增量选用固定100ms诊断交付策略，版本名为 `diagnostic-consumer-delivery-v1`：F为首报frozenNs、D为该首报原deadline、C=F+100ms；F<D时消费者实际收到R须同时R<D且R<C，F>=D时仅要求R<C，等号均为超期。及时首报的双约束保留原契约，不能假定总能使用完整100ms；到期首报的新增窗口不授权调用方重新工作、重置E0/P0或控制预算。run/preflight记录策略版本和数值，可信离线实现按固定常量对账，不信工件自带更大预算。分别保存freezeDeadlineDeltaNs和frozenToConsumerNs；late-freeze后消费及时不等于首报及时，boundedConsumerDelivery仅表示已采集诊断样本满足交付阈值，不代表产品实时性或自测已覆盖真实矩阵。第12.4节保持上一输入的未冻结状态，不追认旧工件符合新策略。

D3覆盖按第12.3节六组逐项登记，不以总测试数替代覆盖：控制和hard绝对边界、启动与reader责任、同chunk/同时间和跨pipe协议偏序、共享E0组合、各层容量/listener、unknown迟到及gate/实际await。测试保存动作输入、预期、首报/当前owner和独立重放；注入事件不得被称为真实不可杀进程或真实OS错误。若全量重放暴露新工具缺陷，先保留首次source与结果，再修诊断实现，不改产品契约掩盖失败。

D4在固定16个模型场景内补充创建unknown经同操作report/seal清除、使用unknown经同token end-use清除的正向命令，独立oracle核对首次观察保留、当前责任清除、整槽归还及显式reopen。每次命令/断言计数按新输入实报，不追认local-3具有新增覆盖。输出仍为无共享可变引用的深拷贝，不新增JS深冻结承诺。

本增量验收先覆盖源语法、逐组纯fixture、完整新self-test/saved可信重放、语义篡改及独立审查；生成新目录、源hash与覆盖清单后才作阶段判断。发现未闭合项必须保留在计划和技术债中，不能由某份summary.pass=true关闭整体工具、原生或产品门槛。

### 13.1 D4 创建与使用责任的迟到结算

固定16项中的D4v2-02新增两条创建链：A在unknown后迟到报告failed且零取得，只有seal空集合才归还槽；B在unknown后实际取得pipe并报告success，seal只解除创建unknown，资源仍占槽直至同一release证明结清。D4v2-06将两个在途use token各自标unknown，每个匹配end只结算自身token，两个都结束后才单次dispatch。首次unknown不改写，清账不自动reopen，显式reopen后才允许新reserve。独立oracle逐命令重建而不是仅检查最终计数。

Node22.23.2的首次新输入保存在独立树 `.debug/owner-quarantine-v2-local-4-selftest` 和 `.debug/owner-quarantine-v2-local-4-full`。两次各固定16项一次，均330 commands、68次预期模型拒绝、2092次oracle checks；self-test为101个语义负例及4个saved负例。两份可信保存校验均attempted=16/verified=16，errors/rootErrors为空，self-test verifiedNegatives=101。新增8个篡改负例针对report提前清账/还槽、end清错token/提前还槽、替换首次观察和自动reopen；不是新增8项原生实验。根侧另只读核对02/06完整中间轨迹并重新验证self-test，无新发现。

CLI源 `diagnose-owner-quarantine-v2.mjs` SHA256为`c7579923c5fee45b51fd77923dc01593cf3bbef81cc0fda86dac0ab48db66fc4`，fixture源为`7ad1c136e817f0d14795e8b552c59fa0cbe8b8339831a3f6c81fe2d7a3b78cc1`；model/oracle维持第12.2节hash。旧local-3、碰撞首次失败和sidecar负例不改，不追认旧输入具有本次覆盖。本增量未发生新D4失败，也不证明native释放、实际并发或生产正确性。

### 13.2 D3 首次失败与校验规则修正

旧CLI的严格修前反例在 `.debug/archive-fixture-binding-repro-2`：正常纯self-test归档通过后，将missing-snapshot-schema的input替换为missing-snapshot-id的input，保留类别和预期并重算根manifest，旧saved仍4/4且无evidenceErrors。两个输入都被拒绝并不能证明各自原定覆盖。repro-1因fixture源码变化导致source-exact失败，也保留而不称完整通过。新实现由可信代码重建archive/file fixture定义及完整磁盘负例树，绑定具体输入和变换，再验证语义；重算hash不再足以替换类别。

新增boundary首轮108项中107满足预期，caller异步ENOENT用例在已建立E0后错误推进到hard再等待verifier，是fixture编排缺陷。第二轮156项中152满足预期，保存在 `.debug/settlement-boundaries-v3-second`；另一个listener用例误将订阅前已有两条late事实计入新投递数量。两处仅修编排/基线，不改变业务契约。CLI开发输入 `.debug/settlement-v3-cli-policy-dev-1` 的156/152独立保留，不覆盖上述目录。

第二轮另三个真正的oracle误判已保留独立输入与源码：无换行累计4096字节已无空间容纳换行，必须立即按超限处理；verifier合法verified后出现lifecycle错误，整体evidence failed但已取得的artifact证明仍可有效，不能混为协议错误；caller及时EOF但process超过hard才退出，不能用迟到事实倒推capture complete。oracle现按capture自身ordinal前缀和严格hard界限重建，协议错误与进程/流错误分账。三个原输入只读重放及反向内存篡改复核通过，不改历史失败，也不是新Terminal/Agent或OS缺陷。

冻结后的 `.debug/settlement-v3-cli-selftest-3` 自测119/41/156/15/37通过，但首次saved只有4/5：完整boundary动作和证据文件超过原通用64MiB读取限制，产生inventory member exceeds byte limit，summary计数缺组也如实失败。保留此来源/工件/失败；下一修订仅为已命名的boundary自测聚合文件指定128MiB离线读取上限，其余通用JSON仍64MiB。该聚合包含156个纯fixture，不能据此放宽单会话帧、trace、2MiB请求或4MiBpublication限制，也不将64MiB首次失败追认为通过。

### 13.3 冻结覆盖与明确缺口

新增 `settlement-boundary-fixtures-v3.mjs` 导出 `runBoundarySelfTests()`，仅复用虚拟时钟/transport，不spawn真实诊断子进程。每项保存动作、预期、报告、owner及独立重放；覆盖清单如下。既有119 oracle、41 core和15文件用例不重复计入156项。

| 组 | 数量 | 新fixture覆盖 |
| --- | --- | --- |
| 时钟/排队 | 20 | caller TERM/KILL/hard和三helper KILL的-1ns/相等/+1ns；caller/publication在launch队列越hard。 |
| 启动责任 | 12 | 四role的同步throw、异步ENOENT、异步ENOENT后close-only；注册reader和无EOF事实分账。 |
| 协议偏序 | 5 | 目标前/后坏帧各同chunk/跨chunk；合法跨pipe反向到达。 |
| 共享E0/P0 | 45 | 三helper的exit/terminal/EOF在work和terminal/EOF在hard邻界；工作窗不重置。 |
| 协议/容量 | 57 | 四role完整/分片4095/4096/4097、无换行4095/4096、UTF8/双terminal/尾残片；helper stderr16383/16384/16385；publisher request4194303/4194304/4194305及launch拒绝。 |
| 迟到/收尾 | 17 | unknown、cancel/close、listener、两个oracle回归、trace/control/late饱和、四gate未建立及已held/受控capture delivery。 |

156项分成154个要求完整oracle重放和2个明确要求拒绝的control reserve耗尽场景。后两项保留有界记录，但缺失阶段事实，独立重放必须报missing-phase-start；它们的测试判据满足不等于归档证据完整，更不能作为完整case验收通过。

尚未覆盖的具体门槛为：caller/evidence的2MiB input可达性及邻界；helper第8帧数量限额独立边界；trace events/bytes和control reserve64 events/64KiB各自精确-1/相等/+1；late256条独立阈值（当前命中64KiB，不声称命中256）；capture gate队列容量；listener failure数组自身上限。下一阶段先逐项确定可达输入、不可达理由或需要的有界设计，再实施并审查，不以本次156项总数关闭六组全部组合。

消费者37项archive/consumer/binding用例包括12个新增边界：F<D/F=D/F>D各自C-1/相等/+1，以及原D更紧时D-1/相等/+1。这些是纯判据测试，不是实测调度达标；self-test没有真实consumerDelivery列表时boundedConsumerDelivery和acceptanceReady仍为false。source CRLF/LF与工件迁移是离线输入可移植性，不是Windows/macOS原生通过。

### 13.4 最终本地证据与下一门槛

self-test-4各组fixture判据119/41/156/15/37满足，首次saved5/5、96 members；但独立审查发现新增source outcome的原字节直接比较会误拒CRLF producer/LF verifier，迁移目录也可能因原/新根混用而误拒，故其本机通过不作为可移植性完成。修订按producer的run.sourceHashes严格验证保存的trustedSha256/exact/crlfOnly，再对可信replay作有限归一；只归一路径字段和诊断error中的已知根，不替换任意协议字符串。早期source-outcome-repro-1受路径误拒干扰，未复现整体篡改通过，原结果保留。

最终输入为独立树 `.debug/settlement-v3-portability-check-1/original`，Node22.23.2完整纯自测各组119 oracle、41 core、156 boundary、15文件、37 archive/consumer/binding判据满足；其中boundary按上一节154完整重放+2预期拒绝计。原目录与复制的moved目录可信保存重放均attempted=5/verified=5、evidenceErrors=[]、96 manifest members；根侧从当前可信入口再次只读重放original也5/5，记录在同名前缀 `-root-verification.json`。没有另建self-test-5或重复原生输入。realNodeCases=0、nativeProcesses=0、pty=false，boundedConsumerDelivery=false、acceptanceReady=false。

同目录 `source-outcome-memory.json` 保存32项纯内存检查：producer/verifier/archive的LF/CRLF八种组合，及各组合对三个派生字段的伪造拒绝。这不是Windows真实工件在Linux的完整重放；Windows绝对路径进入synthetic spec时的宿主path.isAbsolute行为、junction归档元数据和跨OS路径绑定仍须在首次runner前明确验证，不能把同平台迁移和源码换行检查扩大为跨平台完成。

最终重hash负例在 `.debug/settlement-v3-saved-binding-negatives-1`：baseline先5/5，13项篡改全部因预期语义原因拒绝，未借shared-manifest错误求绿。覆盖archive与consumer类别替换、结果/scope/source派生字段、磁盘负例类别、file request/outcome、删除或放宽消费policy、自洽source+hash篡改、summary计数及boundary结果。summary伪造仍5/5组有效重放但整体失败，其他适用案例4/5；旧目录未修改。独立只读审查确认consumer判据、fixture绑定和source结果修正无新确定性阻断，另作72项内存正负检查，属于审查旁证而不并入正式自测计数。

| D3 最终源文件 | SHA256 |
| --- | --- |
| diagnostic-settlement-v3.mjs（本轮未改） | 80666ad9d161e2198dcaff9363d457227acc6903a5b0b1ab09534aa21be77206 |
| diagnose-settlement-v3.mjs | 6c89ab10c30b8fed6db751781abfdd2daa05e982fa7a926a5b822ad9aea96b7b |
| settlement-oracle-v3.mjs | eacdb9e850dac8f59e343838355ef98ecb01c93e0ffcc61e6bb68f1f8232b195 |
| settlement-fixtures-v3.mjs | f68b2a6e8194ef9ef4c4eab4030afb8a574895b5dfef56d56f5a1a865872f7a8 |
| settlement-boundary-fixtures-v3.mjs | db86c07c8d10a095b1ef23bd95714c28cb5386abf391c0b673dcf1c744229a75 |

以上hash绑定实际工件源快照，HEAD只记工作树基线，不倒称采集来自后来的提交。下一阶段先收口第13.3节容量与可达性、跨OS归档契约及独立审查，再决定真实36+2+4/三平台采集；本次不修改workflow、不推送，也不关闭W1/U1、原生第二批、实际Agent启动链/双会话/Host/Webview/packaged、生产API/预算及退出完整性总交付。

收口检查已通过：九份诊断源的Node22.23.2语法、两树各四份设计frontmatter/索引/关联路径、各12个ExecPlan必要章节、共享契约一致、五份最终D3源快照hash和diff。契约第1–12节与本增量基准逐字保持；业务、现有tests、依赖和workflow无变化，主树scripts无变化，image.png未纳入。文档检查记录在主树 `.debug/diagnostic-stage13-doc-check.json`；检查不代表全仓历史文档引用或原生交付已通过。

## 14. 容量可达性与跨OS归档（2026-09-22）

本增量基准为诊断树9230b87b、运行时树fee95df9，先作容量可达性审查和路径契约确认，再新增纯fixture与诊断修正。不改业务、D4模型、旧v1/v2/workflow/原始工件，不推送，不执行真实D3 36+2+4、native、PTY或runner。本节不追认第13节具有新增覆盖，所有首次失败另存源码和输入。

### 14.1 路径身份与本机读取分离

不采用将真实执行入口的绝对路径检查放宽为posix或win32任一接受，也不在观察后改写spec/trace/request/inputBytes。选用仅诊断测试可用的 `testDependencies.pathStyle=posix|win32`，要求显式注入clock和spawnRole；真实spawn路径不允许覆盖，仍用宿主规则。CLI在纯synthetic fixture重建时按记录的producer平台选择style。生产者路径始终是受平台约束的逻辑身份，本机文件只由当前归档根与受约束相对成员读取，不打开记录中的C盘、UNC或旧绝对根。

producer元数据拒绝drive-relative、缺盘符root-relative、平台不匹配和非法namespace；目录/请求身份逐项绑定，不以全局字符串替换修补hash或payload。Windows链接的manifest仍逐字保存readlink目标；fixture目标比对单独定义严格的普通drive/UNC及扩展前缀语义，有限映射不得接受错盘符/共享目录、错目标或路径逃逸。保存为链接的对象若变成普通文件应拒绝；归档中的symlink字面值不能证明Windows原生junction类型。

新建独立portable驱动，使用Linux真实文件、明确synthetic producer metadata和字面链接目标，覆盖posix/linux、posix/darwin、win32路径及LF/CRLF、迁移归档根和重hash语义负例。驱动不递归加入主self-test，不触发真实schedule；同时记录physicalPlatform与logicalProducerPlatform。首次runner前仍须验证Windows真实junction/readlink字节与权限、原生文件系统大小写/Unicode规则、真实打包/上传/解包保真及异平台producer整包重放，本地纯模拟不关闭这些门槛。

### 14.2 容量验证原则

只通过公开handle和注入transport构造可达输入，不给SUT私有计数器赋值，不临时降低限额以制造边界。逐项验证count和bytes哪一个先到：有合法较小上界使某阈值不可达时记录推导及最大输入，不伪造-1/相等/+1已执行；压力输入若故意违反协议，分类为synthetic诊断鲁棒性而不是实际OS轨迹。测试判据满足与完整证据重放分别计数，容量耗尽后缺证明仍拒绝。

当前研究清单为2MiB caller/writer/verifier请求、helper第8帧、trace正常/控制区的count和bytes、late256/64KiB、capture gate256/64KiB及listener failures256。既有trace/late/capture门槛不因补测而放宽。审查中发现的重复错误列表与错误字段字节界先保存最小反例，若需新增截断或改变状态规则，须在本节补充明确设计后实施；不能用测试通过掩盖旁路无界，也不在未验证前把纯模型输入当产品缺陷。

本轮选定独立容量驱动 `scripts/diagnostics/settlement-capacity-fixtures-v3.mjs`，冻结43项研究目标：caller合法最大请求上界1项；writer/verifier请求2MiB的-1/相等/+1共6项；三helper帧数7/8/9共9项；normal与reserve各自count/bytes、late count/bytes、capture held count/bytes、listener failures count，各-1/相等/+1共27项。无法合法到达的目标必须改记上界或步长证明，不把未命中的精确字节值算作执行通过；新增驱动与主self-test分开，不扩大真实矩阵。

已保存公开API最小反例 `.debug/settlement-v3-capacity-reachability-review-1`：800次stderr错误产生2232667-byte writer请求并触发拒绝；此时trace已耗尽，不能作为完整证据。单次listener异常的70000字符name产生70069-byte失败记录，说明256条限制不等于字节限制；最短身份下late256条为57732 bytes，说明条数门槛可独立到达。重复spawn/error只用于synthetic鲁棒性输入，未证明Node或任何OS自然产生这种轨迹。本轮不截断错误字段、不重构辅助数组；将其作为完整工具验收仍未关闭的明确风险，后续先设计有界错误摘要及缺证标记，再保留反例做回归。

### 14.3 首次失败与修正依据

容量首次 `.debug/settlement-capacity-v3-first` 完整43项仅38项满足，源码/输入/逐项结果均保留。三个verifier请求失败来自fixture尺寸构造：600条最大错误的固定前缀已超过目标payload，尚未到达待测边界；改成540条前缀和260条长度可调错误，保持800条总数、既定序号及2097151/2097152/2097153-byte目标不变。第二次 `.debug/settlement-capacity-v3-second` 为41/43，六个writer/verifier目标均已到达，两次sourcesUnchanged=true。

剩余两项normal trace字节983039/983040命中目标后被oracle以capture-integrity/report-kind拒绝。独立核对确认第5节冻结的16KiB stderr仅用于辅助进程，core也只限制非caller；oracle重放却未区分角色，将caller的大stderr误认成协议错误。本轮仅将oracle条件限定到非caller，不改core容量或原判据；这两个容量项提供caller正例回归，已有helper16383/16384/16385边界继续验证限制未放宽。首次38/43和第二次41/43不追认通过，不将校验器误判报告为产品或OS缺陷。

### 14.4 最终本地证据与复核

所有正式最终执行均使用Node22.23.2，物理平台Linux。容量第三次 `.debug/settlement-capacity-v3-third` 为43/43、sourcesUnchanged=true，分账为1个caller上界证明、30个完整oracle重放、12个因missing-phase-start预期拒绝；不得称为43份完整证据。caller按配置验证器允许的UTF-16字段长度和最坏JSON转义计算最大207621 bytes，不等于实际OS接受含NUL路径。writer/verifier均通过公开错误事件构造精确2097151/2097152/2097153-byte请求，超过限额才launchRejected；这些synthetic洪泛已使trace缺证。根审计 `settlement-capacity-v3-third-root-verification.json` 只从可信工作树加载oracle、重读43份JSON并核对来源，分账一致。

主回归 `.debug/settlement-v3-stage14-final` 五组分别119 oracle、41 core、156 boundaries、15 files、37 archives全部满足原判据，`-verification.json` 保存5/5可信重放、103个manifest成员、无evidenceErrors。156仍分为154完整重放和2个control reserve耗尽预期拒绝；boundedConsumerDelivery=false、acceptanceReady=false，不追认真实矩阵完成。

跨OS独立入口为 `scripts/diagnostics/settlement-portable-fixtures-v3.mjs --output NEW_DIRECTORY`。首次 `.debug/settlement-portable-v3-first` 保留旧oracle输入及结果；最终新输入 `.debug/settlement-portable-v3-second` 为46/46纯门禁、6/6 profile原位及搬迁各5/5、17/17负例拒绝。六profile固定为Linux LF、macOS LF、Windows drive LF/plain、drive CRLF/extended、UNC LF/plain、UNC CRLF/extended。只有首profile实际生成119/41/156三组纯输出，其余五份复制同一纯输出并独立重放，不能累计为新增场景；每profile均重新生成与自身路径规则绑定的15/37文件/归档组。

46门禁分为11路径、9链接及26 core配置；17负例中16个重算相关manifest，1个故意不重hash以检查原始目标字节完整性。覆盖producer平台/相对地址/namespace/dotdot、request/publication跨根、错盘符/共享目录/路径规则、链接变普通文件、request字节数、payload根注入以及plain/extended类别替换。复审指出synthetic固定profile不能仅用等价目标放行raw form替换，最终已绑定声明的原始形式；普通producer仍仅允许明示的有限语义映射。实际执行源与行尾模拟源分别保存为execution-sources和sources，分别记录hash，不把CRLF模拟当作Windows执行。

### 14.5 来源、过程偏差与剩余工作

最终受跟踪源码SHA256如下；所有运行绑定实际工作树字节，不把后来的commit冒充先前采集输入：

| 文件（scripts/diagnostics/） | SHA256 |
| --- | --- |
| diagnostic-settlement-v3.mjs | 7ee4a23e02e29d8fb2313e41f30f37ae0097a0017486724f5901c6b2d9f97f5f |
| diagnose-settlement-v3.mjs | d3004f625398de4bb4fc662020e2aa2bab135ff8eb8d6313d90f4eac70d926c5 |
| settlement-oracle-v3.mjs | 8547d33b6ece83250cafc2c57d1024f71787861ab1a163db91bf715423a514f1 |
| settlement-fixtures-v3.mjs | f68b2a6e8194ef9ef4c4eab4030afb8a574895b5dfef56d56f5a1a865872f7a8 |
| settlement-boundary-fixtures-v3.mjs | db86c07c8d10a095b1ef23bd95714c28cb5386abf391c0b673dcf1c744229a75 |
| settlement-portable-fixtures-v3.mjs | 3f2d02b0f9b0a97a301209d1f13bcb3591c99ea4b37ba52a8fb12a3d3db74d99 |
| settlement-capacity-fixtures-v3.mjs | 558f648ff9ec06a67fb9e43ac32c8a0e6329c27d7091a5817d967570669ccb9c |

过程偏差单列：独立复审曾从已核对hash的first归档sources执行三次只读重放；两份review-1 probe也导入了当时刚从可信树复制的冻结副本。虽未启动native或修改旧工件，这不符合本阶段统一从可信工作树加载验证器的执行规则。这些运行保留为历史旁证，不用作最终门禁；正式复核改用当前可信工作树入口和全新证据，不掩盖偏差或追认旧输入为最终版本。

替代正式复核已完成：`.debug/settlement-v3-capacity-reachability-review-2` 为3/3、`.debug/settlement-v3-path-style-review-2` 为42/42（包含两入口继承属性门禁，spawnCalls=0），均导入当前可信树。独立审计 `.debug/settlement-portable-v3-second-review-1` 从当前CLI重放三份：UNC/CRLF搬迁正例5/5，raw-form替换和payload根注入各4/5且仅预定files-self-test/archives-self-test拒绝，无shared-input或manifest错误遮挡，archivedSourcesExecuted=false。独立源码复审未发现本轮改动的新增确定性阻断，剩余风险不因此关闭。

容量独立入口为 `node scripts/diagnostics/settlement-capacity-fixtures-v3.mjs --out NEW_DIRECTORY`；主回归为 `node scripts/diagnostics/diagnose-settlement-v3.mjs --self-test --output NEW_DIRECTORY`，离线为 `--verify-saved DIRECTORY`，均在独立诊断树用固定Node22.23.2执行。新目录必须不存在，失败不覆盖，不从保存工件执行源码。D4、旧v1/v2、workflow、生产模块与依赖本轮不改；真实D3、native、PTY、runner均未执行，不推送。

下一步首先设计诊断错误字段/辅助数组的有界摘要与缺证标记，再补明确反例回归和完整工具复审；同时保留Windows原生junction/readlink/权限、文件系统大小写/Unicode、真实打包上传解包和原生异平台producer归档为runner门槛。未完成这些工作前，不宣称整体诊断工具内存有界或跨OS归档已原生验收，不启动W1/U1或改生产退出策略。

## 15. 错误诊断保留边界（2026-09-22）

本阶段基准为运行时4743e055与诊断bcfc571b，只修诊断错误字段及错误列表，生产、D4、旧v1/v2/workflow和历史工件不改，不推送，不运行真实D3、native、PTY或runner。第14节的800个stream错误与70000字符listener name反例作为修前依据。保留状态有界不是整个Node RSS、输入对象、同步getter/回调时间或全部owner容器有界：listeners注册集合及超大单chunk中先登记的sequences仍为独立待办，不能顺手纳入本阶段结论。

### 15.1 选定规则与独立证明

每次异常仅规范化一次，供trace、列表及报告复用。name/code分别保留最多128 UTF-8 bytes，message最多2048 UTF-8 bytes；code=null不变。按完整字符前缀截取，不能切坏UTF-8；只在发生截断或无法安全提取时记录固定字段名的truncatedFields，不保留完整后缀、全串hash或原error对象。容器另按JSON编码后的实际数组字节计费，包含方括号及逗号，控制字符的转义不能绕过64KiB。自定义同步getter或转换器的执行时间不在本规则保证内。

每role.errors、每stream.errors及listenerFailures分别最多256条/65536 JSON bytes。第一次放不下后冻结保留前缀，后来较短的记录也不补入；摘要固定为retainedCount、retainedJsonBytes、omitted、firstOmittedSourceFactId、fieldsTruncated。省略只有布尔值和首次来源，不宣称不可见后缀精确总数。第一条规范化错误必须可放入，已观察错误不会因截断变为空数组或恢复helper成功；首次报告冻结其当时摘要，迟到变化只进入当前owner，不改首报和deadline。

evidenceErrors/evidenceIncomplete在插入时去重并保持首次顺序。来源限现有固定reason集合及每role最多一次已接受failed帧的有界code，不按任意错误message建立去重Set；protocolErrors的8条和controlAttempts的两种信号规则不改。

role/stream的摘要由现有spawn/process/request/stream-error原始事实独立重建；destroy抛错新增stream-destroy-error事实，listener异常新增listener-error事实，后者绑定被投递的late fact。listener-error仍受trace控制区预算，但不再次交付给late listener，避免诊断异常递归通知；它不变成主进程或reader失败。已有控制/ACK错误也使用同一字段规范化。若来源事实已丢失，摘要不能补造证明，校验器须拒绝无法独立重建的错误账本。

校验器把“有界记录与摘要一致”与“错误详情无省略”分开：语义重放可验证一个明确截断/省略的结果，但返回errorDiagnosticsComplete=false，不能据此宣称详情完整或acceptanceReady。完整性由当前owner及各首报ordinal前缀分别核对；截断算法本身还需以fixture原输入验证，不从前缀反推未保存后缀。trace/control缺阶段证明仍按旧规则拒绝，输出EOF、资源释放和消费者状态不由错误摘要替代。

### 15.2 实施与验收边界

新增独立错误预算模块及fixture，oracle独立实现重放而不调用SUT的保留函数。覆盖字段多字节/转义/提取异常、三类容器count与bytes邻界、所有写入入口、首次省略后持续输入、迟到不改首报、摘要/记录篡改；首次失败另存当前可信源码快照和输入，但验证只导入可信工作树。旧43容量fixture及其43/43证据不改，六个依赖800条stream.errors的请求构造不再直接用于新策略，不能通过修改旧断言追绿，也不能据此宣称2MiB请求不可达；新输入可达性另列研究门槛。

实施前补充：提取失败fallback固定为name=Error、code=null、message=Uninspectable error，并标记对应truncatedFields；孤立surrogate转为U+FFFD并标记loss。trace或control有任何丢失时，owner及此后首报的errorDiagnosticsComplete保守为false；通用重放可以核对可见事实一致，但不能称完整错误证明，账本与来源不匹配仍拒绝。destroy仅补来源可见性，不扩helper failed分类：caller在capture前观察到destroy错误仍按既有stream.errors失败，capture后不得回改；helper保留既有不能successful、可能incomplete的规则。listener容量与late journal容量分别记账，不再将监听器错误列表省略伪装成late输入溢出。

固定新测试清单为39个helper原输入项、29个公开core项和20个独立语义篡改项。helper覆盖三字段ASCII/多字节邻界、JSON转义、getter/转换失败与单次读取、primitive/null、孤立surrogate、数组count/bytes邻界、封前缀/隔离及policy冻结。公开项包含三类错误容器count255/256/257及完整数组bytes65535/65536/65537共18项，另有late首报、destroy、快照隔离、request/sync-spawn/async-spawn/launch-rejected/kill/ACK两入口及单次规范化共11项。篡改项覆盖字段/样本/顺序/跨桶来源/首省略/计费/遗漏来源/首报改写/listener与destroy无来源/理由唯一性及缺policy-summary；reason只新增唯一性和有限来源校验，不声称所有旧reason顺序已独立推导。新测试判据不由实际输出临时调整，构造失败必须保留并说明。

独立校验器返回的errorDiagnosticsComplete是经过错误账本验证的结论，不是仅由可见源事实计算的候选值；缺policy/summary或错误来源、摘要、首报不一致时必须为false，即使pass=false已经阻止验收也不另报完整。caller在启动队列中越过hard且尚未创建时，capture的streams严格为空对象；已创建caller则必须具有完整的三个流摘要，不能借此例外放过缺失台账。

listener来源认证沿用core实际投递规则：report-frozen和listener-error都不能成为late journal输入。即使重写listenerFailures及摘要使其彼此一致，也不能将未投递的首报冻结事件伪装成监听器异常的来源。

### 15.3 首次失败及审查修正

helper-first/second/third均为39/39；first仅是helper初版，最终来源以third为准。公开API首次 `.debug/settlement-error-budget-v1-public-first` 为26/29，sourcesUnchanged=true：role字节65535/65536两个构造在最后一条需要2110/2111-byte message，违反既定2048上限；新增一条1024-byte中间记录再精调，目标值和断言不改。另一项ACK写入抛错由core既有caller-ack-error判failed，oracle遗漏这一lifecycle来源；仅补带forType的同步写失败，不将无forType的异步ack error自动升级。public-second 29/29及其独立复核保留为中间输入，不冒充最终oracle验证。

主回归 `.debug/settlement-v3-stage15-first` 为119/41/155-of-156/15/37。唯一失败是launch-queue-crosses-caller-hard：尚未创建caller时capture.streams合法为{}，新错误重放误要求三份空摘要。只修oracle按capture前缀中的实际spawn-request判断，不改core、原boundary或时限。复审还收紧错误完整性认证，防止缺policy/summary等已拒绝输入仍返回complete；并拒绝report-frozen伪装的listener来源。

tamper-first的7正例、20组/34变体均满足当时判据，不能追认包含后来新增覆盖。最终在原20组内增加一个自洽伪来源变体及其真实多首报基线，共8正例、20组/35变体；所有负例额外要求errorDiagnosticsComplete=false。原失败、原输入和源码快照不覆盖，也不从归档sources执行验证器。

### 15.4 最终证据与当前结论

所有执行使用Linux物理平台、Node22.23.2和当前可信工作树。最终helper `.debug/settlement-error-budget-v1-helper-third` 为39/39；公开API `.debug/settlement-error-budget-v1-public-third` 为29/29、sourcesUnchanged=true。对应 `-independent` 重读29份saved JSON、原检查项及五源hash均通过，18项错误详情完整、11项明确字段/列表损失；29份均为语义有效重放，不把11份损失记录当详情完整。该独立summary SHA256为 `5a18a6eeed3b2bc6840a68da20eb6180812dc1818bee53245b41a785f03eb415`。

最终 `.debug/settlement-error-retention-tamper-v3-second` 为8/8正例、20/20组、35/35变体按预期拒绝，sourcesUnchanged=true。自洽report-frozen来源伪造仅命中listener-error-delivery-source与ineligible-late-error-source，不依赖其他结构错误。独立只读复审核对destroy前后capture、listener双来源ID和首报前缀，无本阶段新增确定性阻断。 对应 `-independent` 从当前可信oracle重读8正例/35变体，158/158检查通过，五源hash与30份旧JSON输入前后不变；summary SHA256为 `fb02fa95d0da507c36f4075ccef3023fe50d3c92556a106eb6ef8e4c6c42db29`，没有重新生成fixture或执行归档sources。

主回归 `.debug/settlement-v3-stage15-second` 五组119/41/156/15/37满足原判据，156仍分为154完整重放及2个control reserve缺证预期拒绝。可信离线 `-verification-absolute.json` 为5/5、110个manifest成员、无evidenceErrors。根侧首次直接调用内部verifyEvidence传相对目录产生symlink outcome路径误拒，`-verification.json` 的4/5保留；按CLI相同的path.resolve入参复核通过，未改源码或将4/5追认为通过。self-test没有真实消费/错误完整性聚合，boundedConsumerDelivery、errorDiagnosticsComplete、acceptanceReady均false，不将空聚合视为完整。

合成归档 `.debug/settlement-portable-v3-stage15-first` 为46/46门禁、6/6 profile原位及迁移各5/5、17/17负例拒绝。profile沿用第14节规则，仅首profile生成119/41/156纯输出，其余复制并重放，不计新增场景；每profile重新生成15/37文件/归档组。没有Windows/macOS原生执行、真实junction证明或打包传输验收。本阶段realNodeCases=0、nativeProcesses=0、pty=false、acceptanceReady=false，D4与旧43项未重跑。

| 本阶段源码（scripts/diagnostics/） | SHA256 |
| --- | --- |
| diagnostic-settlement-v3.mjs | aacd998f0d80a3c9622e11f37565397defeafcefd8f5d53af05e510f5f501fe6 |
| diagnose-settlement-v3.mjs | 3d6db16801c1a503305381257c88c43273a53a56b7cbcc62fadad5f8fb003f96 |
| settlement-oracle-v3.mjs | b46364703af263795b3dd5ed988fa19454349273645b18eea4a951a473743bcc |
| settlement-portable-fixtures-v3.mjs | 4af1b26a85d1914fa5e0e1ef994abc66561252395fea82e01212628bb0c32ba3 |
| settlement-error-budget-v1.mjs | 35a78c16208b92942229501407929e8bae9d9c2cfcca49fbc598242afec5914d |
| settlement-error-budget-fixtures-v1.mjs | e0d88c708950543f6017e977c981137479f4540b29dbbe248a77ec71d855cb85 |
| settlement-error-retention-tamper-v3.mjs | 2f89c43a11acf36bbfae76d07f4d3bcbabe706b6202826f3c9b4f2aaea032ddf |

上表绑定采集时工作树字节，不将后来的commit倒写为运行输入。旧settlement-fixtures、boundary和capacity源码及其第14节hash不变。独立错误入口为 `node scripts/diagnostics/settlement-error-budget-fixtures-v1.mjs --helpers-only --out NEW_DIRECTORY` 或 `--public-only`；篡改入口为 `node scripts/diagnostics/settlement-error-retention-tamper-v3.mjs --out NEW_DIRECTORY`。主回归/离线/portable命令沿用第14节；必须使用固定Node和新目录，只导入可信工作树模块。

下一阶段先重新研究有界错误策略下2MiB writer/verifier请求的可达性，按公开API构造或给出上界，保留旧六项输入不适用的解释；再明确listeners注册集合、单chunk sequences的责任及容量边界，完成工具复审。真实Windows junction/readlink/权限、大小写/Unicode、打包上传解包和原生异平台归档仍为runner门槛。不得据本节宣布整个诊断进程内存有界、重启真实矩阵、启动W1/U1或关闭产品退出完整性；生产API/预算、实际Agent启动链、双会话、Host/Webview与packaged继续开放。

收口检查覆盖两树各七份文档、三份设计YAML/索引/关联引用及12个计划章节；共享第15节一致，第2–14节正文保持原样。十份诊断源码语法和最终source hash对账通过，旧fixture/boundary/capacity、D4、业务、依赖与workflow不变。记录在主树 `.debug/diagnostic-stage15-doc-check-final.json`；独立文档复核无剩余事实冲突，不宣称全仓历史引用均通过，image.png未纳入。

## 16. 收窄工具范围与整体验收纠偏（2026-09-22）

本轮输入为运行时0cd0c18c与诊断17b3c869。用户指出第15节将工具通用健壮性连续升级为原生实验门槛，已偏离Terminal/Agent退出完整性；本节取代此前“2MiB可达性→listener→sequences→完整工具审计”的默认推进顺序。历史测试、原断言、失败和源快照不改，不将旧结果追认为新验收。本轮只修固定矩阵的汇总矛盾、做针对性回归并运行一次Linux既定42项真实Node整链；不改业务、D4、依赖或workflow，不推送，不运行PTY、原生API或runner。

### 16.1 哪些问题阻塞下一步

后续新发现必须说明如何影响本次固定输入的判定或实验安全，才可成为阻塞项；通用增强登记但不自动阻塞。以下按当前源码而非理想的通用框架分类：

| 问题 | 当前分类与处理 |
| --- | --- |
| 预期trace截断导致整轮永远不可验收 | 判定阻塞，本轮修正；正常、预期失败与预期截断不能共用“操作必须成功/源必须完整”的判据。 |
| 真实返回/退出/EOF、内容身份比对、实际consumer预算、owner未知后停止准入 | 判定或安全门槛，保留既有代码与预算；缺失则失败，不降低断言。 |
| 2MiB请求在任意错误洪泛组合下的可达性 | 通用容量增强，不阻塞固定输入。真实路径不注入800次错误，writer不携带bulk正文；实际请求容量检查、拒绝及失败证据仍保留，不声称所有异常请求都低于限额。 |
| 无限listener注册 | 固定执行入口没有subscribeLateFacts调用，注册数为零；通用API增强不阻塞当前42项。 |
| 单chunk内任意数量的sequences | 固定08最多4296个bulk和5个其他帧，其余caller最多6帧；任意无界输入防护不阻塞。08的真实trace截断仍须按预期验证。 |
| 任意路径/junction/大小写/Unicode/跨OS迁移组合 | 通用归档兼容性不阻塞；只核本次使用的实际路径、来源、普通文件及下载/保存后重放。使用全新、无链接祖先且由本次任务控制的目录，不声称可安全写入任意不可信路径。 |

已存在的工具能力不删除，也不继续为本次交付扩展。下一阶段的优先级是固定工具链实际运行与判定，然后回到会话主进程尾部、最终终端状态、reader释放和真实Agent启动链；D4模型不能代替OS资源验收，Windows已退出对象的正常引用存续仍不是系统缺陷。

### 16.2 汇总语义

原代码要求08实际overflow，任何overflow又使errorDiagnosticsComplete=false，整轮却要求所有场景该值为true。这是17b3c869中的静态逻辑矛盾，不是产品缺陷或已经观测到的新平台失败。

保留core和首报的errorDiagnosticsComplete，不将预期截断改成完整。CLI另按可信固定schedule计算scenarioEvidenceSufficient：普通case和全部publication阶段仍要求初始与最终独立重放成功且错误详情完整；只对main组D3v3-08的case阶段允许明确的trace-capacity截断。此例外仍要求两份oracle重放成功，after-await/ACK/bulk因果与incomplete分类满足既有场景断言，错误字段/列表无损失，control及late区无溢出；缺证、来源错误或意外错误截断不能借08标签放行。

整轮acceptanceReady要求完整固定schedule的有效重放、既有consumer交付预算与各阶段scenarioEvidenceSufficient，并继续排除self-test/synthetic归档。errorDiagnosticsComplete整轮仍可为false，如实描述08的源详情；验收通过只表示固定诊断场景符合预期且证据足以判断，不表示所有操作成功，更不表示产品或原生退出完整性完成。

### 16.3 本轮退出条件

只新增针对当前矛盾的测试，不新建诊断框架、不穷举通用边界。先验证正常、预期失败、08预期截断可正确汇总；意外截断、缺关键因果、错误详情丢失和原consumer预算不满足仍拒绝。随后在固定Node22.23.2、Linux、受控新目录执行一次既定36主控+2gate+4publisher全链并可信保存重放，外层180秒截止及5秒强制清理只作实验安全保护，不修改任何场景预算。

整链失败完整留存，定位是否直接影响本次判定/安全；不以重复运行筛绿，不因失败自动转为新的通用工具研究。以上为运行前约束，首次失败与后续窄修正如下，不宣称这42项通过。

### 16.4 首次整链失败、窄修正与后续边界

本轮只执行一次真实整链，固定Linux/Node22.23.2，新目录为诊断树 `.debug/settlement-v3-scope-full-first`，日志为同名 `.log`。输出目录创建前确认不存在且祖先均无符号链接。外层180秒保护返回exit124；只有01至08各三次、共24条case-settlement，全部pass=false、ownerBlocked=false。09-1已有writer工件但没有结算记录，其余17项没有启动证据；不得写成24/42成功或42项已执行。执行结束后进程列表未见该入口的role进程，此检查不证明PTY/native资源释放。

正常01-1相对首条case-start接收时刻，72.696ms已经caller-finished，约73ms关闭fd3，直到5004.405ms的SIGTERM后才在5010.412ms退出。writer约5080.397ms发出seal-claim，却仍到约6012ms控制后退出，verifier未启动；该case为evidence-work-deadline及verifier-not-started-before-work-deadline，publisher也为publication-work-deadline。24项publication全部incomplete。已看到的及时observation/部分consumer不能替代整轮消费预算证明，ownerBlocked=false也不等于自然退出成功。

源码核对发现候选等待环：子端 `createRoleIO().close()` 对fd4的fs.ReadStream调用destroy；固定Node内置 `internal/fs/streams` 的_destroy在已有读取时等待kIoDone，不取消在途fs.read；父端则在 `childExit()` 才对fd4执行end。原始trace证明工作已声明完成却等待控制退出，但没有直接记录在途read，故本轮只认定有源码支持的候选根因，未做因果干预确认。它是诊断role问题，不能外推为Terminal/Agent或Linux系统缺陷；Windows/macOS未实测，亦不排除同类问题。

运行被截断前尚未形成summary、outer最终快照及共享manifest。可信入口保存复核 `-verification.json` 为42个schedule检查/0 verified、acceptanceReady=false；42是检查次数，不是执行数。只读分析 `-analysis.json` 保留170个现存文件的hash、7份源匹配、原始时序及内置Node源码摘录，不补造缺失的正式归档。原始log SHA256为 `4d0811540696046b363b1732135a34d0fe869710c30004a61db839bbdc49467c`，analysis SHA256为 `6258ba942e6b54a0b70d98bd41b6d010024c428a25cc7f3133b3e5b002e3343f`。

三个08的既有oracle允许其明确incomplete，但真实记录同时缺verifier。为防止将helper失败混入预期trace例外，本轮只收紧新汇总：必须artifactVerified，writer/verifier均有原预算内exit0/null、无控制且三个输出流end而未取消；相关原始事实仍由未改的oracle核对。capture因trace截断产生incomplete、主动取消或原hard截止不被改写成完整，也不要求captureComplete。最终针对性8/8通过；同一份partial case输入另以新判据核对，08三项均sufficient=false。此项是保存case的局部检查，不是补造两份最终快照或完整run重放。

真实运行及此前 `settlement-v3-scope-selftest-final` 使用CLI SHA256 `acd97b72242b69cf17daf8fb4d69be904d27943b828dc585cdfb8aa99042b45c`。追加helper条件后的最终CLI SHA256为 `4c79c9259b2bf2b8c14a087fa010aff7dcaecdaf097d7710a696c30d73194e14`，唯一新增测试文件 `settlement-acceptance-v3.test.mjs` 为 `c16516db994d660be39d7c4e5fd378c4a940e60f7396023f8b058560d3c763ff`。最终 `.debug/settlement-v3-scope-helper-guard-selftest` 五组119/41/156/15/37满足既有判据，可信保存复核5/5、110成员、7源exact；self-test的acceptanceReady仍false。这些是模型/文件回归，未再次运行真实矩阵。core、oracle和旧fixtures字节不变，不将最终CLI倒写为首次真实采集输入。

180秒是本轮事前设置的安全保护，不足以覆盖固定schedule的所有最坏路径：38个case的6+2+2秒和4个publisher的2秒合计388秒，尚未计编排/写盘。这一外层预算估计错误与role未自然退出分开记录，不能将外层截断视为42项自身均超时。下次先用最小真实role对照确认并修复ACK自然退出闭环，核验该具体修正；再根据固定schedule重新登记整轮安全上限，以新输入最多一次既定42项验证，不改场景预算，不重跑旧失败筛绿。

本轮结束于范围/汇总纠偏及首次真实失败留证，不宣称工具整链已通过。后续只处理上述实际阻塞，然后回到W1/U1真实创建/等待/资源与主进程尾部、最终终端状态、实际Agent启动链；不恢复通用容量、无限集合或任意归档兼容性研究。生产API/停止预算、Host/Webview、双会话和packaged仍开放，旧live绑定及退出后无进程/历史的产品边界不改。

## 17. ACK 自然退出最小因果对照（2026-09-23）

本轮承接运行时9e82222a、诊断b38a4a9f及第16.4节的首次真实失败。只确认并修复实际ACK等待环，不研究通用容量或任意归档兼容性。主树仍只文档，运行代码仅限独立诊断；不改业务、D4、旧断言、oracle、依赖或workflow，不推送、不运行PTY/native/runner。第2–16节及首次170个文件/日志原样保留。

运行前固定最小对照：在可信未改的runRole调用外，观察fs.read(fd4)开始/回调的在途计数，不改读结果和协议。正常caller01收到合法ACK并结束角色函数后，要求仍有ACK读取、fd3已结束且进程未退出；至少保持100ms，再仅由父端结束其确切拥有的ACK写侧。预期在不发送信号、不强制process.exit的情况下自然exit0且在途读取完成；前提缺失就如实失败，不重试筛绿。观察夹具只用于这个因果对照，不作为生产探针或新通用框架。

候选修复是在core的sendAck写出最后响应后end写侧：caller-after-await及helper的*-entered为最后ACK，caller09的after-await-ready之后仍需另一ACK，不提前关闭。caller05不消费ACK，在launch完成接线后结束该写侧。childExit的end保留为异常路径兜底；ACK结束不替代stdout/stderr/fd3的EOF、直接进程exit或helper独立验证。此方案复用已有跨平台ChildProcess管道，不引入net.Socket(fd)支持假设；具体Windows/macOS仍需原生执行，不能由Linux结果宣布通过。

只新增一个node:test文件，固定五项：上述因果对照、真实core的caller01/05/09与正常publisher；三caller沿用真实writer/verifier并由既有oracle复核。先保留修前失败，再修父端ACK收尾，之后同五项回归、既有8项汇总回归及主self-test/保存复核。各测试有独立超时和确切child清理，不调用旧归档中的源码，不改场景期限。

局部修复证据成立后，以全新受控且无链接祖先的目录，固定Node22.23.2只跑一次既定36+2+4真实整链。外层安全截止改为480秒、TERM后5秒KILL：固定阶段预算388秒外留92秒编排/写盘余量，不声称实时保证，亦不修改任何场景原预算。完整或partial结果均保留；失败只分析直接判定/安全问题，不继续增加研究链。以上为运行前计划，结果另记；本轮不将工具通过计为实际终端或产品退出完整性完成。

### 17.1 本地因果成立与最小修复

修前 `.debug/settlement-ack-stage17-before/tests.tap` 固定五项1通过/4失败，来源四文件及hash同目录保存。因果证据在 `.debug/settlement-ack-causal-dyybyB`：第一read消费290字节ACK，第二read在runRole返回/fd3 EOF后仍active=1；父端维持100.508429ms后仅调用其ACK写端end，第二read回调返回0字节，started=completed=2、active=0，进程自然exit0/null。cleanup无信号；探针没有子端timer/IPC保活。此对照在固定Linux/Node22.23.2确认了ACK在途读与父端等待exit才给EOF的生命周期闭环，不定性为系统bug，也不宣称其他平台已实测。

选择父端结束已有写侧，而不替换子端fs.ReadStream或强制process.exit。core仅新增05接线/请求后end，以及sendAck最后响应后end；使用end排空已排队ACK，不用destroy截断。09首ACK和held gate不触发提前end，childExit保留兜底。正常caller01/05/09的真实writer/verifier及正常publisher恢复无控制的自然退出，oracle内容/报告验证不改。

修后 `.debug/settlement-ack-stage17-after/tests.tap` 同五项及既有八项共13/13通过，原测试断言未改。before/after各自保存源码，core由 `aacd998f0d80a3c9622e11f37565397defeafcefd8f5d53af05e510f5f501fe6` 变为 `cd1843ac5dcea92c6a255b56f0e8d576a219316f6ca2c68dd2a51c9778556079`；唯一新测试 `settlement-ack-lifecycle-v3.test.mjs` SHA256为 `3b8e9007d095c8af940b551b9fa485170138f38d0bc97fe4dd9fb48945c214dc`。CLI、oracle及既有fixture不变，未增加新框架、transport类型或生产API。

主自测 `.debug/settlement-v3-ack-selftest-first` 五组119/41/156/15/37满足原判据，可信工作树保存复核 `-verification.json` 为5/5、110成员、7源exact；self-test的acceptanceReady=false。13项和自测只是本地局部证据，不替代下面固定整链，更不是PTY/native产品验收。独立只读审查未发现本次因果或清理安全的确定性问题。

### 17.2 唯一完整矩阵结果与剩余直接阻塞

本轮只运行一次固定Linux/Node22.23.2真实Node矩阵，目录为诊断树 `.debug/settlement-v3-ack-full-first`，日志为同名 `.log`。外层仍按运行前登记使用480秒TERM及5秒KILL保护；命令正常结束并返回exit1，不是外层超时。36个主控、2个gate、4个publisher均有完整执行记录，summary的42项场景控制全部pass、ownerBlocked=false，summary/outer最终快照/shared manifest均已形成。这只说明场景控制检查满足预期，不能代替独立交付验收。

可信工作树重读 `-verification.json` 为42 attempted、39 verified，pass=false、acceptanceReady=false；314个manifest成员与7份采集源码exact。仅D3v3-08-1/2/3被拒，错误均为 `consumer continuation reached or exceeded independent delivery deadline: evidenceSettlement`。三个08的writer/verifier均自然exit0/null、无控制且工件已独立验证；预期trace截断仍保留complete=false，但场景证据sufficient=true，不再因“预期不完整”本身阻止通过。它们此次失败在另一条独立规则：真实consumer必须在冻结后100ms内接收，不能以负向场景为由豁免。

| 保存事实的时间差（ms） | 08-1 | 08-2 | 08-3 |
| --- | --- | --- | --- |
| evidence冻结至publication-start接收 | 149.094590 | 101.729240 | 131.875452 |
| evidence冻结至真实consumer-after-await接收 | 178.921449 | 130.366543 | 155.395370 |

`diagnose-settlement-v3.mjs::executeCase` 先在evidence Promise的then中同步取得快照、序列化归档、base64编码并启动publisher，等待publisherReady之后才await evidence并记录consumer。源码确认了consumer被置于出版准备之后；原始时序确认在publication-start之前已经超过100ms。尚未对clone、编码、调度和启动分别插桩，不能把上述整个时段归因到某个函数，亦不能称为产品或OS缺陷。下一步只处理这条实际交付顺序及其验收含义，不先增加通用容量、listener或归档研究。

保存复核中的boundedConsumerDelivery=true还存在解释限制：verifyConsumerReceipts抛出后该case phase不会加入consumerDeliveries，聚合仅有42个publication和35个case、共77个已通过phase，而完整矩阵应有80个。该true不表示三个失败case也按时，不能独立引用为整轮保证；总pass/acceptanceReady仍正确为false。此处只记录现状，未修改CLI或oracle、补造receipt或放宽100ms。

本轮full日志SHA256为 `20e68f212386b0a1c909ddff6966614077402ef62d3dca1b05d61d8df11d8c2c`，可信保存复核为 `7ac7c80739dbd0a4358a867eb425d80d5c6102b0c101fc447d6cbd553f7a9a60`。采集时core与新增测试hash见第17.1节；CLI仍为 `4c79c9259b2bf2b8c14a087fa010aff7dcaecdaf097d7710a696c30d73194e14`，oracle仍为 `b46364703af263795b3dd5ed988fa19454349273645b18eea4a951a473743bcc`。运行来源为b38a4a9f工作树上的实际源码字节，不把后续提交倒写为采集输入。

本轮收口为ACK因果确认、最小修复及一次完整矩阵的真实失败留存，不再重跑筛绿，也不宣称诊断整链或Terminal/Agent退出完整性已完成。第16节170个文件及日志不覆盖，09/gate语义和旧断言不改。后续只针对本轮consumer交付路径制定窄修正与必要回归，任何再次采集须先登记范围；不默认追加一轮工具边界审计。W1/U1真实资源、主进程自身尾部、最终终端状态及实际Agent启动链仍是产品工作目标，Windows/macOS、本轮PTY/native、Host/Webview、双会话与packaged均未因此获得通过结论。

收口只读检查确认第16节170个文件及日志hash原样、当前7份采集源码exact、未见该入口仍运行的role进程；进程列表检查不等于PTY/native资源验收。两树各七份文档同步，共享第17节相同，第2–16节正文与各自HEAD相同；两个改动脚本通过固定Node语法检查，git diff --check通过。主树仍仅文档，诊断树代码仅core的三行ACK收尾与一个新测试文件；oracle、CLI、旧fixture、D4、业务、依赖及workflow未改。
