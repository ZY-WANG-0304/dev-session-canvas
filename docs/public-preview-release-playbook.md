# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明、验证记录与回退口径；当前目标版本为 `0.14.0`。当前版本范围收口为“发布画布空间边界导航：全局 fit view、初始自动 fit、动态最小缩放和右下角 MiniMap 统一纳入节点、普通用户分组与 multi-root workspace-root section；同时修复 MiniMap 视口导航持久化、MiniMap 滚轮动态最小倍率，以及 Agent 停止后 `新建` / `恢复` 重启动作在紧凑标题栏中挤出 `删除` 按钮的问题；继续保留 `0.13.0` 的 VS Code multi-root workspace 组合画布、root-local 状态共享、跨 root 连线拒绝、文件活动命名空间、双市场发布边界、安装拓扑和 Preview 支持边界”。它不是对外宣传页，而是发布当天的执行与复核手册。

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

当前 `0.14.0` 的 release notes 统一以 `CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。docs-only 变化不进入用户可见更新说明。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 顶部版本标题与 `CHANGELOG.md` 保持一致；当前标题为 `0.14.0 - Preview Spatial Navigation and MiniMap Update`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：`0.14.0` 发布空间级全局 fit view、初始自动 fit、动态最小缩放和右下角 MiniMap；MiniMap 应显示 workspace-root section、普通用户分组与节点，并保留节点 attention 优先级；MiniMap 拖拽 / 滚轮导航应持久化 viewport / visible center 并遵循动态最小倍率；Agent 停止后紧凑标题栏中的 `新建` / `恢复` 重启动作不应挤出 `删除` 按钮；保留 `0.13.0` 的 multi-root workspace 组合画布、双市场同版本同步策略，以及 `Dev Session Canvas Notifier` companion 版本对齐
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.14.0`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.13.0` 升级到 `0.14.0` 将通过当前宿主配置的公开扩展市场常规安装 / 升级完成；官方 VS Code 仍以 `Visual Studio Marketplace` 为主路径，`Open VSX` 作为 VS Code 兼容宿主的补充渠道。后续 `0.14.x` 更新应保持两个公开市场同版本发布。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. 若用户此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.14.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息。
5. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.14.0` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.14.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.14.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.14.0` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 右下角 MiniMap 同时展示 workspace-root section、普通用户分组和节点的空间结构
2. multi-root workspace 中空 root section / 大 root section 被全局 fit view 纳入的视图
3. 停止后的 Agent 节点在紧凑标题栏中同时显示 `新建` / `恢复` / `删除` 的视图

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

截至 `2026-06-07`，上一轮 `0.13.0` 已完成双市场发布；本地 `v0.13.0` tag 指向 `7878fb8`，Open VSX API 显示主扩展与 notifier 的 latest 均为 `0.13.0`，Visual Studio Marketplace extension query 也返回主扩展 latest `0.13.0`。当前 `main` 已包含 `v0.13.0` 之后合入的 #119 和 #121，因此本轮从最新 `main`（`af066bae2f006a450578309059ffd7792efab7ae`）切出 `release-0-14-0-prep`，目标版本升级为 `0.14.0`。

当前功能输入已有 repo-local 证据：`docs/exec-plans/completed/canvas-spatial-fit-minimap.md`、`docs/product-specs/canvas-navigation-and-workbench-polish.md`、`docs/design-docs/canvas-navigation-and-workbench-polish.md`、`docs/product-specs/canvas-multi-root-workspace-support.md` 与 `docs/design-docs/canvas-multi-root-workspace-support.md` 记录了空间边界 fit view / MiniMap、workspace-root section、普通用户分组、MiniMap 分组 token、MiniMap 视口导航持久化和 multi-root root section 全局 fit 语义。PR #121 进一步修复了 Agent 停止后 `新建` / `恢复` 重启动作在紧凑标题栏中挤出 `删除` 按钮的问题。

本轮发布准备分支已刷新并通过以下验证：

- 版本一致性检查：`package.json`、notifier manifest、`package-lock.json` 根版本、root package entry 与 notifier package entry 均为 `0.14.0`
- `git diff --check`
- `npm run test:extension-manifest`
- `npm run test:package-vsix-command`
- `npm run test:publish-marketplaces`
- `npm run test:canvas-multi-root-composition`
- `npm run test:canvas-node-groups`
- `npm run test:protocol-webview-messages`
- `npm run typecheck`
- `npm run build:notifier`
- `npm run test:notifier-source`
- `npm run build`
- `npm run test:webview -- --grep "minimap|fit view|agent restart actions"`（14 个用例通过）
- `npm run publish:marketplaces -- --dry-run`（仅预演，未执行真实 publish）
- `npm run package:vsix`
- `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`
- `npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke`
- `python3 scripts/release/openvsx-api.py --prefer-ipv4 verify-pat devsessioncanvas`（返回 `{"success":"Valid token"}`）
- `npm run test:vsix-smoke`（首次运行命中 serialized terminal scrollback preservation 断言，立即重跑通过；见下方残余风险）
- `npm audit --omit=dev`（0 vulnerabilities）
- `npm audit`（仍报告 5 个 dev/tooling transitive vulnerabilities：4 moderate、1 high；当前生产依赖审计为 0）

本轮打包产物与发布前 smoke 结果如下：

- 主扩展 VSIX：`dev-session-canvas-0.14.0.vsix`，114 files，约 3.41 MB（本地文件大小 3,574,924 bytes）
- Notifier VSIX：`extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.14.0.vsix`，10 files，约 143.9 KB（本地文件大小 147,356 bytes）
- 两个 VSIX 的 `VSCE README doc ref` 均为 `af066bae2f006a450578309059ffd7792efab7ae`
- `npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke` 已在隔离 checkout 中复核主扩展打包路径，clean checkout VSIX 约 3.41 MB，README doc ref 同为 `af066bae2f006a450578309059ffd7792efab7ae`
- `npm run test:vsix-smoke` 首次失败时 serialized terminal artifact 只保留了 `090..220` 区间，缺失最早的 `001` marker；立即重跑通过，当前按 packaged-payload smoke flaky 记录，不视为本轮功能输入引入的确定性 blocker

残余风险：发布准备 MR 合并后，仍必须在最终 `main` release commit 上重新执行 `npm run validate:clean-checkout:vsix -- --ref <final-ref>`、`npm run package:vsix`、`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix` 与 `npm run test:vsix-smoke`，确认 README 相对链接改写、VSIX 文件数 / 大小、`VSCE README doc ref` 和 packaged-payload smoke 均与最终发布 ref 一致；若 serialized terminal scrollback smoke 在最终 ref 上稳定复现，应阻断发布并先定位。真实 publish 与 `v0.14.0` tag 仍只能在发布准备 MR 合并后的最终 `main` ref 上执行。

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

若最终版本号不是 `0.14.0`，统一入口会根据 `package.json` 与 notifier manifest 自动解析 VSIX 文件名；但 release notes、发布后 tag 与验证记录仍需同步替换目标版本。

## publish 后补 tag

`publish` 成功后，应立即给这次实际发布所对应、且已经位于 `main` 上的 commit 打上 `vX.Y.Z` 形式的 lightweight tag，并把该 tag 推送到远端仓库；只在本地打 tag 不算完成。不要等到后续 hotfix、README 修订或其他提交出现后再补打，避免 tag 漂移到错误提交。

若当前 shell 所在的就是本次发布对应 commit，可直接执行：

    git tag v0.14.0
    git push origin v0.14.0

若当前 shell 不在最终发布 commit 上，则应显式指定本次发布的最终 git ref 或 commit SHA：

    git tag v0.14.0 <final-ref-or-sha>
    git push origin v0.14.0

若最终版本号不是 `0.14.0`，应同步替换命令中的 tag 名称。当前约定是使用 lightweight tag，不额外创建 annotated tag；发布后验证也以远端 tag 已成功存在为准。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit。
2. 打开 `Visual Studio Marketplace` 与 `Open VSX` 页面，确认标题、图标、banner、README 文案与 CHANGELOG 没有失真。
3. 直接调用 Open VSX API 复核主扩展 `0.14.0` 的 `files.icon`、`files.license`、`files.vsixmanifest` 与 `files.sha256` 都存在，避免只验证 VSIX 本体而漏掉 registry asset metadata。
4. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
5. 在干净 profile 中从官方 VS Code Marketplace 安装刚发布的版本，验证扩展可成功激活并能打开主画布。
6. 在 Open VSX 兼容宿主或 Open VSX 页面中复核两个扩展版本一致，且主扩展 / notifier 的安装关系没有因缺失补充渠道产物而断裂。
7. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root live runtime 保守恢复边界与 Open VSX 兼容宿主边界仍被正确表达，没有被商店页误读成稳定版承诺或全宿主支持承诺。
