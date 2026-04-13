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

`Run Dev Session Canvas` 是仓库自带的 VS Code 调试配置，不是命令面板里的普通命令。

推荐启动方式：

1. 打开 VS Code 的 `Run and Debug` 视图
2. 在顶部调试配置下拉框中选择 `Run Dev Session Canvas`
3. 点击启动按钮或直接按 `F5`

也可通过命令面板执行：

1. `Debug: Select and Start Debugging`
2. 选择 `Run Dev Session Canvas`

启动后，VS Code 会打开一个 `Extension Development Host` 窗口。后续所有插件交互在该窗口中进行，而非在仓库窗口里。

调试配置默认行为：

- 固定使用命名 profile `Dev Session Canvas Extension Debug`
- 通过 `skipFiles` 跳过 Node 内部和 VS Code 内置扩展源码，避免调试器停在内置 `git` 等非本仓库代码里
- 通过 `--extensionDevelopmentPath` 加载仓库中的开发态扩展，而非已安装副本

因此，日常使用的 VS Code profile 和扩展集合不会参与 F5 调试。Remote-SSH 所需的本机 UI 扩展应放入专用 profile，扩展的已安装副本不要放进该 profile。

## 首次准备 Debug Profile

首次在��机做 F5 调试前，需要一次性准备本地 profile。Remote-SSH 窗口里的远端任务无法修改本机 VS Code profile，所以这一步必须在本地完成。

推荐用本机终端执行：

```bash
code --profile "Dev Session Canvas Extension Debug" --install-extension ms-vscode-remote.vscode-remote-extensionpack
code --profile "Dev Session Canvas Extension Debug" --uninstall-extension devsessioncanvas.dev-session-canvas
```

也可在 VS Code 里手工完成：

1. `Profiles: Create Profile`
2. 创建空 profile，名称填 `Dev Session Canvas Extension Debug`
3. 在该 profile 里安装 `Remote Development`
4. 确认该 profile 里未安装 `Dev Session Canvas`

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

- `test:smoke` 按顺序启动 `trusted`、`restricted`、本地 `real-reopen` 和 `remote-ssh-real-reopen` 四类真实 VS Code Electron 场景。Remote-SSH 场景仅在 Linux 上启用：runner 先启动临时用���态 `sshd`，再让 `Remote-SSH` 扩展通过真实 SSH 协议连接同机远端，验证远端 Extension Development Host 下的 runtime persistence setup / verify 两阶段。可信与受限场景覆盖扩展激活、打开画布、真实 Webview DOM 交互、Note 编辑、provider 切换后重启、删除按钮、`Agent` / `Terminal` 执行生命周期、live session 切面 / reload 竞态、故障注入与 PTY 边界。
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

## 常见误区

- `Run Dev Session Canvas` 不是命令面板命令，而是调试配置名称。
- `Run Dev Session Canvas` 依赖专用 profile `Dev Session Canvas Extension Debug`；若该 profile 里缺少 `Remote Development`，Remote-SSH 调试不会正常工作。
- `Run Dev Session Canvas` 不会自动禁用扩展的已安装副本；正确做法是不要将其装入 debug profile。
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
