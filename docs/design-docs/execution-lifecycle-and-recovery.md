---
title: 执行节点生命周期、恢复与自动启动设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/agent-cli-launch-context-and-resume.md
  - docs/exec-plans/completed/agent-running-state-detection.md
  - docs/exec-plans/completed/execution-lifecycle-recovery-and-autostart.md
  - docs/exec-plans/completed/claude-agent-ctrl-z-containment.md
  - docs/exec-plans/completed/runtime-supervisor-dead-pty-bounded-recovery.md
  - docs/exec-plans/completed/runtime-recovery-projection-isolation.md
updated_at: 2026-08-12
---

# 执行节点生命周期、恢复与自动启动设计

## 1. 背景

当前仓库已经实现 `Agent` 与 `Terminal` 两类执行节点的最小主路径，但它们仍然共享一套过于粗糙的状态模型：宿主侧主要靠 `liveSession` 布尔值和 `live / closed / error / interrupted` 几个状态回写节点，前端展示也大多直接覆盖为“运行中”或“未运行”。

这条路线适合验证“会不会跑”，但已经不足以支撑 `功能体验.md` 当前明确提出的三件事：

1. `Agent` 运行状态需要和真实 CLI 语义更接近，而不是只剩“没开 / 在跑”。
2. 原 live runtime 已死亡后，`Agent` 应提供 provider 自身的显式 Resume 入口，而不是一律标成中断或在后台启动新进程。
3. 新建 `Agent` / `Terminal` 节点后应直接进入打开流程，不再要求用户手动点启动。

同时，新的产品判断也已经明确：`Agent` 与 `Terminal` 可以有不同的状态，`Agent` 不必被正式定义成“特殊 Terminal”。当前实现仍然可以用 PTY 适配器承载 provider CLI，但这只是实现策略，不是产品定义。

## 2. 问题定义

本轮需要回答的问题是：

1. `Agent` 与 `Terminal` 的正式生命周期应该如何拆分，才能既保留共通执行能力，又不再把两者硬压成同一状态机。
2. 哪些恢复能力可以被正式承诺，哪些只能明确写成 best-effort。
3. “创建即打开”应该如何落地，才能避免节点尚未测得尺寸时就抢先拉起进程。
4. `Agent` 的显式恢复应该建立在什么样的 provider 身份上，才能不把“最近一次会话”误写成“当前节点自己的会话”。

## 3. 目标

- 为 `Agent` 与 `Terminal` 定义两套可解释、可持久化、可测试的生命周期状态。
- 让 `Agent` 的状态反馈更接近真实 CLI 交互，而不是继续退化成布尔执行态。
- 为 `Agent` 提供 best-effort resume 路径；原 live runtime 已死亡后等待用户明确点击 Resume。
- 让新建执行节点直接进入启动或恢复流程，而不是要求用户额外点一次“启动”。
- 保持“宿主权威状态 + Webview 投影”的总体架构不变。

## 4. 非目标

- 不在本文件重复定义 live-runtime 的跨 Host 投影协议；同一 Supervisor instance 的 Window Reload 必须重新附着原 authority 并按 surface 恢复完整 retained projection，具体边界由 [运行时控制面、显示投影与恢复隔离](./runtime-control-and-projection-isolation.md) 负责。snapshot-only PTY 随 Host 死亡后的最低历史承诺仍是独立边界。
- 不在本轮把 `Agent` 做成完整的多 Agent orchestrator。
- 不在本轮为 `Agent` 引入完全脱离现有 PTY 适配器的全新 backend；当前只把边界设计成可演进，而不是一步到位重写实现。
- 不在本轮处理“关闭 VSCode 后真实 `Agent` / `Terminal` 进程仍继续存在”的运行时持久化；该主题由 [docs/design-docs/runtime-persistence-and-session-supervisor.md](./runtime-persistence-and-session-supervisor.md) 单独收口。

## 5. 候选方案

### 5.1 继续共享一套执行状态机

特点：

- `Agent` / `Terminal` 继续共用 `liveSession` 和相同状态集合。
- 只在文案层区分对象类型。

不选原因：

- 这会继续把 `Agent` 的恢复语义、CLI 语义和 `Terminal` 的进程语义混在一起。
- 第 4 条需求主要落在 `Agent`，共享状态机无法表达 `resume-ready`、`resuming`、`resume-failed` 这类关键差异。

### 5.2 差异化生命周期 + 共享消息桥

特点：

- `Agent` 与 `Terminal` 保持各自状态集合。
- 宿主与 Webview 仍共享同一套消息协议、布局状态和基础执行桥。
- `Agent` 当前可继续通过 PTY 适配器承载 provider CLI，但状态推进不再等同于 `Terminal`。

当前选择原因：

- 这是当前复杂度最低、同时又能正面解决 3/4/5 的路线。
- 它允许实现层复用 `node-pty`、尺寸同步和输出桥，又不给产品定义强加“Agent 必然是 Terminal”。

### 5.3 彻底分离 `Agent` runtime 与 `Terminal` backend

特点：

- `Agent` 立即切到专属 runtime。
- `Terminal` 继续保留 PTY。

当前不选原因：

- 这会把本轮从“收口状态与恢复”升级成“重做 Agent backend”，风险和范围都过大。
- 当前更值钱的工作是先把状态、恢复和自动启动边界写对，再为未来替换 runtime 留出接口。

## 6. 正式方案

当前正式结论如下：

- `Terminal` 仍定义为画布中的嵌入式终端会话窗口。
- `Agent` 定义为画布中的执行会话窗口；当前可以由 provider CLI 的 PTY 适配器承载，但产品定义不再等同于“特殊 Terminal”。
- `Agent` 与 `Terminal` 同属执行节点家族，但不要求共享完全一致的状态机。

建议的最小状态集合如下。

`Terminal`：

- `idle`：尚未启动，或尚未真正发起自动启动。
- `launching`：已收到启动意图，正在等待或建立 PTY。
- `live`：终端会话仍活跃。
- `stopping`：用户已请求停止，正在等待进程退出。
- `closed`：终端正常结束或被用户停止。
- `error`：启动失败或异常退出。
- `interrupted`：原有活动会话已经确认失去 authority 且没有可用历史/重启收口；同一 Supervisor instance 的普通 Window Reload 不进入该状态。

`Agent`：

- `idle`：尚未启动。
- `starting`：正在启动新的 provider 会话。
- `waiting-input`：CLI 已进入可继续交互的等待态。
- `running`：CLI 正在处理输入或持续输出。
- `resuming`：正在恢复之前的 provider 会话。
- `resume-ready`：原 PTY authority 已确认死亡，但仍持有可信 provider 原生 session identity，等待用户显式启动新的 resume 进程；同一 Supervisor instance 的普通 Window Reload 不进入该状态。
- `resume-failed`：恢复尝试失败，节点保留失败原因与恢复上下文。
- `suspended`：历史兼容状态。旧版本可能把 Claude Code `Ctrl-Z` 文案写成该状态；当前 direct-spawn Claude Agent 不再把 suspend 文案当成生命周期权威信号，也不提供前台恢复动作。若读到旧 `suspended`，UI 只允许停止后重启。
- `stopping`：用户已请求停止。
- `stopped`：Agent 会话已正常结束或被用户停止。
- `error`：启动失败或异常退出。
- `interrupted`：原本是活动态，但没有可用恢复路径。

恢复边界明确如下：

- `Agent` / `Terminal` 的 `live-runtime` descriptor若与当前 Supervisor instance一致，Window Reload只重建Host/Webview attachment与surface-local projection：Host重新附着同一authority，Webview按credit/chunk/ACK恢复retained history并在stable-head handoff后接回live。真实lifecycle保持不变，不能降级成`interrupted`或`resume-ready`。
- Supervisor instance已经变化或旧socket明确不可达时，原PTY authority才视为死亡。`Terminal`进入closed/history并提供Restart；`Agent`只有在持有provider原生显式session identity时才进入`resume-ready`，否则进入历史态或`interrupted`。Resume只由用户点击后创建新的provider PTY，不是对旧进程的重新附着。
- snapshot-only PTY随Host退出而死亡时也按dead-instance结果收口，但它不具备live-runtime的same-instance reattach保证。

当问题变成“关闭整个 VSCode 后重新打开”时，本文件里的生命周期状态还需要叠加运行时持久化文档定义的附着态语义。第一版的用户可见规则是：

- 只有节点保存的 Supervisor instance identity 与当前进程相同，或 legacy 节点的一次兼容探测尚未得到结果时，才进入 `重连中`；instance 已变化时旧 PTY authority 已丢失，不能等待 namespace 恢复。
- 若重新附着成功，再切回本文件定义的真实生命周期状态。
- 若无法重新附着，`Terminal` 显示 closed/history 并提供 Restart；`Agent` 则先检查是否存在可用 provider resume 上下文，若有则转成 `resume-ready` 并等待用户点击 Resume，否则显示历史态或 `interrupted`。screen snapshot/recent output 只帮助回忆，缺失不影响动作可用性。

生命周期、runtime attachment 与 Webview display projection 是正交状态。同一个健康 Agent 可以同时是 `waiting-input`、`attached-live`，并在刚重建的 panel surface 上处于 `projectionState=restoring`；这不表示 runtime 待恢复。projection state 只存在于每个 `(surface,node,generation)` 的 Webview controller，不持久化到节点状态。当前 surface 的节点在 `queued/restoring` 期间显示 `Restoring`，禁止且不缓存普通输入；bulk open 的 initial target 与 pin 随 journal head 单调扩展，所有 backlog 都经过 credit/chunk/ACK，只有追平一次 session operation 中观察到的稳定 head、原子注册 live subscription 并收到 `done/live` 后，才恢复真实 lifecycle 标签和输入。其他 ready 节点、Note、新建节点与 Stop/Kill 紧急控制不受这条局部门禁影响。完整时序见 [运行时控制面、显示投影与恢复隔离](./runtime-control-and-projection-isolation.md)。

自动启动边界明确如下：

- 新建 `Agent` / `Terminal` 节点时，宿主只写入“待启动意图”，不立即同步拉起进程。
- 节点在 Webview 中完成尺寸测量后，由统一的启动消息把待启动意图转成真正的 fresh start 或 resume。
- 已持久化的待恢复 `Agent` 节点只使用该机制恢复按钮可用性；不得写入自动 resume 的待启动意图。

对 `Agent` 的 provider 启动上下文与恢复身份，还需要补充以下硬约束：

- `Agent` 会话必须在 repo/workspace 工作目录启动；它不应被切到扩展私有目录中运行。
- 插件默认继承用户已有 CLI 配置与认证上下文；设置项只负责选择可执行文件，不负责改写 provider 的 home / config 根目录。
- `resume-ready` 只应建立在 provider 原生显式 session identity 之上；`resume --last`、交互式 picker 或“最近会话推断”都不能作为正式自动恢复语义。
- 如果某个 provider 还没有被验证出可可靠持久化并恢复显式 session identity，或拿到的 identity 仅来自启发式反查，节点应退化为 `interrupted` 或历史态，而不是继续伪装成可恢复。
- `Agent` 的内部生命周期与节点主状态都保留 `running / waiting-input` 区分；节点处于可继续输入的阶段时，应稳定显示 `waiting-input`，而不是被粗暴收口成 `running`。
- Claude Agent 节点不支持普通终端的 `Ctrl-Z` / `fg` job-control 语义。当前实现直接 spawn `claude`，没有外层交互 shell 的 job table；因此 `Ctrl-Z` 必须在 Webview、宿主和 runtime supervisor 写入路径被阻断，并提示用户使用停止、恢复或分叉。Claude 输出里的 suspend / `fg` 文案只能作为诊断文本，不得触发新的生命周期状态。
- `Agent` 的 `running / waiting-input` 仍然是正式用户语义，但“这些状态如何被判定出来”需要单独按 [docs/design-docs/agent-running-state-detection.md](./agent-running-state-detection.md) 的优先级收口：优先使用 provider 原生结构化事件，其次才是结构化输出、shell integration 和 PTY 启发式。

这部分详细边界以 [docs/design-docs/agent-cli-launch-context-and-resume.md](./agent-cli-launch-context-and-resume.md) 为准。

## 7. 风险与取舍

- 取舍：`Agent` 继续复用 PTY 适配器，但不再把 PTY 上升为产品定义。
  原因：这能在不重写 backend 的前提下，先把状态和恢复语义收口正确。

- 风险：`Agent` 的 `running / waiting-input` 当前仍需要从可观察事件推断，未必能像 provider 原生 UI 那样精细。
  当前缓解：把状态定义为“用户可观察的最小语义”，并把当前基于提交与 quiet period 的实现明确降级为 fallback；长期主路径按 [docs/design-docs/agent-running-state-detection.md](./agent-running-state-detection.md) 改为 provider 原生结构化事件优先。

- 风险：`Codex` 在当前环境中仍未确认存在 fresh start 后可直接读取 session identity 的标准接口。
  当前缓解：新的正式设计已经禁止把 `resume --last` 当成自动恢复主路径；如果后续为了兼容而临时采用日志、状态目录或列表接口反查，也只能作为显式登记的技术债务，而不是正式恢复能力。

- 风险：自动启动会把启动 race 暴露得更明显。
  当前缓解：统一通过“待启动意图 + 节点尺寸就绪后启动”的机制消化 race，而不是在创建节点时立即 spawn。

## 8. 验证方法

至少需要完成以下验证：

1. `Agent` 与 `Terminal` 在 UI 上能展示不同的生命周期状态，而不是都退化为“运行中 / 未运行”。
2. 新建执行节点后，无需手动点启动按钮，节点会自动进入 fresh start。
3. Window Reload后若Supervisor instance相同，live `Agent` / `Terminal`重新附着原authority；节点保持真实lifecycle，每个新surface只经历`queued/restoring/ready`，不进入`interrupted`或`resume-ready`。
4. Supervisor instance变化或旧socket明确不可达后，`Terminal`进入closed/history并提供Restart；`Agent`只有具备可信provider session identity时才进入`resume-ready`，且用户点击Resume前不得启动新的provider进程。
5. 用户点击 Resume 后，`Agent` 节点进入 `resuming`；恢复失败时进入 `resume-failed` 并显示明确失败原因。
6. Claude Agent 在同一 live 会话中按 `Ctrl-Z` 时不应把 `\u001a` 写入 provider PTY；Webview 显示明确错误提示，宿主和 runtime supervisor 也拒绝该输入。普通 Terminal 与非 Claude Agent 不受这条 Claude 专属阻断规则影响。
7. 旧 `suspended` Agent snapshot 仍可渲染，但不再出现“恢复”或“恢复中”入口；用户只能停止后重启。
8. `npm run typecheck`、`npm run build`、`npm run test:smoke` 与 `npm run test:webview` 通过。

## 9. 当前验证状态

- 2026-04-08 已完成代码落地，并通过 `npm run typecheck`、`npm run build`、`npm run test:smoke` 与 `npm run test:webview`。
- 2026-04-08 smoke曾覆盖当时的snapshot-only/旧实现语义，包括`Terminal`在Host重载后进入`interrupted`；该历史结果不再定义当前live-runtime Window Reload行为。
- `Claude Code` 的 session id / resume CLI 能力已在本机 `--help` 输出层面确认。
- 2026-04-12 已重新收口 `Agent` 的启动上下文与恢复身份：恢复必须建立在 provider 原生显式 session identity 上，不能再以隔离 provider home 或 `resume --last` 作为正式口径。
- 2026-06-10 曾尝试把 Claude Code `Ctrl-Z` 文案收口为 `suspended` 与前台恢复动作；2026-06-11 根据用户真实观察撤销该结论。撤销原因是 direct-spawn Claude Agent 没有普通 shell job table，`SIGCONT` 或 provider 文案都不足以承诺等价于 `fg` 的可交互恢复。
- 2026-06-11 当前收口方向改为阻断 Claude Agent `Ctrl-Z`：Webview 不发送该输入，宿主与 runtime supervisor 也拒绝写入，并移除恢复协议与 UI 入口。`suspended` 仅作为旧 snapshot 兼容状态保留。
- 当前文档仍保持“验证中”，因为跨 provider 与真实交互验证尚未闭环：`Codex` 的标准 session identity 获取接口仍未确认，当前 reboot smoke 也没有点击真实 Resume/Restart；Claude Agent `Ctrl-Z` 阻断已补局部自动化，仍建议在 MR 阶段做真实 Claude Code 手动验收。
- 2026-08-12 已明确区分两条路径：same-instance Window Reload重新附着原authority并恢复surface projection；dead-instance才把Agent收口到显式`resume-ready`、Terminal收口到closed/history + Restart。当前`runtime-supervisor-reboot-recovery`真实宿主smoke只证明Host可启动、Agent展示Resume action且没有自动spawn、Terminal保留history状态；它没有点击真实Resume/Restart按钮。按钮点击后的新进程/失败状态仍由既有定向生命周期测试覆盖，不能把该reboot smoke写成真实点击证据。
