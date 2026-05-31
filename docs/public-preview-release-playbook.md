# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明、验证记录与回退口径；当前目标版本为 `0.11.0`。当前版本范围收口为“发布画布节点分组、分组树侧栏、分组模板保存 / 应用、受限创建入口解释，并保留 `0.10.7` 的生产 Webview Terminal TUI 输入热修复、`0.10.6` 的 Agent 异常提醒、`0.10.5` 的 Note Markdown 源码定位 / 可恢复草稿修复和既有双市场发布边界”。它不是对外宣传页，而是发布当天的执行与复核手册。

## 当前发布素材

- Marketplace listing 正文：`README.marketplace.md`（引用 `images/marketplace/canvas-overview.png` + `images/marketplace/canvas-overview.mp4`）
- Marketplace listing 中文对应版：`README.marketplace.zh-CN.md`（仅作仓库内中文对应文案，不作为默认打包输入）
- 仓库 README 默认英文：`README.md`（引用 `images/marketplace/canvas-overview.gif`）
- 仓库 README 中文对应版：`README.zh-CN.md`（引用 `images/marketplace/canvas-overview.gif`）
- release notes：`CHANGELOG.md`
- 主扩展图标资产：`images/icon.png`
- 圆形头像安全区图：`images/avatar.png`
- Preview 支持边界：`docs/support.md`
- 安全口径：`docs/SECURITY.md`
- 发布判断与背景：`docs/design-docs/public-marketplace-release-readiness.md`

## Marketplace listing 定稿口径

当前 listing 统一使用英文默认版 `README.marketplace.md`，不再直接复用仓库根目录 `README.md`。`README.marketplace.zh-CN.md` 仅作为仓库内中文对应版本保留，不改变默认 Marketplace 打包入口。

当前 `npm run package:vsix` 会在打包阶段显式传入 `--readme-path README.marketplace.md`，因此最终用于发布的 VSIX 已内嵌 Marketplace 专用 README；后续 `publish --packagePath` 只上传现成 VSIX，不会再替换 README。
打包脚本默认会把 README 相对资源改写到当前 `HEAD` 对应的 git ref；如果在没有 `.git` 元数据的 clean checkout、导出目录或 tarball 中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，否则不允许继续打包。

这样做的原因是：

- 仓库 `README.md` 仍需要描述公开 `Preview` 阶段下的开发者语境与源码开发入口
- Marketplace 页面需要一份面向已发布状态的对外文案，避免出现发布后立即失真的措辞
- 当前公开 Preview 的安装/升级说明也需要直接出现在商店页，而不是只藏在内部文档里
- 公开文案不应引入仓库内部历史包名或内部迁移背景，避免对 Marketplace 用户造成无关干扰

## release notes 定稿口径

当前 `0.11.0` 的 release notes 统一以 `CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。docs-only 变化不进入用户可见更新说明。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 顶部版本标题与 `CHANGELOG.md` 保持一致；当前标题为 `0.11.0 - Preview Canvas Groups Update`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：`0.11.0` 发布画布节点分组、分组树侧栏、分组模板保存 / 应用、受限创建入口解释，保留 `0.10.7` 的生产 Webview Terminal TUI 输入热修复、`0.10.6` 的 Agent 异常提醒、`0.10.5` 的 Note Markdown 源码定位 / 可恢复草稿修复、双市场同版本同步策略，以及 `Dev Session Canvas Notifier` companion 版本对齐
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.11.0`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.10.7` 升级到 `0.11.0` 将通过当前宿主配置的公开扩展市场常规安装 / 升级完成；官方 VS Code 仍以 `Visual Studio Marketplace` 为主路径，`Open VSX` 作为 VS Code 兼容宿主的补充渠道。后续 `0.11.x` 更新应保持两个公开市场同版本发布。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. 若用户此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.11.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息。
5. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.11.0` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.11.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.11.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.11.0` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 带有分组框、`Agent` / `Terminal` / `Note` 混合节点的主画布全局视图
2. 侧栏 `Nodes` 分组树与画布中对应分组的联动视图
3. `Remote SSH` 或运行时恢复主路径示意

若来不及补截图，不阻塞当前公开 `Preview` 更新。

## 发布前检查

以下步骤默认建立在一个前提上：当前版本对应的 feature 均已经先合入 `main`，发布物料也已经通过独立发布准备分支 review 并回到 `main`。真正执行 `publish` 和打 tag 时，应站在 `main` 上对应的最终发布 commit，而不是仍停留在未合并的发布准备分支 head。

1. 锁定最终要发布的 git ref、版本号与产物文件名。
2. 若刚切到最终 git ref，或这轮同步带来了 `package-lock.json` / workspace 依赖变化，先在仓库根目录执行一次 `npm install`（干净 release checkout 则执行 `npm ci`），刷新 workspace link 与本地 `@vscode/vsce` 安装；否则 `npm run package:vsix` 可能在 `npm list` 阶段误报缺少 workspace 依赖。
3. 在最终 git ref 上执行：

       npm run validate:clean-checkout:vsix -- --ref <final-ref>

4. 在带 `.git` 元数据的最终 release checkout 中执行：

       npm run package:vsix

   若当前打包目录不含 `.git` 元数据，则改为：

       DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref> npm run package:vsix

5. 确认打包日志已经打印当前 README 改写 ref，且没有出现相对媒体 URL 校验失败。
6. 复核以下文件与当前版本事实一致：
   - `README.marketplace.md`
   - `CHANGELOG.md`
   - `docs/support.md`
   - `docs/SECURITY.md`
7. 确认 `Visual Studio Marketplace` 发布账号仍可用，且本地 `vsce login devsessioncanvas` 已保持有效。
8. 确认 `Open VSX` 的 `devsessioncanvas` namespace 已完成 owner/verified 认领，发布 token 已写入 `~/.ovsx` 的 `devsessioncanvas` entry，且本地可执行：

       python3 scripts/release/openvsx-api.py --prefer-ipv4 verify-pat devsessioncanvas

## 当前验证备注

截至 `2026-05-31`，当前 `0.11.0` 发布准备工作树以 `0.10.7` 的 Terminal TUI 输入热修复为基线，新增画布节点分组、分组树侧栏、分组模板保存 / 应用、受限创建入口解释和分组渲染层级修复；这些结果用于证明发布准备分支在对应命令执行工作树上通过必要验证，不替代发布准备 MR 合并后在最终 `main` ref 上的 release-day 打包复跑：

- `0.11.0` 功能输入已经合入 `main`，当前 release prep 分支从最新 `main` 切出，版本号、主扩展 / notifier manifest 与 `package-lock.json` 已同步到 `0.11.0`
- 分组功能已有 repo-local 自动化入口：`npm run test:canvas-node-groups` 覆盖宿主状态、几何收口、模板 group 物化与非法引用处理；Playwright Webview 用例覆盖分组渲染、创建、选择、嵌套、拖动、resize、自动平移、侧栏/命令触发和滚动条回归
- 受限创建入口已有 Webview 回归，确认未信任 workspace 下 `Terminal` / `Agent` 入口仍显示，并通过 `webview/showCreateNodeBlockedReason` 请求宿主解释原因
- 发布准备分支在版本 bump 与发布文档更新后已重新通过 `git diff --check`、`npm run typecheck`、`npm run test:extension-manifest`、`npm run test:publish-marketplaces`、`npm run test:canvas-node-groups`、`npm run test:canvas-templates`、`npm run test:protocol-webview-messages`、`npm run build:notifier`、`npm run test:notifier-source`、`npm run build`、`npm run test:package-vsix-command`、`npm run test:webview-build-xterm-entry`、`node --check tests/vscode-smoke/extension-tests.cjs`，以及分组相关 Playwright 子集（16 个用例通过）
- `npm run publish:marketplaces -- --dry-run` 已通过，确认统一入口会解析 `0.11.0` 的主扩展与 notifier VSIX 文件名，并按 notifier 优先、主扩展随后顺序覆盖 Visual Studio Marketplace 与 Open VSX
- `npm run package:vsix` 已生成 `dev-session-canvas-0.11.0.vsix`（114 个文件，约 3.39 MB）；`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix` 已生成 `dev-session-canvas-notifier-0.11.0.vsix`（10 个文件，约 143.59 KB）
- 当前打包日志打印的 `VSCE README doc ref` 为工作树 HEAD `cdcca4bc34ffd0ffe7bae5e1743fe964fb3e75e3`；由于发布准备变更尚未合入最终发布 commit，这只能证明本轮打包脚本已执行 ref 校验，不替代最终 `main` ref 的 release-day 打包校验
- 真正发布前仍需在已经合入 `main` 的最终 ref 上重新执行 `npm run validate:clean-checkout:vsix -- --ref <final-ref>`、`npm run package:vsix` 与 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`，确认 README 相对链接改写、VSIX 文件数 / 大小、`VSCE README doc ref` 和 packaged-payload smoke 均与最终发布 ref 一致

## 发布命令

在版本号、最终 git ref 与 VSIX 产物都已锁定后，从仓库根目录执行统一发布入口；这里的最终 git ref 默认应是已经位于 `main` 上的发布 commit：

    npm run publish:marketplaces -- --yes

该入口会按顺序重新打包主扩展与 notifier，然后先发布 notifier、再发布主扩展；每个扩展都会发布到 `Visual Studio Marketplace` 与 `Open VSX`。默认的 `Open VSX` 路径使用 `scripts/release/openvsx-api.py` 读取 `OVSX_PAT` 或 `~/.ovsx`，避免 headless Linux 环境中 `npx ovsx` 访问系统钥匙串或出现 TLS reset 时阻断发布。

发布前可先预览命令：

    npm run publish:marketplaces -- --dry-run

若某个市场已经成功、需要补发另一个市场，可复用当前 VSIX 并限定目标：

    npm run publish:marketplaces -- --yes --skip-package --target open-vsx

    npm run publish:marketplaces -- --yes --skip-package --target visual-studio

注意：`publish --packagePath` 与 Open VSX publish 都只上传现成 VSIX，不会重新处理 `README` 或 `CHANGELOG`。因此发布前必须确保统一入口重新执行过打包，或在使用 `--skip-package` 时已经手工确认当前 VSIX 已由打包阶段写入 `README.marketplace.md`，且 README 相对媒体 URL 已按最终 git ref 校验通过。

若最终版本号不是 `0.11.0`，统一入口会根据 `package.json` 与 notifier manifest 自动解析 VSIX 文件名；但 release notes、发布后 tag 与验证记录仍需同步替换目标版本。

## publish 后补 tag

`publish` 成功后，应立即给这次实际发布所对应、且已经位于 `main` 上的 commit 打上 `vX.Y.Z` 形式的 lightweight tag，并把该 tag 推送到远端仓库；只在本地打 tag 不算完成。不要等到后续 hotfix、README 修订或其他提交出现后再补打，避免 tag 漂移到错误提交。

若当前 shell 所在的就是本次发布对应 commit，可直接执行：

    git tag v0.11.0
    git push origin v0.11.0

若当前 shell 不在最终发布 commit 上，则应显式指定本次发布的最终 git ref 或 commit SHA：

    git tag v0.11.0 <final-ref-or-sha>
    git push origin v0.11.0

若最终版本号不是 `0.11.0`，应同步替换命令中的 tag 名称。当前约定是使用 lightweight tag，不额外创建 annotated tag；发布后验证也以远端 tag 已成功存在为准。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit。
2. 打开 `Visual Studio Marketplace` 与 `Open VSX` 页面，确认标题、图标、banner、README 文案与 CHANGELOG 没有失真。
3. 直接调用 Open VSX API 复核主扩展 `0.11.0` 的 `files.icon`、`files.license`、`files.vsixmanifest` 与 `files.sha256` 都存在，避免只验证 VSIX 本体而漏掉 registry asset metadata。
4. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
5. 在干净 profile 中从官方 VS Code Marketplace 安装刚发布的版本，验证扩展可成功激活并能打开主画布。
6. 在 Open VSX 兼容宿主或 Open VSX 页面中复核两个扩展版本一致，且主扩展 / notifier 的安装关系没有因缺失补充渠道产物而断裂。
7. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖与 Open VSX 兼容宿主边界仍被正确表达，没有被商店页误读成稳定版承诺或全宿主支持承诺。
