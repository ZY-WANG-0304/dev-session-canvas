# 准备 0.26.1 公开 Preview 发布

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖静态发布输入、完整验证与发布准备 PR。用户要求基于 origin/main 准备 0.26.1；合并、创建 publish tag 和渠道发布不属于本次准备范围。

## 目标与全局图景

把 0.26.0 之后已合入主线的运行时归属、失败处理和通知桥接修复整理为 0.26.1。用户可以从同版双扩展说明中了解：同一工程的新增持久会话如何跨窗口共享归属，启动拒绝后何时可以重试/删除，以及请求超时仍可能已经执行。保持 Preview 和已结束 Runtime 不恢复正文的边界。

## 进度

- [x] (2026-10-09) fetch origin，基于 f57b11f9 创建独立 release-0-26-1-prep worktree，保留原工作区的未提交内容。
- [x] (2026-10-09) 确认 v0.26.0 已公开发布；核对其后主线 #297、#298、#300–#307 与正式设计。
- [x] (2026-10-09) 同步版本、双 CHANGELOG、英中文 README/listing、支持说明、手册与发布契约。
- [ ] 提交静态输入，在预合并结果执行 preflight、完整 verify 和 notifier / root 定向验证。
- [ ] 重新 fetch/rebase，推送分支并创建 main 目标的发布准备 PR，回收 CI 结果。

## 意外与发现

0.26.0 的授权验证例外只适用于精确版本 0.26.0；0.26.1 必须恢复完整 npm test 与 clean-checkout VSIX smoke。原工作区仍停留在 0.26.0 准备分支并有已暂存/未暂存修改，不能复用这些内容作为本版输入。

深路径 worktree 曾导致 VS Code Unix socket listen EINVAL，因此完整验证使用 `/tmp` 下短路径独立检出；默认构建需要六平台目标原生资产，只有原生源码/依赖/hash 匹配的集合可复用。

## 决策记录

- 决策：按用户指定使用 0.26.1，主扩展与 notifier 同版。理由：本次收口 0.26 运行时里程碑后的修复，并明确 root 归属变化和旧 live 不迁移，不把它隐藏为纯文档升级。日期/作者：2026-10-09 / Codex。
- 决策：历史契约和旧 CHANGELOG 内容不改；本版不复制测试豁免。理由：静态发布输入与发布后证据分层，旧失败不能追认为通过。日期/作者：2026-10-09 / Codex。

## 结果与复盘

范围审计已完成，版本物料与验证尚在执行。没有新增产品功能或发布门禁例外。既有 root 多窗口整图并发保存、故障恢复、旧系统及桌面通知限制继续由正式设计和技术债跟踪，不因准备发版关闭。

## 上下文与定向

根 `package.json`、`package-lock.json` 与 `extensions/vscode/dev-session-canvas{,-notifier}/package.json` 同步版本。两个 CHANGELOG 只描述用户结果。`docs/release-contracts/v0.26.1.md` 是静态范围入口；`docs/design-docs/public-marketplace-release-readiness.md` 记录当前发布决定；英中文 README/listing、`docs/support.md` 和双发布手册保持一致。

root 是 VS Code 的 workspace folder；owner 是托管该 root 持久会话的运行时归属，同一执行环境、用户存储范围、root 和兼容代共用。已存在会话仍按原 backend/storage/session 完整绑定操作，不自动迁移。依据为 `docs/design-docs/runtime-root-ownership.md`、`runtime-admission-rejection-settlement.md`、`runtime-rpc-request-timeout.md` 与 `notifier-companion-architecture.md`。

## 工作计划

第一里程碑完成静态输入，preflight 应确认 manifest/lockfile/CHANGELOG/契约一致。第二里程碑先提交，再从最新 main 与提交生成预合并结果，在短路径运行完整验证以及 notifier/root 定向回归；失败保留日志与原因，不使用 stock 构建或跳过 smoke 代证。第三里程碑同步最新 main 后推送、创建 PR，核对固定预合并 ref 的 Release Preflight；验证失败则保留草稿并记录明确阻塞。

## 具体步骤

在验证检出的仓库根执行，Node 22 与六目标资产按 `CONTRIBUTING.md` 准备，资产绝对路径通过 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET` 传入：

    npm ci
    npm run release:preflight -- --version 0.26.1
    npm run release:verify -- --version 0.26.1
    npm run test:runtime-root-ownership
    npm run test:runtime-root-preparation
    npm run typecheck:notifier
    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke
    git diff --check

推送及创建 PR 前执行 `git fetch origin`、`git rebase origin/main`；基准推进时重建预合并结果并验证受影响范围。

## 验证与验收

完整 verify 应退出 0，包含 Marketplace 宿主 E2E、协议/终态、trusted/untrusted smoke、Webview 全套以及 HEAD 隔离 VSIX 打包和安装 smoke。notifier companion 必须观察到 posted diagnostic，locale 覆盖英中文；独立包检查同版 manifest、依赖和本地化文件。root 定向回归补充标准 npm test 没覆盖的身份与启动准备规则。PR checks 使用同源六目标资产；既有跨平台具名验收不会由本地绿色扩大为任意环境保证。

## 幂等性与恢复

静态修改和检查可重复执行，失败日志保留在 `/tmp` 或忽略目录。临时检出独立于用户工作区；不 stash、reset 或覆盖原工作。合并与发布等待后续明确授权；不创建发布 tag。若出现未确认失败，保留失败事实、登记技术债并让 PR 保持不可合并状态。

## 证据与备注

    起始 origin/main: f57b11f9
    上一 GitHub Release: v0.26.0，2026-10-08T00:54:14Z
    准备分支: release-0-26-1-prep

## 接口与依赖

不新增运行时接口或依赖；沿用 `scripts/release/release-preflight.mjs`、`scripts/release/run-clean-checkout-vsix-validation.mjs` 与 `.github/workflows/release-preflight.yml`。Node 22 为 CI 基线；原生资产按现有输入校验复用或构建。发布门禁实现保持不变。

修订记录：2026-10-09，创建计划，记录主线范围、工作区隔离与完整验证要求。
