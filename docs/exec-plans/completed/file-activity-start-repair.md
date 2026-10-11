# 修正文件活动启动顺序与新节点拒绝呈现

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

在 PR #314 修复两个已定位问题：文件活动 smoke 创建两个 Agent 时等待前一个原执行确认启动；新建 Agent / Terminal 自动启动被准入拒绝后退出“等待尺寸 / 启动中”，显示可手动重试的错误。保持 starting=1、无自动重试、旧会话历史和资源结算规则。

## 进度

- [x] (2026-10-11) 读取已有原生对照证据和 Host 启动、失败报告、测试 fixture。
- [x] (2026-10-11) 新增回归基线显示 starting != error；实现严格身份保护的拒绝呈现和串行创建屏障。
- [x] (2026-10-11) Host 551/551、webview start 40/40、类型、本地化及脚本语法通过。
- [x] (2026-10-11) 原生拒绝状态与真实 Start 重试通过；文件活动启动通过、首 read 引用等待失败。默认 VSIX 七项通过、trusted 更早手动 resume 失败，均已登记。
- [x] (2026-10-11) 设计、技术债和证据已同步，PR 更新说明已准备；随本次提交推送。

## 意外与发现

准入拒绝发生在构造 transport 之后、connect 之前；adapter 存在不能证明资源已取得。此前定位的 baseline/probe 均残留 pendingLaunch=start，串行对照通过两个原 live 等待，尚未覆盖文件活动正文。

## 决策记录

2026-10-11：使用 typed rejected-before-acquire 结果作为无资源证明，在原记录清理前仅投影仍绑定原 metadata 的 pending start / starting（Terminal launching）呈现。清除 pendingLaunch、改 error 并复用已有本地化拒绝提示；不生成退出码、退出消息或历史快照。保留 stopped、resume-ready、pending resume、已取消或被较新记录替换的状态。等待槽空闲后用户可手动启动，不新增排队或重试。

## 结果与复盘

本轮两项修复完成：新建节点拒绝呈现和原身份串行创建得到验证。完整门禁未通过；原生原文件活动函数在首 read 引用等待超时，默认 trusted 更早在手动 resume 等待超时。未扩大修复范围，两个新停点与历史限制已登记技术债。既有调查证据见 `docs/references/smoke-reload-autostart/file-activity-start-evidence.json`，不把调查脚本 exit0 当作完整 gate 通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 创建节点时写入 pendingLaunch=start，表示页面在测量尺寸后需发送启动请求。`startNonNativeHostExecution` 持有原执行身份和节点 metadata 引用，`execution.start` 会因启动槽被占用返回 rejected-before-acquire。它清理未启动记录但当前不更新节点，页面对相同 pending 意图去重，因此会一直显示启动中。

`tests/vscode-smoke/extension-tests.cjs::verifyFileActivityViewsAndOpenFiles` 连续创建节点触发该竞争。已有 `waitForLocalExecutionStarted` 捕获 executionId/generation，并核对该身份的 started 事件，适合充当两个创建之间的屏障。`scripts/test/test-host-execution-owner-wiring.mjs` 的 startupResizeFixture 可暂扣第一项 started，稳定测试第二项拒绝、资源未取得和之后手动重试。

## 工作计划

第一里程碑补 Host 回归：Agent / Terminal 新节点拒绝后 error、pending 清空、单一提示、无 connect、not-required；覆盖旧历史、取消/替换和不确定资源等边界。先在产品未修改时运行，预期 starting/launching 与 error 不符。

第二里程碑在 CanvasPanelManager 增加严格绑定的拒绝呈现，清理与原错误不因状态通知失败受影响。smoke 每次创建后找到新节点并等待原 started，然后保留原两项 live 与文件读写/UI 断言。

第三里程碑运行完整 Host 测试与默认 VSIX，必要时隔离调用原具名函数验证通过范围。保存精简证据，下一处阻塞只登记，不扩大本轮修复。

## 具体步骤

工作目录 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。依赖由 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers` 恢复至根软链接，完成后停放回原处。使用 `/tmp/dsc-release-node22/node_modules/node/bin` 中 Node22；原生 VS Code 为 `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`，执行资产 `/tmp/dsc-release-026-assets`。

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='webview start' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    npm run test:ui-copy-localization
    node --check tests/vscode-smoke/extension-tests.cjs
    npm run test:vsix-smoke

提交前执行 `git fetch origin` 与 `git rebase origin/main`，完成验证后推送当前分支、更新 PR #314 描述。不合并、不发布。

## 验证与验收

新增测试须先红后绿；原来 stopped 的拒绝用例继续保留历史。新节点收到一次错误提示、可手动重试，未取得资源的原执行保存责任为 not-required。文件活动原函数应越过两个原执行启动等待，报告正文实际到达位置。完整 VSIX 未通过时必须列出准确阻塞，不以专项替代门禁。

## 幂等性与恢复

隔离原生运行使用独立目录和用户数据；结束停止自己创建的节点。测试可重复执行，不改用户原工作树和版本。观察失败不得阻断原拒绝清理，不删除旧会话恢复信息。

## 证据与备注

新增 22 项，Host 551/551、类型、本地化通过。原生 rejection exit0；file-activity 场景 exit1（xvfb-run 清理错误使包装退出5）；默认 gate 七个0、trusted 1。精简证据为 `docs/references/smoke-reload-autostart/file-activity-start-fix-evidence.json`。

验证输出保存在 `.debug/file-activity-start-fix/`，可复核结论同步到设计和 references。完成后归档本计划。

## 接口与依赖

复用 LocalExecutionStartError 的 OperationResult、原 metadata 引用、现有 buildExecutionMetadataPatch 和 started helper。无需新依赖或公开协议字段。

修订：2026-10-11，建立修复计划，明确产品呈现与测试启动前提两个边界。

修订：2026-10-11，记录先红后绿和 22 项新增回归。adapter 可能在 Host 观察结果前退休，允许原记录已删除但拒绝较新记录和 metadata，以保留同一原请求边界。

修订：2026-10-11，记录原生与完整门禁真实边界，归档实现与验证计划；剩余两项失败不冒充通过。
