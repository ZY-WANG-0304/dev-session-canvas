# 用底部 spinner 与实测 quiet fallback 收口 Agent PTY 状态

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

完成后，Agent 普通回合不再解析 `>`、`›`、`❯` 等 prompt glyph 来结束 `running`。用户提交有效输入后进入 `running`，任意 PTY 输出刷新 quiet 时钟；若 PTY 连续 N 毫秒没有任何输出，基础状态机以 `heuristic / best-effort` 进入 `waiting-input`。只有这项弱结论成立后才扫描终端底部活动，用于发现同一回合重新运行并纠正状态。N 必须由本轮受控和真实 PTY 实验选定，不能沿用没有依据的 1600ms。

quiet fallback 得到的是可纠正的弱结论：同一回合后续重新输出或出现底部活动 spinner 时，应恢复 `running`。Codex notify 与 Claude hooks 继续只作为辅助增强信号；provider completion 可以更早进入带 identity/outcome 的 `waiting-input`，callback 缺失不关闭基础状态机。不引入 Codex app-server，不扩展 Claude hook 类型。

## 进度

- [x] (2026-07-21 10:20 CST) 用户确认 prompt glyph 不能作为任何 lifecycle 判断特征。
- [x] (2026-07-21 10:20 CST) 用户确认底部 spinner 可作为强 running 证据，PTY 连续 Nms 无输出可作为 waiting-input fallback，N 需实验确定。
- [x] (2026-07-21 11:05 CST) 盘点当前 raw-chunk spinner、prompt/OSC/BEL completion 与 headless xterm 屏幕状态能力。
- [x] (2026-07-21 11:42 CST) 运行六组真实 PTY 实验，比较 3s/5s/8s/15s，选择 5000ms。
- [x] (2026-07-21 13:15 CST) 实现 Host/Supervisor 共用的底部活动判断、quiet fallback 与 heuristic waiting 自纠正。
- [x] (2026-07-21 19:54 CST) 更新纯逻辑、Supervisor、Host smoke、正式设计和技术债。
- [x] (2026-07-21 19:54 CST) 完成实现验证；归档计划，提交、rebase、推送并更新 PR #269 作为交付收尾动作继续执行。
- [x] (2026-07-22 00:45 CST) 按用户复核把 bottom-screen tracking 从所有 Agent `running` 轮询收窄到仅在可纠正的弱 `waiting-input` 中启用，并重新完成聚焦测试、类型检查、构建和 trusted smoke。

## 意外与发现

- 观察：当前所谓 prompt 只是对清理 ANSI 后的累计输出尾部应用通用 glyph 正则，不是 Codex/Claude composer 或终端屏幕语义。
  证据：`agentActivityHeuristics.ts` 的 `AGENT_PROMPT_PATTERN` 只接受行尾独立的 `>、›、❯、≫、»`；真实 Codex composer 会在 glyph 后显示 placeholder，回答正文也可出现相同 glyph。

- 观察：当前 spinner 也不是“底部活动 spinner”，而是 raw chunk 中任意 `\r`、backspace、部分光标控制或 spinner 字符；它无法区分回答正文、其他屏幕区域和当前活动区域。
  证据：`AGENT_SPINNER_REDRAW_PATTERN` 与 `AGENT_SPINNER_GLYPH_PATTERN` 直接作用于输出 chunk，`lastSpinnerAtMs` 只有最近出现时间，没有屏幕位置或跨帧变化。

- 观察：Codex CLI 0.144.5 与 Claude Code 2.1.209 在 6s/15s 静默 Bash 工具期间仍持续刷新 TUI。四个回合的 active 最大 PTY gap 分别为 Codex 42.2/43.4ms、Claude 337/329.4ms；已启动 TUI 内提交的 6s 回合为 Codex 41.6ms、Claude 460.5ms。
  证据：本地 gitignored trace 位于 `.debug/agent-pty-timing/*.json`；实验禁用 Codex notify，并以 Claude `--safe-mode` 禁用 hooks，避免增强 callback 影响基础 PTY 观测。

- 观察：已启动 TUI 内按下提交到首个强运行画面，Codex 为 41.2ms、Claude 为 119.4ms；CLI 冷启动与升级检查延迟不能混入该数值。
  证据：交互实验先等待 composer quiet，再分开发送文本与 Enter；Codex 同时设置 `check_for_update_on_startup=false`。

- 观察：真实 spinner 不一定处在物理终端最后八行。100x30 实验中 Codex spinner/底部状态位于当前屏幕第 15/20 行，Claude 位于第 11/16 行。
  证据：最初按物理末八行实现时，Supervisor recovery fixture 无法观察活动；改为当前屏幕最下方非空内容区域后，fixture 在连续两帧后恢复 `running`。

- 观察：固定 120ms 采样可能与 120ms 两帧动画相位锁定，单看采样时最终字符会漏掉中间变化。
  证据：Supervisor fixture 首次使用 120ms 交替帧时复现；terminal tracker 现为每个已解析 output batch 维护单调 change version，轮询读取版本而不是只比较采样瞬间字符。

- 观察：若 bottom activity 签名默认对所有 `SerializedTerminalStateTracker` 生效，普通 Terminal 的极端输出也会承担逐 batch 屏幕扫描，破坏既有洪峰性能边界。
  证据：rebase 后首次 trusted smoke 在 9 万行 Terminal fixture 中超时，并出现 ptyHost heartbeat 告警；将追踪改为 Agent evaluator 显式 opt-in 后，同一 smoke 通过。Supervisor 容量回归中 CPU 从约 1320ms 降至 900ms，output complete 从约 272ms 降至 149ms。

- 观察：即使只对 Agent opt-in，正常 `running` 阶段的 bottom-screen 扫描仍然冗余。
  证据：任何 PTY 输出都会先刷新 `lastActivityAtMs`，使 5000ms quiet 条件不成立；持续输出已经足以保持 `running`，无需再计算 screen signature 证明同一件事。bottom activity 的独立价值只存在于 fallback 已经产生弱 `waiting-input` 之后，用于纠错恢复。

## 决策记录

- 决策：完全删除 prompt glyph lifecycle 特征；prompt 输出只按普通 PTY 输出刷新 quiet 时钟。
  理由：glyph 会与回答正文、placeholder、版本/语言/宽度变化冲突，无法证明 turn 已结束。
  日期/作者：2026-07-21 / 用户确认，Codex 记录。

- 决策：generic OSC/BEL 只保留 attention 语义，不再结束普通 Agent turn。
  理由：它们可能表示审批、提醒或其他事件，不等价于 provider 已结束当前回合；继续使用会把 prompt glyph 的歧义替换成 notification 歧义。
  日期/作者：2026-07-21 / Codex，已由纯逻辑回归验证。

- 决策：quiet fallback 必须从 submit 或最近输出时间开始，弱 waiting 之后保留 turn correlation，并允许后续活动纠正回 running。
  理由：完全静默的回合也必须有 fallback；弱证据可能提前命中，状态机需要自我修复而不是永久错误。
  日期/作者：2026-07-21 / Codex。

- 决策：N 取 5000ms，Host 与 Supervisor 共用一个常量。
  理由：实测最慢 active gap 为 460.5ms，5s 提供约 10.8 倍余量；3s 只有约 6.5 倍且更容易受样本外调度停顿影响，8s/15s 则会显著增加 callback 缺失时的完成延迟。该值是当前版本/平台的经验策略，不是 provider 保证。
  日期/作者：2026-07-21 / Codex，按用户要求实验确定。

- 决策：底部活动定义为“当前屏幕最下方非空内容区域的字符或样式连续变化”，不匹配 spinner glyph、prompt glyph 或 provider 文案。
  理由：Codex spinner 可通过样式变化刷新，且两种 TUI 的内容不一定贴物理屏幕底部；屏幕区域和时间序列比 raw chunk 控制字符更接近用户看到的活动。
  日期/作者：2026-07-21 / Codex。

- 决策：用户输入后 600ms 内的 composer 回显不累计强活动；强证据需要两次变化且相邻变化不超过 1000ms。
  理由：避免用户在 heuristic waiting composer 中打字时误恢复 `running`，同时覆盖实测 460.5ms 最大活动 gap。真正 submit 会通过 submission intent 直接进入 `running`，不依赖这条恢复路径。
  日期/作者：2026-07-21 / Codex。

- 决策：正常 `running` 不启用 bottom-screen tracking；只有 5000ms quiet 进入可纠正的 `heuristic / best-effort waiting-input` 后才启用，并在恢复、新 submit、interrupt 确认或 provider lifecycle 事件后关闭。
  理由：running 中任意输出已经刷新 quiet 时钟，屏幕扫描不会提供额外判定信息；延后启用可以让普通 Terminal 和正常运行 Agent 都不承担逐 batch 屏幕扫描。
  日期/作者：2026-07-22 / 用户确认，Codex 记录。

## 结果与复盘

本计划完成。Agent 普通回合完全删除 prompt glyph、generic OSC/BEL 和 raw chunk spinner 的 completion 语义；有效 submit 或最近 PTY 输出启动 5000ms quiet clock。正常 `running` 不启用 `SerializedTerminalStateTracker` 活动追踪；只有 quiet fallback 已进入可纠正的弱 `waiting-input` 后，才在现有 16ms parsed-output batch 后维护当前屏幕最下方非空内容区域的字符/样式签名和单调 change version。这样既能在弱等待后观察 Codex 的样式动画、避免固定采样与 spinner 同频时漏掉中间帧，也让普通 Terminal 和正常运行 Agent 都不承担屏幕扫描开销。

quiet fallback 进入 `heuristic / best-effort waiting-input` 并保留 turn correlation。后续连续底部活动可以在约两个 polling tick 内恢复 `running`；用户输入后 600ms 的 composer 回显不累计强证据，provider authoritative completion 和已确认 interrupt 因 turn 不再 recoverable 而不会被重开。Host 与 Supervisor 共用相同 reducer；旧 Supervisor wire protocol 与 generation 不变，已有会话继续自然 drain。

N 选择为 5000ms：六组真实 PTY 样本的最大 active gap 为 460.5ms，5s 约有 10.8 倍余量；3s 余量更小，8s/15s 对 callback 缺失场景的完成反馈过慢。该实验只覆盖当前 Linux 环境、Codex 0.144.5 与 Claude 2.1.209，因此 5s 仍是经验值；provider 停止动画、终端严重调度停顿或其他平台 PTY 缓冲超过阈值时，静态长回合仍可能先进入弱 waiting，但后续活动可自纠正。跨平台与未来 CLI 版本应复测 cadence，而不是把 5s 当成协议常量。

验证通过：`test:agent-provider-lifecycle`、`test:serialized-terminal-state-tracker`、`test:runtime-supervisor-protocol`、`test:debug-launch-config`、`typecheck`、`build`、trusted VS Code smoke 与 `git diff --check`（最后一项在提交前再次执行）。Supervisor 回归覆盖 prompt/OSC/BEL 无语义、5s fallback、fallback 后底部活动恢复、authoritative completion 不重开；10 Agent 压测继续通过性能门槛。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts` 保存 submit/最近输出活动、最近输入和底部跨帧活动，并评估可纠正的 `waiting-input`；OSC/BEL 仍由 attention parser 消费，异常流检测保持独立。

`extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts` 使用 `@xterm/headless` 维护 local 与 Supervisor 都已有的终端屏幕模型。它当前只公开序列化状态，写入会以 16ms batch 异步 drain；如果复用它读取底部行，必须提供可测试的只读快照并保证评估发生在对应输出已解析后，不能每个 chunk 强制完整 serialize/flush。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 拥有 local PTY；`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 拥有 live-runtime PTY。两条路径都已有 `SerializedTerminalStateTracker` 和相同的 `AgentActivityHeuristicState`，状态迁移必须调用共享 helper，不能各自解析 Codex/Claude 文案。

`extensions/vscode/dev-session-canvas/src/common/agentProviderLifecycle.ts` 保存 derived submission、provider turn identity 和来源权威性。当前 heuristic waiting 会保留 correlation 供延迟 callback 升级；本轮还需要允许同一 derived turn 的后续 PTY 活动把 `heuristic / best-effort` waiting 恢复成 `running`，但 provider authoritative completion 不能被普通 chrome 重开。

## 工作计划

先为实验建立最小 PTY trace：记录每个输出 chunk 的单调时间、可见底部行、spinner 活动与回合完成时间。受控 fixture 覆盖无输出、固定间隔 spinner、spinner 暂停恢复和 callback 缺失；真实 Codex/Claude 只运行少量明确任务，用于确认 TUI frame cadence 与回合内最大静默，不把单次样本包装成平台保证。比较 3s、5s、8s、15s 等候选，选择能覆盖样本和必要安全余量、同时保持合理完成延迟的 N。

随后扩展共享终端 tracker 或增加共享 screen activity helper，读取 active buffer 底部若干行并识别跨帧变化。将 submit 时间写入 heuristic activity，任意 PTY 输出刷新 quiet 时钟；quiet 达到 N 后先进入可纠正的 best-effort waiting，再临时启用 screen activity tracking，以底部活动时间序列而不是单个 glyph 作为恢复 `running` 的证据。

Host 与 Supervisor 接入同一 reducer。删除 prompt/notification completion 与旧断言；新增 callback missing、完全静默、长静默、spinner 活动、spinner 冻结、fallback 后恢复输出、provider completion 后 chrome 不重开等回归。最后同步设计、能力矩阵与技术债，执行完整验证并更新 PR。

## 具体步骤

所有命令在仓库根目录执行。实验命令和结果会在执行后补写；实现后的基础验证至少包括：

    npm run test:agent-provider-lifecycle
    npm run test:runtime-supervisor-protocol
    npm run test:debug-launch-config
    npm run typecheck
    npm run build
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
    git diff --check

## 验证与验收

自动化必须证明 prompt glyph、OSC 和 BEL 都不会单独结束普通 running；正常 running 不启用屏幕追踪，持续 PTY 输出通过刷新 quiet 时钟保持 running；无任何输出或输出停止时在 N 后进入 heuristic waiting；fallback 之后才启用 bottom activity tracking，连续变化会恢复 running；provider completion 可以提前结束并且后续终端 chrome 不会推翻 authoritative waiting。

N 的实验验收必须记录候选值、样本最大输出间隔、spinner frame cadence、completion detection latency 和已知反例。若真实样本不足以证明单一跨 provider 值，应选择 provider-specific policy 或明确保守默认，不得伪装成普适常量。

## 幂等性与恢复

实验不得修改用户 Codex/Claude 配置；使用临时 HOME/config 或现有 CLI 的显式参数，真实模型请求保持最少。测试临时文件由脚本清理。实现 patch 不触碰用户的 `image.png`。如果某个 screen-level 方案需要侵入 xterm 私有接口或每 chunk flush，先停在实验结论，不把高性能风险实现直接提交。

## 证据与备注

当前已知反例是：1600ms 来自 2026-04-13 第一版 heuristic，没有阈值实验依据；仓库已有三秒静默回归证明它过短。真实 Codex 截图显示 composer glyph 后带 placeholder，且回答正文中也会出现 `>`，证明 prompt glyph 不具备判定价值。

## 接口与依赖

不新增外部 runtime 依赖。优先复用 `@xterm/headless` 和现有 `SerializedTerminalStateTracker`，但共享 bottom activity API 必须可显式启停、只读、低开销并可在 local/Supervisor 两条路径使用。`evaluateAgentWaitingInputTransition()` 只评估实验确定的 quiet policy，不读取 bottom activity 或 provider 文案；bottom reducer 独立服务于弱 waiting 恢复。callback envelope、identity 校验和 Supervisor wire capability 保持兼容。

计划修订说明：2026-07-21 创建计划，记录用户确认删除 prompt glyph、使用 bottom spinner 强运行证据和实验选择 quiet fallback N 的方案；同日补齐六组 PTY 实验、5000ms 决策、screen activity 相位锁定发现、实现与完整验证，并归档。2026-07-22 根据用户对持续输出路径的复核，把 screen tracking 从正常 running 二次验证进一步收窄为仅服务弱 waiting 恢复，并重新通过聚焦测试、类型检查、构建与 trusted smoke。
