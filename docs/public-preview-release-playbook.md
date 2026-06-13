# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明、验证记录与回退口径；当前目标版本为 `0.15.1`。当前版本范围收口为“发布同一 `0.15.x` Preview 线内的画布导航与可靠性补丁：分组标题可读性、分组双击聚焦、`Add Folder to Workspace` 新增 root section 就近放置与聚焦、多根通知标题 root 标识、执行性能诊断插桩，以及新 worktree 调试自举依赖；继续保留 `0.15.0` 的 Claude Code Agent Fork、文件活动自动对象 owner-derived 分组、Panel Webview lifecycle 诊断闭环、publish tag 发布输入固定流程、双市场发布边界、安装拓扑和 Preview 支持边界”。它不是对外宣传页，而是发布当天的执行与复核手册。

## 当前发布素材

- Marketplace listing 正文：`README.marketplace.md`（引用 `images/marketplace/canvas-overview.png` + `images/marketplace/canvas-overview.mp4`）
- Marketplace listing 中文对应版：`README.marketplace.zh-CN.md`（仅作仓库内中文对应文案，不作为默认打包输入）
- 仓库 README 默认英文：`README.md`（引用 `images/marketplace/canvas-overview.gif`）
- 仓库 README 中文对应版：`README.zh-CN.md`（引用 `images/marketplace/canvas-overview.gif`）
- release notes：`CHANGELOG.md`
- 主扩展图标资产：`images/icon.png`
- 圆形头像安全区图：`images/avatar.png`
- README 与 Marketplace listing 交流二维码资产：`images/lark-group-qr.png`、`images/wechat-group-qr.png`（通过 README 资源改写引用，继续排除出 VSIX）
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

当前 `0.15.1` 的 release notes 统一以 `CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。docs-only 变化不进入用户可见更新说明。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 顶部版本标题与 `CHANGELOG.md` 保持一致；当前标题为 `0.15.1 - Preview Canvas Navigation and Multi-Root Patch`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：`0.15.1` 收口分组标题 tooltip、分组双击聚焦、Add Folder 新增 root 就近放置与聚焦、多根通知标题 root 标识、执行性能诊断插桩与新 worktree 调试自举依赖；保留 `0.15.0` 的 Claude Code Agent Fork、文件活动 owner-derived 分组、Panel Webview lifecycle 诊断闭环、publish tag 发布输入固定流程、双市场同版本同步策略，以及 `Dev Session Canvas Notifier` companion 版本对齐
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.15.1`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.15.0` 升级到 `0.15.1` 将通过当前宿主配置的公开扩展市场常规安装 / 升级完成；官方 VS Code 仍以 `Visual Studio Marketplace` 为主路径，`Open VSX` 作为 VS Code 兼容宿主的补充渠道。后续 `0.15.x` 更新应保持两个公开市场同版本发布。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. 若用户此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.15.1` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息。
5. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.15.1` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.15.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.15.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.15.1` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 双击画布分组后，画布通过平移 / 缩放动效聚焦到该分组
2. `Add Folder to Workspace` 后，新 root section 出现在当前视野附近并被动画聚焦
3. 多根系统通知标题中能看出 Agent / Terminal 所属 root

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
7. 确认发布 workflow 仍以 Visual Studio Marketplace / Open VSX 发布与验证为完成条件，同时把同一批 VSIX 镜像到 GitHub Release assets；仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与删除临时 tag。
8. 复核 `VSCE_PAT` / `OVSX_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前 workflow 仍要求这些 marketplace secrets，GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：优先通过 Visual Studio Marketplace / Open VSX 安装；如果 marketplace 访问、审核或同步暂时不可用，用户可从 `vX.Y.Z` 对应 GitHub Release 的 Assets 下载 VSIX 手动安装。

## 当前验证备注

截至 `2026-06-10`，上一轮 `0.15.0` 已完成双市场发布；本地 `v0.15.0` tag 指向 `06f697d9ccb537130dec4b4b0e1255ed4320e54e`（短 SHA `06f697d9ccb5`），Open VSX API 显示主扩展与 notifier 的 latest 均为 `0.15.0`，Visual Studio Marketplace extension query 返回主扩展与 notifier latest 均为 `0.15.0`。当前 `main` 已包含 `v0.15.0` 之后合入的 #144、#145、#146、#147 和 #148；已用 `git fetch origin main` 重新确认本轮发布准备基线为 `b7e06dab01e74def57ea3c16db4ad7326f57cb9f`（短 SHA `b7e06dab01e7`），因此本轮从该最新 `main` 切出 `release-0-15-1`，目标版本升级为 `0.15.1`。

当前功能输入已有 repo-local 证据：`docs/product-specs/canvas-node-groups.md` 与 `docs/design-docs/canvas-node-groups.md` 记录了分组标题、body 命中与分组双击聚焦语义；`docs/product-specs/canvas-multi-root-workspace-support.md`、`docs/design-docs/canvas-multi-root-workspace-support.md` 和 `docs/exec-plans/completed/canvas-add-folder-root-placement.md` 记录了新增 root section 就近放置、overlay 持久化与 focus replay；`docs/design-docs/embedded-terminal-runtime-window.md` 记录了执行性能诊断插桩；`docs/design-docs/development-debug-automation.md` 记录了新 worktree 调试自举依赖；`docs/design-docs/public-marketplace-release-readiness.md` 与 `docs/exec-plans/active/publish-tag-release-flow.md` 继续记录 publish tag 发布输入固定流程。

本轮发布准备分支已刷新并完成以下验证 / 审计复核：

- 版本一致性检查：`package.json`、notifier manifest、`package-lock.json` 根版本、root package entry 与 notifier package entry 均为 `0.15.1`
- `git diff --check`
- `node --check tests/vscode-smoke/extension-tests.cjs`
- `npm run test:extension-manifest`
- `npm run test:package-vsix-command`
- `npm run test:publish-marketplaces`
- `npm run test:publish-tag-release`
- `npm run test:agent-launch-presets`
- `npm run test:protocol-webview-messages`
- `npm run test:webview-lifecycle-diagnostics`
- `npm run test:canvas-node-groups`
- `npm run test:canvas-multi-root-composition`
- `npm run typecheck`
- `npm run build:notifier`
- `npm run test:notifier-source`
- `npm run build`
- `npm run publish:marketplaces -- --dry-run`（仅预演，未执行真实 publish）
- `npm run release:publish-tag -- --trigger-tag publish/v0.15.1 --dry-run --package-only --skip-origin-main-check`（使用本地临时 tag 预演发布准备分支，未执行真实 publish / tag 变更）
- `npm run package:vsix`
- `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`
- `npm run test:vsix-smoke`
- `npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke`
- `npm audit --omit=dev`（0 vulnerabilities，退出码 0）
- `npm audit`（退出码 1；仍报告 5 个 dev/tooling transitive vulnerabilities：4 moderate、1 high；当前生产依赖审计为 0）

本轮打包产物与发布前打包结果如下：

- 主扩展 VSIX：`dev-session-canvas-0.15.1.vsix`，114 files，约 3.42 MB（本地文件大小 3,590,777 bytes）
- Notifier VSIX：`extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.15.1.vsix`，10 files，约 144.24 KB（本地文件大小 147,703 bytes）
- 两个 VSIX 的 `VSCE README doc ref` 均已在本轮发布准备分支打包日志中打印并指向当时的 release-prep `HEAD`；发布准备 MR 合并后还需在最终 `main` release commit 上重新锁定
- 本轮已补跑 `npm run test:vsix-smoke` 并通过；补跑过程中先暴露 lifecycle race 诊断命令在 packaged smoke 中没有临时绑定可见 panel view，导致 workspace-root focus replay 被误判为未重放。该测试诊断构造已收口到 `src/panel/CanvasPanelManager.ts`，避免把 harness 现场误判为 `0.15.1` packaged payload blocker。

残余风险：发布准备 MR 合并后，仍必须在最终 `main` release commit 上重新执行 `npm run validate:clean-checkout:vsix -- --ref <final-ref>`、`npm run package:vsix`、`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix` 与必要的 packaged-payload smoke，确认 README 相对链接改写、VSIX 文件数 / 大小、`VSCE README doc ref` 和 packaged-payload smoke 均与最终发布 ref 一致。真实 Visual Studio Marketplace / Open VSX 发布、GitHub Release assets 上传与 `v0.15.1` tag 收口仍只能在发布准备 MR 合并后的最终 `main` ref 上执行。

## 发布命令

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.15.1
    git push origin publish/v0.15.1

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.15.1 <final-ref-or-sha>
    git push origin publish/v0.15.1

推送 `publish/v0.15.1` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，先执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.15.1 --package-only

随后 workflow 会创建或确认正式 `v0.15.1` tag 指向同一 release ref，创建或更新 `v0.15.1` 对应的 GitHub Release，并上传以下 Release assets：

    release-artifacts/release-manifest-0.15.1.json
    dev-session-canvas-0.15.1.vsix
    extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.15.1.vsix

Release assets 上传后，workflow 会继续复用同一批 manifest / VSIX 执行 Visual Studio Marketplace 与 Open VSX 发布、验证：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.1 --skip-package

只有 marketplace 发布与验证成功后，workflow 才上传最终 manifest 并删除远端和本地 `publish/v0.15.1`。如果 marketplace 发布或验证失败，GitHub Release assets 会保留为手动安装兜底，job 失败且临时 tag 保留，便于修复 token / 渠道问题后重跑同一 release input。

发布前可先 dry-run，预览 release ref、VSIX 计划和 manifest：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.1 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、`CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.15.1` 指向的 commit。当前 workflow 会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.15.1.json` 并上传 GitHub Release assets，再用 `--skip-package` 复用同一批 VSIX 发布并验证 Visual Studio Marketplace / Open VSX。

release manifest 不提交回代码库。它记录发布后事实，包括 release ref、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态，应作为 GitHub Release asset 保存；workflow 同时保留一份 Actions artifact 便于排障。

若 GitHub Actions 中某个 marketplace 目标失败，或需要手工重跑某个市场，必须复用同一 release ref 的 manifest / VSIX，并显式走 marketplace 补发命令：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.1 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.15.1 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.15.1.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.15.1`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。

`vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag。为了让 Release assets 在 marketplace 暂时不可用时仍能先提供手动安装兜底，workflow 会在打包后、marketplace 发布验证前创建或确认该 tag。单看 `vX.Y.Z` 存在不再足以判断整轮发布完成；完整完成条件是 GitHub Release assets 已上传、Visual Studio Marketplace / Open VSX 已发布并验证、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除。如果 marketplace 发布或验证失败，`vX.Y.Z` 与 Release assets 可能已经存在，但 workflow 会失败并保留临时 tag。需要人工删除临时 tag 时，应先确认两个 tag 指向同一 commit、Release assets 已存在，且 marketplace 发布验证已经完成：

    git push origin :refs/tags/publish/v0.15.1
    git tag -d publish/v0.15.1

不要在 GitHub Release assets 上传未完成、正式 `vX.Y.Z` 尚未指向同一 release ref、marketplace 发布验证尚未成功，或还需要依赖临时 tag 重跑时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；确认远端 `publish/v0.15.1` 已删除。
2. 打开 Visual Studio Marketplace 与 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 Open VSX `files.*` metadata 均已同步到本轮版本。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.15.1.vsix`、`dev-session-canvas-notifier-0.15.1.vsix` 与 `release-manifest-0.15.1.json` 都存在于 Assets 中。
4. 下载 release manifest，复核其中 `releaseRef`、两个 VSIX 的 `sha256`、`readmeDocRef`、`githubRelease.status`、marketplace `verified` 状态和 `tags.triggerTagStatus` 与实际发布事实一致。
5. 在干净 profile 中优先从 Visual Studio Marketplace / Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。
6. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
7. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界与 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺或 marketplace 可用性承诺。
