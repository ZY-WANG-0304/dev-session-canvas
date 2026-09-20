# 验证退出完整性的原生候选

本 ExecPlan 按 `docs/PLANS.md` 持续维护。正式候选、冻结参数和结论见 `docs/design-docs/runtime-exit-integrity-native-candidates.md`。

## 目标与全局图景

用户需要正常结束时完整看到终端尾部，而不是把进程退出当成输出已结束。本阶段只验证隔离 reader 和资源生命周期，不改变生产会话。PR #294 已提供公共接口基线；本阶段通过 macOS 独占 fd、Windows 独立 pipe worker 等原生对照，证明或否定候选可行性。

两轮原生对照已经完成。2026-09-20 用户进一步明确：画板管理 Terminal / Agent 执行会话与终端资源，不默认在实际主进程退出后维持终端等待普通后代未来输出；这不以父子关系判断前后台。主进程仍运行时，同一终端收到的输出正常处理。退出时仍必须处理主进程尾部及自身已接收、排队、消费中的内容，应用最终终端状态并释放资源；实际退出、真实源结束、消费完成和主动取消不得混淆。具体收尾边界、取消条件和预算仍待确认。启动器启动的实际 Agent CLI 是执行主体，不适用普通工具后代的排除条款，需独立验证启动链生命周期。本计划下一增量以这些保留要求为先，不再把 macOS 普通后代延迟输出实验当作独立产品门禁。

## 进度

- [x] (2026-09-21) 按设计第25节冻结本增量：macOS三arm最小close对照和Windows只读类型取证，保留原资源失败；正readable控制另列后续。
- [x] (2026-09-21) 新独立入口及两平台workflow、本地机械变换/合成负例/完整失败遍历和Linux隔离构建布局预检完成；补构建链接归档、跨平台路径及有效负结果分类。
- [ ] 固定实现输入，在macOS十二driver与Windows四driver执行首次原生矩阵，完成下载与完整离线复核。

- [x] (2026-09-20) 按设计第23节冻结Windows四类各三次取消所有权与三平台同进程资源矩阵；独立driver各3预热/20测量，完整保留旧证据，不改业务。
- [x] (2026-09-20) 新worker/资源观察器/诊断/workflow实现，最终自测涵盖真实+3/-3文件计数、TCP四类、所有权/EOF/增长负例及全失败/单损坏遍历；Linux v1/v2各四driver、46条PTY及完整复核通过，原输入保留。
- [x] (2026-09-20) 输入b031b598的run35519226627 attempt1三平台完整运行并下载复核：Windows12项取消/自然对照通过，三平台各46条自然会话内容通过；macOS两组kqueue各+20、Windows两组handles各+40，四个资源失败保留，全部24个driver工件有效。
- [x] (2026-09-20) 两工作树各五份文档同步，设计状态/索引/关联路径/计划章节与diff检查通过，Windows CRLF输入只读归一核对、所有cleanup/guard审计通过；bridge回归通过，业务/依赖/旧入口零修改。
- [ ] 资源归因协议已冻结，待完成本轮macOS隔离干预/Windows类型取证；之后另冻正长度JS readable-buffer取消控制，仍不接入业务或选定生产预算。

- [x] (2026-09-20) 设计第20节冻结新原位观察/独立gate矩阵，两平台24项，增加receipt-held控制，不改旧入口/结果。
- [x] (2026-09-20) 新N-API/诊断/workflow及非PTY负例完成；本地v1全12项10通过/2个不足100ms的诊断持有失败保留，按单调截止点修正后v2及最终v3各12项/复核通过，未改门槛或期限。
- [x] (2026-09-20) 输入697ee3f0的run35516170917 attempt1两平台24项通过并完整下载复核，flags/分账/真实EOF/gate/consumer/单次资源均有证据；Ubuntu仅重试同artifact传输，原生job未重跑。
- [x] (2026-09-20) 主线及独立分支五份文档各自同步，旧脚本/断言/失败未变，元数据/引用/范围/diff及bridge回归检查通过；生产未修改。
- [x] (2026-09-20) Windows独立worker在途取消与同进程资源控制矩阵已在第23节冻结，仍不以短生命周期释放替代长期计数或选定生产方案。

- [x] (2026-09-20) 按设计第15节冻结新可读性握手：一次2048同步写、只读poll helper、实际成功read所有权与独立audit分账，三类各三次/两平台18项，不改旧实验。
- [x] (2026-09-20) 新入口/helper/workflow实现并经独立只读审查，补EOF真实回调/唯一read id交付/全部helper退出的互证；Linux本地v1/v2各9项与完整复算通过，所有原工件保留。
- [x] (2026-09-20) 输入931e8e22的run35510798036完整18项及下载复核：Ubuntu9/9、macOS8/9，control-3收齐后pending read挂起；原结果保留，未重试。
- [x] (2026-09-20) 独立源码审计发现helper启动链可清共享O_NONBLOCK，影响两平台解释；整轮暂停作为非阻塞reader验收依据，冻结设计第18节两组各三次fd标志对照。
- [x] (2026-09-20) 新原位inspect/窄控制及独立审查完成，Linux本地v1/v2各6项精确复现master仅清O_NONBLOCK/null不变；合成负例和全6项有效失败/单损坏复核通过，原工件保留。
- [x] (2026-09-20) 输入951724c2的run35511736807两平台12项及下载复核完成，Linux/macOS均实测master组仅清O_NONBLOCK/null组不变，无hard watchdog/事后kill，全部自然退出与EBADF成立。
- [x] (2026-09-20) 两工作树设计/计划/索引/原则/债务同步，保留原18项受干扰的结论及全部历史结果，核对元数据、原始快照、输入/环境/cleanup，bridge既有回归和diff检查通过。
- [x] (2026-09-20) 原位readiness/独立gate/flags不变由第20–22节新24项完成；不静默恢复flags或重判旧失败，不接入业务。

- [x] (2026-09-20) 冻结设计第13节：新v2入口保留旧七类21项及其失败判定，追加两组写入前提控制各三次；Linux/macOS共54项，原脚本和旧workflow不改。
- [x] (2026-09-20) 新v2入口、专用workflow和正容量/重复CR回放实现；Linux27项与完整离线复核通过，缺回执和篡改raw的派生验证器负对照均完整尝试27项并exit1。
- [x] (2026-09-20) 推送隔离输入7d832d3e，run35508235734 attempt1完整执行54项：Ubuntu27通过，macOS21通过/6失败，总run失败，不改标原取消结果。
- [x] (2026-09-20) 下载两平台全部工件，完整复算各27项且无evidenceErrors，macOS仍exit1；原始写入/读取控制定位夹具循环等待，同步主线设计，不将控制组或audit算作取消验收。
- [x] (2026-09-20) 本工作树5份结果文档与主线5份文档同步，元数据/索引/引用/计划章节及diff检查通过；逐项核对输入/原生快照、cleanup/driver和写读状态，业务/依赖/旧入口及workflow无改动。
- [x] (2026-09-20) 已冻结第15节无循环等待的取消握手；用非消费可读观察代替首读前全量写回执，保留2048负载与所有旧失败，执行结果及helper前提失效见第17–19节。

- [x] (2026-09-20) 新增设计第 10 节运行前冻结：Unix 7×3、Windows 7×3×2，独立子进程 watchdog 与全量留证，保留旧实验；已 fetch/rebase，main 仍为 5965adb8。
- [x] (2026-09-20) 实现三个新诊断文件及独立 workflow；Linux v1/v2/v3 各 21 项通过，分版保留取证加固原因、快照和复算；Windows 非原生自校验、外部 watchdog、bridge 既有测试及独立审查通过。
- [x] (2026-09-20) f4600844 推送后 run 35506150727 attempt 1 完整执行新 84 项并下载复核：Linux 21 项、Windows 候选 21 项达标；macOS 12 项通过、9 失败，总 run 失败。macOS 原 verifier 提前 ENOENT，另保存全 21 项补充审计，不改原失败。
- [x] (2026-09-20) 在新v2入口修正零容量read假EOF及缺回执verifier，完整两平台控制实验证明macOS原夹具先等写完才读的循环等待；原入口/断言/失败不动，取消路径本身仍待新握手验证。
- [ ] 继续 Windows 在途取消、同进程 native 资源增长（含 Apple kqueue 源码风险）、真实 provider/宿主与生产契约选型，不以本轮局部成功关闭计划。

- [x] (2026-09-20) 从 `origin/main@5965adb8` 建立独立诊断分支，冻结设计、案例和预算。
- [x] (2026-09-20) 实现独立候选、自校验与真实 socket worker 测试；本地 Node 25 完整 42 样本、保存结果复核通过。
- [x] (2026-09-20) 首轮 run 35498026812 完整执行 147 项，保留 macOS/Windows 各 6 个候选失败与 Windows 42 个原 worker 资源失败。
- [x] (2026-09-20) 修订 Windows Job 夹具并加强存活/TTY 断言；run 35498732353 再执行完整 147 项，Windows 候选 18 次完整、3 次明确取消，macOS 六项失败继续保留。
- [x] (2026-09-20) 下载两轮全部六份工件，核对 schedule/raw 哈希、Windows 全量内容/光标与输入源码 CRLF 哈希；更新设计、索引、原则与技术债，保留 macOS 开放项。
- [x] (2026-09-20) 按用户职责澄清分开产品验收与底层诊断，替代 macOS 普通后代实验的独立产品阻塞判断；旧实验、原始断言与失败全部不变。
- [x] (2026-09-20) 文档差异检查、YAML/索引/引用与计划必要章节检查通过；设计冻结协议和既有证据第 2、3、4、5、7 节逐字相同，仅五份文档改变，无业务/脚本/workflow/测试变更，未运行新原生实验。
- [ ] 下一增量优先明确主进程尾部、最终状态、资源释放和源结束/消费完成/取消的产品收尾契约与验收场景，并单独验证启动器到实际 Agent CLI 的生命周期；不在此预选 reader 或预算。
- [ ] macOS 原始 write、leader 存活/退出和 EOF 后保持 master 的控制实验作为诊断开放项保留；按保留的产品契约需要决定是否推进，不独立阻塞交付或计划归档，不把现有 read 0 直接判为产品完整性已满足。

## 意外与发现

首次run35527241793中macOS三arm/138条PTY及完整离线对照达标，但Windows新增观察器的boolean辅助函数与SDK typedef冲突，零PTY。这是Linux纯逻辑自测不能覆盖的原生编译问题；保留原输入/失败，按设计仅重命名新增诊断辅助函数，另采新输入，不改变原oracle或产品结论。

本轮源码审计发现macOS必须加入同工具链rebuilt-baseline，且node-pty嵌套node-addon-api版本不同于仓库顶层，不能混用。Windows固定DLL的Release只释放部分成员、Close另释放其余成员，支持继续取证，但尚未原生确认积累句柄的类型和归属。两项均为实验设计输入，不写成生产已修复。

run35519226627首次结果证实自然driver退出可掩盖native积累：macOS每测量会话+1 kqueue、两轮均fd15到35，Windows每次+2 handles、两轮197到237；无PTY对照稳定，全部会话内容和worker/进程退出通过。Windows12项局部取消/自然对照通过，但九次取消readableLength均0，正长度缓冲分支未原生覆盖；句柄类型仍待取证，不把源码HPCON候选当唯一根因。见设计第24节。

同进程Linux两版均可稳定区分无PTY thread7与native reader预热后的thread11，fd均21；libuv线程池预热不能当会话逐次泄漏。三平台随后各自建立基线，不能直接比较不同OS的绝对计数。

run35516170917两平台原位观察全过程保持Linux34818/macOS6，六个receipt-held控制在真实EAGAIN callback结果held时完成gate。源结束分别为Linux EIO/macOS read0；取消中的自然来源属于audit，candidate仍interrupted。Ubuntu工件第一次传输停滞，仅换新目录重传同artifact，提前ENOENT不是原生失败；见设计第22节。

原位新矩阵首次setTimeout(100)的两次实际持有不足100ms，属于诊断未建立冻结时间前提，不是丢字节；失败原样保留，按单调时钟原截止点重查后新v2/v3达标。新控制循环用原子writer状态而不是实时解析追加日志尾部，源事件与发布文件再独立互核。见设计第21节。

窄控制run35511736807直接观测两平台共享flags变化：Linux三次34818→32770、mask2048；macOS三次6→2、mask4。null组每平台三次完全不变。helper/fixture/driver自然退出、EBADF和无事后kill分别有证据；这不是旧control回执竞态重演或长期资源零增长，详见设计第19节。

run35510798036的macOS control-3完整收到2048但第4次read不返回，回执最终存在而gate未打开。C helper正文只读不等于启动链无副作用：libuv对继承标准fd清O_NONBLOCK，Linux fork与Apple posix_spawn均涉及。旧工件无F_GETFL轨迹，当时因此安排新控制，现已由第19节两平台实测补足副作用证据，但不能补造历史时序或把17个绿项外推成非阻塞reader通过。设计第17节保留首次工件和完整复核结果。

第15节当时的方案不直接用FIONREAD跨平台推定PTY master输出数量，而用helper测poll可读并拒绝挂断/错误；真实read允许合法短读但必须完整交付。请求尚未交付JS回调与内核read仍在阻塞是不同事实，当时矩阵只声明前者。helper持有master副本，要求在candidate读取前自然退出并纳入watchdog清理，但这些条件没有覆盖启动时改flags；该helper无侵入前提已被第17–19节结论否定，不是当前下一步方案。

run35508235734中，macOS六个原取消仅有enter而无returned/error/receipt，也没有read提交；无读控制保持这一状态，读放行控制则三次一次返回2048、两次read各1024并完整EOF。由此定位夹具写读循环等待，不是成功写入后candidate丢数据；应用层调用记录不证明精确内核容量。修订暂停组三次各在恢复后收到5402bytes，所有read正容量，完整最终状态成立。完整离线验证仍将六项报失败并exit1，不再因缺回执提前停止。证据见设计第14节。

新首轮 84 项中，macOS 额外 CR 令诊断 reader 的固定原始字节预算提前耗尽，真实提交 capacity 0 被脚本误当 EOF，关闭 fd 后主体 signal 1；这不是生产短读证据。取消六项无 receipt、无 read/cancel，原始 write 是否阻塞尚未证明。原 verifier 对缺失成功回执提前 ENOENT，需要支持合法失败工件完整复算。Windows 新受控暂停则有产品相关反例：90000 编号行齐全但最后 LF 和主进程 Unicode TAIL 整段缺失，候选完整，基线21次自然资源guard仍失败。详见设计第12节，不能合并成一个跨平台缺陷。

Windows 原生 baton 在 process callback 前被移除；builtin 事后 kill 与 DLL release 的实际语义需独立证明。原 worker 转发 server 的生命周期也不能由 onExit 推断。此为源码事实，尚非本轮实测。

本地 worker 自校验第一版在同一 chunk 交付全部内容后期待一定 resume，实际源可已经完成；修订为 HEAD/恢复后 TAIL 的握手，分别验证真实 socket EOF、暂停恢复和取消。此为诊断夹具修正，不是 ConPTY 失败或等待预算调整。

首轮 Windows 后代无 receipt 且 PID 已死；libuv v1.51.0 的非 detached 子进程属于父 Node 的 kill-on-close Job，不满足存活后代前提。Windows 暂停三轮文字完整但末尾光标少一行，不误报为丢掉编号文字。macOS 后代写失败及 read 0 仍须底层控制组，不能归为同一个根因。

通用后代实验测的是 PTY/ConPTY 的退出、挂断、EOF 与取消行为，不直接证明真实 Agent 已发生同类缺陷。macOS 后代失败在澄清后的产品范围之外不能单独构成交付阻塞；Windows 最终光标和自然资源释放问题仍在范围内。父先退出不等于交互式 shell 后台作业，启动器的实际 CLI 子进程也不能按普通工具后代排除。

## 决策记录

- 决策：首次Windows编译命名冲突只以dsc_boolean局部重命名修正，使用新输入/新run保留旧失败。理由：查询逻辑和所有资源断言不变，不能把工具未编译当产品通过或失败，也不放宽/WX。日期/作者：2026-09-21 / Codex。

- 决策：资源归因与正长度JS缓冲取消分阶段交付，本轮Windows只读取证、不增加HPCON释放API；macOS只在隔离副本插入close并固定spawn-helper。理由：保持原读取协议，区分工具链、观察器和唯一释放变更；Windows句柄总量尚不能唯一证明资源所有者。日期/作者：2026-09-21 / Codex。

- 决策：本轮以完整首次失败收口，下一步转native资源归属/回收的受控对照，不再只调整JS reader。理由：Windows局部所有权已验证，但macOS/Windows都有跨会话持续资源增量，驱动退出和源EOF不足以关闭债务；正长度readable分支另补，不放宽原断言。日期/作者：2026-09-20 / Codex。

- 决策：新增独立Windows取消worker，先结算held/JS readable/MessagePort/consumer拥有的数据；同进程以OS计数另判资源。理由：旧socket.destroy测试未覆盖这些归属，driver自然退出也可掩盖native泄漏；不声称取消内核挂起读取或收齐系统缓冲，保留旧脚本。日期/作者：2026-09-20 / Codex。

- 决策：收口Unix原位握手/独立gate与局部取消所有权的24项证据，下一阶段转Windows在途取消和同进程资源计数，不继续反复扩展旧helper前提实验。理由：新样本已验证这些前提，但并未覆盖实际宿主或长期native增长，不能宣布生产完成。旧结果、原生首次输入与业务边界保留。日期/作者：2026-09-20 / Codex。

- 决策：原位F_GETFL/poll观察不传master给子进程，回执/gate由独立控制循环推进；增加真实EAGAIN回调结果held的受控场景，验证read循环未恢复时gate先完成。理由：同时排除共享flags干扰与循环推进依赖，不用延时或恢复flags试绿，不冒称旧失败完整因果。日期/作者：2026-09-20 / Codex。

- 决策：以18项首次结果及12项flags控制收口本阶段，下一增量先设计原位readiness和不依赖read callback的回执/gate推进。理由：helper启动副作用已两平台实证，不能恢复旧矩阵的非阻塞reader验收资格，也不能把安静fixture误称旧挂起时序的完整因果验证。旧脚本/断言/结果不变，生产选型仍开放。日期/作者：2026-09-20 / Codex。

- 决策：暂停可读性helper矩阵的非阻塞reader验收解释，新增原位F_GETFL及同helper无PTY继承对照，不立即重跑取消矩阵。理由：观察器启动本身可能改变共享文件状态；必须先核对实验有效性，不能用17个绿项掩盖这一前提缺口。第18节冻结两平台12项，旧结果不变，不修改业务。日期/作者：2026-09-20 / Codex。

- 决策：新增只读poll helper建立可读前提，不降低2048总负载或拆小预置写；新矩阵按实际成功read的n字节对账。理由：写入完成回执不能作为首次读取前提，poll只证明可读而不保证填满64；旧失败和固定分账原样保留，新协议单独命名冻结。日期/作者：2026-09-20 / Codex。

- 决策：本轮收口为探针修复与夹具循环等待定位，不将控制组达标升级为macOS取消通过；下一增量先冻结可同时推进读写的握手及独立分账。理由：原取消路径未进入，等待全量写回执作为首读前提不具备跨平台有效性；减小负载或扩大等待不能解决契约问题。日期/作者：2026-09-20 / Codex。

- 决策：新增v2入口保留首轮脚本冻结，按非CR逻辑字节修正暂停额度，并在原2048-byte条件上增加write-enter/return/error与无读/放行控制。理由：需要解释前提失败，不能直接改变负载试绿；正容量不变量属于探针修复，不更改完整性门槛。日期/作者：2026-09-20 / Codex。

- 决策：新首轮结束后按原门槛保留 macOS 9 失败，先收口证据；不缩小2048、不增长等待或立即选择性重跑。下一步先验证夹具原始写入前提并修正正容量 read 不变量。理由：取消路径尚未进入，暂停是诊断自身假EOF，继续猜测调参不能形成可靠产品结论。日期/作者：2026-09-20 / Codex。

- 决策：下一增量使用单独命名的主进程收尾/启动链矩阵，Unix 增加取消后独立 audit reader 对账，Windows 优先实际 cmd/bat 等待链。理由：模型和公开 onExit 不能证明系统尾部；audit 收齐不等于候选已交付，Windows 取消也不能由 Unix 外推。具体固定参数见设计第 10 节。日期/作者：2026-09-20 / Codex。

2026-09-20：与运行时历史隔离，main-based 分支只推送诊断和文档。Unix 沿用既有实验参数，Windows 独立进程保留自然资源 guard，不用事后 public kill 获得绿色。候选失败同样是有效研究结果，不升级为业务修复。

2026-09-20：第二轮只改变 Windows 后代由 cmd start /b 创建以避开父 Node 的私有 Job，同时断言实际后代仍活着且 stdout 为 TTY；不使用会改变 console 的 detached 开关。冻结参数保持，原首轮失败不可覆盖，macOS 原失败不改判定。

2026-09-20（职责澄清前的历史判断）：本计划保持 active，并将 macOS 控制实验列为下一增量和归档前置条件；本轮诊断已形成可复核提交，但没有选定生产 reader 或将候选接入业务。该实验优先级和归档前置判断由下一条决策取代，原始失败未变。

2026-09-20：按用户确认的职责，Terminal / Agent 均不承诺实际主进程退出后的普通后代持续输出；将该类场景从独立产品门禁改列为底层诊断，保留两轮冻结实验和失败，不追认通过。原因是产品管理的是执行会话及终端资源，不是任意后代；这不改变主进程尾部、最终状态、资源释放和结束/取消区分的要求。下一增量优先这些保留契约与真实 Agent 启动链验证，具体收尾和预算待设计。macOS 控制组不再是无条件交付或归档前置项；设计仍比较中、验证中，计划仍 active，不宣布平台验收完成。

## 上下文与定向

本工作树的 `runtime-exit-integrity-native-candidates` 分支基于 `origin/main@5965adb8`，只承载隔离诊断与文档；尚未完成的运行时改造在另一个本地分支，不随此分支推送。`scripts/diagnostics/diagnose-unix-inplace-cancel.mjs` 编排当前四类各三次场景及离线复核，`scripts/diagnostics/unix-pty-observer.c` 是运行在同一Node进程内的只读原生观察模块，`.github/workflows/runtime-unix-inplace-cancel.yml` 在Linux/macOS各运行12项并保留完整工件。

candidate指被验证的读取器，audit指candidate结算后才接管残留数据的诊断读取器，两者不能合并计算候选交付量。gate是允许夹具主进程退出的文件信号；独立控制循环根据成功写入回执和完整字节对账发布gate，不依赖读取循环恢复。readiness只表示当前可读，EOF必须来自真实正容量读取的结束结果，取消则明确记录interrupted。后续Windows独立worker是专门读取ConPTY输出的工作线程，现有入口为 `scripts/diagnostics/compare-windows-exit-readers.mjs` 和 `scripts/diagnostics/runtime-exit-conout-worker.mjs`；不能直接套用Unix的fd/EOF语义，须先冻结新的取消与同进程长期资源协议。

## 工作计划

当前增量以设计第25节为冻结契约。在独立诊断工作树新增macOS三arm入口和Windows句柄模块/入口，共用新两平台workflow。派生副本必须记录冻结输入hash和精确机械差异，原入口不变。macOS先prebuilt再同工具链baseline/close，每arm四driver；Windows只保留旧四资源driver并替换观察器。保留旧资源oracle，外层分别判定因果对照或取证有效性；单样本异常继续其余独立项。正readable-buffer、生产API/预算和真实宿主验收不在本增量。

第23–24节增量已完成本地、三平台首次运行和全工件复核。下一增量先明确native资源所有权与回收边界，再冻结隔离干预协议：macOS验证退出监听kqueue是否在各等待/错误分支关闭，Windows先识别+2句柄的类型/身份及创建/回收来源，不预设就是HPCON。另设计Windows取消时JS readableLength实际大于0的控制，继续逐层核对数据；现有worker-held/parent-held成功不覆盖该分支。只有隔离native构建对照，不直接修改业务或安装树，不将此计划作为生产API授权。

第20–22节原位观察/独立gate历史增量已完成两平台24项及复核，当时提出的Windows局部所有权与同进程计数已由第23–24节承接；新资源失败不能被此前单次释放通过覆盖。Unix局部结果不能直接外推ConPTY或生产，业务不改。

第17–19节历史里程碑保留18项首次结果及12项helper共享flags副作用实证；当时提出的原位readiness/独立gate下一步已由第20–22节完成，不再列为当前未冻结项。仍不把fd3/dup或静默恢复flags当生产修复，不接入业务、不关闭整体退出或长期资源债务。

第一里程碑：加入 `scripts/diagnostics/compare-runtime-exit-readers.mjs`（Unix）、`compare-windows-exit-readers.mjs` 和 `runtime-exit-conout-worker.mjs`。前者从已验证 Linux 诊断承接，只扩展 Darwin 和严格换行归一。Windows 分离主诊断、单样本子进程与读取 worker。进程退出、源结束和资源退出分别记录，不使用假 EOF。先执行 syntax、自校验和本地完整 Unix schedule。

第二里程碑：新增 `.github/workflows/runtime-exit-integrity-candidates.yml`，分别运行 Unix 或 Windows 命令，保留所有基线失败及候选失败。每平台 Node 22，各 Unix 42 样本、Windows 63 样本，参数不得在失败后为了变绿调整。工件含整个 schedule、脚本及 native 哈希和环境；下载后独立核对。

第三里程碑：正式设计记录结论与首次失败分类，未复现与未测试明确写出。两轮证据已形成可复核记录；当前先同步职责澄清、产品门禁和诊断开放项，不因此立即归档。将来的诊断计划收口应明确移交残余问题，生产方案仍需要宿主、真实 provider、资源预算和完整契约集成，不以诊断计划完成关闭产品债务。

职责澄清后的扩展里程碑：先把验收分类写入正式设计第 9 节，并在运行时主线设计中确认主进程尾部、已进入链路的内容、最终状态、资源释放和取消语义；启动器到实际 Agent CLI 的生命周期单独验证，不用通用后代实验替代。只有保留产品问题需要进一步底层解释时，再用本独立分支推进 macOS 控制组：真正记录 write 返回值/errno，比较 leader 退出与保持存活，将首次 EOF 后持有 master 的观测与原关闭路径分开。新诊断执行前仍须另冻结轮次、期限和分类，不调整已有两轮原始判断；尚未确定具体实现或预算。

## 具体步骤

新入口在独立工作树使用 `node scripts/diagnostics/diagnose-macos-kqueue-release.mjs --self-test` 及 `node scripts/diagnostics/diagnose-windows-handle-inventory.mjs --self-test`；采集使用各自的 `--output <全新目录>`，完成后用 `--verify-saved <目录>` 复核。macOS需要同版本Node headers和记录版本的node-gyp，Windows需MSVC与匹配的Node import library。非本机平台只跑纯逻辑自测，不冒称native通过。workflow保存编译输出、隔离副本和全部证据，失败也上传；原生执行和下载分别留证。

当前复核入口为 `node scripts/diagnostics/diagnose-runtime-owned-lifecycle.mjs --verify-saved .debug/github-owned-lifecycle-35519226627-ubuntu/owned-lifecycle-evidence`，预期4项有效/无失败/exit0；换macos预期4项有效、native-1/native-2资源失败/exit1，换windows为16项有效、同名两个资源失败/exit1，三者evidenceErrors均空。依赖可通过NODE_PATH指向相同锁文件的主工作树。重跑采集只用新目录，不重判首次失败；下一次实验必须先写新的资源归属/正缓冲协议，不改当前冻结入口。

历史采集从本工作树执行同入口 `--self-test`、`--output NEW_DIR`，C观察器需当前Node头文件及gcc/clang；Windows runner使用MSVC与匹配版本的官方Node头和node.lib。编译记录保存所有输入与结果，输出目录必须不存在，失败工件仍上传并复核。以下旧步骤仅作历史复核入口，当前下一步以工作计划首段为准，仅推本诊断分支。

当前从本工作树根执行 `node scripts/diagnostics/diagnose-unix-inplace-cancel.mjs --verify-saved .debug/github-inplace-cancel-35516170917-macos/inplace-cancel-evidence` 或把macos换成ubuntu-retry1，均预期12项有效/无失败/exit0。依赖按锁文件安装，本地可用NODE_PATH指向相同锁文件的主工作树node_modules；不复用已有v1/v2/v3输出目录重跑。两平台24项输入已经完成，下一阶段先设计Windows取消/长期资源协议；不推运行时分支。

历史标志控制阶段已收口，独立工作树执行 `node scripts/diagnostics/diagnose-unix-helper-fd-flags.mjs --verify-saved .debug/github-helper-fd-flags-35511736807-macos/helper-fd-flags-evidence` 应attempted6/verified6、无失败/exit0；换ubuntu相同。旧握手同入口 `diagnose-unix-cancel-handshake.mjs --verify-saved .debug/github-cancel-handshake-35510798036-macos/cancel-handshake-evidence` 应9项有效、control-3失败/exit1。以下旧阶段步骤保留当时安排，命令必须改新输出目录才可重跑，不覆盖工件；当时提出的readiness协议已由第20–22节完成，当前下一步以本节首段为准，不重复旧矩阵筛绿。

当前在独立工作树根执行 `node --check scripts/diagnostics/diagnose-unix-helper-fd-flags.mjs`、同入口 `--self-test`，然后 `--output .debug/unix-helper-fd-flags-v1-local` 与对应 `--verify-saved`。新增 `runtime-unix-helper-fd-flags.yml` 只运行Linux/macOS各6项，失败仍上传并完整复核。编译时优先显式DSC_NODE_INCLUDE_DIR，其次Node安装include/node，再使用系统Node头；记录实际来源，不隐式下载或改依赖。预期master组三次仅清O_NONBLOCK、null组三次不变；这是假设复现实验，非产品通过。结果后同步设计第18节后续记录、主线设计/计划/索引/原则/债务，保留active状态。

本阶段在独立工作树根先执行 `node --check scripts/diagnostics/diagnose-unix-cancel-handshake.mjs`、`node scripts/diagnostics/diagnose-unix-cancel-handshake.mjs --self-test`，再执行 `node scripts/diagnostics/diagnose-unix-cancel-handshake.mjs --output .debug/unix-cancel-handshake-v1-local` 及对应 `--verify-saved`。helper由新入口编译到新工件目录，使用gcc/clang且保存版本、源码及binary哈希；只运行冻结的9项，不添加筛选/缩小参数。新workflow `runtime-unix-cancel-handshake.yml` 在独立分支运行Linux/macOS全18项，保留失败上传及下载复算。预期两取消类始终interrupted、候选交付实际n字节/audit收2048-n；control才允许完整自然EOF。未知或失败如实记录，不用旧入口改门槛。

写入控制阶段已完成，完整证据见设计第14节。在本独立工作树根执行 `node scripts/diagnostics/diagnose-unix-exit-tail-v2.mjs --verify-saved .debug/github-write-control-35508235734-ubuntu/write-control-evidence` 预期27项有效、无失败、exit0；将ubuntu换成macos预期27项有效、六个原取消failure、exit1，均evidenceErrors为空。重跑只能用新目录/新输入，不覆盖旧工件。下一步先设计新命名的取消握手：取消前证明read或回调实际归候选所有，取消后已有字节仍交付，audit只在所有权移交后读取，最终独立writer receipt与两份字节对账；具体握手、门槛和矩阵需运行前冻结，不能把本轮控制组改名当作取消验收。

本阶段先按设计第13节实现新 `scripts/diagnostics/diagnose-unix-exit-tail-v2.mjs`，从仓库根执行 `node --check scripts/diagnostics/diagnose-unix-exit-tail-v2.mjs`、`node scripts/diagnostics/diagnose-unix-exit-tail-v2.mjs --self-test`，再用 `--output .debug/unix-write-control-v1-local` 完整27项、用 `--verify-saved`复核。原七类21项保留90000/89800/350ms、2048/64bytes及10/1/15s门槛；新两类先观察write-enter后100ms状态，一组从不读并明确中断，另一组放行读取并完整结算2048bytes。专用workflow两平台共54项，失败仍上传、下载和完整复算，所有输出新目录。前提未成立的原六项不能以新控制组结果替代通过。

新阶段使用相同 lockfile 的本地既有依赖，新增两个入口支持 `--self-test`、`--output NEW_DIR` 与 `--verify-saved DIR`。仓库根执行 `node scripts/diagnostics/diagnose-unix-exit-tail.mjs --output .debug/unix-exit-tail-v1-local`；Windows runner 执行 `node scripts/diagnostics/diagnose-windows-launch-tail.mjs --output exit-tail-evidence`。两个入口先通过 `node --check` 和 `--self-test`。新 workflow `runtime-exit-tail-products.yml` 仅独立诊断分支 push/手动触发，Node 22 三平台、只读权限、保留全部失败。不得为触发 workflow 推送未完成运行时分支。

Unix 固定 21 项（自然零/非零、暂停、分片、消费通知延迟、两种在途取消），90000 行、350/100 ms、单样本采集/资源/独立硬截止 10/1/15 s。取消前成功写 2048 bytes、候选 read 64 bytes，候选停止新增 read 后 audit 才接管剩余字节；二者分开计账。Windows 固定 42 项（7 类 direct/cmd/bat/不等待负控，两 reader 各三次），90000 行、1500 ms 暂停、100 ms 主体持有 gate、采集/退出观察/资源/硬截止 30/2.5/2/35 s。旧矩阵不调整。运行前冻结详细协议见设计第 10 节，首次失败必须保留。子进程自然退出不证明长期无句柄增长，Windows 在途取消仍是后续未测项。

在仓库根，先 `npm ci --no-audit --no-fund`（本地可使用相同锁文件的既有依赖）。执行两个比较入口的 `--self-test` 与三个脚本的 `node --check`。Linux/macOS 执行 `node scripts/diagnostics/compare-runtime-exit-readers.mjs --output NEW_DIR`；Windows 执行 `node scripts/diagnostics/compare-windows-exit-readers.mjs --output NEW_DIR`。Unix 保存结果用 `--verify-saved NEW_DIR` 复核。输出目录必须新建，不能覆盖历史。

push 前 fetch/rebase main，仅推当前诊断分支。通过 `gh api` 查 run/jobs/artifacts，下载三平台完整证据。runner 失败不得只重跑成功项；修订脚本应新提交并记录前后 run。最终 `git diff --check`，校验设计 frontmatter、索引和本地引用，确认 extensions/package/既有 baseline workflow 无差异。

## 验证与验收

目标是给出候选可行或不可行的原生证据，不要求所有候选通过才算研究完成。可信 EOF、完整内容、实际退出结果、取消和资源自然退出分别判断；原路径反例完整保留。不把错误 oracle 当平台缺陷，不把自然子进程退出当零 OS 句柄保证。不改变 90000 行断言、固定轮次或等待上限。

产品验收与冻结诊断分别记录：主进程尾部、已接收/排队/消费内容、最终光标/状态和 reader 资源释放仍需验证；主进程运行时同一终端的后代输出正常处理；启动器退出不能未经验证就当成实际 CLI 退出。普通后代在主进程退出后的延迟输出只按旧诊断门槛保留结果，不独立阻塞产品，也不据此宣称 macOS 产品通过。文档范围澄清本身通过 `git diff --check`、frontmatter/索引/引用检查，以及仅有指定文档差异来验证；不为范围调整重跑或修改旧实验。

## 幂等性与恢复

只创建和清理本次 fixture，PID/进程组来自本次启动。硬截止与正常完成分开保存，清理不得误作用真实会话。唯一 evidence 目录、GitHub run/attempt 命名及源码 hash 防止覆盖。没有用户 storage 迁移或回滚需求。

## 结果与复盘

2026-09-21本增量目前仅冻结资源归因协议，原生结果待采集；不能将拟议close或Windows类型预期写成验证结果。旧run35519226627的四个资源失败保持，整体退出完整性仍未交付。

本轮第23–24节已完成新实现、自测、Linux本地两版各46条PTY与三平台首次原生全量复核。run35519226627共24个driver/150条真实会话，20个driver通过、macOS与Windows各两个资源组失败，全部工件有效；不能将会话内容通过当资源或产品通过。Windows九次取消的正长度readable分支未覆盖，后续补受控场景；Apple kqueue已有native积累证据，Windows+2句柄身份尚待定位。旧24项及全部历史失败不改，生产方案仍未选定。

历史原位矩阵已完成本地v1/v2/v3、自校验及远端24项/完整离线复核，首次两个诊断持有失败保留，Unix这组前提/所有权有有效证据；不外推生产验收。当时提出的Windows与同进程资源已由第23–24节承接，旧hash/目录/负例与传输重试边界仍见第21–22节。

新18项与窄12项均完整运行/下载/离线复核，前者总run失败，后者精确复现两平台helper清O_NONBLOCK；旧矩阵需限定为受干扰观察。实验有效性根因已定位，但旧回执竞态没有补造原始证据，不能用修正探针或局部绿色收口生产取消。Windows在途取消、长驻资源、真实provider/宿主/packaged仍开放。

可读性握手阶段完成运行前冻结、新工具与Linux本地两版各9项及自校验；最终输入脚本hash1875495f记录于设计第16节。远端18项结果及其有效性限制见第17节，不能用本地结果替代macOS或旧失败。独立审查发现的离线证据互证缺口已补回调/read id/helper链断言，不调整冻结期限或把诊断升为生产实现。

写入控制增量完成本地27项、两平台原生54项与完整复算，输入7d832d3e / run35508235734。Ubuntu27/27、macOS21/27，总失败保持；修正的新暂停实验通过，六个原取消仍失败，但已由独立写读控制定位夹具循环等待。失败工件验证器完整遍历且诚实exit1，首轮假EOF和所有旧失败保留。后续先冻结取消新握手，继续Windows在途取消、长驻native资源、真实provider/宿主与生产API，不用局部控制通过关闭计划。

此前完成本地三版各21项与三平台84项，首轮输入 f4600844 / run 35506150727 完整证据已下载复核。Linux21项和Windows候选21项达标，实际bridge启动器生命周期通过但三个主进程尾部/21个资源反例仍在；macOS12/9，三项诊断假EOF与六项前提未成立分别记录。原失败验证器不足用独立只读审计补齐，不将原命令追认为成功。该轮问题由本次新实验继续定位而非重判，计划仍active，旧294项失败和断言不改。

已完成冻结、脚本和本地 42 样本；两轮远端各 147 项，总计 294 项原生候选对照，完整保留失败。Windows 初轮后代夹具前提失效，修订后候选 21/21 达标，但原 worker 的每轮 42 次资源失败仍在；Linux 两轮候选均 21/21；macOS 两轮均有六项后代失败，继续由此计划保存为诊断开放项，不再独立阻塞产品交付。本轮只重评职责和优先级，主进程尾部、最终状态、资源释放、真实启动链以及收尾/取消设计仍待推进，不归档为跨平台选型完成。两入口自校验、真实 TCP worker 和三个脚本语法通过；最终证据哈希/文档核对另记进度。不宣称生产、真实宿主或 packaged 已修复。

证据收口检查：第二轮 builtin 三个后代在 public onExit 后留下成功 writer receipt，但呈现只有 `PARENT`；候选完整收到 `CHILD_TAIL`。两轮 Windows 保存结果复算分别报告 6/0 个候选失败，不把离线验证当新增原生轮次。元数据/索引/related paths、workflow 只读权限与分支边界、`git diff --check` 通过；业务、package/lockfile、已有 baseline 入口/workflow 无差异。未执行完整 UI/Agent/packaged，资源预算仍未完成；macOS 控制组保留但不是无条件交付前置项。

## 证据与备注

本次输入b031b5981af6d009455d172e6c727d0b8a56ee67、run35519226627 attempt1完整失败保留。Linux/macOS/Windows分别4/4、4/4、16/16工件有效，后两平台各报告两个资源失败，非工件损坏；目录、环境、原始hash与服务端工件digest见设计第24节。Windows CRLF源码只读归一后与LF提交逐字相同，原工件没有改写。各平台观察器真实+3/-3自测通过，无driver watchdog或事后kill。

前一阶段固定原生输入为697ee3f0012aa9d68f1774fa9a43ba3836e165d7，run35516170917 attempt1的Ubuntu和macOS分别12/12通过。两个下载目录的独立离线复核均输出：

    {"attempted":12,"verified":12,"failures":[],"evidenceErrors":[],"note":"Offline verification, not new native execution."}

原始工件位于 `.debug/github-inplace-cancel-35516170917-macos/inplace-cancel-evidence/` 和 `.debug/github-inplace-cancel-35516170917-ubuntu-retry1/inplace-cancel-evidence/`，完整输入哈希、环境、工件ID和传输重试边界已写入设计第22节。本地v1两个不足100ms的失败和全部旧原生失败保留，复核成功不是新增原生样本或生产通过。

## 接口与依赖

使用锁文件中的 node-pty 和 @xterm/headless；私有 native fork/start/connect 仅诊断，不作为业务 API。无新依赖，不编辑 node_modules。Windows worker 只在本次新 pipe 上拥有唯一 reader；资源上限和生产消息背压仍待设计。

修订记录（2026-09-20）：根据用户澄清分离产品收尾责任与普通后代诊断，替代 macOS 控制组的独立产品阻塞/归档前置判断，保留原断言及失败，并将真实 Agent 启动链列为独立必验项。本次不修改业务、测试、脚本、workflow 或原始工件，不选定方案或时间预算。

修订记录（2026-09-20，新原生阶段）：新增并冻结84项主进程/启动链矩阵，在独立分支新增诊断/workflow，不修改旧实验；完整运行、保留首次失败并分平台复核，登记新探针正容量读取/失败验证器缺陷、macOS写入前提控制组及长驻资源风险。只收口研究增量，不选定生产实现或预算。

修订记录（2026-09-20，写入前提阶段）：保留所有旧入口，以新v2入口修正正容量读取和失败工件复核，并冻结27项/平台的写入控制矩阵；先证明前提、不缩负载、不增超时、不改业务。

修订记录（2026-09-20，写入控制收口）：完整下载复算run35508235734的54项，保留macOS六个原取消失败；记录读放行后同步写返回的原始证据、夹具循环等待根因及调用级证据限制，移交无循环等待的取消握手和长驻资源验证。未修改业务或历史证据，不归档计划。

修订记录（2026-09-20，可读性握手冻结）：新增18项窄矩阵与只读poll helper，保留单次2048写和原等待上限，明确实际read所有权、audit非候选输出、helper生命周期及短读语义；本阶段仍不改业务。

修订记录（2026-09-20，观察器有效性）：完整18项首次结果和离线复核已保留；helper启动链的共享flags风险使整个矩阵需要限定解释，新增12项原位标志控制先证明前提，不改旧脚本或失败、不接入业务。

修订记录（2026-09-20，标志控制收口）：两平台12项及下载复核完整通过副作用复现预期，将共享flags变化记录为目标组合的native事实，不补造历史回执时序；下一增量先设计原位readiness/独立gate，旧结果与生产边界不变，计划保持active。

修订记录（2026-09-20，原位矩阵收口）：先冻结新24项，再完成本地三版和两平台首次原生运行/下载复核；保留本地两个不足100ms的失败及所有旧结果。Unix前提/独立gate/局部取消证据已建立，转Windows在途取消及同进程长期资源；未选定生产方案、未修改业务或归档总计划。最终文档检查补齐独立计划的上下文导航与证据章节，并标明旧步骤的历史性质，避免重复执行已完成阶段。

修订记录（2026-09-20，所有权与资源冻结）：运行前固定Windows12项与三平台各四个同进程driver、计数oracle和全部失败规则，区分JS已拥有数据、系统缓冲及有界资源证据；只新增诊断，不改业务或旧实验。

修订记录（2026-09-20，所有权与资源结果）：完成本地和三平台首次原生/全工件复核，明确Windows局部数据结算通过但正readable分支未覆盖，macOS kqueue与Windows句柄持续积累。保留四个资源失败及所有旧证据，转native资源归属/隔离干预对照，不将JS reader替换当完整修复，计划仍active。

修订记录（2026-09-21，资源归因冻结）：将macOS三arm因果对照与Windows只读类型取证固定为本增量，正readable控制另列后续。保留原schedule、资源断言及历史失败，只新增独立入口；原生结果待采集。
