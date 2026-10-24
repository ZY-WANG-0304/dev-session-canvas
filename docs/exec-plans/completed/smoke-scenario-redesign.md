# 按验证目标重新划分 smoke 场景与子场景

本 ExecPlan 按 `docs/PLANS.md` 持续维护。当前任务是设计研究：交付可审阅的场景划分、旧覆盖迁移清单、通过条件和实施验收顺序。本轮不改变产品、smoke入口或发布门禁。继续既有修复/审查分支，不新增诊断、验证或文档PR；发布PR327仍单独保留。

## 目标与全局图景


用户审阅smoke时发现，`local-links-and-stop`把终端链接与多个独立停止用例放在一起，`local-execution-flow`与`local-pty-robustness`又重复包含退出、重启和输出验证。重新设计后，读者应能从一个稳定场景和子场景名称知道正在验证的产品行为、原执行是否应保留、依赖哪些环境以及失败在哪个步骤。链接成功不能被误解为停止正确，输入可用和fake Agent状态推断不能代证真实TUI回合完成。

设计先覆盖全部默认源码19项、packaged8项和focused-only3项，重点细化原01–07；trusted/restricted长链、旧代、重开和双窗口保留其上下文与因果组合，不仅按helper名字机械拆分。交付正式设计文档 `docs/design-docs/smoke-scenario-boundaries.md`，覆盖清单置于 `docs/references/release-gate-flow-audit/smoke-redesign/`，原现状六图保持历史事实。

## 进度


- [x] (2026-10-17) 读取工作流、计划和设计规范，确认用户要求按目标分离链接/停止，并重新分析退出/重启/压力等后续场景。
- [x] (2026-10-17) 固定输入50e201ca与20份源码hash，提取22个入口及公共前置、trusted/restricted的147处调用，核对原01–07的58项语义与准备/动作/断言/清理角色。
- [x] (2026-10-17) 比较三种粒度，提出按目标场景/子场景与有限组合步骤组织；明确场景、case、步骤和环境维度。
- [x] (2026-10-17) 交付原01–07的14目标表、152个拟议case名称（137个迁移目标/15个新增待验）、默认全范围迁移清单、源码/packaged覆盖策略及执行/证据契约。
- [x] (2026-10-17) 静态核对源码hash、19/8/3入口顺序、109/38调用与迁移引用/链接；原六图静态校验保持通过，同步索引与技术债。
- [x] (2026-10-17) 只暂存本轮设计与静态证据，按COMMIT规范本地提交，继续既有修复分支，不新增PR。

## 意外与发现


旧分组来自修复验收历史：2026-10-10的 `docs/exec-plans/completed/smoke-link-stop-fix.md`明确把链接、Codex Stop与Claude Stop复用到一个focused场景，理由是避免trusted前置失败遮蔽。当前场景入口另外加了Claude显式会话身份，已不是单一产品验证目标。

场景03的 `simulateRuntimeReloadForTest`在同一Host主动调用执行边界清理，不执行真正Reload Window或退出Host；普通页面重建、画布重读和surface切换应保留活动执行。新划分须显式区分这些触发条件。fake CLI输出后打印prompt是状态推断的受控输入，不是实际provider回合完成证据。

## 决策记录


2026-10-17：按用户要求将链接交互与主动停止分为不同验证目标。本轮完成设计和可追溯映射，实施留到设计之后；不把新的方案图画成现有CI。场景用行为和生命周期边界命名，子场景用于同一契约下的变化或步骤，运行环境作为显式维度，不展开无依据的全平台/全模式笛卡尔积。

2026-10-17：方案推荐按目标组织但保持`decision_status: 比较中`、`validation_status: 未验证`，供用户审阅；设计研究完成不等于方案已接受或产品已验。case名称是迁移目录，不是新的Host/job数量。同兼容环境可承载多个独立fixture，压力、restricted、preActivation与特殊拓扑保持独立边界，实际Host分组须测量成本。

2026-10-17：把Host中断后的显式新Start与用户Stop后的重启分开归属；保留exit19在成功resume上下文中的分类，不能用普通exit17代替。保留原trusted独有领域和诊断证据消费者，先迁移原断言与fixture再去重；旧代/重开/双窗口的Stop和resize为上下文连续性步骤，不删除。

## 结果与复盘


设计研究已交付并随本计划本地提交。正式设计文件有场景/子场景、每类触发与身份/结果、现有预算、source/packaged覆盖保留、结果与清理契约、渐进实施顺序，以及真实TUI/页面remount/真实新Host等15项新增待验目录。JSON和可读清单包含22个现有入口、公共前置、147处长链调用、58项原01–07语义、4项checkpoint额外语义与9个特殊组合的具名步骤；137个现有迁移case不宣称其fixture已独立，逐条断言等价仍需实施review。

在仓库根运行`python3 docs/references/release-gate-flow-audit/smoke-redesign/verify.py`，20份源码及历史输入HEAD hash一致、19/8/3顺序与109/38调用无遗漏、迁移引用和链接通过，报告`productAcceptance: not-run`。原`smoke/verify.py`继续通过16份源码及六图的静态核对。未安装依赖、运行Host或重跑发布门禁。后续实施按设计五步推进，并在技术债中登记；原完整门禁首败及已复现生产恢复竞态继续原计划处理，不将场景拆分视为发布卡点已修复。

## 上下文与定向


外层 `scripts/smoke/run-vscode-smoke.mjs`按名称串行建立私有HOME/user-data/runtime并启动真实VS Code。`scripts/smoke/run-vscode-vsix-smoke.mjs`解包主VSIX、建立测试开发扩展并复用suite；不是Marketplace原样安装。普通suite位于 `tests/vscode-smoke/extension-tests.cjs`，包含原01–07分支及trusted/restricted长链；专门suite为 `legacy-supervisor-upgrade-tests.cjs`、`real-reopen-tests.cjs`与`two-window-shared-runtime-tests.cjs`。Supervisor是独立管理后台执行的进程，原执行、Host和Supervisor是否结束是不同观察对象。Webview Playwright另在 `test:webview`，不等同真实Host集成。

研究工作区为 `/dev/shm/dsc-restricted-ready`，分支 `smoke-lifecycle-diagnostic-isolation`。主工作区 `/home/users/ziyang01.wang-al/projects/dev-session-canvas`有用户的WORKFLOW改动，保持原样。本轮固定研究输入为开始任务的HEAD，映射保存完整SHA及读取文件hash；后续实施若源码变化，应重新核对映射，不将旧行号冒充新事实。

## 工作计划与里程碑


第一里程碑提取实际编排与helper调用，为原01–07逐项写出准备、被测动作、身份、结果与清理；为其余默认/定向场景记录环境与覆盖边界。只读取测试/实现，必要时用静态脚本提取有界函数，不执行Host main。完成后每个现有入口都有迁移去向，重复调用保留上下文说明。

第二里程碑比较候选粒度并形成拟议目录。选定方案须使链接、停止、自然退出、错误退出、再次启动、非中断页面重建、Host中断恢复、高输出和并发分别有可说明的契约。同fixture的子场景不得依赖前一无关场景成功，准备和清理有自己的结果；有因果的Stop→再次启动和重开setup→verify保留在有限组合验证中。真实TUI状态验证仍是待设计/验证缺口。

第三里程碑定义共享场景清单、源码/packaged环境、默认与定向范围、时间预算、子场景结果与原执行证据，以及从旧到新的渐进迁移顺序。实现时应先保留旧断言，再校验新旧覆盖，定向运行新增场景，最后用同SHA/同run原生资产做完整release:verify；本轮只检查设计资料可追溯、无遗漏、假设显式。

## 具体步骤


在研究工作区读取runner、suite、输出/resize/退役helper及对应产品规格。生成 `docs/references/release-gate-flow-audit/smoke-redesign/coverage-map.json`，包含输入SHA、源码hash、当前场景/调用、拟议场景/子场景和证据限制。新增静态校验脚本只校验映射与文档，不载入VS Code或mock执行成功。设计文档以中文表格与小图展示验证契约，更新设计索引、core-beliefs和现状说明的设计入口。

## 验证与验收


本轮成功标准：原默认19项、packaged8项、focused3项、trusted/restricted直接调用均有去向；原01–07业务helpers的子场景覆盖有准确代码依据；场景契约明确原身份保留/替换时机、结果来源、fixture/真实provider边界、清理失败处理及预算。静态报告必须声明“不是产品验收”。设计保留未验证新增覆盖与待确认选择，不能伪报真实Host重开或provider测试通过。

实施的验收须证明新focused场景可独立运行、原业务断言保持、Stop与链接不互相前置、异常退出不依赖Stop正例、压力不依赖恢复链、未知filter与缺失必跑场景不能成功。保留真实Stop、原输出序列/身份、原退役等待、页面正文及原resize几何条件；失败后其他项标未运行，诊断收集运行不能替代release完整链。最终发布输入仍按WORKFLOW要求在最新预合并SHA运行完整门禁。

## 幂等性与恢复


仅编辑本轮资料，静态校验器只更新自己的verification.json。原现状图/hash与失败工件保持，不改产品或CI。设计本地提交沿当前分支保留，不新增PR，不合并/tag/发布。后续实现改变默认清单时必须同步source/packaged/filter与文档，并保留旧覆盖直到迁移验收完成。

## 证据与备注


本轮前置事实来自`docs/references/release-gate-flow-audit/smoke/`现状映射及前几轮代码核对。设计研究输入HEAD、源码hash与迁移位置已写入`smoke-redesign/coverage-map.json`；最终静态报告为`smoke-redesign/verification.json`。没有新的产品成功证据。原01–07表在`docs/design-docs/smoke-scenario-boundaries.md`，完整可读case目录和旧迁移表为`smoke-redesign/README.md`。

## 接口与依赖


本轮不新增产品依赖。拟议实现以共享声明式场景清单驱动两个runner，采用稳定scenario/case ID，case准备/动作/断言/清理分阶段输出。具体字段、suite拆分边界与兼容迁移写入设计文档后，后续实现可直接按该契约落地；不为绘图或静态提取安装项目依赖。

修订记录：2026-10-17创建，先记录研究范围、旧分组依据和验收边界；同日完成三种粒度比较、全范围迁移/证据契约及静态检查，归档设计研究。方案与实施仍明确待审阅/未验证。
