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

同日用户进一步澄清：管理对象是 Terminal / Agent 执行会话及其终端资源，不是每个后代进程；实际主进程退出后，不默认继续维持节点或终端以等待普通后代结束或接收未来输出。第 3、5 节已按此更新，第 18 节记录证据重分类与阻塞判断；此前冻结实验和失败结果不变。启动器下的实际 Agent CLI 仍是执行主体，不能按普通工具后代排除。

完成重构时若该项仍有未收口缺陷或原生平台验证缺口，就不能把本次重构的退出完整性宣布为完成；允许说明其他独立增量的已完成结果。任何支持范围缩减或发布例外必须显式记录并由用户确认，不能把未实测自动解释为不在范围。

## 2. 问题与证据基础

`docs/design-docs/runtime-terminal-tail-diagnosis.md` 确认 Linux PTY 过早 EOF，原始 onData 已缺字节。`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md` 又区分 Unix 200 ms 强制关闭、Windows 默认 ConPTY 1000 ms 静默关闭及公共业务的退出假设。该轮 Windows 为实际 JS/reader 夹具、macOS 为源码核查。随后 PR #294 的三平台最小原生基线补充见第 12 节；它没有重现或消除所有上述机制，不能将不同证据层级混为全平台修复。

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 直接转发 node-pty onExit，却假定输出已完整排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` / `finalizeSession()` 在 exit 后封闭新事件，只收敛已接受操作；`src/panel/CanvasPanelManager.ts` 的 local Agent/Terminal finalize 同样取消输出监听。公共队列尚未发现丢失退出前已接受数据，但它无法补回未进入回调的字节。分页与 final revision 也不能证明源完整性。

## 3. 交付契约

以下是已确认目标，不是对当前实现已满足的描述。

| 边界 | 必须满足的结果 |
| --- | --- |
| 自然终止，包括 exit code 0 和非零 | 对于未被用户取消的当前消费者，主进程已成功写入终端的尾部必须按序完成交付与显示，自身已接收、排队或消费中的内容不能因提前清理而丢弃；不能缺尾、重复或破坏字符/终端控制序列。命令执行成功与输出交付完整是两个独立判断。 |
| 进程退出、源输出终止、消费者应用完成 | 分别证明；不能以 waitpid、exit code、socket close、静默时长或 final revision 单独替代全部证明。源 EOF 自身也必须可信。 |
| 主进程仍运行时的后代输出 | 同一终端收到的输出正常处理，不能因来自后代而忽略；不要求逐个托管或追踪这些进程。 |
| 实际主进程退出后的普通后代 | 不默认承诺保持节点或终端、等待后代结束或接收未来输出。保留尾部收尾义务；真实输出结束与主动取消分别记录，超时/截断不能伪装成完整 EOF。具体收尾边界、取消条件和预算待设计确认。 |
| 启动包装程序下的实际 Agent CLI | 实际 CLI 是执行主体，不是可排除的工具后代。启动链必须正确代表其生命周期，包装程序退出是否表示 Agent 结束须单独验证。 |
| 正常停止与强制停止 | stop 请求不等于输出已结束。可完成正常排空时继续交付；若确实强制切断，必须可辨认地表达取消/中断及完整性未知或截断，不能标成已完整交付。不得仅为通过验收把所有正常退出改标为中断。 |
| 显式删除、页面关闭或读者失效 | 按已有取消语义释放对应消费者和资源，不无限等待被取消者。一个读者取消不得截断其他仍有效的读者；删除语义不能被伪装成自然排空。 |
| Runtime 结束后的重开 | 仍只恢复轻量节点和退出结果，不恢复原进程、不保留终端正文；当前读者的收尾不能重新变成长久归档。 |
| Supervisor 崩溃或机器重启 | 仍不要求恢复进程和历史。本交付不新增灾备服务，也不把这些例外扩大为正常运行可丢尾部。 |

覆盖 Agent 与 Terminal、`live-runtime` 与 `snapshot-only`，以及 Linux、macOS、Windows 的实际受支持执行路径；Remote SSH 按实际执行端平台验收。只扩展 snapshot-only 的退出完整性验收，不改变其既有持久化/关闭产品边界。原始 PTY 内容经 Windows ConPTY 的 VT 转换时应校验终端语义和编号内容，不能误用 POSIX 原始字节完全相同作为跨平台唯一门槛。

上述尾部保证从主进程成功写入终端的数据开始，不包含程序自身尚未 flush、未写入 PTY 的应用缓冲，也不扩展为等待主进程退出后普通后代的未来写入；已有接收和消费链路的内容仍受保护。程序自己输出的不完整 UTF-8 或控制序列按既定解码和终端语义处理，不要求补造或修复生产者内容。分片测试应同时记录实际写入边界与预期终端结果，区分生产者本身的内容与读取截断。

Terminal 内的命令、子进程与后台任务由 shell、应用程序和操作系统管理；Agent 工具命令及其后代由 Agent 管理。这不是“Terminal 有父子问题，Agent 无关”的区分。父子关系和前后台关系是不同维度，未验证交互 shell 作业控制时，不能将父进程先退出的实验后代称为后台作业。范围收窄不表示立即销毁终端，也不改变轻量节点保存或旧 live 会话绑定。

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
| 分片与持续交付 | 主进程尾部的 UTF-8 跨 chunk、ANSI/OSC、慢消费/背压与大输出均不静默缺失；同一终端在主进程仍运行时收到的后代输出正常处理。合法的终端转换按语义对照。 |
| 实际执行主体与启动链 | 对实际支持的直接 CLI、shell/cmd.exe/CLI 启动器路径，分别记录包装程序与实际 CLI 身份和退出时序，验证会话生命周期代表实际主体；受控夹具与真实 provider 证据分开。不能用通用后代实验替代。 |
| 生命周期与多读者 | stop、强制停止、delete、读者取消、退出期间 Host/Webview 生命周期变化及多个既有读者，分别验证排空/中断/取消，不串会话、不重复终态、不误删其他来源。 |
| 新旧版本共存 | 新会话使用所选已验证路径，旧会话原绑定继续可控；旧实现缺少证明时明确限制，不宣称被新 Host 修复，也不覆盖或迁移旧 live 进程。 |
| 原生平台与模式 | Linux/macOS/Windows 各自在实际 Node 和实际 VS Code/Electron 上验证 Agent/Terminal 的两种模式。真实 provider 的最小退出场景与确定性 fake-provider 压力证据分开报告；缺 runner 的格子保持未完成。 |
| 回收与非目标 | 完整交付或显式取消后释放会话拥有的 reader、worker、PTY/pipe 与句柄，验证最终终端状态；这不是托管/等待所有普通后代的要求。Runtime 重开仍无正文、不自动执行；不新增 completed 归档或跨机器故障恢复承诺。 |

重复轮次、并发负载、版本清单和性能/等待预算须在候选实验前登记并冻结，保留所有首次失败，禁止运行到成功后只报告成功样本。单元/契约、真实原生 PTY、真实宿主与 packaged smoke 是不同层级的证据，最终交付需要对应层级齐全。既有诊断脚本的 exit 0 只表示特征断言成立，包含预期失败反例，不可充当修复验收。

“实际主进程退出后普通后代延迟写入/保持 slave”单列为底层诊断，保留原门槛、失败与取消结果，不进入必须支持后代续跑的产品门槛。若诊断进一步证明主进程尾部、已接收内容、最终状态或资源释放有问题，按对应产品条目阻塞；仅未收到退出后后代未来输出不能独立阻塞。详细重评见第 18 节。

## 6. 下一步与状态

执行入口为 `docs/exec-plans/active/runtime-exit-integrity.md`。第 7–8 节记录 Linux 隔离 reader 实验，第 9–11 节给出候选与平台缺口，第 12–14 节承接 runner 和可执行收尾契约，第 15–17 节记录两轮三平台原生候选，第 18 节收口本次职责澄清。下一步优先明确主进程尾部、消费者完成、资源释放和主动取消的收尾边界，验证实际 Agent 启动链，再选定生产 reader、wire API 与预算；macOS 普通后代控制实验仅作诊断，不再是无条件前置。不能把范围收窄、基线或局部候选通过当作里程碑一完成，实现与产品验收仍未勾选。

## 7. 第一轮候选实验协议（运行前冻结）

本节及第 8、13–17 节保留当时实验协议与结果，其中普通后代场景的门槛不再直接等于产品门槛；当时的优先级判断由第 18 节取代，不修改脚本、断言或历史结果。

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
| macOS 原生 | arm64 / Darwin 25.6.0 / Node 22.23.2：公共接口 15 项基线；新增 42 项 reader 对照，候选 15 项达标、后代两组 6 项未达标 | 补主进程尾部、最终状态、资源释放、实际启动链与宿主验证。leader/write/EOF 后 master 对照保留为诊断，后代失败不独立阻塞产品；也不能将普通场景通过泛化为全平台验收，或把 Linux EIO/取消策略直接推广。 |
| Windows 原生 | Server 2025 x64 / Node 22.23.2：两轮各 63 项；修订 Job 夹具并验证存活/TTY 后候选 18 次完整、3 次明确取消；原 worker 每轮 42 次资源 guard 失败 | 补 native handle 释放/增长、并发输入、真正 stop/强制停止与实际 VS Code。独立 worker 自然退出不等于全部 OS 句柄归零或完整生产候选已选定。 |
| 声明支持的宿主范围 | `^1.80.0` 仍未改变 | 选型时明确最低支持宿主与代表性矩阵；在验证前不能将 1.117.0 的结果泛化到全部支持版本。 |

里程碑一还未结束：生产 reader、会话收尾/取消边界、资源/输入预算和具体 wire API 尚未选定，实际 Agent 启动链仍待验证。原生 Windows/macOS 候选已执行，Windows 修订夹具后达标，macOS 后代场景仍未满足冻结诊断门槛；这项失败不独立阻塞产品选型，不再把“没有平台 runner”作为原因。不能据此直接修改业务、去掉旧兼容、宣布全平台已修复或关闭退出完整性债务。

## 12. 独立 Runner 合入后的证据承接

PR #294 已合入 `main@5965adb8`，运行时分支的 13 个提交 rebase 后为 `28055e13`；备份 `backup/runtime-persistence-before-runner-rebase-7202298c` 保留。业务代码与 rebase 前相同，runner 的 workflow、诊断和证据文档保持已审核版本。

`docs/design-docs/runtime-exit-integrity-native-runners.md` 记录原生 run `35491608835` 的首次失败与 `35492043484` 的修正版结果。后一轮在 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12 下每平台 12 次内容匹配、3 次主动取消，共 45 项。macOS 原失败是 LF 前重复 CR 被误判为多行，非短读证据。Windows 原失败是内容匹配但诊断资源未退出；新版在内容观察结算后显式 public kill 才结束，不能关闭自然退出的资源债务。两个 run 和首次工件均保留。

由此把资源所有权纳入选型：provider 应明确提供幂等的资源释放路径，说明它是否破坏仍在读取的数据以及与主进程退出的顺序。释放 worker/native handle 不应靠复用用户 stop 的进程树信号语义来推断；本轮只确认该证明义务，不新建生产 dispose API，也不把诊断 public kill 当作最终实现。源完成、页面应用完成和资源回收须独立验证。

## 13. 可执行收尾契约模型（隔离候选）

模型位于 `scripts/diagnostics/runtime-exit-contract-model.mjs`，用例入口为 `scripts/diagnostics/diagnose-runtime-exit-contract.mjs`。它们是设计阶段的受控验证，只使用内存状态和既有 `TerminalPagedProjection` 类；不创建原生 PTY、不更改 bridge、Supervisor、Host 或 Webview，也不意味着新 API 已投入生产。

源模型分别接收字符串 data、process result 和 source end。process result 可先于最后 data；source end 可先于 process result；两者都存在时只发布一次 final。source end 状态为 `eof`、`interrupted`、`error` 或 `legacy-unknown`，由测试输入提供，不由模型检测 native EOF。非零 exit 不改变 `eof`；stop 意图不结算源；解码器尾片须先交付再结束。重复相同终态幂等，冲突终态或 source end 后 data 显式报违约，不静默改变已发布的 final。资源释放不为缺少的 process/source 结果补造成功。

消费者模型只固定验证规则，优先比较独立结算消息，不直接扩展现有 close。实验结算为 `applied(finalRevision)` / `cancelled`，断连为服务端 `lost`，旧 close 为 `legacy-released`；后三者释放读者但不证明已应用。应用确认要求连接 owner、sessionId、authorityId、readId 全部匹配，最终 revision 已知且等于确认位置，且该位置已送给该读者。服务器仍需信任有效 Webview 只在 xterm write callback 后发送 applied；仅模型中的数值相等不能证明 UI 实际渲染。

主进程退出不关闭新读者入口；源 final 固定位置后停止接受新的 open，已接收但未返回的 open 仍占用来源。已存在读者各自应用、取消或失联，最后一个结算后才允许来源退役；一个读者取消不得结束另一个。取消后的迟到 open 回复不得复活读者，旧 authority/read/owner 的迟到结算不得释放新读者。同一结算重试幂等，冲突重试拒绝。轻量的去重记录只属于模型；生产记录的数量、期限与清理预算尚待选定。

候选能力分别描述“协议能理解结算”与“该 session 的 provider 能证明源结束”。只有双方 opt-in 才发送新结算，旧 `terminalAppliedRevisionAckV1` 仅证明已有增量能力，不能冒充新的终态能力。新协议连接旧 provider 时源仍为 `legacy-unknown`；不搬迁旧 live session，不更改既有绑定。

运行前冻结的用例覆盖事件排列、重复与违约、解码尾片、stop/强制中断/错误/旧能力，以及消费者最终位置、错误身份、双读者、在途 open、重试和真实投影完成/取消的对照。确定性用例每项一次，并保存全部结果与实际投影源码哈希。模型通过只能支持上述逻辑规则自洽；Supervisor/local Host 接入、原生候选、并发/资源预算和真实 xterm/packaged 仍须独立验证。

## 14. 收尾契约验证结果与剩余边界

在 Linux Node 25.6.0 与 Electron-as-Node 39.8.7 / Node 22.22.1 分别完成同一组 39 个用例，各 39/39 通过；能力用例另遍历 18 个组合，不额外记为 18 次原生验证。工件在 `.debug/exit-contract-v1-node25/`、`.debug/exit-contract-v1-electron39/`，包含固定 schedule、全部 results、summary 和源码哈希。模型哈希为 `e23befc9272d10354501d62bb09ac9ee46eb6b48b9756c1a5518d56a94afba70`；验证入口哈希为 `2eaf510bf0dc9fa3b9875abc3068759e4d4b6fc2b83c84a26d92b94802e57d1f`。

实际 `TerminalPagedProjection` 的对照分别让最后一页 write callback 完成、或在 callback 前 stop：前者显示退出，后者不显示自然完成，两者旧 close 载荷却完全相同。这实证了完成凭证缺失，未证明当前页面有新的丢字节 bug。候选模型把 applied/cancelled/lost/legacy-released 分开，并拒绝提前确认、错误身份和错误 final revision；现有生产 wire 尚未改变。

`scripts/diagnostics/diagnose-runtime-exit-admission.mjs` 在同两种运行时各执行 17 项：原有 11 项公共 Supervisor 特征断言保持不变，另加 6 项把源模型的 final 转接给实际 Supervisor 的 onExit。Agent/Terminal 各覆盖进程先退后有异步尾部、源先结束和 stop 后排空；6 项均完整保留 `BEFORE\r\nTAIL\r\n`、final revision 2、exit 7 和唯一终态。工件为 `.debug/exit-admission-contract-v1-node25.json` 与 `.debug/exit-admission-contract-v1-electron39.json`。这些 source EOF 是注入的，不是 PTY 读取证明；此适配也没有把源状态传入生产 wire，不能视为 Supervisor 完整集成已交付。local Host 两路径、provider 原生实现和完整消费者确认链路仍未接通。

rebase 回归通过 `typecheck`、`build`、`test:execution-session-bridge`、`test:terminal-session-journal` 和 `test:runtime-supervisor-protocol`（含 checkpoint refresh、paged projection、completed-history、paged completion）。相对 rebase 前业务及原有测试无差异，本轮增量限诊断和文档；没有执行完整 VS Code UI、真实 Agent、packaged 或新的 macOS/Windows 候选测试。固定等待、旧 onExit 或事后 public kill 均未升格为生产完整性方案。

## 15. 原生候选阶段（运行前边界）

下一轮诊断在 `origin/main@5965adb8` 的独立分支 `runtime-exit-integrity-native-candidates` 开展，避免把未完成的运行时分支推到 runner。沿用已合并公共接口基线，不改变它的门槛。新增候选 workflow 和独立设计/计划；运行前固定完整 schedule、重复次数及预算，保存首次失败和修订原因，不触碰业务代码。

新核查的 Windows 源码事实：固定 node-pty `1.2.0-beta.12` 的 `src/win/conpty.cc::SetupExitCallback()` 在 native 退出回调到 JS 前关闭 shell handle 并移除 baton，而 `PtyKill()` 按该 baton 查找 HPCON；builtin 自然退出后再 kill 不能据此证明执行了 `ClosePseudoConsole`。DLL connect 则调用 `ConptyReleasePseudoConsole`。此处为源码顺序证据，尚不等于原生泄漏计数或完整生命周期证明。需要实际观测 DLL 源 EOF 与 worker 结束，不能只把 `useConptyDll` 置为 true 宣称完成。

## 16. 三平台原生候选首轮结果

独立诊断输入为 `runtime-exit-integrity-native-candidates@afb2497440d22ee088d8bd3a65766dcec008e322`，不含当前分支的未完成运行时历史。[run 35498026812](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35498026812) attempt 1 完整执行 147 个样本：Linux 42、macOS 42、Windows 63。Ubuntu job 成功，另两个失败；所有首次结果保留，没有扩大等待或调低内容门槛取得绿色。独立分支的设计和 ExecPlan 记录运行前冻结参数，工具位于该分支 `scripts/diagnostics/compare-runtime-exit-readers.mjs`、`compare-windows-exit-readers.mjs` 和 `runtime-exit-conout-worker.mjs`，没有修改业务或 node_modules。

Linux 候选 18 次精确 read EIO、3 次后代保持时明确取消；stock 暂停三轮均在 89800 行结束且 writer 成功，后代尾部三轮写失败。macOS 候选自然 exit 0/7、暂停、分片、TERM 共 15 次完整 read 0，stock 这些场景也完整；本轮未复现 macOS 暂停丢尾。macOS 后代尾部三个候选只收到 `PARENT`，receipt 为 `CHILD_TAIL\ncomplete:1`，不是成功写入凭证；保持组三次约 10 ms 即 read 0，没有进入预期的 1000 ms 取消。不能将这 6 个失败称为已证明的 HUP 同因或已写成功后丢失。session leader 退出导致 terminal 撤销是待验证假设，还需要真实 write errno、保持 master 打开及 leader 存活的控制组。

公开 [XNU kern_exit.c@f6217f891ac0bb64f3d375211650a4c1ff8ca1ea](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exit.c) 的 leader 退出分支有 SIGHUP、ttywait、`VNOP_REVOKE(REVOKEALL)`，提供源码旁证；没有对应 runner 精确构建的 syscall 轨迹，不代替控制组。

Windows 原 builtin 暂停三轮的 90000 行文字哈希都匹配，但末尾 `cursorLine=89999` 而非预期 `90000`，writer 均成功；是末尾换行/光标状态不完整，不是丢了编号文字。原 DLL 暂停完整，但两条原路径各 21 个样本都未在 2 s 资源 guard 内自然退出。候选直接读取 DLL conout pipe，取消原转发 server/timer，普通五类共 15 次完整内容/光标、pipe EOF、worker 与诊断进程自然退出；后代尾部三次不匹配、保持组三次收到 EOF 而非预期取消，均保留失败。内容完成和自然 Node 退出不证明 HPCON/系统句柄长期无增长。

Windows 后代工件复核：tail 九次均无 writer receipt，PID 已消失。固定 [libuv v1.51.0 win/process.c](https://github.com/libuv/libuv/blob/v1.51.0/src/win/process.c) 将普通 Node spawn 的子进程放入父进程私有 kill-on-close Job，父退出会杀掉夹具后代。因此这六个候选门槛失败不证明 reader 丢弃存活后代；不能只凭 spawn/ready 文件认定输出所有权。第二轮冻结为由 `cmd start /b` 中间进程创建真实后代，额外断言主进程回调时仍存活且 stdout 为 TTY，不改 reader、重复次数、90000 行或等待预算，也不修改 macOS 的失败判断。

三平台为 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12，Linux x64 与 macOS arm64 分别为 kernel 6.17.0-1022-azure、Darwin 25.6.0；Windows 为 Server 2025 x64。不是实际 VS Code UI、最低宿主、Remote SSH、真实 Agent 或 packaged 验收。下一轮优先验证后代的真实输出所有权与写入/EOF 边界，同时评估长驻资源；当前没有选定统一 reader，更没有把新路径接入 Host/Supervisor。

## 17. Windows 夹具修订后的完整对照

第二轮 [run 35498732353](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35498732353) 输入 `4ac3ad156ae7cec3bf649a656b2eb437149040e4`、attempt 1，完整再执行 147 项，不改 reader、轮次、内容或等待预算。Windows 与 Ubuntu job 成功，macOS job 失败；总 run 保持失败，不修改 macOS 门槛来获得全绿。

Windows 候选 21/21 达标：自然零/非零、暂停、分片、后代尾部和合作退出共 18 次内容/光标匹配、pipe EOF、worker 和诊断进程自然退出；后代保持三次在固定 2500 ms 后明确取消并清理。六个后代样本同时满足父 native 退出回调时真实后代仍存活、stdout 为 TTY，因此这次才有效验证存活后代。原 builtin 的后代尾部三次仍缺失；原 DLL 内容完整，但两条 stock 仍共 42 次资源 guard 失败。两轮 stock 资源失败共 84 次，未用事后 public kill 掩盖。

完整工件确认 builtin 后代尾部三轮在 onExit 观察时 receipt 为 null，但随后保存的 writer receipt 都为 `written: true, code: 0`，呈现仍只有 `PARENT`；候选完整呈现 `CHILD_TAIL`。这是原生 Windows 提前关闭后漏掉成功写入的后代输出证据，与首轮夹具被 Node Job 杀掉及 Unix 后代写失败分开统计。两轮全部工件已下载到独立工作树 `.debug/github-candidates-{run}-{platform}/`，核对完整 schedule/raw 哈希、Windows 内容/光标和实际输入 commit（Windows CRLF 差异已验证）。每轮 Unix 进程组和 Windows fixture PID 清理均无残留，不代表 OS 句柄长期零增长。

第二轮 Linux 与 macOS 结果类型不变：前者候选 18 次完整、3 次明确取消；后者普通 15 项完整、后代两组 6 项仍未达标。当时提出下一增量先补 macOS 原始 write 返回值、leader 存活/退出及首次 EOF 后保持 master 的控制实验；该优先级现由第 18 节取代，失败结果不变。Windows 独立 worker 已有原生可行性依据，仍需 native 句柄长期增长、并发输入、真正 stop/强制停止、实际宿主与共享契约集成验证；不能因这 21 项通过就定为生产默认路径。运行时业务、旧 live 绑定和 root 归属均未修改。

## 18. 职责澄清与交付阻塞重评

2026-09-20，用户确认画板不负责把会话内部每个后代作为独立对象托管、追踪或恢复，也不默认承诺实际主进程退出后等待普通后代的未来输出。这同时适用于 Terminal 和 Agent；不意味着过滤运行中的后代输出，不意味着立即清理自身已接收/排队/消费的数据，也不改变会话主进程自身尾部、最终状态和资源释放的要求。具体收尾边界、取消条件与时间预算尚未确认。

| 既有证据或待验证项 | 当前分类与交付判断 | 理由与后续 |
| --- | --- | --- |
| Linux 主进程成功写入后缺尾、原始 HUP/partial read 与受控暂停反例 | 产品正确性问题，仍须收口 | 改变后代职责不能补回主进程输出；仍须逐层对账和旧/新 reader 对照。 |
| Windows builtin 暂停后 90000 行文字完整但最终光标少一行 | 产品终端最终状态问题，仍须收口 | 不是编号文字缺失，也不是普通后代续跑要求；按终端语义验收。 |
| Windows 原 worker 的自然退出资源 guard 失败 | 产品资源生命周期问题，仍须收口 | 读取内容完成不代表资源释放；候选自然退出不证明 native 句柄长期无增长。 |
| macOS 后代尾部写失败、held 提前 read 0 | 底层诊断失败保留，不单独阻塞产品交付/选型 | 未证明主进程尾部丢失，当前产品不承诺退出后继续支持普通后代。leader/write/EOF 后 master 控制组可继续研究，不再要求先将其修成绿色。macOS 其余产品矩阵仍待完成。 |
| Linux 后代写失败、Windows 第二轮 builtin 漏掉退出后后代成功写入 | PTY 生命周期与关闭行为诊断，不自动判定产品违规 | 写入证据和失败保留；不能直接作为真实 Agent 已有相同缺陷的证据。若涉及已接收内容或实际执行主体，则另按相应产品契约验证。 |
| `Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` | 产品启动链验收项，仍开放 | 实际 CLI 是会话执行主体，不是无需托管的工具后代；不能仅据包装程序退出发布 Agent 终态。需核对真实支持路径的身份、退出时序和终端资源。 |
| 已接收队列、消费者最终应用、取消与 EOF 区分 | 产品收尾契约，仍开放 | 不能用取消/超时冒充完整 EOF，也不能用 reader close 证明页面已应用；模型自洽不等于生产接通。 |

下一增量先按第 5 节分别冻结产品验证与诊断对照，明确主进程尾部和已有数据的处理边界、真实源结束/主动取消的区分、消费者结算及资源释放条件；对实际 Agent 启动链单独留证。若后续选择取消策略，必须说明触发条件与时间预算及其如何保留上述义务，不能直接沿用实验中的 1000/2500 ms。本次不选定 reader/API，不修改业务。

两轮原生 run `35498026812`、`35498732353` 的冻结案例、断言、原始工件、失败与总 run 状态原样保留。新的产品验收应使用单独命名、运行前冻结的矩阵，关联旧诊断证据并写清门槛为何不同，不修改旧测试求绿或把历史失败追认成通过。仅职责调整不产生任何新的平台通过证据；设计仍为 `比较中 / 验证中`，计划 active，退出完整性债务未关闭。
