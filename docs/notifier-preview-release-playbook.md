# Notifier 公开 Preview 发布执行手册

本文用于收口 `Dev Session Canvas Notifier` 的 Marketplace 发布素材、手工发布步骤、安装启用口径与发布后复核动作。当前目标版本为 `0.10.0`，publisher 沿用 `devsessioncanvas`，扩展 ID 为 `devsessioncanvas.dev-session-canvas-notifier`。

当前约定是：notifier 的版本号继续与主扩展 `Dev Session Canvas` 对齐。也就是说，只要 notifier 仍以 companion 身份随主扩展同轮迭代发布，就继续使用同一个 `0.x.y` 版本号；如果未来 notifier 需要在主扩展不发版的情况下单独迭代，则必须先重新确认是否继续沿用“版本对齐”策略，避免同一版本号对应两组不同的发布事实。当前这轮 `0.10.0` 发布准备已经把两侧 manifest / changelog / 产物名同步到同一版本号；后续若再改目标版本，必须一起改回正式文档与验证记录。

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
  4. 主扩展默认已把 `devSessionCanvas.notifications.attentionSignalBridge` 收口到 `system`
  5. 如需静音请求，再把 `devSessionCanvasNotifier.notifications.playSound` 设为 `false`
- 两个扩展当前通过“主扩展 `extensionPack` 自动带上 notifier + notifier 单向 `extensionDependencies` 自动补齐主扩展”来收口安装体验；继续保持两个独立 VSIX，而不是额外引入第三个 extension pack。需要注意的是，repo-local smoke / VSIX smoke 为了加载 staged wrapper 会临时移除这些安装期关系，因此真正的自动补齐安装路径仍要在 clean profile 安装步骤里单独复核。
- 不再继续使用 legacy 配置键 `devSessionCanvas.notifications.preferNotifierCompanion` 作为对外说明；当前正式配置键是 `devSessionCanvas.notifications.attentionSignalBridge`。
- `system` 模式的正式口径是：优先调用 notifier companion；若 companion 缺失、当前平台不支持或投递失败，则自动回退到 VS Code 工作台消息。

## Preview 边界

- 当前仍是 companion extension 的公开 `Preview`，不承诺所有平台都具备完全一致的点击回跳体验。
- 缺少主扩展时，本扩展不会单独提供画布、节点执行或 attention 判定能力。
- `Remote SSH`、WSL、Dev Container 等“主扩展在 workspace 侧、通知需要回到本机桌面”的场景，仍是最能体现 companion 价值的主推荐路径。

## 发布前检查

以下步骤默认建立在一个前提上：notifier 对应的 feature 均已经先合入 `main`，发布物料也已经通过独立发布准备分支 review 并回到 `main`。真正执行 `publish` 时，应站在 `main` 上对应的最终发布 commit，而不是仍停留在未合并的发布准备分支 head。

1. 锁定最终 git ref、版本号与 VSIX 文件名；notifier 产物名默认遵循 `dev-session-canvas-notifier-<notifier-version>.vsix`。
2. 若刚切到最终 git ref，或这轮同步带来了 `package-lock.json` / workspace 依赖变化，先在仓库根目录执行一次 `npm install`（干净 release checkout 则执行 `npm ci`），刷新 workspace link 与本地 `@vscode/vsce` 安装；否则后续打包阶段可能在 `npm list` 或 `vsce` 入口解析时误报缺少 workspace 依赖。
3. 复核以下文件的版本事实一致：
   - `extensions/vscode/dev-session-canvas-notifier/package.json`
   - `extensions/vscode/dev-session-canvas-notifier/CHANGELOG.md`
   - `package-lock.json`
4. 复核以下发布素材已经定稿，且没有引用仓库外或子包目录外的相对路径：
   - `extensions/vscode/dev-session-canvas-notifier/README.marketplace.md`
   - `extensions/vscode/dev-session-canvas-notifier/LICENSE`
   - `extensions/vscode/dev-session-canvas-notifier/images/icon.png`
5. 在最终 release checkout 中执行：

       npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix

   若当前打包目录不含 `.git` 元数据，则改为：

       DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref> npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix

6. 确认打包日志打印了 `VSCE README doc ref: <final-ref-or-sha>`；如果当前 `README.marketplace.md` 没有相对链接，日志也应显式打印“当前没有需要重写的相对链接”，避免误把“没有输出”当成脚本未校验。
7. 确认本地 `vsce login devsessioncanvas` 仍有效，发布账号继续沿用 `devsessioncanvas`，不需要为 notifier 单独新建 publisher。

## 发布命令

在最终 git ref、版本号与 VSIX 产物都锁定后，从仓库根目录执行；这里的最终 git ref 默认应是已经位于 `main` 上的发布 commit：

    node node_modules/@vscode/vsce/vsce publish \
      --packagePath extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-<notifier-version>.vsix

将 `<notifier-version>` 替换为 `extensions/vscode/dev-session-canvas-notifier/package.json` 中已经锁定的最终版本号。

注意：`publish --packagePath` 只上传现成 VSIX，不会重新改写 README 或重新补资源 URL。因此发布前必须重新执行一次 `package:vsix`，并确保它针对最终发布 ref 完成过 README 重写目标校验。

## Tag 与版本对齐约束

- 如果 notifier 与主扩展共用同一个、已经位于 `main` 上的 release commit，继续复用主扩展的 `v<release-version>` 仓库 tag 即可，不单独再发一个 notifier 专属 tag。
- 如果 notifier 准备从另一个 commit 单独发布，但版本号仍想保持 `v<release-version>` 对应的同一组数字，这会让“同一个版本号对应哪个发布输入”变得不清晰；此时必须先决定是一起 bump 版本，还是显式放弃“版本对齐”策略，再继续发布。

## 发布后验证

1. 打开 Marketplace 页面，确认名称、图标、README 文案、issue 链接与许可证信息没有失真。
2. 在干净 profile 中分别验证两条安装路径：
   - 只安装 `Dev Session Canvas Notifier`，确认 VS Code 会自动补齐 `Dev Session Canvas`
   - 卸载后只安装 `Dev Session Canvas`，确认 VS Code 会自动补齐 `Dev Session Canvas Notifier`
3. 确认主扩展设置里的 `devSessionCanvas.notifications.attentionSignalBridge` 默认值是 `system`。
4. 运行 `Dev Session Canvas Notifier: 发送测试桌面通知`，确认系统通知出现，并在支持平台上验证点击后是否能回到 VS Code。
5. 运行 `Dev Session Canvas Notifier: 打开通知诊断输出`，确认 `backend`、`activationMode` 与最近一次投递结果符合当前平台预期。

## 当前验证备注

- notifier 子包现在已经显式提供 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`，可直接从仓库根目录执行；真正产物文件名以当前 notifier manifest 版本为准，而不是手册里预设的常量。
- notifier 的打包脚本现已固定打印 `VSCE README doc ref`；即使当前 `README.marketplace.md` 没有相对链接，也会显式输出“当前没有需要重写的相对链接”，便于 release-day 复核“最终发布 ref 已参与打包校验”。
- 截至 `2026-05-14`，当前 `0.10.0` 发布准备工作树已重新通过 `npm run build:notifier`、`npm run test:notifier-source` 与 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`；其中 notifier VSIX 已生成到 `extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.10.0.vsix`，该次打包日志打印了 `VSCE README doc ref: 807d89516663903413c9711a9ac6ca9540ea0c32`，显式确认当前 README 无需重写相对链接，并生成 10 个文件、约 90.78 KB 的 VSIX。该 ref 是本次 repo-local 打包执行时脚本解析到的当前 `HEAD`，发布准备 MR 合并后仍需在最终 `main` ref 上重新打包。
- 仍需单独记住的一点是：repo-local staged smoke / VSIX smoke 会为了装配 wrapper 临时移除 `extensionDependencies` / `extensionPack`，因此“真实安装时是否自动补齐依赖”必须通过上面的 clean profile 安装步骤复核，不能把 wrapper smoke 直接当成这条结论的自动化证据。
