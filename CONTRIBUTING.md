# 开发与贡献

本文件是 DevSessionCanvas 的开发与贡献入口。

当前仓库已完成 MVP 验证；后续默认按正式开发和持续迭代推进，不再把交付物当作一次性原型处理。

## 开始前先读

开始交付性工作前，先阅读以下文档：

- `docs/WORKFLOW.md`
- `ARCHITECTURE.md`
- `docs/PRODUCT_SENSE.md`
- `AGENTS.md`

如果任务涉及复杂功能、显著重构、多步研究或需要持续决策记录，先按 `docs/PLANS.md` 创建或更新 `ExecPlan`。

## 本地准备

在仓库根目录执行：

```bash
npm install
npm run build
```

如果要做发布前打包检查，执行：

```bash
npm run package
```

如果只做静态检查，执行：

```bash
npm run typecheck
```

如需生成内部体验版 VSIX，执行：

```bash
npm run package:vsix
```

如果要验证 `Agent` 节点的真实运行链路，还需要满足以下条件：

- `codex` 或 `claude` 至少有一个可从 Extension Host 解析到
- 如果 Extension Host 的 `PATH` 无法直接解析命令，可在 VSCode 设置中配置 `devSessionCanvas.agent.codexCommand` 或 `devSessionCanvas.agent.claudeCommand`
- 如果要让主画布默认出现在 VSCode Panel，而不是编辑区，可在设置中配置 `devSessionCanvas.canvas.defaultSurface = panel`
- 本轮开始不再兼容旧命名空间设置、旧命令别名和旧 workspace 状态键；本地调试请以当前 `devSessionCanvas.*` 命名为准。

## 本地调试

`Run Dev Session Canvas` 是仓库自带的 VSCode 调试配置，不是命令面板里的普通命令。

推荐启动方式：

1. 打开 VSCode 的 `Run and Debug` 视图
2. 在顶部调试配置下拉框中选择 `Run Dev Session Canvas`
3. 点击启动按钮，或直接按 `F5`

也可以通过命令面板执行：

1. `Debug: Select and Start Debugging`
2. 选择 `Run Dev Session Canvas`

启动后，VSCode 会打开一个新的 `Extension Development Host` 窗口。后续所有插件交互都在这个新窗口中进行，不是在当前仓库窗口里完成。

当前调试配置默认会：

- 固定使用命名 profile `Dev Session Canvas Extension Debug`
- 默认通过 `skipFiles` 跳过 Node 内部和 VS Code 内置扩展源码，避免调试器停在内置 `git` 等非本仓库代码里
- 通过 `--extensionDevelopmentPath` 加载当前仓库里的开发态扩展，而不是依赖已安装副本

这意味着日常使用的 VS Code profile 和扩展集合不会再直接参与 F5 调试。Remote-SSH 所需的本机 UI 扩展放到这个专用 profile 里，当前扩展的已安装副本则不要放进这个 profile。

## 首次准备 Debug Profile

第一次在本机做 F5 调试前，需要先准备一次本地 profile。Remote-SSH 窗口里的远端任务无法替你改本机 VS Code profile，所以这一步是一次性的本地准备。

推荐用本机终端执行：

```bash
code --profile "Dev Session Canvas Extension Debug" --install-extension ms-vscode-remote.vscode-remote-extensionpack
code --profile "Dev Session Canvas Extension Debug" --uninstall-extension devsessioncanvas.dev-session-canvas
```

如果你不想用命令行，也可以在 VS Code 里手工完成同样的事：

1. `Profiles: Create Profile`
2. 创建空 profile，名称填 `Dev Session Canvas Extension Debug`
3. 在这个 profile 里安装 `Remote Development`
4. 确认这个 profile 里没有安装当前扩展 `Dev Session Canvas`

说明：

- 这里的 profile 是本机 VS Code 的用户环境，不在远端仓库里。
- `Remote Development` 是官方建议在远程扩展调试场景下放进专用 profile 的扩展集合。
- `Run Dev Session Canvas` 启动后，新开的 Development Host 默认可能是空窗口；这在 Remote-SSH 场景下是预期行为，不需要再让它复用当前源码窗口的同一个远端工作区。

## 打开画布

在新的 `Extension Development Host` 窗口中：

1. 打开命令面板
2. 执行以下任一命令：
   - `Dev Session Canvas: 打开画布`
   - `Dev Session Canvas: 在编辑区打开画布`
   - `Dev Session Canvas: 在面板打开画布`

默认情况下，`Dev Session Canvas: 打开画布` 会按 `devSessionCanvas.canvas.defaultSurface` 的当前设置打开主画布；显式命令可直接覆盖本次打开位置。

## 建议验证路径

当前建议至少验证以下两条主路径：

1. `Terminal` 节点
   - 创建一个 `Terminal` 节点
   - 点击“创建并显示终端”
   - 关闭真实终端后，确认节点状态回流为关闭态
   - 重新打开画布后，点击“尝试连接现有终端”不会错误新建终端

2. `Agent` 节点
   - 创建一个 `Agent` 节点
   - 选择 `Codex` 或 `Claude Code`
   - 输入简短目标并点击“运行 Agent”
   - 观察节点进入运行态，并在完成后回流结果摘要
   - 如需验证中断链路，可在运行中点击“停止 Agent”

## 自动化验证

当前仓库已经提供两条自动化验证入口：

```bash
npm run test:smoke
npm run test:webview
```

说明：

- `test:smoke` 会启动一个真实的 VS Code Electron 实例，自动验证扩展激活、打开画布、等待 Webview ready、创建节点和重置状态。
- `test:webview` 会在 Playwright 中直接加载真实 `dist/webview.js` bundle，通过假 `acquireVsCodeApi()` 运行 Webview UI 测试与截图回归。
- 执行 `npm test` 会依次运行 `typecheck`、`test:smoke` 和 `test:webview`。
- 首次运行 `test:smoke` 会下载一份 VS Code 测试副本；首次运行 `test:webview` 会下载 Chromium 到仓库内缓存目录。

如果你修改了 Webview 视觉基线，需要显式更新截图：

```bash
npm run test:webview -- --update-snapshots
```

## Remote-SSH 人工验收

当前自动化链路已经覆盖扩展主路径和 Webview UI 回归，但还不能直接替代 `Remote - SSH` 下的 F5 宿主验证。涉及调试配置、扩展身份或远程宿主行为时，请额外做一次人工验收：

1. 在 `Remote - SSH` 打开的仓库窗口中按 `F5` 运行 `Run Dev Session Canvas`。
2. 确认新开的 Development Host 使用的是 `Dev Session Canvas Extension Debug` profile。
3. 确认新窗口不再提示安装 `Remote - SSH`，也不再卡在远端 `workspaceStorage` 锁冲突。
4. 在新窗口中执行 `Dev Session Canvas: 打开画布`，确认画布能正常打开。
5. 如果本机默认 profile 中已安装当前扩展，确认 Development Host 里实际生效的是开发态扩展，而不是已安装副本。

## 常见误区

- `Run Dev Session Canvas` 不是命令面板命令，而是调试配置名称。
- `Run Dev Session Canvas` 现在默认依赖专用 profile `Dev Session Canvas Extension Debug`；如果这个 profile 里没有 `Remote Development`，Remote-SSH 调试不会正常工作。
- `Run Dev Session Canvas` 不再尝试自动禁用当前扩展的已安装副本；正确做法是不要把它装进 debug profile。
- `Dev Session Canvas: 打开画布` 会按默认承载面打开主画布；如需直接落在某个宿主区域，请使用显式的编辑区 / 面板打开命令。
- 如果你只在当前仓库窗口里搜索 `Run Dev Session Canvas`，通常找不到正确入口，因为它应从调试配置启动。
- 当前不是稳定版发布仓库状态；当前阶段默认只做内部体验版 VSIX 分发。
- 正式开发阶段不等于公开稳定发布；当前仍以内部 Preview 迭代为主。

## 提交与收口

- 每次有意义的变更，至少应包含文档更新、自动化测试或手动验证说明之一。
- 如果改动触及产品、设计或架构结论，必须同步更新对应正式文档。
- 准备提交前，先确认 `docs/WORKFLOW.md` 中的分支、提交与 MR 约定。
- 不要把未确认内容写成已确认内容。
