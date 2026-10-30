# 公开 Preview 发布执行手册

本文用于当前 `0.27.0` 公开 Preview 的发布准备与执行；上一已发布版本为 `0.26.0`。范围是最新 main 已合入的执行可靠性修复与同 root 共享画布，静态范围以 `docs/release-contracts/v0.27.0.md` 为准。旧 PR #313 已舍弃；历史0.26.0验证例外和更早发布记录保留原含义。

## 后续版本标准流程

`0.25.0` 及 `0.26.0` 的具名记录保留历史含义；当前流程以 `docs/WORKFLOW.md` 和 `docs/design-docs/release-gate-redesign.md` 为准。发布准备分支同步版本、两个 CHANGELOG、Marketplace 文案和 `docs/release-contracts/vX.Y.Z.md`。契约在发布前定稿，写明发布范围、用户 release notes、已复核文档、已知限制和验证范围。

CHANGELOG 只描述用户可见的功能、安装升级、回退和限制。候选 / 最终 SHA、workflow run、工件摘要、渠道状态及门禁结果分别保留在验证证据和发布后 manifest / Release 中，不回写同版本 CHANGELOG 或契约。

发布 PR 每次更新由最新远端目标与 head 生成真实预合并 SHA。`Release Preflight` 调用 `ci-validation.yml`，版本或契约变化强制 `release-pr` 全部任务。`Verify release contract` 必须独立核对实际 Actions job / 工件来源、精确必跑集合和同批双包验收成功；draft 的跳过、取消、缺结果、错误输入及取证 / 清理失败都不能放行。该稳定检查应配置为 required status check；目前 main 尚未配置保护，不能把仓库要求写成 GitHub 已强制执行。

PR 经 review 合入后，在最终 main release commit 创建 `publish/vX.Y.Z`。新发布以 `release-tag` 再次执行完整任务图：验证阶段可以构建候选 VSIX，交付阶段只消费已验收的同批原包。完整验收通过前不得创建正式 Release、写入市场或删除临时 tag。渠道恢复按下文 `channel-retry` 路径复核原包、原 acceptance 与状态链。

## 0.27.0 发布前检查

本版不继承 0.26.0 例外。在仓库根先执行纯静态检查：

    npm run release:preflight -- --version 0.27.0

提交静态输入，fetch 并 rebase 到最新 `origin/main` 后推送 #327；准备正式验收时转为非草稿。Actions 按该输入的 `scripts/gates/catalog.mjs` 冻结任务与环境：全部登记回归、Webview 功能 / 视觉、Marketplace 浏览器 / Host、六目标原生加载与操作、全部标准 source-host / packaged-host，以及三平台 x64 原样双包安装。`package-clean` 在干净源码和锁定依赖上生成主扩展 / notifier 双包，后续场景只消费该批产物。notifier 类型/source、companion、英中文 locale、版本、README、安装关系和 NLS/l10n 都在对应任务中核对。

需要本地补充观察时，使用 `scripts/gates/catalog.mjs` 固定的 Node 版本（当前 22.23.3），在已提交的 PR 工作树运行：

    npm run release:verify -- --version 0.27.0

该入口自动冻结输入并建立隔离 checkout，输出目录必须是源码树外的新目录；默认会创建临时证据目录。本地只产生 `acceptance: false`，缺少的外平台任务明确记 `not-run`。它不等于旧的串行完整 npm test / 八场景重打包，也不能替代 Actions 完整验收；定向 `ci:diagnose` 同样不能放行发布。

默认锁定依赖安装、环境准备、业务断言与预算由任务图管理；历史 ETXTBSY、网络失败或诊断对照保留各自输入，不能用跳过安装脚本、拼接单项通过或复用旧绿色覆盖失败。最新 head / base / 预合并输入与正式结果关联 PR checks；过程见 `docs/exec-plans/active/release-0-27-0-prep.md`，证据边界见 `docs/design-docs/release-0-27-0.md`。

完整验收与最终 head 复审通过后才可合并；最终 tag 仍须独立验收。公开市场自动补齐与真实桌面点击依赖实际渠道 / 宿主，staged smoke 不代证。

### 0.26.0 验证例外（历史）

2026-10-08用户只授权0.26.0先发布、后修四项测试问题；精确范围保存在docs/release-contracts/v0.26.0.md。该次授权范围通过不等于完整测试通过，不能用于0.27.0。

## 当前发布素材

- Marketplace listing 正文：`extensions/vscode/dev-session-canvas/README.marketplace.md`（引用主扩展子包内 `images/marketplace/canvas-overview.png` + `images/marketplace/canvas-overview.mp4`）
- Marketplace listing 中文对应版：`extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md`（仅作仓库内中文对应文案，不作为默认打包输入）
- 仓库 README 默认英文：`README.md`（引用 `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.gif`）
- 仓库 README 中文对应版：`README.zh-CN.md`（引用 `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.gif`）
- release notes：`extensions/vscode/dev-session-canvas/CHANGELOG.md`
- 主扩展图标资产：`extensions/vscode/dev-session-canvas/images/icon.png`
- 圆形头像安全区图：`extensions/vscode/dev-session-canvas/images/avatar.png`
- 仓库根 README 交流二维码资产：`extensions/vscode/dev-session-canvas/images/lark-group-qr.png`、`extensions/vscode/dev-session-canvas/images/wechat-group-qr.png`（仅供根 `README.md` / `README.zh-CN.md` 引用，继续排除出 VSIX 与 Marketplace listing 输入）
- Preview 支持边界：`docs/support.md`
- 安全口径：`docs/SECURITY.md`
- 发布判断与背景：`docs/design-docs/public-marketplace-release-readiness.md`
- 当前更新依据：`docs/design-docs/execution-node-terminal-native-interactions.md`、`docs/design-docs/execution-terminal-resize-coalescing.md`、`docs/exec-plans/active/execution-terminal-native-link-parity.md`、`docs/exec-plans/completed/execution-terminal-resize-coalescing.md`、`docs/design-docs/agent-terminal-lossless-io-and-recovery.md`、`docs/design-docs/canvas-fork-placement-and-generated-node-collision.md`、`docs/design-docs/execution-lifecycle-and-recovery.md`、`docs/design-docs/agent-launch-modes-and-restart.md`、`docs/product-specs/runtime-persistence-modes.md`、`docs/product-specs/agent-launch-modes-and-restart.md`、`docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/UI.md`、`docs/FRONTEND.md`
- 模板市场产品与设计依据：`docs/product-specs/template-marketplace.md`、`docs/design-docs/template-marketplace.md`、`docs/workflows/SERVICE_DEPLOY.md`

## Marketplace listing 定稿口径

当前 listing 统一使用主扩展子包内英文默认版 `extensions/vscode/dev-session-canvas/README.marketplace.md`，不直接复用仓库根目录 `README.md`。`extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md` 仅作为仓库内中文对应版本保留，不改变默认 Marketplace 打包入口。

当前 `npm run package:vsix` 会 staging 主扩展子包，并在打包阶段显式传入 `--readme-path README.marketplace.md`，因此最终用于发布的 VSIX 已内嵌 Marketplace 专用 README；后续 `publish --packagePath` 只上传现成 VSIX，不会再替换 README。打包脚本默认会把 README 相对资源改写到当前 `HEAD` 对应的 git ref；如果在没有 `.git` 元数据的 clean checkout、导出目录或 tarball 中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，否则不允许继续打包。

本轮listing必须说明同root共享画布、删除/stop区别、开关在关闭或重载边界应用、非最后窗口detach与最后窗口清理接管，以及普通关闭保持会话。关闭 Runtime Persistence 时，画布保存在当前工作区对应的存储位置；工作区画布与共享画布内容不迁移，不能宣传跨设备或云同步。启动和终端交互修复按用户行为表述，45秒ready预算只属于测试，不写成自动启动恢复能力。0.26.0既有当前态导入、已结束Runtime无正文和灾后不保证恢复的边界继续沿用。

## release notes 定稿口径

当前0.27.0 release notes以双CHANGELOG和docs/release-contracts/v0.27.0.md为准，基于0.26.0之后已合并的功能；历史版本条目保持原文。主扩展顶部为0.27.0 - 执行可靠性与共享画布，notifier仅版本对齐。复核 Runtime Persistence 开关切换时的工作区画布与共享画布数据边界、启动失败反馈、删除输入和保存责任、终端交互与提醒；保留上游快速重开资源延迟、持续启动失败缺少自动反馈、平台/真实provider有限验证及跨版本回退限制。不得写入候选hash、测试通过或渠道事实。

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前发布准备目标为 `0.27.0`，上一已发布版本为 `0.26.0`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.26.0` 升级到 `0.27.0` 的目标仍是通过当前宿主配置的公开扩展市场常规安装 / 升级完成。Open VSX 侧应继续同版本公开发布；官方 VS Code 的 `Visual Studio Marketplace` 仍是目标主路径，但 public gallery 是否可见必须在 release-day 重新检查；若仍不可见，允许延期补发，不阻塞本轮 `0.27.0` 以 GitHub Release assets + Open VSX verified 完成。对外宣称 VSM 安装路径前仍必须确认主扩展与 notifier 均公开可见。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. UI 语言跟随 VS Code locale；本版本不新增扩展自己的语言设置，也不会翻译用户内容、路径、终端输出、provider 原始输出或市场模板数据。
5. 已结束的持久化 Runtime 重开只保留节点、配置与退出状态，不恢复正文或自动 start/resume；显式 provider Resume 和 provider 会话文件独立保留。
6. 旧 live 会话沿用原 Supervisor、storage 与 session，不自动迁移到当前原生实现；新会话使用当前实现，旧协议不获得新完整性承诺。
7. 跨 Host 存活仍要求 `devSessionCanvas.runtimePersistence.enabled` 与可用后端；Supervisor 崩溃或机器重启不保证恢复。snapshot-only 不承诺跨 Host 存活，且不在本轮已结束 Runtime 无历史规则的改动范围内。
8. `devSessionCanvas.canvas.forkPlacementDirection` 默认 `up`，也可设为 `down` 或 `right`；设置热生效于后续当前节点 Fork，不重排既有节点 / 连线，历史会话 Fork 继续使用通用邻近避碰。
9. 模板市场生产入口默认为 `https://dscanvas.dev/templates`；生产环境不会把代码内 seed 模板暴露为正式内容，初始空目录属于当前受控状态，不代表扩展安装失败。
10. 若用户此前显式配置过 `devSessionCanvas.runtimePersistence.enabled`、`devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled`、`devSessionCanvas.canvas.multiRootPresentationMode` 或 `devSessionCanvas.canvas.forkPlacementDirection`，升级到 `0.27.0` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时继续使用默认 allow-list，未配置 `multiRootPresentationMode` 时继续使用默认 `rootGroups`。
11. 当前仍为 `Preview`，不承诺跨版本 workspace / runtime journal 状态完全兼容；若涉及关键工作区，建议升级前先停止重要会话、备份画布状态，并在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.27.0` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.26.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，先停止重要运行会话，再重新安装目标版本并重新验证工作区状态；当前不承诺 `Preview` 版本或 Supervisor journal 之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.26.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 模板市场服务-only 问题优先走 `docs/workflows/SERVICE_DEPLOY.md` 的服务 deploy tag / rollback，不自动提升或回滚插件 SemVer；插件包问题才走插件发布流程。
4. 无论选择 hotfix、服务 rollback 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.27.0` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. execution terminal 中同一文本路径与 PNG / GIF / MP4 媒体路径分别由对应 VS Code editor 接管的对照
2. Agent / Terminal 节点 resize 时外框实时预览、字符网格最终一次收敛，以及 provider 画面无逐帧叠字的对照
3. 当前 Agent 节点向上 / 向下 / 向右 Fork 的固定层级与方向化连线对照
4. persistent journal current checkpoint 损坏后从 previous + suffix 恢复的前后对照

若来不及补截图，不阻塞当前公开 `Preview` 更新。


## v0.25.0 发布前检查（历史记录）

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
   - `extensions/vscode/dev-session-canvas/README.marketplace.md`
   - `extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md`
   - `extensions/vscode/dev-session-canvas/CHANGELOG.md`
   - `docs/support.md`
   - `docs/SECURITY.md`
   - `docs/design-docs/agent-terminal-lossless-io-and-recovery.md`
   - `docs/design-docs/execution-lifecycle-and-recovery.md`
   - `docs/design-docs/canvas-multi-root-workspace-support.md`
   - `docs/design-docs/agent-launch-modes-and-restart.md`
   - `docs/design-docs/agent-running-state-detection.md`
   - `docs/product-specs/runtime-persistence-modes.md`
   - `docs/product-specs/canvas-multi-root-workspace-support.md`
   - `extensions/vscode/dev-session-canvas/package.nls.json`
   - `extensions/vscode/dev-session-canvas/package.nls.zh-cn.json`
   - `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`
   - `extensions/vscode/dev-session-canvas-notifier/README.marketplace.md`
   - `extensions/vscode/dev-session-canvas-notifier/README.marketplace.zh-CN.md`
   - `extensions/vscode/dev-session-canvas-notifier/CHANGELOG.md`
   - `extensions/vscode/dev-session-canvas-notifier/package.nls.json`
   - `extensions/vscode/dev-session-canvas-notifier/package.nls.zh-cn.json`
   - `extensions/vscode/dev-session-canvas-notifier/l10n/bundle.l10n.zh-cn.json`
   - `docs/workflows/SERVICE_DEPLOY.md`
7. 确认发布 workflow 会先把同一批 VSIX 镜像到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许 deferred，不阻塞 `0.25.0` 完成。仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与按完成门禁删除临时 tag。
8. 复核 `OVSX_PAT`、`VSCE_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前完成门禁要求 Open VSX 可发布验证。`VSCE_PAT` 仍用于尝试 Visual Studio Marketplace 发布 / 验证，但 VSM 不可见时可记录为 deferred channel。GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：当前优先使用已验证的 Open VSX 或 `vX.Y.Z` 对应 GitHub Release Assets；Visual Studio Marketplace 只有在 public gallery 恢复且主扩展 / notifier 均可见后才作为已可用路径宣称。
10. 确认生产模板市场事实没有被写成插件发布事实：服务当前线上版本应结合 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 判断；插件发布 tag 不自动部署生产服务。

## 0.25.0 及更早验证备注（历史）

截至 `2026-09-16`，本轮发布输入锁定为最终 `main` release ref `4d7f07e55461f414c570365136cc06ece6f18c64`；上一公开基线为 `v0.24.5`（`a9e27873aa01c1d1f1e43b4303ff697ce618c8cf`）。`v0.25.0` 已完成 GitHub Release assets + Open VSX 兜底发布，远端 `publish/v0.25.0` 临时 tag 已删除。

本轮已完成的 repo-local 同步：

- 版本号同步：根 `package.json`、主扩展 manifest、notifier manifest、`package-lock.json` 根版本、主扩展 package entry 与 notifier package entry 均更新为 `0.25.0`
- release notes 同步：主扩展与 notifier changelog 已新增 `0.25.0` 顶部条目，明确 PTY title、Runtime Supervisor 回滚边界、安装 / 升级 / 回退口径与 notifier 仅对齐版本
- Marketplace / README 文案同步：主扩展 Marketplace 中英文 listing、仓库中英文 README 已更新为 `0.25.0` 发布口径；已区分 PTY title 运行时能力、`0.24.5` 不再承诺的恢复边界、发布素材与维护证据
- 发布设计与执行计划已同步：`docs/design-docs/public-marketplace-release-readiness.md` 与已归档的 `docs/exec-plans/completed/release-0-25-0-prep.md` 已记录 release input lineage、回滚 / 保留 / 重新实现分类和验证缺口

版本同步后的 repo-local 分层验证已完成：主扩展 / notifier typecheck、PTY title parser / protocol / Webview 定向测试、manifest / package / publish workflow 守卫、双扩展 build、notifier source / companion / locale smoke、PTY title Playwright 回归、`npm audit`、`npm audit --omit=dev`、生产模板市场 workflow 守卫和 working-tree packaged-payload smoke 均通过。PTY title Playwright 定向回归为 `1 passed`，两次 audit 均为 `0 vulnerabilities`；`npm run test:vsix-smoke` 输出 `VSIX packaged-payload smoke passed`。

`npm run validate:clean-checkout:vsix -- --source working-tree` 进一步在隔离目录完成独立 `npm ci`、117-file 主扩展 VSIX 打包和 packaged-payload smoke，临时目录已清理。该验证证明 working-tree 快照可打包；最终 workflow 又在 release ref 上重新生成了正式工件，不能混用两组 SHA。正式工件、README doc ref 与 release ref 均已记录在下方的 0.25.0 发布后复核中。

在最终 release ref 的无历史 tag 冲突 clean clone 中，已按原样执行 `npm run release:publish-tag -- --trigger-tag publish/v0.25.0 --dry-run --package-only` 并通过；实际 GitHub Actions run `35040928600` 也已完成正式打包、发布和收口。

当前残余风险：Visual Studio Marketplace 仍为 deferred channel，不能对外宣称 public gallery 已可用；真实 Extension Development Host 中手工设置 / 清空 title、真实 Codex / Claude provider spinner、Webview reload、跨 VS Code 生命周期 reattach、Linux / Remote SSH systemd `WorkingDirectory` 与运行时失败分层仍需按实际证据表达；journal 无固定磁盘上限、90000 行尾部短读、Fork 视觉 / footprint、跨平台真实升级矩阵和跨节点 / 跨 surface 多指边界继续保留。

### 0.25.0 发布后复核

截至 `2026-09-16`，GitHub Actions run [`35040928600`](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35040928600) 已从最终 `main` release ref `4d7f07e55461f414c570365136cc06ece6f18c64` 完成发布。正式 tag `v0.25.0` 指向同一 ref；对应 [GitHub Release](https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.25.0) 为非 draft、非 prerelease，远端 `publish/v0.25.0` 已删除。最终 manifest 状态为 `complete-with-deferred-visual-studio`，`releaseCompletion.requiredTargets` 为 `github-release-assets` + `open-vsx`，`tags.triggerTagStatus=deleted`。

正式 GitHub Release assets 为主扩展 `dev-session-canvas-0.25.0.vsix`（`3,936,447` bytes，`sha256=88eeef48707f69f760b65713f7571841161d7eb4742057dfdf3fcf3117a6b811`）、notifier `dev-session-canvas-notifier-0.25.0.vsix`（`159,757` bytes，`sha256=862e0b90cc9c70fca0ef0053e9a6fd2cbc5e69f208efecc11162576449ebc543`）与 `release-manifest-0.25.0.json`（`3,104` bytes，`sha256=1441435bacee8df647ca8d6c361f8c594cae4cb9154e4663e029aa19e50b961b`）。两个 VSIX 的 `packagingDocRef` / `readmeDocRef` 均为 `4d7f07e55461f414c570365136cc06ece6f18c64`。

Open VSX 主扩展与 notifier 的 `0.25.0` 均发布并验证为 `verified`。Visual Studio Marketplace 两个扩展在最终 manifest 中均为 `publish-failed` / deferred；本轮不得对外宣称 VSM public gallery 已可用。GitHub Release assets + Open VSX verified 已满足本轮完成门禁。

发布 workflow 的四个 job 均以 success 结束：prepare `104620391035`、Open VSX `104620556496`、Visual Studio Marketplace `104620556404`、finalize `104623088764`。Actions 仍报告 checkout/setup/upload/download action 使用 Node.js 20 的 deprecation annotation；该 annotation 未改变本轮发布结论，后续应按技术债跟踪升级 action 版本。

### 0.24.2 发布后复核

截至 `2026-07-14`，Actions run [`29309330723`](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/29309330723) 已从最终 `main` release ref `c1e13b754d6a1f7be85d14b5d908967d464e1c6a` 成功完成发布。正式 `v0.24.2` tag 指向同一 ref，远端已删除 `publish/v0.24.2` 临时 tag；对应 [GitHub Release](https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.24.2) 不是 draft 或 prerelease。最终 release manifest 状态为 `complete-with-deferred-visual-studio`，两个 artifact 条目的 `packagingDocRef` / `readmeDocRef` 均为最终 release ref，`githubRelease.status=assets-uploaded`，`tags.triggerTagStatus=deleted`。

正式 GitHub Release assets 为主扩展 `dev-session-canvas-0.24.2.vsix`（`3,925,962 bytes`，`sha256=8e5c125987b51eb815ac80bd138583f178100528653f8558ece0919b51673ac5`）、notifier `dev-session-canvas-notifier-0.24.2.vsix`（`159,016 bytes`，`sha256=304f1917ffd17f4096b7391f62a3f02508de50c26315ff573e785b5fa5ba7bba`）与 `release-manifest-0.24.2.json`（`3,104 bytes`，`sha256=3b05f15c8a8dbb3923cc28bb8386324c66d7b338836adb5aabfcc208caec3c75`）。这些最终工件与发布准备分支生成的候选 VSIX 大小和 SHA 不同，不得混用。

Open VSX API 已分别确认主扩展与 notifier 均为 `version=0.24.2`、`verified=true`。Visual Studio Marketplace 双扩展在最终 manifest 中均为 `publish-failed` / deferred；2026-07-14 对 `devsessioncanvas.dev-session-canvas` 与 `devsessioncanvas.dev-session-canvas-notifier` 的 public gallery 独立查询均为 `count=0`、`TotalCount=0`。后续 Open VSX 文件级请求曾遇到代理 / TLS timeout，但不覆盖 workflow、最终 manifest 与此前成功 API 查询形成的已验证事实。

最终 `main` 上的 `npm ci` 安装 `651` packages 且报告 `0 vulnerabilities`；发布、manifest、VSIX、双市场和 production deploy workflow 守卫，主扩展 / notifier typecheck 与 build、notifier source、Fork / placement / groups / multi-root / layout / UI copy、journal / serialized tracker / Supervisor protocol / paths / output 回归均通过。10-Agent 样本处理 `828,019` 字符，input response 为 `10.67ms`、echo 为 `20.9ms`。推送临时 tag 前，最终 ref 的 package-only dry-run 已通过；`npm run validate:clean-checkout:vsix -- --ref c1e13b7` 随后完成独立 `npm ci`、`117`-file VSIX 和 VS Code `1.128.0` packaged-payload smoke，最终 code 为 `0`。

本次成功 run 同时对仍以 Node.js 20 为目标的 `actions/checkout@v4`、`actions/setup-node@v4`、`actions/upload-artifact@v4` 与 `actions/download-artifact@v4` 发出强制改用 Node.js 24 的 deprecation annotation；该 annotation 没有改变本次 run 的 `success` 结论，后续升级 action 版本与发布 workflow 回归已登记到 `docs/exec-plans/tech-debt-tracker.md`。

### 0.24.1 发布后复核

截至 `2026-07-14`，`0.24.1` 已从最终 `main` release ref `51dd07ed95f0e26db184cd4ce14decd5ce2721f7` 完成 GitHub Release assets + Open VSX 兜底发布。正式 `v0.24.1` tag 指向同一 ref，远端与本地均不存在 `publish/v0.24.1` 临时 tag。最终 release manifest 状态为 `complete-with-deferred-visual-studio`，Open VSX 主扩展与 notifier `0.24.1` 均为 verified，Visual Studio Marketplace 双扩展记录为 `publish-failed` / deferred；2026-07-14 对两个 extension id 的 public gallery 独立复核仍为 `count=0` / `TotalCount=0`。

正式 GitHub Release assets 为主扩展 `dev-session-canvas-0.24.1.vsix`（`3,909,883 bytes`，`sha256=fcae9ea4a00563d18a022b404597a36c9c0c28cd87791bdfb4a271402f22bcf9`）、notifier `dev-session-canvas-notifier-0.24.1.vsix`（`158,897 bytes`，`sha256=874488c00ec9eb80f01c1b7b2b69ba78b94fd371a902b67f057159e88aa10a88`）与 `release-manifest-0.24.1.json`。manifest 的 `packagingDocRef` / `readmeDocRef` 均为最终 release ref，`githubRelease.status=assets-uploaded`，`tags.triggerTagStatus=deleted`；这些事实与 GitHub Release、Open VSX latest API 和远端 tag 独立复核一致。

`v0.24.1` Release notes 已包含 generation 并行排空、旧会话交互、Linux-only 真实升级矩阵、旧 raw tail、90000 行短读和 `test:smoke-storage-slot` 边界。#262 的 forced-drain 单次 serialize / 事件驱动门禁与 #263 的 journal compact 都晚于该不可变 release ref，因此只进入 `0.24.2`，不得倒写成 `0.24.1` 工件已经包含。

## 发布命令

以下是取得发布授权后的操作说明。发布准备 PR 必须已经完成正式验收、review 并合入 main。显式指定最终 release commit，避免把当前 shell 的其他 HEAD 当作发布输入：

    git fetch origin main --tags
    git merge-base --is-ancestor <final-release-sha> origin/main
    git tag publish/v0.27.0 <final-release-sha>
    git push origin publish/v0.27.0

推送临时 tag 触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow 只响应 `publish/v*` push 和手动 `workflow_dispatch`，按六个外层 job 执行：

1. `resolve-release` 冻结版本、最终 SHA、main 归属及交付目标，区分首次发布和原包恢复；首次发布必须选择 `all`。
2. `verify-release` 经 `release-validation.yml` 调用 `ci-validation.yml`，在最终 SHA 以 `release-tag` 验收全部任务和同批候选双包；恢复模式则复核原 acceptance、双包来源和所选渠道。
3. `prepare-release` 消费已验收的原双包，复算摘要 / ref / 版本及回执来源，再创建或确认正式 tag / GitHub Release、上传原 bytes 并校验远端内容。此阶段不打包。
4. `publish-open-vsx` 与 `publish-visual-studio` 独立消费原双包，逐扩展查询、提交并验真；提交结果未知时先查询，不能盲目重复提交。
5. `finalize-release` 核对实际 job 与渠道回执，更新 manifest / Release notes；必需目标完成后才删除临时 tag，清理失败保留独立结果。

`release:publish-tag` 现在是 workflow 使用的显式 phase 入口：`resolve` 生成冻结 context，`verify-recovery`、`prepare`、`finalize` 消费该 context 与对应来源。旧 `--package-only`、`--skip-package`、`--dry-run`、`--no-create-final-tag` 不是当前入口，不应用旧手工命令绕过验收。历史 tag 使用其 tag 内原 workflow，不把旧例外带到 0.27.0。

## 渠道恢复

若首次发布尚未完成验证 / 构建，修复后重跑对应输入的必要前置，仍须取得一次完整验收。如果 GitHub Release 已保存可核验的原双包、acceptance 与状态链，使用原最终 tag 对应的 workflow 发起渠道恢复。例如补发 Open VSX：

    gh workflow run publish-marketplace-release.yml --ref v0.27.0 -f trigger_tag=publish/v0.27.0 -f target=open-vsx

补发 Visual Studio Marketplace 时将 `target` 改为 `visual-studio`；同时复核两渠道使用 `all`。即使临时 publish tag 已删除，resolver 也能依据同版本正式 tag 和原 Release 识别 `channel-retry`，无需移动或重建发布输入。

恢复下载原双包、原 acceptance 和连通父状态链，独立核对输入、摘要与 producer，只处理所选渠道并按规则保留未选渠道的原成功事实。缺资产、缺回执、状态分叉、内容冲突或来源不可核验时停止并保留现场，不通过删除原 Release、覆盖资产或重打包修复。当前恢复入口只选择渠道，不提供单独 `--extension notifier` 的发布分支。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 固定发布意图和输入，发布失败时保留。`vX.Y.Z` 是正式 lightweight tag 和 GitHub Release 的绑定；新发布的 prepare 只能在最终 SHA 完整验收后创建或确认它，随后开始渠道交付。单看正式 tag 或 Release 存在不足以说明发布完成。

0.27.0 的必需目标是 GitHub Release assets 和 Open VSX，均包含主扩展与 notifier；Visual Studio Marketplace 独立尝试，允许按既定策略记录 deferred。finalize 必须核对原包、实际 job / 回执、最终 manifest / notes，以及 trigger / final tag 的一致身份后完成 tag 清理。删除失败标为清理失败并供幂等恢复，不抹去已经成立的渠道事实。

release manifest、原 acceptance / 状态证据、主扩展与 notifier VSIX 保存在 GitHub Release assets，workflow 的 Actions 工件提供对应来源。发布后事实不提交回仓库；若版本改变，统一更新静态发布契约、版本、用户文案和发布输入。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；若 Open VSX 已验证完成，确认远端 `publish/v0.27.0` 已删除。
2. 打开 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 `files.*` metadata 均已同步到本轮版本；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 明确标记为 deferred，而不是已可用。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.27.0.vsix`、`dev-session-canvas-notifier-0.27.0.vsix` 与 `release-manifest-0.27.0.json` 都存在于 Assets 中。
4. 下载 release manifest、原 acceptance 与关联状态证据，复核最终 SHA、双包摘要、实际 producer、必需渠道的内容验真和 tag 清理结果；manifest 的状态链须连通，不能只凭版本可见或历史 verified 宣称本轮完成。
5. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。Visual Studio Marketplace 恢复后再补做该路径的干净 profile 安装 / 升级验证。
6. 定向复核 `0.27.0` 用户可见主路径：同 root 多窗口共享与模式切换、删除处理中锁定、失联节点移除与停止未确认警告、Unix socket 入口修复；同时确认既有会话重新附着、resize、终态与 journal 主路径未回归。
7. 复核生产服务状态时使用 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 证据；不要把插件 `v0.27.0` tag 当成服务当前运行版本。
8. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
9. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界、模板市场 Preview、GitHub OAuth、生产空目录和 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺、真实模板预置承诺或 marketplace 可用性承诺。
