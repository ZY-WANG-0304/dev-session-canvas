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
  - docs/exec-plans/completed/runtime-checkpoint-only-refresh.md
  - docs/exec-plans/completed/runtime-journal-bounded-cache.md
  - docs/exec-plans/completed/runtime-paged-terminal-projection.md
  - docs/exec-plans/completed/runtime-completed-no-history.md
  - docs/exec-plans/active/runtime-exit-integrity.md
updated_at: 2026-09-28
---

# Runtime Persistence 容量与会话归档架构重评

## 1. 范围与决策状态

2026-09-28 当前收尾入口为 `docs/design-docs/runtime-persistence-closeout.md`，整体完成定义待用户确认，暂停自动追加实施/验证阶段。F-04 四项传输/缓存/分页增量已完成，但总恢复、在途/峰值及运行期存储失败政策仍未整体收口；F-05 新 completed 无历史路径已完成。退出完整性继续独立验收，不替代容量目标；本文原始诊断、候选和历史“下一步”不自动变为当前待办，尤其第 7 节归档研究不再实施。此次只同步收尾范围，未运行容量样本或改变产品保证。

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
