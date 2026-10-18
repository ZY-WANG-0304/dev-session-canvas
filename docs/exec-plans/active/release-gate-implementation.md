# 实现分层 CI 与同批双包发布门禁

本 ExecPlan 是活文档，按 `docs/PLANS.md` 维护。实施依据是已选定的 `docs/design-docs/release-gate-redesign.md`，不是旧 workflow 的字符串断言。

## 目标与全局图景

普通代码 PR 应实际执行基础及功能检查；发布 PR 和最终 tag 应完整检查固定源码与同批主扩展/notifier VSIX。错误输入、缺 case、取消、清理失败和未经内容验真的渠道状态不能显示成功。所有结果绑定任务计划和实际执行来源，发布消费已经验收的文件，不重新打包。用户可以在具名 job 和逐 case 结果中看到失败阶段及保留现场。

本任务不修改版本、不合并 PR、不创建发布 tag、不向渠道发布。保留发布 PR327；实现、回归、根因和文档集中当前关联修复分支 `smoke-lifecycle-diagnostic-isolation`。用户主工作区的 `docs/WORKFLOW.md` 改动保持不动。

## 进度

- [x] (2026-10-18 08:49Z) 第七轮39112933251以真正预合并7e4d71fc/head0201c58f在resolve失败；API独立核双parents为main6e708c6b及该head。原错误为面板focus改动遗漏冻结helper摘要，17 jobs中1成功/3失败/13 skipped，业务任务未运行且无acceptance。重新生成并核123场景全部期限、wait表达式、倍数、parts和loop bounds不变，仅源码hash与行号变；新增真实源码校验及未审查改动拒绝正反例2/2通过。当前完整门禁/发布/恢复合同同批109通过/0失败/0跳过（161103ms），四workflow actionlint通过；后续新输入完整运行仍须完成。
- [x] (2026-10-18) 第四轮39097246318在真正预合并aa969012/headcdf40738结束：六native load/六有限操作、118源码Host、2 Marketplace Host、423功能/3视觉、source-build及一次clean双包通过，packaged103/104。实际247 jobs为240成功/7失败；全量330回执已采集，299满足验收，errors/notRun为空，整轮无acceptance。
- [x] (2026-10-18) 定因并修测试输入/观察：native回归改调用真实stager而非源码字符串；macOS同官方包plist入口Code；原安装CDP先连接再创建、固定nodeID、画布内完整resize、launch env receiver、按正式契约center/preserve/用户ack及独立locale。第四轮原包Linux公开全流程exit0，64×20→105×34、原进程Stop和两个Host正常退出通过；诊断acceptance=false，原双包前后摘要不变。
- [x] (2026-10-18) packaged文件点击原生产bundle event.view=null在minimal/card两个回归均复现，补齐测试MouseEvent所属view/坐标/buttons后2/2通过，连续文件打开及后续公开drag正常；生产drag未加容错、文件/分组/mounted断言保留。真实Playwright登记426→428，仅新增两个行为回归，原426没有删改，完整production425功能和3视觉同输入通过，冻结注册全量一致、基线不变。
- [x] (2026-10-18) 当前typecheck、native-assets完整链、vscode-runner环境、93门禁/发布/恢复合同同批通过，四workflow actionlint及结构合同通过。新增真实首败摘要修正只改善指向，producer红灯的成功task仍不能验收；新增首败摘要与严格验收/校准25项针对复验通过；冻结浏览器目录的425功能/3视觉同输入完整复验通过。
- [x] (2026-10-18) 第五轮39101493143以真实预合并7375f4a1/head2c4a16af结束失败，parents核为main6e708c6b/head2c4a16af。247 jobs为239成功/8失败；330 actual、324 required、318 required passed，324 total passed包括6校准项。三固定宿主metadata下载、源码文件视图及macOS/Windows原样安装失败，errors/notRun为空，无acceptance。source115/118、packaged103/104、六native、三regression分片、425功能/3视觉及Linux原样安装同批通过。
- [x] (2026-10-18) 第三轮39095480885在真实预合并612a891c/head924cae96完成：六load/六有限操作、118源码Host、两个Marketplace Host、423功能/3视觉、三regression分片及source-build同批通过；隔离双包一次构建/checkout退役通过，后置文件清单错误依赖外层dist而失败，packaged/三安装未运行。聚合另拒Windows原回执反斜杠；整轮失败/无acceptance。
- [x] (2026-10-18) 选定同批原包dist私有提取+真实production stager/vsce ls+原ZIP双层检查，外层两dist均不存在的源码夹具诊断通过；原包hash不变/无新build。Windows证据路径在producer序列化，原历史回执不重写；原路径拒绝及原hash对照通过。最终gate62完整批次与release29独立批次通过；四workflow actionlint及结构合同通过。

- [x] (2026-10-17) 核对正式设计、工作流及工作区；实施工作树起点3fbae6a9、远端main6e708c6b；用户主工作区dirty WORKFLOW保持不动。
- [x] (2026-10-18) 实现唯一任务目录、冻结计划、逐task回执、严格聚合及实际GitHub job/ZIP/artifact绑定；普通PR基础必跑，保守追加全部功能/产物，发布两阶段完整范围。
- [x] (2026-10-18) 新增15个reusable job和六发布外层job；共享production浏览器构建、同批clean双包、消费式packaged、三x64公开驱动及原包恢复/父状态链接线完成。四workflow actionlint和配置契约通过；实际Actions已运行四轮，完整验收尚未通过。
- [x] (2026-10-18) 实际423前端功能、3视觉和Marketplace浏览器通过，未修改baseline。先前浏览器下载超5分钟失败保留，后续本地使用实际核对的Chromium1217缓存，不追认冷下载通过。
- [x] (2026-10-18) 完整登记80项regression同批80 passed/0 failed；此前78/80及codicon服务/runner drain首败保留。合同已增至80项并同批通过；新增有界证据3项专项通过，最终全合同复验83 passed/0 failed/0 skipped；收口后策略摘要及证据路径变更需针对相关模块复验。
- [x] (2026-10-18) 独立目录落实102product-case、13默认因果suite和3focused诊断；source115+3辅助，packaged104，Marketplace Host2。152设计目的地137 implemented-unverified/15 not-implemented，旧22 routes/真实helper注册/AST可达及因果step检查通过，不将静态结果当验收。
- [x] (2026-10-18) source生命周期/链接/压力30项首跑29通过，mounted/actual-fit夹具修正后URL单项通过；trusted独立71项首跑69通过，Note mounted/systemd短路径修正后单项通过。旧产品等待不增加，原断言含义保留，旧dist/native诊断不计新SHA。
- [x] (2026-10-18) 原身份/退役与全目录resize guard精选16项、旧代/多窗口和本地/systemd重开诊断通过；Crashpad残留pipe已用禁用crash reporter单变量验证，Host/进程drain断言保留。
- [x] (2026-10-18) Remote SSH固定官方三依赖包/hash，显式extensionEnvironment、XDG_STATE_HOME短socket及零节点cleanup观察修复。两种原Host退出/保留在第四轮同批2/2实际诊断通过，原Host/Supervisor/离线完成/resize/cleanup齐全。
- [x] (2026-10-18) Marketplace两个Host夹具修复：复用共享私有TMP路径，preview显式zh-cn并stage语言包；第三轮2/2实际诊断通过，原中文/HTTP/页面断言保留。
- [x] (2026-10-18) 工件改为有界必要证据+内容清单，拒截断结构化文件、篡改、超限和超时；活动local checkout拒并发复制/删除。真实SSH现场导出42文件/461626bytes，未包含依赖缓存/私钥；专项3/3通过，workflow契约/actionlint通过。
- [x] (2026-10-18) 主实现455a494f及首轮夹具修复4c3fa9bf已fetch/rebase后推PR335；真实预合并首轮39093713215和第二轮39094300198均有实际job/工件证据。第二轮三regression分片、输入、production前端/视觉、Marketplace浏览器和Linux/macOS四native通过，六native-load均通过。
- [x] 第四轮已真实验证前次有界HTTP、Windows两架构OSC终端正文、production CSS数值、同批原包文件清单和Windows引用路径修正；六native操作通过。原15秒等待、几何/退出/清理及production构建保留，未追认历史失败。
- [x] 第四轮六native load/有限操作真实同批通过，minimum load不外推产品能力。
- [ ] 三x64原样安装的新输入真实验收及固定环境/基础设施上限校准；渠道只做本地受控测试，不实际发布。
- [x] (2026-10-18) PR3352c4a16af+PR3278313fc72临时组合以真实预合并a450a724运行39101774719后失败，parents精确为main6e708c6b及组合head56d54377。247 jobs为243成功/4失败，330项全部required/328 passed，仅macOS与Windows原样安装失败；118 source/104 packaged和全部基础层/六native同批通过，无acceptance，不追认其他轮次。
- [x] (2026-10-18) 第五轮原包受控焦点竞态先红后绿：按原URI/ViewColumn的唯一公开Tab关闭，保画布及split断言；真实输入补中心命中/禁用/遮挡及完整primary pointer。当前production完整文件视图诊断通过并核原Host退出/目录退役；输入是当前工作树+旧native，acceptance=false。
- [x] (2026-10-18) 当前最终105合同同批105 passed/0 failed/0 skipped；typecheck、vscode环境、四workflow actionlint/结构合同通过。真实注册428→429原428完全保留，production426功能/3视觉通过，baseline不变；123 suite timeout逐项与上一head相同，文件视图1083000ms，installed几何仍共用原20秒。
- [x] (2026-10-18 07:49Z) 当前实现47bd74e6已fetch/rebase后推PR335，第六轮39108395021的真实预合并a62e5d7e已核精确parents。当前head与未改PR3278313fc72真实组合c9d5ed48，静态0.26.1 preflight通过；最新main6e708c6b与组合head生成精确双parent输入e65e06ff，临时完整run39108780795启动。两计划均330tasks，普通PR324required、release-pr330required。
- [x] (2026-10-18 08:24Z) 第六轮39108395021终态247 jobs：241成功/6失败，330 actual、324 required、326 total passed（其中六校准操作），320 required passed；四业务失败为source runtime-mode/reload-clear、source file/views、macOS与Windows installed。其余两个失败是严格aggregate/稳定检查；Linux安装、104packaged、六native和全部基础通过。原aggregate artifact12130017065已绑定真实producer/hash下载，errors/notRun为空，无acceptance。
- [x] (2026-10-18 08:24Z) 当前0.26.1组合39108780795终态247 jobs：243成功/4失败、330全部required/328通过，source118/packaged104、六native与全部基础通过，仅macOS/Windows原URI确认交互失败。原aggregate artifact12130497656和两安装工件已独立绑定producer/原ZIP/hash；未签发acceptance，不将两轮结果互补。
- [x] (2026-10-18) Windows/macOS真实原resize与Stop通过；真实VSCode确认对照证明需公开URI命令和确认框并行，使用宿主公开Uri.toString的完整title核原token，复选框不记忆。受控不存在token诊断的确认/派发/Host退出通过，acceptance=false；原通知token与三平台正式链仍须新head验收。
- [x] (2026-10-18) source file/views原probe证明panel文档缺focus；当前production+旧native对照只补公开panel focus，完整file/views与原Host退役通过。原10秒准备、稳定矩形/实际命中/一次primary pointer和file/split/reader断言保持。
- [x] (2026-10-18) 原生产方法四条路径确定性复现mode-switch删除期间新callback拒绝及缓存失败，正式产品责任已记录；不改产品、不对smoke加sleep/retry，不全局扩大drain。macOS原kill EPERM无syscall/对象/栈，新增清理阶段和原group/signal取证及两个失败反例，保严格EPERM失败与原期限。
- [x] (2026-10-18) 最终门禁/发布/渠道恢复合同同批108 passed/0 failed/0 skipped，158845ms；四workflow actionlint、语法/diff检查通过。原第六轮candidate artifact12128899187完整原bytes下载并核GitHub ZIP hash d509e627及包回执2e749efb；原6MiB串行传输60秒失败保留，改为原同五分钟内有限不重试的非重叠range读取，最终摘要/ZIP严格核验保持。仅本地取证transport调整，生产collector没有变更。
- [ ] 新head完整CI及最新PR335/PR327组合正式验收；全量原逐task来源下载需收齐。runtime-mode生产边界与旧代恢复撤销订阅竞态均未修，发布阻塞不能由本轮偶发绿灯解除。

## 意外与发现

最新组合39108780795和第六轮39108395021已终态，分别328/330与320/324 required通过，aggregate和稳定入口按预期拒绝。原source mode-switch在三delete期间接纳此前发出的空输出batch并启动保存，84ms内拒绝；生产deactivation也先mode cleanup再关event admission。shared/non-shared ×模拟reload/真实生产deactivation方法受控对照全复现同拒绝，并在callback归零后仍复用失败。该产品问题不通过测试等待修复；根因/脚本/hash集中原实施目录，正式边界写入runtime-shared-root-canvas-sync.md。旧独立Host逻辑脚本直接运行先因未提供appliedStartupConfiguration失败，未计为通过，不从该过时夹具外推产品结果。

原两平台URI确认是实际VSCode DOM `.rendered-markdown [title]`，并无URI aria-label；title采用公开Uri.toString的编码（query等号与与号已编码）。最初假定aria-label的诊断失败保持，改用独立driver的只读describeUri后原Host确认/派发/退出通过；原token产品回跳仍待新head正式运行。文件panel focus对照通过，不把居中或selection代证文档focus。macOS附加清理原报告只有kill EPERM，当前补阶段/stack/code/syscall/原group与signal，受控反例保首败及停止进一步信号；未认定原权限原因已修。

第六轮原Windows工件12129119465和macOS工件12129488250独立核actual producer、原ZIP hash和内容清单。Windows同PID几何70×22→132×42、macOS64×20→97×31，原Stop和receiver已通过；新超时在run-installed-pair.mjs:232的vscode.open，原两截图是Notifier原URI授权框。固定宿主源码确认命令等待用户输入才完成，外部driver不得先await命令再处理UI。本轮先记录正式修正为并行真实Open交互，完整callback匹配、复选框不记忆、共原20秒。macOS附加kill EPERM保持独立未定因清理失败，不以补交互追认原轮成功。

第五轮参考JSON把回执原文件字节SHA误名为packageReceiptDigest。本轮从原文件复算规范化objectDigest为f789de317ead2c647777a2c49fac2d478cf853c03dc6e34c77a3e62472d7de27，原文件字节d5305c8e保留为packageReceiptRawFileSHA256；正式原collector中的规范化摘要始终正确。这是记录字段修正，不能重写原正式回执或追認原轮acceptance。旧0.26.1组合330tasks全部required，移除误继承普通PR六校准项的说明。

续查本地入口发现Git2.34.1不支持`git merge-tree --write-tree`，实际私有Git fixture正常合并先红；不是产品代码故障。选定私有clone/index真实merge，冲突不得创建候选commit或挪动原refs，错误记录冲突路径。两个真实Git回归分别核两侧内容和精确parents、真实冲突及原refs不变；精选三项和完整门禁/渠道/恢复合同96/96实际通过，完整日志为`/dev/shm/dsc-ci-local-premerge-full-contracts-1.log`，0failed/0skipped，144313ms。

第五轮原macOS Host安装后主IPC路径超过103字节，激活前`listen EINVAL`；Linux源码内置agenthost也记录TMPDIR长socket。选定完整socket路径预算、短私有runtime/user-data/TMPDIR、先导出后回收，保真实IPC与bus环境。Windows同一原子进程cached70×22不能证明实际ConPTY未resize；选定由公开输入nonce触发同一fd当前OS尺寸查询，保PID、UI动作和期限。三case在固定宿主metadata下载连接超时而Host未启动，选定同原五分钟deadline内至多三次已识别网络重试，非法版本/归档校验及产品失败不重试。有限下载恢复与semantic拒重试、同fd几何及原身份反例、真实短目录退役均在105合同批次通过。reporter后的真实固定缓存CLI也通过；冷网络恢复和macOS/Windows仍须新Actions，不用Linux诊断外推。

第四轮真正预合并aa969012478b280e3e7595257f64a7fe124f33f2已独立核parents精确为main6e708c6b及headcdf40738。package-clean原双包各build1、正式transfer artifact12125466855/原ZIP86937a58上传成功；Windows证据路径修正使all provenance errors为空。失败为regression固定stager源码字符串、darwin官方入口改名、Linux/Windows CDP漏内层frame、packaged文件点击；聚合和稳定检查正确拒绝。330task中的31失败包含regression分片producer红灯连带拒绝，不能把typecheck误写为原失败。

原样安装公开流程实跑逐步确认：旧持续.last随新Terminal改变目标；固定bottom-right拖出frame，缺mouseup；VSCode登录shell覆盖receiver PATH；通知回跳按规格不自动ack；中文重开restore先于CDP；Stop名称来自button可见span而非aria-label。当前修正全部在夹具/launch准备，Linux原包全流程通过，正式macOS/Windows与新批次仍待验。

packaged原失败trace的production bundle行/列指向d3-drag nodrag(event.view)，event.view为null。原包浏览器行为回归在minimal/card均实际失败；修后私有production build两个回归通过并保后续真实drag，不改产品click/Host打开文件或d3监听器。浏览器观察尚不能代替完整Host visible editor/split group后置验收，新head仍须实跑该case。

第二轮39094300198证实首轮工件文件名/浏览器依赖修复生效。source-build/package-clean仍被新版gh的ANSI日志终端保护阻断，未进入业务构建；有界HTTP采集已实际读取首轮六archive并核actual job/上传ID/原ZIP hash，保留首轮取消事实，不签发验收。超限HTTP响应在Node22可销毁已经detach错误listener的socket，导致未捕获异常；现显式reject后无Error销毁，超限/原deadline反例通过。Windows x64/arm64实际输出均含独立GATE_IO正文，其前方插入OSC窗口标题；raw换行比较漏判，采用锁定xterm终端cells观察，保留有序批次、sealed flush、回显/标题/wrap反例。Linux旧asset诊断完整有限操作通过，Windows新head实跑仍须验证。

第二轮webview-function实际422/423，唯一失败是CSS变量字符串".82"与"0.82"比较。production minifier合法删除leading zero，视觉/实际样式不因该序列化改变；修正为完整Number转换后精确0.82语义检查，保留其他16px/3s/clip/层级/颜色断言和固定截图。不能为了旧测试把真实production前端降为development。

2026-10-18 续跑已收齐完整80项regression同批通过，以及Remote SSH原Host退出/保留两态、两个Marketplace Host的新包装器诊断通过。实跑发现原工件路径复制了node_modules与完整宿主缓存：30个case约33GiB，SSH两态约3.6GiB，必要Host回执与artifacts仅数百KiB。本轮按正式设计补有界证据导出与ZIP内容验真；依赖缓存不当作失败现场，结构化证据不得截断，取证缺失或超限保持失败。本地run-local的finally也必须先确认原执行settle，不能无界fs.cp/fs.rm活动checkout。

旧普通 PR 没有契约时实际跳过验证。旧 clean、packaged、publish 分别打包，最终发布文件没有绑定已测试文件。当前 build 同时清主 dist 并要求六资产，不能作为独立前端 job。旧 finalize 可以用历史 verified 覆盖本轮失败；这些行为必须通过真实程序负例关闭，不能靠放宽测试或设计模型证明。

初版 review 发现需要在接线前关闭的错误：reusable 整体 failure 不能直接代表普通 PR 校准操作失败后的最终验收；aggregate 必须独立完整验真并输出可信 acceptance。构建取 native-load 时不能同时要求无依赖并行 job 已结束。任务 deadline race 不能先开始 cleanup 再等待子进程回收。installed driver 不能读取不存在的 Extension.extensionMode、使用错误的内部命令或将 finally 强制终止冒充正常 Host 退出。

发布初稿审查还发现prepare没有初始可恢复manifest、finalize在notes更新前删tag、末次提交后的查询异常漏写完整回执，以及来源schema未逐项约束。现已补齐真实pending/failed状态、先状态与notes后cleanup、unknown查询和run/attempt/原内容反例。mutable状态文件替换前保存按内容摘要命名的不可变副本；尚需验证原Release恢复与真实Actions流程。本地入口初稿的native工具链/六资产接线和diagnostic筛选不完整，不能按该入口宣称全量验收。

现有 gate-runtime-state 已改为读取真实 registry.sessions；错误 entries[].sessions 结构会失败，不能把未知状态当资源为空。本轮共享浏览器构建及全部 423+3 用例已运行通过。固定浏览器下载曾触发 5 分钟上限并失败，后续仅使用经实际版本核对的既有 Chromium1217 缓存做本地验证，下载失败证据仍保留。VSCode1.142.0 下载成功并核实际 app 版本。Linux native 操作仅用旧资产诊断通过，不作为新 SHA 或六平台验收。Host已有多项当前工作树/旧资产诊断；包、installed和新Actions尚无本轮正式完整运行证据。

URL/OSC8 首次独立失败有真实 CDP 调用证据：页面已稳定为 64×20，旧 helper 却以 92×28 Start；snapshot restore 临时 resize 为 92×28，随后 deferred fit 恢复 64×20。鼠标已进入正确单元，URL provider 与 hover 均实际执行，但第二次 resize 触发 xterm linkLeave，取消尚未显示的 tooltip。修正只在测试夹具：用原 10 秒 probe 等待已 mounted 且 projection 完成的实际 fit 几何，再以该几何 Start。tooltip 文字、清 hover、浏览器路由和 OSC8 断言及原等待全部保留，未改产品行为。`/dev/shm/dsc-ci-url-inspection-7/dom.json` 中的 buffer-resize 调用栈保留取证；复验 17 秒通过。

## 决策记录

决策：预算源码变动后在提交前显式重生成并审查清单，本地门禁合同与正式resolve都核真实源码；不在正式CI自动修摘要。
理由：第七轮正确拒绝漏更新的helper hash，原完整108合同没有调用该校验导致本地漏报。新正反例直接调用原模块，当前源码成立、同副本追加未审查内容立即失败；123预算逐项不变，不能借更新hash暗改等待。
日期/作者：2026-10-18 / Codex。

决策：公开通知URI确认与vscode.open并行，核宿主公开Uri序列化的完整title/原token和默认不记忆选项；panel文件点击显式执行公开view focus，全部共用原20秒/10秒。清理增加真实阶段、syscall/栈及原group/signal，权限错误仍失败。
理由：两个原平台截图和实际VSCode DOM证明缺少用户确认；source原probe证明panel矩形稳定但document无focus。真实受控对照补前提后通过，产品功能、原包、原断言与等待不变。EPERM原现场不足，只补必要取证不能追认已解决。
日期/作者：2026-10-18 / Codex。

决策：保留runtime-mode/reload-clear原业务时序与预算，生产mode-switch回调边界列为未修阻塞；CI改造不扩大全局drain或增加静默/重试。
理由：原生产deactivation与模拟reload共用mode cleanup，四受控路径在delete之后接纳callback均拒绝，回调归零仍缓存失败。首轮wait不是准入封闭保证，不能归为仅夹具问题；严格delete/其他root/接管和既有普通reset立即拒绝责任需产品修复单独满足。
日期/作者：2026-10-18 / Codex。

决策：文件点击等待焦点、可命中且稳定的矩形，在同一原10秒期限发送一次完整primary pointer；不附加selection要求。短路径显式传原settings路径，全部重开日志按session保留。
理由：当前production Host首跑证明动画中probe后矩形改变；第二次独立运行错误要求selection而超时，外部DOM记录target已居中/可命中，旧多选仍在。移除错误前提后完整文件视图及原Host/reader/短目录退役通过，未改产品打开/drag或业务上限。先失败的两目录和外部trace保留，只作为诊断；正确scope是当前源码production+旧native，非正式验收。
日期/作者：2026-10-18 / Codex。

决策：文件清理按原URI/ViewColumn和唯一公开Tab身份关闭，不再激活文件后关闭active editor；原20秒resize期限覆盖UI变化和fresh同fd观测，不逐步重置。
理由：真实VSCode与第五轮原包的受控公开焦点切换已复现旧助手误关Canvas，原目标文件仍在。`/dev/shm/dsc-ci-file-close-focus-before-2/public-tabs.json`记录原tab消失及目标文件移到第一组，exit1；首个诊断由于枚举VSCode proposed API getter而失败，不属于产品根因。新的关闭回归保焦点竞态和未确认关闭负例。文件点击实际矩形/焦点/中心命中和完整primary pointer补齐，稳定观测仍使用原10秒，不删split/mounted/reader断言。
日期/作者：2026-10-18 / Codex。

决策：本地从私有clone冻结base执行真实index merge，正常才commit-tree并核两parents；真实冲突直接失败，不用新Git专用merge-tree模式或选择一侧源码。
理由：实际本机Git2.34.1先红证明现入口无法生成正式预合并；与临时组合的真实merge流程一致，且不改变产品断言、目录和等待。该局部修复须真实正常/冲突负例验证，不能外推跨平台完整acceptance。
日期/作者：2026-10-18 / Codex。

决策：修正实际fixture准备和输入，不改产品行为以获得绿灯。独立driver激活握手后连接CDP，再用公开命令创建；固定nodeID和真实可用的画布内resize路径；用launch flag保receiver环境而非activate后修改env；通知center/preserve/用户ack按正式规格验证；locale独立重开，读取真实可访问名称。
理由：单变量原包诊断和公开全流程已证明上述前提错误。原包、真实PTY几何、原进程/Host退出、产品等待和原断言保持，不能从Linux旧包推定新head三平台验收。
日期/作者：2026-10-18 / Codex。

决策：MouseEvent测试helper补所属document.defaultView及真实坐标/buttons；补原包先红后绿行为回归，真实Playwright新增两个注册项，其余426完全保留。聚合首败优先选实际task failure，不把失败producer中的成功兄弟task误写为根因。
理由：原生产bundle及锁定d3-drag源码、原包两个视图的实际pageError一致；缺view是不完整测试输入。聚合改摘要不放宽producer失败判定和acceptance，仍须完整新head和PR327组合验证。
日期/作者：2026-10-18 / Codex。

决策：候选文件清单测试从已验原双VSIX提取私有dist，真实stager增加显式dist输入；保留staging/vsce ls与生产ZIP两层检查，并复算原包摘要。
理由：第三轮39095480885的隔离production双包与清理均成功，后续测试读取设计上不存在的外层dist而ENOENT。额外build、借development产物或跳过原staging检查都会违背同批包和验证责任。真实预合并612a891c的parents已通过API核为main6e708c6b及head924cae96；失败producer包只能诊断。
日期/作者：2026-10-18 / Codex。

决策：任务证据引用在producer写入时使用`/`序列化，系统文件访问保留native路径；下载后不改回执，验证端继续拒反斜杠/越界。
理由：第三轮Windows实际task引用反斜杠而manifest使用`/`，全量聚合因此失败；两个原引用规范化后均对应原清单source hash。历史失效回执不追认，修正后的新producer仍需真实完整运行。
日期/作者：2026-10-18 / Codex。

决策：先增严格入口和回执，再接线消费者；第一阶段旧suite作迁移适配器，保留19/8/3入口的完整覆盖输入。当前已按独立fixture迁移至102独立case/13因果suite/3focused，原assertionReview与22 routes映射保持可查。
理由：新场景目的地尚未全部独立验证，不能为了拆 job 删除隐含断言或把计划清单当执行证据。
日期/作者：2026-10-17 / Codex。

决策：环境不可用、产品动作失败或签名内容口径未知保持失败/未验证。
理由：用户明确要求不为适配代码使用错误 CI。固定版本、原样安装和真实几何检查不能退化为 stock、manifest 改写或只看版本。
日期/作者：2026-10-17 / Codex。

决策：第一阶段逐旧suite matrix，后续落实逐独立case/因果suite matrix，保留hostGroup与原断言含义；从真实 helper 等待及有限循环提取并冻结预算，不以任意倍数冒充已评审业务上限。
理由：trusted 组保守等待清单累计约 321 分钟，加基础设施后单 job 接近 347 分钟；逐 suite 可定位失败且不放宽原业务等待。动态循环界限及运行时消耗继续实测核对。
日期/作者：2026-10-18 / Codex。

决策：每case或因果suite私有Host先证明隔离，不共用前一个case业务状态；需要复用Host时再提供成本/隔离证据。trace/probe/控制输入完整导出，依赖/宿主缓存与SSH私钥排除并写明；日志有限区间和原hash显式保留，取证异常使真实producer失败。
理由：本地实跑出现数GiB重复缓存及长socket，错误工件收口本身会阻塞；不能以删原产品断言或延长业务等待解决。local未settle拒并发复制/删除，失败现场保持可恢复。
日期/作者：2026-10-18 / Codex。

决策：GitHub来源采集直接读有界HTTP原始字节；Windows和Unix有限操作统一用锁定xterm parser观察完整逻辑行，原实际几何输出必须精确匹配。CSS数字变量按完整数值比较，不按minifier的文本拼写。
理由：实际两轮Actions分别证明gh终端保护、ConPTY OSC和production数字压缩属于采集/观察问题；保留原产品动作/期限、来源绑定、独立正文及错误几何反例，不能用宽includes、版本可见或dev包替代。
日期/作者：2026-10-18 / Codex。

## 结果与复盘

第六轮与当前0.26.1临时组合均已终态失败：组合330必跑328通过、完整source118/packaged104均通过；两平台真实resize与Stop已通过，安装失败转到URI用户确认。第六轮另有source panel焦点准备和runtime-mode迟到回调失败。公开确认与panel focus已补并有真实受控诊断，原预算/production输入保持；新head全量尚待验收。生产mode-switch边界与恢复订阅竞态未修，不能发布0.26.1。

严格入口、真实浏览器配置和 reusable 任务图已有初版及部分行为验证，尚无新 CI/产品完整通过。设计模型验证不是实施验证。每一阶段完成后在此写实际命令、结果和剩余边界；最终发布输入完整通过前不宣称 0.26.1 可以发布。2026-10-18 再 fetch 后 origin/main 仍为 6e708c6b93ce4b2b343729c422f59099f4fb42ba，用户主工作区 dirty 文件未动。

## 上下文与定向

工作目录为 `/dev/shm/dsc-restricted-ready`。`.github/workflows/release-preflight.yml` 是 PR 入口，`publish-marketplace-release.yml` 是发布入口；新 `ci-validation.yml` 承担复用任务图。`scripts/build/build.mjs` 负责主扩展/原生 provider/browser，`scripts/release/package-vsix.mjs` 负责 staging 和 VSIX。`scripts/smoke/run-vscode-smoke.mjs` 和 `run-vscode-vsix-smoke.mjs` 是现有 Host suite 入口。`scripts/gates/` 为本轮新增的任务图和执行器目录。回执是实际动作执行后写出的身份与阶段结果；计划只声明必跑集合，不能证明运行成功。

## 工作计划与里程碑

第一阶段新增 `scripts/smoke/smoke-catalog.mjs` 和 `scripts/gates/{catalog,resolve-plan,receipts,verify-result}.mjs`。固定完整源码 SHA、base/head、环境/规则/预算摘要及 run/attempt。普通 PR 保守分类，版本或契约变动强制 release-pr。正式入口拒绝筛选、跳过、stock 和空任务；按计划阶段写真实退出结果。聚合独立核对 GitHub job/artifact 来源、完整 task+variant 和包摘要。反例必须调用生产模块，错 SHA/hash、少 case、重复、未知、取消及 cleanup 失败都不能生成 acceptance。

第二阶段新增 `scripts/release/build-release-candidate.mjs`。从 git archive 固定 SHA 创建隔离 checkout，npm ci，按六资产/profile/production admission 构建主/notifier 各一次，固定输出 main.vsix/notifier.vsix/包回执。packaged runner 只消费原双包、在副本 instrument 并列变更清单；独立 installed driver 无产品测试模式，三 x64 系统验证公开入口。统一 `scripts/release/release-completion.mjs`，渠道 absent/present/unknown 与内容 match/mismatch/unknown 分开；未知先查询，不重发，历史复用仅在原包恢复的明确策略允许。

第三阶段从 build 提取共享真实浏览器配置到 `scripts/build/build-browser-assets.mjs`。基础层不等待原生资产，development 与 production 在独立 checkout 构建。复用 workflow 分离输入、regression、frontend、浏览器、六 native、source、package、installed 与 always 聚合。六资产先上传 load 和 archive，再独立真实执行 I/O/resize/exit/Stop/cleanup；load 成功但操作失败可以继续取证，正式 release 仍失败。按唯一 smoke 目录运行具名旧 suite，分组不引入前一 case 的未声明状态。

第四阶段固定 Node22.23.3/VSCode1.142.0/锁定 Chromium 和视觉环境，基础设施与业务预算分账、Host 总期限有界。更新发布六外层 job 为 resolve/verify/prepare/两渠道/finalize，prepare 只消费验收包。普通 PR 与 main 接同任务图；稳定 required check 在实际 GitHub 设置未核实前不写已配置。保留每个失败现场、原始失败和附加清理失败。必要时使用临时 worktree 做发布 PR327 的组合验证，不另建验证 PR。

## 具体步骤

所有命令从上述工作目录运行。先用 `node --test scripts/test/test-gate-contracts.mjs` 等新增行为测试证明严格判定，再运行各现有具名回归及浏览器验证。使用 `npm ci` 安装锁定依赖，下载/缓存优先 `/dev/shm`。workflow 结构用 actionlint（可用时）及行为配置测试核验。原生和安装真实跨平台验收通过 CI 运行，当前 Linux 本地结果不外推其他平台。静态 preflight 可运行 `npm run release:preflight -- --version 0.26.1`，缺契约则只在含 PR327 的临时输入运行。

## 验证与验收

验收包括：普通代码 PR 计划选全部功能；错版本/删除契约不能降级；静态错误不等 native；regression 接全现有非 Host 检查；实际 suite 开始/完成事件形成回执；少跑或取消无 acceptance；只构建一批固定双包且所有消费者前后 hash 一致；packaged notifier 来自 VSIX；installed 主/notifier manifest/main 不变；真实 native 进程观察输入、几何与终止；渠道内容未知不判 complete。新 workflow 必须同时保留旧覆盖，不将新增未验目标记通过。最终发布验证需最新预合并输入完整运行，合并后的最终 tag 再独立运行，本任务不替用户创建 tag。

## 幂等性与恢复

临时目录、扩展目录、runtime socket 和结果按 run/attempt 隔离。失败的固定输出不覆写原 release，重试先验证已有包/回执再继续渠道查询。git archive 不包含工作区 dirty 文件；用户主工作区不 reset。推送前 fetch/rebase 目标分支，固定远端 head 的 force-with-lease；不 force push main。测试进程在期限后终止并保留现场，不能把清理成功改写成业务成功。

## 证据与备注

所有本地结果用固定Node22.23.3；native诊断用官方checksum核对的Node25.6.0。完整regression在/dev/shm/dsc-ci-regression-implementation-3/results.json记80/80通过；test:ci-gates当批80/80。有界证据三个新增正反例在/dev/shm/dsc-ci-evidence-contract-2.log通过；完整合同批/dev/shm/dsc-ci-gate-contract-implementation-6.log为83 passed/0 failed/0 skipped（129.5秒）；最终摘要/引用路径补充按相关项复验。

浏览器功能/视觉证据为/dev/shm/dsc-ci-browser-function-3和/dev/shm/dsc-ci-browser-visual。source独立30为/dev/shm/dsc-ci-independent-diagnostic-2，URL修后/dev/shm/dsc-ci-url-fixed-diagnostic-1；trusted71首败在/dev/shm/dsc-ci-trusted-independent-diagnostic-1。resize guard精选/dev/shm/dsc-ci-resize-guard-diagnostic-1；并发原身份/退役修后/dev/shm/dsc-ci-concurrency-remote-diagnostic-1。SSH最终2/2在/dev/shm/dsc-ci-remote-cleanup-diagnostic-4/results.json，两Marketplace在/dev/shm/dsc-ci-marketplace-host-diagnostic-3/results.json。此前每轮失败目录原样保留，不覆盖首败。必要SSH工件导出/dev/shm/dsc-ci-remote-retained-evidence-1已复算42文件/461626bytes。

旧六资产在/dev/shm/dsc-lifecycle-fix-evidence/formal-platform和formal-archives，本地Linux有限操作/dev/shm/dsc-ci-native-diagnostic-2仅诊断；不改inputCommit冒充新SHA。官方Remote SSH三包版本/hash位于scripts/smoke/remote-ssh-extension-inputs.json，实际下载核验完成。渠道/恢复正反例用本地HTTP/内存，不写真实渠道。四workflows actionlint通过。main保护API404 Branch not protected，尚无required配置，不能宣称远端阻断已成立。

docs/references/release-gate-redesign/verify.py是方案模型，mapping/AST是覆盖审查，均不代替实际CI和产品结果。四轮Actions已实际运行，第四轮clean双包通过且消费式packaged103/104通过，三原样安装仍失败。当前Linux原包安装诊断已全流程通过；新提交整批正式验收、生产恢复竞态及PR327最终完整门禁仍阻塞。后续证据集中既有references/实施目录并用实际SHA/run/attempt/hash记录。

## 接口与依赖

使用现有 Node、esbuild、JSZip、Playwright、@vscode/test-electron 和 GitHub Actions；无需新服务。`gate-plan.json` 定义任务和 producer 期望，`package-receipt.json` 定义固定双包，逐任务 JSON 由执行器写出，`verify-result` 仅在身份和所有必需阶段通过时写 `acceptance-receipt.json`。实际 GitHub provenance 由 API/artifact 元数据采集，不能接受未经核实的 JSON 自报。

修订记录：2026-10-17 创建实施计划，明确从正式设计实施并保留旧覆盖及未验证边界。

修订记录：2026-10-18 同步初版实现、实际 27 测试和共享构建验证；登记校准聚合、来源采集、deadline/cleanup 与 installed 接线错误，避免将配置测试通过误写为正式门禁通过。

修订记录：2026-10-18 补记 33 合同测试、423+3 浏览器和 Marketplace 实跑结果；区分下载失败、旧资产诊断与正式验收，修复 Actions 不支持的 job 级 runner.temp 表达式。

修订记录：2026-10-18 续记完整 regression 的实际失败与单项修复、46 项合同测试、独立 case 正在诊断验证和安装/Host 身份边界；保留旧资产不计新 SHA 的证据限制。

修订记录：2026-10-18 收齐 30 项独立诊断，登记 URL 失败的真实 resize/hover 因果证据及夹具修正后的独立复验；旧资产和当前工作树诊断仍不能替代新提交正式验收。

修订记录：2026-10-18 接续80regression同批、SSH两态/两个Marketplace Host及真实工件容量证据；同步102/13/3实际目录与137/15映射边界，补有界证据和local checkout settlement守卫，保留未验正式输入与产品阻塞。

2026-10-18 实际Actions首批run39093713215：head455a494f，真正预合并354e6129（main6e708c6b+PR head）。输入、production前端构建/视觉及Linux/macOS四native构建和有限操作通过。regression缺少sidebar-session-history浏览器预装，部分结果上传因task文件名含冒号被GitHub NTFS通用规则拒绝；已补显式锁定浏览器依赖及可逆唯一文件名编码，taskID和业务断言不变。Windows x64 native-load通过，finite I/O首个正文观察在15秒失败，原cleanup settled；首版回执漏raw输出，当前先补有限实际输出/批次/原身份取证，根因待实际样本，不降低原断言或延长产品等待。首批失败保留，不计完整验收。

修订记录：2026-10-18 接续两轮实际Actions，固定第二轮预合并040883c8/head4c3fa9bf，记录三regression分片/六load与四native操作通过及完整失败。HTTP原字节collector核首轮六实际producer，ConPTY终端语义观察和production CSS数值修复保留原动作/超时/反例；gate59与release29分开通过，后续clean/packaged/installed未触达仍须实跑。

修订记录：2026-10-18 接续第三轮完整终态及原双包hash，核612a891c精确parents；登记外层dist依赖和Windows路径序列化两项CI错误及修复，保留原失败producer/not-run/无acceptance事实。当前package无外层dist诊断、最终gate62与另批release29已核，下一提交正式同批验收仍须完整运行。

修订记录：2026-10-18 同步第四轮全部终态/330回执及同批原双包；登记stager行为、官方macOS入口、CDP/resize/receiver/locale公开安装前提和MouseEvent缺view根因、Linux原包全流程及两个原包先红后绿回归。静态登记与诊断无acceptance，新增首败摘要仍保producer严格失败判定；继续新head完整门禁和PR327组合。

修订记录：2026-10-18 收齐第五轮39101493143与0.26.1组合39101774719终态、330结果及独立parents；登记原包焦点竞态红绿、点击命中/动画与selection前提对照、当前production文件视图通过、105合同/429目录/123预算逐项不变、短路径及fresh同fd几何。当前head跨平台及更新组合继续待验。

2026-10-18 07:49Z更新：已推当前实现并启动第六轮和最新0.26.1组合，核原计划与双parents，修正参考摘要命名；正式终态和Windows新首败仍待收取，未修产品竞态不豁免。

修订记录：2026-10-18 07:55Z原两平台截图与宿主源码定因URI确认交互缺失，真实resize和Stop已通过；选定同原预算执行公开确认，不设信任白名单，macOS额外清理失败保留。
