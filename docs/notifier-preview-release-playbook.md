# Notifier 公开 Preview 发布执行手册

本文用于收口 `Dev Session Canvas Notifier` 的公开扩展市场发布素材、手工发布步骤、安装启用口径与发布后复核动作。当前发布准备目标为 `0.27.0`，上一已发布版本为 `0.26.0`；publisher 沿用 `devsessioncanvas`，扩展 ID 为 `devsessioncanvas.dev-session-canvas-notifier`。

当前约定是：notifier 的版本号继续与主扩展 `Dev Session Canvas` 对齐。也就是说，只要 notifier 仍以 companion 身份随主扩展同轮迭代发布，就继续使用同一个 `0.x.y` 版本号；如果未来 notifier 需要在主扩展不发版的情况下单独迭代，则必须先重新确认是否继续沿用“版本对齐”策略，避免同一版本号对应两组不同的发布事实。本轮 `0.27.0` 需要保持两侧 manifest / changelog / 产物名同版本；notifier 本轮不引入新的通知投递行为、协议、后端选择、点击回跳语义或本地化边界变化。

## 后续版本标准流程

notifier 随主扩展进入同一份 `docs/release-contracts/vX.Y.Z.md`，发布前定稿用户说明、Marketplace 文案、文档清单与已知限制。CHANGELOG 只写用户可见行为、安装升级和限制；运行结果、SHA、渠道状态与内部待办不写入 CHANGELOG，也不在发布后回写同版本契约。

正式流程由 `docs/WORKFLOW.md`、`docs/design-docs/release-gate-redesign.md` 和主扩展手册共同定义。发布 PR 的真实最新预合并 SHA 执行完整 `release-pr`；合入 main 后，从 main 启动构建验收，以显式产品 SHA 独立执行 `release-tag`，产出固定双包批次。验证阶段的 `package-clean` 在干净源码与锁定依赖上生成同批 main / notifier VSIX，后续 packaged-host、三平台 x64 原样安装和交付消费原双包。

`Verify release contract` 只有独立核对真实 Actions job / 工件来源、完整必跑集合和同批产物成功后才能通过。当前 GitHub 活动 ruleset 已将它设为 `main` 的 required status check，并要求 PR 至少一次审批、分支追上最新 base；实际规则以 GitHub 当前活动 ruleset 为准。draft 跳过或本地结果不满足该门槛。最终 SHA 完整验收前可以生成候选 VSIX，不能创建正式 Release、写市场或删除临时 tag。实际交付仅复用验收过的 bytes。

## 0.27.0 发布前检查

本版采用 `docs/release-contracts/v0.27.0.md` 的完整任务图，不继承 0.26.0 延后 companion 的授权。notifier 类型/source、companion 回跳、英中文 locale，以及双包中的版本、README、NLS/l10n 和单向安装依赖均进入计划。notifier 自身投递后端、点击与语言契约不变，主扩展修复执行提醒接线。

仓库根的静态检查为：

    npm run release:preflight -- --version 0.27.0

本地补充验证使用固定 Node 版本，在已提交的 PR 工作树运行 `npm run release:verify -- --version 0.27.0`。该命令在隔离 checkout 运行同一任务图，仅输出 `acceptance: false`，缺少外平台记 `not-run`；独立 notifier 打包或单项 smoke 也不能代证 Actions 正式验收。主扩展手册说明完整 PR 验收步骤。

过程和历史证据见 `docs/design-docs/release-0-27-0.md`。staged callback 与 locale 检查不代证真实桌面通知、点击回跳或公开市场自动依赖；后者仍按实际渠道 / 宿主复核。

### 0.26.0 验证例外（历史）

该版companion posted diagnostic超时被授权延后，记录保存在原契约与技术债中；历史失败不能删除，也不能当成0.27.0当前结论。

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

## v0.25.0 发布前检查（历史记录）

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
8. 确认 workflow 会把 notifier 与主扩展同轮上传到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 当前已从发布 workflow 移除，manifest 将其记录为 deferred。
9. 复核 Open VSX namespace / token 与 `OVSX_PAT`；当前发布 workflow 只运行 GitHub Release assets 和 Open VSX。Visual Studio Marketplace 暂停期间不使用 `VSCE_PAT`，并在 manifest 中记为 deferred。GitHub Release assets 只是额外下载入口。

## 发布命令

主扩展与 notifier 使用同一产品提交、版本与验收批次。发布准备 PR 合入 main 后，先执行 `build-release-batch.yml --ref main`，传入产品 SHA/版本；完整验收和 seal 成功后，再执行 `publish-marketplace-release.yml --ref main`，传入版本与构建 run/attempt。完整命令见[主扩展发布手册](public-preview-release-playbook.md#发布命令)。

发布工具来自本次 main workflow SHA，主扩展、notifier、摘要及发布文案来自固定批次。工具升级不重新构建或替换 notifier。GitHub/Open VSX 双包验真后才完成，VSM 保持 deferred。

首发中断和渠道失败都使用同一批次参数发起新的发布运行；有状态链时先核验原状态。无批次的历史完整 Release 可使用版本与 target 原包恢复，详见[渠道恢复](public-preview-release-playbook.md#渠道恢复)。不提供 notifier 单包重新构建入口。

## Tag 与版本对齐约束

- 主扩展与 notifier 共用产品 SHA 和正式 `vX.Y.Z` tag，不另发 notifier 专属 tag。
- 新流程不需要远端 publish tag；历史临时 tag 只有在必需交付完成且身份一致时才清理。
- 构建批次和来源证明保留 90 天；过期时拒绝恢复，不用新构建替换原双包。版本规则与主扩展相同。

## 发布后验证

1. 打开 Open VSX 页面，确认 notifier 与主扩展都已经同步到本轮版本，名称、图标、README 文案、issue 链接与许可证信息没有失真；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 标记为 deferred。
2. 打开 GitHub Release 页面，确认 notifier VSIX、主扩展 VSIX 与 release manifest 都存在于 Assets 中。
3. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX，并分别验证两条安装路径。Visual Studio Marketplace 恢复后再补做该路径验证：
   - 只安装 `Dev Session Canvas Notifier`，确认 VS Code 会自动补齐 `Dev Session Canvas`
   - 卸载后只安装 `Dev Session Canvas`，确认 VS Code 会自动补齐 `Dev Session Canvas Notifier`
4. 确认主扩展设置里的 `devSessionCanvas.notifications.attentionSignalBridge` 默认值是 `system`。
5. 英文 / 简体中文 locale 文案已有 `npm run test:notifier-locale-smoke` 自动覆盖；发布后仍应各手动运行一次 `Dev Session Canvas Notifier: Send Test Desktop Notification` / `Dev Session Canvas Notifier: 发送测试桌面通知`，重点确认真实系统通知确实出现，以及在支持平台上点击后是否能回到 VS Code。
6. 英文 locale 下运行 `Dev Session Canvas Notifier: Open Notification Diagnostic Output`，简体中文 locale 下运行 `Dev Session Canvas Notifier: 打开通知诊断输出`，确认 `backend`、`activationMode` 与最近一次投递结果符合当前平台预期。

## 0.25.0 及更早验证备注（历史）

- notifier 子包现在已经显式提供 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`，可直接从仓库根目录执行；真正产物文件名以当前 notifier manifest 版本为准，而不是手册里预设的常量。
- notifier 的打包脚本现已固定打印 `VSCE README doc ref`；即使当前 `README.marketplace.md` 没有相对链接，也会显式输出“当前没有需要重写的相对链接”，便于 release-day 复核“最终发布 ref 已参与打包校验”。
- notifier 现在与主扩展一样使用英文默认 + 简体中文本地化资源；发布前必须确认 VSIX file list 包含 `package.nls.json`、`package.nls.zh-cn.json` 与 `l10n/bundle.l10n.zh-cn.json`，并运行 `npm run test:notifier-locale-smoke` 覆盖真实英文 / 简体中文宿主文案。
- `0.24.2` 已从最终 `main` release ref `c1e13b754d6a1f7be85d14b5d908967d464e1c6a` 完成 GitHub Release assets + Open VSX 兜底发布；正式 `v0.24.2` 指向同一 ref，`publish/v0.24.2` 已删除。最终 notifier asset 为 `159,016 bytes`，`sha256=304f1917ffd17f4096b7391f62a3f02508de50c26315ff573e785b5fa5ba7bba`；Open VSX notifier `0.24.2` 为 `verified=true`，Visual Studio Marketplace notifier 记录为 `publish-failed` / deferred，2026-07-14 public gallery 复核仍不可见。
- `0.25.0` 发布准备分支已同步 notifier manifest、notifier changelog 与本手册中的目标版本；notifier 本轮继续随主扩展对齐版本，但不引入新的通知投递行为。版本同步后的 notifier build、typecheck、source、companion smoke、英文 / 简体中文真实 Host locale smoke、VSIX file-list 守卫与 `npm audit --omit=dev` 均已重新执行并通过；主扩展 packaged-payload smoke 和隔离 clean-checkout 验证也已通过。当前 dirty-tree notifier 候选工件为 `159,279` bytes，`sha256=ac3f8fb59681fa081f52fd25907d8030797029f1578495fa3b8b375b175553d8`，仅作分支证据，不能直接作为最终 Release asset。
- Visual Studio Marketplace 与 Open VSX 的实时可见 / verified 状态必须在 `0.25.0` release-day 重新查询；在查询完成前，不得把 VSM 安装路径写成已恢复，也不得把旧版本渠道结果冒充本轮结果。
- 发布准备阶段要求在 MR 合入后的 clean `main` ref 上重跑完整 gate 与 `publish/v0.25.0` dry-run，且不把准备分支 working tree 生成的 notifier VSIX 直接当作 Release asset。
- 仍需单独记住的一点是：repo-local staged smoke / VSIX smoke 会为了装配 development host 或 packaged payload 临时移除 `extensionDependencies` / `extensionPack`，因此“真实安装时是否自动补齐依赖”必须通过上面的 clean profile 安装步骤复核，不能把 staged smoke 直接当成这条结论的自动化证据。
