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
updated_at: 2026-05-06
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
- 本轮不引入独立的第三个 extension pack 扩展包；用户安装路径改由“主扩展 `extensionPack` 聚合 notifier + notifier 单向 `extensionDependencies` 回补主扩展”收口。
- 本轮不把 JSON Schema 自动生成、跨 IntelliJ 复用或更大的跨平台共享层一并实现。

## 5. 正式方案

### 5.1 方案总览

当前正式方案把 notifier 明确收口成“主扩展负责 workspace-side 权威状态，companion 负责 UI-side 本机桌面通知”的双扩展协作模型：

- `src/extension.ts` 与 `src/panel/CanvasPanelManager.ts`：继续作为主扩展入口，负责解析执行节点 attention signal、维护 `attentionPending`、决定是否桥接提醒，并在通知回跳后执行聚焦与清除 attention。
- `extensions/vscode/dev-session-canvas-notifier/src/extension.ts`：作为 UI-side companion 入口，负责校验结构化请求、选择本机通知后端、维护 pending focus token、注册 URI handler，并记录诊断输出。
- `packages/attention-protocol/src/index.ts`：作为两侧共享协议单一真相，定义请求结构、回调动作、返回结果与测试命令约束。

两侧协作只通过结构化协议、VS Code commands 与受控 callback URI 完成，不通过 `activate()` 导出的 JS API 直连，也不让 notifier 直接写入画布内部状态。

### 5.2 适用范围与边界

- 本方案适用于 VS Code 的 local / remote 双 host 运行模型，尤其是 workspace-side 主扩展与 UI-side companion 分居两侧的 `Remote SSH`、WSL、Dev Container 场景；不覆盖 IntelliJ 插件或仓库外的泛用桌面通知框架。
- notifier companion 只负责 best-effort 地把 attention 事件投递到本机系统通知，并在平台能力允许时触发回跳；`attentionPending` 的权威状态、节点聚焦语义和去重冷却规则仍只归主扩展所有。
- repo-local staged smoke / VSIX smoke 可能为了装配 wrapper 临时移除 `extensionDependencies` / `extensionPack`；这些自动化验证“功能链路是否打通”，不直接等价于 Marketplace / VSIX 正式安装时的自动补齐链路证据。
- 第一版允许不同平台在点击回调能力上存在 `direct-action`、`protocol`、`none` 三种能力差异；平台退化需要被显式暴露，而不是被伪装成“所有平台都已完整支持”。

### 5.3 核心规则与不变量

- 正式安装真相固定为“主扩展 `extensionPack` 聚合 notifier + notifier 单向 `extensionDependencies` + `api:none`”；跨 host 协作必须依赖异步 commands 和结构化协议，而不是额外引入跨扩展 JS API。
- 外部通知系统看到的 callback URI 只能携带一次性 token；真实 `focusAction` 只能保存在 companion 内部 pending table 中，避免把任意命令载荷直接暴露给 OS 通知层。
- 用户点击系统通知后，最终只能回到主扩展的 `devSessionCanvas.__internal.focusAttentionNode` 或 notifier 自己的测试确认命令；notifier 不得直接改写画布状态，也不得新增未登记的回调动作白名单。
- `devSessionCanvas.notifications.attentionSignalBridge=system` 时，只有 companion 缺失、平台不支持或调用失败才允许回退到工作台消息；一旦 companion 返回 `posted`，主扩展就不得再重复弹工作台通知。
- 开发态主扩展单调试可以临时去掉 notifier 依赖，但该动作只能发生在 `.debug/vscode-extension-main-only/` 这类 debug-only 副本，不得回写正式 manifest。

### 5.4 目录策略：先混合结构，notifier 直接放最终位置

当前选定结构是：

- 主扩展继续留在仓库根目录
- notifier companion 落在 `extensions/vscode/dev-session-canvas-notifier/`
- 共享通知协议落在 `packages/attention-protocol/`
- 根 `package.json` 新增 `workspaces`，但根目录暂时仍保留主扩展 manifest 身份

这样做的好处是：notifier 不需要先经历“临时目录 -> 最终目录”的二次迁移；而主扩展目录大搬迁则可以延后到阶段 1.2 再做。

### 5.5 协议策略：显式结构化请求，而不是隐式 escape sequence

主扩展与 companion 之间的最小协议定义在 `packages/attention-protocol/src/index.ts`。当前只覆盖一类请求：`execution-attention`。

请求字段最小集合如下：

- `version`
- `kind`
- `title`
- `message`
- `dedupeKey`
- `focusAction`

其中当前执行节点 attention 的正式文案组成是：

- `title`：`DSCanvas · <workspace> · Agent|Terminal`
- `message`：`Agent|Terminal「<节点显示名>」: <终端信号消息>`，若信号未携带文本则回退成“发出终端提醒 / 通知”

`focusAction` 当前仍收口成最简单、最稳定的形式：命令 ID + 字符串参数数组。这样 notifier companion 不需要理解画布内部状态机，只需要在用户点击通知后，回调主扩展公开的内部聚焦命令即可；但真正暴露给外部通知系统的 callback URI 不再直接携带这段动作载荷，而是只携带 companion 侧登记的一次性 token。

### 5.6 回调策略：URI handler 负责“回到 VS Code”

companion 使用 `vscode.window.registerUriHandler(...)` 注册自己的 URI handler，但 callback URI 只会携带一次性 token；真实 `focusAction` 会先登记到 companion 内部的 pending table，并在回调时按 token 查表执行。这样可以避免把任意命令载荷直接暴露给外部通知系统，同时仍保留 URI handler 作为真实点击路径。原因有两个：

1. 对 Windows Toast、macOS `terminal-notifier` 这类支持 protocol / open-url 的通知后端，URI handler 是最自然的点击回调入口。
2. 即使未来从桌面通知点击时需要把 VS Code 从后台唤回前台，URI handler 仍然比“只在当前进程内直接 executeCommand”更稳定，也更接近真实用户路径。

Linux `notify-send --action --wait` 这一类后端，当前实现会在本地 companion 进程内直接执行 focus action；但 companion 仍然同步生成 callback URI，并在测试态用它验证回调链路。无论是直接执行还是 URI 回调，companion 当前都只接受当前设计明确允许的两类动作：主扩展的 `devSessionCanvas.__internal.focusAttentionNode`，以及 notifier 自己的测试确认命令。

### 5.7 主扩展回退策略：companion 优先，工作台通知兜底

主扩展新增配置：

- `devSessionCanvas.notifications.attentionSignalBridge`（默认 `system`）

当前语义是：

- `none`：不额外弹出工作台消息或系统通知，只保留节点内 attention 状态与诊断。
- `workbench`：完全保留既有工作台通知桥接语义，直接发 VS Code 工作台消息。
- `system`：先调用 companion 命令 `devSessionCanvasNotifier.postSystemNotification`；如果 companion 返回 `posted`，则本次不再重复弹 VS Code 工作台消息；如果 companion 缺失、当前平台不支持、或调用失败，则自动回退到工作台消息。

这让用户可以把当前配置理解为“用一个设置明确选择不桥接 / 工作台消息 / 系统通知”。默认值收口到 `system`，因为 notifier companion 已经跟随主扩展自动安装，而 `Remote SSH` / WSL / Dev Container 这类“执行发生在 workspace 侧、提醒应回到本机桌面”的场景正是这条链路的主价值；同时继续保留 `system` 模式下的工作台兜底，避免因为本机 companion 缺失而静默丢提醒。

### 5.8 安装策略：主扩展 `extensionPack` 聚合 + notifier 单向依赖回补

当前选定的安装策略是：

- 主扩展 `devsessioncanvas.dev-session-canvas` 在仓库根 `package.json` 中声明 `extensionPack: ["devsessioncanvas.dev-session-canvas-notifier"]`
- notifier companion 在 `extensions/vscode/dev-session-canvas-notifier/package.json` 中继续声明 `extensionDependencies: ["devsessioncanvas.dev-session-canvas"]`
- 两个扩展都显式声明 `"api": "none"`，因为跨 host 协作只依赖异步 VS Code commands，而不依赖 `activate()` 导出的 JS API

这样做的原因是：

- 用户从主扩展 Marketplace / VSIX 页面安装时，VS Code 会顺带安装 notifier，不需要额外理解 companion 的安装步骤
- 用户从 notifier 页面单独安装时，VS Code 仍会通过单向 `extensionDependencies` 自动补齐主扩展
- 主扩展运行时本就允许 companion 缺失后回退到工作台通知，因此安装期聚合不应伪装成运行时硬依赖；把“随主扩展一起安装”与“notifier 自身必须依赖主扩展”拆开表达，更符合 VS Code 官方语义
- 仍然保持两个独立 VSIX，与当前“主扩展负责画布与 attention 判定、notifier 负责本机桌面通知”的分层一致
- 避免 `A -> B -> A` 的 manifest 环，防止 Development Host / 已安装扩展在解析依赖时直接把两个扩展一起禁用
- 在 `Remote SSH` / Dev Container 一类跨 host 场景里，也继续符合 VS Code 对“安装期 pack + 运行期 commands 协作 + 必要时单向依赖”的能力边界

需要单独说明的是：repo-local 的 smoke host / VSIX smoke 为了在同一个 Development Host 中装配 wrapper，会在 staged 测试副本里临时移除 `extensionDependencies` / `extensionPack`。这不改变正式 manifest 的安装策略，但意味着“真实安装时是否自动补齐依赖”仍应通过 clean profile / Marketplace / VSIX 安装步骤单独复核，而不是把 staged smoke 当成直接证据。

### 5.9 开发态调试策略：用 debug-only 主扩展目录隔离 notifier 依赖

即使正式安装关系已经改成“主扩展 `extensionPack` + notifier 单向 `extensionDependencies`”，开发态 `Run Dev Session Canvas (Main Only)` 仍然会在启动前生成一份 debug-only 的临时主扩展目录，把安装期关系从调试副本中剥离，避免单调主扩展时把 notifier 的安装语义混入当前 Development Host：

- 临时目录位于 `.debug/vscode-extension-main-only/`
- 目录内容来自当前仓库根主扩展的开发产物与运行时资源
- 临时 `package.json` 会移除 `extensionDependencies` / `extensionPack`

因此，当前三类调试场景分别是：

- `Run Dev Session Canvas (Main Only)`：本地 / 远端窗口统一使用；只调主扩展，不加载 notifier
- `Run Dev Session Canvas + Notifier (Local Window)`：本地窗口联调真实主扩展 + 真实 notifier
- `Run Dev Session Canvas + Notifier (Remote Window)`：远端仓库窗口联调远端主扩展 + 本机 notifier；只额外要求输入本机 `localRepoRoot`

这样可以同时满足三个约束：

- 正式 `package.json` 继续保持“主扩展 `extensionPack` + notifier 单向 `extensionDependencies`”的安装真相，不为调试改写发布口径
- 单独调主扩展时，不需要额外先安装或加载 notifier
- 从远端仓库窗口发起主扩展单调时，继续保持 `Run Dev Session Canvas (Main Only)` 的零输入体验；只有远端联调 notifier 时才额外要求本机 `localRepoRoot`

### 5.10 聚焦语义：系统通知点击必须清除 attention

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
- 其中手动测试桌面通知的标题固定为 `DSCanvas · Notifier`，与执行 attention 通知的 `DSCanvas` 前缀保持一致
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

第 7 条是当前最关键的验证：它需要在同一个 VS Code Development Host 内同时加载主扩展和 notifier companion，验证“主扩展发 companion 请求 -> companion 记录请求 -> companion 回放 focus callback -> 主扩展聚焦并清除 attention”这一整条链路。2026-05-05 起，这条 smoke 已改为通过 staged smoke host + notifier wrapper 同时装配两侧扩展，并借助 `DEV_SESSION_CANVAS_SMOKE_TEST_MODE` 继续暴露测试命令，latest head 可稳定复现通过。

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
5. 当前远端 notifier 联调只支持“从远端仓库窗口发起”的 `Run Dev Session Canvas + Notifier (Remote Window)`；不要在本地 clone 窗口里手工把 `${workspaceFolder}` 误当成远端路径

## 9. 当前验证状态

截至 2026-05-05，本设计对应的第一版实现已确认以下仓库内验证：

- `npm run typecheck`
- `npm run typecheck:notifier`
- `npm run build`
- `npm run build:notifier`
- `npm run test:attention-protocol`
- `npm run test:notifier-source`
- `npm run test:notifier-smoke`
- `npm run test:smoke-storage-slot`
- `npm run test:vsix-smoke`
- `npm run test:smoke`

其中，`npm run test:notifier-smoke` 在 2026-05-05 的 latest head 复核里已恢复通过。此前 `tests/vscode-smoke/notifier-companion-tests.cjs:32` 暴露的 `Missing extension devsessioncanvas.dev-session-canvas.` 问题，确认来自旧的 extension test host 拓扑：主扩展与 notifier companion 拆成两条 development path 后，测试宿主既拿不到主扩展 manifest，也不会把 `ExtensionMode.Test` 传给 staged 运行时。当前已通过 staged smoke host、wrapper 激活入口与统一 test harness mode 收口这条验证链路。

同时，本轮已补齐人工验收支撑：

- notifier companion 新增测试桌面通知命令，可直接在真实桌面环境触发一次通知
- notifier companion 新增诊断输出，可记录实际 `backend`、`activationMode` 与最后一次人工验收结果
- 主扩展 diagnostic event 会同步记录 companion 返回的 `activationMode`，避免把“通知已发出”误读成“通知必然可点击回跳”
- `Run Dev Session Canvas (Main Only)` 现在会先生成 `.debug/vscode-extension-main-only/` 作为 debug-only 主扩展目录，因此主扩展在 local / remote 场景里都可单独调试，而不需要 notifier shim
- 远端联调场景收口为 `Run Dev Session Canvas + Notifier (Remote Window)`，把 `Remote SSH` / WSL / Dev Container 下的 workspace 主扩展与本机 UI notifier 明确拆成两条开发态路径；从远端仓库窗口发起时只要求输入 `localRepoRoot`
- 用户已在 macOS、Windows、Linux 三类本机环境完成真实桌面通知人工验收；其中 macOS 先确认过 `macos-osascript + activationMode=none` 退化路径，随后在安装 `terminal-notifier` 后完成 `macos-terminal-notifier + protocol` 主路径验证
- 用户已完成 `Remote Main + Local Notifier` 联调拓扑人工验收，确认 workspace-side 主扩展与 UI-side notifier companion 可在同一 Development Host 中协同工作
- 当前 staged smoke / VSIX smoke 会为了装配 wrapper 临时移除 `extensionDependencies` / `extensionPack`，因此它们验证的是“功能链路已打通”，而不是“Marketplace / VSIX 自动补齐安装关系已被 repo-local 自动化直接覆盖”

因此，本设计现从 `验证中` 调整为 `已验证`：notifier companion 的协议分层、桌面通知点击回调、跨平台本机通知路径，以及“远端主扩展 + 本机 UI notifier”的联调拓扑都已获得自动化与人工证据闭环。正式安装策略现已落成“主扩展 `extensionPack` 聚合 notifier + notifier 单向 `extensionDependencies` 回补主扩展”，也有人工安装证据，但真实 Marketplace / VSIX 自动补齐路径目前还没有被 repo-local smoke 直接覆盖。是否额外引入独立 extension pack 扩展包仍可继续在其他计划中演进，但它不再阻塞本设计的架构正确性判断。
