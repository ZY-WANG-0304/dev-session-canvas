# 运行时持久化模式规格

当前状态：草案。本文档用于收口 `Agent` / `Terminal` 在关闭画布、关闭 VSCode 与重新打开后的运行时持久化语义，重点区分“恢复上下文”与“真实进程继续存在”两种不同承诺。第 9 节的已结束无历史边界与第 10 节的退出完整性交付范围已获用户确认；不因此将其余开放问题或具体实现标为已确认。

验收基线（2026-10-02）：本次重构以现代 GitHub-hosted runner 作为环境基线。固定六格资产矩阵使用 `ubuntu-24.04`、`ubuntu-24.04-arm`、`macos-15-intel`、`macos-15`、`windows-2025` 和 `windows-11-arm`，实际记录的宿主分别为 Ubuntu 24.04、macOS 15.7.9、Windows Server 2025（10.0.26100）和 Windows 11 ARM64，用于资产构建、加载和归档；Terminal/Agent 产品验收仍以各 workflow 当次记录的现代 runner 为准（`latest` 标签必须记录实际镜像版本）。任何现代 runner 结果都不外推到 macOS 10.13/10.14、Windows 10 1809 或其他旧系统。

## 1. 用户问题

当前画布已经可以恢复对象图、节点标题、尺寸、最近输出摘要和部分 `Agent` 恢复上下文，但这还不能满足更强的工作连续性诉求：

- 用户关闭画布或切换宿主 surface 时，不希望正在工作的 `Agent` / `Terminal` 被无声杀死。
- 用户关闭整个 VSCode 后，希望在某些场景下 `Agent` 仍能继续工作，等下次打开 VSCode 时再看到结果。
- 运行中的会话需要恢复上下文；已确认结束的 Runtime 节点只需保留配置与退出状态，重开不需要旧进程或终端正文。
- 用户需要一个明确的配置开关，理解当前拿到的是“真实进程持久化”还是“快照/上下文恢复”。
- 用户还需要知道当前 live runtime 到底由哪条 backend 托管，以及这是 `strong` 还是 `best-effort` 保证。

## 2. 目标用户

本规格优先服务已经在 VSCode 里同时跑多个 `Agent` / `Terminal` 的开发者。用户通常已经接受 VSCode 是主工作面，但不接受“只要关掉画布、reload 或退出编辑器，当前执行上下文就全部断裂”。

## 3. 核心用户流程

1. 用户在 workspace 中打开画布，并配置是否开启运行时持久化。
2. 用户创建 `Agent` 或 `Terminal` 节点，并在节点内直接开始交互。
3. 当用户关闭画布、切换到其他 surface、隐藏 Webview 或 reload Webview 时，会话不应因此被无声终止。
4. 当用户关闭整个 VSCode 时：
   - 若运行时持久化已开启且当前 backend 提供 live runtime，真实 `Agent` / `Terminal` 进程继续存在。
   - 若运行时持久化已关闭，系统不承诺真实进程继续存在；退出前会先刷盘最后状态与恢复信息，并在合理超时内结束现有 `Agent` / `Terminal` 进程。
5. 用户重新打开 VSCode 后：
   - 若节点处于 `live-runtime` 模式且带有可附着的持久化会话身份，系统先显示 `重连中`。
   - 若之前的真实进程仍活着，节点会重新附着到原会话，并切回真实生命周期状态。
   - 若 Supervisor 确认进程已结束，节点保持已结束状态，不恢复正文，也不自动 start/resume。
   - 若监督器不可达或重新附着失败，沿用可解释的降级策略；不能伪装成同一进程仍在运行，也不能仅凭断连认定进程已结束。Supervisor 崩溃或机器重启后不保证历史恢复。
6. 当扩展升级且旧版 Supervisor 仍持有 live 会话时：
   - 旧会话继续由旧 Supervisor 承载，允许降级 output、input、resize、stop 与 delete；界面明确提示旧协议不能证明完整终端历史。
   - 升级后新建的 Agent / Terminal 立即由当前协议代 Supervisor 承载，不等待旧会话结束。
   - 最后一个旧会话结束后，旧 Supervisor 自然退出；当前 Supervisor 和新会话不受影响。

## 4. 在范围内

- 一个显式的运行时持久化开关 `devSessionCanvas.runtimePersistence.enabled`
- 两档正式语义：
  - `snapshot-only`：只恢复快照与上下文，不承诺真实进程跨 VSCode 生命周期存活
  - `live-runtime`：真实进程可在 VSCode 退出后继续存在，并在下次打开时重新附着
- `live-runtime` 不是单一路径，而是 “模式 + backend + guarantee” 三层语义
- Linux 本地与 Remote SSH 在能力满足时优先使用 `systemd-user` backend；当前 detached supervisor 保留为 `legacy-detached` fallback
- 第一版的正式设计范围包含本地 workspace 与 Remote SSH workspace，但不同平台/环境下允许因为 backend 能力不足而降级到 `best-effort`
- 第一版默认追求尽量完整实现；只有明确记录的 blocker、外部依赖边界或暂不支持的平台，才允许把能力留到后续版本
- `Agent` / `Terminal` 在关闭画布、切换 surface、Webview reload 时的 detach / reattach 语义
- 关闭 VSCode 后的重开语义
- 日志摘要、最后状态与恢复入口的持久化边界
- Runtime 进程已结束时只持久化轻量节点；当前页面可读完最后输出，新页面不重放已结束历史
- 用户可辨认“当前附着的是 live 进程”还是“恢复的是历史状态”

默认执行实现与用户开关是两条独立选择：正常构建默认采用当前平台的 owned 原生 provider；`devSessionCanvas.runtimePersistence.enabled` 仍只决定由 Host 管理 `snapshot-only`，还是由 Supervisor 管理 `live-runtime`。关闭开关不回退 stock，也不会因为 provider 是独立进程就获得跨 Host 存活保证。原生资产缺失必须明确失败，不能静默换用旧执行实现；已有 live 绑定沿用原 backend / storage / session，不自动迁移。正常构建、打包及默认启用已实现；F-04 的有限资源模型和受影响 Runtime 验收已结账，最终序列化修正的真实 Agent、Webview、跨平台和安装包验收与整体审查单独结账，状态见第 10 节及 `docs/design-docs/runtime-exit-integrity-production-integration.md` §53。

## 5. 不在范围内

- Supervisor 自身崩溃或机器重启（含断电）后的原进程恢复与终端历史恢复，2026-09-17 由用户确认不作保证；不要求为此新增灾备服务
- 正常结束、用户停止或退出错误后的 Runtime 终端历史归档；Agent 等待输入但 PTY 仍存活不属于结束，provider 原生会话文件不由此删除
- 多机同步、跨设备漫游或云端托管运行时
- 无限制地长期保留后台进程而没有任何用户可见治理能力
- 第一版就覆盖 Dev Container / Codespaces 场景
- 对 provider 原生恢复能力做超出其自身保证的承诺
- 把“历史快照恢复”伪装成“原进程仍在运行”
- 把 Terminal / Agent 内的每个后代进程作为独立对象托管、追踪或恢复；实际会话主进程退出后，不默认维持节点或终端以等待普通后代结束或接收其未来输出。启动包装程序下的实际 Agent CLI 不属于此排除项，见第 10 节。

## 6. 关键对象与状态

### 运行时持久化模式

- 当前开关值
- 当前模式对应的关闭 VSCode 语义
- 该模式是否要求真实进程在编辑器退出后继续存在

### Runtime Host Backend

- `systemd-user`：Linux 本地与 Remote SSH 的优先主路径，由用户服务层托管 supervisor
- `legacy-detached`：当前 detached launcher 路线，作为 fallback 保留
- `strong` / `best-effort` 保证等级
- 当前节点实际使用的 backend 与 guarantee

### 会话对象

- 稳定会话 ID
- 节点 ID 与 workspace 绑定关系
- `Agent` / `Terminal` 类型
- 启动命令、cwd、尺寸与必要环境信息
- 当前生命周期状态
- 当前是 `重连中`、已附着 live，还是 `历史恢复`
- 当前 runtime backend 与 guarantee（记录到日志与诊断信息，不默认显示在节点 UI 中）

### 日志与恢复上下文

- 最近输出
- 最近退出信息
- `Agent` 的 provider 显式恢复身份与恢复失败原因
- 关闭前的最后已知状态
- `live-runtime` 会话的输出恢复权威属于生命周期长于 Extension Host 的 runtime backend；Host/Webview snapshot 只能作为缓存或显示投影，不能独立声明后台输出完整
- runtime backend 提供稳定会话身份和连续输出位置，使新 Host 能恢复关闭期间产生的内容并无缝接到重新附着后的 live output

## 7. 验收标准

2026-10-06 补齐 live 状态恢复要求：Supervisor 仍存活时，新 Host/Webview 及 PaneGallery 布局/聚焦重建应恢复当前权威终端模型和配置内 scrollback，再接续实时增量。相同当前状态、尺寸和 scrollback 下，恢复成本不随已被模型淘汰的累计交互持续增长。不能只以分页、有界内存或原进程仍存活代替这一验收；已有有效消费者的未消费输出和尾部仍须完整按序应用，不以当前状态覆盖跳过。此项仍未完成，见 `docs/design-docs/runtime-live-state-recovery.md`。

以下 `live-runtime` 进程连续性与输出重连验收以 Supervisor 仍存活为前提；Supervisor 自身崩溃或执行机器重启后，可以没有可恢复的进程和终端历史，此时只需准确表达原运行时已丢失，不能伪装成原 live 会话。这个例外不改变画板节点、布局及用户文档的保存语义。2026-10-02 收尾决定明确：新实现仅在真正取得该 generation 排他运行权的冷启动时清理本 generation 陈旧执行账与终端 journal，不重放故障前正文；健康 Supervisor 的客户端断连/重连不执行清理，旧 generation 与旧 live 绑定不受影响。`strong` backend 不额外承诺机器/监督器故障后的恢复，`snapshot-only` 的现行保证不在本轮调整。

- 在 `snapshot-only` 与 `live-runtime` 两档模式下，关闭画布、切换 surface 或 Webview reload 都不会无声终止当前 `Agent` / `Terminal` 会话。
- 当系统选中 `systemd-user` backend 时，关闭 VSCode 或断开 Remote SSH 后，真实 `Agent` / `Terminal` 进程仍可继续存在；重新打开 VSCode 后，系统会优先重新附着到原会话，而不是只恢复一个静态快照。
- 在 Linux 本地或 Remote SSH workspace 中，如果 `systemd-user` backend 不可用，系统会自动降级到 `legacy-detached`，并把 guarantee 标成 `best-effort`，而不是继续把它伪装成强保证。
- 当运行时持久化开关开启且节点带有持久化 live 会话身份时，VSCode 重开后节点先显示 `重连中`；只有在重新附着成功后，才恢复为 `运行中`、`等待输入`、`live` 等真实生命周期状态。
- 当系统无法重新附着到 live runtime 时，已有降级行为仍须与原进程重连区分；若已确认 Runtime 进程结束，则保留节点、布局、配置与退出结果，不恢复正文、不自动 start/resume。用户显式 provider resume 是独立动作，不受此禁用，也不等于原进程延续。
- 当运行时持久化开关关闭时，关闭 VSCode 后系统会在刷盘最后状态后结束现有 `Agent` / `Terminal` 进程；重新打开时，系统至少恢复节点、标题、位置、尺寸、最后状态、最近输出摘要和恢复入口。
- 当系统恢复的是历史状态而不是 live 进程时，用户能明确识别这一点，系统不会把它伪装成“仍在运行的同一会话”。
- 对旧 Supervisor 已将目标恢复为纯历史对象、且实际运行环境重新确认原 Supervisor 不在的记录，用户可以删除该本地历史节点或以新会话重新启动，不要求故障进程补写退出码。此路径只解除历史绑定，不证明原主体/后代已退出，不伪造 EOF、正常退出或删除 RPC 成功；仅凭 History restored 标签、断连或旧错误文字不能放行。仍有 live 执行、reader、最终保存或已提交未知操作时继续保护，不能改写共享 Runtime 数据来取得资格。有限识别条件见 `docs/design-docs/runtime-persistence-closeout.md` 第 12 节。
- 当节点处于 `live-runtime` 时，系统会把当前 runtime backend 与 guarantee 写入日志与诊断信息；节点默认 UI 只保留与当前操作直接相关的状态，不直接暴露 `systemd-user / best-effort` 这类调试字段。
- 当 `Agent` 在 VSCode 关闭期间继续执行、重开时 PTY 仍存活，用户能看到关闭期间新增的执行结果；若已结束，则只恢复轻量终态。
- 当用户执行 Reload Window，或关闭 VSCode 后等待 `Agent` 继续输出再重新打开时，仍在运行的节点与 runtime backend 观察到的输出顺序一致，不因 Host/Webview 重建而缺失、重复或从任意 ANSI 控制序列中间开始。
- 多个执行节点同时高输出且用户只在一个节点输入时，当前输入节点优先响应；其他节点可以延后显示，但系统不得为了输入性能丢弃尚未消费的增量内容。
- 当 `Agent` 没有 provider 原生显式 session identity 时，系统不得使用“最近一次会话”推断来伪装自动恢复；此时节点应退化为 `interrupted` 或历史态。
- 当用户关闭运行时持久化开关时，下一次关闭 VSCode 后，不再对真实 `Agent` / `Terminal` 进程跨编辑器生命周期存活做承诺。
- 当旧版 Supervisor 会话在升级时仍然运行，用户可以继续输入并通过 resize 触发 TUI 重绘；系统不会把旧 raw tail 冒充完整 checkpoint，也不会因为旧会话存在而阻止当前版本创建新 Agent / Terminal。
- 新旧 Supervisor 并行期间，input、resize、stop、delete 和 output 必须按节点持久化的 runtime storage / session identity 路由，不能把一个 generation 的操作发给另一个 generation。
- 对没有被明确记为 blocker 或外部平台边界的组合，第一版应尽量做到完整实现；当前已确认的本地 workspace / Remote SSH 与 `Agent` / `Terminal` 四种组合都不应被故意拆成“先做一半、另一半留后面”。

## 8. 开放问题

- Dev Container / Codespaces 何时进入 `live-runtime` 正式支持范围。
- 日志持久化应该保留到什么粒度，才能既支持回放，又不让本地存储无限增长。
- 当监督器进程崩溃、丢失或留下孤儿会话时，UI 应如何暴露问题并提供清理路径。

## 9. 容量与已结束会话边界

2026-10-02 正式准入按容量设计 §10.17 收口为 `{ executions: null, starting: 1, pending: 2 }`：不设隐藏的 2 或 10 个活动会话上限，资源随用户已启动会话与 scrollback 设置增长。在实际执行 owner 的准入范围内，新建并发启动限 1；准备、结束收尾、页面或最终保存等已有未结算责任达到 2 时，拒绝新建而不是无限排队。

Supervisor 中执行与 reader 已退休，不等于存储责任已完成：仍保留在 `sessions`、等待 Host 保存轻量终态、等待 journal 删除或删除失败的会话也计入同一 `pending: 2`。新建必须在 journal / provider 获取前合并这些责任，与 owner 仍持有的同一对象去重；不以尚未设置 `retiring` 漏计待保存会话，只有成功删除存储并移除 session 后才释放额度。失败保留原来源，不能为恢复准入提前 dispose 终端状态、丢尾或伪报保存成功；unknown 保持拒绝新准入，旧显式 finite / legacy 策略不变。

已存在会话同时结束时仍全部保留真实责任和尾部，因此未结算责任可以超过 2；此数值是新资源准入背压，不是所有时刻责任数量的绝对上限。正文 / reader 在途有界、磁盘失败明确报告，不能通过丢弃未消费尾部或伪报完成换取容量；旧合并测试进程 Heap 64 MiB / RSS 128 MiB 只保留观察和原失败记录，不作产品硬预算。已有多会话、重连与 compact 证据复用，有限资源模型、生产准入和三平台受影响 Runtime 安装及真实 Agent 证据已完成 F-04 当前支持路径的验收。该结论不承诺任意会话数下固定 RSS，不回填旧协议保证，也不代替第 10 节退出完整性与整体审查。

2026-09-17 新确认：正常结束的 Runtime 节点重新打开时不恢复进程、不保留终端历史。保留节点、布局、启动配置与退出状态；不自动 start/resume。当前已打开页面仍收齐最后输出，重开、Host/Webview 重建后不提供已结束内容。Provider 自己的会话存储和直接 `snapshot-only` 模式不在本次改变。正式方案见 `docs/design-docs/runtime-completed-no-history.md`；此决定取代下文阶段记录中的“正常 completed 保留待确认”和“必须持久化完整 handoff”，独立归档不再是默认下一步。仍活着的 Agent 等待输入不属于结束。

以下决策与增量段落保留 2026-09-16 起的历史状态，其中“待确认”“未选定”和“未完成验收”不构成当前待办。当前正式资源模型、缓存/在途约束、磁盘失败处理及验收依据已收口于 `docs/design-docs/runtime-persistence-storage-reevaluation.md` §10.17；总磁盘硬配额和任意规模固定资源承诺不在该有限模型内。下列完整性要求继续有效，逐项证据与剩余边界统一见 `docs/design-docs/runtime-persistence-closeout.md` §8，不改写旧阈值或失败。

2026-09-16，用户确认当前完整 journal 后缀的内存/恢复传输成本，以及 completed 恢复数据进入画板 JSON 后的反复重写，是需要优先重新评估的架构问题，分别对应 `docs/design-docs/webview-host-supervisor-architecture-review.md` 的 F-04/F-05。这不等于现有实现已被证明违反本文的完整性语义，也不表示本轮接受截断历史或新存储格式；实现仍遵循现行 lossless 设计。

后续设计必须分别说明原进程延续、有限终端屏幕/scrollback、未消费输出、completed 可读历史和 provider resume 的保证。tmux / WezTerm 的 daemon 保活、tmux-resurrect 的命令重建、VS Code 的 reconnect/revive 可作为比较输入，但重启命令不等于 Agent 原执行继续存在，有限 buffer 也不自动替代本产品要求的完整恢复材料。

待确认的产品决策包括运行期磁盘配额与满盘行为、首次终端可交互的时间预算及缓存/在途预算。已结束会话不保留重开历史，故不再要求 completed 归档保留期、历史引用与归档 GC。Supervisor 崩溃/机器重启不要求恢复进程或历史；内存终端模型加受控缓存/按需临时存储仍可比较，具体整体实现未选定。Supervisor 存活且 PTY 仍运行时的 Host/Webview 重建或断连不适用这些例外；连接失败本身不能证明进程已结束。

建议后续验收同时覆盖以下结果，具体预算与实现尚未确定，不能标记为已通过：

- checkpoint 长期不能推进时，增加历史不再要求所有历史常驻每层内存或进入一个恢复消息；同时测总恢复耗时，不能只把大消息拆小就宣称恢复性能收口。
- 正常结束后画板只保存轻量节点，移动节点、修改 Note 等普通保存不重写终端历史；识别明确的旧 Runtime completed 内联记录也应迁移为无历史终态。
- 当前页面收齐尾部后关闭临时读者；重新打开不恢复正文，也不自动执行。轻量终态保存失败不能清理原 Supervisor，读者生命周期变化不能把旧尾部交给新页面。
- Agent / Terminal 在持续输出、客户端离线重建和多窗口读取期间继续满足原进程身份、内容顺序与输入公平性；任何保证变化先明确产品边界。
- Supervisor 崩溃、机器重启或断电后，节点明确显示运行时丢失/中断，不把重新启动的进程或残留文件显示成原 live session。

以下前三批是实施过程记录，当时保留的 completed 历史语义已被第四批替换。首个增量支持健康 live stream 独立刷新 checkpoint：无新 checkpoint 时不反复传输完整后缀，旧 Supervisor 保持兼容。它本身不改变首次恢复、正常 completed 保存或旧会话归属，也不代表整体容量验收通过。具体协议见 `docs/design-docs/runtime-checkpoint-only-refresh.md`。

第二个增量将 Supervisor 事件缓存与日志保留分离：缓存限制为 1 MiB 编码字节及 2048 条事件，淘汰部分通过原 journal 按需校验读取，正常恢复和结束不丢内容。完整恢复协议暂未分页到 Host/Webview，完整响应、Host 缓存及 completed 内联仍可能增长；这不是进程总内存上限，也不改变历史保留承诺。设计与阶段验证见 `docs/design-docs/runtime-journal-bounded-cache.md`。

候选比较、可重跑基线与建议矩阵见 `docs/design-docs/runtime-persistence-storage-reevaluation.md`，原始上游证据见 `docs/references/terminal-persistence-open-source-survey.md`。其余运行时改造分阶段规划。

第三个增量将分页真正接入新协议 live Host/Webview：Host 不保留完整后缀，Webview 应用 checkpoint 后每次读取并应用一页，慢读者所需来源不会被 compact。正常结束仍完整保存历史，已打开读者继续分页读完最终 revision 后才显示退出。新模式暂时断线重试原 Supervisor，不把连接失败当作进程死亡。Linux 真实宿主与协议/浏览器回归已验证，旧 Supervisor 保持兼容；总回放时间、所有在途队列、整体 RSS 与 completed 独立保存尚未完成验收。具体边界见 `docs/design-docs/runtime-paged-terminal-projection.md`。

第四个增量 `docs/design-docs/runtime-completed-no-history.md` 取消已结束历史落盘。Host 保存退出结果后清理原来源，当前生命周期读者只临时消费尾部，读完或关闭即释放；保存时禁止为重开的页面新建旧会话读者。F-05 的新 completed 内联问题收口，不新增历史 server。

第五个增量 `docs/design-docs/runtime-paged-completion.md` 将新能力会话的退出收尾也接入分页，不再全量传输或在 Host 聚合最终历史。保存成功后先停止新 attach/open，已有读者读完或关闭后才删除临时来源；其他窗口尚存的读者不能被一个窗口的清理截断。已结束读者因 socket 失效而不可继续时明确显示读取中断，不自动重开历史或新进程。旧协议保留兼容，运行中会话仍按原绑定重连；总回放、旧模式全量数据、队列和整体 RSS 继续作为 F-04 验证。

## 10. 退出完整性独立交付

当前实施与验收入口（2026-10-02）：两模式已接入 owned provider、逐 reader 结算、最终页面应用及保存/资源释放责任；正常构建、六目标资产分发与默认启用已实现。正式机制、有限预算与已知边界见 `docs/design-docs/runtime-exit-integrity-production-integration.md` §53，A1 至 A6 的有效证据与有限剩余见 `docs/design-docs/runtime-persistence-closeout.md` §8。最终序列化修正 `63847969` 的 run `36979378644` 已独立核对三平台两模式安装及六个真实 Agent snapshot-only stop，包含非空终态语义、原页面与新 Host 重开及资源清理要求，最终受影响验收已收口。未受改动影响的 natural/Runtime 等既有证据复用，本轮 stop 不扩写为模型请求验收；整体审查与 PR 尚待完成。历史失败保留，旧 756-byte 差异的精确控制序列未还原，不将旧失败追认通过，也不宣称已证明其完全同因。

立项记录（2026-09-20，以下方案状态仅指当时）：用户确认将退出完整性纳入本次 Runtime Persistence 重构，作为独立正确性交付项，与容量优化、取消 completed 历史分别验收。完成其他重构不会自动关闭这一问题。已确认的是范围和验收目标；reader、依赖版本、结束原因的接口及用户呈现仍待方案验证，本次仅登记文档，不直接修改业务代码。

自然终止指非显式取消、非强制截断的会话结束，包含零和非零退出码。对当前仍有效的消费者，会话主进程已成功写入终端的尾部必须完整、按序交付和应用，不能缺尾、重复或破坏字符及终端控制序列；自身已接收、排队或消费中的内容也不能因提前清理而丢弃。不承诺恢复程序自身尚未 flush、未写入终端的应用缓冲。退出码反映执行结果，不证明输出完整；主进程退出、真实输出结束、消费者完成应用和主动取消必须区分，不能用 EOF、socket close、静默计时或 final revision 单独替代，也不能把超时或主动截断标记为完整 EOF。

同日补充职责边界：画板管理 Terminal / Agent 执行会话及其终端资源，不把每个后代作为独立托管对象。Terminal 内的命令、子进程和后台任务由 shell、应用及操作系统管理，Agent 工具命令及其后代由 Agent 管理。实际会话主进程退出后，不默认承诺维持节点或终端以等待这些后代结束或接收未来输出；主进程仍运行时，同一终端收到的输出仍正常处理，不能按后代来源忽略。父子关系与前后台关系是不同维度，不能仅凭父进程先退出就称其后代为交互式 shell 后台作业。这项边界同样适用于两类节点，不改变轻量节点的保存规则。

启动链是独立例外：`Supervisor → cmd.exe / CLI 启动器 → 实际 Agent CLI` 中，实际 CLI 是执行主体，不是可排除的工具后代。必须验证启动链能正确代表实际执行主体的生命周期，不能未经证明就把包装程序退出当作 Agent 结束。立项时尚未选定具体收尾边界、取消条件和时间预算；当前方案与逐项验证状态以本节开头的正式入口为准，不用普通后代诊断代替真实启动链验收。

范围覆盖 Agent/Terminal、live-runtime Supervisor 与 snapshot-only 直接 Host 路径，以及 Linux/macOS/Windows 的实际受支持执行环境。Remote SSH 按执行端平台验收。这里纳入 snapshot-only 的共同退出正确性，不改变它的快照保留或关闭语义；第 9 节 Runtime 结束后不恢复进程和正文、Supervisor/机器故障后无需恢复的边界也不变。

验收必须继续满足以下结果，具体机制与数值预算已在生产接入方案中登记，是否通过按有限证据表逐项判断；既不把历史“未验”重排为新阶段，也不把局部或旧版本通过外推为所有组合通过：

- 严格大输出、非零退出、UTF-8 与 ANSI/OSC 尾片、慢消费和多读者均完整交付；以独立写入完成凭证和逐层内容对账验证，不仅观察退出事件或末尾 marker。原生 Windows ConPTY 的合法转换按终端语义校验。
- stop 请求不立即切断输出；正常排空、强制停止、显式 delete 取消和读取错误可辨认，不能把中断写成完整交付。一个读者取消不截断其他有效读者，也不要求重新创建已删除页面来展示尾部。
- 主进程自身尾部与已接收、排队或消费中的内容完成处理，最终终端状态正确应用并释放资源；主进程仍运行时收到的后代输出不被忽略。
- 实际主进程退出后普通后代继续输出仅作 PTY 生命周期、EOF、挂断与取消诊断，不以收到它们的未来输出作为独立产品验收门槛。若主动取消或触及期限，不能伪装成完整 EOF；这不豁免主进程尾部及既有内容的收尾要求。
- 启动包装程序与实际 Agent CLI 分开记录身份和退出事件；真实启动链的生命周期另行验证，不能用通用后代实验代替真实 provider 证据。
- 当前读者读完或取消后回收临时资源，Runtime 重开仍无 completed 正文且不自动执行；旧 live session 保持原 Supervisor 绑定，升级 Host 不替旧实现补造完整性保证。
- `snapshot-only` 的显式 `stop` 若保存了非空终端快照，必须在新 Host 重开阶段核对保存内容、可见行、尺寸、光标、viewport、buffer 类型、节点序列及无新执行；不能因首 Host 已完成保存和 replay 就跳过页面等价验收。空快照继续保留既有空页面 origin 断言。
- Linux/macOS/Windows 原生 PTY、实际 VS Code/Electron 与 packaged 路径分别留证；Windows 记录 builtin/DLL 路径，真实 provider 与 fake-provider 证据分开。本次只要求上述现代 runner 作为验收输入；旧系统环境缺失不阻塞本次重构，但现代 runner 结果不得宣称旧系统兼容。

冻结的后代实验、原始断言和失败结果继续保留，不修改旧测试求绿，也不追认历史失败为通过。macOS 后代场景失败不能单独证明 Agent / Terminal 产品退出缺陷，亦不能据此宣布 macOS 全部验收通过；产品阻塞与底层诊断的重新分类及理由见退出完整性设计第 18 节。

历史契约与诊断矩阵见 `docs/design-docs/runtime-exit-integrity.md`，当前正式方案及有效验收入口见本节开头，推进计划见 `docs/exec-plans/completed/runtime-exit-integrity.md`。候选实验前固定版本、重复轮次、资源和等待预算，保留首次失败，不靠延长等待、放宽内容断言或重跑到成功收口。退出完整性的既定受影响验收未结账前不能宣布该项完成；全部 A1 至 A6 与整体审查另按有限收尾定义判断。

旧系统兼容边界（2026-10-02）：macOS 10.13/10.14、Windows 10 1809 及其他低版本不属于本次重构的验收前置，也不因现代 runner 通过而被视为已验证。后续若收到低版本的实际兼容报告，再按独立问题修复和验收；在此之前不修改 `engines` 或平台守卫来伪造最低版本提升。
