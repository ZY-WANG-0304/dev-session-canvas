# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、发布前复核、安装/升级说明、验证记录、发布命令与回退口径；当前发布准备目标为 `0.24.2`，上一已发布版本为 `0.24.1`。本轮范围是“相对 `0.24.1` 为 persistent Runtime Supervisor 增加保守安全的 journal compact 与双代恢复，收口跨 Node 终态门禁，并增加当前 Agent 节点 Fork 定向落位与生成节点创建时避碰”。它不是对外宣传页，而是 release-day 执行与复核手册。

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
- 当前更新依据：`docs/design-docs/agent-terminal-lossless-io-and-recovery.md`、`docs/design-docs/canvas-fork-placement-and-generated-node-collision.md`、`docs/design-docs/execution-lifecycle-and-recovery.md`、`docs/design-docs/agent-launch-modes-and-restart.md`、`docs/product-specs/runtime-persistence-modes.md`、`docs/product-specs/agent-launch-modes-and-restart.md`、`docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/UI.md`、`docs/FRONTEND.md`
- 模板市场产品与设计依据：`docs/product-specs/template-marketplace.md`、`docs/design-docs/template-marketplace.md`、`docs/workflows/SERVICE_DEPLOY.md`

## Marketplace listing 定稿口径

当前 listing 统一使用主扩展子包内英文默认版 `extensions/vscode/dev-session-canvas/README.marketplace.md`，不直接复用仓库根目录 `README.md`。`extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md` 仅作为仓库内中文对应版本保留，不改变默认 Marketplace 打包入口。

当前 `npm run package:vsix` 会 staging 主扩展子包，并在打包阶段显式传入 `--readme-path README.marketplace.md`，因此最终用于发布的 VSIX 已内嵌 Marketplace 专用 README；后续 `publish --packagePath` 只上传现成 VSIX，不会再替换 README。打包脚本默认会把 README 相对资源改写到当前 `HEAD` 对应的 git ref；如果在没有 `.git` 元数据的 clean checkout、导出目录或 tarball 中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，否则不允许继续打包。

本轮 listing 必须明确：`0.24.2` 是 `0.24.x` Preview 线内的持续迭代补丁，不是稳定版承诺；persistent journal 只在 checkpoint 资格可证明时 compact，并保留 current / previous / genesis 恢复路径，无法证明安全时继续保存完整 journal；Runtime Supervisor final-state 门禁不再依赖固定 3 秒等待，但 90000 行间歇性尾部短读仍是独立未关闭风险；当前 Agent 节点 Fork 支持向上 / 向下 / 向右固定层级落位，生成节点复用创建时避碰，但 panel / editor 人工视觉验收与自动 File 真实 footprint 精度仍保留边界；`0.24.1` 的 generation 并行排空、旧会话 output / input / resize / stop / delete 与非迁移权威边界保持不变；模板市场仍是 `Preview` 能力，生产服务部署版本与插件 SemVer 分离。

## release notes 定稿口径

当前 `0.24.2` 的 release notes 统一以 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。`v0.24.1` 之后的合并说明与协作过程不包装成用户功能。

发布前应确认以下内容在 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 中保持一致：

- 顶部版本标题为 `0.24.2 - Safe Journal Compaction and Directed Fork Placement Update`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：checkpoint eligibility、双代 generation 与恢复顺序、metadata-only registry / authority fail-closed、forced drain 单次 serialize 与事件驱动终态门禁、Fork 方向配置 / 固定层级 / 分组继承、生成节点 root-local 创建时避碰，以及主扩展 / notifier 版本对齐
- 已知边界必须保留 unsafe / oversized checkpoint 继续增长 journal、无固定磁盘上限与跨版本回退保证、90000 行 completed terminal 间歇性尾部短读未关闭、Fork 层间距与标签仍待人工视觉验收、自动 File 真实 footprint 仍可能超过估算，以及 journal smoke harness 的非内容性时序技术债；不得用定向通过样本覆盖残余风险
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 runtime persistence、local PTY、安全 compact、固定磁盘上限、跨版本回退、生成节点永久无重叠、模板市场、生产服务或 Visual Studio Marketplace 可见性误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前发布准备目标为 `0.24.2`，上一已发布版本为 `0.24.1`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.24.1` 升级到 `0.24.2` 的目标仍是通过当前宿主配置的公开扩展市场常规安装 / 升级完成。Open VSX 侧应继续同版本公开发布；官方 VS Code 的 `Visual Studio Marketplace` 仍是目标主路径，但当前 public gallery 仍不可见时允许延期补发，不阻塞本轮 `0.24.2` 以 GitHub Release assets + Open VSX verified 完成。对外宣称 VSM 安装路径前仍必须先完成 release-day visibility check，确认主扩展与 notifier 均公开可见。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. UI 语言跟随 VS Code locale；本版本不新增扩展自己的语言设置，也不会翻译用户内容、路径、终端输出、provider 原始输出或市场模板数据。
5. 停止后的 Agent 通过 `Resume / 恢复` 继续 provider 原会话，`New / 新建` 才启动新会话；Terminal 的 `Restart / 重启` 继续启动新的 shell 进程。当前 Agent 恢复 / 分叉仍只继承节点自身最近一次实际启动命令或长期启动偏好，不合并当前 Default args。
6. 若升级时仍有旧版 Supervisor 托管的运行会话，旧 session 继续由原 runtime 提供 output、input、resize、stop 与 delete；新会话立即进入当前 generation，不等待旧 runtime 排空。不同 generation 不迁移 PTY 所有权，旧终端画面异常时可拖动节点边缘触发真实 resize / redraw。
7. runtime persistence 的跨 Host 恢复只在 `devSessionCanvas.runtimePersistence.enabled` 与后端能力成立时生效；合格 checkpoint 可通过 current / previous generation 安全 compact，不合格时保留完整 journal。local PTY 不获得跨 Host 生命周期承诺，journal 也不承诺固定磁盘上限、完整长期 retention 策略或跨版本回退兼容。
8. `devSessionCanvas.canvas.forkPlacementDirection` 默认 `up`，也可设为 `down` 或 `right`；设置热生效于后续当前节点 Fork，不重排既有节点 / 连线，历史会话 Fork 继续使用通用邻近避碰。
9. 模板市场生产入口默认为 `https://dscanvas.dev/templates`；生产环境不会把代码内 seed 模板暴露为正式内容，初始空目录属于当前受控状态，不代表扩展安装失败。
10. 若用户此前显式配置过 `devSessionCanvas.runtimePersistence.enabled`、`devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled`、`devSessionCanvas.canvas.multiRootPresentationMode` 或 `devSessionCanvas.canvas.forkPlacementDirection`，升级到 `0.24.2` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时继续使用默认 allow-list，未配置 `multiRootPresentationMode` 时继续使用默认 `rootGroups`。
11. 当前仍为 `Preview`，不承诺跨版本 workspace / runtime journal 状态完全兼容；若涉及关键工作区，建议升级前先停止重要会话、备份画布状态，并在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.24.2` 对当前工作流形成 blocker，当前统一建议是：

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

当前 `0.24.2` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. 当前 Agent 节点向上 / 向下 / 向右 Fork 的固定层级与方向化连线对照
2. persistent journal current checkpoint 损坏后从 previous + suffix 恢复的前后对照
3. multi-root 下当前分组 / 当前 root / 整个 workspace 的清空菜单与确认文案
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
7. 确认发布 workflow 会先把同一批 VSIX 镜像到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许 deferred，不阻塞 `0.24.2` 完成。仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与按完成门禁删除临时 tag。
8. 复核 `OVSX_PAT`、`VSCE_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前完成门禁要求 Open VSX 可发布验证。`VSCE_PAT` 仍用于尝试 Visual Studio Marketplace 发布 / 验证，但 VSM 不可见时可记录为 deferred channel。GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：当前优先使用已验证的 Open VSX 或 `vX.Y.Z` 对应 GitHub Release Assets；Visual Studio Marketplace 只有在 public gallery 恢复且主扩展 / notifier 均可见后才作为已可用路径宣称。
10. 确认生产模板市场事实没有被写成插件发布事实：服务当前线上版本应结合 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 判断；插件发布 tag 不自动部署生产服务。

## 当前验证备注

截至 `2026-07-14`，上一轮 `0.24.1` 已从最终 `main` release ref `51dd07ed95f0e26db184cd4ce14decd5ce2721f7` 完成 GitHub Release assets + Open VSX 兜底发布；正式 `v0.24.1` 指向同一 ref，`publish/v0.24.1` 已删除。最终 manifest 为 `complete-with-deferred-visual-studio`，Open VSX 双扩展 `0.24.1` 均 verified，Visual Studio Marketplace 双扩展记录为 `publish-failed` / deferred，2026-07-14 public gallery 独立复核仍为 `count=0` / `TotalCount=0`，因此不得对外宣称 VSM 已可用。完整发布事实见下方 `0.24.1 发布后复核`。

`0.24.2` 发布输入只包含 `v0.24.1` 之后已合入 `main` 的 #261 Fork 定向展开与生成节点避碰、#262 Runtime Supervisor 跨 Node 终态门禁收口，以及 #263 无损 journal 安全 compact。三项合并提交及其已确认设计边界共同构成本轮输入，不纳入未合并分支 head。本发布准备分支只处理版本号、CHANGELOG、Marketplace / README 文案、发布手册和发布验证；最终 release ref 以发布准备 MR 合入 `main` 后的 commit 为准。

本轮发布准备分支已完成以下 repo-local 同步：

- 版本号同步：`package.json`、主扩展 manifest、notifier manifest、`package-lock.json` 根版本、主扩展 package entry 与 notifier package entry 均更新为 `0.24.2`
- release notes 同步：主扩展与 notifier changelog 已新增 `0.24.2` 顶部条目，明确 journal compact / recovery、final-state gate、Fork / collision 范围与 notifier 本轮仅对齐版本
- Marketplace / README 文案同步：主扩展 Marketplace 中英文 listing 与仓库中英文 README 已更新为 `0.24.2` 发布准备口径，并保留 unsafe journal 增长、90000 行短读、Fork 视觉 / footprint 精度和 VSM deferred 边界
- 发布手册同步：`docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 与 `docs/design-docs/public-marketplace-release-readiness.md` 更新目标版本、发布输入、安装/升级、回退与 tag 命令

本轮发布准备分支已完成以下 repo-local 验证；这些结果只证明当前 working-tree 候选输入，不能替代合入后最终 `main` ref 的 release gate：

- 依赖与发布守卫：Node `25.6.0` 下 production audit 为 `found 0 vulnerabilities`；版本 / 文本一致性、`git diff --check`、extension manifest、VSIX file list / command、publish tag / marketplaces / workflow 与 production deploy workflow 守卫均通过
- 构建与定向回归：主扩展与 notifier build / typecheck、notifier source、canvas node placement / groups / multi-root composition / layout / UI copy、serialized tracker / terminal journal / Runtime Supervisor protocol / paths / output sequence / Webview protocol 均通过；10-Agent Supervisor 样本处理 `828,019` 字符，input response `19.58ms`、echo `30.58ms`、registry `65,295 bytes`
- Webview 定向回归：计划覆盖的 Fork / journal / revision / Unicode / 4000 events 共 16 项均获得通过证据，但聚合命令两次都在 `Agent Fork action posts...` 的按钮 stable 等待处超时；该项隔离运行 `1 passed`，排除该项后的其余聚合 `15 passed`。失败快照证明按钮已可见、enabled 且文案正确，不把这两次 flaky 写成聚合清洁通过；问题已登记到技术债
- 真实宿主 smoke：notifier companion 与英文 / 简体中文 locale 均通过；`legacy-supervisor-upgrade` 首次在 input/output、节点尺寸和 terminal probe 已可见后等待 resize cols/rows 收敛超时，原样完整复跑使用旧二进制 `5355e6a` 通过；严格 `trusted`（含 90000 行断言）和两阶段 `real-reopen` 均一次通过
- 当前候选主扩展 VSIX 为 `dev-session-canvas-0.24.2.vsix`（`117` files，`3,925,963 bytes`，`sha256=f57db4d29706c123ee8cb59e591c3bdca24a84830cb6f71c3768e05dc54e704c`）；notifier VSIX 为 `dev-session-canvas-notifier-0.24.2.vsix`（`14` files，`159,017 bytes`，`sha256=3e9a56d38586195032baf4d9117f0fea0923fe44006d29d375896aab0c609163`）。两者包含英文默认、简体中文 NLS / l10n bundle，dirty-working-tree 打包日志使用 `VSCE README doc ref: fc427c6ed38c97c25f183e95216d35b19b1bc311`，只作为候选分支证据
- `npm run validate:clean-checkout:vsix -- --source working-tree` 完整通过隔离 `npm ci`、`651` packages 的 0-vulnerability audit、`117`-file 主扩展打包与 VS Code `1.128.0` packaged host，最终输出 `VSIX packaged-payload smoke passed`
- 隔离临时 clone 在 Node `22.23.1` 上以临时 ref `3e5dc0417efe12a14cb8cc27bff90a32c07da242` 执行 `release:publish-tag -- --trigger-tag publish/v0.24.2 --dry-run --package-only --skip-origin-main-check` 通过，正确规划两个 `0.24.2` VSIX 与 `release-manifest-0.24.2.json` 并停在 package-only 阶段；临时 ref 与本地 tag 已随临时目录删除，不得推送或冒充最终 release ref
- 最终 publish / tag 前仍必须在发布准备 MR 合入后的 clean `main` ref 上重跑完整 gate；准备分支 working tree 生成的 VSIX、临时 commit 或本地 tag 只作为候选证据，不得直接作为 Release assets 或最终 release ref

残余风险基线：Visual Studio Marketplace public gallery 当前仍不可见；真实旧二进制迁移 smoke 只覆盖 Linux / Unix socket，Windows named pipe 与 systemd generation 隔离只有路径级测试；旧 Supervisor raw tail 仍可能不完整；unsafe / oversized checkpoint 会继续增长 journal，当前无固定磁盘上限、完整长期 retention 策略或跨版本回退保证；local PTY 不具备跨 Host 恢复；90000 行 PTY 偶发短读已有三个样本且尚未关闭；Fork panel / editor 人工视觉验收与自动 File 真实 footprint 精度仍未收口；`trusted` / `real-reopen` 各有一项已登记 smoke harness 时序技术债。最终验证必须如实区分定向测试、真实升级 smoke、packaged-payload smoke 与未通过或未执行的门禁。

### 0.24.1 发布后复核

截至 `2026-07-14`，`0.24.1` 已从最终 `main` release ref `51dd07ed95f0e26db184cd4ce14decd5ce2721f7` 完成 GitHub Release assets + Open VSX 兜底发布。正式 `v0.24.1` tag 指向同一 ref，远端与本地均不存在 `publish/v0.24.1` 临时 tag。最终 release manifest 状态为 `complete-with-deferred-visual-studio`，Open VSX 主扩展与 notifier `0.24.1` 均为 verified，Visual Studio Marketplace 双扩展记录为 `publish-failed` / deferred；2026-07-14 对两个 extension id 的 public gallery 独立复核仍为 `count=0` / `TotalCount=0`。

正式 GitHub Release assets 为主扩展 `dev-session-canvas-0.24.1.vsix`（`3,909,883 bytes`，`sha256=fcae9ea4a00563d18a022b404597a36c9c0c28cd87791bdfb4a271402f22bcf9`）、notifier `dev-session-canvas-notifier-0.24.1.vsix`（`158,897 bytes`，`sha256=874488c00ec9eb80f01c1b7b2b69ba78b94fd371a902b67f057159e88aa10a88`）与 `release-manifest-0.24.1.json`。manifest 的 `packagingDocRef` / `readmeDocRef` 均为最终 release ref，`githubRelease.status=assets-uploaded`，`tags.triggerTagStatus=deleted`；这些事实与 GitHub Release、Open VSX latest API 和远端 tag 独立复核一致。

`v0.24.1` Release notes 已包含 generation 并行排空、旧会话交互、Linux-only 真实升级矩阵、旧 raw tail、90000 行短读和 `test:smoke-storage-slot` 边界。#262 的 forced-drain 单次 serialize / 事件驱动门禁与 #263 的 journal compact 都晚于该不可变 release ref，因此只进入 `0.24.2`，不得倒写成 `0.24.1` 工件已经包含。

## 发布命令

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.24.2
    git push origin publish/v0.24.2

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.24.2 <final-ref-or-sha>
    git push origin publish/v0.24.2

推送 `publish/v0.24.2` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，先执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.24.2 --package-only

该 workflow 只响应 `publish/v*` tag push 与手动 `workflow_dispatch`；创建普通分支、普通 tag 或 release 分支不应再生成 skipped publish run。若 Actions 列表出现非 `publish/v*` 引起的 `Publish Marketplace Release` run，应先修正 workflow 触发条件，不要把 skipped run 当作真实发布动作。

随后 workflow 会创建或确认正式 `v0.24.2` tag 指向同一 release ref，创建或更新 `v0.24.2` 对应的 GitHub Release，并上传以下 Release assets：

    release-artifacts/release-manifest-0.24.2.json
    dev-session-canvas-0.24.2.vsix
    extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.24.2.vsix

Release assets 上传后，workflow 会继续复用同一批 manifest / VSIX 分别执行 Open VSX 与 Visual Studio Marketplace 发布、验证。如果同一 `publish/v0.24.2` 因任一 marketplace 失败而重跑，workflow 会先下载并校验 `v0.24.2` GitHub Release 中已有的 manifest / VSIX assets，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

    npm run release:publish-tag -- --trigger-tag publish/v0.24.2 --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/v0.24.2 --skip-package --target visual-studio --no-create-final-tag

两个 marketplace 不再互相串行阻断：Open VSX 失败不阻止 Visual Studio Marketplace 尝试发布，Visual Studio Marketplace 失败也不阻止 Open VSX 尝试发布。workflow 会在两个目标都跑完后上传最终 manifest，并用当前 manifest 重新生成 GitHub Release notes；Release notes 必须包含本版本亮点、渠道状态、残余风险和发布证据。本轮 `0.24.2` 的完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 若仍不可见，则以 deferred channel 写入 manifest / notes，不阻塞删除远端和本地 `publish/v0.24.2`。如果 Open VSX 发布或验证失败，GitHub Release assets 和更新后的 Release notes 会保留为手动安装兜底，失败的 Open VSX job 会在上传自身结果 manifest 后标红，finalize job 也会在收口 Release 状态后标红，临时 tag 保留，便于修复 token / 渠道问题后使用 GitHub Actions 的 Re-run failed jobs 或 workflow_dispatch 重跑同一 release input；重跑必须复用这批既有 assets 并通过 manifest sha256 校验。

本地人工执行同一路径时，也应使用同一入口；发布前可先 dry-run，预览 release ref、VSIX 计划和 manifest：

    npm run release:publish-tag -- --trigger-tag publish/v0.24.2 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、主扩展 `CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.24.2` 指向的 commit。当前 workflow 在首次创建 Release assets 时会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.24.2.json` 并上传 GitHub Release assets；同一版本重跑时会下载并校验既有 Release assets。随后两种路径都会用 `--skip-package` 复用同一批 VSIX，分别发布并验证 Open VSX 与 Visual Studio Marketplace；脚本会保留既有 manifest 中已 verified 的渠道状态，避免已经完成的渠道被未完成渠道重跑覆盖。当前完成门禁只要求 Open VSX verified，Visual Studio Marketplace 可延期补发。

release manifest 不提交回代码库。它记录发布后事实，包括 release ref、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态，应作为 GitHub Release asset 保存；workflow 同时保留一份 Actions artifact 便于排障。GitHub Release notes 由主扩展 `CHANGELOG.md` 和当前 manifest 生成，必须在初次上传 assets 时和最终 manifest 上传时都同步更新，避免 Release 页面只有泛化模板而没有版本亮点和残余风险。

若 GitHub Actions 中 Open VSX 失败，或后续需要补发 / 重跑 Visual Studio Marketplace，必须复用同一 release ref 的 manifest / VSIX，并显式走 marketplace 补发命令；不要重新执行 package 覆盖 GitHub Release VSIX assets，因为同一 checkout 的 VSIX 打包当前不保证 byte-for-byte 可复现：

    npm run release:publish-tag -- --trigger-tag publish/v0.24.2 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.24.2 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.24.2.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.24.2`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。若对应 GitHub Release 已经存在完整 assets，重跑会复用并校验这些 assets；若 Release assets 不完整，先人工修复或删除不完整状态，不要用重新打包覆盖来恢复。

`vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag。为了让 Release assets 在 marketplace 暂时不可用时仍能先提供手动安装兜底，workflow 会在打包后、marketplace 发布验证前创建或确认该 tag。单看 `vX.Y.Z` 存在不再足以判断整轮发布完成；`0.24.2` 当前完成条件是 GitHub Release assets 已上传、Open VSX 已发布并验证、Visual Studio Marketplace 已记录为 verified 或 deferred、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除。如果 Open VSX 发布或验证失败，`vX.Y.Z` 与 Release assets 可能已经存在，但 workflow 会失败并保留临时 tag。需要人工删除临时 tag 时，应先确认两个 tag 指向同一 commit、Release assets 已存在，且 Open VSX 发布验证已经完成：

    git push origin :refs/tags/publish/v0.24.2
    git tag -d publish/v0.24.2

不要在 GitHub Release assets 上传未完成、正式 `vX.Y.Z` 尚未指向同一 release ref、Open VSX 发布验证尚未成功，或还需要依赖临时 tag 重跑时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；若 Open VSX 已验证完成，确认远端 `publish/v0.24.2` 已删除。
2. 打开 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 `files.*` metadata 均已同步到本轮版本；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 明确标记为 deferred，而不是已可用。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.24.2.vsix`、`dev-session-canvas-notifier-0.24.2.vsix` 与 `release-manifest-0.24.2.json` 都存在于 Assets 中。
4. 下载 release manifest，复核其中 `releaseRef`、两个 VSIX 的 `sha256`、`readmeDocRef`、`githubRelease.status`、marketplace `verified` 状态和 `tags.triggerTagStatus` 与实际发布事实一致。
5. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。Visual Studio Marketplace 恢复后再补做该路径的干净 profile 安装 / 升级验证。
6. 定向复核 `0.24.2` 用户可见主路径：合格 persistent journal 形成 current / previous generation 并能在 current 损坏时从 fallback 恢复，unsafe checkpoint 保留完整 journal；当前节点连续 Fork 按 `up / down / right` 保持同层、方向化连线与创建时避碰；大体量 final-state 在完整 revision 落定后发布。同时确认 `0.24.1` 的旧 generation 交互排空和 `0.24.0` 的 Agent `Resume` / multi-root 分范围清空主路径未回归。
7. 复核生产服务状态时使用 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 证据；不要把插件 `v0.24.2` tag 当成服务当前运行版本。
8. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
9. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界、模板市场 Preview、GitHub OAuth、生产空目录和 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺、真实模板预置承诺或 marketplace 可用性承诺。
