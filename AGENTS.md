# AGENTS.md

本仓库遵循 Harness Engineering 工作流。代理在执行任务时，应优先保证可追踪性、文档一致性和假设显式化。

## 当前约束

`AGENTS.md` 总长度不超过 100 行，并保持高信号。当前文档集不预设具体方案或执行计划；新增设计决策必须显式写入设计文档；所有面向人的项目文档默认使用中文。自 2026-04-05 起，仓库已完成 MVP 验证；后续默认按正式开发和持续迭代推进，除非任务明确要求做降风险实验，否则不要把交付物当成一次性原型。

## ExecPlans

编写复杂功能或进行显著重构时，使用 `ExecPlan`（定义见 `docs/PLANS.md`）覆盖从设计到实现的全过程。
如果任务本身是复杂设计研究，且涉及多步探索、候选方案比较、受控验证或持续决策记录，也应先创建设计阶段的 `ExecPlan`；`ExecPlan` 负责推进过程，设计结论仍需按 `docs/DESIGN.md` 记录到设计文档。

## 产品

目标用户、价值判断、优先级或取舍标准不清楚时读 `docs/PRODUCT_SENSE.md`；需要明确需求范围、验收口径和产品约束时读 `docs/product-specs/index.md`。

## 架构与设计

理解系统边界、依赖方向与稳定接口时读 `ARCHITECTURE.md`。涉及设计决策、方案比较、取舍或验证证据时按 `docs/DESIGN.md` 的机制更新 `docs/design-docs/index.md`、`docs/design-docs/core-beliefs.md` 和 `docs/design-docs/`；仅在任务涉及 UI、交互或前端实现时读 `docs/FRONTEND.md`。

## 工作流

开始交付性工作或进行 Code Review 工作前，统一先读 `docs/WORKFLOW.md`；需要执行具体协作动作时，再从该入口进入对应细分文档。

## 质量与参考

评估质量、可靠性和安全时分别读 `docs/QUALITY_SCORE.md`、`docs/RELIABILITY.md` 和 `docs/SECURITY.md`；`docs/generated/` 不能替代人工确认后的正式结论，`docs/references/` 只能作为输入，不能直接当作仓库结论。

## 重要原则

不要把未确认内容写成已确认内容，也不要从当前仓库文档中脑补具体方案。文档为空白或占位是有意为之；任何实质性实现前都应先补齐对应文档。

## 验证要求

每次有意义的变更，至少应包含文档更新、自动化测试或手动验证说明之一。

## 完成定义

只有在相关文档已同步、假设已显式记录、验证方式已说明，且未确认内容没有被误写成结论时，任务才算完成。
