---
title: Agent 与 Terminal 的 PTY Terminal Title 展示
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/execution-terminal-title-support.md
updated_at: 2026-09-15
---

# Agent 与 Terminal 的 PTY Terminal Title 展示

## 背景

Agent 和普通 Terminal 都在 PTY 中运行。shell、TUI 或 CLI 可以通过 ANSI OSC 0 / OSC 2 设置窗口标题，但当前执行链路只把这些字节当成普通输出处理。结果是标题不能展示；如果直接把它转发给终端输出或 journal，标题文本还会污染屏幕、recent output、checkpoint 和持久化日志。

## 目标

- 在 Agent 和 Terminal 节点标题栏顶部的只读 context row 显示当前 PTY title 与 workspace root。
- 保留用户可编辑的节点标题、Agent 启动命令副标题和 Terminal shell path 副标题。
- 让 Local Host、Runtime Supervisor 和 Webview 对同一 live session 使用同一个动态 title。
- 支持 TUI 发送 `CSI 21 t` 查询当前 title，并由实际 PTY owner 回写 `OSC l <title> ST`。
- 让 OSC title payload 和查询控制序列不进入终端可见输出、recent output、terminal stream、checkpoint 或 journal。

## 非目标

- 不用 PTY title 覆盖用户的 Canvas 节点标题。
- 不把 title 变化解释为 Agent lifecycle、attention、完成或失败信号。
- 不实现 `CSI 20 t` 或其他窗口操作，不解析 OSC 1、OSC 7、OSC 9/777、OSC 133。
- 不保存 title 历史，也不把 title 内容复制到终端 journal 的 output event。

## 正式方案

### 共享解析与安全输出

`extensions/vscode/dev-session-canvas/src/common/executionTerminalTitle.ts` 提供无宿主依赖的增量处理逻辑。它识别 7-bit 与 C1 OSC 0 / OSC 2、BEL、7-bit ST（`ESC \`）和 C1 ST，以及 7-bit 与 C1 `CSI 21 t`，并允许这些控制序列在任意 PTY chunk 边界分片。

title 经过移除控制字符、折叠空白、trim，并限制为 160 个 Unicode code point。空 payload 表示清空当前 title。处理结果同时返回按真实顺序排列的 title 设置/查询事件，以及安全的 terminal output。完整 title 控制序列和 `CSI 21 t` 被移除；尚未完成分类的非空 chunk 使用不可见 `NUL` marker，保证 journal 的每个 revision 仍有非空 output record。未完成的 title payload 在看到终止符前按 fail-closed 规则继续消费其中的控制字节；过长 payload 只保存有限 carryover，并继续丢弃到终止符，不能让可能属于 title 的文本回流到 durable output。这样可避免 malformed OSC 通过“提前回退”泄露 payload，但也意味着缺少终止符时，后续输出会暂时被丢弃。

### Host 与 Supervisor 边界

`CanvasPanelManager.ts` 在 Local PTY 的 `handleSessionChunk` 与 `handleTerminalChunk` 中先调用共享处理器，再把安全 output 写入 `buffer`、`SerializedTerminalStateTracker`、line context、recent output 和 output scheduler。查询报告直接写回同一个 local PTY，不经过 Webview 输入队列。

`runtimeSupervisorMain.ts` 在 `bindSessionProcess` 的串行 terminal operation 中先安全化 raw PTY chunk，再执行 `TerminalSessionJournal.appendOutput()`、更新 tracker、保存 output tail 和发布 stream/legacy event。Supervisor 自己处理查询，因此 Host 转发远端 output 时不会重复回包。Supervisor snapshot 只在 live session 内传递当前 title；终态和恢复为 dead PTY 的 session 清除 title。

### 三态消息与 Webview 投影

`terminalTitle` 在 live snapshot、output 和 terminal event 中遵循三态：

- 字符串：当前规范化 title；
- `null`：明确确认 title 已清空；
- 字段缺失：旧 Host/Supervisor 或不完整快照没有提供 title，不能误清空同一 live session。

`webview/main.tsx` 按 `nodeId + executionSessionId` 保存 title projection。新 session 的 snapshot 覆盖旧 session；旧 session 的迟到 output、title event 和终态消息不能覆盖新 session。`toFlowNodes()` 将只读 title 传给 `CanvasNodeData`。`executionSessionNodes.tsx` 使用已有 `ChromeTitleEditor` context row，显示 `{terminal title} · {root}`，没有 title 或 session 结束时显示 `{root}`。

`ExecutionSessionMetadata.terminalTitle` 只在 live/reattaching 状态保留最后一个规范化值，以便 Host 状态和 Supervisor registry 支持重连；它不进入 terminal output、recent output、journal event 或诊断文本，非 live 状态清除。

### 查询回包

对 `ESC [ 2 1 t` 和 C1 `CSI 21 t`，owner 立即向同一个 PTY 写回：

- 有 title：`ESC ] l <title> ESC \`；
- 无 title：`ESC ] l ESC \`。

回包只使用内存中的规范化 title，不创建 journal/output/diagnostic/title 状态。设置与查询出现在同一个 chunk 时按控制序列顺序处理：先设置后查询返回新值，先查询后设置返回旧值。

## 风险与取舍

- PTY title 可能包含路径或任务描述。为支持 live runtime reattach，当前值可短暂随 live state/registry 传递；title payload 本身不会进入终端日志或历史输出。
- 旧 Supervisor 可能不认识 `terminalTitle` 字段。字段缺失被视为未知而不是清空，Host 仍对转发的 raw output 做兼容性安全处理。
- title-only chunk 需要 revision 连续性，因此使用 NUL marker；NUL 对终端显示不可见，摘要计算会过滤。
- title 高频变化复用已有 output batching 和定时 state sync，不为每一帧单独广播完整 Canvas state。

## 验证方法

- 运行共享 parser 测试，覆盖 OSC 0/2、BEL/ST/C1、分片、规范化、清空、查询顺序、查询报告和安全 output。
- 运行 Runtime Supervisor protocol 测试，使用真实 `node-pty` fixture 验证分片 title、`CSI 21 t` 回包、snapshot 三态、stream suffix、output tail 和 journal 不含 title payload。
- 运行协议类型测试和 Webview Playwright 测试，验证 Agent/Terminal context row、静态副标题、用户节点标题、旧 session 隔离、缺字段兼容和显式清空。
- 在真实 Extension Development Host 中用 `printf '\033]2;Build API\a'` 和空 payload 做手工复验；该路径不由本设计文档声称已完成，需以实际命令结果更新验证状态。

## 当前验证证据

2026-09-15 已通过 `npm run typecheck`、`npm run test:execution-terminal-title`、
`npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages`、
`npm run build`、`node scripts/test/run-playwright-webview.mjs --grep "PTY terminal titles"` 和
`git diff --check`。共享 parser 覆盖超长未闭合 payload 中包含换行、嵌套 ESC 控制字符以及分片
`ESC \` 终止符的 fail-closed 脱敏；Runtime Supervisor 的真实 `node-pty` fixture 覆盖分片
OSC title、`CSI 21 t` / `OSC l` 查询回包、显式清空、output tail、terminal stream suffix
和 journal 脱敏；Webview 回归额外确认新 session 建立后旧 session 普通 output 不会重新写入终端。

仍未执行真实 Extension Development Host 中的手工 title 设置/清空、真实 Agent provider spinner、
Webview reload 和跨 VS Code 生命周期 live-runtime reattach，因此 `validation_status` 继续保持
“验证中”，上述行为不能被描述为已完成的宿主级验收。
