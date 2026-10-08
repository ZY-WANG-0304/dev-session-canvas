---
title: Reset 最终保存时序与 packaged smoke 失败定位
decision_status: 已选定
validation_status: 已验证
domains:
  - 执行编排域
  - 项目状态域
  - VSCode 集成域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/completed/canvas-reset-final-persistence-investigation.md
updated_at: 2026-10-08
---

# Reset 最终保存时序与 packaged smoke 失败定位

## 背景与范围

#300 修复模拟 reload 后未恢复执行准入，完整 packaged smoke 随后在 `verifyCreateNodeCommandQuickPick()` 的 reset 空画布断言失败。本轮任务是定位该失败及产品/夹具责任；“已验证”仅指下述因果链和现有契约，未修改产品、原 smoke 断言或重跑完整 packaged gate，不声明该门禁通过。

## 已确认的因果链

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `resetState()` 先调用 `prepareForHostBoundary()`；`closeNonNativeHostExecutions()` 捕获原 Host execution records，再等待 `beginNonNativeHostExecutionClose()`。共享 owner 的关闭只等待执行、输出消费、终端最终 flush 及资源结算，不包含 Host 独立的最终保存 Promise。

`persistNonNativeHostFinal()` 把最终终端状态投影到原节点，调用真实 `persistState({ workspaceStateMode: 'full', requireRootLocalDurability: true })`。文件 writer 同步写 root-local 与 workspace snapshot，随后串行执行 `workspaceState.update()`；只有原 Promise 成功后才把 `record.persistence.result` 置为 `saved`。因此 owner 已经退役、文件也已写出时，保存结果仍可能是 pending。

owner 返回 `settled` 后，`assertNonNativeHostPersistenceComplete()` 立即检查独立保存结果。pending 会抛错，原 `resetState()` 随即拒绝，尚未进入空状态替换、`state/reset` 事件或 `tryResume()`。Webview 消息分支捕获该错误并发布 `host/error`。之后 `settleNonNativeHostPersistence()` 只记录保存事实并释放原 record；没有续跑原 reset 的代码。失败后 owner 保持 closing，显式再次成功 reset 才恢复本次关闭的准入。

夹具的 `dispatchWebviewMessageForTest()` 返回的是消息派发后的即时 snapshot，不是 reset 完成的 Promise。`verifyCreateNodeCommandQuickPick()` 只发一次 reset，然后轮询空画布，未根据错误结束本次断言，也没有在保存确认后发起另一项操作。故“后来保存已成功、画布仍未空”符合已经中止的调用链，继续等待该次 reset 不会使它成功。

## 原工件证据

复核 #300 修后原日志和工件，位置为 `dev-session-canvas3/.debug/packaged-smoke-reload/`。原 VSIX 是该工作树的 `dev-session-canvas-0.26.0.vsix`，SHA256 为 `dcbb22844590384f3ea51f37d551eae0cee1656790ed0cc1f443ca83e060b270`；其 `extension/dist/extension.js` SHA256 为 `6d91770203e2fc956705fc894c1354c3309479a9a2c0d4e2ce6f6808c743839a`。本轮只读原文件，没有重写或追认原失败。

| 证据 | 可确认事实 |
| --- | --- |
| `failure-host-messages.json` 数组第 18 项（从 0 计） | `Local final snapshot persistence is pending: agent:agent-2-52bae1e9-721c-4b81-bf8f-47157a2fa50d`，栈经 `assertNonNativeHostPersistenceComplete`、`closeNonNativeHostExecutions`、`prepareForHostBoundaryCore`。消息本身无时间戳，不补造拒绝的精确毫秒。 |
| `failure-diagnostic-events.json` | 同一 Agent 在 `04:33:04.554Z` 确认 EOF / finalRevision 2；`04:33:04.562Z` 记录 `local-final-snapshot` 的 workspace 文件写入；`04:33:04.584Z` 记录 `submitted=true, result.kind=saved`。22ms 是文件写入诊断到完整保存诊断的间隔，不能据此归因为磁盘慢或某一条具体 update 慢。 |
| `failure-snapshot.json` | 仍有 3 个节点；该 Codex Agent 已为 stopped、liveSession=false、outputSequence=2。另一 Claude Agent 为命令缺失，其保存记录 `not-required`，并非 pending 错误指向的执行。 |
| `failure-host-messages.json` 第 12 项与原 bundle `183:147790` | `Owned terminal mutation admission is closed` 的调用位置精确落在 `queueNonNativeHostResize()` 中的 mutation guard。按 UTF-16 列号核对原 VSIX，未拿后续重建 bundle 代替。 |

resize 在真正提交原生尺寸修改前被 guard 拒绝，该分支不设置 `record.mutationError`，也不修改保存结果。原消息未带节点身份，不能断言具体是哪一个 Agent 或 guard 的哪一个条件命中。受控对照证明没有 resize 也会发生相同 reset 拒绝，且有排队 resize 时它被拒绝仍能保存成功；因此该错误不是当前 pending 拒绝的必要原因，不据此扩修终端交互。

## 正式方案与责任划分

本轮保留 `runtime-exit-integrity-production-integration.md` §26.3 已有规则：reset/delete 在原执行关闭后若保存仍 pending，明确中止；保存成功后允许再次操作；failed/unconfirmed 保留原记录及节点，不自动重试。历史 §50 也记录过相同清理拒绝。这是产品显式选择的可中止操作策略，当前证据没有发现实现违反该策略。

产品负责这条立即中止、不会自动续跑的行为，以及失败后仍关闭准入、需用户再次 reset 的操作体验。夹具负责其“单次发出后必然最终清空”的断言；该假设与当前策略不一致。将责任拆开不等于把失败简单归为测试问题：若产品目标要求运行中 Agent 一次 reset 就能收尾，应先把有限等待的截止点、失败/未知保留、节点身份保护及保存迟到后的行为写成新契约，再实现并验收。

若继续沿现有产品契约修订 smoke，应显式覆盖“pending 被拒绝且节点保留 → 原保存成功 → 再次 reset 清空”的分支；保存 failed/unconfirmed 必须报失败。不能无条件吞掉 host/error、定时重试 reset、提前强开准入或延长空画布轮询。本轮未改原用例；完整 packaged / clean-checkout 验证仍属原债务的后续交付。

## 验证与边界

`scripts/test/test-host-execution-owner-wiring.mjs` 新增 6 项测试，全部调用真实 Host/owner 方法。4 项分别使用 Agent/Terminal 与保存成功/失败：从运行中执行发起 reset，暂扣真实 `workspaceState.update()`，读回真实 root/workspace 文件，验证原 reset 拒绝、晚到保存不恢复操作；成功后显式再次 reset 写出空文件并恢复准入，失败后再次 reset 保留原记录且不追加写入。另 2 项启用当前 execution profile，比较有/无排队 resize，验证同一 reset 结果、真实 resize guard、关闭边界解除及保存后再次 reset 成功。

Node 22.23.3 定向 6/6 通过。本轮未修改生产代码，故不把测试描述为“先红后绿的修复”；它们是现有行为的确定性复现及恢复/失败边界验证。完整 Host 接线 302/302、脚本语法与 diff 检查通过，日志见关联完成计划。注入的 provider 和 workspaceState 不是实际 VS Code/PTY；原 packaged 工件提供真实宿主失败证据，但本轮没有真实宿主再次 reset 成功的运行证据，也不扩称跨平台验收。
