---
title: 执行会话退出完整性交付
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity.md
updated_at: 2026-09-25
---

# 执行会话退出完整性交付

## 1. 已确认范围与决策状态

当前S3实施与验证见 `runtime-exit-integrity-production-integration.md` 第15.6节，仍比较中/验证中：Linux/Node22.23.2首次两个真实PTY场景保持Control send failed/0/2，资源安全及provider关闭不追认场景通过。已实施显式sourceEndAccepted握手，首败后adapter43组/channel6组、core2组、source断言组1、bridge/typecheck及fixture strict通过，独立复核无本切片确定性blocker；尚无修后原生采集。首次trace未指明失败消息，离线原文/终态补验不代替首次live断言。下一阶段只冻结新输入/新目录复验相同两场景，不扩矩阵或工具，不接现有业务、runner或push；边界见第6节，旧证据保持。

最新原生证据仍以 `runtime-native-failure-isolation.md` 第27.10节（2026-09-24）为准：唯一输入1a88d0cc、push run35963751067 attempt1在macOS26.6.2 arm64/Darwin25.6.0、Node22.23.2完成3个新U1-6原生样本，runner及可信本地`--verify-saved`均3/3。30项纯测、零会话build/load与原生执行分账。第26节32312fe7/run35900772851 attempt1的U1-0三次3/3及旧失败独立保留，不重跑、不追认早期6/6、10/10、21项覆盖。这仍是合成注册失败的限定诊断证据，不是生产退出完整性验收。

2026-09-20，用户同意将“退出完整性”作为本次 Runtime Persistence 重构的独立交付项。它与 F-04 容量优化、F-05 取消 completed 内联分别验收；不能等其他重构完成后假定问题自然消失，也不必等待整体终端状态替代或 F-03 root 归属改造才能推进。

已确认的是交付目标、范围和正确性门槛，未选定具体 reader、依赖版本、native adapter 或消息 API。立项后进入隔离候选验证，本文状态为 `比较中 / 验证中`；局部实验不代表业务已修复或生产方案已选定。沿用“不直接修改业务代码”的边界，本阶段只增加诊断与设计，后续业务实施另行推进。

同日用户进一步澄清：管理对象是 Terminal / Agent 执行会话及其终端资源，不是每个后代进程；实际主进程退出后，不默认继续维持节点或终端以等待普通后代结束或接收未来输出。第 3、5 节已按此更新，第 18 节记录证据重分类与阻塞判断；此前冻结实验和失败结果不变。启动器下的实际 Agent CLI 仍是执行主体，不能按普通工具后代排除。

完成重构时若该项仍有未收口缺陷或原生平台验证缺口，就不能把本次重构的退出完整性宣布为完成；允许说明其他独立增量的已完成结果。任何支持范围缩减或发布例外必须显式记录并由用户确认，不能把未实测自动解释为不在范围。

当前增量的脚本、workflow及.debug证据均只在独立 `runtime-exit-integrity-native-candidates` 工作树 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates`；本主运行时树只同步文档，没有新增这些诊断入口。第41–43节分别记录v1两次失败、v2窄协议与本地证据；其中“未提交工作树”仅指采集当时的诊断源码快照，后续实现已提交为b4db41cc，不能倒写本地采集为commit运行。唯一v2 run35676427931 attempt1的完整下载/独立审计及三平台窄验证见第44节，生产契约阻塞项仍未闭合。

## 2. 问题与证据基础

`docs/design-docs/runtime-terminal-tail-diagnosis.md` 确认 Linux PTY 过早 EOF，原始 onData 已缺字节。`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md` 又区分 Unix 200 ms 强制关闭、Windows 默认 ConPTY 1000 ms 静默关闭及公共业务的退出假设。该轮 Windows 为实际 JS/reader 夹具、macOS 为源码核查。随后 PR #294 的三平台最小原生基线补充见第 12 节；它没有重现或消除所有上述机制，不能将不同证据层级混为全平台修复。

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 直接转发 node-pty onExit，却假定输出已完整排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` / `finalizeSession()` 在 exit 后封闭新事件，只收敛已接受操作；`src/panel/CanvasPanelManager.ts` 的 local Agent/Terminal finalize 同样取消输出监听。公共队列尚未发现丢失退出前已接受数据，但它无法补回未进入回调的字节。分页与 final revision 也不能证明源完整性。

## 3. 交付契约

以下是已确认目标，不是对当前实现已满足的描述。

| 边界 | 必须满足的结果 |
| --- | --- |
| 自然终止，包括 exit code 0 和非零 | 对于未被用户取消的当前消费者，主进程已成功写入终端的尾部必须按序完成交付与显示，自身已接收、排队或消费中的内容不能因提前清理而丢弃；不能缺尾、重复或破坏字符/终端控制序列。命令执行成功与输出交付完整是两个独立判断。 |
| 进程退出、源输出终止、消费者应用完成 | 分别证明；不能以 waitpid、exit code、socket close、静默时长或 final revision 单独替代全部证明。源 EOF 自身也必须可信。 |
| 主进程仍运行时的后代输出 | 同一终端收到的输出正常处理，不能因来自后代而忽略；不要求逐个托管或追踪这些进程。 |
| 实际主进程退出后的普通后代 | 不默认承诺保持节点或终端、等待后代结束或接收未来输出。保留尾部收尾义务；真实输出结束与主动取消分别记录，超时/截断不能伪装成完整 EOF。具体收尾边界、取消条件和预算待设计确认。 |
| 启动包装程序下的实际 Agent CLI | 实际 CLI 是执行主体，不是可排除的工具后代。启动链必须正确代表其生命周期，包装程序退出是否表示 Agent 结束须单独验证。 |
| 正常停止与强制停止 | stop 请求不等于输出已结束。可完成正常排空时继续交付；若确实强制切断，必须可辨认地表达取消/中断及完整性未知或截断，不能标成已完整交付。不得仅为通过验收把所有正常退出改标为中断。 |
| 显式删除、页面关闭或读者失效 | 按已有取消语义释放对应消费者和资源，不无限等待被取消者。一个读者取消不得截断其他仍有效的读者；删除语义不能被伪装成自然排空。 |
| Runtime 结束后的重开 | 仍只恢复轻量节点和退出结果，不恢复原进程、不保留终端正文；当前读者的收尾不能重新变成长久归档。 |
| Supervisor 崩溃或机器重启 | 仍不要求恢复进程和历史。本交付不新增灾备服务，也不把这些例外扩大为正常运行可丢尾部。 |

覆盖 Agent 与 Terminal、`live-runtime` 与 `snapshot-only`，以及 Linux、macOS、Windows 的实际受支持执行路径；Remote SSH 按实际执行端平台验收。只扩展 snapshot-only 的退出完整性验收，不改变其既有持久化/关闭产品边界。原始 PTY 内容经 Windows ConPTY 的 VT 转换时应校验终端语义和编号内容，不能误用 POSIX 原始字节完全相同作为跨平台唯一门槛。

上述尾部保证从主进程成功写入终端的数据开始，不包含程序自身尚未 flush、未写入 PTY 的应用缓冲，也不扩展为等待主进程退出后普通后代的未来写入；已有接收和消费链路的内容仍受保护。程序自己输出的不完整 UTF-8 或控制序列按既定解码和终端语义处理，不要求补造或修复生产者内容。分片测试应同时记录实际写入边界与预期终端结果，区分生产者本身的内容与读取截断。

Terminal 内的命令、子进程与后台任务由 shell、应用程序和操作系统管理；Agent 工具命令及其后代由 Agent 管理。这不是“Terminal 有父子问题，Agent 无关”的区分。父子关系和前后台关系是不同维度，未验证交互 shell 作业控制时，不能将父进程先退出的实验后代称为后台作业。范围收窄不表示立即销毁终端，也不改变轻量节点保存或旧 live 会话绑定。

## 4. 实施边界与候选

源读取边界由 `executionSessionBridge.ts` 及其 node-pty/native provider 接入负责。候选包括可验证的上游读取修正、维护受控 adapter 或替换局部 provider；需要比较平台覆盖、VS Code/Electron 实际可用性、native 打包成本、解码和取消行为后选定。现有 Linux 私有 fd 同步补读只用于诊断，不是获批的生产实现；不能因某 libuv tag 有一个修正就宣称 Unix/Windows 的其他关闭机制也被解决。

生命周期契约需贯穿 Supervisor 与 Host local PTY，必要时同步 `common/runtimeSupervisorProtocol.ts`、`common/protocol.ts` 及 Webview 终态投影。可比较由 adapter 聚合可信最终事件和显式分离过程事件两种路线；`drained`、`interrupted` 等仅是本文解释用语，字段、枚举、文案和 API 均未选定。仅重命名 EOF/exit、增加等待或删除 admission guard 不能代替源完整性证明。

旧 live session 继续其原 Supervisor/backend/storage/session/generation 绑定，不改地址冒充迁移，不为修复强制重启旧进程。新 Host 连接旧实现时不能补造“已经可靠排空”的能力；按已知能力降级并可辨认地保留完整性限制。新旧协议和结束原因如何协商需在实现前明确，不能无条件向旧客户端发送它无法解释的新契约，也不因当前诊断自动取消所有兼容路径。

退出完整性不得让容量重构倒退为全量聚合、无限内存/无限等待，或者让当前输入长期阻塞。所选 reader 的批次、退出等待/取消上限、日志与读者保留预算，在方案选定时给出数值和失败语义；本次范围确认不预设数值，更不接受用截断正常输出满足预算。

## 5. 验收门槛

| 场景组 | 必需证据与通过条件 |
| --- | --- |
| 严格大输出自然退出 | 保留 100000 scrollback、90000 行及逐行内容断言，覆盖零/非零退出。写入完成凭证、源回调、bridge、journal/状态、分页及实际终端投影对账，不能只检查末 marker 或 revision。 |
| 各平台已知关闭机制 | Linux HUP/partial read、Unix 有缓冲时关闭、Windows builtin/DLL 与 worker/pipe 关闭分别验证。已复现缺陷路径须提供旧实现缺失/候选消除缺失的对照；尚未复现或作为对照的路径仍按冻结矩阵验证完整性并保留未复现结论，不要求人为制造旧版本失败。未经原生验证的夹具只作为局部证据。 |
| 分片与持续交付 | 主进程尾部的 UTF-8 跨 chunk、ANSI/OSC、慢消费/背压与大输出均不静默缺失；同一终端在主进程仍运行时收到的后代输出正常处理。合法的终端转换按语义对照。 |
| 实际执行主体与启动链 | 对实际支持的直接 CLI、shell/cmd.exe/CLI 启动器路径，分别记录包装程序与实际 CLI 身份和退出时序，验证会话生命周期代表实际主体；受控夹具与真实 provider 证据分开。不能用通用后代实验替代。 |
| 生命周期与多读者 | stop、强制停止、delete、读者取消、退出期间 Host/Webview 生命周期变化及多个既有读者，分别验证排空/中断/取消，不串会话、不重复终态、不误删其他来源。 |
| 新旧版本共存 | 新会话使用所选已验证路径，旧会话原绑定继续可控；旧实现缺少证明时明确限制，不宣称被新 Host 修复，也不覆盖或迁移旧 live 进程。 |
| 原生平台与模式 | Linux/macOS/Windows 各自在实际 Node 和实际 VS Code/Electron 上验证 Agent/Terminal 的两种模式。真实 provider 的最小退出场景与确定性 fake-provider 压力证据分开报告；缺 runner 的格子保持未完成。 |
| 回收与非目标 | 完整交付或显式取消后释放会话拥有的 reader、worker、PTY/pipe 与句柄，验证最终终端状态；这不是托管/等待所有普通后代的要求。Runtime 重开仍无正文、不自动执行；不新增 completed 归档或跨机器故障恢复承诺。 |

重复轮次、并发负载、版本清单和性能/等待预算须在候选实验前登记并冻结，保留所有首次失败，禁止运行到成功后只报告成功样本。单元/契约、真实原生 PTY、真实宿主与 packaged smoke 是不同层级的证据，最终交付需要对应层级齐全。既有诊断脚本的 exit 0 只表示特征断言成立，包含预期失败反例，不可充当修复验收。

“实际主进程退出后普通后代延迟写入/保持 slave”单列为底层诊断，保留原门槛、失败与取消结果，不进入必须支持后代续跑的产品门槛。若诊断进一步证明主进程尾部、已接收内容、最终状态或资源释放有问题，按对应产品条目阻塞；仅未收到退出后后代未来输出不能独立阻塞。详细重评见第 18 节。

## 6. 下一步与状态

第27.10节的三个U1-6样本在真实取得并登记kqueue后注入数字EIO，`registrationErrorSource=native-substitute`且真实注册/等待kevent未调用；data gate保持关闭，token/PID绑定abort/ack、exit0、同一实际Wait线程唯一waitpid及kqueue/master收尾成立。没有发送go或正常负载，不将read/parser为0、raw为空、state为null解释为真实EOF或终端状态排空。合法非零/signaled已回收不虚构资源泄漏，wait未知仍应保留kqueue未结算、禁止payload/通知并停排；这三个受控成功样本不等于真实系统注册错误或全部unknown路径验收。

完整ZIP与GitHub摘要一致，21个runner来源、16个采集来源及2768个build成员已核；独立构建/来源与原始事实审计结果统一见第27.10节。runner及可信本地保存复核均3/3，可信离线不执行归档代码。30项纯测试是前轮21项（源码3、角色mock7、verifier11）加build3/schedule6，13个JS语法检查另记；准备期guard-only子进程和未执行stub binary仍不是原生证据。同组本地/runner复核不累加覆盖，旧U1-0源码、原始工件、断言及失败均不改，业务未接入。

S3生产接入第15.6节保留首次两项Control send failed/0/2与主树.debug/s3-linux-provider-first原始工件；normal exit7/readBytes2108，flood signal15/readBytes73472，allOwnershipSettled=true、cleanup safe/steps=[]且provider关闭，不以安全回收改判。代码复核确认缺少源结束握手会使正常关闭与迟到信用发送竞争，但首次trace未记录失败消息类型。新sourceEndAccepted(finalFrameId)已实施：父端合法sourceEnd后停止/清除未发送信用回执，确认等待旧在途发送，provider等确认才close、不等消费；真实发送失败仍fault。首败后adapter43组/channel6组、core2组、source断言组1、bridge/typecheck及fixture strict通过，独立复核无本切片确定性blocker，无修后原生采集。离线normal2108B精确且终态重建正确，flood73472B全x等于native readBytes；首次live终态断言未执行，不追认通过。下一阶段只冻结新输入和新目录复验相同两个场景，不扩矩阵/工具或runner/push；首跑前38+1、S2/S1及全部旧证据保留，其他平台、真实Agent、两authority/reader、owner失联、packaged及产品总债务仍开放。

第25阶段历史记录（以下三段按当时状态保留，其macOS协议待办已由第26阶段承接，不覆盖当前实施顺序）：

当前以 `runtime-native-failure-isolation.md` 第25节（2026-09-24）为准：复用冻结的6e96a9dc原生候选和既有build、不重新编译，唯一新v6切片U1-0一次、U1-5三次共4/4，采集CLI与另起进程的离线复核均exit0。四项仍保留成功写2102/读2104字节、真实EIO、完整headless状态及光标x6/y4、真实wait1792/exit7和逐资源收尾。本轮19项纯回归通过，为新增8项判定加前代11项，与四次原生执行分账；旧第20阶段3通过/1失败/2未运行及exit13、第21至24阶段各自4/4和原断言均保留，不补跑、不重判、不合算。

U1-5在真实close单次返回0、error0后扣留上层receipt；audit在caller的100ms截止前到达，但只作独立事实，不代替被测释放回执。caller首次仍为observation-unknown且receipt为null，observer按自身时钟收到unknown后至少持有100ms才允许同一operation的迟到receipt；current补证为released，首次unknown及其时间保持，不再次close。这是JS回执扣留的有限证据，不是真正close失败或挂起，也不代表环境销毁、其他平台、真实Agent或Supervisor/Host/Webview/packaged整链已验收。

下一最小阶段回到跨平台原生路径：先冻结macOS U1-0正常基线及该平台创建、等待、释放差异，再按已有runner准备有限独立输入，不直接把Linux U1映射过去。本轮不实施平台适配、不运行runner或推送，不追加通用工具门槛；生产API、隔离策略和停止预算仍未选定。

第24阶段历史记录（以下两段按2026-09-23当时状态保留，其U1-5待办已由第25阶段取得限定证据，不覆盖当前下一项）：

当前以 `runtime-native-failure-isolation.md` 第24节（2026-09-23）为准：新6e96a9dc原生候选在原预算下完成唯一v5切片U1-0一次、U1-4三次共4/4，采集CLI与另起进程的离线复核均exit0。四项均保留成功写2102/读2104字节、真实EIO、完整headless状态及光标x6/y4、真实wait1792/exit7和逐资源收尾。61项纯回归为旧45项加本轮5项补丁、11项判定，与原生次数分开。旧第20阶段3通过/1失败/2未运行及exit13、第21/22/23阶段各自4/4均保留，不补跑、不重判、不合算。本轮主树仅文档，不改业务、不推送。

U1-4在真实wait终态和payload分配后跳过实际Push调用，仅返回合成napi_closing；未入队payload仍由native持有并先单次释放，实际尚持有的TSFN acquisition随后单次Release，再完成线程/finalizer收尾。没有伪造通知或JS退出callback，未交付通知不抹掉真实终态，也不免除尾部和资源要求。此注入未执行真实closing的引用递减，不意味着真实napi_closing之后可再次Release，更不代表环境销毁、其他平台或产品整链已验证。下一最小项为Linux U1-5，先冻结真实close成功后扣留回执的具体协议，本轮尚未实施，不追加通用工具门槛；真实Agent、并发、Supervisor/Host/Webview/packaged及生产API/停止预算仍开放。

第23阶段历史记录（以下两段按当时状态保留，其U1-4待办已由本阶段取得限定证据，不覆盖当前下一项）：

当前以 `runtime-native-failure-isolation.md` 第23节（2026-09-23）为准：新2a291215原生候选在原预算下完成唯一v4切片U1-0一次、U1-3三次共4/4，采集CLI与独立离线复核均exit0。四项均为真实wait1792/exit7、完整2104字节、真实EIO和最终光标x6/y4；场景、资源、证据三类判定均成立。45项纯回归通过，其中本阶段新增5项补丁和12项判定，与原生次数分开。旧第20阶段3通过/1失败/2未运行及exit13、第21/22阶段各自4/4均保留，不补跑、不重判、不合算。第46节及此前诊断契约按历史时点保留；本轮主树仅文档，不改业务、不推送。

U1-3由同一个真实wait线程先跳过一次waitpid并保留合成-1/ECHILD的不可变firstAttempt，再独占取得真实终态；不解释无效status，不把首报覆写为exit0，也不增加竞争waiter。两场景都保持正常输出、单次payload/通知、TSFN Release、join/finalizer和parser完成后close。三个U1-3的JS首报快照均为currentWaitConfirmed=false；本次没有真实ECHILD、EINTR重试或回收后才观察首报的原生样本，不宣称这些边界已验证。下一项为Linux U1-4：先冻结真实wait成功后跳过通知并返回合成napi_closing时的TSFN/payload归属协议，尚未实施，不等同真实环境销毁。其他平台、真实Agent、并发及Supervisor/Host/Webview/产品验收仍开放，生产API和停止预算未选定，不新增通用工具前置。

第22阶段历史证据：fa6f9ab7候选的新U1-0一次/U1-2三次4/4和28项纯测试独立保留。U1-2在真实nonblock/TSFN后以合成EAGAIN跳过线程构造，close、SIGTERM请求、TSFN Release/finalizer及创建者独占WNOHANG回收成立，真实wait256/exit1；未创建thread/payload/notification，不伪造其释放，也不声称真实OS线程创建失败已验证。

第21阶段历史证据：同一aff95d1e候选、冻结v1执行角色及原预算的新U1-0一次/U1-1三次4/4，采集和离线入口exit0；仅在v2中收口退出形式与资源准入耦合、新入口循环导入问题，旧v1结果和源码不改。该批U1-1的exit1与本阶段U1-2属于不同故障点和新输入，分别保留。

第20阶段历史证据：U1-0各次均记录writer成功写2102字节、PTY原始2104字节（Linux ONLCR）、真实EIO、wait exit7、完整headless状态及最终光标x6/y4，master close、waiter thread、payload和TSFN均已结算。U1-1关闭前fd flags32770仍blocking，跳过非阻塞设置并记录合成EIO、未提交read；close和SIGTERM请求均返回0，真实wait status256/exit1/signal0，已登记owner均已结算。`kill`返回0不要求随后以信号退出，失败的退出形式不能抹去这些资源事实；本机glibc `forkpty`子路径在`login_tty`失败、信号仍阻塞时`_exit(1)`只是原因候选，尚未证明本样本命中。

第20阶段历史入口记录：原入口在最后`verifySaved`动态导入入口自身形成top-level-await循环并exit13，原失败保留，不能称原CLI已修好。新增只读独立入口 `verify-native-failure-v1.mjs` 直接导入冻结verifier；`standalone-verification.log`记录离线重放exit1，仍为3通过、1失败、2未运行且仅原U1-1失败，没有新增native执行。该入口缺陷与U1-1冻结判据失败分别记录，原driver、verifier、测试、原始证据、原断言和历史结果均保留。

执行入口为 `docs/exec-plans/active/runtime-exit-integrity.md`。第 7–17 节记录早期 reader、runner 与收尾契约对照，第 18 节收口职责澄清，第 19–28 节记录屏障、受控启动链、取消所有权和同进程资源，第 29–34 节记录资源归因、Windows 正常对象语义及已知 HPCON 最终 Close。最新138条原生会话支持 bundled DLL 自然路径的最终释放责任，原四个 no-close 资源失败仍保留；不把正常 Process 引用存续当系统缺陷，也不宣布具体旧句柄身份已确认。

第35–39节承接 provider/adapter 生命周期契约及D1/D2新诊断，分版证据记录在 `docs/design-docs/runtime-execution-lifecycle-contract.md`。D1本地及三平台模型通过，D2原校验器三平台各24条及全部下载复核通过，但独立审计发现Windows G07三条真实提前关闭前提未建立；原绿色结果、首版缺口及历史失败均保留。第38节冻结的新Windows-only三模式各三次补证已按cf359040/run35631266321 attempt1完成，九项原verifier及独立原始审计通过，结果见第39节；只补新样本的真实关闭/存活与负控证据，不追认旧三条、不修改guard及预算。第40节保留原生异常和unknown owner有界隔离的设计冻结记录，第41–43节承接已实施的D3/D4 v1两次runner及D3 v2窄修正。v1跨pipe顺序误判、真实预算迟到和writer核验债务分别保留；b4db41cc唯一v2 runner的完整下载/审计已在第44节完成，当前先另冻并补三独立settlement、不可变首次观察、有界unconfirmed、writer协议/预算及D4完整身份重放，不启动W1/U1。Windows builtin、其余通知/环境销毁、正长度 readable-buffer、真正Close挂起、并发与真实 Agent/Host/Webview/packaged 仍待验证，具体 reader、wire API、生产取消和预算未选定。macOS 普通后代控制实验仅作诊断，不是无条件前置。不能把局部证据当作里程碑一/产品验收完成，设计保持比较中/验证中。

## 7. 第一轮候选实验协议（运行前冻结）

本节及第 8、13–17 节保留当时实验协议与结果，其中普通后代场景的门槛不再直接等于产品门槛；当时的优先级判断由第 18 节取代，不修改脚本、断言或历史结果。

2026-09-20，基于 `a5112fb5` 开始方案验证。只新增独立诊断，不更改 `extensions/`、安装依赖、锁文件或现有测试。比较 node-pty 原 reader 与直接使用同一 native fork 创建全新 PTY、独占 master fd 的异步读取候选。候选用单次 `fs.read` 获取数据，遇 EAGAIN 继续等待，Linux 的 read 0/EIO 才结束；不接管已有会话 fd，也不在原 reader 旁边补读。直接使用 native 内部接口和轮询调度仅用于可行性实验，不是已选定的生产 adapter。

冻结参数：每组 3 轮，单会话串行；每次最多读 64 KiB、至多一个在途 read，连续有数据时让步到下一事件循环，EAGAIN 等待 2 ms；原进程退出后仍无源终止的实验取消上限为 1000 ms，单轮采集上限 30 s。触及上限必须记为中断/采集失败，不记为排空。定时参数只是候选实验条件，不改变产品期限。记录事件循环延迟与耗时，不据此宣称生产公平性预算已完成。

固定案例为：90000 行自然 exit 0、90000 行自然 exit 7、90000 行在第 89800 行附近暂停读取 350 ms、分片 UTF-8/ANSI/OSC 尾部、父进程退出后后代延迟 350 ms 输出、后代保持 slave 1500 ms 触发明确取消、收到 TERM 后输出尾部并退出。每轮保存完整内容/哈希、写入完成凭证、native exit、源终止原因、销毁和资源回收记录。候选的前五项及 TERM 项必须内容精确，保持 slave 项必须显式取消；原 reader 保留全部失败，不能重跑筛选。

本轮版本固定 Linux x64、node-pty `1.2.0-beta.12`，分别运行 Node `25.6.0` / libuv `1.51.0` 与缓存 VS Code `1.117.0` 的 Electron `39.8.7` / Node `22.22.1` / libuv `1.51.0`。两 reader × 7 案例 × 3 轮 × 2 可执行文件，共 84 个样本。Electron-as-Node 不是完整 VS Code UI 验收；macOS/Windows 原生、Remote SSH、真实 Agent、packaged、多会话和消费者完成契约本轮不冒充覆盖，后续仍须按第 5 节验证。

## 8. 第一轮实验结果与限制

独立工具为 `scripts/diagnostics/compare-runtime-exit-readers.mjs`。2026-09-20 完整执行 84 个样本，没有筛选重跑；每个运行时均有原 reader 21 项和候选 21 项。候选每组为 18 次内容完整且 writer receipt 为 `complete:0`、最终真实 read 返回 EIO，以及 3 次明确的 `exit-deadline` 取消。后者虽然符合实验预期，不能计为自然排空。

| 场景 | Node 25 原 reader / 候选 | Electron 39 原 reader / 候选 |
| --- | --- | --- |
| 自然 exit 0 / exit 7，各 90000 行 | 6/6 内容完整 / 6/6 内容完整 | 6/6 内容完整 / 6/6 内容完整 |
| 第 89800 行附近暂停 350 ms | 完整行数 89800、89800、89848 / 三轮均 90000 | 完整行数 89800、89800、89801 / 三轮均 90000 |
| 合法 UTF-8、ANSI、OSC 分片 | 3/3 精确 / 3/3 精确 | 3/3 精确 / 3/3 精确 |
| 父进程已退，后代 350 ms 后写尾部 | 三轮写入失败 `complete:1` / 三轮完整且 `complete:0` | 三轮写入失败 `complete:1` / 三轮完整且 `complete:0` |
| 后代保持 slave 1500 ms | 三轮约 200 ms 后普通 onExit / 三轮约 1000 ms 后明确取消 | 三轮约 200 ms 后普通 onExit / 三轮约 1000 ms 后明确取消 |
| TERM 后输出尾部并 exit 7 | 3/3 精确 / 3/3 精确 | 3/3 精确 / 3/3 精确 |

六个暂停场景的 writer 均成功，其中五个原 reader 的 destroy 栈来自 timer；Node 25 第三轮则先 socket end、后 native exit，没有触发退出 timer。该样本没有 syscall/fd 残留探测，不能仅凭症状追认为已证明的 HUP 同因。自然组本轮均完整，故没有新取得自然 HUP 的“旧失败/候选通过”对照。候选绕开 `tty.ReadStream` 的机制是源码事实，不等于所有 Linux 源问题已收口。

后代延迟输出的六个原 reader 反例是“reader 提前关闭，使后代无法再成功写入”，不同于暂停组“已成功写入后被丢失”，二者分开统计。候选的期限是显式取消策略实验，不能将 1000 ms 直接作为产品正式期限；也不能把期限足够长当作正常退出完整性的证据。

大输出精确比较 5490000 字节解码文本（90000 行，每行经 PTY 转为 CRLF），未启动交互 shell，不含提示符或输入 echo，与旧诊断的总字节数不同。哈希针对解码文本；合法 UTF-8 案例可精确比较，但未记录逐次 native write/read 边界，不承诺任意非法字节流、所有分片组合或实际 xterm 语义已验收。工具为取证保留全量 raw 内容，不是有界生产缓存实现。

资源观测只作候选成本输入：首轮 Node 25 / Electron 39 候选样本的最大事件循环 p99 为 16.712 / 12.607 ms，最大观测延迟为 20.365 / 25.133 ms；自然大输出单轮异步 read 次数分别为 15770–36082 / 7688–20802，轮询与线程池成本仍须验证。没有多会话、输入响应或生产 RSS 预算结论。每个 master 已关闭，另用 84 个样本的实际 PGID 核对，未发现残留进程组成员；不是仅凭发出 SIGKILL 声称后代已回收。

工件位于 `.debug/exit-integrity-reader-v1-node25/`、`.debug/exit-integrity-reader-v1-electron39/`。两组运行时记录的脚本 SHA256 均为 `a6ba8ca0567d28b430c674b51ab47abd8ba2f46dc81d8b63cb89cbf29c2a33b6`；原 Unix JS 为 `c3bb8dfceb9f99a5d7003041c0aff243eaa60f062538c88fc452c59ae516e74c`，native addon 为 `ab01eb7d31a5b6202e2a51339ad2cbe3f2a73e3a679e88195011e28f3160d5a7`。采集后仅补强诊断自身的注入/关闭断言、独立 32 s 清理硬截止、完整 receipt 等待和保存结果复核入口，没有改变 reader 或冻结参数。增强的验证器已重新核对原 84 个样本的内容哈希、完整性和注入条件；未用新一轮成功覆盖首轮证据。

工具加固后另按原参数完整回归 84 个样本，目录为 `.debug/exit-integrity-reader-v2-node25/`、`.debug/exit-integrity-reader-v2-electron39/`，脚本 SHA256 为 `8759c0f0034161b1e951f55c04956d2e0ce46d097b2e3c72b21246acfd9b3301`。追加组仍为候选 36 次完整读取、6 次明确取消，原 reader 六个暂停反例全部来自 timer，行数分别为 89800/89800/89800 与 89801/89800/89800；后代延迟的六次写失败也保留。两轮共 168 个实际样本，其中候选 72 次完整读取、12 次明确取消，没有候选门槛失败；保存结果复核不额外计数。回归的 `cleanup.json` 为空残留列表，最终再次核对全部 168 个 PGID 也无残留成员。所有自然对照仍完整，未由追加组取得自然 HUP 缺失对照。

## 9. 候选比较与当前建议

| 候选 | 能解决什么 | 尚缺什么 / 当前判断 |
| --- | --- | --- |
| 延长 timer 或延后 Host finalize | 改变部分竞态触发窗口 | 不修已合成 EOF，不提供 drain 证明；排除为独立完整性方案。 |
| 仅升级 node-pty npm 包 | 可能带入该包自己的关闭修正 | 不能替换实际宿主 libuv；未证明某个已发布版本解决全部 Unix/Windows 路径，不能单独选定。 |
| 上游 Node/Electron/libuv 修正 | #4997/#5165 对准 Linux HUP 读取 | 不消除 node-pty 的强制关闭；实际宿主和最低支持版本均需验证，作为对照而非完整方案。 |
| 受控 node-pty fork/adapter，独占 reader 并重做完成契约 | 保留现有启动/输入/resize，局部替换源读取与退出归并；Linux 实验支持局部可行性 | 当前优先验证候选。不是给旧 onExit 包一层；Windows native/worker/pipe 也要提供可信结束，不能只改 Unix JS。轮询原型不直接升格生产。 |
| 替换 native provider，例如 portable-pty 加 N-API 或私有 helper | 将读取与 process wait 分离，不继承 Node TTY reader 或 node-pty 的 JS timer | 需要新的原生构建/打包、线程与取消模型、Windows ConPTY 关闭顺序；保留为成本更高的对照，尚未运行。 |

`panel/runtimeHostBackend.ts` 的 `resolveSupervisorExecPath()` 默认使用 `process.execPath`，snapshot-only 也在 Host 内运行；npm lockfile 不能单独决定这些路径的 libuv。扩展仍声明 `engines.vscode: ^1.80.0`，本轮只有 1.117.0 的内置运行时证据。若方案依赖较新宿主修正，必须显式解决最低版本与 capability gate，不能只换 shell Node 或静默提高最低版本。N-API 二进制兼容也不能代替 libuv 行为验证。

Windows `useConptyDll` 只是子候选：它避开默认 native-exit 静默 timer，但 worker dispose 的强制结束路径仍存在。需要实际 OS build、builtin/DLL、native exit、pipe/worker EOF、`ClosePseudoConsole` 与持续读取的顺序证据；不能把这个开关当作全平台修复。

作为接口对照，WezTerm 固定 tag `20240203-110809-5046fc22` 的 portable-pty 0.8.1 在 [lib.rs](https://github.com/wez/wezterm/blob/20240203-110809-5046fc22/pty/src/lib.rs) 分开 `MasterPty::try_clone_reader()` 与 `Child::wait()`；[unix.rs](https://github.com/wez/wezterm/blob/20240203-110809-5046fc22/pty/src/unix.rs) 使用独立 read，Linux/Unix 的 EIO 映射 EOF；[conpty.rs](https://github.com/wez/wezterm/blob/20240203-110809-5046fc22/pty/src/win/conpty.rs) 提供 pipe reader。这支持职责分离，不证明照搬后就满足本项目的取消、尾部或进程回收契约。

## 10. 生命周期契约提案（待实现验证）

建议采用分层组合：provider 分开报告进程结果与源输出结束，共享 adapter 聚合一次最终事件，Supervisor 与 local Host 以最终事件进行收尾。不是让两处各自解释 native 时序，也不是把旧 onExit 重命名为 drained。以下语义用于冻结下一轮契约用例，字段名与 wire API 仍未选定。

三个事实独立存在：进程结果（exit code/signal）、源完整性（可信结束/中断/读取失败/旧实现未知）、每个读者的应用结果（应用到最终位置/取消/失联）。命令 exit 7 可以同时是源完整；stop 意图不直接决定源结果；若操作真的截断 reader，不能声称完整。旧实现未知也不应被误报为已确认丢失。

数据与 decoder 最后尾片必须先于源结束交付。进程结果和源结束允许任意顺序到达，只有两者均已结算后 adapter 才发一次最终事件；缺少进程结果时不能补造 exit 0。早期 process-exit 可用于停止输入或显示收尾状态，但不能封闭输出 admission。发生读取错误/强制取消时，明确记录原因并按所有权结束进程，不无限等待失效回调；终态后再来 data 视为 provider 违约，不能默默追加到已发布的 final revision。

Supervisor/local Host 在 adapter 最终事件后才封闭 admission，先收敛已接受操作及终端解析，再固定 final revision。源终态不必等待每个页面；已有页面分别应用到 final revision 后完成，或以取消/失联释放。临时来源退役等待所有既有读者结算，而不是把一个读者关闭当作全体已应用。

本轮新核实的协议缺口：`common/runtimeSupervisorProtocol.ts` 的 `RuntimeSupervisorCloseTerminalReadParams` 只有身份，`webview/terminalPagedProjection.ts` 的 `stop()` 和 `finishExit()` 都调用同一个 close，`panel/runtimeTerminalReadRelay.ts` 的 `close()` 仅释放 binding。因此当前 close 不能区分“已应用完”与“页面取消”；这不是新证明的一次丢数据，但无法用该消息自证消费者完成。候选需要明确应用凭证包含 final revision 及 session/authority/read 身份，或等价的独立确认；本轮不直接选定扩展 close 还是新增 ACK。旧 close 只表示释放、未证明应用。

协议能力与实际 session/provider 的完整性能力也要分开。新 Host 接旧 Supervisor 保留原绑定并标记证据未知；旧 Host 接新 Supervisor 沿用可理解的旧字段，新结构必须 opt-in 或证明可忽略。最终读者确认要校验身份和最终位置，重复消息幂等，不能接受旧 generation 的迟到确认；无读者时不要求创建新页面来完成验收。

下一轮确定性契约用例固定覆盖：数据→进程退出→数据→源结束，源结束→进程退出，空输出/非零退出，重复退出/重复结束，结束后 data，解码尾片，stop 后正常排空，读取失败/强制取消/旧实现未知；消费者覆盖 final target 先于尾页、应用中退出、一完成一取消的双读者、在途 open 与旧身份迟到消息。这些用例必须在共享 adapter、Supervisor 和 local Host 接入时分别验证；当前仅完成调用路径核查，没有已实现的契约测试通过记录。

## 11. 平台矩阵与尚未收口项

| 执行环境 | 本轮证据 | 后续必须补齐 |
| --- | --- | --- |
| Linux x64，Node 25.6.0 / Electron-as-Node 39.8.7 | 冻结的 84 项裸 PTY 候选对照 | 自然 HUP 旧失败/新通过对照、正式 reader、公平性/并发、实际 Host 两种模式、真实 provider 和 packaged。 |
| Linux Remote SSH | 无本轮候选实测 | 记录实际执行端版本，不用本地 Electron 代替远程 extension host；验证断连与当前读者结算。 |
| macOS 原生 | arm64 / Darwin 25.6.0 / Node 22.23.2：公共接口 15 项基线；新增 42 项 reader 对照，候选 15 项达标、后代两组 6 项未达标 | 补主进程尾部、最终状态、资源释放、实际启动链与宿主验证。leader/write/EOF 后 master 对照保留为诊断，后代失败不独立阻塞产品；也不能将普通场景通过泛化为全平台验收，或把 Linux EIO/取消策略直接推广。 |
| Windows 原生 | Server 2025 x64 / Node 22.23.2：两轮各 63 项；修订 Job 夹具并验证存活/TTY 后候选 18 次完整、3 次明确取消；原 worker 每轮 42 次资源 guard 失败 | 补 native handle 释放/增长、并发输入、真正 stop/强制停止与实际 VS Code。独立 worker 自然退出不等于全部 OS 句柄归零或完整生产候选已选定。 |
| 声明支持的宿主范围 | `^1.80.0` 仍未改变 | 选型时明确最低支持宿主与代表性矩阵；在验证前不能将 1.117.0 的结果泛化到全部支持版本。 |

里程碑一还未结束：生产 reader、会话收尾/取消边界、资源/输入预算和具体 wire API 尚未选定，实际 Agent 启动链仍待验证。原生 Windows/macOS 候选已执行，Windows 修订夹具后达标，macOS 后代场景仍未满足冻结诊断门槛；这项失败不独立阻塞产品选型，不再把“没有平台 runner”作为原因。不能据此直接修改业务、去掉旧兼容、宣布全平台已修复或关闭退出完整性债务。

## 12. 独立 Runner 合入后的证据承接

PR #294 已合入 `main@5965adb8`，运行时分支的 13 个提交 rebase 后为 `28055e13`；备份 `backup/runtime-persistence-before-runner-rebase-7202298c` 保留。业务代码与 rebase 前相同，runner 的 workflow、诊断和证据文档保持已审核版本。

`docs/design-docs/runtime-exit-integrity-native-runners.md` 记录原生 run `35491608835` 的首次失败与 `35492043484` 的修正版结果。后一轮在 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12 下每平台 12 次内容匹配、3 次主动取消，共 45 项。macOS 原失败是 LF 前重复 CR 被误判为多行，非短读证据。Windows 原失败是内容匹配但诊断资源未退出；新版在内容观察结算后显式 public kill 才结束，不能关闭自然退出的资源债务。两个 run 和首次工件均保留。

由此把资源所有权纳入选型：provider 应明确提供幂等的资源释放路径，说明它是否破坏仍在读取的数据以及与主进程退出的顺序。释放 worker/native handle 不应靠复用用户 stop 的进程树信号语义来推断；本轮只确认该证明义务，不新建生产 dispose API，也不把诊断 public kill 当作最终实现。源完成、页面应用完成和资源回收须独立验证。

## 13. 可执行收尾契约模型（隔离候选）

模型位于 `scripts/diagnostics/runtime-exit-contract-model.mjs`，用例入口为 `scripts/diagnostics/diagnose-runtime-exit-contract.mjs`。它们是设计阶段的受控验证，只使用内存状态和既有 `TerminalPagedProjection` 类；不创建原生 PTY、不更改 bridge、Supervisor、Host 或 Webview，也不意味着新 API 已投入生产。

源模型分别接收字符串 data、process result 和 source end。process result 可先于最后 data；source end 可先于 process result；两者都存在时只发布一次 final。source end 状态为 `eof`、`interrupted`、`error` 或 `legacy-unknown`，由测试输入提供，不由模型检测 native EOF。非零 exit 不改变 `eof`；stop 意图不结算源；解码器尾片须先交付再结束。重复相同终态幂等，冲突终态或 source end 后 data 显式报违约，不静默改变已发布的 final。资源释放不为缺少的 process/source 结果补造成功。

消费者模型只固定验证规则，优先比较独立结算消息，不直接扩展现有 close。实验结算为 `applied(finalRevision)` / `cancelled`，断连为服务端 `lost`，旧 close 为 `legacy-released`；后三者释放读者但不证明已应用。应用确认要求连接 owner、sessionId、authorityId、readId 全部匹配，最终 revision 已知且等于确认位置，且该位置已送给该读者。服务器仍需信任有效 Webview 只在 xterm write callback 后发送 applied；仅模型中的数值相等不能证明 UI 实际渲染。

主进程退出不关闭新读者入口；源 final 固定位置后停止接受新的 open，已接收但未返回的 open 仍占用来源。已存在读者各自应用、取消或失联，最后一个结算后才允许来源退役；一个读者取消不得结束另一个。取消后的迟到 open 回复不得复活读者，旧 authority/read/owner 的迟到结算不得释放新读者。同一结算重试幂等，冲突重试拒绝。轻量的去重记录只属于模型；生产记录的数量、期限与清理预算尚待选定。

候选能力分别描述“协议能理解结算”与“该 session 的 provider 能证明源结束”。只有双方 opt-in 才发送新结算，旧 `terminalAppliedRevisionAckV1` 仅证明已有增量能力，不能冒充新的终态能力。新协议连接旧 provider 时源仍为 `legacy-unknown`；不搬迁旧 live session，不更改既有绑定。

运行前冻结的用例覆盖事件排列、重复与违约、解码尾片、stop/强制中断/错误/旧能力，以及消费者最终位置、错误身份、双读者、在途 open、重试和真实投影完成/取消的对照。确定性用例每项一次，并保存全部结果与实际投影源码哈希。模型通过只能支持上述逻辑规则自洽；Supervisor/local Host 接入、原生候选、并发/资源预算和真实 xterm/packaged 仍须独立验证。

## 14. 收尾契约验证结果与剩余边界

在 Linux Node 25.6.0 与 Electron-as-Node 39.8.7 / Node 22.22.1 分别完成同一组 39 个用例，各 39/39 通过；能力用例另遍历 18 个组合，不额外记为 18 次原生验证。工件在 `.debug/exit-contract-v1-node25/`、`.debug/exit-contract-v1-electron39/`，包含固定 schedule、全部 results、summary 和源码哈希。模型哈希为 `e23befc9272d10354501d62bb09ac9ee46eb6b48b9756c1a5518d56a94afba70`；验证入口哈希为 `2eaf510bf0dc9fa3b9875abc3068759e4d4b6fc2b83c84a26d92b94802e57d1f`。

实际 `TerminalPagedProjection` 的对照分别让最后一页 write callback 完成、或在 callback 前 stop：前者显示退出，后者不显示自然完成，两者旧 close 载荷却完全相同。这实证了完成凭证缺失，未证明当前页面有新的丢字节 bug。候选模型把 applied/cancelled/lost/legacy-released 分开，并拒绝提前确认、错误身份和错误 final revision；现有生产 wire 尚未改变。

`scripts/diagnostics/diagnose-runtime-exit-admission.mjs` 在同两种运行时各执行 17 项：原有 11 项公共 Supervisor 特征断言保持不变，另加 6 项把源模型的 final 转接给实际 Supervisor 的 onExit。Agent/Terminal 各覆盖进程先退后有异步尾部、源先结束和 stop 后排空；6 项均完整保留 `BEFORE\r\nTAIL\r\n`、final revision 2、exit 7 和唯一终态。工件为 `.debug/exit-admission-contract-v1-node25.json` 与 `.debug/exit-admission-contract-v1-electron39.json`。这些 source EOF 是注入的，不是 PTY 读取证明；此适配也没有把源状态传入生产 wire，不能视为 Supervisor 完整集成已交付。local Host 两路径、provider 原生实现和完整消费者确认链路仍未接通。

rebase 回归通过 `typecheck`、`build`、`test:execution-session-bridge`、`test:terminal-session-journal` 和 `test:runtime-supervisor-protocol`（含 checkpoint refresh、paged projection、completed-history、paged completion）。相对 rebase 前业务及原有测试无差异，本轮增量限诊断和文档；没有执行完整 VS Code UI、真实 Agent、packaged 或新的 macOS/Windows 候选测试。固定等待、旧 onExit 或事后 public kill 均未升格为生产完整性方案。

## 15. 原生候选阶段（运行前边界）

下一轮诊断在 `origin/main@5965adb8` 的独立分支 `runtime-exit-integrity-native-candidates` 开展，避免把未完成的运行时分支推到 runner。沿用已合并公共接口基线，不改变它的门槛。新增候选 workflow 和独立设计/计划；运行前固定完整 schedule、重复次数及预算，保存首次失败和修订原因，不触碰业务代码。

新核查的 Windows 源码事实：固定 node-pty `1.2.0-beta.12` 的 `src/win/conpty.cc::SetupExitCallback()` 在 native 退出回调到 JS 前关闭 shell handle 并移除 baton，而 `PtyKill()` 按该 baton 查找 HPCON；builtin 自然退出后再 kill 不能据此证明执行了 `ClosePseudoConsole`。DLL connect 则调用 `ConptyReleasePseudoConsole`。此处为源码顺序证据，尚不等于原生泄漏计数或完整生命周期证明。需要实际观测 DLL 源 EOF 与 worker 结束，不能只把 `useConptyDll` 置为 true 宣称完成。

## 16. 三平台原生候选首轮结果

独立诊断输入为 `runtime-exit-integrity-native-candidates@afb2497440d22ee088d8bd3a65766dcec008e322`，不含当前分支的未完成运行时历史。[run 35498026812](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35498026812) attempt 1 完整执行 147 个样本：Linux 42、macOS 42、Windows 63。Ubuntu job 成功，另两个失败；所有首次结果保留，没有扩大等待或调低内容门槛取得绿色。独立分支的设计和 ExecPlan 记录运行前冻结参数，工具位于该分支 `scripts/diagnostics/compare-runtime-exit-readers.mjs`、`compare-windows-exit-readers.mjs` 和 `runtime-exit-conout-worker.mjs`，没有修改业务或 node_modules。

Linux 候选 18 次精确 read EIO、3 次后代保持时明确取消；stock 暂停三轮均在 89800 行结束且 writer 成功，后代尾部三轮写失败。macOS 候选自然 exit 0/7、暂停、分片、TERM 共 15 次完整 read 0，stock 这些场景也完整；本轮未复现 macOS 暂停丢尾。macOS 后代尾部三个候选只收到 `PARENT`，receipt 为 `CHILD_TAIL\ncomplete:1`，不是成功写入凭证；保持组三次约 10 ms 即 read 0，没有进入预期的 1000 ms 取消。不能将这 6 个失败称为已证明的 HUP 同因或已写成功后丢失。session leader 退出导致 terminal 撤销是待验证假设，还需要真实 write errno、保持 master 打开及 leader 存活的控制组。

公开 [XNU kern_exit.c@f6217f891ac0bb64f3d375211650a4c1ff8ca1ea](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exit.c) 的 leader 退出分支有 SIGHUP、ttywait、`VNOP_REVOKE(REVOKEALL)`，提供源码旁证；没有对应 runner 精确构建的 syscall 轨迹，不代替控制组。

Windows 原 builtin 暂停三轮的 90000 行文字哈希都匹配，但末尾 `cursorLine=89999` 而非预期 `90000`，writer 均成功；是末尾换行/光标状态不完整，不是丢了编号文字。原 DLL 暂停完整，但两条原路径各 21 个样本都未在 2 s 资源 guard 内自然退出。候选直接读取 DLL conout pipe，取消原转发 server/timer，普通五类共 15 次完整内容/光标、pipe EOF、worker 与诊断进程自然退出；后代尾部三次不匹配、保持组三次收到 EOF 而非预期取消，均保留失败。内容完成和自然 Node 退出不证明 HPCON/系统句柄长期无增长。

Windows 后代工件复核：tail 九次均无 writer receipt，PID 已消失。固定 [libuv v1.51.0 win/process.c](https://github.com/libuv/libuv/blob/v1.51.0/src/win/process.c) 将普通 Node spawn 的子进程放入父进程私有 kill-on-close Job，父退出会杀掉夹具后代。因此这六个候选门槛失败不证明 reader 丢弃存活后代；不能只凭 spawn/ready 文件认定输出所有权。第二轮冻结为由 `cmd start /b` 中间进程创建真实后代，额外断言主进程回调时仍存活且 stdout 为 TTY，不改 reader、重复次数、90000 行或等待预算，也不修改 macOS 的失败判断。

三平台为 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12，Linux x64 与 macOS arm64 分别为 kernel 6.17.0-1022-azure、Darwin 25.6.0；Windows 为 Server 2025 x64。不是实际 VS Code UI、最低宿主、Remote SSH、真实 Agent 或 packaged 验收。下一轮优先验证后代的真实输出所有权与写入/EOF 边界，同时评估长驻资源；当前没有选定统一 reader，更没有把新路径接入 Host/Supervisor。

## 17. Windows 夹具修订后的完整对照

第二轮 [run 35498732353](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35498732353) 输入 `4ac3ad156ae7cec3bf649a656b2eb437149040e4`、attempt 1，完整再执行 147 项，不改 reader、轮次、内容或等待预算。Windows 与 Ubuntu job 成功，macOS job 失败；总 run 保持失败，不修改 macOS 门槛来获得全绿。

Windows 候选 21/21 达标：自然零/非零、暂停、分片、后代尾部和合作退出共 18 次内容/光标匹配、pipe EOF、worker 和诊断进程自然退出；后代保持三次在固定 2500 ms 后明确取消并清理。六个后代样本同时满足父 native 退出回调时真实后代仍存活、stdout 为 TTY，因此这次才有效验证存活后代。原 builtin 的后代尾部三次仍缺失；原 DLL 内容完整，但两条 stock 仍共 42 次资源 guard 失败。两轮 stock 资源失败共 84 次，未用事后 public kill 掩盖。

完整工件确认 builtin 后代尾部三轮在 onExit 观察时 receipt 为 null，但随后保存的 writer receipt 都为 `written: true, code: 0`，呈现仍只有 `PARENT`；候选完整呈现 `CHILD_TAIL`。这是原生 Windows 提前关闭后漏掉成功写入的后代输出证据，与首轮夹具被 Node Job 杀掉及 Unix 后代写失败分开统计。两轮全部工件已下载到独立工作树 `.debug/github-candidates-{run}-{platform}/`，核对完整 schedule/raw 哈希、Windows 内容/光标和实际输入 commit（Windows CRLF 差异已验证）。每轮 Unix 进程组和 Windows fixture PID 清理均无残留，不代表 OS 句柄长期零增长。

第二轮 Linux 与 macOS 结果类型不变：前者候选 18 次完整、3 次明确取消；后者普通 15 项完整、后代两组 6 项仍未达标。当时提出下一增量先补 macOS 原始 write 返回值、leader 存活/退出及首次 EOF 后保持 master 的控制实验；该优先级现由第 18 节取代，失败结果不变。Windows 独立 worker 已有原生可行性依据，仍需 native 句柄长期增长、并发输入、真正 stop/强制停止、实际宿主与共享契约集成验证；不能因这 21 项通过就定为生产默认路径。运行时业务、旧 live 绑定和 root 归属均未修改。

## 18. 职责澄清与交付阻塞重评

2026-09-20，用户确认画板不负责把会话内部每个后代作为独立对象托管、追踪或恢复，也不默认承诺实际主进程退出后等待普通后代的未来输出。这同时适用于 Terminal 和 Agent；不意味着过滤运行中的后代输出，不意味着立即清理自身已接收/排队/消费的数据，也不改变会话主进程自身尾部、最终状态和资源释放的要求。具体收尾边界、取消条件与时间预算尚未确认。

| 既有证据或待验证项 | 当前分类与交付判断 | 理由与后续 |
| --- | --- | --- |
| Linux 主进程成功写入后缺尾、原始 HUP/partial read 与受控暂停反例 | 产品正确性问题，仍须收口 | 改变后代职责不能补回主进程输出；仍须逐层对账和旧/新 reader 对照。 |
| Windows builtin 暂停后 90000 行文字完整但最终光标少一行 | 产品终端最终状态问题，仍须收口 | 不是编号文字缺失，也不是普通后代续跑要求；按终端语义验收。 |
| Windows 原 worker 的自然退出资源 guard 失败 | 产品资源生命周期问题，仍须收口 | 读取内容完成不代表资源释放；候选自然退出不证明 native 句柄长期无增长。 |
| macOS 后代尾部写失败、held 提前 read 0 | 底层诊断失败保留，不单独阻塞产品交付/选型 | 未证明主进程尾部丢失，当前产品不承诺退出后继续支持普通后代。leader/write/EOF 后 master 控制组可继续研究，不再要求先将其修成绿色。macOS 其余产品矩阵仍待完成。 |
| Linux 后代写失败、Windows 第二轮 builtin 漏掉退出后后代成功写入 | PTY 生命周期与关闭行为诊断，不自动判定产品违规 | 写入证据和失败保留；不能直接作为真实 Agent 已有相同缺陷的证据。若涉及已接收内容或实际执行主体，则另按相应产品契约验证。 |
| `Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` | 产品启动链验收项，仍开放 | 实际 CLI 是会话执行主体，不是无需托管的工具后代；不能仅据包装程序退出发布 Agent 终态。需核对真实支持路径的身份、退出时序和终端资源。 |
| 已接收队列、消费者最终应用、取消与 EOF 区分 | 产品收尾契约，仍开放 | 不能用取消/超时冒充完整 EOF，也不能用 reader close 证明页面已应用；模型自洽不等于生产接通。 |

下一增量先按第 5 节分别冻结产品验证与诊断对照，明确主进程尾部和已有数据的处理边界、真实源结束/主动取消的区分、消费者结算及资源释放条件；对实际 Agent 启动链单独留证。若后续选择取消策略，必须说明触发条件与时间预算及其如何保留上述义务，不能直接沿用实验中的 1000/2500 ms。本次不选定 reader/API，不修改业务。

两轮原生 run `35498026812`、`35498732353` 的冻结案例、断言、原始工件、失败与总 run 状态原样保留。新的产品验收应使用单独命名、运行前冻结的矩阵，关联旧诊断证据并写清门槛为何不同，不修改旧测试求绿或把历史失败追认成通过。仅职责调整不产生任何新的平台通过证据；设计仍为 `比较中 / 验证中`，计划 active，退出完整性债务未关闭。

## 19. 收尾屏障与启动链验证（本阶段运行前冻结）

本阶段基于 `92ddb48f`，只新增隔离诊断与文档，不改生产代码、旧诊断、原断言或历史工件。两项工作并行：将取消时的在途读取与已有数据收尾分开建模；核查并验证实际 bridge 启动路径中的主体生命周期。它们不选定生产 reader、wire API 或时间预算。

收尾候选将取消请求与生效分开：请求后不发起新 read，但已在途 read 返回的成功字节仍须进入 decoder 和既有输出队列；之后才封闭源接收。decoder 结束产生的尾片和已经接受的异步操作必须完成或明确失败，不能用取消请求清空它们。取消生效先于真实 EOF 时，不因迟到的 read 0 把主动取消追认为完整 EOF；只有请求而未生效时，仍允许先取得可信 EOF。原生 reader 资源释放、会话输出队列收敛及每个页面应用完成分别记录，彼此不代证；具体错误合并与 API 保持候选。PTY 是混合字节流，不能依靠识别每个 chunk 的写入进程来实现这条边界。

新增屏障模型与验证入口独立于原 `runtime-exit-contract-model.mjs`，保留旧 39 项用例不变。运行前固定以下确定性排列：process exit 后在途 read 成功；取消后成功 read/EOF/error；decoder 跨 read 尾片及取消时不完整尾片；下游慢应用/拒绝；取消重复/原因冲突；迟到 read/新 read 拒绝；资源提前释放/释放失败/成功；源 final 与页面 applied/cancelled 分离。每项一次，不随机筛选；分别在 Node 25 与 Electron-as-Node 39 执行，保存完整 schedule、trace、源码哈希和失败。没有原生 PTY 与真实 xterm 的模型成功，只证明候选屏障逻辑，不是生产集成或跨平台验收。

另用 `SerializedTerminalStateTracker` 的真实隔离构建和 headless xterm 验证应用屏障，入口为新增 `scripts/diagnostics/diagnose-terminal-final-apply.mjs`。固定四项、每项一次：延迟 write callback 的最终 CRLF、跨 write 的 CSI 光标定位、跨 write 的 OSC title 与末尾正文，以及在 flush 前 dispose 的负对照。前三项只在实际 parser callback 放行后取得最终 outputSequence、正文/光标/title，再 dispose；负对照只说明主动提前 dispose 不能当作已应用证明，不据此声称业务自然退出存在新缺陷。用可控 callback 而非延长时间等待，每项另设 10 s 诊断硬截止保存未完成证据，不是生产期限；同样在两种运行时分别留证，不替代 Webview UI 或原生 PTY。

上述屏障保护已经归 reader/decoder/队列所有的数据，仍不能证明取消前留在 OS/ConPTY 内、尚未被读取的主进程成功写入尾部已收齐。不能把“已明确记录 interrupted”当作自然退出完整性交付；生产取消触发条件、源结束证明和数值预算仍需原生候选阶段决定。

启动链诊断使用真实 `executionSessionBridge.ts` 的隔离构建，但只创建受控 CLI fixture，不启动真实 Agent 或访问其凭据。本地 POSIX 固定四类：直接主体、shell exec 替换、Node 等待型启动器、故意不等待主体的启动器负对照，每类 3 次；Node 25 与 Electron-as-Node 39 各 12 项。主体先写 READY 并保存 PID/TTY/就绪凭证，在测试端放行前保持运行；正对照等待至少 100 ms 确认主体仍存活且 bridge 未退出，随后放行并验证尾部及 exit 7。负对照的启动器在主体就绪后先退出，主体不再向终端写未来输出，只验证 bridge 退出时主体是否仍活着；它说明启动器可不代表主体，不证明真实 Agent 存在同样问题。

每个启动样本采集上限 8 s、清理上限 2 s、独立硬截止 12 s，全部只是诊断防挂起预算。工件保存在新的输出目录，记录 launch spec、PID、桥接退出事件、主体凭证、完整回调内容/哈希、fixture 清理与 Node/libuv/node-pty 版本；保存全量计划与首次失败，不按成功重跑。清理仅针对本次 fixture，不接管用户进程。Windows `.cmd/.bat` 的 `cmd /d /s /c` 原生等待/退出语义及真实 provider 仍需独立 runner/实际入口证据，不能由 POSIX 或命令字符串断言代替。

## 20. 启动路径与屏障核查

当前仓库的真实 Agent 链路是 `CanvasPanelManager.resolveAgentCli()` → `buildAgentLaunchSpec()` → 直接 Host 或 Supervisor → `createExecutionSessionProcess()`；没有 `resolveAgentCliLaunchInvocation` 或独立 `agentRuntime` 实现。`CanvasPanelManager.ts:14255` 为 Supervisor 构造与 local 路径 `:14765` 相同的 launch spec，`:15802` 直接使用解析后的 `file: spec.command`；`runtimeSupervisorMain.ts:439` 反序列化并于 `:459` 调用共享 bridge，不增加 CLI 包装层。

| 实际入口 | 已核实行为 | 尚未证明 |
| --- | --- | --- |
| Linux/macOS 原生程序或 shebang wrapper | `executionSessionBridge.ts:139` 保持 file/argv，实际启动无扩展附加 shell；`agentCliResolver.ts:367` 的 login shell 只是查找命令 | shebang/wrapper 自身是否 exec 或等待主体，需要入口证据；POSIX 相同代码不代替 macOS 原生验证。 |
| Windows `.exe` | bridge 直接 spawn 并启用 ConPTY | 原生资源与退出顺序仍须按目标 OS/宿主验证。 |
| Windows `.cmd/.bat` | `executionSessionBridge.ts:181`、`:200` 选择 ComSpec 并构造 `/d /s /c` 转义串，没有添加 `start` 或后台选项 | 不能仅据构造字符串证明 cmd/shim/实际 CLI 的等待与退出传递。其他扩展名也没有自动转换为 `node script.js`。 |
| 现有 fake-provider | `tests/vscode-smoke/fixtures/fake-codex-provider`、`fake-claude-provider` 均用 exec 替换壳 | 不覆盖 Node wrapper spawn CLI 并等待的额外一层。 |

本机只读安装证据：`@openai/codex` 0.155.1 的 `bin/codex.js` SHA256 为 `61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70`；第 241 行 spawn 原生 CLI 且 `stdio: inherit`，第 270 行注册 SIGINT/SIGTERM/SIGHUP 转发，第 279 行等待 child exit，第 294 行按结果处理退出。正常等待路径不是“包装程序先退”的证据；信号路径、强杀和其他安装版本仍未运行验证。Claude 本机入口指向版本目录 `2.1.209` 的 ELF x86-64 文件，版本来自路径而非执行 `--version`。本阶段不调用真实 Agent，不访问其凭据；这些本机源码/文件证据不能升级为跨平台真实 provider 验收。

已有 `scripts/test/test-execution-session-bridge.mjs` 的 Windows 分支用 `spawnSync` 和普通 pipes 验证转义，不是 ConPTY 生命周期证明。Supervisor 在 `runtimeSupervisorMain.ts:1149` 只监听一个 PTY 对象的 onExit，没有 wrapper/实际 CLI 的额外身份协议；架构因此依赖启动入口正确代表主体，具体如何约束自定义 wrapper 仍待方案明确，不能将它们统一称为普通工具后代。

收尾核查也发现候选证明边界：原 `SourceCompletionModel` 只有字符串 data、process result、source result，资源释放仅是布尔值。旧 Linux 隔离 `compare-runtime-exit-readers.mjs:185` 在已设置 source 后直接结束在途回调，`:168` 附近仅在 EOF/EIO 时执行 decoder.end；这说明原实验不能直接升格为生产取消实现，但不是本轮复现的业务丢失，也不改其原断言或历史结果。新屏障诊断专门验证这些尚未建模的排列。

本阶段诊断自身的首次记录同样保留：启动链 Node 25 的 v1 预检错误要求 Linux prebuild 必有 macOS 使用的 spawn-helper，在任何 PTY 创建前失败；修正平台条件与失败落盘后，Node 改用 v2 新目录，不计原 v1 为通过。终端应用 v1 在两运行时各 4/4 通过后，只读审查指出 flush 提前拒绝可能形成未处理 Promise rejection；新入口以 race 立即捕获提前失败/完成，另加三个纯 Promise 自校验，原四项内容和门槛不变。加固回归使用新的 v2 目录，不覆盖首次工件。

## 21. 本阶段结果与生产选型限制

运行时均为当前 Linux x64：Node 25.6.0 / libuv 1.51.0，及 VS Code 1.117.0 的 Electron-as-Node 39.8.7 / Node 22.22.1 / libuv 1.51.0。没有启动真实 VS Code UI、真实 Agent 或其他 OS。本阶段未修改生产 bridge、Host/Supervisor、Webview、依赖、旧诊断和旧断言，也未推送或触发远端 runner。

| 验证 | 结果与证据范围 |
| --- | --- |
| 新收尾屏障模型 | Node/Electron 首轮各 25/25，增加独立 consumer 调用/完成/拒绝对账后各 25/25；固定 25 项场景不变，全部是注入 read、取消生效、队列与资源回执。覆盖在途正字节、decoder 尾片、慢消费、拒绝、资源失败与两读者结算；不能据此证明原生源 EOF 或尚留 OS 缓冲的尾部。 |
| 实际 tracker/headless xterm | Node/Electron 首轮各 4/4，加固后各 4/4；前三项最终 CRLF、CSI 光标和 OSC title/正文匹配，缓存序号在 parser 完成通知放行前仍为 1，之后为 2。第四项主动提前 dispose 未应用排队正文，是负对照而非业务缺陷复现。 |
| 实际 bridge 的 POSIX 启动链 | Node/Electron 各 12/12：总共 18 个正例精确 READY/TAIL、native/public exit 7；6 个不等待负对照在两个退出观察点主体仍活着，只输出 READY，未要求任何退出后未来输出。每组及最终清理 live=0、zombie=0。 |
| 既有回归 | `test:execution-session-bridge`、`test:serialized-terminal-state-tracker` 通过；原契约诊断在两运行时各 39/39，旧入口/模型未变，均为新目录回归，不覆盖原证据。 |

工件目录为 `.debug/exit-barriers-v{1,2}-{node25,electron39}/`、`.debug/terminal-final-apply-v{1,2}-{node25,electron39}/`、`.debug/agent-launch-v2-node25/`、`.debug/agent-launch-v1-electron39/` 和 `.debug/exit-contract-scope-regression-{node25,electron39}/`。启动链 `.debug/agent-launch-v1-node25/` 保留预检失败，原始脚本哈希当时未落盘；补录错误明确标为事后记录，不补造原生样本。终端应用四组精确源码 snapshot 后补并核对原哈希，v1 是从加固差异重建且哈希一致，来源说明一并留存；屏障 v1 和启动链采样版也在加固前保存了对应精确源码。

模型 SHA256 为 `e3d6d393d89c29ec9766c20418b63691bb7a409e07899155c64953397a034cc4`；屏障入口首次/加固版为 `d2b3938f23affa541d5df3a9e9ea779672bf4d4816a2dfbc91d52e2b7364b5e1` / `be93f8b26159dc9c2c91267540d4988d209466315f83bbb967a4cc6617537416`。终端应用入口首次/加固版为 `32cc42db69958db8f72a069b701cb7c33aa6e07b660acfbff720a6ee9be65d00` / `53b667689c6b4b70f27759252e0688764e96f745ad22a24f8fc011fc08e3b17b`。实际原生启动链采样版为 `00b0b50b92d9c82a714bdbf12b535e28c7b0e9100aae66658306240ded60326a`，执行的 bridge 为 `455105120d7cea571c795bbb6b6923a94e365ab341b963ea696f53f13171c635`。

启动链验证器加固后，两个真实目录各 12 项复算通过；派生 `.debug/agent-launch-verifier-offline-zqUzsp/` 的正对照 exit 0，assessment 失败、总 cleanup 仍有活进程、scope 错误、cleanup 缺失均 exit 1，没有新增原生样本。增加的 fatal handler 尝试保存当前失败并仅清理自有 fixture，尚未故障注入验证。第 19 节原拟的 12 s 硬截止当前实际是进程内定时器，不能克服 bridge 的同步 compatibility probe 阻塞，不能宣称有独立进程硬上界；外部 watchdog 仍是诊断加固缺口，不以成功采样消除这一限制。

候选逻辑现在可具体表述为：停止发起未来读取不等于丢弃已拥有的数据；read 回调、decoder、会话队列、页面应用与 provider 释放各自有屏障。`ExitBarrierModel` 只是隔离模型，其 finalRevision 是操作计数，不是生产 journal revision；`canRetire()` 仅组合模型 final、注入释放成功和可选读者结算，不包含轻量终态持久化、journal 删除及旧 generation RPC，不能直接成为生产整体退役判断。模型仅用整数 exitCode，signal-only/native wait 错误尚未建模；启动链本轮也没有验证 stop/信号透传。headless 对照延迟的是 parser 已执行后的完成通知，不是模拟原生写入或真实页面渲染。

下一阶段需要在独立原生诊断分支冻结产品矩阵，验证受控 Unix reader 和 Windows DLL reader 在取消发生时如何结算在途 read、保留 OS/ConPTY 中的主进程尾部并释放资源；对 macOS 复核主进程产品场景，对 Windows 使用实际 bridge 的 `.cmd/.bat → Node 启动器 → 主体` 链路，不能只跑 argv/pipes 测试。启动包装链还需零退出、信号/停止及真实 provider 证据。禁止用固定静默、一次 EAGAIN 或“标记 interrupted”代替自然收尾证明；本轮不选定取消触发条件、数值预算或生产接口，里程碑一继续开放。

## 22. 新原生收尾阶段（运行前冻结）

独立分支 `runtime-exit-integrity-native-candidates` 已 fetch/rebase，仍基于 `origin/main@5965adb8`。该分支的候选设计第 10 节与 active ExecPlan 在运行前冻结新矩阵，新增 `diagnose-unix-exit-tail.mjs`、`diagnose-windows-launch-tail.mjs` 与独立 `runtime-exit-tail-products.yml`，不修改原三平台实验、失败或业务，也不推送当前运行时历史。

Linux/macOS 各固定 7 类、3 次共 21 项：90000 行自然零/非零退出、89800 附近暂停 350 ms、Unicode/CSI/OSC 分片、实际 headless 完成通知延迟 100 ms，以及两种真实在途 read 的取消对照。两个取消案例先成功写 2048 ASCII bytes，候选仅拥有 64-byte read；取消后在途成功数据仍交付，原 reader 停止新 read 后独立 audit reader 才接管其余系统字节。audit 数据不能计入候选已交付量，更不能将 interrupted 升格 completed。这是主动截断负对照，不是推荐的自然退出策略。每项采集/资源/父独立 watchdog 为 10/1/15 s。

Windows 固定 7 类、3 次、两条路径共 42 项：直接主体 exit 0/7、90000 行暂停 1500 ms、cmd 等待启动器 exit 0/7、bat 等待启动器 exit 7、不等待负对照。实际 bridge 保持默认 builtin；owned-DLL 候选使用实际 spawn spec 解析加独占 worker，不代表业务已接通。正例主体 READY 后至少持有 100 ms 再放 gate、写 Unicode 尾部与最终 CRLF，验证真实主体和包装程序退出时序/退出码。public onExit 不当作源 EOF；负对照不要求主体退出后未来输出，随后明确取消。每项采集/退出观察/资源/父硬截止为 30/2.5/2/35 s。

上述都是诊断参数，不是生产预算。每个平台全量运行，新目录保存原始 bytes、writer receipt、源码快照/哈希、真实事件和资源结果。Linux 本地与 GitHub 三平台结果分开统计，初次失败保留。Windows worker 在途取消、长驻 native 句柄增长、信号/强停、真实 provider/宿主/packaged 尚未由这 84 项覆盖，不能由 Unix 对照外推；独立 watchdog 也需要自校验。当前先冻结并实施诊断，尚无本阶段原生通过结论。

## 23. 原生收尾的新证据

独立分支以 `41779127` 先提交冻结协议，以 `f46008442a1c2637c0a0306501f53dde4f49b293` 提交新诊断/workflow 并触发 [run 35506150727](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35506150727)。attempt 1 完整执行 84 项，Ubuntu / Windows job 成功、macOS job 失败，总 run 失败，未重试筛选。运行时历史未推送，生产/旧实验/依赖未变。新工具、取证加固及首轮失败分类见独立分支候选设计第 10–12 节。

本地 Linux Node 25.6.0 的三版各完整 21 项均通过：每版 15 次自然 read EIO，6 次取消保留在途 64 bytes、audit 另取 1984 bytes。audit 不进入候选消费者、不补算完整输出；这实证取消所有在途操作结算后仍可能留下主进程成功写入的数据，不能只依靠前一阶段屏障模型选定生产自然收尾策略。最终 v3 脚本 SHA256 `23e87e52e3bd51ef860e245a24404442296a3ba6e00ad3c9d1bd4c40a810d585`，目录 `.debug/unix-exit-tail-v{1,2,3}-local/` 位于独立工作树，快照按版保留。v2 加强真实暂停后仍有尾部/消费者等待断言、watchdog exit 后有界日志排空及缺 owner 不误判清理；v3 改原子 JSON 回执发布以消除未触发的夹具竞态，所有内容及等待门槛不变。

Windows 初次原生前增加 nonwait 的 driver 已收到 READY 握手，明确是同形受控启动链，不是真实 provider。候选保存原始 native Buffer，实际 bridge 只有 onData 文本，分别标记。三个新文件语法、自校验、现有 bridge 单测和独立审查通过；watchdog 故障注入仅普通子进程，不扩称 native fork 孤儿清理证明。

新的源码资源风险：`node-pty@1.2.0-beta.12/src/unix/pty.cc::SetupExitCallback()` 的 Apple 分支创建 `kqueue()` 后，该函数未见对应 `close(kq)`。当前未做长驻计数及二进制溯源对照，不宣称原生 macOS 泄漏已经实测；单次 master fd close/EBADF 和 driver 退出不能覆盖此类退出监听资源。生产选型前必须补同进程资源增长证据，Windows 在途取消、输入预算、信号/强停、真实 provider/宿主/packaged 继续开放。

| 新原生矩阵 | 首轮结果与证据边界 |
| --- | --- |
| Ubuntu，21 项 | 15 次自然 EIO、6 次明确取消，全部达到冻结断言；在途 64 bytes 与 audit 1984 bytes 分开，内容/最终状态及单次 master fd/consumer/driver 释放有证据，不代表长驻资源无增长。 |
| macOS，21 项 | 12 项自然零/非零、分片、延迟消费者通过；3 个暂停探针误提交零容量 read 后误认 EOF；6 个取消未建立写入成功前提。完整保留 9 失败，不计为产品 reader 缺陷或全平台通过。 |
| Windows，42 项 | actual-bridge 21 项生命周期通过，含 cmd/bat 等待主体及非等待负控；owned-DLL 18 次完整 pipe EOF + 3 次明确取消，内容/消费者/worker/driver 均达标。基线三个暂停尾部/最终状态失败、21 次自然资源 guard 失败，仍未修复。 |

macOS 暂停失败根因由原始事件确定：额外 CR 使 `89800 × 27` 原始字节预算先于逻辑标记耗尽，三例均 `capacity=0 → count=0 → fd close → native signal=1`，没有 reader-pause。实际只有 89793 完整行及下一行残片；这种零长度 read 的 0 返回不是可信 PTY EOF，诊断不能转为生产 adapter。取消六例有有效 PID/TTY，却没有 receipt、read 提交、取消或 native-exit 事件；10 s 前提建立失败、随后资源 guard 退出 3。尚缺 write-enter/return/errno 与受控读取放行，不能认定同步写背压为已证实原因，不能直接缩小 2048 或扩大期限。下一增量修诊断正容量不变量并单独冻结这个最小控制组，保留首轮脚本快照和失败。

三平台工件下载至独立工作树 `.debug/github-exit-tail-35506150727-{ubuntu,macos,windows}/`。Ubuntu 原验证器完整复算通过；macOS 原验证器遇缺失 writer receipt 提前 ENOENT，不冒称成功，另用只读补充审计完整互核 21 项，保留 12/9 分类。补充脚本/结果位于 `.debug/mac-exit-tail-35506150727-supplemental-audit/`，脚本 SHA256 `839982b46ac47593d7f60b670bd458b545b39ca084b245fff25d0dfde4e2232e`，不新增原生样本。三平台 Node 22.23.2 / libuv 1.51.0；Linux x64 kernel 6.17.0-1022-azure、macOS arm64 Darwin 25.6.0、Windows x64 Server 2025 build 26100。Windows 完整 42 项下载后复算通过，源码快照与输入 commit 仅有已核实的 CRLF checkout 差异；仍非真实 provider/VS Code 或完整产品验收。

Windows 本轮三个基线暂停样本的编号 1–90000 均逐项完整，但 raw callback 文本精确结束于 `DSC_MAIN_LINE_90000\r`；该行 LF、主进程额外写入的带 Unicode/ANSI 的整段 TAIL 及最终 CRLF 缺失，不是 VT 覆盖。writer receipt 的 token/PID/成功写入与 exit 0 已互核；实际 cursorLine 90000，预期 90002。候选三次全文与最终光标精确匹配。baseline native 退出后约 1002–1004 ms public 退出，再约 489 ms 才恢复读取。这是实际 bridge 的受控主进程尾部反例，与旧矩阵“仅末尾光标少一行”和后代诊断分开记录。

Windows 36 个正例 READY hold 为 100–116 ms，gate 前主体存活且 native/public 未退出，cmd/bat 的 main → wrapper → subject PID 链和 0/7 传播成立。6 个负控在 native 退出时主体仍活着，3 个 actual-bridge 在 public 退出时也仍活；owned 的三个负控为 cancel-applied → pipe-close(ended=false,cancelled=true) → worker exit 0，没有 pipe EOF。21 个基线资源 guard 都留下 PipeWrap/MessagePort 并 driver exit 3；候选21个driver自然exit0。所有样本无硬超时、日志截断或cleanup异常，但负控在cleanup时已无存活PID，不宣称由父清理主动杀死，也不由这些短命进程证明native长期无增长。设计仍比较中/验证中，生产选型未完成。

## 24. Unix 写入前提控制阶段

独立分支先以 `9cacfc49` 冻结候选设计第13节，再以 `7d832d3e84f09d50ea1934db17d88962eb0d09fb` 提交新 `diagnose-unix-exit-tail-v2.mjs` 和 `runtime-unix-write-control.yml`，触发 [run 35508235734](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35508235734)。旧入口、断言、三平台首次失败和业务均不改；Windows矩阵不重跑、不重新解释。

修订版保留原七类各三次共21项，暂停预算改按ASCII夹具非CR逻辑字节计数，每次read要求正容量，保留90000行/89800标记/350ms及完整内容/状态门槛。原取消2048-byte预置、64-byte在途read、100ms延迟和10/1/15s采集/资源/独立watchdog预算不变。新增无读和受控放行两类各三次，共27项/平台，Linux/macOS共54项；它们是写入前提控制，不替代原取消验收。

新写入进度只走独立文件，记录同步fs.writeSync的enter、returned及实际count，或error/code/errno。控制组观察enter后至少100ms不读，再记录进度/receipt/存活状态；无读组明确中断并关闭master，从不宣称EOF；放行组此时才读，完整收齐2048bytes且取得成功receipt后让fixture退出，再等真实源结束及消费者/资源结算。不预设所有平台都应阻塞，也不把100ms当生产期限。原六个取消案例若前提仍不成立，继续失败，不降低负载或增加等待。

本地Linux Node25.6.0完整27项及离线复算通过，证据在独立工作树 `.debug/unix-write-control-v1-local/`，脚本SHA256 `d82ba9d05d0575a887933a4598dade38910ce711861b739aeb2e62fe9c6d4c3d`。新验证器逐项继续：派生缺receipt对照完整核对27项、保留1失败且exit1；篡改raw对照尝试27项、26份有效/1份损坏且exit1，目录 `.debug/unix-write-verifier-check-481Y8t/`，不修改原工件、不新增原生样本。确定性重复CR/零长read、自校验watchdog、既有bridge测试和workflow检查通过；远端结果仍待复核，不由Linux外推macOS。

### 原生结果与前提根因

run `35508235734` attempt 1 已完整执行并下载两平台 54 项，Ubuntu 27/27，macOS 21/27，macOS job 和总 run 保持失败。原七类中的 15 个自然/暂停/分片/消费者样本在 macOS 全部完整，包括三个修正后的暂停案例：所有 read capacity 至少 35，实际暂停后各另收 5402 bytes，全文 90000 行、最终光标/title 和真实正容量 read EOF 均成立。旧输入的零长度 read 假 EOF 仍是失败，不追认通过。

macOS 原六个取消案例的原始写进度均只有 `enter(requested=2048)`，无 returned/error/成功回执、readCalls=0，仍在 10 s 前提截止后经 1 s 资源 guard 以 driver exit 3 结束。三个无读控制在观察 enter 后至少 100 ms 仍无回执、主体存活，随后主动关闭 master、signal 1，没有 EOF。三个放行控制具有相同的无读窗口状态，开始读取后同步写一次返回 2048、成功回执成立，各以两次 1024-byte read 精确收齐，再放行主体 exit 0，取得真实 EOF、消费者结算及 fd/driver 自然释放。Linux 六个新控制则在观察前已经返回 2048 并有成功回执；原六个取消仍是候选 64 / audit 1984 bytes 分账。

因此原 macOS 取消夹具存在已定位的循环等待：driver 等全量写回执才读，当前同步写路径却需要读者进展才完成。此为本原生配置下的背压/进展依赖证据，不是 candidate 在成功写入后丢弃数据；六个取消测试未进入待测路径，既不算通过，也不能当作业务取消缺陷。记录位于应用层 fs.writeSync 两侧，没有 syscall 轨迹，不能由两个 1024-byte 块推定内核总容量或推广所有 macOS。下一增量须先冻结无循环等待的握手，以写调用进度/实际持有 read 建立前提，候选、audit 和最终写回执单独对账；不缩小 2048、不加超时、不改旧失败。本轮不决定具体生产取消条件和时间预算。

完整工件在独立工作树 `.debug/github-write-control-35508235734-{ubuntu,macos}/`。两边新 `--verify-saved` 均 attempted=27、verified=27、evidenceErrors=[]；Ubuntu exit 0，macOS 保留六个取消 failure、exit 1，解决了新验证器对合法缺回执提前停止的问题。源码/native/input SHA、schedule、raw/audit 和消费者记录全部核对，原生版本与第 23 节相同；更多环境/hash/工件 ID 见独立候选设计第 14 节。所有 cleanup remaining/errors 为空、无父 watchdog 硬超时，但六个失败仍无自然 fd close，不以事后清理或短命 driver 退出证明资源完整回收。

新探针修复和前提定位已完成，不代表退出完整性重构完成。macOS 在途取消、Windows 在途取消、同进程长期 native 资源增长、真实 provider/VS Code/packaged 及生产契约接入仍开放；本轮未重跑 Windows，既有主进程 TAIL 与自然资源反例不变。设计仍比较中/验证中，两份计划保持 active，业务及旧 live 绑定未修改。

## 25. 可读性握手与实际读取所有权（运行前冻结）

独立分支以 `8d442c7b` 冻结候选设计第15节，新增专用诊断入口、只读 C helper 和两平台 workflow。矩阵为请求已提交但 JS 回调未交付时取消、成功回调持有期间取消、无取消完整读取对照，三类各三次，Linux/macOS 共18项。原入口、旧六个取消失败及全部历史断言不动，Windows 不在本轮运行范围，业务代码不改。

fixture 仍以一次同步 write 请求写2048个ASCII字节，只在真实短写时补剩余量，不拆小预置块。driver 不等全量成功回执才首读，而是在write-enter后通过只读helper对继承的master fd执行 `poll(timeout=0)`，记录TTY、fd身份及可读/挂断/错误状态；helper不消费字节、不改fd/终端配置，每次必须自然退出且stdio关闭，才可将读取权交给候选。新诊断driver有独立进程组，helper一并纳入父watchdog清理，fixture仍为另一个独立组。原10s采集/1s资源/15s硬截止、2ms重查、64-byte首读和100ms回调持有参数保持，不作为生产预算。

poll只表明观测时可读，不能保证填满64或代表写成功；实际回调必须无错误且 `0<n<=64` 才建立成功读取前提，EAGAIN/零字节/错误仍失败，不能取消后重试挑绿。pending仅指已提交但JS callback未交付，不声称内核read仍阻塞。候选完整交付它实际拥有的n字节后诚实结算interrupted，所有在途/held操作结算后audit才开始，候选、audit及最终writer receipt分别对账。audit必须为2048-n且拼接/hash完整，取得正确成功回执后才放行主进程退出并读取真实EOF；audit后收的字节可能在取消后才生产，不称全部为取消瞬间已有OS缓冲。audit的EOF不升级candidate为完整结束。只有不取消对照要求候选独自收齐2048、audit为零并自然结束。

未选用FIONREAD计数作为跨Unix前提：公开 [XNU tty_dev.c](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/tty_dev.c) 的master ioctl无专属处理并落到ttioctl_locked，而 [tty.c](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/tty.c) 的FIONREAD使用t_canq/t_rawq，与master读取的t_outq不同。此为公开源码语义风险，不是已映射runner精确XNU构建或已在当前macOS实测返回0。poll与真实read仍需本次原生验证，不能以源码推断通过。

新诊断保存read回调原始字节、独立candidate/audit字节、完整consumer事件与最终headless状态、helper编译器/源码/二进制hash及所有PID/退出证据；既要检查owned bytes全交付，也要检查fd和helper释放。失败验证器继续遍历全schedule并返回非零，缺回执不应提前停止。本阶段只验证新握手及读取所有权，生产reader/取消策略、长期资源增长、Windows在途取消及真实provider/宿主验收仍开放。

### 本地验证与独立输入

独立分支输入 `931e8e22c4f857ae1b795f661d54cc6ab6666dec` 已触发 [run 35510798036](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35510798036)，本地Linux Node25.6.0的v1/v2各9项已完整通过及复算，保留两版快照。六个取消每次实际交付64字节、audit另收1984，三个control独自收齐2048、自然EIO；这不是macOS证据。目录在独立工作树 `.debug/unix-cancel-handshake-v{1,2}-local/`。

执行前独立审查加固了离线证据链：source EOF必须对应真实末次read callback，callback与交付按唯一read id/count/hash一一对应，全部helper尝试都须先close再移交读取权。v1之后只追加唯一read id断言及负例、完整新跑v2，不改矩阵/预算或旧工件。最终脚本SHA256 `1875495f6dc4d0b60d6de21247cdea9de2f808ff90fb04049c3f35d579212559`，C helper为 `0e17361b809fc1d05bd8261446ac4421755d297c170bf18c41e01c83648528b5`。最新非PTY自测 `/tmp/dsc-unix-cancel-handshake-selftest-Z717VS` 验证9个合成失败全遍历、注入1份raw损坏后仍遍历全部9项，以及driver/helper进程组watchdog；不计为新原生样本或长驻资源证明。语法、既有bridge测试、workflow/文档检查通过，远端结果待完整下载复核。

## 26. 首次握手结果与观察器启动副作用

run35510798036 attempt1完整18项为Ubuntu9/9、macOS8/9，总run失败，未重试。两边六个取消均candidate64/audit1984且candidate明确interrupted；macOS `read-through-control-3` 已完整接收2048并应用headless最终状态，但第4次read始终不返回。10s截止时仍pending，1s资源guard留FSReqCallback/PipeWrap，最终15s父watchdog SIGKILL driver并清理fixture；无自然fd关闭/源结束/主体退出。最终成功writer receipt存在，但没有退出gate，不是本样本缺字节。两平台下载后离线完整复核均attempted=9、verified=9、evidenceErrors=[]，macOS仍报告该失败且exit1。

独立工作树工件为 `.debug/github-cancel-handshake-35510798036-{ubuntu,macos}/`。Ubuntu服务端工件ID `10605985681`、ZIP digest `83a426accf523ed7809ffa033c322bb3989852aba5c8bfb0a564ba11a15a205f`；macOS ID `10605331473`、digest `60c6e946b5a712644fc82d89437fc94da15935bb216625f3b054431257e27a73`，不冒称本地ZIP独立复算。两边Node22.23.2/libuv1.51.0/node-pty1.2.0-beta.12，实际输入及脚本快照与第25节一致。

本轮之后发现实验前提遗漏：C helper只执行只读操作，不代表Node/libuv的启动链不改共享fd配置。固定 [libuv v1.51.0 process.c](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/process.c) 的fork路径375-376对继承标准fd执行 `uv__nonblock_fcntl(fd, 0)`，Apple posix_spawn路径629-631也对parent use_fd调用它；[core.c](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/core.c) 669-690中0明确清除O_NONBLOCK。dup2共享文件状态标志，而node-pty原先把master设置为非阻塞。这是Linux和macOS共同的启动链风险，不是只在红项平台存在。helper已退出、fd身份相同及普通文件offset不变不能排除此副作用。

旧工件没有F_GETFL前后数据。已知事件与源码支持“收齐后回执未就绪，gate没开又提交空read；阻塞read等输出，fixture等gate”的解释，但原样本flags变化及精确回执发布时序未原生记录，不写成唯一已证实因果。**整轮18项及本地同helper矩阵暂停作为保持非阻塞reader的验收依据**，不是仅排除1个红项；17绿/1红的原始结果和字节/所有权证据不改。此为诊断有效性问题，不是新确认的产品缺陷，也不影响此前未使用该helper的独立证据。

### fd 标志窄对照（运行前冻结）

独立分支设计第18节另冻结新入口 `diagnose-unix-helper-fd-flags.mjs`、只读原位N-API模块 `unix-fd-inspect.c` 和专用workflow。两组各三次，Linux/macOS每平台6项、总12项；只验证helper启动副作用，不再立即运行全取消矩阵。每个driver新建PTY，安静fixture仅经独立文件发布ready并等待gate，不读写受测PTY。模块inspect仅F_GETFL/fstat/isatty，返回flags、nonblocking、身份和TTY，另导出本平台O_NONBLOCK位值；无dup/set/read/write/poll，保留头文件、工具链及源码/binary哈希。

helper前后均连续两次inspect检验观察稳定性。master组按旧路径将PTY交给helper stdin，null组用同helper但stdin为ignore；两者都等helper自然close。初始master必须非阻塞、身份/TTY不变；冻结预期是master组仅清O_NONBLOCK、null组flags完全保持，其他结果均失败而不事后改门槛。最后文件gate放行主体自然退出，关闭master并验证EBADF、driver自然退出另验；10s样本/15s父watchdog，失败仍完整留证及遍历。旧脚本/断言/工件、业务和依赖不改。成功最多证明新控制中的标志副作用，不能倒推历史样本精确因果或将旧取消追认通过；生产readiness/取消/资源契约仍未选定。

### 两平台实测结果与后续

协议由独立提交 `9ae1d7f7` 冻结，输入 `951724c2d9893f93ddf882ba1ac0226ca36b1beb` 的 [run 35511736807](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35511736807) attempt1完整12项全部符合副作用复现预期，未重试：Linux master组三次34818→32770、仅清mask2048；macOS三次6→2、仅清mask4；两平台null组各三次flags全部保持。四次原位观察身份/TTY稳定，helper/fixture/driver自然退出、master关闭后EBADF，无硬watchdog、无事后kill、无cleanup残留或错误。故此副作用在目标Linux/macOS组合均已原生实证，不再只是源码风险。安静fixture没有重演旧回执时序，因此旧control挂起的完整/唯一因果仍不能冒称已实证。

独立目录 `.debug/github-helper-fd-flags-35511736807-{ubuntu,macos}/` 两边下载复核均attempted6/verified6、无failure/evidenceError。运行时与头文件均Node22.23.2、libuv1.51.0、node-pty1.2.0-beta.12；Linux x64 kernel6.17.0-1022-azure，macOS arm64 Darwin25.6.0。脚本SHA256 `3ce60fc6806d9b3a5752d52a4e5c96fbf700d624a44afbf64abd8f184d8c9928`，只读N-API C为 `b816790632e98cbb7137eb7320c572e4ea4e2ebac6023c89acc17f7dc2497768`。Ubuntu工件ID `10605812206`、服务端ZIP digest `0e15b05412ef86c24586f08c35138354eec8f65f2383babc11d3f0053609a846`；macOS ID `10605791331`、digest `3ff7e11650e4655abbd63409be166006564f00d689ec5655658c75753a16fddd`。完整工具链/源码/native/环境快照保留，摘要不是本地ZIP独立复算。

此前Linux Node25.6.0本地v1/v2各6项也精确复现；v1后仅加固gate文件写失败的合法失败分类，完整另跑v2而不覆盖旧工件。目录 `.debug/unix-helper-fd-flags-v{1,2}-local/`，非PTY标志负例 `/tmp/dsc-unix-fd-flags-selftest-u5o6eJ`。派生 `.debug/fd-flags-verifier-control-pZPCEB/` 先验证6份有效失败全部遍历、无evidenceErrors，再破坏1份events后仍尝试6份、5有效+1损坏，均exit1。两轮原生18项/12项、离线审计和既有bridge回归均留证，未修改业务、依赖或旧测试。

本阶段只收口观察器干扰的定位：原握手矩阵仍不能证明非阻塞reader验收，旧17绿/1红不改，Windows已知主进程TAIL/资源反例不变。下一步先设计不经子进程stdio传master的原位readiness观察，并让回执/gate推进不依赖下一次read回调，记录相对时序并验证flags始终不变，再用新入口跑完整取消对照。改传fd3或dup/dup2并不保证隔离共享状态，不能静默改flags使旧实验变绿。生产reader/API、取消预算、Windows在途取消、同进程长期资源及真实provider/宿主/packaged仍开放，两份计划保持active。

## 27. 原位 readiness 与独立 gate（运行前冻结）

独立分支以 `06cde336` 为基线，在候选设计第20节冻结新入口 `scripts/diagnostics/diagnose-unix-inplace-cancel.mjs`、N-API模块 `unix-pty-observer.c` 及专用workflow。保留旧三类各三次，加 `receipt-held-control` 三次，Linux/macOS各12项/共24项；业务、依赖、旧脚本/断言/失败均不改。原10s采集/1s资源/15s父watchdog、2ms重查、2048总负载、64首读及100ms成功回调持有不变，仍非生产预算。

原位模块只F_GETFL/fstat/isatty/poll(0)/再次F_GETFL，不dup、不设置flags/termios、不读写PTY，不通过子进程stdio传master。初始、每次read提交/回调、关闭前和readiness检查均保存完整flags/身份，要求前后相同、与初始一致且非阻塞。writer-enter后以poll可读且无挂断/错误建立首读前提，真实回调无error且0<n<=64才可接受；不能用readiness代替成功读取或恢复flags掩盖干扰。

fixture一次同步write2048个ASCII C，短写才继续，独立记录调用前后及回执/gate事件。driver独立控制循环观察回执，仅在候选+audit精确收齐2048且回执身份/hash和写入进度相符时发布退出gate；不再由read循环驱动这一判断。取消仍仅交付已拥有的n字节、明确interrupted，candidate所有操作结算后audit接管2048-n，不能将audit EOF算作candidate完成。无取消对照独自收齐、真实EOF/EIO、最终headless状态及资源分别验收。

新增receipt-held控制将写入完成与回执发布分开：fixture写完后等待release文件；driver收齐后一次正容量read必须实际EAGAIN/EWOULDBLOCK，持有该回调结果以暂停读取循环。独立控制循环此时才发布release、观察最终回执并发布gate，随后释放held结果，读取循环才恢复并观察EOF。核对完整因果事件链，不将空读当EOF、逻辑回调持有当内核阻塞，也不把该受控场景冒充旧失败时序重演。控制循环需显式停止/结算，失败全量留证及离线复核；编译来源、原始读数据、consumer、fd close/EBADF及自然driver退出独立记录。本阶段仍只验证诊断前提与取消所有权，生产选型、Windows在途取消、长驻资源、真实provider/宿主/packaged继续开放。

### 本地首次失败与原生结果

协议由独立提交 `758efccf` 先行冻结。本地Linux Node25.6.0首次v1完整12项中10通过/2失败：held回调实际仅99.682653/99.837933ms，未达到原100ms门槛；原失败、源码和工件全部保留，不是内容或flags缺陷。随后按单调时钟原截止点重查，不增长采集期限、不改断言；v2及最终取证加固v3各12项/离线复核通过，目录为独立工作树 `.debug/unix-inplace-cancel-v{1,2,3}-local/`。最终自测 `/tmp/dsc-inplace-selftest-QEuVeJ` 覆盖四类合成正例、flags/所有权/假EOF/gate负例、12份合法失败（含缺回执/无summary）全遍历及单份raw损坏后继续；普通文件观察和非PTYwatchdog不算原生PTY验收。writer运行中状态原子发布，退出后与原始追加事件互核，不实时解析可能未写完的日志。

固定输入 `697ee3f0012aa9d68f1774fa9a43ba3836e165d7` 的 [run 35516170917](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35516170917) attempt1全24项通过，Ubuntu12/12、macOS12/12，未重跑原生job。两平台全部观察保持非阻塞flags不变（Linux34818、macOS6）。每个平台六个取消样本均candidate64/audit1984、candidate明确interrupted；两种无取消控制共六次candidate2048/audit0。Linux自然源为EIO、macOS为真实read0，取消时这是audit的来源，不升级candidate为完整。六个receipt-held样本均有“收齐→真实EAGAIN结果held→release→回执→gate→held释放”的证据，gate不依赖read循环恢复。

全部最终headless状态、consumer顺序、控制循环结算、fd关闭/EBADF、主体及driver自然exit0分别达标；无hard watchdog/事后kill/cleanup残留。下载完成后两边复核attempted12/verified12、无failure/evidenceError。目录 `.debug/github-inplace-cancel-35516170917-macos/` 与 `.debug/github-inplace-cancel-35516170917-ubuntu-retry1/`；Ubuntu首个下载连接停滞且提前离线读取ENOENT，仅重试同artifact传输到新目录，未重跑job，未完成原目录保留。

Node运行时与编译头均22.23.2、libuv1.51.0、node-pty1.2.0-beta.12；Linux x64 kernel6.17.0-1022-azure，macOS arm64 Darwin25.6.0。最终JS SHA256 `714bf40f2de43e46cb9219ed4546b7d93cac1c4a349dc1bf724de55f5f28335e`，C SHA256 `1428850a154a8bc6ad3202871c0c94bb63d86cb28bca02c56077075240e10371`。Ubuntu工件ID `10607250891`、服务端ZIP digest `dfc89206fb04cb63f47554ddc5b942aa8225ef6cc8ba66420fce7557e873688a`；macOS ID `10606379037`、digest `2018754a69597355644f7cced2b1f9b6d805af4dd51a85627b85763d9175f7f3`，不是本地ZIP独立复算。完整环境/编译器/头文件/源码/native快照及自测证据保留。

本阶段已完成Unix这组前提与局部取消所有权验证，后续不再围绕旧helper重复试绿；原18项无效验收解释、本地v1两个失败均不改判。下一增量转Windows独立worker在途取消及同进程长期native资源（含Apple kqueue风险），运行前另冻结矩阵。本轮单样本进程自然退出不等于长期资源无增长，没有重跑90000行/Unicode全矩阵或真实provider/Host/Webview/packaged；生产reader/API、结束/取消政策与预算仍未选定。业务、依赖、旧live绑定和既有诊断均未修改，两份计划保持active。

## 28. Windows 取消所有权与同进程资源（运行前冻结）

独立诊断分支基于db6104d8，在候选设计第23节冻结新 `diagnose-runtime-owned-lifecycle.mjs`、`runtime-owned-cancel-worker.mjs`、`native-runtime-resources.c` 及专用三平台workflow，旧实验与业务不变。Windows四类各三次：主体就绪但未写应用数据时取消、worker持有真实data时取消、跨线程收到但消费者未应用时取消、自然EOF对照。payload为起始marker、2048个ASCII C及结束marker，idle写0；真实TTY主体保留写回执并等待独立退出gate。取消结算held callback、当时JS readable buffer与MessagePort队列，消费者按序应用后结束，始终interrupted；不承诺系统缓冲已排空，不将socket已连接或JS held冒称内核ReadFile挂起。

三平台分别以control-1/native-1/control-2/native-2四个driver做同进程对照，每driver3次预热加20次测量，不在每会话后重启进程。native Unix独占fs.read至真实0/EIO、close/EBADF并等待native exit；Windows独立DLL reader至真实pipe end、worker exit和input close。control运行相同采样但不创建PTY。只读OS观察器记录Linux fd/task、macOS fd类型（含kqueue）/线程、Windows handle/线程，观察器自有临时资源在返回前关闭，不关闭未知fd；用打开/关闭3个普通文件的控制验证其灵敏度。

每次会话收尾100ms后取5个间隔20ms快照，预热后同样建立基线；任一测量窗口的资源min高于预热max即报持续增量，全部20窗口及内容/消费者/生命周期达标才判该driver通过。保留原始序列和资源类型，不从单次差异推断唯一泄漏根因；这是23次有界实验，不是无限期无增长或生产验收。固定会话30s、资源guard2s、取消父watchdog35s、资源driver父watchdog150s，均非生产预算。失败仍采集其余独立driver，同driver会话失败则标注后续未执行，不跳过失败改判成功。

运行前先自测所有权/假EOF/计数增长与失败工件遍历，Linux本地资源组和TCP worker控制后再推三平台原生；全schedule、环境、源码/编译头/native哈希、原始数据/回执/消费事件、资源序列及首次失败均保存并完整离线复核。此时尚无本轮结果，不选定生产API或预算、不更改旧live绑定，真实provider/Host/Webview/packaged和异常终止仍开放。

### 首次原生结果与资源归属判断

协议由独立提交b98f1067冻结；Linux Node25.6.0本地v1及消费者逐块hash加固后的v2各完成四driver、46条PTY和全量复核，native fd21/thread11、控制fd21/thread7均稳定。原目录 `.debug/owned-lifecycle-v{1,2}-local/` 保留。最终自测 `/tmp/dsc-owned-selftest-VtmAS6` 完成真实普通文件+3/-3计数、四类TCP worker、丢交付/假EOF/计数增长负例与四份缺结果失败全遍历、首份损坏后继续验证其余三份；这些不是原生PTY样本。

输入 `b031b5981af6d009455d172e6c727d0b8a56ee67` 的 [run35519226627](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35519226627) attempt1完整执行三平台，最终failure，未重跑job。每平台资源组46条自然会话，另有Windows12项取消/自然对照，共150条真实会话；24个driver中20通过、macOS/Windows各两个native资源组失败。全部下载与离线复核完成，无evidenceErrors；原失败不改判，不把150条会话算作完整产品验收。

Linux四组通过，native fd23/thread11、无PTY控制fd23/thread7均不增长。macOS无PTY控制fd12/thread7、kqueue3稳定；两轮native的46条会话均有完整内容/消费者/真实read0、master close/EBADF和自然退出证据，但每个测量会话新增一个kqueue：每轮从fd15/kqueue6到fd35/kqueue26，线程11不变。逐窗口保留fd身份和五次观测确认旧kqueue仍在、新增20个，并非只有总数变化。同工件 `source-snapshot/4-pty.cc` 第174行的退出监听创建kqueue，等待/回调路径没有close(kq)，与实测增长一致。Apple kqueue不再只是源码风险，但尚未做隔离修正构建的因果干预对照，也未验收正式宿主。

Windows12项取消/自然对照全部通过：idle无应用写入时仍交付23字节ConPTY初始化数据；worker-held/parent-held各三次真实持有2082字节，观察与交付总量2105，最终interrupted；自然对照三次2121字节、真实pipe end及headless文字/光标完整。已观察字节、跨线程交付与消费者逐块hash/顺序一致，主体/worker/input均自然收尾。九次取消的JS readableLength均0，正长度readable-buffer分支尚未原生覆盖；不能称全部取消路径已验证，亦未证明内核ReadFile挂起或系统缓冲完整排空。

Windows两轮native各23条自然会话的内容/消费者/pipe EOF/worker退出都通过，但handles每次增加2：预热197，20次后237；线程12降至8，没有本轮线程增长。两轮无PTY控制handles180/thread12稳定。驱动进程最终exit0且无guard/事后kill，不能解除进程存活期间的40个额外句柄。源码中baton持有HPCON，connect调用ConptyReleasePseudoConsole，退出回调关闭hShell并移除baton，ClosePseudoConsole在另一路PtyKill；这只是归属调查候选，尚无句柄类型/对象身份，不把+2唯一归因于HPCON，也不外推builtin。

工件位于独立工作树 `.debug/github-owned-lifecycle-35519226627-{ubuntu,macos,windows}/owned-lifecycle-evidence/`，复核分别attempted/verified=4/4、4/4、16/16；Linux exit0，另外两平台各保留两个资源failure/exit1。所有driver自然退出、cleanup为空、无hard/resource watchdog。三平台Node及编译头22.23.2、libuv1.51.0、node-pty1.2.0-beta.12；Linux x64 kernel6.17.0-1022-azure/image20260907.300.1、macOS arm64 Darwin25.6.0/image20260907.0351.1、Windows x64 kernel10.0.26100/image20260907.229.1。三平台观察器自测均正确识别普通文件+3/-3。

Ubuntu工件ID10607847565、服务端ZIP digest `eb823e1d70d32eda91c0792a0e1d15955b5ee153523c9a481260aaf889a7b758`；macOS ID10606879826、digest `caebc9712910c175088e242b50315c6ece77393cec71c629c599184af3819ca5`；Windows ID10607308818、digest `6899bb032da0d2070d1019146b19399817b054ab29e55b8e733340adcce98c66`，非本地ZIP独立复算。LF脚本/worker/C SHA256分别 `4c2e3decf149c120c06faa9fcb3f997aa6f6dc2990dcad7cedece7b622cfb09d`、`8630eab630bb085c843e92467d578b59f3f4480cccef4c6b56e5b3a75ebc1489`、`fcd2cc8d55d8033b53c5e23e647e8ce7bb8b39f2c8931bcd50a302cb06b72adb`。Windows checkout CRLF导致原始hash不同，只读归一LF后逐字匹配，未改工件；完整native/hash/编译及自测记录在工件和独立候选设计第24节保留。

架构判断：仅替换JS输出reader不足以收口本次退出完整性，原生PTY创建、退出监听和释放必须作为同一资源生命周期设计。下一增量先冻结macOS kqueue干预构建与Windows句柄身份/创建回收对照，再补Windows正长度readable-buffer取消场景；隔离候选不直接修改业务或依赖安装树。生产reader/API、自然结束/取消政策和预算、异常终止与真实provider/Host/Webview/packaged仍开放，全部旧实验/失败不变，两份计划保持active。

## 29. 原生资源归因对照（运行前冻结）

本增量只验证资源归因，不选定生产reader/API或取消预算。新增 `diagnose-macos-kqueue-release.mjs`、`diagnose-windows-handle-inventory.mjs`、`windows-handle-inventory.c` 及独立 `runtime-native-resource-attribution.yml`。旧owned-lifecycle脚本/worker/C/workflow、冻结断言和失败工件不改；新入口可在新输出目录机械生成隔离副本，必须保存原文、变换清单、差异和hash，拒绝非预期输入。依赖安装树、业务代码和旧live绑定均不改。

macOS固定按prebuilt、rebuilt-baseline、rebuilt-close三个arm顺序运行，每arm沿用旧control-1/native-1/control-2/native-2完整schedule、每native driver三次预热加二十次测量，共十二driver、一百三十八条PTY。两个重编译arm使用相同Node头、工具链和node-pty包副本，正确解析node-pty自己依赖的node-addon-api；不能以仓库顶层另一版本代替。仅close arm在Apple退出等待分支结束、生成ExitEvent之前加入 `if (kq >= 0) { close(kq); }`，不重试close，不顺手修复原有异常wait/stat_loc路径。基线源码LF SHA256必须为19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db，锚点唯一；保存patch和前后源码。三个arm实际运行的spawn-helper固定为原prebuilt版本，构建产生的新helper另存而不使用，排除启动器变更。必须从每arm environment证明实际加载的native路径/hash，禁止回退prebuilt后误认候选已运行。

旧会话完整性与资源oracle保持原样，每窗口100ms收尾后五次20ms间隔采样，原会话30s/guard2s/driver150s不变。外层分别记录旧verifier结果：两基线预期各两个native资源失败并逐测量+1 kqueue，close arm预期全部内容/生命周期及资源无持续增长。只有三arm前提、完整schedule和上述对照均成立，才支持“该隔离close消除本组合中的kqueue增长”；基线红项仍红，不称生产已修复。任一构建失败、前提不符、缺工件、watchdog或对照不符均保留且整体非通过，尽可能继续其余arm，不用重跑到绿覆盖首轮。

Windows仅做原位只读句柄类型取证，不在本轮新增HPCON释放API。机械派生旧入口，唯一行为变换为schedule只保留四个资源driver及替换资源观察器；payload、worker、consumer、退出和旧资源断言不变，共四driver、四十六条PTY。新N-API模块用GetModuleHandle/GetProcAddress获取NT查询函数，NtQueryInformationProcess类51读取本进程句柄表，NtQueryObject类2查询类型，内存分配/重试有界；记录槽位hex、类型/index、访问权/属性、引用计数和原始status。Process类型补GetProcessId、GetProcessTimes、GetExitCodeProcess和可用时QueryFullProcessImageName的结果/错误；File仅GetFileType。不查询ObjectName、不读pipe、不DuplicateHandle、不关闭未知句柄，不用额外外部观察进程继承受测资源。

每次观察保存前后完整表和GetProcessHandleCount；槽位/type/access/属性集合变化或查询失败显式报告observer-race/inconclusive，不能默默丢项。数字槽位不是稳定内核对象ID，Process的PID+creation time只能加强该类型的身份，匿名File不能据此唯一归因。原计数失败照常输出，外层另报取证完整性、每个窗口的类型差分和跨窗口存留槽位；全部控制稳定、native持续File/Process配对且Process路径指向OpenConsole时也只算HPCON候选的支持证据，不冒称已完成释放干预。观察器自测用三个自己打开/关闭的普通文件验证类型和+3/-3；保留原parent watchdog防御无有限执行保证的系统查询。

先执行语法、机械变换/离线verifier负例及本地可运行控制，再将固定输入仅推独立诊断分支，在macOS/Windows各执行一次完整矩阵。全量工件下载完成后再离线复核，损坏样本不阻止其余样本检查；冻结与实际输入SHA、Node/头文件/工具链/源/binary哈希、命令输出和首轮失败均保存。生产资源回收设计、Windows正长度JS readable-buffer取消控制、异常退出、真实Agent启动链及Host/Webview/packaged继续开放。本轮把正缓冲控制独立排到资源归因之后，避免同时改变读取行为和原生资源实验。

### 实现前提与本地预检

协议由独立分支d70e6e1c、主分支15baf15a先行冻结。新macOS入口对node-gyp生成的隔离build工具链接保存target后移除链接本身，避免工件归档跟随机器外部路径；不处理安装树。构建日志、compiler实际路径/hash、node-gyp版本/源码与独立tooling lockfile、完整headers保留；spawn-helper固定、无prebuilt回退分别校验。有效反结果（基线不增长或候选仍增长）属于对照失败，不归为工件损坏。

两入口的Linux纯逻辑自测覆盖机械变换拒绝未知源、假的完整性/绿色结论、计数或类型竞争、Process槽位复用、缺工件及损坏首样本后继续末样本；新Windows路径复核使用可移植snapshot键，不依赖本机path.basename解释Windows绝对路径。独立工具布局smoke用node-gyp11.5.0、Node25.6.0同版本headers和嵌套node-addon-api7.1.1成功重编译Linux隔离副本，只证明布局/工具调用可用，不算macOS验证。既有executionSessionBridge回归、workflow YAML/两平台只读范围、文档链接和diff检查通过。实际runner固定Node22.23.2，macOS使用node-gyp11.5.0，尚待首次原生矩阵。

### 首次执行与诊断编译修正

固定输入944fe103f3f6d497c94b6575fabef6be69bc2929的run35527241793 attempt1总失败保持。macOS三arm完整138条PTY及下载离线复核通过外层对照：原包/重编译基线均kqueue6→26、fd15→35，close候选kqueue3不增长；旧四个基线资源失败仍为失败。Windows在新C模块编译阶段因辅助函数boolean与SDK rpcndr.h同名typedef冲突（C2365）失败，零条PTY，不是被测产品行为的新证据；编译日志和缺环境/四driver缺工件的离线结果原样保留。

后续仅将本轮新增C的辅助函数及七个调用标识符统一改名dsc_boolean，不改变查询、采样、比较、超时或断言。使用新的提交输入和新run，绝不覆盖首次工件或重判首次通过；同workflow会再次执行未变的macOS矩阵，首轮macOS因果证据独立保留。旧owned入口、worker、C、workflow和更早失败均不改。此为诊断工具编译修正，不是资源释放实现。

## 30. 原生资源归因结果

首次输入944fe103f3f6d497c94b6575fabef6be69bc2929的 [run35527241793](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35527241793) attempt1保留总failure：macOS外层三arm因果对照通过，Windows新观察器编译失败、零PTY。两个完整工件已下载至独立工作树 `.debug/github-resource-attribution-35527241793-{macos,windows}/`；本地复核macOS attempted3/verified3、无failure/evidenceError、exit0，Windows明确inconclusive/exit1、四driver均未执行，不能将缺失的运行证据改判通过。

macOS首轮12个driver、138条真实会话全部内容、消费者、真实正容量read0、master关闭/EBADF、native主体及driver自然退出成立；无watchdog、resource-timeout或cleanup kill。独立逐文件复核4759个manifest hash、1260次资源快照，原始观察与交付合计287316字节一致。两个基线arm的四个native driver均每次测量新增一个kqueue：fd15→35、kqueue6→26、线程11恒定；六个无PTY控制fd12/kqueue3/线程7稳定；close arm两个native driver均fd12/kqueue3/线程11稳定。旧verifier在prebuilt和rebuilt-baseline仍分别exit1并保留两个资源失败，在rebuilt-close为exit0；外层通过只表示预先冻结的因果对照成立。

三arm共用原spawn-helper SHA256 `2ee9dcf5337b78a258f20ed2872265ea5f7849eb82fc49a8e9d75e958168ae46`。实际加载pty.node的prebuilt/rebuilt-baseline/rebuilt-close哈希依次为 `30ac36647725b2402585781c8e81be39d76962bf79d03620a9763539d0fdbec8`、`4d497c1b21b5d8af9f50769c02aca0999629a7bb4c84d0fdf4b11f7082cc889c`、`4a9bb06cc321fdb500262112a9ce2780c1b00ccd60084762d769210d8201c9f1`，实际加载路径和require cache均匹配，未回退prebuilt。两基线源SHA为19210adf...，唯一close补丁源为 `3d92f41bab8e368b5b8dec8f4ecc931963969332c384ed552cad7f695270cab5`。环境Node/头22.23.2、libuv1.51.0、node-pty1.2.0-beta.12、node-addon-api7.1.1、node-gyp11.5.0，macOS26.6.2 arm64/Darwin25.6.0、Apple clang21.0.0/Xcode26.6、Python3.14.7、Make3.81，runner image20260907.0351.1；完整tool lock/headers/日志另存。

因此，Apple退出监听创建的kqueue缺少释放，在本原生组合的自然结束路径上已有最小干预因果证据，不再仅是源码风险或计数相关性。这不验证异常kqueue/kevent/waitpid、未初始化stat_loc、信号/EINTR、TSFN关闭或真实VS Code/provider路径，不直接将隔离补丁升级为正式生产方案。

首轮macOS工件ID10610476506、服务端ZIP digest `65eb6d9a03a3928368a18a5236e240cfa45eb777b87a7759b8d57457707ea06f`；Windows ID10609608936、digest `0b3aa80225d689e7f908c68075da1157d00be2ba7eae32ab1297ce534d9e9728`。这些是服务端归档摘要，不是本地ZIP独立复算。新macOS入口SHA256为faab85a8...、Windows入口15919b50...，完整输入在提交与工件中；Windows首次C的LF hash为b2da8ee7...，重命名后为84900ec7...，原CRLF文件和所有编译失败原样保留。

### Windows类型证据与归属缺口

局部重命名输入5a7ed5c45ba80319506705eac87bd09563090196的 [run35527528410](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35527528410) attempt1完整运行，仍保留总failure。Windows观察器/W4/WX编译及真实普通文件200→203→200、File类型+3/-3控制通过；四driver和46条PTY全部完成，旧verifier attempted4/verified4、两个native资源失败、evidenceErrors为空。所有会话内容/consumer/真实pipe EOF/worker exit/input close通过、driver自然退出、无watchdog或cleanup kill，资源却仍逐次增加：native-1 handles200→240、native-2 197→237，线程12→8，无PTY两组handles180/线程12稳定。两native预热绝对计数差3对应EtwRegistration80/77，不应误作会话增量。

全部420次观察的前后表、计数和槽位/type/access/属性集合一致，observerRace为0，所有NT类型查询成功。两个native组每个测量窗口均新增一个File（GetFileType=3，即PIPE）和一个Process，旧槽位保持、无移除或可见身份变更；File26→46、Process3→23，其他类型不增长。Process的PID、creationTime和exitCode=0均可取得，且各driver内这23个PID与自身23条fixture主体PID不相交。它们是已退出进程对象的句柄，不是实证有46个进程仍在运行；PID跨driver存在复用，更不能只以PID判断长期身份。

唯一查询失败为QueryFullProcessImageNameW的Win32 31（ERROR_GEN_FAILURE），两个native组各1365次、共2730次，不能改写成已证实权限不足。没有早期身份查询或专门API对照，也不能把退出后查询时机当作错误31的已证明原因。全部Process映像路径缺失，所以冻结的全身份取证依旧inconclusive，candidateSupport=false，离线exit1；全局输入检查和四driver工件均有效，不是归档损坏。**已确认的类型增长不等于已确认OpenConsole/HPCON对象归属**，不降低原门槛使其变绿。现有源码与固定DLL的Release/Close行为仍支持该调查方向，但本轮没有已知owner的释放干预，匿名File也没有稳定内核对象ID；不外推builtin或生产验收。

同run未改macOS输入的三arm另完成138条PTY及完整离线复核，结果再次与首轮一致，旧四个基线资源失败仍保留；这是另一份证据，不替换首轮。两次run共实际322条PTY（首轮138、次轮184），不是完整产品验收。下载目录 `.debug/github-resource-attribution-35527528410-{macos,windows}/`；macOS离线3/3无failure/evidenceError，Windows旧verifier与inventory都完整遍历4/4，两个native身份归因inconclusive，未修改oracle。Mac工件ID10610393210/digest `a1d5d20cb82880cc03ad313685309fafd571a26bfb72a664d419bd477d9cfc9d`，Windows ID10610243667/digest `3108dc19711292e503df7a286c169aaaa6f6c741c4ac8cda2d5b0363da3b25c0`，均为服务端ZIP摘要。

Windows环境为Node/headers22.23.2、libuv1.51.0、node-pty1.2.0-beta.12、x64/10.0.26100、image20260907.229.1；实际conpty.node SHA256 `2d1fb89aa74b692ad026807e78f90d970ef4e4b5b4b0254f94854f0f3f442306`、DLL `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff` 与前轮一致。新C修名后的LF hash `84900ec72f34344963944e34aae0621fb383a539ecf69003be9783d1e92ecd7b`，Windows原始CRLF文件只读归一校验，不改工件。完整本地自测、工具/原始源/hash和两次原生失败均保留。

### 阶段判断与下一边界

本阶段收口的是macOS自然退出kqueue增长的最小干预因果证据，以及Windows增长类型的进一步定位，不是退出完整性的生产交付。下一增量应先冻结Windows已知HPCON资源所有者的生命周期/释放对照，必要时在实际对象仍可查询阶段记录进程身份；不能盲关句柄表中的陌生槽位，也不能只对已经移除baton的id再调用kill宣称回收成功。该候选尚未选定具体API或预算，本轮不实施。

正长度JS readable-buffer取消控制独立保留，macOS异常wait/error/TSFN路径、真实Agent启动链、Host/Webview/packaged、生产自然结束/取消/资源owner契约仍未验收。业务代码、依赖安装树、旧live绑定和上一阶段冻结脚本/断言均未修改；两份计划保持active，设计仍为比较中/验证中。macOS本轮已得到的因果证据不需继续用同矩阵反复试绿，Windows也不因局部类型事实而取消剩余归属门槛。

## 31. Windows 正常进程对象语义控制（运行前冻结）

### 正常语义与调用方责任

按用户本次要求，先确认正常对象语义，不把已退出Process仍可查询或仍占句柄视为Windows系统缺陷。[PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)明确要求调用方在不再使用时关闭hProcess/hThread；子进程退出但父进程仍持有这些句柄时，系统仍保留有关结构。[CloseHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-closehandle)明确关闭Process句柄不等于终止执行，移除对象还需要进程已终止且全部引用释放。本轮只证明自身owner引用释放，不声称所有系统引用消失，也不主动终止正常已退出对象。

[ReleasePseudoConsole](https://learn.microsoft.com/en-us/windows/console/releasepseudoconsole)明确它不释放HPCON内存，调用方结束使用后仍必须ClosePseudoConsole；固定文档输入为[MicrosoftDocs d297f582](https://github.com/MicrosoftDocs/Console-Docs/blob/d297f58259a48a2ce5d77b427bc2b5dc6a573b00/docs/releasepseudoconsole.md)。[ClosePseudoConsole](https://learn.microsoft.com/en-us/windows/console/closepseudoconsole)可能影响仍连接的客户端与输出，Windows build26100前后返回行为不同。因此系统允许引用存续与应用最终释放职责并不矛盾，但不能用强杀或提前关闭换取计数下降。既有File/Process增长仍未精确绑定到HPCON成员，QueryFullProcessImageNameW的31原因也未证实。

源码限定补记：固定node-pty的conpty.cc:106实际为assert(remove_pty_baton(baton->id))，若NDEBUG生效，移除副作用也不执行。历史文档关于“已移除baton”的无条件表述以本限定为准；未经固定binary配置或反汇编不能作为运行事实。可靠源码事实是自然退出路径关闭hShell而未显式Close HPCON，hShell未置空；复用kill可能触及失效或复用的句柄值。HPCON是opaque token，不能直接CloseHandle(hpc)，也不能盲关枚举得到的陌生句柄。

### 新独立控制的冻结协议

新增scripts/diagnostics/windows-process-object-control.c、scripts/diagnostics/diagnose-windows-process-objects.mjs及.github/workflows/runtime-windows-process-objects.yml，不加载node-pty、不创建PTY、不修改旧工具或依赖。固定顺序control-1、release-each-1、retain-until-end-1、control-2、release-each-2、retain-until-end-2，每个原生driver自身连续3次预热加20次测量。control执行同样观测时序但不创建child；其余四driver共92个child，退出码按sessionIndex从0起交替0/7。总数为92个普通进程、零PTY，不计入产品验收。

每个child由CreateProcessW启动同一exe的child模式，CREATE_SUSPENDED|CREATE_NO_WINDOW、bInheritHandles=false。暂停时记录wait0、PID、创建/退出时间、退出码与image查询结果；ResumeThread后关闭本次返回的hThread，以5s有界wait确认自然退出。随后同一已退出hProcess查询三次、间隔至少50ms，总跨度至少100ms；要求signaled、正确退出码及PID/creation time一致。image成功或确切错误只作观察，不以必须成功或必须31作为门槛。release-each随后关闭自己的hProcess；retain保留全部23个至末尾逐一关闭。每次关闭记API结果并清空owner，不再操作已关闭数值槽位，不从数值槽位推定跨时间对象身份。

driver最初、预热后、每次测量结束及最终释放后，均先等待至少100ms，再取5次间隔至少20ms的GetProcessHandleCount，保存单调时钟与完整序列。control/release-each预期相对自身初始基线稳定；retain预热后相对初始+3、后续每次+1至+23，末尾释放后回到初始基线。取初始窗口[min,max]作为允许范围，每个预期偏移后的窗口所有计数均须在同样范围内；任何背景变化保留为对照未成立，不事后扩阈值求绿。受控retain的增长是实验故意持有的正常引用，不叫资源泄漏。

保存完整NDJSON owner/API/采样事件、stdout/stderr、退出状态、源码与工具/SDK/系统/Node/binary指纹，运行前保存schedule。每driver独立父watchdog30s，child wait5s；失败后清理只限本轮确切拥有的child，任何TerminateProcess、watchdog或非自然收尾都单列失败，不算通过。其余独立driver仍尝试执行；不会以driver退出后OS代收句柄冒充逐会话释放。

先做合成正例、假退出/重复关闭/未释放/错误计数/强杀负例，以及缺工件与首份损坏后继续复核的自测；Linux自测不算Windows验证。仅推独立诊断分支的新固定输入，Windows runner完整执行一次，首轮失败保留；工件下载完成再全量离线复核，区分有效反结果和工件损坏。此时尚无新原生结果，既有四个资源红项及映像inconclusive不改判。

### 下一边界

本控制仅校准正常对象语义和调用方引用释放；完成后才另冻已知HPCON owner自然收尾的隔离干预，不能从无PTY控制推导旧+2的确切根因。正长度JS readable-buffer取消、真实Agent启动链、异常路径、Host/Webview/packaged与生产API/预算继续开放，设计保持比较中/验证中，计划active，业务代码和旧live绑定不变。

实现前补记：GetProcessTimes在进程未退出时的exitTime未定义，暂停态只记录不要求为零。父JS watchdog只可结束自己spawn的driver，不能拿日志PID当所有权清理child；若driver尚持有暂停child，必须记录未结算/可能存活而非宣称清理完成，runner销毁环境也不是owner验收成功。原生C失败路径只凭本次CreateProcess返回且仍持有的HANDLE处理自己的child。上述限制不改变冻结次数、断言或预算。

## 32. Windows 对象语义首轮结果

输入cbbba0961595bcb0538a562ff183d2ef1abf15c9的[run35560063334](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35560063334) attempt1已完整执行，最终failure，未重跑或放宽断言。MSVC /W4 /WX编译、13类合成自测通过；六个driver全部执行，92个普通child、零PTY、690次快照。完整工件下载至独立工作树.debug/github-process-objects-35560063334-windows/后，原入口离线复核attempted6/verified6、evidenceErrors为空，但只有两个control通过，四个创建child的driver均保留计数失败。

### 正常语义已经确认的事实

本轮92个child均按暂停创建、恢复、关闭hThread、有界等待、退出后查询、最终关闭hProcess的顺序执行；48个自然exit0、44个自然exit7。六个driver全部自然exit0，没有watchdog、TerminateProcess、cleanup或未结算owner。已退出hProcess在持有期间仍signaled、可读正确退出码及稳定PID/creation time；这是正常对象引用语义，不是进程仍在运行。

共460次process-inspection中，92次暂停态image查询全部成功；92次立即退出态加276次保留态查询全部返回ERROR_GEN_FAILURE31，而wait/PID/exitCode/times所需查询成功。因而“已退出但仍可查询部分属性，映像查询失败31”在本普通进程控制中直接复现，不应单凭这一组合推断Windows或终端故障。这没有把31提升成所有版本必然行为，也不能据此补造旧2730次查询失败的精确原因、进程映像或HPCON归属；旧identity结果仍inconclusive。

### 计数反结果原样保留

| driver | 初始 | 三次预热后 | 二十次测量末尾 | 最终关闭后 | 冻结oracle |
| --- | --- | --- | --- | --- | --- |
| control-1 | 61 | 61 | 61 | 61 | 通过 |
| release-each-1 / release-each-2 | 55 | 60 | 60 | 60 | 失败 |
| retain-until-end-1 / retain-until-end-2 | 55 | 63 | 83 | 60 | 失败 |
| control-2 | 55 | 55 | 55 | 55 | 通过 |

每个窗口五次计数均一致。release-each在整个二十次测量中不再增长；retain每新增一个故意持有的hProcess增加1，最后关闭23个已知hProcess后83降至60，精确减少23。这支持“自身正常引用被逐个保留、显式关闭释放引用”，不代表系统中不存在其他引用或对象已经全局销毁。

四个child driver另有相对初始的+5，在三次预热期间形成，后续测量及最终关闭后保持。前两次预热没有独立计数窗口，不能断言+5恰在第一次CreateProcess发生；本轮没有类型表、模块加载或调用栈，不能确认为lazy初始化、ETW、安全软件、OS bug或应用泄漏。control之间61与55的差异也不直接归因。冻结要求最终回到初始区间未满足，因此四个失败不改判，不用事后减5或把基线移到预热后换取绿色。

这与旧PTY实验在预热后每会话增加2的观测不同，不能用本轮+5解释或撤销旧结果。

### 输入、验证与后续边界

原verifier在各driver首个计数反例处停止行为断言，因此另按原始事件完成只读补充审计，不调用或修改旧evaluate、不改raw：36份manifest成员哈希、2176事件、全部92child/690快照及单次关闭顺序逐项核对，未发现新增异常。保留440个计数快照超出原初始区间、四个失败，补充审计自身exit1；它不是替代验收器或新原生运行。最小retained间隔50.1474ms、三次跨度101.4829ms、快照间隔20.0723ms、settle100.1387ms均达到原冻结前提。

补充脚本与结果只保存在新.debug/process-objects-supplemental-audit-35560063334/，原下载目录未修改；audit.cjs/result.json SHA256分别d2bb1fec27172e8674072035be088ee9ff2e09ab69ff0c2176da4b8cd273c6ef、a5b49af16adddb676c6e95783f5ac2fc170c720bccb71123b0ba1aacc8b298d3。最终本地13类自测在.debug/windows-process-object-selftest-v4-local，早期自测目录均保留；既有executionSessionBridge回归、文档元数据/索引/关联路径、workflow YAML和diff检查通过，不能计为生产退出完整性验收。

环境为Windows x64 kernel10.0.26100、runner image20260907.229.1、Node22.23.2、Windows SDK10.0.26100.0、MSVC工具目录14.51.36231/compiler19.51.36256.0。实际exe SHA256为23657470f9708a84131ce948d5b62c97dc9d61bbc23fb59a241ab58140069b22；六个driver路径/hash与编译输出对应。JS/C的LF SHA256分别5656610bee07d05c978be656bdd3143405c9257555c85a18c9499eaeca53fee2、3388fca1675d2aefeaf542ee302a84f92edd243c0ea32ecd6a44d6e56765d1e7；Windows原始CRLF快照只读归一核对，不修改下载工件。artifact ID10621662744，服务端ZIP digest为08f518d1286d95eedc7b7a55ed44add24a99a19a1e02adc7a2b5e0d7a65d4c02，不冒称本地ZIP独立复算。

本阶段确认用户提醒成立，并将OS正常对象语义与调用方最终释放责任分开。ReleasePseudoConsole不免除最终Close是官方API契约；node-pty自然退出路径未显式Close仍是调用方owner设计问题的线索，但本轮无PTY控制不能证明旧File/Process配对就是HPCON成员，也不修改业务或生产生命周期策略。

下一阶段只对已知HPCON owner设计自然收尾后的隔离释放对照，先明确其保留用途、所有权及调用时机，不能复用kill、直接CloseHandle(hpc)或关闭陌生槽位。资源验收须同时分开owner账本、稳定背景与逐会话增长，+5归属留作受控取证开放项，不机械套入PTY矩阵或把普通对象存续当产品阻塞。Windows正长度JS缓冲取消、异常路径、实际Agent/Host/Webview/packaged和生产API/预算继续开放，设计比较中/验证中，计划active。
## 33. Windows 已知 HPCON owner 隔离释放对照（运行前冻结）

本增量只验证 bundled ConPTY DLL 后端中已知`HPCON`owner 的最终释放责任，不选择生产 API、取消预算或异常终止策略，也不修改业务代码、安装依赖或旧诊断。`useConptyDll=false`的 Windows builtin 后端另开独立矩阵，不能与本增量合并解释；macOS kqueue close 因果已单独收口。

### 候选臂和固定边界

固定三臂：`prebuilt-stock/no-close`使用现有 node-pty 预构建 native；`rebuilt-owner-retain/no-close`使用同一 bundled DLL、同一 spawn-helper 和重编译工具链，只加入 owner 保留状态但不调用 Close；`rebuilt-owner-retain/explicit-close`与上一臂共享全部 native 输入，只增加诊断专用`closeAfterExit(id)`单次 Close。三臂都固定`useConptyDll=true`，不能把 builtin/DLL 切换与 Close 变化混入因果结论。每臂沿用`control-1/native-1/control-2/native-2`，每个 driver 3 次预热加 20 次测量；共 12 个 driver、138 条 native PTY 会话。旧 payload、worker、consumer、终端状态、pipe/输入收尾和资源断言机械复用，首次失败与原始工件不覆盖。

`PtyConnect`中原有`ConptyReleasePseudoConsole(hpc)`时机保持不变。候选 source 在`SetupExitCallback`中等待并读取 shell 退出码后关闭`hShell`、置空并发布受保护的`shellExited`状态，但不在退出线程删除 baton；`closeAfterExit`只接受本模块确实持有、已发布`shellExited`、尚未关闭的`ptyId`，在主线程受保护地转移 HPCON owner，调用 DLL 的`ConptyClosePseudoConsole`一次，清空 owner 并移除 baton。调用失败、不支持或状态前提不成立均记录独立结果，不重试，不调用`PtyKill`，不调用`TerminateProcess`，不把`HPCON`传给`CloseHandle`，也不关闭句柄表中的陌生对象。关闭后不得继续 resize、clear、close 或复用该 id；普通后代不纳入托管。

`ptyHandles`的跨线程状态必须有明确的同步保护：退出等待线程不能无锁 erase，而应发布`hShell=null`与`shellExited`；主线程的`closeAfterExit`在锁内检查并取走 owner、锁外调用 Close、再在锁内完成移除。若实现采用其他同步方式，必须在源码快照中证明同一 owner 不会双重 Close、悬挂指针或竞态 erase；不得以`assert(remove_pty_baton(...))`的副作用承载生命周期。为防止 JS 序列门控被绕过，诊断 fork 还应提供带 generation/nonce 的`markPipeEof`与`markConsumerComplete`，`closeAfterExit`自身拒绝未满足这两个前提的调用；shellExited、exit worker/thread 完成、pipe EOF、consumer complete 和 owner 状态必须在同一 ledger 中核对。

### 收尾顺序和证据层级

每个 native session 必须记录`native-connected/owner-token`、writer receipt/gate、native exit、真实 worker`pipe-eof`、pipe close 无错误、input close、worker exit、decoder end、consumer complete/final terminal state，并满足偏序 gate 后再发`close-request`、`close-invoked`、`owner-closed`；不假设 native exit、pipe-end、worker close/exit、decoder end 和 consumer ack 的相对先后。`BlockingCall` 的 exit-event-enqueued、exit-callback-delivered、native-exit-thread-done、TSFN closing/queue failure 也必须单独记录；不能把事件排队当作 callback delivered 或 consumer complete。Close 前不得关闭 reader 以换取 EOF；Close 是 void，只记录调用及本地 owner 状态，不虚构返回成功。Close 后继续短窗口观察，任何新 worker bytes、pipe 错误、终态变化、重复操作、watchdog 或强制终止均为失败或不确定。若自然主体已退出但真实 pipe EOF、消费者已处理全部 data sequence 等前提缺失，则标记`precondition-failure`，不调用 Close、不宣称修复。

三类事实分开验收：原始字节/消费者/最终终端状态和自然主体、worker/input 生命周期；已知 owner ledger 的创建、Release、单次 Close、清空和不再使用；同进程 OS handle/thread/JS active resource 的稳定背景、每会话轨迹和 Close 后窗口。`no-close`的 owner 增长是有意正对照，不叫泄漏；`explicit-close`首先要求 owner ledger 每会话回到零、无继续逐会话增长及自然收尾完整，不强求 OS 总句柄立即回到 control baseline。若仍有残余背景，按`resource-failure`或`inconclusive`记录，不能把全局对象消失当作 owner 契约。

### 工件、预算和分类

每臂保存 source before/after/patch、实际 native/helper/DLL 路径和 hash、Node/headers/compiler/SDK、完整 schedule、session NDJSON、raw observed/delivered bytes、consumer/terminal state、owner ledger、Close 前后资源快照、driver stdout/stderr、watchdog 和首次失败。分类必须区分`precondition-failure`、`close-failure`、`natural-lifecycle-failure`、`resource-failure`、`evidence-error`与`inconclusive`。Close 阻塞、超时、`TerminateProcess`、未知句柄操作或 owner 重复操作不计通过；失败继续其余独立 driver，首轮目录不可覆盖。

自测先覆盖 owner 状态机、double-close/close-before-exit/unknown-id/close-after-owner-removed、Close 副作用输出、缺失自然 EOF/consumer、资源逐会话增长、缺工件与首项损坏后继续。Linux 自测不算 Windows 原生证据；Windows runner 只执行新独立 workflow，一次固定输入，原有资源失败和普通对象首轮结果保持不变。

### 实现前复核补充（2026-09-21）

候选仅在隔离构建目录生成，不写入安装中的 `node_modules`。stock 臂不调用候选新增接口；两条 rebuilt 臂共享同一编译产物，只改变是否请求最终 Close。Windows ConPTY 路径直接启动客户端，没有 Unix 的 `spawn-helper`；记录实际加载的 `conpty.node`、`conpty.dll` 及其配套 `OpenConsole.exe`，不能用不存在的 helper 证明输入一致性。

冻结源 `conpty.cc` 的 `PFNRELEASEPSEUDOCONSOLE` 调用类型为 void，但同包 `conpty.h` 明确声明 bundled `ConptyReleasePseudoConsole` 返回 HRESULT；不能把原调用方忽略返回值误写成实际 DLL 导出为 void。候选在不改变原调用位置和次数的前提下，使用与该头文件一致的函数指针签名记录 HRESULT，只有 SUCCEEDED 才发布 `releaseSucceeded`。最终 Close 才是 void，只记录调用和返回，不推断全局对象已经销毁。原有普通对象 +5、旧 PTY 每会话 +2 和新 owner 台账继续分开核对。

native 入口必须一次性占有 connect，拒绝同一 owner 重复启动；退出状态只有在等待结果和退出码查询均有效时才发布。TSFN 投递请求、实际接受、callback delivered、Release 状态和线程完成分别记录；callback 的日志可能早于 BlockingCall 返回，不人为规定这两个日志的全序。任何失败都阻止最终 Close。诊断 fork 不开放 legacy resize/clear/kill 入口，owner 表的全部访问受同步保护；这不是对生产 API 的修改或生产异常路径验收。

运行前审查和 Linux 自测只确认输入转换、校验器与拒绝路径的结构，不计为 Windows 原生通过。构建、语法或自测未通过时不启动矩阵；原生 driver 中的独立失败仍保存并继续其余 driver。离线复核必须重新验证 schedule、source/patch/binary/DLL 工件哈希、实际加载绑定、内容与资源原始证据，不能只信任保存的 pass 字段。

## 34. Windows HPCON owner 首次原生结果

固定输入 `d0f0be882bf5f99d0dcaa90c94b7a3d6b0023790` 的 [run 35586906307](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35586906307) attempt 1 已完成。MSVC 构建和 Windows 自测通过，三臂全部 12 个 driver、138 条 PTY 会话执行并完整下载。原 verifier 在 runner 和本地均为 `attempted:12 / verified:12 / failures:4 / evidenceErrors:[] / synthetic:false / pass:false`，退出码 1；四个 `no-close` 资源失败原样保留，workflow 总结果仍为 failure，不通过改断言或重跑取得绿色。

### 自然收尾与 owner 台账

138 条会话均收到真实 `pipe-eof`，native 主体和 worker 均自然 exit 0；每条实际观察与交付的 2121 字节一致，4 个数据块按序全部消费，最终光标 `(0,24)` 与终端内容符合冻结断言。12 个 driver 全部自然 exit 0，无 signal、stderr、resource-timeout 或父 watchdog 超时。这些是顺序 fixture 的结果，不代表真实 Agent 或生产宿主已验收。

两条 rebuilt 臂共 92 个 owner，各有一次 bundled Release、实际 `HRESULT=0`；等待/退出码查询、`hShell` 关闭、TSFN enqueue/Release/callback delivered 和 finalizer 实际 join 都有成功记录。46 个 retain owner 按协议保留，不请求 Close，每个 driver 末尾 23 个。46 个 explicit-close owner 均在 shell/TSFN、真实 EOF、consumer 和 JS 收尾 gate 全部满足后调用一次 Close，随后 owner/baton 移除、台账归零，无重复或拒绝操作。Close 调用耗时 0.0785 至 0.1847 ms；观察窗口中没有新输出、pipe 错误或终态变化。Close 为 void，此处证明调用返回及自身状态结算，不伪造 HRESULT 或全局对象销毁证明。

### 同进程资源对照

表中数值为三次预热后至二十次测量末尾的句柄数，每个 driver 内独立比较，不跨 PID 抵消背景。

| 臂 | native-1 | native-2 | 原资源判定 |
| --- | --- | --- | --- |
| `prebuilt-stock/no-close` | 200 → 240 | 197 → 237 | 两个失败，每会话 +2 |
| `rebuilt-owner-retain/no-close` | 200 → 240 | 197 → 237 | 两个失败，每会话 +2 |
| `rebuilt-owner-retain/explicit-close` | 191 → 191 | 191 → 191 | 两个通过，无持续增长 |

六个无 PTY control 全部 187 → 187。全部 46 次 Close 前后窗口均为 193 → 191，恰好减少 2；1260 个批次资源样本逐项核对，最短采样间隔 27.9056 ms、最短 Close 观察窗口 109.5266 ms，达到冻结前提。native driver 的线程基线为 12、最终为 8，没有持续增长；线程下降不能归因于 Close。191 相对 control 187 的稳定差额 4 不要求归零，也不是旧普通对象实验的 +5，不凭总数宣称新泄漏或进行机械扣减。

两条 rebuilt 臂共用同一 native 产物，只改变是否调用最终 Close，因而建立了窄因果证据：在本固定 bundled DLL 自然退出路径中，调用方对已知 HPCON 最终 Close 消除了逐会话 +2 总句柄增量。这支持最终释放责任，不否定 Windows 正常对象引用语义，也不把有意 retain 的正对照叫作系统泄漏。本轮没有句柄类型或内核对象 ID 枚举，不能逐槽认定减少的两个句柄就是旧实验的 File/Process 对，旧具体身份问题仍 inconclusive。

### 固定输入与完整工件

环境为 Windows x64 kernel `10.0.26100`、runner image `20260907.229.1`、Node `22.23.2`、SDK `10.0.26100.0`、MSVC tools `14.51.36231` / compiler `19.51.36256.0`、node-addon-api `7.1.1`。独立复核重算 root manifest 的 5739 个文件及 build/driver manifests，并用冻结 transformer 精确重生实际编译 source、patch 和 header。Windows CRLF 快照只读归一核对输入，不改工件。

| 输入或产物 | SHA256 |
| --- | --- |
| 原 `conpty.cc` | `d502cce570552c7a1bea373c7672975eeb330c3025dd151cf9c180ca2a1becc2` |
| 原 `conpty.h` | `32b74fe493b4435bc2f8362cfa4bcb4f49a290438002cc4a369e9379c7728d3c` |
| 生成 source | `cb0ab01aa21eceeb06eac88306f4cf8980c15ede94303810a44df9b724c40e58` |
| 生成 patch | `a7093eb560c76ac596892ab8d262f138fa3521d0b38162c4e6e6c4e7595a627b` |
| 新诊断 JS（LF） | `57a20c2d327aa30718a25a62d2869d08d0ec49d410376bf3856f24aaeb3b9e72` |
| stock native | `2d1fb89aa74b692ad026807e78f90d970ef4e4b5b4b0254f94854f0f3f442306` |
| 两候选共用 native | `484f580d2ec3a08a6f972611692d26f6cf0fb9e4ca0d49398bda8c14a2baad50` |
| 配套 `conpty.dll` | `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff` |
| 配套 `OpenConsole.exe` | `7f68c840226505004215c0b82d4e502c24b5bc3f4b93c4baaaa19bd679c0def8` |

`loaded-native` 核对实际 require 的路径与 hash；DLL/OpenConsole 是同目录 loader 对应文件的指纹链，未额外采集运行中 OS 映像枚举或 OpenConsole 进程身份，不能升级为新增内核身份取证。Windows 此路径没有 Unix spawn-helper。

artifact ID `10633047821`，ZIP 19,738,089 字节；本地下载完整 ZIP 并独立复算 SHA256 `4d60975924e1b6c3ff75421535ff7f9efd2413ad639419fbb4c81cfd52fd83e2`，与 GitHub digest 一致。主工作树完整工件位于 `.debug/hpcon-owner-35586906307/runtime-windows-hpcon-owner-35586906307-1/hpcon-owner-evidence`，ZIP 校验记录为 `.debug/hpcon-owner-35586906307-zip-verification.json`。独立生命周期审计保存在 `.debug/hpcon-owner-native-audit-35586906307.{mjs,json}`，输入/资源审计在 `.debug/hpcon-owner-supplemental-audit-35586906307/`；后者 `audit.mjs` / `result.json` SHA256 分别为 `25d478efb813ade44607bb62906a807f592d50f95e3b4aebcaecba4f141d3f31` / `304fdcbd5503509b467e6e7a13d206fafb8fbb082c03bdd25ba6840ec43ec8ad`。补充审计通过只表示原始证据一致，不改原矩阵四个失败。

### 诊断预算限制与下一阶段

新增入口的 `guarded()` 只等 `child.close`，150 s 定时器只请求 `child.kill('SIGKILL')`，没有独立返回分支；若 driver 已退出但 stdio 被其他进程引用，不能保证在该预算内返回。另建 Linux 纯 Node 控制已复现：自有 driver exit 0 后，150 ms watchdog 的 kill 返回 false，close 晚于 watchdog 884.470223 ms；外层 5 s 硬截止和 1 s 最终兜底未触发，自有 driver/后代结束后 `/proc` 均不存在。独立诊断树 `.debug/hpcon-guarded-budget-control-v1/` 保存 11 个工件，manifest SHA256 `e053adf6b94787879ed8d8f08a9911b512bb422510d3ec8ece5028a991df6560`。这是工具预算缺口，不是本轮 Windows 失败原因：全部 12 个 driver 已自然返回且 `timedOut:false`，没有命中此路径的证据。后续另建版本修正返回预算，不能修改本次冻结入口或将 stdio EOF、JS exit、OS 进程终止与 session ConPTY EOF 混为一谈。

本阶段只在独立诊断分支新增 transformer、入口和 workflow，主重构分支仅更新文档；安装依赖、业务、旧 live 绑定和所有历史实验均不改。已不需要继续以“消除正常 Process 对象存续”为目标排查。下一阶段先将已建立的 Unix/Windows 自然路径证据转为 provider/adapter 候选生命周期及错误语义设计，明确 owner 移交、自然完成与取消/失败的边界，并在新诊断入口冻结异常路径和返回预算；Windows builtin、正长度 JS readable-buffer、并发、实际 Agent/Host/Webview/packaged 仍需独立验证。旧版 Windows 的 Close 行为也不由 build 26100 外推。生产 API、取消条件和时间预算仍未选定，设计保持比较中/验证中，ExecPlan active，退出完整性交付未完成。

## 35. Provider/Adapter 生命周期与失败契约阶段

本阶段从主分支0518dcc4、独立诊断分支4504ae18继续，只做设计、代码核查与既有回归。当前候选全文为 `docs/design-docs/runtime-execution-lifecycle-contract.md`，不把本设计第7–34节的历史实验改写成新的生产方案。新增明确的职责边界、结果类型、偏序、读者结算候选与D1/D2运行前协议，整体仍比较中/验证中；新模型、异常native矩阵和新guard尚未实现或运行。

关键取舍是继续验证“平台provider分离事实、共享adapter统一输出封口、authority和页面分别结算”，而不是两个业务owner各自等待旧onExit。实际主体退出、源eof/中断/错误、authority异步解析、每读者应用结果和native释放分别记录。已证明终止但退出码未知不等于未证明终止；超时unknown可以接纳同一次操作的迟到证明，不重试Close、不改首次报告或已公布seal。Windows正常对象引用语义和已知owner最终释放继续分开，native释放不等待全部Webview，但新的内容移交偏序必须另验，不能从自然实验直接外推。

只读核查补齐接入事实：Supervisor的操作链/journal.flush不能替代tracker异步解析完成；Webview已有真实xterm callback屏障，缺口在跨层结算表达，本地退出提示也不属于authority revision。当前close参数在各跳被重建为identity，新增outcome必须全链路保留和校验；不能扩展一处类型就宣称读者凭证已接通。候选比较后以opt-in close outcome作为D1模型路线，独立ACK仍为对照，服务端幂等回执的有界政策留作接入前门槛。

Windows隔离候选的自然gate不能直接成为生产错误回收策略：CreateProcess成功到hShell登记之间存在可失败操作；固定node-addon-api的env-null TSFN路径不执行callback内部RAII。macOS的自然close(kq)对照也没有覆盖kevent/waitpid/TSFN失败。这些是新增静态失败窗口，不是已复现native异常或对正常138条证据的否定。部分初始化、在途读取、线程/通知/consumer/Close失败与同会话并发必须有分项owner账本和安全处置；永久未返回/unknown的隔离与容量方案仍阻塞生产默认接入。

D1冻结24组37个独立子案例，覆盖进程/源顺序、取消所有权、authority失败、资源迟到补证、读者竞争及三种能力八组合；预期计数只说明模型约束。D2冻结每平台8子项各3次，三平台共72条、零PTY，54条真实进程/启动控制和18条synthetic分账；从spawn前计时，1000ms工作预算、另1000ms清理/返回、外层5000ms加1000ms观测，均不是产品预算。G04受控helper继承stdio、有限TTL与协作结束的前提必须在各平台成立，尤其Windows父Job不能提前终止它；不成立记precondition-failure，不强杀陌生PID或以模型代替。完整规范及未验证项见新设计第8节。

下一步仅在独立诊断分支新增D1/D2入口与工件，主分支继续只承接文档。现有业务/安装依赖/旧脚本和所有历史结果不改，不推运行时分支；D1/D2通过也不等于原生取消、builtin、正缓冲、真实Agent/Host/Webview/packaged通过。完成这些前提后再逐平台冻结实际故障注入，保持退出完整性计划active。

## 36. D1/D2 实施与本地证据（2026-09-21）

独立诊断分支新增四个模型/guard/入口文件及 `.github/workflows/runtime-lifecycle-contract-v1.yml`，只用Node标准库、不安装依赖、零PTY，旧脚本和本树业务不改。完整实现与首轮记录见生命周期契约第10–11节；本节追加记录，不改变第7–35节的历史断言或失败。

D1在本地Node25.6.0与Electron39.8.7各37项及离线复核通过，含真实Promise引用/解析异步屏障与模拟consumer callback的独立观察。D2首轮24项控制行为通过，但deadline后真实管道end不应将整体capture标完整；保留原工件及其归档验证器，另建v2输入明确deadline-incomplete。新版Linux24项完整通过，最长1952.428426ms，小于未放宽的2000ms；9条natural-exit、3条spawn-error、12条deadline-exceeded保持分账。helper协作回执不等于OS退出wait，更不意味着Windows系统对象应全局消失。

本地开发/自测/正式各版本分别保留。两个独立复审收口了Promise自证、capture-error、outer5000截止和超时整体分类；既有bridge、tracker与Supervisor聚合再次通过。三平台runner尚未执行，后续另记输入commit、run/attempt、全部artifact及离线复算；当前没有新的原生异常、真实宿主或生产验收结论。退出完整性和旧诊断入口的硬返回债务仍按各自范围跟踪，计划保持active。

## 37. D1/D2 三平台首轮收口（2026-09-21）

独立输入d173c099d37f83bb3178d280a6a6d8b80d984b92、run35620967433 attempt1三平台success，全部ZIP下载、API大小/指纹和解压后离线复核完成。完整环境、artifact ID/ZIP SHA和时间表见生命周期契约第12节；主树.debug/lifecycle-contract-35620967433保留全部输入和offline-review-v1.json。六个输入快照与commit一致，未重跑或修改旧工件。

D1共111模型子案例，D2原validator共72控制通过（54真实进程/启动控制、18synthetic，零PTY），各平台37/37和24/24，两个validator均完整遍历且无工件错误。最大guard原始时钟观察分别为Linux1951.046799ms、macOS1980.999041ms、Windows1960.969100ms，全部小于原2000ms门槛；outer均自然结束且未命中5000ms截止。三平台G04的driver真实退出后helper仍响应私有nonce并持有两stdio前提成立；G07原断言只证明流通知先于exit通知，Windows三条的真实提前关闭前提未成立。不能由helper协作回执补造OS退出wait，更不能由这些普通进程控制推断PTY资源全部回收。

所有raw结果保留原分类，尤其每平台12个deadline及3个spawn-error没有改成自然成功。独立Windows审计确认Node22.23.2的libuv对标准fd0/1/2的fs close直接返回成功而不关闭，G07使用fs.closeSync(1/2)没有制造目标前提；250ms后接近进程退出时的通知顺序不能补证。详见生命周期契约第13节，原workflow/validator绿色结果不修改，但Windows这三条不能列为完整前提验收。下一步优先另冻新Windows G07夹具及独立主体存活证明，再推进原生失败和unknown owner隔离；其他69条控制依据保留。此为诊断夹具的平台假设问题，不是Windows系统bug，也不是已证明的Terminal/Agent缺陷；业务、依赖、旧脚本和正常对象语义判断均不变。

## 38. Windows G07 补证协议冻结与实施边界（2026-09-22）

本增量只补第37节的Windows夹具前提，不改变旧D2的72条工件、原始绿色报告和Windows G07三条not-established结论。完整冻结协议为 `docs/design-docs/runtime-execution-lifecycle-contract.md` 第14节；独立诊断树按此实施 `scripts/diagnostics/windows-stdio-close-control.c`、`scripts/diagnostics/diagnose-windows-stdio-close.mjs` 与专用workflow。本树继续只承接设计和验证记录，业务、依赖、旧live绑定及旧诊断均不改。本节是运行前约束，尚无本轮Windows原生结果。

新C程序本身是guard直接创建的主体，不加启动器或后代；只登记并关闭本进程继承的两路pipe写端，以实际Win32关闭结果和父端真实EOF交叉验证，不再借fs.closeSync标准fd的返回值证明关闭。控制通道与stdio分离，身份须匹配本次nonce、mode及直接ChildProcess。父端在双EOF/close、完整marker和native关闭回执齐备后，才生成首个新challenge；收到有效pong后按自身单调时钟持有至少100ms，再发送第二个不同challenge。两次pong与退出许可须在原t0+1000ms前，guard在许可退出前不得返回；PID可查询、提前准备的回执或通知先后都不替代这段实际可执行窗口。

矩阵固定Windows x64/MSVC、Node22.23.2，close-wait、keep-open、close-exit各3次，共9个真实child，零PTY；D1及Linux/macOS旧控制不重复。close-wait要求真实关闭后双挑战成立并自然exit0；keep-open必须保持写端至deadline且不能建立双EOF后的挑战前提；close-exit真实关闭后立即exit0、不回复挑战，也必须被拒绝存活前提。负控通过只表示oracle按预期拒绝，`preconditionEstablished`和guard raw结果分账，不能把任意启动、控制或工件错误当成负控成功。

原样复用冻结guard-v2和1000ms工作/总2000ms返回预算，外层独立5000ms截止加1000ms观测，fixture自限3000ms；超时、主动销毁、迟到回复和自限/外层干预均按原失败/不完整语义保存，不扩预算、不靠事件循环巧合制造100ms持有。新目录保存完整schedule、编译日志、源码及实际EXE指纹、双通道原字节、native回执、guard/outer trace和首次结果；编译失败须保留九项not-run及实际创建数零，逐项失败仍遍历九项。合成自测和离线validator独立重算身份、时序、内容、预算并拒绝篡改，不将其算作Windows原生通过。

只有首次Windows矩阵及完整工件复核完成后，才能判断本增量是否建立真实提前关闭且主体仍活的前提；即使新九项达标，也不追认旧三条或宣布PTY/产品退出完整性完成。后续partial-create、wait/通知、取消/正长度buffer、release失败/挂起、并发与unknown owner有界隔离另冻；builtin、旧Windows、真实Agent/Host/Webview/packaged及生产API/预算继续开放。设计仍比较中/验证中，退出完整性和旧工具移交债务不关闭。

## 39. Windows G07 新控制首次结果（2026-09-22）

固定独立输入 `cf35904055a840e6e5b3189eb8551beba17d7163` 的run35631266321 attempt1完成Windows-only首次矩阵，九个新真实child全部按原verifier通过，无工件错误，零synthetic主样本、零PTY。实际环境为Windows Server 2025 Datacenter x64/build10.0.26100、image win25-vs2026/20260907.229.1、Node22.23.2；MSVC19.51.36256.0以 `/W4 /WX /O2 /TC` 编译成功，实际EXE SHA256为 `a472e116c449c457d75d6ec5ba53689cb86dc08014f62d084b214c781b465dd7`。完整证据保存在主树 `.debug/stdio-close-35631266321/`，`offline-review-v1.json` 核对五份输入快照与固定commit的LF指纹、实际编译及九项原始结果；不外推其他Windows版本或架构。

三次close-wait均在两流真实EOF/close、native成功关闭与精确marker之后才生成fresh challenge。首个有效pong到第二次challenge的实际持有分别为101.7934、101.1616、100.8252ms，均达到未放宽的100ms门槛；第二次pong后才放行主体自然exit0，guard未因stdio提前关闭而提前返回。三次keep-open按预期不能建立该前提，保留 `deadline-exceeded / deadline-incomplete`；三次close-exit真实关闭后自然exit0且无pong，也全部拒绝存活前提，raw仍为自然完成。故九项控制通过不等于九项前提成立，正例3条、拒绝控制6条分别记账。

独立Windows原始审计 `independent-native-audit-v1.json` 完成836项检查，九条预定控制均成立，无失败；文件SHA256为 `133b9fc9ed673cf23637837517e1b140e56266daed4a3af701545eeb9c80a20f`。其中close-exit-3最晚stream close为20.7513ms，父端challenge为21.1521ms、观察控制通道不可用为21.4268ms、child-exit通知为21.7708ms，但始终无pong；这直接说明流先关闭和exit通知尚未来到不能代替主体仍可执行的证明。全组`guard-returned`事件记录最大1011.7495ms，另从调用方await后事件补证最大1012.3385ms，九项均在原2000ms内。outer-returned事件最大1112.4939ms，controller已退出/两流已close且未命中5000ms；但之后仍写盘再resolve，没有外层await后记录，不能将该事件当完整外层返回预算证明。补充计时在timing-observation-audit-v1.json，原审计不改，工具缺口由下一新入口承接；超时后EOF仍不晋升完整。

新样本补足的是固定环境中“真实stdio关闭后主体仍能响应、guard继续等待真实退出”的局部前提及oracle负控，不改第37节旧72pass、Windows G07三条not-established或任何历史失败，也不将Windows正常对象引用存续认定为OS bug。旧guarded入口移交、PTY原生异常/取消/正长度buffer、builtin、并发、真实Agent/Host/Webview/packaged及生产API/预算继续开放。下一阶段仅冻结原生异常路径与unknown owner有界隔离的设计和矩阵；本树仍只更新文档，退出完整性交付未完成。

## 40. 原生失败与资源隔离第一批设计冻结（历史阶段，2026-09-22）

主树f318579a、独立诊断树7fb4ae9e为本轮输入锚点。新增 `docs/design-docs/runtime-native-failure-isolation.md`，状态为比较中/未验证；当前只完成源码依据、故障分类、owner责任、隔离候选和第一批协议设计，没有新增工具、workflow、原生运行结果或业务修复。D1/D2、G07及所有原生失败仍保留原冻结输入和判断。

设计分别标记真实API受控输入失败、native调用点替身、真实调用后的通知扣留、调用前gate和有限模型；真实进程执行合成故障不因此成为真实syscall失败。各资源在取得后立即登记，单次释放与同operation迟到补证分别记录；unknown不是EOF、释放成功或可重复Close的许可。N=2总槽与Q=1熔断仅用于诊断准入模型，两个已准入owner仍可能同时unknown；停止新建不等于隔离共享进程卡死/崩溃，每会话独立进程也必须在创建前安排，尚未选定生产拓扑。

第一步冻结D3三平台各24项、合计72个零PTY进程控制场景，以及D4三平台各8项、合计24个零native策略模型。D3独立观察调用方真正after-await，将等待API返回、caller退出和writer封存分开；resolve前日志、同步写盘完成或CI总timeout均不能替代返回证明。工具实施、本地校验、首次三平台运行和全工件复核完成后，才进入W1/U1。

第二步固定W1 Windows八项各三次共24、U1 Linux六项各三次共18、macOS八项各三次共24，总66个driver尝试，不是66个成功PTY或全部故障验收。范围包括部分初始化、wait结果分离、Unix的合成通知拒绝和释放回执延迟；真实启动数、native进入/返回、前提不足和not-run逐条记账。当前只冻结输入、分类、预算与工件要求，尚无这些矩阵的运行证据。

其余通知失败/环境销毁、正长度已读缓冲取消、在途waiter/control fd、真正Close挂起和双会话故障域第二批尚未冻结，仍阻塞生产接入。builtin、其他Windows版本、实际Agent启动链、Host/Webview/VS Code/Electron/packaged及生产容量/停止预算继续开放。下一阶段只实施独立D3/D4工具，不修改运行时代码、依赖、旧live绑定或旧实验；退出完整性总体保持比较中/验证中、ExecPlan active、债务未关闭。

## 41. Foundation v1 两次 runner 与跨 pipe 误判（2026-09-22）

输入7141cfa3的首次run `35673511893` attempt1与误触同SHA重复run `35673550930`均为failure。两次完整D3均为Linux/macOS各24/24、Windows23/24，仅Windows D3-01-1跨pipe误判；v1把stdout/fd3到达次序重包成source序号，不能代表caller因果。这是跨平台均需防范的诊断oracle缺陷，不是Windows系统或产品bug。D4每runner执行三组逻辑标签共24项，每run72次、两run144次模型按原verifier通过，均零native PTY；D4没有pty:false字段，实际记录native:false/nativeProcesses:0。

首次Windows自测positive23/24，重复21/24；重复新增D3-07-1/08-1接收504.2253/543.014ms，超过固定缩放500ms，是独立真实迟到，不由source排序修正。重复自测还见三次writer结算554.9569/630.9223/608.3949ms超500ms，原verifier未全部检查，单列预算债务。Windows两次自测在positive失败后未生成最终self-test报告或tampered负例，保留已有轨迹/日志，不补造缺失工件。

首次artifact Linux/macOS/Windows为10672290231/10671559820/10672340270，目录是独立诊断树 `.debug/github-foundation-35673511893-{ubuntu,macos,windows}/`，不是主树；重复artifact为10671619890/10671953122/10672690041。六ZIP总3,853,782字节/3022成员，size/digest均与API一致，36份输入与固定7141cfa3字节对账，Windows仅CRLF差异；只执行可信Git输入生成的验证器，不执行归档代码。完整获取/审计在独立诊断树 `.debug/foundation-first-two-audit/`，summary SHA256为 `eb5d8e91ffe23ffa03ff43384d1d52c46ab0798a05a0adc644084a2a7d9081d5`，audit SHA256为 `b1de5345391c816f11a47b4143afa65b5da8d826463f76d5883f559f59b1d5c1`。两run原failure、原断言及工件均冻结，不用重复执行筛绿。

## 42. D3 v2 来源与顺序窄修正（运行前协议，2026-09-22）

新增D3 v2两个入口和专用oracle自测，不改v1或D4；具体为 `scripts/diagnostics/diagnostic-observation-envelope-v2.mjs`、`scripts/diagnostics/diagnose-observation-envelope-v2.mjs`、`scripts/diagnostics/observation-envelope-v2-oracle-test.mjs`。caller源帧携带全局sequence和完整identity，observer记录真实通道及有限非负接收时间；after-await仅fd3，同pipe序号递增而跨pipe到达任意，及时性按接收时间判断。完整编码帧和分片解析限4096字节，错误协议必须失败；连续源序缺口只允许D3-08明确bulk区段，且必须observer确认after-await、caller收到ACK后才发bulk。正式边界与负例见 `runtime-native-failure-isolation.md` 第15节。

新workflow `.github/workflows/runtime-observation-envelope-v2.yml` 仅固定Node22.23.2三平台D3 v2，运行语法、确定性oracle/parser、缩放自测、完整24项及离线复核并完整上传，不重复D4模型。自测保持原0.25缩放/500ms预算，不能扩大以掩盖重复Windows真实迟到。本地证据见第43节；三独立settlement、deadline不可变首次观察、bounded unconfirmed、writer预算及独立evidence结算、D4完整重放/identity仍未闭合，W1/U1未开始。

## 43. D3 v2 Linux 本地窄验证（runner前历史阶段，2026-09-22）

独立诊断树Linux Node22.23.2的新目录 `.debug/observation-envelope-v2-local-1-selftest/` 完成oracle78/78、parser8/8、positive24/24及篡改拒绝；`.debug/observation-envelope-v2-local-1-full/` 未缩放24/24 verified，三脚本语法通过并保存源码hash。D3-08记录observer receipt/ACK发送与首bulk，caller收到匹配ACK的前提来自源码await控制流，不冒称另有caller ACK接收事件。首次overflow锁定后续bulk拒绝，以维持唯一缺序区段。

输入是未提交工作树源码快照，不是可绑定新commit的运行；v2三平台runner仍待一次新提交触发及完整下载审计。本地通过只补来源/顺序oracle，不改v1两次失败、自测真实迟到、旧工件或完整契约阻塞项，不交付native/生产退出完整性。

随后独立复核发现local-1 tamper自测只证实总失败与首项错误：根manifest提前失败使run.scale未赋值，实际attempted24/verified0，不是其余23项有效复核。local-1 positive/full24通过和原工件均保留。新修正分开根manifest错误与run读取，強制篡改报告attempted24/verified23及末项无错误并保存tampered-verification.json；新 `.debug/observation-envelope-v2-local-2-selftest/` 完成oracle78/parser8/positive24，篡改报告24/23且仅shared-manifest与D3-01-1错误；`.debug/observation-envelope-v2-local-2-full/` 未缩放24/24 verified且无evidenceErrors，最终CLI语法/diff检查通过。新目录仍为未提交工作树输入，三平台runner待验，不重写local-1。完整writer协议中非法帧可能被sealed掩盖的风险继续归入evidence/settlement债务，不扩此次窄实现。

## 44. D3 v2 唯一三平台 runner 与完整审计（2026-09-22）

固定输入 `b4db41cc` 的唯一 push run `35676427931` attempt1完成三平台完整采集与独立离线审计；没有rerun或workflow_dispatch，没有重跑v1/D4或启动W1/U1。三平台均Node22.23.2：Ubuntu24 x64/kernel6.17.0-1022-azure，macOS26 arm64/Darwin25.6.0，Windows Server2025 Datacenter x64/10.0.26100。这是各固定runner环境的Node进程控制证据，不覆盖全部OS版本、架构或VS Code宿主。

各平台未缩放full24/24、缩放positive24/24、oracle78/78、parser8/8；tamper各attempted24/verified23，仅shared-manifest与D3-01-1预期拒绝，其余23含末项有效。合计full72与scaled72、oracle234/parser24、tamper72 attempted/69 verified，计数分账不合称产品样本。完整源身份、真实通道/接收时间、同pipe源序、连续bulk尾部遗漏及D3-08 ACK-before-bulk均经原始证据复算。本次native PTY=0、D4=0、W1/U1=0。

Windows full D3-01-1再次实际观察到fd3 after-await先于stdout operation-returned到达，但caller source sequence/sentNs符合真实发送顺序，v2正确接受；这不是因为本次恰好没有乱序才得到绿色。其他full/scaled案例未观察到同类倒序，不把有限未观察外推为平台不可能发生；更不追认v1两个failure为通过或称原Windows系统缺陷已修复。

原始时间独立复算均未超本次冻结预算。full after-await/writer settlement最大毫秒分别为Windows1075.2648/1010.1685、Linux1040.977367/1005.608616、macOS1056.778959/1012.396875，预算均2000；scaled分别Windows330.1647/265.695、Linux296.077696/255.168326、macOS292.366375/254.102916，预算均500，scale仍0.25。这里只说本次raw没有超预算，不因此关闭verifier尚未完整检查writer预算的债务，也不抹去v1重复Windows真实迟到。

三个artifact为Linux10673655385、macOS10673171771、Windows10674000078；每ZIP453成员，共1359，API size/digest与完整下载一致。15份runner输入与固定Git提交逐项对账，Linux/macOS共10份exact，Windows5份仅CRLF差异；验证器从可信Git输入生成，未执行归档源码。全部工件、可信输入、三个platform-audit及 `acquisition.json`、`metrics.json`、`audit.json` 保存在独立诊断树 `.debug/observation-envelope-v2-run-35676427931/`。audit SHA256为 `a772fa2a399c9b51fe109b56fff097933e9873fa0c424aab93f18717c13233f7`。本主运行时树未新增脚本、workflow或这些工件。

本轮只关闭D3 v2来源/顺序窄修正的首次跨平台验证待办。三独立observation/process/evidence settlement、不可变首次deadline观察、有界unconfirmed、writer完整消息协议/预算和D4独立重放/完整身份仍阻塞；W1/U1不启动，原生失败设计保持比较中/未验证，生命周期与总退出完整性保持比较中/验证中，计划active。旧实验、原始断言及失败不改，不新增普通后代托管、旧live迁移、生产server布局或运行时代码改造。

## 45. 下一版诊断结算设计冻结（2026-09-22）

新设计 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 以诊断树e1a31b79、运行时树a5f8d629为输入，冻结D3 v3与D4 v2的下一版契约，状态比较中/未验证。本阶段仅源码、协议与设计复审，零新增测试、零新增native运行；旧D3 v1/v2、D4 v1、workflow、工件和历史失败全部不改。三侧静态复审、跨文档及历史保持检查已通过；只收口设计，不代表实现或新矩阵通过。

D3 v3同步返回handle，observation、processSettlement、evidenceSettlement各自首次结算；绝对deadline先于等时/迟到事件，首报不可变，迟到事实追加。exit与捕获真实EOF分开，capture gate保留尾部；直接owner有界控制、未确认责任继续占账，不能以kill/close当释放。D3每case最多预留caller/evidence/publisher三个槽，任一hard截止仍unknown即停止后续case；这不是D4模型的N2容量。writer、独立verifier与最终publisher分责，协议错误不可被合法claim清除，受测证据结算、发布与可信离线归档验证分别判断；这些是诊断候选，不是生产进程布局或退出时间政策。

D4 v2固定N2/Q1，完整command/return/event/snapshot由不共用SUT转换函数的oracle逐步重放。创建acquisition、use token、整体release操作、首次unknown、当前证明与槽位分账；失败不抹已取得资源，错身份拒绝零副作用，旧代同操作迟到补证不得污染新owner，完整责任结算后仍显式reopen。failureDomain只是模型标签，不提供真实故障隔离证明。

运行前计划为每runner D3 v3主控36项、因果gate2项、publisher4项，D4 v2确定性模型16项，分别计数；三runner对应108/6/12/48，均尚未实施执行，不相加作PTY或产品通过数。下一步仅在独立诊断树新增版本入口，先本地实施、fixture清单/源码hash冻结与独立源码复审，再唯一一次固定输入三平台采集及全工件可信重放。主运行时树只同步文档，不推送；W1/U1和完整生产退出交付继续阻塞。

## 46. 新诊断本地实施与审计边界（2026-09-22）

本阶段已进入独立诊断树的八个新版本入口实施与本地审计，完整记录见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节（比较中/验证中）。主运行时只同步文档；本阶段不运行D3真实36+2+4、不新增runner、不推送任何分支，不改业务、依赖、旧实验/工件或image.png。上一节“均未实施”的表述只描述设计冻结时点，不覆盖当前进展。

D4 v2的local-3 self-test/full及各自离线复核均16/16、302命令、58次预期拒绝、1924 checks；93语义负例、4 saved负例和另存7个重hash sidecar负例分开计数。unknown key拼接碰撞的初次失败保留，修订为JSON tuple并在固定第05项回归；早期绿色没有覆盖负例sidecar独立绑定的缺口也已记录。证据、精确源hash及不含native/PTY/真实并发的边界见该契约，不把本地模型计为三平台或产品验收。

D3最终本地self-test-2通过119 oracle、41 core、15文件、25 archive/consumer/binding fixtures；saved复核4/4、88 manifest members及四源原字节均匹配，但boundedConsumerDelivery=false、acceptanceReady=false，真实进程/native/PTY均未运行。首轮76/29/15及saved3/3保留为历史覆盖；cross-replay-1因oracle多算stdin JSON换行字节而误拒，修订移除该额外字节，core仍以stdin EOF分隔。迟到错误回溯首报、owner/unknown/event/scenario漏验和归档绑定已本地修正，首次失败不改判。到期才冻结的首报记录真实消费者延迟并标delivery-budget-unresolved，独立消费验收预算及六组逐fixture对账仍开放，不修改原deadline或暗加宽限；symlink负例归档须保留link元数据。

下一步仍补齐冻结覆盖和独立审查，之后才另行确认真实D3与三平台采集。W1/U1、原生第二批、真实Agent启动链/双会话/Host/Webview/packaged、生产API/停止预算及整体退出完整性均未完成；不把正常Windows已退出对象引用升级为OS bug。
