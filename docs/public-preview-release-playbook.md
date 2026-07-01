# 公开 Preview 发布执行手册

本文用于收口当前公开 `Marketplace Preview` 版本的发布素材、发布前复核、安装/升级说明、验证记录、发布命令与回退口径；当前目标版本为 `0.21.0`。当前版本范围收口为“相对已发布 `0.20.0` 的新 Preview 里程碑：主扩展子包化后的发布包布局、OSC 52 复制桥接、serialized terminal state 新鲜度、Agent 显式恢复 / 分叉参数边界、多根模板 root-scoped reset，以及 paneGallery root 级 running / attention 提示”。它不是对外宣传页，而是发布当天的执行与复核手册。

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
- 主扩展子包布局依据：`docs/design-docs/repository-monorepo-layout.md`
- 模板、多根和执行可靠性依据：`docs/design-docs/canvas-template-feature.md`、`docs/design-docs/canvas-multi-root-workspace-support.md`、`docs/design-docs/execution-terminal-clipboard-shortcuts.md`、`docs/design-docs/embedded-terminal-runtime-window.md`、`docs/design-docs/agent-launch-modes-and-restart.md`
- 模板市场产品与设计依据：`docs/product-specs/template-marketplace.md`、`docs/design-docs/template-marketplace.md`、`docs/workflows/SERVICE_DEPLOY.md`

## Marketplace listing 定稿口径

当前 listing 统一使用主扩展子包内英文默认版 `extensions/vscode/dev-session-canvas/README.marketplace.md`，不直接复用仓库根目录 `README.md`。`extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md` 仅作为仓库内中文对应版本保留，不改变默认 Marketplace 打包入口。

当前 `npm run package:vsix` 会 staging 主扩展子包，并在打包阶段显式传入 `--readme-path README.marketplace.md`，因此最终用于发布的 VSIX 已内嵌 Marketplace 专用 README；后续 `publish --packagePath` 只上传现成 VSIX，不会再替换 README。打包脚本默认会把 README 相对资源改写到当前 `HEAD` 对应的 git ref；如果在没有 `.git` 元数据的 clean checkout、导出目录或 tarball 中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，否则不允许继续打包。

本轮 listing 必须明确：主扩展子包化是仓库 / 打包布局变化，不改变用户安装的 extension id 或 notifier 关系；OSC 52 复制桥接只在聚焦执行终端和 clipboard target 下写系统剪贴板；Agent 默认参数中的会话目标类配置会被显式拒绝；多根模板 reset 是目标 root 级行为；模板市场仍是 `Preview` 能力，生产目录可能在真实模板发布前为空；生产服务部署版本与插件 SemVer 分离，不把 `deploy/template-marketplace/prod/*` 当作插件版本。

## release notes 定稿口径

当前 `0.21.0` 的 release notes 统一以 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 为准；发布前只允许做事实性修订，不应再引入与版本范围无关的新能力描述。docs-only 变化不进入用户可见更新说明，除非它改变安装、升级、回退或发布判断。

发布前应确认以下内容在 `extensions/vscode/dev-session-canvas/CHANGELOG.md` 中保持一致：

- 顶部版本标题为 `0.21.0 - Monorepo Packaging and Execution Reliability Update`
- 当前已包含实际版本差异、安装/升级说明与回退建议
- release notes 应覆盖以下当前已确认范围：主扩展子包化发布包布局、OSC 52 剪贴板桥接、serialized terminal state `outputSequence` 新鲜度校验、Agent 显式恢复 / 分叉默认参数边界、多根模板 root-scoped reset 与 Markdown path 解析、paneGallery root attention 闪烁和 running 扫描提示、VSIX 文件列表守卫，以及 `Dev Session Canvas Notifier` companion 版本对齐
- 安装/升级与回退口径需要继续与 `README.marketplace.md` 保持一致
- 不把 `Preview`、模板市场、生产服务、serialized terminal state 恢复或 Visual Studio Marketplace 可见性误写成稳定正式版承诺

## 安装与升级说明口径

当前对外统一使用以下安装与升级说明：

1. 当前目标版本为 `0.21.0`，扩展身份保持 `devsessioncanvas.dev-session-canvas`；`0.1.0` 仍是首个公开 `Preview` 基线版本。
2. 首次安装与从 `0.20.0` 升级到 `0.21.0` 的目标仍是通过当前宿主配置的公开扩展市场常规安装 / 升级完成。Open VSX 侧应继续同版本公开发布；官方 VS Code 的 `Visual Studio Marketplace` 仍是目标主路径，但当前 public gallery 仍不可见时允许延期补发，不阻塞本轮 `0.21.0` 以 GitHub Release assets + Open VSX verified 完成。对外宣称 VSM 安装路径前仍必须先完成 release-day visibility check，确认主扩展与 notifier 均公开可见。
3. 当前主扩展通过 `extensionPack` 自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，则由 notifier 的单向 `extensionDependencies` 自动补齐主扩展。
4. 若用户此前把 `resume`、`fork`、`--last`、`--resume`、`--session-id`、`--fork-session` 等一次性会话目标写入 `devSessionCanvas.agent.codexDefaultArgs` 或 `devSessionCanvas.agent.claudeDefaultArgs`，升级后相关 Agent 启动、恢复或分叉会显式报错；这类目标应改走创建前 `Resume`、节点 `重启`、节点 `分叉`、历史恢复入口，或写入本次自定义启动命令。
5. 多根 workspace 中的模板 reset 只作用于目标 root；若用户在 root 外部入口触发 reset，应先选择目标 root 或在目标 root section / pane 内操作。
6. 模板市场生产入口默认为 `https://dscanvas.dev/templates`；生产环境不会把代码内 seed 模板暴露为正式内容，初始空目录属于当前受控状态，不代表扩展安装失败。
7. 模板市场安装会把完整模板包写入用户或 workspace 模板库；写入事实由完整模板目录和 `.market.json` sidecar 管理，而不是把远端市场统计字段写入模板主体。
8. 若用户此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder`、`devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`、`devSessionCanvas.canvas.linkOpenMode`、`devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 或 `devSessionCanvas.canvas.multiRootPresentationMode`，升级到 `0.21.0` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时继续使用默认 allow-list，未配置 `multiRootPresentationMode` 时继续使用默认 `rootGroups`，默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息。
9. 当前仍为 `Preview`，不承诺跨版本 workspace 状态完全兼容；若涉及关键工作区，建议升级前先自行备份或先在非关键环境验证。

## 回退口径

### 用户侧回滚

若 `0.21.0` 对当前工作流形成 blocker，当前统一建议是：

1. 先禁用或卸载当前扩展，避免继续影响当前 workspace。
2. 关注后续更高的 `0.21.x` hotfix；当前默认优先通过修复版升级解决，而不是承诺平滑降级兼容。
3. 若确需回退，以重新安装目标版本并重新验证工作区状态为准；当前不承诺 `Preview` 版本之间的回退兼容。

### 维护者侧回滚

若发布后发现 P0 / P1 blocker，默认按以下顺序处理：

1. 优先评估能否在短时间内发布后续更高的 `0.21.x` hotfix。
2. 若短时间内无法修复，且当前版本会阻塞主路径使用或引发宿主崩溃，再考虑临时下架当前版本。
3. 模板市场服务-only 问题优先走 `docs/workflows/SERVICE_DEPLOY.md` 的服务 deploy tag / rollback，不自动提升或回滚插件 SemVer；插件包问题才走插件发布流程。
4. 无论选择 hotfix、服务 rollback 还是临时下架，都需要同步更新 GitHub issue、`docs/support.md` 与对外说明，避免用户只看到失真状态。

## 截图策略

当前 `0.21.0` 发布不以额外截图为 blocker。当前已经具备：

- `package.json` 中的 `icon`
- `galleryBanner`
- 独立的 Marketplace listing 正文

若发布当天能补齐更高质量的截图，可按下列优先级追加：

1. paneGallery root attention / running 提示与多根模板 reset 目标 root 入口
2. OSC 52 / TUI 复制桥接可用性的用户提示或诊断输出
3. 插件内模板市场列表和详情页，展示安装 / 更新 / 版本菜单
4. 浏览器市场详情页，展示 README / CHANGELOG 和安装到 VS Code 入口

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
   - `docs/design-docs/repository-monorepo-layout.md`
   - `docs/design-docs/execution-terminal-clipboard-shortcuts.md`
   - `docs/design-docs/embedded-terminal-runtime-window.md`
   - `docs/design-docs/agent-launch-modes-and-restart.md`
   - `docs/design-docs/canvas-multi-root-workspace-support.md`
   - `docs/product-specs/template-marketplace.md`
   - `docs/design-docs/template-marketplace.md`
   - `docs/workflows/SERVICE_DEPLOY.md`
   - `extensions/vscode/dev-session-canvas-notifier/CHANGELOG.md`
7. 确认发布 workflow 会先把同一批 VSIX 镜像到 GitHub Release assets，并以 Open VSX 主扩展 / notifier 发布验证作为本轮完成门禁；Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许 deferred，不阻塞 `0.21.0` 完成。仓库 Actions 必须具备 `contents: write` 权限，且 `GITHUB_TOKEN` 可创建 / 更新 Release、上传 assets、创建正式 tag 与按完成门禁删除临时 tag。
8. 复核 `OVSX_PAT`、`VSCE_PAT`、本地 `vsce login devsessioncanvas` 和 Open VSX token；当前完成门禁要求 Open VSX 可发布验证。`VSCE_PAT` 仍用于尝试 Visual Studio Marketplace 发布 / 验证，但 VSM 不可见时可记录为 deferred channel。GitHub Release assets 只使用 `GITHUB_TOKEN` 作为额外下载入口。
9. 确认 GitHub Release notes 的安装口径准确：当前优先使用已验证的 Open VSX 或 `vX.Y.Z` 对应 GitHub Release Assets；Visual Studio Marketplace 只有在 public gallery 恢复且主扩展 / notifier 均可见后才作为已可用路径宣称。
10. 确认生产模板市场事实没有被写成插件发布事实：服务当前线上版本应结合 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 判断；插件发布 tag 不自动部署生产服务。

## 当前验证备注

截至 `2026-07-02`，上一轮 `0.20.0` 已从最终 `main` release ref `91a5e862fdc7f8acf87c8ec2e2717c37890c1a8c` 完成 GitHub Release assets + Open VSX 兜底发布；正式 `v0.20.0` tag 指向同一 ref，远端 `publish/v0.20.0` 临时 tag 已由 workflow 删除。GitHub Release `v0.20.0` 位于 `https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.20.0`，包含 `dev-session-canvas-0.20.0.vsix`、`dev-session-canvas-notifier-0.20.0.vsix` 与 `release-manifest-0.20.0.json`。Release manifest 记录 Open VSX 主扩展与 notifier `0.20.0` 均 verified，Visual Studio Marketplace 主扩展与 notifier 均为 `publish-failed` / deferred；因此 VSM 继续作为 deferred channel，不得对外宣称为已可用。

`0.21.0` 当前发布准备输入来自 `v0.20.0` 之后合入 `origin/main` 的功能、修复与文档 / 打包工作：#227 主扩展子包化 monorepo 布局、#228 执行终端 OSC 52 复制桥接、#229 serialized terminal snapshot 新鲜度修复、#230 paneGallery root attention 闪烁增强、#231 Agent 会话恢复 / 分叉参数边界收紧、#232 多根 root 级模板 reset 与 Markdown 路径解析修复、#234 paneGallery root running 标题栏活性线和扫描提示。本轮发布准备分支只处理版本号、CHANGELOG、Marketplace / README 文案、发布手册和发布验证 harness 对齐，不把未合并的功能分支 head 直接当作发布输入。最终 release ref 以发布准备 MR 合入 `main` 后的 commit 为准。

本轮发布准备分支已完成以下 repo-local 同步：

- 版本号同步：`package.json`、主扩展 manifest、notifier manifest、`package-lock.json` 根版本、主扩展 package entry 与 notifier package entry 均更新为 `0.21.0`
- release notes 同步：`extensions/vscode/dev-session-canvas/CHANGELOG.md` 与 notifier changelog 已新增 `0.21.0` 顶部条目，并明确 notifier 不引入新的通知投递行为变更
- Marketplace / README 文案同步：`extensions/vscode/dev-session-canvas/README.marketplace.md`、`extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md`、`README.md`、`README.zh-CN.md` 已更新为 `0.21.0` 发布准备口径，并保留 VSM deferred 约束
- 发布手册同步：`docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 与 `docs/design-docs/public-marketplace-release-readiness.md` 已更新目标版本、发布输入、安装/升级、回退与 tag 命令
- 发布验证 harness 同步：`tests/vscode-smoke/extension-tests.cjs` 已对齐当前模板 reset 警告文案、执行 snapshot 新鲜度等待，以及 live-runtime scrollback smoke 的 6000 字符 output tail 边界；该调整只修正测试断言，不改变扩展运行时行为

本轮发布准备分支的自动化验证结果记录如下；这些结果只能证明当前发布准备分支的 repo-local 状态，不能替代发布准备 MR 合入后的最终 `main` release ref 验证。

截至 `2026-07-02`，`release-0-21-0-prep` 已通过以下 repo-local 验证：

- 版本、manifest、发布脚本与打包守卫：`npm run test:extension-manifest`、`npm run test:publish-tag-release`、`npm run test:publish-marketplaces`、`npm run test:package-vsix-command`、`npm run test:package-vsix-file-list`
- 构建、类型与核心单测：`npm run build`、`npm run build:notifier`、`npm run typecheck`、`npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages`、`npm run test:serialized-terminal-state-tracker`
- 本轮能力相关回归：`npm run test:execution-terminal-clipboard`、`npm run test:agent-launch-presets`、`npm run test:canvas-templates`、`npm run test:canvas-multi-root-composition`
- notifier / workflow / 服务配置验证：`npm run test:notifier-source`、`npm run test:publish-marketplace-workflow`、`npm run test:marketplace-production-deploy-workflow`、`npm run test:marketplace-production-config`
- 安全与发布包验证：`npm audit --omit=dev`、`npm run package:vsix`、`npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`、`npm run test:vsix-smoke`

当前 repo-local 打包结果为：主扩展 `dev-session-canvas-0.21.0.vsix`（`115` files，约 `3.6 MB`），notifier `extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.21.0.vsix`（`10` files，约 `145.83 KB` / filesystem `146K`）。主扩展打包日志在当前发布准备分支上打印 `VSCE README doc ref: 5b01fdaee13916e2075cf7e26617af909e0746ba`，但由于工作树包含尚未提交的发布准备改动，日志也明确提示“当前 git 工作树不是 clean 状态，已仅校验 README 相对资源在文件系统中存在”；最终发布必须在发布准备 MR 合入后的 clean `main` ref 上重跑，或显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`。

`npm run test:vsix-smoke` 在本轮发布准备中先暴露三处测试断言与当前实现事实不一致：模板 reset 警告文案已经从“workspace 绑定的画布对象”收口为“当前画布对象”；PTY robustness smoke 曾读取到输出产生前的旧 snapshot；live-runtime scrollback smoke 原本输出 `120` 行 marker，超过 supervisor `6000` 字符 output tail 后无法断言 `-001` 仍被恢复。上述测试 harness 已改为等待带 `xterm-serialize-v1` 的新鲜 snapshot，并把 live-runtime marker 行数收口到 `90` 行，随后 `npm run test:vsix-smoke` 通过，日志位于 `.debug/release-prep/test-vsix-smoke-0.21.0.log`。

生产服务 smoke 已单独复核当前线上事实：`https://dscanvas.dev/api/v1/meta` 返回 git sha `6ff3d3ccecabbe6b8019143ada0f57c099c6e32f`、`minSupportedExtensionVersion: 0.19.0`、`recommendedExtensionVersion: 0.19.0`、storage 为 `d1`、seed disabled、test auth disabled；`https://dscanvas.dev/api/v1/templates?limit=3` 返回空目录（`total: 0`）。这属于模板市场服务部署事实，不等同于插件 `0.21.0` release ref；本轮发布准备不自动把服务侧 min / recommended extension version 从 `0.19.0` 改到 `0.21.0`。

当前发布准备分支尚未合并，因此最终发布前必须在发布准备 MR 合入后的最终 `main` ref 上重跑 clean-checkout VSIX、主扩展 / notifier 打包、packaged-payload smoke 与 `publish/v0.21.0` dry-run。`npm run release:publish-tag -- --trigger-tag publish/v0.21.0 --dry-run --package-only --skip-origin-main-check` 需要先创建指向最终 release commit 的本地或远端 `publish/v0.21.0` tag；在发布准备分支未合入、未创建该 tag 前，不把 dry-run 写作已完成。

残余风险：Visual Studio Marketplace public gallery 当前仍不可见，manifest / Release notes 必须继续把 VSM 写成 deferred / `publish-failed`；不得把官方 VS Code Marketplace 安装路径宣称为已可用。真实 GitHub OAuth template publish smoke 仍是发布前 / 升级验证状态前 follow-up；生产服务与插件发布版本线分离，不能把服务 deploy tag 写成插件版本，也不能把插件 `v0.21.0` tag 当成当前线上服务版本。

## 发布命令

后续发布默认使用临时 `publish/vX.Y.Z` tag 固定发布输入，而不是在本地 shell 中把“当前 `HEAD`”临时认定为 release ref。前提仍然不变：发布准备 MR 必须已经 review 并合入 `main`，且 `publish/vX.Y.Z` 必须指向本次 release commit。

发布者先在最终 release commit 上创建并推送临时 tag；若当前 shell 已 checkout 到最终 release commit，可执行：

    git fetch origin main --tags
    git tag publish/v0.21.0
    git push origin publish/v0.21.0

若当前 shell 不在最终 release commit 上，应显式指定最终 commit：

    git tag publish/v0.21.0 <final-ref-or-sha>
    git push origin publish/v0.21.0

推送 `publish/v0.21.0` 会触发 `.github/workflows/publish-marketplace-release.yml`。该 workflow checkout 临时 tag 指向的 commit，先执行：

    npm ci
    npm run release:publish-tag -- --trigger-tag publish/v0.21.0 --package-only

该 workflow 只响应 `publish/v*` tag push 与手动 `workflow_dispatch`；创建普通分支、普通 tag 或 release 分支不应再生成 skipped publish run。若 Actions 列表出现非 `publish/v*` 引起的 `Publish Marketplace Release` run，应先修正 workflow 触发条件，不要把 skipped run 当作真实发布动作。

随后 workflow 会创建或确认正式 `v0.21.0` tag 指向同一 release ref，创建或更新 `v0.21.0` 对应的 GitHub Release，并上传以下 Release assets：

    release-artifacts/release-manifest-0.21.0.json
    dev-session-canvas-0.21.0.vsix
    extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.21.0.vsix

Release assets 上传后，workflow 会继续复用同一批 manifest / VSIX 分别执行 Open VSX 与 Visual Studio Marketplace 发布、验证。如果同一 `publish/v0.21.0` 因任一 marketplace 失败而重跑，workflow 会先下载并校验 `v0.21.0` GitHub Release 中已有的 manifest / VSIX assets，不会重新打包或覆盖 VSIX；若既有 Release 缺少任一必需 asset，则直接失败并要求人工修复不完整状态。

    npm run release:publish-tag -- --trigger-tag publish/v0.21.0 --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/v0.21.0 --skip-package --target visual-studio --no-create-final-tag

两个 marketplace 不再互相串行阻断：Open VSX 失败不阻止 Visual Studio Marketplace 尝试发布，Visual Studio Marketplace 失败也不阻止 Open VSX 尝试发布。workflow 会在两个目标都跑完后上传最终 manifest，并用当前 manifest 重新生成 GitHub Release notes；Release notes 必须包含本版本亮点、渠道状态、残余风险和发布证据。本轮 `0.21.0` 的完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 若仍不可见，则以 deferred channel 写入 manifest / notes，不阻塞删除远端和本地 `publish/v0.21.0`。如果 Open VSX 发布或验证失败，GitHub Release assets 和更新后的 Release notes 会保留为手动安装兜底，失败的 Open VSX job 会在上传自身结果 manifest 后标红，finalize job 也会在收口 Release 状态后标红，临时 tag 保留，便于修复 token / 渠道问题后使用 GitHub Actions 的 Re-run failed jobs 或 workflow_dispatch 重跑同一 release input；重跑必须复用这批既有 assets 并通过 manifest sha256 校验。

本地人工执行同一路径时，也应使用同一入口；发布前可先 dry-run，预览 release ref、VSIX 计划和 manifest：

    npm run release:publish-tag -- --trigger-tag publish/v0.21.0 --dry-run --package-only

`release:publish-tag` 会校验 tag 名称、版本号、主扩展 `CHANGELOG.md`、notifier 版本、当前 `HEAD`、`origin/main` 祖先关系和 clean working tree，并把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` / `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 都绑定到 `publish/v0.21.0` 指向的 commit。当前 workflow 在首次创建 Release assets 时会先打包两个 VSIX，生成 `release-artifacts/release-manifest-0.21.0.json` 并上传 GitHub Release assets；同一版本重跑时会下载并校验既有 Release assets。随后两种路径都会用 `--skip-package` 复用同一批 VSIX，分别发布并验证 Open VSX 与 Visual Studio Marketplace；脚本会保留既有 manifest 中已 verified 的渠道状态，避免已经完成的渠道被未完成渠道重跑覆盖。当前完成门禁只要求 Open VSX verified，Visual Studio Marketplace 可延期补发。

release manifest 不提交回代码库。它记录发布后事实，包括 release ref、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态，应作为 GitHub Release asset 保存；workflow 同时保留一份 Actions artifact 便于排障。GitHub Release notes 由主扩展 `CHANGELOG.md` 和当前 manifest 生成，必须在初次上传 assets 时和最终 manifest 上传时都同步更新，避免 Release 页面只有泛化模板而没有版本亮点和残余风险。

若 GitHub Actions 中 Open VSX 失败，或后续需要补发 / 重跑 Visual Studio Marketplace，必须复用同一 release ref 的 manifest / VSIX，并显式走 marketplace 补发命令；不要重新执行 package 覆盖 GitHub Release VSIX assets，因为同一 checkout 的 VSIX 打包当前不保证 byte-for-byte 可复现：

    npm run release:publish-tag -- --trigger-tag publish/v0.21.0 --skip-package --target open-vsx --no-create-final-tag

    npm run release:publish-tag -- --trigger-tag publish/v0.21.0 --skip-package --target visual-studio --no-create-final-tag

注意：`--skip-package` 不再只检查 VSIX 文件存在；它要求已有 `release-artifacts/release-manifest-0.21.0.json`，并校验当前 VSIX sha256 与 manifest 一致，避免复用不属于本次 release ref 的旧包。

若最终版本号不是 `0.21.0`，统一替换 tag、manifest 文件名、release notes 与验证记录中的版本号。

## 正式 tag 与临时 tag

`publish/vX.Y.Z` 是临时发布意图 tag，只用于固定 release input 和触发 / 重跑发布。它不是正式 release tag；发布中途失败时应保留，便于重跑同一输入。若对应 GitHub Release 已经存在完整 assets，重跑会复用并校验这些 assets；若 Release assets 不完整，先人工修复或删除不完整状态，不要用重新打包覆盖来恢复。

`vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag。为了让 Release assets 在 marketplace 暂时不可用时仍能先提供手动安装兜底，workflow 会在打包后、marketplace 发布验证前创建或确认该 tag。单看 `vX.Y.Z` 存在不再足以判断整轮发布完成；`0.21.0` 当前完成条件是 GitHub Release assets 已上传、Open VSX 已发布并验证、Visual Studio Marketplace 已记录为 verified 或 deferred、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除。如果 Open VSX 发布或验证失败，`vX.Y.Z` 与 Release assets 可能已经存在，但 workflow 会失败并保留临时 tag。需要人工删除临时 tag 时，应先确认两个 tag 指向同一 commit、Release assets 已存在，且 Open VSX 发布验证已经完成：

    git push origin :refs/tags/publish/v0.21.0
    git tag -d publish/v0.21.0

不要在 GitHub Release assets 上传未完成、正式 `vX.Y.Z` 尚未指向同一 release ref、Open VSX 发布验证尚未成功，或还需要依赖临时 tag 重跑时删除临时 tag。

## 发布后验证

发布完成后至少执行以下复核：

1. 确认对应版本的 lightweight tag 已存在于远端，且指向本次实际发布的 commit；若 Open VSX 已验证完成，确认远端 `publish/v0.21.0` 已删除。
2. 打开 Open VSX 页面，复核主扩展和 notifier 的标题、图标、banner、README 文案、CHANGELOG、版本号与 `files.*` metadata 均已同步到本轮版本；同时复核 Visual Studio Marketplace 状态，若仍不可见则确认 Release notes / manifest 明确标记为 deferred，而不是已可用。
3. 打开 GitHub Release 页面，确认 `dev-session-canvas-0.21.0.vsix`、`dev-session-canvas-notifier-0.21.0.vsix` 与 `release-manifest-0.21.0.json` 都存在于 Assets 中。
4. 下载 release manifest，复核其中 `releaseRef`、两个 VSIX 的 `sha256`、`readmeDocRef`、`githubRelease.status`、marketplace `verified` 状态和 `tags.triggerTagStatus` 与实际发布事实一致。
5. 在干净 profile 中优先从 Open VSX 安装或升级；另从 GitHub Release 下载 VSIX 手动安装一次，验证兜底包可成功激活并能打开主画布，同时验证 notifier 与主扩展的安装关系未被打包破坏。Visual Studio Marketplace 恢复后再补做该路径的干净 profile 安装 / 升级验证。
6. 定向复核 `0.21.0` 用户可见主路径：主扩展激活、主画布打开、执行节点 TUI OSC 52 复制、serialized terminal snapshot 恢复不回退到旧画面、Agent 显式恢复 / 分叉默认参数冲突提示、多根 root-scoped template reset、paneGallery root attention / running 提示，以及模板市场打开 / 空目录读取。
7. 复核生产服务状态时使用 `/api/v1/meta`、deploy tag、Cloudflare deployment id 和 production smoke 证据；不要把插件 `v0.21.0` tag 当成服务当前运行版本。
8. 确认 issue 链接、安全邮箱与 `docs/support.md` 跳转正常。
9. 复核 `Preview`、`Restricted Mode`、`Virtual Workspace`、本地 CLI 依赖、multi-root shared live runtime 恢复边界、模板市场 Preview、GitHub OAuth、生产空目录和 GitHub Release assets 兜底安装口径仍被正确表达，没有被误读成稳定版承诺、真实模板预置承诺或 marketplace 可用性承诺。
