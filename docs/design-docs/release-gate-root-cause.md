---
title: PR327 发布门禁准备失败与诊断等待边界调查
decision_status: 待探索
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/release-gate-root-cause.md]
updated_at: 2026-10-13
---

# PR327 发布门禁准备失败与诊断等待边界调查

## 问题与范围

PR328合入后，PR327预合并7e659ce6的GitHub门禁在runtime-checkpoint-refresh基础Agent启动失败；本地相同tree的ec4afba3在local-links-and-stop超时。本文记录分别定位的证据；调查分支不修改发布输入或正式产品行为。

## 当前结论

本地等待helper漏检已确定性复现：原waitForDiagnosticEvents在异步取回结果后，仅在下一轮Date.now小于deadline时检查predicate。读取跨越截止会直接报错，即便末批事件精确匹配。原renderer日志显示首次missing-target.ts搜索耗时9592ms、第二次321ms，QuickOpen在08:35:57.262Z调用，事件在57.295Z到达，57.494Z报错；动作请求ID对应47.328Z。原墙钟没有记录准确helper起点/取回瞬间，不能将事件实际到达时刻自动等同deadline内取回。受控脚本保留原函数和正负场景，不实施修复。

CI通用错误源于runtimeRootPreparation.ts外层catch，存储准备已完成，异常仍待具体取证。原模式只请求legacy-detached，禁用D-Bus，排除systemd选择候选。CI原六平台全部构建通过，Linuxmanifest/binary与本机逐字节相同，排除这两项输入差异。原固定输入stock VSCode1.141.0独立checkpoint全场景exit0，不代证CI首败或完整gate通过。

## 验证方法与证据

计划记录docs/exec-plans/active/release-gate-root-cause.md。diagnostic-wait-boundary.mjs在vm中读取并执行原helper；CI专用workflow release-gate-root-cause.yml固定原预合并和原native资产，运行完整gate，仅临时为准备函数加入阶段和catch错误文件记录，原返回、启动责任、预算和断言保留；它是诊断运行，不是正式最新发布门禁。测试结束恢复临时源码，上传固定摘要，不上传原环境/凭据/SSH私钥或全HOME。源码日志变更发生在隔离checkout，正式修复仍需另行确认。

## 剩余问题与候选修复范围

等待修复需明确末次观察与原deadline的语义，覆盖首读、末读与负例，不扩大预算。root修复范围在捕获具体异常后确定，禁止通用catch转ready或提交后换backend。当前PR327仍草稿，正式门禁失败。
