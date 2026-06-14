# Notifier 公开 Preview 发布执行手册

本文用于收口 `Dev Session Canvas Notifier` 的公开扩展市场发布素材、手工发布步骤、安装启用口径与发布后复核动作。当前目标版本为 `0.15.2`，publisher 沿用 `devsessioncanvas`，扩展 ID 为 `devsessioncanvas.dev-session-canvas-notifier`。

当前约定是：notifier 的版本号继续与主扩展 `Dev Session Canvas` 对齐。也就是说，只要 notifier 仍以 companion 身份随主扩展同轮迭代发布，就继续使用同一个 `0.x.y` 版本号；如果未来 notifier 需要在主扩展不发版的情况下单独迭代，则必须先重新确认是否继续沿用“版本对齐”策略，避免同一版本号对应两组不同的发布事实。当前这轮 `0.15.2` 发布准备已经把两侧 manifest / changelog / 产物名同步到同一版本号；后续若再改目标版本，必须一起改回正式文档与验证记录。

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
7. 确认 workflow 仍会把 notifier 与主扩展同轮发布并验证到 Visual Studio Marketplace / Open VSX，同时把 notifier VSIX、主扩展 VSIX 与 release manifest 上传到同一个 GitHub Release assets 列表。
8. 复核本地 `vsce login devsessioncanvas`、Open VSX namespace / token 和相关 repository secrets；当前 workflow 仍要求 `VSCE_PAT` / `OVSX_PAT`，GitHub Release assets 只是额外下载入口。

## 发布命令

在最终 git ref、版本号与 VSIX 产物都锁定后，默认从仓库根目录使用 `publish/vX.Y.Z` 临时 tag 触发统一发布入口；这里的临时 tag 必须指向已经位于 `main` 上的 release commit。主扩展与 notifier 仍由同一个发布脚本同步处理：

    git tag publish/v0.15.2 <final-ref-or-sha>
    git push origin publish/v0.15.2

推送临时 tag 后，`.github/workflows/publish-marketplace-release.yml` 会先执行：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.2 --package-only

workflow 只应由 `publish/v*` tag push 或手动 `workflow_dispatch` 触发；创建普通分支、普通 tag 或 release 分支不应产生 skipped publish run。若 Actions 列表出现这类噪音，应优先修正 workflow 触发条件，而不是把 skipped run 当作真实 notifier 发布动作。

workflow 随后会把 notifier VSIX 与主扩展 VSIX、release manifest 一起上传到 `v0.15.2` 对应的 GitHub Release assets。GitHub 不支持裸 tag assets，因此用户下载入口是 GitHub Release 的 Assets 区，不是 tag 对象本身。上传 Release assets 后，workflow 会继续复用同一份 manifest / VSIX 发布并验证 Visual Studio Marketplace 与 Open VSX：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.2 --skip-package

只有 marketplace 发布与验证成功后，workflow 才删除 `publish/v0.15.2` 临时 tag；如果 marketplace 失败，Release assets 保留为手动安装兜底，job 失败且临时 tag 保留，便于重跑同一 release input。重跑同一版本时，workflow 会下载并校验 `v0.15.2` Release 中已有的 notifier VSIX、主扩展 VSIX 与 manifest，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

若 GitHub Actions 中某个 marketplace 目标失败，或需要只重跑 notifier 到某个市场，可保留或重新创建同一个 `publish/v0.15.2`，复用同一份 manifest / VSIX，并限定扩展与市场：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.2 --skip-package --extension notifier --target visual-studio --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.15.2 --skip-package --extension notifier --target open-vsx --no-create-final-tag

注意：`publish --packagePath` 与 Open VSX publish 都只上传现成 VSIX，不会重新改写 README 或重新补资源 URL。因此发布前必须重新执行一次 package；发布失败后的同版本重跑必须复用 GitHub Release 中已有的 VSIX / manifest，并在使用 `--skip-package` 时让 `release:publish-tag` 校验已有 release manifest 与 notifier VSIX sha256，证明它针对同一个 release ref 完成过打包。

## Tag 与版本对齐约束

- 如果 notifier 与主扩展共用同一个、已经位于 `main` 上的 release commit，继续复用主扩展的正式 `v<release-version>` 仓库 tag，不单独再发 notifier 专属 tag。
- `publish/v<release-version>` 只是临时发布触发 tag；发布失败时保留用于重跑，GitHub Release assets 已上传、Visual Studio Marketplace / Open VSX 发布验证成功且正式 `v<release-version>` 已推送后可以删除。同版本重跑必须复用并校验既有 Release assets；若 Release assets 不完整，先人工修复或删除不完整状态。
- 如果 notifier 准备从另一个 commit 单独发布，但版本号仍想保持 `v<release-version>` 对应的同一组数字，这会让“同一个版本号对应哪个发布输入”变得不清晰；此时必须先决定是一起 bump 版本，还是显式放弃“版本对齐”策略，再继续发布。

## 发布后验证

1. 打开 Visual Studio Marketplace 与 Open VSX 页面，确认 notifier 与主扩展都已经同步到本轮版本，名称、图标、README 文案、issue 链接与许可证信息没有失真。
2. 打开 GitHub Release 页面，确认 notifier VSIX、主扩展 VSIX 与 release manifest 都存在于 Assets 中。
3. 在干净 profile 中优先从 Marketplace / Open VSX 安装或升级；另从 GitHub Release 下载 VSIX，并分别验证两条安装路径：
   - 只安装 `Dev Session Canvas Notifier`，确认 VS Code 会自动补齐 `Dev Session Canvas`
   - 卸载后只安装 `Dev Session Canvas`，确认 VS Code 会自动补齐 `Dev Session Canvas Notifier`
4. 确认主扩展设置里的 `devSessionCanvas.notifications.attentionSignalBridge` 默认值是 `system`。
5. 运行 `Dev Session Canvas Notifier: 发送测试桌面通知`，确认系统通知出现，并在支持平台上验证点击后是否能回到 VS Code。
6. 运行 `Dev Session Canvas Notifier: 打开通知诊断输出`，确认 `backend`、`activationMode` 与最近一次投递结果符合当前平台预期。

## 当前验证备注

- notifier 子包现在已经显式提供 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`，可直接从仓库根目录执行；真正产物文件名以当前 notifier manifest 版本为准，而不是手册里预设的常量。
- notifier 的打包脚本现已固定打印 `VSCE README doc ref`；即使当前 `README.marketplace.md` 没有相对链接，也会显式输出“当前没有需要重写的相对链接”，便于 release-day 复核“最终发布 ref 已参与打包校验”。
- 截至 `2026-06-14`，上一轮 `0.15.1` 的远端正式 tag `v0.15.1` 指向 `d33679244aaf4451be61960280168a74d6e35797`，但 `gh release view v0.15.1` 返回 `release not found`，因此上一轮没有可复用的 GitHub Release assets。Open VSX API 显示 notifier latest 为 `0.15.1`，但 Visual Studio Marketplace 公开 item 页面仍返回 404，public gallery `extensionquery` 对 `devsessioncanvas.dev-session-canvas-notifier` 返回 0 个结果。因此当前不能把 notifier 上一轮写成已完成双市场公开可见发布；`0.15.2` 最终 publish 前必须先确认 notifier 在 Visual Studio Marketplace 的可见性 / verification gate 已恢复。
- 已用 `git fetch origin main --tags` 重新确认本轮发布准备基线为 `a1a0660d2c35f5e011ae9e464bcc509a57bc219e`（短 SHA `a1a0660`），当前 `0.15.2` 发布准备从该最新 `main` 切出，继续保持 notifier manifest 与 changelog 的 `0.15.2` 版本事实。本轮主扩展聚焦执行节点 attention signal allow-list、Codex 最终失败文本提醒、Claude Agent `Ctrl-Z` / `fg` 误导状态收口、画布外部链接打开方式配置，以及 GitHub Release assets 镜像 / 复用发布流程；notifier companion 不引入新的通知投递行为变更。本轮已通过 `npm run build:notifier`、`npm run test:notifier-source` 与 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`；notifier VSIX 为 `extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.15.2.vsix`，10 files，约 144.31 KB（本轮本地打包观测；最终字节数以合并后最终 ref 复跑为准），打包日志已打印当次 release-prep HEAD 作为 `VSCE README doc ref`。发布准备 MR 合并后还需在最终 `main` ref 上复跑 notifier 打包，确认 VSIX 文件名、README doc ref、文件数与大小都来自最终发布 ref。
- 仍需单独记住的一点是：repo-local staged smoke / VSIX smoke 会为了装配 wrapper 临时移除 `extensionDependencies` / `extensionPack`，因此“真实安装时是否自动补齐依赖”必须通过上面的 clean profile 安装步骤复核，不能把 wrapper smoke 直接当成这条结论的自动化证据。
