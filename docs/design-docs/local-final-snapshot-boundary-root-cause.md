---
title: PR327 packaged trusted 最终保存 pending 调查
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, 项目状态域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/local-final-snapshot-boundary-investigation.md, docs/exec-plans/active/smoke-template-final-persistence-repair.md]
updated_at: 2026-10-15
---

# PR327 packaged trusted 最终保存 pending 调查

## 原失败与证据范围

正式 run38579057915 固定预合并9f602fed（main eee25291、PR327 head20d237c5），Node22、Ubuntu22.04、VS Code1.141.2。最后 trusted 于2026-10-14T14:54:22Z对agent-1-94167e82-7759-4f0b-921b-c1311ad654ce报 `Local final snapshot persistence is pending`。原完整日志19,107,699 bytes，SHA256 a9d2ec25106a259c55e576a955238da9d2b6326172af3e7b7a72f377ec4fee51，位于 `/tmp/pr327-after333-gate/verify-full.log`。workflow未上传该runner失败现场，原具体调用与保存后续结果不能从已销毁现场补取；后续固定输入CI观察独立复现，不冒充该原现场。

## 已确认机制与旧策略

`CanvasPanelManager.ts::closeNonNativeHostExecutions` 等owner settled后，默认立即执行 `assertNonNativeHostPersistenceComplete`。资源结束不涵盖最终保存Promise；提交保存后仍可以未登记saved。原错误没有进入20秒保存等待，故不是等待耗尽。正式设计 `runtime-exit-integrity-production-integration.md` §26.3选择reset/清组/模板pending时拒绝，保存完成后允许新的操作。单节点删除为显式等待例外。`reset-canvas.cjs` 为四个smoke清理入口适配此契约，不涵盖所有直接reset。

## 已有机制验证

真实Host及正式持久化8项受控验证（Agent/Terminal × 即时检查/等待对照 × saved/failed）捕获预期结果：暂扣原workspaceState.update后owner已settled/retired、submitted=true、result未登记；原reset提前拒绝保留节点。释放后saved不续行原reset，显式第二次可清空；failed保留节点。等待对照仅启用既有等待，成功才清空，失败仍拒绝。脚本 `docs/references/local-final-snapshot-boundary/host-investigation.mjs`，日志 `/tmp/persist-rca-host.log`。该受控实验独立证明机制；具名触发由后续CI观察确认。

本地生产bundle、发布manifest、原suite加观察钩子，以VS Code1.141.0运行trusted整套通过。模板五次reset没有owned records，未复现首败，不能将模板cleanup推测定为根因。本轮重建bundle不声称是原CI VSIX字节。

## CI 因果证据

观察run [38596179995](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38596179995) 使用诊断head4e787d61，另checkout原发布head20d237c5、默认npm ci、同原run六资产/预合并9f602fed，Ubuntu22.04、实际VS Code1.141.2。正常生产VSIX解包后只增加观察；生产extension bundle SHA256为2b3d4c38b488a382caa588d9334de0d75a258d51c210bff4129c7dfe5ddc0eb5。复现原三处bundle栈位置229:144027、229:169889、227:411。

具名触发是 `tests/vscode-smoke/extension-tests.cjs::verifyCanvasTemplatesTrusted` 第1138行。该函数创建Agent/Terminal/Note，等待节点存在，改title/content、保存并导出模板；随后直接调用testResetState。没有先按原执行完成清理，也没有使用已有最终保存reset夹具。

16:13:52.193Z进入reset时，原Agent为starting/admissionPending、未提交保存，Terminal尚排队；16:13:52.235Z Terminal取消后结算not-required。16:13:57.228Z Agent已settled/retired、四资源released、seal/terminal尾部确认、最终保存submitted=true，但result尚未登记；原即时检查抛pending并保留三个节点。16:13:57.236Z，同executionId43f14e29/generation3fdcbab5保存为saved，距拒绝8ms。保存完成只释放记录，不续行已失败reset；最终failure snapshot零records但三个节点仍保留。没有保存失败、挂起或超时证据。该8ms是复现样本的结果间隔，不作为新预算依据。

原完整门禁现场未上传，不能恢复原node94167的逐项时间线；固定原产品/同版本环境复现的具名调用与三处原栈、受控Host机制共同支持本根因，不伪造原runner现场。脱敏原身份时序见 `docs/references/local-final-snapshot-boundary/ci-probe-result.json`，artifact11910510961/ZIP SHA256 c01cdd17dc8d6a47a6901d966f8cad059e09ef3440d39b2574897891721eea76。

单变量control [38597464423](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38597464423) 只将第1138行reset交给既有 `resetCanvasAfterFinalPersistence`，捕获本次原records作为期望执行，保留全部原trusted顺序和断言。job与完整trusted成功，生产bundle同probe。回收发现1138处无records且一次reset成功，未触发目标pending；这不是目标处跨保存窗口的原生先红后绿。增加同一启动前提与最终保存结果交接gate的probe/control，确定性检验原策略和夹具，实际磁盘写入不改。

## 确定性保存窗口对照

普通control目标无records，所以另执行受控run [38605013416](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38605013416)，head879c4e39，两格同原发布head/六资产/Ubuntu22.04/VS Code1.141.2，原三个生产bundle均一致。只在1138处等待原Agent started，在真实persistState返回后暂扣结果交接Promise，使最终保存必然跨过即时检查；检查后下一事件循环释放，实际文件写入及保存内容不改。probe/control仅差该处是否使用既有reset夹具。

probe于17:15:50.041Z按预期报pending，后续同Agent/Terminal均saved且三个节点保持；control于17:15:48.959Z同样触发pending，17:15:49.022Z原Agent为saved，夹具确认本执行结果与原节点未变，17:15:49.065Z第二次reset，49.072Z空画布。完整原trusted随后退出0并报 `VSIX packaged-payload smoke passed (trusted)`。结论以两格的预期结果分别判定，整体workflow因预期失败probe显示failure，不误记整体success。证据 `docs/references/local-final-snapshot-boundary/final-gated-result.json`；artifact11915437142/11914204147。

首轮受控run38603542973保留failure：probe pending复现，control在新增Terminal started前提失败；原Terminal被并发准入拒绝/not-required。该诊断前提过强，不是本次保存问题的新产品根因。纠正为两格只等待原Agent started，原Terminal结果不改；首轮失败仍登记first-gated-result.json。

原Host8项对照与既有reset helper19项纯回归均通过；正常saved与failed保留由Host对照检验，超时/身份/第二次失败由helper现有回归检验。原生受控对照不是生产修复后的完整发布门禁，不能解锁PR327。

## 正式方案

直接原因是模板测试单次reset假定与产品既有“保存pending则拒绝”策略不一致，属于测试夹具遗漏。该调用来自2026-05-07的e826ee9e7；已有reset helper来自898b326f，此入口没有接入，不能归因PR328/333或VS Code上游缺陷。包和源码共用测试，是否撞到保存窗口取决于执行启动与页面调度，源码或本地通过不证明该前提成立。

正式修复只为本例按自身Agent/Terminal身份复用既有20秒总预算的最终保存reset夹具，最多一次原保存成功后的新reset；failed/unconfirmed、错误身份、替换节点、超时和第二次拒绝仍失败。不删产品保护、不固定sleep、不抬预算。该处之后都是无自动启动的模板副本；其余直接reset若有活跃执行需具名审查，不做全局无条件重试。产品单次reset体验属于不同策略决定，本调查不改变它。

## 修复边界

调查阶段仅提交文档与临时实验；用户后续已授权实施下述具名测试修复。正式产品与保存策略保持，代码、回归、根因与证据集中一个修复PR；临时验证不建PR，发布PR327 head20d237c5保持。

## 正式修复验收（2026-10-15）

用户授权后，在最新main eee25291的修复分支将 `verifyCanvasTemplatesTrusted` 保存导出后唯一cleanup接入既有 `resetCanvasAfterFinalPersistence`，以本例先前捕获的Agent/Terminal节点作为期望执行。不修改产品、helper、其他reset或20秒总预算，所有保存/导出/重新应用/默认模板/删除与导入断言保留。新增 `scripts/test/test-smoke-template-reset.mjs` 用TypeScript AST取得正式函数中实际cleanup和ensureEditorCanvasReady语句并运行，避免只验证helper而漏验接线；覆盖成功、两种节点pending/failed/unconfirmed、非本例pending及缺少原Terminal结果。旧代码第一pending场景失败；修后9/9、既有19/19和语法/diff通过。package.json的test:smoke-reset-fixture接入新增回归，无版本与依赖变动。

正式代码84d65765的原生run [38656199224](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38656199224)（Ubuntu22.04、Node22、VS Code1.142.0）通过：23:48:21.954Z首次check原Agent/Terminal均submitted/pending；同身份分别在21.970Z、21.982Z saved且三个原节点保留，22.063Z第二次check、22.070Z空画布；全部原trusted exit0。正常VSIX生产bundle与研究probe一致，解包后仅增加观察入口和真实保存结果交接gate，正式cleanup未被替换。该单项复用原六资产，完整门禁另在组合031db473重建六资产；本次实际VS Code版本与原复现1.141.2不同，分别记录。原生证据和归档见repair-result.json、instrument-fixed-cleanup.mjs、fixed-cleanup-native.workflow.yml。

完整临时发布组合run [38656127632](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38656127632) 固定组合031db473（修复84d65765 + PR327 head20d237c5），六平台资产从同组合ref重建、同run组装，Ubuntu22.04/Node22/default npm ci、实际VS Code1.142.0，不设scenario filter。静态preflight及完整release:verify均退出0：npm test、源码完整smoke、SSH exit/retain、Webview426/426、clean-checkout正常VSIX的8个packaged场景含最后trusted均通过。完整verify日志16,970,961 bytes，SHA256 c94da001a416cb214e1f28e513b53ad474b316eebf11aaa90a61397274c2542c，receipt和完整输出artifact11938492555/11938592162已核验大小和hash。证据repair-result.json，工作流归档full-repair-release-gate.workflow.yml。

两条活动临时workflow已移除；根因、回归和证据集中本修复PR。临时组合通过只验收修复与既有发布物料组合，不是PR327最新正式预合并输入；修复合入后仍须rebase PR327并重跑正式完整门禁。最终PR收口仅补文档，不改变已验证的代码与20秒边界，不追认原failure，也不解锁合并/tag/发布。
