# 交付跨平台执行会话退出完整性

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖设计、实施和验收。2026-09-20 用户确认“退出完整性”属于本次 Runtime Persistence 重构的独立交付项。立项基线为 `388ec2b3`，方案阶段基线为 `a5112fb5`；PR #294 合并后，13 个重构提交已 rebase 至 `origin/main@5965adb8`，当前阶段基线为 `28055e13`。本阶段只做设计与隔离诊断，不直接修改业务代码，不推送运行时分支。后续实施开始前必须先选定方案并更新正式设计，不把本计划视为私有 fd 补读或某种新 API 的授权。

## 目标与全局图景

用户在 Agent/Terminal 自然结束时，当前有效终端页面收到完整、按序的主进程尾部，即使程序返回非零退出码；自身已接收、排队或消费中的内容不能因提前清理而丢弃，最终终端状态正确应用并释放资源。尾部保证从主进程成功写入终端的数据开始，不包含程序自身尚未 flush 的应用缓冲，也不补造生产者未写出的 UTF-8/控制序列内容。主进程退出、真实输出结束、页面完成应用和主动取消必须区分；不能把固定等待、socket close 或最终 revision 当作全部输出已交付，也不能将超时/截断标成完整 EOF。不用把正常结束全部降级为中断来掩盖缺失。

2026-09-20 用户进一步确认：画板只管理 Terminal/Agent 执行会话及其终端资源，不逐个托管、追踪或恢复后代。Terminal 内部子进程/命令/后台任务由 shell、应用和操作系统管理，Agent 工具后代由 Agent 管理；实际主进程退出后，不默认保持节点或终端等待普通后代结束或接收其未来输出。主进程仍运行时，同一终端收到的输出不能按后代来源过滤。父子关系不等于前后台关系，通用后代实验不自动等于交互 shell 后台作业或真实 Agent 缺陷。

启动链另行验证：`Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` 中实际 CLI 是会话主体，不能按工具后代排除，也不能未经证明把包装程序退出当作 Agent 结束。具体收尾边界、取消条件和时间预算仍未选定。此澄清撤销“必须先满足 macOS 普通后代持续输出门槛才能选型”的优先级，不改变历史实验、断言、失败和工件，亦不将 macOS 标为已验收。

范围包含 Linux/macOS/Windows、Agent/Terminal，以及由 Supervisor 托管的 live-runtime 和直接由 Host 托管的 snapshot-only。结束后 Runtime 重开仍不恢复进程或历史，Supervisor/机器故障后仍无需恢复；F-03 root 归属、F-04 容量整体模型和 F-05 已取消的历史归档不在此项顺手改造。不必等待其他重构完成，但本项未通过验收前不得宣称本次重构的退出完整性已经完成。

## 进度

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
- [ ] 补跨平台主进程尾部/最终状态、reader 长驻资源和实际 Agent 启动链证据，再选定实现与接口；macOS leader/write/EOF 后 master 对照保留为诊断，不以普通后代续跑门槛阻塞产品选型。
- [ ] 实施源读取/排空边界及 Host/Supervisor 共用生命周期契约，保留旧 live 绑定与明确降级。
- [ ] 补自动化回归、真实 provider/VS Code、packaged 和资源回收验收；保留失败证据并收敛开放项。
- [ ] 同步最终文档与技术债，符合完整完成定义后归档计划；不能因 Linux 或局部夹具通过就勾选全平台完成。

## 意外与发现

原 bridge 对 node-pty onExit 的完整排空假设早于本次重构，bridge 和锁文件未由本轮容量改造改变。裸 PTY 不经兼容协议也能短读，故删除旧协议不会自动解决。Linux 的 HUP/partial read 可提前 EOF；另有 Unix 200 ms timer 和 Windows 默认 ConPTY 1000 ms 无 data destroy，不能合并为一个平台 bug。固定 libuv v1.52.1 包含一个相关修正，但未覆盖已核查的后续修正及 node-pty 强制关闭路径。

公共实际 Supervisor 夹具证明 exit 前已接受操作会收敛，exit 后新回调会被拒绝；它只刻画契约依赖，不证明每个平台自然发出 late data。macOS kqueue 映射与 slave close 顺序不同，源码共享不等于同因实测。原先本地原生运行环境只有 Linux；PR #294 已补托管三平台公共接口基线，但并未提供其他平台的候选 reader 或完整源结束证明。

首轮 Linux 候选实验把两类后果区分开：暂停消费时，原 reader 六轮在 writer 成功后缺尾；后代延迟写入时，原 reader 六轮提前关闭令写入失败。候选分别完整交付；保持 slave 的六轮明确取消，并不计为完整排空。自然零/非零退出本轮均完整，没有取得新的自然 HUP 旧失败/候选通过对照。现有 reader close 还将页面应用完成和取消合并，不能把释放来源当成已完成消费的证据。详见设计第 8–11 节。

runner 首轮 macOS 是 CRCRLF oracle 误报而非短读；Windows 是内容通过但进程资源 guard 失败，显式事后 fixture 清理后的成功不证明自然退出会自动释放资源。隔离契约对照进一步通过实际 `TerminalPagedProjection` 确认完成/取消发出相同旧 close；模型 final 注入实际 Supervisor 后可以保留 process-exit 之后的尾部，但没有实现可信 native EOF 或 local Host 接入。详见设计第 12–14 节。

新候选原生 run 35498026812 中，macOS 直接 read 0 仍不能实现当时的后代保留假设；Windows builtin 暂停后文字完整但末尾光标少一行，DLL 原 worker 仍不自然退出。Windows 首轮后代属于父 Node 的 kill-on-close Job，不能将其门槛失败归为 reader 丢弃存活后代；Unix bash receipt 还混入失败输出。详见设计第 16 节，第二轮先修 Windows 夹具并加强存活/TTY 断言。macOS 原始写入和 leader 控制组仍有诊断价值，但不再是产品选型的无条件前置。

职责澄清后，普通后代在实际主进程退出后的未来输出不属于默认持续服务承诺；“原断言失败”和“产品是否违规”必须分别判断。两轮 macOS 后代各六项失败继续保留，不证明真实 Agent 有同样缺陷，也不证明 macOS 产品收尾通过。Linux 主进程尾部、Windows 最终光标与 reader 资源问题不受影响，实际 CLI 启动器的生命周期是单独待验证项。阻塞重评和每项理由见设计第 18 节。

本阶段发现原源模型没有在途 read、decoder/异步队列和真实资源回执；取消不能直接等于 source end。新模型在取消生效后仍交付在途成功字节，独立 consumer 对账加固后两运行时各 25/25；实际 tracker 的最终应用通知也通过四项正/负对照。旧 Linux reader 实验的取消分支可能跳过在途回调数据和 decoder.end，这是实验升格的证明缺口，不是新复现业务缺陷。模型也不能证明尚未读取的 OS 缓冲尾部。

真实链路只有 Windows .cmd/.bat 会被 bridge 包 cmd /d /s /c，POSIX Agent 不由扩展另加运行 shell。本机 Codex npm JS 源码会等待 child，而旧 fake-provider 多是 exec；新增等待/非等待启动器对照补齐了这一层受控证据，不等于真实 provider 通过。首次启动诊断因错误要求 Linux spawn-helper 而在 spawn 前失败，0 个原生样本，已保留；12 s 进程内 timer 不能约束同步 probe 阻塞，外部 watchdog 与新增 fatal handler 故障注入仍缺。

## 决策记录

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

已完成职责澄清后的隔离验证：新屏障模型、真实 tracker/headless 和实际 bridge 的受控 POSIX 启动链均在 Linux 两种运行时留证；首轮与加固回归、负对照和预检失败全部保留。模型支持“取消未来读取但仍消费在途成功字节”的候选规则，却不能证明 OS/ConPTY 缓冲排空或生产完整退役。下一步把候选屏障接到隔离原生 reader 验证，重点补未读取尾部/资源、Windows cmd/npm shim 和 macOS 主进程产品场景；真实 provider、信号/停止、实际 UI/packaged 仍开放，不继续靠增加注入 EOF 的模型冒充原生进展。旧两轮 294 项原生候选及 macOS 后代失败原样保留，普通后代控制实验按诊断需要推进。业务未修改，设计比较中/验证中，本计划 active，里程碑一和技术债均未关闭。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 是 node-pty 接入边界，输出回调表示已交付的数据，进程退出通知不天然等于输出排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 与 `finalizeSession()` 将已接收事件按每会话串行队列执行；admission 表示是否继续接受新事件。`src/panel/CanvasPanelManager.ts` 还直接管理 snapshot-only 的 Agent/Terminal 退出，两条路径都要纳入设计。

`src/common/runtimeSupervisorProtocol.ts` 负责 Supervisor 与 Host 的契约，`src/common/protocol.ts` 是 Host 与 Webview 的共享消息。`src/panel/runtimeTerminalReadRelay.ts` 与 `src/webview/terminalPagedProjection.ts` 管理读者、连续分页和终态呈现。revision 是已接收事件的位置，不是源进程预期输出的字节数。若需要修改这些接口，必须同时验证消费者和旧协议。

平台 provider 的现状见安装的 `node_modules/node-pty/lib/unixTerminal.js`、`windowsPtyAgent.js`、`windowsTerminal.js` 和 native 源码。已有证据位于 `docs/design-docs/runtime-terminal-tail-diagnosis.md`、`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md`；固定版本来源已在文档摘录，不要求接手者依赖本机 `.debug/` 才理解问题。不能直接编辑 node_modules 作为生产修复。

## 工作计划

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

交付以 `docs/design-docs/runtime-exit-integrity.md` 第 5、18 节和规格第 10 节为准。需要证明主进程尾部与已有内容完整、最终状态正确、资源释放，并证明取消/强制截断不会冒充完整 EOF；实际 CLI 启动链需另行验证。原生产品矩阵每格均有可复核证据和明确结果，未执行即未完成；普通后代诊断保留旧失败，不单独阻塞交付，也不增加产品通过计数。当前方案阶段验证独立诊断及 YAML/索引/本地引用、git diff 范围和计划状态；相对 `a5112fb5`，只允许诊断和文档变化，不把它们冒充 Host/Webview 或业务修复验收。

## 幂等性与恢复

候选试验不得修改用户 storage 或替换仍承载 live 会话的 Supervisor；仅控制本次创建的 fixture。证据目录唯一，不覆盖初次失败。生产方案需要可回滚的 capability/adapter 选择和旧 session 原绑定保留，回滚不得伪造完整性或强制迁移。取消和回收必须幂等，不因重试重复输出、重复终态或误删其他读者。

## 证据与备注

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

本次不新增业务类型、协议字段、依赖或业务模块；独立诊断直接加载现有 native fork，仅用于创建全新 fixture。新增 `runtime-exit-barrier-model.mjs` 的 `ExitBarrierModel` 使用 `beginRead/completeRead`、`requestCancel/applyCancel`、`processExit` 与异步 `releaseResources`，仅用于注入顺序验证，不是拟定生产 API；其退役判断不包含轻量保存、journal 删除与旧 RPC，整数 exitCode 也不涵盖 signal-only/native wait 错误。契约提案要求 provider 分开 process result/source end，共享 adapter 只发一次最终事件，并区分各读者 applied/cancelled/lost。具体命名、扩展 close receipt 还是独立 ACK、native 构建路径与旧版本能力协商仍未选定。里程碑一结束必须把精确类型/签名、文件和失败语义回写本节及正式设计；不能仅凭局部 reader 或模型通过直接成为生产默认路径。

修订记录：2026-09-20 根据用户确认建立独立交付计划；范围与验收已登记，方案选择、业务实施和原生平台验收仍待推进。

修订记录：2026-09-20 进入方案阶段，新增冻结的候选对照、运行证据、三事实收尾契约提案与平台/宿主缺口；保留所有首轮失败并加固诊断，不将 Linux 可行性扩大为全平台方案已选定。

修订记录：2026-09-20 runner PR #294 合入后回到正式重构分支，记录 rebase 基线、三平台证据承接及隔离契约验证范围；本轮不修改业务 reader、wire API 或运行时归属。

修订记录：2026-09-20 完成 rebase 回归和两种运行时的隔离契约/实际 Supervisor 注入验证，记录旧 close 的实测歧义与候选收尾结果；下一步仍为跨平台 reader/资源候选选型，不把模型成功计为生产集成。

修订记录：2026-09-20 根据用户侧对话结论，收窄实际主进程退出后普通后代的持续服务范围；同步产品、设计与阻塞判断，保留尾部/最终状态/资源/启动链义务，撤销 macOS 后代诊断的无条件选型前置。历史协议、脚本、断言和失败不改，具体收尾与预算仍待确认，计划继续 active。

修订记录：2026-09-20 进入职责澄清后的下一阶段，运行前冻结收尾屏障模型与 POSIX 启动链正/负对照；所有新增实现仅为隔离诊断，生产取消/收尾方案和跨平台选型仍待验证。

修订记录：2026-09-20 完成本阶段屏障、真实 tracker 和 POSIX 启动链验证，补独立 consumer 对账、诊断拒绝捕获及保存结果非零判定；保留首次预检失败和原始源码/结果，记录同步阻塞 watchdog 与原生/真实 provider 缺口。下一步转原生取消/尾部/资源与 Windows 启动链验证，不修改业务或宣布选型完成。
