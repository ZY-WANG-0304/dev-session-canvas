# 定位 owned 删除与最终保存的时序

本计划按 `docs/PLANS.md` 维护。工作树 `/tmp/dscr`，PR #314 基线 `e640f6f1`。

## 目标与全局图景

确认文件活动 smoke 删除运行中的 Agent B 后，进程已经停止但节点和引用没有移除的根因。区分产品删除链路、文件事件排空与测试断言问题，提供可复跑的因果证据；本轮只定位，不修改正式产品或 smoke 行为。

## 进度

- [x] (2026-10-11) 复核现场：Host 错误为 Local final snapshot persistence is pending，稍后原执行最终 saved。
- [x] (2026-10-11) 确认 owner settled 与 Host 异步保存独立，同步拒绝来自已在 main 的 b235a7bc5，符合旧 S8 §26.3 契约。
- [x] (2026-10-11) 受控 Host8/8；native probe捕获pending到21ms后saved，control完整通过原文件活动函数，均清理为零执行。
- [x] (2026-10-11) 同步设计、证据与技术债并归档；提交和PR更新由Git/PR记录追踪。

## 意外与发现

`terminateExecutionNodeForDeletion` 等待 owner.requestStop 后立即同步检查最终保存结果。owner 收口与 Host 异步写盘是两个不同承诺，运行已证实保存仍pending时检查失败；collector已释放。readexit先退出并重读状态再删除，不能证明运行中一次删除成功。旧S8文档明确有意拒绝pending、不新增等待预算，故这是旧契约与当前用例期望不一致，不是新collector引入。

## 决策记录

2026-10-11：保留正式产品和原文件活动函数。隔离 probe 仅记录停止返回、持久化检查及保存完成顺序；control 仅在原删除停止结果后等待原 record 的最终保存，再走原检查。不使用延时重试、忽略失败或手动删节点来制造通过。

## 结果与复盘

根因确认：停止settled后同步保存检查按旧契约立即拒绝pending，21ms后saved不续删。Host8/8因果测试和native单变量对照完成；control原文件用例完整通过，probe仍失败。正式产品和测试未改，完整gate未重跑；有界等待与原目标保护需后续正式设计/实现。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 deleteNode 先调用 terminateExecutionNodeForDeletion，再删除节点和文件引用。NonNativeHostExecution.persistence 保存原执行的最终写盘 promise/result。`executionOwnerLifecycle.ts` 的 requestStop 负责执行资源和终端消费收口，不自动包含 Host 写盘。`scripts/test/test-host-execution-owner-wiring.mjs` 的 fixture 可控制进程、输出、资源释放与存储完成。最新原生现场位于 `.debug/owned-file-activity-resume-fix/files-1791654822757/runtime/artifacts/result.json`。

## 工作计划

第一里程碑沿代码与现场错误定位提前失败分支，并核查 git blame。第二里程碑在隔离 Host 测试控制写盘 promise，比较运行中删除和先保存后删除；在同一 VSIX bundle 的隔离 native 入口记录时序，control 只增加原保存等待并运行原文件活动断言。第三里程碑记录通过范围和后续停点，明确产品影响与推荐修复边界。

## 具体步骤

在 `/tmp/dscr` 恢复 `.debug/rca/node_modules` 和 `.debug/rca/playwright-browsers` 到根软链接。Node 使用 `/tmp/dsc-release-node22/node_modules/node/bin`，VS Code 使用 `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`。复用本轮已构建的 `.debug/vscode-vsix-smoke/smoke-host`，校验 extension.js hash 为 e62c8a771f64d137b15e69c25d64b41643290b7437cb3733589a1e1a95836a3e。

受控复跑：`node docs/references/smoke-reload-autostart/owned-delete-persistence-host-investigation.mjs`，预期8/8。原生复跑：`xvfb-run -a node docs/references/smoke-reload-autostart/owned-delete-persistence-investigation.mjs probe`，再以control运行，预期两个脚本exit0但仅control原场景通过。

调查脚本保存到 `docs/references/smoke-reload-autostart/owned-delete-persistence-investigation.mjs`，运行 probe/control 模式，日志和原始工件放 `.debug/owned-delete-persistence-investigation/`。隔离 Host 测试从既有 fixture 构造，结束删除临时文件。调查完成停放依赖，fetch/rebase origin/main，提交文档与复跑证据并更新 PR314。

## 验证与验收

probe 须看到原停止 settled 时保存尚 pending、同步检查抛错、后来 saved 且节点仍在；control 须确认等待原保存后原删除及引用断言通过。保存失败/未确认不应被对照绕过，原执行身份不能替换。若原函数后续失败，精确报告停点，不声称完整 gate 通过。

## 幂等性与恢复

原生使用隔离用户数据和复制的 bundle，仅清理本轮节点/进程。正式源码和测试保持不变。临时测试与依赖恢复后工作树只保留调查文档与脚本。

## 证据与备注

证据 `docs/references/smoke-reload-autostart/owned-delete-persistence-root-cause-evidence.json`；原生两轮original bundle hash一致且对应e640f6f1。probe/control均exit0表示调查捕获成功，不是原场景都通过。代码锚点为CanvasPanelManager.ts:20456同步检查和:17681原异步保存；旧策略在runtime-exit-integrity-production-integration.md §26.3。

## 接口与依赖

复用原执行的 requestStop、persistence.promise、waitForNonNativeHostPersistence 与 assertNonNativeHostPersistenceComplete，不新增正式接口或依赖。

修订：2026-10-11，建立删除时序调查计划，记录 pending 错误及单变量等待假设。

修订：2026-10-11，记录Host8/8、native21ms时序及control全函数通过；补查旧S8策略来源，区分保守契约与一次删除体验。正式修复未执行，调查归档。
