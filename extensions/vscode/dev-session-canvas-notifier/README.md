# Dev Session Canvas Notifier

这是 Dev Session Canvas 的 UI-side / local-side notifier companion。

当前目录只承载 companion extension 本身的构建与局部实现；正式产品、架构与设计结论仍以仓库根目录的 `README.md`、`ARCHITECTURE.md` 与 `docs/` 为准。

如果当前在准备对外发布或复核 Marketplace 输入，统一以仓库根目录的 [`docs/notifier-preview-release-playbook.md`](../../../docs/notifier-preview-release-playbook.md) 为准；本目录下的 `README.marketplace.md` 只负责最终商店页文案。

当前公开安装关系已收口为双向自动补齐：安装主扩展 `Dev Session Canvas` 时，VS Code 会自动安装本扩展；如果从本扩展页面单独安装，VS Code 也会自动补齐主扩展。

本地手动 F5 调试时，优先使用仓库里的 `Run Dev Session Canvas + Notifier (Local Window)`。这条配置固定使用专用 profile `Dev Session Canvas Notifier Extension Debug`，目的是把 notifier 的开发态调试环境与日常使用环境隔离开，减少已安装插件和已安装发布版扩展带来的冲突。

如果要先排查 notifier 自己是否成功加载，再切回双扩展联调，优先使用 `Run Notifier Only (Local Window)`。这条配置只加载 `extensions/vscode/dev-session-canvas-notifier/`，能更快确认命令是否出现、build 产物是否被 Development Host 正确拾取。

建议这个专用 profile 只保留调试必需的插件；如果要调 `Remote SSH`，就在该 profile 里额外安装 `Remote Development` 相关扩展，但不要把 Marketplace 里的 `Dev Session Canvas` 或 `Dev Session Canvas Notifier` 已发布版本装进这个 profile。

如果当前仓库是通过 `Remote SSH` / WSL / Dev Container 打开的，`Run Notifier Only` 通常不会生效：主扩展是 workspace 扩展，可以跟着远端源码目录启动；但 notifier 是 `extensionKind: ["ui"]`，需要从本机路径加载。为此，仓库额外提供了两条“远端主扩展 + 本机 notifier”配置：

1. 如果你当前打开的是远端仓库窗口，选择 `Run Remote Main + Local Notifier (Prompt)`
   - 输入 `remoteAuthority`：例如 `ssh-remote+your-host-alias`
   - 输入 `localRepoRoot`：你本机 clone 的 repo 根目录绝对路径，例如 `/Users/you/dev-session-canvas`
   - 这条配置会自动把当前远端窗口的 `${workspaceFolder}` 拼成 `vscode-remote://...` 形式，继续让主扩展从远端 `folder-uri` 运行；同时把 `${localRepoRoot}/extensions/vscode/dev-session-canvas-notifier` 作为本机开发态 UI 扩展注入同一个 Development Host
2. 如果你当前打开的是本地 clone 窗口，但仍要发起同一条远端联调链路，选择 `Run Remote Main + Local Notifier (Prompt from Local Window)`
   - 输入 `remoteAuthority`：例如 `ssh-remote+your-host-alias`
   - 输入 `remoteWorkspacePath`：远端机器上的 repo 根目录绝对路径，例如 `/home/you/dev-session-canvas`
   - 这条配置会把 `vscode-remote://...${remoteWorkspacePath}` 作为远端主扩展与远端 `folder-uri`，并直接复用当前本地 `${workspaceFolder}/extensions/vscode/dev-session-canvas-notifier` 作为 notifier 路径

配合这些配置，建议：

- 远端仓库单独执行 `npm run build`
- 本机 clone 单独执行 `npm run build:notifier`
- 启动后先在 Development Host 中运行 `Developer: Show Running Extensions`，确认 `devsessioncanvas.dev-session-canvas-notifier` 出现在本机 UI 侧

当前 notifier 还会在 Activity Bar 提供一个独立 sidebar：`Dev Session Canvas Notifier`。这个 sidebar 会直接显示：

- 当前本机 UI 环境会走哪条通知路径（例如 `terminal-notifier`、`osascript`、`notify-send`、Windows Toast）
- 该路径是否支持点击系统通知后回到 VS Code
- 当前是否请求系统播放提示音
- 当前机器还需要用户预安装什么（例如 macOS 上是否已安装 `terminal-notifier`、Linux 上是否已检测到 `notify-send`）
- 最近一次 notifier 投递结果，便于对照诊断输出

声音开关配置：

- 设置项：`devSessionCanvasNotifier.notifications.playSound`
- 默认值：`true`
- 作用：控制 notifier companion 在当前本机 UI 侧投递桌面通知时，是否请求系统播放提示音
- 说明：这是 best-effort 开关；Linux / Windows 是否真正响铃仍取决于通知服务，macOS `osascript` 回退路径则会在开启时额外播放一次系统 alert sound

本地人工验收时，优先使用以下命令：

- `Dev Session Canvas Notifier: 发送测试桌面通知`
- `Dev Session Canvas Notifier: 打开通知诊断输出`

如果 sidebar 提示缺少前置依赖，可按平台补齐：

- macOS：如需点击回到 VS Code，预装 `terminal-notifier`（例如 `brew install terminal-notifier`）
- Linux：预装 `notify-send`（Debian/Ubuntu 常见包是 `libnotify-bin`）；是否支持点击回跳仍取决于桌面环境
- Windows：通常不需要额外 CLI，但需要系统通知权限和未被 Focus Assist 拦截

诊断输出会记录实际使用的后端、点击回调能力（`activationMode`）以及最近一次测试结果，用于区分“完整可点击通知”和“只保证通知出现”的平台退化路径。
