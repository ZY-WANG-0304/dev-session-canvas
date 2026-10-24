---
title: 从最新主线重新准备 0.26.1
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-0-26-1-refresh.md]
updated_at: 2026-10-25
---

# 从最新主线重新准备 0.26.1

## 背景与取舍

用户舍弃 PR #313 并要求从最新 origin/main 重新准备 0.26.1。2026-10-13 fetch 后基线为 ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b，包含 PR #314/#316/#319 以及#321/#323/#324/#325。旧候选遗漏后续能力且记录过期失败，不予 rebase 或复用；另开 release-0-26-1-refresh。

2026-10-13 初次准备时，主线评估 PR #326 尚未合并，不作为当时发布基线。本分支只按主线已有证据修正共享设计与产品规格中“接管尚未实现”的旧描述，保留有限验收边界；不合入该 PR 全部报告，也不将它的测试当成本版完整验证。v0.26.0 已于 2026-10-08 发布，README/手册的上一已发布版本同步更正。

## 正式方案

根与双扩展 manifest、lock 同步为 0.26.1；双 CHANGELOG、中英文 listing/README、两份手册、support 和 docs/release-contracts/v0.26.1.md 构成静态发布输入。内容覆盖主线已完成的执行可靠性和共享 root 画布，不新增产品实现、设置、依赖或模板市场生产部署。共享/私有模式、最后窗口清理接管和普通关闭保留语义按 runtime-shared-root-canvas-sync.md 与 runtime-persistence-modes.md 表达；执行修复以 smoke-reload-autostart-investigation.md 和 terminal-mouse-input-diagnostics.md 为依据。

当前门禁沿用 `docs/WORKFLOW.md` 与 [CI 与发布门禁重设计](release-gate-redesign.md)。`scripts/release/release-preflight.mjs` 只做版本、双 CHANGELOG 和静态契约检查。正式发布 PR 由 `.github/workflows/release-preflight.yml` 固定最新 base/head 的真实预合并 SHA，`scripts/gates/resolve-plan.mjs` 根据版本与唯一契约将模式升级为完整 `release-pr`；`.github/workflows/ci-validation.yml` 按 `scripts/gates/catalog.mjs` 冻结全部必跑任务、环境和预算。

任务图覆盖全部登记回归、Webview 功能 / 视觉、Marketplace 浏览器 / Host、六目标原生加载与操作、全部标准 source-host / packaged-host、notifier companion / locale，以及三平台 x64 原样双包安装。`package-clean` 用干净源码和锁定依赖生成一批 main / notifier VSIX；后续 packaged、安装和交付只消费原双包。`scripts/gates/verify-result.mjs` 汇总精确任务与产物身份，`scripts/gates/check-acceptance.mjs` 再独立核对实际 Actions job / 工件来源，稳定检查 `Verify release contract` 成功后才满足 PR 的正式验证门槛。缺结果、取消、错输入和取证 / 清理失败不放行。

本地 `npm run release:verify -- --version 0.26.1` 已映射到 `scripts/gates/run-local.mjs --mode release-pr`。它冻结已提交输入、建立隔离 checkout 并运行同一任务图，但输出 `acceptance: false`；本机缺少的外平台明确记 `not-run`。局部成功或本地完整结果都不能替代 Actions 正式验收，旧串行 `npm test` / 八场景重打包不是现行发布验收定义。

环境随冻结输入的 `environmentPolicy` 确定，当前 gate Node 为 22.23.3、VS Code 为 1.142.0，视觉基线使用固定 Ubuntu 22.04 与 lockfile Chromium。缓存复用仍须校验来源，不能称为冷安装。既有断言、预算与产品支持范围不因文档修正改变。

PR 合入后，最终 `publish/v0.26.1` 的 SHA 必须以 `release-tag` 独立完整验收。验证阶段生成候选包；发布 prepare 只消费已验收原双包，之后才创建正式 Release 和写渠道。渠道恢复复核原 acceptance、双包与连通状态链，不重打包。合并、tag 和发布依原授权边界执行。

## 当前接续状态（2026-10-25）

PR335 的分层门禁和 PR336 的恢复订阅 / 模式切换修复已合入 main；基线为 PR336 merge `37ff8554b0fb71d4c5cd6d574baaffcabb4d47a6`。PR327 已由旧 head `656b991d` rebase 为 `c0046aad`，没有相对主线增加产品、测试或 workflow。PR336 最新复审已关闭原两项生产 blocker，其 run40107994873 的 269 个 job 全部成功；这些只证明 PR336 的输入，不代证本发布 PR。

本次修正契约、双手册、readiness、设计和执行计划中的旧门禁 / 命令说明。PR327 在 rebase 后的 run40113684471 因 draft 全部 skipped，正式最新预合并输入仍未验收。文档更新后的新 head 须重新生成正式输入并通过完整任务图和最终复审；本节所列历史 head 不是后续输入的固定替代。非阻塞边界与未配置 main 保护的流程缺口见 `docs/exec-plans/tech-debt-tracker.md`。

## 历史验证输入（PR333 合入后，2026-10-14）

本节保留当时的串行门禁和运行记录；后续执行以上文正式方案为准。

PR #328、集中修复 PR #329、Marketplace 门禁修复 PR #332 与本地后代 ESRCH 修复 PR #333 均已合入。2026-10-14 fetch 后 main 为 `eee25291109e7e3bad27e6841520f3f4a5d14dcc`（PR333 merge commit）；发布分支从原远端 head `cfe1ab40e121bc31689f474e2e6f7cbb9bad4f48` rebase 到该主线，无冲突。原远端 head 保留在本地 backup/pr327-before-pr333-rebase。发布 PR 相对 main 不增加产品实现、测试或 workflow 修改。

主线已包含 SSH 退出/保留双状态门禁、自有 socket 夹具、诊断等待末次观察、fake systemd 前置 probe、fallback 短 IPC 路径，以及 Linux 截图字体/发布验证 OS 依赖修复。原因与集中验证见 `remote-host-exit-investigation.md` 和 `systemd-smoke-scope-root-cause.md`；组合 run38426726365 的完整通过仅证明其记录的旧输入，不能代替本次正式 PR 门禁。

上一正式run38485499547在历史预合并217fd693的Marketplace发布成功提示断言失败，后续source smoke/SSH/Webview/clean-checkout未触达。PR332已将首次与版本发布等待改为原单个20秒预算内同时确认唯一请求和原准确成功提示，真实VSCode1.141.1自然/响应延迟对照及20项回归通过；根因边界见 `marketplace-publish-smoke-completion.md`。本轮必须重新完整验证，不以单项修复通过代证发布门禁。

PR332合入后的正式run38539427680在预合并b0198184的SSH exit本地后代SIGKILL处报ESRCH，setup已ready、根Electron实际SIGKILL，后续SSH业务/Webview/clean-checkout未完成。PR333确认并修复后代身份检查与发信号间退出回收竞态，只允许ESRCH后复查原身份不再运行才继续，其他错误与最终退出检查保持；默认39项回归、实际内核与原生exit/retain通过。根因和验收见`smoke-local-client-exit-root-cause.md`，具体首败后代角色/退出触发原因仍未知。该单项验收不代证本轮完整发布门禁。

本次使用正式 `Release Preflight` workflow：PR #327 转为非草稿后，由最新 head 与 main 生成预合并 commit；先固定该 SHA，再为六个平台构建同输入资产，最后在 ubuntu-22.04 执行默认 npm ci、浏览器准备与完整 `release:verify`。verify 内部先执行静态 preflight，随后运行发布回归、未过滤的完整 npm test 和 clean-checkout VSIX 八场景 smoke。最新 head/base/预合并 SHA、run 与最终结果统一关联 PR #327 描述和 checks，不另建验证或文档 PR。成功前仍禁止合并；合并、tag 和发布需后续授权。

下文历史失败保留原输入含义，不能作为当前卡点；版本、CHANGELOG 和发布契约保持静态产品范围，不回写门禁或发布后事实。

## 历史验证状态（PR328合入前）

已提交准备 head `e123d1e73214fc0f79fc0bba508447331d3f7b49`，基准为 `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`；验证的临时预合并 commit 为 `eba53a28074cbcc49958f7845ebe5b04411a531a`。基准是准备 head 的祖先，合并树等于该 head tree；旧 Git 不支持 merge-tree --write-tree，采用 commit-tree 明确指定两个父提交。

默认依赖安装、浏览器前置、预合并 preflight、notifier typecheck 和独立 notifier VSIX 打包均 exit0。完整 `release:verify` 从 03:05:07Z 至 03:22:32Z，exit1，停在完整 npm test 的 localhost SSH real-reopen；后续 Webview 和 clean-checkout 没有由该聚合命令运行。独立补充这些项的结果另记，不能拼接追认为聚合通过。

首败前 Marketplace 浏览器/真实宿主、纯逻辑回归、七项本地 smoke、checkpoint、trusted/restricted、旧 Supervisor 升级（含 resize）、普通/多 root/单转多 root 重开、共享双窗口、受控 systemd/fallback 均通过。失败时 editor generation5 已 ready/bootstrapAck；Agent 与普通 Terminal 用原会话重新附着并收到预期正文，仅第三个用于检查离线完成的 Terminal 仍为 live、原 sessionId 尚在，最终退出条件未满足。`tests/vscode-smoke/real-reopen-tests.cjs:148` 的命令等待 setup Host 的 `process.pid` 不再存在后才输出终态并 exit，本次等待 PID2613433。

原 remoteexthost.log 显示 setup Host 于 03:21:40 完成 flush 后，在 03:21:50 仍处理共享 TreeView refresh；verify 新 Host PID2632892 于 03:21:48 启动。remoteagent.log 设置重连宽限 10800000ms（三小时），setup Host 没有退出记录，旧 management 连接于 03:22:10 断开仍明确保留三小时。现有 fixture 把窗口关闭等同远端 Host PID 消失的前提在此不成立。首败超时瞬间未采集原 PID 的进程状态，不排除 zombie/PID 复用，也不把日志缺少退出单独写为所有时刻存活。原失配与进程/重连证据见 `docs/references/release-0-26-1-refresh/remote-first-failure.json`。此前同主线通过样本 `/tmp/dmr13` 明确收到 renderer terminate，于 02:26:03Z 退出 setup Host，再启动 verify；本次没有同样的关闭消息/退出边界。该对照说明窗口退出结果有差异，不能仅以配置三小时宽限反推所有重开必失败。为什么本次 terminate 未到达仍未确认。

这次失败不能归为 resize、ready 或已结束历史丢失的确定产品根因；普通打开保持空白的既有边界仍独立保留。

独立 Webview 从 03:23:54Z 至 03:35:56Z，exit0，426/426 通过（12.0 分钟），没有重试、改断言或更新截图。独立 clean-checkout 从 03:35:56Z 至 03:42:06Z，exit0：新目录 `/tmp/dev-session-canvas-clean-checkout-bOm8xh/repo` 的默认 npm ci、140 文件主 VSIX 及全部八个安装场景（含完整 trusted）通过，ETXTBSY 未重现；没有设置 foreground_scripts、场景过滤或跳过 smoke。notifier companion 及 en/zh-cn locale 随后均 exit0。

此前主线默认独立 npm ci 曾在 Wrangler/esbuild 自校验报告 ETXTBSY；只加 npm_config_foreground_scripts=true 的新一次验证通过，具体写者未确认。本版两次工作树和一次独立 checkout 的默认安装均通过，不代表原具体写者已确认或原首败被修复；不能跳过脚本或将前台对照作为自动豁免。

## 剩余边界与发布门槛

上游连续重开 Webview 资源积压、单次 fallback ready 首败未定因，以及普通 Canvas 持续启动失败缺少超时反馈/自动重建，按 webview-ready-root-cause.md 和 smoke-reopen-ready-timeout.md 保留。45 秒只属于 smoke 预算，既有输入/resize/身份验收不放宽。

共享画布真实 UI 限 Linux 单 root，分阶段接管有受控 Host/store 与独立 Supervisor 证据；其他平台、真实 provider、多 root 接管 UI、公开市场自动安装依赖和桌面点击均不由本机 fixture 通过自动扩展。Supervisor/机器故障及跨版本回退无保证。

完成发布准备验收需要静态文档一致、最新主线祖先关系、该次真实 PR 预合并输入的完整 Actions acceptance 与最终 head 复审。draft skipped、本地 `acceptance: false`、历史组合或单项通过均不足以放行。main 尚无强制保护，仍须人工遵守上述门槛；最终发布只在合入后的 main SHA 上另行验收和执行。

## 历史证据与交付状态（PR328合入前）

证据入口 `docs/references/release-0-26-1-refresh/evidence.json` 固定 12 条命令的 UTC 起止、环境、exit 与日志 hash。`inputs.json` 记录 613 个产品/测试/静态发布输入；后续只修改过程与证据文档，逐文件核对产品/版本/CHANGELOG/契约/listing/测试输入相同；public 手册只有计划路径从 active 改为 completed。该单一过程链接差异和其余 612 个输入一致由 post-validation-input-comparison.json 记录，不声称最终新 head 通过完整 verify。`remote-first-failure.json` 保留失配、原身份、日志片段和此前同主线关闭成功的对照。六目标资产、原生输入、打包文件、语言/依赖和手动文案核对另有具名记录。

本地主 VSIX 为 6000207 bytes、140 文件；notifier 为 160414 bytes、14 文件，均保留 0.26.1、Preview、安装依赖和中文资源。它们仅为准备验证包，hash 见相应 artifact JSON，不是正式 Release 资产。完整原日志在/tmp/d261r，首败工件和隔离 checkout 保留；自己创建的浏览器 cache 链接在测试结束后移除，不删除共享缓存。

最终再次 fetch 确认 origin/main 仍为 ea0c9b19，准备分支保留其祖先关系。交付为新草稿发布准备 PR：静态输入已完成，独立 Webview/安装包/notifier 均通过，但完整 verify 的 SSH 首败仍阻断。后续应单独修复或确认远端关闭前提，再在最新 PR 预合并结果重跑完整 release:verify；未通过不得合并/发布。没有操作 PR #326、目标分支或任何 release tag。

本次交付：[草稿PR #327](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/327)，分支release-0-26-1-refresh，目标main。PR保持draft，非草稿release workflow不会启动；完整verify失败的阻塞没有撤销。

2026-10-13修订：PR328已合入，发布分支追赶最新main；正式双状态门禁进入本版新预合并验证，历史首败保留，最新结果与实际输入在PR327关联。

2026-10-14修订：PR329已合入，PR327按最新main rebase，正式非草稿PR预合并门禁的结果以PR327最新checks为准；历史失败不覆盖新输入结果。

2026-10-14接续：PR332合入main f3bb4425后重新rebase，正式最新PR预合并门禁结果继续绑定PR327实际head/base/input/checks；原Marketplace首败保留历史含义。

## 历史 PR334 合入后的正式发布输入复验（2026-10-15）

PR334已正常合入main6e708c6b，模板导出后的具名cleanup复用原最终保存reset helper；28项回归、原生pending窗口及临时组合完整通过为修复证据。PR327从旧head20d237c5 rebase到该主线，静态发布范围、版本与依赖不变，未引入额外测试/产品/workflow修改。正式门禁须由本次最新PR预合并输入生成同run六平台资产并运行无过滤release:verify；结果以PR327最新head/base/预合并SHA/run/checks为准，旧run38579057915与修复组合run38656127632均保留原范围。本次未授权合并、tag或发布。
