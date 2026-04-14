# 公开 Preview 发布执行手册

本文用于收口 `0.1.0` 首个公开 `Marketplace Preview` 版本的发布素材、手工发布步骤、安装/升级说明与回退口径。它不是对外宣传页，而是发布当天的执行与复核手册。

## 当前发布素材

- Marketplace listing 正文：`README.marketplace.md`
- release notes：`CHANGELOG.md`
- Preview 支持边界：`docs/support.md`
- 安全口径：`docs/SECURITY.md`
- 发布判断与背景：`docs/design-docs/public-marketplace-release-readiness.md`

## Marketplace listing 定稿口径

当前 listing 统一使用 `README.marketplace.md`，不再直接复用仓库根目录 `README.md`。

这样做的原因是：

- 仓库 `README.md` 仍需要描述公开 `Preview` 阶段下的开发者语境与源码开发入口
- Marketplace 页面需要一份面向已发布状态的对外文案，避免出现发布后立即失真的措辞
- 当前公开 Preview 的安装/升级说明也需要直接出现在商店页，而不是只藏在内部文档里
- 公开文案不应引入仓库内部历史包名或内部迁移背景，避免对 Marketplace 用户造成无关干扰

## release notes 定稿口径

当前 `0.1.0` 的 release notes 统一以 `CHANGELOG.md` 为准。发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。

发布前应确认以下内容在 `CHANGELOG.md` 中保持一致：

- 版本标题仍为 `0.1.0 - Public Preview`
- 功能概览、重点收口与已知限制与当前实现一致
- 已包含安装/升级说明与回退建议
- 不把 `Preview` 误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. `0.1.0` 是首个公开 `Preview` 版本，扩展身份为 `devsessioncanvas.dev-session-canvas`。
2. 当前版本通过 `Visual Studio Marketplace` 常规安装；后续 `0.1.x` 更新也通过 Marketplace 常规升级获取。
3. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.1.0` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续 `0.1.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布 `0.1.1` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 无论选择 hotfix 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

首个公开 `Preview` 版本不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 主画布全局视图
2. `Agent` / `Terminal` / `Note` 节点混合画布视图
3. `Remote SSH` 或运行时恢复主路径示意

若来不及补截图，不阻塞当前公开 `Preview` 首发。

## 发布前检查

1. 锁定最终要发布的 git ref、版本号与产物文件名。
2. 在最终 git ref 上执行：

       npm run validate:clean-checkout:vsix -- --ref <final-ref>

3. 在当前仓库根目录执行：

       npm run package:vsix

4. 复核以下文件与当前版本事实一致：
   - `README.marketplace.md`
   - `CHANGELOG.md`
   - `docs/support.md`
   - `docs/SECURITY.md`
5. 确认 `Visual Studio Marketplace` 发布账号仍可用，且本地 `vsce login devsessioncanvas` 已保持有效。

## 发布命令

在版本号、最终 git ref 与 VSIX 产物都已锁定后，使用本地 `@vscode/vsce` 执行：

    node node_modules/@vscode/vsce/vsce publish \
      --packagePath dev-session-canvas-0.1.0.vsix \
      --readme-path README.marketplace.md \
      --changelog-path CHANGELOG.md \
      --githubBranch main

若最终版本号不是 `0.1.0`，应先同步更新命令中的 VSIX 文件名。

## 发布后验证

发布完成后至少执行以下复核：

1. 打开 Marketplace 页面，确认标题、图标、banner、README 文案与 CHANGELOG 没有失真。
2. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
3. 在干净 profile 中安装刚发布的版本，验证扩展可成功激活并能打开主画布。
4. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace` 与本地 CLI 依赖等限制仍被正确表达，没有被商店页误读成稳定版承诺。
