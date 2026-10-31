---
title: 发布工具与产品内容解耦
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/active/release-product-decoupling.md]
updated_at: 2026-11-01
---

# 发布工具与产品内容解耦

## 问题与决策来源

2026-10-31，用户在 0.27.0 发布复盘中明确要求：发布工具和发布流程应与产品代码解耦，发布工具更新不影响发布内容。本文件选定该边界，适用于首次发布、失败恢复和渠道重试；不将已有恢复修复等同于全流程已经解耦。

0.27.0 的恢复曾混用新 resolver 与旧产品 SHA 上的校验器，导致渠道选择断言失败，见 [PR #349](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/349)。这表明产品提交不能同时被当作必须执行的发布工具提交。

## 正式方案

产品是发布流程的显式输入。产品版本、源码提交、已验收主扩展与 notifier VSIX、摘要及验收来源共同确定交付对象。发布工具负责核验、传输、渠道编排与结果记录；工具更新不得隐式改变产品源码、依赖、版本、包内容，或改指已有产品 tag。

发布流程与产品输入分别选择执行依据。一次发布运行应固定其 workflow 和发布脚本的执行版本，解析、恢复校验、上传与收尾必须使用兼容且一致的策略。发布脚本提交 SHA 是自动记录的执行来源，不要求人工维护独立的工具语义版本号，也不要求拆成独立仓库。

构建与交付必须保持边界：需要生成候选包时，构建读取明确的产品提交及其锁定输入，不能因为发布工具 checkout 更新就构建工具所在提交的产品。已有验收双包后，交付和渠道重试只消费该批原包，不重新打包替换。同一源码的两次构建不自动视为相同内容。

更新发布工具可以修正上传、诊断、恢复或渠道策略，但不能因此改写原始产品身份、历史验收证据或放宽验收结论。新工具不理解旧输入或回执时，应明确拒绝并保留现场，不能通过换包、移动 tag 或伪造兼容来继续。

上述约束同时覆盖首次发布和恢复，不将“首次发布绑定产品内旧工具、恢复才允许使用新工具”作为最终架构。具体实施采用下方 2026-11-01 的同仓库两条流水线，由对应 ExecPlan 推进。

## 改造前实现与缺口（2026-10-31）

核对基线为 `origin/main@aa18ec56c8a8a84ddc7cfd383ce4775cdbb4b020`：

- `.github/workflows/publish-marketplace-release.yml` 的首次发布仍由 `publish/v*` tag push 触发；prepare、Open VSX 和 finalize 在 `release-tag` 模式仍 checkout 产品 `input_sha`。workflow 与消费者代码仍随产品 tag 固定，尚未实现首次发布工具的独立更新。
- `.github/workflows/release-validation.yml` 的 `channel-retry` 校验使用 `github.sha`；主 workflow 的恢复交付步骤也使用该 SHA。PR #349 修复的是这段恢复链路。
- `scripts/release/release-delivery.mjs`、`release-completion.mjs` 与 `release-state.mjs` 承担产品身份、验收产物和渠道状态校验；后续解耦必须保留这些约束，不能只替换 checkout 后宣称完成。

本次只记录正式原则和实现差距，没有改动 workflow、脚本或任何发布资产。`validation_status: 验证中` 指完整解耦尚未实施验收，不否认已有恢复路径的验证结果。此前 [发布门禁重设计](release-gate-redesign.md) 中首次发布使用产品 SHA 上脚本的规则，保留为当前实现说明，其目标边界由本文件更新。

## 后续验证标准

固定同一产品提交和已验收双包，分别使用更新前后的发布工具执行受控交付，确认版本、源码身份与 VSIX 摘要完全一致，而工具修复行为实际生效。首次发布与恢复均需覆盖，并核对各阶段真实执行来源。

工具 checkout 中放置不同产品版本时，仍只能交付显式指定的原产品输入；包内容冲突、错误来源或不兼容回执必须在交付前被拒绝。重复执行和中断续跑必须保持原包及已上传不可变证据，不覆盖历史内容。上述为待执行验收标准，本次未运行这些实验。

## 初始文档验证（2026-10-31）

人工核对上述两个 workflow 的触发与 checkout 表达式、PR #349 的修复范围，以及文档状态与实现差距的表述；检查相对链接、索引状态和 `git diff --check`。本次不发起发布或渠道请求。

## 2026-11-01 已选定实施方式

用户批准同仓库两条流水线并授权改造。`build-release-batch.yml` 从 main 接受产品 SHA/版本，调用原完整产品验收，并由独立 seal job 将双包、验收文件、固定 original context 和产品提交中的 CHANGELOG 封装为 `release-batch-<run>-<attempt>`。`publish-marketplace-release.yml` 从 main 接受版本及批次 run/attempt，使用本次 workflow SHA 的脚本验证实际成功 seal producer 与 artifact 摘要，然后交付该批次。首次上传中断继续同一批次，已有状态链走原 channel-retry；历史完整 Release 保留无批次的原包恢复。首发不再依赖 publish tag push，最终 tag 在原包校验后创建并指向产品 SHA。

交付核验历史验收的冻结任务与真实 producer，不能将当前工具的测试目录重算后要求与旧产品相同；只有构建验收阶段按该产品实际目录检查完整性。新增分支不得让普通 PR 回执冒充 release-tag 批次。批次保留 90 天，过期拒绝重新构建替换；长期来源归档为显式后续限制。

两条流水线及批次校验已实现；受控回归与旧发布合同已通过，完整 PR CI 与实际发布运行分别追踪，不将本地结果当作市场交付。

构建兼容旧产品的方式是在 CI resolve 的隔离 checkout 中建立本地 `publish/vX.Y.Z` 验证引用，并核对产品属于 main；已存在不同 SHA 时拒绝。该引用不推送远端，不触发发布；产品原 `resolve-plan`、测试目录和构建代码保持原样。


## 实施验证（2026-11-01）

Node v25.6.0 下，gate contracts、历史初始恢复与新批次回归合计 142/142 通过；旧交付/完成测试 38/38 通过。新批次覆盖实际 ZIP/producer 绑定、失败或 PR 来源、错误版本/attempt/包、旧冻结目录、工具与产品 SHA 不同、四个上传中断点跨工具续传、先拒绝冲突再上传，以及完整交付后的真实状态链恢复。workflow 合同另外执行实际本地 Git 引用绑定脚本，验证幂等及冲突拒绝。以上均为受控远端，未执行真实渠道发布。
