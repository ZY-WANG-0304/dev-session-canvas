# 验证退出完整性的原生候选

本 ExecPlan 按 `docs/PLANS.md` 持续维护。正式候选、冻结参数和结论见 `docs/design-docs/runtime-exit-integrity-native-candidates.md`；第31节之后的共享生命周期及 D1/D2 新诊断契约见 `docs/design-docs/runtime-execution-lifecycle-contract.md`。

## 目标与全局图景

用户需要正常结束时完整看到终端尾部，而不是把进程退出当成输出已结束。本阶段只验证隔离 reader 和资源生命周期，不改变生产会话。PR #294 已提供公共接口基线；本阶段通过 macOS 独占 fd、Windows 独立 pipe worker 等原生对照，证明或否定候选可行性。

已有局部自然路径证据已转成 provider/adapter 候选契约，有限模型D1与诊断硬返回工具D2已实现并完成本地及三平台首次运行。provider指原生进程/终端资源的持有者，adapter指统一进程、源和资源事实的共享适配层，authority指Supervisor或直接Host的终端事实维护者。D1三平台111条注入模型已验证；D2原verifier72pass保留，旧Windows G07三项因标准句柄close未实际生效继续not-established。新的cf359040/run35631266321九项独立控制已补真实关闭后存活的窄前提，详见共享契约第16节；下一步原生异常路径与unknown owner有界隔离设计，不追认旧矩阵或提前改变用户会话、宣称产品修复已通过。

两轮原生对照已经完成。2026-09-20 用户进一步明确：画板管理 Terminal / Agent 执行会话与终端资源，不默认在实际主进程退出后维持终端等待普通后代未来输出；这不以父子关系判断前后台。主进程仍运行时，同一终端收到的输出正常处理。退出时仍必须处理主进程尾部及自身已接收、排队、消费中的内容，应用最终终端状态并释放资源；实际退出、真实源结束、消费完成和主动取消不得混淆。具体收尾边界、取消条件和预算仍待确认。启动器启动的实际 Agent CLI 是执行主体，不适用普通工具后代的排除条款，需独立验证启动链生命周期。本计划下一增量以这些保留要求为先，不再把 macOS 普通后代延迟输出实验当作独立产品门禁。

## 进度

- [x] (2026-09-22) 独立诊断树已创建D3 v3/D4 v2八个新入口，本轮只收口本地工具初版与审计修正，主运行时仅同步文档；不运行D3真实36+2+4、不新增runner、不推送，不改业务/旧实验/image.png。
- [x] (2026-09-22) D4 local-3 self-test/full及离线各16/16、302命令、58预期拒绝、1924 checks；93语义、4 saved和另存7个重hash sidecar负例通过。unknown key碰撞初次失败保留，tuple与sidecar修正经独立复审无新确定性阻断。
- [x] (2026-09-22) D3本地初版审计已形成正式 self-test-2：oracle119/core41/文件15/archive-consumer-binding25，各自通过；saved旁证attempted4/verified4、88 members、四源原字节exact。boundedConsumerDelivery=false、acceptanceReady=false，仍不代表冻结覆盖、live36+2+4或原生验收。
- [ ] 按契约第12节逐fixture补齐D3六组剩余覆盖、超时首报独立消费预算与完整工具验收；D4补create/use unknown迟到清除独立正例。真实D3矩阵、三平台新采集和W1/U1均未启动。
- [x] (2026-09-22) 完成下一版诊断结算契约设计与运行前矩阵冻结，新增 `docs/design-docs/runtime-diagnostic-settlement-contract.md`。D3进程/时钟、writer/封存和D4身份重放的三侧源码/协议复审建议已纳入；三侧最终静态复审及两树文档一致性检查通过，本阶段零新测试、零native，旧入口/工件与业务不改。
- [ ] D3冻结覆盖与独立工具门槛收口后，另行确认每runner36主控+2gate+4publisher真实采集；D4本地16项不算三平台模型48项已执行。
- [ ] 本地门槛收口后，以固定新commit唯一一次三平台完整采集、全工件下载与可信Git oracle重放；W1/U1仍须等待这些诊断门槛，不因设计冻结启动。
- [x] (2026-09-22) 完成三侧最终静态复审与两树元数据/索引/路径/历史保持/一致性/diff检查；每树8份文档、4份设计元数据、12个计划章节，旧业务/脚本/workflow不变。只验文档，不计新矩阵或产品通过。
- [x] (2026-09-22) 完成Windows/Unix/工具三侧源码核查与设计冻结；当时D3的72控制、D4的24逻辑模型及W1/U1的66driver尝试均未执行。实际v1每runner执行全部24项D4逻辑模型，三runner为72次，见当前结果。
- [x] (2026-09-22) v1输入7141cfa3首次run35673511893及误触同SHA重复run35673550930均完成并保留failure；Windows D3的跨pipe顺序误判属于诊断oracle问题，不作平台/产品缺陷结论。
- [x] (2026-09-22) 冻结D3 v2来源/顺序窄协议：caller发送端全局seq与身份、observer真实通道/接收时间、仅fd3的after-await、同pipe递增/跨pipe任意到达、有界4096全帧解析、显式协议失败、D3-08 ACK后bulk和唯一bulk缺口豁免。
- [x] (2026-09-22) v2两个入口、独立oracle测试及仅D3三平台workflow已实现；Linux Node22.23.2本地oracle78/78、parser8/8、缩放positive24/24与篡改拒绝、完整未缩放24/24 verified，三个源码语法通过并保存hash。
- [x] (2026-09-22) 独立复核发现local-1 tamper仅报attempted24/verified0：根manifest错误短路run.scale读取，自测只检查总fail/首项，未证其余案例有效。保留local-1 positive/full24和旧工件，修正为manifest/run检查独立及强制24 attempted/23 verified/末项无错误。
- [x] (2026-09-22) local-2增强自测oracle78/parser8/positive24通过，tampered-verification.json为attempted24/verified23且仅shared-manifest与D3-01-1错误；local-2-full未缩放24/24 verified、无evidenceErrors，最终CLI语法/diff及独立输入/重放审计通过。
- [x] (2026-09-22) b4db41cc唯一push run35676427931 attempt1完成三平台及三ZIP/15输入独立复核；每平台full24、scaled24、oracle78、parser8通过，tamper24 attempted/23 verified；Windows实际跨pipe倒序由源序判据正确接受。本地采集仍按工作树快照记账，runner另有commit绑定，不追认v1失败。
- [ ] D3三独立settlement、deadline不可变首次快照、bounded unconfirmed、独立evidence结算及D4完整重放/身份oracle继续开放；本次窄修正不完成这些阻塞项。
- [ ] D3/D4收口后实施并验证W1/U1；其余通知/环境销毁、正缓冲取消、真实Close挂起与双会话隔离需第二批另冻，不宣称全部异常矩阵已冻结。

- [x] (2026-09-22) 承接主树f318579a/独立树7fb4ae9e的G07结果，开始原生异常与unknown owner有界隔离设计；按Windows、Unix和工具观察三个独立方向核查源码，不修改业务或旧输入。
- [x] (2026-09-22) 完成故障层级/owner处置候选比较、D3/D4/W1/U1第一批冻结及三侧独立复审；正式设计/索引/原则/债务同步。其余原生异常第二批未冻结，下一步实施新诊断而非业务接入。
- [x] (2026-09-22) 在独立诊断树实现D3观察外壳初版和D4有限owner模型：D3使用真实额外fd3/fd4控制管道、after-await ACK、caller/process/writer最终trace记录、有限帧与最终trace校验；D4实现N=2/Q=1 owner模型、跨generation保账和事件独立重放。两者均支持`--self-test`、`--output NEW_DIRECTORY`、`--verify-saved DIRECTORY`，不创建PTY或native资源；三独立settlement接口仍未实现。
- [x] (2026-09-22) v1本地Node完整schedule的D3 24/24 trace/manifest、D4三平台逻辑各8项共24/24及篡改负例已复核；当时未取得runner，后续结果另列。D4显式记录native:false/nativeProcesses:0而无pty:false字段，零PTY仍按模型代码及范围说明。
- [x] (2026-09-22) 首次foundation runner `run35673511893` attempt1已下载完整三平台工件：Linux/macOS D3各24/24；D4每runner全24项、三runner共72次模型执行。Windows D3在D3-01-1因跨pipe接收顺序被误当caller因果而失败，原始trace/断言/工件不改。v2尚待新输入验证，不把发送端身份协议写成已经原生通过。
- [ ] 下一新诊断补外层调用方await后与结算I/O预算观察；本轮outer-returned仅为resolve前事件，不能替代完整返回证明，不改旧工具/工件。guard九项调用方时间已另行补算通过。
- [x] (2026-09-22) 新C/JS/workflow已实现，v1合成21项保留，v2独立oracle27/27，零native；源码/协议/outer原始事件和语义负例复审已收口，JS/workflow/文档检查及主树bridge回归通过。详见生命周期契约第15节。
- [x] (2026-09-22) 固定cf359040/run35631266321 attempt1完成Windows/MSVC九项矩阵、完整ZIP下载、可信入口复算及836项独立raw检查；三个正例建立前提，六个负控按预期拒绝，原始分类保留。旧Windows G07三条仍not-established，详见契约第16节。
- [x] (2026-09-22) 生命周期契约第14节冻结Windows G07补证：close-wait、keep-open、close-exit各3次，真实关闭自身stdio后双fresh challenge证明主体仍执行，零PTY、原guard-v2及预算不改。
- [x] (2026-09-22) 新C/JS/workflow、完整离线校验与负控自测及复审已完成；首次Windows九项及下载复核单列待办，未验证不宣称缺口已闭合。
- [x] (2026-09-21) 根据用户提醒核对Windows正常对象语义与HPCON最终释放契约，设计第27节先冻结无PTY的六driver/92child控制；既有资源失败与具体归属inconclusive不改判。
- [x] (2026-09-21) 新C/JS/workflow与独立只读审查完成，合成自测覆盖正常对象、错误计数/假退出/重复关闭/未释放/强杀、二进制绑定、活动owner槽位冲突及损坏/缺工件后继续；Linux仅验证工具逻辑。
- [x] (2026-09-21) cbbba096/run35560063334 attempt1完整执行六driver/92child/690快照并下载复核，MSVC编译成功，两个control通过、四个初始计数失败保留；正常保留/释放和退出后image31有原生证据，+5背景归属未知。
- [x] (2026-09-21) 按设计第29节冻结 Windows bundled-DLL 已知 HPCON owner 的三臂隔离释放协议：stock、owner-retain/no-close、owner-retain/explicit-close；builtin、业务和旧实验排除在本增量外。
- [x] (2026-09-21) 独立分支 e8740f53 / 7c29404e 实现候选 native transformer 和三臂入口；静态复审及本地 v1/v2 合成自测通过，最终覆盖真实 Release HRESULT、owner/EOF/consumer 缺前提、工件损坏后继续和有意资源失败。当时新 workflow 已准备、尚无原生结果，后续首次运行见下一项。
- [x] (2026-09-21) 输入d0f0be882bf5f99d0dcaa90c94b7a3d6b0023790执行run35586906307 attempt1，完整下载artifact10633047821并本地复算ZIP；12driver/138会话/1260快照均复核，四个no-close资源失败保留且无evidenceErrors。
- [x] (2026-09-21) 实现前复核补充 stock API 隔离、两候选共用产物、实际 OpenConsole.exe 绑定、Release 的实际 HRESULT 签名和 native 单次 connect/退出失败门控；这些是新诊断的有效性要求，不是 Windows 产品缺陷结论。
- [x] (2026-09-21) 首次HPCON矩阵建立正常自然路径的窄因果证据：两no-close臂每会话+2，explicit-close两轮191稳定，46次单次Close均193至191且owner归零；138条内容/真实EOF成立，不外推生产或具体内核对象身份。
- [x] (2026-09-21) 独立Linux纯Node控制确认guarded只等child.close不是硬返回预算：150ms watchdog后close仍晚884.470223ms；本次Windows无命中，原工具/工件不改，登记下轮新版本修复。
- [x] (2026-09-21) 同步独立生命周期契约及候选设计第31节，分开进程、源、authority应用、页面结算与资源事实；补signal-only/terminated/unconfirmed、同操作迟到补证、连续序号、解析屏障、opt-in close outcome及独立能力组合。本树业务锚点明确来自主运行时分支0518dcc4，尚未实施。
- [x] (2026-09-21) 冻结 D1 的24组37独立子例和 D2 的8子项各3次矩阵；诊断参数不升格生产预算，旧脚本/工件/断言不变。当时仅文档，无新模型或原生运行通过记录，后续本地实施见以下新增进度。
- [x] (2026-09-21) 跨平台与跨层只读复审补创建前provider/adapter/authority sink闭环，M01同步覆盖open返回前首块/退出。主运行时树既有bridge、tracker、Supervisor协议聚合及旧39项契约通过，证据在该树.debug/lifecycle-contract-design-v1-node25；不计作本树新D1/D2验收。
- [x] (2026-09-21) 独立树6份docs同步完成；两设计YAML/索引/关联路径/架构名称、12个计划章节、TS片段语法、D1的24组37子例及D2的72条计数校验通过。新契约除明确分支引用外与主树逐段一致，历史1–30节除第6节当前导航外不变，diff检查通过。
- [x] (2026-09-21) 本独立分支实现D1/D2四个新文件及独立校验器，完整schedule/源码/运行环境/原始trace归档，首项损坏后继续全部校验；只用Node标准库，业务、依赖及旧入口未改。
- [x] (2026-09-21) D1正式本地Node25.6.0和Electron39.8.7内嵌Node22.22.1各37/37及完整离线复核通过。v1自测原样保留；v2改为harness观察真实Promise引用/完成值，37正例及12类负对照通过，不追认v1新增证明。
- [x] (2026-09-21) D2正式local-first的24项控制与完整性表达不足分开保留，旧快照复核不改判；新local-v2-deadline-integrity完整24项及离线通过，最长1952.428426ms，raw仍9natural-exit/3spawn-error/12deadline-exceeded，18real/6synthetic、零PTY。最终自测25项通过。
- [x] (2026-09-21) 三平台固定Node22.23.2的新workflow已创建，不安装依赖，D1/D2分别执行/复核且失败也完整上传；独立只读复审已收口已知工具问题，主树bridge/tracker/Supervisor协议聚合本轮再次通过。
- [x] (2026-09-21) 固定d173c099/run35620967433 attempt1完成三平台D1各37项、D2各24项，三个ZIP各1280成员完整下载及源码输入/离线复核；D1共111条已验证，D2原verifier72pass，无工件错误，54real启动控制/18synthetic、零PTY。
- [x] (2026-09-21) 追加Windows审计定位G07前提缺口：固定Node22.23.2的libuv对fd<=2不实际_close，fs.closeSync(1/2)没有提前关闭stdio；三项仅观察到相邻的关闭/退出JS通知。原success/24pass、其余69项依据与全部工件不改，D2不宣布整组完成。
- [x] (2026-09-22) Windows G07真实stdio提前关闭及独立主体存活控制已在契约第14节冻结；新入口/输入/工件实施与原生执行单列当前待办，不修改旧冻结脚本、门槛或重跑求绿。
- [ ] 新G07补证完成，下一步逐平台设计并另冻partial-create、wait/通知、取消/正长度readable、释放失败/挂起、两个并发会话和unknown owner有界隔离；builtin、旧Windows及实际Agent/宿主/packaged继续开放，不直接接入业务或选定生产预算。

- [x] (2026-09-21) 按设计第25节冻结本增量：macOS三arm最小close对照和Windows只读类型取证，保留原资源失败；正readable控制另列后续。
- [x] (2026-09-21) 新独立入口及两平台workflow、本地机械变换/合成负例/完整失败遍历和Linux隔离构建布局预检完成；补构建链接归档、跨平台路径及有效负结果分类。
- [x] (2026-09-21) 固定944fe103/run35527241793与仅修诊断C命名的5a7ed5c4/run35527528410，完整下载复核。macOS两轮各138条PTY建立最小close因果证据；Windows首轮零PTY编译失败保留，次轮46条完整、File+Process增长已确认，具体归属仍inconclusive。

- [x] (2026-09-20) 按设计第23节冻结Windows四类各三次取消所有权与三平台同进程资源矩阵；独立driver各3预热/20测量，完整保留旧证据，不改业务。
- [x] (2026-09-20) 新worker/资源观察器/诊断/workflow实现，最终自测涵盖真实+3/-3文件计数、TCP四类、所有权/EOF/增长负例及全失败/单损坏遍历；Linux v1/v2各四driver、46条PTY及完整复核通过，原输入保留。
- [x] (2026-09-20) 输入b031b598的run35519226627 attempt1三平台完整运行并下载复核：Windows12项取消/自然对照通过，三平台各46条自然会话内容通过；macOS两组kqueue各+20、Windows两组handles各+40，四个资源失败保留，全部24个driver工件有效。
- [x] (2026-09-20) 两工作树各五份文档同步，设计状态/索引/关联路径/计划章节与diff检查通过，Windows CRLF输入只读归一核对、所有cleanup/guard审计通过；bridge回归通过，业务/依赖/旧入口零修改。
- [x] (2026-09-21) 历史资源矩阵提出的已知HPCON owner隔离释放已由第29–30节完成；旧具体对象身份inconclusive不改判，正长度JS readable-buffer取消与生产验收仍在当前下一里程碑。

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
- [ ] 继续Windows正长度JS缓冲取消、native资源owner回收与异常路径、真实provider/宿主及生产契约；Apple kqueue自然退出最小干预证据已完成，不据此关闭整体计划。

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

本轮D4首轮绿色仍漏掉合法ID含/的unknown key碰撞：两个owner被合并成reused，unknownCount从应有2变成1。首次反例保留在独立树 `.debug/owner-quarantine-v2-key-collision-first-failure`；改JSON tuple并在固定D4v2-05回归，未新增平台标签或改旧失败。sidecar仅hash自洽而未与可信预期核对的缺口也已修，7个独立重hash负例拒绝。snapshot是内部状态隔离深拷贝，不额外宣称JS深冻结。

D3 cross-replay-1对纯正常core样本的误拒来自oracle多算stdin JSON换行1字节；实际core只发送JSON并以EOF分隔，修正移除多算字节而不改core输入。迟到错误必须按首报ordinal截断，不能回溯污染原首报；owner/unknown/event/scenario与归档身份也要独立重放。首轮自测的局部绿色不替代冻结覆盖，剩余六组及最终证据见诊断结算契约第12节。

新设计的源码复审确认：D3 v2的close后单一Promise、事后首报和writer sealed claim不足以满足独立结算；observer内写盘也不能隔离同步I/O。D4 v1的unknown状态可被release-in-flight覆盖，create失败可替换acquisition，完整身份/参数/操作账没有被独立重放。均为固定源码中的诊断缺口，不是本阶段新增原生或业务缺陷复现。

协议复审补充了exit与capture gate分离、等时先冻结deadline、错误sticky、共享helper预算、publisher不能自证本次发布成功，以及D4零资源失败not-required、completed操作复用优先级、batch应用token和逐subject未知补证。详细可实施约束以新设计为准；三侧最终静态复核已收口，不把设计收口写为测试通过。

v2首次Windows完整D3-01-1仍出现跨pipe到达倒序，但caller源序与时钟合法；固定Git入口和独立raw复核均正确接受。这与纯重放负例共同支持窄修正，而不是偶然未触发问题。三平台本次after-await/writer原始最大值未超2000ms完整或500ms缩放预算；只作为本次事实，不能替代尚未实现的writer预算oracle和独立结算。

v1首次Windows D3的stdout与fd3帧出现跨pipe到达顺序反转，v1 observer按收到次序补sequence，使合法caller流程被误判。该问题并非Windows专有的产品缺陷：独立pipe本来没有共享到达顺序保证，Linux/macOS此次绿色不证明该假设有效。另误触同SHA重复run35673550930，结果同样failure；不算修订后的对照、不用于筛绿，两个run均留证。

审计还区分逻辑schedule与运行载体：D4 CLI在每个runner执行linux/darwin/win32三组共24项，三runner实际72次模型，而不是原冻结叙述的总24次；工件含native:false/nativeProcesses:0但没有pty:false。D3-08 v1没有证明bulk开始前observer已确认after-await，本轮v2加fd4 ACK前提，其他三settlement、deadline首次快照、bounded unconfirmed、D4重放/完整身份仍未实现。

两次Windows自测positive分别23/24和21/24；重复run新增D3-07-1/08-1接收504.2253/543.014ms超缩放500ms，不能全部归为顺序误判。writer结算另有554.9569/630.9223/608.3949ms超500ms，原verifier未全部核验，预算债务保留。positive失败使两次最终self-test报告和tampered负例都未产生，不补造；v2保持相同缩放预算。本地v2的bulk首次overflow后锁定拒绝，避免后续较短时间戳帧重新准入，D3-08仅证明observer ACK发送与caller源码await控制流，并没有额外caller ACK接收事件。

local-1 tamper负例随后暴露另一校验缺口：根manifest抛错使run.scale未赋值，所有24项均失败却被“总fail+坏首项”断言接受，原verified0没有证明其余23项继续有效。修复让根manifest和run读取分别留错，增强自测必须attempted24/verified23、末项无错误并保存完整报告；local-1正例/full24仍是真实通过，不改原证据。writer非法帧可能被其他sealed事实掩盖，则属于完整writer协议/独立evidence结算后续债务，不扩入本次实现。

本次只读核查确认两平台均有“资源已取得但后续初始化仍可失败”的窗口：Windows在CreateProcess成功后到hShell登记前先做DLL/Release，Unix主体/master创建后才设置nonblock并建立waiter。未知不只可能是未见返回，也可能未证API进入，或API已失败返回而部分副作用仍不明；故进入/返回证据和资源处置必须分开，不能以lifecycleFailed总开关丢弃责任。这些是静态输入，不是本轮已复现异常。

设计复审还指出：100ms扣留回执在30s工作期限内不自动成为unknown，U1-5因此单列100ms资源观察截止及先unknown后放行；writer预算与操作预算分阶段，不在35s操作截止截断刚开始的2s证据窗口。D3洪泛须发生在after-await确认之后，控制区与bulk容量分开；只有真实await后及独立接收能证返回，resolve后同栈写盘仍会挡住续体。

收口复审区分了guard-returned与调用方await后事件：前者在resolve之前，九项真正controller-guard-observed最大1012.3385ms、均在2000ms内。outer-returned之后尚有同步写盘和resolve，九份outer trace没有await后时间；只能证明controller已退出/捕获已close且事件在5000ms内，不能宣称完整外层返回预算已独立证明。此为诊断观察缺口，不改变G07前提判定；原审计保留，补充计时另存timing-observation-audit-v1.json，下一新工具承接。

新close-exit-3原始轨迹中双流最晚close为20.7513ms，父端21.1521ms尝试challenge，21.4268ms观察到控制通道不可用，child-exit通知21.7708ms才到，但没有pong。其前提正确拒绝，直接说明通知偏序不能证明主体仍可执行；正例才以双EOF后两次fresh响应建立窄前提。keep-open三个预期超时仍为deadline-incomplete，不能因为迟到EOF或整个控制套件通过而升级自然完整。

新工具初稿的native ERROR大小写、outer结果自报及只改冗余字段的token负例已在独立复审中修正；v1自测保留，v2才有增强证明。native EXITING与child-exit的父端通知顺序不能代表主体操作顺序，新oracle保留两路原时序，只要求许可先于退出及主体内序号/回执一致，未放宽第14节的双fresh挑战前提。

新G07协议不只替换close函数，还要排除CRT重复关闭、控制与输出共用通道、fresh token提前生成和把任意负控异常当成功。私有命名管道在输出关闭前建立，父端同一时钟核验双EOF后两次响应及至少100ms持有，C仅关闭自己继承的写端并用ExitProcess结束。本地合成自测不替Windows操作证据。

三平台原verifier均报告D2 24pass，但追加Windows源码/原始时序审计发现G07缺失关键前提。官方Node22.23.2的deps/uv/src/win/fs.c::fs__close仅对fd>2调用_close，标准fd直接返回成功，所以fixture的fs.closeSync(1/2)没有关闭stdio；end/close只比child-exit JS通知早约0.27–4ms，不证明流关闭时OS主体仍活。Windows三项须标前提未建立，而不是把原pass改成已有产品失败；其余69条控制和全部guard有界返回观察保留。详细证据见共享契约第13节。

D1初版M18由模型自报同Promise不能独立证明幂等返回，v2改由harness比较真实Promise引用及两个fulfilled值，并保留旧自测。D2首份正式本地24项虽control-pass，但G04/G05的deadline后管道end被写成captureIntegrity=complete，未显式保留整次采集不完整；新分类deadline-incomplete保留真实endObserved而不抹去超时。新v2完整24项与离线通过，旧目录只按旧快照复核，不补造新增证明，详见设计第32节与共享契约第11节。

D2控制通过不等于每条raw都成功：本地新v2及后续每个平台均含12条deadline-exceeded、3条spawn-error及9条natural-exit，18条真实进程/启动控制与6条synthetic分别统计。G04协作回执和stdio结束不证明helper已被独立OS wait确认；本地Linux结果本身不能外推Windows Job前提或macOS行为，远端实测另存。捕获错误、外层5000ms自然截止和超时后的真实EOF均由独立原始事件校验，额外1000ms观测不是自然成功宽限；spawn失败时空捕获通道完整结束也不代表进程创建成功。

本阶段只读核查发现旧进程整数exitCode模型无法表示wait已证明终止但退出状态未知，新候选用terminated与unconfirmed分开；资源unknown是某时刻观察，同一释放操作迟到返回可补证，但不改首次超时结果或重复Close。authority串行journal操作不等于tracker异步解析完成，现有Webview已有应用屏障，但旧close不能表达applied/cancelled/lost；这些业务锚点以主运行时分支0518dcc4为准，不写成本树已完成改造。

固定node-addon-api7.1.1的TSFN在env/callback均为空时不执行CallbackWrapper，callback内部RAII不足以证明环境销毁时已排队payload回收；CreateProcess成功后hShell登记前仍有Release/通知初始化失败窗口。二者只是静态输入，不是新复现native泄漏。D2的stdio继承控制也不能用公有Node API虚构兄弟helper写端，改以受控后代nonce/有限TTL建前提，不能按日志PID获得强杀权限。

首次HPCON原生运行中，stock与同工具链owner-retain两轮均每会话+2，而共用同一native的explicit-close两轮191不增长；46次Close前后均193至191。92次真实Release HRESULT为0，138条内容/EOF/消费和自然生命周期完整，不能把Windows正常对象引用当OS bug。新矩阵只有总量，没有类型或内核对象ID，因此旧File/Process配对与image31的具体归属仍未补齐，见设计第30节。

guarded()的150s timer只发送kill，Promise仍只等child.close；driver退出不代表stdio已关闭。独立Linux纯Node控制复现driver在150ms前退出、kill返回false后close仍晚884.470223ms，总等待1043.413464ms。本次Windows12driver均无watchdog命中，这项新工具债务不改变正常完成证据，但下轮新入口必须独立约束返回预算并保留真实取消分类。

运行前草稿的静态复审曾发现重复 connect、stock 调用候选接口、移除 owner 后访问、TSFN/等待状态未核验及机械转换破坏定义等问题；当时先修正并自测，之后才执行第30节首次runner。Windows 实际配套程序为 OpenConsole.exe，Unix spawn-helper 不在本路径。原 conpty.cc 将 Release 当作 void 调用，但同包 conpty.h 声明真实导出返回 HRESULT；应按该头文件记录结果，而不是伪造成功或把 Release 与 void Close 混淆。该组发现属于新增诊断工具，不自动外推到业务缺陷。

官方 ClosePseudoConsole 是 void，且旧版本可能等待客户端断开；候选必须在真实 pipe EOF、worker/input close、decoder/consumer complete 后调用，不能把 Close 调用本身写成成功返回。PtyKill 混合 Close 与 TerminateProcess，不能复用。退出线程中的 baton erase 还可能与主线程查询竞态，因此候选必须显式同步 shellExited/hShell=NULL 与 HPCON owner 转移。

首次普通进程控制在四个child driver预热后都有额外+5，release-each后续稳定60，retain从63逐次至83、关闭23个后回60而非初始55。所有92个已知hProcess/hThread均单次关闭成功，不能把额外5直接叫这组owner泄漏或OS bug；无类型/调用栈，lazy初始化等解释未证实。暂停态image92次成功、退出后368次31与稳定PID/time/exitCode并存，支持正常对象语义但不补造旧HPCON身份。

官方PROCESS_INFORMATION/CloseHandle确认已退出进程仍被句柄引用是正常语义；ReleasePseudoConsole明确不免除最终Close职责。conpty.cc的remove_pty_baton置于assert，NDEBUG可消除其副作用，不能未经binary证据称实际已移除；此补记限定历史源码表述，不更改旧运行结果。

第二run35527528410 Windows全46条内容/自然退出通过而handles逐次+2；840次前后表和83685次类型查询成功，唯一错误是2730次QueryFullProcessImageNameW返回31。增长细化为PIPE类型File与已退出的非fixture Process，但未证明OpenConsole/signal pipe归属，也未证明错误31的查询时机原因。macOS两轮同工具链close对照均消除kqueue增长，基线红项保留，见设计第26节。

首次run35527241793中macOS三arm/138条PTY及完整离线对照达标，但Windows新增观察器的boolean辅助函数与SDK typedef冲突，零PTY。这是Linux纯逻辑自测不能覆盖的原生编译问题；保留原输入/失败，按设计仅重命名新增诊断辅助函数，另采新输入，不改变原oracle或产品结论。

运行前源码审计发现macOS必须加入同工具链rebuilt-baseline，且node-pty嵌套node-addon-api版本不同于仓库顶层，不能混用。Windows固定DLL的Release只释放部分成员、Close另释放其余成员，支持继续取证，但当时尚未原生确认类型/归属，现类型已由本轮取证补齐、具体归属仍开放。两项均为实验设计输入，不写成生产已修复。

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

- 决策：本阶段只交付独立诊断的本地初版与审计修正，不执行D3真实36+2+4、不新增runner、不推送；下一步逐fixture补齐冻结覆盖，之后另行确认真实矩阵。理由：自测总数不能替代覆盖与独立oracle有效性，保留首次误拒和模型碰撞证据。日期/作者：2026-09-22 / Codex。
- 决策：D4复合unknown key采用无歧义JSON tuple，负例sidecar与verification逐份按可信输入复算；保持固定16项和旧证据不变。理由：ID允许/，拼接key和仅hash自洽都可能把不同责任/错误证据误判为同一对象。日期/作者：2026-09-22 / Codex。
- 决策：消费者续体与首报冻结分账；deadline前首报的消费者到达同deadline或之后为迟调失败，到期才冻结的超时首报只保存延迟并标delivery-budget-unresolved，独立消费预算另冻。理由：后者不可能在原deadline前被await，不伪报及时、不加宽限或改首次deadline。日期/作者：2026-09-22 / Codex。

- 决策：新增D3 v3/D4 v2设计，不修改旧D3 v1/v2、D4 v1及工件；三不可变首报、捕获真实EOF、writer/verifier/publisher分责及D4全账独立oracle分别验收。理由：来源/顺序修正已经提供窄证据，不能继续以旧摘要或同步归档代替完整结算；版本隔离保留历史失败。日期/作者：2026-09-22 / Codex。
- 决策：先本地新入口、固定fixture/源码hash和独立源码复审，再唯一三平台采集。D3每runner36主控、2gate、4publisher，D4每runner16模型分账，不扩为native或生产承诺。理由：证明层级与故障注入性质不同，设计计数不能冒充执行结果；W1/U1继续由工具验收门槛阻塞。日期/作者：2026-09-22 / Codex。

- 决策：以唯一b4db41cc/run35676427931完成v2窄验证，不再重复该矩阵；下一阶段先补三settlement/首次快照/有界unconfirmed/writer及D4完整身份契约，再决定W1/U1。理由：固定Git输入、三ZIP和原始事件已经支持来源/顺序修正，但未覆盖的退出/封存能力不能由绿色workflow代证。日期/作者：2026-09-22 / Codex。
- 决策：将根manifest错误与run元数据读取分开，tamper自测从“整体失败”加强为24项已尝试、23项有效、坏首项被拒绝且末项无错误，追加tampered-verification.json。理由：一个共享初始化短路不能冒充失败后完整遍历证明；保留local-1原positive/full与覆盖不足，local-2另存新证据。writer非法消息与sealed冲突留给完整writer协议，不混入来源/顺序窄改造。日期/作者：2026-09-22 / Codex。
- 决策：7141cfa3的v1及两个failure run冻结，新增两个v2文件只修来源/顺序oracle和D3-08 ACK前提，不趁机实现完整settlement。理由：先恢复跨通道诊断证据的可解释性；跨pipe顺序误判不能靠放宽时限、忽略错误或重写旧工件解决，其他审计阻塞项仍单列。日期/作者：2026-09-22 / Codex。
- 决策：发送端分配全局seq/身份，observer独立记录真实通道和有限非负接收时间；仅同pipe要求递增，after-await仅fd3，所有非法协议明确失败，D3-08仅显式bulk区段可缺序。理由：源因果、物理来源与及时性互不代证，ACK后bulk才能建立洪泛场景的冻结前提。日期/作者：2026-09-22 / Codex。
- 决策：新增原生失败与资源隔离设计，先冻结D3/D4及W1/U1第一批，第二批通知/取消/Close/并发明确列为生产阻塞而不虚构安全注入。理由：创建/等待有可实施的已知owner控制，其他故障仍需不同所有权/处置前提；首批结果可用于收敛后续方案，不以大而未定义的矩阵冒充完成。日期/作者：2026-09-22 / Codex。
- 决策：N=2/Q=1只作为诊断准入政策；共享进程封禁、worker线程、创建前专用进程分别比较，不选择生产拓扑或新增server。理由：停止新建能限制owner数量，但不能隔离原生卡死/崩溃；释放未知既不能盲Close，也不能靠重启整个Supervisor影响B。日期/作者：2026-09-22 / Codex。
- 决策：新工具将操作返回、进程结算、证据writer分成独立结果/期限，最终健康归档失败不豁免证据完整性。理由：同栈同步写盘会阻挡await续体，writer故障不能改写已证操作结果；顶层OS调度和最终存储环境不由无限watchdog自证。日期/作者：2026-09-22 / Codex。
- 决策：以cf359040/run35631266321首次九项及全工件独立复核收口本轮G07补证，进入原生异常/unknown owner有界隔离设计，但不追认旧三条G07通过或选择生产API/预算。理由：三个新正例真实关闭与独立存活证据成立，六个负控按预定原因拒绝；零PTY控制只补诊断前提，不覆盖native释放异常或产品链路。正常Windows对象引用语义不是待消除的系统bug。日期/作者：2026-09-22 / Codex。

- 决策：以cf359040/run35631266321首次九项及全工件独立复核收口本轮G07补证，进入原生异常/unknown owner有界隔离设计，但不追认旧三条G07通过或选择生产API/预算。理由：三个新正例真实关闭与独立存活证据成立，六个负控按预定原因拒绝；零PTY控制只补诊断前提，不覆盖native释放异常或产品链路。正常Windows对象引用语义不是待消除的系统bug。日期/作者：2026-09-22 / Codex。

- 决策：新Windows-only三模式各三次独立补证，原guard-v2原样导入，原G07和工件不改。理由：真实CloseHandle与父端EOF、关闭后的两次fresh响应共同证明前提，keep-open/close-exit负控分别拒绝不足证据；避免把平台正常语义当产品问题。日期/作者：2026-09-22 / Codex。
- 决策：保留三平台原workflow success和D2原verifier72pass，单列Windows G07三项前提未建立；下一步优先另冻真实stdio提前关闭和独立主体存活控制，暂不进入业务或宣称D2整组完成。理由：固定libuv的标准fd特殊处理使fixture操作无效，JS事件通知顺序不是OS生命周期证明；不能改旧断言追认绿色或否定其余69项依据。日期/作者：2026-09-21 / Codex。
- 决策：将D1三平台模型验证与D2有界返回观察分别记录，原生异常及unknown owner有界隔离仍待独立设计。理由：111条模型和72条零PTY控制的证据层级不同，合成kill失败、真实子进程或空capture均不等于native owner已正确回收。日期/作者：2026-09-21 / Codex。
- 决策：以全新D2 local-v2目录验证deadline-incomplete，保留local-first的原始分类、源码和首次结果，仅按旧快照复核。理由：真实管道end可以晚于截止成立，但不能把整次超时采集升级为完整；修正诊断表达不应追溯改写证据或放宽冻结预算。日期/作者：2026-09-21 / Codex。
- 决策：本地D1双运行时与D2控制完成后，下一增量只提交独立诊断输入并执行三平台完整runner，再另冻原生异常矩阵。理由：有限模型、synthetic和Linux真实进程控制分别提供窄证据，不能提前称macOS/Windows、PTY或产品已通过，也不据此接入业务。日期/作者：2026-09-21 / Codex。
- 决策：按已冻结的D1/D2开始实施，新增workflow仅使用Node标准库、不安装项目依赖；两个诊断分别执行和完整复核，即使一组失败也保留另一组运行机会与全部工件。理由：本里程碑验证有限模型和工具控制，不需要加载PTY或业务，也不能让早期失败掩盖剩余矩阵。日期/作者：2026-09-21 / Codex。
- 决策：本阶段只完成生命周期候选与D1/D2运行前冻结，下一阶段先做有限模型和诊断父进程硬返回，再逐平台另冻原生异常矩阵。理由：自然路径证据不能填补取消/异常/隔离预算，工具未能有界返回时也不能可靠遍历全部失败。日期/作者：2026-09-21 / Codex。
- 决策：读者模型倾向协商后扩展close outcome，结算与释放一次处理；保留独立ACK对照，源/资源/结算能力各自判断。理由：复用现有revision和读者身份，不把旧close或旧provider升级成完整证明；生产握手和回执期限待接入评审。日期/作者：2026-09-21 / Codex。
- 决策：D1固定24组37个独立子例，D2八子项各三次并区分真实进程与synthetic；G04缺失Job/stdio前提显式未覆盖。理由：多个负例必须各自运行，有限后代控制只服务工具观察，不新增产品托管承诺或任意PID清理。日期/作者：2026-09-21 / Codex。

- 决策：以首次完整三臂结果收口正常自然路径，保留四个no-close资源失败并转API/adapter及缺口矩阵设计，不继续重跑求全绿。理由：已知HPCON最终Close消除本轮逐会话+2的窄因果证据成立，但对象类型/身份、异常/取消、builtin和实际宿主仍未验收；稳定背景差4不等于全局对象必须归零。日期/作者：2026-09-21 / Codex。
- 决策：guarded硬返回缺口另列工具债务，在下轮新版本入口修复并验证，不修改本轮冻结入口或追溯改判。理由：Linux独立stdio控制已经证明kill不保证child.close及时发生，本次Windows却未命中，不能混淆工具潜在失效与已完整自然结束的原生证据。日期/作者：2026-09-21 / Codex。

- 决策：先通过新工具的结构、自测与完整证据链审查，之后才运行原生矩阵；stock 不调用 owner API，两候选只共享一个编译产物，未知 PID 不参与清理。
  理由：避免新增诊断自身的启动、API 或构建差异污染 owner Close 的因果比较，同时落实正常 Windows 对象引用不等于进程存活的边界。
  日期/作者：2026-09-21 / Codex。

- 决策：先固定 bundled DLL，比较 stock、owner-retain/no-close 和 owner-retain/explicit-close 三臂，不把 builtin 后端或 Release 时序变化混入。理由：只改变已知 owner 的单次 Close 才能解释旧 +2 候选，且避免 backend/API 差异和强杀造成混淆。日期/作者：2026-09-21 / Codex。
- 决策：explicit-close 的首要通过条件是 owner ledger 单次关闭、自然收尾和无逐会话增长，不要求 OS 句柄总数回到 control baseline。理由：HPCON Close 可能异步释放或仍有系统引用；全局对象消失不是调用方责任。日期/作者：2026-09-21 / Codex。
- 决策：以首次负结果收口正常对象控制，不改初始计数oracle或重跑试绿；正常引用/关闭事实、未知+5和旧PTY持续+2各自分账。理由：平台语义已由官方契约和原生owner事件支持，计数严格回初始未成立必须保留；不能把所有仍存在的对象当缺陷或用总数抹去责任。日期/作者：2026-09-21 / Codex。

- 决策：在HPCON干预前先做无PTY正常Process对象控制。理由：用户要求确认平台语义而非强行消除合法引用；故意retain与完成owner释放分开验收，image查询只观察，不能用新控制追认旧增长的确切归属。日期/作者：2026-09-21 / Codex。

- 决策：本轮按macOS自然路径局部因果已建立、Windows类型积累已证实而归属未闭合收口，不改原身份门槛求绿。下一步优先已知资源owner受控干预，正缓冲控制分列。理由：内容/进程结束不代替资源回收，类型事实不等于精确对象所有权或生产验收。日期/作者：2026-09-21 / Codex。

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

最新已完成的Windows原生入口是 `scripts/diagnostics/diagnose-windows-stdio-close.mjs`，直接构建 `scripts/diagnostics/windows-stdio-close-control.c` 并用原guard-v2采集九项零PTY控制；workflow为 `.github/workflows/runtime-windows-stdio-close.yml`。候选设计第35节及共享契约第16节记录首次运行与独立复核，旧G07三项不追认通过。此前HPCON与Unix原位观察入口仍冻结；下一工作是原生异常路径/unknown owner有界隔离设计，不是复跑旧矩阵或开始业务接入。生命周期文档的业务及旧contract/barrier模型引用基于主运行时分支0518dcc4；本独立树没有这些改造和旧模型，不可将其路径作为本树现成执行入口。

candidate指被验证的读取器，audit指candidate结算后才接管残留数据的诊断读取器，两者不能合并计算候选交付量。gate是允许夹具主进程退出的文件信号；独立控制循环根据成功写入回执和完整字节对账发布gate，不依赖读取循环恢复。readiness只表示当前可读，EOF必须来自真实正容量读取的结束结果，取消则明确记录interrupted。后续Windows独立worker是专门读取ConPTY输出的工作线程，现有入口为 `scripts/diagnostics/compare-windows-exit-readers.mjs` 和 `scripts/diagnostics/runtime-exit-conout-worker.mjs`；不能直接套用Unix的fd/EOF语义，须先冻结新的取消与同进程长期资源协议。

## 工作计划

当前执行设计是 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节。八个版本隔离入口已在独立 `runtime-exit-integrity-native-candidates` 工作树创建；本阶段只做本地初版/审计修正与纯fixture验证，不运行D3真实矩阵，不新增runner，不推送。D4已有local-3完整模型证据，D3下一步按六组逐fixture补齐：各控制/硬截止全边界及排队跨限；spawn/ENOENT/launch-rejected完整责任；坏帧前后/同chunk/跨pipe；work/hard与共享E0组合；协议/容量/listener；unknown迟到/取消及实际await/gate。已有部分样本按清单扣除，不用总数宣称全覆盖。完成独立审查后再另冻真实D3、三平台采集及消费验收预算，W1/U1仍待完整工具门槛。

本地门槛通过后冻结新输入commit、Node22.23.2和新workflow的路径过滤/唯一首次触发方式，再另行确认一次完整三平台采集；失败上传全部partial证据，下载所有ZIP并按固定Git可信入口核验。D3主控/gate/publisher与D4模型分别报告，不更改旧门槛筛绿、不导入业务。上一设计冻结阶段“本轮只有设计”的记录仅限当时状态，当前已进入本地工具初版与审计；以下旧工作计划作为历史记录保留。

当前已完成原生失败设计第15–17节的D3 v2窄修正、三平台首次runner及独立复核。下一里程碑先在该设计追加完整诊断结算协议，定义`startObservedCase(spec)`的observation/processSettlement/evidenceSettlement三独立等待、首次deadline不可变快照、迟到补证与有界unconfirmed，再规定writer非法帧/封存/预算判据及D4完整身份重放。实现必须另存版本入口和新工件，不原位改v1/v2或重跑旧矩阵筛绿；新协议独立审查后才能实施，不提前启动W1/U1、选择生产server或改业务。

两个入口和 `scripts/diagnostics/observation-envelope-v2-oracle-test.mjs` 冻结为b4db41cc；`.github/workflows/runtime-observation-envelope-v2.yml`已唯一自动触发run35676427931，全部结果见设计第17节。可信离线复核脚本和原始输入在`.debug/observation-envelope-v2-run-35676427931/`；不执行归档源码。后续结果文档提交不改workflow/脚本，不触发额外采集。

以下安排保留历史时点；当前执行顺序以本节首段及“进度”中v2事项为准，不使用易漂移的行号导航。设计冻结后已经实现v1工具，但D3完整结算契约及D4独立重放/完整身份仍是后续门槛。

当前设计增量以主树f318579a、独立树7fb4ae9e为输入。先只读核查固定native创建/等待/通知/读取/释放的真实边界，再比较同进程封禁、停止新建和独立进程隔离；不能假定worker线程能隔离共享进程的原生崩溃或取消永久阻塞的调用。正式结论与运行前矩阵将写入新的 `docs/design-docs/runtime-native-failure-isolation.md`，同时补外层await后与证据写盘预算的观察设计。此阶段交付设计和冻结协议，不创建生产模块、不运行未冻结异常实验；以下安排保留历史。

当前里程碑已由契约第16节收口。下一里程碑是原生异常路径及unknown owner有界隔离的设计与运行前矩阵冻结：逐平台列出partial-create、wait/通知失败、在途取消/正长度已读缓冲、release失败/挂起和两个并发会话，明确每个注入点、已知资源owner、可证结果和允许的隔离边界。对无法确认的owner保留unknown及操作账本，不重复Close、不关闭未知句柄、不按日志PID强杀，不把超时当完整EOF。新工具还需补外层调用方await后及同步结算I/O预算观察，不能把resolve前事件当完整返回证明。只有新协议独立审查后才实施新诊断和一次完整首次采集；具体预算尚未选定，不能直接复制本轮控制参数成为生产政策。当前不推运行时分支、不改业务或重复旧矩阵；下列安排保留历史，不覆盖本段当前顺序。

本阶段按生命周期契约第14节新增 `scripts/diagnostics/windows-stdio-close-control.c`、`scripts/diagnostics/diagnose-windows-stdio-close.mjs` 和 `.github/workflows/runtime-windows-stdio-close.yml`。C主体用独立命名管道传操作结果，实际WriteFile/CloseHandle自己的两stdio并ExitProcess，父controller在原guard pending时推进双EOF/两次fresh challenge/100ms持有/退出许可。先工具自测、native与JS独立审查，再固定输入的Windows Node22.23.2/MSVC首次九项运行和完整离线审计。失败也继续全部schedule，编译失败记零child/九项not-run；不改旧guard、workflow、断言或业务。以下已有安排保留历史，当前顺序以本段为准。

当前D1/D2三平台首次运行及完整下载复核已完成，结果在设计第33节及 `docs/design-docs/runtime-execution-lifecycle-contract.md` 第12–13节；D1模型已验证，D2保留Windows G07三项前提缺口。已新增 `scripts/diagnostics/runtime-provider-lifecycle-model-v1.mjs` 和 `scripts/diagnostics/diagnose-runtime-provider-lifecycle-v1.mjs`，实现D1的24组37独立子例、schedule/trace/源码hash与独立复核，本地双运行时及三平台Node各37项通过。进程/source任意先后、同操作迟到补证、authority异步解析的注入替身、读者身份和八种能力组合分别可观察；模型接受注入EOF，不证明native EOF，也不被生产import。

同一里程碑已新增 `scripts/diagnostics/diagnostic-process-guard-v2.mjs` 与 `scripts/diagnostics/diagnose-process-guard-v2.mjs`，实现D2的exit/stdio/绝对deadline一次性结算与24条本地零PTY控制；修订完整性分类后的新v2目录完整通过，首轮原工件保留。spawn前开始计时，采集1000ms、截止后最多1000ms返回，独立外层5000ms加1000ms观测仅约束工具；不能被blocked native同线程timer替代。G04使用私有nonce/3000ms自限helper，未能证明继承stdio及Windows Job存活前提则记未覆盖；G06a/b只是synthetic。未知或未返回owner仍留账，不以日志PID强杀或runner销毁充当释放。

下一里程碑优先为Windows G07另冻新控制：真实关闭stdout/stderr，并由独立证据证明关闭时实际主体仍运行，不能只依赖fs.closeSync返回或相邻JS回调顺序。先确定可安全操作的已知句柄/拥有者与验证通道、运行前固定schedule/预算/失败分类，再使用新入口和全新工件实施；当前不修改旧脚本或重跑求绿。补证后才逐平台另冻partial-create、wait/通知失败、在途取消/正缓冲、释放失败/挂起、两个并发会话和unknown owner有界隔离。原guarded入口、150s参数和全部历史工件保留，生产取消/预算、builtin、旧Windows、真实Agent/Host/Webview/packaged仍未选定或验收。以下为已执行的历史阶段步骤，第29–30节HPCON阶段已完成，不按其“下一步”重复执行。

本增量新增独立 Windows workflow 和诊断 fork。机械复制现有 owned-lifecycle 的 payload/worker/consumer/resource schedule；只在候选 native 源增加受保护 owner 状态、shellExited 发布和主线程 `closeAfterExit`，保存 source before/after/patch、native/helper/DLL/toolchain hash。三臂均固定 DLL，stock 不回退到候选 binary；C 臂按偏序 gate 在 pipe EOF、全部 data sequence 已交付、consumer complete 和 shellExited 均成立后记录 close-request/invoked/owner-closed，并继续短窗口观察副作用，不强行规定 worker/decoder 相对顺序。自测覆盖 double-close、close-before-exit、unknown id、owner removed、缺 EOF/consumer、增长和损坏工件；然后一次 Windows runner 原生执行，首轮失败不覆盖。

本次普通对象控制已完成，不重跑同矩阵筛选绿色。下一步另冻已知HPCON owner的保留/最终Close最小隔离对照，区分自然源结束、消费完成和资源释放；需设计稳定背景/owner账本/逐会话增长三类证据，不能机械减5或忽略原失败。普通控制的+5可另做类型/创建归属取证，但尚未证明是产品缺陷，不把消除全部OS对象作为交付目标。

本增量先按设计第27节新增windows-process-object-control.c与diagnose-windows-process-objects.mjs，专用workflow只在Windows运行。三种模式各两轮、每driver3预热/20测量；C持有确切CreateProcess句柄并记录全生命周期，JS保存输入/编译/native输出且独立30s watchdog，逐driver失败后继续。先本地合成自测再一次原生运行，下载完成后全量复核。该阶段不含PTY/业务修改；HPCON最终回收另冻协议，不能以“系统对象仍存在”直接定性缺陷。

资源归因实现及结果已在设计第26节收口，不重复执行冻结矩阵以筛选绿色。下一里程碑先明确Windows已知HPCON owner跨主体退出、输出结束、消费者完成和释放的诊断生命周期，设计最小隔离释放对照及必要的早期身份取证；不盲关未知句柄、不把退出后对已移除baton id调用kill当释放证明。具体API/顺序需另冻再实现。正readable-buffer取消、macOS异常路径、真实Agent/宿主/packaged与生产契约仍单列开放；旧脚本和业务不改。

历史资源计数阶段提出的macOS最小干预和Windows类型取证，现已由设计第26节完成本轮验证；异常分支、Windows具体资源归属与正长度readable控制仍开放，以工作计划首段为后续顺序。不能以源EOF/JS关闭宣布资源完成，也不把隔离实验当生产API授权。

第20–22节原位观察/独立gate历史增量已完成两平台24项及复核，当时提出的Windows局部所有权与同进程计数已由第23–24节承接；新资源失败不能被此前单次释放通过覆盖。Unix局部结果不能直接外推ConPTY或生产，业务不改。

第17–19节历史里程碑保留18项首次结果及12项helper共享flags副作用实证；当时提出的原位readiness/独立gate下一步已由第20–22节完成，不再列为当前未冻结项。仍不把fd3/dup或静默恢复flags当生产修复，不接入业务、不关闭整体退出或长期资源债务。

第一里程碑：加入 `scripts/diagnostics/compare-runtime-exit-readers.mjs`（Unix）、`compare-windows-exit-readers.mjs` 和 `runtime-exit-conout-worker.mjs`。前者从已验证 Linux 诊断承接，只扩展 Darwin 和严格换行归一。Windows 分离主诊断、单样本子进程与读取 worker。进程退出、源结束和资源退出分别记录，不使用假 EOF。先执行 syntax、自校验和本地完整 Unix schedule。

第二里程碑：新增 `.github/workflows/runtime-exit-integrity-candidates.yml`，分别运行 Unix 或 Windows 命令，保留所有基线失败及候选失败。每平台 Node 22，各 Unix 42 样本、Windows 63 样本，参数不得在失败后为了变绿调整。工件含整个 schedule、脚本及 native 哈希和环境；下载后独立核对。

第三里程碑：正式设计记录结论与首次失败分类，未复现与未测试明确写出。两轮证据已形成可复核记录；当前先同步职责澄清、产品门禁和诊断开放项，不因此立即归档。将来的诊断计划收口应明确移交残余问题，生产方案仍需要宿主、真实 provider、资源预算和完整契约集成，不以诊断计划完成关闭产品债务。

职责澄清后的扩展里程碑：先把验收分类写入正式设计第 9 节，并在运行时主线设计中确认主进程尾部、已进入链路的内容、最终状态、资源释放和取消语义；启动器到实际 Agent CLI 的生命周期单独验证，不用通用后代实验替代。只有保留产品问题需要进一步底层解释时，再用本独立分支推进 macOS 控制组：真正记录 write 返回值/errno，比较 leader 退出与保持存活，将首次 EOF 后持有 master 的观测与原关闭路径分开。新诊断执行前仍须另冻结轮次、期限和分类，不调整已有两轮原始判断；尚未确定具体实现或预算。

## 具体步骤

上一设计冻结阶段只做文档与固定源码/协议复审；当前本地实施与审计另按第12节记录，不运行D3真实新矩阵。已在两树完成检查：YAML parser核对新设计frontmatter/索引/关联路径、计划四活章节、两树共同协议，按输入Git比较冻结历史正文与旧脚本/workflow字节，并执行 `git diff --check`，均通过。

实施与证据工作目录为 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates`；新CLI已存在，固定执行器为 `/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node`（22.23.2）。本阶段只使用该执行器运行 `scripts/diagnostics/diagnose-settlement-v3.mjs --self-test --output NEW_DIRECTORY`、`scripts/diagnostics/diagnose-owner-quarantine-v2.mjs --self-test --output NEW_DIRECTORY`、D4的 `--output NEW_DIRECTORY` 和两者的 `--verify-saved DIRECTORY`。D3的 `--output` 是真实36+2+4入口，当前不得执行。输出目录只能新建，首次失败保留；主运行时不承载新增脚本或工件。以下旧命令只作历史证据复核，不是本轮新采集安排。

（历史设计检查步骤）从两树根执行 `git diff --check`，核对新设计YAML/索引/关联路径、矩阵ID/计数、源指纹和计划四活章节；旧主设计第7–39节、独立设计第2–5及7–35节、生命周期契约第1–16节逐字保留。该时点尚未运行新CLI；当前工具实现、self-test和保存目录复核见进度及最新证据记录。push前fetch/rebase main，仅推独立诊断分支。

本轮证据已完整下载到主运行时树。从独立诊断树执行 `node scripts/diagnostics/diagnose-windows-stdio-close.mjs --verify-saved /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/.debug/stdio-close-35631266321/runtime-windows-stdio-close-35631266321-1/stdio-close-evidence`，预期checked9、actualCreated9、pass:true、synthetic:false、pty:false、无工件错误，且仅三个close-wait前提为true。原始guard分类必须另核对为六natural-exit/complete及三deadline-exceeded/deadline-incomplete；离线复核不新增原生样本。下一输入先补正式设计和冻结矩阵，不改本轮脚本或工件。

从本树运行 `node --check scripts/diagnostics/diagnose-windows-stdio-close.mjs` 与 `node scripts/diagnostics/diagnose-windows-stdio-close.mjs --self-test`，已完成本地工具验证；Windows x64/MSVC环境运行 `--output stdio-close-evidence`，然后 `--verify-saved stdio-close-evidence`，只允许全新目录。workflow固定Node22.23.2，不安装依赖，始终上传完整输出；下载后在Linux也可离线复核，但不是新增Windows样本。push前fetch/rebase main，仅推诊断分支，不能将编译失败或原生前提失败藏入重跑。

本阶段只收口三平台运行及追加审计的文档，不修改脚本、workflow或工件。在本独立树执行 `git diff --check`，核对设计frontmatter、索引/related路径及ExecPlan必要章节，逐节比对历史第1–32节除第6节当前导航外不变；G07后续补证必须另冻，不把文档结论变更当成旧verifier已修复。

从本工作树根执行 `node --check scripts/diagnostics/runtime-provider-lifecycle-model-v1.mjs` 及三个其他新文件对应的语法检查，再执行 `node scripts/diagnostics/diagnose-runtime-provider-lifecycle-v1.mjs --self-test` 和 `node scripts/diagnostics/diagnose-process-guard-v2.mjs --self-test`。两组自测已通过；重跑分别设置DSC_PROVIDER_LIFECYCLE_SELFTEST_EVIDENCE和DSC_PROCESS_GUARD_SELFTEST_EVIDENCE为全新目录，不能覆盖原始v1/v2。自测覆盖删事件/错身份序号/缺终态/缺工件、重算manifest后的语义篡改及首项损坏后继续，D1最终37正例/12类负对照、D2最终25项。

本地正式采集已完成，不再向既有目录运行 `--output`。可用 `node scripts/diagnostics/diagnose-runtime-provider-lifecycle-v1.mjs --verify-saved .debug/provider-lifecycle-v1-node25-first` 及同入口 `--verify-saved .debug/provider-lifecycle-v1-electron39-first` 复核，各预期37/37。D2新版本用 `node scripts/diagnostics/diagnose-process-guard-v2.mjs --verify-saved .debug/process-guard-v2-local-v2-deadline-integrity` 完整检查24条；旧首轮仅用 `node .debug/process-guard-v2-local-first/sources/diagnose-process-guard-v2.mjs --verify-saved .debug/process-guard-v2-local-first` 按其原源码复核，不追认新增分类。重跑采集只能另建目录，记录实际Node/OS/Git与源指纹。

本轮remote输入为d173c099d37f83bb3178d280a6a6d8b80d984b92/run35620967433 attempt1，下载根在主运行时树 `.debug/lifecycle-contract-35620967433/`。从本独立树执行 `node scripts/diagnostics/diagnose-runtime-provider-lifecycle-v1.mjs --verify-saved ../dev-session-canvas2/.debug/lifecycle-contract-35620967433/runtime-lifecycle-contract-v1-windows-latest-35620967433-1/provider-lifecycle-evidence`，预期37/37；D2入口换为diagnose-process-guard-v2.mjs、末级目录换为process-guard-evidence，原verifier预期24pass。平台段替换为ubuntu-latest或macos-latest后同样完整复核；结果及各平台六份源码/配置对输入核对已保存offline-review-v1.json。Windows原24pass不能代替G07缺失前提，补充审计按共享契约第13节单列。

第30节本轮原生复核已完成。从本独立诊断工作树根目录，使用锁文件对应的已安装依赖运行 `node scripts/diagnostics/diagnose-windows-hpcon-owner.mjs --verify-saved ../dev-session-canvas2/.debug/hpcon-owner-35586906307/runtime-windows-hpcon-owner-35586906307-1/hpcon-owner-evidence`；本地共享主树既有依赖时可先设置 `NODE_PATH=../dev-session-canvas2/node_modules`。预期12/12有效、四个resource-failure、evidenceErrors为空及exit1。离线复核不是新原生运行，首次输入与工件不覆盖。

从独立诊断工作树运行node --check scripts/diagnostics/diagnose-windows-process-objects.mjs和node scripts/diagnostics/diagnose-windows-process-objects.mjs --self-test；Windows x64的MSVC developer环境运行同入口--output process-object-evidence，要求新目录。完成后使用--verify-saved process-object-evidence复核全部六driver（失败也继续）；原始目录不可覆盖，任何修订以新输入/新目录保留首轮。新workflow使用Node22.23.2，只需MSVC/Windows SDK和Node标准库，不安装或加载node-pty。

本阶段复核目录为独立工作树的 `.debug/github-resource-attribution-35527241793-{macos,windows}/native-resource-evidence` 与 `.debug/github-resource-attribution-35527528410-{macos,windows}/native-resource-evidence`，各用对应新入口 `--verify-saved <目录>`。依赖可通过NODE_PATH指向同锁文件主工作树。两次macOS三arm有效/外层exit0，但原四基线资源失败保持；首次Windows零driver，次轮旧verifier和inventory完整4/4、无工件损坏，两个native资源failure与归属inconclusive/exit1。不得改oracle追认通过。

新入口在独立工作树使用 `node scripts/diagnostics/diagnose-macos-kqueue-release.mjs --self-test` 及 `node scripts/diagnostics/diagnose-windows-handle-inventory.mjs --self-test`；采集使用各自的 `--output <全新目录>`，完成后用 `--verify-saved <目录>` 复核。macOS需要同版本Node headers和记录版本的node-gyp，Windows需MSVC与匹配的Node import library。非本机平台只跑纯逻辑自测，不冒称native通过。workflow保存编译输出、隔离副本和全部证据，失败也上传；原生执行和下载分别留证。

历史同进程资源计数复核： `node scripts/diagnostics/diagnose-runtime-owned-lifecycle.mjs --verify-saved .debug/github-owned-lifecycle-35519226627-ubuntu/owned-lifecycle-evidence`，预期4项有效/无失败/exit0；换macos预期4项有效、native-1/native-2资源失败/exit1，换windows为16项有效、同名两个资源失败/exit1，三者evidenceErrors均空。依赖可通过NODE_PATH指向相同锁文件的主工作树。重跑采集只用新目录，不重判首次失败；类型和macOS干预已由新阶段承接，后续以本节首段为准。

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

本阶段验收覆盖本地工具初版、实际fixture和审计修正，不宣称D3完整冻结覆盖。D4 local-3每次固定16项，93语义/4 saved及另存7个sidecar负例逐项有效，坏首项仍attempted16/verified15且末项通过；独立复审的两项阻断闭合。D3 v3最终 self-test-2通过119 oracle、41 core、15 files、25 archive/consumer/binding fixtures；saved4/4、88 manifest members、boundedConsumerDelivery=false、acceptanceReady=false；realNodeCases/nativeProcesses=0、pty=false，未运行live36+2+4或原生矩阵。六组覆盖与超时首报消费预算仍开放。D3真实36+2+4、本阶段三平台runner与native实际均0；本地D4不计为三平台48次已通过。收口前检查两树frontmatter/index、新增引用、共享契约一致、历史保持及diff，不能以旧runner或文档检查代替运行证据。

实施后须验证首报与迟到补证分离、真实consumer await、process/capture与主动截断分层、writer/verifier/publisher协议和独立归档、D4完整命令/事件/全量快照重放；语义篡改即使重编号/重算hash仍拒绝，坏首项后其余项仍有效验证。首次真实输入前冻结具体fixture清单/hash和唯一workflow触发，不在本设计预造断言总数；W1/U1继续等待完整新工具验收。以下为历史验收记录。

当前v2窄验收要求完整八场景各三次及独立负例：合法跨pipe反序应接受，同pipe逆序、stdout冒充after-await、错身份/nonce、缺失/重复序号、非法接收时间、超4096全帧/分片、残缺/非法输入和D3-08 ACK前bulk均拒绝；合法但超预算接收保留observed-late而不是协议拒绝，不得判timely，要求及时的scenario仍失败。源序缺口只允许明确bulk溢出区段。原24项和预算不变，首项损坏后仍遍历末项。v2每runner24个D3控制，不重跑D4；此前D4每runner24模型、三runner72次，且无pty:false字段。验收仅覆盖新增oracle，不关闭三独立settlement、首次快照、bounded unconfirmed、独立封存或D4身份债务。

（设计冻结时）本阶段验收只覆盖正式设计、可操作第一批协议与独立复审。固定源码hash要与锁文件版本对应；D3的24×3平台=72、D4的8×3=24、W1的8×3=24及U1 Linux6×3/macOS8×3=42分别核对。native-substitute不可冒充真实API失败，D3/D4不计PTY。新设计未验证，D3/D4/W1/U1零实际新运行；既有回归不替代这些验收。首批实现前仍须核查生成补丁/编译/实际加载输入，原始失败和not-run不得隐藏。当前实现和本地有限结果见本计划进度及本节后续记录。

本轮九项已按冻结第14节完成，具体环境/输入/时间/审计见第16节；旧三条G07不追认通过，产品与原生异常矩阵仍未验收。收口须确认两树文档状态/索引/关联路径/计划四活章节一致，主树只改文档；独立树本轮结果提交仅文档，C/JS/guard/workflow与cf359040输入字节不变。历史主设计第7–38节、独立设计第2–5及7–34节、契约第1–15节正文不改写；只允许当前导航及新增结果变化。用户image.png不纳入提交。

本轮G07三个close-wait正例须真实关闭、完整marker、双EOF/close后两次fresh challenge/pong、至少100ms持有且guard未提前返回；许可、主体exit0与自然捕获结算在原预算内。keep-open及close-exit各三项分别按预定轨迹拒绝目标前提，不能把意外失败都计成负控通过。九项全部遍历，manifest/输入commit/EXE/原guard和原始时钟交叉核验，坏首项不阻止末项检查。合成自测、旧72pass与新原生矩阵分开报告，旧Windows G07仍not-established。

本轮D1三平台各37项、共111条模型已验证；D2三平台完整72条按原verifier通过，其中18条synthetic/54条真实进程或启动控制分别统计，零PTY。Windows G07三项未建立真实stdio先关/主体仍活前提，须独立补证后才能宣布D2整组验收；其余69条控制依据不因该缺口改判。成功识别预期失败不改变raw失败分类，超时后真实end不晋升完整；前提不成立、已要求的driver控制或fixture协作/期限未达不得通过，缺helper回执或TTL超限仍为fixture失败。G04 helper的OS退出未被外层独立wait观察属于已声明的证据边界，应单列not-observed而非自动否定有效guard/协作控制，也不能充当原生资源释放通过。完整schedule及首项损坏后继续校验、文档元数据/索引/路径/计划章节/历史文本检查仍必需；真实PTY/Host/Webview与生产验收不由本轮替代。

第30节本轮验收按原门槛保留12/12有效、四个no-close资源失败且无evidenceErrors；另外独立对账138条完整内容/真实EOF、92次Release HRESULT0、46次Close和owner归零、1260份原始计数。ZIP完整本地哈希与source/header/patch/实际native及配套文件链一致。只证明固定Windows bundled DLL正常自然路径，不能替代取消、异常、builtin、实际Agent/宿主/packaged验收；本轮无watchdog命中不证明guarded具备硬返回能力。

验收分层：自然内容/终端状态/pipe 与进程生命周期必须完整；owner ledger 必须每个 session 只 Close 一次且关闭后不再操作；resource snapshot 仅报告背景和逐会话增长，不把总数归零作为必要条件。`PtyKill`、`TerminateProcess`、未知句柄关闭、Close 前提缺失、Close 阻塞/watchdog 都是失败或不确定。builtin、真实 Agent/Host/Webview/packaged 和生产 API/预算不由本轮验收。

此前普通对象控制的原verifier保留attempted6/verified6、两个通过/四个failure且无evidenceErrors；已退出对象被引用以及image31不作为产品bug门槛。按原始owner/API事件和快照补充完整审计，不能通过改raw计数或跳过warmup断言将失败变绿。具体输入/环境/工件与局限见设计第28节。

本轮完整schedule、每会话内容/消费/自然退出、OS资源序列、固定helper/实际加载native、查询错误、前后快照与工件hash均已核对。结果不能合并为产品验收；Windows映像未知保留不确定性，macOS不外推错误路径或其他版本。后续干预保持原断言和失败记录。

目标是给出候选可行或不可行的原生证据，不要求所有候选通过才算研究完成。可信 EOF、完整内容、实际退出结果、取消和资源自然退出分别判断；原路径反例完整保留。不把错误 oracle 当平台缺陷，不把自然子进程退出当零 OS 句柄保证。不改变 90000 行断言、固定轮次或等待上限。

产品验收与冻结诊断分别记录：主进程尾部、已接收/排队/消费内容、最终光标/状态和 reader 资源释放仍需验证；主进程运行时同一终端的后代输出正常处理；启动器退出不能未经验证就当成实际 CLI 退出。普通后代在主进程退出后的延迟输出只按旧诊断门槛保留结果，不独立阻塞产品，也不据此宣称 macOS 产品通过。文档范围澄清本身通过 `git diff --check`、frontmatter/索引/引用检查，以及仅有指定文档差异来验证；不为范围调整重跑或修改旧实验。

## 幂等性与恢复

只创建和清理本次 fixture，PID/进程组来自本次启动。硬截止与正常完成分开保存，清理不得误作用真实会话。唯一 evidence 目录、GitHub run/attempt 命名及源码 hash 防止覆盖。没有用户 storage 迁移或回滚需求。

## 结果与复盘

当前阶段交付为新诊断的本地工具初版与审计修正，完整证据/缺口见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节（比较中/验证中）。D4固定16项与93语义、4 saved、另存7个sidecar负例已有最终本地证据，两项审查阻断闭合；create/use unknown迟到清除的独立正例仍待补。D3 v3最终 self-test-2：Node22.23.2，oracle119/119、core41/41、files15/15、archive/consumer/binding25/25，saved4/4、88 manifest members、boundedConsumerDelivery=false、acceptanceReady=false；realNodeCases/nativeProcesses=0、pty=false，未运行live36+2+4或原生矩阵。CLI及三份源hash见契约第12节，symlink负例归档需保留link元数据；cross-replay和oracle review首次失败保留。

当前不运行D3真实36+2+4、不新增runner、不推任何分支；先补六组冻结覆盖、消费验收预算与独立审计，之后再另行确认真实矩阵/三平台采集。业务、依赖、旧脚本/workflow/工件和image.png不改。W1/U1、原生第二批、真实启动链/双会话/宿主/packaged、生产API/停止预算与整体退出完整性继续开放，计划active。以下保留此前阶段时点的结果，其“下一步”不覆盖本段。

本阶段已完成b4db41cc的三平台D3 v2窄验证及全量独立审计，Windows真实乱序不再误报、坏首项不阻断其余案例复核；每平台full24/scaled24/oracle78/parser8和tamper24/23成立。证据与时序见原生失败设计第17节，audit SHA256为a772fa2a399c9b51fe109b56fff097933e9873fa0c424aab93f18717c13233f7。native PTY/D4/W1/U1本次零新增，三独立结算与writer/D4债务仍开放，整体重构未完成。以下为runner前历史记录，不覆盖本段最新状态。

当前已收口v1首次run35673511893及误触同SHA重复run35673550930的失败保存，六工件在独立诊断树而非主运行时树。完整Windows D3跨pipe误判、自测真实迟到和writer预算漏验分别记录；每runner24项D4模型不替代完整契约。v2发送端seq/身份、真实通道/时间、4096解析、协议失败及D3-08 ACK窄修正已实现，Linux Node22.23.2本地oracle78/78、parser8/8、缩放positive24/24及完整24/24通过，三平台新runner待验。本次不交付三settlement，不推进W1/U1或业务代码，总计划继续active。

local-1篡改自测原来只能证明根manifest损坏被拒绝，不能证明其余23项有效；新修正与增强断言已完成，local-2自测报告24 attempted/23 verified、仅共享manifest和首项错误，完整local-2-full24/24且无evidenceErrors。独立审计将三源码与快照绑定并重放78/8/24/24，确认六个D3-08均ACK后bulk且缺序只在明确尾部bulk区段。local-1 positive/full通过及原篡改报告不追认重写，writer协议非法帧掩盖风险继续列在settlement债务，v2三平台runner仍待验。

（设计冻结时）本阶段交付 `docs/design-docs/runtime-native-failure-isolation.md` 的候选比较、逐资源责任和第一批冻结协议，不是新实现或通过记录。D3共72个进程控制、D4共24个有限模型；W1 Windows24、U1 Linux18/macOS24，共66个driver尝试，不能相加为原生PTY通过数。新设计保持比较中/未验证；原生命周期契约第17节承接，所有历史正文/工件不改。

（设计冻结时）下一阶段先实现独立观察外壳和准入模型并完整验证，再实施创建/等待native fork。其余通知/env销毁、正缓冲取消、真实Close挂起、双会话与生产支持面仍未冻结或验收，整体退出完整性未完成。旧live绑定、业务、依赖和生产预算不改；后续仍只推独立诊断分支，不推主运行时。当前第一版工具已实现，但契约审计仍未闭合。

本轮G07补证已完成实施、自测、首次Windows运行及完整下载/离线审计，详见契约第14–16节。固定cf359040/run35631266321 attempt1的九项控制成立：三个close-wait正例持有100.8252–101.7934ms，keep-open与close-exit各三项按预期拒绝前提；raw仍分别是超时不完整与自然完整，两个负控不当正例。runner的27项合成自测与九项真实控制分开，独立raw审计836项通过，没有重跑。

新证据只补固定Windows环境下真实stdio关闭后的主体存活前提；旧run35620967433的Windows G07三项继续not-established，原72pass和所有历史失败保留。下一阶段转原生异常路径/unknown owner有界隔离设计与矩阵冻结，不调查正常Process引用存续来代替推进，不接入业务；生产reader/API/预算及完整产品矩阵未验收，设计比较中/验证中，计划active。以下为历史阶段记录，其中当时的下一步由本段取代。

当前进入G07独立补证阶段，第14节运行前协议已落盘，尚无本轮原生结果。新实现只新增隔离诊断，不修改旧输入；完整首次Windows矩阵和下载复核后再评估缺口是否闭合，暂不进入原生异常或生产接入。以下上一阶段结果保留原范围。

本阶段已完成D1/D2实现、本地验证和固定d173c099/run35620967433 attempt1的三平台首次运行及全部下载复核。D1三平台111条模型已验证；D2原72pass、每平台raw9natural-exit/3spawn-error/12deadline及全部有界返回观察保留，但追加审计明确Windows G07三项stdio关闭无效、前提未建立，不能宣布D2整组验收完成。其余69条控制依据、旧Promise/完整性分版缺口和全部历史结果不改判。这是诊断夹具/校验器证明不足，不是Windows正常对象语义或产品缺陷。下一步优先另冻Windows G07真实关闭与独立存活控制，再进入原生异常/unknown owner有界隔离；生产reader/wire/API、取消预算及真实宿主仍开放，旧live绑定不变，设计比较中/验证中，计划active。

HPCON阶段首次原生矩阵、完整ZIP下载与独立复核已完成，见设计第30节。46次已知owner最终Close消除了同native/no-close对照中的逐会话+2总句柄增长，全部138条自然内容与生命周期完整；四个no-close资源失败、旧普通对象+5失败及旧身份inconclusive不改判。结果不是OS对象语义缺陷，也不是生产已修复；稳定191不强求回control187。新发现的guarded硬返回债务在下轮新入口收口，API/adapter、取消/异常/builtin/正readable和实际Agent/Host/Webview/packaged继续开放。设计比较中/验证中，计划active，业务、安装依赖与历史证据不改。

本增量已完成首次原生和完整下载复核，见设计第28节：六driver全部运行，92child自然退出，两个control通过而四个计数失败保留；无工件错误/强杀/watchdog。已确认普通进程的引用存续与释放事实，额外5和旧PTY +2的具体来源未闭合，不能称OS bug；未选定生产方案或修改业务，计划继续active。

2026-09-21资源归因增量完成实现、本地自测、两次新输入原生执行和全量离线复核，共322条实际PTY。macOS原包/重编译基线增长、唯一close候选不增长的局部因果证据成立。Windows修名后46条会话完整，资源仍+1 PIPE类型File/+1已退出的非fixture Process；全部image查询31，整体归属inconclusive且不改判。首次编译失败、各基线资源红项及所有旧证据保留；生产退出完整性仍未交付，设计比较中/验证中。

历史第23–24节已完成新实现、自测、Linux本地两版各46条PTY与三平台首次原生全量复核。run35519226627共24个driver/150条真实会话，20个driver通过、macOS与Windows各两个资源组失败，全部工件有效；不能将会话内容通过当资源或产品通过。Windows九次取消的正长度readable分支未覆盖，后续补受控场景；其后第25–26节已补Apple最小close因果证据与Windows增长类型，Windows具体资源归属仍开放。旧24项及全部历史失败不改，生产方案仍未选定。

历史原位矩阵已完成本地v1/v2/v3、自校验及远端24项/完整离线复核，首次两个诊断持有失败保留，Unix这组前提/所有权有有效证据；不外推生产验收。当时提出的Windows与同进程资源已由第23–24节承接，旧hash/目录/负例与传输重试边界仍见第21–22节。

新18项与窄12项均完整运行/下载/离线复核，前者总run失败，后者精确复现两平台helper清O_NONBLOCK；旧矩阵需限定为受干扰观察。实验有效性根因已定位，但旧回执竞态没有补造原始证据，不能用修正探针或局部绿色收口生产取消。Windows在途取消、长驻资源、真实provider/宿主/packaged仍开放。

可读性握手阶段完成运行前冻结、新工具与Linux本地两版各9项及自校验；最终输入脚本hash1875495f记录于设计第16节。远端18项结果及其有效性限制见第17节，不能用本地结果替代macOS或旧失败。独立审查发现的离线证据互证缺口已补回调/read id/helper链断言，不调整冻结期限或把诊断升为生产实现。

写入控制增量完成本地27项、两平台原生54项与完整复算，输入7d832d3e / run35508235734。Ubuntu27/27、macOS21/27，总失败保持；修正的新暂停实验通过，六个原取消仍失败，但已由独立写读控制定位夹具循环等待。失败工件验证器完整遍历且诚实exit1，首轮假EOF和所有旧失败保留。后续先冻结取消新握手，继续Windows在途取消、长驻native资源、真实provider/宿主与生产API，不用局部控制通过关闭计划。

此前完成本地三版各21项与三平台84项，首轮输入 f4600844 / run 35506150727 完整证据已下载复核。Linux21项和Windows候选21项达标，实际bridge启动器生命周期通过但三个主进程尾部/21个资源反例仍在；macOS12/9，三项诊断假EOF与六项前提未成立分别记录。原失败验证器不足用独立只读审计补齐，不将原命令追认为成功。该轮问题由本次新实验继续定位而非重判，计划仍active，旧294项失败和断言不改。

已完成冻结、脚本和本地 42 样本；两轮远端各 147 项，总计 294 项原生候选对照，完整保留失败。Windows 初轮后代夹具前提失效，修订后候选 21/21 达标，但原 worker 的每轮 42 次资源失败仍在；Linux 两轮候选均 21/21；macOS 两轮均有六项后代失败，继续由此计划保存为诊断开放项，不再独立阻塞产品交付。本轮只重评职责和优先级，主进程尾部、最终状态、资源释放、真实启动链以及收尾/取消设计仍待推进，不归档为跨平台选型完成。两入口自校验、真实 TCP worker 和三个脚本语法通过；最终证据哈希/文档核对另记进度。不宣称生产、真实宿主或 packaged 已修复。

证据收口检查：第二轮 builtin 三个后代在 public onExit 后留下成功 writer receipt，但呈现只有 `PARENT`；候选完整收到 `CHILD_TAIL`。两轮 Windows 保存结果复算分别报告 6/0 个候选失败，不把离线验证当新增原生轮次。元数据/索引/related paths、workflow 只读权限与分支边界、`git diff --check` 通过；业务、package/lockfile、已有 baseline 入口/workflow 无差异。未执行完整 UI/Agent/packaged，资源预算仍未完成；macOS 控制组保留但不是无条件交付前置项。

## 证据与备注

本阶段最新证据在独立诊断树：D4 `.debug/owner-quarantine-v2-local-3-selftest`、`.debug/owner-quarantine-v2-local-3-full` 与各自 `-verification.json`，补充 `.debug/owner-quarantine-v2-local-3-sidecar-negatives` 七项；首次碰撞失败在 `.debug/owner-quarantine-v2-key-collision-first-failure`。D3 v3最终 self-test-2通过119 oracle、41 core、15 files、25 archive/consumer/binding fixtures；saved4/4、88 manifest members、boundedConsumerDelivery=false、acceptanceReady=false；realNodeCases/nativeProcesses=0、pty=false，未运行live36+2+4或原生矩阵。D4精确四源hash、缺口与证据边界见诊断结算契约第12节；以下设计冻结与历史runner记录不作为本阶段新采集。

2026-09-22 本轮文档检查范围：每树4份设计的元数据/索引状态/架构标签、12个计划必要章节、新增或修改的完整本地引用、两树共同契约与4组冻结历史正文均通过；新设计12个主控场景和16个模型场景计数一致。另发现索引既有 execution-node-zoom-interaction-research 执行计划引用对应的文件不存在，两树输入HEAD已含该悬空条目，本轮未修改，不宣称全仓文档引用无缺陷。未运行旧矩阵或新诊断，用户image.png不纳入提交。

2026-09-22 新设计输入为诊断树e1a31b79、运行时树a5f8d629。新增 `runtime-diagnostic-settlement-contract.md`，外围设计/索引/原则/债务/计划同步；本阶段只有源码/协议审查与文档，没有新测试报告、runner、工件或native结果。三侧最终静态复核和两树文档检查通过：每树8份文档、4份设计元数据、12个计划必要章节与4组历史正文保持检查；两树共同契约一致，业务/脚本/workflow/依赖无变更。旧b4db41cc/run35676427931及所有历史失败继续按原范围留证。

2026-09-22 v2首次runner：固定b4db41cc/run35676427931 attempt1/push，三ZIP各453文件、API大小/摘要一致；15输入与Git对账，Windows仅CRLF差异，可信Git源码独立复核。三平台Node22.23.2各full24/positive24、oracle78/parser8及tamper24/23，详细raw最大时间、artifact/环境与hash见原生失败设计第17节。原始目录`.debug/observation-envelope-v2-run-35676427931/`含audit/metrics/acquisition，未dispatch/rerun、未修改旧失败。

2026-09-22 原生失败第一批设计收口（设计冻结时记录）：两工作树本增量各7份文档，120项设计/元数据/关联路径/历史保持与跨树一致性检查通过，四份固定源码SHA256与锁定版本对应。Windows、Unix和观察协议三侧独立复审已收口；两树 `git diff --check` 通过。主树 `npm run test:execution-session-bridge`、`npm run test:serialized-terminal-state-tracker`、`npm run test:runtime-supervisor-protocol` 均通过，仅计既有回归。D3的72项、D4的24项及W1/U1的66个driver尝试均为冻结计划数，当时新增原生运行0次、工具尚未实施；新设计保持比较中/未验证。业务、依赖、旧诊断、workflow和历史工件不变，用户image.png不纳入提交；主运行时仅本地提交，独立诊断分支只推本轮文档。

2026-09-22 D3/D4第一版实施与本地复核（runner前记录）：四个诊断入口和foundation workflow当时已加入工作树；D3完整schedule 24/24 trace/manifest verified，D4 linux/darwin/win32各8项共24/24 control-pass，D3 positive/tampered与D4 self-test manifest均保留。当时输入尚未提交，随后冻结为7141cfa3；D3/D4均无PTY/native，W1/U1零运行。D3三独立settlement、迟到after-await不可变快照、caller源帧身份、forced/unconfirmed有界结算、独立evidence settlement，以及D4完整owner generation oracle仍是阻塞项；本地结果不能升格为契约或生产验收。

2026-09-22 foundation runner两次完整审计：7141cfa3的首次run35673511893及误触同SHA重复run35673550930均failure。两次完整D3均Linux/macOS24/24、Windows23/24仅01-1误序；D4每runner24项，两run144次模型均按原verifier通过。Windows self-test positive首次23/24、重复21/24，后者07-1/08-1真实接收504.2253/543.014ms超500ms；writer结算554.9569/630.9223/608.3949ms也超500ms，原verifier漏验债务保留。两次Windows自测未产生最终报告/tampered负例。六ZIP总3,853,782字节/3022成员及36输入已与API/fixed Git对账，Windows仅CRLF，未执行archive。首次工件在独立诊断树 `.debug/github-foundation-35673511893-{ubuntu,macos,windows}/`，完整审计在本树 `.debug/foundation-first-two-audit/`；summary SHA256为eb5d8e91ffe23ffa03ff43384d1d52c46ab0798a05a0adc644084a2a7d9081d5，audit为b1de5345391c816f11a47b4143afa65b5da8d826463f76d5883f559f59b1d5c1。两run原failure不改。

2026-09-22 D3 v2本地证据：独立诊断树Linux Node22.23.2，`.debug/observation-envelope-v2-local-1-selftest/` 的oracle78/78、parser8/8、positive24/24和篡改拒绝通过；`.debug/observation-envelope-v2-local-1-full/` 未缩放24/24 verified，三源码语法通过且hash封存。输入是未提交工作树，不称新commit复现；三平台v2 runner尚未取得。新workflow仅D3，v1/D4不重复，完整结算/身份债务仍开放。

local-1补充审计：tamper报告attempted24/verified0，根manifest短路run.scale使其余案例也失败，原自测覆盖不足，不改positive/full各24结果。新 `.debug/observation-envelope-v2-local-2-selftest/` 完成oracle78、parser8、positive24，其tampered-verification.json明确attempted24/verified23且仅shared-manifest、D3-01-1错误，末项无错；`.debug/observation-envelope-v2-local-2-full/` 未缩放24/24 verified且无evidenceErrors，最终CLI语法/diff检查通过。独立审计 `.debug/observation-envelope-v2-independent-local-review/audit.json` 确认三源码与两组快照一致、重放78/8/24/24及篡改24/23，六个D3-08均ACK后bulk，保留源序从5连续、仅尾部bulk省略至4300、finish4301仍在；before-fix-regression.json按原hash复现local-1缺口，旧工件未改。所有输入/工件分目录保留，预算不变，runner待验。

2026-09-22 收口检查：两工作树本增量各5份文档，metadata/索引/关联路径/架构标签/计划必要章节及106项历史/一致性检查通过；共享契约第14–16节两树一致，旧正文不改。可信入口再次离线复算九项通过，runner合成27项单列，bridge回归通过。独立文档复审发现的resolve前事件/await后观察和control-unavailable命名已收紧，新增计时补充保留外层未观察边界；未修改业务、冻结C/JS/guard/workflow或原工件，用户image.png排除。

本轮输入cf35904055a840e6e5b3189eb8551beba17d7163/run35631266321 attempt1。主树 `.debug/stdio-close-35631266321/` 保存全部API元数据、artifact10653794664的完整ZIP（1422720字节/1449成员）、解压工件及两个离线审计。ZIP SHA256为64376d0c6c68521594b137e5f09bda636ea4445f67defa7fc243cdd257fe79ef；独立raw审计JSON为133b9fc9ed673cf23637837517e1b140e56266daed4a3af701545eeb9c80a20f。固定输入、编译环境、EXE指纹、27合成与9真实控制、五份输入快照只读CRLF/LF对账详见契约第16节。guard-returned事件最大1011.7495ms，调用方await后观察最大1012.3385ms，九项均在2000ms内；outer-returned事件最大1112.4939ms，但事件后仍写盘/resolve，未记录外层await后时间，不据此宣布外层完整返回预算已证。另存timing-observation-audit-v1.json限定这三类计时，原预算不改；未运行新PTY、真实Agent或产品验收。

G07本地证据位于独立树 `.debug/windows-stdio-close-selftest-v1-first` 与 `.debug/windows-stdio-close-selftest-v2-oracle`，分别21/27合成断言，后者源码/编译前输入快照与当前C/JS/workflow一致。JS/C/guard/workflow摘要见契约第15节；JS语法、workflow解析和内嵌模块语法、metadata/路径/历史保留、主树bridge回归通过。候选设计当前导航第1/6节已更新，历史实验协议及结果不变；未执行Windows本地编译。

本轮G07补证以独立分支2f630cd9、主运行时文档ebe303e7为起点，冻结协议位于共享生命周期契约第14节。新输入、自测、编译及首次Windows工件后续追加，不覆盖run35620967433或回改Windows G07三个旧结果。

2026-09-22 最终收口检查：两工作树各六份文档，metadata/索引日期与状态/关联路径/计划必需章节、diff whitespace及独立只读复审通过。本树候选设计第1–32节除当前导航外保持原文，契约第1–11节不变，四脚本/workflow字节与d173c099相同。两树新增契约第13节一致，官方源hash及两个审计JSON摘要核对通过。主运行时仅本地提交，本树只推本轮文档结果，不修改或重跑首次矩阵。

2026-09-21 三平台首次输入d173c099d37f83bb3178d280a6a6d8b80d984b92/run35620967433 attempt1，Linux/macOS/Windows artifact分别10648081653/10649965248/10649136626，三个ZIP各1280成员，完整下载及本地SHA256/源码指纹核对保存在主树 `.debug/lifecycle-contract-35620967433/`。offline-review-v1.json保留六组完整verifier结果：D1各37、D2原各24，无工件错误。环境、raw/完整性分类与最大guard/outer时间见共享契约第12节，不将self-test附加夹具计入111模型/72控制。Windows G07根因及三项未覆盖的补充证据另见第13节，不改原success或pass。

2026-09-21 D1/D2本地实施：D1正式目录为本树 `.debug/provider-lifecycle-v1-node25-first` 与 `.debug/provider-lifecycle-v1-electron39-first`，分别Node25.6.0及Electron39.8.7/Node22.22.1，各37/37并完整复核。自测 `.debug/provider-lifecycle-selftest-v1-first` 与 `.debug/provider-lifecycle-selftest-v2-promise-controls` 均保留，后者37正例/12类负对照通过。D2 `.debug/process-guard-v2-local-first` 保留原24项与captureIntegrity表达不足，按旧归档快照复核；`.debug/process-guard-v2-local-v2-deadline-integrity` 的24项及独立复核通过，最长1952.428426ms，raw为9/3/12，18real/6synthetic、零PTY。完整输入及开发自测沿革见共享契约第11节，不将9824f166工作区加源码快照写成尚未创建的提交输入。D2最终25项自测、独立只读复审及主树bridge/tracker/Supervisor聚合本轮通过；三平台workflow尚无remote结果。

2026-09-21 生命周期设计冻结：依据主运行时分支0518dcc4的只读业务核查以及第30节既有自然路径工件，登记新契约及D1/D2有限schedule。当前没有新script、新矩阵运行输入commit或新通过工件；本树只做6份文档差异及元数据/索引/路径/计划章节/历史保留检查。主运行时工作树dev-session-canvas2的既有bridge、tracker、Supervisor协议聚合及旧39项契约已通过，后者目录为该树.debug/lifecycle-contract-design-v1-node25；这些是原有回归，不计作本树D1的37例或D2的72条验收。以后新矩阵运行必须写全输入commit、运行时/OS、完整trace与源码hash，不补造本阶段新矩阵通过。

2026-09-21 HPCON首次原生收口：输入d0f0be882bf5f99d0dcaa90c94b7a3d6b0023790，run35586906307 attempt1，artifact10633047821；ZIP19738089bytes完整本地SHA256为4d60975924e1b6c3ff75421535ff7f9efd2413ad639419fbb4c81cfd52fd83e2。完整工件在主运行时工作树dev-session-canvas2/.debug/hpcon-owner-35586906307/runtime-windows-hpcon-owner-35586906307-1/hpcon-owner-evidence/；输入与编译fingerprints、原verifier及全部计数见设计第30节。补充只读审计在主树.debug/hpcon-owner-supplemental-audit-35586906307/，没有改写原工件。

本树.debug/hpcon-guarded-budget-control-v1/保留Linux纯Node语义控制，manifest SHA256为e053adf6b94787879ed8d8f08a9911b512bb422510d3ec8ece5028a991df6560；150ms watchdog后close额外晚884.470223ms。它不含PTY或Windows产品执行，也不证明本次原生run超时；相关工具债务已登记，旧入口不修改。

2026-09-21 HPCON 运行前检查：独立分支新增 windows-hpcon-owner-patch.mjs、diagnose-windows-hpcon-owner.mjs 和 Windows-only workflow；主重构分支仅文档。固定源/header SHA256 为 d502cce570552c7a1bea373c7672975eeb330c3025dd151cf9c180ca2a1becc2 / 32b74fe493b4435bc2f8362cfa4bcb4f49a290438002cc4a369e9379c7728d3c；生成源 cb0ab01aa21eceeb06eac88306f4cf8980c15ede94303810a44df9b724c40e58，patch a7093eb560c76ac596892ab8d262f138fa3521d0b38162c4e6e6c4e7595a627b。主树 .debug/hpcon-owner-selftest-local-v1 与 v2 均保留，v2 保存输入快照；这些只有合成会话，无原生 PTY。bridge 回归及文档元数据/关联路径/计划章节、workflow YAML 校验通过。

2026-09-21正常对象控制补充审计：原verifier各driver在warmup计数失败后早停行为断言，另在新.debug/process-objects-supplemental-audit-35560063334/直接逐事件复核36份manifest成员、2176事件、92child/690快照及全部owner单次关闭；未改变计数、原oracle或工件。保留440个计数超额快照、四个原失败，补充audit自身exit1且无新增issues。源CRLF只读归一精确匹配cbbba096，全部自然退出/采样时序与最终owner结算可核对。元数据/索引/路径/计划章节、workflow YAML、diff和bridge回归检查通过；未执行新PTY/真实宿主/业务验收。

本次输入b031b5981af6d009455d172e6c727d0b8a56ee67、run35519226627 attempt1完整失败保留。Linux/macOS/Windows分别4/4、4/4、16/16工件有效，后两平台各报告两个资源失败，非工件损坏；目录、环境、原始hash与服务端工件digest见设计第24节。Windows CRLF源码只读归一后与LF提交逐字相同，原工件没有改写。各平台观察器真实+3/-3自测通过，无driver watchdog或事后kill。

前一阶段固定原生输入为697ee3f0012aa9d68f1774fa9a43ba3836e165d7，run35516170917 attempt1的Ubuntu和macOS分别12/12通过。两个下载目录的独立离线复核均输出：

    {"attempted":12,"verified":12,"failures":[],"evidenceErrors":[],"note":"Offline verification, not new native execution."}

原始工件位于 `.debug/github-inplace-cancel-35516170917-macos/inplace-cancel-evidence/` 和 `.debug/github-inplace-cancel-35516170917-ubuntu-retry1/inplace-cancel-evidence/`，完整输入哈希、环境、工件ID和传输重试边界已写入设计第22节。本地v1两个不足100ms的失败和全部旧原生失败保留，复核成功不是新增原生样本或生产通过。

## 接口与依赖

下一版本的候选接口是同步返回handle的 `startObservedCase(spec)`：observation、processSettlement、evidenceSettlement三个不可变首报Promise，另有只读owner快照和有界late事实订阅；process exit不代替capture真实EOF。D3每case最多预留caller/evidence/publisher三个槽，任一hard截止仍unknown停止后续case，不与D4的N2混算。writer、独立verifier与publisher仅为标准库诊断角色，不新增生产模块、外部服务或依赖。

D4 v2使用完整command/return/event/snapshot、不可变owner identity和独立oracle；创建acquisition/use token/单次owner整体release/首次unknown/当前证明/tombstone分账。schema和常量可共享，SUT转换/验证/snapshot helper不得被oracle复用。八个新文件与CLI已在独立诊断树创建，当前仅本地初版和审计修正；运行时代码、旧live绑定、旧脚本/workflow及依赖保持不变。D4复合key使用JSON tuple，snapshot为隔离深拷贝而非JS冻结承诺；超时首报消费者预算仍须单独冻结。

设计冻结时点的候选 `startObservedCase(spec)` 尚未导出实现；当前独立诊断树已创建对应handle/CLI/oracle/fixture入口，但不等于生产导出。诊断台账的failureDomainId/allocationId/operationId只界定测试资源，不新增生产registry/wire；N/Q、D3毫秒数及W1/U1期限均不是生产策略。第一批只读使用锁定node-pty/native-addon-api源与headless consumer，依赖不升级，native副本按源hash/匹配计数和真实binary绑定；旧自然fork/guard/G07不改。

本轮已实现的四个新诊断文件仅依赖Node标准库；D1按新契约生成独立状态及trace，不读取生产业务类型或状态机。provider到adapter的数据入口由adapter唯一分配sequence，OutputSeal与source尾值一致；进程/资源未知观察的补证只匹配同execution/generation/operation。D2以ChildProcess公开事件和私有控制回执分开观察，不暴露raw fd/HPCON，不把G06注入当OS证据，不按未知PID清理。两个新CLI均支持 `--self-test`、`--output NEW_DIRECTORY` 和 `--verify-saved DIRECTORY`，本地与三平台采集/原始复核已经完成；Windows G07后续补证需另冻真实操作与观察接口，不能沿用fs.closeSync(1/2)返回证明关闭。生产桥接和wire接口不在本阶段修改。

本增量只新增诊断 fork 的 owner 状态接口：候选 native 必须提供受保护的 `shellExited` 发布和主线程 `closeAfterExit(id,generation)` one-shot 操作，并以带 generation/nonce 的 `markPipeEof`、`markConsumerComplete` 在 native 侧强制 Close 前提；它使用与创建/Release 相同的 bundled DLL 导出，记录 void Close 调用而不伪造返回值。现有 `PtyKill`、业务 node-pty API、Webview/Host/Supervisor 协议均不改变。三臂使用锁文件中的 node-pty、@xterm/headless、固定 Node/headers/compiler，不安装新依赖；所有源码/二进制/工具链 hash 随工件保存。

本增量是独立Win32普通进程控制，不加载native addon；新C使用CreateProcessW/WaitForSingleObject/ResumeThread/GetProcessTimes/GetProcessHandleCount/CloseHandle，JS只用Node标准库。未退出时GetProcessTimes的exitTime按官方说明未定义，仅记录不做零值断言。两类退出码和所有关闭由已知owner账本核对，不以image查询结果或全局对象消失作为验收。

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

修订记录（2026-09-21，资源归因收口）：两次新输入共322条PTY及全量下载复核完成，macOS自然路径close因果证据成立，Windows类型增长已明确但映像查询31使具体归属仍inconclusive。首次编译失败、基线资源红项、旧断言不改；下一增量先设计已知HPCON资源owner干预，生产契约和正缓冲分支继续开放。

修订记录（2026-09-21，对象语义控制）：用户要求先确认正常Windows对象引用语义，本增量插入无PTY的retain/close/no-child对照，再另冻HPCON干预；保留旧失败并限定assert移除baton的源码表述。冻结提交为主分支922ad635、独立分支e601f911，尚无本轮原生结果。

修订记录（2026-09-21，对象语义收口）：完成首次原生矩阵和全工件复核，官方与正常对象实验支持用户提醒；保留四个+5初始计数失败、旧PTY具体归属未闭合及全部旧结果，不改业务/依赖/断言，下一步仅另冻已知HPCON owner干预。

修订记录（2026-09-21，HPCON 运行前审查）：开始实现已冻结的三臂对照，补齐单次连接、真实 HRESULT、TSFN/owner 生命周期、stock API 隔离和实际二进制输入的审查要求；保留新工具草稿缺陷的原因记录，待独立自测和 Windows 原生矩阵后另记结果，不改业务或旧证据。

修订记录（2026-09-21，HPCON原生收口）：记录首次12driver/138会话/1260快照、46次Close的窄因果证据及完整ZIP复核，四个no-close原资源失败保留；更新当前里程碑为硬返回工具债务和生产API/adapter及缺口验收设计。新增Linux child.close控制只限定诊断预算保证，不修改业务、旧入口或原始失败，计划继续active。

修订记录（2026-09-21，生命周期契约与D1/D2冻结）：同步独立契约、第31节和索引/原则/债务，补进程状态未知、资源迟到补证、authority真实解析、读者outcome全链及三能力组合。下一步明确为四个新诊断文件和独立复核，D1共37子例、D2每平台24条含synthetic；G04有限TTL/私有回执、原生失败和生产预算边界分别保留。仅文档变更，历史1–30节除当前导航外不变，未运行新模型或原生矩阵。

修订记录（2026-09-21，D1/D2本地实施与runner准备）：同步候选设计第32节及共享契约第11节，更新四活章节和执行/验收/接口说明；D1本地双运行时各37项、D2新分类版24项及完整复核通过，v1/首轮缺口与旧工件不追认。新workflow固定三平台Node22.23.2、零依赖安装，尚未推送本轮输入或取得remote结果，下一步全量runner及下载复核。历史设计1–31节除第6节当前导航外不变，业务/旧入口/依赖不改，原生异常和生产退出完整性仍开放，计划active。

修订记录（2026-09-21，D1/D2三平台结果与G07前提）：追加设计第33节，完整保留d173c099/run35620967433的111模型/72控制、三个ZIP及原verifier结果；新增Windows标准fd close为no-op的源码/时序结论，三项G07前提未建立，不追认D2整组完成或改写其余69项。下一步优先另冻真实stdio提前关闭和独立主体存活，再推进原生异常与unknown owner有界隔离。历史设计1–32节除第6节当前导航外不变，本轮仅文档、原脚本/门槛/工件和业务不改，计划active。

修订记录（2026-09-22，G07补证冻结）：第14节固定三个模式各三次的Windows已知写端关闭/独立双challenge协议，复用原guard-v2及原预算；新增工具实现和首次原生矩阵待执行，不以旧pass、合成自测或正常对象语义替代前提证据。

修订记录（2026-09-22，G07工具实施）：完成隔离C/JS/workflow和27项增强合成自测，保留21项首稿记录；收口native错误枚举、outer事件独立派生、通知偏序及语义负例缺口，更新实际可用命令和源指纹。下一步只运行固定输入首次Windows矩阵，不改旧实验或声明产品完成。

修订记录（2026-09-22，G07首次原生收口）：固定cf359040的首次Windows九项控制、完整ZIP及可信入口/836项独立raw审计完成；三个新正例补齐真实关闭后存活前提，六负控按预期拒绝且raw分类不改。更新全部活章节和证据入口，旧三条G07仍not-established、旧失败与原始工件不变；下一步原生异常/unknown owner有界隔离设计与矩阵冻结，业务和生产预算未改，计划active。

修订记录（2026-09-22，原生异常设计启动）：承接G07窄补证和外层观察缺口，开始跨平台源码核查、owner隔离候选比较及下一矩阵冻结；未预选生产进程拓扑、数值预算或提前宣称异常路径通过。

修订记录（2026-09-22，原生失败第一批设计）：新增失败分层、逐资源台账、隔离候选及D3/D4/W1/U1第一批冻结；复审修订unknown定义、唯一Windows失败点、资源观察截止、分阶段预算、控制权链和洪泛偏序。当时没有新工具或原生运行，先实施D3/D4，第二批和生产接入继续开放，不改历史结果。

修订记录（2026-09-22，foundation v1证据与v2窄修正）：保留7141cfa3首次run35673511893及误触重复run35673550930均failure，完整六ZIP/36输入审计；区分跨pipe误判、缩放自测真实迟到与writer预算漏验，修正工件实际所属诊断树、D4字段和每runner24模型计数。先冻结发送端seq/身份、真实channel/时间、4096有界解析、协议失败及D3-08 ACK后bulk，再记录Linux Node22.23.2本地78/8/24及未缩放24项结果。同步四活章节和当前步骤，移除易漂移行号导航；当时v2三平台待验，三settlement、D4重放/身份及W1/U1继续开放，不改业务、v1输入或历史失败。

修订记录（2026-09-22，v2三平台收口）：追加唯一b4db41cc/run35676427931、完整三ZIP与15输入复核、真实Windows乱序成功解释、原始预算观察及篡改后其余23项有效验证。更新四活章节、下一里程碑及证据入口，当前转向独立结算契约；不追认旧失败，不将Node控制提升为PTY/生产验收，业务及旧入口不改。

修订记录（2026-09-22，v2篡改覆盖补证）：独立审计定位local-1根manifest失败短路run.scale，tamper verified0不能证明其余23项有效；保留原positive/full24和全部工件，修正独立读取及24/23/末项断言并增加tampered-verification.json。local-2增强自测、完整24项和独立输入/重放审计均通过，三平台runner待验；writer非法帧可能被sealed掩盖登记到完整settlement债务，不扩本轮代码。

修订记录（2026-09-22，新诊断结算设计冻结）：完成D3 v3/D4 v2协议和运行前矩阵的设计写入及外围文档同步，实施与验证待办不关闭；本阶段零新测试/native。最终静态复审及文档一致性检查已通过，下一步独立树本地实施/fixture/源码复审，再唯一三平台采集，不改旧实验或推进业务。

修订记录（2026-09-22，新诊断本地初版与审计）：同步八个新入口实施、D4 local-3与首次碰撞失败、sidecar重hash证明和D3首轮/交叉重放发现，更新四活章节及当前步骤。本阶段不运行D3真实矩阵、不新增runner、不推送；保留六组冻结覆盖、独立消费预算、D4 create/use正例和完整原生/产品门槛，不以自测总数宣称全部验收。

修订记录（2026-09-22，本地阶段文档补正）：补齐D3最终119/41/15/25及saved4/4，修正误截断的oracle hash与三处无效占位文本，明确首报及时冻结和到期冻结时的不同consumer判定。两树八份设计元数据/索引/关联引用、各12个计划章节、八源hash及共享新增契约对账通过；旧章节除显式consumer澄清外保持，独立只读复核未见新的确定性文档矛盾。本补正没有重跑诊断、原生或矩阵，不改变既有失败与未闭合门槛。
