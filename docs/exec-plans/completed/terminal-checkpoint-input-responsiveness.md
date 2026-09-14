# 终端 checkpoint 拒绝时保持输入响应

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文件遵守 `docs/PLANS.md`：它应让不了解此前诊断的协作者能够从当前工作树完成、验证并安全重试本项工作。

> 2026-08-11 后续结论：OSC query修复、健康stream不周期full refresh和输入保序意图继续有效；response-gated per-node FIFO仍会让下一输入等待同socket上的完整RPC response，且当lifecycle event携带full snapshot时，PTY write之前仍可被大journal阻塞。后续实现改为per-node FIFO在固定socket dispatch后释放、每条response独立观察，并以response-before-compact-lifecycle和control/projection隔离收口；详见 `docs/exec-plans/completed/runtime-recovery-projection-isolation.md`。

## 目标与全局图景

本计划修复一个已经在 `guiagentfactory / Agent 1 Fork` 诊断中确认的 P0 路径：Codex 启动时只查询默认前景/背景色的 OSC 10/11 序列，被误认为颜色已经改变，因而 session 的 checkpoint 永久停留在 revision 0。健康的 live Host 每十秒向 Supervisor 请求一次投影刷新；当 checkpoint 为 0 时该请求会携带整个 journal suffix，与用户输入共用同一 socket，导致 `writeInput` 排队数秒。

完成后，纯颜色查询会推进 checkpoint；真正改变或重置颜色、或其他无法无损序列化的状态仍拒绝 checkpoint。checkpoint 长期拒绝时，健康的已经订阅 live stream 的 Host 不再周期性请求完整 journal，用户输入按节点严格保序并限制为一个在途 RPC。诊断会明确显示拒绝原因、连续次数、checkpoint 年龄、snapshot 规模和待完成输入数，而不记录终端内容或用户输入。

## 进度

- [x] (2026-08-04 08:00 +0800) 用真实 Codex OSC 10/11 启动握手写入 tracker，复现 `color-state` sticky 拒绝；用 Supervisor 黑盒 fixture 复现 checkpoint 0 与完整 suffix 回放。
- [x] (2026-08-04 08:10 +0800) 登记本 ExecPlan，并把已确认的边界写入正式设计文档。
- [x] (2026-08-04 21:05 +0800) 实现 query 与颜色副作用的区分，保留 SET / RESTORE 与未知 payload 的 fail-closed 资格门禁。
- [x] (2026-08-04 21:12 +0800) 增加有界 checkpoint refresh RPC、拒绝遥测和 Host refresh 诊断；健康 live stream 不再周期性请求完整 projection payload。
- [x] (2026-08-04 21:18 +0800) 为每个执行节点接入严格串行输入队列，并补齐单 in-flight、顺序和失败后继续的压力回归。
- [x] (2026-08-04 21:29 +0800) 通过定向测试、typecheck、build 与差异审查，并同步本计划和正式设计结论。

## 意外与发现

- 观察：xterm 6 的内部 `onColor` payload 明确区分 `REPORT`、`SET`、`RESTORE`，但现有 callback 丢弃 payload，造成查询和副作用等价。
  证据：`node_modules/@xterm/xterm/src/common/InputHandler.ts` 的 OSC 10/11 处理会为 `;?` 发出 `REPORT`。
- 观察：目标诊断对应的是健康的 systemd-user live session，并非 Supervisor 重启或 Webview lifecycle 失败；目标 session 反复从 checkpoint 0 重放约 81k 个 terminal events。
  证据：用户提供的 host diagnostics 中 `host-input-write` 平均约 12.13 秒、最大 23.763 秒，而输出 scheduler 队列为 0、单次执行约 0--1 毫秒。
- 观察：把历史 fixture 中更宽的 Codex 启动控制序列和 OSC 10/11 一起写入后，颜色误判消失，但 xterm serialize/hydrate 校验仍以 `parser-not-ground` 拒绝。
  证据：纯 OSC 10/11 fixture 在 `flushValidatedCheckpoint()` 中 eligible；复合 fixture 的 source parser 已归零而 hydrate target 被拒绝。因此它是独立的 fail-closed 状态，不可用“允许全部颜色事件”掩盖。

## 决策记录

- 决策：仅把 xterm 明确报告为 `REPORT` 的颜色事件当作无状态查询；`SET`、`RESTORE` 和未知 payload 都继续触发 sticky `color-state` 拒绝。
  理由：只有纯查询不会改变 renderer 使用的颜色；未知 private API 语义必须 fail closed。
  日期/作者：2026-08-04 / Codex
- 决策：健康、连续订阅 terminal stream 的 Host 不做周期性 `getSessionSnapshot()`；该 RPC 只保留给新投影 attach、live stream 不健康后的明确恢复与最终生命周期边界。
  理由：已连续拥有全部 live tail 的 Host 不需要用 journal payload 更新缓存；checkpoint 被拒绝时请求会与输入竞争且大小无界。无损 journal 与 stream 均保留，缺口恢复仍走权威 attach。
  日期/作者：2026-08-04 / Codex
- 决策：输入先采用 per-node FIFO、一个在途 write 的队列，不合并、不丢弃字节；所有输入仍按原顺序写入 PTY。
  理由：这是最小且可证明的背压边界，能阻止键盘 repeat 建立数百个并发 RPC，同时不改变 Enter、Ctrl-C 或方向键语义。
  日期/作者：2026-08-04 / Codex

## 结果与复盘

已完成四项交付：颜色 `REPORT` 不再污染资格；Supervisor 以 bounded checkpoint RPC 发布拒绝诊断并避免健康 stream 的完整 suffix 周期复制；每个节点通过 `ExecutionInputQueue` 串行写入；三个新/更新的自动化路径覆盖 query、拒绝、payload 边界和快速输入。

已通过：

    npm run test:serialized-terminal-state-tracker
    npm run test:runtime-supervisor-protocol
    npm run test:execution-input-queue
    npm run test:protocol-webview-messages
    npm run test:execution-output-sequence
    npm run test:execution-output-scheduler
    npm run typecheck
    npm run build
    git diff --check

残余边界是显式新投影 attach 或已检测到 live gap 时仍必须获取完整无损恢复内容；本计划只移除了健康 live stream 的周期性复制，未截断恢复数据。复合 Codex 控制序列若仍触发 `parser-not-ground` 会保持 journal-backed；新诊断会区分它与 `color-state`，且它不再造成本次发现的周期性输入阻塞。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts` 包装 headless xterm 与 serialize addon。`SerializedTerminalStateTracker.flushValidatedCheckpoint()` 在生成 checkpoint 前检查 parser、decoder、OSC 8 和颜色等不能由序列化状态证明的边界。当前 tracker 用 runtime-private `onColor` 事件把任何颜色事件标为 `colorStateTouched`，因此 Codex 的 `ESC ]10;? ESC \\`、`ESC ]11;? ESC \\` 也永久拒绝。

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 是持有 PTY、journal 与 checkpoint 的唯一 authority。`createFreshSnapshot()` 只在 tracker 资格合格时前进 `terminalCheckpoint`；`buildTerminalStreamAttachPayload()` 返回 checkpoint 后全部连续 journal event。checkpoint 为 0 时 payload 不会丢内容，但尺寸会随 session 输出无限增长。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 维护 Host 投影。它已在 `sessionTerminalEvent` live stream 中保持连续 tail，但 `scheduleExecutionTerminalProjectionRefresh()` 仍每十秒请求投影 snapshot；这条稳态刷新必须只在实际缺口或新投影 attach 时使用。它还会对每条 `webview/executionInput` 直接启动 `writeExecutionInput()`；必须改为节点内 FIFO。

`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 为所有请求使用同一 socket。它会同步 drain 每条 socket message，因此避免周期传输全 journal 是输入隔离的重要组成部分，而不是仅修改一个 UI timer。

## 工作计划

第一步修改 tracker 的颜色订阅适配层。监听器接收 unknown payload，谨慎读取其中颜色请求数组；仅数组中的每个 request 都被识别为 `REPORT` 时忽略。任何 `SET`、`RESTORE`、混合、空或不认识的数据都调用现有 sticky 标记。这样不会扩大 xterm 私有 API 的可信范围。

第二步为 Supervisor session 增加只含计数和时间的 checkpoint 诊断状态。每次确实验证 checkpoint 都更新最近拒绝原因、连续拒绝数、首次连续拒绝时刻；合格时清空 streak。snapshot protocol 仅传递这些安全元数据和由 `TerminalStreamAttachPayload` 计算的 event 数/UTF-8 字节数。Host 在 `runtime/terminalProjection*` 事件中记录这些字段、刷新耗时和 client 待完成控制 RPC 数。

第三步删除健康 live stream 的周期性 projection refresh。没有 checkpoint 仍保留 journal 并继续增量订阅，新的 attach 或 stream health 失效后才走完整权威恢复；绝不以裁剪 event、伪造 checkpoint 或替换 output 达到有界。

第四步在 `CanvasPanelManager` 的 session base state 中加入 `ExecutionInputQueue`。每个 incoming input 保持原有验证和生命周期行为，但按该 session 的 FIFO 入队；每个 entry 最终调用抽出的实际 write 方法并记录排队时间、in-flight/queued 数量。session 清理时只让已经接受的 input 自然完成或由现有 disconnect 错误拒绝，不重排数据。

第五步更新两个现有特征化测试，并增加压力断言：纯 query 合格且 Supervisor checkpoint 前进；SET/RESTORE 仍拒绝；颜色状态拒绝时正常 live subscription 的输入不被周期 snapshot 阻塞；重复输入保持精确顺序且任一节点最多一个 RPC 在途。测试无需真实 Codex。

## 具体步骤

在仓库根目录执行以下命令：

    npm run test:serialized-terminal-state-tracker
    npm run test:runtime-supervisor-protocol
    npm run typecheck
    git diff --check

前两项应证明 query/SET 的资格边界和 Supervisor 黑盒协议；typecheck 确保跨协议的 optional diagnostics 一致；最后一项确认文档与源文件没有空白错误。若 runtime protocol fixture 留下临时目录，应让 its `finally` 清理逻辑完成后重跑，不应手动删除工作树文件。

## 验证与验收

纯 `OSC 10;?`/`OSC 11;?` 后，`flushValidatedCheckpoint()` 必须返回 eligible，并且 blackbox snapshot 的 checkpoint revision 前进、suffix 小于完整 revision。`OSC 10;#...` 与 `OSC 110` 后必须仍返回 `color-state`，且 snapshot 不能声明 fresh serialized terminal state。

对被拒绝的 session，连续 live terminal events 仍应使 Host projection 连续，周期刷新必须记录 skip 而非请求全 journal。测试将反复写入输入，断言写入记录与提交序列完全相同、最大 in-flight 为 1；这证明优化没有丢失或重排控制字节。

## 幂等性与恢复

所有改动都是可重复的源代码、文档和测试更新。不要删除 terminal journal 来解决测试失败；journal 增长是 fail-closed 的正确退化。如果 xterm private event shape 不符合预期，保守地将该事件视为副作用并保持拒绝，而不是放宽资格。

## 证据与备注

初始缺陷特征化在修复前通过以下行为锁定：

    Codex startup handshake -> { eligible: false, reason: 'color-state' }
    Supervisor snapshot -> checkpoint.revision === 0
    attach payload -> events.length === revision

修复后纯 query 断言改为 eligible，blackbox snapshot 的 checkpoint 大于 0 且 suffix 缩短；真实颜色 SET/RESTORE 保持原拒绝断言。复合启动控制序列产生的独立 `parser-not-ground` 仍明确拒绝。

## 接口与依赖

不引入新 package。新增 protocol 字段必须全部 optional，以允许旧 Supervisor/Host 互通：

    RuntimeSupervisorSessionSnapshot.terminalCheckpointDiagnostics?: {
      lastRejectionReason?: SerializedTerminalCheckpointRejectionReason;
      consecutiveRejectionCount: number;
      rejectionStartedAtMs?: number;
      checkpointCreatedAtMs?: number;
      snapshotEventCount?: number;
      snapshotEventBytes?: number;
    }

`SerializedTerminalStateTracker` 继续是唯一 eligibility 判断者；`RuntimeSupervisorMain` 只记录其结论，`CanvasPanelManager` 只诊断并调度，均不得据此补造 revision 或丢弃 journal event。

---

2026-08-04：创建计划，记录已复现的 Codex OSC 10/11 false-positive 与 checkpoint 0 输入阻塞链路，并确定四项实现边界。

2026-08-04：完成四色事件语义、bounded refresh、输入 FIFO 与诊断实现；补入复合 Codex 控制序列仍会触发独立 `parser-not-ground` 的验证证据，避免将其误写为颜色查询问题。
