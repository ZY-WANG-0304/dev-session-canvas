# 在执行节点显示 Terminal Title

本 `ExecPlan` 是活文档。它必须按照仓库根目录的 `docs/PLANS.md` 持续维护；本计划覆盖 Agent 和 Terminal 节点展示 PTY terminal title 的设计、实现和验证，不改变用户可编辑的画布节点标题语义。

## 目标与全局图景

完成后，`Agent` 和 `Terminal` 节点的标题栏最上方上下文行默认显示 cwd/root；PTY 中进程主动设置 terminal title 后，该行显示 `{terminal title} · {root}`。例如 shell 可以显示当前目录，Codex/Claude Code 可以显示自己的工作提示。启动命令或 shell 路径仍留在静态副标题，用户可编辑的节点标题不受影响；title 未设置、被清空或会话结束后，上下文行只显示 `{root}`。

用户可通过在嵌入式 Terminal 输入 `printf '\033]2;Build API\a'`，或让 Agent CLI 自行更新 title，直接看到标题栏上下文行变为 `Build API · {root}`；在 Webview 重建或 live-runtime 重新附着后，仍会看到当前 title。节点的可编辑名字和静态副标题不会被此功能改写。

## 进度

- [x] (2026-08-06 11:40 +0800) 阅读工作流、架构、UI 与现有 Agent terminal-title activity 设计，确认当前只用 OSC 0/2 作为 Agent 生命周期增强且丢弃原文。
- [x] (2026-08-06 11:40 +0800) 写入正式设计、产品规格与本执行计划，确定稳定节点名和动态 terminal title 分层。
- [x] (2026-08-06) 将 OSC 0/2 增量解析抽为 Agent 与普通 Terminal 共用的受限 parser，并补规范化测试。
- [x] (2026-08-06) 将当前 title 贯通 Local Host、Runtime Supervisor snapshot、Host/Webview output/snapshot 协议，并保证 title 高频变化不触发逐帧状态持久化。
- [x] (2026-08-06) 在 Agent/Terminal 节点标题栏以动态副标题显示 title，补 Webview 与 Supervisor 定向回归。
- [x] (2026-08-06) 运行 typecheck、定向自动化、构建和 diff 检查；把验证结果与剩余人工验证回写本文和设计文档。
- [x] (2026-08-06) 修复 live snapshot 对缺失 title 与确认清空未区分、可能覆盖 Codex Agent 已显示 title 的问题；补 Host/Supervisor/Webview 回归。
- [x] (2026-08-07) 按已确认的视觉语义，将 title 从动态副标题迁到节点标题栏最上方上下文行；保留静态副标题，默认只显示 `{root}`，并更新定向回归与文档。
- [ ] 在真实 Extension Development Host 中执行 Terminal OSC 2 设置/清空、Agent spinner、Webview reload 和 live-runtime reattach 手动 smoke。

## 意外与发现

- 观察：现有 `agentTerminalTitleActivity.ts` 已支持 OSC 0/2、BEL/ST/C1 终止、分片和 payload 上限，但其注释和正式设计明确禁止 raw title 进入 metadata、journal 或 Webview。
  证据：`docs/design-docs/agent-running-state-detection.md` 第 7.3 节，以及 `extensions/vscode/dev-session-canvas/src/common/agentTerminalTitleActivity.ts`。

- 观察：输出已经由 Host scheduler 合批投递至 Webview。title 附着在同一 `host/executionOutput` 消息的最新合批值，可以同步渲染而无需为 spinner 另起高频 `host/stateUpdated` 或落盘写。
  证据：`CanvasPanelManager.ts` 中 `queueExecutionOutput()`、`takePendingExecutionOutput()` 与 `postExecutionOutputMessage()`。

- 观察：输出协议已用 `null` 表示 title 清空，快照协议却把缺字段和清空都表现为 `undefined`；Webview 无法区分旧 Supervisor 不带字段与当前 PTY 明确清空，从而可能在 Agent lifecycle live snapshot 到达时丢掉已展示的 title。
  证据：`CanvasPanelManager.ts` 的 `postExecutionOutputMessage()` 与 `postExecutionSnapshot()`，以及 `webview/main.tsx` 的 `host/executionSnapshot` 分支。

## 决策记录

- 决策：把用户编辑的 `CanvasNodeSummary.title` 与进程提供的 `ExecutionSessionMetadata.terminalTitle` 分开，后者只读且仅代表当前执行会话。
  理由：CLI 会频繁改变 title，且 title 可能是路径、任务或 spinner；覆盖节点名会破坏用户在画布中赋予对象的稳定身份。
  日期/作者：2026-08-06 / Codex

- 决策：只解析 OSC 0 和 OSC 2，接受 BEL、ST (`ESC \\`) 与 C1 ST 终止，沿用已有跨 chunk 和有界 payload 规则；不把 OSC 1、OSC 7、OSC 9/777、OSC 133 或普通屏幕文本当作 title。
  理由：OSC 0/2 是当前 xterm/主流 terminal 的 title transport；其他序列分别是 icon、cwd、attention、shell integration 或普通输出，混用会改变既有语义边界。
  日期/作者：2026-08-06 / Codex

- 决策：title 在会话存活期间以 hard-capped、无控制字符、折叠空白的最终显示值进入 Host state 和 Supervisor snapshot，用于 reattach；不进入 terminal journal、recent output、diagnostic payload、attention 文案或历史会话。停止、错误和新启动会清除它。
  理由：Webview 重建和跨 Host reattach 需要一个权威初始值；同时 title 可能含路径或用户数据，必须最小化留存范围和复制范围。
  日期/作者：2026-08-06 / Codex

- 决策：实时更新复用 `host/executionOutput` 的合批消息，snapshot 带当前值；只在 title 规范化值实际变化时更新会话字段，常规 live-state 同步才写 metadata/persist。
  理由：Codex/Claude spinner 可每 100ms 变化，逐帧 `postState`/persist 会制造跨 surface 状态风暴；随已有 output 消息投递能维持顺序和背压边界。
  日期/作者：2026-08-06 / Codex

- 决策：为 Supervisor 与 Host/Webview snapshot 的 `terminalTitle` 引入与 output 一致的三态传输：字符串为设置，`null` 为明确清空，字段缺失只代表兼容旧端或未知值。对同一 live session，Webview 与 Host 不以缺字段抹除已经收到的 title；不同 session 仍不能继承旧 title。
  理由：明确 OSC 空 payload 仍需即时移除动态 title 前缀，但快照字段的序列化缺失不是 PTY 清空事件。分开表达可修复 Codex 完成一轮后出现的错误回退，同时保持旧 Supervisor 兼容。
  日期/作者：2026-08-06 / Codex

- 决策：title 只投影到 Agent/Terminal 节点标题栏最上方的上下文行。该行默认仅显示使用现有 cwd 助手得到的 `{root}`；收到非空 OSC title 后显示 `{terminal title} · {root}`。title 清空、缺失或会话结束时只保留 `{root}`，不合成默认 terminal title。
  理由：`Terminal`、Agent 名称、启动命令和 shell 路径都不是 PTY 设定的 terminal title；把 cwd 伪造成 title 会产生 `{root} · {root}` 的重复信息。上下文行本来就用于路径上下文，适合承载这条短时运行信息，而静态副标题继续承载启动来源。
  日期/作者：2026-08-07 / 用户确认，Codex 记录

## 结果与复盘

title 的 transport、三态 snapshot、展示位置调整与定向自动化验证均已完成。计划保持 active，直到真实 VS Code 宿主 smoke 有证据后再移入 completed。

2026-08-06 已通过：`npm run typecheck`、`npm run test:agent-terminal-title-activity`、`npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "PTY terminal titles"`、`npm run build` 与 `git diff --check`。parser 覆盖 OSC 0/2、BEL/ST/C1 ST、分片、控制字符、空 title 与 160 code-point 上限；Supervisor 定向回归确认 live snapshot 传回 title、已知空 live title 传为 `null`、finished snapshot 不保留它；当时 Webview 回归确认动态副标题、静态 fallback、稳定节点标题、旧会话 output 不覆盖新会话，以及同一会话缺字段 snapshot 不清空既有 title。展示位置调整后的验证结果见下一段。

2026-08-07 已通过：`npm run typecheck`、`npm run test:agent-terminal-title-activity`、`npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "header context"`、其内部执行的 `npm run build`，以及 `git diff --check`。Webview 用例确认 Agent 与 Terminal 的静态副标题保持启动命令 / shell 路径，初始与显式清空时 context row 只显示 `workspace/`，收到 title 时显示 `{terminal title} · workspace/`，同一会话缺 title 字段的 snapshot 保持已有 title，旧 session output 不能覆盖新 session title，节点可编辑名称不变。

尚未运行真实 Extension Development Host smoke，因此尚未声明各 shell、各 VS Code 主题、远程 workspace 或真实 provider title 行为都已验证。建议按“具体步骤”中的命令完成 Terminal 设置/清空，再观察真实 Agent 的 spinner、reload 与 reattach。

## 上下文与定向

`Agent` 和 `Terminal` 都通过 `node-pty` 连接真实 PTY。PTY 输出先由 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`（本地会话）或 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`（live-runtime 会话）接收，再发送给 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`，由 `xterm.js` 渲染。PTY 是带控制序列的字节流；terminal title 不显示在屏幕 buffer 中，而是由 OSC（Operating System Command）控制序列携带。

当前 `extensions/vscode/dev-session-canvas/src/common/agentTerminalTitleActivity.ts` 只为 Agent lifecycle 解析 OSC 0/2。它必须改为依赖通用 parser，仍然返回已解析 title 给 provider frame classifier，不能因为显示功能而放宽 lifecycle profile。`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 是 Host/Webview 的共享消息与 metadata 边界；`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 是 Host/Supervisor 的快照边界。

`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 已将 `ChromeTitleEditor` 用于两类节点的稳定节点名。`ChromeTitleEditor` 已有最上方的只读 context row；Agent 与 Terminal 都以同一 cwd 助手在其中显示 root。两类节点的副标题分别固定为 Agent 启动命令与 Terminal shell 路径。title 功能只把 `{terminal title} · {root}` 投影到 context row，不新增第二个可编辑 title 控件，也不修改概览节点名。

## 工作计划

第一步在 `src/common/` 增加通用终端 title parser 和 display normalizer。parser 必须保留已有分片处理语义，normalizer 则产出最多 160 个 Unicode code point 的单行显示值，空值表示清除 title。旧 Agent activity 模块调用同一 parser 并保持既有测试 API 的兼容。

快照补强步骤：`RuntimeSupervisorSessionSnapshot` 与 `host/executionSnapshot` 的 `terminalTitle` 改为字符串、`null`、缺字段三态。Supervisor 对已知的空 live title 发 `null`；Host 仅在 snapshot 带字符串或 `null` 时更新既有 session，保留旧 Supervisor 缺字段时已收到的 title；Webview 对同一 session 也保持此规则，而新 session 不继承旧 session title。

第二步扩展共享 metadata、Host/Webview output/snapshot 消息和 Supervisor snapshot。`ManagedExecutionSessionBase` 与 `SupervisorSession` 保存当前 title 与 parser carryover；每个原始 output chunk 在进入 xterm/terminal journal 后解析 title，最后一个合法 OSC 0/2 更新当前值。Local Host 和 Supervisor 都在终态、新会话启动时清除值。Host 的 output scheduler 要随合并 chunk 转运最后更新的 title；`flushLiveExecutionState()` 和 `postExecutionSnapshot()` 提供 reattach 所需的 fallback 值。

第三步在 Webview 维护每个 execution session 的最新 title，接收 output 或 snapshot 时按 session id 更新它，并将其传入 `toFlowNodes()`。`ChromeTitleEditor` 的 `subtitle` 固定为原有 launch command/shell path；它的 context row 对两类节点都使用 cwd 标签助手，title 存在时显示 `{terminal title} · {root}`，否则显示 `{root}`，并将完整组合放在 tooltip 中。终端控制序列仍由 xterm 正常消费；Webview 不自行解析或反向上报 title。

第四步补测试：通用 parser 覆盖 OSC 0/2 的 BEL、ST、C1 ST、跨 chunk、无效控制字符、清空和字符上限；Supervisor protocol 测试覆盖 snapshot title 和 live 空 title 的 `null` 表示；Playwright Webview 测试覆盖 Agent/Terminal 固定静态副标题、默认 `{root}` 上下文、动态 `{terminal title} · {root}`、同 session 缺字段 snapshot 保持 title、显式 `null` 清空为 `{root}` 与稳定节点名不变。定向测试还要证明 title 没有成为 terminal journal event 或 per-frame `host/stateUpdated`。

## 具体步骤

所有命令在仓库根目录执行：

    npm run test:agent-terminal-title-activity
    npm run test:runtime-supervisor-protocol
    npm run test:protocol-webview-messages
    npm run test:webview -- --grep "header context"
    npm run typecheck
    npm run build
    git diff --check

若 Webview grep 在当前测试命名下无法定位用例，执行相同测试 runner 的完整 webview suite，并在本计划记录结果。真实人工 smoke 在 Extension Development Host 中新建 Terminal，输入 `printf '\033]2;Build API\a'`，再输入 `printf '\033]2;\a'`；Agent 则运行会产生 provider title 的任务并验证节点名不会闪动或被覆盖。

## 验证与验收

验收以可观察行为为准：两类节点标题栏的 context row 初始显示 `{root}`；Terminal 的 OSC 2 title 使它显示 `{terminal title} · {root}`，清空后回到 `{root}`；Agent provider title 产生同样效果。启动命令或 shell 路径的静态副标题、两类节点的输入框值仍保持原值。Webview 重建、snapshot attach 和 Supervisor snapshot 后会回显当前 title。Agent title activity 的两帧 profile、waiting/running reducer 与 attention 逻辑必须保持原有通过结果。

安全与性能验收：非法/过长 title 不越过 parser 限制；title 不出现在 output journal、recent output 或 diagnostics；连续 spinner title 不触发逐帧 state persistence。Automated tests、`npm run typecheck`、`npm run build` 和 `git diff --check` 均需成功。

## 幂等性与恢复

解析状态只属于当前 PTY process epoch。对同一 title 的重复 OSC 不改变会话值；启动、停止、退出、删除和重新附着都可以安全重试。旧快照缺少 `terminalTitle` 时不覆盖同一 live session 已有的投影；没有已知 title 时 context row 显示 `{root}`。回滚功能时删除 optional 字段即可，不影响已有 node metadata、terminal output 或 lifecycle activity parser。

## 证据与备注

初始研究证据：当前 `parseAgentTerminalTitles()` 已通过 `ESC ] 0/2 ; payload BEL`、`ESC \\` 和 C1 ST 的解析测试；当前 UI 的 `ChromeTitleEditor` 已具备可省略、有 tooltip 的顶部 context row，可在不添加视觉表面情况下承载动态 title。

本次修订说明：2026-08-06 新建本计划，以将“Agent title 仅作生命周期活动证据”的既有范围，与“Agent/Terminal 可见 terminal title”的新产品能力分开追踪。

本次修订说明：2026-08-06 完成通用 parser、Local Host/Supervisor/Webview 投影、清空与会话边界处理和自动化回归；保留真实宿主手动 smoke 为唯一未完成项。

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/common/executionTerminalTitle.ts` 中定义：

    export interface ParsedExecutionTerminalTitles {
      carryover: string;
      titles: string[];
    }

    export function parseExecutionTerminalTitles(chunk: string, previousCarryover?: string): ParsedExecutionTerminalTitles;
    export function normalizeExecutionTerminalTitle(title: string): string | undefined;

在 `ExecutionSessionMetadata` 与 `RuntimeSupervisorSessionSnapshot` 中添加 optional `terminalTitle?: string`。在 `HostToWebviewMessage` 的 `host/executionSnapshot` 和 `host/executionOutput` payload 中添加同名 optional 字段；它的语义始终是“此消息结束时该 session 的规范化 title”，不是屏幕输出或用户节点名。

补充：`ExecutionSessionMetadata` 继续使用 optional `terminalTitle?: string`。`RuntimeSupervisorSessionSnapshot` 与 Host/Webview 的 output/snapshot payload 使用 `terminalTitle?: string | null`：字符串是当前规范化 title，`null` 是确认清空，字段缺失表示未知或旧端不支持，不能清空同一 session 的已知 title。

本次修订说明：2026-08-06 根据真实 Codex Agent 在完成一轮后错误回退的反馈，补充 snapshot 三态语义与定向修复计划；在验证原始 PTY 是否实际发送空 OSC 之前，不改变明确空 title 的 fallback 行为。

本次修订说明：2026-08-06 已完成快照三态实现和回归验证。Supervisor 对 live 空 title 发 `null`，Host/Webview 对缺字段保持同一会话的既有 title；显式 `null` 和会话结束仍清空动态 title 投影。

本次修订说明：2026-08-07 用户确认 title 应放在截图所示的节点标题栏顶部上下文行，而非副标题或终端内容区。默认不合成 terminal title；上下文行无 title 时显示 `{root}`，有 title 时显示 `{terminal title} · {root}`。静态副标题恢复为 Agent 启动命令与 Terminal shell 路径。

本次修订说明：2026-08-07 已完成上下文行展示实现与定向自动化验证；真实 Extension Development Host smoke 仍是唯一未完成项。
