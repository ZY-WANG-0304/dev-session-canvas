# 定位发布门禁的最终快照 pending

本 ExecPlan 按 `docs/PLANS.md` 持续维护。当前范围是因果调查，不交付产品修复，也不创建诊断或文档 PR。

## 目标与全局图景

解释 PR327 完整发布门禁 run38579057915 为什么在第八个 packaged trusted 场景失败，确认触发操作、原执行身份、关闭和最终保存的先后关系，并区分测试前提失配与产品行为。结论必须有原始日志和受控验证支持，供用户决定修复范围。

## 进度

- [x] (2026-10-14) 保存原门禁输入与完整日志，核验最新 main eee25291 与发布 head20d237c5。
- [x] (2026-10-14) 从最新 main 创建独立调查分支，保护用户主工作区 WORKFLOW.md 与 PR327。
- [ ] 定位 trusted 中触发错误的具名测试、命令与原执行。
- [x] (2026-10-15) 真实Host/正式持久化8项对照捕获即时拒绝、saved后二次操作、failed保留。
- [x] (2026-10-15) 本地1.141.0原trusted整套通过，模板五次reset无records；未复现原失败。
- [ ] Ubuntu22.04原发布head/同输入六资产的packaged trusted观察，确认具名触发。
- [ ] 同步根因文档、索引和未修复事项，收口调查。

## 意外与发现

原错误是 `assertNonNativeHostPersistenceComplete` 的即时检查，不是 20 秒最终保存等待超时。`closeNonNativeHostExecutions` 在 owner 关闭 settled 后可直接检查保存，也可选择等待；`simulateRuntimeReloadForTest` 请求等待，而 reset/模板路径未请求。仅凭代码尚不能确定原门禁走了哪个入口。

## 决策记录

2026-10-14：调查在 `/tmp/persist-rca` 的 `investigate-local-final-snapshot-boundary` 分支记录，基于最新 main；原门禁以固定预合并 9f602fed、发布 head20d237c5 为准。临时插桩或等待对照只能放调查环境，不能将其视作正式修复或门禁通过。

## 结果与复盘

调查进行中，根因未确认。PR327 仍为草稿；本任务没有合并、发布或正式代码修复。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 持有本地执行记录。执行 owner settled 表示进程、输出和资源已结算，最终快照还有单独的 Promise；`persistNonNativeHostFinal` 提交持久化，`settleNonNativeHostPersistence` 登记 saved/failed/unconfirmed。`tests/vscode-smoke/extension-tests.cjs` 是源码和 VSIX 共用的 trusted 测试；`scripts/smoke/run-vscode-vsix-smoke.mjs` 将生产 payload 解包到 smoke-host 执行。旧 S8 策略要求 reset 等入口在保存 pending 时拒绝；单节点删除已有专用等待，不能未经确认推广。

## 工作计划

先从 `/tmp/pr327-after333-gate/verify-full.log` 提取 trusted 起点及错误，结合测试顺序缩小入口。必要时在隔离包装增加具名调用与失败现场记录，不修改断言和预算。再通过真实 CanvasPanelManager 的受控 Host 测试暂扣原保存 Promise，对照即时检查与既有等待选项，检验原执行保存结果及状态保护；必要时执行原生 packaged trusted。将已证实的原因、历史策略与推荐修复分开写入 `docs/design-docs/local-final-snapshot-boundary-root-cause.md`。

## 具体步骤

所有源码读取和实验在 `/tmp/persist-rca`；原门禁日志与 receipt 保持 `/tmp/pr327-after333-gate/` 不变。依赖和 VS Code 缓存从现有工作树复用，不重复无关完整门禁。执行命令、输入与结果随具体实验补入本文。

## 验证与验收

必须确定原失败调用或明确证据局限；对照只改变等待/调度这一变量，原关闭、保存检查、失败保护与身份保持。正常保存完成后 saved，拒绝发生于结果登记之前才能证明是时序；failed/unconfirmed 必须保留且不得报告成功。原生通过仅证明具名路径，不替代完整发布验收。

## 幂等性与恢复

不修改用户工作区或发布 PR head，不覆盖旧日志，不删除未知运行进程。临时插桩在独立调查副本撤销；证据保留。保存延迟必须释放或有界收口，避免将未结束 Promise 遗留为未知状态。

## 证据与备注

原 run：https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38579057915。verify job115906633987，19,107,699 bytes，SHA256 a9d2ec25106a259c55e576a955238da9d2b6326172af3e7b7a72f377ec4fee51。错误时间 2026-10-14T14:54:22Z；原 agent 为 agent-1-94167e82-7759-4f0b-921b-c1311ad654ce。

## 接口与依赖

仅复用现有 Node22、esbuild、Host 测试包装与 VS Code 原生 runner。调查不新增产品接口或依赖。

修订记录：2026-10-14 建立调查计划，明确即时检查与保存等待尚需因果验证。

修订记录：2026-10-15记录受控机制证据及本地未复现，新增固定原输入CI观察。
