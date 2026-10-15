---
title: packaged Runtime 重启准入拒绝根因调查
decision_status: 比较中
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/smoke-lifecycle-diagnostic-isolation.md]
updated_at: 2026-10-15
---

# packaged Runtime 重启准入拒绝根因调查

## 问题与现有证据

PR327与生命周期诊断隔离的固定组合输入f8d9ad5341f8a20a7cbd97fda6beb01e71937ddc，完整run38681093813在clean-checkout packaged trusted的`verifyLiveRuntimePersistence → waitForRuntimeExecutionStarted`首次失败。最后Agent记录`Execution start was rejected-before-acquire.`，editor ready与bootstrapAck均为true。本轮追踪的是这一执行拒绝，已完成的ready隔离另见`smoke-restricted-ready-root-cause.md`。

原完整日志和末次快照已保存；7.2GB工件收集器只收外层仓库`.debug`，失败clean-checkout在`/tmp/dev-session-canvas-clean-checkout-k840ba/repo`，没有可据此逐事件核对的原Supervisor现场。原错误文案被两个入口使用，单凭文案不能唯一判定：`supervisor/runtimeSupervisorMain.ts:createSession`会在旧收尾容量满时直接拒绝，`panel/executionSessionAdapter.ts:start`在authority启动准入失败时也返回相同kind，Supervisor转成相同message。单项run38685094467 trusted exit0只说明非必现。

以下源码位置相对于`extensions/vscode/dev-session-canvas/src/`。`tests/vscode-smoke/extension-tests.cjs:verifyLiveRuntimePersistence`先停止已确认started的Agent、Terminal，再立即发起显式尺寸的新Agent。`ensureAgentStopped/ensureTerminalStopped`等待节点`liveSession=false`；`waitForOriginalLocalExecutionRetirement`只检查`localExecutions`，live-runtime的Supervisor会话不在该数组，因此本例没有等待旧Supervisor责任释放。

`panel/CanvasPanelManager.ts:applyCompletedRuntimeSupervisorSnapshot`先投影`liveSession=false`、清runtime绑定，再等待读者与轻量终态保存，随后移除Host managed session、发布state，最后调用`deleteRuntimeSupervisorSessionStrict`。停止消息的测试派发函数`dispatchWebviewMessageForTest`同步返回快照，`handleWebviewMessage`用void启动异步停止，不提供完成证明。因此节点停止投影、Host保存、读者结算、Supervisor journal删除是不同完成点。

## 已确认机制与责任边界

`docs/product-specs/runtime-persistence-modes.md`的正式准入是`{ executions: null, starting: 1, pending: 2 }`。旧执行与读者已退役但仍保留在Supervisor `sessions`的会话，含等待Host保存、正在删除journal和删除失败，也占pending额度。`supervisor/runtimeSupervisorMain.ts:createSession`把owner仍持有的责任和已退休但存储尚未删除的会话去重合计；达到2时在journal/provider获取前拒绝。`removeSession`只在journal成功删除并移除session后释放额度。这是既有产品契约，不能用“节点已经停止”提前释放，也不会自动重试已拒绝的新请求。

实际Supervisor原有134项接线回归全部通过。其中`production admission retains completed storage responsibility during awaiting-host-save/slow-delete/failed-delete`确认旧责任保持时原create拒绝、删除完成后下一次新create可启动；混合退役/owner责任按一次计数。这134项使用真实类与真实journal、受控外部transport，不是原生端到端证据。

run38688569741的真实VS Code packaged trusted受控对照已确认同入口可复现的夹具竞态。保持原两份journal删除责任直到原启动请求发出，停止助手已经返回，Supervisor owner `pending=0/admissionPending=0`、authority `starting=0`，但两份旧session仍`retiring=true/retired=true`。新Agent在`retainedRetirements=2`时被容量检查拒绝，未进入新provider启动；旧会话4–7ms后实际删除，原等待仍按默认15秒失败。对照仅调整这两份原session的删除时序，不改准入、状态投影或原业务断言。

同run的等待退役对照在原session删除处增加500ms延迟，并只在本例等待两份原身份的`remove-finished`，保持原Agent started断言及其预算；完整trusted exit0。自然样本同样exit0，新create前两份旧session都已删除。更严格的run38688776387只在观察原容量拒绝后释放这两份旧删除，再次按原入口exit1；拒绝时authority starting=0、owner admissionPending=0、retainedRetirements=2，10ms后两份session均完成删除。该轮自然样本与等待两份实际退役的完整trusted对照均exit0，三份完整工件、ZIP CRC、tar内容和因果断言已本地核验。两个独立受控拒绝对照均证实同一机制，不把这个有限样本当作总体失败率。

相关历史也吻合：git blame显示旧存储责任合计检查由4d710fd12于2026-10-08引入；停止助手的live=false等待来自4月，2026-10-09只新增localExecutions退役等待，未覆盖Supervisor。它不是本轮ready隔离引入的准入变化。

当前可确认：smoke把live=false当作可立即重启的前提，缺少Supervisor退役屏障；正式容量拒绝符合契约。原完整CI缺少逐事件计数，不能追认当时一定只有这一时序原因，也未证明VS Code上游或打包文件损坏。packaged是触发环境，非功能范围边界；普通用户过快启动且旧收尾达到2也可按契约收到拒绝。

## 候选修复与验收

优先在smoke停止/重启流程等待两份原Supervisor会话的存储退役结果，然后发起一次原新启动；屏障固定停止前的完整runtime身份，保存、读者或删除失败仍按失败退出，不延长产品容量、自动重试或清未知责任。实现要先确认现有诊断/RPC是否可证明`removeSession`完成，不能只等`runtime-delete-requested`、删除已提交或owner空数组。当前产品`preserveTerminalReads`删除RPC在reader尚未退休时可能成功返回而保留session，不能未经核对就把RPC成功等同实际删除。

固定sleep不能证明退役，延长`waitForRuntimeExecutionStarted`预算也不会重新发起已拒绝请求；放宽pending容量会改变产品约束。这些不作为本次建议。是否需要产品层增加更清楚的瞬时容量提示属于独立判断，本次没有实施新修复。

验收需用实际停止助手证明其在旧删除责任保留时等待、旧身份释放后仅启动一次、缺失/失败退役仍失败，并保留Agent与Terminal原started证据及完整trusted后续断言。最终发布输入仍须rebase PR327并跑无过滤完整门禁；诊断或单项通过不放行发布。

## 证据与复跑

证据随PR335集中在`docs/references/smoke-lifecycle-diagnostic-isolation/`。原始完整首败是`packaged-first-failure.*`；本轮对照使用同固定组合源码、run38681093813同输入六资产、Ubuntu22.04、Node22、VS Code1.142.0、clean-checkout默认npmci及隔离HOME，测试对象是实际生产VSIX解包后的Host与原生provider。临时诊断记录Supervisor原身份、owner/authority计数和stop/delete/remove时序；有界workflow与插桩是验证输入，不进入正式实现。

临时控制第一版run38688460456因JSONL转义缺陷取消；另一版run38688728706也因语法校验失败取消，均不作为产品证据。run38688569741与更严格run38688776387均完成，六份完整工件在devshm本地核验；精简入库证据保留后者三份完整ZIP来源、hash、输入hash和原身份时序。活动workflow和probe已在ea62310d移除，未新增PR或修改正式实现。
