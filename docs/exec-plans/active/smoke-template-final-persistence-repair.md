# 修复模板保存测试的最终保存清理

本 ExecPlan 按 `docs/PLANS.md` 维护；根因研究已完成，此计划负责正式夹具修复、回归与发布组合验证。

## 目标与全局图景

模板保存导出测试在清理自身自动启动的 Agent/Terminal 时，先按原身份确认最终保存成功，再进行至多一次新的 reset，避免正常保存窗口阻断门禁。保留产品 reset 在 pending/failed 时的保护，保持测试20秒总上限和所有模板行为断言。代码、根因、回归与证据集中一个修复 PR，发布继续使用PR327。

## 进度

- [x] (2026-10-15) 从最新main eee25291创建独立修复分支，接入调查文档与证据。
- [x] (2026-10-15) 唯一清理调用点接入既有reset helper，传原Agent/Terminal。
- [x] (2026-10-15) 新回归在旧代码pending处先红；修后9/9和原19/19通过，语法/diff通过。
- [ ] 固定修复与PR327临时组合输入，确定性原生保存窗口和完整release:verify验证。
- [ ] 同步文档、归档临时workflow、创建集中修复PR供review。

## 意外与发现

原CI观察38596179995在1138行复现，Agent owner已settled且save submitted，但pending检查先于8ms后的saved。既有helper已覆盖19项身份/期限/失败保护，遗漏的是本例接线。研究对照38605013416的control原生完整trusted通过，生产代码未改；正式修复仍须按最终输入验证。

## 决策记录

2026-10-15：只修改保存导出后的清理入口，使用已捕获agentNode/terminalNode作为期望节点；不等待两个节点都started，因为Terminal可能被原并发准入拒绝并not-required，也不把所有reset全局包装。调用点回归运行源码中的真实清理片段，避免只测helper而漏验接线。临时组合用原PR327版本物料与修复，不更新发布PR，不建诊断或验证PR。

## 结果与复盘

实现进行中；正式修复未合入，原完整门禁failure不追认通过。当前无合并、tag或发布授权。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs::verifyCanvasTemplatesTrusted` 新建Agent/Terminal/Note，保存/导出模板，随后清空以验证重新应用模板后的idle状态。`tests/vscode-smoke/reset-canvas.cjs::resetCanvasAfterFinalPersistence` 捕获原节点集合与已有保存诊断，只接受本例pending；确认每项原保存saved/not-required后最多再reset一次。`CanvasPanelManager.ts` 产品立即拒绝保存未结算的reset保持不变。主分支当前为eee25291；调查文档为local-final-snapshot-boundary-root-cause.md，固定原发布head20d237c5。

## 工作计划与里程碑

先在正式函数中用resetCanvasAfterFinalPersistence替换单次reset，期望执行由前面捕获的两个节点提供。新增脚本从正式函数的导出与重新应用之间提取实际源码，在可控command/save观察边界运行，验证顺序和失败保护；接入已有test:smoke-reset-fixture命令。第一里程碑以原代码失败、修复通过为准。第二里程碑在CI正常包运行确定性保存结果交接gate，并用固定组合ref产生同输入六资产和不加过滤的完整发布验证。第三里程碑同步文档和receipt，移除临时workflow，正常创建修复PR等待review，不合并。

## 具体步骤

修复工作目录 `/dev/shm/dsc-template-final-fix`，依赖只读复用 `/tmp/dsc261fresh/node_modules`，Node22为 `/tmp/dsc-release-node22/node_modules/node/bin/node`。运行 `npm run test:smoke-reset-fixture` 和相关语法/diff检查。组合工作树使用独立临时分支，重放PR327发布提交到修复ref，冻结组合SHA后在Ubuntu22.04按正式preflight/verify命令执行，六资产必须由同ref构建；结果登记到docs/references/local-final-snapshot-boundary/repair-result.json。

## 验证与验收

新增调用点回归应在原代码的pending场景失败；修后原节点保存成功后清空才进入ensureEditorCanvasReady。保存失败、其他节点pending不得再reset或进入后续模板阶段。既有19项回归保持。原生确定性窗口要记录原执行身份、首次拒绝、saved、第二次空画布；完整组合release:verify必须不设scenario filter且保留首败。未通过就继续在同修复范围处理，不伪报完成发布。

## 幂等性与恢复

主用户工作区WORKFLOW.md保持不动。临时工作树和分支不修改main/PR327，未知进程不清理。node_modules链接不提交；临时workflow只存在验证分支，完成后归档移除，结果不覆盖历史日志。推送及PR更新前fetch/rebase，已有远端更新用固定lease。

## 证据与备注

根因和原自然/受控失败来自docs/references/local-final-snapshot-boundary/，实验通过仅证明其具名范围。最终修复与完整门禁receipt将在本计划记录，不把研究control当作正式通过。

## 接口与依赖

复用现有reset helper与TypeScript AST读取能力；不新增产品API或npm依赖。

修订记录：2026-10-15建立正式修复计划，保持有限入口、原身份及原总预算。
