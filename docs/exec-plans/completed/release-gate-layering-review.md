# 审查smoke之外的发布门禁边界

本ExecPlan按`docs/PLANS.md`维护。当前任务是检查并提出可审阅的门禁重划建议，继续既有审查/修复分支，不新增诊断、验证或文档PR，不实施workflow、产品或仓库设置修改。

## 目标与全局图景


用户已审阅并要求重划smoke场景，现在需要判断其他门禁环节是否不合理。交付应说明每层实际验证什么、遗漏什么、哪些串行依赖必要、哪些重复仍有价值，以及需要局部修复或重新设计的准确边界。目标是更早得到可解释的失败、让验收证据绑定最终发布产物，同时保留完整发布门禁。

## 进度


- [x] (2026-10-17) 读取WORKFLOW与既有全流程审查，确认当前分支0100abf0及用户主工作区WORKFLOW改动。
- [x] (2026-10-17) 固定25份源码摘要与main差异，保存带时间的GitHub保护只读观察，完成所有目标层读取。
- [x] (2026-10-17) 核对70条npm顶层命令与具名script接线；5项现有finalize纯逻辑、3项历史verified/query控制确认边界。
- [x] (2026-10-17) 形成八环节判断、按依赖的推荐图、三批推进顺序与保留保证。
- [x] (2026-10-17) 同步设计、索引、原则、技术债与原审查入口。
- [x] (2026-10-17) 固定输入与构建路径/控制核对完成，11文档链接、frontmatter/索引及三处同步核对通过；归档设计研究并收口本地提交。

## 意外与发现


既有审查已指出普通PR只做release skip、GitHub保护缺口、filter缩减、Host无期限、失败工件未上传、浮动宿主与notifier独立验证未接线。本轮重核当前实现，区分旧事实、最新远端状态和拟议改动，不重复把历史调查称为新的产品失败。

新增事实是clean-checkout打包、packaged重打与最终prepare双包之间没有测试产物摘要绑定；这不证明两包实际不同。现有finalize inline逻辑对错releaseRef或artifact hash的partial仍判完成，无partial但base历史verified也完成。现有verifier对previous verified本轮query=false仍返回true，而pending/false负例失败。共8项隔离案例确认，未执行前面的真实同run下载和ref/hash guard，不能据此追认历史错误发布。

六平台asset结果明确executionApiCalled=false/productValidated=false；应保留require与资产来源保证，并区别真实操作验收。npm script可达性不是代码覆盖，部分未接线脚本在独立workflow已有覆盖，不能泛化为完全未测试。

## 决策记录


2026-10-17：本轮是检查与设计建议，不运行全量门禁、不写外部评论、不直接修改强制合并规则。smoke目录重划是前一轮拟议方案，本轮将其放入总体分层；完整发布验证与正常merge偏好保持用户授权边界。

2026-10-17：选择直接提取当前finalize/verifier纯逻辑的隔离样本，避免import发布入口或调用真实渠道；以10秒子进程期限和自动删除私有临时目录保存可复现证据。该受控验证只确认当前分支行为，不测试产品或新方案。

2026-10-17：推荐先局部补范围/身份/期限/取证，再重划双包消费式验收和普通PR入口，最后按实依赖拆层及选定新增平台/provider覆盖。保留最终tag再验与已有Release原包复用，不因去重删除跨release ref验证，不自动改变VS deferred策略或扩大0.26.1契约。

## 结果与复盘


审查设计与静态/隔离逻辑证据已交付，重划建议处于比较中、未验证；产品或完整发布验证均未运行。已完成25源码hash、70顶层调用、构建/stage路径断言及8纯逻辑案例核对，设计研究归档。后续实施责任登记于tech-debt-tracker，不由本研究完成状态暗示门禁已修复或发布已放行。

## 上下文与定向


工作区`/dev/shm/dsc-restricted-ready`的`release-preflight.yml`区分是否修改发布契约，并在发布PR调用六平台`runtime-execution-assets.yml`与`release:verify`。`publish-marketplace-release.yml`的六job包含resolve、native-assets、prepare、两个渠道及finalize。`scripts/release/release-preflight.mjs`负责静态契约和npm test/clean-checkout；clean-checkout打包与测试后删除worktree，正式发布脚本另行准备Release资产。测试与生产包的来源、hash、入口与环境须分别核对。

`docs/design-docs/release-gate-flow-audit.md`和`docs/references/release-gate-flow-audit/`是既有事实与现状图，本轮新增分层审查设计文档及固定hash证据，不重画历史图。主工作区`/home/users/ziyang01.wang-al/projects/dev-session-canvas`只有用户WORKFLOW改动，不修改。

## 工作计划与里程碑


第一里程碑已完成真实入口、阶段与产物读取；git fetch与GitHub只读查询固定main6e708c6b。inputs.json保存0100abf0完整输入、25摘要、两处main差异及2026-10-17T11:40:50Z保护观察，不改变当前分支。

第二里程碑已按八环节形成事实、缺口、修复或重划建议及验收。推荐独立层报告但保持场景内因果，保留两个release ref完整验证。verify.py只跟踪npm run与执行提取的纯逻辑，记录正反例边界。

第三里程碑设计、推荐依赖图和渐进顺序已交付到release-gate-layering-review.md，索引/core-beliefs/技术债已同步。最后核对hash/入口/链接及diff，仅提交本轮资料。本轮无新的CI或产品成功证据。

## 具体步骤


读取`scripts/build/assemble-execution-distribution-assets.mjs`及六平台load逻辑，提取实际验证边界；读clean-checkout与publish流程证明测试包和发布包如何关联；读取stage方法证明是否原样安装主包/notifier。分析npm script可达性及嵌套build，以固定输入记有界静态证据。设计写到`docs/design-docs/release-gate-layering-review.md`，输入清单写到`docs/references/release-gate-flow-audit/layering-review/`。

仓库根执行`python3 docs/references/release-gate-flow-audit/layering-review/verify.py`，预期sourceHashes25/topLevelCommands70/mergeControls5/historyControls3；已完成。使用Python标准库与PATH上Node，无需安装依赖。文档链接核对和git diff --check后将本计划移入completed，更新结果与进度并按COMMIT本地提交本轮资料。

## 验证与验收


每个建议应有准确文件/阶段、实际后果与验收条件，未知风险明确标待验证。所有正式静态与发布防护保持：最新预合并验证、同SHA/同run资产、最终tag再验、已有Release hash核验、部分渠道幂等恢复。报告必须注明未运行产品和完整发布门禁；流程重划未实施。

## 幂等性与恢复


只改本轮审查资料，外部查询只读。源码与现状图保持；不创建PR、合并、tag或发布。静态报告失败时修资料或明确源码变化，不假造通过。

## 证据与备注


开始完整输入0100abf07a6bb09ef36a12b32d989ad0c7e759aa；remote观察和源码hash已写入inputs.json。verification.json确认25/70/5/3；静态分析与提取逻辑只证明调用、数据路径和控制样本，不证明产物行为、历史失败或覆盖成本。

最终核对输出为links=11、frontmatter/index一致、sync=3；git diff --check通过，主工作区仍仅用户docs/WORKFLOW.md改动，本轮不触及它。

## 接口与依赖


无新产品依赖。本轮可用Python/Node静态脚本和gh只读API，不安装依赖、不改凭据。不由审查自动扩大0.26.1发布范围，已有生产恢复竞态仍按原计划闭环。

本次修订（2026-10-17）：完成八环节审查与隔离控制，推荐先修确定守卫再分层；更新所有活章节及后续责任，避免把研究完成误写为门禁修复完成。

归档说明（2026-10-17）：交付设计、推荐图、核对脚本与固定证据，完成本轮研究范围；实施和完整门禁由后续计划承担。
