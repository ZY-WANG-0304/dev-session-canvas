---
title: 运行时持久化与会话监督器设计
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
  - docs/product-specs/runtime-persistence-modes.md
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/runtime-persistence-and-supervisor-design.md
  - docs/exec-plans/completed/remote-ssh-runtime-persistence-automation.md
  - docs/exec-plans/completed/runtime-host-backend-systemd-user.md
  - docs/exec-plans/active/runtime-terminal-state-restore.md
updated_at: 2026-04-15
---

# 运行时持久化与会话监督器设计

## 1. 背景

当前仓库已经完成一条“对象图可恢复、`Agent` 有 best-effort resume、`Terminal` 可在同一扩展进程内重附着”的最小主路径。这条路径足以支撑画布 reload、扩展重载后的关键上下文恢复，但还达不到更强的产品目标：关闭画布甚至关闭整个 VSCode 后，真实 `Agent` / `Terminal` 进程仍能继续工作，并在下次打开时重新附着。

当前实现之所以做不到，不是因为少了一个字段，而是因为进程所有权还在 extension host 里。只要 `node-pty` 子进程是由 extension host 直接拥有，VSCode 退出时它们天然会跟着一起结束；即使对象图、日志摘要和恢复上下文都被持久化下来，这也只是“快照恢复”，不是“真实运行时持久化”。

## 2. 问题定义

本轮要回答的问题不是“还能多存几个字段”，而是：

1. 产品所说的“持久化”到底分哪几种承诺，用户如何分辨。
2. 如果要承诺“真实进程跨 VSCode 生命周期继续存在”，谁来拥有这些进程。
3. `Agent` 与 `Terminal` 应如何在同一套运行时持久化框架下工作，同时保留各自状态机与恢复差异。

这里需要先定义两个词：

- 会话监督器（session supervisor，也可以理解成 daemon）：一个独立于 VSCode 扩展宿主的辅助进程，部署位置跟随 workspace 所在侧。它负责长期持有 `Agent` / `Terminal` 子进程、保存会话登记和日志，并在 VSCode 重新打开后允许扩展重新附着。
- `snapshot-only`：关闭 VSCode 后不承诺真实进程继续存在，但会恢复关闭前的节点、状态、日志摘要和恢复入口。
- `live-runtime`：关闭 VSCode 后，真实 `Agent` / `Terminal` 进程仍可继续存在；下次打开 VSCode 时扩展应优先重新附着到这些 live 会话。

## 3. 目标

- 把“恢复上下文”和“真实进程继续存在”明确拆成两档正式语义。
- 为 `live-runtime` 模式选择一条能真正脱离 extension host 生命周期的技术路线。
- 保持 `Agent` / `Terminal` 继续属于同一类执行节点家族，但不强迫两者共享完全相同的恢复行为。
- 第一版默认追求尽量完整实现，而不是预设只交付一条够演示的半链路；只有明确记录的 blocker 或外部边界才允许把能力后移。
- 明确当前实现、未来设计和未验证假设之间的边界，避免把目标态误写成现状。

## 4. 非目标

- 不把监督器扩展成第二个前端或通用进程平台；本轮只聚焦 runtime host backend、会话登记、重连、必要状态字段与最小可用日志持久化。
- 不在本轮承诺 Dev Container / Codespaces 已经支持 `live-runtime`。
- 不在本轮把 provider 自身 resume 能力误写成对“真实进程仍然存在”的统一替代。
- 不在本轮把终端完整 scrollback 或每一帧 UI 临时态都定义成必须长期持久化的数据。

## 5. 候选方案

### 5.1 继续由 extension host 直接拥有所有进程

特点：

- 现有 `CanvasPanelManager` 继续直接创建并持有 `node-pty` 进程。
- 关闭 VSCode 后只保留 `workspaceState`、日志摘要和 `Agent` resume 元数据。

不选原因：

- 这条路线可以继续改进“快照恢复”，但做不到“真实进程在 VSCode 退出后继续活着”。
- 它会继续把“恢复了上下文”和“原进程还在”混成一个模糊概念。

### 5.2 主要依赖 provider / shell 自带恢复能力

特点：

- `Agent` 主要靠 `Codex` / `Claude Code` 自身 resume。
- `Terminal` 主要靠 shell / tmux / screen / 其他外部机制恢复。

不选原因：

- 这会把统一产品能力外包给多个外部工具，`Agent` 与 `Terminal` 的表现会严重分裂。
- `Terminal` 没有一个与 provider resume 等价的统一机制；如果把这条路线写成正式产品承诺，用户很难知道哪些场景是真的“持久化”，哪些只是碰巧能恢复。

### 5.3 独立会话监督器 + 两档持久化模式

特点：

- 对象图、节点布局与轻量状态仍由扩展宿主持有。
- 真实 `Agent` / `Terminal` 进程、长期日志和重连元数据交给独立会话监督器持有。
- 通过配置开关区分 `snapshot-only` 与 `live-runtime`。

当前选择原因：

- 这是唯一能正面满足“VSCode 退出后真实进程继续存在”目标的路线。
- 它允许 `snapshot-only` 保持较低复杂度，也允许 `live-runtime` 拿到真正的进程所有权模型，而不是继续靠词义模糊掩盖差异。
- 在 VSCode 生态里，把重活放到独立后端进程是常见做法，但“跨 VSCode 生命周期继续存在的常驻监督器”并不是普通 workbench extension 的默认形态；只有当真实 runtime persistence 成为正式产品目标时，这个额外复杂度才是合理代价。

## 6. 当前结论

### 6.1 正式产品语义

当前正式结论是：运行时持久化不是单一能力，而是两档模式。

- `snapshot-only`
  - 画布关闭、surface 切换、Webview reload 不应终止会话。
  - 关闭 VSCode 后不承诺真实进程继续存在。
  - 下次打开时恢复的是关闭前的节点、最后状态、日志摘要与恢复入口。
- `live-runtime`
  - 除上述能力外，关闭 VSCode 后真实进程仍可继续存在。
  - 下次打开时优先重新附着到原会话。
  - 如果会话在 VSCode 关闭期间自然结束，则恢复的是该会话的最终结果，而不是新的伪会话。

同时，`live-runtime` 现在正式拆成两条 backend 路线与两档 guarantee：

- backend
  - `systemd-user`：Linux 本地与 `Remote SSH` 的正式主路径。它把 supervisor 提升到用户服务层，不再依赖 extension host 自己长期持有 detached child。
  - `legacy-detached`：当前 detached launcher 路线。它继续保留为 fallback，但不再被当成 Linux / `Remote SSH` 的正式强保证主路径。
- guarantee
  - `strong`：由平台级服务管理器持有 runtime，目标是关闭整个 VSCode 或断开 `Remote SSH` 后仍能稳定重连。
  - `best-effort`：仍然尝试保活与重连，但不再把这条路径写成强承诺。

配置层当前建议使用布尔开关 `devSessionCanvas.runtimePersistence.enabled`。它控制的是“是否要求真实进程跨 VSCode 生命周期继续存在”，而不是“是否做任何持久化”。无论开关开或关，对象图与关键上下文都仍然需要持久化。

#### 第一版完成度目标

当前明确追加一个产品约束：第一版默认目标不是“只证明技术可行”，而是尽量完整实现产品主张；只有明确记录的 blocker、外部依赖边界或暂不支持的平台，才允许收窄首版交付。

- 当前首版至少应尽量覆盖：监督器创建与发现、会话注册表、日志持久化、VSCode 重开后的自动发现、重新附着 UI、失败后的历史恢复、停止与清理语义。
- 对没有被明确记为 blocker 或平台边界的能力，第一版不应故意只做其中一半，例如：
  - 只支持 `Agent` 的 `live-runtime`，却把 `Terminal` 留到下一版。
  - 只支持本地 workspace，却把 `Remote SSH` 留到下一版。
  - 只有 backend 持久化，却没有明确的 `重连中` / `历史恢复` UI 反馈。

### 6.2 权威状态分层

当前建议把持久化边界拆成三层：

1. 对象图与画布状态
   - 继续由 extension host 持有。
   - 包括节点 ID、标题、位置、尺寸、生命周期摘要、最近输出摘要、终端尺寸与 serialized terminal state 等最小恢复元数据。
2. 会话注册表与持久化日志
   - 不再塞进 `workspaceState`。
   - 应放到独立的本地持久化目录，由监督器和扩展共同理解。
   - 这里需要显式区分三类落点：`storageDir`、`controlDir` 与 legacy 的 `runtimeDir`。
   - registry、会话快照与恢复元数据继续放 extension `storageDir`。
   - 正式主路径中的 IPC control socket 不再默认依赖 `XDG_RUNTIME_DIR`。对 Linux / `Remote SSH`，应由 `systemd-user` backend 管理 control endpoint。
   - `XDG_RUNTIME_DIR` 或 temp 下的 runtime socket 现在只属于 `legacy-detached` fallback，不再承担 Linux / `Remote SSH` 强保证语义。
   - 只有 legacy backend 才允许继续复用短 storage 路径或 runtime-private/temp 路径。
   3. 真实进程所有权
   - 只在 `live-runtime` 模式下成立。
   - 必须由独立会话监督器持有，不能再依赖 extension host 直接拥有。

这三层里，第一层永远存在；第二层在两档模式下都需要；第三层只在 `live-runtime` 中被正式承诺。

对 `Agent` / `Terminal` 而言，画布或 Webview 被重建后的“当前屏幕恢复”现在有一条更正式的结论：宿主应优先恢复 serialized terminal state，而不是把最后几千字符 raw tail 当作权威终端状态。`recentOutput` 仍保留，但只用于摘要与兼容 fallback。

### 6.3 会话监督器职责

当前建议把监督器职责限制在以下范围，避免它膨胀成第二个产品前端：

- 创建并持有 `Agent` / `Terminal` 子进程
- 保存稳定会话 ID 与节点映射
- 记录可回放的日志或至少是有上限的输出持久化
- 提供本地 IPC 接口，用于创建、附着、分离、停止、查询和拉取历史输出
- 在没有剩余会话时允许自清理，避免长期空转

监督器不是画布，也不是新的工作面。它只是一个进程所有权和重连能力的承载层。

在实现层，再补两条 backend 约束：

- `systemd-user`
  - 用于 Linux 本地与 `Remote SSH` 的正式主路径。
  - extension host 不再直接长期持有 supervisor，而是写入并启动用户级 service，由用户服务层继续持有 runtime。
- `legacy-detached`
  - 保留当前“短命 launcher 拉起 detached supervisor”的路径。
  - 只作为 fallback，不再被记录为 Linux / `Remote SSH` 已验证的正式主路径。

当前设计范围明确包含两类部署位置：

- 本地 workspace：Linux 本地应优先走 `systemd-user`。macOS 本地的正式强保证 backend 仍待 `launchd` 路线收口；在此之前只保留 fallback。
- Remote SSH workspace：监督器运行在远端 workspace 所在主机，与远端 extension host 协同；正式主路径应优先走远端 `systemd-user`，而不是仅靠 detached child。

当前不把 Dev Container / Codespaces 写成已承诺范围，因为这两类环境还额外涉及容器生命周期、端口转发与宿主管理边界。

### 6.4 会话模型

每个执行节点都应有一个稳定会话身份，至少包含：

- `workspaceId`
- `nodeId`
- `sessionId`
- `kind`（`agent` 或 `terminal`）
- 启动命令、cwd、尺寸
- 当前持久化模式
- 最后附着时间与最后状态

其中 `sessionId` 不应再依赖 extension host 的一次性内存。只要产品要承诺重新附着，`sessionId` 就必须是可持久化、可查询的长期身份。

除了 `sessionId`，当前正式结论还要求会话元数据至少保留：

- `runtimeBackend`
- `runtimeGuarantee`

否则宿主与 UI 都无法区分“当前会话来自 `systemd-user` 正式主路径”，还是“来自 `legacy-detached` fallback”。

### 6.5 关闭与重开语义

关闭画布、隐藏 Webview 或切换 surface 时：

- 两档模式都只做 detach，不杀进程。

关闭整个 VSCode 时：

- `snapshot-only`
  - 系统不承诺真实进程继续活着。
  - 若当前仍由监督器持有进程，退出前应把最后状态、日志摘要和恢复上下文刷盘，并在合理超时内终止这些进程。
- `live-runtime`
  - 会话继续由监督器持有。
  - 扩展退出只是“暂时没有前端附着”，不是会话结束。

重新打开 VSCode 时：

- `snapshot-only`
  - 不尝试把节点伪装成仍有 live runtime。
  - 直接恢复关闭前的节点、最后状态、日志摘要与恢复入口，并进入历史恢复路径。
- `live-runtime`
  - 若节点带有可附着的持久化会话身份，UI 先进入 `重连中`，而不是直接复用关闭前的 `运行中` / `等待输入` 标签。
  - 若监督器报告会话仍活着并完成附着，状态切回真实生命周期状态。
  - 若监督器确认不存在该会话、会话已在离线期间自然结束、监督器不可达超时，或重新附着失败，则节点进入 `历史恢复`，不再伪装成当前 live runtime。
  - 当前 backend 与 guarantee 仍需写入宿主权威状态、日志与诊断事件；节点默认 UI 不直接显示这类字段，避免把调试信息塞进主交互区。

### 6.6 UI 与状态机含义

当前生命周期状态机已经足以描述“进程做了什么”，但还不足以描述“当前是不是附着在 live 会话上”。因此，未来不应把所有差异都继续塞进 `starting / running / stopped` 这类生命周期枚举里，而应额外保留一个“附着态”维度，例如：

- `attached-live`
- `reattaching`
- `history-restored`

第一版的用户可见规则进一步收敛为：

- 只要系统尚未重新确认 live runtime 仍然存在，主状态标签就显示 `重连中`，而不是继续显示旧的 `运行中` / `等待输入`。
- 一旦重新附着成功，主状态标签切回真实生命周期状态：
  - `Agent` 回到如 `running`、`waiting-input` 之类的真实状态；当会话已处于可继续输入阶段时，节点主状态应继续显示 `waiting-input`。
  - `Terminal` 回到如 `live`、`closed` 之类的真实状态。
- 只要节点与上下文恢复了，但系统无法重新附着到 live runtime，主状态标签就显示 `历史恢复`。

第一版不单独引入新的用户可见状态 `运行时丢失`。如果实现层需要区分“监督器不可达”“session 不存在”“session 已结束”等原因，可保留内部 reason code，但对用户统一折叠为 `历史恢复`。

这不意味着第一版 UI 必须一次性暴露所有内部诊断字段，但至少宿主权威状态必须能表达 `attached-live / reattaching / history-restored` 这层差异。否则用户无法判断自己看到的是“正在运行的真实进程”还是“关闭前留下的历史结果”。

## 7. 风险与取舍

- 取舍：选择独立监督器，而不是继续压榨 extension host。
  原因：这是满足真实 runtime persistence 的必要条件，但代价是要新增 IPC、日志、会话发现与清理逻辑。

- 风险：后台持久进程会引入孤儿进程、资源泄漏和版本兼容问题。
  当前缓解：把监督器职责限制在最小范围，并明确要求会话注册表、超时清理、版本握手机制，以及 backend 级别的 guarantee 区分。

- 风险：用户容易把“恢复快照”误解成“还是原来的 live 进程”。
  当前缓解：正式把产品语义拆成两档，并要求宿主状态能表达附着态差异。

- 风险：如果 Webview 重建后立即按当前容器尺寸 destructive `fit()`，alternate-buffer / 全屏重绘型 CLI 的顶部行会被裁掉，导致“恢复了会话但屏幕不对”。
  当前缓解：宿主改为持有 serialized terminal state，Webview snapshot hydrate 时优先保持宿主记录的终端尺寸与画面；保活场景下的 `fit + refresh` 继续由 visibility restore 路径负责。

- 风险：Remote 场景里，“VSCode 关闭”与“远端扩展宿主是否还活着”并不总是同一件事。
  当前缓解：当前设计仍把 Remote SSH 纳入 `live-runtime` 目标范围，但 detached launcher 已不再被视作最终充分条件；正式主路径改为远端 `systemd-user` backend，原 detached 路线只保留为 fallback。Dev Container / Codespaces 继续留在后续范围。

- 风险：`Run and Debug` / `Extension Development Host` 不是安装版扩展的完全等价宿主；调试宿主可能回收 direct child 进程，导致 live-runtime 在 debug-only 场景下退化成历史恢复。
  当前缓解：监督器启动路径改为 launcher 中转，避免真正 supervisor 长期停留在调试宿主的直接进程树中；当前既有 Remote SSH + F5 的人工验证，也有 Remote-SSH Extension Development Host 的自动化 smoke 覆盖。剩余人工验证只针对调试配置入口本身，而不是产品 runtime persistence 主路径。

## 8. 验证方法

至少需要完成以下验证后，才能把本设计从“验证中”推进到 `已验证`：

1. 监督器能独立于 extension host 生命周期存在，并在 VSCode 重新打开后被重新发现。
2. `live-runtime` 模式下，关闭 VSCode 后 `Agent` 能继续运行，并在下次打开时显示关闭期间新增的输出。
3. `live-runtime` 模式下，`Terminal` 能在关闭 VSCode 后继续存在，并在下次打开时重新附着到原会话。
4. `snapshot-only` 模式下，关闭 VSCode 后不会把历史快照错误展示成 live 会话。
5. 用户能在 UI 上区分 live 附着态和历史恢复态。
6. 异常场景下，孤儿会话、监督器崩溃和重连失败都有明确可见反馈。
7. 在 Remote SSH workspace 中，关闭本地 VSCode 后远端 `Agent` / `Terminal` 仍可继续存在；重新连接后会话能重新附着到远端监督器持有的 live runtime。
8. 在 `live-runtime` 模式下，VSCode 重开后的节点在重新确认附着前显示 `重连中`；无法附着时统一进入 `历史恢复`，而不是沿用旧的活动态标签。

## 9. 当前验证状态

- 当前已经有 detached supervisor 实现代码，以及本地自动化验证：
  - `npm run typecheck`
  - `npm run build`
  - `npm run test:smoke`
  - `npm run test:webview`
- 已经被本地验证覆盖的行为包括：
  - detached supervisor 路径下的 `Agent` / `Terminal` 启动与重新附着
  - 关闭期间新增输出在短链路重连后可见
  - Webview 重建后基于 serialized terminal state 的终端当前屏幕恢复
  - `重连中` / `历史恢复` UI 语义
  - 关闭运行时持久化开关后，不再自动重连既有 live-runtime
  - Remote-SSH Extension Development Host 下基于 detached 路线的 real-reopen 自动化
- 新的确认是：上述证据足以证明当前 detached 路线具备 `best-effort` 能力，但不足以继续把 Linux / `Remote SSH` 的正式强保证主路径写成“已验证”。用户已经在 `Remote SSH` 长断开场景下观察到节点仍可恢复、但 live session 会退化成历史结果的反例。
- 因此本设计的 `validation_status` 回退到 `验证中`。后续只有在 `systemd-user` 主路径接入并完成验证后，Linux / `Remote SSH` 的正式强保证结论才可重新标为 `已验证`。
