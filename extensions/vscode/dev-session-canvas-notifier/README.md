# Dev Session Canvas Notifier

这是 Dev Session Canvas 的 UI-side / local-side notifier companion。

当前目录只承载 companion extension 本身的构建与局部实现；正式产品、架构与设计结论仍以仓库根目录的 `README.md`、`ARCHITECTURE.md` 与 `docs/` 为准。

本地手动 F5 调试时，优先使用仓库里的 `Run Dev Session Canvas + Notifier (Local Window)`。这条配置固定使用专用 profile `Dev Session Canvas Notifier Extension Debug`，目的是把 notifier 的开发态调试环境与日常使用环境隔离开，减少已安装插件和已安装发布版扩展带来的冲突。

如果要先排查 notifier 自己是否成功加载，再切回双扩展联调，优先使用 `Run Notifier Only (Local Window)`。这条配置只加载 `extensions/vscode/dev-session-canvas-notifier/`，能更快确认命令是否出现、build 产物是否被 Development Host 正确拾取。

建议这个专用 profile 只保留调试必需的插件；如果要调 `Remote SSH`，就在该 profile 里额外安装 `Remote Development` 相关扩展，但不要把 Marketplace 里的 `Dev Session Canvas` 或 `Dev Session Canvas Notifier` 已发布版本装进这个 profile。

如果当前仓库是通过 `Remote SSH` / WSL / Dev Container 打开的，`Run Notifier Only` 通常不会生效：主扩展是 workspace 扩展，可以跟着远端源码目录启动；但 notifier 是 `extensionKind: ["ui"]`，需要从本机路径加载。为此，仓库额外提供了 `Run Remote Main + Local Notifier (Prompt)`：

1. 在远端仓库窗口里选择 `Run Remote Main + Local Notifier (Prompt)`
2. 按提示输入 2 个值：
   - `remoteAuthority`：例如 `ssh-remote+your-host-alias`
   - `localRepoRoot`：你本机 clone 的 repo 根目录绝对路径，例如 `/Users/you/dev-session-canvas`
3. 这条配置会自动把当前远端窗口的 `${workspaceFolder}` 拼成 `vscode-remote://...` 形式，继续让主扩展从远端 `folder-uri` 运行；同时把 `${localRepoRoot}/extensions/vscode/dev-session-canvas-notifier` 作为本机开发态 UI 扩展注入同一个 Development Host

配合这条配置，建议：

- 远端仓库继续用当前窗口里的 `npm run build`
- 本机 clone 单独执行 `npm run build:notifier`
- 启动后先在 Development Host 中运行 `Developer: Show Running Extensions`，确认 `devsessioncanvas.dev-session-canvas-notifier` 出现在本机 UI 侧

本地人工验收时，优先使用以下命令：

- `Dev Session Canvas Notifier: 发送测试桌面通知`
- `Dev Session Canvas Notifier: 打开通知诊断输出`

诊断输出会记录实际使用的后端、点击回调能力（`activationMode`）以及最近一次测试结果，用于区分“完整可点击通知”和“只保证通知出现”的平台退化路径。
