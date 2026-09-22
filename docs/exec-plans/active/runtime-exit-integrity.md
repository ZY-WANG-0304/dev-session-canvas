# 交付跨平台执行会话退出完整性

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖设计、实施和验收。2026-09-20 用户确认“退出完整性”属于本次 Runtime Persistence 重构的独立交付项。立项基线为 `388ec2b3`，方案阶段基线为 `a5112fb5`；PR #294 合并后，13 个重构提交已 rebase 至 `origin/main@5965adb8`，当前原生收尾阶段基线为 `10d40e63`。本阶段只做设计与隔离诊断，不直接修改业务代码，不推送运行时分支。后续实施开始前必须先选定方案并更新正式设计，不把本计划视为私有 fd 补读或某种新 API 的授权。

本阶段所有新D3/D4/v2脚本、workflow及.debug工件仅在独立工作树 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates`，本树只同步文档。以下本地“未提交工作树”均指采集时的诊断源码快照，不是本运行时树；v1后来冻结7141cfa3，v2后来冻结b4db41cc，不倒写采集时来源。当前协议、已完成验证和剩余阻塞项见本计划各节首段，后续历史段落的“下一步”不覆盖最新顺序。

## 目标与全局图景

用户在 Agent/Terminal 自然结束时，当前有效终端页面收到完整、按序的主进程尾部，即使程序返回非零退出码；自身已接收、排队或消费中的内容不能因提前清理而丢弃，最终终端状态正确应用并释放资源。尾部保证从主进程成功写入终端的数据开始，不包含程序自身尚未 flush 的应用缓冲，也不补造生产者未写出的 UTF-8/控制序列内容。主进程退出、真实输出结束、页面完成应用和主动取消必须区分；不能把固定等待、socket close 或最终 revision 当作全部输出已交付，也不能将超时/截断标成完整 EOF。不用把正常结束全部降级为中断来掩盖缺失。

2026-09-20 用户进一步确认：画板只管理 Terminal/Agent 执行会话及其终端资源，不逐个托管、追踪或恢复后代。Terminal 内部子进程/命令/后台任务由 shell、应用和操作系统管理，Agent 工具后代由 Agent 管理；实际主进程退出后，不默认保持节点或终端等待普通后代结束或接收其未来输出。主进程仍运行时，同一终端收到的输出不能按后代来源过滤。父子关系不等于前后台关系，通用后代实验不自动等于交互 shell 后台作业或真实 Agent 缺陷。

启动链另行验证：`Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` 中实际 CLI 是会话主体，不能按工具后代排除，也不能未经证明把包装程序退出当作 Agent 结束。具体收尾边界、取消条件和时间预算仍未选定。此澄清撤销“必须先满足 macOS 普通后代持续输出门槛才能选型”的优先级，不改变历史实验、断言、失败和工件，亦不将 macOS 标为已验收。

范围包含 Linux/macOS/Windows、Agent/Terminal，以及由 Supervisor 托管的 live-runtime 和直接由 Host 托管的 snapshot-only。结束后 Runtime 重开仍不恢复进程或历史，Supervisor/机器故障后仍无需恢复；F-03 root 归属、F-04 容量整体模型和 F-05 已取消的历史归档不在此项顺手改造。不必等待其他重构完成，但本项未通过验收前不得宣称本次重构的退出完整性已经完成。

## 进度

- [x] (2026-09-22) 完成下一版诊断结算契约设计与运行前矩阵冻结，新增 `docs/design-docs/runtime-diagnostic-settlement-contract.md`。D3进程/时钟、writer/封存和D4身份重放的三侧源码/协议复审建议已纳入；三侧最终静态复审及两树文档一致性检查通过，本阶段零新测试、零native，旧入口/工件与业务不改。
- [ ] 按新设计在独立诊断树实现D3 v3/D4 v2、本地固定fixture/source hash与独立源码复审；每runner36主控+2gate+4publisher、16模型均尚未执行。
- [ ] 本地门槛收口后，以固定新commit唯一一次三平台完整采集、全工件下载与可信Git oracle重放；W1/U1仍须等待这些诊断门槛，不因设计冻结启动。
- [x] (2026-09-22) 完成三侧最终静态复审与两树元数据/索引/路径/历史保持/一致性/diff检查；每树8份文档、4份设计元数据、12个计划章节，旧业务/脚本/workflow不变。只验文档，不计新矩阵或产品通过。
- [x] (2026-09-22) 完成Windows/Unix/工具三侧源码核查与设计冻结，区分真实API、native替身、通知扣留、门控和模型；当时D3的72控制、D4的24逻辑模型及W1/U1的66driver尝试均未执行。实际v1每runner执行全部24项D4，三runner共72次模型，不能沿用逻辑计划数作执行总数。
- [x] (2026-09-22) 独立诊断树实施D3/D4四入口与foundation workflow，本地D3/D4各24及自测通过；7141cfa3的首次run35673511893与误触同SHA重复run35673550930均完整下载/复核并保留failure。两次完整D3均Linux/macOS24/24、Windows23/24，D4两run144次有限模型通过；Windows跨pipe误判与重复自测真实迟到分别登记，不是平台/产品缺陷结论。
- [x] (2026-09-22) D3 v2只窄修来源/顺序：发送端sequence/identity、真实通道/接收时间、4096完整帧限界、ACK后bulk和尾部连续缺口。新三脚本及专用D3 workflow仅在诊断树，v1/D4/业务/依赖不改；原缩放0.25/500ms及完整预算保留。
- [x] (2026-09-22) local-1 oracle78/parser8/positive24/full24保留；独立审计发现tamper实际attempted24/verified0，根manifest失败短路run.scale读取，自测未证明其余23有效。修正后local-2重放78/8/24/24、tamper24/23且仅shared-manifest与D3-01-1错误，最终语法/YAML/diff和独立输入/重放审计通过，采集仍绑定当时未提交快照。
- [x] (2026-09-22) b4db41cc唯一v2 run35676427931 attempt1完整下载与固定Git来源独立审计完成：三平台各full24/scaled24/oracle78/parser8，tamper24 attempted/23 verified且仅shared-manifest与首项拒绝；Windows full D3-01-1实际跨pipe倒序仍正确接受。未rerun/dispatch，不重跑v1/D4，本次零native，详见设计第44节。
- [ ] D3三独立settlement、deadline不可变首次快照、有界unconfirmed、独立evidence结算、writer完整协议/预算及D4完整独立重放/身份oracle继续开放，v2窄修正不关闭这些阻塞项。
- [ ] D3/D4收口后实施并验证W1/U1；其余通知/环境销毁、正缓冲取消、真实Close挂起与双会话隔离需第二批另冻，不宣称全部异常矩阵已冻结。
- [x] (2026-09-22) 承接主树f318579a/独立树7fb4ae9e的G07结果，开始原生异常与unknown owner有界隔离设计；按Windows、Unix和工具观察三个独立方向核查源码，不修改业务或旧输入。
- [x] (2026-09-22) 完成故障层级/owner处置候选比较、D3/D4/W1/U1第一批冻结及三侧独立复审；正式设计/索引/原则/债务同步。其余原生异常第二批未冻结，下一步实施新诊断而非业务接入。
- [ ] 下一新诊断补外层调用方await后与结算I/O预算观察；本轮outer-returned仅为resolve前事件，不能替代完整返回证明，不改旧工具/工件。guard九项调用方时间已另行补算通过。
- [x] (2026-09-22) 新C/JS/workflow已实现，v1合成21项保留，v2独立oracle27/27，零native；源码/协议/outer原始事件和语义负例复审已收口，JS/workflow/文档检查及主树bridge回归通过。详见生命周期契约第15节。
- [x] (2026-09-22) 固定cf359040/run35631266321 attempt1完成Windows/MSVC九项矩阵、完整ZIP下载、可信入口复算及836项独立raw检查；三个正例建立前提，六个负控按预期拒绝，原始分类保留。旧Windows G07三条仍not-established，详见契约第16节。
- [ ] 逐平台设计原生异常路径与unknown owner有界隔离，再冻结partial-create、wait/通知失败、取消/正长度缓冲、release失败/挂起及并发矩阵；不把新九项控制当产品退出完整性验收。
- [x] (2026-09-22) 承接Windows G07缺口，生命周期契约第14节冻结真实关闭/双fresh challenge的独立协议：close-wait、keep-open、close-exit各3次，零PTY，复用原guard-v2与原预算，不改历史输入。
- [x] (2026-09-22) 新C夹具、JS入口/独立校验和Windows-only workflow实施及合成自测/只读复审完成；首次原生九项和完整工件下载复核单列待办，未验证不宣称G07已补齐。
- [x] (2026-09-21) 独立输入d173c099的run35620967433 attempt1完整三平台运行，全部ZIP下载核对且两个原verifier离线复算完成；D1合计111模型通过，D2原72控制pass保留，原raw失败不改写。
- [x] (2026-09-22) 独立审计确认Windows G07三项未建立真实stdio提前关闭前提：固定libuv对标准fd的close返回成功但未关闭。记录官方调用链和原时序，保留其余69条控制依据、原工具结果和全部工件，不宣布D2整组验收。
- [x] (2026-09-22) Windows G07真实关闭stdio及独立主体存活协议已在契约第14节冻结；新输入实施/原生执行单列当前待办，缺口收口后才推进原生失败矩阵，不改旧脚本或重跑筛绿。
- [x] (2026-09-21) 独立诊断分支已实现D1/D2四个新文件、完整离线校验和三平台Node22.23.2 workflow。D1本地Node25/Electron39各37/37；D2新版Linux24/24控制通过，最长1952.428426ms，raw的超时/启动失败不改绿。
- [x] (2026-09-21) D1的Promise引用自证、D2的捕获错误、outer绝对5000ms截止和deadline完整性分类经独立审查修正；旧自测和local-first工件原样保留，新自测12类/25项通过。主树bridge、tracker、Supervisor聚合再次通过，主树仅文档。
- [x] (2026-09-21) 只读核查bridge、authority finalize、读者协议及平台候选，形成 `docs/design-docs/runtime-execution-lifecycle-contract.md`；新增类型/身份/偏序/错误和旧能力候选，不改业务或选择生产数值预算。
- [x] (2026-09-21) 冻结D1的24组37个独立模型子案例、D2三平台72条零PTY控制（54真实进程/启动控制、18synthetic），明确spawn前计时、一次返回、G04前提失败与无PID强杀；新入口尚待实现。
- [x] (2026-09-21) Windows、Unix/guard和authority/读者三份独立审查完成，修正terminated类型、未知补证、唯一序号、新open边界和各跳outcome；bridge/tracker/Supervisor聚合回归及原39项契约通过，不计为D1/D2通过。
- [x] (2026-09-21) 完成独立诊断输入推送、三平台首次矩阵及全工件下载复核；不改旧入口、不推主运行时分支。Windows G07前提缺口单列后续，不把执行完成当作全部验收通过。

- [x] (2026-09-21) 根据用户提醒核对Windows正常对象语义与HPCON最终释放契约，设计第31节先冻结无PTY的六driver/92child控制；既有资源失败与具体归属inconclusive不改判。
- [x] (2026-09-21) 新C/JS/workflow与独立只读审查完成，合成自测覆盖正常对象、错误计数/假退出/重复关闭/未释放/强杀、二进制绑定、活动owner槽位冲突及损坏/缺工件后继续；Linux仅验证工具逻辑。
- [x] (2026-09-21) cbbba096/run35560063334 attempt1完整执行六driver/92child/690快照并下载复核，MSVC编译成功，两个control通过、四个初始计数失败保留；正常保留/释放和退出后image31有原生证据，+5背景归属未知。
- [x] (2026-09-21) 按设计第33节冻结 Windows bundled-DLL 已知 HPCON owner 的三臂隔离释放协议：stock、owner-retain/no-close、owner-retain/explicit-close；builtin、业务和旧实验排除在本增量外。
- [x] (2026-09-21) 独立分支 e8740f53 / 7c29404e 实现候选 native transformer 和三臂入口；静态复审及本地 v1/v2 合成自测通过，最终覆盖真实 Release HRESULT、owner/EOF/consumer 缺前提、工件损坏后继续和有意资源失败。workflow 随固定输入 d0f0be88 推送。
- [x] (2026-09-21) d0f0be88/run35586906307 attempt1 完成全部 12 driver/138 PTY，完整下载并重算 ZIP/hash；原 verifier 12/12、四个 no-close 资源失败保留、无 evidenceErrors，未重跑试绿。
- [x] (2026-09-21) 实现前复核补充 stock API 隔离、两候选共用产物、实际 OpenConsole.exe 绑定、Release 的实际 HRESULT 签名和 native 单次 connect/退出失败门控；这些是新诊断的有效性要求，不是 Windows 产品缺陷结论。
- [x] (2026-09-21) 两份独立只读审计复核全部内容/EOF/消费、92 owner、46 单次 Close、1260 样本及 5739 个 manifest 成员；同一 rebuilt native 的 Close 消除逐会话 +2，未将正常引用存续当 OS bug 或声称旧句柄具体身份已闭合。
- [x] (2026-09-21) 记录诊断 guarded() 等待 child.close 的非硬预算缺口，独立 Linux 控制复现；本次 Windows 未触发，冻结入口和全部原结果不改。
- [x] (2026-09-21) 自然路径后的生命周期/失败契约与D1/D2冻结已完成，见新独立设计；只是候选提案，native异常/builtin/正readable/并发/实际宿主及生产接入继续开放。

- [x] (2026-09-21) 按设计第29节冻结macOS三arm最小close对照和Windows只读类型取证，保留原资源失败；正readable控制另列后续。
- [x] (2026-09-21) 新独立入口及两平台workflow、本地机械变换/合成负例/完整失败遍历和Linux隔离构建布局预检完成；补构建链接归档、跨平台路径及有效负结果分类。
- [x] (2026-09-21) 固定944fe103的run35527241793与仅修诊断C命名的5a7ed5c4/run35527528410，完整下载并离线复核。macOS两轮各138条PTY建立最小close因果证据；Windows首轮0PTY编译失败保留，次轮46条完整、逐会话File+Process增长已确认，具体归属仍inconclusive。

- [x] (2026-09-20) 按设计第28节承接Windows12项取消所有权与三平台同进程资源冻结协议；各driver3预热/20测量，与无PTY对照分开，业务不改。
- [x] (2026-09-20) 新诊断/worker/OS观察器/workflow完成，自测与Linux本地v1/v2各46条PTY通过；输入b031b598的run35519226627三平台首次运行完整复核，Windows12项局部所有权/自然对照通过，macOS/Windows各两个同进程资源组失败保留，无工件损坏。
- [x] (2026-09-20) 两工作树设计/计划/索引/原则/债务同步，元数据/引用/全部计划章节/diff与范围检查通过；核对Windows CRLF原始输入和全部cleanup/guard，bridge回归通过，业务/依赖/旧实验未改。
- [x] (2026-09-21) 历史后续项“已知 HPCON owner 隔离释放”已由设计第33–34节完成本轮验证；仅具体句柄身份仍 inconclusive，正长度 JS readable-buffer 和生产预算继续开放，不合并为全部验收完成。

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

新设计的源码复审确认：D3 v2的close后单一Promise、事后首报和writer sealed claim不足以满足独立结算；observer内写盘也不能隔离同步I/O。D4 v1的unknown状态可被release-in-flight覆盖，create失败可替换acquisition，完整身份/参数/操作账没有被独立重放。均为固定源码中的诊断缺口，不是本阶段新增原生或业务缺陷复现。

协议复审补充了exit与capture gate分离、等时先冻结deadline、错误sticky、共享helper预算、publisher不能自证本次发布成功，以及D4零资源失败not-required、completed操作复用优先级、batch应用token和逐subject未知补证。详细可实施约束以新设计为准；三侧最终静态复核已收口，不把设计收口写为测试通过。

v2唯一runner的Windows full D3-01-1确实再次出现fd3接收先于stdout，但source sequence/sentNs合法，新oracle正确接受；不是因为没有遇到乱序才绿。三平台raw均在原full2000/scaled500ms内，但只能说明本次事实，不能据此关闭writer预算自动核验债务或抹去v1真实迟到。完整输入/trace核验通过，native仍0，完整结算API及W1/U1未因此完成。

v1把stdout/fd3的观察到达顺序重包为caller源序号，Windows两run D3-01-1误判，Linux/macOS绿色不证明此风险不存在。重复Windows自测D3-07-1/08-1 after-await504.2253/543.014ms及writer554.9569/630.9223/608.3949ms超过原500ms，是真实迟到，不能由source排序修正；两次Windowspositive失败后没有最终self-test报告或tamper负例，不补造证据。

本地v2的local-1篡改负例仅断言总fail与首项错误，根manifest先抛错使run.scale未读取，后续23项不是有效验证，实际24 attempted/0 verified。local-2分开manifest和run读取，并要求24 attempted/23 verified且末项无错误，保存tampered-verification.json；原positive/full通过与local-1工件保留。D3-08还须在首overflow后永久拒绝后续bulk，避免较短帧再次进入造成零散源序缺口；ACK证据是observer fd3接收/fd4发送、首bulk与caller源码await控制流，没有独立caller ACK-received事件。

这些窄工具修正没有导出startObservedCase三独立Promise，也未实现不可变首次deadline观察或有界unconfirmed；writer非法帧可能被另一个sealed事实掩盖，与writer预算核验一同留待独立evidence settlement设计。D4有限场景通过不等于完整execution/generation身份重放或真实并发隔离。

本次只读核查确认两平台均有“资源已取得但后续初始化仍可失败”的窗口：Windows在CreateProcess成功后到hShell登记前先做DLL/Release，Unix主体/master创建后才设置nonblock并建立waiter。未知不只可能是未见返回，也可能未证API进入，或API已失败返回而部分副作用仍不明；故进入/返回证据和资源处置必须分开，不能以lifecycleFailed总开关丢弃责任。这些是静态输入，不是本轮已复现异常。

设计复审还指出：100ms扣留回执在30s工作期限内不自动成为unknown，U1-5因此单列100ms资源观察截止及先unknown后放行；writer预算与操作预算分阶段，不在35s操作截止截断刚开始的2s证据窗口。D3洪泛须发生在after-await确认之后，控制区与bulk容量分开；只有真实await后及独立接收能证返回，resolve后同栈写盘仍会挡住续体。

收口复审区分了guard-returned与调用方await后事件：前者在resolve之前，九项真正controller-guard-observed最大1012.3385ms、均在2000ms内。outer-returned之后尚有同步写盘和resolve，九份outer trace没有await后时间；只能证明controller已退出/捕获已close且事件在5000ms内，不能宣称完整外层返回预算已独立证明。此为诊断观察缺口，不改变G07前提判定；原审计保留，补充计时另存timing-observation-audit-v1.json，下一新工具承接。

新close-exit-3原始轨迹中双流最晚close为20.7513ms，父端21.1521ms尝试challenge，21.4268ms观察到控制通道不可用，child-exit通知21.7708ms才到，但没有pong。其前提正确拒绝，直接说明通知偏序不能证明主体仍可执行；正例才以双EOF后两次fresh响应建立窄前提。keep-open三个预期超时仍为deadline-incomplete，不能因为迟到EOF或整个控制套件通过而升级自然完整。

新工具初稿的native ERROR大小写、outer结果自报及只改冗余字段的token负例已在独立复审中修正；v1自测保留，v2才有增强证明。native EXITING与child-exit的父端通知顺序不能代表主体操作顺序，新oracle保留两路原时序，只要求许可先于退出及主体内序号/回执一致，未放宽第14节的双fresh挑战前提。

G07补证不能仅改用另一种close调用：需要明确原生写端owner、标准句柄槽位/CRT退出清理、独立控制通道与guard pending的证据。新协议由C主体直接持有自己的pipe写端，关闭后两次回应父端新challenge并受许可退出；无关闭和无响应两个负控分别防止把正常通知偏序误当活进程窗口。本地Linux只能审工具逻辑，Windows实际操作仍须runner验证。

三平台原verifier均报告D2的24/24，但Windows G07夹具调用fs.closeSync(1/2)并未真正关闭标准fd。固定Node22.23.2的fs.closeSync经uv_fs_close到Windows fs__close，只在fd>2时执行_close；end/close发生在250ms定时退出附近，父端事件先后不足以证明主体仍可执行。该诊断覆盖缺口不是OS或产品bug；Windows已退出对象被引用的正常语义仍不需要消除。完整证据和官方源码见生命周期契约第13节。

本轮D1初稿M18的samePromise由模型内部恒等表达式自报，虽通过原自测仍不能证明API幂等；已改由harness比较实际返回引用及完成值，并保留旧自测。D2首轮local-first的24项控制按预算成功，但G04/G05在deadline后收到真实管道end时仍将整体capture标complete；新版另存v2，明确deadline-incomplete，不把迟到EOF改成自然完整。见独立生命周期契约第11节。

本阶段发现现有“最终事件”还隐藏不同证据：Supervisor的terminalOperationChain/journal.flush不等于tracker解析完成，Webview却已有实际xterm callback屏障；不能将wire缺少结算凭证写成页面从未等待应用。新outcome在现有各层只传identity时会丢失，必须全链路接入。Windows自然gate任一失败便拒绝Close，不是生产失败回收方案；CreateProcess成功到hShell登记之间的失败窗口和TSFN env-null绕过callback RAII均为静态风险，尚无本轮异常复现。

契约初稿复审发现M05没有可表达“已终止但状态未知”的类型、unknown迟到补证与不可变seal口径冲突、序号分配者不唯一，均已修订。D2初稿要求controller直接持有共享driver写端的兄弟helper，没有公有Node跨平台实现依据；改为受控继承helper、有限TTL/nonce协作、无PID强杀和前提失败分账。新设计冻结37子案例与72控制，不能把这些数量写成已执行样本。

run35586906307 的两条 rebuilt 臂使用同一 native，retain 两轮 200→240/197→237，explicit Close 两轮 191→191，46 次窗口均 193→191且 owner 归零；原包两轮增长与 retain 相同。所有138条内容/真实EOF/消费完整，因而窄因果指向已知 owner 最终 Close 责任，而非 Windows 正常对象引用语义。具体旧 File/Process 槽位身份仍未知，稳定背景差额4也不机械判为泄漏。

新诊断 guarded() 的150s仅发kill并等待child.close，不是独立硬返回预算；Linux控制中driver已exit0但stdio被自有后代持有，150ms watchdog后又884.470223ms才close。该缺口需下轮新版本修，不能修改本次冻结入口；12个Windows driver均自然返回/timedOut:false，没有本次命中证据。session源EOF、driver stdio EOF、JS exit和OS进程终止须分别记录。

新诊断草稿的静态复审曾发现重复 connect、stock 调用候选接口、移除 owner 后访问、TSFN/等待状态未核验及机械转换破坏定义等问题；已在 runner 启动前修正并完成自测，首次原生结果见设计第34节。Windows 实际配套程序为 OpenConsole.exe，Unix spawn-helper 不在本路径。原 conpty.cc 将 Release 当作 void 调用，但同包 conpty.h 声明真实导出返回 HRESULT；应按该头文件记录结果，而不是伪造成功或把 Release 与 void Close 混淆。该组发现属于新增诊断工具，不自动外推到业务缺陷。

官方 ClosePseudoConsole 是 void，且旧版本可能等待客户端断开；候选必须在真实 pipe EOF、worker/input close、decoder/consumer complete 后调用，不能把 Close 调用本身写成成功返回。PtyKill 混合 Close 与 TerminateProcess，不能复用。退出线程中的 baton erase 还可能与主线程查询竞态，因此候选必须显式同步 shellExited/hShell=NULL 与 HPCON owner 转移。

首次普通进程控制在四个child driver预热后都有额外+5，release-each后续稳定60，retain从63逐次至83、关闭23个后回60而非初始55。所有92个已知hProcess/hThread均单次关闭成功，不能把额外5直接叫这组owner泄漏或OS bug；无类型/调用栈，lazy初始化等解释未证实。暂停态image92次成功、退出后368次31与稳定PID/time/exitCode并存，支持正常对象语义但不补造旧HPCON身份。

官方PROCESS_INFORMATION/CloseHandle确认已退出进程仍被句柄引用是正常语义；ReleasePseudoConsole明确不免除最终Close职责。conpty.cc的remove_pty_baton置于assert，NDEBUG可消除其副作用，不能未经binary证据称实际已移除；此补记限定历史源码表述，不更改旧运行结果。

第二run35527528410 Windows全46条内容/自然退出通过而handles逐次+2；840次前后表和83685次类型查询成功，唯一错误是2730次QueryFullProcessImageNameW返回31。增长细化为PIPE类型File与已退出的非fixture Process，但未证明OpenConsole/signal pipe归属，也未证明错误31的查询时机原因。macOS两轮同工具链close对照均消除kqueue增长，基线红项保留。详见设计第30节。

首次run35527241793中macOS三arm/138条PTY及完整离线对照达标，但Windows新增观察器的boolean辅助函数与SDK typedef冲突，零PTY。这是Linux纯逻辑自测不能覆盖的原生编译问题；保留原输入/失败，按设计仅重命名新增诊断辅助函数，另采新输入，不改变原oracle或产品结论。

运行前源码审计发现macOS需要同工具链rebuilt-baseline，且node-pty嵌套node-addon-api版本不同于仓库顶层，不能混用。Windows固定DLL的Release只释放部分成员、Close另释放其余成员，支持继续取证，但当时尚未原生确认类型/归属，现类型已由本轮取证补齐、具体归属仍开放。均是实验输入，不是生产修复。

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

- 决策：新增D3 v3/D4 v2设计，不修改旧D3 v1/v2、D4 v1及工件；三不可变首报、捕获真实EOF、writer/verifier/publisher分责及D4全账独立oracle分别验收。理由：来源/顺序修正已经提供窄证据，不能继续以旧摘要或同步归档代替完整结算；版本隔离保留历史失败。日期/作者：2026-09-22 / Codex。
- 决策：先本地新入口、固定fixture/源码hash和独立源码复审，再唯一三平台采集。D3每runner36主控、2gate、4publisher，D4每runner16模型分账，不扩为native或生产承诺。理由：证明层级与故障注入性质不同，设计计数不能冒充执行结果；W1/U1继续由工具验收门槛阻塞。日期/作者：2026-09-22 / Codex。

- 决策：以唯一b4db41cc/run35676427931的全工件与可信Git输入独立审计收口v2来源/顺序窄验证，下一增量另冻三settlement、writer与D4完整协议，不启动W1/U1。理由：本次实际Windows乱序已被正确处理，但有限工具绿色不提供尚未实现的结算/原生保证；旧失败与正常Windows对象语义不改。日期/作者：2026-09-22 / Codex。
- 决策：保留v1两个failure、原断言、真实迟到与全部工件，新增v2只修caller来源/顺序oracle及D3-08确认前提；合法迟到分类observed-late，不因晚到就当非法协议或放宽预算。理由：源因果与观察到达顺序是不同事实，必须修取证协议而非追认系统bug或重跑筛绿。日期/作者：2026-09-22 / Codex。
- 决策：local-1篡改覆盖不足保留，local-2独立校验根manifest/run并强制24 attempted/23 verified、末项有效；三settlement及完整writer/D4协议仍列阻塞。理由：拒绝坏首项不等于其余案例被有效复核，局部工具绿色不能替代完整契约。日期/作者：2026-09-22 / Codex。
- 决策：新增原生失败与资源隔离设计，先冻结D3/D4及W1/U1第一批，第二批通知/取消/Close/并发明确列为生产阻塞而不虚构安全注入。理由：创建/等待有可实施的已知owner控制，其他故障仍需不同所有权/处置前提；首批结果可用于收敛后续方案，不以大而未定义的矩阵冒充完成。日期/作者：2026-09-22 / Codex。
- 决策：N=2/Q=1只作为诊断准入政策；共享进程封禁、worker线程、创建前专用进程分别比较，不选择生产拓扑或新增server。理由：停止新建能限制owner数量，但不能隔离原生卡死/崩溃；释放未知既不能盲Close，也不能靠重启整个Supervisor影响B。日期/作者：2026-09-22 / Codex。
- 决策：新工具将操作返回、进程结算、证据writer分成独立结果/期限，最终健康归档失败不豁免证据完整性。理由：同栈同步写盘会阻挡await续体，writer故障不能改写已证操作结果；顶层OS调度和最终存储环境不由无限watchdog自证。日期/作者：2026-09-22 / Codex。
- 决策：以cf359040/run35631266321首次九项及全工件独立复核收口本轮G07补证，进入原生异常/unknown owner有界隔离设计，但不追认旧三条G07通过或选择生产API/预算。理由：三个新正例真实关闭与独立存活证据成立，六个负控按预定原因拒绝；零PTY控制只补诊断前提，不覆盖native释放异常或产品链路。正常Windows对象引用语义不是待消除的系统bug。日期/作者：2026-09-22 / Codex。

- 决策：G07补证单独新增Windows C/JS/workflow并复用冻结guard-v2，采用三个模式各三次，正例由双EOF后fresh nonce响应证明存活，第二次响应前持有至少100ms。理由：不改旧错误前提求绿，同时将原生操作、父端EOF、独立响应和返回预算交叉核验；仅操作自己直接拥有的资源。日期/作者：2026-09-22 / Codex。
- 决策：保留run35620967433的原72条pass，但将Windows G07三条的冻结前提登记为未建立；下一阶段另冻真实stdio关闭和独立主体存活控制，先补前提再推进原生异常。理由：固定平台源码否定了夹具的关闭假设，父端通知顺序不是进程存活证据；不能改旧脚本求绿或把libuv语义当OS缺陷。日期/作者：2026-09-22 / Codex。
- 决策：D1/D2只在独立分支交付诊断和workflow；先本地固定输入，再三平台完整执行、下载和重算。超时后真实end与整次采集完整性分别记录，新增deadline-incomplete而不放宽预算或改写local-first。理由：控制识别失败成功不是被测路径自然成功，原工件和首次结果必须可追溯。日期/作者：2026-09-21 / Codex。
- 决策：本阶段以独立候选契约和D1/D2冻结收口，不直接用自然诊断fork实施生产。理由：自然gate的fail-closed策略不足以处理partial-create、通知/读取/消费/释放失败或永久未返回，且源、authority、读者与资源是不同责任；正常Windows对象语义不需要消除。日期/作者：2026-09-21 / Codex。
- 决策：D1以opt-in close outcome作为读者结算候选，保留独立ACK对照；数据序号由adapter唯一分配，unknown追加补证不重写历史。理由：复用当前分页和一次服务端释放边界，但必须全链路校验及有界幂等回执；旧能力不补证明。生产字段、回执预算和native策略仍未批准。日期/作者：2026-09-21 / Codex。
- 决策：先实现有限模型与零PTY guard控制，再逐平台冻结真实异常注入。理由：尚未具备可信工具返回预算，不能把模型/JS抛错当作OS API失败证据；G04尤其需排除Windows父Job提前结束helper的无效前提。所有固定时间仅为诊断预算。日期/作者：2026-09-21 / Codex。

- 决策：以首次138条PTY与完整审计收口已知HPCON自然路径的窄因果验证，四个no-close资源失败不改判；不追求消除系统全部Process对象。理由：同一rebuilt产物的最终Close差异消除逐会话+2，正常引用存续与调用方最终释放是不同责任。旧具体身份、builtin/异常/并发/正缓冲/真实宿主仍开放，不宣布生产已修复。日期/作者：2026-09-21 / Codex。

- 决策：guarded()硬返回缺口另以新版本诊断修订，不回改d0f0be88冻结入口。理由：新Linux控制证明定时kill不等于child.close预算，但本次Windows全部自然返回；必须保留原证据并分开工具缺口和原生结果。日期/作者：2026-09-21 / Codex。

- 决策：先通过新工具的结构、自测与完整证据链审查，之后才运行原生矩阵；stock 不调用 owner API，两候选只共享一个编译产物，未知 PID 不参与清理。
  理由：避免新增诊断自身的启动、API 或构建差异污染 owner Close 的因果比较，同时落实正常 Windows 对象引用不等于进程存活的边界。
  日期/作者：2026-09-21 / Codex。

- 决策：先固定 bundled DLL，比较 stock、owner-retain/no-close 和 owner-retain/explicit-close 三臂，不把 builtin 后端或 Release 时序变化混入。理由：只改变已知 owner 的单次 Close 才能解释旧 +2 候选，且避免 backend/API 差异和强杀造成混淆。日期/作者：2026-09-21 / Codex。
- 决策：explicit-close 的首要通过条件是 owner ledger 单次关闭、自然收尾和无逐会话增长，不要求 OS 句柄总数回到 control baseline。理由：HPCON Close 可能异步释放或仍有系统引用；全局对象消失不是调用方责任。日期/作者：2026-09-21 / Codex。
- 决策：以首次负结果收口正常对象控制，不改初始计数oracle或重跑试绿；正常引用/关闭事实、未知+5和旧PTY持续+2各自分账。理由：平台语义已由官方契约和原生owner事件支持，计数严格回初始未成立必须保留；不能把所有仍存在的对象当缺陷或用总数抹去责任。日期/作者：2026-09-21 / Codex。

- 决策：在HPCON干预前先做无PTY正常Process对象控制。理由：用户要求确认平台语义而非强行消除合法引用；故意retain与完成owner释放分开验收，image查询只观察，不能用新控制追认旧增长的确切归属。日期/作者：2026-09-21 / Codex。

- 决策：本轮按“macOS自然路径局部因果已建立、Windows类型积累已证实而归属未闭合”收口，不改原身份门槛求绿。下一步优先已知资源owner的受控干预，正缓冲控制分列。理由：内容/进程结束不代替原生资源回收，类型事实也不等于精确对象所有权或生产验收。日期/作者：2026-09-21 / Codex。

- 决策：首次Windows编译命名冲突只以dsc_boolean局部重命名修正，使用新输入/新run保留旧失败。理由：查询逻辑和所有资源断言不变，不能把工具未编译当产品通过或失败，也不放宽/WX。日期/作者：2026-09-21 / Codex。

- 决策：资源归因与正长度JS缓冲取消分阶段交付；Windows本轮只读取证、不增加HPCON释放API，macOS只在隔离副本插入close并固定spawn-helper。理由：保持原读取协议，区分工具链、观察器和唯一释放变更；Windows句柄总量尚不能唯一证明资源所有者。日期/作者：2026-09-21 / Codex。

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

当前阶段交付为新诊断结算设计及运行前协议冻结，承接原生失败设计第18节、生命周期契约第23节和退出设计第45节。三侧源码/协议问题已经写入新设计，最终静态复审与文档检查已通过。本阶段只修改文档，D3 v3/D4 v2尚未实施、零新测试、零native，不能关闭三独立settlement、writer/D4完整重放或W1/U1债务。

下一阶段仅在独立诊断树实施新版本，先固定fixture/source hash、本地oracle/文件/gate与完整矩阵、独立源码复审，随后才唯一一次三平台采集及全量可信重放。新设计比较中/未验证，原设计状态不变，整体计划继续active；以下为此前阶段记录，其中当时的“下一步”不覆盖本段当前顺序。

当前已完成独立D3/D4 v1实施、本地与两次runner全工件复核，v1两个failure及自测真实迟到保留；D3 v2来源/顺序窄协议、三个新脚本/专用workflow、local-2增强验证及b4db41cc唯一新runner的完整审计均完成。详细v1证据见退出完整性设计第41节，v2协议/本地与三平台结果见第42–44节；三个runner各full24/scaled24/oracle78/parser8、tamper24/23分别通过，Windows实际跨pipe倒序仍正确接受。本次raw没有超预算，但不关闭verifier预算债务。主运行时本增量仅六文档，旧live绑定、业务和依赖未改。

下一阶段先另冻并设计/实现D3三独立settlement、首次deadline快照、有界unconfirmed、writer协议/预算及D4完整独立重放/身份核验。上述门槛未完成不启动W1/U1，66个driver仍是计划尝试数、零新native执行。其余通知/env销毁、正缓冲取消、真实Close挂起、双会话与真实宿主/生产支持面仍未验收，整体退出完整性未完成；不修改生产预算、不推主运行时，设计继续比较中/验证中，新失败隔离设计比较中/未验证，计划active。以下保留历史阶段结果，其中当时的下一步不覆盖本段。

本轮G07补证已完成实施、自测、首次Windows运行及完整下载/离线审计，详见契约第14–16节。固定cf359040/run35631266321 attempt1的九项控制成立：三个close-wait正例持有100.8252–101.7934ms，keep-open与close-exit各三项按预期拒绝前提；raw仍分别是超时不完整与自然完整，两个负控不当正例。runner的27项合成自测与九项真实控制分开，独立raw审计836项通过，没有重跑。

新证据只补固定Windows环境下真实stdio关闭后的主体存活前提；旧run35620967433的Windows G07三项继续not-established，原72pass和所有历史失败保留。下一阶段转原生异常路径/unknown owner有界隔离设计与矩阵冻结，不调查正常Process引用存续来代替推进，不接入业务；生产reader/API/预算及完整产品矩阵未验收，设计比较中/验证中，计划active。以下为历史阶段记录，其中当时的下一步由本段取代。

当前进入G07补证阶段，运行前协议已写入生命周期契约第14节，尚无本阶段原生通过记录。实现只在独立诊断树新增C/JS/workflow；本树同步设计和执行记录，保留原72pass及Windows三项not-established。只有完整新矩阵及离线审计完成后才评价前提是否补齐；以下D1/D2首次结果仍按原范围保留。

当前D1/D2实现、本地和三平台首次运行及完整下载复核已完成，详见设计第36–37节和生命周期契约第10–13节。D1三平台111个模型子案例通过，D2原72条控制pass保留，但Windows G07三项未建立真实提前关闭的前提，不能宣布D2全部验收完成。其他69条控制依据保留，有界返回观察不因夹具缺口被抹去，也不等于原生PTY或产品已通过。下一步先另冻G07补证，再进入异常/unknown隔离设计；主树仅文档，业务、依赖、旧实验和原始工件不改，设计仍比较中/验证中，计划active。以下契约冻结和原生自然路径结果为历史阶段记录，不覆盖本段当前待办。

本阶段完成新候选契约、跨层/跨平台只读核查和三份复审，修订类型、序号、未知补证、authority/页面应用与native回收偏序，以及D1/D2运行前协议。既有bridge、tracker、Supervisor聚合回归和旧39项契约通过，输出在.debug/lifecycle-contract-design-v1-node25；这些不验证尚未实现的37个新模型子案例、72条新guard或任何新原生错误路径。两工作树各六份文档同步，仍比较中/验证中，计划active；业务/依赖/旧脚本/工件未改，下一步实施新D1/D2而非继续重复自然矩阵或直接接入生产。

HPCON 首次原生阶段已完成：d0f0be88/run35586906307 的12 driver/138 PTY、全部工件和两份独立审计一致；92候选owner各Release一次、46单次Close消除逐会话+2且未损坏内容/终态/自然EOF。原verifier仍四个no-close资源失败，workflow failure保留。Windows正常对象语义不是缺陷，191相对control187的稳定背景不要求归零；具体旧句柄身份未因此确认。主分支仅文档，诊断分支仅新脚本/workflow及文档，业务/安装依赖/旧实验未改。

下一阶段不重复排查正常Process存续，转provider/adapter候选契约和异常路径设计，再冻结新诊断的返回预算与取消/失败验证。builtin、正长度readable-buffer、并发、真实Agent/Host/Webview/packaged和生产API/预算仍未验收，设计比较中/验证中，计划active。guarded工具缺口已登记，其Linux控制不是Windows失败样本；不能把本轮局部成功当作整个退出完整性交付完成。

本增量已完成首次原生和完整下载复核，见设计第32节：六driver全部运行，92child自然退出，两个control通过而四个计数失败保留；无工件错误/强杀/watchdog。已确认普通进程的引用存续与释放事实，额外5和旧PTY +2的具体来源未闭合，不能称OS bug；未选定生产方案或修改业务，计划继续active。

2026-09-21资源归因增量完成实现、本地自测、两次新输入原生执行和全量离线复核，共322条实际PTY。macOS原包/重编译基线增长、唯一close候选不增长的局部因果证据成立。Windows修名后46条会话完整，资源仍+1 PIPE类型File/+1已退出的非fixture Process；全部image查询31，故整体归属inconclusive且不改判。首次编译失败、各基线资源红项及所有旧证据保留；生产退出完整性仍未交付，设计比较中/验证中。

历史第28节已完成Windows局部所有权与三平台同进程资源首次验证，24个driver/150条真实会话完整留证；20个driver通过、macOS和Windows各两个资源失败，全部离线复核有效。资源增长不能被内容/自然退出成功掩盖；当时开放的macOS隔离干预已由第30节完成自然路径因果对照；Windows正长度readable和具体资源归属仍开放。只新增诊断及文档，既有局部成功和历史失败均保留，未修改业务或选定生产方案。

历史第27节原位观察/独立gate增量完成本地、自校验及两平台24项原生/下载复核，Unix这组前提和局部取消所有权已验证；当时提出的Windows与同进程资源由第28节承接，首次两个诊断时间前提失败及旧18项解释不改，不将隔离诊断作为生产完成。

历史里程碑的可读性握手18项及窄控制12项均完整执行、下载复核。前者总run失败，后者在两平台实证helper启动会清共享O_NONBLOCK，使原矩阵不能用于非阻塞reader验收。当时提出的原位readiness/独立gate与新取消对照现已由第27节完成，旧失败不改判，生产方案仍未选定。

本次写入控制阶段新增本地27项和run35508235734两平台54项，完整下载复算，无工件错误。Ubuntu27/27、macOS21/27，总run失败：新暂停探针修复已验证，六个原取消仍因写读循环等待未进入待测路径；读放行控制定位了前提根因，不替代取消验收。下一步先冻结新取消握手，再继续Windows在途取消、同进程长驻资源和生产契约选型。旧入口/断言/失败不变，业务未修改，不宣布全平台或完整重构完成。

此前已承接模型阶段完成新原生84项及本地Linux三版各21项，完整保留首次失败。run35506150727中Linux21项达标，Windows候选21项达标且actual bridge受控cmd/bat主体等待/0与7传播有证据；基线主进程TAIL确实缺失、自然资源guard继续失败。macOS12项通过/9项失败，三项新诊断零长read误认EOF、六项2048-byte写入前提未成立的原结果不变，本次只用新实验定位。真实provider/信号/宿主/packaged及资源/API仍开放；旧两轮294项原始断言和失败不变，设计比较中/验证中、计划active，里程碑一和技术债均不关闭。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 是 node-pty 接入边界，输出回调表示已交付的数据，进程退出通知不天然等于输出排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 与 `finalizeSession()` 将已接收事件按每会话串行队列执行；admission 表示是否继续接受新事件。`src/panel/CanvasPanelManager.ts` 还直接管理 snapshot-only 的 Agent/Terminal 退出，两条路径都要纳入设计。

`src/common/runtimeSupervisorProtocol.ts` 负责 Supervisor 与 Host 的契约，`src/common/protocol.ts` 是 Host 与 Webview 的共享消息。`src/panel/runtimeTerminalReadRelay.ts` 与 `src/webview/terminalPagedProjection.ts` 管理读者、连续分页和终态呈现。revision 是已接收事件的位置，不是源进程预期输出的字节数。若需要修改这些接口，必须同时验证消费者和旧协议。

平台 provider 的现状见安装的 `node_modules/node-pty/lib/unixTerminal.js`、`windowsPtyAgent.js`、`windowsTerminal.js` 和 native 源码。已有证据位于 `docs/design-docs/runtime-terminal-tail-diagnosis.md`、`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md`；固定版本来源已在文档摘录，不要求接手者依赖本机 `.debug/` 才理解问题。不能直接编辑 node_modules 作为生产修复。

## 工作计划

当前执行设计是 `docs/design-docs/runtime-diagnostic-settlement-contract.md`。下一里程碑在独立 `runtime-exit-integrity-native-candidates` 工作树新增D3 v3的handle/CLI/oracle/fixtures与D4 v2的model/oracle/CLI/fixtures，共八个新文件，精确文件名见该设计第10节；旧脚本、workflow和工件冻结。先实现标准库诊断及严格fixture清单，完成本地语法/oracle/文件/gate和模型全账复核，再由独立审查核查owner控制、首报不可变、归档边界和oracle不复用被测转换。

本地通过后冻结新输入commit、Node22.23.2和新workflow的路径过滤/唯一首次触发方式，再一次完整三平台采集，失败上传全部partial证据，下载所有ZIP并按固定Git可信入口核验。D3主控/gate/publisher与D4模型分别报告，不更改旧门槛筛绿、不导入业务；本轮只有设计，最终文档检查已通过。以下旧工作计划作为历史记录保留。

当前设计入口是 `docs/design-docs/runtime-native-failure-isolation.md` 第13–17节。D3/D4 v1四入口及foundation workflow已经实施，两个runner失败冻结；D3 v2三个新脚本及独立workflow也已提交b4db41cc，本地快照/增强tamper证明与v1分账。唯一run35676427931的全工件获取、固定Git输入对账和独立原始trace审计已完成；当前先另冻三独立settlement、不可变首次deadline、有界unconfirmed、writer协议/预算和D4完整重放/身份设计，再实现新输入。仅该门槛收口后实施W1/U1新native副本，不import进业务。以下为历史顺序，不覆盖本段。

当前设计增量以主树f318579a、独立树7fb4ae9e为输入。先只读核查固定native创建/等待/通知/读取/释放的真实边界，再比较同进程封禁、停止新建和独立进程隔离；不能假定worker线程能隔离共享进程的原生崩溃或取消永久阻塞的调用。正式结论与运行前矩阵将写入新的 `docs/design-docs/runtime-native-failure-isolation.md`，同时补外层await后与证据写盘预算的观察设计。此阶段交付设计和冻结协议，不创建生产模块、不运行未冻结异常实验；以下安排保留历史。

当前里程碑已由契约第16节收口。下一里程碑是原生异常路径及unknown owner有界隔离的设计与运行前矩阵冻结：逐平台列出partial-create、wait/通知失败、在途取消/正长度已读缓冲、release失败/挂起和两个并发会话，明确每个注入点、已知资源owner、可证结果和允许的隔离边界。对无法确认的owner保留unknown及操作账本，不重复Close、不关闭未知句柄、不按日志PID强杀，不把超时当完整EOF。新工具还需补外层调用方await后及同步结算I/O预算观察，不能把resolve前事件当完整返回证明。只有新协议独立审查后才实施新诊断和一次完整首次采集；具体预算尚未选定，不能直接复制本轮控制参数成为生产政策。当前不推运行时分支、不改业务或重复旧矩阵；下列安排保留历史，不覆盖本段当前顺序。

本阶段先按生命周期契约第14节实现独立树 `scripts/diagnostics/windows-stdio-close-control.c` 和 `scripts/diagnostics/diagnose-windows-stdio-close.mjs`。原生fixture通过私有命名管道传控制记录，直接WriteFile/CloseHandle自己的stdout/stderr，ExitProcess避免CRT重复清理；controller从原guard record推进双EOF、两次fresh challenge、100ms持有和退出许可，不修改guard。新增 `.github/workflows/runtime-windows-stdio-close.yml` 固定Node22.23.2/Windows x64/MSVC，保留首次编译失败或完整九项结果，下载全部工件后独立复算。先设计及本地工具自测/源码复审，后推独立输入；不推本运行时分支。此段是当前执行顺序，以下上一阶段安排保留历史。

当前下一步按生命周期契约第13节另冻Windows G07控制：由已知owner真实关闭两路stdio，父端确认结束后，通过独立通道取得同一主体的nonce响应，再允许主体退出。平台关闭实现、身份和所有权、控制预算及失败分类须先设计复审，再创建新版本/入口和新工件；PID可查询或通知偏序不作存活证明。旧d173c099输入和run35620967433保持冻结，不修改断言或反复重跑。本轮只收口结果文档，独立诊断分支推送前fetch/rebase origin/main，不推运行时分支。该前提缺口关闭后，再逐平台冻结partial-create、wait/通知失败、在途取消/正长度缓冲、最终release失败/挂起与并发矩阵，以及unknown owner有界隔离；仍不接入业务或选定生产预算。

刚完成的设计阶段基线为0518dcc4，新 `docs/design-docs/runtime-execution-lifecycle-contract.md` 已作为当前候选契约入口，包含职责分层、结果类型、事件偏序、序列/身份、错误和取消回收、旧能力与接入位置。设计第35节登记承接和证据边界，索引/原则/债务同步；Windows、Unix和authority/读者分别独立复审。本阶段未创建生产模块、新诊断或workflow，未跑D1/D2或新原生异常矩阵。以下上一阶段安排仅作历史记录，不覆盖本节首段。

当前下一步先在正式设计中比较 provider/adapter 的自然完成、取消、失败和资源移交契约：将主进程退出、源输出结束、consumer完成与owner释放分开，不直接把诊断closeAfterExit接口接到业务。对缺EOF、Release/TSFN失败、并发或取消时的owner状态和可报告结果先作明确设计，随后在新版本诊断冻结失败矩阵与硬返回机制；不能以提前Close或强杀获得资源计数绿色。Windows builtin与正长度readable-buffer仍为单独验证，真实Agent/Host/Webview/packaged留待产品矩阵。本轮138条自然路径已收口，不反复重跑或调查正常Process存续来代替设计推进。

已完成的HPCON增量新增独立Windows workflow和诊断fork，复用owned-lifecycle负载/consumer/resource断言，并完成三臂全部原生及离线审计。结果见设计第34节，旧+5、+2和四个本轮no-close失败均保留；后续新工具修guarded预算也不能修改本次冻结输入。以下阶段安排作为历史记录，当前顺序以本节首段为准。

本次普通对象控制已完成，不重跑同矩阵筛选绿色。下一步另冻已知HPCON owner的保留/最终Close最小隔离对照，区分自然源结束、消费完成和资源释放；需设计稳定背景/owner账本/逐会话增长三类证据，不能机械减5或忽略原失败。普通控制的+5可另做类型/创建归属取证，但尚未证明是产品缺陷，不把消除全部OS对象作为交付目标。

本增量先按设计第31节新增windows-process-object-control.c与diagnose-windows-process-objects.mjs，专用workflow只在Windows运行。三种模式各两轮、每driver3预热/20测量；C持有确切CreateProcess句柄并记录全生命周期，JS保存输入/编译/native输出且独立30s watchdog，逐driver失败后继续。先本地合成自测再一次原生运行，下载完成后全量复核。该阶段不含PTY/业务修改；HPCON最终回收另冻协议，不能以“系统对象仍存在”直接定性缺陷。

资源归因实现及结果已在设计第30节收口，不重复执行冻结矩阵以筛选绿色。下一里程碑先明确Windows已知HPCON owner跨主体退出、输出结束、消费者完成和释放的诊断生命周期，设计最小隔离释放对照及必要的早期身份取证；不盲关未知句柄、不把退出后对已移除baton id调用kill当释放证明。具体新API/干预顺序需另冻结再实现。正readable-buffer取消、macOS异常路径、真实Agent/宿主/packaged与生产契约仍单列开放；旧脚本和业务不改。

历史资源计数阶段提出的macOS最小干预和Windows类型取证，现已由设计第30节完成本轮验证；异常分支、Windows具体资源归属与正长度readable控制仍开放，以工作计划首段为后续顺序。不能以源EOF/JS关闭宣布资源完成，也不把隔离实验当生产API授权。

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

本设计阶段只做文档与固定源码/协议复审，当前不运行新矩阵。已在两树完成检查：YAML parser核对新设计frontmatter/索引/关联路径、计划四活章节、两树共同协议，按输入Git比较冻结历史正文与旧脚本/workflow字节，并执行 `git diff --check`，均通过。

后续实施工作目录为 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates`。新CLI完成后才可运行 `node scripts/diagnostics/diagnose-settlement-v3.mjs --self-test --output NEW_DIRECTORY` 与 `node scripts/diagnostics/diagnose-owner-quarantine-v2.mjs --self-test --output NEW_DIRECTORY`，再分别使用 `--output NEW_DIRECTORY` / `--verify-saved DIRECTORY`；Node固定22.23.2，每次目录新建且不复用。上述入口尚不存在，不能在本轮执行或声称通过；主运行时树不承载这些新增脚本。以下旧命令只用于历史证据复核，不是本轮新采集安排。

本树只做文档一致性检查：执行 `git diff --check`，核对YAML/索引/关联路径、当前进度、证据范围和历史保持。实际v2复核从独立工作树 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates` 执行 `node scripts/diagnostics/diagnose-observation-envelope-v2.mjs --verify-saved .debug/observation-envelope-v2-local-2-full`，预期attempted24/verified24、无evidenceErrors；其selftest目录positive为24/24、tampered-verification.json为24/23且仅shared-manifest与D3-01-1错误。使用固定Node22.23.2；不从归档执行源码，不覆盖旧目录。本树不存在这些v2入口，不能在此直接运行。新runner全量审计已完成，输入SHA/run/工件/环境/原始结果见本计划证据与备注及设计第44节，失败不筛绿；不推主运行时分支。

本轮证据已完整下载到主运行时树。从独立诊断树执行 `node scripts/diagnostics/diagnose-windows-stdio-close.mjs --verify-saved /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/.debug/stdio-close-35631266321/runtime-windows-stdio-close-35631266321-1/stdio-close-evidence`，预期checked9、actualCreated9、pass:true、synthetic:false、pty:false、无工件错误，且仅三个close-wait前提为true。原始guard分类必须另核对为六natural-exit/complete及三deadline-exceeded/deadline-incomplete；离线复核不新增原生样本。下一输入先补正式设计和冻结矩阵，不改本轮脚本或工件。

在独立 `runtime-exit-integrity-native-candidates` 树运行 `node --check scripts/diagnostics/diagnose-windows-stdio-close.mjs` 和 `node scripts/diagnostics/diagnose-windows-stdio-close.mjs --self-test`，已完成本地工具验证。原生仅在Windows/MSVC环境运行 `node scripts/diagnostics/diagnose-windows-stdio-close.mjs --output stdio-close-evidence`，随后 `--verify-saved stdio-close-evidence`。Linux可离线复核下载目录，但不能用合成自测替Windows原生结论。失败完整上传、每个重试使用新目录，推送前fetch/rebase，仅推独立诊断分支；具体窗口和分类按契约第14节，不调整原D2门槛。

四个新文件已经在独立工作树实现并冻结。当前复核可从 `runtime-exit-integrity-native-candidates` 树运行 `node scripts/diagnostics/diagnose-runtime-provider-lifecycle-v1.mjs --verify-saved /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/.debug/lifecycle-contract-35620967433/runtime-lifecycle-contract-v1-windows-latest-35620967433-1/provider-lifecycle-evidence`，D2改用 `diagnose-process-guard-v2.mjs` 和同包的 `process-guard-evidence`。预期原verifier分别37/37、24/24；Windows G07前提缺口需同时阅读独立审计，不能由旧verifier补认。Linux/macOS仅替换包名中的平台字段。下一实施输入须先在正式设计新增冻结协议，再实现新入口和自测、运行及完整下载复核；不覆盖本次和旧39项工件，不推主运行时分支。

已完成的HPCON证据可从独立诊断工作树运行：`env NODE_PATH=/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules node scripts/diagnostics/diagnose-windows-hpcon-owner.mjs --verify-saved /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/.debug/hpcon-owner-35586906307/runtime-windows-hpcon-owner-35586906307-1/hpcon-owner-evidence`。预期12项有效、四个no-close resource-failure、evidenceErrors为空、exit1，不改oracle。完整ZIP和输入哈希见设计第34节；补充审计只读原目录且独立保存。离线复核不是新增原生样本。

下一增量先更新上述候选契约及运行前矩阵，再另建版本修工具预算并自测；新workflow仅推独立诊断分支，不推运行时历史。未冻结异常路径前，不启动新原生实验或直接实施业务。下列旧步骤保留原复核入口，不视为当前未完成指令。

从独立诊断工作树运行node --check scripts/diagnostics/diagnose-windows-process-objects.mjs和node scripts/diagnostics/diagnose-windows-process-objects.mjs --self-test；Windows x64的MSVC developer环境运行同入口--output process-object-evidence，要求新目录。完成后使用--verify-saved process-object-evidence复核全部六driver（失败也继续）；原始目录不可覆盖，任何修订以新输入/新目录保留首轮。新workflow使用Node22.23.2，只需MSVC/Windows SDK和Node标准库，不安装或加载node-pty。

本阶段复核目录是独立工作树的 `.debug/github-resource-attribution-35527241793-{macos,windows}/native-resource-evidence` 与 `.debug/github-resource-attribution-35527528410-{macos,windows}/native-resource-evidence`。各用对应新入口的 `--verify-saved <目录>`，依赖可通过NODE_PATH指向同锁文件主工作树。两次macOS均三arm有效/外层exit0，但原四基线资源失败仍在；首次Windows因编译失败零driver，次轮旧verifier和inventory完整4/4、无损坏，两个native资源failure与身份inconclusive/exit1。不得改oracle追认通过；下一原生实验另冻输入。

独立工作树新入口 `node scripts/diagnostics/diagnose-macos-kqueue-release.mjs --self-test` 和 `node scripts/diagnostics/diagnose-windows-handle-inventory.mjs --self-test` 先做可用平台自测；采集用各自 `--output <全新目录>`，完成后 `--verify-saved <目录>` 复核。macOS需同版本Node头/node-gyp，Windows需MSVC/Node import library；非本机只跑纯逻辑自测，不冒称native通过。全部失败工件上传，原生执行和下载分别留证。

历史同进程资源计数复核： `node scripts/diagnostics/diagnose-runtime-owned-lifecycle.mjs --verify-saved .debug/github-owned-lifecycle-35519226627-ubuntu/owned-lifecycle-evidence`，预期4项有效/无失败/exit0；换macos为4项有效、两个native资源失败/exit1，换windows为16项有效、两个native资源失败/exit1，均无evidenceErrors。可用NODE_PATH指向相同锁文件依赖；不以预期exit1为由重跑试绿。资源归因的新阶段见本节首段。以下旧步骤只作历史复核入口，当前下一步以工作计划首段为准；仅推独立诊断分支，不推运行时历史。

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

本阶段验收只覆盖设计与协议清晰度，元数据/索引/本地引用/历史保持/两树一致性/diff检查及三侧静态复审已通过。不得将旧回归或runner绿色计作新D3 v3/D4 v2通过。运行前计划固定每runner D3主控36、gate2、publisher4、D4模型16；三runner对应108/6/12/48分别计数，当前实际执行均0，native始终不由这些模型/控制证明。

实施后须验证首报与迟到补证分离、真实consumer await、process/capture与主动截断分层、writer/verifier/publisher协议和独立归档、D4完整命令/事件/全量快照重放；语义篡改即使重编号/重算hash仍拒绝，坏首项后其余项仍有效验证。首次真实输入前冻结具体fixture清单/hash和唯一workflow触发，不在本设计预造断言总数；W1/U1继续等待完整新工具验收。以下为历史验收记录。

本阶段验收范围仅为D3 v2来源/顺序窄协议及完整证据审核，不计native/产品通过。两次v1完整D3共144项中原verifier接受142项；D4实际每runner24项、两run144次有限模型，不能把原逻辑schedule24写成执行总数。v2每runner完整24、缩放positive24、oracle78、parser8和tamper24/23分别核对，完整帧/身份/真实通道/单pipe源序与跨pipe任意到达、真实接收预算及ACK-before-bulk均须独立复算；合法迟到不伪装timely或protocol-invalid。W1 Windows24/U1 Linux18/macOS24仍全部未实施，零native尝试；三settlement、writer协议/预算、D4完整身份重放缺口不因当前工具结果关闭。

本轮九项已按冻结第14节完成，具体环境/输入/时间/审计见第16节；旧三条G07不追认通过，产品与原生异常矩阵仍未验收。收口须确认两树文档状态/索引/关联路径/计划四活章节一致，主树只改文档；独立树本轮结果提交仅文档，C/JS/guard/workflow与cf359040输入字节不变。历史主设计第7–38节、独立设计第2–5及7–34节、契约第1–15节正文不改写；只允许当前导航及新增结果变化。用户image.png不纳入提交。

本轮G07新矩阵固定九项实际child控制；正例三项须真实关闭、完整marker、双EOF/close后两次fresh challenge/pong、至少100ms持有且guard未提前返回，许可/退出/捕获完整均在原预算内。两个负控各三项须按预定原因拒绝前提，不以任意异常当控制成功；编译失败则如实零child/九项not-run。完整证据、EXE/源码/原guard字节和原始事件离线核对，坏首项不跳过末项。旧Windows G07三条不追认通过，业务/PTY/真实宿主仍未验收。

本阶段验收范围是D1/D2实现、首次三平台采集和完整证据复核，不是生产退出完整性。D1应按固定schedule核对三平台111个模型子案例；D2核对原72条控制和54真实/18synthetic分账、原raw分类及预算，不只信pass字段。独立审计已发现Windows G07三项前提未建立，应明确保留覆盖缺口，不能给D2全组无条件通过。主树本轮仅六份文档，旧设计第7–35节及契约第1–9节逐字不变；独立树d173c099的脚本/workflow及冻结输入保持不变，仅追加结果文档。元数据/索引/路径/计划四活章节一致；既有bridge/tracker/Supervisor聚合只是回归，不替代原生异常和实际产品矩阵。

HPCON首次原矩阵12项全部有效，六control及两个explicit-close通过，四no-close资源失败；138内容/自然EOF/消费通过不替代资源失败，46owner单次Close及无逐会话增长也不替代builtin/异常/并发或产品验收。正常Windows对象引用语义已确认，不把对象全局消失作为门槛。新的guarded返回缺口不修改本轮判定，也不能继续称150s为硬上界。

验收分层：自然内容/终端状态/pipe 与进程生命周期必须完整；owner ledger 必须每个 session 只 Close 一次且关闭后不再操作；resource snapshot 仅报告背景和逐会话增长，不把总数归零作为必要条件。`PtyKill`、`TerminateProcess`、未知句柄关闭、Close 前提缺失、Close 阻塞/watchdog 都是失败或不确定。builtin、真实 Agent/Host/Webview/packaged 和生产 API/预算不由本轮验收。

此前普通对象控制的原verifier保留attempted6/verified6、两个通过/四个failure且无evidenceErrors；已退出对象被引用以及image31不作为产品bug门槛。按原始owner/API事件和快照补充完整审计，不能通过改raw计数或跳过warmup断言将失败变绿。具体输入/环境/工件与局限见设计第32节，不与本次12项HPCON矩阵合并计数。

本轮已核对完整schedule、每条会话内容/消费/自然退出、原始OS资源序列、固定helper/实际加载native、类型查询错误、前后快照与工件hash。两平台原生结果不得合并为产品验收；Windows映像未知保留其不确定性，macOS不外推错误路径或其他版本。后续新干预必须保持这些原断言和失败记录。

交付以 `docs/design-docs/runtime-exit-integrity.md` 第 5、18 节和规格第 10 节为准。需要证明主进程尾部与已有内容完整、最终状态正确、资源释放，并证明取消/强制截断不会冒充完整 EOF；实际 CLI 启动链需另行验证。原生产品矩阵每格均有可复核证据和明确结果，未执行即未完成；普通后代诊断保留旧失败，不单独阻塞交付，也不增加产品通过计数。当前方案阶段验证独立诊断及 YAML/索引/本地引用、git diff 范围和计划状态；相对 `a5112fb5`，只允许诊断和文档变化，不把它们冒充 Host/Webview 或业务修复验收。

## 幂等性与恢复

候选试验不得修改用户 storage 或替换仍承载 live 会话的 Supervisor；仅控制本次创建的 fixture。证据目录唯一，不覆盖初次失败。生产方案需要可回滚的 capability/adapter 选择和旧 session 原绑定保留，回滚不得伪造完整性或强制迁移。取消和回收必须幂等，不因重试重复输出、重复终态或误删其他读者。

## 证据与备注

2026-09-22 本轮文档检查范围：每树4份设计的元数据/索引状态/架构标签、12个计划必要章节、新增或修改的完整本地引用、两树共同契约与4组冻结历史正文均通过；新设计12个主控场景和16个模型场景计数一致。另发现索引既有 execution-node-zoom-interaction-research 执行计划引用对应的文件不存在，两树输入HEAD已含该悬空条目，本轮未修改，不宣称全仓文档引用无缺陷。未运行旧矩阵或新诊断，用户image.png不纳入提交。

2026-09-22 新设计输入为诊断树e1a31b79、运行时树a5f8d629。新增 `runtime-diagnostic-settlement-contract.md`，外围设计/索引/原则/债务/计划同步；本阶段只有源码/协议审查与文档，没有新测试报告、runner、工件或native结果。三侧最终静态复核和两树文档检查通过：每树8份文档、4份设计元数据、12个计划必要章节与4组历史正文保持检查；两树共同契约一致，业务/脚本/workflow/依赖无变更。旧b4db41cc/run35676427931及所有历史失败继续按原范围留证。

2026-09-22 v2唯一runner收口：b4db41cc/run35676427931 attempt1，无rerun/dispatch。artifact Linux10673655385、macOS10673171771、Windows10674000078，各453成员共1359，API size/digest全对；15输入与固定Git对账，Linux/macOS10 exact、Windows5仅CRLF，未执行归档源码。全部资料仅在独立诊断树 `.debug/observation-envelope-v2-run-35676427931/`，audit.json SHA256为a772fa2a399c9b51fe109b56fff097933e9873fa0c424aab93f18717c13233f7；metrics/acquisition/三个platform-audit与可信输入输出保留。Ubuntu24 x64、macOS26 arm64、Windows Server2025 x64均Node22.23.2；full72、scaled72、oracle234/parser24、tamper72 attempted/69 valid分别计数。full after-await/writer最大毫秒Win1075.2648/1010.1685、Linux1040.977367/1005.608616、mac1056.778959/1012.396875，scaled Win330.1647/265.695、Linux296.077696/255.168326、mac292.366375/254.102916；原2000/500预算未改。本次没有D4、W1/U1或native PTY，不增产品通过数。

2026-09-22 D3/D4与v2证据同步：六份主树文档仅增量更新，所有新源码/workflow和工件均在独立诊断树。v1两run六ZIP共3,853,782字节/3022成员，36份输入与7141cfa3对账，Windows仅CRLF；审计 `.debug/foundation-first-two-audit/summary.json` SHA256为eb5d8e91ffe23ffa03ff43384d1d52c46ab0798a05a0adc644084a2a7d9081d5，audit.json为b1de5345391c816f11a47b4143afa65b5da8d826463f76d5883f559f59b1d5c1。v2 local-1/local-2完整目录及独立审计 `.debug/observation-envelope-v2-independent-local-review/audit.json` 保留，后者重放78/8/24/24与tamper24/23，并核对六个D3-08 ACK后bulk和连续尾部遗漏；before-fix-regression.json按旧hash复现local-1覆盖缺口，旧工件未修改。本地采集时未提交，不倒称来自b4db41cc；runner结果按新run独立追加。

2026-09-22 原生失败第一批设计收口：两工作树本增量各7份文档，120项设计/元数据/关联路径/历史保持与跨树一致性检查通过，四份固定源码SHA256与锁定版本对应。Windows、Unix和观察协议三侧独立复审已收口；两树 `git diff --check` 通过。主树 `npm run test:execution-session-bridge`、`npm run test:serialized-terminal-state-tracker`、`npm run test:runtime-supervisor-protocol` 均通过，仅计既有回归。D3的72项、D4的24项及W1/U1的66个driver尝试均为冻结计划数，本轮新增原生运行0次，新工具尚未实施；新设计保持比较中/未验证。业务、依赖、旧诊断、workflow和历史工件不变，用户image.png不纳入提交；主运行时仅本地提交，独立诊断分支只推本轮文档。

2026-09-22 收口检查：两工作树本增量各5份文档，metadata/索引/关联路径/架构标签/计划必要章节及106项历史/一致性检查通过；共享契约第14–16节两树一致，旧正文不改。可信入口再次离线复算九项通过，runner合成27项单列，bridge回归通过。独立文档复审发现的resolve前事件/await后观察和control-unavailable命名已收紧，新增计时补充保留外层未观察边界；未修改业务、冻结C/JS/guard/workflow或原工件，用户image.png排除。

本轮输入cf35904055a840e6e5b3189eb8551beba17d7163/run35631266321 attempt1。主树 `.debug/stdio-close-35631266321/` 保存全部API元数据、artifact10653794664的完整ZIP（1422720字节/1449成员）、解压工件及两个离线审计。ZIP SHA256为64376d0c6c68521594b137e5f09bda636ea4445f67defa7fc243cdd257fe79ef；独立raw审计JSON为133b9fc9ed673cf23637837517e1b140e56266daed4a3af701545eeb9c80a20f。固定输入、编译环境、EXE指纹、27合成与9真实控制、五份输入快照只读CRLF/LF对账详见契约第16节。guard-returned事件最大1011.7495ms，调用方await后观察最大1012.3385ms，九项均在2000ms内；outer-returned事件最大1112.4939ms，但事件后仍写盘/resolve，未记录外层await后时间，不据此宣布外层完整返回预算已证。另存timing-observation-audit-v1.json限定这三类计时，原预算不改；未运行新PTY、真实Agent或产品验收。

G07本地证据位于独立树 `.debug/windows-stdio-close-selftest-v1-first` 与 `.debug/windows-stdio-close-selftest-v2-oracle`，分别21/27合成断言，后者源码/编译前输入快照与当前C/JS/workflow一致。JS/C/guard/workflow摘要见契约第15节；JS语法、workflow解析和内嵌模块语法、metadata/路径/历史保留、主树bridge回归通过。候选设计当前导航第1/6节已更新，历史实验协议及结果不变；未执行Windows本地编译。

G07补证起点是本运行时树ebe303e7及独立诊断树2f630cd9。第14节为新冻结协议，不覆盖run35620967433的原72条结果；实现、自测及Windows首次输入commit/run/artifact将在本节追加，当前无新原生结果。

2026-09-22 最终收口检查：两工作树各六份文档，metadata/索引日期与状态/关联路径/计划必需章节、diff whitespace及独立只读复审通过。主设计历史第7–35节、契约第1–9节保持原文；独立分支候选设计第1–32节除当前导航外不变，契约第1–11节不变，四脚本/workflow字节与d173c099相同。两树新增契约第13节一致，官方源hash及两个审计JSON摘要核对通过。用户image.png不纳入提交；主运行时仅本地提交，独立诊断分支只推本轮文档结果。

本轮远端输入为d173c099d37f83bb3178d280a6a6d8b80d984b92，run35620967433 attempt1。主树 `.debug/lifecycle-contract-35620967433/` 保存API元数据、三个完整ZIP（各1280成员）及解压工件；artifact ID/摘要、实际Node22.23.2和OS/image详见生命周期契约第12节。`offline-review-v1.json` 保存111模型/原72控制复算与六份输入快照对Git对账，Windows CRLF只读归一；`windows-independent-audit-v1.json` 和 `macos-independent-audit-v1.json` 另存前提审计，源码证据/hash见第13节。首次结果未重跑，旧脚本和工件未改。主树本轮bridge、tracker、Supervisor协议聚合再次通过，未运行新PTY、真实宿主或业务接入验收。

2026-09-21 D1/D2本地证据在独立诊断树：`.debug/provider-lifecycle-v1-node25-first`、`.debug/provider-lifecycle-v1-electron39-first`和`.debug/process-guard-v2-local-v2-deadline-integrity`。从该树根运行各diagnose入口的`--verify-saved`加对应目录，预期D1各37/37、D2 checked24/pass:true；raw超时仍失败。首版`.debug/process-guard-v2-local-first`只能用其sources目录中的原入口复核，不覆盖或补认v2分类。运行版本、源指纹、原始trace与manifest均在各归档；本地输入HEAD9824f166且工作区源码尚未提交，不能写成在未来runner commit上执行。

2026-09-21 生命周期契约设计：主树0518dcc4为业务只读锚点，三名独立审查者分别复核Windows/native、Unix/guard、authority/读者；意见收口到新设计。`npm run test:execution-session-bridge`、`npm run test:serialized-terminal-state-tracker`、`npm run test:runtime-supervisor-protocol`（含checkpoint refresh、分页投影、无completed历史和分页退出）通过；旧 `diagnose-runtime-exit-contract.mjs --output .debug/lifecycle-contract-design-v1-node25` 全39项通过，scope仍是旧模型及真实projection回调，不是新增37项或原生矩阵。

文档检查：两份设计的YAML/标题/索引状态/架构标签/关联路径、active计划必需章节、TS类型片段语法、24组37子案例和D2分账计数已核对；主设计第7–34节历史原文逐字不变。主树本增量只有新增契约及五份既有文档，diff检查通过；用户image.png不纳入提交。新diagnostic/API/workflow文件仍只是设计中的待建路径，不宣称这些接口已可执行。

2026-09-21 HPCON原生收口：输入d0f0be882bf5f99d0dcaa90c94b7a3d6b0023790/run35586906307 attempt1，artifact10633047821完整ZIP19738089字节，独立复算SHA256为4d60975924e1b6c3ff75421535ff7f9efd2413ad639419fbb4c81cfd52fd83e2。主树.debug/hpcon-owner-35586906307/保存完整下载；原verifier本地重跑12/12、四resource-failure、无evidenceErrors，exit1。两份只读audit另存.debug/hpcon-owner-native-audit-35586906307.{mjs,json}与.debug/hpcon-owner-supplemental-audit-35586906307/，核对5739个manifest成员、138会话、92owner/46Close及1260样本；不替代原失败。Linux工具预算控制在独立树.debug/hpcon-guarded-budget-control-v1，未改Windows工件或冻结入口。

收口检查：主分支相对09f40dc6仅5份文档变更；设计仅同步第6节当前状态并追加第34节，第7–33节历史协议/结果原文保留。frontmatter、索引状态、架构标签、关联路径与计划必要章节、diff检查通过，executionSessionBridge回归通过。独立审查核对新结果与原始审计一致；未执行新业务/UI/packaged或真实Agent验收，不将文档检查计入原生样本。

2026-09-21 HPCON 运行前检查：独立分支新增 windows-hpcon-owner-patch.mjs、diagnose-windows-hpcon-owner.mjs 和 Windows-only workflow；主重构分支仅文档。固定源/header SHA256 为 d502cce570552c7a1bea373c7672975eeb330c3025dd151cf9c180ca2a1becc2 / 32b74fe493b4435bc2f8362cfa4bcb4f49a290438002cc4a369e9379c7728d3c；生成源 cb0ab01aa21eceeb06eac88306f4cf8980c15ede94303810a44df9b724c40e58，patch a7093eb560c76ac596892ab8d262f138fa3521d0b38162c4e6e6c4e7595a627b。主树 .debug/hpcon-owner-selftest-local-v1 与 v2 均保留，v2 保存输入快照；这些只有合成会话，无原生 PTY。bridge 回归及文档元数据/关联路径/计划章节、workflow YAML 校验通过。

2026-09-21正常对象控制补充审计：原verifier各driver在warmup计数失败后早停行为断言，另在新.debug/process-objects-supplemental-audit-35560063334/直接逐事件复核36份manifest成员、2176事件、92child/690快照及全部owner单次关闭；未改变计数、原oracle或工件。保留440个计数超额快照、四个原失败，补充audit自身exit1且无新增issues。源CRLF只读归一精确匹配cbbba096，全部自然退出/采样时序与最终owner结算可核对。元数据/索引/路径/计划章节、workflow YAML、diff和bridge回归检查通过；未执行新PTY/真实宿主/业务验收。

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

下一版本的候选接口是同步返回handle的 `startObservedCase(spec)`：observation、processSettlement、evidenceSettlement三个不可变首报Promise，另有只读owner快照和有界late事实订阅；process exit不代替capture真实EOF。D3每case最多预留caller/evidence/publisher三个槽，任一hard截止仍unknown停止后续case，不与D4的N2混算。writer、独立verifier与publisher仅为标准库诊断角色，不新增生产模块、外部服务或依赖。

D4 v2使用完整command/return/event/snapshot、不可变owner identity和独立oracle；创建acquisition/use token/单次owner整体release/首次unknown/当前证明/tombstone分账。schema和常量可共享，SUT转换/验证/snapshot helper不得被oracle复用。所有新文件与CLI尚未实现，运行时代码、旧live绑定、旧脚本/workflow及依赖保持不变。

本轮候选新增的 `startObservedCase(spec)` 返回observation、processSettlement、evidenceSettlement三个独立Promise；尚未导出实现。诊断台账的failureDomainId/allocationId/operationId只界定测试资源，不新增生产registry/wire；N/Q、D3毫秒数及W1/U1期限均不是生产策略。第一批只读使用锁定node-pty/native-addon-api源与headless consumer，依赖不升级，native副本按源hash/匹配计数和真实binary绑定；旧自然fork/guard/G07不改。
新设计定义的是候选类型与诊断CLI，不新增生产导出或依赖。D1实现ExecutionIdentity、ProcessResult（含signal-only/terminated/unconfirmed）、SourceResult、ResourceResult、OutputSeal和AuthorityResult的可执行约束；adapter唯一分配data sequence，资源/进程迟到补证独立于不可变seal。D2使用Node标准库且不加载node-pty，独立控制返回与stdio/进程事实。生产 `ExecutionSessionProcess` 能力、outcome wire及native释放策略均须后续评审，不把上述诊断文件导入业务。

本增量只新增诊断 fork 的 owner 状态接口：候选 native 必须提供受保护的 `shellExited` 发布和主线程 `closeAfterExit(id,generation)` one-shot 操作，并以带 generation/nonce 的 `markPipeEof`、`markConsumerComplete` 在 native 侧强制 Close 前提；它使用与创建/Release 相同的 bundled DLL 导出，记录 void Close 调用而不伪造返回值。现有 `PtyKill`、业务 node-pty API、Webview/Host/Supervisor 协议均不改变。三臂使用锁文件中的 node-pty、@xterm/headless、固定 Node/headers/compiler，不安装新依赖；所有源码/二进制/工具链 hash 随工件保存。

本增量是独立Win32普通进程控制，不加载native addon；新C使用CreateProcessW/WaitForSingleObject/ResumeThread/GetProcessTimes/GetProcessHandleCount/CloseHandle，JS只用Node标准库。未退出时GetProcessTimes的exitTime按官方说明未定义，仅记录不做零值断言。两类退出码和所有关闭由已知owner账本核对，不以image查询结果或全局对象消失作为验收。

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

修订记录（2026-09-21，资源归因冻结）：将macOS三arm因果对照与Windows只读类型取证固定为本增量，正readable控制另列后续。保留原schedule、资源断言及历史失败，只新增独立入口；原生结果待采集。

修订记录（2026-09-21，资源归因收口）：两次新输入共322条PTY及全量下载复核完成，macOS自然路径close因果证据成立，Windows类型增长已明确但映像查询31使具体归属仍inconclusive。首次编译失败、基线资源红项、旧断言不改；下一增量先设计已知HPCON资源owner干预，生产契约和正缓冲分支继续开放。

修订记录（2026-09-21，对象语义控制）：用户要求先确认正常Windows对象引用语义，本增量插入无PTY的retain/close/no-child对照，再另冻HPCON干预；保留旧失败并限定assert移除baton的源码表述。冻结提交为主分支922ad635、独立分支e601f911，尚无本轮原生结果。

修订记录（2026-09-21，对象语义收口）：完成首次原生矩阵和全工件复核，官方与正常对象实验支持用户提醒；保留四个+5初始计数失败、旧PTY具体归属未闭合及全部旧结果，不改业务/依赖/断言，下一步仅另冻已知HPCON owner干预。

修订记录（2026-09-21，HPCON 运行前审查）：开始实现已冻结的三臂对照，补齐单次连接、真实 HRESULT、TSFN/owner 生命周期、stock API 隔离和实际二进制输入的审查要求；保留新工具草稿缺陷的原因记录，待独立自测和 Windows 原生矩阵后另记结果，不改业务或旧证据。

修订记录（2026-09-21，HPCON 原生收口）：首次138条PTY与完整下载/原verifier/两份独立审计完成，固定bundled DLL自然路径建立最终Close消除逐会话+2的窄因果证据；正常Process引用存续不是OS缺陷，四个原资源失败与身份限制保留。另记guarded返回预算工具债务，下一阶段转生命周期/失败契约及新版本诊断，生产和总体交付未完成，计划仍active。

修订记录（2026-09-21，生命周期契约阶段启动）：按已登记下一步开始独立契约设计和故障矩阵冻结，先复核真实业务与平台接入点；本阶段保持不改业务和旧实验，不把自然路径窄因果直接升级为生产选型。

修订记录（2026-09-21，生命周期契约冻结）：完成独立设计与三侧复审，明确五类事实、类型/偏序/未知补证、读者候选及D1的37子案例和D2的72零PTY控制；新诊断尚未实现运行。既有定向回归与旧39项契约通过，不改业务或历史证据；下一步实施新工具及模型，整体方案和产品验收仍未完成。

修订记录（2026-09-21，D1/D2本地实施）：独立分支完成四个新诊断及三平台workflow；D1两运行时各37、D2新版Linux24完整本地复核通过，补真实Promise驱动观察和超时完整性分类，保留初版工件及旧失败。主树仅文档与既有回归，下一步runner首次矩阵/完整下载复核，生产接入仍未验收，计划active。

修订记录（2026-09-22，D1/D2首次远端收口）：三平台首次执行和全部工件下载复算完成，保留D1的111模型通过、D2原72控制pass及raw失败。独立审计确认Windows G07的三项真实关闭前提缺失，定位固定libuv标准fd close为no-op；不改旧输入或追认全部通过，下一阶段先另冻前提控制，再推进原生失败矩阵，整体计划继续active。

修订记录（2026-09-22，G07补证冻结）：新增Windows原生已知写端关闭/独立控制通道协议，固定三模式各三次与双challenge存活证明；原guard和预算不变，正负控分别判定，先实施隔离工具再首次原生验证，不修改业务或旧实验。

修订记录（2026-09-22，G07工具实施）：完成隔离C/JS/workflow和27项增强合成自测，保留21项首稿记录；收口native错误枚举、outer事件独立派生、通知偏序及语义负例缺口，更新实际可用命令和源指纹。下一步只运行固定输入首次Windows矩阵，不改旧实验或声明产品完成。

修订记录（2026-09-22，G07首次原生收口）：固定cf359040的首次Windows九项控制、完整ZIP及可信入口/836项独立raw审计完成；三个新正例补齐真实关闭后存活前提，六负控按预期拒绝且raw分类不改。更新全部活章节和证据入口，旧三条G07仍not-established、旧失败与原始工件不变；下一步原生异常/unknown owner有界隔离设计与矩阵冻结，业务和生产预算未改，计划active。

修订记录（2026-09-22，原生异常设计启动）：承接G07窄补证和外层观察缺口，开始跨平台源码核查、owner隔离候选比较及下一矩阵冻结；未预选生产进程拓扑、数值预算或提前宣称异常路径通过。

修订记录（2026-09-22，原生失败第一批设计）：新增失败分层、逐资源台账、隔离候选及D3/D4/W1/U1第一批冻结；复审修订unknown定义、唯一Windows失败点、资源观察截止、分阶段预算、控制权链和洪泛偏序。当前没有新工具或原生运行，先实施D3/D4，第二批和生产接入继续开放，不改历史结果。

修订记录（2026-09-22，D3/D4及v2主树同步）：补v1两run失败、跨pipe oracle根因、真实迟到和144次D4模型计数；同步v2来源/順序窄协议及local-1覆盖不足/local-2增强证据，脚本与工件明确只在诊断树。更新四活章节和当前步骤，固定b4db41cc唯一新runner待完整审计，不把本地快照倒写成commit运行；三settlement/writer/D4身份与W1/U1继续阻塞，业务和image.png不改。

修订记录（2026-09-22，v2唯一runner收口）：完成三平台全部1359成员、15输入与原始trace独立审计，记录各full24/scaled24/oracle78/parser8/tamper24/23及Windows真实跨pipe倒序正确接受；不重跑、不改变500ms缩放预算，不追认旧失败。仅关闭来源/顺序窄验证，下一阶段另冻完整结算/writer/D4身份协议，原生及生产交付继续开放。

修订记录（2026-09-22，新诊断结算设计冻结）：完成D3 v3/D4 v2协议和运行前矩阵的设计写入及外围文档同步，实施与验证待办不关闭；本阶段零新测试/native。最终静态复审及文档一致性检查已通过，下一步独立树本地实施/fixture/源码复审，再唯一三平台采集，不改旧实验或推进业务。
