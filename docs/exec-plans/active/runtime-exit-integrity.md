# 交付跨平台执行会话退出完整性

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖设计、实施和验收。2026-09-20 用户确认“退出完整性”属于本次 Runtime Persistence 重构的独立交付项。立项基线为 `388ec2b3`，方案阶段基线为 `a5112fb5`；PR #294 合并后，13 个重构提交已 rebase 至 `origin/main@5965adb8`，原生收尾阶段基线为 `10d40e63`。当前已完成S4默认关闭、无native的实际authority收尾接线及定向验证；真实PTY业务准入仍未批准，不推送运行时分支。既有S3首次0/2、修后2/2及全部历史保持，不把本计划视为私有 fd 补读或某种新 API 的授权。

此前原生诊断阶段所有新D3/D4/v2脚本、workflow及.debug工件仅在独立工作树 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates`，当时本树只同步文档。当前S1/S2/S3的生产模块和定向测试在本运行时树，诊断树只同步文档。以下旧记录中的本地“未提交工作树”均指采集时的诊断源码快照，不是本运行时树；v1后来冻结7141cfa3，v2后来冻结b4db41cc，不倒写采集时来源。当前协议、已完成验证和剩余阻塞项见本计划各节首段，后续历史段落的“下一步”不覆盖最新顺序。

## 目标与全局图景

本轮从`c1b6bc8b`完成S4实际接线补验，见生产接入第18节：Host 19/19覆盖成功启动、真实tracker消费与stop/delete、单根/多根reset入口；Supervisor 13/13含checkpoint等待期间断连/替换的直接修复。没有本轮PTY/native会话或runner，前轮协议回归实际运行旧PTY的分类错误按18.2勘误。下一有限切片为18.4的远端逐reader结算接收端，最终Webview ACK和本地完成屏障尚未实施，不把入口测试当UI/平台整链通过。

当前S4已完成，输入主树e84a8558/诊断树14fc6462；本轮在实际Supervisor/Host入口增加默认关闭、无native的准入与收尾分支，正常用户行为不变。定向结果和边界见生产接入第17节；以下第16节是已完成的前置设计，不是仍待重复的任务。

Linux接入条件阶段已形成三项产物：Supervisor/Host正常关闭的具名入口、provider卡住/崩溃/owner消失的能力表、L-01至L-05分层准入。第16节的前置设计已由S4无native接线完成一轮实现验证；真实PTY仍缺正常关闭失败处置和最终reader等条件，整体比较中/验证中。以下各阶段下一步是历史，不覆盖本段。

当前S3修后固定采集已完成，见生产接入第15.8至15.10节：输入3f8ebcae在Linux/Node22.23.2对原normal/flood各执行一次，新目录2/2、exit0；normal live最终状态及flood暂停消费下停止/回收、已读内容移交通过，两provider自然关闭、资源首报/当前released，无fault或追加清理。9份源码及原始事实独立核对，首次0/2的18文件逐项未变。不把有限通过扩大为跨平台或产品验收；下一阶段只收口Linux正常关闭及卡住时的最小接入条件，再转默认关闭authority接线，不扩崩溃全矩阵/通用工具，不自动runner/push。以下首败后、S2及更早记录按发生时点保留，不覆盖当前阶段。

当前S2实施与验证见 `docs/design-docs/runtime-exit-integrity-production-integration.md` 第14节。主运行时树已新增真实异步transport/provider channel，复用S1共享核心并补父侧资源证明、正常disconnect和未发送start的失败安全退役的adapter窄修；Linux/Node v25.6.0真实普通pipe七组首次7/7通过，S1回归35组、独立channel纯回归1组及typecheck通过。零PTY、无native addon、无现有业务导入，不运行runner或push。macOS/Windows/Electron、native read预算、平台失联、两authority/reader及真实Agent未验证；现有模式、manifest、storage generation和业务行为保持。下一有限项是首个平台Linux真实PTY provider接线，须先冻结读取/解码预算、资源责任和安全停止，复用现有原生证据；不另起通用工具或全量矩阵，不自动native/runner/push。下列S1及更早阶段是历史记录，不覆盖本段。

S1阶段已实施 无 native 核心：主运行时树新增共享类型/校验、真实 adapter 和直接加载模块的定向测试，不再处于仅文档研究阶段。实现覆盖一次启动、有限内容接受/消费、独立事实、封口、首次/迟到观察及同 authority 准入；现有 Host/Supervisor/Webview 业务入口、运行模式、manifest 和 storage generation 保持。补资源账本完整性回归后最终定向测试32/32、typecheck 复跑和既有 bridge 回归通过；统一文档静态校验通过。下一有限阶段固定 S2 真实异步 transport/provider 启动链、零 PTY，先冻结有限目标与安全清理，不接业务、不自动 native/runner/push；旧阶段“仅文档”及“下一步”均为当时记录，不覆盖本段。

本轮 PI-01/02/03 接口研究已形成 `docs/design-docs/runtime-exit-integrity-production-integration.md` 第9至12节：明确一次启动、身份与有界移交、owner 事件责任、两 authority 和两种消费者结算，固定下一步 S1 无 native 核心。S1 在主运行时树新增真实共享类型/adapter 及定向测试，不从现有业务入口导入，不改模式路由、namespace 或现有用户行为；不是另建诊断模型。当前仍仅文档与只读研究，没有执行 S1、测试、native 或 runner/push，统一静态验证已通过，结果见验证与验收。PI-01/02/03 未作为生产能力通过，真实 transport/native 与 PI-04/05/06 仍开放；下列旧阶段边界和当时下一步保留为历史，不覆盖本段。

本轮生产接入决策记录已形成，当前入口为 `docs/design-docs/runtime-exit-integrity-production-integration.md`。首选待验证候选是每个新会话在取得原生资源前建立独立 provider 子进程，终端权威状态仍留在 Supervisor（live-runtime）或 Host（snapshot-only），共享 adapter 只复用事实接线代码。已明确五类事实、内容移交、两模式和旧 live 边界、unknown 准入及 PI-01 至 PI-06；状态仍比较中/未验证。下一阶段仅收敛 PI-01 IPC 所有权、PI-02 父 owner 消失、PI-03 两模式接口安全，不自动实施或运行 A/B、U1/W1。本轮无业务改动、测试、构建、原生或 runner/push，静态文档验证已完成，结果见本计划验证与验收。下列旧阶段结果和当时下一步保留，不覆盖本段。

第27.10节已完成U1-6唯一首次macOS原生采集与完整复核：固定1a88d0cc、run35963751067 attempt1，三项场景/资源/证据判定均通过；runner和可信本地保存复核3/3，独立raw及构建来源审计无不一致。30项纯测试与三次原生分账。仅证明真实kqueue取得后合成注册失败的受控收尾，不是实际kevent错误或产品修复。下一阶段先收敛生产接入与故障隔离决策，不机械追加U1-7/W1全量、不扩通用工具门槛，主树不推送、不改业务。

用户在 Agent/Terminal 自然结束时，当前有效终端页面收到完整、按序的主进程尾部，即使程序返回非零退出码；自身已接收、排队或消费中的内容不能因提前清理而丢弃，最终终端状态正确应用并释放资源。尾部保证从主进程成功写入终端的数据开始，不包含程序自身尚未 flush 的应用缓冲，也不补造生产者未写出的 UTF-8/控制序列内容。主进程退出、真实输出结束、页面完成应用和主动取消必须区分；不能把固定等待、socket close 或最终 revision 当作全部输出已交付，也不能将超时/截断标成完整 EOF。不用把正常结束全部降级为中断来掩盖缺失。

2026-09-20 用户进一步确认：画板只管理 Terminal/Agent 执行会话及其终端资源，不逐个托管、追踪或恢复后代。Terminal 内部子进程/命令/后台任务由 shell、应用和操作系统管理，Agent 工具后代由 Agent 管理；实际主进程退出后，不默认保持节点或终端等待普通后代结束或接收其未来输出。主进程仍运行时，同一终端收到的输出不能按后代来源过滤。父子关系不等于前后台关系，通用后代实验不自动等于交互 shell 后台作业或真实 Agent 缺陷。

启动链另行验证：`Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` 中实际 CLI 是会话主体，不能按工具后代排除，也不能未经证明把包装程序退出当作 Agent 结束。具体收尾边界、取消条件和时间预算仍未选定。此澄清撤销“必须先满足 macOS 普通后代持续输出门槛才能选型”的优先级，不改变历史实验、断言、失败和工件，亦不将 macOS 标为已验收。

范围包含 Linux/macOS/Windows、Agent/Terminal，以及由 Supervisor 托管的 live-runtime 和直接由 Host 托管的 snapshot-only。结束后 Runtime 重开仍不恢复进程或历史，Supervisor/机器故障后仍无需恢复；F-03 root 归属、F-04 容量整体模型和 F-05 已取消的历史归档不在此项顺手改造。不必等待其他重构完成，但本项未通过验收前不得宣称本次重构的退出完整性已经完成。

## 进度

- [x] (2026-09-25，S4接线补验) Host实际入口19/19、Supervisor13/13，修复在途open断连/替换重登记；owner13/13、adapter53、Linux bridge/tracker/paged回归及typecheck通过。记录先红、清理ENOTEMPTY及前轮PTY分类勘误，不追认历史覆盖；Host历史被删fixture精确根因仍不可确认。
- [ ] 下一有限切片：按生产接入18.4实施默认关闭、无native的远端逐reader登记与结算接收端；之后仍须跨层能力协商与真实页面写屏障，不能将接收端通过称为L-02完成。

- [x] (2026-09-25，S4无native接线) Adapter closing/消费等待、共享owner收尾和两真实入口接线完成；owner lifecycle 13/13、adapter 53 cases、Supervisor wiring 11/11、Host wiring 5/5、既有bridge/tracker/paged/protocol回归及workspace typecheck通过。不开放native工厂，Host宽fixture的未决顶层await未作为通过依据。

- [x] (2026-09-25，Linux最小接入条件) 完成两owner入口、Linux控制能力与L-01至L-05门槛的只读定位；生产接入第16节及相关文档同步，独立复核补齐seal早于后批消费的屏障及单根reset/多根clear验收。
- [x] S4：默认关闭、无native的真实authority关闭准入/消费/资源收尾接线与定向测试已完成；reader协议及正常关闭失败处置仍按具名门槛后续推进。

- [x] (2026-09-25，S3修后有限采集) 输入3f8ebcae在新目录对原两场景唯一采集2/2，exit0；独立原始内容/live终态/资源与9份来源核对通过，首次18文件逐项未变，无测试残留。
- [x] Linux PI-02最小接入条件已由生产接入第16节收口：两owner正常关闭落点、外部控制能力表、实际authority准入边界；未扩崩溃全矩阵或新增采集，PI-02生产能力不因此关闭。

- [x] (2026-09-25，S3修后采集准备) 按生产接入第15.8节冻结同两场景、新目录及相同Node/native输入；仅增加测试目录参数，不改主体、断言或预算。只读输入与安全复核通过，原18文件失败归档摘要已记录。
- [x] S3修后采集：3f8ebcae冻结后normal/flood各执行一次，新目录2/2，内容、live终态、资源及旧归档不变均已独立核对，文档同步收口。

- [x] (2026-09-25，S3运行前边界) 冻结生产接入设计第15节：Linux独立PTY provider、固定node-pty创建代码、单线程WNOHANG owner、4096B单槽读取及两个有限真实场景；旧证据保持，不接业务、不运行runner/push。
- [x] (2026-09-25，S3准备) 资源取得协议adapter38组/channel1组纯回归与typecheck通过；native owner、精确源码补丁和新构建入口已实施，provider core直接纯回归2/2、source静态断言组1、bridge及最终typecheck通过，首次构建/零调用load通过，未创建PTY。
- [x] (2026-09-25，S3首次真实运行，未通过) Linux/Node22.23.2首次两个真实PTY场景均被Control send failed阻断，0/2，未重跑；normal exit7/readBytes2108、flood signal15/readBytes73472，报告allOwnershipSettled=true、cleanup safe/steps=[]且两个provider关闭。不以安全回收追认通过。
- [x] (2026-09-25，S3首败后握手修正) sourceEndAccepted明确源结束确认，不等消费、不吞真实发送错误；adapter43/43、channel6/6、core2/2、source断言组1、bridge、全typecheck与两fixture strict通过，独立复核无本切片确定性blocker，首次0/2不追改。
- [x] S3文档收口：两树8份设计元数据/索引/关联路径、两计划12标题及原序、production第2至14节历史保持、production正文一致和变更范围检查通过；两树diffcheck、8份mjs语法检查通过，不自动push。
- [x] 原安排的修后同两场景复验已由3f8ebcae唯一采集完成2/2，首次0/2及全部归档保持；新下一步由当前进度承接。

- [x] (2026-09-24，S2开始) 按生产接入设计第14节冻结本机Linux/Node真实异步transport/provider、零PTY普通pipe夹具、消息与父资源来源、最多两provider/各一subject及显式观察/清理预算；不改现有业务、不自动runner/push。
- [x] (2026-09-24，S2实施) 新增双向异步transport/provider channel，复用S1事实/帧/信用；adapter补父侧资源证明、正常disconnect与未发送start的失败退役。S1回归35组与typecheck通过；首轮通道TS2345/TS2339窄化失败及修正保留。
- [x] (2026-09-24，S2有限真实验证) Linux/Node v25.6.0普通pipe七组首次7/7、exit0，无重跑；8次provider尝试含ENOENT、实际7个provider/4个subject、8次transport close含失败spawn句柄。S1回归35组、channel纯回归1组与typecheck通过；纯回归旧代码内存负对照按预期拒绝，后续deadline guard四项内存hook及期限snapshot一次参数所有权检查通过，不计真实child样本。
- [x] (2026-09-24，S2最终非真实验证) adapter35/35、channel1组、typecheck、bridge、两mjs语法及fixture独立strict检查全部exit0，所有执行已结束；最终独立只读复核包含期限snapshot等修正，未发现本切片确定性blocker。未重跑真实七组，不追改首次7/7或历史失败。
- [x] S2统一文档静态收口：两树设计/索引/路径、正文一致、历史保持、计划标题与变更范围核对通过，首次S1导航正则漏匹配误报及纠正保留；详情见验证与验收。
- [x] S2安排的首个平台Linux真实PTY provider接线已由第15节冻结并进入S3准备；实际两场景及结果由当前S3待办承接，不计为原生通过，不扩通用工具或全量矩阵，不自动runner/push。

- [x] (2026-09-24，S1 核心已实施) 主树新增真实共享类型/校验、adapter 和定向测试；独立代码复核已检查并收敛 ACK 顺序、正常退役与迟到状态等直接问题。不接现有业务入口，不运行 native/runner/push；最终验证另列待办。
- [x] S1 阶段代码验证：定向31/31、typecheck修正后复跑及bridge回归通过，源码和31组测试独立只读复核无新直接阻断。保留首轮TS2339和两次用例未执行的esbuild路径/fixture失败；17/17、22/22、25/25、31/31是逐次增加覆盖，三项review回归不宣称全为红后绿。
- [x] S1 最终补充：resourceLedgerIncomplete 修正和专用第32组加入后最终32/32、typecheck复跑通过；代码登记修正及新增断言另经独立只读复核，旧31组结果不追改。
- [x] S1 文档静态收口：八份设计元数据/索引/路径、两树主文一致、生产原第2至12节和指定历史正文保持、两计划12标题原序、每树八tracked文档/主树三S1文件范围及无业务导入/诊断源码变更核对通过，两树diffcheck通过；导航与历史首次分类误报及重核见验证与验收。
- [x] S1安排的S2已由第14节冻结、实施并取得首次真实普通pipe七组7/7，仍不计PTY或产品整链通过；不接业务、不自动native/runner/push，不扩通用工具门槛。

- [x] (2026-09-24，PI-01/02/03接口研究形成) 完成三侧只读核对，生产接入设计第9至12节明确消息/信用/启动状态、owner事件责任、两authority与本地/远端结算及S1边界。无业务/诊断实现、测试、native或runner/push，统一静态验证已完成。
- [x] (2026-09-24，PI接口文档收口) 两树各八文件同步，八份设计元数据/索引/关联路径、新正文一致、八段实验历史及两份原设计第2至7节保持、两计划各12章节及原顺序检查通过；git diff --check通过。S1文件尚未创建，只做本地文档提交，不推送。
- [x] PI 接口阶段安排的 S1 共享模块与定向测试已实施；最终验证由当前收口待办承接，实际 transport/native 和两模式业务接线尚未完成。

- [x] (2026-09-24，生产接入决策设计形成) 完成实际接口、隔离、分发三个只读专项，新增独立设计，形成每会话provider首选候选、事实与所有权边界及PI-01至PI-06，设计阶段产物已形成。无业务/诊断实现、测试、原生/runner/push；静态文档验证通过，结果见验证与验收。
- [x] (2026-09-24，生产接入文档收口) 两树各八文件同步；八份设计元数据/索引/关联路径、新设计正文一致、八段历史正文保持、两计划各12章节及原顺序、八个生产模块路径和六项门槛检查通过，git diff --check通过。仅文档本地提交，不推送。
- [x] 上一阶段安排的PI-01/02/03接口研究已由生产接入设计第9至12节承接；S1实施输入与安全界限明确，真实transport/native、平台失联处置和两模式接线仍开放，不将三项整体标为通过。

- [x] (2026-09-24，U1-6文档收口) 两树各七文档同步；设计历史/21固定来源及20份非文档输入保持，六份设计元数据/索引/关联路径、两计划12章节和九个当前首段对齐检查通过，git diff --check通过。本轮验证记录在validation/final-docs-preservation.json，只做本地文档提交。

- [x] (2026-09-24，U1-6首次原生收口) fetch/rebase及触发范围确认后唯一push1a88d0cc，run35963751067 attempt1完成首次build/load、30项纯测与三项原生3/3；完整ZIP大小/摘要核验、可信本地保存复核与独立raw/构建来源审计完成。未dispatch/rerun，不推主运行时分支，不改业务。
- [x] 第27.10节安排的生产接入决策收敛已由独立生产接入设计承接，形成首选候选、责任边界和具名阻塞；A/B仅条件草案，不是已冻结可运行协议。静态文档验证已完成，产品验收仍开放。

- [x] (2026-09-24，第27阶段运行输入准备) 新增独立build/固定三项schedule/保存复核、两份有限测试和专用workflow；首轮30/30（此前21+新增9），补独立CLI保存复核后同30/30，13JS逐文件语法、YAML/7shell/2内嵌JS通过。独立只读复核无本阶段直接阻断，本地路径只匹配新workflow；push前仍需fetch/rebase复核。guard-only子进程未创建构建目录，无C++编译/加载/PTY/runner/push。
- [x] 第27.9节安排的唯一U1-6首次采集与完整工件复核已由27.10完成，不重跑U1-0、不rerun求绿。

- [x] (2026-09-24，第26阶段运行前) 按原生失败隔离第26节冻结Darwin真实创建/等待/源结束/释放协议，仅macOS U1-0三次，原预算与内容门槛不变；两树设计与计划同步。
- [x] (2026-09-24，第26阶段) 八个Darwin专用源文件已实施，保留同源helper/原生构建绑定；旧Linux guard、源与证据不改。
- [x] (2026-09-24，第26阶段) 已按确定的build/run/verify接口新增macOS-only push workflow，YAML解析通过；旧workflow不变，不安装node-gyp，不增加native自测。
- [x] (2026-09-24，第26阶段) patch2/2与verifier8/8首次通过，补master取得绑定后同8组复核通过；七JS语法检查、接口及独立整链静态复审通过，九个源/workflow文件摘要已冻结。本地没有Darwin构建或会话。
- [x] (2026-09-24，第26阶段) fetch后rebase origin/main为up-to-date，仅push诊断输入32312fe7；唯一run35900772851 attempt1成功，runner同10组纯测试和三次原生3/3分别通过，无dispatch/rerun，主树未推送。
- [x] (2026-09-24，第26阶段) 完整ZIP下载与GitHub digest一致，runner及可信本地保存复核均3/3、exit0；build/load零会话，三次真实2104字节/read0、完整终态、wait1792/exit7与逐资源结算成立。
- [x] (2026-09-24，第26阶段) 独立raw/来源保持审计25206检查零失败，其中三case15944检查；110旧tracked、15旧证据入口和1个installed source保持，不泛化为旧15GB全量深遍历。
- [x] (2026-09-24，第26阶段收口) 两树各七份文档同步；第26节一致、旧第2至25节保持，九个冻结源/workflow与32312fe7及冻结摘要一致。两份计划12个章节齐全，过期未运行措辞已修正，git diff --check通过；只做本地文档提交，不追加push或runner。
- [x] (2026-09-24，第27阶段) 只读核对确认当前候选在注册失败后跳过waitpid、现有ready gate永久等待，且stock Darwin路径不能作为修复模板；两树第27节冻结native-substitute、同一Wait线程唯一waitpid、kqueue单次close、token-bound abort/ack和三域判定，不改第26节源码或工件。
- [x] (2026-09-24，第27阶段收口) 两树外围文档同步完成；本阶段完成U1-6纯协议测试6/6，未构建、未运行runner且未改业务，过期的第26阶段当前入口已改为第27阶段协议状态，git diff --check通过。
- [x] (2026-09-24，首轮源码检查) 独立诊断树新增U1-6候选，10项局部纯测试通过；后续接口审计发现不足，不能把这次结果称为完整源码契约验证。
- [x] (2026-09-24，接口纠正) 修正native线程身份/数值errno、ready/gate职责、fork环境数组、abort记录、caller结算与fixture错误退出；补raw wait、临时owner、偏序及预算核验。新增负例先6/7失败，修后全套21/21，8个JS逐文件语法检查通过；独立只读复核未发现阻塞本轮有限结论的新问题。
- [x] 第27.8节安排的build/schedule输入准备已由27.9实施并完成有限本地验证；当时原生首次采集未执行，后续结果另见27.10，不倒写输入准备时的证据。

- [x] (2026-09-23，原生第25阶段) 冻结U1-5真实close后扣留上层回执协议，区分audit/被测状态与各自时钟；复用原native v4，不新增构建。
- [x] (2026-09-24，原生第25阶段) 四个v6文件、19/19纯测试和静态复审完成，冻结前语法/暂存格式检查通过；复用旧native v4，无新build，唯一U1-0一次/U1-5三次4/4，采集及独立进程保存复核exit0。
- [x] (2026-09-24，原生第25阶段) 独立原始事实/保持审计16134项零失败（四case自身2061项），170旧工件/34旧源/4冻结源/11快照/五旧build保持；两树文档同步，不改业务、旧证据或runner。
- [x] 第25阶段安排的macOS U1-0已由第26阶段新构建及唯一三项3/3取得限定证据，不直接套用Linux协议，不重判历史结果。

- [x] (2026-09-23，原生第24阶段) 冻结U1-4真实wait后跳过通知的合成closing协议；明确真实Push消耗引用与合成结果仍持有引用的差异，payload/TSFN各自单次收尾。
- [x] (2026-09-23，原生第24阶段) 八个新native v4/JS v5文件、61/61纯测试及静态安全复审完成；冻结前暂存检查通过，首次隔离build/load零native calls，唯一U1-0一次/U1-4三次4/4，采集和独立进程保存复核均exit0。
- [x] (2026-09-23，原生第24阶段) 独立raw/保持审计15292项零失败（四case自身1266项），157旧文件、8冻结源、11快照及五build各2759成员保持；两树设计/计划/外围文档同步，本轮不改业务、不触发runner/push。
- [x] 第24阶段安排的Linux U1-5已由第25阶段取得有限四项证据；未知观察不等于真实close失败，实际挂起/环境销毁/其他平台仍未验收。

- [x] (2026-09-23，原生第23阶段) 冻结Linux U1-3无额外门控的首次未确认/同线程真实wait协议，见原生失败隔离第23节；明确JS可晚于真实回收才观察、真实ECHILD不自动重试及fixtureScenario映射。
- [x] (2026-09-23，原生第23阶段) 八个新native v3/JS v4文件实施及冻结前暂存格式检查、45/45纯测试和静态安全复审完成；首次build/load零native calls，唯一U1-0一次/U1-3三次4/4，采集CLI和独立保存复核均exit0。
- [x] (2026-09-23，原生第23阶段) 独立原始事实审计12566项零失败（四case自身1349项），110旧文件、8冻结源、11快照及四build各2759成员保持；两树设计/计划/外围文档同步，不接入业务、不触发runner/push。
- [x] 第23阶段安排的Linux U1-4已由第24阶段取得有限四项证据；真实napi_closing及环境销毁仍未实测，不重判旧结果。

- [x] (2026-09-23，原生第22阶段) 完成U1-2协议、安全复审、隔离native v2与JS v3实施；新13组及旧15组纯测试28/28，新build/load验证8导出/零native calls。唯一U1-0一次/U1-2三次4/4，采集CLI与独立保存复核exit0。
- [x] (2026-09-23，原生第22阶段) normal完整2104字节/EIO/exit7/终态；三个U1-2均真实TSFN/非阻塞master后合成跳thread，close/control/Release/finalizer及首次唯一WNOHANG终态成立，没有thread/payload/通知。旧68文件/旧结果不变，未改业务、已安装依赖或workflow。
- [x] 第22阶段安排的Linux U1-3增量已由第23阶段新四项取得限定证据，不重跑旧样本、不扩通用工具前置。

- [x] (2026-09-23，原生第21阶段) 新增v2场景/资源/证据三类判定，复用冻结v1角色和aff95d1e binary；v1六项/v2九项定向回归15/15及静态复核通过。唯一新U1-0一次/U1-1三次4/4，CLI与独立离线复核均exit0，不重建native、不改业务或运行runner。
- [x] (2026-09-23，原生第21阶段) 新U1-0完整2104字节/EIO/exit7/光标x6/y4；U1-1三次wait256/exit1，close/control/wait/payload/TSFN/join有返回事实，未提交read/parser或许可输出。旧31文件、2759构建成员、installed source及binary不变；旧3/1/2及exit13不改。
- [x] 第21阶段安排的Linux U1-2增量已由第22阶段新四项完成，旧样本不重跑或改判；其余U1/W1及产品验收仍开放，不恢复通用工具前置。

- [x] (2026-09-23，原生第20阶段) 完成Linux U1-0/U1-1隔离候选、固定源/官方headers构建及6项针对性测试；同binary唯一计划六项实际执行4项：正常3通过，首次partial-create因signal-only附加断言失败，余2项not-run。四项raw均有close/wait/payload/TSFN/join结算；不把原失败改为通过。
- [x] (2026-09-23，原生第20阶段) 完成保存raw独立复核和本机glibc只读追查。原CLI最终动态import循环exit13保留；新增独立只读验证入口重放3/1/2并返回原失败exit1，零新增native。原driver/verifier/tests恢复并核对采集时字节一致，旧D3的314成员未变。
- [x] 第20阶段提出的退出形式/准入与新入口问题已在第21阶段新输入关闭，未补跑或重判旧schedule。U1-1确切child启动失败位置仍未确认，不以诊断该errno为全部原生工作的统一前置；其余Linux U1、macOS、Windows W1及产品验收仍待推进。

- [x] (2026-09-23，第18阶段) 已窄修非G1真实evidence消费顺序与完整80个phase聚合；修前10项8通过/2失败，修后同10项加ACK5项15/15，既有self-test五组及保存5/5通过。G1/G2原因果与100ms预算保持，旧失败不改。
- [x] (2026-09-23，第18阶段) 唯一新Linux42项exit0，可信保存42/42、314成员/7源exact，80phase/156receipt满足原预算；37个非G1先消费后发布、四组gate顺序保持。首次附加核对误断G2 held唯一的失败单列保留，按事实身份完成核对，未重跑矩阵。
- [ ] 下一阶段回到W1/U1实际创建/等待/资源路径及主进程尾部，原生实施前仅检查所用链路的判定/安全前提；平台证据据实际运行补齐，不把固定Linux诊断通过视为产品验收。

- [x] (2026-09-23) 最小因果对照成立：runRole返回/fd3 EOF后仍有1个fd4 read，父端保持100.508429ms后仅end ACK，read以0字节完成、active归零并自然exit0/null。修前五项1通过/4失败及源码保存在诊断树settlement-ack-stage17-before；core已仅补最后ACK/05无ACK写侧end，修后同五项及既有八项13/13通过。
- [x] (2026-09-23) 修后同五项及既有八项13/13，主self-test五组119/41/156/15/37及保存复核5/5通过。本轮唯一Linux42项完整执行，exit1而非外层超时；场景控制42/42，可信验收39/42，仅三个08的evidence consumer超100ms，acceptanceReady=false，完整归档保留。
- [x] (2026-09-23，第18阶段) 第17阶段提出的consumer顺序与77/80汇总窄修已完成；本轮唯一42/42通过，不追认旧39/42。

- [x] (2026-09-22) 按第16节完成范围与汇总纠偏、针对性8/8及本地主回归，并保留唯一一次Linux真实整链失败：180秒外层保护exit124，24条结算均false，09-1仅有启动证据，余17项无启动证据；保存复核按42项检查、0 verified，不是42项实际执行。本轮未成功，无PTY/native/runner或push。
- [x] (2026-09-23) 第16阶段提出的ACK对照、直接修复与重估外层保护已完成；新输入唯一42项结果见第17节，不将旧失败追认为通过。

进度中的第12–15阶段记录保留当时执行范围；其中“不运行真实D3”和先完成通用工具研究的顺序不是本轮限制。本轮执行以第16节条目为准，历史未完成项不自动成为此次Linux42项的前置。

- [x] (2026-09-22) 完成第15阶段错误字段/列表有界化，基准运行时4743e055/诊断bcfc571b。helper39、public29及独立saved29；tamper8正例/20组35变体，主回归119/41/156/15/37与saved5/5，portable46门禁/6profile/17负例满足原判据。首轮26/29、155/156及直接相对路径复核4/5保留；详见契约第15节。不改业务/D4/旧43项，不声明全owner/RSS有界，无真实D3/native/runner或推送。

- [x] (2026-09-22) 完成容量可达性与synthetic跨OS归档增量，基准诊断9230b87b/运行时fee95df9。容量43项分为1上界证明/30完整重放/12缺证拒绝；portable46门禁、6profile原位及移动各5/5、17负例；主回归119/41/156/15/37及saved5/5。首次路径/容量失败和复核过程偏差保留，详见契约第14节；不运行真实D3/native/runner，不改业务或旧实验，不推送。
- [ ] 非阻塞通用增强：新策略下任意2MiB请求可达性、无限listener/单chunk sequences与任意路径兼容性；旧六个错误洪泛构造不适用但证据不改。固定矩阵不依赖这些输入，只核本次实际请求、路径、归档与清理，不将此条设为原生实验或产品工作的统一前置。

- [x] (2026-09-22) 启动下一本地覆盖阶段：冻结 `diagnostic-consumer-delivery-v1` 的100ms独立交付判据，补齐并冻结D3 156项确定性边界及D4 create/use unknown迟到正例；按新目录保存首次失败、source和独立重放。只改独立诊断及两树文档，未运行真实D3/native/runner或推送。
- [x] (2026-09-22) 独立诊断树已创建D3 v3/D4 v2八个新入口，本轮只收口本地工具初版与审计修正，主运行时仅同步文档；不运行D3真实36+2+4、不新增runner、不推送，不改业务/旧实验/image.png。
- [x] (2026-09-22) D4 local-3 self-test/full及离线各16/16、302命令、58预期拒绝、1924 checks；93语义、4 saved和另存7个重hash sidecar负例通过。unknown key碰撞初次失败保留，tuple与sidecar修正经独立复审无新确定性阻断。
- [x] (2026-09-22) D3本地初版审计已形成正式 self-test-2：oracle119/core41/文件15/archive-consumer-binding25，各自通过；saved旁证attempted4/verified4、88 members、四源原字节exact。boundedConsumerDelivery=false、acceptanceReady=false，仍不代表冻结覆盖、live36+2+4或原生验收。
- [x] (2026-09-22) D4 local-4两次各16项、330命令/68预期拒绝/2092 checks，101语义及4 saved负例通过，离线各16/16。D3最终portability-check-1各组119/41/156/15/37 fixture判据满足，原目录/迁移目录及根复核5/5，13个重hash负例拒绝；三oracle误判、类别替换及离线读取/归一回归的首次来源与结果保留。156中154完整重放、2预期拒绝；不是156项完整证据通过。
- [x] 第13节列出的2MiB input可达性、helper8帧、trace/control各维邻界、late256、capture gate及listener failures条数已由第14节43项覆盖；跨OS绝对路径已完成合成验证，真实junction/归档与错误旁路字节有界性仍按新待办推进，不把此条完成当整体工具验收。
- [x] (2026-09-22) 完成下一版诊断结算契约设计与运行前矩阵冻结，新增 `docs/design-docs/runtime-diagnostic-settlement-contract.md`。D3进程/时钟、writer/封存和D4身份重放的三侧源码/协议复审建议已纳入；三侧最终静态复审及两树文档一致性检查通过，本阶段零新测试、零native，旧入口/工件与业务不改。
- [ ] 历史待办（第12阶段顺序，已由第16节范围分类取代）：D3冻结覆盖与独立工具门槛收口后，另行确认每runner36主控+2gate+4publisher真实采集；D4本地16项不算三平台模型48项已执行。
- [ ] 历史待办（不作本轮通用工具阻塞链，后续三平台/W1/U1另行确认）：本地门槛收口后，以固定新commit唯一一次三平台完整采集、全工件下载与可信Git oracle重放；W1/U1仍须等待这些诊断门槛，不因设计冻结启动。
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

2026-09-25 S4补验确认：Supervisor `openTerminalRead()`在快照await前检查socket，恢复后未重验就写入cursor/reader集合，断连时重登记失效读者；新增断连回归先报`Missing expected rejection`/exit1，修后13项断言通过的一次整轮又因journal清理`ENOTEMPTY`失败，等待已排队flush后最终整轮exit0。另前轮运行的`test-runtime-supervisor-protocol.mjs`确实spawn真实Supervisor并走旧PTY路径，前轮“全部无native/无网络服务”说明错误；第18.2节追加勘误，旧通过结果不改、不冒充新provider通过，本轮不重跑它。Host当前成功启动与真实tracker链已通过19项；新增夹具必须先等accepted尾值再发sourceEnd，不能以非法早发封口检验业务丢尾。历史被删fixture没有可复验版本，其未决await精确原因仍未确认。

2026-09-25 静态定位：Supervisor仅idle timer/registry flush后process.exit，没有统一关闭准入；Host异步deactivation之后仍同步dispose/kill，local启动在异步解析后才登记。父transport只能请求直接provider终止，Host退出后的内存unknown不再提供控制。独立复核还确认adapter的seal不等待消费且每批最多4帧，最终flush须先在terminal链外等待seal尾值消费，不能越过尚未排队的后批或在链内自等待。单根reset与多根clear入口不同，均须防止清map绕过unknown。这些是接线输入，不是本轮实测产品失败。

2026-09-25 S3修后事实边界：normal为2108B/1帧，flood为69632B/21帧；后者不同于首次73472B/20帧，是实际分块及停止时序差异，不能要求被停止主体的完整1MiB。normal此次不能代证跨read UTF-8分割；flood的seal早于最终消费，但provider控制资源释放晚于最终消费，不能反说原生证明provider先关闭。独立只读核验覆盖live终态、serialized和资源首报，首次18文件保持不变。

2026-09-25 S3修后采集准备：源结束握手只改变TypeScript通信，native三份实现源码与构建inputs摘要仍一致；因此复用同一已核对S3二进制，不引入无关重建变量。首次18文件失败工件保持，具体摘要与安全复核见生产接入第15.8节，尚无新采集结果。

2026-09-25 S3首败后定位与修正：代码链确认channel只等accepted即可close，而adapter后续consumed仍尝试发送，transport拒绝关闭后的发送并触发fault/unknown；首次trace未记录失败消息类型，故不能断言首次实际失败消息就是consumed，更不是OS或PTY丢尾部的直接证据。已加入sourceEndAccepted(finalFrameId)并通过有限纯回归；normal离线2108B精确且终态重建正确，flood73472B全x等于readBytes，但首次live终态断言未执行，0/2不改。S2 fixture仅把手写Exclude改为共享ExecutionProviderCommand类型，没有改主体或断言行为，不追认历史输入为新版本。

2026-09-25 S3首次真实结果：Linux/Node22.23.2首次两个真实PTY场景均被Control send failed阻断，0/2，未重跑；normal exit7/readBytes2108、flood signal15/readBytes73472，报告allOwnershipSettled=true、cleanup safe/steps=[]且两个provider关闭。正常provider close与父consumed ACK的竞态是当前待纯定位假设，不写成已确认根因、旧产品问题或尾部损失证据。保留首次输出与结果，不自动重跑，不因安全回收将场景失败改为通过。

2026-09-25 S3准备：固定node-pty创建代码可复用，但旧诊断v4的wait线程/TSFN与场景化PollWait不能直接当新生产owner接口。新候选移除实际SetupExitCallback调用，用唯一事件循环WNOHANG回收；signal在同次native调用确认pending后才kill，已回收或未知不再发送数值PID控制。fork后先记实际master/child，再执行非阻塞设置和JS对象构造，避免创建中抛错掩盖已取得责任。新增source断言、新构建及零调用load首次通过；尚无PTY运行，旧EIO/线程/TSFN成功证据不外推新poll/signal路径。同步syscall仍可能阻塞，同线程timer不是硬返回保证。 独立复核另发现新provider预算估算用空text而共享frame拒空，会令初始化必失败；首次真实运行前改为1字节哨兵并扣除其费用，保持共享非空契约。native poll异常改为显式unconfirmed、read错误进入失败清理；core直接纯回归2/2、source静态断言组1、bridge与最终typecheck通过。该问题属于新接线，不是旧产品实测缺陷，也不声称经历先红后绿。

2026-09-24 S2实施与有限验证：首轮provider channel严格typecheck出现TS2345/TS2339，ParentMessage的ACK联合类型未在命令分支充分窄化，补显式字段guard后通过；fixture独立tsc首次TS7006仅补类型注解后通过。close pending期间过早拒绝合法stop/cancel是本次channel实现问题，已窄修并通过真实channel纯回归1组，旧代码内存注入负对照按预期拒绝；首轮纯测断言位置错误及修正保留。provider不能声明父侧provider-control已释放，正常IPC disconnect不能单独证明资源unknown，唯一start尚未发送的启动失败须父侧确认全部已取得资源释放后才能安全退役，相关S1回归35组通过。真实普通pipe七组首次7/7；随后补execution入口deadline guard防外层超时后后台迟到创建，四个内存hook断言通过；transport期限冻结内部snapshot，一次无child参数所有权检查通过。后两处未重跑七组，不把原不变字面量输入改写成后来修正的验证证据；以上不是PTY、平台失联或真实Agent缺陷/修复证据。

2026-09-24 S1 实施与独立复核：慢 send 和快速消费会使合并 consumed 越过对应 accepted，现已改为 normal 队列先发 accepted；正常 provider 退役原会误触发全 authority quarantine，迟到 started 原会把已结束状态退回 running，两处已修正且不丢原观察。额度拒绝须继续处理已拥有 raw 前缀；控制观察还需校验已发送及命令结果类别。首轮 typecheck 的 TS2339 回调窄化丢失已局部修复，bridge 首轮通过；定向测试前两次分别因 esbuild 输出路径/require 不匹配、fixture 多传 cols/rows 失败，均未执行用例；修正后依次17/17、22/22、25/25、31/31，增加的是覆盖而非 native 累计。三项复核问题对应回归加入时修复已到位，不声称均经历红后绿。后续 resourceLedgerIncomplete 修正及专用回归加入后32/32、typecheck 复跑通过，既有 bridge 通过。一次性历史核对首次把两份总设计第6节当前导航误计为不可变历史而失败，识别指定导航后重核通过，未改文档迎合检查；统一静态校验通过。

2026-09-24 PI 接口只读核对：accepted 若立即返还信用，会把无限积压搬到 authority 的 pendingWriteData，因此须等真实消费屏障后 consumed。现有本地 sessionId 依赖毫秒时间，不能证明不可复用；新路径复用字段但改 UUID，并用独立于 storage namespace 的绑定 nonce 排除旧回调。本地 currentLocalOutputSequence 是接收进度，普通 snapshot 回调也非最终应用证明，须沿已有写队列另设一次 final barrier。owner 消失后的平台自动回收没有现成证明，责任分类与实际平台保障分开。以上为源码与接口结论，不是本轮新增实测故障。

2026-09-24生产接入只读核对：bridge 仍在返回前同步 require/spawn，两条本地路径和 Supervisor 均在创建后绑定；旧 onExit 关闭输出准入，Supervisor 最终快照 never 策略并非 tracker.flush。页面已有真实应用回调，但 close 未表达结算，本地 ACK 被现有 handler 排除。分进程把移交回执变成异步 IPC，必须分别处理内容副本与确认；provider 退出不证明主体、源、外部资源都结束，删除 session 也不证明释放。以上是新契约接入要求与源码风险，不是本轮实测丢失或产品故障。

2026-09-24 U1-6原生结果：三项同一Wait线程唯一waitpid均取得真实child/rawStatus0，再单次close kqueue成功，payload/通知/TSFN/finalizer/join完成后master单次close成功。gate/关闭前/最终快照分别35/49/54事件；第三项initial只有28事件而后续gate达到35，是线程调度的合法差异。无go/written/read/parser/state，source为null，故不能把本轮成功写成EOF或尾部消费通过。首次工件传输被手动中止、第二次下载成功属于传输事件，不是原生失败或重跑。

2026-09-24运行输入复核：旧baseline的停排分支只信summary.not-run，可能遗漏该项实际已有raw/evidence；新U1-6保存复核同时核预写config并拒绝执行工件，不修改旧baseline。首轮30/30通过，无新测试失败；合成build使用真实固定header/源码但binary/helper是未执行的占位字节，不计macOS原生。

2026-09-24接口复核发现首轮纯输入掩盖真实字段不兼容：固定thread标签/缺event.thread、数字EIO与字符串比较、fixture伪造native-ready、fork环境对象、abort记录和caller结算缺失。verifier还漏验raw wait与临时owner；新增回归在wait-status变异上真实失败（7组6通过/1失败，诊断树.debug/u16-source-contract-before.log），修后21项通过。首轮缺依赖根ENOENT和用node --check检查.h均为命令错误，不算C++验证；最终8个JS逐文件检查，C++仍未编译。

第27阶段源码复审发现，U1-6不能直接复用第26节角色：support的注册失败分支会关kqueue、Release TSFN并结束线程，却不waitpid；roles只等待`kqueueRegistered=true`才放行go，最终会让fixture自限退出并掩盖child未回收。这是诊断候选的确定性缺陷，不是macOS系统或产品故障。固定stock Darwin `pty.cc` 对非ESRCH注册错误也没有可复用的完整回收路径，且可能使用未确认status继续解码；不把stock缺口当作已实测产品bug。

第26阶段在macOS26.6.2 arm64/Darwin25.6.0真实完成posix_openpt/posix_spawn/同源spawn-helper及kqueue/kevent后唯一waitpid，不能套用Linux forkpty/EIO。三次read调用为5/5/4次、parser各3次，前两项多一次EAGAIN而最终均为正容量read0；每项56个native事件，writeGate前缀34个、close前51个，实际kqueue/master各单次close0。正常已注册路径成立并未覆盖早退/ESRCH或注册失败；旧run35527528410及其失败仍独立保留。

第25阶段实测三个U1-5的audit在请求后1.370315/3.658132/1.627234ms到达，first unknown在100.997445/100.679944/100.362286ms冻结，observer独立hold均至少100ms后才允许receipt；首次unknown保持，current补证released且只close一次。四项ready native都是24事件/close0，最终29事件/close1，非master资源先完成。未知回执与已释放资源可同时成立，不能据此称OS泄漏；未额外制造迟到timer竞态。

第25阶段运行前核查：failureCloseMaster正常返回JS snapshot不代表真实close成功，CloseMasterOwned的bool只代表已尝试。必须独立核value/errno与closeCalls。旧driver先close再等wait，U1-5须先完成真实wait/通知资源/read/parser，再等待释放许可；audit到达不能替代held回执，timer和receipt入口都复查单调deadline。

第24阶段四项实际wait均1792/exit7，U1-4三项虽无通知callback，仍完整读取2104字节、应用最终状态并释放payload/TSFN、join线程和close master。三个注入样本payload-freed ordinal16均先于Release-enter17；首项finalizer先于master close，后两项相反，证明两种合法交错都出现，不强加全序。没有真实napi_closing、ECHILD/EINTR或环境销毁；真实终态与通知是否交付必须分账。

第24阶段运行前核实：固定Node22.23.2真实Push在closing分支消耗thread_count，再Release会重复消耗；合成返回码没有调用Push，因此不能照搬v3的closing不Release分支，否则会遗留实际取得的TSFN引用。未入队payload仍由原worker拥有，不能依赖不会发生的JS callback释放。

第23阶段三个U1-3在JS独立首报时都仍未确认、退出码为null；两个driver初始snapshot尚无firstAttempt，第三个已有，体现线程启动竞争而非异常。四项各首次真实wait即1792/exit7，未实测真实ECHILD/EINTR或迟到JS首报。不能把允许迟到的纯测试当成本轮原生时序覆盖。

第23阶段运行前核查：旧v1 fixture只接受U1-0的go，不能直接传入native的U1-3；新config显式fixtureScenario=U1-0并独立配置native。U1-3不要求observer先报告unknown才放行，故无需为观测添加等待门控；immutable首报和最终终态分开保留即可，JS观察时间不冒充原生失败时间。

第22阶段完整暂存检查发现两个新增文件末尾空行（build-native-failure-v2.mjs及unix-native-failure-support-v2.h），exit2；前面的git diff --check只含已跟踪文档，不代表新增文件格式通过。为保留构建/采集字节未修这两处非功能告警，未重编译或重跑；新脚本功能与证据复核结果不变。

第22阶段实测三个U1-2均flags34818、真实TSFN后合成EAGAIN，原创建者close/control/Release成功，首次WNOHANG返回wait256/exit1且finalizer完成；未出现pending/EINTR，不把这些源码/纯测试分支当实测。Node22 N-API允许initial_thread_count包含主线程取得，Release不要求worker已启动；constructor-return和worker-start也不应人为全序。

第22阶段固定v1源码在线程创建异常后仅Release TSFN并throw，尚未覆盖child/master收尾；因此需要验证已取得对象的处置与未取得对象的明确缺席。不能为了回收失败的等待线程再假定新线程一定能启动，拟用原driver独占的非阻塞wait轮询。

第21阶段承接已证实的signal-only过度约束：kill返回0与wait终止类型并非同一事实。单项scenario失败不能自动抹除已证实的资源结算，原始status须独立拒绝stopped/continued，不能仅比较通知字段。旧exit1的具体子侧errno仍未知，本轮不扩启动诊断以求唯一原因。

第21阶段实测三个新U1-1均为status256/exit1，close及SIGTERM调用返回0、唯一wait与全部owner收尾完成；U1-0仍以1792/exit7完成内容和最终状态。未改binary即满足新判据，说明本轮修的是判定语义而非原生泄漏。静态复核发现缺native/坏shape会默认scenarioMatches=true，已在运行前窄修并覆盖；根回归第一次漏设DSC_DEPENDENCY_ROOT的13/15日志保留，补环境后15/15，无native重跑。

第20阶段已实测：U1-1首次wait原始status256，exit1/signal0，但master close0、SIGTERM调用0、payload/TSFN/thread全部返回，driver/caller自然exit0。原verifier额外要求signal1/15，准入将该失败当不可继续，因此旧reason虽写ownership/evidence unconfirmed，不是raw已经证明资源unknown。本机glibc的forkpty子路径login_tty失败可在恢复信号mask前_exit1；pty.cc的chdir/exec失败也可exit1，无child阶段/errno不能选定唯一根因。总入口在顶层await中经verifier动态import自身产生exit13，是另一个已确认的CLI循环，不是native未退出。

原生第20阶段只读确认forkpty成功与pty_nonblock/SetupExitCallback之间的登记缺口：旧路径在nonblock失败时直接throw，JS拿不到master/child且waiter未安装。U1-1 master可能仍blocking，不能套用nonblocking reader或补F_SETFL；关闭前未提交read，主动取消与自然EOF必须分账。

第18阶段仅承接第17节已实测问题：executeCase的归档准备先于普通evidence消费，三个08超过100ms；失败case不进入consumerDeliveries使77项聚合仍为true。G1本身需要先建立publisher gate，不能把普通场景的重排套用到它，也不能新增伪消费记录。

本轮新42项中08消费延迟为0.505902/0.490692/0.609307ms，156条最大79.961201ms属于G1；结果来自原始单调时钟，不是性能保证。附加时序核对首次误要求G2 capture仅一条held，实际四条分别是被暂存的数据和三个end；gateObservations绑定首条，release后才capture-settled。保留辅助断言失败，不改正式测试，按观察fact身份完成只读核对。

第17节因果对照确认了ACK等待环：父端只结束写侧即可让在途read以0字节完成并自然退出，无signal参与。修后真实矩阵还发现独立交付问题：08三次冻结至consumer为178.921449/130.366543/155.395370ms；executeCase先同步准备发布归档，再记录consumer，且三次在publication-start前已超过100ms。顺序已确认，未对每个函数耗时插桩；不是OS或产品缺陷。boundedConsumerDelivery=true只涵盖已成功聚合的77个phase，不涵盖完整80个；总体验收仍false。

历史发现（第16阶段，当时尚未作因果对照）：唯一一次真实整链发现caller与helper完成协议后仍不能自然退出：01-1在约72.696ms发出caller-finished，却在约5004.405ms收到TERM、约5010.412ms才exit；writer seal后也经TERM，verifier未启动。ACK关闭路径可能形成子端destroy等待在途fs.read、父端等待childExit后才end fd4的闭环，尚缺直接active request因果对照，不能定性为OS或产品bug。180秒外层保护先于全schedule结束；38个case与4个publisher的阶段预算合计388秒且未含编排/写盘，原保护并不覆盖完整最坏路径。首次失败揭示纯fixture通过不能替代真实role自然退出，原失败与不完整工件保留。

用户复核发现第15阶段错误详情完整性被误当所有场景成功前提，08正确截断也必然阻止整轮验收。无限listeners和任意sequences/错误洪泛/路径组合未证明影响固定输入，应退为非阻塞通用增强；此前独立复审和大量局部绿色遗漏了整体验收矛盾。

第15阶段确认role/stream错误数组与listener异常字段存在trace外无界保留，现已按独立错误策略收口；reason插入去重，destroy和listener补来源事件。首轮public两个字节构造越过message上限和一个ACK oracle漏判、主回归caller尚未创建时的空capture误拒均保留原输入后窄修。审查补缺摘要认证及report-frozen伪listener来源拒绝；首轮相对目录直接调用内部验证器的4/5另存，按CLI绝对路径入参5/5。listeners注册数和单chunk sequences仍独立待办，旧六个800条错误构造不再适用，不改原断言或直接宣称2MiB不可达。

第14节增量先确认两个独立工具缺口：Linux无法用宿主绝对路径规则重建Windows producer的publication fixture；trace容量不约束stream错误辅助数组或listener异常字段字节。首次路径拒绝和三个公开API容量反例分别保存在诊断树 `.debug/stage14-winpath-before-1` 与 `.debug/settlement-v3-capacity-reachability-review-1`，后者不代表OS真实错误轨迹或产品缺陷。

本轮确定性覆盖暴露三个oracle误判：4096字节无换行边界、合法verified之后lifecycle错误的artifact证明分类、及时EOF但退出越过hard时倒推capture complete；首个失败和source在boundary-second及CLI dev-1保留，修订仅作用于诊断oracle。另发现相同预期拒绝的archive fixture可被换类且重hash后旧saved仍4/4；可信输入/磁盘树绑定已补。self-test-3为156边界聚合超过64MiB而saved4/5，单独设计128MiB离线读取后self-test-4为5/5；当时本机绿色未覆盖CRLF和移动目录，现已按契约第13.4节补齐源结果组合与同平台迁移，跨OS整包仍待验。没有新增业务或OS缺陷结论。

本轮D4首轮绿色仍漏掉合法ID含/的unknown key碰撞：两个owner被合并成reused，unknownCount从应有2变成1。首次反例保留在独立树 `.debug/owner-quarantine-v2-key-collision-first-failure`；改JSON tuple并在固定D4v2-05回归，未新增平台标签或改旧失败。sidecar仅hash自洽而未与可信预期核对的缺口也已修，7个独立重hash负例拒绝。snapshot是内部状态隔离深拷贝，不额外宣称JS深冻结。

D3 cross-replay-1对纯正常core样本的误拒来自oracle多算stdin JSON换行1字节；实际core只发送JSON并以EOF分隔，修正移除多算字节而不改core输入。迟到错误必须按首报ordinal截断，不能回溯污染原首报；owner/unknown/event/scenario与归档身份也要独立重放。首轮自测的局部绿色不替代冻结覆盖，剩余六组及最终证据见诊断结算契约第12节。

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

2026-09-25（S4补验优先）：成功启动后的Host消费/收尾和reset/clear是本轮所改真实入口，不能因为共享owner绿色或fixture未决就永久后移。先用现有测试明确复现并补齐，不新增框架、native或通用边界。跨层reader最终ACK另成有限切片，当前只读核对能力协商与结果传递，避免同时开放未验证新路径。

2026-09-25（S4最小接口）：新增executionOwnerLifecycle共用真实模块，先reserve后异步准备，关闭后保留未返回prepare直到调用方清理并abandon；不伪造同步process/onExit兼容层。Host仅Test模式显式注入，Supervisor正常main无注入；预算仅测试依赖，无生产默认值。Adapter提供事件通知和seal消费等待，owner链外等待、实际authority链内flush；reader只显式cancelled/lost，不补造applied。先按生产接入第17节实施和验证，不再进行一轮通用工具研究。

2026-09-25（分层接入）：依生产接入第16节允许S4先做默认关闭、无native的真实入口接线，不另建模型或新增工具门槛。L-01关闭编排、L-02实际消费/reader、L-03原控制对象与正常关闭失败处置、L-04创建前能力拒绝是native业务接入前条件；L-05异常owner消失风险在默认启用前按支持环境验证。拒绝把杀provider当主体已结束，也不新增独立杀所有主体/后代的普遍保证。S4测试注入预算不作为生产期限，旧live与默认路径不变。

2026-09-25（S3修后有限通过）：原两个场景、新目录、同一已核对native二进制、相同主体/断言/预算，目录参数窄改提交3f8ebcae后只采集一次，2/2不覆盖首次0/2。下一步依据生产接入第15.10节区分PI-02接入前必需控制与默认启用前异常失联风险；只定位两owner正常关闭入口、形成Linux外部控制能力表和后续authority准入边界，不自动实施机制或再采集。

2026-09-25（S3修后采集）：只增加`--output`选择新证据目录，保留默认旧路径的拒绝覆盖行为；不修改原主体、断言、预算或清理逻辑。先本地提交冻结输入，再对原normal/flood各执行一次，不自动重试、扩大矩阵或触发runner/push。

2026-09-25（S3有界源结束确认）：选择sourceEndAccepted(finalFrameId)，不使用猜测时间窗或忽略真实send错误。父adapter合法sourceEnd后停止生成信用ACK并清除冗余未发送ACK，确认沿单send队列等待旧在途发送；provider校验同identity/精确finalFrameId后才正常close，不等消费，确认不归还信用、不证明consumer/process/resource完成。确认等待期间stop/cancel仍服务，缺确认不能由超时伪装成功。首败后纯验证与离线内容补证不改原0/2；下一阶段只冻结新输入/目录复验原两场景，不扩矩阵。

2026-09-25（S3首次失败处理）：把首次0/2、主体退出和已取得责任结算分别记录；保留.debug/s3-linux-provider-first，不修改判据追认通过。仅围绕Control send failed的关闭/ACK候选竞态做有限纯定位，修正与纯回归待实际完成后另记，未经新授权不重跑PTY或新增矩阵。原两个场景及生产边界不变，安全回收不等于退出完整性已交付。

2026-09-25（S3有限输入）：固定Linux/Node22.23.2、node-pty1.2.0-beta.12/node-addon-api7.1.1与既有官方headers，仅对新副本打摘要/唯一锚点补丁，不改安装源或冻结诊断。每provider只有原生master/child回收责任及JS源暂存责任，无wait线程/TSFN；4096B单read槽、最多3B decoder尾、一个编码槽与S1信用共同约束输出，await channel.write后再read。新增资源取得消息与资源结算沿同一紧急FIFO，父provider-control保持父侧证明专属。只准备两个无后代主体场景，30s观察、subject20s自限与TERM2s/KILL2s/资源观察2s是测试预算；安全未确认不得进入下一项或杀provider冒充主体回收。原生两项须先复审后首次运行，不自动重跑、runner/push或扩工具。

2026-09-24（S2有限实现与收口）：第14节Linux/Node v25.6.0普通pipe transport/provider是后续共用模块，不复制诊断框架；零PTY、无native addon、无现有业务导入。最多两provider/各一subject，消息身份与父资源证明严格分责，正常disconnect、provider退出、输出EOF及通道结算分别记录。七组首次7/7，未改10s观察及TERM 2s/KILL 2s测试清理预算，不据此选定生产预算；35组S1、1组channel纯回归、后续四项hook与一次参数检查各自分账，不作为PTY样本。正常owner关闭责任不变，异常owner消失不新增主体/普通后代清零保证。下一有限项是首个平台Linux真实PTY provider接线，须先冻结读取/解码预算、资源责任和安全停止，复用现有原生证据；不另起通用工具或全量矩阵，不自动native/runner/push。

2026-09-24（S1 实施）：新增的共享 adapter 是后续真实 provider 要接入的同一实现，不复制成诊断模型。transport、消费 Promise 与观察时钟可注入，accepted 与 consumed 分责；两个执行共享 authority 的 N=2/start=1，未知责任冻结新准入而不阻塞既有安全处理。authority 准入表直接强引用当前 execution/owner 记录，只有同一身份 release 才移除，unknown 责任不依赖 node 映射存续。独立复核只修本次实现直接竞态，未扩通用工具门槛；拒绝重复/非法/超限资源登记时保留 resourceLedgerIncomplete，不能用已知旧资源全 released 掩盖未登记责任。下一步 S2 只验证真实异步 transport/provider 启动链且零 PTY，先冻结有限目标、消息来源和安全清理；平台 PTY、业务/reader 接线和默认启用门槛仍后续独立推进。

2026-09-24（PI 接口与 S1 边界）：冻结 prepare/bind/start 和同操作首次/迟到观察语义，executionId 复用 UUID sessionId，generation 复用握手 nonce；accepted 移交责任，consumed 才归还受控信用。远端扩展既有 readId close 结果，本地复用 outputSequence、surface 生命周期和 writeGeneration 的最终屏障，不新增 local journal/readId。OutputSeal 后真实 flush，固定 finalRevision 与关闭新 reader 同一无 await 边界不变。下一步只实施主树无 native、无业务接线的真实 adapter 核心及定向测试；不先追加通用设计轮、诊断工具或 U1/W1，不把异常 owner 消失扩大成主体/后代清零承诺。

2026-09-24（生产接入候选收敛）：首选 authority 留父进程、资源取得前建立每会话 provider 子进程作为待验证候选，不新增需用户部署的 server，不直接搬运诊断代码。共享进程的错误记账不能隔离同步 native 不返回，worker thread 不隔离地址空间崩溃。复用既有文本 sequence/终端 revision、身份、reader 与串行链，不新建全局 owner 注册表或第二套消费水位。OutputSeal 关闭新终端操作，真实 flush 后固定 finalRevision 并在同一无 await 边界关闭新 open，此前合法已准入和 open-inflight 计入既有 reader。先收敛 PI-01/02/03；A/B 仅条件草案，未冻结可运行协议。PI-04/05/06 是默认启用门槛，范围受限切片仍须先具备自身安全界限。

2026-09-24（U1-6首次原生及后续收敛）：固定输入只push一次，三项结果与纯测分账，完整下载后从可信工作树复核、另由原始事实和来源字节独立审计。有限异常路径证据不批准生产默认接入；下一阶段先收敛生产方案，不机械补全故障编号。A的同步native等待/释放不返回时B能否继续交互，会改变拓扑选择，现有独立driver/D4模型不能证明；只在决策确需时另冻最小A/B协议，不在本轮追加实验。其余平台、取消、实际Agent、宿主与packaged验收不撤销。

2026-09-24（U1-6运行输入准备）：固定仅三项U1-6，无U1-0重跑；保留原预算与三域分账，资源或证据不足才停止后续准入。复用既有macOS构建/主控模式及冻结writer，新增隔离入口，不修改635aa311候选或旧入口；保存复核只运行可信工作树代码。先本地完成有限接口/归档验证，原生构建与唯一runner另行推进，不追加通用工具门槛。

2026-09-24（第27阶段接口纠正）：只修本次判定和安全所需字段、owner与预算对接，不增加通用工具前置。受控abort要求exit0属于场景域；合法非零/signaled终态可有真实回收，不能因此判资源失败。保持单次waitpid，不重试EINTR；未确认终态保留kqueue未结算并停止准入，不造通知或exit0。实际std::thread::id只在同driver内关联，不冒称OS TID；child由driver创建，取得kqueue的Wait线程独占回收。纯输入改为abort0与实际ready字段，不改冻结U1-0或历史失败。

2026-09-24（第27阶段协议冻结）：源码核对确认注册失败后必须由同一Wait线程直接对登记child执行唯一阻塞waitpid；kqueue注册替身只产生合成-1/EIO，不调用真实kevent，kqueue由同一owner单次close。数据gate保持关闭，不发送go，fixture经token-bound abort/ack有界结束；scenario/resource/evidence三域分开，任何数据泄漏、owner未知或证据不足停止准入。本阶段不实施、不构建、不运行runner。

2026-09-24（第26阶段结果）：macOS正常已注册路径的三次3/3与10组纯测试、build/load零会话及25206项独立审计分账。输入32312fe7只push一次，run35900772851 attempt1无dispatch/rerun；完整ZIP核摘要，可信本地离线3/3通过。下一最小项仅建议冻结macOS U1-6合成注册失败协议，不把正常read0、wait及单次释放外推为异常/早退或产品通过。

2026-09-24（第26阶段运行前）：只执行macOS U1-0三次；fixture ready与kqueue注册均成立后才放行原负载，早退/ESRCH不在本轮覆盖。真实read0、wait exit7、kqueue及master单次close0、完整消费分别验收。新增macOS-only push入口复用现有托管runner，不改旧矩阵，不扩D3/D4、容量或生产接口研究。

2026-09-24（第25阶段收口）：19项纯测试、唯一四项原生及独立审计分账，复用native v4而非新编译。只有receipt更新被测当前证明，audit和首次unknown分别保留；正常资源成功与观察及时性分别判定。下一最小项转向macOS U1-0实际创建/等待/释放差异冻结，不再追加Linux工具研究或宣称全平台生产通过。

2026-09-23（第25阶段运行前）：复用native v4及binary6e96a9dc，U1-5仅JS delivery-held，config显式nativeScenario/fixtureScenario=U1-0。已有IPC按消息类型分开audit与被测receipt；同token/唯一operation单次close，首报unknown与迟到released并存。100/1000ms及hold至少100ms沿用第9节，不是生产期限。

2026-09-23（第24阶段收口）：新U1-0/U1-4四项独立记4/4，61纯测试和15292审计检查不计原生样本。仅确认合成通知未入队后的已取得资源收尾，真实closing沿用官方不再touch契约；下一步先冻U1-5真实close/上层unknown/迟到补证三类事实，不选择生产API或扩张工具前置。

2026-09-23（第24阶段运行前）：仅新增notificationCallInvoked/notificationFailureInjected及call-skipped事件区分返回来源；合成路径由原worker释放未入队payload和真实TSFN acquisition，真实closing路径不变。不开Abort/env销毁实验、不新增门控或备用通知，正常输出/最终状态要求保持。

2026-09-23（第23阶段运行后）：新4/4与旧结果分账，首报保留synthetic/unconfirmed而不随真实exit7覆写；无新gate或竞争reaper。下一增量U1-4先解决合成napi_closing下仍取得的TSFN/payload责任，不能冒充真实环境销毁；不追加本轮原生运行。

2026-09-23（第23阶段运行前）：采用同一worker内一次synthetic跳过再真实wait的有限协议；firstAttempt不覆写，真实ECHILD停止为unknown，只真实EINTR可重试。不新增ACK/线程或扩大工具前置，新四项与旧矩阵分账，生产策略未选定。

2026-09-23（第22阶段提交补记）：显式保留两处EOF空行告警，不为格式清理改动已冻结源码身份；下次新版本在冻结前检查新增文件，不追认本次完整暂存检查通过，也不扩展工具验证。

2026-09-23（第22阶段收口）：独立记录新U1-0/U1-2四项4/4，不混入前两批通过率。仅确认本Linux注入点的既有资源收尾可行，未创建的thread/payload/notification保持缺席；下一步先冻结U1-3合成ECHILD后同一reaper补证，不扩大到真实环境销毁或生产API，也不再追加本轮实验。

2026-09-23（第22阶段运行前）：按原生失败隔离第22节，U1-2跳过std::thread并注入合成EAGAIN，原创建者close/control/Release，driver通过token-bound单次WNOHANG轮询回收。无thread/payload/notification不得伪造完成；新四项与旧样本分账。正式生产布局未选定。

2026-09-23（原生第21阶段收口）：新4/4独立记录，旧3/1/2与exit13不变；只关闭v2真实终态、资源准入及CLI复核入口问题。下一增量回到Linux U1-2真实TSFN取得后thread-start失败，不再扩工具；先明确未启动thread不可join、child/master/TSFN各自处置及失败停止，再冻结新输入。其他平台及生产路径不从本Linux结果外推。

2026-09-23（原生第21阶段运行前）：新版本分开scenarioMatches/resourcesSettled/evidenceSufficient，准入只由后两者决定，pass仍要求三者。U1-1任何有效wait终态均保留真实原因，不要求signal；124/125仍为场景失败，close/control失败或缺证仍停止。固定新四项使用原v1角色及同binary，新入口与oracle静态依赖避免TLA自循环；不改变旧采集和断言，不扩工具门槛。正式依据为原生失败隔离设计第21节。

2026-09-23（原生第20阶段收口）：保留3通过/1失败/2未运行及原CLI exit13，不更改信号断言求绿或补跑本轮。资源结算事实、终止形式和场景预期必须分账，kill返回0不强制wait报告signal。为保留冻结v1身份，撤回运行后的纯模块拆分尝试，改新增独立只读verify-native-failure-v1入口完成离线复核；原driver/verifier/test摘要与采集一致。下一版仅修退出形式/准入这一本次直接问题并避免入口自循环，不扩工具框架、不开新runner或业务接入。

2026-09-23（原生第20阶段运行前）：先做Linux U1-0/U1-1各三次，不以跨平台通用工具门槛阻塞。仅隔离诊断fork登记owner并汇合唯一reaper；失败路径close后、waiter前对未reap的owned child尝试TERM，保留真实返回。自然路径先源/consumer结算后close；TSFN/thread/payload/finalizer独立记账。保持第10节30/32/35/36秒及20秒fixture安全自限，直接g++编译固定源/headers并绝对加载。本轮不改业务/已安装依赖/旧实验，不推送或触发runner，设计详见原生失败隔离第20节。

2026-09-23（第18阶段运行前）：复用consume先注册非G1 evidence的真实await续体，归档仍取实际快照；G1/G2保留物理gate顺序。消费汇总以可信fullSchedule的80个唯一phase和完整receipt名称为分母，维度不绑定report.pass。不改core/oracle或预算，不新增工具框架；原测试加最多两项、局部回归后一次新Linux42项，外层480秒加5秒清理，失败不重跑。本轮无业务/PTY/native/runner/push。

2026-09-23（第18阶段收口）：固定Linux整链42/42与真实消费顺序核验通过，停止追加工具实验，下一步回到实际原生生命周期。旧partial及39/42、G2辅助断言错误分别保留；不要求被扣留流事件的held名称全局唯一，只按实际gate观察fact绑定验证，正式gate和100ms断言不变。此项不关闭跨平台/真实PTY或产品债务。

2026-09-23：因果成立后采用父端最后ACK写入后end的最小修复，05无ACK路径在接线后结束，09首ACK与gate不提前关闭；保留childExit兜底和独立源EOF/退出判断。本轮只新采集一次完整42项，外层480秒及5秒清理不改场景预算。三个真实consumer超时原样保留，不放宽100ms或重跑筛绿；下一步只处理实际交付路径，不追加通用容量/归档研究。

2026-09-22：保留唯一真实整链exit124及全部partial工件，不重跑同输入筛绿。下一步限最小真实role对照确认ACK候选闭环，确认后仅修直接原因，再以新输入最多一次既定42项；先按388秒阶段预算加编排/写盘重算外层安全保护，不放宽场景预算。收紧08例外，必须另证writer/verifier在原预算内无控制exit0、输出end及独立验证；现存三个partial08均不充分。本轮不再实验、runner或push，通用工具增强不恢复为前置。

2026-09-22：按诊断结算契约第16节重排范围。只允许本次判定或实验安全的具体问题阻塞；保留errorDiagnosticsComplete原义，另按固定场景评估证据充分性，不豁免缺证。针对性回归后直接验证一次Linux42项真实Node整链，不继续默认2MiB→listener→sequences研究，也不扩大为产品通过。

2026-09-22：按契约第15节实施diagnostic-error-retention-v1。字段UTF8前缀128/128/2048，role/stream/listener列表各256条及完整JSON数组65536 bytes，首次省略封前缀；reason插入去重，listener/destroy补独立事实。语义有效与errorDiagnosticsComplete分开，后者还要求错误账本认证成功且trace/control无损失，并限制acceptanceReady；首报不变。caller尚未创建只允许空capture流，report-frozen不能伪装成late来源，helper destroy不扩大failed分类。固定39 helper、29 public及20 tamper组，新增变体另计35，不扩大为全进程内存或原生验证。

2026-09-22：按诊断结算契约第14节分离producer路径身份与本机读取。仅显式clock和spawnRole的测试允许pathStyle覆盖，真实启动保留宿主校验；raw readlink不归一改写。固定43个容量研究目标和6个synthetic producer profile，独立driver不递归主self-test；无法到达的字节边界记录证明。错误列表有界摘要另行设计，本轮不顺手改变状态机制；不启动真实D3、native、PTY、runner或推送。

- 决策：冻结诊断独立交付策略 `diagnostic-consumer-delivery-v1` 为F+100ms的严格边界；F<D时仍须R<D且R<F+100ms，F>=D时只核交付窗并保留迟到冻结事实。理由：操作deadline和实际消费是不同事实，不能延长原deadline或用晚冻结掩盖早应交付的首报。日期/作者：2026-09-22 / Codex。
- 决策：D4在原16场景中补create/use unknown迟到正例，不改模型；D3新增156项确定性边界但将两项control耗尽记录为预期不可重放，并保留具体未覆盖容量阈值。boundary聚合文件专用128MiB离线读取，不改变单case协议限额。理由：测试判据成立不等于所有证据完整，更不等于原生/产品验收。日期/作者：2026-09-22 / Codex。

- 决策：本阶段只交付独立诊断的本地初版与审计修正，不执行D3真实36+2+4、不新增runner、不推送；下一步逐fixture补齐冻结覆盖，之后另行确认真实矩阵。理由：自测总数不能替代覆盖与独立oracle有效性，保留首次误拒和模型碰撞证据。日期/作者：2026-09-22 / Codex。
- 决策：D4复合unknown key采用无歧义JSON tuple，负例sidecar与verification逐份按可信输入复算；保持固定16项和旧证据不变。理由：ID允许/，拼接key和仅hash自洽都可能把不同责任/错误证据误判为同一对象。日期/作者：2026-09-22 / Codex。
- 决策：消费者续体与首报冻结分账；deadline前首报的消费者到达同deadline或之后为迟调失败，到期才冻结的超时首报只保存延迟并标delivery-budget-unresolved，独立消费预算另冻。理由：后者不可能在原deadline前被await，不伪报及时、不加宽限或改首次deadline。日期/作者：2026-09-22 / Codex。

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

S4接线补验已完成：Host 19/19与Supervisor 13/13直接覆盖所改入口，两个专项交叉复核无本切片确定性blocker。业务修改仅Supervisor owned分支await后的session/socket/reader-map复验，Host和旧执行路径没有修改。首败、清理失败和前轮验证分类勘误分别保留，历史Host exit13不追认。reset覆盖实际Host决策和持久化调用，但I/O仍是替身；fake资源事实也不证明OS回收。下一步为远端逐reader接收端，本地/远端最终ACK、native失联处置及生产分流仍开放；以下S4首轮结果是当时记录，其中零PTY范围以18.2勘误为准。

S4完成第17节约定的无native有限产物：共享owner生命周期已接入实际Supervisor/Host入口，关闭准入、在途预留、seal尾值消费等待、真实tracker最终flush、unknown和reader责任分别保留。owner lifecycle 13/13、adapter 53 cases、Supervisor wiring 11/11、Host wiring 5/5，既有bridge/tracker/paged/protocol回归及workspace typecheck通过；未启动PTY、native、runner或网络服务。Host宽tracker fixture的未决顶层await被明确移除而非追认通过，reset/clear完整UI整链、reader最终ACK、native失联处置/预算和生产能力分流仍开放。PI-01/02/03及产品总债务保持开放，文档静态检查结果记录于验证与验收。

当前S3修后固定采集已完成，见生产接入第15.8至15.10节：输入3f8ebcae在Linux/Node22.23.2对原normal/flood各执行一次，新目录2/2、exit0；normal live最终状态及flood暂停消费下停止/回收、已读内容移交通过，两provider自然关闭、资源首报/当前released，无fault或追加清理。9份源码及原始事实独立核对，首次0/2的18文件逐项未变。不把有限通过扩大为跨平台或产品验收；下一阶段只收口Linux正常关闭及卡住时的最小接入条件，再转默认关闭authority接线，不扩崩溃全矩阵/通用工具，不自动runner/push。以下首败后、S2及更早记录按发生时点保留，不覆盖当前阶段。

S3修后输入准备记录（历史）：从2e770c95起仅增加目录参数，以3f8ebcae提交冻结后进入唯一采集，结果按本节最新记录结算；首次0/2与先前纯验证分账。

S3首败后阶段结果（历史）：首次两个真实PTY仍为Control send failed/0/2，normal exit7/readBytes2108、flood signal15/readBytes73472；allOwnershipSettled=true、cleanup safe/steps=[]且两个provider关闭。normal首报unknown保留，不被迟到released覆盖。首次trace未记录失败消息类型，不能声称原生记录直接证明失败消息就是consumed；代码复核确认正常关闭与迟到信用发送缺少握手，已实施显式sourceEndAccepted修正。首败后Node22 adapter43/43、channel6/6、provider core2/2、source断言组1、既有bridge、全typecheck及两fixture独立strict均通过，执行会话已结束；独立只读复核无本切片确定性blocker。离线补验normal2108B精确且重建终态正确、flood73472B全x等于native readBytes；首次live终态断言未执行，不追认通过。没有修后原生采集；下一阶段仅冻结新输入/新目录复验相同两个场景，不扩矩阵/工具或自动runner/push，不接现有业务，不关闭PI-01/02/03或产品总债务。首跑前38+1和S2/S1/旧原生历史不改，统一文档静态核对通过，整体计划active。

S2真实异步transport/provider channel与必要adapter窄修已在主树形成，Linux/Node v25.6.0普通pipe七组首次7/7、exit0，无重跑；8次provider尝试含ENOENT、实际7个provider/4个subject、8次transport close含失败spawn句柄。S1回归35组、channel纯回归1组及typecheck通过，旧代码内存负对照按预期拒绝；后补deadline guard四项hook和期限snapshot一次参数检查通过且未创建child，不追改首次矩阵。首轮TS2345/TS2339、fixture TS7006和纯测断言错误保留，最终adapter35/35、channel1组、typecheck、bridge、两mjs语法及fixture独立strict均exit0；最终独立只读复核包含期限snapshot等修正，无本切片确定性blocker，统一文档静态检查通过。零PTY、无native addon、无现有业务导入，无runner或push；旧S1最终32/32与U1-6原生证据分别保留，不累加样本。macOS/Windows/Electron、两authority/reader、真实Agent和产品整链仍未验收，PI-01/02/03及退出完整性总债务不关闭，整体计划继续active。

S1 共享类型、adapter 和定向测试已在主树形成；独立只读复核定位并复查 ACK 合并顺序、正常 transport 退役、迟到 start 状态、原始前缀保留与操作观察边界，已检查的修正没有新直接阻断。首轮类型窄化失败和两次未执行用例的装载/fixture 失败保留；先前定向31/31、typecheck 与 bridge 通过，补资源账本完整性一组后最终32/32和 typecheck 复跑通过。源码与前31组独立通读确认直接加载真实模块、失败完整汇总并断言，没有 skip 或吞失败；资源登记修正及新增第32组另经只读复核。统一文档静态校验完成，首次导航/历史分类误报与重核过程保留。该产物尚无真实 transport、进程、PTY 或两 authority 业务接线，不能关闭 PI-01/02/03 或产品退出完整性。下一阶段限定 S2 零 PTY 异步启动链，整体计划继续 active。

本轮 PI-01/02/03 形成可实施消息、状态转换、有限队列配置和两模式结算输入，生产接入设计新增第9至12节。独立只读复核未发现身份、local final barrier 或 S1 边界与既有生命周期契约的直接矛盾；IPC复审提出的可信消费入口、未解析字节占账和sourceEnd少报拒绝已补齐并复核闭合。统一静态验证已通过，结果见验证与验收。尚未创建 S1 模块、运行测试或 native；接口研究完成不关闭 PI-01/02/03、平台回收或产品验收。下一阶段固定 S1 真实共享模块与定向测试，整体计划继续 active，旧结果和失败不追改。

本轮完成生产接入决策记录和接口、隔离、分发三侧只读核对，形成每会话 provider 与父侧 authority 的首选待验证候选及六项具名阻塞。异步 IPC、父 owner 消失、两模式/reader 与分发各自留责，未形成新原生样本、产品修复或默认启用批准。下一步仅 PI-01/02/03 接口安全收敛；静态文档统一验证通过，设计比较中/未验证，整体计划继续 active。27.10 及更早结论原样保留。

第27.10节以唯一macOS arm64 U1-6三项3/3、完整ZIP和可信保存复核/独立raw与构建审计收口。真实kqueue资源取得与合成注册错误分账，受控abort0、唯一reaper及单次释放成立；30项纯测不累计为原生样本。当前未改变业务或选定生产API/隔离策略/停止预算；下一阶段是生产接入决策收敛，必要时仅冻结会影响拓扑的最小对照，整体退出完整性仍未交付。

第27.9节运行输入已实施：五个新JS与专用workflow，30/30有限测试（此前21+新增9）、13JS和workflow语法检查通过。真实runSchedule编排通过注入模拟完成保存与重新判定，guard-only Node子进程在构建前拒绝缺参；没有C++编译、加载、PTY、runner或push。独立复核结果与证据路径见设计27.9；下一阶段只运行冻结输入的唯一首次采集，产品退出完整性未交付。

第27阶段本轮收口为隔离源码与JS模拟对接，不是原生验收。最终21/21由3组源码、7组角色模拟、11组三域判定组成，包括实际driver函数产生report后交verifier；native、传输与时钟均注入模拟。8个JS分别语法检查通过，独立只读复核未发现直接阻断；早期6/6、10/10及新增回归6/7失败按时点保留，不能用局部绿色宣称资源真实释放。两树同步设计与当前入口，未编译、加载、创建真实PTY、运行runner或push。下一步仅准备新的原生输入，生产退出完整性仍未交付。

第26阶段八源实现、10组定向纯测试、隔离build/load和唯一macOS U1-0三次3/3完成；run35900772851 attempt1及runner/可信本地离线复核均通过，完整ZIP摘要与GitHub一致，独立raw/来源保持审计25206检查零失败。真实2104字节/read0、完整终态与光标、wait1792/exit7及逐资源结算均有原始事件，未改预算或重跑求绿。本地master绑定增强后复核的是同8组、runner复核的是同10组，不累加覆盖；build/load零会话与三次原生分账。下列第25阶段及更早结果按历史时点保留，产品退出完整性仍未交付。

第25阶段已完成四文件实施、19项纯测试、唯一U1-0/U1-5四项4/4及独立进程离线复核。三个held样本均真实close早已成功，但被测first仍按截止报告unknown，之后同operation receipt补证released且首报不变，没有再close。全部完整尾部/state、真实wait/正常通知和逐资源结算成立；独立raw/保持审计16134检查零失败，零新增native。此为Linux回执观察分离的限定证据，不是OS close挂起、跨平台或产品整链验收；下一步先冻macOS U1-0基线。

第24阶段完成协议、八文件实施、61项纯测试、首次build/load、唯一四项原生及独立离线复核，有限4/4；直接raw/保持审计零失败。U1-4未交付通知不抹掉真实exit7，2104字节/EIO/完整state及各owner结算成立。没有真实closing/环境销毁或产品链路结论，历史失败不重判；当前停在本切片收口，下一最小项为Linux U1-5释放回执扣留，不再采集本轮矩阵。

第23阶段已完成45/45纯测试、新build/load和唯一四项4/4及独立进程离线复核。全部成功写2102/读2104、EIO、完整状态/光标x6/y4、真实wait1792/exit7和逐资源收尾；三个U1-3保留最初unconfirmed/null status且同一worker补证。独立raw/旧内容保持审计已完成12566检查/零失败，未增加native次数；未实测真实ECHILD/EINTR或迟到JS观察，不宣称真实内核ECHILD普遍可恢复或产品退出已修复。

第22阶段功能与证据收口不变；完整暂存格式检查有两处EOF空行告警，已记录为冻结源码的非功能例外。诊断实现本地提交6248229b、主树文档ac588f45均不推送；本补记仅修正文档中的检查范围说明，不改源码或原始工件。

第22阶段已完成具体协议、隔离构建、28/28纯测试与唯一新原生四项4/4，采集及保存复核均exit0。候选在无等待线程时仍能由原driver独占回收child并独立完成TSFN最终化；不能把未创建对象伪造为已释放，也不能据此宣布OS真实线程创建失败已验证。三个partial均首次wait即terminal，pending/EINTR及500ms多轮仅纯测试覆盖。旧stage20的3/1/2、stage21的4/4和exit13均不变，其他平台/产品尚未验收。

第21阶段已实现并完成唯一新四项，4/4及两次保存复核（原生入口末尾一次、独立CLI一次）均通过，15项定向回归通过。新三次partial的真实exit1与所有资源返回分账，未改binary、预算或旧断言。新入口不再exit13，旧入口及旧3/1/2原样保留；本轮没有关闭其他平台、真实Agent或生产退出完整性，下一步为Linux U1-2具体协议与原生增量。

原生第20阶段已经实施并取得4次真实PTY创建/收尾证据，同一aff95d1e候选的正常3次完整2104字节/EIO/exit7/最终光标x6/y4及资源均成立；首个partial-create仍blocking、无read、真实wait exit1，资源返回但原signal-only判定失败。整体3通过/1失败/2未运行，不是6/6或66项通过。独立只读入口成功重放原失败，旧总入口exit13不追认；尚未修生产、验证其他平台或完成总体退出完整性。完整来源/工件/边界见原生失败隔离设计第20节。

第18阶段完成两个直接工具缺口修正，局部15/15、自测五组及保存5/5通过；本轮唯一Linux42/42，完整80phase/156receipt、314成员/7源exact，acceptanceReady=true。37个普通路径及G1/G2四组gate的原始顺序复核成立，三个08明确不完整但证据充分；独立只读复核未发现本轮直接回归。旧partial/39/42与首次附加核对失败原样留存。该结果只完成固定Linux诊断验证，下一步回到W1/U1，不自动扩通用工具门槛，也不宣称生产退出完整性完成。

第17阶段完成ACK因果确认及最小修复：修前五项1通过/4失败，修后同五项与既有八项13/13；主self-test五组及可信保存5/5通过。唯一完整42项的场景控制42/42，但最终验收39/42、acceptanceReady=false，完整314成员归档与7源exact已保留。三个08证据充分且明确不完整，剩余失败是consumer交付超过100ms，不再是ACK退出或预期截断汇总矛盾。下一步仅修直接交付顺序；本轮不再采集，未推进PTY/native或产品验收。

第16阶段已完成范围及汇总纠偏，但唯一真实整链未通过：`.debug/settlement-v3-scope-full-first` 在180秒外层保护下exit124；01至08共24条case-settlement均false且ownerBlocked均false，已观察的publisher均incomplete。09-1有writer文件但未结算，余17项无启动证据；无summary、outer及shared manifest，可信保存复核42项检查、0 verified，不能写成已执行42项。01-1的caller-finished约72.696ms，TERM约5004.405ms、exit约5010.412ms；writer seal后仍经TERM，verifier未启动。ACK等待闭环只列候选根因，尚未作直接active request因果实验。初始8/8、主回归五组及saved5/5/110 members、随后收紧08的8/8与主回归均单独保留；局部绿色不覆盖真实失败，acceptanceReady=false。本轮不再实验，下一步仅按当前工作计划定位和修复实际闭环。

历史结果（第15阶段，当时的“下一步”已由第16节替代）：第15阶段已完成错误保留边界和独立认证。最终helper39/39、public29/29及saved29/29，tamper8正例/20组35变体，主回归五组119/41/156/15/37、saved5/5/110 members；portable46/6/17，均按各自判据分账，acceptanceReady=false。只读复审无本阶段剩余确定性阻断，不是整个owner或产品退出机制验收。完整来源、首次失败及hash见契约第15节；下一步是新策略请求可达性、其他容器边界和真实归档门槛，以下第14节及更早记录为历史。

第14节是容量可达性和跨OS归档的独立诊断增量，不是新reader或生产退出路径修复。实际Windows链接/权限、打包传输、真实异平台producer以及错误字段/辅助数组有界性仍须补证；本地fixture成功不关闭完整工具门槛、W1/U1或产品验收。完整证据与本轮结果集中记录在诊断结算契约第14节。

本轮已修caller stderr被错误套用helper16KiB限制的oracle误判和synthetic链接raw form类别替换缺口；没有放宽容量或原验收。容量首次38/43、第二次41/43及首次portable旧oracle输入保留。独立复审曾执行已核hash的归档源码，相关结果不作正式门禁；最终统一使用可信工作树入口重新复核，详见契约第14.5节。

以下第13节及更早记录保留为历史，不覆盖本节第14节结论。

本增量最终结果以诊断结算契约第13节为准。D4补齐创建/使用unknown迟到结算；D3新增156项并修三个oracle误判、可信负例类别绑定和离线源结果可移植性。最终 `.debug/settlement-v3-portability-check-1/original` 的119/41/156/15/37判据满足，原路径/迁移路径保存重放各5/5、96 members，根独立复核5/5；13项重hash负例按语义拒绝。32项source LF/CRLF组合只证明派生结果字段，同平台目录迁移不等于跨OS整包已验收。boundedConsumerDelivery=false、acceptanceReady=false；零真实D3/native/PTY，无新runner或push。self-test-3的4/5读取失败、所有初稿失败与历史工件不改。残余容量与跨OS归档门槛明确待办，计划仍active。以下段落保留前一阶段及历史结果。

当前阶段交付为新诊断的本地工具初版与审计修正，完整证据/缺口见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节（比较中/验证中）。D4固定16项与93语义、4 saved、另存7个sidecar负例已有最终本地证据，两项审查阻断闭合；create/use unknown迟到清除的独立正例仍待补。D3 v3最终 self-test-2：Node22.23.2，oracle119/119、core41/41、files15/15、archive/consumer/binding25/25，saved4/4、88 manifest members、boundedConsumerDelivery=false、acceptanceReady=false；realNodeCases/nativeProcesses=0、pty=false，未运行live36+2+4或原生矩阵。CLI及三份源hash见契约第12节，symlink负例归档需保留link元数据；cross-replay和oracle review首次失败保留。

当前不运行D3真实36+2+4、不新增runner、不推任何分支；先补六组冻结覆盖、消费验收预算与独立审计，之后再另行确认真实矩阵/三平台采集。业务、依赖、旧脚本/workflow/工件和image.png不改。W1/U1、原生第二批、真实启动链/双会话/宿主/packaged、生产API/停止预算与整体退出完整性继续开放，计划active。以下保留此前阶段时点的结果，其“下一步”不覆盖本段。

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

本阶段输入为主树a5d884be、诊断树a385e34d。主树`extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts`持有执行引用与准入，`src/supervisor/runtimeSupervisorMain.ts`是live-runtime owner，`src/panel/CanvasPanelManager.ts`是snapshot-only owner，`src/common/serializedTerminalState.ts`提供真实消费flush；后三条路径同属主扩展。诊断树无S1至S3生产代码，只同步文档，正式设计第16节代码行号均以主树为准。

当前S3源码、构建与采集均在主运行时树，诊断树仅同步文档。修后输入3f8ebcae由主树2e770c95/诊断树ff297168继续；本机Linux/Node22.23.2与同一S3 binary保持，目录参数外无代码修改。本次2/2与S3首次0/2、S2 Node25证据分别记录；当前边界见生产接入第15.8至15.10节。

当前S2代码与测试仍只在主运行时树，诊断树只同步文档；生产接入设计第14节为有限普通pipe输入、消息来源和清理边界的当前依据，以下S1和原生阶段背景按历史保留。

第26阶段基线为主树4d676fb2、诊断树a0f412fd，正式协议为docs/design-docs/runtime-native-failure-isolation.md第26节；新实现已冻结诊断提交32312fe7并完成唯一run35900772851 attempt1。八源和workflow、构建/原生工件只在独立runtime-exit-integrity-native-candidates树；主运行时树只同步文档、未推送。旧Linux v1-v6及旧macOS三arm实验冻结，不原地改写。

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 是 node-pty 接入边界，输出回调表示已交付的数据，进程退出通知不天然等于输出排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 与 `finalizeSession()` 将已接收事件按每会话串行队列执行；admission 表示是否继续接受新事件。`src/panel/CanvasPanelManager.ts` 还直接管理 snapshot-only 的 Agent/Terminal 退出，两条路径都要纳入设计。

`src/common/runtimeSupervisorProtocol.ts` 负责 Supervisor 与 Host 的契约，`src/common/protocol.ts` 是 Host 与 Webview 的共享消息。`src/panel/runtimeTerminalReadRelay.ts` 与 `src/webview/terminalPagedProjection.ts` 管理读者、连续分页和终态呈现。revision 是已接收事件的位置，不是源进程预期输出的字节数。若需要修改这些接口，必须同时验证消费者和旧协议。

平台 provider 的现状见安装的 `node_modules/node-pty/lib/unixTerminal.js`、`windowsPtyAgent.js`、`windowsTerminal.js` 和 native 源码。已有证据位于 `docs/design-docs/runtime-terminal-tail-diagnosis.md`、`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md`；固定版本来源已在文档摘录，不要求接手者依赖本机 `.debug/` 才理解问题。不能直接编辑 node_modules 作为生产修复。

## 工作计划

当前第18节补验及直接修复已完成。下一里程碑仅为18.4：在现有Supervisor cursor边界分别登记reader和在途open，引入有能力门控的close结果校验、有界幂等记录与聚合退役；复用既有readId/revision，不增新水位、存储generation或completed正文。先写明有限记录上限与结果保留条件，再修改runtimeSupervisorProtocol、Supervisor及必要owner接口/定向测试；只允许内部非native注入，不向旧会话补造applied，不开放native。完整跨层发送和本地屏障仍须后续一起实施，不能先对产品宣布新保证。

S4已按生产接入第16.5节完成：在adapter及两个真实owner入口接入关闭准入、在途预留、具名stop/cancel、截至seal尾值的消费屏障和退役责任。共用编排由真实创建/关闭入口调用；正常运行无新provider工厂，只有显式非native依赖注入可进入新分支；未新增用户开关、native加载、协议/namespace变更或旧live迁移。页面最终ACK暂不实现，未结算reader不能报applied或释放对应最终状态。

S4定向验收已覆盖异步prepare与关闭竞争、旧身份、首批暂停且后批accepted/seal早到、真实flush失败、控制等待不阻断消费、unknown拒新建但B继续、live detach/local close差异、idle不得跨过未结算owner，以及能力拒绝发生于任何spawn前；Host reset/clear的完整UI整链和最终reader ACK仍未作为本轮通过。实际native依然受L-01至L-04约束，不自动补崩溃矩阵。

当前有限采集与独立证据复核已完成，原0/2保持。下一阶段转向L-02 reader最终结算、L-03 native失联处置与预算、L-04生产能力分流及reset/clear整链验收；不先扩异常崩溃矩阵或通用工具，不自动运行采集或push。

第14节S2首次真实普通pipe七组7/7、独立复核及统一静态检查已收口，保留全部首次失败与后续纯内存验证分账。下一有限项是首个平台Linux真实PTY provider接线，须先冻结读取/解码预算、资源责任和安全停止，复用现有原生证据；不另起通用工具或全量矩阵，不自动native/runner/push。以下各阶段安排为历史。

S1 最终定向32/32、typecheck 复跑、既有 bridge 回归、独立复审及两树统一文档静态收口已完成。随后只推进 S2 真实异步 transport/provider 启动链：先在设计中冻结有限进程数、握手与消息目标、停止/失联观察及直接 child 安全清理，再按该窄协议实施零 PTY 验证并复用同一 adapter。S2 不加载 node-pty/native、不接现有业务入口、不改 root 归属/模式/generation，不自动 runner/push；不另起泛化设计、诊断框架或工具前置。真实 native read 预算、平台控制与 PI-04/05/06 保持开放。

下一里程碑仅为设计第12节 S1：在主树新增 `extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts` 和 `extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts`，注入 transport/observer/观察时钟，实施一次启动、身份校验、有限接受与消费、封口和首次/迟到事实。新增根 `scripts/test/test-execution-session-adapter.mjs`，直接测试拟交付模块，不另造 D 系列模型。禁止依赖 vscode/node-pty/spawn 或接入现有 Host/Supervisor/Webview，保持 manifest、storage generation 和运行模式不变。S1 收口报告定向测试、typecheck、既有 bridge 回归及未接线事实；真实异步 pipe、native read 预算和平台控制安全另阶段推进，PI-04/05/06 继续开放。

当前收口生产接入设计阶段：三个只读专项已覆盖实际接线、故障隔离和分发支持，独立设计登记首选候选及 PI-01 至 PI-06。下一里程碑仅为 PI-01/02/03：确定启动/控制与输出 IPC 的有限信用和移交责任、父 owner 消失或同步阻塞时的跨平台处置、prepare-bind-start/解析屏障/reader 结果/旧 live 能力分流，并明确受控两会话负载自己的安全界限。停止条件是这三项形成可实施消息、状态转换和失败判据，或具名说明缺少的必要证据；不机械补故障编号。A/B 尚未冻结平台实现、预算与安全控制，仅在影响候选选择时另冻协议，不自动执行。PI-04 生产容量/预算、PI-05 宿主分发支持、PI-06 实际 Agent/产品整链继续开放。以下旧工作计划按历史时点保留。

当前按27.10收口唯一U1-6原生结果与两树文档，只做本地结果提交，不追加push或runner。下一设计阶段基于现有各平台有限证据明确故障承诺，比较共享进程可响应错误封禁与创建前独立进程单元，收敛事实接口、两种运行模式的接线、旧live能力分流、unknown有界处置及生产预算依据、支持环境和分发。停止条件是形成首选方案/具名阻塞项；若A同步native操作未返回时B继续服务这一命题仍影响选择，只冻结一个有明确owner/安全结束/证据边界的A/B最小对照，不自动实施或扩成完整异常矩阵。不从“不要求Supervisor崩溃恢复”推出任意native崩溃下B必存活，也不以优先级调整取消产品验收。

第25阶段实施、唯一原生采集、离线复核与独立raw审计已完成，当前只收口文档和本地提交，不再运行该矩阵。下一最小阶段先冻结macOS U1-0基线，核对其真实创建/等待/源结束/释放与Linux的差异，再依托已有runner做有限独立输入；本轮不实施平台适配或触发runner/push。旧各批及下段第24阶段安排按历史时点保留，生产API/隔离策略/停止预算未选定。

第24阶段实施、唯一采集及独立复核已完成，按原生失败隔离第24节收口文档和本地提交，不再运行该矩阵。下一步只先冻结Linux U1-5具体协议：真实close成功的audit不能代替被测释放回执，首次unknown与同operation迟到补证并存，严禁再次close；第9节100/1000ms观察及至少100ms持有要求不变。仅本次判定/安全阻塞项可前置，不增加通用框架工作，不推送或选择生产方案。

第23阶段历史记录：实施、45项纯测试、静态安全复审、八源冻结、隔离build/load、唯一四项原生/离线复核及独立原始事实审计已完成，不再采集。当时安排的U1-4现由第24阶段承接；旧章节中的下一步不覆盖最新顺序，生产API或停止预算仍未选定，不推送、不触发runner。

当前按原生失败隔离第22节收口：新U1-2四项与隔离构建、原始事实和来源核验已完成，当前只同步文档并本地提交，不推送。下一增量是Linux U1-3：先明确初次wait失败/未确认报告、单次合成ECHILD与真实唯一reaper补证的时序和所有权，再实施有限新输入。下段第21阶段的U1-2安排已完成，其余历史工作计划不覆盖本段；生产退出完整性仍开放。

当前按原生失败隔离设计第21节收口：唯一新四项已完成，原始来源/内容/资源/预算复核与历史保持检查完成；本轮仅提交诊断新版本和两树文档，不推送。后续先将U1-2的实际TSFN、未启动thread、原child/master及收尾控制权写入具体新协议，再做隔离实现和有限原生验证；不预设生产线程布局，也不要求先定位exit1具体errno。下段第20阶段待办已由第21阶段完成，其余为历史安排，不覆盖当前顺序。

当前按原生失败隔离设计第20节收口：实际六项schedule只执行4项，后2项保留not-run。下一增量仅在新版本中去掉无依据的“控制成功必然signal退出”前提、独立判定真实owner结算与是否可继续，并采用独立复核入口；不将该修改写成资源泄漏修复，不补跑或重判旧四项。具体新采集范围先冻结，再推进剩余U1/W1和实际产品路径。本轮不再原生采集、不push；以下保留此前工作安排，不覆盖本段。

当前按诊断结算契约第18节收口：本轮两个直接工具缺口已窄修，局部15/15、自测与保存5/5及唯一完整Linux42/42通过，原100ms和gate判据未变。下一阶段回到W1/U1实际创建/等待/释放及主进程尾部，实施前仅确认所用调用链的取证与清理安全，并按实际运行补齐平台证据；不先扩展通用容量、listener或归档兼容性审计。此处不授权把Node诊断通过计为PTY/生产通过；实际Agent启动链、reader释放、最终状态、双会话、Host/Webview和packaged仍需产品验收。本轮不再采集、改业务或推送。

历史工作计划（第17阶段，下一步已由第18节完成）：当前按诊断结算契约第17节收尾：ACK因果、最小修复、13项回归和一次完整Linux42项已经完成；结果39/42，不能写成验收通过。下一步只研究executeCase把evidence consumer放在同步出版准备之后的直接顺序问题，以及失败phase未入聚合导致的77/80统计解释，不泛化为工具性能框架。修正须保留真实await后记录、gate、来源/内容比对、100ms预算及全部旧失败；必要回归和新采集范围事先登记。之后回到W1/U1、主进程尾部、最终状态、reader资源和真实Agent启动链。本轮不再实验、修改业务/oracle/D4、运行PTY/native/runner或push。

历史记录（第16阶段）：当前按诊断结算契约第16节处理首次真实整链暴露的直接问题，不恢复通用工具门槛链。下一步仅用最小真实role对照检验ACK自然退出候选等待环：子端fs.ReadStream(fd4).destroy可能等待在途fs.read，而父端在childExit后才end fd4；目前尚无直接active request因果证据，不定性为OS或产品bug。确认后只修该闭环，再以新输入最多一次既定42项；事前重算外层安全保护，保持各场景预算。随后回到W1/U1及主进程尾部、最终状态、reader资源和实际Agent启动链。本轮不再实验、触发runner或push，以下历史安排不覆盖本段。

以下为第12节及更早的历史工作计划，保留原文以便追溯。其中“当前”“下一步”“不运行真实D3”及工具门槛顺序均指当时，不限制第16节的一次Linux42项，也不恢复已撤销的通用工具前置链。

当前执行设计是 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节。八个版本隔离入口已在独立 `runtime-exit-integrity-native-candidates` 工作树创建；本阶段只做本地初版/审计修正与纯fixture验证，不运行D3真实矩阵，不新增runner，不推送。D4已有local-3完整模型证据，D3下一步按六组逐fixture补齐：各控制/硬截止全边界及排队跨限；spawn/ENOENT/launch-rejected完整责任；坏帧前后/同chunk/跨pipe；work/hard与共享E0组合；协议/容量/listener；unknown迟到/取消及实际await/gate。已有部分样本按清单扣除，不用总数宣称全覆盖。完成独立审查后再另冻真实D3、三平台采集及消费验收预算，W1/U1仍待完整工具门槛。

本地门槛通过后冻结新输入commit、Node22.23.2和新workflow的路径过滤/唯一首次触发方式，再另行确认一次完整三平台采集；失败上传全部partial证据，下载所有ZIP并按固定Git可信入口核验。D3主控/gate/publisher与D4模型分别报告，不更改旧门槛筛绿、不导入业务。上一设计冻结阶段“本轮只有设计”的记录仅限当时状态，当前已进入本地工具初版与审计；以下旧工作计划作为历史记录保留。

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

本轮在主树仓库根运行`node scripts/test/test-host-execution-owner-wiring.mjs`（19/19）、`node scripts/test/test-supervisor-execution-owner-wiring.mjs`（13/13）、`node scripts/test/test-execution-owner-lifecycle.mjs`（13/13）、`node scripts/test/test-execution-session-adapter.mjs`（53 cases），再运行`node scripts/test/test-execution-session-bridge.mjs`、`node scripts/test/test-serialized-terminal-state-tracker.mjs`、`node scripts/test/test-runtime-paged-completion.mjs`和`npm run -w extensions/vscode/dev-session-canvas typecheck`，均exit0。未运行旧Supervisor protocol脚本、S2/S3、native/runner或push。后续有限reader切片沿用实际类的无native测试；真实发送新协议前必须同步consumer/capability，不能靠receiver自测宣称整链完成。以下步骤按旧阶段保留，不是当前执行安排。

本轮仅以git status、定向rg/sed和只读专项核对主树入口，手工文档变更后做diffcheck与文档静态检查，没有运行S3或旧实验。下一S4开始前先按第16.5节选择可无native导入的owner入口测试方式，避免Supervisor main自动启动副作用；新增窄测试时先登记完整命令及非native依赖边界，再于主运行时仓库根执行`node scripts/test/test-execution-session-adapter.mjs`、`node scripts/test/test-execution-session-bridge.mjs`和`npm run -w extensions/vscode/dev-session-canvas typecheck`。不能直接运行需要PTY的Supervisor协议或旧S3脚本充当本切片验收。

本轮在主运行时树执行且仅执行一次：`/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node scripts/test/test-linux-execution-provider.mjs --output .debug/s3-linux-provider-source-ack-first`。输入3f8ebcae、运行前树干净，结果exit0/2/2；两provider和主体均结算，无运行中命令，禁止重跑该目录。目录参数窄改的语法/完整源码差异检查先通过，再提交冻结；独立证据复核不调用native。以下是此前准备及首败后命令记录，不覆盖本轮结果。

S3在主树新增native/linux-execution-owner.h及scripts/build下精确补丁/构建入口。已以本机已有Node22.23.2执行 `scripts/test/test-linux-execution-provider-source.mjs`，源码断言通过且零native加载；再运行 `scripts/build/build-linux-execution-provider.mjs --output .debug/s3-linux-provider-build-first --dependency-root node_modules --headers /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates/.debug/node22-headers-first/node-v22.23.2/include/node`，首次编译/零调用load通过。Node绝对路径为 `/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node`。真实入口 `scripts/test/test-linux-execution-provider.mjs` 首次两项已运行，结果均Control send failed/0/2，证据在.debug/s3-linux-provider-first；未重跑。首败后运行test-execution-session-adapter.mjs 43组、test-execution-provider-channel.mjs 6组、test-linux-execution-provider-core.mjs 2组、source断言组1、既有bridge及全typecheck，两fixture独立strict通过，所有会话已结束；没有修后原生采集，诊断树不运行新输入。

当前S2在主树新增 `executionProviderTransport.ts`、`executionProviderChannel.ts`、`scripts/test/test-execution-provider-transport.mjs`、`scripts/test/test-execution-provider-channel.mjs` 及普通pipe fixture。`node scripts/test/test-execution-provider-transport.mjs` 在Linux/Node v25.6.0首次七组7/7，未重跑；S1回归35组、channel纯回归1组与typecheck通过，后续四项deadline hook与一次期限参数检查不创建child，不混入真实矩阵。诊断树只同步文档，无runner/push；最终adapter35/35、channel1组、typecheck、bridge、两mjs语法及fixture独立strict均exit0，执行均已结束；最终独立复核无本切片确定性blocker，统一文档静态检查通过。以下命令与32/32等结果保留原阶段时点。

主树 S1 已新增 `extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts`、`extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts` 和 `scripts/test/test-execution-session-adapter.mjs`。已运行并完成代码验证：`node scripts/test/test-execution-session-adapter.mjs`、`npm run typecheck`、`node scripts/test/test-execution-session-bridge.mjs`，先前定向31/31、typecheck 和 bridge 通过，补资源登记完整性回归后最终32/32与 typecheck 复跑通过；保留首次 TS2339 及两次用例执行前的 esbuild 路径/fixture 错误，17/22/25/31 组原阶段结果保留，新增32组不累加为 native 次数。统一文档静态校验及两树 diff 检查通过。随后先冻结 S2 零 PTY 异步启动链的有限输入和安全退出协议，再决定具体实施；本计划不授权越过这一步直接加载 native、启动 PTY、触发 runner 或 push。诊断树本轮仍只同步文档，旧可执行诊断输入不改。

本轮基于主树 `07851ba4`、诊断树 `76ea6e77` 只读研究并冻结生产接入设计第9至12节，没有新增执行输入。后续先实施主树两个 S1 模块，按有限配置校验 prepare/bind/start 和消息；再以注入 transport、假时钟和延迟 promise 覆盖信用、尾部、封口、失联、迟到及双执行隔离；最后运行 `node scripts/test/test-execution-session-adapter.mjs`、`npm run typecheck` 和 `node scripts/test/test-execution-session-bridge.mjs` 并据实际结果收口。本段列的是下一阶段命令，不是本轮已运行记录。本轮仅同步两树文档，统一静态验证已完成；不执行真实进程、PTY、A/B、U1/W1、runner 或 push。

本轮已从主树 `081c3a21`、诊断树 `f7ce4283` 只读核对生产源码，形成独立生产接入设计，没有新增可执行诊断输入。下一阶段先闭合 PI-01：bridge/adapter 的异步握手、有限帧与信用、独立副本移交和回执、失联时可用前缀与 loss；再闭合 PI-02：逐平台定义父 owner 消失或同步阻塞时的外部处置、直接 child 退出确认和未知责任；最后闭合 PI-03：两 authority 的 prepare-bind-start、真实 flush、防串会话身份、reader outcome 及新旧 capability/generation。协议先写设计再评审，默认关闭的实现切片和定向测试另行规划，本段不授权执行 A/B 或 U1/W1。当前仅核对两树文档路径、元数据、正文/计划、历史保持和 diff，静态结果已记录于验证与验收；下列命令为旧阶段记录，不是本轮执行安排。

第27.9节有限纯测试入口如下，运行目录为独立诊断树；本轮runner复跑同30项，未新增测试组数：

    DSC_NATIVE_DEPENDENCY_ROOT=/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules DSC_NATIVE_HEADERS_ROOT=$PWD/.debug/node22-headers-first/node-v22.23.2/include/node node --test scripts/diagnostics/macos-native-failure-*.test.mjs

首轮30/30日志.debug/u16-input-preparation-20260924-first.log保持。以下三个命令已在唯一run35963751067 attempt1执行成功，不再次构建/采集或覆盖既有目录；headers由workflow固定下载：

    node scripts/diagnostics/build-macos-native-failure-v1.mjs --output macos-native-failure-build --dependency-root "$PWD/node_modules" --headers "$HEADERS/include/node"
    node scripts/diagnostics/diagnose-macos-native-failure-v1.mjs --output macos-native-failure-evidence --binary "$PWD/macos-native-failure-build/pty.node" --build-directory "$PWD/macos-native-failure-build"
    node scripts/diagnostics/diagnose-macos-native-failure-v1.mjs --verify-saved macos-native-failure-evidence --build-directory macos-native-failure-build

唯一push触发专用runtime-macos-native-failure.yml；只有三个新U1-6，不包含旧U1-0。完整下载后已使用本机可信Node22.23.2执行以下只读命令，首次3/3、exit0；不执行归档代码或Darwin native：

    /home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node scripts/diagnostics/diagnose-macos-native-failure-v1.mjs --verify-saved .debug/macos-native-failure-v1-run-35963751067/extracted/macos-native-failure-evidence --build-directory .debug/macos-native-failure-v1-run-35963751067/extracted/macos-native-failure-build

以下27.8及更早命令保留为历史，不是新增运行安排。

第27阶段当前只运行诊断树有限测试，不运行旧baseline或加载native：

    cd /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates
    DSC_NATIVE_DEPENDENCY_ROOT=/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules node --test scripts/diagnostics/macos-native-failure-patch-v1.test.mjs scripts/diagnostics/macos-native-failure-roles-v1.test.mjs scripts/diagnostics/macos-native-failure-v1.test.mjs

实际21/21；8个macos-native-failure-*.mjs各自执行node --check，不把多文件参数或.h检查当有效语法覆盖。源码/模拟对接与实际OS分账，尚无U1-6 build/schedule命令；后续先冻结新输入，不直接复用U1-0运行入口。下列历史步骤不覆盖当前边界。

第26阶段实施与下列命令均在独立诊断树执行，runner固定Node22.23.2；HEADERS指解压所得node-v22.23.2目录。先运行node --test scripts/diagnostics/macos-native-baseline-patch-v1.test.mjs scripts/diagnostics/macos-native-baseline-v1.test.mjs，失败不进入构建。再运行node scripts/diagnostics/build-macos-native-baseline-v1.mjs --output macos-native-build --dependency-root "$PWD/node_modules" --headers "$HEADERS/include/node"，候选以clang及匹配headers构建pty.node/helper，不安装node-gyp；load预检零会话，构建失败不进入采集。

唯一三项采集命令为node scripts/diagnostics/diagnose-macos-native-baseline-v1.mjs --output macos-native-evidence --binary "$PWD/macos-native-build/pty.node" --dependency-root "$PWD/node_modules"；workflow以spawnSync timeout180000保留status/signal/stdout/stderr，内层原预算不变。另进程只读复核命令为node scripts/diagnostics/diagnose-macos-native-baseline-v1.mjs --verify-saved macos-native-evidence。新增.github/workflows/runtime-macos-native-baseline.yml只由诊断分支本轮文件首次push触发，不dispatch旧入口；这些命令已在唯一run35900772851 attempt1执行成功，三项原生及保存复核均3/3；首次结果保持，不重跑。完整下载后，本机可信入口另以--verify-saved、--build-directory和--dependency-root绑定保存证据、下载build及本机只读依赖，首次离线复核exit0。

第25阶段已在/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates执行。NODE22指/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node；DEPS指/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules，只读使用。NODE22 --test scripts/diagnostics/native-failure-v5.test.mjs首跑11/11，新native-failure-v6.test.mjs首跑8/8，分组日志完整保存；冻结四源前逐文件node --check和git diff --cached --check均exit0。

已唯一执行、不可重新采集的命令为NODE22 scripts/diagnostics/diagnose-native-failure-v6.mjs --output .debug/native-failure-v6-linux-first --binary .debug/native-failure-v4-build-first/pty.node --dependency-root DEPS；外层spawnSync以180秒仅作安全保护，实际约3.4秒exit0，四项4/4。没有新build。完整argv/UTC起止/exit/stdout/stderr保存于.debug/native-failure-v6-validation-first/native-run.json。

只读复核命令：/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node scripts/diagnostics/diagnose-native-failure-v6.mjs --verify-saved .debug/native-failure-v6-linux-first。本阶段已另起进程执行，4/4/exit0，日志offline-verification.json；不创建PTY、不执行归档源码、不覆盖首次工件。来源或事实不一致必须失败，不重跑筛绿。

第24阶段命令均已在独立诊断工作树 /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates 执行。NODE22为/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node，DEPS为/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules，只读使用。新补丁和判定定向命令为DSC_DEPENDENCY_ROOT=DEPS NODE22 --test scripts/diagnostics/native-notification-failure-patch-v4.test.mjs scripts/diagnostics/native-failure-v5.test.mjs，16/16；加前代45项共61项纯测试。实际运行分组日志保存在validation-first。

已唯一执行、不可覆盖或重复的构建为NODE22 scripts/diagnostics/build-native-failure-v4.mjs --output .debug/native-failure-v4-build-first --dependency-root DEPS --headers .debug/node22-headers-first/node-v22.23.2/include/node。唯一采集为NODE22 scripts/diagnostics/diagnose-native-failure-v5.mjs --output .debug/native-failure-v5-linux-first --binary .debug/native-failure-v4-build-first/pty.node --dependency-root DEPS，四项4/4/exit0。两者完整argv、exit/stdout/stderr随build.json/native-run.json保存，不执行归档sources。

可重复的只读复核命令：/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node scripts/diagnostics/diagnose-native-failure-v5.mjs --verify-saved .debug/native-failure-v5-linux-first。本阶段已另起进程执行，4/4/exit0保存为offline-verification.json，零新增PTY；来源或原始事实不符必须失败，不能重新采集筛绿。

第23阶段在独立诊断工作树执行，Node固定为/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node（22.23.2）；下列NODE22即该完整路径，DEPS为/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules。先运行NODE22 --test scripts/diagnostics/native-wait-failure-patch-v3.test.mjs scripts/diagnostics/native-failure-v4.test.mjs及前代定向测试并保存日志。确认静态安全与新增文件whitespace后冻结八源摘要。

新build命令：NODE22 scripts/diagnostics/build-native-failure-v3.mjs --output .debug/native-failure-v3-build-first --dependency-root DEPS --headers .debug/node22-headers-first/node-v22.23.2/include/node。成功后唯一采集命令：NODE22 scripts/diagnostics/diagnose-native-failure-v4.mjs --output .debug/native-failure-v4-linux-first --binary .debug/native-failure-v3-build-first/pty.node --dependency-root DEPS。另起进程执行同CLI --verify-saved .debug/native-failure-v4-linux-first；不重新采集。目录已存在或任一前置失败就保留现场，不覆盖或盲目继续；最多四项，资源/证据不足后余项not-run。

这些第23阶段构建和采集命令已经执行且目录冻结，不再执行一次。当前只读复核可运行：/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node scripts/diagnostics/diagnose-native-failure-v4.mjs --verify-saved .debug/native-failure-v4-linux-first。预期四项有效且exit0；实际raw和源码身份不符必须失败，不能补跑筛绿。

第22阶段命令均在独立诊断树，NODE为/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node，DSC_DEPENDENCY_ROOT只读指向主树node_modules。定向命令为DSC_DEPENDENCY_ROOT=<该绝对目录> NODE --test scripts/diagnostics/native-failure-v1.test.mjs scripts/diagnostics/native-failure-v2.test.mjs scripts/diagnostics/native-thread-failure-patch-v2.test.mjs scripts/diagnostics/native-failure-v3.test.mjs，预期28/28。已执行且不重复的build为NODE scripts/diagnostics/build-native-failure-v2.mjs --output .debug/native-failure-v2-build-first --dependency-root <该绝对目录> --headers .debug/node22-headers-first/node-v22.23.2/include/node；唯一采集为NODE scripts/diagnostics/diagnose-native-failure-v3.mjs --output .debug/native-failure-v3-linux-first --binary .debug/native-failure-v2-build-first/pty.node --build-directory .debug/native-failure-v2-build-first --dependency-root <该绝对目录>。只读复核可用NODE scripts/diagnostics/diagnose-native-failure-v3.mjs --verify-saved .debug/native-failure-v3-linux-first，预期executed4/passed4/exit0，无新增PTY；不能覆盖原目录重新采集。

第21阶段所有命令均在独立诊断树，使用同一Node22.23.2绝对路径及主树只读node_modules。可重放纯测试：`DSC_DEPENDENCY_ROOT=/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules /home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node --test scripts/diagnostics/native-failure-v1.test.mjs scripts/diagnostics/native-failure-v2.test.mjs`，预期15/15、不创建PTY。新原生采集已唯一执行，不重复：`node scripts/diagnostics/diagnose-native-failure-v2.mjs --output .debug/native-failure-v2-linux-first --binary .debug/native-failure-v1-build-raw-status/pty.node --dependency-root /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2/node_modules`。只读复核用同Node执行 `scripts/diagnostics/diagnose-native-failure-v2.mjs --verify-saved .debug/native-failure-v2-linux-first`，预期executed4/passed4/exit0；旧v1仍用下段独立入口保持原失败，不用新规则重判旧目录。

第20阶段运行目录均在独立诊断树，Node固定为 /home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node，依赖只读来自主树node_modules。构建命令及全部输入摘要位于.debug/native-failure-v1-build-raw-status/build-command.json和inputs.json；native切片已唯一执行，不重复以下历史采集。可只读复核：node scripts/diagnostics/verify-native-failure-v1.mjs .debug/native-failure-v1-linux-first，预期exit1、executed4/passed3及U1-1-1原signal-only失败，后2项not-run。不可使用原diagnose入口的--verify-saved，因为它保留已冻结的顶层await自循环。针对性测试为DSC_DEPENDENCY_ROOT=<主树node_modules绝对路径> node --test scripts/diagnostics/native-failure-v1.test.mjs，6/6，不创建PTY。

第18阶段已在独立诊断树使用固定Node22.23.2 `/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node`（称NODE）：修前 `NODE --test scripts/diagnostics/settlement-acceptance-v3.test.mjs` 为8通过/2失败；修后同文件加 `scripts/diagnostics/settlement-ack-lifecycle-v3.test.mjs` 共15/15。`NODE scripts/diagnostics/diagnose-settlement-v3.mjs --self-test --output .debug/settlement-consumer-selftest-first` 及可信保存复核通过。唯一完整运行使用 `timeout --signal=TERM --kill-after=5s 480s NODE scripts/diagnostics/diagnose-settlement-v3.mjs --output .debug/settlement-consumer-full-first`，约78.47秒exit0；随后以可信verifyEvidence和绝对目录保存42/42重放，直接核对原始时序。所有目录首次创建，以上是已执行记录，不对旧目录重跑；下一阶段实施前另登记实际原生输入，不执行归档sources。

历史步骤（第17阶段）：本轮已在独立诊断树使用固定Node22.23.2 `/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node`（以下称NODE）执行：修前 `NODE --test scripts/diagnostics/settlement-ack-lifecycle-v3.test.mjs`，修后同文件与 `scripts/diagnostics/settlement-acceptance-v3.test.mjs` 共13项；主 `NODE scripts/diagnostics/diagnose-settlement-v3.mjs --self-test --output .debug/settlement-v3-ack-selftest-first` 及可信保存复核；唯一整链 `timeout --signal=TERM --kill-after=5s 480s NODE scripts/diagnostics/diagnose-settlement-v3.mjs --output .debug/settlement-v3-ack-full-first`。外层388秒阶段预算加92秒编排余量没有改变场景预算，执行exit1而非timeout；完整结果保留并由可信工作树verifyEvidence以绝对路径重读，39/42。具体输入/日志见证据章节和契约第17节。以上为已执行记录，不应对既有目录再次运行；本轮不再采集，后续窄修正及必要回归先更新计划，不执行归档sources。

历史记录（第16阶段）：本轮已在独立诊断树使用固定Node22.23.2 `/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node` 执行针对性node:test、既有主self-test及唯一一次真实 `scripts/diagnostics/diagnose-settlement-v3.mjs --output NEW_DIRECTORY`，失败目录和可信保存复核全部保留，详见契约第16节。后续先最小role对照，再决定闭环修正；修后全链只用新目录及新输入，最多一次，仍不执行归档sources。原180秒/kill-after5秒仅是本次安全保护，不能覆盖完整最坏路径：38个case各6+2+2秒及4个publisher各2秒，阶段预算合计388秒，尚未含编排/写盘；下一次须事前重算外层保护，不放宽各场景预算。

以下为此前阶段的历史步骤与复核入口，不是新增命令清单；其中限制仅属于当时阶段，本轮已按第18节完成采集，不据历史命令新增运行。

本增量在独立诊断树使用固定Node22.23.2路径 `/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node`，运行 `scripts/diagnostics/diagnose-settlement-v3.mjs --self-test --output NEW_DIRECTORY` 和 `--verify-saved DIRECTORY`；D4入口为 `scripts/diagnostics/diagnose-owner-quarantine-v2.mjs` 的同名参数及单独 `--output NEW_DIRECTORY`。不得复用或清空旧输出目录；每次失败保留source和首份结果，可信保存复核不执行归档中的代码。真实D3的无self-test入口本轮不调用。

上一设计冻结阶段只做文档与固定源码/协议复审；当前本地实施与审计另按第12节记录，不运行D3真实新矩阵。已在两树完成检查：YAML parser核对新设计frontmatter/索引/关联路径、计划四活章节、两树共同协议，按输入Git比较冻结历史正文与旧脚本/workflow字节，并执行 `git diff --check`，均通过。

实施与证据工作目录为 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-exit-integrity-native-candidates`；新CLI已存在，固定执行器为 `/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node`（22.23.2）。本阶段只使用该执行器运行 `scripts/diagnostics/diagnose-settlement-v3.mjs --self-test --output NEW_DIRECTORY`、`scripts/diagnostics/diagnose-owner-quarantine-v2.mjs --self-test --output NEW_DIRECTORY`、D4的 `--output NEW_DIRECTORY` 和两者的 `--verify-saved DIRECTORY`。D3的 `--output` 是真实36+2+4入口，当前不得执行。输出目录只能新建，首次失败保留；主运行时不承载新增脚本或工件。以下旧命令只作历史证据复核，不是本轮新采集安排。

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

S4补验在Linux/Node v25.6.0验证Host19/19、Supervisor13/13、owner13/13、adapter53及bridge/tracker/paged和workspace typecheck全部exit0。新增Host测试有明确阶段等待与场景失败上限，未执行的历史宽fixture不恢复为绿色；首批真实tracker暂停下尾值/最终flush与实际reset决策有直接断言，UI及实际落盘仍未覆盖。Supervisor新增断连与替换回归先红后绿，测试finally等待journal写入后完整退出，不能只计13项断言而忽略清理失败。前轮protocol回归真实PTY分类纠正见设计18.2，不计本轮新样本。设计schema/索引、新增本地引用、第2至17节逐字保持、计划12标题原序、8文件变更范围和diff检查通过，两份测试mjs语法通过；首次静态脚本误将历史独立诊断树引用按主树检查而失败，改为检查新增引用后通过，未修改历史文档以迎合检查。

本阶段文档静态检查通过：两树各4份设计frontmatter/索引/关联路径、各计划12标题原序、production旧第2至15节逐字保持及两树正文一致；每树仅约定8份文档修改，无新增未跟踪文件，git diff --check通过。主树14个关键代码锚点精确核对通过；首次检查发现beginConsumption行号误写501，正文纠正为502后复核通过，属于文档定位偏差，不是运行时失败。三个只读专项确认控制能力、Host入口及消费偏序修订无剩余本项finding。本轮未运行运行时测试或新增原生样本；下一S4必须直接测试实际入口/真实tracker和可控非native transport，不能以另一份模型或typecheck独自代表接线通过。

S3修后验收：主树输入3f8ebcae唯一命令exit0/2/2，normal字节/24行/红色宽2中文/光标(6,4)及serialized35B实际验证；flood全69632B等于native readBytes，16帧/consumed0时主体SIGTERM及child回收，最终消费21帧、pending0，live/serialized与100行scrollback一致。两组EIO/close0、资源first/current released、无fault/外层TERM或KILL。独立核验9份源码匹配输入、首次18文件不变，没有启动额外PTY或重放。测试入口仅目录参数/提示变化，Node22语法与完整源码差异检查通过；本轮未重跑上一阶段43+6纯矩阵或全量测试。统一静态检查通过：两树8份设计YAML/索引/关联路径、两计划12标题原序、production既有历史精确保持与两树正文一致；本轮仅目录参数及文档改动，两树diffcheck通过。

S3验收分账：首次两个真实PTY仍为Control send failed/0/2，normal exit7/readBytes2108、flood signal15/readBytes73472；allOwnershipSettled=true、cleanup safe/steps=[]且两个provider关闭。normal首报unknown保留，不被迟到released覆盖。首跑前adapter38/channel1等preflight为旧时点记录；首败后Node22 adapter43/43、channel6/6、provider core2/2、source断言组1、既有bridge、全typecheck及两fixture独立strict均通过，执行会话已结束；独立只读复核无本切片确定性blocker。新握手不等consumer、真实send错误仍冻结，并非把原错误降级忽略。离线补验normal2108B精确/重建终态与flood73472B全x成立，但首次live终态断言未执行，原0/2不变。没有修后原生采集；下一阶段仅冻结新输入/新目录复验相同两个场景，不扩矩阵/工具或自动runner/push，不接现有业务，不关闭PI-01/02/03或产品总债务。统一静态检查通过：两树8份设计YAML/索引/关联路径、两计划12标题及HEAD顺序、production第2至14节精确保持和两树正文一致；诊断树仅8文档，无manifest、workflow、既有业务入口或诊断源码改动，两树diffcheck通过。另8份mjs的Node22语法检查通过，没有执行fixture。

当前S2实际普通pipe七组首次7/7、exit0：providerAttempts8含ENOENT、实际provider7、subject4、transport close8含失败spawn句柄；未重跑。S1回归35组、channel纯回归1组、typecheck通过，旧代码内存负对照按预期拒绝；后补四项deadline hook及一次期限snapshot参数检查通过且无child。首轮TS2345/TS2339、fixture TS7006及纯测断言错误保持；最终adapter35/35、channel1组、typecheck、bridge、两mjs语法及fixture独立strict均exit0，执行均已结束；最终独立只读复核含期限snapshot等修正，无本切片确定性blocker，统一文档静态检查通过。验收仅限第14节Linux/Node v25.6.0普通pipe，不折算PTY/native addon、macOS/Windows/Electron、reader、真实Agent或PI-01/02/03整体通过，旧32/32不追改。

S2统一静态收口：两树八份设计YAML、索引与关联路径通过，production正文一致且原第2至13节保持；两份总设计仅当前导航两段变化，lifecycle/native isolation仅当前导航变化，两计划各12标题及各自HEAD顺序保持。每树八文档，主树另有三个tracked S1文件窄修和五个S2新文件；现有入口、manifest/generation、workflow与诊断源码无diff，rg确认新模块无业务导入，两树git diff --check通过。首次一次性检查的正则漏匹配S1当前导航导致历史误报，纠正匹配后通过；未改历史迎合检查，未新增验证工具。

S1 先前定向31/31、typecheck 修正后复跑及 bridge 回归通过；补 resourceLedgerIncomplete 专用一组后最终32/32和 typecheck 复跑通过。源码与前31组已独立通读，资源登记修正及新增第32组另经只读复查，统一文档静态校验通过。重点回归包含慢 send/快消费的 accepted-before-consumed、正常 transport 退役后可继续准入、迟到 started 不复活已结束状态、已拥有 raw 前缀不随额度拒绝丢弃，以及原定启动/身份/信用/封口/失联/双执行约束。首轮 TS2339 及两次用例未执行的 esbuild 输出路径/require 与 fixture 多 cols/rows 错误均保留；之后17/17、22/22、25/25、31/31 是逐次扩大覆盖，新增32/32另计当前最终结果。三项 review 回归加入时修复已存在，不写成全部先红后绿。后续 S2 的验收仅为零 PTY 的真实异步通信和安全清理，不折算为 native、两模式/reader、Agent 或跨平台产品通过。

S1 统一静态校验：八份设计 YAML/索引/关联路径、两树生产主文一致、生产原第2至12节保持、八段历史正文除两份总设计第6节指定当前导航段更新外逐字保持、两计划各12标题原序均通过。每树仅八份 tracked 文档改动，主树另有三个 S1 新文件；无现有业务导入或诊断源码变更，两树 git diff --check 通过。一次性历史检查最初误把当前导航当作不可变历史，区分这两段后重核通过，未修改文档迎合检查，也未新增验证工具。

本轮验收只核接口设计与既有契约一致、两树正文/计划同步、源码锚点和历史结果保持；统一静态校验通过：两树八份设计YAML/索引/关联路径、共享正文一致、八段实验历史及两份设计原第2至7节逐字保持、两计划各12章节及原顺序、每树仅八文档变化和S1文件未创建均已核；两树git diff --check通过。S1 后续定向测试必须直接加载真实共享模块，覆盖 bind 前拒绝、start 幂等、身份拒绝且旧 owner 责任保留、accepted 不返信用/消费后单次返还、帧/额度与未解析积压限界、exit 先到仍接尾部、pending 进程不 seal、封口尾值严格匹配已接受尾值（含少报拒绝）、取消失联不造 EOF、首次 unknown 与迟到补证、注入消费失败不伪 applied、双内存执行不串用。S1 还需 typecheck 和既有 bridge 回归；不折算为 native、双 PTY、两 authority 或真实 Agent 验收。

本轮设计验收只检查三侧只读专项覆盖、主树代码锚点可定位、生命周期契约及产品边界一致、两树设计/索引/计划/技术债同步和旧源码/实验/断言/工件保持。静态统一校验已完成：两树八份设计YAML/索引状态/关联路径、共享新设计正文、八段历史正文逐字保持、两计划各12章节且顺序与各自HEAD一致、八个生产模块路径和六项分层门槛均通过；两树git diff --check通过。首次一次性章节检查误设两计划顺序相同而失败，改为分别对照各自HEAD后通过，未为此重排文档或修改旧证据，不能把设计形成写成原生或产品通过。下一里程碑 PI-01/02/03 的验收产物是可实施消息与状态转换、跨平台父 owner 丢失责任、两模式 parser/reader/兼容偏序和有限切片自身安全界限。A/B 须另冻可运行协议，PI-04/05/06 默认启用门槛仍未关闭。

第27.10节三次真实U1-6的场景、资源、证据域均通过：无go/写读/parser，真实wait rawStatus0，单次kqueue/master close0及payload/TSFN/thread结算；caller/observer/writer原预算未放宽。完整16采集来源、21runner来源和2768build成员已核对，可信保存复核3/3，独立raw检查不依赖summary/pass。构建来源审计18175检查零失败不是原生样本数；本轮无真实注册错误、尾部消费、并发隔离或产品通过结论。后续决策阶段按工作计划的设计停止条件验收，不以枚举更多故障作为统一前置。

第26阶段各项要求真实posix_spawn/helper与同一child身份、ready和kqueue注册双前提、成功写2102/读2104字节、正容量read0、完整headless终态/光标x6/y4、真实wait1792/exit7及唯一正常通知。kevent返回后同owner单次close kqueue，read/parser及非master资源结算后单次close master，真实返回/error均0；资源或证据不足停止准入。旧19纯测、Linux4项不计本轮三次macOS原生验收。

第25阶段新Linux四项已经满足冻结判据：U1-5在ready前完成真实wait/完整输出/消费/非master资源，caller100ms前收到真实close0 audit却不据此更新被测状态，到截止first=unknown；observer至少hold100ms后放行同operation receipt，current=released且first不变。normal在4.461962ms首次released，无held许可。19项纯测试、四个原生样本及独立离线/原始事实检查分账，旧结果不重判；macOS/Windows及真实失败/挂起/生产链路仍须独立验收。

第24阶段固定新U1-0一次/U1-4三次已通过，两场景真实wait1792/exit7、完整2104字节/EIO/state/光标及逐资源结算均有证据。U1-4实际分配payload后跳过API，保留合成status16、api未调用与callback缺席，再单次free/真实Release/finalizer/join，没有伪造正常通知。只读独立复核和raw审计通过；实际napi_closing和环境销毁仍未测，源/纯判定与native次数分开。下一项U1-5须先冻结具体回执路径与首次unknown判据，不能把audit已知close成功提前写入被测观察。

第23阶段只验新Linux四项。三份U1-3必须保留synthetic首报的null status/unconfirmed，native先发布再由同一线程真实wait；JS首报/IPC/最终台账一致但JS观察可迟到。全部四项仍须真实正常输出2102/2104、EIO、exit7、完整终端state/光标及master/thread/payload/TSFN结算。真实ECHILD不可冒称可恢复；该路径本轮只做判定反例，不将synthetic成功扩大为真实故障通过。纯测试、load零调用和离线核验不计原生样本。

第22阶段仅验收新Linux U1-0一次/U1-2三次。normal的完整原字节/真实EIO/exit7/最终状态及原线程资源要求不变；partial必须证明真实nonblock和TSFN先取得、合成EAGAIN跳构造、无thread/payload/通知、单次close/control/Release、独占WNOHANG终态及真实finalizer。实际4/4及两入口exit0；13新+15旧纯测试共28/28。三个partial均只有一次wait，不能把500ms/pending/EINTR纯夹具当原生通过。build manifest的2759成员及11采集源、四个config与raw/evidence对账，不用driver退出替代逐资源证明。

第21阶段仅验收固定新Linux U1-0一次/U1-1三次：真实raw的主体终态、owner收尾、内容/最终状态及writer字节/hash均需一致，三类判断与准入独立核验。实际4/4、CLI及独立保存复核exit0；旧31文件和2759构建成员/installed source/binary均未变，新三源码hash与采集快照一致。15项局部测试包含终态解码、124/125场景失败但已结算可继续、真实资源失败/缺证必须停止、取消非EOF及内容失败分账。不把这些纯fixture计成15次native，也不把本轮四次算完整U1/W1/产品通过。

第20阶段只关闭局部候选的正常尾部和逐owner收尾事实核验，不关闭完整U1-1验收：原判据仍失败且未凑满计划三次。4份raw内容/receipt、三个保存源和实际binary身份通过独立核对；最大observer after-await227.630766ms、caller139.686304ms、writer receipt70.664447ms均在原预算。6项局部测试通过，独立离线入口应重现原失败exit1而非伪造绿色；旧CLI exit13及stage18的314成员不变。以下为历史验收口径。

当前以契约第18节为准：原八项断言保留，追加两项修前失败、修后10项与ACK5项全部通过。唯一Linux完整矩阵42/42，80phase/156receipt满足原100ms及适用deadline；37个非G1证据消费先于发布并进入真实归档，G1/G2四gate保持。三次08明确详情不完整但证据充分，acceptanceReady=true仅指固定Linux诊断；D4模型、Windows/macOS和实际终端/产品未因此验收。首次附加核对的G2 held唯一性错误保留为辅助断言失败，按实际gate观察身份完成只读核对，未改正式测试或再次采集。以下为历史口径。

历史验收（第17阶段）：当前以契约第17节为准：ACK单变量因果与13/13局部回归成立，主self-test119/41/156/15/37及保存5/5通过。唯一完整42项保持原预算与来源判据；三个08虽证据充分，但真实consumer分别178.921449/130.366543/155.395370ms，超过100ms，故保存验收39/42且acceptanceReady=false。不得以summary场景控制42/42或仅77个成功phase上的boundedConsumerDelivery=true宣称全部80个phase通过。本轮未重跑、未放宽断言，结果不扩大为跨平台PTY/native或产品验收；以下为历史口径。

历史记录（第16阶段）：当前以契约第16节为准：errorDiagnosticsComplete与场景证据充分性分开，08预期截断仍为complete=false，但例外须同时具备writer/verifier独立验证、两helper在原预算内exit0且无控制尝试、输出真实end；不能用08掩盖helper退出故障。针对性8/8和收紧后的五组主回归119/41/156/15/37已通过，最终保存复核5/5、110 members、7源exact，现存三个partial08均scenarioEvidenceSufficient=false；这些不追认首次真实失败。首次真实工件缺summary、outer和shared manifest，42项是保存校验schedule、0 verified，acceptanceReady=false；缺证、意外截断及原consumer预算超限继续拒绝，不合并为PTY/native或产品通过。以下是历史口径。

当前判据以契约第15节为准：helper39、public29及saved29；public完整性true18/false11与全部语义有效分别记录。tamper8正例/20组35变体，负例不仅要求按指定错误拒绝，还要求错误完整性认证false。主回归119/41/156/15/37及saved5/5、110 members；156仍是154完整重放与2个缺证拒绝。portable46门禁/6profile原位及迁移各5/5/17负例不计原生覆盖。source hash、旧历史正文及旧实验脚本/workflow不变及两树文档同步须另核；acceptanceReady=false，不代表产品验收。以下为历史口径。

本阶段验收覆盖本地工具初版、实际fixture和审计修正，不宣称D3完整冻结覆盖。D4 local-3每次固定16项，93语义/4 saved及另存7个sidecar负例逐项有效，坏首项仍attempted16/verified15且末项通过；独立复审的两项阻断闭合。D3 v3最终 self-test-2通过119 oracle、41 core、15 files、25 archive/consumer/binding fixtures；saved4/4、88 manifest members、boundedConsumerDelivery=false、acceptanceReady=false；realNodeCases/nativeProcesses=0、pty=false，未运行live36+2+4或原生矩阵。六组覆盖与超时首报消费预算仍开放。D3真实36+2+4、本阶段三平台runner与native实际均0；本地D4不计为三平台48次已通过。收口前检查两树frontmatter/index、新增引用、共享契约一致、历史保持及diff，不能以旧runner或文档检查代替运行证据。

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

本轮只改默认关闭的owned reader open校验及测试，不迁移旧live、不启动新的执行进程。已准入的open若在await中失去连接/原映射，拒绝回包且不重新取得reader责任；测试失败以原退出码记录，重新验证保留前轮分类，不重跑PTY或修改原生工件。

第16节只读接入条件阶段不触碰旧实验或工件。下一S4正常关闭必须幂等保留同execution责任，reset/clear不通过换authority重新放行unknown；回退新分支不能卸载已持有的执行引用，关闭开关仅影响未来新建。真实native工厂尚不可达，因此本阶段没有进程迁移或清理动作。

第27.10节首次构建/采集目录和完整下载已冻结，只允许可信入口只读复核，不对旧目录再次构建或采集。两次仅工件下载记录分别保留，传输重试不等于原生重跑。635aa311九个候选文件、1a88d0cc运行输入、旧U1-0、安装依赖及所有旧工件不原地改写；以后另有受控实验须先冻结新协议和新目录，资源未知或缺证停止准入，超时/driver退出/runner销毁不作释放证明。本轮不追加push。

第26阶段新建独立build/输出目录且拒绝覆盖，固定输入首次push只运行一次，不追加dispatch/rerun筛绿。构建或前提失败保留首次日志，不计PTY通过；修订另冻输入而不改旧结果。可重试下载传输，不重跑原生；只控制直接创建对象，未知owner停止准入，不按日志PID或陌生fd清理冒充释放。

候选试验不得修改用户 storage 或替换仍承载 live 会话的 Supervisor；仅控制本次创建的 fixture。证据目录唯一，不覆盖初次失败。生产方案需要可回滚的 capability/adapter 选择和旧 session 原绑定保留，回滚不得伪造完整性或强制迁移。取消和回收必须幂等，不因重试重复输出、重复终态或误删其他读者。

## 证据与备注

S4补验代码和可重跑断言保存于`test-host-execution-owner-wiring.mjs`、`test-supervisor-execution-owner-wiring.mjs`；结果细分及初次失败见生产接入18.3。本轮关键输出为`Host execution owner wiring: 19/19 passed (non-native only).`和`Supervisor execution owner wiring: 13/13 pure cases passed`，不是原生样本数。既有Host esbuild external warning保持，禁止native的守卫仍生效；历史被删fixture无快照，不编造其精确根因。诊断工作树和全部冻结原生材料不改。

第16节证据为主树a5d884be上的静态源码定位和三个独立只读专项复核；没有本轮raw/native目录或新平台通过率。S3首次0/2与修后2/2仍只由第15节既有归档支撑，不重写、不累加。诊断树只镜像设计与进度，源码锚点不错误指向该树旧实现。

本轮新证据在主树`.debug/s3-linux-provider-source-ack-first/`，输入提交3f8ebcae，sources.json九项逐一匹配该提交。沿用经来源复核的同一S3 binary 721cd46455897cf90bfb155240bf928442e30ad4558184f2c9f32c55431a3c6a，不是旧诊断候选。首次`.debug/s3-linux-provider-first/`18文件逐项未变，排序内容整体SHA256仍fc64837dd8d96bc6dc2e2dd6123da99adef1252c4ce41d4ec464d86feaa9689b；0/2和首报unknown保持。以下旧构建与首败后证据记录按历史保留。

S3新构建记录位于主树 `.debug/s3-linux-provider-build-first/`：build.json、build-command.json和load-command.json保存固定来源/编译与零调用加载结果；binary SHA256为721cd46455897cf90bfb155240bf928442e30ad4558184f2c9f32c55431a3c6a。加载仅核7个函数导出，nativeCalls=0，不调用configure/fork/read等接口。首次真实工件位于主树.debug/s3-linux-provider-first，两项0/2和安全回收事实保留，未重跑；无runner/push，不复用旧binary或执行旧归档源码。

当前S2证据包括主树通道/transport与adapter窄修、首次真实普通pipe七组7/7、35组S1回归、1组channel纯回归及typecheck实际输出；首次类型/断言失败、旧代码内存负对照和后续四项hook/一次参数检查分别记录。诊断树只同步文档，未运行新原生输入、runner或push；具体源码与有限验证记录见生产接入设计第14.4节及本计划验证与验收，不将后补纯内存结果冒充首次真实矩阵覆盖。

本轮证据来自主树三个 S1 新文件、实际定向运行输出与独立只读复核；先前31/31及 bridge 通过保持，补资源账本完整性回归后最终32/32与 typecheck 复跑通过，统一文档静态结果已记录。复核确认 ACK 顺序、正常 transport 结束和迟到 start 状态修正已到位，相关回归已有定向结果，资源登记不完整修正及新增第32组亦单独只读核验；独立复核未重复执行。没有新增原生/runner 工件、workflow 或旧诊断输入；诊断树仅同步当前文档。既有冻结实验、断言与失败继续按历史保留，S1 的纯内存验证与后续 S2 零 PTY、真实 native 分账。

PI 接口阶段输入基线为主树 `07851ba4`、诊断树 `76ea6e77`，新增结论仅见生产接入设计第9至12节。只读核对追到真实 bridge、创建预留、tracker.flush、reader relay 和页面写队列，确认现有 generation/capability 名称与新候选分开；本轮没有新测试、原生、runner 或构建工件。S1 预定交付在主运行时树，诊断树仅同步文档且所有冻结源码/断言/失败和已有工件保持。统一静态验证已通过，结果见验证与验收，当前文段不替代实际测试结果。

本轮设计输入基线为主树 `081c3a21`、诊断树 `f7ce4283`；结论保存在 `docs/design-docs/runtime-exit-integrity-production-integration.md`，代码锚点以主树 `extensions/vscode/dev-session-canvas/src/` 为准，诊断树旧业务代码不是接入基线。只读核对覆盖 bridge/两 authority/relay/protocol/TerminalPagedProjection、同步阻塞与 owner 消失、宿主启动和六组资产分发；无新测试/native/runner 工件。独立审查要求显式衔接同步回执与异步 IPC、实施前与启用前门槛，澄清失联 loss 例外，并保持旧 reader 准入偏序；修订只作用于当前设计，不回改历史结果。统一静态验证见验证与验收；本轮不生成新原生工件或诊断框架。

第27.10节固定输入1a88d0cc6d74b91fbdb52808c1d129eb471e9bdb，唯一push run35963751067 attempt1、artifact10793441399；ZIP为12489418字节/2825成员，SHA256 a2dcfb89f6c36a3c7a926c8d919d7ba93fef12bb696834387a5cf347fceb991d。诊断树.debug/macos-native-failure-v1-preflight-first/input.json保存触发前来源，.debug/macos-native-failure-v1-run-35963751067保存API记录、两次仅下载记录、完整ZIP/extracted及validation下可信本地首次保存复核和独立审计报告。运行时树不承载这些脚本或工件；所有结果文档只本地提交，不追加push。

第27.9节输入准备时，诊断分支`1a88d0cc`仅本地提交，包含六个新文件和同步文档；当时尚未推送或原生采集。27.10的fetch/rebase未改变该SHA，按实际远端差异复核后唯一push及首次原生结果另行记录，主树仍仅文档。

第27阶段接口纠正的诊断实现已本地提交为`635aa311`（独立`runtime-exit-integrity-native-candidates`分支），包含21项有限测试和诊断文档；本树仅同步文档，不复制候选到业务。提交未推送，不是原生采集输入或产品验收结果。

第26阶段固定输入32312fe7d7f8a1c0268cc392706d1a2e693611b6、唯一push run35900772851 attempt1；runner工件在诊断树.debug/macos-native-baseline-v1-run-35900772851/。artifact10769350773共12510695字节，完整ZIP的SHA256 a6363a2ca09376354cf61c5e148deb80337cea2dd1202ceda8edbdbc92731a06与GitHub digest一致。pty.node为65d0ccd0dbf55c13b971d4ffcbbbb8a3f5c994071b75c2e33315d2c65c53743b，helper为6a689e86f518779d34a4521494ac6f5d3e9da819f322280eb32a3f941f7a6296；Node/headers22.23.2、node-pty1.2.0-beta.12/addon7.1.1、SDK26.5/Apple clang21、image20260907.0351.1均留证。可信本地入口以新进程复核3/3、exit0，不执行归档源码或加载Darwin binary。独立审计.debug/macos-native-baseline-v1-validation-first/independent-native-audit.json SHA256 b6f65f0a4f7789eac7b9aff7db769c281c0612c8dc1e89c6adf45791b2f12c07，25206检查零失败，其中三case5317/5317/5310共15944；110旧tracked、15旧证据入口、1个installed source、9冻结新源及build2768成员保持，不声称旧15GB全量深遍历。

第25阶段工件位于诊断树.debug/native-failure-v6-linux-first和.debug/native-failure-v6-validation-first，原build仍.debug/native-failure-v4-build-first。独立审计independent-native-audit.json的SHA256为a24f0bce71d097a63d53094f81b409ce8a55a6efb7d399b7cb730ded35548518；16134检查零失败，其中四case自身2061项，170旧工件/34旧源/安装源/4冻结源/11快照及五旧build保持。最大operation473.151370ms、observer after-await552.753787ms、caller close593.679338ms、writer receipt157.131539ms/close174.441986ms。各项回执时间与完整来源见正式设计第25节，检查数不是原生样本数，采集绑定未提交快照而非后续commit。

第24阶段证据位于诊断树.debug/native-failure-v4-build-first、.debug/native-failure-v5-linux-first及.debug/native-failure-v5-validation-first。binary SHA256为6e96a9dcd2a06b05cfe09d7bc98e6782838db3a326dd277ab47b0a60260f8217；独立审计independent-native-audit.json的SHA256为d641588db4a9ccbfeac2342006156e5ffbcbbe894758eebb2b8afde17b929b0f，15292项检查零失败，其中四case自身1266项，157旧文件/8冻结源/11快照/五build保持。最大operation243.171570ms、observer after-await309.058966ms、caller close320.656772ms、writer receipt77.562989ms/close84.599241ms。完整源、manifest与官方TSFN依据见原生失败隔离第24节，采集仍绑定未提交快照，不倒写后续commit。

第23阶段独立审计为.debug/native-failure-v4-validation-first/independent-native-audit.json，SHA256为62a61e7774fef3f1999815dc570991d75c8096ff39c0799414b18990fa06d256；直接核raw/config/evidence及来源，不读本轮summary结论、不导入verifier。110旧文件、8新源、11采集快照与四build各2759成员保持，零新增native。最大operation301.505554ms、observer after-await370.706758ms、caller close385.869024ms、writer receipt79.329636ms/close87.114198ms。shell引用的零执行审计错误和no-index检查包装器误判分别留说明/日志，均不改源码或重跑原生。

第23阶段证据仅在独立诊断树.debug/native-failure-v3-build-first、.debug/native-failure-v4-linux-first和.debug/native-failure-v4-validation-first。新binary为2a291215e30c3e967b643ca4c184efe6800aaa104c284dfdc09e7a376bb93349，生成源62d4d7e7b6119511f67457637006c7f15b72c007cf9e803b05e84750a9b11b46；2759 build成员、11采集源、4config及8冻结源随工件保存。45项纯测试=28旧+5native patch+12新verifier，零native；唯一原生四项全部wait1792/exit7，不合算旧通过率。详情见原生失败隔离第23节。

第22阶段独立原始事实审计为.debug/native-failure-v3-validation-first/independent-native-audit.json，SHA256 d521b5c91059aaebc306e38d4dc5ab8d69299144625dbd239453fc883bafdafa；6179项数据/保持检查零失败，其中四case自身510项。直接核raw/config/evidence和11源，不读summary或调用verifier；旧68文件、新8源及两build各2759成员不变，零新增native。最大operation161.326947ms、caller续体161.432543ms、observer after-await228.073118ms、caller close243.192798ms、writer receipt71.920929ms/close76.761996ms，预算不变。

第22阶段新构建为诊断树.debug/native-failure-v2-build-first（binary fa6f9ab7），新采集为.debug/native-failure-v3-linux-first，审计/日志为.debug/native-failure-v3-validation-first。frozen-sources保存8源摘要，schedule保存11源/4config和build manifest绑定；build-preservation-audit完成2860检查/0失败、2759新build成员及68旧文件保持，hash50ac12e829da8026c48060f65fbd7906a02623baa62c5c3ccaedb7964dc6e181。源码完整摘要、独立原始事实审计和未实测边界以正式设计第22.3–22.4节为准；采集绑定当时未提交快照，不倒称后续commit输入。

第21阶段独立审查另存 `.debug/native-failure-v2-validation-first/independent-native-audit.json`，SHA256 `5f4a3ddea3fe34607e82ec099169bf6fd3881b9954dd07fd18dccd1cefa5e3d3`；从四份raw/config/evidence及六源完成503项检查、零失败，不依赖summary或调用冻结verifier，零新增native。最大operation150.922725ms、caller续体151.008634ms、observer after-await214.99655ms、caller close227.175316ms、writer receipt69.249869ms/close75.436092ms，均在原预算。

第21阶段证据在独立树 `.debug/native-failure-v2-linux-first` 与 `.debug/native-failure-v2-validation-first`。前者保存四份预冻结config、六源快照、raw/evidence/summary/verification；后者保存旧输入before、新源码frozen-sources、首次缺环境及补环境测试日志、唯一native-run、独立offline-verification、preservation-audit与原始事实审计。采集仍绑定未提交快照，CLI/verifier/test摘要与实际边界见正式设计第21.3–21.4节；主树只有文档，不承载新脚本或工件。

第20阶段新增证据只在诊断树.debug/native-failure-v1-linux-first、native-failure-v1-validation-first、native-failure-v1-build-first、native-failure-v1-build-raw-status和node22-headers-first。两次build/load均零PTY，唯一runtime schedule四次实际创建；原native-run.log exit13、offline-verification.log及standalone-verification.log exit1分开保留，raw-metrics.json只汇总保存事实。源码/二进制/headers及本机libc摘要见正式设计第20.3–20.4节；已执行旧实验和原断言不改。

第18阶段证据均在诊断树.debug：settlement-consumer-stage18-before/after保存8/2与15/15及五源；settlement-consumer-selftest-first和-verification.json保存自测/重放；settlement-consumer-full-first、同名.log及-outcome.json、-verification.json、-order-audit-first-failure.json、-order-audit.json保存唯一完整42项、首次辅助核对误断言和实际时序。settlement-consumer-prior-evidence-check.json保存旧170文件/314成员及旧日志/报告不变检查。来源和摘要见契约第18节，旧39/42不改写，不执行归档sources。

历史证据（第17阶段）：当前第17阶段证据均在独立诊断树.debug：settlement-ack-stage17-before/after保存修前1/4与修后13/13及源码；settlement-ack-causal-dyybyB保存100.508429ms保持后的单变量EOF因果；settlement-v3-ack-selftest-first及-verification.json保存自测/重放；settlement-v3-ack-full-first、同名.log及-verification.json保存唯一完整42项及39/42验收失败。精确源码/工件hash和计时见契约第17节，不从归档sources执行代码，不用后续提交倒写采集来源。

历史记录（第16阶段）：当前第16阶段证据在诊断树 `.debug/settlement-v3-scope-selftest-final`、`.debug/settlement-v3-scope-full-first` 及对应可信保存复核、`.debug/settlement-v3-scope-helper-guard-selftest`。初始汇总版本、唯一真实失败和后续收紧08例外的源码/结果分别绑定；完整来源、针对性测试、保存复核与诊断观察见契约第16节，不从归档sources执行代码，不将后续修正倒写为首次运行输入。

历史证据（第15阶段）：`.debug/settlement-error-budget-v1-helper-third`、`.debug/settlement-error-budget-v1-public-third` 及 `-independent`、`.debug/settlement-error-retention-tamper-v3-second`、`.debug/settlement-v3-stage15-second` 及 `-verification-absolute.json`、`.debug/settlement-portable-v3-stage15-first`。所有首次与中间失败保留，最终七源hash及准确计数见契约第15节；旧43项与第14节证据不改。

本增量最新本地工件在独立诊断树 `.debug/owner-quarantine-v2-local-4-{selftest,full}`、`.debug/settlement-v3-portability-check-1`（含original/moved、32项内存检查及两份验证）、`.debug/settlement-v3-saved-binding-negatives-1`（13项）。根保存重放为 `.debug/settlement-v3-portability-check-1-root-verification.json`。首个类别替换、boundary-first/second、CLI dev-1/self-test-3/self-test-4与source-outcome-repro-1分开保留，精确路径/hash/判定见契约第13节，不执行归档源码，不把后来的提交当作之前实际输入。

本阶段最新证据在独立诊断树：D4 `.debug/owner-quarantine-v2-local-3-selftest`、`.debug/owner-quarantine-v2-local-3-full` 与各自 `-verification.json`，补充 `.debug/owner-quarantine-v2-local-3-sidecar-negatives` 七项；首次碰撞失败在 `.debug/owner-quarantine-v2-key-collision-first-failure`。D3 v3最终 self-test-2通过119 oracle、41 core、15 files、25 archive/consumer/binding fixtures；saved4/4、88 manifest members、boundedConsumerDelivery=false、acceptanceReady=false；realNodeCases/nativeProcesses=0、pty=false，未运行live36+2+4或原生矩阵。D4精确四源hash、缺口与证据边界见诊断结算契约第12节；以下设计冻结与历史runner记录不作为本阶段新采集。

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

本轮未新增公共协议或依赖。owned open在checkpoint等待后校验session引用与socket reader-map引用，避免失效请求重新入账；正常legacy路径不变。下一远端reader切片须复用sessionId/authorityId/readId/sentRevision和固定finalRevision，将applied/cancelled/lost/legacy-released分开保留；现有整执行socket集合只作过渡责任占位，不能证明editor/panel分别完成。服务端接收实现不替代后续Host/relay/client/Webview能力与写完成接线。

下一S4继续使用同一ExecutionAuthority/PreparedExecution和SerializedTerminalStateTracker。正常closing与quarantine分开，准入前预留且失败保留原控制对象；seal仅封内容边界，不证明后批已消费。最终消费等待放在terminal链外，最终flush/固定revision在链内；reader未完成不阻止可安全回收的native责任，但仍阻止其自身状态退役。不借此引入新OS控制机制、生产停止预算或更新manifest/generation。

S3原生导出仅fork和token化executionConfigure/Snapshot/Read/PollWait/Signal/Close，移除open/process/resize导出；snapshot保留实际取得、nonblock、合法wait终态、close真实结果及有限计数，无轨迹框架。read固定4096B原位buffer，retry/EOF/error分开，TERM/KILL各最多一次且只控制原owner；同provider无第二reaper。资源取得消息先报告再结算，父provider-control不可由provider代证。现有业务入口、reader、manifest/generation和旧live不变，以下S2及更早接口为历史。 首败后父消息新增sourceEndAccepted(finalFrameId)，沿原有单send队列排空已在途ACK后确认源移交；provider正常close须等匹配确认，不等consumer，stop/cancel继续服务，真实发送失败仍走fault。

S2新增的 `executionProviderTransport.ts` 使用显式注入可执行文件/入口创建真实direct child，`executionProviderChannel.ts` 使用IPC控制与fd4异步数据通道，复用S1身份、消息、帧及信用，不建立第二套adapter。父侧provider-control只接受真实父侧释放证明；正常disconnect、进程终态和sourceEnd分责。零PTY、无native addon、无现有业务导入；两authority、reader和真实Agent尚未接线，以下S1及更早接口记录为历史。

S1 已提供 `executionLifecycle.ts` 的结果/消息/帧校验及 OutputCreditWindow，`executionSessionAdapter.ts` 的 ExecutionAuthority、prepare/bind/start、有限帧接受与 consumeBatch、操作观察和资源事实。接口只依赖注入 transport/scheduler/observer，不导入 vscode/node-pty/spawn；source、process、resource、authority 消费责任分开。下一步 S2 为同一接口提供真实异步传输与零 PTY provider 启动链，不新增另一套 adapter。远端 reader outcome、本地 final barrier、业务身份切换和候选 capability/namespace 尚未接线，不能从 S1 的类型存在推导这些能力已启用。

本轮 S1 输入固定为 `prepareExecution(identity, launchSpec)`、单次 `bind(observer, consumeBatch)`、`start(operationId)`，并分开 data/processResult/outputSeal/resourceResult/fault；authority 应用结果由自身产生。输出 frameId 仅关联 accepted/consumed，复用既有文本 sequence 与终端 revision，不加第三终端水位。候选 `executionProcessResultV1`、`executionSourceEndV1`、`executionResourceSettlementV1`、`terminalReadSettlementV1`、`terminalLocalSettlementV1` 及 `execution-lifecycle-v1` namespace 仅登记后续接线，S1 不改任何现有协议入口或常量。新模块无 vscode/node-pty/spawn 依赖；真实 transport/provider 后续接同一 adapter，旧 live 原绑定保持。

本轮仅登记待实施接口，不创建生产模块：五类结果沿用生命周期契约，父侧 adapter 分配已接受文本 sequence，authority 分配 terminal revision，provider 只保留 IPC 移交关联和逐资源责任。PI-01/02/03 同时核对 `panel/executionSessionBridge.ts`、`supervisor/runtimeSupervisorMain.ts`、`panel/CanvasPanelManager.ts`、`common/serializedTerminalState.ts`、两份 protocol、`panel/runtimeTerminalReadRelay.ts`、`panel/runtimeSupervisorClient.ts` 和 `webview/terminalPagedProjection.ts`。新能力须双方 opt-in，旧 live 原绑定继续，不凭分页能力补造源/资源或应用成功；旧章节接口与诊断源继续冻结。

第27.9节新增build/diagnose/saved入口及两个测试文件、专用workflow，现有635aa311诊断接口保持。saved导出verifyBuild、verifySaved、固定三项/无输出expected和16来源清单；CLI只接收output/binary/build-directory或verify-saved，不引入headless/正常负载。调用方沿用冻结writer及原预算，只有helper要求执行位，.node不新增执行位要求；离线只读取归档，不加载归档代码/native。

第26阶段只新增Darwin诊断接口，复用冻结v1 fixture/writer、预算和headless序列化；Node22.23.2、node-pty1.2.0-beta.12及其addon7.1.1固定。helperPath非空且可核来源，源结束单列darwin-read-zero，native记录创建/kevent/wait/释放。observer→caller→driver→fixture与独立writer责任链及29/30/32/35/36秒、writer1/2秒预算不变，不新增业务API。

第25阶段不新增native导出或业务API，复用native v4/6e96a9dc。新JS config显式nativeScenario/fixtureScenario=U1-0及releaseOperationId=token+':master-close:1'；driver report.release记录ready/request/audit/receipt，caller.release记录r0/deadline/独立audit/receipt/immutable first/current。observer仅通过release-permit和receipt-permit控制本次单一operation，不把旁路事实导入被测状态，不恢复进程或历史。

第24阶段只在隔离native snapshot新增notificationCallInvoked/notificationFailureInjected，明确真实通知与合成call-skipped，仍8导出。U1-4的report.callback及notificationCallbackStatus为null，真实wait终态另行保留；无备用通知、第二waiter、Abort或环境销毁接口。Node22.23.2/node-pty1.2.0-beta.12/addon7.1.1固定不变，官方Node参考源只读、不参与构建，主树无业务API接入。

第23阶段新native仅增加诊断snapshot中的nullable firstAttempt，不新增业务接口。firstAttempt保存synthetic/syscallCalled/result/error/statusValid/rawStatus/disposition/nativeOrdinal/monoNs，后续真实wait不覆写；新JS firstWaitObservation/initial-wait-result只作为诊断事实记录。fixtureScenario显式为U1-0，native独立配置0/3；新v3候选仍8导出，其中U1-2 polling在本轮不可达。所有源在独立诊断树，主树无运行时接入。

下一版本的候选接口是同步返回handle的 `startObservedCase(spec)`：observation、processSettlement、evidenceSettlement三个不可变首报Promise，另有只读owner快照和有界late事实订阅；process exit不代替capture真实EOF。D3每case最多预留caller/evidence/publisher三个槽，任一hard截止仍unknown停止后续case，不与D4的N2混算。writer、独立verifier与publisher仅为标准库诊断角色，不新增生产模块、外部服务或依赖。

D4 v2使用完整command/return/event/snapshot、不可变owner identity和独立oracle；创建acquisition/use token/单次owner整体release/首次unknown/当前证明/tombstone分账。schema和常量可共享，SUT转换/验证/snapshot helper不得被oracle复用。原八个新文件与新增boundary fixture仅在独立诊断树，当前为本地确定性验证和审计修正；运行时代码、旧live绑定、旧脚本/workflow及依赖保持不变。D4复合key使用JSON tuple，snapshot为隔离深拷贝而非JS冻结承诺；独立诊断消费预算已按第13节冻结为100ms，不是生产停止预算。

设计冻结时点的候选 `startObservedCase(spec)` 尚未导出实现；当前独立诊断树已创建对应handle/CLI/oracle/fixture入口，但不等于生产导出。诊断台账的failureDomainId/allocationId/operationId只界定测试资源，不新增生产registry/wire；N/Q、D3毫秒数及W1/U1期限均不是生产策略。第一批只读使用锁定node-pty/native-addon-api源与headless consumer，依赖不升级，native副本按源hash/匹配计数和真实binary绑定；旧自然fork/guard/G07不改。
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

修订记录（2026-09-22，新诊断本地初版与审计）：同步八个新入口实施、D4 local-3与首次碰撞失败、sidecar重hash证明和D3首轮/交叉重放发现，更新四活章节及当前步骤。本阶段不运行D3真实矩阵、不新增runner、不推送；保留六组冻结覆盖、独立消费预算、D4 create/use正例和完整原生/产品门槛，不以自测总数宣称全部验收。

修订记录（2026-09-22，本地阶段文档补正）：补齐D3最终119/41/15/25及saved4/4，修正误截断的oracle hash与三处无效占位文本，明确首报及时冻结和到期冻结时的不同consumer判定。两树八份设计元数据/索引/关联引用、各12个计划章节、八源hash及共享新增契约对账通过；旧章节除显式consumer澄清外保持，独立只读复核未见新的确定性文档矛盾。本补正没有重跑诊断、原生或矩阵，不改变既有失败与未闭合门槛。

修订记录（2026-09-22，确定性覆盖增量）：补充D3 156项和固定100ms诊断消费策略、D4迟到创建/使用责任，修三个oracle误判及可信归档类别/结果绑定。保留首次编排、读取上限与可移植性缺口，记录最终119/41/156/15/37、saved5/5、13语义篡改及D4 local-4证据；四活章节、索引与债务同步。剩余容量可达性和跨OS整包归档仍待办，无真实D3/native/runner或业务改造，不关闭整体工具或产品门槛。

修订记录（2026-09-22，容量与合成跨OS归档）：补43项固定容量目标与6profile/46门禁/17负例，修caller stderr的oracle角色误判并将producer身份与本机读取分离。保留首次失败、源码与归档执行方法偏差，正式结果改用可信工作树复核；四活章节、当前步骤、索引和债务同步。错误辅助数组有界策略和真实平台归档仍需后续，本轮不推送，不改业务/旧实验，不新增native/PTY/runner。

修订记录（2026-09-22，错误诊断保留边界）：完成字段/列表预算、缺证标记与独立重放，保留26/29、155/156及相对路径内部调用4/5首轮记录，补来源伪造和认证反例。最终39/29、8正例/20组35变体、主回归五组与saved5/5、portable46/6/17均按范围留证；同步四活章节、当前步骤、索引和债务。旧43项不改，新策略可达性、其他容器和真实平台门槛仍开放。本轮不推送，不改业务/旧实验，不新增native/PTY/runner。

修订记录（2026-09-22，工具范围纠偏与首次真实整链）：停止通用工具前置链，分离详情完整性与场景证据充分性；保留针对性8/8、主回归及唯一Linux真实整链的180秒exit124失败。明确24条失败结算、09-1未结算、余17项无启动证据及42项检查/0 verified的区别；收紧08例外以阻止helper退出故障借标签通过，不改core/oracle或原场景预算。ACK自然退出等待环仍待最小因果对照；下次外层保护按388秒阶段预算加编排/写盘重新评估，修后新输入最多一次既定42项，不恢复通用研究、不宣称产品通过。本轮无后续实验、runner或push。

修订记录（2026-09-23，ACK最小修复与完整矩阵）：同步四活章节、当前步骤、索引和债务。因果确认、最小core修复及13/13局部回归已完成；唯一完整42项exit1，场景控制42/42但可信验收39/42，三个08的consumer超100ms保留，77/80部分聚合不冒充整体保证。第16节失败不变，下一步只处理直接交付顺序，不再本轮采集、放宽预算或扩展工具前置；不改业务/oracle/D4，无PTY/native/runner/push。

修订记录（2026-09-23，消费顺序与完整统计收口）：只改诊断CLI非G1消费顺序与可信80阶段集合，追加两项回归且原八项不变。修前8/2、修后15/15及既有self-test/保存通过；唯一新Linux42/42，80phase/156receipt及真实出版/gate顺序核验通过，原100ms未放宽。保留旧partial/39/42与首次G2辅助断言错误，下一步回到W1/U1实际路径，不增加通用工具前置。本轮无业务/core/oracle/D4、PTY/native/runner/push变更。

修订记录（2026-09-23，Linux原生最小切片）：从工具回到真实forkpty，完成隔离构建、6项局部回归及唯一4次原生尝试，按原规则保留3通过/1失败/2未运行。同步四活章节、实际步骤、证据和债务；资源已结算与signal-only误前提分开，glibc启动路径只作候选，不宣称唯一根因。原入口exit13与源码保留，以新增只读入口复核原失败，不新增原生、业务、runner或推送。

修订记录（2026-09-23，终态与资源准入分离）：新增v2三类判断及无循环离线入口，定向15/15、新唯一Linux四项4/4，三个partial均保留真实wait256/exit1。同步四活章节、当前步骤、输入摘要与剩余U1-2/平台/产品边界；旧3/1/2、exit13、31旧文件及2759构建成员不变。没有重建native、修改业务/已安装依赖/workflow或触发runner/push，不扩通用工具验证。

修订记录（2026-09-23，TSFN已取得后线程启动失败）：完成第22节协议、八个新隔离文件、首次build/load、28项定向回归及唯一新四项4/4；同步四活章节、当前步骤、来源/证据与U1-3剩余边界。无thread/payload/notify不伪造释放；三个partial首次wait即终态，未外推pending/EINTR或其他平台。旧3/1/2、旧4/4和exit13保持，未改业务/安装依赖/workflow，无runner/push。

修订记录（2026-09-23，同一等待者的未确认与补证）：完成第23节协议、八个新隔离文件、冻结前格式检查、45项纯测试、首次build/load和唯一U1-0/U1-3四项4/4；独立raw/旧内容保持审计与两树文档同步。初次合成ECHILD永不覆写，真实wait均首调用exit7；真实ECHILD/EINTR与迟到JS只保留源码/纯测试边界。下一步先设计U1-4合成closing下的资源责任，不新增通用工具门槛，不改业务/安装依赖/workflow，无runner/push。

修订记录（2026-09-23，通知未交付与真实资源责任）：完成第24节协议、八个新隔离文件、61项纯测试、首次build/load及唯一U1-0/U1-4四项4/4；独立进程离线复核与raw/保持审计通过，两树文档同步。合成closing与实际Push的引用消耗不同，未入队payload先free、仍取得的TSFN单次Release；真实exit7、完整尾部和资源结算不靠伪造callback。下一步只先冻结U1-5释放回执扣留协议，真实closing/环境销毁/其他平台/产品整链未验收，本轮不追加实验或工具门槛。

修订记录（2026-09-24，真实释放与未知回执）：完成第25节协议、四个v6隔离JS文件、19项纯测试及唯一U1-0/U1-5四项4/4；复用旧native无新build，另进程离线复核和直接raw/保持审计通过，两树文档同步。audit早到不改变首次unknown，同operation迟到receipt不再close、不覆盖首报；日期跨入09-24按实际运行记录。下一最小项转向macOS U1-0平台协议，旧失败及未验收边界保持，不新增工具门槛、不改业务、无runner/push。

修订记录（2026-09-24，Darwin正常路径冻结）：第26节及两树计划各活章节已同步，只实施macOS U1-0三次的独立输入与专用workflow。保留真实创建/helper/kqueue/wait路径、原输出和预算，完整来源与逐资源释放分别验收；冻结时无本轮构建或原生结果，不改旧实验或扩充通用工具门槛。

修订记录（2026-09-24，第27阶段U1-6协议冻结）：源码复审确认当前注册失败分支不waitpid、现有roles gate永久等待，stock Darwin实现也不能作为修复模板。冻结native-substitute合成-1/EIO、同一Wait线程唯一waitpid、同owner单次kqueue close、保持数据gate关闭及token-bound abort/ack；U1-6预期无写入/read/parser/state，三域分别验收。本阶段不实施、不构建、不运行runner；下一步仅做独立诊断树定向纯测试与新输入准备。

修订记录（2026-09-24，Darwin正常路径结果）：固定32312fe7的唯一run35900772851 attempt1成功，10组定向纯测试、零会话build/load和三次原生3/3分账；完整ZIP摘要核对、可信本地离线3/3及独立raw/来源保持审计25206检查零失败。下一项先冻结macOS U1-6合成注册失败的唯一reaper/逐资源协议，其他平台路径与产品边界不改，主树不推送。

修订记录（2026-09-24，U1-6纯协议测试）：诊断树提交519ca7b8新增隔离fixture、三域verifier和定向纯测试，6/6通过；三个文件node --check及git diff --check通过。覆盖合成EIO前置命中、旧kqueueRegistered gate不放行、无go/written/read/parser/state、token/PID abort-ack、唯一Wait线程waitpid→kqueue单次close、TSFN/payload/thread/finalizer/master结算及三域负例。未实施native替身、未构建、未加载、未运行runner；后续完成静态接口复审并新增独立替身源码契约。

修订记录（2026-09-24，U1-6静态接口复审）：确认现有U1-0 support/roles不能直接执行U1-6；Configure/snapshot固定U1-0，注册失败路径不waitpid，旧gate会等待`kqueueRegistered`而无法发起受控abort。纯测试结果不外推为native实现；随后在诊断树新增独立替身、roles分支及fixture process，先做源码/纯测复审，仍未构建或运行runner。

修订记录（2026-09-24，U1-6替身源码契约）：新增support/patch、roles、fixture process及两组源码纯测；连同协议三域测试共10项通过，node --check和带依赖根的patch静态测试通过。替身仅记录合成EIO、不调用真实kevent，唯一waitpid后单次close kqueue，roles只发token/PID abort并等待ack；未编译、未加载、未运行PTY或runner，下一步需独立评审后再决定原生构建。

修订记录（2026-09-24，U1-6接口纠正收口）：首轮6/6和10/10不构成完整接口验证，复核发现实际字段不兼容及漏验；保留新增负例6/7失败，完成本次直接接口/安全修正，最终21/21和8JS逐文件语法通过、独立只读复核无新直接阻断。同步四活章节、执行命令与设计27.8，不改旧实验或业务；没有C++编译/加载/PTY/runner/push，下一步仅冻结新的原生build/schedule输入，不再追加通用工具门槛。

修订记录（2026-09-24，U1-6运行输入准备）：按27.9新增六文件，30项有限测试及13JS/workflow语法通过；补not-run执行工件拒绝和完整来源绑定，保留635aa311候选及旧历史。更新四活章节、执行命令与后续唯一首次采集规则；本轮无C++编译/加载/PTY/runner/push，不追加通用工具门槛，退出完整性仍未交付。

修订记录（2026-09-24，U1-6首次原生收口）：唯一1a88d0cc/run35963751067 attempt1完成首次构建、零会话加载及三项3/3；完整ZIP、可信本地保存复核与独立raw/来源审计通过。同步四活章节、当前步骤与证据边界，保留全部旧断言/失败，不改业务、不追加push/runner。下一阶段改为生产接入与故障隔离决策收敛，只有影响选择的A/B最小对照另冻协议，不机械追加U1-7/W1或通用工具前置。

修订记录（2026-09-24，生产接入决策设计）：从两树已收口基线完成接口、隔离、分发只读研究，形成独立设计、每会话provider与父侧authority首选候选、五类事实/IPC责任/unknown有界准入和PI-01至PI-06。同步目标、四活章节、工作计划、步骤、验收与接口；下一步只收敛PI-01/02/03，A/B仍须另冻可运行协议，不自动追加U1/W1或业务实现。保留旧进度结果和历史正文，本轮无测试/native/runner/push；静态统一校验已完成，结果见验证与验收。

修订记录（2026-09-24，PI接口研究收口）：从主树07851ba4/诊断树76ea6e77完成消息与信用、owner责任、两模式/reader只读研究，生产接入设计新增第9至12节，冻结S1无native真实模块和定向测试输入。同步目标、四活章节、当前工作/步骤/验收及接口，保留旧源码、实验与结果。下一步只实施主树S1，不改现有业务入口，不自动native/runner/push；本轮未实施或测试，统一静态校验已通过，结果见验证与验收。

修订记录（2026-09-24，S1 核心实施）：主树新增真实共享类型、adapter 和定向测试，独立复核后修正 ACK 合并顺序、正常 transport 退役、迟到 started 状态及原始前缀/观察边界。保留首轮 TS2339 与两次未执行用例的 esbuild 路径/fixture 失败；当时定向31/31、typecheck及bridge通过，17/22/25/31组不累计为native，review回归不追认红后绿；后续32组及统一静态收口见追加修订记录。同步四活章节及当前目标/步骤/验收，明确不再是仅文档阶段；下一步限定 S2 真实异步 transport/provider 启动链、零 PTY，先冻结有限目标与安全清理，不接业务、不自动 native/runner/push。

修订记录（2026-09-24，S1 最终验证）：新增 resourceLedgerIncomplete 保护，资源登记拒绝后的未知责任不被旧账全 released 掩盖；新增第32组后最终32/32、typecheck复跑通过，既有bridge通过，前31组和17/22/25阶段结果保留。登记修正和新组另经只读复核；两树统一静态通过，首次将总设计第6节当前导航误计为不可变历史的检查失败及分类纠正保留，未改文档迎合检查。S1文档收口勾选完成，不接业务、不运行native/runner/push，下一步仍为先冻结S2零PTY异步启动链的有限目标与安全清理。

修订记录（2026-09-24，S2异步通道与有限验证）：按生产接入设计第14节实施真实transport/provider channel，父侧资源证明、正常disconnect、未发送start的失败退役及close pending控制准入窄修同步；只有全部已取得资源已释放才允许退役，ENOENT不等于未取得transport。Linux/Node v25.6.0普通pipe七组首次7/7，无重跑；8次provider尝试/7个实际provider/4个subject/8次transport close分别记账。adapter35/35、channel纯回归1组、typecheck、bridge、两mjs语法及fixture独立strict最终均exit0，独立只读复核无本切片确定性blocker；后补四项deadline hook与一次期限snapshot参数检查不创建child，不追改首次矩阵。首轮类型/断言失败、旧S1 32/32与原生历史全部保留；统一文档静态检查通过，首次S1导航正则漏匹配误报及纠正见验证与验收。零PTY、无native addon、无现有业务接入或runner/push，不关闭PI-01/02/03与产品验收；下一有限项先冻结Linux真实PTY的读取/解码预算、资源责任与安全停止，复用现有证据，不扩通用工具或全量矩阵。

修订记录（2026-09-25，S3准备与零调用构建）：第15节冻结Linux单owner WNOHANG、无wait线程/TSFN、4096B单槽及两个有限场景。主树新增native owner与精确副本构建入口，资源协议adapter38组/channel1组、provider core2/2、source静态断言组1、bridge与最终typecheck通过，首次构建/零调用load通过；预算估算空text初始化问题及poll/read失败分类已在首次运行前修正，不追认旧产品故障或先红后绿；真实PTY尚未运行，provider与测试继续复核。同步当前目标、四活章节、命令、证据及接口，保留S2/S1和所有原生历史，不以准备完成宣称产品通过。无现有业务接入、runner或push，不扩通用工具；两项真实验证和最终文档静态结果待实际完成后记录。

修订记录（2026-09-25，S3首次真实失败）：Linux/Node22.23.2首次两个真实PTY场景均被Control send failed阻断，0/2，未重跑；normal exit7/readBytes2108、flood signal15/readBytes73472，报告allOwnershipSettled=true、cleanup safe/steps=[]且两个provider关闭。资源安全不能替代场景/整体验收通过；当前仅有限纯定位正常关闭/父consumed ACK候选竞态，根因及修正效果待确认。保留首次工件，不自动重跑、runner/push或扩工具/矩阵，不接现有业务，PI-01/02/03和产品总债务仍开放。原始证据在.debug/s3-linux-provider-first，修正/纯验证与最终收口待实际结果补齐，不追改运行前准备和S2历史。

修订记录（2026-09-25，S3握手修正纯验证收口）：首次真实两项保持Control send failed/0/2，normal首次unknown/迟到released和原始工件不改。代码链确认关闭/信用发送竞态，但首次trace缺失败消息类型；新增sourceEndAccepted显式确认，排空旧在途发送后才能正常close，不等消费、不吞真实发送错误。首败后Node22 adapter43/43、channel6/6、provider core2/2、source断言组1、既有bridge、全typecheck及两fixture独立strict均通过，执行会话已结束；独立只读复核无本切片确定性blocker。离线normal2108B精确/终态重建与flood73472B全x不代替未执行的首次live断言；首跑前38+1与旧历史分开保留。没有修后原生采集；下一阶段仅冻结新输入/新目录复验相同两个场景，不扩矩阵/工具或自动runner/push，不接现有业务，不关闭PI-01/02/03或产品总债务。两树统一文档静态检查及8份mjs语法检查通过，按已完成事实同步当前导航和四活章节；首次0/2与历史证据保持。

修订记录（2026-09-25，S3修后输入冻结）：新增第15.8节与本计划四活章节的采集准备；仅增加新目录参数，同一native二进制经来源核对后复用，第一次18文件归档摘要留存。先提交输入再执行相同两场景一次，当前尚无采集结论，不扩工具或修改验收判据。

修订记录（2026-09-25，S3修后唯一原生采集）：输入3f8ebcae、新目录source-ack-first、相同normal/flood各一次，exit0/2/2。独立核对9份源码、原始输出/live终态/serialized/资源，首次18文件逐项不变；新2/2不覆盖首次0/2。normal单帧不代证UTF-8跨read，flood实际provider释放晚于最终消费，证据边界已同步。仅新增目录参数，没有修改主体、断言、预算或native；本轮不重跑全量或上一阶段纯矩阵。更新四活章节、当前导航与证据位置；下一阶段仅收口Linux最小接入条件，不扩异常崩溃全矩阵、工具或自动runner/push。 两树统一文档静态及diffcheck通过，本轮有限采集收口，整体计划继续active。

修订记录（2026-09-25，S4无native接线收口）：主树在实际`RuntimeSupervisorServer`与`CanvasPanelManager`入口接入共享`ExecutionOwnerLifecycle`，只允许显式non-native依赖注入；默认路径、旧live绑定、PTY/native工厂和协议保持不变。reserve位于首次异步准备前，关闭先封准入并保留在途责任；owner在seal尾值消费完成后才调用真实tracker最终flush，unknown、reader取消/失联和旧身份迟到回调不被清map或替换映射掩盖。定向结果为owner lifecycle 13/13、adapter 53 cases、Supervisor wiring 11/11、Host wiring 5/5，既有bridge/tracker/paged/protocol回归及workspace typecheck通过；未启动PTY/native/runner。一次Host宽tracker fixture产生未决顶层await，已移除而不修改业务断言，保留窄入口测试，不把该路径写成通过。S4仅完成L-01无native接线切片；L-02最终reader ACK、L-03 native失联处置与预算、L-04生产能力分流和reset/clear完整UI整链仍开放。

修订记录（2026-09-25，S4实际接线补验）：从c1b6bc8b补Host19/19与Supervisor13/13，修复checkpoint await后失效socket/替换session被重新登记；共享owner/adapter及Linux bridge/tracker/paged与typecheck通过，两个专项交叉复核无本切片blocker。保留新增回归首红和ENOTEMPTY清理失败，补等待journal.flush；Host历史exit13无法精确归因，不追认旧5/5覆盖收尾。纠正前轮protocol回归实际启动旧PTY却被记为零PTY的范围错误，见生产接入18.2；本轮无PTY/native会话、runner或push。同步四活章节、下一有限reader接收端及证据边界；真实UI/落盘、Webview最终ACK、本地完成屏障、native失联处置/预算和生产能力分流仍开放。
