# 准备 0.26.0 公开 Preview 发布

本 ExecPlan 按 `docs/PLANS.md` 持续维护；任务范围是发布准备、验证和提交 PR，实际合并与发布需后续授权。

## 目标与全局图景

将已合入 `origin/main` 的运行时容量、退出完整性和当前状态恢复改造整理为 0.26.0。用户应在升级前理解：健康的持久化会话重连恢复当前终端状态，已结束 Runtime 重开只保留轻量终态；本版本仍为 Preview。完成后版本、双扩展 CHANGELOG、英中文 listing、支持文档和发布契约一致，PR 可供评审。

## 进度

- [x] (2026-10-07) 同步 origin/main，从 06e9abcf 创建 release-0-26-0-prep；保留未跟踪 image.png。
- [x] (2026-10-07) 核对 v0.25.0 至 main 的 #292 至 #295 与正式运行时规格，选定 0.26.0。
- [x] (2026-10-07) 同步版本、用户说明、支持边界、发布手册和契约；preflight 与 diff 检查通过。
- [ ] 提交后执行 preflight、完整 verify 与 notifier 定向检查，记录实际结果。
- [ ] 再次同步 main、推送并创建发布准备 PR，核对预合并检查。

## 意外与发现

旧 README 和手册当前说明仍以 0.24.5 为上一版本，而 GitHub latest 已为 v0.25.0。主线已完成新的 Runtime 交付，不能照抄旧发布说明中的全部“验证中”。新结论以运行时有限收尾和当前状态恢复文档为准，旧失败保留在历史记录中。

默认构建需要匹配原生输入的六目标资产，不能使用 stock 对照构建代替正式验证。完整 verify 的 clean-checkout 使用 HEAD，因此必须先提交静态输入再验证。

## 决策记录

- 决策：版本使用 0.26.0。理由：运行时实现与已结束历史语义构成新的用户里程碑，超出同里程碑修补；遵循 `docs/workflows/VERSION.md`。日期/作者：2026-10-07 / Codex。
- 决策：发布契约只记录静态输入；验证过程在本计划和 PR 记录，发布后事实由外部 manifest/Release 保存。理由：遵循 #293 的双阶段验证规则。日期/作者：2026-10-07 / Codex。

## 结果与复盘

进行中。尚未发布、打 tag 或合并。当前不存在新增产品实现，相关既有风险继续由 `docs/exec-plans/tech-debt-tracker.md` 跟踪，不把本次文案复核视为新增平台验收。

## 上下文与定向

根 `package.json`、`package-lock.json` 与 `extensions/vscode/dev-session-canvas{,-notifier}/package.json` 必须版本一致。两扩展独立打包且保持同版；主扩展 extensionPack 与 notifier 单向 extensionDependencies 不变。`docs/release-contracts/v0.26.0.md` 是本版静态范围入口。产品边界依据 `docs/product-specs/runtime-persistence-modes.md`、`docs/design-docs/runtime-live-state-recovery.md` 与 `docs/design-docs/runtime-persistence-closeout.md`。

## 工作计划

第一里程碑同步版本和所有当前用户文案，保留历史 CHANGELOG 与历史发布事实；完成后 preflight 应通过。第二里程碑提交静态输入并运行完整 verify，预期完整测试和隔离 VSIX 验证退出 0；失败时记录准确命令与原因，不降级门禁。第三里程碑在最新 main 上准备预合并结果、创建 PR 并核对 CI，不执行实际发布。

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

静态检查必须证明三份 manifest、lockfile 与双 CHANGELOG 一致，并存在完整契约。完整验证必须在提交后的输入上实际执行；PR 的 Release Preflight 使用预合并 ref，再构建同 ref 六目标资产并运行相同命令。运行时既有跨平台证据仅支持其声明路径，不能由本次通过扩大为旧操作系统、任意并发或性能 SLA。

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
