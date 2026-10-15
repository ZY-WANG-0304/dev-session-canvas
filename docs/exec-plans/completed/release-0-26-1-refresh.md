# 从最新主线重新准备 0.26.1

本 ExecPlan 按 `docs/PLANS.md` 持续维护。发布准备交付可 review 的版本、用户说明和验证证据；对外发布、打 tag 和合并 PR 需另行授权。

## 目标与全局图景

用户可以通过新的 0.26.1 包获得主线已完成的启动、输入删除、终端交互和共享 root 画布修复。维护者可以在一个新的发布准备 PR 中核对版本、安装升级说明、产品限制和完整发布验证。本次舍弃已关闭的 PR #313，从最新 origin/main 新建分支，不沿用其发布输入或测试结论。

## 进度

- [x] (2026-10-13 02:58Z) fetch 并固定最新主线 ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b，创建独立 /tmp/dsc261fresh 工作树与 release-0-26-1-refresh 分支。
- [x] (2026-10-13 02:58Z) 复核工作流、发布契约、版本材料和 v0.26.0 已发布事实；PR #326 仍未合并。
- [x] (2026-10-13 03:04Z) 同步版本、双 CHANGELOG、中英文 listing/README、发布手册、支持边界及 v0.26.1 契约；静态 preflight exit0。
- [x] (2026-10-13 03:05Z) 已提交静态输入，准备 head e123d1e73214fc0f79fc0bba508447331d3f7b49；预合并 eba53a28074cbcc49958f7845ebe5b04411a531a 的默认 npm ci、浏览器准备、preflight 均 exit0。
- [x] (2026-10-13 03:22Z) 标准完整 release:verify exit1：localhost SSH 第三个 Terminal 未离线完成；已 ready，旧升级 resize 及其他前置场景通过，保留首败。
- [x] (2026-10-13 03:35Z) 独立 Webview 426/426 exit0，无重试/截图更新；notifier 类型与 14 文件独立 VSIX 通过。
- [x] (2026-10-13 03:43Z) 独立默认 clean-checkout 与全部八个安装场景通过，notifier companion/en/zh-cn locale 均 exit0；不代证原聚合通过。
- [x] (2026-10-13 03:43Z) notifier 类型/companion/locale/独立包完成，12 条命令与 SSH 首败证据已整理。
- [x] (2026-10-13 03:44Z) 同步结果与技术债，fetch/rebase 确认 main 未前移；本次以完整 verify 失败的草稿状态收口，后续修复和全量复验独立跟进。
- [x] (2026-10-13 03:47Z) 推送并创建[草稿PR #327](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/327)，目标main；完整SSH首败仍阻断合并和发布。

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

## PR328合入后的接续验证

2026-10-13用户要求rebase PR327并重跑发布门禁。已确认PR328合入main22803dd8，保留发布分支原head7b2440d4，在原发布工作树完成rebase，文档冲突保留两边新增条目。本轮生成新的临时预合并，在短路径checkout使用实际npm ci、同源原生资产和匹配Chromium缓存运行完整preflight/verify。任何新失败使用独立日志，保留旧首败；最新结果在PR327描述与checks中关联真实head/base/预合并SHA，不将旧独立通过拼接成新结果。本计划先前收口的发布准备交付不变，合并、tag及对外发布仍需后续授权。

## PR329合入后的正式门禁

2026-10-14用户要求rebase PR327并运行门禁。已确认PR329正常合入，fetch得到main72338331；保留原远端发布head42d87b3d和本地备份引用，五个发布提交已rebase，冲突仅为索引/技术债，两边材料均保留。原工作区未提交的WORKFLOW修改未参与本轮。

本轮在同一发布PR同步历史状态，再以固定旧远端head的force-with-lease更新分支。转为非草稿是正式Release Preflight创建检查的前提，不代表授权合并。workflow固定最新PR预合并SHA，为六个平台生成同源资产，并运行原完整release:verify（包含静态preflight、未过滤npm test与独立clean-checkout VSIX八场景）。实际head/base/预合并/run和结果在PR327描述/checks记录；组合38426726365的旧输入通过不代证本轮。未完成正式门禁及review前不得合并；本轮不打tag或发布，也不另建验证/文档PR。

## PR332合入后的正式完整复验

2026-10-14用户要求继续rebase并重跑完整发布门禁。fetch确认PR332合入main f3bb4425，保留远端旧发布head a95b69b0和本地备份引用，六个发布提交rebase完成；设计原则与技术债冲突保留两边内容，产品/测试/workflow与最新主线相同。

历史正式run38485499547在Marketplace版本发布成功提示断言失败，后续未触达。PR332修正原预算内完成反馈等待并保留准确断言，单项和真实1.141.1对照已有证据。本轮按正式非草稿PR流程固定最新预合并SHA，重新构建六平台同输入资产、默认npm ci、完整release:verify；实际输入/结果在PR327描述和checks绑定，失败保留首败，成功也不代替最终tag验证。本轮不合并、打tag或发布。

## PR333合入后的正式完整复验

2026-10-14用户要求rebase #327并重跑完整门禁。fetch确认PR333正常合入，main eee25291109e7e3bad27e6841520f3f4a5d14dcc；保留原发布head cfe1ab40和本地backup/pr327-before-pr333-rebase，七个发布提交rebase无冲突，发布PR不新增产品/测试/workflow修改。

历史正式run38539427680在SSH exit本地后代SIGKILL的ESRCH失败，根已实际SIGKILL，SSH业务及Webview/clean-checkout未触达。PR333已限定后代ESRCH复查不再运行才能继续，保留异常和最终退出检查，39项/实际内核/原生exit-retain定向通过。本轮保持完整未过滤release:verify，在最新PR预合并输入重新构建六平台资产并默认npm ci/浏览器准备；实际head/base/input/run与结果在PR327描述和checks登记。单项/历史输入通过不代证新完整验证，原首败保留。转为非草稿只用于门禁，不授权合并/tag/发布。

## 历史结果与复盘（PR328合入前）

本次静态输入已完成。预合并默认安装和 preflight 通过，完整 verify 在 localhost SSH 离线完成条件失败；独立 Webview426/426、干净安装包八场景、notifier 类型/联动/语言/包均通过。发布准备以草稿 PR 交付，完整门禁未通过仍禁止合并/发布。原首败保留并登记技术债；此次计划收口的是重新准备与可 review 材料，实际发布并未完成。后续结果写入本计划和正式发布准备设计记录，禁止将候选 commit、工件 hash 或测试状态放进 CHANGELOG/发布契约。

## 上下文与定向

仓库根 package.json 管理 npm 工作区。两个公开扩展位于 extensions/vscode/dev-session-canvas 和 extensions/vscode/dev-session-canvas-notifier；根 manifest、两侧 manifest 与 package-lock.json 的根/工作区版本须同为 0.26.1。scripts/release/release-preflight.mjs 校验版本、两份 CHANGELOG 和 docs/release-contracts/v0.26.1.md，--verify 再运行发布脚本回归、完整 npm test、HEAD 的独立 npm ci/VSIX 打包/安装 smoke。预合并结果是以最新目标为第一父提交、准备分支为第二父提交的临时合并 commit，不更新 main，也不合入任何未合并功能。

本次已合入功能包括 root 稳定归属和失败收口、旧会话清理/重连、owned 本地执行的通知/恢复/拖放/文件活动/链接/终态、删除输入边界，以及持久化开启时同 root 画布同步和分阶段最后窗口清理接管。普通关闭与主动切换关闭不同；关闭模式保留工作区私有画布；切换在关闭/reload 边界应用且不迁移私有/共享内容。六目标原生资产存在不意味着六平台本轮均完成宿主验收。

## 工作计划

先更新 docs/design-docs/public-marketplace-release-readiness.md 的当前正式范围与索引，保留 0.26.0 历史例外。新增契约并更新根/双扩展版本、两个 CHANGELOG、中英文 README/listing、两份手册和 support。所有产品实现/依赖/测试断言保持当前主线；如出现必须修改的实际发布阻塞，先固定首败与范围再决定另行修复。

提交静态输入后在独立 detached 工作树生成预合并结果。安装依赖，预先准备 Chromium，按标准 verify 验证已提交源码和 package 输入。补充 notifier 受控宿主联动、本地化和独立包检查。命令证据写入 docs/references/release-0-26-1-refresh，结果登记技术债与本计划。最终重新 fetch，若主线前移则 rebase 并重新评估/执行对应预合并验证。完整门禁失败时创建明确标注阻塞的草稿 PR，不能声明可合并。

## 具体步骤

在仓库根执行 git fetch origin，git worktree add -b release-0-26-1-refresh /tmp/dsc261fresh origin/main。修改完成后在该工作树 git diff --check 并提交。先确认 git merge-base --is-ancestor origin/main HEAD 成功，再以 HEAD 的 tree 和 git commit-tree 指定两个父提交生成预合并 commit；本机旧 Git 不支持 merge-tree --write-tree，目标已是祖先时合并树与 HEAD 相同，git worktree add --detach /tmp/dsc261verify <预合并 commit>；验证过程不得改变产品文件。

在验证工作树使用 Node22.23.3，设置 DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets 和 DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test。按 CONTRIBUTING.md 复用经过同源 hash 校验的六目标资产；缓存路径不可作为来源证明。设置 umask0077、短私有 debug/host 临时路径，记录暖 Chromium revision1217 缓存；先 npm ci，再 npx --no-install playwright install --with-deps chromium。运行 npm run release:preflight -- --version 0.26.1 和 npm run release:verify -- --version 0.26.1，预期两个命令真实 exit0 且完整 npm test、八个打包场景全部通过。移除自己创建的缓存链接再提交，推送前再次 fetch/rebase。按 docs/workflows/MR_CREATE.md 创建 PR，验证未通过则草稿。

## 验证与验收

三个 manifest、lock 四处版本与双 CHANGELOG 顶部均为 0.26.1；契约列齐必需文档且没有测试/发布后状态。默认 verify 必须真实运行完整测试和独立安装打包，不能使用场景过滤、跳过 smoke、重试断言或更改截图基线。进一步运行 typecheck:notifier、test:notifier-smoke、test:notifier-locale-smoke 和 notifier package:vsix，确认语言、安装关系、README 与版本；受控 callback 不代证本机系统真实桌面点击或公开市场自动依赖安装。

验收产物为可追溯的新发布准备 PR、最新主线祖先关系、具名验证结果和限制。required CI/review 与合并后的 tag verify 属于正式发布前门槛，本次不执行发布。

## 幂等性与恢复

保留其他工作树与旧首败证据。安装/测试失败按不同名字记录新运行，绝不覆盖首败日志；不删未知资源换取通过。版本修改可在本分支恢复；无需碰 main 或旧 PR。若预合并验证后只新增证据文档，核对产品/测试/版本/用户发布输入 hash 相同，单独记录手册归档计划链接差异，明确本地验证的实际 commit；线上 PR 仍须在最新 head 生成的预合并结果完整验证。

## 证据与备注

基线：ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b。v0.26.0 公开 Release 于 2026-10-08T00:54:14Z 创建，不能再写上一已发布版本 0.25.0。新命令日志保存在/tmp/d261r；仓库只收录精简证据、时间、命令、退出码和输入/日志 hash，不上传用户数据或凭据。

## 接口与依赖

不新增 API、依赖或设置。沿用 scripts/release/release-preflight.mjs、scripts/release/run-clean-checkout-vsix-validation.mjs、现有 npm 脚本和 VSIX 打包入口。主扩展 extensionPack 与 notifier 单向 extensionDependencies 保持同一安装关系；模板市场生产部署独立于插件 SemVer。

2026-10-13 修订：从最新主线新建计划，明确发布范围、默认安装风险与双阶段完整验证，避免复用已舍弃候选。

2026-10-13 修订：本机 Git 不支持 merge-tree --write-tree，采用已验证目标祖先关系与相同 HEAD tree 构造预合并结果，不跳过合并输入验证。

2026-10-13 修订：固定实际准备 head 与预合并 commit，记录默认安装和前置检查通过，完整 verify 尚未完成。

2026-10-14 修订：PR333合入后接续最新预合并完整门禁，登记主线/旧head/备份和ESRCH历史范围，保持静态发布材料与正式验证分离。

2026-10-13 修订：记录完整 verify 首败与未触达范围，定位到远端 setup Host PID 消失前提；继续独立补证，不放宽断言或把首败覆盖为通过。

2026-10-13 修订：记录独立 Webview 全套通过，保留聚合首败，继续干净安装包验证。

2026-10-13 修订：补齐 12 条命令和独立通过结果，将计划按草稿发布准备交付归档；SSH 首败仍阻断正式发布。

2026-10-13修订：登记实际新草稿PR #327，发布准备材料交付完成，正式发布仍受SSH完整门禁阻塞。

2026-10-13修订：PR328合入后接续rebase与最新预合并完整验证，原失败保留，结果关联PR327；本轮不合并或发布。

2026-10-14修订：PR329合入后接续正式PR预合并门禁，保留历史证据和发布授权边界；本轮实际输入与结果统一关联PR327。

2026-10-14修订：登记PR332合入后的最新主线复验，旧Marketplace首败限定历史输入，完整结果关联PR327。

2026-10-15修订：模板导出最终保存夹具修复PR334已正常合入main6e708c6b，用户授权rebase PR327并重跑完整发布门禁。从已核验旧远端head20d237c5重放8个发布提交，保留backup/pr327-before334-20d237c5；技术债文档唯一冲突保留修复与发布历史两段，其余自动重放。正式结果将绑定最终PR head/base/预合并SHA及GitHub检查，在PR327描述与本地无损日志中登记；本轮不新增验证/文档PR，不把旧临时组合031db473成功代证正式输入。待实际完整npm test、SSH两态、Webview426和clean-checkout八场景全部通过前，不合并或发布。
