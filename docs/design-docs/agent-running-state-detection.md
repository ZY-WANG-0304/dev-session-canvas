---
title: Agent 运行态判定与等待输入信号设计
decision_status: 已选定
validation_status: 验证中
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
  - docs/exec-plans/active/agent-running-state-detection.md
updated_at: 2026-04-13
---

# Agent 运行态判定与等待输入信号设计

## 1. 背景

当前仓库已经把 `Agent` 节点的目标状态语义定义为：

- `running`：Agent 正在处理用户刚提交的一轮指令，或者仍处在当前回合的连续输出阶段。
- `waiting-input`：Agent 已结束当前回合，正在等待下一条用户输入。

但现有实现还没有接入 provider 原生的 turn/session 信号，所以宿主只能靠 PTY 行为推断：

- `src/panel/CanvasPanelManager.ts` 的 `writeExecutionInput()` 里，只要写入的数据包含回车或换行，就把状态切到 `running`。
- 同文件的 `handleSessionChunk()` 与 `queueAgentWaitingInput()` 会在输出 380ms 静默后，把 `running` 退回 `waiting-input`。

这个方案能缓解“只要一有输入就一直是 running”的明显错误，但仍然不是成熟方案。它实际观察到的是“PTY 最近发生了什么”，不是“provider 自己认定当前回合处在什么阶段”。

## 2. 问题定义

本设计需要回答四个问题：

1. `Agent` 的 `running` 与 `waiting-input` 应该以什么信号为正式判定依据，才能和真实 provider 语义对齐。
2. 当 provider 提供多种信号面时，宿主应该优先相信哪一层。
3. 当 provider 缺少权威事件时，哪些退化路线仍然值得保留，哪些不应被误写成正式能力。
4. UI 和诊断如何区分“节点当前状态值”和“这个状态值的判定权威性”。

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

## 7. 当前结论

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

- 长期方案优先使用官方 `app-server` 事件。
- 当前版本仍保持 interactive CLI PTY 作为执行主通道；`app-server` 被单独登记为后续特性，不属于本轮 BUG 修复范围。
- `turn/started` 可映射到 `running`。
- `turn/completed` 可映射回 `waiting-input`，或在附带退出/错误语义时映射到 `stopped` / `error`。
- `thread/status/changed` 与 `activeFlags.waitingOnApproval` 说明线程还有更细粒度活动态；这些信号当前先作为诊断与未来细分状态储备，不在本轮直接扩展主状态枚举。

`Claude Code`

- 当前公开材料更适合走 SDK、headless `stream-json` 或 hooks。
- 这说明 plain interactive TTY 模式下，如果不额外开启这些正式接口，宿主很难拿到权威 turn 边界。
- 这里的“很难”是根据官方文档现状作出的实现推断，而不是 Anthropic 明示的限制。

### 7.4 数据模型结论

后续实现中，节点 metadata 至少需要新增两层信息：

- `activitySource`：当前状态由什么来源驱动，例如 `provider-event`、`provider-structured-output`、`shell-integration`、`heuristic`。
- `activityAuthority`：当前来源是 `authoritative`、`derived` 还是 `best-effort`。

这样即使用户看到的主状态仍然是 `running`，宿主和 UI 也能明确区分“这是 provider 自己说的”还是“这是我们从 PTY 文本猜的”。

### 7.5 当前已实现的 fallback

在 provider 原生事件尚未接入前，当前仓库已把原来的“固定 380ms 静默回退”升级为组合启发式，并同时接入本地 PTY 路径与 runtime supervisor 路径：

- 只有当用户真正提交一条指令时，也就是输入里出现 `\r` 或 `\n` 时，`Agent` 才会切到 `running`。
- `waiting-input` 不再只靠单一 quiet timeout，而是综合以下线索判断：
  - prompt-like 尾部输出；
  - `OSC 9` / `OSC 777` 通知；
  - bell；
  - 长静默 hard fallback。
- 普通换行本身不再被当成“当前回合已完成”的直接信号；因为长任务可能先输出一整行文本，再在静默期内继续执行。
- 若最近输出呈现 spinner 或 redraw 特征，例如 `\r` 覆写、退格或光标移动控制序列，则会延长回退窗口，避免 Agent 仍在工作时被过早判回 `waiting-input`。

这一版仍然属于 `heuristic` / `best-effort`，只是把误判窗口从“固定静默时间”收紧为“多信号综合判断”。

## 8. 验证方法

至少需要完成以下验证：

1. 对接入官方事件面的 provider，自动化测试能证明 `turn start -> running`、`turn complete -> waiting-input` 的状态迁移。
2. 当 provider 原生事件与 PTY 启发式冲突时，自动化测试能证明前者优先。
3. 当 provider 仅有结构化输出或 hooks 时，自动化测试能证明节点仍可稳定落到 `running` / `waiting-input`，且 metadata 会标明来源。
4. 当 provider 没有任何正式接口时，节点仍可通过 fallback 工作，但诊断中能明确看到其为 best-effort。

## 9. 当前验证状态

- 2026-04-12 已完成设计研究，确认当前仓库仍处于 PTY 启发式阶段。
- 2026-04-12 已确认三类官方能力面：
  - `Codex app-server` 的结构化 turn/thread 事件。
  - `Claude Code` 的 SDK、headless `stream-json` 与 hooks。
  - VS Code shell integration 的 prompt/command 边界。
- 2026-04-13 已把共享启发式 helper 接入 `src/panel/CanvasPanelManager.ts` 与 `src/supervisor/runtimeSupervisorMain.ts`，统一本地 PTY 与 runtime supervisor 的 `running -> waiting-input` 回退规则。
- 2026-04-13 已新增 smoke 回归，覆盖 spinner/redraw 持续输出期间不应过早回退到 `waiting-input`。
- 2026-04-13 已通过以下验证：
  - `npm run typecheck`
  - `npm run build`
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs`
  - `npm run test`
- 当前文档保持 `验证中`，因为长期目标中的 provider 原生事件、结构化 sidecar 与 metadata 权威性字段尚未接入；已验证的是当前这版 CLI PTY fallback 改良方案。
