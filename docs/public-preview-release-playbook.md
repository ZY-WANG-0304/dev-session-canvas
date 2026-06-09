# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明、验证记录与回退口径；当前目标版本为 `0.15.0`。当前版本范围收口为“发布新的公开 Preview 里程碑：Claude Code Agent Fork、文件活动自动对象按 owner Agent 推导分组、workspace-root section 标题缩放对齐、Panel Webview lifecycle 诊断闭环，以及 publish tag 发布输入固定流程；继续保留 `0.14.1` 的 Explorer Markdown 关联 Note、创建入口 surface 复用、分组 body 拖动画板、multi-root / 双窗口 shared live runtime 恢复验证、双市场发布边界、安装拓扑和 Preview 支持边界”。它不是对外宣传页，而是发布当天的执行与复核手册。

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

当前 `0.15.0` 的 release notes 统一以 `CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。docs-only 变化不进入用户可见更新说明。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 顶部版本标题与 `CHANGELOG.md` 保持一致；当前标题为 `0.15.0 - Preview Agent Fork and Release Automation Update`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：`0.15.0` 补齐 Claude Code Agent Fork、文件活动自动对象按 owner Agent 推导分组、workspace-root section 标题缩放对齐、Panel Webview lifecycle 诊断闭环，以及 publish tag 发布输入固定流程；保留 `0.14.1` 的 Markdown Note 快捷入口、surface 复用、分组 body 拖动画板、shared runtime 恢复硬化、双市场同版本同步策略，以及 `Dev Session Canvas Notifier` companion 版本对齐
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.15.0`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.14.1` 升级到 `0.15.0` 将通过当前宿主配置的公开扩展市场常规安装 / 升级完成；官方 VS Code 仍以 `Visual Studio Marketplace` 为主路径，`Open VSX` 作为 VS Code 兼容宿主的补充渠道。后续 `0.15.x` 更新应保持两个公开市场同版本发布。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. 若用户此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.15.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息。
5. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.15.0` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.15.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.15.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.15.0` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 从持有可信 Claude Code session id 的 Agent 节点点击 `Fork` 后，新 Agent 节点出现在来源节点旁并开始执行
2. 文件活动自动 `file` / `file-list` 节点跟随 owner Agent 分组归属
3. Panel Webview lifecycle 诊断摘要显示 healthy / attention 状态并可用离线分析脚本复核

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

9. 若通过 GitHub Actions 执行发布，确认 repository secrets `VSCE_PAT` / `OVSX_PAT` 已配置，且 release workflow 具备创建正式 tag、删除临时 tag 和上传 Actions artifact 所需权限；本地人工发布仍按第 7、8 步复核本机 token。

## 当前验证备注

截至 `2026-06-09`，上一轮 `0.14.1` 已完成双市场发布；本地 `v0.14.1` tag 指向 `0330588c4874`，Open VSX API 显示主扩展与 notifier 的 latest 均为 `0.14.1`，Visual Studio Marketplace extension query 返回主扩展与 notifier latest 均为 `0.14.1`。当前 `main` 已包含 `v0.14.1` 之后合入的 #136、#138、#124、#139、#140、#141 和 #142；已用 `git fetch origin main` 与 `git merge-base origin/main HEAD` 重新确认本轮发布准备基线为 `aeb9b6cccd5aaec4854f7639d0b92d40982deff6`（短 SHA `aeb9b6cccd5a`），因此本轮从该最新 `main` 切出 `release-0-15-0-prep`，目标版本升级为 `0.15.0`。

当前功能输入已有 repo-local 证据：`docs/product-specs/agent-launch-modes-and-restart.md` 与 `docs/design-docs/agent-launch-modes-and-restart.md` 记录了 Claude Code Agent Fork 的产品语义与实现边界；`docs/product-specs/canvas-node-groups.md`、`docs/design-docs/canvas-node-groups.md` 和 `docs/design-docs/canvas-file-activity-view.md` 记录了文件活动自动对象按 owner Agent 推导分组的边界；`docs/design-docs/canvas-surface-placement.md` 与 `docs/exec-plans/completed/canvas-panel-webview-lifecycle-identity.md` 记录了 Panel Webview lifecycle 诊断闭环；`docs/design-docs/public-marketplace-release-readiness.md` 与 `docs/exec-plans/active/publish-tag-release-flow.md` 记录了 publish tag 发布输入固定流程。

本轮发布准备分支已刷新并通过以下验证：

- 版本一致性检查：`package.json`、notifier manifest、`package-lock.json` 根版本、root package entry 与 notifier package entry 均为 `0.15.0`
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
- `npm run release:publish-tag -- --trigger-tag publish/v0.15.0 --dry-run --package-only --skip-origin-main-check`（使用本地临时 tag 预演发布准备分支，未执行真实 publish / tag 变更）
- `npm run package:vsix`
- `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`
- `npm run test:vsix-smoke`
- `npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke`
- `npm audit --omit=dev`（0 vulnerabilities）
- `npm audit`（仍报告 5 个 dev/tooling transitive vulnerabilities：4 moderate、1 high；当前生产依赖审计为 0）

本轮打包产物与发布前打包结果如下：

- 主扩展 VSIX：`dev-session-canvas-0.15.0.vsix`，114 files，约 3.42 MB（本地文件大小 3,585,444 bytes）
- Notifier VSIX：`extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.15.0.vsix`，10 files，约 144.14 KB（本地文件大小 147,595 bytes）
- 两个 VSIX 的 `VSCE README doc ref` 均已在本轮发布准备分支打包日志中打印并指向当时的 release-prep `HEAD`；发布准备 MR 合并后还需在最终 `main` release commit 上重新锁定
- 本轮已补跑 `npm run test:vsix-smoke` 并通过；补跑过程中先暴露两处 smoke harness 口径问题：serialized terminal scrollback 用例输出行过长导致换行后误裁剪最早 marker，以及 Claude Fork 成功路径继承 packaged smoke 的缺失 Claude 命令环境。两者已收口到 `tests/vscode-smoke/extension-tests.cjs`，避免把测试构造问题误判为 `0.15.0` packaged payload blocker。

残余风险：发布准备 MR 合并后，仍必须在最终 `main` release commit 上重新执行 `npm run validate:clean-checkout:vsix -- --ref <final-ref>`、`npm run package:vsix`、`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix` 与必要的 packaged-payload smoke，确认 README 相对链接改写、VSIX 文件数 / 大小、`VSCE README doc ref` 和 packaged-payload smoke 均与最终发布 ref 一致。真实 publish 与 `v0.15.0` tag 仍只能在发布准备 MR 合并后的最终 `main` ref 上执行。

## 发布命令

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.15.0
    git push origin publish/v0.15.0

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.15.0 <final-ref-or-sha>
    git push origin publish/v0.15.0

推送 `publish/v0.15.0` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.15.0 --delete-trigger-tag

本地人工执行同一路径时，也应使用同一入口；发布前可先 dry-run：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.0 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、`CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.15.0` 指向的 commit。它会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.15.0.json`，再发布到 Visual Studio Marketplace 与 Open VSX，验证四个目标版本与关键 metadata，最后创建正式 `v0.15.0` tag 并删除临时 `publish/v0.15.0`。

release manifest 不提交回代码库。它记录 publish 后事实，包括 release ref、VSIX sha256、README doc ref、marketplace 验证结果和 tag 状态，应作为 GitHub Actions artifact 或 GitHub Release asset 保存。

若某个市场已经成功、需要补发另一个市场，保留或重新创建同一个 `publish/v0.15.0` tag，并复用同一份 manifest / VSIX：

    npm run release:publish-tag -- --trigger-tag publish/v0.15.0 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.15.0 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.15.0.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.15.0`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。

`vX.Y.Z` 是正式 lightweight release tag，只在主扩展与 notifier 已经发布到 Visual Studio Marketplace 和 Open VSX、且发布后验证通过后由 `release:publish-tag` 创建并推送。正式 tag 创建成功后，脚本可以删除远端和本地 `publish/vX.Y.Z`。如果需要人工删除，可在确认两个 tag 指向同一 commit 后执行：

    git push origin :refs/tags/publish/v0.15.0
    git tag -d publish/v0.15.0

不要在发布未完成或正式 `vX.Y.Z` 尚未指向同一 release ref 时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit。
2. 打开 `Visual Studio Marketplace` 与 `Open VSX` 页面，确认标题、图标、banner、README 文案与 CHANGELOG 没有失真。
3. 直接调用 Open VSX API 复核主扩展 `0.15.0` 的 `files.icon`、`files.license`、`files.vsixmanifest` 与 `files.sha256` 都存在，避免只验证 VSIX 本体而漏掉 registry asset metadata。
4. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
5. 在干净 profile 中从官方 VS Code Marketplace 安装刚发布的版本，验证扩展可成功激活并能打开主画布。
6. 在 Open VSX 兼容宿主或 Open VSX 页面中复核两个扩展版本一致，且主扩展 / notifier 的安装关系没有因缺失补充渠道产物而断裂。
7. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界与 Open VSX 兼容宿主边界仍被正确表达，没有被商店页误读成稳定版承诺或全宿主支持承诺。
