# 交付跨平台执行会话退出完整性

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖设计、实施和验收。2026-09-20 用户确认“退出完整性”属于本次 Runtime Persistence 重构的独立交付项。立项基线为 `388ec2b3`，方案阶段基线为 `a5112fb5`；PR #294 合并后，13 个重构提交已 rebase 至 `origin/main@5965adb8`，当前原生收尾阶段基线为 `10d40e63`。本阶段只做设计与隔离诊断，不直接修改业务代码，不推送运行时分支。后续实施开始前必须先选定方案并更新正式设计，不把本计划视为私有 fd 补读或某种新 API 的授权。

## 目标与全局图景

用户在 Agent/Terminal 自然结束时，当前有效终端页面收到完整、按序的主进程尾部，即使程序返回非零退出码；自身已接收、排队或消费中的内容不能因提前清理而丢弃，最终终端状态正确应用并释放资源。尾部保证从主进程成功写入终端的数据开始，不包含程序自身尚未 flush 的应用缓冲，也不补造生产者未写出的 UTF-8/控制序列内容。主进程退出、真实输出结束、页面完成应用和主动取消必须区分；不能把固定等待、socket close 或最终 revision 当作全部输出已交付，也不能将超时/截断标成完整 EOF。不用把正常结束全部降级为中断来掩盖缺失。

2026-09-20 用户进一步确认：画板只管理 Terminal/Agent 执行会话及其终端资源，不逐个托管、追踪或恢复后代。Terminal 内部子进程/命令/后台任务由 shell、应用和操作系统管理，Agent 工具后代由 Agent 管理；实际主进程退出后，不默认保持节点或终端等待普通后代结束或接收其未来输出。主进程仍运行时，同一终端收到的输出不能按后代来源过滤。父子关系不等于前后台关系，通用后代实验不自动等于交互 shell 后台作业或真实 Agent 缺陷。

启动链另行验证：`Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` 中实际 CLI 是会话主体，不能按工具后代排除，也不能未经证明把包装程序退出当作 Agent 结束。具体收尾边界、取消条件和时间预算仍未选定。此澄清撤销“必须先满足 macOS 普通后代持续输出门槛才能选型”的优先级，不改变历史实验、断言、失败和工件，亦不将 macOS 标为已验收。

范围包含 Linux/macOS/Windows、Agent/Terminal，以及由 Supervisor 托管的 live-runtime 和直接由 Host 托管的 snapshot-only。结束后 Runtime 重开仍不恢复进程或历史，Supervisor/机器故障后仍无需恢复；F-03 root 归属、F-04 容量整体模型和 F-05 已取消的历史归档不在此项顺手改造。不必等待其他重构完成，但本项未通过验收前不得宣称本次重构的退出完整性已经完成。

## 进度

- [x] (2026-09-20) 按设计第28节承接Windows12项取消所有权与三平台同进程资源冻结协议；各driver3预热/20测量，与无PTY对照分开，业务不改。
- [x] (2026-09-20) 新诊断/worker/OS观察器/workflow完成，自测与Linux本地v1/v2各46条PTY通过；输入b031b598的run35519226627三平台首次运行完整复核，Windows12项局部所有权/自然对照通过，macOS/Windows各两个同进程资源组失败保留，无工件损坏。
- [x] (2026-09-20) 两工作树设计/计划/索引/原则/债务同步，元数据/引用/全部计划章节/diff与范围检查通过；核对Windows CRLF原始输入和全部cleanup/guard，bridge回归通过，业务/依赖/旧实验未改。
- [ ] 下一增量冻结native资源归属与回收对照：macOS kqueue隔离干预构建、Windows句柄类型/身份/创建回收，并补正长度JS readable-buffer取消控制；业务及生产政策仍不改。

- [x] (2026-09-20) 按设计第27节冻结原位readiness/独立gate新24项，增加receipt-held控制验证读取循环暂停时仍能发布gate，不改旧结果或业务。
- [x] (2026-09-20) 独立分支新模块/入口/workflow完成，Linux本地v1的两个不足100ms持有失败原样保留；按原单调截止点修正后v2/最终v3各12项与复核通过，非PTY所有权/gate/失败遍历负例和bridge回归通过。
- [x] (2026-09-20) 输入697ee3f0的run35516170917 attempt1两平台各12项通过，完整下载复核无failure/evidenceError；Unix flags不变、分账/EOF/gate/consumer/单次释放有原生证据，Ubuntu只重试工件传输，未重跑job。
- [x] (2026-09-20) 两工作树设计/计划/索引/原则/债务同步，本地v1两个100ms前提失败与所有旧实验保留；元数据/引用/范围/diff检查及bridge回归通过，未改业务。
- [x] (2026-09-20) Windows独立worker在途取消/已拥有数据结算及同进程资源矩阵已按第28节冻结，仍待验证后再推进生产reader/API与取消政策选型。

- [x] (2026-09-20) 承接独立分支8d442c7b冻结的18项可读握手矩阵，一次2048写/poll非消费观察/实际read所有权分账，主线设计第25节同步；不改旧断言或业务。
- [x] (2026-09-20) 新helper/入口/workflow、本地v1/v2各9项与独立审查完成；输入931e8e22的run35510798036完整18项/下载复核，总run失败，macOS control-3收齐后挂起。
- [x] (2026-09-20) 独立审计发现helper启动链清共享O_NONBLOCK的两平台风险，暂停全部同helper样本的非阻塞reader验收解释；新12项原位flags控制已在设计第26节冻结。
- [x] (2026-09-20) 输入951724c2的run35511736807两平台12项及下载复核完成，Linux/macOS均实测master组仅清O_NONBLOCK/null组不变；本地两版各6项、失败verifier负控及bridge回归通过，设计/索引/原则/债务同步。
- [x] (2026-09-20) 原位readiness/独立gate/flags不变已由第27节新24项验证；旧18项不恢复验收资格，不接入业务reader。

- [x] (2026-09-20) 写入前提阶段基于fbcc94ee，独立分支冻结第13节并新增v2入口，旧探针不动；本地27项与缺回执/篡改raw的完整失败复核通过。
- [x] (2026-09-20) 收取7d832d3e / run35508235734两平台54项，完整复算各27项无工件错误；Ubuntu27通过、macOS21通过/6失败，写入进度与受控读放行定位夹具循环等待，保留原取消门槛及失败。
- [x] (2026-09-20) 两工作树共10份文档同步，frontmatter/索引/关联路径/计划章节及diff检查通过；核对新脚本/原生快照和全部cleanup/driver，业务、依赖、旧脚本/workflow零改动，未执行新的真实provider/UI/packaged验收。
- [x] (2026-09-20) 新取消握手已按第25节冻结，不要求首读前全量写完；执行结果与helper有效性限制见第26节，原2048负载与所有失败保留，不把控制组通过替代取消验收。

- [x] (2026-09-20) 用户确认独立交付范围，建立设计/规格入口并明确不在本次立项中修改业务代码。
- [x] (2026-09-20) 承接两轮诊断，记录 Linux 实证、Windows 条件性反例、macOS/Windows 原生证据缺口和公共契约依赖。
- [x] (2026-09-20) 同步产品规格第 10 节、架构审核、容量重评、技术债和索引；完成文档元数据、本地引用及业务零改动检查。
- [x] (2026-09-20) 第一轮方案验证：运行前冻结 Linux 两 reader、两运行时共 84 个样本；完整保留原 reader 反例，候选为 36 次完整读取和 6 次明确取消，不接入业务。
- [x] (2026-09-20) 补齐候选比较与共享收尾契约提案，核实 closeTerminalRead 缺少应用完成/取消区分，以及宿主 `^1.80.0` 支持范围约束；这些接口仍待实现验证。
- [x] (2026-09-20) 诊断工具加固后以相同参数完整回归 84 个样本，候选仍为 36 次完整读取和 6 次明确取消；共 168 个实际样本全部保留，增强验证器复核及实际 PGID 清理检查通过。
- [x] (2026-09-20) 独立 runner PR #294 已合并；保留 `backup/runtime-persistence-before-runner-rebase-7202298c` 并 rebase 正式重构分支，合并文档冲突时保留双方记录，业务代码与 rebase 前一致。
- [x] (2026-09-20) 承接三平台最小原生基线并完成 rebase 回归；Node 25/Electron-as-Node 39 各 39 项隔离契约、17 项实际 Supervisor 注入用例通过，不代替原生 reader 选型。
- [x] (2026-09-20) 独立 main-based 诊断分支完成三平台 147 样本首轮候选：Linux 门槛通过，macOS/Windows 各 6 个后代样本未达标，保留 run 35498026812 首次失败；未接入业务。
- [x] (2026-09-20) 修正 Windows 父 Node Job 自动杀子进程的夹具前提并加严存活/TTY 断言；run 35498732353 再执行 147 项，Windows 候选 18 次完整、3 次明确取消，macOS 六项失败保留。
- [x] (2026-09-20) 按用户澄清拆分产品验收与普通后代诊断，重新登记阻塞理由；保留主进程尾部/最终状态/资源及启动链义务，不改旧测试或追认历史失败为通过。
- [x] (2026-09-20) 本次 10 份文档完成 YAML/索引/新增引用、计划状态和历史协议/证据不变检查；独立只读复审无实质阻塞，修正主进程与后代退出的措辞歧义，不执行新实验或业务测试。
- [x] (2026-09-20) 按设计第 19 节冻结并验证新屏障模型，Node/Electron 首轮及 consumer 对账加固后各 25/25；实际 tracker 四项两版均通过。POSIX 启动器各 12 项达标，保留启动前预检失败及源码快照；仅新增隔离诊断，不改业务或旧实验。
- [x] (2026-09-20) 独立复审并加固诊断取证；4 个新文件语法、既有 bridge/tracker 回归、旧契约两组 39 项、完整工件 schedule/hash/结果/清理及文档一致性检查通过，业务/依赖/旧测试零改动。
- [ ] 冻结完成/取消/中断契约、旧版本能力边界、候选对照及原生平台矩阵，登记固定重复轮次和等待/资源预算。
- [x] (2026-09-20) 在独立诊断分支设计第 10 节冻结新原生矩阵：Unix 各 21 项、Windows 42 项，主线设计第 22 节同步边界；仍不选定生产预算或 reader API。
- [x] (2026-09-20) 实现并复核独立分支新84项，run35506150727总失败原样保留：Linux21项、Windows候选21项达标；实际bridge受控启动链通过但3个主进程尾部/21个资源失败仍在；macOS12通过/9失败，诊断假EOF与取消前提未成立已分开归类。
- [x] (2026-09-20) 新v2探针修正零容量read和失败verifier，两平台控制组完成；macOS修订暂停三项通过，六项原取消的写读循环等待已定位，但取消路径尚未验收，不将控制组追认为取消通过。
- [ ] 补跨平台主进程尾部/最终状态、reader 长驻资源和实际 Agent 启动链证据，再选定实现与接口；macOS leader/write/EOF 后 master 对照保留为诊断，不以普通后代续跑门槛阻塞产品选型。
- [ ] 实施源读取/排空边界及 Host/Supervisor 共用生命周期契约，保留旧 live 绑定与明确降级。
- [ ] 补自动化回归、真实 provider/VS Code、packaged 和资源回收验收；保留失败证据并收敛开放项。
- [ ] 同步最终文档与技术债，符合完整完成定义后归档计划；不能因 Linux 或局部夹具通过就勾选全平台完成。

## 意外与发现

本轮首次三平台证据直接区分单次退出与长期资源：macOS两轮每会话新增一个kqueue，fd15到35；Windows两轮每次+2 handles，197到237；无PTY控制稳定、所有内容/消费者/单次退出通过。Windows12项局部对照通过但九次readableLength均0，不能覆盖正缓冲分支。Apple风险已有native证据，Windows对象身份与HPCON归属尚未证明，详见设计第28节。

run35516170917两平台24项直接证明新观察不改变flags，六个receipt-held控制在真实EAGAIN回调逻辑结果held时完成gate；macOS自然源真实read0、Linux EIO。取消candidate64/audit1984仍分账，audit不补算候选输出。每样本自然释放不是同进程长期资源证明，具体证据/下载传输重试边界见设计第27节。

本轮新诊断初版两个setTimeout(100)实际只持有约99.7/99.8ms，原100ms断言正确报失败；新版本按单调截止点重查后全12项通过，不增长期限或追认旧失败。四类原位观察的本地flags均不变，独立gate在receipt-held逻辑read恢复前发布；随后两平台原生证据已由run35516170917补齐。

窄控制run35511736807将helper共享flags副作用从源码风险提升为两平台实测：Linux三次34818→32770（mask2048），macOS三次6→2（mask4）；两边null对照各三次均不变。全部自然退出/EBADF成立，无事后kill。新实验无PTY读写，不能补造旧control的回执时序或证明唯一挂起因果，也不证明生产资源长期无增长。

新run35510798036完整18项为Ubuntu9/9、macOS8/9，失败control已收齐2048却pending read到父watchdog。更重要的是helper启动链遗漏共享O_NONBLOCK影响：libuv fork与Apple posix_spawn均清继承标准fd的非阻塞标志。旧工件无flags轨迹，整个同helper矩阵暂不能作为非阻塞reader验收，包括绿色项；已冻结新12项原位F_GETFL/不继承PTY对照，保留原实验与结果。见设计第26节。

第25节当时的候选不将FIONREAD当作未经验证的跨Unix PTY master输出计数，而用poll建立非消费可读观察，再由真实read回调证明成功。helper额外持有master引用，要求首读前释放并纳入watchdog组清理；这些条件未覆盖启动时改flags，其无侵入前提现已由第26节否定，不是当前下一步方案。实际read可短于64、真实n须完整交付的所有权边界仍保留，不重判旧64/1984固定断言。

新控制run35508235734确认macOS取消夹具循环等待：首读之前等待2048-byte全量回执，但同步写在无读取时只有enter；相同100ms观察后放行读取，三次均返回2048并完整取得EOF。不是candidate丢弃已写成功字节，也不是全平台生产缺陷；应用层记录不足以推定内核容量。新暂停案例均真实恢复后另收5402bytes，read容量始终为正。六个取消失败仍保留，原生和离线验证均完成全部27项、macOS正确exit1。详见设计第24节。

新原生 Unix 取消负对照显示：候选已发起 read 的 64 bytes 可以全部保住，但同一次主进程成功写入的 1984 bytes 仍留在系统缓冲，需要独立 audit 才读到。因此“取消诚实标注 interrupted”不能代替主进程自然尾部保证。单次 master fd 的 EBADF 也不证明 native 全资源无增长：锁定 node-pty 的 Apple `SetupExitCallback` 创建 kqueue 后未见对应 close，尚须长驻原生计数，不作为本轮实测泄漏。跨进程 JSON 夹具发布和父 watchdog 有界日志结算等取证加固分别留存版本，不覆盖旧成功或失败。

原 bridge 对 node-pty onExit 的完整排空假设早于本次重构，bridge 和锁文件未由本轮容量改造改变。裸 PTY 不经兼容协议也能短读，故删除旧协议不会自动解决。Linux 的 HUP/partial read 可提前 EOF；另有 Unix 200 ms timer 和 Windows 默认 ConPTY 1000 ms 无 data destroy，不能合并为一个平台 bug。固定 libuv v1.52.1 包含一个相关修正，但未覆盖已核查的后续修正及 node-pty 强制关闭路径。

公共实际 Supervisor 夹具证明 exit 前已接受操作会收敛，exit 后新回调会被拒绝；它只刻画契约依赖，不证明每个平台自然发出 late data。macOS kqueue 映射与 slave close 顺序不同，源码共享不等于同因实测。原先本地原生运行环境只有 Linux；PR #294 已补托管三平台公共接口基线，但并未提供其他平台的候选 reader 或完整源结束证明。

首轮 Linux 候选实验把两类后果区分开：暂停消费时，原 reader 六轮在 writer 成功后缺尾；后代延迟写入时，原 reader 六轮提前关闭令写入失败。候选分别完整交付；保持 slave 的六轮明确取消，并不计为完整排空。自然零/非零退出本轮均完整，没有取得新的自然 HUP 旧失败/候选通过对照。现有 reader close 还将页面应用完成和取消合并，不能把释放来源当成已完成消费的证据。详见设计第 8–11 节。

runner 首轮 macOS 是 CRCRLF oracle 误报而非短读；Windows 是内容通过但进程资源 guard 失败，显式事后 fixture 清理后的成功不证明自然退出会自动释放资源。隔离契约对照进一步通过实际 `TerminalPagedProjection` 确认完成/取消发出相同旧 close；模型 final 注入实际 Supervisor 后可以保留 process-exit 之后的尾部，但没有实现可信 native EOF 或 local Host 接入。详见设计第 12–14 节。

新候选原生 run 35498026812 中，macOS 直接 read 0 仍不能实现当时的后代保留假设；Windows builtin 暂停后文字完整但末尾光标少一行，DLL 原 worker 仍不自然退出。Windows 首轮后代属于父 Node 的 kill-on-close Job，不能将其门槛失败归为 reader 丢弃存活后代；Unix bash receipt 还混入失败输出。详见设计第 16 节，第二轮先修 Windows 夹具并加强存活/TTY 断言。macOS 原始写入和 leader 控制组仍有诊断价值，但不再是产品选型的无条件前置。

职责澄清后，普通后代在实际主进程退出后的未来输出不属于默认持续服务承诺；“原断言失败”和“产品是否违规”必须分别判断。两轮 macOS 后代各六项失败继续保留，不证明真实 Agent 有同样缺陷，也不证明 macOS 产品收尾通过。Linux 主进程尾部、Windows 最终光标与 reader 资源问题不受影响，实际 CLI 启动器的生命周期是单独待验证项。阻塞重评和每项理由见设计第 18 节。

本阶段发现原源模型没有在途 read、decoder/异步队列和真实资源回执；取消不能直接等于 source end。新模型在取消生效后仍交付在途成功字节，独立 consumer 对账加固后两运行时各 25/25；实际 tracker 的最终应用通知也通过四项正/负对照。旧 Linux reader 实验的取消分支可能跳过在途回调数据和 decoder.end，这是实验升格的证明缺口，不是新复现业务缺陷。模型也不能证明尚未读取的 OS 缓冲尾部。

真实链路只有 Windows .cmd/.bat 会被 bridge 包 cmd /d /s /c，POSIX Agent 不由扩展另加运行 shell。本机 Codex npm JS 源码会等待 child，而旧 fake-provider 多是 exec；新增等待/非等待启动器对照补齐了这一层受控证据，不等于真实 provider 通过。首次启动诊断因错误要求 Linux spawn-helper 而在 spawn 前失败，0 个原生样本，已保留；12 s 进程内 timer 不能约束同步 probe 阻塞，外部 watchdog 与新增 fatal handler 故障注入仍缺。

## 决策记录

- 决策：下一步转native资源归属/释放的隔离受控验证，不能把仅替换JS reader选为完整修复。理由：macOS/Windows同进程资源积累在本轮直接复现，源EOF和driver退出仍可同时通过；Windows正readable分支另补，原失败不靠调阈值消除。日期/作者：2026-09-20 / Codex。

- 决策：本增量用独立新worker验证JS已拥有数据结算，另以同一driver内连续23次会话及OS资源计数验证有界增长。理由：旧Windows取消只销毁socket，旧driver自然退出不能证明跨会话无积累；不把候选局部取消夸大为系统缓冲完整排空，业务仍不改。日期/作者：2026-09-20 / Codex。

- 决策：本阶段以24项原生及完整复核收口Unix原位握手/独立gate的局部证据，将下一增量移至Windows在途取消和同进程长期资源，不继续重复旧helper矩阵。理由：这些前提已获得新有效证据，但旧失败不改判，短生命周期fixture不覆盖长驻资源或生产宿主；业务接入仍待方案选定。日期/作者：2026-09-20 / Codex。

- 决策：用原位只读观察替代子进程helper，独立控制循环负责回执/gate，增加受控held空read结果验证其独立性。理由：旧helper改变共享flags，单纯换启动参数或增加延时不能验证无侵入和推进保证；所有新场景先冻结，保留旧失败。日期/作者：2026-09-20 / Codex。

- 决策：本阶段以完整18项首次结果和12项flags控制收口，保留原矩阵验收解释无效的结论；下一次先冻结原位readiness与独立gate推进，不立即扩大本轮实验。理由：观察器启动副作用已在两平台证实，但旧回执竞态没有原始时间证据，产品reader/取消/资源选型仍需有效实验。日期/作者：2026-09-20 / Codex。

- 决策：先完成helper共享fd标志副作用的窄控制，暂停18项作为非阻塞reader验收依据，不立即重跑全取消矩阵。理由：只读helper正文不保证其Node/libuv启动无侵入，Linux绿色也不能排除共同风险；新原位inspect不启动持有受测fd的观察器。原样本精确因果仍须区分源码推断与native证据，不修改业务。日期/作者：2026-09-20 / Codex。

- 决策：用独立只读poll helper和实际成功read所有权冻结新18项，不拆小写入或提高原等待上限。理由：保留2048写请求而解除写回执与首读的循环等待，且避免以跨平台不可靠的FIONREAD输出计数代替原生证据；新n/2048-n分账契约独立于旧失败。日期/作者：2026-09-20 / Codex。

- 决策：以完整54项及原始写读轨迹收口本阶段，下一步先冻结可同时推进读写的取消握手，不改原取消失败或以控制组替代通过。理由：先等同步全量写完才读在目标macOS环境形成循环等待；需修夹具前提而非放宽数据/时间门槛，生产取消政策仍须独立设计。日期/作者：2026-09-20 / Codex。

- 决策：以新增修订版探针保留旧入口冻结，原21项门槛不降，追加无读/受控放行两类对照并记录原始写调用进度；不立即用较小预置数据试绿。理由：需要先定位2048-byte成功写入前提是否成立，控制组成功不能替代取消路径验收。日期/作者：2026-09-20 / Codex。

- 决策：本轮以新84项首次证据和失败归类收口，不修改冻结脚本或调参覆盖失败；macOS新探针问题先补最小前提控制组，Windows实际bridge主进程TAIL缺失作为独立产品反例保留。理由：9个macOS失败并非同一根因，取消甚至未进入read路径；局部候选通过不足以选定生产取消/资源方案。日期/作者：2026-09-20 / Codex。

- 决策：新原生阶段按 Unix 在途取消/系统残留与 Windows cmd/bat 等待链分工，84 项 runner 矩阵使用新文件和新 workflow。理由：避免改旧诊断取得绿色，也避免用模型、普通 pipes 或 POSIX 结果代替目标平台证据。Windows worker 在途取消与长驻资源仍为独立缺口，所有固定数值只作诊断预算。日期/作者：2026-09-20 / Codex。

- 决策：在修改业务前，先新增而非重写旧诊断，用可控 read/decoder/consumer/资源屏障和实际 bridge/tracker 对照验证候选顺序；取消请求和生效分开，已拥有数据不被取消意图清空。理由：旧模型不能证明在途数据保留，普通后代职责收窄也不豁免已有内容。生产取消条件、原生源结束证据、API/数值预算仍未选定。日期/作者：2026-09-20 / Codex。
- 决策：本阶段只跑受控 POSIX 启动器，不执行真实 Agent；记录本机真实入口的静态证据，并将 Windows cmd/npm shim 原生等待链另列下一阶段。理由：受控不等待负对照只能说明启动器契约需要验证，不能直接归因为真实 provider 缺陷；避免访问凭据和扩张普通后代承诺。日期/作者：2026-09-20 / Codex。
- 决策：按用户澄清将实际主进程退出后普通后代继续运行/产生未来输出列为底层诊断，不作为独立产品门槛；主进程尾部、已有内容、最终状态、资源释放和实际 Agent 启动链仍需验收，具体收尾/取消/预算仍待选定。理由：产品托管会话及终端资源，不逐个托管其内部后代；包装程序下的实际 CLI 是主体，不在排除项内。原实验和失败原样保留，撤销 macOS 后代控制实验的无条件前置地位，而非重判为通过。日期/作者：2026-09-20 / 用户确认，Codex 记录。
- 决策（历史优先级，已被上一条范围澄清取代）：保留两个失败的原生 job，不扩大期限或改 held 断言使其变绿；当时要求下一阶段先缩小终端所有者边界，再决定 reader/launcher 方案。理由：单纯换 reader 没有满足当时的跨平台后代假设，且“创建后代”和“后代实际持有可写终端”不是同一事实。保留失败原则继续有效。日期/作者：2026-09-20 / Codex。
- 决策：下一阶段使用基于 `origin/main@5965adb8` 的独立 `runtime-exit-integrity-native-candidates` 工作树推送诊断输入，不推送尚未完成的运行时历史。Unix 沿用固定 7 案例各 3 轮，对 macOS 只扩展平台和终端换行 oracle；Windows 对照 builtin/DLL 公共 reader 与 DLL 独立 worker，在运行前冻结案例和预算。诊断分支自带设计/计划，业务代码不改。日期/作者：2026-09-20 / Codex。

- 决策：runner 合并后先回归原重构并验证隔离收尾模型，生产接口仍不变。理由：三平台小样本内容通过不等于可信 EOF；Windows 首轮资源失败进一步表明源完成、读者结算与 provider 资源回收应分别证明。日期/作者：2026-09-20 / Codex。

- 决策：首轮比较同一 native PTY 的原 reader 与独占 fd 的异步候选，固定 3 轮、7 案例和两运行时后再执行。理由：分别验证读取终止和强制关闭机制，避免 npm 升级被误认为能替换宿主 libuv；内部 native 接口只作隔离可行性实验。日期/作者：2026-09-20 / Codex。
- 决策：优先继续验证受控 provider/adapter 与共享最终事件，不在两条业务路径各写一份 native 竞态归并；消费者应用结果单独结算。理由：这能同时覆盖 Supervisor/local Host 的共同假设，并避免把 source complete 和 reader close 混为一谈。它是候选推荐，不是已选定的库、生产轮询实现或 wire API。日期/作者：2026-09-20 / Codex。
- 决策：将退出完整性作为本次重构独立交付项，不再仅作为将来可能顺带解决的技术债。理由：源完整性问题独立于缓存、分页和历史保留，正常结束当前页面的保证仍必须满足。日期/作者：2026-09-20 / 用户确认，Codex 记录。
- 决策：此阶段只选定交付契约，具体实现保持比较中。理由：上游升级、provider/adapter 和事件模型尚需跨平台证据，不把认可目标写成认可某种实现。日期/作者：2026-09-20 / Codex。
- 决策：区分命令失败与输出失败、自然排空与主动取消，旧会话仍保留原绑定。理由：非零退出同样可能有重要错误尾部；兼容不能补造旧 provider 未提供的完整性保证。日期/作者：2026-09-20 / Codex。

## 结果与复盘

第28节已完成Windows局部所有权与三平台同进程资源首次验证，24个driver/150条真实会话完整留证；20个driver通过、macOS和Windows各两个资源失败，全部离线复核有效。资源增长不能被内容/自然退出成功掩盖；Windows正长度readable和句柄身份、macOS干预构建仍待验证。只新增诊断及文档，既有局部成功和历史失败均保留，未修改业务或选定生产方案。

历史第27节原位观察/独立gate增量完成本地、自校验及两平台24项原生/下载复核，Unix这组前提和局部取消所有权已验证；当时提出的Windows与同进程资源由第28节承接，首次两个诊断时间前提失败及旧18项解释不改，不将隔离诊断作为生产完成。

历史里程碑的可读性握手18项及窄控制12项均完整执行、下载复核。前者总run失败，后者在两平台实证helper启动会清共享O_NONBLOCK，使原矩阵不能用于非阻塞reader验收。当时提出的原位readiness/独立gate与新取消对照现已由第27节完成，旧失败不改判，生产方案仍未选定。

本次写入控制阶段新增本地27项和run35508235734两平台54项，完整下载复算，无工件错误。Ubuntu27/27、macOS21/27，总run失败：新暂停探针修复已验证，六个原取消仍因写读循环等待未进入待测路径；读放行控制定位了前提根因，不替代取消验收。下一步先冻结新取消握手，再继续Windows在途取消、同进程长驻资源和生产契约选型。旧入口/断言/失败不变，业务未修改，不宣布全平台或完整重构完成。

此前已承接模型阶段完成新原生84项及本地Linux三版各21项，完整保留首次失败。run35506150727中Linux21项达标，Windows候选21项达标且actual bridge受控cmd/bat主体等待/0与7传播有证据；基线主进程TAIL确实缺失、自然资源guard继续失败。macOS12项通过/9项失败，三项新诊断零长read误认EOF、六项2048-byte写入前提未成立的原结果不变，本次只用新实验定位。真实provider/信号/宿主/packaged及资源/API仍开放；旧两轮294项原始断言和失败不变，设计比较中/验证中、计划active，里程碑一和技术债均不关闭。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 是 node-pty 接入边界，输出回调表示已交付的数据，进程退出通知不天然等于输出排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 与 `finalizeSession()` 将已接收事件按每会话串行队列执行；admission 表示是否继续接受新事件。`src/panel/CanvasPanelManager.ts` 还直接管理 snapshot-only 的 Agent/Terminal 退出，两条路径都要纳入设计。

`src/common/runtimeSupervisorProtocol.ts` 负责 Supervisor 与 Host 的契约，`src/common/protocol.ts` 是 Host 与 Webview 的共享消息。`src/panel/runtimeTerminalReadRelay.ts` 与 `src/webview/terminalPagedProjection.ts` 管理读者、连续分页和终态呈现。revision 是已接收事件的位置，不是源进程预期输出的字节数。若需要修改这些接口，必须同时验证消费者和旧协议。

平台 provider 的现状见安装的 `node_modules/node-pty/lib/unixTerminal.js`、`windowsPtyAgent.js`、`windowsTerminal.js` 和 native 源码。已有证据位于 `docs/design-docs/runtime-terminal-tail-diagnosis.md`、`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md`；固定版本来源已在文档摘录，不要求接手者依赖本机 `.debug/` 才理解问题。不能直接编辑 node_modules 作为生产修复。

## 工作计划

第28节增量已完整执行。下一阶段先冻结macOS退出监听kqueue生命周期的隔离干预构建，以及Windows+2句柄的类型/身份和创建回收边界，不能预设其唯一来自HPCON；再补Windows取消时readableLength实际大于0的控制，继续分别核对已拥有数据与消费者应用。实验只在隔离构建，不改业务或依赖安装树；须用新证据选定native资源与reader共同的生产生命周期，不能仅以源EOF/JS关闭宣布完成。

历史第27节的两平台flags/gate/取消分账前提已达成，其后Windows局部所有权及同进程计数由第28节完成；macOS/Windows新资源失败不能被旧单次退出通过覆盖。不能以每样本退出进程掩盖长期增长，也不能把Unix协议直接外推ConPTY；生产选型依然开放。

上一阶段第26节提出的原位readiness、flags和独立gate协议现已由第27节新矩阵验证，不再作为当前待冻结项。旧18项不恢复验收资格，产品尾部/资源与Windows开放项不变；不以fd3/dup或静默恢复flags冒充已确认生产修复。

### 里程碑一：选定可验证的契约与实现

先在 `docs/design-docs/runtime-exit-integrity.md` 明确实际会话主进程退出、真正源输出结束、消费者应用完成、结束原因和取消策略，比较 adapter 聚合最终事件与上层显式事件两种路线。设计应说明如何收齐主进程已写尾部及自身已接收/排队/消费内容、如何应用最终状态和释放 reader 资源；不承诺等待普通后代未来输出，也不能把这种范围收窄实现为主进程退出即丢弃队列。列出现有上游修正是否进入实际 VS Code/Electron、是否仍有 Unix/Windows timer，以及自维护实现的 native 打包和平台成本；没有证据前不指定库版本或新增字段。

单独核查实际支持的 Agent 启动路径，记录直接 CLI 或 shell/cmd.exe/启动器的进程身份与退出时序，验证包装程序何时能够代表实际 CLI 生命周期。受控启动器夹具与真实 provider 分开留证，不能由通用后代实验推断真实 Agent 已有缺陷或无缺陷。将新产品矩阵与旧诊断矩阵分开命名、运行前冻结，保留所有旧断言和工件；macOS 后代控制实验仅在其能回答产品收尾或底层行为问题时继续，不再作为必须支持普通后代续跑的选型前置。

建立 Linux/macOS/Windows 原生 runner 和版本清单，Remote SSH 按实际执行端平台记录；冻结重复次数、并发负载、退出等待与事件循环预算、失败工件目录及首次失败保留规则。原生环境不足时可以继续局部候选实验，但不能关闭本里程碑或宣称未测平台健康。候选验证应在隔离构建中进行，不接入真实用户会话，不能把故障注入统计当成自然发生率。退出条件是正式设计选定实现、精确模块/API 和各平台失败语义，已复现缺陷路径有旧实现失败/候选通过的直接对照；尚未复现或作为对照的路径按冻结矩阵验证并保留未复现结论，不要求人为制造旧版本失败。

### 里程碑二：实施共享源边界和生命周期

方案选定后再按设计更改 `executionSessionBridge.ts` 及所需 provider 适配，补可信排空或明确中断信息，处理主进程尾部、Unicode/ANSI、背压、已有数据收尾及取消，不阻塞输入回路，不增加后代逐个托管。随后分别接入 Supervisor 与 Host local finalize；按需要更新共同协议、relay 和 Webview 收尾，使源完成与消费者完成对齐，不提前销毁仍有效读者来源。具体改动文件以里程碑一批准的设计为准，不预设每个模块都必须改。

新会话获得新的已验证契约，旧会话沿用原 backend/storage/session/generation。设计明确 capability/version 和旧客户端降级，不能强制迁移/重启 live 进程或给旧版本补造能力。每批变更独立回归，避免混入容量模型替换、completed 归档或 root 归属。退出条件是两种模式、两类节点的代码路径都接通且定向自动化覆盖，不是只通过 Linux reader 实验。

### 里程碑三：原生端到端验收与关闭

运行设计第 5 节产品矩阵：自然零/非零退出、严格 90000 行、慢消费、UTF-8/ANSI 分片、主进程运行中收到的后代输出、实际 Agent 启动链、停止/强制停止、删除、多读者/生命周期变化、新旧版本共存、最终终端状态、资源回收和重开无历史。保留主进程写入凭证，逐层核对 raw、bridge、journal 或状态、分页与实际 xterm；Windows VT 转换按终端语义对照，不强求 POSIX 原始字节相等。实际主进程退出后普通后代延迟写入/持有 slave 的旧诊断单独报告，不能将其失败换算为产品失败或通过。

在原生 Linux/macOS/Windows、实际 Node 与 VS Code/Electron 上分别记录结果，fake-provider 与真实 Agent provider 分开。完整运行相关自动化和 packaged smoke，失败不能靠放宽 90000 行断言、增长等待、重跑到成功或把退出改为“未知”收口。剩余问题需明确修复或经用户确认的范围调整；不能把“环境不具备”写成通过。全部达标后再更新设计状态和技术债、归档本计划。

## 具体步骤

本轮复核在独立工作树执行 `node scripts/diagnostics/diagnose-runtime-owned-lifecycle.mjs --verify-saved .debug/github-owned-lifecycle-35519226627-ubuntu/owned-lifecycle-evidence`，预期4项有效/无失败/exit0；换macos为4项有效、两个native资源失败/exit1，换windows为16项有效、两个native资源失败/exit1，均无evidenceErrors。可用NODE_PATH指向相同锁文件依赖；不以预期exit1为由重跑试绿。下一阶段先冻结资源归属/正缓冲协议，不改本次输入。以下旧步骤只作历史复核入口，当前下一步以工作计划首段为准；仅推独立诊断分支，不推运行时历史。

当前可在独立工作树运行 `node scripts/diagnostics/diagnose-unix-inplace-cancel.mjs --verify-saved .debug/github-inplace-cancel-35516170917-macos/inplace-cancel-evidence`，预期12项有效/无失败/exit0；换为 `github-inplace-cancel-35516170917-ubuntu-retry1` 同样通过。依赖未安装时先按锁文件安装，或本地设置NODE_PATH指向相同锁文件主工作树的node_modules。重跑原生只用新输出目录，不能覆盖v1/v2/v3或下载工件。下一阶段先写Windows在途取消/长驻资源协议，不直接复用Unix结果宣称通过。

历史证据在独立 `runtime-exit-integrity-native-candidates` 工作树复核：`node scripts/diagnostics/diagnose-unix-cancel-handshake.mjs --verify-saved .debug/github-cancel-handshake-35510798036-macos/cancel-handshake-evidence` 应全9项有效、control-3失败/exit1；`node scripts/diagnostics/diagnose-unix-helper-fd-flags.mjs --verify-saved .debug/github-helper-fd-flags-35511736807-macos/helper-fd-flags-evidence` 应全6项有效、无失败/exit0。将macos换成ubuntu，分别应9项/6项无失败；这些均是离线审计，不是新原生样本。以下旧阶段步骤保留当时安排，只作历史重跑入口，必须使用新目录且不得覆盖首次工件；当前下一步以本节首段为准，不由历史安排擅自选择生产方案。

本阶段在独立工作树按候选设计第15节执行 `node scripts/diagnostics/diagnose-unix-cancel-handshake.mjs --self-test`、`--output .debug/unix-cancel-handshake-v1-local` 和对应 `--verify-saved`，helper随新入口在工件目录编译，Linux需gcc、macOS需clang。新专用workflow仅两平台各9项，先本地完整验证与只读审查再推送运行；禁止改旧入口、筛选成功案例或推未完成运行时历史。源码/构建/原始字节及所有失败都留证，结果后续写入第25节。

最新阶段已完成，设计第24节承接独立分支设计第14节。独立工作树根执行 `node scripts/diagnostics/diagnose-unix-exit-tail-v2.mjs --verify-saved .debug/github-write-control-35508235734-ubuntu/write-control-evidence` 预期27项有效/无失败/exit0；将ubuntu换成macos预期27项有效/六个原取消failure/exit1，均无evidenceErrors。后续先在独立分支冻结无循环等待的取消握手，明确实际read/回调所有权、候选与audit分账及最终成功写回执；不改旧入口/原失败，不推运行时历史，也不直接把控制组结果接入业务。

本次写入前提阶段在独立工作树使用 `node scripts/diagnostics/diagnose-unix-exit-tail-v2.mjs --self-test`、`--output NEW_DIR` 和 `--verify-saved DIR`；各27项，专用workflow只跑Linux/macOS，不改旧84项入口。运行前协议见本设计第24节及独立候选设计第13节；成功回执缺失作为失败事实复核，整体仍返回非零，并检查完其余样本。原工件不能覆盖，原取消六项不能改标成功。

本次进入设计第 22 节的新原生阶段，在独立 `runtime-exit-integrity-native-candidates` 工作树按其自包含 active 计划执行。Unix 用 `node scripts/diagnostics/diagnose-unix-exit-tail.mjs --output .debug/unix-exit-tail-v1-local`，Windows runner 用 `node scripts/diagnostics/diagnose-windows-launch-tail.mjs --output exit-tail-evidence`；先语法和 `--self-test`、后完整固定 schedule、最后 `--verify-saved`。GitHub 三平台全量 84 项，首次失败保留，不触碰旧脚本或业务；仅推送独立诊断分支。

上述首轮已执行，结果/源hash/工件在设计第23节；重跑不得再用已有目录。Ubuntu和Windows原验证器下载后完整复算通过；macOS原验证器遇缺回执提前失败，补充审计使用 `node .debug/mac-exit-tail-35506150727-supplemental-audit/audit.mjs` 从独立工作树根运行，成功只说明完整工件对账，报告仍保留9个原生失败。当时安排的正容量read修订和write-enter/returned/errno、无读取与受控放行两组现已完成，结果见第24节；本轮之后的步骤以本节开头为准，不重跑旧实验期待绿色。

最新原生候选在独立 `runtime-exit-integrity-native-candidates` 工作树执行，不要求把当前运行时历史推到 GitHub。首轮输入 `afb24974`，修订 Windows Job 夹具的第二轮输入 `4ac3ad15`；复核入口为该分支 `compare-runtime-exit-readers.mjs --verify-saved DIR` 和 `compare-windows-exit-readers.mjs --verify-saved DIR`。Unix 验证器遇已保存的候选失败会非零，另对完整 schedule/全部 raw 哈希核对，不能跳过其余工件。第一轮下载目录在独立工作树 `.debug/github-candidates-35498026812-{ubuntu,macos,windows}/`，不要覆盖。若继续 macOS 原始 write 与 leader 诊断，应先冻结新实验，不改既有首轮判定；Windows 后代诊断仍须证明真实后代在主进程回调时存活且 stdout 为 TTY，但不以此替代实际 Agent 启动链证据。

本阶段从 `92ddb48f` 继续设计第 19 节的隔离验证：新增取消/在途 read/decoder/已接受队列/资源屏障模型及诊断入口，另用真实 bridge 隔离构建运行直接主体、shell exec、Node 等待启动器和不等待负对照。每种 POSIX 启动路径固定 3 次，Node 25 与 Electron-as-Node 39 各 12 项；每项采集/清理/硬截止为 8/2/12 s，正对照放行前观察至少 100 ms，这些不是生产预算。模型确定性用例各一次，运行前保存完整 schedule。新输出目录保留全部失败，不修改业务、原模型/实验/断言或历史结果；Windows 和真实 provider 的原生验证不由本轮替代。

本阶段已完成，结果和限制见设计第 20–21 节。下一次重跑使用不存在的新目录；以下 `next` 路径只作可执行重跑入口，成功也不代表完整生产验收。实际完成的目录名和首次预检失败均记录在设计中。每条命令也可加 `env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code` 替换开头 `node`，同时换输出目录，验证内置 Node 路径；这不是实际 VS Code UI。启动链的 12 s 当前只是进程内 timer，不具有阻塞同步 probe 时的独立硬上界。

    node --check scripts/diagnostics/runtime-exit-barrier-model.mjs
    node --check scripts/diagnostics/diagnose-runtime-exit-barriers.mjs
    node --check scripts/diagnostics/diagnose-terminal-final-apply.mjs
    node --check scripts/diagnostics/diagnose-agent-launch-lifecycle.mjs
    node scripts/diagnostics/diagnose-runtime-exit-barriers.mjs --output .debug/exit-barriers-next-node25
    node scripts/diagnostics/diagnose-terminal-final-apply.mjs --output .debug/terminal-final-apply-next-node25
    node scripts/diagnostics/diagnose-agent-launch-lifecycle.mjs --output .debug/agent-launch-next-node25
    node scripts/diagnostics/diagnose-agent-launch-lifecycle.mjs --verify-saved .debug/agent-launch-v2-node25

旧模型/runner/reader 的命令与记录继续保留，不能将其后代门槛改成新产品门槛。下一阶段先在独立诊断分支冻结原生收尾和 Windows 实际启动链矩阵，再执行跨平台候选，不推送未完成运行时历史。

runner 合入后的本轮先运行 `npm run typecheck`、`npm run test:execution-session-bridge`、`npm run test:terminal-session-journal` 和 `npm run test:runtime-supervisor-protocol`。新增 `scripts/diagnostics/runtime-exit-contract-model.mjs` 与 `scripts/diagnostics/diagnose-runtime-exit-contract.mjs`，只运行内存模型与实际分页投影类，不创建 PTY 或修改业务模块。运行前固定源事件排列、重复/违约、UTF-8 解码尾片、stop/取消/读取错误/旧能力、读者身份/最终位置/在途 open/双读者结算及实际投影完成/取消对照；每个确定性用例执行一次，不以反复随机运行筛选成功。`--output` 必须是新目录，保存每项结果、断言错误、脚本/实际投影哈希与运行环境。模型不引入生产超时，资源/等待预算仍由平台候选阶段选定。

    node --check scripts/diagnostics/runtime-exit-contract-model.mjs
    node --check scripts/diagnostics/diagnose-runtime-exit-contract.mjs
    node scripts/diagnostics/diagnose-runtime-exit-contract.mjs --output .debug/exit-contract-v1-node25

同组确定性测试也用缓存 VS Code 1.117.0 的 `ELECTRON_RUN_AS_NODE=1` 执行，输出改为 `.debug/exit-contract-v1-electron39`。两个目录均已使用，后续须换新名。`diagnose-runtime-exit-admission.mjs` 保留 11 项旧特征，追加 Agent/Terminal 各 3 个源模型 final 注入实际 Supervisor 的用例，不更改运行时文件。分别运行普通 Node 和 Electron-as-Node，将完整 JSON 输出保存到新的 `.debug/exit-admission-contract-*.json`；本轮两个 v1 文件已存在，不能覆盖。真实 Supervisor 类在隔离内存构建中使用 fake process，仍不是原生 provider 或完整 Host 集成。

现有原生入口 `scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs` 及托管 workflow 按已合并设计保持不变，不在本轮把基线门槛改成候选验收。

本阶段新增工具从仓库根运行，固定 7 个案例、每 reader 每案例 3 轮，不提供调小轮次的选项。输出目录必须不存在，包含 raw、每轮退出轨迹、writer receipt、总表和环境指纹。候选未达预期则进程返回非零，原 reader 的反例仍保留；候选 held 场景通过表示明确取消，不是排空成功。

    node --check scripts/diagnostics/compare-runtime-exit-readers.mjs
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --self-test
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --output .debug/exit-integrity-reader-v1-node25
    env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/compare-runtime-exit-readers.mjs --output .debug/exit-integrity-reader-v1-electron39
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --verify-saved .debug/exit-integrity-reader-v1-node25
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --verify-saved .debug/exit-integrity-reader-v1-electron39

上述 v1 目录已用于首轮，重跑应更换目录名。诊断加固后的回归使用相同命令和参数，目录改为 v2；不覆盖或删除 v1 的失败。`--verify-saved` 只重新核对已有内容/哈希和候选门槛，不创建 PTY、不生成新的平台实测证据。样本在 30 s 发起清理，32 s 独立硬截止保存未完成工件并退出；这是测试防挂起，不是产品 drain 期限。工具只允许 Linux，尚不能在其他平台运行并宣称完成原生验收。

当前可从仓库根复核既有特征诊断，依赖已安装，命令如下。它们含预期缺失反例，exit 0 不是产品完整性通过。Linux 工具 output 必须是新目录；Windows JS 脚本在 Linux 执行也不等于原生 ConPTY。

    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --self-test
    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 350 --writer-receipt --probe-before-destroy --output .debug/exit-integrity-baseline-unique
    node scripts/diagnostics/diagnose-windows-pty-exit-contract.mjs
    node scripts/diagnostics/diagnose-runtime-exit-admission.mjs

后续 baseline/候选各使用独立目录，记录版本、提交、启动命令、环境和首次失败。在里程碑一将原生启动命令、冻结的轮次和预算回写本节。实施后至少运行以下现有回归入口；新 reader/契约原生测试须随所选实现另行加入，不把这些已有脚本当成充分矩阵。

    npm run typecheck
    npm run test:execution-session-bridge
    npm run test:runtime-supervisor-protocol
    npm run test:terminal-session-journal
    npm run test:smoke
    npm run test:webview
    npm run test:vsix-smoke

全量套件如有已登记的基线阻断，保留首错并解释隔离验证覆盖和残余缺口，不伪称全量通过。任何 native 或发布依赖调整都在方案中明确，不能顺手升级整个工具链。

## 验证与验收

交付以 `docs/design-docs/runtime-exit-integrity.md` 第 5、18 节和规格第 10 节为准。需要证明主进程尾部与已有内容完整、最终状态正确、资源释放，并证明取消/强制截断不会冒充完整 EOF；实际 CLI 启动链需另行验证。原生产品矩阵每格均有可复核证据和明确结果，未执行即未完成；普通后代诊断保留旧失败，不单独阻塞交付，也不增加产品通过计数。当前方案阶段验证独立诊断及 YAML/索引/本地引用、git diff 范围和计划状态；相对 `a5112fb5`，只允许诊断和文档变化，不把它们冒充 Host/Webview 或业务修复验收。

## 幂等性与恢复

候选试验不得修改用户 storage 或替换仍承载 live 会话的 Supervisor；仅控制本次创建的 fixture。证据目录唯一，不覆盖初次失败。生产方案需要可回滚的 capability/adapter 选择和旧 session 原绑定保留，回滚不得伪造完整性或强制迁移。取消和回收必须幂等，不因重试重复输出、重复终态或误删其他读者。

## 证据与备注

2026-09-20 本阶段结果：屏障模型 Node/Electron 首轮各 25 项，加固独立 consumer 对账后各 25 项，共 100 项模型检查；实际 tracker 首轮及拒绝捕获加固后各 4 项，共 16 项；启动链两组各 12 项，共 24 个原生 POSIX fixture，其中 6 个是故意不等待的负对照。原契约回归两组各 39 项，bridge/tracker 现有测试通过。模型、headless、裸 PTY 和离线 verifier 分开计数，不合成全平台产品通过率。全量 raw/schedule/trace/hash 保留；Windows/macOS、真实 Agent、UI/packaged 未执行。首次 Linux spawn-helper 预检失败没有原生样本，后续成功不覆盖它；启动链 fatal handler 新增但未故障注入，独立进程 watchdog 仍未实现。

收口校验：相对 `92ddb48f` 仅 5 份文档和 4 个新诊断文件变化，4 个新文件 `node --check` 通过；YAML、索引、架构标签、关联路径和 7 处新增完整本地引用可解析，5 项生产选型/实施/验收任务仍未勾选。全部模型/应用工件的 schedule、结果计数及对应源码 snapshot 哈希逐项复核；两组启动链复算均 12 项、无 live/zombie 残留。`git diff --check` 通过。独立复审发现的拒绝捕获、consumer 对账和 verifier 非零判定已加固，不覆盖首次证据；其余原生/生产限制继续记录。

2026-09-20 职责澄清检查：相对 `cab496e2` 仅 10 份文档变化，`git diff --check` 通过；4 份设计的 YAML 元数据、标题、架构标签、索引状态及关联路径均校验，25 处新增完整本地文档引用可解析。主设计第 7 节除新增范围注记外冻结协议逐字不变，第 8、13–16 节逐字不变，第 17 节只标注旧优先级被替代，原结果不变。计划仍 active，5 项生产选型/实施/验收任务未完成；业务、脚本、旧测试、workflow、依赖和原始工件未修改，未运行新原生或业务验证。独立诊断分支同步提交 `bb39c7a5` 也仅改 5 份文档，本地保留、未推送；不能把本次文档检查视为缺陷修复证据。

2026-09-20 原生候选阶段：main-based 独立分支两轮各 147 项，本地 Linux 另 42 项。全部六份远端工件下载并核对 schedule/raw 哈希，Windows 两轮各 63 项内容/光标离线复算分别保留 6/0 个候选失败；第二轮 builtin 成功写入但已关闭 reader 的后代反例已确认。文档元数据/索引/related paths、workflow 权限/分支范围与 whitespace 检查通过。主重构分支本阶段只有文档变化，业务与旧 live 绑定不改；未执行全量 UI、真实 provider、packaged 或新增业务集成测试。两份相关计划均保持 active；当时的“下一步 macOS 控制实验”优先级已由本次职责澄清取代，不将 run 失败隐藏为全部通过。

已有自然样本在 EOF 后可补读 313/2235/251 字节而恢复全部 90000 行；另一机制在 Unix timer destroy 时同时保有 JS 和 fd 数据。Windows JS/真实 TCP reader 与公共 Supervisor 夹具只说明条件性行为；没有 macOS/Windows 原生修复证据。完整记录在两轮诊断文档，不在本次立项中重复将它们标为验收通过。

2026-09-20 立项检查：本次 8 份文档中的 3 份设计 frontmatter 使用 YAML parser 校验，标题、架构域/层、状态、日期及索引一致；新增本地引用均可解析，计划中的 npm 命令均存在。规格保持草案，独立范围已确认；计划保持 active，5 项选型/实施/验收任务未勾选。`git diff --check` 通过，相对 `388ec2b3` 的 `extensions`、`scripts`、`tests` 和 package 文件无改动。本次未运行运行时测试，不将文档校验视为缺陷修复证据。

2026-09-20 方案阶段检查：新增诊断在 Node 25 与 Electron-as-Node 39 的首轮和加固回归中各执行完整 42 项，共 168 项；候选 72 次完整、12 次明确取消。原 reader 12 次成功写入后缺尾与 12 次后代写入失败分别留存，未重新归因为全部 HUP。脚本语法、自校验、四组保存结果复核及实际 PGID 无残留检查通过。未运行实际 Host/Webview、真实 Agent、packaged 或其他 OS；不声称运行时回归或原生平台矩阵通过。

本阶段 6 个文件仅包含 5 份文档与 1 个独立诊断；设计 YAML/索引、架构标签、本地引用和 `git diff --check` 已校验。相对 `a5112fb5` 的 `extensions`、现有 `tests`、package/lockfile 无变化；计划仍 active，5 项生产选型、原生验证、实施与交付收口任务保持未完成。

2026-09-20 runner 合并后的验证：`typecheck`、`build`、bridge、journal 和 Supervisor 聚合回归全部通过；聚合包含 checkpoint refresh、分页投影、无 completed 历史和退出分页。Node 25.6.0 与 Electron-as-Node 39.8.7 各 39 项契约模型、17 项实际 Supervisor 注入通过，输出目录/哈希及局限见设计第 14 节。没有运行全量 UI、真实 provider、packaged 或新的原生候选矩阵；相对 `28055e13` 不修改业务、既有测试、依赖或 workflow。

## 接口与依赖

本次不新增业务类型、协议字段、依赖或业务模块；独立诊断直接加载现有 native fork，仅用于创建全新 fixture。新增 `runtime-exit-barrier-model.mjs` 的 `ExitBarrierModel` 使用 `beginRead/completeRead`、`requestCancel/applyCancel`、`processExit` 与异步 `releaseResources`，仅用于注入顺序验证，不是拟定生产 API；其退役判断不包含轻量保存、journal 删除与旧 RPC，整数 exitCode 也不涵盖 signal-only/native wait 错误。契约提案要求 provider 分开 process result/source end，共享 adapter 只发一次最终事件，并区分各读者 applied/cancelled/lost。具体命名、扩展 close receipt 还是独立 ACK、native 构建路径与旧版本能力协商仍未选定。里程碑一结束必须把精确类型/签名、文件和失败语义回写本节及正式设计；不能仅凭局部 reader 或模型通过直接成为生产默认路径。

修订记录：2026-09-20 根据用户确认建立独立交付计划；范围与验收已登记，方案选择、业务实施和原生平台验收仍待推进。

修订记录：2026-09-20 进入方案阶段，新增冻结的候选对照、运行证据、三事实收尾契约提案与平台/宿主缺口；保留所有首轮失败并加固诊断，不将 Linux 可行性扩大为全平台方案已选定。

修订记录：2026-09-20 runner PR #294 合入后回到正式重构分支，记录 rebase 基线、三平台证据承接及隔离契约验证范围；本轮不修改业务 reader、wire API 或运行时归属。

修订记录：2026-09-20 完成 rebase 回归和两种运行时的隔离契约/实际 Supervisor 注入验证，记录旧 close 的实测歧义与候选收尾结果；下一步仍为跨平台 reader/资源候选选型，不把模型成功计为生产集成。

修订记录：2026-09-20 根据用户侧对话结论，收窄实际主进程退出后普通后代的持续服务范围；同步产品、设计与阻塞判断，保留尾部/最终状态/资源/启动链义务，撤销 macOS 后代诊断的无条件选型前置。历史协议、脚本、断言和失败不改，具体收尾与预算仍待确认，计划继续 active。

修订记录：2026-09-20 进入职责澄清后的下一阶段，运行前冻结收尾屏障模型与 POSIX 启动链正/负对照；所有新增实现仅为隔离诊断，生产取消/收尾方案和跨平台选型仍待验证。

修订记录：2026-09-20 完成本阶段屏障、真实 tracker 和 POSIX 启动链验证，补独立 consumer 对账、诊断拒绝捕获及保存结果非零判定；保留首次预检失败和原始源码/结果，记录同步阻塞 watchdog 与原生/真实 provider 缺口。下一步转原生取消/尾部/资源与 Windows 启动链验证，不修改业务或宣布选型完成。

修订记录：2026-09-20 完成独立诊断分支新84项及本地三版Unix采样，记录Windows受控启动链/主进程TAIL缺失、Unix在途与系统残留分账、macOS探针假EOF和取消前提未成立；保留首次失败与补充审计，下一步修诊断并以最小写入控制组补证，不选定生产实现或取消预算。

修订记录：2026-09-20 冻结并实施写入前提控制阶段，新增修订版入口保留旧脚本，本地27项与完整失败工件验证已完成，推进两平台54项；未选择生产reader、取消条件或预算。

修订记录：2026-09-20 完成54项原生控制和完整离线复核，定位macOS夹具的写读循环等待，新探针暂停/失败复核已验证；保留六个原取消失败和调用级证据边界，将无循环等待握手、Windows在途取消和长驻资源移交后续，不选定生产政策或关闭计划。

修订记录：2026-09-20 冻结并进入可读性握手阶段，用不消费数据的poll观察解除全量写回执先于首读的循环等待，新增18项窄矩阵并严格区分实际read所有权/audit/最终回执；业务与旧实验仍不变。

修订记录：2026-09-20 完成18项首次运行及完整复核，记录macOS收齐后挂起和两平台helper启动链共享flags风险；暂停整轮非阻塞reader验收解释，冻结12项原位标志控制，保留所有旧结果，不将诊断缺陷冒称产品根因。

修订记录：2026-09-20 完成12项两平台原生flags控制及完整下载复核，共享O_NONBLOCK副作用已有两平台直接证据；同步源码/观测/历史因果的限制，将原位readiness和独立gate推进留待新协议，旧失败不变、业务未改、计划仍active。

修订记录：2026-09-20 冻结并完成原位观察/独立gate新24项原生及全工件复核；保留本地首次两个不足100ms的失败，修正诊断按单调截止点执行而不放宽门槛。Unix这组局部证据已建立，下一阶段转Windows在途取消与同进程长期资源，生产方案及总交付仍未完成。

修订记录：2026-09-20 按第28节先冻结Windows12项所有权及三平台同进程3预热/20测量资源对照，明确已拥有数据不等于系统缓冲、资源计数不被driver退出掩盖；本轮仍只诊断与设计。

修订记录：2026-09-20 完成本地和三平台首次运行及全工件复核，Windows局部所有权通过，macOS每会话+1 kqueue/Windows+2句柄已有实证；保留四个资源失败及正readable未覆盖边界。下一步转native资源归属与隔离生命周期干预，不直接改业务，整体退出完整性交付未完成。
