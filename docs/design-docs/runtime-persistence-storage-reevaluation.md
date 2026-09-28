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
  - docs/exec-plans/active/runtime-persistence-capacity-closeout.md
  - docs/exec-plans/completed/runtime-persistence-storage-reevaluation.md
  - docs/exec-plans/completed/runtime-checkpoint-only-refresh.md
  - docs/exec-plans/completed/runtime-journal-bounded-cache.md
  - docs/exec-plans/completed/runtime-paged-terminal-projection.md
  - docs/exec-plans/completed/runtime-completed-no-history.md
  - docs/exec-plans/active/runtime-exit-integrity.md
updated_at: 2026-09-28
---

# Runtime Persistence 容量与会话归档架构重评

## 1. 范围与决策状态

2026-09-28 当前收尾入口为 `docs/design-docs/runtime-persistence-closeout.md`。用户委托代理作判断，已选定 F-04 容量优先、退出产品接入（含有限竞态）、最终整体验收的工程顺序，不等待用户确认清单或选择预算。F-04 四项传输/缓存/分页增量已完成，但在途/扫描/峰值、交互预算及存储失败仍须收口；沿当前路线验证实际约束，不以小样本未 OOM 代证，也不预设换引擎。F-05 新路径保持完成，退出完整性不替代容量目标；本文旧“下一步”和第 7 节归档研究不重新排队。本次未运行容量样本或改变产品保证。

2026-09-16，用户确认 Runtime Persistence 审核中的问题 2（完整日志后缀在内存和恢复消息中增长）与问题 3（completed 会话恢复数据内联画板）是当前更严重的问题，需要重新评估架构决策。本次将它们登记为 `docs/design-docs/webview-host-supervisor-architecture-review.md` 的 F-04、F-05，作为高优先级架构重评，而不是普通画板写文件优化。

用户最初确认的是问题和优先级，并未选定独立数据库或整体替代模型。本文保留审核基线与候选比较，第 9 节记录已实施增量；`agent-terminal-lossless-io-and-recovery.md` 描述当前实现。整体终端状态模型仍在比较，但缓存、分页及取消 completed 内联已分阶段实施，不再把“尚未选定整体路线”等同于没有运行时代码变化。

代码基线是 `origin/main@4d7f07e55461f414c570365136cc06ece6f18c64`，位于审核分支 `architecture-review-webview-host-supervisor`。容量重评不调整异常断连恢复策略、不修普通画板并发保存、不实施 F-03 的 root 稳定 Supervisor 归属，也不修改 snapshot-only/local PTY 的持久化与关闭语义。

2026-09-17，用户确认 Supervisor 自身崩溃或机器重启后不要求恢复进程和终端历史，随后又确认正常结束的节点重开也无需进程或历史。后一项已选定为 `runtime-completed-no-history.md`：不再内联/归档 completed 正文，只保存轻量终态，当前视图仍收齐尾部。第 6.3 节的 server 生命周期方向不要求新增 server；运行期 journal 格式与保护暂不变。第 7 节独立归档契约保留为未采用候选，不是当前实施要求。

2026-09-20，用户确认将退出完整性纳入本次重构独立交付，设计见 `docs/design-docs/runtime-exit-integrity.md`。它覆盖 Agent/Terminal、Runtime 与 snapshot-only 的共同退出路径及 Linux/macOS/Windows，不改变前述持久化与关闭边界。退出码、源输出排空与消费者完成不能相互替代；此项不是 F-04 容量优化或删除兼容路径的自然副产物。本次仅登记交付范围与 active ExecPlan，具体实现待选定，业务代码未改，原生平台验收仍开放。

## 2. 已核实的审核基线

本节事实与行号保留原审核基线。第 9 节记录已实施增量：周期后缀重传与 Supervisor 长期事件缓存已分别缩小，Host/完整恢复/归档边界仍未完成替代。

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

authority 表示会话的唯一终端事件权威，revision 表示事件顺序号。重评必须保持单 writer、事件顺序、attach 到 live 的无损交接和旧会话原绑定。当前实现及沿用 journal 的候选仍须满足 checksum、checkpoint 可恢复性和连续 revision 校验；替代状态模型需要等价的正确性证明，不预设必须沿用磁盘格式。不能通过清空未消费队列、只保留 raw tail、放宽现有 eligibility 或伪造 revision 来满足预算。

必须分别考虑四类资源：终端当前状态与 scrollback、尚未消费的增量及临时缓存、按产品需要保留的历史，以及画板对象图。历史或增量是否需要落盘由容量和保留需求决定，不由崩溃恢复要求决定。终端恢复不是无限 transcript 归档，也不是整个进程内存的持久化。

| 生命周期边界 | 当前确认的保证 |
| --- | --- |
| Webview reload/隐藏、Host reload、关闭再打开 VS Code，Supervisor 与 PTY 仍存活 | 继续原 PTY，恢复约定范围内的终端内容并无损接到 live；不能把 Host 重建当作允许丢历史的故障。 |
| Remote SSH 或本地通信暂时中断，Supervisor 仍存活 | 不因连接消失而放弃原运行时。单次 RPC 失败或 socket 断开不能证明 Supervisor 已崩溃。 |
| Supervisor 自身崩溃、执行机器重启或断电 | 不要求恢复原进程，也不要求恢复终端历史；界面不能把新进程或残留元数据伪装成原 live 会话。 |
| 会话正常结束、用户停止或退出错误 | 保存轻量节点和退出状态，不保留重开历史、不自动 start/resume；仅当前读者临时收齐尾部。等待输入但 PTY 存活不是结束。 |
| 正常升级与有序退役 | 旧 live 继续原 Supervisor，不能改写地址冒充迁移；其会话真正结束后再按轻量终态规则退役。 |

该例外只涉及运行时进程与终端历史，不是取消画板节点、布局和用户文档的既有保存语义。`strong` backend 也不意味着必须实现 Supervisor/机器故障后的灾备；provider 显式 resume 若可用仍是独立能力，不等于原进程恢复。

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
| B：独立会话存储，live/completed 共用存储身份，Host/Webview 按需分批读取，画板只保存引用与摘要 | 把历史与内存缓存、单次消息解耦；慢消费者可按存储游标追赶 | completed 只提交最终版本和归档状态，不搬入画板 JSON | 当正常 completed 保留或运行期容量需要落盘时评估；不再预设为所有候选必需。需要解决读写切点、引用提交和 GC，不能只新增一个 history 文件夹。 |
| C：只把 completed stream 移到单独文件，其他链路不变 | live 完整后缀、周期刷新、重连大消息仍存在 | 能减少画板重写，但若归档仍是一次性大 JSON，读取仍全量 | 可以作为有明确退出条件的中间步骤，不能宣称完成整个重评目标。仍需可靠引用与迁移。 |
| D：取消 completed 重开历史，只持久化节点与退出状态 | 仍需处理当前读者的尾部与临时终态成本，不解决全部 F-04 | 不再有正文归档及其画板重写 | 2026-09-17 用户明确选择，已实施；不能顺势裁剪仍运行会话或当前页未消费输出。 |

B 的存储介质与架构职责是两个不同决策。复用现有 immutable segment/checkpoint + manifest，可减少格式迁移，但索引、跨文件提交和 GC 需要可靠协议；SQLite 可以帮助事务性索引，但引入 native/打包/跨平台与大对象读取约束，整块 BLOB 或全量 SELECT 同样会复制历史。两者均未选定。也不预设新增一个永久运行的归档服务。

### 6.2 终端状态如何同步

开源对照后，不能只推荐 B 就宣称解决恢复成本。下面是与存储边界正交的第二条比较轴；B 可以分别与 S1、S2 或合适的成熟 backend 组合。

| 路线 | 价值 | 需要证明的代价与约束 |
| --- | --- | --- |
| S1：沿用 headless xterm + 可证明 checkpoint + 分批 journal，扩展 codec 覆盖 | 复用当前 authority/revision、xterm 和迁移路径，改造范围相对小 | checkpoint 长期不推进时，即使内存有界，总回放仍随 suffix 增长。扩大尺寸门槛不等于补全 palette、parser carry、mode 等状态；必须证明 future suffix 等价并测最坏恢复时间。 |
| S2：runtime 内的终端模型成为权威状态，客户端取状态/行范围与后续变化 | 借鉴 tmux/WezTerm，让新投影恢复成本主要受当前状态规模约束，而非全部过去事件数 | 不是把行文本写进 xterm。需处理 normal/alternate buffer、cursor/modes、颜色、链接、parser carry、resize、版本和 live 交接；若客户端仍用 xterm，跨引擎/状态注入兼容必须证明。也需重评“已有投影逐条消费事件”的现行约束，不能偷换为覆盖 backlog。 |
| S3：直接采用成熟 mux backend，例如 tmux，而非只借鉴模型 | 复用经过长期使用的进程/终端管理能力，减少自有终端状态实现 | 验证 Webview/xterm 集成方式、键盘/鼠标/剪贴板、同会话多窗口 resize、原生 Windows/远程部署、安装升级、socket 权限和 root 隔离；命令注入与意外重跑 Agent 也需约束。mux 不自动提供本产品 completed 归档。 |

2026-09-16 首轮建议对照 B+S1 与 B+S2；2026-09-17 的故障边界确认后，按第 6.3 节增加不预设持久归档的最小模型作为优先验证对象，B+S1 保留为兼容性对照。成熟 mux 是否适用仍按 S3 的能力矩阵判断。若 S2/S3 改变运行中可观察的无损或平台承诺，应先修订产品/设计契约；此次故障例外不授权静默裁剪未消费内容。

### 6.3 收窄故障边界后的最小候选

建议优先验证“现有 Supervisor 持有 PTY 和权威终端模型，Host/Webview 只保留有限缓存并按需同步”的 server 生命周期模型。这里仍由现有 Supervisor 承担每个会话的唯一运行时 owner，不要求新增云服务、第二个后台 server 或灾备服务；具体 root 归属仍需兼容 F-03 的目标。终端模型本体可以在内存，正常运行期需要的状态、增量和 completed 内容仍必须有明确预算与读取能力；把无限 journal 从磁盘搬进内存不是简化方案。

磁盘可作为慢消费者或运行期大历史的临时存储，但正常 completed 已明确不保留重开历史，不再为它设计独立归档。Supervisor 崩溃/机器重启也不要求每条输出 durable commit、崩溃日志重放或跨重启 checkpoint generation。这不意味着现有双代/校验可立即删除：运行期的一致性、attach 交接、损坏识别，以及已采用磁盘方案的事务保护仍须由所选模型证明。

该方向更接近 tmux/WezTerm 的进程连续性模型，但尚未选定纯内存存储或有限 scrollback 数值。要验证 xterm 状态兼容、慢消费者和输出持续高于消费速度时的策略；不能以“不承诺崩溃恢复”为理由掩盖运行中 OOM 或清空当前页面 backlog。正常 completed 取消历史来自用户的额外明确决定，不是从故障例外推导。

## 7. 独立归档候选契约（当前不采用）

本节保留用户确认无 completed 历史之前的 B 候选研究，不是当前的迁移或验收要求。当前选择 D，旧 completed 按 `runtime-completed-no-history.md` 清理可明确识别的内联正文，不先创建独立归档。只有将来产品重新明确要求保留正常结束历史，才重新评审本节引用、handoff 和 GC 契约；运行期分页/校验的适用规则仍可独立复用。

### 7.1 所有权与稳定引用

Supervisor 继续拥有 live PTY、事件排序和运行期写入；会话存储持有可校验的恢复材料。Host 持有节点布局和会话引用、必要摘要，不持有全部历史作为长期事实源。completed 是会话记录的终态，不应仅因为进程结束就更换恢复数据归属。

引用至少需要表达存储身份、session/authority、schema/producer profile；归档引用还要定位不可变的 final revision 与校验身份，不能是一个会随另一会话写入而改变含义的裸路径。运行环境、用户存储范围和 root 身份应与 F-03 的目标兼容，但不能把存储读取寿命绑死在创建窗口 slot 或 Supervisor 可执行文件 generation 上。运行时地址仍按旧 live session metadata 连接，归档引用不是替代 PTY 绑定的手段。

存储入口还需验证用户范围、路径/符号链接边界与读取权限，不能让节点中的任意路径授权读文件或执行恢复命令。终端历史可能含凭证，独立归档的权限、导出和删除语义需随保留策略验证，不默认把数据写进项目或同步到远端服务。

completed 读取若属于产品承诺，必须在原 Supervisor 完成有序 handoff 并正常退役、Host 已重建后仍可用；这不延伸为 Supervisor 崩溃或机器重启后的灾备恢复。候选实现可以是 Host 侧只读存储适配器、短命读取进程或具备归档查询能力的服务；下一阶段比较正确性与 UI 隔离成本，不以“为了读历史永不退出旧 Supervisor”逃避生命周期设计。

### 7.2 分批读取与内存预算

恢复应先取得可验证的 manifest/checkpoint 与目标 revision，再以有字节上限的页面或流读取严格连续的范围。checkpoint 本体也必须有分块/大小处理，不能只限制 events 页。对大事件、UTF-8/控制序列分片和页面边界，应定义片段身份和重组/连续喂给解析器的规则，不按任意切片伪造新 revision。

Supervisor、Host、Webview 各自需要每会话及全局缓存/在途预算；已落盘且可按游标重新读取的历史不因慢消费者或没有 Webview attach 而永久留在内存。消费者 ACK 表示已应用位置，不等于允许删除磁盘恢复来源。旧 checkpoint、正在读取的 segment 和并发 compact 之间要有读租约或等效保留机制，避免读到一半文件被回收。

控制消息、输入 ACK、当前输入节点回显仍须及时处理，历史读取与回放必须可取消、让步且有公平调度。分页可以限制消息和缓冲大小，却不能消除从很旧 checkpoint 重放全部 suffix 的总 CPU/耗时；必须单独验证终端何时可交互、回放期间如何跟上新增输出，以及是否需要扩展可证明正确的 checkpoint codec。不能把“画板先显示出来”冒充“终端已经恢复完成”。

### 7.3 completed 提交、画板引用与回收

最终事件排空后，先提交包含 final revision 与完整恢复链的归档版本，再持久化画板引用。对于 Supervisor 仍存活时发生的写入/引用失败，必须保留至少一个可验证、可读取的来源并支持重复提交；只有确认归档可读和必要引用提交成功，才能释放运行时资源或回收已被替代副本。Supervisor 崩溃、机器重启或断电后的进程/历史恢复不属于本产品保证，因此不需要为该场景另建灾备 server；正常 handoff 的原子提交点、权限和部分写入处理仍需显式选定。

删除节点、删除会话历史、清空 root、退出窗口与 Supervisor generation 退役是不同动作。GC 必须考虑多窗口、root 快照及旧 workspace snapshot 的引用，以及活跃读取者/订阅者；不能根据当前 Host 的内存引用数或“没有 live PTY”删除归档。孤儿与临时写入的识别、tombstone（记录删除意图的标记）、宽限期和重试策略仍待设计。归档损坏或不可达时应显式错误，不回退到摘要冒充完整历史。

### 7.4 兼容与迁移

旧 live session 继续原 Supervisor、原 storage、原 authority；不复制地址冒充运行时迁移。过渡期新读写协议和旧 stream-only 路径需 capability/version 区分，旧路径仍可能有旧容量成本，不能把新方案预算承诺泛化到所有旧会话。

已有 completed 内联 payload 迁移必须先写独立归档并验证完整性，再以可重试方式提交画板引用，最后才允许清除旧内联副本。任一步中断应能重试或使用旧来源；在独立格式、引用协议和旧 reader 兼容规则确定前，不批量重写用户快照。已有 v1/v2 journal 与 checkpoint producer profile 的读取/回退能力必须保留；仅识别路径不是恢复证明。

## 8. 建议验收矩阵（待实现、待执行）

下表是候选方案需要证明的结果，不是本轮已经通过的验收。journal/segment/compact 专项适用于沿用这些机制的候选，替代状态模型需证明等价的内容与交接正确性；归档读取/GC 专项仅在选择正常历史保留及独立归档时适用。单次字节预算、总缓存预算、并发上限、输入/恢复时间，以及采用磁盘时的容量策略必须在设计验证时明确，不能以“有界”二字代替数值门槛，也不能从验收措辞反推必须采用某种存储介质。

| 场景 | 建议观察与通过条件 |
| --- | --- |
| checkpoint 持续拒绝，固定 geometry/scrollback，累计历史按 1x/2x/4x 增长 | 每条 event/revision 连续可恢复；Supervisor/Host/Webview 缓存、读取页与在途消息满足各自预算。分别测 retained data、heap/RSS、编码峰值，不把磁盘字节当作 RSS。 |
| 至少 10 个 Agent/Terminal，一处输入，其他会话高输出/慢消费/隐藏 | 输入、ACK、可见输出延迟与公平性达标；慢消费者按所选状态/增量读取协议追赶，采用磁盘时验证游标读取，不能把全部未消费历史重新塞回某一层内存。 |
| attach 回放期间继续 output/resize/scrollback，跨 segment、跨 UTF-8/ANSI 分片，并并发 compact | 内容及终端语义一致，revision 无 gap/重复；read lease 有效，切到 live 的明确 revision 可验证，取消不会推进消费水位。 |
| S1/S2 在相同终端状态下累积不同长度原始历史，随后重建客户端 | 分别记录画板首屏、终端可交互和完整追赶耗时，不能只报消息大小。S2 需证明恢复后接同一 future suffix 的终端语义等价；尚未消费的 live output 不因状态同步被静默覆盖。 |
| 多个大 completed 会话，移动节点、修改 Note、保存另一个 root | 画板保存/克隆体积不再随历史 payload 总量线性增长；终态没有正文，新页面不重放也不自动执行。当前读者可读完尾部后释放来源。 |
| 若保留正常退役后的历史：Host 离线时结束，Supervisor 完成有序 handoff 后退役、generation 升级后重开 | 能通过持久化引用读取完整 final revision，无需保持旧 Supervisor 存活；不能用 recent tail 代替归档。 |
| Supervisor 崩溃、机器重启或断电后重开 | 不要求原进程或终端历史恢复；允许明确显示运行时已丢失，具体状态/文案待设计，不把新启动进程伪装成原会话。此例外不要求删除已经可读的历史或重置画板。 |
| 采用独立归档时，注入写入/引用错误或 Host 在 handoff 期间退出，Supervisor 仍存活 | 至少一个旧/新来源可读；重试幂等，不出现提前删除。Supervisor 崩溃和断电不再验收历史恢复，不能与 Host 退出混为一谈。 |
| 单根/多根多窗口引用相同归档，删除一个节点、清空一个 root、读取中 GC | 不误删其他有效引用或读者仍需要的数据；全部引用满足回收条件后能实际回收，不能以永久不删作为唯一解法。 |
| 旧内联 completed、旧 live Supervisor、v1/v2 journal 混合存在 | 可明确识别的旧 completed 变为轻量终态，模糊 serialized-only 记录保留兼容；旧 live 继续原绑定，旧协议容量边界如实标识，新旧 authority 不串线。 |
| 采用磁盘/journal 时：磁盘满、权限失败、损坏 segment/checkpoint、长时间无法 compact | 遵循明确容量与 fail-closed 策略；不静默丢数据、不返回伪完整历史，不以无限增加内存规避写入失败。 |

## 9. 当前结论与下一阶段

退出完整性按 `docs/exec-plans/active/runtime-exit-integrity.md` 独立推进：先选定可验证的读取/生命周期契约并补齐原生候选对照，再实施和验收。自然非零退出同样需要完整尾部，stop/delete/强制中断与正常排空分别表达，旧 live 继续原绑定且不追授新完整性保证。该项未完成不能宣布本次重构的退出完整性收口；F-04 的容量比较可独立推进，F-05 的无历史决定也不因此撤销。

2026-09-20 补充职责边界：Terminal/Agent 不默认在实际主进程退出后继续等待普通后代或接收未来输出；这不豁免主进程尾部、已有内容、最终状态和 reader 资源释放，也不排除启动器下实际 Agent CLI 的生命周期。普通后代实验和失败保留为诊断，不单独阻塞产品选型；具体收尾/取消/预算仍待确认，重评理由见 `docs/design-docs/runtime-exit-integrity.md` 第 18 节。

第五个增量 `runtime-paged-completion.md` 延续原 Supervisor 分页到 final revision。新能力的退出/attach/subscribe 不聚合完整终态；Host 保存轻量节点后请求退役，新 attach/open 被拒绝，原 socket/readId 读完或关闭后才物理删除。未 ACK 和在途 open 在原页面生命周期继续，旧 generation 客户端等读者关闭 RPC 收敛后退役。旧模式/混合订阅仍保留完整兼容，不改变 root 归属。受控三阶段新终态样本为 405/407/407 字节，而旧完整 snapshot 仍从约 6.76 MB 增长到约 20.29 MB；这里只测同一最小 fixture 的编码字节，不是实际 RSS 或任意终态大小上限。

第四个增量 `runtime-completed-no-history.md` 已将 completed 正文从画板持久化中移除，当时的 relay 完整临时来源现只用于旧协议。实际 Host completion + writer fixture 的 Terminal/Agent 分别为 781/812 字节，小输出与约 3.8 MB stream 相同；容量诊断保留 20509666 字节旧最小内联基线，迁移后同类最小容器为 505 字节，仅改位置仍为 505 字节。这些不是完整生产画板/RSS 指标。F-05 的新 completed 内联问题收口，F-04 的旧完整协议、总回放、在途队列与全量扫描继续开放。

以下前三个增量及其 completed 数值为当时的过程记录，不代表当前保存路径。后续先明确运行期预算与首次可交互时间，比较 S1/S2/S3，不再把正常 completed 归档作为下一阶段前提。F-03 的旧 live 原绑定与未来 root 稳定归属仍是独立改造。

当前第三个增量 `docs/design-docs/runtime-paged-terminal-projection.md` 已把消费驱动分页贯穿新协议 live Host/Webview。Host 不保留完整后缀，Webview 写完一页才读下一页；慢读者保留、取消、原 endpoint 重连与正常终态续读已有定向证据。同一三阶段负载的 live snapshot 为 425 / 427 / 427 字节，页面事件数组最多 253669 字节，全部历史通过 27 / 54 / 80 页恢复。空 genesis 描述符只是当前样本，不代表任意 checkpoint 都很小。正常 completed 内联仍为 20509666 字节，旧协议、总回放、在途队列和全量扫描仍开放。以下前两阶段记录是过程证据，不再代表 Host 的当前 live 路径；整体终端状态模型与正常历史策略仍未最终选定。

2026-09-17 开始实施后的首个增量见 `docs/design-docs/runtime-checkpoint-only-refresh.md`：支持新 capability 时，Host 健康 stream 只查询新 checkpoint，不再周期性重传完整后缀。诊断中同一持续颜色状态拒绝样本的刷新响应为 98/99/99 字节，完整 snapshot 仍为 6763684/13526849/20290369 字节，completed 内联画板仍重写 20509666 字节。该增量保留 eligibility 和旧协议，未解决首次 attach、全后缀内存或 F-05，也不意味着选定整个 B/S1/S2 路线。

第二个增量见 `docs/design-docs/runtime-journal-bounded-cache.md`：Supervisor 的长期事件缓存不再由 checkpoint 推进决定，按 1 MiB 编码字节及 2048 条限制，被淘汰部分从既有 journal 校验读取。同一三阶段样本的缓存始终 99 条，字节为 1046034 / 1046133 / 1046133；累计 output 仍增长到 19660813 字节，全部 1921 条事件可恢复。真实 Agent/Terminal PTY 和 Linux VS Code 的超缓存输出、重连及正常结束测试通过。它复用原存储而不增加归档或迁移；内部分页仍由 wire v1 聚合为完整响应，Host 后缀、恢复时间、pending/in-flight、open/compact 全量分配与 F-05 继续开放，不把缓存计量称为实际 RSS。

F-04 继续重评。首选验证方向为第 6.3 节的 server 生命周期模型，不预设 durable journal/归档，运行期落盘需要由容量证明；B+S1 可作为存储兼容路线对照。C 不再是 completed 默认下一步，A 不能代替职责分离。本文整体 `decision_status` 保持“比较中”，D 的局部已选定决策见独立设计，并未接受某个新文件格式、mux backend、纯内存实现或服务拓扑。

下一阶段以相同拒绝样本验证运行期状态、未消费事件及最小模型的恢复正确性、交互时间和资源预算，并核对 S3 能力矩阵。只有确实需要运行期落盘时再确定相应提交/回收协议；不重新引入已取消的 completed 归档或故障恢复门槛。重评不必等待 F-03，但身份与迁移必须兼容其方向。不把部分优化当作整体终端模型替换完成。

## 10. B1 容量收尾：当前实施范围与工程预算

2026-09-28，从 `8dd82629` 开始执行有限收尾 B1，过程见 `docs/exec-plans/active/runtime-persistence-capacity-closeout.md`。本节取代前文历史“下一阶段”的执行顺序，仍沿当前 Supervisor/缓存/分页方向。F-04 未整体通过；不重开 F-05 归档、不改变退出完整性或 F-03 边界。

源码已确认正常 live checkpoint 的 `commitCheckpointOnWriteChain()` 经完整 verifier 保留全历史 events/checksums/recordByteEnds，独立于有界事件缓存。选定最小修正为提交专用摘要校验：逐段验证所有记录与 manifest，只保留本次 current/previous checkpoint 和分段边界需要的 checksum，不保留完整 payload 或每条记录的校验数组；必须保持损坏拒绝、连续性、双代 fallback、原子 manifest 提交。公开完整读取与旧恢复接口暂不变，不把它们冒称新路径容量已通过。

同时核对 journal `pendingWrites`/`writeChain`、普通 socket 与 Host 接收在途。它们无界与否不由缓存/page 数字代证。慢消费者不能靠丢事件、无条件断开有效 completed reader 或停止其他 session 收敛；需要将约束接到可继续控制的原生产者/消费者。尚未接通或验证的环节必须保持 B1 开放。

本轮固定负载：80x24、1000 scrollback，已知 OSC 颜色资格拒绝后，640 个 10 KiB 块为 1x，测累计 1x/2x/4x；另保持原 10000 scrollback/5000 行尺寸拒绝输入。新路径测量禁止调用完整 projection 或收集完整 events；逐页核对内容/revision 并应用到 headless，记录每档缓存、最大页、单页/总恢复时间、heap/RSS 与 timer 延迟。它是实际模块校准，未含的 socket/Host/UI 不能记通过。

缓存沿用 1 MiB/2048 事件，普通块读取页沿用 256 KiB/256 事件；这不是任意超大单事件或整个 RSS 上限。校准进程额外 heap/RSS 初始观察预算为 64/128 MiB，每档分页读取 30 秒，依据是有限 4 MiB segment 读取/解析、1 MiB cache、page 和有限 xterm 投影的裕量，不是历史实测或用户 SLA；来源不明的峰值不得直接减去。原浏览器十会话门槛不变：输入分发 <150ms、ACK <250ms、优先回显 <500ms、后台分散 <5s、主线程滞后 <1s、全量完成 <45s。该基准只覆盖注入消息的浏览器层，不代证真实 Supervisor/Agent。

先记录原失败再修复。初始预算超限时保留数据并定位，不事后放宽阈值求绿；有限样本没 OOM 也不能放过确定无界结构。正常 live checkpoint 的新校验允许总 CPU 随日志增长，但不允许全量正文常驻；总恢复时间与终端可交互分别验收。最终 B2 产物仍需复核 A1。实际实验与结果在本节后续分账登记，不预写通过。

owned 执行路径选定在每批输出完成 tracker 消费后等待 journal `flush()`，再由既有 adapter 返还消费信用。这样现有 256 KiB/16 帧接收窗口覆盖 pendingWrites 和已搬进 writeChain 的正文，而不只限制事件缓存。append/flush 失败要登记 journal 故障、请求本执行停止并重新抛出，由 authority 保留失败责任；不能返还成功信用，也不能在实际退出确认前把 `live` 设为 false。tracker 错误不归类成 journal 故障。该选择只覆盖 owned 路径；旧 node-pty 的无 pause/resume 链和普通 socket 写入仍是 B1 阻塞，不因本修正追授有界保证。

checkpoint 回归另设 32 MiB 日志、零缓存、1 MiB 分段，提交扫描期间在每段边界 GC 后观察仍被持有的 heap，界限 12 MiB，给单段 Buffer/string/行解析及元数据留裕量。它针对全历史数组持有，不能替代不强制 GC 的容量峰值/RSS 校准。新分页测量进程含一个生产 tracker 和一个逐页回放 tracker，64/128 MiB 增量预算适用于整个测量进程，不从结果减掉第二个模型或脚本开销。

### 10.1 本轮结果与未收口责任

环境为 Linux x64 / Node v25.6.0，业务输入 `8dd82629` 加本轮工作树。原 journal 回归新增固定扫描样本，旧代码先红：34 段 retained heap 34,508,616 bytes，超过 12 MiB；摘要实现后同一断言为 103,848 bytes，原完整校验/双代回退及七类损坏拒绝通过。它消除全历史正文持有，但每次仍完整扫描，CPU 与分段元数据继续随历史增长，不能声称无限历史下常量成本。

独立 review 又发现摘要初版遗漏原始分段 `buffer.length` 比较：合法 U+FFFD 的三个 UTF-8 字节损坏成单字节 FF 后仍解码成同一字符，不能仅凭重新编码/记录 checksum 接受。第八类负例先红 `Missing expected rejection`，补实际 `segment.bytes` 比较后原测试全绿，最终 retained heap 100,216 bytes。下表校准采于该窄拒绝语义修正前，修后只回归 journal，没有重复容量采集或覆盖首次内存失败。

真实 journal `appendFile` 被单 session gate 阻塞时，旧 owned 路径已经将 `consumedThrough` 推进到 4，违反期望的 0。修后 Terminal/Agent 均等待实际磁盘写入，主进程 exit/seal 不能越过；另一 session 可继续消费。append/flush 故障保留具名 journal error、未返信用和停止责任。Supervisor wiring 77/77 通过。原 S10 resize 故障断言误将持久化失败当作已退出，本轮改为保持 live，并继续断言 error、停止请求与禁止输入；这不是更改冻结原生诊断的失败或尾部断言。

唯一一次完成负载的 `--paged-capacity` 校准如下。峰值为每 10ms 及 batch/page 边界的观察最大值，不是绝对瞬时峰值；基线 heap/RSS 为 44,879,544 / 231,870,464 bytes，已含工具编译/空模型。GC 只用于生产前基线，不在每档回收后取数。

| 累计负载 | output bytes / 页数 | 最大页 / 缓存编码 bytes | 回放秒 | heap / RSS 增量 MiB | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1x | 6,553,613 / 27 | 253,669 / 1,046,034 | 1.334 | 74.70 / 147.66 | 内容/终态正确，内存两项超限 |
| 2x | 13,107,213 / 54 | 253,669 / 1,046,133 | 2.715 | 89.20 / 181.57 | 内容/终态正确，内存两项超限 |
| 4x | 26,214,413 / 107 | 253,669 / 1,046,133 | 5.903 | 93.92 / 196.78 | 内容/终态正确，内存两项超限 |

整轮退出码 1，预算未放宽；最大观察 heap/RSS 为 143,363,824 / 438,206,464 bytes，timer lag 35.90ms。headless 总回放不是真实页面首次可交互时间。源码核对确定：Supervisor 每页重新建立 generator，只取一页后关闭；cache miss 的 `readVerifiedTerminalJournalSegment()` 先完整读段、解码/拆行、校验并收集全段 events，再按游标分页。它造成重复分配，但本次峰值也含生产、双 tracker 及校验开销，不能将全部超限精确归因于它或宣称永久泄漏。

后续直接产品工作保持在 B1：分页扫描减少到只保留目标页/当前记录，仍核验涉及段的全部 checksum 链和尾锚；然后闭合实际普通 socket/Host 传输与旧生产链的在途责任并完成多会话整链验收。不得用无预算全段缓存、跳过页外损坏检查、强断慢有效读者或暂停其他会话求通过；本轮尚未实施这些后续修正。旧恢复/公开全量 verifier 保持兼容，不纳入本次已修声明。

原容量脚本默认对照仍通过，5000 行/10000 scrollback 的尺寸拒绝输入保持原断言；它主动完整物化，不计作新路径内存证据。新模式首次两次在采样前因旧启动表达式定位和重复导出失败，最小适配当前受 guard 的入口后才完成上述唯一校准，原失败不抹除。`test-terminal-paged-projection` 原 Host harness 缺真实 admission 方法首次失败；补真实方法和默认字段后 27/27 writer 及原分页/重连断言通过，没有更改 Host 业务。checkpoint refresh、paged completion、typecheck/build 均通过。

本机原始日志保留于 `.debug/runtime-persistence-capacity-20260928-wZfyUa/`：`paged-capacity.log` 与 `paged-capacity-sample.log` 是采样前失败；`paged-capacity-measured.log` 是完成负载的内存失败；`legacy-comparison.log` 是原对照。这些与本节固定输入、指标及失败摘要共同追溯，不以局部绿色代替整体 B1/A1 通过。

原 Playwright 十会话基准 1/1 通过，10 节点、9 个后台各 4000 行，共 864,020 字符；输入分发 13.2ms、ACK 19.3ms、优先回显 170.2ms、最大后台完成 1035.4ms、后台分散 144.4ms、观察主线程滞后 0ms，原逐行正文与优先顺序断言不变。日志为同目录 `webview-10-agent.log`，只覆盖注入 Host 输出/ACK 的实际浏览器 xterm，不是本轮真实 Agent、Supervisor socket、VS Code/Electron 或跨平台端到端验收。

### 10.2 分页扫描的直接修正

从 `4dc42c87` 继续同一 B1：将 `readEventPagesAfter()` 的 cache miss 改为逐记录扫描，只保留本页和当前未结束记录，不再把整段读成 Buffer/string/lines/events。文件读取块固定为 64 KiB；按原始 LF 字节组装完整记录后再解码 UTF-8，允许正数短读，提前零字节或不完整尾记录拒绝。64 KiB 是 I/O 工作缓冲，不是事件截断上限；兼容原超大单事件独占一页，因此空间界限为读取块、当前记录及当前页，而非所有情况下绝对 256 KiB。

提交给调用者前仍验证本页涉及段的全部记录、连续 revision、checksum 链、冻结 bytes/count/endRevision 和可信尾锚，页外损坏不能被隐藏。验证游标与实际入页游标分开，跨段页不跳过未交付事件；下一页可重新扫描同段，暂不通过新增长期 segment cache/跨 RPC generator 降 CPU。原先在 await flush 前冻结的前缀和 activeReaders 生命周期保持，文件 handle 在 yield 前关闭，取消/失败释放原读取责任。

验证沿原 journal 回归增加块大小/短读、页外损坏及首屏交付前尾锚检查，先红后修；产品修正后仅执行一次原 `--paged-capacity` 的 1x/2x/4x 对照，64/128 MiB、30 秒、cache/page 门槛及输入不变，保留第 10.1 节失败。结果未出前不宣称解决全部峰值；普通 socket/Host 及旧生产链背压仍独立留在 B1，不借本修正宣布端到端收口。

本轮原代码先红为首页单次 `FileHandle.read` 请求 1,211,319 bytes，超过 64 KiB。修后原 journal 回归与新增 fixture 通过：强制 997 字节短读并跨 UTF-8 边界；首页只含一个事件但先读完整冻结段；页外末记录损坏和自洽重算 checksum 均在 yield 前拒绝；零字节短读失败；冻结前缀后的垃圾不参与；取消/失败释放 pin；约 210 KiB 单事件保持独页而非截断。独立 review 未发现阻塞。代价是同一 generator 逐页消费也会重扫段，不能宣称总扫描 CPU/I/O 减少。

同一 Linux x64 / Node v25.6.0、同一探针（本轮未改）的一次修后对照：

| 累计负载 | 回放秒（原 / 本轮） | heap 增量 MiB（原 / 本轮） | RSS 增量 MiB（原 / 本轮） | 本轮判定 |
| --- | --- | --- | --- | --- |
| 1x | 1.334 / 1.509 | 74.70 / 70.72 | 147.66 / 81.18 | heap 超限，其余已测门槛通过 |
| 2x | 2.715 / 3.578 | 89.20 / 84.50 | 181.57 / 95.57 | heap 超限，其余已测门槛通过 |
| 4x | 5.903 / 7.699 | 93.92 / 103.72 | 196.78 / 116.92 | heap 超限，其余已测门槛通过 |

内容、全部 revision、最终屏幕/光标、缓存及 page 断言保持通过；输出与 27/54/107 页不变。观察 timer lag 最大 32.51ms；回放均在 30 秒内，但时间增加如实保留。基线 heap/RSS 为 44,876,824 / 235,827,200 bytes，采样最大值 153,632,256 / 358,428,672 bytes；额外 heap/RSS 为 108,755,432 / 122,601,472 bytes。RSS 达原 128 MiB 预算不抵消 heap 未达 64 MiB，整轮 exit 1，未重采或修改门槛。heap 包含生产、双 tracker 与临时分配，剩余来源尚未由本轮采样独立归因，不能以 GC 推测、RSS 下降或缩小负载关闭该失败。

原始结果为 `.debug/runtime-persistence-paged-scan-20260928-N6P27u/paged-capacity.log`，旧失败目录完整保留。原默认容量对照（含尺寸拒绝与 completed 保存）通过，日志为同目录 `legacy-comparison.log`；journal、Supervisor wiring 77/77、paged projection（含 27/27 headless writer）、paged completion、checkpoint refresh、typecheck/build 通过。没有新增浏览器、真实 Agent、原生平台或 runner 结果；上轮浏览器证据仍只代表其注入路径。B1 剩余为 heap 预算归因/修复、普通 socket/Host 与旧生产链在途约束及既定真实整链验收，不新增通用诊断要求。

剩余 heap 的只读核对：`SerializedTerminalStateTracker.flush()` 在脏写后序列化完整有限 scrollback；探针的 producer 每 16 块、replay 每页都执行，真实 Webview `applyTerminalStreamEvents()` 只分批写入并等 callback，不做相同的逐页序列化。当前颜色状态在验证第三个模型创建前就被拒绝，不能归因于候选 checkpoint 恢复模型。未发现保存所有历史 tracker/snapshot 的容器，尚不构成泄漏证明；也没有测出额外 replay 序列化占用多少 heap，因此不扣除它或追认预算通过。后续随实际 socket/Host/页面消费链收口做堆来源归因，不将“先优化双 tracker 探针直到绿色”设为传输产品修正前置，最终 A1 实际内存证据仍不能缺失。

### 10.3 Supervisor 到 Host 的消费信用

从 `d432bf89` 继续 B1。核对确认 paged 订阅仍逐事件推送 `sessionTerminalEvent`；普通 socket 写入不处理背压，Host 的 line context 还会异步排队。正文不能直接删掉：它承担 cwd/link 上下文、attention 解析、Agent resume/activity 和有限尾缓存。仅等待 socket drain 不等于这些消费者已完成，且在 session operation chain 内等待慢 Host 会阻塞同会话 resize/read。

选定具名能力 `terminalHostOutputCreditV1` 与 subscribe 参数 `hostOutputCredit: journal-pages-v1`，只在已支持 paged-until-exit 的双方显式启用。create/attach 保持既有 deferred subscription，旧服务端/客户端保持原模式，不将旧路径追认为有界。新订阅不是 editor/panel reader，不占用或替换 Webview 的读句柄。

每个当前订阅最多一页正文在途；这不是取消/替换世代叠加时的绝对 socket 缓冲上限。Supervisor 只保存订阅身份、已消费 revision、单个在途批次及最新可替换状态，未消费正文留在原 journal；页沿 256 KiB/256 events 和既有超大单事件例外。读取/发送调度不等待远端信用占住 session chain。Host 逐事件沿原业务处理，再等待 line-context 的实际 xterm callback；处理失败或生命周期替换必须取消，不能回 consumed。应用信用不代表 Webview final application，后者仍沿原 editor/panel 结算。

状态通知也受同一信用限制并合并为最新状态；只有页覆盖状态 revision 时才交付该状态，包括当前 title 或显式 null。终态必须在 Host 尾部处理之后应用，不用 head 通知提前推进 `outputSequence`。订阅游标进入 journal retention；正常 preserve-reader 退役延后物理删除，但不能让 delete RPC 等待其调用方尚未发出的批次 ACK。显式删除/取消/断连只释放原订阅责任，迟到 ACK 不得释放新订阅。

验证固定为真实本地 socket + 实际 Supervisor/client/journal 的慢 Host 回归及现有 Host/reader 回归：信用暂停时有界、正文顺序和终态完整、同会话控制和另一会话继续、保留来源、替换/取消/断连隔离。该测试不启动 PTY 或真实 Agent，不代证平台、VS Code 页面或总体 RSS。结果另记；前两节 heap 失败不被撤销，旧生产链与 A1 实际整链仍须收尾，不扩展通用诊断工具。

实现落点为 `runtimeSupervisorMain.ts` 的独立订阅游标、链外 pump 和具名 ACK，`runtimeSupervisorClient.ts` 的原 socket/订阅身份及异步消费回执，`CanvasPanelManager.ts` 的原业务逐事件处理、line-context 屏障与末尾状态应用。订阅先安装保留下界，不能先刷新 checkpoint 把重连所需后缀 compact 掉。恢复中的已有 Host 直接从自己的已处理 revision 订阅；不重取新 head 代替消费。缺失来源或业务应用失败显式取消并展示原绑定错误，不将其记为完整消费或进程退出。attention/resume/activity 的正文解析仍同步执行；外部通知投递不是终端消费屏障，不让用户提示交互卡住下一页，attention bridge 不再用跨 await 的调用帧持有原 chunk。

独立 review 修正重连边界：断连会释放旧 socket 责任，不能假定断线期间旧游标始终保留。在保留范围内继续原 revision，并重新打开当前 Webview 分页 reader；只有具名 `terminalHostCursorCompacted` 表明旧位置已被合法 checkpoint 覆盖时，记录 `hostOutputCursorReset` 后沿既有 attach 重建业务/页面基点，不把缺失区间追认为 Host 已消费。读取损坏、authority 不符或一般失败不能借此退回最新水位。无需新 lease 服务或永久保存断线游标。普通输出只唤醒页发送，不为每块新建 sessionState；只有初始状态、既有状态变更和 title 变化标记状态待发送，避免新增逐块画板保存/整页状态推送。

Linux x64 / Node v25.6.0，真实本地 socket 回归只读加载 `d432bf89` 的 server/client/protocol 作为旧业务对照：同一 96 个 8 KiB 正文块，在 Host 暂停消费时旧路径仍收到 96 条 raw 事件，断言 `96 !== 0`，exit 1。修后每订阅最多一页，原逐条内容/revision 校验通过，正文共 786,432 bytes，连同一次 resize 共 97 个事件；慢 Terminal 期间 Agent 继续消费，同会话 input/resize 在测试 1.5 秒观察界限内返回，终态在全部正文后交付。该时限仅为定向死锁回归，未测成产品延迟 SLA。替换、主动取消、断连只释放原游标，无 capability 的服务端仍走旧契约。

原始日志为 `.debug/runtime-host-output-credit-20260928/socket-behavior-baseline.log` 与 `socket-current-final.log`。前置 `socket-behavior-red.log` 是 esbuild 不接受过滤正则标志，`socket-capability-red.log` 含 capability smoke 成功后夹具 idle timer 错误，都不算产品先红；没有回退共享源码或改写历史失败。Host 定向测试使用提取的实际 batch/event/output/state 方法和真实 line-context/xterm callback，验证等待、替换/取消、错误、title 与 original-revision 重连；通知服务与节点持久化仍为受控替身，不能冒称实际 VS Code。

本轮不重跑或修改双 tracker 容量探针，未产生新 heap/RSS 通过；1x/2x/4x 历史失败继续有效。Host 到 Webview 的 `terminalAvailable` 仍逐事件通知，此层的在途/合并边界未随正文信用自动收口；旧 node-pty 待写、旧订阅和实际多会话容量/交互仍属于原 B1。真实 Agent、实际 Webview、两模式、跨平台、packaged 与 Remote SSH 保持最终 A1 至 A6，不将本地 socket 结果代证这些格子。

独立 review 后的 `compact-steady-current.log` 和主会话最终 `socket-closeout.log` 继续通过：真实 journal 在暂停订阅期间两次 checkpoint 均不回收被 pin 的段，断连后第三次实际回收至少两段，旧 cursor 0 具名拒绝，保留 cursor 2 从 revision 3 继续；三轮普通输出/ACK 不附加 state，最终状态仍交付。Host 的精确 cursor 重连、具名 compact 回退、损坏不回退及 Webview reader 重开均有定向断言。

最终共享树回归为 Supervisor wiring 80/80、client 24/24、Host batch 10/10 和原 headless writer 27/27；journal、line context、paged completion 四组合、checkpoint refresh、reader settlement 20/20、Host deactivation、attention/title、typecheck/build 与 diff 检查通过。新增 owned Terminal/Agent 测试确认 Webview reader 独立应用、preserve delete 在 Host ACK 前返回而 journal 尚存、ACK 后物理删除。其首次夹具提前于 provider accepted 握手发送 sourceEnd，被 adapter 正确拒绝；`owned-immediate-exit.log` 保留，正式输入改为等待真实 provider 契约要求的 accepted 而不等待 consumed/Host ACK，不把非法首轮追认为通过。独立 review 的重连两项回归已修并复核，没有据此新增退出诊断阶段。

### 10.4 Host 到 Webview 的水位通知与生产链边界

从 `52ff49bc` 继续同一 B1。正文已分页，但 `CanvasPanelManager.postTerminalAvailable()` 仍逐事件调用 Webview `postMessage()`；该 API 的投递 Promise 不证明页面收到或应用，慢页面仍可能累计通知。本轮只收敛这条直接产品路径，不新增诊断框架。

选定 `terminalAvailableReceiptV1` 显式协商，通知携带独立 `receiptId`，页面在当前 lifecycle 的消息分发后回 `webview/executionTerminalAvailableReceived`。此回执只证明水位通知已处理，不代表正文写入或最终屏幕应用，不推进 Supervisor reader 的消费 revision。每 surface/kind/node 的当前 session/authority 最多一条在途通知和一份最新待发水位；后续 revision 合并为最大值，明确的 title（包括 null 清空）不能被缺省 title 覆盖。正文仍由现有分页 reader 拉取，不能通过合并丢掉正文事件。

实现以 Host 的专用通知状态及 `common/protocol.ts`、`webview/main.tsx` 为边界。bootstrap ACK 前只保留最新待发通知，不进入会截短的普通 bootstrap 消息数组，ACK 后再发。frame、surface、执行身份替换或销毁释放原通知责任；迟到/重复/错身份 receipt 不释放新在途项。没有 receipt 的旧页面沿原契约，不追认为有界。没有挂载终端的页面仍可确认收到提示，之后挂载由 checkpoint/reader head 重新取得权威状态，不能把提示当恢复来源。

最终 completed 通知及 finalRevision 保持既有独立发送和顺序，先废弃原普通提示的待发责任，再沿原 snapshot/available/exit 链交付，不等待普通提示回执。该例外是每次结束的终态控制消息，不是允许持续输出绕过信用。最终正文和 xterm callback 屏障不变；通知信用不能伪造应用、取消正文 reader 或阻塞另一节点控制。

投递 Promise 的 true 不释放信用；false、抛错或拒绝只让原项返回最新待发，在下一输出、可见性恢复或重附着时重投，不增加定时重试。原 `postMessage()` 的 void 契约不变，仅新提示路径取得投递结果，避免改变原业务 Promise catch 的等待语义。迟到失败校验原 slot 和原在途对象。重附着发布 snapshot 后重新提示当前 session revision/title，因为 relay 可能复用旧 readId 与旧 descriptor head，不能清掉新水位后仅靠旧 descriptor 恢复。

同一 lifecycle/session/authority 的重附着保留原提示信用，只合并最新水位；通知不属于 readId，不能为每次 attach 重开提示信用而积压旧在途项。原 receipt 仍只释放其对应提示，重复 receipt 无效；frame 或执行身份真正替换时才废弃旧责任。已发出的旧世代提示与一次 completed 控制消息不计为新世代的信用，单条限额不是跨全部世代的物理通道绝对上限。

旧 node-pty 生产链的有限决策：安装版本 `1.2.0-beta.12` 的公共 pause/resume 仅暂停 socket；Unix 的 native exit 后 200ms destroy（Linux/macOS 共用），当前 Windows 非 DLL 路径 exit 后 1000ms destroy 均可能与暂停期慢消费冲突，公共 onExit 又不能区分真实 EOF 与强制关闭。因此不在本轮盲加 pause/resume、不修改超时或另建第三套源生命周期。生产者有界化作为 B1 对既定 B2 owned 生产接入的依赖，不能从收尾清单删除；当前默认仍是 stock bridge，owned 候选默认关闭，A1 必须在启用后的真实链复核。此为已知退出契约与容量的交叉依赖，不是把通用工具增强升为前置。

本轮验证限定为实际 Host 方法的慢接收/标题/身份/结束顺序回归、协议解析及真实浏览器消息分发和原分页尾部回归。浏览器 harness 不是真实 VS Code/Agent 整链，旧 heap 失败仍保留，最终 A1 至 A6 不缩减。实施与结果在原 capacity ExecPlan 记录。

Linux 定向结果：只读 `52ff49bc` 原 Host 方法在 1000 次更新、不给 receipt 时发送 1000 条，单在途断言先红；修后发送 1 条，receipt 后发送 revision 1000，正文未参与合并。实际 Host/helper 的标题 null、错/旧身份、bootstrap、completed、同 readId 重附着、投递失败和两节点/双 surface 独立通过，原正文 socket 回归继续通过。协议解析、Host owner 95/95、reader wiring 20/20、headless writer 27/27、Host batch 10/10、Host deactivation、typecheck/build 通过；浏览器 8/8 覆盖 Terminal/Agent receipt、无 controller、生命周期拒绝和原分页尾部。证据在 `.debug/runtime-terminal-available-credit-20260928/`，baseline buffer 入口失败、测试夹具字段/初始读取顺序错误及中途返回类型检查失败均独立保留，不写成产品或平台失败。独立 review 后不再为同身份 attach 清通知信用，最终 `notification-reattach-final.log` 验证重复 attach 仍只有原一条在途，旧 descriptor 的新水位不丢失。未重跑 heap 或原生矩阵，B1 仍未整体完成。

### 10.5 生产消费屏障与快照物化分离

从 `f24a84f0` 继续 B1/A1。实际 owned `runtimeSupervisorMain.consumeOwnedOutput()` 和 `CanvasPanelManager.startNonNativeHostExecution()` 的 consume 回调都逐批调用 `SerializedTerminalStateTracker.flush()`。该 API 等待解析后强制生成整个有限 scrollback 的字符串，不只是消费屏障；真实 Linux provider 的读取批比旧模块探针更细，不能把此成本只归因于模拟 replay。此处是已确认的重复物化调用，不是已经证明全部 heap 超限的归因。

选定 `SerializedTerminalStateTracker.drain(): Promise<void>`，将调用前已接收的 pending 输出和已有 operation chain 按原顺序处理，等待实际 xterm write callback，保留首个操作错误，disposed 或等待中被 dispose 不能返回成功信用。drain 不生成快照；内部排空策略显式区分 forced、periodic 和 none，避免误用原 periodic 路径仍触发序列化。原 `flush()`、`flushValidatedCheckpoint()`、周期旧路径、resize/scrollback 和缓存 freshness 语义不变，旧接口不自动降级为 drain。

仅 owned 两条消费路径改用 drain；Supervisor 继续等待完整 journal.flush（含已进入写链的正文）。最终 flush、附着快照、snapshot-only 保存、checkpoint 资格和最终屏幕/revision 核对仍完整执行。没有把解析完成当作真实 EOF 或页面最终应用，不调整 source/退出预算，不改默认启用、旧 live 绑定或 generation。旧消费回归中阻塞/失败的注入点随 API 职责移动，最终序列化失败仍独立验证；不改历史冻结 native 输入或原始失败。

验证先以实际 Host/Supervisor consume 统计 serialize 调用取得旧业务红，再覆盖严格 callback、错误、取消、ANSI 跨批、mutation 顺序及 final 保存。随后沿现有 Linux 工厂/owner/真实 PTY/真实 socket/client/Host 运行累计 640/1280/2560 个 10 KiB 块，80x24、1000 scrollback、OSC color-state 拒绝输入；只有一个本轮主体，正文以流式 hash/计数比较，不保存全部原始帧到内存。分页恢复采用与页面相同的写 callback 完成点，不逐页序列化，最后核对状态。此入口只服务固定产品负载，不扩为通用诊断设施。

authority Node 进程（本轮同进程 Supervisor/Host/分页模型）的额外 heap/RSS 仍用 64/128 MiB、每档恢复 30 秒；记录 provider/主体 RSS，不把 authority heap 当全部进程总 heap，也不把不同拓扑与旧双 tracker 数值直接相减。各阶段生产安全观察上限 90 秒、整轮 300 秒、主体自退出 300 秒、清理 35 秒只限制实验存活，不改变产品的自然/主动退出预算。源保持运行直至固定输出消费完成再自然结束。只允许同输入旧业务一次与修后一次对照；失败保留并定位，未到达的格子标未验，不放宽门槛循环求绿。原探针及其 heap 失败不修改，本轮不能代证实际 VS Code/Electron、真实 Agent、多会话、跨平台或生产启用。

实际 consume 回归的旧代码首批即 `serialize=1`（期望 0）；修后 Terminal/Agent 连续三批普通消费均为 0，最终序列化仍执行。Tracker 严格回调/错误/dispose/跨批 ANSI 回归、Supervisor 82/82、Host 97/97 通过，原等待最终 flush 的门控保留。两处 live 测试原先把缓存当作解析状态，首次失败保留，断言改读实际 parser buffer；最终快照断言未削减。证据在 `.debug/runtime-consumption-drain-20260928/`。独立 review 未发现本次业务修改的直接缺陷，dispose 只证明回调落定后不返成功信用，不声称能强制唤醒不返回的 callback。

固定实际链入口为 `scripts/diagnostics/audit-owned-runtime-capacity.mjs`，主体为 `scripts/test/fixtures/owned-runtime-capacity-subject.mjs`；复用原 Host 夹具且不修改冻结实验。baseline 只读加载 `f24a84f0` 的产品源码，current 为该版本加本节修改，输入文件摘要随结果保留；两者使用同一已校验 Linux x64/glibc、Node 25.6.0 的 provider 产物。各仅运行一次，均完成三档并因内存超预算 exit 1，无业务/内容/清理断言失败。

| 累计输出 | baseline 额外 heap / RSS MiB | current 额外 heap / RSS MiB | baseline / current 生产消费秒 | baseline / current 回放秒 |
| --- | --- | --- | --- | --- |
| 1x，6,553,613 bytes | 86.84 / 150.52 | 47.31 / 81.77 | 5.474 / 3.260 | 1.148 / 1.092 |
| 2x，13,107,213 bytes | 78.08 / 152.77 | 77.05 / 140.51 | 3.846 / 1.495 | 2.291 / 2.263 |
| 4x，26,214,413 bytes | 76.77 / 152.77 | 99.14 / 167.45 | 6.603 / 2.986 | 3.584 / 4.655 |

生产消费包含首档暂停 Host 后的追赶；各档 Supervisor tracker 序列化从 403/404/809 次降为 1/1/2 次，累计耗时 7590.04ms 降为 39.75ms。本轮 native 只量化 live-runtime，Host snapshot-only 的 consume 修改由受控 wiring 覆盖。这证明重复快照成本已消除，不证明整体内存已改善：current 仅 1x 同时通过 64/128 MiB 门槛，2x/4x 仍失败且 4x 峰值高于 baseline；包含退出观察的整轮 RSS 增量为 baseline 152.78 / current 167.91 MiB。provider/主体独立峰值分别为 baseline 61.70/50.78 MiB、current 61.51/50.77 MiB，不包含在 authority 预算内，不冒称多进程总内存通过。

三档预期、journal、Host 和分页的流式 hash/字节数一致，各自 revision 连续（PTY 分批数可不同，不要求两次 revision 相等）；光标、末行和完整有限终态比较通过。Host 最大同时消费页为 1，暂停首批时输入 nonce 在原 1500ms 界限内往返，cache 未超原 1 MiB/2048 事件、页未超 256 KiB/256 事件，回放均在 30 秒内。自然退出 exit 0、source EOF、accepted=consumed、pending=0，最终应用及四资源释放成立；Host/Supervisor 清理首报及各域均 settled、provider closed，未发 transport TERM/KILL。完成后的 Host 删除仍可设置 stopRequested，不能据此声称整个生命周期没有 stop 请求。

原始三档、schedule、loaded-sources、final-execution 与 cleanup-executions 保存在 `.debug/owned-runtime-capacity-baseline-first-20260928/` 和 `.debug/owned-runtime-capacity-current-first-20260928/`。新实验与第 10.2 节拓扑不同，旧 heap 失败不改。分页扫描仍逐页校验完整相关段并重复解析/编码，这是剩余分配事实，不是本轮峰值的已测归因；10ms 采样与合并进程范围亦不证明所有瞬时峰值或泄漏。下一直接容量工作是定位并修正同一真实消费链的剩余超预算分配，不先优化旧模拟探针、不新增通用诊断框架。B1/A1 保持开放；生产源默认接入仍按 B2 既定责任推进，真实 Agent/Webview/多会话及跨平台验收不削减。

同轮只读定位进一步将下一修正收窄到 `src/panel/executionTerminalLineContextTracker.ts`：`awaitPendingOperations()` 与 `writeSegment()` 每次对同一个长期未决的 `disposedSignal.promise` 做 Promise.race；成功分支不会注销该 Promise 上已注册的 reaction，而它直到 dispose 才 resolve。因此取消等待的注册随消费次数增长，没有定长边界。该结构事实足以列为 B1 直接产品问题，但不等于已测的 heap/RSS 全部根因，也未证明保存全部正文。下一修正应令每个已完成等待解除自己的取消责任，保留 dispose 唤醒、strict flush 拒绝和真实 write callback 屏障；不为此新增通用取消框架或平台实验。本轮不修改该文件、不再 native 重跑，固定对照仍只含三个业务源码差异。
