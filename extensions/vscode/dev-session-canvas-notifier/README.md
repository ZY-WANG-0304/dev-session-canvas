# Dev Session Canvas Notifier

这是 Dev Session Canvas 的 UI-side / local-side notifier companion。

当前目录只承载 companion extension 本身的构建与局部实现；正式产品、架构与设计结论仍以仓库根目录的 `README.md`、`ARCHITECTURE.md` 与 `docs/` 为准。

如果当前在准备对外发布或复核 Marketplace 输入，统一以仓库根目录的 [`docs/notifier-preview-release-playbook.md`](../../../docs/notifier-preview-release-playbook.md) 为准；本目录下的 `README.marketplace.md` 只负责最终商店页文案。

当前公开安装关系已收口为双向自动补齐：安装主扩展 `Dev Session Canvas` 时，VS Code 会自动安装本扩展；如果从本扩展页面单独安装，VS Code 也会自动补齐主扩展。

本地手动 F5 调试时，优先使用仓库里的 `Run Dev Session Canvas + Notifier (Local Window)`。这条配置固定使用专用 profile `Dev Session Canvas Notifier Extension Debug`，目的是把 notifier 的开发态调试环境与日常使用环境隔离开，减少已安装插件和已安装发布版扩展带来的冲突。

如果只想单独调主扩展，而不把真实 notifier 一起跑起来，则使用 `Run Dev Session Canvas (Main Only)`。这条配置不会加载 notifier，也不会要求本机 notifier 路径；它会在启动前生成一份 debug-only 的临时主扩展目录，并去掉开发态的 notifier 依赖，因此主扩展仍可在本地或远端窗口中独立调试。

建议这个专用 profile 只保留调试必需的插件；如果要调 `Remote SSH`，就在该 profile 里额外安装 `Remote Development` 相关扩展，但不要把 Marketplace 里的 `Dev Session Canvas` 或 `Dev Session Canvas Notifier` 已发布版本装进这个 profile。

如果当前仓库是通过 `Remote SSH` / WSL / Dev Container 打开的，主扩展可以继续跟着远端源码目录启动；但 notifier 是 `extensionKind: ["ui"]`，仍需要从本机路径加载。为此，仓库只保留一条远端 notifier 联调配置：

1. 如果你当前打开的是远端仓库窗口，选择 `Run Dev Session Canvas + Notifier (Remote Window)`
   - 输入 `localRepoRoot`：你本机 clone 的 repo 根目录绝对路径，例如 `/Users/you/dev-session-canvas`
   - 这条配置会直接复用当前远端窗口作为主扩展上下文，并把 `${localRepoRoot}/extensions/vscode/dev-session-canvas-notifier` 作为本机 UI 侧 notifier 注入同一个 Development Host
2. 如果你只想在远端窗口里调主扩展而不联调 notifier，则直接使用 `Run Dev Session Canvas (Main Only)`
   - 这条配置不需要输入 `localRepoRoot`
   - 主扩展会从当前远端 `${workspaceFolder}` 生成 debug-only 临时目录并启动

配合这些配置，建议：

- 远端仓库单独执行 `npm run build`
- 本机 clone 在需要联调 notifier 时再单独执行 `npm run build:notifier`
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
