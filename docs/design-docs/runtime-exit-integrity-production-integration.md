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
updated_at: 2026-09-25
---

# 退出完整性生产接入与故障域收敛

## 1. 当前结论与阶段边界

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
