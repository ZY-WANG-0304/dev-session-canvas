# 修复模板保存测试的最终保存清理

本 ExecPlan 按 `docs/PLANS.md` 维护；根因研究已完成，此计划负责正式夹具修复、回归与发布组合验证。

## 目标与全局图景

模板保存导出测试在清理自身自动启动的 Agent/Terminal 时，先按原身份确认最终保存成功，再进行至多一次新的 reset，避免正常保存窗口阻断门禁。保留产品 reset 在 pending/failed 时的保护，保持测试20秒总上限和所有模板行为断言。代码、根因、回归与证据集中一个修复 PR，发布继续使用PR327。

## 进度

- [x] (2026-10-15) 从最新main eee25291创建独立修复分支，接入调查文档与证据。
- [x] (2026-10-15) 唯一清理调用点接入既有reset helper，传原Agent/Terminal。
- [x] (2026-10-15) 新回归在旧代码pending处先红；修后9/9和原19/19通过，语法/diff通过。
- [x] (2026-10-15) 固定修复84d65765、PR327 head20d237c5及组合031db473；原生run38656199224确定性触达pending、原saved后二次reset与完整trusted通过。
- [x] (2026-10-15) 完整release:verify run38656127632退出0；六平台同输入资产、npm test、SSH两态、Webview426/426与8个packaged含trusted全部通过，完整日志/receipt hash已回收核验。
- [x] (2026-10-15) 同步根因/索引/核心信念/技术债和repair-result.json，归档并移除两条临时活动workflow。
- [x] (2026-10-15) 创建集中修复PR [#334](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/334) 目标main，归档本计划；PR327保持原head和draft。

## 意外与发现

原CI观察38596179995在1138行复现，Agent owner已settled且save submitted，但pending检查先于8ms后的saved。既有helper已覆盖19项身份/期限/失败保护，遗漏的是本例接线。研究对照38605013416的control原生完整trusted通过，生产代码未改。正式代码84d65765的run38656199224在实际VS Code1.142.0确定性触达pending，原Agent/Terminal同身份saved后第二reset空画布，整套trusted通过；与原自然复现1.141.2分别记录，不推断版本缺陷。六平台组合资产summary均为031db473，两宿主加载和manifest/二进制hash已核验；它们只证明加载，不代证全平台产品行为。

## 决策记录

2026-10-15：只修改保存导出后的清理入口，使用已捕获agentNode/terminalNode作为期望节点；不等待两个节点都started，因为Terminal可能被原并发准入拒绝并not-required，也不把所有reset全局包装。调用点回归运行源码中的真实清理片段，避免只测helper而漏验接线。临时组合用原PR327版本物料与修复，不更新发布PR，不建诊断或验证PR。

2026-10-15：正式原生验证保留helper源码，只增加观察与原保存结果交接gate；代码输入84d65765，正常包生产bundle仍与研究输入一致。限定单项复用原run38579057915的六资产；完整组合031db473/run38656127632必须重建六资产且不设scenario filter。原生结束后以e8c685fd移除临时活动workflow，归档到reference。

## 结果与复盘

实现与28项回归完成；正式修复原生pending窗口及完整trusted通过，完整组合门禁及正常clean-checkout的8个packaged场景通过。交付PR334等待review，正式修复未合入，原完整门禁failure不追认通过。剩余发布门禁责任登记到tech-debt-tracker：PR334合入后rebase PR327并运行最新正式预合并完整门禁，本计划不承担未经授权的合并、tag或发布。经验是用例接线回归和目标pending窗口验证都不可被helper单测或未触达窗口的成功替代。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs::verifyCanvasTemplatesTrusted` 新建Agent/Terminal/Note，保存/导出模板，随后清空以验证重新应用模板后的idle状态。`tests/vscode-smoke/reset-canvas.cjs::resetCanvasAfterFinalPersistence` 捕获原节点集合与已有保存诊断，只接受本例pending；确认每项原保存saved/not-required后最多再reset一次。`CanvasPanelManager.ts` 产品立即拒绝保存未结算的reset保持不变。主分支当前为eee25291；调查文档为local-final-snapshot-boundary-root-cause.md，固定原发布head20d237c5。

## 工作计划与里程碑

先在正式函数中用resetCanvasAfterFinalPersistence替换单次reset，期望执行由前面捕获的两个节点提供。新增脚本从正式函数的导出与重新应用之间提取实际源码，在可控command/save观察边界运行，验证顺序和失败保护；接入已有test:smoke-reset-fixture命令。第一里程碑以原代码失败、修复通过为准。第二里程碑在CI正常包运行确定性保存结果交接gate，并用固定组合ref产生同输入六资产和不加过滤的完整发布验证。第三里程碑同步文档和receipt，移除临时workflow，已创建PR334等待review，不合并。本次三个里程碑均完成，最终PR文档收口相对84d65765不改脚本/测试/产品/manifest/lock/workflow；不需把文档提交重跑为新的代码因果实验。

## 具体步骤

修复工作目录 `/dev/shm/dsc-template-final-fix`，依赖只读复用 `/tmp/dsc261fresh/node_modules`，Node22为 `/tmp/dsc-release-node22/node_modules/node/bin/node`。运行 `npm run test:smoke-reset-fixture` 和相关语法/diff检查。组合工作树使用独立临时分支，重放PR327发布提交到修复ref，冻结组合SHA后在Ubuntu22.04按正式preflight/verify命令执行，六资产必须由同ref构建；结果登记到docs/references/local-final-snapshot-boundary/repair-result.json。实际固定组合为031db473，工作流run38656127632在同ref构建六平台资产，Ubuntu22.04/Node22默认npm ci、browser安装后原命令完整执行；静态preflight已通过。正式原生run38656199224已通过，脚本instrument-fixed-cleanup.mjs和两份workflow均归档同reference目录；完整verify和preflight的receipt退出码均0，verify日志16,970,961 bytes/hash已核验；临时workflow移除后不再自动运行。

## 验证与验收

新增调用点回归已在原代码的pending场景失败；修后原节点保存成功后清空才进入ensureEditorCanvasReady。保存失败、其他节点pending不得再reset或进入后续模板阶段。既有19项回归保持。原生确定性窗口要记录原执行身份、首次拒绝、saved、第二次空画布；完整组合release:verify已不设scenario filter并退出0，原历史首败仍保留。最终正式PR327预合并输入仍须在修复合入后验证，临时组合成功不冒充发布完成。

## 幂等性与恢复

主用户工作区WORKFLOW.md保持不动。临时工作树和分支不修改main/PR327，未知进程不清理。任务node_modules临时链接已移除且未提交；临时workflow只存在验证分支，完成后归档移除，结果不覆盖历史日志。推送及PR更新前fetch/rebase，已有远端更新用固定lease。

## 证据与备注

根因和原自然/受控失败来自docs/references/local-final-snapshot-boundary/，实验通过仅证明其具名范围。repair-result.json已记录正式原生run、完整原身份时序、ZIP/日志/生产bundle hash，以及六资产input/archive/manifest/二进制和两宿主load；完整门禁receipt已回收核验，不把研究control当作正式通过。

    Smoke reset fixture: 19/19 passed.
    Smoke template reset: 9/9 passed.
    Actual fixed template cleanup: pending, original save and second reset passed.
    VSIX packaged-payload smoke passed (trusted).

## 接口与依赖

复用现有reset helper与TypeScript AST读取能力；不新增产品API或npm依赖。

修订记录：2026-10-15建立正式修复计划，保持有限入口、原身份及原总预算。

修订记录：2026-10-15核验正式代码的原生pending→同身份saved→第二reset空画布，登记实际VS Code1.142.0与临时组合门禁运行状态。

修订记录：2026-10-15登记完整组合源码trusted/restricted、升级、双窗口、systemd及SSH两态通过；Webview与packaged仍以待验记录，不追认全量成功。

修订记录：2026-10-15回收run38656127632完整成功receipt，核验npm test/SSH两态/Webview426/8个packaged及日志hash，移除临时工作流；剩余为修复PR创建与计划归档，PR327正式发布输入另验。

修订记录：2026-10-15创建修复PR334并归档本计划，最终仅补文档；后续PR327正式预合并门禁责任保留在技术债，未合并或发布。
