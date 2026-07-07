# Notifier 公开 Preview 发布执行手册

本文用于收口 `Dev Session Canvas Notifier` 的公开扩展市场发布素材、手工发布步骤、安装启用口径与发布后复核动作。当前目标版本为 `0.23.0`，publisher 沿用 `devsessioncanvas`，扩展 ID 为 `devsessioncanvas.dev-session-canvas-notifier`。

当前约定是：notifier 的版本号继续与主扩展 `Dev Session Canvas` 对齐。也就是说，只要 notifier 仍以 companion 身份随主扩展同轮迭代发布，就继续使用同一个 `0.x.y` 版本号；如果未来 notifier 需要在主扩展不发版的情况下单独迭代，则必须先重新确认是否继续沿用“版本对齐”策略，避免同一版本号对应两组不同的发布事实。本轮 `0.23.0` 需要保持两侧 manifest / changelog / 产物名同版本；notifier 本轮新增本地化资源与 smoke 覆盖，但不改变通知协议、后端选择或点击回跳语义。

## 当前发布素材

- Marketplace listing 英文默认正文：`extensions/vscode/dev-session-canvas-notifier/README.marketplace.md`
- Marketplace listing 中文对应版：`extensions/vscode/dev-session-canvas-notifier/README.marketplace.zh-CN.md`（仅作仓库内中文对应文案，不作为默认打包输入）
- release notes：`extensions/vscode/dev-session-canvas-notifier/CHANGELOG.md`
- 图标资产：`extensions/vscode/dev-session-canvas-notifier/images/icon.png`
- 图标矢量源：`extensions/vscode/dev-session-canvas-notifier/images/icon.svg`
- Activity Bar icon：`extensions/vscode/dev-session-canvas-notifier/images/activitybar.svg`
- 许可证：`extensions/vscode/dev-session-canvas-notifier/LICENSE`
- manifest：`extensions/vscode/dev-session-canvas-notifier/package.json`
- 独立 VSIX 打包脚本：`extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs`

## Marketplace 定稿口径

- notifier 不是独立替代品；对外文案必须继续明确“主扩展负责画布、节点执行与 attention 判定，notifier 负责本机 UI 侧桌面通知投递”。
- 默认 Marketplace listing 使用英文，命令、视图、设置、sidebar 和手动测试通知文案跟随 VS Code locale 提供英文默认与简体中文本地化；中文 listing 对应版只保存在仓库内。
- 安装说明统一写成：
  1. 安装 `Dev Session Canvas Notifier`
  2. 若当前尚未安装主扩展，VS Code 会自动补齐 `Dev Session Canvas`
  3. 如果用户从主扩展页面安装，VS Code 也会自动带上 notifier
  4. 主扩展默认已把 `devSessionCanvas.notifications.attentionSignalBridge` 收口到 `system`
  5. 如需静音请求，再把 `devSessionCanvasNotifier.notifications.playSound` 设为 `false`
- 两个扩展当前通过“主扩展 `extensionPack` 自动带上 notifier + notifier 单向 `extensionDependencies` 自动补齐主扩展”来收口安装体验；继续保持两个独立 VSIX，而不是额外引入第三个 extension pack。repo-local smoke / VSIX smoke 为了装配 development host 或 packaged payload 会临时移除这些安装期关系，因此真正的自动补齐安装路径仍要在 clean profile 安装步骤里单独复核。
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
   - `extensions/vscode/dev-session-canvas-notifier/README.marketplace.md`（英文默认）
   - `extensions/vscode/dev-session-canvas-notifier/README.marketplace.zh-CN.md`（中文对应版）
   - `extensions/vscode/dev-session-canvas-notifier/package.nls.json`
   - `extensions/vscode/dev-session-canvas-notifier/package.nls.zh-cn.json`
   - `extensions/vscode/dev-session-canvas-notifier/l10n/bundle.l10n.zh-cn.json`
   - `extensions/vscode/dev-session-canvas-notifier/LICENSE`
   - `extensions/vscode/dev-session-canvas-notifier/images/icon.png`
5. 在最终 release checkout 中执行：

       npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix

   若当前打包目录不含 `.git` 元数据，则改为：

       DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref> npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix

6. 在最终 release checkout 中运行 notifier 本地化与 companion smoke：

       npm run test:notifier-source
       npm run test:notifier-smoke
       npm run test:notifier-locale-smoke

   `test:notifier-smoke` 验证主扩展 attention bridge 到 notifier callback 再回到画布居中；`test:notifier-locale-smoke` 验证英文 / 简体中文真实 VS Code 宿主中 notifier sidebar、view title、手动测试通知、工作台提示和 action label 随 locale 切换。
7. 确认打包日志打印了 `VSCE README doc ref: <final-ref-or-sha>`；如果当前 `README.marketplace.md` 没有相对链接，日志也应显式打印“当前没有需要重写的相对链接”，避免误把“没有输出”当成脚本未校验。
8. 确认 workflow 仍会把 notifier 与主扩展同轮上传到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布和验证，但当前可记录为 deferred channel，不阻塞 `0.23.0` 完成。
9. 复核 Open VSX namespace / token、`OVSX_PAT`、本地 `vsce login devsessioncanvas` 与 `VSCE_PAT`；当前完成门禁要求 Open VSX 可验证，`VSCE_PAT` 用于尝试 Visual Studio Marketplace 补发 / 验证。GitHub Release assets 只是额外下载入口。

## 发布命令

在最终 git ref、版本号与 VSIX 产物都锁定后，默认从仓库根目录使用 `publish/vX.Y.Z` 临时 tag 触发统一发布入口；这里的临时 tag 必须指向已经位于 `main` 上的 release commit。主扩展与 notifier 仍由同一个发布脚本同步处理：

    git tag publish/v0.23.0 <final-ref-or-sha>
    git push origin publish/v0.23.0

推送临时 tag 后，`.github/workflows/publish-marketplace-release.yml` 会先执行：

    npm run release:publish-tag -- --trigger-tag publish/v0.23.0 --package-only

workflow 只应由 `publish/v*` tag push 或手动 `workflow_dispatch` 触发；创建普通分支、普通 tag 或 release 分支不应产生 skipped publish run。若 Actions 列表出现这类噪音，应优先修正 workflow 触发条件，而不是把 skipped run 当作真实 notifier 发布动作。

workflow 随后会把 notifier VSIX 与主扩展 VSIX、release manifest 一起上传到 `v0.23.0` 对应的 GitHub Release assets。GitHub 不支持裸 tag assets，因此用户下载入口是 GitHub Release 的 Assets 区，不是 tag 对象本身。上传 Release assets 后，workflow 会继续复用同一份 manifest / VSIX，分别发布并验证 Open VSX 与 Visual Studio Marketplace：

    npm run release:publish-tag -- --trigger-tag publish/v0.23.0 --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/v0.23.0 --skip-package --target visual-studio --no-create-final-tag

两个 marketplace 不再互相串行阻断；其中一个目标失败时，另一个目标仍会尝试发布和验证。workflow 在两个目标都跑完后上传最终 manifest，并根据 `CHANGELOG.md` 与 manifest 重新生成 GitHub Release notes，确保 Release 页面包含版本亮点、渠道状态、残余风险和发布证据。本轮 `0.23.0` 完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 若仍不可见，则以 deferred channel 写入 manifest / notes，不阻塞删除 `publish/v0.23.0` 临时 tag。如果 Open VSX 失败，Release assets 和最终 Release notes 保留为手动安装兜底，失败的 Open VSX job 会在上传自身结果 manifest 后标红，finalize job 也会在收口 Release 状态后标红，临时 tag 保留，便于使用 GitHub Actions 的 Re-run failed jobs 或 workflow_dispatch 重跑同一 release input。重跑同一版本时，workflow 会下载并校验 `v0.23.0` Release 中已有的 notifier VSIX、主扩展 VSIX 与 manifest，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

若 GitHub Actions 中某个 marketplace 目标失败，或需要只重跑 notifier 到某个市场，可保留或重新创建同一个 `publish/v0.23.0`，复用同一份 manifest / VSIX，并限定扩展与市场：

    npm run release:publish-tag -- --trigger-tag publish/v0.23.0 --skip-package --extension notifier --target visual-studio --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.23.0 --skip-package --extension notifier --target open-vsx --no-create-final-tag

注意：`publish --packagePath` 与 Open VSX publish 都只上传现成 VSIX，不会重新改写 README 或重新补资源 URL。因此发布前必须重新执行一次 package；发布失败后的同版本重跑必须复用 GitHub Release 中已有的 VSIX / manifest，并在使用 `--skip-package` 时让 `release:publish-tag` 校验已有 release manifest 与 notifier VSIX sha256，证明它针对同一个 release ref 完成过打包。

## Tag 与版本对齐约束

- 如果 notifier 与主扩展共用同一个、已经位于 `main` 上的 release commit，继续复用主扩展的正式 `v<release-version>` 仓库 tag，不单独再发 notifier 专属 tag。
- `publish/v<release-version>` 只是临时发布触发 tag；发布失败时保留用于重跑。`0.23.0` 本轮在 GitHub Release assets 已上传、Open VSX 发布验证成功、Visual Studio Marketplace 已记录为 verified 或 deferred 且正式 `v<release-version>` 已推送后可以删除。同版本重跑必须复用并校验既有 Release assets；若 Release assets 不完整，先人工修复或删除不完整状态。
- 如果 notifier 准备从另一个 commit 单独发布，但版本号仍想保持 `v<release-version>` 对应的同一组数字，这会让“同一个版本号对应哪个发布输入”变得不清晰；此时必须先决定是一起 bump 版本，还是显式放弃“版本对齐”策略，再继续发布。

## 发布后验证

1. 打开 Open VSX 页面，确认 notifier 与主扩展都已经同步到本轮版本，名称、图标、README 文案、issue 链接与许可证信息没有失真；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 标记为 deferred。
2. 打开 GitHub Release 页面，确认 notifier VSIX、主扩展 VSIX 与 release manifest 都存在于 Assets 中。
3. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX，并分别验证两条安装路径。Visual Studio Marketplace 恢复后再补做该路径验证：
   - 只安装 `Dev Session Canvas Notifier`，确认 VS Code 会自动补齐 `Dev Session Canvas`
   - 卸载后只安装 `Dev Session Canvas`，确认 VS Code 会自动补齐 `Dev Session Canvas Notifier`
4. 确认主扩展设置里的 `devSessionCanvas.notifications.attentionSignalBridge` 默认值是 `system`。
5. 英文 / 简体中文 locale 文案已有 `npm run test:notifier-locale-smoke` 自动覆盖；发布后仍应各手动运行一次 `Dev Session Canvas Notifier: Send Test Desktop Notification` / `Dev Session Canvas Notifier: 发送测试桌面通知`，重点确认真实系统通知确实出现，以及在支持平台上点击后是否能回到 VS Code。
6. 英文 locale 下运行 `Dev Session Canvas Notifier: Open Notification Diagnostic Output`，简体中文 locale 下运行 `Dev Session Canvas Notifier: 打开通知诊断输出`，确认 `backend`、`activationMode` 与最近一次投递结果符合当前平台预期。

## 当前验证备注

- notifier 子包现在已经显式提供 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`，可直接从仓库根目录执行；真正产物文件名以当前 notifier manifest 版本为准，而不是手册里预设的常量。
- notifier 的打包脚本现已固定打印 `VSCE README doc ref`；即使当前 `README.marketplace.md` 没有相对链接，也会显式输出“当前没有需要重写的相对链接”，便于 release-day 复核“最终发布 ref 已参与打包校验”。
- notifier 现在与主扩展一样使用英文默认 + 简体中文本地化资源；发布前必须确认 VSIX file list 包含 `package.nls.json`、`package.nls.zh-cn.json` 与 `l10n/bundle.l10n.zh-cn.json`，并运行 `npm run test:notifier-locale-smoke` 覆盖真实英文 / 简体中文宿主文案。
- `0.22.0` 已从最终 `main` release ref `b56fce2c74b2aefe383c1cb03fdfea522079b3cc` 完成 GitHub Release assets + Open VSX 兜底发布；GitHub Release `v0.22.0` 已包含 notifier VSIX、主扩展 VSIX 与 release manifest assets。Release manifest 记录 Open VSX notifier `0.22.0` 与主扩展 `0.22.0` 均 verified，Visual Studio Marketplace public gallery / 发布状态仍为 deferred / `publish-failed`，因此 notifier 的 VSM 页面不得宣称为已可用。
- `0.23.0` 发布准备分支已同步 notifier manifest、notifier changelog 与本手册中的目标版本；notifier 本轮继续随主扩展对齐版本，并把英文默认 / 简体中文本地化、真实宿主 locale smoke 和两条真实 development extension 的 companion smoke 作为发布输入。当前分支 repo-local 验证已通过 `npm run build:notifier`、`npm run typecheck:notifier`、`npm run test:notifier-source`、`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`、`npm run test:notifier-smoke` 与 `npm run test:notifier-locale-smoke`；notifier VSIX 为 `extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.23.0.vsix`（`14` files，`154.97 KB` / `158,689 bytes`，`sha256=5aa861f57d55b81712bfe11da57df2da6e4f54477f96a7e52c64f5e788b633b7`）。这些只作为发布准备分支证据，最终 Release assets 仍以发布准备 MR 合入后的 clean `main` ref 重新打包 / manifest 记录为准。
- 当前分支也已通过 `npm run test:vsix-smoke` packaged-payload smoke，以及 `npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke` 的隔离主扩展打包验证；但 clean-checkout 命令本轮显式跳过内置 VSIX smoke，最终发布日仍需在合并后的 clean `main` ref 上重跑完整 gate 与 `publish/v0.23.0` dry-run。
- 仍需单独记住的一点是：repo-local staged smoke / VSIX smoke 会为了装配 development host 或 packaged payload 临时移除 `extensionDependencies` / `extensionPack`，因此“真实安装时是否自动补齐依赖”必须通过上面的 clean profile 安装步骤复核，不能把 staged smoke 直接当成这条结论的自动化证据。
