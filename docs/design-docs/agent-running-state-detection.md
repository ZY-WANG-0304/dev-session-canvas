---
title: Agent 运行态判定与等待输入信号设计
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/agent-running-state-detection.md
  - docs/exec-plans/completed/claude-agent-ctrl-z-containment.md
  - docs/exec-plans/completed/agent-provider-lifecycle-events.md
  - docs/exec-plans/completed/agent-lifecycle-adapter-hardening.md
updated_at: 2026-07-17
---

# Agent 运行态判定与等待输入信号设计

## 1. 背景

当前仓库已经把 `Agent` 节点的目标状态语义定义为：

- `running`：Agent 正在处理用户刚提交的一轮指令，或者仍处在当前回合的连续输出阶段。
- `waiting-input`：Agent 已结束当前回合，正在等待下一条用户输入。

旧实现没有接入 provider 的 turn/session 信号，所以宿主只能靠 PTY 行为推断：

- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 与 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 都只要发现输入包含回车或换行，就把状态切到 `running`。
- 两条路径随后都调用 `extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts`：prompt-like 输出静默 220ms、OSC/BEL 静默 260ms，或者无条件 hard fallback 静默 1600ms 后，把 `running` 退回 `waiting-input`。

这套旧方案能缓解“只要一有输入就一直是 running”的明显错误，但它实际观察到的是“PTY 最近发生了什么”，不是“provider 自己认定当前回合处在什么阶段”。当前正式实现已为新建 Codex/Claude 会话接入 provider lifecycle side-channel；PTY 启发式只保留给旧 Supervisor 和明确无法安装 adapter 的会话。

## 2. 问题定义

本设计需要回答四个问题：

1. `Agent` 的 `running` 与 `waiting-input` 应该以什么信号为正式判定依据，才能和真实 provider 语义对齐。
2. 当 provider 提供多种信号面时，宿主应该优先相信哪一层。
3. 当 provider 缺少权威事件时，哪些退化路线仍然值得保留，哪些不应被误写成正式能力。
4. UI 和诊断如何区分“节点当前状态值”和“这个状态值的判定权威性”。
5. direct-TUI 只有 completion callback 时，如何避免把升级菜单等非 prompt Enter 冒充成 Codex turn start。
6. lifecycle hook 在实际 extension root 缺失时，如何在 provider 启动前 fail closed，而不是声明一条无法送达的权威事件路径。
7. Claude 启动模式主动禁用 hooks 时，如何保留用户选择并避免误报 lifecycle capability。

## 3. 目标

- 为 `Agent` 的 `running` / `waiting-input` 定义一条成熟、可扩展的判定优先级。
- 优先采用 provider 官方公开的 machine-readable turn/session 信号，而不是继续长期依赖 PTY 静默推断。
- 让不同 provider 的差异可以被显式建模，而不是再被压成一套脆弱的统一启发式。
- 为宿主与 UI 增加“状态来源/权威性”概念，避免把 best-effort 结果伪装成权威事实。

## 4. 非目标

- 不在本轮直接重写 `Agent` backend。
- 不在本轮把所有第三方 CLI 都接入正式运行态协议。
- 不在本轮把 `waitingOnApproval`、工具执行中、子任务中等更细颗粒度活动态全部升格为新的用户可见主状态。
- 不在本轮承诺 plain PTY 模式下一定能获得和 provider 原生 UI 完全一致的判定精度。

## 5. 候选方案

### 5.1 继续只靠 PTY 输入与输出静默推断

特点：

- 提交输入时切到 `running`。
- 一段静默后切回 `waiting-input`。
- 不需要 provider 额外能力。

不选为长期方案的原因：

- 它观察到的是字符流节奏，不是回合边界。
- provider UI 自刷新、延迟 flush、等待审批、后台工具执行或输出节流时，都会让推断漂移。
- 同一个 provider 升级版本后，屏幕输出模式一变，状态判定就可能失真。

### 5.2 利用 shell integration / prompt boundary

特点：

- 依赖 shell prompt 与命令执行的开始/结束信号。
- VS Code 已支持 `OSC 633;A/B/C/D` 和 `onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`。

适用范围：

- `Terminal` 节点的命令生命周期。
- Agent 代表用户调用 shell command 时的辅助诊断。

不选为 `Agent` 主判定方案的原因：

- shell integration 看到的是 shell 命令，不是 provider TUI 的内部对话回合。
- 交互式 `codex` / `claude` 会话在 shell 看来通常只是一个长期存活的前台进程，shell 侧并不知道它何时完成一轮回答。

### 5.3 接入 provider 原生结构化 turn/session 事件

特点：

- 直接消费 provider 官方公开的 machine-readable 事件。
- 事件通常包含“回合开始”“回合完成”“线程状态变化”“等待审批”等信息。

当前判断：

- 这是长期正式方案。
- 只要 provider 已公开稳定事件面，就不应继续把 PTY 文本推断当主路径。

已知证据：

- OpenAI 官方 `Codex app-server` 文档已经公开 `turn/started`、`turn/completed`、`thread/status/changed` 与 `activeFlags.waitingOnApproval`。
- 本轮按产品约束没有切换 app-server；Codex direct TUI 的 `notify` 已通过实机实验确认会发送带 `thread-id + turn-id` 的 `agent-turn-complete`。

### 5.4 接入 provider 自己的结构化输出、SDK 或 hooks

特点：

- 不一定是完整事件总线，但 provider 会提供结构化输出或回调点。
- 例如 SDK message stream、`stream-json`、hooks。

当前判断：

- 这是次优但成熟的正式方案。
- 当 provider 没有统一 app-server，但有 SDK/headless/hook 能力时，应优先利用这些接口。

已知证据：

- Anthropic 官方文档公开了 Agent SDK 的流式消息与 `session_id`。
- `Claude Code` headless 模式支持 `--output-format stream-json`。
- hooks 支持 `Stop` 与 `Notification` 等事件点。

## 6. 风险与取舍

- 取舍：为不同 provider 维护不同的活动信号适配层。
  原因：这会增加实现复杂度，但比继续强行共享一套错误抽象更可控。

- 风险：某些 provider 的官方结构化接口更偏自动化模式，而不是当前仓库在用的交互式 PTY 模式。
  当前缓解：允许“交互式 UI 继续走 PTY，状态判定额外并行接一条结构化 sidecar”，而不是要求一步切掉现有 UI。

- 风险：同一 provider 不同运行模式下，状态信号粒度可能不一致。
  当前缓解：把“生命周期状态值”和“信号来源/权威性”拆开建模，防止因为不同模式的粒度差异而污染用户可见语义。

- 风险：如果没有明确信号优先级，新的 provider 事件和旧的 PTY 启发式可能互相打架。
  当前缓解：正式优先级固定为“provider 原生事件 > provider 结构化输出/hooks/SDK > shell integration > PTY 启发式”，低优先级只能在高优先级缺失时生效。

- 风险：Codex `notify` 是单一 argv 数组配置，扩展通过 CLI override 安装 notifier 时会覆盖用户已有 notifier。
  当前缓解：本轮检测到用户级/profile/CLI `notify` 冲突时不覆盖，保留启发式 fallback 并记录诊断。官方当前没有公开可追加多个 notifier 或读取 effective config 的稳定接口，因此不能把“自动链式保留所有配置层”写成已确认能力。

- 风险：Claude `Stop` hook 可以被另一个 Stop hook 阻止，收到 Stop 不代表 provider 不会继续当前 prompt。
  当前缓解：产品仍按已确认口径将 `Stop` 投影为 `waiting-input`，但保留相同 `prompt_id` 的后续 Stop 幂等处理，并把这一短暂失真记录为已知限制，不能称为不可逆完成事件。

## 7. 正式方案

### 7.1 正式语义

- `running` 只表示 provider 已接受当前一轮用户指令，且该轮尚未结束。
- `waiting-input` 只表示 provider 已结束当前一轮，正在等待新的用户输入。

这两个状态的定义不依赖实现方式；实现是否成熟，只影响“这些状态值是如何被判出来的”。

### 7.2 正式判定优先级

`Agent` 运行态判定的正式优先级如下：

1. provider 原生结构化 turn/session 事件。
2. provider 官方公开的结构化输出、SDK message stream 或 hooks。
3. shell integration / prompt boundary，仅用于辅助判定 shell 侧活动。
4. PTY 输入与输出静默启发式。

只有当前两层都不可用时，才允许使用后两层。

### 7.3 provider 级结论

`Codex`

- 当前正式实现继续使用 interactive CLI PTY，不采用 app-server，也不接入 Codex `UserPromptSubmit`。
- Webview 识别用户明确提交意图后进入 `running`；单纯“数据中出现 CR/LF”只保留为旧 Webview/Host/Supervisor 的兼容兜底。由于启动升级菜单和 provider 本地选择菜单也会产生 Enter，`submit` 还必须消费同一进程内已观察到的可编辑输入候选：方向键、终端控制响应、空白和编辑换行不能建立候选，可见非空文本或粘贴可以建立候选，submit 与 interrupt 会清空候选。该规则不解析 Codex 屏幕文案，也不把候选伪装成 provider turn identity。
- 结束信号使用 Codex direct-TUI `notify` 的 `agent-turn-complete`。回调必须携带并校验 `thread-id + turn-id`，同时由扩展注入 runtime session、process epoch 与 callback nonce，成功送达拥有 PTY 的 Host/Supervisor并得到 ACK 后才允许结束本轮。
- 本机 Codex CLI 0.144.1 实验确认：同一会话及 resume 后 `thread-id` 稳定，每轮 `turn-id` 唯一；一次 5 秒 notifier 实验中，TUI 保持 Working，notifier 退出后才恢复 prompt。该顺序是实验事实，不是官方兼容性承诺。
- 如果用户已配置自定义 `notify`，本轮不静默覆盖，改用旧启发式 fallback。后续如 Codex 提供多 notifier 或 effective-config 接口，再单独设计可靠链式方案。
- app-server 的 `turn/started`、`turn/completed` 和 `thread/status/changed` 仍是未来可选路线，但明确不属于本轮实现。

`Claude Code`

- interactive TTY 保持为执行与显示通道，同时用 hooks 补充 lifecycle side-channel。
- `UserPromptSubmit(session_id, prompt_id)` 进入 `running`；同 identity 的 `Stop` 或 `StopFailure` 进入 `waiting-input`。
- `StopFailure` 不把整个仍存活的 Agent 节点改成 `error`；它另外写入 failed turn outcome、错误摘要，并触发 attention/notification。
- Esc 中断实验没有产生 `Stop` 或 `StopFailure`，因此 Esc 必须由 Webview 的明确 `interrupt` 意图单独 arm，再由中断后的 prompt/idle 信号确认；不能伪造 API failure。
- Claude Code 2.1.209 实验确认重复 `--settings A --settings B` 时只有 B 的 hook 生效。`UserPromptSubmit`、`Stop`、`StopFailure`、已有 `PostToolUse` 文件活动 hook 与用户 additional settings 必须合并到同一份生成 settings，不能靠追加第二个参数组合。
- `--safe-mode` 会禁用 hooks，`--bare` 会跳过 hooks；任一 flag 出现在默认参数或自定义启动命令时，adapter 必须保留原始 argv，不生成 lifecycle settings，不声明 lifecycle enabled，并分别记录 `claude-hooks-disabled-by-safe-mode` 或 `claude-hooks-disabled-by-bare` 后回退启发式。
- 一个 Stop hook 可以 block 当前停止并让 Claude 继续，同一 `prompt_id` 稍后还会收到第二个 Stop。选择 `Stop -> waiting-input` 会在此窗口短暂低估运行态，这是用户确认接受的限制。

### 7.4 数据模型结论

本轮实现中，节点 metadata 至少新增以下信息：

- `activitySource`：当前状态由什么来源驱动。本轮实现使用 `provider-lifecycle`、`submission-intent` 与 `heuristic`。
- `activityAuthority`：当前来源是 `authoritative`、`derived` 还是 `best-effort`；Codex 提交进入 running 属于 `submission-intent / derived`，provider 完成回调属于 `provider-lifecycle / authoritative`。
- provider session/turn identity：用于诊断当前状态对应的真实 provider 回合，不能用累计 prompt 文本代替。
- last turn outcome/error：普通完成、单轮失败和中断相互独立；单轮失败不得复用进程退出字段。

这样即使用户看到的主状态仍然是 `running`，宿主和 UI 也能明确区分“这是 provider 自己说的”还是“这是我们从 PTY 文本猜的”。

### 7.5 Provider callback 与旧代 fallback 边界

Provider callback 由拥有真实 PTY 的运行时处理：本地会话由 Extension Host 处理，`live-runtime` 会话由对应 generation 的 Supervisor 处理。每个进程实例生成独立 `processEpoch` 和高熵 `callbackNonce`；callback envelope 同时携带 `runtimeSessionId`，provider payload 携带 Codex `thread-id + turn-id` 或 Claude `session_id + prompt_id`。任一 identity 不匹配都只能记录诊断，不能改变节点状态。

Codex 提交时还记录 owner 的提交时间；notifier 在构造 callback 时记录同机 `observedAtMs`。如果 completion 的观察时间早于当前提交时间，即使它带着尚未见过的 `turn-id`，也按上一轮延迟事件拒绝。这个时间保护与 `turn-id` 去重共同使用；它依然依赖 direct TUI 实测的“notifier ACK 后才恢复下一轮输入”顺序，因此该边界必须保留为已验证实现约束，不能泛化为 Codex 官方时序保证。

callback 使用回环地址上的同步 request/ACK，而不是共享无认证 NDJSON 文件。hook 传输失败不能阻断 provider 自身，但对应会话必须显式保持或退化为 fallback，不能假装已经获得 provider 事件。

adapter 在构造 Codex `notify` 或 Claude lifecycle hooks 前，必须确认当前 launch mode 允许 callback，且 extension root 中的 `scripts/runtime/agent-lifecycle-hook.cjs` 确实存在。Claude `--safe-mode` / `--bare` 或 hook 文件缺失时，不得注入必然失效的命令，也不得把 lifecycle 标成 enabled；会话保留原始参数、记录明确 fallback reason 并沿用 PTY 启发式。main-only debug staging 应复制完整 `scripts/runtime`，与 trusted smoke 和正式 package 的运行时文件边界保持一致。preflight 是 hooks-disabled 模式、安装损坏、staging 漂移和其他 adapter 不可用场景的最后防线，不能替代正确打包。

新 Supervisor hello 通过 `agentSubmissionIntentV1` 与 `agentProviderLifecycleV1` capability 声明新语义，并使用新的 generation storage。已有会话继续按 metadata 中的旧 storage path 连接旧 Supervisor，不迁移、不重启 PTY；旧代会话自然 drain。

### 7.6 fallback 的保留范围

组合启发式仍同时存在于本地 PTY 与 runtime supervisor 路径，但只服务于旧 Supervisor、Codex 自定义 `notify` 冲突、Claude settings 无法安全合并、Claude `--safe-mode` / `--bare` 主动禁用 hooks 等 lifecycle adapter 不可用场景。新建且 lifecycle-enabled 的普通运行回合不得再由 prompt、OSC/BEL 或 1600ms hard fallback 结束；只有 Webview 明确 arm 的 Esc interrupt 可以在中断后的 prompt/quiet 证据下受限确认。

fallback 的具体规则是：

- 旧协议缺少输入意图时，只有输入里出现 `\r` 或 `\n` 才把 `Agent` 切到 `running`；新 Webview 使用显式 `submit/text/paste/interrupt` 意图，编辑换行、IME 与多行粘贴不再冒充提交。
- Codex 即使收到显式 `submit`，也只有在当前提交候选已由可见非空输入建立时才进入 `running`；启动菜单中的纯导航与 Enter 仍原样转发给 PTY，但不改变 Agent lifecycle。Claude 的 turn start 继续只来自 `UserPromptSubmit` hook，不复用这条 Codex 派生规则。
- `waiting-input` 不再只靠单一 quiet timeout，而是综合以下线索判断：
  - prompt-like 尾部输出；
  - `OSC 9` / `OSC 777` 通知；
  - bell；
  - 长静默 hard fallback。
- 普通换行本身不再被当成“当前回合已完成”的直接信号；因为长任务可能先输出一整行文本，再在静默期内继续执行。
- Claude Code 的 `Ctrl-Z` / `fg` 文案不再参与运行态或生命周期判定。当前 Claude Agent 是 direct-spawn provider CLI，没有普通 shell job table；如果把 provider 输出的 suspend 文案当作权威状态，会制造页面仍在更新、恢复后输入无效等伪挂起问题。新的输入路径在 Webview、宿主与 runtime supervisor 三层阻断 Claude Agent `Ctrl-Z`，并把后续处理引导到停止、恢复或分叉。
- 若最近输出呈现 spinner 或 redraw 特征，例如 `\r` 覆写、退格或光标移动控制序列，则会延长回退窗口，避免 Agent 仍在工作时被过早判回 `waiting-input`。

这一版仍然属于 `heuristic` / `best-effort`，只是把误判窗口从“固定静默时间”收紧为“多信号综合判断”。


### 7.7 Webview 状态呈现

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的 `AgentSessionNode` 只在节点 `status` 精确等于 `running` 且 `metadata.agent.attentionPending` 不为 `true` 时，为标题栏添加 `is-agent-running-titleline` 与 `data-agent-running-titleline="true"`。`live`、`starting`、`resuming`、`reattaching`、`waiting-input` 等状态即使表示执行节点仍可附着或处在生命周期过渡中，也不得触发这条运行活性线；这些状态继续依靠状态胶囊文本与既有状态色表达。

`extensions/vscode/dev-session-canvas/src/webview/styles.css` 的 `execution-agent-running-titleline` 只让标题栏底部的短纯色段在可用宽度内左右往返移动，并使用 `--canvas-node-color` 派生的 Agent 节点类型色，而不是 `tone-running` 或 VSCode running 状态色。非移动区域继续使用标题栏原有 1px `border-bottom`，不额外铺一条静态状态色底线；只有移动段可加粗，不使用渐变尾部，也不再从左到右单向划过后淡出，避免 running 视觉覆盖普通标题栏分隔语义。这样该动效表达的是“这个 Agent 对象正在处理当前回合”，不是新的全局 running 状态色体系；当 attention pending 存在时，attention 提醒优先，运行细线隐藏，避免弱活性提示和强提醒同时竞争。`prefers-reduced-motion: reduce` 下关闭高光位移，仅保留标题栏原有底部分隔线。

## 8. 验证方法

至少需要完成以下验证：

1. 对接入官方事件面的 provider，自动化测试能证明 `turn start -> running`、`turn complete -> waiting-input` 的状态迁移。
2. 当 provider 原生事件与 PTY 启发式冲突时，自动化测试能证明前者优先。
3. 当 provider 仅有结构化输出或 hooks 时，自动化测试能证明节点仍可稳定落到 `running` / `waiting-input`，且 metadata 会标明来源。
4. 当 provider 没有任何正式接口时，节点仍可通过 fallback 工作，但诊断中能明确看到其为 best-effort。
5. 输入意图测试覆盖 Enter/Return/NumpadEnter、virtual keyboard 的独立 CR/LF/CRLF、Shift+Enter/Ctrl+J、多行/括号粘贴、IME composition 和 Esc；粘贴或编辑换行不能把 Agent 误切到 `running`。
6. identity 测试覆盖旧 process epoch、错误 nonce、不同 provider session、上一 prompt 的延迟 Stop 和重复 Stop；这些事件不能结束当前回合。
7. Claude `StopFailure` 后节点保持可交互的 `waiting-input`，同时保存 failed outcome/error 并产生 attention；普通 Stop 不制造失败。
8. main-only staging 同时包含 lifecycle 与 file-activity runtime hook；任一运行路径缺少 lifecycle hook 时必须在启动前回退，不得产生 Claude hook error 或留下等待不存在 callback 的 Codex `running`。
9. Codex 输入测试覆盖“方向键 + Enter”的升级菜单序列不进入 `running`，以及可见文本/IME/粘贴后 submit 正常进入 `running`；Host 与 Supervisor owner 必须共享同一判定函数。
10. Claude launch integration 测试覆盖 `--safe-mode` 与 `--bare`：原始 argv 不被改写、不注入文件活动 env、lifecycle capability 为 disabled，且 fallback reason 可诊断。

## 9. 当前验证状态

- 2026-04-12 已完成设计研究，确认当前仓库仍处于 PTY 启发式阶段。
- 2026-04-12 已确认三类官方能力面：
  - `Codex app-server` 的结构化 turn/thread 事件。
  - `Claude Code` 的 SDK、headless `stream-json` 与 hooks。
  - VS Code shell integration 的 prompt/command 边界。
- 2026-04-13 已把共享启发式 helper 接入 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 与 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`，统一本地 PTY 与 runtime supervisor 的 `running -> waiting-input` 回退规则。
- 2026-04-13 已新增 smoke 回归，覆盖 spinner/redraw 持续输出期间不应过早回退到 `waiting-input`。
- 2026-06-10 曾补充 Claude Code `Ctrl-Z` 挂起输出识别；2026-06-11 已撤销该方向，不再把 suspend / `fg` 文案作为状态机输入。
- 2026-06-11 已补充 Claude Agent `Ctrl-Z` 阻断验证：Webview 阻止 `\u001a` 发送到 host，host 与 runtime supervisor 也拒绝旧客户端绕过前端的写入请求；该逻辑不影响 Terminal 或 Codex Agent 输入。
- 2026-07-14 已完成 Codex CLI 0.144.1 direct-TUI notify 实验：确认 `agent-turn-complete` payload 的 `thread-id + turn-id`、resume identity、notifier ACK 前后的 TUI 顺序，以及 Stop hook continuation 后只在最终完成时通知。
- 2026-07-14 已完成 Claude Code 2.1.209 hooks 实验：确认 `UserPromptSubmit/Stop` 的 `session_id + prompt_id`、Stop hook block 后的重复 Stop、Esc 不产生 Stop/StopFailure，以及约 60 秒后的 `Notification(idle_prompt)`。
- 2026-07-14 已完成 Claude repeated-settings 实验：`--settings A --settings B` 只有 B 的 hook 生效，因此正式实现采用单份合并 settings。
- 2026-04-13 已通过旧启发式阶段的以下验证：
  - `npm run typecheck`
  - `npm run build`
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs`
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/smoke/run-vscode-smoke.mjs`
  - `npm run test`
- 2026-07-15 已完成 provider lifecycle 正式实现并通过聚焦测试、类型检查、构建和 trusted VS Code smoke。smoke 中 hook-capable 假 Claude 的 3 秒静默回合在 2 秒检查点仍为 `running`，随后只由 `Stop` 进入 `waiting-input`；`StopFailure` 进入 `waiting-input` 的同时保存 failed/error 并触发 attention；异常进程退出通知仍然有效。
- 2026-07-15 已验证 Supervisor lifecycle callback 延迟到 2300ms 时，1600ms 检查点仍保持 `running`，callback 到达后才进入 `waiting-input`；旧 generation capability gate、错误 nonce/process epoch/runtime session、stale prompt/thread 和重复 completion 也均有自动化回归。
- 2026-07-15 的真实 main-only Host diagnostics 暴露两个回归：staged extension 漏复制 lifecycle hook，且 Codex 启动升级菜单的方向键 + Enter 被当成 prompt submit。本轮已让 main-only staging 复制完整 runtime scripts，在 adapter 启动前增加缺 hook fallback，并用共享 submission candidate 阻止控制序列/方向键后的纯 Enter 进入 `running`。debug staging、provider lifecycle、Supervisor protocol、typecheck、build、正式 VSIX 文件列表和 trusted VSCode smoke 全部通过，详细证据见 `docs/exec-plans/completed/agent-lifecycle-adapter-hardening.md`。
- 2026-07-17 的 PR review 发现 Claude `--safe-mode` / `--bare` 会合法禁用 hooks，但 launch integration 仍声明 lifecycle enabled。当前实现已在 settings 合并前识别两种模式，保留原始 argv 并以明确原因回退 heuristic；聚焦测试覆盖两种 flag、capability gate 与文件活动 env 不注入。
- 当前文档恢复为 `已验证`。保留风险包括 Codex 自定义 `notify` 冲突时必须 fallback、Claude Stop continuation 的短暂状态失真、Codex notifier ACK 顺序仍是实机约束，以及 completion-only direct TUI 无法完美识别“输入后完全删除”或不产生 provider turn 的本地 slash command；这些边界均已登记在技术债 tracker。
