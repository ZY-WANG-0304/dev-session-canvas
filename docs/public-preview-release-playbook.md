# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、发布前复核、安装/升级说明、验证记录、发布命令与回退口径；当前目标版本为 `0.24.0`。当前版本范围收口为“相对已发布 `0.23.0` 的新里程碑更新：`Agent` / `Terminal` 无损输入输出与 Supervisor 权威恢复、停止后 Agent 的 `Resume / 恢复` 语义，以及 multi-root 画板按分组 / root / workspace 清空边界”。它不是对外宣传页，而是发布当天的执行与复核手册。

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
- 当前更新依据：`docs/design-docs/agent-terminal-lossless-io-and-recovery.md`、`docs/design-docs/execution-lifecycle-and-recovery.md`、`docs/design-docs/canvas-multi-root-workspace-support.md`、`docs/design-docs/agent-launch-modes-and-restart.md`、`docs/product-specs/runtime-persistence-modes.md`、`docs/product-specs/canvas-multi-root-workspace-support.md`、`docs/UI.md`、`docs/FRONTEND.md`
- 模板市场产品与设计依据：`docs/product-specs/template-marketplace.md`、`docs/design-docs/template-marketplace.md`、`docs/workflows/SERVICE_DEPLOY.md`

## Marketplace listing 定稿口径

当前 listing 统一使用主扩展子包内英文默认版 `extensions/vscode/dev-session-canvas/README.marketplace.md`，不直接复用仓库根目录 `README.md`。`extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md` 仅作为仓库内中文对应版本保留，不改变默认 Marketplace 打包入口。

当前 `npm run package:vsix` 会 staging 主扩展子包，并在打包阶段显式传入 `--readme-path README.marketplace.md`，因此最终用于发布的 VSIX 已内嵌 Marketplace 专用 README；后续 `publish --packagePath` 只上传现成 VSIX，不会再替换 README。打包脚本默认会把 README 相对资源改写到当前 `HEAD` 对应的 git ref；如果在没有 `.git` 元数据的 clean checkout、导出目录或 tarball 中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，否则不允许继续打包。

本轮 listing 必须明确：`0.24.0` 是新的公开 `Preview` 里程碑，不是稳定版承诺；无损保证指不同 authority revision / local output sequence 不被 snapshot replacement、增量丢弃或文本去重吞掉，当前输入节点优先但后台节点仍有界公平推进；跨 Host 恢复只对开启 runtime persistence 且由当前 Supervisor 托管的 session 成立，local PTY 不因此获得跨 Host 生命周期保证；旧 Supervisor session 在迁移期间只读保留；清空画板是破坏性操作，必须准确描述当前分组 / 当前 root / 整个 workspace 的作用域与确认边界；停止后 Agent 使用 `Resume / 恢复`，Terminal 仍使用 `Restart / 重启`；模板市场仍是 `Preview` 能力，生产服务部署版本与插件 SemVer 分离。

## release notes 定稿口径

当前 `0.24.0` 的 release notes 统一以 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。行为保持的 `main.tsx` 模块拆分只作为维护性背景，不包装成用户功能。

发布前应确认以下内容在 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 中保持一致：

- 顶部版本标题为 `0.24.0 - Lossless Execution Recovery and Scoped Canvas Reset Update`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：无损输出与当前输入优先 / 后台有界公平、Supervisor revision + checkpoint + checksum journal 恢复权威、原子 attach/live 切点、终态 durable handoff、旧 Supervisor legacy-read-only 迁移、Agent `Resume / 恢复`、multi-root 分范围清空，以及主扩展 / notifier 版本对齐
- 已知边界必须保留 90000 行 completed terminal 尾部短读已间歇性出现两次、具体根因尚未定位、两次直接 packaged smoke 失败后隔离 clean-checkout 一次通过，以及完整 Webview suite 未清洁通过的完整事实；不得用单个通过样本、定向测试或标准 smoke 覆盖残余风险
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 runtime persistence、local PTY、journal retention / compact、跨版本回退、模板市场、生产服务或 Visual Studio Marketplace 可见性误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.24.0`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.23.0` 升级到 `0.24.0` 的目标仍是通过当前宿主配置的公开扩展市场常规安装 / 升级完成。Open VSX 侧应继续同版本公开发布；官方 VS Code 的 `Visual Studio Marketplace` 仍是目标主路径，但当前 public gallery 仍不可见时允许延期补发，不阻塞本轮 `0.24.0` 以 GitHub Release assets + Open VSX verified 完成。对外宣称 VSM 安装路径前仍必须先完成 release-day visibility check，确认主扩展与 notifier 均公开可见。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. UI 语言跟随 VS Code locale；本版本不新增扩展自己的语言设置，也不会翻译用户内容、路径、终端输出、provider 原始输出或市场模板数据。
5. 停止后的 Agent 通过 `Resume / 恢复` 继续 provider 原会话，`New / 新建` 才启动新会话；Terminal 的 `Restart / 重启` 继续启动新的 shell 进程。当前 Agent 恢复 / 分叉仍只继承节点自身最近一次实际启动命令或长期启动偏好，不合并当前 Default args。
6. 若升级时仍有旧版 Supervisor 托管的运行会话，建议先让重要任务完成或停止后再升级并 Reload Window。旧 session 会进入只读迁移状态，只保留查看、停止和删除；最后一个旧 session 结束后由当前 Supervisor 接管。
7. runtime persistence 的跨 Host 恢复只在 `devSessionCanvas.runtimePersistence.enabled` 与后端能力成立时生效；local PTY 不获得跨 Host 生命周期承诺，journal 当前也不承诺长期 retention / compact 或跨版本回退兼容。
8. 模板市场生产入口默认为 `https://dscanvas.dev/templates`；生产环境不会把代码内 seed 模板暴露为正式内容，初始空目录属于当前受控状态，不代表扩展安装失败。
9. 若用户此前显式配置过 `devSessionCanvas.runtimePersistence.enabled`、`devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 或 `devSessionCanvas.canvas.multiRootPresentationMode`，升级到 `0.24.0` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时继续使用默认 allow-list，未配置 `multiRootPresentationMode` 时继续使用默认 `rootGroups`。
10. 当前仍为 `Preview`，不承诺跨版本 workspace / runtime journal 状态完全兼容；若涉及关键工作区，建议升级前先停止重要会话、备份画布状态，并在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.24.0` 对当前工作流形成 blocker，当前统一建议是：

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

当前 `0.24.0` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. multi-root 下当前分组 / 当前 root / 整个 workspace 的清空菜单与确认文案
2. Reload Window 或 Host 离线完成后完整恢复执行内容的前后对照
3. 停止后 Agent 的 `New | Resume` 与 Terminal 的 `Restart` 动作区分
4. 插件内模板市场列表和详情页，展示安装 / 更新 / 版本菜单

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
7. 确认发布 workflow 会先把同一批 VSIX 镜像到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许 deferred，不阻塞 `0.24.0` 完成。仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与按完成门禁删除临时 tag。
8. 复核 `OVSX_PAT`、`VSCE_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前完成门禁要求 Open VSX 可发布验证。`VSCE_PAT` 仍用于尝试 Visual Studio Marketplace 发布 / 验证，但 VSM 不可见时可记录为 deferred channel。GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：当前优先使用已验证的 Open VSX 或 `vX.Y.Z` 对应 GitHub Release Assets；Visual Studio Marketplace 只有在 public gallery 恢复且主扩展 / notifier 均可见后才作为已可用路径宣称。
10. 确认生产模板市场事实没有被写成插件发布事实：服务当前线上版本应结合 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 判断；插件发布 tag 不自动部署生产服务。

## 当前验证备注

截至 `2026-07-12`，上一轮 `0.23.0` 已从最终 `main` release ref `c458156943a6576f532734c8a81ace851e8b4b5c` 完成 GitHub Release assets + Open VSX 兜底发布；正式 `v0.23.0` tag 指向同一 ref，远端 `publish/v0.23.0` 临时 tag 已由 workflow 删除。GitHub Release `v0.23.0` 位于 `https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.23.0`，包含主扩展 VSIX、notifier VSIX 与 `release-manifest-0.23.0.json`。最终 manifest 状态为 `complete-with-deferred-visual-studio`，Open VSX 主扩展与 notifier `0.23.0` 均 verified，Visual Studio Marketplace 主扩展与 notifier 均为 `publish-failed` / deferred。2026-07-12 复核时 GitHub Release latest 与 Open VSX 双扩展 latest 均为 `0.23.0`，VSM public gallery 对两个 extension id 仍为 `count=0` / `TotalCount=0`，因此不得对外宣称 VSM 已可用。

`0.24.0` 当前发布准备输入只来自 `v0.23.0` 之后已合入 `origin/main` 的 #252 multi-root 清空画板作用域、#253 Webview `main.tsx` 行为保持模块拆分、#254 Agent `Resume / 恢复` 语义，以及 #255 `Agent` / `Terminal` 无损输入输出与恢复链路重构。本轮用户可见 release notes 聚焦 #252、#254 和 #255；#253 只作为可维护性与回归风险背景记录。本发布准备分支只处理版本号、CHANGELOG、Marketplace / README 文案、发布手册和发布验证，不把未合并的功能分支 head 直接当作发布输入。最终 release ref 以发布准备 MR 合入 `main` 后的 commit 为准。

本轮发布准备分支已完成以下 repo-local 同步：

- 版本号同步：`package.json`、主扩展 manifest、notifier manifest、`package-lock.json` 根版本、主扩展 package entry 与 notifier package entry 均更新为 `0.24.0`
- release notes 同步：主扩展与 notifier changelog 已新增 `0.24.0` 顶部条目，明确主扩展发布范围与 notifier 本轮仅对齐版本、不改变通知行为
- Marketplace / README 文案同步：主扩展 Marketplace 中英文 listing 与仓库中英文 README 已更新为 `0.24.0` 发布准备口径，并保留 runtime / journal / legacy migration / VSM deferred 边界
- 发布手册同步：`docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 与 `docs/design-docs/public-marketplace-release-readiness.md` 更新目标版本、发布输入、安装/升级、回退与 tag 命令

本轮发布准备分支已完成以下 repo-local 验证：

- 版本与发布守卫已通过：`0.24.0` 版本 / 文本一致性检查、`test:extension-manifest`、`test:package-vsix-file-list`、`test:publish-tag-release`、`test:publish-marketplaces` 与 `test:publish-marketplace-workflow`
- 主扩展与 notifier 的 production build、typecheck 均通过；runtime supervisor、terminal journal、execution session bridge、output scheduler / sequence、serialized state tracker、Webview lifecycle / protocol、multi-root composition、UI copy、canvas execution context、Agent presets、layout、notifier source 和生产部署 workflow / config 等定向回归均通过
- Resume / Restart / Ctrl-Z 的 Webview 定向回归为 `8 passed`；checkpoint / journal / revision / Unicode / 4000 events 的定向回归为 `12 passed`
- `npm run benchmark:agent-terminal-io` 通过：`864,020` 字符完整核对，input ACK `29.3 ms`，priority echo `201 ms`，最慢后台完成约 `25.2 s`
- `npm run test:smoke` 完整通过，覆盖 trusted / restricted workspace、旧 Supervisor 升级、真实窗口重开、multi-root、single-to-multi-root、双窗口共享 runtime、systemd-user / fallback 与 Remote SSH real reopen
- `npm run test:notifier-smoke` 与 `npm run test:notifier-locale-smoke` 通过，后者覆盖英文和简体中文真实 VS Code 宿主；`npm audit --omit=dev` 返回 `found 0 vulnerabilities`
- 主扩展 VSIX 为 `dev-session-canvas-0.24.0.vsix`（`117` files，`3.73 MB` / `3,908,819 bytes`，当前工作树产物 `sha256=41003900bf5a6ac80f578d4c2d07345dd9d0f03fbad717353aec2986f55259da`）；notifier VSIX 为 `dev-session-canvas-notifier-0.24.0.vsix`（`14` files，`155.08 KB` / `158,806 bytes`，`sha256=876ea4294babb8159aa6da3dde4dfe9faa663afeba4a442257199d6be078c551`）
- 两个 dirty-working-tree 打包日志均打印 `VSCE README doc ref: f6bbd3041d57bc654b70810577406120a8909d09`；`npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke` 也在排除 `.git`、`node_modules` 与 `.debug` 的隔离快照中通过 `npm ci`、0-vulnerability audit、README ref 校验与 `117` files / `3.73 MB` 主扩展打包，并按命令参数明确跳过重复 VSIX smoke
- 最终文案同步后，`npm run validate:clean-checkout:vsix -- --source working-tree` 不带 skip 完整通过：隔离快照再次完成 `npm ci`、0-vulnerability audit、README ref 校验与 `117`-file 主扩展打包，并在真实 VS Code `1.128.0` packaged host 中以 code `0` 结束，输出 `VSIX packaged-payload smoke passed`

直接在当前工作树运行的 `npm run test:vsix-smoke` 前两次没有清洁通过。第一次运行完成打包与 payload 内容守卫后，在严格 `90000` 行 completed terminal 场景中只观察到 `DSC_COMPLETED_STREAM_89960`，缺少最后 `40` 行并在 `verifyCompletedLiveRuntimeRetainsOversizedTerminalStream` 超时；按技术债处置规则原样完整复跑后，第二次在更早的 `verifyExplorerResourceExecutionNodeCreation` 中因 Terminal 持续停留在 `stopping` 而超时。两次都由测试宿主以 code `1` 退出。随后不带 skip 的隔离 clean-checkout 对同一最终 working-tree 内容获得一次完整 code `0` packaged-payload 结果，严格断言、行数与 timeout 全程未放宽。该通过样本满足分支内 packaged 工件验证，但与前两次失败共同证明 90000 行尾部风险具有间歇性，不能据此撤销技术债或把极端 completed stream 升级为已验证保证。

以上分支内验证只能证明当前 working tree 的 repo-local 状态，不能替代发布准备 MR 合入后的最终 `main` release ref 验证。最终 tag / publish 前必须在 clean `main` ref 上重跑双 VSIX 打包、clean-checkout、packaged-payload smoke 与 `publish/v0.24.0` dry-run；当前可记录为发布准备分支已获得一次隔离 packaged-payload 清洁结果，但仍不能提前把最终 release ref 的发布门禁记为已通过。

残余风险基线：Visual Studio Marketplace public gallery 当前仍不可见；Supervisor journal 尚无长期 retention / compact 与跨版本回退保证；local PTY 不具备跨 Host 恢复；旧 Supervisor session 升级期间只读；#255 记录的 90000 行 PTY 偶发短读尚未形成稳定根因；完整 Webview suite 在当前主线仍受陈旧截图与统一 timeout 干扰。最终验证必须如实区分通过的定向用例、完整 smoke 与未通过或未执行的全量门禁。

## 发布命令

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.24.0
    git push origin publish/v0.24.0

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.24.0 <final-ref-or-sha>
    git push origin publish/v0.24.0

推送 `publish/v0.24.0` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，先执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.24.0 --package-only

该 workflow 只响应 `publish/v*` tag push 与手动 `workflow_dispatch`；创建普通分支、普通 tag 或 release 分支不应再生成 skipped publish run。若 Actions 列表出现非 `publish/v*` 引起的 `Publish Marketplace Release` run，应先修正 workflow 触发条件，不要把 skipped run 当作真实发布动作。

随后 workflow 会创建或确认正式 `v0.24.0` tag 指向同一 release ref，创建或更新 `v0.24.0` 对应的 GitHub Release，并上传以下 Release assets：

    release-artifacts/release-manifest-0.24.0.json
    dev-session-canvas-0.24.0.vsix
    extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.24.0.vsix

Release assets 上传后，workflow 会继续复用同一批 manifest / VSIX 分别执行 Open VSX 与 Visual Studio Marketplace 发布、验证。如果同一 `publish/v0.24.0` 因任一 marketplace 失败而重跑，workflow 会先下载并校验 `v0.24.0` GitHub Release 中已有的 manifest / VSIX assets，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

    npm run release:publish-tag -- --trigger-tag publish/v0.24.0 --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/v0.24.0 --skip-package --target visual-studio --no-create-final-tag

两个 marketplace 不再互相串行阻断：Open VSX 失败不阻止 Visual Studio Marketplace 尝试发布，Visual Studio Marketplace 失败也不阻止 Open VSX 尝试发布。workflow 会在两个目标都跑完后上传最终 manifest，并用当前 manifest 重新生成 GitHub Release notes；Release notes 必须包含本版本亮点、渠道状态、残余风险和发布证据。本轮 `0.24.0` 的完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 若仍不可见，则以 deferred channel 写入 manifest / notes，不阻塞删除远端和本地 `publish/v0.24.0`。如果 Open VSX 发布或验证失败，GitHub Release assets 和更新后的 Release notes 会保留为手动安装兜底，失败的 Open VSX job 会在上传自身结果 manifest 后标红，finalize job 也会在收口 Release 状态后标红，临时 tag 保留，便于修复 token / 渠道问题后使用 GitHub Actions 的 Re-run failed jobs 或 workflow_dispatch 重跑同一 release input；重跑必须复用这批既有 assets 并通过 manifest sha256 校验。

本地人工执行同一路径时，也应使用同一入口；发布前可先 dry-run，预览 release ref、VSIX 计划和 manifest：

    npm run release:publish-tag -- --trigger-tag publish/v0.24.0 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、主扩展 `CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.24.0` 指向的 commit。当前 workflow 在首次创建 Release assets 时会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.24.0.json` 并上传 GitHub Release assets；同一版本重跑时会下载并校验既有 Release assets。随后两种路径都会用 `--skip-package` 复用同一批 VSIX，分别发布并验证 Open VSX 与 Visual Studio Marketplace；脚本会保留既有 manifest 中已 verified 的渠道状态，避免已经完成的渠道被未完成渠道重跑覆盖。当前完成门禁只要求 Open VSX verified，Visual Studio Marketplace 可延期补发。

release manifest 不提交回代码库。它记录发布后事实，包括 release ref、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态，应作为 GitHub Release asset 保存；workflow 同时保留一份 Actions artifact 便于排障。GitHub Release notes 由主扩展 `CHANGELOG.md` 和当前 manifest 生成，必须在初次上传 assets 时和最终 manifest 上传时都同步更新，避免 Release 页面只有泛化模板而没有版本亮点和残余风险。

若 GitHub Actions 中 Open VSX 失败，或后续需要补发 / 重跑 Visual Studio Marketplace，必须复用同一 release ref 的 manifest / VSIX，并显式走 marketplace 补发命令；不要重新执行 package 覆盖 GitHub Release VSIX assets，因为同一 checkout 的 VSIX 打包当前不保证 byte-for-byte 可复现：

    npm run release:publish-tag -- --trigger-tag publish/v0.24.0 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.24.0 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.24.0.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.24.0`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。若对应 GitHub Release 已经存在完整 assets，重跑会复用并校验这些 assets；若 Release assets 不完整，先人工修复或删除不完整状态，不要用重新打包覆盖来恢复。

`vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag。为了让 Release assets 在 marketplace 暂时不可用时仍能先提供手动安装兜底，workflow 会在打包后、marketplace 发布验证前创建或确认该 tag。单看 `vX.Y.Z` 存在不再足以判断整轮发布完成；`0.24.0` 当前完成条件是 GitHub Release assets 已上传、Open VSX 已发布并验证、Visual Studio Marketplace 已记录为 verified 或 deferred、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除。如果 Open VSX 发布或验证失败，`vX.Y.Z` 与 Release assets 可能已经存在，但 workflow 会失败并保留临时 tag。需要人工删除临时 tag 时，应先确认两个 tag 指向同一 commit、Release assets 已存在，且 Open VSX 发布验证已经完成：

    git push origin :refs/tags/publish/v0.24.0
    git tag -d publish/v0.24.0

不要在 GitHub Release assets 上传未完成、正式 `vX.Y.Z` 尚未指向同一 release ref、Open VSX 发布验证尚未成功，或还需要依赖临时 tag 重跑时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；若 Open VSX 已验证完成，确认远端 `publish/v0.24.0` 已删除。
2. 打开 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 `files.*` metadata 均已同步到本轮版本；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 明确标记为 deferred，而不是已可用。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.24.0.vsix`、`dev-session-canvas-notifier-0.24.0.vsix` 与 `release-manifest-0.24.0.json` 都存在于 Assets 中。
4. 下载 release manifest，复核其中 `releaseRef`、两个 VSIX 的 `sha256`、`readmeDocRef`、`githubRelease.status`、marketplace `verified` 状态和 `tags.triggerTagStatus` 与实际发布事实一致。
5. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。Visual Studio Marketplace 恢复后再补做该路径的干净 profile 安装 / 升级验证。
6. 定向复核 `0.24.0` 用户可见主路径：主扩展激活、当前输入节点高输出时后台节点仍完整推进、Reload Window / Host 离线完成后的 Supervisor session 内容恢复、停止后 Agent `Resume`、Terminal `Restart`，以及 multi-root 当前分组 / root / workspace 清空确认与结果。
7. 复核生产服务状态时使用 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 证据；不要把插件 `v0.24.0` tag 当成服务当前运行版本。
8. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
9. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界、模板市场 Preview、GitHub OAuth、生产空目录和 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺、真实模板预置承诺或 marketplace 可用性承诺。
