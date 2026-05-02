# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明与回退口径；当前目标版本为 `0.4.1`。当前版本范围已经收口到“相对 `0.4.0` 的一轮 UI 修复与交互优化：Agent 启动入口、节点与文件活动操作体验、执行节点 terminal link 行为，以及 `0.4.1` 发布材料更新”。它不是对外宣传页，而是发布当天的执行与复核手册。

## 当前发布素材

- Marketplace listing 正文：`README.marketplace.md`（引用 `images/marketplace/canvas-overview.png` + `images/marketplace/canvas-overview.mp4`）
- Marketplace listing 英文对应版：`README.marketplace.en.md`（仅作仓库内英文对应文案，不作为默认打包输入）
- 仓库 README 默认中文：`README.md`（引用 `images/marketplace/canvas-overview.gif`）
- 仓库 README 英文对应版：`README.en.md`（引用 `images/marketplace/canvas-overview.gif`）
- release notes：`CHANGELOG.md`
- Preview 支持边界：`docs/support.md`
- 安全口径：`docs/SECURITY.md`
- 发布判断与背景：`docs/design-docs/public-marketplace-release-readiness.md`

## Marketplace listing 定稿口径

当前 listing 统一使用中文默认版 `README.marketplace.md`，不再直接复用仓库根目录 `README.md`。新增的 `README.marketplace.en.md` 仅作为仓库内英文对应版本保留，不改变默认 Marketplace 打包入口。

当前 `npm run package:vsix` 会在打包阶段显式传入 `--readme-path README.marketplace.md`，因此最终用于发布的 VSIX 已内嵌 Marketplace 专用 README；后续 `publish --packagePath` 只上传现成 VSIX，不会再替换 README。
打包脚本默认会把 README 相对资源改写到当前 `HEAD` 对应的 git ref；如果在没有 `.git` 元数据的 clean checkout、导出目录或 tarball 中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，否则不允许继续打包。

这样做的原因是：

- 仓库 `README.md` 仍需要描述公开 `Preview` 阶段下的开发者语境与源码开发入口
- Marketplace 页面需要一份面向已发布状态的对外文案，避免出现发布后立即失真的措辞
- 当前公开 Preview 的安装/升级说明也需要直接出现在商店页，而不是只藏在内部文档里
- 公开文案不应引入仓库内部历史包名或内部迁移背景，避免对 Marketplace 用户造成无关干扰

## release notes 定稿口径

当前 `0.4.1` 的 release notes 统一以 `CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 顶部版本标题与 `CHANGELOG.md` 保持一致；当前标题为 `0.4.1 - Preview UI Polish Update`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：Agent 创建预设与 provider 默认参数归一化、创建菜单与最近启动命令展示、手动创建节点后的平滑居中、文件活动默认关闭与树形交互 / 自动边锚点优化、执行节点 terminal link 行为对齐，以及 Windows 下使用 `Codex` 时无法向上翻页的已知问题
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.4.1`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.4.0` 升级到 `0.4.1` 将通过 `Visual Studio Marketplace` 常规安装 / 升级完成；后续 `0.4.x` 更新也通过 Marketplace 常规升级获取。
3. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.4.1` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续 `0.4.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续 `0.4.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.4.1` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 主画布全局视图
2. `Agent` / `Terminal` / `Note` 节点混合画布视图
3. `Remote SSH` 或运行时恢复主路径示意

若来不及补截图，不阻塞当前公开 `Preview` 更新。

## 发布前检查

1. 锁定最终要发布的 git ref、版本号与产物文件名。
2. 在最终 git ref 上执行：

       npm run validate:clean-checkout:vsix -- --ref <final-ref>

3. 在带 `.git` 元数据的最终 release checkout 中执行：

       npm run package:vsix

   若当前打包目录不含 `.git` 元数据，则改为：

       DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref> npm run package:vsix

4. 确认打包日志已经打印当前 README 改写 ref，且没有出现相对媒体 URL 校验失败。
5. 复核以下文件与当前版本事实一致：
   - `README.marketplace.md`
   - `CHANGELOG.md`
   - `docs/support.md`
   - `docs/SECURITY.md`
6. 确认 `Visual Studio Marketplace` 发布账号仍可用，且本地 `vsce login devsessioncanvas` 已保持有效。

## 发布命令

在版本号、最终 git ref 与 VSIX 产物都已锁定后，使用本地 `@vscode/vsce` 执行：

注意：`publish --packagePath` 只会上传现成 VSIX，不会重新处理 `README` 或 `CHANGELOG`。因此发布前必须先重新执行 `npm run package:vsix`，并确保该 VSIX 已由打包阶段写入 `README.marketplace.md`，且 README 相对媒体 URL 已按最终 git ref 校验通过。

    node node_modules/@vscode/vsce/vsce publish \
      --packagePath dev-session-canvas-0.4.1.vsix

若最终版本号不是 `0.4.1`，应先同步更新命令中的 VSIX 文件名。

## publish 后补 tag

`publish` 成功后，应立即给这次实际发布所对应的 commit 打上 `vX.Y.Z` 形式的 lightweight tag，并把该 tag 推送到远端仓库；只在本地打 tag 不算完成。不要等到后续 hotfix、README 修订或其他提交出现后再补打，避免 tag 漂移到错误提交。

若当前 shell 所在的就是本次发布对应 commit，可直接执行：

    git tag v0.4.1
    git push origin v0.4.1

若当前 shell 不在最终发布 commit 上，则应显式指定本次发布的最终 git ref 或 commit SHA：

    git tag v0.4.1 <final-ref-or-sha>
    git push origin v0.4.1

若最终版本号不是 `0.4.1`，应同步替换命令中的 tag 名称。当前约定是使用 lightweight tag，不额外创建 annotated tag；发布后验证也以远端 tag 已成功存在为准。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit。
2. 打开 Marketplace 页面，确认标题、图标、banner、README 文案与 CHANGELOG 没有失真。
3. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
4. 在干净 profile 中安装刚发布的版本，验证扩展可成功激活并能打开主画布。
5. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace` 与本地 CLI 依赖等限制仍被正确表达，没有被商店页误读成稳定版承诺。
