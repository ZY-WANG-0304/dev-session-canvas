---
title: UI 侧 Notifier Companion 架构
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-node-notifications.md
related_plans:
  - docs/exec-plans/active/standard-monorepo-and-doc-knowledge-base.md
  - docs/exec-plans/active/cross-plan-coordination.md
updated_at: 2026-05-04
---

# UI 侧 Notifier Companion 架构

## 1. 背景

`Dev Session Canvas` 主扩展当前仍是 `extensionKind: ["workspace"]`。这意味着在 `Remote SSH`、Dev Container 或其他远端宿主场景里，主扩展负责解析执行节点输出、维护 `attentionPending` 权威状态、决定是否发提醒；但它并不总运行在用户眼前那台机器上。

已有设计文档 `docs/design-docs/execution-node-notification-and-attention-signals.md` 已经明确：如果后续要把执行节点注意力事件升级成真正的桌面系统通知，不应把 `notify-send`、`terminal-notifier` 或 Windows Toast 直接塞进当前 workspace 宿主，而应引入一个运行在本机 UI 侧的 notifier companion。

本次设计要把这条方向从“未来建议”收口成可实现的第一版架构：主扩展仍留在仓库根目录；notifier companion 先落到 `extensions/vscode/dev-session-canvas-notifier/`；共享通知协议先落到 `packages/attention-protocol/`。用户当前可验证的结果不是“所有平台都已经有完整桌面通知”，而是：主扩展能够把执行节点 attention event 发送给 companion；companion 能在本机 UI 侧接收结构化请求；测试环境里能够验证这条链路会在点击回调后重新聚焦节点并清除 attention 状态。

## 2. 问题定义

这一轮 notifier 开发需要解决四个问题：

1. 主扩展与 companion 之间用什么结构化载荷通信，才能避免继续把“终端输出副作用”当协议。
2. companion 在桌面场景里如何把结构化 attention event 变成本机系统通知，同时保持主扩展不依赖本地 OS 命令。
3. 当用户点击系统通知时，如何安全地回到 VS Code 并重新执行“聚焦节点 / 清除 attention”的主扩展命令。
4. 在 notifier 仍处于第一阶段验证时，怎样把代码先放到最终目录位置，而不要求主扩展同步迁移到 `extensions/vscode/dev-session-canvas/`。

## 3. 目标

- 形成一个独立的 UI-side companion extension，并把它放在计划中的最终目录：`extensions/vscode/dev-session-canvas-notifier/`。
- 形成一个最小共享协议包：`packages/attention-protocol/`。
- 让主扩展通过一个三级下拉配置统一控制 attention signal 的外部桥接面：`none` 不桥接、`workbench` 走 VS Code 工作台消息、`system` 优先把执行节点终端提醒投递给 companion，并在必要时回退到工作台消息。
- 为后续主扩展迁移到完整 monorepo 提前收口接口和目录，而不是先做临时 `notifier/` 目录。

## 4. 非目标

- 本轮不要求主扩展迁出仓库根目录。
- 本轮不要求 companion 已经覆盖所有 OS 的完整点击回调体验；第一版允许平台间存在“能力完整度不同”的现实差异，只要协议与回退链路明确。
- 本轮不引入 extension pack，也不自动要求用户一起安装 companion。
- 本轮不把 JSON Schema 自动生成、跨 IntelliJ 复用或更大的跨平台共享层一并实现。

## 5. 核心决策

### 5.1 目录策略：先混合结构，notifier 直接放最终位置

当前选定结构是：

- 主扩展继续留在仓库根目录
- notifier companion 落在 `extensions/vscode/dev-session-canvas-notifier/`
- 共享通知协议落在 `packages/attention-protocol/`
- 根 `package.json` 新增 `workspaces`，但根目录暂时仍保留主扩展 manifest 身份

这样做的好处是：notifier 不需要先经历“临时目录 -> 最终目录”的二次迁移；而主扩展目录大搬迁则可以延后到阶段 1.2 再做。

### 5.2 协议策略：显式结构化请求，而不是隐式 escape sequence

主扩展与 companion 之间的最小协议定义在 `packages/attention-protocol/src/index.ts`。当前只覆盖一类请求：`execution-attention`。

请求字段最小集合如下：

- `version`
- `kind`
- `title`
- `message`
- `dedupeKey`
- `focusAction`

其中 `focusAction` 当前收口成最简单、最稳定的形式：命令 ID + 字符串参数数组。这样 notifier companion 不需要理解画布内部状态机，只需要在用户点击通知后，回调主扩展公开的内部聚焦命令即可。

### 5.3 回调策略：URI handler 负责“回到 VS Code”

companion 使用 `vscode.window.registerUriHandler(...)` 注册自己的 URI handler，并把 `focusAction` 编码进 callback URI 中。原因有两个：

1. 对 Windows Toast、macOS `terminal-notifier` 这类支持 protocol / open-url 的通知后端，URI handler 是最自然的点击回调入口。
2. 即使未来从桌面通知点击时需要把 VS Code 从后台唤回前台，URI handler 仍然比“只在当前进程内直接 executeCommand”更稳定，也更接近真实用户路径。

Linux `notify-send --action --wait` 这一类后端，当前实现会在本地 companion 进程内直接执行 focus action；但 companion 仍然同步生成 callback URI，并在测试态用它验证回调链路。

### 5.4 主扩展回退策略：companion 优先，工作台通知兜底

主扩展新增配置：

- `devSessionCanvas.notifications.attentionSignalBridge`（默认 `workbench`）

当前语义是：

- `none`：不额外弹出工作台消息或系统通知，只保留节点内 attention 状态与诊断。
- `workbench`：完全保留既有工作台通知桥接语义，直接发 VS Code 工作台消息。
- `system`：先调用 companion 命令 `devSessionCanvasNotifier.postSystemNotification`；如果 companion 返回 `posted`，则本次不再重复弹 VS Code 工作台消息；如果 companion 缺失、当前平台不支持、或调用失败，则自动回退到工作台消息。

这让用户可以把当前配置理解为“用一个设置明确选择不桥接 / 工作台消息 / 系统通知”，同时继续保留 `system` 模式下的工作台兜底，避免因为本机 companion 缺失而静默丢提醒。

### 5.5 聚焦语义：系统通知点击必须清除 attention

主扩展新增内部命令 `devSessionCanvas.__internal.focusAttentionNode`。它不同于现有“仅定位节点”的内部命令：

- 会打开并聚焦当前节点
- 如果目标是执行节点，还会同步清除 `attentionPending`

这样 companion 不必直接碰宿主私有状态；它只要回调这条命令，就能复用主扩展已经确定的“聚焦即确认”语义。

## 6. 第一版实现分层

### 6.1 根主扩展

主扩展当前改动集中在：

- `src/panel/CanvasPanelManager.ts`
- `src/common/extensionIdentity.ts`
- `src/extension.ts`
- `src/sidebar/CanvasSidebarView.ts`

职责如下：

- 继续解析 `BEL` / `OSC 9` / `OSC 777`
- 继续设置 `attentionPending`
- 继续执行冷却与去重
- 继续在 companion 不可用时回退到工作台通知
- 新增 companion 配置读取、diagnostic event 与 focusAttention internal command

### 6.2 Companion extension

companion 当前放在 `extensions/vscode/dev-session-canvas-notifier/`，职责如下：

- 注册命令 `devSessionCanvasNotifier.postSystemNotification`
- 注册人工验收辅助命令 `Dev Session Canvas Notifier: 发送测试桌面通知` 与 `Dev Session Canvas Notifier: 打开通知诊断输出`
- 校验共享协议请求
- 为通知点击生成 callback URI
- 在桌面平台上把请求投递给本地系统通知后端
- 在输出面板里记录实际使用的通知后端、`activationMode` 与最近一次人工验收结果
- 在测试模式下使用 in-memory backend 记录已投递请求，并暴露 `__test` 命令用于 smoke 验证

### 6.3 平台通知后端

当前后端策略是“能 best-effort 落地就落地，但不把平台差异藏成假象”：

- Linux：`notify-send`；若支持 `--action --wait`，则用 action 回调 focus；否则退化为只发通知
- macOS：优先 `terminal-notifier`（若存在且可用），否则退回 `osascript display notification`
- Windows：PowerShell 生成 Toast XML，并用 protocol activation 指向 companion URI handler
- 测试模式：不碰真实系统通知，直接记录请求并返回 `posted`

companion 还额外暴露 `devSessionCanvasNotifier.notifications.playSound` 开关，默认开启。它只负责“是否请求提示音”，不改变通知路由和回调语义；实际是否响铃仍保持 best-effort，并继续受平台后端与系统通知服务约束。

companion 当前会把点击回调能力显式收口成 `activationMode`：

| `backend` | `activationMode` | 含义 |
| --- | --- | --- |
| `linux-notify-send` | `direct-action` | 当前桌面环境支持 `notify-send --action --wait`，点击通知可直接回调 focus action |
| `linux-notify-send` | `none` | 已退化成“只发通知”，人工验收只要求确认通知出现 |
| `macos-terminal-notifier` | `protocol` | 通过 `terminal-notifier -open` 回到 VS Code URI handler |
| `macos-osascript` | `none` | 只保证 `display notification` 出现，不承诺点击回跳 |
| `windows-toast` | `protocol` | 通过 Toast protocol activation 回到 VS Code URI handler |
| `test` | `test-replay` | 仅用于 smoke / extension test，回放 callback URI 验证链路 |

## 7. 风险与当前缓解

- 风险：不同平台对“点击通知 -> 回到 VS Code”的支持度不一致。
  当前缓解：协议、URI handler、主扩展 focus 命令已经固定；平台能力不足时允许退化，但不改变主扩展状态机。

- 风险：companion 与工作台通知同时弹出，导致噪音。
  当前缓解：只要 companion 返回 `posted`，主扩展就不再重复发 VS Code 工作台通知；只有 companion 不可用或失败时才回退。

- 风险：主扩展还没迁到 `extensions/vscode/dev-session-canvas/`，仓库会出现一段“混合结构”。
  当前缓解：这是当前阶段的显式决策；通过 `workspaces`、独立子包 README 和架构文档说明，把这种中间状态当作受控阶段，而不是无意的半成品。

## 8. 验证方法

当前版本至少需要以下验证：

1. `npm run typecheck`
2. `npm run typecheck:notifier`
3. `npm run build`
4. `npm run build:notifier`
5. `npm run test:attention-protocol`
6. `npm run test:notifier-source`
7. `npm run test:notifier-smoke`

第 7 条是当前最关键的验证：它在同一个 VS Code Development Host 内同时加载主扩展和 notifier companion，验证“主扩展发 companion 请求 -> companion 记录请求 -> companion 回放 focus callback -> 主扩展聚焦并清除 attention”这一整条链路。

真实桌面通知的人工验收，则统一使用 companion 自带命令：

1. 在本机 VS Code 中安装并启用 `Dev Session Canvas Notifier`
2. 运行 `Dev Session Canvas Notifier: 发送测试桌面通知`
3. 若提示的 `activationMode` 为 `direct-action` 或 `protocol`，点击系统通知，确认 VS Code 弹出“已收到测试通知点击回调”并在输出面板留下记录
4. 若提示的 `activationMode` 为 `none`，则本轮只验“桌面通知确实出现”，并在 `Dev Session Canvas Notifier` 输出面板确认退化原因
5. Linux / macOS / Windows 三个平台都要记录实际 `backend`、`activationMode` 与是否出现点击回调，避免把退化路径误写成完整能力

若开发窗口本身运行在 `Remote SSH` / WSL / Dev Container 上，还应额外验证“远端主扩展 + 本机 UI notifier”的调试拓扑：

1. 主扩展继续通过远端 `folder-uri` 启动
2. notifier companion 改从本机 clone 路径注入 Development Host
3. 在同一个 Development Host 中用 `Developer: Show Running Extensions` 确认主扩展运行在 workspace 侧、notifier 运行在 UI 侧
4. 再执行 `Dev Session Canvas Notifier: 发送测试桌面通知`，确认 UI-side companion 命令确实可见
5. 如果当前发起调试的是本地 clone 窗口，则必须使用 `Run Remote Main + Local Notifier (Prompt from Local Window)`，并显式输入远端 repo 根目录 `remoteWorkspacePath`；不要把本机 `${workspaceFolder}` 误当成远端路径

## 9. 当前验证状态

截至 2026-05-04，本设计对应的第一版实现已完成以下仓库内验证：

- `npm run typecheck`
- `npm run typecheck:notifier`
- `npm run build`
- `npm run build:notifier`
- `npm run test:attention-protocol`
- `npm run test:notifier-source`
- `npm run test:notifier-smoke`

同时，本轮已补齐人工验收支撑：

- notifier companion 新增测试桌面通知命令，可直接在真实桌面环境触发一次通知
- notifier companion 新增诊断输出，可记录实际 `backend`、`activationMode` 与最后一次人工验收结果
- 主扩展 diagnostic event 会同步记录 companion 返回的 `activationMode`，避免把“通知已发出”误读成“通知必然可点击回跳”
- 远端联调场景新增 `Run Remote Main + Local Notifier (Prompt)`，把 `Remote SSH` / WSL / Dev Container 下的 workspace 主扩展与本机 UI notifier 明确拆成两条开发态路径，并将启动输入收口到 `remoteAuthority` + `localRepoRoot`
- 当联调入口本身来自本地 clone 窗口时，额外提供 `Run Remote Main + Local Notifier (Prompt from Local Window)`，要求显式输入 `remoteWorkspacePath`，避免把本机 `${workspaceFolder}` 误拼成远端 `folder-uri`
- 用户已在 macOS、Windows、Linux 三类本机环境完成真实桌面通知人工验收；其中 macOS 先确认过 `macos-osascript + activationMode=none` 退化路径，随后在安装 `terminal-notifier` 后完成 `macos-terminal-notifier + protocol` 主路径验证
- 用户已完成 `Remote Main + Local Notifier` 联调拓扑人工验收，确认 workspace-side 主扩展与 UI-side notifier companion 可在同一 Development Host 中协同工作

因此，本设计现从 `验证中` 调整为 `已验证`：notifier companion 的协议、回调链路、跨平台本机通知路径与远端主扩展 + 本机 UI notifier 的调试拓扑都已获得自动化与人工证据闭环。用户安装路径、extension pack 与发布策略仍可继续在其他计划中演进，但它们不再阻塞本设计的架构正确性判断。
