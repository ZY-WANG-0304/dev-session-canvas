---
title: 退出完整性原生候选对照
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity-native-candidates.md
updated_at: 2026-09-23
---
# 退出完整性原生候选对照

## 1. 范围

承接 PR #294 的三平台公共接口基线，验证独立读取与资源生命周期候选。只运行新建 fixture，不修改业务、用户会话、依赖或旧基线。进程退出、输出 EOF、消费者应用和资源释放分别证明；静默时间、固定等待和 socket destroy 不算可信 EOF。当前为隔离可行性研究，不是生产方案或修复验收。

2026-09-20 用户澄清后的产品范围以第 9 节为准：画板管理 Terminal / Agent 执行会话及其终端资源，不默认承诺实际主进程退出后继续保留节点或终端以等待普通后代及其未来输出。第 2 节冻结协议、两轮原始断言和失败结果全部保留；它们描述诊断实验是否达到原门槛，不自动等于产品验收结论。

当前进展入口见第6节，最新Linux原生U1切片见 `runtime-native-failure-isolation.md` 第23节：新2a291215候选的U1-0一次/U1-3三次4/4，采集CLI与独立离线复核exit0；旧第20节3通过/1失败/2未运行及exit13、第21/22节各自4/4均保持，不合算。第30–43节保留此前原生、D1/D2及诊断工具历史；不以历史阶段的“尚未开始”覆盖本次有限结果，也不把这次切片当作完整U1/W1或产品验收。

## 2. 运行前冻结

Unix 对照 `stock` 与 `owned-async`，直接使用同一 node-pty native fork，后者独占 master fd，单个异步 read 64 KiB，EAGAIN 等 2 ms，每批让步。每案例 3 轮、串行，90000 行自然 exit 0/7、89800 行附近暂停 350 ms、UTF-8/ANSI/OSC 分片、后代延迟 350 ms、后代保持 1500 ms、TERM 后尾部 exit 7。源结束以 read 0/EIO 观察，主进程后 1000 ms 无结束则显式取消；30 s 单轮、32 s 硬截止。Linux 与 macOS 各 42 样本。只归一 LF 前重复 CR，其他内容必须精确；这是终端换行语义而非忽略缺失行。原始字节哈希和换行变换数均保留。macOS read 0/EIO 仅按原生观测记录，不由 Linux 结果推断。

Windows 比较 `stock-builtin`、`stock-dll`、`owned-dll`。候选直接使用锁定 node-pty 内部 native 启动，独立 worker 读取 conout pipe，通过有序消息交付原始 Buffer 和 end，不使用原转发 server 或静默销毁 timer。DLL 的 `ConptyReleasePseudoConsole` 行为需要验证，不能把开关本身视为修复。每案例 3 轮、串行，共 63 样本：90000 行自然 exit 0/7、89800 行附近暂停 1500 ms、合法 UTF-8/ANSI 分片、父退出后后代 1500 ms 写尾部、后代保持 5000 ms、输入请求合作停止后尾部 exit 7。Windows 源取消期限为主进程退出后 2500 ms；单轮采集 30 s，独立子进程在 35 s 硬终止。期限只用来报告中断，不能将其当成成功排空。

每个 Windows 样本放在独立子进程，结算内容后给 2 s 自然资源退出 guard；超时保存资源并退出非零，不 public kill 掩盖自然回收缺失。父进程保存子进程退出结果，回收明确记录的 fixture PID。所有强制清理都与源结果分开，不能因 OS 在诊断进程退出后回收句柄而宣称 provider 已释放。候选需要内容/光标全量匹配、writer receipt 成功、进程真实结果、native pipe end、worker 自然 exit；保持输出案例只要求明确中断和清理，不能标成排空。公共 reader 的 EOF 只作为 legacy 未证明观察。

Windows 窗口 120×40，scrollback 100000，以 headless xterm 对比完整文本和光标；ConPTY 允许 VT 转换，不要求原始字符串与 POSIX 完全相同。Unix 沿用 96×28 PTY，直接严格比较解码文本与控制序列，只归一 LF 前的 CR。文件保存 raw、writer receipt、进程与源事件、cleanup、环境和源码/二进制哈希，Windows 另存 writer 脚本。测试数据包含受控全量缓冲，仅作取证，不是生产内存方案。线程消息背压、公平性、并发输入、句柄增长、Host/Webview、Electron/最低支持宿主和 packaged 均为后续门槛。

## 3. 源码依据与局限

固定 `node-pty@1.2.0-beta.12` 的 `src/win/conpty.cc::SetupExitCallback()` 在调用 JS 之前关闭 shell handle 并移除 native baton；`PtyKill()` 则通过 baton 查找 HPCON。builtin 自然退出之后的 kill 不证明实际调用 `ClosePseudoConsole`。DLL connect 调用 `ConptyReleasePseudoConsole`，但原 JS worker 的转发 server 没有自然关闭路径。候选独占输出 worker，不直接修改 node_modules；测试真实 end/close/worker exit，不据源码预测成功。

## 4. 运行与失败处理

独立分支 `runtime-exit-integrity-native-candidates` 基于 main，不含未完成的运行时重构。新增专用 workflow，只在该分支 push 或手动触发，权限只读、无 secrets、三平台 Node 22、npm ci、fail-fast false，工件保留 14 天。每次运行固定全 schedule，新 output 目录拒绝覆盖；保留首次运行的所有失败。oracle/fixture/基础设施失败应单独分类，修订须另存新 run，不增加等待或降低内容门槛筛选绿色。

## 5. 当前结果

本地 Linux Node 25.6.0 / libuv 1.51.0 完整执行 42 样本，候选 18 次精确 read EIO、3 次明确取消；stock 三次暂停缺尾（writer 成功）、三次后代写失败分别保存。自然零/非零退出本轮无缺失，不声称已取得自然 HUP 的新对照。工件 `.debug/native-candidate-v1-local/` 已复核完整 schedule、内容哈希和候选门槛。两个入口自校验和三个脚本语法通过；Windows 的 TCP worker 自校验不是原生 ConPTY。

首轮远端 run [35498026812](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35498026812)，输入 `afb2497440d22ee088d8bd3a65766dcec008e322`，attempt 1，执行完整 147 样本。Ubuntu job 成功，macOS/Windows job 失败；未通过放宽断言、增加等待或重跑筛选改成绿色。

| 平台 | 原 reader | 独占 reader 候选 |
| --- | --- | --- |
| Ubuntu，42 样本 | 暂停三轮均只有 89800 行，writer 成功；后代尾部三轮写失败；其余内容匹配 | 18 次内容精确且 read EIO，3 次后代保持时明确取消，21/21 符合冻结门槛 |
| macOS，42 样本 | 自然大输出、暂停、分片、TERM 均完整；后代尾部三轮写失败；保持组很快结束 | 普通五类共 15 次精确 read 0；后代尾部 3 次缺失、保持组 3 次提前 read 0 而非预期取消，15/21 达标 |
| Windows，63 样本 | builtin 暂停三轮末尾光标少一行，文字完整；DLL 暂停完整；两个 stock 各 21 个样本均未在资源 guard 内自然退出 | 普通五类共 15 次内容/光标匹配、pipe EOF、worker 和诊断进程自然退出；后代两类 6 次未达冻结门槛，15/21 达标 |

三个平台均为 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12。Linux x64 kernel `6.17.0-1022-azure`，image `20260907.300.1`；macOS arm64 Darwin `25.6.0`，image `20260907.0351.1`。这是托管 runner 的特定原生组合，不代表所有 OS build/架构或实际 VS Code/Electron。Unix 脚本 SHA256 为 `7e258eb3135f4cfe07c621ae2d989e9733139b376f4c78f800d814e1ac87bf45`。

Windows Server 2025 x64 build `26100`，image `20260907.229.1`；native conpty.node SHA256 为 `2d1fb89aa74b692ad026807e78f90d970ef4e4b5b4b0254f94854f0f3f442306`，DLL 为 `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff`。下载目录 `.debug/github-candidates-35498026812-{ubuntu,macos,windows}/` 保留全部 raw/receipt/事件。147 项 schedule/内容哈希已核对，Windows 63 项离线完整内容/光标和评估复算通过（仍报告 6 个候选失败，不是原生验收转绿）；Unix cleanup 均无残留进程组成员，Windows fixture PID 清理记录均无残留。

## 6. 结论与下一步

### 当前状态（2026-09-23）

当前以 `runtime-native-failure-isolation.md` 第23节（2026-09-23）为准：新2a291215原生候选在原预算下完成唯一v4切片U1-0一次、U1-3三次共4/4，采集CLI与独立离线复核均exit0。四项均为真实wait1792/exit7、完整2104字节、真实EIO和最终光标x6/y4；场景、资源、证据三类判定均成立。45项纯回归通过，其中本阶段新增5项补丁和12项判定，与原生次数分开。旧第20阶段3通过/1失败/2未运行及exit13、第21/22阶段各自4/4均保留，不补跑、不重判、不合算。第43节及此前诊断契约按历史时点保留；本轮不改业务、旧实验或D4，不推送。

U1-3由同一个真实wait线程先跳过一次waitpid并保留合成-1/ECHILD的不可变firstAttempt，再独占取得真实终态；不解释无效status，不把首报覆写为exit0，也不增加竞争waiter。两场景都保持正常输出、单次payload/通知、TSFN Release、join/finalizer和parser完成后close。三个U1-3的JS首报快照均为currentWaitConfirmed=false；本次没有真实ECHILD、EINTR重试或回收后才观察首报的原生样本，不宣称这些边界已验证。下一项为Linux U1-4：先冻结真实wait成功后跳过通知并返回合成napi_closing时的TSFN/payload归属协议，尚未实施，不等同真实环境销毁。其他平台、真实Agent、并发及Supervisor/Host/Webview/产品验收仍开放，生产API和停止预算未选定，不新增通用工具前置。

第22阶段历史证据：fa6f9ab7候选的新U1-0一次/U1-2三次4/4和28项纯测试独立保留。U1-2在真实nonblock/TSFN后以合成EAGAIN跳过线程构造，close、SIGTERM请求、TSFN Release/finalizer及创建者独占WNOHANG回收成立，真实wait256/exit1；未创建thread/payload/notification，不伪造其释放，也不声称真实OS线程创建失败已验证。

第21阶段历史证据：同一aff95d1e候选、冻结v1执行角色及原预算的新U1-0一次/U1-1三次4/4，采集和离线入口exit0；仅在v2中收口退出形式与资源准入耦合、新入口循环导入问题，旧v1结果和源码不改。该批U1-1的exit1与本阶段U1-2属于不同故障点和新输入，分别保留。

第20阶段历史证据：U1-0各次均记录writer成功写2102字节、PTY原始2104字节（Linux ONLCR）、真实EIO、wait exit7、完整headless状态及最终光标x6/y4，master close、waiter thread、payload和TSFN均已结算。U1-1关闭前fd flags32770仍blocking，跳过非阻塞设置并记录合成EIO、未提交read；close和SIGTERM请求均返回0，真实wait status256/exit1/signal0，已登记owner均已结算。`kill`返回0不要求随后以信号退出，失败的退出形式不能抹去这些资源事实；本机glibc `forkpty`子路径在`login_tty`失败、信号仍阻塞时`_exit(1)`只是原因候选，尚未证明本样本命中。

第20阶段历史入口记录：原入口在最后`verifySaved`动态导入入口自身形成top-level-await循环并exit13，原失败保留，不能称原CLI已修好。新增只读独立入口 `verify-native-failure-v1.mjs` 直接导入冻结verifier；`standalone-verification.log`记录离线重放exit1，仍为3通过、1失败、2未运行且仅原U1-1失败，没有新增native执行。该入口缺陷与U1-1冻结判据失败分别记录，原driver、verifier、测试、原始证据、原断言和历史结果均保留。

最新证据见第41节：b4db41cc的唯一run35676427931经三平台完整归档复核，各full24/24、scaled24/24、oracle78/parser8及篡改24/23成立；Windows实际再次乱序而源序合法，新判据正确接受。第38节v1两个failure、真实迟到与writer预算漏验仍保留。来源/顺序窄验证不关闭D3完整settlement、D4重放/身份或W1/U1；下一阶段先补诊断结算契约。以下两段记录此前设计承接背景，不覆盖本段当前状态。

第30节已完成Windows bundled-DLL三臂首次原生矩阵及全量复核：138条会话完整，46次已知HPCON最终Close消除同native/no-close的逐会话+2总句柄增量，四个no-close资源失败保留。这是正常自然路径的窄因果证据，不是Windows对象语义缺陷或生产退出完整性已修复；旧类型/内核对象身份归属不确定不改判。

第31节冻结的D1/D2已完成本地及三平台首次runner，结果见第32–33节和 `docs/design-docs/runtime-execution-lifecycle-contract.md` 第11–13节。输入d173c099/run35620967433 attempt1的D1三平台各37项已验证；D2三平台各24项按原verifier通过，但Windows G07三项因fs.closeSync(1/2)在固定Windows libuv中不实际关闭stdio，未建立“流先关闭、主体仍活”前提。旧success/24pass及其余69条控制依据保留，不宣布旧三条补验或产品通过。第34节另冻的Windows-only补证已以cf359040/run35631266321 attempt1完成九个新真实child，原verifier及独立原始审计通过，详情见第35节；三close-wait建立新前提、六负控正确拒绝，原guard与预算不改。第36节及 `docs/design-docs/runtime-native-failure-isolation.md` 已冻结原生失败/unknown owner隔离第一批设计，尚无新工具或原生结果；下一步先实施D3/D4，完整验收后才推进W1/U1，不直接接入业务。其余通知/环境销毁、正缓冲取消、在途waiter/control fd、真正Close挂起和双会话第二批尚未冻结，builtin、旧Windows、真实Agent/Host/Webview/packaged和生产API/预算仍开放，设计比较中/验证中、计划active。

### 首轮阶段的历史讨论

本轮没有选定完整的跨平台生产 reader。Linux 独占 fd 的局部成功不能直接外推 macOS；Windows 单改 DLL 不能解决原 worker 资源生命周期。独立 Windows worker 的普通场景同时给出内容、源 end 和自然资源退出证据，但还不是零 OS 句柄/长驻服务无增长证明。

macOS 后代尾部组只收到 `PARENT`，候选真实 read 0 后关闭 master，writer receipt 为 `CHILD_TAIL\ncomplete:1`。因此不能把它写成“成功写入后丢字节”：旧 bash 的输出/receipt 缓冲行为也需隔离。保持组在约 10 ms 结束，不是 1000 ms 取消。可能涉及 session leader 退出时的终端撤销，但本轮没有 syscall errno、保持 master 打开的对照或 session leader 存活对照，不将该假设写成已证实根因。Windows 后代场景同样需确认子进程实际拥有可用的 console 输出，而非仅创建了进程。

源码旁证：[XNU kern_exit.c@f6217f891ac0bb64f3d375211650a4c1ff8ca1ea](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exit.c) 的 session leader 退出分支先 SIGHUP、ttywait，再 `VNOP_REVOKE(..., REVOKEALL)`。它支持该调查方向，但不是 runner 精确内核构建的触发轨迹；未取得运行中 syscall/控制组前不升级为本轮根因已证明。

首轮曾将有/无存活 session leader 的控制组、原始写入返回值及 EOF 后保持 master 的隔离探针列为下一轮优先工作。该优先级已由第 9 节的职责澄清取代；这些实验仍能说明终端所有者边界，但不再作为普通后代持续运行的产品前置门禁。不能把这 12 个失败改标为正常完成，也不能将写入失败与已写成功后缺尾合并统计。生产协议和共享 Host/Supervisor 接入仍需确认收尾边界与源结束/取消语义；资源增长、输入/并发预算、真正停止与强制停止、真实 provider/UI/packaged 和最低宿主矩阵继续开放。

## 7. 首轮工件复核与 Windows 夹具修订（第二轮前冻结）

Windows builtin 暂停三轮的 90000 行可打印文本哈希与预期一致，实际 `cursorLine=89999`，预期为 `90000`；writer receipt 均成功。故准确结论是末尾换行/终端光标状态不完整，不是缺少某行文字。对应原 DLL/候选均为 `90000`，候选在暂停后真实 pipe end 且 worker exit 0。保持光标断言，不因文本哈希相同放宽门槛。

后代首轮 9 个 tail 样本均无 writer receipt，结束后该 PID 已不存在。夹具通过普通 Node `spawn(..., {stdio: 'inherit'})` 创建子进程；固定 [libuv v1.51.0 win/process.c](https://github.com/libuv/libuv/blob/v1.51.0/src/win/process.c) 明确将非 detached 的子进程分配给父进程私有 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job。这违背“父退出后后代仍存活”的夹具前提；六个候选失败不能用来证明 ConPTY reader 截断存活后代。不能只切 detached，因为它同时改变 console 归属。

第二轮仅修订 Windows 后代启动：由 Node 启动 `cmd.exe /d /s /c start "" /b ...` 中间进程；cmd 创建的实际后代不由父 Node 直接加入上述 Job，并继承当前 console。记录实际后代 PID（不是 cmd PID）、`stdout.isTTY` 和主进程回调时的后代存活探测；候选后代门槛额外要求这两项成立。原先 7 案例、3 reader、每项 3 轮、90000 行、所有等待/资源预算均保持不变，完整运行而非只重跑失败项。Unix 脚本和所有 reader 均不变，macOS 的六个失败继续保留，不期待因本次夹具修订而变绿。第二轮运行前已冻结以上差异，结果须另存新 run。

## 8. 第二轮结果与当前边界

第二轮 [run 35498732353](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35498732353)，输入 `4ac3ad156ae7cec3bf649a656b2eb437149040e4`、attempt 1，再完整执行 147 项。Ubuntu、Windows job 成功，macOS job 失败，所以总 run 仍失败。没有把 macOS 六项改成成功，也没有用修正后的 Windows 结果覆盖首轮。

Windows 候选 21/21 达到冻结门槛：18 次完整内容/光标、真实 pipe EOF 和 worker/诊断进程自然退出；3 次保持输出达到固定 2500 ms 上限后明确取消并回收，不计为完整排空。修订后的六个后代样本均通过实际后代在 native 主进程回调时存活且 stdout 为 TTY 的新门槛。原 builtin 后代尾部三轮仍只呈现父输出；原 DLL 能呈现后代尾部，但两条 stock 各 21 次资源 guard 仍失败。两轮合计 84 次 stock 资源 guard 失败，不能用事后进程退出回收 OS 资源将其改判为 provider 自动释放。

第二轮工件复核确认：builtin 后代尾部三轮在 public onExit 结算时 receipt 尚未产生（summary 中为 null），但随后留存的 `writer-receipt.json` 都是 `written: true, code: 0`，`rendered.txt` 仍只有 `PARENT`。这次是存活后代确实成功写入、旧 reader 已提前关闭的真实对照，不是第一轮 Node Job 杀掉后代的夹具问题，也不同于 Linux/macOS 的写失败。候选相同场景完整呈现 `PARENT` 与 `CHILD_TAIL`，保留 native 主进程先退出、数据继续、pipe EOF、worker exit 的独立轨迹。

第二轮 Unix 不改变输入：Linux 18 次精确 read EIO、3 次明确取消，stock 三个暂停缺尾和三个后代写失败；macOS 普通 15 项完整、后代两组 6 项仍不满足冻结门槛。两轮 macOS 后代不是“旧失败/候选通过”证据，且本轮 stock 的普通大输出/暂停全部匹配，不夸大为已复现 macOS 同类短读。

当前可以继续评估 Unix 独占读取与 Windows DLL 独立 worker 两条适配路线，但不能选定统一生产实现。第二轮结束时曾将 macOS 后代/会话终端所有权控制实验列为下一阶段阻塞；第 9 节已撤销它作为独立产品门禁的判断，并保留全部诊断缺口。长驻 native 资源、输入公平性和 Host/Supervisor/消费者最终契约集成仍未完成。由输入触发的 cooperative-stop 只是夹具合作退出，不等价于已验收用户 stop、强制停止或任意进程树清理。

两轮六份工件均已下载到 `.debug/github-candidates-{run}-{platform}/`；完整 schedule、全部 raw 哈希已核对，Windows 两轮各 63 项完整内容/光标复算通过，分别保留 6/0 个候选失败。脚本哈希按实际输入 commit 核对，Windows CRLF checkout 差异已验证，未误报为源码漂移。每轮 Unix cleanup 无残留进程组，Windows 每样本 fixture PID 清理无残留；不代替长驻 native 句柄测试。自校验在本地 Node 25 与 Electron-as-Node 39 通过，后者不是原生 Windows 或实际 VS Code UI。本阶段不修改业务、依赖、PR #294 基线工具或其 workflow。

## 9. 职责澄清与交付阻塞重评

2026-09-20 用户确认：画板负责 Terminal / Agent 执行会话及其终端资源，不把会话内部启动的每个后代作为独立对象托管、追踪或恢复。Terminal 命令启动的子进程和后台任务由 shell、应用及操作系统管理；Agent 启动的工具命令及其后代由 Agent 管理。这一职责划分同时适用于 Terminal 和 Agent。

实际会话主进程退出后，不默认承诺继续维持节点或终端，等待普通后代结束或接收它们未来产生的输出。父子关系与前后台关系是不同维度，不能因为实验中父进程先退出，就把其中的后代叫作交互式 shell 后台作业。主进程仍运行时，同一终端收到的输出必须正常处理，不能按输出是否来自后代过滤。

退出完整性仍要求正确处理主进程尾部，不能因提前清理丢弃自身已经接收、排队或正在消费的内容；必须正确应用终端最终状态并释放 reader 等资源。主进程退出、真实输出结束、消费者完成和主动取消仍须分别表示，超时或主动截断不得记为完整 EOF。具体收尾边界、取消条件和时间预算仍待设计确认；旧实验中的 1000 ms / 2500 ms 等期限仅是冻结诊断参数，不是新产品决策。

启动链是独立例外：`Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` 中，实际 CLI 就是执行主体，不属于可排除的工具后代。启动器退出是否意味着实际 Agent 结束，需要针对真实启动链单独验证。第 7 节的 `cmd start /b` 是为诊断夹具排除 Node Job 干扰，不等于已验证真实 Agent 启动路径。

| 项目 | 当前分类与交付判断 | 理由或待补证据 |
| --- | --- | --- |
| 主进程尾部及已经接收、排队、消费中的内容 | 继续属于产品验收 | 范围收窄不允许提前清理吞掉已进入链路的内容；主进程仍运行期间的后代输出也在正常终端链路内 |
| 最终光标/终端状态、reader/worker 资源释放 | 继续属于产品验收，现有问题不关闭 | Windows builtin 暂停光标少一行及 stock 自然资源 guard 失败仍是相关证据；长驻句柄增长尚未验证 |
| 普通主进程退出后，后代延迟写或持有终端 | 底层生命周期、EOF、挂断和取消诊断，不独立阻塞产品交付 | 产品未承诺为这些后代保持终端；macOS 失败、Windows 成功写入而旧 reader 已关闭的对照均不能单独证明产品违约或真实 Agent 缺陷 |
| 启动包装程序到实际 Agent CLI 的生命周期 | 产品范围内的独立必验项，仍未验证 | 实际执行主体不能被当作普通工具后代排除；需区分包装程序退出与 CLI 退出 |
| 跨平台完整验收 | 仍未完成 | 普通后代失败不独立证明产品缺陷，也不等于 macOS 或其他平台已通过所有产品场景 |

下一增量优先明确保留的产品收尾契约和验收场景，并验证真实启动链、主进程尾部、最终状态及资源释放。macOS 原始 write、leader 存活/退出、EOF 后保持 master 的控制实验继续登记为诊断开放项，仅在需要回答保留的产品契约问题时再纳入相应门禁，不作为先完成才能选型或归档的无条件前置工作。生产 reader/API、取消方案和预算均未选定，设计保持“比较中 / 验证中”，计划保持 active。

本次只修改文档中的职责与阻塞判断，不修改旧脚本、断言、冻结参数、两轮工件或结果。历史失败仍按原实验条件失败；不删除证据、不追认绿色，也不因范围缩小宣布退出完整性已经解决。

## 10. 主进程收尾与启动链新矩阵（运行前冻结）

本增量另建 `diagnose-unix-exit-tail.mjs`、`diagnose-windows-launch-tail.mjs` 及专用 helper/worker，新 workflow 为 `runtime-exit-tail-products.yml`。旧三脚本、workflow、147 项矩阵及两轮失败均不变。独立分支在运行前 fetch/rebase 后仍基于 `origin/main@5965adb8`；不推送运行时重构历史、不修改业务或依赖。所有参数只用于诊断，生产取消触发、预算和 reader API 均未选定。

Unix 固定独占异步 fd reader，7 案例各 3 次，共 21 项：90000 行自然 exit 0、90000 行自然 exit 7、89800 附近停读 350 ms 后继续的尾部、UTF-8/CSI/OSC 分片与最终 CRLF、实际 headless parser 完成通知延迟 100 ms、真实 read 在途时请求取消、真实成功 read 回调的交付延迟 100 ms 时取消。常规 read 为 64 KiB，EAGAIN 等 2 ms 后继续，不将它认定为 EOF。终端文本、光标及相关 title/控制序列均按完整 oracle 核对；消费者结束、fd close 回调、fstat EBADF 和样本进程自然结束分别记录，不互相替代。

两个 Unix 取消案例让主进程先同步成功写 2048 ASCII 字节并保存 receipt，继续存活；候选提交真实 64-byte read 后关闭新读取准入，必须交付已拥有 read 的成功结果。原在途 read 完成后，另一个明确标为 audit 的诊断 reader 才接管 fd，采集剩余系统字节，要求候选交付与 audit 数据严格拼接为 writer 数据。audit 不是候选输出，不将后续 EOF 追认为候选 completed。这是主动截断负对照，旨在证明“保住在途 read”仍不足以证明 OS 尾部收齐，不是产品取消策略。每项子进程采集截止 10 s、自然退出 guard 1 s，父进程独立 watchdog 15 s，覆盖同步 native 初始化阻塞；只清理本次 fixture PID/进程组。

Windows 固定 7 案例、每项 3 次、两条路径，共 42 项：direct-zero、direct-nonzero、direct-paused-tail、cmd-wait-zero、cmd-wait-nonzero、bat-wait-nonzero、cmd-nonwait-control。实际 bridge 路径隔离构建 `createExecutionSessionProcess()`，默认 builtin ConPTY；候选 owned-dll 使用同一真实 `resolveExecutionSessionSpawnSpec()` 的结果及独占新 worker，它不是生产 bridge 已换 reader。public onExit 只记为旧能力观察，不能叫 source EOF。

Windows 主体写 READY 后持有 gate；正例观察至少 100 ms 主体存活且启动器未退出，放行后写带 UTF-8 的 TAIL 和最终 CRLF，再退出 0/7。cmd/bat fixture 调用 Node 等待型启动器，启动器继承终端并等待实际主体、传播退出码。它覆盖同形启动链，不运行真实 provider 或访问其凭据。direct-paused-tail 用 90000 编号行、89800 附近暂停 1500 ms，对完整文字与最终光标严格核对。nonwait 用 `cmd start /b` 建立故意不等待的负对照，要求包装程序退出时真实主体仍存活且 stdout 为 TTY；主体此后不再写未来输出，明确取消并清理，不当作自然排空成功。每项采集 30 s、退出观察 2500 ms、自然资源 guard 2 s，独立父进程硬截止 35 s；基线资源失败原样报告，候选单独判定。

每个平台执行全 schedule，新目录拒绝覆盖，保存源码快照/hash、native/environment 指纹、原始数据、writer receipt、事件、消费者结果、清理与父进程退出记录。独立 watchdog 及失败断言需自校验；GitHub fail-fast 关闭，所有失败上传和下载，修订先记录原因再完整新跑，不筛选成功。Linux/macOS 各 21 项，Windows 42 项，共 84 项；本地 Linux 另记，不与 runner 样本混算。

Windows 首次原生运行前的夹具细化：nonwait 由 driver 已实际收到 READY 后再放行包装程序提前退出，确保负对照满足就绪前提；不扩大输出或等待门槛。owned-DLL 保存原始 Buffer，actual-bridge 只能提供 onData 字符串，二者分别标记 native bytes 与 callback 文本，不假称后者为原始 ConPTY 字节。

本地 Unix v1 之后、v2 之前的取证补强：driver exit 后最多再等待 100 ms 接收 stdio，不以等待 close 延长独立 watchdog；缺少 fixture owner 时明确记录清理未证明；consumer hold 增加 barrier 等待时仍有 pending 操作的断言。暂停案例在 89800 附近将下一次读取限制在不超过 64 KiB 的边界量，并要求恢复后确实收到尾部，防止已经全读完才空暂停。90000 行、89800 位置、350 ms 暂停及所有自然收尾/取消期限不变；v1 工件及源码快照不改，v2 完整新跑。v1 三个暂停样本原事件已分别显示恢复后收到 1655/5043/2612 bytes，不将此次加强误写成修复了 v1 假阳性。

Unix v2 完成后、v3 与 Windows 首次原生之前，跨进程 JSON receipt/config 改用同目录临时文件加 rename 原子发布，避免另一进程在 exists 与 JSON.parse 之间看到空文件/半文件。前两轮未观测到该竞态，这是夹具可靠性补强，不调整案例/重复数/内容/期限；v3 仍完整运行 21 项，保留此前两轮原始快照。离线复核旧轮次按其快照中的原验证器执行，不能用新增取证字段追溯重判历史。

这一轮不是全产品验收：Windows worker 取消时在途消息与 OS 未读数据的交接、长驻 OS 句柄增长、输入公平性、信号/强停、真实 provider/VS Code、最低宿主及 packaged 仍未覆盖。自然子进程退出和单次 fd/worker 释放不能升级成长驻无增长结论。范围收窄不取消主进程尾部门槛，也不要求普通后代延迟输出作为产品门禁；旧诊断仍按原条件失败。

本轮只读审查发现锁定 `node-pty@1.2.0-beta.12` 的 `src/unix/pty.cc::SetupExitCallback()` 在 Apple 分支创建 `kqueue()`，函数返回前未见 `close(kq)`。这是待原生计数验证的资源风险，不是本轮新增的 macOS 实测失败；更说明只检查 PTY master fd 的 EBADF 和短命 driver 退出不足以证明 native 资源全部释放。后续长驻同进程对照应单独计量退出监听的 kqueue 等资源，并核对实际二进制来源，不用 OS 在 driver 退出时回收资源冒充 provider 正确释放。

## 11. 新矩阵本地结果与 runner 输入

Linux Node 25.6.0 / kernel `5.19.17-saturnv01` 的 `.debug/unix-exit-tail-v{1,2,3}-local/` 各完整执行 21 项，三版均通过其对应门槛。每版 15 次自然 read EIO；6 个取消对照每次交付 64 bytes，audit 另收 1984 bytes，不记为完整排空。完整内容、最终光标/title、消费者结算、master fd close/EBADF 与 driver 自然退出均留证。v2/v3 暂停后均另收到 5400 bytes，未用空暂停代替慢读取。

v1/v2/v3 脚本 SHA256 分别为 `e3776ec01ab759e4e890e4c92d7a2b1f6348615bfb3664decab4db2dce4ed2cd`、`5c0a922880a787029077c8606edac5621e22a180f287149d58bed67fd9c7423d`、`23e87e52e3bd51ef860e245a24404442296a3ba6e00ad3c9d1bd4c40a810d585`。每版完整源码/native snapshot 和实际事件保留；v1 以其旧验证器复算，不用新增 `stdioClosed` 字段重判。最终 native SHA256 为 `ab01eb7d31a5b6202e2a51339ad2cbe3f2a73e3a679e88195011e28f3160d5a7`。

最终 Unix watchdog 自校验工件 `/tmp/dsc-unix-tail-watchdog-eMhxGy` 仅为普通子进程故障注入，父进程直接 own/reap 的 fixture 清理不能冒充 native fork 故障下孤儿回收证明。Windows 本地自校验覆盖失败 oracle、真实 TCP worker EOF/pause/cancel 和同步死循环 watchdog，未启动 ConPTY 或 provider。三个新脚本语法、既有 `test:execution-session-bridge`、workflow YAML/只读分支边界及 `git diff --check` 通过，独立只读审查无本轮执行 blocker；基线生命周期或基础设施失败会让新 Windows run 失败，基线内容/资源观察与 owned 候选分别报告。

三平台 runner 尚待执行，本地 63 项不替代新 84 项原生矩阵。生产代码、依赖和旧脚本/workflow 均未变；设计仍为比较中/验证中，资源增长与真实 provider 等缺口按第 10 节保留。

## 12. 新矩阵首轮结果及失败分类

[run 35506150727](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35506150727)，输入 `f46008442a1c2637c0a0306501f53dde4f49b293`、attempt 1，完整执行新 84 项。Ubuntu / Windows job 成功，macOS job 失败，总 run 失败。不修改首次结果、不重跑筛选绿色，也不将旧两轮后代失败与本轮产品矩阵混算。

Ubuntu 21 项均满足新冻结门槛：15 次自然 read EIO 的完整内容/最终状态、6 次明确中断的 64/1984-byte 候选/audit 分账。原生和下载后完整 `--verify-saved` 均通过。环境 Node 22.23.2 / libuv 1.51.0、Linux x64 kernel `6.17.0-1022-azure`。

macOS 完整执行 21 项，12 项达标、9 项失败。零/非零自然尾部、Unicode/控制序列和延迟消费者各三次，共 12 项完整取得真实正容量 read 后的 read 0。三个 paused-tail 并未完成有效的暂停对照：Darwin 的额外 CR 使固定字节预算先于第 89800 行标记用尽，事件明确为 `read-submit capacity=0 → read-callback count=0 → fd-close-request → native-exit signal=1`。总接收量均为 2424600 bytes，writer receipt 缺失。这是本轮新探针把零长度 read 误当 EOF 后主动关闭终端的确定缺陷，不能归为产品原生 reader 缺尾，也不能把这三个 `source=read-eof` 算作可信 EOF。原始假分类字段不改，按本节重新解释其证据意义。

六个取消案例在 10 s 到期时已有匹配的 fixture owner/TTY，但没有 writer receipt、没有 candidate read 提交或收到字节，也没有 native 主进程退出事件；1 s 资源 guard 后 driver exit 3。只能确认“2048-byte 成功写入后再开始读取”的前提未建立，尚不能证明阻塞在 write syscall、缓冲容量不足或候选在途数据丢失。缺少 write-enter/return/errno 记录及受控 reader 放行对照，不能直接减小 2048 或增加等待使其变绿。macOS 为 arm64 / Darwin `25.6.0`，node/libuv 与 Ubuntu 相同，native `pty.node` SHA256 为 `30ac36647725b2402585781c8e81be39d76962bf79d03620a9763539d0fdbec8`。

macOS 原 `--verify-saved` 在读取失败样本缺失的 writer-receipt.json 时抛 ENOENT，未完成 21 项复算，这是失败工件验证器的独立缺口，不能写成该命令成功。独立补充只读审计已对完整 21 项 schedule、五份源码/native 快照、raw/audit hash、逐块解码与消费者事件、headless 全文/光标/title、可缺失的 receipt、PID/driver/cleanup 互核，仍保留 12 通过、9 失败，不新增原生样本。暂停三例分别有 181/182/182 个额外 CR，预算耗尽时只有 89793 完整行及下一行残片，没有 reader-pause 事件。六个取消组 fd 未自然关闭且 resource-timeout 留有 PipeWrap；事后 cleanup remaining/errors 空不代替自然 reader 释放。后续失败验证器需继续返回非零而不提前跳过其余样本。

下一增量先修复新探针的正容量读取不变量，以逻辑行/字符进度计算暂停边界，保持 90000/89800/350 ms 与原完整性断言；对取消前提另冻结 write-enter/return/errno 和无读取/受控放行对照，不以猜测缩小负载。更正脚本须新输入、新目录、保留本轮首次工件和失败。生产 reader/API/取消预算仍不选定，Windows 在途取消及同进程 native 资源增长也仍未由这轮证明。

Windows 42 项全部留证，owned-DLL 21/21 达到冻结门槛：18 次完整 pipe EOF、3 个不等待负控明确取消，均消费者完成、worker 与 driver 自然退出。实际 bridge 21 项生命周期全部通过，涵盖直接程序、cmd/bat 等待启动器的 0/7 退出传播和不等待负控；不是实际 provider 验收。基线 18 项内容匹配、3 个暂停内容失败，21 项自然资源 guard 均失败。两条路径 cleanup remaining 均空、基础设施门槛成立，Windows job 成功不等于基线无问题。

本轮三个基线暂停样本均完整呈现 90000 编号行，但原始 callback 文本精确结束于 `DSC_MAIN_LINE_90000\r`，未交付该行 LF、随后 ANSI 彩色 Unicode TAIL 整段及最终 CRLF；不是 VT 覆盖，也不是只差光标。subject writer receipt 的 token/PID/成功标记与主进程相符，退出码 0，public onExit 在 native 退出后约 1002–1004 ms、受控 reader 恢复前约 489 ms 已发生。最终 cursorLine 为 90000，预期 90002；候选三次包括全部正文/Unicode/最终换行，cursorLine 90002。它是实际 bridge 在受控慢读取下的主进程尾部反例，与旧矩阵仅最终光标少一行及普通后代实验分别记录，不把旧结果追认为同一表现。

Windows 环境 Server 2025 x64 build 26100，Node 22.23.2 / libuv 1.51.0；conpty.node/DLL hash 仍分别为 `2d1fb89aa74b692ad026807e78f90d970ef4e4b5b4b0254f94854f0f3f442306` / `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff`。下载后三平台完整 schedule/hash/结果已互核，Windows 原验证器完整 42 项复算通过，三个仓库源码快照与实际输入 commit 在仅规范化 CRLF 后相同，不将 checkout 换行误报成源码漂移。

下载目录为 `.debug/github-exit-tail-35506150727-{ubuntu,macos,windows}/`。macOS 补充审计单独保存于 `.debug/mac-exit-tail-35506150727-supplemental-audit/`，`audit.mjs` SHA256 `839982b46ac47593d7f60b670bd458b545b39ca084b245fff25d0dfde4e2232e`、`report.json` SHA256 `e7b2be1e756be85def845a4c8cb8745119cadc8e0874e9574a03cd7185b95323`；退出 0 表示工件对账完成，报告仍是 12 通过/9 失败，不追认原验证器或原生矩阵通过。三平台首次失败完整保留，本阶段收口为原生证据增量，不是全平台 reader 选定或生产修复。

## 13. Unix 写入前提控制组（运行前冻结）

本阶段基于独立分支 `7974206f`，新增 `diagnose-unix-exit-tail-v2.mjs`，显式保留第 12 节输入的原脚本、workflow、断言、源码快照和失败，不改业务。修订版承接相同七类每类三次共21项，额外增加 write-no-read / write-release 两组各三次，共27项/平台；Linux与macOS共54项，单独 workflow `runtime-unix-write-control.yml`，不重复或重判Windows42项。

暂停预算改按本ASCII夹具的非CR逻辑字节计数，保留90000行、89800标记、350ms暂停和最大64KiB读取；所有 fs.read 必须提交正容量，read0只有对应正容量请求才可能作为源结束证据。新增确定性回放覆盖重复CR和跨chunk标记，不能靠把0钳成任意值掩盖错误。完整文本、光标、title、恢复后实际收到尾部等原断言不降低。

七类原矩阵的2048-byte预置/64-byte在途读取、100ms回调/消费者通知延迟、10s采集/1s资源/15s独立父watchdog均保持。取消两类和新控制组在每次同步fs.writeSync前后向独立文件记录enter、returned（实际count/累计量）或error（code/errno），带token/PID/调用序号；记录不走受测TTY，错误也先落文件，避免stderr阻塞掩盖证据。成功写入回执仍只在全部2048字节返回后发布，不能用enter替代成功回执。

两个新控制组使用相同2048 ASCII bytes。driver观察到write-enter后继续不读100ms，保存该时刻的写入进度、成功回执有无、主体存活/退出状态，再分流：write-no-read不提交任何read，明确记diagnostic interruption并关闭master，观察主进程退出及资源；write-release从此时才开始正容量读取，精确收齐2048bytes并观察成功回执后放行fixture退出，直到真实EOF/EIO及consumer/fd/driver结算。fixture在成功写完后仍等待driver gate，因此早已写完的Linux也有相同存活观察窗口。控制组既不减少数据，也不把100ms当产品取消预算；无读组只证明该观察窗口内状态，不预设每个平台都必须阻塞，不将主动关闭称为EOF。

原六个取消案例若仍未建立前提，仍按原门槛失败；新控制组有独立classification，不能用其成功替代取消验收。验证器逐样本容许成功回执缺失为null、核对与失败判定相符，并继续复核全schedule；任何原生失败或工件损坏最终仍返回非零。自校验注入缺回执/篡改raw及零容量场景，保存报告，不能把完整离线审计成功写成原生通过。所有输出新目录，完整首次运行保留；本阶段不选定生产方案或预算，也不顺手修改Apple kqueue等native资源实现。

运行前本地验证：Linux Node25.6.0 的 `.debug/unix-write-control-v1-local/` 完整27项通过，原七类21项结果不变，新无读组三次明确中断、放行组三次精确2048字节及自然EIO。完整保存结果验证为attempted=27、verified=27，无失败或工件错误。脚本SHA256 `d82ba9d05d0575a887933a4598dade38910ce711861b739aeb2e62fe9c6d4c3d`，原生快照已保存。确定性重复CR/正容量断言及非PTY watchdog自校验通过，后者原始证据 `/tmp/dsc-unix-tail-watchdog-OdZmTH`。

派生的离线负对照 `.debug/unix-write-verifier-check-481Y8t/` 不修改任何原样本：缺回执并保持相符失败状态时完整核对27项、报告1个失败且exit1；篡改一份raw时尝试27项、26项工件有效、1项损坏且exit1，未提前跳过余下样本。这些不是新原生样本。新workflow只读权限/两平台边界、语法和diff检查通过，远端结果待执行。

## 14. Unix 写入控制结果与夹具循环等待

第 13 节协议先由 `9cacfc49` 冻结，输入 `7d832d3e84f09d50ea1934db17d88962eb0d09fb` 的 [run 35508235734](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35508235734) attempt 1 完整执行 54 项。Ubuntu 27/27，macOS 21/27；macOS job 和总 run 均失败，未重试筛选。新旧入口分别留证，不把第 12 节的暂停失败追认为通过，也不把六个新控制组替代六个原取消验收。

| 平台与分组 | 原生证据与结论 |
| --- | --- |
| Linux 原 21 项 | 15 次完整 EIO、6 次明确取消；取消仍交付 64 bytes，audit 另收 1984 bytes，不能合算候选完整输出。 |
| Linux 新控制 6 项 | 观察前已一次返回 2048 且有成功回执；无读组三次明确中断，放行组三次完整 2048、EIO、exit 0。 |
| macOS 自然/暂停/分片/消费者 15 项 | 全部完整文本/光标/title、正容量请求后的真实 read 0、消费者结算及单次 master fd/driver 退出。三个暂停样本所有 read capacity 至少 35，真实暂停后各另收 5402 bytes，全文含 90000 行；不再发生零长度 read 假 EOF。 |
| macOS 原取消 6 项 | 每次只有同步写调用的 `enter(requested=2048)`，没有 returned/error/成功回执，candidate readCalls=0。10 s 前提截止、1 s 资源 guard 后 driver exit 3；未进入取消路径，按原断言继续失败。 |
| macOS 无读控制 3 项 | 观察到 enter 后至少 100 ms，进度仍为 enter、回执 null、主体存活且无退出事件；从不提交 read，主动关闭 master 后 signal 1。没有取得写成功或 EOF，不是产品取消验收。 |
| macOS 放行控制 3 项 | 同一无读观察窗口内仍为 enter/回执 null/主体存活；放行正容量 read 后写调用一次 returned 2048 并发布成功回执，每次两个 1024-byte read 精确收齐 2048，之后放行主体 exit 0，得到真实 EOF、消费者及 fd/driver 结算。 |

由此将 macOS 原取消前提失败定位为**夹具的循环等待**：driver 要等全量同步写回执才开始读取，而本环境下这次 2048-byte 同步写需要读取进展才能完成。控制组改变的正是是否放行读取，支持同步写路径的背压/进展依赖，不支持“成功写入后被 candidate 丢弃”。`enter/returned` 是应用层 `fs.writeSync` 两侧记录，没有 syscall tracing；不能据两个 1024-byte 读取推定内核 PTY 精确总容量，也不外推所有 macOS/TTY 配置。原失败及总 run 状态不变，macOS 在途取消仍未验收；这不是已经复现的业务取消 bug。

下载目录为 `.debug/github-write-control-35508235734-{ubuntu,macos}/`。两个平台使用相同脚本 SHA256 `d82ba9d05d0575a887933a4598dade38910ce711861b739aeb2e62fe9c6d4c3d`、Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12；Linux x64 kernel 6.17.0-1022-azure，macOS arm64 Darwin 25.6.0。native pty.node SHA256 分别为 `ab01eb7d31a5b6202e2a51339ad2cbe3f2a73e3a679e88195011e28f3160d5a7`、`30ac36647725b2402585781c8e81be39d76962bf79d03620a9763539d0fdbec8`。源码/native 快照、输入 SHA、全部 schedule/raw/audit/消费者和 writer 身份已互核。下载后 `--verify-saved` 两边均 attempted=27、verified=27、evidenceErrors=[]；Ubuntu failures=[] / exit 0，macOS 精确保留六个原取消 failure / exit 1，验证器不再因缺回执提前停止。两边非 PTY watchdog 自校验通过，不扩称原生孤儿回收证明。

两平台所有 cleanup remaining/errors 为空，无独立父 watchdog 硬超时；macOS 六个前提失败样本仍没有自然 fd close，且依赖 driver 资源 guard 退出，不以事后无残留覆盖自然释放失败。其余案例的 fd close/EBADF、消费者 barrier 与自然 driver 退出分别留证；不证明长驻进程内 native 资源无增长，Apple kqueue 风险未关闭。工件 ID 为 Ubuntu `10603998209`、macOS `10604043029`，GitHub 返回的 ZIP digest 分别为 `21dc50cfa862aa38dcc804fa628690e2c0693c871d890bdcd0fa906aa71725c7`、`92803c186611545b01fc676b0008174042640ce0562fc9c3744545f65cf5fca5`，这是服务端归档标识，不冒称已对下载 ZIP 独立复算。

下一增量重新冻结无循环等待的取消握手，允许 writer 与 reader 取得进展，以原始调用进度和候选实际拥有的 read/回调建立前提；候选交付、audit 字节与最终 writer receipt 分别对账。保留 2048-byte 负载及旧失败，不靠减小负载、增长期限或将控制组改名解决取消验收。确切握手、断言与矩阵需运行前设计，不在本轮选定生产取消政策。随后继续 Windows 在途取消、同进程长驻资源及真实 provider/宿主/packaged，旧 Windows 主进程尾部与资源反例不受本轮影响。业务、依赖及旧脚本/workflow 未变，设计仍比较中/验证中，计划 active。

## 15. 可读性握手取消矩阵（运行前冻结）

本增量基于 `51b8c33e`，新增 `scripts/diagnostics/diagnose-unix-cancel-handshake.mjs`、只读原生 helper `scripts/diagnostics/unix-pty-readiness.c` 和专用 workflow `runtime-unix-cancel-handshake.yml`。原两个 Unix 入口、旧 workflow、所有原始断言和失败不改。冻结三类各三次：`cancel-request-pending`、`cancel-callback-held`、`read-through-control`，Linux/macOS 各 9 项、共 18 项。此窄矩阵专门补取消所有权，不重复宣称自然尾部、Windows或长驻资源已验收。

fixture 保持一次同步写入 2048 个 ASCII `C`，记录调用前后状态、实际返回值/错误、最终成功回执与 token/PID/TTY。短写时才继续剩余量，不人为拆分成较小预置块。成功后等待独立退出 gate，始终由实际主进程持有终端；driver 不再要求首读之前已有全量成功回执。每个样本仍为 10 s 采集、1 s 自然资源 guard、15 s 独立父 watchdog，非可读/暂不可读的重查间隔为 2 ms，候选单次 read 请求容量 64、audit/普通读取上限 64 KiB，held 成功回调交付延迟仍为 100 ms。这些均是诊断参数，不是生产取消政策。

driver 在写调用已进入后，用编译后的 helper 对继承的 master fd 执行一次 `poll(timeout=0)`、`fstat` 和 `isatty`，仅输出 JSON，不执行 read/write、不改 O_NONBLOCK/termios。每次等待 helper 自然退出且 stdio close，核对设备/inode/rdev 身份和 TTY，再判定 POLLIN 且无 HUP/ERR/NVAL；尚不可读则在原样本期限内重查。不用 FIONREAD 推断跨平台 master 输出字节数，也不以 sleep、writer-enter 或超时当可读证据。helper 不是并发消费者，它的 fd 副本在候选 read 前已释放；helper PID、报告、退出状态和编译器/源码/二进制 hash 全部留证。不支持/错误/提前挂断都使前提失败，不静默替换实现。

可读性不保证 read 填满请求，因此新契约按实际成功 read 的 `n` 验收，要求无 error 且 `0 < n <= 64`。`cancel-request-pending` 在唯一候选 read 提交后、同一 JS 调用栈立即取消，要求当时请求未交付回调；它不声称内核系统调用仍阻塞。`cancel-callback-held` 在真实成功回调后先持有 Buffer、再取消，100 ms 后才交付。两者均关闭新 read 准入，完整交付已拥有的 n 字节、结束 decoder 和候选源，明确标 interrupted；不得用随后 audit EOF 将候选追认为完整结束。零字节/EAGAIN 或错误不冒充成功取消，也不取消后重试挑选成功。

只有候选 read 和 held callback 都已结算、候选源已结束，audit 才取得唯一读取权。audit 字节不进入候选消费者；候选应精确等于原始成功回调，audit 应为 `2048-n`，二者严格拼接为完整 writer payload。audit 继续推进尚未完成的写入；不把它收到的全部字节称为“取消瞬间已经在 OS 缓冲中”。只有合计收齐 2048 且身份/长度/hash 正确的最终成功回执存在，才放行主体退出，继续读取到真实 EOF/EIO；早 EOF、超时、错误均失败。`read-through-control` 使用同一可读握手但不取消，候选独自完整接收 2048、audit 为零，并取得自然源结束、主体 exit 0。

三类都独立核对实际 headless 消费者的内容/最终状态、每个 enqueue/applied/completed、decoder尾部、fd close/EBADF 和 driver 自然退出；单次释放不等于长期资源零增长。driver 使用本次独立进程组，父硬 watchdog 清理该组内的 helper 与 driver，并另行清理 fixture 的独立进程组；失败路径也结束仍在运行的 helper，不允许额外 master 引用掩盖 EOF/释放。watchdog 自校验需包含 helper 子进程持有资源的故障注入，范围仍明确为非 PTY 控制，不能冒充全部原生故障回收证明。

新入口支持 `--self-test`、`--output NEW_DIR` 与 `--verify-saved DIR`。运行前编译 helper（Linux 用 gcc、macOS 用 clang，C99、警告视为错误），编译失败保存工具链错误且不启动样本；不增加产品依赖。自校验应拒绝坏可读性报告、错误 fd 身份/未退出 helper、假 EOF、提前 audit、丢掉 owned bytes、缺成功回执、错误分账和损坏 raw，并验证所有失败工件继续完整遍历。原生运行全矩阵、失败不筛选，保存完整 schedule、源码/native/helper 快照、原始读数据和事件。旧 64/1984 断言未放宽，新 n/2048-n 是单独命名的实际 read 所有权契约；新成功不追认旧六个失败，生产选型仍比较中/验证中。

## 16. 可读性握手本地验证与输入

执行前只读审查补齐三类离线互证：自然EOF/EIO必须来自对应owner最后真实read callback，而非只相信source标签；每次成功callback与交付按唯一read id/count/hash一一对应；全部helper尝试须逐项核对spawn/close/decision，最后一个helper也必须先于候选首读退出。增加假EAGAIN EOF、多helper晚close和重复audit id等负例，不改变冻结矩阵或期限。workflow提前指定自测证据目录，即使自测异常/超时也保留已生成工件。

Linux Node25.6.0本地 `.debug/unix-cancel-handshake-v1-local/` 完整9项通过；复审随后补唯一read id一一交付的断言，另在 `.debug/unix-cancel-handshake-v2-local/` 完整再跑9项并复算通过。两版均6次明确中断，候选实际64/audit1984 bytes；3次control候选完整2048、audit0及EIO，单次fd/consumer/driver结算成立。v1脚本SHA256 `64b8ff4124fd7b42018b82339fe282ea0e8bef685216049e0c51f2a7e483587c`、最终v2 `1875495f6dc4d0b60d6de21247cdea9de2f808ff90fb04049c3f35d579212559`；每版源码及全部原始工件保留，不用新验证器追溯重判旧版本。C helper SHA256 `0e17361b809fc1d05bd8261446ac4421755d297c170bf18c41e01c83648528b5`，工具链及binary hash保存在各目录。

最新非PTY自校验工件 `/tmp/dsc-unix-cancel-handshake-selftest-Z717VS`：合成9个合法失败全部复核；再破坏一份raw仍完整尝试9项，8份有效、1个evidenceError，未跳过其余失败；两组driver/helper进程组watchdog停止资源持有helper，并单独清理fixture。僵尸不算仍运行的资源owner，也不把此非PTY控制称为全部原生异常回收。此前自测证据 `/tmp/dsc-unix-cancel-handshake-selftest-AI8KNX` 保留。helper另通过编译及非TTY普通文件fd身份/共享offset不变检查，不是新PTY验收。语法、workflow只读两平台范围、既有bridge测试及diff检查通过；远端18项尚待执行，不由Linux本地外推macOS。

## 17. 握手首次结果与观察器干扰风险

输入 `931e8e22c4f857ae1b795f661d54cc6ab6666dec` 的 [run 35510798036](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35510798036) attempt 1 完整运行18项，Ubuntu9/9、macOS8/9，总run失败且未重试。两边六个取消均候选64/audit1984、候选interrupted；macOS第三个 `read-through-control` 收齐2048、headless内容/光标匹配，却没有自然源结束、主体退出或fd释放。其第4次正容量read提交后始终无callback，10s采集截止时pendingOwner仍为candidate，1s资源guard记录FSReqCallback/PipeWrap；15s父watchdog最终SIGKILL driver并清理fixture。成功writer receipt最终存在，但没有exit-gate文件/事件；不是缺字节，也不能把事后cleanup无残留当自然退出通过。

完整下载目录 `.debug/github-cancel-handshake-35510798036-{ubuntu,macos}/`，两边 `--verify-saved` 均attempted=9、verified=9、evidenceErrors=[]，macOS精确保留control-3失败并exit1。均Node22.23.2/libuv1.51.0/node-pty1.2.0-beta.12。Ubuntu工件ID `10605985681`、服务端ZIP digest `83a426accf523ed7809ffa033c322bb3989852aba5c8bfb0a564ba11a15a205f`；macOS ID `10605331473`、digest `60c6e946b5a712644fc82d89437fc94da15935bb216625f3b054431257e27a73`。这是服务端归档标识，非本地ZIP独立复算。

结果后发现第15节的“不改fd配置”前提只审查了C helper正文，遗漏其启动链。Node把数值stdio映射为UV_INHERIT_FD；固定 [libuv v1.51.0 process.c](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/process.c) 的fork路径375-376对继承的标准fd执行 `uv__nonblock_fcntl(fd, 0)`，Apple posix_spawn路径629-631在parent的use_fd上执行同样操作。[core.c](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/core.c) 669-690明确将0解释为清除O_NONBLOCK；dup2的文件状态标志共享，故风险同时涉及Linux和macOS，不仅是此次失败平台。锁定node-pty的unix/pty.cc原先将master设置为O_NONBLOCK。helper自身不read/write、已退出、fd身份相同、普通文件offset未改变，均不能证明共享flags没变化。

旧工件未记录F_GETFL，不能追补成原样本已测到flags变化。源码与事件支持新的循环等待解释：收齐数据后若回执尚未发布，openExitGate不放行，driver又提交read；一旦master被改为阻塞，reader等更多输出，fixture等gate，回执发布也不再触发检查。该精确时序尚缺原样本系统调用/flags轨迹，不写成全部已实证。**整轮18项及本地同helper样本暂停作为保持非阻塞reader的验收依据**，不只排除那个红项；已有字节及取消顺序观察继续保留，原始17绿/1红结果不改。此为诊断有效性问题，不是新确认的产品缺陷。下一步用第18节窄控制实验核对标志副作用，暂不另跑全取消矩阵。

## 18. helper 启动的 fd 标志对照（运行前冻结）

新增 `scripts/diagnostics/diagnose-unix-helper-fd-flags.mjs`、只读N-API模块 `unix-fd-inspect.c` 与独立workflow `runtime-unix-helper-fd-flags.yml`。旧脚本/helper/workflow、断言和工件全部不改。本矩阵只有 `helper-stdin-master`、`helper-stdin-null` 两类各三次，Linux/macOS每平台6项、总12项。它验证观察器是否改变被观察对象，不验证取消、终端尾部或产品资源零增长。

每个独立driver用相同node-pty native fork创建新PTY及安静fixture；fixture仅用独立文件发布带token/PID的ready并等待文件gate，无受测PTY读写。原位N-API `inspect(fd)` 仅调用F_GETFL、fstat、isatty，返回完整flags、nonblocking、dev/ino/rdev字符串和TTY；模块另导出平台O_NONBLOCK位值，不硬编码数值。不得dup、设置flags/termios、read/write或poll；编译记录Node头文件来源和hash、编译器/参数/源码/binary哈希。helper启动前连续inspect两次须完全一致，初始master必须非阻塞且为TTY。

master组原样启动旧C helper，stdio为 `[master, 'pipe', 'pipe']`；null组使用同一helper但stdin为ignore，PTY master不传给它。等待helper自然退出及stdio close后再连续inspect两次，核对同一fd身份/TTY及观察稳定性。master组的复现预期是仅清除O_NONBLOCK，其他flags保持；null组flags应全部保持。null组helper对非TTY的既有报告/退出行为如实记录，不把它当PTY可读性成功。任一初始前提、身份、差分或helper退出不符都报失败，不在执行后改变预期以获得绿色。模块错误或编译失败也留证，不静默换实现。

最后通过文件gate让fixture自然结束，driver关闭master并验证EBADF，自然退出独立留证。每样本10s截止、父15s硬watchdog；失败时只清理本次driver/helper组及fixture组，事后清理不能替代自然结算。全schedule继续执行，保存环境、输入SHA、事件、helper报告、所有flags观察、自然退出和cleanup；完整离线复核应区分有效失败和证据损坏。只支持新输出目录，不覆盖工件。先语法/非PTY断言负例，再Linux本地6项，最后原生两平台12项。成功只证明在该组合下的启动副作用，不追认旧失败通过，也不推出历史挂起的唯一因果。后续可另行设计不经子进程stdio的原位readiness探针，但本轮不选定或接入生产reader。

### 本地验证与远端输入前检查

第18节由 `9ae1d7f7` 先行冻结。新模块通过N-API/C语法检查和独立只读审查；运行前补native-owner清理回退、缺summary合法失败重建以及原始事件/summary/gate/退出结果互证。Linux Node25.6.0/libuv1.51.0的 `.debug/unix-helper-fd-flags-v1-local/` 与最终v2各完整6项通过及离线复核：master组三次flags从34818到32770，恰好清2048位，null组三次34818不变；四次身份/TTY一致、主体和driver自然退出及fd EBADF成立。v1后仅补gate文件写入失败的合法失败分类，另跑全v2留证，不覆盖v1。

最终脚本SHA256 `3ce60fc6806d9b3a5752d52a4e5c96fbf700d624a44afbf64abd8f184d8c9928`，N-API C为 `b816790632e98cbb7137eb7320c572e4ea4e2ebac6023c89acc17f7dc2497768`。合成标志负例自测 `/tmp/dsc-unix-fd-flags-selftest-u5o6eJ` 通过，原agent预检证据另存 `/tmp/dsc-unix-fd-flags-selftest-aUhBXM`；均不启动PTY。派生离线负对照 `.debug/fd-flags-verifier-control-pZPCEB/` 把六个driver标为退出失败，全部6项核对、failures=6/evidenceErrors=0/exit1；再损坏一份events仍attempted6、verified5、其余5个failure加1个evidenceError/exit1。原生工件不改，负对照不计新原生样本。新workflow只读权限/两平台范围及YAML检查通过；远端原生12项仍待运行。

## 19. 共享标志副作用的两平台原生证据

输入 `951724c2d9893f93ddf882ba1ac0226ca36b1beb` 的 [run 35511736807](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35511736807) attempt1完整执行12项，两平台各6项符合第18节冻结的**副作用复现**预期，总run成功，未重试。master组每个平台三次均只清O_NONBLOCK，null组三次均全部flags不变。Linux flags为34818→32770、mask2048；macOS为6→2、mask4。每次前后双观察稳定、fd身份与TTY一致，helper/fixture/driver自然退出、master关闭后EBADF；没有硬watchdog、cleanup signalled=false、remaining/errors均空。

这将“helper启动改变共享文件状态”的两平台结论从源码风险提升为目标原生组合的实测事实。Node/libuv启动时的继承标准fd处理，而非C正文poll/fstat操作，构成观察器干扰。它否定了第15节及本地同helper样本的无侵入前提，包括原来的绿色项；原始17绿/1红仍保留，不能用这12项绿色恢复取消验收资格。此实验安静、无PTY读写，没有重演旧control的writer receipt时序，故不把旧挂起的完整因果链或唯一根因冒称native闭环，也不将其转成产品缺陷。

下载目录 `.debug/github-helper-fd-flags-35511736807-{ubuntu,macos}/`，两边离线复核均attempted=6、verified=6、failures=[]、evidenceErrors=[]。脚本和C哈希与第18节一致，旧helper源码hash仍为 `0e17361b809fc1d05bd8261446ac4421755d297c170bf18c41e01c83648528b5`。Node运行时与编译头均22.23.2，libuv1.51.0、node-pty1.2.0-beta.12；Linux x64 kernel6.17.0-1022-azure/image20260907.300.1，macOS arm64 Darwin25.6.0/image20260907.0351.1。pty.node哈希分别 `ab01eb7d31a5b6202e2a51339ad2cbe3f2a73e3a679e88195011e28f3160d5a7`、`30ac36647725b2402585781c8e81be39d76962bf79d03620a9763539d0fdbec8`。Ubuntu工件ID `10605812206`、服务端ZIP digest `0e15b05412ef86c24586f08c35138354eec8f65f2383babc11d3f0053609a846`；macOS ID `10605791331`、digest `3ff7e11650e4655abbd63409be166006564f00d689ec5655658c75753a16fddd`，非本地ZIP独立复算。

本阶段收口为实验有效性问题的定位，不再扩大矩阵。下一增量应先冻结不经子进程stdio传递master的原位readiness路径，并将回执/gate推进与等待read callback解耦，记录相对时序，持续断言flags未变；再用新入口运行完整取消/无取消对照。不能简单改传fd3（Apple启动路径仍涉及所有继承槽），也不能用dup/dup2假定隔离文件状态，或静默恢复flags掩盖改变过前提。具体新诊断协议需先行设计，尚不是生产reader/取消API或预算。Windows在途取消、同进程native长期资源（含Apple kqueue风险）、真实provider/宿主/packaged继续开放。业务、依赖和旧实验零修改，bridge既有回归、元数据/索引/关联路径/计划及diff检查通过；设计保持比较中/验证中，计划active。

## 20. 原位观察与独立 gate 矩阵（运行前冻结）

本阶段基于 `06cde336`，新增 `diagnose-unix-inplace-cancel.mjs`、原位N-API模块 `unix-pty-observer.c` 和专用workflow `runtime-unix-inplace-cancel.yml`，均在scripts/diagnostics或.github/workflows下，不改旧入口/模块/workflow或历史结果。原请求未交付时取消、成功回调持有时取消、无取消完整读取三类各三次，另增加 `receipt-held-control` 三次；Linux/macOS各12项、共24项，失败不筛选、不重跑到绿色。不运行Windows，不选择生产reader或取消预算。

模块 `observe(fd)` 在原driver内调用F_GETFL、fstat、isatty、poll(timeout=0)，并再次F_GETFL；不dup、不设置flags/termios、不读写PTY、不启动携带master的观察子进程。返回前后完整flags、平台O_NONBLOCK与poll位值、TTY和dev/ino/rdev。driver初始、每次read提交/回调、关闭前及readiness重查均记录观察，要求完整flags等于初始值、两次F_GETFL一致、始终非阻塞、身份不变。首读前等待writer-enter，再要求poll可读且无HUP/ERR/NVAL；readiness只证明观测时可读，成功首读仍须无error且0<n<=64。异常前提直接失败，不恢复flags或取消后重试挑绿。

fixture仍一次同步write请求写2048个ASCII C，仅真实短写时继续剩余量；独立文件记录enter/returned/error、最终回执发布、gate观察，含token/PID及monotonic时间。普通三类写完立即发布回执后等文件退出gate。driver以独立控制循环每2ms观察回执，不由read循环调用gate判断；只有候选与audit合计精确2048、身份/长度/hash正确的回执及写入进度成立，才发布gate。观察时记录回执、已交付字节、pending read/held状态；文件发布前后分别记录事件，不假定跨进程日志完全有序，gate含driver发布时间、fixture另存观察时间。

两个取消场景仍保持64-byte首读、100ms成功回调持有、关闭新read准入；request-pending只指JS callback未交付，不声称内核仍阻塞。已拥有成功字节n完整交付，decoder与candidate source结算为interrupted后，audit才获得唯一读取权；audit为2048-n，与candidate严格分账，audit的真实EOF/EIO不升级candidate为完整。无取消组candidate独自完整2048、audit0，最终来源必须由正容量read真实0或EIO支持；四类均核对原始字节、实际headless最终状态、enqueue/applied/complete顺序及fd/driver自然释放。

`receipt-held-control` 是新命名的调度负载控制，不重演历史挂起：fixture写完后暂不发布回执，等待独立release文件。driver收齐2048后继续一次正容量read；在非阻塞PTY、主体仍活着且无新输出时，必须真实返回EAGAIN/EWOULDBLOCK。driver记录这个空read的callback后持有其逻辑返回值，暂停读取循环；控制循环观察到该held状态才发receipt-release，fixture发布最终回执；同一个独立控制循环核对回执与精确字节并发布退出gate，随后才释放held回调、继续读取真实EOF。严格核对“full bytes→空read callback held→release→回执观察→gate发布→held返回释放”的因果事件链；EAGAIN不是EOF，逻辑回调持有也不是OS read仍阻塞。这样直接验证gate不依赖读取循环恢复，而非只等一个随机延时；writer receipt在其他三类不人为延迟。

原10s采集、1s资源guard、15s独立父watchdog、2ms重查不变。控制循环在成功/错误/取消样本收尾时显式停止并结算；deadline只表示中断，不补造EOF。close前必须无未结算read/held结果，父watchdog仅清理本次driver进程组及另一个fixture组。无summary、缺回执等有效失败仍完整复核，其余样本继续执行；原始工件损坏单列evidenceErrors。记录Node/libuv/node-pty、头文件/编译器/源/binary哈希及输入SHA，输出目录不得存在。先编译/非PTY契约负例/本地全12项，再推独立分支跑原生24项并下载完整复核。新通过不追认旧18项有效，不替代Windows在途取消、长驻native资源或真实宿主验收。

## 21. 原位矩阵本地验证与首次失败

第20节由 `758efccf` 在实现前冻结。新writer同时保存原始追加事件与原子替换的完整状态，运行中控制循环读取后者，避免解析未发布完的日志尾部；退出后再将二者互核。原位观察前后flags、逐read观察/实际callback/唯一交付、source真实EOF、consumer已应用内容、自然退出与关闭证据分别校验；缺summary或回执的合法失败不阻止全schedule复核。

Linux Node25.6.0/libuv1.51.0首次 `.debug/unix-inplace-cancel-v1-local/` 完整12项中10通过、2失败；两次held回调实际仅99.682653/99.837933ms，未达到冻结100ms。它们的64/1984分账、flags不变、自然退出均成立，但原失败保持，离线复核attempted12/verified12、精确保留两失败/exit1。直接setTimeout(100)未保证单调时钟经过100ms，修正为按原100ms截止点重查，不增长采集期限、不降低断言。v1源码hash `36e6c38c79a613526dadf00884f236ac190b664cca7b48213fe370391b3a4966` 及全部原工件保留。

另跑v2全12项及复核通过，脚本hash `6e80ea5b5f8e6c1f31f651e1b56ccfb5e9e0b3301b1f531d31ee767879da6f10`；随后仅加固无summary/缺回执负例、控制组无audit与最终状态按实际parser-applied事件复核，最终v3全12项及复核通过。目录 `.debug/unix-inplace-cancel-v{2,3}-local/`，每版快照独立保留，不用新verifier回判v1。六次取消candidate64/audit1984且interrupted，两种无取消控制共六次candidate2048/audit0、真实EIO；receipt-held三次均有完整因果事件链，gate在held逻辑read释放前发布。所有原位观察flags均34818不变，fd关闭/EBADF与driver自然退出，无事后kill或cleanup残留；这不是长期native资源无增长证明。

最终JS SHA256 `714bf40f2de43e46cb9219ed4546b7d93cac1c4a349dc1bf724de55f5f28335e`，C SHA256 `1428850a154a8bc6ad3202871c0c94bb63d86cb28bca02c56077075240e10371`。最终非PTY自校验 `/tmp/dsc-inplace-selftest-QEuVeJ`：四类合成正例及flags/丢交付/提前audit/假EOF/gate晚于held释放等负例通过；合成12份有效失败（含缺回执、无summary）完整复核，损坏1份callback原始数据后仍尝试12项、11有效且继续报告末项失败。普通文件只读观察及非PTY阻塞driver硬watchdog通过，不冒称全部原生异常清理已验收。此前预检 `/tmp/dsc-inplace-selftest-{O1dqD8,bFfzwi,nzsHF3}` 保留。C编译/JS语法、只读两平台workflow YAML、bridge回归、diff检查通过；本节记录推送前的本地结果，随后远端24项结果见第22节。

## 22. 原位取消与独立 gate 的原生结果

固定输入 `697ee3f0012aa9d68f1774fa9a43ba3836e165d7` 的 [run 35516170917](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35516170917) attempt1完整执行24项，Ubuntu12/12、macOS12/12，总run成功，原生执行未重试。两平台全部初始/read提交/read回调/关闭前观察均保持原flags：Linux34818、macOS6。没有继承master的观察helper，也没有F_SETFL恢复操作；新readiness前提在这些样本中成立。

| 分组（每平台各三次） | 原始证据与边界 |
| --- | --- |
| request-pending取消 | read提交后、JS回调未交付时取消；每次candidate完整交付实际64、audit另收1984，candidate始终interrupted。不是内核阻塞read的取消证明。 |
| callback-held取消 | 真实成功callback持有至少100ms后完整交付64，audit1984；无新增candidate read，candidate先结算再移交audit，不将audit EOF升级为完整。 |
| read-through对照 | candidate独自完整2048、audit0，真实源结束及headless最终状态成立。 |
| receipt-held对照 | candidate先收齐2048，再取得真实正容量EAGAIN/0 callback并持有逻辑结果；独立循环发布release、观察回执及发布gate后才释放held结果。Linux三次held→gate约4.09–5.04ms，macOS约5.44–9.17ms；这些是观测值，不是生产预算。 |

所有样本完整writer receipt和源数据分别对账，Linux自然源为EIO、macOS为真实read0；取消中的自然来源属于audit，候选仍中断。全部consumer顺序/最终状态、控制循环结算、fd close/EBADF、主体及driver自然exit0分别留证；无硬watchdog、无事后kill，cleanup remaining/errors均空。这里只证明这些独立短生命周期driver的释放，不证明长驻服务native资源无增长。原18项受干扰矩阵及本地v1两个不足100ms的失败保留；新通过不追认旧实验有效，也不重演历史挂起的唯一因果。

完整下载目录为 `.debug/github-inplace-cancel-35516170917-macos/` 和 `.debug/github-inplace-cancel-35516170917-ubuntu-retry1/`，两边 `--verify-saved` 均attempted12/verified12、failures=[]、evidenceErrors=[]。Ubuntu首次工件传输停滞并被终止，未完成目录 `.debug/github-inplace-cancel-35516170917-ubuntu/` 保留；在下载完成前的离线读取曾ENOENT，不是原生或verifier语义失败。仅在新目录重试同一个artifact传输，没有重跑job或覆盖首次原生结果。

两平台Node运行时/编译头均22.23.2、libuv1.51.0、node-pty1.2.0-beta.12。Linux x64 kernel6.17.0-1022-azure/image20260907.300.1，macOS arm64 Darwin25.6.0/image20260907.0351.1；JS/C哈希与第21节最终版一致。pty.node分别为 `ab01eb7d31a5b6202e2a51339ad2cbe3f2a73e3a679e88195011e28f3160d5a7`、`30ac36647725b2402585781c8e81be39d76962bf79d03620a9763539d0fdbec8`。Ubuntu工件ID `10607250891`、服务端ZIP digest `dfc89206fb04cb63f47554ddc5b942aa8225ef6cc8ba66420fce7557e873688a`；macOS ID `10606379037`、digest `2018754a69597355644f7cced2b1f9b6d805af4dd51a85627b85763d9175f7f3`，非本地ZIP独立复算。

本增量完成Unix原位握手、独立gate及局部取消所有权验证，不再以旧helper前提问题阻塞后续。下一阶段优先Windows独立worker的在途取消/已拥有数据结算，并开展同进程长驻native资源对照（Apple kqueue仍为待实测源码风险）；具体矩阵仍须运行前冻结。本轮不是90000行/Unicode全矩阵重跑、真实provider/Host/Webview/packaged验收，也没有选定生产reader API、自然结束/取消政策或时间预算。所有新增实现均为隔离诊断，业务/依赖/旧入口和旧live绑定不变，设计比较中/验证中、计划active。

## 23. Windows 取消所有权与同进程资源矩阵（运行前冻结）

本增量基线为db6104d8，只新增 `scripts/diagnostics/diagnose-runtime-owned-lifecycle.mjs`、`runtime-owned-cancel-worker.mjs`、`native-runtime-resources.c` 和专用workflow，旧脚本、依赖、业务及历史失败不改。先验证暴露在JavaScript中的所有权，再测跨会话资源，不把net.Socket连接或暂停等同于证明内核中有某个挂起ReadFile，也不承诺取消时收齐ConPTY尚未交付的系统缓冲。Windows只验证当前DLL独立reader候选，不能外推builtin或真实Agent。

Windows四类各三次，共12项：`cancel-idle`让真实主体就绪但不写应用输出后取消；`cancel-worker-held`持有包含起始marker的真实data回调，待完整写回执后取消；`cancel-parent-held`让worker正常发送但Host侧逻辑消费者暂缓应用，在取得起始marker及写回执后取消；`read-through`自然结束对照。夹具写 `DSC_OWNED_BEGIN\n`、2048个ASCII C和 `\nDSC_OWNED_END\n`，idle写0字节，所有夹具持有退出gate；写入和回执推进不依赖读取循环。Windows VT按headless最终文字/光标语义对比，不强求pipe字节等于应用写入字节。若成功写回执或真实持有前提未成立，记前提失败，不降低负载或试绿。

取消时先暂停socket，记录held callback和readableLength快照，仅取走当时已经在JS readable buffer中的确定字节，按观察顺序交付，再销毁socket；不增加第二个pipe reader。全部worker观察原始字节、交付序号/字节、跨线程收到与消费者实际应用记录独立保存，必须完全对账。parent-held队列在取消确认后按原序结算，StringDecoder结束与headless最终应用完成后才算消费者完成。取消始终interrupted，close或后续end不升级为EOF；自然对照必须真实pipe end、主体exit0、worker exit0、输入流close。取消后才放行主体退出，普通后代不在矩阵内。

资源组在Linux/macOS/Windows分别运行 `control-1/native-1/control-2/native-2` 四个driver，每个driver始终是同一进程：先3次预热，再20次测量循环。native每次创建并自然结束一条真实PTY/ConPTY会话，Unix使用独占fs.read直到真实read0/EIO、master close/EBADF与native exit；Windows使用上述独立worker自然EOF路径。control使用同一采样/记录循环但不创建PTY，隔离观测器自身开销。每个driver共23次，native两轮每平台46条会话；不是每会话重启driver，也不调用事后kill伪造资源收敛。

资源观察器在driver内以只读OS API采样：Linux `/proc/self/fd`（排除观察器目录fd）与task计数；macOS `proc_pidinfo(PROC_PIDLISTFDS/PROC_PIDTASKINFO)`保留fd类型及线程数，尤其kqueue；Windows `GetProcessHandleCount`和Toolhelp线程计数，关闭本次snapshot后再取handle数。JS active resources、worker退出、源结束和native计数分开记录。观察器自测应识别同时打开3个普通文件的增量，并在关闭后恢复；禁止通过关闭未知fd来修复测量结果。

固定在预热后、每次测量循环收尾100ms后各取5个间隔20ms的快照。按每个资源维度保存min/max：任一测量组的min高于预热组max即报告持续增量，不能用最终driver退出消除失败；所有20组均无超额且会话/消费者/资源完整才判本组通过。连续增长的fd类型和序列支持归因，但单个计数差异不能未经控制就宣称具体泄漏根因。这个23次有界实验不是无限期无增长或真实宿主验收。

冻结每会话采集30s、会话完成后资源guard2s、取消样本父watchdog35s、资源driver父watchdog150s；观察间隔只用于诊断，不是生产预算。每个平台完整执行其schedule，失败也继续其余独立driver；同一driver遇会话失败停止该串行组并标明未执行项，不能跳过失败继续作为全组成功。工件含完整schedule、环境、源码/native/编译头哈希、fixture身份/TTY/写回执、原始字节/事件、计数与自然退出；失败和缺失证据分开，离线验证遍历所有条目。首次失败不覆盖，新修订另目录/输入留证。

下一步先实现自校验（丢交付、假EOF、增长计数、缺结果/损坏工件全遍历）、Linux本地资源组与TCP worker控制，再独立分支推送三平台原生。没有选定生产reader、取消条件或预算，不修改旧live绑定；Windows系统缓冲、异常终止、真实provider/Host/Webview/packaged与更长资源压力仍须另验。

### 本地实现与预检

协议由b98f1067运行前冻结。Linux Node25.6.0本地 `.debug/owned-lifecycle-v1-local/` 与消费者逐块hash/取消事件顺序加固后的 `.debug/owned-lifecycle-v2-local/` 均完成四个driver和完整离线复核，各有两轮23条真实PTY会话；native各20窗口fd21/thread11不增长，无PTY控制fd21/thread7不增长，全部writer/内容/真实EIO/消费者/close及自然driver退出通过，无guard/事后kill。不是Windows、macOS或无限期资源验收。

最终自测 `/tmp/dsc-owned-selftest-VtmAS6` 保存当前脚本/C输入，真实普通文件+3/-3计数、四类TCP worker所有权、丢交付/假EOF/零容量EOF与增长计数负例通过；四份合成缺结果失败全部复核，破坏首份后仍尝试四份、三有效一损坏，末项失败仍报告。早期预检 `/tmp/dsc-owned-selftest-lkHdUs`、`/tmp/dsc-owned-selftest-wTkaBs` 保留。非PTY watchdog、自校验、C warnings-as-errors、JS语法、bridge回归及三平台只读workflow检查通过。计数等待使用单调截止点核对，不把提前触发的timer当已满100ms。

推送输入的主脚本SHA256 `4c2e3decf149c120c06faa9fcb3f997aa6f6dc2990dcad7cedece7b622cfb09d`，worker `8630eab630bb085c843e92467d578b59f3f4480cccef4c6b56e5b3a75ebc1489`，C `fcd2cc8d55d8033b53c5e23e647e8ce7bb8b39f2c8931bcd50a302cb06b72adb`。本节为推送前预检，随后三平台首次结果见第24节；冻结参数和所有旧实验保持不变。

## 24. 取消所有权与同进程资源原生结果

冻结输入 `b031b5981af6d009455d172e6c727d0b8a56ee67` 的 [run35519226627](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35519226627) attempt1保留首次原生结果，不重跑job或放宽计数断言。Linux/macOS已完整执行各四个driver，并下载到 `.debug/github-owned-lifecycle-35519226627-{ubuntu,macos}/owned-lifecycle-evidence/`。各自46条真实会话均通过writer、字节/消费者、内容、源结束和单次生命周期检查，driver自然退出、无watchdog或事后kill；资源组独立判定如下。

Linux四组均通过。native两组各20个测量窗口保持fd23/thread11，无PTY控制fd23/thread7；不能把预热后libuv线程池的四线程当逐会话增长。macOS两组无PTY控制通过，fd12/thread7、kqueue3不变；两组native均失败：预热后fd15/thread11、kqueue6，每完成一条会话就新增一个kqueue，20次后fd35/thread11、kqueue26。各窗口五次观察都确认这些fd持续存在，原有kqueue没有消失，新增长并非master未关闭；所有master均有close/EBADF和真实read0证据。

macOS第一次native测量的新kqueue fd为17/15/16/18/19/20/21/22/25/23/24/26/27/28/29/30/31/32/33/34，第二次为15到34；这些身份逐窗口保留，不只是总计数偶然抖动。同一工件内 `source-snapshot/4-pty.cc` 第174行创建退出监听kqueue，其后等待与回调路径无close(kq)，与每次fork的实测增长一致。此轮已把Apple kqueue从纯源码风险提升为当前native路径的资源积累实证；还没有用修正native构建做因果干预对照，不能宣称生产修复或所有macOS版本已验收。

两边离线复核均attempted4/verified4、evidenceErrors=[]；Linux无failure/exit0，macOS完整保留native-1/native-2两个资源失败/exit1。这是有效失败证据，不是工件损坏。Node与编译头22.23.2、libuv1.51.0、node-pty1.2.0-beta.12；Linux x64 kernel6.17.0-1022-azure/image20260907.300.1，macOS arm64 Darwin25.6.0/image20260907.0351.1。两平台源码/native输入哈希和C编译记录完整保留。

Ubuntu工件ID10607847565、服务端ZIP digest `eb823e1d70d32eda91c0792a0e1d15955b5ee153523c9a481260aaf889a7b758`；macOS ID10606879826、digest `caebc9712910c175088e242b50315c6ece77393cec71c629c599184af3819ca5`，不是本地ZIP独立复算。

### Windows 取消与句柄结果

同一run的Windows完整16个driver执行并下载到 `.debug/github-owned-lifecycle-35519226627-windows/owned-lifecycle-evidence/`；12项取消/自然对照全部通过。idle三次虽无应用写入，仍收到并交付23字节ConPTY初始化数据；worker-held与parent-held各三次真实持有2082字节，累计观察与交付均2105字节，最终明确interrupted。自然对照三次均交付2121字节，实际pipe end、headless文字/光标、消费者逐块hash和自然主体/worker退出均通过。取消不与自然对照比总量来宣称完整EOF，不把未承诺的系统尾部计入已交付。

九个取消样本的JS readableLength快照全部为0，因而只验证了真实held callback、MessagePort/逻辑消费者和空readable快照的结算。新增代码的正长度readable-buffer分支尚无本轮原生覆盖，不能把全部已实现分支都写成已验收；也没有证明内核中具体ReadFile的挂起/取消。这一缺口须在新控制场景中单独冻结和验证，不改当前12项结果或追认旧测试。

Windows两组native各23条自然会话全部内容/消费者/pipe EOF/worker/input close通过，但资源oracle均失败：预热后handles197，每个测量会话+2，20次后237；线程12降至8，没有本轮线程增长。无PTY控制两组handles180/thread12不变。四组driver均自然exit0，没有guard或事后kill，仍不能解除40个持续句柄增量。源码显示 `pty_baton` 持有HPCON，connect调用 `ConptyReleasePseudoConsole`，退出回调关闭hShell并移除baton，而ClosePseudoConsole在另一路PtyKill；这只是进一步归属调查的候选链路，本次没有句柄类型/对象身份，不能仅凭+2将其唯一归因于HPCON或外推builtin。

Windows离线复核attempted16/verified16、evidenceErrors=[]，完整报告native-1/native-2两个资源失败/exit1。Windows x64 kernel10.0.26100/image20260907.229.1，Node/编译头22.23.2、libuv1.51.0、node-pty1.2.0-beta.12。工件ID10607308818、服务端ZIP digest `6899bb032da0d2070d1019146b19399817b054ab29e55b8e733340adcce98c66`。Windows checkout为CRLF，主脚本raw hash `b46c379d1eb3e8ee721dd4dee3f6417d9398d3b345339a0f1c3d9fbf9cc0d6e4`、worker `5b5d2731769d54402679707814bc65eb5d6eab68845cd26c229358d8262d0478`、C `e58e356dd2018ad6650cd35ac4afada33a558c030c2d7bac738af01fd053df8b`；只读归一LF后逐字等于提交输入，原工件不修改。conpty.node SHA256 `2d1fb89aa74b692ad026807e78f90d970ef4e4b5b4b0254f94854f0f3f442306`，conpty.dll `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff`。

三平台观察器自测均准确记录普通文件+3/-3，四类TCP、假EOF/所有权/增长负例及全失败遍历通过。全run为failure：24个driver中20通过/4资源失败，全部完整复核；共150条真实会话（每平台资源组46条，加Windows12条），这些计数不等于150项完整产品验收。首次原生输入、所有失败和旧实验均保留，没有通过重跑或放宽阈值变绿。

本阶段收口的是Windows局部已拥有数据结算证据，以及macOS/Windows同进程资源积累的实证。单独替换JS reader不足以完成退出完整性交付，原生PTY创建、退出监听与资源释放必须共同设计。下一增量先冻结资源归属/释放的受控对照：macOS kqueue生命周期干预构建、Windows句柄类型/身份与创建/回收边界，并补Windows正长度JS readable-buffer取消控制。所有候选修改只在隔离构建验证，不直接改业务或依赖安装树；生产API、取消政策/预算、异常终止和真实provider/宿主/packaged仍未选定或验收，两份计划保持active。


## 25. 原生资源归因对照（运行前冻结）

本增量只验证资源归因，不选定生产reader/API或取消预算。新增 `diagnose-macos-kqueue-release.mjs`、`diagnose-windows-handle-inventory.mjs`、`windows-handle-inventory.c` 及独立 `runtime-native-resource-attribution.yml`。旧owned-lifecycle脚本/worker/C/workflow、冻结断言和失败工件不改；新入口可在新输出目录机械生成隔离副本，必须保存原文、变换清单、差异和hash，拒绝非预期输入。依赖安装树、业务代码和旧live绑定均不改。

macOS固定按prebuilt、rebuilt-baseline、rebuilt-close三个arm顺序运行，每arm沿用旧control-1/native-1/control-2/native-2完整schedule、每native driver三次预热加二十次测量，共十二driver、一百三十八条PTY。两个重编译arm使用相同Node头、工具链和node-pty包副本，正确解析node-pty自己依赖的node-addon-api；不能以仓库顶层另一版本代替。仅close arm在Apple退出等待分支结束、生成ExitEvent之前加入 `if (kq >= 0) { close(kq); }`，不重试close，不顺手修复原有异常wait/stat_loc路径。基线源码LF SHA256必须为19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db，锚点唯一；保存patch和前后源码。三个arm实际运行的spawn-helper固定为原prebuilt版本，构建产生的新helper另存而不使用，排除启动器变更。必须从每arm environment证明实际加载的native路径/hash，禁止回退prebuilt后误认候选已运行。

旧会话完整性与资源oracle保持原样，每窗口100ms收尾后五次20ms间隔采样，原会话30s/guard2s/driver150s不变。外层分别记录旧verifier结果：两基线预期各两个native资源失败并逐测量+1 kqueue，close arm预期全部内容/生命周期及资源无持续增长。只有三arm前提、完整schedule和上述对照均成立，才支持“该隔离close消除本组合中的kqueue增长”；基线红项仍红，不称生产已修复。任一构建失败、前提不符、缺工件、watchdog或对照不符均保留且整体非通过，尽可能继续其余arm，不用重跑到绿覆盖首轮。

Windows仅做原位只读句柄类型取证，不在本轮新增HPCON释放API。机械派生旧入口，唯一行为变换为schedule只保留四个资源driver及替换资源观察器；payload、worker、consumer、退出和旧资源断言不变，共四driver、四十六条PTY。新N-API模块用GetModuleHandle/GetProcAddress获取NT查询函数，NtQueryInformationProcess类51读取本进程句柄表，NtQueryObject类2查询类型，内存分配/重试有界；记录槽位hex、类型/index、访问权/属性、引用计数和原始status。Process类型补GetProcessId、GetProcessTimes、GetExitCodeProcess和可用时QueryFullProcessImageName的结果/错误；File仅GetFileType。不查询ObjectName、不读pipe、不DuplicateHandle、不关闭未知句柄，不用额外外部观察进程继承受测资源。

每次观察保存前后完整表和GetProcessHandleCount；槽位/type/access/属性集合变化或查询失败显式报告observer-race/inconclusive，不能默默丢项。数字槽位不是稳定内核对象ID，Process的PID+creation time只能加强该类型的身份，匿名File不能据此唯一归因。原计数失败照常输出，外层另报取证完整性、每个窗口的类型差分和跨窗口存留槽位；全部控制稳定、native持续File/Process配对且Process路径指向OpenConsole时也只算HPCON候选的支持证据，不冒称已完成释放干预。观察器自测用三个自己打开/关闭的普通文件验证类型和+3/-3；保留原parent watchdog防御无有限执行保证的系统查询。

先执行语法、机械变换/离线verifier负例及本地可运行控制，再将固定输入仅推独立诊断分支，在macOS/Windows各执行一次完整矩阵。全量工件下载完成后再离线复核，损坏样本不阻止其余样本检查；冻结与实际输入SHA、Node/头文件/工具链/源/binary哈希、命令输出和首轮失败均保存。生产资源回收设计、Windows正长度JS readable-buffer取消控制、异常退出、真实Agent启动链及Host/Webview/packaged继续开放。本轮把正缓冲控制独立排到资源归因之后，避免同时改变读取行为和原生资源实验。

### 实现前提与本地预检

协议由独立分支d70e6e1c、主分支15baf15a先行冻结。新macOS入口对node-gyp生成的隔离build工具链接保存target后移除链接本身，避免工件归档跟随机器外部路径；不处理安装树。构建日志、compiler实际路径/hash、node-gyp版本/源码与独立tooling lockfile、完整headers保留；spawn-helper固定、无prebuilt回退分别校验。有效反结果（基线不增长或候选仍增长）属于对照失败，不归为工件损坏。

两入口的Linux纯逻辑自测覆盖机械变换拒绝未知源、假的完整性/绿色结论、计数或类型竞争、Process槽位复用、缺工件及损坏首样本后继续末样本；新Windows路径复核使用可移植snapshot键，不依赖本机path.basename解释Windows绝对路径。独立工具布局smoke用node-gyp11.5.0、Node25.6.0同版本headers和嵌套node-addon-api7.1.1成功重编译Linux隔离副本，只证明布局/工具调用可用，不算macOS验证。既有executionSessionBridge回归、workflow YAML/两平台只读范围、文档链接和diff检查通过。实际runner固定Node22.23.2，macOS使用node-gyp11.5.0，尚待首次原生矩阵。

### 首次执行与诊断编译修正

固定输入944fe103f3f6d497c94b6575fabef6be69bc2929的run35527241793 attempt1总失败保持。macOS三arm完整138条PTY及下载离线复核通过外层对照：原包/重编译基线均kqueue6→26、fd15→35，close候选kqueue3不增长；旧四个基线资源失败仍为失败。Windows在新C模块编译阶段因辅助函数boolean与SDK rpcndr.h同名typedef冲突（C2365）失败，零条PTY，不是被测产品行为的新证据；编译日志和缺环境/四driver缺工件的离线结果原样保留。

后续仅将本轮新增C的辅助函数及七个调用标识符统一改名dsc_boolean，不改变查询、采样、比较、超时或断言。使用新的提交输入和新run，绝不覆盖首次工件或重判首次通过；同workflow会再次执行未变的macOS矩阵，首轮macOS因果证据独立保留。旧owned入口、worker、C、workflow和更早失败均不改。此为诊断工具编译修正，不是资源释放实现。

## 26. 原生资源归因结果

首次输入944fe103f3f6d497c94b6575fabef6be69bc2929的 [run35527241793](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35527241793) attempt1保留总failure：macOS外层三arm因果对照通过，Windows新观察器编译失败、零PTY。两个完整工件已下载至独立工作树 `.debug/github-resource-attribution-35527241793-{macos,windows}/`；本地复核macOS attempted3/verified3、无failure/evidenceError、exit0，Windows明确inconclusive/exit1、四driver均未执行，不能将缺失的运行证据改判通过。

macOS首轮12个driver、138条真实会话全部内容、消费者、真实正容量read0、master关闭/EBADF、native主体及driver自然退出成立；无watchdog、resource-timeout或cleanup kill。独立逐文件复核4759个manifest hash、1260次资源快照，原始观察与交付合计287316字节一致。两个基线arm的四个native driver均每次测量新增一个kqueue：fd15→35、kqueue6→26、线程11恒定；六个无PTY控制fd12/kqueue3/线程7稳定；close arm两个native driver均fd12/kqueue3/线程11稳定。旧verifier在prebuilt和rebuilt-baseline仍分别exit1并保留两个资源失败，在rebuilt-close为exit0；外层通过只表示预先冻结的因果对照成立。

三arm共用原spawn-helper SHA256 `2ee9dcf5337b78a258f20ed2872265ea5f7849eb82fc49a8e9d75e958168ae46`。实际加载pty.node的prebuilt/rebuilt-baseline/rebuilt-close哈希依次为 `30ac36647725b2402585781c8e81be39d76962bf79d03620a9763539d0fdbec8`、`4d497c1b21b5d8af9f50769c02aca0999629a7bb4c84d0fdf4b11f7082cc889c`、`4a9bb06cc321fdb500262112a9ce2780c1b00ccd60084762d769210d8201c9f1`，实际加载路径和require cache均匹配，未回退prebuilt。两基线源SHA为19210adf...，唯一close补丁源为 `3d92f41bab8e368b5b8dec8f4ecc931963969332c384ed552cad7f695270cab5`。环境Node/头22.23.2、libuv1.51.0、node-pty1.2.0-beta.12、node-addon-api7.1.1、node-gyp11.5.0，macOS26.6.2 arm64/Darwin25.6.0、Apple clang21.0.0/Xcode26.6、Python3.14.7、Make3.81，runner image20260907.0351.1；完整tool lock/headers/日志另存。

因此，Apple退出监听创建的kqueue缺少释放，在本原生组合的自然结束路径上已有最小干预因果证据，不再仅是源码风险或计数相关性。这不验证异常kqueue/kevent/waitpid、未初始化stat_loc、信号/EINTR、TSFN关闭或真实VS Code/provider路径，不直接将隔离补丁升级为正式生产方案。

首轮macOS工件ID10610476506、服务端ZIP digest `65eb6d9a03a3928368a18a5236e240cfa45eb777b87a7759b8d57457707ea06f`；Windows ID10609608936、digest `0b3aa80225d689e7f908c68075da1157d00be2ba7eae32ab1297ce534d9e9728`。这些是服务端归档摘要，不是本地ZIP独立复算。新macOS入口SHA256为faab85a8...、Windows入口15919b50...，完整输入在提交与工件中；Windows首次C的LF hash为b2da8ee7...，重命名后为84900ec7...，原CRLF文件和所有编译失败原样保留。

### Windows类型证据与归属缺口

局部重命名输入5a7ed5c45ba80319506705eac87bd09563090196的 [run35527528410](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35527528410) attempt1完整运行，仍保留总failure。Windows观察器/W4/WX编译及真实普通文件200→203→200、File类型+3/-3控制通过；四driver和46条PTY全部完成，旧verifier attempted4/verified4、两个native资源失败、evidenceErrors为空。所有会话内容/consumer/真实pipe EOF/worker exit/input close通过、driver自然退出、无watchdog或cleanup kill，资源却仍逐次增加：native-1 handles200→240、native-2 197→237，线程12→8，无PTY两组handles180/线程12稳定。两native预热绝对计数差3对应EtwRegistration80/77，不应误作会话增量。

全部420次观察的前后表、计数和槽位/type/access/属性集合一致，observerRace为0，所有NT类型查询成功。两个native组每个测量窗口均新增一个File（GetFileType=3，即PIPE）和一个Process，旧槽位保持、无移除或可见身份变更；File26→46、Process3→23，其他类型不增长。Process的PID、creationTime和exitCode=0均可取得，且各driver内这23个PID与自身23条fixture主体PID不相交。它们是已退出进程对象的句柄，不是实证有46个进程仍在运行；PID跨driver存在复用，更不能只以PID判断长期身份。

唯一查询失败为QueryFullProcessImageNameW的Win32 31（ERROR_GEN_FAILURE），两个native组各1365次、共2730次，不能改写成已证实权限不足。没有早期身份查询或专门API对照，也不能把退出后查询时机当作错误31的已证明原因。全部Process映像路径缺失，所以冻结的全身份取证依旧inconclusive，candidateSupport=false，离线exit1；全局输入检查和四driver工件均有效，不是归档损坏。**已确认的类型增长不等于已确认OpenConsole/HPCON对象归属**，不降低原门槛使其变绿。现有源码与固定DLL的Release/Close行为仍支持该调查方向，但本轮没有已知owner的释放干预，匿名File也没有稳定内核对象ID；不外推builtin或生产验收。

同run未改macOS输入的三arm另完成138条PTY及完整离线复核，结果再次与首轮一致，旧四个基线资源失败仍保留；这是另一份证据，不替换首轮。两次run共实际322条PTY（首轮138、次轮184），不是完整产品验收。下载目录 `.debug/github-resource-attribution-35527528410-{macos,windows}/`；macOS离线3/3无failure/evidenceError，Windows旧verifier与inventory都完整遍历4/4，两个native身份归因inconclusive，未修改oracle。Mac工件ID10610393210/digest `a1d5d20cb82880cc03ad313685309fafd571a26bfb72a664d419bd477d9cfc9d`，Windows ID10610243667/digest `3108dc19711292e503df7a286c169aaaa6f6c741c4ac8cda2d5b0363da3b25c0`，均为服务端ZIP摘要。

Windows环境为Node/headers22.23.2、libuv1.51.0、node-pty1.2.0-beta.12、x64/10.0.26100、image20260907.229.1；实际conpty.node SHA256 `2d1fb89aa74b692ad026807e78f90d970ef4e4b5b4b0254f94854f0f3f442306`、DLL `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff` 与前轮一致。新C修名后的LF hash `84900ec72f34344963944e34aae0621fb383a539ecf69003be9783d1e92ecd7b`，Windows原始CRLF文件只读归一校验，不改工件。完整本地自测、工具/原始源/hash和两次原生失败均保留。

### 阶段判断与下一边界

本阶段收口的是macOS自然退出kqueue增长的最小干预因果证据，以及Windows增长类型的进一步定位，不是退出完整性的生产交付。下一增量应先冻结Windows已知HPCON资源所有者的生命周期/释放对照，必要时在实际对象仍可查询阶段记录进程身份；不能盲关句柄表中的陌生槽位，也不能只对已经移除baton的id再调用kill宣称回收成功。该候选尚未选定具体API或预算，本轮不实施。

正长度JS readable-buffer取消控制独立保留，macOS异常wait/error/TSFN路径、真实Agent启动链、Host/Webview/packaged、生产自然结束/取消/资源owner契约仍未验收。业务代码、依赖安装树、旧live绑定和上一阶段冻结脚本/断言均未修改；两份计划保持active，设计仍为比较中/验证中。macOS本轮已得到的因果证据不需继续用同矩阵反复试绿，Windows也不因局部类型事实而取消剩余归属门槛。

## 27. Windows 正常进程对象语义控制（运行前冻结）

### 正常语义与调用方责任

按用户本次要求，先确认正常对象语义，不把已退出Process仍可查询或仍占句柄视为Windows系统缺陷。[PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)明确要求调用方在不再使用时关闭hProcess/hThread；子进程退出但父进程仍持有这些句柄时，系统仍保留有关结构。[CloseHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-closehandle)明确关闭Process句柄不等于终止执行，移除对象还需要进程已终止且全部引用释放。本轮只证明自身owner引用释放，不声称所有系统引用消失，也不主动终止正常已退出对象。

[ReleasePseudoConsole](https://learn.microsoft.com/en-us/windows/console/releasepseudoconsole)明确它不释放HPCON内存，调用方结束使用后仍必须ClosePseudoConsole；固定文档输入为[MicrosoftDocs d297f582](https://github.com/MicrosoftDocs/Console-Docs/blob/d297f58259a48a2ce5d77b427bc2b5dc6a573b00/docs/releasepseudoconsole.md)。[ClosePseudoConsole](https://learn.microsoft.com/en-us/windows/console/closepseudoconsole)可能影响仍连接的客户端与输出，Windows build26100前后返回行为不同。因此系统允许引用存续与应用最终释放职责并不矛盾，但不能用强杀或提前关闭换取计数下降。既有File/Process增长仍未精确绑定到HPCON成员，QueryFullProcessImageNameW的31原因也未证实。

源码限定补记：固定node-pty的conpty.cc:106实际为assert(remove_pty_baton(baton->id))，若NDEBUG生效，移除副作用也不执行。历史文档关于“已移除baton”的无条件表述以本限定为准；未经固定binary配置或反汇编不能作为运行事实。可靠源码事实是自然退出路径关闭hShell而未显式Close HPCON，hShell未置空；复用kill可能触及失效或复用的句柄值。HPCON是opaque token，不能直接CloseHandle(hpc)，也不能盲关枚举得到的陌生句柄。

### 新独立控制的冻结协议

新增scripts/diagnostics/windows-process-object-control.c、scripts/diagnostics/diagnose-windows-process-objects.mjs及.github/workflows/runtime-windows-process-objects.yml，不加载node-pty、不创建PTY、不修改旧工具或依赖。固定顺序control-1、release-each-1、retain-until-end-1、control-2、release-each-2、retain-until-end-2，每个原生driver自身连续3次预热加20次测量。control执行同样观测时序但不创建child；其余四driver共92个child，退出码按sessionIndex从0起交替0/7。总数为92个普通进程、零PTY，不计入产品验收。

每个child由CreateProcessW启动同一exe的child模式，CREATE_SUSPENDED|CREATE_NO_WINDOW、bInheritHandles=false。暂停时记录wait0、PID、创建/退出时间、退出码与image查询结果；ResumeThread后关闭本次返回的hThread，以5s有界wait确认自然退出。随后同一已退出hProcess查询三次、间隔至少50ms，总跨度至少100ms；要求signaled、正确退出码及PID/creation time一致。image成功或确切错误只作观察，不以必须成功或必须31作为门槛。release-each随后关闭自己的hProcess；retain保留全部23个至末尾逐一关闭。每次关闭记API结果并清空owner，不再操作已关闭数值槽位，不从数值槽位推定跨时间对象身份。

driver最初、预热后、每次测量结束及最终释放后，均先等待至少100ms，再取5次间隔至少20ms的GetProcessHandleCount，保存单调时钟与完整序列。control/release-each预期相对自身初始基线稳定；retain预热后相对初始+3、后续每次+1至+23，末尾释放后回到初始基线。取初始窗口[min,max]作为允许范围，每个预期偏移后的窗口所有计数均须在同样范围内；任何背景变化保留为对照未成立，不事后扩阈值求绿。受控retain的增长是实验故意持有的正常引用，不叫资源泄漏。

保存完整NDJSON owner/API/采样事件、stdout/stderr、退出状态、源码与工具/SDK/系统/Node/binary指纹，运行前保存schedule。每driver独立父watchdog30s，child wait5s；失败后清理只限本轮确切拥有的child，任何TerminateProcess、watchdog或非自然收尾都单列失败，不算通过。其余独立driver仍尝试执行；不会以driver退出后OS代收句柄冒充逐会话释放。

先做合成正例、假退出/重复关闭/未释放/错误计数/强杀负例，以及缺工件与首份损坏后继续复核的自测；Linux自测不算Windows验证。仅推独立诊断分支的新固定输入，Windows runner完整执行一次，首轮失败保留；工件下载完成再全量离线复核，区分有效反结果和工件损坏。此时尚无新原生结果，既有四个资源红项及映像inconclusive不改判。

### 下一边界

本控制仅校准正常对象语义和调用方引用释放；完成后才另冻已知HPCON owner自然收尾的隔离干预，不能从无PTY控制推导旧+2的确切根因。正长度JS readable-buffer取消、真实Agent启动链、异常路径、Host/Webview/packaged与生产API/预算继续开放，设计保持比较中/验证中，计划active，业务代码和旧live绑定不变。

实现前补记：GetProcessTimes在进程未退出时的exitTime未定义，暂停态只记录不要求为零。父JS watchdog只可结束自己spawn的driver，不能拿日志PID当所有权清理child；若driver尚持有暂停child，必须记录未结算/可能存活而非宣称清理完成，runner销毁环境也不是owner验收成功。原生C失败路径只凭本次CreateProcess返回且仍持有的HANDLE处理自己的child。上述限制不改变冻结次数、断言或预算。

## 28. Windows 对象语义首轮结果

输入cbbba0961595bcb0538a562ff183d2ef1abf15c9的[run35560063334](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35560063334) attempt1已完整执行，最终failure，未重跑或放宽断言。MSVC /W4 /WX编译、13类合成自测通过；六个driver全部执行，92个普通child、零PTY、690次快照。完整工件下载至独立工作树.debug/github-process-objects-35560063334-windows/后，原入口离线复核attempted6/verified6、evidenceErrors为空，但只有两个control通过，四个创建child的driver均保留计数失败。

### 正常语义已经确认的事实

本轮92个child均按暂停创建、恢复、关闭hThread、有界等待、退出后查询、最终关闭hProcess的顺序执行；48个自然exit0、44个自然exit7。六个driver全部自然exit0，没有watchdog、TerminateProcess、cleanup或未结算owner。已退出hProcess在持有期间仍signaled、可读正确退出码及稳定PID/creation time；这是正常对象引用语义，不是进程仍在运行。

共460次process-inspection中，92次暂停态image查询全部成功；92次立即退出态加276次保留态查询全部返回ERROR_GEN_FAILURE31，而wait/PID/exitCode/times所需查询成功。因而“已退出但仍可查询部分属性，映像查询失败31”在本普通进程控制中直接复现，不应单凭这一组合推断Windows或终端故障。这没有把31提升成所有版本必然行为，也不能据此补造旧2730次查询失败的精确原因、进程映像或HPCON归属；旧identity结果仍inconclusive。

### 计数反结果原样保留

| driver | 初始 | 三次预热后 | 二十次测量末尾 | 最终关闭后 | 冻结oracle |
| --- | --- | --- | --- | --- | --- |
| control-1 | 61 | 61 | 61 | 61 | 通过 |
| release-each-1 / release-each-2 | 55 | 60 | 60 | 60 | 失败 |
| retain-until-end-1 / retain-until-end-2 | 55 | 63 | 83 | 60 | 失败 |
| control-2 | 55 | 55 | 55 | 55 | 通过 |

每个窗口五次计数均一致。release-each在整个二十次测量中不再增长；retain每新增一个故意持有的hProcess增加1，最后关闭23个已知hProcess后83降至60，精确减少23。这支持“自身正常引用被逐个保留、显式关闭释放引用”，不代表系统中不存在其他引用或对象已经全局销毁。

四个child driver另有相对初始的+5，在三次预热期间形成，后续测量及最终关闭后保持。前两次预热没有独立计数窗口，不能断言+5恰在第一次CreateProcess发生；本轮没有类型表、模块加载或调用栈，不能确认为lazy初始化、ETW、安全软件、OS bug或应用泄漏。control之间61与55的差异也不直接归因。冻结要求最终回到初始区间未满足，因此四个失败不改判，不用事后减5或把基线移到预热后换取绿色。

这与旧PTY实验在预热后每会话增加2的观测不同，不能用本轮+5解释或撤销旧结果。

### 输入、验证与后续边界

原verifier在各driver首个计数反例处停止行为断言，因此另按原始事件完成只读补充审计，不调用或修改旧evaluate、不改raw：36份manifest成员哈希、2176事件、全部92child/690快照及单次关闭顺序逐项核对，未发现新增异常。保留440个计数快照超出原初始区间、四个失败，补充审计自身exit1；它不是替代验收器或新原生运行。最小retained间隔50.1474ms、三次跨度101.4829ms、快照间隔20.0723ms、settle100.1387ms均达到原冻结前提。

补充脚本与结果只保存在新.debug/process-objects-supplemental-audit-35560063334/，原下载目录未修改；audit.cjs/result.json SHA256分别d2bb1fec27172e8674072035be088ee9ff2e09ab69ff0c2176da4b8cd273c6ef、a5b49af16adddb676c6e95783f5ac2fc170c720bccb71123b0ba1aacc8b298d3。最终本地13类自测在.debug/windows-process-object-selftest-v4-local，早期自测目录均保留；既有executionSessionBridge回归、文档元数据/索引/关联路径、workflow YAML和diff检查通过，不能计为生产退出完整性验收。

环境为Windows x64 kernel10.0.26100、runner image20260907.229.1、Node22.23.2、Windows SDK10.0.26100.0、MSVC工具目录14.51.36231/compiler19.51.36256.0。实际exe SHA256为23657470f9708a84131ce948d5b62c97dc9d61bbc23fb59a241ab58140069b22；六个driver路径/hash与编译输出对应。JS/C的LF SHA256分别5656610bee07d05c978be656bdd3143405c9257555c85a18c9499eaeca53fee2、3388fca1675d2aefeaf542ee302a84f92edd243c0ea32ecd6a44d6e56765d1e7；Windows原始CRLF快照只读归一核对，不修改下载工件。artifact ID10621662744，服务端ZIP digest为08f518d1286d95eedc7b7a55ed44add24a99a19a1e02adc7a2b5e0d7a65d4c02，不冒称本地ZIP独立复算。

本阶段确认用户提醒成立，并将OS正常对象语义与调用方最终释放责任分开。ReleasePseudoConsole不免除最终Close是官方API契约；node-pty自然退出路径未显式Close仍是调用方owner设计问题的线索，但本轮无PTY控制不能证明旧File/Process配对就是HPCON成员，也不修改业务或生产生命周期策略。

下一阶段只对已知HPCON owner设计自然收尾后的隔离释放对照，先明确其保留用途、所有权及调用时机，不能复用kill、直接CloseHandle(hpc)或关闭陌生槽位。资源验收须同时分开owner账本、稳定背景与逐会话增长，+5归属留作受控取证开放项，不机械套入PTY矩阵或把普通对象存续当产品阻塞。Windows正长度JS缓冲取消、异常路径、实际Agent/Host/Webview/packaged和生产API/预算继续开放，设计比较中/验证中，计划active。
## 29. Windows 已知 HPCON owner 隔离释放对照（运行前冻结）

本增量只验证 bundled ConPTY DLL 后端中已知`HPCON`owner 的最终释放责任，不选择生产 API、取消预算或异常终止策略，也不修改业务代码、安装依赖或旧诊断。`useConptyDll=false`的 Windows builtin 后端另开独立矩阵，不能与本增量合并解释；macOS kqueue close 因果已单独收口。

### 候选臂和固定边界

固定三臂：`prebuilt-stock/no-close`使用现有 node-pty 预构建 native；`rebuilt-owner-retain/no-close`使用同一 bundled DLL、同一 spawn-helper 和重编译工具链，只加入 owner 保留状态但不调用 Close；`rebuilt-owner-retain/explicit-close`与上一臂共享全部 native 输入，只增加诊断专用`closeAfterExit(id)`单次 Close。三臂都固定`useConptyDll=true`，不能把 builtin/DLL 切换与 Close 变化混入因果结论。每臂沿用`control-1/native-1/control-2/native-2`，每个 driver 3 次预热加 20 次测量；共 12 个 driver、138 条 native PTY 会话。旧 payload、worker、consumer、终端状态、pipe/输入收尾和资源断言机械复用，首次失败与原始工件不覆盖。

`PtyConnect`中原有`ConptyReleasePseudoConsole(hpc)`时机保持不变。候选 source 在`SetupExitCallback`中等待并读取 shell 退出码后关闭`hShell`、置空并发布受保护的`shellExited`状态，但不在退出线程删除 baton；`closeAfterExit`只接受本模块确实持有、已发布`shellExited`、尚未关闭的`ptyId`，在主线程受保护地转移 HPCON owner，调用 DLL 的`ConptyClosePseudoConsole`一次，清空 owner 并移除 baton。调用失败、不支持或状态前提不成立均记录独立结果，不重试，不调用`PtyKill`，不调用`TerminateProcess`，不把`HPCON`传给`CloseHandle`，也不关闭句柄表中的陌生对象。关闭后不得继续 resize、clear、close 或复用该 id；普通后代不纳入托管。

`ptyHandles`的跨线程状态必须有明确的同步保护：退出等待线程不能无锁 erase，而应发布`hShell=null`与`shellExited`；主线程的`closeAfterExit`在锁内检查并取走 owner、锁外调用 Close、再在锁内完成移除。若实现采用其他同步方式，必须在源码快照中证明同一 owner 不会双重 Close、悬挂指针或竞态 erase；不得以`assert(remove_pty_baton(...))`的副作用承载生命周期。为防止 JS 序列门控被绕过，诊断 fork 还应提供带 generation/nonce 的`markPipeEof`与`markConsumerComplete`，`closeAfterExit`自身拒绝未满足这两个前提的调用；shellExited、exit worker/thread 完成、pipe EOF、consumer complete 和 owner 状态必须在同一 ledger 中核对。

### 收尾顺序和证据层级

每个 native session 必须记录`native-connected/owner-token`、writer receipt/gate、native exit、真实 worker`pipe-eof`、pipe close 无错误、input close、worker exit、decoder end、consumer complete/final terminal state，并满足偏序 gate 后再发`close-request`、`close-invoked`、`owner-closed`；不假设 native exit、pipe-end、worker close/exit、decoder end 和 consumer ack 的相对先后。`BlockingCall` 的 exit-event-enqueued、exit-callback-delivered、native-exit-thread-done、TSFN closing/queue failure 也必须单独记录；不能把事件排队当作 callback delivered 或 consumer complete。Close 前不得关闭 reader 以换取 EOF；Close 是 void，只记录调用及本地 owner 状态，不虚构返回成功。Close 后继续短窗口观察，任何新 worker bytes、pipe 错误、终态变化、重复操作、watchdog 或强制终止均为失败或不确定。若自然主体已退出但真实 pipe EOF、消费者已处理全部 data sequence 等前提缺失，则标记`precondition-failure`，不调用 Close、不宣称修复。

三类事实分开验收：原始字节/消费者/最终终端状态和自然主体、worker/input 生命周期；已知 owner ledger 的创建、Release、单次 Close、清空和不再使用；同进程 OS handle/thread/JS active resource 的稳定背景、每会话轨迹和 Close 后窗口。`no-close`的 owner 增长是有意正对照，不叫泄漏；`explicit-close`首先要求 owner ledger 每会话回到零、无继续逐会话增长及自然收尾完整，不强求 OS 总句柄立即回到 control baseline。若仍有残余背景，按`resource-failure`或`inconclusive`记录，不能把全局对象消失当作 owner 契约。

### 工件、预算和分类

每臂保存 source before/after/patch、实际 native/helper/DLL 路径和 hash、Node/headers/compiler/SDK、完整 schedule、session NDJSON、raw observed/delivered bytes、consumer/terminal state、owner ledger、Close 前后资源快照、driver stdout/stderr、watchdog 和首次失败。分类必须区分`precondition-failure`、`close-failure`、`natural-lifecycle-failure`、`resource-failure`、`evidence-error`与`inconclusive`。Close 阻塞、超时、`TerminateProcess`、未知句柄操作或 owner 重复操作不计通过；失败继续其余独立 driver，首轮目录不可覆盖。

自测先覆盖 owner 状态机、double-close/close-before-exit/unknown-id/close-after-owner-removed、Close 副作用输出、缺失自然 EOF/consumer、资源逐会话增长、缺工件与首项损坏后继续。Linux 自测不算 Windows 原生证据；Windows runner 只执行新独立 workflow，一次固定输入，原有资源失败和普通对象首轮结果保持不变。

### 实现前复核补充（2026-09-21）

候选仅在隔离构建目录生成，不写入安装中的 `node_modules`。stock 臂不调用候选新增接口；两条 rebuilt 臂共享同一编译产物，只改变是否请求最终 Close。Windows ConPTY 路径直接启动客户端，没有 Unix 的 `spawn-helper`；记录实际加载的 `conpty.node`、`conpty.dll` 及其配套 `OpenConsole.exe`，不能用不存在的 helper 证明输入一致性。

冻结源 `conpty.cc` 的 `PFNRELEASEPSEUDOCONSOLE` 调用类型为 void，但同包 `conpty.h` 明确声明 bundled `ConptyReleasePseudoConsole` 返回 HRESULT；不能把原调用方忽略返回值误写成实际 DLL 导出为 void。候选在不改变原调用位置和次数的前提下，使用与该头文件一致的函数指针签名记录 HRESULT，只有 SUCCEEDED 才发布 `releaseSucceeded`。最终 Close 才是 void，只记录调用和返回，不推断全局对象已经销毁。原有普通对象 +5、旧 PTY 每会话 +2 和新 owner 台账继续分开核对。

native 入口必须一次性占有 connect，拒绝同一 owner 重复启动；退出状态只有在等待结果和退出码查询均有效时才发布。TSFN 投递请求、实际接受、callback delivered、Release 状态和线程完成分别记录；callback 的日志可能早于 BlockingCall 返回，不人为规定这两个日志的全序。任何失败都阻止最终 Close。诊断 fork 不开放 legacy resize/clear/kill 入口，owner 表的全部访问受同步保护；这不是对生产 API 的修改或生产异常路径验收。

运行前审查和 Linux 自测只确认输入转换、校验器与拒绝路径的结构，不计为 Windows 原生通过。构建、语法或自测未通过时不启动矩阵；原生 driver 中的独立失败仍保存并继续其余 driver。离线复核必须重新验证 schedule、source/patch/binary/DLL 工件哈希、实际加载绑定、内容与资源原始证据，不能只信任保存的 pass 字段。

## 30. Windows 已知 HPCON owner 首次原生结果与收口（2026-09-21）

### 输入、归档与复核

第29节冻结的三臂矩阵以 `d0f0be882bf5f99d0dcaa90c94b7a3d6b0023790` 为输入，执行 GitHub run `35586906307`、attempt `1`。artifact `10633047821` 的 ZIP 共 `19738089` bytes，本地完整复算 SHA256 为 `4d60975924e1b6c3ff75421535ff7f9efd2413ad639419fbb4c81cfd52fd83e2`，不是只转述服务端 digest。完整工件保存在主运行时工作树 `dev-session-canvas2/.debug/hpcon-owner-35586906307/runtime-windows-hpcon-owner-35586906307-1/hpcon-owner-evidence/`。

原 verifier 完整报告 `attempted=12`、`verified=12`、四个 `resource-failure`、`evidenceErrors=[]`，因此原运行和复核仍为失败退出；不把预期正对照失败追认为绿色。另行只读审计重算 root manifest 的5739个文件、各 build/driver manifest、source/header/patch/native/DLL/配套程序及编译器输入，直接遍历138条会话和1260份资源快照，未发现额外输入或计数不一致。四个失败均来自 stock 或 owner-retain 的两个 native driver，无内容、owner gate 或工件完整性失败。

### 实际构建输入

环境为 Windows `10.0.26100` x64、runner image `20260907.229.1`、Node `22.23.2`、libuv `1.51.0`、node-addon-api `7.1.1`。重编译使用 MSVC compiler `19.51.36256.0`、VC tools `14.51.36231` 和 Windows SDK `10.0.26100.0`，编译退出0；实际头文件版本与 Node 一致。

| 输入 | SHA256 |
| --- | --- |
| 原 `conpty.cc` | `d502cce570552c7a1bea373c7672975eeb330c3025dd151cf9c180ca2a1becc2` |
| 同包且实际编译的 `conpty.h` | `32b74fe493b4435bc2f8362cfa4bcb4f49a290438002cc4a369e9379c7728d3c` |
| 生成并实际编译的 `conpty.cc` | `cb0ab01aa21eceeb06eac88306f4cf8980c15ede94303810a44df9b724c40e58` |
| 冻结变换 patch | `a7093eb560c76ac596892ab8d262f138fa3521d0b38162c4e6e6c4e7595a627b` |
| Stock `conpty.node` | `2d1fb89aa74b692ad026807e78f90d970ef4e4b5b4b0254f94854f0f3f442306` |
| 两条 rebuilt 臂共用的 `conpty.node` | `484f580d2ec3a08a6f972611692d26f6cf0fb9e4ca0d49398bda8c14a2baad50` |
| 三臂相同的 `conpty.dll` | `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff` |
| 三臂相同的配套 `OpenConsole.exe` | `7f68c840226505004215c0b82d4e502c24b5bc3f4b93c4baaaa19bd679c0def8` |
| 实际 `cl.exe` 快照 | `e6d57100c82ae0310c18b16abfe52bc0df8fbb272ca6c5fb287d485807cfce91` |

使用工件内冻结 transformer 从原 source/header 重新生成后，source-after、实际编译源和 patch 逐字一致。每个 driver 的实际 require 路径及 native 文件 hash 与对应 build 对账；两条 rebuilt 臂绑定同一产物。DLL/OpenConsole 记录的是固定同目录 loader 对应的输入文件及指纹，不是新增的 OS loaded-image 枚举或运行中 OpenConsole 内核对象身份取证。

### 自然收尾与已知 owner

全部138条会话取得完整 payload、原始 observed/delivered 对账、真实 pipe EOF、最终终端状态与消费者完成；主体 exit0、worker exit0、input/pipe close 分别有原始事件。12个 driver 均自然退出，没有资源 guard、父 watchdog 命中或事后强杀。原始 TSFN enqueue request/accepted、callback delivered、Release 和线程 join 完成按允许的偏序核对，不把 callback 日志与 BlockingCall 返回日志强行排序。

92条 instrumented 会话的 `ConptyReleasePseudoConsole` 实际 HRESULT 全为0。owner-retain 的两个 native driver 保留 owner 数逐次为1至23，符合有意正对照；explicit-close 的46条会话均在 shell、真实 EOF、worker/input 和 consumer gate 后单次调用 Close，清空 owner 并移除 baton，之后没有新增输出、终端状态变化或重复操作。void Close 的调用到返回为 `0.0785–0.1847 ms`，仅表示本次调用耗时，不是 HRESULT 或生产收尾预算。

### 同进程资源结果

每个 driver 仍是3次预热、20次测量；每个计数窗口5次快照，合计1260份。最短快照间隔 `27.9056 ms`，最短 Close 前后观察窗口 `109.5266 ms`，未降低原20/100ms门槛。

| 组别 | native-1 句柄 | native-2 句柄 | 每会话与 owner 结果 |
| --- | --- | --- | --- |
| `prebuilt-stock/no-close` | 200至240 | 197至237 | 每次测量+2；两个原资源失败保留 |
| `rebuilt-owner-retain/no-close` | 200至240 | 197至237 | 每次测量+2；owner 1至23；两个原资源失败保留 |
| `rebuilt-owner-retain/explicit-close` | 191保持不变 | 191保持不变 | 46次窗口均193至191，即每次-2；owner每次归零 |

六个无 PTY control 的句柄均为187、线程均为12且不增长。六个 native driver 的线程由12降至8，没有本轮线程积累；测量窗口中 JS active resources 均稳定为两个 PipeWrap，control 为一个。两个 no-close 臂全部92个会话的 Close 对照观察窗口句柄差为0；explicit-close 两轮各20个测量窗口均不再增长。191与control187的稳定背景差4不等于未完成本轮 owner 释放，也不能与旧无PTY控制的未知+5合并解释。

### 因果范围与后续边界

本轮建立的窄因果证据是：固定 bundled DLL 正常自然退出路径中，在相同重编译 native 上增加已知 HPCON 的最终 Close，消除了本轮逐会话+2总句柄增量，并保持已验收的自然内容与生命周期。它支持调用方应履行已知 owner 的最终释放责任，不表示 Windows 已退出 Process 对象被引用而存续是系统缺陷；保留引用是正常对象语义，不能以强杀或全局对象归零作为目标。

本轮没有句柄类型/内核对象ID，不能逐槽证明每次减少的两个句柄就是第26节的 File/Process 配对，也不补造旧2730次映像查询31的具体原因。四个 no-close 资源失败、普通对象+5的四个历史失败、旧归属 inconclusive 和全部冻结断言保留。诊断用的有意 owner-retain 不应再被描述成无意泄漏；stock 缺少最终 Close 的调用方风险与生产修复仍须分层处理。

下一阶段先明确生产 API/adapter 候选的生命周期与失败契约，再冻结新版本诊断和独立验收矩阵，不立即把诊断 fork 接入业务。必须分别处理取消/异常、Windows builtin、正长度 JS readable-buffer 分支、并发、旧Windows版本、实际 Agent 启动链、Host/Webview 与 packaged；普通后代不独立托管，真实 Agent CLI 的启动包装程序例外不变。设计仍为“比较中/验证中”，ExecPlan仍active，业务与安装依赖未修改，不宣称生产退出完整性已修复。

### 新增诊断工具债务

本次审查另确认 `scripts/diagnostics/diagnose-windows-hpcon-owner.mjs::guarded()` 只等 `child.close`，150s timer仅发送kill而不独立结算等待。如果 driver已退出但继承的stdio仍被持有，kill不能保证在硬截止点返回。本次Windows矩阵12个driver均未命中该路径，因此不撤销其正常完成证据，也不据此虚构Windows挂起根因。

独立 Linux/Node `25.6.0` 的纯 Node 控制位于本工作树 `.debug/hpcon-guarded-budget-control-v1/`，manifest SHA256 为 `e053adf6b94787879ed8d8f08a9911b512bb422510d3ec8ece5028a991df6560`。driver在150ms预算前退出，watchdog对已退出child调用kill返回false；`close`仍比watchdog触发晚 `884.470223 ms`，总等待 `1043.413464 ms`，所有已知控制进程最终结束。这只证明 `exit`、stdio生命周期与 `close`/硬返回是不同事实，不是Windows/PTY/产品原生证据。

该债务在下一轮新版本诊断入口中优先修复并加入已退出driver、stdio仍持有的控制；独立约束返回预算与已知资源清理，超时保持失败或不确定，不能伪造EOF或用任意PID清理。原入口、旧断言、工件和本次首次结果不修改，也不通过重跑本矩阵筛选绿色。

## 31. Provider/Adapter 候选契约与下一轮诊断冻结（2026-09-21）

第30节正常自然路径的窄因果证据已转入 `docs/design-docs/runtime-execution-lifecycle-contract.md`，本阶段仅设计和冻结，不增加业务、模型或诊断脚本，不运行新的原生矩阵。新契约的业务及旧模型锚点来自运行时主分支 `0518dcc4fdbc0b233e2bb4bd1c27511aea85be88`，不代表本 main-based 独立分支已接入该改造。前30节的冻结协议、原断言及失败结果均保留，第6节仅更新当前导航。

候选将实际主体的进程结果、可信源结束、authority 应用结果、各页面读者结算和原生资源处置分开。进程结果容纳 signal-only、已由 wait 证明终止但退出码未知，以及尚未证实终止；adapter 唯一分配连续 data sequence，decoder 尾片在 sourceEnd 前移交，OutputSeal 的两个水位必须与已接受尾值一致。authority 是 Supervisor 或直接 Host 的终端事实维护者，需要真实 tracker 解析屏障，不能以 journal.flush 或现有 onExit 代证完整。正常 native 释放不依赖所有页面完成，但独立内容所有权移交仍须验证；逐项 owner 的迟到释放证据只能更新同一次操作的观察，不重复 Close、不重写历史超时或旧 seal。

读者候选在协商 `terminalReadSettlementV1` 后扩展 close outcome，以同一次服务端处理完成结算和释放；applied 到最终 revision、cancelled、服务器登记 lost 和旧 legacy-released 分开。Webview/Host/relay/client/Supervisor 每跳都校验并保留 outcome，非法值不能被静默降级；finalRevision 固定的同一串行边界关闭新 open，既有在途 open 仍计入。source、资源跟踪和读者协商能力分别判断，旧 live 绑定不迁移。生产握手、回执数量/期限及隔离容量策略仍是接入前待定项，不把选择模型候选写成已批准生产 wire。

D1 冻结24组、37个独立子案例，每例独立状态/trace：进程与源先后、signal-only、wait/状态查询失败、解码尾片、序号/身份/封口违约、取消与在途数据、authority 解析/失败、资源超时后的同操作补证、双读者和三类能力八种组合。只注入事实，不制造原生 EOF；本地 Node25.6.0 与 Electron-as-Node39.8.7 各37例，后续三平台 Node22.23.2 各37例。新入口及验证器必须独立重算全部 schedule，损坏首项仍继续；当前没有37/37通过记录。

D2 冻结八个子项各3次，每平台24条、三平台72条，其中 G06a/G06b 的18条为 synthetic，其余54条为真实进程/启动控制，全部零PTY。分别记录 exit、stdio close、deadline 与已知控制结果；t0 为 spawn 前单调时间，1000ms采集预算、截止后最多1000ms返回、外层5000ms加1000ms观测仅是诊断参数。G04由 driver 创建继承stdio的受控helper，以私有nonce回执和3000ms自限期建立前提，不按日志PID强杀；无法证明Windows Job下的存活/持有前提则标未覆盖。guard按预算返回与fixture清理分别验收，超时不伪造EOF，晚到事实不改首次结果。完整细则以新契约第8节为准。

后续先实施 D1/D2 新入口，再另冻每个平台的 partial-create、wait/通知、reader取消及正长度buffer、最终释放失败/挂起与两个并发会话的原生对照。TSFN 环境销毁时已排队payload、hShell登记前失败和Unix在途read/control-fd属于静态待验证窗口，不由正常92次TSFN成功或现有自然资源结果覆盖。builtin、旧Windows、真实Agent/Host/Webview/packaged及生产取消预算继续开放。本阶段只检查文档元数据/索引/关联路径、计划章节与历史证据不变，不关闭退出完整性和诊断硬返回债务。

三条边界只读复审已补进程类型、唯一序号、迟到补证、读者准入及各跳outcome，创建前provider/adapter/authority的sink须全部绑定或受显式start屏障保护，不能留下open返回后才订阅onData的缺口。M01在原组内覆盖同步首块/退出，D1仍37子例。主运行时树dev-session-canvas2的既有bridge、tracker、Supervisor协议聚合回归及该树.debug/lifecycle-contract-design-v1-node25的旧39项契约通过；这些不是本树新D1/D2或原生失败路径验收。下一轮workflow候选为 `.github/workflows/runtime-lifecycle-contract-v1.yml`，尚未创建。

## 32. D1/D2 本地实施与 runner 前收口（2026-09-21）

第31节的冻结输入、原断言与历史结果不变。本独立分支新增 `scripts/diagnostics/runtime-provider-lifecycle-model-v1.mjs`、`scripts/diagnostics/diagnose-runtime-provider-lifecycle-v1.mjs`、`scripts/diagnostics/diagnostic-process-guard-v2.mjs` 和 `scripts/diagnostics/diagnose-process-guard-v2.mjs`，只使用Node标准库，不修改业务、安装依赖或旧诊断入口。两个CLI支持self-test、全新目录采集和保存结果离线复核；完整schedule先落盘，源码快照/字节指纹、单调事件、实际运行环境与Git输入一起归档。离线验证不执行保存的模型，不依赖pass字段，首项损坏仍检查完整37项或24项。详细分版证据见 `docs/design-docs/runtime-execution-lifecycle-contract.md` 第11节。

D1正式本地目录 `.debug/provider-lifecycle-v1-node25-first` 和 `.debug/provider-lifecycle-v1-electron39-first` 各37/37，完整离线复核无failures或evidenceErrors。运行时分别为Node25.6.0、Electron39.8.7内嵌Node22.22.1，输入为9824f166工作区及归档源码指纹，不补造尚未创建的提交。开发自测v1保留；v2的37正例和12类负对照通过，并由harness比较M18的真实Promise引用及两个完成值，不再相信模型自报。authority使用实际deferred parser Promise，页面应用是明确标记的异步consumer callback模拟，均不等同真实xterm、Host或native EOF。

D2正式首轮 `.debug/process-guard-v2-local-first` 的24项control-pass和最长1952.568317ms返回原样保留，已用当时归档源码复核。末审发现G04/G05在deadline后协作或强制结束并收到真实管道end时仍写captureIntegrity=complete，整体采集完整性表达不足。后续只修正分类为deadline-incomplete，保留真实endObserved及error/truncated优先级，不修改冻结期限/案例，不覆盖首轮，也不追认首轮具备新增证明。

新目录 `.debug/process-guard-v2-local-v2-deadline-integrity` 在Linux/Node25.6.0完成24项控制及完整离线复核，最长1952.428426ms返回，无evidenceErrors。raw仍为9条natural-exit、3条spawn-error、12条deadline-exceeded；18条真实进程/启动控制与6条synthetic分开，全部零PTY。G04三次均证明driver退出后helper仍响应私有nonce并持有stdio，返回分别为1019.281081/1019.788213/1019.804538ms且captureIntegrity均为deadline-incomplete；协作完成回执不是helper独立OS退出wait。最终D2自测25项通过，含有效G01/G07基线、9类重算manifest后的语义篡改、首项损坏后继续检查末项，以及超时后EOF不晋升完整；此前开发自测和矩阵均保留。

独立只读复审已收口D1 Promise自证、D2 capture-error缺维度、outer自然截止宽限和deadline完整性分类，不放宽冻结协议。主运行时工作树本轮既有bridge、tracker、Supervisor协议聚合再次通过，仅作为原有回归记录。新增 `.github/workflows/runtime-lifecycle-contract-v1.yml` 在Linux/macOS/Windows固定Node22.23.2，不安装依赖、不加载PTY；D1/D2各自执行、各自复核，一组失败不跳过另一组，完整上传全部工件。本节收口时尚未推送本轮输入，没有remote运行结果。

下一步仅提交并推送独立诊断输入，执行三平台D1各37项、D2各24项，下载全部工件后按原schedule离线复核。控制正确识别失败可以通过，但不能改写raw失败、首次结果或历史结论；本地Linux与Electron模型不外推macOS/Windows。新guard没有替换旧入口的guarded等待，工具债务尚待三平台验证；partial-create、wait/通知、取消/正长度buffer、释放失败/挂起、并发、builtin、旧Windows及真实Agent/Host/Webview/packaged仍需另冻原生矩阵。生产API和预算未选定，设计比较中/验证中、计划active，退出完整性债务不关闭。

## 33. D1/D2 三平台首次结果与 Windows G07 证据边界（2026-09-21）

固定输入 `d173c099d37f83bb3178d280a6a6d8b80d984b92` 的run35620967433 attempt1在Linux/macOS/Windows均success。三平台固定Node22.23.2，每个平台完整D1 37项和D2 24项按既有verifier运行及离线复核通过，全部无failures/evidenceErrors；合计111条注入模型、72条guard控制，后者为54条真实进程/启动控制和18条synthetic，零PTY。这是原工具报告，不自动证明校验器未覆盖的前提；Windows G07的三项限制另列于本节。每平台自测另有D1 37正例/12类负对照和D2 25项，不计入主矩阵。首次本地/开发工件及历史失败均保留。

三个ZIP各1280成员，完整下载、解压及本地SHA256核对保存在主运行时树 `.debug/lifecycle-contract-35620967433/`。`offline-review-v1.json` 保存全部平台两个verifier的完整结果，以及各平台六份源码/配置快照对固定Git输入的核对；artifact为Linux10648081653、macOS10649965248、Windows10649136626。完整ZIP摘要、环境、输入和分平台时间见共享契约第12节。此次环境为Ubuntu24 x64/kernel6.17.0-1022-azure、macos26 arm64/Darwin25.6.0、Windows Server2025 x64/10.0.26100，不外推其他系统版本或架构。

每平台raw仍为9条natural-exit（含自然exit7）、3条spawn-error、12条deadline-exceeded；captureIntegrity分别12条complete、6条deadline-incomplete、6条truncated。complete包括启动失败后的空捕获通道结束，不代表进程创建成功；控制套件通过不改变这些原始结果。原始单调时钟测得最长guard返回分别为Linux1951.046799ms、macOS1980.999041ms、Windows1960.9691ms，均未超过冻结2000ms；外层最长分别2004.825633/2103.605875/2150.4447ms，未使用5000ms后的观测预算冒充自然完成。G04前提三平台均成立，但helper协作完成仍不是独立OS退出wait或原生资源释放证明。

追加Windows只读审计定位到确定的夹具根因：官方Node v22.23.2的 `deps/uv/src/win/fs.c::fs__close` 第681–684行只对fd>2调用_close，否则直接设置result=0，因此本轮fs.closeSync(1/2)没有实际关闭标准句柄。Windows G07两条stdio的end/close通知只比child-exit通知早约0.27–4ms，不是“流先关闭、主体仍活”的证明；Linux/macOS约250ms的间隔也不用于补造Windows事实。Windows G07三项前提未建立，旧success/24pass、冻结断言、源码及工件均不改写，其余69条控制依据和D1三平台模型结果保留，不否定已观测的guard有界返回，也不宣布D2整组完成。此为诊断夹具及校验器前提不足，不是Windows对象语义或产品缺陷，详细源码与原始时序证据见共享契约第13节。

下一步优先另冻Windows G07的真实stdio提前关闭及独立主体存活证明控制，使用全新输入/工件，不修改旧脚本或预算以追认通过；之后再另冻partial-create、wait/通知、取消/正长度buffer、释放失败/挂起、两个并发会话，以及unknown owner如何有界隔离的逐平台方案。不能以超时当释放，或靠未限制数量的隔离对象掩盖积累。旧入口的guarded等待没有被替换，新证据不追溯应用到旧工具或失败，也不是PTY、实际Agent/Host/Webview或生产退出完整性验收。builtin、旧Windows、真实启动链和packaged继续开放，生产API/取消预算未选定，设计比较中/验证中、计划active，业务不改。

## 34. Windows G07 真实关闭与存活补证冻结（2026-09-22）

本阶段按 `docs/design-docs/runtime-execution-lifecycle-contract.md` 第14节实施新的Windows-only前提控制，拟新增 `scripts/diagnostics/windows-stdio-close-control.c`、`scripts/diagnostics/diagnose-windows-stdio-close.mjs` 与 `.github/workflows/runtime-windows-stdio-close.yml`。不修改旧D2入口、guard-v2、原断言或72条工件；旧Windows G07三条仍为not-established，其余69条和D1模型依据保留。当前是运行前冻结与实施阶段，尚无本轮Windows原生成功或失败结论。

被测C程序就是guard直接拥有的child，不依赖启动器或后代。它先登记自身继承的stdout/stderr pipe写端，保存marker与实际WriteFile字节数，再单次执行真实标准槽位解除和CloseHandle；控制管道独立建立，不重新打开旧标准槽位、不借CRT退出清理重复关闭。父端真实EOF/close、完整内容与native关闭回执缺一不可，单看Win32调用返回或PID并不足以建立前提。

在上述证据齐备后，父端才生成新的私有challenge，要求匹配同一nonce/mode/主体身份的pong；从首个有效pong的父端单调时刻起持有至少100ms，再生成第二个不同challenge并取得响应，最后放行exit。两次pong与许可均必须在原spawn前t0+1000ms内，期间guard不能提前返回；迟到回执不能补正首次失败。控制与受测stdio分离，原始事件先落盘再异步推进握手，定时器触发后重查实际持有时间，不以回调通知顺序替代主体可执行性。

固定Node22.23.2、Windows x64/MSVC，close-wait、keep-open、close-exit各3次，共9个真实child、零PTY。close-wait应建立提前关闭后持续存活并自然exit0；keep-open须持有两路写端至deadline且不建立挑战前提；close-exit真实关闭后直接exit0、不响应挑战，也必须拒绝存活前提。原始guard结果与 `preconditionEstablished` 分开，负控按预期被拒绝不升级为自然成功，任意启动/控制错误也不算预定负控成立。Linux本地只做工具逻辑及合成自测，不计Windows样本，旧D1/Linux/macOS矩阵不重复。

预算继续为1000ms工作截止、总2000ms返回上限、1950ms最终结算起点，外层独立5000ms截止加1000ms观测，fixture3000ms自限；不改guard源码或扩大等待。完整schedule预先保存，保留编译日志、实际EXE及全部输入指纹、原始字节、控制消息、guard/outer trace和首次结果，逐项失败仍遍历全部九项。编译失败单列九项not-run及实际创建数零；离线校验从原始身份/时序/字节/预算重算，并与固定commit/源码交叉复核，不执行归档代码或只信pass。具体wire和自测负例以契约第14节为准。

首次Windows运行及完整ZIP离线复核后，才判断新前提是否成立；新正例即使通过，也不追认旧G07或宣称生产修复。后续逐平台partial-create、wait/通知、取消/正缓冲、release失败/挂起、并发和unknown owner有界隔离仍待另冻。旧guarded入口移交、builtin、旧Windows、真实Agent/Host/Webview/packaged与生产API/预算继续开放；设计比较中/验证中，ExecPlan active，退出完整性债务不关闭。

## 35. Windows G07 新九控制首次结果（2026-09-22）

固定输入 `cf35904055a840e6e5b3189eb8551beba17d7163` 的run35631266321 attempt1完成第34节矩阵，原verifier九项全部control-pass，无工件错误；实际创建9个C child，零synthetic主样本、零PTY。环境为Windows Server 2025 Datacenter x64/build10.0.26100、image win25-vs2026/20260907.229.1、Node22.23.2；MSVC19.51.36256.0以 `/W4 /WX /O2 /TC` 编译成功。实际EXE SHA256为 `a472e116c449c457d75d6ec5ba53689cb86dc08014f62d084b214c781b465dd7`。主运行时工作树 `.debug/stdio-close-35631266321/` 保存完整证据，`offline-review-v1.json` 交叉复核五份输入与固定Git commit的LF指纹、编译输入/产物及九项原始轨迹，未修改冻结guard-v2或原预算。

三次close-wait的真实双EOF/close、精确marker、native成功关闭回执均在父端新challenge之前；两个不同challenge分别收到同一直接主体的pong。首个有效pong至第二challenge的实际持有分别101.7934、101.1616、100.8252ms，满足原100ms门槛；第二次响应后才发许可并自然exit0，guard未在stdio关闭时提前返回。三keep-open保持写端至deadline，正确拒绝前提并保留 `deadline-exceeded / deadline-incomplete`；三close-exit真实关闭后自然exit0但无pong，也正确拒绝存活前提，raw仍为自然完成。正例3条、拒绝控制6条分账，不能把九项控制通过写成九项前提成立。

独立原始审计 `independent-native-audit-v1.json` 的836项检查与九条预定控制均通过，SHA256为 `133b9fc9ed673cf23637837517e1b140e56266daed4a3af701545eeb9c80a20f`。close-exit-3双流close最晚20.7513ms、challenge21.1521ms、观察控制通道不可用21.4268ms、child-exit通知21.7708ms，仍未出现pong；此负控直接支持“不从通知顺序推断主体可执行”。全组guard-returned事件最大1011.7495ms，调用方await后观察最大1012.3385ms，九项均在冻结2000ms内。outer-returned事件最大1112.4939ms，controller已退出/两流已close且未命中5000ms，但事件后仍写盘再resolve，没有外层await后记录，不能将其当完整外层返回预算证明。补充计时在timing-observation-audit-v1.json，原审计不改，工具观察缺口由下一新入口承接；keep-open仍不完整。

本增量仅补足新Windows样本的真实关闭后存活前提及新oracle负控，旧72pass、旧Windows G07三条not-established、D1模型结论与全部历史失败均原样保留。不以此证明PTY资源释放、实际Agent/Host/Webview或生产退出完整性，也不把Windows正常对象引用语义叫作系统缺陷。下一阶段冻结原生partial-create、wait/通知、取消/正长度buffer、release失败/挂起、并发和unknown owner有界隔离的设计与矩阵；旧guarded移交、builtin、旧Windows、packaged和生产API/预算继续开放，退出完整性债务不关闭。

## 36. 原生失败与资源隔离第一批设计冻结（2026-09-22）

本轮输入锚点为主运行时树f318579a、独立诊断树7fb4ae9e。新增 `docs/design-docs/runtime-native-failure-isolation.md`，状态比较中/未验证；当前只冻结源码依据、故障层级、owner台账、准入与隔离候选及第一批协议，没有新增工具、workflow或原生结果。旧D1/D2/G07、PTY矩阵及全部失败不改，不把诊断fork当生产实现。

真实API受控输入失败、跳过native调用的合成替身、真实调用后的通知扣留、调用前gate与有限模型分别计账。资源取得后立即登记，释放只接受自身owner的单次操作；同operation迟到证据只能追加，不能改首报、重复Close或追认旧EOF。有限策略固定N=2总槽/Q=1未知熔断，已准入的A/B仍可同时unknown；封禁新建不保护共享native进程免于卡死/崩溃，独立进程必须在创建前布局，生产拓扑尚未选定。

第一步D3三平台各24项，共72个零PTY进程控制场景，独立验证实际after-await、进程结算和writer封存；D4三平台各8项，共24个零native准入模型。先新增独立工具、完成本地校验和首次三平台运行/完整工件复核，再进入W1/U1。resolve前事件不能替代调用方续体，同步落盘和CI超时也不属于等待API返回证明；预算详见新设计，不追溯改旧guard。

第二步W1 Windows八项各三次共24、U1 Linux六项各三次共18、macOS八项各三次共24，共66个driver尝试，并非66个成功PTY。第一批覆盖创建后的部分初始化、wait事实分离、Unix合成通知拒绝与释放回执延迟；原生调用是否实际进入、取得哪些资源、实际执行主体数量、前提不足和not-run均独立统计。尚未运行时不能因矩阵已冻结而宣布这些错误路径安全。

其余通知/环境销毁、正长度已读缓冲取消、在途waiter/control fd、真正Close挂起和双会话仍属未冻结第二批，继续阻塞生产接入。builtin、其他Windows版本、实际Agent启动链、VS Code/Electron、Host/Webview/packaged、生产容量/停止预算及旧guarded移交仍开放。下一阶段只实施D3/D4，不改业务、依赖、旧live绑定或旧实验；原生候选总体比较中/验证中，ExecPlan active，退出完整性债务未关闭。

## 37. D3/D4 v1 工具实施与本地有限结果（历史阶段，2026-09-22）

独立诊断树已实现 `diagnostic-observation-envelope-v1.mjs`、`diagnose-observation-envelope-v1.mjs`、`runtime-owner-quarantine-model-v1.mjs`、`diagnose-owner-quarantine-v1.mjs` 及 foundation workflow。当前工作树本地证据目录为 `.debug/runtime-native-failure-foundation-v2-d3/` 和 `.debug/runtime-native-failure-foundation-v2-d4/`：D3完整schedule 24/24 verified，D4按linux/darwin/win32各8项共24/24 control-pass；另有独立self-test目录，其中D3 positive/tampered和D4 manifest已通过本地复核。D3是Node caller/writer进程控制，D4是N=2/Q=1有限模型，均不创建PTY或native resource；`nativeProcesses=0`只表示本阶段没有native进程。

foundation workflow固定Node22.23.2并配置完整schedule及self-test目录上传；本节是runner前记录，上述本地目录当时使用未提交工作树快照，随后v1冻结为7141cfa3。目录中的v2是v1工具的第二版本地证据，不是第39节新增v2入口。后续runner见第38节，W1/U1未实施；旧D1/D2/G07、历史失败与Windows正常对象引用语义不改判。

本地结果不关闭D3冻结契约：`startObservedCase(spec)`尚未导出；`observeCaller()`以单一child close Promise收口，caller、processSettlement和writer/evidence仍串行；没有迟到after-await不可变首次快照，v1 caller帧身份/序号由observer重包。强制处置请求、实际退出和stdio close未完全分层，evidence sealed为编排字段而非独立结算；D4独立重放/完整身份也未闭合。24/24只是有限trace/manifest工具结果，当前仅按第39节窄修来源/顺序，不改业务、生产拓扑或旧工件。

## 38. Foundation v1 两次 runner 与跨 pipe 误判（2026-09-22）

输入7141cfa3的首次run `35673511893` attempt1与误触同SHA重复run `35673550930`均为failure。两次完整D3均为Linux/macOS各24/24、Windows23/24，仅Windows D3-01-1跨pipe误判；v1把stdout/fd3到达次序重包成source序号，不能代表caller因果。这是跨平台均需防范的诊断oracle缺陷，不是Windows系统或产品bug。D4每runner执行三组逻辑标签共24项，每run72次、两run144次模型按原verifier通过，均零native PTY；D4没有pty:false字段，实际记录native:false/nativeProcesses:0。

首次Windows自测positive23/24，重复21/24；重复新增D3-07-1/08-1接收504.2253/543.014ms，超过固定缩放500ms，是独立真实迟到，不由source排序修正。重复自测还见三次writer结算554.9569/630.9223/608.3949ms超500ms，原verifier未全部检查，单列预算债务。Windows两次自测在positive失败后未生成最终self-test报告或tampered负例，保留已有轨迹/日志，不补造缺失工件。

首次artifact Linux/macOS/Windows为10672290231/10671559820/10672340270，目录是独立诊断树 `.debug/github-foundation-35673511893-{ubuntu,macos,windows}/`，不是主树；重复artifact为10671619890/10671953122/10672690041。六ZIP总3,853,782字节/3022成员，size/digest均与API一致，36份输入与固定7141cfa3字节对账，Windows仅CRLF差异；只执行可信Git输入生成的验证器，不执行归档代码。完整获取/审计在本树 `.debug/foundation-first-two-audit/`，summary SHA256为 `eb5d8e91ffe23ffa03ff43384d1d52c46ab0798a05a0adc644084a2a7d9081d5`，audit SHA256为 `b1de5345391c816f11a47b4143afa65b5da8d826463f76d5883f559f59b1d5c1`。两run原failure、原断言及工件均冻结，不用重复执行筛绿。

## 39. D3 v2 来源与顺序窄修正（运行前协议，2026-09-22）

新增D3 v2两个入口和专用oracle自测，不改v1或D4；具体为 `scripts/diagnostics/diagnostic-observation-envelope-v2.mjs`、`scripts/diagnostics/diagnose-observation-envelope-v2.mjs`、`scripts/diagnostics/observation-envelope-v2-oracle-test.mjs`。caller源帧携带全局sequence和完整identity，observer记录真实通道及有限非负接收时间；after-await仅fd3，同pipe序号递增而跨pipe到达任意，及时性按接收时间判断。完整编码帧和分片解析限4096字节，错误协议必须失败；连续源序缺口只允许D3-08明确bulk区段，且必须observer确认after-await、caller收到ACK后才发bulk。正式边界与负例见 `runtime-native-failure-isolation.md` 第15节。

新workflow `.github/workflows/runtime-observation-envelope-v2.yml` 仅固定Node22.23.2三平台D3 v2，运行语法、确定性oracle/parser、缩放自测、完整24项及离线复核并完整上传，不重复D4模型。自测保持原0.25缩放/500ms预算，不能扩大以掩盖重复Windows真实迟到。本地证据见第40节；三独立settlement、deadline不可变首次观察、bounded unconfirmed、writer预算及独立evidence结算、D4完整重放/identity仍未闭合，W1/U1未开始。

## 40. D3 v2 Linux 本地窄验证（2026-09-22）

独立诊断树Linux Node22.23.2的新目录 `.debug/observation-envelope-v2-local-1-selftest/` 完成oracle78/78、parser8/8、positive24/24及篡改拒绝；`.debug/observation-envelope-v2-local-1-full/` 未缩放24/24 verified，三脚本语法通过并保存源码hash。D3-08记录observer receipt/ACK发送与首bulk，caller收到匹配ACK的前提来自源码await控制流，不冒称另有caller ACK接收事件。首次overflow锁定后续bulk拒绝，以维持唯一缺序区段。

输入是未提交工作树源码快照，不是可绑定新commit的运行；v2三平台runner仍待一次新提交触发及完整下载审计。本地通过只补来源/顺序oracle，不改v1两次失败、自测真实迟到、旧工件或完整契约阻塞项，不交付native/生产退出完整性。

随后独立复核发现local-1 tamper自测只证实总失败与首项错误：根manifest提前失败使run.scale未赋值，实际attempted24/verified0，不是其余23项有效复核。local-1 positive/full24通过和原工件均保留。新修正分开根manifest错误与run读取，強制篡改报告attempted24/verified23及末项无错误并保存tampered-verification.json；新 `.debug/observation-envelope-v2-local-2-selftest/` 完成oracle78/parser8/positive24，篡改报告24/23且仅shared-manifest与D3-01-1错误；`.debug/observation-envelope-v2-local-2-full/` 未缩放24/24 verified且无evidenceErrors，最终CLI语法/diff检查通过。新目录仍为未提交工作树输入，三平台runner待验，不重写local-1。完整writer协议中非法帧可能被sealed掩盖的风险继续归入evidence/settlement债务，不扩此次窄实现。

## 41. D3 v2 首次三平台验证与后续门槛（2026-09-22）

b4db41cc的唯一push run35676427931 attempt1已完成三平台及全量独立复核。Node22.23.2/Ubuntu24 x64、macOS26 arm64、Windows Server2025 x64各full24/24、scaled positive24/24、oracle78/78、parser8/8；tamper各attempted24/verified23，只拒坏首项及共享manifest。Windows full D3-01-1再次出现跨pipe接收倒序，source序合法且按v2正确接受；本次合法迟到分类、ACK后bulk及控制帧保留有确定性重放和实际trace分层支持。

完整归档 `.debug/observation-envelope-v2-run-35676427931/` 含三ZIP各453文件、API与15输入Git对账、可信固定源复核和原始时序；Windows五输入仅CRLF差异。audit SHA256为 `a772fa2a399c9b51fe109b56fff097933e9873fa0c424aab93f18717c13233f7`。本次after-await/writer原始时间未超各自完整2000ms/缩放500ms预算，不代表预算检查和独立结算已经实现；详细数值及artifact见原生失败设计第17节。

不改v1两个failure或local-1自测缺口，不重跑筛绿。此次只有Node控制和合成oracle，PTY/D4/W1/U1零新增；三settlement、首次deadline快照、有界unconfirmed、writer完整协议/封存和D4身份重放仍阻塞W1/U1及生产接入。下一阶段先冻结并实现这些诊断契约，不直接修改业务或选定server拓扑，总计划继续active。

## 42. 下一版诊断结算设计冻结（2026-09-22）

新设计 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 以诊断树e1a31b79、运行时树a5f8d629为输入，冻结D3 v3与D4 v2的下一版契约，状态比较中/未验证。本阶段仅源码、协议与设计复审，零新增测试、零新增native运行；旧D3 v1/v2、D4 v1、workflow、工件和历史失败全部不改。三侧静态复审、跨文档及历史保持检查已通过；只收口设计，不代表实现或新矩阵通过。

D3 v3同步返回handle，observation、processSettlement、evidenceSettlement各自首次结算；绝对deadline先于等时/迟到事件，首报不可变，迟到事实追加。exit与捕获真实EOF分开，capture gate保留尾部；直接owner有界控制、未确认责任继续占账，不能以kill/close当释放。D3每case最多预留caller/evidence/publisher三个槽，任一hard截止仍unknown即停止后续case；这不是D4模型的N2容量。writer、独立verifier与最终publisher分责，协议错误不可被合法claim清除，受测证据结算、发布与可信离线归档验证分别判断；这些是诊断候选，不是生产进程布局或退出时间政策。

D4 v2固定N2/Q1，完整command/return/event/snapshot由不共用SUT转换函数的oracle逐步重放。创建acquisition、use token、整体release操作、首次unknown、当前证明与槽位分账；失败不抹已取得资源，错身份拒绝零副作用，旧代同操作迟到补证不得污染新owner，完整责任结算后仍显式reopen。failureDomain只是模型标签，不提供真实故障隔离证明。

运行前计划为每runner D3 v3主控36项、因果gate2项、publisher4项，D4 v2确定性模型16项，分别计数；三runner对应108/6/12/48，均尚未实施执行，不相加作PTY或产品通过数。下一步仅在独立诊断树新增版本入口，先本地实施、fixture清单/源码hash冻结与独立源码复审，再唯一一次固定输入三平台采集及全工件可信重放。主运行时树只同步文档，不推送；W1/U1和完整生产退出交付继续阻塞。

## 43. 新诊断本地实施与审计边界（2026-09-22）

本阶段已进入独立诊断树的八个新版本入口实施与本地审计，完整记录见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节（比较中/验证中）。主运行时只同步文档；本阶段不运行D3真实36+2+4、不新增runner、不推送任何分支，不改业务、依赖、旧实验/工件或image.png。上一节“均未实施”的表述只描述设计冻结时点，不覆盖当前进展。

D4 v2的local-3 self-test/full及各自离线复核均16/16、302命令、58次预期拒绝、1924 checks；93语义负例、4 saved负例和另存7个重hash sidecar负例分开计数。unknown key拼接碰撞的初次失败保留，修订为JSON tuple并在固定第05项回归；早期绿色没有覆盖负例sidecar独立绑定的缺口也已记录。证据、精确源hash及不含native/PTY/真实并发的边界见该契约，不把本地模型计为三平台或产品验收。

D3最终本地self-test-2通过119 oracle、41 core、15文件、25 archive/consumer/binding fixtures；saved复核4/4、88 manifest members及四源原字节均匹配，但boundedConsumerDelivery=false、acceptanceReady=false，真实进程/native/PTY均未运行。首轮76/29/15及saved3/3保留为历史覆盖；cross-replay-1因oracle多算stdin JSON换行字节而误拒，修订移除该额外字节，core仍以stdin EOF分隔。迟到错误回溯首报、owner/unknown/event/scenario漏验和归档绑定已本地修正，首次失败不改判。到期才冻结的首报记录真实消费者延迟并标delivery-budget-unresolved，独立消费验收预算及六组逐fixture对账仍开放，不修改原deadline或暗加宽限；symlink负例归档须保留link元数据。

下一步仍补齐冻结覆盖和独立审查，之后才另行确认真实D3与三平台采集。W1/U1、原生第二批、真实Agent启动链/双会话/Host/Webview/packaged、生产API/停止预算及整体退出完整性均未完成；不把正常Windows已退出对象引用升级为OS bug。
