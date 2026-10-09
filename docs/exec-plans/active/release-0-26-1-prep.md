# 恢复 0.26.1 发布准备

本 ExecPlan 按 `docs/PLANS.md` 持续维护，记录发布输入、验证事实与未完成项。

## 目标与全局图景

在 PR #310 合入后，将最新 main 上的运行时及终端链接修复整理为 0.26.1 公开 Preview 的静态发布输入。用户可从双扩展版本、CHANGELOG 和英中文安装说明理解升级变化；发布准备必须以真实完整门禁结果接受审查。本轮只交付准备 PR，不合并、不创建发布 tag、不投递发布渠道。

## 进度

- [x] (2026-10-09) 确认 PR #310 已合并为 `f6b65580520ee24bbac69a987496931e1d464d67`，从最新 origin/main 创建隔离分支 `release-0-26-1-prep-resumed`。
- [x] (2026-10-09) 阅读发布流程并建立本轮计划；原工作树的用户改动保持原状。
- [x] (2026-10-09) 复用旧准备的静态输入并补齐 PR #310 用户变化，复核版本与文档一致性。
- [ ] 对固定预合并提交执行 preflight、完整 verify 及契约补充验证，记录实际结果。
- [ ] 更新技术债与本计划，追赶最新 main，推送并创建准备 PR；失败时保持草稿且明确不可合并。

## 意外与发现

旧准备 PR #308 已关闭且没有发布。其静态材料可复用，但其验证不是本轮证据。PR #310 的定向修复已经合入，记录仍保留 Runtime checkpoint 启动、停止后立即重启和 reload 后自动启动的完整门禁失败；本轮重新运行后才能判断当前状态。

原工作树 `/home/users/ziyang01.wang-al/projects/dev-session-canvas` 有用户未提交工作，本轮只使用 `/tmp/dsc261r`。Unix socket 长度限制要求宿主验证使用短 `/tmp` 路径。默认 umask 0002 曾让 VS Code globalStorage 成为 0775，触发真实 root 目录权限保护；本轮先按默认环境重验，隔离权限对照不能代称完整验证成功。

## 决策记录

2026-10-09：重新从已合入 #310 的 main 创建分支，不恢复 #308。理由是旧分支包含取消记录及已过期的验证输入；仅选择性复用 `568465a8` 的版本和文案差异。

2026-10-09：0.26.1 使用完整门禁，不继承 0.26.0 的一次性豁免。不将新发现的独立产品缺陷混入发布准备；失败按事实记录并交付草稿 PR。

## 结果与复盘

准备进行中，尚无本轮通过结论或发布产物。最终结果将在完成验证后更新，明确静态准备与发布准入的区别。

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
