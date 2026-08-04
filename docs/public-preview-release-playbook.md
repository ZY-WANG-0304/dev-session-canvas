# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、发布前复核、安装/升级说明、验证记录、发布命令与回退口径；当前发布准备目标为 `0.24.5`，上一已发布版本为 `0.24.4`。本轮范围是“将已死亡 PTY 的恢复收口为有界 metadata 与持久化屏幕快照、让 Agent Resume 保持显式、通过 VS Code 通知展示恢复进度，并隔离 checkpoint 被拒绝时健康 live stream 的完整 journal 刷新与终端输入”。它不是对外宣传页，而是 release-day 执行与复核手册。

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
- 当前更新依据：`docs/design-docs/runtime-supervisor-recovery-readiness.md`、`docs/design-docs/execution-lifecycle-and-recovery.md`、`docs/exec-plans/completed/runtime-supervisor-dead-pty-bounded-recovery.md`、`docs/exec-plans/completed/terminal-checkpoint-input-responsiveness.md`、`docs/product-specs/runtime-persistence-modes.md`、`docs/UI.md`、`docs/FRONTEND.md`
- 模板市场产品与设计依据：`docs/product-specs/template-marketplace.md`、`docs/design-docs/template-marketplace.md`、`docs/workflows/SERVICE_DEPLOY.md`

## Marketplace listing 定稿口径

当前 listing 统一使用主扩展子包内英文默认版 `extensions/vscode/dev-session-canvas/README.marketplace.md`，不直接复用仓库根目录 `README.md`。`extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md` 仅作为仓库内中文对应版本保留，不改变默认 Marketplace 打包入口。

当前 `npm run package:vsix` 会 staging 主扩展子包，并在打包阶段显式传入 `--readme-path README.marketplace.md`，因此最终用于发布的 VSIX 已内嵌 Marketplace 专用 README；后续 `publish --packagePath` 只上传现成 VSIX，不会再替换 README。打包脚本默认会把 README 相对资源改写到当前 `HEAD` 对应的 git ref；如果在没有 `.git` 元数据的 clean checkout、导出目录或 tarball 中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，否则不允许继续打包。

本轮 listing 必须明确：`0.24.5` 是 `0.24.x` Preview 线内的修复更新，不是稳定版承诺；若 Host / Supervisor 重启时旧 PTY 已死亡，启动期只读取有界 journal metadata，最后持久化的 terminal screen 作为历史显示，Agent 只有在具备可信 provider session identity 且用户点击 `Resume` 后才启动新的 provider resume 进程。该显示屏幕必须和自身的 output sequence 成对保留，不能拿较新的 journal revision 覆盖它。恢复进度通过不可取消的 VS Code 通知展示，不阻塞新会话。Codex 风格的 OSC 10/11 颜色查询不再污染 checkpoint 资格，但真正颜色副作用和未知事件仍 fail-closed；健康 live stream 不再周期性请求完整 journal projection，节点内输入保持 FIFO、单一在途 write。完整历史浏览、固定磁盘上限、跨版本回退、物理重启 / 长时间 Remote SSH 断开验证、90,000 行短读与 VSM 可见性均不得误写为已完成承诺；模板市场仍是 `Preview` 能力，生产服务部署版本与插件 SemVer 分离。

## release notes 定稿口径

当前 `0.24.5` 的 release notes 统一以 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。`v0.24.4` 之后的合并说明与协作过程不包装成用户功能。

发布前应确认以下内容在 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 中保持一致：

- 顶部版本标题为 `0.24.5 - Bounded Recovery and Responsive Terminal Input`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：死亡 PTY 只读取有界 metadata、持久化 terminal screen 与 output sequence 原子配对、Agent `resume-ready` 与显式 `Resume`、Terminal 历史快照、VS Code 恢复进度通知、OSC 10/11 query 的 checkpoint 资格、健康 live stream 跳过周期完整 projection、节点内 FIFO / 单一在途输入，以及主扩展 / notifier 版本对齐
- 已知边界必须保留 Host 级故障模型不等于真实物理重启或长时间 Remote SSH 断开、旧 PTY 不提供跨重启存活保证、完整 Journal 尚无完成的分页浏览、unsafe / oversized journal 仍可增长、90,000 行短读、Fork、媒体 opener、resize 与 VSM deferred；不得用定向通过样本覆盖残余风险
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 runtime persistence、local PTY、安全 compact、固定磁盘上限、跨版本回退、生成节点永久无重叠、模板市场、生产服务或 Visual Studio Marketplace 可见性误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前发布准备目标为 `0.24.5`，上一已发布版本为 `0.24.4`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.24.4` 升级到 `0.24.5` 的目标仍是通过当前宿主配置的公开扩展市场常规安装 / 升级完成。Open VSX 侧应继续同版本公开发布；官方 VS Code 的 `Visual Studio Marketplace` 仍是目标主路径，但当前 public gallery 仍不可见时允许延期补发，不阻塞本轮 `0.24.5` 以 GitHub Release assets + Open VSX verified 完成。对外宣称 VSM 安装路径前仍必须先完成 release-day visibility check，确认主扩展与 notifier 均公开可见。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. UI 语言跟随 VS Code locale；本版本不新增扩展自己的语言设置，也不会翻译用户内容、路径、终端输出、provider 原始输出或市场模板数据。
5. 停止后的 Agent 通过 `Resume / 恢复` 继续 provider 原会话，`New / 新建` 才启动新会话；Terminal 的 `Restart / 重启` 继续启动新的 shell 进程。当前 Agent 恢复 / 分叉仍只继承节点自身最近一次实际启动命令或长期启动偏好，不合并当前 Default args。
6. 若升级后 Supervisor 正在恢复旧 journal，它会通过 VS Code 不可取消进度通知报告已完成与剩余会话数，新会话不等待旧历史恢复。不同 generation 不迁移 PTY 所有权；已结束 PTY 只保留最后持久化的有界 screen snapshot，Agent 仅在可信 provider session identity 存在时进入 `resume-ready`，只有用户点击 `Resume` 才启动新 provider resume 进程。
7. runtime persistence 的跨 Host 恢复只在 `devSessionCanvas.runtimePersistence.enabled` 与后端能力成立时生效；合格 checkpoint 可通过 current / previous generation 安全 compact，不合格时保留完整 journal。健康 live stream 不会周期性复制完整 projection，但新投影 attach 或已检测到 stream gap 仍取回权威恢复内容。local PTY 不获得跨 Host 生命周期承诺，journal 也不承诺固定磁盘上限、完整长期 retention 策略、已完成的完整历史浏览或跨版本回退兼容。
8. `devSessionCanvas.canvas.forkPlacementDirection` 默认 `up`，也可设为 `down` 或 `right`；设置热生效于后续当前节点 Fork，不重排既有节点 / 连线，历史会话 Fork 继续使用通用邻近避碰。
9. 模板市场生产入口默认为 `https://dscanvas.dev/templates`；生产环境不会把代码内 seed 模板暴露为正式内容，初始空目录属于当前受控状态，不代表扩展安装失败。
10. 若用户此前显式配置过 `devSessionCanvas.runtimePersistence.enabled`、`devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled`、`devSessionCanvas.canvas.multiRootPresentationMode` 或 `devSessionCanvas.canvas.forkPlacementDirection`，升级到 `0.24.5` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时继续使用默认 allow-list，未配置 `multiRootPresentationMode` 时继续使用默认 `rootGroups`。
11. 当前仍为 `Preview`，不承诺跨版本 workspace / runtime journal 状态完全兼容；若涉及关键工作区，建议升级前先停止重要会话、备份画布状态，并在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.24.5` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.24.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，先停止重要运行会话，再重新安装目标版本并重新验证工作区状态；当前不承诺 `Preview` 版本或 Supervisor journal 之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.24.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 模板市场服务-only 问题优先走 `docs/workflows/SERVICE_DEPLOY.md` 的服务 deploy tag / rollback，不自动提升或回滚插件 SemVer；插件包问题才走插件发布流程。
4. 无论选择 hotfix、服务 rollback 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.24.5` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天需要补充恢复行为证据，可按下列优先级追加：

1. 旧 PTY 已结束时，旧 Terminal 保留最后持久化 screen、Agent 显示 `Resume` 且在点击前没有 provider 进程的对照
2. VS Code 的恢复进度通知与新 Agent / Terminal 可创建的对照
3. Codex 风格 OSC 10/11 query 后 checkpoint 前进、实际颜色修改仍被保守拒绝的诊断对照
4. checkpoint 被拒绝的健康 live stream 下快速输入保持顺序、单一在途 write 的对照

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
7. 确认发布 workflow 会先把同一批 VSIX 镜像到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许 deferred，不阻塞 `0.24.5` 完成。仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与按完成门禁删除临时 tag。
8. 复核 `OVSX_PAT`、`VSCE_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前完成门禁要求 Open VSX 可发布验证。`VSCE_PAT` 仍用于尝试 Visual Studio Marketplace 发布 / 验证，但 VSM 不可见时可记录为 deferred channel。GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：当前优先使用已验证的 Open VSX 或 `vX.Y.Z` 对应 GitHub Release Assets；Visual Studio Marketplace 只有在 public gallery 恢复且主扩展 / notifier 均可见后才作为已可用路径宣称。
10. 确认生产模板市场事实没有被写成插件发布事实：服务当前线上版本应结合 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 判断；插件发布 tag 不自动部署生产服务。

## 当前验证备注

截至 `2026-07-29`，上一轮 `0.24.4` 已从最终 `main` release ref `83f88a7cfde3f9ab5a145323b86eadf13aed74de` 完成 GitHub Release assets + Open VSX 兜底发布；正式 `v0.24.4` 指向同一 ref，远端 `publish/v0.24.4` 已删除。GitHub Release 已上传主扩展、notifier 和 manifest 三个 assets；最终 Release notes 记录 Open VSX 双扩展 `verified`，Visual Studio Marketplace 双扩展 `publish-failed` / deferred。因此不得对外宣称 VSM 已可用。

`0.24.5` 的发布输入严格限于 `v0.24.4` 之后已合入 `main` 的 #276 已死亡 PTY 有界恢复与显式 Resume、#277 恢复进度 VS Code 通知，以及 #278 checkpoint 拒绝下的输入隔离与重放。它符合 `docs/workflows/VERSION.md` 的同里程碑 bugfix 规则：本轮修复既有恢复和输入响应行为，不改变扩展身份、provider 命令契约、journal 格式、通知协议、服务 API 主版本或稳定支持承诺。

本发布准备分支已完成以下 repo-local 同步：

- 版本号同步：`package.json`、主扩展 manifest、notifier manifest 与 `package-lock.json` 的 workspace package entries 均为 `0.24.5`
- release notes 同步：主扩展与 notifier changelog 新增 `0.24.5` 顶部条目，说明有界 dead-PTY recovery、显式 Resume、恢复通知、checkpoint 资格和输入 FIFO，且注明 companion 仅对齐版本
- Marketplace / README 文案同步：主扩展 Marketplace 中英文 listing 与仓库中英文 README 已更新为 `0.24.5` 发布准备口径，并保留物理重启 / 长断开、完整历史浏览、journal / 90,000 行短读、Fork、媒体 opener、resize 与 VSM deferred 边界
- 发布手册与设计结论同步：`docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 与 `docs/design-docs/public-marketplace-release-readiness.md` 已更新目标版本、发布输入、安装/升级、回退与 tag 命令
- 本分支已通过 `npm run test:extension-manifest`、`npm run test:publish-tag-release`、`npm run test:package-vsix-command`、`npm run test:package-vsix-file-list` 与 `git diff --check`；这些只证明 manifest / 发布脚本守卫和文本差异干净，不替代最终 release ref 上的打包、clean-checkout、smoke、dry-run 与渠道验证

当前仅可把上述文档和版本同步作为发布准备事实；候选 VSIX、README ref、checksum、clean-checkout、publish dry-run 和最终渠道状态必须在发布准备 MR 合入后的干净 `main` ref 上重新生成和验证，不能预先写成已完成。

残余风险基线：`0.24.4` 的最终 Release 将 Visual Studio Marketplace 记录为 deferred；本轮不能把该渠道写成已恢复。`0.24.5` 的 dead-PTY recovery 只在可重复 Host 级故障模型中验证，旧 local PTY 不承诺跨重启存活，真实物理重启与长时间 Remote SSH 断开仍不是已完成的验收。完整 Journal 的显式、分页、有容量预算查看尚未实现；unsafe / oversized journal 增长、无固定磁盘上限、local PTY 非跨 Host、90,000 行间歇性短读、Fork 视觉验收、自动 File footprint 精度、媒体 opener 和 resize 的既有边界也均未关闭。最终验证必须如实区分定向测试、真实 Host smoke、packaged-payload smoke 与未执行门禁。

### 0.24.4 发布后复核

截至 `2026-07-29`，[GitHub Release v0.24.4](https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.24.4) 已发布，且不是 draft 或 prerelease。它使用 release ref `83f88a7cfde3f9ab5a145323b86eadf13aed74de`，Release assets 为主扩展 `dev-session-canvas-0.24.4.vsix`（`3,934,204 bytes`，`sha256=da16f50f2044e6eecbd99ac7efd83fa77d43abf58d482602bcc6b90e51de56fd`）、notifier `dev-session-canvas-notifier-0.24.4.vsix`（`159,481 bytes`，`sha256=7e5a6d82cfbbe1eaa05ed5f39465cf1a73a8b32ed0da87d56774780513199222`）和 `release-manifest-0.24.4.json`（`3,104 bytes`）。Release notes 记录 Open VSX 主扩展与 notifier 均为 `verified`，Visual Studio Marketplace 双扩展均为 `publish-failed` / deferred；该渠道状态是 `0.24.5` 的起始事实，而不是本轮已恢复的能力。

### 0.24.3 发布后复核

截至 `2026-07-17`，[GitHub Release v0.24.3](https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.24.3) 已从 release ref `478587ab0c40b13edb9f0a731cd524b910eda354` 发布，且不是 draft 或 prerelease。Release assets 为主扩展 `dev-session-canvas-0.24.3.vsix`（`3,929,120 bytes`）、notifier `dev-session-canvas-notifier-0.24.3.vsix`（`159,098 bytes`）和 `release-manifest-0.24.3.json`（`3,104 bytes`）。Release notes 记录 Open VSX 主扩展与 notifier 均为 `verified`，Visual Studio Marketplace 双扩展均为 `publish-failed` / deferred；该渠道状态是 `0.24.4` 的起始事实，而不是本轮已恢复的能力。

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

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.24.5
    git push origin publish/v0.24.5

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.24.5 <final-ref-or-sha>
    git push origin publish/v0.24.5

推送 `publish/v0.24.5` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，先执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.24.5 --package-only

该 workflow 只响应 `publish/v*` tag push 与手动 `workflow_dispatch`；创建普通分支、普通 tag 或 release 分支不应再生成 skipped publish run。若 Actions 列表出现非 `publish/v*` 引起的 `Publish Marketplace Release` run，应先修正 workflow 触发条件，不要把 skipped run 当作真实发布动作。

随后 workflow 会创建或确认正式 `v0.24.5` tag 指向同一 release ref，创建或更新 `v0.24.5` 对应的 GitHub Release，并上传以下 Release assets：

    release-artifacts/release-manifest-0.24.5.json
    dev-session-canvas-0.24.5.vsix
    extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.24.5.vsix

Release assets 上传后，workflow 会继续复用同一批 manifest / VSIX 分别执行 Open VSX 与 Visual Studio Marketplace 发布、验证。如果同一 `publish/v0.24.5` 因任一 marketplace 失败而重跑，workflow 会先下载并校验 `v0.24.5` GitHub Release 中已有的 manifest / VSIX assets，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

    npm run release:publish-tag -- --trigger-tag publish/v0.24.5 --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/v0.24.5 --skip-package --target visual-studio --no-create-final-tag

两个 marketplace 不再互相串行阻断：Open VSX 失败不阻止 Visual Studio Marketplace 尝试发布，Visual Studio Marketplace 失败也不阻止 Open VSX 尝试发布。workflow 会在两个目标都跑完后上传最终 manifest，并用当前 manifest 重新生成 GitHub Release notes；Release notes 必须包含本版本亮点、渠道状态、残余风险和发布证据。本轮 `0.24.5` 的完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 若仍不可见，则以 deferred channel 写入 manifest / notes，不阻塞删除远端和本地 `publish/v0.24.5`。如果 Open VSX 发布或验证失败，GitHub Release assets 和更新后的 Release notes 会保留为手动安装兜底，失败的 Open VSX job 会在上传自身结果 manifest 后标红，finalize job 也会在收口 Release 状态后标红，临时 tag 保留，便于修复 token / 渠道问题后使用 GitHub Actions 的 Re-run failed jobs 或 workflow_dispatch 重跑同一 release input；重跑必须复用这批既有 assets 并通过 manifest sha256 校验。

本地人工执行同一路径时，也应使用同一入口；发布前可先 dry-run，预览 release ref、VSIX 计划和 manifest：

    npm run release:publish-tag -- --trigger-tag publish/v0.24.5 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、主扩展 `CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.24.5` 指向的 commit。当前 workflow 在首次创建 Release assets 时会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.24.5.json` 并上传 GitHub Release assets；同一版本重跑时会下载并校验既有 Release assets。随后两种路径都会用 `--skip-package` 复用同一批 VSIX，分别发布并验证 Open VSX 与 Visual Studio Marketplace；脚本会保留既有 manifest 中已 verified 的渠道状态，避免已经完成的渠道被未完成渠道重跑覆盖。当前完成门禁只要求 Open VSX verified，Visual Studio Marketplace 可延期补发。

release manifest 不提交回代码库。它记录发布后事实，包括 release ref、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态，应作为 GitHub Release asset 保存；workflow 同时保留一份 Actions artifact 便于排障。GitHub Release notes 由主扩展 `CHANGELOG.md` 和当前 manifest 生成，必须在初次上传 assets 时和最终 manifest 上传时都同步更新，避免 Release 页面只有泛化模板而没有版本亮点和残余风险。

若 GitHub Actions 中 Open VSX 失败，或后续需要补发 / 重跑 Visual Studio Marketplace，必须复用同一 release ref 的 manifest / VSIX，并显式走 marketplace 补发命令；不要重新执行 package 覆盖 GitHub Release VSIX assets，因为同一 checkout 的 VSIX 打包当前不保证 byte-for-byte 可复现：

    npm run release:publish-tag -- --trigger-tag publish/v0.24.5 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.24.5 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.24.5.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.24.5`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。若对应 GitHub Release 已经存在完整 assets，重跑会复用并校验这些 assets；若 Release assets 不完整，先人工修复或删除不完整状态，不要用重新打包覆盖来恢复。

`vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag。为了让 Release assets 在 marketplace 暂时不可用时仍能先提供手动安装兜底，workflow 会在打包后、marketplace 发布验证前创建或确认该 tag。单看 `vX.Y.Z` 存在不再足以判断整轮发布完成；`0.24.5` 当前完成条件是 GitHub Release assets 已上传、Open VSX 已发布并验证、Visual Studio Marketplace 已记录为 verified 或 deferred、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除。如果 Open VSX 发布或验证失败，`vX.Y.Z` 与 Release assets 可能已经存在，但 workflow 会失败并保留临时 tag。需要人工删除临时 tag 时，应先确认两个 tag 指向同一 commit、Release assets 已存在，且 Open VSX 发布验证已经完成：

    git push origin :refs/tags/publish/v0.24.5
    git tag -d publish/v0.24.5

不要在 GitHub Release assets 上传未完成、正式 `vX.Y.Z` 尚未指向同一 release ref、Open VSX 发布验证尚未成功，或还需要依赖临时 tag 重跑时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；若 Open VSX 已验证完成，确认远端 `publish/v0.24.5` 已删除。
2. 打开 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 `files.*` metadata 均已同步到本轮版本；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 明确标记为 deferred，而不是已可用。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.24.5.vsix`、`dev-session-canvas-notifier-0.24.5.vsix` 与 `release-manifest-0.24.5.json` 都存在于 Assets 中。
4. 下载 release manifest，复核其中 `releaseRef`、两个 VSIX 的 `sha256`、`readmeDocRef`、`githubRelease.status`、marketplace `verified` 状态和 `tags.triggerTagStatus` 与实际发布事实一致。
5. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。Visual Studio Marketplace 恢复后再补做该路径的干净 profile 安装 / 升级验证。
6. 定向复核 `0.24.5` 用户可见主路径：已结束 PTY 的 Terminal 保留最后持久化 screen，具备可信 provider session identity 的 Agent 显示 `Resume` 且在点击前不启动 provider 进程；恢复通知不阻塞新 Agent / Terminal；OSC 10/11 query 可推进安全 checkpoint，健康 live stream 下快速输入保持严格顺序。与此同时确认 `0.24.4` 的恢复 transport 错误归因与 `0.24.3` 的媒体链接、resize、journal compact、Fork 定向落位与终态门禁主路径未回归。
7. 复核生产服务状态时使用 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 证据；不要把插件 `v0.24.5` tag 当成服务当前运行版本。
8. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
9. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界、模板市场 Preview、GitHub OAuth、生产空目录和 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺、真实模板预置承诺或 marketplace 可用性承诺。
