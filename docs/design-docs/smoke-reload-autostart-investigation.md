---
title: smoke 重读画布后自启动超时的根因与修复边界
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层, 画布呈现层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-resume-exit-summary-repair.md, docs/exec-plans/completed/runtime-resume-exit-summary-investigation.md, docs/exec-plans/completed/runtime-scrollback-snapshot-repair.md, docs/exec-plans/completed/runtime-scrollback-snapshot-investigation.md, docs/exec-plans/completed/runtime-start-admission-repair.md, docs/exec-plans/completed/runtime-start-admission-investigation.md, docs/exec-plans/completed/runtime-root-storage-repair.md, docs/exec-plans/completed/runtime-root-preparation-investigation.md, docs/exec-plans/completed/owned-claude-file-confirmation.md, docs/exec-plans/completed/claude-resume-context-investigation.md, docs/exec-plans/completed/smoke-link-stop-fix.md, docs/exec-plans/completed/smoke-link-stop-investigation.md, docs/exec-plans/completed/smoke-lifecycle-barrier-fix.md, docs/exec-plans/completed/smoke-lifecycle-barrier-investigation.md, docs/exec-plans/completed/owned-launch-preparation-failure.md, docs/exec-plans/completed/smoke-reload-autostart-investigation.md, docs/exec-plans/completed/canvas-owned-execution-reconciliation.md, docs/exec-plans/completed/smoke-current-execution-output.md, docs/exec-plans/completed/resize-admission-investigation.md, docs/exec-plans/completed/owned-startup-resize.md, docs/exec-plans/completed/owned-agent-exit-notification-investigation.md, docs/exec-plans/completed/owned-agent-exit-notification-repair.md, docs/exec-plans/completed/owned-agent-resume-failure.md, docs/exec-plans/completed/owned-execution-resource-drop.md, docs/exec-plans/completed/owned-execution-file-links.md, docs/exec-plans/completed/owned-start-admission-investigation.md, docs/exec-plans/completed/owned-start-admission-repair.md, docs/exec-plans/completed/snapshot-only-manual-reload-recovery.md]
updated_at: 2026-10-10
---

# smoke 重读画布后自启动超时的根因与修复边界

## 背景与范围

PR #313 在 `verifyAutoStartOnCreate` 等待 Agent live 超时。此前将它简称为“reload 后自启动超时”，容易误解成真实窗口重启或扩展升级失败。实际调用的是 `reloadPersistedStateForTest`：它在同一个 `CanvasPanelManager` 中重读画布，不重建 Extension Host。其前面的 sidebar 用例已经多次整图 seed。

调查基线为 `origin/main@78c58c2a2cecd053199c9bada6084868f9255877`；PR #313 `aaeb73a015ac382d6074a760e91aee038bb3dd9a` 的产品和 smoke 代码与该基线相同，仅发布静态材料不同。原失败为 0.26.1 VSIX，受控复现使用 main 的 0.26.0 版本字段和相同产品代码。本次没有混入旧扩展或旧 Supervisor，不依赖实际 Codex/Claude 服务。

初次交付为故障归因与原生复现。用户随后授权在 PR #314 修复；修复计划见 `docs/exec-plans/completed/canvas-owned-execution-reconciliation.md`，下文分别记录基线故障和修复验收；“已验证”只覆盖具名场景，不代表完整发布门禁通过。

## 基线故障归因

**此次超时由活动执行与重读后的画布状态失配导致。smoke 存在用例污染，插件也存在用户可达的同类生命周期缺陷；跨版本兼容不是本次失败的必要条件。**

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 在基线中的 `loadReconciledState` / `reconcileSeededStateForTest` 仅向 `reconcileRuntimeNodes` 传入旧的 `agentSessions`、`terminalSessions`。当前原生本地执行保存在 `nonNativeHostExecutions`，未参与重读后的 live 状态恢复。因此重读或 seed 时，仍在运行的 Agent 被改成 `resume-ready`、`pendingLaunch=resume`、`liveSession=false`，Terminal 被改成 `interrupted`。同时 normalize/reconcile 建立新的 metadata 对象，而原执行记录仍保存旧 metadata 引用。

这同时破坏两项约束：画布不再反映真实活动执行；原执行的输出、resize 和最终保存不再拥有当前节点的身份绑定。`projectNonNativeHostBusiness` 会拒绝投影并记录 `The original execution metadata binding changed.`。相同 node ID 的恢复请求进入 `startNonNativeHostExecution` 时，原记录仍占据同一个执行 key，触发 `Local final snapshot responsibility still occupies the execution key or Host capacity.`。这次受控复现中触发的是同 key 占用：只有两条正在运行的记录，没有待准入请求或已退休但保存失败的记录；owner 的 `closing=false`。

此刻 `persistence.submitted=false` 是因为原执行尚未结束，不能把它解释为“最终保存失败导致启动超时”。身份失配会进一步阻止后续可靠保存，但不是必须等到保存失败才出现超时。延长等待或跳过身份校验都不能使状态与执行重新一致。

### smoke 中的首次污染

`tests/vscode-smoke/extension-tests.cjs` 的 `runTrustedSmoke` 创建基础节点后，先跑 sidebar、Note 和尺寸持久化用例，最后才跑 `verifyAutoStartOnCreate`。`verifySidebarNodeList` 为测试侧栏文本添加 `sidebar-sanitized` 节点，通过 `setPersistedState` 替换整图，再恢复来自 debug JSON 的 baseline；两次都不会保留活动执行的 metadata 引用。

原失败现场的 Agent 在 `12:26:50.156Z` 已确认启动，`50.917Z` 首次 seed，`51.021Z` 已开始请求 resume；最终尺寸重读发生在 `58.873Z`。因此最后的 reload 不是最早的破坏点。重新运行原 trusted 前缀并只增加观测，得到同一条运行中的 Agent 在 `13:59:58.792Z` 的 `beforeSeed` 中 `metadataMatches=true`，`58.796Z` 的 `afterSeed` 中变为 false；execution ID 始终为 `74224ce1-ea93-4b53-b7d2-b7260acb9a06`，adapter 始终 running。首个失配发生在 sidebar seed 内，不需要最后的 resize/reload。

### 产品中的用户可达路径

同一 manager 的 `onDidChangeWorkspaceFolders`（基线第 1576 行）也直接调用 `loadReconciledState`。在真实 VS Code 的已保存 `.code-workspace` 中，先打开一个 root 并运行 Agent/Terminal，再通过真实 `workspace.updateWorkspaceFolders` 添加第二个 root，复现如下：

- Extension Host PID 前后均为 `2646744`，确实收到文件夹变更事件，排除了新宿主启动。
- `14:00:58.643Z` 重组后，原节点 ID 被加上 `workspace-root-31741148ddcc58e3:` 前缀；旧两条执行记录仍使用未加前缀的 node ID，仍处于 running，metadata 绑定失配。
- 页面把新 ID 的 Agent 当成可恢复节点。`14:00:59.097Z` 额外确认启动了一条 Agent，execution ID 从原 `2d8a6f5e-b263-47b2-b216-0603225e6e6d` 增加到 `d4680f69-dc52-434a-bf0a-1c74f95ca910`；两次使用同一 fake-provider resume session ID。
- owner 记录从 2 条增加到 3 条，旧 Agent 和旧 Terminal 均未退休。新画布的 Agent 虽显示 live，旧执行并未得到正确迁移或结算，Terminal 显示 interrupted。

因此只把 `verifyAutoStartOnCreate` 提前，可以改善测试归因，却不能解决产品缺陷。ID 不变时表现为恢复被占用拒绝；ID 重映射时可能绕过同 key 保护而创建另一条执行，二者是同一状态重组遗漏的不同结果。

`workspace trust` 授予和 `deserializeWebviewPanel` 也调用重读逻辑，属于修复时必须审计的调用点；本轮没有把它们写成已复现的用户故障。真正的整个窗口 Reload、Remote SSH 和跨版本升级矩阵也未由本次局部实验覆盖。

## 基线受控验证

环境为 Linux x64、VS Code 1.141.0、当前原生 PTY provider、fake Agent CLI、真实 bash；每次启动新测试 profile，先 reset 空画布。工具 Node 22.23.3，VS Code 内置 Node 24.21。用例串行创建 Agent 与 Terminal，并分别确认 live，避免同时创建的准入竞争干扰本次状态替换实验。探针只读 owner/执行/metadata 身份，不改变启动、投影或保存规则。

| 输入 / 对照 | 实际观察 | 结论范围 |
| --- | --- | --- |
| 正常创建、改标题、移动节点、editor/panel 切换 | 两条执行均 live、绑定匹配、无 mutationError | 普通交互对照通过 |
| 把刚取得的完整快照原样 `setPersistedState` | Agent resume-ready、Terminal interrupted；两原执行 running；Agent 恢复遭同 key 拒绝 | 仅 seed 已足够触发 |
| 活动执行期间仅 `reloadPersistedState` | 两节点 live=false、两原执行 running、绑定均不匹配 | 单独重读也足够触发 |
| 原 trusted 前缀至首次 sidebar 测试 | seed 前后同 execution ID，绑定 true→false | 定位原用例顺序中的最早污染 |
| 已保存 workspace 从一个 root 增加到两个 | 同 PID，旧执行失去节点映射，额外启动 Agent | 产品生命周期缺陷已原生复现 |
| 正式关闭边界结算后再重读、显式启动 | 最终保存完成后原记录清空，再次重读后两节点均能启动且身份匹配 | 已结算路径可工作，不等于真实窗口 Reload 全面通过 |

最后一项保留了一个重要区别：首次 `simulateRuntimeReloadForTest` 报 `Local final snapshot persistence is pending`，没有执行状态重读；观测显示两条执行已 retired、保存已 submitted，但保存 promise 尚未完成。等待原保存事件均为 saved、原记录为空后，显式再次调用成功，再显式启动两节点成功。该测试入口只在 owner 关闭后立即检查保存结果，没有像真正的 `prepareForDeactivation` 那样等待保存 promise。这是另一个测试边界完成时序问题，不能拿它解释仍有 running 执行时的原 smoke 超时，也不能隐去第一次失败而声称单次模拟 reload 通过。

已有 Host 测试定向 7/7 通过：大快照关闭后重载恢复、原身份最终保存、模拟 reload 重新开放准入及失败保护。它们证明所覆盖的结算路径，未覆盖活动 owner 下整图 seed 或工作区 ID 重组；不能用这些通过结果否定原生复现。

一次初步实验在普通 folder 窗口调用添加 root 后，没有收到文件夹变更事件，状态也未重读，实验断言失败；它不构成产品通过或失败证据。随后改用已保存 `.code-workspace` 并等待真实事件，才得到上面的有效复现。

## 正式方案

`CanvasPanelManager.reconcileOwnedCanvasState` 统一处理 `loadReconciledState` 和 `reconcileSeededStateForTest`。活动本地执行以原节点的 metadata 引用、当前 status/summary 为权威，重读只接收其他画布内容；不将磁盘的 live、pendingLaunch 或新 metadata 对象写回原执行。原节点缺失或绑定已经被替换时明确拒绝，不能用新对象修补一个已经失真的原绑定。已提交的最终保存仍持有自己的 promise，重读不能替换这份责任。

本地 profile 执行预留时捕获画布 root 与 root 内本地 node ID。root 来源使用现有 `resolveExecutionNodeRuntimeRoot` 的 namespace/group/single-root 校验，不从进程 cwd 或标题推断。重组时先验证所有目标节点与路由唯一性，再由 `ExecutionOwnerLifecycle.rekey` 原子迁移 owner 的 key 和 Host 索引；provider 的 executionId/generation、tracker、metadata 和保存 promise 保持原身份。输出、启动诊断、最终源结果和异步准备完成后的校验读取记录当前 nodeId。迁移包括尚在准备中的预留以及已退休但仍等待保存的记录；后者只更新路由，不重新加入 owner 的活动 map。

节点 ID 改变时取消原页面 reader，新节点通过现有附着协议取得快照；旧 reader 的结果不能结算新 reader。尚未开始派发的 Terminal 初始输入随节点路由移动，已开始的派发按原请求报告取消；准备失败也清除新路由上的初始输入，避免后续启动误执行旧命令。原生场景验证新路由输入与输出，受控测试验证迁移期间仍在等待的 resize 和启动准备。

工作区事件通过 `workspaceRecomposition` 串行处理。移除 root 时关闭该 root 的 reader，停止原执行并有界等待真实最终保存；在全部成功前保留旧画布和 `lastComposedWorkspaceRootPaths`。`persistState` 和 root-local 保存按这份旧组合分解，避免尾部写到仍保留的其他 root。成功后才重组并更新组合路径。等待期间拒绝新的执行预留，仍在保留 root 中的原预留可完成准备。停止未确认、保存失败或超时都保留原责任并报告错误，不清空 map、不恢复已拒绝的重组；后续显式 workspace 事件可重新核对已结算责任。Host 永久关闭前后均校验画布变更准入，迟到保存不能在关闭后继续重组。

`simulateRuntimeReloadForTest` 在现有 Host boundary 内启用最终保存等待。边界开始前仍检查进行中的创建，仍使用原总时限和关闭保护；只有保存成功和重读完成才恢复复用 owner 的准入。超时后保存迟到不自动重试重读或开放准入。该可复用测试入口与真实窗口 Reload 的行为范围保持区分。

smoke 的创建自启动断言移到创建阶段；sidebar/Note/布局的整图夹具先停止并等待原 executionId/generation 的保存和退休，再显式启动后续执行场景。`CanvasDebugSnapshot.localExecutions` 提供这些测试完成条件，不作为产品 UI 或新的运行协议。新增 `owned-canvas-reconciliation` 场景默认进入源码 smoke 和 VSIX smoke，可用 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=owned-canvas-reconciliation` 单独执行；有过滤的成功只代表该场景。

## 修复验收与剩余门禁

Host 回归覆盖 Agent/Terminal 同 ID 重读、root ID 往返、运行中输出与 resize、原最终磁盘保存、缺失/替换绑定拒绝、原子路由冲突、移除 root 保存失败/超时、准备中迁移、永久关闭以及模拟 reload 的单次等待。真实 VS Code 场景使用已保存 workspace、当前原生 provider、fake Agent 和 bash：添加/移除 root 保留原两条执行，额外 root 的 Terminal 保存完成后才移除，整个迁移阶段只有三条预期启动，没有额外 Agent 或绑定拒绝。

2026-10-09 的完整 `npm run test:vsix-smoke` 已通过上述场景并越过 trusted 的原 sidebar/尺寸重读/自启动失败段，但仍在 `verifyAgentExecutionFlow` 的 `burst 1` 等待失败。失败断言读取 `metadata.agent.recentOutput`；当前 `projectNonNativeHostBusiness` 不把活动终端正文实时写入该历史字段，实际输出由 `host/executionOutput` / `host/executionSnapshot` 交付。失败现场同一原生 Agent 仍 live、status 为 waiting-input，终端快照含 `[fake-agent] burst 001`，metadata 仍保留上一条执行的最终正文，且没有 `execution/ownedProjectionRejected`。这是该后续断言与现有正文通道的错位，不是本次画布绑定再次丢失。该后续断言在下一节继续修正；不能把一次过滤场景通过写成完整发布门禁成功。本 PR 保留这次原失败，0.26.1 发布仍需补齐完整门禁。

workspace trust 与 editor deserialize 都复用已修复的 `loadReconciledState`，本轮做了调用点审计，但未执行这两个独立 UI 场景。真正的窗口 Reload、Remote SSH、旧 Supervisor 与跨版本升级仍由各自矩阵验证，不由本次结果代证。

## 证据与复现

精简结构化观测在 `docs/references/smoke-reload-autostart/evidence.json`。实际使用的临时探针和实验入口在同目录 `diagnostic.patch`，复现步骤见 `README.md`。它们是调查输入，本文件才是人工复核后的归因；patch 不应用到正式产品或 CI，也不构成产品修复。

原日志 `/tmp/dsc261b-vsix.log`，原 artifact 目录 `/tmp/dev-session-canvas-clean-checkout-akdQNG/repo/.debug/vscode-vsix-smoke/smoke-runtime/artifacts`。本轮完整日志与快照在 `/tmp/dscr/.debug/rca`。远程 0.26.0 CPU profile 的配置读取热点没有与本次状态失配建立因果关系，本轮未扩展到性能修复。

## 实时正文断言修正（2026-10-10）

`tests/vscode-smoke/execution-output.cjs` 只从同 kind/nodeId/executionSessionId 的 `host/executionOutput` 或 `host/executionSnapshot` 匹配正文。输出仅按连续序号拼接，每个快照独立检查，不能跨序号缺口、重复序号或快照边界拼成 marker。`extension-tests.cjs` 捕获当前本地 executionId/generation 并在等待中持续核对同身份，同时检查 live、预期生命周期及通知状态。历史 metadata 不作为实时正文，不改写产品投影或 debug snapshot 来迎合旧测试。最终保存/恢复检查继续读取真实历史字段。

Agent 执行流的 burst、分段 hello、sleep、slowspin，以及 Terminal shell marker 均使用该方法。Terminal 的 marker 用 `printf` 格式化产生，完整 marker 不出现在输入命令中，避免只匹配 shell 输入回显。通知用例的两处同类正文条件也已迁移，并在原 20 秒预算内同时校验 attentionPending；它们未被本轮完整 trusted 跑到，不声称通知 UI 已原生复验。

退出检查依据最终状态、退出码及 summary/lastExitMessage 一致性，并等待原记录完成保存、退休后再重启。停止后 resize 改为验证保存的原尺寸和序列化正文保持不变：`resizeExecutionSession` 与既有 completed-snapshot 契约要求按原尺寸还原保存内容，然后由页面 reflow，旧 smoke 要求把历史尺寸改成 100×30 已不适用。

独立执行流还确认了一处产品遗漏：`startAgentSession` / `startTerminalSession` 的重复启动检查只认识旧 session map，当前运行的原生记录未进入正常 already-running 分支。新增 `hasRunningLocalOwnedExecution` 后，未停止、未结算、没有进程结果的原生执行沿用原 host/error 提示和附着行为。原 executionId/generation、metadata 和 provider 数量保持不变；停止中、最终保存或未知责任继续由原保护处理，不借本次调整释放。对应 Agent/Terminal 回归修前抛出同 key 占用错误，修后正常报告拒绝。smoke 保留明确拒绝提示，并增加原身份和 started 数量不变断言。

默认源码及 VSIX smoke 增加 `local-execution-flow`，独立验证这组 Agent/Terminal 操作；默认入口仍执行 trusted。2026-10-10 最终结果：正文正反例 14/14、Host 356/356、completed-snapshot resize 16/16、runner 检查和 VSIX 内 typecheck/build/package 通过。默认 VSIX 中 owned reconciliation 与 local execution flow 两个阶段通过，完整命令仍失败。

该轮完整失败在 `verifyRealWebviewProbe` 的 `toastMessage === null`：页面残留 `Execution terminal interaction admission is closed or unsupported`，调用栈为 `queueNonNativeHostResize → OwnedExecution.resize → ExecutionSessionAdapter.interact`。两次完整运行分别捕获相同错误，当时未保留拒绝瞬间状态，不能从最终已停止并保存的节点快照推断它发生在 stop。后续专项诊断见下一节。保留该页面错误断言和全部首次失败，不能清 toast、忽略 resize 错误或用具名阶段成功替代完整发布门禁。过程与证据见 `docs/exec-plans/completed/smoke-current-execution-output.md`、`docs/references/smoke-reload-autostart/output-assertion-evidence.json`。

## 原生 resize 准入错误的后续定位

2026-10-10 在 `15328fe9` 产品代码上只增加状态和调用栈记录，两次真实 VSIX trusted 均捕获启动期间的同类错误，共四次。请求来自 VS Code 的真实 `$onMessage` / Webview 回调，内容为 Agent 的 77×26 尺寸同步；不是测试合成 resize。拒绝瞬间 adapter 为 `starting`，`interactionCapable=false`；原 owner `stopRequested=false`、`closing=false`，没有隔离原因，也没有 process/source/seal 或交互关闭原因。同执行在约 1.3–2.0 秒后又收到 running 阶段的 resize 请求。未混用旧版本资产或执行旧版本升级，现有证据指向启动协调缺口。

因果链如下：`startNonNativeHostExecution` 在等待 provider 就绪和 started 之前已经建立 `record.business`；页面 `executionSessionNodes.tsx` 的终端 fit 在已应用快照后正常报告尺寸，未以 adapter 的 running 为前提；Host 的 `resizeExecutionSession` 看到 business 就将请求放入 `terminalChain`，`assertNonNativeHostMutation` 没有阻止 starting 阶段派发。底层 `ExecutionSessionAdapter.interact` 要求已声明交互能力且状态为 running，因此正确拒绝；Host 把拒绝作为 `host/error` 发到页面。测试随后读取到 toast，暴露了产品缺陷。

测试调用 `startFixtureExecutions` 时使用 80×24，而实际页面为 77×26，会增加同步尺寸落入启动窗口的机会，但尺寸变化本身是正常页面行为。用户在启动中调整节点、页面自动 fit 或重启已有终端都可能需要同样协调；具体场景频率尚未统计。将 smoke 的启动尺寸硬改为页面尺寸或增加固定等待，不能修复 Host 接收到合法视口意图时的处理缺口。

移除全部临时产品诊断后，用原 Host/owner/adapter 和可控 provider 做四项特征验证：Agent/Terminal 分别拦住 ready，以及拦住 ready 后的 started 确认。四项都复现相同错误、无原生 resize 消息且原尺寸不变；释放屏障后同执行进入 running，先前请求没有自动补发，再发相同请求则确认成功并更新尺寸。**4/4 通过表示诊断预期成立，不表示缺陷已修复。** 可复跑 patch 与证据见 `docs/references/smoke-reload-autostart/resize-characterization.patch`、`resize-diagnostic.patch`、`resize-admission-evidence.json`。

后续修复应在 Host 协调准备中、starting、running 与关闭阶段：启动期间保留最新尺寸意图，确认同一执行 started 后再应用，失败/取消时明确结算。不得在正文消费链上等待一个依赖正文消费才能完成的启动事件；不能放宽底层未就绪准入、假装 native resize 已完成，或取消停止/最终保存/隔离保护。该诊断轮仅完成定位与边界记录；后续实施见下一节。

## 启动期间尺寸同步的正式方案

用户授权 PR #314 继续修复后，`CanvasPanelManager` 沿用每条原执行的单个 `pendingResize` 保留最新视口意图。准备中与 adapter starting 时不占用 `terminalChain` 等待；确认运行后才将 resize 排到当时的正文消费链后。准备失败与生命周期改变结算 pending 等待。启动前只保留一个视口意图，provider 启动受 owner 原有启动期限约束；执行首次就绪后才为该尺寸请求建立 5 秒交互期限。进入交互阶段后期限不因输出或生命周期事件续期，新意图替换旧意图时拥有自己的期限。

Host 内部结果区分 applied、superseded 和 cancelled：只有原生确认后提交 tracker 才算 applied；正常停止、源结束或最终状态到达时，尚未派发的请求按 cancelled 结算，不产生用户错误，也不改变原生尺寸/快照。已发送的交互由 adapter 原有观察负责；已确认 resize 即使紧邻关闭也完成原 tracker 提交，failed/unconfirmed、绑定替换或提交失败仍报告错误。底层协议和 RuntimePersistence 开启路径不改变。`resizeExecutionSession` 也接收本地执行准备阶段的尺寸意图；Host stop/delete/close 在准备尚未安装 owner 回调时仍显式结算 pending 请求。真正失败使用带原执行身份的 `execution/resizeRejected`（`owned-resize-failed`）记录后继续展示错误。默认三个 smoke 场景在清理诊断及结束前检查该错误，保留原空 toast 断言。

2026-10-10 实施验证：完整 Host **376/376**（新增 20 项）、类型检查、VSIX 构建与打包通过。回归覆盖准备/ready/started 三个窗口的 Agent/Terminal 最新尺寸、慢启动与启动超时、准备/启动失败、准备中停止、正常停止/源结束/authority 关闭、真实页面输出消费确认与 metadata 替换拒绝；复用原有已确认 resize 紧邻 stop/exit、未知效果与 tracker 提交失败、root 路由迁移和最终保存验证。旧实现的最新尺寸保留回归修前失败，修后通过。

默认真实 VSIX 的 owned reconciliation 与 local execution flow 均通过；trusted 通过原页面 probe、执行重启与普通 attention bridge，清理诊断前检查未发现本地 resize 失败。完整命令仍在独立异常退出通知等待处失败，未把这次结果写成发布门禁通过。源码改动限定 Host 尺寸编排与 smoke 失败检查，无临时诊断探针。证据见 `docs/references/smoke-reload-autostart/resize-repair-evidence.json`，执行过程见 `docs/exec-plans/completed/owned-startup-resize.md`。

旧两次失败缺少瞬时状态，不能追认每一次历史 toast 都发生于 starting。本次两次诊断运行均通过原 `verifyRealWebviewProbe`，随后在执行重启及通知场景捕获同类 starting 错误；还捕获一次 `stopRequested=true` 的 Host 层 `Owned terminal mutation admission is closed.`，这是另一种拒绝，需要单独明确过期尺寸请求的结算语义。两次诊断完整流程最终均在 `verifyAgentAbnormalInterruptionNotifications` 等待 `execution/attentionNotificationPosted` 超时，节点已 error、退出码 27、attentionPending=false；当时通知根因尚未定位，后续专项结论见下节。普通 attention bridge 场景在这两次运行中完成，但完整门禁仍未通过。

## Agent 退出码 27 后通知缺失的专项定位

2026-10-10 基于 PR #314 `e872865b` 确认：**这是 snapshot-only 本地 owned 执行的业务通知接线遗漏，smoke 等待条件有效。** `CanvasPanelManager.persistNonNativeHostFinal` 已正确核对原执行、消费尾部并将节点保存为 error/lastExitCode=27，但它和调用它的 `finalized` 回调都没有调用 `markAndNotifyAgentAbnormalInterruption`。旧本地 session 的退出回调与 Supervisor 的最终快照路径有该调用。新路径因此完成了进程退出、终态保存和页面快照交付，却没有设置 attentionPending，也没有进入通知发布逻辑。

真实 Linux VSIX 的 `Codex Crash Smoke` 节点使用 `RuntimePersistence=false`。用例设置 workbench 模式、启用 `agentAbnormalExit`，并关闭单独的异常正文文本通知。超时瞬间事件确认 18:49:23.946Z 原执行 started，18:49:25.783Z 最终保存 saved，18:49:26.662Z 原 reader applied 到序列 3；最终正文包含 `exit 27` 和 fake provider 的退出确认。节点 error、lastExitCode=27、attentionPending=false。超时窗口中没有该节点的 posted、suppressed 或 acknowledgement 事件。证据取自 `failure-error.txt` 的 `Last events`，不能用 finally 清理后的空诊断文件推断未通知。

受控验证加载原 Host/owner/adapter，仅替换 provider transport 并拦截通知展示。通过真实 Host 输入写入并确认 written，使业务状态先进入 running，再提交同执行的退出结果、输出终结和资源释放：

| 对照 | 自动退出路径 | 显式调用既有通知入口 |
| --- | --- | --- |
| Codex 非主动退出 27 | error、保存成功，通知入口调用 0 次，attention=false | 同配置及退出前上下文，posted=1、展示调用=1、attention=true |
| Claude 非主动退出 27 | 与 Codex 相同 | 与 Codex 相同 |
| Codex 正常退出 0 | stopped、保存成功，无通知 | 策略拒绝通知，attention=false |
| Codex 主动停止后返回 27 | stopped、保存成功，无通知 | 携带 stopRequested=true，仍不通知 |

四项特征对照 **4/4** 成立，表示复现缺口及验证正向路径，不是产品修复通过。相同环境中直接调用原入口能够发布，结合 workbench 分支仍记录 `execution/attentionNotificationPosted`，排除了本次 smoke 使用旧事件名或通知渠道失效的解释。正文文本开关与 `agentAbnormalExit` 是两个信号；关闭前者不应关闭异常退出提醒。此前 owned OSC/BEL 接线修复见 `notifier-companion-architecture.md`，覆盖的是正文信号，本次是另一条退出结果入口。resize 问题也有独立触发链，不能用它解释这次已成功保存后的通知缺失。

历史审计发现 `b235a7bc` 首次引入 `persistNonNativeHostFinal` 时即无该通知调用，当时仍是默认关闭的接入；因此缺口先于 PR #314 的 resize 改动，但这一条历史证据不能单独确定默认用户首次受影响的版本。当前正式路径的修复应接回原异常退出策略，保留退出前 running/waiting-input 上下文与 stopRequested、provider、原执行身份，并协调提醒状态与最终保存的顺序。正常退出、用户停止、旧记录或重复终态不得产生误报，通知投递也不能阻塞原终态结算；不应只补一条诊断事件或延长 smoke 超时。

本轮仅完成定位，没有修改产品通知逻辑或 smoke 断言。RuntimePersistence 开启的 Supervisor 路径只检查了源码调用点，未原生复验；系统通知弹窗、真实 Agent 服务、其他平台和跨版本兼容不在本轮证明范围。完整 trusted 仍被此缺陷阻塞。可复跑临时特征 patch 与精简证据见 `docs/references/smoke-reload-autostart/exit-notification-characterization.patch`、`exit-notification-evidence.json`；临时测试改动已恢复，计划见 `docs/exec-plans/completed/owned-agent-exit-notification-investigation.md`。

## 本地 Agent 异常退出通知的正式方案

PR #314 获授权继续修复后，`CanvasPanelManager.persistNonNativeHostFinal` 在原身份、metadata、已确认进程和最终输出验证通过后，利用已有 submitted 防护调用共享 `markAndNotifyAgentAbnormalInterruption`。通知上下文仅包含原 executionId、owner stopRequested 和 business 中的退出前生命周期、provider、显示标签及通知状态，不构造旧 process/session 对象。复用原信号开关、非主动非零退出、运行/等待输入状态及正文覆盖策略。

调用方延后提醒 setter 的独立保存与页面同步，由同一最终快照保存 error、退出码和 attention 标记，再统一发布状态。通知入口首次异步等待前已更新提醒；外部渠道投递不阻塞原保存或执行结算，拒绝记录独立通知失败诊断。重复终态及旧绑定仍由原提交/身份校验拒绝，投递完成后不再次修改节点。旧本地 session、Supervisor 和普通正文提醒默认同步方式保持不变。正文覆盖抑制诊断保留 `covered-by-abnormal-stream`，避免退出 detail 覆盖原因；workbench 展示 promise 的拒绝也记录独立失败，继续异步展示。19/19 定向回归已通过，完整验证结果见下段，计划见 `docs/exec-plans/completed/owned-agent-exit-notification-repair.md`。


2026-10-10 实施验证：修前正式回归因 attention 未置位失败；修后新增 19 项、完整 Host **395/395**、类型检查与 notifier source 验证通过。覆盖 Codex/Claude 的 running/waiting-input、正常退出/主动停止/未运行状态/信号关闭、正文覆盖、重复及旧绑定、投递挂起/失败、workbench 拒绝和保存失败。投递挂起时通过原 Host reader 完成入口确认，原执行仍可退休；提醒在原最终保存中，不依赖额外普通保存。

默认真实 VSIX 完成构建打包，owned reconciliation 与 local execution flow 两阶段通过。trusted 已通过 Codex **exit 27** 的事件/attention/提示、关闭信号后的 exit 29 抑制、后续正文通知用例，以及 Claude **exit 33** 的事件/attention/提示和用户确认。原通知缺口已收口。完整命令随后在同一测试函数后段的 Claude 恢复启动失败检查超时：期待 `resume-failed`，实际 `error`、lastExitCode=33、attentionPending=false、lastResumeError 缺失，原执行已保存并退休。此处没有误发通知；当前本地终态分类缺少旧路径的 `resumePhaseActive → resume-failed` 分支，是单独的恢复状态缺口，本次未修改该分类或 smoke 断言，仍阻塞完整 trusted。相关通知事件被后续子用例清理，本次以原脚本顺序和失败栈位置证明已通过的断言，不把最终空诊断当作通知未发生。证据见 `docs/references/smoke-reload-autostart/exit-notification-repair-evidence.json`。


## 本地 Agent 恢复启动失败的正式方案

PR #314 继续补回 snapshot-only 的恢复阶段终态语义。`CanvasPanelManager.persistNonNativeHostFinal` 先沿用正常停止/退出判断，再对原 Agent 的 `business.resumePhaseActive` 选择 `resume-failed`；该标志已在实际恢复启动时设置，并在输入确认或正文观察进入 waiting-input 后清除，不以 launchMode=resume 终身判作恢复失败。消息复用 `describeAgentResumeFailure`，同时保存 summary、lastExitMessage 与 lastResumeError；原正文不完整信息继续追加。普通 Agent 终态以及新尝试的 business 投影清除陈旧恢复错误。

原身份、metadata 和 process/source/finalRevision 检查先于新分类；失败未知不能伪造恢复失败完成。恢复期失败不触发运行期异常通知，恢复完成后异常退出沿用 error 通知。终端状态、严格最终保存及 reader 结算不改变。实施与验证见 `docs/exec-plans/completed/owned-agent-resume-failure.md`。


2026-10-10 验证结果：恢复期非零退出回归修前得到 error 而非 resume-failed；修后定向 **14/14**、完整 Host **409/409** 与类型检查通过。两 provider 均从真实 resumeRequested 和恢复 identity 启动，覆盖非零/信号失败、正常退出、主动停止、实际输入或提示完成恢复后再失败、未知 process，以及恢复原因与原正文同次保存和旧错误清除。

默认真实 VSIX 构建打包及 owned reconciliation、local execution flow 均通过；trusted 的整个 `verifyAgentAbnormalInterruptionNotifications` 已完成，包括原 Claude 恢复失败状态/无提醒检查和新增 lastResumeError、summary、lastExitMessage、resumeSessionId 一致性检查。恢复失败缺口已收口。随后 `verifyExecutionTerminalNativeInteractions` 在拖放文件路径验证超时：原 Terminal live，同 executionId 已交付 `DEV_SESSION_CANVAS_NATIVE_DROP:`，但没有路径；诊断为 `execution/dropResourceRejected`、reason=missing-session。源码 `handleDroppedExecutionResource` 只查旧 session map，未接当前 owned 执行；测试又仍从历史 metadata.recentOutput 等待实时正文。两项都需要后续处理，不能只改断言或声称完整门禁通过。本轮未修改拖放入口及该测试；原现场及精简证据见 `docs/references/smoke-reload-autostart/resume-failure-repair-evidence.json`。


## 本地执行终端资源拖放的正式方案

`CanvasPanelManager.handleDroppedExecutionResource` 复用 `captureExecutionInputTarget` 对当前节点、原 metadata、执行记录、停止及关闭状态做准入校验。owned 分支使用捕获的 `record.launchSpec.file/cwd` 交给既有 `prepareExecutionTerminalDroppedPath`，再直接调用 `writeNonNativeHostInput(record, preparedPath)`，等待原执行的实际写入确认；缺少启动上下文时拒绝，不借用新设置或旧 session。准备至写入之间不增加异步等待，写入等待后不会根据 nodeId 改投替换执行。旧 session/Supervisor 继续使用其自身 shell/cwd 与既有输入方法。

`verifyExecutionTerminalNativeInteractions` 从启动后捕获的原 executionId/generation 对应消息检查拖放、文件和 URL 正文。保留只消费首资源、真实页面链接激活、编辑器位置、图片预览、工作目录与 URL hover/浏览器检查。多行结果等待实际相邻两行正文，并要求页面已显示这些行再激活，避免把回显或未渲染正文当作成功。执行计划见 `docs/exec-plans/completed/owned-execution-resource-drop.md`。


2026-10-10 实施验证：新增 17 项回归，修前陈旧 session 的 PowerShell 引用规则污染原 POSIX 执行，修后通过。完整 Host **426/426**、正文 helper **14/14**、路径 helper 与类型检查通过。两轮默认真实 VSIX 构建打包、owned reconciliation、local execution flow 均通过；trusted 均已通过拖放完整路径与只消费首资源、文件 2:8 定位、图片预览/opener rejection，以及 cd 后相对文件 3:1 定位。拖放缺口已收口。

完整 trusted 随后在多行文件结果 `2:8` 的文件目标断言失败：实际 `execution/linkOpened` 为 search/quickOpen。第二轮增加原执行实际两行正文和页面可见相邻两行等待，两者通过后仍复现，排除仅由命令回显或页面未渲染导致提前点击。源码发现 `getExecutionTerminalPathContext` 的逐行 cwd resolver 只接旧 session tracker，未接 owned business tracker；这一缺口与本次失败的完整因果对照尚未完成，本轮未改链接解析器或弱化文件目标断言。后续缺失文件搜索、URL hover/显式链接及 Runtime 场景未触达，完整门禁仍未通过。精简证据见 `docs/references/smoke-reload-autostart/resource-drop-repair-evidence.json`。


## owned 执行逐行文件链接上下文的正式方案

`CanvasPanelManager.getExecutionTerminalPathContext` 优先从捕获的 owned record 的 `launchSpec.file/cwd` 提供启动上下文，并将原 `business.lineContextTracker.getCwdForBufferLine` 接入文件解析。此为正文的只读上下文，停止但未退休的执行仍可读取；没有 owned record 时沿用旧 session 与历史 metadata 的回退。异步目录查找捕获原 tracker，不再按 nodeId 找新执行。`ExecutionTerminalPathContext` 增加可选执行身份，相对路径 Host 缓存将它纳入键，避免重启后相同行号与文件名复用上次执行的解析结果；绝对路径不受执行身份影响。

正式验收保留实际两行正文、页面相邻行、file 事件和编辑器 2:8 位置检查。实施过程见 `docs/exec-plans/completed/owned-execution-file-links.md`，验证结果如下。


2026-10-10 根因与修复验证：真实 helper 受控回归在修前将 `/controlled/subdir/link-target.ts` 错误解析为初始 `/controlled/link-target.ts`。owned tracker 已正确记录 Terminal 确认的 cd 和 Agent OSC 7 目录，但路径上下文未接 resolver，因此解析使用初始目录。修后新增 **8 项**、完整 Host **434/434**、路径 helper、逐行 tracker 与类型检查通过。回归覆盖正文原目录与新目录同名文件的 URI/行列、陈旧 metadata、停止后只读查询、异步替换保持原 tracker、新旧执行缓存隔离，以及旧 session/历史回退。

默认真实 VSIX 构建打包、owned reconciliation、local execution flow 均通过。原 `verifyExecutionTerminalNativeInteractions` 整体完成，多行 `2:8` 现在产生 file 事件并定位到编辑器第二行第八列；后续缺失文件搜索、URL hover/清除 hover、浏览器目标及 OSC 8 显式链接也通过。本轮未修改 smoke，这使逐行 cwd 缺口与原失败完成因果闭环。

完整 trusted 随后在 `verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory` 等待 metadata.recentOutput 中的 `SCROLLBACK_PERSIST-220` 超时，此时尚未进入该函数的 simulateRuntimeReload。节点 live，metadata 仍是上一条 native interactions 的历史；finally 恢复配置后的同执行 Host 快照包含 001/220。此处为新触达的旧正文断言，不能据此判定 reload 丢失历史。本轮未修改该场景，完整门禁仍未通过，后续恢复/Runtime/压力矩阵未触达。精简证据见 `docs/references/smoke-reload-autostart/file-link-repair-evidence.json`。


## 滚动历史 smoke 运行期正文等待的正式方案

`tests/vscode-smoke/extension-tests.cjs` 的 `verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory` 在新 Terminal live 后捕获原 executionId/generation，并复用 `waitForLocalExecutionOutput` 等待原执行实际交付的 SCROLLBACK_PERSIST-220，替换对历史 metadata.recentOutput 的运行期等待。继续保留活动执行期间配置 scrollback、模拟 reload、重读 metadata 的最终序列化快照首尾行检查，以及请求页面历史快照后首尾行检查。运行期正文和停止后的保存结果分别验证，不改产品保存或 reload 逻辑、不延长超时。

此前原执行最终 Host 快照已包含 001/220，而 metadata 仍为上一条执行历史；这证明旧等待字段不适用，不能追认为 reload 丢失历史。2026-10-10 修后语法检查、正文 helper **14/14** 和失败现场回放通过。默认真实 VSIX 构建打包及两个具名阶段通过，滚动历史函数完整完成：原执行 -220、模拟 reload 后持久化快照 001/220、重新请求历史快照 001/220 均通过；后续 editor/panel 标签切换视口及主题跟随也完成。该旧正文断言阻塞已收口，本轮没有产品变更。


完整 trusted 随后在 `verifyRuntimeReloadRecovery` 的首次 Agent live 等待超时，尚未执行该场景的 simulateRuntimeReload。Codex Agent 仍 stopped/liveSession=false，只有新 Terminal 为活动本地执行；日志显示 `Non-native Host start was rejected-before-acquire` 和未处理的 promise 拒绝。这是滚动历史修复轮新触达的独立启动阻塞；当时尚未归因，后续专项定位见下一节。该修复轮未改启动路径或该用例。精简证据见 `docs/references/smoke-reload-autostart/scrollback-smoke-repair-evidence.json`；不把具名成功写成完整门禁通过。


## 后续首次启动准入拒绝：根因与修复边界

2026-10-10 在 PR #314 基线 `2b828114` 完成专项调查。**smoke 的两个启动重叠触发正式 `starting: 1` 限制；底层拒绝符合契约，但 snapshot-only owned 启动拒绝没有被页面入口消费，属于另一个产品反馈缺口。** 本轮只定位，没有修改正式启动行为或该 smoke。

### 原生拒绝时序

原用例 `verifyRuntimeReloadRecovery` 停止两个节点后，连续 `await dispatchWebviewMessage` 派发 Agent 和 Terminal 启动，再等待两者 live。`dispatchWebviewMessageForTest` 调用 `handleWebviewMessage`，后者发起异步 `startAgentSession` / `startTerminalSession` 后即返回；命令返回不表示 provider 已 started。Agent 准备还需要异步解析 CLI，因此请求先到也不保证先进入实际启动。

在当前 Linux x64 / VS Code 1.141.0 / 原生 PTY / fake Agent 的真实 VSIX 中，仅临时增加拒绝点观测，再次得到：

| UTC 时间 | 直接事实 |
| --- | --- |
| 03:18:57.662 | Agent startRequested |
| 03:18:57.672 | Terminal startRequested |
| 03:18:57.701 | Agent CLI configured-absolute 解析成功 |
| 03:18:57.707 | Agent `eb50c81c…` 的持久化责任结算为 not-required |
| 03:18:57.771 | Terminal `cb92d2be…` 确认 started |

`ExecutionAuthority.beginStart` 的临时探针直接观测到被拒的是上述 Agent，`identityMatch=true`、`closing=false`、`blockedReason` 未设置。此时 `starting=1`，唯一占槽者恰为上述 Terminal，其 state=starting；Agent 仍为 bound。`active=2` 含两条预留，并非两个进程均已运行；`admissionPending=2` 也不是该函数的拒绝条件。唯一命中的判断是 `starting.size >= admissionLimits.starting`。

`PreparedExecution.start` 在 transport.connect 之前返回 rejected-before-acquire。Host 清理未获取资源的记录并结算 not-required，Agent 最后仍 stopped/liveSession=false；Terminal 成功 live。没有发现此次 Agent 遗留资源、CLI 缺失或旧执行仍占同 key。该函数首次 `waitForAgentLive` 超时，尚未执行自身的 `simulateRuntimeReload`；此前 reload 的关闭状态也不是原因，因为拒绝瞬间 owner 已正常开放。

### 合法拒绝与错误反馈分别判断

`docs/product-specs/runtime-persistence-modes.md` §9 与容量设计 §10.17 明确 `{ executions: null, starting: 1, pending: 2 }`：允许多个活动会话，新建并发启动限 1，不排隐藏队列。故该场景若要准备两个运行中节点，应等待第一个真实 started/live 后再派发第二个；提高上限、增加固定 sleep 或延长超时都不能替代这个前提。已有 `startFixtureExecutions` 使用逐个派发、逐个等待 live 的顺序。

产品反馈缺口位于 `CanvasPanelManager`：`startNonNativeHostExecution` 对非 started 抛错，并在 rejected-before-acquire 时正确释放未获取资源的责任；snapshot-only 的 `startAgentSession` owned 分支没有 catch，Terminal owned 分支只清理初始输入后重新 throw。页面 `webview/startExecutionSession` 分支仅在 RuntimePersistence 开启时跟踪启动 promise，snapshot-only 返回后不消费此拒绝。真实日志出现 `rejected promise not handled within 1 second`，同阶段 Host 消息无 host/error，节点也没有可见启动拒绝结果。用户快速启动不同节点同样可以到达这条路径；它不只是 smoke 的等待方式问题。后续应保留合法拒绝并补齐可理解的错误反馈与诊断，且不能把旧请求错误写入替换后的新执行；本轮未实施。

### 受控因果对照与历史来源

使用真实 Host/owner/adapter 与受控 transport，在生产准入及页面 output-credit 能力齐全的夹具中挂住第一个 started 确认：Terminal→Agent、Agent→Terminal 两个顺序均使第二个请求在 connect 前拒绝（connect=0），owner/Host 不留第二条记录，没有 host/error 或 startRejected/spawnError/candidateStartFailed 诊断。释放第一 started 后再启动同一第二节点，connect=1，两个 adapter 均 running，authority active=2/starting=0。移除产品探针后两项特征验证 **2/2** 仍通过；证明限制针对重叠启动，不针对同时运行的会话数，也不依赖真实服务或 reload。

源码历史显示：`6dec5545`（2026-04-08）加入该 smoke 的连续派发顺序；`e9a3b3f7`（2026-09-24）共享核心已有 starting=1；`c1b6bc8b`（2026-09-25）接入 owned Host 启动分支时留下向外抛错路径，页面入口的仅 RuntimePersistence 跟踪来自 `005e94c7`（2026-04-09）；`7f1e1887`（2026-10-02）把正式容量收口为 executions=null/pending=2，继续保留 starting=1。它们说明旧 smoke 和 owned 生命周期契约未一起校准，不能把最后的容量提交或本轮滚动历史修正单独当成首次受影响版本；本轮未复验历史发布包。

精简证据见 `docs/references/smoke-reload-autostart/start-admission-evidence.json`。相邻 `start-admission-probe.patch` 与 `start-admission-characterization.patch` 可在 `2b828114` 应用复跑；前者仅供原生拒绝观测，后者可单独运行 `DEV_SESSION_CANVAS_HOST_TEST_FILTER='start admission characterization' node scripts/test/test-host-execution-owner-wiring.mjs`（Node 22，先安装依赖）。临时探针/测试已恢复，三个源文件 hash 与基线一致，正式代码未改。夹具调试曾缺少生产必需的 output-credit 能力、connect 计数也曾安装在 owner 复制选项之后；已校正，失败不作为产品证据。完整 VSIX 仍为失败，本轮没有用串行变体代证后续 Runtime/恢复/压力场景，也没有验证跨版本矩阵。计划见 `docs/exec-plans/completed/owned-start-admission-investigation.md`。


## 页面启动拒绝反馈的正式方案

PR #314 后续授权修复采用页面请求边界消费失败：`CanvasPanelManager.handleWebviewMessage` 为 Agent/Terminal 的启动 promise 立即注册 catch，并保留 RuntimePersistence 的操作跟踪。`startNonNativeHostExecution` 对非 started 结果抛出带原 execution identity 与原结果的内部类型化错误；明确的 rejected-before-acquire 显示“当前无法启动，请等待进行中的操作结束后重试”，其它错误显示启动失败原因，并通过同一次诊断区分结果。页面请求对比派发前后的 owned record，只捕获本请求新建的记录及 metadata，不把占据同 key 的旧执行当作新请求；失败时按原 record 的当前路由、stopRequested、当前 Host 记录及 metadata 绑定判断请求是否已取消/替换/删除，这些迟到结果只记录 suppressed 诊断，不向后续页面弹错。页面观察不解析错误文本推断资源，也不进行停止、清理或节点/metadata 写入；观察者失败不再次成为未处理拒绝。普通 Error 提示只展示 message，不把内部 stack 传给用户。内部 awaited 启动继续拒绝，已由内部处理的 Runtime 错误不重复通知。

恢复 smoke 在首个 Agent live 后捕获 executionId，等待该原执行的 started 诊断才发 Terminal；Terminal 同样等其原身份的 started 后才进入 reload 检查。早期正文可能先投影 live，不能单凭 live 保证启动槽已释放。后续恢复状态和正文断言保留，尚未触达的旧正文等待单独跟踪。该修正不放宽 starting/pending，不增加自动重试、隐藏排队或固定 sleep。实施和验证进度见 `docs/exec-plans/completed/owned-start-admission-repair.md`。


2026-10-10 实施验证：修前通过真实页面 handler 触发的并发拒绝使 Node 以未处理拒绝退出；修后新增 **20 项**、完整 Host **454/454**、类型检查、UI 本地化和正文 helper **14/14** 通过。覆盖双向重叠拒绝/释放后重试、准备失败/关闭准入、取消/替换/删除请求的迟到反馈、旧 stopping 记录阻塞新请求、unknown 原责任保留、Runtime 跟踪与避免重复提示、诊断或页面观察者失败。内部直接调用仍按原测试 reject，原资源结算未改变。

最终默认真实 VSIX 构建打包、owned reconciliation、local execution flow 均通过。trusted 越过 `verifyRealWebviewProbe`，本轮曾出现的迟到 toast 回归路径已修复；通知/恢复失败、整个 native interactions、滚动历史、标签视口和主题检查也通过。`verifyRuntimeReloadRecovery` 的 Agent 于 03:49:28.284Z started，Terminal 请求在 28.384Z 才派发，并于 28.539Z started；原启动拒绝已收口。

**上一轮独立阻塞发生在该函数自身 reload 之后（后续修复见下节）**：两条执行最终保存均为 saved，28.688Z 返回 runtimeReloaded 后 Agent 为 stopped、Terminal 为 closed，测试期待 resume-ready/interrupted；Agent 的 resumeSupported、fake-provider 策略和 resumeSessionId 均保留。本轮未放宽状态断言或修改该恢复语义。源码线索是 Host boundary 先关闭 owned 执行并等待最终保存，`persistNonNativeHostFinal` 将 stopRequested 保存为 stopped/closed、liveSession=false，随后 `reconcileRuntimeNodes` 只为仍带 liveSession 的快照建立恢复意图；是否应区分 Host boundary 与用户主动停止，需下一轮按正式生命周期约束完成定位，不能直接以更改断言收口。后续 resuming/正文/退出和 Runtime/压力矩阵未完成。

本轮中间另有一次早期 Host boundary 报 `Local final snapshot persistence is pending`，工件保留；最终代码默认重跑跨过该点，但无法追认当次保存完成或断言它与本次 reload 状态冲突同源。根因待进一步证据，本轮未改保存期限。精简证据与各轮原工件摘要见 `docs/references/smoke-reload-autostart/start-admission-repair-evidence.json`。完整门禁仍失败，不把具名启动修复写成完整发布可用。


## snapshot-only 的 Host 中断与手动恢复正式方案

2026-10-10 用户明确产品约束：Host reload 后 `resume-ready` 是正确状态，但不自动执行 provider resume。前述旧 smoke 的 pendingLaunch=resume/自动恢复预期不能作为产品依据。

`CanvasPanelManager` 在模拟 reload、普通 deactivation 和原生 owned deactivation 的明确恢复边界中，标记原来已确认 running、尚未观测退出且未请求停止的本地执行。该标记只属于原执行记录，不新增持久化字段；reset、清空和模板替换默认不带恢复意图。`persistNonNativeHostFinal` 在既有原身份、最终正文与进程证据校验后，将被 Host 中断的 Agent 按最后确认的 provider 恢复身份保存为 resume-ready 或 interrupted，Terminal 保存为 interrupted；保持真实退出信息、最后输出和严格保存责任。用户主动 stop 优先并撤销恢复意图，已观测自然退出或从未完成启动的执行不被升级为待恢复。

`reconcileAgentNodesInArray` 对遗留 snapshot-only live 快照保留 resume-ready 判定，但不再设置自动 resume 意图；对已保存的 pendingLaunch=resume 清除旧自动意图，显式新建的 pendingLaunch=start 保持。不能把所有 stopped 记录改成 resume-ready，因为旧状态本身不足以区分主动停止与旧版本误分类。页面无需通过启用自动 resume 来修复状态。

smoke 保留原执行 started 顺序和 reload 后 resume-ready/interrupted 断言，增加没有 pending resume、页面重建后仍不启动的检查，再显式发送 resume 请求，按新的原执行身份检查 resuming、实际恢复正文、输入及退出。计划见 `docs/exec-plans/completed/snapshot-only-manual-reload-recovery.md`。本轮不改变 RuntimePersistence 开启后的原 runtime 重连规则。

执行边界补充：`hostBoundaryStop` 在原执行记录内区分 `interrupted` 与 `after-process-exit`。后者用于 process 结果先到、最终保存尚未提交的退出竞态：Host 为清理发出的 stop 不覆盖此前自然退出结果，也不抑制该结果应有的异常提醒。用户显式 stop 清除边界分类；标记不持久化。若 final process/seal/terminal 不可信，仍按原 failed/unconfirmed 责任拒绝恢复完成。

受控验证：24 项新增回归覆盖模拟 reload、两条 deactivation 路径、Codex/Claude 身份、Terminal、无身份、主动 stop（关闭前/期间）、已观测非零和零退出、reset、保存失败、未知 process、metadata 换绑、fake-provider 缺少 storage、最终输出才提供恢复 ID、未完成准备。完整 Host 478/478、重读与 execution-context、类型、本地化、正文 helper 14/14 通过。execution-context 夹具补齐原 owned map，已有 workspace listener 断言跟随实际串行重组方法；没有给产品加入夹具专用兼容分支。真实 VSIX 结果如下。

原生验证推进：首轮默认 VSIX 的 owned reconciliation / local execution flow 通过，trusted 在较早的 `missing-target.ts:9:3` DOM 链接检测失败，未到达本轮 reload 场景。保留 `.debug/manual-reload-recovery/first-artifacts` 与 `first-vsix.log`，不推断当次失败原因。新增默认具名阶段 `snapshot-only-manual-recovery`，复用同一个 `verifyRuntimeReloadRecovery`，先独立验收本轮状态、页面重建和显式恢复，再继续原 trusted 全流程；不删改链接断言。

最终默认 VSIX 在 `snapshot-only-manual-recovery` 与 trusted 原顺序的 `verifyRuntimeReloadRecovery` **两处均通过**：reload 后 resume-ready/interrupted、无 pending resume；真实 editor 重建后 probe 仍显示手动恢复提示且没有新启动；显式 resume 产生新 executionId，provider sessionId 保持；恢复正文、burst 输入和 exit 19/error 完整通过。owned reconciliation / local execution flow 继续通过。原 Host 中断状态与自动恢复意图缺口已收口。

完整门禁仍失败：下一项 `verifyLiveSessionCutoverAndReload:8965` 从 `metadata.terminal.recentOutput` 等待 `LIVE_CUTOVER_EDITOR` 超时。原 Terminal 为 live；相同 executionId 的 `host/executionOutput` sequence 2 和 snapshot sequence 3 已含命令结果，历史 recentOutput 仍是旧 prompt，因此是后续实时正文断言尚未迁移。此轮未更改该项和后续 surface/Runtime/压力验收。首次缺失文件链接检测失败仍保留，最终一轮经过该位置不等于定位其根因。证据：`docs/references/smoke-reload-autostart/manual-reload-recovery-evidence.json`。


## surface 切换实时正文断言修正

2026-10-10 用户授权修复上述断言。`verifyLiveSessionCutoverAndReload` 的四段 live marker 校验改为复用原 executionId/generation 的实际输出 helper；停止后的最终历史输出仍使用持久化字段。测试先结清前序 Terminal，再启动本场景的原执行并等待 started，避免重复启动制造无关拒绝。editor → panel → 同 Host 重读画布 → editor 全程必须保持原执行身份与 live 状态；切换后的快照须来自目标 surface 当前生命周期并含切换前正文，各新 marker 还须在对应真实页面可见。命令把 marker 分段打印，避免输入回显提前满足输出断言。

默认 smoke / VSIX runner 新增 `local-surface-cutover` 具名阶段，复用同一用例并保留 trusted 原顺序检查。此次只校准测试的数据来源和前置条件，不修改产品生命周期、延长超时或跳过后续验证。


本轮验证：正文 helper 14/14、reset fixture 19/19、runner 环境清理与改动脚本语法通过，VSIX 构建打包及类型检查通过。默认真实 VSIX 的 owned reconciliation、local execution flow、manual recovery 和新增 local-surface-cutover 四阶段通过；trusted 中原顺序的 manual recovery 与 surface 切换也完整通过。surface 原 executionId/generation、两次目标页面快照、四段实际输出/页面可见、closed 与四段最终历史、原 saved/退休均按原断言通过，surface 旧字段阻塞已收口。

完整门禁随后停在 `verifyPtyRobustness:9061`：Agent 已 waiting-input 且 live，原 executionId 的实时正文包含 `[fake-agent] burst 080`，但测试仍读 metadata.recentOutput 中上一轮恢复执行的历史。该后续 PTY 用例尚未校准；其剩余退出、停止和压力检查不能代证已通过。精简证据与原工件位置见 `docs/references/smoke-reload-autostart/surface-cutover-output-evidence.json`。本轮没有新增产品结论，不外推到 RuntimePersistence 开启或跨平台/跨版本矩阵。


## PTY 稳健性与高输出测试的数据来源修正

2026-10-10 用户授权处理 PTY 旧字段断言。`verifyPtyRobustness` 的 burst 80 和 Agent/Terminal 并行正文，以及相邻 `verifyTerminalFloodKeepsCanvasResponsive` 的 Agent 回复、Ctrl-C 后输出，统一按原 executionId/generation 的实际通道验证。逐个确认原执行 started 后再继续输入或启动另一执行；每次自然退出/主动停止后等待原最终保存和退休，再重启或进入后续检查。并行运行与高输出下新建节点、选中 Note、输入、停止/删除的验证保持。终端 marker 分段打印，避免命令回显充当结果；并行快照须匹配原执行身份、序列化格式和实际正文。

默认 smoke/VSIX 新增 `local-pty-robustness` 具名阶段，复用稳健性与双 Terminal flood 两个测试并保留 trusted 原顺序。仅校准测试输入前提与输出契约，不以改动产品、延长超时或降低压力放行。


本轮正文 helper 14/14、reset fixture 19/19、runner 环境清理与脚本语法通过；默认真实 VSIX 重新完成类型检查及打包。`local-pty-robustness` 的稳健性/flood 和 trusted 原顺序的同两项 **各通过两处**；burst 80、error/17、stopped、重启身份、并行正文和原序列化快照、双终端持续输出下 Note/Agent/新节点操作、Ctrl-C 恢复与四执行清理均通过。此前四个默认具名阶段以及 trusted 的恢复、surface 等前序检查也通过。原 PTY 旧字段断言阻塞已收口，证据见 `docs/references/smoke-reload-autostart/pty-output-evidence.json`。

新的独立阻塞为 `verifyFailurePaths:9336`：测试创建使用 missing-agent-provider 的 Claude Agent，诊断已记录 commandResolutionFailed / startFailed，原未启动执行以 not-required 结算，页面收到缺失命令错误；节点却仍为 starting、liveSession=false、pendingLaunch=start，未进入期待的 error。此处没有等待实时正文，不能按旧字段问题放宽断言；需要继续定位准备阶段失败后的节点状态投影。原工件保留在 `.debug/pty-output/trusted-artifacts`，完整门禁及后续失败路径/恢复/Runtime 验收仍未通过。


## 启动准备失败状态的正式方案

PR #314 缺 CLI 的错误来自 `startNonNativeHostExecution` 的 prepare 阶段，该阶段尚未创建 business 或取得进程；原 catch 只清理记录，未投影失败状态。此次在准备失败处回写 fresh Agent/Terminal 的 error 或恢复 Agent 的 resume-failed，清除 pendingLaunch/liveSession，并保存画布状态。仅当原 record、原 metadata 绑定仍有效且未 stop 时更新；页面报告器继续只观察并提示。关闭准入、并发占槽拒绝、取消、替换与资源结果未知沿用原责任，不能统一变成准备失败。

历史正文、终端快照和可信恢复身份保留，错误信息记录到 summary/lastExitMessage/lastRuntimeError，恢复失败同时记录 lastResumeError；不伪造进程退出或最终快照保存，未开始执行仍以 not-required 结算。实现与验证见 `docs/exec-plans/completed/owned-launch-preparation-failure.md`。

真实独立场景补充证据：状态修正后 error/pending 清理/not-required 已满足，但出现两条 host/error；第二来源为排队尺寸意图被原 prepare 错误 reject，生成 owned-resize-failed。正式方案补充：prepare 拒绝时取消尚未派发的尺寸意图，只由启动请求报告原错误；取得资源后的 spawn/unknown 与实际 resize 错误仍保留原拒绝语义。

2026-10-10 验证收口：新增 11 条用例替代原两条“不改 prepare 失败状态”的期待，完整 Host **487/487**、类型/UI 本地化、正文 helper **14/14**、reset fixture **19/19**、runner 环境和脚本语法通过。最终代码默认真实 VSIX 的六个独立阶段通过，缺 CLI 场景验证 error/pending 清理、单次提示、not-required 和删除，且无 owned-resize-failed。

完整门禁仍失败：默认 trusted 在较早的异常通知 Claude resume 再启动处（verifyAgentAbnormalInterruptionNotifications:7788）被原最终保存责任占槽拒绝；工件捕获时记录已清理，未据此确认原因。同代码不改场景复跑 trusted，又在更早的 verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent:3257 等待启动诊断超时，实际 startFailed=Execution owner admission is closed。两轮均未在 trusted 原顺序触达缺 CLI 修复，不宣称该上下文或后续 Runtime 通过。精简证据与原工件路径见 `docs/references/smoke-reload-autostart/preparation-failure-evidence.json`；历史文件链接 DOM、early final-save pending 和本轮两处早期失败继续跟踪。


## 最终保存占槽与 owner 准入关闭的专项定位（2026-10-10）

调查基线为 PR #314 `c1d7b977`。两类直接触发点均是 smoke 把中间状态当成操作完成；Host 拒绝尚未完成的原执行替换、保留失败 reset 的关闭边界，符合现有结算约束。执行模式为 snapshot-only，原生环境为 Linux x64 / VS Code 1.141.0 / 当前原生 PTY / fake provider。临时探针、顺序对照和延迟注入均未进入产品源码，证据见 `docs/references/smoke-reload-autostart/lifecycle-barrier-evidence.json`。

### 空画布不是 reset 完成信号

`verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent` 先派发 `webview/resetDemoState`，再等 nodes.length=0；进入这段代码时画布已由前一用例清空。页面派发只启动异步 reset，不等待 `resetState` 完成，所以这个状态条件立即满足，新建 Agent 与原 reset 重叠。

只增加只读探针、保持原 smoke 不变的原生复现中，08:02:59.699 reset 从空画布开始；08:02:59.724 原 reset 检测到新节点，报 `Runtime mutation boundary expired or its nodes changed.` 并中止；08:02:59.731 自启动被 `Execution owner admission is closed` 拒绝。此刻 owner closing=true、permanent=false、pending=0，底层 active=0，排除了残留进程占槽。`resetState` 只有成功完成后才调用 tryResume；边界失败不会自动放开准入，这是防止未知结算被误当作完成的既有规则。

受控 Host 复现同一顺序后，再显式完成一次 reset 即可重新启动；先 await reset 再创建的正对照直接通过。原生顺序对照仅将该准备动作改为 awaited `testResetState`，随后通过该创建用例并继续到通知及后续场景。修复应等待原 reset 的完成结果（有原保存 pending 时使用既有按身份等待/重试夹具），不应以固定 sleep、旧空状态或直接修改 owner closing 放行。用户在 reset 进行中并发创建也可进入这条保护边界；本轮确认的是 smoke 抢跑，不将“自动重新开放失败 reset”作为已确定的产品方案。

### error/通知完成不代表原执行已退休

`verifyAgentAbnormalInterruptionNotifications` 的 Codex 再启动与 Claude 恢复设置只等 error、退出码、通知及 attentionPending=false。`persistNonNativeHostFinal` 先同步投影这些业务状态并提交保存；原记录必须等保存、进程/输出/资源与页面最终确认全部完成才释放 node key。因此通知及选择节点完成不是再次启动的前置完成信号。

本轮在同一通知用例的 Codex exit 27 后自然复现：08:07:30.702 最终保存已成功；08:07:30.812 再次启动时 sameKey=true，原 execution `dfe1b067-e065-4da3-80f6-88b536239197` 的进程已退出、输出 eof、全部资源 released、terminal applied、settled=true，persistence=saved，但 readerOutcome=pending、retired=false。底层 active=0、starting=0、closing=false，没有全局容量不足或进程泄漏；被保留的是原页面交付责任。错误文案把这类情况统称为“最终保存责任占槽”，不能据此判断磁盘保存仍在进行。该失败运行 110ms 后的清理是 host-deactivation/lost，不将它误写为自然页面确认。

保持 Host 存活、先等待原执行退休再启动的原生对照中，通知用例连续五次通过，页面以 applied 确认，后续启动和 Claude resume 均正常。为覆盖最初 Claude 报错的同一路径，另仅将原 Claude 页面最终确认延迟 500ms：08:13:14.452 原 resume 在 saved/资源已释放、reader pending 时收到相同同 key 拒绝；08:13:14.812 放行原确认，读者 applied 后原记录退休；等待后重新写入同一恢复 seed 并启动成功，原 resume-failed/33、恢复身份及不重复通知断言通过。该受控对照没有退出或重建 Host。

前轮 Claude 历史工件已被 finally 清空，不能追认那一刻的具体 pending 域；本轮自然复现和同路径受控对照证明缺少原退休等待能产生相同错误，也证明原确认后正常释放。正式修复范围应为等待原 executionId/generation 的 saved/not-required 和退休，再 seed 恢复状态及启动；仅等待保存事件仍会遗漏页面确认。不能绕过同 key 保护或把旧执行移出 map 来满足测试。

### 验证和交付边界

临时 Host characterization **5/5** 通过：空画布 reset 竞态与正确等待，分别暂停保存/读者/资源并验证阻塞与释放后重试。探针补丁可在 `c1d7b977` 应用，独立夹具不启动原生进程；复跑方法见完成计划。最初受控夹具未模拟页面快照交付而卡住 final-flush，已修正为无页面基线后独立控制三个域，该夹具错误不作为产品证据。

继续向后验证时发现 `c1d7b977` 拆分缺 CLI 用例遗漏了 `verifyFailurePaths` 的局部 diagnosticStartIndex，导致无效自定义命令断言处 ReferenceError。本轮仅补回该局部变量；在受控原生运行中完整 verifyFailurePaths 已通过，原断言保留。该运行按调查需要明确在此函数后停止，exit 0 不代表完整 trusted 或发布 gate 通过。产品源码与 Host 主测试已恢复基线，两个同步问题的正式 smoke 修复仍待单独落实，其他历史门禁/平台边界保留。


## 正式方案：smoke 生命周期完成等待

`tests/vscode-smoke/extension-tests.cjs` 的创建命令用例统一 await `COMMAND_IDS.testResetState` 后再检查空画布并继续，涵盖两处 QuickPick 准备及相邻创建流程清理。节点数量只验证结果，不再作为 reset 完成信号。

`verifyAgentAbnormalInterruptionNotifications` 在 Codex 两次退出及 Claude 首次退出前，使用 `waitForLocalExecutionStarted` 固定原执行快照；保持原退出码、通知和 attentionPending 断言，在同节点重启、进入文本模拟夹具或写入 Claude 恢复 seed 前调用 `waitForOriginalLocalExecutionRetirement`。该 helper 按原 executionId/generation 等原记录从 Host 移除，并拒绝 failed/unconfirmed 保存；不能只等 saved，也不能从新快照中任取替换执行。Claude resume-failed 验证完成后，删除前也等该次执行退休。

本轮只修正测试顺序，不改 Host 同 key、owner closing 或失败 reset 的保护规则。正式回归结果见下文，前述调查变体不代证完整默认 gate。


默认 VSIX 验证已通过上述两处修正及完整 `verifyFailurePaths`，随后在 `verifyStopVsQueuedExitRace` 暴露同类旧字段等待：运行期等待 recentOutput 中的 sleeping，实际直到自然 exit 9 最终保存后才满足，随后的 stop 被 missing-session 拒绝。该处按原 executionId/generation 的实时输出等待 sleeping，再发送 Stop；停止后的最终正文及退出事件断言继续保留，退出后先等待原退休再读取保存正文。此追加修正不据此改变停止信号或通知契约。


### 本轮验证与剩余边界

语法检查、reset fixture 19/19、正文 helper 14/14、runner 环境检查通过，两次 VSIX 类型检查与打包成功。默认运行前六个独立阶段全部通过；trusted 原顺序通过两处 QuickPick、完整异常通知（含 Claude 恢复失败）、终端原生交互、手动恢复、PTY/flood、完整 failure paths、持久化恢复与 standby/fault injection，随后停在旧 Stop 竞态等待。追加实时输出等待后，原顺序 trusted 复跑再次通过两处修正，但在终端 `link-target.ts:3:1` DOM 检测处失败，尚未触达 Stop 竞态。

为验证追加等待，复用最终打包 Host 单独调用原 Stop 用例，所有结果断言保留。Stop 已在睡眠期间发出：原执行最终 status=stopped、exitCode=0，保存了 Token usage、codex resume 与 received signal INT；原实时等待不再拖到自然 exit 9。该运行仍在摘要断言失败：期待 `Stopped Codex session`，实际为 `Session ended with exit code 0.`。这不是已证明的停止动作失败；旧 stopRequested/exited 诊断断言尚未执行，其与 owned 契约的一致性待核对，不能顺带宣称已通过。

完整 gate 仍未通过，终端链接检测失败与 Stop 用例文案/诊断契约核对留为后续阻塞。当前不放宽断言或改停止产品行为；后续 Runtime 场景未执行。证据见 `docs/references/smoke-reload-autostart/lifecycle-barrier-fix-evidence.json`。相邻 `lifecycle-barrier-stop-race-control.patch` 只用于在最终代码上复跑 standalone 入口，不是默认 gate 或正式实现；在临时 checkout 应用后以 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=local-preparation-failure` 运行 VSIX smoke，即可调用原 Stop 用例，随后应丢弃该控制补丁。


## 链接扫描与停止契约专项定位（2026-10-10）

基线为 PR #314 `9610f44e`，RuntimePersistence 关闭，Linux 原生 PTY、fake Agent。两处都存在已确认的 smoke 迁移缺口；本轮定位不修改正式产品/测试实现，也不代表完整 gate 已通过。

### 链接：Host 已发正文不代表 xterm 已应用

`verifyExecutionTerminalNativeInteractions` 在 `waitForLocalExecutionOutput` 命中 Host 输出消息后，立即调用 `activateExecutionLink` / `hoverExecutionLink`。该 helper 只验证原 executionId/generation 的输出；`main.tsx` 的 `enqueueOutput` / drain 则把正文排入批量写入，之后还有 xterm 自己的异步 parser。测试入口 `executionTerminalNativeInteractions.ts::findInteractionLinkByText` 在当前 buffer 上做一次扫描，找不到即返回错误，扫描并不等待这些写入完成。

只增加读取 buffer/provider 候选的探针、不注入延迟的原生运行，在同一用例的 URL hover 处复现：08:41:34.162–.185 扫描开始到结束，buffer 都没有目标 URL，候选中自然也没有该 URL；Host 已发出包含完整正文的 outputSequence=13，紧接着的新 probe 请求中 URL 已显示。实际链接不存在于扫描输入时，尚未进入该目标的 Host 路径解析；这与“解析了路径但定位错误”是不同阶段。

为覆盖历史失败的同一文本 `link-target.ts:3:1`，仅将包含该正文的页面 `terminal.write` 延迟 600ms：08:44:48.549–.576 首轮扫描无正文并拒绝；08:44:49.184 等待正文真正显示后，同一 executionId/generation 再扫描得到文件候选，实际打开同一文件第 3 行第 1 列。过程中没有重启 Host、替换会话或改变路径解析。这证明页面未应用时抢先扫描足以产生原报错，正文就绪后原文件定位可用。

历史 `3:1` 工件的 `failure-webview-probe.json` 来自 `lastWebviewProbe` 缓存，finally 还会重开 editor，不能反推该历史瞬间 buffer；本轮不伪造那一瞬间的页面状态。另一次有界三轮原用例观察中，两轮完整通过，第三轮已检测 URL 后等待 tooltip 可见超时；此显示失败尚未归类，不把它自动并入无正文扫描问题。

正式修复边界为：先按原执行验证真实输出，再等目标页面对应正文应用/可见，随后进行单次链接操作；打印夹具要避免命令回显提前满足，文件行列、图片/URL 打开及 tooltip 断言继续保留。固定 sleep、吞错重试或放宽路径结果都不能替代该顺序。已检测链接但 tooltip 不可见的情况应保留独立证据。

### 停止：owned 路径与旧 session 文案/诊断不一致

`stopExecutionSession` 的 owned 分支直接调用原 owner 后返回，因此不会执行下面旧 session 分支的 `execution/stopRequested`；旧 `execution/exited` 同样在旧 session finalize 中生成。`persistNonNativeHostFinal` 使用 stopRequested 确定 stopped，再依据实际 process 结果生成摘要，所以得到 `Session ended with exit code 0.`。旧 smoke 仍要求 `Stopped Codex session`、一次旧 stopRequested 和一次旧 exited；这些要求来自 2026-04-06 的 `744fcfa6`。owned 早返回在 `c1b6bc8b`（2026-09-25）已引入，实际 process 摘要来自 `b235a7bc`（2026-09-26），不是本轮 reset/通知同步修正改变了 Stop。

原生原执行 `0912293d-90e9-44b0-82c5-7d25f3acfce8` 证据确认：status=stopped，exitCode=0，保存 Token usage、codex resume、received signal INT；`host/executionExit` 只有一次，finalOutputSequence=4，原保存为 saved，原页面 applied，同一执行随后退休。旧内部诊断为 0，不等于终端退出消息丢失。产品文档约定的 Codex 单次 Ctrl-C 收尾正常，当前没有 Stop 动作失败证据。

本轮另运行既有 Host 两项定向回归，Agent/Terminal 均通过：原 stop 只请求一次，进程/资源结果未齐时 promise 不完成，停止期间持续消费尾部，页面责任未结束时仍保留原记录。正式 smoke 应检查原执行的 stopped、实际退出信息、收尾正文、单次 `host/executionExit`、saved 与页面确认；若需直接证明 stopRequested，则在可持有原 owner 的测试层断言。不要靠重新发射旧诊断或掩盖真实退出结果来满足过时的内部断言。

### 证据与复跑

精简证据：`docs/references/smoke-reload-autostart/link-stop-investigation-evidence.json`。`link-scan-observation.patch` 为只读页面扫描探针；在临时 checkout 应用它，再任选 `link-scan-original-scenario.patch`（三轮原用例观察）或 `link-scan-controlled-application.patch`（同链接应用前后对照），以 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=local-preparation-failure` 运行现有 `test:vsix-smoke`。两个入口 patch 互斥；三轮观察入口的进程 exit 0 只表示收集结束，须逐轮读结果，不表示原用例全部通过。所有 probe/控制源码已恢复，复跑 patch 不属于正式修复。


## 正式方案：链接页面就绪与 owned 停止 smoke

`verifyExecutionTerminalNativeInteractions` 每次打印链接正文后追加独有标记，按原 executionId/generation 等待正文和标记输出，再用目标 editor probe 确认“正文+标记”已进入 xterm 可见行；拼接可见行只用于兼容软换行，文件行列/图片/URL/tooltip 的真实交互断言继续保留。标记分段打印以排除命令回显，重新打开画布后复用链接也重新确认页面正文；整个等待前后验证原执行身份不变。

`verifyStopVsQueuedExitRace` 等原执行退休后检查 stopped/0、保存的 SIGINT 收尾与恢复提示、原身份单次 host/executionExit、finalOutputSequence 一致、原保存 saved 和原 editor reader applied。摘要应与保存的实际退出信息及终端退出消息一致；不再检查未执行的 legacy 分支文案/私有诊断。既有 Host 两项停止回归直接检查原 owner.stopRequested 与单次 requestStop，保留资源和读者结算约束。新增默认 local-links-and-stop 阶段复用完整链接、Codex Stop 和 Claude Stop 原用例，trusted 中仍按原顺序执行。

本轮实现不改变正式产品源码；既有 tooltip 可见超时仍保留为待复核边界，本次通过不追认旧失败瞬间。


首次默认 VSIX 的七个独立阶段以及 trusted 中链接/Codex Stop 均通过后，原顺序在相邻 `verifyClaudeStopRestoresPreviousSignal` 等待运行期 recentOutput 超时。本轮将该用例同样迁移到原 executionId 的 started/实际输出，并在停止后等原退休再验证最终正文；Claude 不发送二次 Ctrl-C、不 force kill、无误生成 resume 信息的原断言保持不变。独立阶段同步复用该完整用例。


### 修复验证与后续门禁

语法检查、正文 helper 14/14、reset fixture 19/19、runner 环境检查与 Host 停止定向 2/2（共 487 项）通过。对 `link-target.ts:3:1` 临时注入 600ms 页面写入延迟，最终三个原用例组成的 local-links-and-stop 完整通过，包括真实文件行列、图片、搜索、URL/tooltip、Codex 与 Claude 停止；随后移除延迟，产品源码与本轮基线一致。复跑时在临时 checkout 应用 `docs/references/smoke-reload-autostart/link-page-wait-validation.patch`，以 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=local-links-and-stop` 运行 VSIX smoke，验证后丢弃该 patch。

最终无延迟默认 VSIX 类型检查/打包及七个独立阶段全部通过。trusted 原顺序通过完整链接、滚动历史、snapshot-only 恢复、surface/PTY/flood、failure paths、持久化恢复、standby/fault injection、Codex Stop 与 Claude Stop。未跳过原行列、tooltip 或停止结果断言，本次两项已定位修正及相邻 Claude 正文等待已完成。

完整 gate 仍失败：紧随其后的 `verifyClaudeExplicitSessionIdPreservesResumeContext:9972` 等待恢复策略超时。原 Claude 活跃且为 waiting-input，`resumeSessionId=session-explicit-123456789` 已存在，但 `resumeSupported=false`、`resumeStrategy=none`，测试期待 claude-session-id；此时尚未发送该用例的 Stop。它检查恢复能力状态，不是等待旧 recentOutput，根因尚未确认，不能放宽为只检查 ID。后续 RuntimePersistence 开启场景未执行，需在继续完整门禁前单独定位。精简结果与现场摘要见 `docs/references/smoke-reload-autostart/link-stop-fix-evidence.json`。


## Claude 显式 session ID 恢复策略专项定位（2026-10-10）

调查基线为 PR #314 `523ee9a5`，RuntimePersistence 关闭。结论是当前 snapshot-only owned 执行遗漏了 provider 会话文件确认，是产品能力迁移缺口；原 smoke 的恢复策略断言符合现有设计，不是等待旧正文，也不需要旧插件或跨版本混用才能复现。

### 候选 ID 与已确认恢复能力

`docs/design-docs/agent-launch-modes-and-restart.md` 已约定：fresh Claude 的显式或自动生成 ID 起初只是候选，须通过 `~/.claude/projects/.../<id>.jsonl` 文件存在性或 provider resume 提示确认，才升级为 claude-session-id；已由文件确认的 ID 在停止后仍须保留。`CanvasPanelManager.ts::resolveAgentResumeContext` 返回 supported=false/none 和候选 ID 是正确的起点，不能把所有带 `--session-id` 的启动直接标为可恢复。

旧路径在启动完成和转入 waiting-input 时调用 `maybeDiscoverAgentResumeContextFromFiles`，Claude 分支经 `maybeConfirmClaudeResumeSessionId` 调用实际 `locateClaudeSessionId`。当前 `startAgentSession` 进入 `startNonNativeHostExecution` 后早返回；owned 启动以及 `scheduleNonNativeAgentActivity` 没有上述文件确认步骤。`business.agentResume` 因此保留未确认候选，`projectNonNativeHostBusiness` 如实投影 none，而非在投影时丢失了一个已确认结果。

此外，旧 `maybeConfirmClaudeResumeSessionId` 查询完成后只检查 `getExecutionSessions('agent')` 中的原 ManagedExecutionSession。owned 记录在 `nonNativeHostExecutions`，所以仅添加对旧方法的调用也不能生效；正式修复必须使用原 owned record/identity 校验与状态投影。

### 受控验证与引入记录

保持产品源码不变，临时独立入口调用原 `verifyClaudeExplicitSessionIdPreservesResumeContext`。用同 Extension Host、同 cwd、默认环境的实际 locator 读取原 smoke 预置文件，立即得到 `session-explicit-123456789`，随后原用例仍在 20 秒恢复策略等待超时：原执行 `f06ac6f5-2d3c-4401-818e-24a6dda2de33` 已 waiting-input/live，ID 正确但 supported=false/none。这排除了该复现中的文件缺失、HOME/cwd 不一致及启动未完成。

Host 两项特征对照使用实际类、实际 filesystem locator 与既有受控 transport，有文件/无文件均通过：正常 owned started 和提示触发 waiting-input 对 locator 的调用为 0；手动调用旧 helper 时，文件可查到但记录不在 legacy map，不会升级。相同会话对象放入旧 map 后，有文件可确认、无文件保持 none；把真实确认结果交给原 owned projection，则 metadata 正确升级且 executionId/generation 不变。

第二次原生运行仅临时补回原 owned started 后的文件确认，在原身份/候选/metadata 仍匹配且未停止/结束时投影结果。原测试全部通过，包括运行期策略与 ID、停止后策略与 ID 以及节点删除。原执行 `2342f1c1-be15-4210-9d0a-5bd6e2021701` 以 SIGHUP 正常停止后仍 supported=true、strategy=claude-session-id、ID 不变。未修改停止信号，未替换原测试断言。无文件 Host 负例继续不可恢复。

历史上，`a1e3bc89`（2026-04-25）加入文件确认，`247aef2f`（同日）加入显式 ID 的确认及本 smoke；`ae3c42cf`（2026-09-26）增加 owned business/output/waiting-input 接线时，只迁移输出提示与最终收尾，未迁移文件确认。该提交当时仍为候选能力，缺口延续到当前已启用的 owned 路径；不能据此宣称当日所有发布已受影响，也不是 PR314 本轮链接/Stop 测试修正引入。

### 修复边界与证据

应在 owned Agent 的启动及等待输入时接回文件确认；异步结果必须仍属于同一原执行、同一候选 ID 与 metadata 绑定，不能覆盖新启动、已停止或已最终保存状态。保留无文件不可恢复，以及已确认 ID 停止后保留的规则。不能用直接标记 supported=true、只保留 ID 的断言或增加等待期限替代确认。临时原生对照中的同步 await 只用于隔离因果，不代表正式调度方案；正式实现需要保证正文消费和原资源结算不被扫描阻塞。相同遗漏也涉及自动候选 ID 的调用路径，本轮原生实测限定为显式 ID。

本轮仅提交定位结论。产品及正式测试源码已精确恢复，Host 特征测试 2/2、原生原用例负例/最小接线正例均已记录，完整默认 gate 与后续 RuntimePersistence 开启场景没有重跑；也未执行真实 provider resume。精简证据为 `docs/references/smoke-reload-autostart/claude-resume-context-evidence.json`，三个相邻 `claude-resume-*.patch` 和完成计划给出复跑方式。


## 正式方案：owned Claude 文件确认

`CanvasPanelManager.ts` 在原 owned 执行确认 started 后及提示转入 waiting-input 时，异步调用原 cwd 下的 Claude 文件 locator。每个 business 仅一个进行中的查询，重叠 waiting-input 合并为一次后续查询。确认不加入启动、正文消费或最终保存的等待链；无文件继续未确认，扫描错误只记诊断。

查询捕获原 execution、business、launchSpec 与候选恢复上下文；结果返回时检查原记录仍在、身份/候选未替换、当前 metadata 仍属于原 persistence 绑定、原执行未停止/结束/隔离或进入最终保存。合法的原 root 路由迁移和正文 metadata 更新不应误判为替换。成功后写入原 business，再通过现有投影更新节点并请求普通状态保存；已确认策略和最终保存语义保持。旧 session helper 与 Runtime 路径不改，保留无文件不可恢复和已确认 ID 停止后保留的既有设计。

`maybeConfirmNonNativeClaudeResumeSessionId` 已实现上述流程，`NonNativeHostBusiness.claudeFileConfirmation` 只保存正在处理的任务及合并补查标志；原执行 metadata 随正常投影更新时，以原 persistence 的当前绑定校验，避免错拒合法输出。相同候选查询失败或 miss 后可处理已排队的 waiting-input 补查；成功确认后不再重复扫描。普通状态保存失败不会伪造进程最终保存完成，迟到扫描不覆盖已确认上下文。

新增 Host 17 项、完整 Host 504/504、类型检查和 smoke 语法通过。新正例在本轮基线产品源码失败，修后覆盖真实文件、显式/自动候选、无文件、错误与补查合并、并发输出/停止、进程结束/最终保存、metadata/记录/节点/候选/launchSpec 替换及隔离。原记录路由迁移与普通输出投影期间仍能确认；停止在扫描仍 pending 时完成，不等待文件查询。

最终默认 VSIX 类型检查/打包和七个独立阶段通过。完整 `verifyClaudeExplicitSessionIdPreservesResumeContext` 在 local-links-and-stop 和 trusted 原顺序均通过运行期、停止后的恢复策略/ID及删除检查；原生可信确认事件绑定 executionId=`fff61393-5d15-4859-8987-0bec232cdad6`，没有改动原测试断言。本轮 Claude 文件确认缺口已收口。

完整 gate 仍未通过：随后 `verifyLiveRuntimePersistence:10024` 在开启 RuntimePersistence 后首次等待 Agent live 超时，尚未执行该用例的 reload/reattach。Agent/Terminal 分别仍 starting/launching、pendingLaunch=start、live=false，localExecutions 为空；两者均出现 `execution/candidateStartFailed`，消息为 `Root runtime preparation or submission did not complete.`。节点 metadata 此时仍 snapshot-only 是失败现场，不能当作该用例未开启 Runtime 的证明。该轮尚未定位底层原因，后续定位见下一节；原证据见 `docs/references/smoke-reload-autostart/claude-file-confirmation-fix-evidence.json`。

## Runtime 首次 root 准备失败专项定位（2026-10-10）

### 已确认根因与归属

在 `1579d2da`，普通画布保存与 Runtime 对同一扩展 globalStorage 的权限约定不一致。`CanvasPanelManager` 构造期间调用 `persistState` → `writeRootLocalCanvasSnapshot` → `writePersistedCanvasSnapshotToDisk`；最后通过不带 mode 的 `fs.mkdirSync(parent, { recursive: true })` 创建 `globalStorage/root-local-canvas/<root-key>`。扩展 globalStorage 尚不存在时，递归创建也会创建这个父目录。当前环境 umask 为 0002，因此扩展 globalStorage 为 0775（同组用户可写）。

开启 Runtime 后，`resolveRuntimeCreationTarget` 调用 `mkdir({ recursive: true, mode: 0700 })`，但 mode 只作用于新目录，不会修改已存在的 0775。launcher 的 `prepareRuntimeRootSupervisor` 第一项操作 `prepareRuntimeRootOwnerDirectories` 在 `globalStat.mode & 0022` 检查立即抛出：

    Root runtime global storage must be owned by the current OS user and not writable by others.

外层 catch 丢弃原异常，返回通用的 preparation/submission 错误。失败发生在创建 root 子目录、领取 preparation 所有权、后端选择和提交 Supervisor 之前，不是进程启动慢、reload 重连或 provider resume 超时。两个节点保留 starting/launching 与待启动摘要，令上层 live 等待最终超时；这些状态不能证明仍在等待尺寸。

这是环境权限触发的插件存储初始化/兼容缺口。目录由插件正常激活保存创建，smoke 无须直接制造坏目录，也无需旧版本数据；全新隔离 user-data 即可重现。权限拒绝本身遵守安全约束，不能通过删除检查修复。通用错误隐藏原因、失败节点继续显示待启动，是同次失败暴露的反馈问题。只修改 smoke umask 可以绕过触发条件，不能解决已有普通目录与新 Runtime 路径的兼容。

### 原始证据与因果对照

原默认 VSIX 工件 `.debug/claude-resume-fix/trusted-artifacts` 对应目录仍为当前 UID 所有、0775。用未修改的实际目录准备函数和 helper 重放原路径，分别得到具体权限拒绝与原通用错误，原目录没有变更。

同一隔离实验目录先经普通递归 mkdir 成为 0775，再调用 Host 同款 mkdir 0700，权限仍为 0775、准备仍拒绝；仅将实验目录改为 0755 或 0700，两者均越过目录准备。helper 在目录准备后立即主动取消，未创建 Supervisor。因此 globalStorage 要求是不可被其他用户写入，并非必须为 0700；其下 root 私有目录仍须精确 0700。

真实 VS Code 1.141.0 对照使用原 head 已打包载荷的隔离副本，只增加 mkdir 前后观测和 helper 异常 message。两次都复用原 `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true)` 与两个 live 等待，未执行 trusted 全部前序。0002 下，激活前目录不存在；捕获到构造时普通保存首次创建 0775，Runtime mkdir 后仍 0775，两条启动失败均为上述权限异常，无 startup intent。0022 下同一路径创建 0755，root 生成 intent/started，Terminal 以 live-runtime/attached-live 启动。两次配置均 enabled=true，两次仍有 watcher ENOSPC；当前 root 拒绝无需以 watcher 错误解释。

0022 对照随后 Agent 报 `Execution start was rejected-before-acquire.`；本轮未捕获资源拒绝瞬间，不能仅凭文案认定具体配额或生命周期原因，也不能称整个 Runtime 用例通过。Terminal 成功与 root intent/started 证明越过当前权限阻塞。证据保存后已通过原连接正常 stop 该隔离 Terminal，随后 Supervisor 退出。后续 reload/reattach、压力和跨平台矩阵均未验证。

### 引入记录与后续修复边界

`7dd0054f6`（2026-06-04）已有 globalStorage 下 root-local 画布存储；普通 snapshot mkdir 未指定私有 mode。`e72d7859`（2026-10-08）增加 root 准备及 globalStorage 不可组写检查，`34c54561`（同日）将正常 Host 创建接到 root helper，并用 mkdir 0700 准备已有父目录。记录来自 git blame/show，未逐提交运行完整 smoke。冲突出现在新 root 路径接入现存普通存储后，不是本次 Claude 修复引入。这与先前 `runtime-checkpoint-refresh` 在 umask 0002 下的目录拒绝是同一机制；两个场景消除权限阻塞后的资源拒绝不得自动合并归因。

本轮仅定位，生产代码、原 smoke、权限检查和资源保护不变。后续应统一所有可能先创建扩展存储的入口，并明确已有目录的验证/处理策略；失败反馈应安全表达具体阶段并结束本请求待启动表现。保留 owner、canonical path 和未知归属保护，不自动接管任意不安全目录，不把提交未知当作未提交，也不只调整测试等待。具体迁移方案尚未选定。

精简证据为 `docs/references/smoke-reload-autostart/runtime-root-preparation-evidence.json`，同目录重放程序和真实副本探针分别为相邻的 `runtime-root-directory-replay.mjs`、`runtime-root-native-probe.mjs`。探针收尾新增自动 stop 在证据采集之后执行；本轮两次采集使用独立 cleanup 客户端完成同一清理，收尾补充未重新原生运行。计划为 `docs/exec-plans/completed/runtime-root-preparation-investigation.md`。

## Runtime 存储准备修复正式方案（2026-10-10）

用户已授权在 PR314 修复。普通画布 snapshot 与 CanvasTemplateStore 创建内部目录时显式使用 0700，覆盖新 globalStorage 被递归创建的情况，不更改已有普通文件。Host `resolveRuntimeCreationTarget` 调用 `panel/runtimeGlobalStorage.ts` 准备 ExtensionContext 指定的单个目录：新建为 0700；现有安全目录保持原权限；旧普通 0770/0775 仅在当前 UID、非符号链接、无特殊权限位、完整 owner 权限成立时移除组写位。通过 O_NOFOLLOW/O_DIRECTORY 打开 canonical 目录，fstat 与前后的 lstat/realpath 验证 dev/ino、类型和归属，只 fchmod 原描述符，不按路径递归 chmod，不更改 root 子目录、会话内容或 owner key。世界可写、异主、重定向、特殊位和身份变化拒绝。Windows 不以 POSIX mode 推断 ACL。

root helper 的原私有目录/归属检查保持；其目录准备异常使用固定安全阶段文案，不转发底层路径、堆栈或环境。Host 对仍绑定原 metadata、未提交 createSession、不带原 Runtime 会话绑定且未进入关闭边界的原启动记录，投影 error（Agent resume 为 resume-failed），清 pendingLaunch 并保存普通状态，保留历史正文和恢复身份。提交过会话的未知结果继续走原保护，不因 root helper 失败文案释放资源，也不把 Supervisor 是否启动与 session 是否创建混同。

验证覆盖真实 umask 文件操作、原目录内容保留、目录替换/权限失败及拒绝边界，Host 的新建/恢复失败与迟到绑定保护，以及原 Runtime 自启动。受限收紧属于用户扩展存储的权限兼容处理，不是对任意目录的接管；无法确认时仍失败。计划见 `docs/exec-plans/completed/runtime-root-storage-repair.md`。目录 21 项、准备 worker 26 项、client 21 项、systemd 环境 40 项、owner storage、完整 Host 529/529、模板、本地化和 typecheck 均通过。修前普通保存新正例在原产品代码失败。

最终默认 VSIX 的七个独立阶段通过；trusted 在原 umask 0002 下 globalStorage 为 0700，root 已启动、Terminal live，Agent 随后 rejected-before-acquire，完整 gate 仍失败。独立 VSIX 载荷验证中，0775 收紧为 0755 后 Agent/Terminal 均 live 且原 marker 不变；0777 保持不变、两个节点 error、pendingLaunch 清空并给出 unsafe 提示，两项均 exit 0。专项逐个确认 started，只证明目录兼容与失败状态，不替代原并发场景；原始测试文件未修改。原生副本产品 bundles 与最终包相同。证据为 `docs/references/smoke-reload-autostart/runtime-root-storage-fix-evidence.json`，可复跑专项为相邻 `runtime-root-storage-verification.mjs`。

原 Runtime 历史状态参与下一次独立清理资格，因此失败投影不触碰仍携带 runtimeSessionId 的旧绑定。完整 Host 回归已复核旧历史清理每次重新观察、已提交未知保护、原 metadata 替换和关闭边界。本轮仅修复已确认的存储与准备状态缺口，未改资源准入，后续 Agent 拒绝原因仍需独立证据。

## Runtime 创建准入专项定位（2026-10-10）

### 已确认原因与正式契约

基于 `563e45c9` 的当前 VSIX 载荷，在开启 RuntimePersistence 后复用原 `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true)`，确认连续创建会让两个启动重叠，触发 `ExecutionAuthority.beginStart` 的 `starting: 1` 限制。本次为 smoke fixture 未等待启动完成；没有发现此拒绝由旧版本兼容、关闭/隔离或资源泄漏导致。发生点仍是 `verifyLiveRuntimePersistence` 的首次节点准备，未到其 reload/reattach。

`tests/vscode-smoke/extension-tests.cjs:947` 连续 await 创建 Agent、Terminal、Note，但 `testCreateNode` 返回只代表创建动作完成，不代表 provider 已 started；后续仅检查节点存在。各自异步准备使进入 Supervisor start 的顺序不必与创建顺序相同。测试期待两个运行节点，却没有满足该 owner 的正式启动准入前提。

`runtimeSupervisorMain.ts:createSession` 的准备容量检查和底层 start 结果可能产生同一条 `Execution start was rejected-before-acquire.` 文案。本轮记录两个判定点：Agent 到达准备检查时，owner admissionPending=1、retainedRetirements=0、pending 上限=2，检查通过；随后 `ExecutionAuthority.beginStart` 中 identityMatch=true、closing=false、无 blockedReason，唯一占槽者 Terminal state=starting，starting=1。Agent state=bound、resources=[]，被拒后仍无 provider 资源。authority 此时 active=2/admissionPending=2 包含本次已预留 Agent，不代表已经存在两个运行进程，也不是 beginStart 的拒绝条件。

`docs/product-specs/runtime-persistence-modes.md` §9 的 `{ executions: null, starting: 1, pending: 2 }` 在 Runtime 路径同样生效。它允许多个已运行会话，但限制并发启动；此拒绝符合正式契约。Runtime 已将 typed 未获取资源的失败投影成 error 并清除 pendingLaunch，不存在此前 snapshot-only 的无人消费 promise 反馈缺口。

### 原生证据与对照

原完整失败时间线：10:27:08.914Z Agent 请求，08.944Z Terminal 请求，09.613Z Agent 被拒，09.670Z Terminal started。该历史运行没有瞬时容量探针；以下精确占槽证据来自相同 helper 的新隔离重现，不冒充历史现场记录。

带只读探针的连续创建中，11:18:03.818Z Terminal 取得启动槽，03.832Z Agent 命中唯一的 starting 上限，03.898Z Terminal started 并释放槽。04.034Z 对同一个失败 Agent 节点重试时 starting=0、admissionPending=1（仅本次新预留），前一次失败记录已释放；随后 Agent started。两者保持活动，authority active=2、starting=0、admissionPending=0。该对照证明首次拒绝不要求旧执行或旧版本，也没有本次失败占槽泄漏。

串行对照等 Agent 原执行的 `execution/started` 后再创建 Terminal，两者都 started，Terminal 准入时原 Agent state=running，starting=0。未加探针的原 Supervisor 载荷另跑连续创建，也出现同文案拒绝，但被拒的是 Terminal；Agent started 后对原 Terminal 节点重试成功。不同调度下被拒节点可以交换，不能将此问题认定为 Agent 特有故障。三个场景均 exit 0；结束时通过原 stop 入口停止节点，隔离 Supervisor 随 idle shutdown 全部退出。

运行环境为 Linux x64 / VS Code 1.141.0 / fake-agent-provider / `legacy-detached` / `linux-owner-v1-candidate`。探针仅加入复制的 Supervisor bundle，记录身份、计数和资源名称，不改判断或正式源码。第一次探针脚本换行拼接错误造成 Supervisor 语法失败，未进入准入；该工件单独保留，修正并加入生成载荷语法检查后才计入上述三个结果。`runtime-admission-investigation.mjs` 保存重放方法，`runtime-admission-evidence.json` 保存 hash、原时间线与完整精简探针。

### 修复边界与未完成项

后续应在共用 `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode` 内逐个等待本次原 execution/session 的真实 started，再创建下一个执行节点，保持 Note 和后续 Runtime 行为断言。该 helper 同时服务 Runtime 开/关切换及相关独立 smoke，不能只修本次某一个调用点。早期 liveSession/节点状态不是启动槽释放屏障，不采用固定 sleep、扩大容量、隐藏排队或自动重试；本轮重试只用于因果验证。

这与先前 `verifyRuntimeReloadRecovery` 的 snapshot-only 启动重叠同属一个机制，但位于此前未修的另一 helper。`git blame` 显示该连续创建顺序来自 `cf7d5225`（2026-04-18），正式 owned 准入接入后未一起校准；本轮未回测历史发布包，不能据此指定首次受影响版本。权限修复只使执行到达后续准入，并未引入这个创建顺序。

本轮仅定位并同步证据，没有修改正式 smoke 或产品代码；完整 gate、后续 Runtime reload/checkpoint、真实 provider 和跨平台/跨版本矩阵仍未完成。计划见 `docs/exec-plans/completed/runtime-start-admission-investigation.md`。

## Runtime smoke 启动屏障修复方案（2026-10-10）

### 正式方案

用户授权在 PR #314 修正测试。`tests/vscode-smoke/extension-tests.cjs` 的可信节点准备 helper 逐个创建 Agent/Terminal：Runtime 开启时捕获本次 runtimeSessionId 并等 kind/nodeId/sessionId 一致的 execution/started，随后复核原绑定仍 live；关闭时复用 `waitForLocalExecutionStarted` 的 executionId/generation 等待。两者确认后再创建 Note，保留三节点返回契约。restricted 的节点准备不启动执行，保持原逻辑。

同一 `verifyLiveRuntimePersistence` 的停止后显式重启也逐个等待 Runtime started，再进行后续运行/reload 检查。只修正启动准备顺序，不改配额、产品生命周期、状态/正文断言，不增加固定延迟或自动重试。实施与结果见 `docs/exec-plans/completed/runtime-start-admission-repair.md`。

### 修复验证与后续边界

正式共用 helper 的 Runtime 开/关两个原生专项均通过：分别只有 Agent/Terminal 两次启动，首个原 session 的 started 先于第二个请求，最终绑定正确，无 candidateStartFailed 或自动重试。Runtime 开启使用 runtimeSessionId，关闭使用 executionId/generation；生成载荷与正式测试来自本轮默认 VSIX。

默认 VSIX 构建打包、类型检查和七个独立阶段全部通过。trusted 原顺序已越过共用 helper 的自启动，并在指定尺寸重启中依次确认新 Agent/Terminal started；完整 `verifyLiveRuntimePersistence` 的运行、reload/reattach、停止及停止后重读断言均通过。运行到紧邻下一项函数是前一 await 已完成的直接证据，两轮启动身份与时间线见 `docs/references/smoke-reload-autostart/runtime-admission-fix-evidence.json`。

完整 gate 仍未通过：下一项 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory:10380` 请求原 session 快照后，等待 `host/executionSnapshot.terminalStream` 包含首末 marker 超时。失败现场快照实际携带 `terminalRead` / `currentState`，没有 `terminalStream`；同函数此前 reload 后页面最新行和滚到最早行的断言已通过。本轮保留此失败及原断言，后续需校准/验证分页快照观察契约，不将新等待问题归为本次启动拒绝。checkpoint 独立大输出场景、其余 Runtime 场景和跨平台/跨版本矩阵尚未执行。

本轮仅修改 smoke 的启动等待；原配额、产品和后续恢复/正文断言均保持。失败后已通过原 session 的真实 client stop 清理隔离 Terminal，专项节点通过原 smoke stop 清理，实验 Supervisor 全部退出。专项脚本 `runtime-admission-fix-verification.mjs on|off` 可复验。

## Runtime 滚动历史快照专项定位（2026-10-10）

### 已确认原因与归属

基于 `fa645cfc`，当前失败属于 smoke 对新协议的观察未迁移。`verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory:10380` 请求原 session 快照后，固定读取 `payload.terminalStream`。`readTerminalStreamProjectionText(undefined)` 返回空字符串，因此即使原 session 的快照已经到达，首末 marker 条件也恒为 false，10 秒后超时。

`CanvasPanelManager.postExecutionSnapshot` 对 `terminalStreamPaged` 会话进入 `postPagedExecutionSnapshot` 后直接返回；后者明确发送空 output 和 `terminalRead` 描述符，不内联完整 terminalStream。`runtimeTerminalReadRelay.open` 对相同 client/session/authority/surface/能力复用原 descriptor；Webview `TerminalPagedProjection.start` 看到相同 readId 只更新可用 head，不重复导入当前态。这是既定分页契约，数据由原 reader 的 `host/executionTerminalPage` 分块传递，不能把内联字段缺失认定为历史丢失。

本用例先验证页面最新行和滚动至最早行，再 clearHostMessages 并重复请求快照。清空的是测试消息记录，原 reader 仍活动且已消费 bootstrap。因此将等待简单改成“clear 后重新出现全部分页正文”同样可能超时；新断言需要保留并关联原 reader 的已有 bootstrap，不能混用不同 session/readId/页面代际或把 descriptor 当成正文。

### 原生复验与数据完整性

定位仅包装原失败断言，保留原用例从 scrollback 80→240、输出 220 行、reload、首末行页面检查到快照请求的全部动作，三个产品 bundle 的 SHA256 与上一轮正式 VSIX 相同。原等待再次在约 10.17 秒失败；同一请求收到 session=`47db1573-8b78-47fd-be15-e982c5843b46` 的 terminalRead，readId=`8c73cebc-22f8-41f8-918e-ca8188daa0cb`、checkpoint/head revision=9。

以原 node/kind/session/authority/readId 和 surface generation/frame 关联清空前的 bootstrap：四个 current-state 分块 offset 连续、合计 24874 字符，与描述符长度一致；用正式 `terminalCurrentState.ts` 解码器导入真实 `@xterm/headless` 6.0.0，得到 64×20、scrollback=240。`DSC_LRSP-001` 到 `220` 各自独占一行，逐行严格等于 1–220，顺序、数量及唯一性全部通过。该 reader 在请求前已有五个页面消息（四个状态分块和一个空后缀页），重复请求后零页面消息；新旧描述符完全相同。本次无后续增量页，不扩大为对未来输出/压力的验证。

最终专项 exit 0，表示“原超时已复现且同 reader 的 220 行完整性检查通过”，不表示正式 smoke 已通过。最初定位脚本的数字正则转义笔误导致额外解码检查失败，保留该诊断工件；纠正为 `[0-9]{3}` 后原样重跑确认，上述数据不存在缺失。原生节点已按原 stop 入口停止，Supervisor 随 idle shutdown 退出。脚本及精简证据为 `docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-investigation.mjs` 和 `runtime-scrollback-snapshot-evidence.json`。

### 引入过程与后续修复边界

`git blame` 显示旧内联断言来自 `74af9d0c6`；`c502a0fe9` 接入 live 分页恢复，`2bdfc311a` 再接入当前态恢复后，该用例仍保留旧 terminalStream 读取。PR314 上一轮启动屏障修复只让测试继续走到这里，没有修改该断言或产品分页分支。本轮没有回测历史发布包，不据提交日期指定首次受影响的发布版本。

后续修复应按当前新能力契约关联原 reader 的 descriptor、连续 state chunks 及其后的连续 revision，用正式 codec/真实终端模型验证保留历史，继续保留原 session、首末行、scrollback 和修订号覆盖。快照的 outputSequence 是该 descriptor 的 checkpoint revision；追上实时 head 需看后续页及应用位置，不能照搬旧完整 terminalStream.revision 的含义。旧协议若需验证，应明确走旧能力分支，不能为此把默认新路径回退为内联完整正文。

本轮仅定位；正式测试/产品均未改，完整门禁及后续 Runtime 矩阵继续待完成。计划见 `docs/exec-plans/completed/runtime-scrollback-snapshot-investigation.md`。

## Runtime 滚动历史分页断言修复：正式方案（2026-10-10）

`tests/vscode-smoke/terminal-history.cjs` 将测试观察与产品数据模型连接：保留清空前的 bootstrap，按新快照的 node/kind/session/authority/readId 和完整 lifecycle 关联页面；校验连续分块、长度、checkpoint 修订及后续连续事件，再用正式 `terminalCurrentState.ts` 导入真实 `@xterm/headless` 并应用后缀。缺数据继续等待；错误数据直接失败。快照 outputSequence 与 checkpoint revision 相等，应用位置至少到达 descriptor head，并确认已收到状态导入后的普通页面。

`verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory` 保留原 reload/reattach、首末行页面检查和配置恢复，增加所有 220 行逐行有序唯一及 scrollback 校验。`stageSmokeTestSuite` 将 helper 与正式 codec/headless 依赖打包进测试目录，适用于 VSIX 与开发宿主的统一 staging，不更改产品载荷或暴露调试 API。回归测试必须覆盖身份/生命周期污染和分页缺失、乱序、冲突，不能用字符串搜索压缩 JSON 代替模型还原。六组 helper 回归与 runner 环境回归通过；原生 VS Code 1.141.0 专项执行完整原函数通过，四块 24874 字符，220 行精确且唯一，scrollback=240，checkpoint/head/applied revision=15。默认 VSIX 七个独立阶段及 trusted 本条通过，后续摘要断言失败，详见本节验收记录。

### 本轮修复验收与后续边界

默认 VSIX 的类型检查、构建打包与七个独立阶段全部通过。trusted 原顺序再次通过本条滚动历史：原 session 的四块 24874 字符、220 行、scrollback=240、checkpoint/head/applied revision=5；继续通过 `verifyCompletedLiveRuntimeDiscardsHistoryAfterDrain`、`verifyLiveRuntimeReconnectFailurePreservesBinding` 和 `verifyHistoryRestoredIgnoresStaleAutomaticResume`。本轮正式打包的三个产品 bundle SHA256 与原生专项一致。

完整 gate 仍 exit 1，后续阻塞在 `verifyLiveRuntimeResumeExitClassification:10666`：恢复运行并发送 `exit 23` 后，status=error、lastExitCode=23 已通过，但 summary 实际 `Session ended.`，未满足 `/exit(?:ed with code| code) 23/`。该场景在 RuntimePersistence 开启时执行；失败后的 finally 关闭模式，因此最终快照的 persistenceMode 不能代替失败动作时模式。本轮未定位摘要差异来源，不据此判定测试文案过时或产品退出分类有错，也没有放宽断言。后续立即 reload 场景、独立 checkpoint 矩阵及跨平台/跨版本仍不由当前结果代证。

本轮隔离节点均已非 live，专项 finally 使用原 stop 入口；检查无本轮隔离 Supervisor 残留。修复证据：`docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-fix-evidence.json`；可复验脚本：相邻 `runtime-scrollback-snapshot-verification.mjs`；完成计划：`docs/exec-plans/completed/runtime-scrollback-snapshot-repair.md`。

## Runtime 恢复退出摘要专项定位（2026-10-10）

### 已确认根因与归属

这是当前 owned Runtime 路径的产品退出信息投影遗漏，原 smoke 的退出码摘要断言有效。`supervisor/runtimeSupervisorMain.ts:2244` 的 `finalizeOwnedExecution` 根据 AuthorityResult 与 processResult 设置 lifecycle、lastExitCode、lastExitSignal，但普通 EOF 分支没有调用 `setSessionLastExitMessage`；只有 source 非 EOF 时设置 terminalOutputIncomplete。`toSnapshot:2948` 因而携带退出码，却不携带 lastExitMessage 或 lastExitMessageDescriptor。

Host 的 `runtimeSupervisorLocalization.ts:14` 对两个退出消息字段皆空返回 undefined；`CanvasPanelManager.applyCompletedRuntimeSupervisorSnapshot:12895` 使用 Session ended. 作为节点摘要，`handleRuntimeSupervisorState:12525` 同样把通用文字发给页面，异常提示回退为 Session exited unexpectedly.。缺失已发生在 Supervisor 发布前，不是 Webview 翻译、测试正则过时、finally 关闭 Runtime 或 UI 迟到覆盖。原执行已经成功恢复并经历 running/waiting-input，resumePhaseActive=false，所以本例 error 分类正确，问题是具体退出原因未生成。

旧 `finalizeSession:2390` 对正常结束、主动停止、恢复失败、非零退出分别设置结构化 descriptor 和英文 fallback；其中 `describeAgentExit:3754` 为本场景生成 agentExitedCode。本轮没有改产品规格，最近退出信息仍属于 `runtime-persistence-modes.md` 第 6 节的保存内容，清理完成态正文不等于丢弃退出原因。

### 原生复现与受控对照

基于 `438ac68b` 的相同正式 VSIX，Linux x64 / Node 22.23.3 / VS Code 1.141.0 / fake provider，三份隔离宿主均使用正式 fixture 与完整 `verifyLiveRuntimeResumeExitClassification` 原动作和原断言。复制后的测试仅在断言前取证并在入口消费预期失败；baseline 三个产品 bundle hash 与上轮正式包完全一致。

无探针 baseline 原样复现：断言前 Runtime 开启，原 resume session 经过 resuming→running→waiting-input→error，lastExitCode=23，summary 与该 session 唯一 host/executionExit 均为 Session ended.。probe 只在复制的 Supervisor 发布处加只读记录，同样失败；原 session `b8323f4f-69dd-4579-84af-8e92e95bf8d6` 的 AuthorityResult=applied、finalRevision=4、processResult=exited/23、source=eof、stopRequested=false、resumePhaseActive=false，发布前两个退出消息字段均为空。

control 先记录相同缺口，再只在复制的 Supervisor 对这一已恢复、EOF、exit23 的执行补上 agentExitedCode descriptor 与英文 fallback。未改生命周期、退出码、分页/结算、Host 或测试断言，原函数完整通过：summary、lastExitMessage 与原 session 的 host/executionExit 都变为 Codex exited with code 23.。这是因果对照，不是正式修复；baseline/probe 的 exit 0 仅表示成功复现预期失败。所有隔离节点通过原 stop 入口清理，本轮 Supervisor 已退出。

### 引入历史与修复边界

`c1b6bc8b8`（feat(runtime): wire non-native execution owner lifecycle）新增 owned 收尾时即遗漏旧路径的退出描述生成。`08fa33725` 将正常构建默认接入平台 owned 实现，使该路径成为当前默认；`69bf93b6c` 仅补充非 EOF 的输出不完整消息，没有补齐普通 EOF 退出原因。本条摘要断言来自 `aa2a50cc2` 的恢复退出验收，`71c84eff6` 只调整英文正则；PR314 的滚动历史修复没有改产品载荷，只让完整门禁走到这里。本轮未回测发布包，不据提交日期断言首个受影响版本。

修复应在 owned Supervisor 发布终态之前恢复结构化退出描述及 fallback，保持已确认退出、主动停止、恢复阶段、输出不完整和未知结果各自的语义与优先级；不能通过 Host 任意补字符串或放宽 smoke 隐藏上游缺口。当前实验只验证成功恢复后 exit23 的摘要缺失；同函数对其他退出/恢复分支的静态差异需在正式修复时纳入回归，不能把本轮对照扩写为全部退出矩阵已验。本轮正式产品/测试不变，完整 gate 与后续场景继续待修复验收。

证据：`docs/references/smoke-reload-autostart/runtime-resume-exit-summary-evidence.json`；复验：相邻 `runtime-resume-exit-summary-investigation.mjs baseline|probe|control`；计划：`docs/exec-plans/completed/runtime-resume-exit-summary-investigation.md`。

## owned Runtime 退出描述修复：正式方案（2026-10-10）

在 `runtimeSupervisorMain.ts` 提取共享的已确认退出业务分类及描述生成，由旧 `finalizeSession` 和新 `finalizeOwnedExecution` 在发布前调用。Agent 主动停止/零码为 stopped；异常退出在仍处恢复阶段时为 resume-failed，已恢复或新启动为 error；Terminal 停止/零码为 closed，其他为 error。使用原有 describe helpers 与 setSessionLastExitMessage 同时设置稳定 descriptor 和 fallback，保留英文/本地化契约。

owned 以 AuthorityResult.applied 与已确认 process 为前提。无退出码的 signal 不伪造数值；terminated 仅在确有停止请求时生成停止描述，未知结果及 authority 失败保持 error 和已有失败原因。source 非 EOF 的 terminalOutputIncomplete 继续优先，不把 process 成功当输出完整。journal 故障已有描述不得被普通退出消息覆盖。原 session 防迟到保护、reader/最终应用/退休顺序不变。修复不在 Host 拼接临时字符串，也不放宽原 smoke。

验证覆盖正式 Supervisor 发布快照、旧协议退出消息、Host 本地化与原生恢复后 exit23；完整 gate 的后续结果另记。

### 退出描述修复的局部与原生验收

Supervisor owner 接线 134/134 通过，其中新增18项覆盖恢复已完成/未完成、零/非零/信号、主动停止、authority 失败、unconfirmed、terminated 与 journal 故障；既有非 EOF 和迟到换绑保护保持。早期恢复失败夹具不输出 prompt，避免墙钟等待输入推断先结束恢复阶段。新增恢复完成后23用例在原产品源码上因缺少 agentExitedCode 明确失败。完整 Runtime 协议链（含旧连接、checkpoint、分页/完成、Host 输出信用）、本地化、typecheck 通过。

正式 VSIX 载荷的原生专项保留原函数与原断言，完整通过：Runtime 开启，原 session 的 status=error、lastExitCode=23、节点 summary/lastExitMessage 与唯一 host/executionExit 均为 Codex exited with code 23. [fake-agent] exiting with code 23。无产品探针或消息补丁；默认 VSIX 的中断及同载荷重跑结果见本节后续记录。证据入口为 `docs/references/smoke-reload-autostart/runtime-resume-exit-summary-fix-evidence.json`；相邻 `runtime-resume-exit-summary-verification.mjs` 可重放。

### 本轮完整流程结果与后续边界

默认 `test:vsix-smoke` 完成打包与前六个独立阶段后，在 local-links-and-stop 的 URL 链接尾部停止推进：最后 probe 为 14:29:15Z，超过五分钟没有用例进展；HTTP listener 已关闭，VS Code 浏览器与测试服务的 TCP 连接仍 ESTAB。保留日志/probe/socket 现场后，仅对该隔离 VS Code 发 SIGTERM 结束运行，默认命令 exit1；这不是断言失败，也不算完整 gate 通过。服务 close 回调等待是现场线索，尚未对该间歇停滞完成独立根因定位。

使用同一份 packaged 产品和原始测试，local-links-and-stop 独立重跑 exit0。trusted 独立原顺序也越过原恢复后退出23摘要断言，在紧邻 `verifyImmediateReloadAfterLiveRuntimeLaunch:11000` 的模拟 reload 报 Runtime session updates are still pending. Please try again after they finish.。失败快照中 Agent=error/Execution start was rejected-before-acquire.，Terminal 仍 live；本轮未定位启动拒绝与 pending 回调之间的因果，不修改该用例、原准入额度或边界保护。后续 Host boundary、Runtime/reload、独立 checkpoint 与跨平台矩阵不由本轮代证。

原生专项节点由原 stop 入口清理；trusted 剩余 Terminal 按失败快照原 storage/session 用真实 client stop 清理并获确认，本轮隔离 Supervisor 已全部退出。当前修复完成，但完整门禁仍有上述独立阻塞/不稳定性。精简证据包含默认命令、两个同载荷独立重跑与清理事实，不将重跑成功追认首次运行通过。
