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
- `Restricted Mode` 下保留画布浏览，执行入口自动禁用
- 在 Linux 本地与 `Remote SSH` 的 `systemd --user` 可用时，`runtimePersistence.enabled` 提供更强的持久化保障；否则自动回退到 `best-effort`

## 适用场景

- 受信任工作区，标准文件系统
- 已安装 `codex` 或 `claude` CLI
- 需要同时观察多个开发会话，而不想在终端标签间频繁切换
- 需要一个 canvas 形态的 AI 工作台，而不是单一聊天面板

## 支持范围与限制

- `Remote SSH` 是当前验证最充分的推荐环境
- Linux、macOS、Windows 本地工作区可以尝试，但尚未严格验证
- `Restricted Mode` 允许打开画布，但禁用 `Agent` / `Terminal` 等执行入口
- `Virtual Workspace` 暂不支持
- 当前为 `Preview`，不提供稳定正式版承诺

## 环境要求

- VS Code `1.85.0` 或更高版本
- 标准文件系统工作区
- `Agent` 节点需要 Extension Host 可访问的 `codex` 或 `claude` CLI
- `Terminal` 节点需要工作区侧可用的 shell

## 0.2.x 版本亮点

当前公开的 `0.2.x` 版本线主要把画布从“并排放多个执行节点”推进到“能表达协作关系与产物流转”的下一阶段：

- 可以在节点之间补充关系连线，更直观地表达任务拆分、依赖与 handoff
- `Agent` 的读写文件现在可以投影为文件节点或文件列表，支持过滤、路径展示与从画布直接打开文件
- 执行提醒现在会同步进入节点标题栏、小地图与侧栏概览，帮助你更快定位需要处理的会话
- 侧栏概览、文件过滤与文件活动相关交互也已收口，主路径体验比 `0.1.2` 更完整

## 安装与升级

- 扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与后续 `0.2.x` 更新都通过 `Visual Studio Marketplace` 获取
- 若你在 `0.2.0` 中沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能暂时被拆成两个独立图标；这不表示重复安装了两个扩展，可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

## 使用提示

### Windows 环境下无法创建 Terminal 和 Agent 节点

**症状**：创建节点时只能看到 `Note` 类型，`Terminal` 和 `Agent` 节点类型不可见。

**原因**：Windows PowerShell 执行策略限制导致 Node.js 相关命令无法正常执行。

**解决方法**：

1. 以管理员身份打开 PowerShell
2. 运行以下命令设置执行策略为 `RemoteSigned`：
   ```powershell
   Set-ExecutionPolicy RemoteSigned
   ```
3. 输入 `Y` 确认更改
4. 关闭并重新打开 VS Code
5. 再次尝试创建 `Terminal` 或 `Agent` 节点确认是否恢复正常

## 回退建议

- 若当前版本阻塞工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.2.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容
- 问题反馈、安全问题和支持边界说明见下方链接

## 支持与反馈

- Preview 支持边界：<https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- 问题与功能反馈：<https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- 安全问题：`wzy0304@outlook.com`

## 开源信息

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
