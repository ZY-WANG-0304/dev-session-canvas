# 重构 Agent / Terminal 无损输入输出与恢复链路

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本计划遵循仓库根目录的 `docs/PLANS.md`。历史故障定位已经完成，当前阶段先比较并验证持久执行权威的恢复表示，再进入实现；尚未验证的 checkpoint/journal 细节不得写成正式结论。

## 目标与全局图景

这次工作要重新建立 Agent / Terminal 输入输出内容的清晰边界。用户最终应能同时运行多个执行节点，持续看到完整、顺序正确且不过度滞后的当前内容；切换画布可见性、重开 Webview、重连 live runtime 或会话结束时，不应因为显示重建而缺行、回退到旧画面、解析残缺 ANSI 控制序列，或让后台节点永久拿不到最终输出。输入、控制消息和当前节点真实回显也不应被其他节点的输出洪峰淹没。

第一阶段不直接改运行时代码，而是回答三个问题：PR #152 引入了哪些内容表示和调度机制；后续 PR #176、#203、#229、#236 分别证明了哪些假设不成立；当前实现中哪些事实源、派生状态和恢复缓存仍被混用。研究完成后，仓库应有一份可追溯的问题诊断设计文档，并明确下一阶段候选方案、验证实验和迁移边界。

## 进度

- [x] (2026-07-10 23:20 +0800) 锁定最新 `origin/main` 的 `5355e6a`，并在独立研究 worktree 中开始 PR 历史与当前实现调查。
- [x] (2026-07-10 23:23 +0800) 读取 `AGENTS.md` 指定的工作流、ExecPlan、设计、产品、架构、UI 与前端入口文档，确认本任务属于多步设计研究和后续显著重构。
- [x] (2026-07-10 23:27 +0800) 锁定 PR #152 的范围、提交、文档记录与现场诊断；确认它同时修改输入诊断、输出调度、持久化、Webview backlog reset、snapshot hydrate、`outputSequence` 和链接解析。
- [x] (2026-07-10 23:30 +0800) 追踪 PR #176、#203、#229、#236，确认后续分别暴露 Host 到 Webview 控制消息被输出淹没、Webview controller 调度不公平、serialized terminal state 陈旧、旧 supervisor raw tail 被错误升级为可信画面等问题。
- [x] (2026-07-10 23:32 +0800) 完成 PR #152 前后关键代码 diff 与现行实现的逐层对照，区分原有问题、PR #152 内部已修问题、合并后回归和 review 阶段即拦截的问题。
- [x] (2026-07-10 23:33 +0800) 建立故障时间线和内容表示关系，明确 raw PTY output、Webview pending output、xterm live buffer、Host/supervisor headless serialized state、recent output tail 与持久化 snapshot 的所有权和新鲜度缺口。
- [x] (2026-07-10 23:34 +0800) 形成第一版问题诊断，写入已证实的问题、未确认假设、候选重构方向、风险和验证方法。
- [x] (2026-07-10 23:36 +0800) 完成研究文档自校验：`git diff --check` 通过，frontmatter 与设计索引状态一致，引用的仓库文档路径均存在；本轮没有修改或测试运行时代码。
- [x] (2026-07-10 23:59 +0800) 与用户确认三条产品和架构边界：输入优化只提升唯一输入节点的优先级；live 增量不得丢弃或由 snapshot replacement 替代；可后台运行的 Agent 不能以会随 Reload Window 重建的 Host snapshot 作为恢复权威。
- [x] (2026-07-11 00:19 +0800) 重新 fetch `origin/main`，确认最新基线仍为 `5355e6a`，从该提交创建主题分支 `agent-terminal-lossless-io-redesign` 和独立 worktree，保留此前 worktree 的未提交文档。
- [x] (2026-07-11 00:20 +0800) 在新分支创建并登记 `docs/design-docs/agent-terminal-lossless-io-and-recovery.md`，同步三条已确认边界，并把 supervisor checkpoint + 无损 journal 标为首选验证路线而非已选定结论。
- [ ] 建立当前主线的无损输出、任意 tail 截断和 Host 离线恢复失败基线。
- [x] (2026-07-11) 用户选定先实现 supervisor 唯一 authority、完整 output/resize journal，以及不 compact 旧 journal 的 checkpoint cache；同步把原子 attach/live 切点写入正式设计。
- [x] (2026-07-11 08:40 +0800) 实现 supervisor 唯一 authority、output/resize/scrollback 共享 revision、完整分段 checksum journal、registry checkpoint cache 与 journal-only 重建。
- [x] (2026-07-11 09:10 +0800) 实现 defer attach + subscribe 两阶段协议；补上 attach revision pin、同 socket 旧订阅撤销、间隙 replay 与 Host/Webview authority/gap 自动重附着。
- [x] (2026-07-11 09:25 +0800) 删除 Webview 稳态 backlog snapshot replacement 与增量丢弃路径；checkpoint 只创建新投影，output coalescing 保留连续 revision range，resize/scrollback 前先 flush output。
- [x] (2026-07-11 09:32 +0800) 定向单测、Webview checkpoint/journal/gap 用例、`trusted` Reload Window 和 `real-reopen` 真实窗口重开通过。
- [x] (2026-07-11 10:09 +0800) 补齐 checkpoint geometry 切点与中文 journal 错误文案；10 个 Webview 无损/新投影定向用例通过，并完成一次 334 用例的 Webview 基线审计。
- [ ] 实现唯一输入节点优先且所有 controller 无损、有序、有界公平的 live 调度。
- [ ] 把旧 supervisor 显式只读降级/迁移、Host checkpoint refresh/ACK 与长期内存预算收口；新 authority session 的连续重新附着已完成。
- [ ] 完成 10 Agent 容量基准和完整 `npm test`，并把已知 Webview 环境基线失败与本次回归分开记录。

## 意外与发现

- 观察：PR #152 不是一个局部终端显示修复，而是一次横跨 24 个文件、约 6,000 行增删的多问题收口。
  证据：PR #152 同时新增或大改 `CanvasPanelManager.ts`、`main.tsx`、协议、serialized terminal tracker、runtime supervisor 协议、终端链接 helper、诊断和近千行 Playwright 覆盖；PR 正文同时声明输入响应、持久化、snapshot reset、序号与链接解析目标。

- 观察：PR #152 的 Webview backlog reset 以 Host serialized terminal state 替代待渲染 raw output，因而把“serialized state 是否准确覆盖某个 output sequence”提升为显示正确性的核心不变量；当时序号只存在于外层 snapshot/output 消息，serialized state 自身没有新鲜度标记。
  证据：PR #229 后续专门为 `SerializedTerminalState` 增加 `outputSequence`，并记录此前 raw output 已完整但 `serializedTerminalState.data` 落后、Webview 恢复显示不完整的现场。

- 观察：按固定预算调度不等于公平调度。PR #152 的 Webview drain 可以反复把已处理但仍有 backlog 的 controller 放回队首，使后进入队列的 Agent 长时间拿不到最终输出。
  证据：PR #203 修改重新排队顺序，并新增“多个 live Agent 都能触达输出”以及“attention 节点 final output 与 exit banner 不被 flood 节点饿死”的回归。

- 观察：raw output tail 不是可独立恢复的终端内容。它可能从 ANSI/TUI 控制序列中间截断，喂给空白 headless xterm 后即使盖上当前序号，也不能成为可信 serialized state。
  证据：PR #236 的现场样本出现缺少 `ESC[` 前缀的 `6;2H`；错误重建后的 Webview 画面残缺，直到 resize 触发 provider TUI 重绘才偶然恢复。

- 观察：后续修复也多次在 review 中暴露同类边界遗漏。
  证据：PR #229 初版没有在 final session state 和 registry 持久化前 flush tracker，会让短命令退化到 6 KB raw tail；PR #236 初版会把当前 supervisor 暂时缺少 fresh serialized state 的普通 live snapshot 也标成不可信，丢弃原有可信 tracker。两项均在合并前由 review 拦截并修复，不能写成已发布回归。

- 观察：当前主线的破坏性替换顺序是“先丢内容，再验证替代物”。
  证据：`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的 `resetBacklogForSnapshot()` 先清空 `pendingOutput` 再请求 snapshot；`applySnapshot()` 也先清理 pending/drain 状态再把 snapshot 排入 hydrate；`CanvasPanelManager.postExecutionSnapshot()` 在 flush tracker 前先 `clearQueuedExecutionOutput()`。

- 观察：`outputSequence` 目前是可修正的账面序号，不是内容覆盖证明。
  证据：同一 execution session 的 reset request 若带来更大的 `minOutputSequence`，Host 会直接提升 `session.outputSequence` 并调用 `terminalStateTracker.markOutputSequence()`，中间没有对应 output bytes；这条逻辑来自 PR #152 的 `831562f`，PR #236 只用 `terminalStateTrusted` 限制了部分旧 tail 路径。

- 观察：2026-07-06 至 2026-07-07 的 checkpoint/delta 提交没有对应的新 PR。
  证据：四个提交继续追加在已于 2026-07-04 合并的 PR #245 head 分支 `agent-node-fork-launch-intent` 上；GitHub 只返回已合并的 PR #245，当前远端上游已删除。历史计划中“同一 PR 内已收口”的表述不成立。

- 观察：未合入 checkpoint/delta 实验没有提供旧 live runtime 的迁移闭环。
  证据：`2026-07-06T15-43-44-039Z` 诊断中的 48 个 execution snapshot 全部为 `missing-checkpoint`，0 个带 serialized state；48 个仍有 raw output，41 个长度为 6000。安全拒绝 tail 后出现空屏，随后 `0bcb3b0` 才增加 sanitized transcript 止血。

- 观察：两阶段 attach 仅靠“先 snapshot、后 subscribe”仍不充分；snapshot 返回后若后台 registry persist 生成更晚 checkpoint 并释放内存事件，旧 `afterRevision` 的补偿区间会暂时不可读。
  证据：把协议测试延迟到 registry checkpoint 超过 attach revision 后，旧实现稳定失败为 `Terminal journal events before revision ... are not retained in memory`。修复后 deferred revision 会 pin 到订阅完成或 socket 关闭，并且测试在 checkpoint 刷新后仍完整、只重放一次。

- 观察：可靠 socket 不能代替端到端连续性校验。Host 若遇到 authority 不匹配或 revision gap，仅停止消费会让 Webview 永久停在旧画面。
  证据：Host 现先 flush gap 前 output，再把不连续事件交给 Webview 触发 fail closed；后续 attach 请求会撤销旧订阅、获取新完整投影并重新 subscribe。Playwright 同时覆盖同 session 切换 authority 后的 reset/hydrate。

- 观察：supervisor checkpoint 已能释放 journal 的内存副本，但 Host 为 Webview recreate 保存的 `terminalStream.events` 在纯输出长会话中没有独立刷新信号。
  证据：Host 只在收到 supervisor `sessionState` 时用新 checkpoint 替换缓存；持续 output 不必产生 lifecycle state。这不会删除磁盘或 live 内容，但会让 Host 内存与重建 payload 随会话增长，必须登记为后续 checkpoint refresh/ACK 工作。

- 观察：checkpoint 的 revision 与 terminal geometry 也必须取自同一个事件循环切点。
  证据：若先等待 tracker `flush()`、再读取 `session.cols/rows/scrollback`，等待期间到达的 resize/scrollback 会把较早 revision 的 serialized state 与较新 geometry 拼进同一 checkpoint。当前实现先固定 geometry，再开始 flush；并用源码回归保护该顺序。

- 观察：完整仓库/Webview 基线当前包含多项与本轮终端内容链路无关的既有失败，不能只概括为最初观察到的三项。
  证据：`npm test` 先后被 Marketplace E2E 中只接受中文按钮而实际 probe 为英文、已拆分源码仍扫描 `main.tsx` 的静态正则、缺少 `vscode.l10n` mock 等基线问题中断。一次完整 Webview 运行结果为 319/334 通过；其中两个同 session snapshot-redraw 用例和一个要求 final snapshot 丢弃 live backlog 的用例与新不变量冲突，已改为新 projection/无损 final backlog 语义并定向通过。其余截图、右键菜单、帮助文案、Ctrl-Z 与拖拽失败均不在本轮代码改动区域，产物保存在 `.debug/playwright/results/`。

## 决策记录

- 决策：把本轮工作定义为“内容链路重构”，而不是继续调整 backlog 阈值或 scheduler 常量。
  理由：现有故障横跨表示、所有权、新鲜度、排序、调度和恢复；单点调参已经在历史上多次把瓶颈或错误转移到下一层，不能回答内容何时完整、谁是事实源。
  日期/作者：2026-07-10 / Codex

- 决策：历史结论按四类标注：PR 前已存在、PR 引入或放大、后续现场证实、review 阶段拦截。
  理由：只按后续 commit 标题归因会把原有性能问题误写成回归，也会把未进入 `main` 的 review blocker误写成用户实际经历过的问题。
  日期/作者：2026-07-10 / Codex

- 决策：在问题诊断完成前，不选择 transcript UI、单 xterm 真源、事件日志加 checkpoint 或其他实现路线。
  理由：Agent 与 Terminal 当前都以 provider CLI/PTY 作为主交互面，这是已选定产品边界；是否改变内容表示或只重构底层传输与恢复，需要先证明现有故障来自哪里。
  日期/作者：2026-07-10 / Codex

- 决策：输入响应优化只通过调度优先级实现。唯一处于输入状态的节点，其输入、ACK、控制消息和真实回显优先级最高；其他节点可以延后渲染，但仍必须有界公平推进。
  理由：同一时刻只有一个节点接受用户输入，没有必要通过清空其他节点内容来缩短当前节点的输入反馈链路。
  日期/作者：2026-07-10 / 用户确认，Codex 记录

- 决策：live 输出链路不得丢弃尚未消费的增量，也不得再把 snapshot replacement 用作稳态性能优化。
  理由：丢失 PTY 增量会直接破坏终端状态机输入，后续 snapshot、序号或净化文本无法一般性补回缺失的字符、ANSI 模式和光标操作。
  日期/作者：2026-07-10 / 用户确认，Codex 记录

- 决策：可在 VS Code 关闭后继续运行的 Agent，其恢复权威必须长于 Extension Host；Host snapshot 只能是缓存或投影，Reload Window 必须按重新连接持久执行权威处理。
  理由：Reload Window 会同时重建 Host 与 Webview，而后台 Agent 仍能继续产生 output；Host 不可能仅凭自身重建前快照证明离线期间的内容完整。
  日期/作者：2026-07-10 / 用户确认，Codex 记录

- 决策：第一轮受控验证以 runtime supervisor 维护权威 terminal checkpoint 与无损 output/resize journal 为首选路线，但在原子切点、容量和升级实验完成前保持 `比较中`。
  理由：supervisor 已经持有跨 Host 生命周期的 PTY 和 session registry，把 revision、checkpoint 与 journal 收敛到同一进程可以消除 Host 双重修账；同时 checkpoint 能避免每次从会话起点重放全部输出。该路线仍需证明不会重新引入持久化压力、恢复 gap 或旧 supervisor 空屏。
  日期/作者：2026-07-11 / Codex

- 决策：第一阶段选定“完整磁盘 journal + checkpoint cache”，checkpoint 只裁剪已经覆盖的 supervisor 内存事件，不删除、截断或重写任何已完成 segment。
  理由：用户明确要求先消除内容丢失与恢复事实不可信；在 retention、回退代际和覆盖证明尚未完成前，compact 会重新引入不可逆的数据边界。
  日期/作者：2026-07-11 / 用户确认，Codex 实现

- 决策：deferred attach revision 是短期读 pin；同一 socket defer attach 时先撤销旧订阅，subscribe 必须使用该静态 payload 的精确 revision。
  理由：这同时封闭 snapshot/live 之间的事件穿透和 checkpoint 内存释放竞争；pin 只影响内存副本，连接关闭或订阅完成后即可释放，不改变完整磁盘 journal。
  日期/作者：2026-07-11 / Codex

- 决策：authority/revision gap 不能静默停流。Host 先保持 gap 前 output 顺序，再让 Webview fail closed，并从 supervisor 获取完整投影重新附着；恢复 payload 可以为同一 session 引入新的 authority，但必须整体 reset，不能与旧 authority 增量混写。
  理由：仅记录诊断会留下永久陈旧页面；把新 authority 的完整 checkpoint+journal 当成一次新投影可以恢复服务，同时避免把两个 authority 的增量当成同一历史。
  日期/作者：2026-07-11 / Codex

- 决策：checkpoint 在调用 tracker `flush()` 前固定 cols、rows 与 scrollback；flush 之后到达的 terminal control event 必须留在 checkpoint 后 journal 中重放。
  理由：geometry 本身也是 terminal event 的派生状态，不能与 serialized state 使用不同 revision 切点，否则即使 revision 连续也可能恢复出尺寸不一致的 xterm 投影。
  日期/作者：2026-07-11 / Codex

## 结果与复盘

本轮已完成用户指定的前三项实现。新 `live-runtime` session 的 terminal revision 只由 Runtime Supervisor 在 journal append 时分配；磁盘完整保存 output、resize、scrollback，checkpoint 只是同 authority 上的恢复缓存。Supervisor 重启时会校验 manifest、segment 字节、连续 revision 与 checksum chain；checkpoint 缺失则从 journal 起点重建，journal 损坏则拒绝 raw-tail fallback。

Host 与 Webview 已改为 authority projection：Host coalescing 保留 revision 起止范围，控制事件前强制 flush；Webview 新建投影时依次 hydrate checkpoint 和 journal，健康 live backlog 不被 snapshot 替换。旧 snapshot-reset 阈值、deferred output budget、timeout/retry 与 stale-output drop 已删除。attach gap、checkpoint 刷新竞争和 Host/Webview revision gap 均有自动化覆盖。

当前证据包括类型检查、journal/protocol/sequence/tracker/scheduler/localization 单测、10 个无损 backlog/新投影/checkpoint+journal/gap 定向 Webview 用例、完整 trusted smoke 与 real-reopen smoke。完整 `npm test` 受上述仓库基线失败阻断，10 Agent 容量基准和旧 supervisor 显式迁移仍未完成，因此本 ExecPlan 保持 active；不能把新 authority 路径已通过误写成所有旧会话和长期容量都已验证。

已知下一项实现债是 Host `terminalStream.events` 的 checkpoint refresh/ACK。Supervisor 内存和磁盘策略已经分离，但 Host 仍可能为 Webview recreate 长期缓存 checkpoint 后的所有事件。该问题不会允许丢内容，后续应通过权威 checkpoint refresh 收敛，而不是恢复 snapshot replacement 或设置丢弃阈值。

## 上下文与定向

DevSessionCanvas 是 VS Code 扩展。Extension Host 中的 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 管理执行会话、接收 PTY 或 runtime supervisor 输出、维护可持久化状态并向 Webview 发消息。`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 在 `live-runtime` 模式下跨 VS Code 生命周期持有进程。`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 和它拆出的 Webview 模块创建用户可见的 xterm 实例并消费 Host 消息。

本文中的 raw output 指 PTY/runtime supervisor 产生的原始字符串流，其中可以包含普通文本、ANSI 控制序列、alternate-screen 操作和 provider TUI 重绘。serialized terminal state 指通过 headless xterm tracker 把当前终端 buffer 序列化得到的数据。recent output tail 指为了摘要或兼容 fallback 只保留的末尾约 6,000 个字符；它不是从会话起点开始的可重放事件流。

PR #152 在 2026-06-15 合入 `main`。它在 Webview backlog 过大时丢弃尚未渲染的 raw output，请求 Host serialized terminal snapshot 重建画面，再按 `outputSequence` 重放 snapshot 之后的输出。PR #176 在 Host 侧增加输出 scheduler，让 ACK 和控制消息绕过输出队列。PR #203 修复 Webview 多 controller drain 公平性。PR #229 给 serialized state 增加自己的 sequence 新鲜度。PR #236 把旧 supervisor 的无序号 raw tail 降级为不可信 fallback。

## 里程碑

### 里程碑一：建立无损与恢复失败基线

先把当前主线的错误变成稳定回归：证明 snapshot reset 会清空尚未消费的 Host/Webview output；证明任意截断的 6000 字符 tail 不能恢复 ANSI/TUI 状态；证明 Host 完全退出期间 persistent Agent 仍可继续输出，但新 Host 无法仅凭自身 snapshot 得到连续内容。该里程碑结束时，测试在旧路径上应确定性失败，并能逐 revision 指出缺口，而不是只检查某个 marker 最终出现。

### 里程碑二：验证并选定持久执行权威协议

在 `extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 与 supervisor 纯逻辑测试中比较两种表示：从 session 起点保留完整 output/resize journal；或由 supervisor 原子生成 terminal checkpoint，并保留 checkpoint 后的无损 journal。原型必须验证 attach 的原子切点、输出后立即 exit、checkpoint compact、进程崩溃后的最后完整 revision、10 个 Agent 的存储总量与恢复耗时。完成后把选定结论写入设计文档的 `正式方案`，并把 `decision_status` 改为 `已选定`；失败路线及证据仍保留在方案比较中。

### 里程碑三：实现单前台优先级的无损 live 调度

修改 `extensions/vscode/dev-session-canvas/src/common/executionOutputScheduler.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 和 Webview execution terminal drain。当前输入节点的 input、ACK、控制消息与真实回显获得最高优先级；其他 controller 有界公平推进。删除以 backlog 阈值触发 snapshot replacement 的能力，保留字节等价 coalescing、背压与按 revision 重试。该里程碑的自动化必须逐字节断言每个 controller 无缺失、无重复且单会话顺序不变。

### 里程碑四：实现 persistent Agent 重新附着

让 runtime supervisor 成为 live-runtime session 的唯一 output revision 与恢复表示 writer。新 Host 通过稳定 session identity 发现原 Agent，获取 checkpoint/journal 到截止 revision `R`，再从 `R + 1` 原子切换到 live stream；Host 只转发和调度，不再建立第二套可修账 tracker。Webview 只在自身新建时 hydrate，不以恢复 payload 清空既有 live backlog。旧 supervisor 没有新协议时必须进入明确的兼容或历史态，不能把 raw tail 升级成可信 terminal state。

### 里程碑五：真实生命周期验收与旧路径收口

覆盖 hidden/visible、Webview recreate、Reload Window、关闭并重开 VS Code、Agent 在 Host 离线期间持续输出、会话立即退出、旧 supervisor 升级以及多节点 flood。只有在 trusted、real-reopen 和 Webview 自动化都证明内容完整与输入响应达标后，才删除 `minOutputSequence` 无数据推进、raw tail hydrate 和旧 snapshot reset 代码。最后同步 `ARCHITECTURE.md`、相关正式设计文档和技术债追踪。

## 工作计划

先完成里程碑一与里程碑二，不直接在当前协议上继续叠加 freshness 字段。失败基线使用真实 headless xterm fixture 和 supervisor attach 纯逻辑测试；容量实验同时记录每 session 与 10 session 总量，避免只证明单节点上限。

方案选定后，先在 supervisor 侧建立唯一 authority 与可重放协议，再修改 Host 为无状态转发，最后替换 Webview live drain。这个顺序保证每一步都有可信上游来源；不能先删除 raw tail fallback，再等待后续阶段补恢复数据。

实现期间保留旧协议读取能力，但新旧 session 必须通过明确的 protocol/version 或 capability 分流。旧路径只能显示其真实保证，不能补写 revision、伪造 checkpoint 或把净化 transcript 注入可继续交互的 xterm。完成真实重开验收后，再按迁移记录移除旧写路径。

## 具体步骤

历史证据已经收集完毕。实现阶段从仓库根目录运行以下定向验证，新增测试名称应在实现时写回本节：

    npm run typecheck
    npm run test:terminal-session-journal
    npm run test:runtime-supervisor-protocol
    npm run test:execution-output-scheduler
    npm run test:execution-output-sequence
    npm run test:serialized-terminal-state-tracker
    npm run test:webview

宿主生命周期验证使用：

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/smoke/run-vscode-smoke.mjs

最终收口运行 `npm test`。如果 smoke 因 Electron sandbox 或环境能力失败，必须保留 artifact 并区分环境失败与内容断言失败；不能用较低层单测替代真实重开结果。

检查当前代码时，重点读取：

    extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts
    extensions/vscode/dev-session-canvas/src/common/protocol.ts
    extensions/vscode/dev-session-canvas/src/common/executionOutputScheduler.ts
    extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts
    extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts
    extensions/vscode/dev-session-canvas/src/webview/main.tsx

创建 `docs/design-docs/agent-terminal-lossless-io-and-recovery.md`，同步登记 `docs/design-docs/index.md`。如果研究决定修改既有 `docs/design-docs/embedded-terminal-runtime-window.md` 的正式方案，必须区分“当前已实现口径”和“待替代候选”，不能先把旧方案删成空白。

## 验证与验收

设计研究阶段的验收不是编译通过，而是证据闭环：每个问题都能指向 PR/commit、代码路径、现场诊断或回归测试；每个归因都标明是否真正进入 `main`；当前数据流中的每份内容表示都有生产者、消费者、顺序边界和失败降级说明。该部分已经完成。

进入实现后，至少需要自动化覆盖：多节点持续输出下唯一输入节点的输入、ACK 与真实回显优先；逐字节核对所有 controller 无缺失、无重复且有界公平推进；hidden/visible 切换；Webview recreate；Host 完全退出期间 persistent Agent 持续输出并在重连后完整补齐；local PTY 和 live runtime reattach；输出后立即 exit；旧 supervisor 无序号 tail；ANSI 控制序列跨 chunk/跨边界；checkpoint/log 与 raw stream 的连续性；最终输出、exit banner 和 scrollback 完整性。当前新 authority 的 checkpoint/journal、hidden backlog、gap、Reload Window、real reopen 与 final checkpoint 已覆盖；旧 supervisor、10 Agent 总量和专门的 ANSI/CJK 边界仍未完成。

## 幂等性与恢复

历史查询和文档更新可重复执行。当前使用独立 worktree，不修改原 `dev-session-canvas6` 中的未提交文件。journal 测试全部使用临时目录；同一 session 只有显式 delete 才移除 journal。stale manifest 只在完整 checksum tail 可验证时修复，最后不完整 record 只截断到上一条完整换行；中间损坏保持 fail closed。旧 tail 不会被猜测性升级成新 authority checkpoint。

## 证据与备注

当前最关键的历史证据：

    PR #152: fix(execution): 优化多 Agent 输入响应与终端链接解析
    PR #176: fix(execution): 优化多 Agent 输入响应调度
    PR #203: fix(webview): 修复多 Agent 输出渲染饥饿
    PR #229: fix(terminal): 修复序列化终端快照陈旧
    PR #236: fix(terminal): 降级旧 supervisor raw tail 快照

PR #152 的 `docs/exec-plans/active/execution-input-responsiveness.md` 记录了 6 MB raw backlog、5 MB snapshot 等待队列、重复 attach/hydrate、sequence stale loop 和 ACK 被 output flood 挤压等现场数据。该文档是高价值证据，但它仍是当时方案的执行记录，不自动等于本轮应延续的设计结论。

## 接口与依赖

第一阶段新增 `terminalSessionStreamV1` capability、`sessionId + authorityId + revision` 事件模型、`deferSubscription`、`subscribeSession(afterRevision)` 与 `sessionTerminalEvent`。`host/executionOutput` 为 authority output 携带 revision range，resize/scrollback 通过 `host/executionTerminalEvent` 保序投影。共享结构定义在 `terminalSessionStream.ts`、`protocol.ts` 与 `runtimeSupervisorProtocol.ts`；Host 和 Webview 不隐式补造 revision。

---

最后更新说明：2026-07-10 建立第一轮历史诊断并根据用户确认，将无损 live 增量、唯一输入节点优先级和 Host 非后台 Agent 恢复权威写为硬性边界。2026-07-11 从最新 `origin/main` 新建 `agent-terminal-lossless-io-redesign`，选定并实现 supervisor 唯一 authority、完整非压缩 journal、checkpoint cache 和两阶段 attach；trusted 与 real-reopen 已通过。ExecPlan 继续保留旧 supervisor 迁移、Host checkpoint refresh 和容量验证，避免把尚未完成的范围写成结论。
