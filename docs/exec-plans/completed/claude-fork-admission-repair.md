# 修复 Claude Fork 准入阻塞与历史 fixture 生命周期

本计划按 `docs/PLANS.md` 维护，目标是让历史会话 smoke 在交接前结束自身自动启动意图，并让 Host 在尚未创建 owned execution record 时也能把容量拒绝投影为可重试失败。完成后，Claude/Codex 分叉断言继续等待真实 `execution/started`，不放宽准入限制。

## 进度

- [x] 在 `tests/vscode-smoke/extension-tests.cjs` 收口侧栏恢复、侧栏 Fork 和不支持分叉来源的临时 Agent。
- [x] 在 `CanvasPanelManager.reportWebviewExecutionStartFailure` 补齐 reserve 前容量拒绝投影，保留旧执行身份保护。
- [x] 增加 Host 回归并通过类型检查、Host 全量 wiring 和 trusted VSIX smoke。
- [x] 同步设计文档、核心原则和技术债，提交并推送 PR314。

## 意外与发现

修复前，侧栏函数只等待节点创建；其 `pendingLaunch=start` 会在后续基线回写时重放。Host 容量 guard 位于 `owner.reserve` 前，无法复用已有 record-bound rejection projection。新增 smoke 收口后，trusted VSIX 继续触达并通过原 unsupported source 用例，说明该用例也需要在恢复基线前结束临时 Agent。

## 决策记录

- 决策：侧栏临时 Agent 等待 `pendingLaunch` 清除，再调用既有 `ensureAgentStopped`，不固定 sleep、不删除节点。理由：保留真实启动/失败/退休生命周期，并让 baseline 只保存已收口节点。
- 决策：只有 `!original && !current` 且错误明确为本地最终快照容量/执行 key guard 时，才在 `reportWebviewExecutionStartFailure` 清除新请求的 pending intent。理由：同 key 旧执行仍在时必须保留原责任，避免把新请求错误投影到旧节点。
- 决策：容量错误仍记录 `execution/startRejected` 并显示统一“等待 pending 操作”提示；resume 意图投影为 `resume-failed`，fresh start 投影为 `error`。理由：与已有 typed `rejected-before-acquire` 语义一致。

## 结果与复盘

产品和 smoke 修复已完成。Host wiring 全量通过；trusted VSIX packaged-payload smoke 通过，覆盖原完整 trusted 顺序直到搜索/双击收尾。未放宽 `pending=2` 或 `starting=1`，未自动重试拒绝。调查中受控重叠实验触发的 resize 分支仍作为独立技术债保留。

## 上下文与定向

`CanvasPanelManager.startNonNativeHostExecution` 在 `owner.reserve` 前检查本地最终快照容量。已有 record-bound 路径由 `projectNonNativeHostStartRejection` 处理；本修复覆盖该 guard 直接抛异常、没有 `NonNativeHostExecution` record 的路径。`tests/vscode-smoke/extension-tests.cjs` 的侧栏恢复和 Fork UI 节点会由 Webview effect 自动发送 start；`pendingLaunch` 是动作意图，不是静态历史字段。

## 工作计划

先在产品报告函数中识别无 record 的容量拒绝，校验节点仍是原 metadata、仍处于 waiting 状态且 pending intent 未被替换，再写入失败投影。接着给侧栏临时 Agent 增加按节点差集的生命周期屏障，并在 unsupported source 的基线恢复前复用同一屏障。最后执行 `npm run typecheck`、`node scripts/test/test-host-execution-owner-wiring.mjs` 和 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:vsix-smoke`。

## 验证与验收

Host wiring 新增用例占满两个 pending owned starts，向第三个 Agent 发起 Webview start；预期没有第三条 record，节点变为 `error`、`pendingLaunch` 清除、只发送一条 host error 和 `execution/startRejected`。原有 wiring 全量通过。trusted packaged-payload smoke 在 Linux x64 / VS Code 1.141.0 / fake provider 下 exit0；原 Claude/Codex Fork 仍通过唯一 started 事件和原 launch 参数断言。

## 幂等性与恢复

状态投影每次都验证原 metadata 引用、节点状态和无 live session；更新或取消的新意图不会被旧拒绝覆盖。测试临时 Agent 仍保留在画布中但被停止并等待退休，基线回写只替换无 active owner 的节点。打包产物和 smoke runtime 是可删除的隔离输出，不提交仓库。

## 证据

类型检查通过；`scripts/test/test-host-execution-owner-wiring.mjs` 通过全部既有与新增用例；`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:vsix-smoke` 通过。调查根因证据仍见 `docs/references/smoke-reload-autostart/claude-fork-admission-root-cause-evidence.json`。

修订说明：2026-10-11 完成产品投影、smoke 生命周期屏障、Host 回归与 trusted VSIX 验证，计划归档。
