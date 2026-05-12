# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

简体中文（默认） | [English](README.marketplace.en.md)

Dev Session Canvas 是运行在 VS Code 内的多 Agent 协作 AI 工作台，画布是这个工作台的主要交互载体。你可以把 `Agent`、`Terminal` 与 `Note` 节点放在同一视图中，同时管理多个开发执行会话，而不必在聊天面板、终端标签和编辑器之间来回切换。当前为公开 `Preview` 版本。

![Dev Session Canvas 主画布概览](images/marketplace/canvas-overview.png)

<video src="images/marketplace/canvas-overview.mp4" controls muted loop playsinline></video>

## 产品定位

- 它首先是 VS Code 内的 `AI workbench with canvas`，而不是一个只有 AI 点缀的可视化工具
- `Visualization` 对应的是交互载体：用画布承载多个执行对象与它们的全局关系
- `AI` 对应的是主要使用场景：面向多 Agent 协作开发，而不是单轮 chat-first 体验
- `Other` 对应的是工作台属性：强调它与 VS Code 原生编辑器、终端和插件生态协同工作

## 核心功能

- 在面板或编辑区打开主画布
- 创建 `Agent`、`Terminal` 与 `Note` 节点
- 通过 `codex` 或 `claude` CLI 驱动 `Agent` 节点执行
- 通过嵌入式终端运行 `Terminal` 节点
- 让 `Agent` 与嵌入式 `Terminal` 继承受控 shell 环境，并在诊断信息中暴露当前解析路径
- 在 `Note` 节点中使用 Markdown 预览、交互式 checklist、workspace 文件链接、代码块与公式
- 使用内置模板和自定义模板快速恢复一组 `Agent` / `Terminal` / `Note` 工作面
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

## 0.9.1 版本亮点

当前公开的 `0.9.1` 版本聚焦桌面通知接入指导和侧栏视觉一致性：`Dev Session Canvas Notifier` sidebar 拆成更清晰的概览、注意事项、平台说明和 Agent 配置 section，代码片段更易读，同时主扩展、节点、模板与 notifier 的 Activity Bar badge 图标体系完成统一。

- `Dev Session Canvas Notifier` sidebar 新增多 section 结构：`概览` 展示当前后端与最近一次投递状态，`注意事项` 与平台 section 解释本机通知前置条件，`Codex` / `Claude Code` section 给出 Agent 运行宿主上的配置建议
- notifier 的 Agent 配置说明更易读，`Codex` / `Claude Code` 示例在深浅主题下都能清楚区分关键配置
- Marketplace 文案补齐本机系统环境配置：桌面通知后端应安装在当前 VS Code 本机 UI 环境；如果 Agent 跑在远端，provider 通知配置应写在远端运行宿主
- notifier 状态判断优先使用最近一次投递结果的 `activationMode`，避免把 Linux 等降级路径误显示为可点击回跳
- macOS `osascript` 回退路径不再额外触发 `beep`，改为直接请求 `display notification` 的系统声音
- `节点`、模板与 notifier Activity Bar badge 图标完成统一，并重新生成 notifier 图标和主扩展圆形头像安全区图

## 安装与升级

- 扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.9.0` 升级到 `0.9.1` 都通过 `Visual Studio Marketplace` 获取；后续 `0.9.x` 更新同样通过 Marketplace 升级获取
- 若你此前显式设置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.9.1` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
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
- 优先等待后续 `0.9.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容
- 问题反馈、安全问题和支持边界说明见下方链接

## 支持与反馈

- Preview 支持边界：<https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- 问题与功能反馈：<https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- 安全问题：`wzy0304@outlook.com`

## 开源信息

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
