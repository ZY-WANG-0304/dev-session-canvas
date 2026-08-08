---
title: Agent 与 Terminal 的 Terminal Title 展示
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
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
  - docs/exec-plans/active/execution-terminal-title-display.md
  - docs/exec-plans/active/agent-terminal-title-activity-signals.md
updated_at: 2026-08-08
---

# Agent 与 Terminal 的 Terminal Title 展示

## 1. 背景

嵌入式执行节点当前拥有两类稳定的标题栏信息：用户可编辑的画布节点标题，以及显示启动命令或 shell 路径的静态副标题。真实 terminal 还支持第三种不同来源的信息：shell、TUI 或 CLI 通过 PTY 的 OSC 0 / OSC 2 控制序列主动设置 terminal title。常见内容包括当前路径、正在运行的任务，或 Codex / Claude Code 维护的 spinner。

当前仓库已经解析 Agent OSC 0/2，用于谨慎地判断 provider title spinner 是否可作为 `waiting-input` 恢复到 `running` 的弱活动证据；该实现明确不保留 title 文本。现在需要把“显示当前 terminal title”作为独立能力交付给 Agent 与普通 Terminal，而不能让它破坏既有生命周期与隐私边界。

## 2. 问题定义

本轮要回答：如何让 title 随 PTY 会话更新并在 Webview reload/live-runtime reattach 后恢复，同时不覆盖用户的节点命名、不把高频 spinner 写成 state persistence 风暴，也不把 title 混入 output、journal、attention 或 lifecycle 语义。

## 3. 目标

- Agent 与 Terminal 节点显示当前会话的 OSC 0/2 terminal title。
- 让节点标题保持用户定义、可编辑且稳定；terminal title 只读且动态。
- 将动态 title 放在节点标题栏最上方的上下文行，而不是 subtitle 或终端内容区域；该行以 `{terminal title} · {root}` 展示，未设置或清空时只显示 `{root}`。
- 让 Local Host、Supervisor 与 Webview 对同一会话的当前 title 一致，并支持 snapshot/reattach。
- 支持 TUI 使用 xterm Window Operations 的 `CSI 21 t` 查询当前 window title，并从同一 PTY 输入方向获得规范的 `OSC l <title> ST` 报告。
- 沿用已有 OSC parser 的跨 chunk 与 payload 限制，限制 title 留存和传播范围。

## 4. 非目标

- 不把 terminal title 写回 shell、CLI、VS Code 原生终端或操作系统窗口。
- 不解析 OSC 1、OSC 7、OSC 9/777、OSC 133 或屏幕文本来猜 title、cwd、attention 或生命周期。
- 不实现 `CSI 20 t` icon label 查询，或其他移动、缩放、提升窗口等 Window Operations；本轮只处理 `CSI 21 t`。
- 不把任意 title 变化解释为 Agent `running`、`waiting-input`、完成或失败；Agent lifecycle 仍只使用既有版本化 provider profile。
- 不增加 title 编辑器、title 历史、全局 title 列表或跨会话搜索。

## 5. 候选方案

### 5.1 只让 Webview xterm 的 `onTitleChange` 更新 DOM

不选。实现很短，但 title 只存在当前 Webview，panel/editor 以及 Supervisor 无共同权威值，Webview 重建和 reattach 可能丢失或延迟显示。

### 5.2 用 terminal title 覆盖画布节点标题

不选。节点标题是用户为画布对象赋予的稳定身份；CLI title 可能每 100ms 变化、包含路径或任务，覆盖后会破坏空间识别与用户编辑结果。

### 5.3 Host/Supervisor 解析、标题栏上下文行展示、快照保留当前值

选定。PTY owner 在 raw chunk 层解析 title；Host output/snapshot 将当前规范化值交给 Webview；UI 把它合成到节点标题栏最上方的只读上下文行。稳定节点名、标题栏静态副标题、cwd/root 与动态 runtime title 保持独立，Supervisor snapshot 只携带当前值以支持 reattach。

## 6. 正式方案

### 6.1 Title transport 与规范化

`extensions/vscode/dev-session-canvas/src/common/executionTerminalTitle.ts` 是唯一的 title parser。它仅接受 OSC 0（icon + title）和 OSC 2（title）：`ESC ] <0|2> ; payload BEL`、`ESC ] <0|2> ; payload ESC \\` 与 C1 OSC/ST 都有效；允许控制序列在 PTY chunk 之间分割。未完成 payload 继续采用固定上限，非法控制字符使该序列失效而不污染下一段输出。

parser 的 title 先经过 `normalizeExecutionTerminalTitle()`：移除控制字符、折叠空白、trim，并按 Unicode code point 截断到 160 个字符。空结果是清除当前 title。最终显示值可以包含普通 Unicode（包括 provider spinner）；它不应再被当作 ANSI output 处理。

### 6.2 权威状态与生命周期边界

`ExecutionSessionMetadata.terminalTitle`、`RuntimeSupervisorSessionSnapshot.terminalTitle` 和本地/远端执行 session 内存字段只表示当前 live PTY 的最后一个规范化 title。它不等于 `CanvasNodeSummary.title`，不参与节点 overview/title input、recent output、terminal journal event、diagnostic event、attention notification 或 Agent provider lifecycle metadata。

在任何 output buffer、terminal journal、checkpoint、recent-output 或 Webview terminal 投影之前，共享 parser 会从已识别的 OSC 0/2 中删除完整控制序列及 payload。每个被删除的原始 PTY chunk 在安全输出中的原位置放入一个不可见 NUL 占位符，以保持 terminal-stream 的非空 event 与 revision 连续；NUL 会被终端模拟器忽略，并在面向人的 output 摘要前移除。分片 title payload 只在 live 内存中有界保存；超过上限后仅保留“继续丢弃至终止符”的状态，不能让后续 payload 回流到 durable output。只有当前规范化 title 继续按既有 live snapshot 三态规则短暂保存。

`CanvasPanelManager.ts` 在 Local PTY chunk 和 Supervisor output chunk 进入 output scheduler 前更新当前值。`runtimeSupervisorMain.ts` 在自己的 raw PTY owner 处做同样处理，并让 `toSnapshot()`/恢复路径保留它。title 仅在 session 仍存在时随常规 live-state sync 写入 metadata；新启动、停止、进程退出、删除和不再 live 的 history state 都清为 undefined。旧持久化 state/snapshot 没有这个 optional 字段时必须正常降级。

Agent title activity 继续由 `agentTerminalTitleActivity.ts` 调用同一个 parser，并仅用已验证的 Codex/Claude frame profile 得出 `sawTerminalTitleActivity`。通用 title 显示绝不能改变该 profile、也不能把普通 Terminal title 接入 Agent lifecycle reducer。

### 6.3 跨边界投影与性能

补充的快照契约：`host/executionSnapshot` 与 Supervisor snapshot 中的 `terminalTitle` 使用三态。字符串表示设置，`null` 表示当前 PTY 已确认清空，字段缺失表示旧端或不完整快照未提供 title 投影；缺字段不能覆盖 Webview 已知的同一 live session title。这样既会响应明确的 OSC 空 payload，又不会把兼容性缺失误判为清空。

`protocol.ts` 的 `host/executionOutput` payload 带 optional `terminalTitle`，值是当前合批 output 结束时的最新 title；`host/executionSnapshot` 也携带该字段。Supervisor 的 live `sessionTerminalEvent` 在 title 变化的那一个 event 上可带同样的可选值，但该字段不属于 journal event，replay 时由 snapshot 重新提供当前值。`CanvasPanelManager.ts` 将 title 同已有 output scheduler 的消息合批，只在规范化值改变时更新内存字段，禁止为每个 spinner frame调用 `postState()` 或单独持久化。常规 2.5 秒 live-state sync 和必要的 session 边界持久化仍会将最后一个值写入状态，确保 reload/reattach 可恢复。

`webview/main.tsx` 按 `nodeId + executionSessionId` 保存最新投影 title；snapshot 新 session 覆盖旧值，output 只更新同一 session。`toFlowNodes()` 将该 title 传给 `CanvasNodeData.terminalTitle`。`executionSessionNodes.tsx` 中的 `ChromeTitleEditor` 始终显示原有静态副标题：Agent 是启动命令，Terminal 是 shell path。两类节点都用现有 cwd 标签助手生成 `{root}`，并在 title 存在时把标题栏最上方上下文行组合为 `{terminal title} · {root}`；缺失、明确清空或会话结束后组合回 `{root}`。该行只读、可省略并提供完整 tooltip，不新增终端内容区控件或动画。

### 6.4 CSI 21 t 查询与 OSC l 报告

PTY 内的 TUI 将 `ESC [ 21 t`（C1 形式 `CSI 21 t` 也接受）写到输出流，表示查询当前 window title。Local Host 与 Runtime Supervisor 在各自拥有 PTY 的 raw output 边界增量识别这个精确请求；与 OSC 0/2 title 设置共享 carryover，并按控制序列在字节流中的真实顺序处理。因此同一个 chunk 中先设置 title 再查询时返回新值，先查询再设置时返回旧值。

每个查询立即向同一 live PTY 写回 7-bit 规范回答：非空 title 是 `ESC ] l <title> ESC \\`，未设置或已清空是 `ESC ] l ESC \\`。回复只使用已规范化、受长度上限限制且不含控制字符的内存 title，不单独创建 journal、recent output、诊断或 Webview 消息，也不会改变 terminal title、生命周期或用户输入队列；若 PTY 的 termios 配置主动回显输入，该回显仍按普通 PTY output 处理。Host 只为其本地 PTY 回答；Supervisor session 由 Supervisor 回答，避免 Host 在转发的远端 output 上重复回包。这样 Webview 被隐藏或正在 reattach 时查询仍可工作。

### 6.5 用户可见结果

节点标题栏保持三层信息：最上方上下文行默认显示 cwd/root；可编辑节点名在主行；启动命令或 shell 路径在静态副标题行。动态 terminal title 存在时，上下文行变为 `{terminal title} · {root}`，而不是改变对象身份或静态副标题。当前路径/运行任务/Agent spinner 随会话更新；用户改名不受影响。空 title、未设置 title 和结束态都不显示陈旧 title，而是回到 `{root}`。该行继续使用 `docs/UI.md` 的 VSCode theme token、现有省略和 tooltip 规则，不引入新的常驻状态色或动画。

## 7. 风险与取舍

- title 可能带路径或用户数据。为了支持 reattach，当前值在 live session snapshot 内短暂持久化；它不复制到 journal、诊断、通知、recent output 或历史 UI，并在会话终态清除。
- `CSI 21 t` 会让 PTY 中运行的程序读到当前 title，因此它是额外的信息披露面。回复只限当前 session 的已规范化 title，不包含 cwd/root、节点名、启动命令、shell 路径或历史 title；没有 title 时返回空报告。
- 有些 shell/CLI 不设置 OSC 0/2，或其 title 集成被用户关闭。功能在这种情况下安静地仅显示 `{root}` 上下文，不合成 `Terminal`、Agent、shell 路径或重复的 `{root} · {root}`，也不作错误提示。
- Agent spinner title 变化很快。实时展示复用已有 output 投影，避免高频 state broadcast/persist；UI 可能按既有 output scheduler 略微落后，但不改变终端输出顺序或输入优先级。
- title 的可见文本不是 provider API。它不能成为 completion、approval 或 generic Agent activity 的事实来源；生命周期 profile 仍只接受目前验证过的连续 frame。

## 8. 验证方法

自动化覆盖 parser 的 OSC 0/2 各种终止与分片方式、值规范化/上限/清空、持久化前 title payload 删除、`CSI 21 t` 的 7-bit/C1 与分片请求、设置/查询顺序、空 title 的 `OSC l ST` 回包、Host/Supervisor snapshot 对当前 title 的往返、Host/Webview output message，以及两种节点固定的静态副标题、默认 `{root}` 上下文与动态 `{terminal title} · {root}` 上下文选择。Supervisor 的真实 PTY fixture 必须证明 TUI 收到回包，且 live terminal-stream suffix、recent-output 与落盘 journal 都不含测试 title 文本。现有 Agent title activity、Supervisor protocol 与 Webview 回归必须保持通过。

人工验证：在 Terminal 节点输入 `printf '\033]2;Build API\a'` 后检查标题栏最上方上下文行变为 `Build API · {root}`，再用空 payload 清除并确认只保留 `{root}`；在 Codex/Claude Code Agent 执行会工作数秒的任务时，检查 provider title 更新但节点名和标题栏静态副标题不变。分别在 panel/editor、Webview reload 和 live-runtime reattach 后检查当前 title 仍一致。未在当前环境人工覆盖的平台应保留“验证中”状态。

## 9. 当前验证证据

2026-08-06 已通过 `npm run typecheck`、共享 parser/Agent activity 的 `npm run test:agent-terminal-title-activity`、Supervisor 快照的 `npm run test:runtime-supervisor-protocol`、协议的 `npm run test:protocol-webview-messages`、以及 `npm run test:webview -- --grep "PTY terminal titles"`。当时的 Webview 用例覆盖两类节点的动态 subtitle、空 title 回退、节点可编辑标题不变和旧会话 output 不能覆盖新会话 title；后续展示位置调整后的回归结果在本轮验证完成后补充。

2026-08-06 的 Codex Agent 反馈显示，回到可输入 TUI 时可能收到 title 缺失的 live snapshot 并使动态显示错误回退。现已将快照改为三态契约：Supervisor 对已知的空 live title 发 `null`；Host/Webview 只在收到字符串或 `null` 时更新同一会话的 title，缺字段保持当前投影；会话结束清除动态 title 前缀但保留 `{root}` 上下文。

三态回归已通过 `npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages` 和 `npm run test:webview -- --grep "PTY terminal titles"`。这覆盖 live 空 title 的 `null`、同一会话缺字段 snapshot 保持既有 title、显式 `null` 清空和已结束会话不留 title；展示位置调整后的 Webview 回归已于 2026-08-07 完成，真实 Extension Development Host smoke 仍待执行。

2026-08-07 已通过 `npm run typecheck`、`npm run test:agent-terminal-title-activity`、`npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "header context"`、其内部的 `npm run build` 与 `git diff --check`。新的 Webview 用例确认 Agent 与 Terminal 的静态副标题不被 title 改写，初始和显式 `null` 清空后只显示 `{root}`，非空 title 显示 `{terminal title} · {root}`，缺字段 snapshot 保持同一 session 的 title，节点可编辑名称不变。

2026-08-07 已通过 `npm run test:agent-terminal-title-activity`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "header context"`（含 `npm run build`）与 `git diff --check`。共享 parser 覆盖 7-bit/C1 `CSI 21 t`、分片请求、非目标 `CSI 20 t`、损坏 OSC 后继续识别 query、设置/查询事件顺序和空报告；Supervisor 的真实 node-pty fixture 在没有 Webview 的情况下先收到 `OSC l First title ST`，清空后收到空 `OSC l ST`。首次运行 Supervisor 全量回归时既有 attach-gap 并发断言出现一次时序失败；在未修改该逻辑的复跑中完整通过。

2026-08-08 根据 PR #280 review 修复 Supervisor 在解析前把原始 OSC 0/2 写入 journal 的确定性泄露。已通过 `npm run typecheck`、`npm run test:agent-terminal-title-activity`、`npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "header context"`（含 `npm run build`）与 `git diff --check`；新增真实 node-pty fixture 断言 title 文本不出现在 live terminal-stream suffix、Supervisor output tail 或已 flush 的 segment 文件，同时保留普通 marker 输出与 title query 回包。

尚未执行真实 Extension Development Host 中的 Terminal OSC 设置/清空、真实 Agent spinner、Webview reload 和 live-runtime reattach，因此本文的 `validation_status` 保持“验证中”。

本次修订说明：2026-08-07 用户要求支持 TUI 查询当前 terminal title。选用 xterm Window Operations `CSI 21 t` 与 `OSC l` 报告；由于 xterm.js 6 默认禁用该类操作且 `getWinTitle` 没有默认实现，查询由 Local Host / Supervisor 的 PTY owner 显式提供，而不依赖可见 Webview。

本次修订说明：2026-08-08 根据 PR #280 的确定性 journal 留存 blocker，在 shared output 边界删除 OSC 0/2 payload，并用不可见 NUL 保持 stream revision 对齐；live title 仍只通过非持久 event 投影和 snapshot 三态传递。
