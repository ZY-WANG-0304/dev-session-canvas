---
title: Runtime Persistence 容量与会话归档架构重评
decision_status: 比较中
validation_status: 验证中
domains:
  - VSCode 集成域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-persistence-storage-reevaluation.md
updated_at: 2026-09-16
---

# Runtime Persistence 容量与会话归档架构重评

## 1. 范围与决策状态

2026-09-16，用户确认 Runtime Persistence 审核中的问题 2（完整日志后缀在内存和恢复消息中增长）与问题 3（completed 会话恢复数据内联画板）是当前更严重的问题，需要重新评估架构决策。本次将它们登记为 `docs/design-docs/webview-host-supervisor-architecture-review.md` 的 F-04、F-05，作为高优先级架构重评，而不是普通画板写文件优化。

用户确认的是问题和优先级，不是已经选定独立数据库、存储协议或迁移方案。本文给出已核实事实、候选比较及推荐验证方向；替代方案尚未实施或验证。现行 `docs/design-docs/agent-terminal-lossless-io-and-recovery.md` 第 10.10、10.11、10.13–10.15 节继续描述当前实现，但其中的全后缀缓存/传输及 completed 内联 handoff 不再被视为已经收口的长期架构。

代码基线是 `origin/main@4d7f07e55461f414c570365136cc06ece6f18c64`，位于审核分支 `architecture-review-webview-host-supervisor`。本轮不调整异常断连恢复策略、不修普通画板并发保存、不实施 F-03 的 root 稳定 Supervisor 归属，也不修改 snapshot-only/local PTY 的产品保证。

## 2. 已核实的现状

### 2.1 live 恢复依赖完整后缀

以下路径均位于 `extensions/vscode/dev-session-canvas/src/`：

| 代码锚点 | 当前行为 |
| --- | --- |
| `common/serializedTerminalState.ts:512`，`validateCheckpoint()` | 对不能证明完整恢复的 xterm 状态拒绝 checkpoint；序列化数据超过 `256 * 1024` 字符也拒绝。OSC palette/default-color 修改会使当前 tracker 持续拒绝，即使随后 reset。 |
| `supervisor/terminalSessionJournal.ts:558`，`appendEvent()` | 同时加入磁盘待写队列和内存 `events`；日志分段不等于内存分页。 |
| `supervisor/runtimeSupervisorMain.ts:1405`，`createFreshSnapshot()` | 只有 eligible checkpoint 才推进缓存；具备 compact 条件时才尝试磁盘提交。拒绝后继续保留已有 checkpoint 与后缀。 |
| `supervisor/runtimeSupervisorMain.ts:1508`，`buildTerminalStreamAttachPayload()` | 调用 `getEventsAfter(checkpoint.revision)`，把完整后缀放入一个 snapshot；没有按字节分页的读取契约。 |
| `supervisor/runtimeSupervisorMain.ts:1615`，`releaseTerminalJournalMemoryThroughCheckpoint()` | 内存释放受 checkpoint 与消费者/deferred attach 水位约束；仅有磁盘 flush 或 Webview ACK 不足以移走所有历史。 |
| `panel/CanvasPanelManager.ts:10811`，`handleRuntimeSupervisorTerminalEvent()` | Host 的 `session.terminalStream.events` 继续累积同一后缀。 |
| `panel/CanvasPanelManager.ts:16388`，`scheduleExecutionTerminalProjectionRefresh()` | 每 10–12 秒错峰刷新有后缀的 session，`performExecutionTerminalProjectionRefresh()` 接收完整 snapshot 后再合并 RPC 期间的 live tail。 |

保守拒绝 checkpoint 是保护内容完整性的机制，不应直接删除。问题在于“需要在可靠存储中保留恢复材料”被实现成“Supervisor/Host 常驻完整材料，并反复全量传输”。磁盘有分段、registry 不复制大 payload、Webview 回放按批次让步，都不能单独证明这一跨进程链路有界。

### 2.2 completed 恢复数据改变存储归属

`panel/CanvasPanelManager.ts:11194` 的 `applyCompletedRuntimeSupervisorSnapshot()` 校验最终 stream，将 `checkpoint + events` 写入节点的 `metadata.terminalStream`，把节点转成 `snapshot-only/history-restored`。随后以 `requireRootLocalDurability: true` 等待实际 root 加载源和窗口快照写入成功，才解除 runtime 绑定并请求删除 Supervisor session/journal。写失败保留原会话和 journal 的保护必须保留，不能把本问题误写成“未等待持久化就删除日志”。

`persistState()` 和 `writePersistedCanvasSnapshotToDisk()` 仍保存整个画板，后者同步 `JSON.stringify`、写文件、rename。因此 completed 恢复大对象参与以后普通画板操作的全量保存；root 与窗口快照通常各保留一份。`workspaceState`、普通 bootstrap 和 `host/stateUpdated` 已剥离大 payload，不应误报成所有消息都发送它；显式 execution snapshot 仍需要加载并发送完整 stream。

这是将会话历史存储重新交给画板 Host 的正式设计选择，导致会话历史大小与画板加载、克隆、序列化、保存成本绑定。即使解决 live compact，大量已结束会话仍会累积这一成本。

## 3. 可重跑证据与限制

从仓库根目录执行：

    node scripts/diagnostics/audit-runtime-persistence-capacity.mjs

脚本使用当前真实 Supervisor、journal、headless xterm 与 Host 文件 writer，在内存构建仅供诊断的入口；不执行 Supervisor main，不创建 PTY/socket，不读取用户存储。测试分两类拒绝：10000 行 scrollback 下写入 5000 行普通文本，验证 `serialized-state-too-large`；1000 行 scrollback 下先写一次 OSC 默认颜色变更，再分三批写入相同文本，验证持续 `color-state`。

2026-09-16 本分支样本，单位均为字节：

| 阶段 | 屏幕序列化数据 | 内存事件中的 output 数据 | journal 目录文件总量 | snapshot JSON | checkpoint revision |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 81840 | 6553613 | 6928995 | 6763684 | 0 |
| 2 | 81840 | 13107213 | 13857611 | 13526849 | 0 |
| 3 | 81840 | 19660813 | 20786418 | 20290369 | 0 |

第三阶段 compact 已达到触发条件，再次调用真实 snapshot 方法仍返回全部 1921 个事件。以 closed 状态生成最终 snapshot 后，脚本将同一 stream 放入最小画板容器并调用当前 Host writer：首次写入 `20509666` 字节，仅修改位置后的再次写入仍为 `20509666` 字节。

这些数值确认约 80 KiB 的屏幕状态可以对应约 19.35 MiB 的恢复响应，并确认内联历史参与无关位置变更的重写。最小容器不是完整 `persistState()`/handoff 验收，不含实际 root 复制、诊断 hash、其他节点和恢复流程；也未测真实 RSS、峰值堆或 UI 阻塞时间。事件数据字节数不等于进程内存字节数，不能据此声称已复现 OOM。路径和时间戳可使重跑字节数略有差异。

此诊断针对当前架构缺陷，不接入默认 `npm test` 作为必须永远保留该行为的回归。后续方案落地时应将其演进为预算验收或保留旧版本基线。现有 tracker/journal/protocol correctness 测试通过，不足以覆盖长期历史增长。

## 4. 重评必须保持的边界

authority 表示会话的唯一终端事件权威，revision 表示事件顺序号。任何候选都必须保持当前单 writer、连续 revision、checksum 校验、checkpoint 可恢复性证明、attach 到 live 的无损交接和旧会话原绑定；不能通过清空未消费队列、只保留 raw tail、放宽 eligibility 或伪造 revision 来满足预算。

必须分别考虑四类资源：需要长期保留的磁盘历史、重建 xterm 所需的当前屏幕/scrollback、临时读取/发送缓存，以及画板对象图。终端恢复不是无限 transcript 归档，也不是整个进程内存的持久化；本次不新增 Supervisor/主机重启后恢复同一 PTY 的承诺。

不应把“无损保留、无限生产、固定磁盘空间”同时作为无条件目标。磁盘容量、保留期限、用户删除和满盘时暂停/失败的产品策略仍需明确；在得到可靠 checkpoint 或显式删除许可前，不得静默裁剪唯一来源。缓存和在途传输可以有界，存储保留策略不能由缓存上限暗中决定。

## 5. 开源方案对照

按用户要求核对 tmux、tmux-resurrect、VS Code persistent terminal 与 WezTerm。固定 commit、官方链接、函数证据和限制记录在 `docs/references/terminal-persistence-open-source-survey.md`；本节是结合当前代码后的设计判断，不把外部参考直接当作仓库结论。

| 项目 | 关键机制 | 对本产品的启示与不能照搬的边界 |
| --- | --- | --- |
| tmux | server 持有原 PTY 与 virtual screen；client detach 后可以重连；pane history 按行数限制，默认 2000；capture/pipe 是另行导出 | 独立进程 owner 加权威终端模型，而非每次重放全部原始历史。server/机器死亡不等于原进程可恢复，dead pane 不等于磁盘归档。 |
| tmux-resurrect | 保存布局、命令、可选的 pane 内容；恢复时创建新 pane/process，并打印保存内容 | 是工作面重建，不是原任务继续执行；不能用重新启动 Agent 命令冒充 provider 显式 resume 或原进程重连。 |
| VS Code | reload reconnect 原进程；restart revive 恢复有限 buffer 并启动新进程；normal-buffer revive 排除 alternate buffer/modes，detach 有 grace timer | 提醒我们明确恢复保证。它也把恢复 JSON 存在 workspace storage，但 buffer 与 layout 分 key，且不是无限后缀；不能声称所有成熟项目都用独立归档服务。 |
| WezTerm | 配置独立 mux domain 后 owner 与 GUI 分离；server 持有终端模型，客户端按变化和行范围读取；默认 scrollback 3500 | 值得比较状态/行按需同步，而不只给事件回放分页。未证明 daemon 崩溃恢复；源码有 unbounded cache 路径，不能把按需协议误写成全部资源严格有界。 |

本轮核对的普通重连路径以已解析终端状态为基础，没有为“必须反复发送从旧 checkpoint 起的所有事件”提供理由。这里要区分“不丢尚未消费的 live output”“维持配置范围内的终端状态/scrollback”“永久保存每一条原始事件”。当前安全 compact 本身就允许在恢复证明成立后删除旧前缀，并未承诺无限原始 transcript；不能反过来以 tmux 会回收 scrollback 为理由，跳过我们的 eligibility 或消费证明。

对 Agent，终端内容也不是 provider 对话数据库。保住 PTY 能保住正在工作的 provider CLI；恢复屏幕或重跑启动命令不能恢复同一执行，provider resume 需要独立身份与保证。上述项目未替本产品解决 owner 退役后的 completed 归档，也没有自动满足 F-03 的 root 归属语义。

## 6. 候选方案比较

### 6.1 存储与画板职责

| 候选 | 对 F-04 的作用 | 对 F-05 的作用 | 判断与代价 |
| --- | --- | --- | --- |
| A：保持现有模型，提高 checkpoint 资格覆盖、调整阈值或刷新间隔 | 可降低部分正常会话成本，但 checkpoint 持续拒绝时仍是完整后缀；延长周期只减少频率，不限制单次大小 | 不改变 completed 大对象进入画板 | 不能作为两个问题的主解决方案；codec 改善可以是独立的增量优化。提高 256 KiB 门槛还会增加验证成本。 |
| B：独立会话存储，live/completed 共用存储身份，Host/Webview 按需分批读取，画板只保存引用与摘要 | 把持久历史与内存缓存、单次消息解耦；慢消费者可按持久化游标追赶 | completed 只提交最终版本和归档状态，不搬入画板 JSON | 推荐进入下一阶段验证。需要解决读写切点、读租约、归档可用性、引用提交和 GC，不能只新增一个 history 文件夹。 |
| C：只把 completed stream 移到单独文件，其他链路不变 | live 完整后缀、周期刷新、重连大消息仍存在 | 能减少画板重写，但若归档仍是一次性大 JSON，读取仍全量 | 可以作为有明确退出条件的中间步骤，不能宣称完成整个重评目标。仍需可靠引用与迁移。 |

B 的存储介质与架构职责是两个不同决策。复用现有 immutable segment/checkpoint + manifest，可减少格式迁移，但索引、跨文件提交和 GC 需要可靠协议；SQLite 可以帮助事务性索引，但引入 native/打包/跨平台与大对象读取约束，整块 BLOB 或全量 SELECT 同样会复制历史。两者均未选定。也不预设新增一个永久运行的归档服务。

### 6.2 终端状态如何同步

开源对照后，不能只推荐 B 就宣称解决恢复成本。下面是与存储边界正交的第二条比较轴；B 可以分别与 S1、S2 或合适的成熟 backend 组合。

| 路线 | 价值 | 需要证明的代价与约束 |
| --- | --- | --- |
| S1：沿用 headless xterm + 可证明 checkpoint + 分批 journal，扩展 codec 覆盖 | 复用当前 authority/revision、xterm 和迁移路径，改造范围相对小 | checkpoint 长期不推进时，即使内存有界，总回放仍随 suffix 增长。扩大尺寸门槛不等于补全 palette、parser carry、mode 等状态；必须证明 future suffix 等价并测最坏恢复时间。 |
| S2：runtime 内的终端模型成为权威状态，客户端取状态/行范围与后续变化 | 借鉴 tmux/WezTerm，让新投影恢复成本主要受当前状态规模约束，而非全部过去事件数 | 不是把行文本写进 xterm。需处理 normal/alternate buffer、cursor/modes、颜色、链接、parser carry、resize、版本和 live 交接；若客户端仍用 xterm，跨引擎/状态注入兼容必须证明。也需重评“已有投影逐条消费事件”的现行约束，不能偷换为覆盖 backlog。 |
| S3：直接采用成熟 mux backend，例如 tmux，而非只借鉴模型 | 复用经过长期使用的进程/终端管理能力，减少自有终端状态实现 | 验证 Webview/xterm 集成方式、键盘/鼠标/剪贴板、同会话多窗口 resize、原生 Windows/远程部署、安装升级、socket 权限和 root 隔离；命令注入与意外重跑 Agent 也需约束。mux 不自动提供本产品 completed 归档。 |

建议下一阶段用相同 workload 对照 B+S1 与 B+S2，并把成熟 mux 能否满足能力矩阵作为 S3 的进入条件。不是现在选定 tmux，也不是默认继续扩大自定义 journal 系统；若 S2/S3 改变可观察的无损或平台承诺，应先修订产品/设计契约。完整历史保留与有限交互 scrollback 的具体策略仍待用户确认，当前不能静默裁剪。

## 7. 独立会话存储的待验证契约

本节是候选 B 的推荐验证方向，不是已经接受的生产接口或实现计划。具体终端恢复表示还要经 S1/S2/S3 比较；保留现有 journal 的描述不意味着排除权威状态同步。

### 7.1 所有权与稳定引用

Supervisor 继续拥有 live PTY、事件排序和运行期写入；会话存储持有可校验的恢复材料。Host 持有节点布局和会话引用、必要摘要，不持有全部历史作为长期事实源。completed 是会话记录的终态，不应仅因为进程结束就更换恢复数据归属。

引用至少需要表达存储身份、session/authority、schema/producer profile；归档引用还要定位不可变的 final revision 与校验身份，不能是一个会随另一会话写入而改变含义的裸路径。运行环境、用户存储范围和 root 身份应与 F-03 的目标兼容，但不能把存储读取寿命绑死在创建窗口 slot 或 Supervisor 可执行文件 generation 上。运行时地址仍按旧 live session metadata 连接，归档引用不是替代 PTY 绑定的手段。

存储入口还需验证用户范围、路径/符号链接边界与读取权限，不能让节点中的任意路径授权读文件或执行恢复命令。终端历史可能含凭证，独立归档的权限、导出和删除语义需随保留策略验证，不默认把数据写进项目或同步到远端服务。

completed 读取必须在原 Supervisor 已退出、Host 已重建后仍可用。候选实现可以是 Host 侧只读存储适配器、短命读取进程或具备归档查询能力的服务；下一阶段比较正确性与 UI 隔离成本，不以“为了读历史永不退出旧 Supervisor”逃避生命周期设计。

### 7.2 分批读取与内存预算

恢复应先取得可验证的 manifest/checkpoint 与目标 revision，再以有字节上限的页面或流读取严格连续的范围。checkpoint 本体也必须有分块/大小处理，不能只限制 events 页。对大事件、UTF-8/控制序列分片和页面边界，应定义片段身份和重组/连续喂给解析器的规则，不按任意切片伪造新 revision。

Supervisor、Host、Webview 各自需要每会话及全局缓存/在途预算；已落盘且可按游标重新读取的历史不因慢消费者或没有 Webview attach 而永久留在内存。消费者 ACK 表示已应用位置，不等于允许删除磁盘恢复来源。旧 checkpoint、正在读取的 segment 和并发 compact 之间要有读租约或等效保留机制，避免读到一半文件被回收。

控制消息、输入 ACK、当前输入节点回显仍须及时处理，历史读取与回放必须可取消、让步且有公平调度。分页可以限制消息和缓冲大小，却不能消除从很旧 checkpoint 重放全部 suffix 的总 CPU/耗时；必须单独验证终端何时可交互、回放期间如何跟上新增输出，以及是否需要扩展可证明正确的 checkpoint codec。不能把“画板先显示出来”冒充“终端已经恢复完成”。

### 7.3 completed 提交、画板引用与回收

最终事件排空后，先提交包含 final revision 与完整恢复链的归档版本，再持久化画板引用。任何一步失败都保留至少一个可验证、可读取的来源，并支持重复提交；只有确认归档可读和必要引用提交成功，才能释放运行时资源或回收已被替代副本。具体原子提交点、文件/目录 fsync 和进程崩溃/断电保证需显式选定，不把 rename 自动解释成完整耐久性协议。

删除节点、删除会话历史、清空 root、退出窗口与 Supervisor generation 退役是不同动作。GC 必须考虑多窗口、root 快照及旧 workspace snapshot 的引用，以及活跃读取者/订阅者；不能根据当前 Host 的内存引用数或“没有 live PTY”删除归档。孤儿与临时写入的识别、tombstone（记录删除意图的标记）、宽限期和重试策略仍待设计。归档损坏或不可达时应显式错误，不回退到摘要冒充完整历史。

### 7.4 兼容与迁移

旧 live session 继续原 Supervisor、原 storage、原 authority；不复制地址冒充运行时迁移。过渡期新读写协议和旧 stream-only 路径需 capability/version 区分，旧路径仍可能有旧容量成本，不能把新方案预算承诺泛化到所有旧会话。

已有 completed 内联 payload 迁移必须先写独立归档并验证完整性，再以可重试方式提交画板引用，最后才允许清除旧内联副本。任一步中断应能重试或使用旧来源；在独立格式、引用协议和旧 reader 兼容规则确定前，不批量重写用户快照。已有 v1/v2 journal 与 checkpoint producer profile 的读取/回退能力必须保留；仅识别路径不是恢复证明。

## 8. 建议验收矩阵（待实现、待执行）

下表是新方案需要证明的结果，不是本轮已经通过的验收。单次字节预算、总缓存预算、并发上限、输入/恢复时间和磁盘策略必须在设计验证时给出数值，不能以“有界”二字代替发布门槛。

| 场景 | 建议观察与通过条件 |
| --- | --- |
| checkpoint 持续拒绝，固定 geometry/scrollback，累计历史按 1x/2x/4x 增长 | 每条 event/revision 连续可恢复；Supervisor/Host/Webview 缓存、读取页与在途消息满足各自预算。分别测 retained data、heap/RSS、编码峰值，不把磁盘字节当作 RSS。 |
| 至少 10 个 Agent/Terminal，一处输入，其他会话高输出/慢消费/隐藏 | 输入、ACK、可见输出延迟与公平性达标；慢消费者按磁盘游标追赶，不能把全部未消费历史重新塞回某一层内存。 |
| attach 回放期间继续 output/resize/scrollback，跨 segment、跨 UTF-8/ANSI 分片，并并发 compact | 内容及终端语义一致，revision 无 gap/重复；read lease 有效，切到 live 的明确 revision 可验证，取消不会推进消费水位。 |
| S1/S2 在相同终端状态下累积不同长度原始历史，随后重建客户端 | 分别记录画板首屏、终端可交互和完整追赶耗时，不能只报消息大小。S2 需证明恢复后接同一 future suffix 的终端语义等价；尚未消费的 live output 不因状态同步被静默覆盖。 |
| 多个大 completed 会话，移动节点、修改 Note、保存另一个 root | 画板保存/克隆体积不再随历史 payload 总量线性增长；会话历史不被重写，首屏可先加载轻量图，终端按需恢复。 |
| Host 离线时结束，原 Supervisor 退出、generation 升级后重开 | 能通过持久化引用读取完整 final revision，无需保持旧 Supervisor 存活；不能用 recent tail 代替归档。 |
| 归档写入、校验、画板引用提交、旧来源回收各阶段注入失败/崩溃 | 至少一个旧/新来源可读；重试幂等，不出现悬空引用或提前删除。分别验证进程崩溃与所选断电耐久性口径。 |
| 单根/多根多窗口引用相同归档，删除一个节点、清空一个 root、读取中 GC | 不误删其他有效引用或读者仍需要的数据；全部引用满足回收条件后能实际回收，不能以永久不删作为唯一解法。 |
| 旧内联 completed、旧 live Supervisor、v1/v2 journal 混合存在 | 旧来源继续可用；迁移可中断重试；旧协议容量边界如实标识，新旧 authority 不串线。 |
| 磁盘满、权限失败、损坏 segment/checkpoint、长时间无法 compact | 遵循明确容量与 fail-closed 策略；不静默丢数据、不返回伪完整历史，不以无限增加内存规避写入失败。 |

## 9. 当前结论与下一阶段

本轮确认 F-04/F-05 需要联合重评，不应仅提高阈值、延长刷新间隔或换数据库。独立会话存储 B 值得优先验证，但不足以单独收口终端恢复架构；开源对照要求增加 S1/S2/S3 的状态模型比较。候选 C 只能是明确受限的阶段性措施，候选 A 不能代替职责分离。当前 `decision_status` 保持“比较中”，并未接受某个新文件格式、mux backend 或服务拓扑。

下一阶段先明确有限终端状态、未消费事件和长期归档分别要保证什么，再以相同拒绝样本对照 B+S1 与 B+S2 的恢复正确性、交互时间和资源预算，并核对 S3 的能力矩阵。随后验证归档读取与提交/GC/迁移故障，比较文件存储与事务索引需求，再确定实现 ExecPlan。重评不要求等待 F-03 才能开始，但身份与迁移必须兼容其已确认方向。未通过这些门槛前，不把当前正式设计整份标为废弃，也不声称长期容量或新归档方案已经验证。
