# 从最新主线重新准备 0.26.1

本 ExecPlan 按 `docs/PLANS.md` 持续维护。发布准备交付可 review 的版本、用户说明和验证证据；对外发布、打 tag 和合并 PR 需另行授权。

## 目标与全局图景

用户可以通过新的 0.26.1 包获得主线已完成的启动、输入删除、终端交互和共享 root 画布修复。最初舍弃 PR #313 后重建的材料已作为草稿 PR #327 交付，本计划保留该准备阶段的归档与证据。2026-10-25 接续范围是修正文档验收口径，使维护者可按已合入的分层门禁推进；不是宣布最终发布验收完成。原历史运行与失败均保留，当前操作按下文更新后的上下文、步骤和验收执行。

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

- [x] (2026-10-25) 核对 PR335 门禁、PR336 修复及 PR327 rebase，识别契约 / 手册 / 设计 / 计划的旧门禁和已废弃发布参数。
- [x] (2026-10-25) 对齐完整任务图、同批双包、独立 Actions acceptance、本地不签发回执与渠道恢复入口，历史段落明确范围。
- [x] (2026-10-25) 完成文档一致性核对、静态 preflight、现有发布回归和两个 CLI 帮助检查，形成可提交的文档修复。

## 意外与发现

2026-10-25 核查发现：静态 preflight 可通过，但发布契约仍把本地 `release:verify` 描述为旧 `runFullVerification`，双手册还使用当前 CLI 已拒绝的 `--package-only` / `--skip-package` / `--extension notifier`。现行 `package.json` 映射到 `scripts/gates/run-local.mjs --mode release-pr`，输出 `acceptance: false`；正式验收依赖真实 Actions 来源。文档必须跟随已实施的执行契约，不能仅凭命令同名或 preflight 绿色判断一致。

以下两段为 2026-10-13 初次准备时的发现，保留当时上下文：

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

- 决策：本次在 PR327 对齐既有门禁与恢复入口，不改产品、测试、workflow 或支持范围。
  理由：PR335 已替换验证 / 发布编排；旧用户手册与契约会误导执行。历史首败只描述其原输入，当前正式验收必须独立取得。
  日期/作者：2026-10-25 / Codex。

## 历史 PR328 合入后的接续验证

2026-10-13用户要求rebase PR327并重跑发布门禁。已确认PR328合入main22803dd8，保留发布分支原head7b2440d4，在原发布工作树完成rebase，文档冲突保留两边新增条目。本轮生成新的临时预合并，在短路径checkout使用实际npm ci、同源原生资产和匹配Chromium缓存运行完整preflight/verify。任何新失败使用独立日志，保留旧首败；最新结果在PR327描述与checks中关联真实head/base/预合并SHA，不将旧独立通过拼接成新结果。本计划先前收口的发布准备交付不变，合并、tag及对外发布仍需后续授权。

## 历史 PR329 合入后的正式门禁

2026-10-14用户要求rebase PR327并运行门禁。已确认PR329正常合入，fetch得到main72338331；保留原远端发布head42d87b3d和本地备份引用，五个发布提交已rebase，冲突仅为索引/技术债，两边材料均保留。原工作区未提交的WORKFLOW修改未参与本轮。

本轮在同一发布PR同步历史状态，再以固定旧远端head的force-with-lease更新分支。转为非草稿是正式Release Preflight创建检查的前提，不代表授权合并。workflow固定最新PR预合并SHA，为六个平台生成同源资产，并运行原完整release:verify（包含静态preflight、未过滤npm test与独立clean-checkout VSIX八场景）。实际head/base/预合并/run和结果在PR327描述/checks记录；组合38426726365的旧输入通过不代证本轮。未完成正式门禁及review前不得合并；本轮不打tag或发布，也不另建验证/文档PR。

## 历史 PR332 合入后的正式完整复验

2026-10-14用户要求继续rebase并重跑完整发布门禁。fetch确认PR332合入main f3bb4425，保留远端旧发布head a95b69b0和本地备份引用，六个发布提交rebase完成；设计原则与技术债冲突保留两边内容，产品/测试/workflow与最新主线相同。

历史正式run38485499547在Marketplace版本发布成功提示断言失败，后续未触达。PR332修正原预算内完成反馈等待并保留准确断言，单项和真实1.141.1对照已有证据。本轮按正式非草稿PR流程固定最新预合并SHA，重新构建六平台同输入资产、默认npm ci、完整release:verify；实际输入/结果在PR327描述和checks绑定，失败保留首败，成功也不代替最终tag验证。本轮不合并、打tag或发布。

## 历史 PR333 合入后的正式完整复验

2026-10-14用户要求rebase #327并重跑完整门禁。fetch确认PR333正常合入，main eee25291109e7e3bad27e6841520f3f4a5d14dcc；保留原发布head cfe1ab40和本地backup/pr327-before-pr333-rebase，七个发布提交rebase无冲突，发布PR不新增产品/测试/workflow修改。

历史正式run38539427680在SSH exit本地后代SIGKILL的ESRCH失败，根已实际SIGKILL，SSH业务及Webview/clean-checkout未触达。PR333已限定后代ESRCH复查不再运行才能继续，保留异常和最终退出检查，39项/实际内核/原生exit-retain定向通过。本轮保持完整未过滤release:verify，在最新PR预合并输入重新构建六平台资产并默认npm ci/浏览器准备；实际head/base/input/run与结果在PR327描述和checks登记。单项/历史输入通过不代证新完整验证，原首败保留。转为非草稿只用于门禁，不授权合并/tag/发布。

## 历史结果与复盘（PR328合入前）

本次静态输入已完成。预合并默认安装和 preflight 通过，完整 verify 在 localhost SSH 离线完成条件失败；独立 Webview426/426、干净安装包八场景、notifier 类型/联动/语言/包均通过。发布准备以草稿 PR 交付，完整门禁未通过仍禁止合并/发布。原首败保留并登记技术债；此次计划收口的是重新准备与可 review 材料，实际发布并未完成。后续结果写入本计划和正式发布准备设计记录，禁止将候选 commit、工件 hash 或测试状态放进 CHANGELOG/发布契约。

## 结果与复盘

契约、双手册、发布设计 / readiness 和本计划已改为现行发布任务图、同批双包与渠道恢复说明；Linux / Node 22.23.3 下，`release:preflight -- --version 0.26.1`、`test:release-preflight`、`test:release-preflight-workflow` 均 exit0；`release:verify -- --help` 与 `release:publish-tag -- --help` 确认当前入口并 exit0。人工核对 workflow_dispatch 的 trigger_tag / target、phase、任务目录与文案一致，63 个相对链接的文件目标和契约文档路径均存在，`git diff --check` 通过。仅修改 10 份文档，原始 references、产品、版本、CHANGELOG、测试和 workflow 均未修改。PR336 的生产竞态已修复并经其输入独立验收，PR327 最新正式输入仍须另验。文档修复、本地检查和发布验收是不同完成条件；非阻塞平台 / 真实宿主边界及 main 未配置保护已登记在 `docs/exec-plans/tech-debt-tracker.md`。

## 上下文与定向

根 `package.json` 管理工作区；主扩展与 notifier 位于 `extensions/vscode/dev-session-canvas` 和 `extensions/vscode/dev-session-canvas-notifier`。根 / 双扩展 manifest、lock 和双 CHANGELOG 保持 0.26.1。`scripts/release/release-preflight.mjs` 检查静态输入；`docs/release-contracts/v0.26.1.md` 写验证范围，不写候选 SHA 或运行状态。

PR335 的任务图与 PR336 的恢复订阅 / 模式切换修复已进入 main，当前 rebase 基线是 `37ff8554`，PR327 相对主线只保留发布材料。冻结计划是 `scripts/gates/resolve-plan.mjs` 从确定输入生成的必跑任务、环境、预算和产物身份清单；消费者不能删减。发布 PR 由 `.github/workflows/release-preflight.yml` 固定最新 base/head 的真实预合并 SHA，调用 `.github/workflows/ci-validation.yml` 完整 `release-pr`；正式 tag 经 `release-validation.yml` 在 main 上的最终 SHA 独立调用完整 `release-tag`。

全部登记回归、Webview / Marketplace、六目标原生加载与操作、标准 source-host / packaged-host、notifier companion / locale 和三平台 x64 原样安装均进入发布图。`package-clean` 使用干净源码和锁定依赖生成同批 main / notifier VSIX，后续场景及交付只消费原双包。`verify-result.mjs` 汇总任务 / 产物，`check-acceptance.mjs` 独立核实际 Actions job / 工件来源；通过后得到正式 acceptance，即绑定精确输入与完整验收结果的回执。

本地 `release:verify` 调用 `scripts/gates/run-local.mjs --mode release-pr`，自动冻结已提交输入并建立隔离 checkout，只输出 `acceptance: false`。外平台不可用记为 `not-run`，不能代证正式回执。真实 TUI、最低宿主、arm64 原样安装、真实 systemd / 通知 / 市场自动依赖和多 root GUI 仍按现有设计限制管理。

## 工作计划

文档修复里程碑：先把契约、双手册、`release-0-26-1-refresh.md`、`public-marketplace-release-readiness.md` 的当前说明对齐上述实现；同步设计索引、核心原则和本计划，将历史输入与命令明确为历史范围。手册当前发布入口使用 tag workflow，渠道恢复使用 workflow_dispatch 的原 trigger_tag / target；不再列出已移除的手工打包 / 单扩展重发参数。

验证与交付里程碑：在 PR327 的独立工作树核对静态文档、当前 CLI 和 workflow 接线，执行 preflight 及现有回归，确认变更仅为文档。提交后再次 fetch / rebase，再推送同一 PR 并更新修复说明。本轮保持 draft，不把验证计划写成已通过。

最终发布验收是后续独立门槛：静态输入收口后，从最新目标与 head 生成真实预合并输入，转 ready 运行完整 Actions 任务图，要求独立 acceptance 与稳定检查成功并复审最终 head；此前不得合并。获得发布授权后，最终 main tag 仍需独立验收，prepare 只交付已验原双包。

## 具体步骤

所有命令在 PR327 的工作树根目录运行。先用 `git status --short` 排除无关修改，`git fetch origin` 后核对 `git merge-base --is-ancestor origin/main HEAD`；落后时执行 `git rebase origin/main` 并保留最新主线与发布历史。

文档修改完成后运行：

    npm run release:preflight -- --version 0.26.1
    npm run test:release-preflight
    npm run test:release-preflight-workflow
    git diff --check

预期静态输入检查与两项回归 exit0；人工核对双手册的 workflow_dispatch 参数、当前发布 CLI、任务目录和所有新增文档链接。现有回归不验证全部文案语义，因此仍需逐段复核。只暂存文档，按 `docs/workflows/COMMIT.md` 提交。推送前再次 fetch 并 rebase；若改写了 PR 历史，使用固定原远端 SHA 的 force-with-lease，不能覆盖他人新 head。

需要本地补充产品观察时，使用 `scripts/gates/catalog.mjs` 固定的 Node（当前 22.23.3），在已提交输入运行 `npm run release:verify -- --version 0.26.1`。它自动建立隔离 checkout、默认使用新的源码树外证据目录；显式 `--output` 也必须指向源码树外的新空目录。不要沿用历史共享资产 / 场景 filter 来减少正式任务。本地结果仍为 `acceptance: false`，本轮文档修复不执行这个完整入口。

后续正式验收先 fetch / rebase 并提交全部静态输入，推送后用 `gh pr ready 327` 转为非草稿，观察新 `Release Preflight` 的完整任务与 `Verify release contract`。检查必须对应最新 head/base/预合并 SHA；若任一输入更新，重新验收。main 尚未配置保护，不能依赖 GitHub 的 clean / mergeable 状态替代该检查。

## 验证与验收

本轮文档修复完成条件是：版本 / CHANGELOG 产品范围未改变，契约和手册不再把本地结果当作正式验收；验证阶段构建、消费式产物检查、交付不重打包和合法恢复的边界与实现一致；当前入口参数可核对；历史首败、日志摘要和旧输入证据不被改写为成功；上述静态检查 / 回归通过。

发布准备的正式验收条件仍是最新主线祖先关系、最新真实预合并输入的全部必跑任务与独立 acceptance 成功、最终 head 复审通过。取消、缺结果、错误输入、取证 / 清理失败或 draft skipped 都不能放行。跨平台有限操作、staged callback 与 locale 不扩张为全平台产品、真实桌面点击或公开市场自动安装承诺。

## 幂等性与恢复

保留其他工作树与旧首败证据。安装/测试失败按不同名字记录新运行，绝不覆盖首败日志；不删未知资源换取通过。版本修改可在本分支恢复；无需碰 main 或旧 PR。若预合并验证后只新增证据文档，核对产品/测试/版本/用户发布输入 hash 相同，单独记录手册归档计划链接差异，明确本地验证的实际 commit；线上 PR 仍须在最新 head 生成的预合并结果完整验证。

## 证据与备注

本次文档修复的 5 条命令、UTC 起止、退出码与日志 SHA256 保存在 `/tmp/pr327-doc-gate-alignment/validation.json`；相对链接目标、契约路径和原始历史证据检查摘要在同目录 `manual-checks.json`。复用已有依赖，没有执行完整本地任务图、GUI、正式 Actions 验收、合并或发布。

以下为初次准备的历史证据；当前接续输入与结果见本计划进度、发布设计及 PR327。

基线：ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b。v0.26.0 公开 Release 于 2026-10-08T00:54:14Z 创建，不能再写上一已发布版本 0.25.0。新命令日志保存在/tmp/d261r；仓库只收录精简证据、时间、命令、退出码和输入/日志 hash，不上传用户数据或凭据。

## 接口与依赖

不新增 API、依赖或设置。沿用 `scripts/release/release-preflight.mjs` 静态入口、`scripts/gates/` 任务目录 / 执行 / 独立验收，以及 `scripts/release/publish-tag-release.mjs` 和 `publish-marketplaces.mjs` 的已验原包交付接口。主扩展 extensionPack 与 notifier 单向 extensionDependencies 保持同一安装关系；模板市场生产部署独立于插件 SemVer。

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

2026-10-25 修订：按 PR335 已实施门禁与 PR336 合入状态更新当前执行说明，修复静态契约 / 双手册 / 设计的旧验收和发布参数；历史输入保留，文档修复不代证最终 PR327 正式验收。
