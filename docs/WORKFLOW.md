# WORKFLOW

这个文件是仓库工作流文档的统一入口。`AGENTS.md` 只负责指向这里；具体规则收敛在本文件及 `docs/workflows/`。

## 适用方式

- 不确定当前任务该读哪份流程文档时，先从这里进入。
- 需要执行具体动作时，再跳到对应的细分文档。

## 交付性工作流程

1. 开始交付性工作前，先从最新 `main` 切出主题分支；默认不直接在 `main` 上开展交付性改动。
2. 开始实现前，先确认相关正式文档具备足够上下文；如果任务复杂，先按 `docs/PLANS.md` 创建或更新 `ExecPlan`。
3. 在主题分支上完成与当前目标直接相关的设计、开发或文档修改；如果改动影响产品、设计或架构结论，必须同步更新正式文档。
4. 当当前目标形成一组可独立说明的改动后，按 `docs/workflows/COMMIT.md` 进行本地提交。
5. 当当前目标完成，且验证结果与文档已同步后，推送分支并创建 MR；默认目标分支为 `main`。
6. 收到 review comment 后，按评论结论处理修复、补齐文档、补充验证，并把不阻塞当前合并的问题登记为技术债。

默认在每次准备推送当前分支、创建 MR、更新 MR 前，先拉取最新 `main` 并对当前分支执行 `rebase`。

## Code Review 流程

1. 进行 Code Review 时，按 `docs/workflows/CODE_REVIEW.md` 执行，并把 findings、结论和 follow-up 以 MR 评论形式发布。
2. MR 更新后，必须基于最新 head 进行复审。
3. 如果未发现新的确定性 blocker，则按 `docs/workflows/MR_MERGE.md` 执行合并。

## 工作流文档

- 分支命名：`docs/workflows/BRANCH.md`
- commit 约定：`docs/workflows/COMMIT.md`
- Code Review：`docs/workflows/CODE_REVIEW.md`
- MR 描述：`docs/workflows/MR_CREATE.md`
- MR 合并：`docs/workflows/MR_MERGE.md`
