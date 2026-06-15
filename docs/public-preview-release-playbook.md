# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明、验证记录与回退口径；当前目标版本为 `0.16.1`。当前版本范围收口为“发布同一 `0.16.x` Preview 线内的可读性与诊断噪音补丁：multi-root workspace root section 水印独立可读缩放、path-like 标题 basename 收敛、长名称两行限制、低噪声水印样式、snapshot restore 窗口内剪贴板诊断抑制，以及用户输入前刷新恢复诊断抑制；继续保留 `0.16.0` 的 Codex / Claude Code Agent Fork、历史会话分叉、侧栏待处理提醒汇总、Agent cwd / 启动命令标题拆分、多 Agent 输入响应、执行终端链接 activation fallback、复制诊断、GitHub Release assets / 双市场发布 workflow 解耦、安装拓扑和 Preview 支持边界”。它不是对外宣传页，而是发布当天的执行与复核手册。

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

当前 `0.16.1` 的 release notes 统一以 `CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。docs-only 变化不进入用户可见更新说明。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 顶部版本标题与 `CHANGELOG.md` 保持一致；当前标题为 `0.16.1 - Preview Root Watermark and Clipboard Diagnostic Patch`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：`0.16.1` 收口 multi-root workspace root section 水印可读性、snapshot restore 窗口内剪贴板诊断抑制、用户输入前刷新恢复诊断抑制状态；保留 `0.16.0` 的 Codex / Claude Code Agent Fork、历史会话分叉、侧栏待处理提醒汇总、Agent cwd / 启动命令标题拆分、多 Agent 输入响应、执行终端链接 activation fallback、复制诊断、GitHub Release assets 兜底入口、双市场同版本同步策略，以及 `Dev Session Canvas Notifier` companion 版本对齐
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.16.1`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.16.0` 升级到 `0.16.1` 的目标仍是通过当前宿主配置的公开扩展市场常规安装 / 升级完成。Open VSX 侧应继续同版本公开发布；官方 VS Code 的 `Visual Studio Marketplace` 仍是目标主路径，但当前 public gallery 仍不可见时允许延期补发，不阻塞本轮 `0.16.1` 以 GitHub Release assets + Open VSX verified 完成。对外宣称 VSM 安装路径前仍必须先完成 release-day visibility check，确认主扩展与 notifier 均公开可见。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. 若用户此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode` 或 `devSessionCanvas.canvas.workspaceRootWatermarks.enabled`，升级到 `0.16.1` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时继续使用默认 allow-list，默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息。
5. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.16.1` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.16.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.16.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.16.1` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. multi-root root section body 水印在低倍率概览或窄 root section 中仍显示可辨认 root 名称
2. path-like root 标题被收敛为 basename、长 root 名称最多两行展示
3. 执行终端恢复后 `restoreSuppressed` 聚合诊断能区分程序化恢复噪音与后续真实 OSC 52 / 选区诊断

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
7. 确认发布 workflow 会先把同一批 VSIX 镜像到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许 deferred，不阻塞 `0.16.1` 完成。仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与按完成门禁删除临时 tag。
8. 复核 `OVSX_PAT`、`VSCE_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前完成门禁要求 Open VSX 可发布验证。`VSCE_PAT` 仍用于尝试 Visual Studio Marketplace 发布 / 验证，但 VSM 不可见时可记录为 deferred channel。GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：当前优先使用已验证的 Open VSX 或 `vX.Y.Z` 对应 GitHub Release Assets；Visual Studio Marketplace 只有在 public gallery 恢复且主扩展 / notifier 均可见后才作为已可用路径宣称。

## 当前验证备注

截至 `2026-06-16`，上一轮 `0.16.0` 已完成正式发布收口。本轮上一发布输入来自 `main` 上的 release ref `542d90cf6f7ce60e832f2ea1dc17fe0b71d2695c`；正式 `v0.16.0` tag 指向同一 ref，`publish/v0.16.0` 临时 tag 已删除。GitHub Actions run `27533849564` 已完成 GitHub Release assets 上传、Open VSX 主扩展 / notifier 发布验证、最终 manifest / Release notes 更新；GitHub Release `v0.16.0` 位于 `https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.16.0`，包含 `dev-session-canvas-0.16.0.vsix`、`dev-session-canvas-notifier-0.16.0.vsix` 与 `release-manifest-0.16.0.json`。最终 manifest 状态为 `complete-with-deferred-visual-studio`，Open VSX 主扩展与 notifier 均为 `verified`，Visual Studio Marketplace 主扩展与 notifier 均为 `publish-failed` / deferred。

当前 `0.16.1` 发布准备基线为最新 `origin/main` / `main` ref `d947ee80cd3d1d0b47e6c6b91042060578f9668d`。`v0.16.0` 之后合入 `main` 的发布输入包括：#170 记录 `0.16.0` 发布事实，#171 优化 multi-root workspace root section body 水印可读性，#173 抑制执行终端 snapshot restore 期间的剪贴板诊断噪音并在用户输入前刷新恢复诊断抑制状态。本轮从最新 `origin/main` 单独切出 `release-0-16-1-prep`，目标版本升级为 `0.16.1`；截至本发布准备文档更新时，远端不存在 `v0.16.1` / `publish/v0.16.1` tag，GitHub Release `v0.16.1` 也不存在。

当前功能输入已有 repo-local 证据：`docs/design-docs/canvas-multi-root-workspace-support.md` 与 `docs/product-specs/canvas-multi-root-workspace-support.md` 记录 workspace-root body 水印、path-like 标题收敛、低噪声样式和关闭配置；`docs/design-docs/execution-terminal-clipboard-shortcuts.md`、`docs/design-docs/embedded-terminal-runtime-window.md` 与 `docs/exec-plans/active/execution-input-responsiveness.md` 记录 snapshot restore 窗口内 clipboard/selection 诊断抑制、`restoreSuppressed` 聚合计数和用户输入前刷新边界；`docs/design-docs/public-marketplace-release-readiness.md`、`docs/exec-plans/active/publish-tag-release-flow.md` 和 `docs/exec-plans/completed/github-release-assets-flow.md` 记录 publish tag 发布输入固定流程、GitHub Release assets 镜像 / 复用发布流程、marketplace job 解耦，以及 VSM deferred 完成门禁。

本轮发布准备分支已完成以下验证 / 审计复核：

- 版本一致性检查：`package.json`、notifier manifest、`package-lock.json` 根版本、root package entry 与 notifier package entry 均为 `0.16.1`
- 发布渠道可见性复核：GitHub Release `v0.16.0` assets 完整；Open VSX API 可查到主扩展与 notifier `0.16.0` 且 files metadata 齐全；Visual Studio Marketplace public gallery 对主扩展与 notifier 仍返回 0 个结果；远端不存在 `v0.16.1` / `publish/v0.16.1` tag，GitHub Release `v0.16.1` 也不存在
- `npm install`（刷新当前 release-prep worktree 的 workspace 依赖；完整 dev audit 仍有既有 dev 依赖告警，生产依赖审计见下方 `npm audit --omit=dev`）
- `git diff --check`
- `npm run test:extension-manifest`
- `npm run test:package-vsix-command`
- `npm run test:publish-marketplaces`
- `npm run test:publish-marketplace-workflow`
- `npm run test:publish-tag-release`
- `npm run release:publish-tag -- --trigger-tag publish/v0.16.1 --dry-run --package-only --skip-origin-main-check`（在发布准备提交后用本地临时 `publish/v0.16.1` tag 预演统一 publish-tag 入口，确认计划产物为 notifier 与主扩展 `0.16.1` VSIX；本地临时 tag 已删除。由于发布准备 head 尚未合入 `origin/main`，这里的 `--skip-origin-main-check` 只适用于本地预演，最终 `main` release ref 必须不带该参数复跑）
- `npm run test:canvas-multi-root-composition`
- `npm run test:execution-terminal-clipboard`
- `npm run typecheck`
- `npm run build:notifier`
- `npm run test:notifier-source`
- `npm run build`
- `npm run publish:marketplaces -- --dry-run`（仅预演，未执行真实 publish）
- `npm run package:vsix` 通过；本地主扩展 VSIX 为 115 files、`3,618,908` bytes，sha256 `63d0b7bf9f1537347ebdd489db6873f7ecc8e216d20ec0bbd6cd2ba0708bc0b2`，`VSCE README doc ref` 来自 release-prep 基线 `d947ee80cd3d1d0b47e6c6b91042060578f9668d`
- `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix` 通过；本地 notifier VSIX 为 10 files、`147,988` bytes，sha256 `b6185d967f3bb9322e9a6870e6ff3e8f557dcc3a19ec56017dbb4a2f99a85bed`
- `npm run test:webview -- -g "workspace root group body renders a tiled non-interactive root name watermark|workspace root watermark keeps overview-scale text when the title chrome is width-capped|workspace root group body watermark can be disabled by runtime configuration|snapshot restore suppresses programmatic clipboard diagnostics|input flushes snapshot restore clipboard diagnostic suppression"`（7 个本轮定向 Playwright 用例通过）
- `npm audit --omit=dev`（0 vulnerabilities，退出码 0）

残余风险：发布准备 MR 合并后，仍必须在最终 `main` release commit 上重新执行 `npm run validate:clean-checkout:vsix -- --ref <final-ref>`、`npm run package:vsix`、`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix` 与必要的 packaged-payload smoke，确认 README 相对链接改写、VSIX 文件数 / 大小、`VSCE README doc ref` 和 packaged-payload smoke 均与最终发布 ref 一致。真实 Open VSX / Visual Studio Marketplace 发布、GitHub Release assets 上传与 `v0.16.1` tag 收口只能在发布准备 MR 合并后的最终 `main` ref 上执行。若 Visual Studio Marketplace public gallery 仍不可见，本轮继续按 GitHub Release assets + Open VSX verified 完成，并在 manifest / Release notes 中把 VSM 写成 deferred；不得把官方 VS Code 安装路径宣称为已可用。

## 发布命令

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.16.1
    git push origin publish/v0.16.1

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.16.1 <final-ref-or-sha>
    git push origin publish/v0.16.1

推送 `publish/v0.16.1` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，先执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.16.1 --package-only

该 workflow 只响应 `publish/v*` tag push 与手动 `workflow_dispatch`；创建普通分支、普通 tag 或 release 分支不应再生成 skipped publish run。若 Actions 列表出现非 `publish/v*` 引起的 `Publish Marketplace Release` run，应先修正 workflow 触发条件，不要把 skipped run 当作真实发布动作。

随后 workflow 会创建或确认正式 `v0.16.1` tag 指向同一 release ref，创建或更新 `v0.16.1` 对应的 GitHub Release，并上传以下 Release assets：

    release-artifacts/release-manifest-0.16.1.json
    dev-session-canvas-0.16.1.vsix
    extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.16.1.vsix

Release assets 上传后，workflow 会继续复用同一批 manifest / VSIX 分别执行 Open VSX 与 Visual Studio Marketplace 发布、验证。如果同一 `publish/v0.16.1` 因任一 marketplace 失败而重跑，workflow 会先下载并校验 `v0.16.1` GitHub Release 中已有的 manifest / VSIX assets，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

    npm run release:publish-tag -- --trigger-tag publish/v0.16.1 --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/v0.16.1 --skip-package --target visual-studio --no-create-final-tag

两个 marketplace 不再互相串行阻断：Open VSX 失败不阻止 Visual Studio Marketplace 尝试发布，Visual Studio Marketplace 失败也不阻止 Open VSX 尝试发布。workflow 会在两个目标都跑完后上传最终 manifest，并用当前 manifest 重新生成 GitHub Release notes；Release notes 必须包含本版本亮点、渠道状态、残余风险和发布证据。本轮 `0.16.1` 的完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 若仍不可见，则以 deferred channel 写入 manifest / notes，不阻塞删除远端和本地 `publish/v0.16.1`。如果 Open VSX 发布或验证失败，GitHub Release assets 和更新后的 Release notes 会保留为手动安装兜底，失败的 Open VSX job 会在上传自身结果 manifest 后标红，finalize job 也会在收口 Release 状态后标红，临时 tag 保留，便于修复 token / 渠道问题后使用 GitHub Actions 的 Re-run failed jobs 或 workflow_dispatch 重跑同一 release input；重跑必须复用这批既有 assets 并通过 manifest sha256 校验。

本地人工执行同一路径时，也应使用同一入口；发布前可先 dry-run，预览 release ref、VSIX 计划和 manifest：

    npm run release:publish-tag -- --trigger-tag publish/v0.16.1 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、`CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.16.1` 指向的 commit。当前 workflow 在首次创建 Release assets 时会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.16.1.json` 并上传 GitHub Release assets；同一版本重跑时会下载并校验既有 Release assets。随后两种路径都会用 `--skip-package` 复用同一批 VSIX，分别发布并验证 Open VSX 与 Visual Studio Marketplace；脚本会保留既有 manifest 中已 verified 的渠道状态，避免已经完成的渠道被未完成渠道重跑覆盖。当前完成门禁只要求 Open VSX verified，Visual Studio Marketplace 可延期补发。

release manifest 不提交回代码库。它记录发布后事实，包括 release ref、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态，应作为 GitHub Release asset 保存；workflow 同时保留一份 Actions artifact 便于排障。GitHub Release notes 由 `CHANGELOG.md` 和当前 manifest 生成，必须在初次上传 assets 时和最终 manifest 上传时都同步更新，避免 Release 页面只有泛化模板而没有版本亮点和残余风险。

若 GitHub Actions 中 Open VSX 失败，或后续需要补发 / 重跑 Visual Studio Marketplace，必须复用同一 release ref 的 manifest / VSIX，并显式走 marketplace 补发命令；不要重新执行 package 覆盖 GitHub Release VSIX assets，因为同一 checkout 的 VSIX 打包当前不保证 byte-for-byte 可复现：

    npm run release:publish-tag -- --trigger-tag publish/v0.16.1 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.16.1 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.16.1.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.16.1`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。若对应 GitHub Release 已经存在完整 assets，重跑会复用并校验这些 assets；若 Release assets 不完整，先人工修复或删除不完整状态，不要用重新打包覆盖来恢复。

`vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag。为了让 Release assets 在 marketplace 暂时不可用时仍能先提供手动安装兜底，workflow 会在打包后、marketplace 发布验证前创建或确认该 tag。单看 `vX.Y.Z` 存在不再足以判断整轮发布完成；`0.16.1` 当前完成条件是 GitHub Release assets 已上传、Open VSX 已发布并验证、Visual Studio Marketplace 已记录为 verified 或 deferred、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除。如果 Open VSX 发布或验证失败，`vX.Y.Z` 与 Release assets 可能已经存在，但 workflow 会失败并保留临时 tag。需要人工删除临时 tag 时，应先确认两个 tag 指向同一 commit、Release assets 已存在，且 Open VSX 发布验证已经完成：

    git push origin :refs/tags/publish/v0.16.1
    git tag -d publish/v0.16.1

不要在 GitHub Release assets 上传未完成、正式 `vX.Y.Z` 尚未指向同一 release ref、Open VSX 发布验证尚未成功，或还需要依赖临时 tag 重跑时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；若 Open VSX 已验证完成，确认远端 `publish/v0.16.1` 已删除。
2. 打开 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 `files.*` metadata 均已同步到本轮版本；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 明确标记为 deferred，而不是已可用。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.16.1.vsix`、`dev-session-canvas-notifier-0.16.1.vsix` 与 `release-manifest-0.16.1.json` 都存在于 Assets 中。
4. 下载 release manifest，复核其中 `releaseRef`、两个 VSIX 的 `sha256`、`readmeDocRef`、`githubRelease.status`、marketplace `verified` 状态和 `tags.triggerTagStatus` 与实际发布事实一致。
5. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。Visual Studio Marketplace 恢复后再补做该路径的干净 profile 安装 / 升级验证。
6. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
7. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界与 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺或 marketplace 可用性承诺。
