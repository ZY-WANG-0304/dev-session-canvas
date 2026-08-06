# 以终端标题活动信号增强 Agent 运行态

本 ExecPlan 是活文档。它必须按照仓库根目录的 `docs/PLANS.md` 持续维护；本计划只覆盖 terminal title 作为运行态增强信号的设计与后续实现，不改变 Agent 节点的产品主状态集合。

## 目标与全局图景

用户在画布同时运行多个 Codex 或 Claude Code Agent 时，应能更可靠地区分“本轮仍在工作”和“正在等待下一条输入”，且扩展不能为了状态判断改写 provider 配置。完成本计划后，Agent 仍只展示既有的 `running` 与 `waiting-input` 主状态；明确 submit、PTY quiet/activity、active turn 内的 Attention Signals 与 provider 主动写入的 terminal title spinner 构成当前无 hook 主路径，title/bottom activity 可以把弱 waiting 纠正回 `running`，attention 可以把 active turn 降为 `attention / best-effort waiting-input`。

用户可观察的结果是：一条静默或失焦后又恢复 title spinner 的 Codex/Claude Code 回合不会继续错误显示“等待输入”；进程终态或用户中断后的会话不会被 title 或其他终端 chrome 重开。标题文字本身不进入节点内容、持久化状态或通知，Codex/Claude 的用户配置保持不变。

## 进度

- [x] (2026-07-30) 核对 Codex `0.146.0` 与 Claude Code `2.1.209` 的 terminal title 传输与 working 条件。
- [x] (2026-07-30) 复核 `agentActivityHeuristics`、`agentProviderLifecycle`、Extension Host 与 Runtime Supervisor 的双路径状态迁移。
- [x] (2026-07-30) 将证据优先级、状态边界、隐私约束和验证口径写入正式设计文档。
- [x] (2026-08-04) 根据用户决策移除 hook/notify 作为状态判断路径，并将 provider 配置不变列为硬验收条件。
- [x] (2026-08-04) 明确 quiet fallback 与连续两帧 title activity 采用顺序无关、幂等的同一回合 reducer。
- [x] (2026-08-05) 根据用户决策允许 active turn 内的 BEL/OSC 9/OSC 777 作为 `attention / best-effort waiting-input` evidence，并保持 allow-list/通知 bridge 与 lifecycle 解耦。
- [x] (2026-08-05) 实现增量 OSC 0/2 title parser、Codex/Claude provider profile 与 `terminal-title` / `attention` activity source。
- [x] (2026-08-05) 在 local PTY 与 live-runtime Supervisor 接入弱等待恢复，移除新会话 lifecycle callback/notify 注入，并补齐纯逻辑、启动不侵入性与 Supervisor 回归。
- [x] (2026-08-06) 修复 `ESC | ]` OSC introducer 与 `ESC | \` String Terminator 的合法 PTY 分块 carryover，并补齐两帧 title activity 回归与 generation 路径隔离覆盖。
- [ ] 在当前安装的 Codex 与 Claude Code 上执行真实 CLI / Extension Development Host smoke；记录版本和仅含 frame 的证据。

## 意外与发现

- 观察：现有 `recordAgentOutputHeuristics()` 会把任意 PTY chunk 当作 activity，因此 title output 本身会刷新 quiet clock；但节点已经处于 `waiting-input` 时，现有恢复路径只观察 headless xterm 的屏幕底部，而 OSC title 不会写入该屏幕，状态不会因此恢复。
  证据：`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts` 只维护 `lastActivityAtMs`；`CanvasPanelManager.ts` 与 `runtimeSupervisorMain.ts` 的 waiting recovery 只调用 `recordAgentBottomScreenActivity()`。

- 观察：Codex 与 Claude Code 都使用 OSC 0 设置标题，但 activity frame、刷新速度和是否在失焦时暂停不同；OSC 0/2 是标题通道，不是通用的“Agent working”协议。
  证据：Codex `0.146.0` 的 title spinner 为十个 Braille frame、100ms 一帧，条件为 MCP startup 或 `is_task_running()`；Claude Code `2.1.209` 仅在 `busy` 时轮换 `⠂/⠐`，idle/waiting 保持 `✳`。

- 观察：当前 Runtime Supervisor 已在此前 provider lifecycle 工作中从 `terminal-stream-v1` 切换到 `agent-provider-lifecycle-v1`。terminal-title work 可以停止声明 `agentProviderLifecycleV1`，且现有 snapshot 对 `activitySource` 的新增值仍保持可读取，但不需要在当前 generation 之上再次创建 storage generation。
  证据：`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts` 声明当前 generation；`scripts/test/test-runtime-supervisor-paths.mjs` 断言两代 storage/socket 路径隔离，`npm run test:runtime-supervisor-protocol` 覆盖 title recovery fixture、journal recovery 与 10-Agent capacity regression。

## 决策记录

- 决策：只将被 provider profile 确认的连续 title animation 当作正向活动证据；active turn 内的 BEL/OSC 9/OSC 777 可作为 `attention / best-effort waiting-input` 证据，但静态 title、标题清除、`Action Required`、OSC 133 或任意 attention 都不能确认 completed/failed。
  理由：attention transport 缺少 turn identity，只能表达“需要注意/可能等待输入”；title animation 也只能证明 provider UI 报告了活动，不能替代结构化回合完成。
  日期/作者：2026-07-30 / Codex。

- 决策：title activity 只能维持当前已提交回合的 running，或把 `heuristic / best-effort waiting-input` 恢复为 running；不得单独创建回合、不得把 Agent 从 starting/resuming 改为 running、不得推翻进程终态或确认后的 interrupt。
  理由：title 没有 provider turn identity，Codex 还会在 MCP startup 时转动；必须维持“明确提交才能开启回合”的不变量。
  日期/作者：2026-07-30 / Codex。

- 决策：放弃 Codex `notify` 与 Claude lifecycle hooks 作为状态判断路径，不生成、不注入 lifecycle 配置或临时 settings；现有 callback 实现只作为历史兼容清理对象，不驱动新会话主状态。
  理由：hook/notify 会改变用户配置，可能覆盖既有 hook、受 safe/bare 模式影响，并把状态正确性绑定到 callback 是否送达；这不符合无侵入的 PTY Agent 目标。用户显式开启的 Claude 文件活动 `PostToolUse` hook 是独立数据域，允许继续存在，但不得提供 lifecycle 事件或 callback 环境。
  日期/作者：2026-08-04 / 用户确认，Codex 记录。

- 决策：连续两次不同的已知 frame、且间隔不超过 2500ms，才确认 animation；确认后只持久化 `activitySource: terminal-title` 和 `activityAuthority: best-effort`。active turn 内确认 attention signal 进入弱 waiting 时，使用 `activitySource: attention` 和同样的 `best-effort` authority；两者都不持久化 raw title、payload 或其哈希。
  理由：两帧能过滤单个静态 Braille 字符和无关 title，同时覆盖 Codex 100ms 与 Claude Code 960ms 的当前实测 cadence；title 可能含项目路径、会话名或用户文本，不能成为状态存储或诊断内容。
  日期/作者：2026-07-30 / Codex。

- 决策：不为 terminal-title work 在现有 `agent-provider-lifecycle-v1` 之上单独创建 Runtime Supervisor storage generation。新字段是可安全忽略的 activity-source 枚举扩展，parser state 只保存在活进程内；旧 Supervisor 继续输出既有三种 source，新 Host 对未知 source 仍 fail closed。此前已经发生的 `terminal-stream-v1` 到 `agent-provider-lifecycle-v1` 切换仍然有效：旧会话通过持久化 `runtimeStoragePath` 访问旧 namespace，自然 drain，无迁移或 PTY 重启。
  理由：terminal-title 本身不改变 PTY ownership、journal、session identity 或恢复格式，但 generation 名称会影响 storage、socket 与 systemd unit namespace。若实施时发现旧 Host 对新 source 会拒绝整份 snapshot，再升级为显式 capability/generation 方案。
  日期/作者：2026-07-30 / Codex。

- 决策：quiet fallback 与连续两帧已知 title activity 由共享 reducer 按观察时间处理，先后顺序无关且重复事件幂等。
  理由：timer 回调与 PTY parser 可能在不同事件循环时序到达；`title -> quiet` 必须允许真实静默后进入弱 waiting，`quiet -> title` 必须允许同一回合恢复 running，不能让调度顺序改变最终生命周期语义。title activity 只更新内存 `lastActivityAtMs`，持续 title 才能持续延后 quiet fallback，不得永久锁定 running。
  日期/作者：2026-08-04 / 用户确认，Codex 记录。

- 决策：Attention Signals 与 title/quiet lifecycle 使用并行但共享状态边界的 reducer；active turn 内 BEL、OSC 9、OSC 777 可产生 `attention / best-effort waiting-input`，异常退出/异常输出继续只产生 attention/error。
  理由：Codex 的完成/审批/elicitation 等多个内部事件可能共用 OSC 9/BEL transport，Claude 的终端 bell 也缺少跨 provider 的 turn identity；它们适合作为弱 waiting evidence，但不能被提升为 completed/failed 或在终态后重开回合。allow-list/bridge 只控制产品提醒，不应屏蔽 lifecycle 的弱证据。
  日期/作者：2026-08-04 / 用户确认，Codex 记录。

## 结果与复盘

设计与代码实现已完成，正式方案已同步到 `docs/design-docs/agent-running-state-detection.md`。`agentTerminalTitleActivity.ts` 只在内存解析 OSC 0/2，`agentActivityHeuristics.ts` 交付 title/attention evidence，Host 与 Supervisor 用共享 lifecycle reducer 写入弱等待边界；新会话不再注入 Codex notify 或 Claude lifecycle hooks。当前 `agent-provider-lifecycle-v1` 是此前已发生的 Supervisor generation 升级；旧 `terminal-stream-v1` 会话通过持久化 `runtimeStoragePath` 保持连接旧 storage/socket/systemd-unit namespace，直到自然 drain，terminal-title 不再额外创建 generation。2026-08-05 与 2026-08-06 已通过 `npm run test:agent-terminal-title-activity`、`npm run test:runtime-supervisor-paths`、`npm run test:agent-provider-lifecycle`、`npm run test:execution-attention-signals`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck`、`npm run build` 与 `git diff --check`，其中 Supervisor 的 10-Agent capacity regression 一并通过。`npm run test:canvas-execution-context` 本轮仍在进入 title 路径前失败：静态源码扫描把已有 Agent session fork 代码判为 multi-root fork；本项未修改该断言相关代码。真实 Codex/Claude CLI 与 Extension Development Host smoke 尚未在当前环境执行，因此 validation status 保持“验证中”，本计划继续保留 active。

## 上下文与定向

`Agent` 是画布中的常驻 provider CLI 会话，主状态由 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 的 `AgentNodeStatus` 定义。`running` 表示已接受的一轮用户指令尚未结束，`waiting-input` 表示该轮结束后等待下一次提交；它们不是 CLI 进程是否存活的别名。

`extensions/vscode/dev-session-canvas/src/common/agentProviderLifecycle.ts` 保存同一回合的 submission、历史 provider identity 和 `activitySource`；新会话不从 hook/notify 获得状态。明确 submit 是 `derived`，title/attention/quiet fallback 是 `best-effort`，其中 active turn 的 attention 可以直接标记弱 waiting。`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts` 保存 PTY activity、OSC carryover 和弱等待后的屏幕变化；本计划在此域增加不持久化的 title parser state。

本地 PTY 的 owner 是 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`，持续运行会话的 owner 是 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`。两处都调用共享 reducer，而 title profile 集中在 `extensions/vscode/dev-session-canvas/src/common/agentTerminalTitleActivity.ts`，不能各自用正则解析 provider UI。`extensions/vscode/dev-session-canvas/src/common/executionAttentionSignals.ts` 已展示 incremental OSC 的 BEL/ST chunk-boundary 模式，但它处理的是 attention，不能把 title 语义混入其中。

## 工作计划

第一步在 `extensions/vscode/dev-session-canvas/src/common/` 新建只读、增量的 title parser。它只识别 OSC 0 和 OSC 2，支持 `ESC ]` 与 C1 OSC 起始、BEL、String Terminator (ST) 或 C1 ST 终止和任意 chunk 切分。未终止序列须有小的固定 carryover 上限；超限、嵌套 ESC、控制字符或无效编号一律丢弃。parser 向 provider classifier 交付短暂内存中的 title，classifier 立刻只抽取 frame，不把原始 title 送往 metadata、诊断、journal 或 Webview。

第二步定义两个明确版本化的 profile。Codex profile 只认当前源码列出的十个 Braille activity frame；Claude profile 只认 `⠂` 与 `⠐`。profile 以两次不同 frame 的连续序列确认活动，最大间隔 2500ms。配置关闭 title、改变 title item 顺序、失焦暂停、未来 CLI 改 frame 或其他程序复用 title 时，profile 只会漏报，不得把静态/未知 title 误报为完成。

第三步在共享 activity/lifecycle reducer 中增加 `terminal-title` activity source 和只服务可恢复状态的 reducer。该 reducer 要求当前提交回合仍存在、未请求 interrupt、未进入进程终态；它将弱 waiting 恢复成 running 并标注 `terminal-title / best-effort`。quiet timer 与 title observation 必须共享单调 `lastActivityAtMs`，按事件观察时间而非回调先后决定是否达到 5000ms；两种顺序（title 先于 quiet、quiet 先于 title）和重复投递都必须得到一致、幂等结果。运行中收到 animation 不应每帧持久化或广播状态；它最多刷新内存 activity，并在真正从 waiting 恢复时写状态。实现同时删除新会话对 Codex `notify` / Claude hooks 的状态注入与消费。

第三步同时保持 attention transport 与产品提醒分层：复用 `executionAttentionSignals.ts` 解析 BEL/OSC 9/OSC 777；如果当前存在 active turn，原始 signal observation 进入共享 reducer 并把状态标为 `attention / best-effort waiting-input`，同时由 `attentionPending`/通知 bridge 按 allow-list 处理产品提醒。它们可以随原始 PTY chunk 刷新 quiet clock，但不能确认 completed/failed 或在终态后重开回合。`agentAbnormalExit` 和显式开启的 Codex abnormal output text 仍按既有 attention/error 规则处理，不能接入 title recovery reducer。

第四步让 `recordAgentOutputHeuristics()` 报告已确认的 title activity，两个 PTY owner 在同一位置处理恢复：关闭 bottom-screen tracker、清空其临时签名、切回 running、立即持久化生命周期边界并记录不含 title 的诊断。title 先到时不产生每帧状态写入；若之后连续 5000ms 没有任何 PTY/title activity，quiet reducer 仍可进入弱 waiting。进程终态和已确认 interrupt 保持不可恢复；普通 OSC/BEL attention 行为保持原样。

第五步补纯逻辑、Host、Supervisor、provider 配置不变性和人工验证。测试不依赖真实 provider title 文案之外的文本；真实 CLI 仅用于确认对应版本的 raw OSC trace 与 profile 仍匹配。实现完成后把验证结果、失败样本和版本范围回写本计划与正式设计文档。

## 具体步骤

所有命令在仓库根目录执行。实施时应按以下顺序小步推进：

    npm run test:agent-provider-lifecycle
    npm run test:agent-terminal-title-activity
    npm run test:execution-attention-signals
    npm run test:runtime-supervisor-protocol
    npm run test:canvas-execution-context
    npm run typecheck
    npm run build
    git diff --check

在 macOS 真实 CLI smoke 中，用 `script -q /tmp/codex-title.tty codex` 或 `script -q /tmp/claude-title.tty claude` 记录一轮任务。解析记录中的 OSC 0/2，确认 Codex/Claude 的已知 activity frame 至少出现两次不同值；不得把记录文件、完整 title 或用户 prompt 提交到仓库。

## 验证与验收

自动化必须覆盖：BEL 与 OSC 9/777/133 不会改变 lifecycle；OSC 0/2 的 BEL/ST/C1 终止和跨 chunk 解析；超长不完整 payload 被有界丢弃；Codex/Claude 两种 profile 都要两次不同 frame 才确认；静态 idle/wait/action-required/未知 title 都不能确认活动。

状态机测试必须覆盖：无有效 submit 时 title/attention animation 不开始回合；derived running 的 title frame 不产生每帧状态写入；active turn 收到 BEL/OSC 9/OSC 777 后进入 `attention / best-effort waiting-input`；`title -> quiet` 在后续真实 5000ms 静默后进入弱 waiting；`quiet -> title`、`attention -> title` 在同一回合恢复 running 并带对应 source；重复 title/attention/quiet 事件幂等；attention allow-list 只改变 `attentionPending`/通知，不屏蔽 lifecycle 的弱 waiting；进程终态与 confirmed interrupt 后的 title/attention frame 不可恢复。Host 与 Supervisor 要对同一 fixture 得到相同 lifecycle/source。性能回归应证明普通 Terminal 不接入 parser，正常 Agent 不启用额外 xterm screen scan，title 每帧不产生 metadata persistence 或 Webview state storm。

人工 smoke 需要在 Codex 与 Claude Code 各一个当前安装版本上执行：发送一条会工作数秒的任务、在失焦或可控静默条件下观察 title activity、验证节点不会错误停留在 waiting；完成任务或中断后，注入/观察 title chrome 不能重新打开回合，并检查 provider 配置与启动 argv/env 前后保持不变。未覆盖的平台必须记录为待验证，不得外推。

## 幂等性与恢复

parser state 是每个 PTY process epoch 的内存状态，spawn、attach、submit、interrupt、exit 和 dispose 都可安全重置；不会写入 session journal 或 provider 配置。任何 parser/profile 异常都按“没有 title evidence”降级到现有 submit + PTY quiet 路径。若 profile 误匹配、性能预算或旧 Supervisor snapshot 兼容性无法证明，回滚时只移除 title recovery 接线和 source 枚举，既有基础状态机保持可用。

## 证据与备注

本计划依赖的外部事实已记录在正式设计文档：Codex `0.146.0` 使用 OSC 0、10 帧/100ms、`is_task_running()` 或 MCP startup；Claude Code `2.1.209` 使用 OSC 0、busy 时 `⠂/⠐` 每 960ms 轮换、idle/waiting 为固定 `✳`。这些是版本化 implementation evidence，不是跨 CLI 标准。跨终端的标准能力仅是标题传输；本计划不把任意 title 改动泛化为 Agent 推理状态。

本次修订说明：2026-08-04 根据用户确认，将 5000ms quiet fallback 与连续两帧已知 title activity 定义为共享 `lastActivityAtMs` 的顺序无关、幂等事件；补充 `title -> quiet`、`quiet -> title` 和重复事件的实施与验收要求。

本次修订说明：2026-08-05 根据用户确认，active turn 内的 BEL、OSC 9、OSC 777 可以作为 `attention / best-effort waiting-input` evidence；allow-list 仅控制产品提醒，title/bottom activity 仍可恢复 running，异常退出/异常输出不进入该弱 waiting 路径。

本次修订说明：2026-08-05 已实施 parser、双 profile、共享 reducer 和 Host/Supervisor 接线。自动化覆盖 OSC 0/2 的 BEL/ST/C1/跨 chunk/有界 payload、Codex/Claude 两帧 profile、attention 与 OSC 9;4 边界、非侵入 lifecycle 启动，以及 Supervisor 的 quiet -> title 恢复；真实 CLI smoke 仍是唯一未完成验证项。

本次修订说明：2026-08-06 根据 PR review 修复了合法 PTY chunk 在 `ESC | ]`（OSC introducer）和 `ESC | \`（ST）处分割时 parser 丢失状态的问题，并以两帧 Claude title 的端到端回归防止 waiting-input 无法恢复。同步更正 generation 描述：`agent-provider-lifecycle-v1` 是此前既有升级；旧 `terminal-stream-v1` 会话由持久化 `runtimeStoragePath` 保持路由并自然 drain，terminal-title 不创建额外 generation。`test:agent-terminal-title-activity`、`test:runtime-supervisor-paths`、lifecycle/attention/protocol 回归、typecheck、build 与 diff 检查均已通过；真实 CLI / Extension Development Host smoke 仍待执行。
