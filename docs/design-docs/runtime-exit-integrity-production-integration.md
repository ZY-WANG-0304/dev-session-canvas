---
title: 退出完整性生产接入与故障域收敛
decision_status: 比较中
validation_status: 未验证
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
updated_at: 2026-09-24
---

# 退出完整性生产接入与故障域收敛

## 1. 当前结论与阶段边界

本阶段从主树 `081c3a21`、诊断树 `f7ce4283` 继续，只做生产源码核对与设计收敛。首选待验证候选是：**终端权威状态留在 Supervisor 或 Host；每个新执行会话在取得任何 PTY/native 资源前，建立独立的 provider 子进程。** provider 是实际持有进程、终端和原生资源的组件，adapter 是把它的事实接到终端权威状态的共享适配逻辑，authority 是维护终端事件顺序和解析状态的 Supervisor 或本地 Host。共享 adapter 指代码复用，不是两模式共享内存或 owner。

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

下一阶段仅闭合 PI-01/02/03 的可实施接口：从现有 bridge/两 authority/relay 逐步确定消息和状态转换、父 owner 消失的跨平台策略及最小失败判据，连同受控两会话负载的安全界限写入本设计。若该审查确认需要 A/B，先补齐第7节缺失的可运行参数再实施；不能先运行后倒写协议。不自动追加 U1-7/W1。

随后才规划默认关闭的共享 adapter 与两模式接入切片及其定向测试，逐平台复用已经建立的原生事实来实现 provider；不另起通用诊断框架。先验证所改业务路径，再补真实宿主、Agent、打包及支持范围。未覆盖的平台不能降格旧保障后宣称整体新保证，缺能力时行为须明确。PI-04/05/06 是默认启用门槛，不阻止安全接口设计或范围受限的实现评审。

本设计阶段的验收是：三个只读专项核对覆盖接口、隔离、分发；代码锚点可定位；与既有生命周期契约及产品边界一致；两树正文/索引/计划/技术债同步；旧源码、实验、断言与证据不改。没有产品通过或“退出完整性交付完成”的结论，计划继续 active。
