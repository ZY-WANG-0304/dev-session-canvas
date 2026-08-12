# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

[English (default)](README.marketplace.md) | 简体中文

Dev Session Canvas 是运行在 VS Code 内的多 Agent 协作 AI 工作台，画布是这个工作台的主要交互载体。你可以把 `Agent`、`Terminal` 与 `Note` 节点放在同一视图中，同时管理多个开发执行会话，而不必在聊天面板、终端标签和编辑器之间来回切换。当前为公开 `Preview` 版本。

![Dev Session Canvas 主画布概览](images/marketplace/canvas-overview.zh-CN.png)

<video src="images/marketplace/canvas-overview.zh-CN.mp4" controls muted loop playsinline></video>

## 0.24.5 版本亮点

当前公开的 `0.24.5` 继续迭代 `0.24.x` Preview 线，把 Runtime Supervisor 重启与 Window Reload 明确拆开，并改善终端输入响应。新的 Supervisor 从空 namespace 启动，不扫描旧 registry/journal；Window Reload 若连接到同一健康 Supervisor，则按 surface、按节点分块恢复完整 retained projection，并边接收边显示。

- Supervisor 重启后，带可信 provider session id 的 Agent 会进入 `resume-ready`，只有用户点击 `Resume` 后才创建新 PTY；Terminal 提供已有 durable history（若存在）与 `Restart`。screen snapshot 或 recent output 只是可选提示，不作保证
- 重启不会 hydrate 旧 runtime namespace，也不会发布整画布 hydrate 通知；新会话可立即创建
- Window Reload 为每个 surface 和节点建立独立、有界的 bulk projection；选中节点优先，后台节点仍有界推进，一个 restoring 节点不会阻塞 ready 节点、Note 或新建节点
- 节点输入保持严格 FIFO，但上一请求写入固定 socket 后即可派发下一项，不等待上一条 response；每条 response 仍独立观察、诊断和报错
- Supervisor 先把输入写入 PTY、再返回小型 response、最后发布 compact lifecycle；bulk 连接只传 terminal stream event，不驱动共享 lifecycle
- 升级窗口中，仍由旧 Supervisor 真正持有的会话可以继续 output、input、resize、stop 与 delete，当前 generation 同时服务新会话
- Codex 风格的 OSC 10/11 颜色查询不再让原本安全的 checkpoint 失去资格；真正的颜色修改、重置与未知事件仍 fail-closed，安全的 current / previous checkpoint generation 可以 compact 完整 journal prefix
- 扩展 ID、最低 VS Code 版本、provider 命令、journal 格式、桌面 notifier 行为、notifier 自动安装关系、Open VSX 完成门禁、Visual Studio Marketplace deferred 口径、模板市场服务版本线和 Preview 支持边界均保持不变

## 核心功能

- 在面板或编辑区打开主画布
- 创建 `Agent`、`Terminal` 与 `Note` 节点
- 通过 `codex` 或 `claude` CLI 驱动 `Agent` 节点执行
- 通过嵌入式终端运行 `Terminal` 节点
- 通过 VS Code 已注册编辑器打开识别出的文本和媒体文件链接，并为文本目标保留行列定位
- 拖动缩放 Agent / Terminal 节点时实时预览外框，只把稳定最终字符网格尺寸提交给底层 PTY
- Window Reload 时重连同一存活 Supervisor，按 surface、按节点分块恢复 retained history；旧 PTY 已消失时保持如实的 restart 语义
- 让 `Agent` 与嵌入式 `Terminal` 继承受控 shell 环境，并在诊断信息中暴露当前解析路径
- 可把支持的截图直接粘贴到 live `Agent` 节点中，以临时图片文件路径作为上下文，并保留用户手动提交提示词的节奏
- 通过 File Explorer 右键菜单，从 workspace 内目录或文件创建绑定 cwd 的 `Terminal` 或 `Agent` 节点
- 在 `Note` 节点中使用 Markdown 语法记录上下文
- 将 `Note` 节点关联到 workspace 中的 `.md` / `.markdown` 文件，并支持 YAML metadata 浮层和安全 Markdown 图片预览
- 使用内置模板和自定义模板快速恢复一组 `Agent` / `Terminal` / `Note` 工作面，并为关联 Markdown Note 提供显式保存策略
- 使用可命名画布分组组织相关 `Agent` / `Terminal` / `Note` 节点，支持嵌套分组、分组 resize 和侧栏分组树浏览
- 从持有可信 session id 的 Codex 或 Claude Code Agent `分叉` 出新 Agent 节点，用 provider 原生 fork 语义启动，并可为当前节点 Fork 配置向上 / 向下 / 向右落位
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
- Runtime 重启处理已有可重复 Host 级 smoke，覆盖 Host 启动、Agent 显式 Resume action 与 Terminal history 状态；该 smoke 未点击真实 Resume/Restart 按钮，也不承诺物理设备重启或长时间 Remote SSH 断开后旧 PTY 仍然存活
- 严格 90,000 行 completed terminal 压测已间歇性出现最终尾部未收齐，期间也有完整通过样本；单次极端大输出的最终尾部完整性仍在验证中
- journal compact 有意保持保守：不安全或过大的 checkpoint 会保留 current / previous 安全证明仍需要的 journal prefix，因此本版本不承诺固定磁盘上限、完整长期 retention 策略或跨版本 journal 回退兼容
- Fork 定向落位已有自动化几何与交互覆盖，但 panel / editor 两种承载面的层间距与 `fork` 标签仍待最终人工视觉验收
- PNG 链接打开已有真实 VS Code Host 覆盖；GIF 与 MP4 走同一通用 opener 且 VS Code 已注册对应编辑器，但尚无各自的真实宿主 fixture。`vscode.open` resolve 只表示 editor service 已受理请求，不保证目标 model 最终加载成功
- resize 合并已有 Webview 回归与 trusted Host smoke，但仍待使用真实 Codex / Claude TUI 进程人工复核 journal；不同节点或跨 Pane Gallery surface 的多指触控不属于当前支持范围
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
- 首次安装与从 `0.24.4` 升级到 `0.24.5` 应通过当前宿主配置的公开扩展市场获取；Open VSX 兼容宿主路径应同步发布并验证同版本，也是当前 marketplace 完成门禁；官方 VS Code 的 `Visual Studio Marketplace` 路径只有在 release-day visibility check 确认主扩展与 notifier 均公开可见后才对外宣称可用。若 VSM 本轮仍为 deferred，GitHub Release assets 是手动安装兜底入口
- UI 语言跟随 VS Code locale。本版本不新增扩展自己的语言设置，也不会翻译用户内容、终端输出、provider 输出或市场模板数据
- 若升级时仍有旧版 Runtime Supervisor 托管的运行会话，这些会话会继续通过原 runtime 提供 output、input、resize、stop 与 delete，同时当前 generation 可立即服务新会话。旧会话不会迁移 PTY 所有权，终端画面陈旧时可拖动节点边缘触发重绘
- Supervisor 持久化仍取决于 `runtimePersistence.enabled` 与后端可用性；合格的 live journal 可以通过 current / previous generation 安全 compact 完整 prefix，不安全 checkpoint 会保留所需 prefix，local PTY 不因此获得跨 Host 生命周期保证，Preview 版本之间也不承诺 runtime journal 的回退兼容
- 替代 Supervisor 从空 namespace 启动，不扫描或打开旧 registry/journal。可信 Agent resume id 只启用显式 `Resume` 并创建新 PTY；Terminal 提供已有 durable history（若存在）与 `Restart`。系统不发布整画布 hydrate 通知，screen/recent output 只是可选提示
- Window Reload 若仍连接同一 live Supervisor，则为每个 surface 和节点通过有界 bulk stream 恢复完整 retained history，收到 chunk 即显示。输入和 compact lifecycle 留在 control：FIFO 在固定 socket dispatch 后推进，每条 response 独立完成，response 先于 lifecycle，bulk 不发布共享 lifecycle
- 当前节点 Agent Fork 默认使用 `devSessionCanvas.canvas.forkPlacementDirection = up`；可改为 `down` 或 `right`，该设置只影响之后的当前节点 Fork，不重排既有 Fork 或会话历史入口的落位
- 生产模板市场可能以空目录启动。生产环境不会把代码内 seed 模板暴露为正式内容；真实模板必须通过发布流程或受控运维流程入库
- 窗格画廊只改变多根呈现；单根 workspace 继续显示普通画布，`rootGroups` 仍是默认多根模式和保守回退路径
- 布局整理是一次性显式操作，不提供撤销、不持续自动重排，也不跨普通分组或跨 root 搬移节点
- 若你此前显式设置过 `devSessionCanvas.runtimePersistence.enabled`、`devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled`、`devSessionCanvas.canvas.multiRootPresentationMode` 或 `devSessionCanvas.canvas.forkPlacementDirection`，升级到 `0.24.5` 后会继续沿用该明确选择
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
