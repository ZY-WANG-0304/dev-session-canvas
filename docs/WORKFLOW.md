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

1. 开始任何交付性工作前，先从最新 `main` 切出主题分支；若目标明确属于已登记长期特性集成范围，且对应远端集成分支已创建，先从该集成分支切出子主题分支。默认不直接在 `main` 上开展交付性改动，分支命名遵循 `docs/workflows/BRANCH.md`。
2. 开始实现前，先确认相关正式文档已经具备足够上下文；如果涉及复杂功能、显著重构或多步研究，先按 `docs/PLANS.md` 创建或更新 `ExecPlan`。
3. 在主题分支上完成与当前目标直接相关的设计、开发或文档修改；如果改动触及产品、设计或架构结论，必须同步更新对应正式文档。
4. 当当前目标已经形成一组可独立说明的改动时，按 `docs/workflows/COMMIT.md` 进行本地提交，并确保相关文档同步或验证说明可追溯。
5. 功能或实现类主题分支默认先只收口功能本身；普通功能或 bugfix MR 默认不因为开发进行中而单独更新版本号，也不提前混入 Marketplace 文案、发布手册或 tag 计划等发布收口物料。若某些 manifest / 安装路径改动本身就是功能成立条件（例如 companion 的 `extensionDependencies`、`api` 声明、运行时必需的图标或 listing 入口文件），可随 feature 一起合入 `main`，不要为了形式把它们硬拆到后续发布准备分支。
6. 当当前目标已经完成，且验证结果与相关文档已同步后，推送分支并创建 MR；目标分支默认是 `main`，但已登记长期特性集成范围内的子主题分支必须先合入对应集成分支，MR 描述按 `docs/workflows/MR_CREATE.md` 保持与当前目标、验证结果和残余风险一致。
7. 当 MR 收到 comment 后，按评论结论处理相关修复、补齐文档、补充验证并登记技术债；完成后再次推送新的 MR head 供 reviewer 复审。

注意：在每次准备推送当前分支、创建 MR、更新 MR 前，默认先拉取最新目标分支，并对当前短生命周期分支执行 `rebase`。PR / MR 更新时应通过 `rebase origin/main`（或对应目标分支）追赶目标分支，不要把 `origin/main` merge 进 PR / MR 分支。共享的长期特性集成分支不执行 `rebase` 或强制推送；需要追赶 `main` 时，在集成分支上合并最新 `main`。

## 长期特性集成分支

- 当某个特性规模较大、会长期处于未完成状态，或直接合入 `main` 会影响主线可发布性时，应先登记长期特性集成分支，并在对应设计文档中记录范围、合并边界和退出条件。
- 长期特性集成分支是共享 integration branch；相关子主题分支先合入该分支，完成总体验收后再由集成分支通过 MR 合回 `main`。
- 长期特性集成分支只覆盖对应设计文档明确定义的范围，不按名称泛化到同领域的普通功能或 bugfix。
- 对属于长期特性范围的工作，`main` 在特性完成前只接收默认关闭、可独立验证、可回滚，且即使长期特性延期也仍有价值的基础设施改动；未完成 UI、入口、安装流程、远端服务依赖和治理能力不得直接暴露到 `main`。
- 模板功能本身不等于模板市场特性：普通、非复杂的模板功能更新仍从最新 `main` 切出并合入 `main`；只有模板市场相关功能或未完成行为子主题才使用 `feature/templates-marketplace`。
- 模板市场集成分支登记为 `feature/templates-marketplace`。该集成分支首次创建时，以本分支策略合入后的 `origin/main` 为基线创建远端 `origin/feature/templates-marketplace`；远端分支存在前，不把子主题 MR 目标设为该分支。
- `feature/templates-marketplace` 创建后定期通过 merge 追赶最新 `main`；个人或短生命周期子主题分支可以 rebase 到最新 `feature/templates-marketplace`。

## 技术债清理流程

1. 技术债登记、拆解和修复按 `docs/workflows/TECH_DEBT.md` 执行；复杂或跨模块技术债仍按 `docs/PLANS.md` 使用 `ExecPlan`。
2. 修复技术债时，变更范围只服务于当前要修复的技术债；允许分批缩小大技术债，但不得混入顺手修复或引入新的技术债。

## 发布流程

1. 当准备一次对外发布时，先确认当前版本对应的 feature 均已经合入 `main`；不要把尚未合并的功能分支 head 直接当成发布输入。
2. 从最新 `main` 单独切出一条发布准备分支，在这条分支上集中处理版本号、`package.json`、`package-lock.json`、`CHANGELOG.md`、Marketplace 文案、发布手册与最终发布验证。
3. 发布准备分支完成后，创建一个只包含发布收口内容的 MR 合回 `main`，并在 review 中明确发布输入、验证结果与残余风险。
4. 只有在发布准备 MR 完成 review 并合并后，才在 `main` 上执行最终 publish 与 tag；不要在未合入 `main` 的发布准备分支 head 上直接发布或打 tag。

## 生产服务部署流程

模板市场生产服务部署与插件对外发布分开管理。Worker API、浏览器市场 SPA、D1 migration、R2 访问逻辑和治理后台修复使用 `docs/workflows/SERVICE_DEPLOY.md` 中定义的独立 deploy tag；插件 Marketplace / Open VSX 发布继续使用本文件的发布流程和 `docs/workflows/VERSION.md`。

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
- 技术债登记、拆解和修复规则见 `docs/workflows/TECH_DEBT.md`。
- 版本号命名规则见 `docs/workflows/VERSION.md`。
- 模板市场生产服务部署流程见 `docs/workflows/SERVICE_DEPLOY.md`。
- Code Review 规则见 `docs/workflows/CODE_REVIEW.md`。
- MR 描述内容与格式见 `docs/workflows/MR_CREATE.md`。
- 执行 MR 合并的规则见 `docs/workflows/MR_MERGE.md`。
