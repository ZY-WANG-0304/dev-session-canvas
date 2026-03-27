# AGENTS.md

本仓库遵循 Harness Engineering 工作流。
当前目标是构建一个复刻 OpenCove 核心产品体验的 VSCode 插件：把 AI Agents、终端、任务和笔记放到同一张无限 2D 画布上，让用户在多 Agent 协作时仍能看清全局。

## 当前约束

- 当前阶段只复刻核心协作体验，不复刻独立 app 的 workspace 管理能力。
- 所有面向人的正式项目文档默认使用中文。
- `AGENTS.md` 保持高信号，不写具体实现细节或待确认方案。
- 未确认内容不得写成既定事实；空白或占位是有意设计。

## ExecPlans

- 复杂功能、显著重构、多步研究或存在较大不确定性的任务，先按 `docs/PLANS.md` 创建或更新 `ExecPlan`。
- 如果任务本身是设计研究，`ExecPlan` 负责推进过程；正式设计结论仍需落到 `docs/DESIGN.md` 和 `docs/design-docs/`。

## 产品

- 需要判断目标用户、价值主张、优先级或范围时，先读 `docs/PRODUCT_SENSE.md`。
- 需要写单个需求的范围与验收口径时，使用 `docs/product-specs/`。

## 架构与设计

- 需要理解系统边界、领域划分和稳定接口时，读 `ARCHITECTURE.md`。
- 需要记录问题定义、候选方案、取舍和验证证据时，按 `docs/DESIGN.md` 更新 `docs/design-docs/`。
- 涉及 UI、交互或前端实现时，再补充参考 `docs/FRONTEND.md`。

## 工作流

- 开始交付性工作或 Code Review 前，先读 `docs/WORKFLOW.md`。
- 需要执行具体动作时，再进入 `docs/workflows/` 中的细分规则。

## 质量与风险

- 质量维度见 `docs/QUALITY_SCORE.md`。
- 可靠性要求见 `docs/RELIABILITY.md`。
- 安全与隐私边界见 `docs/SECURITY.md`。

## 重要原则

- 不要把参考产品、历史经验或个人偏好直接写成当前仓库已确认结论。
- 不要用实现细节替代正式文档；实现与文档冲突时，必须显式收口。
- 文档应先于关键实现落地，至少要把问题、边界和验证方式写清楚。

## 验证要求

每次有意义的变更，至少应包含以下之一：

- 正式文档更新
- 自动化测试
- 手动验证说明

## 完成定义

只有在相关文档已同步、假设已显式记录、验证方式已说明，且未确认内容没有被误写成结论时，任务才算完成。
