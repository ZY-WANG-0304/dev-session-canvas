# 为执行节点接入 PTY Terminal Title

本 `ExecPlan` 是活文档，必须按仓库根目录 `docs/PLANS.md` 的要求持续维护。本文记录从 `origin/main` 基线开始，为 `Agent` 和 `Terminal` 实现 terminal title 读取、展示、跨 Host/Supervisor/Webview 传递、TUI 查询和输出脱敏的全过程。

## 目标与全局图景

完成后，嵌入式执行节点能够读取 PTY 输出中的 OSC 0 / OSC 2 terminal title，并在 `Agent` 与 `Terminal` 节点标题栏的上下文行中显示。标题不覆盖用户可编辑的节点标题，也不替换 Agent 启动命令或 Terminal shell 路径副标题；没有标题、标题被清空或会话结束时，上下文行回退到 cwd/root。

运行在 PTY 中的 TUI 发送 `CSI 21 t` 时，拥有该 PTY 的 Host 或 Runtime Supervisor 会直接回复当前标题的 `OSC l <title> ST`，无标题时回复空的 `OSC l ST`。OSC 标题控制序列及其 payload 不进入 xterm 输出缓存、recent output、terminal stream 或 journal；普通输出仍保持原有顺序和 revision 连续性。

用户可通过现有 Webview 标题栏和终端输入观察主要结果；自动化验证会证明分片控制序列、快照恢复、旧会话隔离、查询回包以及 journal 脱敏均成立。

## 进度

- [x] (2026-09-14 16:40 +0800) 已从最新 `origin/main`（`bf18fb0034111becda4be2df4d6dbfbdd0d8072a`）创建主题分支 `execution-terminal-title-support`。
- [x] (2026-09-14 16:50 +0800) 已阅读工作流、架构、产品、设计、UI、前端和 ExecPlan 约束，并确认当前基线尚未包含 PR287 的 terminal title 实现。
- [x] (2026-09-14 17:20 +0800) 完成基线勘察：Local PTY 在 `CanvasPanelManager.ts` 的 `handleSessionChunk` / `handleTerminalChunk` 进入 buffer、`SerializedTerminalStateTracker`、recent output 与 output scheduler；Supervisor 在 `runtimeSupervisorMain.ts` 的 `bindSessionProcess` 进入 journal、tracker、stream event 与 snapshot；Webview 由 `main.tsx` 路由快照/输出并在 `executionSessionNodes.tsx` 使用 `ChromeTitleEditor`。
- [x] (2026-09-15 09:30 +0800) 新增共享 title parser、规范化、查询事件和输出脱敏逻辑；补齐超长未闭合 payload 在包含控制字符或分片 ST 时继续丢弃的 fail-closed 路径。
- [x] (2026-09-15 09:40 +0800) 接通 Local Host 的 PTY 处理、状态缓存、查询回包和安全输出调度。
- [x] (2026-09-15 09:50 +0800) 接通 Runtime Supervisor 的 PTY 处理、快照/事件协议、查询回包和 journal 安全边界。
- [x] (2026-09-15 10:00 +0800) 接通 Webview 状态投影和 Agent/Terminal 标题栏上下文行，并隔离已被新会话取代的迟到 snapshot、output 与 exit。
- [x] (2026-09-15 10:20 +0800) 补齐 parser、Host/Supervisor 协议、真实 node-pty Supervisor 和 Webview 回归测试。
- [x] (2026-09-15 10:40 +0800) 运行类型检查、相关测试、构建和 `git diff --check`，同步正式设计文档、索引和本计划。
- [x] (2026-09-15 14:40 +0800) 复核最终代码与文档引用；定向测试、构建、Webview 回归和 `git diff --check` 再次通过。完整 `npm test` 在既有 Marketplace VS Code fixture 阶段因 worktree 绝对路径过长导致 Unix socket 超过 107 字符而停止，未进入本功能的后续测试。
- [x] (2026-09-15 15:00 +0800) 根据 PR review 更新 `test-execution-output-sequence` 的 Supervisor source-level assertion，补充 terminal title/query 脱敏边界断言，并通过 `npm run test:execution-output-sequence`。
- [x] (2026-09-15 15:10 +0800) 按仓库提交规范提交仅包含本任务的变更。

## 意外与发现

实现过程中发现的异常已收口；真实 Extension Development Host 的手工验证仍未执行，因此正式设计文档继续保持“验证中”。

- 观察：当前输出 journal 明确拒绝空字符串，因此 title-only PTY chunk 不能简单过滤成空输出。
  证据：`TerminalSessionJournal.appendOutput()` 对空 `data` 抛出 `Terminal journal output records must not be empty.`；实现需用不可见 `NUL` marker 保持 revision 连续。
- 观察：当前 Webview 已有可省略的顶部 context row，Agent 已传 cwd label，Terminal 尚未传 context label。
  证据：`ChromeTitleEditor` 接受 `contextLabel/contextTooltip`，Agent 节点已使用；Terminal 节点当前只传 shell path subtitle。
- 观察：超长未闭合 title payload 中如果出现换行或其他 ESC 控制字符，不能按普通“非法 payload”回退，否则后续敏感文本可能重新进入输出。
  证据：新增 parser 回归覆盖 `600` 个字符后接 `\n`、CSI 片段和分片 `ESC \` 终止符；脱敏结果只保留终止符后的 `visible`。
- 观察：Webview controller 仅按当前 session id 判断还不够；新会话建立后，旧会话的普通 output 仍可能走到 xterm 写入路径。
  证据：controller 现在维护 `supersededExecutionSessionIds`，并在 `applySnapshot`/`enqueueOutput` 入口拒绝已取代 session；Playwright 回归确认 `STALE-AGENT-OUTPUT-MUST-NOT-WRITE` 不可见。
- 观察：Terminal 初始 context row 在没有动态 title 时已经由现有 cwd 逻辑提供；新增回归只在动态 title 出现时断言前缀，避免把初始静态渲染误当成 title 功能。
  证据：`tests/playwright/webview-harness.spec.mjs` 同时验证动态 title、静态 subtitle、用户节点标题和清空回退。

## 决策记录

- 决策：从 `origin/main` 新建短生命周期分支 `execution-terminal-title-support`，不直接把历史 PR287 合并提交当作本次实现输入。
  理由：用户明确要求基于当前代码现状实现；历史 PR287 依赖的前置提交链不属于当前 `origin/main`，直接合并会引入超出本任务范围的 Agent 生命周期和运行时变更。
  日期/作者：2026-09-14 / Codex
- 决策：在共享纯逻辑模块中实现唯一的 OSC 0/2 parser，并让 Host 与 Supervisor 在各自拥有 raw PTY chunk 的边界调用它。
  理由：Host 和 Supervisor 都可能是实际 PTY owner，重复实现会导致分片、规范化和查询顺序不一致；共享模块又不能依赖 `vscode`、React 或 `node-pty`。
  日期/作者：2026-09-14 / Codex
- 决策：动态 title 作为 live session 的临时投影字段传递，不覆盖用户节点标题，不写入 terminal journal；已识别的标题 payload 在持久化/回放前替换为不可见占位符以保持输出 revision 连续。
  理由：title 是进程主动设置的运行态 chrome 信息，可能高频变化并包含路径或用户数据；它需要支持 Webview 重建，但不应污染历史终端输出或触发持久化风暴。
  日期/作者：2026-09-14 / Codex
- 决策：只支持精确的 `CSI 21 t` window-title 查询，并以 7-bit `OSC l <title> ESC \` 回包；不实现 icon label 查询或其他窗口操作。
  理由：本任务只要求当前 title 查询；窄协议面更容易验证，也避免把 cwd、节点名或历史信息暴露给 PTY 内程序。
  日期/作者：2026-09-14 / Codex
- 决策：`terminalTitle` 在 Host/Supervisor/Webview 消息中使用“字段缺失=未知、字符串=当前值、null=明确清空”的三态；普通 output 不携带该字段。
  理由：旧 Supervisor 或不完整快照不能把同一 live session 已知标题误清空；普通 output 也不能因为合批而反复清除标题。
  日期/作者：2026-09-14 / Codex
- 决策：在 PTY owner 处同时消费 OSC 0/2 和 `CSI 21 t`，并在进入 journal、terminal tracker、buffer、recent output 与 Webview scheduler 前移除两类控制序列。
  理由：OSC title payload 和查询请求都属于终端控制面，不是屏幕文本；所有 durable output 边界共用同一安全输出，避免 Local Host 与 Supervisor 行为分叉。
  日期/作者：2026-09-14 / Codex
- 决策：超长未闭合 title payload 进入 discard 模式后，只寻找 BEL、C1 ST 或 `ESC \` 终止符，不再把中间的 C0/C1/ESC 控制字符当作“非法序列”提前回退。
  理由：回退会把尚未确定属于 title payload 的敏感文本重新送入 output/journal；在安全边界上，宁可丢弃到明确终止符，也不能泄露 title 内容。
  日期/作者：2026-09-15 / Codex
- 决策：Webview controller 在新 execution session generation 建立时记录旧 session id，并拒绝这些 id 的后续 snapshot/output。
  理由：仅依赖 `currentExecutionSessionId` 会让迟到旧 output 重新触发 generation 切换；显式 superseded 集合可以保持 terminal 内容和动态 title 都不回退。
  日期/作者：2026-09-15 / Codex

## 结果与复盘

本轮已完成五项用户要求。共享实现位于 `common/executionTerminalTitle.ts`；Local Host 在
`CanvasPanelManager.ts` 的本地 PTY handler 解析 title、响应 `CSI 21 t`，并在 buffer、tracker、
recent output、scheduler 前脱敏；Runtime Supervisor 在 `runtimeSupervisorMain.ts` 的 PTY 串行
操作中完成同样的解析、`OSC l` 回包、snapshot/event 三态传递和 journal 边界保护；协议字段位于
`common/protocol.ts` 与 `common/runtimeSupervisorProtocol.ts`；Webview 在 `main.tsx` 做 session
隔离投影，`executionSessionNodes.tsx` 展示 Agent/Terminal 的动态 context row。title 不覆盖用户
节点标题、Agent command subtitle 或 Terminal shell subtitle。

自动化验证已通过：

- `npm run typecheck`
- `npm run test:execution-terminal-title`
- `npm run test:runtime-supervisor-protocol`
- `npm run test:protocol-webview-messages`
- `npm run build`
- `node scripts/test/run-playwright-webview.mjs --grep "PTY terminal titles"`
- `git diff --check`

共享 parser 测试覆盖 OSC 0/2、7-bit/C1 terminator、任意 chunk 分片、规范化、清空、查询顺序、
查询回包、marker 和超长 payload fail-closed；Runtime Supervisor fixture 使用真实 `node-pty`
验证 title query、清空、output tail、terminal stream suffix 和 journal 脱敏；Playwright 验证
两类节点、静态 subtitle、用户标题、缺字段兼容、显式清空以及旧 session 普通 output 隔离。

完整 `npm test` 已实际启动并通过 Marketplace shared/API/Web 测试，但在
`test:marketplace-vscode-fixture-e2e` 的 VS Code smoke 阶段失败：测试生成的 Unix socket 路径位于
当前 worktree 下并超过 Linux 107 字符上限，VS Code 报 `listen EINVAL`。该失败发生在与本任务无关的
fixture 启动前，不是代码断言失败；本任务所需的 `typecheck`、title parser、Supervisor protocol、
协议、build、Playwright 定向用例和 `git diff --check` 均已通过。

仍未覆盖的路径是真实 Extension Development Host 中的手工 OSC 设置/清空、真实 provider spinner、
Webview reload 和跨 VS Code 生命周期 live-runtime reattach；这些不应在本轮写成已验证结论。
当前没有新增必须阻塞交付的技术债；上述宿主级手工覆盖继续由设计文档的“验证中”状态明确记录。

## 上下文与定向

当前仓库是 VS Code 扩展。`CanvasPanelManager` 是 Extension Host 的状态和执行编排中心；它在本地 `node-pty` 路径接收 raw output，也可以经 `runtimeSupervisorClient` 接收 Supervisor 事件。`runtimeSupervisorMain.ts` 是 `live-runtime` 模式下独立进程的 PTY owner，并负责 terminal revision、stream 和 journal。`common/protocol.ts` 与 `common/runtimeSupervisorProtocol.ts` 定义跨边界数据结构。`webview/main.tsx` 接收 Host 消息并维护嵌入式 xterm controller，`webview/executionSessionNodes.tsx` 渲染 Agent/Terminal 标题栏。

本任务中的“terminal title”是 PTY 应用通过 ANSI Operating System Command 设置的 window title，不是画布节点的用户标题。OSC 0 表示 icon name + window title，OSC 2 表示 window title；本实现只使用 payload 作为当前动态 title。`CSI 21 t` 是 TUI 查询 window title 的控制序列，`OSC l ... ST` 是返回 title 的报告格式。PTY chunk 可以在任意字符边界分割，因此 parser 必须保存有界 carryover。

基线已确认没有 `executionTerminalTitle.ts`、`terminalTitle` 协议字段或 PR287 的 Webview 投影代码。历史提交 `ecc1b7d3` 仅作为行为参考，不作为自动合并输入；当前实现必须尊重 `origin/main` 现有的 terminal stream/checkpoint/revision 语义。

## 工作计划

先在 `extensions/vscode/dev-session-canvas/src/common/` 建立无宿主依赖的解析与脱敏层，明确输入 chunk、carryover、title 事件、查询事件和安全输出的关系。parser 需要识别 7-bit 与 C1 OSC 0/2，接受 BEL、ST 和 C1 ST，处理 split introducer/payload，并限制未完成 payload 的内存占用；title 规范化需要移除控制字符、折叠空白、trim 和长度限制。

然后检查 `CanvasPanelManager.ts` 的本地 session output handler、scheduled output queue、snapshot 和 metadata 组装位置。在 raw chunk 进入 terminal state tracker、recent output 或 Webview message 之前执行 title processing；查询事件直接写回同一 local PTY，不经过用户输入队列。title 变化只更新内存和已有 output message/snapshot 投影，不为 spinner 高频更新额外调用完整状态持久化。

接着检查 `runtimeSupervisorMain.ts` 的 `SupervisorSession`、PTY `onData`、journal append、terminal stream event 和 snapshot 组装位置。Supervisor 必须在 journal append 前得到脱敏 output，并在同一个串行输出边界中更新 title、响应 query、记录安全 output、广播事件。live snapshot 可以携带当前 title；终态 snapshot 和恢复的 dead-PTY history 不得继续暴露旧的 live title。

随后扩展共享协议和 Webview：Host/Supervisor 的 snapshot、output/event payload 增加可选 title；Webview 按 `nodeId + executionSessionId` 保存动态 title，旧 session 的迟到 output 不能覆盖新 session；`CanvasNodeData` 只增加只读字段。Agent/Terminal 的静态副标题保持原语义，上方 context 行按 `{terminal title} · {root}` 或 `{root}` 渲染。

最后先补纯 parser 测试，再补 Supervisor 真实 `node-pty` fixture，验证 query response、分片 title、正常 output、recent output、stream suffix 和 journal 文件；补 Webview harness 验证两类节点、清空、旧 session 隔离、缺字段兼容和用户标题不变。测试通过后更新设计文档及索引，记录验证状态和真实 Extension Development Host 尚未覆盖的部分。

## 具体步骤

所有命令均在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas7` 执行。

1. 完成基线勘察。使用 `rg` 定位 local/supervisor output 到 tracker、scheduler、journal、snapshot 和 Webview 的完整路径；用 `git diff` 对照历史 PR287 只提取本任务需要的行为，不复制其前置生命周期变更。
2. 创建或修改 `docs/design-docs/execution-terminal-title-display.md`，记录问题定义、非目标、正式方案、隐私/持久化边界、三态 title 传递和验证方法，并在 `docs/design-docs/index.md` 登记。
3. 新增共享 parser 和输出脱敏单元测试。测试命令优先使用现有扩展测试脚本的运行方式；如果需要通过 tsx loader 加载 TypeScript，沿用仓库已有脚本，不新增长期依赖。
4. 修改 Host、Supervisor、协议和 Webview，保持旧字段可选，以便旧 Supervisor/旧 snapshot 正常降级。
5. 运行分层验证：
   - `npm run typecheck`
   - `npm run test:execution-terminal-title`
   - `npm run test:runtime-supervisor-protocol`
   - `npm run test:protocol-webview-messages`
   - `npm run build`
   - `node scripts/test/run-playwright-webview.mjs --grep "PTY terminal titles"`
   - `git diff --check`
6. 若完整命令受当前环境缺少 VS Code/浏览器或 node-pty fixture 依赖影响，保留失败的确切命令和原因，改用可运行的分层测试，并在设计文档和最终答复中明确未覆盖范围。
7. 按 `docs/workflows/COMMIT.md` 检查工作区，只提交本任务相关代码、测试和正式文档；提交前把本计划从 `active/` 移到 `completed/`，并同步设计文档关联路径。

## 验证与验收

功能验收以可观察行为为准：

- 发送 `OSC 2` 或 `OSC 0` 后，Agent/Terminal 标题栏上方 context 行显示动态 title 与 root；发送空 payload 后回到 root；节点用户标题和 Agent 命令/Terminal shell 副标题不变。
- 将 OSC introducer、identifier、separator、payload、terminator 分成多个 PTY chunk 发送，session 不进入 error，最终 title 正确。
- local PTY 和 Supervisor PTY 在收到 `CSI 21 t` 后分别回写当前 title；设置后查询返回标题，清空后查询返回空 `OSC l ST`；同一 chunk 中设置/查询顺序决定返回旧值或新值。
- title raw bytes 不出现在 Webview 终端输出、recent output、terminal stream suffix、checkpoint/journal segment 或历史终态中；普通 marker output 仍出现且 revision 不断裂。
- snapshot/reattach 同一 live session 保留最新 title；新 session snapshot 后，旧 session output/title 消息被忽略；缺失的可选 title 字段不会误清空 Webview 已知 title；显式 `null` 会清空。
- Agent title parser 的任何活动辅助语义（若当前基线存在）不能被普通 Terminal title 取代或扩大生命周期范围。

自动化验证至少应包括共享 parser 的分片/规范化/query/redaction 测试、Runtime Supervisor 的真实 node-pty 集成 fixture、协议类型编译和 Webview Playwright harness。完成前要把实际通过命令、测试数量或关键断言写入“结果与复盘”和相关设计文档。

## 幂等性与恢复

新建分支和文档步骤可安全重复，但若目标文件已存在，应先读取并增量修改，不覆盖用户已有改动。parser 状态只属于单个 live PTY session；新建、停止、退出、删除或切换 runtime owner 时必须清空 carryover、redaction state 和当前 title。旧 snapshot 没有 title 字段时按兼容路径处理；不能把字段缺失当成明确清空。

如果某个测试失败，先保留失败输出并定位到对应边界；不要使用 `git reset --hard` 或 `git checkout --` 回退。只撤销本分支新加的改动时使用精确 patch。任何 journal/registry 测试临时目录必须由现有测试清理逻辑回收，避免手工删除用户文件。

## 证据与备注

当前基线证据：

    origin/main = bf18fb0034111becda4be2df4d6dbfbdd0d8072a
    branch = execution-terminal-title-support
    historical reference = ecc1b7d3 (PR287, not merged into origin/main)

实现过程中只保留短小证据，例如 parser 测试中标题从分片输入恢复、Supervisor query fixture 收到 `OSC l` 回包、journal 内容不包含测试标题，以及 Webview context 行断言。不要把完整构建日志或大段 diff 粘贴进本文。

2026-09-15 的收口证据：

    npm run test:execution-terminal-title
    execution terminal title tests passed
    npm run test:runtime-supervisor-protocol
    runtimeSupervisorProtocol tests passed
    npm run test:execution-output-sequence
    execution output sequence tests passed
    node scripts/test/run-playwright-webview.mjs --grep "PTY terminal titles"
    1 passed

## 接口与依赖

共享模块建议提供以下稳定纯函数，实际签名以实现为准但必须保持语义明确：

    parseExecutionTerminalTitles(chunk, previousCarryover)
      -> { carryover, titles, events }

    processExecutionTerminalTitleControls(
      chunk,
      previousTerminalTitle,
      previousCarryover,
      previousRedactionState
    )
      -> { carryover, terminalTitle, titleQueries, titleUpdated, terminalOutput, redactionState }

    formatExecutionTerminalTitleReport(terminalTitle)
      -> string

`common/protocol.ts` 应增加 `ExecutionSessionMetadata.terminalTitle`、`host/executionSnapshot.terminalTitle`、`host/executionOutput.terminalTitle` 和 Webview `CanvasNodeData.terminalTitle` 等可选字段。`common/runtimeSupervisorProtocol.ts` 应同步增加 Supervisor snapshot、`sessionOutput` 和 `sessionTerminalEvent` 的可选 title 字段。

实现不得引入新的运行时依赖；继续使用现有 `node-pty`、terminal stream/journal、React、Playwright 和仓库已有构建/测试脚本。共享 `common` 模块不能依赖 `vscode`、React、DOM 或 `node-pty`。
