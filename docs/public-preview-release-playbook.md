# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明、验证记录与回退口径；当前目标版本为 `0.18.2`。当前版本范围收口为“相对已发布 `0.18.1` 的补丁更新：窗格画廊缩略图 rail 按 VS Code workspace folder 顺序稳定排列、workspace root / 普通分组 resize 后清理 Webview 旧草稿、Webview Playwright 回归稳定性补齐，以及 Marketplace 专用 README 交流二维码移除后的发布口径；继续保留 `0.18.1` 的侧栏会话历史分组控制、菜单选中态、画布布局整理空分组尺寸规范化、窗格画廊视口记忆隔离、公开隐私 / 许可证元数据、GitHub Release assets / 双市场发布 workflow 解耦、安装拓扑和 Preview 支持边界”。它不是对外宣传页，而是发布当天的执行与复核手册。
## 当前发布素材

- Marketplace listing 正文：`README.marketplace.md`（引用 `images/marketplace/canvas-overview.png` + `images/marketplace/canvas-overview.mp4`）
- Marketplace listing 中文对应版：`README.marketplace.zh-CN.md`（仅作仓库内中文对应文案，不作为默认打包输入）
- 仓库 README 默认英文：`README.md`（引用 `images/marketplace/canvas-overview.gif`）
- 仓库 README 中文对应版：`README.zh-CN.md`（引用 `images/marketplace/canvas-overview.gif`）
- release notes：`CHANGELOG.md`
- 主扩展图标资产：`images/icon.png`
- 圆形头像安全区图：`images/avatar.png`
- 仓库根 README 交流二维码资产：`images/lark-group-qr.png`、`images/wechat-group-qr.png`（仅供 `README.md` / `README.zh-CN.md` 引用，继续排除出 VSIX 与 Marketplace listing 输入）
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

当前 `0.18.2` 的 release notes 统一以 `CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。docs-only 变化不进入用户可见更新说明。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 顶部版本标题与 `CHANGELOG.md` 保持一致；当前标题为 `0.18.2 - Pane Gallery Root Order and Group Resize Fixes`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：`0.18.2` 收口窗格画廊缩略图 rail 稳定排序、workspace root / 分组 resize Webview 旧草稿清理、Webview Playwright 回归稳定性、Marketplace README 交流二维码移除口径，以及 `Dev Session Canvas Notifier` companion 版本对齐；docs-only 的设计索引日期同步不进入用户可见更新说明
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.18.2`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.18.1` 升级到 `0.18.2` 的目标仍是通过当前宿主配置的公开扩展市场常规安装 / 升级完成。Open VSX 侧应继续同版本公开发布；官方 VS Code 的 `Visual Studio Marketplace` 仍是目标主路径，但当前 public gallery 仍不可见时允许延期补发，不阻塞本轮 `0.18.2` 以 GitHub Release assets + Open VSX verified 完成。对外宣称 VSM 安装路径前仍必须先完成 release-day visibility check，确认主扩展与 notifier 均公开可见。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. 若用户此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 或 `devSessionCanvas.canvas.multiRootPresentationMode`，升级到 `0.18.2` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时继续使用默认 allow-list，未配置 `multiRootPresentationMode` 时继续使用默认 `rootGroups`，默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息。
5. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.18.2` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.18.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.18.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.18.2` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 窗格画廊 `sideThumbnails` / `topThumbnails` 切换 active root 后缩略图 rail 顺序保持 workspace folder 顺序
2. workspace root 分组 resize 后再次选中或刷新不出现几何漂移
3. Marketplace listing 的 Support And Feedback 区域不再出现交流群二维码

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
7. 确认发布 workflow 会先把同一批 VSIX 镜像到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许 deferred，不阻塞 `0.18.2` 完成。仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与按完成门禁删除临时 tag。
8. 复核 `OVSX_PAT`、`VSCE_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前完成门禁要求 Open VSX 可发布验证。`VSCE_PAT` 仍用于尝试 Visual Studio Marketplace 发布 / 验证，但 VSM 不可见时可记录为 deferred channel。GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：当前优先使用已验证的 Open VSX 或 `vX.Y.Z` 对应 GitHub Release Assets；Visual Studio Marketplace 只有在 public gallery 恢复且主扩展 / notifier 均可见后才作为已可用路径宣称。

## 当前验证备注

截至 `2026-06-24`，上一轮 `0.18.1` 已完成 GitHub Release assets + Open VSX 兜底发布。上一发布输入来自 `main` 上的 release ref `a6a55fe2f40aee1ccac7887cd5bd83730e550676`；正式 `v0.18.1` tag 指向同一 ref，远端不存在 `publish/v0.18.1` 临时 tag。GitHub Release `v0.18.1` 位于 `https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.18.1`，包含 `dev-session-canvas-0.18.1.vsix`、`dev-session-canvas-notifier-0.18.1.vsix` 与 `release-manifest-0.18.1.json`。Release manifest 记录 Open VSX 主扩展与 notifier `0.18.1` 均 verified，Visual Studio Marketplace 主扩展与 notifier 均为 `publish-failed` / deferred；因此 VSM 继续作为 deferred channel，不得对外宣称为已可用。

当前 `0.18.2` 发布准备基线来自最新 `origin/main` / `main` ref `0893730f60ff958d0acb3040c0d5982e4c56e0d3`。`v0.18.1` 之后合入 `main` 的发布输入包括：#192 移除 Marketplace README 交流二维码并同步发布手册素材口径，#193 修复 Webview Playwright 回归用例稳定性，#195 清理分组 resize 残留草稿并补充几何诊断 / 回归测试，#197 保持窗格画廊缩略图 rail 按 workspace root 顺序排列。当前发布准备分支为 `release-0-18-2-prep`，目标版本升级为 `0.18.2`；截至本发布准备文档更新时，远端不存在 `v0.18.2` / `publish/v0.18.2` tag，GitHub Release `v0.18.2` 尚未创建。

当前功能输入已有 repo-local 证据：`docs/design-docs/canvas-multi-root-workspace-support.md` 与 `docs/design-docs/index.md` 记录缩略图 rail 顺序不再因 active root 切换而互换；`docs/design-docs/canvas-layout-arrangement.md`、`docs/exec-plans/completed/canvas-layout-arrangement-edge-polish.md` 与 #195 的实现 / 测试记录分组 resize 草稿清理和几何稳定性；`README.marketplace.md`、`README.marketplace.zh-CN.md` 与本手册记录 Marketplace listing 不再展示交流群二维码；`CHANGELOG.md` 与 notifier changelog 记录本轮版本对齐和用户可见差异。

本轮发布准备分支已完成以下验证 / 审计复核：

- 版本一致性检查：`package.json`、notifier manifest、`package-lock.json` 根版本、root package entry 与 notifier package entry 均为 `0.18.2`
- 公开元数据一致性检查：主扩展与 notifier manifest 均包含仓库 `PRIVACY.md` 对应的 `privacyUrl`，且 `licenseUrl` 指向当前仓库 `LICENSE`
- 发布渠道可见性复核：GitHub Release `v0.18.1` assets 完整；release manifest 记录 Open VSX 主扩展与 notifier `0.18.1` 均 verified，Visual Studio Marketplace 主扩展与 notifier 为 deferred / `publish-failed`；远端不存在 `v0.18.2` / `publish/v0.18.2` tag，GitHub Release `v0.18.2` 尚未创建
- Marketplace README 二维码移除复核：`rg -n "lark-group-qr|wechat-group-qr|discussion group|飞书交流群|微信交流群|二维码|QR" README.marketplace.md README.marketplace.zh-CN.md` 无命中
- `npm install` 通过，用于恢复清理后的 workspace 依赖与本地 `@vscode/vsce` 入口；安装阶段报告的 6 个 audit 告警经 `npm audit --omit=dev` 复核后，生产依赖面为 0 vulnerabilities
- `git diff --check`
- `npm run test:extension-manifest`
- `npm run test:canvas-multi-root-composition`
- `npm run test:publish-tag-release`
- `npm run test:package-vsix-command`
- `npm run test:publish-marketplaces`
- `npm run test:publish-marketplace-workflow`
- `npm run typecheck`
- `npm run build`
- `npm run build:notifier`
- `npm run test:notifier-source`

- 定向 Webview Playwright：`node scripts/test/run-playwright-webview.mjs -g "pane gallery thumbnail rail follows workspace root order|workspace root group resize commit survives|workspace root group resize draft is replaced"`，3 passed
- `npm run package:vsix` 通过；本地主扩展 VSIX 为 115 files，约 3.48 MB，打包日志打印 `VSCE README doc ref` 并校验 `README.marketplace.md` 中 3 个相对链接
- `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix` 通过；本地 notifier VSIX 为 10 files，约 145.49 KB，打包日志打印 `VSCE README doc ref`，并确认 notifier Marketplace README 当前没有需要重写的相对链接
- `npm run release:publish-tag -- --trigger-tag publish/v0.18.2 --dry-run --package-only --skip-origin-main-check`（使用本地临时 `publish/v0.18.2` tag 预演统一 publish-tag 入口；dry-run 只打印计划，不执行真实 publish、tag 变更或 marketplace 验证；本地临时 tag 需在预演后删除）

本轮本地 package / dry-run 只作为发布准备分支预验证，byte-level sha256 不作为最终发布事实。发布准备 MR 合并后，仍必须在最终 `main` release commit 上重新执行 `npm run validate:clean-checkout:vsix -- --ref <final-ref>`、`npm run package:vsix`、notifier 打包与必要的 packaged-payload smoke，确认 README 相对链接改写、VSIX 文件数 / 大小、`VSCE README doc ref` 和 packaged-payload smoke 均与最终发布 ref 一致。

残余风险：真实 Open VSX / Visual Studio Marketplace 发布、GitHub Release assets 上传与 `v0.18.2` tag 收口只能在发布准备 MR 合并后的最终 `main` ref 上执行。若 Visual Studio Marketplace public gallery 仍不可见，本轮继续按 GitHub Release assets + Open VSX verified 完成，并在 manifest / Release notes 中把 VSM 写成 deferred；不得把官方 VS Code 安装路径宣称为已可用。

## 发布命令

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.18.2
    git push origin publish/v0.18.2

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.18.2 <final-ref-or-sha>
    git push origin publish/v0.18.2

推送 `publish/v0.18.2` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，先执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.18.2 --package-only

该 workflow 只响应 `publish/v*` tag push 与手动 `workflow_dispatch`；创建普通分支、普通 tag 或 release 分支不应再生成 skipped publish run。若 Actions 列表出现非 `publish/v*` 引起的 `Publish Marketplace Release` run，应先修正 workflow 触发条件，不要把 skipped run 当作真实发布动作。

随后 workflow 会创建或确认正式 `v0.18.2` tag 指向同一 release ref，创建或更新 `v0.18.2` 对应的 GitHub Release，并上传以下 Release assets：

    release-artifacts/release-manifest-0.18.2.json
    dev-session-canvas-0.18.2.vsix
    extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.18.2.vsix

Release assets 上传后，workflow 会继续复用同一批 manifest / VSIX 分别执行 Open VSX 与 Visual Studio Marketplace 发布、验证。如果同一 `publish/v0.18.2` 因任一 marketplace 失败而重跑，workflow 会先下载并校验 `v0.18.2` GitHub Release 中已有的 manifest / VSIX assets，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

    npm run release:publish-tag -- --trigger-tag publish/v0.18.2 --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/v0.18.2 --skip-package --target visual-studio --no-create-final-tag

两个 marketplace 不再互相串行阻断：Open VSX 失败不阻止 Visual Studio Marketplace 尝试发布，Visual Studio Marketplace 失败也不阻止 Open VSX 尝试发布。workflow 会在两个目标都跑完后上传最终 manifest，并用当前 manifest 重新生成 GitHub Release notes；Release notes 必须包含本版本亮点、渠道状态、残余风险和发布证据。本轮 `0.18.2` 的完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 若仍不可见，则以 deferred channel 写入 manifest / notes，不阻塞删除远端和本地 `publish/v0.18.2`。如果 Open VSX 发布或验证失败，GitHub Release assets 和更新后的 Release notes 会保留为手动安装兜底，失败的 Open VSX job 会在上传自身结果 manifest 后标红，finalize job 也会在收口 Release 状态后标红，临时 tag 保留，便于修复 token / 渠道问题后使用 GitHub Actions 的 Re-run failed jobs 或 workflow_dispatch 重跑同一 release input；重跑必须复用这批既有 assets 并通过 manifest sha256 校验。

本地人工执行同一路径时，也应使用同一入口；发布前可先 dry-run，预览 release ref、VSIX 计划和 manifest：

    npm run release:publish-tag -- --trigger-tag publish/v0.18.2 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、`CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.18.2` 指向的 commit。当前 workflow 在首次创建 Release assets 时会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.18.2.json` 并上传 GitHub Release assets；同一版本重跑时会下载并校验既有 Release assets。随后两种路径都会用 `--skip-package` 复用同一批 VSIX，分别发布并验证 Open VSX 与 Visual Studio Marketplace；脚本会保留既有 manifest 中已 verified 的渠道状态，避免已经完成的渠道被未完成渠道重跑覆盖。当前完成门禁只要求 Open VSX verified，Visual Studio Marketplace 可延期补发。

release manifest 不提交回代码库。它记录发布后事实，包括 release ref、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态，应作为 GitHub Release asset 保存；workflow 同时保留一份 Actions artifact 便于排障。GitHub Release notes 由 `CHANGELOG.md` 和当前 manifest 生成，必须在初次上传 assets 时和最终 manifest 上传时都同步更新，避免 Release 页面只有泛化模板而没有版本亮点和残余风险。

若 GitHub Actions 中 Open VSX 失败，或后续需要补发 / 重跑 Visual Studio Marketplace，必须复用同一 release ref 的 manifest / VSIX，并显式走 marketplace 补发命令；不要重新执行 package 覆盖 GitHub Release VSIX assets，因为同一 checkout 的 VSIX 打包当前不保证 byte-for-byte 可复现：

    npm run release:publish-tag -- --trigger-tag publish/v0.18.2 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.18.2 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.18.2.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.18.2`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。若对应 GitHub Release 已经存在完整 assets，重跑会复用并校验这些 assets；若 Release assets 不完整，先人工修复或删除不完整状态，不要用重新打包覆盖来恢复。

`vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag。为了让 Release assets 在 marketplace 暂时不可用时仍能先提供手动安装兜底，workflow 会在打包后、marketplace 发布验证前创建或确认该 tag。单看 `vX.Y.Z` 存在不再足以判断整轮发布完成；`0.18.2` 当前完成条件是 GitHub Release assets 已上传、Open VSX 已发布并验证、Visual Studio Marketplace 已记录为 verified 或 deferred、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除。如果 Open VSX 发布或验证失败，`vX.Y.Z` 与 Release assets 可能已经存在，但 workflow 会失败并保留临时 tag。需要人工删除临时 tag 时，应先确认两个 tag 指向同一 commit、Release assets 已存在，且 Open VSX 发布验证已经完成：

    git push origin :refs/tags/publish/v0.18.2
    git tag -d publish/v0.18.2

不要在 GitHub Release assets 上传未完成、正式 `vX.Y.Z` 尚未指向同一 release ref、Open VSX 发布验证尚未成功，或还需要依赖临时 tag 重跑时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；若 Open VSX 已验证完成，确认远端 `publish/v0.18.2` 已删除。
2. 打开 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 `files.*` metadata 均已同步到本轮版本；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 明确标记为 deferred，而不是已可用。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.18.2.vsix`、`dev-session-canvas-notifier-0.18.2.vsix` 与 `release-manifest-0.18.2.json` 都存在于 Assets 中。
4. 下载 release manifest，复核其中 `releaseRef`、两个 VSIX 的 `sha256`、`readmeDocRef`、`githubRelease.status`、marketplace `verified` 状态和 `tags.triggerTagStatus` 与实际发布事实一致。
5. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。Visual Studio Marketplace 恢复后再补做该路径的干净 profile 安装 / 升级验证。
6. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
7. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界与 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺或 marketplace 可用性承诺。
