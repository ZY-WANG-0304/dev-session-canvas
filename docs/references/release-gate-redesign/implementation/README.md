# CI 改造的实施与验证输入

最新状态（2026-10-18）：第九轮PR335 [39119709105](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39119709105) 终态失败，真正预合并6f802d43/head1a4c5ff8及精确main/head parents已核。247 jobs为243成功/4失败，330 actual、324 required、293 required passed、299 total passed；原aggregate独立绑定artifact12134557487、producer117658318149和ZIPebd1c796。31被拒来自两个失败producer的27个regression/4个浏览器task，真正首败是中文Stop合同二次时钟和覆盖快照pending时计数空缓冲。118 source、104 packaged、六native操作、两个Marketplace Host及三x64原样安装同批通过，errors/notRun空，无acceptance。

同head与未改PR3278313fc72的真实临时组合 [39119845747](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39119845747) 已247 jobs全成功、330 required/actual/passed。输入c2ef2a8c精确parents为main6e708c6b和组合e1cfb59f，双PR ancestry已核。原aggregate artifact12135230836/ZIP80741221和验收摘要7578d4c9已独立核实际producer，固定原head验证器核完整acceptance通过；同批双包producer/ZIP/包回执也独立下载验真。该批结果不追认第九轮PR失败，也不代证当前两处尚未提交的观察修正。

当前两处修正只改变CI观察。完整门禁/发布/恢复合同114/114、0失败/0跳过；登记430→432原430完整保留，仅新增Agent/Terminal真实parser暂停/释放反例。正确原任务预算下429production功能/3视觉全部通过、retry0、baseline不变，原进程组退役已核。当前production webview.js与第九轮原bundle字节SHA相同；旧即时严格计数受控先红，新完成观察及原严格一次/两次计数4/4绿。原40秒贯穿整个输出/快照/重复正文链，只读轮询原session/pending，不以正文次数驱动等待。

原三平台安装工件逐个独立核来源/ZIP/内容清单，productTestMode=false；真实I/O/resize、原进程Stop、原token公开确认/居中/selection保持/用户ack、en/zh及应用/Host正常退出和cleanup均通过。原第八轮ready/panel-focus、CIM具体阻塞机制和macOS原EPERM仍保留未定因；旧代恢复订阅撤销和生产mode-switch回调边界继续阻塞发布。新增修正提交后的PR335及最新PR327组合完整Actions尚待验收，不改版本/合并/tag/渠道。

本轮验证曾因grep锚定错误出现No tests found，因传错外层期限取消第一功能批，第一视觉批也不计作冻结预算验证；这些原记录均保留。取原aggregate首次用错artifact名而明确拒绝，随后核真实名称；组合原candidate串行下载超期，原五分钟内非重叠range读取独立验真，不追认前次下载成功。旧430计划用原head验证器，当前432的policyDigest拒绝不被放宽。原Actions完整结果、原文件/日志SHA、准确counts和取证局限见[local-results.json](local-results.json)。

组合39119845747的全部逐task本地下载仍在原300000ms终止，部分原现场保留，独立本地全量再聚合未完成。其Actions正式aggregate的330项验收、原aggregate/acceptance来源校验和同批双包字节验真分别已完成；这些证据不能写成全部task本地再下载成功。

此目录属于参考证据，不取代正式设计和逐任务验收。正式决策在[release-gate-redesign.md](../../../design-docs/release-gate-redesign.md)，推进状态在[实施计划](../../../exec-plans/active/release-gate-implementation.md)。实现和证据继续随 PR335，发布 PR327 保留。

此前第八轮（2026-10-18）：[39113768051](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39113768051)在真正预合并e4331d26/head03930c18终态失败，精确parents已API核为main6e708c6b与该head；247 jobs为241成功/6失败，330 actual、324 required、321 required passed，326 total passed含5个校准操作。未改PR327的组合[39113960317](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39113960317)在真正预合并4dd88eaa/组合6109a027终态失败，精确main/组合parents和双PR ancestry已核，247 jobs为242成功/5失败，330全部required、327通过。两批source117/118、packaged104/104、Linux原样安装通过；required失败各为一个source与两平台安装，PR335另有Windows身份校准失败，errors/notRun空，均无acceptance。

两个原aggregate artifact12132143479/ZIPa5594668、12132134790/ZIP8ae1fa06和原candidate12131187990/ZIP1e0e1498、12131977938/ZIPb8089216已独立绑定actual producer/上传ID/原摘要。规范包回执分别1b86af7b和b19f6505，原主/notifierVSIX摘要见JSON。两次本地全量task原下载均在300000ms失败，现场在各download-1/all-original、日志full-readonly-1.log；没有完整本地再聚合，不能加时追认。正式Actions aggregate的330任务结果与本地下载分别记录。

三项平台观察修正保原预算和产品：Windows Process/SafeHandle直接观察原PID/StartTime/HasExited，权限/空/错PID/未知/逾期不当absent；macOS公开Quit后原30秒分别核应用close0和原Host消失；中文新Terminal固定唯一新增ID，原20秒内通过真实标题栏双击退出概览，精确“停止”可见可用后只点击一次。原CIM历史阻塞机制及macOSTERM后group signal0 EPERM仍未确认，修观察不追认历史成功。

当前113门禁/发布/恢复合同同批通过、0失败/0跳过，四workflow actionlint正确调用exit0；误指不存在workflow的actionlint-10原失败保留。真实浏览器注册429→430仅新增概览中文Stop回归，原429全保留；同production输入427功能/3视觉全通过、retry0、baseline不变。原第八轮production bundle概览回归通过。更新driver消费原第八轮Linux双包的公开完整安装诊断通过，包括I/O/resize/Stop、原通知token确认/回跳/用户ack、中英文和两原应用/Host退出/清理；中文初始overview=false，不外推Windows概览/macOSQuit，全部局部acceptance=false。

原source ready/panel焦点两失败尚未定因：real-reopen原setup退出/离线屏障成立，verify公开open→close→open的generation5原45秒没有ready/bootstrapAck；组合file/views原10秒内已ready/命中但documentFocus=false。仅加外部只读CDP网络/Runtime、不改测试body/产品bundle的当前两个Host诊断通过，并核原hash/退出/退役，不能抹原首败。新head完整实际验收、两生产竞态仍未收口，详细原地址/hash见[local-results.json](local-results.json)。

历史第七轮状态：第七轮 [39112933251](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39112933251) 在resolve正确拒过时helper摘要，原业务任务未运行，17 jobs为1成功/3失败/13 skipped，无acceptance。输入7e4d71fc的双parents已独立核为main6e708c6b与head0201c58f；重新生成123预算的期限、wait表达式、倍数、parts与有限循环逐项不变，只同步摘要和行号。真实当前源码核对/副本未审查改动拒绝与panel焦点合同2/2通过；后续完整新输入仍需验证。

第六轮 [39108395021](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39108395021) 终态失败，324 required/320 required passed，326 total passed 含六校准操作；真实 0.26.1 组合 [39108780795](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39108780795) 330 required/328通过、source118/packaged104全通过，剩两平台安装URI确认失败。Linux原样安装和六native同批通过；原aggregate/两失败安装工件已独立绑定job/hash，第六轮双包artifact12128899187/ZIP d509e627原bytes已核，原包摘要不变。不同轮次不互补验收，均无acceptance。第六轮全量原任务本地下载在原5分钟期限终止，已下载部分保留于`/dev/shm/dsc-ci-actions-39108395021-download-1/all-original`，日志`/dev/shm/dsc-ci-actions-39108395021-full-readonly-2.log`；独立全量再聚合未完成。

公开URI确认按真实VSCode DOM和Uri.toString完整title核原token、不记忆授权，在原20秒完成；受控不存在token的真实Host诊断通过仅说明确认/命令派发/退出，不代证原通知token回跳。panel file/views原probe缺document focus，补公开view focus的production+旧native诊断通过，原10秒和file/split/mounted/reader断言保留。当前109门禁/发布/恢复合同同批通过（含冻结源码核对与未审查改动拒绝），0失败/0跳过，四workflow actionlint通过；新head三平台完整安装尚须实跑。

[runtime-mode-switch-reproduction.mjs](runtime-mode-switch-reproduction.mjs) 从仓库根执行，直接加载原生产Host类并受控回调进入时机；JSON记录四生产/模拟×共享/非共享路径都复现delete后pending拒绝和后续缓存失败。脚本是定位资料，输出`acceptance=false`、`status=reproduced-production-mode-switch-path`，不是产品回归通过。原正式source首败与受控源码hash各自记录，正式责任在[runtime-shared-root-canvas-sync.md](../../../design-docs/runtime-shared-root-canvas-sync.md)。产品mode-switch边界和旧代恢复订阅竞态均未修，CI不得增加静默期/重试或放宽原断言掩盖。

macOS原两份cleanup只有kill EPERM，无法确定具体signal/对象/阶段；当前增加原group PID、target、signal、syscall/stack及逐清理步骤取证，两个受控反例确认权限失败仍失败、保原业务首败且不继续发信号。具体历史权限根因仍未确认，新输入通过也不追认原失败已修。

[local-results.json](local-results.json)记录当前实际目录、代码摘要、本地回归和旧资产诊断结果。完整80项regression同批通过，83项合同通过；423前端功能、3固定视觉及Marketplace浏览器通过。SSH原Host退出/保留和两个Marketplace Host新包装器均有实际本地诊断。旧dist/native输入明确仅诊断，没有修改inputCommit或将它们算入新SHA验收。

首败现场保持独立：SSH第二轮证实Host缺少继承env，第三轮systemd路径及重复reset cleanup失败；第四轮两态通过。Marketplace第一轮IPC/Xvfb路径失败，第二轮preview语言前提失败，第三轮显式语言包/locale后通过。fixture修正保留原产品等待和断言。真实SSH必要证据导出42文件、461626bytes，原依赖缓存不上传；内容清单复算、结构化文件超限、篡改、取证超时和活动checkout并发清理均有反例。

真实Actions首轮[39093713215](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39093713215)以预合并354e6129运行后取消；第二轮[39094300198](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39094300198)以预合并040883c8运行失败。三个regression分片、输入、production前端/视觉、Marketplace浏览器、Linux/macOS四native操作通过，六native-load均通过；完整结果没有拼接成验收。首轮文件名/浏览器依赖修复生效；Windows两架构实际正文被OSC标题前缀干扰raw换行观察，新版gh拒ANSI日志，以及production CSS .82/0.82字符串误判已有证据并修观察，原15秒/实际几何/退出/清理和生产构建保留。新HTTPcollector独立下载首轮六asset并核真实producer/ZIP hash，首轮取消仍不产生acceptance。

第三轮[39095480885](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39095480885)以预合并612a891c/head924cae96结束失败；API核原parents为main6e708c6b及该head。六native load及实际有限操作、118源码Host、两个Marketplace Host、三regression分片、423功能/3视觉及source-build同批通过。原双包各构建一次且clean checkout退役通过，随后文件清单测试错读外层dist使producer失败；原包仅在always证据artifact12124438854保存，没有正式candidate transfer，104packaged与三安装not-run。聚合又因Windows原回执使用反斜杠而拒绝Unsafe evidence path，稳定检查保持失败。

修复后的candidate模式在外层两dist均不存在的私有源码夹具消费第三轮原包，通过真实production staging、vsce ls及原ZIP检查；没有额外build或原包修改。生产ZIP源码/debug、本地化缺失、路径sanitization和helper权限反例通过；Windows路径修在producer写入，历史原回执仍验证失败，诊断仅核规范化引用可对上原hash。最终完整gate62项同批通过；渠道/恢复29项另批通过。正式修正输入须重跑clean/packaged/三安装/全量聚合及PR327最新预合并完整验收。设计映射152名称只代表目的地；137项implemented-unverified与15项not-implemented不能计为产品通过。main未配置保护检查，已复现生产恢复撤销订阅竞态未修，当前不能发布0.26.1。


第四轮[39097246318](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39097246318)在真正预合并aa969012/headcdf40738完成：247 jobs为240成功/7失败，六native load/操作、118源码Host、2 Marketplace Host、423功能/3视觉、source-build与一次clean双包通过；packaged103/104。正式candidate artifact12125466855/ZIP86937a58已独立核，原Windows回执无需重写即验真。全量330task已采集，299可验收、31被拒（含失败regression producer连带拒绝），errors/notRun为空；整体失败且无acceptance。

本轮关联修正有真实对照：native回归改验证真实staging行为；macOS官方同包入口解析CFBundleExecutable=Code；独立driver先连接CDP再创建公开canvas、固定nodeID、画布内完整resize，launch环境保receiver，通知按center/preserve/用户ack契约，locale独立重开并核真实button名称。Linux第四轮原包全公开流程exit0，PTY子进程64×20→105×34，Stop后原shell/child absence，两个Host公开退出0，中英文及通知回跳全部通过。诊断目录`/dev/shm/dsc-ci-installed-public-flow-diagnostic-5`，原双包前后hash一致，acceptance=false，不追认第四轮正式安装或其他平台。

packaged文件视图失败的原生产bundle指向d3-drag处理合成mousedown时event.view=null。minimal/card两个真实浏览器回归在原包均复现同一pageError；修后私有production build2/2通过，连续文件打开及后续公开drag正常。原Host可见文件/split group/mounted断言保持，新head仍须实跑。实际Playwright注册426→428只新增这两项，其余426完全保留；3固定视觉通过/基线不变，完整425功能与3视觉回归通过，实际执行集合精确匹配冻结目录。

当前typecheck、native-assets完整链、vscode-runner环境、四workflow actionlint及结构合同通过。93门禁/发布恢复合同同批通过后，新增首败摘要/目录变更的25项针对复验通过；摘要优先指出原失败task，但成功兄弟task仍不能从失败producer获得acceptance。最新完整Actions、新批次104packaged/三安装及PR327真实组合继续待验；生产恢复撤销订阅竞态未修，0.26.1未放行。

第五轮[39101493143](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39101493143)真实预合并7375f4a1/head2c4a16af已结束失败：247 jobs为239成功/8失败；330 actual、324 required、318 required passed，324 total passed包括六校准操作。source115/118、packaged103/104，六native、三regression分片、425功能/3视觉、Marketplace Host2与Linux原样安装通过。失败为三固定宿主metadata下载网络、源码文件视图、macOS长IPC与Windowscached geometry，errors/notRun为空，无acceptance。

PR3352c4a16af+PR3278313fc72临时0.26.1组合[39101774719](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39101774719)真实预合并a450a724/组合head56d54377已结束失败。parents核为main6e708c6b及56d54377；247 jobs为243成功/4失败，330全必跑328通过，source118/packaged104、六native和全部基础通过，仅macOS与Windows原样安装仍失败。两轮独立记账，不能互补验收。

本轮原包受控tab焦点切换先红后绿，目标file按URI/ViewColumn唯一公开Tab关闭，原画布保留。新fileEntries probe实际拒视口外/禁用/遮挡输入，补全一次primary pointer。当前production Host两次失败分别证明瞬间probe后动画变化及不合理selection前提；外部DOM trace记录目标已居中/可命中而旧selection保留，改用同原10秒中的焦点/稳定矩形/实际命中后完整文件视图通过。证据`/dev/shm/dsc-ci-current-file-view-host-3/result.json`同时核原Host退出/原执行reader清理/短目录退役；这是当前源码production+旧native诊断，acceptance=false。先失败的两个目录及原包before-2均保留，before-1的proposed API枚举失败不作产品证据。

当前最终105门禁/发布恢复合同同批105通过/0失败/0跳过，typecheck、vscode环境、四workflow actionlint和结构合同通过。真实浏览器428→429只新增命中前提回归，原428完整保留，production426功能/3视觉全通过/基线不变。123 suite预算与上一head逐项相等，文件视图1083000ms；installed新UI/nonce/同fd几何观察共用原20秒。短路径settings显式传原user-data地址，setup/verify日志逐session保留并在原Host退役后安全清理；下载reporter固定缓存路径通过，冷网络恢复尚未实测。最新正式跨平台与更新PR327组合仍待新head执行，生产旧代订阅竞态持续阻塞0.26.1。
