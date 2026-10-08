# 准备 0.26.0 公开 Preview 发布

本 ExecPlan 按 `docs/PLANS.md` 持续维护。2026-10-08 用户已授权本次先发布、后修四项测试问题，任务范围扩展到合并与发布；下文 2026-10-07 的失败记录保留历史事实。

## 目标与全局图景

将已合入 `origin/main` 的运行时容量、退出完整性和当前状态恢复改造整理为 0.26.0。用户应在升级前理解：健康的持久化会话像 tmux 一样重新附着，直接导入后台持有的终端当前状态、免去累计历史回放，已结束 Runtime 重开只保留轻量终态；本版本仍为 Preview。完成后版本、双扩展 CHANGELOG、英中文 listing、支持文档和发布契约一致，PR 可供评审。

## 进度

- [x] (2026-10-07) 同步 origin/main，从 06e9abcf 创建 release-0-26-0-prep；保留未跟踪 image.png。
- [x] (2026-10-07) 核对 v0.25.0 至 main 的 #292 至 #295 与正式运行时规格，选定 0.26.0。
- [x] (2026-10-07) 同步版本、用户说明、支持边界、发布手册和契约；preflight 与 diff 检查通过。
- [x] (2026-10-07) 提交后执行 preflight、完整 verify 与 notifier 定向检查；完整 verify 和 companion 联动失败，原因与证据见下文。
- [x] (2026-10-08) 用户确认截图差异为基准问题，并授权四项验证问题延后处理，不再作为本版发布阻塞；其他三项根因不追认为已确认。
- [x] (2026-10-07) 再次同步 main、推送并创建草稿 PR #296；GitHub 确认目标 main，Release Preflight 因草稿跳过。
- [ ] 实现仅限 0.26.0 的授权验证范围，验证预合并结果并解除草稿。
- [ ] 更新 PR 与 review 结论，按最新 main rebase 后以 merge commit 合并。
- [ ] 从 main 的合并提交触发 publish/v0.26.0，确认双扩展 GitHub Release assets 与 Open VSX，记录 VSM 实际结果。

## 意外与发现

旧 README 和手册当前说明仍以 0.24.5 为上一版本，而 GitHub latest 已为 v0.25.0。主线已完成新的 Runtime 交付，不能照抄旧发布说明中的全部“验证中”。新结论以运行时有限收尾和当前状态恢复文档为准，旧失败保留在历史记录中。

默认构建需要匹配原生输入的六目标资产，不能使用 stock 对照构建代替正式验证。完整 verify 的 clean-checkout 使用 HEAD，因此必须先提交静态输入再验证。

## 决策记录

- 决策：2026-10-08 用户明确允许先发布新版本、后续修复四项测试问题。截图基准问题是用户确认；其余只是用户判断大概率为测试问题，根因仍待查。仅 0.26.0 的 `release:verify` 改用静态检查、门禁自身回归、类型检查、Markdown/运行时定向回归、notifier source、默认构建和 HEAD 隔离打包（不运行 packaged smoke）；完整 npm test、宿主联动与 Webview 全套延后，不声称完整验收通过。之后版本恢复原有完整门禁，不提供通用 skip 参数。理由：落实本次发布授权且使例外范围可追溯。日期/作者：2026-10-08 / 用户授权，Codex 实施。
- 决策：版本使用 0.26.0。理由：运行时实现与已结束历史语义构成新的用户里程碑，超出同里程碑修补；遵循 `docs/workflows/VERSION.md`。日期/作者：2026-10-07 / Codex。
- 决策：发布契约只记录静态输入；验证过程在本计划和 PR 记录，发布后事实由外部 manifest/Release 保存。理由：遵循 #293 的双阶段验证规则。日期/作者：2026-10-07 / Codex。

## 结果与复盘

静态准备及 CR 完成，四项失败已转为用户接受的本版发布例外，修复仍由技术债追踪。授权范围的实际验证、合并与发布尚待执行；不把授权等同于测试通过。除 markdown-it 14.3.2 外不新增产品实现。

## 上下文与定向

根 `package.json`、`package-lock.json` 与 `extensions/vscode/dev-session-canvas{,-notifier}/package.json` 必须版本一致。两扩展独立打包且保持同版；主扩展 extensionPack 与 notifier 单向 extensionDependencies 不变。`docs/release-contracts/v0.26.0.md` 是本版静态范围入口。产品边界依据 `docs/product-specs/runtime-persistence-modes.md`、`docs/design-docs/runtime-live-state-recovery.md` 与 `docs/design-docs/runtime-persistence-closeout.md`。

## 工作计划

当前剩余里程碑：先在 `scripts/release/release-preflight.mjs` 对精确版本 0.26.0 选择授权检查，测试证明其他版本仍执行完整验证且授权检查失败仍阻断。随后同步发布契约、设计与技术债，提交并用预合并 CI 验证。最后确认 main 未推进，以普通 merge commit 合并 PR #296，从合并提交打 publish tag；等待同 ref 的第二阶段检查与两个渠道发布，发布后证据只写外部 Release/manifest，不回写同版本静态契约。

原始工作计划（2026-10-07，完整验证要求已被本版授权范围覆盖）：第一里程碑同步版本和所有当前用户文案，保留历史 CHANGELOG 与历史发布事实；完成后 preflight 应通过。第二里程碑提交静态输入并运行完整 verify，预期完整测试和隔离 VSIX 验证退出 0；失败时记录准确命令与原因，不降级门禁。第三里程碑在最新 main 上准备预合并结果、创建 PR 并核对 CI，不执行实际发布。

## 具体步骤

在仓库根目录执行；原生资产按 `CONTRIBUTING.md` 装配，并通过 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET` 绝对路径传给验证。

    npm run release:preflight -- --version 0.26.0
    npm run release:verify -- --version 0.26.0
    npm run typecheck:notifier
    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke
    git diff --check

推送前 `git fetch origin`、`git rebase origin/main`；目标分支推进则重做受影响验证。PR 以 `main` 为目标，描述包含范围、验证与剩余限制。

## 验证与验收

静态检查必须证明三份 manifest、lockfile 与双 CHANGELOG 一致，并存在完整契约。授权范围验证必须在提交后的输入上实际执行；PR 的 Release Preflight 使用预合并 ref，再构建同 ref 六目标资产并运行相同命令。运行时既有跨平台证据仅支持其声明路径，不能由本次通过扩大为旧操作系统、任意并发或性能 SLA。

## 幂等性与恢复

文案、静态检查与完整测试可重试。不得覆盖未跟踪 image.png，不创建 publish tag。原生资产只复用输入校验通过的集合；失败日志留在仓库忽略目录。若 PR 验证失败，保持未合并，修正明确原因并重新验证。

## 证据与备注

    起始 origin/main: 06e9abcf
    GitHub latest release: v0.25.0 (2026-09-16)
    发布准备分支: release-0-26-0-prep

## 接口与依赖

不新增产品接口或依赖。继续使用 `scripts/release/release-preflight.mjs`、`scripts/release/run-clean-checkout-vsix-validation.mjs` 和 `.github/workflows/release-preflight.yml`；Node 22 为 CI 基线。主扩展运行时依赖六目标原生资产，notifier 行为保持现有协议。

修订记录：2026-10-07，创建计划，记录版本选择、发布范围与验证路径。

修订记录：2026-10-07，静态输入完成；复用 run 37577646133 的六目标原生资产，聚合与当前源码默认 build 校验通过。完整验证尚待运行。

修订记录：2026-10-07，首次完整 verify 停在 marketplace VS Code E2E 启动，Unix socket 深路径触发 listen EINVAL，并非业务断言。下一轮使用短路径临时 checkout 与 Node 22.23.3；不跳过用例。notifier typecheck/source 已通过。生产 audit 首次为 2 low / 1 moderate，markdown-it 升级至 14.3.2，KaTeX 无修复公告与前提边界登记技术债；后续复核实际 audit 与 Note 回归。

修订记录：2026-10-07，markdown-it 链接、checklist、front matter 回归与 notifier typecheck/source 通过；生产 audit 为 2 low，全依赖为 2 low / 3 moderate / 14 high，开发链风险已登记。完整 verify 正在短路径隔离 checkout 使用 Node 22.23.3 执行，预合并 CI 尚待创建 PR 后核对。

## 2026-10-07 验证记录

发布输入为提交 `9dcd955d`；短路径 `/tmp/dsc026v` 从此提交独立 clone、Node 22.23.3 `npm ci`。六目标资产来自同一 run 37577646133，经聚合、source/hash 校验与默认构建成功，不使用 stock profile。

通过项：preflight、diff 检查、主扩展默认 build/typecheck、Marketplace shared/API/Web 单元与浏览器 E2E、notifier typecheck/source、英中文真实宿主 locale smoke、notifier 14-file VSIX 打包、Markdown links/checklist/front matter、manifest、current-state 19/19 和 completed snapshot resize 16/16。

完整 verify 首次在深路径 VS Code Unix socket listen EINVAL 停止。短路径重跑已进入真实 Marketplace 页面，显示两条模板及英文 Install / Switch install version，但测试第 48 行仍期待中文按钮，等待超时，完整命令 exit 1，后续 npm test 阶段及自动 clean-checkout 未执行。独立 notifier companion 在第 103 行等待 posted diagnostic 超时，先前有 runtime 最终 snapshot 责任占位错误；日志只能证明同时出现，尚不能确认因果。两项均登记为发布前阻塞，不使用 locale 或打包通过代证。

本机完整日志：`/tmp/dsc-release-026-verify.log`（深路径首败）、`/tmp/dsc026-verify-short.log`（短路径失败）、`/tmp/dsc026-notifier.log`（联动失败）、`/tmp/dsc026-notifier-locale.log`、`/tmp/dsc026-notifier-package.log`。独立 clean-checkout 与 Webview 结果已回收，见下段。

修订记录：2026-10-07，记录具名失败并改为草稿交付；保留严格门禁，不将未完成测试视为通过，不混入未经确认的运行时代码修复。

最终补充：主扩展默认 VSIX 打包通过（140 files），notifier 14-file VSIX 通过，包内版本/publisher/NLS/l10n/extensionPack/extensionDependencies 已独立读取核对。Node 22 隔离 clean-checkout 的 npm ci 与主扩展打包成功，packaged smoke 在 `extension-tests.cjs:2619` 的 `verifyCreateNodeCommandQuickPick` 等待诊断事件超时，命令 exit 1；不能把可打包等同于可发布。失败临时目录 `/tmp/dev-session-canvas-clean-checkout-aTsd2n` 保留，日志 `/tmp/dsc026-clean-vsix.log`。

Webview 全套首项截图稳定差异 8020 pixels；保留失败后主动中止长矩阵，结果 31 passed / 1 failed / 1 interrupted / 349 did not run，exit 130。定向基准截图复跑仍失败，差异位于 Agent/Terminal 标签及控制区，不更新截图掩盖结果。Markdown task lists / syntax highlighting / math formulas 定向浏览器回归 1 passed，使用缓存浏览器避开重复下载；这不代证完整 Webview suite。日志及基准截图工件已复制到仓库忽略目录 `.debug/release-0-26-0/`。

交付为草稿 PR https://github.com/ZY-WANG-0304/dev-session-canvas/pull/296 ，基线仍为 origin/main 06e9abcf。静态物料和依赖补丁已提交，四项验证阻塞仍待处理，不宣称发布准备已达到合并/发布门槛。未创建发布 tag、未修改外部 Release/Marketplace；原未跟踪 image.png 保留。草稿的预合并检查为 skipped，不能视为通过；解除草稿时必须对最新预合并 ref 重跑完整 verify。

修订记录：2026-10-07，回收最终打包与失败检查结果，记录草稿 PR 和后续门槛；不归档仍有发布阻塞的计划。

## 2026-10-08 发布亮点口径修正

用户指出“恢复滚动历史，再接续输出”没有表达最终重构方案。重新核对 `runtime-live-state-recovery.md` 正式方案及 Supervisor `captureCurrentState()`、Webview `TerminalPagedProjection` 导入路径后，将用户亮点统一为类似 tmux 的重新附着：后台持续持有原进程和终端当前模型，新页面直接导入该状态，不逐条回放累计历史。配置内 scrollback 是当前状态的一部分；从同一 revision 接续增量仍是实现保证，不作为分阶段历史恢复来宣传。沿用 xterm，不新增 tmux 依赖，也不许诺零延迟或与当前模型大小无关的耗时。

这次只修正文案，与已选定设计一致，不修改运行时代码或历史版本说明。同步英中文 README/listing、主 CHANGELOG、本版发布契约、支持说明、发布手册与设计口径。既有四项发布验证阻塞继续有效，本次静态复核不代替完整门禁。

验证：`npm run release:preflight -- --version 0.26.0`、`git diff --check` 与英中文亮点一致性/历史 CHANGELOG 不变检查通过；仅文案修改，未重跑完整运行时测试。

原工作树提交仍因 `.git` 只读、无法创建 `index.lock` 而受限。用户要求同步 PR #296 后，已重新 fetch 并核对远端 main 仍为 06e9abcf、PR 分支无新增提交；本次使用 `/tmp` 隔离检出提交文案修正并同步至原草稿 PR，原工作区文件保留。

修订记录：2026-10-08，依据用户更正突出直接状态导入和免历史回放的收益，消除旧亮点的歧义。

修订记录：2026-10-08，依据用户先发布后修测试的明确授权，更新本版验证范围和合并发布计划。门禁回归已验证 0.26.0 的范围、保留检查失败仍阻断以及 0.26.1 恢复完整路径；preflight、workflow 回归与 diff 检查通过。实际授权范围验证及发布待执行。
