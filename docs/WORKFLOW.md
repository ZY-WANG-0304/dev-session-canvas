# WORKFLOW

这个文件是仓库工作流文档的统一入口。
`AGENTS.md` 只负责指向这里；具体工作流规则统一收敛在本文件及 `docs/workflows/`。

## 适用方式

- 不确定当前任务该读哪份流程文档时，先从这里进入。
- 需要执行具体动作时，再跳到对应的细分文档。

## 当前阶段约定

- 自 2026-04-05 起，仓库已结束 MVP 验证阶段；后续默认按正式开发与迭代管理。
- 仍可为了降风险做局部实验或原型，但必须显式写清目标、退出条件和收口方式；不要把临时实现当成默认交付形态。

## 交付性工作流程

1. 开始任何交付性工作前，先从最新 `main` 切出主题分支；默认不直接在 `main` 上开展交付性改动，分支命名遵循 `docs/workflows/BRANCH.md`。
2. 开始实现前，先确认相关正式文档已经具备足够上下文；如果涉及复杂功能、显著重构或多步研究，先按 `docs/PLANS.md` 创建或更新 `ExecPlan`。
3. 在主题分支上完成与当前目标直接相关的设计、开发或文档修改；如果改动触及产品、设计或架构结论，必须同步更新对应正式文档。
4. 当当前目标已经形成一组可独立说明的改动时，按 `docs/workflows/COMMIT.md` 进行本地提交，并确保相关文档同步或验证说明可追溯。
5. 如果当前目标是一次对外发布或发布收口，应在发布范围冻结后、最终发布验证前，按 `docs/workflows/VERSION.md` 统一更新版本号，并同步 `package.json`、`package-lock.json`、`CHANGELOG.md` 等对外版本信息；普通功能或 bugfix MR 默认不因为开发进行中而单独更新版本号。
6. 当当前目标已经完成，且验证结果与相关文档已同步后，推送分支并创建 MR；目标分支默认是 `main`，MR 描述按 `docs/workflows/MR_CREATE.md` 保持与当前目标、验证结果和残余风险一致。
7. 当 MR 收到 comment 后，按评论结论处理相关修复、补齐文档、补充验证并登记技术债；完成后再次推送新的 MR head 供 reviewer 复审。

注意：在每次准备推送当前分支、创建MR、更新MR前，默认先拉取最新 `main` 并对当前分支执行 `rebase`。

## Code Review 流程

1. 当进行 Code Review 工作时，按 `docs/workflows/CODE_REVIEW.md` 进行 Code Review，并把 findings、结论和 follow-up 以 MR 评论形式发布出来。
2. MR 更新后，必须基于最新的 MR head 进行复审；如果仍有 blocker，则继续通过评论指出。
3. 只有在 review 未发现新的确定性 blocker，且其他已知非阻塞问题已经从评论区沉淀到仓库文档、能被后续协作者直接追溯后，按 `docs/workflows/MR_MERGE.md` 执行合并或给出可合并结论。

补充判断原则：

- “可合并”不等于“除了 blocker 之外什么都不用管”。
- 默认标准是：主路径没有新的确定性 blocker，且剩余已知问题已经 repo-local，而不是只留在评审评论里。

## 工作流文档

- 分支命名规则见 `docs/workflows/BRANCH.md`。
- commit 约定见 `docs/workflows/COMMIT.md`。
- 版本号命名规则见 `docs/workflows/VERSION.md`。
- Code Review 规则见 `docs/workflows/CODE_REVIEW.md`。
- MR 描述内容与格式见 `docs/workflows/MR_CREATE.md`。
- 执行 MR 合并的规则见 `docs/workflows/MR_MERGE.md`。
