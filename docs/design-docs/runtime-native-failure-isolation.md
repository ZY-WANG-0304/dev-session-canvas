---
title: 原生失败路径与资源隔离验证
decision_status: 比较中
validation_status: 未验证
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
updated_at: 2026-09-22
---

# 原生失败路径与资源隔离验证

## 1. 本阶段状态与完成边界

本设计承接 `docs/design-docs/runtime-execution-lifecycle-contract.md` 第16节。输入锚点为主运行时树f318579a、独立诊断树7fb4ae9e。G07新九控制仅补真实stdio关闭后的主体存活；旧三条not-established、D1/D2原结果、资源失败与所有工件不改。本文冻结下一轮诊断的第一批协议，不表示已实施、已原生验证或已选定生产拓扑。

目标是回答两件事：部分初始化/等待失败后，哪些资源仍由谁持有；一个资源结果无法确认时，如何不误报释放、不破坏其他会话，并限制继续积累。Terminal和Agent适用相同边界，实际Agent CLI的启动包装链另验；不新增普通后代托管、退出后历史、故障恢复、root归属改造或外部server承诺。

本阶段完成定义是：明确故障种类及注入性质、比较隔离候选、冻结工具观察与第一批创建/等待矩阵，独立复审并同步ExecPlan。除U1-4的通知返回替身及U1-5的释放回执扣留外，其余通知故障、环境销毁、取消、真正Close挂起及并发作为第二批必须闭合的问题；未写明可安全注入协议的案例不得开跑。下一阶段先实现D3/D4，完整通过后才实现W1/U1；生产接入仍受生命周期契约第9节门槛约束。

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

## 6. D3：调用方返回与证据落盘分离（冻结）

新增候选文件 `scripts/diagnostics/diagnostic-observation-envelope-v1.mjs`、`scripts/diagnostics/diagnose-observation-envelope-v1.mjs`；均尚不存在，不修改旧guard-v2。observer直接创建caller和writer并保留各自ChildProcess控制权。第一批caller只执行进程内注入操作，不创建后代或PTY；同步阻塞不会留下未登记子进程。

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

候选新增 `scripts/diagnostics/runtime-owner-quarantine-model-v1.mjs` 和 `scripts/diagnostics/diagnose-owner-quarantine-v1.mjs`。每平台8项、各一次，共24项确定性模型、零native；不能替代A/B真实并发。模型输出操作计数与完整身份，validator从事件独立重算。

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

第一步在独立诊断树新增D3两文件、D4两文件及 `.github/workflows/runtime-native-failure-foundation.yml`，先合成负例与本地Node25/Electron39，再以固定Node22.23.2三平台执行D3各24/D4各8。workflow限独立诊断分支，主运行时不推送；Node控制不安装业务依赖。新工具CLI须支持 `--self-test`、`--output NEW_DIRECTORY` 和 `--verify-saved DIRECTORY`，保存目录不可复用。以下是待实现接口，不是当前可运行命令。

第二步在D3/D4完整首次结果收口后，新增 `native-failure-owner-v1.mjs`（台账/调度协议）、`windows-native-failure-patch-v1.mjs`、`unix-native-failure-patch-v1.mjs`、`diagnose-native-failure-v1.mjs`，统一放 `scripts/diagnostics/`；它们只生成隔离fork，不import进业务、不改node_modules。原生workflow单独新增 `.github/workflows/runtime-native-failure-v1.yml`，按平台schedule执行W1/U1并始终上传完整工件。构建参数、机械补丁匹配计数及实际链接输入须实现前复审，编译失败记零实际运行、全部not-run，不能伪造66 native成功。

validator从完整schedule独立复算时序/身份/前提/计数/结果，不只读pass。必备负例包括删调用/回执、把held通知改成API失败、已成功wait却标仍活、重复关闭/错generation、部分释放就归还槽、原始EOF被改为取消或反向改写、伪造after-await、超预算或改t0、writer失败改sealed、缺binary/首项损坏后继续末项。源快照与输入commit逐项对账，Windows CRLF原字节保存、只读LF归一比对，不执行归档代码。

本设计阶段只做源码/版本指纹、矩阵计数、文档元数据/引用/历史不变及独立方案复审；既有bridge/tracker/Supervisor测试仅作为回归，不计新D3/D4/W1/U1通过。首次结果应追加新节记录实际OS、输入commit、run/attempt、全部工件和未执行项。只有下一轮实际证据才能改变validation_status；总体退出完整性计划继续active。
