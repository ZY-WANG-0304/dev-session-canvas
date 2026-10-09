# 定位原生 resize 准入错误

本计划按 `docs/PLANS.md` 持续维护，承接 PR #314。当前目标是解释完整 smoke 中页面出现 resize 错误的根因，并区分测试问题与插件功能问题。

## 目标与全局图景

真实 VSIX 的 owned reconciliation 与 local execution flow 已通过，但 trusted 在页面检查中发现 `Execution terminal interaction admission is closed or unsupported`。本次要捕获错误发生时的原执行状态、请求来源和操作顺序，使后续修复有明确边界。不得用最终 stopped 状态推断错误发生于 stop，也不得清除 toast 或放宽断言。

## 进度

- [x] 复核 PR head `15328fe9`、失败工件、Host resize 与 adapter 准入条件。
- [x] 在真实 trusted 流程增加临时只读诊断，捕获两次原生 starting 阶段拒绝，调用栈来自真实 Webview 消息回调。
- [x] 可控夹具 4/4：Agent/Terminal 在 ready 前及 ready 后 started 前均拒绝；同身份 running 后同尺寸请求成功。
- [x] 两次真实 trusted 各捕获两次 starting 拒绝；记录另一个 stop 阶段 Host 拒绝和异常退出通知等待失败。
- [x] 同步正式结论、精简证据、可复跑 patch 与技术债，移除全部临时产品/测试修改。

## 意外与发现

错误来自 adapter 的 `interact`，并非 Host 的 mutation guard 或 owner 的 interaction guard。原生诊断实际捕获 `state=starting`、`interactionCapable=false`、`stopRequested=false`、无 source/process/seal、authority 无 closing/blockedReason。Host 在 business 建立后即分发 resize，未等待 adapter running。页面正常 fit 经 `webview/resizeExecutionSession` 送入 Host，不是测试合成的 resize。受控场景进一步确认 ready 已报告交互能力但 started 尚未确认时仍有同一缺口。

第一次诊断运行通过此前失败的页面 probe，随后两次启动遇到同类 resize 错误，最终在异常退出通知检查等待 diagnostic events 超时，未取得完整通过。另捕获一次 stopRequested=true 时的 Host 层 `Owned terminal mutation admission is closed.`，该错误不能混入 adapter starting 根因。第二次复用同一已构建 payload 和独立 profile，同样通过原 probe，随后捕获两次 starting 错误，并最终在异常退出通知等待超时。旧失败缺少瞬时状态，不能把新时序逐次追认到旧运行。

## 决策记录

2026-10-10：先记录第一现场，不选择 stop 竞态假说。临时观测不改变准入、延时或错误语义。用户此次询问根因，本次以诊断结论为收口，不扩展成未确认的产品修复。

## 结果与复盘

已证明插件启动与尺寸同步之间存在缺口，四项可控正反对照通过。运行中的第一条尺寸请求不会由提前被拒绝的请求自动保留；底层准入拒绝本身符合契约，Host 需协调启动阶段与页面尺寸意图。两次原生运行与无探针产品代码上的四项对照证据均已归档；本次未做产品修复，完整门禁仍失败。正式结论和独立通知待定位项已登记。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 接收页面 resize 并通过 `queueNonNativeHostResize` 与正文消费串行化。`panel/executionOwnerLifecycle.ts` 保留原执行所有权，`panel/executionSessionAdapter.ts` 在 `interact` 核验底层就绪及关闭状态。页面 `webview/executionSessionNodes.tsx` 在终端尺寸变化时发出请求。`tests/vscode-smoke/extension-tests.cjs` 的 trusted 流程最终以 `verifyRealWebviewProbe` 检查空 toast。`scripts/test/test-host-execution-owner-wiring.mjs` 提供可控 provider、时钟和 Host 夹具。

## 工作计划与里程碑

第一里程碑在独立 worktree `/tmp/dscr` 保存旧失败工件，增加 adapter 拒绝和 Host 请求的只读追踪，按原顺序运行 trusted。第二里程碑按观测到的状态构造确定性夹具，区分启动、源结束和停止窗口，并核对页面消息与测试合成调用。第三里程碑把根因、影响范围和未验证项写入 `docs/design-docs/smoke-reload-autostart-investigation.md` 与技术债，保存精简证据及诊断 patch。

## 具体步骤

工作目录 `/tmp/dscr`。将 `.debug/rca/` 中已有依赖 symlink 临时移回根目录，使用以下环境运行 source 或 VSIX trusted smoke，并将日志保存到 `.debug/resize-rca/`：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code

真实诊断在基线 `15328fe9` 上应用相邻证据目录中的 `resize-diagnostic.patch` 后运行：

    git apply docs/references/smoke-reload-autostart/resize-diagnostic.patch
    mkdir -p .debug/resize-rca
    DSC_RESIZE_RCA="$PWD/.debug/resize-rca/trace.jsonl" DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:vsix-smoke

该 patch 只记状态与步骤，保留所有断言。第二次复用同一已打包 payload，调用 `runVSCodeScenario` 的 trusted 相同参数重新建立 profile；本地命令为 `xvfb-run -a node .debug/resize-rca/replay.mjs`，重复打包运行上方命令也可复现同一路径。每次使用不同 trace 文件。

移除诊断 patch 后应用 `resize-characterization.patch`，运行：

    git apply -R docs/references/smoke-reload-autostart/resize-diagnostic.patch
    git apply docs/references/smoke-reload-autostart/resize-characterization.patch
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='resize RCA' node scripts/test/test-host-execution-owner-wiring.mjs
    git apply -R docs/references/smoke-reload-autostart/resize-characterization.patch

四项特征验证预期通过：它们断言当前缺陷存在以及 running 后的正向对照，不作为产品已修复的回归验收。后续修复时应改写为预期的尺寸保留/应用行为。只在与 patch 匹配的独立干净 worktree 操作；不要将旧诊断 patch 套到后续不同实现。

## 验证与验收

记录拒绝瞬间的 executionId、adapter state、source/process/seal、关闭原因、owner 状态及请求来源，建立与真实失败栈相符的因果链。受控对照只验证观测到的窗口，不冒充原生全平台实测。若证据仍不足，明确保留未知项。

## 幂等性与恢复

独立 profile 不触碰用户原工作树与实际会话。旧工件不覆盖。临时诊断 patch 归档后从产品代码移除；依赖 symlink 提交前移回 `.debug/rca/`。不合并、不发布。

## 证据与备注

此前两次完整失败保存于 `.debug/pr314-output/run2-artifacts/` 和 `run5-artifacts/`；本次工件另存。精简证据保留原执行身份以关联启动及 running 请求，不包含终端正文。正式证据为 `docs/references/smoke-reload-autostart/resize-admission-evidence.json`，两个 patch 的 SHA-256 同时记录其中。

## 接口与依赖

复用当前 Node 22.23.3、VS Code 1.141.0、Linux x64 原生 provider 与 fake Agent。无需新增依赖或更改产品协议。

修订记录：2026-10-10，创建诊断计划，明确不从最终状态反推 resize 失败窗口。

修订记录：2026-10-10，完成两次原生观测和四项无产品探针对照；结论限定为启动协调缺口，保留旧现场不可追认与新的独立通知失败。
