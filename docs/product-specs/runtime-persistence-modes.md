# 运行时持久化模式规格

当前状态：草案。本文档用于收口 `Agent` / `Terminal` 在关闭画布、Reload Window、关闭 VSCode、Supervisor 重启与重新打开后的运行时持久化语义，重点区分“恢复显示投影”“重新附着同一真实进程”和“用 provider identity 启动一个新的 Resume 进程”三种不同承诺。

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
   - Host 先比较节点保存的 Supervisor instance identity 与当前 Supervisor；identity 相同才尝试重新附着同一真实进程，legacy 节点缺 identity 时只允许一次兼容探测。
   - 重新附着成功后，节点保持真实生命周期，但每个新 Webview surface 独立进入 `Restoring` 显示投影；bulk open只选择checkpoint与initial target，checkpoint和journal按credit/ACK正序分块发送。若恢复期间head增长，target与pin单调扩展并继续走相同路径；追平一次session operation观察到的稳定head、原子接上live subscription后才完成。
   - Supervisor instance 已改变、监督器不可达或 attach 明确失败时，旧 PTY 不再被视为可恢复 runtime。`Agent` 若有可信 provider identity 则进入 `resume-ready`；只有用户点击 Resume 才启动新进程。`Terminal` 进入 closed/history 并提供 Restart。
   - 新 Supervisor 不恢复旧 registry namespace，不扫描旧 Journal event，不等待全局 `recovering -> ready`，也不显示全局恢复进度；新建 Agent / Terminal 立即可用。
6. 当扩展升级且旧版 Supervisor 仍持有 live 会话时：
   - 旧会话继续由旧 Supervisor 承载，允许降级 output、input、resize、stop 与 delete；界面明确提示旧协议不能证明完整终端历史。
   - 升级后新建的 Agent / Terminal 立即由当前协议代 Supervisor 承载，不等待旧会话结束。
   - 最后一个旧会话结束后，旧 Supervisor 自然退出；当前 Supervisor 和新会话不受影响。

### 场景语义矩阵

| 场景 | 真实运行时 | 内容承诺 | 用户可见状态与动作 |
| --- | --- | --- | --- |
| Webview 隐藏后再次显示 | Host、Supervisor、PTY、原 xterm 均存活 | non-destructive redraw，不重新 attach 或 replay | 保持真实 lifecycle |
| Webview recreate / Reload Window，Supervisor instance 相同 | PTY authority 仍存活，只丢失当前 surface 投影 | 恢复 retention/scrollback 本应保留的完整历史；逐节点、分块、边收边显示，动态追平稳定head后原子接live | `attached-live + Restoring`，stable-head handoff完成后才`ready` |
| snapshot-only PTY 随 Host 死亡 | 原 PTY 不可重附着 | 只展示已有持久化内容，不补造 live 输出 | Agent 显式 Resume；Terminal Restart/history |
| Supervisor restart / instance 改变 | 旧 PTY authority 已丢失 | 启动期不恢复旧 runtime；screen snapshot/recent output 仅为可选增强 | Agent `resume-ready`；Terminal closed/history |
| 正常 completed session | 已合法 finalization | 保留完整 final history，但存入独立 archive、按需分块显示 | completed/closed，可 Resume 或新开 |
| 升级时旧 Supervisor 仍可达 | 旧 Supervisor 仍持有真实 PTY | capability-gated 继续交互并自然 drain | 不强杀；新会话进入当前 generation |

“完整历史”指按产品 retention 与 `terminal.integrated.scrollback` 规则本应保留的内容，不代表无限期永久 transcript，也不能为了 reload 性能再额外截断。

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
- 每个 Webview surface 上独立的 terminal projection 恢复、输入门禁与多节点优先级
- 关闭 VSCode 后的重开语义
- 日志摘要、最后状态与恢复入口的持久化边界
- 用户可辨认“当前附着的是 live 进程”还是“恢复的是历史状态”

## 5. 不在范围内

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
- 创建该 runtime session 的 Supervisor instance identity；该 identity 用于判断是否仍可能附着同一个 PTY authority

### 日志与恢复上下文

- 最近输出
- 最近退出信息
- `Agent` 的 provider 显式恢复身份与恢复失败原因
- 关闭前的最后已知状态
- `live-runtime` 会话的输出恢复权威属于生命周期长于 Extension Host 的 runtime backend；Host/Webview snapshot 只能作为缓存或显示投影，不能独立声明后台输出完整
- backend / PTY 已死亡时，节点名称、provider、resume strategy、`resumeSessionId` 与 provider 必需 locator 构成 Agent 恢复入口的最低数据；`serializedTerminalState` 和 recent output 是可选增强，缺失不能阻塞 Resume
- runtime backend 提供稳定会话身份和连续输出位置，使新 Host 能恢复关闭期间产生的内容并无缝接到重新附着后的 live output
- 正常 completed terminal history 使用独立 immutable archive 保存；Canvas state 只保存轻量引用，不把大 history 内联进每次画布持久化或 Webview 状态广播

## 7. 验收标准

- 在 `snapshot-only` 与 `live-runtime` 两档模式下，关闭画布、切换 surface 或 Webview reload 都不会无声终止当前 `Agent` / `Terminal` 会话。
- 当系统选中 `systemd-user` backend 时，关闭 VSCode 或断开 Remote SSH 后，真实 `Agent` / `Terminal` 进程仍可继续存在；重新打开 VSCode 后，系统会优先重新附着到原会话，而不是只恢复一个静态快照。
- 在 Linux 本地或 Remote SSH workspace 中，如果 `systemd-user` backend 不可用，系统会自动降级到 `legacy-detached`，并把 guarantee 标成 `best-effort`，而不是继续把它伪装成强保证。
- 当运行时持久化开关开启且节点带有持久化 live 会话身份时，VSCode 重开后节点先显示 `重连中`；只有在重新附着成功后，才恢复为 `运行中`、`等待输入`、`live` 等真实生命周期状态。
- 当节点已经重新附着同一 live runtime、但新 Webview 尚未应用完动态目标 revision 或尚未完成 stable-head live handoff 时，该节点显示 `Restoring`；这只表示当前 surface 的显示投影进度，不把健康的 `waiting-input` 节点改写成待恢复 runtime。
- 新 Supervisor 启动时不得处理旧 registry namespace、全量读取 Journal event或逐 segment metadata扫描，也不得等待全局 recovery phase；hello、创建新 Agent / Terminal和普通control必须立即可用。
- 当 Unix socket 缺失、Supervisor 就绪超时与 PTY spawn 失败发生时，界面必须分别解释为 runtime 连接/恢复问题、runtime 启动超时和外部 executable 问题；不得把任意 `ENOENT` 统一显示为 Codex 或 shell 缺失。
- 当系统无法重新附着到已死亡的 live runtime 时，`Terminal` 会明确进入 closed/history 并提供 Restart；`Agent` 若持有 provider 原生显式 session identity 则进入 `resume-ready` 并提供 Resume 按钮，只有用户点击后才启动新的 provider resume 进程，否则进入历史态或 `interrupted`。终端画面或 recent output 缺失不得阻塞这些动作。
- 当运行时持久化开关关闭时，关闭 VSCode 后系统会在刷盘最后状态后结束现有 `Agent` / `Terminal` 进程；重新打开时，系统至少恢复节点、标题、位置、尺寸、最后状态、最近输出摘要和恢复入口。
- 当系统恢复的是历史状态而不是 live 进程时，用户能明确识别这一点，系统不会把它伪装成“仍在运行的同一会话”。
- 当 PTY 已死亡时，系统不承诺必须有最后屏幕或 recent output；若已有则可辅助回忆，但旧 Journal 不参与 Supervisor 启动或 runtime 状态恢复。orphan Journal 的保留、GC或显式历史工具是独立待定策略。
- 当节点处于 `live-runtime` 时，系统会把当前 runtime backend 与 guarantee 写入日志与诊断信息；节点默认 UI 只保留与当前操作直接相关的状态，不直接暴露 `systemd-user / best-effort` 这类调试字段。
- 当 `Agent` 在 `live-runtime` 模式下于 VSCode 关闭期间继续执行时，用户下次打开 VSCode 后能看到关闭期间新增的执行结果。
- 当用户执行 Reload Window，或关闭 VSCode 后等待 `Agent` 继续输出再重新打开时，重新附着后的节点内容与 runtime backend 观察到的输出顺序一致，不因 Host/Webview 重建而缺失、重复或从任意 ANSI 控制序列中间开始。
- Reload Window 的 terminal历史按节点独立分块恢复，收到块后立即显示，不等待当前节点完整hydrate或整张画布完成；选中节点优先、viewport可见节点次之、后台节点最终完成。
- bulk open返回的target只作为initial target；当前target应用并ACK后若journal head增长，pin与target必须原子、单调扩展，新增区间继续受相同credit/chunk/Webview ACK约束。只有一次session operation观察到稳定head并原子注册live subscription后才返回`done/live`、把surface转为`ready`并开放输入；不得在ready后另起无credit的`R+1...head`重放。
- 节点处于 `queued/restoring` 时只禁用该节点的普通输入且不缓存按键；Stop/Kill等紧急控制仍可用，其他ready节点、Note编辑、新建节点和画布操作不受影响。
- 健康Agent/Terminal的input、resize、stop和lifecycle control不得等待或携带完整checkpoint/journal payload；Agent按Enter后不应先显示`running`而输入与回显仍长时间停在发送前。
- 多个执行节点同时高输出且用户只在一个节点输入时，当前输入节点优先响应；其他节点可以延后显示，但系统不得为了输入性能丢弃尚未消费的增量内容。
- 当 `Agent` 没有 provider 原生显式 session identity 时，系统不得使用“最近一次会话”推断来伪装自动恢复；此时节点应退化为 `interrupted` 或历史态。
- 当用户关闭运行时持久化开关时，下一次关闭 VSCode 后，不再对真实 `Agent` / `Terminal` 进程跨编辑器生命周期存活做承诺。
- 当旧版 Supervisor 会话在升级时仍然运行，用户可以继续输入并通过 resize 触发 TUI 重绘；系统不会把旧 raw tail 冒充完整 checkpoint，也不会因为旧会话存在而阻止当前版本创建新 Agent / Terminal。
- 新旧 Supervisor 并行期间，input、resize、stop、delete 和 output 必须按节点持久化的 runtime storage / session identity 路由，不能把一个 generation 的操作发给另一个 generation。
- completed terminal history 即使大于 5 MiB，也不得进入 Canvas state 的常规 clone/hash/stringify、Note更新、新建节点持久化或普通 `host/stateUpdated`；显式打开该节点时仍须按保留规则完整显示。
- 新completed finalizer必须在打开fixed projection或持有revision pin前取得全局archive-store admission，当前并发上限为1；等待者不持pin。admitted finalizer直接把chunk流式写入canonical与projection sidecar临时文件并增量校验，不得经过完整`TerminalStream`、assembler、full `Buffer`或`readFile`；archive原子提交和Canvas ref durable barrier都成功后才能解绑runtime并删除journal，failure/cancel必须释放reader、pin、admission并保留唯一完整来源。
- 对没有被明确记为 blocker 或外部平台边界的组合，第一版应尽量做到完整实现；当前已确认的本地 workspace / Remote SSH 与 `Agent` / `Terminal` 四种组合都不应被故意拆成“先做一半、另一半留后面”。

## 8. 开放问题

- Dev Container / Codespaces 何时进入 `live-runtime` 正式支持范围。
- live journal、dead PTY orphan journal和completed archive分别保留多久、采用什么总容量与GC策略。
- dead PTY orphan journal是仅供诊断、提供显式历史工具，还是在保留期后直接GC；无论选择哪项，都不进入Supervisor启动关键路径。
- provider除`resumeSessionId`外确实需要哪些可信locator，以及如何避免重新引入extension-private home或“最近会话”推断。
- `Restoring`在节点标题栏使用主status pill还是独立次级badge；数据模型保持正交，具体视觉层级仍需用Playwright和真实多节点画布验证。
