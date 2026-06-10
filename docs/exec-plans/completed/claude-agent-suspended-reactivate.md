# Claude Agent 挂起态与恢复前台

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。该文件要求计划自包含、持续维护，并让没有历史上下文的新手也能完成实现与验证。

## 目标与全局图景

当前用户在 Claude Code Agent 节点里按 `Ctrl-Z` 后，Claude Code 会输出“已挂起，请运行 fg 恢复”的提示，但进程没有退出，因此 Dev Session Canvas 只依赖 `node-pty.onExit()` 的现状不会捕获到任何终态。完成本计划后，Claude Code Agent 节点会把这个场景显示为明确的 `suspended`（中文文案“已挂起”）状态，节点仍保留 live 会话，并提供中文“恢复”动作把同一个 Claude Code 进程重新带回可交互前台。这里的“恢复”只作为中文 UI 文案；代码和协议层使用 `reactivate`，避免与现有 provider session `resume` 语义冲突。

用户可通过以下方式亲眼验证：创建 Claude Code Agent 节点，按 `Ctrl-Z`，节点状态变为“已挂起”且没有退出横幅；点击“恢复”后 Claude UI 重绘并可继续输入；点击“停止”仍能结束会话。

## 进度

- [x] (2026-06-10 04:35Z) 从最新 `origin/main` 创建分支 `fix/claude-suspended-reactivate`，并确认工作树干净。
- [x] (2026-06-10 04:35Z) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md` 和相关设计文档入口，确认该变更涉及执行生命周期设计与需要 ExecPlan。
- [x] (2026-06-10 05:40Z) 更新共享协议与状态展示，使 Agent 支持 `suspended` 状态和 `reactivate` 消息。
- [x] (2026-06-10 06:05Z) 更新本地 PTY 与 runtime supervisor 两条执行路径，识别 Claude Code `Ctrl-Z` 挂起输出，并通过 `SIGCONT` 实现 reactivate。
- [x] (2026-06-10 06:20Z) 更新 Webview UI：挂起态显示“已挂起”和“恢复/停止”，并抑制普通终端输入直达 host。
- [x] (2026-06-10 06:35Z) 补充单元测试与 Playwright Webview 覆盖；fake provider 仍未改成真实 `Ctrl-Z` 捕获，因为 bash line-oriented `read` 无法代表 Claude Code 的 TTY suspend 行为。
- [x] (2026-06-10 06:50Z) 同步正式设计文档与索引，运行聚焦验证命令并记录证据。
- [x] (2026-06-10 07:05Z) 复跑 `typecheck`、`build`、新增单元测试和挂起态 Webview harness，全部通过。

## 意外与发现

- 观察：fake provider 目前是 line-oriented bash `read`，不能可靠模拟 Claude Code 在 raw TTY 中收到 `Ctrl-Z` 后输出挂起提示但进程不退出的行为。
  证据：`tests/vscode-smoke/fixtures/fake-agent-provider` 的主循环使用 `while IFS= read -r line`，只能在回车后处理整行；本轮改为用共享识别函数、host/supervisor 状态路径和 Webview harness 覆盖核心语义，真实行为仍以本地 Claude Code + node-pty 实验证据为准。
- 观察：真实 `claude --bare` 收到 `Ctrl-Z` 后不会退出；它会输出 `Claude Code has been suspended. Run \`fg\` to bring Claude Code back.`，进程继续存活，`node-pty.onExit()` 不触发。
  证据：2026-06-10 调查中直接用仓库的 `node-pty` 启动 `claude --bare`，写入 `\x1a` 后 `ps` 仍显示同一 `claude --bare` 进程，直到写入 `Ctrl-C` 才触发 `onExit { exitCode: 0, signal: 0 }`。
- 观察：向挂起后的 Canvas PTY 写入 `fg\r` 不会恢复 Claude Code，因为 Canvas 直接 spawn `claude`，没有外层 shell job table；向进程发送 `SIGCONT` 可以让 Claude Code 重绘 UI 并恢复交互。
  证据：2026-06-10 本地实验中，`child.write('fg\r')` 只把文本写进 Claude；`process.kill(child.pid, 'SIGCONT')` 后 Claude 输出完整 UI 重绘，随后 `/help` 能正常打开帮助界面。

## 决策记录

- 决策：代码与协议层使用 `reactivate` 表示把已挂起的 live process 带回前台，中文 UI 使用“恢复”。
  理由：现有 `resume-ready`、`resuming`、`resume-failed` 已经表示基于 provider session identity 重新恢复历史会话；这里是同一个 live Claude process 的前台恢复，不能复用 `resume`。
  日期/作者：2026-06-10 / Codex。
- 决策：第一版只把 Claude Code 的明确挂起输出识别为 `suspended`，不泛化到 Terminal 或 Codex。
  理由：当前证据来自 Claude Code 2.1.152 的交互式 TTY 行为；Terminal 的 shell job control 与 Codex 行为都不是同一语义，泛化会扩大风险。
  日期/作者：2026-06-10 / Codex。
- 决策：第一版恢复前台使用 `SIGCONT`，而不是向 PTY 写入 `fg`。
  理由：Canvas 不通过外层 shell 启动 Claude，`fg` 没有 shell job-control 语义；真实验证显示 `SIGCONT` 可恢复 Claude UI。
  日期/作者：2026-06-10 / Codex。

## 结果与复盘

已完成 Claude Code Agent 挂起态与恢复链路：共享协议新增 `suspended` 与 `webview/reactivateSuspendedExecutionSession`，runtime supervisor 协议新增 `reactivateSession`；本地 PTY 和 supervisor 路径都通过 Claude Code 明确挂起输出进入 `suspended`，并使用 `SIGCONT` 做 `reactivate`；Webview 在挂起态显示“恢复”和“停止”，并在恢复前抑制普通输入。

已同步 `docs/design-docs/execution-lifecycle-and-recovery.md`、`docs/design-docs/agent-running-state-detection.md`、`docs/design-docs/core-beliefs.md` 与 `docs/design-docs/index.md`。验证已覆盖识别函数、协议解析、状态展示、PTY `SIGCONT` 断言、typecheck、build，以及一个 Playwright Webview 场景。未完成边界是没有把 fake Claude provider 改造成真实 `Ctrl-Z` raw TTY 模拟器，也未运行完整 smoke / 全量 Playwright；这些属于耗时端到端验证，可在 MR 阶段补跑。

## 上下文与定向

`Agent` 节点当前由 `src/panel/CanvasPanelManager.ts` 管理宿主权威状态。本地执行路径用 `src/panel/executionSessionBridge.ts` 的 `createExecutionSessionProcess()` 直接通过 `node-pty.spawn()` 启动 provider CLI；持久运行时路径由 `src/supervisor/runtimeSupervisorMain.ts` 持有同样的 PTY process，并通过 `src/panel/runtimeSupervisorClient.ts` 与宿主通信。Webview 侧的 xterm 输入在 `src/webview/main.tsx` 中通过 `terminal.onData()` 发送 `webview/executionInput`，宿主收到后写入 PTY。

本计划使用以下普通语言定义：

`suspended` 是 Agent 的 live Claude Code 进程仍存在，但 Claude Code 已退出当前全屏交互 UI、等待被带回前台的状态。它不是退出，也不是异常，也不是历史恢复。

`reactivate` 是宿主把同一个 live Claude Code 进程带回前台交互态的动作。实现上在 Linux/macOS 对进程发送 `SIGCONT`。UI 中文文案叫“恢复”，但代码中不要使用 `resume`，因为 `resume` 已经表示基于 provider session id 重新恢复会话。

`resume` 在本仓库继续专指 provider session 恢复，例如 Claude `--resume <session-id>` 或节点状态 `resuming`。

## 工作计划

先修改共享模型。`src/common/protocol.ts` 的 `AgentNodeStatus` 增加 `'suspended'`，并增加 Webview 到 Host 的消息类型 `webview/reactivateSuspendedExecutionSession`。如果 runtime supervisor 协议有固定 request method 联合类型，也增加 `reactivateSession`。`src/common/canvasNodeStatusPresentation.ts` 增加中文状态“已挂起”和合适 tone。

然后修改 PTY 抽象。`src/panel/executionSessionBridge.ts` 的 `ExecutionSessionProcess` 增加 `reactivate?(): void` 或等价方法。`NodePtyExecutionSessionProcess` 在非 Windows 上对 `this.pty.pid` 发送 `SIGCONT`。如果直接 pid 失败，可尝试负 pid 进程组；Windows 当前没有 POSIX `SIGCONT`，第一版应抛出明确错误或记录不支持，避免伪成功。

然后修改状态编排。本地路径在 `CanvasPanelManager.ts` 的 Agent output handler 中识别 Claude Code 的挂起输出。识别函数应该尽量小而确定，例如匹配 `Claude Code has been suspended` 和 `Run \`fg\` to bring Claude Code back`。识别到后记录挂起前状态，清理 waiting-input timer，把 session 的生命周期设为 `suspended`，同步节点状态但保持 `liveSession: true`。runtime supervisor 路径在 `runtimeSupervisorMain.ts` 中做同样处理，并把 snapshot lifecycle 持久化为 `suspended`。

随后增加 reactivate 操作。Webview 的“恢复”按钮发送 `webview/reactivateSuspendedExecutionSession`。宿主只允许 `kind === 'agent'`、provider 为 `claude` 且当前状态为 `suspended` 时执行。执行成功后将状态改回挂起前的状态，若没有记录则用 `waiting-input`。在 supervisor owner 路径下，宿主通过 client 调 `reactivateSession`，由 supervisor 发送 `SIGCONT` 并回写状态。

最后补测试和文档。fake Claude provider 增加对 `Ctrl-Z` 的测试行为，自动化覆盖挂起、不会 exit、恢复后能继续输入、停止仍可结束。正式设计文档更新 `docs/design-docs/execution-lifecycle-and-recovery.md` 和 `docs/design-docs/agent-running-state-detection.md`，并同步 `docs/design-docs/index.md` 的更新时间和关联计划。

## 具体步骤

在仓库根目录执行所有命令。当前分支应为 `fix/claude-suspended-reactivate`：

    git status --short --branch

预期显示当前分支跟踪 `origin/main`，且在开始实现前没有未提交改动。

实现完成后，至少运行以下验证命令：

    npm run typecheck
    npm run test

如果 smoke 环境可用，再运行聚焦 Agent 生命周期的 VS Code smoke 场景。若 full smoke 耗时过长，可先运行新增/相关脚本，并在结果中说明未跑 full smoke 的原因。

## 验证与验收

自动化验收必须证明以下行为：

按 `Ctrl-Z` 后，fake Claude Agent 节点进入 `suspended`，metadata 仍显示 `liveSession: true`，并且没有产生 `host/executionExit`。这证明 Canvas 不再把挂起误判为退出，也不会继续显示 `running/waiting-input`。

点击或调用“恢复”后，节点离开 `suspended`，回到 `waiting-input` 或挂起前状态，并能继续向同一个 live session 写入输入。测试应在恢复后发送一条普通输入，并观察 fake provider 输出。

挂起态点击 Stop 后，节点进入 `stopped`，并清理 live session。这个验收保证新状态不会破坏现有停止路径。

真实手动验收建议使用已安装 Claude Code 的环境：启动真实 Claude Agent，按 `Ctrl-Z`，观察节点状态“已挂起”；点击“恢复”，观察 Claude UI 重绘；输入 `/help`，观察帮助页面；点击 Stop，确认节点停止且没有遗留进程。

## 幂等性与恢复

本计划只修改仓库文件，不需要破坏性迁移。新增状态字段必须有旧数据兼容路径：旧 snapshot 中不会出现 `suspended`，现有节点仍按原状态读取；新状态只能在运行时检测到 Claude 挂起输出后写入。若实现中途失败，可以重复运行测试；fake provider 修改应保持对现有 smoke 场景兼容，不应改变普通 Codex/Claude echo、resume 和 stop 流程。

不要使用 `git reset --hard` 或 `git checkout --` 回滚用户改动。如果发现工作树出现非本计划产生的改动，停止并确认来源。

## 证据与备注

当前调查证据摘要：

    node-pty spawn claude --bare
    write \x1a
    output: Claude Code has been suspended. Run `fg` to bring Claude Code back.
    ps: claude --bare still alive
    node-pty onExit: not fired
    process.kill(pid, 'SIGCONT')
    output: Claude Code UI redraws and accepts /help

关键验证输出：

    npm run typecheck
    > tsc --noEmit

    npm run build
    > node scripts/build/build.mjs

    npm run test:agent-suspend-signals
    agent suspend signal tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run test:theme-color-tokens
    canvas node status presentation tests passed

    npm run test:execution-session-bridge
    executionSessionBridge tests passed

    npx playwright test tests/playwright/webview-harness.spec.mjs --grep "suspended Claude Agent"
    1 passed

## 接口与依赖

在 `src/panel/executionSessionBridge.ts` 中，`ExecutionSessionProcess` 应新增一个用于恢复前台的能力，建议签名为：

    reactivate(): void;

如果实现选择可选方法，也必须在调用处明确处理缺失能力，不能静默成功。

在 `src/common/protocol.ts` 中，`AgentNodeStatus` 应包含：

    | 'suspended'

并新增 Webview 消息：

    { type: 'webview/reactivateSuspendedExecutionSession'; payload: { kind: ExecutionNodeKind; nodeId: string } }

如果 runtime supervisor protocol 使用 request method 联合类型，在 `src/common/runtimeSupervisorProtocol.ts` 中新增：

    method: 'reactivateSession'
    params: { sessionId: string }

在 `src/panel/CanvasPanelManager.ts` 和 `src/supervisor/runtimeSupervisorMain.ts` 中各自新增或复用小 helper，语义为“识别 Claude Code 挂起输出”。helper 只应在 provider 为 `claude` 时生效。

## 变更记录

- 2026-06-10：创建计划初版。原因：该功能改变 Agent 生命周期、Host/Webview/runtime supervisor 协议和正式设计文档，需要按仓库规则用 ExecPlan 跟踪。
