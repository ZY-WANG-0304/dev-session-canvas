# 准备 0.26.1 公开 Preview 发布

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖静态发布输入、完整验证与发布准备 PR。用户要求基于 origin/main 准备 0.26.1；合并、创建 publish tag 和渠道发布不属于本次准备范围。

## 目标与全局图景

把 0.26.0 之后已合入主线的运行时归属、失败处理和通知桥接修复整理为 0.26.1。用户可以从同版双扩展说明中了解：同一工程的新增持久会话如何跨窗口共享归属，启动拒绝后何时可以重试/删除，以及请求超时仍可能已经执行。保持 Preview 和已结束 Runtime 不恢复正文的边界。

## 进度

- [x] (2026-10-09) fetch origin，基于 f57b11f9 创建独立 release-0-26-1-prep worktree，保留原工作区的未提交内容。
- [x] (2026-10-09) 确认 v0.26.0 已公开发布；核对其后主线 #297、#298、#300–#307 与正式设计。
- [x] (2026-10-09) 同步版本、双 CHANGELOG、英中文 README/listing、支持说明、手册与发布契约。
- [x] (2026-10-09) 提交静态输入 930070ce，构建本地预合并结果 953c3ee8，preflight 和 root/notifier 定向验证通过。
- [x] (2026-10-09) 回收完整 verify、Webview 与 clean-checkout：完整门禁失败，Webview 380 passed / 2 failed，packaged 相对 shell 诊断超时；详细阻塞见下文。
- [x] (2026-10-09) fetch/rebase 后推送并创建草稿 PR #308，目标 main，head 568465a8 / 预合并 3445fc85；草稿 CI skipped，不计通过。
- [x] (2026-10-09) 同步验证记录与技术债，草稿 PR 保留完整失败事实。
- [ ] 修复构建前置、主题源码断言、折行链接与相对 shell 验证阻塞，再对最新预合并结果通过完整门禁，方可解除草稿。

## 意外与发现

0.26.0 的授权验证例外只适用于精确版本 0.26.0；0.26.1 必须恢复完整 npm test 与 clean-checkout VSIX smoke。原工作区仍停留在 0.26.0 准备分支并有已暂存/未暂存修改，不能复用这些内容作为本版输入。

深路径 worktree 曾导致 VS Code Unix socket listen EINVAL，因此完整验证使用 `/tmp` 下短路径独立检出；默认构建需要六平台目标原生资产，只有原生源码/依赖/hash 匹配的集合可复用。

## 决策记录

- 决策：按用户指定使用 0.26.1，主扩展与 notifier 同版。理由：本次收口 0.26 运行时里程碑后的修复，并明确 root 归属变化和旧 live 不迁移，不把它隐藏为纯文档升级。日期/作者：2026-10-09 / Codex。
- 决策：历史契约和旧 CHANGELOG 内容不改；本版不复制测试豁免。理由：静态发布输入与发布后证据分层，旧失败不能追认为通过。日期/作者：2026-10-09 / Codex。

## 结果与复盘

0.26.1 静态发布准备已完成并交付草稿 PR #308；root 身份/准备、Host 333/333、Supervisor 116/116、reader 32/32、旧历史 136 项及 notifier 类型/联动/英中文 locale 已通过。完整门禁未通过：干净构建前置与主题源码断言失败、Webview 380/382 通过、packaged 相对 shell 诊断超时；本版尚不可合并或发布，计划保持 active，阻塞已登记技术债。没有新增产品功能或发布门禁例外。既有 root 多窗口整图并发保存、故障恢复、旧系统及桌面通知限制继续由正式设计和技术债跟踪，不因准备发版关闭。

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

## 2026-10-09 验证记录

静态输入提交 `930070ce` 与 `origin/main@f57b11f9` 生成本地 merge commit `953c3ee8`；`/tmp/dsc0261v` 与 `/tmp/dsc0261n` 为独立短路径 worktree，Node 22.23.3，分别 `npm ci`。默认构建使用 `/tmp/dsc-release-026-assets` 六目标集合，通过原生源码/依赖/hash 校验；此集合按 CONTRIBUTING 允许复用的同原生输入条件使用，不代表本版全平台重新验收。

root ownership/preparation 全部通过，包含真实 Linux 身份的双子进程一致性，其余平台/锁仍按各测试声明为受控验证。Host execution wiring 333/333、Supervisor wiring 116/116、reader 32/32、legacy history 136 项与 notifier typecheck 通过，日志 `/tmp/dsc0261-targeted.log`。VS Code 1.141.0 的 companion、英文和简体中文 locale smoke 均退出 0，日志 `/tmp/dsc0261-notifier.log`、`/tmp/dsc0261-notifier-locale.log`；这不代证真实 OS 通知权限与桌面弹出。

完整 verify 首次在 Marketplace 宿主启动前 `listen EINVAL` 失败，Unix socket 为 136 字符深路径，日志 `/tmp/dsc0261-verify.log`。用脚本已有的短目录参数重跑，不修改产品或断言：

    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets \
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_VSCODE_E2E_DEBUG_ROOT=/tmp/dsc261m \
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_VSCODE_E2E_HOST_TMP_ROOT=/tmp/dsc261mt \
    DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dsc261s \
    npm run release:verify -- --version 0.26.1

重跑日志 `/tmp/dsc0261-verify-short.log`。为完整回收已有债务，另独立运行全部 382 项 Webview（`/tmp/dsc0261-webview.log`）与无 skip 的 HEAD clean-checkout（`/tmp/dsc0261-clean-vsix.log`）；最终结果见下文；两项均未取得完整通过。

修订记录：2026-10-09，记录首轮验证、环境路径错误与实际通过范围，补齐跨窗口持久化默认值和后端未知状态的说明。

### 发布阻塞回收

短目录完整 verify 已通过 Marketplace 真宿主与完整协议回归，随后在 `test:package-vsix-file-list` 因 notifier `dist` 不存在失败；`npm test` 在该检查前只经 Marketplace 构建主扩展，notifier build 要到之后的 smoke 才执行。Node 22 的干净 `npm ci` 不会生成这个产物；已有 notifier/dist 的工作树可能掩盖该前置依赖。当前 Release Preflight 只有 npm ci 后直接 verify，同样缺少明确的 notifier 构建步骤。原失败保留；在独立 `/tmp/dsc0261p` 检出 PR 预合并 `3445fc85`，显式先 `npm run build:notifier` 再运行原 verify 以继续回收剩余失败，不把它记成默认干净门禁已通过，日志 `/tmp/dsc0261-pr-verify.log`。

HEAD clean-checkout 已完成隔离 npm ci 与主 VSIX 打包，随后真实 VS Code 1.141.0 的 packaged smoke 再现 `verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot` 第 2768 行等待 `execution/started` 超时，命令 exit 1。现场有目标 startRequested、EOF、最终 saved，但没有测试要求的 started；这是此前 #305 后单列的同一待查路径，不将原因猜成产品或测试。临时检出保留在 `/tmp/dev-session-canvas-clean-checkout-L2msFs`，日志 `/tmp/dsc0261-clean-vsix.log`。

独立 notifier VSIX 打包成功（14 files），主/notifier 两包的 0.26.1、publisher、当前 README、NLS/l10n 和 extensionPack/extensionDependencies/api 关系已通过 ZIP 读取核对。独立 Webview 全套 382 项完整执行（12.2 分钟），结果 380 passed / 2 failed，exit 1。失败仅为 Agent / Terminal 的 `styled hard-wrapped code paths keep line and column suffixes`；两者均无法检测 `src/webview/executionTerminalNativeInteractions.ts:1600:12`。基准截图及其余 380 项通过，未修改断言或截图。失败 trace / screenshot 位于 `/tmp/dsc0261v/.debug/playwright/results`。

修订记录：2026-10-09，登记草稿 PR 与已确认的验证阻塞，保持发布准备范围，未修改产品或测试断言，也未引入门禁豁免。

预合并 `3445fc85` 在显式 notifier build 后已通过 file-list 与发布脚本回归，随后停止于 `test-theme-color-tokens.mjs:178`：正则要求 main.tsx 存在 `canvasStatusToneClass as statusToneClass`，实际源码无该导入，原 main 两文件同样如此。日志 `/tmp/dsc0261-pr-verify.log`，exit 1；npm test 后续步骤未由此命令执行，不声称通过。与构建前置、折行链接、相对 shell 诊断一起登记 `tech-debt-tracker.md` 的 0.26.1 节；没有通过添加无用导入、改基准或跳过断言消除失败。

修订记录：2026-10-09，回收全部 382 项 Webview 和所有已启动验证的退出结果，记录四类门禁阻塞与草稿交付；0.26.1 不继承旧版授权，后续修复后需重新验证最新预合并结果。发布前检查仍为 active，不能把静态物料完成等同于发布资格。
