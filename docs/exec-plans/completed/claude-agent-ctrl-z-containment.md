# Claude Agent Ctrl-Z 收口处理

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本仓库的执行计划规则见 `docs/PLANS.md`。本文按该文件要求维护，目标是让没有历史上下文的协作者也能理解为什么这次不再继续做 Claude Code `Ctrl-Z` 恢复。

## 目标与全局图景

用户在普通 shell 终端里按 `Ctrl-Z` 后可以用 shell job control 把程序放到后台，再通过 `fg` 回到前台。但 Dev Session Canvas 的 Claude Agent 节点当前是直接通过 `node-pty` 启动 `claude` 进程，没有外层交互 shell 的 job table。实测中，Claude 输出 “suspended / fg” 文案并不等价于 Canvas 已经获得可恢复的后台 job；页面仍可能继续更新，点击恢复后也可能无法真正恢复输入。

本次收口完成后，Claude Agent 节点不再把 Claude 自身输出的 suspend 文案当成生命周期权威信号，也不再展示“恢复”或“恢复中”。当用户在 Claude Agent 节点里输入 `Ctrl-Z` 时，Webview、宿主和 runtime supervisor 三层都会阻断该输入，并显示明确提示：Claude Agent 节点不支持 `Ctrl-Z/fg`，请改用停止、重启或 Fork。普通 Terminal 节点和非 Claude Agent 不因为这条 Claude 专属规则被拦截。

## 进度

- [x] (2026-06-11 10:20Z) 梳理用户反馈，确认旧方案的 `suspended -> reactivate -> SIGCONT` 对当前 direct-spawn Claude Agent 架构不是可靠承诺。
- [x] (2026-06-11 10:45Z) 从实现中移除 Claude suspend 文案识别、Webview `reactivate` 消息和 runtime supervisor `reactivateSession` 请求。
- [x] (2026-06-11 11:05Z) 在 Webview、host 和 supervisor 的输入路径增加 Claude Agent `Ctrl-Z` 阻断，避免继续把 `\u001a` 写入 Claude 进程。
- [x] (2026-06-11 11:30Z) 替换旧的 Webview 挂起恢复测试，改为覆盖 Claude `Ctrl-Z` 被拦截、普通 Terminal 或 Codex Agent 不被 Claude 专属规则拦截、旧 `suspended` 状态不再出现恢复入口。
- [x] (2026-06-11 11:45Z) 更新设计文档和技术债记录，明确 `suspended` 仅作为历史兼容状态保留，不再是当前 Claude direct-spawn 架构的新建状态承诺。
- [x] (2026-06-11 12:10Z) 运行关键验证命令并在本文记录结果。

## 意外与发现

- 观察：仓库里存在已完成计划 `docs/exec-plans/completed/claude-agent-suspended-reactivate.md`，它记录的 `SIGCONT` 可恢复结论已被后续用户实测推翻为“不足以作为产品承诺”。
  证据：用户观察到三类异常：页面仍继续生成、恢复后输入无效、短暂出现恢复按钮后变成只有停止但不能交互。

- 观察：当前 Agent 启动路径直接调用 `createExecutionSessionProcess(launchSpec)` 并由 `node-pty.spawn(...)` 启动 provider CLI；这和普通 shell 的 `Ctrl-Z` / `fg` 语义不同。
  证据：`src/panel/executionSessionBridge.ts` 中 `NodePtyExecutionSessionProcess` 直接持有 PTY 进程；`CanvasPanelManager` 和 `runtimeSupervisorMain` 都基于该桥创建会话。

## 决策记录

- 决策：不再把 Claude Code 的 suspend 文案识别为新的生命周期转换。
  理由：该文案来自 provider 内部 UI，不代表 Canvas 有一个可通过 `fg` 或 `SIGCONT` 稳定恢复的 shell job。继续相信它会制造假“已挂起 / 可恢复”状态。
  日期/作者：2026-06-11 / Codex

- 决策：Claude Agent 节点输入 `Ctrl-Z` 时直接阻断，并提示使用停止、重启或 Fork。
  理由：阻断能避免进入不可解释的半挂起交互状态；停止和重启是 Canvas 已有且可验证的生命周期动作，Fork 则是 Claude 会话层的显式分支动作。
  日期/作者：2026-06-11 / Codex

- 决策：保留 `AgentNodeStatus` 中的 `suspended` 作为历史兼容状态，但 UI 不再提供恢复按钮。
  理由：已有持久化状态或旧 runtime snapshot 可能包含该枚举，立即删除会扩大迁移风险；将它降级为“停止后重启”的旧状态比继续承诺恢复更安全。
  日期/作者：2026-06-11 / Codex

## 结果与复盘

本轮已完成代码、测试和文档收口。Claude Agent `Ctrl-Z` 现在被 Webview、host 与 runtime supervisor 三层阻断；旧 `reactivate` 协议、PTY `SIGCONT` 方法和 suspend 文案识别 helper 已移除；旧 `suspended` snapshot 只作为兼容状态渲染，不再提供恢复入口。

## 上下文与定向

关键代码路径如下：

`src/webview/main.tsx` 负责嵌入式 xterm 的前端输入事件。Agent 节点中的 `terminal.onData` 是用户键盘输入进入宿主前的第一道门。

`src/panel/CanvasPanelManager.ts` 是 VS Code 宿主侧状态编排层。本地执行和 runtime supervisor 附着后的输入都会经过 `writeExecutionInput()`，这是阻止 Webview 绕过前端检查的第二道门。

`src/supervisor/runtimeSupervisorMain.ts` 是 runtime supervisor 后台进程。启用 live runtime 时，写入 PTY 的请求会经过 `writeInput()`，这是跨窗口或跨进程路径的第三道门。

`src/common/protocol.ts` 和 `src/common/runtimeSupervisorProtocol.ts` 定义 Webview 与宿主、宿主与 supervisor 的消息类型。旧的 `webview/reactivateSuspendedExecutionSession` 和 `reactivateSession` 不应继续存在。

`tests/playwright/webview-harness.spec.mjs` 是 Webview 行为回归测试。这里应该覆盖用户可见行为：Claude Agent 按 `Ctrl-Z` 后显示错误 toast 且不发送 `webview/executionInput`。

## 工作计划

先完成实现收口：删除旧的 suspend 文案检测 helper 和对应测试脚本，移除所有 `reactivate` 协议、客户端方法和 PTY `SIGCONT` 方法；在 Webview、host、supervisor 写入路径判断输入是否包含 `\u001a`，且仅对 provider 为 `claude` 的 Agent 生效。

然后完成测试收口：删除旧的“已挂起显示恢复按钮”和“恢复中抑制输入”测试，替换为新的阻断测试；补源码级测试确保 `agentSuspendSignals`、`maybeMarkClaudeAgentSuspended`、`reactivateSession`、`webview/reactivateSuspendedExecutionSession` 不再出现，同时确认 host/supervisor 存在 `claude-agent-ctrl-z-unsupported` 和用户提示。

最后同步文档：生命周期文档把 `suspended` 改为历史兼容或降级状态，不再列为当前 Claude direct-spawn 架构的正向路径；状态检测文档把 Claude suspend 文案降级为诊断文本，不参与 `running -> waiting-input` 或生命周期转换；核心原则文档删除 live process `reactivate` 示例，避免误导。

## 具体步骤

在仓库根目录执行以下命令定位残留引用：

    rg -n "reactivate|webview/reactivateSuspendedExecutionSession|agentSuspendSignals|maybeMarkClaude|reactivating|恢复中" src scripts tests docs/design-docs docs/exec-plans/tech-debt-tracker.md

预期最终只保留与历史 completed plan 相关的只读记录，当前 `src`、`scripts`、`tests` 和正式设计文档不再出现旧恢复链路。

修改完成后运行聚焦验证：

    npm run typecheck
    npm run test:runtime-supervisor-protocol
    npm run test:protocol-webview-messages
    npm run test:execution-session-bridge
    npm run test:canvas-execution-context
    npm run test:webview -- --grep "Ctrl-Z|suspended Claude Agent"

如果 Playwright grep 没匹配到测试，应改用最终测试名中的关键词重新运行。

## 验证与验收

验收标准是：Claude Agent 节点收到 `Ctrl-Z` 时，Webview 显示错误 toast，且 posted messages 里没有 `webview/executionInput`；同样的 `Ctrl-Z` 发送到 Terminal 节点或 Codex Agent 节点时，仍按原执行输入路径发送。

宿主侧验收标准是：即使 Webview 误发或旧客户端直接发送 `\u001a`，`CanvasPanelManager.writeExecutionInput()` 也会拒绝 Claude Agent 输入，记录 `claude-agent-ctrl-z-unsupported`，并向 Webview 发 `host/error`。

Supervisor 验收标准是：`runtimeSupervisorMain.writeInput()` 对 Claude Agent `\u001a` 抛出同样的明确错误，且协议中不再存在 `reactivateSession`。

## 幂等性与恢复

本计划的修改都是源码和文档收口，可重复运行搜索和测试命令。不要使用 `git reset --hard` 或清理用户未跟踪图片。若测试中途失败，应基于失败信息继续 patch，而不是回退整个工作树。

保留 `suspended` 枚举是兼容措施；如果未来确认没有旧状态需要迁移，可以另开计划删除该枚举和 metadata 中的历史字段。

## 证据与备注

已完成的关键验证：

    npm run typecheck
    # tsc --noEmit 通过

    npm run test:protocol-webview-messages
    # protocol webview message tests passed

    npm run test:execution-session-bridge
    # executionSessionBridge tests passed

    npm run test:runtime-supervisor-protocol
    # runtimeSupervisorProtocol tests passed

    npm run test:canvas-execution-context
    # canvas execution context tests passed

    npm run test:webview -- --grep "Ctrl-Z|suspended Claude Agent"
    # 3 passed；覆盖 Claude Ctrl-Z 阻断、Terminal/Codex 不被阻断、旧 suspended 无恢复入口

第一次运行 Playwright 聚焦测试时，旧 `suspended` 回归断言使用了 `.window-chrome-actions .primary-action`，在当前按钮结构里找不到元素而失败；改为按精确按钮名称断言不存在 `恢复` 后通过。

## 接口与依赖

本计划不新增外部依赖。需要保留的内部接口包括 `ExecutionSessionProcess.write()`、Webview 的 `webview/executionInput`、Supervisor 的 `writeInput` 请求。需要删除的接口包括 Webview 的 `webview/reactivateSuspendedExecutionSession`、Supervisor 的 `reactivateSession` 请求、PTY process 的 `reactivate()` 方法，以及共享 `agentSuspendSignals` helper。
