# 运行时持久化模式规格

当前状态：草案。本文档用于收口 `Agent` / `Terminal` 在关闭画布、关闭 VSCode 与重新打开后的运行时持久化语义，重点区分“恢复上下文”与“真实进程继续存在”两种不同承诺。

## 1. 用户问题

当前画布已经可以恢复对象图、节点标题、尺寸、最近输出摘要和部分 `Agent` 恢复上下文，但这还不能满足更强的工作连续性诉求：

- 用户关闭画布或切换宿主 surface 时，不希望正在工作的 `Agent` / `Terminal` 被无声杀死。
- 用户关闭整个 VSCode 后，希望在某些场景下 `Agent` 仍能继续工作，等下次打开 VSCode 时再看到结果。
- 当系统做不到“真实进程继续存在”时，用户仍希望重开后能看到尽量完整的关闭前状态，而不是只剩一个空白节点。
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
   - 若真实进程不再存在、已自然结束、监督器不可达，或重新附着失败，有可用历史时进入 `历史恢复`，否则明确表达运行时不可用；不能伪装成同一进程仍在运行。Supervisor 崩溃或机器重启后不要求一定能恢复历史。
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
- 用户可辨认“当前附着的是 live 进程”还是“恢复的是历史状态”

## 5. 不在范围内

- Supervisor 自身崩溃或机器重启（含断电）后的原进程恢复与终端历史恢复，2026-09-17 由用户确认不作保证；不要求为此新增灾备服务
- 多机同步、跨设备漫游或云端托管运行时
- 无限制地长期保留后台进程而没有任何用户可见治理能力
- 第一版就覆盖 Dev Container / Codespaces 场景
- 对 provider 原生恢复能力做超出其自身保证的承诺
- 把“历史快照恢复”伪装成“原进程仍在运行”

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

以下 `live-runtime` 进程连续性与输出重连验收以 Supervisor 仍存活为前提；Supervisor 自身崩溃或执行机器重启后，可以没有可恢复的进程和终端历史，此时只需准确表达原运行时已丢失，不能伪装成原 live 会话。这个例外不改变画板节点、布局及用户文档的保存语义，也不要求主动清除已可读的历史。`strong` backend 不额外承诺机器/监督器故障后的恢复，`snapshot-only` 的现行保证不在本轮调整。

- 在 `snapshot-only` 与 `live-runtime` 两档模式下，关闭画布、切换 surface 或 Webview reload 都不会无声终止当前 `Agent` / `Terminal` 会话。
- 当系统选中 `systemd-user` backend 时，关闭 VSCode 或断开 Remote SSH 后，真实 `Agent` / `Terminal` 进程仍可继续存在；重新打开 VSCode 后，系统会优先重新附着到原会话，而不是只恢复一个静态快照。
- 在 Linux 本地或 Remote SSH workspace 中，如果 `systemd-user` backend 不可用，系统会自动降级到 `legacy-detached`，并把 guarantee 标成 `best-effort`，而不是继续把它伪装成强保证。
- 当运行时持久化开关开启且节点带有持久化 live 会话身份时，VSCode 重开后节点先显示 `重连中`；只有在重新附着成功后，才恢复为 `运行中`、`等待输入`、`live` 等真实生命周期状态。
- 当系统无法重新附着到 live runtime 时，有可用历史的 `Terminal` 会明确进入 `历史恢复`；`Agent` 的 provider 原生显式 session resume 仍遵循既有策略。Supervisor 崩溃或机器重启后不要求一定存在历史或触发 provider 恢复；任何新启动进程都不能伪装成原进程延续。
- 当运行时持久化开关关闭时，关闭 VSCode 后系统会在刷盘最后状态后结束现有 `Agent` / `Terminal` 进程；重新打开时，系统至少恢复节点、标题、位置、尺寸、最后状态、最近输出摘要和恢复入口。
- 当系统恢复的是历史状态而不是 live 进程时，用户能明确识别这一点，系统不会把它伪装成“仍在运行的同一会话”。
- 当节点处于 `live-runtime` 时，系统会把当前 runtime backend 与 guarantee 写入日志与诊断信息；节点默认 UI 只保留与当前操作直接相关的状态，不直接暴露 `systemd-user / best-effort` 这类调试字段。
- 当 `Agent` 在 `live-runtime` 模式下于 VSCode 关闭期间继续执行时，用户下次打开 VSCode 后能看到关闭期间新增的执行结果。
- 当用户执行 Reload Window，或关闭 VSCode 后等待 `Agent` 继续输出再重新打开时，重新附着后的节点内容与 runtime backend 观察到的输出顺序一致，不因 Host/Webview 重建而缺失、重复或从任意 ANSI 控制序列中间开始。
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

## 9. 容量与 completed 历史的待重评边界

2026-09-16，用户确认当前完整 journal 后缀的内存/恢复传输成本，以及 completed 恢复数据进入画板 JSON 后的反复重写，是需要优先重新评估的架构问题，分别对应 `docs/design-docs/webview-host-supervisor-architecture-review.md` 的 F-04/F-05。这不等于现有实现已被证明违反本文的完整性语义，也不表示本轮接受截断历史或新存储格式；实现仍遵循现行 lossless 设计。

后续设计必须分别说明原进程延续、有限终端屏幕/scrollback、未消费输出、completed 可读历史和 provider resume 的保证。tmux / WezTerm 的 daemon 保活、tmux-resurrect 的命令重建、VS Code 的 reconnect/revive 可作为比较输入，但重启命令不等于 Agent 原执行继续存在，有限 buffer 也不自动替代本产品要求的完整恢复材料。

待确认的产品决策包括正常 completed 的历史保留范围/期限、必要时的磁盘配额与满盘行为、首次终端可交互的时间预算，以及明确删除历史的用户操作。2026-09-17 用户确认 Supervisor 自身崩溃或机器重启后不要求恢复进程或终端历史；因此持久 journal、跨重启 checkpoint 和独立归档不是天然必需，内存终端模型加受控缓存/按需临时存储可以进入比较，具体实现未选定。该例外不适用于 Supervisor 存活时的 Host/Webview 重建或连接断开，也不授权无条件覆盖未消费内容；连接失败本身不能证明 Supervisor 已崩溃。

建议后续验收同时覆盖以下结果，具体预算与实现尚未确定，不能标记为已通过：

- checkpoint 长期不能推进时，增加历史不再要求所有历史常驻每层内存或进入一个恢复消息；同时测总恢复耗时，不能只把大消息拆小就宣称恢复性能收口。
- 正常 completed 保留规则明确后，历史读取独立于画板保存；移动节点、修改 Note 等普通画板操作不重写历史。用户此次没有取消当前正常 handoff 的行为；Supervisor 崩溃或机器重启后的历史不在保证范围内。
- 若采用独立归档，在 Supervisor 仍存活时发生写入/引用错误或 Host 在 handoff 期间退出，至少一个完整来源继续可读；多窗口或多 root 的有效引用不能被提前清除。Supervisor 崩溃/断电后不再要求通过该恢复验收。
- Agent / Terminal 在持续输出、客户端离线重建和多窗口读取期间继续满足原进程身份、内容顺序与输入公平性；任何保证变化先明确产品边界。
- Supervisor 崩溃、机器重启或断电后，节点明确显示运行时丢失/中断，不把重新启动的进程或残留文件显示成原 live session。

候选比较、可重跑基线与建议矩阵见 `docs/design-docs/runtime-persistence-storage-reevaluation.md`，原始上游证据见 `docs/references/terminal-persistence-open-source-survey.md`。运行时改造另行规划。
