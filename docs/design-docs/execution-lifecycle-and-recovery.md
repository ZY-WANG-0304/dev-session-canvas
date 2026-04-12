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
  - docs/exec-plans/active/agent-cli-launch-context-and-resume.md
  - docs/exec-plans/active/agent-running-state-detection.md
  - docs/exec-plans/completed/execution-lifecycle-recovery-and-autostart.md
updated_at: 2026-04-13
---

# 执行节点生命周期、恢复与自动启动设计

## 1. 背景

当前仓库已经实现 `Agent` 与 `Terminal` 两类执行节点的最小主路径，但它们仍然共享一套过于粗糙的状态模型：宿主侧主要靠 `liveSession` 布尔值和 `live / closed / error / interrupted` 几个状态回写节点，前端展示也大多直接覆盖为“运行中”或“未运行”。

这条路线适合验证“会不会跑”，但已经不足以支撑 `功能体验.md` 当前明确提出的三件事：

1. `Agent` 运行状态需要和真实 CLI 语义更接近，而不是只剩“没开 / 在跑”。
2. 扩展重载后，`Agent` 应优先尝试 provider 自身的 resume，而不是一律标成中断。
3. 新建 `Agent` / `Terminal` 节点后应直接进入打开流程，不再要求用户手动点启动。

同时，新的产品判断也已经明确：`Agent` 与 `Terminal` 可以有不同的状态，`Agent` 不必被正式定义成“特殊 Terminal”。当前实现仍然可以用 PTY 适配器承载 provider CLI，但这只是实现策略，不是产品定义。

## 2. 问题定义

本轮需要回答的问题是：

1. `Agent` 与 `Terminal` 的正式生命周期应该如何拆分，才能既保留共通执行能力，又不再把两者硬压成同一状态机。
2. 哪些恢复能力可以被正式承诺，哪些只能明确写成 best-effort。
3. “创建即打开”应该如何落地，才能避免节点尚未测得尺寸时就抢先拉起进程。
4. `Agent` 的自动恢复应该建立在什么样的 provider 身份上，才能不把“最近一次会话”误写成“当前节点自己的会话”。

## 3. 目标

- 为 `Agent` 与 `Terminal` 定义两套可解释、可持久化、可测试的生命周期状态。
- 让 `Agent` 的状态反馈更接近真实 CLI 交互，而不是继续退化成布尔执行态。
- 为 `Agent` 提供 best-effort resume 路径，并在扩展重载后自动尝试恢复。
- 让新建执行节点直接进入启动或恢复流程，而不是要求用户额外点一次“启动”。
- 保持“宿主权威状态 + Webview 投影”的总体架构不变。

## 4. 非目标

- 不在本轮承诺跨扩展重载恢复 `Terminal` 的完整活动 buffer。
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

## 6. 当前结论

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
- `interrupted`：扩展重载后，原有活动会话已丢失且无法恢复。

`Agent`：

- `idle`：尚未启动。
- `starting`：正在启动新的 provider 会话。
- `waiting-input`：CLI 已进入可继续交互的等待态。
- `running`：CLI 正在处理输入或持续输出。
- `resuming`：正在恢复之前的 provider 会话。
- `resume-ready`：扩展重载后存在可恢复上下文，但尚未完成恢复。
- `resume-failed`：恢复尝试失败，节点保留失败原因与恢复上下文。
- `stopping`：用户已请求停止。
- `stopped`：Agent 会话已正常结束或被用户停止。
- `error`：启动失败或异常退出。
- `interrupted`：原本是活动态，但没有可用恢复路径。

恢复边界明确如下：

- `Terminal`：同一扩展进程内跨 surface 可重附着；扩展重载后不承诺完整活动态恢复，只显式标记为 `interrupted`。
- `Agent`：若节点带有 `live-runtime` 身份，则扩展重载后先尝试 reattach 原 live runtime；只有在 reattach 不可用且节点仍持有 provider 原生显式 session identity 时，才降级到 provider resume；若 provider 不支持或上下文缺失，则分别落到 `resume-failed`、`interrupted` 或历史态。

当问题变成“关闭整个 VSCode 后重新打开”时，本文件里的生命周期状态还需要叠加运行时持久化文档定义的附着态语义。第一版的用户可见规则是：

- 只要节点带着 `live-runtime` 的会话身份重新进入恢复流程，且系统尚未确认 live runtime 仍存在，主状态标签显示 `重连中`。
- 若重新附着成功，再切回本文件定义的真实生命周期状态。
- 若无法重新附着，`Terminal` 显示 `历史恢复`；`Agent` 则先检查是否存在可用 provider resume 上下文，若有则转成 `resume-ready` 并继续自动恢复，否则才显示 `历史恢复`。

自动启动边界明确如下：

- 新建 `Agent` / `Terminal` 节点时，宿主只写入“待启动意图”，不立即同步拉起进程。
- 节点在 Webview 中完成尺寸测量后，由统一的启动消息把待启动意图转成真正的 fresh start 或 resume。
- 已持久化的待恢复 `Agent` 节点也使用同一条机制进入自动恢复。

对 `Agent` 的 provider 启动上下文与恢复身份，还需要补充以下硬约束：

- `Agent` 会话必须在 repo/workspace 工作目录启动；它不应被切到扩展私有目录中运行。
- 插件默认继承用户已有 CLI 配置与认证上下文；设置项只负责选择可执行文件，不负责改写 provider 的 home / config 根目录。
- `resume-ready` 只应建立在 provider 原生显式 session identity 之上；`resume --last`、交互式 picker 或“最近会话推断”都不能作为正式自动恢复语义。
- 如果某个 provider 还没有被验证出可可靠持久化并恢复显式 session identity，或拿到的 identity 仅来自启发式反查，节点应退化为 `interrupted` 或历史态，而不是继续伪装成可恢复。
- `Agent` 的内部生命周期与节点主状态都保留 `running / waiting-input` 区分；节点处于可继续输入的阶段时，应稳定显示 `waiting-input`，而不是被粗暴收口成 `running`。
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
3. 扩展重载后，live 的 `Terminal` 节点被标记为 `interrupted`。
4. 扩展重载后，live 的 `Agent` 节点只有在具备可信恢复上下文时，才会自动进入 `resuming` 并尽量恢复。
5. 恢复失败时，`Agent` 节点进入 `resume-failed` 并显示明确失败原因。
6. `npm run typecheck`、`npm run build`、`npm run test:smoke` 与 `npm run test:webview` 通过。

## 9. 当前验证状态

- 2026-04-08 已完成代码落地，并通过 `npm run typecheck`、`npm run build`、`npm run test:smoke` 与 `npm run test:webview`。
- smoke test 已覆盖：差异化状态集、创建即自动启动、`Agent` 恢复、`Terminal` 在扩展重载后的 `interrupted`、surface cutover、停止竞态和失败路径。
- `Claude Code` 的 session id / resume CLI 能力已在本机 `--help` 输出层面确认。
- 2026-04-12 已重新收口 `Agent` 的启动上下文与恢复身份：自动恢复必须建立在 provider 原生显式 session identity 上，不能再以隔离 provider home 或 `resume --last` 作为正式口径。
- 当前文档仍保持“验证中”，因为新的显式 session identity 约束尚未完成代码落地与真实 provider 验证，而 `Codex` 的标准 session identity 获取接口也尚未确认；这项缺口由 [docs/design-docs/agent-cli-launch-context-and-resume.md](./agent-cli-launch-context-and-resume.md) 继续跟踪。
