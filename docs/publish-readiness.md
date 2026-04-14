# 插件分发收口

本文记录当前仓库在公开 `Preview` 阶段的分发收口状态。当前产品已处于 `Preview` 阶段；本文关注的是如何把这条 `Preview` 分发链路收口到可公开发布，而不是把产品阶段继续定义成“准备中”。本次 `Preview` 的对外分发主路径明确为 `Visual Studio Marketplace`，但仍不把当前版本包装成稳定正式版。

## 当前结论

- 当前阶段的分发目标已切换为公开 `Preview` 分发，主渠道优先以 `Visual Studio Marketplace` 为目标。
- 当前版本只适合作为 `Preview` 预览版，不应包装成稳定正式版。
- 当前仓库已于 2026-04-05 完成 MVP 验证，并具备可持续迭代的公开 Preview 基线；后续变更默认按正式开发标准推进。
- 当前对外分发主路径已经确定为公开 `Marketplace Preview`；`VSIX` 只保留为构建工件和发布验证输入，不再作为普通用户分发方式。

## 仓库内已落实项

- `package.json` 已补齐 `preview`、`icon`、`galleryBanner`、`extensionKind`、`pricing`、`qna` 等发布元数据。
- manifest 已补齐公开 GitHub 可访问的 `repository`、`homepage` 与 `bugs` 元数据，为后续公开分发做准备。
- `vscode:prepublish` 会先执行 `npm run package`，确保打包前经过类型检查和生产构建。
- 仓库已把 VSIX 打包逻辑收口到 `scripts/package-vsix.mjs`；当前它应被理解为 Marketplace 发布链路中的构建与验证工件输入，而不是普通用户安装入口。
- 发布工具链已迁移到 `@vscode/vsce`，`scripts/package-vsix.mjs` 当前可同时兼容 `node_modules/.bin/vsce` 与包内 CLI 脚本路径。
- `.vscodeignore` 已完成第二轮发布包收口：除仓库调试产物外，`node-pty` 当前只保留运行时 `lib/*.js`、各平台 `prebuilds` 原生文件，以及运行时仍会解析的 `package.json` / `LICENSE`。
- `scripts/run-vscode-vsix-smoke.mjs` 现会在 packaged-payload smoke 前额外校验 VSIX 不再包含 `.github/`，以及 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 或 `.pdb` 等冗余内容。
- 当前工作树已能稳定执行 `npm run package:vsix`，生成约 `1.90 MB`、`43 files` 的 VSIX；`npm run test:vsix-smoke` 已再次通过，说明第二轮收口后的工件仍能跑通 packaged-payload smoke。
- 基于当前本地 `working tree` 快照的隔离 `clean checkout` 验证已于 `2026-04-14` 再次通过：`npm run validate:clean-checkout:vsix -- --source working-tree` 成功产出约 `1.90 MB`、`43 files` 的 VSIX，且 packaged-payload smoke 再次通过。
- 基于本轮最新候选 release head 的隔离 `clean checkout` 验证已于 `2026-04-14` 再次通过：`npm run validate:clean-checkout:vsix -- --ref HEAD` 成功产出 `dev-session-canvas-0.1.0.vsix`，约 `1.90 MB`、`43 files`，且 packaged-payload smoke 再次通过。
- 公开 GitHub 仓库 `main` 已同步到非空、可访问的公开内容；这件事与各轮 release head 的隔离验证是两个独立事实。当前 manifest 中的 `repository` / `homepage` 和 README 里的相对文档链接都已落到真实公开内容，而不是空仓库。
- 已显式声明 `Restricted Mode` 为有限支持，并通过 `restrictedConfigurations` 保护执行型设置。
- 已显式声明 `Virtual Workspace` 暂不支持，避免在当前实现尚未适配时误报支持能力。
- `docs/SECURITY.md` 已补齐专用安全邮箱、响应时限与“只支持最新主线 / 预览版”的支持口径。
- 仓库根目录已切换到 `Apache-2.0` 许可证，为公开发布提供明确的开源许可口径。
- `README.md` 与 `CHANGELOG.md` 已补齐发布准备说明与当前限制。
- 已补齐 `docs/support.md` 和 GitHub issue 模板，普通反馈、安全问题与 Preview 支持边界已有固定入口。
- `remote-ssh-real-reopen` blocker 已于 `2026-04-14` 修复：当前通过 storage fallback 兼容 `workspaceStorage/<id>-N` 槽位漂移，恢复链路不再依赖 reopen 时恰好拿到同一个 storage slot。
- 当前首发主路径已完成一轮人工验收，用户反馈为“人工验收没发现问题”；当前记录主要覆盖 `Remote SSH` / 调试 profile / 恢复主路径，而不是三平台本地严格验收。
- `Visual Studio Marketplace` 发布账号链路已打通：`Azure DevOps organization`、`Marketplace publisher`、`PAT` 与本地 `vsce login devsessioncanvas` 已完成。

## 当前公开发布阻塞项

以下项仍是当前 worktree 进入公开 Preview 发布前必须补齐的 blocker：

- 最终发布引用固定：当前候选发布提交已完成隔离 `clean checkout` 验证，并把 `1.90 MB`、`43 files` 的工件证据固定到可追溯提交；若真正对外发布使用的是后续 merge commit、tag 或其他 release ref，发布前仍需对最终 git ref 再跑一轮 `npm run validate:clean-checkout:vsix`。
- 平台支持矩阵：当前较强的验证证据主要集中在 `Remote SSH` 开发路径；`remote-ssh-real-reopen` 的 blocker 已修复，且当前人工验收无新增问题，但 Linux、macOS、Windows 本地路径仍未经过严格验证。公开发布前，应先明确首发支持的操作系统、Remote / Restricted Mode 范围，以及哪些能力仍是 `best-effort`。
- 发布说明收口：README、CHANGELOG、SECURITY、`docs/support.md` 与 issue 模板已经完成第一轮公开 Preview 收口，但 Marketplace listing、release notes、升级说明与回滚口径仍未定稿。
- 发布执行收口：账号链路已准备完成，但发布流水线本轮按当前决策暂不建设；在真正点击发布前，仍需锁定最终版本号、截图、Listing 文案以及手工发布步骤。

更完整的研究结论见 `docs/design-docs/public-marketplace-release-readiness.md`。

## 当前工作树收口建议（2026-04-14）

基于当前 `git status` 与 diff，当前工作树里的改动建议按下面三类处理：

### 建议纳入“公开 Marketplace Preview 收口”这一组改动

- `.vscodeignore`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `README.md`
- `docs/SECURITY.md`
- `docs/support.md`
- `docs/publish-readiness.md`
- `package.json`
- `package-lock.json`
- `scripts/package-vsix.mjs`
- `scripts/run-clean-checkout-vsix-validation.mjs`
- `scripts/vscode-smoke-runner.mjs`
- `scripts/run-vscode-vsix-smoke.mjs`
- `scripts/test-extension-storage-paths.mjs`
- `src/common/extensionStoragePaths.ts`
- `src/panel/CanvasPanelManager.ts`
- `.github/ISSUE_TEMPLATE/bug-report.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature-request.yml`
- `docs/design-docs/public-marketplace-release-readiness.md`
- `docs/exec-plans/active/public-marketplace-package-readiness.md`
- `docs/exec-plans/completed/public-marketplace-release-readiness-research.md`

这组文件直接对应当前首发发布目标：许可证、公开链接、Marketplace 口径、打包工具链、隔离验证链路与发布证据。

### 建议拆到其他功能或 bugfix 主题

- `src/panel/getWebviewHtml.ts`
- `docs/design-docs/execution-node-zoom-interaction-surface.md`
- `docs/exec-plans/completed/execution-node-zoom-coordinate-alignment.md`
- `docs/exec-plans/completed/execution-node-zoom-interaction-research.md`

这些改动和“Marketplace Preview 发布准备”不是同一个主题。若要一起进入首发，应单独说明它们的用户价值与验证结果，而不要默认跟随发布准备一起混入。

### 建议不要进入发布收口 commit

- `.vscode/settings.json`
- `core.*`
- `image.png`
- `image copy*.png`
- `img_v3_*.jpg`
- 未采用的图标变体草稿

这些内容属于本地调试噪音、core dump、截图草稿或未选用素材，不适合进入公开首发版本。

## 公开平台发布准备清单

以下清单默认以“若未来决定进入公开发布”为前提，且建议先以 `Visual Studio Marketplace` 为首发主渠道：

- [x] 确认要从“内部 Preview VSIX”切换到“公开平台发布”，并先以 `Visual Studio Marketplace` 为首发主渠道。
- [x] 明确公开许可证策略，更新 `package.json` 的 `license` 与仓库根目录 `LICENSE`。
- [x] 准备对外可访问的 `repository`、`homepage`、`bugs` 链接，避免继续依赖内网 HTTP 地址。
- [x] 已完成 README、CHANGELOG、SECURITY 和问题反馈入口的第一轮公开 Preview 口径收口；后续仍可继续细化发布页文案。
- [x] 已补齐 `docs/support.md` 与 GitHub issue 模板，把普通问题、安全问题和 Preview 支持边界分流到固定入口。
- [x] 收口 `.vscodeignore`，排除 `.debug/`、`.playwright-browsers/`、测试 artifacts、core dump、截图草稿等非发布内容。
- [x] 基于当前本地 `working tree` 快照完成隔离 `clean checkout` 验证，确认当前 `1.90 MB` / `43 files` 的发布输入下，`npm run package:vsix` 与 `npm run test:vsix-smoke` 可以稳定成功，且产物只作为 Marketplace 发布输入。
- [x] 把发布工具链迁移到官方当前使用的 `@vscode/vsce`；如需同步 `Open VSX`，再补 `ovsx` 流程。
- [x] 明确首发支持矩阵：操作系统、Local / Remote、Restricted Mode、Virtual Workspace、CLI 依赖要求。
- [x] 按当前首发主路径完成至少一轮人工验收，并保留自动化测试或手动验证记录；截至 `2026-04-14`，当前反馈为“人工验收没发现问题”。
- [ ] Linux、macOS、Windows 本地路径继续补做严格人工验收，并与对外支持矩阵保持一致。
- [x] 创建并验证 `Visual Studio Marketplace` publisher、Azure DevOps organization 与 PAT，并完成本地 `vsce login devsessioncanvas`。
- [x] 在版本已切到 `0.1.0` 的 release head `346c4bf` 上再次执行隔离 `clean checkout` 验证，避免把仅存在于未提交工作树中的状态误当成最终发布结论。
- [x] 在本轮发布包瘦身、support 文档和 issue 模板变更后，已基于本轮候选 release head 再执行一次隔离 `clean checkout` 验证。
- [ ] 若真正对外发布使用的是后续 merge commit、tag 或其他 release ref，发布前再对最终 git ref 执行一次隔离 `clean checkout` 验证。
- [ ] 在发布前准备版本号、release notes、升级说明与回滚口径，避免把当前 Preview 状态误写成稳定版承诺。
- [ ] 先发布一个可控的公开预览版本，再根据真实反馈决定是否进入稳定公开发布。

## 当前首发支持矩阵

| 维度 | 当前状态 | 当前口径 |
| --- | --- | --- |
| `Remote SSH` workspace | `Preview` 主路径 | 当前最强验证证据所在路径；首发说明可围绕这条路径建立 |
| Linux 本地 workspace | 可尝试，但未严格验证 | 不写成正式支持承诺 |
| macOS 本地 workspace | 可尝试，但未严格验证 | 不写成正式支持承诺 |
| Windows 本地 workspace | 可尝试，但未严格验证 | 不写成正式支持承诺 |
| `Restricted Mode` | 有限支持 | 画布可打开；执行型入口禁用 |
| `Virtual Workspace` | 不支持 | 不进入当前公开 Preview 范围 |
| `Agent` CLI 依赖 | 必需 | 需要 `codex` 或 `claude` CLI 可被 Extension Host 解析 |
| `Terminal` shell 依赖 | 必需 | 需要工作区侧可用 shell |
| `runtimePersistence.enabled = false` | 基线支持 | 不承诺真实进程跨 VS Code 生命周期持续存在 |
| `runtimePersistence.enabled = true` | `Preview` 能力，已具备较多验证证据 | 已有 `Remote SSH` real-reopen 自动化、相关 smoke 与人工验证证据；当前用户可见 guarantee 仍取决于 backend 与平台组合。Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时优先尝试更强 guarantee，否则回退到 `best-effort` |

## 当前公开 Preview 发布链路

仓库内已经收敛出的当前公开 Preview 最小链路如下：

1. 在仓库根目录执行 `npm install`。
2. 运行 `npm run package`，确认类型检查和生产构建同时通过。
3. 运行 `npm run package:vsix`，生成 Marketplace 发布所需的 VSIX 构建工件。
4. 完成发布前内容校验与主路径验证。
5. 通过 `Visual Studio Marketplace` 发布公开 Preview 版本。

当前工作树的最新验证结果：

- `npm run package:vsix` 已于 `2026-04-14 04:40 +0800` 再次通过，当前产物约为 `1.90 MB`、`43 files`。
- `npm run test:vsix-smoke` 已于 `2026-04-14 04:41 +0800` 再次通过，说明当前第二轮收口后的 packaged payload 仍可启动并跑通 trusted smoke。
- 当前 packaged-payload smoke 还会在解包阶段显式校验：`.github/` 与 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/`、`.pdb` 都不会重新进入 VSIX。
- 仓库已补上隔离验证脚本 `npm run validate:clean-checkout:vsix`，可在 `/tmp` 下基于 `git archive` 或当前 working tree 快照准备 clean-checkout 验证，不必直接扰动当前工作树。
- `npm run validate:clean-checkout:vsix -- --source working-tree` 已于 `2026-04-14 04:45 +0800` 再次通过，当前本地待发布工作树可在隔离目录中完成 `npm ci`、VSIX 打包与 packaged-payload smoke，并产出约 `1.90 MB`、`43 files` 的 VSIX。
- `npm run validate:clean-checkout:vsix -- --ref HEAD` 已于 `2026-04-14` 基于本轮最新候选 release head 再次通过，隔离目录内成功产出 `dev-session-canvas-0.1.0.vsix`，约 `1.90 MB`、`43 files`，并再次通过 packaged-payload smoke。

## 源码编译与开发安装

如果你是开发者，当前推荐通过源码编译与 Development Host 方式安装和调试：

1. 在仓库根目录执行 `npm install` 与 `npm run build`。
2. 在 VS Code 的 `Run and Debug` 中选择 `Run Dev Session Canvas`。
3. 按 `F5` 启动 `Extension Development Host`。

更完整的开发与 Remote-SSH 调试说明见 `CONTRIBUTING.md`。

## 后续公开发布动作

在完成当前 blocker 后，还需要补齐以下动作：

1. 锁定最终待发布版本号，并整理 Marketplace listing、截图、release notes、升级说明与回滚口径。
2. 若真正对外发布使用的是后续 merge commit、tag 或其他最终 release ref，再以该 git ref 重跑一次隔离 `clean checkout` 验证，固定最终发布证据。
3. 按当前“先不建发布流水线”的决策，整理一份可复核的手工发布步骤，再执行 Marketplace 发布流程。

## 发布前人工验证

截至 `2026-04-14`，当前首发主路径已完成一轮人工验收，且用户反馈“人工验收没发现问题”。在真正公开发布前，仍建议至少覆盖以下场景：

- 本地磁盘工作区下，能打开画布并创建四类对象。
- `Restricted Mode` 下，画布可打开，但 `Agent` / `Terminal` 执行入口被禁用且说明清晰。
- `Remote SSH` 开发路径下，能打开画布并完成 `Agent` / `Terminal` 主路径验证。
- Linux、macOS、Windows 本地路径需要补做严格人工验收。
- 重新打开窗口后，关键对象图和画布恢复链路成立。
- 若未来准备扩展对外支持范围，还应继续补做 Codespaces 等场景的人工验证。

## 暂不承诺项

- 不承诺当前版本已经是稳定版。
- 不承诺当前版本支持 `Virtual Workspace` 或浏览器形态。
- 不承诺当前版本已经具备面向公开外部用户的支持与运营体系。
