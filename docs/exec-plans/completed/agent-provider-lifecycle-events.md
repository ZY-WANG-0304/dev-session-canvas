# 用 Provider 生命周期事件修正 Agent 运行态

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

Terminal/Agent 重构后，Agent 的 `running -> waiting-input` 仍由 PTY 输出静默时间推断。Agent 在等待网络、运行静默工具或内部推理时，1600ms hard fallback 会把仍在执行的回合误判为等待用户输入；当会话由 Runtime Supervisor 托管时，这个错误状态还会被持久广播到重建后的 Webview。

本计划完成后，新建 Codex 会话在用户明确提交输入时进入 `running`，并在 Codex direct TUI 的 `notify` 回调 `agent-turn-complete` 到达后进入 `waiting-input`；新建 Claude Code 会话由 `UserPromptSubmit` 进入 `running`，由同一 `session_id + prompt_id` 的 `Stop` 或 `StopFailure` 进入 `waiting-input`。旧 Supervisor 不迁移 PTY，继续使用当前 prompt/OSC/BEL/quiet 组合启发式并自然退出。用户可以通过让 Agent 执行超过 1.6 秒且中间没有终端输出的任务，观察节点在真实回合结束前始终保持 `running`。

本轮保持 direct TUI + PTY 产品形态，不引入 Codex app-server，也不扩展 Codex `UserPromptSubmit`。生命周期信号和注意力通知是两条独立通道：`StopFailure` 结束本轮并切到 `waiting-input`，同时保存失败结果和错误摘要并触发 attention；普通 `Stop`/Codex 完成回调不自动制造 attention。

## 进度

- [x] (2026-07-14 23:38+08:00) 从 `origin/main@c1e13b75` 创建主题分支 `agent-running-waiting-state-fix`，并保留用户未跟踪文件 `image.png`。
- [x] (2026-07-14 23:38+08:00) 定位根因：Host 与 Supervisor 都用输入是否包含 CR/LF 判定提交，并用 220/260/1600ms PTY 静默启发式结束回合。
- [x] (2026-07-14 23:38+08:00) 完成 Codex direct TUI `notify`、Claude hooks、Stop continuation、Esc interrupt 和恢复场景受控实验。
- [x] (2026-07-14 23:38+08:00) 验证 Claude Code 2.1.209 重复 `--settings` 时只有最后一份 additional settings 的 hook 生效。
- [x] (2026-07-15 00:30+08:00) 实现输入意图协议，区分提交、文本编辑、粘贴、中断和未知输入，并兼容旧 Webview/Host/Supervisor。
- [x] (2026-07-15 00:30+08:00) 实现带 runtime session、process epoch、callback nonce、provider turn identity 与同步 ACK 的本机回调通道。
- [x] (2026-07-15 00:30+08:00) 接入 Codex `notify` 与 Claude 合并 hooks，保留用户 additional settings 和已有文件活动 hook；Codex notify 冲突时不覆盖用户配置。
- [x] (2026-07-15 00:30+08:00) 提升 Supervisor generation，新增 capability gate，让旧代会话继续使用原启发式。
- [x] (2026-07-15 00:30+08:00) 保存 provider 生命周期来源、turn outcome 和错误摘要，并为 `StopFailure` 接入 attention。
- [x] (2026-07-15 00:52+08:00) 增加纯逻辑、协议、hook 传输与 smoke 回归，完成类型检查、构建和差异检查；trusted smoke 覆盖 Claude 3 秒静默回合、Stop、StopFailure 和异常进程退出。
- [x] (2026-07-15 00:52+08:00) 尝试全量 `npm run test`；Agent lifecycle 相关验证全部通过，套件在无关的 Marketplace VS Code E2E 处先因 Unix socket 路径过长失败，短路径重试后又因既有 Marketplace probe 超时停止，已保留为环境/既有场景验证缺口。

## 意外与发现

- 观察：当前误判不是 Webview 渲染错误，而是 Host/Supervisor 都在 PTY 输出静默后主动写入 `waiting-input`。
  证据：`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts` 的 hard fallback 为 1600ms；调用点分别位于 `CanvasPanelManager.ts` 与 `runtimeSupervisorMain.ts`。

- 观察：Codex CLI 0.144.1 的 direct TUI 会执行 `notify`，回调包含稳定的 `thread-id` 和每轮唯一的 `turn-id`；一次 5 秒 notifier 实验中，TUI 在 notifier 退出后才恢复输入提示。
  证据：临时实验目录 `/tmp/dsc-provider-events.ZVLuS4` 中的 `codex-notify.mjs` 日志；该顺序是本机实测，不是公开兼容性保证。

- 观察：Claude Code 2.1.209 的 `UserPromptSubmit` 与 `Stop` 共享稳定的 `session_id + prompt_id`，但一个 Stop hook 阻止停止后，Claude 会继续执行并再次发出相同 `prompt_id` 的 `Stop`。
  证据：第一次 `Stop(stop_hook_active=false)` 后另一个 hook 返回 block，约 8 秒后收到 `Stop(stop_hook_active=true)`。因此 `Stop -> waiting-input` 是产品选择，不应被文档描述为不可逆的 provider 最终态。

- 观察：Claude 在执行 `sleep 30` 时按 Esc，TUI 返回输入提示，但没有发出 `Stop` 或 `StopFailure`。
  证据：实验只收到对应 `UserPromptSubmit`。Esc 必须走显式 `interrupt-requested` 与受限确认路径，不能假设它会触发失败 hook。

- 观察：Claude 重复 `--settings A --settings B` 时只有 B 的 `UserPromptSubmit` hook 执行。
  证据：2026-07-14 运行 headless Claude 后，事件文件从 12 行增加到 13 行，唯一新增记录为 `SETTINGS_B`。生命周期 hook 必须和 existing file-activity hook、用户 additional settings 合并成一份生成配置。

- 观察：Codex `notify` 是单一 argv 数组配置，CLI `-c notify=...` 会覆盖其他配置层的同名值；官方还明确 project `.codex/config.toml` 不能设置 `notify`。
  证据：2026-07-14 获取的 Codex manual 中，Advanced Configuration 把 `notify` 定义为 external notifier argv array，并说明 `-c/--config` 是单次运行 override。为避免静默破坏用户 notifier，检测到用户级/profile/CLI notify 时本轮回退到旧启发式，而不是覆盖。

- 观察：Codex completion 只有结束时才暴露 `turn-id`，提交路径无法预先得到该 ID。
  证据：正式 reducer 同时使用 `turn-id` 去重、`thread-id` 绑定和同机 `observedAtMs >= submittedAtMs` 检查；Supervisor 协议测试让 callback 延迟到 2300ms，证明 1600ms 时仍为 `running`，随后只由 notify 进入 `waiting-input`。这仍依赖实测的 notifier ACK 时序，不能写成官方保证。

- 观察：trusted smoke 的 PATH 中有一个名为 `claude` 的 bash 替身；它会被启动集成正确识别为真实 Claude 并安装 hooks，但替身原先不会执行这些 hooks，因此 session 会停在 `starting`，这不是生产退出通知回归。
  证据：失败 artifact 中生成 settings 已包含 lifecycle hooks，输入和 exit 33 均发生，但没有任何 provider callback。测试替身改为从生成 settings 执行 `UserPromptSubmit/Stop/StopFailure` 后，同一 smoke 覆盖 provider side-channel 并通过。

- 观察：完整 `npm run test` 在当前长 worktree 路径下无法跑完 Marketplace VS Code E2E。
  证据：首次失败为 Unix socket 超过 107 字符后的 `listen EINVAL`；使用 `/tmp/dsc-mkt-*` 短路径重试后 VS Code 成功启动，但既有 Marketplace probe 在 list view 超时。两次失败都发生在 Agent lifecycle 之外，trusted smoke 与本任务聚焦测试独立通过。

## 决策记录

- 决策：不采用 Codex app-server；Codex 继续由显式提交进入 `running`，由 direct-TUI `notify` 的 `agent-turn-complete` 退出。
  理由：用户明确要求保持当前 PTY/TUI 形态，且本机实验已证明 notify 可用。
  日期/作者：2026-07-14 / 用户与 Codex

- 决策：不为 Codex 扩展 `UserPromptSubmit`；提交语义由 Webview 键盘意图加原始数据兜底表达。
  理由：Codex 没有本轮要接入的对应 TUI hook，同时 CR/LF 字符本身无法区分提交、多行编辑和粘贴。
  日期/作者：2026-07-14 / 用户与 Codex

- 决策：Claude 使用 `UserPromptSubmit`、`Stop` 和 `StopFailure`；`StopFailure` 的主状态仍为 `waiting-input`，失败 outcome、错误摘要与 attention 单独保存。
  理由：CLI 进程仍然存活并可接受下一轮输入，把单轮 API 失败升级为整个节点 `error` 会丢失可恢复语义。
  日期/作者：2026-07-14 / 用户与 Codex

- 决策：Provider callback 必须同步发送到拥有 PTY 的 Host 或 Supervisor，并等待 ACK；每个进程实例使用独立 process epoch 与高熵 callback nonce。
  理由：延迟 callback 不能依赖共享、无认证 NDJSON 文件，也不能让旧进程事件修改新进程状态。
  日期/作者：2026-07-14 / Codex

- 决策：新 Supervisor generation 才启用 input intent 与 provider lifecycle capability；旧 generation 不迁移、不重启其 PTY。
  理由：当前架构允许多代 Supervisor 按 storage path 并存，generation gate 是避免新旧协议相互误读的最小安全边界。
  日期/作者：2026-07-14 / 用户与 Codex

- 决策：检测到 Codex 已配置自定义 `notify` 时，不覆盖用户配置，本会话保留旧启发式并记录诊断。
  理由：Codex 没有可追加多个 notifier 的公开契约，也没有公开的 effective-config 查询接口；静默替换可能破坏用户通知或遥测。
  日期/作者：2026-07-14 / Codex

- 决策：不放宽生产侧异常退出通知对退出前 lifecycle 的保护条件；改让 hook-capable smoke 替身真实执行生成 settings 中的 Claude hooks。
  理由：把 `starting/resuming` 也当作运行中断会让 CLI 配置错误和恢复启动失败产生额外提醒；修正替身既保持既有产品语义，又能端到端验证 settings 合并、callback transport 和 Host 状态机。
  日期/作者：2026-07-15 / Codex

## 结果与复盘

计划目标已经完成。新建 local 与当前 generation Supervisor 会话都使用 provider lifecycle adapter：Codex 由明确提交进入 `running`、由 direct-TUI notify 结束；Claude 由 `UserPromptSubmit` 开始、由 `Stop/StopFailure` 结束。普通 lifecycle-enabled 回合不再被 1600ms PTY 静默误判，旧 Supervisor 与 adapter 安装失败会话仍保留原启发式并自然 drain。

输入意图区分 Enter/NumpadEnter、编辑换行、IME、粘贴与 Esc；callback 同时绑定 runtime session、process epoch、nonce 和 provider turn identity。`StopFailure` 保持节点可交互并独立记录 failed/error/attention，Esc 不伪造 StopFailure。metadata 与 Supervisor snapshot 会记录状态来源、权威性、provider identity 和 last turn outcome。

残余风险已经登记到 `docs/exec-plans/tech-debt-tracker.md`：Codex 自定义 notify 冲突只能 fallback；Claude Stop 被其他 hook block 后可能短暂显示 `waiting-input`；Codex completion 的跨回合保护仍依赖本机实测的 notifier ACK 顺序。全量测试套件另有 Marketplace E2E 环境/既有 probe 缺口，但本任务的聚焦测试、构建、类型检查和 trusted smoke 均通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 在 xterm `onData` 中把原始字符交给 `main.tsx`；`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 定义 `webview/executionInput`。当前协议只有 `data`，因此 Host 无法知道 CR/LF 是按下 Enter、IME 确认、多行编辑快捷键还是粘贴内容。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是本地 PTY 和 workspace 投影的权威入口。关闭 runtime persistence 时它直接拥有 `ExecutionSessionProcess`；开启时，它通过 `runtimeSupervisorClient.ts` 把 create/write/resize/stop 请求发送给 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`。Supervisor 拥有长期 PTY，并通过 `sessionState` snapshot 把状态回传 Host。

`extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts` 已为 Claude 生成临时 `--settings`，其中包含 `PostToolUse` 文件活动 hook。生命周期 hooks 必须进入同一 settings JSON。用户命令里显式传入的 additional `--settings` 必须先按 Claude 当前“最后一份生效”的行为读取，再和生成 hooks 合并，不能通过第二个参数覆盖。

“process epoch”是一次真实 provider 进程启动的随机身份；“callback nonce”是只注入该进程环境的随机凭证；“provider turn identity”是 Codex `thread-id + turn-id` 或 Claude `session_id + prompt_id`。一个 callback 只有同时匹配 runtime session、process epoch、nonce、provider session 和当前 turn，才允许改变状态。

## 工作计划

第一步在 shared protocol 中新增 `AgentInputIntent`，Webview 在键盘事件发生时记录明确的 Enter/NumpadEnter、组合键、IME 和 Esc 意图，在随后 xterm `onData` 时附到 `webview/executionInput`。多字符/括号粘贴不得因包含换行被判为提交。Host 把 intent 转发给支持 `agentSubmissionIntentV1` 的 Supervisor；老消息缺 metadata 时保留 CR/LF fallback。

第二步增加 provider lifecycle 的纯类型/状态归约器和 Node 本机 callback server。server 只绑定 `127.0.0.1` 的随机端口，消息必须携带 registration 中的 session、epoch 和 nonce；hook 脚本发送一行 JSON、读取一行 ACK 后退出。传输失败不得阻断 provider 自身执行，但必须留下 owner 侧诊断并允许受控 fallback。

第三步扩展 launch integration。Codex 在没有用户 notify 冲突时追加一次 `-c notify=[...]`，命令指向扩展随包分发的 lifecycle hook。Claude 把 `UserPromptSubmit`、`Stop`、`StopFailure` 和现有 `PostToolUse` 合并到一份生成 settings，并合并用户 additional settings。Supervisor 在 spawn 前创建 callback registration 并注入环境；本地 Host 使用相同适配器。

第四步提升 `CURRENT_RUNTIME_SUPERVISOR_GENERATION`，在 hello capabilities 增加 `agentSubmissionIntentV1` 和 `agentProviderLifecycleV1`。新 generation 的 provider lifecycle 会话不再让 prompt/OSC/BEL/quiet 结束普通回合；旧 generation 及明确无法安装 lifecycle adapter 的会话继续运行现有启发式。Supervisor snapshot 额外携带 lifecycle source、provider session/turn identity、last turn outcome/error，Host 将其投影到 Agent metadata。

第五步为 StopFailure 接入 attention，并实现 Esc 的独立受限确认。Esc 只在 Webview 明确识别为无修饰、非 IME 的 Agent 中断键时标记 `interrupt-requested`；它不伪造 StopFailure。确认只能使用中断后出现的 prompt-like 输出或 provider idle 通知，并且 hard fallback 只在已 armed 的 interrupt 上生效，不能重新成为普通运行回合的结束依据。

## 具体步骤

在仓库根目录执行聚焦测试和全量验证：

    npm run test
    npm run typecheck
    npm run build
    git diff --check

如 smoke 环境可用，执行只覆盖 Agent lifecycle 的过滤场景；最终把命令、通过数量和关键输出补回本计划“证据与备注”。Provider 实机实验继续使用 `/tmp/dsc-provider-events.ZVLuS4`，不把临时凭证、转录或实验输出提交到仓库。

本次实际执行了上述 typecheck/build/diff check、所有 lifecycle 相关聚焦测试和 trusted smoke。`npm run test` 已尝试但在 Marketplace E2E 处停止，原因与重试证据记录在“意外与发现”和“证据与备注”。

## 验证与验收

纯逻辑测试必须覆盖：Enter/Return/NumpadEnter、CR/LF/CRLF virtual keyboard fallback、Shift+Enter/Ctrl+J、IME composition、bracketed/multiline paste、Esc；Claude 同 prompt 的 start/stop/failure、不同 prompt 的延迟 stop、不同 session 的 callback；Codex completion 去重、不同 thread、旧 process epoch 和错误 nonce。

协议测试必须证明旧 `webview/executionInput` 仍可解析，新 intent 可 round-trip，旧 Supervisor hello 没有新 capability 时 Host 不发送依赖新语义的字段。generation 测试必须证明新会话写入新 storage，而已有 metadata 指向旧 storage 时仍连接旧 Supervisor。

集成验收至少包括：一个超过 1.6 秒无输出的 Codex/Claude 回合在完成前保持 `running`；Codex notify/Claude Stop 后切到 `waiting-input`；Claude StopFailure 后状态为 `waiting-input` 且 metadata 记录失败、节点 attention 生效；上一进程/上一 prompt 的延迟 callback 不结束当前回合；旧 Supervisor 会话仍按原逻辑可用。

## 幂等性与恢复

文档和代码 patch 可重复应用前先检查当前 diff。callback server 使用随机端口和随机 nonce，不写共享事件流；session dispose 必须关闭 listener。生成的 Claude settings 位于既有 per-session 临时目录并随 session dispose 删除。若 provider adapter 初始化失败，不能让 Agent 无法启动；应记录诊断并显式选择 heuristic fallback。

不得重置或覆盖用户未跟踪的 `image.png`。不得 rebase 当前分支，除非用户另行要求。实验目录只用于验证，不作为运行时依赖。

## 证据与备注

Claude 多 settings 实验的关键结果：

    EVENT_LINES_BEFORE=12 EVENT_LINES_AFTER=13 EXIT=0
    {"event":"SETTINGS_B", ... "hook_event_name":"UserPromptSubmit"}

没有 `SETTINGS_A`，因此实现必须生成一份合并 settings。

根因的两个提交判断函数当前都等价于：

    return /[\r\n]/.test(data);

这只能作为旧协议兼容兜底，不能继续作为新 Webview 的正式提交语义。

最终验证的关键结果：

    agent provider lifecycle tests passed
    runtime supervisor protocol test passed
    protocol webview message test passed
    Trusted workspace smoke passed.
    VS Code smoke test passed.

trusted smoke 的 lifecycle-enabled 假 Claude 先运行 `sleep 3`；在 2000ms 检查点状态仍是 `running`，随后 `Stop` 将其切到 `waiting-input` 并保存 session/prompt identity。下一轮 `StopFailure("API unavailable")` 仍落到 `waiting-input`，同时保存 failed/error、设置 attention 并发出 workbench notification；再下一轮 `exit 33` 继续命中既有异常退出通知。

完整 `npm run test` 未宣称通过。首次 Marketplace VS Code E2E 在启动前报：

    IPC handle ... is longer than 107 chars
    Error: listen EINVAL: invalid argument ...main.sock

短路径重试成功启动 VS Code，但在与本任务无关的 Marketplace list probe 等待中超时，因此不把该套件结果写成 lifecycle 失败。

## 接口与依赖

`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 必须导出 `AgentInputIntent = 'submit' | 'text' | 'paste' | 'interrupt' | 'unknown'`，并让 `webview/executionInput.payload.intent` 可选，以兼容旧客户端。

`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 的 `RuntimeSupervisorHelloResult.capabilities` 必须增加 `agentSubmissionIntentV1` 与 `agentProviderLifecycleV1`，`RuntimeSupervisorWriteInputParams` 必须允许可选 intent；snapshot 必须能表达 provider lifecycle 来源和 last turn 结果。

Provider callback 的共享 event 必须包含 provider、provider session ID 和 provider turn ID。transport envelope 必须包含 runtime session ID、process epoch 和 callback nonce。运行时脚本只使用 Node 内置 `net`/`process`/`JSON`，不新增网络服务或第三方 runtime 依赖。

变更说明：2026-07-14 创建计划，记录已完成的 Codex/Claude 受控实验、用户确认的 provider 映射、callback identity 不变量、Claude settings 合并约束和 Codex notify 冲突回退策略。2026-07-15 更新实现进度，补充 completion 时间保护与 Supervisor 2300ms callback 回归证据；同日完成实现与验证，记录 hook-capable smoke 替身、StopFailure 端到端证据、全量测试的无关 Marketplace 缺口和最终残余风险。

后续决策说明：2026-07-21 用户根据 hooks-disabled review 将 notify/hooks 从排他 lifecycle 主路径调整为辅助增强信号。本文保留 2026-07-15 的实现历史；当前正式方案与后续实现以 `docs/design-docs/agent-running-state-detection.md` 和 `docs/exec-plans/completed/agent-provider-signals-as-enhancements.md` 为准。
