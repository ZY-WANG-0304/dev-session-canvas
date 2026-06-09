# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

[English (default)](README.marketplace.md) | 简体中文

Dev Session Canvas 是运行在 VS Code 内的多 Agent 协作 AI 工作台，画布是这个工作台的主要交互载体。你可以把 `Agent`、`Terminal` 与 `Note` 节点放在同一视图中，同时管理多个开发执行会话，而不必在聊天面板、终端标签和编辑器之间来回切换。当前为公开 `Preview` 版本。

![Dev Session Canvas 主画布概览](images/marketplace/canvas-overview.png)

<video src="images/marketplace/canvas-overview.mp4" controls muted loop playsinline></video>

## 核心功能

- 在面板或编辑区打开主画布
- 创建 `Agent`、`Terminal` 与 `Note` 节点
- 通过 `codex` 或 `claude` CLI 驱动 `Agent` 节点执行
- 通过嵌入式终端运行 `Terminal` 节点
- 让 `Agent` 与嵌入式 `Terminal` 继承受控 shell 环境，并在诊断信息中暴露当前解析路径
- 通过 File Explorer 右键菜单，从 workspace 内目录或文件创建绑定 cwd 的 `Terminal` 或 `Agent` 节点
- 在 `Note` 节点中使用 Markdown 语法记录上下文
- 将 `Note` 节点关联到 workspace 中的 `.md` / `.markdown` 文件，并支持 YAML metadata 浮层和安全 Markdown 图片预览
- 使用内置模板和自定义模板快速恢复一组 `Agent` / `Terminal` / `Note` 工作面，并为关联 Markdown Note 提供显式保存策略
- 使用可命名画布分组组织相关 `Agent` / `Terminal` / `Note` 节点，支持嵌套分组、分组 resize 和侧栏分组树浏览
- 从持有可信 session id 的 Claude Code Agent `Fork` 出新 Agent 节点，并用 provider 原生 fork 语义启动
- 将 VS Code multi-root workspace 组合到同一张画布中，并用系统 workspace-root section 保留每个 root 自己的画布状态
- 全局 fit view 与 MiniMap 会理解完整画布空间，包括节点、用户分组和 workspace-root section
- `Restricted Mode` 下保留画布浏览，执行入口自动禁用
- 在 Linux 本地与 `Remote SSH` 的 `systemd --user` 可用时，`runtimePersistence.enabled` 提供更强的持久化保障；否则自动回退到 `best-effort`
- 在侧栏查看 `节点` 与 `会话历史` 列表，支持快速定位当前画布节点并从历史恢复新 `Agent` 节点

## 适用场景

- 受信任工作区，标准文件系统
- 已安装 `codex` 或 `claude` CLI
- 需要同时观察多个开发会话，而不想在终端标签间频繁切换
- 需要一个 canvas 形态的 AI 工作台，而不是单一聊天面板

## 支持范围与限制

- `Remote SSH` 主路径已验证可用，且仍是当前验证最充分的推荐环境
- Linux、macOS 本地工作区的 `Preview` 主路径已完成功能可用性验证
- Windows 本地工作区的 `Preview` 主路径已完成功能可用性验证；当前已知限制是使用 `Codex` 时执行节点内历史暂时无法向上翻页
- 侧栏 `会话历史` 只显示能明确确认属于当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `Restricted Mode` 允许打开画布，但禁用 `Agent` / `Terminal` 等执行入口
- `Virtual Workspace` 暂不支持
- 当前为 `Preview`，不提供稳定正式版承诺

## 环境要求

- VS Code `1.80.0` 或更高版本
- 标准文件系统工作区
- `Agent` 节点需要 Extension Host 可访问的 `codex` 或 `claude` CLI
- `Terminal` 节点需要工作区侧可用的 shell

## 0.15.0 版本亮点

当前公开的 `0.15.0` 版本是新的 Preview 里程碑，重点补齐 Claude Code Agent Fork、文件活动自动对象按 owner Agent 推导分组、Panel Webview lifecycle 诊断闭环，以及 publish tag 发布输入固定流程。它保留 `0.14.1` 的 Markdown Note 快捷入口、surface 复用、分组 body 拖动画板、shared runtime 可靠性、空间导航、双市场发布和 Preview 支持边界。

- 持有可信 Claude Code session id 的 Agent 节点现在会显示 `Fork`，点击后创建新的 Agent 节点，并用 `claude --resume <session-id> --fork-session` 启动，来源节点保持不变
- 第一版 Fork 只面向 Claude Code：Codex、非 Claude provider、缺少可信 Claude session id 或未受信任 workspace 不会触发 fork 启动
- 文件活动 `file` / `file-list` 自动对象现在按 owner Agent 推导分组：单 owner 跟随该 Agent 的最内层分组，多 owner 使用最近公共父分组，multi-root 下保持 root 内隔离
- 多选拖拽收口会保留自动文件活动对象的 owner-derived 分组，不再让拖拽结果把它们移到与 owner Agent 不一致的分组
- workspace-root section 标题现在和普通分组使用同一套缩放可读性与宽度压缩规则
- Panel Webview lifecycle 诊断新增 Host 聚合摘要与 `npm run diagnose:webview-lifecycle` 离线分析入口，便于排查 restore / race 报告
- Release-day 发布现在使用临时 `publish/vX.Y.Z` tag 固定发布输入，双市场验证通过后再由脚本创建正式 `vX.Y.Z` tag
- 扩展 ID、Preview 定位、最低 VS Code 版本、notifier 自动安装关系、Open VSX 同版本同步策略和支持矩阵都保持不变

## 安装与升级

- 扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.14.1` 升级到 `0.15.0` 应通过当前宿主配置的公开扩展市场获取：官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`；后续 `0.15.x` 更新同样按对应市场升级获取
- 若你此前显式设置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.15.0` 后会继续沿用该明确选择
- 若你在 `0.2.0` 中沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能暂时被拆成两个独立图标；这不表示重复安装了两个扩展，可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

## 桌面通知 companion（自动安装）

- 安装 `Dev Session Canvas` 时，VS Code 会自动安装 `Dev Session Canvas Notifier`（`devsessioncanvas.dev-session-canvas-notifier`）
- 如果你是从 notifier 页面单独安装，VS Code 也会自动补齐主扩展 `Dev Session Canvas`
- 执行节点的 attention signal 默认会通过 `devSessionCanvas.notifications.attentionSignalBridge = system` 优先桥接到本机桌面；如需改回工作台消息或关闭桥接，可在主扩展设置中调整
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
- 优先等待后续更高的 `0.15.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容
- 问题反馈、安全问题和支持边界说明见下方链接

## 支持与反馈

- Preview 支持边界：<https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- 问题与功能反馈：<https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- 安全问题：`wzy0304@outlook.com`
- 飞书交流群：

  <img src="images/lark-group-qr.png" alt="Dev Session Canvas 飞书交流群" width="240" />

- 微信交流群：

  <img src="images/wechat-group-qr.png" alt="Dev Session Canvas 微信交流群" width="240" />

## 开源信息

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
