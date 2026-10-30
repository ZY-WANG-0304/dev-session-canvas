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

## 发布门禁修复收口

- 同一发布门禁中的关联问题默认集中到一个修复 PR，随代码一起提交根因文档、回归测试和验证证据；发布准备继续使用单独的发布 PR。文档可先在修复分支记录，不因记录根因或验证结果另建文档 PR。
- 修复 PR 尚未合并时，新发现的关联卡点默认继续在该 PR 中处理。只有存在独立交付范围或必要合并依赖时才拆分，并在拆分前说明理由、各 PR 的范围及合并依赖；不相关的改动不为减少 PR 数量而混入。
- 诊断、单变量对照和发布物料与修复的组合验证默认使用临时分支或 worktree，不额外创建 PR。相关证据随修复 PR 收口，并明确验证输入、结果和局限。
- 已合并的修复保留既有历史；后续新增修复按上述规则集中处理，不为整理 PR 数量改写已合并历史。
- 发布卡点闭环以修复落地、相关回归验证完成、文档同步及最终发布输入的完整门禁通过为准。完成定位、单项诊断通过或增加 PR 数量，均不能替代发布门禁通过。

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
2. 从最新 `main` 单独切出发布准备分支，在这条分支上集中处理版本号、`package.json`、`package-lock.json`、主扩展与 notifier `CHANGELOG.md`、Marketplace 文案、发布手册，以及 `docs/release-contracts/vX.Y.Z.md`。契约必须列出发布范围、用户 release notes、已复核文档、已知限制和验证范围；它们全部是发布前的静态输入。
3. CHANGELOG 只写用户可见的功能、安装升级、回退和产品限制。不要写发布准备待办、gate 状态、候选 SHA、workflow run、VSIX hash 或渠道结果；这些属于发布后证据，不能等发布完成后再回写进同版本 CHANGELOG。
4. 普通非草稿 PR 与 main push 均通过 `Release Preflight` 调用唯一的 `ci-validation.yml`：基础层始终执行，保守路径分类追加全部功能/产物范围；版本或发布契约改动强制完整 `release-pr`。发布准备 PR 每次更新从最新远端目标与 head 生成真实预合并 SHA，先纯静态 `release:preflight`，再执行完整任务图。稳定检查 `Release Preflight / Verify release contract` 只在独立核对实际 Actions job/工件来源、精确必跑集合和同批产物后通过；取消、少结果、错输入及清理/取证失败不能成功跳过。`main` 已启用活动 ruleset，要求 PR、至少一次 review、基于最新 base，并要求 GitHub Actions 的 `Verify release contract`。2026-10-29 临时红灯 PR #342 中，该检查失败且 PR 显示 BLOCKED；验证范围与限制见 [`release-gate-redesign.md`](design-docs/release-gate-redesign.md)。发布契约和完整验收未通过不得合并发布 PR。
5. 发布准备 PR review 并合并后，才在最终 `main` release commit 创建 `publish/vX.Y.Z`。六外层发布 job 为 resolve、verify、prepare、两个独立渠道、finalize；`verify` 在同一最终 SHA 完整验收，产生一批固定 main/notifier VSIX。验证阶段可构建候选包，`prepare` 只消费实际验收的原双包，对外交付前复算 SHA/ref/version/包回执和真实来源，不重新打包。完整验证通过前不创建正式 Release、不写渠道、不删除临时 tag。不得直接发布未合入 main 的准备分支。
6. workflow 生成的 release manifest、GitHub Release assets 和 GitHub Release notes 是发布后事实的唯一权威记录，可包含最终 ref、VSIX SHA、workflow run、渠道状态与 deferred 原因。它们不提交回仓库；发布完成后不因“记录门禁通过”再建 PR 修改该版本的 CHANGELOG 或发布契约。
7. 已存在的历史 tag 继续按其 tag 内的发布逻辑补发渠道；发布契约和双阶段 verify 只约束包含新文件的后续版本，不追溯改写历史 release input。
8. 部分渠道交付完成后的 `channel-retry` 下载原 Release 双包、原 acceptance 与连通父状态链，核对不可变身份/producer 后补交付；不得重打包、换 SHA、覆盖冲突资产或用历史绿色抹去本轮失败。提交结果 unknown 先查询，内容 match 才可完成；VS Marketplace 的既定 deferred 策略及原因如实保留，GitHub/Open VSX 为必需目标。
9. 初始 `prepare-release` 失败且尚未执行任何渠道 job 时，只能通过 `incomplete-release-recovery` 处理：从 `main` 手动触发并指定原失败 workflow run，核对两枚 tag 仍指向原 SHA、原 Release 仍是待交付正文、资产只包含本流程可能已上传的不可变文件，并确认原 run 的 `prepare-release` 失败、两个渠道 job 均 skipped。恢复流程在同一原 SHA 上重新跑完整 `release-tag` 验收，由该次验收生成的新同批双包继续准备；操作脚本使用 `main` 中已修复的发布代码，包内容仍来自原 SHA 的验收输入。已有同名资产只允许逐字节匹配，绝不覆盖。出现渠道结果或 manifest/state 时必须使用普通 `channel-retry`，不符合这些前置条件则拒绝恢复。
10. `npm run ci:verify` 与 `release:verify` 的本地入口在冻结输入和隔离 checkout 上运行同一任务图，输出 `acceptance: false`；本机没有的外平台记录 not-run，不冒充 Actions 完整验收。定向 `ci:diagnose` 必须声明单 case/payload/原因，也不签发正式回执。CI改造期间用临时分支验证修复与发布 PR327 的最新真实预合并组合，证据随现有修复 PR335，不另建诊断/验证/文档 PR。

## 生产服务部署流程

模板市场生产服务部署与插件对外发布分开管理。Worker API、浏览器市场 SPA、D1 migration、R2 访问逻辑和治理后台修复使用 `docs/workflows/SERVICE_DEPLOY.md` 中定义的独立 deploy tag；插件 Marketplace / Open VSX 发布继续使用本文件的发布流程和 `docs/workflows/VERSION.md`。

## Code Review 流程

1. 当进行 Code Review 工作时，按 `docs/workflows/CODE_REVIEW.md` 进行 Code Review，并把 findings、结论和 follow-up 以 MR 评论形式发布出来。
2. MR 更新后，必须基于最新的 MR head 进行复审；如果仍有 blocker，则继续通过评论指出。
3. 只有在 review 未发现新的确定性 blocker，且其他已知非阻塞问题已经从评论区沉淀到仓库文档、能被后续协作者直接追溯后，按 `docs/workflows/MR_MERGE.md` 给出可合并结论，等待用户确认。
4. 用户确认并许可后，reviewer 按 `docs/workflows/MR_MERGE.md` 执行合并。

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
