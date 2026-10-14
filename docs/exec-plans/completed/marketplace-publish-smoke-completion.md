# 修复 Marketplace 发布 smoke 完成等待

本计划按 docs/PLANS.md 持续维护。独立修复PR只交付测试门禁修复、根因和回归；PR327继续负责0.26.1发布准备，合并与发布需后续授权。

## 目标与全局图景

模板发布成功且反馈稍晚时，门禁应等待原准确提示和唯一请求后再继续；真正缺失反馈或发布错误仍失败。维护者能通过确定性回归及实际宿主E2E复核，无需延长预算或修改生产发布顺序。

## 进度

- [x] 2026-10-14：fetch确认最新main72338331，创建独立/tmp/mpfix、marketplace-publish-smoke-completion分支，保留PR327与原工作区。
- [x] 登记已有CI首败、历史blob一致及响应阻塞/自然对照，写明归因边界。
- [x] 修正两处完成等待；20项实际场景VM回归通过，覆盖原预算和拦截器恢复。
- [x] 两类旧代码延迟反馈反例按预期失败；Node22构建、相关workflow及VSCode1.141.1原E2E/两类响应延迟300ms对照通过。
- [x] 同步正式文档、技术债及证据；独立修复PR的实际head/CI及交付链接以PR页面为准。

## 意外与发现

原CI使用stable1.141.1，旧成功和本地对照为1.141.0，不能据版本变化确认上游因果。请求登记发生在响应前；受控阻塞时请求1/提示0，释放101ms后原准确提示及v3 UI通过。旧等待从6月26日起未变，近期只更新英文文案。

## 决策记录

2026-10-14：采用同一原20秒等待同时确认请求数量与原预期提示，保留后续准确断言；不增加第二个20秒等待。理由是反馈才是此阶段验收点，且预算与负例必须保留。回归运行真实场景函数的隔离VM及虚拟时钟，真实宿主另验；不增加测试生产API或默认夹具盲等。代码/根因/回归统一一个PR，不另建诊断或文档PR。

## 上下文与定向

tests/vscode-smoke/template-marketplace-tests.cjs包含两个发布场景、信息提示拦截器和waitForCondition；template-marketplace-fixture.cjs提供本地HTTP夹具。生产CanvasTemplateMarketplacePanel.ts与TemplateMarketplaceClient.ts提供响应处理，不修改。新scripts/test/test-smoke-marketplace-publish.mjs加载场景源码，模拟命令、请求、提示和时钟；package.json将其接入npm test。

## 工作计划与里程碑

先记录正式方案，再修改两处等待条件。第一里程碑通过确定性通知滞后正例，旧代码应失败；第二里程碑证明缺失/错误提示、缺失/重复请求仍在原预算失败且拦截器恢复。最后以原生资产默认build和真实Marketplace E2E验证集成，归档计划、同步index/core-beliefs/技术债，创建可review PR。

## 具体步骤与验收

在/tmp/mpfix运行Node22下npm run test:smoke-marketplace-publish；使用git show origin/main的旧场景源码在相同回归中运行延迟正例，应在原提示断言失败。使用DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET提供同源码默认资产，运行npm run build及node scripts/smoke/run-template-marketplace-vscode-e2e.mjs；真实宿主保持原全部内容/身份/v3页面断言。保存命令exit、log hash及输入，不能将单项通过当成PR327完整发布通过。

## 幂等性与恢复

只操作本分支和自有临时工作树；不覆盖旧首败、共享VSCode缓存或用户修改。虚拟测试无真实计时等待，实际宿主使用自有短TMP目录。推送前fetch/rebase最新main，head变更后重新评估验证。暂时symlink依赖不执行npm ci，干净CI安装另行验证。

## 结果与复盘

正式修复和20项回归已完成；两类旧调用处反例证明回归捕获缺陷，真实VSCode1.141.1自然/300ms延迟对照全部通过，正式fixture已恢复原样。产品代码、原20000ms预算及内容/提示/UI断言不变。交付为一个独立修复PR，review及合入仍待用户后续安排；PR327最终输入完整门禁仍待合入后执行。未把具体CI调度或版本差异写成已确认产品/上游根因。

## 证据与接口

既有诊断入口docs/references/marketplace-publish-smoke-completion/root-cause.json。无生产API、依赖、发布版本或渠道改动。正式证据仅包含受控测试提示、输入/日志摘要，不提交原宿主环境日志。

2026-10-14修订：实现与定向验证完成，记录旧代码反例、新回归和真实1.141.1延迟响应证据，归档本计划；PR创建结果关联交付页面。
