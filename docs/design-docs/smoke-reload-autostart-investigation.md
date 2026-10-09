---
title: smoke 重读画布后自启动超时的根因与修复边界
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层, 画布呈现层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/smoke-reload-autostart-investigation.md, docs/exec-plans/completed/canvas-owned-execution-reconciliation.md]
updated_at: 2026-10-09
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

完整 `npm run test:vsix-smoke` 已通过上述场景并越过 trusted 的原 sidebar/尺寸重读/自启动失败段，但仍在 `verifyAgentExecutionFlow` 的 `burst 1` 等待失败。失败断言读取 `metadata.agent.recentOutput`；当前 `projectNonNativeHostBusiness` 不把活动终端正文实时写入该历史字段，实际输出由 `host/executionOutput` / `host/executionSnapshot` 交付。失败现场同一原生 Agent 仍 live、status 为 waiting-input，终端快照含 `[fake-agent] burst 001`，metadata 仍保留上一条执行的最终正文，且没有 `execution/ownedProjectionRejected`。这是该后续断言与现有正文通道的错位，不是本次画布绑定再次丢失。下一步需按原执行身份和当前输出协议审计这一组执行流断言；不能把一次过滤场景通过写成完整发布门禁成功。本 PR 保留这次原失败，0.26.1 发布仍需补齐完整门禁。

workspace trust 与 editor deserialize 都复用已修复的 `loadReconciledState`，本轮做了调用点审计，但未执行这两个独立 UI 场景。真正的窗口 Reload、Remote SSH、旧 Supervisor 与跨版本升级仍由各自矩阵验证，不由本次结果代证。

## 证据与复现

精简结构化观测在 `docs/references/smoke-reload-autostart/evidence.json`。实际使用的临时探针和实验入口在同目录 `diagnostic.patch`，复现步骤见 `README.md`。它们是调查输入，本文件才是人工复核后的归因；patch 不应用到正式产品或 CI，也不构成产品修复。

原日志 `/tmp/dsc261b-vsix.log`，原 artifact 目录 `/tmp/dev-session-canvas-clean-checkout-akdQNG/repo/.debug/vscode-vsix-smoke/smoke-runtime/artifacts`。本轮完整日志与快照在 `/tmp/dscr/.debug/rca`。远程 0.26.0 CPU profile 的配置读取热点没有与本次状态失配建立因果关系，本轮未扩展到性能修复。
