---
title: 原生失败路径与资源隔离验证
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 适配与基础设施层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity-native-candidates.md
updated_at: 2026-09-23
---

# 原生失败路径与资源隔离验证

## 1. 本阶段状态与完成边界

当前以本设计第22节（2026-09-23）为准：新隔离候选在真实TSFN取得后注入线程启动失败，由原driver独占非阻塞wait完成回收；新U1-0一次/U1-2三次4/4，采集及离线复核exit0。第20节原3通过/1失败/2未运行及exit13、第21节新4/4均保持，不合并通过率；本轮只取得Linux有限失败收尾证据，不代表其他U1/W1或生产验收。原生源码只在独立诊断副本调整，业务、已安装依赖、旧binary和workflow不改，无runner/push，不恢复通用工具前置。

早期设计背景（按当时状态保留，不覆盖第20节）：本设计承接 `docs/design-docs/runtime-execution-lifecycle-contract.md` 第16节。输入锚点为主运行时树f318579a、独立诊断树7fb4ae9e。G07新九控制仅补真实stdio关闭后的主体存活；旧三条not-established、D1/D2原结果、资源失败与所有工件不改。D3/D4 v1的7141cfa3两次failure保留；D3 v2已由b4db41cc/run35676427931完成三平台来源/顺序窄验证及完整归档复核，见第17节。D3完整契约、D4完整身份、native失败路径或生产拓扑仍未验证，下一步按第18节的新契约实施独立诊断版本，不重复旧矩阵或启动W1/U1。

目标是回答两件事：部分初始化/等待失败后，哪些资源仍由谁持有；一个资源结果无法确认时，如何不误报释放、不破坏其他会话，并限制继续积累。Terminal和Agent适用相同边界，实际Agent CLI的启动包装链另验；不新增普通后代托管、退出后历史、故障恢复、root归属改造或外部server承诺。

原设计阶段完成定义是：明确故障种类及注入性质、比较隔离候选、冻结工具观察与第一批创建/等待矩阵，独立复审并同步ExecPlan。当前已取得固定Linux工具及第20–22节局部原生证据，后续仅以所用链路直接影响判定或安全的问题为前置，不恢复通用工具统一阻塞链。除U1-4的通知返回替身及U1-5的释放回执扣留外，其余通知故障、环境销毁、取消、真正Close挂起及并发作为第二批必须闭合的问题；未写明可安全注入协议的案例不得开跑。生产接入仍受生命周期契约第9节门槛约束。

## 2. 固定源码依据

版本固定为锁文件中的node-pty1.2.0-beta.12及它自身的node-addon-api7.1.1，不能混用根目录的4.3.0。业务代码位置以主树输入锚点为准；独立诊断树不承载该业务重构。下列node_modules路径是只读来源，不是修改或分发位置。

| 固定来源 | SHA256 | 本轮核查锚点 |
| --- | --- | --- |
| `node_modules/node-pty/src/win/conpty.cc` | `d502cce570552c7a1bea373c7672975eeb330c3025dd151cf9c180ca2a1becc2` | CreateNamedPipeW:151；两pipe/create:217/222/227；CreateProcessW:412；Release:436；hShell登记:441；wait/query:101/103。 |
| `node_modules/node-pty/src/win/conpty.h` | `32b74fe493b4435bc2f8362cfa4bcb4f49a290438002cc4a369e9379c7728d3c` | Release有HRESULT，Close为void；HPCON不是普通CloseHandle对象。 |
| `node_modules/node-pty/src/unix/pty.cc` | `19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db` | spawn/fork:407/438；随后nonblock:414/487；直到500才SetupExitCallback；TSFN/thread:152/162；macOS kqueue/kevent:174/177/196；Linux waitpid:209。 |
| `node_modules/node-pty/node_modules/node-addon-api/napi-inl.h` | `4b053c184dfed740fbd802fdcf97e85fb8c7b0eb1d83322000d932d31662eda7` | CallInternal/CallJS:6093/6106；env与callback都空时6110返回，不调用包装的payload回调。 |

Windows旧诊断 `scripts/diagnostics/windows-hpcon-owner-patch.mjs` 的310/313/317把wait/query/GetProcessId组合判断，不能表示wait已经证明终止而退出码查询失败；572处Release仍早于712处hShell登记。Unix创建主体/master后到nonblock、waiter登记之间也可能失败。TSFN回调内部RAII不能单独证明环境销毁时的payload回收。这些是静态失败窗口，不是本轮已复现的生产泄漏或丢数据结论。

现业务 `extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts:35` 与 `src/supervisor/runtimeSupervisorMain.ts:1149` 仍依赖旧onExit；本设计不修改它们。旧自然路径fork、G07和guard-v2也不修改；新增故障注入只能在新目录的诊断副本实现，原始/生成源码与实际加载二进制分别留hash。

## 3. 故障证据必须分层

每项同时记录运行载体和注入性质，不能用一个synthetic布尔值掩盖“真实进程执行了合成故障”。

| 标签 | 可以证明 | 不能宣称 |
| --- | --- | --- |
| real-api / constrained-input | 真实API在受控输入/权限下返回实测错误；保留BOOL/HRESULT/errno及副作用。 | 合法完整权限、正常负载下也会自然发生同一错误。 |
| native-substitute | 在明确native调用点跳过调用并返回指定错误；检查真实owner的失败处理。 | 被跳过的系统调用实际失败或已产生其正常副作用。 |
| delivery-held | 真实API已返回，扣留其向上通知；原生审计与被测观察分别记录。 | API本体挂起、仍未释放，或扣留前主体仍存活。 |
| gate-held | 在明确调用前/受控shim中阻塞；记录realApiEntered=false。 | bundled Close或内核调用实际不返回。 |
| model | 有限状态、容量与身份策略的确定性检查。 | native资源释放、系统EOF、其他会话在真实阻塞下仍服务。 |

每项结果至少分开 `scenarioVerdict`（预定控制是否成立）、`process/source/consumer/resource` 原始事实和 `evidenceIntegrity`。故障注入命中不等于控制通过；错误码/owner/清理事实不符、自然对照失败、前提不足或证据缺失，分别保留failure/not-established/not-run。真正负控可以通过，但raw的unknown/interrupted/failed不改绿。延迟证据只能补同一操作，不覆盖首次观察或把历史不完整改成EOF。

## 4. Owner 台账与准入候选

owner是有明确取得来源的资源持有记录，不是PID、fd数值或HPCON地址。记录由创建者持有，至少包括run/execution/generation、failureDomainId、allocationId、resourceKind、取得证据、在途使用计数、唯一releaseOperationId、API是否进入/返回、原始错误和最后观察。失败域指共用地址空间/事件循环/全局锁的进程单元，不按root或页面推定。

“已知owner，释放结果unknown”与“仅看见陌生句柄，不知道owner”不同。前者保留单次操作与迟到补证；后者只能诊断观察，不取得关闭权。取得/使用状态、release-requested以及API进入/返回证据独立记录，不压成一个lifecycleFailed开关或单一线性枚举。只有确证仍持有、未进入释放且没有其他未确认操作才可retained；请求已发但进入回执丢失、已进入却无返回证明，或API明确失败但部分副作用/最终处置不明，均可为observation-unknown。后者同时保留api-returned与原始失败码，不能抹掉已知事实，也不能因未知进入状态重试Close。只有自身全部必需owner均有结算证明才汇总released，进程退出/OS自动回收另记 `container-exit-observed`，不伪造各API正常释放。

创建前预分配台账及不可失败的登记槽；每个成功返回的资源先登记，再做日志分配、Napi marshal、DLL查找或其他可能失败的操作。Windows覆盖pipe、HPCON、PROCESS_INFORMATION两句柄、受限view、attribute list及其初始化状态、持有的DLL引用、waiter/TSFN/payload；Unix覆盖master、实际child/reaper、thread/TSFN/payload及macOS kqueue。不能仅登记JS获得的最终对象。所谓不可失败槽仅指诊断已经预分配后的记账步骤；槽位分配失败时不得开始创建native资源。

本轮策略模型固定总槽位N=2、unknown熔断阈值Q=1，资源创建前原子预留；active、partial-create、release-in-flight及unknown都占槽。一个unknown阻止新建，不终止已准入的B；两个已准入者可同时变unknown，故Q不是未知数量的硬上限，总量由N约束。generation切换、断连重试或重新创建broker不得把旧槽清零。已知未取得任何资源的创建失败可归还槽；部分释放不能归还整槽。同操作迟到证明全部职责结算后，由明确的重新准入动作恢复，不自动重试Close。N/Q仅为诊断参数，不是已选定生产容量或整体输出内存上限。

取消/封禁不抹掉仍持有的成功read、独立消息和decoder内容。若无法安全移交这些内容，不得靠杀隔离单元宣称完整；记录故障、可用前缀及未结算责任。不得让在同一队列中等待的释放操作阻止该队列完成所需数据交付；锁内不进行可能阻塞的Close、wait、join或外部日志I/O。

## 5. 隔离候选与取舍

| 候选 | 本轮判断 |
| --- | --- |
| 同进程按owner封禁并停止新建 | 用于可响应的错误路径候选。能限制再积累、拒绝未知资源操作，不证明同步卡死或native崩溃时B仍可运行。 |
| 每会话worker线程 | 可以分离部分JS工作，但仍共享地址空间、native静态表/锁；terminate不等于中止系统调用或安全释放，不作为通用故障隔离证明。 |
| 创建前放入每会话独立进程单元 | 纳入后续故障对照的候选，阻塞/崩溃边界较清晰；增加IPC、启动、输出背压、分发和资源成本，必须原生验证。不是本阶段决定新建常驻server。 |
| unknown后迁移现有HPCON/fd/重启整个Supervisor | 不采用。事后不能无证明转移正在使用的资源，重启共享Supervisor会结束其他live会话；旧live绑定也不能静默迁移。 |

本轮W1/U1每个driver独立只是实验隔离，不能算已验证生产每会话拓扑。第二批必须实测A故障时B的新鲜交互、输出最终状态及自身释放；同进程候选在某类故障下不能满足时如实否决该能力，不用停止计时或排除B来求绿。当前没有选定生产线程/进程布局。

若已知测试driver无法在独立观察期内确认退出，只封禁本次失败域并停止新增driver；剩余schedule记blocked/not-run，validator仍遍历。不能通过不断启动新一代隔离进程把unknown转移成无限OS进程积累。只控制确切由本诊断创建并保留控制能力的进程；Unix仅对仍由本创建者独占wait权的未回收child发信号，回收后不按数字PID继续操作，Windows保留创建所得HANDLE。不按日志PID清理，不用runner销毁冒充释放。

## 6. D3：调用方返回与证据落盘分离（冻结；实现审计见第13节）

本轮新增 `scripts/diagnostics/diagnostic-observation-envelope-v1.mjs`、`scripts/diagnostics/diagnose-observation-envelope-v1.mjs`，不修改旧guard-v2。observer直接创建caller和writer并保留各自ChildProcess控制权。第一批caller只执行进程内注入操作，不创建后代或PTY；同步阻塞不会留下未登记子进程。

被测等待API只结算有界内存结果，不同步record到文件、不等待writer。caller在实际await续体先记录 `caller-after-await` 并发独立控制帧。仅把writeJSON移到resolve后仍不够：同一JS栈的同步I/O仍会阻止续体。observer按自己单调时钟记录收到该帧，证明事件至迟已经发生；不拼接父子绝对时钟。result-ready/pre-resolve/frame-send回调都不能代替真正await后接收事实。

操作观察、caller进程结算、证据封存分开：`observed-within-budget / observed-late / not-observed`，`natural-exit / forced-exit-observed / unconfirmed`，`sealed / failed / incomplete`。候选接口 `startObservedCase(spec)` 返回分别可等待的observation、processSettlement和evidenceSettlement；不是等三个都完成才resolve的单一Promise。每次观察为不可变快照，迟到事实另发，不改首次超时报表。等待API返回可以早于writer完成；sealed还需离线校验，不承诺断电持久性。observer等待期间不做文件I/O，writer负责写测试归档和manifest；writer失败不改变已证实的API返回，也不被隐藏为自然完整。

控制帧带run/case/generation/sequence/nonce，每帧最多4096编码字节；每项轨迹最多4096事件且最多1MiB。其内预留64事件及64KiB控制区用于一次overflow、after-await、caller进程和writer结算，bulk区先命中任一余量即停止详细源接纳并报告evidence-incomplete，不能让bulk耗尽抹掉返回/清理事实。控制区也超限时整项证据失败且停止来源，不扩容。有限夹具只使用受控帧，这不是通用IPC恶意大包安全防线，也不声称整个Node进程内存被1MiB限制。任何分片累积超过帧界立即拒绝，不能先无限Buffer.concat再检查。

固定预算：caller从被测调用前计时，1000ms工作截止、2000ms内观察真实await续体；observer从首次spawn前计时，2000ms内收到after-await才算外部及时证明，5000ms时处置仍在运行的直接caller，6000ms前结束caller进程最终观察。启动/握手计入observer预算，ready不能重置。受测writer在操作/进程观察已结算之后另启证据阶段，从发出封存请求前计时1000ms工作、总2000ms结算，达到工作截止只控制这个直接writer；操作阶段5000/6000ms不得截短writer的新窗口，writer也不能延长或改写操作报告。两阶段顺序执行最多6000+2000ms的诊断观察，不把它称为原操作的新宽限。截止/终止不等于写盘完成。迟到timer不加宽限，控制仍不能完成则unconfirmed，不靠无限等待close。

| ID | 每平台次数 | 输入及必须观察 |
| --- | --- | --- |
| D3-01 | 3 | 正常resolve，caller-after-await被observer收到，caller自然退出，writer封存且离线完整。 |
| D3-02 | 3 | 被等待操作永久pending；等待API按工作截止返回不完整观察，after-await可被接收，但操作raw仍timeout。 |
| D3-03 | 3 | result-ready后/resolve前注入同步阻塞；无after-await，observer按期控制caller，不能由ready判返回。 |
| D3-04 | 3 | after-await帧已由observer确认后才让caller同步阻塞；返回证据成立，进程结算明确非自然。 |
| D3-05 | 3 | await完成前切断专用after-await通道，caller内部结果不能补外部not-observed；另路诊断帧不冒充目标通道。 |
| D3-06 | 3 | writer在本轮独有目录预置同名文件，再以wx真实触发EEXIST；返回证明与归档失败分开。 |
| D3-07 | 3 | writer在受控shim中同步阻塞；不是实际磁盘挂起复现，归档不完整，由其直接owner有界处置。 |
| D3-08 | 3 | 合法after-await已被observer确认后才放行bulk小帧直到耗尽详细源预算；记录哪个先命中，保留prefix/overflow和已有返回证明，控制区继续记录进程/归档事实；受测轨迹仍incomplete。 |

三平台Node22.23.2各24项，共72个进程控制场景；native PTY为0，注入操作与真实caller/writer分别计数，不称72次原生资源验收。D3-03/04阻塞仅在本测试进程内且有独立observer，不能写成Close/磁盘真实挂起。D3-05不能靠未发送的标记伪装物理通道关闭，需真实关闭该独立通道的句柄并记录双方可观察状态。

有意失败的测试writer与最终验证工件发布者分开：observer保留受测writer的失败报告和轨迹，结束有界观察后交给无故障注入的独立归档路径保存。最终发布自身失败则整项evidence-incomplete/不通过，不能因预期writer失败而豁免工件要求。最终归档不在等待API返回承诺内，CI总timeout只作环境终止，不能充当已测返回。顶层observer仍依赖OS调度及控制API；存储永久挂起、观察者本身无法调度等环境不可能通过无限套watchdog获得绝对实时保证，须明确未建立/环境失败。

## 7. D4：未知状态准入策略（冻结）

本轮新增 `scripts/diagnostics/runtime-owner-quarantine-model-v1.mjs` 和 `scripts/diagnostics/diagnose-owner-quarantine-v1.mjs`。冻结协议为linux/darwin/win32各8项逻辑场景；实际v1 CLI在每个runner都执行全部24项，三runner合计72次有限模型执行，不是72个native进程，也不能替代A/B真实并发。原“各平台8项、共24项”的冻结计划数保留为逻辑schedule数，不冒充实际执行总数。模型输出操作计数与身份，完整独立重放及身份核验缺口见第13节。

| ID | 固定检查 |
| --- | --- |
| D4-01 | A/B并发预留后C拒绝，native-create请求数不超过2；创建失败前无资源才可归还。 |
| D4-02 | A结果unknown后Q熔断，B继续自己的数据/结算，C仍拒绝；封禁不改为released。 |
| D4-03 | A/B都unknown时占槽为2，Q=1不谎报只有一个；新建拒绝。 |
| D4-04 | A同operation迟到全部释放后归还其槽；B仍占槽且没有unknown时，显式重新准入才允许C。 |
| D4-05 | 重复释放共享同一请求结果，冲突参数拒绝；模拟Close dispatch计数不增，不计作真实API证据。 |
| D4-06 | 旧generation回执/跨execution序号不得释放新owner或污染B。 |
| D4-07 | 更新generation/重连/重试不清除未确认的旧占槽，不自动复制owner。 |
| D4-08 | 只释放pipe而waiter/HPCON等未确认，整体仍unknown且槽不回收；陌生token不能得到操作权。 |

## 8. W1：Windows 创建与等待第一批（冻结）

Node22.23.2、Windows x64，MSVC/SDK版本随实际runner记录；固定同一新诊断fork和同版bundled DLL。自然对照与故障组共享同一二进制，只改变显式failpoint/输入，保留旧stock实验不重跑。新fork必须先解决第4节登记和分事实表达，不能用原lifecycleFailed总开关作为回收方案。

| ID | 注入性质 | 输入、前提与判据 |
| --- | --- | --- |
| W1-0 | real-api | 同fork无故障自然exit7，精确内容/终态/EOF和全部已知owner单次释放正控。 |
| W1-1 | real-api / constrained-input | 独立fixture owner预占本轮随机-out命名pipe，FIRST_PIPE_INSTANCE使第二CreateNamedPipeW实测失败；首hIn已成功并须结算，预占pipe单列owner；未创建执行主体。 |
| W1-2 | real-api / constrained-input | 两pipe已取得后向ConptyCreate传零尺寸，要求实际HRESULT失败并结算已取得资源；若该DLL接受输入，记前提不成立且按实际取得owner清理，不换参数求绿。 |
| W1-3 | real-api / constrained-input | 已有HPCON，使用本轮确认不存在的cwd令CreateProcessW实测失败；不能因为没有foreground fixture便忽略HPCON及pipe责任。 |
| W1-4 | native-substitute | CreateProcessW真实成功立即登记provisional hProcess/hThread，然后在connect侧第二次LoadConptyDll调用前注入后续错误；不执行该次Load或其后Release。启动失败与仍存在主体分账，不按日志PID补救，不称CreateProcess/Load/Release真实失败。 |
| W1-5 | real-api / constrained-input | 从owned hProcess以DuplicateHandle取得缺SYNCHRONIZE但可查询的受限view，实际Wait失败；原完整handle保留给唯一安全reaper，初次unconfirmed与后续wait证明分开。 |
| W1-6 | real-api / constrained-input | SYNCHRONIZE-only view实际wait成功，退出码查询实测权限失败；结果为terminated而非unconfirmed/exit0。view与原handle分别单次关闭，GetProcessId失败不抹掉wait事实。 |
| W1-7 | real-api | 实际主体ExitProcess(259)，成功wait后保留exited259，不按STILL_ACTIVE常量误报仍活。 |

每项连续3次，共24个driver尝试。W1-1/2/3是否进入create、返回的资源和实际主体数量逐条统计；不能把24尝试叫24条成功PTY，也不根据未创建foreground fixture推断库内部没有helper。受限view仅限自己创建的句柄，不借权限降级控制宣称正常完整handle会自然失败。每项API实际返回偏离预期即failure/not-established；错误码缺证、仅JS抛错不满足real-api。

主体夹具无工具后代，使用单独私有控制通道和自限寿命；写入、退出许可及退出结果独立记录。包含实际Close的路径依然先满足已知使用结束/数据移交门槛；W1没有证明真实Release失败后可以Close，也没有覆盖builtin。候选失败如果只能靠终止整个driver收口，只记录该进程退出及未确认owner，资源正确性仍不通过。

W1-4的创建阶段须预先登记持有的DLL引用以及真实Release/Close函数指针，并保证引用活到资源结算结束；故障注入不卸载它们。失败收口由唯一owner记录合作退出请求、真正首次Release调用/实际HRESULT、主体wait、源及已拥有内容结算，再按安全前提调用真正Close；不预设Release与主体退出谁先到，不把首次清理调用说成重试失败的原生Release。若函数指针/主体控制/数据门槛不能成立，保留failed/not-established和未确认资源，不能由driver退出升级资源通过。

## 9. U1：Unix 创建与等待第一批（冻结）

Linux/macOS固定Node22.23.2和同源新fork，必须使用原位观察，不启动继承master的readiness helper、不静默修改共享O_NONBLOCK；只读F_GETFL/fstat前后核验。Linux的EIO和macOS的read0按已验证平台语义分别记录，不由poll可读推断EOF。新fork保留平台真实启动链，不将macOS posix_spawn假写成Linux forkpty。

| ID | 平台/注入性质 | 输入、前提与判据 |
| --- | --- | --- |
| U1-0 | 两平台 / real-api | 同fork无故障自然exit7，精确内容/终态/源结束、唯一waiter及全部owner单次释放。 |
| U1-1 | 两平台 / native-substitute | 主体/master真实创建后，在pty_nonblock调用前跳过并返回合成失败；两owner已登记，仍需合法reap/源处置；不是fcntl实际失败。 |
| U1-2 | 两平台 / native-substitute | TSFN真实创建后、实际wait线程启动前注入线程启动失败；明确thread是否joinable，未启动thread不能join；payload/TSFN/child独立结算。 |
| U1-3 | 两平台 / native-substitute | 跳过一次真实waitpid调用、返回-1/ECHILD；初次unconfirmed，不解释未初始化status、不exit0；后续唯一reaper取得真实结果，不能两个线程抢wait。 |
| U1-4 | 两平台 / native-substitute | wait真实成功后跳过BlockingCall并返回napi_closing；payload仍由native持有且单次释放，通知未交付不抹掉native终止事实；不称实际环境销毁。 |
| U1-5 | 两平台 / delivery-held | 内容/真实wait/在途读取均结算后，实际close自身master一次并成功，但扣留上层释放回执；按下述独立资源观察截止取得unknown，native审计returned分账，之后同operation迟到补证，不再次close。 |
| U1-6 | macOS / native-substitute | kqueue实际取得后，跳过kevent注册并返回合成EIO；kq单次关闭、主体由唯一reaper结算，不把合成值说成系统注册失败。 |
| U1-7 | macOS / native-substitute | 注册成功后跳过kevent阻塞等待并返回合成EIO；不能解释无效wait status，kq只有无在途使用后才关闭，真实进程结果由唯一reaper补证。 |

Linux执行U1-0至5各3次，共18尝试；macOS执行U1-0至7各3次，共24尝试，与W1合计66个driver尝试。平台不适用项不伪造样本；wait调用点由独占reaper状态机串行推进，不注入给陌生PID。U1-5是释放已返回后的观测延迟，不是close真实失败/挂起；槽位只按被测观察规则迟到回收，audit不得替被测路径提前补证。

U1-5单列资源观察预算：observer在发出本次release许可前按自身时钟记R0；caller收到许可后，在发送唯一release请求前按自身时钟记r0。被测资源观察于caller的r0+100ms截止，之前缺回执为pending，到截止首次报告observation-unknown。独立audit回执也在caller记接收时间，须在caller的r0+100ms前证明真实close已成功返回；若未建立该前提，本项not-established，不把慢close与通知扣留混用，audit不能代替被测通知。caller记录首次unknown并核验距r0不超过1000ms，observer另按自身R0核验1000ms内收到该报告，两者时钟不拼接。再从observer收到unknown的本地时刻至少持有100ms后才发放回执许可；计时器触发要复查单调截止。随后同operation补证released，但原unknown报告与观测延迟保留。这些100/1000ms仅为本子项诊断值，不是生产资源期限。

## 10. W1/U1 共用输入、预算与工件（冻结）

每项全新32位小写hex fixture身份RUN，schedule先落盘。成功启动且进入写入阶段的主体固定80列24行，consumer使用同锁文件的headless终端、scrollback1000；写入流为 `ESC[2J ESC[H`（两控制序列之间无空格）、RUN重复64次形成2048个ASCII字节、再写 `\r\nTAIL:<RUN>\r\nESC[5;7H`，其中ESC是0x1b、RUN替换为该身份。前景fixture不向同一终端写诊断日志，最终光标为零基x6/y4。原字节hash和完整期望终端状态在运行前生成。Unix明确ONLCR变换，Windows由终端语义核对；自然/等待组要求consumer解析完成及最终状态，partial-create未进入正常输出的项不虚构完整尾部。夹具成功写入凭证与candidate/audit内容分账，禁止减负载来掩盖失败。这是新故障控制负载，不替换旧90000行完整性/压力门槛。

每项observer t0位于创建case caller前；caller操作t0位于创建native driver前，30s工作截止、总32s内caller观察到操作结果，observer须在自身35s内收到after-await，35s开始处置caller、36s结束操作/进程最终观察。控制权链为observer→caller→native driver：caller不加载被测native，只控制自己创建的driver；observer只控制其直接caller，不按日志PID接管driver。caller先失联时driver/failureDomain保留unknown并停止新增样本，除非另冻创建前控制权转交协议。driver的执行主体自限20s，自限命中仍是fixture失败，不能变自然成功；该时限不证明driver、helper或所有owner都释放。受测writer在操作/进程观察结算后另启阶段，按D3请求起1s工作/总2s结算，由observer只控制这个直接writer；35/36s操作截止不终止尚在独立窗口内的writer，writer不反向扩大操作预算。两阶段最多36+2s观察，最终发布单列环境状态。这些是新故障诊断预算，不改变旧实验或选定生产退出时间。

所有创建/操作有调用前后事件与真实返回/errno，native单调时钟只排序自身事件，observer另记接收时间。至少记录resource台账、加载binary/helper/DLL/compiler/header指纹、fork原始/生成源码、输入commit/runner/OS、config、原输出及状态、故障命中、caller-after-await/observer-received、进程exit/stdio结束和首次/迟到报告。不同通道通知不强制全序，不用日志PID提供操作权限。OS资源快照是背景/逐会话增量的辅助，正常已退出Process引用存续不是失败门槛。

W1/U1自身的释放错误仍是raw失败，即使成功观察这种失败；验收不得仅看scenarioVerdict。基线正确性、故障点到达、已有资源登记、数据已拥有部分不丢、在途操作不被提前销毁、无跨owner操作和无无限新增各自判定。连续3次用于预定重复，不重跑筛绿；首个失败不阻断其余已确认可安全隔离案例，无法确认旧driver退出则剩余记not-run，不能为凑满66而继续堆积。

## 11. 第二批必须补齐但尚未冻结的边界

本表是生产接入阻塞清单，不是已经有安全注入实现或通过记录。不得将W1/U1结束写成原生失败路径全部完成。

| 类别 | 下一批要求 |
| --- | --- |
| TSFN/线程与环境销毁 | 分开New/Release失败、排队拒绝、接受后通知丢失、callback抛错、env销毁及queued payload；native ledger在env消失后仍可外部取证，空env disposer必须有源码依据。maxQueueSize0不声称覆盖真实queue_full。 |
| 原生Release/Close | 缺导出替身、跳过Release返回E_FAIL、Close前gate、真实Close后扣留通知、shim同步阻塞分别命名；不能假定失败HRESULT后继续Close安全，void Close不造返回码。真正API内不返回尚无安全可复现控制。 |
| 取消与已拥有内容 | Unix区分已提交read/回调held；Windows必须实际readableLength>0或独立buffer及未消费worker消息，EOF赢竞态另验。destroy/terminate不证明CancelIoEx或在途read已结算。audit读到的系统残留不计candidate已交付。 |
| waiter/control资源 | macOS kevent仍在途时请求释放，Close次数应0；许可主体退出、wait/thread结算后才能关kq。Linux没有kqueue，不凑同名fd对照。 |
| 双会话及阻塞故障域 | N=2/Q=1下A unknown而B持续fresh往返/完整尾部/正常释放，C拒绝；A/B同时unknown不超总slot。分别比较同进程可响应错误与创建前独立进程的shim阻塞，不用有限模型替代。 |
| 支持面与生产接入 | builtin/其他Windows版本、实际Agent启动链、VS Code/Electron、Host/Webview/packaged、容量/背压/启动成本和生产停止预算另验；旧live保持原绑定。 |

本轮不决定这些场景的次数/期限或危险系统故障触发方式。第一批结果用于收敛第二批可实施协议；需要改候选拓扑/安全前提时先追加新冻结版本，而非修改已运行的旧矩阵。同进程方案若无可证安全失败路径，不得仅靠长期retained继续上线；独立进程方案也不能跳过已接收内容和完整退出要求。

## 12. 实施顺序与验证入口

本节以下保留第12阶段及更早的实施顺序，不再将“完整工具验收”作为统一前置；当前状态和剩余实际阻塞以诊断结算契约第18节为准。

当前第一步按 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节补齐新诊断的本地实现、冻结覆盖与独立审查；D4模型已有本地16项证据，D3真实主控36/gate2/publisher4仍未执行，三平台采集另行确认。旧v1/v2/D4结果见第13–17节且不重跑改判。主运行时仅同步文档，W1/U1仍等待新诊断完整验收；下段原生实施为后续门槛，不是当前开始指令。

第二步在D3/D4完整首次结果收口后，新增 `native-failure-owner-v1.mjs`（台账/调度协议）、`windows-native-failure-patch-v1.mjs`、`unix-native-failure-patch-v1.mjs`、`diagnose-native-failure-v1.mjs`，统一放 `scripts/diagnostics/`；它们只生成隔离fork，不import进业务、不改node_modules。原生workflow单独新增 `.github/workflows/runtime-native-failure-v1.yml`，按平台schedule执行W1/U1并始终上传完整工件。构建参数、机械补丁匹配计数及实际链接输入须实现前复审，编译失败记零实际运行、全部not-run，不能伪造66 native成功。

validator从完整schedule独立复算时序/身份/前提/计数/结果，不只读pass。必备负例包括删调用/回执、把held通知改成API失败、已成功wait却标仍活、重复关闭/错generation、部分释放就归还槽、原始EOF被改为取消或反向改写、伪造after-await、超预算或改t0、writer失败改sealed、缺binary/首项损坏后继续末项。源快照与输入commit逐项对账，Windows CRLF原字节保存、只读LF归一比对，不执行归档代码。

设计冻结时只做源码/版本指纹、矩阵计数、文档元数据/引用/历史不变及独立方案复审；既有bridge/tracker/Supervisor测试仅作为回归，不计新D3/D4/W1/U1通过。后续工具证据按第13–15节分版本追加，记录实际OS、输入commit、run/attempt、全部工件和未执行项。工具场景通过不关闭尚未实现的契约，本文validation_status仍未验证，总体退出完整性计划继续active。

## 13. D3/D4 v1 本地实施结果与契约缺口（历史阶段，2026-09-22）

独立诊断树已新增四个Node标准库入口和 foundation workflow。本地完整结果保存在 `.debug/runtime-native-failure-foundation-v2-d3/` 与 `.debug/runtime-native-failure-foundation-v2-d4/`：D3为24/24 verified，D4按linux/darwin/win32各8项共24/24 control-pass；D3自测和D4自测通过，D3正例目录与篡改负例目录已分离，`nativeProcesses=0` 仅作为D4模型/自测及范围事实记录。D3完整schedule是Node caller/writer进程控制，不含PTY或native API；D4是有限状态模型，不能替代跨平台runner或生产隔离。

workflow已固定Node22.23.2、三平台矩阵，并配置上传D3/D4完整schedule及self-test目录；本节记录本地阶段，后续runner结果见第14节。上述目录名称中的v2是v1工具的第二版本地工件目录，不是第15节新增的D3 v2入口。W1/U1尚未实施，`decision_status: 比较中`、`validation_status: 未验证`不变。Windows已退出进程仍被其他已知句柄引用按正常对象语义保留，不形成新增系统缺陷结论。

实现审计发现D3仍未导出冻结的 `startObservedCase(spec)`。`observeCaller()`只有child `close`后的单一Promise，`runCase()`串行等待caller后才启动writer；无法分别等待observation、processSettlement和evidenceSettlement，也未冻结首次deadline快照或由caller发送完整身份帧。强制处置请求、实际退出与stdio close尚未完全分层，`evidenceIntegrity`仍由CLI编排无条件写成sealed。D4虽有跨generation保账场景，但部分事件和validator未完整核对execution/generation identity，不能把当前重放称为完整代际oracle。当前24/24只证明有限trace/manifest可重放，不能关闭三独立settlement、迟到观察、有界unconfirmed或完整owner身份债务。

以上是v1本地阶段发现；当前增量只承接第15节的来源/顺序窄修正，其他诊断语义与W1/U1仍开放。不修改旧工件、历史失败或业务运行时代码，也不把本地有限结果写成native/产品验收。

## 14. v1 首次 runner 与重复触发记录（2026-09-22）

输入7141cfa3的首次foundation run `35673511893` attempt1为failure：Linux/macOS的D3各24/24，D4在每runner执行三平台逻辑各8项共24/24，三runner共72次模型执行；Windows D3 `D3-01-1`失败。原始trace中stdout的operation-returned与fd3的caller-after-await跨pipe到达顺序反转，v1按observer收到次序重包sequence并判因果，形成误判。这是诊断协议/oracle缺陷，不是Windows或产品缺陷，也不证明其他平台没有相同风险。D4工件显式记录native:false/nativeProcesses:0，没有pty:false字段；零PTY由模型入口及范围限定说明，不能补造工件字段。

首次三工件10672290231、10671559820、10672340270保存在独立诊断工作树 `.debug/github-foundation-35673511893-{ubuntu,macos,windows}/`，不是主运行时树。相同SHA误触的重复run `35673550930`也为failure，另列为重复执行而非修正后的验证；两次失败、原始断言与工件均冻结，不重跑v1筛绿。完整下载/独立审计以本树 `.debug/foundation-first-two-audit/` 为证据入口。D3完整契约与D4重放/身份阻塞项均不因局部绿色改变。

两次完整D3均Linux/macOS各24/24、Windows23/24，仅D3-01-1误序，共144项中原verifier接受142项。D4每runner24项，两run共144次模型按原verifier通过。Windows缩放self-test positive首次23/24、重复21/24；重复新增D3-07-1/08-1 after-await接收504.2253/543.014ms，超原500ms预算，是独立真实迟到，不归为顺序误判。重复自测writer结算另有554.9569/630.9223/608.3949ms超500ms，原verifier未全部核验，保留原分类并登记预算债务。两次Windows自测positive失败后未生成最终报告或tampered负例，已有轨迹/日志完整保留。

六ZIP共3,853,782字节/3022成员，API size/digest及本地完整摘要一致；36份runner输入与7141cfa3对账，Windows仅CRLF差异。验证入口仅来自可信Git字节，没有执行归档代码。本树审计summary SHA256为 `eb5d8e91ffe23ffa03ff43384d1d52c46ab0798a05a0adc644084a2a7d9081d5`，audit SHA256为 `b1de5345391c816f11a47b4143afa65b5da8d826463f76d5883f559f59b1d5c1`。重复run在首轮最后job完成前触发，不是看到失败后筛绿；仍作为独立重复事实留证，不混入修正后结果。

## 15. D3 v2 来源与顺序 oracle 窄修正（运行前协议，2026-09-22）

新增 `scripts/diagnostics/diagnostic-observation-envelope-v2.mjs`、`scripts/diagnostics/diagnose-observation-envelope-v2.mjs` 与 `scripts/diagnostics/observation-envelope-v2-oracle-test.mjs`；v1两文件、原foundation workflow和7141cfa3工件冻结。v2保留D3八场景各三次、每runner24项及原预算，不实现三独立settlement接口，不改变业务或native资源处置；W1/U1仍未开始。

caller在发送时为所有源帧分配一个全局严格递增sequence，并携带schema、run、case、generation、nonce及事件类型。observer不能补造这些身份或按到达次序重编号，只记录实际读取通道stdout/stderr/fd3和自身接收时间。caller-after-await只允许来自fd3；同一pipe上的source sequence必须递增，跨pipe接收允许任意顺序，生命周期因果按已验证的发送端sequence检查。observer接收时间必须是有限且非负的数值，只有该真实接收时间在冻结预算内才可判timely；源sequence不能代替接收时间或把迟到帧改成及时。

4096字节上限覆盖完整编码帧，解析器在拼接任何分片前检查有界余量，超长帧、残缺帧、非法JSON、错误身份/nonce、错误通道、重复/回退sequence及非法接收时间均形成协议失败，不能静默忽略后继续报告控制通过。按发送端序列复核时，除D3-08已明确记录的bulk溢出区段外，不允许连续源序缺口；控制事实不享受bulk缺口豁免。bulk首次overflow后锁定拒绝后续bulk，不能因后续帧尺寸较短再次接纳而制造零散缺口。D3-08必须先由observer接收合法fd3 after-await并发送ACK，caller等待精确匹配ACK后才发送bulk；保存observer的fd3接收、fd4 ACK发送和首bulk事件，以源代码的await控制流限定caller接收前提，不冒称有独立caller ACK接收事件。仅caller调用write不能证明observer确认。

本轮至少验证跨pipe任意到达仍按源序接受，以及stdout冒充after-await、同pipe逆序、缺/重复序号、错身份/nonce、负数/非有限接收时间、完整帧或分片超4096、非法/残缺输入、D3-08 ACK前bulk与伪造bulk缺口的拒绝。合法但超预算的接收须保留observed-late，不能判timely；它不是非法协议帧，只有对应scenario要求及时才判控制失败。完整schedule和首项损坏后继续遍历仍必需。新输入和结果另存新目录，不执行归档代码，不用v2追认两个v1失败。实测追加第16节；D3三独立Promise、deadline不可变首次快照、bounded unconfirmed、独立evidence settlement以及D4完整独立重放/身份oracle均未闭合，状态继续比较中/未验证。

新workflow `.github/workflows/runtime-observation-envelope-v2.yml` 只运行固定Node22.23.2的三平台D3 v2，不重复D4有限模型；依次执行语法检查、确定性oracle/parser、自测、完整24项及verify-saved，失败也上传完整工件/输入。缩放自测保持v1的0.25及500ms接收/结算预算，不通过扩大预算掩盖重复Windows迟到；完整schedule保持冻结的未缩放预算。

## 16. D3 v2 本地实测（2026-09-22）

本地Linux Node22.23.2的新目录 `.debug/observation-envelope-v2-local-1-selftest/` 已完成oracle78/78、parser8/8、positive24/24及篡改拒绝；`.debug/observation-envelope-v2-local-1-full/` 完成未缩放24/24 verified，三文件语法检查通过，完整源hash与快照已封存。输入为当前未提交v2工作树，不假称已绑定新commit；GitHub三平台v2 runner仍待新提交的一次自动触发及全量下载复核。以上只涉及第15节窄协议，三settlement等剩余债务和W1/U1状态不变。

local-1独立复核随后发现篡改负例覆盖不足：根manifest校验提前抛错，导致run.scale未读取，后续案例均因缺少scale失败，实际attempted24/verified0。自测只检查总失败和坏首项，未证明其余23项仍被有效验证。原positive24/24与未缩放full24/24不受此问题影响，旧工件及原报告保留；不能把“篡改被拒绝”扩写为“坏首项后其余23项已有效复核”。

修正协议是在同一v2入口分别收集根manifest错误和读取/校验run元数据，完整遍历不得依赖根manifest先通过；新篡改自测同时要求attempted24、verified23、坏首项被拒绝及末项没有错误，并归档 `tampered-verification.json`。新 `.debug/observation-envelope-v2-local-2-selftest/` 已通过oracle78/78、parser8/8、positive24/24，篡改报告为attempted24/verified23、仅shared-manifest与D3-01-1错误；`.debug/observation-envelope-v2-local-2-full/` 未缩放24/24 verified且无evidenceErrors，最终CLI语法和diff检查通过。两个新目录保留完整输入hash，仍是未提交工作树证据，v2三平台runner待验，不改local-1。另记录完整writer协议债务：非法writer帧可能被其他sealed事实掩盖，当前来源/顺序窄修正不证明writer消息协议正确，须在独立evidence/settlement阶段统一设计、核验。

独立本地审计保存在 `.debug/observation-envelope-v2-independent-local-review/audit.json`：三源码与两组快照一致，重放oracle78/parser8/positive24/full24及篡改24/23；六个D3-08均在ACK后bulk，retained源序从5连续，省略仅是尾部bulk至4300，finish4301保留。before-fix-regression.json按原hash绑定复现local-1缺口，没有修改旧工件。本次独立复核不新增原生样本或跨平台结论。

## 17. D3 v2 首次三平台结果与独立复核（2026-09-22）

固定提交 `b4db41cc3219c009d6ec00f1bf4b50113d8350cd` 经一次push自动触发 `35676427931` attempt1，三job均success，没有手动dispatch或rerun。Node均22.23.2，Ubuntu24 x64/kernel6.17.0-1022-azure、macOS26 arm64/Darwin25.6.0、Windows Server2025 x64/10.0.26100。每平台完整24/24、原0.25缩放positive24/24、oracle78/78、parser8/8；篡改目录各attempted24/verified23，仅shared-manifest和坏首项D3-01-1报错，其余案例仍有效验证。故障负例正确拒绝不等于损坏工件通过。

Windows完整D3-01-1实际出现stdout/fd3接收倒序，caller源sequence/sentNs合法，v2按独立源序正确接受；不是靠此次未遇乱序获得绿色。确定性重放仍拒绝错误来源/身份/同pipe逆序及控制缺口，合法迟到保留observed-late。完整与缩放的D3-08均核对ACK后bulk、唯一连续尾部省略及最终控制帧保留。

原始trace补充核查的最大接收/结算时间如下；这不是对未实现的独立Promise或强制预算oracle的替代证明。

| 平台 | 完整after-await / writer最大ms（各2000ms预算） | 缩放after-await / writer最大ms（各500ms预算） |
| --- | --- | --- |
| Windows | 1075.2648 / 1010.1685 | 330.1647 / 265.695 |
| Linux | 1040.977367 / 1005.608616 | 296.077696 / 255.168326 |
| macOS | 1056.778959 / 1012.396875 | 292.366375 / 254.102916 |

三ZIP各453文件，artifact为Windows10674000078、Linux10673655385、macOS10673171771，大小/SHA256与GitHub API一致。15份输入与固定Git核对：Linux/macOS十份逐字一致，Windows五份仅CRLF差异；保存原字节，执行的是可信固定Git源码而非归档代码。完整证据在本独立诊断树 `.debug/observation-envelope-v2-run-35676427931/`，`acquisition.json` 保存API/ZIP清单，`metrics.json` 保存时序，`audit.json` SHA256为 `a772fa2a399c9b51fe109b56fff097933e9873fa0c424aab93f18717c13233f7`。

本次共72个完整控制、72个缩放正例、234个oracle与24个parser检查，篡改复核72项中69项有效、三坏首项预期拒绝；native PTY、D4、W1/U1均零新增。原v1两个failure、真实迟到和local-1篡改覆盖缺口不追认；正常Windows对象引用语义不改。D3三独立settlement、首次deadline快照、SIGKILL后有界unconfirmed、writer预算/非法帧/独立封存及D4完整身份重放仍开放，本文继续比较中/未验证。下一阶段先为这些诊断契约缺口冻结新入口与验收，再决定W1/U1实施，业务、依赖、旧live绑定及生产预算不改。

## 18. 完整诊断结算与身份重放设计承接（2026-09-22）

新设计 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 以诊断树e1a31b79、运行时树a5f8d629为输入，冻结D3 v3与D4 v2的下一版契约，状态比较中/未验证。本阶段仅源码、协议与设计复审，零新增测试、零新增native运行；旧D3 v1/v2、D4 v1、workflow、工件和历史失败全部不改。三侧静态复审、跨文档及历史保持检查已通过；只收口设计，不代表实现或新矩阵通过。

D3 v3同步返回handle，observation、processSettlement、evidenceSettlement各自首次结算；绝对deadline先于等时/迟到事件，首报不可变，迟到事实追加。exit与捕获真实EOF分开，capture gate保留尾部；直接owner有界控制、未确认责任继续占账，不能以kill/close当释放。D3每case最多预留caller/evidence/publisher三个槽，任一hard截止仍unknown即停止后续case；这不是D4模型的N2容量。writer、独立verifier与最终publisher分责，协议错误不可被合法claim清除，受测证据结算、发布与可信离线归档验证分别判断；这些是诊断候选，不是生产进程布局或退出时间政策。

D4 v2固定N2/Q1，完整command/return/event/snapshot由不共用SUT转换函数的oracle逐步重放。创建acquisition、use token、整体release操作、首次unknown、当前证明与槽位分账；失败不抹已取得资源，错身份拒绝零副作用，旧代同操作迟到补证不得污染新owner，完整责任结算后仍显式reopen。failureDomain只是模型标签，不提供真实故障隔离证明。

运行前计划为每runner D3 v3主控36项、因果gate2项、publisher4项，D4 v2确定性模型16项，分别计数；三runner对应108/6/12/48，均尚未实施执行，不相加作PTY或产品通过数。下一步仅在独立诊断树新增版本入口，先本地实施、fixture清单/源码hash冻结与独立源码复审，再唯一一次固定输入三平台采集及全工件可信重放。主运行时树只同步文档，不推送；W1/U1和完整生产退出交付继续阻塞。

## 19. 新诊断本地实施与审计边界（2026-09-22）

本阶段已进入独立诊断树的八个新版本入口实施与本地审计，完整记录见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节（比较中/验证中）。主运行时只同步文档；本阶段不运行D3真实36+2+4、不新增runner、不推送任何分支，不改业务、依赖、旧实验/工件或image.png。上一节“均未实施”的表述只描述设计冻结时点，不覆盖当前进展。

D4 v2的local-3 self-test/full及各自离线复核均16/16、302命令、58次预期拒绝、1924 checks；93语义负例、4 saved负例和另存7个重hash sidecar负例分开计数。unknown key拼接碰撞的初次失败保留，修订为JSON tuple并在固定第05项回归；早期绿色没有覆盖负例sidecar独立绑定的缺口也已记录。证据、精确源hash及不含native/PTY/真实并发的边界见该契约，不把本地模型计为三平台或产品验收。

D3最终本地self-test-2通过119 oracle、41 core、15文件、25 archive/consumer/binding fixtures；saved复核4/4、88 manifest members及四源原字节均匹配，但boundedConsumerDelivery=false、acceptanceReady=false，真实进程/native/PTY均未运行。首轮76/29/15及saved3/3保留为历史覆盖；cross-replay-1因oracle多算stdin JSON换行字节而误拒，修订移除该额外字节，core仍以stdin EOF分隔。迟到错误回溯首报、owner/unknown/event/scenario漏验和归档绑定已本地修正，首次失败不改判。到期才冻结的首报记录真实消费者延迟并标delivery-budget-unresolved，独立消费验收预算及六组逐fixture对账仍开放，不修改原deadline或暗加宽限；symlink负例归档须保留link元数据。

下一步仍补齐冻结覆盖和独立审查，之后才另行确认真实D3与三平台采集。W1/U1、原生第二批、真实Agent启动链/双会话/Host/Webview/packaged、生产API/停止预算及整体退出完整性均未完成；不把正常Windows已退出对象引用升级为OS bug。

## 20. Linux 部分创建失败最小原生增量（2026-09-23）

运行前输入为主树70def060、诊断efab7aa3。本阶段从固定Linux D3通过返回实际原生路径，只实施U1-0和U1-1，各连续三次、同一个新诊断binary，其他U1/W1场景不运行、不改原断言。主树只文档；新增入口、补丁和原生支持代码仅在独立诊断树，不修改已安装node-pty、旧实验、业务或workflow，不推送。本节是第一批的局部实现，不将六次尝试记成完整66项或跨平台验收。

### 20.1 资源与失败收尾

固定源仍为node-pty1.2.0-beta.12、嵌套node-addon-api7.1.1和pty.cc的19210adf摘要。每个driver只创建一次会话，在fork前预分配固定大小native记录及身份；forkpty成功返回后父分支立即登记master和child，再执行后续步骤。U1-0实际执行pty_nonblock；U1-1在该调用前跳过并记录合成EIO，不宣称fcntl真实失败，也不补做F_SETFL。

U1-1尚未提交read，不进入正常终端写入流程；登记owner单次close master，源记explicit-cancel/not-started而非EOF。close本身不保证child退出，因此在唯一waiter创建之前，由尚未reap的原创建者对其child尝试SIGTERM并保留实际返回，再安装同一native reaper取得真实wait结果。此时child尚未被任何本诊断waiter回收，控制不依据日志PID，不在回收后再操作它。注入失败与真实signal退出分账，不要求该负向路径自然exit7；close、控制、wait任一缺证或真实失败不能仅因命中注入而通过。

两路径共用单一reaper及TSFN通知，只有waitpid返回本次pid才解释status；thread启动、wait返回、payload取得/回收、通知接受、TSFN Release、finalizer及join分别记录。收到JS退出回调不等于资源已释放。U1-0由JS独占fs.read，记录在途读取与headless parser任务，实际EIO之后完成已接收内容和最终状态，确认没有read/consumer任务在途才请求native owner单次close。只读F_GETFL/fstat观察不得改变flags；U1-1关闭前记录仍blocking及未提交reader。

本阶段不注入TSFN/线程创建失败或环境销毁。实际发生这些意外时保留error/unknown并停止下一case，不能伪造已释放；整体进程退出仅是容器退出，不替代逐owner返回证明。C++支持代码仅服务单session诊断，不作为生产native API；未选定生产线程/进程布局。

### 20.2 编排与固定验证

保持observer→caller→native driver责任链。observer只控制自己创建的caller，caller保留driver的ChildProcess；native driver独占fork所得主体。caller在实际await操作结果后通过独立消息记录after-await，observer按自身接收时间观察，主体exit、源EOF/取消、parser完成、资源返回和driver退出分别保存。操作30秒、caller32秒、observer35/36秒沿用第10节；真实主体20秒自限只作安全保护，命中仍为fixture失败，不当自然成功。未知driver不靠新建一代绕过，停止余下样本。

U1-0使用第10节固定80x24、32位RUN重复64次及TAIL/最终光标x6/y4负载。独立私有控制通道仅用于fixture与driver握手/输出许可，不能让诊断内容进入PTY；原始ONLCR字节、writer完成凭证、完整headless状态和实际wait exit7都必须成立。U1-1不进入正常写入，不虚构尾部完整性。受控路径用现有Node/xterm/native API直接实现，不泛化D3/D4入口或新建通用进程框架；证据落盘与真正after-await计时分开。

Linux编译采用隔离目录中的固定原源加可重现补丁，以g++直接编译N-API shared object（C++17、PIC、pthread、异常、lutil）；显式匹配Node22.23.2官方headers和addon7.1.1，记录编译命令、compiler、header/source/binary摘要并直接加载该绝对路径，禁止回退prebuild。这是本Linux诊断的构建选择，不替代现有macOS/Windows构建或生产打包。

先做生成补丁及结果判定的少量针对性测试、编译和实际加载核验，然后仅以新目录执行一次六项固定切片并从保存raw独立核对。构建失败保留且实际PTY计零；运行失败原样留存，不重复完整矩阵筛绿，不以工具通用能力阻塞此增量。后续按本次真实问题继续U1其余项与W1平台实现，而非宣布全退出完整性已交付。

### 20.3 实际结果与边界

隔离构建以官方 Node 22.23.2 headers、node-pty 1.2.0-beta.12、嵌套 node-addon-api 7.1.1 和固定 `pty.cc` 生成，候选二进制摘要为 `aff95d1e0fa53e2cf124cc28f77637e0c0d9e9a1ceb5b2df7e30bbe6b40dec4d`；绝对路径加载和7个导出核验通过，构建阶段没有创建PTY。针对性测试6/6通过。

唯一原生切片目录为诊断树 `.debug/native-failure-v1-linux-first`。U1-0 三次均通过：写入2102字节、ONLCR后读取2104字节、Linux EIO作为源结束、wait原始状态1792/exit7、最终光标x6/y4，master单次close、TSFN/通知、payload释放、thread join/finalizer均有事实；U1-1 首次实际返回status256/exit1/signal0，仍blocking（flags32770），未提交read或writer，master close和SIGTERM调用均返回0，唯一wait、TSFN/Release、payload、join/finalizer均结算。原判定额外要求该负向路径必须以signal 1或15结束，因此记录为失败并停止其余两次，最终为3通过、1失败、2未运行。

该 `exit1` 只证明直接child已以非零退出并完成wait，不证明资源泄漏、真实Agent缺陷或SIGTERM导致了退出；候选原因包括 `forkpty` 子路径的 `login_tty`/启动失败，但本轮没有子侧errno或启动阶段事件，不能区分。`kill(SIGTERM)` 返回0也不要求随后wait一定是signal退出。原始失败、2项not-run、入口保存复核因动态import循环出现的exit13均保留；最终采用独立只读 `scripts/diagnostics/verify-native-failure-v1.mjs` 入口调用原verifier导出，离线复核exit1且保持3通过/1失败/2未运行，没有重跑native或改判首个失败。曾尝试拆纯模块，但源码身份核对拒绝变化，已撤回本轮拆分并核对采集时driver/verifier/test字节完全一致；不放宽来源检查。

### 20.4 证据、根因边界与下一步

证据均位于诊断树：`.debug/node22-headers-first` 保存官方下载及SHASUMS验证，headers archive为 `daaf13ec5d45a38bbcfcff06d0723f72a6813b89ab27bb5af2ac8e1f6259dde0`；`.debug/native-failure-v1-build-first` 保存第一次成功构建（零PTY），`.debug/native-failure-v1-build-raw-status` 保存运行前补充wait原始status后的最终构建（零PTY）。后者的inputs、build-command、build、manifest固定原源/生成源、g++11.4.0、2725份headers、addon与实际binary；2759成员摘要核对通过。两次构建不是两轮原生实验。

`.debug/native-failure-v1-validation-first` 保存6项针对性回归、唯一原生run的exit13日志、原导出离线复核、独立入口复核和raw-metrics。driver/verifier/test采集时摘要分别为 `94e77d2fe45854ba15affb23783d9544313c29da765a1c8b2b7e7869c6e61708`、`d6d98885aa4aa68a68a515f1c57c836f6d402fa594d3516c5e4d57b7516c7fc1`、`ffe977f52da3157eae4cedd8e7c807b0cafeb7d4831e2e6a9df978566c560378`，独立核对四份raw与writer receipt及三个保存源一致；既有第18阶段314个manifest成员未变。四次实际observer收到after-await最大227.630766ms，caller续体最大139.686304ms，独立writer receipt最大70.664447ms，未触发冻结30/32/35/36秒或1/2秒预算。

只读核对本机glibc2.35-0ubuntu3.15的libc（SHA256 `b2cf6c33b74d2f22543b7a469a75b538911e690f769d0b238843a49465b83793`）确认forkpty子分支调用login_tty失败后直接_exit(1)。固定pty.cc在forkpty前阻塞信号，只有forkpty在child成功返回后才恢复，因此“已接受SIGTERM但仍exit1”存在合法启动路径。pty.cc的chdir/execvp失败同样_exit(1)，当前缺少child阶段/errno，不能认定本次具体命中了哪个分支，也不能把注入的nonblock合成EIO写成真实ioctl错误。未收到ready不证明是否已经exec。

本次原判定不改：signal-only附加断言失败、safeToContinue=false、两项not-run，以及总入口exit13原样保留；它们不撤销已证明的owner收尾，也不作为资源unknown或OS缺陷证据。后续以新版本收窄退出形式断言、将资源结算与场景预期分别用于准入，并使用不循环导入的验证入口。仅在此直接判定问题澄清后另冻下一份最小原生输入，不补跑旧schedule、不扩通用工具框架。Linux其余U1、macOS、Windows W1、真实Agent启动链、并发/环境销毁及Supervisor/Host/Webview仍未由本轮验收。

## 21. 终止事实与资源准入分离的最小新输入（2026-09-23）

运行前基线为主树062f7f5c、诊断树69737915。本轮只修第20节实测的判定前提，新增v2编排与核验入口，冻结v1脚本、原断言、3通过/1失败/2未运行及exit13日志不变。使用同一aff95d1e二进制、Node22.23.2、相同固定依赖和预算，不重新构建native、不修改业务/已安装依赖/workflow，不运行runner或推送。旧首个exit1的具体child启动位置不作本轮前置。

### 21.1 三类判断

v2分别输出scenarioMatches（是否命中场景要求）、resourcesSettled（实际owner与在途工作是否结算）、evidenceSufficient（来源、身份、原始事实与预算是否足以判定）。pass要求三者全部成立；safeToContinue只在resourcesSettled及evidenceSufficient同时成立时为true。内容或预期结果不符不能自动变成资源unknown；反过来命中注入也不能覆盖close/wait/通知/线程收尾失败。原有close、control真实返回0要求不放宽，不把ESRCH直接当作已回收证明。

U1-1仍须真实取得child/master、登记后跳过nonblock并记合成EIO、关闭前仍blocking、未提交read/parser且未许可输出，单次close之后、唯一waiter之前由创建者尝试SIGTERM。只接受属于本child的真实wait终态并从原始status独立解码：正常退出或signal终止均可，不限制只能signal1/15，不以kill0推导终止原因。stopped/continued、错误/未知wait或错pid不得算已回收；raw状态与通知必须一致，callback矛盾使证据不足、阻止验收及后续准入，但不据此篡改真实wait事实。fixture保留的自限124及控制通道错误125仍是场景失败，不作为预期成功，但在资源/证据确实齐全时无需将它们归为资源unknown。任何正常输出许可或writer凭证都会违反U1-1未进入输出的前提。

U1-0完整原字节、writer凭证、真实EIO、headless完整状态/光标x6/y4、自然exit7和全部owner结算不变。单项内容失败但已证明资源和证据齐全时可继续既定有限schedule；owner失败或缺证则停止余项并逐项记not-run。

### 21.2 固定执行及收口

唯一新schedule依次为U1-0第1次和U1-1第1至3次，共4次尝试；这是v2新输入，不补跑旧两个not-run，也不与旧样本合并成新版通过率。v2 observer直接创建冻结v1 caller，后者继续持有v1 driver及原生child控制链；证据writer仍在操作结束后独立计时。保留30/32/35/36秒、fixture20秒与writer1/2秒预算及unknown停止准入规则。CLI/oracle静态依赖已完成求值的fixture/state导出，不让保存复核动态import仍处于顶层await的入口。

新增scripts/diagnostics/diagnose-native-failure-v2.mjs、native-failure-verifier-v2.mjs及针对性测试，只覆盖退出形式、已知场景失败但可安全继续、真实收尾失败/缺证必须停止和新CLI离线入口。运行前冻结四项schedule、源/二进制摘要及完整期望内容；先少量回归和静态复核，再一次真实四项并从保存raw独立核对，原失败不重判，不新增通用容量/listener/归档框架研究。若出现新实测失败，原样留存并按安全状态停止，不重复采集筛绿。本节运行前没有新增native结果；其余U1/W1、macOS/Windows、实际Agent与Supervisor/Host/Webview验收仍开放。

### 21.3 唯一新运行结果

三个新增v2文件仅位于独立诊断树。实现后经过两侧静态复核，缺native事实或评估中断不再默认场景匹配，并有针对性fixture。纯数据及固定源/负载测试为v1六项、v2九项共15/15；第一次漏设DSC_DEPENDENCY_ROOT造成旧测试两项失败，原13/15日志保留，补齐只读路径后通过，没有改测试或依赖来求绿。

唯一新目录 `.debug/native-failure-v2-linux-first` 已执行全部四项，三类判断均true，原生CLI与另起进程的 `--verify-saved` 都exit0。U1-0写入2102字节、读取ONLCR后2104字节并取得真实EIO，完整headless状态及最终光标x6/y4匹配；原始wait1792/exit7。U1-1三次均wait256/exit1/signal0，仍blocking（flags32770）、未提交read/parser、无输出许可或写入凭证，source保持explicit-cancel/not-started而非EOF。四项master单次close、唯一wait、payload回收、TSFN Release/finalizer与thread join均有返回事实；三项partial的SIGTERM实际调用均返回0。

这只关闭新四项输入的判据和入口问题，不是native资源实现修复：binary完全未改。三个exit1没有子侧启动阶段/errno证据，仍不能认定具体login_tty/chdir/exec分支、SIGTERM导致退出、OS bug或真实Agent缺陷。旧3/1/2、旧入口exit13和所有首次失败均保持原结论；不合并为新版通过率。

### 21.4 来源、复核与后续边界

采集时三个新增文件尚未提交，冻结SHA256为：CLI `7441c9629f2694ac1728c25363b1f5cba26eaed9f41b2eadeb6d5bd76b608356`，verifier `91f382af0bd2ad4bf5de70f634e7df373a84f7c300bd8bd094e0c37d72da7681`，test `48b4b5987cbb53dfcb041824b9d70f40f3d624ae3dd07073f4664a61490f05e5`。新schedule保存六个来源快照和四个预先生成的config；不把后来的提交倒称为采集输入。Node仍22.23.2、binary仍aff95d1e，未构建第二个候选。

`.debug/native-failure-v2-validation-first` 保存before、frozen-sources、targeted-tests及targeted-tests-env、native-run、offline-verification与preservation-audit；旧31文件、2759构建成员、installed pty.cc、binary及冻结新源码逐项摘要未变，旧test仍ffe977f5。离线核对不创建新PTY、不执行归档源码。

另由独立审查者直接从raw/config/evidence及六源快照完成503项检查、零失败，没有以summary自报或调用冻结verifier代替原始事实核对。审计文件 `.debug/native-failure-v2-validation-first/independent-native-audit.json` 的SHA256为 `5f4a3ddea3fe34607e82ec099169bf6fd3881b9954dd07fd18dccd1cefa5e3d3`。最大operation150.922725ms、caller续体151.008634ms、observer收到after-await214.99655ms、caller close227.175316ms、writer receipt69.249869ms/close75.436092ms，未改变原预算。503是四份证据的断言数，不是新增native样本数。

下一最小增量为Linux U1-2：先冻结“真实取得TSFN后、wait线程启动前注入失败”的具体资源处置与取证协议，再隔离实施及有限原生验证。未启动线程不能伪造join，child/master/TSFN/payload须分别结算；本轮未实施或运行该项。其余Linux U1、macOS U1、Windows W1、真实Agent包装链、长期/并发/环境销毁及Supervisor/Host/Webview/packaged仍未验收，生产API与停止预算未选定，不再本轮追加实验。

## 22. Linux TSFN 已取得后线程启动失败（2026-09-23）

运行前基线为主树dfbbe868、诊断树52954ea0。本阶段只推进U1-2，以及同一新候选的一次U1-0正常对照；全部旧v1/v2源码、断言、证据、3/1/2与新4/4结果冻结。主树只文档，隔离诊断树新增版本源码和新构建，不修改业务、已安装依赖、workflow，不push或触发runner。候选不是生产native API，不选择正式线程布局。

### 22.1 故障点与唯一资源责任

TSFN是N-API的线程安全通知对象。固定源仍为node-pty1.2.0-beta.12、addon7.1.1、Node22.23.2及pty.cc的19210adf摘要。fork成功后立即登记child/master，真实nonblock成功，再实际创建初始引用数1的TSFN；U1-2在std::thread构造前跳过调用并注入合成EAGAIN，走线程创建失败分支，不声称OS实际拒绝创建线程。须单列thread构造未调用、未started/finished/joined、实际joinable=false；无等待线程，不能join，也不再创建替代线程。

失败分支由原创建者观察并单次close自己的master，然后在尚未reap且没有waiter时对同一个owned child尝试SIGTERM，分别记录实际返回。此时没有提交read/parser，也没有输出许可；master已经真实nonblocking，与U1-1的blocking前提不同。接着释放已取得的唯一TSFN引用并等待真实finalizer；finalizer记录thread-not-joinable，不伪造thread-joined。未创建退出payload、未调用通知的事实须保留，不能补写payload-freed或callback成功。Close/control/TSFN Release失败仍为资源失败并停止后续准入，命中注入不能覆盖它们。

child由新增token-bound native方法failurePollWait独占回收：仅允许U1-2失败且无wait线程、仍持有本次wait责任时调用；每次最多一次真实waitpid(pid, &status, WNOHANG)，返回0是pending，-1/EINTR仍pending，其余错误保留unknown并停止该回收路径，只有返回本pid且status为exited/signaled才取得终态。禁止拿调用方传入PID、安装另一waiter、在reap后控制或再次wait；状态未就绪不解释status或伪造exit0。TSFN释放与child回收分别证明，不以driver退出代替资源收尾。

driver在捕获预期线程启动错误后执行有限轮询，首次立即、pending后至少500ms再调用，最多60次并受既有30秒操作预算约束；该诊断间隔不是生产停止期限，计数或时间耗尽只能报未确认。固定台账256事件足以覆盖该有限路径，不引入通用容量研究。原fixture20秒自限继续存在，命中exit124/控制错误125为场景失败，不能当自然成功。TSFN finalizer和wait可先后任意出现，driver只有两者完成后才提交最终报告。

### 22.2 固定验证与实施范围

唯一新schedule固定U1-0一次、U1-2三次，四个新token/config及期望内容须在首项前冻结。新native支持/补丁/构建采用v2，新编排/判定采用v3；复用固定payload、完整headless状态、外层caller/driver责任链与独立writer方法，不创建通用诊断框架。v3入口不得形成顶层await导入循环，保存源码、编译输入、实际binary及来源摘要；使用已有官方headers隔离构建，禁止回退prebuild或修改已安装源。

U1-0仍要求成功写2102/读2104字节、真实EIO、完整状态/光标x6/y4、exit7及原线程/TSFN/payload收尾。U1-2要求故障点实际到达、无read/parser/output、source=explicit-cancel/not-started、close/control/唯一wait及TSFN全部结算，同时证明无thread/payload/notification。独立解码wait终态，不要求SIGTERM调用成功必为signal退出。scenarioMatches、resourcesSettled、evidenceSufficient三类及safeToContinue保持第21节定义；原30/32/35/36秒、writer1/2秒不变，资源或证据缺失时余项记not-run。

先实现并执行少量补丁/纯判定测试及静态安全复审，再隔离构建/load（零PTY），固定源hash后只运行一次新四项并独立复核保存raw。首次构建或运行失败完整保留，不覆盖旧目录、不重复矩阵筛绿，不把未启动对象当作需要释放的泄漏。Linux其余U1、macOS/Windows、真实Agent包装链、并发/环境销毁及Supervisor/Host/Webview/packaged仍开放。本节为运行前协议，尚无本轮原生结果。

### 22.3 实施与唯一新运行

诊断树新增八个文件：`unix-native-failure-support-v2.h`、`unix-native-failure-patch-v2.mjs`、`build-native-failure-v2.mjs`、`native-thread-failure-patch-v2.test.mjs`、`native-failure-roles-v3.mjs`、`diagnose-native-failure-v3.mjs`、`native-failure-verifier-v3.mjs`、`native-failure-v3.test.mjs`，均在scripts/diagnostics。v3只复用冻结v1的fixture、writer和payload/state导出，新caller/driver显式保留原控制链。预期创建异常单列creationError，不能冒充exit callback；真实错误仍写report.error。

运行前安全复审确认：N-API TSFN的initial_thread_count可以包含主线程的初始取得，未启动worker时由创建者Release该唯一引用合法；Release之后不再访问TSFN，finalizer独立观察。正常路径constructor-return与thread-started可能交错，不强加伪全序。driver沿用29秒内部未确认保护，外层30/32/35/36秒不变；pending后的500ms用单调deadline复查，不依赖单次timer恰好足时。新补丁4组/判定9组及旧v1六组/v2九组合计28/28纯测试，不计native次数。

首次构建目录 `.debug/native-failure-v2-build-first` 成功，load只验证绝对路径和8个导出、零native方法调用。new binary SHA256为 `fa6f9ab7ba6faefeac1c569a555e5d00d4d3e0890184e885bcb51aa5a9053478`，生成pty.cc为 `fa3941006a6e52eef4bf314ac257a45d21e041aa2e48e3ed451951844a0ae453`；2759构建成员包含固定原源、2725官方headers和addon7.1.1。没有重新编译旧候选或修改已安装源。

唯一采集目录 `.debug/native-failure-v3-linux-first` 完整执行四项，新CLI及独立进程的--verify-saved均exit0，三类判断均true。U1-0成功写2102/读2104字节、真实EIO、wait1792/exit7、完整headless状态/光标x6/y4及全部原线程/通知资源收尾；本次17次read、1次parser。三个U1-2均真实nonblock成功（flags34818），真实TSFN创建后合成EAGAIN跳过thread构造，close与SIGTERM调用返回0，TSFN Release返回0并最终化，首次且唯一WNOHANG返回本child、status256/exit1；三个样本均无read/parser/output permission、无thread构造/启动/join、无payload/通知/callback。每个partial有24个native事件，source为explicit-cancel/not-started，不冒充EOF或尾部完整。

本次没有实测到WNOHANG pending/EINTR或第二次轮询，也没有实测500ms等待；这些只由固定源码/纯夹具覆盖，不能按三个终态样本宣称全部等待边界已验证。exit1具体child启动位置仍未知；结果只证明本候选在此注入点的已取得资源收尾可行，不证明真实OS线程耗尽、其他平台或真实Agent故障已修复。

### 22.4 来源、证据与剩余项

采集时八个新文件尚未提交，来源绑定当时快照，不倒称来自后来的commit。`.debug/native-failure-v3-validation-first/frozen-sources.json` 保存八源完整摘要；CLI/roles/verifier/test分别为 `96ad640490171344b053fcec816ec8f474ba90c9731898e751fe1bcb88f30a06`、`d16eadd3f22e31bf83a8e2f81643a0af471cfe96445932cc3b2ef524e220f736`、`727138ec84696f44a95870d106f31c5545ea0b5facd083a960595a81b9857573`、`15d55f99f8be6821b3cc88b7fbf0c8e40a7cfa48c1b613c906d617d4db50c8e1`；support/patch/build/patch-test分别为 `321fe046234bbc54ca535a39db59fc43cdc0fd15fef17b354ea27a59f59cfd5a`、`d0b15c4bbe054901cdf5a09d4f00cb4296299fb894507fe19542c7ac264044de`、`d42aeac94ddfac1d424b893a70c1024ccc79e10e440026e97be24675df6a811c`、`9013c220ff41605fc2e5513cfae0dc8fcf948b0d64b6f35deae61f81f728e5ce`。

schedule保存11源快照、四份预冻结config、buildDirectory及buildManifestHash；保存复核绑定binary、完整build manifest及build/patch/support的当前/构建输入/采集快照。validation-first还保存before、targeted-tests、build、native-run、offline-verification及独立审计。`build-preservation-audit.json` 完成2860项只读检查，确认新2759构建成员、可信补丁重生成和68个旧文件不变，SHA256为 `50ac12e829da8026c48060f65fbd7906a02623baa62c5c3ccaedb7964dc6e181`；检查数不是原生样本数。

另存 `.debug/native-failure-v3-validation-first/independent-native-audit.json`，SHA256 `d521b5c91059aaebc306e38d4dc5ab8d69299144625dbd239453fc883bafdafa`。独立审查不读summary、不调用verifier，直接核四份raw/config/evidence与11采集源；6179项数据/保持检查零失败，其中四case自身510项，其余含旧68文件、新8源及两个build各2759成员的保持核验，零新增native。最大operation161.326947ms、caller续体161.432543ms、observer收到after-await228.073118ms、caller close243.192798ms、writer receipt71.920929ms/close76.761996ms，原预算满足。第20/21节的失败、通过、not-run和旧CLI错误均未重判。

下一最小增量为Linux U1-3：先冻结“跳过一次waitpid并返回合成ECHILD、保留初次unconfirmed，再由同一个独占reaper取得真实终态”的具体协议，不能解释未初始化status或安装竞争waiter。本轮没有实施或运行U1-3，不追加实验。其余Linux U1/macOS U1/Windows W1、通知失败/环境销毁/并发、真实Agent及Host/Webview/packaged仍开放，生产API、资源隔离策略和停止预算未选定。
