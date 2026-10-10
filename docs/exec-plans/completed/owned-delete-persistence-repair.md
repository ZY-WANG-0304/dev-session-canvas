# 修复单节点删除的最终保存等待

本计划按 `docs/PLANS.md` 维护。基线 PR314 / `d4f360ca`，工作树 `/tmp/dscr`。

## 目标与全局图景

用户删除运行中的 snapshot-only Agent/Terminal 时，原执行停止后在有限时间内等待原最终保存，然后一次完成节点及文件引用清理。保存失败、未确认或超时继续保留节点；等待期间节点、执行或操作被替换时不得误删新目标。

## 进度

- [x] (2026-10-11) 根因和原生单变量对照已完成；用户授权正式修复。
- [x] (2026-10-11) 更新S8单节点入口例外；新增回归在旧产品上因删除提前返回失败。
- [x] (2026-10-11) 实现20秒有界等待与目标复核，19项新增定向回归通过。
- [x] (2026-10-11) Host588/588、类型、本地化通过；默认VSIX七个阶段通过，trusted原files/readexit通过，后续Claude Fork启动诊断超时。
- [x] (2026-10-11) 同步证据与技术债并归档；提交、rebase/push及PR更新通过Git/PR记录追踪。

## 意外与发现

旧 S8 §26.3 有意在 owner settled 后保存仍 pending 时拒绝；正常原生保存约21ms后完成。此次正式调整单节点 delete 的契约，不能删除最终保存保护或把 owner settled 扩大为写盘完成。

## 决策记录

2026-10-11：仅 `deleteNode` 显式启用保存等待，复用 `waitForNonNativeHostPersistence` 的既有 boundaryMs 预算。原执行仍在 owner 与已退休但保存 pending 的 retained 两个分支均覆盖。reset、清组、模板等共用 terminate helper 的旧调用保持既有契约，不借本轮扩大等待范围。

2026-10-11：保存责任的 metadata 引用随合法最终投影更新，作为等待后身份核验依据；核验捕获的 owner、原 record 路由、当前 map/owner 是否出现替换、原 metadata 和删除操作 token。原记录成功退休离开 map 不算替换，布局更新保持原 metadata 允许删除。超时返回后迟到保存只结算原保存，不恢复已结束的删除请求。

## 结果与复盘

正式实现、Host588/588、类型和本地化通过；默认VSIX原文件全用例及readexit通过，删除阻塞关闭。完整gate在后续Claude Fork诊断等待处失败，根因未确认；不扩大本轮修复。

## 上下文与定向

`CanvasPanelManager.ts` 的 deleteNode 调用 terminateExecutionNodeForDeletion 后移除节点/引用。helper 的 owned 和 retained 分支目前同步检查最终保存。原 NonNativeHostExecution.persistence 持有独立 promise/result/metadata；persistNonNativeHostFinal 先投影最终 metadata，再启动异步保存。`scripts/test/test-host-execution-owner-wiring.mjs` 的 persistenceFixture 使用真实 root/workspace 文件与受控 workspaceState Promise，可验证正常等待、失败与迟到结果。

## 工作计划

第一里程碑记录有界等待及原目标规则，新增正在运行/已退休 pending 保存的删除回归，先在旧产品上看到提前返回失败。第二里程碑让单节点删除显式请求等待，不影响其他 helper 调用；补成功、失败、未确认、超时迟到、替换、路由和布局边界。第三里程碑复跑完整 Host 与原 native 文件函数，保留原断言和完整 gate 的实际停点。

## 具体步骤

目录 `/tmp/dscr`；依赖从 `.debug/rca/node_modules`、`.debug/rca/playwright-browsers` 恢复。Node22 路径 `/tmp/dsc-release-node22/node_modules/node/bin`，VS Code `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`，资产 `/tmp/dsc-release-026-assets`。

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='single node delete' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    npm run test:ui-copy-localization
    npm run test:vsix-smoke

专项复用 `owned-file-activity-resume-verification.mjs files/readexit`，仅选择原函数，产品不加探针。证据放 `.debug/owned-delete-persistence-fix/`。完成停放依赖，fetch/rebase origin/main 后提交推送并更新 PR314，不合并或发布。

## 验证与验收

原保存 pending 时删除不提前返回；保存成功仅原目标被删，Agent 引用收敛；保存失败/未确认/超时保留。超时后的 saved 不续删；旧 nodeId 被复用、metadata/记录/owner/操作 token 变更或 root 路由改变不得误删。无替换的布局更新仍允许完成。默认 gate 失败须列真实停点，不能由专项代证。

## 幂等性与恢复

不重试或重提最终保存，不增加无限等待。测试用隔离数据与原执行身份，结束停止本轮执行；保留其他工作树。

## 证据与备注

调查证据为 `owned-delete-persistence-root-cause-evidence.json`；正式修复证据为 `docs/references/smoke-reload-autostart/owned-delete-persistence-fix-evidence.json`；默认trusted原序列已通过files/readexit，不再重复独立原生运行。失败快照零localExecutions。

## 接口与依赖

terminateExecutionNodeForDeletion 增加默认关闭的单节点保存等待选项，复用原 promise 与 scheduler；不改变公开协议或磁盘格式。

修订：2026-10-11，冻结单节点范围、预算与等待后身份保护方案。

修订：2026-10-11，19项新增回归覆盖running/retained成功、失败、超时迟到与目标替换/布局，类型和本地化通过。旧pending负向测试推进保存等待期限，仍验证拒绝和原责任保留。

修订：2026-10-11，默认原生gate越过文件与readexit并推进至Claude Fork；记录准确通过范围和新停点，归档本轮修复。
