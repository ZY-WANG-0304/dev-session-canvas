# OpenCove Extension

一个 VSCode 插件项目，目标是在 VSCode 内复刻 OpenCove 的核心产品体验：把 AI Agents、终端、任务和笔记放到同一张无限 2D 画布上，让多 Agent 协作时的全局状态保持可见。

## 当前范围

- 复刻核心协作体验
- 宿主为 VSCode
- 不复刻独立 app 的 workspace 管理能力

## 当前状态

项目仍处于前期定义阶段，当前已完成最小文档骨架迁移，尚未开始正式功能实现。

下一阶段重点：

- 明确第一版产品规格
- 明确画布与对象模型设计
- 建立第一份可执行的 `ExecPlan`

## 对开发者的说明

- 这个 `README.md` 只保留开发者需要的项目级说明。
- 开始继续开发前，先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 和 [docs/PRODUCT_SENSE.md](./docs/PRODUCT_SENSE.md)，先理解当前项目的产品目标和架构边界。
- 在理解产品和架构后，优先通过 AI 继续推进开发工作，而不是直接脱离现有文档体系单独扩写实现。
- `AGENTS.md` 和 `docs/` 主要用于 Agent 驱动开发时的约束、设计记录和执行计划。

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [AGENTS.md](./AGENTS.md)
- [docs/PRODUCT_SENSE.md](./docs/PRODUCT_SENSE.md)
- [docs/PLANS.md](./docs/PLANS.md)
