---
title: 退出完整性生产接入与故障域收敛
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
  - docs/exec-plans/active/runtime-exit-integrity.md
updated_at: 2026-10-02
---

# 退出完整性生产接入与故障域收敛

最新 A1/B1 结果（2026-10-01，覆盖后续历史入口）：固定 `10/1` schema2 Linux Electron 候选的 `color`/`size` 多会话校准均通过内容、预算观察与产品 cleanup；峰值总 RSS 为 3,876,724,736 / 3,954,757,632 bytes，仅代表该声明输入。随后同候选 `2/1` `color` Host detach/reconnect 通过：旧 Host 消失后原 Supervisor、主体和 session/reader 身份保持，B 在 A 尚未追平时 53.4ms 应用，Host ready 后 15,538.456ms 追平，reconnect/outer cleanup 均通过。两项不关闭 F-04、默认准入、跨平台/packaged 或未填页面格，不再重复成功矩阵或扩展通用工具前置。

同日分发补充：Windows x64/ARM64 的修后 attempt2 已成功，和先前四格合并后的六目标 schema2 import、聚合与固定 VSIX SHA 均通过；这仍只证明分发构建/加载/归档路径，不代证最低旧 OS 或各目标完整产品验收。A6 snapshot-only Host 离开及 A3 双 Host 共享 root 的既有真实 evidence 已在执行计划中对齐，旧失败和未观察字段不改。

验收环境决策（2026-10-02）：本次重构以现代 GitHub-hosted runner 作为支持基线。固定资产 workflow 的六格为 `ubuntu-24.04`、`ubuntu-24.04-arm`、`macos-15-intel`、`macos-15`、`windows-2025`、`windows-11-arm`；实际记录的宿主为 Ubuntu 24.04、macOS 15.7.9、Windows Server 2025（10.0.26100）和 Windows 11 ARM64。产品 provider/真实 Agent workflow 中的 `macos-latest`、`windows-latest` 仍是浮动标签（近期 macOS 产品 job 解析到 macOS 26.6.2），运行时必须记录当次宿主版本，不能用固定资产矩阵替代产品证据。macOS 10.13/10.14、Windows 10 1809 及其他低版本不阻塞本轮验收，也不由现代 runner 结果获得兼容声明；后续按真实报告单独修复。

## 1. 当前结论与阶段边界

当前入口（2026-10-01，以本段优先）：第47节新固定installed包的原A6多根组合已独立核对通过：A真实root EISDIR仍保留来源/binding，原reader applied(finalRevision4)，B原执行实际nonce交互24.9ms，产品reset与独立空闲Supervisor清理通过。旧包首败不追认，该多根格不再排队；snapshot-only实际 Host 离开已由第50节真实 Reload Window 证据覆盖，A2/A3剩余页面责任及F-04总体仍开放。第49节六资产构建/聚合/固定VSIX已完成，正常分发/默认准入和最终同版本产品验收尚未完成，不追加通用工具阶段。

当前B2/A5入口（2026-10-01）：macOS36829311235/353bb575完成两模式Terminal/Webview和重开，六报告已核对；首轮真实Agent36832581851前三Codex场passed、第四snapshot stop空快照真值断言首败、Claude未跑，见33.10。Windows36830583121虽job success却缺五份最终报告，34.12已确认code.cmd转交误作宿主完成并实施窄修，待原流水线复验，Agent未调度。A6三项真实Host入口新增两绿一红，永久退出后旧reset写入按32.21处理。普通构建仍stock，其他架构/运行时、packaged/Remote、剩余A1至A6与F-04未关闭，后面的旧当前/下一按各自历史输入理解。

当前 CI 状态（2026-10-01）：第四轮 run `36812745671`/`736f9ddd` 在 Linux/DeepSeek 原八场景全部 passed，四 natural 已有真实目标响应/nonce、source EOF 与原 Webview/持久化断言通过，八份 cleanup 四计数均0。stop 仍为主动停止，source 分别是 Codex Runtime eof、Codex snapshot-only interrupted、Claude 两模式 eof，不改写自然终止。第三轮 Codex snapshot-only stop 的失败本轮未复现；本轮仅修改报告/文档，业务与断言未变，根因仍未知，保留为具名间歇失败，不宣称已修。当前返回原有限产品清单，不为捕获红项自动追加 CI/工具，四轮原结果保持，详见32.20；F-04/完整A5/macOS/Windows仍未关闭。

当前 A1/A2 状态（2026-09-30）：有界索引顺序读取已实施，同一 2/1 Electron candidate 的 `.debug/a1-host-reconnect-20260930-indexed-pages/` 完整 exit 0。新 Host ready 1422.291ms、完整应用 14431.416ms，ready 后追平 13009.125ms，小于原 30 秒；B 响应 32.6ms、独立 journal/hash、原执行/新 reader、完整保留后缀、自然 completed 无历史及清理通过，详见 32.19。旧四轮 exit 1 保留，本次解除的是该固定冷恢复的直接阻塞，不关闭全部 F-04/A1 至 A6。真实重连追赶交互重叠本轮为 false，不补造覆盖；同一新 2/1 构建 A4 `.debug/a4-real-agent-20260930-indexed-pages/` 八场景完整 exit 0，natural 四项取得响应与实际 source EOF，stop 四项保留主动停止。Claude stop 覆盖 startup/auth 等待界面的停止，不代表完成模型任务；既有跨平台/认证边界和尾部要求不变。

2026-09-30 最新结果：第 32.14 至 32.15 节的 A4 v18/source-eof 复验已取得 Linux 实际 VS Code/Electron Host、真实 Codex/Claude、candidate owner 和两种持久化模式的八场景有限通过；natural source evidence=eof，stop 仍保留非 EOF claim，旧认证、命令、启动与告警分类失败保留，不代证 A3 大尾部、A5 容量或跨平台。A1 v4 已执行一次实际 Electron 校准，在 color 首档真实回显应用的 1500ms 观察界限首败，部分基线和资源样本仍保留；它不是 OOM 或已冻结产品预算的失败结论，详见容量重评第 10.9 节。候选默认、整体 A1 至 A6 与退出完整性交付仍开放。以下旧摘要按原时点理解。

当前实施状态：第 32.2 至 32.15 节已接通实际候选 extension 和匹配 Linux Electron 资产。退出提示覆写、snapshot-only live 投影和大快照读取丢弃均已修；Runtime/editor 与后续 snapshot-only 单选分别取得大输出/终态/真实重开通过，旧失败不改、不合称同轮全绿。A6 completed 后续发布、完整 root template reset 与迟到 callback 三项已修，生命周期 38 次、Host wiring 110/110 通过；source-eof 复验后的主线 Host wiring 144/144、Supervisor wiring 90/90、protocol/localization 与 typecheck 也通过，不代证其余 A6。A4 的认证/命令/启动前置失败仍按历史保留，v18 与 source-eof 复验已在 Linux 实际 Host 完成八场景有限通过，natural source evidence 与 stop 非 EOF claim 分账见32.14至32.15。普通构建仍 stock，A1/其余实际验收/跨平台/分发与整体完成保持开放；下列旧摘要按各自原时点理解，不覆盖本段。

2026-09-30，按预算重评调整既定有限收尾顺序，见 `docs/design-docs/runtime-persistence-closeout.md`。合并测试进程的 Heap 64 MiB / RSS 128 MiB 是初始观察预算，不是独立 Supervisor 或每会话的产品预算；原阈值、结果及 exit 1 保留，超限改列待评估信号，不单凭它阻塞 B2，也不先做仅为压线的优化或 profiler。B2 已接通启动参数链、Linux candidate 的安全首次启动和显式 Host 新建入口，范围及有限结果见第 32 节与 32.1；extension 默认仍关闭，两模式正式入口、匹配资产和既定验收仍开放。真实分进程、多会话资源与交互评估并入 A1，F-04 仍开放。F-05 新路径保持收口，B3、真实 Agent/Webview/跨平台、主体尾部及 A1 至 A6 不削减；不展开 S17 工具链。本文旧阶段及其“下一步”是历史证据，不是当前执行队列。

2026-09-28，当前S16见31.15，输入`a74844c4`。真实Host回归先红证明旧completed保存失败可复活已清root；最小修正只保护普通completed在reader/persist等待窗口的原投影/session身份，并在并发时局部恢复节点执行字段，strict分支不改。Host回归25次、wiring95/95、checkpoint、paged completion四组合及typecheck通过，独立review无阻塞。完整reset/reload事务、首次pending等待后callback注入、新业务准入及旧Runtime delete之后的迟到UI仍开放；template仅验证prepare入口，不恢复global gate/core锁/root全局drain，不新增native或平台样本。以下S15及更早段落为原时点记录，不覆盖本段。

2026-09-27 从`670320b8`推进S15，正式范围按31.14收窄为普通 `prepareForDeactivation()` 的首次内部 Promise 缓存：同一 Host 的重复永久离开复用首次配置和同一成功/失败结果，不重复执行保存、detach 或删除，不承诺public async调用返回的Promise对象引用相同。candidate/non-native原关闭路径，以及reset/reload/root/template实现保持原状；本轮不是非永久边界的全流程串行化。审计中试作的core锁、临时关闭非永久准入和root全局drain方案已撤回，其局部测试不计交付证据。正式最小修改已通过13次Host边界测试调用（旧8/新增5）、Host wiring95/95、checkpoint、typecheck与测试脚本语法检查，新增并发用例在未改业务基线先红；独立review无阻塞，reviewer复跑目标测试及`git diff --check`通过。真实VS Code/Electron/Webview、Agent与跨平台、非永久跨代次写入及未完成operation仍开放。以下S12及更早“当前/下一”段落保留为历史，当前范围以本S15段落及31.14为准。

2026-09-27 修后测试输入`54c3bc00`按31.7仅采集Runtime单例一次，1/1通过、partialSelection=true。实际Host/client/socket detach后保留原执行，新Host从磁盘恢复并计算新nonce，自然exit7后Host自动保存轻量终态和单次delete，第三Host重开无正文/新执行；Supervisor原正常shutdown严格落盘空registry并关闭原连接，资源安全释放。首轮1/2与旧证据不改，不合并成首次全绿。本轮没有业务或测试源码改动，零Webview reader、Node API及受控VSCode服务的范围保持。旧Host关闭报告后的延迟保存登记需独立核对，不能由本轮清timer的夹具证明迟到写盘已安全；后续边界见31.9。候选仍默认关闭，L-02至L-05与整体退出完整性未交付。以下按原时点保留。

2026-09-27 从`7b480cbd`推进第31节S12，唯一首次两场景exit1，1通过1失败。snapshot-only活跃Host调用原deactivation后，自身SIGHUP尾部、最终保存/重开及资源释放通过；Runtime真实client/socket/start和首次输入已发生，但prototype夹具缺诊断数组导致TypeError，尚未到detach/恢复/自动完成清理。两原执行均安全释放，Runtime的退出属于失败清理，不能替换失败首报。已仅补夹具字段并完成确定性纯验证，增加仅选失败场景的入口，没有第三次原生样本或业务改动。下一只冻结新输入/新目录复验同一Runtime场景一次，不重复本地样本或增加工具前置；S12、L-02至L-05及整体计划保持未完成，候选默认关闭。以下按原时点保留。

2026-09-27 从`ae3c42cf`完成第30节S11唯一首次有限业务采集：Linux x64/glibc 2.35、Node25.6.0正式工厂/provider与真实PTY，四场景/五主体通过，所有原transport关闭、四类资源释放且无额外停止清理。确认两authority交互与主体尾部、snapshot-only真实文件保存/重开、受控连接live重附着、暂停消费下stop及同Supervisor隔离。没有修改业务代码或启用默认候选。VS Code服务和reader连接仍受控，Runtime删除后拒绝重附着不代证Host自动完成清理/节点重开；Host活跃退出、真实Webview/Electron、Agent和其他平台未验收。下一有限项补实际宿主生命周期与Runtime完成节点重开路径，不追加诊断框架；L-02至L-05和整体计划仍开放。以下阶段按原时点保留。

2026-09-26 从`7a39497b`实施第29节S10：Linux候选的初始尺寸、有界input/resize、原token非阻塞mutation、按执行种类停止、两authority业务回写及正式worker/资产工厂已接线，继续默认关闭。组合验证发现并修复阻塞input与resize/输出消费的环等；源码复核补齐已成功resize与退出竞态、最终Agent resume等价行为。当前证据仅为受控实际模块、JS构建和一次未加载的Linux原生产物编译/显式导入，不是PTY、真实Agent、VS Code/Electron或跨平台通过。下一S11按27.6固定实际Linux业务输入、匹配环境/资产与安全清理后采集；不再追加通用诊断门槛，L-02至L-05和整体退出完整性仍开放。以下阶段按原时点保留。

2026-09-26 从`f8ca57d4`实施第28节S9：单一默认关闭候选profile、完整能力准入、原连接严格删除及在途创建/删除广播责任保护已接入实际模块。受控验证与旧protocol误跑分别记录于28.4，不把候选配置或fake交互声明写成真实Linux支持。下一按27.5直接补实际I/O、停止策略、业务回写和真实工厂/产物；当前默认generation、旧live原绑定、Runtime结束无历史保持，L-02至L-05及整体退出完整性仍开放。以下阶段按原时点保留。

2026-09-26 从`b235a7bc`完成第27节生产接入有限设计。已选定下一默认关闭切片的单一候选预算、创建前分流和旧live严格删除边界；查明交互能力、初始尺寸、真实工厂/分发及停止策略仍有直接接线缺口。下一直接实施S9配置/准入与错误传播，再沿同一方案补Linux交互provider，不再安排通用诊断前置。本轮只有源码核对与文档验证，没有业务改动、用例运行或新增平台证据；候选毫秒数不是生产验收，L-02至L-05与整体交付仍开放。以下阶段按原时点保留。

2026-09-26 从`c5a0487f`完成第26节S8：默认关闭的snapshot-only最终tracker投影metadata与严格实际保存，独立保存责任保留失败/未知来源并衔接S7边界。owner36/36、Host56/56和相关回归/typecheck通过，新增单root及workspace真实文件读回与headless光标验证；旧history完整脚本基线与本轮均因夹具缺字段失败，不能记通过。下一仅收敛L-03生产预算和L-04创建前能力分流、旧live错误传播与最小Linux业务接入方案，不自动开native或新增诊断门槛；总体退出完整性仍开放。以下阶段按原时点保留。

2026-09-25 从`ade8f133`完成第25节S7：默认关闭、无native的实际Host/Supervisor正常关闭失败编排。Host分别报告本地执行、现有画布保存和原连接detach；Supervisor等待原执行/reader、严格保存及原server/socket关闭，失败或未知保持关闭准入与进程保活。owner35/35、Host49/49、Supervisor60/60及相关回归/typecheck通过，仅证明受控实际模块。下一有限阶段补snapshot-only最终终端状态投影与实际保存/失败保留，不增加Runtime completed历史；生产profile、native准入和整体退出完整性仍开放。以下阶段按原时点保留。

2026-09-25 从`d934867c`完成第24节S6：默认关闭、无native的原父控制受限清理已接入owner/adapter/transport。固定资源契约、同步清理准入和同钟绝对期限得到直接验证；owner33/33、adapter81/81、transport纯测9/9、Host41/41、Supervisor42/42及相关回归/typecheck通过。只证明受控实际模块，不代证OS资源释放。下一有限阶段按22.5接真实Host/Supervisor正常关闭失败编排；生产profile、native准入及整体退出完整性仍开放，不重开通用诊断门槛。以下阶段按原时点保留。

2026-09-25 从`a32b1510`完成第23节S5：默认关闭、无native的一次性natural/stop/failure关闭观察和绝对期限分类已接入实际owner/adapter。owner26/26、adapter64、Host39/39、Supervisor40/40及相关回归/typecheck通过，原断言和历史失败保持。下一有限阶段按22.4接原父控制，先确认安全移交事实与固定期限追赶；真实Host离开编排、生产时长和native准入仍未交付，不扩大诊断框架或宣称整体退出完整性完成。以下阶段按原时点保留。

2026-09-25 从`567bcd95`完成第22节L-03有限设计：定位自然收尾无自动预算、迟回调与绝对期限、终态后缺ACK的交互及Host实际离开缺口；选定有限首报/原责任继续结算，明确原父控制安全前提。下一仅S5默认关闭、无native的一次性关闭观察及实际模块回归，不再扩诊断工具。本轮只读源码和文档，无新测试/平台样本；生产数值、父控制接线及真实宿主失败边界尚未交付，L-03和整体退出完整性不关闭。以下阶段按原时点保留。

2026-09-25 从`90a7d95b`完成第21节默认关闭、无native的本地snapshot-only最终应用屏障：实际Host/tracker发送初始和最终快照、连续输出，实际main写链以真实xterm回调回传逐页面结果。Host35/35、实际main/headless27/27、远端接线20/20及相关回归通过；包含实际Host到main/headless再回Host的受控整链，不等同真实VS Code UI或原生资源验收。未知进程不发布退出，已冻结后只允许原reader恢复投影。下一有限阶段转L-03正常关闭失败处置及预算的接入设计/最小实现输入；L-02总项、生产分流和整体退出完整性仍开放。以下阶段记录按原时点保留。

2026-09-25 从`648958e0`完成第20节默认关闭、无native的远端发送链：四层能力协商、原连接reader绑定、明确finalRevision及真实Webview写回调屏障。Supervisor36/36、client13/13、Host/relay/client20/20（含一个实际Supervisor至headless投影的内存整链）、实际main controller/headless13/13及相关回归通过。两项旧relay时序断言曾失败，保留断言修实现后通过；不把headless与受控transport写成真实VS Code/socket/平台通过。下一有限切片为本地snapshot-only最终应用屏障；L-02、native失联处置/预算、生产分流及整体退出完整性继续开放。以下记录按原时点保留。

2026-09-25 从`bcdd7213`完成第19节默认关闭、无native的远端逐reader接收端，Supervisor 33/33（旧13项保持，新增20项）、Host19/19及相关回归通过。逐open准入、真实回包提交、逐reader outcome与有限幂等已接线；中性聚合结算不等于页面应用。仅内部capability注入可达，未改变hello能力、client/Webview、namespace或旧live。下一阶段接通远端发送和跨层能力协商；本地最终屏障、native失联处置及生产分流仍开放，不将本切片记为L-02或整体退出完整性完成。以下记录按原时点保留。

2026-09-25 从`c1b6bc8b`完成S4实际接线补验，结果见第18节：Host 19/19覆盖成功启动后的真实tracker收尾和单根/多根reset入口，Supervisor 13/13包含checkpoint等待中断连/替换的先红后绿修复。仅非native注入路径，旧路径不变；没有本轮PTY或runner。第17节原5/5与11/11保持，不追认未覆盖路径；前轮将旧Supervisor协议回归误归为零PTY的说明按18.2勘误。下一有限切片为18.4的远端逐reader结算，整体仍未通过。

2026-09-25 S4从主树`e84a8558`、诊断树`14fc6462`开始实施并已完成有限验证。有限实现输入见第17节：只连接默认关闭、无native的真实owner入口，正常用户路径不变；本轮结果仅证明准入、消费屏障、责任保留和关闭接线，不开放PTY/native，也不等同于产品级退出完整性通过。第16节及更早阶段按原时点保留。

2026-09-25 Linux最小接入条件已按第16节收口：定位Supervisor与Host正常关闭、创建、停止、消费和reader的实际入口，区分已有控制能力与未实现责任。下一切片S4仅做默认关闭、无native的实际authority关闭准入与收尾接线；不新增诊断框架或要求先补异常崩溃全矩阵。真实PTY进入业务仍受第16.4节具名门槛约束，当前不满足；PI-01/02/03不关闭。本轮只读代码与文档，无业务改动、测试、原生采集或runner/push。以下S3及更早记录按发生时点保留，其“下一步”不覆盖本段。

2026-09-25 S3修后有限采集已完成：输入`3f8ebcae`在Linux/Node22.23.2对原normal/flood各执行一次，新目录结果2/2，均无fault、主体及资源确认结算；normal的live最终状态断言已实际执行。仅本地固定两场景通过，不是跨平台或产品退出完整性完成；首次`.debug/s3-linux-provider-first/`的0/2及首报unknown原样保留，不追认通过。输入、原始事实及边界见第15.8至15.9节，不接现有业务或运行runner。以下S2及更早结果按发生时点保留，不覆盖当前阶段。

2026-09-24 S2 已完成本机 Linux/Node 的真实异步 transport/provider 启动链与零 PTY 普通 pipe 受控验证，输入为主树 `e9a3b3f7`、诊断树 `65d2eb32`。首次真实矩阵7/7通过：8次transport尝试、7个真实provider、4个受控subject，8个transport close包含1次失败spawn，并非8个真实进程。实现、首次错误、独立复审修正及未重采集的后置窄修见第14节；不接现有业务、native或runner，不关闭PI-01/02/03。S1第13节保持历史原文；以下S1及更早阶段的段落是历史，不覆盖本段。

2026-09-24 S1 实施阶段从主树 `17e3372b`、诊断树 `89cb46fc` 继续。主树新增真实共享生命周期类型、无 native adapter 及直接加载它们的定向测试，未从任何现有业务入口导入；诊断树只同步文档。当前实现、验证与下一有限切片见第13节。整体仍比较中/验证中，真实异步 pipe、native 预算、平台 owner 失联和两 authority/页面接线未通过；不因 S1 内存验证而关闭 PI-01/02/03。以下接口阶段与原生实验描述按其发生时点保留，不覆盖本段。

2026-09-24 接口阶段从主树 `07851ba4`、诊断树 `76ea6e77` 继续。第9至12节收敛 PI-01/02/03 的消息、所有权与两模式接线，并冻结下一步 S1 无 native 的共享 adapter 核心切片。PI-01 的真实 pipe/read 背压、PI-02 的平台失联处置和 PI-03 的实际宿主接线仍未验证，不能把接口收敛写成三项生产门槛全部关闭。本轮只读研究与文档修订，没有业务实现、测试、原生采集或 runner/push。

上一阶段从主树 `081c3a21`、诊断树 `f7ce4283` 只做生产源码核对与设计收敛。首选待验证候选是：**终端权威状态留在 Supervisor 或 Host；每个新执行会话在取得任何 PTY/native 资源前，建立独立的 provider 子进程。** provider 是实际持有进程、终端和原生资源的组件，adapter 是把它的事实接到终端权威状态的共享适配逻辑，authority 是维护终端事件顺序和解析状态的 Supervisor 或本地 Host。共享 adapter 指代码复用，不是两模式共享内存或 owner。

这不是新增供用户部署的常驻 server，也不是批准把诊断代码搬进生产。每会话进程的代价、通信和父进程失联处置尚未闭合，故状态为比较中/未验证。既有原生证据仍见 `runtime-native-failure-isolation.md` 第20至27节；尤其 U1-6 的三次通过只证明固定 macOS 环境的合成注册失败收尾，不是本拓扑通过。本轮没有新增构建、纯测试、PTY、runner 或业务实现。

沿用已确认边界：Terminal/Agent 主体尾部和自身已接收、排队、消费中的内容必须正确处理；主体运行时不按后代来源过滤同一终端输出；主体退出后不默认等待普通后代未来输出。实际 Agent CLI 即使由启动器创建仍是执行主体。正常结束的 Runtime 节点重开不恢复正文或进程；Supervisor 崩溃/机器重启不要求恢复。`snapshot-only` 快照语义不变。Windows 已退出 Process 对象因合法引用继续存在不自动是泄漏或系统 bug。

本阶段停止条件是形成带代码依据的首选候选、事实与所有权边界、具名实施阻塞项及有限后续顺序。**不要求先补全 U1-7/W1、D3/D4 通用边界或全部平台故障枚举。** F-03 root 稳定 Supervisor 归属与 F-04 全局容量优化不在这里顺带改造；但新 provider 引入的内存和准入必须有界，不能以 F-04 在外为由忽略。

## 2. 实际接线与问题落点

本节源码路径以 `extensions/vscode/dev-session-canvas/src/` 为前缀，行号对应主树基线；诊断树的业务源码不是接入基线。

| 实际位置 | 只读事实 | 接入要求，不等于已证明该点发生丢失 |
| --- | --- | --- |
| `panel/executionSessionBridge.ts:26`、`:122` | `onData/onExit/kill`，factory 同步 require/spawn 后返回；onExit 注释把退出描述为排空 | 分开主体、源、资源结果，启动前绑定全链 sink，停止返回不代证释放 |
| `supervisor/runtimeSupervisorMain.ts:459`、`:512` | spawn 后登记 session 和绑定监听 | 在本地 authority 内 prepare-bind-start，不必新增 Host 到 Supervisor 的两阶段 RPC |
| `panel/CanvasPanelManager.ts:14776`、`:15984` | 本地 Agent/Terminal 同样直接创建 bridge | 与 Supervisor 一起接入，不能只修 live-runtime |
| `supervisor/runtimeSupervisorMain.ts:1149`、`:1266`、`:1830` | onExit 关闭输出准入；有串行操作链，但最终快照策略为 never | processResult 不关闭输出；封口后在同链等待真实 tracker.flush |
| `common/serializedTerminalState.ts:268` | 已有基于 xterm callback 的 flush | 复用真实解析屏障，不以 journal.flush 或入队 revision 代替 |
| `webview/terminalPagedProjection.ts:91` | 真实应用回调后推进 revision；完成、stop 共用无结果 close | 复用现有 readId/revision，补结算结果，不新建消费水位 |
| `panel/CanvasPanelManager.ts:14899`、`:16098`、`:16763` | 本地 finalize 有缓存回退；异步结束按 nodeId 删除；应用 ACK 排除本地会话 | 失败显式化，旧异步回调校验会话身份，本地应用结算不能遗漏 |
| `supervisor/runtimeSupervisorMain.ts:995` | 删除先退订再 kill，退役依赖 reader 清空 | 输出、读者、native 责任分别结算，不以删除映射代替释放 |

这些接线缺口是实现新契约必须调整的地方；源码顺序本身不证明旧实现已丢首块，分页重放也可能补足现有显示。不能把接入设计当作新的实测产品失败。

## 3. 故障分类与拓扑选择

| 故障 | 必须保留的事实与责任 | 候选判断 |
| --- | --- | --- |
| API 已返回错误，事件循环响应 | 原始错误、已取得 owner、已移交内容，安全资源各自释放 | 同进程隔离记账可以承担 |
| 操作观察到期未确认，控制仍响应 | 首次 unknown 和同一操作迟到结果并存，不重复 Close | 需要准入限制，不能仅删除 session |
| native 同步调用不返回 | 已移交 authority 的内容仍可消费，不能靠同线程 timer 证明有界响应 | 首选独立 provider，避免 A 阻塞所在 Host/Supervisor 和 B 的 native 调用 |
| native 崩溃/通信不可恢复丢失 | 进程、源、资源按现有证明分别报告，不补造 EOF/released | 独立进程缩小故障域，不等于恢复 A 或证明任意崩溃下 B 必存活 |

不要求 Supervisor 崩溃恢复，与禁止主动重启整个 Supervisor 来清理一个 unknown owner，是不同规则。拟增加的双会话验收目标是：A 的 native 同步释放不返回期间，B 的新鲜输入、输出和自身收尾仍能推进；这是候选故障域目标，尚无生产时限或原生通过结论，不能仅从“不连带 kill B”推导出已承诺的响应 SLA。

同进程 owner 方案接入成本最低，但不满足上述同步阻塞目标。每会话 worker thread 仍共享地址空间、native 静态资源和崩溃域；固定 node-pty 还明确不保证线程安全，不能默认采用。Windows 已有输出 worker 不隔离 `startProcess/connect/resize/kill` 等调用。Unix/Windows 正常等待有原生线程，不能反向说所有 wait 都阻塞 JS。

首选每会话 OS 子进程，authority 不随 native owner 移走；父侧只异步通信，不同步加载/进入该 native 调用。当前 `executionSessionBridge.ts:243` 的兼容探测也使用未设 timeout 的 spawnSync，接入时须一并改为受控异步启动，不能让父端保留这条阻塞路径。进程必须在首次资源取得前建立，不能发生 unknown 后再搬迁仍被原线程引用的句柄。两种进程拓扑都需要受控 node-pty 源码实现真实源结束和资源事实，包装 stock `onExit` 不足以完成契约。新增 provider 不改变 root 归属或创建窗口的 storage 决策。

## 4. 接口、内容移交与两模式接线

### 4.1 创建与五类事实

采用 authority 内的 prepare-bind-start 作为接入候选：先创建不可复用的 execution 身份、session、tracker 和串行接受入口，再安装完整 observer，最后单次 start。provider 启动握手与 PTY 创建结果异步返回，pid 在证明已创建前不可用。部分创建失败也通过同一个 session/owner 结算，不能只 throw 后删除所有责任。`openExecution(spec, observer)` 可作为内部封装，仍必须满足这道屏障。

继续使用 `runtime-execution-lifecycle-contract.md` 第3至6节五类事实和补证规则，不发明另一套终端状态：ProcessResult、SourceResult、AuthorityResult、每 reader 的结算、逐资源 ResourceResult。控制操作沿用 requestStop、cancelOutput 及 provider 内部 release 的分工；每次操作绑定 execution/generation/operation，重复相同请求复用结果，冲突请求拒绝。accepted 只是操作受理，不是退出或释放。旧 `onExit` 不得同时成为新路径第二个 finalize 入口。

### 4.2 IPC 边界

进程间通信需要独立的启动/控制和输出逻辑通道、有限帧长及逐会话信用额度。信用额度指父端允许仍在途的字节量，耗尽时暂停继续读取或采用已验证的上游背压，不丢弃已取得内容；等待信用不得阻塞停止、错误与资源事实。逻辑上分通道不证明物理队列不会互相堵塞，实际传输及公平调度需在实施前选定。

父侧 adapter 是接受文本 sequence 的唯一分配者，authority 是终端 revision 的唯一分配者。IPC 帧编号只关联移交与确认，不成为第三套终端水位。provider 持有已读 buffer/decoder/未确认帧，父端接受独立副本后回执移交；回执丢失不推定释放或静默重发数据。旧生命周期契约的同步接受/回执只适合同进程模型；本候选仅父侧 adapter 向 authority 的接受是同步的，发回 provider 的回执异步且有界，禁止同步 IPC 等待。正常及可恢复路径的源封口必须等待所有已取得内容移交并校验连续性，不能让控制通道的 sourceEnd 越过输出。真实 EOF 原始事实可先记录，但不能提前宣布移交完成。

父端已接收数据即使回执未到 provider 也由父端继续负责，不能删除重建；provider 崩溃前仍未移交的内容如有丢失，应明确报告，不以 unknown 掩盖。不可恢复失联时，移交所有仍可用内容并明确丢失/未确认范围后，才允许 error/unknown 封口，不要求等待已不可获得的内容，也不用 socket close 伪装真实 EOF。协议失效时同样保留已接受前缀和独立资源事实。每个回调验证捕获的会话身份，不按复用 nodeId 操作后来创建的会话。

### 4.3 封口、解析和 reader

主体退出只关闭新输入和 native resize，不关闭输出 admission。adapter 收齐独立进程观察（确切终态或明确 unconfirmed，不能仍是 pending）、源结算和连续移交后发布一次带原因的 OutputSeal；进程 unconfirmed 不准据此标记正常 completed/stopped。authority 关闭新终端操作，在已有串行链内等待 tracker.flush 真正完成，再确认 finalRevision 和应用结果，并在固定 finalRevision 的同一无 await 边界关闭新 reader 准入；此前已准入及 open 回包在途的读者仍计入既有集合。不得在该链内等待还需要该链继续消费 data 才能完成的 provider promise。解析失败保留已应用前缀，不用缓存快照冒充成功。

扩展现有 close 携带 `applied(finalRevision)` 或 `cancelled(reason)`；连接失效由读者 owner 记 `lost`，旧无 outcome 的 close 仅 `legacy-released`。渲染失败可取消并记录错误，不能回报 applied。Supervisor 校验 session/authority/readId、连接归属及已发范围；正常完成、主动取消、断连分开。回执在删除 reader 前保留为有界元数据，冲突拒绝、重复幂等；不保存正文或新增 completed 历史。

接线覆盖 `common/protocol.ts` 的 normalizer、`CanvasPanelManager.ts`、`runtimeTerminalReadRelay.ts`、`runtimeSupervisorClient.ts`、`common/runtimeSupervisorProtocol.ts` 和 `terminalPagedProjection.ts`；任何一跳不能丢 outcome 后降格旧 close。当前页面已有应用回调屏障；最后页无下一次 page request，不能仅靠 afterRevision 证明最终消费。本地模式沿自身投影/写队列绑定会话与页面身份反馈结果，不为统一形式新增本地 journal 或虚构远端 readId。

native 释放只等待自身读写、buffer、waiter/thread 的安全结算，不等待所有页面；移交父端的独立文本可继续解析。正常来源退役仍需保存轻量节点、停止新 reader、既有 reader 结算和已知 native 责任完成；各部分失败可以分别清理安全资源，不伪装成全部成功。

### 4.4 所有权随运行模式变化

| 模式 | authority / provider 父 owner | 页面或 Host 断开 | 真正 owner 消失 |
| --- | --- | --- | --- |
| live-runtime | Supervisor / Supervisor | 页面仅失去 reader；Host 消失不结束 Supervisor 中会话 | 不恢复会话；必须区分 provider/主体是否已退与内容是否丢失 |
| snapshot-only | Host / Host | 页面仅失去消费者；Host 生命周期继续沿当前本地会话语义 | 不意外变成持久运行；provider 需受控结束并明确未确认责任 |

子进程退出可证明该子进程本身结束，但不能单独证明终端主体也已退出、源完整或所有外部持有资源都消失。父 owner 消失时的 IPC 断开、主动停止、原生同步卡住时的外部终止路径及直接 child 退出确认必须按平台定义；仅依赖 provider 的 JS disconnect 回调无法兜底其 native 同步阻塞。不能以新增进程隔离替代这项实施阻塞。

## 5. unknown 有界处置与预算

首选准入规则：创建前在所属 authority 内串行预留 provider 槽；出现首个 unknown 时停止该 authority 的新创建，不影响其他已接收会话的安全输出/收尾，也不重启共享 Supervisor。已预留但尚未取得资源的启动撤销；已经开始的操作继续按原 owner 结算。unknown 会话不准 resize/clear/重复 close，provider 句柄、首次报告和有限逐资源记录继续占账，不通过换 generation 逃避责任。

停止新建不能让未知数凭空固定为1：已有 live 和在途 start 后续也可能进入 unknown。界限取决于预先允许的 provider 槽数 N 和已计入槽内的启动数量；首次 unknown 后不再增大 N，unknown 数不超过当时已准入集合。只有相关已知 owner 的同一操作补证或经另行验证的终止路径完成，且其他准入条件仍满足，才释放槽/恢复新建。迟到 released 更新当前状态，不覆写首次 unknown，不重发旧 OutputSeal。

当前源码没有明确的生产最大会话数，D4 的 N=2/Q=1 只是诊断模型。不能偷偷引入32等用户会话上限，也不能拿无限已准入集合宣称全局有界。生产 N、启动并发、信用字节数和结算回执上限需由新进程成本与目标负载决定，在默认启用前冻结；有限原型可显式限定两个受控会话，不外推为产品容量。

| 预算类别 | 现有依据与本轮候选 | 到点允许做什么 |
| --- | --- | --- |
| 控制受理/启动握手 | 新异步接口需要独立期限；当前 client 不能假定已有统一 request timeout | 报未确认，保持同一请求责任；不推定 native 未执行或自动重试 |
| Agent graceful stop 升级 | Host 与 Supervisor 现有5000ms等待，可先保留现行为；它不是 EOF 预算 | 请求 force stop，仍分别等待真实主体、源、资源结果 |
| 源排空与内容移交 | 无已批准生产毫秒数；必须覆盖成功写入尾部、在途 read/消息/decoder | 观察到期本身不封口；只有已批准取消且所有权结算后才 interrupted |
| 资源释放观察 | 要求父端可响应；诊断100/1000/30000ms不自动适用生产 | 首报 unknown 并停止准入，保留迟到同操作证据 |
| reader 应用/幂等回执 | 页面已有写回调；仍需数量、期限和失联规则 | lost/cancelled/不可确认，不补造 applied，不让页面无限占 native |

Host 输出32ms/16ms调度、750ms延迟上限和256KiB分页都不是退出完成预算；分页还允许单个超大事件，不能充当 IPC 或总内存界限。收尾期限、取消条件和成功写入尾部的保证必须一起设计，不能以“不等待普通后代”为理由固定等待后立即关闭终端。

## 6. 兼容与分发支持

本节前期现状保留为历史；当前A5构建/默认分发收尾以第37节为准，平台provider及Node/Electron的实际增量见32至35节。

新路径分别协商主体/源/资源事实及 reader settlement 能力，不能凭已有分页能力推导退出完整性。旧 live 继续使用 metadata 中的 backend/storage/session/executionKind 及原 generation 绑定，不迁移、不重启、不补造新能力。旧 client 接新服务使用明确旧分支；只有双方 opt-in 才发送新 mandatory 字段。

新路径启用后，新创建只使用具备完整能力的新 generation；当前目标缺能力时明确拒绝新路径，不能静默回落旧 generation 或声称新保证。默认关闭的有限切片未启用时仍走既有路径，不计作新能力验收。启用新能力的 generation 命名和显式回退规则需在接入时冻结，不能在旧 live 所在 storage 原地重启服务。root 稳定归属仍由 F-03 独立设计。

实际 runtime 选择在 `panel/runtimeHostBackend.ts:282`：默认使用 Extension Host 的 `process.execPath`，通过 `ELECTRON_RUN_AS_NODE` 启动，launcher 再使用同一 executable。provider 首选复用这个机制，不另带 Node；但诊断 Node22.23.2 不能代表 VS Code manifest 的 `^1.80.0` 宿主或远端 Node。远端 SSH/WSL/容器按远端 Extension Host 的 OS/arch 选资源。

| 当前打包平台 | 现有分发内容 | 新候选的证据限制 |
| --- | --- | --- |
| Linux x64 / arm64 | pty.node | x64 的有限 Node 诊断不覆盖 arm64、实际宿主或其他 libc |
| macOS x64 / arm64 | pty.node 与同源 spawn-helper | arm64 U1-0/U1-6 不覆盖 x64、Electron 或 packaged |
| Windows x64 / arm64 | conpty.node、console-list addon、conpty.dll、OpenConsole.exe | x64 DLL 对照不代表新 provider、builtin 或 arm64 通过 |

`scripts/build/build.mjs` 目前没有 provider 入口；`scripts/release/package-vsix.mjs:421` 搬运六组上游 prebuild，缺项会跳过。开发 loader 优先 `build/Release`，VSIX 却复制 prebuild，因此本地编译成功不等于用户装到同一 binary。受控 native 分支必须绑定源码版本、构建输入、addon/helper/DLL、摘要、真实装载路径及包内校验；不能以编辑 node_modules 交付。

Node-API 减少 V8 ABI 耦合，不豁免最低 N-API、C/C++ runtime、OS/libc、架构和 TSFN 生命周期验证。当前 bridge 只传 useConpty，固定 node-pty 的 useConptyDll 默认 false，包内存在 DLL 不证明当前生产已选 bundled。Windows 后端与最低支持版本须显式选择。macOS 现有 helper chmod 不证明自编产物的签名/分发条件；要确认实际适用的签名要求，不预设所有场景都必须另购证书。Web-only、其他架构、Linux musl 没有独立条目，不在本轮默认增加支持承诺。

## 7. 最小 A/B 对照的条件与边界

本轮不把 A/B 对照设成所有设计工作的前置，也不执行。若仍需验证同步阻塞隔离或进程成本足以改变选型，只允许先把以下最小草案补为可执行协议；当前未确定平台实现、时间数值与安全控制通道，**不是已冻结可运行实验**。

两臂均将 authority 留在控制父进程、使用相同受控会话和通信。S 臂 A/B 共用一个 native provider 进程，P 臂每会话独立进程；S 只代表共享 native 故障域，不冒充当前产品完整复刻。A 先自然退出，取得自身尾部、真实源 EOF、移交与应用完成、主体结果，再在最终 Close 前进入有限 native 同步 gate。分别记录 release 调用进入未返回、实际 Close 尚未进入，不把门控说成真实 Close 挂起。

独立观察者确认 gate 后才生成 B 的新 nonce，经真实 PTY 输入由 B 计算带身份响应，必须经过正常输出路径到 authority，不能拿终端回显或私有控制回执代替。P 臂要求 B 在 A 仍被 gate 保持期间完成自身尾部、最终状态及资源结算。A 首次资源观察仍为 unknown；若用诊断 N=2/Q=1，须在 B 已释放槽后请求 C 并因 unknown 拒绝，C 不实际创建 PTY，否则只能证明容量满。

gate 必须有限自动解除，另有不依赖被阻塞 JS 的观察和外部安全终止；解除后实际 Close 至多一次，同操作迟到结果不覆盖首报。直接 owner 退出无法确认则停排、保留 unknown/not-run，不以 runner 销毁或日志 PID 证明释放。该对照不覆盖永久不可中断调用、真实 OS Close 故障、native 崩溃、在途内容取消、实际 Agent 或产品整链。

## 8. 阻塞项与后续顺序

不把全部问题设为同一前置清单。以下分为有限实现前必须明确的接口安全条件和默认启用前的产品门槛，通用工具增强不列阻塞。

| 编号 | 归属与闭合条件 | 阶段 |
| --- | --- | --- |
| PI-01 IPC-OWNERSHIP | bridge/adapter：确定启动握手、传输/信用和回执、取消/失联、迟到结果，证明每段内容只有明确责任方 | 有限接入实现前 |
| PI-02 OWNER-LOSS | 平台 provider：父消失及同步阻塞时的外部处置、直接 child 确认、不可证明时停排，不意外持久化本地会话 | 有限接入实现前 |
| PI-03 TWO-MODE-WIRING | 两 authority/reader：确定 prepare-bind-start、真实 flush、身份校验、本地应用结算、新旧 capability 和 generation | 接入实现前；真实双模式通过在启用前 |
| PI-04 BUDGET-ADMISSION | provider/authority：按实际成本冻结 N/启动并发/帧与信用、观察/取消/回执预算；原型只采用显式固定负载 | 默认启用前；原型自己的安全界限须先定 |
| PI-05 HOST-ARTIFACT-MATRIX | 构建/发布：宿主运行时与 N-API 下限、六资产支持声明/来源链、Windows 后端、签名条件与真实 packaged 装载 | 默认启用前；首个切片仅选实际验证环境 |
| PI-06 PRODUCT-EXIT | PTY/Host/Webview：主体尾部、最终状态、reader、资源、Agent 启动链、stop/delete/断连及旧 live 共存 | 默认启用前，按实际支持格逐项报告 |

该阶段安排的 PI-01/02/03 接口收敛由第9至12节承接。当前下一步仅实施 S1 无 native 核心切片；真实 pipe、平台处置、两模式业务接入仍各自受对应安全门槛约束。本轮没有发现必须先执行 A/B 才能定义这些接口的决策分歧，第7节继续是未冻结可运行的草案，不执行、不自动追加 U1-7/W1。

随后才规划默认关闭的共享 adapter 与两模式接入切片及其定向测试，逐平台复用已经建立的原生事实来实现 provider；不另起通用诊断框架。先验证所改业务路径，再补真实宿主、Agent、打包及支持范围。未覆盖的平台不能降格旧保障后宣称整体新保证，缺能力时行为须明确。PI-04/05/06 是默认启用门槛，不阻止安全接口设计或范围受限的实现评审。

本设计阶段的验收是：三个只读专项核对覆盖接口、隔离、分发；代码锚点可定位；与既有生命周期契约及产品边界一致；两树正文/索引/计划/技术债同步；旧源码、实验、断言与证据不改。没有产品通过或“退出完整性交付完成”的结论，计划继续 active。

## 9. PI-01：共享接口与有界内容移交

### 9.1 创建身份和一次启动

本节冻结 S1 的接口语义，不批准真实 native 接入。`ExecutionIdentity.executionId` 直接取本次 sessionId，不另建第二份会话索引；新路径的 sessionId 用 UUID，不复用当前本地 `nodeId-kind-Date.now()`。`generation` 是 prepare 时分配并固定的绑定 nonce，用于拒绝旧连接/回调，不是 `CURRENT_RUNTIME_SUPERVISOR_GENERATION` 的 storage namespace；握手 token 复用该 nonce，不再加第三个实例标识。PID 只是已证明创建后的属性，不能拿它定位资源所有权。

共享模块提供 `prepareExecution(identity, launchSpec)`，返回只在内存中存在的 PreparedExecution；不加载 native、不 spawn。authority 先登记预留 session、tracker 和有限接受队列，再单次 `bind(observer, consumeBatch)`，得到可 `start(operationId)` 的句柄。observer 包含同步data接受及processResult、outputSeal、resourceResult、fault通知；独立的consumeBatch由受信authority注入，返回该批真正消费的Promise，只有其成功才生成consumed，不能反过来相信transport输入的consumed代表authority完成。authority 应用结果由 authority 自己产生。未 bind 就 start 拒绝；相同 start 操作共享原观察，换 operationId 再 start 拒绝。任何 await 前即完成预留，防止 Supervisor 在 journal 创建期间并发创建同一 sessionId。

启动状态按 `prepared -> bound -> starting -> running` 推进；失败转 `closing` 并结算自身责任，不能直接删映射。start 首报只允许 `started(pid)`、`rejected-before-acquire(reason)`、`failed(stage, reason)`、`unconfirmed(stage, reason)`；后两者不表示没有资源。握手 ready 只证明 provider 已可通信，不证明 PTY 已创建。ready 前后超时均保持同一次启动；收到迟到 started 不再次 spawn，若已有关闭意图，立即沿同一执行请求停止。拒绝发生在 acquire 前必须有相应事实，不能用计时推断。

rejected-before-acquire仅指任何provider进程或PTY资源取得前的本地拒绝，可释放纯内存预留，不发布虚假进程退出、EOF或OutputSeal。provider已经spawn但尚未创建PTY也属于有资源的失败，必须结算provider/control责任，不能仅因主体未启动删除槽位；已开始的主体/源仍按各自事实结算，无法确认就保留unknown。

### 9.2 传输和消息

真实传输候选为 `spawn` 的 `stdio: ['pipe', 'ignore', 'pipe', 'ipc', 'pipe']`：stdin 输入、fd4 终端输出、Node IPC 控制，stderr 有限诊断；provider 保持直接 child，不复制 Supervisor launcher 的 detached/unref。启动期间所有监听在 start 许可前安装。fd4 的跨平台异步封装尚未验证，Windows pipe/overlapped 需独立确认；禁止同步 write、同步等待和未经核验把 stdout 当异步通道。S1 只通过注入的内存 transport 接收消息，不调用 spawn 或打开这些 fd。

输出采用4字节无符号大端长度前缀加 UTF-8 JSON；长度是 payload 的编码字节数，不是字符串 length。payload 包含 `version: 1`、identity、连续 `frameId` 和 `text`；完整有界帧到齐才解析，超长在读取前缀后拒绝，截断/非法UTF-8/错误类型不静默替换成合法输出。发送前以实际 JSON 编码字节计费；转义成本也算入额度。Node chunk 不是帧边界。frameId 从1开始，不回绕，仅关联移交，父 adapter 独占 data sequence，authority 独占 terminal revision。

| 方向/消息 | 语义与顺序 |
| --- | --- |
| provider → parent：ready | identity 与能力吻合；此前不得创建 PTY。ready 后 parent 才发送唯一 start |
| parent → provider：start / requestStop / cancelOutput | 带 operationId；后两者与最终 release 分开；同请求不重复执行 |
| provider → parent：operationObservation / processResult / resourceResult | 操作受理、确切主体结果、逐资源结果分开；首次未确认与同操作迟到结果并存 |
| parent → provider：accepted(throughFrameId) | 已校验、取得独立副本并成功交给有限 authority 接受入口，转移内容责任；不归还信用 |
| parent → provider：consumed(throughFrameId) | 已知连续批次经过真实消费屏障，按本地原计费归还信用；不接受对端自报新增额度 |
| provider → parent：sourceEnd(finalFrameId, disposition) | read/worker/decoder 已结算且最后帧得到 accepted 后才发送；父侧要求finalFrameId严格等于已连续接受的尾值，空输出为0，少报/越过均拒绝，再结合进程观察发 OutputSeal |

Node send callback、write callback 或 drain 都只是传输事实，不是 accepted、CLI 已读取或终端已应用。ACK 迟到/丢失不自动重发输出或输入；实际断连后的前缀处理见9.4。相同连续水位回执幂等，倒退、越过已发送值或身份不符拒绝。任何重复数据帧不是重发授权，不能二次进入 authority。

### 9.3 信用必须覆盖解析队列

`serializedTerminalState.ts:175` 的 write 只累加 pendingWriteData。因此 accepted 仅允许 provider 释放对应文本副本，不能返还额度；否则无限积压只是被搬到 authority/xterm。S1 采用一个有限消费批次，以注入的 consumeBatch Promise 作为消费边界，测试控制其成功/失败，不声称已执行真实xterm。实际接线时批次进入既有 authority 串行队列并复用 tracker.flush，确认前序解析完成后才 consumed。若处理过滤后无终端文本，仍需对应串行操作完成；不能凭空跳过源帧责任。

每个 frame 的费用直到消费完成一直占额度，分别限制字节和帧数。接收入口在复制/入队前预留原始字节及队列额度，部分帧和4帧让出期间的未解析内容同样占账；同一帧从原始缓冲转为已接受数据时转移记账，不另外释放窗口或无限保留chunk/切片队列。provider 未收到 accepted 前留副本；parent 已接受即承担保留责任，即使 accepted 未送达也不能删除重建。sourceEnd 等 accepted，不等 consumed；native 释放按自身安全条件推进，不因为页面或信用未返回无限等待。父侧信用计算复用已接受 frame 的关联，不另造持久终端水位。provider只有实际收到新的合法consumed后才恢复本地发送额度，不因父端已发送或已flush推断信用。

有限切片配置固定为最多2个执行、启动并发1、每输出 payload 最多32KiB、每会话未消费费用最多256KiB且最多16帧；费用含4字节头。控制普通帧最多4KiB，一次 start 最多64KiB且发送前校验（包括 env，不记录秘密正文）；每方向至多1个 send 在途、8个普通待发送槽和4个紧急槽，另有独立的单次 start 槽。accepted/consumed 和未发送 resize 可合并，已发送操作不撤销；紧急槽留给 stop、cancel、终态/错误，耗尽则协议失败并停止新准入，不无限缓存。输入独立上限64KiB、至多1个写在途，满时拒绝尚未受理部分并返回背压，不自动重发按键。stderr 仅保留64KiB，超过标记诊断截断并继续排空，不截断终端输出。

这些数值是受控负载的安全配置，不是生产容量或响应 SLA，也不表示总 RSS 上限；JSON/字符串副本、OS pipe、xterm状态和 journal 保留另计。真实 provider 必须在每次 read 前预留预算，限制在途 read/worker 消息/decoder和编码膨胀；仅暂停父端 fd4 不足以证明上游有界。该 native 预算绑定未完成，阻塞真实 native 切片，不阻塞 S1 的内存接口实现。消费失败不返还未确认批次信用；停止新建，保留已接受前缀和失败事实，不把缓存快照当成功。

每个事件循环回合处理至多4帧，再通过异步任务让出；不递归排 microtask 耗尽回合。控制处理不排在等待信用或 flush 的同一任务后，否则会自等待。上述调度在 S1 验证状态机互不占用，不宣称已通过真实双 PTY 的公平性或同步卡住隔离。

### 9.4 取消、失联与第一次观察

操作 deadline 是调用者给出的有限观察预算；S1 测试使用注入时钟和显式到期事件，不新增诊断观察器，也不把测试100ms设置升级为生产超时。到点返回 unconfirmed/unknown，保留同一 operation；迟到事实更新当前观察，不覆写首次报告。不得因 operationObservation 超时直接生成 sourceEnd、重复 Close 或声称未执行。

IPC disconnect、provider exit、数据 pipe end 分别记录。失联后仍处理能安全取得的完整在途帧；控制失联不立即抛弃 fd4 内容。完整可用前缀已移交、部分帧与无法确认范围已记录后才 error/unknown 封口，不能当 PTY EOF。数据通道本身仍未结算时先返回观察结果并保留 owner，不为满足期限虚构封口。真实 EOF 或取消谁先生效按事实判定，已取得 buffer/消息/decoder 不能因 cancelOutput 被静默清空。

## 10. PI-02：owner 责任，不追加崩溃清零承诺

| 情形 | 固定责任与可实施接口 | 仍不能宣称 |
| --- | --- | --- |
| owner 正常关闭 | 先停止新建，发具名 stop/cancel，保留事实监听和已取得内容，逐项报告；超时保留原操作与未知责任 | 先删除 session/撤监听再 kill 等于完整关闭 |
| owner 存活、provider native 卡住 | owner 独立观察并冻结准入，其他已准入会话仍可安全推进；可从独立控制路径请求终止该 provider | 被卡住线程上的 timer 可兜底，或 kill 请求成功等于 child 已退出 |
| provider 崩溃、owner 存活 | 应用已接受前缀，记录丢失/未确认范围，安全资源各自回收，其余占账 | provider 退出等于实际主体退出、PTY EOF或外部对象全消失 |
| owner 突然消失 | 视为异常失联；不恢复进程/历史，不伪造完成。新拓扑增加的孤儿风险必须在启用前审查 | 已确认自动干净退出，或新增“所有主体/后代立即清零”保证 |

live-runtime 的 owner 是 Supervisor，不是 Host/Webview；snapshot-only 的 owner 是 Host。正常关闭时不可因移到子进程就意外把本地会话变成脱离 Host 的持久服务。异常 owner 崩溃与正常关闭区分，不把用户“不要求故障恢复”解释成主动重启共享 Supervisor 清理单会话的许可，也不扩展为跟踪所有普通工具后代。

平台接口以 `prepareOwnerBinding(identity)`、`requestExternalTermination(operationId)`、`observeTermination(subjectToken)`、`releaseControl(operationId)` 表达各自能力；只允许使用已取得的直接 child/原生控制 token，不能从日志 PID 重建可杀句柄。平台返回请求受理、provider终止、主体终止和控制资源释放的独立事实；unsupported 明确返回，不能自动退化为外部 PID kill。owner 正常关闭走已定义 requestStop/cancelOutput，不重复执行原生最终 release。

当前源码不具备新的父存活绑定：Linux forkpty/exec（`node_modules/node-pty/src/unix/pty.cc:438`）、macOS posix_spawn/helper（同文件`:758`）和 Windows CreateProcessW（`src/win/conpty.cc:412`）不能证明 owner 消失后必停。Linux PDEATHSIG 有注册竞态、创建线程/凭据/exec限制；pidfd不自动给出非直接child的wait结果。macOS native线程或kqueue观察不证明provider崩溃后的主体必停。Windows Job kill-on-close可能改变后代终止范围，并受创建/加入竞态、宿主Job和ConPTY资源影响。它们只是待评估的平台手段，不是已经选择的API，不是S1共同前置；本轮不新增guardian或服务。

PI-02 的责任分类已收敛，平台失联处置仍开放。真实 native 切片必须先明确该平台的正常停止、卡住时的控制权和安全结束方式；异常 owner 消失造成的新增风险在默认启用前按实际支持环境验证/记录，不能借范围收窄隐去风险。S1不创建进程或终端，只验证同一份adapter如何保留这些事实，不标为OS回收验证。

## 11. PI-03：两模式、两种消费者与升级

### 11.1 authority 接线

Supervisor 的 sessionId 默认 UUID，但允许调用方传入（`runtimeSupervisorMain.ts:423`）；必须在首个 journal await 前预留并拒绝并发重用。Host 本地 `createExecutionSessionId()`（`CanvasPanelManager.ts:27311`）目前依赖毫秒时间，新路径改为UUID。既有 operation token继续保护用户的新请求；所有异步继续执行都核验 `map.get(key) === capturedSession` 和绑定身份。旧回调不得改后来会话，但仍继续结算它捕获的旧owner，不能因为对象不再在node映射就忘掉责任。

两条本地创建与Supervisor内部均按 prepare/bind/start 接线。ProcessResult只关闭新输入/native resize；OutputSeal关闭新终端操作，已接受操作在原串行链内完成真实tracker.flush。成功固定finalRevision的同一无await边界关闭新reader准入，先前获准/回包在途open仍结算；parser失败记录已应用前缀，不从缓存补成功。删除、start失败、finalize和journal异步删除之后均需再次比较捕获对象；这些落点不能只修改 onExit 回调。

### 11.2 远端与本地完成消息

远端沿现有 closeExecutionTerminalRead → relay → client → Supervisor 增加 outcome：`applied(finalRevision)` 或 `cancelled(reason)`，socket owner失效由服务端记lost；旧缺outcome的close仅legacy-released。复用原sessionId/authorityId/readId/appliedRevision/sentRevision；服务端核验最终值已固定且已发范围覆盖后，先留有界幂等结果再删cursor。相同结果重试可确认，冲突拒绝，过期只回不可确认/已释放。reader关闭或RPC失败不以onReleased回调冒充应用成功。

本地不能虚构authorityId/readId。沿现有 host 退出通知携带可选 `localCompletion: { executionSessionId, finalOutputSequence }`，绑定实际发送surface的WebviewLifecycleIdentity；新增显式结果消息 `webview/executionLocalTerminalSettled`，回传同一身份及 `applied(finalOutputSequence)` 或 `cancelled(reason)`。这只是本地最终屏障，不新增持续消费水位、journal或已结束正文保存。消息名称/字段作为本轮接线输入，须在两端normalizer和能力协商一起实施，不在S1修改现有消息。

页面已有 currentLocalOutputSequence 只在接收时前进（`webview/main.tsx:8072`），不能作应用证明。localCompletion必须等待序列连续覆盖最终值、pendingOutput全部进入既有writeChain、前序真实xterm callback成功，再发送一次applied；空输出也经过屏障。controller沿既有writeGeneration排除旧投影回调；销毁、换页、渲染失败分别cancelled/lost。writeChain的catch不能吞掉错误后让末尾sentinel成功。

普通snapshot ACK不能复用成最终完成证明：健康投影会忽略重复snapshot，而现有onSnapshotApplied可发生在实际写入前（`webview/main.tsx:7858`、`:7940`）。因此本地final barrier即使snapshot未重放也必须执行，最终snapshot实际排入写队列时也要包含在屏障内。Host当前应用ACK排除local（`CanvasPanelManager.ts:16763`），须新增本地分支并校验会话、surface生命周期和已发送最终序列。晚到结果只能结算原reader，不更改新会话。

### 11.3 能力与 namespace

保留当前 `common/runtimeSupervisorPaths.ts:23` 的 `terminal-stream-v1`，S1不改它。真实接入候选使用独立namespace `execution-lifecycle-v1`，只改变新会话目标，旧metadata原storage/backend/session/kind继续路由。namespace不是9.1的执行绑定nonce。不得在同storage原地重启旧Supervisor或在缺新能力时悄悄走旧创建路径。

hello与会话能力分别增加 `executionProcessResultV1`、`executionSourceEndV1`、`executionResourceSettlementV1`，reader沿既有候选 `terminalReadSettlementV1`，本地页面使用 `terminalLocalSettlementV1`。它们是新字段，不存在于当前只含六个stream/projection/paging能力的hello。create/open明确opt-in并核对实际session能力；不能只看server支持就替旧provider补证明。Webview ready当前没有capability payload，必须在实际接入时增加可选能力声明；新字段只有两端协商后发送。旧端保持旧分支，不把无ACK标为应用成功。

双方启用新路径且任何必需能力缺失时，在创建前明确拒绝；实验入口未启用时保留现有行为且不报告新保证。旧live不迁移、不自动重启、不补造EOF。回退仅影响未来新建，已创建的新能力会话仍按原绑定保留可控制路径，不能因关闭开关卸掉其adapter；旧client退役仍等待会话、pending请求和reader归零。

## 12. 阶段收口与下一有限切片

PI-01 已有一次启动、消息/身份、accepted与consumed分离、帧与队列限额、封口及失联规则；真实异步pipe和native read预算未闭合。PI-02 已有四类owner事件责任及最小hook，不声称平台自动回收。PI-03 已有两authority偏序、远端close与本地final barrier、能力和namespace输入，但未接线或验证。三项不能统一标“通过”；本轮的完成定义是实现输入明确且剩余风险有落点。

**下一阶段只做S1无native核心，不再安排另一轮泛化设计或诊断工具完善。** 在主运行时树新增 `src/common/executionLifecycle.ts` 的共享事实/消息类型与校验，以及 `src/panel/executionSessionAdapter.ts` 的 prepare/bind/start、有限接受/消费、封口和首次/迟到观察逻辑（路径前缀为主扩展）。保持无vscode、node-pty、spawn依赖，不从现有业务入口导入，不改manifest、CURRENT_RUNTIME_SUPERVISOR_GENERATION、Host/Supervisor/Webview路由或现有运行模式；因此没有用户可达的新native路径，也不需要新增实验开关。注入transport与observer，随后真实provider接同一实现，不复制成独立D系列模型。

S1命令范围只含一次start、graceful/force stop各一个语义操作和一次cancelOutput；同operation重复共享结果，换id重发同一语义操作拒绝，不建立无限幂等记录。真正的输入/resize传输、reader消息和平台hook实现不属于S1，9至11节对应规则是后续接线输入，不因S1通过就宣称这些路径完成。

两个执行共享同一注入的authority准入上下文：N=2和启动并发1不是各会话独立额度，首个unknown禁止该上下文新建但不停止已准入B的安全处理。它只管理当前authority已有预留和执行引用，不引入全局owner注册表；测试不得用两个互不关联的准入器代替这项规则。

S1测试沿现有 `scripts/test/test-execution-session-bridge.mjs` 的esbuild+assert方式新增 `scripts/test/test-execution-session-adapter.mjs`，直接测试拟交付模块。固定覆盖：bind前不启动/同start不重入；旧身份拒绝且旧owner不遗忘；accepted不返信用、消费Promise成功后单次返还；零信用、超长帧及未解析队列受控限界；exit先到仍接尾部、process pending不能seal；source越过或少报接受尾值均拒绝；取消/断连保留可用前缀且不造EOF；首次unknown和同操作迟到补证；注入消费失败不伪applied；两个内存执行的预算与控制不串用。使用显式假时钟/延迟promise，不新增writer、oracle、归档、runner或真实进程；测试数量不折算native覆盖。

每个S1默认配置与本设计的受控界限一致，非法配置在prepare时拒绝；没有生产停止/排空时限默认值。S1结束须报告定向测试、typecheck和相关既有bridge回归，以及两个真实authority尚未接入的事实。它不能单独关闭PI-01/02/03或退出完整性总债务；后续真实transport/native和两模式接线按各自风险推进，不要求先跑全部U1/W1，也不把S1假provider当双PTY/真实Agent验收。

## 13. S1：无 native 共享核心实施

### 13.1 实际代码与边界

主树新增 `extensions/vscode/dev-session-canvas/src/common/executionLifecycle.ts` 与 `src/panel/executionSessionAdapter.ts`（后一文件同扩展前缀），并以 `scripts/test/test-execution-session-adapter.mjs` 直接打包加载。它们是后续 provider/authority 共用的实际模块，不是新的 D 系列观察器或资源模型。没有 vscode、node-pty、spawn 依赖，没有业务导入、真实资源取得、输入/resize、reader 消息、平台 hook、manifest 或 storage generation 变更；现有 Host/Supervisor/Webview 路由不变。

`createExecutionAuthority()` 管理同一 authority 的两个槽和一个启动槽，并在各槽保留 identity 与 execution 强引用，直到安全退役；unknown 的责任记录不依赖外层 node 映射继续存在。`prepareExecution(identity, spec, dependencies)` 同步保留纯内存预留，校验并复制启动参数，随后单次 bind。transport 与 scheduler 均显式注入。S1 直接固定 `S1_LIMITS`，不开放任意数值覆盖；非法身份、启动参数或控制 envelope 拒绝，新的操作必须提供晚于调用时刻的有限绝对 deadline。重复同操作共享原观察对象，deadline 过后仍可取得原首报，不重新启动计时或请求。

跨入 transport.connect 前登记 provider-control 责任；即使 connect 抛错也不能声称 acquire 前拒绝。只有 authority 启动准入在 connect 前的本地拒绝可释放纯内存槽。ready 不证明实际主体创建；一次 start、graceful/force stop 各一次及一次 cancel 分别保留首报与当前补证，不从发送完成推断操作生效。已封口或退役后迟到 started 不得回到 running。

输出的4字节头、UTF-8 JSON、连续 frameId 与 data sequence 校验按第9节实现。所有原始分片和未消费内容共用字节/帧预算，解析每任务最多4帧；scheduler 必须提供异步任务，不用递归 microtask 耗尽回合。完整接收前缀由 adapter 保留；超额新 chunk 在复制前拒绝并记录 rejectedDataBytes，不能因此停止处理此前已拥有的原始前缀。格式错误的有界原始残片继续留账，不冒充正常 EOF。

accepted 只移交责任；受信 consumeBatch 成功后才生成 consumed。`OutputCreditWindow` 由未来 provider 复用，只有实际接收合法 consumed 才按原编码费用返还。回执合并仍保持 accepted 先于相应 consumed，控制队列不等待消费 Promise。消费失败公开 authority failed 前缀，保持未确认批次费用，不生成 applied；真实 authority 的 finalRevision 与 tracker.flush 接线仍未实施。

sourceEnd 必须严格等于连续接受尾值且没有原始在途内容，process pending 不封口，process exit 不关闭尾部准入。IPC disconnect、provider exit、data end 分账；单独 provider exit 不补造主体结果或源 EOF，失联时等可用前缀处理及数据通道结束后才结算 unknown/error。OutputSeal 只发布一次，迟到 process/resource 更新不改旧 seal。

S1 每执行最多登记16个具名资源记录，记录首次/当前结果及唯一 release operationId；这只是共享核心的有限责任账，不是 native Close 实现或 OS 对象消失证明。重复、非法或超限的取得报告使 resourceLedgerIncomplete 保持为真，不能用已登记旧资源全释放来掩盖未能登记的新责任。只有责任账完整、所有已知资源、已接受内容和主体事实结算后才释放内存槽。首次 unknown 冻结该 authority 的新建，既有 B 的控制/消费继续；正常 provider 退役且事实已齐备时，后续 transport 关闭不触发故障熔断。

### 13.2 验证记录

首轮测试装载遇到两项测试入口问题：esbuild 输出路径与 require 路径不一致、fixture 多传 LaunchSpec 未定义的 cols/rows；均发生在用例执行前。仅修正新测试入口与 fixture 后，首次17项定向测试通过；未改既有测试或冻结原生输入。首轮整体 typecheck 发现 callback 中 union 窄化丢失（TS2339），以捕获 operationId 修正。既有 bridge 回归首轮通过。

独立只读复审发现并修正三项直接实现问题：慢 send 下合并 consumed 可能越过 accepted、正常 provider 关闭误冻结 authority、迟到 started 使已退役状态回退。补充直接回归，并修正超额新 chunk 不得阻断已保存原始前缀。这些是本轮新代码问题，不追认为旧平台或真实 Agent 的新实测故障；对应新增回归首次运行时修复已到位，不声称这三项都执行过先红后绿。

Linux Node v25.6.0 的最终 `node scripts/test/test-execution-session-adapter.mjs` 为32/32测试组通过，`npm run typecheck`、`node scripts/test/test-execution-session-bridge.mjs` 和新测试脚本语法检查通过。17/17、22/22、25/25、31/31到32/32是同一入口逐步增加覆盖的各轮结果；最后一组验证责任登记失败后不能误退役，不累计成原生样本。独立只读复核完成，验证覆盖固定内存契约及正常/负向交付路径，没有实际 PTY、provider 子进程、真实 xterm、reader、macOS/Windows、VS Code 或 packaged 通过声明。

两树各八份当前文档同步；八份设计元数据、索引状态及关联路径检查通过，生产接入正文一致，原第2至12节保持，历史实验正文与两份计划的12章节顺序保持。一次性历史检查曾将总设计第6节的当前导航误算作冻结历史，明确两段导航的范围后重核通过；没有修改历史来适配检查。每树既有 tracked 变更仅八文档，主树另新增三个 S1 文件，现有业务与诊断源码不变；两树 `git diff --check` 通过。本轮只本地提交，不推送或触发 runner。

### 13.3 下一有限切片

下一阶段为 S2 真实异步 transport/provider 启动链，仍零 PTY、不接现有业务。先冻结有限目标环境、双向消息/输出 pipe 的真实异步契约及直接 child 的正常关闭和失败清理，再实现复用本模块的有限接线；不另起通用诊断框架，不要求先补齐全部 U1/W1。真实 native 接入仍需 read/worker/decoder 预算和该平台安全停止/释放前提，双 authority、页面最终应用、Agent 启动链及 packaged 验收各自保留。此 S1 收口不授权自动运行 S2、native、runner 或推送主分支。

## 14. S2：真实异步启动链与零 PTY 受控验证

### 14.1 本轮运行前边界

仅在本机 Linux、当前 Node v25.6.0 运行；不宣称 macOS/Windows、Electron 或旧宿主可用，不触发 runner。主树新增 `src/panel/executionProviderTransport.ts` 与 `src/panel/executionProviderChannel.ts`（均为主扩展前缀），复用 S1 adapter、帧和信用实现。业务入口、manifest、root归属、storage generation、旧 live 绑定及冻结诊断不改。需要的 S1 窄修和对应定向回归随本切片完成，不新建另一套生命周期模型。

父侧按 `spawn` 的 `['pipe','ignore','pipe','ipc','pipe']` 创建直接 provider child，非 detached、不 unref、不经 shell。runtime executable 和 provider entry 明确注入，不在模块中猜测 VS Code 可执行文件；进程监听在任何 start 许可前安装。identity 只含执行标识与 nonce，启动正文仍走唯一 start，不能放入命令行或日志。S2 不实现终端输入，stdin 保持为空并在关闭时结束。

provider 侧 IPC 控制消息和 fd4 输出使用 Node 异步机制，fd4 用 `net.Socket` 包装，禁止同步 write。共享 channel 先装监听再 ready，按相同 identity/nonce 接收唯一 start，普通控制4KiB/start64KiB校验，一次控制 send 在途并有限排队。输出沿 S1 编码和 OutputCreditWindow，最多一个 write 调用在途；信用不足等待实际 consumed，不能积累任意写请求。sourceEnd 只在 read/decoder 已由后端结算、最后帧实际 accepted 后发送，不等待 consumed。channel 自身不声称普通 pipe/PTY EOF，disposition 由实际源 owner 提供。

父侧 stderr 只保留64KiB并持续异步排空，超限公开截断，不记录启动 env 正文。fd4 chunk 不是帧边界；发送端最多16帧/256KiB未消费，父侧保留 S1 原始/消费总账与每任务4帧调度。正常消费者停顿不阻断控制；异常解析/控制错误保留首个故障并允许沿已取得直接 child token 做安全终止，不用日志 PID 重建控制权。

### 14.2 资源来源与关闭

`provider-control` 属于父 transport，只能由父观察直接 child 退出、输出/诊断/input/control 通道结算后报告 released；对端同名 resourceResult 一律拒绝。provider 的退出、IPC disconnect 和 fd4 end 按真实事件分别递交；进程 exit 不能替代 pipe drain。正常收尾中 IPC disconnect 可以早于 child close，此时父控制资源仍在观察中，而不是凭 disconnect 自动成为泄漏或 unknown。缺失的主体/源/操作事实仍明确未知，外部 child 观察达到调用者明确 deadline 而未结算时才保留 provider-control unknown；迟到同操作 released 不覆盖首报。

父侧提供显式 deadline 的直接 child 终止/关闭观察，至多一次 TERM、一次必要的 KILL，各自只表示请求；没有生产默认时限，不将超时当已退出。仅对捕获的 ChildProcess 对象请求，不清共享 Supervisor，不托管任意后代。正常关闭不重复 kill 已退出 child，spawn error 无 PID 时安全销毁已取得通道，未发生主体创建不伪造正常 exit/EOF。无资源前的明确失败与跨入 acquisition 后失败仍按 S1 边界分别记账。

### 14.3 固定有限测试

新增 `scripts/test/test-execution-provider-transport.mjs`，用 esbuild 打包真实模块，夹具放同目录专用 fixture。真实拓扑为测试 authority → provider fixture → 至多一个受控 Node 普通 pipe subject；fixture 复用真实 provider channel，不加载 native/PTY、不运行用户 CLI。subject 使用真实 exit/stdout end 产生主体和源事实；provider 与 subject 分别计数，不把 provider 自身 PID/exit 冒充 Agent 主体。

固定验证正常非零退出与尾部、暂停消费时有限信用及独立 stop、sourceEnd 不等待消费、两执行共享准入与独立推进、启动失败、控制断连/部分输出非 EOF、错误身份及伪造父资源结果拒绝。每次最多两个 provider 和各一个受控 subject；测试结束必须确认直接 provider close，fixture 的正常/失联处理沿捕获的 subject ChildProcess 停止并等待。异常杀 provider 的负例仅在它未创建 subject 或 subject 已确认结束时运行，避免通过杀外层留下未知后代。

每个场景观察预算显式给定10秒，清理使用2秒 TERM 后必要时2秒 KILL；仅为本次测试上限，不是产品政策。统一 finally 执行清理，真实超时/失败保留，不自动重跑筛绿。定向测试后跑 S1 32组、typecheck 与 bridge 回归；没有新增 writer/oracle/归档迁移或通用容量审计。S2 通过仍不关闭 native read 预算、平台 owner-loss、两 authority/reader、实际 Agent、packaged 或默认启用门槛。

### 14.4 实际实现与独立复审

父 transport 提供 `createExecutionProviderTransport()`、`createNodeExecutionScheduler()`、`closed`、`snapshot()` 与显式绝对 deadline 的 `terminate()`；Linux 之外明确拒绝，本轮不作跨平台适用声明。provider channel 提供 `ready/send/write/end/close`，复用共享 `parseParentMessage()` 和 `OutputCreditWindow`。普通控制和紧急控制分别有8槽和4槽，每方向只允许一个 send 在途，四类语义命令固定占槽，不增加通用请求历史。

S1 adapter 的父 sink 增加 `dataClosed/controlResourceResult/startupFailed/transportFault`。provider-control 只能由父侧通道与 child close 结算，provider 消息无权释放；data end 与没有 end 的 close 分账。正常 IPC disconnect 早于父 close 时不误判未知泄漏。唯一 start 尚未发送、主体/源未建立的失败执行，在全部已知资源释放、无原始/待消费内容及未知责任后可退役，不补造 processResult、sourceEnd 或 OutputSeal；失败后迟到 ready 不能重新启动。失败是否解除该 authority 的后续准入冻结不是本轮的通过结论。

独立复审发现 channel 在 `end()` 等待 write/accepted 时，`close()` 提前置 closing 会拒绝仍合法的 stop/cancel并破坏尾部。修正为在等待期间继续接收控制和回执，输出 socket close 后再次排空控制，直到真正断连边界才标 closing。新增 `test-execution-provider-channel.mjs` 直接加载实际模块、仅替换 Node 通道句柄，覆盖 pending write/end/close 期间 stop/cancel、accepted非consumed屏障及socket关闭后仍在途控制。该单组内存回归通过；内存重新注入旧提前 closing 行为的负对照确实失败。这是本轮新模块问题，不追认为既有Terminal/Agent的已实测故障。

父终止操作先缓存同一 Promise 再异步执行，发信号前先登记一次性请求状态，避免同步重入重复 TERM/KILL。deadline 在入口复制并冻结，校验、缓存与异步闭包使用同组值，不再引用调用者后续可修改的 budget；同值重复调用返回原 Promise。此窄修由只读复核和加载实际transport的内存检查确认，没有派生新的观察工具或真实负向矩阵。

### 14.5 首次真实结果与验证分账

运行环境为本机 Linux、Node v25.6.0。首次完整执行 `node scripts/test/test-execution-provider-transport.mjs`，exit 0，7/7通过，未重跑；统计为 `providerAttempts=8, providersSpawned=7, subjectsObserved=4, providersClosed=8, failures=[]`。最后一个计数包含ENOENT失败spawn的transport句柄结算，并非第8个真实provider。每场景finally确认transport closed，无未结算的本轮运行中测试。

| 固定组 | 本次直接证明 |
| --- | --- |
| 正常非零退出和尾部 | 真实subject exit7与精确尾部；暂停消费仍可source seal，provider自身资源释放不等待消费 |
| 满信用与两个执行 | A占满16帧信用仍响应stop，第17帧已经拥有的内容不静默丢弃；同一authority的B独立完成 |
| provider启动失败 | ENOENT有失败和父资源释放，无伪造主体退出或EOF |
| 部分输出帧 | 已结束subject的完整前缀保留，追加的2字节残帧使source为error而非EOF |
| 错误身份 | 错identity被拒绝，不按另一执行接纳 |
| 父资源伪造 | provider自报provider-control released被拒绝 |
| 显式强制清理 | 无subject且忽略TERM的provider，经真实TERM再KILL达到close |

三个无subject的负例在subject spawn前返回；部分帧负例确认subject已结束后才处理坏帧。两执行场景是普通pipe、同一受控authority的验证，不是两个真实authority、双PTY公平性或实际Agent工具链验收。父transport的TERM/KILL清理只作用捕获的直接provider；fixture另行负责受控subject，不能推导任意后代已被托管或清理。

纯测试与静态验证单列：S1 adapter现为35/35，通过新增父资源来源、未发送start失败退役、未知额外owner阻止退役三组；channel精确定向回归1组通过。S1原32组的父资源注入改接可信sink，保留责任断言，不改旧冻结诊断来获得绿色。整体typecheck、既有bridge回归、新mjs语法及fixture独立strict TypeScript检查通过；fixture不在根typecheck覆盖范围内，因此另行检查。独立只读复核未发现本切片新的确定性blocker。

保留本轮首次失败：channel第一次typecheck出现TS2345/TS2339联合类型窄化问题，改为先确认operationId；channel回归首跑的断言预期顺序错误，第二次write实际先触发“一次仅一write在途”，仅调整断言位置；fixture单独strict检查出现TS7006，补回调类型。均不记录成新的原生平台失败，也不隐藏为“从未失败”。

真实7/7之后只补fixture类型、测试入口的deadline guard和父termination budget快照。deadline guard在观察期已过时阻止迟到创建第二个provider，4个内存hook断言通过；budget快照内存验证覆盖外部修改不影响实际期限、同值调用复用Promise。后续仅进行纯测试、类型与静态检查，未再次执行真实矩阵；首次7/7不能被改写为这些后置边界都已重新实测。没有运行PTY、native、runner、VS Code或packaged验证。

### 14.6 收口与下一有限切片

两树各八份文档同步；设计元数据、索引状态、关联路径及两计划各12章节原序检查通过。两树本设计正文一致，原第2至13节保持；总设计、生命周期和原生隔离文档除当前导航外历史正文保持。现有业务入口、manifest、storage generation、workflow与诊断源码无本轮改动，两树diff检查通过。首次一次性历史检查漏匹配S1导航而误报，纠正检查后通过，未改历史迎合检查；本次未深遍历旧归档工件。

S2交付实际模块和受控完整启动/关闭路径，不新增通用writer、oracle、归档、listener或容量验证门槛。诊断树仅同步文档，旧冻结实验、原始断言和失败结果保留。现有业务入口未导入这些模块，manifest、storage generation、root归属与旧live绑定不变；不新增completed正文历史，不声称server或机器重启可恢复。

下一有限阶段推进首个平台的真实PTY provider接入，优先利用本机Linux与既有受控node-pty工作，不再安排另一轮泛化工具增强。在首次native取得前，必须把本平台的read/decoder/编码预算、安全停止和逐资源释放条件绑定到本模块；以固定主体尾部、最终状态与资源收尾为验证目标，保留失败、unknown和主动取消的真实区别。只解决影响该次判断和实验安全的前置项，不将全部U1/W1或跨平台工具完备设为门槛。

S2尚未证明native同步阻塞隔离、真实终端输入/resize、owner失联的OS级收尾、两种运行模式的authority/reader最终应用、真实Agent启动器生命周期或packaged接线。macOS/Windows仍需各自原生证据；Windows退出对象因合法引用继续存在不自动算bug。后续须分别关闭这些门槛，不能凭本轮7/7或纯测试数目宣布产品退出完整性完成。

## 15. S3：Linux 真实 PTY provider 有限接入

### 15.1 本轮目标与来源

2026-09-25从主树`674eabfc`、诊断树`d3afd150`继续。只接通独立provider、真实Linux PTY、共享adapter和实际headless消费屏障，验证固定主体尾部、最终终端状态及原生资源收尾；不切换现有Host/Supervisor/Webview入口，不改manifest、root、generation或旧live会话。诊断树只同步文档，全部旧候选/断言/结果保留。

新native候选在主树`extensions/vscode/dev-session-canvas/native/`维护，通过`scripts/build/build-linux-execution-provider.mjs`在新的输出目录构建。复用固定node-pty 1.2.0-beta.12的Unix forkpty/termios/exec实现、node-addon-api 7.1.1及既有官方Node22.23.2 headers；只对副本应用精确源码摘要与唯一锚点补丁，不改安装源、不加载stock prebuild或旧诊断binary。构建记录来源摘要、命令及binary，显式绝对路径加载。测试authority/provider/subject均采用本机已有Node22.23.2；这与S2的Node25运行分开，不声明Electron或其他平台适用。

### 15.2 单一原生 owner 与事实

本候选不建立旧wait线程、TSFN或通知payload：provider事件循环独占`waitpid(pid, WNOHANG)`，只在返回自身pid且合法终态时解释status。每次未确认轮询异步让出，固定5ms仅为本切片调度参数，不是生产响应SLA。没有第二reaper。停止在同一次native调用内先poll：已回收或ECHILD/其他未知均不kill；返回0时未回收的direct child仍保护PID身份，再沿捕获owner发送TERM/KILL，各最多一次，不接受外部数值PID。旧v4线程/TSFN证据不代证这条新路径。

在fork前绑定一次性token，fork返回后先记录实际master/child，再创建JS结果；创建中抛错仍可读取所有权快照。master仅在O_NONBLOCK成功后可读取，固定最大4096B；真实read=0或Linux终端EIO才是源结束，EAGAIN/EINTR异步重试，其他错误为error。close只在无read调用在途后对原owner单次执行，失败/不确定不重试数值fd。native fork/fcntl/read/close仍可能阻塞，独立provider隔离父authority但不证明全部native调用有硬时限。

实际资源为PTY master及direct child的回收责任，另由JS记录read/decoder暂存的源责任；不为未创建的线程/TSFN伪造released。新增`ProviderMessage.resourceAcquired`，与resourceResult同一紧急FIFO发送；任何终态前先报告已取得责任。父provider-control仍拒绝provider登记/释放，重复或超限登记沿已有sticky不完整账本处理。start已发但创建失败不能证明主体/源建立时保持failed/unknown与准入冻结，不以exit0/EOF或父provider close冒充安全退役；本轮不宣称该分支完整交付。

### 15.3 读取、消费与取消

沿用16帧/256KiB未消费信用，加一个预分配的4096B原始read槽、最多3B UTF-8 decoder尾、一个编码/发送暂存槽；不建立无界read队列。上一read的文本经过`channel.write()`后才开始下一read；信用满时最多保留这一个已读片段并等待，控制和wait继续独立推进。初始化按实际identity与最大frameId信封验证`6 * (4096 + 3)`最坏JSON转义仍不超过32KiB payload。此有限预算包括原始/解码/编码副本，不声称OS PTY缓冲、xterm或整个进程RSS被256KiB覆盖。

主体退出不关闭已拥有输出。正常源结束后flush decoder，所有已读文本交给同一channel；sourceEnd仍等accepted、不等consumed。父消费使用现有`SerializedTerminalStateTracker.write/flush`的真实解析屏障，成功后才归还信用；对照固定预期文本和独立期望终态，不用“入队完成”代替应用完成。

requestStop只停止主体，不自动丢输出。cancelOutput停止下一read，但当前已读/解码/发送内容继续移交，随后明确interrupted；信用未恢复不伪造已完成取消。owner通信丢失属于失败清理，不能补造EOF或资源已释放；只沿原native owner控制及结算。正常退出后普通后代是否仍持有PTY、生产排空时限及平台owner失联保障仍需后续确认，本轮不将其扩成必须托管任意后代。

### 15.4 固定验证与安全停止

先执行零PTY类型/接口及有限source回归，构建并仅加载新binary核对导出；独立审查后才运行新入口`scripts/test/test-linux-execution-provider.mjs`。固定两个真实场景，各一个provider/一个无后代的Node主体，串行运行：正常exit7精确尾部/真实EOF/最终状态/逐资源释放；超过信用窗口的输出在消费暂停时仍可stop，恢复消费后保留所有已取得内容并结算。禁止自动重跑筛绿，失败原样保存；只有资源确知安全才继续第二项。

每场景显式30秒观察预算，受控subject自带20秒安全退出，清理预算另给TERM 2秒、KILL 2秒及资源观察2秒。这些只供本次受控测试，不成为产品默认值。清理优先恢复消费、向实际主体请求停止并等待原owner确认；未知主体未确认结束时不直接杀provider后继续创建。固定fixture无后代且自主退出可作为实验安全边界，但其退出超时不是产品成功；保留原始输出、结果与资源快照，不增加writer/oracle/归档框架。无runner/push，不重跑旧矩阵。

### 15.5 阶段状态

第15.1至15.4节为实施及运行前冻结；冻结时尚无S3构建、原生执行或通过结论，后续实际结果见15.6至15.7。即使固定两项后续通过，也不关闭跨平台、真实Agent包装链、输入/resize、两authority/reader、native挂起/owner失联、packaged或默认启用门槛。

### 15.6 首次运行与控制收尾修正

首次新native构建及零调用加载成功；固定Node22.23.2、node-pty源码SHA256 `19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db`，binary SHA256 `721cd46455897cf90bfb155240bf928442e30ad4558184f2c9f32c55431a3c6a`。构建证据在主树`.debug/s3-linux-provider-build-first/`，加载只核对七项导出，没有创建PTY。

随后首次固定两场景在`.debug/s3-linux-provider-first/`记录为0/2，均因父authority的`Control send failed`失败。normal主体exit7、native读取2108B；flood主体SIGTERM、读取73472B。两provider均自然关闭，native三项责任及父控制资源最终released，`allOwnershipSettled=true`，两项cleanup为safe且无额外动作。normal首报unknown保留，迟到released不覆盖首报；不能因最终资源回收而将矩阵追认为通过。

代码链存在明确竞态：channel仅等accepted便可关闭；adapter消费完成仍发送consumed；transport拒绝已关闭通道的发送；adapter又把任意发送失败立即当作整个控制链失联。反向process/resource/sourceEnd可能尚未投递，于是产生假unknown并永久冻结准入。首次trace未记录失败消息类型，只能说时序符合该竞态，不能声称原生记录已直接证明失败消息就是consumed，也不能据此归因操作系统或PTY丢尾部。

采用显式且有界的源结束确认修正，不加入等待反向事实的猜测时间窗，也不豁免发送错误：在`ParentMessage`增加`sourceEndAccepted(finalFrameId)`。父adapter收到并校验合法sourceEnd后停止生成输出信用回执，清除尚未发送的冗余accepted/consumed；新确认沿既有单send队列排在已经在途的发送之后。provider发送sourceEnd后等待同identity和精确finalFrameId的确认才允许正常close，确认不归还信用、不表示consumer完成，也不替代process或任何资源释放事实。任何start/stop/cancel/accepted/consumed/新确认的真实发送失败仍沿原fault/unknown逻辑，缺失确认不能靠超时伪装成功。确认期间stop/cancel继续服务，sourceEnd后的本地消费及authority退役屏障不变。

该修正先补直接加载真实adapter/channel的有限纯回归，覆盖确认早到/晚到、消费未完成即可正常关闭、旧回执在途先排空及真实发送失败仍冻结。不重跑或修改首次原生归档；后续原生采集必须冻结新输入、新目录，不能覆盖本次0/2。本轮仍不扩展诊断框架或接入现有业务。

### 15.7 修后验证、证据边界与下一步

首跑前adapter 38项/channel 1组、provider core 2项、native source 1组和类型/bridge验证通过；首次新native构建及零调用加载也成功。这些preflight没有发现真实控制关闭竞态，不能代替首次运行结果。

首败后在内存独立核对保存内容：normal的2108B与冻结预期精确相等；使用首次归档tracker重放得到24行预期内容、红色宽2中文、光标(6,4)，baseY及viewportY均0。flood的73472B均为x且等于native readBytes，暂停时16帧/consumed0，SIGTERM与child释放在首次消费完成前确认。首次测试在authority断言失败后没有执行live最终终态断言，facts中也未保存terminal/serialized；离线重建不能补认它已经执行或通过。flood只证明已读取部分移交相等，不承诺被停止主体的完整1MiB写入。

修正后执行Node22.23.2的`test-execution-session-adapter.mjs`为43/43，`test-execution-provider-channel.mjs`为6/6，`test-linux-execution-provider-core.mjs`为2/2，`test-linux-execution-provider-source.mjs`为1组通过；这些均无PTY或主体进程。`npm run typecheck`、`npm run test:execution-session-bridge`及两个provider fixture的独立strict TypeScript检查通过。S2 fixture仅将手写命令类型替换为共享`ExecutionProviderCommand`，未改主体、断言或原归档。独立只读复审确认旧信用回执必须排在源确认之前、正常close不等消费、任何真实send失败仍保留；未发现该修正的新确定性阻塞。不声称每个新增纯断言都先红后绿，也不把纯验证等同修后原生通过。

下一阶段只冻结修后输入和新目录，对相同normal/flood两个场景作一次新的原生采集并如实结算；不覆盖`.debug/s3-linux-provider-first/`、不重跑旧矩阵筛绿、不扩充通用工具门槛。本轮无修后原生采集、runner或push；S3验收仍未通过，PI-01/02/03及跨平台、真实Agent、业务接线、owner失联等独立门槛继续开放。

### 15.8 修后两场景采集输入冻结

2026-09-25用户要求继续下一阶段，从主树`2e770c95`、诊断树`ff297168`推进一次修后采集。仅给现有测试入口新增`--output`参数及实际目录提示，默认仍为首次路径，`mkdir`和`wx`拒绝覆盖已有证据；主体、断言、两场景顺序、30秒观察及原清理预算全部保持。本轮目录固定为`.debug/s3-linux-provider-source-ack-first/`，不存在才运行；若再次失败，原样结算而不自动重试，不改变判据求绿。

本轮不重建native：握手修正只改变共享TypeScript通道。只读核对确认当前native header、patch、build脚本及构建副本摘要与首次build manifest一致，binary仍为第15.6节SHA256 `721cd46455897cf90bfb155240bf928442e30ad4558184f2c9f32c55431a3c6a`，Node22.23.2可执行文件身份相同；这不是复用旧诊断候选binary。首次失败目录18文件的排序内容摘要为`fc64837dd8d96bc6dc2e2dd6123da99adef1252c4ce41d4ec464d86feaa9689b`，算法为相对路径排序后JSON序列化`[{file,sha256}]`再取SHA256，供运行后只读核对，不增加归档设施。

运行前先对目录参数这一窄改做语法与源码差异核对，并将测试入口及本段提交冻结。执行工作目录为主树，命令为`/home/users/ziyang01.wang-al/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node scripts/test/test-linux-execution-provider.mjs --output .debug/s3-linux-provider-source-ack-first`。原有sources.json保存本次实际源码摘要和bundled输入；新结果与首次0/2分账。安全复核确认：主体或native责任未知时禁止终止外层后继续创建，只有主体及三项native责任已确认结算才允许外层清理；退出异常必须留记录。本段是运行前冻结，尚无本次新采集结果，不提前宣称S3或产品通过。

### 15.9 修后唯一采集结果

第15.8节输入以主树`3f8ebcae`冻结，运行前工作树干净。Node22语法检查和完整源码差异核对通过：只改变目录参数及结果提示，未改主体、断言、观察预算或清理。上述命令仅执行一次，exit0，normal/flood均通过，结果位于`.debug/s3-linux-provider-source-ack-first/`；未再重跑，也没有新native构建、其他矩阵、runner或push。

| 原始事实 | normal | flood |
| --- | --- | --- |
| 主体终态 | exit7，rawStatus1792 | SIGTERM15，rawStatus15 |
| native读取与保存输出 | 2108B，精确等于原预期 | 69632B，全部为x且等于readBytes |
| 连续接受及实际消费尾值 | 1帧，outputSequence=1 | 21帧，outputSequence=21 |
| 源结束 / master close | EIO / 返回0 | EIO / 返回0 |
| 主体TERM / KILL次数 | 0 / 0 | 1 / 0 |
| fault / 清理追加动作 | 无 / 无 | 无 / 无 |

normal实际执行并保存live终态断言：24行符合固定预期，中文为红色且宽2，光标(6,4)，baseY/viewportY均0。flood暂停点为16帧、consumed0；SIGTERM与child回收在恢复消费前已确认，随后继续消费所有已取得文本。两执行最终pending为0、authority槽释放且无隔离；每个provider的pty-master/pty-child/pty-source与父provider-control首报及当前均released。2个真实provider、2个主体、2次provider close，allOwnershipSettled=true，cleanup均safe且steps为空，未调用外层TERM/KILL，没有本轮运行中测试残留。

flood读取量及帧数由真实分块/停止时序决定，不要求等于首次失败中的73472B/20帧，也不承诺被停止主体的完整1MiB。此次有限成功证明修后同场景可以完成移交、实际headless消费及资源收尾；它不能恢复首次未执行的live断言，不能直接证明原trace缺失的失败消息类型，也不能穷尽所有调度竞态。正式状态继续比较中/验证中，PI-01/02/03与其他平台、两authority/reader、真实Agent启动链、owner失联、输入/resize、packaged及默认启用门槛不因2/2关闭。

独立只读核验没有使用summary中的pass替代原始事实：9个sources摘要逐一匹配`3f8ebcae0aa224d40f348b5490e0304eb08c252b`，首次18文件逐项未变，整体摘要仍为第15.8节数值；新binary与schedule一致。normal原始字节和live终态分别核对，serialized精确35B；flood可见区为23行各80个x及末行32个x，serialized为9872个x，与100行scrollback相符。flood暂停时16帧/55413B/consumed0；主体终态和child释放分别在564.183712ms/564.418544ms，首次消费完成580.513526ms；seal在640.014007ms，最终消费完成654.998172ms，父控制资源释放658.788620ms。时间值均为同次父进程performance域，不与首次运行绝对时刻比较。

该原生flood样本的provider关闭并没有早于消费完成，不能据此声称原生证明了二者这一时间顺序；不等待consumer的协议仍由直接纯回归及源码保证提供相应证据。本次normal仅1帧，不能声称实际覆盖跨read的UTF-8分割。独立检查未加载native、未启动PTY、未重放输出，也未修改任一归档。

### 15.10 下一有限接入条件

下一阶段只收口Linux PI-02的最小接入条件，随后转默认关闭的实际authority接线；不把异常崩溃全矩阵设为所有工作的前置。第8节的接入前安全接口与第10节的默认启用前异常失联风险分别执行。当前失联处理依赖provider的JS回调，native同步阻塞时不能保证它执行；父侧杀掉直接provider也不能证明PTY主体结束。S3两场景未补齐这些能力，不从新2/2推导已具备。

有限产物为三项：定位Supervisor/live-runtime与Host/snapshot-only正常关闭的新建准入、stop/cancel、内容消费和资源退役入口；列出provider卡住、provider崩溃、owner突然消失时已有控制对象、允许动作、可确认事实及未知责任；据此冻结下一实际authority切片所需能力、缺能力拒绝新路径和真实flush/reader结算落点。形成具名接线条件后即停止，不在这一轮实施新的owner机制、guardian或新增原生采集。无native的接线及定向测试无需等待异常崩溃全覆盖，但真实native进入业务必须先满足所列必要控制条件，旧live绑定与默认关闭边界保持。

## 16. Linux最小接入条件与下一authority切片

### 16.1 范围与源码基线

本轮从主树`a5d884be`、诊断树`a385e34d`继续，只完成第15.10节三项产物。以下行号对应主树基线，`src/`、`native/`路径均相对`extensions/vscode/dev-session-canvas/`；诊断树没有S1至S3生产实现，代码锚点指向主树，不要求在诊断树找到同一实现。authority是持有终端权威状态和执行责任的宿主：live-runtime为Supervisor，snapshot-only为Host；provider是其直接子进程，不与authority混称。

不重跑S3或改变首次0/2、修后2/2，不添加故障模型、guardian、服务或平台机制。此处是静态接线条件，不是新实测缺陷清单，也不宣称产品已通过。root稳定归属F-03、旧live的backend/storage/session/kind绑定和正常结束不保留Runtime正文的规则不变。普通后代不是独立托管对象；Agent包装链中的实际CLI仍必须正确代表会话主体，不能借此范围边界忽略它。

### 16.2 两种owner的真实收尾入口

| 责任 | Supervisor / live-runtime | Host / snapshot-only |
| --- | --- | --- |
| 正常关闭入口 | `src/supervisor/runtimeSupervisorMain.ts:2388`的`scheduleIdleShutdownIfNeeded()`仅在无连接、无live会话时计时，随后`flushRegistryBeforeShutdown()`（`:2104`）和`process.exit()`；没有统一closing状态或SIGTERM/SIGINT协调入口。进入异步flush后没有最终准入复查 | `src/extension.ts:826`的`deactivate()`等待`CanvasPanelManager.prepareForDeactivation()`（`src/panel/CanvasPanelManager.ts:3695`）及`prepareForHostBoundary()`（`:3703`）。目前先等待runtime操作、flush状态/存储，再同步dispose/kill本地会话；不是等待实际退出和资源结算 |
| 创建准入 | `runtimeSupervisorMain.ts:419`的`createSession()`在首个journal await前只查sessions，spawn之后才登记会话；新路径须先预留身份与责任，再bind/start | `CanvasPanelManager.ts:14776`和`:15984`在异步环境/CLI解析之后创建Agent/Terminal进程，之后才登记map。本地启动不在Supervisor pending operation中；deactivation没有开启现有invalidate选项，且失效token本身也不构成本地启动屏障 |
| stop/delete | `stopSession()`（`:974`）只发停止请求；`deleteSession()`（`:995`）先撤输出/退出监听再kill，`removeSession()`（`:1063`）跨journal删除await。新路径须保留捕获execution，异步之后校验对象身份 | `stopExecutionSession()`（`:17534`）请求kill或Agent graceful input；`terminateExecutionNodeForDeletion()`（`:17605`）本地先flush再同步dispose。`disposeExecutionSession()`（`:17962`）会清pendingOutput、撤监听、删map和dispose tracker，最后才kill，不能直接复用为新provider成功结算 |
| 内容及最终状态 | `bindSessionProcess()`的onExit（`:1149`）立即关闭mutation admission；`finalizeSession()`（`:1184`）沿`enqueueTerminalOperation()`（`:1830`）收尾，但最终snapshot的`'never'`分支不执行tracker最终flush | 两条local finalize（`:14878`、`:16078`）撤订阅后调用`flush().catch(() => getSerializedState())`；新路径不能把fallback当成功。`flushAllExecutionSessionStatesForHostBoundary()`（`:18633`）是退出前快照，不封住后续输出 |
| reader及退役 | `openTerminalRead()`（`:613`）、`closeTerminalRead()`（`:677`）和`finishSessionRetirement()`（`:1051`）已有cursor/身份及延迟退役，但close没有最终应用结果，reader归零也不证明provider资源已释放 | `handleExecutionTerminalApplied()`（`:16763`）拒绝local；`postMessage()`（`:6876`）不等页面应用。`src/panel/runtimeTerminalReadRelay.ts:176`的close/release发起后即返回，不能当最终ACK；local final barrier须按第11.2节另接 |

表中未写完整路径的Supervisor函数属于`src/supervisor/runtimeSupervisorMain.ts`，Host函数属于`src/panel/CanvasPanelManager.ts`。两端已有的`src/common/serializedTerminalState.ts:268`之`flush()`等待串行operationChain，`:433`之`writeInternal()`等待真实xterm write callback，这是需要接入的消费屏障，不是重新发明parser或以队列长度归零代替应用。

Host/Webview离开不等于live-runtime owner关闭：`src/panel/runtimeSupervisorClient.ts:207`的dispose只销毁socket、拒绝pending请求；Supervisor的`cleanupSocket()`（`:1997`）清订阅、reader及ACK，不停止live主体。Host boundary在前后均启用Runtime Persistence时只解除Host绑定，关闭该模式才按原绑定delete指定会话，不能关闭整个Supervisor。Editor/panel的onDidDispose（`CanvasPanelManager.ts:4855`、`:4927`）沿`invalidateSurfaceLifecycle()`（`:11683`）释放surface reader，不是local owner退出点。同步context disposer（`:1576`）也不能承载可等待的owner收尾。

新路径的正常收尾偏序固定如下，尚未实施：

1. owner正常关闭在首次await前关闭新建准入，纳入已预留/启动中的执行并保留引用；未取得资源的预留可拒绝，已进入connect/start不能按未取得处理。Host reset等可恢复边界与永久deactivation分别管理，新authority不得绕过旧unknown责任重新开门。单节点stop/delete不关闭整个authority。
2. 对同一execution发具名stop，必要升级和cancelOutput按显式策略执行；请求accepted只表示受理。ProcessResult关闭输入/native resize，但不撤输出/资源监听。关闭或取消输出期间继续推进已取得内容的消费，避免等待关闭的任务堵住它仍依赖的terminal operation链。
3. OutputSeal不等于全部消费批次已进入终端串行链：adapter的`beginConsumption()`（`:502`）每次至多4帧，后批等待前批完成后再调度，`maybeSeal()`（`:618`）不等消费。因此先在terminal串行链外等待截至`seal.lastDataSequence`的已接受内容实际消费成功，再进该链执行最终tracker.flush；消费失败保留已应用前缀，不用缓存补成功，也不在该链内等待依赖它的consumed/shutdown。由该执行的内容到终端操作映射固定finalRevision，不把数据帧号直接当终端revision；在固定值的同一无await边界关闭新reader准入，先前获准及open回包在途的reader继续结算。该过程不要求维持主体退出后普通后代的未来输出，取消也不能伪装EOF。
4. native责任与页面reader责任分别结算。先停止native不必等一个已离开的页面；页面消失记cancelled/lost而非applied。保留临时最终状态直至所需reader结果收口，完成后不新增Runtime completed历史。
5. 只有真实资源结果、已接受内容消费及必要reader责任分别收口，才退役相应owner/状态。unknown保留原操作、首次结果、当前补证和责任，冻结该authority新准入但不停止其他已准入执行的安全推进。Supervisor idle不得再仅以live=false判断可退出；Host不能以dispose返回宣称本地会话已结束。

### 16.3 Linux已有外部控制能力

`src/panel/executionProviderTransport.ts:172`的`terminate()`只向保留的直接provider ChildProcess请求终止，并观察其IPC/pipes关闭，不保证期限内释放。只有child close、IPC断开及相关pipes关闭才发布`provider-control=released`；该方法还未接入adapter通用ExecutionTransport或业务owner。`native/linux-execution-owner.h:18`的Owner持有master、主体PID及唯一wait责任，`:191`的signal先做同owner wait核对且只向未回收主体发信号；token同时受N-API env约束。snapshot中的PID/fd数值不是父端控制句柄，不能从日志重建kill权限。

| 情况 | 已有对象与允许动作 | 可确认事实 | 未确认责任与限制 |
| --- | --- | --- | --- |
| owner正常关闭，provider响应 | 原adapter/transport发送graceful/force stop及cancelOutput；provider使用自己持有的token进行wait/read/close | 分别收到主体终态、真实源结束/取消、native资源结果及父侧provider-control释放 | 没有authority整体shutdown编排；stop/cancel accepted和sourceEndAccepted均不等于最终消费完成 |
| owner存活，provider同步native调用卡住 | 父侧可观察期限、尝试IPC，并通过原ChildProcess请求终止直接provider | 父事件循环正常时可观察provider自身终止和通信资源关闭；超期只得unconfirmed/unknown | provider JS不保证处理IPC；父没有PTY master或独立主体控制句柄，杀provider不证明主体退出、PTY EOF或native责任结算 |
| provider崩溃，owner存活 | 保留原transport，消费已到达前缀并观察disconnect/exit/pipe close | provider自身退出、通信资源释放及崩溃前已取得的有效事实 | 未报告主体终态仍unconfirmed，未结算资源仍unknown；创建中崩溃不能从未收到resourceAcquired倒推资源未取得 |
| owner突然消失 | provider响应时由JS disconnect进入fail，尝试token化SIGTERM并取消读取，沿原wait/close流程继续 | 仅provider仍能取得的本地事实；已不存在的父端不保证收到或保存 | 无独立存活观察者、自动SIGKILL升级或硬期限；SIGTERM被忽略、native卡住时不能保证结束，不承诺主体或普通后代清零 |

实际失联入口为`src/panel/executionProviderChannel.ts:451`，`src/panel/linuxExecutionProvider.ts:112`附近的channel hooks进入fail。`cancelOutput`只置取消标志，不中断已经await的`channel.write()`/信用等待（读取见`:227`），所以正常关闭必须继续消费，不能先dispose consumer再等取消成功。`src/panel/executionSessionAdapter.ts:75`只有reserve/start/release/quarantine，没有正常closing闸门；`:567`的失联事实区分与unknown保留不等于平台处置已经接通。

该表确认“现有能力不够证明什么”，没有要求选择pidfd、PDEATHSIG、进程组、Job或guardian。主体终态未知可能是观察/控制能力缺口，不据此断言OS bug或主体仍存活；普通后代管理范围也不因新增provider而扩大。

### 16.4 分层准入与阻塞项

| 门槛 | 必需条件及当前缺口 | 适用时点 |
| --- | --- | --- |
| L-01 正常owner关闭 | 关闭准入、在途预留、prepare/bind/start、stop/cancel及消费链不断开；Supervisor idle与Host boundary接入同一责任原则。当前仅有局部API，无整体编排 | S4实现并以无native注入测试；真实PTY业务接入前必须成立 |
| L-02 真实结算 | tracker.flush失败不冒充成功；ProcessResult、OutputSeal、reader结果、native资源和provider-control分开。现有onExit/dispose/reader close不能提供这些证明 | S4先接authority消费与资源责任；真实PTY业务接入前补齐第11节reader协议及页面屏障 |
| L-03 失效控制 | authority持有原transport的独立外部处置对象；冻结触发条件、stop/升级/cancel/观察的有限预算，以及provider关闭而主体未确认时的隔离和owner关闭失败结果。当前父只能杀provider，Host退出后不能靠本进程map继续占账，尚无足以批准该正常关闭失败路径的处置决策 | 真实PTY进入业务前必须明确并验证所选路径；缺失则拒绝新路径，不能用kill(provider)或超时凑released |
| L-04 能力与分流 | 在任何provider/PTY资源取得前验证本会话控制能力、消费/reader能力和运行环境；无能力明确拒绝，不悄悄回退旧创建路径。provider已spawn便有控制责任，不能再称rejected-before-acquire。默认开关、实际namespace、旧live路由与回退按第11.3节 | S4只保留内部注入且生产工厂不可达；真实创建入口开放前共同实现 |
| L-05 异常owner消失 | 核对新拓扑在目标环境的孤儿风险、允许动作与可观测边界；不要求恢复进程/历史或所有后代清零 | 默认启用前按实际支持环境验证/记录；不是无native接线和定向测试的前置 |

L-03不是暗中新增“任何崩溃都必须独立杀掉PTY主体”的产品保证。它要求在正常关闭失败和provider失效时选定可执行、不会伪报成功的处置，并明确Host即将退出时由谁负责或以何种失败边界结束；现有代码无法证明这一点，故不批准真实native业务接入。预算必须以具名参数、取消原因和到期结果实现，不能直接把S3测试的20s自限、30s观察、2s清理或旧Agent 5s timer转成生产政策。S4可注入测试预算，不需要先选所有生产数值或跑全部异常矩阵。

PI-01/02/03继续开放；PI-04容量/预算、PI-05宿主分发与PI-06实际Agent/产品整链也不因静态收口关闭。S1的N=2/start=1仍是有限验证界限，不是生产容量决策。

### 16.5 下一有限实现：S4无native的authority收尾接线

下一阶段在主树推进同一生产模块及真实owner入口，不另写诊断模型。范围限定为`executionSessionAdapter.ts`的正常关闭准入/在途责任，以及`runtimeSupervisorMain.ts`、`CanvasPanelManager.ts`的新能力分支接线：Supervisor创建预留、串行消费及idle退役；Host本地创建预留、stop/delete和prepareForHostBoundary。新分支只接受显式注入的非native测试依赖；正常运行不创建新provider、不加载addon、不启用新协议或改动旧live行为。先保留内部依赖入口而非新增用户设置；真实native工厂在L-01至L-04成立前不可达，不能用环境变量绕过。共用的小型收尾编排可抽出，但必须由这两个真实入口调用，不能只测试另一个脱离业务的模型。

S4用直接测试真实模块和入口的方式验收：关闭与异步prepare竞争时不再start；同身份关闭幂等且旧execution不改新映射；ProcessResult先到仍消费尾部，首批消费暂停、后批已accepted且seal已到时finalRevision不提前固定，全部消费完成后才最终flush，错误不回退成功；stop/cancel等待时消费可推进；unknown保留并拒绝新建而已准入B仍可推进；live的Host/socket离开只detach，本地Host boundary等待或诚实报告未结算；Supervisor idle不越过未结算owner；缺能力不触发任何spawn。Host的`resetState()`（`:3753`）单根走boundary、多根走`clearAllWorkspaceRootCanvases()`（`:3794`）后逐节点terminate，生产接线不通过清map或换authority逃逸旧unknown；本轮窄Host测试覆盖入口准入和boundary竞争，reset/clear的完整UI整链仍需后续验收。页面最终ACK协议不在这一切片实现，以未结算reader明确阻止相应状态退役，不虚构applied。

测试复用现有esbuild/assert、可注入transport/时钟及真实SerializedTerminalStateTracker，必要时增加窄的owner wiring测试文件；不加载PTY、触发真实SIGTERM、启动runner或新增writer/oracle。新测试入口在实施时登记完整命令，执行前确认没有导入会自动启动Supervisor的main副作用。通过只说明关闭准入、消费和责任接线，不说明真实OS回收、Agent包装链或最终Webview验收通过。完成此切片、定向测试、typecheck和相关既有bridge回归后停止，报告L-02 reader、L-03处置/预算及L-04实际创建分流等剩余条件，不自动接通native或追加异常工具验证。

## 17. S4：默认关闭的owner接线

### 17.1 有限实现输入

主树新增`src/panel/executionOwnerLifecycle.ts`，复用同一ExecutionAuthority/PreparedExecution；两owner实际创建和关闭入口调用它，不复制诊断模型。`NonNativeExecutionOwnerOptions`要求显式non-native标记、生命周期能力、transport工厂、scheduler与五个有限测试预算（start、graceful、force、cancel、settle），没有生产默认值或native工厂。Host内部注入还要求ExtensionMode.Test，不以环境变量启用；Supervisor constructor可选注入，正常启动不传入，main加直接执行守卫以允许无副作用导入。

owner在异步环境/CLI或journal准备前reserve(key)，保存原execution身份。关闭同步封准入并标记预留取消，异步准备尚未返回不能直接抹掉责任；调用方准备结束并清理已取得的本地准备资源后才abandon。start前能力/准入复查，进入connect后不能当作未取得资源撤销。关闭、reset与clear使用原owner，不重建对象绕过unknown；其他已准入执行仍可推进。

Adapter追加正常closing/permanent、预留取消、可选stateChanged及同一seal尾值的消费等待，不改变旧协议或首次/迟到结果。owner在terminal链外等待真实消费，再调用实际owner的flushFinal；该hook在原终端链中flush并固定finalRevision/关闭reader准入。最终消费失败不缓存回退。执行资源、authority最终状态和reader责任分别保留；S4不实现applied ACK，reader只能因明确取消/失联结算，不能从map空或postMessage成功推导applied。

停止按注入预算依次允许graceful、必要force与cancel，各语义操作只发送一次；期限内未取得真实结果时返回unconfirmed并封新准入，不把accepted当完成，也不调用原生或外部PID kill。owner close等待执行资源和最终消费，reader不阻止安全执行回收，但未结算reader仍保留最终状态责任。普通后代不增设托管，真实native关闭失败处置L-03仍未选定。

### 17.2 本轮验证命令

在主运行时仓库根执行以下命令，均以退出码0完成：

* `node scripts/test/test-execution-owner-lifecycle.mjs`：13/13；覆盖能力拒绝、关闭竞争、unknown、消费/flush失败、stop升级、reader结算和迟到回调。
* `node scripts/test/test-execution-session-adapter.mjs`：53 cases；原有adapter断言保持，未创建native session。
* `node scripts/test/test-supervisor-execution-owner-wiring.mjs`：11/11；直接加载`RuntimeSupervisorServer`，不启动main server。
* `node scripts/test/test-host-execution-owner-wiring.mjs`：5/5；覆盖严格Test mode注入、Agent/Terminal预留、能力拒绝和live detach。测试使用窄的真实入口替身，不将未稳定的宽泛tracker fixture写成通过。
* `node scripts/test/test-execution-session-bridge.mjs`、`node scripts/test/test-serialized-terminal-state-tracker.mjs`、`node scripts/test/test-runtime-paged-completion.mjs`、`node scripts/test/test-runtime-supervisor-protocol.mjs`：全部通过；paged/protocol既有断言保持。
* `npm run -w extensions/vscode/dev-session-canvas typecheck`：通过。

测试没有启动网络服务、PTY、原生子进程或runner；Host/Supervisor注入路径只接受显式non-native依赖，未注入时旧路径保持。一次Host宽fixture因不会推进provider而产生未决顶层await，已移除该不确定测试并保留5项稳定窄测试；这不是业务失败或通过证据。S4因此只关闭L-01的无native接线切片，L-02 reader最终ACK、L-03 native失联处置/预算和L-04生产能力分流仍开放。

## 18. S4接线补验：实际Host收尾与reset/clear

### 18.1 有限输入与验证边界

本轮输入为主树`c1b6bc8b`。复用现有`test-host-execution-owner-wiring.mjs`和真实`CanvasPanelManager`/`SerializedTerminalStateTracker`，先定位成功启动fixture未推进的实际原因，再用明确有界的失败条件替代未决顶层await。Agent与Terminal都覆盖process结果早到、暂停消费及后批已接受时seal不能提前最终flush、stop保留reader责任、delete显式取消并等待结算；最终flush失败不以缓存成功替代。单根`resetState()`和多根clear走真实入口，未确认时保留原owner、节点及root存储，不能靠清map恢复准入；已确认关闭后才允许清状态并恢复非永久准入。这些是已有业务入口的直接验证，不是新诊断框架。

只修复这些场景实际复现或静态确认的接线问题，正常未注入路径不变。reader最终ACK仍依第11节，需要跨页面、Host、relay、client、Supervisor保留身份、能力与结果；本轮只核对下一有限切片的范围，不用旧close伪造applied，不改变storage namespace或生产能力。

验证在仓库根运行`node scripts/test/test-host-execution-owner-wiring.mjs`、`node scripts/test/test-supervisor-execution-owner-wiring.mjs`、`node scripts/test/test-execution-owner-lifecycle.mjs`、`node scripts/test/test-execution-session-adapter.mjs`及既有bridge/tracker/paged回归，再运行`npm run -w extensions/vscode/dev-session-canvas typecheck`和`git diff --check`。仅无native内存transport、真实parser与入口测试，禁止PTY/runner/真实进程；失败和修正分开记录。完成直接接线补验及文档收口后停止，不把纯测试扩大为VS Code UI、其他平台或产品最终验收。

### 18.2 前轮验证分类勘误

第17.2节和前轮计划把全部测试统称为“不启动网络服务、PTY、原生子进程”，该范围说明不准确。实际已运行的`scripts/test/test-runtime-supervisor-protocol.mjs`在`assertRuntimeSupervisorClientWaitsForHello()`创建本地socket服务，在`assertRuntimeSupervisorFinalStateUsesFreshSerializedSnapshot()`及后续场景spawn真实Supervisor，其默认`createExecutionSessionProcess()`走旧node-pty路径。这次旧路径回归的通过结果保持，但必须与S4注入测试分账，不是新provider通过，也不能计为零PTY或无真实child。没有充分逐会话日志，不补造原生样本数；本轮不重跑该脚本。Linux的既有bridge回归只校验launch spec；其Windows分支会spawn受控cmd夹具，故也不能对所有平台笼统称为零进程。

本轮Host、Supervisor wiring直接加载真实类、使用内存transport和受控socket替身，paged completion使用真实journal与tracker而不启动main，bridge只在本机Linux执行。esbuild构建辅助进程不属于执行会话/PTY样本；“无native会话”也不等于整个测试工具链没有OS进程。

前轮被移除的Host宽fixture没有冻结版本可复验，因此第17.2节“不会推进provider”的解释只记录当时观察，不能充当已定位的唯一根因。本轮须用保留的成功启动断言与受控调度验证当前路径；发现夹具在raw帧尚未被adapter接受时就发送`sourceEnd`，应修正夹具消息顺序，而非放宽真实adapter的连续性判据。

### 18.3 本轮实际结果

Supervisor缺陷已由新回归复现：`openTerminalRead()`在`createFreshSnapshot()`之前检验连接，等待真实checkpoint flush期间`cleanupSocket()`可删除全局reader map；恢复后却仍向脱离全局的旧map写cursor，并把失效socket重新加入`ownedReaderSockets`。此后没有第二次断连事件，聚合reader责任可能长期pending。新分支在await后重验captured session、`socket.destroyed`及`terminalReads.get(socket) === reads`，不改默认legacy行为。另一个同位置的session替换场景也明确拒绝发布旧cursor。这是S4新增注入接线的缺陷，不是已经证明用户旧路径发生的故障，也不是Windows对象语义问题。

新增断连回归在修复前以`Missing expected rejection`、exit 1失败，前8项通过；修复后一次13项断言通过但finally删除临时journal目录遇`ENOTEMPTY`，整轮仍失败。仅在测试清理时等待已排队journal.flush后删除目录，最终整条命令13/13、exit 0。保留这些首败记录，不重判为成功，也不新增归档工具。

Host增加有界等待（每场景3秒失败上限、每阶段100次受控调度检查），实际Agent/Terminal启动均到达注入provider。10帧跨3批、首个真实flush暂停期间`consumedThrough=0`且finalRevision未固定；放行后真实终端包含尾部，3次消费flush后才执行最终flush。stop受理及process/source结果不替代resource结果；活动delete先取消reader，但仍保留tracker至结算。consumer/final flush失败均无缓存成功。单根/多根reset的unknown路径保留原state、owner和预留且零持久化调用；成功路径等待预留清理，复用原owner恢复准入，再次成功start。Host业务代码不需要修改。本轮验证的是Host入口及持久化调用，不是完整VS Code UI/落盘；fake provider的显式provider-control结果不证明任何OS资源已释放。

在本机Linux/Node v25.6.0、仓库根完成：Host wiring 19/19、Supervisor wiring 13/13、owner lifecycle 13/13、adapter 53 cases，既有bridge、serialized tracker及paged completion回归均exit 0，workspace typecheck通过。Host构建仍有`require.resolve('node-pty')` external警告，测试守卫禁止实际加载/执行；没有为去除警告改业务代码。两个专项交叉只读复核未发现本次直接blocker；全部结果不与S3原生样本合算。

### 18.4 下一有限切片：远端逐reader结算

下一步只实施默认关闭、无native的Supervisor逐reader登记与结算接收端，复用sessionId/authorityId/readId、socket归属、sentRevision及固定finalRevision，不引入新的消费水位或历史正文。当前`ownedReaderSockets`与`OwnedExecution.readerOutcome`是整次执行的聚合占位，不能把同socket的editor/panel当作一个已应用读者；要在现有cursor边界登记各reader和已准入但回包在途的open，全部各自结算后才释放聚合reader责任。

`applied`只能证明同身份、已固定且已发送的finalRevision真实应用，`cancelled`须显式原因，socket失效记lost，旧无outcome的close只作legacy-released。重复幂等、冲突/越界拒绝及有限保留窗口需在该接收端切片一起定义与定向验证，不能把任意旧close改判applied。修改落点为`common/runtimeSupervisorProtocol.ts`、`supervisor/runtimeSupervisorMain.ts`、必要的共享owner接口及现有接线测试；只向内部注入路径提供，不启用真实新会话或新generation。

接收端通过仍不关闭L-02：真正发送新结果时，`common/protocol.ts`、Host、relay、client、`webview/terminalPagedProjection.ts`和`webview/main.tsx`的写完成屏障，以及Webview ready、hello/session/open的能力协商必须完整对齐。本地Host的最终屏障也仍单独开放。relay的onReleased、client无连接时close返回和普通snapshot ACK都不作为applied。L-03 native失联处置/预算、L-04生产分流与真实UI/平台验收仍具名保留；不借此再开通用诊断轮。

## 19. 逐reader结算接收端

### 19.1 本轮实现边界与规则

输入为主树`bcdd7213`，只实施第18.4节。只有显式non-native owner注入的capabilities包含`terminal-read-settlement-v1`时建立逐reader账本，正常main、旧注入和旧live不启用。此内部gate不是hello/session能力声明；不修改client、relay、Webview或generation。`openTerminalRead`的可选`settlementMode: 'final-application-v1'`表示此reader允许显式结算；未协商的reader不能提交新outcome。端到端能力协商仍未完成。

每次合法open在进入异步终端队列前预留readId、captured session/authority/socket/surface。最多128个未结算reader/session，包含checkpoint与回包在途；超额拒绝新open，不逐出未决责任。最终flush固定终值并关闭准入后，先前准入的open继续完成；新open拒绝。同surface重新打开将原reader记`cancelled('reader-replaced')`，等待中的旧open和page不能再发布。仅create/subscribe的socket不算额外reader，零reader与全部各自结算都只通知共享owner中性的`settled`，不伪造全部applied；各结果在session计数中分别保留。

`sentRevision`在实际open/page response成功提交`socket.write`后才前进；返回false是背压，不是发送失败。构造结果、私有方法返回、抛错或已断连都不能作已发送证明。journal异步读取后和回包发布前都复验原cursor、session及socket归属；发送只证明传输提交，页面应用仍需未来发送端真实写屏障。显式`applied(finalRevision)`要求原连接/身份/reader、固定的成功终值、完全相等的安全整数和已发送范围覆盖；`cancelled(reason)`要求非空、至多1024字符理由。无outcome的close只记`legacy-released`；socket清理记lost，非preserve删除逐个取消，不停止其他执行或补造EOF。

删除cursor前保存结算回执，回执在session之外、按原socket保存，最多128条/socket、60秒；到期或超量只逐出已结算回执，断连删除该socket的回执。以注入scheduler的单调时间惰性清理，不为此增加后台timer。相同身份/结果重试返回`duplicate`，冲突拒绝；session已删除仍可确认窗口内回执，窗口外/未知readId返回`unconfirmed`，不能复造applied。回执不保存终端正文，也不是已结束历史持久化。此窗口只限定接收端幂等保证，不设置reader自动超时、生产收尾预算或取消政策。

`unconfirmed`是不能确认结果，不是接受最终ACK：未知sessionId、foreign socket或窗口外readId均不改变原reader。已知reader的错误authority或冲突结果报协议错误。gate内无outcome close返回`recorded`并记录legacy-released；gate外仍返回原`{ ok: true }`。回执保留reader自身是否明确opt-in，不能用legacy reader被替换时的自动取消回执绕过能力校验。

### 19.2 验证安排

扩展现有`test-supervisor-execution-owner-wiring.mjs`，保留旧13项，新增真实handleRequest到受控socket的定向断言：双surface、空输出、未固定/未发送/越界拒绝、同surface替换、open/page在途取消或断连、幂等与过期/容量、错误身份、legacy释放与关闭gate。使用内存provider、真实journal/tracker，不监听真实socket或创建执行进程。运行Host、owner、adapter、Linux bridge/tracker/paged回归和workspace typecheck；不重跑会创建旧PTY的protocol脚本。新增每场景3秒watchdog用于明确报告未决测试，不改变产品收尾期限。

### 19.3 实际结果与复核

本机Linux/Node v25.6.0运行Supervisor 33/33（旧13与新增20）、Host19/19、owner13/13、adapter53，以及Linux bridge、serialized tracker、paged completion均exit0，workspace typecheck通过。Supervisor由主代理及独立复核分别重跑通过，但不累计为原生样本。Host原有esbuild `require.resolve('node-pty')` external警告保持，native加载/spawn守卫没有放宽。未运行PTY/native、真实socket服务、runner、VS Code UI或实际Agent；构建辅助进程不计执行会话。

保留首轮失败：新增测试原期望未知sessionId报协议错误，实际返回unconfirmed；明确19.1的不可确认语义后修正预期，同时保持原reader、pending与计数均不变的断言。gate内旧close返回recorded、gate外旧close返回ok的测试预期也随契约明确，不将这类预期澄清称为业务先红后绿。

独立只读复核指出初版两处证明缺口，均已修正：未发布open的checkpoint虽没有sentRevision，却可沿初始appliedRevision请求空page，把page发送误当checkpoint已发送；现在gated read必须先有sentRevision非负。已准入open在队列排队期间遇preserve删除，原requireSession拒绝retiring导致错误lost；现在仅已登记owned continuation允许访问captured retiring session，非preserve取消仍拒绝。另为回执保留opt-in，legacy自动替换的取消不能升级新能力。新增断言运行时修复已在，不声称执行过先红后绿；最终复核未发现本切片blocker。

测试还确认socket.write返回false仍算提交，write抛错或连接销毁不产生applied证明；回包在途和journal read在途分别受captured reader校验。只有最后一个reader各自结束且准入已封，owner才收到中性settled；普通create/subscribe不占虚构reader。接收端校验的是可信发送端将来提交的声明，不证明页面真实应用，更不证明OS资源释放。

### 19.4 下一有限切片与剩余边界

下一阶段沿第11.2/11.3节完整接通远端发送链：`common/protocol.ts`、Host、`runtimeTerminalReadRelay.ts`、`runtimeSupervisorClient.ts`、`webview/terminalPagedProjection.ts`及`webview/main.tsx`。必须一起实施Webview ready和hello/session/open能力声明、真实write完成屏障、相同身份的结果转发及cancel/lost分账；接收端内部gate不能替代这些协商。仍只默认关闭、无native注入，不启用新generation或用户创建入口；纯接线验证与真实UI验收分账。

本地Host最终应用屏障、L-03正常关闭失败处置/失联预算、L-04生产创建能力分流、真实Agent/其他平台和真实落盘验收继续开放；本轮不关闭L-02、PI-01/02/03或退出完整性总债务。旧live原绑定、旧冻结实验/失败及第2至18节保持，不修改独立诊断工作树，不推送或触发runner。

## 20. 远端发送链与实际写完成屏障

### 20.1 本轮边界与接线输入

从主树`648958e0`继续第19.4节，不开放native、生产新建或新generation，不修改旧live绑定。沿现有分页投影接通Supervisor/client/relay/Host/Webview，不引入另一套观察器或历史正文。正常Supervisor不注入新owner，仍不声明新能力；页面静态声明支持新能力不等于启用新执行路径。本地snapshot-only最终屏障不在本切片。

hello的`capabilities.terminalReadSettlementV1`只在内部non-native gate开启时为true；snapshot的同名capability只对实际ownedReaders会话为true。Host同时确认当前Webview ready的可选`payload.capabilities.terminalReadSettlementV1`、hello及session能力，才请求open的`settlementMode: 'final-application-v1'`。descriptor必须回显本次协商且经过normalizer保留；缺失/不符明确拒绝新模式，不把同server其他旧会话升级。Webview能力按surface lifecycle保存，换页/失效/能力改变取消旧reader，不让晚到旧frame结算当前投影。

Supervisor snapshot新增`terminalFinalRevision`，仅owner已成功固定终值时提供。Host将其沿已协商reader的`host/executionTerminalAvailable.payload.finalRevision`传递；普通head revision、live=false和旧completed字段不替代该事实。失败无终值时显式取消新reader，不能补造applied；已有旧分页继续原分支。Webview的close消息可带原身份与`outcome: applied(finalRevision) | cancelled(reason)`；非法outcome拒绝而非丢字段后降级旧close。

页面的新模式必须等待checkpoint和连续页的真实xterm写回调，并与同一writeGeneration绑定，精确达到固定finalRevision才发applied；final0也通过实际checkpoint写屏障，结算不依赖exit提示先到。写失败、销毁、替换、关闭读失败都具名取消；旧回调不能确认新投影。现有writeChain吞错和异步事件递归异常必须在新分页回调中显式体现，不能靠普通snapshot ACK或后续成功sentinel掩盖前序失败。

新能力client将open/read/close绑定发起open的原socket，握手及socket监听校验captured连接；不重连后把旧readId发到新连接，也不把断连时close直接返回当已结算。relay完整传递身份/结果，仅接收recorded或duplicate为已确认，unconfirmed/RPC失败单列；onReleased仍只处理本地引用释放，不生成应用事实。在途open被取消后，等待取得原descriptor再发具名取消；不能因删除外层key而遗漏责任。重试只使用原身份/原连接，不引入无限重试或新的生产超时政策。

### 20.2 有限验证安排

在现有Supervisor/Host wiring、terminal paged projection、protocol消息测试中增加直接断言，并为真实client/relay链增加无native受控transport测试。覆盖缺任一能力拒绝新字段、原连接断连和迟到事件、双surface与旧frame、final先到/空输出/暂停写回调、前序与异步写失败、在途open取消和结果不可确认。尽可能使用实际模块与真实终端写回调；模型done或静态源码断言不计实际页面写完成证明。仅执行本机受控测试，不运行会创建旧PTY的protocol全脚本，不自动启动runner；测试未执行前不宣称通过，真实VS Code UI/Agent/其他平台另行列账。

### 20.3 实际实现与结果

实现落点为`common/protocol.ts`、`common/runtimeSupervisorProtocol.ts`、`common/terminalStreamPaging.ts`、`panel/CanvasPanelManager.ts`、`panel/runtimeTerminalReadRelay.ts`、`panel/runtimeSupervisorClient.ts`、`supervisor/runtimeSupervisorMain.ts`、`webview/terminalPagedProjection.ts`及`webview/main.tsx`（均在主扩展`src/`下）。outcome校验只有一份，放在protocol并由paging导出，避免破坏现有Node直接加载protocol的入口。relay新增返回结果的`settle()`，旧`close()`仍兼容；取消中的open/close保留client引用直到原RPC结算。client保存活动reader的原socket，最多保留128条已关闭binding供原连接重试，不缓存成功ACK、不自动重试；断连不逐出活动binding后把旧read降级成重连请求。页面写链保留同generation的失败，后续成功sentinel不能覆盖；异步事件应用异常和诊断回调异常也保证队列最终结算。

没有新增Host到Webview的close-ACK消息。页面的applied只说明本地已应用；Host把Supervisor的recorded/duplicate记为`runtime/terminalReadSettled`，不明确结果记为`runtime/terminalReadSettlementUnconfirmed`，非法身份/范围记为`runtime/terminalReadSettlementRejected`。本地release通知不承担应用或远端确认的证明。

本机Linux/Node v25.6.0在仓库根执行并以exit0完成：

* `node scripts/test/test-runtime-reader-settlement-wiring.mjs`：20/20，真实parser、Host入口、relay及client；其中一个场景使用实际Supervisor `handleRequest`、journal/tracker、sessionState事件和真实headless xterm分页投影。尾页写完成通知暂扣时applied=0、owner pending=1；放行后recorded、applied=1、owner retired且pending=0，session删除，尾部文本及最终光标正确。该场景不是预制server回包，但投影事件回调为测试接线，不声称走实际main UI。
* `node scripts/test/test-terminal-paged-projection.mjs`：原分页/保留/取消断言及新增实际main controller/headless 13/13全部通过。新增用例从main提取实际函数体，使用真实xterm写回调，覆盖空终值、final早到、失败不被掩盖、替换/销毁与迟到回调。它与前一整链场景互补，不合称浏览器或VS Code UI验收。
* `node scripts/test/test-runtime-supervisor-reader-client.mjs`：13/13；`node scripts/test/test-supervisor-execution-owner-wiring.mjs`：36/36，旧33项正文保持，增加实际能力、终值成功/失败通知三项。
* `node scripts/test/test-host-execution-owner-wiring.mjs`：19/19；`node scripts/test/test-execution-owner-lifecycle.mjs`：13/13；`node scripts/test/test-execution-session-adapter.mjs`：53 cases。
* 既有`test-protocol-webview-messages.mts`（使用`node --no-warnings --experimental-transform-types`）、`test-execution-session-bridge.mjs`、`test-serialized-terminal-state-tracker.mjs`、`test-runtime-paged-completion.mjs`、`test-execution-output-sequence.mjs`及`test-webview-build-xterm-entry.mjs`均通过；所列mjs均以`node scripts/test/<文件名>`运行。`npm run -w extensions/vscode/dev-session-canvas typecheck`最终全树复跑通过。

未启动执行会话/native/PTY、真实socket服务或runner；构建工具及xterm构建探针的普通Node子进程不计执行会话。Host原有`require.resolve('node-pty')` external warning保持，native/spawn守卫未放宽；不重跑默认会创建旧PTY的Supervisor protocol全脚本。

保留失败与修正：首轮跨模块尚未齐全时typecheck失败，随后全树验证通过，不能记成首次即绿。原paged脚本先后暴露relay即时close被延至microtask、取消中late-open先返回后释放两项时序回归；保留旧断言，分别恢复即时调用及返回前等待release，修后原断言通过。该脚本对guarded Supervisor main仅调整模块加载，不改旧保留/分页断言。整链首跑夹具缺少`scheduledExecutionOutputPosts`初始化，补齐后20/20；不是业务缺陷。callback的finally缺口和client漏检查pagedCompletion由只读复核修正，新增测试运行时修复已在，不称先红后绿。最终专项只读复核未发现本切片确定性blocker。

### 20.4 下一有限切片与未决边界

下一阶段仅补默认关闭、无native的本地snapshot-only最终应用屏障：从Host实际owner成功final flush取得固定终值，沿本地执行身份、surface生命周期和真实页面写链确认各消费者结果；普通snapshot ACK、postMessage成功或reader集合清空不能代证。先明确现有本地投影接口与失败/取消责任，再实施实际Host/main受控验证，不复制远端RPC或新增诊断框架。snapshot-only既有快照语义保持，不扩大Runtime completed历史或崩溃恢复承诺。

本轮只完成L-02中的远端受控接线切片；本地屏障、真实Webview UI/socket集成、L-03原生正常关闭失败处置/失联预算、L-04生产创建能力分流以及真实Agent/平台/落盘仍开放。新native执行和新generation均未启用，旧live沿原绑定，F-03 root归属另行规划。第2至19节、旧冻结实验与失败保持，独立诊断工作树不改；只本地提交，不push、PR或runner。

## 21. 本地snapshot-only最终应用屏障

### 21.1 有限实现输入

输入为`90a7d95b`，沿第11.2/11.3节和20.4补本地实际接线，不改变正常生产路径、snapshot-only持久化语义、旧live或storage generation。仅Host显式non-native owner注入含`terminal-local-settlement-v1`时启用；Webview ready新增可选`terminalLocalSettlementV1: true`。普通本地会话和旧注入无新字段/结算保证。未取得页面能力的surface不被当作已应用消费者；生产创建前完整能力拒绝仍归L-04，不由这次内部接线默许。

本地不能借用远端authorityId/readId，也不新增journal。复用实际execution UUID、node/kind与surface的完整WebviewLifecycleIdentity。新分支需从真实tracker向已协商页面提供本地snapshot及连续output；当前nonNativeHostExecution只有tracker没有页面投影，不能只给它补一个自测ACK。每个当前surface/lifecycle最多一个责任，准入覆盖snapshot等待及发送在途；最终flush在固定finalOutputSequence的同一边界关闭新reader准入，已准入投影继续收尾。相同生命周期的重复attach不重置责任，已取消责任不在同身份下重开，避免旧结果确认新读者。

成功finalized后，向各已准入且仍有效的页面发送最终snapshot，再沿`host/executionExit.payload.localCompletion: { executionSessionId, finalOutputSequence }`请求最终屏障。Host逐reader保留原页面引用、生命周期、最终发布状态和结果；不能把通用void postMessage、bootstrap排队或返回false当作成功发布。新路径使用具名的受控发送入口保留异步结果，不复制远端RPC；最终发送尚未确认时到达的结果必须等待或拒绝，不能提前结算。postMessage成功仍不等于应用成功，失败/页面失效只记录具名取消或lost。

页面回传`webview/executionLocalTerminalSettled`，payload为nodeId、kind、executionSessionId与`outcome: applied(finalOutputSequence) | cancelled(reason)`；lifecycle沿现有envelope。Host检查实际注入能力、原执行/页面身份、成功固定且已发送的精确终值。重复相同结果不重复计数，冲突拒绝；会话退役后未知结果不可重建成功，不为本地新增跨session回执缓存。每个reader单独结算，零reader或全部结算只调用owner中性的settled，不伪造全部applied；正常资源回收不等页面，但最终状态责任保留到结算。

页面必须覆盖同一执行的有效投影、连续序列和全部pendingOutput，并通过既有writeChain及真实xterm回调，才能确认精确finalOutputSequence；空输出也走实际空write。健康投影忽略重复snapshot不免除屏障，排入写队列的snapshot必须包含在屏障中，onSnapshotApplied和旧snapshot ACK不能代证。前序写失败不能由成功sentinel覆盖；旧generation回调不得确认新执行。销毁、替换、写失败或无controller具名取消；请求退出文案与应用屏障分开，不能让文案污染最终主体状态证明。

换页、render、ready能力改变、删除、reset及Host boundary分别取消/丢失对应reader，禁止先清map后遗漏责任。终端final flush失败不得用缓存构造终值；未知执行/消费资源仍按既有owner隔离，不因reader取消解封。普通Terminal/Agent后代职责、启动器例外及历史失败保持，不能据本地受控通过宣布native或真实UI通过。

### 21.2 验证安排

只扩展实际Host owner wiring、protocol消息及实际main/headless测试；保留旧19项Host与上一轮远端断言。覆盖Terminal/Agent尾部、空终值、暂扣实际写回调、双surface、最终snapshot等待、能力缺失、错误/旧身份、重复/冲突结果、发送false/throw、页面失效、删除及无reader中性结算。至少一条受控整链连接实际Host、tracker、消息parser和实际main controller/headless写回调，不以测试自行生成applied代替页面证明。运行原owner/adapter、remote reader/client/Supervisor、Linux bridge/tracker/paged/output-sequence回归及workspace typecheck，禁止会启动旧PTY的Supervisor protocol全脚本；不native/真实socket/runner/push，不增加通用诊断框架。结果按实际执行补入本节。

### 21.3 实际实现与责任边界

实现位于主扩展`src/common/protocol.ts`、`src/panel/CanvasPanelManager.ts`、`src/webview/executionTerminalTypes.ts`及`src/webview/main.tsx`。`LocalTerminalCompletion`和`LocalTerminalOutcome`共享类型/校验，ready及结果消息不补造lifecycle；Host从原始入口传递实际sourceWebview和envelope，缺失身份不能用当前页面身份填补。普通attach/snapshot入口先检查显式能力再读新map；正常生产入口仍不可达，页面声明支持本身不能启用本地执行分支。

`NonNativeHostExecution`保存真实tracker尺寸、固定finalTerminal和各surface reader。准入需要ready、bootstrapAck、完整frame及当前interactive surface；初始快照和连续输出经同一terminalChain，初始实际发送成功后才发增量。output不携带persisted字段，不把内存消费写成落盘，也不以false锁住页面旧持久化屏障。重复attach复用在途promise，同身份取消后不重新准入。最终flush关闭的是新reader准入；已有reader可以恢复同一冻结快照，不重新flush、创建reader或重置最终发布责任。

`postLocalExecutionReaderMessage()`等待实际Webview发送结果并复验原页面引用。每次发送只登记自身在途取消resolver，在finally移除；换页或失效可释放永不返回的发送等待，不能让取消promise的reaction随成功输出无限积累。取消只解除该消费者责任，不丢弃Host已接收/排队内容或解封未知执行资源。逐reader诊断记录原lifecycle/outcome，结果另记recorded、duplicate、rejected或unconfirmed；两个ACK等待同一finalPublication时，恢复后重新核对原reader已结算结果，不能重复结算或误报第二个同结果为未知。退役后未知ACK不新建成功记录。

最终tracker flush成功不等于实际进程已退出。`finalized`读取独立process结果，只有明确exited/signaled/terminated才发送最终快照和localCompletion，退出文案来自该真实结果；unconfirmed只将reader记lost，继续保留unknown owner、tracker和拒新建责任。页面应用也不代证sourceEnd或OS资源释放。

main控制器同时要求可信连续序列、同执行投影、无pendingOutput/投影或持久化屏障，并在实际writeChain尾追加`terminal.write('', callback)`；空终值同样经过真实回调。最终退出文案在该应用屏障后写入，不进入主体终态证明。前序写失败不能被sentinel掩盖；scheduled snapshot异步失败、取消和suppression release失败均结算队列。低序恢复只使新协议的序列证明失效，保留legacy raw原有barrier行为，并请求已有attach恢复；不改普通snapshot-only保存语义。

### 21.4 有限验证与失败记录

本机Linux/Node v25.6.0在仓库根实际执行并最终exit0：

* `node scripts/test/test-host-execution-owner-wiring.mjs`：35/35，原19项正文保持，新增16项。包括Terminal/Agent身份与尾值、空终值、发送在途、双surface、失败/取消、冻结后原reader恢复以及process unconfirmed不发布退出/不退役。受控整链实际连接Host/tracker、消息parser、提取的main控制器/headless及回传Host；暂扣真实尾部回调时owner仍pending，放行后最终文本/光标正确且owner退役。
* `node scripts/test/test-terminal-paged-projection.mjs`：原分页断言及实际main/headless27/27通过，保留原13项、追加14项本地场景。覆盖实际空写、partial drains、序列缺口/恢复、异步失败、替换/销毁和缺controller；不是实际DOM或VS Code UI。
* `node scripts/test/test-runtime-reader-settlement-wiring.mjs`：20/20；`node scripts/test/test-runtime-supervisor-reader-client.mjs`：13/13；`node scripts/test/test-supervisor-execution-owner-wiring.mjs`：36/36。
* `node scripts/test/test-execution-owner-lifecycle.mjs`：13/13；`node scripts/test/test-execution-session-adapter.mjs`：53 cases。既有bridge、serialized tracker、runtime paged completion、output sequence和xterm构建探针均通过，入口分别为`node scripts/test/test-execution-session-bridge.mjs`、`node scripts/test/test-serialized-terminal-state-tracker.mjs`、`node scripts/test/test-runtime-paged-completion.mjs`、`node scripts/test/test-execution-output-sequence.mjs`及`node scripts/test/test-webview-build-xterm-entry.mjs`。
* `node --no-warnings --experimental-transform-types scripts/test/test-protocol-webview-messages.mts`与`npm run -w extensions/vscode/dev-session-canvas typecheck`通过。最后Host/main/远端接线和typecheck均再次以完整退出码核对。

保留初次失败：Host模块尚在并行施工时typecheck报告缺字段/方法，后续全树通过，不记成首次即绿。远端接线首跑在旧Object.create夹具未初始化新map时出现`Cannot read properties of undefined (reading 'get')`；修复普通入口缺少显式capability前置检查后，原远端20项不改而通过。它证明默认路径被不必要地读取，不是已证明正常实例会出现同一TypeError。冻结后恢复拒绝、process未知误发退出及取消promise引用累积均由复核发现后修正，新增断言执行时修复已在，不编造先红后绿。35项和27项是受控测试演进，不累计为新平台样本。

Host既有`require.resolve('node-pty')` external warning保持，native/spawn守卫未放宽；构建工具普通Node辅助进程不计执行会话。没有运行旧PTY protocol脚本、真实socket服务、native、runner或新平台采集。旧冻结实验、原断言及历史失败不变，独立诊断树不改。

收口静态核对通过：本设计YAML/索引/关联路径一致，第2至20节与`90a7d95b`逐字保持，ExecPlan原12标题顺序不变；AST核对原Host 10处test定义（展开19项）、main 9处check定义（展开13项）正文保持，原分页部分逐字一致，远端reader/client/Supervisor测试文件未改。两份修改mjs逐一语法检查和`git diff --check`通过，变更限定12份既有文件，无native/manifest/依赖修改。最终专项复核未发现本切片确定性blocker；并发相同ACK只产生recorded/duplicate及一次applied，完成/取消后的在途resolver集合为空。

### 21.5 下一有限阶段

下一阶段只收敛L-03正常关闭失败处置与预算的接入设计/最小实现输入。围绕已有两owner、transport及Linux原控制对象，明确正常排空、停止、取消、资源结算各自的期限来源、到点动作、unknown保留和准入限制；不能以杀provider、超时、取消或句柄仍被引用推断主体/资源已释放，也不能把Windows正常进程对象引用语义写成系统bug。先明确会改变本次接入判断的有限条件，再决定对应最小实现和验证，不追加通用工具门槛或默认执行native/runner。

本地与远端受控接线已补齐，不等于L-02整体完成。真实VS Code UI/socket/落盘、L-03原生失败处置、L-04生产能力分流、真实Agent启动链和平台支持仍各自待验收；snapshot-only普通持久化、旧live原绑定、storage generation、F-03 root归属及Runtime无completed历史要求保持。本文第2至20节按`90a7d95b`保留，只本地提交，不push或创建PR，不把本阶段写成重构全部完成。

## 22. L-03正常关闭失败处置与预算

### 22.1 本轮范围与停止条件

从主树`567bcd95`继续，仅做当前真实模块的源码核对与有限接入设计，不修改业务、native、诊断脚本或冻结实验，不执行测试/原生采集/runner。范围是两种owner仍存活时的自然退出收尾、主动停止和正常关闭失败；owner已经消失后的平台保障仍属L-05，但不能以此隐去Host即将退出时的责任缺口。主进程/输出源/authority消费/reader/资源各自结算，超时只改变等待或处置，不改变事实。

本轮形成触发条件、单调期限、到点动作、原控制对象与unknown保留规则，以及下一默认关闭、无native的最小实现和直接验证输入后停止。生产数值、平台控制保障和真实UI/落盘仍需各自验证，不另建诊断框架，不把全部异常崩溃矩阵作为本次设计或下一受控实现的前置。

### 22.2 当前源码事实，不是新增平台实验

以下行号固定于`567bcd95`，`src/`和`native/`均相对`extensions/vscode/dev-session-canvas/`。本轮核对的是正常收尾能否有界报告，不据此宣称已复现真实Terminal/Agent缺陷。

| 事实 | 源码锚点 | 对接入的约束 |
| --- | --- | --- |
| 自然processResult仅通知hook，seal后才等消费/flush；预算只在主动requestStop注册 | `src/panel/executionOwnerLifecycle.ts:154`、`:180`、`:279` | 自然退出后source不结束、消费/flush不返回或资源无结果，当前没有自动有限首报 |
| force/cancel回调用预先算好的下一截止点，新操作要求deadline仍在未来 | `src/panel/executionOwnerLifecycle.ts:194`、`src/panel/executionSessionAdapter.ts:299` | 回调严重迟到可能只触发quarantine而未派发升级；不能把“注册timer”当已执行动作 |
| operation/owner结果处理不复查当前时间，超时首报依赖timer先执行 | `src/panel/executionSessionAdapter.ts:311`、`:336`、`src/panel/executionOwnerLifecycle.ts:274` | 当前是回调顺序，不是严格绝对期限语义；迟到事实可能抢先成为first success |
| adapter退役不等待stop/cancel ACK，未完成操作timer之后仍会隔离authority | `src/panel/executionSessionAdapter.ts:311`、`:346`、`:685` | 真实终态已结算后的ACK缺失必须与资源未知分开，不能先报settled再无说明地重新封禁 |
| owner close的settled不含reader，adapter也不要求source=eof | `src/panel/executionOwnerLifecycle.ts:228`、`src/panel/executionSessionAdapter.ts:685` | settled不是完整输出或server可退出，retired和authority准入另判 |
| 父transport持有ChildProcess与terminate/closed，通用transport只暴露connect/send | `src/panel/executionProviderTransport.ts:172`、`:202`、`src/panel/executionSessionAdapter.ts:42` | owner当前不能使用已有独立父控制；即使接通，也只证明provider-control关闭 |
| cancel受理只置标志，不能越过正在await的信用write | `src/panel/linuxExecutionProvider.ts:152`、`:227`、`src/panel/executionProviderChannel.ts:227` | 取消期间仍须消费已取得内容，accepted不证明source/PTY释放 |

Linux原token的signal先核对同owner wait，master close只尝试一次并保留errno，见`native/linux-execution-owner.h:191`、`:223`、`:241`。`childAcquired/masterAcquired`表示取得历史，不是当前存活/打开标志；父进程没有从日志PID/fd重建主体操作权。provider exit后管道仍未关闭时，父transport不再给已退出child发信号，期限只得unknown；“进程对象仍被其他句柄引用”不能等同进程仍运行或OS bug。本轮只核对Linux候选，不增加Windows/macOS验证结论。

### 22.3 本轮取舍与有界观察

选定下一受控切片采用“有限首报、原责任继续结算”：预算约束调用方何时得到明确报告和何时尝试已批准动作，不把真实consume/flush/native释放Promise替换为超时成功。无期限等待不能满足调用方收尾需要；统一到点kill provider会失去唯一主体控制者或尚未移交内容；把所有失败交给新guardian则扩大拓扑。后三者均不作为本轮路径。

每个原execution只建立一次关闭观察，触发为确定主进程结果（natural-exit）、显式stop/boundary，或执行fault/unconfirmed（failure，不能归为自然结束）。正常完成可早于期限返回，重复stop、reason改变、late facts及reader变化都不重置起点/总期限。同一进程结果在provider端发生的时刻不可跨进程时钟推断；起点取authority实际接收相应事实的单调时钟。owner、adapter与未来父控制必须共用该时钟域，不将测试虚拟时间传给使用performance.now的真实transport。

下一切片沿用显式注入的`gracefulMs/forceMs/cancelMs/settleMs`，另需`naturalDrainMs`。自然退出在`cancelAt = t0 + naturalDrainMs`前继续读取和消费，到点若源仍未结算则只请求cancel；不向已确认结束的主体发graceful/force。主动stop/failure在t0请求graceful，在`forceAt = t0 + gracefulMs`仍无确定主体终态才请求force，在`cancelAt = forceAt + forceMs`源仍未结算才请求cancel。两条路径均在`finishAt = cancelAt + cancelMs + settleMs`作有限首报。cancelMs是请求后的源结算观察窗口，settleMs是额外收尾观察窗口，不代表到点自动封口或消费失败；已有消费从t0持续推进，不等这些阶段结束。没有source缺口时不发cancel，但消费/flush/资源缺证仍受固定finishAt观察。

owner创建的graceful/force/cancel命令，其ACK观察截止统一使用本轮固定finishAt；阶段升级依据主体/源事实和forceAt/cancelAt，而非accepted是否到达。这样阶段timer迟到但仍早于finishAt时，可直接补发仍必要的最高强度stop及cancel，不倒序补发graceful、不顺延总期限。到点先记录first unconfirmed，之后不创建新的语义命令；此前已经提交/排队的原命令仍可能交付，不能把“不新增意图”说成“期限后不再有物理派发”。现有late-ready可发送原start的契约暂不在S5改写；在途启动继续占责任，防止native生产关闭后迟启动仍是后续准入条件。

所有结果入口及timer回调均检查同一`now()`。在`now >= deadline`才由authority观察到的结果，先冻结first unconfirmed，再更新current真实事实；不能因为timer延迟而把超期结果写成期限内成功，也不延长deadline。期限前已经记录的有效结果不因后续通知延迟降格；owner自身首次完成以它实际完成判定的时刻为准，不从provider时间戳反推。系统事件循环停止时不能保证按墙钟准时回包，此规则保证恢复处理后的分类诚实，不声称硬实时。

首次超时只冻结观察并隔离该authority新准入。process/source/seal/resource first/current、authority实际消费与reader结果仍分账；迟到同操作补证可以更新当前责任并退役原执行，但不覆写first，不重发旧seal，不自动清除quarantine或换authority重新开门。源为interrupted/error/unknown时，即使资源已结算也不能显示为完整EOF。真正的final flush失败继续是failed，纯观察超时不能补造这个失败事实。固定保留preparation、process、source、consumption、final-flush、resources等未完成域及quarantine，不新增逐事件轨迹框架。

命令ACK不是额外资源：对已发出的graceful/force/cancel，若到ACK截止时同执行已经依据真实process、source、完整资源账及消费事实达到adapter settled，则缺失ACK仍记录first unconfirmed，不能伪造accepted，但仅这一缺失不再新建authority quarantine。终态未结算时仍沿原超时隔离，先前已建立的quarantine不因迟到补证清除；start握手、真实发送失败、资源/消费失败不适用此豁免。owner最终flush与reader仍独立判断。这是本轮选定的“效果已由事实确认、受理回执未确认”政策，S5须补已退役后缺ACK不误封禁的定向断言；不能简单取消timer使外部等待的operation.first永不返回。

生产毫秒数本轮不指定。S3的20s/30s/2s、旧Agent的5000ms及单元测试缩放值都不是已批准的生产期限；缺少生产profile就不开放native新创建。下一无native实施只使用显式注入值验证顺序、期限分类和责任，不拿用例绿色替代产品预算验收。

### 22.4 原父控制的接入边界

后续父控制接入必须由owner保留原transport/identity绑定的能力，复用已有`terminate({ termDeadline, killDeadline })`及`closed`；不得从PID、generation搜索或新建transport取得操作权。TERM/KILL各至多一次，关闭仅结算父侧provider-control，subject wait、PTY master/source及终端消费不由它代证。termDeadline、killDeadline和最终报告截止须在同一关闭观察内预留，不能到点再按now生成新的2s/4s清理预算。现有terminate拒绝过期termDeadline，阶段追赶/直接KILL必须先定义并验证，不能在接线中偷偷延期；本轮不修改该API。

保守接入条件分两类：确认原start从未物理派发、且未取得主体/源的失败启动，可沿原父对象清理但不得补造process/EOF；已有主体的执行，只有真实主体终态、完整源移交、已取得native资源逐项released且没有不完整资源账时，才可将残余provider-control作为独立清理对象。源移交还须由adapter确认连续尾值、无未解析/拒收原始内容、sourceEndAccepted及相关在途控制发送已结算；仅source字段存在、cancel accepted或缺少资源消息不满足前提。父端已取得内容继续消费，独立provider关闭无需等待页面写回调。

provider卡住且主体或移交仍未知时，不默认杀掉唯一控制者来换取父child退出。保留原控制对象、未知责任和拒新建，报告本次关闭未确认；也不重试可能被复用的FD close。若产品需要在该情形主动牺牲内容/控制来强制退出，应另行选择具名失败处置并验证，而不是称现有能力已覆盖。此条件目前不足以批准native正常关闭失败路径，L-03保持开放；这项限制不能靠模拟terminate成功解除。

### 22.5 两种owner的失败结果

可中止的stop/reset/delete与实际宿主离开分开。Supervisor的stop RPC当前只返回受理（`src/supervisor/runtimeSupervisorMain.ts:1260`），delete等待owner并在未确认时保留责任（`:1292`）；不能把stop受理回包显示为资源关闭成功。单根reset、多根clear和删除对新能力路径都应在失败时保留原节点绑定与责任，不清成成功；legacy批量删除当前会吞连接/delete错误（`src/panel/CanvasPanelManager.ts:10535`），不能把它作为新契约已成立的证据。旧live兼容分支不在本次顺手改写，差异在生产创建开放前解决。

Host的`prepareForHostBoundary()`（`src/panel/CanvasPanelManager.ts:3750`）当前在本地owner关闭抛错后跳过后续detach/持久化；`src/extension.ts:826`还在await前清除全局manager。后续边界接线应分别记录本地关闭、可完成状态保存及远端detach的结果，本地失败不阻止独立的远端reader/client释放，且不得以吞错方式向reset报告成功。实际deactivation到预算后返回具名未确认报告；抛错不能否决VS Code退出，内存map不能承诺退出后的继续管理。没有确认的责任移交者就明确没有移交；Host真的消失之后进入L-05异常owner丢失边界，而不是将正常关闭追认为成功。snapshot-only仍不得被悄悄变成持久服务。

live-runtime的Host/Webview离开只detach，不触发Supervisor或主体stop；relay取消无法确认时由原socket清理记lost，不能补造applied。相关入口为`CanvasPanelManager.ts:9845`与`runtimeSupervisorMain.ts:2409`。Supervisor自身的正常关闭才负责封闭新执行及reader准入、处理现有reader、收尾执行并刷新必要状态。`prepareForShutdown()`（`:266`）仅转调owner close，尚不是完整server关闭；idle（`:2815`）检查pending的保护必须保持。reader未退役、unknown或保存失败不能通过清map绕过；普通关闭失败时Supervisor可保持closing存活，不用重启共享server处理单会话。

reader预算不并入native停止预算。有效页面只是慢时，不能仅为了让owner close绿色就宣布它失效；离开/删除已有明确cancelled/lost路径，资源可先安全回收，最终状态责任仍保留。最终页面等待的生产期限与真实UI验收继续属L-02/容量边界，不在本轮新增一个通用超时器。失败报告的用户呈现及实际持久化验证也不能由这些源码结论代替。

### 22.6 下一有限实现：S5无native关闭观察

下一阶段直接修改既有生产模块，不创建新的诊断层。`src/panel/executionOwnerLifecycle.ts`在显式non-native capability `execution-close-observation-v1`下增加一次性自然/主动/failure收尾观察与`naturalDrainMs`输入；旧注入没有该能力时保持原行为，所有生产创建仍关闭。复用现有停止方法、scheduler、snapshot和changed hook，给snapshot增加有界的关闭观察字段：触发原因、起点/固定截止、first及由现有事实派生的current/pendingDomains；`requestStop()`返回该观察的原首次结果，不另建第二次停止。settled仍仅指执行/authority责任，readerOutcome/retired独立保留。

`src/panel/executionSessionAdapter.ts`补结果入口的绝对期限复核，保留原operation first/current及已排队语义；owner命令使用统一finishAt。adapter的新期限分类及ACK缺失豁免同样受显式内部`closeObservationV1?: true`控制，由owner从execution-close-observation-v1能力映射至ExecutionDependencies；默认不传则保留原语义，不能只gate自然退出timer却改变旧adapter结果。该能力要求naturalDrainMs及已有预算为有限正数，最长路径总和不超过scheduler支持范围，缺参数在transport创建前拒绝。`waitForSealedConsumption()`和真实tracker flush不套伪完成race，缺事实不构造seal或释放资源。Host/Supervisor新能力注入入口只读取同一关闭观察，验证natural与显式关闭调用到真实共享模块；不新增UI协议、public shutdown RPC或用户设置。

直接扩展既有`test-execution-owner-lifecycle.mjs`、`test-execution-session-adapter.mjs`及Host/Supervisor wiring，用现有受控scheduler/transport和实际tracker覆盖有限场景：自然退出源挂起后取消但不发主体stop；credit满仍保留已接受内容；消费/flush/资源等待超期后可继续补证；timer迟到与结果抢先处理不改变绝对期限首报；重复stop与natural转stop不重计时；主体已知、源中断和资源结算不被合成EOF；reader慢不阻塞资源结算；已实际结算后缺stop/cancel ACK只保留回执未确认；未知A保持隔离且已准入B继续推进。仅为现有scheduler补“推进时间但暂扣deadline回调”的定向hook即可，不构建另一套时钟框架。保留原断言和历史结果，不事先写通过数。

S5验收命令在仓库根运行上述四个脚本，并回归`test-runtime-reader-settlement-wiring.mjs`、`test-runtime-supervisor-reader-client.mjs`、`test-terminal-paged-projection.mjs`、`test-execution-session-bridge.mjs`、`test-serialized-terminal-state-tracker.mjs`、`test-runtime-paged-completion.mjs`及workspace typecheck；脚本完整命令均为`node scripts/test/<文件名>`，类型检查为`npm run -w extensions/vscode/dev-session-canvas typecheck`。不运行旧PTY protocol、真实transport七场景、S3/native或runner。S5停止于实际owner有限观察验证与文档收口，不在同轮添加父控制API、平台机制或更多诊断门槛。

S5之后才以22.4的安全前提接原父控制，并完成22.5的Host/Supervisor失败边界接线；这些是真实native准入前必要工作，不因本轮设计或下一纯测试通过而关闭。L-03生产profile、L-04启动/能力拒绝、L-05平台owner消失、真实Agent启动链、UI/落盘及整体产品验收仍开放。

### 22.7 本轮核对与收口

三个只读专项分别核对owner/adapter、原父控制/Linux native、Host/Supervisor边界。复核补清了截止后原排队命令仍可到达、未派发start的独立清理前提、终态已结算的ACK缺失政策；最后发现adapter策略的gate描述遗漏，已明确由同一内部能力传入，不改变默认旧路径。复核未发现剩余直接契约矛盾，但没有实施或实测这些新规则。

静态检查通过：本设计YAML/索引状态和关联路径一致，源码锚点与下一测试入口存在；第2至21节与`567bcd95`逐字保持，ExecPlan原12标题与顺序保持。变更限定五份文档，运行时/测试/native/workflow/依赖及原始工件没有本轮改动，`git diff --check`通过。初次搜索误写不存在的linuxPtyExecutionProvider.ts后已改按实际linuxExecutionProvider.ts核对，搜索失败不计平台或测试失败。本轮没有运行自动化用例、真实transport、PTY/native或runner，只作本地文档提交，不push或创建PR。

## 23. S5无native一次性关闭观察

### 23.1 实施输入与边界

从主树`a32b1510`实施第22.3/22.6节，限显式non-native capability `execution-close-observation-v1`及映射到adapter的`closeObservationV1`，默认路径不启用。`naturalDrainMs`作为既有budgets的可选字段，仅新能力要求；用同一scheduler固定自然/主动/failure时间线和命令ACK截止，记录first/current及有限pendingDomains。所有真实输出、消费、资源和reader事实继续沿既有模块结算，不以超时替换真实Promise或重写旧seal。

修改范围限定owner/adapter及既有owner/adapter/Host/Supervisor定向测试，保留旧用例断言；先复核真实入口是否无需额外业务改动即可传入同一依赖。父控制terminate/API、Host实际退出编排、生产预算、native准入、UI协议和旧live绑定不在本轮。不执行旧PTY protocol、真实transport七场景、S3/native/runner，不push或创建PR，不新增诊断框架；验证结果按实际运行追加，不预填通过数。

### 23.2 实际接线与期限分类

`extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle.ts`的`OwnedExecution`复用原stop Promise和scheduler，按第一次natural-exit/stop/failure固定startedAt、forceAt、cancelAt和finishAt；重复调用只返回原观察。自然退出不发主体stop，源未结算才到点cancel；主动/failure按仍缺少的事实升级，晚到timer只补当前必要动作。finishAt后不创建新语义命令，不撤销已排队的原start/stop。snapshot增加closeObservation，其first与requestStop返回值相同，current及preparation/process/source/consumption/final-flush/resources/observer由原责任派生；reader只影响retired，不另加超时。

同目录`executionSessionAdapter.ts`通过严格`closeObservationV1 === true`开启结果入口期限复核。超期操作先结算first unconfirmed，再接收迟到current。stop/cancel缺ACK的豁免要求operation.sent、当前adapter settled，并记录内部首次事实结算时刻，要求其严格早于该操作deadline；未实际派发不是缺ACK，迟到结算也不能在timer尚未执行时错误获得豁免。此时刻不是新增公共协议。provider主动报告unconfirmed、start握手、真实发送或资源/消费失败均不能借该政策解除隔离。

Host的`CanvasPanelManager.startNonNativeHostExecution()`和Supervisor的`RuntimeSupervisorServer.bindOwnedExecution()`已完整传入共享owner选项，本轮无需修改这两个业务入口。实际入口测试同时注入新capability和naturalDrainMs，并从所创建的真实adapter读取operation.first/current，证明capability确实映射到adapter，而非仅在测试替身内生效。最终tracker flush仍等待真实Promise，纯观察超时不构造failed、EOF、seal或released；迟到完成继续原责任且不清quarantine。

### 23.3 验证记录

adapter先加10项断言再改实现，首次63组为58通过/5失败，原53项全部通过；初实现后63/63。复核发现“结算在deadline之后、timer之前”仍可能误豁免，新增第64组在结算时刻恰等于deadline时实际失败（63通过/1失败），记录factualSettledAt后64/64。该红运行输出断言后进程未自行退出，核对为本轮test进程后仅对其发TERM，以143收口；未修改测试退出设施，不把中止写成通过。

交叉复核又补清22.3限定的“已发出”前提：在既有新增ACK用例内增加未派发子场景，63/64、exit1实际失败后增加operation.sent，最终64/64、exit0；同用例确认原排队意图仍可能在期限后派发，不以本轮观察策略伪称撤销。owner复核修正已abandon/退役对象再stop的永不返回风险，并防final observer同步重入时先发布success再抛错；两处新增测试执行时修复已在，不称先红后绿。owner首次并发typecheck报reason可选类型错误，修正后通过。

Host首次运行原35项全过，新自然场景在adapter.first之后未泵现有scheduler的stateChanged，过早断言owner.first而失败；仅新增用例补现有until，第二次39/39。Supervisor首次40/40，owner26/26。最终根代理复跑同四脚本通过，相关旧reader接线20/20、client13/13、实际main/headless27/27及原分页断言、bridge、tracker、四条Terminal/Agent分页完成场景通过；workspace typecheck通过。执行命令沿22.6，当前环境Linux/Node v25.6.0；所有结果仅受控无native/无真实socket服务。Host既有node-pty external构建warning保留，未放宽加载/创建守卫。

本轮只扩四个既有测试，原owner13、adapter53、Host35及Supervisor36项正文保留；新增量分别13/11/4/4，不合算为原生样本。静态检查通过：设计YAML/索引/关联路径一致，原第2至22节及ExecPlan十二标题顺序保持，AST比对原测试定义点13/52/24/32逐字不变（循环展开后为13/53/35/36项），四mjs语法检查及diffcheck通过。最终独立只读复核未发现本切片确定性阻塞。两业务入口、native、manifest、依赖、workflow及旧实验不改；恰为两实现、四测试、五文档，无未跟踪文件，仅本地收口。下一阶段仍有具名准入缺口，不因本轮绿色提前放行。

### 23.4 下一有限阶段与未关闭项

下一按22.4接入原父控制前，先核对同一transport对象能提供的安全事实及固定期限追赶行为，再实现必要的最小接口与定向测试。清理能力只证明provider-control，不代证主体wait、PTY/source或消费；未确认主体/内容移交时不能默认终止唯一provider。Host真实离开与Supervisor正常关闭随后按22.5分别编排，本地失败不能跳过独立live detach，reset/delete不能吞错成功。不要重开D3/D4通用工具增强或自动运行native矩阵。

本轮停止于默认关闭的实际模块和受控入口验证。生产profile、在途start关闭约束、父控制安全谓词/接线、真实宿主失败编排、UI/落盘、真实Agent启动链及跨平台仍开放，L-02/03/04/05和总体重构均未通过；旧live绑定、root归属和generation不变。

## 24. S6原父控制的受限安全接线

### 24.1 输入、范围与实际缺口

从`d934867c`继续，限默认关闭、显式non-native的原父控制接线及真实模块纯验证。现有transport持有原ChildProcess，但terminate实际执行晚于调用时仍可能补发过期TERM/KILL，close首报也受timer顺序影响；adapter快照缺少启动派发封闭、精确sourceEndAccepted发送完成和完整资源清单证明。不能由owner在外部拼快照后异步kill。本轮修改前先冻结本节；生产毫秒数、Host真实离开编排、native准入和其他平台不在本切片。

### 24.2 固定契约与同步清理准入

`executionSessionAdapter.ts`为ExecutionTransport增加可选原`parentControl`能力，包含同一identity、scheduler、不可变非空expectedNativeResourceIds、closed和terminate；该清单来自原provider工厂的固定契约，不能由一次cleanup请求临时指定。内部`parentCleanupV1?: true`要求同时启用closeObservationV1，并在connect前校验原identity、scheduler对象相同及有限合法资源清单。通用旧transport不获得新能力。Linux候选的固定三项为pty-master/pty-child/pty-source，源码在sourceEnd之前报告取得及释放；部分创建缺项、额外资源或清单未闭合都保持不准入，本轮不修改native或增加通用inventory协议。

adapter提供同步`tryBeginParentCleanup()`，成功后返回一次性原claim，绑定原control而非PID。未派发分支要求尚无实际start派发、主体/source/seal/输出/其他资源，且无在途发送；同步封住late-ready、新start/stop/cancel并明确结束尚未派发的原操作观察，不伪造accepted、process或EOF。已经派发的启动不进入此分支。已执行分支要求确定主体终态、经连续尾界校验的显式sourceEnd、无raw/拒收或解析失败、精确sourceEndAccepted发送成功、控制队列及在途发送为空、实际native取得集合与固定清单精确相等且各项released、账本完整。失联合成source不能满足；显式interrupted/error/unknown保留其分类，不变成EOF。

两分支都要求已经取得尚未释放的原provider-control，任何已有firstFault保守拒绝新claim；不是所有失败启动都可清理。尚未派发的start具名记为failed、stage为parent-cleanup-before-start，不把本地封闭当作provider确认。原固定清单在构造时复制冻结并拒绝空洞数组，后续修改外部对象不能改变准入范围。

该封闭只约束parent本地意图及已确认的固定provider契约，不声称原子锁住任意远端native行为。准入后原事实监听、已接受内容消费和flush继续；晚到非法取得、内容或矛盾事实令claim失效并阻止尚未执行的信号升级。父控制每次信号前复查claim的canSignal。预期的父控制disconnect/data-close不补造执行主体或源事实；真实错误、违约及原quarantine仍保留。sourceEndAccepted发送完成不等于provider已处理，允许清理是因为内容已归parent且native资源已释放，不称provider自然关闭成功。

失效的unstarted claim即使随后收到原control释放，也不能按“未创建主体”退役；保留unconfirmed和quarantine。此时pendingDomains可能为空，它只是各事实域的待办摘要，不能脱离current和quarantineReason作为成功判据；本轮不为该诊断细节扩展域模型。

### 24.3 固定预算与原控制结果

owner新能力`execution-parent-cleanup-v1`必须同时具备S5能力，额外显式注入parentTermMs/parentKillMs，二者为有限正数且总和不超过settleMs。在第一次关闭观察内固定`parentAt = finishAt - parentTermMs - parentKillMs`、`termDeadline = finishAt - parentKillMs`、`killDeadline = finishAt`。正常事实可提前结算；到parentAt之后、finishAt之前才尝试安全claim。到点不安全则继续等原事实，不换provider，不顺延。迟到至termDeadline只允许直接KILL；到killDeadline不再发送信号。新capability缺失时不变更S5或旧控制路径。

`executionProviderTransport.ts`通过显式parentCleanup选项暴露原能力，并复用原terminate方法的新opt-in期限策略；旧调用保持原义。新策略与owner共用注入scheduler，复制固定期限与canSignal，重复同请求复用Promise，冲突参数拒绝。TERM/KILL各至多一次；原child已exit/close时不再发信号。期限timer与真实finishClose入口共同冻结first，超期真实关闭先记unknown再递交released；closed仍只表示真实关闭，迟到可以完成但不覆盖首报。release时刻用于区分期限前事实与通知迟到，不能仅看Promise回调顺序。

每次实际信号仅在canSignal严格返回true后发出，再读时钟追赶阶段。false只跳过信号，仍等原期限或真实释放；抛错先固定unknown并通知资源观察者，再记录具名fault，防同步重入改写首报。TERM/KILL返回、child exit和单条stream关闭都不是完整provider-control释放证明。

terminate返回值不代替provider-control资源结果；owner仍由原adapter资源事实判断结算。未派发且已封闭的启动在控制资源真实释放后可作为“未创建执行主体”结算，不生成terminal applied或seal，reader仍按原规则单独退役。已执行内容继续真实消费，不把父控制关闭当作最终flush完成。

### 24.4 有限实施与验收

修改限owner、adapter、原transport和对应定向测试，必要时只扩Host/Supervisor既有注入测试。新增一个窄的transport纯测试入口，沿现有channel测试方式替换Node child/stream边界，加载真实transport代码；不建立另一套诊断框架，不更改或运行旧真实transport七场景。测试证明同步准入、固定期限追赶、first/current、原对象、逐资源事实、消费独立与旧gate兼容，不代证OS回收。

新增入口为`scripts/test/test-execution-provider-parent-control.mjs`，只替换Node child/stream/time边界。它包括真实owner、adapter、transport的未派发启动组合，验证原对象接收信号、原通道逐项关闭才报告released，以及没有process/seal/flush伪造；不是实际OS进程清理。Host/Supervisor现有wiring各新增Terminal/Agent两项，暂停实际tracker消费，父清理返回、原控制资源释放、最终flush及reader退役分别断言。

根代理最终在仓库根执行并取得exit0：owner33/33、adapter81/81、新transport纯测9/9、Host41/41、Supervisor42/42。旧reader接线20/20、client13/13、实际main/headless27/27及原分页断言、bridge、tracker、四条Terminal/Agent分页完成回归全部通过，workspace typecheck通过。五份修改/新增mjs语法及diff检查通过。环境为Linux/Node v25.6.0；Host原node-pty external构建warning保持，native加载/创建守卫未放宽。

保留真实先败记录：Host先跑原39项通过，首个新增Terminal场景因原父清理尚未实现而超出100调度轮次，exit1，后续Agent新项未运行；不能将其计为完整41项首跑。Transport先跑1/9通过、8项缺新能力失败；实现后9/9。Owner新增unstarted的late-data子场景曾因adapter错误settled而失败，加入失效claim保护后33/33。Adapter脚本首次81/81通过，不把该owner失败挪记为adapter先红。并发typecheck先报send回调中可变message丢失类型收窄，改用固定sentMessage后通过。复核发现空洞清单校验漏拒绝；transport在原validation组补Array(1)先8/9，窄修后9/9，adapter同处修正。上述失败不改写，重复通过次数不累加覆盖数。

修改为三实现、五测试、五文档；原四套测试的定义正文保留，fixture仅扩显式能力，新增量分别owner7、adapter17、Host2、Supervisor2。旧transport的runTermination/observeClose/requestSignal正文保持。两业务入口、native、manifest、依赖、workflow、旧原生实验及失败工件不改；原第2至23节保持。独立只读交叉复核owner与transport未发现本切片确定性阻塞。

静态保持检查通过：设计元数据/索引状态/关联路径一致，原第2至23节逐字相同，ExecPlan十二标题顺序不变。AST比对原测试定义26/63/27/35处逐字保持（循环展开为26/64/39/40项），三个旧transport方法逐字保持。新transport纯入口是唯一新增文件，没有生成工件或额外归档；文档交叉复核修正了一处将生产profile误并入下一22.5的表述，未扩大下一阶段范围。

### 24.5 下一有限阶段与未关闭项

下一仅按22.5接真实Host/Supervisor正常关闭失败编排：区分可继续存活的reset/delete与不可继续托管的Host实际离开，任何本地失败都不能跳过独立live detach；Supervisor仍须等待自己的原执行责任，不以清map代替资源或reader结算。先将实际入口及错误传播选择补入设计，再沿现有注入方式直接验证。生产毫秒数、native/PTY与平台矩阵不自动启用，也不再追加通用诊断框架前置。

本阶段不提供部分创建、未知主体或未完整移交时强停唯一provider的权限。生产profile、L-02/03/04/05、真实UI/落盘、实际Agent启动链及跨平台仍开放；旧live绑定、root归属、storage/generation不变。正常结束不恢复进程/历史及不承诺主体退出后的普通后代持续输出等产品边界保持。没有运行旧PTY protocol、真实transport七场景、S3/native/runner，也不push或创建PR；S6不是L-03或整体重构完成。

## 25. S7实际宿主正常关闭失败编排

### 25.1 输入与有限决策

本轮从`ade8f133`继续，第25节在实现前冻结。仅显式non-native新能力`execution-owner-boundary-v1`启用，要求S5关闭观察和`budgets.boundaryMs`有限正数、不超过scheduler支持的0x7fffffff；创建transport前校验并复制冻结，不新增用户设置、公共shutdown RPC或生产默认值。整体边界与原execution同scheduler，首次调用固定startedAt/deadline，重复调用不续期；boundaryMs可以短于执行预算，此时只提前报告整体未确认，不改变原消费、flush或操作期限。timer与结果入口均复核now >= deadline，未知/失败不改为EOF、applied或released。

S7只补实际Host和Supervisor正常关闭的编排及失败传播，不重开通用诊断工具。原第2至24节、旧测试正文和历史证据保持；旧能力路径保持。两宿主边界有不同职责，不抽象为一套通用资源框架。

### 25.2 Host永久离开与可中止操作

`CanvasPanelManager.prepareForDeactivation()`的新能力路径不执行整个旧prepareForHostBoundary后半段，也不对该方法简单套race。首次进入同步永久关闭本地执行准入，分别启动local close、当前canvasSnapshot实际保存和原live reader/client detach，共用固定整体期限并返回具名不可变首次报告。一个域失败或悬挂不阻止其他独立域尝试。到点未完成标未确认；本地执行与已提交写入允许迟到完成，但不改首报、不追加清map/delete/reconnect，也不声称Host消失后内存unknown仍在托管。

永久离开只detach既有Supervisor连接，不根据下一配置删除、停止旧live；同步释放使用原relay/client对象，不先等可能挂起的pendingRuntime操作。各原client独立尝试，单个释放失败不跳过其余对象。dispose会拒绝在途请求，Host的operation tracking清理不能再派生未处理拒绝；只移除该清理旁路，原调用方仍接收原错误。`getRuntimeSupervisorClientForBackend()`须在工厂取得前、异步连接之后复核永久边界，阻止已在途路径重新登记或返回可用连接。保留未知执行、节点和绑定；真实执行已完成后的原自然退役不禁止。`extension.ts`在await/报告产生前保留原manager引用，结束后仅清除同一个对象，不影响可能的新manager；抛错不是VS Code退出否决机制。

`remoteDetach.settled`仅表示原relay关闭已发起且各原client.dispose同步返回，不证明远端reader完成应用或OS socket已经释放。与Supervisor的真实close确认采用不同证据边界，不能因同名settled混为一谈。

canvasSnapshot只表示本次现有画布状态写入。新路径等待`persistState()`的原Promise，并启用root-local写失败传播，不能用吞错的pendingWorkspaceStateUpdate barrier冒充成功。nonNativeHostExecutions的最终tracker当前尚未投影到state.metadata；因此该保存不证明新路径终端最终态持久化，后者仍是L-02缺口，不在S7悄悄增加历史保存。local域仍必须等真实消费/最终flush。

reset/delete属于可中止操作，不能复用deactivation的“报告后继续离开”。本地关闭未知时单根reset拒绝、多根clear明确失败、delete发送错误并保留节点/绑定；原有明确reader取消可保留，不伪造页面应用。既有旧live批量delete吞错不在本轮顺手改写，新生产能力分流前仍须解决，不能将其写为新契约通过。

### 25.3 Supervisor保留责任后再关闭

`RuntimeSupervisorServer.prepareForShutdown()`仅在新gate下启用完整边界。任何await前封新execution和全部new reader/attach/subscribe准入，包括原socket上的legacy请求；仅owned session关闭用户mutation/delete，不改变legacy onData条件而截断旧内容。保留已准入reader的page/ACK/close及必要checkpoint；边界前已登记owned责任的在途open继续完成，不因await后进入shutdown就取消它，尚未登记的新准入则须在await后再次检查。已有legacy cursor/订阅也计入未退役责任，不能因不在新owner列表就忽略。关闭owned reader准入后沿原聚合方法结算确实空的集合，使S6未派发启动清理无需伪造seal/flush即可退役；不能一并伪结算旧socket订阅。监听器开始close并在新连接入口拒绝边界后连接，已有有效reader不因慢或预算耗尽被标lost。

完成判据分别检查原execution当前责任、reader退役、必要registry/journal保存以及原server/socket真实关闭。owner.close缓存的是原first且settled不含reader，不能单独授权服务器退出；责任与reader必须以原owner当前记录确认为已退役。必要保存使用现有registry流程的窄严格入口，已有journal error或本轮snapshot/journal失败不能被fallback保存掩盖；保存await后新增的retiring/替换不能沿legacy过滤逻辑静默隐去，保留可重建旧checkpoint加journal的正常策略。未知或保存失败保持closing存活，不清map或自动换server。

仅当前执行和reader责任均结算、严格保存完成且仍在原期限内，才结束原sockets；end调用不是close事实，server.close callback及原socket close分别确认。期限后已发出的关闭可迟到完成，但不从晚到保存继续发起新关闭或退出。新gate的idle复用该边界，未知/失败不执行旧process.exit(1)，也不在异步保存期间重新开放准入；旧gate的idle保留。

关闭监听后若已无其他活跃句柄，Node可自然退出；仅省略process.exit不足以满足这里的保留责任。新gate每实例最多持有一个ref'ed keepalive timer，复用`IDLE_SHUTDOWN_DELAY_MS`作为保活周期而非新的关闭预算。仅整体首次结果settled时释放，failed/unconfirmed持续保持closing，不重试、不重新开放、不追加清理；不承诺抵抗OS kill或机器故障。现有idle正/负用例检查持有/释放，fixture在finally回收该timer，不新增矩阵。

owned delete仍不把stop受理当结算，unknown保持原责任。新gate删除持久化失败时不得先dispose tracker再假称完整保留；必要的窄顺序修正先确认journal删除结果再销毁已退役对象，真实失败要传播，不能以清map掩盖失败或宣称已经回滚文件删除。

### 25.4 本轮实施与验收输入

已修改共享owner的能力/预算验证、CanvasPanelManager、extension的引用收尾、RuntimeSupervisorServer及三份既有owner/Host/Supervisor wiring测试。沿原fixture注入受控scheduler、原模块和fake socket/server关闭事件，不启动真实listen/PTY/provider。新增测试只覆盖本次判定所需的正常、失败、挂起、到期/迟到及准入竞争；不建通用诊断层，不改旧断言求绿。结果与失败分类见25.5。

仓库根运行`node scripts/test/test-execution-owner-lifecycle.mjs`、`node scripts/test/test-host-execution-owner-wiring.mjs`、`node scripts/test/test-supervisor-execution-owner-wiring.mjs`，回归adapter、parent-control纯入口、reader接线/client、projection、bridge、tracker、paged completion及workspace typecheck。所有脚本沿`scripts/test/`既有入口，不运行旧PTY protocol、真实transport七场景、S3/native/runner或真实socket服务。文档元数据/索引/计划十二章节/历史保持和diff检查后本地中文提交，不push/PR。生产profile、完整终端落盘、L-04分流、L-05宿主异常消失、真实UI/Agent启动链及跨平台仍不因本轮受控验证关闭。

### 25.5 实际结果与证明范围

本机Linux/Node v25.6.0最终owner35/35、Host49/49、Supervisor60/60均exit0。原测试定义33/28/36处逐字保持，循环展开分别33/41/42项；本轮增加2/8/18项，不累计复跑。Host新增项包括提取真实未改写`deactivate`声明的受控lexical binding测试，覆盖等待、并发、替换对象和同步/异步失败，不是完整activate或VS Code生命周期验收。

adapter81/81、parent-control纯入口9/9、reader接线20/20、client13/13、实际main/headless27/27及原分页断言、bridge、serialized tracker、四条Terminal/Agent分页完成回归和workspace typecheck通过。Host既有node-pty external构建警告保留，守卫未放宽。没有真实socket/listen、PTY/native、旧transport七场景、S3或runner；受控关闭事件不证明OS资源释放，更不代表跨平台通过。

提交前静态核对通过：YAML元数据、索引状态和关联路径有效；第2至24节相对`ade8f133`逐字保持，ExecPlan十二标题及顺序不变，原三测试定义逐字保持、三mjs语法检查通过。范围恰为四实现、三测试、五文档共十二个已有文件，无新增文件或工作流/依赖变更，git diff --check通过。

先败按原因保留：owner原33项通过后，第34项缺失预算异常而exit1，第35项未跑，补校验后35/35；Host原41项通过后首新增Terminal场景预期立即detach却得到空列表，补编排后进入后续用例；Host新fixture误用clock.jump产生TypeError，仅改既有elapse；Host原45项通过后pending请求拒绝触发tracking旁路派生的unhandled rejection，改为then双分支清理后通过。Supervisor首轮45项通过后late-tail fixture先发sourceEnd而数据帧尚未接受，只修新fixture等待acceptedThrough===1后再seal；随后组合测试59项通过，第60项S6未派发清理的空reader仍pending，沿原空集合聚合修复后60/60。owned stop守卫、legacy新reader准入澄清和keepalive来自源码复核，不编造测试先红；extension测试首次即通过。

### 25.6 下一有限阶段与未闭合项

下一阶段只处理snapshot-only新路径的最终终端状态如何从原tracker投影到原节点metadata，以及实际保存完成/失败保留的顺序。必须先冻结原节点/执行身份、最终flush与metadata提交点、保存失败的可见结果和Host永久离开的时序，再扩现有Host/持久化定向验证；不能把S7并行保存的旧画布状态追认为最终态落盘。Runtime模式已结束节点重开仍不恢复进程或历史，旧live绑定继续使用原Supervisor；不把这个有限项扩为completed历史归档。

L-03生产profile仍未选定，L-02总体消费/页面/落盘验收、L-04生产能力分流及旧live批量delete吞错、L-05异常owner消失、真实VS Code UI/Agent启动链和跨平台仍开放。整体计划继续active；下一阶段不默认开启native或runner，不重开通用诊断框架。

## 26. S8本地最终态保存

### 26.1 输入与有限方案

2026-09-26从`c5a0487f`完成25.6。源码确认新Host路径在原tracker flush后仅发布页面最终态，未投影节点metadata；S7画布保存独立并行，不能证明该终态已写入。本轮只补snapshot-only的最终状态保存，不改变Runtime已结束无历史、旧live绑定、root/storage/generation或生产/native准入。第2至25节及原测试正文保持。本节在实现前冻结有限决策，实际结果见26.5。

显式non-native能力`terminal-local-persistence-v1`要求同时具备`terminal-local-settlement-v1`和`execution-owner-boundary-v1`（后者仍要求关闭观察及显式boundaryMs），transport创建前校验。旧gate不变；不新增用户设置、磁盘格式、公共RPC或通用保存框架。

### 26.2 保存责任与身份

`CanvasPanelManager.ts`的原NonNativeHostExecution增加独立保存结果与单次Promise，保存失败不改写terminal applied、process、source或reader结果。成功最终flush且主体有确定终态后，按原revision克隆最终SerializedTerminalState，沿buildExecutionMetadataPatch/updateExecutionNode投影到snapshot-only metadata；保存退出信息、尺寸和有限最近输出，清旧runtime绑定/terminalStream/discarded标记，保留已有Agent配置和显式resume上下文，不从输出猜测resume身份。source非EOF不能凭成功保存宣称输出完整，退出消息保留该不完整原因；主体未知或flush失败不覆盖旧快照，报告未确认/失败并保留原记录。

零输出的原tracker可能未写outputSequence；仅在finalRevision和已消费序号均确认为0时，将保存快照规范化为显式0，正文/光标保持原flush结果，不放宽非零校验。最终提交metadata及发起保存前再次检查原Host deadline，避免同步快照计算跨过期限后新增写入。无subject的S6结算可独立标not-required，不以reader已退役作为没有保存义务的前提；释放record仍须reader实际退役。

提交前同步核对原map记录、原execution身份、节点id/kind以及捕获的metadata[kind]引用。首次await前为原节点规范化并捕获metadata；不依赖易因布局修改而替换的node对象，也不滥用runtimeSessionId或删除前会失效的operation token。布局/标题更新保留执行metadata时允许提交；执行metadata被替换即保守判身份冲突，不覆盖新节点或自动重绑定。提交时只patch一次当前state，保留其他节点/布局；await保存后不再patch旧节点。这个保守限制不是完整生产并发编辑策略。

每个record只提交一次`persistState({ mode: 'immediate', workspaceStateMode: 'full', requireRootLocalDurability: true })`，等待原Promise而非吞错旁路。成功表示原root-local及workspace canvas文件写入、必要workspaceState更新完成，不声称fsync/断电事务；部分文件成功后另一个写失败不宣称回滚。记录、最终快照及tracker在保存pending/failed/unconfirmed时保留，只有执行和reader均退役且保存成功才释放。S6未派发启动或准备阶段abandon无终态保存义务，明确中性结算。原map的未完成保存记录计入S1_LIMITS.executions容量，同key不得覆盖，不新增无界旁路列表。

### 26.3 Host边界与可中止操作

S8仍立即独立尝试S7初始画布保存及live detach；canvasSnapshot域同时等待边界捕获记录的最终保存结果，初始旧快照写成功不能提前报告终态已保存。固定Host deadline之前未提交的最终metadata/保存，期限后不得再发起；原已提交写入可迟到完成，只更新保存事实，不改S7不可变首报。该期限不伪造进程退出、EOF或reader applied；实际Host消失后不承诺继续保存。

正常运行中的自然结束直接沿单次原保存完成；磁盘或workspaceState失败记录明确错误并保留，默认不自动重试。reset/delete除原owner结果外，还须检查Host保存责任，不能因owner已退役而绕过pending/failed记录；原执行关闭返回后，保存仍pending时明确报未确认并中止，不无限等待一个已不受执行预算覆盖的保存Promise，不新增保存预算。写完成后允许再次操作；保存失败仍保留节点，不自动重试。同步报告与诊断不应派生unhandled rejection或反过来改变已冻结保存结果。

### 26.4 有限验证

扩既有owner/Host测试，保留原35/49项正文；新增Terminal/Agent成功最终态、写失败、挂起/迟到、身份替换、布局保留、无终态与reset/delete不得绕过。至少一次直接运行真实persistState、root-local和workspace写入/rename后读回JSON，对比原tracker数据、revision和退出状态，并从实际snapshot恢复入口读取；workspaceState受控，不声称VS Code UI重开验收。独立检查Runtime无历史路径未受影响，不扩容量或归档矩阵。

仓库根运行owner/Host、相关Supervisor/reader/main-headless/adapter/parent-control/bridge/tracker/paged及现有多根回归、workspace typecheck。禁止旧PTY protocol、真实transport七场景、S3/native/真实socket/runner。收口前同步计划、索引、原则与债务，核对历史/语法/文档/diff后本地中文提交，不push/PR。L-02总体、L-03生产profile、L-04分流及旧live吞错、L-05异常owner消失和真实Agent/UI/跨平台仍开放。

### 26.5 实际结果与失败分账

本机Linux/Node v25.6.0最终owner36/36、Host56/56均exit0，原35/49项正文保持。新增owner一组能力依赖校验、Host七组，覆盖Terminal/Agent零输出exit0和尾输出exit7；直接运行原persistState、root-local与workspace writer/rename、JSON读回及load入口，再将保存正文交给真实headless xterm验证内容与最终光标。这里只证明单root和workspace文件路径，不代证多根VS Code重开、fsync或断电事务；workspaceState.update为受控边界。原多根composition回归通过但不合称多根磁盘整链。

Host负向组通过原.tmp路径设置目录障碍分别制造root及workspace真实写失败，并注入workspaceState.update拒绝/挂起；部分文件已成功明确保留，不宣称回滚。原owner已退役时保存pending/failed仍挡同key、delete/reset；已有磁盘写但update未返回不能报保存完成，迟到结果不改S7首报。到期后才完成final flush不再patch或写；metadata替换拒绝、布局/标题及无关节点保持；process未知和flush失败保留旧文件，source中断保留原原因。S6无主体保存中性分账来自源码复核，本轮未新建no-ready测试工具或容量矩阵。

相关回归Supervisor60/60、adapter81/81、parent-control纯入口9/9、reader接线20/20、client13/13、实际main/headless27/27及原分页断言、bridge、serialized tracker、四条Terminal/Agent分页完成和多根composition通过；workspace typecheck通过。Host既有node-pty external warning保持，native守卫不放宽。专项只读复核无本轮直接blocker；无PTY/native/真实socket/runner，不代表生产或跨平台验收。

本轮先败：owner原35项全过，第36项缺依赖校验而Missing expected exception，补校验后36/36；Host原49项全过，首新增Terminal零输出保存failed，原flush将undefined序号视为0而新保存校验拒绝，局限S8规范化克隆后成功，tracker原事实不改。新增测试另两次断言修正属于假设错误：workspaceState原路径允许recentOutput，只剥serializedTerminalState/terminalStream；边界测试须先等待local完成微任务再推进deadline，未处理回调不能追认按时。初次typecheck报诊断对象重复kind，改独立result字段后通过。提交前时钟复核、S6独立n/a、异常隔离与legacy短路保护来自源码复核，不编造先红。

旧`test-runtime-completed-history.mjs`本轮为exit1：前段Terminal781/Agent812字节及文件读回断言通过，后续抽取式Harness缺surfaceLifecycle，在postPagedExecutionSnapshot报TypeError。独立内存加载`c5a0487f`原脚本、原Host及8个repo TS输入得到同样失败，确认非S8引入；原脚本不修改、不追认完整通过。其抽取的9个Host方法和5个顶层函数共14项、旧测试/完成历史迁移模块/reader relay相对基线逐字保持。有效模式证据仅限已执行前段及源码保持，后续reopen/remote completion/client retirement不作为本轮通过，夹具缺口单独登记，不升级为产品缺陷或通用工具门槛。

提交前静态检查通过：YAML/索引状态与日期/关联路径有效；设计第2至25节逐字保持，ExecPlan十二标题及顺序保持；owner/Host原35/35个定义（展开35/49项）保持，仅新增1/6定义（展开1/7项），两mjs语法通过。Runtime相关14声明和3文件再核保持，改动恰为两实现、两测试、五文档共九个已有文件，无新增文件或依赖/工作流修改，git diff --check通过。

### 26.6 下一有限阶段与未闭合项

下一阶段回到生产准入方案：收敛L-03各阶段预算的来源与总关闭边界、L-04创建前能力选择和降级规则、旧live批量删除错误传播，以及最小Linux provider接入实际Host/Supervisor的范围和验收输入。当前注入仍明确non-native，输入/resize也不支持；不能只开gate就宣称已替换产品执行。先固定这一有限接入设计，不再为每个局部增加诊断框架或独立验证门槛，不自动启动native/runner。

S8的metadata引用冲突是保守拒绝，保存失败默认无自动重试或用户恢复流程，不是完整生产并发编辑/恢复方案。真实VS Code重开、完整多根落盘整链、Agent启动包装链、生产profile和能力分流、L-05异常owner消失及跨平台仍开放，L-02和退出完整性总项不关闭。Runtime completed无历史、旧live沿原Supervisor以及root稳定归属待办继续按原边界处理。

## 27. 生产接入有限决策与下一实施

### 27.1 范围和直接源码依据

本节完成26.6，不重做已完成的S4至S8，也不批准真实PTY、runner或默认启用。以下路径以`extensions/vscode/dev-session-canvas/src/`为前缀，锚点对应`b235a7bc`。缺口是生产接入所需差异，不把源码核对写成新的平台实测失败。

| 入口 | 当前事实 | 本轮决定 |
| --- | --- | --- |
| `panel/CanvasPanelManager.ts`的`startAgentSession`、`startTerminalSession`与`startNonNativeHostExecution` | live-runtime先走Supervisor，本地注入只覆盖snapshot-only；转换LaunchSpec时没有传cols/rows | 保持两种owner，不把Runtime迁到Host；初始尺寸必须进入新provider启动契约 |
| `supervisor/runtimeSupervisorMain.ts`的`createSession`、`requireLiveSession`、`main` | owned分支不创建session.process，但live校验要求process；实际main未注入owner | live校验改为按会话执行类型判断，不能为通过校验伪造process；实际工厂在Supervisor中创建 |
| `common/executionLifecycle.ts:51`、`:149`及`panel/executionProviderChannel.ts:94` | ready只允许/声明execution-lifecycle-v1，不能代表交互能力 | 生命周期、交互和reader能力分层检查；旧ready不因类型放宽自动获得新保证 |
| `panel/executionProviderTransport.ts:189`、`panel/linuxExecutionProvider.ts` | stdin直接end；Linux binding只有创建/read/wait/signal/close，无write/resize | 补原IPC上的有限交互协议和token所有权API，不让Host/Supervisor接触PTY fd |
| `scripts/build/linux-execution-provider-patch.mjs`、`scripts/test/fixtures/linux-execution-provider-fixture.ts` | patch明确移除原resize导出；真实入口仍是固定80x24的测试fixture | 不能靠上游resize或测试fixture宣称已具备产品入口；需独立构建入口和可追溯产物 |
| `panel/CanvasPanelManager.ts:10650`、`:3863`及`panel/runtimeSupervisorClient.ts:352` | 批量删除吞连接/请求错误，调用前已清bindings；普通request会再次ensureConnected | 按27.4保留原责任并聚合传播，禁止删除时隐式重启/换generation |

本轮不修F-03 root归属；新旧路径仍使用各自已有storage绑定，后续root稳定归属必须同时覆盖单根/多根。也不恢复Runtime completed正文或崩溃后进程。snapshot-only最终保存仍按S8，与Runtime轻量终态分开。

### 27.2 单一候选预算与整体边界

选定内部不可变配置`linux-owner-v1-candidate`作为下一受控实现的明确输入，不新增用户设置，不把散落fixture数值当默认值。该名字表示候选配置，不是Supervisor storage generation或单会话ExecutionIdentity.generation。工厂在创建前一次性选定profile并传给owner；字段缺失、非法或不相容时，在provider资源取得前拒绝，不由各入口自行补值。

| 字段 | 候选毫秒数 | 依据和解释 |
| --- | ---: | --- |
| startMs | 10000 | 新工程取值，未验证；从注册原start观察起算，不含CLI/env准备await，不是总创建SLA |
| gracefulMs | 5000 | 只有旧非Claude Agent的Ctrl-C后升级等待提供行为依据；不证明SIGTERM等价，也不是EOF等待依据 |
| forceMs | 2000 | 新工程取值，观察强停后的原事实，不把signal受理当主体退出 |
| naturalDrainMs | 2000 | 新工程取值，主体终态后仍排空；到点仅按原契约请求取消，不补造EOF或保证主进程尾部已收齐 |
| cancelMs | 2000 | 新工程取值，取消后的移交窗口，不丢已读/已接受内容 |
| settleMs | 4000 | 新工程取值，原资源/消费结算观察；不代替reader或保存 |
| parentTermMs / parentKillMs | 1000 / 1000 | 新工程取值，内嵌settle最后2000ms，仅原安全claim成立才有清理权限 |
| boundaryMs | 20000 | 新工程取值，Host/Supervisor各自整体首报窗口，不是每域独立窗口或强制进程退出期限 |

沿`panel/executionOwnerLifecycle.ts`的`beginCloseObservation`保持原公式：首次触发时刻为t0，自然退出cancelAt=t0+naturalDrainMs，主动/失败cancelAt=t0+gracefulMs+forceMs，finishAt=cancelAt+cancelMs+settleMs；候选分别为8秒和13秒。父清理起点为finishAt-parentTermMs-parentKillMs，不再追加2秒。首次原因固定时间线，后来的stop、dispose或整体关闭不得重置；事实满足可提前返回。进程仍未知、partial-create或内容移交不安全时，预算到点不授予杀provider的权限。

Host和Supervisor边界各在首次进入时固定B=tBoundary+20000，所有捕获责任并行使用同一个B。Host的local、初始画布保存、最终保存和remote detach不串接多个20秒；Supervisor的执行、reader、严格registry及server/socket关闭同理。已有执行观察仍保持原期限，整体首报可以先于某个执行结算；到B冻结未确认，不把慢reader改成lost。B后不从迟到保存派生新的metadata写入或socket关闭，已提交操作可补current而不改first。Host消失不承诺内存责任延续，Supervisor则按S7保持closing和保活。

这些数值全部未经过本轮运行验证；只有5秒的旧行为来源已确认。`runtimeSupervisorClient.waitForSupervisorReady`的5秒外围循环不能提供connect/hello硬截止，idle保活30秒、32/16ms输出调度和诊断20/30秒也不是预算来源。同线程同步写盘或事件循环停顿不可被timer抢占，20秒不写成硬墙钟上限。下一实现用受控时钟检查期限组合，后续最小真实交互验收直接评价该候选，不先新建调参工具；若自然尾部场景被取消，诚实标interrupted仍不足以通过自然退出验收，必须保留失败并调整实现或有依据地修订候选。

### 27.3 创建前能力分流和兼容边界

只保留一个内部候选选择入口，不继续按阶段堆用户开关。未选择候选时原产品路径保持，不宣称新保证；显式选择候选后，只允许具备完整依赖的目标，不因能力不足静默退回旧bridge、旧Supervisor或snapshot-only。返回明确不可用原因且不派发PTY start。用于无native测试的注入仍标non-native，生产工厂另用真实类型，不将native cast成non-native绕过现有构造守卫。

分流顺序为：先判既有live还是新建，再固定模式、实际执行端OS/arch/运行时和目标binding，最后检查能力/产物并预留owner。既有live始终按metadata的backend/storage/sessionId/executionKind恢复和操作，不要求其突然具备新能力，不迁移或重新启动。新live由Supervisor拥有provider、tracker和reader，Host只负责RPC/投影；新snapshot-only由Host拥有同一共享核心和独立provider，不因此升级为跨Host持久运行。

新能力新建必须经过两道检查：Host检查目标server及当前页面所需reader链；实际authority在journal准备和provider创建前检查本地工厂、profile与完整能力，并在异步准备后复核准入/原身份。provider ready必须在PTY start前确认其真实生命周期及交互能力，缺能力时收尾原provider控制资源，不重试旧实现。非native注入声明只证明受控输入，不能代替实际子进程握手。

沿用内部owner的`execution-lifecycle-v1`、关闭观察、父清理及owner边界要求；live另需已实现的`terminal-read-settlement-v1`整链，snapshot-only另需local settlement和persistence。新增provider交互能力拟名`terminal-interaction-v1`，必须同时包括初始尺寸、输入和resize，不能只根据方法存在宣称支持。wire ready和owner能力表不是同一个对象，不把所有内部gate原样通过IPC发送。server hello及create请求须带可核验的新执行profile能力/要求，server不能仅凭全局owner存在就给未满足交互的会话发新保证。

新profile最终进入实际产品时使用独立storage generation候选`terminal-exit-v1`，不能原地覆盖当前`terminal-stream-v1`，也不能改写旧metadata即称迁移。下一S9只增加显式选择与拒绝路径，**不改CURRENT_RUNTIME_SUPERVISOR_GENERATION默认值**、不启动新generation。backend的systemd-user/legacy-detached选择与执行能力分开：只有所选backend上同样具备新能力才允许原backend降级策略，不能以best-effort为由降低退出契约。远端按执行端环境选择，不按本地UI操作系统推断。

S8保存失败或metadata冲突仍保留原记录、拒绝重启/删除，不用换profile逃避。snapshot-only候选默认启用前需完成可解释的失败处置与真实并发编辑验证；本轮不新增自动重试、强制遗忘或历史归档。

### 27.4 旧live删除的窄严格传播

批量reset/clear与永久离开分开。永久离开仍只detach原live，不为了“清理完整”删除它们；可中止reset/clear则先捕获原节点与完整binding，停止该批新变更，在远端结果判定前不得清空sessions/bindings或提交空画布。独立项目均可尝试，不能第一个失败就跳过其余，也不能吞`allSettled`结果；保留逐绑定的`legacy-acknowledged`、`legacy-absent`、`failed`、`unconfirmed`并汇总到原错误呈现入口。前两者只满足旧协议的删除行为，不命名为新owner的settled；partial success不宣称远端回滚，失败时保留画布与未结算绑定。

在`runtimeSupervisorClient.ts`增加仅服务本次删除的严格入口，捕获原socket后直接发送，不再经过会默认restart的普通request；无连接时只允许对原storage做allowRestart:false的连接，等待/握手也受本批同一固定deadline观察。连接替换、失联或截止为未确认，不换endpoint、不补发、不重启server。`sessionNotFound`只记为该原端点的legacy-absent，不据此证明旧进程、EOF或资源释放，更不能把新generation的“不存在”当原会话结束。legacy-absent可以按旧协议完成节点删除，但不得记成已证明原进程结束。

connect/hello每次await返回后、实际发送delete前，复核原binding/socket和同一deadline。期限后尚未派发的delete不再首次提交；已经提交的原请求才可补current，不能重发。晚到连接不能在调用方已收到未确认后继续派发破坏性动作。

同一规则覆盖`startAgentSessionWithSupervisor`/`startTerminalSessionWithSupervisor`替换旧绑定：当前先写新metadata、再吞旧delete异常的顺序不能延续到候选路径；先确认原绑定的允许结果，再提交新绑定或新create。结果未知时保留原责任，不用新sessionId或新generation绕过。后续真实创建接线还须利用已有可选create sessionId在派发前固定调用方已知身份，保留原创建请求及结果未知的绑定；不得因丢失create回包第二次创建。预分配ID只是责任定位，不提供重试幂等或创建成功证明。

本批复用20秒候选boundary窗口并与外层已有期限取更早者，不另给每项20秒。到期保留原请求责任，迟到回包可更新当前结果，但不能继续执行原reset或抹去后来创建的节点；再次用户操作须检查同绑定在途请求，不能无界累积或重复删除。无须改造所有RPC成通用重试/超时框架。原单项strict入口同样使用该连接规则；best-effort仅限启动失败后对已知临时会话的补偿，不参与用户reset成功判据。新owned会话的删除继续按S7实际结算/必要保存处理，不降格成legacy acknowledged。

### 27.5 最小Linux交互provider范围

后续直接扩现有`executionLifecycle`、adapter/channel/transport、Linux provider和`scripts/build/linux-execution-provider-patch.mjs`及其native owner，而不另建诊断服务。候选沿当前S1有限负载两执行/一启动验证，不把该限制偷偷变为正式用户容量。首个环境限定为实际匹配产物的Linux x64；Linux arm64、其他libc、VS Code/Electron及其他平台的证据不能由现有Node样本代替。真实工厂必须复用所属authority的可执行文件/运行环境启动子进程，native只在provider加载；构建增加实际入口及独立受控资产，不从.debug fixture或任意本地node_modules私改产物加载。

初始cols/rows必须通过LaunchSpec进入创建，并与authority初始tracker/journal一致。输入和resize沿原IPC普通lane增加具名交互命令，stdin继续关闭，不建立第二套输入源；stop/cancel仍独立urgent推进。交互使用自己的有界在途记录，不能复用当前adapter按start/graceful/force/cancel各一次、channel按type永久去重的生命周期表。输入按编码后的现有controlBytes限长分块，不拆坏UTF-8；只有已接收且未完成的有限输入占账，超额显式拒绝或向调用方施加背压，不静默丢弃、不用无限Promise链排队、不因结果未知重放已写前缀。具体队列上限作为同次I/O实施的显式常量及直接边界用例，不另开容量研究门槛。

native增加token绑定的非阻塞write与resize，不向父端暴露fd，不通过独立fs.write或另一个reader取得相同资源。write报告实际前缀进度，partial/EAGAIN保留偏移，EINTR和错误显式分类；一次有限系统调用后让出事件循环，等待可写不得阻塞stop、read或wait。输入受理、实际写入和命令结果分开；主体终态、真实源结束或关闭准入后不接新输入/resize，尚未写出的部分取消并明确结果，不能影响已收到输出的消费。close前结算原在途读/write/resize使用，扩原native owner的readInFlight门禁，不重试已关闭fd；这是等待任务结算，不是无期限等待剩余字节写入已无消费者的PTY。

resize先校验身份/存活/尺寸，通过原authority terminal串行链提交；仅native成功后追加resize journal、推进唯一revision并更新tracker/节点尺寸。等待resize确认时控制响应不依赖输出credit或同一消费链，避免输出暂停反过来阻止停止/resize回包；此前已入链输出保持先后顺序。native成功但journal/tracker失败保留不一致错误并停止新mutation，不能报告完全成功或伪称已回滚终端尺寸。实际`requireLiveSession`改为区分旧process与新owned主体，write/resize/scrollback入口一起核对；输入失败不得先标Agent已在执行。

停止策略随执行种类/Agent provider明确传入，不能把旧非Claude Agent的Ctrl-C+5秒、Claude或Terminal的直接kill一律替成当前Linux候选SIGTERM。第一批交互实现保留这些策略差异，Ctrl-C仅是请求并可能失败，force不能等待输入队列排空；自然收尾不停止已确认退出主体。Agent CLI的实际启动命令、shell/包装器、resume和退出主体另行验证，受控Terminal程序不冒充真实Agent；普通后代未来输出仍不是独立产品要求。

封闭普通input准入不能同时拒绝本次已准入stop的内部Ctrl-C动作；它经原owner控制路径派发，不能无限排在普通输入之后，也不重新开放用户输入。该例外不授予已确认退出主体新的写入权限。

实际业务接线还须保留旧output路径的标题查询回复、Agent活动/显式resume身份同步和Terminal launching到live转变。`runtimeSupervisorMain.ts`的`consumeOwnedOutput`目前未接入`bindSessionProcess`的onData分支里的这些逻辑；沿既有helper复用，查询回复走同一有界输入路径，但consume/terminalOperationChain不得等待PTY可写或回复写入完成，以免和输出credit环等。不能只把原始文本写入tracker就声称行为等价。对应Host本地路径一并核对，不新建第二套Agent状态机。这些是实际接入同批回归，不是另一个诊断研究项目。

### 27.6 下一代码交付与验收输入

下一阶段直接实施S9，不再安排一轮前置设计：在既有owner及Host/Supervisor/client入口落单一候选profile、完整能力检查与两模式选择、旧live严格删除/保留责任；实际工厂不可用时创建明确拒绝，non-native受控注入可验证接线。该批不声称已交互或已native支持，不改用户默认、全局generation或旧live绑定。测试直接扩原owner、Host/Supervisor wiring及client/reader入口，保留原断言。交付后沿27.5继续实际Linux I/O/工厂和产物接线，不以新的listener/归档/容量工具测试为前置。

S9必须覆盖：新live选Supervisor、新snapshot-only选Host、旧live按原storage/kind恢复；缺任一必需能力或产物时零PTY start，握手能力不足后控制责任保留；自然8秒/主动13秒/整体20秒共用同钟且迟到不改首报；两个旧backend中一个删除失败仍尝试另一个，reset不清失败绑定；断连/替换socket不重启或补发，超时后迟到成功不继续清空画布，同绑定再操作不累积请求。纯fixture可以声明交互能力验证分流，但结果必须标为受控，不能当native功能通过。

后续最小Linux业务验收只取直接产品输入：两模式各启动真实Terminal受控命令，经正常输入路径发送新nonce并由程序计算响应，resize后从程序读回尺寸；随后主进程自身UTF-8/ANSI尾部与非零退出，核对最终内容、光标、revision、reader及原资源。再取一次暂停消费下stop和双会话A收尾期间B交互，保留失败/未知，不以回显或控制ACK代替执行结果。live断开Host时不停止原主体，snapshot-only关闭仍保存其快照；Runtime结束后重开无正文且不自动执行。实际Agent至少覆盖真实CLI启动主体和对应停止策略，不能合成节点标签代证。原生采集前只需固定该输入、产物/运行环境与安全清理，不扩为通用诊断框架；本轮不运行这些场景。

### 27.7 本轮验证和未闭合项

本轮为三路只读源码核对与五份文档同步，不修改业务、测试、依赖、工作流或独立诊断树。YAML/索引、关联路径、ExecPlan十二当前章节、第2至26节及旧债务/原则保持、恰五文档和git diff --check静态验收通过。两路独立设计复核无S9直接阻塞，补清迟到连接首次delete、内部停止与查询回复的时序边界；检查脚本假设修正记录于ExecPlan，不复用S8用例数量作为本轮运行。没有自动化业务测试、PTY/socket/native、构建或runner新结果。

L-03的预算来源/公式和L-04分流/旧live传播已有下一实现输入，但生产数值有效性、S9实现、Linux交互/实际产物、L-02真实页面及保存整链、L-05异常owner消失、真实Agent和跨平台仍未闭合。S8旧completed-history fixture失败继续独立保留，不把修它设为本轮设计前置。整个ExecPlan保持active，不push/PR，不因文档收口宣称退出完整性已交付。

## 28. S9候选准入与旧live严格传播

### 28.1 已实施范围与能力边界

输入为`f8ca57d4`，本轮只在主运行时树扩展既有实现和五份受控测试，没有新诊断模块、依赖或用户设置。`common/executionLifecycle.ts`集中定义`EXECUTION_CANDIDATE_PROFILE`、冻结的`EXECUTION_CANDIDATE_BUDGETS`和按模式检查的能力表；`panel/executionOwnerLifecycle.ts`在取得transport前检查明确模式、全部预算和能力。数值保持27.2，自然观察8秒、主动观察13秒、整体20秒，父清理包含在原settle内；测试证明公式和固定首报，不证明真实尾部能在这些工程候选时长内结束。以上及后文实现路径均以`extensions/vscode/dev-session-canvas/src/`为前缀。

`panel/executionSessionAdapter.ts`捕获不可变profile，在真实ready中检查`terminal-interaction-v1`，缺失时不派发start，保留已取得的provider-control责任及原安全清理路径。协议只允许生命周期和已知可选交互声明，不把旧ready自动升级。实际`panel/executionProviderChannel.ts`尚未实现交互，仍只声明生命周期，不能通过新候选握手。

`common/runtimeSupervisorProtocol.ts`增加hello的`executionCandidateProfiles`与create的`executionProfile`；`supervisor/runtimeSupervisorMain.ts`只为匹配live-runtime且能力完整的注入owner公布profile，新建要求显式匹配，缺工厂在journal/执行资源取得前拒绝。`panel/CanvasPanelManager.ts`对新live检查原目标Supervisor和当前页面reader能力，对新snapshot-only检查匹配的Host owner、本地应用和保存能力。异步准备后再次校验；显式选择失败不回退旧bridge。无当前页面不伪造reader，仍按既有零reader责任规则。现有non-native构造守卫不放宽，实际main没有生产owner注入；CURRENT_RUNTIME_SUPERVISOR_GENERATION及旧路径保持。

### 28.2 原连接删除与画布边界

`panel/runtimeSupervisorClient.ts`的`deleteSessionStrict`同步登记原会话观察，返回固定`first`和可迟到更新的`current`。已有可用连接直接派发；无连接只连原storage端点，不复用可能重启的普通连接任务，不调用普通request。connect/hello每次await后与派发前检查原socket、绑定和同一绝对期限。连接替换、失联、写失败或超时均未确认；只有原server的真实错误响应可判failed或sessionNotFound所对应的legacy-absent。超时后不首次派发或补发delete，已派发未知的同会话观察保留。legacy-acknowledged/absent不等于主体、EOF或资源已结算。

Host先捕获完整binding，再逐项并行观察，并传播汇总失败。`prepareForHostBoundary`把单根reset和多根`clearAllWorkspaceRootCanvases`纳入一个20秒窗口，独立backend均可尝试，任何失败/未知不清maps或写空画布；每个await后复核期限和节点身份。迟到结果不恢复已经失败的reset，也不能清除后来节点。用户replacement须先确认旧绑定允许结果，才写新metadata和create。永久离开仍按S7detach live，不转成删除。

旧server可能先广播completed再回答delete。Host将广播的最终应用/保存挂到原删除记录，保留backend/storage/sessionId/kind，不触发第二次cleanup或提前清binding；正文仍不保存。record保存原deadline，在投影前以及等待reader后、首次persist前复核，过期保持unconfirmed，不从迟到opening或迟到广播派生新的保存。已提交的保存仍沿原Promise完成，不把其超期结果伪称按时成功。失败回退只在state仍是本次投影时进行，不能覆盖较新的节点。普通自然completed的成功无节点清理记录及时释放，保留kind构成完整key；failed/unknown记录不靠prune遗忘。

### 28.3 创建责任不能被缺席结果绕过

预分配sessionId不足以避免竞态：server create可仍在journal准备中，此时第二次启动的delete可能收到absent，原创建随后又成功。Host因此在WithSupervisor入口首个await前登记同节点创建责任，派发前固定sessionId并保存在metadata，实际回包校验同ID/kind。提交后未知保留原client/ID，重复start/delete/reset不改变原operation token，也不能靠absent发第二次create。迟到原成功按原身份应用；没有引入创建重试或承诺原协议幂等。

该保护同时覆盖Terminal和Agent。原live恢复仍用metadata既有backend/storage/sessionId/kind，不强迫旧会话取得候选能力；snapshot-only最终保存仍按S8。S9没有迁移live、改变root归属、恢复Runtime completed正文或实现崩溃恢复。

### 28.4 运行证据、先败与例外

本机为Linux x64、Node v25.6.0。最终owner lifecycle39/39、adapter83/83、Host86/86、Supervisor64/64、client reader20/20、parent-control9/9通过，直接加载实际模块并使用受控时钟/传输。reader wiring20/20和main/headless27/27验证实际消费写回调；旧分页、bridge、tracker、多根composition及typecheck分别通过，不把复跑数量累计成新原生样本。原五套分别新增3/2/30/4/7个运行用例，原测试体保持，fixture只扩可选能力及新候选路径。最后6项Host覆盖两kind的迟到opening/广播和多轮自然cleanup，首次直接通过。fixture声明交互仅用于分流，未运行真实input/resize或新PTY。

Owner/adapter/Supervisor新增用例首次实际运行直接通过，不虚构先红。Host新增用例曾因缺surfaceMode、缺Agent extraArgs/extraEnv以及将既有host/error呈现误期望为Promise拒绝而失败；补齐夹具/对齐实际错误通道后保留零重复请求、同token及绑定断言。多根绕过预算、预分配ID仍有重复create窗口、completed广播提前解绑，以及成功清理记录滞留/迟到reader首次写盘均来自只读复核，再补实际入口回归，不称原生复现缺陷。

文档YAML/索引/关联路径、ExecPlan十二当前章节、设计2至27节及旧原则/债务逐字保持、五测试旧调用体AST比对、17文件范围和git diff --check通过；没有改写旧测试取绿，也没有修改独立诊断树。详细命令及分类见ExecPlan当前验收段。

**执行边界例外单独记账：**子代理误跑已排除的`scripts/test/test-runtime-supervisor-protocol.mjs`。它完成临时目录/esbuild打包，并实际执行两个临时Unix socket hello场景（第二个含checkpoint），随后在旧源码正则断言`return this.toFreshSnapshot(session);`失败，exit1；只读对比`f8ca57d4`、`b235a7bc`及当前源码均不匹配。两个socket/server的finally及临时目录清理完成，未达到后面的真实Supervisor spawn与PTY分支。不能写成全程无socket、零辅助子进程或整脚本通过；未改旧断言求绿，也不重跑。此例外不提供S9平台验收证据，没有运行真实transport七场景、S3、native或runner。

### 28.5 下一交付与保留限制

S9只关闭默认关闭的profile/能力分流及严格传播接线待办；L-03生产时长、L-04实际产物/默认准入尚未通过。没有真实工厂/交互时明确拒绝是当前预期，不是可用生产替换。未知create、删除失败、最终保存冲突仍保守保留，没有自动重试、强制遗忘或完整用户恢复流程；不能只开启profile绕过这些限制。

下一直接沿27.5实施最小Linux I/O与实际接线：LaunchSpec尺寸、原IPC有界输入/resize、native token原owner门禁、owned live校验、按Terminal/Agent的停止策略及既有输出派生行为、正式provider入口和构建产物。继续默认关闭，用原模块定向测试；原生采集前只固定27.6的产品输入、匹配产物/运行环境和安全清理，不再增加通用listener、归档或容量框架门槛。真实VS Code/Electron、Agent启动主体/停止策略、L-02页面/保存完整链、L-05异常owner消失及跨平台仍分别开放；整体计划保持active，本轮只本地提交、不push/PR。

## 29. S10 Linux交互与正式产物接线

### 29.1 本轮实施输入

输入`7a39497b`，继续默认关闭，不改旧live/storage generation、不新增用户开关或诊断服务。本轮直接实施27.5的交互代码和正式worker/工厂边界，先以现有模块受控回归及静态构建验证；不运行旧protocol、真实transport七场景、S3/PTY或runner。编译资产不等于已验证运行平台，缺匹配资产时生产候选仍拒绝；真实原生产品采集另按27.6固定环境/输入/清理，不能把fake输入或函数存在当真实交互通过。

### 29.2 交互接口与有限责任

`common/executionLifecycle.ts`的LaunchSpec新增cols/rows（1至1000整数）及stopStrategy，显式候选必须提供，旧无profile路径保持兼容。PreparedExecution/OwnedExecution提供write(data, deadline)和resize(cols, rows, deadline)，返回InteractionObservation的first/current；交互使用单调interactionId，wire为input/resize与interactionObservation，不复用一次性operation表。结果区分written及实际writtenBytes、resized、cancelled/failed/unconfirmed；不能把send受理写成实际完成。

每执行最多4个未完成交互调用、32768个原始UTF-8输入字节，超额在派发前明确拒绝。write按完整JSON envelope不超过controlBytes分块、不拆Unicode code point；每调用逐片确认并累计实际前缀，输入之间保持调用顺序。resize之间亦保序，但允许越过等待可写的input；adapter最多各一个input/resize wire在途、provider分别推进两类任务，总容量和原normal lane不变。初版普通交互全序会形成authority消费链等待resize、resize等待input、input等待主体消费、主体输出等待消费链的环等，因此不能保留全序假设。wire ID仍在实际入队时分配并按原发送队列递增，不以越过输入为由重放。已派发超时保留原记录等迟到事实，不重放已写前缀；未派发取消释放其输入责任。输出ACK保持可推进，stop/cancel走urgent；交互回包直接结算，不能等输出credit或消费串行链。Host/Supervisor普通交互的观察窗口固定5000ms作为未实测工程输入，与执行关闭预算分开；到期不是失败写入/未写入的证明。

`linuxExecutionProvider.ts`使用同一native token的executionWrite/Resize：每次最多4096字节、一次非阻塞系统调用，partial保留偏移，EAGAIN/EINTR明确retry后让出；resize成功只证明原master的TIOCSWINSZ。native在原readInFlight之外检查write/resize使用；JS未完成任务先取消/结算再close，不保留跨调用Buffer指针。主体终态、源结束或关闭准入后拒新输入/resize，取消尚未写出的部分，仍交付已接收输出；force控制不能等待输入队列可写。

### 29.3 停止与authority提交

只读依据为`executionSessionBridge.ts`的无参数pty.kill及node-pty UnixTerminal默认SIGHUP。候选stopStrategy为hangup（Terminal/Claude）或interrupt-then-hangup（其他Agent）：前者首次请求SIGHUP，后者首次经独立stop路径写Ctrl-C、原5秒升级阶段请求SIGHUP；后续force阶段不偷偷改成更强的SIGKILL。无profile旧S3的TERM/KILL契约不变，父provider清理仍是独立权限。普通input关闭不阻止本次stop的内部Ctrl-C，主体已确认退出则不写。请求返回不能替代主体结束或源EOF，SIGHUP无效时仍如实未确认。

Host/Supervisor按原执行记录选择owned与legacy process。resize沿原authority串行链先等待native成功，再journal/tracker/revision和尺寸投影；native成功但authority提交失败关闭mutation并保留错误，不报告回滚成功。成功回包后的原提交只检查原record/metadata身份和提交错误，不能因随后已退出/stop将其当新请求拒绝并阻断尾部。输入全部written后才记录Agent输入活动，失败不提前变成running。旧标题查询回复、Agent活动/显式resume身份与Terminal launching到live沿原helper衔接；查询回复只登记异步有界写入，不等待消费链，错误须可见。最终Agent resume仍从完整输出核对，不能仅因预先存在ID而漏掉最终明确hint；Host只允许自身从同一可信metadata引用投影时推进S8保存绑定，外部替换继续是冲突。

已派发resize的首报unconfirmed不能按“尺寸未改变”处理：两authority保留原InteractionObservation和独立mutation错误，封闭后续input/resize/scrollback及查询回复，已接收尾部仍沿原消费链处理。最终flush明确失败，不把旧尺寸状态称为完整应用/保存；同ID迟到resized只更新原current，不改首报、不自动补写journal或解除错误。当前不自动requestStop或提供恢复操作，仍可沿原owner显式停止/清理；这是默认关闭候选的保守失败边界，不能称未知resize已成功恢复。

### 29.4 正式worker与产物边界

正常构建增加`panel/linuxExecutionProviderMain.ts`，输出`dist/linux-execution-provider.js`；专用native产物和manifest放`dist/native/linux-execution-candidate/linux-x64-glibc/`，不覆盖stock node-pty或从.debug实验资产直接加载。`scripts/build/linux-execution-candidate-assets.mjs`提供显式build/import，manifest绑定profile、Linux x64/glibc、明确Node/Electron运行环境、源/headers/binary哈希及声明导出集合。声明导出不是实测加载结果；验证字段明确compiled=true而nativeLoaded/nativeCalls/productValidated=false。

`panel/linuxExecutionOwnerFactory.ts`验证固定真实路径、文件类型/大小、manifest、ELF目标格式及内容摘要，拒绝symlink资产、ABI/Node或Electron版本/libc不符，构造阶段不启动provider、不require native。每次transport取得前复核binary/manifest/worker摘要；使用实际authority的process.execPath，Electron父端明确ELECTRON_RUN_AS_NODE。Main在IPC子进程中再次核对原摘要和实际导出后才加载，绑定原executionId/generation；只有Main拥有native require。原父控制的pty-master/pty-child/pty-source清理责任不变。

资产必须在普通dist构建后显式导入，因为普通build会重建dist。默认build允许只有worker，不因此公布可用native候选；`ExecutionOwnerOptions`区分linux-provider和non-native注入，不用cast放宽测试守卫。Supervisor只在显式内部`--execution-profile linux-owner-v1-candidate`及规范隔离storage后缀`runtime-supervisor-generations/terminal-exit-v1/runtime-supervisor`创建工厂；Host只接受显式匹配owner，不自动选择或新增用户设置。旧`terminal-stream-v1`默认generation和旧live绑定均不变。

### 29.5 受控验证、构建与失败记录

共享owner43/43、adapter95/95、channel12/12、Linux provider core10/10、候选资产8/8、工厂14/14及真实adapter/channel/provider内存整链1/1通过。最后一项只替换Node IPC/socket和native OS边界，实际运行三模块及输出credit：输入含UTF-8与需JSON转义字符，分片后的partial前缀不重放；16帧输出信用耗尽时resize越过待写输入，SIGHUP停止仍推进，随后消费17帧尾部并结算原资源。provider额外覆盖Ctrl-C持续EAGAIN/EINTR时force独立，以及process-first/source-first下partial输入、retry resize先取消/结算再close。没有以模拟read或signal证明实际syscall。

Host95/95、Supervisor71/71通过，覆盖实际入口的初始尺寸/停止策略、成功后才回写输入活动/resize revision、标题查询/Agent resume、resize与退出竞态、提交失败及迟到resized保留未知责任。既有parent-control9/9、client20/20、reader wiring20/20、真实main/headless27/27、分页completion/projection、bridge、serialized tracker、多根composition与workspace typecheck通过；不是VS Code UI、真实CLI或实际OS资源验证。

整链初版普通partial场景首次通过；扩为partial两字节后EAGAIN须由resize解除的直接组合场景，旧全序实现实际exit1，快照pending交互2、accepted16/consumed0且无fault。修adapter及provider独立resize后，同一断言exit0。为匹配该设计，S10本轮尚未冻结的provider新例等待双方结果，natural场景改为独立retry resize；一次夹具仍只flush而未推进resize timer，读取未结算结果exit1，改成显式等待原结果后通过。没有改`7a39497b`既有断言或旧冻结实验取绿，旧S3/协议失败保持。

Host新增ACK+exit夹具曾在frame准入前发seal，报source boundary与accepted tail不一致，修正新夹具时序后通过；新增final resume夹具的同步persist stub不满足实际Promise契约，曾报saved.then错误，补齐新helper后通过。Supervisor新增journal提交失败场景原将cleanup误期望为settled，在最终flush正确拒绝失败authority后，改为明确断言terminal failed；没有放宽旧用例。早期类型检查的共享分支/工厂unknown哈希缩窄问题在模块实现中修正，不属于原生平台失败。代码只读复核和组合回归各自注明发现来源，不虚构所有修正都已有原生先败。

`node scripts/build/build.mjs`通过，随后将一次compile-only产物从`/tmp/dsc-linux-execution-candidate-s10-7a39497b-2378-23336`显式import到新dist。环境为Linux x64、Node25.6.0、ABI141、NAPI10、glibc2.35，binary SHA256为`3ed4d6bdc53c12f5d0abf578d3885a71f63dc4ad1a8bc4bab919dff62397fccb`。本轮没有加载该binary或运行worker，没有实际PTY/socket、旧protocol、真实transport七场景、S3、runner或full npm test。esbuild/编译器辅助进程不算provider运行，不能把本轮写成零辅助进程。dist产物是本地构建结果，不提交binary、不改依赖/manifest/workflow。

导入后还用禁止native require和spawn的守卫加载实际工厂，复核真实资产并分别构造live-runtime/snapshot-only options及transport，未调用connect；两模式通过仅证明产物校验与无取得构造路径。声明支持Electron不等于已有Electron编译/运行证据。文档静态检查确认设计第2至28节保持、YAML/索引/关联路径与十二当前ExecPlan章节同步；旧测试体及断言保持另用TypeScript AST核对。临时静态脚本曾把YAML日期Date对象误作索引字符串，采用字符串schema后通过，没有改文档迎合错误比较。

### 29.6 下一交付与保留限制

S10关闭本次交互和正式资产接线待办，不关闭实际Linux交互验收、L-02页面/保存整链、L-03生产预算、L-04默认准入或L-05异常owner消失。工厂仅支持与当前manifest严格匹配的Linux x64/glibc Node或Electron；本轮只编译Node产物，不能在Electron中冒用。Terminal/Claude的SIGHUP及其他Agent的Ctrl-C后SIGHUP只保持源码语义，真实CLI/包装启动链仍需独立验证。

下一S11直接按27.6执行有限Linux业务验证，先固定实际authority入口、兼容运行环境/产物、命令输入、一次性工作目录和安全清理。两模式的程序计算nonce响应/读回resize尺寸、主体UTF-8/ANSI尾部与非零退出、暂停消费下stop、双会话隔离分别核对，保留first失败/未知与原始输出，不用回显或ACK代替业务执行。实际VS Code/Electron、Agent和macOS/Windows未具备本轮证据时继续独立列未验证，不为其追加通用工具完善作为Linux前置。旧live不迁移，Runtime completed无进程/历史、snapshot-only保存和F-03 root归属边界不变；整体ExecPlan仍active，本轮只本地提交，不push/PR。

## 30. S11 Linux实际业务有限验证

### 30.1 首次运行前固定范围

2026-09-27，输入`ae3c42cf`。本轮新增窄验收脚本，不修改旧冻结实验，不先改业务。固定四个场景：snapshot-only正常交互/退出/实际快照保存；live-runtime正常交互/退出以及活着时detach/reattach、结束后无正文；Supervisor暂停实际消费时stop；同Supervisor的A暂停消费并停止期间B完成交互及正常退出。最多五个新Terminal主体，无真实Agent、包装链、Electron/UI或macOS/Windows样本；不可把Terminal程序改标签后计作Agent。遇确定性失败保留首次结果，先核对根因，不自动重跑取绿或扩大矩阵。

实际运行本机Linux x64/glibc、Node25.6.0，使用S10正式worker/native/manifest及严格工厂。运行前重新校验运行环境和内容摘要，记录实际输入源码、worker、binary及manifest；不在authority require原生模块，只有正式provider执行加载。CanvasPanelManager通过原型实例和有限VS Code服务替身进入真实start/input/resize/保存路径；RuntimeSupervisorServer使用真实类及journal/tracker，通过受控内存连接调用原RPC入口。provider IPC/output pipe和PTY为真实OS资源，页面连接、VS Code生命周期及业务启动配置注入为受控，不能写成完整用户环境验收。

单主体为受控Node程序，不派生后代或访问外部服务。初始107x33，输入随机nonce由主体计算SHA256而非回显；resize为119x41，主体通过终端尺寸读回；finish写出自身UTF-8与ANSI最终屏幕（首行ROOT、第三行第5列红色中文、光标第5行第7列）后exit7。正常样本保留实际write回调后的字节凭证与原输出，核对最终内容、尺寸、光标和revision。flood最多256个4096字节块，暂停的是实际tracker消费，不伪造provider输出/主体退出；stop及资源事实仍由原owner观测。

### 30.2 有限安全与证据边界

每场景观察窗口45秒，主体自带25秒安全退出，仅用于实验停止而非生产预算；原候选8/13/20秒及交互5秒预算不变。脚本在失败时先释放自己设置的消费gate，再沿已捕获原owner停止并等待原transport关闭，绝不按进程名/外部端口扫描或杀陌生PID。任何额外紧急清理只针对本轮记录的原provider及主体，先核对身份，记录实际动作，不能把强制清理当产品正常结算。清理未确认则禁止后续场景并保留责任，不通过隐藏进程/清空状态获得成功。

每轮使用必须新建的独立`.debug/s11-linux-business-*`目录，保留运行前schedule、输入及摘要、逐场景原始输出/控制事实、首次结果、最终资源与清理结果；不覆盖既有目录。正常场景核对生产者字节与消费者；停止场景只对已接受/消费前缀作完整性判断，不要求被信号终止后尚未写出的输出。最终页面用真实headless终端状态检查，受控reader完成与真实Webview ACK分别说明。仅保存与这四个产品场景相关的有限证据，不引入D3/D4、通用oracle或归档兼容框架。实现与首次结果随后追加，当前不是通过声明。

### 30.3 实现、运行输入与安全复核

新增`scripts/test/test-linux-execution-business.mjs`及`fixtures/linux-business-{subject,host,supervisor}.mjs`，后者均位于`scripts/test/`。直接加载真实Host、Supervisor、owner、journal和tracker；被测代码不复制成模型。运行前只读安全复核发现三项直接风险并修正：场景超时不自动取消续体，因此同步封闭owner及transport create/connect准入并等待原任务结算；证据写入失败不能绕过清理，因此先在finally沿原owner收尾；主体证据改为异步写入，避免同步写盘阻塞25秒安全计时器。未追加通用工具门槛，原生采样前修正不计为产品实验失败。

实际运行环境为Linux x64、glibc 2.35、Node v25.6.0（ABI141、N-API10）。S10产物复用且无重建：worker SHA256 `0ac69e89756c126a080aaf74348db6c72b34e58a1c6c92bd6174eb431e3ab3f0`，binary SHA256 `3ed4d6bdc53c12f5d0abf578d3885a71f63dc4ad1a8bc4bab919dff62397fccb`，manifest SHA256 `43bea1b13fe5088d21c702edbafc743579dbaf38fce3d1de75d47807f62464f1`。manifest仍保留构建时compile-only事实，不为本轮执行倒写构建记录。输入脚本和实际加载业务源码摘要分别保存在schedule与loaded-sources中；脚本为本轮未提交快照，业务基线为`ae3c42cf`。

仓库根先执行`node scripts/test/test-linux-execution-business.mjs --preflight --output .debug/s11-linux-business-first`，仅检查资产与环境、不启动provider。随后唯一执行`node scripts/test/test-linux-execution-business.mjs --output .debug/s11-linux-business-first`，exit0。四个first结果、cleanup及原始帧各自保存，无重跑；没有运行旧protocol、S3矩阵、全量npm test或runner。

### 30.4 首次结果与证据口径

| 场景 | 主体/源/消费事实 | 已验证行为 |
| --- | --- | --- |
| snapshot-normal | exit7、EOF、accepted=consumed=5、finalRevision6 | nonce计算、107x33到119x41真实尺寸读回、主体138B成功写入与PTY142B经ONLCR精确比对；真实root/workspace快照相同，磁盘重建屏幕及Host load/restore/attach无新执行 |
| runtime-normal | exit7、EOF、5/5、finalRevision6 | 受控连接detach不stop，同身份重附着后仍计算响应；主体尾部完整，分页真实headless消费后提交applied；显式delete后attach/getSnapshot均拒绝 |
| paused-stop | SIGHUP、EOF、22/22、finalRevision22 | tracker flush gate保持时accepted17/consumed1，16帧信用耗尽；stop仍观察到主进程退出，尚未settled；释放gate后消费、reader及资源结算 |
| isolation | A为SIGHUP、EOF、22/22、revision22；B为exit7、EOF、6/6、revision7 | A仍暂停且未settled时，同Supervisor的B完成交互、主体尾部、reader应用及删除；随后才释放A的消费gate |

三个正常结束主体的最终authority和重建终端均检查119x41、首行ROOT、第三行红色中文和零基光标(6,4)。停止样本的证据是所有provider已交付数据均进入实际journal/reader、接受序号等于消费序号；不要求被SIGHUP打断后尚未写出的1MiB输出，也不将停止动作本身当作EOF，实际源另报EOF。本轮没有命中cancel/force预算，不能据此确认取消分支或8/13/20秒生产数值。

四场景的首次pass、cleanupSafe均true，五个provider实际spawn，五个transport均exited/disconnected/dataEnded/dataClosed/closed，无termRequested/killRequested；五主体的provider-control、pty-master、pty-child、pty-source首报和当前均released。cleanup.actions全部为空、taskSettled均true，证据无容量截断或写入错误。资源结算先于独立reader责任退役是合法分账，first中readerOutcome=pending不改写，最终evidence中五项retired=true。

证明范围必须保持：Host无实际Webview reader，只有自然结束的最终快照保存，`activeDeactivationValidated=false`；Supervisor未启动listener/daemon idle，受控RPC连接不是实际RuntimeSupervisorClient/socket或Host远端编排；独立headless reader不是Webview main的真实页面回执。Runtime重开拒绝发生于显式delete之后，不证明真实Host自动删除、completed节点重开无正文/无进程的完整工作流。两个停止样本只证明受控flush屏障下仍可stop，不冒称真实UI卡死或任意负载都不会拖住。

首次Host报告存在一项仅影响序列化字段的错误：assertScreen返回的文本数组覆盖了数值rows；119x41断言实际执行，保存metadata及reopened.rows均为41。采样后仅将工作树返回字段改为lines，原inputs、first/report和原始证据不改，不再采样，也不把修后的脚本摘要追写进schedule。该窄修不改变断言或业务行为。

独立只读复核直接比对冻结输入、连续原始帧、成功write与消费/资源事实，未发现本轮有限断言的新增阻塞。审计自身先后有两次exit1：误要求sourceEnd后的最终wire consumed信用ACK覆盖全部帧，以及误要求采样后已窄修的当前runner仍等于首次摘要。前者忽略sourceEnd后停止发信用但继续本地消费，后者混淆冻结输入与当前代码；改正审计假设后核对，不改变证据或产品断言，也不记为原生失败。Runtime三个registry文件实际仍有早期正文/状态（normal为live，paused为stopping，isolation留closed A）；fixture清除了待执行的120ms persistTimer、仅等待已入队persistRegistryChain，没有执行正式flushRegistryBeforeShutdown。因此该目录不能证明删除已持久化或重启无历史，不能在证据采集后强刷空文件；产品正常关闭路径与崩溃残留策略须另外验证。

### 30.5 下一有限交付与未关闭项

S11关闭的是固定Linux Node业务样本，不是整个产品退出验收。下一S12聚焦两个仍缺的用户工作流：snapshot-only活跃会话随Host正常离开而停止、尾部保存和原资源释放；live-runtime实际Host/client连接detach后仍运行，完成后经Host原清理路径重新打开节点且无新执行/正文，同时检查原正式关闭落盘，不能仅验内存缺席。沿既有Host/Supervisor/client/reader接线补验，不用测试直接delete代替Host自动清理，不再增加通用诊断模型或重复本轮四场景。实际VS Code/Electron入口若需要匹配产物，先核对运行时和构建；Node产物不可冒用，受控替身结果独立标注，不宣称UI通过。

真实Agent/CLI包装主体、真实Webview最终应用、macOS/Windows、异常owner消失与用户恢复、生产预算及默认准入仍需各自证据。Linux本轮正常/主动停止成功不能关闭L-02至L-05总项。候选默认关闭，旧live原绑定、Runtime completed无进程/无历史、普通后代责任和F-03稳定root归属均不变；无业务改动、push或PR，整体ExecPlan保持active。

## 31. S12 宿主生命周期与完成重开

### 31.1 运行前固定范围

2026-09-27，业务输入`7b480cbd`。只执行两个有限Linux Node样本、最多两个新Terminal主体，复用S10正式匹配产物和S11证据/原owner清理入口；不重跑S11矩阵，不新建通用诊断设施。开始前仍检查Linux x64/glibc2.35/Node25.6.0与worker/native/manifest摘要，不重建资产或加载到authority。测试入口增加显式S12选择，S11原场景及断言保持。全部首次输入/结果存入新目录，发现确定性失败即保留并停止，先定位，不自动重跑取绿。

第一例是snapshot-only活跃Host正常离开：实际Host启动、nonce计算及resize后，确认原主体仍活着、没有进程/源终态，再调用原prepareForDeactivation，不用测试直接stop或先finish代替。受控主体在收到SIGHUP后才写自身UTF-8/ANSI尾部，完成write及证据记录后exit7；最终尺寸119x41、ROOT/红色中文/光标(6,4)。核对原Host固定20秒关闭报告、原执行/消费/资源、真实root/workspace最终快照及新Host load/attach不新建执行。VSCode服务和UI生命周期仍受控，零页面reader不冒充最终Webview应用。

第二例是live-runtime实际连接与完成重开：真实RuntimeSupervisorServer.start监听唯一原Unix socket，Host原RuntimeSupervisorClient连接/hello/create/input/resize；后端只返回本轮端点，startSupervisor明确拒绝，不能意外启动旧launcher。经Host prepareForDeactivation断开原client，Supervisor与主体保持原身份，再由新Host读取实际保存绑定并恢复连接、继续计算新输入。主体finish自然exit7后，只等待Host原轻量终态保存及自动complete/delete，不由fixture显式delete替代；重建Host再load/restore/attach应无正文、无新进程。最后调用真实Supervisor prepareForShutdown，分别确认registry严格flush、原listener/socket关闭及原执行资源，不以测试清空Map/取消persistTimer冒充正常落盘。无浏览器reader时仅证明对应零reader路径；不宣称Webview/main或真实OS宿主进程退出通过。

### 31.2 安全、证据和停止条件

仍使用每场景45秒、主体25秒安全退出及清理35秒观察，候选8/13/20秒不改。观察Host/Supervisor关闭允许覆盖其原20秒报告边界，不用测试默认8秒抢先代替产品首报。主体无后代/外部服务，SIGHUP处理写入仍异步，安全退出124不计成功。采样目录独占新建、证据wx；实际socket只使用本轮新建的短路径目录，不碰用户端点。

原owner在取得资源前登记；超时/失败同步封闭create/connect准入，先释放自设读者/连接，再沿捕获原owner收尾，不按裸PID或进程名杀进程。fixture资源清理失败必须影响cleanupSafe，不能只看到provider关闭就遗漏仍打开的监听器/客户端；被测关闭的首次失败与测试补救分开保存。不得在采样后补写registry使结果变绿。保留主体成功write、原output/control、两Host的保存和重新加载证据，以及server原关闭报告；Node API调用、真实socket/PTY与受控VSCode/页面分别声明。本轮不开默认候选、不改旧live/root/generation、不push/PR；实际结果随后追加。

### 31.3 首次结果与窄修边界

首次`.debug/s12-linux-lifecycle-first`实际exit1：snapshot-deactivation通过，runtime-lifecycle首次输入后在诊断记录处TypeError，整轮1/2，不重跑。只读定位为prototype夹具漏初始化原类`executionPerformanceDiagnostics=[]`字段，不改业务诊断方法。后续仅补此字段及确定性纯验证，并在已有入口增加`--stage s12 --only runtime-lifecycle`固定选择，明确报告所选场景，防止为复验失败例再启动已通过主体；当前不运行第三个原生主体。原始first/cleanup/inputs/哈希不改，详细证据与下一次新输入规则随后追加。

四份S12输入为原`scripts/test/test-linux-execution-business.mjs`加`fixtures/linux-lifecycle-{subject,host,runtime}.mjs`。shared Host夹具服务两个样本，不改旧S11三份fixture。runner新增stage固定选择、每场景一个provider上限、真实net取得前的同步封闭检查，以及清理异常影响cleanupSafe；原server关闭22秒观察计入同一个35秒清理总窗。首次前发现第二nonce不符合主体32hex协议，改为新的32hex输入，不放宽主体断言；这发生在采样前，不算原生先败后修。

运行命令均在仓库根：`node scripts/test/test-linux-execution-business.mjs --stage s12 --preflight --output .debug/s12-linux-lifecycle-first`不加载native或启动provider，随后唯一`node scripts/test/test-linux-execution-business.mjs --stage s12 --output .debug/s12-linux-lifecycle-first`实际exit1。环境及worker/binary/manifest摘要与30.3相同，无重建。输入、schedule、loaded-sources和逐场景原始帧/首次/cleanup保持；独立只读核对四份冻结输入及60份实际加载源码摘要一致。

### 31.4 已通过的活跃Host边界

snapshot-deactivation在关闭前原执行running、accepted/consumed=3、无process/source/seal、stopRequested=false。实际prepareForDeactivation封闭新准入，原关闭原因host-deactivation；主体独立记录SIGHUP后才生成最终尾部并exit7，真实source EOF。最后5帧、accepted/consumed=5、finalRevision6；成功write152B对应ONLCR后的PTY157B，逐字节一致。保存的119x41、ROOT/红色中文、零基光标(6,4)由真实tracker重建核对。

原Host报告local/canvasSnapshot/remoteDetach三域settled，deadline-startedAt=20000仅证明沿用原候选预算，并未耗尽期限或验证其生产充分性。实际final保存先于成功关闭报告，root/workspace终端metadata一致、lifecycle=closed且lastExitCode7、snapshot-only、liveSession=false；新Host加载真实root文件后attach无新执行。两次关闭返回原冻结报告，永久准入不能恢复。四资源首报/当前released、provider原transport闭合，未依赖fixture额外stop。

本例证明Node下调用实际Host API的活跃离开，不是VS Code实际deactivate调度、Electron退出宽限或浏览器reader验收。remoteDetach为空集合、无Webview reader，不能借其settled声称非空远端或页面回执通过。

### 31.5 Runtime失败、根因与纯修正

Runtime已通过原Host/client/Unix socket建立会话，首个nonce有39B实际written回执且主体HASH正确。随后`CanvasPanelManager.ts:18142`的成功输入finally进入`:20806`诊断记录，在`:20811`读取缺失数组的push时抛TypeError；原类`:1340`本来就初始化`executionPerformanceDiagnostics=[]`，是夹具Object.create绕过实例初始化造成，不是当前证据证明生产实例存在缺字段。成功host-input-write仅在耗时达到8ms时保留，因此快样本不报错也不能验证夹具完整；本地owned输入又走另一直接路径。

修正只在`linux-lifecycle-host.mjs`补原数组，不stub真实方法。内联Node/TypeScript AST纯验证提取原诊断方法、保留条件和clone helper：旧夹具7ms样本过滤、8ms样本确定复现TypeError；补字段后原方法保存内容相同但独立引用的样本。前后断言均通过，未用native证明修正后的完整Runtime路径。首次Host fixture摘要`2d8f7d7a97b17de64e423047d8e589cc2c4ba891414c0ab5bc565bfb1fb1c98b`，修后`8b480dcdda0758e5c87e0e5391e1a0693e71683a6861d0ef34beeed3725f9b69`，原inputs/schedule不倒写。

Runtime未执行resize、Host正常detach、新Host恢复、自然finish、自动completed清理、第三Host重开或预定正常server shutdown断言。其失败清理调用原prepareForShutdown，原closeObservation.reason为`S12 original runtime cleanup.`，主体收到SIGHUP后exit7；3帧、140B成功write到PTY144B、EOF及资源释放仅作为清理证据。外层cleanup.actions=[]不表示没有补救stop；registry留有closed会话及正文，是本轮未走到Host自动删除的状态，不认定为删除产品路径通过或已证缺陷。

两个原provider和两个原主体身份独立，原transport全closed/exited/disconnected/dataEnded/dataClosed，四资源first/current均released，cleanupSafe均true，无cancelOutput/force/provider TERM/KILL、stderr或证据截断。Runtime夹具清理中的原socket/listener close断言也已完成，测试进程实际exit1；这些安全事实不改变首轮1/2或将业务结论补绿。

### 31.6 下一有限复验与剩余范围

只继续未完成的Runtime样本：先固定修后提交/输入摘要，在全新`.debug/s12-linux-runtime-retry-first`目录运行`node scripts/test/test-linux-execution-business.mjs --stage s12 --only runtime-lifecycle --output .debug/s12-linux-runtime-retry-first`一次，最多一个主体；该目录仍未采样。运行前同参数加`--preflight`核对资产/所选场景，不创建目录或资源。report显式记录scenarios及partialSelection，单例通过也不能改写首轮1/2或宣称重跑全矩阵。新失败仍保留并先定位，不继续自动重跑。

原Runtime断言不放宽：真实Host detach/恢复、不同nonce、自然finish、Host自动保存/delete、重开无正文/无新执行、正式shutdown严格flush和原socket/listener关闭。无需另起工具研究，不能改成fixture显式delete取绿。真实VS Code/Electron/Webview、Agent启动链、跨平台、生产预算与异常owner消失仍未验收；默认关闭、旧live绑定和root边界不改，本轮只本地提交。

### 31.7 修后Runtime单例运行前冻结

2026-09-27，修后测试输入提交为`54c3bc00a32c1c75671fc2d6562bc57ff22f7188`。schedule中的`sourceCommit=7b480cbd`仍表示S12业务基线，不是修后夹具提交；实际采集输入由本提交和schedule内四份文件摘要共同标识，不倒写旧schedule。runner、subject、Host和Runtime摘要依次为`593929bc36ba54bbc15e43b4e8ed3b4c8379d6dd06605e8df526448ad46df285`、`010d8139f481bbfbc2c153e76e59eea806168c7a96f4dba15088937275aeeb9f`、`8b480dcdda0758e5c87e0e5391e1a0693e71683a6861d0ef34beeed3725f9b69`、`4a1509e34ef2d7242ca6964c51eaa753c1ca93d738a73d8750434bf06b551b7a`。

运行前同参数`--preflight`返回exit0，确认只选择runtime-lifecycle、S10三份正式资产摘要与Node25.6.0/ABI141/NAPI10/Linux x64/glibc2.35匹配，未加载native或启动provider；目标目录尚不存在。独立静态复核另冻结旧first全部30文件路径/大小/摘要，排序台账整体SHA256为`b3f359be1efc178d0867a8fd7087233e125ffba5fdcc7b0dbfb5f4e5bd9d055c`。以下唯一采集严格沿31.6，一次一主体，不扩场景、不重建、不改业务；采集结果另行记录，预检不等于原生通过。

### 31.8 修后Runtime唯一采集结果

31.7冻结后执行31.6命令一次，`.debug/s12-linux-runtime-retry-first`保存独立schedule、四份输入、loaded-sources及该场景first/cleanup/evidence、原始帧、主体成功write和真实磁盘文件。report为`scenarios=[runtime-lifecycle]`、`partialSelection=true`、1/1通过、无未执行项，测试进程已结束。首轮`.debug/s12-linux-lifecycle-first`的1/2不改变，也不把两个不同输入的通过项合成一次全矩阵成功。

实际只创建一个执行`99d0fcea-245d-42ba-b89a-985dfc89c0bb`、generation `7bf2aee4-30bd-409c-a2e6-d7d476ceccdd`。首个Host通过真实client写入nonce、107x33到119x41 resize及主体尺寸读回后调用prepareForDeactivation；原client和server端socket均关闭，主体没有退出、没有stopRequested，原owner身份保持。第二Host从root文件加载原绑定、经原client附着同执行并计算不同nonce，之后输入finish，主体自然exit7。只有一次createSession、一次attachSession、一次自动deleteSession，无stopSession；fixture未显式删除，launcherAttempts=0。

主体成功write共208B，PTY ONLCR对应213B；五帧连续、acceptedThrough=consumedThrough=5，真实EOF尾值5，authority最终应用revision6。最终stopRequested=true源于自动deleteSession调用原requestStop进行退役，不代表向仍活着的主体发送了停止：原closeObservation仍为natural-exit/process-exited，wire无requestStop/cancelOutput/force，provider无TERM/KILL，主体无SIGHUP标记。四资源first/current均released；外层taskSettled/cleanupSafe=true、actions=[]、evidenceErrors=[]，原transport最终closed/disconnected/exited/dataEnded/dataClosed均true。已退役adapter快照的dataClosed=false与之后真实transport close分属不同时点，不能倒写快照或据此否定已观察到的关闭。

Host原completed保存后的root/workspace文件均无正文、serialized state和runtime绑定，保留119x41尺寸等轻量终态。第三Host load/restore/attach返回空output、liveSession=false，不取得执行或新socket。原server.prepareForShutdown的execution/readers/registry/server/sockets五域settled，磁盘registry严格为`{version:1,sessions:[]}`，原四socket和一个listener均closed；此处不是S11取消persistTimer后只验内存，也不是S12首败后的补救shutdown。

本轮没有Webview reader，terminal applied指authority最终消费，不指页面最终应用；Runtime夹具没有断言live最终屏幕像素或光标。实际VSCode deactivation调度、Electron关闭宽限、daemon自动退出、Agent/包装主体、其他平台、生产时限和异常owner消失仍无本轮证据。

独立只读复核四份冻结输入、60份实际加载源码摘要及原始事实通过；1043B framing解出五帧，成功write经ONLCR与213B输出逐字节一致，SHA256为`78447487ffd50e1c312f8b7e8bf237b82c520003b9d17d1c2a4d871027cb9b15`。第二nonce `726506c11efb037cd8e8c0e7003a34c2`对应HASH正确，原始输入回执39/5/39/7B、resize119x41。实际root/workspace读回匹配completedDisk、registry为空。用同摘要`@xterm/headless`离线重放原始帧得到119x41、ROOT/中文和光标(6,4)，仅为离线重建，不补称live屏幕或页面验收。旧first30文件逐项与运行前台账一致，整体摘要保持31.7值；无归档脚本执行、额外native加载或采样。

文档收口静态检查通过：五份文档范围、设计第2至31.6节逐字保持、计划12标题及顺序/当前首段、元数据/索引/关联路径、原原则/债务保持、旧first失败和新partial通过分别核对，git diff --check通过。新增结论经独立只读复核，无本轮证据口径阻塞；没有业务或测试源码改动，不运行全量回归、push或PR。

### 31.9 Host关闭后的延迟保存与下一有限项

新证据first Host的`execution/hostDeactivationBoundary=settled`之后仍记录`state/persistDeferred`，reason为live-execution-state、delayMs=1500，stateHash从`e2074de87eec`变为`693644173feb`。这是退出报告后再次接受状态保存的实测事实；本轮第三Host读取completed文件和正常shutdown均在这次旧延迟写入之前，fixture cleanup最终取消该timer，不能据此证明旧Host永远不会覆盖较新的磁盘状态，也不能反过来宣称本轮已经实测覆盖或历史复活。

冻结诊断顺序还显示，旧Host在`host-deactivation`的`state/persistWritten`和boundary settled之后只有该deferred请求；没有旧Host对应的deferred `state/persistWritten`。随后时间点的`runtime-supervisor-live-snapshot` immediate写入来自第二Host恢复路径，不能归因给旧timer。因此当前证据严格支持“边界报告后仍可排队晚写”，不支持“晚写已经覆盖磁盘”。

只读源码核对找到足以解释该顺序的已排队任务：`CanvasPanelManager.ts:18667`在远端resize完成后调用queueExecutionStateSync，交互同步延迟为160ms；`:19786`的syncTimer回调只检查会话仍在Map，随后`:19857`的flushLiveExecutionState更新live元数据并在`:19926`安排deferred persist。`:3840`起的prepareNonNativeDeactivation关闭client、收尾本地owner并保存当前状态，但没有清理远端syncTimer/移除远端会话；`:11302`的disposeManagedExecutionSession也不清syncTimer。无需假设断线后收到新事件，且主动client.dispose抑制onDisconnected，不能把本次具体来源写成已证的disconnect回调。`extension.ts:826`的deactivate只await准备方法并清activePanelManager引用；真实VSCode进程退出/订阅清理能否及时终止这些回调仍需单独确认，不能当作当前已有保证。

下一切片只定位和确定Host永久关闭的状态/持久化契约：复用已有实际Host受控测试，固定远端resize排队同步、deactivation返回、新Host保存completed状态、旧定时回调到期的顺序。区分旧回调能排队、实际写成、生产清理取消三个事实，明确哪些已接受状态应在报告前flush，哪些晚任务应取消或拒绝；原live绑定的最终保存不能因简单取消而丢失，Runtime detach不能变成停止原执行。此项直接关系无历史重开与退出结算，不是通用工具健壮性；无需新PTY、native构建、runner或全量诊断矩阵，不在本轮直接改业务。确认后才规划最小修正与回归。非零reader最终应用、真实Agent启动链、Electron与跨平台仍单独开放，不因有限样本通过默认启用候选。

### 31.10 关闭路径根因已确认

本阶段只读 TypeScript AST 契约检查确认了两条关闭路径的直接差异。`CanvasPanelManager.prepareForDeactivation()`在 owner 具备`execution-owner-boundary-v1`时无条件进入`prepareNonNativeDeactivation()`；Runtime 持久化样本正是该路径。该方法负责关闭本地 owner、保存画布并断开原 Runtime client，但正文没有调用`flushExecutionStateSyncTimer()`或`flushAllExecutionSessionStatesForHostBoundary()`，也没有清理`terminalSessions`/`agentSessions`中仍由 Supervisor 托管的 syncTimer。`disposeManagedExecutionSession()`只清 Supervisor reconnectTimer，同样不处理 syncTimer。

普通`prepareForHostBoundaryCore()`则先调用`flushAllExecutionSessionStatesForHostBoundary()`；其`flushExecutionStateImmediately()`会清除 syncTimer，再以`persistMode: 'immediate'`执行`flushLiveExecutionState()`，随后等待 deferred canvas flush 和 workspace update。因此同一类状态同步在普通边界被收口，在 Runtime 持久化的实际 deactivation 分支却没有同等屏障。这解释了31.9中 boundary settled 后仍出现`live-execution-state` deferred persist；并不需要假设断线回调继续到达。syncTimer回调只要求 session 仍在对应 Map，随后更新 live metadata 并再次排队延迟保存。

本阶段的只读契约输出为`confirmed-source-race`：Runtime路径`flushesSyncTimer=false`、普通边界`flushesSyncTimer=true`、timer要求session仍在Map并调用deferred flush、managed-session dispose不清syncTimer。已有`test-host-execution-owner-wiring.mjs`通过95/95，`test-runtime-checkpoint-refresh.mjs`通过；尝试运行`test-runtime-completed-history.mjs`时在既有Harness的`surfaceLifecycle[surface]`缺失处失败，未把该失败改写成通过，也不把它作为本根因的原生证据。

这已经是一个确定的生命周期一致性问题，但本阶段没有证明旧 delayed write 实际覆盖了新文件。下一设计选择需在以下两个边界之间取舍：在保留 live Runtime 的永久 Host 离开前，对仍在 Supervisor Map 的会话执行与普通边界等价的最终状态 flush；或者先关闭旧 session 的状态同步准入并取消所有 timer，再以已捕获的原 binding 做一次有序最终保存。无论选择哪项，都不能删除/停止远端 live execution，不能丢掉已经接受的尺寸和终端状态，也不能让旧 Host 的迟到回调覆盖新 Host 的状态。方案确定前不改业务代码、不新增 PTY/native 样本。

该调用链位于`CanvasPanelManager.ts`和扩展 Host 的定时器/Map 生命周期，当前没有Linux专属分支；Linux/Node样本只证明它在该环境实际发生。Supervisor、Unix socket和PTY的其余证据仍是平台相关，不能将本风险缩小为Linux问题，也不能据此宣称macOS/Windows已失败或通过。

下一次受控验证应把旧延迟保存故意排到第二Host完成保存之后：第一Host在deactivation后保留已捕获的旧timer，第二Host先完成自然结束并把节点写成`liveSession=false`、无`runtimeSessionId`的completed状态，再让旧timer经过160ms同步和1500ms debounce。读取root-local与workspace文件，分别判定旧`liveSession/runtimeSessionId`是否被写回、仅收到排队请求、或被身份/序列屏障拒绝。该验证只需实际CanvasPanelManager与磁盘写入，不需PTY/native；若旧状态复活，才进入最小业务修正；若未复活，也仍需记录旧Host晚写被接受的契约缺口。

该受控验证已完成，结果为旧状态确实复活。harness 通过 esbuild 加载真实`CanvasPanelManager`方法，阻断`node-pty`/`child_process`，以fake owner/client和磁盘适配器提供边界依赖；没有启动PTY、Supervisor或native。顺序为：第一Host实际`prepareForDeactivation()`返回`settled`且旧timer仍在；旧timer先产生`persist(mode=deferred, reason=live-execution-state)`；第二Host随后立即写completed空metadata；旧timer的deferred flush最后把`liveSession=true`、旧`runtimeSessionId='session'`、`persistenceMode='live-runtime'`和旧尺寸119x41写回root文件。事件顺序为`host-deactivation` immediate → boundary settled → 第一Host deferred request → 第二Host completed immediate → 第一Host deferred flush。该结果已经证明跨Host的stale overwrite，不再是未确认风险；但它仍是Host逻辑层证据，不等同真实VS Code/Electron进程时序或其他平台运行通过。

同一harness还显示，resize ACK只更新内存 session 的`cols/rows`，节点metadata的`lastCols/lastRows`要等`flushLiveExecutionState()`才投影；若永久边界只取消未触发的syncTimer，边界前已接受的119x41可能仍以旧尺寸保存。因此修正验收必须同时满足：边界前已确认的尺寸/终端状态先进入一次有序最终保存；边界后旧timer和旧回调不得再写入。

因此该项从“待确认的持久化竞态”升级为退出完整性阻塞：正常关闭后，旧Host可能复活已完成节点的Runtime绑定，破坏“completed无进程/无历史”契约。修正必须在旧Host永久边界建立身份/代次的保存屏障：先保留并有序保存最后接受的live状态，再阻止旧timer和未追踪的session-state回调写入；第二Host的completed写入不能被旧Host覆盖。不能通过停止或删除Supervisor live execution解决，也不能只改root文件读取。

S13修正的不可变不变量暂定为：一是边界前已确认的resize、输出和Runtime binding必须先投影并完成一次有序保存；二是保存完成后旧Host关闭syncTimer、拒绝新的状态同步，并等待已经进入的`onSessionState`/persist操作；三是边界报告返回后，旧Host不得再提交任何会改变root/workspace snapshot的写入；四是Supervisor仍持有的live execution只断开Host client，不被该屏障停止或删除；五是第二Host completed写入后，旧generation的任何迟到事实都必须被身份/代次拒绝，而不是靠文件读取时猜测。

### 31.11 S13 最小修正与验证结果

本阶段已将上述屏障接入 `CanvasPanelManager` 的显式 `execution-owner-boundary-v1`（non-native/candidate）永久 Host deactivation 路径，不改变 Supervisor 的进程所有权。边界开始时关闭 Runtime 事件准入；每个 Runtime client 的回调闭包带有 client epoch，迟到的 output、terminal event、state 和 disconnect 事件都会被拒绝。`onSessionState` 的异步处理加入专用 pending 集合，边界在最终保存前等待已经接收的回调；同步 timer 的回调和后续排队入口也检查同一准入状态。

画布快照域先启动原有 immediate persistence，再等待已接受的 Runtime state callback，随后对仍在 Host map 中的 Supervisor session 执行最终 immediate 状态 flush。该 flush 投影最后确认的尺寸、输出序号和 Runtime 绑定，清理 sync/output/projection timer，并等待 deferred/workspace 写入完成。未完成的通用 Supervisor operation 不被强行等待或伪造成功，仍由 boundary 的未知/未确认语义覆盖；其迟到 resize 等回调只能更新已保留的内存身份，不能通过关闭后的准入门再次排队保存。旧 `terminalSessions`/`agentSessions` map 及 `runtimeSessionBindings` 不删除，作为仍由 Supervisor 持有的 live execution 身份；remoteDetach 域只 dispose Host client，不发送 stop/delete。这样既保持既有“detach 而非终止”的契约，也让旧 generation 的迟到 timer/event 无法再次排队保存。

新增 `scripts/test/test-runtime-host-deactivation-integrity.mjs`，通过真实 `CanvasPanelManager` 方法、阻断 node-pty/child_process 的 Host 夹具验证：已确认 resize 在 final metadata 中落盘；已排队 timer 和迟到 Runtime 事件不再 flush 或变更 session；第二 Host 的 completed 状态不会被旧 live 写者覆盖；state callback 会被跟踪且边界重复调用幂等；旧 Supervisor client 不收到 stop/delete，live map/binding 保持。`node scripts/test/test-host-execution-owner-wiring.mjs` 仍为 95/95，workspace `npm run typecheck` 通过，S13 用例 5 项通过。

本阶段没有新增 PTY/native/VS Code/Electron/真实 Agent 或其他平台样本。普通生产 Runtime（未注入该 execution owner）仍走既有 `prepareForHostBoundaryCore`，本次没有把 event admission 屏障全面接入该路径；因此真实宿主退出调度、Webview 最终应用、Agent 启动包装链、跨平台时序以及未完成 Runtime operation 在 deadline 后的运行时证据仍未决。这些不能由本地 Host 夹具的 settled 结果替代。设计状态从“修正待设计”进入“candidate 路径最小修正已实现、普通生产路径与真实宿主验证中”。

### 31.12 S14 普通生产 Runtime 屏障接入

本阶段把同一退出屏障接入未注入 `execution-owner-boundary-v1` 的普通生产 `prepareForHostBoundaryCore`。只有 `permanentExecutionClose: true`（扩展正常永久 deactivation）会关闭 Runtime event admission；`resetState`、模板/根画布重置和测试 runtime reload 等非永久边界保持准入，以便新 Host/client 继续工作。永久边界在最终状态 flush 前等待已接受的 `onSessionState` callback，并在释放 client 时主动使其 epoch 失效；因此旧 client 在 dispose 与新 client 创建之间也不能回调写入。

Runtime client 获取默认受永久 gate 保护。已经被 gate 关闭前接受的 state callback 仍可使用 map 中原有 client 完成其同一 binding 的 cleanup；gate 关闭后如果原 client 已被 dispose，则不新建/重启 client，cleanup 只能按未确认处理。永久清理已捕获的旧 Supervisor session 时，批量调用链通过显式 `allowClosedAdmission` + `requireExistingClient` 例外完成删除；该例外只用于边界内的既有 cleanup，不向普通 reconnect/新业务操作开放。分页 reconnect timer 在 gate 关闭后不再排队、执行或重试，Host detach 也清除已登记的 reconnect timer/pending 标记。Supervisor live execution 仍由其原 owner 持有，Host 不因 detach 发送 stop/delete。

新增回归覆盖：普通生产 deactivation 的 pending state callback、边界前已排队 sync timer、119x41 resize 与 live runtime binding 的一次性 immediate snapshot、旧 client dispose 后的 epoch replacement、永久 gate 后禁止 client acquisition，以及非永久 boundary 保持 admission。测试仍是阻断 native/child_process 的 `CanvasPanelManager` 逻辑夹具；没有新增 PTY、VS Code/Electron、真实 Agent 或其他平台证据。`node scripts/test/test-runtime-host-deactivation-integrity.mjs`、`node scripts/test/test-host-execution-owner-wiring.mjs`（95/95）和 workspace `npm run typecheck` 通过。

本阶段只闭合普通生产 Host 永久退出的旧写者/旧 client 屏障，不宣称 `resetState`/模板重置的完整跨 generation 持久化验收，也不宣称 Webview 最终应用、未完成 operation deadline、真实宿主调度、Agent 启动包装链或跨平台退出完整性已通过。旧 live session 继续沿原 metadata binding 运行，正常结束节点仍不恢复进程或历史。

本阶段的“已接受 completed callback 可 cleanup”结论限定于普通非-candidate Runtime 路径：它要求原 client 仍在 map 中。candidate/non-native 的严格删除与 finalization 仍受其自身 deadline/owner 语义约束，不能由本节的普通 production cleanup 旁路代称为已验证。

### 31.13 S14 工作树增量复核：删除旁路与 timer 屏障边界

当前未提交增量进一步把 client epoch 失效放到普通 remote detach、统一 client dispose 和旧 generation retire 的每个释放点；因此同一 client key 的 replacement 也不能接收旧对象迟到回调。`reconnectPagedRuntimeSession()` 的入口、延迟回调和失败重试都复核全局 admission，Host detach 同时清理 reconnect timer 与 pending 标志，避免永久 deactivation 报告后重新 attach。

`allowClosedAdmission` + `requireExistingClient` 是 `getRuntimeSupervisorClientForBackend()` 的受限删除旁路，当前仅由 `deleteRuntimeSupervisorSessions()` 在永久边界 cleanup 时按 `permanentExecutionClose` 显式传入；candidate 的非永久 reset/delete 不再无条件打开该旁路。文档契约只能把它解释为既有 session cleanup，不得把它视为创建、attach、reconnect 或普通 Runtime 操作的通行证；已接受 callback 只复用仍在 map 中的原 client，原 client 已释放时结果保持未确认。

该增量仍未增加真实宿主、Webview、PTY/native、Agent 启动链或跨平台证据。已有 S14 回归结果不因逻辑夹具自动扩大；删除旁路已按永久边界条件收窄并有定向覆盖，S13/S14 的普通生产时序与未完成 operation deadline 仍不能标记为整体退出完整性完成。

### 31.14 S15 普通永久离开的首次结果复用

本轮以`670320b8`为输入。正式最小方案只调整 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的普通 `prepareForDeactivation()`：首次调用读取 startup configuration、固定 `preserveLiveRuntime` 和永久关闭选项，并缓存原关闭 Promise；并发及后续调用都复用它。成功后不重复 flush/detach；失败后也不清缓存、不根据后来配置重试或重复发送删除。首次配置读取同步抛错也保留原错误，但仍沿既有行为，不能宣称此时已经进入core或关闭event admission。返回同一结果只表示对同一关闭操作的观察，不将首次失败改成成功，也不给该普通路径新增deadline或OS资源结算承诺。显式 `execution-owner-boundary-v1` 的candidate/non-native路径继续使用原 `nonNativeDeactivationReport`，本轮不改变其owner、预算、报告或清理语义。

此前考虑把锁放到 `prepareForHostBoundaryCore`、临时关闭非永久event admission、把多根clear接到全量core或在root操作中全局drain。复核后撤回这些候选，不作为交付：core返回后调用方仍会load/替换/persist state，故只锁core不等于完整reset/reload操作串行；临时关闭准入会影响已有attach/create续体和删除旁路；root原有strict delete失败保留不能换成ordinary批量best-effort；root A也不能为等待全局pending集合而被root B的长操作阻塞。撤回代码及其局部测试不记为产品修复或正式验证通过。

非永久边界仍需单独设计并验收。普通core的一次pending集合快照等待不阻止其后新callback/operation或业务创建入队；epoch只拒绝尚未进入的client事件，不能失效已进入的异步续体。已接收completed callback可在reader/persist等待后继续保存或回滚，须围绕原binding与最终state replacement确认顺序。另有部分attach/snapshot异步工作是否完整纳入边界责任的源码观察尚未闭合，没有本轮实证，不能写成已复现覆盖或新平台失败。root clear/template需按受影响binding追踪，保留其他root准入与严格删除错误传播；这些不是本轮缓存修正的已解决项。

定向验收只扩 `scripts/test/test-runtime-host-deactivation-integrity.mjs`。新增并发用例在未改业务的`670320b8`源码上先红：`testOrdinaryDeactivationSharesInFlightBoundary`断言flush应为1、实际为2（`2 !== 1`，exit1）。正式最小修正后旧8次加新增5次共13次测试调用通过，新增覆盖并发单flush、preserve true/false首次配置冻结与重复完成（普通delete一次）、首次flush失败保持原Error、首次配置同步异常保持原Error。Host owner wiring95/95、checkpoint refresh、仓库根`npm run typecheck`及`node --check scripts/test/test-runtime-host-deactivation-integrity.mjs`均实际通过；独立review无阻塞，reviewer复跑目标测试及`git diff --check`通过。不以撤回候选绿色结果替代这些验证，没有新增PTY/native、runner、真实VS Code/Electron/Webview、Agent或跨平台采集，整体退出完整性及L-02至L-05继续开放。

下一有限阶段的受控验收输入固定为：普通reset/reload完整入口重叠，覆盖core之后的load/state replacement/persist；pending state callback在首轮wait后进入；root A clear/template期间root B保持live，且strict delete失败时保留A的原绑定与状态。这些均待实现和待验证，不由S15的首次结果复用推导为通过；只沿现有Host回归验证，不新增native样本或工具门槛。

### 31.15 S16 普通completed续体的节点级保护

2026-09-27，验证阶段输入固定为`a74844c44aef1bfef5c2d13adbb29ddaf7389777`。本阶段先沿31.14的三类输入取得最小复现，直接扩展已有`scripts/test/test-runtime-host-deactivation-integrity.mjs`中的实际Host方法回归；不新建诊断工具，不启动PTY/native、真实Supervisor或平台runner。运行前只登记以下待验证定义，实际结果随后分账记录；S15通过仅覆盖普通永久离开的首次结果复用。

第一类固定普通reset/reload完整入口的重叠顺序，观察`prepareForHostBoundaryCore`返回后的load、state replacement与persist，而不是只统计core调用次数。第二类让state callback在首次pending集合等待之后进入，并控制其异步续体在状态替换前后恢复，核对旧binding是否仍能保存或回滚到新状态。两类均须保留实际入口、事件顺序和最终state/保存内容，分别记录已复现、未复现或夹具阻断；源码上的可能性和局部绿色不能代替该顺序的实证。

第三类只作用于root A的clear/template，保持root B live并观察其准入和交互是否被无关操作拖住；另以A的strict delete失败核对错误传播及原绑定、节点状态保持。不能用全局pending等待替代受影响binding的收尾，也不能将严格删除降为best-effort后清空状态。实际受控结果只说明Host逻辑层，不推导真实宿主、Agent或其他平台已经通过。

实现方案只在最小复现及责任边界确认后收敛。本阶段不批准全局准入gate、仅锁core或root全局drain，也不恢复S15已撤回的候选；不停止因Host detach而保留的Supervisor执行，不改变旧live绑定、Runtime completed无进程/无历史及候选默认关闭。新失败及原断言须保留，不通过扩展工具门槛或先改业务再补结论跳过定位。

本轮定位先收敛到真实`CanvasPanelManager.applyCompletedRuntimeSupervisorSnapshot()`的普通completed callback。只读源码确认：它在reader或persist等待后，普通失败分支会无条件恢复整个`stateBeforeCompleted`及原root缓存；若等待期间root A已清除或root B已更新，该写法可能复活A或覆盖B。随后默认Host回归在未改业务基线先红：真实root A clear已成功，旧completed保存再reject，却恢复`terminal-1`，实际A+B而预期只有B；主会话与测试代理分别实跑复现。这证明该Host状态回滚竞态，不代表三类输入已经全部实证；调用链没有平台专属条件，但未采集其他平台运行结果。

最小修正只作用于无`finalizationRecord`的普通completed分支，以节点执行metadata的本次投影引用及原session对象身份复核异步续体；reader等待后、保存前及persist完成后再次检查，过期则抛出内部错误，阻止在这些等待窗口已经过期的旧外层继续发布exit通知。root已清除或同ID节点已替换时，不得复活旧节点，也不得解绑、dispose或删除replacement。strict `finalizationRecord`分支保留既有deadline/binding断言与回滚语义，不借普通分支扩大其保证。

正式业务diff仅限`applyCompletedRuntimeSupervisorSnapshot()`方法；reset/reload/root/template入口及旧strict删除路径没有重写，相关root用例是在原入口上验证隔离和错误保留，不代表引入了新的事务框架。

普通失败回滚分两种情况：整体state仍恰为本次投影且身份有效时，保留无并发情况下的原state/cache恢复；整体state已经变化但该节点投影和session身份仍有效时，只恢复A的status、summary及对应kind执行metadata，保留A的title/position、其他节点和当前root缓存。投影或session已替换则不回滚。普通reset/reload完整事务仲裁、新业务admission及三类输入其余部分继续开放，不由该节点级修正代称为已解决，也不因此追加全局锁或gate。

最小业务修正后，Host回归最终25次通过：原13次，加root clear/template preparation成功/失败4次、已清root不回滚复活1次、节点局部回滚1次、replacement保护2次、受控Agent普通分支2次及reader等待期间clear/replace2次，主会话已复跑。template只调用真实prepare入口，不代证完整apply。Host wiring95/95、checkpoint refresh、paged completion的Terminal/Agent与disconnect四组合、multi-root composition及仓库根`npm run typecheck`均通过；目标脚本`node --check`与最终工作树`git diff --check`通过，独立review无阻塞且reviewer复跑目标测试及diff检查通过。普通reset/reload完整入口重叠、首次pending等待之后注入callback的完整边界顺序尚未运行，仍是开放验收项。

本轮保护限于reader/persist等待后的旧回滚及后续同步清理，不泛化为所有迟到UI安全：原session已同步释放后，等待旧Runtime delete再返回外层发布exit的后段仍有既有reader/UI身份竞态，未纳入本次修正。正常queued sync/resize/scrollback flush受`terminalHistoryDiscarded`拦截，不能仅凭投影引用检查就登记为已确认的false-stale缺陷。没有新增PTY/native、真实宿主/Agent启动链或跨平台证据，整体退出完整性继续开放；剩余项另按有限输入确认，不自动扩展为下一轮矩阵。

## 32. B2 正式启动链接入

2026-09-30 从 `9a8f4915` 开始推进既定 B2，不再以合并夹具的 64/128 MiB 超限或 profiler 为接入前置。当前增量补齐 `RuntimeSupervisorClient` 到 `runtimeHostBackend` 的 detached/systemd 及 `runtimeSupervisorLauncher` 两跳 profile 传递。选中的 `ExecutionCandidateProfile` 必须原值到达 Supervisor，未知 profile 或错误 generation 在连接/启动副作用前拒绝；连接成功后仍须核对真实 hello 的 profile 和完整 reader 能力，不退回 stock 能力。

`src/common/runtimeSupervisorPaths.ts` 提供显式 candidate 到 `terminal-exit-v1` 的映射及 storageDir 校验，供 Client、backend、launcher 和 Supervisor main 复用。默认 `terminal-stream-v1` 不变，既有 metadata 的 backend/storage/session/executionKind 不重写，也不在新路径补造旧会话保证。无 profile 时保持现有启动参数和行为；显式 profile 时只允许 `runtime-supervisor-generations/terminal-exit-v1/runtime-supervisor`。单根/多根的 root 稳定归属不在本增量实施。

本轮不修改 Host 的 `allowRestart:false`，不默认注入 extension owner，不新增用户配置。源码核对发现 Unix `listen()` 会先 unlink socket；两个独立 client 冷启动同 namespace 可能摘掉已有监听路径。这是具体启动安全风险，尚无本轮原生复现；正式允许新会话冷启动前必须保证活动 endpoint 不被替换。新会话尚未提交 create 的连接准备可以另行获得首次启动许可；旧 live 重连、reader、strict delete 及提交后未知创建始终不能借此启动替代服务或重放请求。这些仍属 B2 启动接入，不增加通用锁/诊断框架项目。

定向验证加载实际模块并捕获连接、spawn 与 systemd unit 参数，覆盖 profile 原值传递、stock 参数保持、错误 profile/generation 无启动副作用、hello 不匹配拒绝，以及原 socket create/未知结果不重放。路径测试检查隔离后的 storage/socket/unit；沿用 Host、reader 与 deactivation 回归，另跑 typecheck/build。受控验证不代证真实 PTY、VS Code/Electron、Agent 或跨平台；本轮不重跑容量样本、改原阈值或历史证据。B2 后续仍须接通安全首次启动、Host/extension 两模式选择、匹配资产与实际启用，完成 A1 至 A6 才能关闭整体重构。

本轮已完成上述传递链与定向验证。新增 `scripts/test/test-runtime-supervisor-startup-profile.mjs` 在原 backend/launcher 上先红，缺失 candidate 的第一跳参数；paths 新映射尚不存在、Client 未拒绝未知 profile 的先红分别保留为接口缺口与准入缺口。独立复核又以畸形 hello 的 `executionCandidateProfiles: {}` 证明校验抛错后仍残留已接受缓存，导致第二次连接检查直接成功；新增用例先红后，改为数组/reader 能力验证成功才提交 hello，失败清理连接且不启动替代服务，不增通用协议工具。

最终运行 `npm run test:runtime-supervisor-startup-profile`：实际 backend/launcher 受控启动 16/16、Client 28/28；`test-runtime-supervisor-paths.mjs`、Host owner 97/97、Supervisor owner 82/82、Host deactivation、真实 socket Host output credit、typecheck/build 与 diff 检查通过。构建清除 dist 后从原已校验目录重新 import Linux 资产，没有加载 binary 或启动 native。没有新的容量、实际 systemd 服务、真实 Agent/VS Code/Webview 或跨平台通过；默认入口、Host cold-start 和旧 live 路径均未改变。下一直接处理同 namespace 首次启动与两模式入口，仍属本 B2，不返回合并阈值压线或工具阶段。

### 32.1 安全首次启动与 Host 新建入口

2026-09-30 从 `4578cd34` 继续 B2。源码确认 registry 恢复会经 journal open 修复 stale tail，并非纯读；排他取得必须早于 `loadRegistry()`，且持有到最终写盘之后。选定仅为当前 Linux candidate 使用 Node 内置 abstract Unix socket 作为进程期 namespace claim，即由内核原子占用、进程结束自动释放的无磁盘地址；不是新增服务进程、文件租约、PID 存活猜测或通用锁框架。`src/supervisor/runtimeSupervisorNamespace.ts` 按 uid 和 `realpath(storageDir)` 的结构化身份生成具名地址，不含 backend，保证共享 registry 的 detached/systemd 竞争同一占用。Node 具名 abstract socket 自 20.8.0 支持，取得资源前要求 Linux/Node >=20.8；不支持直接拒绝，stock 路径不改。

候选 `start()` 同对象只执行一次；创建 storage 后先取得 claim，再检查业务 endpoint、恢复 registry、监听及开放业务。claim 的 socket 只拒绝连接、unref 不阻止进程退出，不随业务 listener close、关闭超时/失败释放。shutdown 的 server 域仍指业务 listener；claim 是本进程到退出前应保留的排他责任。获得 claim 后，遗留 public endpoint 若不是 socket、仍可连接或状态未知，均在 load 前拒绝；只有明确 ECONNREFUSED 且再次 lstat 的 dev/ino/type 未变，才清理残留 socket。不得保留候选 listen 的无条件 unlink。该保证限同一 Linux 内核运行环境中的本版参与者，不代证共享存储跨主机/network namespace，亦不宣称与不持 claim 的旧 candidate 并发启动安全。

候选 systemd unit 使用 `Restart=no`，防止失败的竞争者持续重启、在赢家退出后自动接管；stock 的 Restart=on-failure 保持。Supervisor/机器故障后不恢复进程或历史的既定非目标不变，后续只有明确新建可以重新启动。Host 只有收到真实匹配 hello 才确认连接可用，启动命令返回不代表 ready。

`CanvasPanelManager` 的显式 candidate 新建选择 `terminal-exit-v1`，同一 profile/generation 贯穿 backend fallback；既有绑定始终用 metadata 的路径，缺省旧路径先按旧 workspace storage 解析，不得走新建默认 generation。按 backend 实际 generation 为 Client 指定 profile，避免先恢复缓存一个无 profile client、再新建时丢失启动参数。candidate Client 默认禁止重启，只有 Agent/Terminal 新建的连接准备明确 `allowRestart:true`；candidate attach、恢复、reader、strict delete 与未知 create 不获得此许可。legacy bound 的首次连接默认禁止重启，但保留其显式旧选项，不宣称 stock Client 内部既有请求重启行为已整体改造。create 本身仍在原 socket 单次提交，不能重放。同节点 pending/unknown 责任与最终尾部屏障保持。

本轮不默认启用 extension candidate、不新增用户配置，snapshot-only 原显式 owner 工厂路径不变；匹配平台/运行时资产及 A1 至 A6 仍须完成。定向回归只覆盖本次风险：实际 Linux socket/受控子进程竞争、活动/残留 endpoint、claim 生命周期与恢复前拒绝；Host Agent/Terminal 新旧路径及缓存/fallback；Client 默认不启动及显式新建许可；systemd unit 参数。使用测试自有临时目录，不启动 PTY/Agent，不改冻结诊断或重跑容量样本，旧失败保留。

本轮已实施上述有限范围。原 namespace 竞争先红为 `loads=[1,1]`，修后只有一个 writer、败方 `loads=0`；同时覆盖不同 backend/socket 共用 storage、realpath 别名、业务 listener 关闭仍占用、进程退出后释放。其他直接先红为 candidate unit 仍是 `Restart=on-failure`、Client 默认连接会启动服务、Host 实际 getter 丢 profile 导致 create 为 0，以及 candidate bound 显式 `allowRestart:true` 得到 `[true,true]` 而非 `[false,true]`。现在 bound 入口按实际 generation 强制禁止重启，旧 legacy 显式选项保持。namespace 测试最初误禁止模块导入、strict Host 新夹具漏传 options 两次失败属于夹具错误，分别修正，不记产品缺陷或原生平台失败。

最终 Linux x64/Node 25.6.0 验证：`npm run test:runtime-supervisor-namespace` 7/7（实际 socket、测试自有子进程，禁止 PTY/Agent 获取），`npm run test:runtime-supervisor-startup-profile` 启动 16/16、Client 28/28，Host owner 104/104、Supervisor owner 82/82、paths、Host deactivation、真实 socket Host output credit、typecheck/build 和 diff 检查通过。Host 路由用真实 getter/backend/Client constructor/cache，替换 connection/RPC 边界观察意图；systemd 仅验证 unit/参数，没有启动实际服务。独立最新 diff 复核未发现新增确定性 blocker。build 后从原已校验目录重新 import Linux 资产，未加载 native。本轮没有真实 PTY、Agent、VS Code/Electron/Webview 或其他平台验收，不改写之前证据；下一仍是原 B2 的 extension 两模式入口及匹配资产接入，再完成原 A1 至 A6，不另开工具阶段。

### 32.2 实际扩展入口与候选构建

2026-09-30 从 `43527328` 继续原 B2，用户要求持续推进到需要外部决策，而非每个局部切片结束。选择构建期固定 profile，不增加用户设置、运行时环境开关或按目录存在自动启用。`scripts/build/build.mjs` 显式接受成对的 `--execution-profile=linux-owner-v1-candidate` 和 `--execution-assets=<编译产物目录>`，未知值、缺配对参数、candidate watch 或会被清空的 dist 内资产源在构建副作用前拒绝。普通构建仍选择 stock；候选构建将常量编入 extension 并沿既有 import 复制已校验资产，不在 Host 或构建过程中加载 native。stock 构建不能因环境变量或残留资产自动选 candidate。

扩展激活通过 `src/panel/executionRuntimeSelection.ts` 读取编译期选择，选中时调用已有 `createLinuxExecutionOwnerOptions({ extensionRoot, mode: 'snapshot-only' })`，将 owner options 与同一 profile 注入 `CanvasPanelManager`。这是实际扩展入口，不是 Test 模式构造器替身；snapshot-only 在 Host 执行，Runtime 仍沿新建路由到 Supervisor，由其准备 live-runtime owner。空闲本地 owner 不获取 PTY/worker，既有配置切换沿原边界收尾。原绑定不改址，未知创建不重放，不改 root 归属。

构建允许离线暂存明确目标的 Node 或 Electron 产物；激活/启动时仍按真实 authority 的平台、架构、glibc、Node/Electron/version/ABI/N-API 及内容摘要严格校验。错误或缺失资产明确拒绝，不静默降为旧源；Node 产物不冒充 Electron 产物。现有 VSIX/测试 staging 复制整个 dist，须验证候选资产和编译期选择均保留。普通发行构建的默认启用策略不因候选包可构建而改变；候选包用于原 A1 至 A6 的真实验收，最终支持/启用仍须同一产物的证据。

当前先验证构建参数、真实激活入口和两模式选择的有限受控回归，再在可用 VS Code/Electron 环境编译匹配资产并进入真实页面/Terminal 验收。真实 Agent、macOS/Windows 与分发责任保持，环境不可用先找既有工具/runner 路径，不用 fake 替代或降范围。新失败在独立目录保留，定位具体原因后才进行有依据的复验，不重开诊断框架项目。

本机可用 VS Code 1.117.0，实际 `ELECTRON_RUN_AS_NODE` 身份为 Electron 39.8.7、Node 22.22.1、ABI 140、N-API 10、Linux x64/glibc 2.35。官方 `https://artifacts.electronjs.org/headers/dist/v39.8.7/node-v39.8.7-headers.tar.gz` 下载后与同目录 SHASUMS256 的 `af6712ab16c436b9288ece2f0173924c74008446346bda3457d07b769f402eda` 相符；使用该 Electron 执行现有 build，在 `/tmp/dsc-b2-electron-39.8.7-pfOkg2/assets` 生成匹配产物，当前仅 compile-only，不倒写 manifest 的验证字段。

真实页面固定输入为 Runtime/snapshot-only 各一个 Terminal，100000 scrollback、90000 编号行和 UTF-8/ANSI 尾部；复用现有 smoke runner、staging、Host 测试命令与实际 xterm buffer 断言。主体逐次成功写入后的独立凭证与页面逐行内容、终态/光标核对，Runtime 再核对轻量保存及重开无历史，snapshot-only 保持原保存语义。测试使用全新目录、测试自有主体和原关闭入口，不使用 fake Agent 或 TEST_NODE_PATH 替代 Electron，不运行一般诊断矩阵；缺失的真实 Agent、多 reader、慢消费及其他平台格子仍留在原 A1 至 A6。

### 32.3 A6 旧 completed 删除等待后的身份保护

与 B2 实际入口并行核对原 31.15 已登记风险。新增 `test-runtime-host-deactivation-integrity.mjs` 的实际 Host callback 用例先红：旧 completed 已保存轻量结果并退休 session，strict delete 未返回时同 ID replacement 建立新节点/session/binding/reader；旧 delete 返回后，新映射仍正确，但 `successor-reader` 被关闭，随后发出旧 session 的 snapshot/exit。这是现行产品续体串代，不是原生资源或诊断工具缺陷；原 25 次测试先通过，新用例 exit 1 保留。

选定窄修普通 completed 的原投影身份检查：继续要求原完成投影（execution metadata、status、summary）仍当前；退休前必须仍是原 session，退休后必须没有替代 session。不满足按已有 superseded 路径中止最终通知。该检查通过 `onCompletedProjection` 回传到 `handleRuntimeSupervisorState`，贯穿 apply 等待返回与 `postExecutionExitWithFinalSnapshot` 的真实 reader/消息发布边界；不能在每个续体把 replacement 捕获为新基线。Agent 异常通知会同步更新自己的 attention metadata，故放到当前续体最后，不在通知等待之后再执行旧清理/发布。strict finalization 保存/删除责任保持，不加 Map、全局锁或 root 全局 drain。

第一版仅在内部完成方法末尾检查，后续有限用例再次先红：内部 apply 返回后替换仍关闭新 reader、发布旧消息；snapshot 发布等待后替换仍会把旧 Agent 的 `attentionPending` 写入新执行。上述三类失败均保留。最终 Host 边界共 32 次通过（原 25 次及本组 7 次），含 Terminal/Agent 正常完成阳性和三类替换；Host wiring 104/104、typecheck、脚本语法和 diff 检查通过。验证只针对实际 Host 方法的受控顺序，没有新增 native/UI/Agent 通过，不泛化为通用通知系统或 `postExecutionSnapshot()` 内部任意异步路径安全。完整 template apply/root 准入及其余原 A6 顺序仍需完成。

### 32.4 真实页面首轮失败与退出提示责任

32.2 固定实验首轮保存在 `.debug/execution-candidate-a2-a3-20260930-first`，进程 exit 1；Runtime/editor 首个场景失败即停止，snapshot-only 及两次重开未执行，不将其列通过。真实 Electron authority、provider 和 PTY 已实际运行，主体凭证为 5580102 B、SHA256 `e03d6d758493454da0946cc62e7c17fb2444e39afaa7639c8a88ad271eaff48f`，真实 reader 已记录 applied/finalRevision 1402。但页面逐行对账超时：保存的 probe 显示第 89979 行变为 `[Dev Session Canvas] Session ended.000...`，最终光标为 `(0,4)` 而非主体的 `(6,2)`。UTF-8/ANSI 尾行仍可见；不能把该失败记作 PTY 未收到主体尾部，也不能因 applied 回执存在宣布最终页面正确。

源码定位到 `src/webview/main.tsx` 的 `queueExitWrite()`：在已完成的终端内容上追加宿主状态文本和换行。主体可以合法地把光标停在已有内容上，故该追加会覆写输出和终态。选定生命周期提示与终端字节分离：退出状态和 message 留在已有节点状态/overlay 中，`host/executionExit` 不再向 xterm 注入合成正文。保持原输出排队、投影/保存和 local completion 屏障、身份检查及取消结果，不通过清屏、恢复光标但仍改正文、缩短输入或跳过内容断言解决。Terminal/Agent 和两种持久化模式共享此规则；正常及异常退出均不得污染主体终端。只补该直接产品缺陷的定向回归后，以新证据目录复验固定页面实验，原失败不改。

该出口还承载 paged reader 的断连/读取关闭错误，不能随正文写入一起静默删除错误反馈。`TerminalPagedProjection.accept()` 必须先沿原 readId/requestId 拒绝陈旧回包，再通过独立错误回调进入现有节点 `onShowTransientError`；当前 reader 仍按原 cancelled 结算，错误文本只显示在终端之外。自然退出不变成错误 toast，旧 reader 的迟到错误不能泄漏给 replacement。定向测试同时检查当前错误可见、旧错误无效和 buffer/光标不变，不新增页面状态容器或协议框架。

修后实际 controller/headless 39/39、Host batch 10/10、reader wiring 20/20 及 typecheck 通过，Terminal/Agent、local/Runtime/旧分页/旧stream 退出均保持正文和光标，当前读取错误只反馈一次，陈旧错误无效。另补齐本增量及候选最终退出的中文提示，localization 首败后通过；不以这些受控回归代替下文真实页面结果。

### 32.5 A6 完整 root 模板 reset 的提交复核

原 A6 完整入口用例先红：`applyCanvasTemplateRecord(reset, targetGroupId)` 清理 root A 原执行的 strict delete 等待期间，真实 `applyCreateNode()` 与 `startTerminalSessionWithSupervisor()` 已接纳 A 的新执行；旧删除成功后模板提交把新节点移除，却保留其 session/binding，并保存不含新执行的状态。root B 前后仍可输出、绑定正常，删除请求仅指原 session。受控 Client 返回 create 结果，实际 Host 入口及 headless tracker 执行，无 native；原 32 次回归先通过，新用例 exit 1。最初旧夹具未使用 namespace 身份造成 strict 正确拒绝，已修夹具，不能把它计为产品通过。

原因是 `prepareWorkspaceRootCanvasForTemplateReset()` 只清理初始集合，外层 await 后仍用预先的空基态替换目标 root，没有验证等待期间已接纳的执行责任。选定提交前复核而非 root 锁：在清理前固定目标 root 身份、所属节点 ID/kind 集合及相关执行责任，清理返回后、compose/赋值/persist 前复核。新增/移除节点、目标 root 被替换或同 ID 出现新执行责任时，明确中止旧模板提交，保留当前节点与绑定；不宣称回滚已经成功的旧 session 删除，不为了模板成功再终止等待期间新接纳的执行。允许本次正常清理造成的原节点 completed 投影变化，不能用全 state 引用把正常清理或其他 root 输出误判为冲突。

本修正只覆盖完整 root reset 提交窗口；保持其他 root 准入和交互，不新增全局 drain、通用事务框架或无限重试。定向验收包含无冲突成功、新执行/同 ID replacement 的明确失败保留、原 strict 删除失败保留及 B 独立；完整非 root reset/reload 和首次 pending 后 callback 仍按原有限 A6 处理。

### 32.6 A4 真实 Agent 的固定本机输入

本机只读核对可用 Codex 0.157.1 和 Claude Code 2.1.280。Codex 的真实 npm 入口启动 native CLI、转发 SIGINT/SIGTERM/SIGHUP 并等待其退出；Claude 安装入口直接为 native binary。源码不代替实际时序验证。现有测试创建命令可通过 `agentLaunchPreset: custom` 和 `agentCustomLaunchCommand` 进入产品 Agent 链，不使用 fake provider，也不把普通 Terminal 命令记为 Agent 通过。

固定为两个 CLI、两种持久化模式、自然完成/主动停止，共八个场景；每个场景一个执行，一次请求或停止，不自动重试外部服务失败。自然完成四场景使用空的仓库外测试目录，只请求回复一个具名 nonce，不要求工具或文件操作。Codex 使用真实 `exec`、ephemeral、skip-git-repo-check、read-only sandbox、never approval、JSON 输出与独立 last-message 文件；Claude 使用 safe-mode、空 tools、strict 空 MCP 配置、no-session-persistence、noninteractive print/JSON 及每次 USD 0.25 上限。准确参数先以已安装 CLI help 核对，不通过换模型/服务或复制凭据获取通过；实际返回错误或工具调用按失败保留，不把错误退出算成功短答。

停止四场景启动真实交互 CLI，不发送模型任务；通过页面输入帮助命令、resize，再使用原产品 stop，检查 Codex interrupt-then-hangup 与 Claude hangup 的实际结果。CLI 首次信任/登录交互如出现，只在测试空目录内处理合法提示，不扩大权限或操作真实项目。自然退出与主动取消分别报告，未取得完整源/应用证据的停止不写成自然 EOF。运行前保存实际命令/版本/模式，记录原执行身份、真实页面、reader 结算、持久化和清理；Agent 证据补 A4，不代替 A3 的独立大输出尾部断言。

认证保持 smoke 的隔离 HOME 与现有 secret 过滤，仅传原 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 的目录引用给 CLI，由其自己读取认证；不复制/输出 auth 正文、API key、环境全集或用户配置内容。隔离 HOME 下只读 status 已确认两者报告 API-key 登录，没有模型请求证据。若固定真实请求遇到失效凭据/配额/服务不可达，保留首报并作为实际外部前提处理，不提前推定缺权限。

启动链只在已确认本轮 owner 派生范围有限采样 PID/PPID、启动标识、状态和 executable，区分 Codex npm wrapper 与 native 主体；不扫描其他会话环境，不把进程对象仍被引用当作仍在执行。主体仍活着时 wrapper 不得已结束；双方退出时间区间重叠则说明精确先后不可分辨，不制造高精度结论。所有场景使用新证据目录，失败先归档后只清理本轮已知资源。Linux 证据不能外推 macOS/Windows 或 packaged 路径。

### 32.7 snapshot-only 的当前执行状态投影

32.4 修后固定复验保存在 `.debug/execution-candidate-a2-a3-20260930-exit-ui-fixed`，整轮仍 exit 1。Runtime/editor 完成与真实重开通过：90002 条前缀行逐行一致，最终光标 `(6,2)`，completed 节点 661 B，重开空内容/无自动执行、清理通过。随后 snapshot-only/panel 在等待真实 Terminal live 时超时，尚未发送 90000 行主体、未执行 snapshot 重开。该场景已经实际启动 PTY，页面出现 `$ `，Host snapshot 报 liveSession=true；但节点 metadata 为 liveSession=false、attachmentState=history-restored，页面显示“Terminal not started yet”，runningExecutionCount=0。

源码确认 `projectNonNativeHostBusiness()` 把所有候选本地业务投影固定写为 liveSession=false。snapshot-only 仅描述跨 Host 的持久化保证，不表示当前执行不在运行；stock 本地路径原来使用 attached-live/liveSession=true。选定按原 owned execution 的主进程结果/最终状态投影当前存活：真实启动后的当前主体未退出时使用 attached-live/liveSession=true；有退出事实或最终投影后为 false，最终快照保存继续使用原完整性/持久化屏障。不能用 legacy session Map 的缺席判断新 owner 不在运行，也不能通过改验收判据忽略实际错误 overlay。覆盖 Terminal/Agent 的启动、输出、停止等待、自然完成和失败保留；不创建兼容 process facade，不恢复已结束进程或改变 snapshot-only 持久化承诺。

本轮还恢复既有 completed-history 回归夹具的可执行性：补原准入/epoch/最终提示方法、surfaceLifecycle 与 notifier 对象，等待原 reader 的 releasing Promise而非一个微任务。原内容、无历史、保存失败和资源断言保持，修后通过；初始缺方法/字段和过早释放断言的失败不改。模板完整套件另在既有静态断言失败（main.tsx 中查找已经迁至 fileNoteNodes.tsx 的 action），不记模板总套件通过，也不为本次产品修正扩 unrelated UI 测试迁移。

### 32.8 A6 reset 首次等待之后接纳的 callback

原有限 A6 的实际 candidate `resetState()` 顺序已先红：边界首次等完 callback 后等待存储，新的 completed callback 经真实 Client 入口接纳，先将节点投影为 snapshot-only，再在真实 reader relay 等原 open 返回。放行存储后，reset 成功、保存空画板，但仍有一个 callback 在途，没有发出 Runtime delete，原 binding 已清除。固定结果为 `resetFinished=true, pendingCallbacks=1, deleteRequests=[], retainedBindings=0, nodeCount=0, savedEmpty=true`；原 37 次先通过，新用例 exit 1，测试 finally 返回原 reader 结果并收齐 callback，无 native。根因是首次 wait 不是之后不再接纳的保证，而仅按当前 metadata 收集 live binding 会漏掉已进入 completed 投影、尚未结算的原责任。

选定破坏性提交前的责任复核：正常非永久边界即将清理 session/binding 或替换状态时，仍有已接纳 Runtime callback 未结束则明确失败，不把节点/绑定清掉并报告 reset 成功。候选 strict delete 等异步步骤之后仍复核，不能只在最初 wait 后检查。保留当前投影和原 callback 的 reader/保存/delete责任，让其按原链结束，不新建 drain 循环、全局锁或关闭其他 root 的准入；已成功删除的原 session不补造回滚。验证中止时没有空画板保存/绑定丢失，原 callback 完成后正常 reset 可成功，并保留永久关闭已有保证。`simulateRuntimeReloadForTest`、`reloadPersistedStateForTest` 仅是测试命令，不以同对象人工并发代证实际 Host reload；后者继续由真实宿主流程验收。

32.7、32.8 修正已实施：Terminal/Agent 的启动、输出、停止等待及自然结束投影四项新增回归通过，Host wiring 108/108；完整 reset 新用例证明首次中止保留节点/session/binding/client，原 callback 完成保存/delete 后重试成功，生命周期回归共 38 次。typecheck、语法和 diff 检查通过；独立只读复核未发现本有限边界新增阻塞。永久关闭不进入新 abort 检查，继续先关闭 admission 再等待原 callback，不将未知或取消伪报 settled。

### 32.9 snapshot-only 实际复验与夹具字段修正

按原参数重建匹配 Electron 候选后，仅选择未通过的 snapshot-only，保存 `.debug/execution-candidate-a2-a3-20260930-snapshot-live-fixed`，`partialSelection=true`，仍 exit 1。当前 live 投影已正确；主体成功写入凭证 5580102 B，页面 90002 条前缀行逐行匹配、光标 `(6,2)`、主体回收和最终快照保存断言均已完成。失败在等待本地 reader 最终回执，重开尚未执行。原事件实际记录同 execution 的 applied，`finalOutputSequence=1394`，与保存 metadata/serialized state 的 outputSequence 一致；脚本却读取不存在的 `outcome.finalRevision`。`protocol.ts` 的 `LocalTerminalReaderOutcome` 与生产 Host 均使用前者，这是新夹具字段错误，不是本轮证实产品丢尾或未应用。

仅把 Terminal 和尚未运行的 Agent 脚本本地回执比较改为正式 `finalOutputSequence`，保留同执行、applied 和最终保存序号相等的断言；Runtime 协议不改。原失败目录、字段、exit 1 保留，清理后无该轮残余进程。下一仅在全新目录复验相同 snapshot-only complete/reopen，不重跑已通过 Runtime 或扩大工具矩阵；新结果另记，不把离线核对追认为原轮通过。

修后新目录 `.debug/execution-candidate-a2-a3-20260930-snapshot-receipt-fixed` 的 complete 已通过：原成功写入字节/摘要、90002 行、光标 `(6,2)`、原主体回收、最终快照及同 execution 的 applied/最终 outputSequence 1399 一致。保存节点 5767052 B。真实 VS Code 重开失败，整轮 exit 1；加载后的节点缺失 serialized state、只剩 6000 字符摘要，页面历史及光标不匹配，不能宣布两模式通过。`normalizeSerializedTerminalState` 的 5 Mi 字符限制小于已保存快照，是待追踪的具体加载链路，不修改原负载或 scrollback 取绿。

A4 首跑前安全输入已冻结：现有 Codex 0.157.1 用户模型服务配置保持，仅通过 CLI 覆盖禁用 hooks/plugins/apps/shell_tool/skill_mcp_dependency_install、web search 及列出的 MCP server。`mcp list --json` 只在内存解析配置 ID，覆盖 `mcp_servers.<id>.enabled=false` 后复核；不记录配置正文/凭据，`features list` 确认指定功能 false。一次只读预检的 quoted dotted key 拒绝保留为前置失败，修后受限 ID 参数通过，非模型请求或产品验证。Claude 沿 32.6 safe-mode/空工具配置。八场景使用全新 `.debug/agent-candidate-a4-20260930-first`，自然短答最多四次 CLI 请求，不改变服务路由、不自动重试；首败及未执行项分账。

### 32.10 snapshot-only 保存与读取的大小契约一致性

32.9 的真实重开失败已追到原加载链：root-local 文件经 `loadRootLocalState → normalizeState → normalizeNode → normalizeMetadata`，Agent/Terminal 共同调用 `normalizeSerializedTerminalState`，其 5 Mi 字符检查丢弃本轮 5580063 字符的合法快照。随后只能发布 6000 字符 recentOutput；初始化还把降级后的状态再次写回。tracker 构造也调用同一 normalizer，仅修改 Host 一处会留下第二次丢弃。原 tracker 生成与文件 writer 均无该 5 Mi 限额；fresh sequence 检查通过，因此不是 stale state、源尾部缺失或测试回执错误。

选定移除通用 serialized state normalizer 中的任意 5 Mi 字符拒绝，保留格式/字段与输出序号新鲜度校验。它发生在 JSON 文件已经整体读取/解析之后，既不是文件读取的内存预算，也不一致地约束可更大的既有 terminal stream；不能用单次样本调成 6/8/64 Mi 来推迟同类丢失。实际快照仍只含配置的有限终端屏幕/scrollback，不新增 Runtime completed 历史、无限原始日志或外置历史服务。Runtime 的 validated checkpoint 256 Ki 字符限额（UTF-16 code unit）、eligibility、可信摘要及分页/在途约束完全保持；此修改不能代替 A1 的资源预算与文件输入防护结论。

回归覆盖真实生成的超过旧限额的快照结构读回、Terminal/Agent Host 最终保存后 normalize/reload 与 tracker 恢复，不只断言放宽后的字符串长度；旧格式/序号/不合法输入及 checkpoint 拒绝继续验证。真实页面仅在新目录复验原 snapshot-only complete/reopen，90000 行、100000 scrollback、主体成功写入及最终光标不变。保留此前所有 exit 1，不宣称跨平台或全部 A2/A3 通过。

实施后，`.debug/snapshot-large-state-normalization-20260930/` 保留 tracker 与真实 Host loadState 的丢失先红；新增大样本首次超过旧单测试 3 秒只是夹具超时，之后仅为这两个新增测试固定 15 秒观察保护，原用例和产品预算不变。修后 tracker 的 90000 行/光标/合法及非法字段、原 checkpoint 拒绝回归通过；Host wiring 110/110 包含 Terminal/Agent 各实际最终文件保存、原 root-local normalization、snapshot 发布与 tracker 逐行恢复，陈旧序号及未知格式仍拒绝。typecheck、checkpoint refresh 通过。

相同 Electron 候选重建后，`.debug/execution-candidate-a2-a3-20260930-snapshot-normalization-fixed` 仅 snapshot-only complete/reopen，`partialSelection=true`、exit 0。主体成功写入仍为 5580102 B/原 SHA256，当前页和真实重开均逐行验证 90002 条前缀内容；当前页断言和重开归档光标均为 `(6,2)`。same execution applied 的 `finalOutputSequence=1396`，保存节点 5767058 B，重开 retained serialized state 5580063 字符、节点 closed/liveSession=false，最终清理通过；没有 OS 全程创建轨迹，不能扩大为整个重开期间绝未创建任何进程。独立只读复核输入/staged/hash/native manifest、主体凭证、不同 Host PID 和断言执行顺序通过。该新单模式通过不覆盖旧四轮 exit 1，也不与此前不同输入的 Runtime 成功合称一次两模式全绿；余下多 reader/慢消费/活跃离开、真实 Agent、A1 和跨平台仍开放。

### 32.11 A4 真实 Host 认证差异的有限定位

`.debug/agent-candidate-a4-20260930-first` 首轮在第一个 Codex 场景的认证检查返回 exit 1、loggedIn=false；尚未执行显式 activate/create，后七场景未跑，模型请求为零。原结果保留。随后只读对照 inherited、isolated HOME、共享环境过滤、过滤加 isolated 四组 `codex login status` 均 exit 0、loggedIn=true；最后一组在 repo、原 HOME、smoke HOME、staged tests、VS Code 安装目录五种 cwd 也通过。`CODEX_HOME` 没有被过滤，`HMIND_API_KEY` 等变量被删除但过滤后的外部对照仍通过，因此不能据此认定凭据缺失或要求放宽 secret filter。原工件没有实际 Extension Host 的目录引用及子进程错误分类，差异根因尚未确认。

下一次运行前限定为原 A4 runner 的 `--auth-only`：新证据目录、一个真实 VS Code Extension Host 内分别执行两种现有 CLI 的只读 auth status，固定每种一次、无重试；首项失败仍采集第二种独立状态，不重新运行八场景。测试入口在 observer、显式 activate/create/reset 之前返回，不执行模型、PTY、Supervisor 或 Webview 产品操作，不计 A4 产品通过，也不以外部 status 代证 Host 可用。

证据仅含显式非敏感目录引用及其与请求值的一致性、Host 的 process.execPath/cwd、严格版本格式校验后的 CLI 版本摘要、wrapper 经 `/usr/bin/env node` 解析的解释器路径/版本、NODE_OPTIONS 是否存在、受限 Electron 公共开关、spawn errorCode/signal/timeout 和固定错误分类。CLI 与解释器原 stdout/stderr 只在内存解析，不保存原文、配置正文、环境全集或任何凭据；认证命令仍沿原配置目录及服务路由。不得通过改 secret filter、复制凭据或重配服务来绕过失败。若此有限证据证明必须提供凭据或改变环境责任，再明确需要的决策；否则只修已确认的夹具/启动差异。代码准备与语法检查不等于实际 Host 定位已完成，结果由独立新工件补记。

真实 `.debug/agent-candidate-auth-only-20260930-first` exit 1，零模型/执行节点。目录引用与请求值相同，NODE_OPTIONS 不存在；实际 Host PATH 首个 node 是 `/usr/bin/node`。Codex 连 `--version` 都 exit 1，Claude 的版本及认证均 exit 0、loggedIn=true。进一步仅只读查询确认 `/usr/bin/node` 为 v12.22.9，对原 Codex npm wrapper 执行 `--check` 得到 exit 1/SyntaxError；前置原已安装 Node v25.6.0 后，经原 npm 入口 `--version` 返回 codex-cli 0.157.1。这将失败定位为真实 Host PATH 选择了不兼容的 wrapper 解释器，不是已证明的凭据缺失。Node 身份探针自身使用 `??`，也不兼容 Node 12；该失败原样保留，不再为诊断探针另开修正/复验阶段。

A4 固定输入相应明确：runner 记录其 `process.execPath`、realpath 和 v25.6.0，Codex 的认证查询仅在继承实际 Host 环境时前置该 Node 所在目录到 PATH；实际 custom launch 经 `/usr/bin/env PATH=<相同值>` 执行原 Codex npm 入口。仍观察 wrapper 与真实 CLI，不绕过 wrapper 直接执行 native binary；剩余 Host PATH、共享 secret filter、认证目录及模型服务路由保持，Claude 不改。PATH 目录值属于显式启动参数证据，不扩大为完整环境归档。下一直接在新目录运行原八场景，首失败即停、最多四次请求模型轮次；不重跑 auth-only，不把本次只读版本检查视为 A4 产品通过。

`.debug/agent-candidate-a4-20260930-node-runtime-fixed` 首场景仍 exit 1，零模型；本次认证已通过，但真实 `node/createRejected` 明确拒绝 `/usr/bin/env` 开头的 custom command，因为正式 `validateAgentCommandLine` 要求以配置的 Codex 命令开头。这是夹具绕开了原custom命令形式的输入错误，不是产品缺陷或再次认证失败；原失败保留，上段 env 前缀方案停止使用。

最终固定输入恢复以原 installed CLI entry 开头的 custom command，不改变既有隔离参数。runner 通过已有 `DEV_SESSION_CANVAS_TEST_CODEX_COMMAND` / `DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND` 传入同一个真实 installed entry，并确认 Codex 与记录的 Node v25.6.0 位于同一命令目录。`CanvasPanelManager.getAgentCliConfig()` 保持该实际命令，`getPrioritizedBaseExecutionPathEntries()` 将这两个目录优先加入真实execution环境，`resolveExecutionEnvironment()` 的 shell patch merge保留其优先级；这些变量不选择fake provider或替换owner，原CLI解析、启动spec、PTY、wrapper与实际provider仍走正式路径。认证查询仍仅对Codex前置已知Node。运行前以现有pure custom parser核对固定四种argv及真实PATH merge helper，再进入原八场景，不靠重新启动模型试错，不修改业务、secret filter或服务路由。

运行前纯核对已通过：从当前 A4 脚本调用实际四种 `launchArguments`，交给正式 `validateAgentCommandLine`，Codex/Claude 的自然结束/停止命令均接受且argv逐项保持；抽取当前 Manager 的两个原PATH方法并调用正式 `applyShellEnvironmentPatch`，在基础及shell PATH均为 `/usr/bin:/bin` 时仍优先原Node25目录、保留系统路径。原 `test-agent-launch-presets.mjs`、两脚本语法及diff检查通过。一次内存构建因未external `vscode` 而失败，补Test枚举边界后纯核对通过，未运行执行进程、模型或VS Code；不以这些纯验证代替待运行A4。

`.debug/agent-candidate-a4-20260930-command-path-fixed` 已执行并保留 exit 1。首个 Codex 场景认证、custom 命令解析与节点创建通过，但等待 live 身份超时；原诊断为 `execution/candidateStartFailed: Execution candidate launch was superseded.`，节点保持 pendingLaunch=start，尚未发布 execution/started 或绑定 runtimeSessionId，观察无 CLI/provider。源码中的首次 candidate replacement 检查以整个 metadata 引用相等判断当前性，等待 Supervisor 时真实页面已更新终端尺寸；需以有限回归确认是否误拒绝正常 resize，同时保留同 ID replacement 和旧绑定保护。后七场景 not-run，不将此次失败写成 CLI 尾部缺陷或 A4 通过。

原 result 的 `requestedModelTurns:1` 仅由 nodeId 已分配推导，不能证明模型调用，原工件保留且该解释撤回。后续报告分别记录计划轮次、观察到的 CLI 和已校验短答，不推断网络请求总数；本轮原启动在 createSession 提交前失败，不能根据创建了画板节点宣称已发送模型请求。该计数修正不改变任何产品断言或首报失败。

### 32.12 候选启动期间的尺寸更新与 owned 输入入口

32.11 的失败现已由实际代码路径确认：Terminal/Agent 的 Runtime 新建在解析环境、准备连接前捕获节点；`prepareExecutionCandidateReplacement()` 对没有前任绑定的节点要求执行 metadata 引用仍相同。真实 `resizeExecutionSession()` 在尚无 session 时只更新 lastCols/lastRows，但该更新必然生成新 metadata，因而正常初次 fit/resize 被误判为替换，`createSession()` 尚未提交。这个缺口同时影响 Terminal/Agent，不限于 Codex 或 Linux 进程语义。

选定复用原 `candidateRuntimeStarts` reservation 记录启动所依赖的 metadata 身份。仅在未提交、原身份仍匹配的真实无 session resize 路径，允许其推进到本次只更新尺寸的新 metadata；提交前仍检查原 operation token、reservation 和该期望身份，并使用最后一次被接受的尺寸构造启动投影和 spec。不删除身份检查，不以字段值相同接纳任意替换，不重新捕获已经变化的配置为基线；已有 live 前任的 strict binding/delete 检查保持。回归在真实等待窗口调用真实 resize 取得先红，覆盖两类执行、最后尺寸、同 ID replacement/配置改变仍拒绝及旧绑定保护。

同次有限入口核对确认 snapshot-only owned 的两类直接产品缺口：`createTerminalAndRunCommand()` 为安装 CLI 排队初始命令，但成功启动后仍走测试专用 drop，原 flush 也只认 legacy session Map；文本粘贴和 Agent 截图粘贴的等待前后同样只检查该 Map，误拒绝真实 owned 执行。修正限于这些原入口识别当前 owned business，沿已有 `writeExecutionInput()` 的实际写回执发送。异步读取剪贴板、确认或图片准备后仍复核原执行身份与可输入状态，不能把旧粘贴送给 replacement；停止/失败要明确结算，不伪报已发送。不构造兼容 process facade、不新建输入服务，也不改变多行确认、图片格式、Terminal 不支持图片或旧 Runtime/stock 路径。

结束条件是原 Host wiring 的有限先红与回归、clipboard/生命周期/typecheck 通过，再用新证据目录继续原 A4 八场景；保留 32.11 原失败，不以单元测试替代真实 CLI。此处属于 B2 生产入口修正，不新增诊断阶段或扩大进程托管范围。

启动尺寸修正已取得原 Host 等待窗口先红，保存在 `.debug/b2-owned-input-launch-resize-20260930-first.log`；两类执行在环境/连接/prepare 返回等待中的合法尺寸更新、最后尺寸进入 spec 与 metadata，以及 replacement/配置/旧绑定保护共增加 14 例，Host 124/124 和 typecheck 通过。首版新负例对本地化 stub 未插值文案的匹配失败另保留，改为核对实际原启动 Error，不放宽产品拒绝断言。

匹配 Electron 候选重建后，`.debug/agent-candidate-a4-20260930-start-resize-fixed` 首个真实 Codex 已启动，使用最后尺寸 112x38，完成短答 nonce、turn.completed、exit 0、同执行 reader applied 和 Runtime completed 无历史。原 wrapper/native CLI/provider 均观察到，失败归档前已消失，未观察到 wrapper 先结束而 CLI 仍活着；精确退出先后仍受采样区间限制。整轮仍 exit 1，后七项 not-run：脚本把两个 `item.type=error` 一律当成工具调用或任务失败，而其正文均为 Codex 明确报告用户 `config.toml` 中 `disable_response_storage` 不受支持并被忽略。后续仅精确允许这一条已知非致命配置告警，仍要求正确 nonce、完成事件和零工具记录，其他错误不接受；原配置、服务、输入、原失败与原始记录不改。这个分类修正不追认原轮通过，尚未执行的页面响应/最终归档断言不补记为已运行。

该轮同时暴露测试模式的证据边界：`resolveAgentResumeContext()` 对所有测试模式 Codex 无条件写 fake-provider 恢复元数据，虽然实际执行和进程身份确实是安装的真实 Codex，并非 fake executable。原证据保留这一差异，不宣称已验证生产恢复策略；真实 CLI 验收应只对实际 fake-provider 命令使用该测试分支，真实命令沿原生产恢复上下文，不新加绕过 flag 或改服务配置。

具体沿已经解析的 `configuredCliSpec.command` 传入 resume resolver，仅当测试模式且 `looksLikeFakeAgentProviderCommand(command)` 成立时保留 fake 分支。真实 Codex 的 start/resume 使用原生产 none/codex-session-id 逻辑，Claude 原分支不变；以真实/fake 两类命令的 start/resume 有限回归验证，不用测试环境本身代替可执行命令身份。

### 32.13 Runtime 传递真实输出结束的处置事实

原 Supervisor 自然关闭的受控 interrupted 用例已证明内部 source 为 `interrupted`、终态内容 applied；只读定向运行原两例（断言未变、内存附加观察）同时确认外部 Terminal/Agent snapshot 分别为 closed/stopped、exitCode=0、finalRevision=1，却没有 source、退出消息或 descriptor。`finalizeOwnedExecution()` 只看应用结果和进程结果，`toSnapshot()` 未传 source，Host completed 又清空 lastRuntimeError。snapshot-only 已保存 seal 中非 EOF 的错误/提示，Runtime 丢失该事实。这是既定 B2/A3 退出完整性的直接状态缺口，不证明本例已经丢弃成功接收的内容，也不能把 applied 改解释为真实 EOF。

选定在 Runtime snapshot 增加可选 `terminalSourceDisposition`，复用已有 `SourceDisposition` 的 eof/interrupted/error/unknown 及 reason。只从原 execution 实际 seal 投影 kind/reason；尚未封口或旧 snapshot 缺字段保持未知，不因 live=false、finalRevision 或超时推断 EOF。Supervisor 对非 EOF 用原 message descriptor 机制发布明确可本地化的 incomplete 提示；Host completed 保留对应 lastRuntimeError/lastExitMessage，当前页面提示仍在终端正文之外。进程状态、最终 revision、已接收内容 applied、每个 reader 回执和资源释放分别保留，不将正常用户 stop 的中断伪装自然完整，也不把已应用内容一律改成失败。

回归覆盖两种执行的 EOF、三种非 EOF、活跃未封口和旧缺字段，并验证 Host 轻量 completed 保存/重开仍保留提示、不恢复历史。保留原自然超时/迟到结算断言与全部历史结果；只补协议、Supervisor、Host 和既有本地化的事实传递，不改 provider 读写、取消时间预算或增加诊断 RPC。真实 A4 自然场景应检查实际 EOF，停止场景保存真实处置而不要求伪造 EOF。

### 32.14 A4 v18 真实 Agent 八场景有限结果

证据目录为 `.debug/agent-candidate-a4-20260930-source-fixed-v18/`。Codex/Claude、live-runtime/snapshot-only、natural/stop 的八份 `artifacts/result.json` 均为 `pass:true`，各场景 `cliObserved:true`、`automaticHarnessRetries:0`。四个自然场景的短答已验证；四个停止场景沿原产品停止入口完成，不请求模型任务。范围是 Linux 的实际 VS Code/Electron Host、真实 CLI、candidate owner 和真实 Webview，不是 fake Agent 或仅受控 Host 方法。

四个 live-runtime 场景完成后的 `completed-runtime.json` 均为 `bindings:[]`、`pendingRuntimeSupervisorOperationCount:0`，原 candidate registry 的 sessions 为空，轻量 completed 节点不留 Runtime 正文或绑定。registry 在 legacy-detached/systemd-user 查询结果中可能来自同一 storage 文件，不能将重复列出的空 registry 解释为两个实际 backend 均运行通过；本轮实际 hello 为 legacy-detached。snapshot-only 仍按既有最终保存语义验收，不把它改成 Runtime completed 历史。

自然完成的 `sourceEofClaim` 保留为“requires product source evidence; not inferred from exit”，不从 exitCode、最终 revision 或已应用内容推断 EOF；stop 场景明确为 `false`，不追认为自然 EOF。Codex 已知 `disable_response_storage` 不受支持并被忽略的配置告警仍归档，只按 32.12 的精确非致命分类处理，不改用户配置，也不放过其他 CLI 错误或工具记录。`plannedModelTurns` 与已校验短答分别记录，实际网络模型请求总数仍为 `not observed directly`。

本轮只关闭上述固定 A4 Linux 八场景的有限验证项。它不代证 A3 独立大尾部、A5 十会话容量、真实活跃宿主离开、所有包装启动链时序、其他平台、分发或默认生产准入；没有将旧失败追认为通过，也不与其他输入的 Terminal 结果合称一次全量通过。A1 v4 的首档回显观察失败和未冻结预算独立见容量重评第 10.9 节，整体退出完整性仍未完成。

### 32.15 A4 source-eof 复验结果

随后使用 `.debug/a4-real-agent-20260930-source-eof-rerun/` 对同一八场景输入进行 source disposition 复验。Codex/Claude、live-runtime/snapshot-only、natural/stop 八场景均为 `pass:true`、`automaticHarnessRetries:0`，实际 CLI、candidate owner、Host/Webview 和清理观察均无 failure；observer 没有 failure，cleanup 的 `forcedSignals` 为空，四个 live-runtime 场景以及四个 snapshot-only 场景的 cleanup runtime bindings 均为空、pending Supervisor operations 为 0。

四个 natural 场景均取得产品 source evidence，`completed-events.json` 的 `sourceDisposition.kind` 为 `eof`；这一次修复了 v18 中“自然结束只保留需要 source evidence、尚未在真实 A4 中核对”的剩余验收项。四个 stop 场景仍按产品 stop 记录 `sourceEofClaim:false`，不能因为底层 source 在停止后关闭或事件中出现 `eof` 就把主动停止改写成自然完成；进程退出、已应用正文、source disposition 和清理事实继续分账。

本次复验同时确认所有场景没有 `forcedSignals`、process failures 或残留 Runtime binding，但这只覆盖该 Linux candidate 的八场景有限责任；不外推为 A3 大尾部、A5 十会话容量、A1 正式预算、真实跨平台、分发或默认启用通过。v18 目录、原始失败和本次复验均保留，不能用新 exit 0 覆盖历史证据。

### 32.16 B2/A1 显式准入策略

只读核对确认 `ExecutionAuthority.reserve()`、`ExecutionOwnerLifecycle.reserve()` 和 `CanvasPanelManager.startNonNativeHostExecution()` 的最终保存责任各自硬码 `S1_LIMITS.executions=2`；`beginStart()` 的 starting=1 是拒绝并发 acquire，不是排队。该有限候选策略不能解释为正式产品两会话上限，也不能只改一处常量开展十会话验收。

选定在现有 owner options 注入不可变 `admissionLimits: { executions, starting }`，authority、owner 与 Host 最终保存占槽使用同一份正整数策略，starting 不超过 executions。省略时保留原 2/1；Linux factory 显式传递并冻结策略，现有未显式选择的实际候选行为不变。十会话验收将显式提供容纳固定负载的策略，该实验数值不是产品上限，正式部署 N/Q 仍须实际资源模型论证；本次不引入用户配置、动态 RSS 调度器、隐藏排队或自动重试。

preparation、活跃执行、关闭中、未结算 reader 和 snapshot-only 最终保存责任继续占账。首个 unknown 后新准入停止，旧责任/旧代不可用更换策略清空；已有会话安全消费继续，sticky quarantine 和旧 live metadata 绑定保持。单会话 wire/帧/信用、source/reader/退出预算不变，不借准入调整裁剪尾部。验证限于真实模块的默认兼容、策略校验/冻结、非默认容量与启动数、保存占槽、获取前拒绝和 unknown 停排，再接原实际多会话验收。

实际十会话输入通过已有候选构建入口显式选 `--execution-admission=10:1`，仅允许与原 profile/assets 一起使用，两个正安全整数由相同规范化规则校验。编译期常量在 Host 和 Supervisor 的同一 Linux factory 生效，运行时不读取测试环境变量、不新增用户配置，省略仍为 2/1。数值只标识本次固定候选验收产物，不宣布正式产品最大十会话；stock 构建不启用候选或继承该参数。输入摘要保存实际构建选择，原 generation/旧 live 不变，实验仅使用新建隔离 storage。

实现已落在 `executionLifecycle.ts`、`executionSessionAdapter.ts`、`executionOwnerLifecycle.ts`、`linuxExecutionOwnerFactory.ts`、`CanvasPanelManager.ts` 与 `scripts/build/build.mjs`。candidate 构建把同一策略编入 Host/Supervisor，保存 `dist/execution-candidate-selection.json`；容量 runner 在启动前核对 profile 与 N/1 并冻结产物 hash。省略参数和 stock 选择保持既有行为，authority/options/owner 共用冻结值。Host 测试以十槽验证九个 live 加一个未完成最终保存会在 transport 获取前拒绝下一次新建，原保存完成后才准入；改前失败保存在 `.debug/b2-admission-host-before.log`，修后 Host 145/145，adapter 98/98、owner 46/46、factory 25/25、build selection 9/9 及 typecheck 通过。

容量改动前的实际 A4 回归 `.debug/a4-real-agent-20260930-capacity-regression/` 八例 exit 0：四个 natural 为实际 `sourceDisposition=eof`，stop 不申报 EOF；清理没有 forcedSignals/process failures，Runtime bindings 和待处理操作均归零。该轮使用准入改动前 dist，不作为新 admission 产物的原生覆盖。十 Terminal 的源、九个 peer、预算和有限覆盖边界见容量重评 10.10；它不替代真实 Agent 或 A1 至 A6 其他格子。

新 admission 产物的固定十 Terminal 已在 `.debug/a1-ten-session-20260930-probe-fixed/` 取得 color/size 完整 exit 0，内容、每例 27 次响应、运行前全部资源预算及 cleanup 通过，最大交互 1365.5/1323ms；实际数据见容量重评 10.12。此前 `.debug/a1-ten-session-20260930-first/` 和 `reader-fixed/` 分别暴露测试 probe 发端/协议接端两 reader 上限，原 exit 1/cleanup 通过保留，仅修服务于既定输入的观测与清理。1280 两例虽有追赶重叠，但 reader 未重建；下一固定 A1/A2 按容量重评 10.11 验证真实 Host 消失期间产出及新 Host 原绑定恢复，不把本轮十 Terminal 外推为十 Agent、离线恢复或产品最大会话数。

复验后的主线静态/定向回归为 Host wiring 144/144、Supervisor wiring 90/90、protocol 与 localization 检查通过，并再次通过 typecheck；这些只证明本次 source disposition 接线和候选边界未破坏既有接口，不扩大 A4 的平台或容量范围。

### 32.17 A5 平台接入现状与真实 Agent 认证边界

2026-09-30 只读核对确认，主仓库目前交付的 candidate 仍只有 Linux x64/glibc，而不是已有全平台实现只缺 runner。`native/linux-execution-owner.h` 明确要求 `__linux__`；`src/panel/linuxExecutionProvider.ts` 与 `executionProviderTransport.ts` 拒绝其他平台；`linuxExecutionOwnerFactory.ts` 校验 Linux x64、实际 glibc/Node 或 Electron 资产；`scripts/build/linux-execution-candidate-assets.mjs` 只生成对应 Linux 目标。`src/supervisor/runtimeSupervisorNamespace.ts` 使用 Linux abstract socket 与 uid/realpath 定义持有期，要求 Linux/Node >=20.8，不能直接搬到 macOS/Windows。这些路径均相对 `extensions/vscode/dev-session-canvas/`，只有 `scripts/build/` 位于仓库根。

独立 `runtime-exit-integrity-native-candidates` 工作树保留的 macOS baseline/failure 与 Windows HPCON owner 是冻结诊断接口及原始实验，不是当前 `execution-lifecycle-v1` 产品 provider。主仓库 `.github/workflows/runtime-exit-integrity-native.yml` 运行 Node 22 的 stock node-pty/builtin ConPTY 诊断；即使旧三平台任务通过，也不能代证新的 candidate、实际 Host/Webview 或 packaged 路径。旧诊断源码、断言和失败结果保持，不改造它们来追认产品通过。

已获授权的 GitHub runner 可承接既定 Terminal/native 验收，不需要再次把 runner 可用性当作未获批准的全线阻塞。剩余 A5 工程责任仍是为 macOS/Windows 接通实际产品 provider、资源与退出语义、namespace 排他、匹配 Node/Electron 构建及 packaged 入口，再在对应真实 runner 运行原必要验收；不能只删除 platform guard 或把 Linux binary/诊断 API 冒作产品实现。Windows 主体退出与其进程对象仍被合法句柄引用继续分别判定，不为了对象消失擅自关闭其他进程的句柄。

本轮只读查询 `gh secret list` 的 repository secrets 仅见发布用途条目，repository environments 查询为空；这只说明当前没有可用真实 Agent CI 认证配置的证据，不证明所有组织级凭据或自托管环境不存在。未读取、上传或复制本机 CLI 登录内容。主会话已向用户提出一项具体外部选择：由用户配置专用 CI 测试凭据到 GitHub Secrets 并限制用量，或提供已登录真实 Codex/Claude CLI 的 macOS/Windows self-hosted runner。不得要求用户在对话发送 token，也不把本机现有登录凭据上传 GitHub；未选定前不擅自创建服务账户、改变凭据用途或安排有新费用责任的认证。

该待输入项只决定跨平台真实 Agent 的执行位置与认证方式，不阻塞已有授权的 Terminal/native runner 工作、无凭据的平台产品接入或当前 Linux A1/A2。真实 Agent、两模式、Webview、跨平台和尾部要求均未削减；未知认证不标通过，也不追加通用诊断工具前置或新的研究计划。本节仅记录本轮只读平台/认证核对，不包含新 macOS/Windows product build、runner 运行或跨平台通过结论。

### 32.18 A1/A2 真实冷恢复的直接验收阻塞

本节保留优化前的失败和当时决定；当前修后有限结果见 32.19，不能把这里的 exit 1 追改为通过。

`.debug/a1-host-reconnect-20260930-resize-ready/` 与 `.debug/a1-host-reconnect-20260930-tail-observed/` 已结束且均为 runner exit 1，不再是运行中。后者保存了明确的冷恢复尾部观察：原 30 秒追平截止到达时，真实 xterm 仍只到 1404/2560 块，正常缓冲区尺寸 112x28、光标 `(42,27)`。旧 Host 已退出，离线 `offline-output.json` receipt 记录 2560 块、26214425 bytes、SHA256 `0167208c8b0fcf6bd465c0c19064d3f7584429ef32e4cbb2841f1e147ee5ed98`，原 Supervisor/provider/主体身份不变，恢复沿同 session/authority 且取得新 reader。这些是有限通过的前置事实，不是恢复内容完整性的通过。

失败发生于 `reconnect-catchup`，B 输入交互、重连后的独立 journal 来源校验及自然完成 no-history 检查均未到达，不补记通过，也不拿 receipt 的来源 hash 代替尚未执行的 journal hash。该轮 reconnect/cleanup/outer 三份清理均 pass，outer `forcedSignals=[]`；自有空闲 Supervisor 正常停止不等于强杀主体。更早 `first`、`rss-identity-fixed` 的失败、首报覆盖局限和 raw log 保持。本轮已是固定产品恢复时限的直接失败，不能继续仅按测试探针问题归类或增大期限抹绿。

静态核对确认 `src/supervisor/runtimeSupervisorMain.ts` 的 `readTerminalPage()` 每次请求都新建 `journal.readEventPagesAfter()` iterator，取得一页即退出；`src/supervisor/terminalSessionJournal.ts` 的扫描为每个 64 KiB 页完整校验相关约 4 MiB segment，重复解码、JSON 与 hash。该结构造成可疑读/计算放大，但尚未量化为全部 30 秒耗时或证明唯一根因。下一拟实施有界顺序读的直接优化，不缓存完整历史、不削减现有页/在途限制；必须维持每个冻结 segment 在首个相关页发布前完成整段校验，以及未消费尾部损坏/篡改检测、身份/取消/compact 边界。具体实现与这些正确性要求仍待定向回归和同一真实重连输入验证，不宣称方案已生效，不扩大成诊断框架或新工具前置。

### 32.19 A1/A2 有界读取后的真实重连结果

容量重评 10.13 的有界索引读取已接入 journal、Webview reader cursor 和独立 Host subscription，不再处于拟议状态。每个 reader 只保留最近一个已完整校验冻结 segment 的记录偏移/长度/可信 checksum，不常驻整段正文或完整历史；新 reader/冻结段变化仍完整校验，后续页按偏移读取并复核可信摘要，单页结束释放句柄/读取保护，取消、错误与退役清除索引。冻结段首个相关页发布前的完整校验及尾部篡改检测保留，不借优化缩小 scrollback、增大页或减少完整性断言。

匹配新 2/1 Electron 构建的 `.debug/a1-host-reconnect-20260930-indexed-pages/` 按原 10.11 输入完整 exit 0。新 Host ready 为 1422.291ms，完整保留后缀应用为 14431.416ms，ready 后追平 13009.125ms；原 30 秒界限不变。旧 Host 已消失，原 Supervisor/provider/主体身份和 backend/storage/session/authority 保持，两个 Webview reader 均为新身份。B 新 nonce 实际应用耗时 32.6ms；此时 A 已到 2560 块，因此 `catchupInteractionOverlapObserved=false`，不宣称真实离线追赶期间的交互已覆盖。

本轮实际到达独立 journal 重放：source 26214425 bytes、SHA256 `0167208c8b0fcf6bd465c0c19064d3f7584429ef32e4cbb2841f1e147ee5ed98`、lastRevision 6499、validator 拒绝原因为 `color-state`。完整允许保留的 xterm 后缀、自然 closed/no-history、reconnect 与 outer cleanup 均通过，outer `forcedSignals=[]`。这与先前只有 receipt 的来源证据不同；四轮 `first`、`rss-identity-fixed`、`resize-ready`、`tail-observed` 的 exit 1、首报覆盖局限及清理分账原样保留，不合并为首次全绿。

同轮测试维护只修既有夹具失配：Supervisor 协议脚本的旧静态 regex 只接受直接 return，而 HEAD 已是 await fresh snapshot、复核 admission 后返回；改为严格检查实际顺序，原失败 `.debug/journal-index-supervisor-protocol.log` 与修后 `journal-index-supervisor-protocol-attach-assertion-fixed.log` 分开，完整脚本通过。Webview 夹具缺少两个既有 global 的首败保留，补齐后 controller 39/39、Host batch 10/10 通过。它们不是新工具门槛，也不替代新 candidate 或真实 Agent 证据。

同一新 2/1 candidate 的 A4 `.debug/a4-real-agent-20260930-indexed-pages/` 已完整 exit 0，Codex/Claude × Runtime/snapshot-only × natural/stop 八场景的 schedule 均为 passed、`result.pass=true`。四个 natural 的 `naturalResponseVerified=true`，`completed-events.json` 中对应 Runtime/Terminal source disposition 均为 `eof`；四个 stop 的 `sourceEofClaim=false`，不追认为自然完成。Claude stop 实际停在 CLI startup/auth 等待界面，只证明该真实启动状态可停止，不宣称已完成模型任务。八份 cleanup 均为 bindings=0、`process.failures=[]`、`forcedSignals=[]`。这一次覆盖新的准入/索引产物；旧 capacity-regression 仍只对应改动前 dist，原记录不覆盖。

本轮 Host wiring 145/145、Client 28/28 也已通过。当前关闭本机固定两 Terminal color 离线重连的具体阻塞，并补齐同构建 Linux A4 八场景有限回归；不外推 A3 独立大尾部、全部 F-04/A1 至 A6、真实离线追赶交互重叠、其他平台或正式分发准入，不因通过再追加通用工具阶段。

### 32.20 真实 Agent 的 DeepSeek CI 接入方案

2026-10-01 用户已选择专用 CI 模型凭据路线：保持真实 Codex 与 Claude Code CLI，把两者的模型后端统一到 DeepSeek，不替换为假 CLI、受控 provider 或模型能力测评。GitHub API 于 `2026-10-01T02:57:24Z` 确认 repository-level `DEEPSEEK_API_KEY` 的名称与 metadata；本轮不配置 Environment 或分支限制，不读取 secret 内容到对话/仓库，也不复用或上传本机 CLI 登录目录。该新输入解除 32.17 当时待选的认证路线，不改变当时查询事实，也不追认旧 runner/旧 CLI 已使用此后端。

有限实施复用 `.github/workflows/runtime-exit-integrity-native.yml`，以显式 manual input `real_agents` 选择 Agent candidate 路径，既有三平台 stock node-pty 诊断保持独立。第一条 Agent 路径只针对 Linux x64/glibc，固定 Node 25.6.0、Codex 0.157.1、Claude Code 2.1.280、VS Code 1.117.0 与 Electron 39.8.7，构建并装载匹配 Electron ABI 的候选原生产物。沿 `scripts/smoke/run-vscode-agent-candidate.mjs --backend=deepseek --ci-report agent-ci-report` 和 `tests/vscode-smoke/agent-candidate-tests.cjs` 复用 Codex/Claude × Runtime/snapshot-only × natural/stop 八场景、真实 Host/Webview/owner 与原清理规则，不新增独立测试框架或默认启用候选。

DeepSeek 官方接口提供 Codex 所需的 Responses 路径和 Claude 所需的 Anthropic 兼容路径；依据为 [Codex 接入说明](https://api-docs.deepseek.com/quick_start/agent_integrations/codex) 与 [Claude Code 接入说明](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code)。本次固定模型 `deepseek-flash`，Codex base URL 为 `https://api.deepseek.com/`、`wire_api=responses`，Claude base URL 为 `https://api.deepseek.com/anthropic`。这些非敏感输入连同 CLI 版本写入摘要，不以 CLI 产品名称暗示使用 OpenAI/Anthropic 模型。文档只建立可实施依据，不代证固定版本的参数、响应格式和启动配置已经兼容；先用假 key 的无模型请求 probe 核对配置解析，不把它记作认证成功。认证预检识别显式 custom provider，只报告配置已解析/未联网认证，不要求官方 `login status` 来证明此后端可用；实际 natural 成功响应才支持凭据有效。首次不兼容须记为原失败，沿具体入口修正，不自动换 CLI 版本、后端或放宽完成断言。

凭据只在显式 Agent 执行 step 注入，安装、构建与无凭据诊断 step 不取得该值。在 runner 临时目录创建本轮独立 CLI 配置，目录权限 `0700`、文件 `0600`：Codex 的临时 config 使用自定义 provider 的 `experimental_bearer_token`；Claude 通过显式 `--settings` 指向私有配置文件，其 `env` 保存所需 token/model/base URL，保留 `--safe-mode`。真实 CLI 从该配置读取允许的后端认证，不把 key 放到命令行、节点 metadata、终端输入、日志或原始工件。只有明确选定此 CI backend 的测试入口可以读取 `DEEPSEEK_API_KEY`，随后仅向本轮 CLI 配置交接，不向普通 Terminal 或通用 smoke 环境开放。原 `vscode-smoke-runner.mjs` 的 secret filter 保持不变，不增加通用 env 白名单；固定 CLI 若不接受上述配置，按实际兼容失败修订本节后再改接线，不能全量传递环境或复制 HOME。私有 credential 配置由测试入口主动 dispose，失败也进入该清理路径；raw evidence、日志和临时 HOME 只保留于 runner 本地并随临时 VM 销毁，不上传，也不声称已逐项主动删除。

远端 artifact 只允许预先固定字段的 summary：版本/构建身份、非敏感后端配置、场景状态、请求轮次口径、自然响应断言、source disposition、Webview 最终应用与清理布尔结果；不上传 raw terminal、完整错误对象、任意 CLI 输出、临时 HOME 或认证文件。发布前在持有本轮 key 的受限步骤对待发布摘要执行内容扫描，命中或扫描失败即不上传，不依赖 GitHub 自动 masking 作为唯一保护。workflow 只有在安全 summary 已写完、执行步骤产生 `report_ready` 输出时才上传；执行或准备步骤失败保留失败状态，不兜底上传 raw，也不承诺每次失败都有可发布 artifact。

第二轮首败显示现有 `model-or-protocol` 宽分类无法区分 metadata warning 与实际请求失败。本轮仅扩展上述固定摘要，允许保存 CLI `turn.completed`/`turn.failed` 的观察布尔值、预期 nonce 匹配布尔值、`missing-model-metadata` 固定分类，以及从 first-failure 事件提取的真实 source disposition；没有对应事实时保持未知，不依据自然退出或 cleanup 推算 EOF。实际报告已加入 `cliEvidence` 五布尔 `turnCompleted`、`turnFailed`、`expectedResponseInOutput`、`lastMessageMatches`、`modelMetadataFallback` 和 first-failure source，定向测试通过。这些字段仍经过同一 key 内容扫描，不发布原始消息、响应正文或凭据，不放宽现有严格断言，也不新增诊断框架或通用工具门槛。

第三轮 snapshot-only stop 失败发生于 raw 输出保存前，现有枚举不能定位具体断言。本轮下一必要补证仍只扩现有固定摘要：从已保存 first-failure stack 提取 `agent-candidate-tests.cjs` 的固定文件名/行/列，不发布完整 stack 或消息；从 `first-failure-snapshot` 中按该次原节点身份提取状态枚举、exit code、最终序列化快照是否存在及 UTF-8 字节数、输出序列；从该次失败事件提取匹配原节点/执行的 reader 结算是否存在。缺失字段保持未知，只发布枚举/布尔/数值，不发布节点名称/ID、快照正文或任意路径，并经过原内容扫描。first-failure 的内存/诊断快照不冒充正式持久化文件读回；source EOF 也不替代 reader 应用/保存成功。此范围只为锁定本次失败断言，避免盲目重跑，不改业务、原断言、期限或新增工具框架。

本地假 key/loopback 受控复现确认一个实际配置缺口：固定 Codex0.157.1 在没有 model catalog 的配置下，即使回环服务返回成功 SSE、CLI exit0、最终 nonce 匹配并出现 turn.completed，仍 emit 缺模型 metadata 的 item.error，导致原 `verifyNaturalResponse` 严格断言拒绝。该证据说明本轮 CI 配置需要完整模型 metadata，不说明远端那 586 bytes 的内容，也不把远端 failure 追认为模型响应成功。选定窄修是在本轮私有配置目录生成只含 `deepseek-flash` 的最小 model catalog，使用官方单模型能力值，由 `model_catalog_json` 引用，config 同时指定 `forced_login_method=api`、`model_reasoning_effort=high`。该固定版本要求 `base_instructions` 或 `model_messages.instructions_template` 非空，故仅使用固定短句 `Follow the user instructions.`，不复制长模板或改变测试任务。官网的 `preferred_auth_method` 被该固定版本报告 ignored，故不机械照搬；实际认证仍沿现有私有 provider token。修正只在测试接入配置，不改业务模块、CLI/模型/期限/沙箱，也不忽略/删除原 warning 断言。最终用实际 helper 生成文件、仅将私有副本 endpoint 改为 loopback 的固定 CLI 复验取得 exit0、正确 finalMessage，事件只有 thread.started/turn.started/agent_message/turn.completed，无 item.error，原等价严格断言通过；请求使用 reasoning.high/text.verbosity.low。全部 probe 临时 HOME、stub 和脚本已清理，report/helper/workflow 定向测试复验通过。这是本地受控配置修正证据，不是 DeepSeek 服务或远端 CI 通过。

自然四场仍必须由真实 CLI 请求选定后端并取得目标响应，随后核对主体退出、实际 source EOF、Webview 已应用尾部和两模式保存/无历史规则，cleanup 不得残留绑定或失败。停止四场仍经产品 stop，主动取消不能伪报自然 EOF；尚处 CLI startup/auth 界面只能按实际覆盖登记，不宣称已完成模型任务。沿原固定自然/停止期限、最多四个自然请求轮次及不自动重试的 harness 规则，不通过延长时限或重复直到通过消解不兼容；provider 内部传输尝试不由 CLI 调用次数推断。

此增量结束条件是受限 CI 入口可执行，固定版本实际八场景结果及安全摘要/清理能够被独立核对。`60cdcc7a` 已提交并推送到当前 refactor 分支，DeepSeek 配置、摘要发布和 workflow 接入已实施；`test-agent-candidate-deepseek.mjs`、`test-agent-candidate-ci-report.mjs`、`test-vscode-smoke-runner-env.mjs`、`test-runtime-agent-ci-workflow.mjs` 与 typecheck 通过。已安装固定 CLI 的假 key probe 中，Codex `features list` 与 Claude 保留 safe-mode、显式 settings 的 `auth status` 成功，全部 probe 临时目录已删除；这只验证解析/启动配置，不是联网认证或模型响应。

首次 GitHub run `36809595428` 使用 `60cdcc7a`，在 Ubuntu24.04 的依赖/sandbox 准备步骤发生 bwrap uid map `Permission denied`，整轮 failure 保留。后续 locked dependencies、CLI 安装、candidate build 和 secret 验收均 skipped，零模型请求；不是 Agent/PTY 产品失败或已证明的系统 bug。后续选择 Ubuntu22.04，与既有本机 glibc 基线更接近，保留 bwrap 与 CLI sandbox，不关闭系统安全策略、不改原期限和断言。首次提交仅包含 CI 接入，当时已验证的索引读取、准入及 source EOF 产品改动仍在工作树；这些已在 `69bf93b6` 以 31 文件冻结，含此前两个未跟踪容量 fixture。只读核对四个 dist SHA 均与 A1/A4 indexed-pages 工件匹配，sourcemap 的 133 个项目源码项无漂移；十项定向回归通过，包括 Host145、Supervisor92、Webview39/Host10、lifecycle46、adapter98、selection9、factory25、journal、credit、protocol，typecheck 通过。这证明新冻结源码与既有产物/定向验证的关系，不把首次不完整输入追认为通过。

第二轮 run `36810562601` 使用完整输入 `37bdf12b`，Ubuntu22.04 的 sandbox 准备、安装、CLI 和 candidate build 均通过，实际验收首场 `codex-live-runtime-natural` failed，后七场 not-run，整轮 failure 保留。安全摘要为 `.debug/agent-ci-36810562601-summary/summary.json`：`cliObserved=true`、`configurationParsed=true`、预检 `networkAuthenticationVerifiedByPreflight=false`、`naturalResponseVerified=false`、`sourceDisposition=null`；cleanup 的 bindings/failures/forcedSignals/remainingActiveProcesses 均为 0。收到输出为 586 bytes，发布只含长度/SHA256 `00e5b5ba053ce6543870f7c056b9adb1cbf857d765be383fa74977f575d79029`，没有 raw 正文。`diagnosticClasses=[model-or-protocol]` 不足以确定该远端样本是真实请求失败、metadata warning 还是其他协议问题；`plannedModelTurns=4` 只是原矩阵计划值，不能写成已完成四次请求。随后本地 loopback 证明的配置缺口及选定窄修见本节，但不还原或重判该远端原结果；F-04、A3 大尾部、完整 A5 和跨平台产品 provider/namespace/分发均未关闭。

第三轮 run `36811935908` 使用 `8e081c19`，安全摘要为 `.debug/agent-ci-36811935908-summary/summary.json`。Codex 的 Runtime natural、Runtime stop 和 snapshot-only natural 前三场 passed，两 natural 的 `naturalResponseVerified`、`turnCompleted`、两个响应匹配布尔均为 true、`modelMetadataFallback=false`、实际 source=eof，全部原场景断言通过；这证明配置修正已在两个真实 DeepSeek 自然场景中有效，不还原第二轮原文或改变其 failure。第四场 snapshot-only stop failed，`cliObserved=true`、first-failure 的 `sourceDisposition=eof`，但 `receivedOutput=null`、五个 CLI 证据字段均 null、diagnosticClasses 为空，具体失败断言尚不能由此确定；四个已运行场景的 cleanup bindings/failures/forcedSignals/remainingActiveProcesses 均为0，Claude 四场 not-run。stop 的实际 EOF 只是源处置事实，不把主动停止写成自然完成或将失败场景追认通过。当前按本节固定 first-failure 摘要补证继续定位，三轮原始结果全部保留，不关闭总体 A4/A5 或产品重构。

第四轮 run `36812745671` 使用 `736f9ddd`，安全摘要为 `.debug/agent-ci-36812745671-summary/summary.json`，整轮 success、八场景 passed。四个 natural 均 `naturalResponseVerified=true`、预期 nonce 匹配且实际 source=eof，原 Webview、两模式持久化/无历史与全部场景断言通过；Codex 的两 natural 同时保有 turn.completed、finalMessage 匹配和无 metadata fallback，Claude 使用自身 result 格式，不要求冒造 Codex 事件。stop 四场按主动停止登记：Codex Runtime 的 source=eof，Codex snapshot-only 为 interrupted，Claude 两模式均 eof；source 关闭不把它们改写为自然模型任务完成。八份 cleanup 的 bindings/failures/forcedSignals/remainingActiveProcesses 全部为0。该结果实际证明本次 repository Secret、临时配置与真实 Codex/Claude + DeepSeek 的固定 Linux/Electron 八场景可用，预检本身仍不承担联网认证证明。

第三轮 snapshot-only stop failure 在第四轮没有复现，但两轮之间只改报告与文档，业务、CLI 任务和原断言未变，因此没有已修复该失败的因果证据。独立核对两轮十个 buildHashes，只有 report 脚本变化，其余九项含四 dist、runner、原 test 和 helper 均一致，run/SHA 也已核实。固定 first-failure 定位字段虽已接入，第四轮全绿没有新的失败位置，第三轮 root cause 仍未知，继续作为 A4/A6 的具名间歇失败保留；不能以第四轮 success 追认第三轮通过，也不自动增加 CI 循环求再现。当前工程顺序回到既定有限清单中的剩余产品组合、B3 状态替换、平台接入/分发和最终准入，结合与该失败直接相关的既有实现路径作必要定位；不重排全部历史待办或扩诊断框架。Linux 有限八场景完成不关闭 F-04、A3 独立大尾部、完整 A5 或 macOS/Windows 产品验收。

### 32.21 A6 非 root 重置的提交身份复核

`b163ee7d` 上新增的两例实际 Host 入口回归已先红，原38次生命周期回归先通过。单根 `resetState()` 与非 root `applyCanvasTemplateRecord(..., {reset:true})` 在真实 `prepareForHostBoundary()` 返回之后、外层续体提交之前，经真实 `startTerminalSessionWithSupervisor()` 接纳同 ID 新执行；旧调用仍成功并保存/发布不含新节点的状态，新 session/binding 却保留。原日志 `.debug/a6-non-root-reset-original-red-20261001-01.log` 保留。这是受控 Host 方法顺序的产品缺陷证据，不代证真实磁盘、native 或 UI。

选定与32.5一致的提交前身份复核：在非 root 清理前固定节点 ID/kind 与 session、owner、record、待启动和 Runtime binding 身份；允许本次清理移除原责任，但发现新增节点或新执行身份时，在 state replacement、persist/post 之前中止旧重置，保留当前执行。两入口一起调整，正常无冲突重置仍须成功。不得为完成旧重置再杀新执行，也不回滚已成功的原删除；不引入全局锁、drain 或通用事务框架。其他 root 和完整 reload 验收不由本次定向回归代证。

同一外层提交窗口还有实际callback先红，原日志 `.debug/a6-non-root-completion-original-red-20261001-01.log`：真实新client epoch接纳同ID新执行，实际completed callback移除session/binding后等strict delete，此时pendingCallbacks=1。`resetState()` 的既有callback检查会中止，但非root模板没有该检查，仍覆盖completed节点并保存/发布。非root模板在boundary返回后须同时复用 `assertRuntimeSupervisorStateCallbacksSettled()` 与身份复核；不把身份集合为空误认为在途责任已结束。

最小修正已实施，共享 `captureCanvasResetIdentity()` 复用原root保护，两个非root提交点新增检查，模板同时补callback屏障。原38次加新8次生命周期回归全部通过：两入口各覆盖新执行保留、正常成功、strict失败保留及completed删除在途；Host wiring145/145、typecheck/localization通过，独立复核及复跑未见确定阻塞。原先红和中间夹具断言失败不改，最终日志 `.debug/a6-non-root-reset-and-completion-fixed-20261001-01.log`。这是受控Host方法证据，完整reload、多根及实际UI仍不由此代证。

同一A6有限清单的下一局部验证不重开全部等待点：在原 `test-runtime-host-deactivation-integrity.mjs` 的旧delete等待窗口，Terminal/Agent各一例通过真正 `start*WithSupervisor()` 接纳replacement，取代只写map的代证，仍核对最终保存/消息/reader/绑定。再以一例reset等待strict delete时并发正式 `prepareForDeactivation()`，核对永久离开、保存及旧callback责任；先记录实际结果，未复现前不预设业务缺陷或新增全局锁。现有root A失败/B输出注入仅证明Host入口隔离，不是实际Webview交互；测试专用reload方法也不是 `workbench.action.reloadWindow`。真实多根/Host reload验收继续独立保留，不把这三例局部通过计作整个A6完成。

该三例首轮在未改业务时两绿一红，原46例保持通过，日志 `.debug/a6-finite-entries-original-20261001-01.log` 保留exit1。Terminal/Agent实际start replacement均被原身份保护；但reset等待strict delete时，正式preserving deactivation绕过 `strictRuntimeMutationBoundary` 并成功返回，释放原delete后reset仍保存/发布空画板。永久callback gate当时已关闭，故缺口是已进入的旧续体及错误的永久成功声明，不是callback入口。

选定窄修同时处理这两个事实：永久离开一开始封闭原事件/执行准入；若开始时已有strict mutation，普通路径保留首次拒绝，带owner报告路径将相关域记为未确认，不能只等部分Core就宣布已结算。原delete继续沿原绑定执行并保留真实结果，不重发、不补造取消，也不将外层reset放入它自身等待的pending集合。非永久boundary每次已有等待点之后及reset/template既有提交复核点检查永久关闭，不允许旧续体继续清maps、写盘或发布；正常无冲突重置保持。永久结果不是OS强制退出的承诺，此修正不新增全局锁、root drain、事务框架或任意并发矩阵。普通和带owner两入口须各有窄回归，现有首次结果复用/原46项保持；真实reload仍另行验收。

上述窄修已完成：原46项、Terminal/Agent真实start replacement两项及ordinary/owner重叠两项共50项通过，`.debug/a6-permanent-mutation-fixed-20261001-01.log` 保留修后结果；root与独立reviewer均复跑通过，Host145/145、typecheck/localization通过。ordinary首次Error复用；owner相关域保持首次unconfirmed，真实删除仅一次，放行后旧reset拒绝且lateWrites为空。owner用例是受控client顺序，真实transport在deactivation被dispose后仍可能诚实返回unconfirmed，不代证原ACK必到达。未改永久结果为成功，也不关闭真实reload/多根UI。

## 33. Darwin 产品原生接入

### 33.1 运行前原生契约（2026-10-01）

本增量将 macOS 接入现有产品 provider，不改冻结的 baseline/failure 诊断、旧断言或历史结果。显式 profile 为 `macos-owner-v1-candidate`，隔离 generation 为 `terminal-exit-macos-v1`，owner kind 为 `macos-provider`；stock 和 Linux candidate 不因本增量默认启用或被替换，旧 Linux profile/generation 保持。推进过程由现有 `runtime-exit-integrity` ExecPlan 承接，不新增工具项目或验证矩阵。两 authority 通过同一薄 factory 选择平台，普通 build 不启用候选；共享 transport 只增加 Darwin 的 POSIX 路径，Windows guard 保留。

产品使用独立 provider 内同一个 token/env owner 执行非阻塞读写、resize 和唯一 `waitpid(pid, WNOHANG)`，不安装 stock 退出 callback，不创建 kqueue、wait thread、TSFN 或第二个 reaper。这个 polling 选择利用现有产品 adapter/channel 的调度与输出 credit 隔离，不将旧 Darwin kqueue/TSFN 诊断成功当作新实现验证。实际 Darwin native、Host/Webview 和 packaged 结果取得之前，平台仍未通过。

创建保留锁定 node-pty 的 `posix_openpt`、slave 配置、`posix_spawn` 和同源 `spawn-helper` 的真实链；helper `execvp` 后主体 PID 不变。master、child 在各自取得时立即登记，失败不丢失已有责任；slave、low-fd-0/1/2、spawn-actions/attrs 分别记录取得和实际释放。所有 init/adddup2/addclose/setattr 返回均检查，只有初始化成功的对象才 destroy；POSIX spawn 错误使用直接返回码，不解读无效 PID。原始创建错误与释放错误分别保留，不用进程退出代证 provider 正确释放。

现有九个 `fork`/`executionConfigure`/`executionSnapshot`/`executionRead`/`executionWrite`/`executionResize`/`executionPollWait`/`executionSignal`/`executionClose` 导出和参数保持。snapshot 新增 `creationResources`，只列实际取得的 `{resourceId, acquired, releaseAttempted, releaseResult, releaseErrno}`，原生账本 ID 固定为 `pty-spawn-actions`、`pty-spawn-attrs`、`pty-slave`、`pty-low-fd-0/1/2`。通常只取得 low-fd-0，不伪造其余 fd 的取得/释放。provider 在 `forkAttempted` 后用原 `resourceAcquired/resourceResult` 报告一个 `pty-creation` 创建事务责任；只有账本中全部实际取得条目均已成功释放，该事务才 released，否则保留 unknown，并使整体 `resourcesSettled=false`。这不是把未取得 OS 资源写成已释放。master/child/source 仍分别结算，正常已启动会话的 parent cleanup 原生资源集合固定为这三项加 `pty-creation`，不扩共享 adapter 的必需/可选资源协议。

每次 read 使用正容量 4096-byte Buffer；Darwin 只将真实 read 0 记 EOF，EIO 保留 read-error，不机械继承 Linux EIO 语义。UTF-8 尾片和已读数据沿原 channel 完整移交；主体退出、停止、取消或超时不等于 EOF。write 保留 partial/retry，resize 使用 token-bound `TIOCSWINSZ`；SIGHUP/SIGTERM/SIGKILL 仅作用于同 owner 尚未回收且本次 `WNOHANG` 返回 pending 的主体，退出 status 仅在返回本 PID 且 exited/signaled 时解码，其他错误保留 unknown。

新增 authority 专用 `executionClaimNamespace(path): void`。路径为 authority 规范化私有 storage 下的绝对锁文件；native 用 `O_NOFOLLOW|O_CLOEXEC` 打开，核对普通文件、当前有效 uid、0600 权限、单一硬链接和路径/fd 的同一 dev/ino，以 `flock(LOCK_EX|LOCK_NB)` 取得排他。成功 fd 持有至进程退出，不能在 listener 关闭时释放，也不 unlink 文件；竞争者失败后关闭自己取得的 fd。锁文件/存储目录不能在运行期间替换；同 uid 主动篡改不作为不可信主体安全隔离承诺。authority 只取得 namespace，不 configure 执行 owner；provider 只配置执行 owner，不取得 namespace。私有目录建立、规范路径、旧 socket 处理与两 authority 启动由现有产品层负责。

构建提供匹配当前执行端 x64/arm64 架构、实际 Node/Electron/ABI 的 Mach-O addon 和同源 helper，分别记录源码/二进制 hash 并保留 helper 可执行位；不加载 `.debug` 资产，不修改安装的 node-pty。Linux 守卫头与 macOS 创建扩展共用 `unix-execution-owner.h`，构建 provenance 包含公共头；不通过伪造平台宏复用系统声明。namespace callback 必须来自同一份验证过的 native 资产，Darwin support guard 不接受没有 callback 的启动。原生源码/patch 受控测试和 Linux 编译回归只能证明对应层的契约，不代替 Darwin 编译、加载或实际运行。本节冻结时尚无新 native 执行或 runner 结果。

### 33.2 原生源码局部实施

新增 `native/macos-execution-owner.h`、`scripts/build/macos-execution-provider-patch.mjs` 和 `scripts/test/test-macos-execution-provider-source.mjs`，将既有 Linux owner 主体提取到公共 Unix 头，Linux 守卫头保持原平台限制。Darwin patch 对锁定 node-pty 源码进行唯一锚点替换，使用受检查的创建函数，错误返回不再绕过 owner 账本直接关闭 master；旧退出 callback 不被安装。helper 源码固定 SHA256 `22195de1710b574d5904fc89be5624c25e531de20d5e17e5998a2fd19d86e0e6`，不改其 exec 同 PID 语义。

新增源码测试已通过，覆盖锁定来源/导出集合、唯一 reaper、Darwin EOF 分支、已取得创建资源报告与释放检查、helper 参数和 namespace 文件/锁前后身份约束；作用域 `git diff --check` 通过。这些检查未加载 addon、创建 PTY 或取得 namespace 锁，不证明实际 Darwin syscall、产品两模式或 package 已通过。共享接线只读审查发现最初将六个可变取得条目全部作为 parent cleanup 必需 ID 会使常见 low-fd-0 路径永远无法取得 transferred claim；因此在原生验证前改为 33.1 的创建事务聚合，native 逐项账本不变，不伪报未取得资源。共享 factory/build/profile/namespace 接线及后续原生验证由同一产品增量继续承接。

共享产品接线已落到两个 authority 的显式 factory 选择、独立 macOS generation、helper/入口/原生 hash 校验及 Darwin namespace callback；普通构建仍 stock。局部回归为 owner46/46、adapter98/98、Host145/145、Supervisor92/92、Linux namespace7/7、transport7组、channel12项、parent-control9项、Linux factory25/25、macOS factory两个架构受控契约、build selection10/10、macOS assets11/11，以及公共 provider 的原10项加Darwin3项，均已通过。Darwin factory/资源/EOF检查仍是受控边界，不是原生证据。

公共头提取后的 Linux/Electron39.8.7、Node22.22.1、ABI140 资产已在 `.debug/linux-shared-owner-20261001-assets/` 新目录实际编译，显式2/1产品构建完成。仅因共享native/profile/Host路径有实质变化，随后以新目录 `.debug/linux-shared-owner-20261001-smoke/` 运行原 A2/A3 两模式 Terminal complete/reopen 有限入口各一次，整轮 exit 0、四次 launch 完成。两模式均保持90002行、最终光标及独立成功写入凭证；Runtime轻量节点646 bytes、真实重开无历史且绑定删除，snapshot-only节点5767028 bytes、真实重开保留原缓冲。completed/reopened/cleanup各自pass，清理只证明原主体回收和本节点/Host绑定删除，不外推全部OS资源。不是再跑已通过的A1或Agent矩阵，不将旧结果覆盖为新构建结果。

### 33.3 首个 Darwin 产品 provider 原生输入

首跑使用独立 workflow `runtime-execution-macos.yml`，保留手动入口；因新 workflow 尚未在默认分支注册，另加仅限 `runtime-persistence-session-state-refactor` 分支和本 workflow/macOS native/provider/验收输入路径的有界 push 触发，不带 secrets、矩阵或旧三平台诊断任务。固定 Node 25.6.0、macos-latest 的实际 x64/arm64 架构、锁定 npm 依赖、对应官方 headers；headers tar.gz SHA256 固定为 `6e6662d6081f36bb3896df42a331e9ccbb4286fda72daf7bc7fb5bfb18fa8ed0`。新生产 asset builder 编译当前源码，再通过原 build 的显式 macOS profile/assets 生成产品入口。输入、manifest、addon/helper/入口 hash、OS/架构和首次原始结果分别保存。

固定四场串行，不重试、不增加样本：namespace 场启动三个没有 PTY 的实际 authority 子进程，验证初始持有、竞争者拒绝、原 owner 自然退出后新 owner 对原锁文件同一 inode 重新取得；normal 场通过实际 factory/Main/channel/owner 创建真实 PTY，完成 nonce 输入回应、119x41 resize、非零自然退出、成功写入来源全量对账、红色中文终态与光标及真实 read-0 EOF；paused-stop 场在 16 帧信用耗尽且消费暂停时请求原产品停止，确认主体回收独立推进，观察原 owner cancelOutput 后恢复消费，源必须 interrupted 而非 EOF；partial-create 场最后执行。

创建失败控制仅操作本测试新复制的私有资产：产品 Main 已验证资产并发布 ready 后，在 authority 向 adapter 交付 ready、发送 start 前去掉 helper 执行位，使真实 `posix_spawn` 返回 EACCES。不替换 binding、provider Main 或原生函数，不修改已发布资产；确认原 master 和创建事务释放、没有 child/source 取得、没有 EOF，并在收尾恢复 helper 执行位。这个失败按预期保留 process/source 未确认和 authority 拒新建，不把失败启动写成普通成功会话；OS 资源释放与产品不确认结果分别验收。

预算沿用已存在有限业务入口的每场 45000 ms、清理观察 35000 ms、真实 subject 自限 25000 ms；产品 start/stop/cancel/settlement 预算不变。每场最多一个 provider，normal/paused-stop 各一个主体，partial-create 不应产生主体，namespace 最多三个直接子进程；证据内存保留沿原 8 MiB 输出和 20000 控制事件上限，超限失败。首个场景断言或清理失败即停排并保留未运行项，不延长预算筛选通过。

这四场只验当前 Node authority/provider/PTY 与真实解析器，namespace 使用实际 factory 原生锁。首跑结束条件是四场均达到各自冻结结果且本方清理可证，或保存第一个失败/清理结果后停排。编写此协议时尚未推送、触发 workflow 或取得新 Darwin 原生结果。

四场通过后，同一job直接复用原 `run-vscode-execution-candidate.mjs` 的两模式Terminal complete/reopen，补足实际Host/Webview，不新增诊断框架。固定VS Code1.117.0、Electron39.8.7/Node22.22.1/ABI140；对应headers SHA256为 `af6712ab16c436b9288ece2f0173924c74008446346bda3457d07b769f402eda`，重新编译匹配Electron的addon/helper，不复用Node二进制。runner仅为基本A2/A3选择本平台manifest/provider和隔离generation，容量/proc身份路径仍只准Linux；90002行、最终光标、实际关闭重开及两模式历史断言均不变。Node和Electron的build/evidence分别归档，前者通过不代证后者，任一步失败停止后续运行；真实Agent、package及其余A5不在该有限结果内。

`test-macos-execution-product.mjs --self-test` 已在本地通过，验证固定 workflow、完整/截断帧判定、仅 CR-before-LF 的来源对账归一和真实 headless 终态 oracle；subject/runner 语法及 namespace fixture bundle-only 检查通过。没有加载 addon、创建 PTY 或取得 namespace 锁。取消场另保存已记录 writer bytes/hash，但信号可能打断成功 write 后的 audit append，不冒称完整写回执；严格要求全部已收到帧进入真实 parser，且结果只能 interrupted，normal 场仍按完整成功回执逐字对账。

### 33.4 首次 runner 失败与输入修正（2026-10-01）

首跑为 push run `36819133440`，输入 `dcac5b8299de7ad941a8d9ce045cf9c66ace04fd`，job `110230671679` 在 `Check bounded provider input` 失败。源码契约检查和资产测试前三项已通过；第四项 `test-macos-execution-candidate-assets.mjs:113` 的路径严格相等断言失败：实际导入目录为 `/private/var/folders/...`，夹具期望为 `/var/folders/...`。`importCandidateAssets` 已按既定契约对 dist 使用 realpath，测试却直接以 `os.tmpdir()` 的别名路径建立预期。这是已定位的测试夹具路径错误，不是 Mach-O、PTY 或产品退出结果。

修正仅将 macOS 资产与工厂纯测试的临时根在创建后规范化，保持原资产目录、摘要、可执行位和拒绝覆盖断言；资产测试增加一项合成目录别名回归，确认 read/import/build-selection 返回既定规范路径，没有修改产品路径校验或放宽断言。本地 Linux/Node25.6.0 上资产12/12、工厂两个受控架构和 product `--self-test` 通过；这些不是 Darwin 原生验证。首跑的 Node 编译、四个产品场景、VS Code 准备、Electron 编译和两模式 Webview complete/reopen 均 skipped，没有生成对应 build/evidence 目录，因此归档步骤没有上传产物。首败 run/log 保留；该次修正完成时尚无修正后 runner 结果，不将未执行项计为通过，也不自动重复运行旧输入。

第二次运行是新输入 `8002b315bb76543f9c797eb6dd848b59922a4be2` 的手动 run `36819790191`，job `110232683885`。受控输入检查与实际 Darwin arm64/Node25.6.0/ABI141 编译通过；namespace 场的三个真实 authority 验证原锁 inode 不变、竞争拒绝和退出后重取，场景及清理均通过。normal 为本轮首个失败，记录的外层结果是 45000 ms 整场观察到期。其 `evidence.json` 已显示 adapter `state=settled`、`acceptedThrough=consumedThrough=6`、进程自然 exit7、真实 source EOF、pendingBytes/pendingFrames 为0，五项本方资源均 released；但 terminal 为 `failed`，原因 `Invalid final terminal revision`，owner 因 final-flush 不确认而隔离。normal 清理 `safe=true`、`taskSettled=true`、无错误或额外信号，不能据此把整场或后置写回执/终态断言追认为通过。原产物保留在 artifact `macos-product-provider-36819790191-1`，本地核对目录为 `.debug/macos-product-36819790191/`；paused-stop、partial-create 未运行，VS Code/Electron/两模式 Webview 后续步骤全部 skipped。

确定原因在验收 harness 的 tracker 接线：`consume` 调用 `tracker.write(batch.text)` 时没有传入输出序号，随后 `flushFinal` 从真实 flush 结果读取到 `undefined`。`DataBatch` 的实际字段为 `sequence`，`lastDataSequence` 属于 `OutputSeal`，不是 batch 属性。修正只在本 runner 共用的终端 hooks 中传入 `{ outputSequence: batch.sequence }`，最终先完成真实 tracker flush，再严格核对其序号等于 seal；只有无任何输出、seal 为0且 tracker 未设序号时，显式标记空流0并再次真实 flush，不为非零缺失消费补造 revision。原原生、退出、资源、EOF、写回执、终态与暂停取消断言保持。局部 `--self-test` 直接执行同一套 `consume/flushFinal` 回调，覆盖暂停门、多批序号1/2/3、真实中文颜色/光标、零输出、未消费非零 seal 和 seal 超前拒绝，语法与作用域差异检查通过；没有新 PTY/native/runner 执行或第三次结果。

### 33.5 既定真实 Agent 验收的 Darwin 进程身份来源

原A4观察器只支持Linux `/proc`，不能删除guard后把macOS的不可读PID认成已退出。继续保留现有八场、真实npm包装器、nonce/EOF/页面/持久化断言和有限安全清理；仅为本轮实际macOS输入增加进程身份来源，不重建诊断框架。

选用固定 `psutil==7.0.0` 的成熟系统进程API，作为CI验收依赖而非产品运行依赖。小型只读helper一次查询已确认root及原来记录的PID，返回birth identity、ppid、状态、executable、argv和直接后代，不读取环境或整机进程表，不归档未过滤命令参数。Darwin身份使用系统提供的启动秒/微秒，不用 `ps lstart` 的秒级字符串，不把PID存活当作同一进程。采样仍是单在途，保留实际采样耗时及观察区间，不宣称精确退出时序；访问失败记unknown并阻止成功判定，不能补为absent或零。

失败清理只针对本观察器已证明属于原启动链的provider/wrapper/CLI，重新核对同一birth identity与executable；helper或API不可用时不按PID补杀。本轮新增依赖仅服务既定真实Agent安全/判定，不成为Terminal或其他平台的通用前置。保持专用DeepSeek凭据步骤与脱敏report，原始配置/日志不上传；Node/Terminal的无凭据workflow不混入Agent私有产物。具体helper源码与运行时摘要随A4输入固定，尚未取得新macOS真实Agent结果。

对应独立 workflow `runtime-real-agent-macos.yml` 只手动触发，不与无凭据Node/Terminal产物混传；Node25.6.0、Python3.12.10、psutil7.0.0双架构wheel hash、固定CLI与VS Code/Electron版本在运行前固定。helper用libproc按已确认父PID读取直接后代，避免psutil children实现扫描整机ppid表；末次cleanup也检查observer错误，不将最后采样失败遗漏为通过。仅原八场串行、最多四次预定模型任务、无harness重试，先取得匹配Electron/Terminal产品证据再执行；官方模型/原中转服务不在本轮声明范围。

Darwin观察接线已实现，Linux原身份路径保持；JS单在途/亲缘/参数不归档/unknown/cleanup定向检查及Python六组受控检查通过。独立复核发现libproc可返回`0 + errno`表示失败，已先红并修正为unknown，只有errno为0的空结果可认无后代。Linux/macOS两workflow的固定输入、仅单步骤secret、无原始产物上传及shell语法检查通过；此处仍无新的macOS真实Agent运行结果。

### 33.6 第三次 Darwin 运行与共享 deadline 修正

输入 `3bde0880c4116d9be66cd06fba17da07f28022f4` 的 run `36820565903`/job `110235031971` 保留失败。Darwin arm64/Node25.6.0 的编译、namespace、normal、paused-stop 及各自清理通过；normal 取得 exit7、真实 EOF、成功写入全量对账、颜色/尺寸/最终光标和五项资源释放。partial-create 正确取得启动失败、无 child/source、三项已取得资源释放与空终态应用，但 45 秒外层观察到期，owner 原 13 秒结束期限后仍无 `closeObservation.first`。其清理安全且无额外信号，不追认为整场通过；Electron/Webview 后置步骤仍 skipped。原 artifact `macos-product-provider-36820565903-1` 和 `.debug/macos-product-36820565903/` 保留。

直接代码路径在共享 `createNodeExecutionScheduler()`：把浮点剩余毫秒直接交给 Node `setTimeout`，timer 回调可能早于单调时钟 deadline。owner 的 `advanceCloseObservation()` 正确拒绝提前结算，却没有另一次通知；若最后一次 timer 提前，首次结果永久 pending。原工件未记录每次 timer 实际进入时间，不能声称已直接测得该次提前；使用真实 scheduler 源码、仅替换 Node 时钟和 timer 的确定性回归已先红，证明这一跨平台机制确实存在。它不是 Darwin PTY 缺陷或测试要求过严。

正式修正只在该共享 scheduler：首次剩余时间仍校验有限且不超过 Node timer 范围，按剩余量向上取整；每次唤醒复核原绝对 deadline，提前则重新安排同一 deadline，不延长预算、不执行业务回调。到期仅调用一次，取消作用于当前 timer 且幂等；不改变 owner 的首报、unknown、隔离、内容或资源语义。现有 parent-control 回归覆盖提前唤醒、重排后取消、已过期和非法期限；原 owner/adapter/Host/Supervisor 回归继续执行。修后按原 macOS 固定输入重新运行，旧失败不删除，也不从该局部修正推断其他平台已经原生通过。

### 33.7 第四次 Darwin 运行的宿主启动路径失败

run `36821963386`/job `110239281754` 使用 `72ca0efe`，修后原Node四例全部通过，匹配VS Code1.117.0/Electron39.8.7/Node22.22.1/ABI140的编译也通过；后置Terminal步骤仍exit1。VS Code在扩展启动前报告其 `user-data/1.11-main.sock` 路径超过Darwin的103字节限制，随后 `connect ENOTSOCK`。仓库内证据目录层级过长是该前置失败的具体依据，不能宣称本次实际Webview尾部已经通过，也不将其归为新的PTY尾部缺陷。完整artifact `macos-product-provider-36821963386-1` 保留，前三轮失败不变。

本次仅尝试live-runtime的首次宿主启动，没有进入complete/reopen断言；snapshot-only整例未运行，不能把未执行记成第二个产品失败。

修正只在两份macOS验收workflow：Terminal输出根使用本job私有的 `$RUNNER_TEMP/dsc-terminal`，归档同一目录；真实Agent原始工作根使用 `$RUNNER_TEMP/dsc-agent`，仍只上传原脱敏 `agent-ci-report/`。最长固定Agent场景的socket路径在已知runner根下为88字节，不改通用smoke runner、不用symlink改变真实root、不削减内容或退出断言。Node已通过不代表Agent或两模式Electron通过，修后继续原输入验收。

### 33.8 短路径后首败与停止场景的真实 EOF

短路径输入 `32e4ab9c` 的 run `36822748979` 在 job 的20分钟上限被取消。Node四例及Electron编译已完成，VS Code日志中的socket路径为75字符且未再出现ENOTSOCK；标准输出只确认到workbench启动。随后取回原artifact `11144487527` 的宿主日志，确认test module与产品extension均已启动：06:05:17调用 `openCanvasInEditor()`，06:05:37在原20秒预算内等待Canvas ready失败，已捕获failure证据、调用resetState，test runner报错且Extension Host exit0；外层VS Code仍未结束，最终job取消。这里是Canvas ready缺失与外层进程未结束两层事实，不是test module未启动；日志末尾的secret storage/encryption记录尚不足以确认keychain根因。没有完成/重开或产品清理通过证据，保留原失败并继续读取已有failure证据，不把job取消写成尾部丢失。

随后 `86c53365` 的手动run `36825479993` 在Node `paused-stop` 首败，namespace/normal通过，partial-create、Electron及Webview均未执行。本轮SIGHUP后已取得真实source EOF（finalFrame17），但测试只等待 `cancelOutput` 接受才恢复其自身消费gate。源已经结束时owner无需再发取消，导致整场45秒到期。原17帧重组与output完全一致，READY换行规范化后的16397字节与writer保存字节相同，SHA256为 `d2f2eab0ebb2629c573a5b6f259d711b55e0a776d9d0628eaa9427711afb4cd9`；这只证明已保存写入，不承诺被信号打断后的未来写入。五组资源均released，provider已关闭，cleanup无强制信号。失败后cleanup恢复gate却未等最终消费即dispose tracker，故末次 `2 !== 17` 不能独立认定为产品尾部丢失。

最小修正保持同四例、SIGHUP、原预算和全部消费/终态/资源断言：收到原source EOF或原取消接受后恢复消费；最终source按实际EOF或interrupted分别核对，stop始终不声称自然任务完成。失败清理仍只在原35秒内等在途消费后释放tracker，不延长产品期限。原输入和两个失败结果保留，不追认通过、不另增诊断矩阵；修后原生结果另记。

本地同一 `--self-test` 已覆盖EOF、原取消接受、错operationId、unknown不放行，以及整场已拒绝但16批消费仍在途时须到seal17才dispose。真实headless tracker验证最后序号17；不执行Darwin原生调用，也不替代新一轮平台验收。

### 33.9 macOS 临时验收宿主的 Secret Storage 隔离

旧run36822748979的failure JSON进一步确认：editor generation2已attached/rendered/messageWebviewBound，但ready与bootstrapAck均false，只有默认Note、runningExecutionCount=0、Runtime bindings为空，Terminal尚未创建。主进程日志停在 `EncryptionMainService: Checking if encryption is available...`，renderer同时停在内置GitHub扩展读取github.auth。VS Code1.117.0该日志后同步调用Electron `safeStorage.isEncryptionAvailable()`；缺少native stack，故keychain/safeStorage阻塞仍为强假设，不写成已证实死锁。

选定最小受控对照为仅在macOS临时smoke宿主启动参数加入官方 `--use-inmemory-secretstorage`：该版本明确支持此参数，使 `NativeSecretStorageService` 不进入系统加密可用性探测。测试不依赖跨launch的VS Code账号Secret，Agent凭据仍来自32.20专用私有CLI配置；产品与通用secret filter不变，不读取本机keychain、不放宽Canvas ready或尾部断言、不延长预算。局部验证固定macOS参数与其他平台不变，然后以新输入复验原Terminal页面/重开；旧失败保留，若通过只说明避开了该临时宿主环境依赖，不宣称修复产品keychain问题。

该参数、三平台完整参数对照和macOS原workflow触发/执行接线已实施；env/secret过滤、macOS product self-test及Agent CI workflow契约测试通过。旧run36827234930再次Canvas ready超时、外层随后取消，保留原结果。

修后输入353bb575的run36829311235整轮success；原报告已从artifact按范围提取至 `.debug/macos-success-36829311235/small-reports/` 独立核对，不只依赖job绿灯。Darwin arm64的Node四例全部pass/cleanupSafe，实际Electron39.8.7/Node22.22.1/ABI140，两模式共四次宿主启动均使用内存Secret Storage；这只证明避开该测试环境依赖，不证明系统keychain死锁。`partialSelection=false`，live-runtime与snapshot-only各自completed/reopened/cleanup六份报告通过。

两模式实际writer均写5580102bytes，SHA256 `e03d6d758493454da0946cc62e7c17fb2444e39afaa7639c8a88ad271eaff48f`、terminalWriteComplete=true，原90002行断言和最终光标(6,2)成立，source=eof，最终applied分别7981/7554。Runtime保存节点556bytes，重开closed且无history/serialized/runtimeId、空buffer；snapshot-only保存节点5766938bytes，重开保留5580063字符快照及同一光标。两cleanup的bindings/pending operations均0，范围仅主体回收及节点/Host绑定，不代证全部OS资源或A5。旧失败不追认，真实Agent、其余A项、packaged及默认启用继续开放。

### 33.10 首轮 macOS 真实 Agent 的空快照断言失败

输入b1628715经已注册手动入口的run36832581851实际执行原八场景，整轮failure；安全摘要为 `.debug/agent-ci-macos-36832581851-summary/summary.json`。Codex Runtime natural、Runtime stop、snapshot-only natural前三场passed；两natural取得真实DeepSeek响应/nonce、turn.completed、无metadata fallback与实际source EOF，Runtime stop仍为主动处置。第四场snapshot-only stop在原 `agent-candidate-tests.cjs:170` 的 `assert(serializedTerminalState?.data)` 首败，Claude四场not-run，未自动重试。

失败摘要明确记录：status=stopped、liveSession=false、exitCode=0、serializedStatePresent=true但serializedStateBytes=0、outputSequence=15，原reader applied且finalOutputSequence=15，实际source=eof；四场cleanup的bindings/failures/forcedSignals/active均0。该事实只定位到非空字符串断言，不能凭EOF/序号宣布尾部完整，也不能凭空串认定正文丢失；原raw没有发布，不从摘要还原内容。产品 `normalizeSerializedTerminalState()` 接受空字符串，故下一直接核对合法空屏与丢内容的区分判据，不先删除原断言或盲目重跑。此前Linux第三轮snapshot stop的根因仍未知，不因场景名相同追认同一根因或已修复。凭据在该平台的两个natural实际可用，不要求用户重复配置认证。

独立复核进一步限定：上述failureState来自故障时Host metadata，不是断言现场savedNode直接落盘值；下一在原断言之前，针对本次snapshot-only已有输入计算具名终态证据，原非空断言暂不改。读取实际savedNode、原help-probe、最终probe与getHostMessages；同一执行/reader最终序号、快照序号/尺寸、实际页面全文/光标与同尺寸hydrate后的快照逐项对账。只有初始checkpoint、连续output区间及resize revision/尺寸顺序完整时，才用现有headless xterm独立重放对比；200条环形记录裁剪、缺区间/尺寸、投影恢复或换代须明确无法判定，不能用拼接文本或仅看清屏escape代替。

该诊断只增加固定枚举/布尔/计数/hash的 `snapshotEvidence` 安全摘要，缺证据保持unknown；raw/快照正文不发布，同一key内容扫描继续执行。局部用既有xterm验证合法空屏、正常非空、丢正文/错cursor/序号/缺消息不能误判；不建通用replay框架或扩场景。之后只运行一次原macOS矩阵取得新输入事实，失败即停；旧failure与原真值断言不追改。是否将非空判据替换为终态一致性，依据新证据另行判断，不预设“合法清屏”结论。

上述evidence-only接线已实施于 `agent-candidate-snapshot-evidence.cjs`、原Agent测试与受限CI report，未改业务、runner或原truthy断言。重放只使用初始checkpoint、连续output及resize操作，后续终态snapshot只作对账，不能覆写重放来制造一致；满200条窗口、缺区间/resize/exit、reader换代和恢复snapshot均保留unknown。helper自身摘要随安全证据发布，页面投影独立性明确为not-proven。helper及report定向回归、workflow契约通过，包含“空终值及页面不能洗掉重放非空正文”负例；这些不是原macOS失败的根因结论，新原生输入仍待固定一次执行。

固定一次新输入6d622bee的run36836757674仍整轮failure：前三Codex场passed，第四snapshot stop原truthy断言在188行拒绝，Claude四场not-run。安全摘要保存在 `.debug/agent-ci-macos-36836757674-summary/`，actual savedNode的空串有效、快照/metadata/reader最终序号均13，reader lifecycle匹配；原help页面有11条非空可见行。最终hydrate与页面的geometry/visible不一致，但全文非空行对账为true；62条消息未满窗，独立重放因execution-changed保守unknown，故不能判定合法清屏或丢正文，更不能改为通过。四cleanup仍零残留。下一仅核对该两种具名未知的现有消息/布局生产语义，不自动复跑或扩展通用诊断框架，原两次macOS失败与Linux具名未决项继续分账。

33.10 的只读离线核对使用旧 Linux 真实输入 `.debug/a4-real-agent-20260930-indexed-pages/codex-snapshot-only-stop/artifacts/`，不更改证据或代证 macOS。已确认三个生产 schema 事实：创建前有同 reader、无执行身份的 inactive 空 snapshot；首个 live checkpoint 外层序号为0而空 serialized state 未带可选序号；输出前重复发送完全等价的初始 checkpoint。当前 helper 因这些合法输入逐层返回 execution-changed、initial-checkpoint-missing 和 projection-recovery-or-unknown-snapshot。选定只识别这三个窄规则：无身份前缀必须位于首个当前执行 checkpoint 之前、同 lifecycle、inactive、output 为空且无序号/serialized state/terminalRead/stream；缺嵌套序号仅限初始外层0、合法格式、空数据、viewport为0或缺失；等价重复仅限任何 output/resize/final 之前。其余缺身份、非空缺序号、换代和后续恢复仍 unknown，不以新终值覆盖独立重放。

该旧 Linux 输入按三条规则内存核对可完整重放0至12，共10个output、无resize，published final与saved相同。replayMatchesSaved仍为false：几何/光标/viewport/所有行均相同，但原重放序列化为656字节，而hydrate再serialize为650字节；不做ANSI归一或改为true。旧saved66×21与page96×30的原geometry/visible均false，仅将独立hydrate resize到page尺寸后对账一致。后续允许额外记录这一具名resize对账，不覆盖原比较、不设置page光标/viewport、不复制page正文，也不宣称真实resize顺序已证。原truthy断言和停止时机保持；局部回归及原输入离线复核后，至多一次原macOS矩阵用于填补这次已知采集盲点，不自动失败重试。

三个严格初始规则和独立resize对账已在原四个helper/report/test文件实施。helper/report新增回归各自先红后绿，日志 `.debug/mac-snapshot-initial-schema-original-20261001-01.log` 与 `.debug/mac-snapshot-fields-original-20261001-01.log` 及各自fixed记录保留；root复跑两测试和workflow契约通过。旧Linux原消息无需改写即可回放，原replayMatchesSaved=false及geometry/visible=false保持，新resize几何/可见行true但历史完整buffer未存，整项保持null。原重复负例移至输出之后，继续拒绝后续恢复；新非法前缀、非空缺序号、resize后重复和敏感文本负例保持。原truthy与停止时机未改，macOS新原生输入仍待运行。

e10ad8aa的固定macOS run36841263618仍前三passed、第四188行truthy failed、Claude四场not-run；安全报告 `.debug/agent-ci-macos-36841263618-summary/summary.json` 保留。新增证据首次可判定：初始0至最终13完整连续回放，9个output、无resize/recovery，replayMatchesSaved=true且publishedFinalMatchesSaved=true；原reader/lifecycle/seq13匹配，help曾有11条非空行。saved66×21/page96×30原geometry/visible仍false，但cursor(0,0)、viewport0、normal相同，独立hydrate仅resize到page后geometry/visible/buffer全部true。四cleanup零值不代替原truthy之后尚未执行的主体结束检查。独立review核实helper/script/report摘要与输入一致；这些消息是Host发布记录（记录在postMessage之前），不是provider原始字节或独立页面接收日志，pageProjectionIndependence仍not-proven。

据此选定未来输入的有限判据变更：只在snapshot-only-stop且实际saved.data严格为空字符串时，允许用原helper的完整证明替代非空断言。必须saved合法/节点和reader身份匹配、从初始0连续到最终正序号、实际output至少一条、曾有非空help、replayComplete/replayMatchesSaved/publishedFinalMatchesSaved/readerApplied/sequenceMatched均true；页面原完整buffer为true，除cols/rows外cursor/viewport/bufferType逐项相等，且原直接页面全部匹配或独立resize后的全部匹配。缺证据/unknown仍失败，非空路径和natural原要求保持；不进行ANSI等价归一、不放宽序号或停止时机、不更改旧失败。

新判据后继续原CLI/wrapper/provider真实退出与清理检查。合法空态额外在同一场景内交接已完成节点的持久状态，退出原Host后由同runtime/workspace的新Host重新加载，不再调用模型、不重启主体。新Host必须不同、同节点仍stopped/live=false、原空serialized状态与序号未丢，实际fresh页面完整buffer为空、cursor(0,0)/viewport0/normal，且没有新Agent session/Runtime binding；最后沿原reset清理。第一阶段只有在主体退出已经通过后才能保留节点等待reopen；任何阶段失败保留首次结果并清理本轮资源，缺第二阶段报告不通过。报告仅新增固定重开布尔事实，不发布正文。该变更不追认本轮通过，不补造具体清屏序列或Linux间歇失败同因，也不要求对非空Agent重复整套重开矩阵。

## 34. Windows 产品原生接入

### 34.1 运行前原生契约（2026-10-01）

本增量新增 Windows bundled ConPTY DLL 的产品 provider 核心，沿用现有 authority/channel 的有限信用、交互预算和退出屏障，不改冻结的 HPCON 诊断 patch、旧测试或历史失败。profile、namespace、实际 Node/Electron 资产和分发接线由产品构建层显式选择；未完成接线和真实 runner 验证前不默认启用，不宣布 Windows 已通过。

native 导出为 `executionStart(token, pipeName, cols, rows)`、`executionConnect(token, commandLine, cwd, env)`、`executionPollWait(token)`、`executionResize(token, cols, rows)`、`executionClose(token)` 和 `executionSnapshot(token)`。token 绑定 execution/generation，单个 provider 只配置一个 owner；start/connect/resize/close 为异步操作。唯一 `WaitForSingleObject(hShell, 0)` 观察循环独立于输出信用，只观察本次创建的进程句柄，不新建 waiter/TSFN 或按 PID 寻找后来的进程。确认退出码后只关闭自己持有的 hShell；其他进程继续合法引用已退出对象不是缺陷，不要求对象全局消失，不关闭他人的句柄。

资源分为 `conpty-owner`（HPCON、创建连接端句柄、线程句柄及 DLL 引用）、`conpty-process`（本次 hShell）、`conpty-input`（输入 socket）和 `conpty-source`（直接输出 reader/worker）；`provider-control` 仍由原父进程负责。部分创建失败仍保留 snapshot 中已取得和未释放的责任，不能因 start 被拒绝或 JS 抛错清空 native 账本。HPCON 只调用正确类型的 `ConptyClosePseudoConsole`，不能作为普通 HANDLE 调用 CloseHandle；connect 使用 header 对应的 HRESULT 类型调用 `ConptyReleasePseudoConsole`，记录实际结果，与最终 Close 分离。

输出 worker 直接读取本次 conout pipe，以正容量固定大小 read、一个在途交付和明确 ACK 限制消息积压；等待 channel credit 时不无限 postMessage。reader 的真实 `end` 且未发生取消才记 EOF，close-without-end、error 和主动取消分别保留，不从主进程退出或 timeout 推导 EOF。取消只结算取消边界之前已交付及 reader 已拥有的有界 JS 缓冲，保持 UTF-8 decoder 尾片与交付顺序，不读取无限未来输出，也不要求主进程结束后继续托管普通工具后代。

输入走自有 conin 的异步 write，沿用现有四个交互/32768 字节预算。resize 与最终 HPCON Close 互斥：close intent 先封闭新增操作，等待已取得操作结束后执行单次 Close；不能在持有 native 状态锁期间阻塞 JS 线程，也不能将正在 Close 的 HPCON 再交给 resize。start/connect 同样属于在途 native 操作，关闭意图先到时不能随后再创建新主体。

自然路径分别等待主体退出事实、真实源结束、本地已拥有字节向 authority 移交及本方资源释放。现有 `channel.end()` 只确认 accepted/sourceEndAccepted，不等于最终消费者完成；native 释放门禁称本地交付完成，不冒称诊断的 markConsumerComplete。最终 xterm 应用/持久化仍由已有 authority 屏障核对，资源释放不代替其结果。

主动停止选择本次 HPCON 的一次性异步 Close，同时独立 reader 继续读取；`interrupt-then-hangup` 的 graceful 先通过同一输入通道写 ETX，force 再发起上述 Close。Close 返回、源 EOF 或明确取消、主进程退出和最终应用分账。不能把 TerminateProcess(cmd 包装器) 当作实际 Agent 已结束；真实 cmd/bat 启动链及此停止分支必须在既定 Windows 验收中确认。关闭/进程观察无法确认时保持 unknown/unconfirmed，不伪造资源释放或完整 EOF。

本增量的局部验证仅覆盖新 source patch、有限 reader/取消、provider 顺序和失败账本；不另建通用诊断框架。后续原生验证仍包含已知主进程尾部/最终光标、输入/resize、实际包装链、停止/取消、本方资源、Host/Webview 两模式和 packaged。局部 fake 或 Linux 上的源码检查不替代 Windows 编译、加载、真实 CLI 或 Electron 结果。

### 34.2 核心实现与局部验证边界

生产实现位于 `native/windows-execution-owner.h`、`src/panel/windowsExecutionProvider.ts`、`windowsExecutionPipes.ts`、`windowsExecutionOutput.ts`、`windowsExecutionOutputWorker.ts` 与 `windowsExecutionProviderMain.ts`，以上相对扩展目录。仓库根的 `scripts/build/windows-execution-provider-patch.mjs` 校验固定 node-pty ConPTY 源 SHA256，只将导出替换为本方六个 API 并包含新 owner 头；不修改已安装依赖或旧诊断 patch。native Close intent 和在途工作分别记账，阻塞的 ConPTY 操作在 AsyncWorker 执行；0-timeout process polling 不依赖输出回调。Windows 编译及加载仍未由本节证明。

reader 一次只投递一个不超过 4096-byte 的新 Uint8Array，并 transfer 其独立 backing buffer，避免取消快照每个切片重复复制整个底层 Buffer。Socket 使用 4096 的 readableHighWaterMark，并在连接前检查实际值；取消只快照本方已拥有的 readable buffer，再关闭管道，按原 ACK 串行交付剩余片段。消费者失败无法 ACK 时，适配层只中止本次拥有的 reader worker并记录传输错误，不把这条路径写成 EOF，也不让 worker 永久等待不可能到达的 ACK。实际 worker exit 与输入 socket close 后才报告本方资源释放；失败创建只报告真正取得的资源。

本地 `test-windows-execution-provider-core.mjs` 的六个 fake native/channel 场景通过，覆盖 UTF-8 尾片、主进程观察不被输出信用阻塞、输入/resize 分离、ETX 与 force Close、明确取消、部分 start/connect 失败和资源 unknown。`test-windows-execution-output.mjs` 四个真实 Node stream 场景验证逐帧 ACK、取消时已拥有字节完整交付、EOF/close-without-end/error 分离；不是 Windows named pipe。`test-windows-execution-pipes.mjs` 五个假 socket/worker 场景验证交付/ACK、消费失败和三处部分取得失败。`test-windows-execution-provider-source.mjs` 的来源/导出/选定 native 调用契约检查也通过，但不是 C++ 编译或原生 API 测试。

四个核心 TypeScript 模块的严格独立 typecheck 通过。Main 仍等待共享 Windows factory、profile/namespace、通道平台接线和构建/分发入口；此处只交付完整可测试核心，不把局部通过计入实际 Windows Node/Electron、Terminal/真实 Agent、Webview 或 packaged 验收，也不关闭 A5/F-04。未运行新的 Windows CI，未宣称包装器停止或 HPCON 异步 Close 的原生尾部完整性已通过。

### 34.3 编译与资产导入边界

新增 `scripts/build/windows-execution-candidate-assets.mjs` 的 `build`/`import` 入口，固定 profile 为 `windows-owner-v1-candidate`，导入位置为 `native/windows-execution-candidate/win32-{arch}`。build 只允许实际 Windows x64/arm64 当前进程架构，记录完整 Node/Electron 版本、内嵌 Node 版本、module ABI 与 N-API 版本；显式 `--headers` 的 `node_version.h` 必须精确匹配当前运行时。参数生成覆盖两个架构不等于两个架构已编译或通过，实际 arm64 结果仍未取得。

编译输入固定为已安装 `node-pty@1.2.0-beta.12` 的 `conpty.cc`、`path_util.cc`、`conpty.h`、`path_util.h`，当前 owner/patch，`node-addon-api@7.1.1`，以及显式 `--node-lib` 和 `--delay-load-hook`。ConPTY 源、路径工具和配套头均校验冻结 SHA；hook 使用标准 node-gyp `src/win_delay_load_hook.cc`，冻结 SHA256 `ec2357ffdf512151c21a52326ad3396aaa650b83e5c4a31153d216a155f68ecc`，本地核对来源为 npm 所带 node-gyp12.1.0。不在 builder 中下载或改写依赖。MSVC 直接编译两个 ConPTY 源与 hook，保留异常设置、`WIN32_LEAN_AND_MEAN`、明确目标架构、`shlwapi.lib` 和受控 `node.lib`；同时使用 `HOST_BINARY="node.exe"`、`/DELAYLOAD:node.exe` 与 `delayimp.lib`，由标准 hook 将 API 加载重定向到实际 Node/Electron 主程序。不能只提供 Node 头和 import library 就声称已满足 Windows Electron 加载。头版本核对及 import library 摘要只固定输入，实际 Node/Electron 加载仍必须原生验收。

运行时配套文件直接来自锁定包的 `third_party/conpty/1.25.260303002/win10-{arch}`，保留 `conpty.node` 与相邻 `conpty/conpty.dll`、`conpty/OpenConsole.exe` 的布局。manifest 的 `binary` 固定为 addon，`dependencies` 按上述两个配套文件的固定顺序记录 SHA256；三文件均校验 DOS/PE32+ 头、目标架构及 DLL/EXE 类型。源码 provenance 包含 owner、patch、原始及 patched ConPTY、路径工具、配套头、Node headers、node-addon-api、node.lib 和 delay-load hook 的摘要。导入前还要求正式 provider 与 output-worker 的两个 JS 入口存在，不复制编译输入，不接受旧目录覆盖。

build/import 均不加载 addon、不调用原生函数、不启动 OpenConsole，manifest 的验证声明严格为 `compiled=true`、`nativeLoaded=false`、`nativeCalls=false`、`productValidated=false`。本地 `test-windows-execution-candidate-assets.mjs` 十二项纯测试通过，覆盖精确清单与路径、三资产独立摘要/PE 声明、两个 JS 入口、MSVC 参数与 delay-load 输入、版本/ABI、外平台构建拒绝及锁定依赖布局；合成 PE 只验证校验逻辑，读取真实 DLL/EXE 也不执行它们。本段没有新增 Windows 原生结果，不关闭既定 Windows 编译/加载、Terminal/真实 Agent、Host/Webview 或打包验收。

### 34.4 固定 Windows Node 产品验收输入

2026-10-01 冻结第一轮实际 Windows Node 输入：Node 25.6.0、Windows x64 runner、锁定 ConPTY DLL、正式 factory/Main/worker/channel/owner 与实际 headless parser。固定四例为 `namespace`、`normal`、`paused-stop`、`paused-cancel`，每例观察 45 秒、独立清理 35 秒，fixture 主体自身寿命 25 秒；两个暂停例至多两个同时执行，同 owner 的 A 收尾与 B 交互不改变原 2/1 准入、输出信用或产品结束预算。保存完整 schedule、构建/源码摘要、首个结果、真实帧/控制和清理；首次失败后停止获取新案例，不自动重跑筛选通过。本轮不运行旧诊断或增加通用工具前置。

namespace 使用实际 `acquireRuntimeSupervisorNamespace`：原 authority 取得规范 storage 归属、竞争者被拒绝、原 authority 自然退出后新进程可重取；不把其他合法句柄引用已退出进程对象作为失败，也不关闭它们。controlled `.cmd` launcher 等待本轮真实 Node TTY 主体并传播退出码；由现有 `resolveExecutionSessionSpawnSpec` 和 node-pty 参数编码构造命令，不另造 Windows shell 解析。主体回执保存自己的 PID/PPID，须对应 provider 启动的 cmd PID；这是受控包装链，不是真实 Agent 验收。

normal 经产品 input 发送随机 nonce 并收到其 hash，resize 到 119x41 后读取真实 PTY 尺寸；主体再写 90000 条编号行、Unicode/ANSI 自身尾部并正常 exit 7。writer 原始写入、完成回执和 ConPTY 实际输出分别保存；ConPTY 可以重写 VT 表达，不能声称二者字节相同。将原始写入独立重放到相同 headless terminal，严格核对完整编号文本、Unicode 尾部、最终光标及颜色；主体正常退出、真实 source EOF、全部收到帧的消费、最后终态和本方五组资源释放分别通过才算本例通过。

两个暂停例先让 A 写 256×4096-byte 固定负载，暂停 authority 消费直到原 16-frame 信用用满，再调用产品 `requestStop`。在 A 尚未 settled 的区间，B 必须处理新 nonce 并在 1500ms 内由真实消费者应用响应，不以 write 被接受冒充交互完成。`paused-stop` 在 provider 接受 stop 后立即恢复 A 消费，source 按实际 EOF/interrupted 记录，不称自然任务完成；`paused-cancel` 则继续暂停，直到原 owner 按原预算发出的 `cancelOutput` 被接受后才恢复，并必须明确 interrupted。两例都要求已收到的帧全部消费及本方资源释放，不承诺杀停后的 writer 全文或普通后代未来输出；B 正常结束后同样检查完成和资源，不按 PID 清理包装器后声称实际主体已终止。

原生执行前再次审查确认验收缺口：仅等 cmd 包装器退出，可能漏掉仍在运行的真实 Node 主体，且可能把 fixture 25 秒安全退出误算为产品停止成功。四例范围不变，改为在主体 READY 后由独立 PowerShell 小观察器显式取得并保留 `System.Diagnostics.Process.SafeHandle`；校验该原对象的可执行文件并记录 StartTime，再要求原终端主体响应本轮专用随机 challenge 并写入 PID/PPID 回执，确认观察取得时仍是本次执行主体。随后只从同一保留对象读取 HasExited/ExitCode，不重按 PID 获取、不要求系统进程对象消失、不关闭其他进程的句柄。观察器自身最多运行既定 45+35 秒观察/清理窗口，只处置自己的观察句柄，不杀主体。

每个创建成功的实际主体都必须取得上述身份绑定与退出证据，两个暂停例显式拒绝 exit124；fixture 在触发安全定时器时先写不可覆盖的 safety 回执，该回执存在即不允许将任何最终退出码归为产品验收通过。normal/peer 的原对象退出码还须分别为7/0。35秒清理 safe 同时要求本方资源释放、原 provider 关闭以及所有已创建实际主体的已绑定原对象确认退出；未取得可靠主体身份或退出事实时记 unsafe。安全定时器导致的实际终止可以帮助清理收口，但不能追认产品停止通过。本次只加上述固定主体观察及其局部判定检查，不新建通用进程管理或清理框架。

实现前独立源码审查找到两个必须先修的核心缺陷：同步 DLL 加载/导出错误抛出的 std::exception 会越过锁定 node-addon-api 的 Napi::Error 边界；输入 EPIPE 被误送到 consumer-failure 路径，会直接 terminate 仍能交付尾部的 reader。前者已转换为 Napi::Error 并保留已有资源账本，source 断言修前 exit1/修后通过；后者已有 pending 输出时注入 EPIPE 的回归修前 terminates=1/exit1，修后仅封闭输入，原输出继续 ACK 和真实 EOF，pipe 测试现六项通过。Main 的 `.cmd` 接线、changed-worker 和缺 native export 三项受控回归也通过。这些是直接生产风险修复与局部证据，不是新 Windows 原生通过。

workflow 仅承接该固定 Node 输入，使用只读仓库权限和显式 manual/窄路径 push，不接模型凭据、不运行真实 Agent、不扩大为 Electron/Host/Webview/packaged 矩阵。上述既定验收仍在有限总清单中开放；本节冻结时尚未执行 Windows CI。

本地 `test-windows-execution-product.mjs --self-test` 通过：同一真实消费回调将 `batch.sequence` 写入 tracker，等待 `drain()` 解析完成，最后 `flushFinal` 严格核对 seal 对应序号；覆盖 90000 条编号行、Unicode/ANSI 尾部、最终光标和错误 seal 拒绝，并校验有限 workflow。该夹具已吸收 macOS 原生首轮暴露的“未传输出序号导致无效 final revision”问题，不把夹具修正当作 Windows 产品原生通过。避免在每个数据帧消费时重复序列化整份历史，最终快照与独立内容比对仍保留。provider core 六项、source 契约、Main 三项、reader 四项和 pipe 六项重新通过；provider/Main/pipes/reader/worker 及 namespace fixture 的严格独立 TypeScript 检查、两个新 mjs 语法检查与 diff 空白检查通过。上述均为 Linux 上的局部结果，无 Windows native 编译、装载、ConPTY 或实际包装链通过声明。

主体观察补充后同一自测再次通过，复用实际 `subjectExit`、产品退出判定和 cleanup 资源谓词，覆盖：原对象退出接受、主体未退出拒绝、StartTime 不一致拒绝、challenge 未绑定拒绝、exit124 拒绝、先 safety 后其他退出码拒绝，以及五组资源全部 released 仍不能代替主体退出。PowerShell 源契约确认只在取得时调用一次 GetProcessById、立即保留 SafeHandle、同对象等待及读取退出事实且没有 kill API；本地没有 PowerShell，不声称该脚本已通过 Windows/.NET 原生调用。新脚本随源码摘要归档，四例及所有产品预算未扩张。

独立只读复核未发现上述主体观察补丁的新确定性 blocker，复跑同一 self-test 和两个 mjs 语法检查通过；此结论仍不覆盖 Windows PowerShell、ConPTY 与实际包装链原生执行。

### 34.5 共享生产选择与 namespace 运行前契约

Windows profile显式为 `windows-owner-v1-candidate`，隔离generation为 `terminal-exit-windows-v1`；构建仅接受匹配资产与成对选择，普通构建仍stock。factory同时核对三份PE、版本/ABI、manifest及provider/worker入口摘要，构造不加载native；snapshot-only归Host、Runtime归Supervisor，旧live绑定不迁移。

namespace复用Node的Windows named-pipe listener，不增加新的native mutex API。名称由规范化 `realpath(storageDir)`（Windows不区分大小写比较）摘要形成，不包含backend/PID；同一Windows运行环境和registry必须竞争同一名称。Node所用libuv的 `uv_pipe_bind2` 通过 `FILE_FLAG_FIRST_PIPE_INSTANCE` 排斥已有server（已核对libuv v1.51.0 `src/win/pipe.c`），实际竞争/退出重取仍需原生验收。claim listener持到进程退出且unref，业务listener关闭不释放它；Windows endpoint先用连接确认未占用，不对named pipe做文件unlink。该范围仅本版参与者和本机存储slot，不是另列R1的root稳定归属实现。

共享provider控制IPC和独立fd4输出保留原帧/信用/消费屏障；Windows使用 `overlapped` stdio，防止同步管道写阻塞provider控制线程。真实Windows普通pipe及实际ConPTY验收必须证明该封装可用，不能仅删除平台guard就记为平台通过。provider终止仍只作用于已具备原父清理授权的直接child，不按PID强杀会话包装器或外部对象。

### 34.6 Windows Electron 与真实 Terminal 两模式接线

Windows Node 四例之后只增加既定的真实 Electron Terminal 两模式 `complete -> reopen`，不接入 capacity、reconnect、真实 Agent 或 packaged，不改34.4四例输入及其计时/清理。固定 Windows x64、VS Code1.117.0，须通过实际 Code.exe 的 `ELECTRON_RUN_AS_NODE=1` 确认 Electron39.8.7、Node22.22.1、ABI140；外层及受控写入主体仍为 Node25.6.0。重新使用现有 Windows builder 编译 Electron 资产，不能复用 Node25 addon/import library。Electron官方39.8.7 headers SHA256为 `af6712ab16c436b9288ece2f0173924c74008446346bda3457d07b769f402eda`，win-x64/node.lib 为 `ee92beea67d0f12ef058adc52d0f5344e1005153c9487d0f4d63cab91111421a`；沿用固定 node-gyp delay-load hook，实际装载仍须原生验证。

保留现有 Unix shell/exec 与验收行为。Windows 真实 Terminal 显式使用系统 cmd.exe、`/d /q`；专用受控.cmd在独立物理行等待Node主体后执行 `exit %errorlevel%`，不以 `/b` 返回交互提示符，也不在启动同一行预展开退出码。受控路径拒绝cmd会再解释的未支持字符，不建设通用shell解析器。Windows专用主体先READY，测试取得原SafeHandle后，通过实际PTY随机challenge及PID/PPID回执绑定主体，再放行固定输出；结束只接受该原对象的HasExited与exit0，不把未知/PID消失当成退出，不要求合法引用的系统对象消失。

Windows写入使用真实Node TTY write完成回调，保留原90000编号行、Unicode逐字节尾部、ANSI和拆分CSI，以及相同成功写入字节数量/摘要。成功回调的源字节另外保存，ConPTY输出可有合法VT重写，产品判据仍是实际Webview的90002行严格内容、最终光标(6,2)、原reader最终sequence、Runtime结束丢正文/重开空白和snapshot-only保留/重开恢复。若NodeTTY自身对逐字节UTF8解码存在差异，保存源与实际状态，保留失败，不删除Unicode断言，也不未经定位归因于产品尾部丢失。

Windows主体安全期限180秒、原进程对象观察期限270秒、失败后额外观察清理30秒，只约束本轮受控夹具，不改产品预算；safety回执或exit124不能通过，清理未确认记unsafe，不强杀未知PID。原生首败保留并停止后续阶段。新增脚本/observer/worker和编译来源摘要一并归档；仍须分别证明Windows编译、装载及两模式实际执行，本节冻结时无此原生通过声明。

实现后本地 `test-windows-execution-electron-input.mjs` 通过：直接加载实际Windows身份/退出判定辅助模块，覆盖未知、未绑定、StartTime不一致、非退出与safety/124拒绝；在受控成功TTY回调及内存文件系统下执行新的Windows writer和原Unix writer，完整源字节、写入数、SHA256及90000编号行相同，并核对.cmd独立退出行和workflow后置Electron输入。该VM回调不执行WindowsTTY解码，不能据此宣布逐字节UTF8原生通过。五个变更/新增JS入口语法检查、原Node四例`--self-test`及diff空白检查通过。失败清理只在reset成功、节点/Host绑定为空、且绑定原对象确认退出时记safe；原生OS资源总验收仍不由这一局部字段证明。

### 34.7 首次 Windows runner 的路径夹具失败

输入 `72ca0efe6ac0148529d5ff22209953797bded9d2` 的run `36821938613`/job `110239195433` 保留exit1。依赖安装、MSVC初始化、source契约及资产纯测试前九项通过，第十项构建选择断言比较了短路径 `C:\\Users\\RUNNER~1\\...` 与 `fs.promises.realpath` 返回的长路径 `C:\\Users\\runneradmin\\...` 而失败。Node编译、四例原生执行均skipped，也没有build/evidence目录可上传；不能写成Windows ConPTY产品失败。

修正仅将两处selection预期设为同一来源目录的 `await fs.promises.realpath(source)`；测试仍精确核对返回的规范路径、profile与不可变准入策略，不改产品路径校验、不改原始来源目录、不隐藏失败。Linux本地十二项纯检查修后通过，真实Windows修后结果仍待运行。

第二轮run `36822343054`/job `110240436059` 使用 `22376acd`，source/资产十二项/四例self-test全部通过，随后builder在调用MSVC前拒绝hook摘要，原生四例未执行。冻结LF摘要为 `ec2357ffdf512151c21a52326ad3396aaa650b83e5c4a31153d216a155f68ecc`，本轮实际文件摘要为 `b339840a98e7ad5106384473d94bde68dd3e8d34028dad64f09e5a6453bf8422`。独立核对本机与官方nodejs/node v25.6.0、node-gyp v12.1.0原始hook均为前者，1003字节、41个LF；仅把这41个LF改为CRLF后，1044字节精确得到本轮摘要。未完成官方Windows zip整包下载核验，不宣称其内部npm版本已核实。

因此正式builder和manifest校验只接受上述两个精确raw摘要，保留并编译原字节，manifest记录实际摘要；不自动归一化任意来源，不接受第三个hash。新增局部检查两种已知输入通过、混合换行和任一源码字节变化拒绝；不改变native实现、四例、预算或退出判据。第二轮exit1和后续未运行项保留，修后实际编译与运行另记。

### 34.8 Windows 启动前失败与最小定位输入

`86c53365` 的push run `36823205778` 与手动run `36825483498` 均实际编译/装载成功、namespace通过，在normal等待READY时失败，后两例及Electron未执行。两次输出均只有39字节的ConPTY控制序列，原cmd对象code1退出、真实source EOF、五组本方资源released；没有主体READY、challenge或退出收据，cleanup正确记unsafe，不能以资源释放代替主体身份。两份原始artifact保留。`sources.json` 与本地LF摘要不同已确认完全由Windows checkout的CRLF造成，逐一变换后三份test/subject/observer摘要相同；不是旧源码，也不是序列化丢字段。字段缺失是因为READY前未赋主体/observer。

本轮只增加直接影响启动判定的固定输入：先运行现有 `test-execution-session-bridge.mjs` 的Windows原生cmd参数分支；原.cmd增加进入及原退出码收据；主体在原TTY断言前记录固定启动事实，并通过uncaughtExceptionMonitor记录原异常而不改变默认失败退出。原执行已settled且仍无READY时及时明确失败，不再空等45秒。真实TTY、PPID、challenge、SafeHandle退出、安全超时拒绝和尾部断言不变，不绕开cmd，不先改native或shell产品代码。上述收据不是退出完整性验收通过，下一仅依据新证据定位启动链。

本地product self-test新增非TTY启动拒绝检查，确认exit1、启动/异常收据形成且无READY；原session bridge与Windows Electron输入测试亦通过。Linux上的这些局部检查不执行Windows API，尤其不能从启动收据代替原对象退出证据。

### 34.9 Windows ConPTY 标准句柄设置

输入 `b163ee7d` 的 run `36827234960` 中现成原生cmd回归、构建、装载与namespace通过，normal仍首败，后续未执行。新增 `A-startup.json` 确认实际 Node25.6.0 主体进入，stdinTTY/stdoutTTY均false；`A-uncaught-error.txt` 为原真实TTY断言，launcher原退出码1。由此定位到终端标准流连接，而不是未进入cmd或主体脚本；旧失败不追认通过。

产品 `native/windows-execution-owner.h` 的 `STARTUPINFOEXW` 漏了锁定node-pty上游 `src/win/conpty.cc` 中 `STARTF_USESTDHANDLES` 与三项标准句柄设NULL。上游修复 `95c9a01e1836cccca3b7a028a6369472ee527174`（fix handle inheritance for shells）及Microsoft Terminal issue11276的解释指出，父进程重定向pipe/file的标准句柄默认复制不会自动替换为ConPTY；必须显式指定NULL标准句柄以取得新终端。当前provider本身使用pipe/ignore stdio，符合此触发条件。

选定最小修正仅补该flag和stdin/stdout/stderr三NULL，保持 `CreateProcessW` 的 `bInheritHandles=false`、原cmd启动链、Job/原进程句柄所有权及EOF/尾部/清理断言。先以源码契约回归冻结此设置，再运行同一Windows原生四例和后置Electron验收；Linux局部检查不代证Windows修后实际TTY或尾部通过。Windows正常已退出对象被外部句柄引用的语义与此缺陷无关，不尝试清除外部句柄。

四行native修正已实施。新增source契约在原实现实际exit1，修后通过；source、main/core、factory、pipes/output、assets、Electron input、session bridge及product self-test十条局部命令全部通过。验证环境为Linux，未执行Windows API；真正TTY连接、主体尾部及原生四例仍待同一新输入的runner。

### 34.10 Windows 真实 Agent 的既定验收接线

Windows继续32.20的真实Codex0.157.1/Claude2.1.280、DeepSeek、两模式natural/stop八场景，四次计划自然模型turns、失败即停、不自动重试、步骤级凭据和脱敏summary不变。先通过同产物Terminal原生/页面基线，再手动触发真实Agent；接线本身不是Agent通过，不新增独立诊断矩阵。

`scripts/smoke/run-vscode-agent-candidate.mjs` 选择Windows明确的npm `.cmd` 而不是同名POSIX shim，版本/MCP/认证预检复用产品 `resolveExecutionSessionSpawnSpec` 的cmd参数和 `windowsVerbatimArguments`。Windows全局npm目录不必与node.exe目录相同，但实际Codex Node wrapper必须使用固定Node25.6.0。固定包安装清单核对实际主体：Codex为 `cmd.exe -> node.exe bin/codex.js -> codex.exe`；Claude为 `cmd.exe -> bin/claude.exe`，不凭shim realpath或basename推定CLI。产品command parser已将customLaunchCommand还原为argv，不额外手写另一套cmd转义。

现有 `tests/vscode-smoke/agent-candidate-process-observer.cjs` 增加Windows后端，单个场景期PowerShell助手在createNode前启动。根为当前Host和绑定hello的Supervisor；CIM只发现具名启动链，随后立即保留原Process.SafeHandle，核对创建身份、实际exe及父对象身份。只观察provider、cmd launcher、Codex Node wrapper和实际CLI；普通工具后代不升级为托管对象。后续退出须有原对象HasExited/WaitForExit/ExitCode事实，不以PID不存在、Unix Z/X或合法对象仍被引用替代。真实CLI没有fixture challenge收据，不伪造；未捕获主体或身份不明必须明确失败/unknown，不从包装器结束补造CLI结束。沿既有有限观察期限、失败即停和错误不伪报规则，不扩容量/洪泛/归档框架。

清理先调用产品resetState；失败时仅可对已绑定原句柄的本场景CLI/wrapper/provider定点强制清理，记录动作且场景仍失败，不用taskkill树杀、按名清理或向未知PID发信号。observer完成后释放自身句柄；本方资源退役与OS对象销毁分开。现有summary增加Windows平台和未知/未确认退出计数，原内容扫描保持，不上传raw或任意命令行。

DeepSeek私有配置内容和销毁流程复用，但Windows文件mode不冒充POSIX隔离。独立临时配置目录在写key前应用并核对仅当前runner用户与SYSTEM的DACL；无法确认则失败且不启动Agent。新Windows workflow手动、单job、匹配Electron候选构建，共用既有real-agent concurrency；secret只进入最终验收step，仅report_ready时上传sanitized summary。Windows auth-only旧旁路暂明确不支持，不成为原八场景前置。局部定向回归后仍须Windows实际运行，Linux/macOS通过不代证。

GitHub实际读取及dispatch新的macOS文件均返回404：仅特性分支存在的workflow_dispatch文件尚未注册，不能靠反复请求启动。为不提前合并主线或扩展带凭据的push/PR触发，选定复用已注册 `runtime-exit-integrity-native.yml` 的手动入口，保留 `real_agents` 布尔并新增默认linux的平台choice；原stock与Linux语义保持，每次仅选一个Agent平台。macOS/Windows文件同时声明 `workflow_call`，由该入口在同一ref显式传递唯一所需secret；不使用 `secrets: inherit`。共享Agent并发组不变，局部契约校验单平台选择与secret边界，实际dispatch仍需平台基线通过。

实施中复核的身份细节保持收窄：CIM发现后保留原handle，再定向读回同一PID的command line/父PID/exe，并以前后原对象仍live将这次读取绑定到原对象；不符或过早退出记unknown，不重开PID替换身份。`WaitForExit(0)=false`后`HasExited=true`是正常推进，只拒绝反向变化。summary只有完整捕获Host、必要Supervisor、provider、cmd、Codex Node wrapper和实际CLI且无unknown才给出退出计数；漏采/助手错误不能把空集合写成0。Windows无凭据前置检查用自有Node自然exit7验证保留原对象和释放本方handle，不要求对象全局消失。

CLI选择、Windows observer、原Unix observer、CI summary、私有配置、三平台workflow六项局部回归均通过，typecheck、smoke env与Electron输入回归另行复核。凭据DACL/dispatcher与核心observer/CLI分别独立只读审查，无确定阻塞；Linux局部替身不代证Windows PowerShell/DACL调用。清理请求已发但结果失联时记原句柄signal-unconfirmed，不伪称未发信号。所有真实Agent场景仍为既定八项，接线成功不计作模型响应或产品退出通过。

### 34.11 Windows Electron 构建必须等待原进程

输入353bb575的run36829311128已通过原Node四场景，但后置Electron构建失败、页面未执行。原日志07:19:03的 `build.mjs` 报 `windows-electron-build` 不存在，07:19:05原native builder才报告compiled=true；PowerShell直接调用GUI程序Code.exe后提前继续，没有等待其原进程完成。该失败属于实际构建顺序，不是Node尾部回归，也不能将Node通过复制为Electron通过。

选定在两个Windows验收workflow的既有构建step里，以Node `spawnSync()` 顺序等待Code.exe版本probe和原native builder，逐一检查启动error、signal和退出码，任何失败不进入后续build。`ELECTRON_RUN_AS_NODE=1` 仅在这两个子进程环境中设置，随后仍由固定Node执行原扩展build。资产摘要、版本、四场景和页面断言不变；局部回归直接执行YAML中该固定JS块的受控进程替身，验证顺序、原参数及失败阻止后续构建，不新增通用进程框架。原run failure保留，修后实际Electron及页面结果另记。

原artifact已下载至 `.debug/windows-product-36829311128` 并独立对账：normal实际主体code7，90000编号行/Unicode与ANSI终态通过，原写入1530184bytes/SHA256 `567ee41cadd0f12583a77e8ce4e056f330df6950da08df00cddf074e59c1461a`，467帧连续且完整消费/真实EOF。ConPTY合法VT转换使帧文本摘要不同，未宣称字节同一。paused-stop实际EOF59帧，paused-cancel明确interrupted24帧，二者保留主动停止及不承诺未来写入；B交互分别15.7925/15.9919ms且与A收尾重叠。三份原帧文件均连续、无不完整帧且与保存output一致，主体observer绑定原对象并观测退出；namespace加三例的cleanupSafe均true。该四例不代证Webview/Electron/Agent；整轮仍因构建顺序failure。

本次构建顺序回归先在旧workflow实际exit1，修后同一测试通过，并覆盖原子进程启动错误、signal、probe非零和builder非零阻止后续。product self-test也通过，未运行新原生场景；下一仅复验原Windows流水线。

修后输入f35c023c的run36830583121/job110266023730于07:35:01Z报告success，匹配Electron构建不再停在未生成资产目录；页面步骤07:31:36至07:32:52也显示success。但artifact完整ZIP目录61289条中，只有live-runtime completed.json，没有任何reopened.json/cleanup.json或snapshot-only completed.json；snapshot-only目录本身存在，非范围提取漏筛。故该绿灯不能计作两模式页面验收通过。当前直接定位宿主/runner退出传播与报告形成，WindowsAgent暂不调度；Node证据、原进程句柄/合法VT转换口径及所有旧失败分别保留，不为缺报告推断产品尾部已丢失。

### 34.12 Windows 测试必须等待真正宿主而非 CLI 转交

36830583121完整目录、job.log及小报告保存在 `.debug/windows-success-36830583121/`，仅按范围下载10213464bytes，未下载448MB整包。原input确认两模式计划与partialSelection=false；Node四例各自pass/cleanupSafe，normal90000行/光标(6,4)/exit7/EOF，两个暂停场景分别EOF/interrupted、B交互15.9666/15.7925ms，仍按主动停止记录。唯一Runtime completed证明90002行/光标(6,2)、source EOF、applied1383与616bytes轻量节点；这不补造缺失的其余五份报告。

直接时间证据：外层四次Exit0后于07:32:51.826Z打印整体passed，snapshot主体却于07:32:58.740Z才启动。Runtime的EOF07:32:22.475Z和applied07:32:27.500Z也晚于其前两次外层Exit0。`scripts/smoke/vscode-smoke-runner.mjs` 的Windows `resolveVSCodeTestLaunchPath()` 把实际Code.exe改为bin/code.cmd，并以shell:true启动；VS Code1.117.0的CLI在无wait/verbose时detached启动真正宿主，等待约1秒stdin listener后返回0。`--extensionTestsPath`不改变此转交语义，因此被等待的是CLI/shell，不是测试宿主。

选定窄修：测试启动直接用Node spawn原Code.exe、shell:false等待原进程，Linux/macOS语义保持；安装扩展等真正CLI用途仍使用原CLI解析。`run-vscode-execution-candidate.mjs` 在每次complete/reopen返回后读取该阶段既有必需报告，核对mode、phase所需内容及pass；缺失或失败立即停止，不再仅凭进程0打印整轮成功。沿现有runner和Electron输入测试取得旧实现先红并覆盖原进程等待/非零/缺报告，再复验原Windows流水线，不增加新的工具矩阵、延时或宽松尾部判据。此处只是运行前修正设计，原job绿灯不追认为真实测试通过。

上述四文件窄修已实施，旧launcher真实spawn捕获和旧orchestration缺报告仍继续四次launch两条确定红分别保留在 `.debug/windows-launcher-original-red-20261001-01.log`、`.debug/windows-phase-reports-original-red-20261001-01.log`。修后env、Electron input（原loop一正向/十五负向）、Agent workflow与语法/diff检查通过，root独立复跑三项同样通过。没有业务或预算改动，Windows实际修后结果仍待原流水线；macOS本轮Agent输入冻结于b1628715，不回填此新等待实现。

修后926889c0的Windows run36834158313在真实宿主内首败并返回exit1，未继续后续阶段；joblog保存于 `.debug/windows-launcher-fixed-36834158313-job.log`。原Node四例及Electron构建通过，具体失败为 `execution-candidate-tests.cjs` 的初始reader身份断言，不是新的尾部缺失结论。同输入macOS36834158241工作流success，范围仍仅原Terminal矩阵，不代证Agent或全平台完成。

源码确认该Windows首败涉及一个跨平台测试前提缺口：`applyRuntimeSupervisorSnapshot()` 先更新liveSession/postState，再异步 `postExecutionSnapshot()`；paged snapshot还须等client与relay.open。页面registry在发attach请求前创建，probe中的cols/rows只证明本地xterm已创建，不证明原reader身份已返回。当前test在live和尺寸poll后立即读取一次messages，二者没有身份到达的先后保证；不能以此判定产品没有reader。原native失败报告继续保留，缺少该次完整消息时间线时不声称已测得每个异步调用的原生时间。

选定两文件窄修：在原mounted那一次30秒poll内同时读取probe与messages，接受条件同时包含原尺寸条件和原节点的executionSessionId snapshot，复用该轮消息继续原身份断言及Runtime sessionId严格相等。不给身份缺失额外30秒，不降低90000行/UTF-8/光标/主体与资源断言，不改业务。现有Electron输入测试直接执行该实际poll片段，冻结已mounted但snapshot延迟到50ms的先红、同预算等待成功，以及身份始终缺失在原截止失败；这属于当前验收前提修正，不增加独立工具矩阵。

原artifact九份小报告已范围提取至 `.debug/windows-product-36834158313/small-reports/`。失败probe为122x30且空白；稍后catch保存的messages已有同node、同runtimeSessionId的executionSnapshot和terminalRead，events于08:08:17.680Z记录terminalPagedReadOpened。这直接证明该次读取早于身份返回，不是原reader始终未建立；失败发生在writer启动前。cleanup仅证明resetStateComplete及nodes/bindings为零，observer尚未取得主体时safe=false保持，不冒称完整OS清理。旧实现受控确定红保留在 `.debug/windows-mounted-identity-original-red-20261001-01.log`；修后五例覆盖身份/尺寸分别迟到、身份缺失、共享截止及错误Runtime身份拒绝，原尾部断言不变。

修后6d622bee的run36836728391/job110285817329完整success，六份completed/reopened/cleanup及四份environment已范围提取并独立对账，保存于 `.debug/windows-product-36836728391/`，汇总为report-crosscheck.json。实际VS Code1.117.0/Electron39.8.7/Node22.22.1/ABI140，两模式原writer句柄观测exit0、成功写入5580102bytes，原90002行/UTF-8/ANSI/最终光标(6,2)通过，source均EOF、同execution reader applied/finalRevision1379。Runtime节点616bytes且重开closed无历史/空终端；snapshot-only节点5766998bytes、原终态重开保留。两个complete/reopen Host PID各不同，cleanup均pass且bindings0。只读取548209bytes小报告而非491.5MB整包；该实际通过解除Windows原定Agent验收前提，首次Agent输入仍为同6d622bee，手动run36838248572，尚无Agent结果。原失败不追认，不要求已退出OS对象因其他合法引用而消失，也不关闭全A5。

首次Windows Agent run36838248572/job110290820480实际failure，原日志 `.debug/windows-agent-36838248572-job.log` 保留。失败位于无凭据前置 `test-agent-candidate-deepseek.mjs:16`，createDeepSeekConfiguration只报告安全通用错误；CLI安装、候选构建、真实验收/secret步骤均未运行。step开始08:45:46.91Z、失败08:46:02.28Z，与私有目录PowerShell的15000ms上限相近但不能据此确认超时。当前先核对具体私有目录阶段/进程结果，不提高期限、不放宽DACL、不要求用户重配key，不从前置失败推断Agent/终端产品缺陷。

为定位这一安全前置，选定只在原配置helper及其测试补固定字段错误属性：配置stage、PowerShell最近白名单阶段、code整数/具名OS码、signal白名单、killed布尔、durationMs与原timeoutMs、readyTokenMatched和stderrPresent。脚本只增加少量固定阶段标记，验证仍须全部原DACL规则及最终ready；不记录原stdout/stderr、路径、env、command、cause或原错误文本，也不打印key。execFile没有权威timedOut字段，不能把killed/耗时写成已确认超时。原通用报错、15000ms、fail-closed及清理不变；局部测试验证安全字段与key/raw不泄露后，仅复验原Windows前置/矩阵，不建立通用诊断设施。测试后段外层10000ms小于内层15000ms另记尚未到达的风险，不据此归因本次失败或提前放宽。

固定9f342320的Windows run36840316777/job110297648135仍在无凭据前置首个配置失败；安全字段为protect-directory、inspect-directory、code=null、signal=SIGTERM、killed=true、durationMs=15021、timeoutMs=15000、ready=false、stderrPresent=false。原日志 `.debug/windows-agent-36840316777-job.log` 保留。它限定到Get-Item/Get-ChildItem所在检查段，未到build-acl，不能确认是具体cmdlet、模块自动加载还是文件系统耗时；CLI和真实Agent仍未运行。

下一窄修选定在固定Windows PowerShell 5.1脚本内直接使用.NET Framework的DirectoryInfo/FileInfo与GetAccessControl/SetAccessControl，避免私有最小env路径隐式依赖Management/Utility模块自动加载。目录存在、非reparse point、空目录、owner、禁止继承、仅当前SID/SYSTEM及精确FullControl/继承flags的检查全部保留；SID去重/逐条匹配用语言内建循环。原独立文件ACL验收同样用明确固定字段传入路径和.NET读取，不通过继承任意环境解决。不增权限、不修改15秒或外层10秒，不预判该依赖消除必然修好；局部契约及原Windows前置/矩阵另取一次新证据，旧失败不改。

新输入e10ad8aa的Windows run36841262535/job110300678158中，原DeepSeek配置测试已完整通过（包含真实目录/文件ACL及isolatedCheck），原15秒/10秒不变。这说明.NET依赖收窄后的新输入可用，不倒推旧Get-Item段的具体内部原因。随后Darwin observer纯夹具第57行失败：模拟process.platform=darwin却仍require宿主Windows的node:path，fixture argv为POSIX而provider目标被拼成反斜杠，实际roles的provider变descendant。选定只让该Darwin夹具显式使用path.posix，保留原roles/cleanup断言和生产observer；不把未进入的真实Windows Agent记作产品失败。原日志 `.debug/windows-agent-36841262535-job.log` 保留。

1aebd444的Windows run36842061186/job110303408565再次通过配置和Darwin夹具，随后真实Windows observer初始化未在原10秒请求期限内回应，helper-request-deadline，CLI安装/模型仍未运行。原日志 `.debug/windows-agent-36842061186-job.log` 保留。该helper启动需要New-Object/Add-Type/JSON和CIM模块，但其最小env没有明确模块路径；只有宿主完整环境下的语法/原对象单调性测试已通过，不将初始化失联认作OS对象泄漏。

下一限定该安全观察器的启动依赖：从固定powershell.exe的PSHOME/Modules显式导入Microsoft.PowerShell.Utility、Microsoft.PowerShell.Management和CimCmdlets，模块发现路径仅指向此系统目录、关闭自动加载，不继承用户PSModulePath或任何凭据环境。原Same-Path/保留SafeHandle/CIM身份绑定/exit及cleanup断言、原10秒和失败unknown保持。先局部源契约，再一次原Windows前置/矩阵；不能据假helper通过声称PowerShell或CLI已验，也不展开一般observer健壮性。

## 35. A5 固定 VSIX 的实际安装路径

本项只补既定A5的Linux installed candidate，不新增平台诊断，也不代证完整分发准入。现有 `run-vscode-vsix-smoke.mjs` 重建stock并改装development扩展，正确范围仅为payload smoke；不能把它当成未改装VSIX的安装证据。选定在 `scripts/smoke/run-vscode-execution-candidate.mjs` 新增显式 `--installed-vsix`，只接收固定文件，不自动重建或选择最新包，首轮不与capacity选择混用。

从指定VSIX提取manifest及业务/native摘要作为预期，记录整个VSIX SHA256。原VSIX通过VS Code CLI安装到本轮隔离extensionsDir，manifest/main不改写；使用不同extension id的最小development test-driver承载原测试、helper与fixture，不复制业务dist、不手动转发主扩展activate/context。原测试仍通过真实产品id激活已安装扩展；沿现有 `DEV_SESSION_CANVAS_SMOKE_TEST_MODE=1` 测试命令gate，不放宽native候选注入条件。原manifest只有推荐extensionPack，可用固定CLI已支持的 `--do-not-include-pack-dependencies` 跳过companion自动下载，明确本项不验证notifier，而非删除manifest字段。

每次complete/reopen的environment收据必须记录实际extensionPath、业务id/version/main和实际安装文件摘要，校验规范路径位于本轮extensionsDir而非workspace、driver或解包目录，并与同一VSIX预期一致。外层保留原phase、mode、node id、pass及空bindings报告检查；进程exit0不能代证。固定两模式complete/reopen共四次Host启动，90002行、UTF-8、ANSI最终光标、原reader settlement、Runtime无历史和snapshot-only恢复断言保持，失败即停并保留第一现场，不自动重试。

直接调用 `node scripts/release/package-vsix.mjs` 保存明确选定的匹配Linux Electron candidate dist；不调用会重建stock的npm打包命令。实施前先核对资产仍匹配当前源码并记录来源；未运行或前置失败不能记为installed通过。此设计不预支macOS/Windows、真实Agent、Remote或六资产支持格，Windows installer接线风险不设为Linux前置。

接线及七组有限纯测试已完成，原Windows输入回归仅在VM context声明installedInput=undefined以继续原非installed分支，原断言不变。主线独立review及两项复跑通过。业务采用6d622bee的production候选构建、原 `.debug/linux-shared-owner-20261001-assets` 匹配Electron资产，owner/shared-owner/patch摘要逐一核对未变；调用原packager生成固定 `dev-session-canvas-0.25.0.vsix`，SHA256为 `604494fdebc917d3e12b54fceec75a764ed064e486dd0e76ff20513ddca61656`。此包仅本地验收，不发布。

首轮 `.debug/a5-installed-candidate-20261001-first/` 原两模式四次Host启动完整exit0。四份environment收据均为实际VS Code1.117.0/Electron39.8.7/Node22.22.1/ABI140，主扩展来自各自隔离extensions目录，原manifest加载身份和八份业务/native文件摘要匹配同一冻结VSIX，driver没有业务dist。六份completed/reopened/cleanup报告全部通过，原节点id保持；两个主体均成功写入5580102bytes，原90002行/UTF-8/ANSI与光标(6,2)检查通过，source均真实EOF。Runtime最终applied1407、节点650bytes、重开无历史；snapshot-only最终applied1391、节点5767032bytes，重开保留5580063字符快照。两cleanup的Host bindings及pending operations均0，后续按本轮独立目录查无残留命令行进程；不把该检查扩大为全部OS资源证明。该固定Linux installed子项收口，不关闭其余A5、Agent/Remote或默认启用。

## 36. A1/A2 文件系统失败的有限组合验证

既有高层journal/flush拒绝和persistState替身已覆盖失败保留责任，但不能代证真实异步写入错误贯穿生产消费/删除顺序。只补两类输入，各沿原Terminal/Agent参数化，不重跑成功容量矩阵，不先改业务，不以模拟故障冒充实际OS满盘。

A1在 `test-supervisor-execution-owner-wiring.mjs` 复用实际Server/TerminalSessionJournal，仅让目标journal路径的 `fs.promises.appendFile` 对一条短output抛带ENOSPC的原错误，不替换journal.appendOutput/flush。必须保留terminalJournalError、consumedThrough=0且无consumed ACK、原session/journal责任；stop请求不等于进程已退或settled/applied，另一已存在会话仍可消费。失败注入移除后不伪造恢复已损失的来源，按原fixture清理责任。

A2在 `test-host-execution-owner-wiring.mjs` 的真实persistenceFixture中种原Runtime绑定和已保存文件，通过将root临时文件路径占用为目录触发实际writer失败，调用原 `applyCompletedRuntimeSupervisorSnapshot`，不替换persistState。必须拒绝保存、旧root/workspace文件仍可读，原runtimeSessionId/runtimeStoragePath、binding及managed session未释放，strict delete为零。该验证不声称实际Webview告警/控制可用性已验，也不替代保存成功路径或旧live共存；出现直接失败再据证据设计最小业务修正。

两类各Terminal/Agent实际模块用例通过，未修改业务。A1验证实际异步append错误进入journal.writeError及Supervisor authorityFailure，原manifest未提升、已接收内容仍在原session/tracker、没有consumed ACK且请求stop不冒充退出；另一session消费成功，去除注入后flush仍拒绝原错误。fixture清理仅逐个assert.rejects事先登记的原错误，不吞未知失败或清掉业务错误。A2验证root临时路径目录导致实际EISDIR，原root/workspace字节未变，原Runtime身份/state/rootStates/binding/managed保留，dispose和strict delete均0。Supervisor94/94、Host147/147及root独立完整复跑通过，日志为 `.debug/a1-journal-enospc-supervisor-wiring-20261001.log`、`.debug/a2-root-save-failure-host-wiring-20261001.log`。无实际OS满盘、Webview或原生新通过声明，剩余A1/A2按有限清单继续。

## 37. A5 构建基线与默认分发收尾

当前精确runtime tuple是候选来源/准入限制，不直接等于真实ABI下限。已只读核对Linux installed addon的N-API注册返回8，manifest的10只是构建宿主观测；该候选ELF实际最高要求GLIBC_2.34，而锁定stock为2.28。macOS旧候选36825479993的addon/helper实际Mach-O minos均26.0，stock arm64为11.0、x64为10.7。这些是二进制静态事实，不代表旧系统实际装载结果。不能将新构建机版本倒推产品最低要求，也不能只删gate而忽略真实系统库依赖。

有限实现方向是保留完整构建tuple/hash来源，另明确实际N-API/OS/架构/系统库要求；沿既有builder在原支持基线编译，六资产完整打包并按实际执行端选择。Linux旧宿主需要与新宿主竞争同名abstract socket的native claim，不另设互不相干的锁；Windows named pipe不直接继承Linux的Node20.8门槛。继续使用原Extension Host executable，不捆绑Node、不新增下载器；Remote按远端平台。旧live不迁移、缺新能力不静默回落；本段不是默认启用或平台通过声明。

本次先独立修正macOS构建下限：`macos-execution-candidate-assets.mjs` 的共用target参数固定arm64=11.0、x64=10.13，addon/helper都显式带 `-mmacosx-version-min`，不开放任意target覆盖。arm64与原资产及Apple Silicon起点一致；VS Code1.80.0官方.yarnrc使用Electron22.3.14，其支持基线为10.13，因此x64不跟随stock声明的10.7，也不偷升到10.15/26。保留C++17，不将语言标准当OS下限。build/read/import共同检查两个实际Mach-O的LC_BUILD_VERSION或LC_VERSION_MIN_MACOSX及固定目标；缺失/冲突/截断或错误平台拒绝，不能仅相信manifest或编译参数。原runtime factory精确gate暂不改，hash/路径/目标校验保持。

必须独立保留API兼容风险：候选及锁定stock均无条件使用POSIX_SPAWN_SETSID，而Apple XNU10.13/10.14对应头中该位尚未定义，10.15系列才有该flag。固定链接target不证明旧系统PTY创建可用，也不因此提高产品支持线；正式兼容验收仍须处理。此次仅原builder/资产纯测试和既有macOS构建入口验证，不追加一般兼容框架。旧26.0产物与结果保留，不重新包装为已修正产物。

固定target和实际Mach-O检查已实施于原builder/test两文件，未改factory或native API。原26.0缺拒绝和混合外来平台声明两项先红保留；最终18/18资产纯测、11/11运行选择和factory两架构mock通过，root均独立复跑。旧run36825479993实际26.0产物read/import拒绝，manifest/addon/helper前后摘要不变。日志 `.debug/macos-deployment-target-original-20261001.log`、`.debug/macos-deployment-foreign-platform-original-20261001.log` 及各自修后记录保留。仅是离线校验，不宣称修后macOS原生编译或旧OS可用；下一由原macOS产品workflow编译/装载验证固定target，其他分发责任保持。

六资产明确指原packager要求的Linux x64/arm64 glibc、Darwin x64/arm64、Windows x64/arm64，而非三平台各两个Node/Electron包。当前candidate的单profile/单目录build、Linux固定x64和精确runtime/libc相等gate仍需实际改造；不能靠多下载几个现有包完成默认分发。锁定stock的Linux两架构ELF还要求GLIBCXX_3.4.22/CXXABI_1.3.9，兼容构建不能只核GLIBC_2.28。GitHub托管的Ubuntu arm、macOS Intel/arm和Windows arm runner可用于六格构建接线，不需要现在向用户索要ARM机器；最新runner仍不提供macOS10.13/14或Windows1809的最低OS API证明。

Windows namespace窄修保持既定平台能力分流：`runtimeSupervisorNamespace.ts` 的win32 named pipe不再继承Linux abstract socket Node20.8门槛，路径canonicalization/大小写身份、同名竞争、claim持有到退出与活动/unknown拒绝均不变。VS Code1.80.0对应Electron22.3.14/Node16.17.1，后者libuv的Windows pipe已使用 `FILE_FLAG_FIRST_PIPE_INSTANCE`，这一能力不是Node20.8新增。定向测试以Windows16.17.1先红，再验证16.17.1/18.20.8/20.7.0的同名和拒绝规则；Linux旧Node仍拒绝、Darwin仍要求native claim/getuid，原Linux7/7通过。一次长TMPDIR导致测试socket路径过长的前置失败保留，改用短临时根执行原断言，不改变产品路径预算。此次仅解除namespace层误限，不改工厂精确gate、不宣称旧Node/旧OS原生或六资产已验。

macOS旧API缺口的正式修正选择：保留现有 `posix_spawn`、stdio/slave file actions及同PID helper→实际CLI的exec启动链，不改为fork或额外daemon；从owner的spawn flags移除 `POSIX_SPAWN_SETSID`，由已验证helper在exec前先 `setsid()`，再打开原slave取得controlling terminal。helper参数、setsid、ttyname、open或close失败必须非零退出，不继续exec；posix_spawn成功后的helper失败仍是已取得child的非零退出，由原waitpid/source/master责任结算，不能伪称未创建资源。owner已使用原PID直接signal而非进程组，保留该边界；stdio在spawn actions中连续持有，不产生新的无slave窗口。spawn返回仍不代表CLI就绪，原READY后的输入/resize/停止与真实Agent链验收不削减。builder保留upstream helper/source hash，新增实际patched helper输入hash并重编两资产；x64=10.13/arm64=11.0目标不变。窄受控helper失败测试不代证原生，修后应沿原macOS Node四场、Electron两模式complete/reopen及真实Agent八场复验；最新runner仍不证明10.13/14实际可用。

上述helper改造已实施，`test-macos-execution-spawn-helper.mjs` 编译实际patched helper并仅替换系统调用为受控输入，八项覆盖参数、setsid/ttyname/open/close/chdir/exec失败及原argv成功顺序；`--baseline-ref=b5f53cdf`使用原builder确实编译的upstream helper未满足新setup契约而exit1，新实现exit0，不把这条差异写成旧macOS原生失败。provider source、资产18/18、两架构factory、runtime selection11/11、原product self-test、workflow contract及typecheck通过；独立review重跑无阻塞。新测试已加入原macOS产品workflow，未追加原生场景。当前只有局部证据，原macOS通过仍属于旧helper，待同一新提交的原流程回收。

## 38. A3 实际 surface 切换与跨 Host reader 隔离

同一Host只允许一个interactive surface：切editor使panel进入standby，切panel会dispose editor；实际并发有效读者应来自两个Host。原定向夹具直接设置activeSurface只能证明受控隔离，不能当双active产品路径。复用既有Linux candidate、真实90000行主体、VS Code launcher和页面内容断言，固定两例，不引入假Agent、手工Runtime metadata或业务hook。

Runtime例让A/B两个真实Host打开同一全新root，使用各自user-data及测试自有同一XDG_RUNTIME_DIR；两份prepareRuntime必须在启动任何Host前完成，避免后来准备删除已使用的runtime目录。A自然创建Terminal并flush root，B从该root正常恢复原backend/storage/session/kind。A/editor和B/panel有不同Host PID及readId、相同session/authority后开始原主体输出。主体在第45000行成功写入后进入唯一可选、最长60秒的fixture gate，记录原主体身份；超时明确失败/exit124，不当正常通过。A真实执行editor→panel→editor，各生命周期及reader更换，B保留原readId；放行原主体后双方都验证完整90002行、UTF-8/ANSI/OSC尾部、光标(6,2)、成功写入字节/hash、真实source EOF及同执行/最终revision的各自applied，Runtime无历史/原binding删除。不能以B重新开reader代证原reader未受取消影响。

snapshot-only例只有一个Host，在相同gate处由panel切editor，保持原本地执行身份，最后同样检查完整尾部/光标/local applied及完整保存；不伪造跨Host共享本地进程。gate仅保证切换发生在主体未结束时，不代证慢消费者。原主体无gate路径的输出字节、默认行为及旧断言保持；新增可选gate的独立回归检查原hash不变及超时不能通过。

失败先保存首次事实，双方仍沿原产品reset/stop及同一原主体身份清理；检查bindings/pending operations归零并等待主体退出，再关闭所创建Host。未知退出/资源失败如实报告，不按全机PID扫描强杀。自动surface关闭目前没有远端close ACK专用成功诊断，只声明实际surface取消与B原reader延续，不补造ACK。该两例不关闭全部A3、非零/force/delete/读错组合、真实Agent、其他平台或A6实际reload。

## 39. A6 一次真实 Reload Window

现有real-reopen和capacity reconnect是两次launcher，不代证真正 `workbench.action.reloadWindow`。固定VS Code1.117.0源码（10c8e557c8b9f9ed0a87f61f1c9a44bde731c409）在reload保留extensionTestsPath，但旧Workbench停止RPC会拒绝尚未返回的extensionTestsExecute，其catch请求CLI测试实例退出；setup正常返回也会退出。因此本例不挂起原测试run跨reload，不把两次启动伪装成reload。

复用第35节固定Linux installed VSIX、隔离runtime、独立driver及原UI进程launcher。新增一个onStartupFinished activation-driver，不传extensionTestsPath，不承载/转发业务activation；原launcher仅支持省略该可选参数，原测试调用保持。driver通过固定控制文件区分setup/verify，成功和失败写具名收据，不将UI退出0当验收成功。外层只spawn一次，整体上限180秒；中途退出、缺verify/cleanup或截止均失败，不再次启动取绿。

固定Runtime例只创建A/B两个Terminal，不运行容量负载：A复用capacity主体的b角色做ready/ping/finish；B写一条固定marker正常退出，须当前页完整应用并落盘completed无历史。记录A原execution/backend/storage、Supervisor/provider/主体身份，旧Host和reader/frame；原子写phase=verify后发真正reload命令。新driver确认旧Host退出、新Host及reader/frame不同，外层确认原UI child/PID/startTicks/executable不变；A沿原Supervisor/provider/主体和execution重连，在真实页面新nonce ping响应通过，B保持closed/no-history且attach空终態、不启动新进程。最后A经原输入finish自然完成、reader applied、无历史、bindings/pending归零，再关闭本轮窗口。

reload前持久交接原资源身份及隔离storage，失败先保存首次事实并由当前driver走产品reset；新Host未起来时只允许外层核实原PID/startTicks/executable后清理本轮责任，不PID-only或泛杀进程树，fallback signal单列且不称产品清理通过。本例不覆写原证据、不重跑冷恢复容量，也不代证snapshot-only旧Host结束收尾、多根失败隔离或全部A6。

2026-10-01首轮 `.debug/a6-real-reload-20261001-first/` 完整exit0，整体9297ms。固定包SHA604494fd与两Host实际安装路径/payload摘要均核对；UI PID4052117保持，Host4052471换为4053129，frame及readId更换，A原Supervisor/provider/主体和backend/storage/session保持。reload后新nonce在实际xterm中11ms应用，B原completed保持空attach/无历史且无新start事件；A随后自然完成、原新reader最终applied，bindings/pending/nodes均0，fallback为空。root重新读取独立收据并执行同一严格校验通过；局部7/7和原launcher环境回归通过。清理收据采样时磁盘registry仍有此前live快照，不能称该采样已落盘清空；本轮自有idle Supervisor正常SIGTERM退出后，实际registry为sessions=[]。该一次真实Runtime reload子项不再排队，其他A6边界保持。

同日A3第38节首跑 `.debug/a3-reader-isolation-20261001-first/` 在live-runtime attacher的“恢复原live绑定”处超时；owner与attacher使用不同的VS Code user-data，因此各自生成不同 workspace storage，attacher只看到默认引导节点，未进入主体、reader或CLI验收。该失败是夹具存储拓扑与“同一root”前提冲突，不是产品通过或产品缺陷证据；snapshot-only未因首例失败进入。后续修正必须保持真实双Host、原持久化路径和不注入metadata，且保留该原始失败。

同日修正后 `.debug/a3-reader-isolation-20261001-fixed/` 完整exit0。A3夹具仍使用两个独立Host/user-data，但在B启动前从owner `dumpHostDiagnostics().storage.extensionStoragePath`复制已flush的扩展持久化目录到B对应workspace-storage slot；排除VS Code锁、SQLite与socket，源/目标hash均为 `0cee0d04...28fa8`，B真实 `state/loadSelected` 命中复制的 `canvas-state.json`，metadata中的runtime binding仍指向owner实际Supervisor。live-runtime两Host PID1491/2600共享同一execution，B保留初始readId；A完成editor→panel→editor，最终两端revision 1405、90000行主体尾部/光标/EOF/applied/no-history均通过。snapshot-only单Host最终revision 1402、完整buffer/EOF/applied和保存快照通过；两例cleanup均无强杀。该夹具证明真实surface与跨Host reader隔离，不代证慢消费者、force/delete、其他平台或全部A3。

Windows Agent `36843457341` 首场在 `agent-candidate-tests.cjs:121` 的测试 storage containment 断言失败，发生在Supervisor hello、observer和CLI生命周期验收之前；Windows盘符大小写与VS Code `fsPath`规范化可使旧 `startsWith` 误拒绝合法子路径。新增的窄 helper/test改用realpath与平台relative严格子路径判断，仍拒绝父目录、相邻前缀、跨盘和symlink逃逸；原失败不追认通过，下一次固定原矩阵前需确认新helper已进入source hash。

macOS产品workflow `36843430053` 在4f015c81上完成固定部署目标编译及两模式Terminal/Webview/completed reopen步骤，job success；原artifact仍保留为平台证据，未将本地Linux或历史macOS Agent失败改写为Agent通过。六资产、旧OS API、Remote及默认分发仍开放。

## 40. A3/A4 当前平台证据回收与下一门禁

A3修正夹具的最终纯测试在当前工作树通过7组，新增receipt只声明 `mode=frozen-owner-flush-before-attacher-start`，并明确不声称两个Host并发写入同一workspace persistence。该字段和目标已存在拒绝测试是在原A3固定输入 `8515ea25` 之后补入的，因此 `.debug/a3-reader-isolation-20261001-fixed/` 仍按其原始输入与SHA解释，不把后加的provenance字段回填为同一输入；行为结论不变，原首败继续保留。

当前提交 `8515ea25` 的Windows native Agent run `36846756417` 只取得有限通过：真实Codex的live natural、live stop、snapshot-only natural以及snapshot-only stop四场均通过；最后一场包含严格空snapshot判据和同runtime/workspace/user-data的新Host重开，节点保持stopped、空状态、无新执行且cleanup完成。Claude的第一场live natural在认证成功后进入stopped、source EOF且reader settlement为`applied`，但没有 `outputSequence` 或 CLI observed，触发既有 `timeout/response` 诊断；其余三个Claude场景未运行。该结果是真实Agent/生命周期验收的直接阻塞，不能归类为凭据前置失败，也不能从Codex通过推断Claude通过。先保存摘要 `.debug/windows-agent-36846756417-v2/summary.json`，定位Claude启动链/终态顺序后再调度完整矩阵；不修改旧断言取绿。

同一提交的Windows产品Provider run `36846733819` 在实际Terminal/Webview/completed reopen步骤失败，构建和前置产品provider均成功，日志只证明Electron启动到`workbench#open()`，未形成可核对的产品报告。该失败目前只分类为产品workflow/宿主启动阶段阻塞，不能归因storage containment（修正后的helper尚未进入该步骤的可核对报告），也不能以进程退出或大artifact存在宣称产品通过。macOS产品Provider run `36846734096`成功，但仍不代证macOS Agent。

下一门禁保持有限：提交当前A3 receipt/文档后，先按原输入复核Windows产品启动失败的第一现场；再触发一次macOS真实Agent固定矩阵，单独取得其Codex/Claude结果。未完成Claude完整矩阵、Windows产品Provider、macOS Agent、A5六资产/Remote/默认分发和F-04前，不宣布跨平台或总体退出完整性交付；不把诊断工具通用增强重新设为前置。

## 41. macOS Agent 矩阵的第二次失败定位

当前提交 `85f08d8e` 的macOS Agent run `36849214028` 在 `codex-live-runtime-natural` 完整通过（真实响应、source EOF、cleanup），随后 `codex-live-runtime-stop` 在 `agent-candidate-tests.cjs:137` 的 `lastRuntimeError` 检查失败；认证、构建和首场均已通过，后六场未运行。安全摘要保存在 `.debug/macos-agent-36849214028/summary.json`，未发布原始CLI或环境内容。

该结果与此前macOS run `36832581851`、`36836757674` 的场景间失败相互印证，但失败位置不同：两次此前运行分别在 `codex-snapshot-only-stop` 的 reader settlement/完成保存断言处停止，当前运行更早在第二场启动状态失败。不能据此宣称固定可复现的单一业务根因，也不能把一次首场通过扩展为macOS矩阵通过；当前分类为macOS候选场景间启动/收尾稳定性阻塞，下一次只允许一次同输入重跑用于区分环境波动与确定性产品缺陷，仍保留三次失败现场与原断言。

## 42. Windows 最终状态传播与已排队发送的背压唤醒

对 `36846733819` 失败工件的进一步只读核对修正第40节的初步分类：实际Webview已收到90000行、UTF-8/ANSI尾部及最终光标 `(6,2)`；Runtime registry为 `live=false/lifecycle=closed/lastExitCode=0/sourceDisposition=eof`，但Host节点仍 `liveSession=true/outputSequence=1390` 且保留绑定。外层失败是 `Timed out: natural exit and final product state`，不是仅有宿主启动失败。当前直接产品阻塞是Supervisor闭合后的最终状态未传播或未应用，不能以页面正文完整替代终态和资源结算，也不归因storage containment。

代码核对另确认一个跨平台调度缺陷：`runtimeSupervisorMain.ts` 中 `scheduleHostOutputSocket` 已排队的 `setImmediate` 执行前，其他socket写入可使 `writableNeedDrain=true`；`pumpNextHostOutput` 此时直接返回，既保留subscription的scheduled标志又不安装drain监听。没有后续输出或状态变化时，即使socket恢复可写也不再发送。基于实际Server类的受控复现观察到 `scheduled=true`、socket scheduler未排队、drain listener为0，恢复并发出drain后pump仍为0。此缺陷成立，但尚未证明它就是该Windows工件的唯一原因。

正式修正只集中socket级唤醒责任：已就绪subscription保持有界单批信用；安排turn和执行turn两个入口一旦遇到背压，都注册同一个socket级drain监听，drain后按原公平调度继续。它不新增轮询、重试队列、状态旁路或取消预算，也不提前ACK或绕过Webview消费。先在 `scripts/test/test-runtime-host-output-credit.mjs` 增加“最后状态已排队、执行前背压、恢复后无新输出”的定向先红回归，再修生产调度并验证已有真实socket信用/尾部/公平/断连测试。随后只复验原Windows产品组合；旧失败及跨平台未知保持。

Windows Claude的 `naturalResponseVerified=true` 与 `cliObserved=false` 分账：Runtime完成后清除outputSequence符合无历史规则，不能单凭该字段缺失认定CLI没有输出。仍需确认实际 `cmd.exe -> claude.exe` 启动链是否被观察器识别，不将普通工具后代边界用于排除实际CLI。macOS第41节唯一重跑为 `36850339021` / `4f613e7a`，未回收前不宣称通过或追加重试。

修后局部证据：`test-runtime-host-output-credit.mjs --baseline-ref=4f613e7a --queued-drain-only` 固定旧Server超时exit1；新Server同例及全部原Host credit组通过，client28/28、paged completion四组合与typecheck通过，独立review与复跑无新增阻塞。它证明实际Server/socket调度修复，不是原Windows产品通过声明。

macOS唯一重跑现已回收：`36850339021` / `4f613e7a` 的真实Codex/Claude原八场均passed，四natural响应与实际EOF通过，八cleanup的bindings/failures/forcedSignals/active计数均0；stop仍是主动停止。Codex snapshot-stop为空、序列7，完整独立回放与resize对账以及新Host重开全部通过；Claude snapshot-stop为2090字节、序列12，原验收和resize对账通过，但诊断replay为 `projection-recovery-or-unknown-snapshot`，不能声称所有场景均独立重放。与前一失败run的16项buildHashes完全一致，旧失败不能追认成修复或已证实的环境波动。第137行的lastRuntimeError也可能来自消费或断连，不是CLI spawn专有错误；每场存储和Host隔离，目前没有上一场状态污染的确定证据。

## 43. Windows Claude 固定启动身份与严格观察

已确定本轮观察缺口而非立即认定CLI生命周期缺陷：PowerShell观察器要求provider子级cmd的原始tail与预登记 `launchArguments` Ordinal全等；但 `CanvasPanelManager.resolveAgentResumeContext` 会为没有显式session flag的Claude fresh启动生成UUID，`buildAgentLaunchSpec` 将 `--session-id UUID` 追加到实际参数。原harness只登记追加前的命令，故实际cmd不匹配，后续原生claude.exe也无法沿严格父链纳入观察。Codex没有同一追加路径。该静态确定差异与 `naturalResponseVerified=true/cliObserved=false` 相容，不能据此宣称真实Windows矩阵已通过。

最小方案只修改固定验收输入：每个Claude场景在发起创建前生成一个有效UUID，将 `--session-id` 置于原参数末尾，观察器和产品custom command共用这一数组。实际产品识别已有session flag后保留同一ID、不重复追加，仍走正常fresh launch与原有session身份语义。`agent-candidate-cli.cjs` 保存该窄参数构造，`agent-candidate-tests.cjs` 使用它；纯测试调用实际resume resolver、launch builder、command parser和Windows spawn resolver验证完整tail相等及原JSON/空tools参数保持。不得改PowerShell为宽松子串匹配、补认未持有的进程、按PID消失认退出或放宽旧断言。纯测通过后只重新运行原Windows八场，仍保留原失败及真实wrapper/CLI生命周期门禁。

本轮实现及验证：上述三文件窄修已完成，原无ID的产品追加差异仍在回归中复现；两个lifecycle的实际产品方法、parser和Windows spawn resolver组合通过。CLI、Windows/Darwin observer、DeepSeek配置、安全CI report及语法检查通过，未运行Windows原生。第42节整体npm命令另暴露旧 `test-terminal-available-credit.mjs` 共享夹具缺 `recordDiagnosticEvent`，与85f08d8e基线一致；仅补可观察diagnostics依赖、保持旧断言后整条命令通过，不修改业务。下一固定新提交各一次原Windows产品和Agent矩阵，不增加平台/场景或自动重试。

固定输入 `c851d028` 已推送：Windows产品为 `36852373473`，Windows原八场Agent为 `36852378637`，均仅首次调度。Supervisor94/94和Host147/147局部回归再次通过；未回收workflow前不写原生通过。

## 44. A5 Remote SSH 的有限安装验收

本机已有 `vscode-remote-ssh-fixture.mjs` 的loopback临时sshd、临时密钥、独立server目录及所需程序，不需要读取用户SSH配置/私钥或向用户索要远程机器。既有Remote smoke是开发扩展/fake Agent，不代证候选或installed。本项仍是原A5执行端选择与两模式Terminal验收，不增加真实Agent的平台笛卡尔积，也不声称同机loopback证明跨机器网络故障恢复。

先用无产品执行的真实Remote Host probe确认同一固定VS Code commit的server Node、execPath、版本/ABI/N-API及libc；probe不启动Terminal/Agent。仅使用该隔离server Node和原Linux builder生成匹配Node资产，再由原显式build/packager形成冻结VSIX。现有Electron包与精确runtime gate保持，不把Electron资产改标签成Node，也不放宽工厂兼容性。输入准备与正式验收分开，验收不得自动重建或重试取绿。

新增有限Remote runner复用 `prepareRuntime/createRemoteSSHFixture/spawnPreparedVSCodeScenario`，沿真实server CLI安装固定包，使用只有测试脚本的workspace driver；逐文件hash、manifest和实际扩展路径收据沿第35节。原installed helper允许显式选择Node输入，缺省仍严格Electron；两种运行时分别核对实际tuple。Remote wrapper从自身staged driver目录的固定 `remote-control.json` 绑定读取本轮控制文件，再取固定phase/mode/artifacts/expectation，调用原 `execution-candidate-tests.cjs`。sshd仍显式SetEnv该路径；若最终Host收到该值，必须与driver绑定相等，不搜索workspace、不依赖本地环境经SSH隐式传递、不改原尾部断言。

唯一正式矩阵仍是Runtime/editor和snapshot-only/panel的complete/reopen四次真实Host启动，使用原90000行、100000 scrollback、成功写入凭证、UTF-8/ANSI/OSC尾部、光标和reader applied检查；Runtime重开空历史/无新执行，snapshot-only恢复原快照。每次另断言 `vscode.env.remoteName=ssh-remote`、workspace authority为本轮alias、Host execPath在本轮server目录内且无Electron字段，并与固定Node资产匹配。清理先走原reset/退出/绑定及本方资源检查，再释放本轮sshd/server；任何fixture兜底清理动作分账，不能覆盖产品失败。只证明Linux x64/glibc远端子项，其他架构、六资产、默认分发与A1/F-04未因此完成。

Remote URI边界补充：Remote Extension Host可能将workspace URI转换为 `file:`；必须记录原API值，不伪造authority。若实际API仍有remote authority则严格匹配本轮alias；若为file，则以 `remoteName`、私有server execPath、启动器remote target及本轮SSH链共同确认，不能仅凭本地路径声称远端。

2026-10-01首次无产品probe `.debug/a5-remote-probe-20261001-first/` 保留exit1：临时SSH认证、独立Server安装及真实Remote Extension Host已进入，但Remote SSH的exec-server没有把sshd自定义SetEnv交付给最终Host，wrapper因缺显式控制文件失败。没有产品执行或Terminal/Agent新通过。该次fixture清理记录5个本轮server进程及原sshd的TERM、remaining/failures均0、无KILL；后续按私有server/client根独立 `/proc` 核对无匹配残留。只修staged driver固定绑定，不追认首轮通过。

第二次 `.debug/a5-remote-probe-20261001-control-binding/` 无产品probe完整exit0。`server-runtime.json` 来自实际Host PID262179：VS Code1.117.0/commit `10c8e557c8b9f9ed0a87f61f1c9a44bde731c409`、Linux x64、Server Node22.22.1/ABI127/N-API10/glibc2.35、无Electron；可执行文件位于该轮 `remote-ssh-fixture/remote-agent/.vscode-server/cli/servers/Stable-10c8e557c8b9f9ed0a87f61f1c9a44bde731c409/server/node`，SHA256 `243fd8938011479f41b3de101842150fa990f33fbbb3f7aabd330857f2d79e1d`。实际workspace API为 `file:`/空authority，`remoteName=ssh-remote`，controlTransport为staged-driver-binding，productPresent/productActive均false。5个本轮server进程和原sshd仅TERM，cleanup remaining/failures均0，无forcedClientSignals；独立私有根进程核对为空。原Remote纯测及installed九组检查通过；EOF独立对账采用真实 `SourceDisposition` 对象的 `kind`，字符串 `eof` 被拒绝。此结果仅完成构建输入probe，不代证固定包安装、四阶段产品矩阵、真实Agent或完整A5。

固定Node包已在 `.debug/a5-remote-node-package-20261001/` 构建并冻结，不自动启动正式矩阵。业务/native/build/lock输入核对未偏离 `b5f53cdf0765b31b8e6dcb6241dd8779614164af`，逐文件来源及整体SHA256 `08617e59cbeffc362cc8437409e1122740554f3a97f3a42ad6b5fad3e06a22fc` 保存于 `frozen-build-input.json`。使用上述实际私有Server Node执行原Linux builder，官方Node22.22.1 headers归档SHA256 `0f76c31ce76a623a6a3a4038cb62eae281b2e33ad189dcf2d514ec32ae74d9b2` 已对官方SHASUMS256核验；资产manifest保留编译tuple Node22.22.1/ABI127/N-API10/glibc2.35和原owner/sharedOwner/patch/headers摘要，addon SHA256 `28ecb79548a2aa7f969c3dde9998d128f4b256fac26df8def6a034d5e8529f34`。原显式production build与直接packager生成 `candidate.vsix`，SHA256 `c4d0fa123133f6a6cd5c695f3c1c9a4f92fd09501b1de7517f66755aca608e84`；逐业务/native文件包内hash已冻结。原根目录包另行保存，旧Electron frozen包和证据未改。此时仅compiled/package成立，nativeLoaded/nativeCalls/productValidated仍未宣称通过；不发布该验收包，不修改factory兼容gate，也不关闭六资产/默认分发。

固定包首次正式矩阵 `.debug/a5-remote-installed-20261001-first/` 保留exit1。真实Remote Server CLI安装成功，实际Host加载私有extensions目录内的原固定Node包；首场 `live-runtime/complete` 在原30秒 `actual xterm buffer fully applied` 等待失败，其余三个phase没有执行。主体凭证记录成功写入5580102字节、90000行及原SHA，source为EOF/finalRevision1406；失败归档时页面仅到revision1378/head1406，不能把随后probe可见最后行和正确光标当成截止前90002行全文通过。API scrollback断言已通过，保存的 `host/stateUpdated.payload.runtime.terminalScrollback=100000`，没有证据支持本轮workspace设置未送达。fixture清理8个私有Server进程及原sshd仅TERM，remaining/failures均0、无KILL/forcedClientSignals，独立私有根 `/proc` 核对无残留；这不覆盖产品失败。

只读核对确认原full-buffer轮询在11:28:17.125至11:28:46.510之间发送43次同一90002行期望，每次Host消息compact JSON为5670417字节、合计243827931字节，约为本轮93个实际page消息5986226字节的40.7倍；漂亮打印的messages归档为292550069字节。保存页面revision连续、无gap，但尚未包含主体最终尾部；原response内容/时间未归档，不补造每次匹配行数或精确往返时长。观察器施加的大量传输和重复扫描是已确认事实，是否为此次超时唯一根因仍未知，首败不能追认通过。

选定修正只改变原harness的complete等待顺序：从原30秒同一绝对截止开始，用本Extension Host局部 `getDiagnosticEvents` 等待同execution的既有Runtime reader applied或local reader applied及最终outputSequence，然后仅发送一次原90002行全文断言。传入剩余预算，await返回后再次检查绝对截止；不延长时限、不抽样、不改hash/业务hook，也不删除最终光标、成功写入、持久化及原reader结算断言。纯测须拒绝late/error/cancelled/other-execution并核对只发送一次未变正文。原始首败保留；先审查此窄修，不自动重跑原生矩阵，不增加通用观察协议或工具边界门槛。

窄修已完成定向纯测：两模式先applied后全文单次发送、原90002行同内容/同对象、剩余budget、late read/late buffer拒绝、错误原样传播、cancelled/lost/unknown及其他execution/错误sequence拒绝均通过；原Remote纯测、installed九组、语法及diff检查通过。独立复审无阻塞，未修改业务或重建固定包。接下来仅在新目录 `.debug/a5-remote-installed-20261001-applied-wait/` 对同一 `c4d0fa12` Node VSIX运行原四阶段矩阵一次，并记录本轮harness来源hash；尚未取得本轮原生结果，不改原首败。

该唯一新矩阵已exit0，原四阶段全部实际执行通过，不追加重采集。`input.json` 保留八项harness source hash，原测试文件为 `0ce7538187a291ec297748993c2785b919c77b0f1b311dbdfd0d6563cbb3e5f7`；固定VSIX、实际安装八项payload及Server Node文件hash均独立复核未变。四实际Remote Host PID为315036/316498、317456/319102，均由同一私有Server Node22.22.1/ABI127启动、无Electron，complete/reopen不是复用旧Host。两主体均成功写入原5580102字节及SHA，原90002行全文和最终光标(6,2)通过；Runtime source EOF与同reader applied均为revision1389（间隔8.109秒），snapshot-only均为1388（间隔1.141秒）。Runtime完成节点654字节，新Host重开无正文/无新执行；snapshot-only节点5767036字节，新Host恢复原全文，原保存最终sequence和reader回执对账通过。两模式原cleanup的bindings均0。

本轮fixture最后仅TERM 13个私有Server进程和原sshd，无KILL/forcedClientSignals，remaining/failures均0；独立扫描本轮Server及bootstrap/两模式client私有根无匹配进程。此结果关闭A5中Linux x64/glibc实际Remote SSH执行端及两模式Terminal安装验收子项，不关闭其他架构、六资产/默认分发、真实Agent或完整A5。原首败及其时间线保持；一次窄修后通过不证明243.8MB观察流量是旧超时的唯一根因，也不把loopback扩大为跨机器网络恢复保证。

## 45. Windows 固定复验回收与主动停止前的观察屏障

`c851d028` 的Windows产品 `36852373473` job success，原Node及两模式Terminal/Webview/重开步骤通过；完整工件尚在回收，不能只凭job为全部字段盖章，也不能从一次成功倒推第42节丢唤醒为旧失败唯一根因。Windows Agent `36852378637` 首场Codex natural通过，第二场Codex stop在 `poll` 的observer错误检查处失败，Claude四场均未执行，不能称第43节原生修复已验。安全摘要显示stopping/live=true、sequence40、source EOF但尚未reader settlement，observer cleanup两failure、四unknown；不据此把进行中的终态写成产品丢尾。

源码确认主动stop场景缺少测试同步：页面就绪/resize后立即发stop，CLI原始句柄却只在产品完成后才要求出现。PowerShell通过CIM发现再取得原始句柄，两者之间CLI可被本次测试自身的stop结束，导致观察为unknown。该可达顺序是应修的验收前提，尚不是该run的唯一因果证明。最小修正仅Windows主动stop：在原交互就绪的同一截止窗口中同时等待已验证且仍live的Host/对应owner/provider/cmd及实际CLI原始身份（Codex含node wrapper），然后才发送原stop动作；不增加窗口、不放宽句柄身份/结束检查，natural路径不变。

安全摘要只增既有固定failure kind、失败request operation和清理action kind白名单，不发布命令、路径、PID或原始错误。旧 `forcedSignals=1` 是actions数组计数，其中可能是 `unknown-identity-no-signal`，不能直接写成确有一个强制信号；新报告将实际信号与unknown/no-signal区分，旧报告字节保持。先验证晚到/未知/已退出CLI均不能越过stop屏障，再以固定输入复验原八场，不增加通用观察框架或任意竞态矩阵。

`b5f53cdf` / `36854266396` attempt1在Windows observer原生自测触发原10秒 `helper-request-deadline`，发生于CLI安装、候选构建、真实八场之前，未发模型请求，也没有Agent安全摘要。新纯测和report检查已通过，PowerShell实现及原生自测主体未变，具体慢点尚未知。仅安排一次同提交/同期限的failed-job重跑attempt2，保留attempt1，不提高deadline、不增观察工具或把再次通过当作已定位根因。

同输入attempt2已完成，job `110344192808` success。仅回收安全artifact `11157772291` 至 `.debug/windows-agent-36854266396-attempt2/summary.json`，SHA256 `5b623af6c9a55419ae3b3904f8b758611ffa78ab89069166b43719e921e9f5f1`；13项非dist源码hash与该提交Windows CRLF checkout一致，不将换行差异误判为旧源码。固定Codex0.157.1/Claude2.1.280、DeepSeek原八场全部passed，四natural真实预期响应/EOF、八场实际CLI及完整启动链观察通过；所有cleanup bindings/failures/remaining/unknown/unconfirmedSignals均0，cleanupActionKinds为空。stop仍是产品主动停止，事后无清理信号不表示产品未发停止信号；不把这轮source均EOF推广为stop保证。两snapshot-stop为735/1947字节非空状态，原reader/lifecycle/sequence与resize后saved-page对账成立，故reopen未要求也未执行；原始geometry/replay不匹配与独立投影not-proven保持。旧空态重开证据仍只属于原输入，不由本轮补造通过。该固定Windows真实Agent矩阵不再排队，attempt1及全部旧失败保留，不称旧前置慢点或全部间歇失败已定位。

Windows产品 `36852373473` 的整包下载在600秒退出124；随后仅按该artifact中央目录范围读取18份原报告，未下载整包，保存在 `.debug/windows-product-36852373473-ranges/`。六份completed/reopened/cleanup、四份environment已独立逐字段核对，`report-crosscheck.json`记录原报告hash：实际VS Code1.117.0/Electron39.8.7/Node22.22.1/ABI140，两个writer原句柄exit0、各成功写入5580102bytes/90000行，尾部UTF-8/ANSI及光标(6,2)、实际EOF/原reader applied通过，finalRevision分别1382/1381。Runtime节点616bytes且新Host重开closed/空历史；snapshot-only节点5766998bytes，重开保留5580063字符及原终态；两cleanup bindings均0。该原两模式Terminal组合收口，不反推第42节为旧失败唯一原因，不要求合法外部引用的进程对象消失，不代证Remote、六资产/默认分发或完整A5。

## 46. macOS 新 helper 产品与真实 Agent 收口

提交 `8ae426c9` 的 macOS 新 helper 已完成一次产品与一次真实 Agent 验收。产品 run `36858038984` / job `110355130607` 使用 `macos-latest` arm64 runner；artifact `11160311635` 为592998864 bytes，仅按ZIP范围提取必要报告、manifest、helper输入及原生文件，未下载整包。原证据保存在 `.debug/macos-product-36858038984-ranges/`。Node/provider的namespace、normal、paused-stop、partial-create四场均pass且cleanupSafe；normal实际exit7/source EOF、accepted=consumed=4、terminal applied及本方资源released，paused-stop明确SIGHUP/interrupted而非EOF，partial-create预期失败保留process unconfirmed/source unknown及quarantine，不冒称自然成功。

同artifact的六份Electron Terminal completed/reopened/cleanup与四份environment已独立核对：VS Code1.117.0/Electron39.8.7/Node22.22.1/ABI140，两writer均成功写5580102 bytes/90000行，SHA256 `e03d6d758493454da0946cc62e7c17fb2444e39afaa7639c8a88ad271eaff48f`；原90002行、UTF-8/ANSI尾部、光标(6,2)、source EOF及同reader applied通过。Runtime finalRevision9401、完成节点556 bytes，新Host重开closed/空历史/无新执行；snapshot-only finalOutputSequence8634、节点5766938 bytes，重开恢复5580063字符及原终态；两cleanup bindings均0。complete/reopen Host PID分别3004→3410与3878→4572，不是复用旧Host。

Node25.6.0/ABI141与Electron39.8.7/ABI140的manifest分别保留实际构建运行时；两份manifest记录的addon SHA256均为 `c1b171b5f8bcdb74fa29e9d84c58e10520ed6c3e43757c1ce990082072ac7966`，helper均为 `8494089d371e20b2a42e0b88a6a39611eaefd10d9d08ae9837d5fd514c580019`。patched helper输入SHA256 `35ed5c2dfb2df7e605f367f0026dff54e51c2a7e7cf96829ee10681f7741bd13` 与manifest一致，owner/shared/patch/upstream helper摘要与8ae426c9逐文件匹配；实际Mach-O均arm64、部署目标11.0。该来源和最新runner实测不能代证x64或macOS10.13/10.14。

真实Agent run `36858502983` / job `110356656416` 为同一8ae426c9、新helper、固定Codex0.157.1/Claude2.1.280与DeepSeek。仅回收安全artifact `11161645155` 至 `.debug/runtime-real-agent-macos-36858502983/summary.json`，整轮phase=complete/pass=true、原八场均passed、automaticHarnessRetries=0；四natural真实预期响应/实际EOF，八场实际CLI及启动链观察通过。八cleanup bindings/failures/forcedSignals/unconfirmedSignals/remainingActiveProcesses均0，cleanupActionKinds为空；stop仍是产品主动处置，不因source EOF或无兜底信号称自然任务完成。credentialContentsRecorded/rawLogsPublished均false，没有下载raw Agent正文或凭据。

Codex snapshot-only stop为空、最终sequence11，完整初始回放与saved/published final相等；原页面geometry/visible比较仍false，独立hydrate仅resize后的geometry/visible/buffer全部true，因此沿33.10的严格resize分支通过，并实际由新Host重开空态、保持序号/节点且无新执行。pageProjectionIndependence仍not-proven，不把Host发布记录改称独立页面接收证明。Claude snapshot-only stop保存1262 bytes非空状态、最终sequence8；原reader/lifecycle/sequence与停止/保存/清理断言通过，但replayMatchesSaved/publishedFinalMatchesSaved及resizedSavedMatchesPage均false，保留具名诊断差异，不笼统称unknown或已证终态相等。按33.10既定非空分支，snapshotReopen.required=false且未执行；非空Agent stop的重开/终态等价未由此覆盖，不能仅凭八场pass关闭这些产品责任，也不凭该摘要直接认定产品丢尾。

本节仅关闭新helper固定arm64的Node/provider、Electron Terminal两模式及原真实Agent八场运行门禁，保留旧helper36850339021及所有首败，不重跑取绿。A5其他架构/最低环境/安装分发、A1/F-04、A2/A3未覆盖页面及A6仍按有限收尾第8节处理；Claude的具名非空终态差异在原A2/A3最终状态责任内核对，不追加通用replay框架或平台笛卡尔积。

## 47. A6 实际多根保存失败与另一画板交互

本项只补既定A6的实际页面格：同一真实installed VS Code窗口中两个root的Runtime Terminal，A自然结束但root快照保存失败时，B仍能通过原Webview/PTY往返交互。首轮固定使用第35/39节已有Electron VSIX，不重建；发现直接产品缺陷后的新包复验另列如下。两轮均不启用默认产品路径、不改变root runtime归属。新runner和workspace driver独立于原共享矩阵；运行前核对固定包hash、安装来源与原生tuple，纯测只检查本场景断言和本方清理边界，不增加通用诊断能力。

两个节点经原 `webview/createDemoNode(targetGroupId)` 入口落在不同root，正常保存后只读确认各自root快照与workspace快照。随后仅在A的 `root-local-canvas/<root hash>/canvas-state.json.tmp` 创建本轮拥有的空目录，触发原 `writeFileSync` 的真实EISDIR；不改workspace storage或runtime文件。A自然退出后，先只读取原diagnostics/debug state/Host messages/Supervisor与磁盘，冻结第一次失败和原binding/session责任；此之前不调用会写盘的flush或dump。主进程退出、真实EOF、尾部marker及同reader applied分别检查，保存失败不得清掉唯一来源/绑定或误重启执行。

保持障碍存在，再经B原页面的 `measureCapacityInteraction` 发送新nonce，要求同主体、provider、Supervisor及reader收到真实 `DSC_A1_REPLY_<nonce>` 并在原1500ms内应用。该交互后的合法保存可能更新磁盘，不能把第一失败快照不变要求扩大到后续所有写入；也不预设移除障碍后会自动重试A保存。结束时只对本轮仍为空、同inode且非symlink的障碍执行rmdir，再走原reset；reset返回不代替零bindings/pending/nodes及本方主体/provider实际退出检查。必要的孤立idle Supervisor外部TERM单独记账，不称协调shutdown；任何失败、未知或兜底动作不覆盖原结果。实际运行前保留harness来源，首次失败保留，不自动重试取绿。

2026-10-01唯一首轮 `.debug/a6-root-failure-20261001-first/` 为exit1：真实root A EISDIR与completion callback失败已观察，第一冻结三文件hash均未改、两原binding保留；A实际EOF/finalRevision4，原reader收到完整marker页，但15秒内没有final notification/applied，故B故障后交互尚未执行。清理另在registry仍有两条旧记录处失败；本轮主体/provider/Supervisor/UI六PID独立核对均已消失、障碍已移除，outer fallback只有obstacle-already-absent，无兜底信号。首轮失败和资源释放事实分别保留，不能声称cleanup通过。

源码直接解释final通知缺口：`handleRuntimeSupervisorState()` 等 `applyCompletedRuntimeSupervisorSnapshot()` 保存成功后才发布终态；relay已completeRemote固定了最终revision，但root保存异常阻断后续发布。选择在原identity/reader已固定后、落盘前复用 `postExecutionSnapshot()` 向仍存在的completed reader发布已确认final水位；不新建reader、不宣称保存成功、不删除原来源或binding。页面必须真实应用并回执，发布本身不是applied，read失败/cancelled仍独立。原root失败方法测试先增加该断言再修；保持旧回滚、root隔离、节点replacement及strict deadline保护，正常成功路径的后续同终态通知允许原协议去重。

清理的registry断言另有验收顺序错误：Supervisor无SIGTERM handler，正常协调保存路径是idle shutdown；不能把立即TERM解释为flush完成。只在产品reset已释放bindings/主体之后，按原清理截止等真实registry空记录落盘，再对本方孤立idle Supervisor独立TERM并检查退出。没有增加崩溃后历史恢复承诺，不通过修改registry或延长预算取得绿色。修后需要新固定包才可复验产品改动，原604494fd失败不追认。

原实际Host/root writer用例加入已有reader后在原实现确定性失败，日志 `.debug/a6-root-final-notification-before-20261001.log` 保留exit1；预保存通知窄修后两类root EISDIR仍抛出、原文件/metadata/binding/managed session不变，页面final发布与实际回执分开断言成立，Host147/147、Runtime completed、typecheck与A6纯测通过。独立只读复审无新阻塞；新路径只在协商finalRevision的既有reader生效，surface失效后的relay清理和原身份/期限保护保持。此处为新包原生复验前的局部证据，不将旧包首败追认通过。

修正业务输入已固定为 `0f5b52ef`，由原production显式2/1构建及直接packager生成 `.debug/a6-root-failure-package-20261001/candidate.vsix`，SHA256 `c4df29f55088f279a35a584441ae5eff15491f996ed3275f534e7cb7121bee6e`；包内关键文件与源码摘要保存在 `frozen-input.json`。复用经source hash校验的原Linux Electron资产，addon仍 `5b3140051b110e45aa8d608682371a602e25596da187957e479f95a7b086e70f`，未修改native或生产默认准入。仅将独立A6 runner固定输入切换为此新包，在新目录 `.debug/a6-root-failure-20261001-final-publication/` 唯一复验原组合，预算、尾部、reader、B交互及清理标准不变；原staged首轮源码/hash/失败仍保留。

复验完整exit0并经独立只读对账：14项input源码摘要、7项staged副本和路径模块匹配，包冻结6项源码与上述commit一致，8项payload在VSIX/实际安装/收据间相同。Host为VS Code1.117.0/Electron39.8.7/Node22.22.1/ABI140；冻结case/cleanup断言独立重放通过。A再次真实EISDIR，首次观察的root A2736 bytes、root B2725 bytes、workspace5972 bytes均与baseline同SHA；归档snapshot按实际写盘格式重构后的SHA也一致，两条原binding保留。A主体exit0/source EOF，完整marker通过实际xterm断言，原reader `1f61e165-8537-447e-b7b7-85ebaf7e7b4d` 记录applied(finalRevision4)。B在原障碍仍存在时24.900000095ms应用新nonce，page revision5到6沿原reader/session/authority，主体/provider/Supervisor身份不变、新start事件为0。

产品reset后bindings/pending/nodes均0，两provider与两主体均after=null；registryBeforeSignal、TERM后及独立核对时实际registry均为空，原Supervisor亦不存在，UI实际exit0。外部TERM不代证正常shutdown；原首轮超时及cleanup失败不改绿。本节仅关闭该Linux installed Runtime多根失败隔离格，不代证Agent、其他平台、自动保存重试或root稳定runtime归属，两root仍共享原Supervisor；snapshot-only实际Host离开及有限清单其余责任保持。

## 48. A2/A3 已结束快照的尺寸归属

第46节Claude的安全摘要中，published final是66x21，saved metadata是96x30，replay没有resize snapshot。发布比较包含geometry，因此false至少由尺寸差异触发；replay按66x21消费、saved按96x30直接恢复，也不是同尺寸对照。`resizedSavedMatchesPage` 从saved metadata尺寸开始再resize到96x30，不能补回原尺寸历史。buffer true仅比较去空行/右侧空白后的文本，不证明完整终态；viewportY不是baseY，不能用cursorY加viewportY相等推导逻辑光标相等。仍保留本次八场原执行/退出断言通过，未证明非空停止后的画面/重开等价，也未证明正文丢失或macOS PTY缺陷。

代码中存在可独立验证的跨平台风险：`CanvasPanelManager.resizeExecutionSession()` 在record已退役时，调用 `updateExecutionTerminalMetadata()` 改lastCols/lastRows但保留原serializedTerminalState；Webview完成后仍可能fit并上报新尺寸。原snapshot以final record的cols/rows生成，不能只改标签后按新尺寸hydrate。本次摘要没有resize时序，结构风险与原生run的完整因果分账。

选定最小工程方向为保持已保存snapshot内容与原始geometry一致，页面当前布局尺寸不覆写它；不是禁止页面resize，也不重新创建已结束执行。先以真实Host方法和实际headless终端补Terminal/Agent共用分支的固定先红。保护范围是无session、snapshot-only、非live且保存了serializedTerminalState（包括空串）的节点；pendingLaunch也不能仅改旧snapshot标签。显式新建/恢复仍由页面当前terminalSizeRef传入cols/rows；若已有同metadata身份、未提交的candidateRuntimeStarts，只推进该次start.viewport，不改旧snapshot或currentMetadata。无保存快照仍沿原尺寸更新规则，live及Runtime恢复路径不顺手改变。验证使用有限含scrollback的66x21输入、completed后96x30上报与按原尺寸hydrate再reflow的对照，记录光标/视口语义，原false与旧证据保持。不发新模型请求、不扩大Agent矩阵或建设通用重放框架。

本地实际Host方法先红已冻结于 `.debug/completed-snapshot-resize-before-20261001.log`：12项中3过/9失败、exit1。真实tracker的40行短行和cursor-up 8在正确恢复后为baseY20/cursorY12/viewportY20，错标尺寸恢复为11/21/11；绝对光标行均32、非空文字相同但可见画面不同，因而确认的是尺寸关联错误而非正文丢失。六行Host保护后原12项通过，独立复审及原Host wiring147/147、Runtime completed无历史与typecheck通过；补submitted/metadata replacement负向组合并接入原序列化测试入口，后续结果单列。不改变Runtime completed不留历史。

既有Playwright六例首轮为4过/2失败，工件冻结于 `.debug/a2-snapshot-webview-20261001-first/`。两类snapshot恢复和scrollback四例通过；两类final snapshot不覆盖live backlog的复合谓词失败，尚待核对失败条件，不根据Host局部修复追认为通过。该浏览器harness不运行本次Host方法，结果与原macOS Agent比较分账，不能将其自动归因于六行保护。

补齐四项snapshot分支的submitted/replacement负向回归后，原序列化测试入口和新增16/16全部通过。尺寸修复只关闭这一具名结构缺陷，非空snapshot实际页面及重开格仍需原A2/A3证据，不以headless代替页面。

冻结Playwright trace/probe的只读对账确认，两例实际都有完整live tail、都没有替换正文，唯一失败是要求 `[Dev Session Canvas]` 退出banner。第32.4节早已选定exit不再向xterm注入合成正文以保护尾部/光标；当前源码与dist均如此，因此旧fixture与现行契约冲突，不是本次Host guard回归。仅将同一组tail/最终snapshot用例中的banner断言改为不存在，保留尾部及禁止快照替换断言，再运行这四例与原四例恢复/scrollback；旧4/6现场保持，不能追认为通过，也不修改业务恢复banner。冻结trace没有内嵌bundle字节，不声称已从trace回证其SHA。

修正旧fixture后的八项定向Playwright全部通过：两类tail不注入正文、final snapshot不替换backlog、序列化恢复与scrollback恢复各两例。未改Webview业务，原4/6仍失败；该结果不代证新Host尺寸保护的真实installed组合或原macOS非空stop因果。

## 49. B2/A5 兼容要求与构建来源分离

本项落实第37节已有分发决策，不新增支持平台或改最低支持政策。构建资产采用schemaVersion=2，保留原runtime/libc/source/hash为构建来源，新增requirements记录实际需求；旧schema1冻结包及其结果不改、不猜补字段。各平台逐项接入，尚未切换的平台继续原严格门禁，不能因Linux完成就宣称六资产已交付。

Linux先覆盖x64/arm64 glibc两个已有打包目标，编译明确NAPI_VERSION=8。requirements.napi固定为8；requirements.linux中的glibcMinimum/glibcxxMinimum/cxxabiMinimum由最终ELF的版本依赖表计算，build与import均核对真实字节，不从构建机版本猜测。运行端检查实际平台/架构、有效N-API且至少8、glibc及其数字版本下限；不比较Node/Electron名称、modules或完整版本相等。GLIBCXX/CXXABI不从glibc推断、不扫描任意系统库，由正式provider加载时动态链接器检查，加载失败必须拒绝创建，不能降级为正常完成。当前本机GLIBC_2.34产物只能声明2.34，不冒充原打包基线2.28；兼容基线重编仍属后续六资产收口。

Linux旧Node通过原nativeClaim接口竞争与现代Node相同的uid/真实storage路径JSON摘要、同名abstract socket；不是新增文件锁。native句柄带close-on-exec且持有到authority退出，准备工厂不加载native，只有Runtime Supervisor取得namespace时加载无PTY操作的claim导出。现代Node继续原net.Server路径，snapshot-only不取得Supervisor namespace。旧与新宿主互斥需真实socket对照；N-API可加载不代证旧Node全部JS/PTY/页面兼容。

历史构建来源仍记录 macOS 10.13/11.0 Mach-O 下限及 Windows ConPTY/CRT 供应方要求；这些 requirements 元数据不构成本次重构的旧 OS 兼容验收或默认支持承诺。六资产必须用同一正式产物跨既定 Node/Electron 加载，再接正常聚合、实际执行端选择与默认准入。当前仅明确实施输入，默认仍关闭，不扩通用依赖扫描器，也不重排已经完成的 Agent 矩阵；旧最低 OS 的真机兼容不属于本次重构前置，最终生产版本验收仍独立。

六资产聚合沿现有build/import实现：新增互斥的显式 `--execution-assets-set` 输入目录，必须且仅包含linux-x64-glibc、linux-arm64-glibc、darwin-x64、darwin-arm64、win32-x64、win32-arm64六个具名子目录，各自先完成原平台manifest/字节校验再清理dist。编译期选择标记使用 `platform`，激活时根据实际 `process.platform/process.arch` 返回原三种具体profile及factory；Remote取远端宿主事实，不看UI端或环境变量。单平台显式candidate入口保留供原验收，`platform`不进入Supervisor协议作为新profile。缺资产、不支持的平台/架构或原生加载失败均不得静默回落stock。普通构建暂不默认开启，待正式六资产与准入验收收口后切换，不能以显式聚合存在宣称交付完成。

Windows最低要求依据采用锁定包的官方NuGet `Microsoft.Windows.Console.ConPTY/1.25.260303002-preview` 原始nuspec，其明确声明Windows 10.0.17763.0及以上；不使用node-pty README混写的18309，也不把Microsoft Terminal主分支不同构建默认18362当作该包的契约。requirements.windows固定minimumBuild=17763、conptyVersion=1.25.260303002；这里只记录供应方要求，最低OS仍需实际验证。addon改为与锁定stock及Node Release默认一致的 `/MT`，显式NAPI_VERSION=8，避免额外要求用户安装MSVC redist；build/import检查实际PE正常导入表无动态MSVC/UCRT依赖，requirements的addonCrt=static只描述addon，不把bundled ConPTY/OpenConsole的OS UCRT称作静态。原delay-load hook、node.lib来源和两个ConPTY依赖的hash/架构检查保留；实际加载及API取得失败依旧在PTY创建之前拒绝。

上述三平台schema2、Linux arm64目录选择/旧Node claim、Windows静态CRT及六资产聚合/实际执行端选择已实施。统一局部入口 `npm run test:execution-native-assets` 通过：Linux资产10/factory35，macOS资产18/双架构factory，Windows资产14/四组合factory，聚合7和真实activate受控入口14；typecheck、Host147、Supervisor94及原namespace回归通过。ELF要求取实际版本表，PE检查按正常导入RVA解析而非搜字符串；旧Windows `/MD` 二进制仍因动态CRT被拒绝，未改写历史产物。工厂加载失败先于PTY创建，独立只读审查未发现直接阻塞。单元测试的模拟系统不是原生支持证据。

Linux旧Node原生互斥使用 `.debug/linux-native-namespace-20261001/assets`，addon SHA256 `6b4f166e5aeab848b75f3c42c13b34254b5ad42df3e5f09abaf932085cec60da`。实际Node16.17.1与25.6.0双向争用同一abstract地址、canonical alias、CLOEXEC、authority/provider互斥、失败bind后再争用和原进程自然退出释放均通过；未启动PTY。Node16官方归档与同版本SHASUMS相符，SHA256 `06ba2eb34aa385967f5f58c87a44753f83212f6cccea892b33f80a2e7fda8384`。该资产在新glibc编译，真实要求仍2.34，不伪装旧glibc通过。

随后另在固定官方 `node@sha256:674750127bbf45f52660ada71ed1f1491d15e94c16583bff6df0df2489481049` 的Debian buster/glibc2.28/Node16.17.1容器中编译一次，仓库只读、独立输出、构建无网络，生成 `.debug/linux-compatibility-20261001/assets`。addon SHA256 `b9e1e200d5b944c8c2ab5374734870015059bd7f2041f4008e3b27e0e4bdfc63`，真实要求GLIBC2.14/GLIBCXX3.4.22/CXXABI1.3.9、N-API8；这不是将产品支持下限扩大到glibc2.14。经原import与实际factory，完全同一字节在该旧容器、宿主Node25.6.0以及VS Code1.117.0的Electron39.8.7/Node22.22.1成功加载并核对导出，均未调用执行API。三次使用同一二进制而非按runtime重编，证明此Linux x64资产的有限装载兼容；旧系统PTY/页面、其他架构、最终生产预算与默认启用不由此通过。首次按tag拉镜像的TLS超时是环境前置失败，固定digest随后成功，不当作产品缺陷。

剩余先由无凭据、手动workflow构建固定六格并对同一产物做最低/当前宿主加载，再沿原A1至A6补最终产品回归；不新增Agent模型矩阵。最新GitHub托管runner仍不能证明macOS10.13/10.14或Windows1809，但这些旧环境不再是本次重构的验收前置；保留该事实，不将现代 runner 结果扩写为旧系统支持，低版本兼容按后续实际报告单独处理。

固定分发入口为 `.github/workflows/runtime-execution-assets.yml` 与 `scripts/build/build-execution-distribution-assets.mjs`：六个实际架构runner各构建一次，Linux使用按架构锁定digest的buster容器；macOS/Windows使用固定Node25.6.0 headers，供应方下载均核对官方SHASUMS。同一资产分别在最低Node16.17.1与当前Node25.6.0加载；Windows ARM64没有该版独立Node发行包，明确使用官方Electron22.3.14的ARM64/Node16.17.1加载，不冒称独立Node或旧Windows。主控与加载器均检查实际架构，归档仅含runtime文件并保留Unix执行位。没有PTY、Agent、secret或默认激活。成功摘要的 `nativeLoaded` 不代替 `productValidated`；失败保留原exit及已存在的runtime文件/两份load报告，不伪造成功摘要，不将输入下载目录作为工件。

本地整条命令 `node scripts/build/build-execution-distribution-assets.mjs --target=linux-x64-glibc --output=.debug/execution-assets-integration-20261001/linux-x64-glibc --artifacts=.debug/execution-assets-integration-20261001/artifacts` 已exit0。该次addon SHA256 `b99f8083d3351828deb6d12e8edae313805c1ad4550d07429a0c8d5a15aad46c`、manifest SHA256 `792d662d708753dc4bbf8570cec37f8db1d8bc71bead2008c2ae9ba8091fd5fa` 在两份报告完全一致，实际宿主glibc分别2.28/2.35；tar SHA256 `1c0a609c2db80b38a1e7b2a96c17134d4efd3148e967671b6ea454cd164ec882`。此结果证明构建、基线检查、双宿主加载及归档整条Linux x64路径，不声称不同输出路径间可复现二进制，也不补造其他五格或产品通过。固定分发窄测试与独立复核只服务该路径，不增设通用工具门槛。

`f2414f98` 推送后首次手动调度因GitHub尚未注册非默认分支新workflow而未启动，不计原生失败。注册入口仅允许当前 `runtime-persistence-session-state-refactor` 分支、且只匹配该workflow自身文件变化的push，普通源码push不触发六格；原 `workflow_dispatch` 保留，仍无secret。此次代码推送已按既有规则触发macOS产品 `36872496523` 与Windows产品 `36872496520`，用于受影响兼容/CRT路径原回归，不重排真实Agent请求。结果待独立回收，不能仅凭作业状态关闭产品门槛。

首轮六格run `36872829936` / `deb5dc9c` attempt1保留整体failure：Linux与macOS四格构建/双宿主加载/归档成功，已下载runtime-only产物、核对commit/manifest/binary/tar摘要并用原平台import再次校验，见 `.debug/execution-assets-36872829936/four-assets-crosscheck.json`。Linux两架构最低容器glibc2.28、当前宿主2.39；macOS两架构实际Darwin24.6.0，不能声称旧OS通过。Windows ARM64也job success，产物仍待回收；Windows x64在原120秒compiler预算触发 `spawnSync cl.exe ETIMEDOUT`，尚未生成manifest或执行load。仍持有未完成addon的link进程使失败证据上传再报EBUSY，原日志已保存，不能宣称失败artifact完整。完全同源码、runner image与MSVC版本的原Windows产品构建已通过，因此只安排该x64 job同输入/同期限的一次attempt2，不修改业务或放宽预算；没有唯一根因结论，首败不改，也不重复其余五格。

Windows ARM64原产物已下载，官方Electron22.3.14/Node16.17.1与当前Node25.6.0均为实际arm64，同一二进制/manifest及tar摘要一致。然而Linux聚合import拒绝owner来源摘要：独立计算确认owner与patch两项均精确等于当前提交源码经Windows默认LF→CRLF转换后的hash，不是旧代码，原产物不改。此为跨runner构建来源不一致的分发阻塞，不是native加载或PTY失败。修正限定在隔离分发runner checkout前关闭autocrlf，以git对象LF字节编译并保留原始hash门禁；不让import猜测或重写已有manifest。workflow已注册，移除首次bootstrap push，回到手动触发并提供固定Windows两格选择，只重建受影响两格、复用已核对四格，默认仍完整六格。原x64同输入attempt2及五格结果照实保留，不从新LF产物倒推旧超时根因。

原x64唯一attempt2已job success（14:07:59至14:09:30），同一编译预算未变；其余五格在attempt2列表中的开始/结束仍为attempt1原时间，未重新执行。该成功不解释原编译慢点或追认失败artifact已保存，CRLF分发责任仍须新LF输入处理。

修后仅Windows两格 `36874985406` / `42022169` attempt1成功，原源码LF/hash门禁均由Linux实际import复核通过；x64 addon为 `34f4119abaae80dd6fca66e67dec47283c5c0acb1027d9b56c3d84b4b7e723c7`，arm64为 `ca8dbb501774050f504c5d5d96975135c4e51df30edf4b8c308827fbdf719dba`。与首轮四格汇入 `.debug/execution-assets-production-20261001/assets` 后完整六目标一次import成功；`aggregation.json` 保留各自来源run与原manifest/binary摘要，不改早期CRLF产物。按70a0a32e显式production聚合build、原packager形成固定 `candidate.vsix`，SHA256 `bb4a5a23dc527d097b740df7359499432469be00eda0b70f6145f4f51a7e3543`、5855123bytes；包内六manifest/全部runtime文件hash及两个macOS helper执行位通过独立检查。selection=platform，候选仍2/1，未将其当生产并发上限，普通构建仍stock；编译/聚合/打包不代证各目标完整产品或最低OS。

受兼容改动影响的原产品回归已独立回收：`f2414f98` 的Windows36872496520与macOS36872496523均有原Node/provider四格first/cleanup、Terminal两模式六报告/四环境通过。两平台真实VS Code1.117.0/Electron39.8.7、重开新Host，各模式原90000行/5580102bytes、EOF后最终应用及光标(6,2)成立；Windows final1431/1381、Runtime节点616bytes，macOS final8220/8161、Runtime节点556bytes，snapshot重开均5580063字符。各五份schema2 manifest及Windows五addon/macOS五对addon-helper实际hash核对，源码Windows19项按CRLF、macOS17项按原字节匹配。Windows依赖DLL/EXE仅对账manifest、未另下载核hash；不将这些不同构建资产的产品结果称为新聚合包通过。证据在 `.debug/windows-product-36872496520-schema2/` 与 `.debug/macos-product-36872496523-schema2/`，下载超时/首版报告结构假设错误保留，不扩大到Agent、最低OS或完整A5。

## 50. A6 snapshot-only 实际 Host 离开

原第39节Runtime真实reload不负责结束Supervisor执行，原S12直接调用Host方法又不是实际VS Code关闭，因此仍缺snapshot-only的真实永久离开组合。本项只复用 `run-vscode-runtime-reload-candidate.mjs` 的独立activation-driver、一次UI启动和180秒总体期限（保留30秒清理），新增明确的snapshot-only选择；默认Runtime固定输入及旧证据不改，不另建诊断设施或增加平台矩阵。

先冻结当前installed Linux VSIX；installed helper按schema2实际requirements判断兼容，不要求Node编译资产的构建tuple与Electron运行tuple相等。schema1历史包继续原严格断言，schema2不猜补旧要求。聚合selection的platform必须映射到实际Linux profile，逐文件hash与安装路径仍严格核对，不能仅删除旧断言让包通过。

固定流程为全新root、单Terminal：关闭Runtime Persistence，实际创建节点并用exec启动原 `scripts/test/fixtures/linux-lifecycle-subject.mjs`，先在真实页面确认ready/nonce/尺寸，再记录原Host/provider/主体身份、节点及frame。写交接收据后直接发 `workbench.action.reloadWindow`，不预先stop、不调用测试版prepareForDeactivation。原主体仅在实际SIGHUP后输出中文/ANSI尾部，独立保存成功written字节、signal与exit7凭证。新Host须属于同UI，旧Host/provider/主体已退出，同节点closed/snapshot-only/exit7且没有live binding或pendingLaunch；先读取原磁盘状态，再操作恢复或flush，避免新保存掩盖旧Host未保存。

用成功written字节的独立headless回放、原磁盘snapshot与新Webview全文/中文位置及最终光标(6,4)核对，不只检查marker。新Host不得为此节点启动新执行，产品reset及本方资源清理通过且无fallback才计通过。原旧reader事件只是旧Host内存ring，未取得可靠收据时不反推其applied或完整EOF；旧surface实际离开可结算lost/cancelled，新页面应用单独验。该边界不削弱主进程成功写入尾部保存或最终页面完整性，本例仅关闭实际Host离开格，模块内EOF/逐资源契约仍由原证据承担。

证据归因补充：恢复panel的onView可先于测试activation-driver自动激活产品。因此“先读磁盘”只承诺先于driver自己的activation/attach/flush命令，并记录读盘前后产品isActive；不声称两份具体文件一定由旧Host最后写入，收据明确 `oldHostExclusiveDiskWriteClaim:false`。本例仍严格要求只在真实退出SIGHUP后产生的完整尾部可恢复、旧执行资源退出且没有重启，证明用户离开与恢复流程，不用新Host事件替旧Host内部结算背书。

第50节有限接线已完成：原reload launcher增加显式 `--mode=snapshot-only --expected-vsix-sha256=...`，原Runtime固定SHA保持；原主体字节/25秒期限与总体180秒保持。schema2 installed离线检查复用原ELF/build validator，实际安装收据使用按hash冻结的产品factory/compatibility sidecar，不复制兼容规则，不触发native执行；schema1原断言和receipt形状保持。installed13组、reload11组（含原7组）、root-failure/Remote窄测试与typecheck通过，尚未运行新包原生验收。有限sidecar只是重用实际产品准入函数，不设为新工具框架或新的平台门槛。

固定新包首轮 `.debug/a6-snapshot-real-reload-20261001-first/` exit1保留。安装与schema2实际Electron准入已进入，主体ready/正确nonce成立；setup在实际reload之前因尺寸前提超时，未生成setup或verify。独立written记录READY64x20、后续SIZE112x28，失败前Host记录112x28；测试错误地将启动时尺寸固定为后续查询尺寸，拒绝了合法resize，不能把该首败当退出尾部缺陷。失败清理另报 `Local final snapshot persistence is pending`，不计cleanup通过；此后SIGHUP尾部属于失败清理，不是reload证据。外层fallback=[]且原provider/主体/Host/UI身份均经独立核对已退出，仍不追认产品cleanup成功。只窄修setup判据为原READY/nonce/唯一SIZE字节严格匹配，并以SIZE与实际页面一致的最终尺寸交接；不延长25秒/180秒、不改变产品或尾部断言，再以同一包新目录运行一次。旧cleanup事实单列，不假设已解决。

同一冻结 VSIX 的一次新目录复验 `.debug/a6-snapshot-real-reload-20261001-post-start-resize/` 已 exit 0。夹具在主体启动后触发一次真实尺寸变化，先确认页面几何变化，再分别发送 nonce 与唯一 `SIZE`；setup 仍保留 `READY:64x20`，最终确认 `SIZE:112x28` 与页面一致。实际 `workbench.action.reloadWindow` 产生同一 UI 的新 Host，旧 Host/provider/主体均按原 PID、启动计数和可执行文件身份退出；主体在真实 SIGHUP 后写入完整中文/ANSI 尾部并以 exit7 结束，保存文件、原始写入字节、snapshot 重放、页面光标 `(6,4)`/可见行、无重启执行、无 runtime binding/pending operation、产品 reset 和 cleanup 全部通过。证据中的 `oldReaderOutcome=not-observed`、`sourceEofClaim=false` 和 `oldHostExclusiveDiskWriteClaim=false` 保持，不能扩大为旧 reader 已应用或 EOF 已确认。首轮尺寸失败与其失败清理 pending 仍作为历史事实保留。

同日补齐一项直接启动责任缺口：Supervisor 明确返回 `rejected-before-acquire` 时，Host 只清理对应的 candidate start reservation，并将未取得资源的节点置为可重试错误；网络、能力或资源状态未知仍保留原 reservation/quarantine。Terminal/Agent 同节点重试回归已随 Host wiring 达到 149/149。该修复不改变 Q=1 的 acquire 限制，也不把十会话校准升格为产品并发上限。

首轮和第二轮 setup 失败后的 `Local final snapshot persistence is pending` 仍按 §26.3 解释为安全拒绝：`persistNonNativeHostFinal()` 已写出 root-local 与 workspace snapshot，owner 资源也已退出，但 workspaceState Promise 尚未完成时 reset 不删除节点、不伪报 cleanup 成功。该恢复分支不代表健康 Reload 路径失败；若未来要保证“自然结束后立即 reset/delete 必须成功”，需另立 bounded persistence 等待验收，不能用本次失败清理改写既定契约。

修订记录（2026-10-02，旧系统边界收口）：用户决定本次重构使用现代 GitHub-hosted runner 即足够，不再等待 macOS 10.13/10.14 或 Windows 10 1809。固定六格、产品 workflow 的浮动标签及旧版本未验证事实均保留；不把现代 runner 结果外推为旧系统兼容，低版本问题在收到实际报告后另行修复。

## 51. 现代 runner 生产候选回收与 macOS Agent 未决（历史状态，已由 §52 更新）

本提交 `4c8c0f73` 的现代 runner 回收结果如下：固定六资产 run `36906440380` 的 Ubuntu 24.04 x64/arm64、macOS 15 x64/arm64、Windows Server 2025 x64 与 Windows 11 ARM64 六格均成功；macOS Product Provider `36906440973` 与 Windows Product Provider `36907160402` 的 Node/Electron candidate、Terminal/Webview、completed reopen 与 cleanup 均成功。两条 provider workflow 仍使用现代 `macos-latest`/`windows-latest` 浮动标签；固定资产 workflow 的六格版本记录不能改写为所有浮动标签的同一版本。Node.js 20 action 弃用只产生 GitHub annotation，不改变 job 结论。macOS artifact zip 的 `ENTRYNOTSUPPORTED` 也是非阻塞归档警告，保留原事实。

Windows 真实 Agent run `36906573764` 在同一提交、固定 Codex 0.157.1/Claude 2.1.280、DeepSeek 和现代 Windows runner 上八场全部通过，四个 natural 场景有实际响应/EOF，cleanup 的 binding/failure/forced/active 均为零。该结果只关闭该固定 Windows Agent 矩阵，不外推 macOS 或旧系统，也不关闭非空 snapshot stop 的重开等价责任。

macOS 真实 Agent 的第一次 run `36906574728` 与唯一允许的同输入重跑 `36909378525` 均保留为失败证据。第一次 Codex 四场和 Claude live natural/stop 已通过，`claude-snapshot-only-natural` 在 `agent-candidate-tests.cjs:50` 的 bounded `poll` 超时，snapshot stop 未运行；第二次 Codex 四场通过，但 `claude-live-runtime-natural` 在 `agent-candidate-tests.cjs:153` 未及时取得 execution identity，后续 Claude 场景未运行。两次前置认证、构建和 runner 环境均通过，报告 `failureClasses=[]`，没有凭据、原生资源或 cleanup failure；失败点分别是 Claude candidate 启动/reader readiness 的不稳定性，不能称 macOS Agent 已通过，也不应放宽旧断言或追加自动重跑循环。此前新 helper run `36858502983` 的八场通过及所有历史失败继续保留，不能用新失败抹掉旧通过或反向宣称根因已定。

静态根因核对（2026-10-02）进一步收窄第二次失败：`tests/vscode-smoke/agent-candidate-tests.cjs:148-153` 先等待 Webview xterm `terminalCols >= 64`，随后只读取一次 `getHostMessages`；xterm 挂载/布局与 Host 等待 Supervisor 分页 reader 后记录 `host/executionSnapshot` 是两个异步阶段，因此 macOS 的 `line 153` 失败可由正常调度延迟触发。现已将该处改为在原 30 秒 bounded `poll` 内等待带 `executionSessionId` 的快照，未放宽 identity、EOF、尾部或 cleanup 断言。首轮 `line 50` 的 snapshot-only xterm 尺寸超时仍是独立未决证据，不能由此修正代替，也不据此归因低版本或宣称产品根因已闭合。

本节只收口现代六资产、两平台 Product Provider 和 Windows Agent 的具名矩阵；macOS Agent、A2/A3 非空 snapshot stop 页面/重开等价、A1/F-04、旧系统兼容和默认准入仍开放。低版本环境不属于本次重构前置，后续仅在出现实际报告时单独定位。

## 52. macOS Agent 矩阵在 harness 窄修后的回收

提交 `56cec10c` 将 Agent 验收脚本在 xterm probe 后对 Host execution identity 的一次性读取改为原 30 秒窗口内的 bounded poll；没有改变 execution identity、自然 EOF、响应内容、snapshot 保存或 cleanup 断言。随后现代 macOS runner 的 run `36911430020` 以同一固定 Codex `0.157.1`、Claude `2.1.280`、DeepSeek 和 VS Code/Electron candidate 完成八场并整体成功：Codex/Claude 的 `live-runtime` 与 `snapshot-only`、`natural` 与 `stop` 全部 `pass`，四个 natural 场景均有实际 CLI 响应/EOF，八场 `bindings/failures/forced/active` cleanup 均为零。报告位于 `.debug/ci-36911430020-latest/runtime-real-agent-macos-36911430020-1/summary.json`。

该 run 关闭现代 macOS Agent 的具名 CLI/Host/Webview/EOF 矩阵，不抹除 `36906574728`、`36909378525` 或更早历史失败；它证明的是窄 harness 修正后的整条验收路径，而不是低版本兼容。`claude-snapshot-only-stop` 因保存状态非空按既定规则不要求重开，报告中的 `pageProjectionIndependence=not-proven` 及非空 snapshot stop 页面/重开等价仍是独立边界，不得写成通过。A1/F-04、A2/A3 未填页面责任、默认生产准入与 root 稳定归属继续开放。

修订记录（2026-10-02，非空 snapshot stop 重开验收）：snapshot-only 的显式 stop 不再按保存内容是否为空选择是否重开。首 Host 继续要求 reader/save/replay 证据；空快照保留原页面 origin 断言，非空快照由新 Host 严格对账完整保存 buffer、可见行、尺寸、光标、viewport、buffer 类型、节点序列和无新执行。测试层 helper、CI 摘要与 fixture 已通过定向回归，未修改业务实现；既有现代 runner 非空 stop 结果不追认通过，新真实 runner 复验待执行，A2/A3 责任保持开放。

后续同一提交 `30f421b3` 的 Linux 真实 Agent run `36917661214` 与同输入复跑 `36918349766` 都在首场 `codex-live-runtime-natural` 超时，CLI 已观察但节点仍为 `waiting-input`/`liveSession=true`，cleanup 责任为零；后续场景没有执行。该失败按 Agent 生命周期/服务时序阻塞登记，不归因新重开 helper，不再自动重跑；新的非空 snapshot stop + reopen 仍没有真实证据。
