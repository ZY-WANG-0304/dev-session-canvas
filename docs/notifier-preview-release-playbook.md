# Notifier 公开 Preview 发布执行手册

本文用于收口 `Dev Session Canvas Notifier` 的 Marketplace 发布素材、手工发布步骤、安装启用口径与发布后复核动作。当前目标版本为 `0.5.0`，publisher 沿用 `devsessioncanvas`，扩展 ID 为 `devsessioncanvas.dev-session-canvas-notifier`。

当前约定是：notifier 的版本号继续与主扩展 `Dev Session Canvas` 对齐。也就是说，只要 notifier 仍以 companion 身份随主扩展同轮迭代发布，就继续使用同一个 `0.x.y` 版本号；如果未来 notifier 需要在主扩展不发版的情况下单独迭代，则必须先重新确认是否继续沿用“版本对齐”策略，避免同一版本号对应两组不同的发布事实。

## 当前发布素材

- Marketplace listing 正文：`extensions/vscode/dev-session-canvas-notifier/README.marketplace.md`
- release notes：`extensions/vscode/dev-session-canvas-notifier/CHANGELOG.md`
- 图标资产：`extensions/vscode/dev-session-canvas-notifier/images/icon.png`
- 图标矢量源：`extensions/vscode/dev-session-canvas-notifier/images/icon.svg`
- Activity Bar icon：`extensions/vscode/dev-session-canvas-notifier/images/activitybar.svg`
- 许可证：`extensions/vscode/dev-session-canvas-notifier/LICENSE`
- manifest：`extensions/vscode/dev-session-canvas-notifier/package.json`
- 独立 VSIX 打包脚本：`extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs`

## Marketplace 定稿口径

- notifier 不是独立替代品；对外文案必须继续明确“主扩展负责画布、节点执行与 attention 判定，notifier 负责本机 UI 侧桌面通知投递”。
- 安装说明统一写成：
  1. 安装 `Dev Session Canvas Notifier`
  2. 若当前尚未安装主扩展，VS Code 会自动补齐 `Dev Session Canvas`
  3. 如果用户从主扩展页面安装，VS Code 也会自动带上 notifier
  4. 在主扩展设置中把 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `system`
  5. 如需静音请求，再把 `devSessionCanvasNotifier.notifications.playSound` 设为 `false`
- 两个扩展当前通过双向 `extensionDependencies` 自动收口安装体验；继续保持两个独立 VSIX，而不是额外引入第三个 extension pack。
- 不再继续使用 legacy 配置键 `devSessionCanvas.notifications.preferNotifierCompanion` 作为对外说明；当前正式配置键是 `devSessionCanvas.notifications.attentionSignalBridge`。
- `system` 模式的正式口径是：优先调用 notifier companion；若 companion 缺失、当前平台不支持或投递失败，则自动回退到 VS Code 工作台消息。

## Preview 边界

- 当前仍是 companion extension 的公开 `Preview`，不承诺所有平台都具备完全一致的点击回跳体验。
- 缺少主扩展时，本扩展不会单独提供画布、节点执行或 attention 判定能力。
- `Remote SSH`、WSL、Dev Container 等“主扩展在 workspace 侧、通知需要回到本机桌面”的场景，仍是最能体现 companion 价值的主推荐路径。

## 发布前检查

1. 锁定最终 git ref、版本号与 VSIX 文件名；当前默认产物名为 `dev-session-canvas-notifier-0.5.0.vsix`。
2. 复核以下文件的版本事实一致：
   - `extensions/vscode/dev-session-canvas-notifier/package.json`
   - `extensions/vscode/dev-session-canvas-notifier/CHANGELOG.md`
   - `package-lock.json`
3. 复核以下发布素材已经定稿，且没有引用仓库外或子包目录外的相对路径：
   - `extensions/vscode/dev-session-canvas-notifier/README.marketplace.md`
   - `extensions/vscode/dev-session-canvas-notifier/LICENSE`
   - `extensions/vscode/dev-session-canvas-notifier/images/icon.png`
4. 在最终 release checkout 中执行：

       npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix

   若当前打包目录不含 `.git` 元数据，则改为：

       DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref> npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix

5. 确认打包日志打印了 `VSCE README doc ref: <final-ref-or-sha>`，且没有出现 README 相对链接越界或 git ref 校验失败。
6. 确认本地 `vsce login devsessioncanvas` 仍有效，发布账号继续沿用 `devsessioncanvas`，不需要为 notifier 单独新建 publisher。

## 发布命令

在最终 git ref、版本号与 VSIX 产物都锁定后，从仓库根目录执行：

    node node_modules/@vscode/vsce/vsce publish \
      --packagePath extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.5.0.vsix

若最终版本号不是 `0.5.0`，应先同步更新命令中的文件名。

注意：`publish --packagePath` 只上传现成 VSIX，不会重新改写 README 或重新补资源 URL。因此发布前必须重新执行一次 `package:vsix`，并确保它针对最终发布 ref 完成过 README 重写目标校验。

## Tag 与版本对齐约束

- 如果 notifier 与主扩展共用同一个 release commit，继续复用主扩展的 `v0.5.0` 仓库 tag 即可，不单独再发一个 notifier 专属 tag。
- 如果 notifier 准备从另一个 commit 单独发布，但版本号仍想保持 `0.5.0`，这会让“同一个版本号对应哪个发布输入”变得不清晰；此时必须先决定是一起 bump 版本，还是显式放弃“版本对齐”策略，再继续发布。

## 发布后验证

1. 打开 Marketplace 页面，确认名称、图标、README 文案、issue 链接与许可证信息没有失真。
2. 在干净 profile 中同时安装：
   - `Dev Session Canvas`
   - `Dev Session Canvas Notifier`
3. 在主扩展设置中将 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `system`。
4. 运行 `Dev Session Canvas Notifier: 发送测试桌面通知`，确认系统通知出现，并在支持平台上验证点击后是否能回到 VS Code。
5. 运行 `Dev Session Canvas Notifier: 打开通知诊断输出`，确认 `backend`、`activationMode` 与最近一次投递结果符合当前平台预期。

## 当前验证备注

- 当前开发机（`macOS 26.3.1` + `Visual Studio Code 1.118.1`）上，`npm run test:notifier-smoke` 会在 VS Code test host 启动阶段直接 `SIGABRT`；同样现象可用最小临时扩展复现，因此当前更像宿主 / 环境级问题，而不是 notifier smoke 用例本身失败。
- 当前本地仍可作为有效证据保留的验证包括：`npm run package:vsix`、`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`、`npm run test:notifier-source`，以及真实桌面通知的人工验收。
- 如需继续推进 notifier smoke，优先在另一台设备、不同 macOS 版本，或后续 VS Code / Electron 版本上复核。
