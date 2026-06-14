# 执行节点输入响应性修复

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前任务是把多 Agent / Terminal 同时运行时仍能感受到的明显输入卡顿继续收敛；前一轮 file-link 懒解析已经证明链接解析不再进入热路径，因此本计划把焦点转到真实输入端到端链路、Webview 输出让步和 Host 状态持久化。

## 目标与全局图景

用户在画布上同时运行多个 Agent 节点时，应该能在任一执行节点里稳定输入，不会因为其他节点持续输出、状态刷新或落盘而出现明显停顿。完成后，即使 Host 仍在接收大量输出，Webview 侧也要优先处理输入，Host 侧也要能在诊断中区分输入卡在 Webview postMessage、Host 消息接收、runtime supervisor 请求、PTY 写入还是状态持久化。

本计划的可观察结果有两类。第一，新的宿主诊断中会出现更细的输入样本，例如 Webview input 调度、Host input 收到、Host input 总耗时，以及必要时的 supervisor 请求耗时。第二，高频输出时 Webview 不再无限制把所有 pending output 一帧内全部推进到 xterm，而是用每帧预算和输入后短暂让步窗口保证用户事件先获得主线程。

## 进度

- [x] (2026-06-11 21:25 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、当前工作树状态和最新宿主诊断摘要，确认 file-link resolve 已为 0，但用户仍感知到超过 200ms 的输入卡顿。
- [x] (2026-06-11 21:35 +0800) 梳理输入与输出链路：Webview 的 `terminal.onData` 直接 `postMessage(webview/executionInput)`；Host 的 `writeExecutionInput` 对 supervisor 输入会等待 request ack；输出 drain 当前在一个 animation frame 内遍历所有 pending controller 并无预算地调用 `terminal.write`。
- [x] (2026-06-11 22:05 +0800) 实现端到端输入诊断：协议允许携带 input sequence 与 Webview 时间戳；Webview 记录输入事件到 postMessage 的耗时；Host 收到消息时记录从 Webview 到 Host 的 queue delay，并在完整写入结束时带同一 sequence 记录 `host-input-write`。
- [x] (2026-06-11 22:16 +0800) 实现 Webview 交互优先输出调度：输出 drain 增加每帧 controller / 字符预算；输入发生后的短窗口内仅小块推进输出，并优先推进刚输入节点的回显。
- [x] (2026-06-11 22:25 +0800) 补充 Host 状态持久化诊断：记录 `persistState`、主 snapshot 写入和 `workspaceState.update` 的慢样本耗时、节点数与字节数，用于验证频繁落盘是否参与剩余卡顿。
- [x] (2026-06-11 22:34 +0800) 更新正式设计文档和协议测试，覆盖新增输入 metadata、`host-input-received`、`host-state-persist` 与 `webview-main-thread-lag` 诊断 source。
- [x] (2026-06-11 22:43 +0800) 完成当前验证：`npm run test:protocol-webview-messages`、`npm run typecheck`、`npm run build`、定向 `npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"` 与 `git diff --check` 均通过。
- [x] (2026-06-11 18:05 +0800) 分析新宿主诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T08-05-07-282Z`，确认 file-link request 仍为 0，剩余慢路径集中在 Host 状态持久化。
- [x] (2026-06-11 18:20 +0800) 实现 live execution state 的延迟合并持久化：默认把高频运行态落盘合并到 1.5s debounce / 5s max wait，生命周期边界、宿主边界、测试 reload 和诊断 dump 仍强制 flush。
- [x] (2026-06-11 18:30 +0800) 为 first output 增加持久化栅栏：如果首个输出到达时启动快照仍未安全写出，Host 先标记 `persisted: false`，Webview 缓冲输出并等 `persisted: true` 后再写入 xterm，避免为降频落盘牺牲恢复正确性。
- [x] (2026-06-11 18:45 +0800) 完成第二轮验证：`npm run test:protocol-webview-messages`、`npm run typecheck`、`npm run build`、定向 `npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"` 与 `git diff --check` 均通过；Playwright 首次在沙箱内因 Chromium sandbox 权限失败，已按仓库流程在沙箱外重跑通过。
- [x] (2026-06-11 21:05 +0800) 分析第三轮诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T12-35-46-410Z`，确认 deferred coalescing 已减少写次数，但剩余 `workspaceState.update` 单次耗时恶化到秒级，且输入仍主要排队在 Host 消息处理前。
- [x] (2026-06-11 21:35 +0800) 实现 active execution session 期间的 `workspaceState` 非热路径化：主 `canvas-state.json` 与 root-local snapshot 继续写出，`workspaceState.update` 在有活跃执行会话时默认跳过，并把诊断 schema 提升到 4 记录 `workspaceStateMode`。
- [x] (2026-06-11 23:20 +0800) 分析第四轮诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T14-43-43-595Z`，确认 `workspaceState` 已退出热路径，剩余问题转为 Webview 主线程 timer lag、隐藏/恢复后的输出 backlog 突刺，以及 Host 侧 headless xterm / line-context 处理与 live `stateUpdated` 仍可能竞争输入。
- [x] (2026-06-11 23:55 +0800) 实现第四轮交互优先：Webview output drain 改为全局 frame 字符预算、queued write 背压、hidden pause 和 lag/visibility recovery 小预算；Host 侧 live output 的 serialized terminal state 与 line-context tracker 改为批处理，常规 live state sync 默认只持久化不强制 `host/stateUpdated`。
- [x] (2026-06-12 11:20 +0800) 分析第五轮诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-06-12T02-58-38-216Z`，确认 schema 5 解决了分钟级 Webview lag 和 backlog 突刺，但输入仍有稳定 275ms 到 377ms 的 Host received queue delay。
- [x] (2026-06-12 11:45 +0800) 实现第五轮诊断插桩：Host 收到 `webview/executionInput` 后立即回 `host/executionInputAck`，Webview 记录 `webview-input-ack` 往返耗时；Host 同时增加 `host-event-loop-lag` timer-lag 监控。明确不做本地 echo 或 Host 写入前的乐观反馈。
- [x] (2026-06-13 22:40 +0800) 分析 schema 6 现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-06-13T13-53-34-850Z`，确认真实 ack 往返平均约 142ms、最大 272ms，Host event-loop 未出现对应慢样本；剩余体感卡顿主要来自 Webview 长时间 timer-lag 后恢复时积累约 6.1MB 待渲染 raw output。
- [x] (2026-06-13 23:10 +0800) 实现第六轮修复：Webview 在 lag/visibility restore 后若单节点 pending raw output 超过 512KB，不再逐字节 replay，而是丢弃 Webview 侧待渲染 backlog、通过 `webview/attachExecutionSession` 请求 Host serialized terminal snapshot 重建显示，并用 `outputSequence` 屏蔽 reset 边界前的旧输出。
- [x] (2026-06-14 01:22 +0800) 分析 schema 7 现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-06-13T15-44-39-405Z`，确认 snapshot reset 已替代 raw replay，但 reset 等待期仍持续暂存新 output，`pendingOutputLength` 最高约 5.59MB。
- [x] (2026-06-14 01:40 +0800) 实现第七轮修复：`webview/attachExecutionSession` 携带 reset `requestId`，Host snapshot/output 携带 `executionSessionId`，Webview 增加 reset 超时重试、snapshot applied/timeout 诊断、deferred output 预算压缩和诊断采样。
- [x] (2026-06-14 12:56 +0800) 按最新结论补齐第八轮边界修复：snapshot reset 处理 session exit、迟到 reset snapshot、无 `outputSequence` live/ended snapshot；file-link activation timeout/reject 改为 search fallback；fallback path gate 拆成 interactive/background 分层并透传到 Host backstop；新增行为测试替代继续增加源码 regex 断言。
- [x] (2026-06-14 14:28 +0800) 分析现场诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-14T05-43-23-414Z`，确认 file-link 与 MB 级 raw backlog 已退出当前热路径；剩余恢复窗口卡顿来自同一 panel generation 内重复 attach snapshot 和多个执行终端 snapshot hydrate 与用户输入竞争。
- [x] (2026-06-14 14:55 +0800) 实现第九轮修复：执行节点挂载时只发一次普通 attach snapshot，请求 snapshot hydrate 进入全局串行调度队列，最近输入节点优先，其余 snapshot restore 按帧/短延迟错峰推进；保持 Host 写入前不做本地 echo。
- [x] (2026-06-14 15:20 +0800) 完成第九轮验证：`npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:execution-terminal-links`、`npm run test:execution-terminal-native-helpers`、定向 Playwright attach/snapshot hydrate 与 snapshot reset 边界回归、`git diff --check` 均通过。

## 意外与发现

- 观察：最新宿主诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T04-36-54-156Z` 中 `diagnosticsSchema.executionFileLinkResolve = 3` 且 file-link `requestCount = 0`，说明“交互优先 + 懒解析”已经让文件解析退出热路径。
  证据：`summary.json.diagnostics.executionFileLinkResolveSummary` 里 request、candidate、duration 全为 0。

- 观察：同一份诊断中 `host-input-write` 只记录了 Host 写入 session 的耗时，p95 为 151ms、max 为 209ms；用户感受到“不只是 200ms”说明卡顿很可能发生在当前插桩之外，例如 Webview 主线程输入事件排队、postMessage 到 Host 排队、或输入后的可见回显被输出写入饿死。
  证据：`execution-performance-diagnostics.json` 只有 `webview-input-dispatch` 缺样本，因为当前阈值只保留 24ms 以上 postMessage 同步耗时，而主线程排队在回调触发前不会被该指标捕获。

- 观察：Webview 的 `scheduleExecutionTerminalDrain` 当前会在一个 animation frame 中把所有 pending controller 都 `flushPendingOutput()`，每个 controller 再把全部 pending output 作为一次 `terminal.write(chunk)` 交给 xterm。真实 dump 里存在单次 300k~430k 字符的 webview write，虽然 callback duration 小于 40ms，但大块写入会让 xterm 内部 parser 后续继续占用主线程，影响输入回显体感。
  证据：最新诊断 `latestSamples` 中 `webview-terminal-write` 有 `characters: 434258` 和 `characters: 342712` 的 output write。

- 观察：测试诊断事件里 `state/persistQueued` 与 `state/persistWritten` 各 958 次，部分秒内达到 5-7 次写入；这不直接证明是主因，但说明 Host extension 仍在高频执行完整状态持久化，可能和 input write / supervisor request 竞争同一 extension host 事件循环。
  证据：对 `diagnostic-events.json` 按秒聚合，`2026-06-11T04:11:55` 有 7 次 `persistWritten`，后续多秒持续 5-6 次。

- 观察：只记录 `webview-input-dispatch` 不能捕捉“回调触发前 Webview 主线程已经被饿死”的时间，因为那段时间输入事件本身还没有进入 JavaScript。
  证据：本轮增加 `webview-main-thread-lag` timer-lag 监控；它不绑定具体节点，但能证明 Webview 主线程是否存在 120ms 以上的整体事件循环停顿。

- 观察：新诊断 `/home/users/ziyang01.wang-al/projects/dsc-test-03/.debug/current-host-diagnostics/2026-06-11T08-05-07-282Z` 已经把剩余问题指向 Host 侧状态持久化风暴，而不是 Webview lifecycle 或 file-link resolver。
  证据：`executionFileLinkResolveSummary.requestCount = 0`；`executionPerformanceSummary.sourceCounts` 中 `host-state-persist = 488 / 500`，`host-output-chunk = 2 / 500`，`host-input-received = 10 / 500`。

- 观察：输入消息到达 Host 前已经排队 110ms 到 266ms，且所有 10 个输入样本都超过 100ms。
  证据：`host-input-received` 样本的 `queueDelayMs` 为 259、131、110、109、266、110、222、235、234、110；这些值说明输入事件不是卡在 PTY 写入本身，而是在 Host 能处理消息前已经被同一事件循环上的其他工作阻塞。

- 观察：`workspaceState.update` 是 Host 状态持久化的主要慢段，而同步构造状态本身相对较小。
  证据：`host-state-persist` 中 `persist-workspace-state` 416 个样本，平均 161.45ms，p90 262ms，p95 300ms，max 470ms；`persist-state` 72 个样本，平均 25.31ms，max 38ms。

- 观察：延迟持久化不能简单丢掉启动时的首个状态快照，否则 Webview 已显示输出但宿主/落盘快照还不知道该会话存在，跨宿主恢复会退化。
  证据：live execution state 的高频更新是输出热路径，启动/重连的首个快照又是恢复正确性的边界，因此需要用 `persisted` 标志让 Webview 暂存首个输出，等 Host flush 完成后再释放。

- 观察：第二轮 deferred coalescing 降低了写入次数，但没有解决根因；剩余 `workspaceState.update` 本身在用户现场已经变成秒级长任务。
  证据：`2026-06-11T12-35-46-410Z` 诊断中 `state/persistDeferred = 622` 只落成 `state/persistWritten = 66`，但 `host-state-persist` 平均 1271.64ms、p95 2209ms、max 16573ms；其中 `persist-workspace-state` 平均 1555.79ms、p95 2635ms、max 16573ms。

- 观察：当前剩余输入卡顿仍不是 Webview 写入主因，而是 Host 能处理输入消息前被持久化长任务堵住。
  证据：同一诊断中 `host-input-received.queueDelayMs` 平均 945ms、p95 4019ms、max 5289ms；`host-input-write` p50 18ms、p95 147ms；`webview-terminal-write` max 31.3ms，且没有 `webview-main-thread-lag` 样本。

- 观察：第四轮诊断证明上一次 `workspaceState` 非热路径化有效，但瓶颈转移到了 Webview 主线程和 Host 侧未拆分的运行时处理。
  证据：`2026-06-11T14-43-43-595Z` 中 `diagnosticsSchema.executionPerformance = 4`、`state/workspaceStateSkipped = 94`、`host-state-persist` 只有 7 个样本；同时 `webview-main-thread-lag` 有 67 个样本，p95 约 59488ms，`host-input-received.queueDelayMs` p95 约 7157ms。

- 观察：Webview 已经把单次 `xterm.write` 限到 65536 字符以内，但 drain 诊断显示一轮恢复后仍会在极短时间内推进 20万到 42万字符的 backlog，说明旧预算按 controller 计而非全局 frame 计，且没有等待 xterm parser 队列真正退水。
  证据：同一诊断在 `2026-06-11T14:43:31` 附近出现 `webview-terminal-drain.characters = 427750 / 336810 / 205738 / 74666`，紧跟多个 `webview-terminal-write.characters = 65536`。

- 观察：14:33 附近 Host 输入 queue delay 出现 5 秒到 9.6 秒的排队，但性能样本没有对应的 `host-state-persist` 慢段；这指向输出处理中的 headless xterm 状态追踪、line-context 追踪或持续 postState / React 状态更新，而不是已经跳过的 `workspaceState.update`。
  证据：同一诊断 `host-input-received` 序列 31 到 54 的 queueDelayMs 大多在 4094ms 到 9607ms，期间 `state/persistWritten` 多为 skip 且耗时未进入慢样本；`diagnostic-events` 同时显示大量 `state/persistDeferred` 跟随 live output。

- 观察：第五轮诊断证明第四轮 backlog scheduling 有效，但也暴露出一个稳定而非尖刺型的输入延迟底噪。
  证据：`2026-06-12T02-58-38-216Z` 中 `diagnosticsSchema.executionPerformance = 5`，没有 `webview-main-thread-lag` 样本，`host/stateUpdated = 2`，`webview-terminal-drain` 不再出现几十万字符样本；但 `host-input-received.queueDelayMs` 最小 275ms、p50 309ms、p95 377ms、max 654ms。

- 观察：剩余延迟不应再通过本地 echo 掩盖。
  证据：`host-input-write` p50 12ms、p95 122ms，说明 Host 实际写入路径仍需保留为真实反馈边界；用户明确要求不要在 Host 尚未写入时本地反馈，因此本轮只增加 ack 诊断与 Host event-loop lag，不改变交互语义。

- 观察：第六轮现场诊断显示 `host-input-received.queueDelayMs` 不能再直接解释成 Host 阻塞。
  证据：`2026-06-13T13-53-34-850Z` 中 `webview-input-ack` 10 个样本平均约 142ms、最大 272ms，而同一批 `host-input-received.queueDelayMs` 稳定约 2.3s 到 2.5s；缺少对应 `host-event-loop-lag` 样本，说明该 queueDelay 很可能混有 Webview/Host 时钟偏差或 Webview 停摆后的 stale epoch，真实用户可感知链路应优先看 Webview 视角 ack 和后续可见回显。

- 观察：当前剩余明显卡顿来自 Webview 恢复后的 raw output backlog，而不是 Host 写入。
  证据：同一诊断有 24 条 `webview-main-thread-lag`，多数约 59.5s、最大约 119.5s；恢复时 `webview-terminal-drain.pendingOutputLength` 达到 6,142,227，`controllerCount = 4`，随后 drain reason 包含 `lag-recovery` 162 次和 `input-throttle` 32 次。即使每次 drain 有预算，仍会让新输入的 Host 输出排在大量旧 raw output 后面。

- 观察：第七轮现场诊断证明 snapshot reset 方向有效但握手不完整，Webview 已经不再留下大 `webview-terminal-drain` raw replay 样本，却在等待 snapshot 时持续把新 output 放进 `pendingSnapshotOutputQueue`。
  证据：`2026-06-13T15-44-39-405Z` 中 `diagnosticsSchema.executionPerformance = 7`，`webview-input-ack` 平均约 126ms、最大约 159ms；但 retained `webview-output-snapshot-reset = 446`，其中 444 条是 `output-deferred-until-snapshot-reset`，`pendingOutputLength` 从约 5.47MB 增长到约 5.59MB，且 retained `host-messages.json` 没有 `host/executionSnapshot`。

- 观察：逐 chunk 记录 `output-deferred-until-snapshot-reset` 会挤掉真正关键的 reset trigger、request、snapshot applied/timeout 事件，降低下一轮诊断可解释性。
  证据：同一份 `diagnostic-events.json` 保留的 2000 条事件中有 1775 条是 deferred 诊断；`execution-performance-diagnostics.json` 的 500 条 retained samples 中有 446 条来自 snapshot reset，早期 trigger 已被挤出 retained window。

- 观察：第七轮 bounded reset 解决了大 backlog，但正确性边界仍必须闭合在“会话结束”和“无 sequence snapshot”上。
  证据：`host/executionExit` 没有 `executionSessionId`，但它是当前节点/kind 的 session 结束信号；若 reset 等待期不清理，后到 snapshot 或 deferred output 仍可能覆盖 exit 画面。`host/executionSnapshot.outputSequence` 是 reset 后安全重放的唯一顺序边界；live snapshot 缺少该字段时无法判断等待期 output 是否在 snapshot 之后。

- 观察：懒解析把 hover 从热路径移开后，activation path 必须保证“点击有反馈”。
  证据：Webview file-link resolve timeout 为 2.5s；在卡顿场景中若 activation 直接等待超时 reject，用户看到的是点击无响应。把 reject/timeout 收敛为 search fallback 能保持用户路径可见，同时仍不在 Host 未写入时做终端本地 echo。

- 观察：file-link 候选不应继续全局收紧，应该区分后台预算和用户明确点击。
  证据：`custom/tool` 这类 extensionless path 在 strict gate 下会被过滤，但用户点击时已经表达明确意图；interactive gate 可以允许这类 path 进入一次解析，同时 background gate 仍拒绝它，避免 live output 后台刷新重新制造 Host 解析压力。


- 观察：第九轮现场诊断显示前几轮优化已经把主要热路径收敛到恢复窗口，而不是稳态输出。
  证据：`2026-06-14T05-43-23-414Z` 中 file-link request 为 0，没有 `webview-output-snapshot-reset`、`webview-main-thread-lag` 或大 `webview-terminal-drain` 样本；`webview-input-ack` 平均约 94.8ms、最大约 158.1ms。

- 观察：同一恢复窗口里，每个 live 节点出现两次普通 attach/snapshot，4 个 Agent 最终收到 8 个 `host/executionSnapshot`；这些 snapshot hydrate 与 seq 1-8 的输入重叠，形成当前可见卡顿主因。
  证据：`05:43:18.433Z` 到 `05:43:18.462Z` 出现 8 次 `execution/attachRequested` / `execution/snapshotPosted`；Webview 随后在 `05:43:18.570Z` 到 `05:43:18.601Z` 连续写入 10KB、19KB、30KB、19KB 的 snapshot，而输入 ack 同期落在 66ms 到 111ms。

## 决策记录

- 决策：本轮不再继续收紧 file-link 规则，而是把输入链路和输出 / 持久化竞争拆开处理。
  理由：最新诊断已经证明 file-link request 为 0；继续优化 resolver 不能解释用户感受到的剩余输入卡顿。
  日期/作者：2026-06-11 / Codex

- 决策：Webview 输出 drain 必须有 per-frame budget，并且输入发生后的短时间窗口内让输出让步。
  理由：输出属于可延迟流式数据，输入属于用户交互；大块 `terminal.write` 即使 callback 快，也可能把 xterm parser 后续任务排在用户输入回显之前。
  日期/作者：2026-06-11 / Codex

- 决策：Host 输入诊断要记录 Webview sequence 与时间戳，但不记录完整输入内容，只保留字节数、字符数和安全 preview。
  理由：端到端延迟需要跨进程关联；同时终端输入可能包含敏感文本，诊断必须避免泄漏完整内容。
  日期/作者：2026-06-11 / Codex

- 决策：输入后的输出让步不完全暂停所有输出，而是使用“小块 + 输入节点优先”的预算。
  理由：完全暂停会让用户输入后的回显也被延迟；小块推进刚输入节点可以让 echo / prompt 更新先出现，同时限制其他节点大块输出继续抢占主线程。
  日期/作者：2026-06-11 / Codex

- 决策：live execution state 的常规持久化默认从 immediate 改为 deferred，并用 debounce 与 max wait 合并多节点输出期间的快照写入。
  理由：最新诊断显示 `workspaceState.update` 在 Extension Host 事件循环上形成 400 多次慢样本，直接解释输入消息到达 Host 前的 110ms 到 266ms queue delay；运行中 terminal state 可以短时间延迟，而生命周期边界仍可强制 flush。
  日期/作者：2026-06-11 / Codex

- 决策：宿主边界、停止/挂起/等待输入/恢复确认、测试 reload 和诊断 dump 继续使用 immediate 或显式 flush，不纳入延迟合并。
  理由：这些场景是恢复与可观测性的正确性边界；把它们也延迟会让“体验优化”变成潜在数据丢失。
  日期/作者：2026-06-11 / Codex

- 决策：首个未持久化输出不丢弃、不立即写 xterm，而是在 Webview controller 内设置 `pendingPersistBarrier` 并缓冲；Host 写完快照后发送空的 `persisted: true` output 释放栅栏。
  理由：早期实现如果只跳过 `persisted: false` 的首个 chunk，会造成输出丢失；缓冲栅栏能同时满足恢复正确性和输出完整性。
  日期/作者：2026-06-11 / Codex

- 决策：活跃执行会话期间，`workspaceState` 不再参与常规持久化热路径；此时只写主快照文件和 root-local snapshot，`workspaceState` 仅保留为无活跃执行时的兼容 fallback。
  理由：`loadState()` 已以 `canvas-state.json` / root-local snapshot 为主恢复源，`workspaceState` 只是 fallback；真实诊断显示即使降低频率，单次 `workspaceState.update` 仍会把 Extension Host 阻塞到秒级，继续保留在热路径会直接破坏输入体验。
  日期/作者：2026-06-11 / Codex

- 决策：Webview 输出预算从“每个 controller 一个大块”改为“整帧全局字符预算 + 每 controller 小块 + queued write 背压”。
  理由：现场显示单个 `xterm.write` 已被限制，但一帧仍可能跨多个 controller 累计推进数十万字符；只有全局预算和等待 queued write 退水，才能避免 xterm parser 队列继续饿死输入。
  日期/作者：2026-06-11 / Codex

- 决策：Webview hidden 或刚恢复可见时不立即回放 backlog，而是暂停或进入小预算 recovery。
  理由：分钟级 timer lag 很可能包含 VS Code Webview 背景节流；恢复可见后一次性补写积压输出会制造用户刚回到画板时的二次卡顿。
  日期/作者：2026-06-11 / Codex

- 决策：Host 侧 headless xterm 的 serialized state 和 line-context tracker 允许批处理，常规 live output state sync 默认不再强制 `host/stateUpdated`。
  理由：这些工作服务恢复和链接上下文，属于可延迟一致性；用户输入和当前可见终端输出才是热路径，生命周期边界、输入提交、停止和诊断仍会强制 flush 或显式 postState。
  日期/作者：2026-06-11 / Codex

- 决策：新增 `host/executionInputAck` 和 `webview-input-ack` 只用于测量 Webview 到 Host 再回 Webview 的真实消息桥往返，不做本地 echo 或任何 Host 写入前的乐观反馈。
  理由：第五轮诊断显示剩余延迟像固定 bridge / 事件循环底噪；ack 能区分消息桥延迟、Host event-loop lag 和后续写入耗时，同时遵守用户“不在 Host 还没写入时本地反馈”的交互约束。
  日期/作者：2026-06-12 / Codex

- 决策：Host event-loop lag 使用和 Webview main-thread lag 对称的 timer-lag 样本，并随样本记录当前执行 session 数。
  理由：如果 275ms 到 377ms 的 queueDelay 来自 Extension Host 事件循环，它应在 `host-event-loop-lag` 中出现；如果没有对应 lag，则更可能是 VS Code Webview bridge、远端扩展宿主调度或跨进程时钟差。
  日期/作者：2026-06-12 / Codex

- 决策：Webview raw output backlog 不是正确性真源；当 Webview 刚经历长时间 lag/visibility restore 且单节点待渲染 backlog 超过 512KB 时，必须以 Host serialized terminal snapshot 替代 raw replay。
  理由：直接截断 raw output 会破坏 ANSI 状态、alternate screen 和 scrollback；继续 replay 数 MB backlog 又会阻塞输入回显。Host 的 `SerializedTerminalStateTracker` 才是恢复真源，因此 reset 边界要清空 Webview pending output、请求 Host snapshot，并用 `outputSequence` 避免 reset 前旧输出在 snapshot 后重放。
  日期/作者：2026-06-13 / Codex

- 决策：snapshot reset 必须成为有 request id、超时重试和预算上限的握手，而不是只发一次 attach 后无限暂存新 output。
  理由：schema 7 诊断显示 reset 已避免 raw replay，但等待 snapshot 期间仍可重新堆到 5MB 以上；第七轮把 `requestId` 传到 Host snapshot 回包，1.5s 未应用时重试，deferred output 超过 256KB 时丢弃暂存 tail 并推进 reset 边界重新请求 snapshot。这样仍不做 Host 写入前本地反馈，也不在没有 Host snapshot 时假装输出已显示。
  日期/作者：2026-06-14 / Codex

- 决策：`output-deferred-until-snapshot-reset` 改为按累计 128KB 或 1 秒采样，并新增 `snapshot-reset-requested`、`snapshot-reset-applied`、`snapshot-reset-timeout`、`deferred-output-budget-reset` 等 reason。
  理由：逐 chunk 诊断会污染 retained window；采样后仍能看到等待期增长速度，同时保住 reset 触发、请求、应用和超时这些定位握手问题必需的事件。
  日期/作者：2026-06-14 / Codex

- 决策：pending snapshot reset 期间，live snapshot 如果没有 `outputSequence`，不应用也不清理 reset；ended snapshot 缺少 sequence 时可以作为最终画面收口，但不能重放等待期 output。
  理由：live unsequenced snapshot 没有可靠顺序边界，应用它会把 reset 后 deferred output 的顺序变成猜测；ended snapshot 表示 session 已无后续 live output，允许用 Host 最终状态关闭 reset，但等待期 live output 仍不能在未知顺序下 replay。
  日期/作者：2026-06-14 / Codex

- 决策：session exit 必须立即清理 pending snapshot reset，并把后到的 `snapshot-reset-*` 回包当作 stale snapshot 忽略。
  理由：exit 是用户可见生命周期边界；如果迟到 reset snapshot 还能覆盖 exit 画面，snapshot reset 会从“修复 backlog”变成“复活旧会话画面”的正确性风险。
  日期/作者：2026-06-14 / Codex

- 决策：pending file link activation 的 resolve timeout / reject 必须降级为 search fallback，而不是 no-op。
  理由：懒解析的目标是把 Host 文件解析移出 hover 热路径，不是牺牲交互确定性；越是卡顿现场，用户点击越需要可见 fallback。
  日期/作者：2026-06-14 / Codex

- 决策：fallback path gate 拆成 background strict 与 interactive broader；interactive 只由用户 activation 触发，background/live refresh 继续 strict。
  理由：继续一味收紧会损失 `custom/tool` 等真实项目路径；但把这类 path 放回后台刷新会恢复 Host 解析压力。priority 分层让“用户明确点击”获得更宽候选，同时保住后台预算。
  日期/作者：2026-06-14 / Codex

- 决策：新增覆盖优先使用 Webview/Host helper 行为测试，不再为本轮结论继续追加源码 regex 断言。
  理由：源码 regex 测试只能验证实现形状，容易鼓励为匹配源码而写代码；本轮关键结论都能通过 Playwright activation/snapshot 行为和 helper 输入输出验证。
  日期/作者：2026-06-14 / Codex


- 决策：普通 live attach snapshot 必须去重，执行节点 mount 后已请求过 attach snapshot 时，不再因为 `liveSession` effect 立即重复请求；只有从非 live 变为 live 且当前 mount 尚未请求时才补发。
  理由：Host 启动路径和 snapshot reset 仍可显式投递 snapshot；重复普通 attach 只会在 panel restore 时把 N 个节点放大成 2N 个 snapshot hydrate，加重恢复窗口卡顿。
  日期/作者：2026-06-14 / Codex

- 决策：snapshot hydrate 和普通 output drain 分开调度，但同样遵循交互优先；一次只允许一个 snapshot restore 写入 xterm，最近输入节点优先，其余节点按短间隔 stagger。最近输入发生后，snapshot restore 至少让出一个短窗口，但单个 snapshot 在队列中等待过久时会突破让步上限继续恢复，避免连续输入把画面 hydrate 永久饿死。
  理由：snapshot 是恢复正确性边界，不能像 raw backlog 一样丢弃或本地伪造；但多个 xterm serialized state 同帧 hydrate 会与输入竞争主线程。串行加优先级能保留真实 Host snapshot 语义，同时减少恢复窗口对输入的阻塞。
  日期/作者：2026-06-14 / Codex

## 结果与复盘

当前计划的第一轮实现已完成。新增协议字段让 `webview/executionInput` 携带 `sequence`、`webviewEpochMs` 与 `webviewPerformanceNowMs`；Webview、Host received、Host write 三类样本可以用同一 sequence 串起来。Webview 侧还新增 `webview-main-thread-lag`，用于捕捉输入回调触发前的整体主线程停顿；Host 侧新增 `host-state-persist`，用于判断高频持久化是否参与卡顿。

交互策略上，Webview output drain 不再无限制地一帧内处理所有 pending controller，也不再把几十万字符作为一个不受控的大块持续塞给 xterm。普通输出每帧最多处理少量 controller 和固定字符预算；输入发生后的短窗口内进一步缩小 chunk，并把刚输入节点排在前面，优先保障回显。

第二轮诊断已经证明真正主因是 `workspaceState.update` 的高频串行写入。当前实现把 live execution state 的运行中持久化改为延迟合并，并保留生命周期边界立即 flush；这应把多 Agent 输出期间的 `state/persistQueued` / `state/persistWritten` 从每个节点每秒多次降到合并后的低频写入。为避免首个输出早于会话快照落盘，Webview 会在收到 `persisted: false` 时缓冲输出，等 Host 发出 `persisted: true` 后再写入 xterm。

第三轮诊断证明“只降低写次数”不够，必须把 `workspaceState.update` 从运行中交互热路径移走。当前实现继续同步写主快照文件以保护恢复正确性，但在有活跃 Agent / Terminal 会话时默认跳过 `workspaceState.update`，并用 schema 4 的 `workspaceStateMode` / `state/workspaceStateSkipped` 诊断证明跳过是否生效。

第四轮诊断证明 `workspaceState.update` 已经不再是当前热路径，瓶颈转到输出回放与 Host 侧 headless 终端状态处理。当前实现把 Webview output drain 降为更严格的全局帧预算，避免多个 controller 在同一帧累计推入大块数据；当 Webview hidden 或刚经历 timer lag / visibility restore 时，输出 backlog 暂停或小预算恢复。Host 侧 serialized terminal state 与 line-context tracker 改为短窗口批处理，避免每个 output chunk 都立即驱动 headless xterm 和 serialize；常规 live output sync 默认只持久化，不再每 1 秒向 Webview 推整份 `host/stateUpdated`。诊断 schema 提升到 5，用来区分这一代 backlog scheduling。

第五轮诊断证明 schema 5 已把 Webview backlog 和 `workspaceState` 秒级阻塞基本移除，但剩余输入延迟呈现稳定 300ms 左右底噪。当前实现把诊断 schema 提升到 6，新增 Host 立即 ack 与 Host event-loop lag 监控，用来判断这 300ms 是真实消息桥往返、Extension Host 事件循环漂移，还是跨进程时间戳偏差。此轮不改变用户可见输入反馈规则，不做本地 echo。

第六轮把明显体感卡顿定位到 Webview lag/visibility restore 后的 MB 级 raw output replay，并用 Host serialized terminal snapshot 替代 Webview backlog replay。第七轮继续收口 schema 7 暴露的问题：reset request 有 `requestId`，Host snapshot 带回该 id 和 `executionSessionId`，Webview 在 1.5s 未应用 snapshot 时重试，并在等待 snapshot 时把 deferred output 限制在 256KB 预算内；超过预算会推进 reset 边界、丢弃等待期 tail，并重新请求 Host snapshot，避免把 5MB 级队列从 `pendingOutput` 换个名字搬到 `pendingSnapshotOutputQueue`。第八轮不再改变 schema，而是闭合 correctness 边界：session exit 清理 pending reset，迟到 reset snapshot 不覆盖当前画面，live unsequenced snapshot 不作为 reset 边界，ended unsequenced snapshot 只收口最终画面不重放 deferred output。

第九轮针对 `2026-06-14T05-43-23-414Z` 诊断暴露出的恢复窗口问题继续收口：普通 attach snapshot 在 Webview mount 内去重，避免一个 live 节点在初始 effect 与 `liveSession` effect 中重复请求；snapshot hydrate 进入全局队列，最近输入节点优先，其余节点串行 stagger 写入 xterm。该修复不改变真实输入语义，仍只把 Host 写入后的 PTY / supervisor 输出作为可见反馈，不做本地 optimistic echo。

file-link 方面，第八轮保持“懒解析退出热路径”的大方向，但把 activation path 从“resolve 失败可能无响应”改为“失败就 search fallback”。同时把 fallback path 候选分成 interactive 与 background 两档：用户点击可以尝试更宽的 extensionless path，后台刷新仍保持 strict，避免回到多 Agent 输出时的 file-link 解析风暴。

本轮仍不能单凭自动化证明用户现场体感已经完全恢复；下一步必须让用户安装当前构建后重新在多 Agent 同时运行场景采集宿主诊断，重点看 `diagnosticsSchema.executionPerformance` 是否为 9，是否出现 `webview-snapshot-restore-queue`、`snapshot-reset-requested` 与 `snapshot-reset-applied` 成对样本，`snapshot-reset-timeout` 是否少量或没有，`webview-output-snapshot-reset.pendingOutputLength` 是否不再长期超过 256KB，以及 `webview-input-ack.durationMs` 是否继续保持在可接受范围。若出现 `snapshot-reset-unsequenced-snapshot`，应结合后续 timeout retry 或 session ended 样本判断 Host 是否没有带回 sequence snapshot。

## 上下文与定向

`src/webview/main.tsx` 是画布 Webview 的主要入口。执行节点用 `new Terminal(...)` 创建 xterm 实例，`terminal.onData(...)` 在用户输入时调用 `data.onExecutionInput`，再由 `postMessage` 发出 `webview/executionInput`。同一文件里的 `queueExecutionTerminalOutput`、`scheduleExecutionTerminalDrain` 和 `createExecutionTerminalController` 负责把 Host 输出写入 xterm。

`src/panel/CanvasPanelManager.ts` 是 Extension Host 的宿主权威状态。它解析 `webview/executionInput` 后调用 `writeExecutionInput`。本地 PTY 直接 `session.process.write(data)`；runtime supervisor 模式则通过 `RuntimeSupervisorClient.writeInput(...)` 发请求并等待响应。这个等待时间目前都被算进 `host-input-write`，但没有拆出连接等待、socket write、supervisor ack 与 PTY write。

`src/common/protocol.ts` 定义 Webview 与 Host 之间的消息类型和 validator。若输入消息要携带 `sequence` 或 `timestamp`，必须同步更新这里和 `scripts/test/test-protocol-webview-messages.mts`。

`docs/design-docs/embedded-terminal-runtime-window.md` 是执行终端输入 / 输出优先级的正式设计文档。任何“输出必须让步给输入”的新规则都要写入这里，并同步 `docs/design-docs/index.md` 的更新时间。

## 工作计划

第一步增加输入诊断字段。Webview 为每个执行输入生成递增 `inputSequence`，记录 `performance.now()` 时间戳和 `Date.now()` epoch，发出 `webview/executionInput` 时携带这些字段。Webview 仍保留 `webview-input-dispatch` 样本，但对输入样本强制记录或降低阈值，避免正常输入因为同步 postMessage 很快而完全看不到。Host 收到消息后立即记录 `host-input-received`，再在 `writeExecutionInput` 结束时把 sequence、webview epoch、Host received timestamp、总耗时写进 `host-input-write`。

第二步改 Webview 输出调度。`scheduleExecutionTerminalDrain` 不再一帧内 flush 全部 controller，而是按固定预算选择一小批 controller。每个 controller 的 `flushPendingOutput` 支持最多取一段 chunk，例如 64KB；剩余 pending output 留到下一帧。Webview 在 `terminal.onData` 收到输入时更新一个全局 `lastExecutionInputAt`；drain 如果发现距离最近输入不足一个短窗口，例如 80ms，就只重排下一帧，不做大块输出写入。这样输入事件和 xterm 自己的输入处理有机会先运行。

第三步补 Host 持久化诊断。`persistState`、root-local snapshot write、主 snapshot write 和 workspaceState update 应记录耗时、节点数、state hash、serialized JSON 字节数；保留阈值可以高一些，例如 16ms 或失败时强制记录。若后续诊断确认高频 persist 是主因，再单独做 coalescing / debounce；本计划先保证证据完整。

第四步补测试和文档。协议测试覆盖新增输入字段和 performance diagnostic source。Webview 测试优先覆盖“pending output 大块入队后，发送 input 不会同步触发 eager file resolve 或无预算 drain”；如果现有 harness 不易测帧预算，则至少通过协议与纯逻辑测试覆盖 validator，并保留手动宿主诊断验证说明。

第五步处理第二轮诊断暴露出的 Host 持久化风暴。`src/panel/CanvasPanelManager.ts` 中 `flushLiveExecutionState` 的默认持久化模式改为 `deferred`，`persistState` 继续立即更新内存权威状态和 Webview state，但把主 `canvas-state.json` 与 `workspaceState.update` 写入交给 `queuePersistedCanvasSnapshotWrite` 合并。合并策略使用 1.5s debounce 和 5s max wait；`flushExecutionStateImmediately`、`prepareForHostBoundary`、`dumpCurrentHostDiagnostics`、测试 reload / flush 这类边界必须显式调用 `flushDeferredCanvasStatePersist`。`src/common/protocol.ts` 给 `host/executionOutput` 增加可选 `persisted` 标志，Webview controller 在 `persisted: false` 时缓冲 output，直到后续 `persisted: true` 解除栅栏。

第六步处理第四轮诊断暴露出的 backlog 与 Host headless 处理。`src/webview/main.tsx` 的 drain 逻辑改成全局 frame 字符预算，并用 `getQueuedWriteCount()` 防止同一 controller 在 xterm parser 仍忙时继续塞入更多 chunk；`document.hidden` 时暂停 drain，恢复可见或检测到 `webview-main-thread-lag` 后进入小预算 recovery。`src/common/serializedTerminalState.ts` 与 `src/panel/executionTerminalLineContextTracker.ts` 把连续 output 短暂合并，边界操作如 `flush()`、`resize()`、`setScrollback()`、输入记录和链接 cwd 查询仍先 drain 以保持恢复和上下文正确。`src/panel/CanvasPanelManager.ts` 的常规 `queueExecutionStateSync` 默认 `postState: false`，只在输入提交、生命周期边界或显式要求时推 `host/stateUpdated`。

第七步处理第五轮诊断暴露出的稳定输入 queue delay。`src/common/protocol.ts` 给 Host-to-Webview 消息增加 `host/executionInputAck`，并把 `webview-input-ack`、`host-event-loop-lag`、`hostAckEpochMs` 纳入 execution performance diagnostic payload。`src/panel/CanvasPanelManager.ts` 在收到 `webview/executionInput` 并记录 `host-input-received` 后立即向同一 surface 回 ack，再异步进入 `writeExecutionInput`；同文件启动一个 500ms timer-lag 监控，只在 lag 超过 120ms 时记录 `host-event-loop-lag`。`src/webview/main.tsx` 保存最近输入 sequence 的 Webview performance timestamp，收到 ack 后记录 `webview-input-ack` 往返耗时。不得在 ack 或 Host 写入前向 terminal 本地 echo 输入。

第八步处理第七轮诊断暴露出的 snapshot reset 等待队列。`src/common/protocol.ts` 把 execution performance schema 提升到 8，并让 `webview/attachExecutionSession`、`host/executionSnapshot`、`host/executionOutput` 携带可选 `requestId` / `executionSessionId`。`src/panel/CanvasPanelManager.ts` 在 attach request 到 snapshot response 之间透传 `requestId`，在 snapshot/output 中附带当前 session id。`src/webview/main.tsx` 在 reset 时记录 request id，设置 1.5s timeout watchdog，超时则重发 attach；等待 snapshot 期间的 deferred output 超过 256KB 时，丢弃暂存 tail、把 reset 边界推进到最新 output sequence，并重新请求 Host snapshot。诊断只按 128KB 或 1 秒采样 deferred 增长，避免逐 chunk 挤掉关键事件。

## 具体步骤

在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas6` 执行以下工作。先修改 `src/common/protocol.ts`，给 `webview/executionInput` payload 增加可选 `sequence`、`webviewEpochMs` 和 `webviewPerformanceNowMs`，并给 `ExecutionPerformanceDiagnosticPayload` 增加 `sequence`、`webviewEpochMs`、`hostReceivedEpochMs`、`queueDelayMs` 等可选数值字段。然后修改 `src/webview/main.tsx` 的 `reportExecutionInputDispatch` 和 `CanvasDataProvider`，让输入 sequence 穿过 `onExecutionInput` 到 postMessage。

再修改 `src/panel/CanvasPanelManager.ts` 的消息处理和 `writeExecutionInput` 签名，传入输入诊断 metadata，并在收到消息与写入结束两个点记录 performance diagnostic。最后修改 `scheduleExecutionTerminalDrain` 和 `ExecutionTerminalController.flushPendingOutput`，实现输入后让步与 chunk budget。

本轮预期运行的验证命令如下：

    npm run typecheck
    npm run test:protocol-webview-messages
    npm run test:serialized-terminal-state-tracker
    npm run test:execution-terminal-line-context-tracker
    npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"
    npm run build
    git diff --check

第二轮持久化合并与第三轮 `workspaceState` 非热路径化实现后，还需要重新运行同一组验证。`npm run test:protocol-webview-messages` 必须看到 workspaceState skip generation 的 schema 断言通过；`npm run typecheck` 必须证明 `persisted` 标志、Webview controller 栅栏、Host deferred persist 类型和 `workspaceStateMode` 诊断仍一致。

如果 Playwright 在 sandbox 中因为 Chromium sandbox 失败，需要按当前 CLI 规则用已批准的 `npm run test:webview` 外部权限重跑，并在结果中说明第一次失败原因和重跑结果。

## 验证与验收

自动化验收至少要求 TypeScript、协议消息测试和定向 Webview 测试通过。手动验收需要用户在多 Agent 同时运行的场景重新执行 `Dev Session Canvas: 落盘当前宿主诊断`，预期看到以下变化：`executionFileLinkResolveSummary.requestCount` 仍应接近 0；`executionPerformanceDiagnostics` 中应出现 `webview-input-dispatch`、`host-input-received` 和 `host-input-write` 的可关联 sequence；如果仍感到明显卡顿，诊断能显示主要延迟落在 Webview 到 Host 的 queue delay、Host write duration、还是输入后的输出回显被 delayed output drain 影响。

如果 Webview 输出预算生效，大块输出不应再以单次数十万字符的 `webview-terminal-write` 长时间连续出现；更理想的结果是单次 output write 字符数被限制在 64KB 以内，输入后短窗口内限制在 8KB 以内，`pendingOutputLength` 可能短暂上升但输入样本延迟下降。

如果 Host 持久化合并、`workspaceState` 非热路径化和 backlog scheduling 生效，新的现场诊断中 `diagnosticsSchema.executionPerformance` 应为 5；`state/persistDeferred` 与 `state/workspaceStateSkipped` 可以出现，但运行期间 `persist-workspace-state` 不应再跟随每次 live output state sync 增长。最关键的可观察指标是 `host-input-received.queueDelayMs`：第三轮诊断已恶化到平均 945ms、p95 4019ms，本轮应显著下降；如果仍然很高，则说明还有另一个 Extension Host 长任务源需要继续拆分。

如果 input ack 与 Host event-loop lag 插桩生效，新的现场诊断中 `diagnosticsSchema.executionPerformance` 应为 6，并出现 `webview-input-ack` 样本。若 `webview-input-ack.durationMs` 约等于 `host-input-received.queueDelayMs`，而 `host-event-loop-lag` 没有对应 120ms 以上样本，则剩余 300ms 更像 Webview bridge / 远端宿主调度或跨进程时钟问题；若两者同时出现，则继续追 Extension Host 长任务。无论哪种情况，终端都不应出现 Host 写入前的本地 echo。

如果 bounded snapshot reset 与 snapshot hydrate 调度生效，新的现场诊断中 `diagnosticsSchema.executionPerformance` 应为 9。一次 reset 应能看到 `snapshot-reset-requested`，随后看到 `snapshot-reset-applied`；如果 Host 或 bridge 卡住，最多先出现 `snapshot-reset-timeout` 并重试，而不是长期只有 `output-deferred-until-snapshot-reset`。等待 snapshot 期间 `pendingOutputLength` 不应再增长到 MB 级；超过 256KB 时应出现 `deferred-output-budget-reset` 并重新请求 snapshot。panel restore 期间普通 attach snapshot 不应再按节点数翻倍，`webview-snapshot-restore-queue` 应显示 snapshot hydrate 串行开始，最近输入节点优先。

## 幂等性与恢复

本计划不改变持久化格式，不需要迁移已有 canvas state。新增协议字段均为可选，旧 Webview 或旧 Host 缺少字段时仍按原路径处理。输出预算只影响 live Webview 消费节奏；snapshot reset 只有在 Host `outputSequence` 可用且 Webview 刚经历 lag/visibility restore 时才会丢弃 Webview 侧待渲染 raw backlog，并立即请求 Host snapshot 作为显示真源。controller dispose 时仍清空 pending output、snapshot reset 队列和 timeout，并删除注册表。若预算策略导致输出明显滞后，可以通过调整常量恢复到较大的 chunk / controller budget，而无需改数据结构。

## 证据与备注

当前诊断基线如下：

    executionFileLinkResolveSummary.requestCount = 0
    host-input-write p50 = 20ms
    host-input-write p90 = 99ms
    host-input-write p95 = 151ms
    host-input-write max = 209ms
    webview-terminal-write max duration = 38.4ms
    最大 webview-terminal-write chunk = 434258 characters
    state/persistWritten = 958 events

第二轮诊断基线如下：

    diagnosticsSchema.executionFileLinkResolve = 3
    diagnosticsSchema.executionPerformance = 2
    executionFileLinkResolveSummary.requestCount = 0
    executionPerformanceSummary.sampleCount = 500
    host-state-persist = 488 samples
    host-output-chunk = 2 samples
    host-input-received = 10 samples
    persist-workspace-state count = 416
    persist-workspace-state avg = 161.45ms
    persist-workspace-state p90 = 262ms
    persist-workspace-state p95 = 300ms
    persist-workspace-state max = 470ms
    host-input-received queueDelayMs = 110ms..266ms

这些数字说明 resolver 已不再是主因，但当前插桩不足以解释用户感受到的超过 200ms 卡顿。

本轮验证记录如下：

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run typecheck
    tsc --noEmit

    $ npm run build
    node scripts/build/build.mjs

    $ npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"
    4 passed

    $ git diff --check
    ... exit 0

第二轮当前验证记录如下：

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run typecheck
    tsc --noEmit

    $ npm run build
    node scripts/build/build.mjs

    $ npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"
    # sandbox 内首次失败：Chromium sandbox_host_linux shutdown Operation not permitted
    # sandbox 外重跑结果：
    4 passed
    Playwright webview tests passed.

    $ git diff --check
    ... exit 0

第三轮当前验证记录如下：

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run typecheck
    tsc --noEmit

    $ npm run build
    node scripts/build/build.mjs

    $ npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"
    4 passed
    Playwright webview tests passed.

    $ git diff --check
    ... exit 0

第四轮当前验证记录如下：

    $ npm run typecheck
    tsc --noEmit

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run test:serialized-terminal-state-tracker
    serializedTerminalStateTracker tests passed

    $ npm run test:execution-terminal-line-context-tracker
    executionTerminalLineContextTracker tests passed

    $ npm run build
    node scripts/build/build.mjs

    $ npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"
    4 passed
    Playwright webview tests passed.

    $ git diff --check
    ... exit 0

第五轮当前验证记录如下：

    $ npm run typecheck
    tsc --noEmit

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run test:serialized-terminal-state-tracker
    serializedTerminalStateTracker tests passed

    $ npm run test:execution-terminal-line-context-tracker
    executionTerminalLineContextTracker tests passed

    $ npm run build
    node scripts/build/build.mjs

    $ npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"
    4 passed
    Playwright webview tests passed.

    $ git diff --check
    ... exit 0

第六轮当前验证记录如下：

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run typecheck
    tsc --noEmit

    $ npm run build
    node scripts/build/build.mjs

    $ npm run test:webview -- --grep "requests snapshot reset instead of replaying a huge restored backlog"
    2 passed
    Playwright webview tests passed.

    $ npm run test:webview -- --grep "terminal handles vi-style alternate screen|keeps unresolved file link fallback stable while live output continues"
    4 passed
    Playwright webview tests passed.

    $ git diff --check
    ... exit 0

第七轮当前验证记录如下：

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run typecheck
    tsc --noEmit

    $ npm run test:webview -- --grep "keeps snapshot reset deferred output bounded"
    2 passed
    Playwright webview tests passed.

    $ npm run test:webview -- --grep "snapshot reset"
    4 passed
    Playwright webview tests passed.

第八轮当前验证记录如下：

    $ npm run test:execution-terminal-links
    executionTerminalLinks tests passed

    $ npm run test:execution-terminal-native-helpers
    executionTerminalNativeHelpers tests passed

    $ npm run typecheck
    tsc --noEmit

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run test:webview -- --grep "snapshot reset|resolves fallback file links only on activation|falls back to search when lazy file link activation times out|keeps extensionless fallback paths activation-only"
    16 passed
    Playwright webview tests passed.

    $ git diff --check
    ... exit 0

第九轮当前验证记录如下：

    $ npm run typecheck
    tsc --noEmit

    $ npm run test:protocol-webview-messages
    protocol webview message tests passed

    $ npm run test:execution-terminal-links
    executionTerminalLinks tests passed

    $ npm run test:execution-terminal-native-helpers
    executionTerminalNativeHelpers tests passed

    $ npm run test:webview -- --grep "requests only one attach snapshot|staggers snapshot hydrates"
    4 passed
    Playwright webview tests passed.

    $ npm run test:webview -- --grep "snapshot reset|unsequenced live snapshot|session exits"
    10 passed
    Playwright webview tests passed.

    $ git diff --check
    ... exit 0

## 接口与依赖

`src/common/protocol.ts` 必须继续作为唯一消息 validator；新增字段只能是可选字段。`src/webview/main.tsx` 中 `CanvasData` / `CanvasDataProvider` 的 `onExecutionInput` 签名需要扩展为接收诊断 metadata，但调用方可以不传。`src/panel/CanvasPanelManager.ts` 的 `writeExecutionInput` 可以增加第四个可选参数，例如 `{ sequence, webviewEpochMs, webviewPerformanceNowMs, hostReceivedEpochMs }`。所有诊断字段都必须是数字、布尔、短字符串或现有枚举，不能写入完整终端输入内容。

`src/common/protocol.ts` 中 `EXECUTION_PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION` 当前为 9，表示诊断已经包含 active execution session 期间跳过 `workspaceState.update`、Webview/Host backlog scheduling、input ack 往返测量、Host event-loop lag generation、Webview backlog snapshot reset，以及 reset request/applied/timeout、deferred-output budget 与 Webview snapshot restore queue 诊断。`host/executionOutput.payload.persisted` 是可选布尔值：旧消息缺省按已持久化处理；`false` 表示 Webview 必须缓冲输出，直到同一节点收到后续 `persisted: true` 输出释放。`host/executionOutput.payload.outputSequence` 与 `host/executionSnapshot.payload.outputSequence` 是可选单调序号，用来让 Webview 在 snapshot reset 期间丢弃 reset 边界前的旧 output，并把 reset 后的新 output 暂存在 snapshot 之后重放；旧消息缺少序号时不触发 backlog snapshot reset。`webview/attachExecutionSession.payload.requestId`、`host/executionSnapshot.payload.requestId` 和 `host/executionSnapshot|host/executionOutput.payload.executionSessionId` 都是可选字段，只用于 reset 关联、会话切换判断和诊断，不改变旧消息兼容性。`host/executionInputAck` 只携带 sequence、时间戳和 queue delay，用于诊断消息桥往返，不表示输入已经写入 PTY，也不能触发本地 echo。`src/panel/CanvasPanelManager.ts` 中 `CanvasStatePersistMode` 只能是 `immediate` 或 `deferred`，`CanvasWorkspaceStatePersistMode` 只能是 `full` 或 `skip`；live execution state 默认使用 `deferred + skip`，普通 `persistState()` 在有活跃执行会话时也默认 `skip`，但主快照文件仍同步写出。

最后更新说明：2026-06-11 创建本计划，原因是最新诊断已排除 file-link resolver 热路径，但用户仍感受到明显输入卡顿，需要用端到端插桩和交互优先输出预算继续收敛。

最后更新说明：2026-06-11 完成第一轮实现，把输入链路拆成可关联 sequence，并给 Webview 输出 drain 加预算和输入后优先级；原因是用户明确反馈卡顿“不只是 200ms”，原有 Host input write 指标不足以解释真实体感。

最后更新说明：2026-06-11 根据 08:05 宿主诊断补充第二轮实现，把高频 live execution state 落盘改为延迟合并，并增加 output 持久化栅栏；原因是最新证据显示 Extension Host 被 `workspaceState.update` 风暴占满，输入消息在到达 Host 前已排队 110ms 到 266ms。

最后更新说明：2026-06-11 根据 12:35 宿主诊断补充第三轮实现，把活跃执行会话期间的 `workspaceState.update` 从热路径移除，并用 schema 4 增加 `workspaceStateMode` 归因；原因是 deferred coalescing 已降低写次数，但剩余 `workspaceState.update` 单次耗时达到 p95 2.6s / max 16.5s，仍直接阻塞输入。

最后更新说明：2026-06-11 根据 14:43 宿主诊断补充第四轮实现，把输出 backlog drain、Webview hidden/lag recovery、Host headless xterm 批处理和常规 live stateUpdated 静默化纳入同一代 schema 5；原因是 `workspaceState` 已经不再主导卡顿，但 Webview main-thread lag、恢复后输出突刺和 Host 输入 queue delay 仍明显。

最后更新说明：2026-06-12 根据 02:58 宿主诊断补充第五轮诊断实现，把 input ack 往返和 Host event-loop lag 纳入 schema 6；原因是 backlog 与 `workspaceState` 已基本收敛，但仍存在稳定约 300ms 的 Host received queue delay，需要区分消息桥、Host 事件循环和时钟偏差。

最后更新说明：2026-06-13 根据 13:53 宿主诊断补充第六轮 backlog snapshot reset，实现 Host snapshot 替代 Webview raw replay；原因是 ack 诊断排除了 Host 写入主导卡顿，新的主因是 Webview 长时间 timer-lag 后恢复时积累 6MB 级待渲染 backlog。

最后更新说明：2026-06-14 根据 15:44 宿主诊断补充第七轮 bounded snapshot reset；原因是 schema 7 已避免 raw replay，但 snapshot 等待期仍会累积 5MB 级 deferred output，必须改为有 request id、timeout、预算和采样诊断的握手。

最后更新说明：2026-06-14 根据最新代码审视结论补充第八轮边界修复；原因是 snapshot reset 的大 backlog 方向已经正确，但 session exit / unsequenced snapshot 的正确性边界、file-link activation timeout fallback、interactive/background 候选分层和行为测试覆盖仍需要闭合。

最后更新说明：2026-06-14 根据 `2026-06-14T05-43-23-414Z` 现场诊断补充第九轮 attach 去重与 snapshot hydrate 调度；原因是稳态 file-link/backlog 已退出热路径，剩余卡顿集中在 panel 恢复时重复普通 attach snapshot 和多终端 snapshot hydrate 同时竞争输入。

最后更新说明：2026-06-14 完成第九轮验证记录，并明确 snapshot hydrate 交互优先不是无限暂停；原因是用户要求遵循“不做 Host 写入前本地反馈”的限制完成 attach 去重和 hydrate 调度，仍需要通过自动化证据证明正确性边界没有回退。
