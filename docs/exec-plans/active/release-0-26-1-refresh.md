# 从最新主线重新准备 0.26.1

本 ExecPlan 按 `docs/PLANS.md` 持续维护。发布准备交付可 review 的版本、用户说明和验证证据；对外发布、打 tag 和合并 PR 需另行授权。

## 目标与全局图景

用户可以通过新的 0.26.1 包获得主线已完成的启动、输入删除、终端交互和共享 root 画布修复。维护者可以在一个新的发布准备 PR 中核对版本、安装升级说明、产品限制和完整发布验证。本次舍弃已关闭的 PR #313，从最新 origin/main 新建分支，不沿用其发布输入或测试结论。

## 进度

- [x] (2026-10-13 02:58Z) fetch 并固定最新主线 ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b，创建独立 /tmp/dsc261fresh 工作树与 release-0-26-1-refresh 分支。
- [x] (2026-10-13 02:58Z) 复核工作流、发布契约、版本材料和 v0.26.0 已发布事实；PR #326 仍未合并。
- [x] (2026-10-13 03:04Z) 同步版本、双 CHANGELOG、中英文 listing/README、发布手册、支持边界及 v0.26.1 契约；静态 preflight exit0。
- [ ] 提交静态输入，针对该 head 与最新 main 的预合并结果执行标准 preflight 和完整 release:verify。
- [ ] 补充 notifier 类型/companion/locale 与独立 notifier 包验证，记录命令和首败事实。
- [ ] 同步结果与技术债，复查最新 main，推送并创建发布准备 PR。

## 意外与发现

主线仍使用 0.26.0 版本，其 verify 有精确的一次性例外。0.26.1 必须走完整 npm test 和干净源码打包安装 smoke，不继承豁免。PR #325 只将真实窗口重开 smoke 的 ready 等待改为 45 秒，没有增加普通打开的启动超时提示或恢复功能。

此前主线验证报告 PR #326 的完整 npm test 通过，但首次独立 npm ci 遇到 Wrangler/esbuild ETXTBSY；增加 npm_config_foreground_scripts=true 的新一次独立验证通过。这不是原根因已修复，也不是本版本 verify 通过。该报告未合并，不把其分支当主线；本轮执行默认安装和独立完整验证，失败另留证据。

## 决策记录

- 决策：重新创建全部发布输入，只纳入 ea0c9b19 主线已有产品能力。
  理由：旧 PR #313 遗漏 PR #314/#316/#319 等后续变更，其候选包不能代表当前发布。
  日期/作者：2026-10-13 / Codex。
- 决策：保留 Preview、双扩展同版本、既有渠道策略和有限验证边界。
  理由：本次是修复发布准备，没有授权扩张支持矩阵或部署模板市场服务。
  日期/作者：2026-10-13 / Codex。
- 决策：完整 verify 首轮使用默认 npm 生命周期配置，失败不拼接为聚合通过。
  理由：先取得当前版本与正式流程一致的证据；具体安装写者尚未确认，临时串行通过不能代证默认门禁。
  日期/作者：2026-10-13 / Codex。

## 结果与复盘

目前已完成基线和发布范围复核，尚无本版本完整验证结果。后续结果写入本计划和正式发布准备设计记录，禁止将候选 commit、工件 hash 或测试状态放进 CHANGELOG/发布契约。

## 上下文与定向

仓库根 package.json 管理 npm 工作区。两个公开扩展位于 extensions/vscode/dev-session-canvas 和 extensions/vscode/dev-session-canvas-notifier；根 manifest、两侧 manifest 与 package-lock.json 的根/工作区版本须同为 0.26.1。scripts/release/release-preflight.mjs 校验版本、两份 CHANGELOG 和 docs/release-contracts/v0.26.1.md，--verify 再运行发布脚本回归、完整 npm test、HEAD 的独立 npm ci/VSIX 打包/安装 smoke。预合并结果是以最新目标为第一父提交、准备分支为第二父提交的临时合并 commit，不更新 main，也不合入任何未合并功能。

本次已合入功能包括 root 稳定归属和失败收口、旧会话清理/重连、owned 本地执行的通知/恢复/拖放/文件活动/链接/终态、删除输入边界，以及持久化开启时同 root 画布同步和分阶段最后窗口清理接管。普通关闭与主动切换关闭不同；关闭模式保留工作区私有画布；切换在关闭/reload 边界应用且不迁移私有/共享内容。六目标原生资产存在不意味着六平台本轮均完成宿主验收。

## 工作计划

先更新 docs/design-docs/public-marketplace-release-readiness.md 的当前正式范围与索引，保留 0.26.0 历史例外。新增契约并更新根/双扩展版本、两个 CHANGELOG、中英文 README/listing、两份手册和 support。所有产品实现/依赖/测试断言保持当前主线；如出现必须修改的实际发布阻塞，先固定首败与范围再决定另行修复。

提交静态输入后在独立 detached 工作树生成预合并结果。安装依赖，预先准备 Chromium，按标准 verify 验证已提交源码和 package 输入。补充 notifier 受控宿主联动、本地化和独立包检查。命令证据写入 docs/references/release-0-26-1-refresh，结果登记技术债与本计划。最终重新 fetch，若主线前移则 rebase 并重新评估/执行对应预合并验证。完整门禁失败时创建明确标注阻塞的草稿 PR，不能声明可合并。

## 具体步骤

在仓库根执行 git fetch origin，git worktree add -b release-0-26-1-refresh /tmp/dsc261fresh origin/main。修改完成后在该工作树 git diff --check 并提交。用 git merge-tree --write-tree origin/main HEAD 生成预合并树，以 git commit-tree 指定两个父提交，git worktree add --detach /tmp/dsc261verify <预合并 commit>；验证过程不得改变产品文件。

在验证工作树使用 Node22.23.3，设置 DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets 和 DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test。按 CONTRIBUTING.md 复用经过同源 hash 校验的六目标资产；缓存路径不可作为来源证明。设置 umask0077、短私有 debug/host 临时路径，记录暖 Chromium revision1217 缓存；先 npm ci，再 npx --no-install playwright install --with-deps chromium。运行 npm run release:preflight -- --version 0.26.1 和 npm run release:verify -- --version 0.26.1，预期两个命令真实 exit0 且完整 npm test、八个打包场景全部通过。移除自己创建的缓存链接再提交，推送前再次 fetch/rebase。按 docs/workflows/MR_CREATE.md 创建 PR，验证未通过则草稿。

## 验证与验收

三个 manifest、lock 四处版本与双 CHANGELOG 顶部均为 0.26.1；契约列齐必需文档且没有测试/发布后状态。默认 verify 必须真实运行完整测试和独立安装打包，不能使用场景过滤、跳过 smoke、重试断言或更改截图基线。进一步运行 typecheck:notifier、test:notifier-smoke、test:notifier-locale-smoke 和 notifier package:vsix，确认语言、安装关系、README 与版本；受控 callback 不代证本机系统真实桌面点击或公开市场自动依赖安装。

验收产物为可追溯的新发布准备 PR、最新主线祖先关系、具名验证结果和限制。required CI/review 与合并后的 tag verify 属于正式发布前门槛，本次不执行发布。

## 幂等性与恢复

保留其他工作树与旧首败证据。安装/测试失败按不同名字记录新运行，绝不覆盖首败日志；不删未知资源换取通过。版本修改可在本分支恢复；无需碰 main 或旧 PR。若预合并验证后只新增证据文档，核对产品/测试/发布输入 hash 完全相同，明确本地验证的实际 commit；线上 PR 仍须在最新 head 生成的预合并结果完整验证。

## 证据与备注

基线：ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b。v0.26.0 公开 Release 于 2026-10-08T00:54:14Z 创建，不能再写上一已发布版本 0.25.0。新命令日志保存在/tmp/d261r；仓库只收录精简证据、时间、命令、退出码和输入/日志 hash，不上传用户数据或凭据。

## 接口与依赖

不新增 API、依赖或设置。沿用 scripts/release/release-preflight.mjs、scripts/release/run-clean-checkout-vsix-validation.mjs、现有 npm 脚本和 VSIX 打包入口。主扩展 extensionPack 与 notifier 单向 extensionDependencies 保持同一安装关系；模板市场生产部署独立于插件 SemVer。

2026-10-13 修订：从最新主线新建计划，明确发布范围、默认安装风险与双阶段完整验证，避免复用已舍弃候选。
