# 从最新主线准备 0.26.1 发布

本 ExecPlan 按 `docs/PLANS.md` 持续维护。任务为发布准备，交付可评审的静态输入与实际验证结果；合并和发布需后续授权。

## 目标与全局图景

将 0.26.0 之后已合入 main 的运行时归属、启动/恢复/删除、通知与终端交互修复整理为 0.26.1 Preview。用户通过英中文 listing 和 CHANGELOG 了解变化、升级风险和原有恢复限制；完整发布验证用于判断是否可合并。

## 进度

- [x] (2026-10-11) fetch origin，从 a39cd8c1 创建 release-0-26-1-latest-main，保留未跟踪 image.png。
- [x] (2026-10-11) 复核历史准备分支和主线新增 #314 至 #316；旧分支只作为静态文案参考。
- [x] (2026-10-11) 同步 manifest、lockfile、双 CHANGELOG、英中文 README/listing、手册、支持文档及契约。
- [ ] 提交静态输入，在短路径隔离检出运行 preflight、完整 verify 和 notifier 检查。
- [ ] 同步验证记录、技术债，基于最新 main 推送并创建 PR。

## 意外与发现

release-0-26-1-prep、release-0-26-1-prep-resumed 和 release-0-26-1-from-main 已被其他 worktree 使用，故新建独立分支。旧准备曾因完整门禁失败停留草稿，不能复用通过结论。最新主线已有后续修复，但仍需实际验证。

## 决策记录

2026-10-11 / Codex：按用户指定使用 0.26.1；主扩展和 notifier 同版。历史静态文案可复用，新增生命周期和删除准入修复需补齐用户说明。0.26.0 的一次性豁免不适用；保持完整门禁，不改测试基准或引入通用 skip。

## 结果与复盘

静态输入已完成，preflight 与 diff 检查通过；完整验证待执行，不宣称可发布。

## 上下文与定向

根 package.json、package-lock.json 和 extensions/vscode/dev-session-canvas{,-notifier}/package.json 的版本同步。两扩展 CHANGELOG、英中文 README.marketplace.md 与根 README 描述用户行为；docs/release-contracts/v0.26.1.md 是静态契约，docs/public-preview-release-playbook.md 和 docs/notifier-preview-release-playbook.md 提供执行步骤。原生六目标资产是默认 build/VSIX 输入；匹配源码后可复用 /tmp/dsc-release-026-assets。

## 工作计划

第一里程碑完成静态输入，运行 preflight 与 git diff --check，确认用户文案一致且历史 CHANGELOG 不变。第二里程碑提交输入，在 /tmp 短路径隔离检出用 Node 22、npm ci 和匹配原生资产运行完整 verify，并补充 notifier source、companion、locale 和独立打包。第三里程碑记录真实结果，失败时保留具名阻塞并创建草稿 PR；通过时创建可评审 PR。推送前 fetch/rebase main，若产品树变化则重做受影响验证。

## 具体步骤

在仓库根执行静态检查与提交；隔离目录继承原生资产环境变量，并使用私有临时目录避免 runtime 存储权限和 Unix socket 长路径问题。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    npm run release:preflight -- --version 0.26.1
    npm run release:verify -- --version 0.26.1
    npm run typecheck:notifier
    npm run test:notifier-source
    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke
    git diff --check

## 验证与验收

preflight 必须通过版本、双 CHANGELOG 和契约校验；verify 必须通过门禁回归、完整 npm test、HEAD clean-checkout VSIX 与安装 smoke。PR 还需针对最新 head 与 origin/main 的预合并结果验证；发布 tag 验证属于后续发布。有限三平台历史证据只覆盖原设计声明场景，不替代本次完整门禁或外部市场安装、真实通知点击。

## 幂等性与恢复

检查可重试；每次使用独立日志和短路径目录保留失败现场，不覆盖其他 worktree 或 image.png。失败时保持 PR 未合并，不创建 publish tag。clean-checkout 使用已提交 HEAD，因此先提交静态材料再验证。

## 证据与备注

    origin/main: a39cd8c1
    分支: release-0-26-1-latest-main
    原生资产: /tmp/dsc-release-026-assets（尚待当前输入校验）

## 接口与依赖

使用现有 release-preflight.mjs、run-clean-checkout-vsix-validation.mjs 与发布工作流，不新增依赖、接口或门禁豁免。

修订记录：2026-10-11，依据用户要求从最新 origin/main 独立准备 0.26.1，记录旧分支边界与完整验证要求。
