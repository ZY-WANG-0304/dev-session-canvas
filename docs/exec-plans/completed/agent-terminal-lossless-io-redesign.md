# 重构 Agent / Terminal 无损输入输出与恢复链路

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本计划遵循仓库根目录的 `docs/PLANS.md`。历史故障定位、恢复表示比较、核心实现、真实旧版本迁移和终端控制序列边界已经形成第一轮证据；PR #255 review 又确认 revision 发布、finalization 与 completed projection 仍有三个确定性缺口，并提出一个需要按 revision 身份独立证明的 Webview 重复显示风险，因此本计划于 2026-07-12 从 completed 重新转为 active。四条 review blocker 已通过确定性回归、实现和真实生命周期 smoke 闭环，计划重新归档；长期 journal 保留、local PTY 独立恢复、永久 transcript 与 Agent 结构化投影仍作为后续技术债单独登记，不由本轮 review follow-up 冒充完成。

## 目标与全局图景

这次工作要重新建立 Agent / Terminal 输入输出内容的清晰边界。用户最终应能同时运行多个执行节点，持续看到完整、顺序正确且不过度滞后的当前内容；切换画布可见性、重开 Webview、重连 live runtime 或会话结束时，不应因为显示重建而缺行、回退到旧画面、解析残缺 ANSI 控制序列，或让后台节点永久拿不到最终输出。输入、控制消息和当前节点真实回显也不应被其他节点的输出洪峰淹没。

第一阶段先完成历史研究，回答 PR #152 引入了哪些内容表示和调度机制、后续 PR #176、#203、#229、#236 分别证明了哪些假设不成立，以及基线实现中哪些事实源、派生状态和恢复缓存被混用。后续阶段据此实现 Supervisor 唯一 authority、checkpoint 加无损 journal、唯一输入节点优先调度，并补齐旧 Supervisor 退役、applied-revision ACK、周期 Host cache 收敛、真实旧二进制迁移与 ANSI/OSC/CJK/emoji 分片恢复验证。

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
- [x] (2026-07-11) 建立当前主线的无损输出、任意 tail 截断和 Host 离线恢复失败基线，并用 headless xterm、历史 diff 与 live-runtime 重开回归固定 revision 缺口和 raw-tail 非恢复语义。
- [x] (2026-07-11) 用户选定先实现 supervisor 唯一 authority、完整 output/resize journal，以及不 compact 旧 journal 的 checkpoint cache；同步把原子 attach/live 切点写入正式设计。
- [x] (2026-07-11 08:40 +0800) 实现 supervisor 唯一 authority、output/resize/scrollback 共享 revision、完整分段 checksum journal、registry checkpoint cache 与 journal-only 重建。
- [x] (2026-07-11 09:10 +0800) 实现 defer attach + subscribe 两阶段协议；补上 attach revision pin、同 socket 旧订阅撤销、间隙 replay 与 Host/Webview authority/gap 自动重附着。
- [x] (2026-07-11 09:25 +0800) 删除 Webview 稳态 backlog snapshot replacement 与增量丢弃路径；checkpoint 只创建新投影，output coalescing 保留连续 revision range，resize/scrollback 前先 flush output。
- [x] (2026-07-11 09:32 +0800) 定向单测、Webview checkpoint/journal/gap 用例、`trusted` Reload Window 和 `real-reopen` 真实窗口重开通过。
- [x] (2026-07-11 10:09 +0800) 补齐 checkpoint geometry 切点与中文 journal 错误文案；10 个 Webview 无损/新投影定向用例通过，并完成一次 334 用例的 Webview 基线审计。
- [x] (2026-07-11 12:18 +0800) 分析 Pane Gallery 现场诊断，确认缩略图与主画板是两个 xterm 投影；主画板空白来自 Host 发送旧 checkpoint 后数千个 events、Webview 每 revision 一个宏任务，以及旧输入节点抢占 hydrate 顺序，而非 Supervisor journal 缺失。
- [x] (2026-07-11 13:02 +0800) 新增 capability-gated 只读 `getSessionSnapshot`；健康 authority session 在 Webview attach 前从 Supervisor 刷新 checkpoint，并把 RPC 期间已到 Host 的连续尾部 revision 无损合并，同 session 并发刷新共享一个请求。
- [x] (2026-07-11 13:13 +0800) Webview 对连续 journal output 做目标上限 256 Ki 个 UTF-16 code unit 的批量回放（单个 event 不拆分）；新激活主 Pane hydrate 优先于旧输入节点，并补充 4000-event 完整尾部与 Pane Gallery 激活顺序回归。
- [x] (2026-07-11 13:29 +0800) 重新执行完整 `trusted` VS Code smoke 并通过，覆盖 live runtime Reload Window 后从最新行滚动回首行；前一次同场景滚动动作未生效，但原样复跑未复现，未据此改变无损恢复语义。
- [x] (2026-07-11 14:21 +0800) 用户使用最新 Supervisor 手动复测 Pane Gallery 缩略图切换主画板场景，未再发现输出延迟补全、显示不完整或其他新问题。
- [x] (2026-07-11 16:00 +0800) 建立 `npm run benchmark:agent-terminal-io`：Supervisor 启动 10 个真实 PTY Agent 并记录 journal/registry/checkpoint、CPU、输入 RPC/回显和全量完成时间；Webview 挂载 10 个真实 xterm，逐行核对 864,020 字符、36,001 行，并记录输入 dispatch/ACK、优先回显、后台完成和 Chromium Task/Script CPU。
- [x] (2026-07-11 16:19 +0800) 实现唯一输入节点优先且所有 controller 无损、有序、有界公平的 live 调度：Host 持续输入期间逐轮释放超时后台节点；Webview 按 controller 排队年龄在 480ms 后追加独立公平 slot/预算，服务后重新计龄，阻塞或未选中内容保留原年龄。
- [x] (2026-07-11 18:21 +0800) 完成旧 supervisor 显式只读退役、applied-revision ACK 与无 attach 时的周期性 Host cache 收敛：旧会话只读且禁 input/resize/new session；Webview 在真实 xterm 完成点 ACK，Host/Supervisor 分 surface/consumer 水位校验；10–12 秒错峰 refresh 复用 attach in-flight，并覆盖 replacement、gap、dispose 与 stale timer 生命周期。
- [x] (2026-07-11) 当前工作树通过 typecheck、build、7 组定向协议/调度/序列测试和 9 个 Webview 无损/旧 Supervisor/ACK/gap/replay 用例；`trusted` 复跑越过目标 scrollback reload 场景，随后在既有 fake-provider 并发 start 的 session 文件竞态失败，artifact 已保留并与内容链路结论分开记录。
- [x] (2026-07-11) 修复 trusted 测试 setup 的 auto-start/manual-start 竞态：等待自动启动进入 live 后先停止会话，再进入手动 start 基线；修复后完整 `trusted` 通过，产品运行时逻辑不变。
- [x] (2026-07-11 18:33 +0800) 复查并补齐旧 attach 失败、类型不符或 operation token 忽略后的 settled 退役检查；随后 typecheck、build、7 组定向测试、9 个 Webview 回归和完整 `trusted` 再次全部通过。
- [x] (2026-07-11 19:35 +0800) 新增固定 `origin/main@5355e6a` 的真实旧 Supervisor 迁移 smoke：旧二进制实际持有 Agent/Terminal PTY，当前 Host 只读附着并拒绝写入，最后一个会话结束后旧进程自然退役，下一次创建切换到当前 Supervisor。
- [x] (2026-07-11 19:40 +0800) 增加 ANSI/CSI、cursor addressing、OSC title/OSC 8、alternate screen、resize/scrollback、CJK 与 emoji 跨 event 恢复回归；真实 PTY 又把 `中文🚀` 的 UTF-8 bytes 拆到四次写入，最终 journal、projection 与 checkpoint 均无 `U+FFFD`。
- [x] (2026-07-11 19:45 +0800) 完整默认 VS Code smoke 全部通过，包括 trusted、restricted、多 root、双窗口共享 runtime、systemd user/fallback、Remote SSH real reopen 与新增 legacy-supervisor-upgrade。
- [x] (2026-07-11 19:52 +0800) 完成 `npm test` 审计并区分基线：原样命令在 Marketplace VS Code fixture 的 Unix IPC 长路径停止，固定 `origin/main@5355e6a` 同路径复现；改用短临时目录后命中既有中英文 locale fixture 漂移。按原命令顺序继续的终端链路测试全部通过；陈旧 Webview 静态扫描、缺 `vscode.l10n` mock 与完整 Webview 既有失败单独登记，不写成本分支回归。
- [x] (2026-07-11 20:02 +0800) 完整 `npm run test:webview` 初轮审计为 329/340 通过；新增 legacy transcript、无损 backlog、checkpoint+journal、gap、ANSI/OSC/CJK/emoji、批量 replay、10-Agent 与 xterm 交互回归全部通过。失败集中在既有截图、右键启动/布局菜单、帮助文案、Claude Ctrl-Z 与 launch preset 断言漂移，artifact 保存在 `.debug/playwright/results/`。
- [x] (2026-07-11 20:04 +0800) 将 strict delete 的旧 client 退役检查收敛到所有 RPC settled 路径，补齐 missing-session 幂等删除边界；最终 typecheck、build、journal/protocol/sequence/protocol-message 定向测试与真实旧 Supervisor smoke 通过。
- [x] (2026-07-11) rebase 到最新 `origin/main@d7baadf`，无冲突吸收 PR #254 的 Agent Resume/恢复语义；rebase 后 typecheck、build、journal/protocol/sequence、execution-context、l10n、smoke-runner、VSIX、Activity Bar 与 Sidebar history 测试通过。
- [x] (2026-07-11) rebase 后完整 Webview 为 331/341 通过；10 项非终端失败在独立 `origin/main@d7baadf` worktree 定向运行时逐项复现，当前分支新增终端用例全部通过。
- [x] (2026-07-11 20:53 +0800) rebase 后最终 `npm run test:smoke` 全部通过，覆盖 trusted/restricted、真实旧 Supervisor、local/multi-root/two-window reopen、systemd user/fallback 与 Remote SSH；首次完整运行仅在高负载并跑时出现一次 `systemd-user-real-reopen` Webview ready 20 秒超时，随后该场景定向复跑和第二次完整复跑均通过，按场景级启动抖动记录而未改动产品语义。
- [x] (2026-07-12 00:23 +0800) 读取 PR #255 最新 review，确认 scrollback/output 发布乱序、exit/resize 非完整终态和 completed session 丢失唯一完整 stream 三条为确定性 blocker；Webview 重复 marker 只证明存在可疑代码路径，尚需以 `sessionId + authorityId + revision` 排除上游真实重复输出。
- [x] (2026-07-12 00:23 +0800) 将设计验证状态降回“验证中”，并把本计划从 completed 移回 active；同步确认 PR head `0febdda` 与远端一致、`origin/main@d7baadf` 未前移。
- [x] (2026-07-12) 为四条 review 建立确定性回归；Webview 正反例分别证明同一 authority revision 只应用一次，以及两个连续 revision 的相同文本必须保留两次，不使用字符串或 marker 去重。
- [x] (2026-07-12) 串行化 Supervisor 的 terminal mutation/publication、finalization 与 delete：output、resize、scrollback 共用 session operation chain；exit 同步关闭 admission，等待已接受操作后只发布 fresh final state。
- [x] (2026-07-12) 为 completed session 持久化最后一个合法 checkpoint 加连续 journal suffix；主磁盘 snapshot 与实际 root-local 加载源写入成功后，Host 才解绑 runtime 并删除 Supervisor journal。
- [x] (2026-07-12 02:10 +0800) 完成 typecheck、build、定向协议/Webview、大于 5 MiB completed reload、真实 Host 离线 completed、10-Agent benchmark 和完整 smoke；设计恢复“已验证”并重新归档计划。

## 意外与发现

- 观察：PR #255 review 的第二条不能仅凭 marker 出现两次判定 Webview 重复写入；相同文本可能来自两个合法的连续 PTY event。
  证据：当前事件身份已经包含 `sessionId + authorityId + revision`。只有证明 journal 里 marker 对应一个 revision，而 snapshot 与增量把同一 revision 应用了两次，才能把它定性为无损投影 bug；两个不同 revision 的相同 marker 必须保留两次。

- 观察：第一条和第三条共享同一个根因：journal revision 分配、tracker 异步操作、事件广播和 final snapshot 没有经过同一条 session 级串行边界。
  证据：`updateSessionScrollback()` 在 append revision 后等待 `setScrollback()` 才广播，期间 `onData` 可广播下一 revision；`finalizeSession()` 又在 fresh tracker flush 前先设置 `live=false`，而 `resizeSession()` 仍接受非 live session。

- 观察：Supervisor 在 oversized final serialized state 无法形成新 checkpoint 时，仍能提供“最后一个合法 checkpoint + 后续完整 journal events”；原缺口发生在 Host completed 路径忽略 `snapshot.terminalStream` 后删除 runtime session。
  证据：`toFreshSnapshot()` 只有在 checkpoint 通过 5 MiB normalizer 时才替换旧 checkpoint，`buildTerminalStreamAttachPayload()` 仍从旧 checkpoint 拼接 journal suffix；修复后 Host 只有在 stream 的 session、authority、terminal revision 与 output sequence 全部一致时才接收并持久化它。

- 观察：Host 完全离线期间结束的 authority session 原本会在重连时被 `historyOnUnavailable` 提前降级，虽然 Supervisor 已返回完整的非 live terminal stream。
  证据：真实 reopen 新增第三个 Terminal，在 Host 退出后的 3 秒空窗内输出 marker 并退出；修复前该 snapshot 走 recent-tail `history-restored`，修复后优先执行 completed durable 收敛，重开后完整 stream 可投影且 Supervisor session 已清理。

- 观察：completed stream 的 durable barrier 不能只等待主 snapshot；root-local snapshot 是多 root 与 fallback 恢复的实际候选加载源，也必须同步成功。
  证据：completed 写入现在要求主磁盘 snapshot 和 root-local 写入都成功；任一失败会恢复内存 state、root-local cache 与 overlay，并保留 Supervisor binding/journal。大体积 stream 使用 `workspaceStateMode: 'skip'`，避免再复制到容量更小且不是权威加载源的 `workspaceState`。

- 观察：大于 5 MiB 的 completed smoke 若不恢复场景前 state，会把巨大 terminal stream 留给后续 trusted 用例并改变调试快照跨进程序列化时序。
  证据：第一次完整 smoke 的 history-restored resume 断言观察到 Agent 已从 resumable 合法推进到 waiting-input；oversized 场景在 `finally` 恢复 baseline 后，原严格断言和完整 smoke 均通过，无需放宽产品验收。

- 观察：本轮完整 `npm run test:webview` 不能记为通过；定向终端回归与全量套件基线必须分开陈述。
  证据：首个失败是 expected 仍保留旧英文命令行、actual 已是仓库当前中文参数校验文案的陈旧截图（3488 pixels，约 1%）；一个 canvas edge 用例在全量中超过 30 秒但单独通过。跳过截图后，机器高负载又让前两项分别约 33.7/34.5 秒触发统一 30 秒超时。本轮相关 10 项、edge 单跑、10-Agent benchmark 和完整 VS Code smoke 均通过，artifact 保存在 `.debug/playwright/results/`。

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

- 观察：Pane Gallery 缩略图内容正常不能证明双击后的主画板已具备相同内容；`PaneGalleryRootPane` 的 ReactFlow key 包含 `mode`，从 thumbnail 切到 main 会销毁旧 xterm 并创建空投影。
  证据：`2026-07-11T04-30-09-595Z` 诊断中，目标节点缩略图已正常显示，但新主画板 xterm 仍为全空；一次仅统计 22,911 个 checkpoint 字符的 hydrate 实际耗时 8.731 秒。

- 观察：Supervisor checkpoint 本身已经足够新，慢点在 Host 投影缓存和 Webview replay 粒度。Host 在纯 output 期间持续向旧 `terminalStream.events` 追加，Webview 又在每个 output revision 后 `setTimeout(0)`，数千 revision 被放大为数秒空屏。
  证据：现场 Supervisor checkpoint 后通常只有 0–2 个 event；实现只读 projection refresh 和目标上限 256 Ki 个 UTF-16 code unit 的连续 output batching 后，4000 个 event、276,000 个 replay 字符的 Webview 回归在一次 snapshot write 中约 112 ms 完成。

- 观察：已有 6-controller 用例只检查最终 marker，不能作为 10-Agent 容量或无损证据；逐行基准显示输入路径已经较快，但 Webview xterm 解析仍是容量链路里比 Supervisor journal 写入更重的阶段。
  证据：rebase 到最终目标基线后的 10-Agent 样本中，Supervisor 九路后台输出约 406.92ms 完成，Webview 对 864,020 字符、36,001 行的逐行解析约 2.03s 完成；输入 dispatch/ACK/优先回显分别约 8.6ms/13.9ms/189.4ms。全部 xterm buffer 逐行一致，没有缺失、重复或乱序。

- 观察：以固定输入时间窗限制 Webview 每帧只处理一个 controller，并不能证明持续键入时后台有界公平；如果输入时间不断刷新，非输入 controller 可以一直达不到普通 drain 路径。
  证据：新纯逻辑回归连续刷新输入优先级，并验证 9 个等待超过 480ms 的后台 controller 按排队年龄逐个获得公平 slot。Host 对应回归验证 9 个超过 750ms 的后台 entry 在连续输入窗口内逐轮释放。

- 观察：完整仓库/Webview 基线当前包含多项与本轮终端内容链路无关的既有失败，不能只概括为最初观察到的三项。
  证据：`npm test` 先后被 Marketplace E2E 中只接受中文按钮而实际 probe 为英文、已拆分源码仍扫描 `main.tsx` 的静态正则、缺少 `vscode.l10n` mock 等基线问题中断。一次完整 Webview 运行结果为 319/334 通过；其中两个同 session snapshot-redraw 用例和一个要求 final snapshot 丢弃 live backlog 的用例与新不变量冲突，已改为新 projection/无损 final backlog 语义并定向通过。其余截图、右键菜单、帮助文案、Ctrl-Z 与拖拽失败均不在本轮代码改动区域，产物保存在 `.debug/playwright/results/`。

- 观察：同一个 Host-to-Supervisor socket 同时承载 panel 与 editor 两个 Webview surface，Supervisor 若只按 socket/session 保存一个 ACK 水位，会把另一个 surface 的正常较低 revision 误判为回退。
  证据：协议改为显式携带 `consumerId: 'panel' | 'editor'`，Supervisor 回归分别推进两个 consumer，并验证同 consumer 回退失败、不同 consumer 独立单调。

- 观察：清理 timer 不等于阻止异步任务重新调度。Host dispose 时，一个已经发出的 projection refresh 仍可能在 dispose 之后返回，并从 `finally`/后续路径再次创建 timer。
  证据：`TerminalProjectionRefreshScheduler` 增加不可逆 `disposed` 状态；fake-timer 回归在 refresh callback 已触发、scheduler 随后 dispose 的顺序下验证重新 `schedule()` 返回 false。

- 观察：只在旧会话成功返回 completed snapshot 时检查 client 退役不完整；最后一条 persisted session 引用若 attach 失败、类型不符或被并发 operation token 忽略，节点虽已退出 reattach，旧 client 仍会阻止 Supervisor idle shutdown。
  证据：`attachPersistedRuntimeSession()` 现在在 `finally` 的 settled 边界调用退役检查；检查仍保留已附着旧会话和其他 `reattaching` 节点，因此不会因单个失败 attach 提前断开仍持有 PTY 的旧进程。

- 观察：trusted scrollback 首次失败不是内容缺失，而是尾随 shell prompt 在测试滚到首行后又把 xterm 拉回 follow-bottom。
  证据：失败快照的 `viewportY=205`，但 `DSC_LRSP-001...220`、最终 prompt、Supervisor checkpoint/journal 与 ACK 都完整；滚动动作最多重试三次后，当前复跑已越过该场景。

- 观察：trusted 的 `verifyLiveRuntimeResumeExitClassification` 曾存在独立 fixture 竞态。节点创建后的自动 start 与测试手动 start 几乎同时发生，被 operation token 忽略的进程仍会写同一个 fake-provider `last-session`，而后续基线恢复只恢复 metadata、不恢复该文件。
  证据：失败诊断同时记录 92x28 与 66x21 两次 `execution/startRequested`；有效 metadata 为 `8f8e...`，磁盘 `last-session` 为另一进程写入的 `4af6...`，resume 因而以 code 21 失败。测试 setup 现在等待 Agent/Terminal 自动启动完成并停止后才执行手动 start；完整 `trusted` 随后通过，目标终端节点的 220 行 scrollback 与 revision 始终完整。

- 观察：真实旧 Supervisor 的 `deleteSession` 会先广播终态、再返回同一 socket 上的 delete RPC；生命周期 handler 若在终态到达时立即 dispose client，会中断仍在途的删除响应。
  证据：第一版真实迁移 smoke 中旧 PTY 和 registry session 已删除，但画布节点仍保留，Host 收到 `clientDisconnected`。`RuntimeSupervisorClient.hasPendingRequests()` 现在阻止 in-flight 期间退役，strict delete 在成功、missing-session 和异常后的 settled 边界统一重新检查；真实旧二进制 smoke 随后完整通过。

- 观察：真实 PTY 的 UTF-8 解码边界和 Webview 的 JavaScript 字符串/event 边界需要分别验证。
  证据：Supervisor fixture 把 `中文🚀` 的 UTF-8 bytes 拆到四次 `stdout.write()`，形成至少三个 output revision；Webview fixture又把 CSI、OSC、CJK 与 emoji surrogate pair 拆到相邻 journal event。两层最终都无 `U+FFFD`、缺失和重复。

- 观察：当前一键测试首先受仓库基线环境与 fixture 漂移阻断，而不是本分支终端断言失败。
  证据：原样 `npm test` 在深层 `TMPDIR` 创建 VS Code IPC socket 时以 `listen EINVAL` 停止，同一命令在临时分支基线 `5355e6a` worktree 复现；改用 `/tmp` 短路径后，Marketplace fixture 等待中文按钮，但实际英文 probe 为 `Publish custom template`、`Install`、`View details`。继续审计又确认 `theme-color-tokens` / `canvas-templates` 仍扫描已拆分的 `main.tsx`，`canvas-node-groups` mock 缺少 `vscode.l10n`；rebase 后完整 Webview 为 331/341 通过，10 项失败在独立最新 `origin/main@d7baadf` worktree 全部复现，新增终端链路回归全部通过。这些问题与本轮终端代码路径分开登记。

## 决策记录

- 决策：PR #255 review follow-up 继续使用已选定的 Supervisor authority 方案，但把计划与设计验证状态重新打开，不因此前 smoke 通过而降低 blocker 标准。
  理由：review 已给出可直接证明的无损与终态反例；决策方向没有变化，但实现验证结论已经失效，必须先恢复活文档的真实状态。
  日期/作者：2026-07-12 / Codex

- 决策：Webview 重复内容不得按字符串去重；先以 authority revision 建立正反例，再决定是否修改 projection generation。
  理由：终端合法地允许连续输出相同文本。字符串去重会把真实内容丢掉，违反本设计的首要边界。
  日期/作者：2026-07-12 / Codex

- 决策：Supervisor 的 output、resize、scrollback、exit finalization 与 delete 共用 session 级 terminal operation chain；exit/delete 先同步关闭 mutation admission，再等待已经接受的操作收敛。
  理由：只串行 journal append 不能约束异步 tracker 与广播完成顺序；delete 若绕过同一边界，也可能在已接受 output 尚未形成 fresh checkpoint 时提前移除 journal。统一 chain 才能保证对外 revision 单调和唯一完整终态。
  日期/作者：2026-07-12 / Codex

- 决策：合法的 completed authority stream 优先于 `historyOnUnavailable` recent-tail fallback；只有 session、authority、terminal revision 和 output sequence 四项一致才可进入持久化。
  理由：`live=false` 只描述生命周期，不能把 Supervisor 已证明连续的最终 stream 降级成不完整历史；四项一致校验则阻止把陈旧或跨 authority payload 误写成完成态事实源。
  日期/作者：2026-07-12 / Codex

- 决策：completed handoff 的 durable barrier 由主磁盘 snapshot 与实际 root-local 加载源共同构成；大体积 terminal stream 不复制到 `workspaceState`。
  理由：删除 Supervisor journal 前必须保证下一次 Host 真正会选择的磁盘候选已落盘。`workspaceState` 既有容量风险，又不是这条恢复链的完整性权威；写入失败时回滚内存/cache 并保留 runtime，才能继续重试而不是先破坏唯一完整来源。
  日期/作者：2026-07-12 / Codex

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

- 决策：Webview 新投影 attach 使用独立、只读、capability-gated 的 Supervisor snapshot RPC，不复用会撤销 socket subscription 并建立 deferred pin 的 `attachSession`。
  理由：刷新 Host 投影缓存不能改变现有 live subscription；旧 Supervisor 没有新 capability 时必须跳过 RPC，避免未知 method 永久悬挂。刷新响应与当前 Host cache 通过连续 revision 校验合并，失败时保留原健康缓存而不丢内容。
  日期/作者：2026-07-11 / Codex

- 决策：连续 output journal event 允许字节等价批量写入 xterm；resize/scrollback 仍是批次边界。Pane Gallery 新激活主 Pane 使用独立优先级，排在历史 `lastExecutionInputNodeId` 之前。
  理由：事件边界不是 output 字节语义边界，每 revision 一个宏任务只制造恢复延迟；主 Pane 是用户当前选择的显示投影，但不能改写“最近输入节点”的业务语义或丢弃后台内容。
  日期/作者：2026-07-11 / Codex

- 决策：Webview 用每-controller 首次排队时间实现持续输入下的公平释放；输入节点保留首个 4 Ki 字符预算，最老后台等待 480ms 后获得额外 4 Ki 独立预算。Host 保留 300ms 输入窗口和 750ms 后台最大 defer，每轮最多额外释放一个最老节点。
  理由：单纯不断刷新输入窗口会造成后台永久饥饿；直接轮转又会削弱当前输入节点手感。独立公平预算同时保持输入节点第一顺位和后台 admission 上界，不需要删除、替换或重排任何节点内容。
  日期/作者：2026-07-11 / Codex

- 决策：缺少 `terminalSessionStreamV1` 的旧 Supervisor 不做强制进程升级；既有 live session 进入只读 tail 投影，新 session 禁止继续创建，最后一个旧会话结束或最后一条旧 attach 引用失效后，由 Host 断开连接并等待旧进程空闲退出。
  理由：PTY master 归旧 Supervisor 进程所有，当前协议无法无损转移；强杀会让仍运行的 Agent 成为孤儿，继续交互又会把没有 authority/journal 的路径伪装成可恢复 live。只读退役保留 stop/delete 和自然结束能力，同时给新协议明确退出条件；把检查放在 attach settled 边界还能避免失败或被忽略的最后一次 attach 永久占住 client。
  日期/作者：2026-07-11 / Codex

- 决策：applied-revision 以 xterm write callback、resize 或 scrollback 真正完成为推进点；Webview 到 Host、Host 到 Supervisor 都只单调记录消费者水位，不能推进 authority revision。
  理由：Host/Webview 收到消息或把字节加入队列都不代表用户投影已经应用。把 ACK 锚定在终端操作完成点，才能区分传输进度与显示进度，并拒绝跨 session、跨 authority、未来 revision 和回退 ACK。
  日期/作者：2026-07-11 / Codex

- 决策：无 attach 的 Host cache 通过固定周期、capability-gated 的权威 snapshot 刷新收敛；ACK 记录投影进度但不是刷新前置条件。
  理由：无 Webview attach 时不会产生 ACK，而 Host 仍需要控制 `terminalStream.events` 增长。权威 checkpoint 加 RPC 期间连续 live tail 可以安全替换恢复缓存，不影响已经排入 Host/Webview 的 live delivery；失败时保留旧缓存即可重试。
  日期/作者：2026-07-11 / Codex

- 决策：旧 Supervisor 迁移验收固定使用分支起点 `origin/main@5355e6a` 的真实源码构建产物，不用删 capability 的当前进程冒充旧版本。
  理由：只有真实旧实现才能暴露协议消息顺序、idle shutdown、registry 格式和 PTY 所有权差异；固定 ref 让 smoke 可重复，也避免未来 `origin/main` 前移后测试语义漂移。
  日期/作者：2026-07-11 / Codex

- 决策：完整 `npm test` 的已复现基线失败作为测试基础设施技术债登记，不在终端内容重构 PR 内顺手修改 Marketplace locale、Webview 静态扫描或 l10n mock。
  理由：这些失败在固定 `origin/main` 或本轮未改动区域可复现，修复会扩大 PR 范围；本轮通过逐项继续审计、完整 smoke、定向 Webview 与协议测试证明终端链路，且不把一键命令写成清洁通过。
  日期/作者：2026-07-11 / Codex

## 结果与复盘

本轮已完成用户指定的前三项实现。新 `live-runtime` session 的 terminal revision 只由 Runtime Supervisor 在 journal append 时分配；磁盘完整保存 output、resize、scrollback，checkpoint 只是同 authority 上的恢复缓存。Supervisor 重启时会校验 manifest、segment 字节、连续 revision 与 checksum chain；checkpoint 缺失则从 journal 起点重建，journal 损坏则拒绝 raw-tail fallback。

Host 与 Webview 已改为 authority projection：Host coalescing 保留 revision 起止范围，控制事件前强制 flush；Webview 新建投影时依次 hydrate checkpoint 和 journal，健康 live backlog 不被 snapshot 替换。旧 snapshot-reset 阈值、deferred output budget、timeout/retry 与 stale-output drop 已删除。attach gap、checkpoint 刷新竞争和 Host/Webview revision gap 均有自动化覆盖。

当前证据包括类型检查、构建、journal/protocol/sequence/tracker/scheduler/localization 单测、无损 backlog/新投影/checkpoint+journal/gap 定向 Webview 用例、10-Agent Supervisor/Webview 容量基准和完整 VS Code smoke。容量基准逐行核对 36,001 行，并记录 journal/registry/checkpoint 体积、Supervisor CPU、Chromium Task/Script CPU、输入 ACK/回显和后台完成时间。旧 Supervisor Agent/Terminal 只读投影、ACK 完成点和周期 refresh fake timer 均有自动化覆盖；新增 smoke 还从 `origin/main@5355e6a` 构建真实旧 Supervisor，验证实际 PTY、只读降级、禁写、idle 退役与当前进程接管。

Pane Gallery 新投影恢复问题已收口：Host 在健康 authority attach 前拉取 Supervisor 最新 checkpoint，RPC 期间到达的 Host 尾部事件按 revision 合并；Webview 连续 output 以 256 Ki 个 UTF-16 code unit 为批次目标上限回放（单个 event 不拆分），resize/scrollback 保持顺序边界；新激活主 Pane hydrate 排在旧输入节点之前。该实现不改变 live subscription，不把 Host 变成 authority，也不丢弃任何 journal event。

旧 Supervisor 迁移、applied ACK 与周期 cache 收敛也已实现。旧会话不再接受可交互输入或新建请求；ACK 按 Webview surface 和 Supervisor consumer 独立单调；无 attach 的 Host cache 在 checkpoint 落后时按 10–12 秒错峰刷新，并在所有生命周期边界清理。ACK 暂不用于删除磁盘 journal，周期刷新也不触碰已经排队的 live delivery。

PR #255 review follow-up 已闭环。Supervisor 现在用同一 session operation chain 串行 output、resize、scrollback、finalization 与 delete，并在 exit/delete 边界同步关闭新 mutation admission；对外只会看到严格单调 revision 和覆盖所有已接受操作的唯一 fresh 非 live state。Webview 用 revision 身份对 snapshot 前增量做覆盖对账：同一 revision 只应用一次，而两个不同 revision 即使输出相同 marker 也完整保留两次，没有任何文本去重。

completed authority stream 现在作为节点 metadata 的恢复 payload 持久化。Host 只接受 session、authority、terminal revision 与 output sequence 全部一致的最终 stream；主磁盘 snapshot 和 root-local 加载源共同完成 durable barrier 后，才解绑 runtime 并删除 Supervisor journal。大体积 payload 不写入 `workspaceState`，Webview bootstrap/stateUpdated 也会剥离恢复数据；Host 离线期间结束的真实 Terminal 在重开后能从完整 final stream 恢复并清理 Supervisor session。

本轮 typecheck、build、journal/protocol/sequence/tracker/scheduler/bridge/diagnostics 定向测试、10 项 Webview 终端用例、10-Agent benchmark 和完整默认 VS Code smoke 均通过。最新 Webview benchmark 样本的 input dispatch、ACK、优先回显和最慢后台完成分别为 11.2ms、30ms、210.2ms、22.9092s，均在门槛内。完整 `npm run test:webview` 因陈旧截图基线和当前机器高负载下的统一 30 秒超时未完成，不能写成通过；相关用例与超时 edge 用例单跑通过，artifact 已保留。原样 `npm test` 的既有 Marketplace/fixture 缺口继续由已有技术债追踪；长期 retention/compact、local PTY 独立恢复、永久 transcript 与 Agent 结构化投影不扩大到本次 follow-up。

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

### 里程碑六：关闭 PR #255 review 的 revision 与 completed 边界

先用协议测试强制 scrollback tracker 停顿并在其间产生 output，证明修复前消费者会看到 `N+1` 先于 `N`；再让 exit、resize 与 tracker flush 竞争，证明修复前会发布不完整非 live snapshot。Supervisor 修复必须建立 session 级 mutation/publication chain，并在进程退出时同步关闭新 mutation admission，等待已接受操作收敛后只发布 fresh final state。

Webview 用例不按 marker 文本猜测重复，而是构造一个 revision 同时出现在先到增量和后到 snapshot 中，断言最终只应用一次；另用两个连续 revision 输出同一 marker，断言两次都保留。completed 用例使用合法的 100000 scrollback 和 70000 行输出制造超过 5 MiB 的 serialized state，要求 Host 在删除 Supervisor session 前持久化旧 checkpoint 加完整 journal suffix，Reload Window 后仍能看到首、中、末标记且不退化到 recent tail。

## 工作计划

里程碑一的历史失败证据与里程碑二的恢复表示比较已经完成；实现没有在旧协议上继续叠加 freshness 字段，而是建立 Supervisor authority 与连续 journal。现有失败基线使用真实 headless xterm fixture 和 supervisor attach 纯逻辑测试；容量实验同时记录每 session 与 10 session 总量，避免只证明单节点上限。

方案选定后，先在 supervisor 侧建立唯一 authority 与可重放协议，再修改 Host 为无状态转发，最后替换 Webview live drain。这个顺序保证每一步都有可信上游来源；不能先删除 raw tail fallback，再等待后续阶段补恢复数据。

实现期间保留旧协议读取能力，但新旧 session 必须通过明确的 protocol/version 或 capability 分流。旧路径只在独立只读文本投影中显示经过控制序列剥离的最近 tail，不补写 revision、不伪造 checkpoint，也不把文本注入可继续交互的 xterm。旧 Supervisor 上不再创建新 session；旧 live session 全部结束后释放 client，让旧进程空闲退出，再由下一次连接启动新版本。

Webview applied ACK 从真实 xterm 完成 callback 发出，Host 与 Supervisor 分别校验 session/authority/revision 单调性。Host 的周期 cache refresh 复用现有 projection refresh in-flight，并在 session replacement、delete 和 Host dispose 时清理 timer；测试必须覆盖 refresh RPC 期间 live tail、无 attach 长输出、失败保留、旧 capability 缺失和 stale timer。

PR #255 follow-up 先修改 Supervisor：为每个 session 增加串行 terminal operation 边界，output、resize、scrollback 的 revision append 与广播必须按 admission 顺序发布；exit 先同步设置 finalizing gate，再等待已进入队列的操作，生成 fresh final snapshot。随后修改 Webview controller，把“观察到新 session output”与“已应用新 session snapshot”分离，按 authority revision 对账 pre-snapshot backlog。最后修改 Host 与共享 metadata/protocol，使 completed terminal stream 在 durable state 写入成功后才允许删除 Supervisor journal，并让无 live session 的 `postExecutionSnapshot()` 仍能发送该 stream。

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
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade node scripts/smoke/run-vscode-smoke.mjs
    npm run test:smoke

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

进入实现后，至少需要自动化覆盖：多节点持续输出下唯一输入节点的输入、ACK 与真实回显优先；逐字节核对所有 controller 无缺失、无重复且有界公平推进；hidden/visible 切换；Webview recreate；Host 完全退出期间 persistent Agent 持续输出并在重连后完整补齐；local PTY 和 live runtime reattach；输出后立即 exit；旧 supervisor 无序号 tail；ANSI 控制序列跨 chunk/跨边界；checkpoint/log 与 raw stream 的连续性；最终输出、exit banner 和 scrollback 完整性。review follow-up 新增并通过了：scrollback/output 对外 revision 严格单调；exit 后 resize 被拒绝且唯一非 live snapshot 的 checkpoint/revision 完整；同一 revision 的 snapshot+增量只应用一次而两个相同文本 revision 保留两次；超过 5 MiB 的 completed terminal 在 Host reload 后仍完整恢复；真实 Host 离线空窗内结束的 Terminal 在重开后仍保留完整 final stream。完整 `npm test` 的非终端基线失败继续按固定 main 对照记录，不改变本轮新增验收结论。

## 幂等性与恢复

历史查询和文档更新可重复执行。本分支与实现均位于当前 `dev-session-canvas6` worktree；journal 测试全部使用临时目录，同一 session 只有显式 delete 才移除 journal。stale manifest 只在完整 checksum tail 可验证时修复，最后不完整 record 只截断到上一条完整换行；中间损坏保持 fail closed。旧 tail 不会被猜测性升级成新 authority checkpoint。真实旧 Supervisor fixture 每次从固定 Git ref 重新物化到 `.debug/`，可安全覆盖重跑。

## 证据与备注

当前最关键的历史证据：

    PR #152: fix(execution): 优化多 Agent 输入响应与终端链接解析
    PR #176: fix(execution): 优化多 Agent 输入响应调度
    PR #203: fix(webview): 修复多 Agent 输出渲染饥饿
    PR #229: fix(terminal): 修复序列化终端快照陈旧
    PR #236: fix(terminal): 降级旧 supervisor raw tail 快照

PR #152 的 `docs/exec-plans/active/execution-input-responsiveness.md` 记录了 6 MB raw backlog、5 MB snapshot 等待队列、重复 attach/hydrate、sequence stale loop 和 ACK 被 output flood 挤压等现场数据。该文档是高价值证据，但它仍是当时方案的执行记录，不自动等于本轮应延续的设计结论。

## 接口与依赖

第一阶段新增 `terminalSessionStreamV1` capability、`sessionId + authorityId + revision` 事件模型、`deferSubscription`、`subscribeSession(afterRevision)` 与 `sessionTerminalEvent`。Pane Gallery 现场修复新增 `terminalProjectionSnapshotV1` 和只读 `getSessionSnapshot(sessionId)`；它不修改 socket subscription。本阶段继续新增 `webview/executionTerminalApplied`、`terminalAppliedRevisionAckV1` 与 Supervisor `ackSessionRevision`，ACK 用 `consumerId: 'panel' | 'editor'` 区分同一 socket 上的两个 surface；旧 session 使用显式 `legacy-read-only` 投影模式。`host/executionOutput` 为 authority output 携带 revision range，resize/scrollback 通过 `host/executionTerminalEvent` 保序投影。共享结构定义在 `terminalSessionStream.ts`、`protocol.ts` 与 `runtimeSupervisorProtocol.ts`；周期调度 helper 定义在 `terminalProjectionRefreshScheduler.ts`；Host 和 Webview 不隐式补造 revision。

---

最后更新说明：2026-07-10 至 2026-07-11 完成历史诊断、Supervisor authority、完整 journal/checkpoint、无损调度、新投影恢复、旧 Supervisor 退役、applied ACK、周期 cache、10-Agent 基准和真实生命周期第一轮收口。2026-07-12 根据 PR #255 review 重新打开计划，随后完成 session 级 mutation/publication/finalization/delete 串行化、按 authority revision 对账 Webview snapshot 前增量、completed terminal stream durable handoff、大于 5 MiB reload 与 Host 离线 completed 真实恢复。完整 smoke 与相关定向验证通过；全量 Webview 的陈旧截图和高负载超时如实保留，不冒充清洁通过，计划重新归档。
