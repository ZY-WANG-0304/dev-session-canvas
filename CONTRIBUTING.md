# 开发与贡献

本文件是 DevSessionCanvas 的开发与贡献入口。

仓库已完成 MVP 验证，后续按正式开发和持续迭代推进，不再将交付物视为一次性原型。

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

发布前打包检查：

```bash
npm run package
```

仅做静态检查：

```bash
npm run typecheck
```

生成 Marketplace 发布工件或执行 packaged-payload 检查：

```bash
npm run package:vsix
```

验证 `Agent` 节点真实运行链路还需满足以下条件：

- `codex` 或 `claude` 至少有一个可从 Extension Host 解析到
- 若 Extension Host 的 `PATH` 无法直接解析命令，可在 VS Code 设置中配置 `devSessionCanvas.agent.codexCommand` 或 `devSessionCanvas.agent.claudeCommand`
- 默认主画布承载面为 `panel`；如需改回编辑区，可配置 `devSessionCanvas.canvas.defaultSurface = editor`
- 不再兼容旧命名空间设置、旧命令别名和旧 workspace 状态键；本地调试以 `devSessionCanvas.*` 命名为准

## 本地调试

`Run Dev Session Canvas` 系列是仓库自带的 VS Code 调试配置，不是命令面板里的普通命令。
仓库内的调试入口定义在隐藏文件 `.vscode/launch.json`；如果文件视图未显示 dotfiles，容易误以为“当前目录没有配置”。

推荐启动方式：

1. 打开 VS Code 的 `Run and Debug` 视图
2. 在顶部调试配置下拉框中按场景选择：
   - 本地窗口调主扩展：`Run Dev Session Canvas`
   - 本地窗口联调主扩展 + notifier：`Run Dev Session Canvas + Notifier (Local Window)`
   - 本地窗口只排查 notifier：`Run Notifier Only (Local Window)`
   - `Remote SSH` / WSL / Dev Container 窗口里联调“远端主扩展 + 本机 notifier”：`Run Remote Main + Local Notifier (Prompt)`
   - 本地 clone 窗口发起“远端主扩展 + 本机 notifier”：`Run Remote Main + Local Notifier (Prompt from Local Window)`
3. 点击启动按钮或直接按 `F5`

也可通过命令面板执行：

1. `Debug: Select and Start Debugging`
2. 选择对应的调试配置名称

启动后，VS Code 会打开一个 `Extension Development Host` 窗口。后续所有插件交互在该窗口中进行，而非在仓库窗口里。

调试配置默认行为：

- `Run Dev Session Canvas` 固定使用命名 profile `Dev Session Canvas Extension Debug`
- 其余 notifier 相关调试配置固定使用命名 profile `Dev Session Canvas Notifier Extension Debug`
- 通过 `skipFiles` 跳过 Node 内部和 VS Code 内置扩展源码，避免调试器停在内置 `git` 等非本仓库代码里
- 通过 `--extensionDevelopmentPath` 加载仓库中的开发态扩展，而非已安装副本

因此，日常使用的 VS Code profile 和扩展集合不会参与 F5 调试。Remote-SSH 所需的本机 UI 扩展应放入对应的专用 profile，扩展的已安装副本不要放进这些 profile。

补充说明：

- `Run Dev Session Canvas + Notifier (Local Window)` 与 `Run Notifier Only (Local Window)` 只适用于本地窗口，因为 notifier 是 `extensionKind: ["ui"]` 的本机 UI 扩展。
- 如果当前仓库是通过 `Remote SSH` / WSL / Dev Container 打开的，notifier 不能直接从远端源码目录启动；此时应改用 `Run Remote Main + Local Notifier (Prompt)`，让主扩展继续从远端路径运行、让 notifier 从本机 clone 路径运行。
- 如果当前打开的是本机 clone 窗口，但仍想发起“远端主扩展 + 本机 notifier”联调，应改用 `Run Remote Main + Local Notifier (Prompt from Local Window)`；这条配置会直接复用当前本机 `${workspaceFolder}` 作为 notifier 路径。
- `Run Remote Main + Local Notifier (Prompt)` 只能从远端仓库窗口启动，当前只要求输入 2 个值：`remoteAuthority` 和 `localRepoRoot`。远端 `folder-uri` 会继续复用当前远端 `${workspaceFolder}`，本机 notifier 路径则从 `localRepoRoot` 推导。
- `Run Remote Main + Local Notifier (Prompt from Local Window)` 只能从本地 clone 窗口启动，当前只要求输入 2 个值：`remoteAuthority` 和 `remoteWorkspacePath`。远端 `folder-uri` 与远端主扩展路径都从 `remoteWorkspacePath` 推导，本机 notifier 路径则直接复用当前本地 `${workspaceFolder}`。

## 首次准备 Debug Profile

首次在本机做 F5 调试前，需要一次性准备本地 profile。Remote-SSH 窗口里的远端任务无法修改本机 VS Code profile，所以这一步必须在本地完成。

推荐用本机终端执行：

```bash
code --profile "Dev Session Canvas Extension Debug" --install-extension ms-vscode-remote.vscode-remote-extensionpack
code --profile "Dev Session Canvas Extension Debug" --uninstall-extension devsessioncanvas.dev-session-canvas
code --profile "Dev Session Canvas Notifier Extension Debug" --install-extension ms-vscode-remote.vscode-remote-extensionpack
code --profile "Dev Session Canvas Notifier Extension Debug" --uninstall-extension devsessioncanvas.dev-session-canvas
code --profile "Dev Session Canvas Notifier Extension Debug" --uninstall-extension devsessioncanvas.dev-session-canvas-notifier
```

也可在 VS Code 里手工完成：

1. `Profiles: Create Profile`
2. 创建空 profile，名称填 `Dev Session Canvas Extension Debug`
3. 在该 profile 里安装 `Remote Development`
4. 确认该 profile 里未安装 `Dev Session Canvas`
5. 如果需要联调 notifier，再创建空 profile `Dev Session Canvas Notifier Extension Debug`
6. 仅在需要 `Remote SSH` / WSL / Dev Container 联调时，在 notifier profile 里安装 `Remote Development`
7. 确认 notifier profile 里未安装 Marketplace 版 `Dev Session Canvas` 与 `Dev Session Canvas Notifier`

说明：

- 这里的 profile 是本机 VS Code 用户环境，不在远端仓库里。
- `Remote Development` 是官方建议在远程扩展调试场景下放入专用 profile 的扩展集合。
- 启动后新开的 Development Host 默认可能是空窗口；这在 Remote-SSH 场景下是预期行为，无需让它复用源码窗口的远端工作区。

## 打开画布

在 `Extension Development Host` 窗口中：

1. 打开命令面板
2. 执行以下任一命令：
   - `Dev Session Canvas: 打开画布`
   - `Dev Session Canvas: 在编辑区打开画布`
   - `Dev Session Canvas: 在面板打开画布`

`Dev Session Canvas: 打开画布` 按 `devSessionCanvas.canvas.defaultSurface` 设置打开主画布，默认值为 `panel`。该 view 的工作台位置由 VS Code 原生记住，用户可自行放在底部 Panel 或 Secondary Sidebar。显式命令可覆盖本次打开位置。

## 建议验证路径

建议至少验证以下两条主路径：

1. `Terminal` 节点
   - 创建一个 `Terminal` 节点
   - 点击"创建并显示终端"
   - 关闭真实终端后，确认节点状态回流为关闭态
   - 重新打开画布后，点击"尝试连接现有终端"不会错误新建终端

2. `Agent` 节点
   - 创建一个 `Agent` 节点
   - 选择 `Codex` 或 `Claude Code`
   - 输入简短目标并点击"运行 Agent"
   - 观察节点进入运行态，完成后回流结果摘要
   - 如需验证中断链路，可在运行中点击"停止 Agent"

## 自动化验证

仓库提供三条主要自动化验证入口：

```bash
npm run test:smoke
npm run test:webview
npm run test:vsix-smoke
```

如需在不污染工作树的情况下执行 clean-checkout 发布验证，可额外使用：

```bash
npm run validate:clean-checkout:vsix -- --ref HEAD --skip-vsix-smoke
```

说明：

- `test:smoke` 按顺序启动 `trusted`、`restricted`、本地 `real-reopen` 和 `remote-ssh-real-reopen` 四类真实 VS Code Electron 场景。Remote-SSH 场景仅在 Linux 上启用：runner 先启动临时用户态 `sshd`，再让 `Remote-SSH` 扩展通过真实 SSH 协议连接同机远端，验证远端 Extension Development Host 下的 runtime persistence setup / verify 两阶段。可信与受限场景覆盖扩展激活、打开画布、真实 Webview DOM 交互、Note 编辑、provider 切换后重启、删除按钮、`Agent` / `Terminal` 执行生命周期、live session 切面 / reload 竞态、故障注入与 PTY 边界。
- `test:webview` 在 Playwright 中直接加载真实 `dist/webview.js` bundle，通过假 `acquireVsCodeApi()` 运行 Webview UI 测试与截图回归；已覆盖截图基线、Task 状态更新、Note 编辑、删除按钮、provider 切换和错误 toast。
- `test:vsix-smoke` 仅在 Linux 上运行。先执行 `npm run package:vsix`，再解包最新 `.vsix`，验证打包后的运行时文件是否齐全，并用解包产物跑一遍 trusted smoke。该入口验证的是打包内容完整性，不是三平台安装矩阵的替代品。
- `validate:clean-checkout:vsix` 在 `/tmp` 下创建隔离目录，默认从 `git archive HEAD` 导出 clean checkout，再执行 `npm ci`、`npm run package:vsix`，并可按需继续执行 `npm run test:vsix-smoke`。适用于工作树正在被修改但需要提前准备发布验证的场景。
- `npm test` 依次运行 `typecheck`、`test:extension-storage-paths`、`test:runtime-supervisor-paths`、`test:smoke` 和 `test:webview`。
- 首次运行 `test:smoke` 会下载 VS Code 测试副本；首次运行 `test:webview` 会下载 Chromium 到仓库内缓存目录。
- `test:smoke` 默认使用仓库内 fake provider fixture，不要求开发机安装 `codex` / `claude`；如需验证真实 Agent CLI，请走上面的人工主路径。
- `test:smoke` 失败时会将场景相关的快照、最后一次真实 Webview probe、宿主消息、`failure-diagnostic-events.json`（宿主侧 surface / session 生命周期时间线）和 VS Code logs 写入对应场景的 artifacts 目录；Remote-SSH real-reopen 产物位于 `.debug/vscode-smoke/remote-ssh-real-reopen/artifacts/`。
- `test:webview` 失败时会将截图、trace、`playwright-page-diagnostics.json`（console / page error / request failed）、`harness-posted-messages.json` 和 `harness-persisted-state.json` 写入 `.debug/playwright/results/`。

修改了 Webview 视觉基线后，需显式更新截图：

```bash
npm run test:webview -- --update-snapshots
```

## Remote-SSH 人工验收

自动化链路已覆盖扩展主路径、Webview UI 回归，以及 `Remote-SSH + Extension Development Host + live-runtime real-reopen` 主路径；但无法替代调试配置在 `Remote - SSH` 下的 F5 宿主验证。涉及调试配置、扩展身份或专用 debug profile 行为时，请额外做一次人工验收：

1. 在 `Remote - SSH` 打开的仓库窗口中按 `F5` 运行 `Run Dev Session Canvas`。
2. 确认新开的 Development Host 使用的是 `Dev Session Canvas Extension Debug` profile。
3. 确认新窗口不再提示安装 `Remote - SSH`，也不再卡在远端 `workspaceStorage` 锁冲突。
4. 在新窗口中执行 `Dev Session Canvas: 打开画布`，确认画布正常打开。
5. 若本机默认 profile 中已安装该扩展，确认 Development Host 里实际生效的是开发态扩展，而非已安装副本。

如果本轮改动涉及 notifier companion，还应额外做一次“远端主扩展 + 本机 notifier”人工验收：

1. 在 `Remote - SSH` 打开的仓库窗口中按 `F5` 运行 `Run Remote Main + Local Notifier (Prompt)`。
2. 输入：
   - `remoteAuthority`：例如 `ssh-remote+your-host-alias`
   - `localRepoRoot`：本机 clone 的 repo 根目录绝对路径
3. 确认远端仓库窗口里的主扩展仍可正常打开画布。
4. 在新开的 Development Host 中执行 `Developer: Show Running Extensions`，确认 `devsessioncanvas.dev-session-canvas-notifier` 出现在本机 UI 侧。
5. 再搜索并执行 `Dev Session Canvas Notifier: 发送测试桌面通知`，确认 notifier 命令已被同一 Development Host 成功加载。

如果当前改动需要从本地 clone 窗口直接发起同一条远端联调链路，则改用：

1. 在本地 clone 窗口中先执行 `npm run build:notifier`，并确保远端仓库窗口已经单独执行过 `npm run build`。
2. 在本地 clone 窗口中按 `F5` 运行 `Run Remote Main + Local Notifier (Prompt from Local Window)`。
3. 输入：
   - `remoteAuthority`：例如 `ssh-remote+your-host-alias`
   - `remoteWorkspacePath`：远端机器上的 repo 根目录绝对路径，例如 `/home/you/dev-session-canvas`
4. 在新开的 Development Host 中执行 `Developer: Show Running Extensions`，确认主扩展运行在 workspace 侧、`devsessioncanvas.dev-session-canvas-notifier` 运行在本机 UI 侧。
5. 再搜索并执行 `Dev Session Canvas Notifier: 发送测试桌面通知`，确认同一 Development Host 能同时看到远端主扩展与本机 notifier。

## 常见误区

- `Run Dev Session Canvas` 不是命令面板命令，而是调试配置名称。
- `Run Dev Session Canvas` 依赖专用 profile `Dev Session Canvas Extension Debug`；若该 profile 里缺少 `Remote Development`，Remote-SSH 调试不会正常工作。
- `Run Dev Session Canvas` 不会自动禁用扩展的已安装副本；正确做法是不要将其装入 debug profile。
- `Run Notifier Only (Local Window)` 不是远端窗口专用配置；在 `Remote SSH` / WSL / Dev Container 窗口里直接使用它，通常看不到 notifier 命令，因为 notifier 需要从本机路径加载。
- `Run Remote Main + Local Notifier (Prompt)` 不能从本地 clone 窗口启动；如果当前窗口的 `${workspaceFolder}` 是本机路径，就会把本机路径误当成远端 `folder-uri`。
- `Run Remote Main + Local Notifier (Prompt from Local Window)` 里的 `remoteWorkspacePath` 必须填写远端机器上的 repo 绝对路径，不能填写本机路径。
- `Dev Session Canvas: 打开画布` 按默认承载面打开主画布；如需指定宿主区域，请使用显式的编辑区 / 面板打开命令。
- 在仓库窗口的命令面板里搜索 `Run Dev Session Canvas` 通常找不到正确入口，因为它应从调试配置启动。
- 仓库尚未处于稳定版发布状态；对外目标是公开 `Marketplace Preview`，不是稳定正式版。
- `npm run package:vsix` 生成的是 Marketplace 上传工件与发布前验证输入，不是面向普通用户的推荐安装方式。
- 正式开发阶段不等于公开稳定发布，仍以 `Preview` 迭代为主。

## 提交与收口

- 每次有意义的变更，至少应包含文档更新、自动化测试或手动验证说明之一。
- 改动触及产品、设计或架构结论时，须同步更新对应正式文档。
- 提交前先确认 `docs/WORKFLOW.md` 中的分支、提交与 MR 约定。
- 不要把未确认内容写成已确认内容。
