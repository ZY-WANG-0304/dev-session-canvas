# 恢复 0.26.1 发布准备

本 ExecPlan 按 `docs/PLANS.md` 持续维护，记录发布输入、验证事实与未完成项。

## 目标与全局图景

在 PR #310 合入后，将最新 main 上的运行时及终端链接修复整理为 0.26.1 公开 Preview 的静态发布输入。用户可从双扩展版本、CHANGELOG 和英中文安装说明理解升级变化；发布准备必须以真实完整门禁结果接受审查。本轮只交付准备 PR，不合并、不创建发布 tag、不投递发布渠道。

## 进度

- [x] (2026-10-09) 确认 PR #310 已合并为 `f6b65580520ee24bbac69a987496931e1d464d67`，从最新 origin/main 创建隔离分支 `release-0-26-1-prep-resumed`。
- [x] (2026-10-09) 阅读发布流程并建立本轮计划；原工作树的用户改动保持原状。
- [x] (2026-10-09) 复用旧准备的静态输入并补齐 PR #310 用户变化，复核版本与文档一致性。
- [x] (2026-10-09) 固定预合并提交的 preflight、完整 verify 及契约补充验证已执行；完整门禁与 VSIX smoke 的失败如实记录，Webview 424/424 通过。
- [x] (2026-10-09) 更新技术债与计划，完成草稿 PR 材料；交付前再次 fetch/rebase 并验证最终准备 head，实际链接及最新检查记录在 PR。
- [ ] 后续独立修复启动阻塞，完整门禁通过后才可进入合并/发布；本轮仅交付草稿准备材料。

## 意外与发现

旧准备 PR #308 已关闭且没有发布。其静态材料可复用，但其验证不是本轮证据。PR #310 的定向修复已经合入，记录仍保留 Runtime checkpoint 启动、停止后立即重启和 reload 后自动启动的完整门禁失败；本轮重新运行后才能判断当前状态。

原工作树 `/home/users/ziyang01.wang-al/projects/dev-session-canvas` 有用户未提交工作，本轮只使用 `/tmp/dsc261r`。Unix socket 长度限制要求宿主验证使用短 `/tmp` 路径。默认 umask 0002 曾让 VS Code globalStorage 成为 0775，触发真实 root 目录权限保护；本轮先按默认环境重验，隔离权限对照不能代称完整验证成功。

## 决策记录

2026-10-09：重新从已合入 #310 的 main 创建分支，不恢复 #308。理由是旧分支包含取消记录及已过期的验证输入；仅选择性复用 `568465a8` 的版本和文案差异。

2026-10-09：0.26.1 使用完整门禁，不继承 0.26.0 的一次性豁免。不将新发现的独立产品缺陷混入发布准备；失败按事实记录并交付草稿 PR。

## 结果与复盘

静态发布输入已完成，preflight 通过；完整 verify 和独立 VSIX smoke 失败，尚不满足合并或发布条件。notifier 联动、双 locale 及具名运行时定向检查通过；Webview 全套 424/424 通过（12.3 分钟），包含 #310 新增的 26 项边界用例。准备 PR 保持草稿。

## 上下文与定向

上一公开版本为 v0.26.0。`package.json`、`package-lock.json` 和 `extensions/vscode/dev-session-canvas{,-notifier}/package.json` 统一版本；双扩展 CHANGELOG、Marketplace README 英中文及根 README 英中文解释用户变化。`docs/release-contracts/v0.26.1.md` 汇总发布范围、用户 release notes、文档清单、已知限制及验证范围。手册、support 与 `docs/design-docs/public-marketplace-release-readiness.md` 保持同一口径。

本版包含同 root 新建持久会话归属、启动失败原因与拒绝收尾、普通请求超时、旧历史清理、关闭持久化时提醒桥接以及 PR #310 的 styled 文件链接折行/选区重绘修复。notifier 自身仅版本对齐。旧 live 会话不迁移，已结束持久 Runtime 不恢复正文或自动启动，Preview 和原安装关系保持。

## 工作计划

第一里程碑复用旧静态输入并加入 #310 的用户变化。只对精确文件应用旧差异，保留主线新增设计记录。完成标准为版本一致、契约五部分完整、CHANGELOG 不含候选 SHA、验证结果或发布后渠道事实。

第二里程碑提交静态输入，在独立短路径工作树生成由 origin/main 与准备 head 合成的正常预合并提交，运行仓库标准验证。完整 verify 先运行门禁自测与 npm test，再运行 HEAD 的干净检出 VSIX 打包和安装 smoke；如果前段失败，单独执行尚未到达的 Webview 与 VSIX 检查，结果不能代替完整 gate。

第三里程碑将证据写入本计划及技术债，更新 PR 描述。推送前 fetch/rebase 最新 main，若代码或发布输入变化则重新生成预合并提交验证。门禁未通过时只创建草稿，保留后续修复入口。

## 具体步骤

准备目录为 `/tmp/dsc261r`。Node 22 位于 `/tmp/dsc-release-node22/node_modules/node/bin`，匹配当前原生输入的六目标资产为 `/tmp/dsc-release-026-assets`。依赖使用 npm ci 安装；只在原生源码、依赖与 hash 不变时复用资产。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    npm ci
    npm run release:preflight -- --version 0.26.1
    npm run release:verify -- --version 0.26.1

完整门禁必须在提交后的预合并工作树运行。使用缓存 VS Code `/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code`，浏览器缓存为 `/tmp/dsc026v/.playwright-browsers`；调试目录通过 smoke/Marketplace 对应环境变量指定独立短路径。具体预合并 SHA、命令与日志将在实际运行后追加，不提前写成功。

## 验证与验收

preflight 应确认根与双扩展版本及发布契约一致；完整 verify 应成功完成 npm test 和 HEAD clean-checkout VSIX。补充 root ownership/preparation、Host/Supervisor、reader、旧历史、请求超时、提醒及 notifier typecheck/source/companion/locale 检查。跨平台原生与真实桌面通知只复用既有具名范围，不将 Linux 自动化外推为全平台通过。

静态输入完成、实际结果可追踪且准备 PR 已创建即完成本轮可交付材料；只有完整门禁通过才满足发布准备 PR 的合并条件。缺失或失败的检查必须保持显式待处理。

## 幂等性与恢复

失败日志和工件保留在隔离目录，重复验证使用新调试目录避免旧状态污染。不要重置或 stash 原工作树。分支追赶使用 rebase；已推送时如有必要仅对已确认旧 head 使用 force-with-lease。没有用户合并授权时不调用 merge 或 publish。

## 证据与备注

PR #310 merge：`f6b65580520ee24bbac69a987496931e1d464d67`。旧静态输入：`568465a8` 相对 `f57b11f9`；旧 PR #308 仅作历史。旧失败解释见 `docs/design-docs/release-blockers-investigation.md` 与 `docs/exec-plans/completed/release-validation-followups.md`。

## 接口与依赖

本轮不新增产品接口或依赖。沿用 `scripts/release/release-preflight.mjs`、`scripts/release/run-clean-checkout-vsix-validation.mjs` 以及仓库 npm 脚本；不修改测试或产品来绕过发布门禁。

修订记录：2026-10-09 创建本轮恢复计划，区分历史准备、已合入修复与待执行的完整发布验证。


## 本轮验证记录

第一轮准备提交为 `eb29e61a`，与 `origin/main@f6b65580` 生成的预合并提交为 `0420915806fee8179eb19de6164985b0a593213c`，验证树 `/tmp/dsc261v`。该树真实执行 npm ci、preflight 和 release:verify。后续发布文案仅补充四物理行限制及澄清预合并步骤；不修改代码、测试、依赖或原生资产。

完整 verify 的门禁自测通过，npm test 已通过 Marketplace 浏览器与 VS Code E2E、运行时协议、模板及 reset helper 等前置检查，随后在 `runRuntimeCheckpointRefreshSmoke:218` 等待 Agent 启动超时。Agent/Terminal 均记录 `Root runtime preparation or submission did not complete`，现场扩展 globalStorage 为 0775。与此前已确认的权限拒绝一致；本轮不修改目录权限，不把旧 0077 对照中的后续 Terminal 准入问题追认为解决。日志 `/tmp/dsc261-verify.log`，现场 `/tmp/d261s/runtime-checkpoint-refresh/artifacts`。

独立 `npm run validate:clean-checkout:vsix -- --ref HEAD --keep-temp` 针对同一预合并提交完成全新 npm ci、打包及真实 VS Code 启动，最后在 `verifyAutoStartOnCreate:4909` 超时。此轮已越过 shell 停止后重启和两个 QuickPick；之前 shell 重启的旧责任竞态仍缺专门修复，单次越过不能关闭其债务。现场包含 `Local final snapshot responsibility still occupies the execution key or Host capacity`、`The original execution metadata binding changed`。不能称为保存 pending 或已排除产品缺陷。日志 `/tmp/dsc261-vsix.log`，工件 `/tmp/dev-session-canvas-clean-checkout-xpLXon/repo/.debug/vscode-vsix-smoke/smoke-runtime/artifacts`。

补充回归在相同源代码的准备树 `/tmp/dsc261r` 执行：root ownership/preparation、请求超时 37/37、提醒 helper、Host 336/336、Supervisor 116/116、reader client 32/32、reader settlement 27/27、legacy history 136 例均通过。notifier typecheck/source/build、companion 和 en/zh-cn locale smoke 通过。命令逐项 exit code 保存在 `/tmp/dsc261-directed-results.json`、`/tmp/dsc261-notifier-results.json`，日志分别为 `/tmp/dsc261-directed.log` 与 `/tmp/dsc261-notifier-smoke.log`。

六目标资产读取器在当前源码上验证 binary/hash/source 输入通过，见 `/tmp/dsc261-assets.log`。同一干净检出额外执行 notifier package:vsix，双包均为 0.26.1/Preview，包含 en/zh-cn 本地化资源，主扩展 extensionPack 指向 notifier、notifier extensionDependencies 指向主扩展；见 `/tmp/dsc261-notifier-package.log` 与 `/tmp/dsc261-vsix-inventory.log`。这仅证明包内容关系，市场自动补齐安装及真实桌面通知送达/点击仍不在本机 smoke 的证据范围内。

Webview 全套 `npm run test:webview` 424/424 通过（12.3 分钟），没有更新快照或重试失败用例；日志 `/tmp/dsc261-webview.log`。该树产品源码、测试与依赖与第一轮预合并输入相同，后续只有发布文案及验证记录变化。此结果不替代失败的完整门禁。

修订记录：2026-10-09，补充固定预合并输入的完整门禁首败、VSIX 首败及具名补充检查，将发布准入与静态材料完成分别记录。


交付前复核：将本记录提交后，在 `/tmp/dsc261v` 从最新 origin/main 重新生成预合并提交，执行 `npm run release:preflight -- --version 0.26.1` 与 `npm run release:verify -- --version 0.26.1`。使用新的 `/tmp/d261fm`（Marketplace）、`/tmp/d261ft`（宿主临时目录）与 `/tmp/d261fs`（Runtime smoke）保留独立现场；输出 `/tmp/dsc261-final-preflight.log`、`/tmp/dsc261-final-verify.log`。最新准备/预合并 SHA 和复核结果写入 PR，避免为回填同一验证事实反复改动发布输入；任何失败都继续阻止合并。

修订记录：2026-10-09，补充 Webview 424/424 的完整结果，收口静态交付材料并保留独立启动修复及最终 head 门禁入口。
