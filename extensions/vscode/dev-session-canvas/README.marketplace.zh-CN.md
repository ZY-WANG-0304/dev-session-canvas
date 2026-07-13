# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

[English (default)](README.marketplace.md) | 简体中文

Dev Session Canvas 是运行在 VS Code 内的多 Agent 协作 AI 工作台，画布是这个工作台的主要交互载体。你可以把 `Agent`、`Terminal` 与 `Note` 节点放在同一视图中，同时管理多个开发执行会话，而不必在聊天面板、终端标签和编辑器之间来回切换。当前为公开 `Preview` 版本。

![Dev Session Canvas 主画布概览](images/marketplace/canvas-overview.png)

<video src="images/marketplace/canvas-overview.mp4" controls muted loop playsinline></video>

## 0.24.1 版本亮点

当前公开的 `0.24.1` 是 Runtime Supervisor 升级路径的紧急 Preview 修复，解决 `0.24.0` 升级后旧 Supervisor 会话被强制只读、同时新会话等待旧进程排空的问题。它保留 `0.24.0` 的无损输入输出协议、Agent `Resume / 恢复`、multi-root 分范围清空、本地化、模板市场 Preview、notifier 安装关系、GitHub Release assets + Open VSX verified 完成门禁，以及 Visual Studio Marketplace deferred 口径。

- 不同 Supervisor generation 现在隔离 storage namespace、registry、Unix socket / Windows named pipe 与 systemd user unit，让旧 runtime 自然排空时不再阻塞当前 runtime
- session 保留持久化的 `runtimeStoragePath`，继续由持有真实 PTY 的原 Supervisor 承载；新 Agent / Terminal 会话立即进入当前 `terminal-stream-v1` generation
- 旧会话恢复交互能力：output、input、resize、stop 与 delete 继续可用，历史持久化的 legacy 只读 projection 会自动归一化
- 不同 generation 之间不迁移 PTY 所有权；旧 runtime 的 raw output tail 不会被提升为当前无损 checkpoint 或 journal，恢复权威边界保持显式
- 最后一个旧会话结束且待处理 RPC settled 后释放旧 client；completed / history 节点会清理迁移专用 projection，避免残留兼容提示
- 迁移提示不再覆盖终端交互；若旧终端画面显示异常，可拖动节点边缘触发真实 terminal resize / redraw，新节点仍继续使用当前 runtime
- 扩展 ID、最低 VS Code 版本、通知行为、notifier 自动安装关系、Open VSX 完成门禁、Visual Studio Marketplace deferred 口径、模板市场服务版本线和 Preview 支持边界均保持不变

## 核心功能

- 在面板或编辑区打开主画布
- 创建 `Agent`、`Terminal` 与 `Note` 节点
- 通过 `codex` 或 `claude` CLI 驱动 `Agent` 节点执行
- 通过嵌入式终端运行 `Terminal` 节点
- 让 `Agent` 与嵌入式 `Terminal` 继承受控 shell 环境，并在诊断信息中暴露当前解析路径
- 可把支持的截图直接粘贴到 live `Agent` 节点中，以临时图片文件路径作为上下文，并保留用户手动提交提示词的节奏
- 通过 File Explorer 右键菜单，从 workspace 内目录或文件创建绑定 cwd 的 `Terminal` 或 `Agent` 节点
- 在 `Note` 节点中使用 Markdown 语法记录上下文
- 将 `Note` 节点关联到 workspace 中的 `.md` / `.markdown` 文件，并支持 YAML metadata 浮层和安全 Markdown 图片预览
- 使用内置模板和自定义模板快速恢复一组 `Agent` / `Terminal` / `Note` 工作面，并为关联 Markdown Note 提供显式保存策略
- 使用可命名画布分组组织相关 `Agent` / `Terminal` / `Note` 节点，支持嵌套分组、分组 resize 和侧栏分组树浏览
- 从持有可信 session id 的 Codex 或 Claude Code Agent `分叉` 出新 Agent 节点，并用 provider 原生 fork 语义启动
- 将 VS Code multi-root workspace 组合到同一张画布中，并用系统 workspace-root section 保留每个 root 自己的画布状态
- 可把多根 workspace 切到窗格画廊，用动态 / 宫格全览和顶部 / 右侧缩略图模式巡检多个 root
- 全局 fit view 与 MiniMap 会理解完整画布空间，包括节点、用户分组和 workspace-root section
- 可从右键菜单一次性整理画布布局，同时保留分组和 workspace root 边界
- 可从画布右键菜单清空当前普通分组、当前 workspace root 或整个 workspace，并在执行前明确确认作用域
- `Restricted Mode` 下保留画布浏览，执行入口自动禁用
- 在 Linux 本地与 `Remote SSH` 的 `systemd --user` 可用时，`runtimePersistence.enabled` 提供更强的持久化保障；否则自动回退到 `best-effort`
- 在侧栏查看 `节点` 与 `会话历史` 列表，支持快速定位当前画布节点并从历史恢复或分叉新 `Agent` 节点
- 在侧栏 `节点` view 管理 workspace folder 和 git worktree，包括添加已有 worktree，并在移除 folder 或 linked worktree 前通过显式确认收口风险
- 浏览模板市场，把完整模板包安装到用户或 workspace 模板库，并更新或回滚已安装的市场模板
- 在 GitHub 认证和市场服务可用时，发布已保存的本地模板或提交市场模板新版本
- 根据 VS Code locale 使用英文默认 UI 或简体中文 UI，同时不翻译用户自有内容

## 适用场景

- 受信任工作区，标准文件系统
- 已安装 `codex` 或 `claude` CLI
- 需要同时观察多个开发会话，而不想在终端标签间频繁切换
- 需要一个 canvas 形态的 AI 工作台，而不是单一聊天面板
- 愿意试用 Preview 模板市场的用户；生产目录在真实模板发布前可能为空

## 支持范围与限制

- `Remote SSH` 主路径已验证可用，且仍是当前验证最充分的推荐环境
- Linux、macOS 本地工作区的 `Preview` 主路径已完成功能可用性验证
- Windows 本地工作区的 `Preview` 主路径已完成功能可用性验证；当前已知限制是使用 `Codex` 时执行节点内历史暂时无法向上翻页
- 真实旧二进制升级 smoke 当前覆盖 Linux / Unix socket；Windows named pipe 与 systemd generation 隔离只有路径级覆盖，不能视为完整跨平台真实升级矩阵
- 严格 90,000 行 completed terminal 压测已间歇性出现最终尾部未收齐，期间也有完整通过样本；单次极端大输出的最终尾部完整性仍在验证中
- 侧栏 `会话历史` 只显示能明确确认属于当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `Restricted Mode` 允许打开画布，但禁用 `Agent` / `Terminal` 等执行入口
- `Virtual Workspace` 暂不支持
- 模板市场浏览和安装需要能访问当前配置的市场来源；发布、点赞、举报和管理员动作需要 GitHub 认证，并仍按 Preview 能力处理
- 当前为 `Preview`，不提供稳定正式版承诺

## 环境要求

- VS Code `1.80.0` 或更高版本
- 标准文件系统工作区
- `Agent` 节点需要 Extension Host 可访问的 `codex` 或 `claude` CLI
- `Terminal` 节点需要工作区侧可用的 shell

## 安装与升级

- 扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.24.0` 升级到 `0.24.1` 应通过当前宿主配置的公开扩展市场获取；Open VSX 兼容宿主路径应同步发布并验证同版本，也是当前 marketplace 完成门禁；官方 VS Code 的 `Visual Studio Marketplace` 路径只有在 release-day visibility check 确认主扩展与 notifier 均公开可见后才对外宣称可用。若 VSM 本轮仍为 deferred，GitHub Release assets 是手动安装兜底入口
- UI 语言跟随 VS Code locale。本版本不新增扩展自己的语言设置，也不会翻译用户内容、终端输出、provider 输出或市场模板数据
- 若升级时仍有旧版 Runtime Supervisor 托管的运行会话，这些会话会继续通过原 runtime 提供 output、input、resize、stop 与 delete；新会话可立即进入当前 generation。旧会话不会迁移 PTY 所有权，终端画面陈旧时可拖动节点边缘触发重绘
- Supervisor 支持的跨 Host 恢复仍取决于 `runtimePersistence.enabled` 与后端可用性；local PTY 不因此获得跨 Host 生命周期保证，Preview 版本之间也不承诺 runtime journal 的回退兼容
- 生产模板市场可能以空目录启动。生产环境不会把代码内 seed 模板暴露为正式内容；真实模板必须通过发布流程或受控运维流程入库
- 窗格画廊只改变多根呈现；单根 workspace 继续显示普通画布，`rootGroups` 仍是默认多根模式和保守回退路径
- 布局整理是一次性显式操作，不提供撤销、不持续自动重排，也不跨普通分组或跨 root 搬移节点
- 若你此前显式设置过 `devSessionCanvas.runtimePersistence.enabled`、`devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 或 `devSessionCanvas.canvas.multiRootPresentationMode`，升级到 `0.24.1` 后会继续沿用该明确选择
- 截图粘贴文件是扩展存储中的临时附件，不是 workspace 文件；它们会保留一段时间以便 Agent 上下文复用，之后由后台 TTL 维护任务清理
- 若你在 `0.2.0` 中沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能暂时被拆成两个独立图标；这不表示重复安装了两个扩展，可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

## 桌面通知 companion（自动安装）

- 安装 `Dev Session Canvas` 时，VS Code 会自动安装 `Dev Session Canvas Notifier`（`devsessioncanvas.dev-session-canvas-notifier`）
- 如果你是从 notifier 页面单独安装，VS Code 也会自动补齐主扩展 `Dev Session Canvas`
- 执行节点的 attention signal 默认会通过 `devSessionCanvas.notifications.attentionSignalBridge = system` 优先桥接到本机桌面；如需改回工作台消息、关闭桥接，或用 `devSessionCanvas.notifications.enabledAttentionSignals` 收窄可触发 attention 的信号源，可在主扩展设置中调整
- `system` 模式下，主扩展会优先把通知交给本机 UI 侧 companion；若 companion 缺失、当前平台不支持或投递失败，则自动回退到 VS Code 工作台消息
- 这个 companion 尤其适合 `Remote SSH`、WSL、Dev Container 等“主扩展跑在 workspace 侧、提醒需要回到本机桌面”的场景

## 使用提示

### Windows 环境下无法创建 Terminal 和 Agent 节点

**症状**：workspace 已信任，但创建节点时仍异常地只能看到 `Note` 类型，`Terminal` 和 `Agent` 节点类型不可见。

**排查方向**：若 workspace 已信任但仍出现该异常，可先检查 Windows PowerShell 执行策略；某些环境下，执行策略可能影响 Node.js 相关命令的正常执行。

**可尝试的处理方法**：

1. 以管理员身份打开 PowerShell
2. 运行以下命令设置执行策略为 `RemoteSigned`：
   ```powershell
   Set-ExecutionPolicy RemoteSigned
   ```
3. 输入 `Y` 确认更改
4. 关闭并重新打开 VS Code
5. 再次尝试创建 `Terminal` 或 `Agent` 节点，确认是否恢复正常

## 回退建议

- 若当前版本阻塞工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.24.x` 修复版本，而非尝试手动降级；切换版本前先停止重要会话，因为 Supervisor journal 不承诺跨版本回退兼容
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容
- 问题反馈、安全问题和支持边界说明见下方链接

## 支持与反馈

- Preview 支持边界：<https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- 问题与功能反馈：<https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- 安全问题：`wzy0304@outlook.com`
## 开源信息

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
