---
title: 执行会话退出完整性交付
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity.md
updated_at: 2026-09-20
---

# 执行会话退出完整性交付

## 1. 已确认范围与决策状态

2026-09-20，用户同意将“退出完整性”作为本次 Runtime Persistence 重构的独立交付项。它与 F-04 容量优化、F-05 取消 completed 内联分别验收；不能等其他重构完成后假定问题自然消失，也不必等待整体终端状态替代或 F-03 root 归属改造才能推进。

已确认的是交付目标、范围和正确性门槛，未选定具体 reader、依赖版本、native adapter 或消息 API。立项后进入隔离候选验证，本文状态为 `比较中 / 验证中`；局部实验不代表业务已修复或生产方案已选定。沿用“不直接修改业务代码”的边界，本阶段只增加诊断与设计，后续业务实施另行推进。

完成重构时若该项仍有未收口缺陷或原生平台验证缺口，就不能把本次重构的退出完整性宣布为完成；允许说明其他独立增量的已完成结果。任何支持范围缩减或发布例外必须显式记录并由用户确认，不能把未实测自动解释为不在范围。

## 2. 问题与证据基础

`docs/design-docs/runtime-terminal-tail-diagnosis.md` 确认 Linux PTY 过早 EOF，原始 onData 已缺字节。`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md` 又区分 Unix 200 ms 强制关闭、Windows 默认 ConPTY 1000 ms 静默关闭及公共业务的退出假设。Linux 有真实自然/受控证据；Windows 有实际 JS/reader 夹具证据，但没有原生 ConPTY 实测；macOS 有源码边界核查但尚无原生证据。不能把三种证据级别混为全平台复现。

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 直接转发 node-pty onExit，却假定输出已完整排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` / `finalizeSession()` 在 exit 后封闭新事件，只收敛已接受操作；`src/panel/CanvasPanelManager.ts` 的 local Agent/Terminal finalize 同样取消输出监听。公共队列尚未发现丢失退出前已接受数据，但它无法补回未进入回调的字节。分页与 final revision 也不能证明源完整性。

## 3. 交付契约

以下是已确认目标，不是对当前实现已满足的描述。

| 边界 | 必须满足的结果 |
| --- | --- |
| 自然终止，包括 exit code 0 和非零 | 对于未被用户取消的当前消费者，已成功写入终端的输出必须按序完成交付与显示，不能缺尾、重复或破坏字符/终端控制序列。命令执行成功与输出交付完整是两个独立判断。 |
| 进程退出、源输出终止、消费者应用完成 | 分别证明；不能以 waitpid、exit code、socket close、静默时长或 final revision 单独替代全部证明。源 EOF 自身也必须可信。 |
| 主进程退出但后代仍持有输出 | 不因主进程先退就宣布完整排空；需明确终端会话的输出所有者和结束边界。不得无限挂起，也不得以固定等待后丢弃作为正常成功。具体取消/期限策略待方案阶段选定。 |
| 正常停止与强制停止 | stop 请求不等于输出已结束。可完成正常排空时继续交付；若确实强制切断，必须可辨认地表达取消/中断及完整性未知或截断，不能标成已完整交付。不得仅为通过验收把所有正常退出改标为中断。 |
| 显式删除、页面关闭或读者失效 | 按已有取消语义释放对应消费者和资源，不无限等待被取消者。一个读者取消不得截断其他仍有效的读者；删除语义不能被伪装成自然排空。 |
| Runtime 结束后的重开 | 仍只恢复轻量节点和退出结果，不恢复原进程、不保留终端正文；当前读者的收尾不能重新变成长久归档。 |
| Supervisor 崩溃或机器重启 | 仍不要求恢复进程和历史。本交付不新增灾备服务，也不把这些例外扩大为正常运行可丢尾部。 |

覆盖 Agent 与 Terminal、`live-runtime` 与 `snapshot-only`，以及 Linux、macOS、Windows 的实际受支持执行路径；Remote SSH 按实际执行端平台验收。只扩展 snapshot-only 的退出完整性验收，不改变其既有持久化/关闭产品边界。原始 PTY 内容经 Windows ConPTY 的 VT 转换时应校验终端语义和编号内容，不能误用 POSIX 原始字节完全相同作为跨平台唯一门槛。

保证从程序成功写入终端的数据开始，不包含程序自身尚未 flush、未写入 PTY 的应用缓冲；程序自己输出的不完整 UTF-8 或控制序列按既定解码和终端语义处理，不要求补造或修复生产者内容。分片测试应同时记录实际写入边界与预期终端结果，区分生产者本身的内容与读取截断。

## 4. 实施边界与候选

源读取边界由 `executionSessionBridge.ts` 及其 node-pty/native provider 接入负责。候选包括可验证的上游读取修正、维护受控 adapter 或替换局部 provider；需要比较平台覆盖、VS Code/Electron 实际可用性、native 打包成本、解码和取消行为后选定。现有 Linux 私有 fd 同步补读只用于诊断，不是获批的生产实现；不能因某 libuv tag 有一个修正就宣称 Unix/Windows 的其他关闭机制也被解决。

生命周期契约需贯穿 Supervisor 与 Host local PTY，必要时同步 `common/runtimeSupervisorProtocol.ts`、`common/protocol.ts` 及 Webview 终态投影。可比较由 adapter 聚合可信最终事件和显式分离过程事件两种路线；`drained`、`interrupted` 等仅是本文解释用语，字段、枚举、文案和 API 均未选定。仅重命名 EOF/exit、增加等待或删除 admission guard 不能代替源完整性证明。

旧 live session 继续其原 Supervisor/backend/storage/session/generation 绑定，不改地址冒充迁移，不为修复强制重启旧进程。新 Host 连接旧实现时不能补造“已经可靠排空”的能力；按已知能力降级并可辨认地保留完整性限制。新旧协议和结束原因如何协商需在实现前明确，不能无条件向旧客户端发送它无法解释的新契约，也不因当前诊断自动取消所有兼容路径。

退出完整性不得让容量重构倒退为全量聚合、无限内存/无限等待，或者让当前输入长期阻塞。所选 reader 的批次、退出等待/取消上限、日志与读者保留预算，在方案选定时给出数值和失败语义；本次范围确认不预设数值，更不接受用截断正常输出满足预算。

## 5. 验收门槛

| 场景组 | 必需证据与通过条件 |
| --- | --- |
| 严格大输出自然退出 | 保留 100000 scrollback、90000 行及逐行内容断言，覆盖零/非零退出。写入完成凭证、源回调、bridge、journal/状态、分页及实际终端投影对账，不能只检查末 marker 或 revision。 |
| 各平台已知关闭机制 | Linux HUP/partial read、Unix 有缓冲时关闭、Windows builtin/DLL 与 worker/pipe 关闭分别验证。已复现缺陷路径须提供旧实现缺失/候选消除缺失的对照；尚未复现或作为对照的路径仍按冻结矩阵验证完整性并保留未复现结论，不要求人为制造旧版本失败。未经原生验证的夹具只作为局部证据。 |
| 分片与持续交付 | UTF-8 跨 chunk、ANSI/OSC 尾片、慢消费/背压、大输出、后代持有输出时均不静默缺失；合法的终端转换按语义对照。 |
| 生命周期与多读者 | stop、强制停止、delete、读者取消、退出期间 Host/Webview 生命周期变化及多个既有读者，分别验证排空/中断/取消，不串会话、不重复终态、不误删其他来源。 |
| 新旧版本共存 | 新会话使用所选已验证路径，旧会话原绑定继续可控；旧实现缺少证明时明确限制，不宣称被新 Host 修复，也不覆盖或迁移旧 live 进程。 |
| 原生平台与模式 | Linux/macOS/Windows 各自在实际 Node 和实际 VS Code/Electron 上验证 Agent/Terminal 的两种模式。真实 provider 的最小退出场景与确定性 fake-provider 压力证据分开报告；缺 runner 的格子保持未完成。 |
| 回收与非目标 | 完整交付或显式取消后收敛读者/进程/句柄；Runtime 重开仍无正文、不自动执行；不新增 completed 归档或跨机器故障恢复承诺。 |

重复轮次、并发负载、版本清单和性能/等待预算须在候选实验前登记并冻结，保留所有首次失败，禁止运行到成功后只报告成功样本。单元/契约、真实原生 PTY、真实宿主与 packaged smoke 是不同层级的证据，最终交付需要对应层级齐全。既有诊断脚本的 exit 0 只表示特征断言成立，包含预期失败反例，不可充当修复验收。

## 6. 下一步与状态

执行入口为 `docs/exec-plans/active/runtime-exit-integrity.md`。第 7–8 节记录冻结后的 Linux 隔离实验，第 9–11 节给出候选、生命周期契约提案与平台缺口。下一步仍需补原生平台和上游/自维护方案对照，再选定生产 reader 与接口；不能把局部 Linux 通过当作整个里程碑一完成。实现与产品验收仍未勾选。

## 7. 第一轮候选实验协议（运行前冻结）

2026-09-20，基于 `a5112fb5` 开始方案验证。只新增独立诊断，不更改 `extensions/`、安装依赖、锁文件或现有测试。比较 node-pty 原 reader 与直接使用同一 native fork 创建全新 PTY、独占 master fd 的异步读取候选。候选用单次 `fs.read` 获取数据，遇 EAGAIN 继续等待，Linux 的 read 0/EIO 才结束；不接管已有会话 fd，也不在原 reader 旁边补读。直接使用 native 内部接口和轮询调度仅用于可行性实验，不是已选定的生产 adapter。

冻结参数：每组 3 轮，单会话串行；每次最多读 64 KiB、至多一个在途 read，连续有数据时让步到下一事件循环，EAGAIN 等待 2 ms；原进程退出后仍无源终止的实验取消上限为 1000 ms，单轮采集上限 30 s。触及上限必须记为中断/采集失败，不记为排空。定时参数只是候选实验条件，不改变产品期限。记录事件循环延迟与耗时，不据此宣称生产公平性预算已完成。

固定案例为：90000 行自然 exit 0、90000 行自然 exit 7、90000 行在第 89800 行附近暂停读取 350 ms、分片 UTF-8/ANSI/OSC 尾部、父进程退出后后代延迟 350 ms 输出、后代保持 slave 1500 ms 触发明确取消、收到 TERM 后输出尾部并退出。每轮保存完整内容/哈希、写入完成凭证、native exit、源终止原因、销毁和资源回收记录。候选的前五项及 TERM 项必须内容精确，保持 slave 项必须显式取消；原 reader 保留全部失败，不能重跑筛选。

本轮版本固定 Linux x64、node-pty `1.2.0-beta.12`，分别运行 Node `25.6.0` / libuv `1.51.0` 与缓存 VS Code `1.117.0` 的 Electron `39.8.7` / Node `22.22.1` / libuv `1.51.0`。两 reader × 7 案例 × 3 轮 × 2 可执行文件，共 84 个样本。Electron-as-Node 不是完整 VS Code UI 验收；macOS/Windows 原生、Remote SSH、真实 Agent、packaged、多会话和消费者完成契约本轮不冒充覆盖，后续仍须按第 5 节验证。

## 8. 第一轮实验结果与限制

独立工具为 `scripts/diagnostics/compare-runtime-exit-readers.mjs`。2026-09-20 完整执行 84 个样本，没有筛选重跑；每个运行时均有原 reader 21 项和候选 21 项。候选每组为 18 次内容完整且 writer receipt 为 `complete:0`、最终真实 read 返回 EIO，以及 3 次明确的 `exit-deadline` 取消。后者虽然符合实验预期，不能计为自然排空。

| 场景 | Node 25 原 reader / 候选 | Electron 39 原 reader / 候选 |
| --- | --- | --- |
| 自然 exit 0 / exit 7，各 90000 行 | 6/6 内容完整 / 6/6 内容完整 | 6/6 内容完整 / 6/6 内容完整 |
| 第 89800 行附近暂停 350 ms | 完整行数 89800、89800、89848 / 三轮均 90000 | 完整行数 89800、89800、89801 / 三轮均 90000 |
| 合法 UTF-8、ANSI、OSC 分片 | 3/3 精确 / 3/3 精确 | 3/3 精确 / 3/3 精确 |
| 父进程已退，后代 350 ms 后写尾部 | 三轮写入失败 `complete:1` / 三轮完整且 `complete:0` | 三轮写入失败 `complete:1` / 三轮完整且 `complete:0` |
| 后代保持 slave 1500 ms | 三轮约 200 ms 后普通 onExit / 三轮约 1000 ms 后明确取消 | 三轮约 200 ms 后普通 onExit / 三轮约 1000 ms 后明确取消 |
| TERM 后输出尾部并 exit 7 | 3/3 精确 / 3/3 精确 | 3/3 精确 / 3/3 精确 |

六个暂停场景的 writer 均成功，其中五个原 reader 的 destroy 栈来自 timer；Node 25 第三轮则先 socket end、后 native exit，没有触发退出 timer。该样本没有 syscall/fd 残留探测，不能仅凭症状追认为已证明的 HUP 同因。自然组本轮均完整，故没有新取得自然 HUP 的“旧失败/候选通过”对照。候选绕开 `tty.ReadStream` 的机制是源码事实，不等于所有 Linux 源问题已收口。

后代延迟输出的六个原 reader 反例是“reader 提前关闭，使后代无法再成功写入”，不同于暂停组“已成功写入后被丢失”，二者分开统计。候选的期限是显式取消策略实验，不能将 1000 ms 直接作为产品正式期限；也不能把期限足够长当作正常退出完整性的证据。

大输出精确比较 5490000 字节解码文本（90000 行，每行经 PTY 转为 CRLF），未启动交互 shell，不含提示符或输入 echo，与旧诊断的总字节数不同。哈希针对解码文本；合法 UTF-8 案例可精确比较，但未记录逐次 native write/read 边界，不承诺任意非法字节流、所有分片组合或实际 xterm 语义已验收。工具为取证保留全量 raw 内容，不是有界生产缓存实现。

资源观测只作候选成本输入：首轮 Node 25 / Electron 39 候选样本的最大事件循环 p99 为 16.712 / 12.607 ms，最大观测延迟为 20.365 / 25.133 ms；自然大输出单轮异步 read 次数分别为 15770–36082 / 7688–20802，轮询与线程池成本仍须验证。没有多会话、输入响应或生产 RSS 预算结论。每个 master 已关闭，另用 84 个样本的实际 PGID 核对，未发现残留进程组成员；不是仅凭发出 SIGKILL 声称后代已回收。

工件位于 `.debug/exit-integrity-reader-v1-node25/`、`.debug/exit-integrity-reader-v1-electron39/`。两组运行时记录的脚本 SHA256 均为 `a6ba8ca0567d28b430c674b51ab47abd8ba2f46dc81d8b63cb89cbf29c2a33b6`；原 Unix JS 为 `c3bb8dfceb9f99a5d7003041c0aff243eaa60f062538c88fc452c59ae516e74c`，native addon 为 `ab01eb7d31a5b6202e2a51339ad2cbe3f2a73e3a679e88195011e28f3160d5a7`。采集后仅补强诊断自身的注入/关闭断言、独立 32 s 清理硬截止、完整 receipt 等待和保存结果复核入口，没有改变 reader 或冻结参数。增强的验证器已重新核对原 84 个样本的内容哈希、完整性和注入条件；未用新一轮成功覆盖首轮证据。

工具加固后另按原参数完整回归 84 个样本，目录为 `.debug/exit-integrity-reader-v2-node25/`、`.debug/exit-integrity-reader-v2-electron39/`，脚本 SHA256 为 `8759c0f0034161b1e951f55c04956d2e0ce46d097b2e3c72b21246acfd9b3301`。追加组仍为候选 36 次完整读取、6 次明确取消，原 reader 六个暂停反例全部来自 timer，行数分别为 89800/89800/89800 与 89801/89800/89800；后代延迟的六次写失败也保留。两轮共 168 个实际样本，其中候选 72 次完整读取、12 次明确取消，没有候选门槛失败；保存结果复核不额外计数。回归的 `cleanup.json` 为空残留列表，最终再次核对全部 168 个 PGID 也无残留成员。所有自然对照仍完整，未由追加组取得自然 HUP 缺失对照。

## 9. 候选比较与当前建议

| 候选 | 能解决什么 | 尚缺什么 / 当前判断 |
| --- | --- | --- |
| 延长 timer 或延后 Host finalize | 改变部分竞态触发窗口 | 不修已合成 EOF，不提供 drain 证明；排除为独立完整性方案。 |
| 仅升级 node-pty npm 包 | 可能带入该包自己的关闭修正 | 不能替换实际宿主 libuv；未证明某个已发布版本解决全部 Unix/Windows 路径，不能单独选定。 |
| 上游 Node/Electron/libuv 修正 | #4997/#5165 对准 Linux HUP 读取 | 不消除 node-pty 的强制关闭；实际宿主和最低支持版本均需验证，作为对照而非完整方案。 |
| 受控 node-pty fork/adapter，独占 reader 并重做完成契约 | 保留现有启动/输入/resize，局部替换源读取与退出归并；Linux 实验支持局部可行性 | 当前优先验证候选。不是给旧 onExit 包一层；Windows native/worker/pipe 也要提供可信结束，不能只改 Unix JS。轮询原型不直接升格生产。 |
| 替换 native provider，例如 portable-pty 加 N-API 或私有 helper | 将读取与 process wait 分离，不继承 Node TTY reader 或 node-pty 的 JS timer | 需要新的原生构建/打包、线程与取消模型、Windows ConPTY 关闭顺序；保留为成本更高的对照，尚未运行。 |

`panel/runtimeHostBackend.ts` 的 `resolveSupervisorExecPath()` 默认使用 `process.execPath`，snapshot-only 也在 Host 内运行；npm lockfile 不能单独决定这些路径的 libuv。扩展仍声明 `engines.vscode: ^1.80.0`，本轮只有 1.117.0 的内置运行时证据。若方案依赖较新宿主修正，必须显式解决最低版本与 capability gate，不能只换 shell Node 或静默提高最低版本。N-API 二进制兼容也不能代替 libuv 行为验证。

Windows `useConptyDll` 只是子候选：它避开默认 native-exit 静默 timer，但 worker dispose 的强制结束路径仍存在。需要实际 OS build、builtin/DLL、native exit、pipe/worker EOF、`ClosePseudoConsole` 与持续读取的顺序证据；不能把这个开关当作全平台修复。

作为接口对照，WezTerm 固定 tag `20240203-110809-5046fc22` 的 portable-pty 0.8.1 在 [lib.rs](https://github.com/wez/wezterm/blob/20240203-110809-5046fc22/pty/src/lib.rs) 分开 `MasterPty::try_clone_reader()` 与 `Child::wait()`；[unix.rs](https://github.com/wez/wezterm/blob/20240203-110809-5046fc22/pty/src/unix.rs) 使用独立 read，Linux/Unix 的 EIO 映射 EOF；[conpty.rs](https://github.com/wez/wezterm/blob/20240203-110809-5046fc22/pty/src/win/conpty.rs) 提供 pipe reader。这支持职责分离，不证明照搬后就满足本项目的取消、尾部或进程回收契约。

## 10. 生命周期契约提案（待实现验证）

建议采用分层组合：provider 分开报告进程结果与源输出结束，共享 adapter 聚合一次最终事件，Supervisor 与 local Host 以最终事件进行收尾。不是让两处各自解释 native 时序，也不是把旧 onExit 重命名为 drained。以下语义用于冻结下一轮契约用例，字段名与 wire API 仍未选定。

三个事实独立存在：进程结果（exit code/signal）、源完整性（可信结束/中断/读取失败/旧实现未知）、每个读者的应用结果（应用到最终位置/取消/失联）。命令 exit 7 可以同时是源完整；stop 意图不直接决定源结果；若操作真的截断 reader，不能声称完整。旧实现未知也不应被误报为已确认丢失。

数据与 decoder 最后尾片必须先于源结束交付。进程结果和源结束允许任意顺序到达，只有两者均已结算后 adapter 才发一次最终事件；缺少进程结果时不能补造 exit 0。早期 process-exit 可用于停止输入或显示收尾状态，但不能封闭输出 admission。发生读取错误/强制取消时，明确记录原因并按所有权结束进程，不无限等待失效回调；终态后再来 data 视为 provider 违约，不能默默追加到已发布的 final revision。

Supervisor/local Host 在 adapter 最终事件后才封闭 admission，先收敛已接受操作及终端解析，再固定 final revision。源终态不必等待每个页面；已有页面分别应用到 final revision 后完成，或以取消/失联释放。临时来源退役等待所有既有读者结算，而不是把一个读者关闭当作全体已应用。

本轮新核实的协议缺口：`common/runtimeSupervisorProtocol.ts` 的 `RuntimeSupervisorCloseTerminalReadParams` 只有身份，`webview/terminalPagedProjection.ts` 的 `stop()` 和 `finishExit()` 都调用同一个 close，`panel/runtimeTerminalReadRelay.ts` 的 `close()` 仅释放 binding。因此当前 close 不能区分“已应用完”与“页面取消”；这不是新证明的一次丢数据，但无法用该消息自证消费者完成。候选需要明确应用凭证包含 final revision 及 session/authority/read 身份，或等价的独立确认；本轮不直接选定扩展 close 还是新增 ACK。旧 close 只表示释放、未证明应用。

协议能力与实际 session/provider 的完整性能力也要分开。新 Host 接旧 Supervisor 保留原绑定并标记证据未知；旧 Host 接新 Supervisor 沿用可理解的旧字段，新结构必须 opt-in 或证明可忽略。最终读者确认要校验身份和最终位置，重复消息幂等，不能接受旧 generation 的迟到确认；无读者时不要求创建新页面来完成验收。

下一轮确定性契约用例固定覆盖：数据→进程退出→数据→源结束，源结束→进程退出，空输出/非零退出，重复退出/重复结束，结束后 data，解码尾片，stop 后正常排空，读取失败/强制取消/旧实现未知；消费者覆盖 final target 先于尾页、应用中退出、一完成一取消的双读者、在途 open 与旧身份迟到消息。这些用例必须在共享 adapter、Supervisor 和 local Host 接入时分别验证；当前仅完成调用路径核查，没有已实现的契约测试通过记录。

## 11. 平台矩阵与尚未收口项

| 执行环境 | 本轮证据 | 后续必须补齐 |
| --- | --- | --- |
| Linux x64，Node 25.6.0 / Electron-as-Node 39.8.7 | 冻结的 84 项裸 PTY 候选对照 | 自然 HUP 旧失败/新通过对照、正式 reader、公平性/并发、实际 Host 两种模式、真实 provider 和 packaged。 |
| Linux Remote SSH | 无本轮候选实测 | 记录实际执行端版本，不用本地 Electron 代替远程 extension host；验证断连与当前读者结算。 |
| macOS 原生 | 仍只有既有源码核查 | 取得 runner 后、运行前冻结 OS/架构/VS Code/Node 版本；验证 slave close、后代、正常 read 终止与取消回收，不外推 Linux EIO。 |
| Windows 原生 | 仍只有既有 Windows JS/reader 夹具 | 取得 runner 后、运行前冻结 OS build/架构/宿主版本与 builtin/DLL；验证真实 ConPTY、worker drain、关闭死锁及停止路径。 |
| 声明支持的宿主范围 | `^1.80.0` 仍未改变 | 选型时明确最低支持宿主与代表性矩阵；在验证前不能将 1.117.0 的结果泛化到全部支持版本。 |

里程碑一还未结束：生产 reader、后代期限、资源/输入预算、原生 Windows/macOS 和具体 wire API 尚未选定或验证。当前实验可以支持继续投入受控 adapter 候选，不能据此直接修改业务、去掉旧兼容、宣布全平台已修复或关闭退出完整性债务。
