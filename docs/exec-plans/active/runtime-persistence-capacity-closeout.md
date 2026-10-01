# 收口 Runtime Persistence 的容量与交互成本

本 ExecPlan 按 `docs/PLANS.md` 维护，承接 `docs/design-docs/runtime-persistence-closeout.md` 的 B1/A1，不是新的退出诊断阶段。输入为 `8dd82629`。F-04 目标是长历史不再要求每层常驻/一次性复制完整后缀，实际在途数据有约束，恢复不挤掉交互；F-05 的无 completed 历史与退出尾部保证不变。工程判断由代理承担，不等待用户选择预算。

当前B2依赖（2026-10-01）：macOS run `36820565903` 原生前三例通过、partial-create首次结论缺失而失败、Electron未运行；共享deadline提前通知机制已确定性先红后修，Windows核心和两authority接线已局部验证但未原生验收，见生产接入33.6与34节。继续既定平台产品验收，不改变已通过的10.15、不新增容量重复矩阵，不关闭F-04、本计划或正式准入。

当前入口（2026-10-01，覆盖后面的历史下一步）：容量设计 10.15 的 `.debug/a1-host-reconnect-20261001-overlap/` 固定一次运行完整 exit 0；B 回复 51ms 实际应用，同一 Webview 动作的 A 块号 12 到 18 满足 `0 < before <= after < 2560`，新 Host ready 后 13137.248ms 完整追平。原两主体/2:1候选/负载、1500ms 与不重置的30秒期限不变，完整后缀、原执行/新 reader、独立 journal/hash、自然 no-history 及两份 cleanup 通过，outer forcedSignals/failures 为空。该组合已覆盖，10.14 和旧失败不改；下一按生产接入第33节推进 B2/A5 的macOS产品owner/provider、两authority工厂、namespace及匹配Node/Electron/packaged接入，平台仍未验，Windows及F-04总体保持开放，不重复成功矩阵或追加工具阶段。

当前入口（2026-09-30，覆盖后面的历史下一步）：10.13 已实施 reader-local 单段认证偏移索引并接通 Webview/Host 两消费链，10.14 的 `indexed-pages` 同输入实际重连完整 exit 0；Host ready 后 13.01 秒追平 2560 块、B 32.6ms，独立来源 hash/自然 no-history/清理通过，原 30 秒期限不改。同一新 2/1 构建的真实 Codex/Claude 两模式 natural/stop 八场景也已完整 exit 0。原四次重连 exit 1 保留，该固定冷恢复阻塞解除，不能关闭全部 F-04/A1。剩余必要产品组合、平台接入与分发继续按有限收尾契约；2026-10-01 第四轮 DeepSeek CI `36812745671` 的 Linux 真实 Agent 八场景有限通过，专用凭据已实证可用，不再列为用户阻塞。第三轮 Codex snapshot-only stop 间歇失败本轮未复现、根因未定位，不声称已修；macOS/Windows provider、build、namespace 工程仍未完成，不追加 CI 捕获循环或关闭总体。

最新进展（2026-09-30）：显式 10/1 candidate 的 `.debug/a1-ten-session-20260930-probe-fixed/` color/size 十 Terminal 三档完整 exit 0，每例 27 次实际响应全部应用，最大 1365.5/1323ms；原运行前资源预算、来源 hash、自然退出无历史和清理通过，见容量设计 10.12。1280 档两例观察到同 reader 隐藏恢复的追赶交互重叠，不是 Host 离线恢复；两个 probe 前置 exit 1、v18 与更早失败保持。下一只推进原 A1/A2 的固定真实 Host 两次 launch 重连（10.11），不关闭 F-04、其余 A 项或正式准入，不新增工具阶段或 profiler 前置。

预算决定形成时的记录（2026-09-30，后续接入状态以本计划顶部为准）：按用户要求，合并进程样本的额外 heap/RSS 64/128 MiB 只作为观察信号，不再作为 B2 接入门槛；原阈值、数值、断言及 exit 1 原样保留。F-04/B1/A1 仍开放；既有退出计划已完成 B2 profile/generation、Linux namespace 排他及显式 candidate Manager 的 Terminal/Agent 新建启动，candidate bound 不重启，extension 默认仍关闭，snapshot-only 原显式工厂不改。下一接剩余扩展两模式入口与匹配资产。真实分进程、多会话资源/交互预算归 A1，profiler 不默认前置。该决定取代下列原日期记录中的“下一先采样归因”安排，不改历史证据。

32.15 时点的 B2 依赖进展（后续准入和十会话结果以本计划顶部为准）：实际 extension 的构建期候选选择与 Linux Electron 资产已接通。退出提示覆写、snapshot-only 当前 live 投影及大快照读取丢弃已修，Runtime/editor 已有大输出/终态/重开证据；32.10 的 `snapshot-normalization-fixed` 单选真实 complete/reopen exit 0，90002 行、工件光标 `(6,2)`、5580063 字符快照及 applied 1396/清理通过，旧 exit 1 全部保留，不外推为 OS 全程无新进程追踪。Host 110/110、tracker、journal、checkpoint、typecheck 及补翻译后的 localization 通过；source-eof 复验后的主线 Host wiring 144/144、Supervisor wiring 90/90、protocol/localization 与 typecheck 也通过。A4 v18 与 `.debug/a4-real-agent-20260930-source-eof-rerun` 已完成 Linux 实际 Host 八场景有限复验，natural source evidence=eof，stop 保留 `sourceEofClaim:false`，observer/cleanup 无 failure、无 forcedSignals、runtime bindings=0。该结果不代证 A3/A5/A1、跨平台或默认准入，v18 与旧失败保留。A1 分进程多会话预算及候选共享两槽的生产策略仍未完成，不因页面通过关闭 F-04 或把两槽改为产品上限。后文旧“剩余扩展入口”不再要求重复接线。

## 目标与全局图景

沿现有 Supervisor、journal（可校验的分段终端事件文件）、缓存及分页链，直接修正长期会话下的全量物化或无界积压。用户应能在其他节点高输出或重连追赶时继续操作当前节点；已接受内容仍按顺序可读。不能只得到小消息数字就宣布整体 F-04 完成，真实 socket、Host 与页面证据分别登记。

已完成的结构修复不重开；当前生产源有界化依赖 B2 的 owned 接入，因此不能以合并进程样本先变绿为前提阻止真实链形成。最终 A1 要给出实际各进程与多会话总量的资源/交互结果，不能拿旧合并阈值代替，也不能在转向 B2 时关闭本计划。

## 进度

- [x] (2026-10-01，B1/A1输入) 设计10.15在运行前冻结原两主体color离线恢复的交互顺序/同动作前后块号/1500ms与不重置30秒判据，保留旧indexed-pages及全部内容/身份/清理。
- [x] (2026-10-01，B1/A1有限验收) 原test窄调及runner判据摘要后，`.debug/a1-host-reconnect-20261001-overlap/` 固定一次完整 exit 0：B51ms应用、A12到18未追平、ready后13137.248ms完整恢复，原身份/hash/no-history及两份cleanup通过，无强杀；不关闭总体或重跑求次数。
- [x] (2026-09-30) 固定真实 Host 两次 launch 已执行；原执行身份/绑定、新 reader 与离线 source receipt 成立，但 `tail-observed` 在原 30 秒期限只到 1404/2560 块。四轮 exit 1 保留，末轮清理通过，B 新交互/独立 journal hash/自然无历史未到达，不记整体通过。
- [x] (2026-09-30) 按容量设计 10.13 修复每页整段重扫：只保留单段认证偏移索引，每页释放读取保护。96 页读取量由先红 116286624 bytes 降到 <=2×1211319 bytes，完整性/取消/compact 回归通过；同输入实际冷恢复 `indexed-pages` exit 0，详见 10.14。
- [x] (2026-09-30) B2 已接实际候选扩展与匹配 Electron 资产，Runtime/editor 和修后 snapshot-only 的对应有限完成/真实重开证据分别成立；后者 `snapshot-normalization-fixed` 单选 exit 0，旧 live 投影、夹具字段及真实重开失败均保留。Host 110/110 等回归通过；不是 A1 容量结果，不重跑合并阈值样本。
- [x] (2026-09-30) 原 B2/A1 的共享两槽硬码已改显式冻结准入并在实际 10/1 candidate 执行固定十 Terminal；省略仍 2/1，unknown 停排和尾部预算不变。声明负载资源/交互通过不等于正式产品准入或最大会话数，其他容量责任仍保留。
- [x] (2026-09-30) 按容量设计 10.8 完成固定实际 Electron 校准 v18：color/size、0/1/2 基线及 640/1280/2560 三档均运行；全部交互 <1500ms、独立 journal 对齐与拒绝原因正确、自然结束无历史及 cleanup 通过。保留旧失败及 oracle 修正经过，不关闭正式预算或全部 A1。
- [x] (2026-09-30) 按生产接入 32.16 将 owner/authority/Host 最终保存共用显式准入策略，默认 2/1 不变；非默认容量、并发启动、unknown 与保存占槽回归通过：adapter 98/98、owner 46/46、Host 145/145、factory 25/25、build selection 9/9。真实候选编译 10/1，实验槽数不成为产品上限。
- [x] (2026-09-30) 原十 Terminal 固定 color/size 负载在 `.debug/a1-ten-session-20260930-probe-fixed/` 完整 exit 0：每例 27 次响应、全部预算、来源 hash/保留后缀、无历史自然结束和 cleanup 通过，最大 1365.5/1323ms，资源样本 260/256 份。1280 同 reader 追赶重叠有实际观察，不代证 Host 离线；前两轮 probe 发端/接端两条上限的 exit 1/cleanup 与协议先红/修后证据保留。
- [x] (2026-09-30) 按设计 10.11 执行真实 Host detach/reconnect，10.14 同输入修后全部有限断言通过，13.01 秒追平、B 32.6ms、hash/no-history/清理通过；没有追赶交互重叠。旧失败与各自首报保留，不代证全部 A1/A2。
- [x] (2026-09-30) 同一新 2/1 Electron 构建的 `.debug/a4-real-agent-20260930-indexed-pages/` 真实 Codex/Claude 两模式 natural/stop 八场景完整 exit 0；四 natural 取得实际 eof，四 stop 不声称 EOF，bindings=0、observer failures=[]、forcedSignals=[]。只补当前构建有限回归，不代证 A3 大尾部、其他平台或全部 A1；跨平台真实 Agent 认证/执行位置仍待用户提供安全渠道。
- [x] (2026-09-28) 读取有限收尾契约、现有容量脚本与产品链；确认 live checkpoint 完整扫描物化、journal 待写和普通 socket 背压缺口。
- [x] (2026-09-28) 固定本轮输入、初始工程预算与事实分账，设计见容量重评第 10 节；不新增 D 系列工具。
- [x] (2026-09-28) checkpoint 先红 34,508,616 bytes retained heap，修后约 100 KiB；保留全部校验与双代语义，独立 review 所见 raw bytes 漏校验先红再补，原 journal 回归及八类损坏负例通过。
- [x] (2026-09-28) owned 写入先红：实际 append 阻塞而 consumedThrough=4；消费信用改为等待 journal 完整 flush，Terminal/Agent 慢写及失败回归通过，Supervisor wiring 77/77。
- [x] (2026-09-28) 新路径唯一一次完成负载的 1x/2x/4x 校准内存超限，保留失败；原十会话浏览器基准 1/1 通过，输入/ACK/回显 13.2/19.3/170.2ms，不代证真实 Supervisor/Agent。
- [x] (2026-09-28) 从 `4dc42c87` 修分页整段物化，先红单次读取 1,211,319 bytes；修后 64 KiB 块/当前记录/页、完整段校验及原回归通过。一次原预算对照 RSS 达标、heap 仍超限，旧失败保留。
- [ ] 收敛 journal、socket、Host 在途责任并对直接阻塞作必要修正及验证；未实施或未覆盖部分保留为 B1 未完成，不另开退出阶段。
- [x] (2026-09-28) 从 `d432bf89` 接通具名 Host 页消费信用；旧真实 socket 暂停 Host 仍推送 96 条 raw 事件先红，修后单页在途及 97 事件无损、控制/其他会话进展、compact/重连和取消隔离通过，设计见第 10.3 节。
- [x] (2026-09-28) 从 `52ff49bc` 收敛 Host/Webview 水位通知为单在途与最新待发；旧 Host 无回执 1000 条先红，修后单条及最新 revision、标题、生命周期、重附着和投递失败回归通过，浏览器 8/8；不改正文/最终应用契约，设计见第 10.4 节。
- [x] (2026-09-28) 从 `f24a84f0` 分离 owned 消费解析屏障与完整快照，取得实际消费序列化先红并保持最终保存/错误契约；真实 Linux provider/socket/Host 固定负载各一次对照，序列化 1616→4 次、内容/终态/清理通过；current 2x/4x 内存仍超限，见第 10.5 节。
- [x] (2026-09-29) 从 `c1de9301` 修正实际 Host line-context 的共享未决取消 Promise 累积：先红 1!==0，修后独立登记随在途释放、销毁仍唤醒；原固定实际链唯一新 current 内容/终态/清理通过，2x/4x 内存仍失败，见设计第 10.6 节。
- [x] (2026-09-30) 按用户要求修正当前预算口径与顺序：合并进程 64/128 MiB 为观察信号，旧结果及 exit 1 不改，profiler 不作 B2 前置；正式决定见容量重评第 10.7 节与收尾设计第 3.1、8 节。
- [x] (2026-09-30) 承接 B1 对 B2 的依赖，完成启动 profile 传递与隔离 generation 校验，启动 16/16、Client 28/28 和相关回归/typecheck/build 通过；默认关闭和 Host cold-start 限制保持。同 namespace 排他首次启动与两模式入口仍由退出计划的原 B2 承接，不关闭整体依赖。
- [x] (2026-09-30) 从 `4578cd34` 继续原 B2，在恢复前取得 Linux namespace claim 并持到进程退出；显式 candidate Manager 新建 Terminal/Agent 使用隔离 generation、`allowRestart:true`，candidate bound 保持不重启，旧 raw/stream 路径保留。namespace 7/7、启动 16/16、Client 28/28、Host 104/104、Supervisor 82/82 和 typecheck/build 通过，详见生产接入第 32.1 节；extension 默认仍关闭，无新增容量或实际产品整链通过。
- [ ] 在实际分进程生产候选上登记并验证 A1 的资源/交互预算，包含多会话、慢消费/重连及输入控制；F-04 保持未完，按具体风险使用必要归因工具，不再将 profiler 作为自动下一项。
- [x] (2026-09-28) 本轮结果/残余债务已同步，独立 review 的字节校验问题已复现并修复、复核无新阻塞，以本地提交交付该增量；F-04 未整体通过，计划保持 active，不 push/PR。

## 意外与发现

2026-10-01，10.14的B交互安排在完整后缀之后，`overlap=false`不抵消原恢复通过。10.15只改变原动作顺序与readiness/判定，未增加数据或sleep，就观察到B51ms应用时A由12推进到18且仍未追平；本次来源hash与原输入一致、revision6502，随后原内容/身份/无历史及清理全部通过。该事实补齐具名组合，不能推导一般性能保证或将10.14改记重叠。

2026-09-30 `indexed-pages` 在原输入/期限下完整 exit 0；局部确定性读取量对照证明重复扫描已消除，真实新 Host 13.01 秒完整恢复证明该固定流程达标，但两者不能量化所有耗时来源。独立 review 的“读取已 yield、释放未完成时取消”窗口已加检查/回归；只修原测试抽取缺两个 global 及旧 snapshot regex，未降低真实内容要求，详见容量设计 10.14。

2026-09-30 真实冷恢复已将容量风险具体化：`.debug/a1-host-reconnect-20260930-tail-observed/` 的 source receipt 完整，而截止时 Webview 仍在 1404/2560 块。源码确认 Webview 页请求与 Host 信用泵均新建 iterator，journal 每页全验约 4 MiB 段；不能把“retained row 0 不符”直接写成损坏，也不能声称重复扫描已解释全部耗时。四轮前置失败、日志覆盖局限及原清理首报见容量设计 10.13，全部保持。

2026-09-30 十 Terminal 固定负载通过后，两例 1280 档均有 `catchupOverlapObserved=true`，color 前六个 peer、size 第一个 peer 输入时 A 尚未到目标，响应实际应用；但 `sameReader=true`，所以只补足隐藏恢复追赶交互证据。资源预算均通过，总 RSS 峰值 3801968640/3843158016 bytes 包含 workbench/共享页重复及采样开销，不代证一般 SLA 或未测 Supervisor heap；没有修改运行前界限。剩余真实离线重连必须按 10.11 观察旧 Host 消失及新 Host/reader，不能凭 surface 隐藏推断。

2026-09-30 十会话首轮 `.debug/a1-ten-session-20260930-first/` 已创建第三个 live session，但原 Webview 校准 probe 仅保存两 reader，等待第三个 reader 超时；`.debug/a1-ten-session-20260930-reader-fixed/` 修发端后又因 Host 协议最多接受两 reader 而丢弃回复。两轮 exit 1 与 cleanup.pass=true 保留，不是会话准入或维度已证失败。收发端统一有限上限十条，协议测试对 2/10/11 条先红再绿；清理把已确认 Supervisor ancestry 的主体身份并入采样账本，避免首败先于下一采样时漏掉本方主体。此修正仅服务固定十会话判定与安全，不扩通用工具。

2026-09-30 v18 完整校准确认两项验收工具误差：B 终端尚未滚动时，真实响应位于光标邻域而非 buffer 最后十行；v16 原始 journal 比 receipt 恰多 327680 个行尾 CR，连续流规范化后逐字节/hash 相同。v17 逐 event 替换与后续 stateful 初稿都漏跨 chunk CRCR/LF，当前源码保留整个尾部 CR run 后，45 个局部切分检查及 v16 保存工件 hash 核对通过。它们不构成 Runtime journal 丢失证明，原失败不改。v18 RSS 角色观察仍不足以把 64/128 MiB 变成产品预算；恢复时 A 已追平，没有取得隐藏恢复追赶重叠证据。

2026-09-30 固定校准准备核对：现有实际 Host 可以读取本 isolate heap 与进程 RSS，但 Supervisor/provider 没有 heap 查询协议，Webview 也不能可靠对应独立 renderer RSS；不可将缺值补为零或把 Host 值复用。测试 ring 会 clone 正文，必须保留该观测开销说明。现有 UI 隐藏整个 surface，不保证 reader 卸载，因此 10.8 明确区别隐藏恢复和真实离线重连。

2026-09-30 A1 v4 首次校准已运行：color 首档 `output-640` 因 nonce `color_640_0` 在 1500ms 观察界限内未应用而 exit 1，保留 78 份采样与零/一/二会话 idle 基线；这是有限交互观察界限首败，不是 OOM 或正式产品预算结论。size/后续档位与隐藏恢复未运行。候选 `ExecutionAuthority.reserve()` 与 `NonNativeExecutionOwner.reserve()` 仍沿用 `S1_LIMITS.executions=2`、starting=1；这是有限候选约束，不是产品已获认可的两会话上限，必须在原 A1/B2 生产策略中处理，不能用两会话成功代证既定十会话。现有真实 Electron smoke 可承接分进程测量，旧合并容量脚本不能直接升格；不可得的 Supervisor/provider heap 不补为零。

2026-09-30 实际页面证明 reader applied 后仍可能被宿主装饰性退出文本破坏终态；snapshot-only 活着的 PTY 也曾被元数据错误标非live，合法大快照还会因读取端 5 Mi 字符条件丢失并回写降级状态。三项已按生产接入 32.4/32.7/32.10 修正；大快照实际重开单选通过不等于 A1 内存通过，不能把这些直接产品缺口归因于旧合并进程阈值或扩诊断框架。

2026-09-30 的 B2 启动核对确认 registry 恢复可修复 journal stale tail，并非只读；namespace 排他必须先于恢复。claim 以 uid 与 `realpath(storageDir)` 定义、不含 backend，保护 detached/systemd 共用的 registry；本版 Linux 进程持有到退出，不因业务 listener 关闭释放。candidate systemd 改为 `Restart=no`，避免竞争败方反复重启后接管。该有限启动修正不量化 A1 内存，也不证明跨主机、旧 candidate 或真实 systemd 服务验收。

2026-09-30：现有样本将 Supervisor、受控 Host 和分页模型放在同一 authority 进程中；即使 provider/主体实际独立，其 authority heap/RSS 仍不是产品分进程资源分布。原 64/128 MiB 可以记录该样本的越界，不能直接推出各真实进程或多会话的产品预算失败。已经复现的结构问题仍成立，未量化的峰值来源仍未知；当前尚无完整生产拓扑预算，也不能据此宣称内存问题消失。

2026-09-29：取消登记原结构由空 flush 后 1 个未决 reaction 直接复现，修后真实 parser/并发/错误/dispose 等待全部按责任释放。一次同负载 current 的额外 heap/RSS 为 43.63/75.38、67.73/134.03、68.22/142.98 MiB，仅第一档通过；4x 仍超 64/128 MiB，回放 5.473 秒低于 30 秒但高于前轮 4.655 秒。没有分配栈或存活对象来源证据，不能把下降差值全算作取消结构贡献，更不能据此继续猜测修正。

本轮实际 owned 消费逐批调用强制快照 flush；替换为只等待真实 parser 的 drain 后，实际 provider 对照序列化累计 1616 次降至 4 次，耗时 7590.04ms 降至 39.75ms。但 current 2x/4x heap/RSS 仍超限，4x 为 99.14/167.45 MiB，高于同拓扑 baseline 的 76.77/152.77 MiB；不能用工作减少推断峰值下降。分页仍逐页完整校验相关段并重复 JSON 解析/编码，是待归因路径，不是已证明泄漏。本轮三档采样未分别归因生产、Host 和 replay 的峰值。

2026-09-28 的只读核对发现 line-context 在每次 writeSegment/awaitPendingOperations 中对同一长期未决 disposedSignal.promise 做 Promise.race；消费胜出不会解除另一分支的 reaction，注册随生命周期累计，直至 dispose 才结束。正文 replaySegments、lineCwds、journal cache 有限不能替代这项取消结构的边界。该项于 2026-09-29 修复，但不将其量化为整个峰值来源。

输入版本 `terminalSessionJournal.ts` 的 `commitCheckpointOnWriteChain()` 调用全量 verifier，而它收集所有 events/checksums/recordByteEnds；这是正常 live 操作，并非仅崩溃恢复。`pendingWrites` 和 `writeChain` 的字符串闭包不受 1 MiB 事件缓存限制。原新 provider 的 `consumeOwnedOutput()` 等 tracker，但不等 journal 写入；普通 socket 写也没有统一等待背压。前两处已按本计划修复，代码事实不等于已测 OOM。

`audit-runtime-persistence-capacity.mjs` 当前为新旧对照而主动生成完整 snapshot/retained 数组，不能直接将其 RSS 算成新分页路径峰值；十会话基准注入 Host 消息和 ACK，不能代证实际 Supervisor/PTY。

新增 `--paged-capacity` 唯一完成负载的校准 1x/2x/4x 正文和终态正确，但所有档额外 heap/RSS 均超 64/128 MiB。实际分页会每页重新读/解析并物化整个相关段，是确定分配热点，不足以证明所有峰值归因或内存泄漏。脚本启动入口漂移和重复导出导致的两次前置失败、原 Host reconnect harness 缺 admission 方法的失败分别保留，未改变产品/历史断言求绿。

后续直接扫描修正的单次对照 RSS 增量降至最高 116.92 MiB，heap 却仍最高 103.72 MiB，整轮仍失败。每页重扫换取较低工作缓冲，4x 回放从 5.903 秒增到 7.699 秒，仍在原 30 秒内；不把工具/双 tracker 临时分配或 GC 作为未经测定的超限免责。当前已确认整段物化已消除，其他堆占用尚未归因。

通知合并的独立 review 命中同 readId 重附着：relay 可返回旧 descriptor，页面对此不执行新 reader 的初始强制拉取，清掉较新 pending 会遗失唤醒。最终实现保留同身份通知信用，于 snapshot 后显式合并当前 session revision/title；原 receipt 有效但重复无效，frame/执行身份替换后的旧 receipt 无效。这样重复 attach 也不绕过单在途限额。另保留原通用 postMessage 的 void 契约，只让提示取得原投递 Promise，避免把其他 catch 续体改成等待投递。stock node-pty 的公共 pause 不足以证明退出 drain，故当前生产源有界化不能靠简单暂停补丁关闭。

## 决策记录

2026-10-01 / Codex：返回原F-04/B1/A1，按10.15将B真实交互移到A部分恢复/B已挂载时，同一Webview动作保存前后块号且两者均小于2560；原1500ms及同一个30秒总追平期限、来源/身份/无历史/清理不变。理由是补现有离线恢复交互缺口，不增加负载/sleep/工具阶段；未重叠只能报未覆盖失败，不自动判产品退化。

2026-10-01 / Codex：10.15固定一次完整通过后结束该组合，下一沿原B2/A5推进跨平台产品接入，不重复此样本、十会话或已通过Agent矩阵求次数。理由是新Host恢复与B交互的同动作证据及原完整性要求已经取得，剩余平台实现/产物和有限产品验收不是通用工具工作，整体F-04及第三轮Agent间歇失败仍保持未决。

2026-09-30 / Codex：在原 A1/F-04 内选定 reader-local 单段认证偏移索引，先全段校验后按页定点验证，不保留整段正文。每页归还 activeReaders，故不采用跨远端消费等待的长寿 generator；新 reader 必须重新验证，dispose/错误不返回成功 EOF。Supervisor 同时接 Webview reader 和独立 Host 订阅，现有测试先红/修后验证重复工作与校验边界，随后按设计 10.11 原输入、30 秒期限复验，不放宽尾部或追加工具阶段。

2026-09-30 / Codex：固定十 Terminal 声明负载已完成，不再为增加次数重复该矩阵；保留两个 probe 首败、全部原预算和 v18 校准。下一沿原 A1/A2 的 10.11 固定两次真实 Host launch，验旧 Host 消失后的来源、原执行不替换及新 reader 恢复，未知追赶组合不补造通过；该用户流程属于原容量/恢复责任，不新增诊断阶段。

2026-09-30 / Codex：显式构建 10/1 串行新建十 Terminal，仅 A 使用三档大输出，另外九个独立输入响应；预算在运行前按设计 10.10 冻结，观测超限保留 exit 1，不调整门槛或取消来源/自然退出/清理检查。默认构建不启用候选，不以实验槽数作产品限制；原 A4 回归使用旧 dist，不能冒称 admission 原生覆盖。

2026-09-30 / Codex：先离线核对已保存 v16 来源，只修固定 oracle 的跨事件 PTY 行尾，再运行 v18 原 color/size 负载，不改 1500ms/30秒/scrollback/块数。完整校准后停止重复两会话采样；按生产接入 32.16 分离准入政策，未知责任、原 wire/退出限额不变。当前资源增长只触发有限源码归因，不自动开启 profiler、压线优化或一般工具增强。

2026-09-30 / Codex：采用设计 10.8 的唯一固定 Electron 校准，分别测颜色与尺寸拒绝、零/一/二会话基线及 1x/2x/4x，250ms 有限采样，B 以真实主体回显在 xterm 应用结束计时。保留 1500ms/30秒工程界限、10分钟/额外2GiB实验保护，后两者不是产品预算。只补现有 smoke 的限定测试入口，未知 heap 保持未测，不建 profiler/诊断协议；校准后固定生产资源模型并处理十会话，不能循环改数求通过。

2026-09-30 / Codex：A1 沿实际 Electron/Host/Supervisor/页面入口执行唯一 v4 校准尝试；零/一/二会话 idle 基线已采集，color 首档在 1500ms 观察界限首败，保留首报和部分资源样本，不将其解释为 OOM、产品预算或通过。size/后续档位与正式预算继续开放，不循环放宽门槛；A4 source-eof 八场景有限通过见退出完整性生产接入第 32.15 节，不抵消容量首败。

2026-09-30 / Codex，按原 B2 实际验收直接修页面与两模式接入失败，候选固定构建不静默降级、原失败不改；该记录形成时 A1 尚未采集多会话内存或选定新的数值结论，profiler 不默认前置；随后 v4 首档结果见第 10.9 节，仍未形成正式预算。

2026-09-30 / Codex，B2 安全首次启动：仅显式 candidate Manager 的新建连接准备获得 `allowRestart:true`；candidate bound 恢复、reader、strict delete 与未知 create 不获得该许可，缺省旧绑定仍解析原 workspace slot。legacy bound 首次连接默认不重启，显式选项及 stock Client 既有内部请求自动重启保留，不承诺全部旧路径完全 no-restart。Linux/Node >=20.8 的 abstract socket claim 在恢复前取得并持到进程退出，candidate systemd `Restart=no`，stock 不改。下一接剩余扩展两模式入口与匹配资产，extension 默认仍关闭、snapshot-only 工厂不改；详见生产接入第 32.1 节，不新增容量或诊断里程碑。

以下同日预算重评记录保留前一增量时点，其安全首次启动待办由上述进展承接：

2026-09-30 / Codex，按用户要求：将合并进程 64/128 MiB 定位为观察信号，而非实际产品分进程预算或 B2 前置。保留原值、原结果、exit 1 与所有先红/修后证据，不改脚本门槛重跑求绿。当前下一项由 `runtime-exit-integrity` active 计划承接 B2 profile 启动传递和隔离 generation 校验，具体规则见生产接入设计第 32 节；不默认启用、不开放 Host cold-start。同 namespace 排他首次启动是随后具体生产接入责任，不新增诊断阶段。F-04/A1 继续开放，实际分进程、多会话资源与交互验收仍由本计划收口，profiler 只在具体归因有必要时使用。

以下原日期决定保留当时背景；其中将合并阈值失败视为当前产品阻塞、要求先 profiler 或先达到原合并预算才接 B2 的顺序，由 2026-09-30 决定取代。

2026-09-29 / Codex：类内独立取消登记只存当前在途等待，正常/异常完成均注销；不引入通用框架、并发限额或超时。已销毁后不注册但仍观察 work，flush 原拒绝检查和 write callback/终端身份检查不变。先用直接登记计数验证结构，修后沿前轮未改入口/负载/预算取得一次实际链对照，不重跑旧版、不推定本项解释全部内存超限。

2026-09-29 / Codex：唯一容量对照仍失败后停止本轮 native 运行。下一以现成分配采样为归因证据，不直接改分页校验、不以 GC 后数值替换峰值；本轮不启动 profiler，更不据局部绿色关闭 B1 或提前默认启用 B2。

2026-09-28 / Codex：两次固定实际链样本完成后停止重跑，保留原 64/128 MiB 和 30 秒门槛。重复序列化修正可独立交付，但 current 内存失败仍是 B1 直接产品阻塞；下一工作围绕同链分配归因与必要修正，不先让旧模拟探针变绿。B2 的实际启动接线已经源码定位，不能通过默认开启不完整 Linux 候选来宣称 B1 或跨平台交付。

2026-09-28 / Codex：下一 B1 修正优先消除行上下文取消等待的非定长注册，完成点是已完成 work 不再保留取消等待，dispose 仍唤醒在途 work 且不能返回成功信用；不扩成共享框架。页内/段级完整校验不因尚未归因的重复扫描而削减，最终仍需通过真实链原预算。

2026-09-28 / Codex：原 owned 消费每批 flush 强制完整 scrollback 序列化，是生产路径成本而非仅探针问题。增加严格不序列化 drain，只替换 Host/Supervisor consume，最终/附着/保存/checkpoint 原 flush 保持。以实际源和实际 Host 信用做固定负载对照；不先打开缺跨平台资产/正式启动链的默认 profile，也不为此追加平台诊断框架。

2026-09-28 / Codex：普通水位通知采用独立接收回执，不能复用正文应用 ACK，也不能把 VS Code postMessage Promise 当作页面消费。bootstrap 前原地合并，最终 completed 控制消息独立交付并清理普通提示；frame/执行身份隔离由原 lifecycle 与独立 receiptId 共同保证。stock node-pty 的 socket pause 与 Unix 200ms/Windows 当前非 DLL 1000ms 退出 destroy 冲突，故旧生产链有界化随 B2 既定 owned 生产接入完成；B1/A1 仍开放，不为即将替换的路径新造生命周期，也不以候选局部测试冒充默认启用。

同轮直接失败处置只保留最新提示：投递 true 等真实 receipt，false/throw/reject 回 pending，后续输出、可见性恢复或重附着可重投，不增 timer 重试或通知丢弃门槛。错身份或旧 Promise 的迟到结果不能清理新项。协议旧页面仍逐条推送，不把兼容路径改写为已经有界。

2026-09-28 / Codex：先修可以直接证明的正常 checkpoint 全量物化；仍执行完整 checksum 验证，不放宽资格或删除坏记录。只保留本次提交需要的校验锚点与分段元数据，不改变外部完整 verifier/旧恢复接口。待写/传输约束不能通过丢 chunk、将慢的有效 reader 判为 lost 或停止其他 session 达成。

固定校准基线采用旧颜色拒绝样本的 640 个 10 KiB 输出块为 1x，测 1x/2x/4x；缓存及页沿既有限额。校准进程额外 heap/RSS 初始观察预算分别 64/128 MiB，每档分页读取目标 30 秒；这些是本轮受控回归工程界限，不是实测结果、产品最大历史或对外 SLA。必须实际应用/校验数据，测量不得保留完整后缀污染结果；若超预算先保留失败并定位，不循环改阈值。十会话原门槛保持原样。

owned 信用等待 tracker 和 journal 完整 flush，后者包括已搬入 writeChain 的正文；失败请求停止并保留实际进程责任，不能提前 live=false。预算按整个校准进程计算（一个生产和一个回放 tracker），不扣除脚本或第二模型成本。后续针对实际分页分配与传输修产品，不因校准失败另扩工具；先保留段级完整校验与旧 reader 生命周期，不添加无预算跨页缓存。

2026-09-28 / Codex：分页磁盘扫描按 64 KiB 原始块查找 LF 并拼接当前记录，避免跨块 UTF-8 损坏；页满后仍扫描到冻结段尾验证可信锚，下一页可重扫。只推进实际入页 revision，保留超大单事件独页、跨段页及 reader pin。修后复用原探针/输入/预算作一次产品对照，属于当前第二/三个里程碑，不创建新诊断阶段。

2026-09-28 / Codex：选定 Host 独立订阅信用，不借用 editor/panel reader；正文页后等待严格 line-context flush，状态同样受信用约束但不因普通 chunk 触发额外全画板保存。正常退役保留游标来源，而 delete RPC 不等其调用方待发的批次 ACK。断连释放旧责任；可读范围内恢复原消费 revision，已合法 compact 的旧游标具名拒绝并显式重建 checkpoint 基线，不追认缺失业务事件已消费。重连另行重新打开 Webview reader；一般损坏不套用该回退。这些均为本次传输改动的直接正确性要求，不新增工具门槛。

## 结果与复盘

当前增量（2026-10-01）已完成10.15实施与固定一次真实运行，`.debug/a1-host-reconnect-20261001-overlap/` 完整exit0、overlapAcceptance=covered。B51ms应用、A12到18；HostReady1501.906ms/fullApply14639.154ms/catchup13137.248ms，原30秒与1500ms不改。原执行/新reader、完整后缀、source26214425bytes/SHA `0167208c8b0fcf6bd465c0c19064d3f7584429ef32e4cbb2841f1e147ee5ed98`、revision6502/color-state、自然no-history和两份cleanup通过，outer forcedSignals/failures为空。旧indexed-pages及失败不改；下一B2/A5跨平台产品接入，F-04和其他A项未关闭。

当前结果（2026-09-30）：`indexed-pages` 原固定冷恢复完整 exit 0，原绑定/主体/new reader、13.01 秒恢复、B32.6ms、独立来源 26214425 bytes/SHA、closed/no-history 与两份 cleanup pass 成立，旧失败不改。52 个重连样本总 RSS 峰值 2531540992 bytes、Host heapUsed72881284 bytes，只是本次观察。journal/owner92/92/Host信用/reader20/20/Webview39/39/Hostbatch10/10/原协议/checkpoint/typecheck/build通过。F-04/A1及其他既定验收仍开放；下面“冷恢复仍未通过”描述的是修前事实。

同构建真实 Agent 复验也已完整 exit 0，证据 `.debug/a4-real-agent-20260930-indexed-pages/`，八项通过、四 natural 实际 eof、stop 不冒充自然结束、无 observer failure/强制清理信号；Host 145/145 和 Client 28/28 亦复验通过。这个有限结果不证明跨平台或所有 Agent 用法；尤其 stop 可以在真实 CLI 启动/认证界面发生，不表示完成了模型任务。

2026-09-30 冷恢复仍未通过。原十 Terminal 在线资源/交互成功不能抵消此次 30 秒只到 1404/2560 块；末轮绑定连续性和清理成立，后续交互/独立 hash/自然 no-history 未执行。当前交付是失败定位与 10.13 的有限修正设计，优化与实际结果须另记，F-04 和必要 A 项均保持开放。

2026-09-30 `.debug/a1-ten-session-20260930-probe-fixed/` 完整 exit 0，关闭本机固定十 Terminal 的声明资源/内容/交互有限项，不关闭整个 F-04/A1。color/size 最大输入响应 1365.5/1323ms，总 RSS 峰值 3801968640/3843158016 bytes，原运行前七项资源界限全部通过；独立 source SHA 与 v18 相同，lastRevision 6506/6497，清理通过且无强杀。1280 两例同 reader 隐藏恢复观察到追赶重叠，仍不是 Host 离线恢复。下一直接 10.11 固定 A1/A2 两次 Host launch，不重跑已完成十会话或把工具健壮性列为前置；下面结果保留各自历史时点。

2026-09-30 v18 在 `.debug/a1-capacity-calibration-20260930-v18/` 两例完整 exit 0。color/size 交互最大 879/928.1ms，source 分别 26214425/26214407 bytes 且 SHA 与独立 receipt 相同，validator 分别拒绝 color-state/serialized-state-too-large；两例 cleanup.pass=true。Host 144/144、Supervisor 90/90、协议/本地化/typecheck、分页完成、Host 信用、Client 28/28 和 reader wiring 20/20 已复验通过。该结果只闭合固定两会话校准，不代证十会话/正式预算/真实重连/跨平台；A4 生产路径回归另记，F-04 与总体退出完整性仍未交付。

2026-09-30 A1 v4 已进行一次实际 Electron 校准尝试，证据为 `.debug/a1-capacity-calibration-20260930-v4/`。color 的 `output-640` 首次交互在 `1500.2000000476837ms` 首败（nonce `color_640_0`、`applied:false`、块数 `0 -> 421`、目标 `640`），runner exit 1 且无自动重试；size、后续档位和隐藏恢复未运行。失败表示有限交互/输出应用观察界限未满足，不是 OOM 或正式预算失败。失败前保留 78 个 250ms 样本及零/一/二会话 idle 基线；本次只完成部分 calibration observation，正式容量预算仍未冻结。

实际候选构建与 Electron 运行已成立，Runtime/editor 有有限页面成功证据；snapshot-only 大快照自读修后，在 `.debug/execution-candidate-a2-a3-20260930-snapshot-normalization-fixed` 取得单选 complete/reopen exit 0，90002 行和最终状态/清理通过，旧失败不改。A4 前两轮认证、第三轮 superseded 和后七场景未跑属于历史首败，v18/source-eof 复验已在生产接入第 32.14 至 32.15 节单独记为八场景有限通过，不覆盖历史失败。F-04/A1 及共享两槽生产策略仍未完成，不能用页面内容对账替代分进程、多会话资源/交互预算，也不把旧 64/128 MiB 结果追改。
2026-09-30 的后续 B2 增量补齐 namespace 排他和显式 candidate Manager 新建路由，candidate bound 保留原连接且禁止替代启动。Linux namespace 7/7、启动参数 16/16、Client 28/28、Host 104/104、Supervisor 82/82 及 typecheck/build 通过，详见生产接入第 32.1 节；实际 socket/受控子进程不等于 PTY/Agent 或真实 systemd 服务。extension 默认、snapshot-only 显式工厂、旧 raw/stream 兼容和 R1 边界不变。没有新容量、实际 VS Code/Webview 或其他平台通过；F-04/A1/B2 总体继续开放。

2026-09-30 已完成预算解释和顺序同步，随后原退出计划完成 B2 profile/generation 启动参数链及受控验证，见生产接入第 32 节；没有新增容量通过证据。原合并进程结果/exit 1 仍保留，已完成的取消等待与消费成本修复不重开；F-04/A1 未完成，真实分进程、多会话资源/交互评估仍待生产候选。下一是 B2 安全首次启动和两模式入口，不以 profiler 为门槛，也不默认开启候选。两模式、真实 Agent/Webview/跨平台及 B3/最终 A1 至 A6 要求不变。

2026-09-29 的增量只改行上下文取消等待：完成/失败注销、dispose 唤醒、严格 flush 拒绝及原顺序保持，未加框架。结构先红/修后回归、Host 97/97、socket 信用、Host deactivation、分页 writer 27/27 与 Host batch 10/10、typecheck/build 均通过，独立 review 未发现直接缺陷。唯一实际链样本三档内容/终态/自然退出/清理通过，整体因 2x/4x 内存超限 exit 1；实际 Supervisor 序列化仍仅 4 次。B1 继续 active，剩余分配来源需测量，真实多会话/Agent/Webview/平台及 B2/B3/最终验收不削减。

新增严格 drain 并仅替换两处普通 owned consume，Supervisor journal 写入信用、final/attach/checkpoint/保存保持；Tracker、Supervisor 82/82、Host 97/97、原分页完成与 writer 27/27、Host batch 10/10、journal、checkpoint、socket信用、client 24/24、typecheck/build 通过。真实 Linux Terminal 两次各三档的内容/终态/自然退出/清理通过、每次仅一个主体；修后生产消费 3.260/1.495/2.986 秒，回放 1.092/2.263/4.655 秒，但仅 1x 内存达标，2x/4x 仍失败。该增量消除明确成本，不关闭 A1，也不替代真实 Agent/VS Code/Webview/平台验收。

已接通实际 Supervisor/Host 消费信用：协议显式协商，单订阅一页在途，journal 保留未消费后缀，Host 等待 line context drain；状态同样有界合并，终态不得越过正文。新增 `scripts/test/test-runtime-host-output-credit.mjs` 的真实本地 socket 对照通过，但不启动 PTY；旧业务先红、成功路径、compact 游标和 steady output 不额外产生 state 均有证据。Supervisor wiring 80/80、真实 Host 方法 10/10、原 headless writer 27/27、client 24/24 及相关回归通过。原 heap 失败仍开放。

新协商 Host/Webview 提示现也受接收信用约束；1000 次连续水位更新在暂停接收时只发 1 条，回执后合并到 revision 1000。Host 方法/实际 helper 回归、协议解析及浏览器 8/8 通过，最终应用原断言保持，独立 review 的重附着缺口已修并补测。旧 Host 方法的 1000 条先红和新测试夹具的前置错误分别保留。

先前完成 checkpoint 摘要、owned 日志信用、分页整段物化和新协商 Supervisor/Host 正文信用，F-04 仍未整体通过。首次校准失败保留在容量重评第 10.1 节；第 10.2 节同输入/预算对照 heap 为 70.72/84.50/103.72 MiB（仍失败），RSS 为 81.18/95.57/116.92 MiB（达标），本轮未重跑或追认。剩余直接工作限于生产源 owned 接入（B1 依赖原 B2）、旧订阅/旧页面兼容界限和真实消费链 heap/多会话交互验收；不转回退出工具、不为 stock 路径另造生命周期。B1 保持 active，B2（含 B3）和最终 A1 至 A6 不缩减。

## 上下文与定向

业务代码位于 `extensions/vscode/dev-session-canvas/src/`：`supervisor/terminalSessionJournal.ts` 管理缓存/写入/校验，`supervisor/runtimeSupervisorMain.ts` 管理事件串行及 socket 订阅，`panel/CanvasPanelManager.ts` 和 Webview 管理消费。原回归为 `scripts/test/test-terminal-session-journal.mjs`、`scripts/test/test-terminal-paged-projection.mjs`、`scripts/test/test-runtime-paged-completion.mjs`。容量入口为 `scripts/diagnostics/audit-runtime-persistence-capacity.mjs`；浏览器基准位于 `tests/playwright/webview-harness.spec.mjs` 的 `10-agent live output capacity benchmark`。

## 工作计划

10.15已按固定一次结果收口：原test提前B动作并严查同动作重叠，runner仅增加冻结判据摘要，fixture、产品代码、源负载和原清理边界保持。下一按生产接入第33节推进B2/A5的macOS共享Unix owner、Darwin原生provider、两authority工厂、namespace及匹配Node/Electron与packaged接入，仍由现有计划承接，不新建工具项目；新产品产物须保留A1关键容量/交互回归，不复跑本次成功输入增加计数，也不将总体容量和准入责任延期。

本计划只含三个可验证里程碑：真实调用链/预算及先红；直接产品修复与定向验证；相同负载容量和交互结果及总体缺口分账。它们不生成新的子阶段。checkpoint 先红直接禁止其校验构造全历史数组，原正确性回归须继续通过；socket/待写设计只沿已核对链路落实，不引入通用消息框架。

当前按 B1 对 B2 的依赖继续既有生产验收，不新增容量工具里程碑。显式准入、固定十 Terminal 和 10.11 真实重连已分别取得有限通过，后者实现/证据见 10.13/10.14。同一 2/1 新构建的真实 Agent 收尾八场景已通过，后续依有限收尾契约补未覆盖产品组合/平台/分发，不能将旧研究条目整批重开。第四轮 DeepSeek CI 的 Linux 真实 Agent 八场景有限通过，凭据已实证可用，不再是用户阻塞，也不上传本机登录；第三轮 Codex snapshot-only stop 间歇失败仍未定位，未复现不等于修复，macOS/Windows provider、build、namespace 工程和总体 F-04 仍开放。candidate bound 不重启、旧 live 原绑定、普通构建 stock 不变，未确认格子不得由局部成功代证。

## 具体步骤

本轮在仓库根完成原容量test顺序/readiness/严格重叠判定及runner一行判据摘要，独立只读复核无阻塞；随后仅执行一次 `node scripts/smoke/run-vscode-execution-candidate.mjs --capacity-reconnect --output=.debug/a1-host-reconnect-20261001-overlap`，完整exit0。同动作前后块号、B实际应用/耗时、不重置的完整追平期限及原identity/hash/no-history/cleanup已记录在新目录，不再把该命令列为待执行或自动重跑，旧目录保持。

最新步骤：显式 2/1 candidate 已重建，`node scripts/smoke/run-vscode-execution-candidate.mjs --capacity-reconnect --output=.debug/a1-host-reconnect-20260930-indexed-pages` 完整 exit 0；输入和dist/helper哈希留在 input.json，两次 launch 共用原 runtime。实际 journal、Supervisor、Host credit、reader、projection、protocol、checkpoint、typecheck 及 build 验证见容量设计 10.14。十 Terminal 与原四轮重连失败分别保留，不覆盖旧目录或重复成功矩阵；下面 v4 状态及其后命令属于历史时点，不重新排队。

当前步骤（2026-09-30）由退出 active 计划沿已接通 B2 候选完成原真实 Agent 与其他必要验收；32.10 snapshot-only 固定输入的真实 complete/reopen 已单选通过，不重复原页面失败或扩展接线。容量计划保留 A1 未完成：v4 已完成一次实际 Electron 校准尝试并在 color 首档首败，当前先保留首报/78 份样本和零/一/二会话基线，再处理候选共享两槽及正式分进程多会话判定；size、后续档位、隐藏恢复和正式预算仍未完成。此前 namespace/startup/profile 回归只证明各自范围，不代证默认启用、真实 systemd 或产品整链。当前不运行 profiler、不重跑合并容量样本、不改原 64/128 MiB 阈值。

以下命令与运行记录保留已经执行的 B1 工作，不作为当前自动执行队列。

命令均在仓库根执行。先扩原 journal 测试并运行 `node scripts/test/test-terminal-session-journal.mjs` 取得基线失败，实施后重跑。容量新路径沿原入口增加明确选择参数，随后用 `node --expose-gc scripts/diagnostics/audit-runtime-persistence-capacity.mjs --paged-capacity` 运行固定负载；GC 仅用于测量隔离，并分别记录实际峰值，不用回收后数字替代峰值。

相关验证为 `node scripts/test/test-terminal-paged-projection.mjs`、`node scripts/test/test-runtime-checkpoint-refresh.mjs`、`node scripts/test/test-runtime-paged-completion.mjs`、`npm run typecheck`。浏览器使用 `npm run build` 后执行 `node scripts/test/run-playwright-webview.mjs --grep "10-agent live output capacity benchmark"`，不为方便连带重跑默认 native 协议大套件。没有默认授权新平台 runner、用户会话操作或发布。

本轮传输回归执行 `node scripts/test/test-runtime-host-output-credit.mjs`；`--baseline-ref=d432bf89` 只读编译当时三个 transport 文件，旧代码应在暂停消费者的 raw 事件断言失败，不能用于追认新能力。并执行 `node scripts/test/test-runtime-supervisor-reader-client.mjs`、`node scripts/test/test-execution-terminal-line-context-tracker.mjs` 与 `node scripts/test/test-supervisor-execution-owner-wiring.mjs`。实际 socket 不等于实际 PTY，新增 Host AST 测试仍须注明受控持久化/通知替身。

本轮提示回归执行 `npm run test:terminal-available-credit`，同脚本的 `--baseline-ref=52ff49bc` 只读原 Host 方法取得洪泛先红。`npm run test:runtime-host-output-credit` 已串接新回归。浏览器使用 `npm run build` 后执行 `node scripts/test/run-playwright-webview.mjs --grep "availability receipts|terminal paged recovery handles|terminal consumes paged recovery through ANSI|lifecycle identity acks bootstrap"`，预期 8/8；另跑协议解析、原 paged projection、reader wiring、Host owner/deactivation 和 typecheck。该范围是产品通知改动所需回归，不扩容量工具。

本轮 drain 回归执行 `node scripts/test/test-serialized-terminal-state-tracker.mjs`、`node scripts/test/test-supervisor-execution-owner-wiring.mjs`、`node scripts/test/test-host-execution-owner-wiring.mjs`。固定实际链命令为 `node --expose-gc scripts/diagnostics/audit-owned-runtime-capacity.mjs --baseline-ref=f24a84f0 --output .debug/owned-runtime-capacity-baseline-first-20260928` 及不带 baseline-ref、output 为 `.debug/owned-runtime-capacity-current-first-20260928` 的 current 命令；这两次已经运行，不再以相同目录或重跑覆盖。运行前可用 `--preflight` 仅校验资产/加载实际入口，不启动 provider；native 要求精确 Linux x64/glibc、Node 25.6.0 及原已校验资产，`npm run build` 会删除 dist，资产需按原 `linux-execution-candidate-assets.mjs import` 恢复。其他平台不以此入口代验。

2026-09-29 执行 `node scripts/test/test-execution-terminal-line-context-tracker.mjs` 取得修改前先红与修改后绿色，其他回归见结果段。固定样本命令 `node --expose-gc scripts/diagnostics/audit-owned-runtime-capacity.mjs --output .debug/owned-runtime-capacity-cancellation-first-20260929` 已运行一次，exit 1 保留，不自动重试或覆盖。当时安排的下一 profiler 归因由 2026-09-30 决定取代；如后续为具体问题使用现成工具，仍先说明观测范围/开销，其内存数字不得替换这次无 profiler 结果。

## 验证与验收

10.15新增且仅新增一个组合判据：同一Webview动作记录 `0 < loadLastBlockBefore <= loadLastBlockAfter < 2560`，B真实响应在原1500ms内实际应用；随后原完整后缀在同一30秒总期限内追平，期限不因准备/交互重置。固定一次结果为A12到18、B51ms实际应用及13137.248ms追平，原两次Host/新reader及原执行身份、独立journal来源/hash、自然无历史与cleanup均成立。没有添加sleep/负载/会话或放宽断言；本机具名组合通过，不代证全部F-04、A3、跨平台或正式准入。

固定十 Terminal 已按 10.10 原预算通过，数值和边界归档 10.12；不得将其扩大为正式部署上限或全部 A1 完成。下一 10.11 固定离线重连要求旧 Host 身份消失、原 Supervisor/provider/主体身份及绑定不变、新 reader、离线写入来源与实际页面保留后缀一致，再验 B 响应、自然完成无历史和本方资源清理。30 秒追平、1500ms 交互、每例 10 分钟与总 RSS 5 GiB 实验保护按原设计保持；是否观察追赶重叠独立记录，不伪造或放宽尾部完整性。

保留原损坏、连续 revision、双代 fallback、读取/删除互斥断言。验证空间改进须有结构性无全量持有证据及固定增长负载，不只观察一次 RSS。校准/新旧基线/修后结果分别保存；输入、ACK、实际终端内容与公平性不能只看末尾 marker。不得把 no-PTY 实际模块测试当作实际 socket/Host/Webview 整链，也不得把浏览器 Agent 标签当真实 CLI。

A1 的正式资源/交互判定覆盖实际 Supervisor、Host、Webview、provider/主体与多会话总量；在运行前按所有权、共享/逐会话成本和固定负载登记预算、依据与失败含义。合并进程 64/128 MiB 仅保留为原样本观察信号，不替代这些预算，旧 exit 1 也不追认为通过。生产拓扑尚未接通或缺真实页面/Agent/平台证据的格子继续未验，不因本轮 B2 参数回归通过关闭 F-04。

## 幂等性与恢复

只用脚本创建的临时目录，不读取/迁移用户会话。旧文件格式、旧 live endpoint 和 checkpoint eligibility 不变。失败保留首报与可读来源，不删除原失败工件，不将重跑绿色覆盖首次失败；进程与文件只清理本轮明确拥有的资源。

## 证据与备注

输入 HEAD `8dd82629`，Linux x64 / Node v25.6.0。原始校准及入口失败位于 `.debug/runtime-persistence-capacity-20260928-wZfyUa/`，核心数值/输入/失败已记录在正式设计第 10.1 节。模块校准没有实际 socket/Host/UI/PTY；旧默认对照保持原样并通过，不能代证内存。owned、journal、checkpoint refresh、paged completion 与修正实例依赖后的 paged projection 回归、typecheck/build 通过；浏览器结果单独登记，不抹除原 harness 首次失败。

独立 review 的原始字节数漏洞以 `journal-review-red.log` 复现未拒绝，补 `segment.bytes` 比较后 `journal-review-green.log` 通过，最终 retained heap 为 100,216 bytes。该窄拒绝语义修正后没有重新采集容量以覆盖首次失败；失败仍是当前 B1 未闭合证据。`webview-10-agent.log` 记录原门槛 1/1 通过，纯浏览器注入场景不能代替真实 Agent、原生平台、packaged 或 Remote SSH 的最终 A1 至 A6。

本轮从 `4dc42c87` 开始，探针未改；结果在 `.debug/runtime-persistence-paged-scan-20260928-N6P27u/`，`paged-capacity.log` 的 exit 1 保留 heap 超限，`legacy-comparison.log` 为原兼容对照通过，`supervisor-wiring.log` 为 77/77。journal、paged projection/completion、checkpoint refresh、typecheck/build 通过，独立源码 review 无阻塞；未重跑不覆盖本次业务改动的浏览器注入基准，也不补造真实 Agent/跨平台通过。

只读核对发现探针 replay 每页完整序列化，而实际 Webview 页消费不做相同工作；颜色拒绝早于第三个候选模型创建，未找到保存全部历史快照的容器。差异尚未量化，heap 失败不撤销；不将先优化模拟消费者作为传输产品修正前置，归因沿实际产品入口完成。

本轮证据在 `.debug/runtime-host-output-credit-20260928/`：`socket-behavior-baseline.log` 是 96 条 raw 洪泛的旧业务失败；`socket-current-final.log` 与 `compact-steady-current.log` 是修后及独立 review 修正后的同范围 socket 结果，原日志不覆盖；`supervisor-wiring-final.log`、`host-projection-final.log` 和 `typecheck-final.log` 为最终共享树回归。新增 owned 夹具首次在收到 provider accepted 握手前就发 sourceEnd，adapter 正确以 continuous accepted tail 不符拒绝；原 `owned-immediate-exit.log` 保留。正式测试仅等待真实 provider 必需的 accepted 握手，不等 consumed 或 Host ACK，Terminal/Agent 均通过。没有把非法首轮顺序追认为正常退出通过。

本轮提示证据在 `.debug/runtime-terminal-available-credit-20260928/`：`host-notification-baseline-red-2.log` 为旧代码 1000 !== 1 的产品先红，第一份 baseline 是 git show buffer 不足的入口错误；`notification-final.log`、`transport-final.log`、`protocol-final.log` 和 `browser-final.log` 为修后回归，后者 8/8，注入 Host 消息的真实浏览器不代证实际 VS Code。reader wiring 20/20、Host owner 95/95、Host deactivation、原 headless writer 27/27 与 Host batch 10/10 通过。绕过 constructor 的原测试夹具补入真实 helper 实例后通过，首次缺字段报错保留；新增浏览器首轮两例因夹具未响应 checkpoint 初始 read 失败，修正输入顺序后复跑通过，不改原分页断言。`typecheck-final.log` 记录改变通用发送返回类型时的错误，随后保留原 void 包装并通过 `typecheck-wrapper.log`；这些不算新平台或产品尾部失败。build 与 diff 检查通过，没有新原生/真实 Agent/实际 VS Code/跨平台或 heap 通过。

## 接口与依赖

行上下文内部 `awaitOperationOrDisposal(operation: Promise<void>): Promise<void>` 为每个正在等待的操作注册独立取消责任，finally 释放；不改变公共 API，集合不保留完成历史，也不宣称任意并发下绝对常数。

`SerializedTerminalStateTracker.drain(): Promise<void>` 只承诺调用前已接受的解析工作及先前 operation 完成，不承诺新快照、完整 EOF 或页面应用；错误和 disposed 严格拒绝。最终/附着/修改/checkpoint 的旧 flush 语义保持。实际链脚本只记录流式 hash/计数和固定结果，不修改旧诊断设施或历史失败。

2026-09-28 的传输决策新增 `terminalHostOutputCreditV1` 能力、subscribe 的 `hostOutputCredit: journal-pages-v1` 及独立批次 ACK；旧模式语义不变。`RuntimeSupervisorClient` 只在原 socket 的异步 Host 消费完成后返信用。`ExecutionTerminalLineContextTracker.flush()` 严格等待既有操作并区分错误/取消；Host 身份失效不能记为成功消费。正常退役由未确认订阅游标保护 journal，但不把 Host 信用加入会互等的 owned reader completion。

本容量增量不新增依赖、运行模式、root 归属或用户配置。B2 使用此前已选定的隔离 `terminal-exit-v1` generation，不改变默认 `terminal-stream-v1` 或旧 live 绑定。journal 的公开完整读取/旧恢复保持兼容，正常 checkpoint 内部改为受限摘要验证。生产背压必须落实到原 owner/消费回执，不能添加无限队列来绕过限额。

修订记录（2026-09-28）：从有限收尾 B1 开始，固定调用链、负载和校准界限，先登记设计再实施；保留真实产品整链缺口，不恢复诊断框架扩张。

修订记录（2026-09-28，分页扫描）：沿已确认热点改实际 journal 分配，补原测试先红/短读/损坏回归；同探针原门槛一次对照仅 RSS 改善，heap 失败和较高回放成本继续登记，计划不关闭。

修订记录（2026-09-28，Host 信用）：同一 B1 直接修普通输出传输，不先重复优化模拟探针；冻结单页信用、独立订阅身份、line context 完成点和退役责任，保留实际整链验收。

修订记录（2026-09-28，页面提示信用）：补齐最后一段持续水位通知的有界责任与重附着/投递失败回归，明确 stock 源安全背压对原 B2 的依赖；保留当前 heap 失败和最终产品验收，不继续扩工具阶段。

最终复核补记：同身份重复 attach 不重置提示信用，`notification-reattach-final.log` 保留该简化后的回归；frame/执行替换仍隔离旧 receipt。`typecheck-closeout.log`、`build-closeout.log` 为最终共享树检查，上一轮中途返回类型失败及原绿色日志不覆盖。

修订记录（2026-09-28，解析消费）：实际路径先红后分离 drain/快照；证据在 `.debug/runtime-consumption-drain-20260928/`，旧缓存 live 断言首次失败保留。真实链两个 `owned-runtime-capacity-*-first-20260928` 目录保留首次 exit 1 与全部成功/失败事实，清理首报和本方资源分别核对。未新增当前页面浏览器、真实 Agent 或跨平台通过；生产启动的 profile/generation/冷启动链待 B2 接通，当前阶段先处理已测 B1 超限，不另开诊断编号。

修订记录（2026-09-29，取消等待）：修复直接无界登记并保留严格消费语义；红绿日志在 `.debug/runtime-line-context-cancellation-20260929/`，唯一实际链输入与结果在 `.debug/owned-runtime-capacity-cancellation-first-20260929/`。仍有 2x/4x 内存失败，下一仅针对实际分配来源取证；不继续盲目修热点、不加诊断框架、不覆盖前轮失败。

修订记录（2026-09-30，预算口径与 B2 顺序）：用户要求先纠正合并进程观察阈值与产品资源预算的混用，再推进 B2。新增具名当前决定并同步四个活章节、工作计划、具体步骤与 A1 验收，原数值/阈值/exit 1/历史证据保留；profiler 不再默认前置，F-04 仍未完成。当前 B2 只传递启动 profile 并校验隔离 generation，不默认启用或开放 Host cold-start；同 namespace 排他首次启动仍属随后的具体生产接入，不新增诊断阶段。

修订记录（2026-09-30，B2 安全首次启动）：同步显式 Manager 新建许可、bound 不重启、Linux namespace claim 与 candidate systemd 策略；extension 默认仍关闭，snapshot-only 不改。保留前一增量及全部容量历史，当前剩余指向扩展两模式入口、匹配资产和既定 A1 至 A6，不扩诊断阶段。

修订记录（2026-09-30，固定十 Terminal）：同步 probe-fixed 完整 exit 0、原预算全部通过、两次 probe 首败和同 reader 追赶重叠边界，保留 v18 与原合并失败。四个活章节及当前步骤转向既定 10.11 A1/A2 真实 Host 离线重连，不新设工具阶段、不改变尾部要求或宣布 F-04 完成。

修订记录（2026-09-30，冷恢复）：同步四次原始失败与末轮 1404/2560 内容进度，明确实际冷恢复是直接验收阻塞；选定单 reader/单段认证偏移索引窄修，拒绝跨消费等待保留读取保护。保留原校验、期限及其他验收，历史下一步不再自动重排。

修订记录（2026-09-30，冷恢复修后）：10.13实现/针对性回归和10.14原输入真实运行完成，当前入口、四活章节、工作计划和执行步骤同步。只解除具名固定冷恢复阻塞，原四次失败不改，不关闭全部F-04或削减真实Agent/跨平台验收。

修订记录（2026-10-01，离线恢复交互重叠输入）：新增设计10.15并同步当前入口/四活章节，只提前原B动作、固定同动作前后块号与原预算，保持color两主体/负载/身份/完整性/清理。新目录尚无结果，未重叠记未覆盖失败；不增加sleep、负载、ExecPlan或工具阶段，不重排历史。

修订记录（2026-10-01，离线恢复交互重叠结果）：10.15固定一次完整exit0，B51ms应用时A12到18，随后原30秒内完整恢复、身份/hash/no-history及两份cleanup通过；同步当前入口、四活章节、步骤和验收。旧10.14/旧失败保留，下一回到B2/A5跨平台产品接入，总体仍未完成，不追加成功矩阵或工具阶段。
